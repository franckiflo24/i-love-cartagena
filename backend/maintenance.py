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
