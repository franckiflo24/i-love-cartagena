# App Privacy questionnaire — exact click-by-click (AMO Cartagena)

## ⚠️ CRITICAL — your CURRENTLY PUBLISHED App Privacy is WRONG. Fix it before submitting.

The version published 20 min ago is a **select-all mistake**. It currently declares (all FALSE per the audit):
- **"Advertising Data"** collected, and **Name / Email / Phone used for "Third-Party Advertising" and "Developer's Advertising or Marketing."** AMO has **zero ad SDKs and does no advertising** — this is false, contradicts your new privacy policy, and would flag your app as **tracking users** (forcing an ATT prompt you don't have → likely rejection).
- Everything marked **"Data Not Linked to You"** — but email/name/phone/location/user-ID **are** linked to the account.

**I set the Privacy Policy URL for you (done). But the data declaration is a legal attestation you must correct yourself** — I won't rewrite a live legal filing via automation. Redo it as below (~4 min). The fix, precisely:

**Step A — Data Types → Edit (the grid):**
- **UNCHECK** (remove these false ones): **Advertising Data**, **Other Usage Data**, **Other Diagnostic Data**, **Performance Data**, **Device ID**.
- **Keep checked**: Name, Email Address, Phone Number, Precise Location, User ID, Crash Data.
- **CHECK (add)**: **Coarse Location**, **Photos or Videos**, **Other User Content**, **Product Interaction**.
- (Fastest clean option if it's a mess: uncheck ALL, Publish, then re-open and add only the 10 correct types fresh so no wrong purposes carry over.)

**Step B — for EVERY data type, set purposes to ONLY the ones below.** Delete every **Third-Party Advertising** and **Developer's Advertising or Marketing** checkbox — none apply.

**Step C — Linkage: "Data Linked to You" for all EXCEPT Crash Data** (which is Not Linked). Your published version has this backwards.

**Step D — Tracking: No, for every type.** The summary must read **"Data Not Used to Track You."**

The exact per-type answers are below. ⬇️

---


App Store Connect → **Amo Cartagena** → left sidebar **App Privacy** → **Get Started**.

**Privacy Policy URL** (top of the page): paste `https://www.amocartagena.co/privacy`

**Q: "Do you or your third-party partners collect data from this app?"**
→ Select **"Yes, we collect data from this app."** → **Publish**/continue to the data-type grid.

You'll see a grid of data categories. **Check ONLY the 10 items below.** For each, a panel opens asking (a) purposes, (b) linked to identity, (c) used to track. Answer exactly as shown. **Every "Used to track you?" = No** — that's what produces "Data Not Used to Track You."

---

### CONTACT INFO
**☑ Email Address**
- Purpose: **App Functionality**
- Linked to identity: **Yes**
- Used for tracking: **No**

**☑ Name**
- Purpose: **App Functionality** · Linked: **Yes** · Tracking: **No**

**☑ Phone Number**
- Purpose: **App Functionality** · Linked: **Yes** · Tracking: **No**

### LOCATION
**☑ Precise Location**
- Purposes: **App Functionality** + **Product Personalization**
- Linked: **Yes** · Tracking: **No**

**☑ Coarse Location**
- Purpose: **Analytics** · Linked: **Yes** · Tracking: **No**

### USER CONTENT
**☑ Photos or Videos** (partners uploading venue photos)
- Purpose: **App Functionality** · Linked: **Yes** · Tracking: **No**

**☑ Other User Content** (text typed to the Luna / Amo AI concierge)
- Purpose: **App Functionality** · Linked: **Yes** · Tracking: **No**

### IDENTIFIERS
**☑ User ID**
- Purpose: **App Functionality** · Linked: **Yes** · Tracking: **No**

### USAGE DATA
**☑ Product Interaction** (searches, taps, screens viewed)
- Purposes: **Analytics** + **App Functionality**
- Linked: **Yes** · Tracking: **No**

### DIAGNOSTICS
**☑ Crash Data**
- Purpose: **App Functionality**
- Linked: **No** (anonymous crash logs) · Tracking: **No**

---

## Do NOT check these (important — over-declaring the wrong thing here is inaccurate)
- **Financial Info → Payment Info / Credit Info**: NOT collected. Card data is entered on Wompi's hosted checkout page and never touches AMO. Leave unchecked.
- **Advertising Data / Third-Party Advertising**: none. Leave unchecked.
- **Browsing History, Search History (as separate categories)**: covered under Product Interaction; don't double-declare.
- **Contacts, Health, Sensitive Info, Audio Data**: none.

## Two conditional items
- **Purchases → Purchase History**: payments are OFF ("Próximamente"), so no purchase data is collected today — leave **unchecked** for now. When you enable Wompi, come back and add it (App Functionality · Linked Yes · Tracking No).
- **Identifiers → Device ID** (push notification token): optional. If ASC prompts about push, you may add Device ID (App Functionality · Linked Yes · Tracking No). Not required; omitting is fine since it's only used to deliver notifications.

## Finish
- Review the summary — it should read **"Data Not Used to Track You"** at the top (no ATT prompt needed; the audit confirmed zero tracking SDKs).
- Click **Publish**.

That's the whole questionnaire. ~2 minutes.
