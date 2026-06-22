/**
 * AMO Integration Contract — Canonical TypeScript types.
 *
 * Every data collection used by the app flows through these types.
 * Fields marked "legacy" exist in current partners.json but will be
 * migrated to the target names over time.  The data layer (data.ts)
 * normalises both shapes at load time.
 */

// ---------------------------------------------------------------------------
// Enums & Literals
// ---------------------------------------------------------------------------

export type NeighborhoodSlug =
  | 'centro'
  | 'san_diego'
  | 'getsemani'
  | 'bocagrande'
  | 'laguito'
  | 'castillogrande'
  | 'manga'
  | 'marbella'
  | 'cabrero'
  | 'crespo'
  | 'la_boquilla'
  | 'tierrabomba'
  | 'baru'
  | 'islas_rosario';

export type PartnerCategory =
  | 'restaurant'
  | 'nightlife'
  | 'experience'
  | 'hotel'
  | 'shop'
  | 'service';

export type PriceLevel = 1 | 2 | 3 | 4;

export type PartnerStatus = 'active' | 'paused' | 'churned';

export type EventStatus = 'scheduled' | 'cancelled' | 'postponed';

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

export interface BaseRecord {
  id: string;
  slug: string;
  last_verified_date?: string;
  source?: string[];
  confidence?: number;
}

// ---------------------------------------------------------------------------
// Partner
// ---------------------------------------------------------------------------

export interface Partner extends BaseRecord {
  /** Display name (current JSON uses `name`) */
  name: string;
  /** Future: localised names */
  name_es?: string;
  name_en?: string;

  category: PartnerCategory | string;
  subcategory?: string;
  neighborhood?: NeighborhoodSlug | string;

  /** Target flat coords — data.ts normalises from location.lat/lng */
  lat?: number;
  lng?: number;

  address?: string;
  phone?: string;
  whatsapp?: string;
  instagram?: string;
  website?: string;

  tags?: string[];
  image_urls?: string[];
  /** Legacy single image field from current JSON */
  image_url?: string;

  price_level?: PriceLevel;
  /** Legacy string like "$$" */
  price_range?: string;

  partner_status?: PartnerStatus;

  /** Restaurant fields */
  cuisine_type?: string;
  awards?: string[];

  /** Shared operational */
  hours?: string;
  description?: string;
  rating?: number;
  reviews?: number;

  /** Nightlife fields */
  live_music?: boolean;
  rooftop?: boolean;
  venue_type?: string;
  music_genres?: string[];
  cover_charge_cop?: number;

  /** Experience fields */
  activity_type?: string;
  duration_hours?: number;
  price_min_cop?: number;
  price_max_cop?: number;
  booking_url?: string;

  /** Membership / legacy fields kept for backward compat */
  tier?: string;
  is_certified?: boolean;
  membership_status?: string;
  membership_tier?: string;
  membership_plan?: string;
  membership_paid_until?: string | null;
  default_payment_link?: string;
  booking_link?: string;
  experience?: string;
}

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

export interface EventRecord extends BaseRecord {
  /** Current JSON uses `title`; data.ts normalises to name_es */
  name_es: string;
  name_en?: string;

  category: string;
  venue?: string;
  venue_id?: string;
  venue_name?: string;

  date_start: string;
  date_end?: string;
  time_start?: string;
  time_end?: string;

  is_free: boolean;
  price?: number;
  ticket_url?: string;
  booking_link?: string;
  image_url?: string;

  status: EventStatus;

  organizer?: string;
  expected_attendance?: number;
  capacity?: number;

  description?: string;
  tags?: string[];
  featured?: boolean;
  location?: { lat: number; lng: number };
}

// ---------------------------------------------------------------------------
// Neighborhood
// ---------------------------------------------------------------------------

export interface Neighborhood extends BaseRecord {
  name_es: string;
  name_en: string;
  description_es?: string;
  description_en?: string;
  lat: number;
  lng: number;
  image_url?: string;
  vibe_tags?: string[];
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface TransportScheduleEntry {
  departure: string;
  arrival: string;
  notes?: string;
}

export interface TransportFare extends BaseRecord {
  type: string;
  route: string;
  schedule?: TransportScheduleEntry[];
  departure_point?: string;
  departure_location?: { lat: number; lng: number };
  price?: string;
  notes?: string;
  partner_name?: string;
  last_return?: string;
}

// ---------------------------------------------------------------------------
// Cruise
// ---------------------------------------------------------------------------

export interface CruiseCall extends BaseRecord {
  ship_name: string;
  line: string;
  arrival_date: string;
  departure_date?: string;
  pax_estimate?: number;
  dock?: string;
}

// ---------------------------------------------------------------------------
// Practical / Emergency
// ---------------------------------------------------------------------------

export interface PracticalPhone {
  service: string;
  phone: string;
}

export interface Practical extends BaseRecord {
  name: string;
  category: string;
  icon?: string;
  phones?: PracticalPhone[];
  primary_phone?: string;
  email?: string;
  website?: string;
}
