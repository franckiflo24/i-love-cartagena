// Drop 11 (11A) — "Mi Cartagena" share card, rebuilt as a TROPHY.
//
// Design system: "wax seals on midnight paper." Void-black passport page,
// fine double gold rules with deco corner ticks, Georgia serif display over
// Manrope sans, and the stamps rendered as COLLECTED OBJECTS — scalloped
// wax-seal medallions, each slightly rotated as if pressed by hand.
//
// HONESTY (unchanged from Drop 3/8): only REAL proximity-verified data — an
// empty passport renders the inviting-start card (one dashed, waiting seal),
// never a fake trophy. Venue names + counts only; no coordinates, no personal
// data beyond the sharer's chosen name. Zero-stats never render as "0/20".
//
// Share path: navigator.share with the image file; fallback download + link
// on clipboard. Web-only; native no-ops safely.

import { Platform } from 'react-native';

export type CardVariant = 'passport' | 'first_stamp' | 'collection' | 'gem';

export interface ShareCardStats {
  userName?: string | null;
  streakBest: number;
  saboresDiscovered: number;
  saboresTotal: number;
  plazasDiscovered: number;
  plazasTotal: number;
  joyas: number;
  topNeighborhood?: { name: string; discovered: number; total: number } | null;
  recentVenueNames: string[]; // up to ~6, already localized display names
  title?: string | null;      // 8C3 — earned identity title (or nothing)
  rareza?: number;            // 8C3 — computed rarity score
  variant?: CardVariant;      // 11A2 — the achievement this card celebrates
  variantLabel?: string;      // e.g. the completed collection's name
}

const W = 1080;
const H = 1350;
const GOLD = '#F50B1B';
const GOLD_BRIGHT = '#FF6B75';
const GOLD_DIM = 'rgba(245,11,27,0.28)';
const INK = '#07070B';
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = 'Manrope, "DM Sans", system-ui, sans-serif';

/** The passport-page frame: double rule + deco corner ticks + gold dust. */
export function drawPassportFrame(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  const halo = ctx.createRadialGradient(W / 2, 300, 60, W / 2, 420, 1050);
  halo.addColorStop(0, 'rgba(245,11,27,0.13)');
  halo.addColorStop(0.5, 'rgba(245,11,27,0.03)');
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);
  // grain: sparse gold dust, deterministic
  ctx.fillStyle = 'rgba(245,11,27,0.05)';
  for (let i = 0; i < 90; i++) {
    const gx = ((i * 379) % 1013) + 34;
    const gy = ((i * 691) % 1283) + 34;
    ctx.fillRect(gx, gy, 2, 2);
  }
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(44, 44, W - 88, H - 88);
  ctx.strokeStyle = GOLD_DIM;
  ctx.lineWidth = 1;
  ctx.strokeRect(58, 58, W - 116, H - 116);
  // deco corner ticks
  ctx.strokeStyle = GOLD_BRIGHT;
  ctx.lineWidth = 3;
  const t = 26;
  for (const [cx, cy, dx, dy] of [[44, 44, 1, 1], [W - 44, 44, -1, 1], [44, H - 44, 1, -1], [W - 44, H - 44, -1, -1]] as const) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * t, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * t);
    ctx.stroke();
  }
}

/** A wax-seal medallion: scalloped edge, double ring, serif monogram, name. */
export function drawSeal(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  monogram: string, label: string, rotation: number,
  opts?: { dashed?: boolean; accent?: string },
) {
  const accent = opts?.accent || GOLD;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  // scalloped edge — 24 petals
  ctx.beginPath();
  const petals = 24;
  for (let i = 0; i <= petals * 2; i++) {
    const a = (i / (petals * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.93;
    const px = Math.cos(a) * rr;
    const py = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  if (opts?.dashed) {
    ctx.setLineDash([7, 7]);
    ctx.strokeStyle = GOLD_DIM;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    const fill = ctx.createRadialGradient(0, -r * 0.35, r * 0.1, 0, 0, r);
    fill.addColorStop(0, 'rgba(245,11,27,0.20)');
    fill.addColorStop(1, 'rgba(245,11,27,0.05)');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  // inner ring
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.74, 0, Math.PI * 2);
  ctx.strokeStyle = opts?.dashed ? GOLD_DIM : 'rgba(245,212,122,0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // monogram
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = opts?.dashed ? 'rgba(245,11,27,0.4)' : GOLD_BRIGHT;
  ctx.font = `${Math.round(r * 0.82)}px ${SERIF}`;
  ctx.fillText(monogram, 0, r * 0.04);
  ctx.restore();
  // label under seal (not rotated)
  if (label) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.font = `600 25px ${SANS}`;
    const disp = label.length > 17 ? label.slice(0, 16) + '…' : label;
    ctx.fillText(disp, cx, cy + r + 42);
  }
}

/** Small-caps line with side rules: ——— TEXT ——— */
function ruledLine(ctx: CanvasRenderingContext2D, text: string, y: number, color = GOLD) {
  ctx.textAlign = 'center';
  ctx.font = `700 27px ${SANS}`;
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = color;
  ctx.fillText(text, W / 2, y);
  ctx.strokeStyle = GOLD_DIM;
  ctx.lineWidth = 1.5;
  for (const dir of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + dir * (tw / 2 + 26), y - 9);
    ctx.lineTo(W / 2 + dir * (tw / 2 + 96), y - 9);
    ctx.stroke();
  }
}

const VARIANT_EYEBROW: Record<CardVariant, string> = {
  passport: 'PASAPORTE DE CARTAGENA',
  first_stamp: 'MI PRIMER SELLO',
  collection: 'COLECCIÓN COMPLETA',
  gem: 'JOYA ESCONDIDA DESCUBIERTA',
};

export function canShareCard(): boolean {
  return Platform.OS === 'web' && typeof document !== 'undefined';
}

/** Render the trophy → PNG blob. Returns null on any failure (fail-soft). */
export async function renderShareCard(stats: ShareCardStats): Promise<Blob | null> {
  if (!canShareCard()) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const variant: CardVariant = stats.variant || 'passport';

    drawPassportFrame(ctx);

    // ── Eyebrow: what this card celebrates ──
    ctx.textAlign = 'center';
    ctx.fillStyle = GOLD;
    ctx.font = `700 26px ${SANS}`;
    ctx.save();
    (ctx as any).letterSpacing = '8px';
    ctx.fillText(VARIANT_EYEBROW[variant] || VARIANT_EYEBROW.passport, W / 2, 148);
    ctx.restore();
    if (variant === 'collection' && stats.variantLabel) {
      ctx.fillStyle = GOLD_BRIGHT;
      ctx.font = `italic 40px ${SERIF}`;
      ctx.fillText(stats.variantLabel, W / 2, 200);
    }

    // ── Name in serif — the passport holder ──
    const owner = (stats.userName || '').trim();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `52px ${SERIF}`;
    ctx.fillText(owner || 'Mi Cartagena', W / 2, variant === 'collection' && stats.variantLabel ? 268 : 248);

    // ── Earned title — only when real ──
    let y = variant === 'collection' && stats.variantLabel ? 322 : 302;
    if (stats.title) {
      ruledLine(ctx, `✦  ${stats.title.toUpperCase()}  ✦`, y, GOLD_BRIGHT);
      y += 26;
    }

    // ── Hero line in serif: the real numbers, spoken like a sentence ──
    const total = stats.saboresDiscovered + stats.plazasDiscovered + stats.joyas;
    const heroBits: string[] = [];
    if (total > 0) heroBits.push(`${total} ${total === 1 ? 'lugar sellado' : 'lugares sellados'}`);
    if (stats.joyas > 0) heroBits.push(`${stats.joyas} ${stats.joyas === 1 ? 'joya' : 'joyas'}`);
    if (stats.topNeighborhood) heroBits.push(`${stats.topNeighborhood.name} ${stats.topNeighborhood.discovered}/${stats.topNeighborhood.total}`);
    if (heroBits.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.font = `italic 42px ${SERIF}`;
      ctx.fillText(heroBits.join('  ·  '), W / 2, y + 44);
      y += 60;
    }

    // ── THE SEALS — stamps as collected objects ──
    const names = stats.recentVenueNames.slice(0, 6);
    const ROTS = [-0.09, 0.07, -0.05, 0.1, -0.08, 0.05];
    if (names.length > 0) {
      const rows = names.length > 3 ? 2 : 1;
      const perRow = rows === 2 ? Math.ceil(names.length / 2) : names.length;
      const sealR = perRow >= 3 ? 128 : 148;
      const gap = perRow >= 3 ? 42 : 84;
      const y0 = y + 108 + sealR;
      names.forEach((nm, i) => {
        const row = Math.floor(i / perRow);
        const inRow = Math.min(perRow, names.length - row * perRow);
        const thisRowW = inRow * sealR * 2 + (inRow - 1) * gap;
        const x0 = (W - thisRowW) / 2 + sealR;
        const cx = x0 + (i % perRow) * (sealR * 2 + gap);
        const cy = y0 + row * (sealR * 2 + 106);
        drawSeal(ctx, cx, cy, sealR, nm.charAt(0).toUpperCase(), nm, ROTS[i % ROTS.length]);
      });
      y = y0 + (rows - 1) * (sealR * 2 + 106) + sealR + 84;
    } else {
      // inviting-start: one dashed seal, waiting for its first press
      drawSeal(ctx, W / 2, y + 250, 150, '✦', '', 0, { dashed: true });
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = `italic 44px ${SERIF}`;
      ctx.fillText('Mi pasaporte acaba de empezar.', W / 2, y + 500);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = `600 30px ${SANS}`;
      ctx.fillText('Cada sello se gana caminando la ciudad.', W / 2, y + 552);
      y += 610;
    }

    // ── Ledger line: streak + rareza — real numbers only ──
    const ledger: string[] = [];
    if (stats.streakBest > 1) ledger.push(`racha de ${stats.streakBest} días`);
    if (stats.rareza && stats.rareza > 0) ledger.push(`rareza ✦ ${stats.rareza}`);
    if (ledger.length) {
      ruledLine(ctx, ledger.join('   ·   ').toUpperCase(), Math.min(y + 8, 1182), 'rgba(245,212,122,0.9)');
    }

    // ── Footer brand ──
    ctx.fillStyle = GOLD;
    ctx.font = `800 36px ${SANS}`;
    ctx.fillText('AMO ❤ CARTAGENA', W / 2, 1238);
    ctx.fillStyle = 'rgba(255,255,255,0.48)';
    ctx.font = `600 26px ${SANS}`;
    ctx.fillText('amocartagena.co', W / 2, 1280);

    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'),
    );
  } catch {
    return null;
  }
}

/** Share the card (+ optional unfurl link). Returns 'shared' | 'downloaded' | 'failed'. */
export async function shareCard(
  stats: ShareCardStats,
  shareUrl?: string | null,
): Promise<'shared' | 'downloaded' | 'failed'> {
  const blob = await renderShareCard(stats);
  if (!blob) return 'failed';
  const text = shareUrl
    ? `Mi pasaporte de Cartagena — ${shareUrl}`
    : 'Mi pasaporte de Cartagena — amocartagena.co';
  try {
    const file = new File([blob], 'mi-cartagena.png', { type: 'image/png' });
    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    if (nav?.canShare && nav.canShare({ files: [file] })) {
      await nav.share({ files: [file], title: 'Mi Cartagena', text });
      return 'shared';
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') return 'shared'; // user closed the sheet — not a failure
  }
  try {
    if (shareUrl) {
      try {
        await (navigator as any)?.clipboard?.writeText?.(shareUrl);
      } catch {}
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mi-cartagena.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}
