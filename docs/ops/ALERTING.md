# Production alerting — rules and runbook

## Permanent rule (2026-10-02)

**Sergio is on the alert list for ALL production alerts, without exception.**
Every Telegram alert the backend sends (`backend/telegram_alerts.py`) goes to every
chat in `TELEGRAM_ALERT_CHAT_IDS`; that list must contain Phil **and** Sergio. This is
not a per-feature choice — new alert paths inherit the list automatically, and nobody
removes a name from it without Phil's explicit say-so.

The same rule already governs WhatsApp/Twilio lead notifications (see the Sergio
notification rule in the ops memory): no lead, no booking, no escalation reaches only
one person.

## What alerts exist (all go to the full list)

| Alert | Source | Cadence |
|---|---|---|
| Partner event submitted / AI hold / LLM unavailable | `server.py` partner_events create + edit | at submit |
| Pending partner events stale (> 2 h) | `partner_events_sweep.py` cron `*/30` | at most once per 6 h |
| Daily agenda digest (city events + partner-events pending count) | `events_elite.py` `_send_digest` | daily |
| Uptime monitor (www + /api/health + /api/partners) | claude.ai routine "AMO uptime monitor" | hourly, email via `/client-error` |
| Maintenance ops audit | `maintenance.py` | per operation (user_activity, no Telegram) |

## Adding a person (one command, no ids in chat/logs/git)

1. The person opens Telegram, starts the AMO alert bot and sends `/start` (any message).
2. On a machine with Vercel access, from `backend/`:
   ```
   npx vercel env pull /tmp/x/prod.vars --environment production --yes
   python3 scripts/telegram_add_chat.py --env /tmp/x/prod.vars --name Sergio
   npx vercel --prod
   rm -P /tmp/x/prod.vars
   ```
3. Prove delivery (counts only, never ids):
   `POST https://backend-mu-one-74.vercel.app/api/admin/maintenance/alert-test` with
   `Authorization: Bearer $CRON_SECRET` → `{"chats": N, "sent": N, "errors": []}` and
   every person confirms they saw "🔔 AMO prueba de alertas".

## Rules for new alert code

- Use `telegram_alerts.send()` / `digest()`; never a hand-rolled `sendMessage`.
- Check the return value — `sent < chats` or a non-empty `errors` list must be logged
  as a warning with the alert's purpose (the submit-time alert already does this).
- Dedupe repeating alerts with a `cron_state` marker (the sweep's 6 h window is the
  pattern); an alert that fires every tick is noise and gets muted.
- Never put a secret, a token, a password or a chat id in an alert body.
