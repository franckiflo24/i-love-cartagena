# App Store Preflight — the gauntlet before every `eas submit`

**Doctrine: never let App Review be our QA.** Every rejection reason we've hit is
knowable *before* submitting. A rejection costs a full review cycle (days); this
checklist costs ~20 minutes. Run it every time.

**The three blind spots that have rejected us:**
1. **Apple reviews iPhone-only apps ON AN iPAD.** `supportsTablet: false` does not
   exempt you — they run it in the (shorter) iPad-compat window and require it to be
   usable. We test iPhone + web and never look at iPad. → *test on iPad.*
2. **Web passes where native fails.** `navigator.language` works on web but is empty
   on native; `<Image>` URLs resolve on web but not in the binary; etc. → *test the
   native binary, not the web export.*
3. **We test in Spanish.** The reviewer's device is in **English**. Permission
   prompts, formatting, and language-detection bugs only show in another language.
   → *test in a non-Spanish device language.*

---

## Tier 1 — automated (run first, ~1 min)

```bash
cd frontend && node scripts/appstore-preflight.mjs
```

Blocks (exit 1) on: TypeScript errors, un-localized permission strings, missing
privacy URL. Warns (needs your eyes) on: screens with no ScrollView / no
KeyboardAvoidingView, versioning config, Sign in with Apple, encryption flag.
**Zero errors is required. Every warning must be consciously cleared.**

---

## Tier 2 — the human pass on an iPad (the part that actually catches Guideline 4)

Build a simulator binary (the store IPA won't run on a simulator):
```bash
cd frontend && eas build -p ios --profile preview
```
Install it on an **iPad Air 11" (M3)** simulator, set the **device language to
English**, and walk the whole cold-start path:

- [ ] **Launch → login screen** — every "Continue" button visible without scrolling issues; with the keyboard up, the submit button is not covered.
- [ ] **Log in → onboarding** — the primary CTA (Empezar/Continue) is visible and the screen scrolls; nothing clipped top or bottom.
- [ ] **Grant a permission** (location) — the prompt text is **in English** (matches the app UI), not Spanish.
- [ ] **complete-profile / any form** — focus a field; the "Continuar" button rises above the keyboard.
- [ ] **Core tabs** — home, search, map, passport, profile all render and scroll; no content jammed off-screen or overlapping.
- [ ] **Rotate / split-view sanity** (if not portrait-locked) — no broken layout.
- [ ] Repeat the login → onboarding → permission beat with device language = **French** or **Portuguese** to confirm localization holds.

If anything is off here, fix it and rebuild **before** submitting — this is the exact
surface the reviewer uses.

---

## Guideline-mapped checklist (the classes that reject apps)

**Guideline 4.0 — Design / usability (our repeat offender)**
- [ ] Every screen with a primary action scrolls (`ScrollView`/`FlatList`); CTA never clips.
- [ ] Every screen with a `TextInput` is keyboard-aware (`KeyboardAvoidingView`).
- [ ] Verified on iPad, not just iPhone.

**Guideline 4.8 / 5.1.1 — permissions & privacy**
- [ ] Every permission string localized to **all** supported languages (`expo.locales` + `locales/*.json`); base = English.
- [ ] Each `NS*UsageDescription` is *specific* about why the data is used ("We use your location to show events near you", not "Location needed").
- [ ] Privacy policy URL live (`extra.privacyPolicyUrl`).
- [ ] App Privacy "nutrition label" in App Store Connect matches what the app actually collects.
- [ ] If any third-party social login (Google/Facebook) is exposed **on iOS**, **Sign in with Apple** is offered too (4.8). Email/phone OTP does not trigger this.

**Guideline 2.1 — completeness / performance**
- [ ] A working **demo account** (or demo mode) is provided in App Review notes, with steps.
- [ ] No broken links, no dead buttons, no placeholder/"lorem"/"coming soon" content.
- [ ] App degrades gracefully offline / on API failure (no white screens, no crashes).
- [ ] No debug/console UI, no test data visible.

**Guideline 2.3 — accurate metadata**
- [ ] Screenshots reflect the actual current app (all required device sizes present).
- [ ] No mention of other platforms ("also on Android"), no pricing in screenshots.

**Guideline 3.1.1 — payments** (matters for paid apps: Ballantir, Entrevoz, etc.)
- [ ] Digital goods/subscriptions sold **only** via Apple IAP — no external payment links or "buy on our website".
- [ ] If there is no IAP, no purchase UI is visible on iOS (hide it).

**Guideline 4.2 — minimum functionality**
- [ ] Not a thin web wrapper; native navigation, real features, offline value.

**Build / submission mechanics**
- [ ] `tsc --noEmit` clean.
- [ ] Fixes are **committed** — EAS builds the committed git HEAD, not your working tree.
- [ ] Build number is **higher than the latest build on App Store Connect**. A finished
      EAS build still fails submit (~18s, generic error) if the number already exists.
      Fix: rebuild (autoIncrement) or `eas build:version:set -p ios`.
- [ ] `ITSAppUsesNonExemptEncryption` set (avoids the export-compliance prompt).

---

## Submitting & swapping the build in App Store Connect

`eas submit` **only uploads the binary** — it does not attach the build or submit for
review. Those are App Store Connect actions.

To attach the new build to a **rejected** version (new "Draft Submission" UI):
1. App → Distribution → the version → **Draft Submissions** → hover the item → red **−** to remove it (version returns to *Developer Rejected*, editable).
2. On the version page, **Build** section → hover the build row → **−** to remove the old build → **Add Build** → pick the new build → **Done** → **Save**.
3. **Add for Review** → **Submit for Review** → answer export-compliance / IDFA / content-rights → **Submit**.
4. Status should read **Waiting for Review**.

Reply to the reviewer (Messages tab) stating specifically what each cited issue's fix was.

---

## Debugging a failed `eas submit`

The CLI shows only a generic "Something went wrong." The real reason is in the job run:
```bash
node -e '
const os=require("os"), s=require(os.homedir()+"/.expo/state.json").auth.sessionSecret;
const id="<submission-id-from-cli-output>";
fetch("https://api.expo.dev/graphql",{method:"POST",headers:{"Content-Type":"application/json","expo-session":s},
 body:JSON.stringify({query:`query($id:ID!){submissions{byId(submissionId:$id){status jobRun{errors{message}}}}}`,variables:{id}})})
 .then(r=>r.json()).then(j=>console.log(JSON.stringify(j.data,null,2)));'
```
