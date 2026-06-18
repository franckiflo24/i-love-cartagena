// ============================================================================
// AMO CARTAGENA — ELITE AI CONCIERGE v2
// ============================================================================
// Fixes: rich catalog (descriptions, prices, ratings, hours, cuisine),
// intent elicitation, user context (time of day), tonight events,
// temperature 0.7, max_tokens 1200, no markdown.
// ============================================================================

export const config = { runtime: 'edge' };

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1200;
const MAX_RECS = 6;
const CATALOG_PATH = '/data/partners.json';
const EVENTS_PATH = '/data/events.json';
const PARTNER_EVENTS_PATH = '/data/partner-events.json';

// ----------------------------------------------------------------------------
// Personas — deeper personality + intent elicitation instructions
// ----------------------------------------------------------------------------
const PERSONAS: Record<string, { name: string; brief: string }> = {
  luna: {
    name: 'LUNA',
    brief: `Eres LUNA, concierge de vida nocturna de Cartagena. Experta en bares, rooftops, clubes, musica en vivo, rumba y planes after.

TU ESTILO: Vibrante, complice, con criterio. Hablas como alguien que conoce cada rincon de la noche en Cartagena. Usas emojis con moderacion.

CUANDO EL USUARIO LLEGA POR PRIMERA VEZ:
- Pregunta que tipo de noche busca: romantica, rumba, cocteles con vista, musica en vivo, o algo diferente
- Pregunta cuantas personas son y si celebran algo especial
- Pregunta si prefieren Centro Historico, Getsemani, o Bocagrande
Luego recomienda 2-3 opciones con razon especifica de por que cada una encaja.

CUANDO YA TIENES CONTEXTO (mensajes previos):
- Recomienda directo con explicacion personalizada
- Sugiere un plan de noche completo (cena -> drinks -> rumba) si tiene sentido`,
  },
  mare: {
    name: 'MARE',
    brief: `Eres MARE, concierge de playa y bienestar en Cartagena. Experta en beach clubs, islas (Rosario, Baru), spas, atardeceres y planes de dia.

TU ESTILO: Calmada, sensorial, cuidadosa. Piensas en clima, distancias, logistica y el ritmo del dia.

CUANDO EL USUARIO LLEGA POR PRIMERA VEZ:
- Pregunta que buscan: playa relajada, fiesta en playa, snorkel/aventura, spa/bienestar, o atardecer
- Pregunta cuantas personas y si hay ninos
- Pregunta presupuesto aproximado (las islas varian mucho: $50K a $400K por persona)
Luego recomienda con detalles de logistica (como llegar, que incluye, que llevar).

CUANDO YA TIENES CONTEXTO:
- Recomienda con tips practicos: hora de salida, protector solar, efectivo vs tarjeta, etc.`,
  },
  tino: {
    name: 'TINO',
    brief: `Eres TINO, concierge gastronomico de Cartagena. Experto en restaurantes, cocina caribena, mariscos, cevicherias, cocina de autor y mesas con vista.

TU ESTILO: Calido, goloso, preciso. Conoces cada plato emblematico y sabes por que cada restaurante vale la pena.

CUANDO EL USUARIO LLEGA POR PRIMERA VEZ:
- Pregunta la ocasion: cena romantica, grupo de amigos, familia, celebracion, o solo explorar
- Pregunta preferencias: mariscos, carne, vegetariano, cocina local vs internacional
- Pregunta presupuesto: economico ($30-60K), medio ($60-120K), premium ($120K+)
- Pregunta zona preferida o si no importa
Luego recomienda 2-3 opciones explicando que los hace especiales (plato estrella, ambiente, vista).

CUANDO YA TIENES CONTEXTO:
- Recomienda directo con el plato que deben pedir y por que`,
  },
  ciro: {
    name: 'CIRO',
    brief: `Eres CIRO, concierge de logistica y movilidad en Cartagena. Experto en transporte, lanchas a las islas, traslados al aeropuerto, tiempos, seguridad y consejos practicos.

TU ESTILO: Directo, tranquilizador, util. Das informacion practica que ahorra tiempo y problemas.

CUANDO EL USUARIO LLEGA POR PRIMERA VEZ:
- Pregunta que necesitan: llegar a un lugar, ir a las islas, moverse entre zonas, o planificar logistica general
- Da respuestas con precios reales, tiempos estimados y tips de seguridad
- Siempre menciona la opcion mas segura y la mas economica

CUANDO YA TIENES CONTEXTO:
- Responde directo con instrucciones paso a paso`,
  },
};

// ----------------------------------------------------------------------------
// Rich catalog — includes description, price, rating, hours, cuisine
// ----------------------------------------------------------------------------
type CatItem = {
  slug: string; name: string; category: string; zone: string;
  description?: string; price_range?: string; rating?: number;
  hours?: string; cuisine?: string; tier?: string;
};
let CATALOG_CACHE: { bySlug: Map<string, CatItem>; allowlist: string } | null = null;

async function getCatalog(origin: string) {
  if (CATALOG_CACHE) return CATALOG_CACHE;
  const res = await fetch(new URL(CATALOG_PATH, origin).toString());
  if (!res.ok) throw new Error(`catalog fetch ${res.status}`);
  const raw = await res.json();
  const list: any[] = Array.isArray(raw) ? raw : raw.partners ?? [];

  const items: CatItem[] = list
    .map((p: any) => ({
      slug: String(p.partner_id ?? p.slug ?? p.id ?? '').trim(),
      name: String(p.name ?? p.title ?? '').trim(),
      category: String(p.category ?? p.type ?? '').trim(),
      zone: String(p.address ?? p.zone ?? '').trim().split(',')[0],
      description: String(p.description ?? '').trim().slice(0, 120) || undefined,
      price_range: String(p.price_range ?? '').trim() || undefined,
      rating: typeof p.rating === 'number' ? p.rating : undefined,
      hours: String(p.hours ?? '').trim().slice(0, 80) || undefined,
      cuisine: String(p.cuisine ?? '').trim() || undefined,
      tier: String(p.tier ?? '').trim() || undefined,
    }))
    .filter((p) => p.slug && p.name);

  const bySlug = new Map(items.map((p) => [p.slug, p]));

  // Rich allowlist: slug | name | category | zone | price | rating | description
  const allowlist = items
    .map((p) => {
      let line = `${p.slug} | ${p.name} | ${p.category}`;
      if (p.zone) line += ` | ${p.zone}`;
      if (p.price_range) line += ` | ${p.price_range}`;
      if (p.rating) line += ` | ${p.rating}/5`;
      if (p.cuisine) line += ` | ${p.cuisine}`;
      if (p.tier && p.tier !== 'standard') line += ` | ${p.tier.toUpperCase()}`;
      if (p.description) line += ` | ${p.description}`;
      return line;
    })
    .join('\n');

  CATALOG_CACHE = { bySlug, allowlist };
  return CATALOG_CACHE;
}

// ----------------------------------------------------------------------------
// Tonight's events
// ----------------------------------------------------------------------------
async function getTonightEvents(origin: string): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  try {
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
            const desc = (e.description || '').slice(0, 60);
            lines.push(`- ${time ? time + ' ' : ''}${name}${venue ? ' @ ' + venue : ''}${price ? ' (' + price + ')' : ''}${desc ? ' — ' + desc : ''}`);
          }
        }
      }
    }
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
  } catch { /* silent */ }
  return lines.length > 0
    ? `\n\nEVENTOS DE HOY/ESTA NOCHE (${today}):\n${lines.join('\n')}\nCuando pregunten "hoy", "esta noche", "tonight", "que hago", NOMBRA estos eventos con hora, lugar y precio.`
    : '';
}

// ----------------------------------------------------------------------------
// User context — time of day, message count (first message vs returning)
// ----------------------------------------------------------------------------
function getUserContext(messages: { role: string; content: string }[]): string {
  const now = new Date();
  const hour = now.getUTCHours() - 5; // Colombia is UTC-5
  const adjustedHour = hour < 0 ? hour + 24 : hour;

  let timeOfDay: string;
  if (adjustedHour >= 5 && adjustedHour < 12) timeOfDay = 'manana (morning)';
  else if (adjustedHour >= 12 && adjustedHour < 17) timeOfDay = 'tarde (afternoon)';
  else if (adjustedHour >= 17 && adjustedHour < 21) timeOfDay = 'atardecer/noche temprana (early evening)';
  else timeOfDay = 'noche (night)';

  const isFirstMessage = messages.length <= 1;
  const userMessages = messages.filter(m => m.role === 'user');
  const lastUserMsg = userMessages[userMessages.length - 1]?.content || '';

  // Detect intent signals from the message
  const wantsTonight = /esta noche|tonight|hoy|today|que hago|what.*do/i.test(lastUserMsg);
  const wantsFood = /comer|comida|restaurante|cenar|ceviche|food|eat|dinner|lunch|brunch/i.test(lastUserMsg);
  const wantsNightlife = /rumba|fiesta|bar|club|rooftop|party|salsa|night/i.test(lastUserMsg);
  const wantsBeach = /playa|beach|isla|island|rosario|baru|snorkel|buceo/i.test(lastUserMsg);
  const wantsRomantic = /romantic|romantico|pareja|couple|anniversary|aniversario|honeymoon|luna de miel/i.test(lastUserMsg);
  const wantsBudget = /barato|economico|cheap|budget|gratis|free/i.test(lastUserMsg);
  const wantsPremium = /lujo|luxury|premium|exclusivo|high.end|vip/i.test(lastUserMsg);

  let context = `\nCONTEXTO DEL USUARIO:`;
  context += `\n- Hora actual en Cartagena: ${adjustedHour}:00 (${timeOfDay})`;
  context += `\n- Es su ${isFirstMessage ? 'PRIMER mensaje (haz preguntas antes de recomendar)' : `mensaje #${messages.length} (ya tienes contexto, recomienda directo)`}`;

  if (wantsTonight) context += '\n- QUIERE planes para HOY/ESTA NOCHE';
  if (wantsFood) context += '\n- BUSCA comida/restaurantes';
  if (wantsNightlife) context += '\n- BUSCA vida nocturna/fiesta';
  if (wantsBeach) context += '\n- BUSCA playa/islas';
  if (wantsRomantic) context += '\n- BUSCA algo ROMANTICO';
  if (wantsBudget) context += '\n- Presupuesto ECONOMICO';
  if (wantsPremium) context += '\n- Presupuesto PREMIUM/LUJO';

  return context;
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
  return msgs.slice(-12)
    .map((m: any) => ({
      role: m?.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content: typeof m?.content === 'string' ? m.content.slice(0, 2000) : String(m?.content ?? '').slice(0, 2000),
    }))
    .filter((m) => m.content.trim().length);
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
  } catch { /* fall through */ }
  return { reply: text.trim(), recommendations: [] };
}

function fallbackReply(lang: string) {
  return lang === 'en'
    ? 'Sorry, I had a problem. Please try again.'
    : 'Disculpa, tuve un problema. Intentalo de nuevo.';
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

const BASE_RULES = `Eres una concierge PREMIUM de AMO Cartagena, la app definitiva para visitantes de Cartagena de Indias, Colombia.

REGLAS INQUEBRANTABLES:
- Recomienda UNICAMENTE lugares del CATALOGO. Cada recomendacion debe usar un slug del catalogo.
- NUNCA inventes lugares, direcciones, precios, telefonos ni horarios.
- Si preguntan por un lugar que NO esta en el catalogo, dilo honestamente y ofrece alternativas reales.
- Responde en el idioma de la persona (espanol por defecto; ingles si escriben en ingles).
- Se CONCRETO y UTIL. Explica POR QUE recomiendas cada lugar, no solo el nombre.
- Incluye detalles practicos: precio aproximado, que pedir, mejor hora para ir, tip de local.

COMPORTAMIENTO:
- Si es el PRIMER mensaje del usuario, HAZ 1-2 PREGUNTAS antes de recomendar para entender que buscan (ocasion, grupo, presupuesto, zona).
- Si ya tienes contexto de mensajes previos, recomienda DIRECTO con explicacion personalizada.
- Cuando puedas, sugiere un PLAN completo (ej: cena -> drinks -> rumba) en vez de opciones sueltas.
- Usa el CONTEXTO DEL USUARIO (hora del dia, senales de intencion) para personalizar.

FORMATO DE SALIDA — responde con SOLO un objeto JSON:
{
  "reply": "<tu respuesta conversacional>",
  "recommendations": ["<slug>", "<slug>"]
}
FORMATO para "reply":
- NO uses markdown. Nada de asteriscos, almohadillas ni bloques de codigo.
- Para enfasis usa MAYUSCULAS o emojis.
- Usa saltos de linea para separar ideas.
"recommendations" contiene solo slugs del catalogo (maximo ${MAX_RECS}).`;

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
  try { body = await req.json(); } catch {
    return jsonResponse(400, { reply: 'Bad request', recommendations: [] });
  }

  const lang = String(body?.language ?? 'es').toLowerCase().startsWith('en') ? 'en' : 'es';
  const persona = pickPersona(body?.persona ?? body?.agent);
  const messages = normalizeMessages(body);

  if (!key) {
    console.error('concierge: ANTHROPIC_API_KEY missing');
    return jsonResponse(200, { reply: fallbackReply(lang), recommendations: [] });
  }
  if (!messages.length) {
    return jsonResponse(400, { reply: lang === 'en' ? 'Say something to start.' : 'Escribe algo para empezar.', recommendations: [] });
  }

  let catalog;
  try {
    catalog = await getCatalog(new URL(req.url).origin);
  } catch (e) {
    console.error('concierge: catalog load failed', e);
    return jsonResponse(200, { reply: fallbackReply(lang), recommendations: [] });
  }

  const tonightBlock = await getTonightEvents(new URL(req.url).origin);
  const userContext = getUserContext(messages);

  const system = [
    { type: 'text', text: BASE_RULES + userContext + tonightBlock },
    {
      type: 'text',
      text: `CATALOGO (slug | nombre | categoria | zona | precio | rating | cocina | tier | descripcion):\n${catalog.allowlist}`,
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
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0.7,
        system,
        messages,
      }),
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

  const parsed = tolerantJSON(upstreamText);
  const seen = new Set<string>();
  const recommendations = parsed.recommendations
    .map((s: string) => s.trim())
    .filter((s: string) => {
      if (!catalog.bySlug.has(s) || seen.has(s)) return false;
      seen.add(s);
      return true;
    })
    .slice(0, MAX_RECS)
    .map((s: string) => {
      const c = catalog.bySlug.get(s)!;
      return { slug: c.slug, name: c.name, category: c.category, zone: c.zone };
    });

  const reply = parsed.reply || fallbackReply(lang);
  return jsonResponse(200, { reply, recommendations, persona });
}

export default handleConcierge;
