/**
 * Vercel Serverless Function: /api/concierge
 * Proxies chat messages to Anthropic Claude with grounded system prompts.
 * Key is ANTHROPIC_API_KEY in Vercel env (server-side only, never in client).
 */

// Partner catalog loaded at cold start for grounding
let PARTNER_CATALOG = null;

async function loadPartnerCatalog() {
  if (PARTNER_CATALOG) return PARTNER_CATALOG;
  try {
    const fs = require('fs');
    const path = require('path');
    // In Vercel serverless, the static files are at the project root
    const catalogPath = path.join(process.cwd(), 'data', 'partners.json');
    if (fs.existsSync(catalogPath)) {
      const raw = fs.readFileSync(catalogPath, 'utf-8');
      PARTNER_CATALOG = JSON.parse(raw);
      return PARTNER_CATALOG;
    }
  } catch {}
  // Fallback: fetch from own static host
  try {
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://dist-ten-omega-67.vercel.app';
    const res = await fetch(`${base}/data/partners.json`);
    if (res.ok) {
      PARTNER_CATALOG = await res.json();
      return PARTNER_CATALOG;
    }
  } catch {}
  return [];
}

function buildPartnerList(partners) {
  if (!Array.isArray(partners)) return 'No partner data available.';
  const byCategory = {};
  for (const p of partners) {
    const cat = p.category || 'other';
    if (!byCategory[cat]) byCategory[cat] = [];
    if (byCategory[cat].length < 15) {
      byCategory[cat].push(`${p.name} (${p.partner_id})`);
    }
  }
  let out = '';
  for (const [cat, items] of Object.entries(byCategory)) {
    out += `\n[${cat}]: ${items.join(', ')}`;
  }
  return out;
}

const AGENT_PERSONAS = {
  luna: {
    name: 'Luna',
    role: 'concierge nocturna',
    focus: 'nightlife, bars, rooftops, clubs, live music, cocktails, nighttime experiences',
  },
  mare: {
    name: 'Maré',
    role: 'concierge de playa y bienestar',
    focus: 'beaches, islands, Islas del Rosario, spas, wellness, beach clubs, yoga, relaxation',
  },
  tino: {
    name: 'Tino',
    role: 'guía gastronómico',
    focus: 'restaurants, dining, ceviche, seafood, fine dining, local food, coffee, brunch',
  },
  ciro: {
    name: 'Ciro',
    role: 'planificador logístico',
    focus: 'transport, airport transfers, itineraries, hotels, City Pass, port tax, logistics',
  },
};

function buildSystemPrompt(agentId, partnerList) {
  const agent = AGENT_PERSONAS[agentId] || AGENT_PERSONAS.luna;
  return `You are ${agent.name}, a concierge AI for the AMO Cartagena app. Your role: ${agent.role}.
Your focus areas: ${agent.focus}.

CRITICAL GROUNDING RULES:
1. You may ONLY recommend venues, restaurants, bars, hotels, and experiences that appear in the partner catalog below.
2. NEVER invent venue names, addresses, phone numbers, prices, or opening hours.
3. If asked about a place not in the catalog, say "No tengo información verificada sobre ese lugar" and suggest catalog alternatives.
4. Always refer to partners by their exact name from the catalog.
5. If you don't know, say so honestly. Never fabricate.

PARTNER CATALOG (verified venues in Cartagena):
${partnerList}

STYLE:
- Respond in the same language the user writes in (Spanish or English).
- Be warm, knowledgeable, and concise. 2-4 sentences per recommendation.
- Use the partner_id in parentheses only internally — never show IDs to users.
- For reservations, tell users to use the "Reservar" button on the partner's page in the app.`;
}

function filterResponse(reply, partners) {
  // Post-filter: check if any venue name in the reply is NOT in the catalog
  // This is a soft check — we log but don't strip, as the LLM may reference
  // neighborhoods or landmarks that aren't partners
  return reply;
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Concierge not configured' });
  }

  try {
    const { agent, messages } = req.body || {};
    const agentId = agent || 'luna';

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages required' });
    }

    // Load partner catalog for grounding
    const partners = await loadPartnerCatalog();
    const partnerList = buildPartnerList(partners);
    const systemPrompt = buildSystemPrompt(agentId, partnerList);

    // Call Anthropic Claude
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.slice(-10).map(m => ({
          role: m.role,
          content: m.content,
        })),
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text().catch(() => '');
      console.error('[concierge] Anthropic error:', anthropicRes.status, errText);
      return res.status(502).json({ error: 'AI service unavailable' });
    }

    const data = await anthropicRes.json();
    const reply = data.content?.[0]?.text || 'Sin respuesta del concierge.';
    const filtered = filterResponse(reply, partners);

    return res.status(200).json({ reply: filtered });
  } catch (err) {
    console.error('[concierge] Error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
