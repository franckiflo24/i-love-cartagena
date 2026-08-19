// Walking Layer — OG share page (Drop 3 fast-follow).
// GET /pasaporte/share/:id (rewritten to /api/share-page?id=:id).
//
// Crawlers (WhatsApp/IG/X) get real OG meta with a dynamic card image;
// humans get a minimal branded page with the card + a CTA into the app.
// Renders snapshot fields only — no coordinates, no user data.

export const config = { runtime: 'edge' };

const BACKEND = 'https://backend-mu-one-74.vercel.app';
const SITE = 'https://www.amocartagena.co';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id') || '';
  const rawRef = (url.searchParams.get('ref') || '').toUpperCase();
  const ref = /^AMO[A-Z0-9]{4,8}$/.test(rawRef) ? rawRef : '';
  if (!/^shr_[a-f0-9]{6,20}$/.test(id)) {
    return Response.redirect(`${SITE}/pasaporte`, 302);
  }

  let snap: any = null;
  try {
    const res = await fetch(`${BACKEND}/api/passport/share/${id}`);
    if (res.ok) snap = await res.json();
  } catch {}
  if (!snap) {
    // Unknown/expired snapshot → the passport landing, never a broken page
    return Response.redirect(`${SITE}/pasaporte`, 302);
  }

  const who = snap.name ? `el pasaporte de ${snap.name}` : 'un pasaporte de viaje';
  const bits: string[] = [];
  const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;
  if (snap.sabores_d > 0) bits.push(plural(snap.sabores_d, 'sabor', 'sabores'));
  if (snap.plazas_d > 0) bits.push(plural(snap.plazas_d, 'plaza', 'plazas'));
  if (snap.joyas > 0) bits.push(plural(snap.joyas, 'joya local', 'joyas locales'));
  const desc = bits.length > 0
    ? `${bits.join(' · ')} — descubiertos caminando Cartagena de Indias.`
    : 'Un pasaporte de Cartagena que acaba de empezar. Crea el tuyo.';

  // Drop 11 (11B2): the arrival is an INVITATION, not a download pitch.
  const firstName = (snap.name || '').trim().split(' ')[0];
  const inviteLine = firstName
    ? `${firstName} te invitó a explorar Cartagena`
    : 'Te invitaron a explorar Cartagena';
  const title = `Mi Cartagena — ${who}`;
  const cardUrl = `${SITE}/api/share-card?id=${id}`;
  const pageUrl = `${SITE}/pasaporte/share/${id}`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="AMO Cartagena"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:url" content="${pageUrl}"/>
<meta property="og:image" content="${cardUrl}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:locale" content="es_CO"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(title)}"/>
<meta name="twitter:description" content="${esc(desc)}"/>
<meta name="twitter:image" content="${cardUrl}"/>
<link rel="icon" href="${SITE}/favicon.ico"/>
<style>
  :root { color-scheme: dark; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #07070B; color: #fff; font-family: 'Manrope','DM Sans',system-ui,sans-serif;
         min-height: 100vh; display: flex; flex-direction: column; align-items: center;
         justify-content: center; gap: 28px; padding: 24px; text-align: center; }
  img.card { width: min(92vw, 640px); border-radius: 18px; border: 1px solid rgba(233,185,73,0.35);
             box-shadow: 0 20px 60px rgba(0,0,0,0.6); }
  a.cta { background: #E9B949; color: #000; font-weight: 800; text-decoration: none;
          padding: 14px 30px; border-radius: 999px; font-size: 16px; }
  p.sub { color: rgba(255,255,255,0.5); font-size: 14px; max-width: 420px; line-height: 1.5; }
</style>
</head>
<body>
  <h1 style="font-family:Georgia,serif;font-weight:400;font-size:clamp(22px,5vw,34px);color:#F2D06B;">${esc(inviteLine)}</h1>
  <img class="card" src="${cardUrl}" alt="${esc(title)}"/>
  <p class="sub">Cada sello es real — ganado caminando la ciudad, verificado en el lugar. Esto es lo que te espera.</p>
  <a class="cta" href="${SITE}/pasaporte${ref ? `?ref=${ref}` : ''}">Empezá tu propio pasaporte</a>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
