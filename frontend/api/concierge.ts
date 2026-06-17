// ============================================================================
// AMO CARTAGENA — GROUNDED AI CONCIERGE  (Block 4 / AUD-001 / AUD-008 / CODE-004)
// ============================================================================
// Vercel Serverless Function. Deploys to POST /api/concierge.
//
// ENV (server-side only — NEVER in client code)
//   ANTHROPIC_API_KEY   set in Vercel → Project → Settings → Environment Variables
//
// GROUNDING CONTRACT:
//   1. Partner catalog injected into system prompt as allowlist.
//   2. Model forced to return JSON with catalog slugs only.
//   3. Every recommendation validated against catalog server-side;
//      non-catalog slugs DROPPED before response leaves server.
// ============================================================================

export const config = { runtime: 'edge' };

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 900;
const MAX_RECS = 6;
const CATALOG_PATH = '/data/partners.json';
const EVENTS_PATH = '/data/events.json';
const PARTNER_EVENTS_PATH = '/data/partner-events.json';

// ----------------------------------------------------------------------------
// Personas
// ----------------------------------------------------------------------------
const PERSONAS: Record<string, { name: string; brief: string }> = {
  luna: {
    name: 'LUNA',
    brief:
      'Eres LUNA, la concierge de vida nocturna de Cartagena: bares, rooftops, clubes, ' +
      'música en vivo, rumba y planes after. Voz vibrante, cómplice, con criterio de quien ' +
      'conoce la noche. Recomiendas según el ambiente que busca la persona.',
  },
  mare: {
    name: 'MARÉ',
    brief:
      'Eres MARÉ, la concierge de playa y bienestar: beach clubs, islas (Rosario, Barú), ' +
      'spas, atardeceres y planes de día. Voz calmada, sensorial, cuidadosa. Piensas en clima, ' +
      'distancias y el ritmo del día.',
  },
  tino: {
    name: 'TINO',
    brief:
      'Eres TINO, la concierge de gastronomía: restaurantes, cocina caribeña, mariscos, ' +
      'cevicherías, mesas con vista. Voz cálida, golosa, precisa. Recomiendas por antojo, ' +
      'ocasión y zona.',
  },
  ciro: {
    name: 'CIRO',
    brief:
      'Eres CIRO, la concierge de logística y movilidad: cómo moverse, lanchas a las islas, ' +
      'traslados al aeropuerto, tiempos, seguridad y consejos prácticos. Voz directa, ' +
      'tranquilizadora, útil.',
  },
};

const BASE_RULES = `Eres una concierge de AMO Cartagena, una app para visitantes de Cartagena de Indias, Colombia.

REGLAS INQUEBRANTABLES:
- Recomienda ÚNICAMENTE lugares presentes en el CATÁLOGO que se te entrega. Cada recomendación debe corresponder a un slug del catálogo.
- NUNCA inventes lugares, direcciones, precios, teléfonos, horarios ni datos que no estén en el catálogo. Si no sabes un dato, dilo.
- Si la persona pregunta por un lugar que NO está en el catálogo, no lo presentes como real ni lo confirmes: dile con honestidad que no lo tienes y ofrece alternativas reales del catálogo.
- Responde en el idioma de la persona (español por defecto; si escribe en inglés, responde en inglés).
- Sé concreto, breve y accionable. Menciona los lugares por su nombre EXACTO del catálogo.
- Mantente en tu dominio de persona; si la consulta es de otro dominio, ayuda igual pero sugiere la persona adecuada.

FORMATO DE SALIDA — responde con SOLO un objeto JSON, sin texto adicional:
{
  "reply": "<tu respuesta conversacional, en el idioma de la persona>",
  "recommendations": ["<slug>", "<slug>"]
}
REGLAS DE FORMATO para "reply":
- NO uses markdown. Nada de asteriscos dobles, asteriscos simples, almohadillas ni bloques de codigo. Solo texto plano.
- Para enfasis, usa MAYUSCULAS o emojis. Ejemplo: "Te recomiendo ALQUIMICO" en vez de usar asteriscos.
- Usa saltos de linea para separar recomendaciones.
"recommendations" contiene solo slugs del catalogo (maximo ${MAX_RECS}); usa [] si ninguno encaja.`;

// ----------------------------------------------------------------------------
// Catalog — fetched once per warm instance, cached in module scope.
// ----------------------------------------------------------------------------
type CatItem = { slug: string; name: string; category: string; zone: string };
let CATALOG_CACHE: { bySlug: Map<string, CatItem>; allowlist: string } | null = null;

async function getCatalog(origin: string) {
  if (CATALOG_CACHE) return CATALOG_CACHE;
  const res = await fetch(new URL(CATALOG_PATH, origin).toString());
  if (!res.ok) throw new Error(`catalog fetch ${res.status}`);
  const raw = await res.json();
  const list: any[] = Array.isArray(raw) ? raw : raw.partners ?? [];

  const items: CatItem[] = list
    .map((p: any) => ({
      // Field mapping for AMO Cartagena partners.json:
      slug: String(p.partner_id ?? p.slug ?? p.id ?? '').trim(),
      name: String(p.name ?? p.title ?? '').trim(),
      category: String(p.category ?? p.type ?? '').trim(),
      zone: String(p.address ?? p.zone ?? p.neighborhood ?? '').trim().split(',')[0],
    }))
    .filter((p) => p.slug && p.name);

  const bySlug = new Map(items.map((p) => [p.slug, p]));
  const allowlist = items
    .map((p) => `${p.slug} | ${p.name}${p.category ? ' | ' + p.category : ''}${p.zone ? ' | ' + p.zone : ''}`)
    .join('\n');

  CATALOG_CACHE = { bySlug, allowlist };
  return CATALOG_CACHE;
}

// ----------------------------------------------------------------------------
// Tonight's events — fetched per request (small, changes daily)
// ----------------------------------------------------------------------------
async function getTonightEvents(origin: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  try {
    // City events
    const evRes = await fetch(new URL(EVENTS_PATH, origin).toString());
    if (evRes.ok) {
      const events: any[] = await evRes.json();
      if (Array.isArray(events)) {
        for (const e of events) {
          const start = e.date_start || e.date || '';
          const end = e.date_end || start;
          if (today >= start && today <= end) {
            const time = e.time_start || e.start_time || '';
            const name = e.name_es || e.title || '';
            const venue = e.venue || e.venue_name || '';
            const price = e.is_free ? 'GRATIS' : (e.price_min_cop ? `$${e.price_min_cop.toLocaleString()} COP` : '');
            lines.push(`- ${time ? time + ' ' : ''}${name}${venue ? ' @ ' + venue : ''}${price ? ' (' + price + ')' : ''}`);
          }
        }
      }
    }
    // Partner events
    const peRes = await fetch(new URL(PARTNER_EVENTS_PATH, origin).toString());
    if (peRes.ok) {
      const pe: any[] = await peRes.json();
      if (Array.isArray(pe)) {
        for (const e of pe) {
          if ((e.date || '') === today || !e.date) {
            const time = e.start_time || '';
            const name = e.title || '';
            const venue = e.partner_name || '';
            const price = e.is_free ? 'GRATIS' : (e.price ? `$${e.price.toLocaleString()} COP` : '');
            lines.push(`- ${time ? time + ' ' : ''}${name}${venue ? ' @ ' + venue : ''}${price ? ' (' + price + ')' : ''}`);
          }
        }
      }
    }
  } catch { /* silent — tonight awareness is best-effort */ }
  return lines.length > 0
    ? `\n\nEVENTOS DE HOY/ESTA NOCHE (${today}):\n${lines.join('\n')}\nCuando pregunten "hoy", "esta noche", "tonight", "qué hago", NOMBRA estos eventos específicos con hora y lugar.`
    : '';
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function pickPersona(p: unknown): string {
  const key = String(p ?? 'luna').toLowerCase();
  return PERSONAS[key] ? key : 'luna';
}

function normalizeMessages(body: any): { role: 'user' | 'assistant'; content: string }[] {
  let msgs: any[] = Array.isArray(body?.messages) ? body.messages : [];
  if (!msgs.length && body?.message) msgs = [{ role: 'user', content: String(body.message) }];
  const out = msgs.slice(-12)
    .map((m: any) => ({
      role: m?.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content: typeof m?.content === 'string' ? m.content : String(m?.content ?? ''),
    }))
    .filter((m) => m.content.trim().length);
  return out;
}

function tolerantJSON(text: string): { reply: string; recommendations: string[] } {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      const obj = JSON.parse(text.slice(start, end + 1));
      return {
        reply: String(obj.reply ?? '').trim() || text.trim(),
        recommendations: Array.isArray(obj.recommendations) ? obj.recommendations.map(String) : [],
      };
    }
  } catch {
    /* fall through */
  }
  return { reply: text.trim(), recommendations: [] };
}

function fallbackReply(lang: string) {
  return lang === 'en'
    ? 'Sorry, I had a problem. Please try again.'
    : 'Disculpa, tuve un problema. Inténtalo de nuevo.';
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}

// ----------------------------------------------------------------------------
// Core handler
// ----------------------------------------------------------------------------
async function handleConcierge(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': process.env.ALLOWED_ORIGIN || '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
    });
  }
  if (req.method !== 'POST') return jsonResponse(405, { reply: 'Method not allowed', recommendations: [] });

  const key = process.env.ANTHROPIC_API_KEY;
  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { reply: 'Bad request', recommendations: [] });
  }

  const lang = String(body?.language ?? 'es').toLowerCase().startsWith('en') ? 'en' : 'es';
  // Support both "persona" (new spec) and "agent" (existing client)
  const persona = pickPersona(body?.persona ?? body?.agent);
  const messages = normalizeMessages(body);

  if (!key) {
    console.error('concierge: ANTHROPIC_API_KEY missing');
    return jsonResponse(200, { reply: fallbackReply(lang), recommendations: [] });
  }
  if (!messages.length) {
    return jsonResponse(400, { reply: lang === 'en' ? 'Say something to start.' : 'Escribe algo para empezar.', recommendations: [] });
  }

  // Grounding requires the catalog. No catalog => no model call.
  let catalog;
  try {
    catalog = await getCatalog(new URL(req.url).origin);
  } catch (e) {
    console.error('concierge: catalog load failed', e);
    return jsonResponse(200, { reply: fallbackReply(lang), recommendations: [] });
  }

  // Fetch tonight's events (best-effort, non-blocking on failure)
  const tonightBlock = await getTonightEvents(new URL(req.url).origin);

  const system = [
    { type: 'text', text: BASE_RULES + tonightBlock },
    {
      type: 'text',
      text: `CATÁLOGO (allowlist — recomienda SOLO de aquí, por slug):\nslug | nombre | categoría | zona\n${catalog.allowlist}`,
      cache_control: { type: 'ephemeral' as const },
    },
    { type: 'text', text: PERSONAS[persona].brief },
  ];

  let upstreamText = '';
  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, messages }),
    });
    if (!r.ok) {
      console.error('concierge: anthropic', r.status, await r.text());
      return jsonResponse(200, { reply: fallbackReply(lang), recommendations: [] });
    }
    const data = await r.json();
    upstreamText = (data?.content ?? []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n').trim();
  } catch (e) {
    console.error('concierge: fetch failed', e);
    return jsonResponse(200, { reply: fallbackReply(lang), recommendations: [] });
  }

  // Parse + GROUND-FILTER. Drop any recommendation slug not in catalog.
  const parsed = tolerantJSON(upstreamText);
  const seen = new Set<string>();
  const recommendations = parsed.recommendations
    .map((s) => s.trim())
    .filter((s) => {
      if (!catalog.bySlug.has(s) || seen.has(s)) return false;
      seen.add(s);
      return true;
    })
    .slice(0, MAX_RECS)
    .map((s) => {
      const c = catalog.bySlug.get(s)!;
      return { slug: c.slug, name: c.name, category: c.category, zone: c.zone };
    });

  const reply = parsed.reply || fallbackReply(lang);

  return jsonResponse(200, { reply, recommendations, persona });
}

export default handleConcierge;
