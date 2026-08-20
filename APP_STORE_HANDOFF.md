# AMO Cartagena — App Store Submission Handoff

Everything below is a step **only Phil can do** (Apple Developer / App Store Connect
account access, real device testing, business decisions). No credentials or IDs are
invented anywhere in this doc — every placeholder is described by where to find the
real value, not filled with a guess.

Repo: `/Users/showowt/i-love-cartagena` · Expo project root: `frontend/`

---

## 0. Status summary

| # | Item | State | Blocks |
|---|------|-------|--------|
| 1 | Apple button lying about SIWA | **FIXED today** — see §1 below | — |
| 2 | `app.json` EAS project ID | Placeholder (`REPLACE_WITH_EAS_PROJECT_ID`) | Any `eas build` |
| 3 | `eas.json` Apple Team ID | Placeholder | `eas submit` |
| 4 | `eas.json` App Store Connect App ID | Placeholder | `eas submit` |
| 5 | Real Sign in with Apple | Not implemented (intentionally, see §1) | Guideline 4.8 |
| 6 | City Pass "Activar" → dead end | **Confirmed live in prod right now** (see §5) | Guideline 2.1 |
| 7 | Screenshots, privacy questionnaire, demo account | Not started | Submission checklist |

---

## 1. What changed today (context, not a to-do)

`frontend/app/login.tsx` had a button with the Apple logo whose `onPress` called the
same `login()` used by "Continue with Google" (`frontend/src/context/AuthContext.tsx`
line 280) — which is 100% Google web OAuth (`window.location.href =
buildGoogleAuthUrl()`, gated to `Platform.OS === 'web'`). On a native iOS build it
silently did nothing; if it ever ran on web it would sign the user in with Google
while showing an Apple mark. Offering third-party social login (Google) without also
offering Sign in with Apple, on top of a mislabeled button, is a near-certain
**Guideline 4.8** rejection.

Fix applied: the button is now gated behind a single flag,
`APPLE_SIGNIN_ENABLED = false`, declared at `frontend/app/login.tsx` line 32, with the
render condition at line 298 (`{APPLE_SIGNIN_ENABLED && Platform.OS === 'ios' && (...)}`).
While the flag is `false` the button renders nowhere — not on web, not on native. It is
not wired to any handler that does something misleading. Google sign-in, email
signup/verify, and every other login path are untouched. `npx tsc --noEmit` passes
clean.

Turn it back on only after real SIWA is built end-to-end — see §3.

---

## 2. `app.json` — EAS project ID

**File:** `frontend/app.json` line 84 — `"projectId": "REPLACE_WITH_EAS_PROJECT_ID"`

```bash
cd /Users/showowt/i-love-cartagena/frontend
npx eas login                 # log into your Expo/EAS account if not already
npx eas init                  # links this repo to an EAS project
```

`eas init` will offer to create a project named after `app.json`'s `slug`
(`amo-cartagena`) and, on current EAS CLI versions, writes the resulting project ID
directly into `app.json` → `expo.extra.eas.projectId` for you. After it runs, open
`frontend/app.json` and confirm line 84 no longer says `REPLACE_WITH_EAS_PROJECT_ID`.
If the CLI prints the ID but doesn't write it, paste it in by hand at that exact key.

---

## 3. `eas.json` — submit config (Apple Team ID + ASC App ID)

**File:** `frontend/eas.json` lines 43–44:
```json
"appleTeamId": "REPLACE_WITH_APPLE_TEAM_ID",
"ascAppId": "REPLACE_WITH_APP_STORE_CONNECT_APP_ID"
```

Prerequisite: an active Apple Developer Program membership ($99/yr) for the account
that will own this app, if not already enrolled.

**Apple Team ID** (10-character alphanumeric, e.g. `AB12CD34EF`):
1. Go to `developer.apple.com/account`.
2. Click **Membership Details** in the sidebar.
3. Copy the **Team ID** field into `eas.json` line 43.
   (Also visible via `npx eas credentials` → iOS → once your Apple account is linked to EAS.)

**App Store Connect App ID (`ascAppId`)** — a numeric ID, *not* the bundle identifier:
1. First register the App ID `com.amocartagena.app` (must match `frontend/app.json`
   lines 13 and 31 exactly) at `developer.apple.com/account/resources/identifiers`
   if it isn't already registered.
2. In **App Store Connect** → **My Apps** → **+** → **New App**, select platform iOS,
   pick Bundle ID `com.amocartagena.app` from the dropdown, name it, primary language,
   SKU (any internal string, e.g. `amocartagena-ios-01`).
3. Once created, open the app → **App Information** (sidebar) → under **General
   Information** the **Apple ID** field is the numeric value you need (also visible in
   the ASC URL: `appstoreconnect.apple.com/apps/<this number>/...`).
4. Paste it into `eas.json` line 44.

---

## 4. Real Sign in with Apple (the actual feature, not the placeholder)

Guideline 4.8: **if the app offers any third-party social login (it offers Google),
it must also offer Sign in with Apple.** This is not optional once Google sign-in
ships to the App Store. Do this before submitting, or drop Google sign-in from the
iOS binary (not recommended — worse UX).

Current backend auth routes (`backend/server.py`) for reference — there is **no**
`/auth/apple` yet:
```
POST   /auth/google          (server.py:132)
POST   /auth/signup          (server.py:308)   — email + OTP code
POST   /auth/verify          (server.py:348)   — email + OTP code
GET    /auth/me              (server.py:3471)
POST   /auth/logout          (server.py:3752)
DELETE /auth/delete-account  (server.py:3774)
```

**Steps, in order:**

1. Install the package:
   ```bash
   cd /Users/showowt/i-love-cartagena/frontend
   npx expo install expo-apple-authentication
   ```
2. In `frontend/app.json`, add to the `ios` block:
   ```json
   "usesAppleSignIn": true
   ```
   This is what adds the `com.apple.developer.applesignin` entitlement. The package
   itself needs no entry in the `plugins` array on current Expo SDK — if a build
   later complains about a missing entitlement, add `"expo-apple-authentication"` to
   `plugins` explicitly as a fallback.
3. In the Apple Developer portal → **Identifiers** → `com.amocartagena.app` → enable
   the **Sign In with Apple** capability checkbox → Save. (EAS-managed credentials
   usually flip this automatically on the next `eas build`, but verify it's checked.)
4. **Frontend handler** — replace the current do-nothing placeholder at
   `frontend/app/login.tsx` (the `onPress={() => {}}` around line 301) with a real
   handler, mirroring the existing `loginWithToken()` flow already used by
   `handleVerifyCode()` in the same file:
   ```ts
   import * as AppleAuthentication from 'expo-apple-authentication';

   const handleAppleSignIn = async () => {
     try {
       const credential = await AppleAuthentication.signInAsync({
         requestedScopes: [
           AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
           AppleAuthentication.AppleAuthenticationScope.EMAIL,
         ],
       });
       const res = await api.post('/auth/apple', {
         identity_token: credential.identityToken,
         // Apple only ever sends these on the FIRST authorization for a given user —
         // capture and forward them so the backend can store them on user creation.
         full_name: credential.fullName,
         email: credential.email,
       });
       if (res.session_token && res.user) {
         await loginWithToken(res.session_token, res.user);
       }
     } catch (e: any) {
       if (e.code === 'ERR_REQUEST_CANCELED') return; // user dismissed — not an error
       console.error('[Login] Apple sign-in error', e);
       setLoginError('No se pudo iniciar sesión con Apple. Intenta de nuevo.');
     }
   };
   ```
5. **Backend task (flag for whoever picks this up — it's a real gap, not yet built):**
   add `POST /auth/apple` in `backend/server.py`, parallel to `/auth/google` at line
   132. It must verify the Apple `identity_token` (ES256 JWT) against Apple's public
   keys at `https://appleid.apple.com/auth/keys`, checking `aud == com.amocartagena.app`
   and `iss == https://appleid.apple.com`, then upsert a user keyed on Apple's stable
   `sub` claim (their opaque per-app user identifier — email/name are only sent once
   and must be persisted on first sign-in, exactly like Apple's docs warn), and return
   the same `{user, session_token}` shape `/auth/google` returns so the frontend needs
   no new session plumbing.
6. Flip `APPLE_SIGNIN_ENABLED = true` at `frontend/app/login.tsx` line 32 once steps
   4–5 are built and working.
7. **Test on a real iOS device or TestFlight build** — Sign in with Apple does not
   fully work in Expo Go; it needs a native/dev-client or EAS build. This is exactly
   the "testing you can't do here" gap — do not enable the flag without this step.

---

## 5. City Pass "Activar" → dead end (Guideline 2.1, confirmed live right now)

I checked the live production payments config (read-only, public endpoint, no
credentials involved):
```
$ curl https://backend-mu-one-74.vercel.app/api/payments/config
{"enabled":false,"env":"sandbox","public_key":"","commission_pct":3.0}
```
Wompi is **not enabled in production today**. Concretely, this means: a user (or an
Apple reviewer) opens City Pass, sees three paid plans with real prices and benefit
lists, taps **Activar**, and `frontend/app/(tabs)/citypass.tsx` line 64–68 calls
`checkWompiEnabled()` (`frontend/src/lib/wompi.ts` line 100), gets `enabled: false`,
and shows an alert via `notConfiguredAlert()` (`wompi.ts` line 109) — an honestly
worded "Próximamente" message, but the surrounding UI (priced plan cards + an
"Activar" button) presents as a working purchase flow that cannot complete. Apple
routinely flags exactly this pattern under 2.1 (placeholder/non-functional features
presented as live).

City Pass is **already hidden from the tab bar** (`frontend/app/(tabs)/_layout.tsx`
line 59: `<Tabs.Screen name="citypass" options={{ href: null }} />`), but it's still
reachable from several other places in the app:
```
frontend/app/search.tsx               lines 83, 592, 643, 659, 773
frontend/app/payments/return.tsx      line 93
frontend/app/(tabs)/bookings.tsx      line 487
frontend/app/(tabs)/perfil.tsx        line 478  (Settings row: "City Pass")
frontend/src/components/AssistantFab.tsx   lines 652, 701  (Luna/concierge nav)
```

**Two options — pick whichever fits your timeline. Neither is built; both are your call:**

- **Option A — hide it completely for the initial binary.** Remove or gate the 5 file
  entry points above so City Pass is unreachable from anywhere in the iOS binary this
  round (the tab is already `href: null`, so closing these closes the loop). Lowest
  review risk, but touches 5 files.
- **Option B — keep it reachable, make it honest before any tap.** In
  `citypass.tsx`, when `!wompi.enabled`, replace the priced plan cards' "Activar"
  buttons with a visible "Próximamente" badge/disabled state up front, instead of
  only revealing that after a tap. One file, smaller change, but City Pass still ships
  visibly in v1.

Either way — **enable Wompi in production before or shortly after this decision**, so
the feature isn't dark indefinitely; check `WOMPI_PUBLIC_KEY` / related env vars on
the `backend` Vercel project once ready to go live, and re-run the curl above to
confirm `enabled: true`.

---

## 6. Permission strings (confirmed present)

`frontend/app.json` lines 15–28, all present and matched to real app features:

| Key | Copy | Used for |
|---|---|---|
| `NSLocationWhenInUseUsageDescription` | "Te mostramos eventos y partners cerca de ti" | Nearby events/partners, map |
| `NSCameraUsageDescription` | "Sube fotos de tus eventos como partner" | Partner photo upload |
| `NSPhotoLibraryUsageDescription` | "Adjunta imágenes para tus eventos" | Partner photo upload |
| `NSPhotoLibraryAddUsageDescription` | "Guarda tu boarding pass y entradas" | Saving City Pass/tickets |
| `NSUserNotificationsUsageDescription` | "Recibe confirmación de reservas y recordatorios" | Booking confirmations |
| `ITSAppUsesNonExemptEncryption` | `false` | Skips the annual export-compliance doc (standard HTTPS/TLS only — confirm this is still accurate before submitting if any custom crypto gets added later) |
| `LSApplicationQueriesSchemes` | `whatsapp`, `instagram`, `tel`, `mailto` | Deep-linking out to WhatsApp/Instagram/phone/email |

Note: unlike Location/Camera/Photos, iOS does **not** render
`NSUserNotificationsUsageDescription` as custom text in the system push-permission
dialog (that dialog's copy is fixed by iOS). Harmless to keep, just don't expect it to
change what the user sees.

---

## 7. Pre-submit checklist

- [ ] **`app.json` EAS project ID** set (§2)
- [ ] **`eas.json` appleTeamId + ascAppId** set (§3)
- [ ] **Sign in with Apple** live end-to-end and tested on-device, `APPLE_SIGNIN_ENABLED = true` (§4) — or Google sign-in removed from the iOS binary if you decide not to ship SIWA this round
- [ ] **City Pass decision made** — Option A or B from §5, and Wompi's real prod state matches what the UI implies
- [ ] **iPad support decision** — `frontend/app.json` line 12 has `"supportsTablet": true`. If the app hasn't actually been designed/tested for iPad layouts, App Store Connect will still require iPad-size screenshots (12.9"/13" class) because of this flag. Either prepare iPad screenshots, or set `supportsTablet: false` before building (not something I changed — your call, one line).
- [ ] **Screenshots** — iPhone 6.7" class, 1290×2796, 3–10 images, no device-frame required but common
- [ ] **Privacy Policy URL** — already set (`frontend/app.json` line 86:
      `https://amocartagena.co/privacidad`, and it's a real live in-app route at
      `frontend/app/privacidad.tsx`) — enter the same URL in App Store Connect → App
      Information → Privacy Policy URL
- [ ] **App Privacy questionnaire** (ASC → App Privacy) — answer based on what's
      actually collected: email, name, phone, precise/coarse location (when-in-use),
      photos (camera/library uploads for partner accounts). Fill this yourself in the
      portal — it needs to match reality, not a template.
- [ ] **Account deletion in-app** — already implemented and working:
      `frontend/app/(tabs)/perfil.tsx` line 533 calls `DELETE /auth/delete-account`,
      handled by `backend/server.py` line 3774. Satisfies Guideline 5.1.1(v).
- [ ] **Age rating questionnaire** — the app's content includes bars, cocktail bars,
      and nightlife/nightclub venues as first-class categories (see
      `frontend/src/constants/collections.ts` — `cocteles`, `rumba`, `nightlife`
      tags). Answer the "Alcohol, Tobacco, or Drug Use or References" question
      honestly; expect the rating to land above 4+.
- [ ] **Demo account for reviewers** — the app has no username/password login (only
      Google OAuth and passwordless email+OTP, see §4's route list). Apple's demo
      account fields expect a static username/password, which this app can't produce
      directly. Recommended path: create one dedicated Gmail account you control
      (e.g. `amocartagena.appreview@gmail.com`) with a real password, and put *that*
      email + password in App Store Connect's "Sign-In Required" demo account
      fields — the reviewer taps "Continuar con Google" and authenticates entirely on
      Google's own consent screen, no OTP relay needed. If a reviewer specifically
      tries the email/OTP path instead, you'll need to be reachable to relay a code
      during the review window — flag this only if it becomes an issue.
- [ ] **Bundle ID consistency** — `com.amocartagena.app` must match exactly across
      `frontend/app.json` (lines 13 and 31), the registered Identifier in
      developer.apple.com, and the App Store Connect app record.

---

## 8. Execution order (once you have Apple Developer access open)

```bash
cd /Users/showowt/i-love-cartagena/frontend

# 1. EAS project
npx eas login
npx eas init                      # → fixes app.json line 84

# 2. Confirm/patch eas.json lines 43-44 by hand with Team ID + ASC App ID (§3)

# 3. (after §4 SIWA work + §5 City Pass decision are done, tsc-clean)
npx tsc --noEmit                  # must be zero errors before any build

# 4. First real build — do this yourself, not me
npx eas build --platform ios --profile production

# 5. Submit — only after the build succeeds and you've smoke-tested it
npx eas submit --platform ios
```

---

## What this handoff deliberately does NOT do

- No Apple Team ID, ASC App ID, or EAS project ID were invented anywhere — every
  placeholder above is still a placeholder in the actual `app.json`/`eas.json` files,
  with instructions for where you personally retrieve the real value.
- Sign in with Apple is not faked. No `expo-apple-authentication` install, no
  `/auth/apple` backend route, no plugin config was added — building it without a
  native device to test on is how you ship a broken auth path.
- No builds were run.
- Only `frontend/app/login.tsx` was edited, plus this file was created. Nothing else
  in the repo was touched.
