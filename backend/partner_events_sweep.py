"""Partner-events dead-letter sweep (P0-B, audit 2026-10-01).

A NEEDS_REVIEW partner event lands in moderation_status "pending" with ONE
Telegram + email at submit time and nothing afterwards: no cron ever read
partner_events, the daily digest counted city_events only, and a pending event
whose date passed stayed "pending" forever (Casa Bohème: three events stranded
Aug 22 → Sep 29, two of them expired unseen).

    GET|POST /api/cron/partner-events/sweep[?dry=1]   Bearer CRON_SECRET only
    (Vercel cron every 30 min — Vercel invokes cron paths with GET)

Each run:
  1. EXPIRE: pending events whose last day (date_end, else date) is before
     today in Bogotá → moderation_status "expired_unreviewed" + a timestamp.
     Never deleted; the filter re-checks "pending" so a concurrent human
     approval is never overwritten.
  2. COUNT the live pending events and the oldest one's age.
  3. ALERT: if the oldest is older than PENDING_ALERT_AFTER_H, send ONE
     Telegram message (count, oldest age, ≤5 titles with partner names, the
     admin-queue link) through telegram_alerts.send — at most once per
     ALERT_DEDUPE_H. The slot is claimed ATOMICALLY in `cron_state`
     ({_id: "partner_events_sweep", last_alert_at}) before sending, and
     released again when Telegram reports no delivery so the next tick
     retries instead of silently burning 6 h.
  4. Return counts only (never a secret, never a doc).

Auth mirrors maintenance._require_cron (constant-time compare, rate limited).
"""
from __future__ import annotations

import hmac
import logging
import os
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pymongo.errors import DuplicateKeyError

from events_time import BOGOTA, today_str

logger = logging.getLogger("partner_events_sweep")
router = APIRouter()
db: Any = None

PENDING_ALERT_AFTER_H = 2.0      # alert once the oldest live pending event is older than this
ALERT_DEDUPE_H = 6.0             # at most one Telegram alert per this window
ALERT_MAX_TITLES = 5
SWEEP_MAX_ROWS = 500             # a dead-letter queue is small by nature
EXPIRED_STATUS = "expired_unreviewed"
STATE_ID = "partner_events_sweep"
ADMIN_QUEUE_URL = "https://www.amocartagena.co/business/admin/queue"

Sender = Callable[[str], Awaitable[Dict[str, Any]]]


def init(db_: Any) -> None:
    global db
    db = db_


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def bogota_today(now: datetime) -> str:
    return today_str(now.astimezone(BOGOTA))


def _parse_dt(v: Any) -> Optional[datetime]:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str) and v:
        try:
            d = datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            return None
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    return None


# ── pure rules (unit-tested) ─────────────────────────────────────────────────

def event_last_day(ev: Dict[str, Any]) -> str:
    """The last day the event is still relevant: date_end (overnight / multi-day)
    falling back to date — the same precedence events_time uses for the public feed."""
    return str(ev.get("date_end") or ev.get("date") or "")


def is_expired(ev: Dict[str, Any], today: str) -> bool:
    """True when a pending event can no longer be reviewed in time (its last day
    is before today in Bogotá). Undated rows are never expired."""
    d = event_last_day(ev)
    return bool(d) and d < today


def age_hours(created_at: Any, now: datetime) -> Optional[float]:
    dt = _parse_dt(created_at)
    if dt is None:
        return None
    return max(0.0, (now - dt).total_seconds() / 3600.0)


def oldest_age_hours(live: List[Dict[str, Any]], now: datetime) -> Optional[float]:
    ages = [a for a in (age_hours(e.get("created_at"), now) for e in live) if a is not None]
    return max(ages) if ages else None


def should_alert(oldest_h: Optional[float]) -> bool:
    return oldest_h is not None and oldest_h > PENDING_ALERT_AFTER_H


def _fmt_age(h: float) -> str:
    if h >= 48:
        return f"{int(h // 24)} d"
    return f"{int(round(h))} h"


def format_alert(live: List[Dict[str, Any]], names: Dict[str, str], oldest_h: float) -> str:
    """Plain text (telegram_alerts sends no parse_mode); the queue link is read-only."""
    lines = [
        "🔎 Cola de eventos de partners SIN revisar",
        f"{len(live)} pendiente{'s' if len(live) != 1 else ''} · el más antiguo lleva {_fmt_age(oldest_h)}",
    ]
    for ev in live[:ALERT_MAX_TITLES]:
        who = names.get(str(ev.get("partner_id") or ""), "") or str(ev.get("partner_id") or "—")
        title = str(ev.get("title") or "(sin título)")[:80]
        lines.append(f"• {who} — {title} ({ev.get('date') or 's/f'})")
    if len(live) > ALERT_MAX_TITLES:
        lines.append(f"… y {len(live) - ALERT_MAX_TITLES} más")
    lines.append(f"Revisar: {ADMIN_QUEUE_URL}")
    return "\n".join(lines)


# ── db steps ─────────────────────────────────────────────────────────────────

async def _pending_rows(db_: Any) -> List[Dict[str, Any]]:
    return await db_.partner_events.find(
        {"moderation_status": "pending"},
        {"_id": 0, "event_id": 1, "title": 1, "date": 1, "date_end": 1, "partner_id": 1, "created_at": 1},
    ).sort("created_at", 1).to_list(SWEEP_MAX_ROWS)


async def pending_summary(db_: Any, now: Optional[datetime] = None) -> Dict[str, Any]:
    """For the daily digest: live (non-expired) pending count + the oldest one's age in hours."""
    now = now or _now()
    today = bogota_today(now)
    live = [e for e in await _pending_rows(db_) if not is_expired(e, today)]
    oldest = oldest_age_hours(live, now)
    return {"count": len(live), "oldest_age_h": None if oldest is None else round(oldest, 1)}


async def claim_alert_slot(db_: Any, now: datetime) -> bool:
    """Atomically own the next alert: matches only when the last alert is older
    than the dedupe window (or absent). A losing racer collides on _id and gets
    DuplicateKeyError → False. Same lock shape as server.py's claim_throttle."""
    cutoff = _iso(datetime.fromtimestamp(now.timestamp() - ALERT_DEDUPE_H * 3600, tz=timezone.utc))
    try:
        res = await db_.cron_state.update_one(
            {"_id": STATE_ID, "$or": [{"last_alert_at": {"$exists": False}}, {"last_alert_at": {"$lt": cutoff}}]},
            {"$set": {"last_alert_at": _iso(now)}},
            upsert=True,
        )
    except DuplicateKeyError:
        return False
    return bool(getattr(res, "modified_count", 0) or getattr(res, "upserted_id", None))


async def release_alert_slot(db_: Any, now: datetime) -> None:
    """Undo a claim whose send was not delivered (only if nobody re-claimed since)."""
    try:
        await db_.cron_state.update_one({"_id": STATE_ID, "last_alert_at": _iso(now)}, {"$unset": {"last_alert_at": ""}})
    except Exception as exc:  # noqa: BLE001
        logger.error("[sweep] alert slot release failed: %s", type(exc).__name__)


async def _partner_names(db_: Any, ids: List[str]) -> Dict[str, str]:
    pids = sorted({p for p in ids if p})
    if not pids:
        return {}
    out: Dict[str, str] = {}
    async for p in db_.partners.find({"partner_id": {"$in": pids}}, {"_id": 0, "partner_id": 1, "name": 1}):
        out[str(p.get("partner_id"))] = str(p.get("name") or "")
    return out


async def run_sweep(db_: Any, *, now: Optional[datetime] = None, send: Optional[Sender] = None,
                    dry: bool = False) -> Dict[str, Any]:
    now = now or _now()
    today = bogota_today(now)
    rows = await _pending_rows(db_)
    expired = [e for e in rows if is_expired(e, today)]
    live = [e for e in rows if not is_expired(e, today)]

    expired_n = 0
    if not dry:
        for ev in expired:
            r = await db_.partner_events.update_one(
                {"event_id": ev.get("event_id"), "moderation_status": "pending"},   # never overwrite a human decision
                {"$set": {"moderation_status": EXPIRED_STATUS, "is_published": False,
                          "expired_unreviewed_at": _iso(now)}},
            )
            expired_n += int(getattr(r, "modified_count", 0))

    oldest = oldest_age_hours(live, now)
    # Read-only evidence for operators: how many rows this sweep has retired over
    # its lifetime, and when the last stale-queue alert went out (dedupe marker).
    expired_total: Optional[int] = None
    last_alert_at: Optional[str] = None
    try:
        expired_total = await db_.partner_events.count_documents({"moderation_status": EXPIRED_STATUS})
        st = await db_.cron_state.find_one({"_id": STATE_ID}, {"_id": 0, "last_alert_at": 1})
        last_alert_at = (st or {}).get("last_alert_at")
    except Exception:  # noqa: BLE001 — evidence must never break the sweep
        pass
    out: Dict[str, Any] = {
        "today": today, "scanned": len(rows), "expired": expired_n if not dry else 0,
        "would_expire": len(expired), "pending_live": len(live),
        "expired_total": expired_total, "last_alert_at": last_alert_at,
        "oldest_age_h": None if oldest is None else round(oldest, 1),
        "alert_due": should_alert(oldest), "alerted": False, "alert_skipped": None, "dry": dry,
    }
    if dry or not should_alert(oldest):
        if not out["alert_due"]:
            out["alert_skipped"] = "not_due"
        return out
    if not await claim_alert_slot(db_, now):
        out["alert_skipped"] = "deduped"
        return out
    if send is None:
        import telegram_alerts as _tg  # lazy: tests pass their own sender
        send = _tg.send
    names = await _partner_names(db_, [str(e.get("partner_id") or "") for e in live])
    res = await send(format_alert(live, names, oldest or 0.0))
    if (res or {}).get("sent"):
        out["alerted"] = True
    else:
        logger.warning("[sweep] pending-events alert not delivered (%s) — slot released for the next tick",
                       (res or {}).get("errors") or "telegram not configured")
        await release_alert_slot(db_, now)
        out["alert_skipped"] = "not_delivered"
    return out


# ── route ────────────────────────────────────────────────────────────────────

async def _require_cron(request: Request) -> None:
    auth = request.headers.get("Authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else ""
    cron = os.environ.get("CRON_SECRET", "").strip()
    if not cron or not hmac.compare_digest(token, cron):
        raise HTTPException(status_code=403, detail="cron secret required")
    try:
        from server import _check_rate_limit, _client_ip  # lazy: server imports this module
        await _check_rate_limit(f"cronsweep:{_client_ip(request)}", max_calls=30, window_sec=600)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.error("[sweep] rate limit unavailable: %s", type(exc).__name__)


@router.api_route("/cron/partner-events/sweep", methods=["GET", "POST"])
async def sweep_route(request: Request) -> Dict[str, Any]:
    await _require_cron(request)
    if db is None:
        raise HTTPException(status_code=503, detail="db not initialised")
    try:
        return await run_sweep(db, dry=request.query_params.get("dry") == "1")
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.error("[sweep] run failed: %s", type(exc).__name__)
        raise HTTPException(status_code=500, detail="sweep failed")
