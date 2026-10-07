"""EVENTS-ELITE service: cron/admin router + the read helpers server.py's public routes use.

Spec: docs/events-elite/DESIGN.md (precedence §15 > §13 > §1-§12). Honesty spine (§0): an event
shows, and a reminder fires, only when it is source-verified, future-dated in Bogotá time and in
Cartagena de Indias. Nothing here invents an event: candidates come from events_sources (pages we
fetched ourselves), every status comes from events_gate.evaluate / public_view, and the LLM (enrich)
may only translate / categorize / rewrite a description, never touch dates, venue, source or status.
When in doubt: a missed event beats a wrong one.

Mounted by server.py BEFORE api_router (prefix /api):

  cron (Bearer CRON_SECRET or Bearer EVENTS_ADMIN_TOKEN, §15 X1 + §16.4 — never a session or cookie):
    GET|POST /admin/events/pull        ?source=<key> ?dry=1        §7, §13 F, §15 P/Q, §16.4 anchors
    GET|POST /admin/events/enrich      ?dry=1                      §7, §15 S4
    GET|POST /admin/events/sentinel    ?slot=auto|main|today ?dry=1  §7, §13 F4/G, §15 S3/R4, §16.4
    GET|POST /admin/events/reminders   ?dry=1                      §13 H, §15 U
  admin mutations (§15 X2 + §16.4: Bearer EVENTS_ADMIN_TOKEN, Bearer admin session, or cookie +
  allowlisted Origin + X-AMO-Admin: 1):
    POST       /admin/events/seed-anchors                          §6, §15 W2
    POST       /admin/events/{id}/approve | hide | verify          §7, §15 R1/X3
    POST       /admin/events/{id}/set-dates                        §15 W2 companion (curator dates)
    POST|PATCH /admin/events/flags     {enabled?, sources_disabled?}   §13 E1, §15 T1
    POST       /admin/events/import-legacy                         §13 L
  admin reads:
    GET /admin/events/review | runs | flags | gate-check?url=      §7, §15 X4

  helpers for server.py (public routes stay in server.py so they sit above get_event, §13 C1):
    feed_payload / feed_item / legacy_* / live_favorite / calendar_filter / my_week_rows /
    favorite_meta / ensure_events_indexes

Logging: '[events] ...' with type(exc).__name__ only (outbound calls may embed tokens).
"""
from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
import re
import time as _time
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

import events_gate as gate
import events_legacy as legacy
import events_runtime as runtime
import events_sources as sources
import telegram_alerts
from events_time import BOGOTA
from partner_visibility import PUBLIC_PARTNER_FILTER

logger = logging.getLogger("events")

router = APIRouter()

db: Any = None
_require_admin: Optional[Callable[[Request], Awaitable[Dict[str, Any]]]] = None

# ── constants ────────────────────────────────────────────────────────────────

RUN_BUDGET_S = 40.0          # §7: hard budget per invocation (Vercel maxDuration is 60 s)
DISPATCH_BUDGET_S = 30.0     # §13 F2: nothing new is dispatched after 30 s
LEASE_S = 55                 # §13 F3
EVIDENCE_MAX = 6             # §2
REJECTS_PER_RUN = 60
ALERT_MAX_LINES = 15
ENRICH_MAX_ROWS = 3          # §7
ENRICH_TIMEOUT_S = 20.0
ENRICH_MAX_ATTEMPTS = 3
ENRICH_MODEL = "claude-haiku-4-5"
SENTINEL_MAX_ROWS = 400
GONE_MIN_GAP = timedelta(hours=6)       # §13 G: 2nd strike ≥ 6 h after the first
GONE_REVIVE_DAYS = 7                    # §13 G: source_gone rows rechecked daily for 7 days
BLOCKED_DECAY_DAYS = 3                  # §13 G / §15 S3
NOT_FOUND_REVIEW = 2                    # §15 S3: twice in a row → review/source_changed
PRIORITY_WINDOW = timedelta(hours=48)   # §15 S3 priority order
REMINDER_LEAD_MIN = (30, 180)           # §13 H1: [start−180, start−30] minutes
REMINDER_HOURS = ("09:00", "21:00")     # §7 quiet window (Bogotá)
REMINDER_MAX_USERS = 300
# Outer cap per channel. Must exceed each channel's own worst case — Expo's httpx client timeout
# (push.EXPO_PUSH_TIMEOUT, 10 s) and webpush.TOTAL_TIMEOUT_S (6 s) — so a channel normally returns
# its own (partial) count; hitting this cap means the outcome is UNKNOWN, never "not sent".
PUSH_TIMEOUT_S = 12.0
EXPO_LIMITS = (120, 240)                # §13 H5 title / body
WEB_LIMITS = (80, 160)
RESERVED_EVENT_IDS = frozenset({"feed", "featured", "dates"})   # §13 C1
LIVE_STATUSES = ("published", "date_tbc")
FAVORITE_EVENT_TYPES = ("event", "concert")
LEGACY_IMPORT_MAX_SPAN_DAYS = 30
PROD_CLUSTER_HOST = "cluster0.i4uvhfv"
DEFAULT_ADMIN_ORIGINS = ("https://www.amocartagena.co", "https://amocartagena.co")
FLAG_KEYS = frozenset({"enabled", "sources_disabled"})
PREF_LANGS = ("es", "en", "fr", "pt")
DEFAULT_PREFS: Dict[str, Any] = {
    "reminders_enabled": True, "nearby_enabled": False,
    "categories": list(gate.CATEGORIES), "lang": "es",
}
CLEARABLE_BY_AGREEMENT = frozenset({"date_changed", "conflict"})
# Review rows the sentinel still rechecks: R1 clearing by agreement, and legacy imports gaining evidence.
SENTINEL_REVIEW_REASONS = ("date_changed", "conflict", "legacy_unverified")

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
ANCHORS_PATH = os.path.join(DATA_DIR, "events_anchors.json")
GAZETTEER_PATH = os.path.join(DATA_DIR, "events_gazetteer.json")

RecheckFn = Callable[..., Awaitable[Dict[str, Any]]]
ClientFactory = Callable[[], Any]
PushFn = Callable[..., Awaitable[Dict[str, Any]]]


def init(*, db_: Any, require_admin: Callable[[Request], Awaitable[Dict[str, Any]]]) -> None:
    global db, _require_admin
    db = db_
    _require_admin = require_admin


# ── time helpers ─────────────────────────────────────────────────────────────


def _now(now: Optional[datetime] = None) -> datetime:
    return gate.as_utc(now)


def _iso(dt: datetime) -> str:
    return gate.iso_utc(dt)


def _today(now: datetime) -> str:
    return gate.bogota_today(now)


def _bogota(now: datetime) -> datetime:
    return gate.bogota_now(now)


def _run_id(kind: str, now: datetime) -> str:
    return f"{kind}-{now.strftime('%Y%m%dT%H%M%S')}-{uuid.uuid4().hex[:6]}"


def _as_map(v: Any) -> Mapping[str, Any]:
    return v if isinstance(v, Mapping) else {}


def _es(v: Any) -> str:
    if isinstance(v, Mapping):
        s = v.get("es")
        return s.strip() if isinstance(s, str) else ""
    return v.strip() if isinstance(v, str) else ""


def _int(v: Any, default: int = 0) -> int:
    if isinstance(v, bool):
        return default
    if isinstance(v, int):
        return v
    return default


# ── auth (§15 X1/X2) ─────────────────────────────────────────────────────────


def _bearer(request: Request) -> Optional[str]:
    h = request.headers.get("authorization") or ""
    if h[:7].lower() == "bearer ":
        tok = h[7:].strip()
        return tok or None
    return None


def is_cron(request: Request) -> bool:
    """Bearer CRON_SECRET, constant-time (§15 X1)."""
    secret = os.environ.get("CRON_SECRET", "").strip()
    tok = _bearer(request)
    return bool(secret) and tok is not None and hmac.compare_digest(tok.encode(), secret.encode())


ADMIN_TOKEN_MIN_LEN = 32   # §16.4 mints 48 random bytes; a short/placeholder value never authenticates
ADMIN_TOKEN_ACTOR = "admin:token"


def is_events_admin_token(request: Request) -> bool:
    """§16.4: Bearer EVENTS_ADMIN_TOKEN (the operator's token for the events admin + cron
    routes), constant-time. Header ONLY — never a cookie, so a cross-site request can never
    carry it (no CSRF surface). Unset or shorter than 32 chars → never matches."""
    secret = os.environ.get("EVENTS_ADMIN_TOKEN", "").strip()
    tok = _bearer(request)
    if len(secret) < ADMIN_TOKEN_MIN_LEN or tok is None:
        return False
    return hmac.compare_digest(tok.encode(), secret.encode())


def _token_admin() -> Dict[str, Any]:
    return {"user_id": "events-admin-token", "is_admin": True, "via": "EVENTS_ADMIN_TOKEN"}


def admin_origins() -> Set[str]:
    raw = [o.strip().rstrip("/") for o in (os.environ.get("EVENTS_ADMIN_ORIGINS", "") + ","
                                          + os.environ.get("CORS_ALLOWED_ORIGINS", "")).split(",")]
    return {o for o in raw if o.startswith("https://")} | set(DEFAULT_ADMIN_ORIGINS)


async def _user_for_session_token(token: str) -> Optional[Dict[str, Any]]:
    """The session's user for an explicit Bearer token (mirrors server.get_current_user, but
    never falls back to the cookie: X2's header path must be the header's own session)."""
    try:
        session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
        if not isinstance(session, Mapping):
            return None
        exp = session.get("expires_at")
        exp_dt = gate.parse_iso(exp) if not isinstance(exp, datetime) else gate.as_utc(exp)
        if exp_dt is None or exp_dt < datetime.now(timezone.utc):
            return None
        user = await db.users.find_one({"user_id": session.get("user_id")}, {"_id": 0})
        return dict(user) if isinstance(user, Mapping) else None
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] admin session lookup failed: %s", type(exc).__name__)
        return None


async def require_admin_mutation(request: Request) -> Dict[str, Any]:
    """§15 X2: a Bearer admin session token, or the session cookie + an allowlisted Origin +
    X-AMO-Admin: 1 (so a cross-site form post can never mutate). §16.4: Bearer
    EVENTS_ADMIN_TOKEN is accepted too (header only)."""
    if is_events_admin_token(request):
        return _token_admin()
    tok = _bearer(request)
    if tok:
        user = await _user_for_session_token(tok)
        if not user:
            raise HTTPException(status_code=401, detail="Not authenticated")
        if not user.get("is_admin"):
            raise HTTPException(status_code=403, detail="Admin only")
        return user
    if not request.cookies.get("session_token"):
        raise HTTPException(status_code=401, detail="Not authenticated")
    origin = (request.headers.get("origin") or "").rstrip("/")
    if origin not in admin_origins() or request.headers.get("x-amo-admin") != "1":
        raise HTTPException(status_code=403, detail="Admin mutation requires an allowed Origin and X-AMO-Admin: 1")
    if _require_admin is None:
        raise HTTPException(status_code=503, detail="events admin not initialised")
    return await _require_admin(request)


async def require_admin_read(request: Request) -> Dict[str, Any]:
    if is_events_admin_token(request):
        return _token_admin()
    if _require_admin is None:
        raise HTTPException(status_code=503, detail="events admin not initialised")
    return await _require_admin(request)


async def _run_auth(request: Request) -> Tuple[str, bool]:
    """Cron routes (pull / enrich / sentinel / reminders) accept ONLY Bearer CRON_SECRET
    (§15 X1) or Bearer EVENTS_ADMIN_TOKEN (§16.4): no admin session, no cookie, so a
    cross-site GET can never start a run. ?dry=1 writes nothing, ?source= narrows a pull (§7)."""
    dry = request.query_params.get("dry") == "1"
    if is_cron(request):
        return "cron", dry
    if is_events_admin_token(request):
        return ADMIN_TOKEN_ACTOR, dry
    raise HTTPException(status_code=401 if _bearer(request) is None else 403,
                        detail="cron routes require Bearer CRON_SECRET or EVENTS_ADMIN_TOKEN")


async def _json_body(request: Request) -> Dict[str, Any]:
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 — empty / malformed body
        return {}
    return body if isinstance(body, dict) else {}


# ── indexes (§2, §13 K) ──────────────────────────────────────────────────────

_indexes_ok = False


async def ensure_events_indexes(db_: Any = None) -> bool:
    """Create every EVENTS-ELITE index (idempotent; each in its own try so one failure never
    blocks the rest) and confirm the unique event_id / canonical_key indexes exist. Runs once
    per instance once it succeeds (§13 K2)."""
    global _indexes_ok
    if _indexes_ok:
        return True
    d = db_ if db_ is not None else db
    if d is None:
        return False
    specs: List[Tuple[str, Any, Dict[str, Any]]] = [
        ("city_events", "event_id", {"unique": True}),
        ("city_events", "canonical_key", {"unique": True}),
        ("city_events", "source_keys", {"unique": True, "sparse": True}),
        ("city_events", "aliases", {"sparse": True}),
        ("city_events", "status", {}),
        ("city_events", "start_date", {}),
        ("city_events", [("status", 1), ("start_date", 1)], {}),
        ("city_events", [("status", 1), ("last_verified", 1)], {}),
        ("city_events", "parent_id", {}),
        ("city_events", [("geo", "2dsphere")], {"sparse": True}),
        ("city_events_log", [("event_id", 1), ("at", -1)], {}),
        ("city_events_runs", [("kind", 1), ("started_at", -1)], {}),
        ("city_events_runs", [("kind", 1), ("done", 1), ("finished_at", -1)], {}),
        ("city_events_rejects", "at_dt", {"expireAfterSeconds": 30 * 24 * 3600}),
        ("event_push_log", [("user_id", 1), ("date", 1)], {"unique": True}),
        ("event_reminders_sent", [("user_id", 1), ("event_id", 1)], {"unique": True}),
        ("event_notif_prefs", "user_id", {"unique": True}),
        ("favorites", [("item_type", 1), ("item_id", 1)], {}),
    ]
    for coll, keys, opts in specs:
        try:
            await getattr(d, coll).create_index(keys, **opts)
        except Exception as exc:  # noqa: BLE001
            logger.error("[events] create_index %s %s failed: %s", coll, keys, type(exc).__name__)
    try:
        info = await d.city_events.index_information()
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] index_information failed: %s", type(exc).__name__)
        return False
    have = {tuple(k for k, _ in (v.get("key") or [])) for v in (info or {}).values() if v.get("unique")}
    ok = ("event_id",) in have and ("canonical_key",) in have
    if not ok:
        logger.error("[events] unique indexes on event_id/canonical_key missing: writers refuse")
    _indexes_ok = ok
    return ok


async def _writer_guard(db_: Any) -> None:
    if not await ensure_events_indexes(db_):
        if await _alert_once(db_, _today(_now()), "indexes_missing"):
            await _alert(["⚠️ EVENTS: faltan los índices únicos de city_events; escrituras bloqueadas (503)."])
        raise HTTPException(status_code=503, detail="city_events unique indexes missing")


# ── alerts / logs ────────────────────────────────────────────────────────────


async def _alert(lines: Sequence[str], *, title: str = "AMO · Agenda") -> None:
    """One instant Telegram message for a batch of lines (§7). Never raises."""
    items = [str(x) for x in lines if x]
    if not items:
        return
    extra = len(items) - ALERT_MAX_LINES
    body = items[:ALERT_MAX_LINES] + ([f"… y {extra} más"] if extra > 0 else [])
    try:
        await telegram_alerts.send(title + "\n" + "\n".join(body))
    except Exception as exc:  # noqa: BLE001 — telegram_alerts never raises; belt and braces
        logger.error("[events] alert failed: %s", type(exc).__name__)


async def _alert_once(db_: Any, day: str, key: str) -> bool:
    """True the first time `key` is seen on `day` (per-day alert dedupe across invocations)."""
    try:
        res = await db_.city_events_state.update_one(
            {"_id": f"alerts:{day}", "keys": {"$ne": key}},
            {"$push": {"keys": key}, "$setOnInsert": {"day": day}}, upsert=True)
        return bool(getattr(res, "modified_count", 0) or getattr(res, "upserted_id", None))
    except DuplicateKeyError:
        return False
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] alert dedupe failed: %s", type(exc).__name__)
        return False


async def _log(db_: Any, event_id: Optional[str], actor: str, frm: Any, to: Any, reason: Optional[str],
               detail: Any = None, now: Optional[datetime] = None) -> None:
    """city_events_log: every state change (§2). Fail-soft."""
    n = _now(now)
    try:
        await db_.city_events_log.insert_one({
            "event_id": event_id, "at": _iso(n), "at_dt": n, "actor": actor,
            "from": frm, "to": to, "reason": reason, "detail": detail,
        })
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] log write failed: %s", type(exc).__name__)


async def _reject(db_: Any, ctx: "PullCtx", c: Mapping[str, Any], reason: str, signals: Sequence[str] = ()) -> None:
    if ctx.dry or ctx.rejects_written >= REJECTS_PER_RUN:
        return
    ctx.rejects_written += 1
    try:
        await db_.city_events_rejects.insert_one({
            "at": _iso(ctx.now), "at_dt": ctx.now, "run_id": ctx.run_id,
            "source": c.get("source_key"), "url": c.get("source_url"), "title": _es(c.get("title"))[:200],
            "start_date": c.get("start_date"), "reason": reason, "signals": list(signals)[:30],
        })
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] reject write failed: %s", type(exc).__name__)


def _title_line(doc: Mapping[str, Any]) -> str:
    t = _es(doc.get("title")) or str(doc.get("event_id") or "?")
    return t[:80]


# ── evidence / geo helpers ───────────────────────────────────────────────────


def _url_key(u: str) -> str:
    try:
        p = urlsplit(u.strip())
    except ValueError:
        return u.strip()
    return f"{(p.hostname or '').lower()}{p.path.rstrip('/')}?{p.query}"


def merge_evidence(existing: Iterable[Any], new: Iterable[Any], cap: int = EVIDENCE_MAX) -> List[Dict[str, Any]]:
    """Newest entry per URL (the gate counts only that one, §15 R2), newest first, ≤ cap."""
    floor = datetime(1970, 1, 1, tzinfo=timezone.utc)
    best: Dict[str, Tuple[datetime, Dict[str, Any]]] = {}
    for e in list(existing or []) + list(new or []):
        if not isinstance(e, Mapping) or not gate.is_http_url(e.get("url")):
            continue
        k = _url_key(str(e["url"]))
        fa = gate.parse_iso(e.get("fetched_at")) or floor
        if k not in best or fa >= best[k][0]:
            best[k] = (fa, dict(e))
    ordered = sorted(best.values(), key=lambda x: x[0], reverse=True)
    return [e for _, e in ordered[:cap]]


def _newest_for(doc: Mapping[str, Any], url: str) -> Optional[Dict[str, Any]]:
    k = _url_key(url)
    rows = [e for e in (doc.get("evidence") or []) if isinstance(e, Mapping) and gate.is_http_url(e.get("url"))
            and _url_key(str(e["url"])) == k]
    if not rows:
        return None
    rows.sort(key=lambda e: gate.parse_iso(e.get("fetched_at")) or datetime(1970, 1, 1, tzinfo=timezone.utc),
              reverse=True)
    return dict(rows[0])


def _valid_geo(lat: Any, lng: Any) -> bool:
    try:
        la, ln = float(lat), float(lng)
    except (TypeError, ValueError):
        return False
    if la == 0 and ln == 0:
        return False
    return gate.in_distrito(la, ln) and not gate.is_placeholder_coord(la, ln)


def _zone(lat: Any, lng: Any) -> Optional[str]:
    try:
        from local_signals import _nearest_neighborhood  # pure helper, fastapi-only import
        z = _nearest_neighborhood(lat, lng)
        return z if isinstance(z, str) else None
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] zone lookup failed: %s", type(exc).__name__)
        return None


def _geo_fields(geo: Optional[Mapping[str, Any]], *, umbrella: bool) -> Tuple[Dict[str, Any], List[str]]:
    """$set / $unset for coordinates. Umbrellas and ungeocoded rows carry lat/lng null and no
    `geo` (the 2dsphere index is sparse; never write geo: null)."""
    if umbrella or not geo or not _valid_geo(geo.get("lat"), geo.get("lng")):
        return ({"lat": None, "lng": None, "geocode_source": None, "zone": None}, ["geo"])
    lat, lng = float(geo["lat"]), float(geo["lng"])
    return ({"lat": lat, "lng": lng, "geocode_source": geo.get("geocode_source"),
             "venue_id": geo.get("venue_id"), "zone": _zone(lat, lng),
             "geo": {"type": "Point", "coordinates": [lng, lat]}}, [])


def load_gazetteer() -> List[Dict[str, Any]]:
    try:
        with open(GAZETTEER_PATH, encoding="utf-8") as f:
            rows = json.load(f)
        return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] gazetteer unavailable: %s", type(exc).__name__)
        return []


def load_anchors_file() -> Tuple[Optional[int], List[Dict[str, Any]]]:
    """(anchors_version, anchors) from backend/data/events_anchors.json. The file is
    {"anchors_version": N, "anchors": [...]} (§16.4); a bare list (pre-§16) reads as version
    None. Unreadable → (None, [])."""
    try:
        with open(ANCHORS_PATH, encoding="utf-8") as f:
            raw = json.load(f)
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] anchors unavailable: %s", type(exc).__name__)
        return None, []
    if isinstance(raw, list):
        return None, [r for r in raw if isinstance(r, dict)]
    if isinstance(raw, dict):
        rows = raw.get("anchors")
        ver = raw.get("anchors_version")
        version = ver if isinstance(ver, int) and not isinstance(ver, bool) else None
        return version, [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []
    return None, []


def load_anchors() -> List[Dict[str, Any]]:
    return load_anchors_file()[1]


async def load_catalog(db_: Any) -> List[Dict[str, Any]]:
    """Approved catalog partners with coordinates (geocode source #1)."""
    try:
        cur = db_.partners.find(
            dict(PUBLIC_PARTNER_FILTER),
            {"_id": 0, "partner_id": 1, "name": 1, "aliases": 1, "address": 1, "location": 1, "lat": 1, "lng": 1, "geo": 1},
        )
        rows = await cur.to_list(length=5000)
        return [dict(r) for r in rows or [] if isinstance(r, Mapping)]
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] catalog load failed: %s", type(exc).__name__)
        return []


def _apply_eval(doc: Mapping[str, Any], now: datetime) -> Dict[str, Any]:
    ev = gate.evaluate(doc, now)
    return {"status": ev["status"], "status_reason": ev["status_reason"],
            "confidence": ev["confidence"], "notif_eligible": ev["notif_eligible"]}


# ── cursor lease (§13 F3) ────────────────────────────────────────────────────


async def _claim(db_: Any, cid: str, now: datetime, run_id: str) -> Optional[Dict[str, Any]]:
    """Claim the cursor lease; None when another invocation holds it."""
    now_iso = _iso(now)
    try:
        doc = await db_.city_events_state.find_one_and_update(
            {"_id": cid, "$or": [{"lease_until": {"$lt": now_iso}}, {"lease_until": {"$exists": False}},
                                 {"lease_until": None}]},
            {"$set": {"lease_until": _iso(now + timedelta(seconds=LEASE_S)), "run_id": run_id, "lease_at": now_iso}},
            upsert=True, return_document=ReturnDocument.AFTER)
    except DuplicateKeyError:
        return None
    return dict(doc) if isinstance(doc, Mapping) else None


async def _save_cursor(db_: Any, cid: str, run_id: str, fields: Mapping[str, Any]) -> None:
    try:
        await db_.city_events_state.update_one({"_id": cid, "run_id": run_id}, {"$set": dict(fields)})
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] cursor save failed: %s", type(exc).__name__)


async def _write_run(db_: Any, row: Dict[str, Any]) -> None:
    try:
        await db_.city_events_runs.insert_one(dict(row))
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] run ledger write failed: %s", type(exc).__name__)


def _run_row(kind: str, run_id: str, started: datetime, actor: str, **kw: Any) -> Dict[str, Any]:
    t0 = kw.pop("t0", None)
    elapsed = max(0.0, _time.monotonic() - t0) if isinstance(t0, float) else 0.0
    fin = started + timedelta(seconds=elapsed)   # the invocation's own clock (tests pin `now`)
    row: Dict[str, Any] = {"run_id": run_id, "kind": kind, "actor": actor,
           "started_at": _iso(started), "started_at_dt": started,
           "finished_at": _iso(fin), "finished_at_dt": fin, "done": False, "errors": []}
    row.update(kw)
    row["errors"] = list(row.get("errors") or [])[:30]
    return row


# ═════════════════════════════════════════════════════════════════════════════
# PULL (§7, §13 A/F, §15 P/Q)
# ═════════════════════════════════════════════════════════════════════════════

PULL_COUNTS = ("found", "published", "held_review", "date_tbc", "dropped_no_source", "dropped_wrong_country",
               "dropped_past", "dropped_other", "dupes_merged", "updated", "corroborated", "inserted")


class PullCtx:
    def __init__(self, db_: Any, now: datetime, run_id: str, *, dry: bool,
                 catalog: List[Dict[str, Any]], gazetteer: List[Dict[str, Any]]) -> None:
        self.db = db_
        self.now = now
        self.today = _today(now)
        self.run_id = run_id
        self.dry = dry
        self.catalog = catalog
        self.gazetteer = gazetteer
        self.counts: Dict[str, int] = {k: 0 for k in PULL_COUNTS}
        self.alerts: List[str] = []
        self.results: List[Dict[str, Any]] = []
        self.errors: List[str] = []
        self.rejects_written = 0

    def bump(self, key: str, n: int = 1) -> None:
        self.counts[key] = self.counts.get(key, 0) + n


def _cand_tier(c: Mapping[str, Any]) -> int:
    t = gate.domain_tier(c.get("source_url"), c.get("source_tier"))
    return t if isinstance(t, int) else 6


def _cand_fetched(c: Mapping[str, Any]) -> Optional[str]:
    ev = (c.get("evidence") or [None])[0]
    fa = ev.get("fetched_at") if isinstance(ev, Mapping) else None
    return fa if isinstance(fa, str) and gate.parse_iso(fa) else None


def _ranges_overlap(a0: Any, a1: Any, b0: Any, b1: Any) -> bool:
    """Inclusive ISO-date range overlap; False when either side has no start."""
    if not isinstance(a0, str) or not isinstance(b0, str):
        return False
    a1 = a1 if isinstance(a1, str) else a0
    b1 = b1 if isinstance(b1, str) else b0
    return a0 <= b1 and a1 >= b0


def _cand_denylist(c: Mapping[str, Any]) -> Tuple[str, ...]:
    key = c.get("source_key")
    for e in sources.SOURCES:
        if e.get("key") == key:
            return tuple(getattr(e.get("adapter"), "denylist", ()) or ())
    return ()


def _candidate_notice(c: Mapping[str, Any], doc: Optional[Mapping[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """notice_announcement() of a candidate's event-scoped text (its source's boilerplate stripped)."""
    ref = gate._ymd(c.get("start_date")) or gate._ymd((doc or {}).get("start_date"))  # noqa: SLF001
    return sources.notice_announcement(str(c.get("event_text") or ""), ref_year=ref.year if ref else None,
                                       denylist=_cand_denylist(c))


def _announced_time(c: Mapping[str, Any], ann: Mapping[str, Any]) -> Optional[str]:
    t = ann.get("start_time")
    same_block = (c.get("start_date"), c.get("end_date") or c.get("start_date")) == \
        (ann.get("start_date"), ann.get("end_date") or ann.get("start_date"))
    if not t and same_block and c.get("time_confirmed"):
        t = c.get("start_time")
    return t if isinstance(t, str) else None


def _announced_evidence(c: Mapping[str, Any], ann: Mapping[str, Any]) -> List[Dict[str, Any]]:
    """The candidate's evidence restated as what its page ANNOUNCES: the quote becomes the
    verbatim notice line (which states those dates), never the 'Fecha original' date the adapter
    may have parsed first. The gate counts the newest entry per URL, so this is what lets an
    approval of the announced dates publish (and a later re-pull agree with them)."""
    start, end = ann["start_date"], ann.get("end_date") or ann["start_date"]
    evs = [dict(e) for e in (c.get("evidence") or []) if isinstance(e, Mapping)]
    if evs:
        evs[0].update(start_date=start, end_date=end, start_time=_announced_time(c, ann),
                      date_text=ann.get("quote") or evs[0].get("date_text"))
    return evs


def _with_announced(c: Mapping[str, Any], ann: Mapping[str, Any]) -> Dict[str, Any]:
    """The candidate restated with the dates its notice announces (see _announced_evidence)."""
    out = dict(c)
    start, end = ann["start_date"], ann.get("end_date") or ann["start_date"]
    same_block = (c.get("start_date"), c.get("end_date") or c.get("start_date")) == (start, end)
    t = _announced_time(c, ann)
    out.update(start_date=start, end_date=end, start_time=t, time_confirmed=bool(t))
    if not same_block:
        out["end_time"] = None
    out["evidence"] = _announced_evidence(c, ann)
    out["markers"] = {**_as_map(c.get("markers")), "date_notice": None}
    return out


def _base_key(c: Mapping[str, Any]) -> Optional[str]:
    title = _es(c.get("title"))
    ey = c.get("edition_year") if isinstance(c.get("edition_year"), int) else gate.edition_year_from(
        title, c.get("start_date"))
    if not title or ey is None:
        return None
    try:
        return gate.match_key(title, ey, c.get("venue_name") or "")
    except ValueError:
        return None


def _geocode_candidate(ctx: PullCtx, c: Mapping[str, Any], umbrella: bool) -> Optional[Dict[str, Any]]:
    if umbrella:
        return None
    hit = gate.geocode(c.get("venue_name"), c.get("address"), ctx.catalog, ctx.gazetteer)
    if hit is not None:
        return hit
    if c.get("geocode_source") == "source" and _valid_geo(c.get("lat"), c.get("lng")):
        return {"lat": float(c["lat"]), "lng": float(c["lng"]), "geocode_source": "source", "venue_id": None}
    return None


def _country_input(c: Mapping[str, Any], geo: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    return {
        "source_url": c.get("source_url"), "final_url": (c.get("context") or {}).get("final_url")
        if isinstance(c.get("context"), Mapping) else None,
        "page_text": c.get("page_text"), "event_text": c.get("event_text"),
        "ld_location": c.get("ld_location"), "tz_offset": c.get("tz_offset"), "currency": c.get("currency"),
        "country_iso": c.get("country_iso"), "venue_name": c.get("venue_name"), "address": c.get("address"),
        "lat": (geo or {}).get("lat") if geo else c.get("lat"),
        "lng": (geo or {}).get("lng") if geo else c.get("lng"),
        "geocode_source": (geo or {}).get("geocode_source") if geo else None,
        "venue_ambiguous": (geo or {}).get("venue_ambiguous") is True if geo else False,
    }


def doc_from_candidate(c: Mapping[str, Any], *, key: str, geo: Optional[Mapping[str, Any]], verdict: str,
                       signals: Sequence[str], now: datetime, umbrella: bool,
                       parent_id: Optional[str] = None) -> Dict[str, Any]:
    """A new city_events doc from a Candidate: only what the page stated (§0). event_id is
    minted by the caller ($setOnInsert, §15 P2)."""
    title = _es(c.get("title"))
    tier = _cand_tier(c)
    set_geo, _ = _geo_fields(geo, umbrella=umbrella)
    start = c.get("start_date") if isinstance(c.get("start_date"), str) else None
    ey = c.get("edition_year") if isinstance(c.get("edition_year"), int) else gate.edition_year_from(title, start)
    cat = c.get("category") if c.get("category") in gate.CATEGORIES else "cultural"
    doc: Dict[str, Any] = {
        "canonical_key": key, "match_key": key, "key_history": [],
        "title": {"es": title}, "description": {}, "category": cat,
        "start_date": start, "end_date": c.get("end_date") or start,
        "start_time": c.get("start_time") if isinstance(c.get("start_time"), str) else None,
        "end_time": c.get("end_time") if isinstance(c.get("end_time"), str) else None,
        "time_confirmed": bool(c.get("time_confirmed")), "edition_year": ey,
        "date_tbc_note": None, "tbc_window_end": None,
        "venue_name": c.get("venue_name") or "", "venue_id": None, "address": c.get("address"),
        "price": dict(c.get("price") or {}), "ticket_url": c.get("ticket_url"),
        "source_url": c.get("source_url"), "source_name": c.get("source_name") or gate.registrable_domain(c.get("source_url")),
        "source_tier": tier, "source_key": c.get("source_key"),
        "second_source_url": None, "second_source_name": None, "second_source_tier": None,
        "source_keys": list(c.get("source_keys") or []), "recheck_url": c.get("recheck_url") or c.get("source_url"),
        "detail_url": c.get("detail_url"),
        "evidence": merge_evidence([], c.get("evidence") or []),
        # We fetched this page right now and parsed the date from it: that is a verification.
        "last_verified": _cand_fetched(c) or _iso(now), "verified_by": "pipeline",
        "country_check": verdict, "country_signals": list(signals)[:40],
        "image_url": None, "image_credit": None, "parent_id": parent_id, "origin": "pipeline",
        "sold_out": bool(c.get("sold_out")), "is_umbrella": bool(umbrella),
        "blocked_days": 0, "not_found_count": 0, "gone_strikes": 0,
        "event_text": str(c.get("event_text") or "")[:2000],
        "llm_text_ok": bool((sources.SOURCES_BY_KEY.get(str(c.get("source_key"))) or {}).get("llm_text_ok", True)),
        "date_history": [], "created_at": _iso(now), "updated_at": _iso(now),
    }
    doc.update(set_geo)
    if doc["lat"] is None:
        doc.pop("geo", None)
    if not doc["source_keys"]:
        # Real Mongo indexes an empty array under the unique multikey index (sparse does not
        # skip it), so a second keyless row would E11000. Omit the field instead.
        doc.pop("source_keys")
    return doc


def _mint_id(doc: Mapping[str, Any]) -> str:
    title = _es(doc.get("title"))
    key = str(doc.get("canonical_key"))
    if doc.get("start_date"):
        return gate.make_event_id(title, key, start_date=str(doc["start_date"]))
    twe = gate._ymd(doc.get("tbc_window_end"))  # noqa: SLF001 — pure date parse
    if twe is None:
        raise ValueError("date_tbc row without tbc_window_end")
    return gate.make_event_id(title, key, tbc_year=twe.year, tbc_month=twe.month)


async def _find_existing(db_: Any, c: Mapping[str, Any], key: str) -> Optional[Dict[str, Any]]:
    sk = [k for k in (c.get("source_keys") or []) if isinstance(k, str)]
    try:
        if sk:
            doc = await db_.city_events.find_one({"source_keys": {"$in": sk}}, {"_id": 0})
            if isinstance(doc, Mapping):
                return dict(doc)
        doc = await db_.city_events.find_one({"canonical_key": key}, {"_id": 0})
        if isinstance(doc, Mapping):
            return dict(doc)
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] match lookup failed: %s", type(exc).__name__)
    return None


_SAME_POINT_DEG = 0.0015   # ~150 m: two geocodes this close are one venue


def _venue_compatible(doc: Mapping[str, Any], c: Mapping[str, Any], geo: Optional[Mapping[str, Any]]) -> bool:
    """False only when BOTH sides name a single, known venue and nothing ties them together
    (no shared venue key, no shared catalog id, geocodes > ~150 m apart). A fuzzy merge across
    two venues would pool another event's evidence into this row and could lift it to HIGH
    (§15 R2 b): prefer a duplicate row (honest, both sourced) over a wrong merge (§0)."""
    dk, ck = set(gate.venue_keys(doc.get("venue_name"))), set(gate.venue_keys(c.get("venue_name")))
    if not dk or not ck or dk & ck:
        return True    # unknown / multi-venue on either side cannot disprove; a shared key agrees
    if geo is not None:
        vid = geo.get("venue_id")
        if vid and vid == doc.get("venue_id"):
            return True
        try:
            if abs(float(doc["lat"]) - float(geo["lat"])) <= _SAME_POINT_DEG and \
                    abs(float(doc["lng"]) - float(geo["lng"])) <= _SAME_POINT_DEG:
                return True
        except (KeyError, TypeError, ValueError):
            pass
    return False


async def _find_fuzzy(db_: Any, c: Mapping[str, Any], *, same_dates: bool,
                      geo: Optional[Mapping[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """Same start_date (and end_date when `same_dates`) + ≥ 0.75 title overlap + a compatible
    venue, unique. Used for corroboration rows and to avoid a duplicate of an anchor under a
    different venue string."""
    start = c.get("start_date")
    if not isinstance(start, str):
        return None
    q: Dict[str, Any] = {"start_date": start, "status": {"$ne": "hidden"}}
    if same_dates:
        q["end_date"] = c.get("end_date") or start
    try:
        rows = await db_.city_events.find(q, {"_id": 0}).to_list(length=50)
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] fuzzy lookup failed: %s", type(exc).__name__)
        return None
    title = _es(c.get("title"))
    hits = []
    for r in rows or []:
        score = max(sources.title_overlap(_es(r.get("title")), title), sources.title_overlap(title, _es(r.get("title"))))
        if score >= 0.75 and _venue_compatible(r, c, geo):
            hits.append((score, dict(r)))
    if not hits:
        return None
    hits.sort(key=lambda x: -x[0])
    if len(hits) > 1 and hits[0][0] == hits[1][0]:
        return None  # ambiguous: never guess
    return hits[0][1]


async def _parent_for(db_: Any, c: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    psk = c.get("parent_source_key")
    if not isinstance(psk, str) or not psk:
        return None
    try:
        doc = await db_.city_events.find_one({"source_keys": psk}, {"_id": 0})
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] parent lookup failed: %s", type(exc).__name__)
        return None
    return dict(doc) if isinstance(doc, Mapping) else None


async def _mark_umbrella(ctx: PullCtx, parent: Mapping[str, Any]) -> None:
    if ctx.dry or parent.get("is_umbrella"):
        return
    try:
        await ctx.db.city_events.update_one(
            {"event_id": parent["event_id"]},
            {"$set": {"is_umbrella": True, "lat": None, "lng": None, "geocode_source": None, "zone": None,
                      "updated_at": _iso(ctx.now)}, "$unset": {"geo": ""}})
        await _log(ctx.db, parent["event_id"], "pipeline", None, None, "is_umbrella", "child references it", ctx.now)
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] umbrella mark failed: %s", type(exc).__name__)


async def _add_source_keys(db_: Any, event_id: str, keys: Sequence[str]) -> None:
    for k in keys:
        try:
            await db_.city_events.update_one({"event_id": event_id}, {"$addToSet": {"source_keys": k}})
        except DuplicateKeyError:
            logger.error("[events] source key already owned by another row (kept there)")
        except Exception as exc:  # noqa: BLE001
            logger.error("[events] source key add failed: %s", type(exc).__name__)


async def _write_status(ctx_db: Any, doc: Mapping[str, Any], new_fields: Dict[str, Any], *, actor: str,
                        now: datetime, unset: Sequence[str] = (), push: Optional[Dict[str, Any]] = None,
                        alerts: Optional[List[str]] = None, log_detail: Any = None) -> Tuple[Dict[str, Any], bool]:
    """Evaluate doc+new_fields, write fields + status caches, log a status change, queue an
    alert on unpublish. Returns (merged doc, status_changed)."""
    merged = dict(doc)
    merged.update(new_fields)
    for k in unset:
        merged.pop(k, None)
    ev = _apply_eval(merged, now)
    if ev["status"] == "drop":
        ev = {"status": "hidden", "status_reason": "no_source", "confidence": "VERIFY", "notif_eligible": False}
    merged.update(ev)
    upd: Dict[str, Any] = {"$set": {**new_fields, **ev, "updated_at": _iso(now)}}
    if unset:
        upd["$unset"] = {k: "" for k in unset}
    if push:
        upd["$push"] = push
    await ctx_db.city_events.update_one({"event_id": doc["event_id"]}, upd)
    changed = (doc.get("status"), doc.get("status_reason")) != (ev["status"], ev["status_reason"])
    if changed:
        await _log(ctx_db, doc["event_id"], actor, doc.get("status"), ev["status"], ev["status_reason"], log_detail, now)
        if alerts is not None and doc.get("status") in LIVE_STATUSES and ev["status"] not in LIVE_STATUSES \
                and ev["status"] != "expired":
            alerts.append(f"⛔ {_title_line(doc)} → {ev['status']} ({ev['status_reason']})")
    return merged, changed


async def process_candidate(ctx: PullCtx, c: Mapping[str, Any], *, role: str, perf: bool) -> str:
    """One Candidate through normalize → geocode → country gate → match/dedupe (§15 P) →
    evaluate → upsert. Returns the outcome label."""
    ctx.bump("found")
    title = _es(c.get("title"))
    src_url = c.get("source_url")
    if not title or not gate.is_http_url(src_url) or gate.registrable_domain(src_url) in gate.DENY_DOMAINS:
        ctx.bump("dropped_no_source")
        await _reject(ctx.db, ctx, c, "no_source")
        return "dropped_no_source"
    start = c.get("start_date")
    end = c.get("end_date") or start
    if not isinstance(start, str) or gate._ymd(start) is None or gate._ymd(end) is None:  # noqa: SLF001
        ctx.bump("dropped_other")
        await _reject(ctx.db, ctx, c, "no_date")
        return "no_date"
    if str(end) < ctx.today:
        ctx.bump("dropped_past")
        return "dropped_past"
    base = _base_key(c)
    if base is None:
        ctx.bump("dropped_other")
        await _reject(ctx.db, ctx, c, "no_edition_year")
        return "no_edition_year"
    key = f"{base}|{start.replace('-', '')}" if perf else base
    umbrella = bool(c.get("is_umbrella_hint"))
    geo = _geocode_candidate(ctx, c, umbrella)
    verdict, signals = gate.country_check(_country_input(c, geo))
    existing = await _find_existing(ctx.db, c, key)
    same_source = existing is not None and bool(set(existing.get("source_keys") or []) & set(c.get("source_keys") or []))
    result: Dict[str, Any] = {"title": title, "start_date": start, "end_date": end, "source_url": src_url,
                              "country": verdict, "signals": signals, "key": key,
                              "match": existing.get("event_id") if existing else None}

    if verdict != "pass":
        ctx.bump("dropped_wrong_country")
        await _reject(ctx.db, ctx, c, "country_fail", signals)
        if existing and same_source and not ctx.dry:
            # §15 Q6: the stored verdict is recomputed only here / in the sentinel; fail → hidden, sticky.
            await _write_status(ctx.db, existing, {"country_check": "fail", "country_signals": list(signals)[:40]},
                                actor="pipeline", now=ctx.now, alerts=ctx.alerts, log_detail="country_fail on re-pull")
        ctx.results.append({**result, "action": "rejected_country"})
        return "dropped_wrong_country"

    if role == "corroborate" and existing is None:
        existing = await _find_fuzzy(ctx.db, c, same_dates=False, geo=geo)
        if existing is None:
            if _as_map(c.get("markers")).get("cancel"):
                # Nothing to hide, but a corroborating source announcing a cancellation is news
                # Phil must see (the row it names may exist under another title/venue).
                ctx.alerts.append(f"⛔ {title[:80]} ({start}): {gate.registrable_domain(src_url)} lo anuncia "
                                  f"cancelado/aplazado y no coincide con ninguna fila")
            ctx.results.append({**result, "action": "corroboration_unmatched"})
            return "corroboration_unmatched"
    if existing is None:
        existing = await _find_fuzzy(ctx.db, c, same_dates=True, geo=geo)
        if existing is not None:
            result["match"] = existing.get("event_id")
            result["fuzzy"] = True

    parent = await _parent_for(ctx.db, c)
    if existing is not None:
        outcome = await _merge_into(ctx, existing, c, geo=geo, verdict=verdict, signals=signals,
                                    same_source=same_source, umbrella=umbrella, parent=parent, role=role)
        ctx.results.append({**result, "action": outcome})
        if parent is not None:
            await _mark_umbrella(ctx, parent)
        return outcome

    markers = _as_map(c.get("markers"))
    if markers.get("cancel"):
        ctx.bump("dropped_other")
        await _reject(ctx.db, ctx, c, f"cancel_marker:{markers.get('cancel')}")
        ctx.results.append({**result, "action": "rejected_cancel_marker"})
        return "rejected_cancel_marker"

    doc = doc_from_candidate(c, key=key, geo=geo, verdict=verdict, signals=signals, now=ctx.now,
                             umbrella=umbrella, parent_id=parent.get("event_id") if parent else None)
    ev = _apply_eval(doc, ctx.now)
    if ev["status"] == "drop":
        ctx.bump("dropped_no_source")
        await _reject(ctx.db, ctx, c, "gate_drop")
        return "dropped_no_source"
    doc.update(ev)
    ann = _candidate_notice(c) if markers.get("date_notice") else None
    if markers.get("date_notice") and ev["status"] in LIVE_STATUSES and not sources.announces_dates(c, ann):
        # "Nueva fecha" / "cambio de fecha" in the event block whose announced date is not the
        # date this candidate carries (the parse may be the old one, §7 table): hold it for review
        # with an alert instead of publishing either date; approve applies the announced date.
        doc.update(status="review", status_reason="date_changed", confidence="VERIFY", notif_eligible=False)
        ev = {**ev, "status": "review", "status_reason": "date_changed", "confidence": "VERIFY",
              "notif_eligible": False}
        if ann and ann.get("start_date"):
            doc["proposed_dates"] = {"start_date": ann["start_date"], "end_date": ann.get("end_date") or ann["start_date"],
                                     "start_time": _announced_time(c, ann), "source_url": src_url, "at": _iso(ctx.now)}
            doc["evidence"] = merge_evidence([], _announced_evidence(c, ann))
        pn = _pending_notice(ann, ctx.now)
        if pn:
            doc["pending_notice"] = pn
        ctx.alerts.append(f"📅 {title[:80]}: la fuente anuncia '{markers.get('date_notice')}'"
                          f"{' → ' + str(ann['start_date']) if ann and ann.get('start_date') else ''} "
                          f"(nuevo, listado del {start}; a revisión) · {src_url}")
    try:
        doc["event_id"] = _mint_id(doc)
    except ValueError:
        ctx.bump("dropped_other")
        await _reject(ctx.db, ctx, c, "id_out_of_contract")
        return "id_out_of_contract"
    label = {"published": "published", "review": "held_review", "date_tbc": "date_tbc"}.get(ev["status"])
    ctx.results.append({**result, "action": "insert", "status": ev["status"], "reason": ev["status_reason"],
                        "confidence": ev["confidence"], "event_id": doc["event_id"]})
    if ctx.dry:
        if label:
            ctx.bump(label)
        return "insert"
    try:
        res = await ctx.db.city_events.update_one({"canonical_key": key}, {"$setOnInsert": doc}, upsert=True)
    except DuplicateKeyError:
        # §13 A3: another row owns one of these source_keys — retry once as an update on it.
        again = await _find_existing(ctx.db, c, key)
        if again is None:
            ctx.errors.append("dup_key_unresolved")
            return "error"
        outcome = await _merge_into(ctx, again, c, geo=geo, verdict=verdict, signals=signals, same_source=True,
                                    umbrella=umbrella, parent=parent, role=role)
        return outcome
    if getattr(res, "upserted_id", None) is None:
        again = await _find_existing(ctx.db, c, key)
        if again is not None:
            return await _merge_into(ctx, again, c, geo=geo, verdict=verdict, signals=signals, same_source=True,
                                     umbrella=umbrella, parent=parent, role=role)
        return "noop"
    ctx.bump("inserted")
    if label:
        ctx.bump(label)
    await _log(ctx.db, doc["event_id"], "pipeline", None, ev["status"], ev["status_reason"],
               {"source": c.get("source_key"), "url": src_url}, ctx.now)
    if parent is not None:
        await _mark_umbrella(ctx, parent)
    return "insert"


async def _merge_into(ctx: PullCtx, doc: Dict[str, Any], c: Mapping[str, Any], *, geo: Optional[Mapping[str, Any]],
                      verdict: str, signals: Sequence[str], same_source: bool, umbrella: bool,
                      parent: Optional[Mapping[str, Any]], role: str) -> str:
    """Merge a candidate into an existing row: evidence (newest per URL), authority, missing
    fields, date-change handling (§15 P2/S3), cancel marker, then re-evaluate."""
    now = ctx.now
    tier = _cand_tier(c)
    markers = _as_map(c.get("markers"))
    d_start, d_end = doc.get("start_date"), doc.get("end_date") or doc.get("start_date")
    cancel, notice = markers.get("cancel"), markers.get("date_notice")
    ann: Optional[Dict[str, Any]] = None
    pending: Optional[Dict[str, Any]] = None
    if notice:
        # §7 table: resolve 'nueva fecha' against the date it ANNOUNCES, not the page's first date.
        ann = _candidate_notice(c, doc)
        if ann is not None and sources.announces_dates(doc, ann):
            c = _with_announced(c, ann)     # the notice states our dates: an ordinary merge
            notice = None
        elif sources.notice_ack_matches(doc, ann) and \
                (c.get("start_date"), c.get("end_date") or c.get("start_date")) == (d_start, d_end):
            notice = None                   # Phil already approved THIS notice for these dates
        else:
            pending = _pending_notice(ann, now)
    c_start, c_end = c.get("start_date"), c.get("end_date") or c.get("start_date")
    date_differs = (c_start, c_end) != (d_start, d_end)
    reason_detail: Any = None
    if not same_source and tier <= 5 and d_start and (cancel or notice):
        # canonical_key carries no date: another source's cancel / 'nueva fecha' for ANOTHER
        # performance (same show, title, venue, year; different date) must not touch this row.
        # It applies only when its dates overlap ours (a notice also counts when the date it
        # calls the original one overlaps ours); otherwise merge nothing and change nothing.
        mine = _ranges_overlap(c_start, c_end, d_start, d_end)
        if not mine and notice and not cancel:
            mine = any(_ranges_overlap(o[0], o[1], d_start, d_end) for o in (ann or {}).get("original") or []
                       if isinstance(o, (list, tuple)) and len(o) == 2)
        if not mine:
            ctx.bump("other_performance")
            ctx.results.append({"title": _es(c.get("title")), "start_date": c_start, "source_url": c.get("source_url"),
                                "match": doc.get("event_id"), "action": "other_performance",
                                "marker": cancel or notice})
            return "other_performance"

    fields: Dict[str, Any] = {"evidence": merge_evidence(doc.get("evidence") or [], c.get("evidence") or [])}
    if same_source:
        fields.update(country_check=verdict, country_signals=list(signals)[:40])
    unset: List[str] = []
    push: Optional[Dict[str, Any]] = None

    specific_alert = False
    attach_keys = True
    c_dom = gate.registrable_domain(c.get("source_url"))
    c_when = f"{c_start}{'–' + str(c_end) if c_end and c_end != c_start else ''}"
    c_ev0 = _as_map((c.get("evidence") or [None])[0])
    c_visible = bool(c_ev0.get("visible") if isinstance(c_ev0.get("visible"), bool) else c_ev0.get("date_visible"))
    proposed = {"start_date": c_start, "end_date": c_end,
                "start_time": c.get("start_time") if c.get("time_confirmed") else None,
                "source_url": c.get("source_url"), "at": _iso(now)}
    if cancel and same_source:
        specific_alert = True
        fields.update(status="hidden", status_reason="cancel_marker")
        reason_detail = {"marker": cancel, "url": c.get("source_url")}
        ctx.alerts.append(f"⛔ {_title_line(doc)}: marcador de cancelación en {c_dom}")
    elif cancel and tier <= 5:
        # ANOTHER source that matches this row says cancelled/postponed. Its page is not support:
        # never merge it as evidence, never refresh last_verified, never adopt its source_keys (a
        # later pull of that page must stay "another source", not escalate). Tier ≤ 3 hides at
        # once; a tier 4–5 report holds the row for review (sticky) until Phil decides.
        specific_alert = True
        attach_keys = False
        fields.pop("evidence", None)
        fields.pop("country_check", None)
        fields.pop("country_signals", None)
        if tier <= 3:
            fields.update(status="hidden", status_reason="cancel_marker", hidden_at=_iso(now))
        else:
            fields.update(status="review", status_reason="cancel_reported")
        fields["cancel_report"] = {"marker": cancel, "url": c.get("source_url"), "tier": tier, "at": _iso(now),
                                   "start_date": c_start, "end_date": c_end}
        reason_detail = {"marker": cancel, "url": c.get("source_url"), "tier": tier, "cross_source": True,
                         "start_date": c_start, "end_date": c_end}
        ctx.alerts.append(f"⛔ {_title_line(doc)}: {c_dom} (tier {tier}) lo anuncia cancelado/aplazado "
                          f"({cancel}) para el {c_when} → {'oculto' if tier <= 3 else 'revisión'} · {c.get('source_url')}")
    elif notice and (same_source or tier <= 5):
        # "Nueva fecha" / "cambio de fecha" (§7 table): review/date_changed even when the page
        # still prints the old date first. Another source's notice is never merged as support.
        specific_alert = True
        if not same_source:
            attach_keys = False
            fields.pop("evidence", None)
            fields.pop("country_check", None)
            fields.pop("country_signals", None)
        fields.update(status="review", status_reason="date_changed")
        to = [c_start, c_end]
        if ann and ann.get("start_date"):
            to = [ann["start_date"], ann.get("end_date") or ann["start_date"]]
            fields["proposed_dates"] = {**proposed, "start_date": to[0], "end_date": to[1],
                                        "start_time": _announced_time(c, ann)}
            if same_source:
                fields["evidence"] = merge_evidence(doc.get("evidence") or [], _announced_evidence(c, ann))
        elif date_differs and c_start:
            fields["proposed_dates"] = proposed
        else:
            unset.append("proposed_dates")
        if pending:
            fields["pending_notice"] = pending
        reason_detail = {"marker": f"date_notice:{notice}", "from": [d_start, d_end], "to": to,
                         "url": c.get("source_url")}
        ctx.alerts.append(f"📅 {_title_line(doc)}: {c_dom} anuncia '{notice}'"
                          f"{' → ' + str(to[0]) if to[0] and to[0] != d_start else ''} (listado del {c_when}; "
                          f"a revisión) · {c.get('source_url')}")
    elif same_source and date_differs:
        # The same source now states another date: never edit silently (§15 S3).
        specific_alert = True
        fields.update(status="review", status_reason="date_changed", proposed_dates=proposed)
        reason_detail = {"from": [d_start, d_end], "to": [c_start, c_end], "url": c.get("source_url")}
        ctx.alerts.append(f"📅 {_title_line(doc)}: la fuente cambió la fecha {d_start} → {c_start} (a revisión)")
    elif not d_start and isinstance(c_start, str) and tier <= 3 and c_visible:
        # A date_tbc row whose date another official (tier ≤ 3) page now states visibly: §13 A3 /
        # §15 S3 — review/date_changed with the proposed dates and an alert; approve applies them
        # (and clears tbc_window_end / date_tbc_note). Never a silent merge that keeps "por confirmar".
        specific_alert = True
        fields.update(status="review", status_reason="date_changed", proposed_dates=proposed)
        reason_detail = {"from": [None, None], "to": [c_start, c_end], "url": c.get("source_url"),
                         "marker": "date_announced"}
        ctx.alerts.append(f"📅 {_title_line(doc)}: {c_dom} anuncia la fecha {c_start} (a revisión)")
    else:
        if tier <= 3 and c_start == d_start and not date_differs:
            fa = _cand_fetched(c)
            old = gate.parse_iso(doc.get("last_verified"))
            if fa and (old is None or (gate.parse_iso(fa) or old) > old):
                fields["last_verified"] = fa
            if same_source:
                fields.update(not_found_count=0, gone_strikes=0, blocked_days=0)
                unset.append("gone_first_at")
        if same_source:
            fields["sold_out"] = bool(c.get("sold_out"))
        if not doc.get("start_time") and c.get("time_confirmed") and c.get("start_time") and not date_differs:
            fields.update(start_time=c["start_time"], time_confirmed=True)
            if c.get("end_time") and not doc.get("end_time"):
                fields["end_time"] = c["end_time"]
        if not doc.get("ticket_url") and gate.is_http_url(c.get("ticket_url")):
            fields["ticket_url"] = c["ticket_url"]
        price = _as_map(doc.get("price"))
        if not any(price.get(k) is not None for k in ("is_free", "min_cop", "max_cop")) and c.get("price"):
            fields["price"] = dict(c["price"])
        is_umb = bool(doc.get("is_umbrella")) or umbrella
        if geo is not None and not is_umb and doc.get("geocode_source") is None:
            gset, gun = _geo_fields(geo, umbrella=False)
            fields.update(gset)
            unset.extend(gun)
        d_tier = _int(doc.get("source_tier"), 6) or 6
        if role != "corroborate" and c.get("source_url") != doc.get("source_url") and tier < d_tier:
            fields.update(second_source_url=doc.get("source_url"), second_source_name=doc.get("source_name"),
                          second_source_tier=d_tier, source_url=c.get("source_url"),
                          source_name=c.get("source_name") or doc.get("source_name"), source_tier=tier,
                          source_key=c.get("source_key"), recheck_url=c.get("recheck_url") or c.get("source_url"))
        elif c.get("source_url") != doc.get("source_url"):
            s_tier = _int(doc.get("second_source_tier"), 99) or 99
            if tier < s_tier:
                fields.update(second_source_url=c.get("source_url"), second_source_name=c.get("source_name"),
                              second_source_tier=tier)
    if parent is not None and not doc.get("parent_id") and parent.get("event_id") != doc.get("event_id"):
        fields["parent_id"] = parent.get("event_id")
    if umbrella and not doc.get("is_umbrella"):
        fields.update(is_umbrella=True, lat=None, lng=None, geocode_source=None, zone=None)
        unset.append("geo")

    label = "corroborated" if role == "corroborate" else ("updated" if same_source else "dupes_merged")
    if ctx.dry:
        ctx.bump(label)
        return label
    new_keys = [k for k in (c.get("source_keys") or []) if k not in (doc.get("source_keys") or [])] \
        if attach_keys else []
    if new_keys:
        await _add_source_keys(ctx.db, doc["event_id"], new_keys)
    await _write_status(ctx.db, doc, fields, actor="pipeline", now=now, unset=unset, push=push,
                        alerts=None if specific_alert else ctx.alerts, log_detail=reason_detail)
    ctx.bump(label)
    return label


def _perf_flags(cands: Sequence[Mapping[str, Any]]) -> List[bool]:
    """§15 P1: several dates for one match_key on the SAME page are distinct performances."""
    groups: Dict[Tuple[str, str], Set[str]] = {}
    keys: List[Optional[Tuple[str, str]]] = []
    for c in cands:
        b = _base_key(c)
        if b is None or not isinstance(c.get("start_date"), str):
            keys.append(None)
            continue
        k = (str(c.get("source_url")), b)
        groups.setdefault(k, set()).add(str(c["start_date"]))
        keys.append(k)
    return [bool(k and len(groups.get(k, set())) > 1) for k in keys]


async def run_pull(db_: Any, *, now: Optional[datetime] = None, source_key: Optional[str] = None,
                   dry: bool = False, actor: str = "cron", budget_s: float = RUN_BUDGET_S,
                   source_list: Optional[Sequence[Mapping[str, Any]]] = None,
                   client_factory: Optional[ClientFactory] = None, run_enrich: bool = True,
                   seed_anchors_first: Optional[bool] = None) -> Dict[str, Any]:
    """One pull invocation (§7): advance through SOURCES from the day's cursor within the budget.
    §16.4: first seeds the anchors whenever the file's anchors_version differs from the stored
    one (default: on the real registry, not dry, not a single-source run), even when today's
    pass is already done — so a deploy with new anchors needs no manual seed."""
    started = _now(now)
    seed_first = seed_anchors_first if seed_anchors_first is not None else (source_list is None and not source_key)
    anchors_seed: Optional[Dict[str, Any]] = None
    if seed_first and not dry:
        try:
            anchors_seed = await ensure_anchors_seeded(db_, now=started, actor=f"{actor}:anchors")
        except Exception as exc:  # noqa: BLE001 — a seed failure never blocks the pull
            logger.error("[events] anchors auto-seed failed: %s", type(exc).__name__)
            anchors_seed = {"errors": [f"seed_failed:{type(exc).__name__}"]}
        if anchors_seed and anchors_seed.get("errors"):
            await _alert([f"⚠️ Anclas v{anchors_seed.get('anchors_version')}: "
                          f"{len(anchors_seed['errors'])} error(es) al sembrar"], title="AMO · Agenda (anclas)")
    t0 = _time.monotonic()
    deadline = t0 + budget_s
    dispatch_deadline = t0 + min(DISPATCH_BUDGET_S, max(1.0, budget_s - 10.0))
    run_id = _run_id("pull", started)
    registry = list(source_list if source_list is not None else sources.SOURCES)
    if source_key:
        registry = [e for e in registry if e.get("key") == source_key]
        if not registry:
            raise HTTPException(status_code=400, detail=f"unknown source {source_key}")
    make = client_factory or sources.make_client

    use_cursor = not dry and not source_key
    cid = "cursor:pull"
    cur: Dict[str, Any] = {"idx": 0, "offset": 0, "done": False}
    today = _today(started)
    poison: Optional[str] = None
    if use_cursor:
        claimed = await _claim(db_, cid, started, run_id)
        if claimed is None:
            return {"run_id": run_id, "skipped": "lease_held"}
        cur = claimed
        if cur.get("day") != today:
            cur = {"day": today, "idx": 0, "offset": 0, "done": False, "inflight": None}
            await _save_cursor(db_, cid, run_id, cur)
        if cur.get("done"):
            await _save_cursor(db_, cid, run_id, {"lease_until": _iso(started)})
            return {"run_id": run_id, "done": True, "noop": True, **({"anchors": anchors_seed} if anchors_seed else {})}
        infl = cur.get("inflight")
        if isinstance(infl, Mapping) and _int(infl.get("idx"), -1) == _int(cur.get("idx")):
            poison = f"poison_skipped:{infl.get('source')}:{infl.get('offset')}"
            cur["offset"] = _int(infl.get("offset")) + 1
            cur["inflight"] = None
            await _save_cursor(db_, cid, run_id, {"offset": cur["offset"], "inflight": None})
    # Only now (the day's pass is not done) pay for the catalog read: the */10 cron's no-op
    # ticks stay one cursor read + one anchors-version read (§16.4).
    flags = await runtime.get_flags(db_)
    disabled = set(flags.get("sources_disabled") or [])
    ctx = PullCtx(db_, started, run_id, dry=dry, catalog=await load_catalog(db_), gazetteer=load_gazetteer())
    if poison:
        ctx.errors.append(poison)
    idx = _int(cur.get("idx"))
    offset = _int(cur.get("offset"))
    per_source: List[Dict[str, Any]] = []

    # ONE politeness scheduler for the whole invocation (§5 / §13 F2 min_gap_s per domain) and one
    # client per source: a source re-run for its next batch keeps its per-domain gap, its cookie jar
    # and its SecuTix waiting-room session instead of hitting the host again 1 ms later.
    sched = sources.PoliteScheduler(dispatch_deadline)
    clients: Dict[str, Any] = {}
    try:
        while idx < len(registry) and _time.monotonic() < dispatch_deadline:
            entry = registry[idx]
            key = str(entry.get("key"))
            adapter = entry.get("adapter")
            if key in disabled or not entry.get("enabled", True) or adapter is None:
                per_source.append({"source": key, "skipped": "disabled"})
                idx, offset = idx + 1, 0
                if use_cursor:
                    await _save_cursor(db_, cid, run_id, {"idx": idx, "offset": 0, "inflight": None})
                continue
            client = clients.get(key)
            if client is None:
                client = clients[key] = make()

            async def checkpoint(i: int, url: str, _idx: int = idx, _key: str = key) -> None:
                if use_cursor:
                    await _save_cursor(db_, cid, run_id, {"idx": _idx, "offset": i,
                                                           "inflight": {"idx": _idx, "offset": i, "source": _key}})

            try:
                res = await adapter.pull(client, dispatch_deadline, offset=offset, sched=sched, checkpoint=checkpoint,
                                         now_utc=started)
            except Exception as exc:  # noqa: BLE001 — Adapter.pull contains its own errors; belt and braces
                logger.error("[events] pull %s crashed: %s", key, type(exc).__name__)
                ctx.errors.append(f"{key}:pull_crash:{type(exc).__name__}")
                res = None
            if res is None:
                idx, offset = idx + 1, 0
                continue
            role = str(entry.get("role") or "discover")
            perf = _perf_flags(res)
            for c, is_perf in zip(list(res), perf):
                try:
                    await process_candidate(ctx, c, role=role, perf=is_perf)
                except Exception as exc:  # noqa: BLE001 — one malformed candidate never kills the run
                    logger.error("[events] candidate from %s failed: %s", key, type(exc).__name__)
                    ctx.errors.append(f"{key}:candidate:{type(exc).__name__}")
            for e in getattr(res, "errors", []) or []:
                ctx.errors.append(f"{key}:{e}")
            per_source.append({"source": key, "offset": offset, "candidates": len(res),
                               "next_offset": getattr(res, "next_offset", None), "fetches": getattr(res, "fetches", 0),
                               "blocked": getattr(res, "blocked", False), "skipped": len(getattr(res, "skipped", []) or [])})
            nxt = getattr(res, "next_offset", None)
            if nxt is None or (int(nxt) <= offset and not getattr(res, "deadline_hit", False)):
                idx, offset = idx + 1, 0     # finished (or no progress: never spin on one source)
            else:
                offset = int(nxt)
            if use_cursor:
                await _save_cursor(db_, cid, run_id, {"idx": idx, "offset": offset, "inflight": None})
            if getattr(res, "deadline_hit", False):
                break
    finally:
        for c_key, c_client in clients.items():
            try:
                await c_client.aclose()
            except Exception as exc:  # noqa: BLE001
                logger.error("[events] client close failed (%s): %s", c_key, type(exc).__name__)

    done = idx >= len(registry)
    if source_key:
        done = True
    if use_cursor:
        await _save_cursor(db_, cid, run_id, {"idx": idx, "offset": offset, "done": done, "inflight": None,
                                             "lease_until": _iso(started - timedelta(seconds=1))})
    enrich_out: Optional[Dict[str, Any]] = None
    if done and run_enrich and not dry and deadline - _time.monotonic() >= ENRICH_TIMEOUT_S + 5:
        try:
            enrich_out = await run_enrich_batch(db_, now=started, budget_s=deadline - _time.monotonic() - 3)
        except Exception as exc:  # noqa: BLE001
            logger.error("[events] enrich inside pull failed: %s", type(exc).__name__)
    if not dry:
        await _write_run(db_, _run_row("pull", run_id, started, actor, t0=t0, source=source_key, done=done,
                                       cursor={"idx": idx, "offset": offset}, errors=ctx.errors,
                                       per_source=per_source, **ctx.counts))
        await _alert(ctx.alerts, title="AMO · Agenda (pull)")
    out: Dict[str, Any] = {"run_id": run_id, "dry": dry, "done": done, "cursor": {"idx": idx, "offset": offset},
                           "counts": ctx.counts, "errors": ctx.errors[:30], "per_source": per_source}
    if dry:
        out["candidates"] = ctx.results[:300]
    if enrich_out is not None:
        out["enrich"] = enrich_out
    if anchors_seed:
        out["anchors"] = anchors_seed
    return out


# ═════════════════════════════════════════════════════════════════════════════
# ENRICH (§7, §15 S4) — translate / categorize / rewrite ONLY; None = no change
# ═════════════════════════════════════════════════════════════════════════════

_DIGITS_RE = re.compile(r"\d+")
_URL_RE = re.compile(r"https?://\S+|www\.\S+", re.I)
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_RE = re.compile(r"\+?\d[\d\s().-]{6,}\d")
_TIME_RE = re.compile(r"\b\d{1,2}\s*[:h.]\s*\d{2}\b|\b\d{1,2}\s*(?:a\.?\s?m\.?|p\.?\s?m\.?)(?![a-z])"
                      r"|\b(?:medianoche|mediod[ií]a|midnight|noon|minuit|midi|meia-noite|meio-dia)\b", re.I)
_CURRENCY_RE = re.compile(r"[$€£]|\b(?:cop|usd|eur|pesos?|d[oó]lares|dollars?|euros?|reais|real)\b", re.I)
_CAL_WORDS = frozenset(gate.fold(w) for w in (
    "enero febrero marzo abril mayo junio julio agosto septiembre setiembre octubre noviembre diciembre "
    "january february march april may june july august september october november december "
    "janvier fevrier mars avril mai juin juillet aout septembre octobre novembre decembre "
    "janeiro fevereiro marco abril maio junho julho agosto setembro outubro novembro dezembro "
    "lunes martes miercoles jueves viernes sabado domingo monday tuesday wednesday thursday friday "
    "saturday sunday lundi mardi mercredi jeudi vendredi samedi dimanche segunda terca quarta quinta "
    "sexta sabado domingo").split())
_CAP_WORD_RE = re.compile(r"(?<![\w'’])([A-ZÁÉÍÓÚÑÜÀÂÇÈÊÎÔÛ][\wÁÉÍÓÚÑÜáéíóúñüàâçèêîôû'’-]+)")
_SENT_START_RE = re.compile(r"(?:^|[.!?¡¿:;\n]\s*|[\"«“(]\s*)$")


def _tokens(s: str) -> Set[str]:
    return set(re.findall(r"[a-z0-9]+", gate.fold(s)))


def has_date_token(text: Any) -> bool:
    """Any digit, month / weekday word or clock time: what a description must never carry, since
    dates are rendered from the structured fields and a copied date goes stale on a date change."""
    if not isinstance(text, str) or not text:
        return False
    if _DIGITS_RE.search(text) or _TIME_RE.search(text):
        return True
    # English "may" is a modal verb far more often than a month; "May 5" is caught by its digit.
    return any(w in _CAL_WORDS and w != "may" for w in _tokens(text))


def validate_llm_text(out: Any, source: str, *, title_es: Optional[str] = None, max_len: int = 900,
                      no_dates: bool = False) -> Optional[str]:
    """§15 S4: None when `out` is acceptable, else the rejection reason. Anything in the output
    that is not verbatim in the source text (digits, month/weekday, time, currency/price, URL,
    phone, email, capitalized names) rejects it; the old value is kept. `no_dates` (descriptions)
    rejects ANY digit, month/weekday or time, even one copied verbatim from the source: a date
    in prose outlives the next date change."""
    if not isinstance(out, str) or not out.strip():
        return "empty"
    text = out.strip()
    if len(text) > max_len:
        return "too_long"
    if no_dates and has_date_token(text):
        return "date_in_description"
    src = source or ""
    src_fold = gate.fold(src)
    src_tokens = _tokens(src)
    src_digits = set(_DIGITS_RE.findall(src))
    for d in _DIGITS_RE.findall(text):
        if d not in src_digits:
            return "digits"
    if title_es is not None and sorted(_DIGITS_RE.findall(text)) != sorted(_DIGITS_RE.findall(title_es)):
        return "title_digits"
    for w in _tokens(text):
        if w in _CAL_WORDS and w not in src_tokens:
            return "calendar_word"
    for rx, why in ((_TIME_RE, "time"), (_CURRENCY_RE, "currency"), (_URL_RE, "url"),
                    (_EMAIL_RE, "email"), (_PHONE_RE, "phone")):
        for m in rx.finditer(text):
            if gate.fold(m.group(0)).strip() not in src_fold:
                return why
    for m in _CAP_WORD_RE.finditer(text):
        if _SENT_START_RE.search(text[:m.start()]):
            continue  # sentence-initial capital is grammar, not a name
        if gate.fold(m.group(1)) not in src_tokens:
            return "capitalized_name"
    for i in range(0, max(0, len(text) - 200)):
        if gate.fold(text[i:i + 201]) in src_fold:
            return "verbatim_copy"
    return None


ENRICH_SYSTEM = (
    "Eres editor de una agenda cultural. Recibes un evento con su título en español y el texto de la "
    "fuente. Devuelve SOLO un objeto JSON con esta forma exacta: "
    '{"title":{"en":"","fr":"","pt":""},"description":{"es":"","en":"","fr":"","pt":""},"category":""}. '
    "Reglas estrictas: traduce el título sin añadir ni quitar números; escribe una descripción breve (máx. "
    "2 frases) con TUS palabras usando SOLO hechos del texto fuente; NUNCA escribas fechas, meses, días de "
    "la semana, horas, precios, monedas, URLs, teléfonos, correos ni nombres que no estén literalmente en el "
    "texto fuente; usa mayúscula solo al inicio de la frase y en nombres copiados del texto fuente; tutea "
    "(tú; en francés 'tu'; en portugués 'você'). category debe ser una de: concert, festival, cultural, "
    "nightlife, gastronomic, sports, family, civic. Si no puedes cumplir, devuelve {}."
)


def _parse_llm_json(raw: Optional[str]) -> Optional[Dict[str, Any]]:
    if not raw:
        return None
    t = raw.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    m = re.search(r"\{.*\}", t, re.S)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
    except ValueError:
        return None
    return obj if isinstance(obj, dict) else None


def enrich_fields(row: Mapping[str, Any], obj: Mapping[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    """Validated $set for one row from the LLM object, plus rejection notes. Pure."""
    title_es = _es(row.get("title"))
    src = f"{title_es}\n{row.get('venue_name') or ''}\n{row.get('event_text') or ''}" if row.get("llm_text_ok", True) \
        else f"{title_es}\n{row.get('venue_name') or ''}"
    out: Dict[str, Any] = {}
    notes: List[str] = []
    t_obj = _as_map(obj.get("title"))
    cur_title = _as_map(row.get("title")) or {"es": title_es}
    for lg in ("en", "fr", "pt"):
        val = t_obj.get(lg)
        if not isinstance(val, str) or not val.strip():
            continue
        why = validate_llm_text(val, src, title_es=title_es, max_len=140)
        if why:
            notes.append(f"title.{lg}:{why}")
        elif not (isinstance(cur_title.get(lg), str) and cur_title.get(lg)):
            out[f"title.{lg}"] = val.strip()
    d_obj = _as_map(obj.get("description"))
    if row.get("llm_text_ok", True):
        for lg in ("es", "en", "fr", "pt"):
            val = d_obj.get(lg)
            if not isinstance(val, str) or not val.strip():
                continue
            why = validate_llm_text(val, src, max_len=600, no_dates=True)
            if why:
                notes.append(f"description.{lg}:{why}")
            else:
                out[f"description.{lg}"] = val.strip()
    cat = obj.get("category")
    if isinstance(cat, str) and cat in gate.CATEGORIES and row.get("origin") != "anchor":
        out["category"] = cat
    return out, notes


async def run_enrich_batch(db_: Any, *, now: Optional[datetime] = None, limit: int = ENRICH_MAX_ROWS,
                           budget_s: float = RUN_BUDGET_S, dry: bool = False,
                           complete: Optional[Callable[..., Awaitable[Optional[str]]]] = None) -> Dict[str, Any]:
    """≤ 3 rows per call. A None / invalid LLM answer changes nothing (§0)."""
    n = _now(now)
    t_end = _time.monotonic() + budget_s
    if complete is None:
        import llm as _llm
        complete = _llm.llm_complete
    q = {"status": {"$in": ["published", "date_tbc", "review"]}, "origin": {"$ne": "anchor"},
         "enriched_at": {"$exists": False},
         "$or": [{"enrich_attempts": {"$exists": False}}, {"enrich_attempts": {"$lt": ENRICH_MAX_ATTEMPTS}}]}
    try:
        rows = await db_.city_events.find(q, {"_id": 0}).limit(max(1, min(limit, ENRICH_MAX_ROWS))).to_list(
            length=ENRICH_MAX_ROWS)
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] enrich query failed: %s", type(exc).__name__)
        return {"rows": 0, "error": "query_failed"}
    report: List[Dict[str, Any]] = []
    for row in rows or []:
        remaining = t_end - _time.monotonic()
        if remaining < 6:
            break
        payload = {"title_es": _es(row.get("title")), "category": row.get("category"),
                   "venue": row.get("venue_name"),
                   "source_text": (row.get("event_text") or "")[:1500] if row.get("llm_text_ok", True) else ""}
        raw: Optional[str] = None
        try:
            raw = await asyncio.wait_for(
                complete(ENRICH_SYSTEM, json.dumps(payload, ensure_ascii=False), model=ENRICH_MODEL,
                         max_tokens=900, temperature=0.0),
                timeout=min(ENRICH_TIMEOUT_S, remaining - 3))
        except asyncio.TimeoutError:
            logger.error("[events] enrich LLM timed out")
        except Exception as exc:  # noqa: BLE001
            logger.error("[events] enrich LLM failed: %s", type(exc).__name__)
        obj = _parse_llm_json(raw)
        fields, notes = enrich_fields(row, obj) if obj else ({}, ["llm_none"])
        report.append({"event_id": row.get("event_id"), "fields": sorted(fields), "rejected": notes})
        if dry:
            continue
        try:
            upd: Dict[str, Any] = {"$inc": {"enrich_attempts": 1}, "$set": {"enrich_last_at": _iso(n)}}
            if fields:
                upd["$set"].update(fields)
                upd["$set"]["enriched_at"] = _iso(n)
            await db_.city_events.update_one({"event_id": row.get("event_id")}, upd)
            if fields:
                await _log(db_, row.get("event_id"), "enrich", None, None, "enriched", sorted(fields), n)
        except Exception as exc:  # noqa: BLE001
            logger.error("[events] enrich write failed: %s", type(exc).__name__)
    return {"rows": len(report), "report": report, "dry": dry}


def date_change_unsets(doc: Mapping[str, Any]) -> List[str]:
    """Fields to $unset whenever start_date / end_date / start_time change: every description
    language that states a date/time (it would contradict the new dates on /event, feed cards and
    the legacy description), and — for pipeline rows — the enrich markers, so the row is
    re-enriched from current text under the no-dates rule."""
    out: List[str] = []
    desc = _as_map(doc.get("description"))
    for lg, val in desc.items():
        if has_date_token(val):
            out.append(f"description.{lg}")
    if doc.get("origin") != "anchor":
        out.extend(["enriched_at", "enrich_attempts"])
    return out


# ═════════════════════════════════════════════════════════════════════════════
# SENTINEL (§7, §13 F4/G, §15 S3/R1/R4)
# ═════════════════════════════════════════════════════════════════════════════


def _recheck_url(doc: Mapping[str, Any]) -> str:
    return str(doc.get("recheck_url") or doc.get("source_url") or "")


def _recheck_visible(doc: Mapping[str, Any], url: str) -> bool:
    prior = _newest_for(doc, url)
    if prior is not None:
        for k in ("date_visible", "visible"):
            if isinstance(prior.get(k), bool):
                return bool(prior[k])
    ad = sources.adapter_for(doc)
    return ad is None or (ad.entry.get("recheck") != "adapter")   # generic recheck reads visible text


def recheck_evidence(doc: Mapping[str, Any], rec: Mapping[str, Any], url: str, now: datetime) -> Dict[str, Any]:
    """The evidence entry a recheck produces (fetched_at = check time)."""
    prior = _newest_for(doc, url) or {}
    parsed = _as_map(rec.get("parsed"))
    fa = rec.get("checked_at") if isinstance(rec.get("checked_at"), str) and gate.parse_iso(rec.get("checked_at")) \
        else _iso(now)
    return {
        "url": url, "name": prior.get("name") or doc.get("source_name") or gate.registrable_domain(url),
        "tier": gate.domain_tier(url, prior.get("tier") or doc.get("source_tier")),
        "fetched_at": fa, "http_status": _int(rec.get("http_status"), 200) or 200,
        "date_text": rec.get("found_date_text") or prior.get("date_text"),
        "date_visible": _recheck_visible(doc, url),
        "start_date": parsed.get("start_date"), "end_date": parsed.get("end_date") or parsed.get("start_date"),
        "start_time": parsed.get("start_time"), "via": "sentinel",
    }


_GAZETTEER_CACHE: Optional[List[Dict[str, Any]]] = None


def _gazetteer() -> List[Dict[str, Any]]:
    global _GAZETTEER_CACHE
    if _GAZETTEER_CACHE is None:
        _GAZETTEER_CACHE = load_gazetteer()
    return _GAZETTEER_CACHE


def recheck_moved(doc: Mapping[str, Any], rec: Mapping[str, Any], url: str) -> Optional[Tuple[str, Any]]:
    """A 'success' recheck whose event-scoped block now places the event elsewhere (§15 Q6: the
    sentinel recomputes the country verdict from fresh text). Returns ('country', signals) when
    the block carries an explicit FAIL signal (another city / municipality, 'vía al mar', …),
    ('venue', name) when the stated venue geocodes to a different known place than the stored,
    geocoded one, else None. Only explicit signals count: the recheck lacks the pull's positives,
    so a missing positive ('fail:no_positive') never fails a stored pass, and a city the pull
    excused ('note:other_city_excepted') stays excused."""
    if doc.get("is_umbrella"):
        return None
    ev_text = rec.get("event_text") or rec.get("found_date_text")
    venue = rec.get("venue") if isinstance(rec.get("venue"), str) and rec.get("venue") else None
    if not (isinstance(ev_text, str) and ev_text.strip()) and not venue:
        return None
    excused = {str(x).rsplit(":", 1)[-1] for x in (doc.get("country_signals") or [])
               if isinstance(x, str) and x.startswith("note:other_city_excepted:")}
    _v, signals = gate.country_check({"source_url": url, "event_text": ev_text, "venue_name": venue})
    hard = [x for x in signals if x.startswith("fail:") and x != "fail:no_positive"
            and not (x.startswith("fail:event:other_city:") and x.rsplit(":", 1)[-1] in excused)]
    if hard:
        return "country", signals
    if venue and _valid_geo(doc.get("lat"), doc.get("lng")):
        geo = gate.geocode(venue, None, [], _gazetteer())
        if geo is not None and not _venue_compatible(doc, {"venue_name": venue}, geo):
            return "venue", venue
    return None


def _pending_notice(notice: Any, now: datetime) -> Optional[Dict[str, Any]]:
    """The unresolved 'nueva fecha' notice kept on a row in review, so approve_event can turn it
    into notice_ack (Phil read THIS notice and approved the row's dates)."""
    if not isinstance(notice, Mapping) or not isinstance(notice.get("fp"), str):
        return None
    return {"fp": notice["fp"], "marker": notice.get("marker"), "announced": {
        k: notice.get(k) for k in ("start_date", "end_date", "start_time")}, "at": _iso(now)}


def sentinel_transition(doc: Mapping[str, Any], rec: Mapping[str, Any], now: datetime, *,
                        agreed: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
    """Pure §15 S3 / §13 G state machine for one recheck result.

    Returns {set, unset, push, alert, log_reason, detail, source_alert}. The caller merges `set`
    into the doc, re-evaluates (sticky statuses stay) and writes. `agreed` = the new dates when
    ≥ 2 independent tier ≤ 3 pages agreed in this run (the only automatic date update, R1)."""
    out: Dict[str, Any] = {"set": {}, "unset": [], "push": None, "alert": None, "log_reason": None,
                           "detail": None, "source_alert": None}
    s, u = out["set"], out["unset"]
    today = _today(now)
    outcome = str(rec.get("outcome") or "blocked")
    status, reason = doc.get("status"), doc.get("status_reason")
    gone_hidden = status == "hidden" and reason == "source_gone"
    url = _recheck_url(doc)
    title = _title_line(doc)

    def verified() -> None:
        s.update(last_verified=_iso(now), not_found_count=0, blocked_days=0, gone_strikes=0)
        u.append("gone_first_at")
        s["evidence"] = merge_evidence(doc.get("evidence") or [], [recheck_evidence(doc, rec, url, now)])
        head = rec.get("head")
        if isinstance(head, Mapping):
            s.update({k: head.get(k) for k in ("etag", "last_modified", "content_length") if head.get(k) is not None})

    def apply_dates(new: Mapping[str, Any]) -> None:
        frm = {"start_date": doc.get("start_date"), "end_date": doc.get("end_date"), "start_time": doc.get("start_time")}
        to = {"start_date": new.get("start_date"), "end_date": new.get("end_date") or new.get("start_date"),
              "start_time": new.get("start_time") if doc.get("start_time") else None}
        s.update(start_date=to["start_date"], end_date=to["end_date"], start_time=to["start_time"],
                 time_confirmed=bool(to["start_time"]) and bool(doc.get("time_confirmed")))
        agreeing = [dict(e) for e in (new.get("entries") or []) if isinstance(e, Mapping)]
        if agreeing:
            s["evidence"] = merge_evidence(s.get("evidence") or doc.get("evidence") or [], agreeing)
        out["push"] = {"date_history": {"at": _iso(now), "from": frm, "to": to, "source": "sentinel",
                                        "urls": list(new.get("urls") or [])}}
        u.extend(["proposed_dates", "tbc_window_end", "date_tbc_note"] if to["start_date"] else ["proposed_dates"])
        if (frm["start_date"], frm["end_date"], frm["start_time"]) != (to["start_date"], to["end_date"], to["start_time"]):
            u.extend(date_change_unsets(doc))
        if status == "review" and reason in CLEARABLE_BY_AGREEMENT:
            s.update(status="published", status_reason=None)   # R1: ≥ 2 independent tier ≤ 3 pages agree
        out["log_reason"] = "dates_updated_by_agreement"
        out["detail"] = {"from": frm, "to": to}
        out["alert"] = f"📅 {title}: fecha actualizada {frm['start_date']} → {to['start_date']} (2 fuentes oficiales)"

    if outcome in ("success", "sold_out"):
        moved = recheck_moved(doc, rec, url)
        if moved is not None and moved[0] == "country":
            # §15 Q6: a stored fail is hidden/country_fail (sticky). Not a verification.
            sig = [str(x) for x in moved[1]][:40]
            s.update(country_check="fail", country_signals=sig, status="hidden", status_reason="country_fail",
                     hidden_at=_iso(now))
            out["alert"] = f"⛔ {title}: la fuente ahora lo ubica fuera de Cartagena ({', '.join(sig[:3])}) → oculto"
            out["log_reason"] = "country_fail_on_recheck"
            out["detail"] = {"signals": sig, "text": rec.get("event_text") or rec.get("found_date_text")}
            return out
        if moved is not None:
            if not (status == "review" and reason == "venue_changed"):
                s.update(status="review", status_reason="venue_changed", venue_reported=str(moved[1])[:200])
                out["alert"] = f"📍 {title}: la fuente ahora dice «{moved[1]}» (antes «{doc.get('venue_name')}») → revisión"
            out["log_reason"] = "venue_changed"
            out["detail"] = {"from": doc.get("venue_name"), "to": moved[1]}
            return out
        verified()
        s["sold_out"] = outcome == "sold_out" or bool(rec.get("sold_out"))
        if gone_hidden:
            s.update(status="review", status_reason="source_changed")   # revived: admin re-approves (§13 G)
            out["alert"] = f"↩️ {title}: la fuente volvió con la fecha (a revisión)"
            out["log_reason"] = "source_returned"
        elif agreed is not None and status == "review" and reason in CLEARABLE_BY_AGREEMENT:
            if agreed.get("start_date") != doc.get("start_date"):
                apply_dates(agreed)
            else:
                s.update(status="published", status_reason=None)
                out["log_reason"] = "cleared_by_agreement"
                out["alert"] = f"✅ {title}: 2 fuentes oficiales confirman la fecha (sale de revisión)"
        return out
    if outcome == "not_found":
        marker = rec.get("marker")
        head = rec.get("head")
        if marker == "no_baseline" and isinstance(head, Mapping):
            s.update({k: head.get(k) for k in ("etag", "last_modified", "content_length") if head.get(k) is not None})
            out["log_reason"] = "head_baseline"
            return out
        if marker == "no_validators":
            outcome = "blocked"
        else:
            nf = _int(doc.get("not_found_count")) + 1
            s["not_found_count"] = nf
            if nf >= NOT_FOUND_REVIEW and not gone_hidden and status != "hidden":
                s.update(status="review", status_reason="source_changed")
                out["alert"] = f"⚠️ {title}: la fuente ya no muestra el evento/fecha (2 veces) → revisión"
                out["log_reason"] = "not_found_twice"
            else:
                out["log_reason"] = "not_found"
            if isinstance(marker, str) and "_near_title:" in marker:
                # A cancel / 'nueva fecha' notice near the title on the source page: VERIFY now (the
                # not_found cap), reminders suppressed, and Phil hears about it the FIRST time.
                out["alert"] = out["alert"] or (f"⚠️ {title}: la fuente publica un aviso cerca del evento "
                                                f"({marker.split(':', 1)[1]}) → sin confirmar, revisar a mano")
                out["detail"] = marker
            return out
    if outcome == "blocked":
        if doc.get("blocked_last_day") != today:
            bd = _int(doc.get("blocked_days")) + 1
            s.update(blocked_days=bd, blocked_last_day=today)
            if bd >= BLOCKED_DECAY_DAYS:
                out["source_alert"] = str(doc.get("source_key") or gate.registrable_domain(url) or "?")
        out["log_reason"] = "blocked"
        out["detail"] = rec.get("marker")
        return out
    if outcome == "gone":
        if gone_hidden:
            return out
        strikes = _int(doc.get("gone_strikes"))
        first = gate.parse_iso(doc.get("gone_first_at"))
        if strikes >= 1 and first is not None and now - first >= GONE_MIN_GAP:
            s.update(status="hidden", status_reason="source_gone", hidden_at=_iso(now), gone_strikes=strikes + 1)
            out["alert"] = f"⛔ {title}: la página de la fuente desapareció (2 revisiones ≥ 6 h) → oculto"
            out["log_reason"] = "source_gone"
        elif strikes >= 1:
            out["log_reason"] = "gone_strike_wait"
        else:
            s.update(gone_strikes=1, gone_first_at=_iso(now))
            out["log_reason"] = "gone_strike_1"
        out["detail"] = rec.get("marker")
        return out
    if outcome == "cancel_marker":
        if status != "hidden":
            s.update(status="hidden", status_reason="cancel_marker", hidden_at=_iso(now))
            out["alert"] = f"⛔ {title}: la fuente lo anuncia cancelado/aplazado ({rec.get('marker')}) → oculto"
            out["log_reason"] = "cancel_marker"
            out["detail"] = rec.get("marker")
        return out
    if outcome == "changed":
        s.update(status="review", status_reason="source_changed")
        head = rec.get("head")
        if isinstance(head, Mapping):
            s["head_seen"] = dict(head)
        out["alert"] = f"⚠️ {title}: el PDF de la fuente cambió → revisión"
        out["log_reason"] = "source_changed"
        return out
    if outcome == "date_changed":
        parsed = _as_map(rec.get("parsed"))
        notice = str(rec.get("marker") or "").startswith("date_notice")
        same_as_stored = parsed.get("start_date") in (None, doc.get("start_date"))
        pending = _pending_notice(rec.get("notice"), now)
        if notice and same_as_stored:
            # The notice names no parseable date (or two different ones) and the block's own parse
            # is the stored date. Never auto-clear, never propose the stored date back:
            # review/date_changed + alert; Phil reads the page. Approving it acknowledges THIS
            # notice (pending_notice → notice_ack), so an unchanged banner does not loop daily.
            if status != "hidden":
                s.update(status="review", status_reason="date_changed")
                u.append("proposed_dates")
                if pending:
                    s["pending_notice"] = pending
                out["alert"] = f"📅 {title}: la fuente anuncia «{str(rec.get('marker')).split(':', 1)[-1]}» (a revisión)"
            out["log_reason"] = "date_notice"
            out["detail"] = {"marker": rec.get("marker"), "parsed": dict(parsed)}
            return out
        if rec.get("time_only"):
            if doc.get("start_time"):
                u.extend(date_change_unsets(doc))
            s.update(start_time=None, time_confirmed=False, confidence_cap="VERIFY",
                     confidence_cap_reason="time_changed", last_verified=_iso(now),
                     evidence=merge_evidence(doc.get("evidence") or [], [recheck_evidence(doc, rec, url, now)]))
            out["alert"] = (f"🕒 {title}: la hora cambió ({doc.get('start_time')} → "
                            f"{parsed.get('start_time') or '¿?'}) → sin hora, sin confirmar")
            out["log_reason"] = "time_changed"
            out["detail"] = {"from": doc.get("start_time"), "to": parsed.get("start_time")}
            return out
        if agreed is not None and parsed.get("start_date") and agreed.get("start_date") == parsed.get("start_date") \
                and status != "hidden":
            verified()
            apply_dates(agreed)
            return out
        if status != "hidden":
            if notice and pending:
                s["pending_notice"] = pending
            s.update(status="review", status_reason="date_changed",
                     proposed_dates={"start_date": parsed.get("start_date"),
                                     "end_date": parsed.get("end_date") or parsed.get("start_date"),
                                     "start_time": parsed.get("start_time"), "source_url": url, "at": _iso(now)})
            out["alert"] = (f"📅 {title}: la fuente muestra otra fecha {doc.get('start_date')} → "
                            f"{parsed.get('start_date')} (a revisión)")
            out["log_reason"] = "date_changed"
            out["detail"] = {"marker": rec.get("marker"), "parsed": dict(parsed)}
        return out
    out["log_reason"] = f"unhandled:{outcome}"
    return out


def _sentinel_priority(doc: Mapping[str, Any], now: datetime) -> Tuple[int, str]:
    """§15 S3: notif-eligible rows starting within 48 h first, then last_verified ascending."""
    urgent = 1
    try:
        pv = gate.public_view(doc, now, True)
        sd, st = (pv or {}).get("start_date"), (pv or {}).get("start_time")
        if pv and pv.get("notif_eligible") and isinstance(sd, str) and isinstance(st, str):
            start = datetime.combine(date.fromisoformat(sd), time.fromisoformat(st), BOGOTA)
            if timedelta(0) <= start - _bogota(now) <= PRIORITY_WINDOW:
                urgent = 0
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] sentinel priority failed: %s", type(exc).__name__)
    raw_lv = doc.get("last_verified")
    return urgent, raw_lv if isinstance(raw_lv, str) else ""


async def _agreement(client: Any, doc: Mapping[str, Any], rec: Mapping[str, Any], target: Mapping[str, Any],
                     recheck_fn: RecheckFn, *, sched: Any, cache: Dict[str, Any], now: datetime,
                     disabled: Sequence[str]) -> Optional[Dict[str, Any]]:
    """R1 / S3: recheck the row's OTHER tier ≤ 3 pages (distinct mirror groups) in this run and
    return the target dates when ≥ 2 independent tier ≤ 3 pages agree on them."""
    primary = _recheck_url(doc)
    tgt_start = target.get("start_date")
    if not isinstance(tgt_start, str):
        return None
    entries: List[Dict[str, Any]] = []
    evid: List[Dict[str, Any]] = []
    p = _as_map(rec.get("parsed"))
    if p.get("start_date"):
        entries.append({"url": primary, "tier": gate.domain_tier(primary, doc.get("source_tier")),
                        "http_status": 200, "start_date": p.get("start_date"), "start_time": None,
                        "date_text": rec.get("found_date_text")})
    groups = {gate.mirror_group(primary)}
    others: List[str] = []
    for u in [doc.get("second_source_url")] + [e.get("url") for e in (doc.get("evidence") or []) if isinstance(e, Mapping)]:
        if not gate.is_http_url(u):
            continue
        t = gate.domain_tier(u)
        g = gate.mirror_group(u)
        if t is None or t > 3 or g in groups:
            continue
        groups.add(g)
        others.append(str(u))
    for u in others[:2]:
        shadow = {k: v for k, v in doc.items() if k not in ("source_key", "recheck_url")}
        shadow.update(source_url=u, recheck_url=u)
        try:
            r2 = await recheck_fn(client, shadow, sched=sched, cache=cache, now_utc=now, disabled=disabled)
        except sources.DeadlineReached:
            break
        except Exception as exc:  # noqa: BLE001
            logger.error("[events] agreement recheck failed: %s", type(exc).__name__)
            continue
        p2 = _as_map(r2.get("parsed"))
        if r2.get("outcome") in ("success", "sold_out", "date_changed") and p2.get("start_date"):
            entries.append({"url": u, "tier": gate.domain_tier(u), "http_status": 200,
                            "start_date": p2.get("start_date"), "start_time": None,
                            "date_text": r2.get("found_date_text")})
            if p2.get("start_date") == tgt_start:
                evid.append(recheck_evidence(shadow, r2, u, now))
    if gate.independent_agreement(entries, tgt_start, None, max_tier=3):
        return {"start_date": tgt_start, "end_date": target.get("end_date") or tgt_start,
                "start_time": target.get("start_time"), "urls": [e["url"] for e in entries], "entries": evid}
    return None


async def _expire_pass(db_: Any, now: datetime, alerts: List[str]) -> int:
    """The sentinel also expires past events (stored status cache; reads re-evaluate anyway)."""
    today = _today(now)
    q = {"status": {"$in": list(LIVE_STATUSES)},
         "$or": [{"end_date": {"$lt": today}}, {"tbc_window_end": {"$lt": today}}]}
    n = 0
    try:
        rows = await db_.city_events.find(q, {"_id": 0}).limit(300).to_list(length=300)
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] expire query failed: %s", type(exc).__name__)
        return 0
    for doc in rows or []:
        ev = _apply_eval(doc, now)
        if ev["status"] == "expired" and doc.get("status") != "expired":
            try:
                await db_.city_events.update_one({"event_id": doc["event_id"]},
                                                 {"$set": {**ev, "updated_at": _iso(now)}})
                await _log(db_, doc["event_id"], "sentinel", doc.get("status"), "expired", ev["status_reason"], None, now)
                n += 1
            except Exception as exc:  # noqa: BLE001
                logger.error("[events] expire write failed: %s", type(exc).__name__)
    return n


SENTINEL_MAIN_EVERY = timedelta(hours=12)      # §16.4: a main pass is due when none finished in 12 h
SENTINEL_TODAY_FROM_UTC = time(16, 0)           # §16.4: the 'today' slot runs once after 16:00 UTC


async def sentinel_due_slot(db_: Any, now: Optional[datetime] = None) -> Optional[str]:
    """§16.4 self-healing schedule for the */15 sentinel cron. 'main' when no done MAIN-slot
    run finished within 12 h AND today's (Bogotá) main pass is not done yet — so the pass starts
    at the first tick after Bogotá midnight (or 12 h after the previous one) and resumes tick
    after tick until done; else 'today' when it is past 16:00 UTC and no done 'today'-slot run
    finished since 16:00 UTC today; else None (no-op). A failed read answers 'main': the day's
    cursor keeps that idempotent, and skipping could starve the watchdog (§15 R4)."""
    n = _now(now)
    try:
        main = await db_.city_events_runs.find_one({"kind": "sentinel", "done": True, "slot": {"$ne": "today"}},
                                                   sort=[("finished_at", -1)])
        fin = runtime.run_finished_at(main)
        cur = await db_.city_events_state.find_one({"_id": "cursor:sentinel"})
        main_done_today = isinstance(cur, Mapping) and cur.get("day") == _today(n) and cur.get("done") is True
        if (fin is None or n - fin >= SENTINEL_MAIN_EVERY) and not main_done_today:
            return "main"
        from_dt = datetime.combine(n.astimezone(timezone.utc).date(), SENTINEL_TODAY_FROM_UTC, timezone.utc)
        if n < from_dt:
            return None
        tod = await db_.city_events_runs.find_one({"kind": "sentinel", "done": True, "slot": "today"},
                                                  sort=[("finished_at", -1)])
        tfin = runtime.run_finished_at(tod)
        if tfin is None or tfin < from_dt:
            return "today"
        return None
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] sentinel schedule read failed: %s", type(exc).__name__)
        return "main"


async def run_sentinel(db_: Any, *, now: Optional[datetime] = None, slot: Optional[str] = None, dry: bool = False,
                       actor: str = "cron", budget_s: float = RUN_BUDGET_S, recheck_fn: Optional[RecheckFn] = None,
                       client_factory: Optional[ClientFactory] = None) -> Dict[str, Any]:
    """One sentinel invocation. Main slot: every published/date_tbc row (+ source_gone revivals
    and clearable review rows) once per Bogotá day. slot='today': rows that start today."""
    started = _now(now)
    t0 = _time.monotonic()
    dispatch_deadline = t0 + min(DISPATCH_BUDGET_S, max(1.0, budget_s - 10.0))
    today = _today(started)
    slot = "today" if slot == "today" else "main"
    run_id = _run_id("sentinel", started)
    cid = "cursor:sentinel" if slot == "main" else "cursor:sentinel:today"
    mark_field = "sentinel_day" if slot == "main" else "sentinel_today_day"
    flags = await runtime.get_flags(db_)
    disabled = list(flags.get("sources_disabled") or [])
    recheck = recheck_fn or sources.recheck_doc
    alerts: List[str] = []
    errors: List[str] = []
    counts: Dict[str, int] = {}
    source_alerts: Set[str] = set()
    changes: List[Dict[str, Any]] = []

    if not dry:
        claimed = await _claim(db_, cid, started, run_id)
        if claimed is None:
            return {"run_id": run_id, "skipped": "lease_held"}
        cur = claimed
        if cur.get("day") != today:
            cur = {"day": today, "done": False, "inflight": None, "counts": {}}
            await _save_cursor(db_, cid, run_id, cur)
        if cur.get("done"):
            await _save_cursor(db_, cid, run_id, {"lease_until": _iso(started)})
            return {"run_id": run_id, "done": True, "noop": True}
        infl = cur.get("inflight")
        if isinstance(infl, str) and infl:
            errors.append(f"poison_skipped:{infl}")
            try:
                await db_.city_events.update_one({"event_id": infl}, {"$set": {mark_field: today}})
            except Exception as exc:  # noqa: BLE001
                logger.error("[events] poison mark failed: %s", type(exc).__name__)
            await _log(db_, infl, "sentinel", None, None, "poison_skipped", "previous invocation died on this row", started)
            await _save_cursor(db_, cid, run_id, {"inflight": None})
        if slot == "main":
            counts["expired"] = await _expire_pass(db_, started, alerts)

    if slot == "main":
        revive_from = (_bogota(started) - timedelta(days=GONE_REVIVE_DAYS)).date().isoformat()
        q: Dict[str, Any] = {"$or": [
            {"status": {"$in": list(LIVE_STATUSES)}},
            {"status": "hidden", "status_reason": "source_gone", "hidden_at": {"$gte": revive_from}},
            {"status": "review", "status_reason": {"$in": list(SENTINEL_REVIEW_REASONS)}},
        ], mark_field: {"$ne": today}}
    else:
        q = {"status": "published", "start_date": today, mark_field: {"$ne": today}}
    query_failed = False
    try:
        rows = await db_.city_events.find(q, {"_id": 0}).limit(SENTINEL_MAX_ROWS).to_list(length=SENTINEL_MAX_ROWS)
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] sentinel query failed: %s", type(exc).__name__)
        rows = []
        errors.append("query_failed")
        query_failed = True
    rows = sorted((dict(r) for r in rows or []), key=lambda d: _sentinel_priority(d, started))
    make = client_factory or sources.make_client
    client = make()
    sched = sources.PoliteScheduler(dispatch_deadline)
    cache: Dict[str, Any] = {}          # §13 F4: one fetch per unique URL per run, fanned out
    processed = 0
    try:
        for doc in rows:
            if _time.monotonic() >= dispatch_deadline:
                break
            eid = doc.get("event_id")
            if not dry:
                await _save_cursor(db_, cid, run_id, {"inflight": eid})
            try:
                rec = await recheck(client, doc, sched=sched, cache=cache, now_utc=started, disabled=disabled)
            except sources.DeadlineReached:
                break
            except Exception as exc:  # noqa: BLE001
                logger.error("[events] recheck crashed for a row: %s", type(exc).__name__)
                rec = sources.make_recheck("blocked", marker="recheck_crash")
            outcome = str(rec.get("outcome"))
            counts[outcome] = counts.get(outcome, 0) + 1
            agreed: Optional[Dict[str, Any]] = None
            try:
                parsed = _as_map(rec.get("parsed"))
                clearable = doc.get("status") == "review" and doc.get("status_reason") in CLEARABLE_BY_AGREEMENT
                target: Optional[Mapping[str, Any]] = None
                notice_same = str(rec.get("marker") or "").startswith("date_notice") and \
                    parsed.get("start_date") == doc.get("start_date")
                if outcome == "date_changed" and not rec.get("time_only") and parsed.get("start_date") \
                        and not notice_same:
                    target = parsed                      # the page states new dates: do 2 independent pages agree?
                elif outcome in ("success", "sold_out") and clearable:
                    target = {"start_date": doc.get("start_date"), "end_date": doc.get("end_date"),
                              "start_time": doc.get("start_time")}   # the stored dates re-confirmed
                if target is not None:
                    agreed = await _agreement(client, doc, rec, target, recheck, sched=sched, cache=cache,
                                              now=started, disabled=disabled)
            except sources.DeadlineReached:
                agreed = None
            tr = sentinel_transition(doc, rec, started, agreed=agreed)
            if tr["source_alert"]:
                source_alerts.add(tr["source_alert"])
            changes.append({"event_id": eid, "outcome": outcome, "log": tr["log_reason"],
                            "set": sorted(tr["set"]), "marker": rec.get("marker")})
            processed += 1
            if dry:
                continue
            fields = dict(tr["set"])
            fields[mark_field] = today
            fields["last_sentinel"] = {"at": _iso(started), "outcome": outcome, "marker": rec.get("marker")}
            detail = {"outcome": outcome, "marker": rec.get("marker"), "why": tr["log_reason"], "detail": tr["detail"]}
            try:
                _, changed = await _write_status(db_, doc, fields, actor="sentinel", now=started, unset=tr["unset"],
                                                 push=tr["push"], alerts=None, log_detail=detail)
                if not changed:
                    # §7: every recheck leaves an audit row, even when nothing public changed.
                    await _log(db_, eid, "sentinel", doc.get("status"), doc.get("status"),
                               tr["log_reason"] or outcome, detail, started)
            except Exception as exc:  # noqa: BLE001
                logger.error("[events] sentinel write failed: %s", type(exc).__name__)
                errors.append(f"write:{type(exc).__name__}")
            if tr["alert"]:
                alerts.append(tr["alert"])
            await _save_cursor(db_, cid, run_id, {"inflight": None})
    finally:
        try:
            await client.aclose()
        except Exception as exc:  # noqa: BLE001
            logger.error("[events] client close failed: %s", type(exc).__name__)

    remaining = len(rows) - processed
    # Nothing was rechecked when the row query failed: never a completed (healthy) run — the cursor
    # stays open so the next */10 tick retries, and the R4 watchdog keeps counting.
    done = not query_failed and remaining <= 0 and len(rows) < SENTINEL_MAX_ROWS
    if dry:
        return {"run_id": run_id, "dry": True, "slot": slot, "rows": len(rows), "processed": processed,
                "counts": counts, "changes": changes[:200]}
    for src in sorted(source_alerts):
        if await _alert_once(db_, today, f"blocked:{src}"):
            alerts.append(f"🔒 Fuente {src} bloqueada 3 días seguidos: re-verificar a mano (eventos en VERIFY)")
    try:
        inc = {f"counts.{k}": v for k, v in counts.items()}
        upd: Dict[str, Any] = {"$set": {"done": done, "inflight": None,
                                        "lease_until": _iso(started - timedelta(seconds=1))}}
        if inc:
            upd["$inc"] = inc
        await db_.city_events_state.update_one({"_id": cid, "run_id": run_id}, upd)
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] sentinel cursor close failed: %s", type(exc).__name__)
    await _write_run(db_, _run_row("sentinel", run_id, started, actor, t0=t0, slot=slot, done=done, rows=len(rows),
                                   processed=processed, remaining=max(0, remaining), errors=errors, **counts))
    runtime.invalidate_caches()
    await _alert(alerts, title="AMO · Agenda (centinela)")
    if done and slot == "main":
        await _send_digest(db_, started)
    return {"run_id": run_id, "slot": slot, "done": done, "rows": len(rows), "processed": processed,
            "counts": counts, "errors": errors[:30]}


async def _send_digest(db_: Any, now: datetime) -> None:
    """Once per Bogotá day, when the main sentinel reaches done (§13 F3)."""
    today = _today(now)
    try:
        await db_.city_events_state.insert_one({"_id": f"digest:{today}", "at": _iso(now)})
    except DuplicateKeyError:
        return
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] digest claim failed: %s", type(exc).__name__)
        return
    lines: List[str] = []
    try:
        by_status: Dict[str, int] = {}
        for st in ("published", "date_tbc", "review", "hidden", "expired"):
            by_status[st] = await db_.city_events.count_documents({"status": st})
        lines.append("Estado: " + " · ".join(f"{k} {v}" for k, v in by_status.items()))
        cur = await db_.city_events_state.find_one({"_id": "cursor:sentinel"})
        if isinstance(cur, Mapping) and isinstance(cur.get("counts"), Mapping):
            lines.append("Centinela hoy: " + " · ".join(f"{k} {v}" for k, v in sorted(cur["counts"].items())))
        pulls = await db_.city_events_runs.find({"kind": "pull", "started_at": {"$gte": today}}, {"_id": 0}) \
            .sort("started_at", -1).limit(20).to_list(length=20)
        if pulls:
            agg = {k: sum(_int(p.get(k)) for p in pulls) for k in ("found", "inserted", "held_review",
                                                                   "dropped_wrong_country", "dropped_past")}
            lines.append("Pull hoy: " + " · ".join(f"{k} {v}" for k, v in agg.items()))
        review = await db_.city_events.count_documents({"status": "review"})
        if review:
            lines.append(f"Pendientes de revisión: {review} (panel admin)")
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] digest build failed: %s", type(exc).__name__)
    # Partner-submitted events waiting for a human (P0-B, audit 2026-10-01): the
    # digest counted city_events only, so a stale partner queue (Casa Bohème,
    # Aug 22 → Sep 29) never appeared here. Own try-block: never costs the rest.
    try:
        import partner_events_sweep as _pes  # lazy — no import cycle at module load
        pe = await _pes.pending_summary(db_, now)
        tail = f" · el más antiguo lleva {pe['oldest_age_h']} h" if pe.get("oldest_age_h") is not None else ""
        lines.append(f"Eventos de partners pendientes de revisión: {pe['count']}{tail}")
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] digest partner-events summary failed: %s", type(exc).__name__)
    await telegram_alerts.digest(f"AMO · Agenda · resumen {today}", lines)


# ═════════════════════════════════════════════════════════════════════════════
# REMINDERS (§13 H, §15 U)
# ═════════════════════════════════════════════════════════════════════════════

_WHEN = {
    "es": "Hoy a las {t}", "en": "Today at {t}", "fr": "Aujourd'hui à {t}", "pt": "Hoje às {t}",
}
_SRC = {"es": "Fuente", "en": "Source", "fr": "Source", "pt": "Fonte"}


def _clip(s: str, n: int) -> str:
    s = s.strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def reminder_text(pv: Mapping[str, Any], lang: str, *, limits: Tuple[int, int]) -> Tuple[str, str]:
    """(title, body): title, venue, time and 'Fuente: <source_name>' (§13 H5)."""
    lg = lang if lang in PREF_LANGS else "es"
    titles = _as_map(pv.get("title"))
    title = str(titles.get(lg) or titles.get("es") or "")
    t = str(pv.get("start_time") or "")
    when = _WHEN[lg].format(t=t)
    venue = pv.get("venue_name") if isinstance(pv.get("venue_name"), str) else ""
    src = pv.get("source_name") if isinstance(pv.get("source_name"), str) and pv.get("source_name") else \
        (gate.registrable_domain(pv.get("source_url")) or "")
    footer = f"{_SRC[lg]}: {src}"
    head = f"{when} · {venue}" if venue else when
    body = _clip(f"{head}\n{footer}", limits[1])
    if footer not in body:   # the source line is mandatory: shorten the venue, never the citation
        room = max(10, limits[1] - len(footer) - len(when) - 5)
        body = f"{when} · {_clip(venue, room)}\n{footer}" if venue else f"{when}\n{footer}"
    return _clip(title, limits[0]), body


def reminder_due(pv: Mapping[str, Any], now: datetime) -> bool:
    """§15 U timing: first tick in [start−180, start−30] ∩ [09:00, 21:00] Bogotá; start_time
    required; multi-day events only on their first day."""
    now_b = _bogota(now)
    if pv.get("start_date") != now_b.date().isoformat():
        return False
    st = pv.get("start_time")
    if not isinstance(st, str):
        return False
    try:
        start = datetime.combine(now_b.date(), time.fromisoformat(st), BOGOTA)
    except ValueError:
        return False
    lead_min = (start - now_b).total_seconds() / 60.0
    if not (REMINDER_LEAD_MIN[0] <= lead_min <= REMINDER_LEAD_MIN[1]):
        return False
    hm = now_b.strftime("%H:%M")
    return REMINDER_HOURS[0] <= hm <= REMINDER_HOURS[1]


def _verified_today(pv: Mapping[str, Any], now: datetime) -> bool:
    lv = gate.parse_iso(pv.get("last_verified"))
    return lv is not None and lv.astimezone(BOGOTA).date() == _bogota(now).date()


async def _default_push(db_: Any, user_id: str, title: str, body: str, data: Dict[str, Any]) -> Dict[str, Any]:
    import push as _push
    return await _push.push_to_user(db_, user_id, title, body, data=data)


async def _default_webpush(db_: Any, user_id: str, title: str, body: str, url: str, scope: str) -> Dict[str, Any]:
    import webpush as _webpush
    return await _webpush.send_to_subscriptions(db_, user_id, title, body, url, scope=scope)


async def run_reminders(db_: Any, *, now: Optional[datetime] = None, dry: bool = False, actor: str = "cron",
                        recheck_fn: Optional[RecheckFn] = None, client_factory: Optional[ClientFactory] = None,
                        push_fn: Optional[PushFn] = None, webpush_fn: Optional[PushFn] = None,
                        budget_s: float = RUN_BUDGET_S) -> Dict[str, Any]:
    """§15 U, exact order. Only saved, notif-eligible (HIGH, published, geocoded, timed,
    time-confirmed), verified-today events that pass a live recheck right now."""
    started = _now(now)
    t_start = _time.monotonic()
    t_end = t_start + budget_s
    today = _today(started)
    run_id = _run_id("reminders", started)
    out: Dict[str, Any] = {"run_id": run_id, "dry": dry, "events": [], "sent": 0, "would_send": [],
                           "suppressed": [], "skipped": {}}

    def skip(reason: str) -> None:
        out["skipped"][reason] = out["skipped"].get(reason, 0) + 1

    flags = await runtime.get_flags(db_)
    if not flags.get("enabled"):
        out["refused"] = "disabled"
        return out
    hm = _bogota(started).strftime("%H:%M")
    if not (REMINDER_HOURS[0] <= hm <= REMINDER_HOURS[1]):
        out["refused"] = "quiet_hours"
        return out
    if not await runtime.sentinel_healthy(db_, started):
        out["refused"] = "sentinel_unhealthy"   # §15 R4: reminders refused + one alert per day
        if not dry and await _alert_once(db_, today, "watchdog"):
            await _alert(["🛑 Centinela sin correr en 26 h: agenda servida como VERIFY, recordatorios detenidos."])
        return out
    # Only rows starting today can be due (multi-day events: first day only, §15 U); the prefilter
    # keeps a busy calendar from pushing today's rows past the public_rows cap.
    rows = await runtime.public_rows(db_, statuses=("published",), min_confidence="HIGH", now=started, limit=400,
                                     extra_query={"start_date": today})
    due = [pv for pv in rows if pv.get("notif_eligible") and pv.get("start_time") and _verified_today(pv, started)
           and reminder_due(pv, started)]
    if not due:
        return out
    recheck = recheck_fn or sources.recheck_doc
    push_send = push_fn or _default_push
    web_send = webpush_fn or _default_webpush
    client = (client_factory or sources.make_client)()
    sched = sources.PoliteScheduler(_time.monotonic() + min(DISPATCH_BUDGET_S, budget_s))
    cache: Dict[str, Any] = {}
    alerts: List[str] = []
    users_done = 0
    try:
        for pv in due:
            eid = str(pv["event_id"])
            ev_out: Dict[str, Any] = {"event_id": eid, "users": 0}
            out["events"].append(ev_out)
            doc = await runtime.resolve_event(db_, eid)
            if doc is None:
                continue
            # 2. live recheck, once per event per invocation (cached)
            try:
                rec = await recheck(client, doc, sched=sched, cache=cache, now_utc=started,
                                    disabled=list(flags.get("sources_disabled") or []))
            except sources.DeadlineReached:
                break
            except Exception as exc:  # noqa: BLE001
                logger.error("[events] reminder recheck crashed: %s", type(exc).__name__)
                rec = {"outcome": "blocked", "marker": "recheck_crash"}
            if rec.get("outcome") == "success":
                # A second listing (another ticketer / the organiser) may carry the cancellation or
                # the new date the primary page does not show yet: it can veto, never approve.
                try:
                    veto = await _second_source_veto(client, doc, recheck, sched=sched, cache=cache, now=started,
                                                     disabled=list(flags.get("sources_disabled") or []))
                except sources.DeadlineReached:
                    break      # no time left to check it: nobody is reminded of this event this tick
                if veto is not None:
                    rec = veto
            if rec.get("outcome") != "success":
                ev_out["suppressed"] = rec.get("outcome")
                out["suppressed"].append({"event_id": eid, "outcome": rec.get("outcome"), "marker": rec.get("marker")})
                if not dry:
                    await _log(db_, eid, "reminders", None, None, "reminder_suppressed",
                               {"outcome": rec.get("outcome"), "marker": rec.get("marker")}, started)
                    if await _alert_once(db_, today, f"rem:{eid}"):
                        alerts.append(f"🔕 Recordatorio suprimido: {_title_line(pv)} (recheck {rec.get('outcome')})")
                continue
            ids = [eid] + [a for a in (doc.get("aliases") or []) if isinstance(a, str)]
            try:
                favs = await db_.favorites.find(
                    {"item_type": {"$in": list(FAVORITE_EVENT_TYPES)}, "item_id": {"$in": ids}},
                    {"_id": 0, "user_id": 1}).to_list(length=5000)
            except Exception as exc:  # noqa: BLE001
                logger.error("[events] favorites read failed: %s", type(exc).__name__)
                continue
            user_ids = sorted({f.get("user_id") for f in favs or [] if isinstance(f.get("user_id"), str) and f.get("user_id")})
            for uid in user_ids:
                # a user is started only while a worst-case send (PUSH_TIMEOUT_S) still ends within
                # Vercel's 60 s (the 40 s budget + a 5 s margin)
                if users_done >= REMINDER_MAX_USERS or _time.monotonic() >= t_end - max(0.0, PUSH_TIMEOUT_S - 5.0):
                    skip("budget")
                    break
                users_done += 1
                sent = await _remind_user(db_, uid, pv, today=today, now=started, dry=dry, out=out,
                                          push_send=push_send, web_send=web_send, skip=skip)
                if sent:
                    ev_out["users"] += 1
    finally:
        try:
            await client.aclose()
        except Exception as exc:  # noqa: BLE001
            logger.error("[events] client close failed: %s", type(exc).__name__)
    if not dry:
        await _alert(alerts, title="AMO · Agenda (recordatorios)")
        await _write_run(db_, _run_row("reminders", run_id, started, actor, t0=t_start, done=True, sent=out["sent"],
                                       events=len(out["events"]), suppressed=len(out["suppressed"]),
                                       skipped=dict(out["skipped"])))
    return out


async def _second_source_veto(client: Any, doc: Mapping[str, Any], recheck: RecheckFn, *, sched: Any,
                              cache: Dict[str, Any], now: datetime, disabled: Sequence[str]) -> Optional[Dict[str, Any]]:
    """Recheck second_source_url (another mirror group than the primary). Returns a recheck to
    suppress with when that page reports a cancellation, a date change or a notice near the
    title; None otherwise (blocked / not found there never blocks a verified primary)."""
    second = doc.get("second_source_url")
    if not gate.is_http_url(second) or gate.mirror_group(second) == gate.mirror_group(_recheck_url(doc)):
        return None
    tier = gate.domain_tier(second, doc.get("second_source_tier"))
    if tier is None or tier > 5:
        return None
    shadow = {k: v for k, v in doc.items() if k not in ("source_key", "recheck_url")}
    shadow.update(source_url=second, recheck_url=second)
    try:
        r2 = await recheck(client, shadow, sched=sched, cache=cache, now_utc=now, disabled=disabled)
    except sources.DeadlineReached:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] second-source recheck failed: %s", type(exc).__name__)
        return None
    marker = str(r2.get("marker") or "")
    if r2.get("outcome") in ("cancel_marker", "date_changed") or "_near_title:" in marker:
        return {**r2, "outcome": str(r2.get("outcome")), "marker": f"second_source:{marker or r2.get('outcome')}"}
    return None


async def _remind_user(db_: Any, uid: str, pv: Mapping[str, Any], *, today: str, now: datetime, dry: bool,
                       out: Dict[str, Any], push_send: PushFn, web_send: PushFn,
                       skip: Callable[[str], None]) -> bool:
    eid = str(pv["event_id"])
    # 1. missing / deleted users
    try:
        user = await db_.users.find_one({"user_id": uid}, {"_id": 0, "user_id": 1, "deleted_at": 1})
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] user read failed: %s", type(exc).__name__)
        return False
    if not isinstance(user, Mapping) or user.get("deleted_at"):
        skip("user_missing")
        return False
    try:
        prefs = await db_.event_notif_prefs.find_one({"user_id": uid}, {"_id": 0})
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] prefs read failed: %s", type(exc).__name__)
        prefs = None
    prefs = prefs if isinstance(prefs, Mapping) else {}
    if prefs.get("reminders_enabled") is False:
        skip("prefs_off")
        return False
    lang = prefs.get("lang") if prefs.get("lang") in PREF_LANGS else "es"
    e_title, e_body = reminder_text(pv, str(lang), limits=EXPO_LIMITS)
    w_title, w_body = reminder_text(pv, str(lang), limits=WEB_LIMITS)
    if dry:
        try:
            if await db_.event_reminders_sent.find_one({"user_id": uid, "event_id": eid}):
                skip("already_sent")
                return False
            if await db_.event_push_log.find_one({"user_id": uid, "date": today}):
                skip("daily_cap")
                return False
        except Exception as exc:  # noqa: BLE001
            logger.error("[events] dry read failed: %s", type(exc).__name__)
        out["would_send"].append({"user_id": uid, "event_id": eid, "lang": lang, "title": e_title, "body": e_body})
        return True
    # 2. the unique atomic claim
    try:
        await db_.event_reminders_sent.insert_one({"user_id": uid, "event_id": eid, "state": "claimed",
                                                   "at": _iso(now), "date": today})
    except DuplicateKeyError:
        skip("already_sent")
        return False
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] claim failed: %s", type(exc).__name__)
        return False
    # 3. the per-day event-push cap (separate from push_log)
    try:
        await db_.event_push_log.insert_one({"user_id": uid, "date": today, "event_id": eid, "at": _iso(now)})
    except DuplicateKeyError:
        await _safe_delete(db_.event_reminders_sent, {"user_id": uid, "event_id": eid})
        skip("daily_cap")
        return False
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] cap insert failed: %s", type(exc).__name__)
        await _safe_delete(db_.event_reminders_sent, {"user_id": uid, "event_id": eid})
        return False
    # 4. send (Expo + web push 'events' scope), both channels at once under one outer cap each
    data = {"kind": "event_reminder", "event_id": eid}

    async def channel(name: str, coro: Awaitable[Any]) -> Tuple[int, bool]:
        """(sent, uncertain). A timeout or an exception is an UNKNOWN outcome: the push may
        already be on the device (a worker thread keeps sending after a cancel)."""
        try:
            r = await asyncio.wait_for(coro, timeout=PUSH_TIMEOUT_S)
        except asyncio.TimeoutError:
            logger.error("[events] %s reminder timed out", name)
            return 0, True
        except Exception as exc:  # noqa: BLE001
            logger.error("[events] %s reminder failed: %s", name, type(exc).__name__)
            return 0, True
        r = r if isinstance(r, Mapping) else {}
        return _int(r.get("sent")), _int(r.get("uncertain")) > 0

    (s1, u1), (s2, u2) = await asyncio.gather(
        channel("expo", push_send(db_, uid, e_title, e_body, data)),
        channel("web", web_send(db_, uid, w_title, w_body, f"/event/{eid}", "events")))
    delivered = s1 + s2
    # 5. state sent; delete both rows ONLY when every channel returned normally with nothing sent.
    #    An unknown outcome keeps the claim and the daily cap (state 'uncertain'): a possible
    #    duplicate every 15 min is worse than one possibly-missed reminder (§15 U 4–5).
    if delivered <= 0 and (u1 or u2):
        try:
            await db_.event_reminders_sent.update_one({"user_id": uid, "event_id": eid},
                                                      {"$set": {"state": "uncertain", "uncertain_at": _iso(now)}})
        except Exception as exc:  # noqa: BLE001
            logger.error("[events] reminder uncertain mark failed: %s", type(exc).__name__)
        skip("uncertain")
        return False
    if delivered <= 0:
        await _safe_delete(db_.event_reminders_sent, {"user_id": uid, "event_id": eid})
        await _safe_delete(db_.event_push_log, {"user_id": uid, "date": today})
        skip("no_channel")
        return False
    try:
        await db_.event_reminders_sent.update_one({"user_id": uid, "event_id": eid},
                                                  {"$set": {"state": "sent", "sent_at": _iso(now)}})
        await db_.notifications.insert_one({
            "notification_id": f"notif_{uuid.uuid4().hex[:12]}", "user_id": uid, "audience": "user",
            "type": "event_reminder", "kind": "event_reminder", "title": e_title, "body": e_body,
            "ref": {"event_id": eid}, "read": False, "is_read": False, "created_at": _iso(now),
        })
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] reminder bookkeeping failed: %s", type(exc).__name__)
    out["sent"] += 1
    return True


async def _safe_delete(coll: Any, q: Mapping[str, Any]) -> None:
    try:
        await coll.delete_one(dict(q))
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] cleanup delete failed: %s", type(exc).__name__)


# ═════════════════════════════════════════════════════════════════════════════
# ANCHORS (§6, §15 W2) and LEGACY IMPORT (§13 L)
# ═════════════════════════════════════════════════════════════════════════════

_ANCHOR_DESCRIPTIVE = ("title", "description", "category", "venue_name", "address", "price", "ticket_url",
                       "source_name", "second_source_url", "second_source_name", "second_source_tier",
                       "image_url", "image_credit", "recheck_url", "confidence_cap", "recent_confirmation_days",
                       "date_tbc_note", "flagship")
_ANCHOR_DROP = ("key", "status_hint", "status_reason_hint", "hint_note", "parent_key", "venue_gazetteer_id")


def _anchor_country(a: Mapping[str, Any], g: Mapping[str, Any]) -> Tuple[str, List[str]]:
    html = [e for e in a.get("evidence") or [] if isinstance(e, Mapping) and e.get("format", "html") == "html"]
    src = next((e for e in html if e.get("url") == a.get("source_url")), html[0] if html else {})
    return gate.country_check({
        "source_url": a.get("source_url"),
        "page_text": "\n".join(str(e.get("date_text") or "") for e in html if e.get("url") == a.get("source_url")),
        "event_text": f"{_es(a.get('title'))}\n{a.get('venue_name') or ''}\n{src.get('date_text') or ''}",
        "ld_location": {}, "venue_name": a.get("venue_name"), "address": a.get("address"),
        "lat": g.get("lat"), "lng": g.get("lng"),
    })


def anchor_doc(a: Mapping[str, Any], *, gaz_by_id: Mapping[str, Mapping[str, Any]], now: datetime,
               parent_id: Optional[str]) -> Dict[str, Any]:
    """The doc seed-anchors inserts (mirrors tests/test_events_anchors._seeded_doc).
    last_verified = when a human actually verified it (newest tier ≤ 3 HTML evidence), never
    the seed time: a late seed decays honestly to VERIFY until the sentinel re-verifies."""
    g = dict(gaz_by_id.get(str(a.get("venue_gazetteer_id") or ""), {}))
    umbrella = bool(a.get("is_umbrella"))
    geo = None if umbrella or g.get("lat") is None else {"lat": g["lat"], "lng": g["lng"], "geocode_source": "gazetteer",
                                                          "venue_id": g.get("catalog_id")}
    set_geo, _ = _geo_fields(geo, umbrella=umbrella)
    verdict, signals = _anchor_country(a, g)
    title = _es(a.get("title"))
    key = gate.match_key(title, a.get("edition_year"), a.get("venue_name") or "")
    ev = merge_evidence([], [dict(e) for e in a.get("evidence") or [] if isinstance(e, Mapping)])
    ver = [gate.parse_iso(e.get("fetched_at")) for e in ev
           if e.get("format", "html") == "html" and isinstance(e.get("tier"), int) and e["tier"] <= 3]
    ver_dt = max((v for v in ver if v is not None), default=None)
    doc: Dict[str, Any] = {k: v for k, v in a.items() if k not in _ANCHOR_DROP}
    doc.update({
        "canonical_key": key, "match_key": key, "key_history": [], "evidence": ev,
        "status": a.get("status_hint") or "published", "status_reason": a.get("status_reason_hint"),
        "confidence": a.get("confidence_cap") or "HIGH",
        "country_check": verdict, "country_signals": ["anchor", *signals][:40],
        "last_verified": _iso(ver_dt) if ver_dt else None, "verified_by": "manual",
        "parent_id": parent_id, "notif_eligible": False, "sold_out": bool(a.get("sold_out")),
        "source_key": "anchor", "origin": "anchor", "is_umbrella": umbrella,
        "blocked_days": 0, "not_found_count": 0, "gone_strikes": 0, "date_history": [],
        "anchor_key": a.get("key"), "created_at": _iso(now), "updated_at": _iso(now),
    })
    doc.update(set_geo)
    if doc.get("lat") is None:
        doc.pop("geo", None)
    if a.get("status_hint") == "date_tbc":
        doc.update(start_date=None, end_date=None, start_time=None, end_time=None)
    ev_status = _apply_eval(doc, now)
    if ev_status["status"] == "drop":
        raise ValueError("anchor_without_source")
    doc.update(ev_status)   # the gate decides the stored caches (sticky hints stay as seeded)
    doc["event_id"] = _mint_id(doc)
    return doc


async def seed_anchors(db_: Any, *, now: Optional[datetime] = None, anchors: Optional[Sequence[Mapping[str, Any]]] = None,
                       gazetteer: Optional[Sequence[Mapping[str, Any]]] = None, actor: str = "admin") -> Dict[str, Any]:
    """Idempotent (§6). New anchors are inserted whole. EXISTING docs never get status,
    status_reason, dates, confidence or last_verified rewritten (§15 W2): only new evidence
    entries (original fetched_at) and, when anchor_version grew, descriptive fields."""
    n = _now(now)
    rows = list(anchors if anchors is not None else load_anchors())
    gaz = list(gazetteer if gazetteer is not None else load_gazetteer())
    gaz_by_id = {str(g.get("id")): g for g in gaz if g.get("id")}
    by_key = {str(a.get("key")): a for a in rows if a.get("key")}
    order = sorted(rows, key=lambda a: 0 if not a.get("parent_key") else 1)
    ids: Dict[str, str] = {}
    report: Dict[str, Any] = {"inserted": [], "evidence_added": [], "descriptive_updated": [], "unchanged": [],
                              "errors": []}
    parents_used: Set[str] = set()
    for a in order:
        k = str(a.get("key") or "")
        try:
            sk = f"anchor:{k}"
            existing = await db_.city_events.find_one({"source_keys": sk}, {"_id": 0})
            parent_id = None
            pk = a.get("parent_key")
            if isinstance(pk, str) and pk:
                parent_id = ids.get(pk)
                if parent_id is None:
                    pdoc = await db_.city_events.find_one({"source_keys": f"anchor:{pk}"}, {"_id": 0, "event_id": 1})
                    parent_id = pdoc.get("event_id") if isinstance(pdoc, Mapping) else None
                if parent_id:
                    parents_used.add(parent_id)
            if isinstance(existing, Mapping):
                ids[k] = str(existing["event_id"])
                new_ev = merge_evidence(existing.get("evidence") or [],
                                        [dict(e) for e in a.get("evidence") or [] if isinstance(e, Mapping)])
                sets: Dict[str, Any] = {}
                if [(_url_key(e["url"]), e.get("fetched_at")) for e in new_ev] != \
                        [(_url_key(e["url"]), e.get("fetched_at")) for e in (existing.get("evidence") or [])
                         if isinstance(e, Mapping) and gate.is_http_url(e.get("url"))]:
                    sets["evidence"] = new_ev
                    report["evidence_added"].append(k)
                if _int(a.get("anchor_version"), 1) > _int(existing.get("anchor_version"), 1):
                    for f in _ANCHOR_DESCRIPTIVE:
                        if f in a:
                            sets[f] = a[f]
                    sets["anchor_version"] = _int(a.get("anchor_version"), 1)
                    report["descriptive_updated"].append(k)
                if parent_id and not existing.get("parent_id"):
                    sets["parent_id"] = parent_id
                if sets:
                    sets["updated_at"] = _iso(n)
                    await db_.city_events.update_one({"event_id": existing["event_id"]}, {"$set": sets})
                    await _log(db_, existing["event_id"], actor, None, None, "anchor_reseed", sorted(sets), n)
                else:
                    report["unchanged"].append(k)
                continue
            doc = anchor_doc(a, gaz_by_id=gaz_by_id, now=n, parent_id=parent_id)
            try:
                res = await db_.city_events.update_one({"canonical_key": doc["canonical_key"]},
                                                       {"$setOnInsert": doc}, upsert=True)
            except DuplicateKeyError:
                report["errors"].append(f"{k}:duplicate_key")
                continue
            if getattr(res, "upserted_id", None) is None:
                other = await db_.city_events.find_one({"canonical_key": doc["canonical_key"]}, {"_id": 0, "event_id": 1})
                oid = other.get("event_id") if isinstance(other, Mapping) else None
                if oid:
                    ids[k] = str(oid)
                    await _add_source_keys(db_, str(oid), [sk])
                report["errors"].append(f"{k}:canonical_key_taken_by:{oid}")
                continue
            ids[k] = doc["event_id"]
            report["inserted"].append(k)
            await _log(db_, doc["event_id"], actor, None, doc["status"], doc.get("status_reason"), "anchor_seed", n)
        except Exception as exc:  # noqa: BLE001
            logger.error("[events] anchor %s failed: %s", k, type(exc).__name__)
            report["errors"].append(f"{k}:{type(exc).__name__}")
    for pid in sorted(parents_used):
        try:
            await db_.city_events.update_one({"event_id": pid, "is_umbrella": {"$ne": True}},
                                             {"$set": {"is_umbrella": True, "lat": None, "lng": None,
                                                       "geocode_source": None, "zone": None, "updated_at": _iso(n)},
                                              "$unset": {"geo": ""}})
        except Exception as exc:  # noqa: BLE001
            logger.error("[events] umbrella mark failed: %s", type(exc).__name__)
    report["anchors"] = len(by_key)
    runtime.invalidate_caches()
    return report


ANCHORS_STATE_ID = "anchors"


async def ensure_anchors_seeded(db_: Any, *, now: Optional[datetime] = None, actor: str = "pull") -> Optional[Dict[str, Any]]:
    """§16.4 anchors as a source: seed_anchors (idempotent, §15 W2 — never rewrites status,
    dates, confidence or last_verified of an existing doc) whenever the stored anchors_version
    differs from the file's, then store the file's version. None = nothing to do (same version,
    no versioned file, or the state could not be read: never seed blind, the next tick retries)."""
    version, rows = load_anchors_file()
    if version is None or not rows:
        return None
    try:
        st = await db_.city_events_state.find_one({"_id": ANCHORS_STATE_ID})
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] anchors state read failed: %s", type(exc).__name__)
        return None
    if isinstance(st, Mapping) and st.get("anchors_version") == version:
        return None
    n = _now(now)
    report = await seed_anchors(db_, now=n, anchors=rows, actor=actor)
    summary = {"anchors_version": version,
               "previous_version": st.get("anchors_version") if isinstance(st, Mapping) else None,
               **{k: len(report.get(k) or []) for k in ("inserted", "evidence_added", "descriptive_updated", "unchanged")},
               "errors": list(report.get("errors") or [])[:20]}
    try:
        await db_.city_events_state.update_one(
            {"_id": ANCHORS_STATE_ID},
            {"$set": {"anchors_version": version, "seeded_at": _iso(n), "last_report": summary}}, upsert=True)
    except Exception as exc:  # noqa: BLE001 — the seed is idempotent: the next tick simply seeds again
        logger.error("[events] anchors state write failed: %s", type(exc).__name__)
    return summary


def _legacy_sources(ev: Mapping[str, Any]) -> List[str]:
    raw = ev.get("source")
    vals = raw if isinstance(raw, list) else [raw]
    vals += [ev.get("source_url"), ev.get("ticket_url")]
    return [str(u).strip() for u in vals if gate.is_http_url(u)]


async def import_legacy(db_: Any, *, now: Optional[datetime] = None, dry: bool = False,
                        actor: str = "admin", limit: int = 400) -> Dict[str, Any]:
    """§13 L: legacy db.events rows → city_events review/legacy_unverified (never published by
    this call). Admin path only; public paths never read db.events (§15 T1)."""
    n = _now(now)
    today = _today(n)
    gaz = load_gazetteer()
    catalog = await load_catalog(db_)
    rep: Dict[str, Any] = {"considered": 0, "imported": [], "skipped": {}}

    def skip(r: str) -> None:
        rep["skipped"][r] = rep["skipped"].get(r, 0) + 1

    try:
        legacy_rows = await db_.events.find({}, {"_id": 0}).limit(limit).to_list(length=limit)
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] legacy read failed: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="legacy read failed")
    for ev in legacy_rows or []:
        rep["considered"] += 1
        lid = str(ev.get("event_id") or ev.get("slug") or ev.get("id") or "")
        srcs = _legacy_sources(ev)
        start = ev.get("date_start") or ev.get("date")
        end = ev.get("date_end") or start
        title = str(ev.get("title") or ev.get("name_es") or "").strip()
        if not lid or not title:
            skip("no_id_or_title")
            continue
        if not srcs:
            skip("no_source")
            continue
        if ev.get("recurring") or ev.get("recurrence_rule"):
            skip("recurring")
            continue
        sd, ed = gate._ymd(start), gate._ymd(end)  # noqa: SLF001
        if sd is None or ed is None or ed < sd:
            skip("bad_dates")
            continue
        if (ed - sd).days > LEGACY_IMPORT_MAX_SPAN_DAYS:
            skip("long_span")
            continue
        if ed.isoformat() < today:
            skip("past")
            continue
        loc = _as_map(ev.get("location"))
        venue = str(ev.get("venue_name") or ev.get("venue") or "")
        geo = gate.geocode(venue, ev.get("address"), catalog, gaz)
        if geo is None and _valid_geo(loc.get("lat"), loc.get("lng")):
            geo = {"lat": float(loc["lat"]), "lng": float(loc["lng"]), "geocode_source": "source", "venue_id": None}
        if geo is None:
            skip("outside_or_unknown_district")
            continue
        try:
            key = gate.match_key(title, sd.year, venue)
        except ValueError:
            skip("no_key")
            continue
        sk = f"legacy:{lid}"
        clash = await db_.city_events.find_one({"$or": [{"canonical_key": key}, {"source_keys": sk}]}, {"_id": 0, "event_id": 1})
        if clash:
            skip("conflict_existing_wins")
            continue
        verdict, signals = gate.country_check({"source_url": srcs[0], "event_text": f"{title}\n{venue}",
                                               "venue_name": venue, "address": ev.get("address"),
                                               "lat": geo["lat"], "lng": geo["lng"],
                                               "geocode_source": geo.get("geocode_source"),
                                               "venue_ambiguous": geo.get("venue_ambiguous") is True})
        if verdict != "pass":
            skip("country_fail")
            continue
        cat_map = {"music": "concert", "party": "nightlife", "gastronomy": "gastronomic", "festival": "festival",
                   "sports": "sports", "cultural": "cultural"}
        set_geo, _ = _geo_fields(geo, umbrella=False)
        doc: Dict[str, Any] = {
            "canonical_key": key, "match_key": key, "key_history": [], "title": {"es": title}, "description": {},
            "category": cat_map.get(str(ev.get("category") or ev.get("type") or ""), "cultural"),
            "start_date": sd.isoformat(), "end_date": ed.isoformat(), "start_time": None, "end_time": None,
            "time_confirmed": False, "edition_year": sd.year, "date_tbc_note": None, "tbc_window_end": None,
            "venue_name": venue, "address": ev.get("address") if isinstance(ev.get("address"), str) else None,
            "price": {"is_free": None, "min_cop": None, "max_cop": None, "text": None},
            "ticket_url": None, "source_url": srcs[0], "source_name": gate.registrable_domain(srcs[0]),
            "source_tier": gate.domain_tier(srcs[0]) or 6, "source_key": None, "source_keys": [sk],
            "recheck_url": srcs[0], "second_source_url": srcs[1] if len(srcs) > 1 else None,
            "second_source_name": gate.registrable_domain(srcs[1]) if len(srcs) > 1 else None,
            "second_source_tier": gate.domain_tier(srcs[1]) if len(srcs) > 1 else None,
            "evidence": [], "last_verified": None, "verified_by": "pipeline",
            "status": "review", "status_reason": "legacy_unverified", "confidence": "VERIFY", "notif_eligible": False,
            "country_check": verdict, "country_signals": signals[:40], "image_url": None, "image_credit": None,
            "parent_id": None, "origin": "legacy-import", "sold_out": False, "is_umbrella": False,
            "blocked_days": 0, "not_found_count": 0, "gone_strikes": 0, "date_history": [],
            "legacy_id": lid, "created_at": _iso(n), "updated_at": _iso(n),
        }
        doc.update(set_geo)
        if doc["lat"] is None:
            doc.pop("geo", None)
        try:
            doc["event_id"] = _mint_id(doc)
        except ValueError:
            skip("id_out_of_contract")
            continue
        rep["imported"].append({"legacy_id": lid, "event_id": doc["event_id"], "title": title})
        if dry:
            continue
        try:
            await db_.city_events.update_one({"canonical_key": key}, {"$setOnInsert": doc}, upsert=True)
            await _log(db_, doc["event_id"], actor, None, "review", "legacy_unverified", {"legacy_id": lid}, n)
        except DuplicateKeyError:
            skip("conflict_existing_wins")
    return rep


# ═════════════════════════════════════════════════════════════════════════════
# ADMIN actions (§7, §15 R1/X3)
# ═════════════════════════════════════════════════════════════════════════════


async def _doc_or_404(db_: Any, event_id: str) -> Dict[str, Any]:
    doc = await runtime.resolve_event(db_, event_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return doc


async def approve_event(db_: Any, event_id: str, *, actor: str, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Clear a sticky state. Never overrides §4 rules 1–2 or a tier-6-only row (§15 X3); the
    gate still decides the result (a row without fresh evidence stays in review)."""
    n = _now(now)
    doc = await _doc_or_404(db_, event_id)
    if not gate.is_http_url(doc.get("source_url")):
        raise HTTPException(status_code=409, detail={"error": "no_source"})
    if doc.get("country_check") != "pass":
        raise HTTPException(status_code=409, detail={"error": "country_fail"})
    if doc.get("status_reason") == "merged":
        raise HTTPException(status_code=409, detail={"error": "merged_duplicate"})
    raw_tiers = [gate.domain_tier(e.get("url"), e.get("tier")) for e in doc.get("evidence") or [] if isinstance(e, Mapping)]
    tiers: List[int] = [t for t in raw_tiers if isinstance(t, int)]
    if not tiers:
        raise HTTPException(status_code=409, detail={"error": "no_evidence", "hint": "verify with a tier ≤ 3 page first"})
    if min(tiers) >= 6:
        raise HTTPException(status_code=409, detail={"error": "aggregator_only"})
    fields: Dict[str, Any] = {"status_reason": None, "approved_by": actor, "approved_at": _iso(n)}
    push = None
    unset = ["proposed_dates"]
    pd = doc.get("proposed_dates")
    if isinstance(pd, Mapping) and gate._ymd(pd.get("start_date")):  # noqa: SLF001
        frm = {"start_date": doc.get("start_date"), "end_date": doc.get("end_date"), "start_time": doc.get("start_time")}
        to = {"start_date": pd.get("start_date"), "end_date": pd.get("end_date") or pd.get("start_date"),
              "start_time": pd.get("start_time")}
        fields.update(start_date=to["start_date"], end_date=to["end_date"], start_time=to["start_time"],
                      time_confirmed=bool(to["start_time"]))
        push = {"date_history": {"at": _iso(n), "from": frm, "to": to, "source": actor}}
        unset += ["tbc_window_end", "date_tbc_note"]
        if (frm["start_date"], frm["end_date"], frm["start_time"]) != (to["start_date"], to["end_date"], to["start_time"]):
            unset += date_change_unsets(doc)
    fields["status"] = "published" if (fields.get("start_date") or doc.get("start_date")) else "date_tbc"
    pn = doc.get("pending_notice")
    if doc.get("status_reason") == "date_changed" and isinstance(pn, Mapping) and isinstance(pn.get("fp"), str):
        # Phil read the 'nueva fecha' notice and approved these dates: acknowledge THIS notice for
        # THESE dates, so an unchanged banner (kept by ticketers until the show) does not send the
        # row back to review every day. A changed notice or a later date change asks again.
        fields["notice_ack"] = {"fp": pn["fp"], "marker": pn.get("marker"),
                                "start_date": fields.get("start_date", doc.get("start_date")),
                                "end_date": fields.get("end_date", doc.get("end_date")) or
                                fields.get("start_date", doc.get("start_date")),
                                "start_time": fields.get("start_time", doc.get("start_time")),
                                "by": actor, "at": _iso(n)}
    if "pending_notice" in doc:
        unset.append("pending_notice")
    probe = dict(doc)
    probe.update(fields)
    for k in unset:
        probe.pop(k, None)
    ev = _apply_eval(probe, n)
    if ev["status"] in ("review", "drop"):
        raise HTTPException(status_code=409, detail={"error": "gate_refuses", "reason": ev["status_reason"],
                                                     "hint": "verify with a fresh tier ≤ 3 page first"})
    merged, _ = await _write_status(db_, doc, fields, actor=actor, now=n, unset=unset, push=push, log_detail="approve")
    runtime.invalidate_caches()
    return {"event_id": doc["event_id"], "status": merged.get("status"), "confidence": merged.get("confidence")}


_SET_DATES_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


async def set_event_dates(db_: Any, event_id: str, body: Mapping[str, Any], *, actor: str,
                          now: Optional[datetime] = None) -> Dict[str, Any]:
    """CALENDAR-INTEGRATION v1 — curator date injection, the §15 W2 companion: the anchors seed
    never rewrites dates on an existing doc, so a resolved date_tbc/review row gets its dates HERE.
    The dates are stamped as proposed_dates and pushed through approve_event — the single
    date-mutation path — so the gate still re-decides, date_history records the change and the
    tbc fields are cleared. A row the gate refuses is left exactly as it was (stamp rolled back);
    its 409 hint routes the curator through /verify with a fresh tier ≤ 3 page first."""
    n = _now(now)
    doc = await _doc_or_404(db_, event_id)
    sd = gate._ymd(body.get("start_date"))  # noqa: SLF001 — same pure parse approve_event uses
    if not sd:
        raise HTTPException(status_code=422, detail={"error": "bad_start_date", "hint": "YYYY-MM-DD"})
    ed = gate._ymd(body.get("end_date")) if body.get("end_date") is not None else sd  # noqa: SLF001
    if not ed or ed < sd:
        raise HTTPException(status_code=422, detail={"error": "bad_range"})
    if ed.isoformat() < _today(n):
        raise HTTPException(status_code=422, detail={"error": "past_dates"})
    st = body.get("start_time")
    if st is not None and (not isinstance(st, str) or not _SET_DATES_HHMM.match(st)):
        raise HTTPException(status_code=422, detail={"error": "bad_start_time", "hint": "HH:MM"})
    src = body.get("source_url")
    if not gate.is_http_url(src):
        raise HTTPException(status_code=422, detail={"error": "source_url_required"})
    reason = body.get("reason")
    if not isinstance(reason, str) or len(reason.strip()) < 3:
        raise HTTPException(status_code=422, detail={"error": "reason_required"})
    proposed = {"start_date": sd.isoformat(), "end_date": ed.isoformat(), "start_time": st, "source": "curator",
                "url": src, "reason": reason.strip()[:300], "proposed_by": actor, "proposed_at": _iso(n)}
    await db_.city_events.update_one({"event_id": doc["event_id"]},
                                     {"$set": {"proposed_dates": proposed, "updated_at": _iso(n)}})
    await _log(db_, doc["event_id"], actor, doc.get("status"), doc.get("status"), "set_dates",
               {"proposed": proposed}, n)
    try:
        return await approve_event(db_, event_id, actor=actor, now=n)
    except HTTPException:
        # fail closed: never leave a dangling curator proposal on a row the gate refused
        await db_.city_events.update_one({"event_id": doc["event_id"]}, {"$unset": {"proposed_dates": ""}})
        raise


async def hide_event(db_: Any, event_id: str, *, actor: str, note: Optional[str] = None,
                     now: Optional[datetime] = None) -> Dict[str, Any]:
    n = _now(now)
    doc = await _doc_or_404(db_, event_id)
    await _write_status(db_, doc, {"status": "hidden", "status_reason": "admin_hide", "hidden_at": _iso(n)},
                        actor=actor, now=n, log_detail={"note": (note or "")[:300]})
    runtime.invalidate_caches()
    return {"event_id": doc["event_id"], "status": "hidden", "status_reason": "admin_hide"}


async def verify_event(db_: Any, event_id: str, evidence_url: Any, date_text: Any, *, actor: str,
                       now: Optional[datetime] = None, client_factory: Optional[ClientFactory] = None,
                       url_guard: Any = None) -> Dict[str, Any]:
    """§15 X3: evidence_url must be tier ≤ 3; the server fetches it (SSRF-guarded, X4) and must
    find date_text in the visible page before it records a manual last_verified."""
    n = _now(now)
    doc = await _doc_or_404(db_, event_id)
    if not isinstance(evidence_url, str) or not gate.is_http_url(evidence_url):
        raise HTTPException(status_code=400, detail="evidence_url (http/https) required")
    if not isinstance(date_text, str) or len(date_text.strip()) < 6:
        raise HTTPException(status_code=400, detail="date_text required")
    tier = gate.domain_tier(evidence_url)
    if tier is None or tier > 3:
        raise HTTPException(status_code=400, detail="evidence_url must be a tier ≤ 3 source")
    guard = url_guard if url_guard is not None else sources.public_url_guard
    refusal = await guard(evidence_url)
    if refusal:
        raise HTTPException(status_code=400, detail={"error": "url_refused", "reason": refusal})
    client = (client_factory or sources.make_client)()
    try:
        fres = await sources.fetch(client, evidence_url, source=sources.generic_source_entry(evidence_url),
                                   url_guard=guard)
    finally:
        try:
            await client.aclose()
        except Exception as exc:  # noqa: BLE001
            logger.error("[events] client close failed: %s", type(exc).__name__)
    if fres.get("blocked_reason") or _int(fres.get("status")) != 200:
        raise HTTPException(status_code=409, detail={"error": "fetch_failed",
                                                     "reason": fres.get("blocked_reason") or fres.get("status")})
    if not sources.text_on_page(str(fres.get("text") or ""), date_text):
        raise HTTPException(status_code=409, detail={"error": "date_text_not_on_page"})
    year = doc.get("edition_year") if isinstance(doc.get("edition_year"), int) else None
    parsed = gate.parse_date_text(date_text, year)
    if doc.get("start_date"):
        if not parsed or parsed.get("start_date") != doc.get("start_date"):
            raise HTTPException(status_code=409, detail={"error": "date_mismatch", "parsed": parsed,
                                                         "stored": doc.get("start_date")})
    elif parsed:
        raise HTTPException(status_code=409, detail={"error": "date_announced", "parsed": parsed,
                                                     "hint": "approve the proposed dates instead"})
    entry = {"url": evidence_url, "name": gate.registrable_domain(evidence_url), "tier": tier,
             "fetched_at": fres.get("fetched_at") or _iso(n), "http_status": 200, "date_text": date_text.strip()[:300],
             "date_visible": True, "start_date": (parsed or {}).get("start_date"),
             "end_date": (parsed or {}).get("end_date"), "start_time": (parsed or {}).get("start_time"),
             "via": "manual", "verified_by": actor}
    fields = {"evidence": merge_evidence(doc.get("evidence") or [], [entry]), "last_verified": _iso(n),
              "verified_by": "manual", "blocked_days": 0, "not_found_count": 0}
    merged, _ = await _write_status(db_, doc, fields, actor=actor, now=n, log_detail={"verify": evidence_url})
    await _log(db_, doc["event_id"], actor, None, None, "manual_verify", {"url": evidence_url}, n)
    runtime.invalidate_caches()
    return {"event_id": doc["event_id"], "status": merged.get("status"), "confidence": merged.get("confidence"),
            "last_verified": fields["last_verified"]}


async def patch_flags(db_: Any, body: Mapping[str, Any], *, actor: str, now: Optional[datetime] = None) -> Dict[str, Any]:
    """§13 E1 + §15 T1: only the keys sent are $set; only enabled + sources_disabled exist."""
    n = _now(now)
    if not isinstance(body, Mapping) or not body:
        raise HTTPException(status_code=400, detail="body with enabled and/or sources_disabled required")
    unknown = sorted(set(body) - FLAG_KEYS)
    if unknown:
        raise HTTPException(status_code=400, detail={"error": "unknown_flags", "keys": unknown,
                                                     "note": "legacy_hidden no longer exists (§15 T1)"})
    upd: Dict[str, Any] = {}
    if "enabled" in body:
        if not isinstance(body["enabled"], bool):
            raise HTTPException(status_code=400, detail="enabled must be a boolean")
        upd["enabled"] = body["enabled"]
    if "sources_disabled" in body:
        sd = body["sources_disabled"]
        if not isinstance(sd, list) or not all(isinstance(s, str) for s in sd):
            raise HTTPException(status_code=400, detail="sources_disabled must be a list of source keys")
        bad = sorted(set(sd) - set(sources.SOURCES_BY_KEY))
        if bad:
            raise HTTPException(status_code=400, detail={"error": "unknown_sources", "keys": bad})
        upd["sources_disabled"] = sorted(set(sd))
    await db_.city_events_state.update_one({"_id": "flags"},
                                           {"$set": {**upd, "updated_at": _iso(n), "updated_by": actor}}, upsert=True)
    await _log(db_, None, actor, None, upd, "flags", None, n)
    runtime.invalidate_caches()
    return {"flags": await runtime.get_flags(db_),
            "note": "Up to 30 s instance cache + CDN (feed ≈ 180 s, legacy ≈ 360 s) before users see it (§13 E3)."}


# ═════════════════════════════════════════════════════════════════════════════
# PUBLIC read helpers (server.py routes) — §8, §13 C/D, §15 T
# ═════════════════════════════════════════════════════════════════════════════

ImageOk = Optional[Callable[[str], bool]]


def _img(v: Any, image_ok: ImageOk) -> Optional[str]:
    if not isinstance(v, str) or not v:
        return None
    if image_ok is not None and not image_ok(v):
        return None
    return v


def _event_img(row: Mapping[str, Any], image_ok: ImageOk) -> Optional[str]:
    """The row's own self-hosted image, else the convention /images/events/<id>.jpg
    when the manifest ships it. Mirrors server._normalize_event_media for the elite
    feed: the file is a self-hosted flyer imported from the event's own source page by
    scripts/fetch_event_flyers.py (never fabricated). _img already dropped any
    non-self-hosted image_url, so this never emits an external URL. Honest null when
    no flyer ships — SafeImage then paints the category placeholder."""
    img = _img(row.get("image_url"), image_ok)
    if img is None:
        eid = row.get("event_id")
        cand = f"/images/events/{eid}.jpg" if eid else None
        if cand and image_ok is not None and image_ok(cand):
            img = cand
    return img


async def feed_payload(db_: Any, *, now: Optional[datetime] = None, image_ok: ImageOk = None) -> Dict[str, Any]:
    """GET /api/events/feed: published + date_tbc, HIGH and VERIFY, ≤ 400 (§8). Kill switch → []."""
    n = _now(now)
    rows = await runtime.public_rows(db_, statuses=LIVE_STATUSES, min_confidence="VERIFY", limit=400, now=n)
    events: List[Dict[str, Any]] = []
    tbc: List[Dict[str, Any]] = []
    for r in rows:
        r = dict(r)
        r["image_url"] = _event_img(r, image_ok)
        if r["image_url"] is None:
            r["image_credit"] = None
        (events if r["status"] == "published" else tbc).append(r)
    return {"generated_at": _iso(n), "today": _today(n), "events": events, "date_tbc": tbc}


async def feed_item(db_: Any, event_id: str, *, now: Optional[datetime] = None, image_ok: ImageOk = None) -> Optional[Dict[str, Any]]:
    """GET /api/events/feed/item/{id}: ANY status (aliases resolve), honest nulls (§8, §13 A4)."""
    pv = await runtime.public_item(db_, event_id, now=now)
    if pv is None:
        return None
    pv = dict(pv)
    pv["image_url"] = _event_img(pv, image_ok)
    if pv["image_url"] is None:
        pv["image_credit"] = None
    return pv


def _legacy_img(rows: List[Dict[str, Any]], image_ok: ImageOk) -> List[Dict[str, Any]]:
    for r in rows:
        r["image_url"] = _img(r.get("image_url"), image_ok) or ""
    return rows


async def legacy_rows(db_: Any, *, now: Optional[datetime] = None, image_ok: ImageOk = None) -> List[Dict[str, Any]]:
    """Legacy /api/events rows: published + HIGH + future + not umbrella (§13 D3, §15 T1)."""
    pvs = await runtime.public_rows(db_, legacy=True, now=now)
    return _legacy_img(legacy.legacy_events(pvs), image_ok)


async def legacy_featured_rows(db_: Any, *, now: Optional[datetime] = None, image_ok: ImageOk = None,
                               limit: int = 10) -> List[Dict[str, Any]]:
    """Legacy /api/events/featured: the legacy rows, top events first (§16.1: prominence desc,
    then date). Same gate as /api/events (published + HIGH + future + not umbrella)."""
    pvs = await runtime.public_rows(db_, legacy=True, now=now)
    prom = {str(pv.get("event_id")): int(pv.get("prominence") or 0) for pv in pvs}
    flag = {str(pv.get("event_id")) for pv in pvs if pv.get("flagship") is True}
    return legacy.legacy_featured(_legacy_img(legacy.legacy_events(pvs), image_ok), limit, prominence=prom, flagship=flag)


async def legacy_list(db_: Any, *, date_: Optional[str] = None, event_type: Optional[str] = None,
                      is_free: Optional[bool] = None, venue_id: Optional[str] = None,
                      now: Optional[datetime] = None, image_ok: ImageOk = None) -> List[Dict[str, Any]]:
    rows = await legacy_rows(db_, now=now, image_ok=image_ok)
    if venue_id:
        return []   # city events carry no legacy venue ids: an honest empty answer
    if date_:
        rows = legacy.rows_on_date(rows, date_)
    if event_type:
        rows = [r for r in rows if r.get("type") == event_type]
    if is_free is not None:
        rows = [r for r in rows if bool(r.get("is_free")) is bool(is_free)]
    return rows


async def legacy_event_item(db_: Any, event_id: str, *, now: Optional[datetime] = None,
                            image_ok: ImageOk = None) -> Optional[Dict[str, Any]]:
    """Legacy /api/events/{id}: a published + HIGH + future city_events row, else None → 404."""
    if not isinstance(event_id, str) or event_id in RESERVED_EVENT_IDS:
        return None
    pv = await runtime.legacy_item(db_, event_id, now=now)
    if pv is None:
        return None
    row = legacy.to_legacy_event(pv)
    return _legacy_img([row], image_ok)[0] if row else None


async def legacy_concert_rows(db_: Any, *, date_: Optional[str] = None, genre: Optional[str] = None,
                              now: Optional[datetime] = None, image_ok: ImageOk = None) -> List[Dict[str, Any]]:
    pvs = await runtime.public_rows(db_, legacy=True, now=now)
    rows = _legacy_img(legacy.legacy_concerts(pvs), image_ok)
    if date_:
        rows = [r for r in rows if r.get("date") == date_]
    if genre:
        rows = [r for r in rows if r.get("genre") == genre]
    return rows


async def legacy_concert_item(db_: Any, concert_id: str, *, now: Optional[datetime] = None,
                              image_ok: ImageOk = None) -> Optional[Dict[str, Any]]:
    pv = await runtime.legacy_item(db_, concert_id, now=now)
    if pv is None or pv.get("category") != "concert":
        return None
    row = legacy.to_legacy_concert(pv)
    return _legacy_img([row], image_ok)[0] if row else None


_SEARCH_EVENT_KEYS = ("title", "venue_name", "category", "type", "description")
_SEARCH_CONCERT_KEYS = ("artist", "title", "genre", "venue_name", "description")


async def legacy_search_hits(db_: Any, pattern: Optional[str], *, now: Optional[datetime] = None,
                             image_ok: ImageOk = None, limit: int = 50) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """/search event + concert hits (§8, §13 D4): ONLY verified city_events (published + HIGH +
    future, legacy shape — the shape 1.1.x search renders), matched in Python with the search's
    own recall regex. One public_rows read for both lists."""
    if not pattern:
        return [], []
    try:
        rx = re.compile(pattern, re.I)
    except re.error:
        return [], []
    pvs = await runtime.public_rows(db_, legacy=True, now=now)
    events = _legacy_img(legacy.legacy_events(pvs), image_ok)
    concerts = _legacy_img(legacy.legacy_concerts(pvs), image_ok)

    def hit(r: Mapping[str, Any], keys: Sequence[str]) -> bool:
        return any(isinstance(r.get(k), str) and rx.search(str(r.get(k))) is not None for k in keys)

    return ([r for r in events if hit(r, _SEARCH_EVENT_KEYS)][: limit * 2],
            [r for r in concerts if hit(r, _SEARCH_CONCERT_KEYS)][:limit])


async def live_favorite(db_: Any, item_id: str, *, now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    """§15 T3: a favorite/agenda event must be a ce- id whose public_view is published or date_tbc."""
    if not isinstance(item_id, str) or not gate.EVENT_ID_RE.match(item_id):
        return None
    pv = await runtime.public_item(db_, item_id, now=now)
    if pv is None or pv.get("status") not in LIVE_STATUSES:
        return None
    return pv


async def hydrate_favorite(db_: Any, fav: Mapping[str, Any], *, now: Optional[datetime] = None) -> Dict[str, Any]:
    """GET /favorites for event/concert rows: the honest PublicEvent (any status) for ce- ids;
    legacy ids (evt_*, con_*, slugs) → {status: 'removed'} (§15 T3)."""
    iid, itype = str(fav.get("item_id") or ""), str(fav.get("item_type") or "")
    base = {"item_id": iid, "item_type": itype, "_fav_type": itype, "_fav_id": fav.get("fav_id", "")}
    pv = await runtime.public_item(db_, iid, now=now) if gate.EVENT_ID_RE.match(iid) else None
    if pv is None:
        return {**base, "status": "removed"}
    return {**pv, **base}


async def calendar_filter(db_: Any, items: Sequence[Mapping[str, Any]], *, now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    """GET /calendar read-time filter (§13 D4): event/concert items whose event is not a live
    city_events row are omitted (nothing is deleted); live rows show the row's own dates."""
    out: List[Dict[str, Any]] = []
    for it in items:
        itype = str(it.get("item_type") or "")
        iid = str(it.get("item_id") or "")
        if itype not in FAVORITE_EVENT_TYPES and not iid.startswith(("ce-", "evt_", "con_")):
            out.append(dict(it))
            continue
        pv = await live_favorite(db_, iid, now=now)
        if pv is None:
            continue
        row = dict(it)
        row.update(date=pv.get("start_date") or "", start_time=pv.get("start_time") or "",
                   end_time=pv.get("end_time") or "", title=_es(pv.get("title")) or row.get("title", ""),
                   status=pv.get("status"))
        out.append(row)
    return out


async def my_week_rows(db_: Any, ids: Sequence[Any], *, now: Optional[datetime] = None,
                       image_ok: ImageOk = None) -> List[Dict[str, Any]]:
    """GET /my-week: the user's saved ids that are legacy-servable city events (published +
    HIGH), in the legacy shape old binaries render."""
    rows: List[Dict[str, Any]] = []
    for i in ids or []:
        if isinstance(i, str):
            r = await legacy_event_item(db_, i, now=now, image_ok=image_ok)
            if r:
                rows.append(r)
    rows.sort(key=lambda r: (r.get("date_start") or "", r.get("start_time") or "99:99"))
    return rows


async def favorite_meta(db_: Any, item_id: str, *, now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    """AI profile / itinerary enrichers (§13 D4): structured fields of a live city event only."""
    pv = await live_favorite(db_, item_id, now=now)
    if pv is None:
        return None
    price = _as_map(pv.get("price"))
    return {"title": _es(pv.get("title")), "name": _es(pv.get("title")), "category": pv.get("category"),
            "type": pv.get("category"), "is_free": price.get("is_free") is True, "price": price.get("min_cop"),
            "start_time": pv.get("start_time") or ""}


# ═════════════════════════════════════════════════════════════════════════════
# ROUTES
# ═════════════════════════════════════════════════════════════════════════════


def _need_db() -> Any:
    if db is None:
        raise HTTPException(status_code=503, detail="events service not initialised")
    return db


@router.api_route("/admin/events/pull", methods=["GET", "POST"])
async def pull_route(request: Request) -> Dict[str, Any]:
    d = _need_db()
    actor, dry = await _run_auth(request)
    if not dry:
        await _writer_guard(d)
    source = request.query_params.get("source") or None
    try:
        return await run_pull(d, source_key=source, dry=dry, actor=actor)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] pull failed: %s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="pull failed")


@router.api_route("/admin/events/enrich", methods=["GET", "POST"])
async def enrich_route(request: Request) -> Dict[str, Any]:
    d = _need_db()
    actor, dry = await _run_auth(request)
    try:
        return await run_enrich_batch(d, dry=dry)
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] enrich failed: %s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="enrich failed")


@router.api_route("/admin/events/sentinel", methods=["GET", "POST"])
async def sentinel_route(request: Request) -> Dict[str, Any]:
    """?slot=main|today forces that slot (operator); no slot / ?slot=auto is the */15 cron:
    sentinel_due_slot() picks the slot that is due, else a cheap no-op (§16.4)."""
    d = _need_db()
    actor, dry = await _run_auth(request)
    if not dry:
        await _writer_guard(d)
    try:
        slot = request.query_params.get("slot")
        if slot in (None, "", "auto"):
            due = await sentinel_due_slot(d)
            if due is None:
                return {"skipped": "not_due", "slot": None}
            slot = due
        return await run_sentinel(d, slot=slot, dry=dry, actor=actor)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] sentinel failed: %s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="sentinel failed")


@router.api_route("/admin/events/reminders", methods=["GET", "POST"])
async def reminders_route(request: Request) -> Dict[str, Any]:
    d = _need_db()
    actor, dry = await _run_auth(request)
    if not dry:
        await _writer_guard(d)
    try:
        return await run_reminders(d, dry=dry, actor=actor)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] reminders failed: %s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="reminders failed")


@router.post("/admin/events/seed-anchors")
async def seed_anchors_route(request: Request) -> Dict[str, Any]:
    d = _need_db()
    user = await require_admin_mutation(request)
    await _writer_guard(d)
    return await seed_anchors(d, actor=f"admin:{user.get('user_id', '?')}")


@router.post("/admin/events/import-legacy")
async def import_legacy_route(request: Request) -> Dict[str, Any]:
    d = _need_db()
    user = await require_admin_mutation(request)
    dry = request.query_params.get("dry") == "1"
    if not dry:
        await _writer_guard(d)
    return await import_legacy(d, dry=dry, actor=f"admin:{user.get('user_id', '?')}")


@router.get("/admin/events/review")
async def review_route(request: Request) -> Dict[str, Any]:
    d = _need_db()
    await require_admin_read(request)
    status = request.query_params.get("status") or "review"
    if status not in gate.STATUSES:
        raise HTTPException(status_code=400, detail="bad status")
    try:
        rows = await d.city_events.find({"status": status}, {"_id": 0, "event_text": 0}) \
            .sort("updated_at", -1).limit(200).to_list(length=200)
        rejects = await d.city_events_rejects.find({}, {"_id": 0, "at_dt": 0}).sort("at", -1).limit(50).to_list(length=50)
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] review read failed: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="review read failed")
    return {"status": status, "rows": rows, "rejects": rejects}


@router.get("/admin/events/runs")
async def runs_route(request: Request) -> Dict[str, Any]:
    d = _need_db()
    await require_admin_read(request)
    try:
        runs = await d.city_events_runs.find({}, {"_id": 0, "started_at_dt": 0, "finished_at_dt": 0}) \
            .sort("started_at", -1).limit(60).to_list(length=60)
        by_status = {st: await d.city_events.count_documents({"status": st}) for st in gate.STATUSES}
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] runs read failed: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="runs read failed")
    return {"runs": runs, "by_status": by_status, "flags": await runtime.get_flags(d),
            "sentinel_healthy": await runtime.sentinel_healthy(d), "sources": sources.public_sources(),
            "indexes_ok": await ensure_events_indexes(d)}


@router.get("/admin/events/flags")
async def flags_read_route(request: Request) -> Dict[str, Any]:
    d = _need_db()
    await require_admin_read(request)
    return {"flags": await runtime.get_flags(d), "sentinel_healthy": await runtime.sentinel_healthy(d),
            "note": "Cambios tardan hasta 30 s (caché de instancia) + CDN: feed ≈ 180 s, legacy ≈ 360 s."}


@router.api_route("/admin/events/flags", methods=["POST", "PATCH"])
async def flags_route(request: Request) -> Dict[str, Any]:
    d = _need_db()
    user = await require_admin_mutation(request)
    return await patch_flags(d, await _json_body(request), actor=f"admin:{user.get('user_id', '?')}")


@router.get("/admin/events/gate-check")
async def gate_check_route(request: Request) -> Dict[str, Any]:
    """§7 / §15 X4: fetch an admin-supplied URL (public http(s) on 80/443 only, every redirect
    hop checked, 1.5 MB cap), run the generic JSON-LD parser + gates, store NOTHING."""
    d = _need_db()
    await require_admin_read(request)
    url = (request.query_params.get("url") or "").strip()
    refusal = await sources.public_url_guard(url)
    if refusal:
        raise HTTPException(status_code=400, detail={"error": "url_refused", "reason": refusal})
    client = sources.make_client()
    try:
        fres = await sources.fetch(client, url, source=sources.generic_source_entry(url),
                                   url_guard=sources.public_url_guard)
    finally:
        try:
            await client.aclose()
        except Exception as exc:  # noqa: BLE001
            logger.error("[events] client close failed: %s", type(exc).__name__)
    if fres.get("blocked_reason") or _int(fres.get("status")) != 200:
        return {"url": url, "fetch": {"status": fres.get("status"), "blocked_reason": fres.get("blocked_reason")},
                "candidates": []}
    now = _now()
    cands, skips = sources.parse_generic_jsonld(str(fres.get("text") or ""), sources.page_meta(fres, url))
    ctx = PullCtx(d, now, "gate-check", dry=True, catalog=await load_catalog(d), gazetteer=load_gazetteer())
    out = []
    for c in cands[:20]:
        umbrella = bool(c.get("is_umbrella_hint"))
        geo = _geocode_candidate(ctx, c, umbrella)
        verdict, signals = gate.country_check(_country_input(c, geo))
        base = _base_key(c) or "?"
        doc = doc_from_candidate(c, key=base, geo=geo, verdict=verdict, signals=signals, now=now, umbrella=umbrella)
        ev = gate.evaluate(doc, now)
        out.append({"title": _es(c.get("title")), "start_date": c.get("start_date"), "start_time": c.get("start_time"),
                    "venue_name": c.get("venue_name"), "country": verdict, "signals": signals,
                    "geocode_source": (geo or {}).get("geocode_source") if geo else None, "evaluate": ev})
    return {"url": url, "final_url": fres.get("final_url"), "candidates": out, "skips": skips, "stored": False}


@router.post("/admin/events/{event_id}/approve")
async def approve_route(event_id: str, request: Request) -> Dict[str, Any]:
    d = _need_db()
    user = await require_admin_mutation(request)
    return await approve_event(d, event_id, actor=f"admin:{user.get('user_id', '?')}")


@router.post("/admin/events/{event_id}/set-dates")
async def set_dates_route(event_id: str, request: Request) -> Dict[str, Any]:
    d = _need_db()
    user = await require_admin_mutation(request)
    body = await _json_body(request)
    return await set_event_dates(d, event_id, body, actor=f"admin:{user.get('user_id', '?')}")


@router.post("/admin/events/{event_id}/hide")
async def hide_route(event_id: str, request: Request) -> Dict[str, Any]:
    d = _need_db()
    user = await require_admin_mutation(request)
    body = await _json_body(request)
    return await hide_event(d, event_id, actor=f"admin:{user.get('user_id', '?')}",
                            note=body.get("note") if isinstance(body.get("note"), str) else None)


@router.post("/admin/events/{event_id}/verify")
async def verify_route(event_id: str, request: Request) -> Dict[str, Any]:
    d = _need_db()
    user = await require_admin_mutation(request)
    body = await _json_body(request)
    return await verify_event(d, event_id, body.get("evidence_url"), body.get("date_text"),
                              actor=f"admin:{user.get('user_id', '?')}")


# ── prefs (§2 event_notif_prefs, §13 J7) ─────────────────────────────────────


def prefs_view(doc: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    d = dict(DEFAULT_PREFS)
    d["categories"] = list(DEFAULT_PREFS["categories"])
    if isinstance(doc, Mapping):
        if isinstance(doc.get("reminders_enabled"), bool):
            d["reminders_enabled"] = doc["reminders_enabled"]
        if isinstance(doc.get("nearby_enabled"), bool):
            d["nearby_enabled"] = doc["nearby_enabled"]
        cats = doc.get("categories")
        if isinstance(cats, list):
            clean = [c for c in cats if c in gate.CATEGORIES]
            d["categories"] = clean or list(gate.CATEGORIES)
        if doc.get("lang") in PREF_LANGS:
            d["lang"] = doc["lang"]
    return d


def prefs_update(body: Mapping[str, Any]) -> Dict[str, Any]:
    """Validated partial $set from a PUT body (unknown keys ignored, wrong types → 400)."""
    if not isinstance(body, Mapping):
        raise HTTPException(status_code=400, detail="JSON object required")
    upd: Dict[str, Any] = {}
    for k in ("reminders_enabled", "nearby_enabled"):
        if k in body:
            if not isinstance(body[k], bool):
                raise HTTPException(status_code=400, detail=f"{k} must be a boolean")
            upd[k] = body[k]
    if "categories" in body:
        cats = body["categories"]
        if not isinstance(cats, list) or not all(isinstance(c, str) for c in cats):
            raise HTTPException(status_code=400, detail="categories must be a list")
        clean = [c for c in dict.fromkeys(cats) if c in gate.CATEGORIES]
        upd["categories"] = clean or list(gate.CATEGORIES)
    if "lang" in body:
        if body["lang"] not in PREF_LANGS:
            raise HTTPException(status_code=400, detail="lang must be es|en|fr|pt")
        upd["lang"] = body["lang"]
    return upd


def dev_seed_allowed() -> bool:
    """§15 T2: dev seeds only behind ALLOW_DEV_SEED=1, and never against the prod cluster."""
    if os.environ.get("ALLOW_DEV_SEED") != "1":
        return False
    if PROD_CLUSTER_HOST in (os.environ.get("MONGO_URL") or ""):
        logger.error("[events] ALLOW_DEV_SEED refused: MONGO_URL points at the production cluster")
        return False
    return True
