# App Review Reply — Amo Cartagena (Guideline 2.1, Information Needed)

**Paste this into: (a) the App Store Connect "Reply to Apple" message, AND (b) the Notes field of App Review Information.** Attach the screen recording (see recording instructions at the bottom).

---

Thank you for reviewing Amo Cartagena. Here is the requested information.

**DEMO ACCOUNT (no email delivery needed):**
- Email: `applereview@amocartagena.co`
- Verification code: `246810`
- How to sign in: Open the app → tap **"Continuar con email"** → enter the email above → tap **Enviar código** → enter code **246810** → you are signed in. The app uses passwordless email one-time codes; for this demo account the code is fixed, so no email is required.
- Account deletion (required feature): **Perfil** tab → scroll down → **"Eliminar mi cuenta"** → confirm. This permanently deletes the account.
- Guest access: Core browsing (places, map, events, AI concierge) works without an account — tap **"Explorar como invitado."**

**1. Screen recording:** Attached. It begins by launching the app and shows the typical user flow: browsing the curated venue directory, the map, the AI concierge (Luna), email registration + login using the demo account above, and account deletion from the Perfil tab. There is no paid content in this version (see item 4). There is no public user-generated content posted between users (see item 6).

**2. Purpose and target audience:** Amo Cartagena is a free city guide and AI concierge for Cartagena de Indias, Colombia. It solves the common problem of visitors overpaying and missing the best places, by providing a curated, verified directory of 850+ restaurants, hotels, bars, beach clubs and experiences with real reference prices and verified map locations; an AI concierge ("Luna") that answers what-to-do questions in the user's language; a map with walking routes; today's local events; and a "passport" of stamps earned by visiting landmarks. Target audience: international and domestic tourists visiting Cartagena, plus local residents.

**3. Setup and access:** No special setup or sample files are required. Core features work immediately as a guest. To test account-based features (passport, favorites, trip planning), sign in with the demo account in the section above. Account deletion is in the Perfil tab.

**4. External services used to deliver core functionality:**
- Cloud hosting & database: Vercel (app + API) and MongoDB Atlas.
- Authentication: first-party email one-time-code login (no third-party social login is shown on iOS).
- AI concierge: Anthropic Claude API — processes the user's typed chat message to generate recommendations.
- Email delivery: Resend (sends the login verification codes).
- Push notifications: Apple Push Notification service (via Expo).
- Payments: **none are active in this version.** The "City Pass" feature intentionally displays "Próximamente" (Coming Soon) and cannot complete a purchase; there are no In-App Purchases and no functional external payments in this build. If enabled in the future, real-world services (the official island port tax and venue reservations — not digital content) would use Wompi, a Colombian payment gateway licensed by the Superintendencia Financiera de Colombia.

**5. Regional differences:** The app functions consistently across all regions. Its content is focused on Cartagena, Colombia. The interface supports Spanish, English, French, and Portuguese, selectable by the user. There are no region-locked features or content.

**6. Third-party material / authorization:** The venue names, descriptions, and photos are supplied by the businesses themselves through our partner onboarding flow: a business owner registers their own venue, submits their own information and images, and grants Amo Cartagena permission to display them. Users do not post public content to one another, so there is no inter-user user-generated content feed requiring reporting/blocking. Amo Cartagena is operated by MachineMind LLC. The app is a tourism directory and guide and does not operate in a regulated industry.

Please let us know if any further information would help complete the review. Thank you.

---

## Screen recording — how to make it (on your iPhone, ~2 min)

Build 7 is on your iPhone via TestFlight. Record on the **physical device** (Apple requires this):

1. iPhone **Settings → Control Center** → add **Screen Recording** if not present.
2. Open **Control Center** → tap the **record** (circle) button → wait 3s.
3. Do this flow, unhurried:
   - Launch **Amo Cartagena** from the home screen (start the recording BEFORE launching, or re-launch during it).
   - Let onboarding show, tap through to the app.
   - **Explorar / Partners** — scroll the venue cards (shows the real catalog + photos).
   - **Mapa** — show the pins.
   - **Concierge (Luna)** — open it, type a question, show a reply.
   - **Sign up / log in**: tap "Continuar con email" → enter `applereview@amocartagena.co` → send code → enter `246810` → signed in.
   - **Perfil → Eliminar mi cuenta** → confirm (shows account deletion).
4. Stop recording (tap the red bar → Stop). The video saves to Photos.
5. In App Store Connect, reply to Apple and **attach the video**, and paste the text above into both the reply and the App Review Notes field.
6. On the version page, click **"Add for Review" / Resubmit**.
