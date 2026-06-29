# AMO Cartagena — DNS Setup for Email & Auth
**From:** Phil (MachineMind)
**To:** Franck (domain owner)
**Date:** June 29, 2026
**Domain:** amocartagena.co (GoDaddy DNS — ns37/ns38.domaincontrol.com)

---

## What we're setting up

The app needs to send transactional emails (login verification, welcome messages, booking confirmations) from `@amocartagena.co`. We're using **Resend** (resend.com) as the email provider — it's fast, reliable, and takes 5 minutes to configure.

Once these DNS records are added, I handle everything else on the code side.

---

## STEP 1 — Resend Account (Phil does this)

I'll create the Resend account and add the domain `amocartagena.co`. Resend will generate 3 DNS records that you need to add in GoDaddy.

**I'll send you the exact records once generated.** They will look like this:

---

## STEP 2 — DNS Records (Franck adds in GoDaddy)

Log into GoDaddy → **DNS Management** for `amocartagena.co` → **Add Records**

### Record 1: SPF (allows Resend to send email as @amocartagena.co)
| Type | Host | Value | TTL |
|------|------|-------|-----|
| TXT | @ | `v=spf1 include:send.resend.com ~all` | 1 Hour |

### Record 2: DKIM (email authentication — Resend provides this)
| Type | Host | Value | TTL |
|------|------|-------|-----|
| TXT | `resend._domainkey` | *(I'll send the exact value — it's a long string)* | 1 Hour |

### Record 3: MX Record (enables receiving email at amocartagena.co — optional but recommended)
| Type | Host | Priority | Value | TTL |
|------|------|----------|-------|-----|
| MX | @ | 10 | `feedback-smtp.us-east-1.amazonses.com` | 1 Hour |

### Record 4: DMARC (email security policy)
| Type | Host | Value | TTL |
|------|------|-------|-----|
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@amocartagena.co` | 1 Hour |

---

## STEP 3 — Google OAuth Update (Franck does this if he owns the Google Cloud project)

The Google Sign-In button needs authorized redirect URIs. In **Google Cloud Console** → **APIs & Services** → **Credentials** → **OAuth 2.0 Client ID** (`1071876257240-mfvok0o4ihcatnn5l1tialtkeol0t2lf`):

**Authorized JavaScript origins:**
```
https://www.amocartagena.co
https://amocartagena.co
```

**Authorized redirect URIs:**
```
https://www.amocartagena.co
https://amocartagena.co
```

If Phil owns this Google Cloud project, ignore this step — Phil will do it.

---

## STEP 4 — Verification (Phil does this)

Once the DNS records propagate (usually 5-30 minutes), I'll:
1. Verify the domain in Resend
2. Set the `RESEND_API_KEY` env var in Vercel
3. Build the email verification + welcome email flows
4. Wire up the real auth (OTP for WhatsApp, email confirm for email signup)

---

## WHAT THIS UNLOCKS

| Feature | Before | After |
|---------|--------|-------|
| Email login | Stub — anyone types any email, instant access | Real — email verification link sent, confirmed before access |
| WhatsApp login | Stub — anyone types any number | Real — OTP code sent via WhatsApp API (already have WABA) |
| Welcome email | None | Branded email from hola@amocartagena.co |
| Booking confirmations | None | Email receipt to user + notification to partner |
| Password reset | None | Reset link via email |
| From address | N/A | `hola@amocartagena.co` or `noreply@amocartagena.co` |

---

## CURRENT DNS STATE (for reference)

| Record | Current Value |
|--------|---------------|
| NS | ns37.domaincontrol.com, ns38.domaincontrol.com (GoDaddy) |
| A | 216.150.1.1 |
| CNAME (www) | aa85cc37b75689b0.vercel-dns-016.com |
| MX | *(none — no email configured)* |
| TXT | *(none — no SPF/DKIM)* |

This is a clean slate. Adding the records above won't break anything existing.

---

## TIMELINE

1. **Franck adds DNS records** — 5 min in GoDaddy
2. **DNS propagates** — 5-30 min
3. **Phil verifies + builds** — same day
4. **Auth goes live** — real verified logins shipping within hours of DNS confirmation

---

**Questions?** WhatsApp me. Once you've added the records, just text "DNS done" and I'll verify + build immediately.
