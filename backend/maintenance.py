"""Ops maintenance endpoints — stop-the-bleed drop 2026-10-01.

Auth: Bearer CRON_SECRET ONLY (constant-time), same rule as ensure-alcaldia —
no session or cookie can drive these. Every mutating op is BACKUP-BEFORE-WRITE:
the affected docs are snapshotted into `maintenance_backups` first, then
changed, and the response reports COUNTS and ids only — never a secret value.

    GET  /admin/maintenance/status
    POST /admin/maintenance/sessions/revoke          {business_ids?: [...], emails?: [...]}
    POST /admin/maintenance/city-pass/rotate-keys    {dry_run?: bool}
    POST /admin/maintenance/partner-events/backfill-date-end {dry_run?: bool}
    POST /admin/maintenance/alert-test                       (Telegram delivery counts)
    POST /admin/maintenance/catalog-hygiene  {dry_run?: bool, reverse?: bool}
        CATALOG-HYGIENE v1 migration over db.partners — idempotent, reversible,
        backup-before-write. Also accepts Bearer EVENTS_ADMIN_TOKEN (ops runs
        it without the cron secret).
"""
from __future__ import annotations

import hmac
import logging
import os
import secrets as _secrets
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

logger = logging.getLogger("maintenance")
router = APIRouter()
db: Any = None

GOV_BUSINESS_IDS = ["biz_alcaldia"]
# Seeded + demo partner accounts whose passwords were once in git history.
DEMO_PARTNER_EMAILS = [
    "casaboheme@amocartagena.app", "bellini@amocartagena.app", "cafedelmar@amocartagena.app",
    "blueapple@amocartagena.app", "elarsenal@amocartagena.app", "demo@amocartagena.app",
]


def init(db_: Any) -> None:
    global db
    db = db_


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _require_cron(request: Request) -> None:
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else ""
    cron = os.environ.get("CRON_SECRET", "").strip()
    if not cron or not hmac.compare_digest(token, cron):
        raise HTTPException(status_code=403, detail="cron secret required")
    try:
        from server import _check_rate_limit, _client_ip  # lazy: server imports this module
        await _check_rate_limit(f"maint:{_client_ip(request)}", max_calls=30, window_sec=600)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.error("[maintenance] rate limit unavailable: %s", type(exc).__name__)


async def _backup(op: str, collection: str, docs: List[Dict[str, Any]]) -> str:
    """Snapshot BEFORE any write. Returns the backup id (reported to the operator)."""
    backup_id = f"mb_{uuid.uuid4().hex[:12]}"
    clean = [{k: v for k, v in d.items() if k != "_id"} for d in docs]
    await db.maintenance_backups.insert_one({
        "backup_id": backup_id, "op": op, "collection": collection,
        "count": len(clean), "docs": clean, "created_at": _now(),
    })
    return backup_id


async def _audit(op: str, detail: str) -> None:
    try:
        from server import _log_activity
        await _log_activity("maintenance", scope="admin", detail=f"{op}: {detail}"[:400])
    except Exception:  # noqa: BLE001
        pass


# ── status ────────────────────────────────────────────────────────────────────

@router.get("/admin/maintenance/status")
async def maintenance_status(request: Request):
    await _require_cron(request)
    gov_ids = GOV_BUSINESS_IDS
    demo_ids = [b["business_id"] async for b in db.business_users.find(
        {"email": {"$in": DEMO_PARTNER_EMAILS}}, {"_id": 0, "business_id": 1})]
    sessions_gov = await db.business_sessions.count_documents({"business_id": {"$in": gov_ids}})
    sessions_demo = await db.business_sessions.count_documents({"business_id": {"$in": demo_ids}})
    passes_with_key = await db.city_passes.count_documents({"qr_secret": {"$exists": True}})
    missing = [e async for e in db.partner_events.find(
        {"$or": [{"date_end": {"$exists": False}}, {"date_end": None}]},
        {"_id": 0, "event_id": 1, "title": 1, "date": 1, "start_time": 1, "end_time": 1, "partner_id": 1})]
    from server import _overnight_date_end
    overnight = [e for e in missing if _overnight_date_end(e.get("date", ""), e.get("start_time", ""), e.get("end_time", ""))]
    return {
        "sessions": {"government": sessions_gov, "demo_partners": sessions_demo, "demo_partner_ids": demo_ids},
        "city_passes_with_key": passes_with_key,
        "partner_events": {
            "no_date_end_total": len(missing),
            "overnight_needing_backfill": len(overnight),
            "overnight_rows": [{k: e.get(k) for k in ("event_id", "title", "date", "start_time", "end_time", "partner_id")} for e in overnight],
        },
        "checked_at": _now(),
    }


# ── sessions ──────────────────────────────────────────────────────────────────

class RevokeBody(BaseModel):
    business_ids: List[str] = Field(default_factory=list, max_length=50)
    emails: List[str] = Field(default_factory=list, max_length=50)


@router.post("/admin/maintenance/sessions/revoke")
async def revoke_sessions(body: RevokeBody, request: Request):
    await _require_cron(request)
    ids = set(body.business_ids)
    if body.emails:
        async for b in db.business_users.find({"email": {"$in": [e.lower() for e in body.emails]}}, {"_id": 0, "business_id": 1}):
            ids.add(b["business_id"])
    if not ids:
        raise HTTPException(status_code=400, detail="business_ids or emails required")
    ids_l = sorted(ids)
    docs = [d async for d in db.business_sessions.find({"business_id": {"$in": ids_l}}, {"_id": 0, "token": 0})]
    backup_id = await _backup("sessions.revoke", "business_sessions", docs)  # tokens excluded by projection
    res = await db.business_sessions.delete_many({"business_id": {"$in": ids_l}})
    remaining = await db.business_sessions.count_documents({"business_id": {"$in": ids_l}})
    await _audit("sessions.revoke", f"ids={ids_l} revoked={res.deleted_count}")
    return {"business_ids": ids_l, "revoked": res.deleted_count, "remaining": remaining, "backup_id": backup_id}


# ── city pass keys ────────────────────────────────────────────────────────────

class DryRun(BaseModel):
    dry_run: bool = False


@router.post("/admin/maintenance/city-pass/rotate-keys")
async def rotate_city_pass_keys(body: DryRun, request: Request):
    """Regenerate qr_secret IN PLACE for every pass that has one (the mint in
    tickets.py uses secrets.token_hex(16); we match it). Holders' apps poll
    /city-pass/qr every ~10 s and pick up the new key on the next poll; any
    code derived from a leaked key verifies FALSIFICADO from this moment."""
    await _require_cron(request)
    docs = [d async for d in db.city_passes.find({"qr_secret": {"$exists": True}}, {"_id": 0})]
    found = len(docs)
    if body.dry_run:
        return {"dry_run": True, "found": found, "rotated": 0}
    backup_id = await _backup("city_pass.rotate_keys", "city_passes", docs)
    rotated = 0
    for d in docs:
        r = await db.city_passes.update_one(
            {"pass_id": d["pass_id"], "qr_secret": d["qr_secret"]},  # only if unchanged since snapshot
            {"$set": {"qr_secret": _secrets.token_hex(16), "qr_key_rotated_at": _now()}})
        rotated += r.modified_count
    await _audit("city_pass.rotate_keys", f"found={found} rotated={rotated}")
    return {"dry_run": False, "found": found, "rotated": rotated, "backup_id": backup_id}


# ── partner events date_end backfill ─────────────────────────────────────────

@router.post("/admin/maintenance/partner-events/backfill-date-end")
async def backfill_date_end(body: DryRun, request: Request):
    """Rows written before the Sep-30 overnight fix have no date_end. Compute it
    with the SAME function the writers use (server._overnight_date_end) and set
    it ONLY where it is missing/null and the event is overnight. Never overwrites
    an existing value; non-overnight rows are left untouched (None is correct)."""
    await _require_cron(request)
    from server import _overnight_date_end
    rows = [e async for e in db.partner_events.find(
        {"$or": [{"date_end": {"$exists": False}}, {"date_end": None}]}, {"_id": 0})]
    plan: List[Dict[str, Any]] = []
    for e in rows:
        de = _overnight_date_end(e.get("date", ""), e.get("start_time", ""), e.get("end_time", ""))
        if de:
            plan.append({"event_id": e.get("event_id"), "title": e.get("title"), "date": e.get("date"),
                         "start_time": e.get("start_time"), "end_time": e.get("end_time"), "date_end": de})
    if body.dry_run:
        return {"dry_run": True, "scanned": len(rows), "would_set": len(plan), "rows": plan}
    backup_id = await _backup("partner_events.backfill_date_end", "partner_events",
                              [e for e in rows if any(p["event_id"] == e.get("event_id") for p in plan)])
    changed: List[Dict[str, Any]] = []
    for p in plan:
        r = await db.partner_events.update_one(
            {"event_id": p["event_id"], "$or": [{"date_end": {"$exists": False}}, {"date_end": None}]},
            {"$set": {"date_end": p["date_end"], "date_end_backfilled_at": _now()}})
        if r.modified_count:
            changed.append(p)
    await _audit("partner_events.backfill_date_end", f"scanned={len(rows)} set={len(changed)}")
    return {"dry_run": False, "scanned": len(rows), "set": len(changed), "rows": changed, "backup_id": backup_id}


# ── alert channel check ───────────────────────────────────────────────────────

@router.post("/admin/maintenance/alert-test")
async def alert_test(request: Request):
    """Send one fixed test line through the production Telegram alert path and
    report delivery COUNTS only (never a chat id). Used after any change to
    TELEGRAM_ALERT_CHAT_IDS to prove every listed chat actually receives alerts
    (ops rule: Sergio is on the list for all production alerts)."""
    await _require_cron(request)
    import telegram_alerts as _tg
    res = await _tg.send(f"🔔 AMO prueba de alertas · {_now()[:16]} — si ves esto, el canal funciona.")
    await _audit("alert_test", f"chats={res.get('chats')} sent={res.get('sent')} errors={len(res.get('errors') or [])}")
    return {"configured": res.get("configured"), "chats": res.get("chats"), "sent": res.get("sent"),
            "errors": res.get("errors") or []}


# ── SUPPLY-SPRINT v1: inventory drought alarm (2026-10-07) ───────────────────
# "Zero RSVP-able inventory" was the elite audit's P0-product — this cron makes
# a silent recurrence structurally impossible: hourly count of open, future,
# seat-available events in the next 14 days; below threshold → Telegram ops
# alert (Phil + Sergio, standing rule) + a health doc the dashboard can read.

@router.api_route("/admin/maintenance/inventory-watch", methods=["GET", "POST"])
async def inventory_watch(request: Request):
    await _require_cron_or_events_admin(request)
    from events_time import now_bogota, upcoming_query
    from partner_visibility import PARTNER_EVENT_PUBLIC
    now = now_bogota()
    horizon = (now + __import__("datetime").timedelta(days=14)).strftime("%Y-%m-%d")
    base = {**PARTNER_EVENT_PUBLIC}
    rows = await db.partner_events.find(
        upcoming_query(base, now),
        {"_id": 0, "event_id": 1, "date": 1, "capacity": 1, "rsvp_count": 1}).to_list(500)
    live = 0
    for ev in rows:
        d = ev.get("date") or ""
        if d and d > horizon:
            continue
        cap = ev.get("capacity")
        if isinstance(cap, int) and cap > 0 and int(ev.get("rsvp_count") or 0) >= cap:
            continue  # full house is not RSVP-able inventory
        live += 1
    threshold = int(os.environ.get("INVENTORY_MIN_14D", "3") or 3)
    drought = live < threshold
    if drought:
        try:
            import telegram_alerts as _tg
            await _tg.send(f"⚠️ AMO inventory drought: {live} RSVP-able event(s) "
                           f"in the next 14 days (threshold {threshold}). "
                           f"The ticketing rail is starving — publish events.")
        except Exception as exc:  # noqa: BLE001
            logger.error("[inventory-watch] alert failed: %s", type(exc).__name__)
    try:
        await db.system_health.update_one(
            {"_id": "inventory_watch"},
            {"$set": {"live_14d": live, "threshold": threshold,
                      "drought": drought, "checked_at": _now()}}, upsert=True)
    except Exception as exc:  # noqa: BLE001
        logger.error("[inventory-watch] health write failed: %s", type(exc).__name__)
    await _audit("inventory_watch", f"live={live} threshold={threshold} drought={drought}")
    return {"live_14d": live, "threshold": threshold, "drought": drought}


# ── CALENDAR-INTEGRATION v1: recheck watchlist (2026-10-07) ──────────────────
# The forward calendar stores recheck_at watch dates on anchor rows — a
# file-side curation field (docs/calendar/FORWARD_CALENDAR_2026-10.md carries
# the research). Daily: digest every row whose watch date has arrived to
# Telegram ops until a curator re-researches and edits the file. Stateless by
# design: the file is the truth, the alarm repeats, and the fix is always
# "re-verify the source, then update backend/data/events_anchors.json".

@router.api_route("/admin/maintenance/recheck-due", methods=["GET", "POST"])
async def recheck_due(request: Request):
    await _require_cron_or_events_admin(request)
    import json as _json
    from pathlib import Path
    from events_time import now_bogota
    today = now_bogota().strftime("%Y-%m-%d")
    path = Path(__file__).resolve().parent / "data" / "events_anchors.json"
    try:
        anchors = _json.loads(path.read_text(encoding="utf-8")).get("anchors") or []
    except Exception as exc:  # noqa: BLE001
        logger.error("[recheck-due] anchors read failed: %s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="anchors_unreadable")
    due = [{"key": a.get("key"), "recheck_at": a.get("recheck_at"),
            "recheck_url": a.get("recheck_url"), "status_hint": a.get("status_hint")}
           for a in anchors
           if isinstance(a.get("recheck_at"), str) and a["recheck_at"] <= today]
    due.sort(key=lambda r: (r["recheck_at"], r["key"]))
    sent = False
    if due:
        # one digest per Bogota day, however often the route fires
        try:
            cur = await db.system_health.find_one({"_id": "events_recheck"}, {"_id": 0, "digest_day": 1})
        except Exception:  # noqa: BLE001
            cur = None
        if not (isinstance(cur, dict) and cur.get("digest_day") == today):
            lines = "\n".join(f"• {r['key']} (desde {r['recheck_at']}) → {r['recheck_url']}" for r in due[:12])
            more = f"\n… y {len(due) - 12} más" if len(due) > 12 else ""
            try:
                import telegram_alerts as _tg
                await _tg.send(f"📅 AMO calendario: {len(due)} ancla(s) por re-verificar:\n{lines}{more}\n"
                               "Re-investiga la fuente y actualiza backend/data/events_anchors.json "
                               "(fecha o recheck_at nuevos).")
                sent = True
            except Exception as exc:  # noqa: BLE001
                logger.error("[recheck-due] alert failed: %s", type(exc).__name__)
    try:
        health = {"due": len(due), "keys": [r["key"] for r in due][:30], "checked_at": _now()}
        if sent:
            health["digest_day"] = today
        await db.system_health.update_one({"_id": "events_recheck"}, {"$set": health}, upsert=True)
    except Exception as exc:  # noqa: BLE001
        logger.error("[recheck-due] health write failed: %s", type(exc).__name__)
    await _audit("events_recheck", f"due={len(due)} sent={sent}")
    return {"due": [r["key"] for r in due], "count": len(due), "digest_sent": sent}


# ── CATALOG-HYGIENE v1 (drop 2026-10-07) ─────────────────────────────────────

async def _require_cron_or_events_admin(request: Request) -> None:
    """This migration is ops-run with the scoped events admin bearer; the cron
    secret stays valid. Same constant-time discipline as _require_cron."""
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else ""
    ev = os.environ.get("EVENTS_ADMIN_TOKEN", "").strip()
    if ev and token and hmac.compare_digest(token, ev):
        return
    await _require_cron(request)


class CatalogHygieneBody(BaseModel):
    dry_run: bool = True          # default SAFE: look, don't touch
    reverse: bool = False
    sample: int = Field(default=40, ge=0, le=200)


_HYGIENE_FIELDS = {"_id": 0, "partner_id": 1, "name": 1, "name_raw": 1,
                   "name_verified": 1, "status": 1, "status_note": 1,
                   "address": 1, "location": 1, "geo": 1,
                   "category_hint": 1, "display_ready": 1, "hygiene_v": 1}


@router.post("/admin/maintenance/catalog-hygiene")
async def catalog_hygiene_migrate(body: CatalogHygieneBody, request: Request):
    """Apply (or reverse) catalog_hygiene.apply_hygiene over EVERY partner doc.

    Forward: name_raw preserved once, name cleaned unless name_verified,
    STATUS_OVERRIDES applied, display_ready + hygiene_v stamped. Reverse (spec):
    for hygiene_v==HYGIENE_V docs, name:=name_raw (unless name_verified) and
    category_hint/display_ready/hygiene_v are unset — status overrides KEPT.
    Mutating runs snapshot every changed doc's prior fields into
    maintenance_backups first. Response: counts + a bounded sample, no dumps.
    """
    await _require_cron_or_events_admin(request)
    import catalog_hygiene as H

    rows = await db.partners.find({}, dict(_HYGIENE_FIELDS)).to_list(5000)
    changes: List[Dict[str, Any]] = []
    flipped_not_ready = 0
    status_overridden = 0

    for p in rows:
        pid = p.get("partner_id")
        if not pid:
            continue
        if body.reverse:
            if p.get("hygiene_v") != H.HYGIENE_V:
                continue
            upd_set: Dict[str, Any] = {}
            if p.get("name_raw") and not p.get("name_verified"):
                upd_set["name"] = p["name_raw"]
            changes.append({"partner_id": pid, "prev": {k: p.get(k) for k in
                            ("name", "category_hint", "display_ready", "hygiene_v")},
                            "set": upd_set,
                            "unset": ["category_hint", "display_ready", "hygiene_v"]})
            continue

        after = H.apply_hygiene(dict(p))
        upd_set = {k: after.get(k) for k in
                   ("name", "name_raw", "category_hint", "status", "status_note",
                    "display_ready", "hygiene_v")
                   if after.get(k) is not None and after.get(k) != p.get(k)}
        if not upd_set:
            continue
        if after.get("display_ready") is False and p.get("display_ready") is not False:
            flipped_not_ready += 1
        if "status" in upd_set:
            status_overridden += 1
        changes.append({"partner_id": pid,
                        "prev": {k: p.get(k) for k in upd_set},
                        "set": upd_set, "unset": []})

    sample = [{"partner_id": c["partner_id"],
               "name_raw": (c["prev"].get("name") if body.reverse else
                            (c["set"].get("name_raw") or c["prev"].get("name"))),
               "name": c["set"].get("name") or c["prev"].get("name"),
               "name_changed": "name" in c["set"],
               "display_ready": c["set"].get("display_ready",
                                             c["prev"].get("display_ready"))}
              for c in changes[: body.sample]]

    result = {"dry_run": body.dry_run, "reverse": body.reverse,
              "scanned": len(rows), "would_change": len(changes),
              "flips_to_not_ready": flipped_not_ready,
              "status_overridden": status_overridden, "sample": sample}
    if body.dry_run:
        await _audit("catalog_hygiene.dry", f"scan={len(rows)} chg={len(changes)} hide={flipped_not_ready}")
        return result

    backup_id = f"mb_{uuid.uuid4().hex[:10]}"
    await db.maintenance_backups.insert_one({
        "backup_id": backup_id, "kind": "catalog_hygiene_v1",
        "reverse": body.reverse, "at": _now(), "count": len(changes),
        "docs": [{"partner_id": c["partner_id"], **c["prev"]} for c in changes]})
    applied = 0
    for c in changes:
        ops: Dict[str, Any] = {}
        if c["set"]:
            ops["$set"] = c["set"]
        if c["unset"]:
            ops["$unset"] = {k: "" for k in c["unset"]}
        if not ops:
            continue
        r = await db.partners.update_one({"partner_id": c["partner_id"]}, ops)
        applied += r.modified_count
    await _audit("catalog_hygiene.apply",
                 f"reverse={body.reverse} applied={applied} hide={flipped_not_ready} backup={backup_id}")
    result.update({"applied": applied, "backup_id": backup_id})
    return result
