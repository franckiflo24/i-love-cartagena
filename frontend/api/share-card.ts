// Walking Layer — OG card renderer (Drop 3 fast-follow). NODE runtime:
// satori (JSX-object tree → SVG) + resvg (SVG → PNG). 1200×630 for link
// unfurls (WhatsApp/IG/X). Renders ONLY the snapshot's card-visible fields:
// counts, streak, top barrio, venue names. No coordinates, no user data.

import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { MANROPE_700_B64, MANROPE_800_B64, HEART_SVG } from '../og-assets/fonts';

const BACKEND = 'https://backend-mu-one-74.vercel.app';
const GOLD = '#D4AF37';
const GOLD_BRIGHT = '#F5D47A';

const NBH_NAMES: Record<string, string> = {
  centro: 'Centro Histórico', san_diego: 'San Diego', getsemani: 'Getsemaní',
  bocagrande: 'Bocagrande', laguito: 'El Laguito', castillogrande: 'Castillogrande',
  manga: 'Manga', marbella: 'Marbella', la_boquilla: 'La Boquilla', tierrabomba: 'Tierrabomba',
};

const FONT_700 = Buffer.from(MANROPE_700_B64, 'base64');
const FONT_800 = Buffer.from(MANROPE_800_B64, 'base64');
const HEART_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(HEART_SVG).toString('base64')}`;

// satori element helper (no React dependency)
function h(type: string, style: Record<string, unknown>, ...children: unknown[]) {
  return { type, props: { style, children: children.length === 1 ? children[0] : children } };
}

function tile(num: string, label: string) {
  return h('div', {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', width: 210, height: 130, borderRadius: 20,
    border: '1.5px solid rgba(212,175,55,0.4)', backgroundColor: 'rgba(255,255,255,0.04)',
  },
    h('div', { display: 'flex', fontSize: 52, fontWeight: 800, color: GOLD_BRIGHT }, num),
    h('div', { display: 'flex', fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.55)', letterSpacing: 2 }, label),
  );
}

function card(snap: any) {
  const tiles: any[] = [];
  if (snap.sabores_d > 0) tiles.push(tile(`${snap.sabores_d}/${snap.sabores_t}`, 'SABORES'));
  if (snap.plazas_d > 0) tiles.push(tile(`${snap.plazas_d}/${snap.plazas_t}`, 'PLAZAS'));
  if (snap.joyas > 0) tiles.push(tile(`${snap.joyas}`, 'JOYAS'));

  const bits: string[] = [];
  if (snap.streak_best > 1) bits.push(`racha de ${snap.streak_best} días`);
  if (snap.top_nbh) bits.push(`${NBH_NAMES[snap.top_nbh.slug] || snap.top_nbh.slug} ${snap.top_nbh.d}/${snap.top_nbh.t}`);
  const venues: string[] = (snap.venues || []).slice(0, 3);

  const inner: any[] = [
    h('div', { display: 'flex', fontSize: 44, fontWeight: 800, color: '#FFFFFF', letterSpacing: 4 }, 'MI CARTAGENA'),
    h('div', { display: 'flex', fontSize: 21, fontWeight: 700, color: 'rgba(255,255,255,0.45)', marginTop: 4 },
      snap.name ? `el pasaporte de ${snap.name}` : 'mi pasaporte de viaje'),
  ];
  // 8C3: earned title + rareza — only rendered when the snapshot carries them
  if (snap.title) {
    inner.push(h('div', { display: 'flex', fontSize: 24, fontWeight: 800, color: '#F5D47A', marginTop: 6 },
      `★ ${snap.title}${snap.rareza ? `  ·  rareza ${snap.rareza}` : ''}`));
  }
  if (tiles.length > 0) {
    inner.push(h('div', { display: 'flex', gap: 18, marginTop: 28 }, ...tiles));
  } else {
    inner.push(h('div', { display: 'flex', fontSize: 28, fontWeight: 700, color: 'rgba(255,255,255,0.7)', marginTop: 34 },
      'Mi pasaporte de Cartagena acaba de empezar'));
  }
  if (bits.length > 0) {
    inner.push(h('div', { display: 'flex', fontSize: 22, fontWeight: 700, color: 'rgba(255,255,255,0.75)', marginTop: 22 }, bits.join('   ·   ')));
  }
  if (venues.length > 0) {
    inner.push(h('div', { display: 'flex', fontSize: 19, fontWeight: 700, color: 'rgba(212,175,55,0.85)', marginTop: 12 }, venues.join('  ·  ')));
  }
  inner.push(
    h('div', { display: 'flex', alignItems: 'center', gap: 12, marginTop: 30 },
      h('div', { display: 'flex', fontSize: 26, fontWeight: 800, color: GOLD, letterSpacing: 2 }, 'AMO'),
      { type: 'img', props: { src: HEART_DATA_URI, width: 30, height: 30, style: {} } },
      h('div', { display: 'flex', fontSize: 26, fontWeight: 800, color: GOLD, letterSpacing: 2 }, 'CARTAGENA'),
      h('div', { display: 'flex', fontSize: 20, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginLeft: 6 }, 'amocartagena.co'),
    ),
  );

  return h('div', {
    width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#07070B',
    backgroundImage: 'radial-gradient(circle at 50% 35%, rgba(212,175,55,0.12) 0%, rgba(212,175,55,0.03) 45%, rgba(0,0,0,0) 75%)',
  },
    h('div', {
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', width: 1140, height: 570, borderRadius: 28,
      border: `3px solid ${GOLD}`, padding: '30px 40px',
    }, ...inner),
  );
}

export default async function handler(req: any, res: any) {
  try {
    const id = String(req.query?.id || '');
    if (!/^shr_[a-f0-9]{6,20}$/.test(id)) {
      res.status(404).send('not found');
      return;
    }
    const snapRes = await fetch(`${BACKEND}/api/passport/share/${id}`);
    if (!snapRes.ok) {
      res.status(404).send('not found');
      return;
    }
    const snap = await snapRes.json();

    const svg = await satori(card(snap) as any, {
      width: 1200,
      height: 630,
      fonts: [
        { name: 'Manrope', data: FONT_700, weight: 700, style: 'normal' },
        { name: 'Manrope', data: FONT_800, weight: 800, style: 'normal' },
      ],
    });
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, immutable');
    res.status(200).send(Buffer.from(png));
  } catch (err: any) {
    console.error('[share-card]', err?.message || err);
    res.status(500).send('card render failed');
  }
}
