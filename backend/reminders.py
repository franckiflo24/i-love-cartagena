"""RETIRED (EVENTS-ELITE, DESIGN.md §13 D4, §15 T2).

This module used to run an in-process asyncio loop that pushed 24 h reminders for
favorited rows of db.events / db.concerts / db.partner_events — including the fabricated
seed concerts — whenever the backend ran outside Vercel (for example a local uvicorn
pointed at the production database).

Nothing here can send a push any more, on purpose. Event reminders now run only through
the cron-driven, source-rechecked path in events_elite.py:

    GET /api/admin/events/reminders   (Vercel cron, Bearer CRON_SECRET only)

which reminds only saved city_events rows that are published, HIGH, geocoded, timed,
verified today, and pass a live recheck of their source page right before sending.
"""
