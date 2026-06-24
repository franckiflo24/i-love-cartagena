/**
 * AMO Integration Contract — Single data access layer.
 *
 * Every screen and API route reads data through these functions.
 * Module-level cache ensures each JSON is fetched at most once per
 * warm instance.  The load function works on web via relative /data/ path.
 *
 * Field normalisation:
 *   partner_id → id/slug, location.lat/lng → lat/lng, title → name_es
 */

import type {
  Partner,
  EventRecord,
  Neighborhood,
  TransportFare,
  CruiseCall,
  Practical,
} from './schema';
import { isUpcoming } from './dates';

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const cache = new Map<string, unknown>();

// ---------------------------------------------------------------------------
// Generic loader
// ---------------------------------------------------------------------------

async function load<T>(file: string): Promise<T[]> {
  const key = file;
  if (cache.has(key)) return cache.get(key) as T[];

  const url = `/data/${file}.json`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[data] fetch ${url} → ${res.status}`);
    return [];
  }

  const raw: unknown = await res.json();
  const list: T[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown>)?.[file])
      ? (raw as Record<string, unknown>)[file] as T[]
      : [];

  cache.set(key, list);
  return list;
}

// ---------------------------------------------------------------------------
// Partner normalisation (current → target schema)
// ---------------------------------------------------------------------------

function normalisePartner(p: Record<string, unknown>): Partner {
  const loc = (p.location as Record<string, unknown>) ?? {};
  const id = String(p.partner_id ?? p.slug ?? p.id ?? '').trim();
  return {
    // BaseRecord
    id,
    slug: id,
    last_verified_date: (p.last_verified_date as string) ?? undefined,
    source: (p.source as string[]) ?? undefined,
    confidence: (p.confidence as number) ?? undefined,

    // Core
    name: String(p.name ?? p.title ?? ''),
    name_es: (p.name_es as string) ?? undefined,
    name_en: (p.name_en as string) ?? undefined,
    category: String(p.category ?? ''),
    subcategory: (p.subcategory as string) ?? undefined,
    neighborhood: (p.neighborhood as string) ?? undefined,

    // Geo — flatten nested location
    lat: typeof loc.lat === 'number' ? loc.lat : (p.lat as number) ?? undefined,
    lng: typeof loc.lng === 'number' ? loc.lng : (p.lng as number) ?? undefined,

    address: (p.address as string) ?? undefined,
    phone: (p.phone as string) ?? undefined,
    whatsapp: (p.whatsapp as string) ?? undefined,
    instagram: (p.instagram as string) ?? undefined,
    website: (p.website as string) ?? undefined,

    tags: (p.tags as string[]) ?? undefined,
    image_urls: (p.image_urls as string[]) ?? undefined,
    image_url: (p.image_url as string) ?? undefined,

    price_level: (p.price_level as Partner['price_level']) ?? undefined,
    price_range: (p.price_range as string) ?? undefined,
    partner_status: (p.partner_status as Partner['partner_status']) ?? undefined,

    cuisine_type: (p.cuisine_type as string) ?? undefined,
    awards: (p.awards as string[]) ?? undefined,
    hours: (p.hours as string) ?? undefined,
    description: (p.description as string) ?? undefined,
    rating: (p.rating as number) ?? undefined,
    reviews: (p.reviews as number) ?? undefined,

    live_music: (p.live_music as boolean) ?? undefined,
    rooftop: (p.rooftop as boolean) ?? undefined,
    venue_type: (p.venue_type as string) ?? undefined,
    music_genres: (p.music_genres as string[]) ?? undefined,
    cover_charge_cop: (p.cover_charge_cop as number) ?? undefined,

    activity_type: (p.activity_type as string) ?? undefined,
    duration_hours: (p.duration_hours as number) ?? undefined,
    price_min_cop: (p.price_min_cop as number) ?? undefined,
    price_max_cop: (p.price_max_cop as number) ?? undefined,
    booking_url: (p.booking_url as string) ?? undefined,

    tier: (p.tier as string) ?? undefined,
    is_certified: (p.is_certified as boolean) ?? undefined,
    membership_status: (p.membership_status as string) ?? undefined,
    membership_tier: (p.membership_tier as string) ?? undefined,
    membership_plan: (p.membership_plan as string) ?? undefined,
    membership_paid_until: (p.membership_paid_until as string | null) ?? undefined,
    default_payment_link: (p.default_payment_link as string) ?? undefined,
    booking_link: (p.booking_link as string) ?? undefined,
    experience: (p.experience as string) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Event normalisation (current → target schema)
// ---------------------------------------------------------------------------

function normaliseEvent(e: Record<string, unknown>): EventRecord {
  const id = String(e.event_id ?? e.slug ?? e.id ?? '').trim();
  return {
    id,
    slug: id,
    last_verified_date: (e.last_verified_date as string) ?? undefined,
    source: (e.source as string[]) ?? undefined,
    confidence: (e.confidence as number) ?? undefined,

    name_es: String(e.name_es ?? e.title ?? e.name ?? ''),
    name_en: (e.name_en as string) ?? undefined,

    category: String(e.category ?? e.type ?? ''),
    venue: (e.venue as string) ?? (e.venue_name as string) ?? undefined,
    venue_id: (e.venue_id as string) ?? undefined,
    venue_name: (e.venue_name as string) ?? undefined,

    date_start: String(e.date_start ?? e.date ?? ''),
    date_end: (e.date_end as string) ?? undefined,
    time_start: (e.time_start as string) ?? (e.start_time as string) ?? undefined,
    time_end: (e.time_end as string) ?? (e.end_time as string) ?? undefined,

    is_free: Boolean(e.is_free ?? false),
    price: (e.price as number) ?? undefined,
    ticket_url: (e.ticket_url as string) ?? undefined,
    booking_link: (e.booking_link as string) ?? undefined,
    image_url: (e.image_url as string) ?? undefined,

    status: (e.status as EventRecord['status']) ?? 'scheduled',

    organizer: (e.organizer as string) ?? undefined,
    expected_attendance: (e.expected_attendance as number) ?? undefined,
    capacity: (e.capacity as number) ?? undefined,

    description: (e.description as string) ?? undefined,
    tags: (e.tags as string[]) ?? undefined,
    featured: (e.featured as boolean) ?? undefined,
    location: (e.location as EventRecord['location']) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Transport normalisation
// ---------------------------------------------------------------------------

function normaliseTransport(t: Record<string, unknown>): TransportFare {
  const id = String(t.transport_id ?? t.slug ?? t.id ?? '').trim();
  return {
    id,
    slug: id,
    type: String(t.type ?? ''),
    route: String(t.route ?? ''),
    schedule: (t.schedule as TransportFare['schedule']) ?? undefined,
    departure_point: (t.departure_point as string) ?? undefined,
    departure_location: (t.departure_location as TransportFare['departure_location']) ?? undefined,
    price: (t.price as string) ?? undefined,
    notes: (t.notes as string) ?? undefined,
    partner_name: (t.partner_name as string) ?? undefined,
    last_return: (t.last_return as string) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Practical normalisation
// ---------------------------------------------------------------------------

function normalisePractical(p: Record<string, unknown>): Practical {
  const id = String(p.contact_id ?? p.slug ?? p.id ?? '').trim();
  return {
    id,
    slug: id,
    name: String(p.name ?? ''),
    category: String(p.category ?? ''),
    icon: (p.icon as string) ?? undefined,
    phones: (p.phones as Practical['phones']) ?? undefined,
    primary_phone: (p.primary_phone as string) ?? undefined,
    email: (p.email as string) ?? undefined,
    website: (p.website as string) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getPartners(): Promise<Partner[]> {
  const raw = await load<Record<string, unknown>>('partners');
  return raw.map(normalisePartner).filter((p) => p.id && p.name);
}

export async function getEvents(): Promise<EventRecord[]> {
  const raw = await load<Record<string, unknown>>('events');
  return raw.map(normaliseEvent).filter((e) => e.id && e.name_es);
}

export async function getNeighborhoods(): Promise<Neighborhood[]> {
  return load<Neighborhood>('neighborhoods');
}

export async function getTransport(): Promise<TransportFare[]> {
  const raw = await load<Record<string, unknown>>('transport');
  return raw.map(normaliseTransport).filter((t) => t.id);
}

export async function getCruiseCalls(): Promise<CruiseCall[]> {
  return load<CruiseCall>('cruise-calls');
}

export async function getPractical(): Promise<Practical[]> {
  const raw = await load<Record<string, unknown>>('emergency-contacts');
  return raw.map(normalisePractical).filter((p) => p.id);
}

export async function getPartnerBySlug(slug: string): Promise<Partner | undefined> {
  const partners = await getPartners();
  return partners.find((p) => p.slug === slug || p.id === slug);
}

export async function getUpcomingEvents(): Promise<EventRecord[]> {
  const events = await getEvents();
  const today = new Date().toISOString().slice(0, 10);
  return events
    .filter((e) => {
      if (e.status === 'cancelled') return false;
      // Include if date_start is upcoming OR if the event spans today (date_end >= today)
      if (isUpcoming(e.date_start)) return true;
      const end = (e as any).date_end || e.date_start || '';
      return end >= today;
    })
    .sort((a, b) => {
      const da = new Date(a.date_start).getTime() || 0;
      const db = new Date(b.date_start).getTime() || 0;
      return da - db;
    });
}

/** Clear the module-level cache (useful for tests / hot-reload). */
export function clearCache(): void {
  cache.clear();
}
