// Event-detail OG shim (EVENT-DETAIL SEO drop, modeled on api/share-page.ts).
// Preview crawlers (WhatsApp/FB/X/Telegram/…) hitting /event/:id are rewritten here by
// vercel.json (user-agent gated), because the static export serves them the generic
// site OG otherwise. Humans never land here via /event/:id — their UA falls through to
// the app shell; anyone hitting /api/event-share directly is bounced into the app.
//
// Honesty rails match the app screen: date_tbc never shows a date; GRATIS only when
// is_free === true; non-live rows (hidden/review/expired) and unknown ids 302 to
// /que-pasa — never a broken or stale preview. JSON-LD comes from the SAME builder the
// app injects (src/lib/eventJsonLd.ts): published + real start_date only.
import { absImage, eventJsonLd, SITE_ORIGIN } from '../src/lib/eventJsonLd';

export const config = { runtime: 'edge' };

const BACKEND = 'https://backend-mu-one-74.vercel.app';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

type L4 = { es?: string; en?: string } | null | undefined;
const L = (v: L4): string => (v && (v.es || v.en)) || '';

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function dayMonth(d: string): { day: number; month: string; year: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return null;
  return { day: Number(m[3]), month: MONTHS_ES[Number(m[2]) - 1] || '', year: Number(m[1]) };
}

/** "11 nov 2026" · "11–14 nov 2026" · "28 nov – 2 dic 2026" — never an invented date. */
function datesEs(start: string | null, end: string | null): string {
  const a = start ? dayMonth(start) : null;
  if (!a) return '';
  const b = end && end !== start ? dayMonth(end) : null;
  if (!b) return `${a.day} ${a.month} ${a.year}`;
  if (a.month === b.month && a.year === b.year) return `${a.day}–${b.day} ${a.month} ${a.year}`;
  return `${a.day} ${a.month}${a.year !== b.year ? ` ${a.year}` : ''} – ${b.day} ${b.month} ${b.year}`;
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id') || '';
  const listUrl = `${SITE_ORIGIN}/que-pasa`;
  // City-event ids only (ce-…/legacy slugs). Partner events (pe_/evt_) keep their own
  // canonical screen and are out of scope here — bounce those to the app route.
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,140}$/.test(id)) {
    return Response.redirect(listUrl, 302);
  }

  let ev: any = null;
  try {
    const res = await fetch(`${BACKEND}/api/events/feed/item/${encodeURIComponent(id)}`);
    if (res.ok) ev = await res.json();
  } catch {
    // network blip → fall through to the redirect below; never a broken preview
  }
  const live = ev && (ev.status === 'published' || ev.status === 'date_tbc');
  if (!live) {
    // Unknown, partner-shaped, or no-longer-confirmed → the agenda, never a stale pitch
    return Response.redirect(listUrl, 302);
  }

  const title = L(ev.title) || 'Evento en Cartagena';
  const published = ev.status === 'published';
  const when = published ? datesEs(ev.start_date, ev.end_date) : 'Fecha por confirmar';
  const time = published && /^\d{2}:\d{2}$/.test(ev.start_time || '') ? ev.start_time : '';
  const whenLine = [when, time].filter(Boolean).join(' · ');
  const venue = typeof ev.venue_name === 'string' ? ev.venue_name : '';
  const descBits = [whenLine, venue].filter(Boolean).join(' · ');
  const rawDesc = L(ev.description);
  const desc = rawDesc
    ? `${descBits ? `${descBits} — ` : ''}${rawDesc.length > 200 ? `${rawDesc.slice(0, 197)}…` : rawDesc}`
    : `${descBits || 'Evento en Cartagena'} · Fuente: ${ev.source_name || 'oficial'}`;
  const ogTitle = `${title} · ${when}`;
  const pageUrl = `${SITE_ORIGIN}/event/${encodeURIComponent(id)}`;
  // ?app=1 skips the UA rewrite (vercel.json `missing` guard) — a human browser whose
  // UA happens to match the crawler pattern must never loop shim → /event → shim.
  const appUrl = `${pageUrl}?app=1`;
  const img = absImage(ev.image_url) || `${SITE_ORIGIN}/data/og-image.jpg`;
  const ld = eventJsonLd(ev);
  const verified = typeof ev.last_verified === 'string' && ev.last_verified
    ? ` · verificado ${ev.last_verified.slice(0, 10)}` : '';

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(ogTitle)} · AMO Life</title>
<meta name="description" content="${esc(desc)}"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="AMO Life"/>
<meta property="og:title" content="${esc(ogTitle)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:url" content="${pageUrl}"/>
<meta property="og:image" content="${esc(img)}"/>
<meta property="og:locale" content="es_CO"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(ogTitle)}"/>
<meta name="twitter:description" content="${esc(desc)}"/>
<meta name="twitter:image" content="${esc(img)}"/>
<link rel="canonical" href="${pageUrl}"/>
<link rel="icon" href="${SITE_ORIGIN}/favicon.ico"/>
${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>` : ''}
<script>location.replace(${JSON.stringify(appUrl)});</script>
<style>
  :root { color-scheme: dark; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #07070B; color: #fff; font-family: 'DM Sans',system-ui,sans-serif;
         min-height: 100vh; display: flex; flex-direction: column; align-items: center;
         justify-content: center; gap: 18px; padding: 24px; text-align: center; }
  a.cta { background: #E9B949; color: #000; font-weight: 800; text-decoration: none;
          padding: 14px 30px; border-radius: 999px; font-size: 16px; }
  p.sub { color: rgba(255,255,255,0.55); font-size: 14px; max-width: 460px; line-height: 1.5; }
  p.fine { color: rgba(255,255,255,0.35); font-size: 11px; max-width: 460px; line-height: 1.5; }
</style>
</head>
<body>
  <h1 style="font-weight:700;font-size:clamp(22px,5vw,32px);">${esc(title)}</h1>
  <p class="sub">${esc([whenLine, venue].filter(Boolean).join(' · ') || 'Evento en Cartagena')}</p>
  ${ev.source_name ? `<p class="fine">Fuente: ${esc(ev.source_name)}${esc(verified)}</p>` : ''}
  <a class="cta" href="${appUrl}">Ver el evento en AMO</a>
  <p class="fine">Horarios y precios pueden cambiar: confirma siempre con el organizador.</p>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Short CDN cache: the feed itself revalidates every 10 min; previews follow it.
      'Cache-Control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600',
    },
  });
}
