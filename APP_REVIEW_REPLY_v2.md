# App Review — Amo Cartagena · Resubmission for build 11

**Rejection:** Sep 15, 2026 · **Submission ID:** 4206de67-09ac-4f1e-a0da-454b7d45eb92 · **Reviewed on:** iPad Air 11" (M3) · **Version:** 1.0 (build 10)

Three issues: **Guideline 4** (native maps), **2.1(a)** (partner account access), **2.1(b)** (business model).

## Status
- ✅ **Guideline 4 (code):** fixed & committed (`9758a269`), web deployed, iOS **build 11** compiling on EAS (build `97c39dd5`). Every directions action now offers **Apple Maps** (first) or Google Maps on iOS.
- ✅ **2.1(a):** demo PARTNER account live & verified — `elarsenal@amocartagena.app` / `AmoReview2026!` (El Arsenal Wellness, published venue + cover image + active promotion, verified_owner). Backup: `demo@amocartagena.app` / `AmoReview2026!` (Demo Sandbox, isolated). Login tested → HTTP 200.
- ✅ **2.1(b):** confirmed by Phil (Sep 15) — **NO payments are active in this build.** No IAP, no functional external payments. City Pass shows "Próximamente"; the port-tax checkout is gated (shows a "pay at the pier" notice, no transaction completes). Business listings are sold off-app.

## ⚠️ One thing to check on the listing
The App Store **description** currently says *"Pay the official Rosario Islands port tax… all from the app."* Since payments aren't live yet, a reviewer who taps that flow only sees a notice — which can read as "incomplete" and is inconsistent with the "no payments" answer. **Recommend softening that line** (see the checklist) so the metadata matches the app.

---

## BLOCK 1 — paste into “App Review Information → Notes” (REPLACES the current text)

DEMO TOURIST ACCOUNT (no email delivery needed): email applereview@amocartagena.co, code 246810. Sign in: tap "Continuar con email" > enter that email > tap "Enviar codigo" > enter 246810 > signed in. Account deletion: Perfil tab > "Eliminar mi cuenta" > confirm. Guest browsing works without an account ("Explorar como invitado").

DEMO PARTNER / BUSINESS ACCOUNT (for Guideline 2.1a — the business dashboard): from the signed-in app, open the Perfil tab > "Partners" section > tap "Dashboard de negocio". This opens the business login (email + password). Email: elarsenal@amocartagena.app  Password: AmoReview2026!  This account owns a published venue (El Arsenal Wellness) with a cover image, an active promotion, and the stats / promotions / reservations dashboard, so all business features can be verified.

PURPOSE: Free city guide + AI concierge for Cartagena, Colombia. Curated directory of 850+ verified venues (restaurants, hotels, bars, beach clubs, experiences) with real reference prices and verified map locations; AI concierge (Luna); a map with walking routes; local events; and a landmark "passport". For tourists and residents.

MAPS (Guideline 4): every directions action (map pin popups, venue and event "Cómo llegar/Get directions" buttons, transport, and the "Mi base" get-me-home feature) presents a chooser on iOS between Apple Maps and Google Maps, with Apple Maps first. No location action forces a third-party maps app.

BUSINESS MODEL / PAYMENTS (Guideline 2.1b): the app is FREE and contains NO In-App Purchases and NO functional payments of any kind in this version. The "City Pass" feature displays "Próximamente" (Coming Soon) and cannot complete a purchase. The Rosario Islands port-tax screen is informational: payments are disabled, so it shows a "pay at the pier" notice and no transaction is processed in-app. There is no paid digital content. If payments are enabled in a future version, they would cover only REAL-WORLD services — the official government port tax and physical restaurant/experience reservations — through Wompi (a Colombian gateway licensed by the Superintendencia Financiera de Colombia). Per Guidelines 3.1.3(e)/3.1.5(a) those real-world services must NOT use In-App Purchase. Business listings/memberships are sold OUTSIDE the app by our team via invoicing; there is no consumer purchase of a listing inside the app.

EXTERNAL SERVICES: Vercel + MongoDB Atlas (hosting/database); first-party email one-time-code auth (no third-party social login on iOS); Anthropic Claude API (AI concierge); Resend (login codes); Apple Push Notifications via Expo.

REGIONAL: Functions consistently across all regions; content focused on Cartagena; UI in Spanish/English/French/Portuguese, user-selectable; no region-locked features.

THIRD-PARTY CONTENT: Venue names, descriptions and photos are submitted by the businesses themselves via partner onboarding, granting display rights. No public inter-user content. Operated by MachineMind LLC. Not a regulated industry.

---

## BLOCK 2 — paste into the “Reply to App Review” message

Thank you for the detailed review. We have addressed all three items.

GUIDELINE 4 (native maps): Fixed in this build. Everywhere the app offers directions — the map pin popups, the venue and event "Cómo llegar / Get directions" buttons, a concert's location, the transport screen, and the "Mi base" get-me-home feature — the app now presents a chooser on iOS between Apple Maps and Google Maps, with Apple Maps listed first. No location action forces a third-party maps app.

GUIDELINE 2.1(a) (partner accounts): Our apologies — the earlier demo account was a regular tourist account. Partner/business accounts use a separate email + password login. A demo partner account is now provided in the App Review Information → Notes, with the exact navigation path (Perfil tab → Partners → "Dashboard de negocio"). It has a published venue, photos, stats, promotions and reservations so the full business dashboard can be verified.

GUIDELINE 2.1(b) (business model): The app is free. It contains NO In-App Purchases and NO functional payments in this version. The "City Pass" shows "Próximamente" (Coming Soon) and cannot complete a purchase, and the Rosario Islands port-tax screen is informational (payments disabled — it displays a "pay at the pier" notice). There is no paid digital content. If payments are enabled in a future version they would cover only real-world services (the official government port tax and physical reservations), which under Guidelines 3.1.3(e)/3.1.5(a) must use a method other than In-App Purchase. Business listings are sold outside the app via direct invoicing — there is no in-app purchase of a listing.

We updated the App Review Information notes to reflect the above. Please let us know if any further detail would help. Thank you.

---

## Sign-In Information (ASC fields)
Leave the consumer account in the Sign-In Information username/password fields (applereview@amocartagena.co / 246810). Apple accepts the additional PARTNER account described in the Notes (Block 1) — one Sign-In field pair, extra accounts in Notes is standard.

## Pre-submit checklist for Phil
- [ ] Wait for EAS build 11 (`97c39dd5`) to finish → in ASC, remove build 10 from the version, **Add Build → 11**, Save.
- [x] Demo PARTNER account ready: elarsenal@amocartagena.app / AmoReview2026! (published venue + cover image + active promotion; login verified HTTP 200). A demo happy-hour promo was added to El Arsenal for review — clear it after approval if you like.
- [ ] **Replace** the current App Review Notes with Block 1 (adds the partner account + Guideline-4 note; keeps the accurate "no payments" statement).
- [ ] Paste Block 2 into the "Reply to App Review" message.
- [ ] **Soften the description's port-tax line** so it doesn't promise active payment. Suggested: replace "Pay the official Rosario Islands port tax and coordinate reservations with the best spots — all from the app." with **"Find official Rosario Islands port-tax info and coordinate reservations with the best spots — all from the app."**
- [ ] (Optional) upload the remaining 4 screenshots (currently 6 of 10).
- [ ] **Add for Review → Submit.** Release: your call (Manual vs Automatic).
