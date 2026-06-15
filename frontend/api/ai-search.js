/**
 * Vercel Serverless Function: /api/ai-search
 * AI-enriched search — takes a query + candidate hits, returns Claude's
 * curated recommendations grounded in the real partner catalog.
 * Key is ANTHROPIC_API_KEY in Vercel env (server-side only).
 */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'AI search not configured' });

  try {
    const { q, lang, hits } = req.body || {};
    if (!q) return res.status(400).json({ error: 'q required' });

    const partnerNames = (hits?.partners || []).map(p => `${p.name} (${p.id}, ${p.category})`).join(', ');
    const eventNames = (hits?.events || []).map(e => `${e.title} (${e.date})`).join(', ');

    const systemPrompt = `You are a Cartagena travel AI for the AMO Cartagena app.
The user searched for: "${q}"

AVAILABLE PARTNERS (you may ONLY recommend these): ${partnerNames || 'none'}
AVAILABLE EVENTS: ${eventNames || 'none'}

Rules:
- Only recommend places from the AVAILABLE list above. Never invent venues.
- Respond in ${lang === 'en' ? 'English' : 'Spanish'}.
- Be concise: 2-3 sentences max. Mention 1-3 specific partners by name.
- If nothing matches, say so honestly and suggest browsing the app.`;

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: q }],
      }),
    });

    if (!anthropicRes.ok) {
      return res.status(200).json({ summary: null });
    }

    const data = await anthropicRes.json();
    const summary = data.content?.[0]?.text || null;

    return res.status(200).json({ summary });
  } catch (err) {
    console.error('[ai-search]', err);
    return res.status(200).json({ summary: null });
  }
};
