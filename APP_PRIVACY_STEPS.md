# App Privacy questionnaire — exact click-by-click (AMO Cartagena)

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
