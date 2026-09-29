"""EVENTS-ELITE runtime reads (async, takes a Motor db). Spec: DESIGN.md §13 B/E, §15 R4/T1.

Everything here fails CLOSED: a missing/unreadable flags doc means events are disabled, a
missing/old sentinel run means every row is served as VERIFY (and legacy HIGH-only lists go
empty), and any DB error yields an empty list / None instead of stale data.

  get_flags(db)          -> {'enabled': bool, 'sources_disabled': [str]}     (30 s cache)
  sentinel_healthy(db)   -> bool   (kind='sentinel', done=true, finished ≤ 26 h ago; 60 s cache)
  public_rows(db, *, statuses, min_confidence, legacy, extra_query, limit, now) -> [PublicEvent]
  resolve_event(db, id_or_alias) -> raw city_events doc | None
  public_item(db, id_or_alias, *, now) -> PublicEvent (any status) | None
  legacy_item(db, id_or_alias, *, now) -> PublicEvent (published + HIGH + not umbrella) | None
  invalidate_caches()    (tests / admin flag writes)
"""
from __future__ import annotations

import logging
import os
import time as _time
from datetime import datetime, timedelta
from typing import Any, Dict, List, Mapping, Optional, Sequence

import events_gate as gate

logger = logging.getLogger("events")

FLAGS_TTL_S = 30.0
FLAGS_ERROR_TTL_S = 5.0
SENTINEL_TTL_S = 60.0
SENTINEL_MAX_AGE = timedelta(hours=26)  # §15 R4 watchdog (sentinel runs twice a day)
MAX_FETCH = 2000
_CONF_RANK = {"VERIFY": 0, "HIGH": 1}

_flags_cache: Dict[str, Any] = {"value": None, "exp": 0.0}
_sentinel_cache: Dict[str, Any] = {"value": None, "exp": 0.0}


def invalidate_caches() -> None:
    _flags_cache.update(value=None, exp=0.0)
    _sentinel_cache.update(value=None, exp=0.0)


def _disabled() -> Dict[str, Any]:
    return {"enabled": False, "sources_disabled": []}


def env_default_enabled() -> bool:
    """§16.4: env EVENTS_ELITE_ENABLED=1 makes a MISSING flags doc (or one that never set
    `enabled`) read as enabled. Anything else — unset, 0, garbage — keeps the fail-closed default."""
    return os.environ.get("EVENTS_ELITE_ENABLED", "").strip().lower() in ("1", "true")


async def get_flags(db: Any) -> Dict[str, Any]:
    """§15 T1 flags: only `enabled` and `sources_disabled`. A flags doc with `enabled: false`
    always wins (the kill switch). A MISSING doc (or one without a boolean `enabled`) is
    disabled unless env EVENTS_ELITE_ENABLED=1 (§16.4). A read error is ALWAYS disabled (fail
    closed). Cached 30 s per instance (errors 5 s)."""
    now = _time.monotonic()
    cached = _flags_cache.get("value")
    if cached is not None and now < _flags_cache["exp"]:
        return dict(cached, sources_disabled=list(cached["sources_disabled"]))
    ttl = FLAGS_TTL_S
    try:
        doc = await db.city_events_state.find_one({"_id": "flags"})
        if not isinstance(doc, Mapping):
            value = _disabled()
            value["enabled"] = env_default_enabled()
        else:
            sd = doc.get("sources_disabled")
            en = doc.get("enabled")
            value = {
                "enabled": en if isinstance(en, bool) else env_default_enabled(),
                "sources_disabled": [str(s) for s in sd if isinstance(s, str)] if isinstance(sd, list) else [],
            }
    except Exception as exc:  # noqa: BLE001 — any read failure disables events
        logger.error("[events] get_flags read failed: %s", type(exc).__name__)
        value, ttl = _disabled(), FLAGS_ERROR_TTL_S
    _flags_cache.update(value=value, exp=now + ttl)
    return dict(value, sources_disabled=list(value["sources_disabled"]))


def _finished_at(run: Mapping[str, Any]) -> Optional[datetime]:
    for key in ("finished_at_dt", "finished_at"):
        dt = gate.parse_iso(run.get(key))
        if dt is not None:
            return dt
    return None


def run_finished_at(run: Any) -> Optional[datetime]:
    """When a city_events_runs row finished (UTC), or None."""
    return _finished_at(run) if isinstance(run, Mapping) else None


async def sentinel_healthy(db: Any, now: Optional[datetime] = None) -> bool:
    """True only if city_events_runs holds a kind='sentinel', done=true MAIN-slot run that
    finished within the last 26 h (§15 R4). The 17:00 UTC 'today' slot only rechecks rows that
    start today (often zero), so it never proves the daily full recheck ran. Errors / no run ->
    False. Cached 60 s per instance."""
    mono = _time.monotonic()
    cached = _sentinel_cache.get("value")
    if cached is not None and mono < _sentinel_cache["exp"]:
        return bool(cached)
    healthy = False
    try:
        run = await db.city_events_runs.find_one(
            {"kind": "sentinel", "done": True, "slot": {"$ne": "today"}},
            sort=[("finished_at", -1)],
        )
        if isinstance(run, Mapping):
            fin = _finished_at(run)
            if fin is not None:
                age = gate.as_utc(now) - fin
                # ≤ 5 min in the future tolerates clock skew; further out is not evidence of health
                healthy = timedelta(minutes=-5) <= age <= SENTINEL_MAX_AGE
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] sentinel_healthy read failed: %s", type(exc).__name__)
        healthy = False
    _sentinel_cache.update(value=healthy, exp=mono + SENTINEL_TTL_S)
    return healthy


def public_query(statuses: Sequence[str], today: str, extra_query: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
    """§13 B3 Mongo filter: stored-status prefilter + not-past-day (date_tbc exempt)."""
    q: Dict[str, Any] = {
        "status": {"$in": list(statuses)},
        "$or": [
            {"end_date": {"$gte": today}},
            {"end_date": None, "start_date": {"$gte": today}},
            {"status": "date_tbc"},
        ],
    }
    if extra_query:
        return {"$and": [q, dict(extra_query)]}
    return q


async def public_rows(
    db: Any,
    *,
    statuses: Sequence[str] = ("published", "date_tbc"),
    min_confidence: str = "VERIFY",
    legacy: bool = False,
    extra_query: Optional[Mapping[str, Any]] = None,
    limit: int = 400,
    now: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    """PublicEvents that pass `public_view` NOW. Kill switch off -> []. `legacy=True`
    means published + HIGH + not umbrella + dated (VERIFY never reaches old clients; an
    unhealthy sentinel therefore empties every legacy list). Sorted by start_date,
    start_time, nulls last."""
    now_utc = gate.as_utc(now)
    flags = await get_flags(db)
    if not flags.get("enabled"):
        return []
    if legacy:
        statuses, min_confidence = ("published",), "HIGH"
    wanted = set(statuses)
    min_rank = _CONF_RANK.get(min_confidence, 0)
    healthy = await sentinel_healthy(db, now_utc)
    today = gate.bogota_today(now_utc)
    lim = max(0, int(limit))
    if lim == 0:
        return []
    query = public_query(sorted(wanted), today, extra_query)
    fetch = min(max(lim * 2, 200), MAX_FETCH)
    try:
        cursor = db.city_events.find(query, {"_id": 0}).sort("start_date", 1).limit(fetch)
        docs = await cursor.to_list(length=fetch)
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] public_rows query failed: %s", type(exc).__name__)
        return []
    out: List[Dict[str, Any]] = []
    for doc in docs or []:
        try:
            pv = gate.public_view(doc, now_utc, healthy)
        except Exception as exc:  # noqa: BLE001 — one malformed row never breaks the feed
            logger.error("[events] public_view failed for %s: %s", doc.get("event_id"), type(exc).__name__)
            continue
        if pv is None or pv["status"] not in wanted:
            continue
        if _CONF_RANK.get(pv["confidence"], 0) < min_rank:
            continue
        if legacy and (pv["is_umbrella"] or not pv["start_date"]):
            continue
        out.append(pv)
    out.sort(key=gate.public_sort_key)
    return out[:lim]


async def resolve_event(db: Any, id_or_alias: Any) -> Optional[Dict[str, Any]]:
    """city_events doc by event_id, else by aliases (§13 A4). Only ce- ids are looked up;
    legacy ids (evt_*, con_*, slugs) resolve to None."""
    if not isinstance(id_or_alias, str) or len(id_or_alias) > 80 or not gate.EVENT_ID_RE.match(id_or_alias):
        return None
    try:
        doc = await db.city_events.find_one({"event_id": id_or_alias}, {"_id": 0})
        if doc is None:
            doc = await db.city_events.find_one({"aliases": id_or_alias}, {"_id": 0})
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] resolve_event failed: %s", type(exc).__name__)
        return None
    return dict(doc) if isinstance(doc, Mapping) else None


async def public_item(db: Any, id_or_alias: Any, *, now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    """feed/item: PublicEvent for ANY status (hidden/expired carry status_reason, hidden and
    review rows have dates/times/ticket_url nulled). None when disabled or unknown."""
    flags = await get_flags(db)
    if not flags.get("enabled"):
        return None
    doc = await resolve_event(db, id_or_alias)
    if doc is None:
        return None
    now_utc = gate.as_utc(now)
    healthy = await sentinel_healthy(db, now_utc)
    try:
        return gate.public_view(doc, now_utc, healthy)
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] public_item view failed: %s", type(exc).__name__)
        return None


async def legacy_item(db: Any, id_or_alias: Any, *, now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    """Legacy /events/{id}: only a published + HIGH + non-umbrella row, else None (→ 404)."""
    pv = await public_item(db, id_or_alias, now=now)
    if pv is None or pv["status"] != "published" or pv["confidence"] != "HIGH" or pv["is_umbrella"]:
        return None
    if not pv["start_date"]:
        return None
    return pv
