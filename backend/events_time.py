"""Single source of truth for event freshness / temporal recommendation.

Cartagena runs on America/Bogota (UTC-5, no DST). Every "today", "now", and
weekday the app shows a user MUST be computed in Bogota — not UTC. Computing
in UTC rolls the date over at 19:00 local, which made today's events vanish
in the evening and tomorrow's appear early (and gave the concierge the wrong
weekday near midnight).

"Old events naturally fall out": an event is visible until it is OVER. Over =
its last relevant day has passed, or (for a same-day event that carries an
end_time) that end_time has already passed in Bogota. This is enforced at the
DB query level (drop past-day events so the 200-row cap never fills with
history) AND refined in Python (drop today's already-ended events, sort).

Import this everywhere events are read publicly — server routes AND the
concierge grounding — so the whole product agrees on what "now" is.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from zoneinfo import ZoneInfo

BOGOTA = ZoneInfo("America/Bogota")


def now_bogota() -> datetime:
    return datetime.now(timezone.utc).astimezone(BOGOTA)


def today_str(now: Optional[datetime] = None) -> str:
    return (now or now_bogota()).strftime("%Y-%m-%d")


def weekday_name(now: Optional[datetime] = None) -> str:
    return (now or now_bogota()).strftime("%A")


def _eff_end_date(ev: Dict[str, Any]) -> Optional[str]:
    """The last day the event is still relevant (multi-day → its end)."""
    return ev.get("date_end") or ev.get("date") or ev.get("date_start")


def _eff_start_date(ev: Dict[str, Any]) -> str:
    return ev.get("date_start") or ev.get("date") or ev.get("date_end") or ""


def upcoming_query(base: Dict[str, Any], now: Optional[datetime] = None) -> Dict[str, Any]:
    """Wrap a base Mongo filter so only non-past-day events come back.

    Uses $and so it never clobbers a base query's own $or. An event survives if
    ANY of its date fields is >= today; a purely undated event is kept (rare,
    never hide silently). Time-of-day is refined later by filter_live()."""
    today = today_str(now)
    date_ok = {"$or": [
        {"date_end": {"$gte": today}},
        {"date": {"$gte": today}},
        {"date_start": {"$gte": today}},
        {"date_end": {"$in": [None, ""]}, "date": {"$in": [None, ""]}, "date_start": {"$in": [None, ""]}},
    ]}
    return {"$and": [base, date_ok]}


def event_is_live(ev: Dict[str, Any], now: Optional[datetime] = None) -> bool:
    """True if the event has not finished yet, in Bogota time."""
    now = now or now_bogota()
    today = now.strftime("%Y-%m-%d")
    end = _eff_end_date(ev)
    if not end:
        return True
    if end > today:
        return True
    if end < today:
        return False
    # Ends today — keep unless a concrete end_time already passed.
    et = ev.get("end_time") or ev.get("start_time")
    if isinstance(et, str) and len(et) >= 4 and et[:2].isdigit():
        return et[:5] >= now.strftime("%H:%M")
    return True


def filter_live(events: List[Dict[str, Any]], now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    """Drop finished events and order soonest-first (date, then start_time)."""
    now = now or now_bogota()
    live = [e for e in events if event_is_live(e, now)]
    live.sort(key=lambda e: (_eff_start_date(e), e.get("start_time") or "00:00"))
    return live
