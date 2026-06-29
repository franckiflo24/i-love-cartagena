# AMO Cartagena — Auth Build Plan
**Owner:** Phil (MachineMind)
**Status:** Waiting on Franck for DNS records

---

## BEFORE Franck (Phil can do now)

### 1. Create Resend account
- Go to resend.com → Sign up
- Add domain: `amocartagena.co`
- Copy the 3 DNS records Resend generates
- Send exact records to Franck (update FRANCK_DNS_SETUP.md with real values)

### 2. Fix the signup code gate bug (server.py:224)
```python
# BEFORE (broken — empty string bypasses):
if expected_code and body.signup_code:

# AFTER (correct):
if expected_code:
```

### 3. Fix PUT /profile leak (server.py:~1368)
```python
# BEFORE (leaks favorites, my_week):
updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
return updated

# AFTER (use same allowlist as GET):
safe_fields = ("user_id", "email", "name", "picture", "phone", "provider",
               "nationality", "age_group", "instagram", "interests",
               "profile_completed", "created_at")
updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
return {k: updated.get(k) for k in safe_fields if k in updated}
```

### 4. Set up Google Cloud OAuth (if Phil owns the project)
- Console: console.cloud.google.com
- Project with client ID: `1071876257240-mfvok0o4ihcatnn5l1tialtkeol0t2lf`
- Authorized origins: `https://www.amocartagena.co`, `https://amocartagena.co`
- Authorized redirect URIs: same

---

## AFTER Franck adds DNS (Phil builds)

### 5. Verify domain in Resend + get API key
- Resend dashboard → Domains → Verify
- Copy API key
- `cd backend && npx vercel env add RESEND_API_KEY production` → paste key

### 6. Build email service (backend)
New file: `backend/email_service.py`
- `send_verification_email(to, code)` — 6-digit code, "Verifica tu email" subject
- `send_welcome_email(to, name)` — branded welcome from hola@amocartagena.co
- `send_booking_confirmation(to, booking)` — reservation/ticket receipts

### 7. Build real email auth flow
Replace the email stub in `/auth/demo-login` (provider: email_local):
```
POST /auth/email/start  → { email } → send 6-digit code → return { pending: true }
POST /auth/email/verify → { email, code } → verify code → create user + session
```

### 8. Build real WhatsApp OTP flow
Use the existing Meta WABA (910562371704666) to send OTP:
```
POST /auth/whatsapp/start  → { phone } → send OTP via WhatsApp template → return { pending: true }
POST /auth/whatsapp/verify → { phone, code } → verify code → create user + session
```

### 9. Wire onboarding after first login
```
login success → check profile_completed
  false → router.push('/complete-profile')
  true  → router.push('/(tabs)')
```
The `/complete-profile` page already exists — just wire the redirect.

### 10. New env vars needed in Vercel (backend)
| Var | Value | Notes |
|-----|-------|-------|
| RESEND_API_KEY | (from Resend dashboard) | After DNS verified |
| RESEND_FROM_EMAIL | hola@amocartagena.co | Or noreply@amocartagena.co |

---

## USER SCHEMA (target state)

```json
{
  "user_id": "user_xxxxxxxxxxxx",
  "auth_method": "google | whatsapp | email",
  "auth_id": "google_sub | +573001234567 | user@email.com",
  "name": "string",
  "email": "string | null",
  "email_verified": false,
  "phone": "string | null",
  "phone_verified": false,
  "language": "es",
  "profile_completed": false,
  "profile": {
    "user_type": "visitor | local",
    "visit_start": "date | null",
    "visit_end": "date | null",
    "party": "solo | couple | family | friends | null",
    "interests": ["gastronomia", "nightlife", "..."],
    "staying_neighborhood": "string | null"
  },
  "created_at": "ts",
  "onboarded_at": "ts | null"
}
```

---

## PRIORITY ORDER

| # | Task | Blocker? | Time |
|---|------|----------|------|
| 1 | Fix signup code gate + PUT leak | No blocker | 10 min |
| 2 | Create Resend account + send DNS to Franck | No blocker | 10 min |
| 3 | Franck adds DNS records | **BLOCKED on Franck** | 5 min his side |
| 4 | Verify domain + set RESEND_API_KEY | Blocked on #3 | 5 min |
| 5 | Build email service | Blocked on #4 | 30 min |
| 6 | Build email verify flow | Blocked on #5 | 45 min |
| 7 | Build WhatsApp OTP flow | No blocker (WABA exists) | 45 min |
| 8 | Wire onboarding redirect | No blocker | 15 min |
| 9 | Test all 3 auth methods E2E | Blocked on #6, #7 | 30 min |
