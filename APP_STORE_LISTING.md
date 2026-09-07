# AMO Cartagena — App Store Connect Listing (ready to paste)

App: **Amo Cartagena** · Bundle `com.amocartagena.app` · ASC App ID `6809565354`
Apple Team `4C39DXRG9L` · Contact email **phil@machinemindconsulting.com**
Privacy policy: https://www.amocartagena.co/privacidad · Support: https://www.amocartagena.co/ayuda

---

## App information

- **Name** (30 char max): `Amo Cartagena`
- **Subtitle** (30 char max):
  - ES: `Tu Cartagena, sin sorpresas` (26)
  - EN: `Cartagena guide & concierge` (27)
- **Primary category**: Travel
- **Secondary category**: Food & Drink
- **Age rating**: 4+ (no objectionable content; note nightlife/bar listings — answer "Infrequent/Mild Alcohol, Tobacco, or Drug Use or References: None" — venues are listed, not depicted)

## Promotional text (170 char — editable anytime without review)
- ES: `Descubre lo mejor de Cartagena: restaurantes y hoteles verificados, eventos de hoy, tu concierge con IA y un pasaporte de sellos que ganas caminando la ciudad.`
- EN: `Discover the best of Cartagena: verified restaurants & hotels, today's events, an AI concierge, and a passport of stamps you earn walking the city.`

## Keywords (100 char, comma-separated, no spaces)
`cartagena,colombia,turismo,restaurantes,eventos,hoteles,concierge,viaje,guia,playas,mapa,getsemani`

## Description

### Español
```
Amo Cartagena es tu guía y concierge de la ciudad amurallada — hecha para vivir Cartagena como un local, no como un turista.

LUGARES VERIFICADOS
Más de 850 restaurantes, hoteles, bares, beach clubs y experiencias certificados por Amo Cartagena. Precios reales, ubicaciones verificadas, sin sorpresas.

TU CONCIERGE CON IA
Pregúntale a Luna qué hacer hoy, dónde cenar esta noche o cómo llegar caminando. Respuestas al instante, en tu idioma, solo con lugares que valen la pena.

EVENTOS DE HOY
Conciertos, planes y experiencias que están pasando ahora mismo en la ciudad — con horarios, precios y cómo reservar.

MAPA + CAMINAR
Un mapa real de Cartagena con rutas a pie por el Centro Histórico y Getsemaní. Camina la ciudad y descubre cada esquina.

TU PASAPORTE DE CARTAGENA
Gana sellos visitando lugares emblemáticos, colecciona sabores y plazas, y sube de nivel. Cada sello se gana caminando la ciudad.

TASA PORTUARIA Y RESERVAS
Paga la tasa oficial de las Islas del Rosario y coordina reservas con los mejores lugares — todo desde la app.

Amo Cartagena. Toda Cartagena en un solo lugar.
```

### English
```
Amo Cartagena is your guide and concierge to the walled city — built to experience Cartagena like a local, not a tourist.

VERIFIED PLACES
850+ restaurants, hotels, bars, beach clubs and experiences certified by Amo Cartagena. Real prices, verified locations, no surprises.

YOUR AI CONCIERGE
Ask Luna what to do today, where to have dinner tonight, or how to walk there. Instant answers, in your language, only places worth your time.

TODAY'S EVENTS
Concerts, plans and experiences happening right now in the city — with times, prices and how to book.

MAP + WALK
A real map of Cartagena with walking routes through the Centro Histórico and Getsemaní. Walk the city and discover every corner.

YOUR CARTAGENA PASSPORT
Earn stamps by visiting landmarks, collect flavors and plazas, and level up. Every stamp is earned walking the city.

PORT TAX & RESERVATIONS
Pay the official Rosario Islands port tax and coordinate reservations with the best spots — all from the app.

Amo Cartagena. All of Cartagena in one place.
```

## URLs
- **Support URL**: https://www.amocartagena.co/ayuda
- **Marketing URL**: https://www.amocartagena.co
- **Privacy Policy URL**: https://www.amocartagena.co/privacidad

## App Review Information
- **Sign-in required**: The core browse experience is open (guest), but to test signup: use the email OTP flow. Provide the reviewer a demo note:
  > Login is by email one-time code. Enter any email → a 6-digit code is sent. For review, use the demo path: [set DEMO_LOGIN_ENABLED and give a code], OR provide a pre-made account. Google sign-in is web-only and intentionally not shown on iOS; email is the native login.
- **Contact**: Phil McGill · phil@machinemindconsulting.com · [phone]
- **Notes**: Payments (City Pass) show "Próximamente" while the Colombian gateway (Wompi) is disabled — no in-app purchase of digital goods; all paid items are real-world services (port tax, reservations).

---

## App Privacy questionnaire (Data collection)

Set **"Data Not Used to Track You"** (no cross-app tracking, no ad SDKs, no IDFA).

| Data type | Collected? | Linked to user? | Tracking? | Purpose |
|---|---|---|---|---|
| Email address | Yes | Yes | No | App Functionality (account) |
| Name | Yes | Yes | No | App Functionality |
| Phone number | Yes (optional) | Yes | No | App Functionality (reservations) |
| Precise Location | Yes | Yes | No | App Functionality (nearby places), Personalization |
| Coarse Location | Yes | Yes | No | Analytics (zone) |
| Photos | Yes (partner uploads only) | Yes | No | App Functionality |
| Purchase history | Yes (when payments live) | Yes | No | App Functionality |
| Product interaction / Usage | Yes | Yes (when signed in) | No | Analytics, App Functionality |
| Other user content (AI chat text) | Yes | Yes | No | App Functionality (concierge) |
| Crash / diagnostic | Yes | No | No | App Functionality |

- **Payment info**: card data is entered on the payment processor's hosted page — never touches the app or our servers. Do NOT declare card number.
- **Third parties**: AI chat text is sent to Anthropic (concierge). Disclosed in the privacy policy.
- **ATT**: not required — no `NSUserTrackingUsageDescription`, no tracking.

---

## Encryption / Export compliance
- `ITSAppUsesNonExemptEncryption = false` (set in app.json infoPlist) → auto-answered "no", no annual documentation, no export upload.

---

## ✅ ALREADY DONE FOR YOU (via App Store Connect API)
- **Metadata** pushed: name, subtitle (ES + EN), full description (ES + EN), keywords, promo text, support/marketing URLs.
- **Categories**: Travel (primary), Food & Drink (secondary).
- **Build 7 attached** to version 1.0.
- **6 screenshots uploaded + processed** (6.9" / 1320×2868, state COMPLETE), in conversion order: Home (853 lugares) → Explore → Map (869 pins) → Partner detail → Concierge → Onboarding.

## ⏳ YOUR 4 STEPS (App Store Connect UI — ~5 min total, these are your attestations)
1. **Age rating** (Rating tab → Edit, ~90 sec): answer every content question **None**; "Made for Kids" **No** → yields **4+**. One judgment call: the app lists bars/nightlife venues — Apple's "Alcohol/Tobacco/Drug references" question. A directory listing = "None" (4+) is defensible; if you prefer conservative, "Infrequent/Mild" → 12+. Your call.
2. **App Privacy** (App Privacy → Get Started, ~2 min): answer from the table above. Set **"Data Not Used to Track You."** Accurate — the audit confirmed no tracking SDKs.
3. **App Review Information**: contact name = Phil McGill, email = **phil@machinemindconsulting.com**, **+ your phone number** (required — I don't have it). Add the demo note from the "App Review Information" section above.
4. **Submit for Review** — click it. (You can cancel anytime before Apple starts review.)

## 🔧 SUPPORT EMAIL — do this before or right after submit (Thing 1)
The in-app privacy/terms pages show `soporte@amocartagena.co` and `privacidad@amocartagena.co`. These **bounce today** (no MX). For a trust app, fix before real users arrive:
- **Domain is on GoDaddy** (nameservers `domaincontrol.com`). Fastest path:
  - GoDaddy → **My Products** → `amocartagena.co` → **Email** → **Email Forwarding** → forward `soporte@` and `privacidad@` → your real inbox (e.g. phil@machinemindconsulting.com). GoDaddy adds the MX automatically. ~5 min.
  - Or move DNS to **Cloudflare** and use **Email Routing** (free, more robust) — ~20 min.
- Until then: the **App Review contact** (step 3) uses phil@machinemindconsulting.com so nothing bounces for the reviewer. Just don't leave the public `.co` support line dead once tourists are in.

## 🚫 KEEP PAYMENTS OFF (Thing 2)
City Pass stays in the honest **"Próximamente"** state through review AND after approval. Getting into the store ≠ green light to take money. The pentest, passcode rotation, and Franck ownership answer remain the gate before Wompi flips on. The coming-soon state is already built — let it do its job.
