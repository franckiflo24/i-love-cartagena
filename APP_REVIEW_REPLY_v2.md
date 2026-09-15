# App Review Reply v2 — Amo Cartagena

**Rejection date:** Sep 15, 2026 · **Submission ID:** 4206de67-09ac-4f1e-a0da-454b7d45eb92 · **Reviewed on:** iPad Air 11" (M3) · **Version:** 1.0 (10)

Three issues this round: **Guideline 4 (Apple Maps)**, **2.1(a) (partner demo account)**, **2.1(b) (business model)**.

> Business-model facts confirmed by Phil (Sep 15): partner listings billed off-app; Wompi port-tax checkout is live (real-world government fee, correctly outside IAP). Only remaining blank: the demo **partner** credentials in 2.1(a).

---

## Reply to paste into App Store Connect ("Reply to Apple")

Thank you for the detailed review. We have addressed all three items.

### Guideline 4 — Design (native maps)

Fixed in the next build. Everywhere the app offers directions to a location — the map pin popups, a venue's "Cómo llegar / Get directions" button, an event's directions button, a concert's location, the transport screen, and the "Mi base / get me home" feature — the app now presents the user a choice between **Apple Maps** and **Google Maps** on iOS. Apple Maps is the first option in every chooser. No location action forces a third-party maps app anymore.

### Guideline 2.1(a) — Partner / business account access

We apologize — the previous demo account was a regular tourist account. Partner/business accounts use a separate email + password login. A dedicated demo **partner** account with pre-populated content (a published venue, photos, stats, promotions, and reservations) is provided below. It exercises the full business dashboard.

**Demo PARTNER account:**
- Where to sign in: open the app → **Perfil** tab → **"Soy un negocio / For businesses"** → **business login**, OR navigate to the **/business/login** screen.
- Email: `[CONFIRM — demo partner email]`
- Password: `[CONFIRM — demo partner password]`
- What it shows: a live published venue with photos, the stats dashboard, promotions, reservations, and profile editing.

**Demo TOURIST account** (unchanged, for the consumer side):
- Tap **"Continuar con email"** → email `applereview@amocartagena.co` → **Enviar código** → code `246810`. Passwordless one-time code; fixed for this account, no email needed.
- Guest access: core browsing (places, map, events, AI concierge) works with **"Explorar como invitado."**
- Account deletion: **Perfil** → **"Eliminar mi cuenta"** → confirm.

### Guideline 2.1(b) — Business model

Amo Cartagena is a **free** city guide and AI concierge for Cartagena de Indias, Colombia. It contains **no In-App Purchases and no paid digital content.** The only paid items are **real-world services**, which per App Review Guidelines 3.1.3(e) and 3.1.5(a) do not use — and are not permitted to use — In-App Purchase:

1. **Who uses the paid features?** (a) Cruise/ferry passengers who pay the **official island Port Tax (Tasa Portuaria)** — a government fee for entering the Islas del Rosario / Barú protected area; and (b) local **businesses** who pay for a partner listing/membership to appear in the directory. Regular tourist users pay nothing.

2. **Where are they purchased?** The Port Tax is a real-world government fee, collected through **Wompi** — a Colombian payment gateway licensed by the Superintendencia Financiera de Colombia. Partner listings/memberships are sold **outside the app**, directly by our team via invoicing — there is no consumer-facing purchase of a listing inside the app.

3. **What previously-purchased features can a user access in the app?** A business that has paid for a listing can log into the **business dashboard** (the demo partner account above) to manage its published venue, photos, promotions, reservations, and stats.

4. **What paid content is unlocked without IAP?** None is digital content. All paid items are real-world services: (a) the **official island Port Tax**, a government fee for physically entering the Islas del Rosario / Barú protected area, and (b) real restaurant/experience reservations that are fulfilled physically at the venue. Under App Review Guidelines 3.1.3(e) and 3.1.5(a), real-world services and government fees must use a payment method **other than** In-App Purchase — which is why the Port Tax uses Wompi and no IAP is present.

5. **Physical + digital bundle?** No. There is no bundling of physical and digital goods. Purchases are for real-world services only.

Please let us know if any further detail would help. Thank you.

---

## Pre-send checklist for Phil

- [ ] **Guideline 4:** commit the maps fix, run `eas build -p ios --profile production` (autoIncrements build number), then attach the new build to version 1.0 in ASC and resubmit. The reply above is only accurate once that build is the one under review.
- [ ] **2.1(a):** create/confirm a demo **partner** account and fill its email + password into the reply. It must have pre-populated content (published venue + photos + a promotion + a reservation).
- [x] **2.1(b):** facts confirmed — partner membership billed off-app; Wompi port-tax checkout is live (real-world govt fee, correctly outside IAP).
- [ ] Paste the reply into **both** the "Reply to Apple" message **and** the App Review Information → Notes field. Put the partner + tourist credentials in the App Review Information username/password fields too.
