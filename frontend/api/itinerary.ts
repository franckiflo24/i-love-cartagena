// ============================================================================
// AMO CARTAGENA — GROUNDED ITINERARY ENGINE  (Build 3 / AUD-024)
// ============================================================================
// Vercel Edge Function → POST /api/itinerary
// Same grounding contract as /api/concierge: catalog allowlist in,
// structured plan out, EVERY slug validated server-side.
// ============================================================================

export const config = { runtime: 'edge' };

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = (process.env.CLAUDE_ITINERARY_MODEL?.startsWith('claude-')
  ? process.env.CLAUDE_ITINERARY_MODEL : null) || 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 2200;
const MAX_ITEMS_PER_DAY = 6;
const MAX_DAYS = 7;
const CATALOG_PATH = '/data/partners.json';

// ---- catalog (same pattern as concierge, inlined for edge deploy) ----------
type CatItem = { slug: string; name: string; category: string; zone: string; lat?: number; lng?: number };
let CATALOG_CACHE: { bySlug: Map<string, CatItem>; allowlist: string } | null = null;

async function getCatalog(origin: string) {
  if (CATALOG_CACHE) return CATALOG_CACHE;
  const res = await fetch(new URL(CATALOG_PATH, origin).toString());
  if (!res.ok) throw new Error(`catalog fetch ${res.status}`);
  const raw = await res.json();
  const list: any[] = Array.isArray(raw) ? raw : raw.partners ?? [];
  const items: CatItem[] = list
    .map((p: any) => {
      const loc = p.location || {};
      return {
        slug: String(p.partner_id ?? p.slug ?? p.id ?? '').trim(),
        name: String(p.name ?? p.title ?? '').trim(),
        category: String(p.category ?? p.type ?? '').trim(),
        zone: String(p.address ?? p.zone ?? '').trim().split(',')[0],
        lat: typeof loc.lat === 'number' ? loc.lat : undefined,
        lng: typeof loc.lng === 'number' ? loc.lng : undefined,
      };
    })
    .filter((p) => p.slug && p.name);
  const bySlug = new Map(items.map((p) => [p.slug, p]));
  const allowlist = items
    .map((p) => `${p.slug} | ${p.name}${p.category ? ' | ' + p.category : ''}${p.zone ? ' | ' + p.zone : ''}`)
    .join('\n');
  CATALOG_CACHE = { bySlug, allowlist };
  return CATALOG_CACHE;
}

// ---- prompt ----------------------------------------------------------------
const RULES = (days: number, interests: string[], budget: string, party: string, pace: string, zones: string) =>
  `Eres el planificador de viajes de AMO Cartagena. Diseñas itinerarios día por día para visitantes de Cartagena de Indias, Colombia.

REGLAS INQUEBRANTABLES:
- Usa ÚNICAMENTE lugares del CATÁLOGO (por slug). NUNCA inventes lugares, direcciones, precios ni horarios.
- Secuencia con sentido: agrupa por zona para minimizar desplazamientos, respeta el ritmo de la persona, alterna comida/actividad/descanso, y considera el momento del día (playa de día, rumba de noche).
- No repitas el mismo lugar en días distintos salvo que tenga sentido.
- Responde en el idioma de la persona (español por defecto).

CONTEXTO DEL VIAJE:
- Días: ${days}
- Intereses: ${interests.join(', ') || 'generales'}
- Presupuesto: ${budget || 'medio'}
- Grupo: ${party || '2 personas'}
- Ritmo: ${pace || 'equilibrado'}
- Zonas preferidas: ${zones || 'sin preferencia'}

FORMATO DE SALIDA — responde con SOLO este objeto JSON, sin markdown ni texto extra:
{
  "title": "<título corto del plan>",
  "summary": "<1-2 frases de resumen>",
  "days": [
    { "day": 1, "theme": "<tema del día>",
      "items": [ { "slug": "<slug del catálogo>", "time": "13:00", "blurb": "<por qué este lugar, 1 frase>" } ] }
  ]
}
Máximo ${MAX_ITEMS_PER_DAY} items por día. Cada "slug" debe existir en el catálogo. No incluyas lugares fuera del catálogo.`;

// ---- helpers ---------------------------------------------------------------
function clampInt(v: any, min: number, max: number, dflt: number) {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}

function tolerantJSON(text: string): any {
  try {
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    if (s !== -1 && e !== -1) return JSON.parse(text.slice(s, e + 1));
  } catch { /* noop */ }
  return null;
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

function fallback(lang: string) {
  return {
    itinerary: null,
    error: lang === 'en'
      ? 'Could not build a plan right now. Try again.'
      : 'No pude armar el plan ahora. Inténtalo de nuevo.',
  };
}

// ---- handler ---------------------------------------------------------------
async function handleItinerary(req: Request): Promise<Response> {
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
  if (req.method !== 'POST') return jsonResponse(405, fallback('es'));

  const key = process.env.ANTHROPIC_API_KEY;
  let body: any = {};
  try { body = await req.json(); } catch { return jsonResponse(400, fallback('es')); }

  const lang = String(body?.language ?? 'es').toLowerCase().startsWith('en') ? 'en' : 'es';
  const days = clampInt(body?.days, 1, MAX_DAYS, 2);
  const interests: string[] = (Array.isArray(body?.interests) ? body.interests.map(String) : []).slice(0, 8).map((s: string) => s.slice(0, 32));
  const budget = String(body?.budget ?? '').slice(0, 64);
  const party = String(body?.party ?? '').slice(0, 64);
  const pace = String(body?.pace ?? '').slice(0, 64);
  const zones = (Array.isArray(body?.zones) ? body.zones.join(', ') : String(body?.zones ?? '')).slice(0, 128);

  if (!key) {
    console.error('itinerary: ANTHROPIC_API_KEY missing');
    return jsonResponse(200, fallback(lang));
  }

  let catalog;
  try {
    catalog = await getCatalog(new URL(req.url).origin);
  } catch (e) {
    console.error('itinerary: catalog load failed', e);
    return jsonResponse(200, fallback(lang));
  }

  const system = [
    { type: 'text', text: RULES(days, interests, budget, party, pace, zones) },
    {
      type: 'text',
      text: `CATÁLOGO (allowlist — usa SOLO estos slugs):\nslug | nombre | categoría | zona\n${catalog.allowlist}`,
      cache_control: { type: 'ephemeral' as const },
    },
  ];

  const userMsg = lang === 'en'
    ? `Build a ${days}-day Cartagena itinerary for me.`
    : `Arma mi itinerario de ${days} día(s) en Cartagena.`;

  let text = '';
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
        system,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    if (!r.ok) {
      console.error('itinerary: anthropic', r.status, await r.text());
      return jsonResponse(200, fallback(lang));
    }
    const data = await r.json();
    text = (data?.content ?? [])
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
      .trim();
  } catch (e) {
    console.error('itinerary: fetch failed', e);
    return jsonResponse(200, fallback(lang));
  }

  const parsed = tolerantJSON(text);
  if (!parsed || !Array.isArray(parsed.days)) return jsonResponse(200, fallback(lang));

  // GROUND-FILTER: drop any item whose slug isn't in the catalog
  const seen = new Set<string>();
  const cleanDays = parsed.days
    .slice(0, MAX_DAYS)
    .map((d: any, i: number) => {
      const items = (Array.isArray(d.items) ? d.items : [])
        .map((it: any) => {
          const slug = String(it?.slug ?? '').trim();
          const c = catalog.bySlug.get(slug);
          if (!c) return null; // hallucinated → drop
          return {
            slug: c.slug,
            name: c.name,
            category: c.category,
            zone: c.zone,
            lat: c.lat,
            lng: c.lng,
            time: String(it?.time ?? ''),
            blurb: String(it?.blurb ?? ''),
          };
        })
        .filter((x: any) => {
          if (!x) return false;
          const dup = seen.has(x.slug);
          seen.add(x.slug);
          return !dup; // dedupe across trip
        })
        .slice(0, MAX_ITEMS_PER_DAY);
      return { day: i + 1, theme: String(d?.theme ?? ''), items };
    })
    .filter((d: any) => d.items.length > 0); // drop empty days

  if (!cleanDays.length) return jsonResponse(200, fallback(lang));

  return jsonResponse(200, {
    itinerary: {
      title: String(parsed.title ?? (lang === 'en' ? 'Your Cartagena plan' : 'Tu plan en Cartagena')),
      summary: String(parsed.summary ?? ''),
      days: cleanDays,
    },
  });
}

export default handleItinerary;
