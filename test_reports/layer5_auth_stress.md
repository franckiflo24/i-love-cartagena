# Layer 5 — Auth System Stress Test

**Target:** AMO Cartagena backend (`http://localhost:8000`) + frontend auth (`/frontend/src/context/AuthContext.tsx`, `/frontend/src/constants/api.ts`)
**Date run:** 2026-06-05
**Mongo:** `mongodb://localhost:27017` / db `amo_cartagena`
**Backend file:** `/Users/showowt/i-love-cartagena/backend/server.py`

**Totals:** 19 tests run · **1 FAIL** · **3 FINDINGs** · 15 PASS

---

## Result summary

| # | Test | Result |
|---|---|---|
| 1 | demo-login creates user + session row | PASS |
| 2 | `/auth/me` with `Authorization: Bearer` | PASS |
| 3 | `/auth/me` with `Cookie: session_token=` | PASS |
| 4 | `/auth/me` with no token | PASS |
| 5 | `/auth/me` with garbage `Bearer fake_xxx` | PASS |
| 6 | `/auth/me` with unknown well-formed `st_...` | PASS |
| 7 | `user_sessions.expires_at` = created + 30 days | PASS |
| 8 | Manually-expired session rejected, restored | PASS |
| 9 | TTL index or cleanup job for expired sessions | **FINDING** |
| 10 | Logout via Bearer invalidates session server-side | **FAIL** |
| 10b | Logout via Cookie invalidates session server-side | PASS |
| 11 | Logout row removed from `user_sessions` (Bearer path) | **FINDING** |
| 12 | Multi-session per user behaviour | **FINDING** |
| 13 | All concurrent tokens for same user work | PASS |
| 15 | userA can add favorite | PASS |
| 16 | userB cannot see userA's favorite | PASS |
| 17 | userB cannot see userA's reservation (real reservation created) | PASS |
| 18 | `user_id` query-param injection across endpoints | PASS |
| 19 | Frontend storage + Bearer + logout flow | PASS |

---

## Test details

### 1. demo-login creates user + session row
- **Expected:** 200, returns `session_token`; rows present in `user_sessions` and `users`.
- **Actual:** `POST /api/auth/demo-login {"email":"stress1@test.com","name":"S1"}` → 200, `session_token=st_…`, user_id `user_db6650827f70`. Both DB rows exist.
- **Result:** PASS

### 2. /auth/me with Authorization: Bearer
- **Expected:** 200 + user JSON.
- **Actual:** 200, `{"email":"stress1@test.com",…}`.
- **Result:** PASS

### 3. /auth/me with Cookie: session_token=
- **Expected:** 200 — cookie path also works (code at `server.py:140-144` checks cookie first).
- **Actual:** 200, same user object.
- **Result:** PASS

### 4. /auth/me with NO token
- **Expected:** 401.
- **Actual:** 401 `{"detail":"Not authenticated"}`.
- **Result:** PASS

### 5. /auth/me with garbage `Bearer fake_xxx`
- **Expected:** 401.
- **Actual:** 401 `{"detail":"Invalid session"}`.
- **Result:** PASS

### 6. /auth/me with unknown well-formed `st_…` token
- **Expected:** 401.
- **Actual:** 401 `{"detail":"Invalid session"}`.
- **Result:** PASS

### 7. user_sessions schema / 30-day expiry
- **Expected:** `expires_at` set 30 days out from `created_at`.
- **Actual:** `created=2026-06-05T08:48:04Z`, `expires=2026-07-05T08:48:04Z`, delta = exactly 30.0 days (code: `server.py:124` `timedelta(days=30)`).
- **Result:** PASS
- **Note:** the legacy/OAuth path at `server.py:72` uses **7 days** instead of 30 — inconsistency, but not a security failure.

### 8. Manually expire session, hit /auth/me, then restore
- **Expected:** 401 while expired, 200 after restoring.
- **Actual:** while `expires_at = yesterday` → `/auth/me` returned 401 `Session expired`. After restoring original `expires_at`, `/auth/me` returned 200. Restored value verified equal to original.
- **Result:** PASS

### 9. TTL index / cleanup of expired sessions  ⚠ FINDING
- **Expected:** TTL index on `user_sessions.expires_at` OR a scheduled cleanup deleting expired rows.
- **Actual:** `db.user_sessions.getIndexes()` returns only `_id_`. Nothing in `server.py` references `expireAfterSeconds`, no `delete_many({"expires_at": {"$lt": now}})`, no scheduler. Expired sessions accumulate **forever**.
- **Result:** FINDING (operational / unbounded growth; not a direct security hole because `get_current_user` checks `expires_at`).

### 10. Logout invalidates session server-side (Bearer path)  ❌ FAIL
- **Expected:** After `POST /auth/logout` with the Bearer token, the session row is deleted and a subsequent `/auth/me` with the same token returns 401.
- **Actual:** `POST /auth/logout` with `Authorization: Bearer <token>` returned 200 `{"ok": true}` BUT:
  - the row in `user_sessions` is **still present**,
  - `/auth/me` with the same token still returns **200**.
- **Root cause:** `server.py:1139-1145`:
  ```py
  async def logout(request: Request, response: Response):
      token = request.cookies.get("session_token")
      if token:
          await db.user_sessions.delete_one({"session_token": token})
      response.delete_cookie("session_token", path="/")
      return {"ok": True}
  ```
  Reads **only** the cookie. The Authorization header is ignored. Returns 200 either way, so the client thinks logout succeeded.
- **Impact:** The web frontend uses `credentials: 'same-origin'` (`api.ts:27`) for cross-origin backend and authenticates exclusively via Bearer token. **Calling `logout()` from the web frontend never invalidates the server session.** If a token is captured (XSS, shared device, exfiltrated log), it remains valid for the full 30 days.
- **Result:** FAIL

### 10b. Logout via Cookie correctly invalidates
- **Actual:** When `/auth/logout` is called with `Cookie: session_token=<t>`, the row is deleted and subsequent `/auth/me` returns 401.
- **Result:** PASS (proves the cookie path of logout works; Bearer path is what's broken)

### 11. Logout row removal — Bearer call  ⚠ FINDING
- **Expected:** Server should also accept the Bearer token for logout.
- **Actual:** Same as Test 10. The Bearer-only logout silently no-ops while returning 200.
- **Result:** FINDING (the broader security concern from Test 10; the test 10 FAIL captures the user-visible break).

### 12. Multiple demo-login calls for same email  ⚠ FINDING
- **Expected:** Document actual behaviour.
- **Actual:** 3 successive logins for the same email created **3 separate rows** in `user_sessions` (no revocation of prior). All 3 tokens valid simultaneously. This is "multi-session" / "multi-device" behaviour.
- **Result:** FINDING — combined with Test 9 (no TTL) and Test 10 (logout broken on Bearer), tokens leak quickly: every web logout leaves a working 30-day token in the DB; every additional sign-in adds another. There is **no upper bound** on the number of live sessions per user.

### 13. Concurrent tokens work in parallel
- **Expected:** All 3 tokens return 200 from `/auth/me`.
- **Actual:** All 3 returned 200.
- **Result:** PASS (consistent with #12 behaviour)

### 15. userA adds favorite
- **Expected:** 200 added.
- **Actual:** 200 `{"status":"added","item_id":"ptr_V001"}`.
- **Result:** PASS

### 16. userB cannot see userA's favorite
- **Expected:** `/favorites` and `/favorites/ids` for userB return empty.
- **Actual:** Both endpoints returned `[]` for userB. userA still sees her favorite in `/favorites/ids`. Endpoints filter strictly by `get_current_user().user_id` (server.py:1820-1862).
- **Result:** PASS

### 17. userB cannot see userA's reservation
- **Expected:** userA's reservation does not appear in userB's `/reservations/my`; direct GET by id as userB does not leak.
- **Actual:** Created a real reservation as userA (`res_f03cfa4dc931` against partner `ptr_003`). DB confirms `user_id` set to userA's id. As userB, `GET /reservations/my` returned `{"upcoming":[],"past":[],"total":0}`. `GET /reservations/{id}` as userB returned **404 "Reserva no encontrada"**. As userA the same calls correctly returned the reservation. Filtering enforced server-side by `{"reservation_id": id, "user_id": user["user_id"]}` (reservations.py:386, 396).
- **Result:** PASS

### 18. user_id query-param injection
- **Expected:** Passing `?user_id=<userB_id>` while authed as userA must NOT return userB's data.
- **Actual (authed as userA, `?user_id=<userB_id>`):**
  - `/auth/me` → 200, returned **userA's** data (`usera@test.com`, A's user_id). userB id not present.
  - `/favorites` → 200, `[]` (userA's enriched favorites are empty because `ptr_V001` is a partner, not an event/concert, so enrichment yields no rows — see "Other observations" below). No userB data.
  - `/favorites/ids` → 200, returned userA's raw favorites (`[{"item_id":"ptr_V001","item_type":"partner"}]`). No userB data.
  - `/reservations/my` → 200, userA's (empty after cleanup). No userB data.
  - `/profile` → 200, userA's profile. No userB data.
  - In every case, `userB_id` and `userb@test.com` were absent from the response.
- **Result:** PASS — endpoints derive identity from the session, not from query/body params.

### 19. Frontend storage + Bearer + logout
- Reviewed `frontend/src/context/AuthContext.tsx` and `frontend/src/constants/api.ts`:
  - **Storage:** `AsyncStorage` on web, `expo-secure-store` on native, keyed `session_token` — correct per-platform. (`AuthContext.tsx:8-21`)
  - **Bearer on every request:** `api.ts:14-21` `buildHeaders` adds `Authorization: Bearer <token>` if a token exists and the caller didn't override.
  - **Logout:** `AuthContext.tsx:165-177` calls `POST /api/auth/logout` with `Authorization: Bearer ${token}`, then removes the token from storage and clears `user_data`.
- **Result:** PASS for the client-side behaviour. **BUT** see Test 10 — the backend logout endpoint ignores the Bearer header, so the user's session keeps living on the server.

---

## Other observations (non-test)

- **`/favorites/toggle` accepts arbitrary `item_type`.** The frontend Test 15 used `item_type=partner`, the server happily stored it. `/favorites` (enriched) only looks up `event`/`concert` collections, so partner favorites silently disappear from the enriched list while still present in `/favorites/ids`. Not a security issue, but a data-shape inconsistency worth flagging.
- **OAuth path session is 7 days, demo-login is 30 days** (`server.py:72` vs `server.py:124`). Inconsistent expiry policy across login methods.
- **`secure=True, samesite="none"` cookies** are set on `/auth/demo-login` and `/auth/session-data`. Fine on HTTPS; will silently not stick on a plain `http://localhost` browser session (which is why the frontend uses Bearer anyway).
- **OAuth init path** (`exchangeSession` → `https://auth.emergentagent.com`) is an external third-party identity provider — out of scope for this layer but flagged for the broader audit.

---

## Critical Findings (security / availability)

1. **FAIL — `/auth/logout` is a no-op for the production web frontend.**
   The endpoint reads the session token from cookies only and ignores `Authorization: Bearer`. The web frontend uses `credentials: 'same-origin'` against a cross-origin backend, so no cookie is ever sent. Result: when a user clicks "log out", the client clears local storage but the **server-side session remains valid for up to 30 days**. Anyone who captures the token (browser extension, shared device, log leak, XSS) can keep using it indefinitely after the user believes they have logged out.
   **Fix:** in `logout()` (`server.py:1139`), also pull the token from the `Authorization` header before deleting — mirror the pattern in `get_current_user` lines 140-144.

2. **FINDING — Unbounded session accumulation.**
   - No TTL index on `user_sessions.expires_at` (Test 9).
   - Each `demo-login` for the same email creates an additional session row, never revokes prior (Test 12).
   - Combined with Finding #1, every logout from web leaves a dead-but-valid row.
   **Fix:** Add a TTL index `db.user_sessions.create_index("expires_at", expireAfterSeconds=0)` and consider capping concurrent sessions per user or revoking old ones on new login.

3. **FINDING — Inconsistent session lifetime.**
   OAuth `/auth/session-data` uses 7 days, demo-login uses 30 days. Pick one policy and document it.

No cross-user data leakage was found. Tests 16, 17, 18 all PASS — authorization is properly bound to the session-derived `user_id` and ignores any client-supplied `user_id` parameter.
