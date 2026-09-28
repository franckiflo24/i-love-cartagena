# Legacy events backup: 2026-09-28 (pre EVENTS-ELITE)

This is a read-only GET snapshot taken before EVENTS-ELITE hid the legacy events. It is the backup that must exist before any write. Nothing was deleted from Mongo. The legacy rows are only hidden, by the `city_events_state.flags.legacy_hidden` switch; see docs/events-elite/DESIGN.md §1 and §12.

- `api_*.json`: raw responses from https://backend-mu-one-74.vercel.app/api/... (events 104, featured 10, dates/available, concerts 12 (fabricated seeds), partner-events 0, seasons 0, venues).
- `static_*.json`: https://www.amocartagena.co/data/*.json as served (events 164 incl. 61 past, concerts 11, calendar, seasons, partners, venues).
- `past_event_detail/`: GET /api/events/{id} bodies for the 61 past events that still resolved.
