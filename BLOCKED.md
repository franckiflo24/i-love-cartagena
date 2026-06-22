# P0 REMEDIATION — BLOCKED ITEMS

## 4.1 / 4.2 — Concierge requires ANTHROPIC_API_KEY

**Status:** Serverless functions deployed and running at `/api/concierge` and `/api/ai-search`.
They return proper error responses because no Anthropic key is configured.

**What you need to do:**

1. Generate a **fresh** Anthropic API key at https://console.anthropic.com/settings/keys
2. Go to Vercel project settings → Environment Variables
3. Add: `ANTHROPIC_API_KEY` = `sk-ant-...` (the new key)
   - Scope: **Production** only
   - NOT exposed to client (server-side only — already configured correctly)
4. Redeploy (or the next deploy will pick it up automatically)

**If you had a previously exposed key:** Rotate/delete the old one from the Anthropic console.

After setting the key, verify:
```bash
curl -s -X POST https://dist-ten-omega-67.vercel.app/api/concierge \
  -H "Content-Type: application/json" \
  -d '{"agent":"luna","messages":[{"role":"user","content":"romantic restaurant"}]}'
```
Should return 200 with a grounded recommendation.
