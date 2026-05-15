"""
Event reminder scheduler.

Runs a periodic background task that scans for events the user has favorited
(or partner_events / concerts) that are happening within the next ~24h, and
fires a push notification + creates an in-app notification.

A `reminder_sent` flag on a `event_reminders` collection guarantees one
notification per (user, event) — no duplicates even after restart.
"""
from __future__ import annotations
import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone

logger = logging.getLogger("amo.reminders")

# Run every 30 minutes by default; configurable via env var
REMINDER_INTERVAL_SEC = 30 * 60
# How close to event start we send the reminder
REMINDER_WINDOW_HOURS_MIN = 20  # don't re-send too early
REMINDER_WINDOW_HOURS_MAX = 28  # but catch up if scheduler was down


def _iso(d: datetime) -> str:
    return d.astimezone(timezone.utc).isoformat()


async def _send_user_reminder(db, user_id: str, kind: str, event_id: str, title: str, when_label: str):
    """Insert in-app notif + send push (best-effort)."""
    body = f"Tu evento favorito \"{title}\" comienza {when_label}. ¡No te lo pierdas!"
    notif_title = "🔔 Recordatorio de tu evento"
    try:
        await db.notifications.insert_one({
            "notification_id": f"notif_{uuid.uuid4().hex[:10]}",
            "user_id": user_id,
            "audience": "user",
            "kind": "event_reminder",
            "title": notif_title,
            "body": body,
            "ref": {kind + "_id": event_id, "event_id": event_id},
            "is_read": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as exc:
        logger.warning(f"reminder notif insert failed: {exc}")
    try:
        from push import push_to_user  # type: ignore
        await push_to_user(db, user_id, notif_title, body, data={"kind": "event_reminder", "event_id": event_id})
    except Exception as exc:
        logger.warning(f"reminder push failed: {exc}")


def _parse_event_dt(event: dict, date_field: str = "date", time_field: str = "start_time") -> datetime | None:
    """Parse the event's start time. Falls back to 20:00 local if no time."""
    d = event.get(date_field)
    if not d:
        return None
    t = (event.get(time_field) or "").strip()
    if not t or len(t) < 4:
        t = "20:00"
    try:
        # Naive parse; treat as Colombia tz (UTC-5). Good enough for reminders.
        iso_str = f"{d}T{t}:00-05:00" if len(t) == 5 else f"{d}T{t}-05:00"
        return datetime.fromisoformat(iso_str)
    except Exception:
        try:
            return datetime.fromisoformat(f"{d}T20:00:00-05:00")
        except Exception:
            return None


async def _scan_once(db):
    """A single pass over all favorites to detect events 20-28h away."""
    now = datetime.now(timezone.utc)
    min_time = now + timedelta(hours=REMINDER_WINDOW_HOURS_MIN)
    max_time = now + timedelta(hours=REMINDER_WINDOW_HOURS_MAX)

    # Pull favorites per user
    cursor = db.favorites.find({}, {"_id": 0, "user_id": 1, "event_id": 1, "concert_id": 1, "partner_event_id": 1})
    fav_rows = await cursor.to_list(2000)

    sent_count = 0
    for fav in fav_rows:
        user_id = fav.get("user_id")
        if not user_id:
            continue
        # ── Event ──
        for kind, id_field, collection in (
            ("event", "event_id", db.events),
            ("concert", "concert_id", db.concerts),
            ("partner_event", "partner_event_id", db.partner_events),
        ):
            ref_id = fav.get(id_field)
            if not ref_id:
                continue
            id_key = "event_id" if kind in {"event", "partner_event"} else "concert_id"
            ev = await collection.find_one({id_key: ref_id}, {"_id": 0})
            if not ev:
                continue
            ev_dt = _parse_event_dt(ev)
            if not ev_dt:
                continue
            if not (min_time <= ev_dt <= max_time):
                continue
            # Have we already sent this reminder?
            already = await db.event_reminders.find_one(
                {"user_id": user_id, "event_id": ref_id},
                {"_id": 0},
            )
            if already:
                continue
            title = ev.get("title") or ev.get("name") or "tu evento"
            hours_away = max(1, int((ev_dt - now).total_seconds() // 3600))
            when_label = "mañana" if 20 <= hours_away <= 28 else f"en {hours_away}h"
            await _send_user_reminder(db, user_id, kind, ref_id, title, when_label)
            await db.event_reminders.insert_one({
                "reminder_id": f"rem_{uuid.uuid4().hex[:10]}",
                "user_id": user_id,
                "event_id": ref_id,
                "kind": kind,
                "sent_at": _iso(now),
                "for_event_at": _iso(ev_dt),
            })
            sent_count += 1
    if sent_count:
        logger.info(f"reminder_scheduler: sent {sent_count} reminders")


_task_handle: asyncio.Task | None = None


async def _runner(db):
    """Forever loop. Exits if cancelled."""
    while True:
        try:
            await _scan_once(db)
        except Exception as exc:
            logger.warning(f"reminder scan failed: {exc}")
        try:
            await asyncio.sleep(REMINDER_INTERVAL_SEC)
        except asyncio.CancelledError:
            break


def start_reminder_scheduler(db) -> None:
    """Start the background scheduler. Idempotent."""
    global _task_handle
    if _task_handle and not _task_handle.done():
        return
    loop = asyncio.get_event_loop()
    _task_handle = loop.create_task(_runner(db))
    logger.info(f"reminder_scheduler started (interval={REMINDER_INTERVAL_SEC}s)")


def stop_reminder_scheduler() -> None:
    global _task_handle
    if _task_handle and not _task_handle.done():
        _task_handle.cancel()
        _task_handle = None
