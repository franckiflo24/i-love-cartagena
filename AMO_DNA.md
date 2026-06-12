# AMO CARTAGENA — DNA DOCUMENT

> Generated from live codebase on 2026-06-11. Every claim is derived from code, not memory.

---

## 1. ARCHITECTURE MAP

```
                    ┌──────────────────────────────────┐
                    │         VERCEL (CDN + Edge)       │
                    │                                    │
                    │  Static Assets    Edge Functions   │
                    │  ┌────────────┐  ┌──────────────┐ │
                    │  │ dist/      │  │ ai-search.ts │ │
  Browser ─────────┤  │  *.html    │  │ concierge.ts │ │
                    │  │  *.js      │  └──────┬───────┘ │
                    │  │  data/*.json│        │          │
                    │  └────────────┘        │          │
                    └────────────────────────┼──────────┘
                                             │
                                             ▼
                                    ┌────────────────┐
                                    │  Anthropic API  │
                                    │  Claude Sonnet  │
                                    │  4.6             │
                                    └────────────────┘
```

**Deployed surfaces:**

| Surface | URL | Technology | Purpose |
|---------|-----|------------|---------|
| Web app | dist-ten-omega-67.vercel.app | Expo Router + React Native Web | Consumer-facing tourism app |
| AI Search | /api/ai-search | Vercel Edge Function | Ranks search results via Claude |
| Concierge | /api/concierge | Vercel Edge Function | 4-persona conversational AI |
| Static data | /data/*.json | JSON files (CDN-cached) | 610 files, offline-first catalog |

**What does NOT exist (dead backend):**

| Surface | Status |
|---------|--------|
| FastAPI backend (i-love-cartagena.onrender.com) | Dead. All endpoints return errors. |
| MongoDB Atlas | Data exported to static JSON. No live connection from frontend. |
| Supabase | Referenced in global config but not connected to this frontend. |

**Data flow:**
1. App loads — fetches `/data/partners.json` (538 records, 595 KB) + other catalogs
2. User searches — client-side text match + synonym expansion — top candidates
3. Candidates sent to `/api/ai-search` edge function — Claude ranks 3-5 best — returns to UI
4. Concierge chat — `/api/concierge` — persona detection — Claude with catalog grounding — response
5. Reservations — WhatsApp deep link (wa.me) to partner or AMO concierge number
6. All writes (POST/PUT) are no-ops in static mode — return `{}`

---

## 2. ROUTE MANIFEST

### Tab Navigation (main app)

| Route | File | Purpose | Data Source |
|-------|------|---------|-------------|
| / (Home) | (tabs)/index.tsx | Featured events, seasons, sponsors, promotions | /data/events/featured.json, /data/seasons.json, /data/sponsors.json |
| /explore | (tabs)/explore.tsx | Category browse (13 categories, subcategory tiles) | /data/partners.json (client-side filter) |
| /mapa | (tabs)/mapa.tsx | Map view of all partners with location pins | /data/partners.json (lat/lng) |
| /bookings | (tabs)/bookings.tsx | Booking history (upcoming/past/cancelled tabs) | /data/reservations.json (static stub) |
| /perfil | (tabs)/perfil.tsx | Profile, AI taste profile, My Week, Favorites | /data/profile.json, /data/favorites.json |
| /agenda (hidden) | (tabs)/agenda.tsx | Date-picker calendar of events | /data/calendar.json, /data/partner-events.json |
| /partners (hidden) | (tabs)/partners.tsx | Full partner directory | /data/partners.json |
| /citypass (hidden) | (tabs)/citypass.tsx | City Pass plans | /data/city-pass/plans.json |

### Detail Pages

| Route | File | Purpose | Data Source |
|-------|------|---------|-------------|
| /partner/:id | partner/[id].tsx | Partner detail, events, reviews, reserve CTA | /data/partners/:id.json |
| /event/:id | event/[id].tsx | Event detail with share, map, favorite | /data/events/*.json |
| /experience/:id | experience/[id].tsx | Experience detail with pricing, amenities | /data/experiences/*.json |

### Action Pages

| Route | File | Purpose | Data Source |
|-------|------|---------|-------------|
| /search | search.tsx | AI search with suggestion chips, results | Client search + /api/ai-search |
| /concierge | concierge.tsx | 4-persona AI chat (UI disabled) | /api/concierge |
| /reservation/new | reservation/new.tsx | Reservation form — WhatsApp deep link | Partner data + wa.me |
| /experience/booking | experience/booking.tsx | Multi-step experience booking + Wompi | /data/experiences/*.json |
| /review/new | review/new.tsx | Star rating + text review submission | POST (no-op in static) |
| /concerts | concerts.tsx | Live concert listings by genre | /data/concerts.json |
| /itineraries | itineraries.tsx | AI-generated itineraries (3 categories) | /data/itineraries.json |
| /favorites | favorites.tsx | Aggregated favorites view | FavoritesContext (AsyncStorage) |
| /notifications | notifications.tsx | Notification center | /data/notifications.json |
| /city-pass | city-pass.tsx | City Pass plans display + activation | /data/city-pass/plans.json |

### Auth & Onboarding

| Route | File | Purpose |
|-------|------|---------|
| /login | login.tsx | Email/WhatsApp/Google/Apple sign-in |
| /onboarding | onboarding.tsx | 3-slide intro carousel |
| /complete-profile | complete-profile.tsx | Country, age, music, Instagram |

### Business Portal

| Route | File | Purpose |
|-------|------|---------|
| /business/login | business/login.tsx | Partner authentication |
| /business/dashboard | business/dashboard.tsx | Stats, reservations, onboarding checklist |
| /business/reservations | business/reservations.tsx | Manage incoming reservations |

### Stub Pages (Proximamente)

| Route | File | Gated Feature |
|-------|------|---------------|
| /transporte | transporte.tsx | Lanchas, taxis acuaticos |
| /rutas | rutas.tsx | Route planning |
| /tasa-portuaria | tasa-portuaria.tsx | Port tax payment |
| /my-week | my-week.tsx | Weekly planner |

### Rewards System

| Route | File | Purpose |
|-------|------|---------|
| /rewards | rewards/index.tsx | Tier hub (Explorer — Voyager — Elite — Legend) |
| /rewards/card | rewards/card.tsx | Digital membership card |
| /rewards/offers | rewards/offers.tsx | Available reward offers |

### Port Tax Payment

| Route | File | Purpose |
|-------|------|---------|
| /port-tax/checkout | port-tax/checkout.tsx | Passenger form + Wompi payment |
| /port-tax/ticket/:id | port-tax/ticket/[id].tsx | Digital ticket display |

### Admin

| Route | File | Purpose |
|-------|------|---------|
| /admin | admin.tsx | Admin dashboard |
| /admin/moderation | admin/moderation.tsx | Content moderation queue |
| /admin/operator-login | admin/operator-login.tsx | Operator auth |

**Total: 59 route files. 55 live, 4 Proximamente stubs.**

---

## 3. DATA SCHEMA

### partners.json (538 records, 595 KB)

```
{
  partner_id:          string    "ptr_W001"
  name:                string    "Alquimico"
  category:            string    "bar" | "restaurant" | "hotel" | "beauty" | ...
  subcategory:         string    "cocktail_bar" | "salon" | "barbershop" | ...
  tier:                string    "standard" | "premium" | "elite"
  description:         string
  address:             string
  location:            { lat: number, lng: number }
  phone:               string    "+573001234567"
  image_url:           string    "https://lh3.googleusercontent.com/..."
  instagram:           string    "alquimico"
  booking_link:        string
  rating:              number    4.7
  reviews:             number    1200
  price_range:         string    "$$" | "$$$" | "$$$$"
  hours:               string    "Lun-Sab 18:00 - 02:00"
  is_certified:        boolean
  is_government:       boolean
  experience:          string
  default_payment_link: string
  membership_status:   string    "inactive" | "active"
  membership_tier:     string    "standard" | "premium" | "gold"
  membership_plan:     string
  membership_paid_until: string | null
  cuisine:             string    (restaurants only)
}
```

**Category distribution:**

| Category | Count | Subcategories |
|----------|-------|---------------|
| beauty | 125 | salon (20), barbershop (24), nails (17), makeup (14), facial_spa (19), aesthetic_clinic (20), lashes_brows (11) |
| restaurant | 110 | international, seafood, colombian, italian, asian, mediterranean, vegetarian, gastronomic, fastfood, arab |
| hotel | 80 | boutique, resort, hostel, luxury |
| activity | 73 | tour, water_sport, cultural, adventure |
| wellness | 30 | yoga, massage, holistic |
| bar | 29 | cocktail_bar, rooftop, lounge, salsa_bar |
| beach_club | 26 | — |
| club | 21 | — |
| spa | 20 | — |
| cafe | 17 | — |
| yacht | 3 | — |
| realestate | 3 | — |
| institutional | 1 | — |

### Other Data Files

| File | Records | Key Fields |
|------|---------|------------|
| events.json | 21 | event_id, title, date, venue_id, type, price, capacity, featured |
| concerts.json | 12 | concert_id, artist, genre, date, venue_id, price, ticket_link |
| venues.json | 10 | venue_id, name, type, address, location, hours |
| partner-events.json | 6 | event_id, partner_id, title, date, flyer_url, price |
| transport.json | 3 | transport_id, type (boat), route, schedule, price |
| sponsors.json | 5 | sponsor_id, name, logo_url, tier |
| seasons.json | 3 | season_id, name, date_range, events |
| emergency-contacts.json | 16 | name, category, phones, primary_phone |
| calendar.json | 22 date keys | [{event_id, title, venue, category, start_time}] |
| city-pass/plans.json | 3 | plan_id, name, price_cop, duration_days, perks |

**Photo sources (538 partners):**
- Google Places (lh3.googleusercontent.com): 532 (98.9%)
- Unsplash fallbacks: 2 (0.4%)
- Partner websites: 4 (0.7%)

---

## 4. AI LAYER

### Edge Function: ai-search.ts

| Property | Value |
|----------|-------|
| Model | Claude Sonnet 4.6 |
| max_tokens | 800 |
| Cost per call | ~$0.009 |
| Input | User query + pre-filtered candidate list (partners + events) |
| Output | intent, answer, highlights, recommendations (3-5), suggestions |

**System prompt (Spanish/English):**
- Concierge AI for luxury tourism in Cartagena de Indias
- Pick best 3-5 from candidate list
- Only assert location if zone/address field confirms it
- NEVER invent places outside candidate list
- Short warm response (1-2 sentences)

### Edge Function: concierge.ts

| Property | Value |
|----------|-------|
| Model | Claude Sonnet 4.6 |
| max_tokens | 600 |
| Cost per turn | ~$0.007 |
| Context window | Last 10 messages |
| Grounding | Top 15 partners + 5 events + 3 concerts from catalog |

**Four personas:**

| Persona | Domain | Accent Color | Categories |
|---------|--------|-------------|------------|
| Luna | Nightlife | #A855F7 (purple) | bar, club, nightclub |
| Mare | Beach & Wellness | #06B6D4 (cyan) | beach_club, wellness, spa, yacht, beauty |
| Tino | Gastronomy | #D4AF37 (gold) | restaurant, cafe |
| Ciro | Logistics | #3B82F6 (blue) | activity, hotel, transport |

**Anti-hallucination rules (enforced in both functions):**
1. Only name places from provided catalog list
2. Only assert neighborhood/zone if data confirms it
3. If no match: "no tengo ese lugar en mi catalogo, pero te recomiendo estos:"
4. Off-topic — amicable redirect to tourism
5. Prompt injection — humor-based redirect

**Persona detection:** Multi-word phrases first ("musica en vivo" to Luna, "islas del rosario" to Mare) then 80+ single-word hints then default Ciro.

---

## 5. TRANSACTION MAP

Every user action that "does something" and what actually happens:

### Actions That Work (Live)

| User Action | What Happens | Mechanism |
|-------------|-------------|-----------|
| Tap "Reservar" on partner | Opens reservation form then WhatsApp deep link to partner | `wa.me/{phone}?text={msg}` with bilingual template |
| Tap Uber icon on partner | Opens Uber with partner as destination | `uber://` deep link + web fallback |
| Tap map icon on partner | Opens Google Maps with partner location | `comgooglemaps://` + web fallback |
| Tap phone icon on partner | Initiates phone call | `tel:{phone}` |
| Tap Instagram on partner | Opens Instagram profile | `instagram://user?username=` + web fallback |
| Tap Share on partner | Native share sheet with partner URL | `Share.share()` |
| Search query | Client-side catalog search + AI ranking | Static search + /api/ai-search edge function |
| Concierge message | AI response grounded to catalog | /api/concierge edge function |
| Toggle favorite | Saved to AsyncStorage, persists across sessions | FavoritesContext (local only) |
| Change language | Switches ES/EN/FR/PT across all screens | LanguageContext + tr() i18n system |
| Submit review | POST to API (no-op in static mode) | Falls through silently |

### Actions That Are Gated / No-Op

| User Action | What User Sees | What Actually Happens | File |
|-------------|---------------|----------------------|------|
| Activate City Pass | "Activar" button | Alert: "Proximamente" | city-pass.tsx |
| Book experience (Wompi) | Checkout flow renders | openWompiCheckout() — requires live Wompi config | experience/booking.tsx |
| Port tax payment | Checkout form renders | api.post — no-op in static mode | port-tax/checkout.tsx |
| Login (email/WhatsApp) | Form submits | Demo token issued, no real auth | login.tsx |
| Google/Apple OAuth | Redirect to auth provider | Session exchange, but no persistent backend | login.tsx |
| Business login | Dashboard renders | Static stub data at /data/business/*.json | business/login.tsx |
| Submit reservation via API | WhatsApp opens | api.post('/partners/{id}/track-reserve') — no-op | partner/[id].tsx |

### Dead Routes

| Route | Status |
|-------|--------|
| /transporte | ProximamenteScreen stub |
| /rutas | ProximamenteScreen stub |
| /tasa-portuaria | ProximamenteScreen stub |
| /my-week | ProximamenteScreen stub |
| /concierge (chat UI) | Code exists but disabled via `false &&` gate |

---

## 6. TIER-1 MANIFEST: DORMANT FEATURES

Features that exist in code but are pending backend/payment integration to go live.

### Auth System
- **What exists:** Login UI (email, WhatsApp, Google, Apple), AuthContext provider, token storage (SecureStore/AsyncStorage), session exchange logic
- **What's missing:** Persistent user database. Currently issues ephemeral demo tokens. No email verification, no password reset.
- **Files:** login.tsx, src/context/AuthContext.tsx
- **To activate:** Connect to Supabase Auth or equivalent. Replace demo-login endpoint.

### Booking System
- **What exists:** Reservation form (date, time, party size, notes), WhatsApp template message, booking history UI with status tabs
- **What's missing:** Server-side booking state. Partners confirm via WhatsApp, not in-app. No booking status tracking.
- **Files:** reservation/new.tsx, (tabs)/bookings.tsx, business/reservations.tsx
- **To activate:** Build booking API with status lifecycle (pending — confirmed — completed/cancelled). Add push notifications for status changes.

### Rewards & Loyalty
- **What exists:** Full UI — tier system (Explorer to Voyager to Elite to Legend), point tracking, digital card, offer carousel, redemption flow
- **What's missing:** Points accrual engine. No triggers for earning points (reservations, reviews, referrals). Static stub data.
- **Files:** rewards/index.tsx, rewards/card.tsx, rewards/offers.tsx, src/context/RewardsProvider.tsx
- **To activate:** Build points engine triggered by booking completions. Connect to partner POS for spend verification.

### Partner Portal
- **What exists:** Business dashboard with stats cards, reservation management, onboarding checklist, special Alcaldia (government) dashboard
- **What's missing:** Real-time data feeds. Currently renders static JSON stubs. No partner self-service (edit profile, upload photos, set hours).
- **Files:** business/dashboard.tsx, business/reservations.tsx, business/login.tsx
- **To activate:** Build partner API with CRUD operations. Add photo upload, hours management, reservation management.

### Payments (Wompi)
- **What exists:** Wompi checkout integration in experience booking and port tax. `openWompiCheckout(url)` helper. Payment return page with reference code.
- **What's missing:** Wompi merchant account configuration. Webhook for payment confirmation. Receipt generation.
- **Files:** experience/booking.tsx, port-tax/checkout.tsx, payments/return.tsx
- **To activate:** Configure Wompi merchant keys in Vercel env. Build webhook handler for payment confirmation. Connect to booking status updates.

### City Pass
- **What exists:** 3 plans (Day $50K, Weekend $120K, Week $250K COP) with perks list. "Activar" CTA. Current pass display.
- **What's missing:** Purchase flow. QR validation at partner venues. Usage tracking.
- **Files:** city-pass.tsx, (tabs)/citypass.tsx
- **To activate:** Add Wompi payment for pass purchase. Build QR generation + scanner for venue validation. Build usage tracking dashboard.

### Port Tax
- **What exists:** Full checkout form (passengers, names, travel date). Ticket display page with QR placeholder.
- **What's missing:** Government API integration for official tax payment processing. Real QR ticket generation.
- **Files:** port-tax/checkout.tsx, port-tax/ticket/[id].tsx, tasa-portuaria.tsx (stub)
- **To activate:** Partner with DIMAR or port authority for official integration. Replace Wompi no-op with real payment.

### Concierge Chat (Full UI)
- **What exists:** Complete chat interface with persona selection, message bubbles, starter chips, agent switching. Edge function handles conversations.
- **What's missing:** Nothing — code is complete but UI is disabled via `false &&` boolean gate.
- **Files:** concierge.tsx (line 77), _api/concierge.ts
- **To activate:** Remove `false &&` gate. The edge function already works.

---

## 7. KNOWN-LIMITS REGISTER

Honest list of what the current static architecture cannot do.

| Limitation | Impact | Workaround |
|------------|--------|------------|
| **No persistent user state** | Favorites, language, onboarding status stored in browser localStorage only. Lost on device switch or browser clear. | Acceptable for MVP. Supabase auth + profile sync resolves this. |
| **No real-time booking status** | Partners confirm reservations via WhatsApp. User has no in-app confirmation or status tracking. | WhatsApp workflow is functional. Backend booking API adds tracking. |
| **No payment processing** | Wompi integration exists in code but is not connected. No revenue flows through the app. | Partner membership fees collected externally. Wompi activation is config-only. |
| **No push notifications** | OneSignal referenced but not connected. Notifications page shows static data. | Email/WhatsApp manual outreach. OneSignal setup is straightforward. |
| **No partner self-service** | Partners cannot update their own profiles, hours, photos, or respond to reservations in-app. | Phil manually updates partners.json. Partner portal skeleton exists. |
| **Catalog updates require deploy** | Adding/editing partners requires JSON edit + Vercel deploy (~30 seconds). | Acceptable for <1000 partners. Supabase backend removes this limit. |
| **No analytics** | No Mixpanel/Amplitude/PostHog. No user behavior tracking. | Vercel Analytics provides basic traffic data. Event tracking is a config-level add. |
| **AI costs scale linearly** | Every search query costs ~$0.009. Every concierge turn costs ~$0.007. No caching. | At 1000 DAU x 5 searches = $45/day. Add response caching for common queries to reduce by ~60%. |
| **No offline mode (native)** | Web app requires connectivity. React Native build would cache data locally. | Expo export for iOS/Android adds offline data. Not yet published to app stores. |
| **Single-language catalog** | Partner descriptions are in Spanish only. AI responds bilingually but partner data is not translated. | tr() i18n wrapper translates UI chrome. Description translation is a data task, not a code task. |

---

## APPENDIX: TECH STACK

| Layer | Technology | Version/Config |
|-------|-----------|----------------|
| Framework | Expo + React Native Web | Expo Router (file-based routing) |
| Language | TypeScript | strict: true |
| Styling | React Native StyleSheet | Dark theme, Cinema Engine design tokens |
| Hosting | Vercel | Static + Edge Functions |
| AI | Anthropic Claude Sonnet 4.6 | 2 edge functions, catalog-grounded |
| Maps | Google Maps (web links) + React Native Maps | Location pins, directions |
| Auth | Demo tokens (MVP) | SecureStore (native) / AsyncStorage (web) |
| i18n | Custom tr() + useTr() hook | ES (primary), EN, FR, PT |
| Photos | Google Places API (New) | 98.9% real photos, 0.4% Unsplash fallback |
| Payments | Wompi (configured, not activated) | Colombian payment gateway |
| Data | Static JSON (610 files) | CDN-cached, offline-capable |

---

*AMO Cartagena DNA Document — derived from codebase, 2026-06-11*
*538 partners | 21 events | 12 concerts | 10 venues | 4 AI personas | 59 routes*
