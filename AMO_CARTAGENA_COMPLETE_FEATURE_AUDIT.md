# AMO CARTAGENA — Complete Platform Feature Audit
## For Vendor/Partner Pitch Deck Creation

**Date:** June 19, 2026
**Platform:** AMO Cartagena — AI-Powered City Tourism & Commerce App
**Markets:** Cartagena, Colombia (expandable to any LATAM city)
**Built by:** MachineMind

---

## PLATFORM AT A GLANCE

| Metric | Value |
|--------|-------|
| Total Partners/Venues | 543 |
| Total Events | 83 (32 cultural, 21 nightlife, 14 festivals) |
| Partner Categories | 13 (restaurants, bars, hotels, beauty, wellness, activities, beach clubs, clubs, spas, cafes, yachts, real estate, institutional) |
| Partner Tiers | 4 (Popular: 209, Premium: 171, Standard: 125, Elite: 37) |
| Languages | 4 (Spanish, English, French, Portuguese) |
| AI Agents | 5 (4 specialist concierges + 1 general "Amo" agent) |
| API Endpoints | 95+ |
| Neighborhoods Covered | 10+ zones (Centro Historico, Getsemani, Manga, Bocagrande, San Diego, Isla Baru, etc.) |
| Platforms | iOS, Android, Web (PWA) |

---

## 1. CONSUMER FEATURES (What Users Get)

### 1.1 AI Concierge — 4 Specialist Agents
The app has **four AI concierge personas**, each powered by Claude AI and grounded in real partner data (never hallucinated recommendations):

- **LUNA** — Nightlife expert. Bars, rooftops, clubs, salsa spots, champeta clubs, live music. Knows which spot is hot tonight.
- **MARE** — Gastronomy concierge. Recommends restaurants by occasion (romantic dinner, group, pre-party, brunch). Names REAL dishes from verified menus.
- **TINO** — Deals & value hunter. City Pass savings, rewards redemptions, best-value experiences. Cross-category bargain finder.
- **CIRO** — Itinerary planner. Builds full-day plans with geographically-flowing routes, time estimates, and "why this place" explanations.

Each agent has a distinct personality, only recommends verified partners from the database, and cross-refers to other agents ("Mi colega Mare conoce cada mesa...").

### 1.2 AI-Powered Search
- Natural language search across all content (partners, events, concerts, transport)
- Intent classification (looking for a restaurant? an event? transport info?)
- AI-generated conversational answers grounded in real search results
- Suggested follow-up queries

### 1.3 AI Daily Itineraries
- 3 curated daily routes: **Lifestyle** (gastro/beach/wellness), **Cultura** (history/art/museums), **Musical** (concerts/DJ/clubs)
- 4-6 stops per route with time, venue, duration, and personalized "why" explanation
- Personalized using AI-built user profile (interests, vibe, budget, music preferences)
- All venues validated against real catalog — zero hallucinated locations

### 1.4 AI User Profiling
- After 2+ favorites, the AI automatically builds a traveler persona
- Outputs: persona label (e.g., "Bon vivant Caribe"), interests, vibe tags, preferred budget, time slots, music genres
- Powers personalized recommendations across the entire app

### 1.5 Interactive City Map
- Dark-themed Leaflet map centered on Cartagena
- Color-coded markers by venue type (restaurants=red, nightclubs=pink, hotels=blue, beach clubs=cyan, etc.)
- Filterable by: All, Venues, Partners, Concerts
- Live user location with pulsing GPS dot
- Tap any marker for details + "How to get there" (opens Google Maps)
- Location analytics with zone detection

### 1.6 Events & Agenda System
- **83 city events** — cultural, nightlife, festivals, markets, sports, religious, concerts
- **Partner-published events** — businesses publish their own events with AI moderation
- Calendar view with month navigation + date strip
- "Salir Hoy" (What's happening today) vs "Mi Agenda" (personal saved events)
- Category filters: Gastronomy, Music, Party, Wellness, Art, Pop-up, Day Pass, Sunset
- Day/night event split on the home screen
- 26 recurring weekly events auto-refresh

### 1.7 Explore & Discovery
- 12 category filter chips with subcategory drill-down
- **Barrios de Cartagena** — neighborhood guides with safety rating (1-5 stars), price index, "best for" tags, taxi fare from airport, tourist mistakes to avoid (bilingual)
- Featured experiences carousel
- Partner grid sorted by tier then rating
- Subcategory counts per category

### 1.8 City Pass (Digital Tourism Card)
- 3 plans: **Basic**, **Premium**, **Ultimate** (priced in COP)
- QR code card with pass ID, plan name, expiry
- Benefits: discounts at partner venues, priority access, exclusive experiences
- Trust badges: Secure payment, 24h refund, 24/7 support
- Integrated Wompi checkout

### 1.9 Port Tax (Tasa Portuaria)
- Digital port tax ticket purchase for island trips
- Configurable price per person, quantity selector
- 7-day advance date picker
- Passenger name fields
- QR-code ticket with one-time redemption
- Auto-expiry logic

### 1.10 Rewards & Loyalty Program
**4-tier system** based on lifetime points:

| Tier | Points | Benefits |
|------|--------|----------|
| Explorer | 0-2,999 | Base access |
| Voyager | 3,000-9,999 | 5% off, priority booking, early event access |
| Elite | 10,000-24,999 | 15% off, VIP access, exclusive invites, welcome gift |
| Legend | 25,000+ | 30% off, room upgrades, VIP treatment, birthday surprises, private events |

**How users earn points:**
- City Pass purchase: 500 pts
- Experience booking: 400 pts
- Partner event booking: 300 pts
- Port Tax: 200 pts
- Profile completion: 200 pts
- Reservation: 100 pts
- Review: 50 pts
- Referral: 500 pts

**Redeemable offers:** Welcome Drink (500pts), 15% Off Sunset (1,500pts), VIP Table Upgrade (5,000pts), Private Yacht (15,000pts)

### 1.11 Reservations
- Request-based system (not instant booking)
- Date picker (7 days ahead), time slot selector, party size, notes
- Event-linked reservations
- Full status tracking: pending → confirmed → completed (or cancelled/rejected/no-show)
- Push notifications on every status change
- Free cancellation up to 2 hours before

### 1.12 Reviews & Ratings
- 4 subcategory ratings: experience, service, location, value
- Up to 5 photos per review
- "Verified booking" badge for users who actually visited
- Helpful/Report functionality
- Auto-aggregates partner rating on every new review
- 50 loyalty points per review

### 1.13 Notifications
- Real-time push notifications (Expo Push)
- In-app notification feed with read/unread states
- 9 notification types: reservation updates, event reminders, transport, venue updates, general
- Background event reminder scheduler (20-28 hours before favorited events)

### 1.14 Concerts
- Dedicated concert listing with genre and date filters

### 1.15 Transport
- Boat/island transport information and ticket purchase with QR codes

### 1.16 Favorites & Personal Calendar
- Save partners, events, partner-events
- "My Week" personal agenda
- Works offline (guest mode uses local storage, syncs on login)

### 1.17 Onboarding & Authentication
- Multi-method login: Google, WhatsApp, Email, Apple (iOS)
- Guest mode with full browsing capability
- First-time onboarding flow
- Profile completion with nationality, age group, interests

### 1.18 Promotions & Daily Deals
- Partner promotions with original/discounted pricing
- Discount percentage badges
- "Flash deal" indicators
- Home screen carousel rotation
- Click tracking for attribution

---

## 2. BUSINESS PORTAL (What Partners Get)

### 2.1 Onboarding & Activation
- **Magic link invitation** — operator sends WhatsApp invite with activation token
- Self-service password creation + terms acceptance
- **Onboarding progress bar** with weighted scoring (100%):
  - Name (10%), Category (5%), Address (10%), Phone (10%), WhatsApp (10%), Description (15%), Instagram (5%), Schedule (10%), Payment Link (10%), Photos (15%)
- Account reviewed before going public (<24h)
- Partner lifecycle: invited → active → approved → public

### 2.2 Partner Dashboard
- Profile card with image, name, tier badge, verified status
- **4 KPI stat cards**: Upcoming Events, Views, Reservas, Total (each clickable for drill-down)
- Reservations CTA with pending count badge
- Membership card showing plan tier, monthly fee, status, days remaining
- Events section with create/edit/delete + moderation status
- Pull-to-refresh

### 2.3 Event Publishing with AI Moderation
- Create events with: title, description, 6 category types, date/time, flyer upload
- **Every event passes through AI moderation** before publishing:
  - 3 verdicts: Auto-Approve, Needs Review, Reject
  - Auto-corrects wrong categories
  - Auto-improves weak descriptions
  - Completeness scoring (0-100)
- Flyer upload with **AI image moderation**:
  - Detects: nudity, drugs, violence, hate symbols, competing brand watermarks
  - Auto-generates Spanish caption + visual tags
- UTM-tracked booking links (utm_source=amocartagena)
- Published/draft toggle

### 2.4 Reservation Management
- **Stats banner**: Pending, Upcoming confirmed, Completed (30d)
- **3 tabs**: To Confirm, Upcoming, History
- Confirm/Reject with optional note to client
- Quick actions: WhatsApp (pre-filled greeting), Mark Completed, Mark No-show
- Push notifications to both user and partner on every state change

### 2.5 Freemium Business Model (3 Tiers)

| Feature | FREE | PRO ($150K COP/mo) | ELITE ($500K COP/mo) |
|---------|------|---------------------|----------------------|
| Profile visible in app | ✅ | ✅ | ✅ |
| Appear in AI concierge | ✅ | ✅ | ✅ (priority) |
| Demand notifications | ✅ | ✅ | ✅ |
| See reservation requests | Locked (shows $ value) | ✅ Full details | ✅ Full details |
| Client contact info | ❌ | ✅ Name, WhatsApp, email | ✅ |
| Confirm/reject reservations | ❌ | ✅ | ✅ |
| Publish events | ❌ | ✅ | ✅ |
| Promotions | ❌ | ✅ | ✅ |
| Full analytics | ❌ | ✅ | ✅ |
| Featured position | ❌ | ❌ | ✅ |
| Sponsor banner on home | ❌ | ❌ | ✅ |
| Demographic data / CRM | ❌ | ❌ | ✅ |
| Priority support | ❌ | ❌ | ✅ |

**FREE partners see locked lead cards** with estimated value per lead ($160K COP each) — driving upgrade urgency.

### 2.6 Analytics & Stats
- Views per event and profile
- Reserve click counts
- Moderation status tracking
- UTM attribution on all outbound links

### 2.7 Profile Management
- Live preview card
- Image upload with AI moderation
- Editable: description, address, Instagram, booking link, price range, experience
- Payment link integration (Wompi/Bold/PSE compatible)
- WhatsApp + phone + email contact fields

---

## 3. GOVERNMENT / ALCALDIA FEATURES

### 3.1 Full KPI Dashboard
- Users, passes, port tax, demographics, user growth
- Top events, zone analytics, conversion funnel, revenue breakdown

### 3.2 CRM & Demographics
- Nationality breakdown (with flags)
- Age groups, genders
- User growth over time

### 3.3 Financial
- Unified payment history (City Pass + Port Tax)
- Revenue breakdown by tier
- Partner payout reconciliation (gross/commission/owed)
- CSV exports (users + payments)

### 3.4 Content Moderation
- Moderation queue for partner submissions
- Approve/reject with AI pre-screening
- Moderation metrics

### 3.5 Partner Membership Management
- Update partner membership tiers
- View all partners with membership state
- Approve/suspend/reactivate partners

---

## 4. PLATFORM OPERATOR FEATURES

### 4.1 Partner Lifecycle Management
- Create partner skeleton with activation magic link + WhatsApp invite
- Regenerate activation tokens
- Approve/suspend/reactivate partners
- View all partners with lifecycle status

### 4.2 Search Analytics
- Top searched queries + intent classification
- Understand what users are looking for

### 4.3 Analytics Dashboard
- Full event tracking (page views, clicks, bookings, searches, filters)
- Location heatmap aggregation
- Hourly/daily activity charts
- Conversion funnel visualization

---

## 5. PAYMENT INFRASTRUCTURE

### 5.1 Wompi Integration (Colombia's Leading Payment Processor)
- **Supported methods**: Cards, Nequi, PSE, Bancolombia, Daviplata
- SHA-256 integrity signatures for secure checkout
- Webhook receiver with signature verification
- Auto-fulfillment engine: payment approved → auto-provisions City Pass / Port Tax ticket / Event booking / Experience booking + awards loyalty points

### 5.2 Commission Engine
- 3% default commission on partner transactions
- 5% on reservations
- 0% on government/City Pass/Port Tax

### 5.3 Revenue Streams
1. **Partner memberships** (FREE / PRO $150K / ELITE $500K COP/month)
2. **City Pass sales** (Classic $200K / Premium $400K COP)
3. **Port Tax digital tickets**
4. **Experience bookings** (commission)
5. **Partner event tickets** (commission)
6. **Sponsor banners** (Elite tier feature)

---

## 6. AI & AUTOMATION STACK

| Capability | Technology | What It Does |
|-----------|------------|--------------|
| AI Concierge (4 agents) | Claude Sonnet 4.6 | Personalized recommendations grounded in real data |
| General AI Agent ("Amo") | GPT-4o-mini | Conversational city guide with action cards |
| AI Search | GPT-4o-mini | Intent classification + conversational answers |
| AI Itinerary Generator | GPT-4o-mini | Personalized daily routes (4-6 stops) |
| AI User Profiling | GPT-4.1-mini | Behavioral persona from favorites/calendar/location |
| AI Content Moderation | GPT-4.1-mini | Auto-approve/review/reject partner events |
| AI Image Moderation | GPT-4o-mini (multimodal) | Detect inappropriate content in uploaded images |
| Event Reminder Scheduler | Background task | Push notifications 20-28h before favorited events |
| Fulfillment Engine | Webhook-driven | Auto-provision passes/tickets on payment |

---

## 7. DATA CATALOG SUMMARY

### Partners by Category
| Category | Count |
|----------|-------|
| Beauty | 125 |
| Restaurant | 111 |
| Hotel | 80 |
| Activity | 74 |
| Wellness | 31 |
| Bar | 30 |
| Beach Club | 26 |
| Club | 22 |
| Spa | 20 |
| Cafe | 17 |
| Real Estate | 3 |
| Yacht | 3 |
| Institutional | 1 |

### Data Richness Per Partner
- **100% have**: name, description, category, subcategory, tier, address, GPS coordinates, image, hours, price range
- **99% have**: phone number
- **93% have**: rating + review count
- **82% have**: booking link
- **77% have**: experience description
- **42% have**: Instagram
- **8% have**: verified signature dishes (46 top restaurants)

### Events Summary
- **83 total events** (32 cultural, 21 nightlife, 14 festivals, 7 markets, 4 sports, 3 religious, 2 concerts)
- **45% free**, 55% paid (COP 13K - 2.2M range)
- **26 recurring** weekly events
- **29 featured** events
- All bilingual (Spanish + English)
- Confidence scores + source citations + verified dates

### Price Distribution
- $$ (moderate): 80%
- $$$ (upscale): 13%
- $$$$ (luxury): 5%
- $ (budget): 3%

### Top Neighborhoods
Centro Historico (110), Getsemani (60), Manga (45), Bocagrande (16), San Diego (15), Isla Baru (9)

---

## 8. TECHNICAL ARCHITECTURE

| Layer | Technology |
|-------|-----------|
| Frontend | React Native (Expo Router) — iOS, Android, Web |
| Backend | FastAPI (Python) |
| Database | MongoDB (Motor async driver) |
| AI | Claude Sonnet 4.6 + GPT-4o-mini + GPT-4.1-mini |
| Payments | Wompi (Cards, Nequi, PSE, Bancolombia, Daviplata) |
| Push Notifications | Expo Push Service |
| Hosting | Vercel (frontend) + Render (backend) |
| Maps | Leaflet with CartoDB dark tiles |
| Analytics | Custom event tracking + location heatmaps |
| Auth | OAuth + bcrypt + HMAC tokens |

---

## 9. COMPETITIVE MOATS

1. **Data Moat** — 543 verified venues with GPS, ratings, hours, menus, signature dishes. This data accumulates and improves over time. Competitors start from zero.

2. **AI Intelligence Layer** — 5 AI agents that learn user preferences and generate increasingly personalized recommendations. The more users interact, the smarter the concierge becomes.

3. **Workflow Lock-in** — Partners manage reservations, events, and analytics through the app. Their customers book through the app. Switching means losing their review history, reservation pipeline, and visibility.

4. **Automation Arbitrage** — AI moderation, auto-fulfillment, background reminders, UTM tracking — processes that would require 3-5 employees to do manually.

5. **Network Effects** — More partners = better recommendations = more users = more reservation leads = more partners upgrade to PRO/ELITE.

6. **Government Integration** — Alcaldia dashboard, port tax digitization, and official event calendar create institutional dependency.

---

## 10. KEY METRICS FOR PITCH

- **543 venues** cataloged and verified
- **83 events** in the system
- **95+ API endpoints** powering the platform
- **5 AI agents** providing personalized service
- **4 languages** supported
- **13 business categories** covered
- **4 loyalty tiers** with 8 point-earning actions
- **6 revenue streams** (memberships, passes, tickets, commissions, sponsor banners, experiences)
- **3 partner tiers** with clear upgrade path (FREE → PRO → ELITE)
- **5 payment methods** supported (Cards, Nequi, PSE, Bancolombia, Daviplata)
- **10+ neighborhoods** mapped with safety ratings and local intel
- **Zero hallucination guarantee** — AI only recommends verified, real venues from the database

---

*Generated by MachineMind — June 19, 2026*
*For pitch deck creation, paste this entire document into Claude with your design preferences.*
