# Layer 2 Integration Test Summary

Total route hits: 131

## Verdict counts

- **PASS**: 57
- **PASS_AUTH_BLOCKED**: 21
- **EXPECTED_VALIDATION_ERROR**: 18
- **NOT_FOUND**: 13
- **PASS_UNAUTH_BLOCKED**: 10
- **AUTH_LEAK**: 8
- **UNAUTH_404**: 2
- **DEAD**: 1
- **AUTH_BROKEN**: 1

## DEAD routes (5xx or timeout)

- `DELETE /users/push-token` -> 500 in 1ms
    > Internal Server Error

## AUTH_LEAK findings (admin/business route returned 2xx to regular user)

- `GET /admin/moderation/notifications (no-auth)` -> 200
    > {"notifications":[],"unread_count":0}
- `GET /admin/moderation/notifications` -> 200
    > {"notifications":[],"unread_count":0}
- `GET /admin/moderation/pending (no-auth)` -> 200
    > []
- `GET /admin/moderation/pending` -> 200
    > []
- `GET /admin/moderation/stats (no-auth)` -> 200
    > {"pending":0,"approved":0,"rejected":0,"auto_corrected_categories":0,"auto_improved_descriptions":0,"unread_notifications":0}
- `GET /admin/moderation/stats` -> 200
    > {"pending":0,"approved":0,"rejected":0,"auto_corrected_categories":0,"auto_improved_descriptions":0,"unread_notifications":0}
- `GET /admin/users (no-auth)` -> 200
    > {"total":2,"users":[{"user_id":"user_a8cec64ede1f","email":"audit@test.com","name":"Audit Bot","phone":"","picture":"","provider":"email_local","favorites":[],"my_week":[],"created_at":"2026-06-05T18:
- `GET /admin/users` -> 200
    > {"total":2,"users":[{"user_id":"user_a8cec64ede1f","email":"audit@test.com","name":"Audit Bot","phone":"","picture":"","provider":"email_local","favorites":[],"my_week":[],"created_at":"2026-06-05T18:

## AUTH_BROKEN (401 returned with valid token on non-admin route)

- `POST /webhooks/wompi` -> 401
    > {"detail":"Invalid signature"}

## Top 5 slowest routes

- 103ms — `GET /analytics/dashboard` (PASS)
- 33ms — `GET /analytics/summary` (PASS)
- 16ms — `GET /partners` (PASS)
- 4ms — `GET /admin/moderation/stats (no-auth)` (AUTH_LEAK)
- 4ms — `GET /admin/moderation/stats` (AUTH_LEAK)
