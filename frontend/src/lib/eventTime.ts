// Cartagena time is America/Bogota (UTC-5). The client must compute "today" in
// Bogota, NOT via new Date().toISOString() (which is UTC) — the UTC date rolls
// over at 19:00 local, so today's events used to disappear every evening.
//
// Keep this in lockstep with backend/events_time.py (same "still live" rule).

/** Today in Cartagena, "YYYY-MM-DD". en-CA locale yields ISO-style dates. */
export function bogotaToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

/** Current Cartagena wall clock, "HH:MM" (24h). */
export function bogotaTime(): string {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

type EventLike = {
  date?: string | null;
  date_start?: string | null;
  date_end?: string | null;
  start_time?: string | null;
  end_time?: string | null;
};

/** True while an event has not finished yet (Bogota). Mirrors event_is_live() server-side. */
export function isEventLive(ev: EventLike): boolean {
  const today = bogotaToday();
  const end = ev.date_end || ev.date || ev.date_start;
  if (!end) return true; // undated → keep
  if (end > today) return true;
  if (end < today) return false;
  // Ends today — keep unless a concrete end_time already passed.
  const et = ev.end_time || ev.start_time;
  if (typeof et === 'string' && et.length >= 4 && /^\d/.test(et)) {
    return et.slice(0, 5) >= bogotaTime();
  }
  return true;
}

/** Drop finished events and sort soonest-first. */
export function filterLiveEvents<T extends EventLike>(events: T[]): T[] {
  return events
    .filter(isEventLive)
    .sort((a, b) => {
      const ka = (a.date_start || a.date || a.date_end || '') + (a.start_time || '00:00');
      const kb = (b.date_start || b.date || b.date_end || '') + (b.start_time || '00:00');
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
}
