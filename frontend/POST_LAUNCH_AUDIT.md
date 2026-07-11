# AMO CARTAGENA — POST-LAUNCH PRODUCTION AUDIT
**Date:** 2026-07-10
**Auditor:** Claude Opus 4.6 (automated)
**Site:** https://www.amocartagena.co
**Backend:** https://backend-mu-one-74.vercel.app
**Partners in DB:** 808

---

## TIER 1 — LIVE-USER BLOCKERS

### ~~1.1 — 213 BROKEN PARTNER IMAGES~~ ✅ FIXED
**Status:** RESOLVED 2026-07-10. All 808/808 images now returning 200.
**What was wrong:** 213 of 808 partner image URLs returned non-200 responses.
**Evidence:**
- 185 `lh3.googleusercontent.com` URLs return **403 Forbidden** (expired signed CDN tokens)
- 27 Unsplash URLs return **404 Not Found** (deleted/moved images)
- 1 custom domain URL returns error

| Image Source | Total | Working | Broken | % Broken |
|---|---|---|---|---|
| Google Places API proxy (`maps.googleapis.com`) | 496 | 496 | 0 | 0% |
| Google CDN direct (`lh3.googleusercontent.com`) | 188 | 3 | 185 | 98% |
| Unsplash | 121 | 94 | 27 | 22% |
| Other | 3 | 2 | 1 | 33% |

**Root cause:** The 185 Google CDN URLs are direct signed links that expire. The 496 working Google photos use the proxy format (`maps.googleapis.com/maps/api/place/photo?photo_reference=...&key=...`) which works indefinitely via the API key.
**Fix:** Re-fetch all 188 `googleusercontent` URLs through the Places Photos API using the partner's `google_place_id`. Replace broken Unsplash URLs with Google Places photos or new Unsplash images.
**Effort:** 1-2 hours (scripted, same approach as the earlier photo refresh)

---

### ~~1.2 — STALE STATIC FALLBACK DATA~~ ✅ FIXED
**Status:** RESOLVED 2026-07-10. Static fallback now has 808 partners (current, clean).
**What was wrong:** `/data/partners.json` had 817 partners (pre-dedup) with duplicates and broken image URLs.

---

### 1.3 — PROMOTIONS API 404
**What:** `/api/promotions` returns 404. The frontend calls `/api/promotions/today` on home screen load (index.tsx:209). Currently returns empty array `[]` (no promotions today), but the base `/api/promotions` route doesn't exist.
**Evidence:** `curl /api/promotions → 404`, `curl /api/promotions/today → []`
**Fix:** Non-blocking since `/promotions/today` works and the UI gracefully hides the section when empty. No user-visible impact currently. Low priority.
**Effort:** N/A (cosmetic)

---

## TIER 2 — TROPHY DEGRADATION

### 2.1 — CONCIERGE: SOLID AI, BUT GATED + SEARCH GAP
**Concierge quality: EXCELLENT.** 10/10 messy tourist queries answered. 16 venue names recommended, 16/16 verified in the 808-partner DB. Zero hallucinations. Handles vague queries ("im bored", "wheres good to eat") naturally.

| Query | Agent | Venues Recommended | All Verified? |
|---|---|---|---|
| "wheres good to eat" | Mare | Restaurante Sambal, CANCHA Restaurante | ✅ |
| "im bored" | Ciro | (asked clarifying questions) | ✅ |
| "what do i do when it rains" | Ciro | El Deposito, Barra Xperimental | ✅ |
| "cheap eats near me" | Mare | Tenderete, EL RINCON | ✅ |
| "romantic" | Tino | Mankay Rooftop, Casual Bistro, Maria del Puerto | ✅ |
| "party tonight" | Luna | Sambal, Ajeno Rooftop, Bazurto Social Club | ✅ |
| "kids stuff" | Ciro | Rosario Islands, Surfing Cartagena | ✅ |
| "what's happening this week" | Ciro | (no events — only fetches today's, not week) | ✅ |
| "how do i get to rosario" | Tino | Botegena Boats, Maria del Puerto | ✅ |
| "is it safe" | Ciro | (safety advice, no venue needed) | ✅ |

**Issues found:**
1. **Auth-gated** — both concierge endpoints require login. Guest users can't use the trophy feature. Growth wall.
2. **Search bar synonym gap** — unauthenticated search returns 0 results for "eat", "food", "kids", "bored", "safe" because those words aren't in the synonym dictionary. Authenticated users get AI-enriched results.
3. **"This week" only gets today** — `concierge.py` filters events by `{"date": today}`, not a date range. "What's happening this week" misses 6 days.
4. **Language switching** — sometimes responds in Spanish to English queries.

**Fix options:** (a) Allow N free guest concierge queries, (b) add missing search synonyms for unauthenticated users, (c) expand event query to 7-day range.
**Effort:** 2-3 hours for all three

---

### 2.2 — 4 OF 8 WELLNESS SUBCATEGORY FILTERS RETURN ZERO RESULTS
**What:** The Wellness & Spa card has 8 filter pills: spa, beauty, hair, nails, recovery, fitness, sport, yoga. Four of them (`recovery`, `fitness`, `sport`, `yoga`) return **zero results** because the 37 gym/yoga/fitness partners live under `category=activity`, not `beauty`/`spa`.
**Evidence:**
- "Recovery" filter → 0 partners
- "Fitness" filter → 0 partners
- "Sport" filter → 0 partners
- "Yoga" filter → 0 partners
- Meanwhile, 14 Smart Fit/gym locations, 6 yoga studios, and 17 fitness centers sit in `category=activity` where no one looking for "fitness" would browse

**Fix:** Either (a) re-categorize 37 gym/yoga/fitness partners from `activity` to `spa`/`beauty` with proper subcategories, or (b) remove the 4 empty filter pills, or (c) make the wellness card also pull from `activity` partners with fitness subcategories.
**Effort:** 1 hour for option (a), 15 min for option (b)

---

### 2.3 — "BEAUTY" FILTER IS A CATCH-ALL (114 of 163 wellness partners)
**What:** The `matchesSubcat` function matches ALL 109 beauty-category partners when "Belleza" is selected, regardless of their actual subcategory. This dumps 70% of the wellness card into one filter, defeating the drill-down purpose.
**Evidence:** Code at `partners.tsx:149`: `if (subKey === 'beauty' && p.category === 'beauty') return true` — no subcategory matching happens.
**Missing filter pills:** `barbershop` (24 partners), `aesthetic_clinic` (18), `salon` (16), `makeup` (14), `lashes_brows` (11) have no dedicated pills.
**Fix:** Either add dedicated filter pills for the actual beauty subcategories, or make the `beauty` filter only match `subcategory=beauty` (7 partners) and add new pills for the rest.
**Effort:** 1-2 hours

---

### 2.4 — 29 ADDITIONAL POTENTIAL DUPLICATE PAIRS
**What:** Beyond the 9 pairs we deduped, 29 more partner pairs share the same `google_place_id` AND same category. These are likely duplicates from different data sources.
**Evidence (samples):**
- ptr_1338 "Kanuú Restaurante" / ptr_R061 "Kanuu" (both restaurant, same place_id)
- ptr_beauty_0464 "Oasi Spa Getsemani" / ptr_V044 "Oasi Spa Getsemaní" (both spa)
- ptr_1437 "Makani Luxury Cartagena" / ptr_W141 "Makani Beach Club" (both beach_club)
- ptr_W106 "Donde Olano" / ptr_cu_004 "Restaurante Donde Olano" (both restaurant)

**Fix:** Run the dedup script again with `google_place_id` matching (not just name matching). Requires manual review to confirm which are true duplicates vs. legitimately different businesses sharing a Google listing.
**Effort:** 1 hour (script + manual review of 29 pairs)

---

### 2.5 — 37 MISPLACED GYM/FITNESS PARTNERS IN ACTIVITIES
**What:** 37 partners categorized as `activity` with subcategories `bienestar`/`wellness_center` are gyms, yoga studios, and fitness centers. They appear under "Actividades" but belong in "Wellness & Spa." This also causes the empty wellness filters (see 2.2).
**Evidence:** ARES GYM, Smart Fit Castle, Spinning Center Gym, CrossFit Cartagena, Yoga Cartagena, Dhyana Yoga Studio — all under Activities.
**Fix:** Re-categorize to `spa` or `beauty` with appropriate subcategories matching the wellness filter pills.
**Effort:** 30 min (batch update via admin/enrich endpoint)

---

## TIER 3 — POLISH

### 3.1 — NO SUBCATEGORY DRILL-DOWN FOR ACTIVITIES (151 partners) OR SERVICES (70 partners)
**What:** Both cards dump all partners into a flat list with no subcategory filters. Activities has 151 partners ranging from museums to yacht charters to gyms. Services has 70 ranging from currency exchange to tattoo parlors.
**Evidence:** Neither category is in `REQUIRE_SUBCAT_PICK` and neither has entries in `SUBCATEGORIES_BY_CAT`.
**Fix:** Add subcategory filter pills for both. Activities: tours, water_sports, cultural, fitness, yacht. Services: currency_exchange, pharmacy, grocery, transport, rental.
**Effort:** 2 hours

---

### 3.2 — INCONSISTENT SUBCATEGORY NAMING
**What:** Same service types use different subcategory names across categories:
- Barbers: `barbershop` (beauty, 24 partners) vs `barber` (service, 2 partners)
- Gyms: `bienestar` (activity, 14 partners) vs `gym_daypass` (service, 2 partners)
- Luggage storage labeled as `delivery` (2 service partners)
**Fix:** Normalize subcategory names to a single taxonomy.
**Effort:** 30 min (batch update)

---

### 3.3 — PORT TAX PAYMENT SHOWS "PRÓXIMAMENTE"
**What:** The port tax checkout flow calls `checkWompiEnabled()` which checks if Wompi payment keys are configured. Currently returns false → shows "Próximamente, paga directamente en el Muelle La Bodeguita."
**Evidence:** `port-tax/checkout.tsx:100` — `Alert.alert('Próximamente', ...)`
**Fix:** Configure Wompi keys in backend env vars, or accept as intentional for launch.
**Effort:** 15 min (if keys are available), or N/A (if intentional)

---

### 3.4 — REWARDS & CITY PASS REQUIRE AUTH
**What:** Rewards offers endpoint returns 401 for unauthenticated users. City Pass activation requires auth. These are expected behaviors but mean guest users hitting these features see error states until they sign up.
**Evidence:** `GET /api/rewards/offers → {"detail":"Not authenticated"}`
**Fix:** Intentional — no action needed. The UI should show a login prompt rather than an error.
**Effort:** N/A

---

### 3.5 — EXPERIENCE BOOKING FALLS BACK TO WHATSAPP
**What:** The experience booking flow attempts Wompi payment first but falls back to a WhatsApp redirect if payment isn't configured: "El pago en línea estará disponible pronto. Contacta al operador por WhatsApp."
**Evidence:** `experience/booking.tsx:63`
**Fix:** Configure Wompi or accept WhatsApp as the booking method for now.
**Effort:** N/A (functional fallback)

---

### 3.6 — RESERVATION "TODO" IN CODE
**What:** `reservation/new.tsx:40` has `// TODO: Replace with real AMO operations number`. The reservation flow works (sends request to backend) but the hardcoded support number may be wrong.
**Evidence:** Line 40 of reservation/new.tsx
**Fix:** Replace with real AMO operations WhatsApp number.
**Effort:** 5 min

---

### 3.7 — 3 MISCATEGORIZED PARTNERS
**What:**
- 3 concierge/luxury services in Activities → should be Services
- 1 beach club (Rolling Playas) in Activities → should be Beach Clubs
**Fix:** Batch re-categorize.
**Effort:** 10 min

---

## SUMMARY TABLE

| # | Finding | Tier | User Impact | Effort |
|---|---------|------|-------------|--------|
| 1.1 | 213 broken images | T1 | High — 26% of partners show broken photos | 1-2h |
| 1.2 | Stale static fallback (817 vs 808) | T1 | Medium — shows dupes when backend slow | 30m |
| 1.3 | /api/promotions 404 | T1 | None currently (graceful fallback) | N/A |
| 2.1 | Concierge gated behind auth | T2 | High — trophy feature invisible to guests | Decision |
| 2.2 | 4 empty wellness filters | T2 | Medium — users see "0 results" for fitness/yoga | 1h |
| 2.3 | Beauty filter is catch-all | T2 | Low — works but bad UX, 114 of 163 in one bucket | 1-2h |
| 2.4 | 29 more potential duplicates | T2 | Low — slightly inflated count, occasional double cards | 1h |
| 2.5 | 37 gyms misplaced in Activities | T2 | Medium — wrong category, feeds into 2.2 | 30m |
| 3.1 | No filters for Activities/Services | T3 | Low — flat list browsing, still functional | 2h |
| 3.2 | Inconsistent subcategory names | T3 | None — backend only | 30m |
| 3.3 | Port tax "Próximamente" | T3 | Low — users told to pay at dock | Decision |
| 3.4 | Rewards/CityPass auth-gated | T3 | None — expected behavior | N/A |
| 3.5 | Experience booking → WhatsApp | T3 | Low — functional fallback | Decision |
| 3.6 | TODO in reservation code | T3 | Unknown — may have wrong phone | 5m |
| 3.7 | 4 miscategorized partners | T3 | None — minor | 10m |

---

## ERROR MONITORING BASELINE

### API Endpoints (all tested 2026-07-10)
| Endpoint | Status | Notes |
|----------|--------|-------|
| /api/health | 200 | OK |
| /api/partners | 200 | 808 partners, 970KB, ~2s |
| /api/events | 200 | 175 events, 65 upcoming |
| /api/experiences | 200 | 34 experiences |
| /api/sponsors | 200 | OK |
| /api/seasons | 200 | OK |
| /api/partner-events | 200 | OK |
| /api/promotions | 404 | Base route missing; /promotions/today works |
| /api/auth/signup | 200 | Email + code flow works |
| /api/auth/google | 401 | Expected (needs valid ID token) |
| /api/rewards/offers | 401 | Expected (needs auth) |

### Frontend Assets
| Asset | Status |
|-------|--------|
| JS bundle (entry-*.js) | 200, 2.7MB |
| /data/partners.json | 200 (STALE: 817) |
| /data/events.json | 200 |
| /sw.js | 200 |
| CORS | Properly configured |

### Routes (all return 200)
/, /partners, /explore, /concierge, /login, /reservations, /reservation/new, /experience/booking, /port-tax/checkout, /port-tax/tickets, /rewards, /rewards/offers, /rewards/card, /city-pass, /favorites, /business/login, /business/dashboard

### Console Errors
Cannot test client-side JS console from server. Recommend: open Chrome DevTools on https://www.amocartagena.co and check Console tab for runtime errors.

---

## THE 817→808 MATH
- **Before:** 817 partners
- **Deduplication:** Removed 9 duplicate records (9 pairs → kept 9 winners, deleted 9 losers)
- **After:** 808 partners
- **Verification:** 817 - 9 = 808 ✓
- **Note:** 29 additional potential duplicate pairs identified (same google_place_id + same category). If confirmed and cleaned, true unique count would be ~779.
