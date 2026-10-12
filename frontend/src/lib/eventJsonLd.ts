// Honest schema.org/Event JSON-LD (EVENT-DETAIL SEO drop). Pure module — imported by
// the app route (client-side injection, which Google's renderer reads) AND by
// api/event-share.ts (the crawler-facing OG page), so both emit identical data.
//
// Honesty rails: a row that is not `published` with a real start_date emits NOTHING
// (never an invented date). No start_time → date-only startDate. Price appears only
// when is_free === true (0 COP) or a real COP floor exists. No geo block ever —
// feed coords can be zone placeholders (events_gate §15 Q5) and a placeholder
// presented as a geo point would be a lie.
export type EventForLd = {
  event_id: string;
  title: { es: string; en?: string };
  description: { es: string; en?: string };
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue_name: string;
  address: string | null;
  price: { is_free: boolean | null; min_cop: number | null };
  ticket_url: string | null;
  sold_out: boolean;
  status: string;
  image_url: string | null;
};

export const SITE_ORIGIN = 'https://www.amocartagena.co';

export function absImage(u: string | null): string | null {
  if (!u) return null;
  return /^https?:\/\//.test(u) ? u : `${SITE_ORIGIN}${u.startsWith('/') ? '' : '/'}${u}`;
}

/** `2026-11-11` + `19:00` → `2026-11-11T19:00:00-05:00`; no time → the bare date. */
function stamp(date: string | null, time: string | null): string | undefined {
  if (!date) return undefined;
  return /^\d{2}:\d{2}$/.test(time || '') ? `${date}T${time}:00-05:00` : date;
}

/** null unless the row is published with a real start_date — honesty over coverage. */
export function eventJsonLd(ev: EventForLd): Record<string, unknown> | null {
  if (ev.status !== 'published' || !ev.start_date) return null;
  const url = `${SITE_ORIGIN}/event/${encodeURIComponent(ev.event_id)}`;
  const endDate = ev.end_date
    ? stamp(ev.end_date, ev.end_time)
    : (ev.end_time ? stamp(ev.start_date, ev.end_time) : undefined);

  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: ev.title.es,
    startDate: stamp(ev.start_date, ev.start_time),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    url,
  };
  if (endDate) ld.endDate = endDate;
  const desc = (ev.description?.es || '').trim();
  if (desc) ld.description = desc.length > 300 ? `${desc.slice(0, 297)}…` : desc;
  const img = absImage(ev.image_url);
  if (img) ld.image = [img];
  if (ev.venue_name) {
    ld.location = {
      '@type': 'Place',
      name: ev.venue_name,
      address: {
        '@type': 'PostalAddress',
        ...(ev.address ? { streetAddress: ev.address } : {}),
        addressLocality: 'Cartagena de Indias',
        addressCountry: 'CO',
      },
    };
  }
  // Offers only when there is a real ticket link or the event is confirmed free.
  if (ev.ticket_url || ev.price.is_free === true) {
    const offer: Record<string, unknown> = {
      '@type': 'Offer',
      url: ev.ticket_url || url,
      availability: ev.sold_out ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
    };
    if (ev.price.is_free === true) {
      offer.price = 0;
      offer.priceCurrency = 'COP';
    } else if (typeof ev.price.min_cop === 'number' && ev.price.min_cop > 0) {
      offer.price = ev.price.min_cop;
      offer.priceCurrency = 'COP';
    }
    ld.offers = offer;
  }
  return ld;
}
