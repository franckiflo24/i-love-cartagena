// Walking Layer Drop 3 — "Mi Cartagena" share card (D009, the distribution loop).
//
// Client-side canvas render: dark + gold AMO brand system, 1080×1350 (4:5 —
// screenshot-worthy on WhatsApp/IG without any link unfurl). The IMAGE is the
// artifact. Privacy: venue names + counts + streak only — never coordinates,
// never location history.
//
// Share path: navigator.share with the image file where supported; fallback
// download + copy-link. Web-only (the live product); native no-ops safely.

import { Platform } from 'react-native';

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
}

const W = 1080;
const H = 1350;
const GOLD = '#D4AF37';
const GOLD_BRIGHT = '#F5D47A';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function canShareCard(): boolean {
  return Platform.OS === 'web' && typeof document !== 'undefined';
}

/** Render the card → PNG blob. Returns null on any failure (fail-soft). */
export async function renderShareCard(stats: ShareCardStats): Promise<Blob | null> {
  if (!canShareCard()) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const sans = 'Manrope, "DM Sans", system-ui, sans-serif';

    // ── Background: void → deep vignette ──
    ctx.fillStyle = '#07070B';
    ctx.fillRect(0, 0, W, H);
    const vg = ctx.createRadialGradient(W / 2, H * 0.35, 120, W / 2, H * 0.45, H * 0.95);
    vg.addColorStop(0, 'rgba(212,175,55,0.10)');
    vg.addColorStop(0.45, 'rgba(212,175,55,0.03)');
    vg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // ── Gold frame ──
    const frameGrad = ctx.createLinearGradient(0, 0, W, H);
    frameGrad.addColorStop(0, GOLD);
    frameGrad.addColorStop(0.5, GOLD_BRIGHT);
    frameGrad.addColorStop(1, GOLD);
    ctx.strokeStyle = frameGrad;
    ctx.lineWidth = 3;
    roundRect(ctx, 36, 36, W - 72, H - 72, 40);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(212,175,55,0.25)';
    ctx.lineWidth = 1;
    roundRect(ctx, 52, 52, W - 104, H - 104, 30);
    ctx.stroke();

    // ── Header: heart + AMO CARTAGENA ──
    ctx.textAlign = 'center';
    ctx.fillStyle = GOLD;
    ctx.font = `700 64px ${sans}`;
    ctx.fillText('❤', W / 2, 175);
    ctx.font = `800 56px ${sans}`;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText('MI CARTAGENA', W / 2, 268);
    ctx.font = `600 26px ${sans}`;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    const owner = (stats.userName || '').trim();
    ctx.fillText(owner ? `el pasaporte de ${owner}` : 'mi pasaporte de viaje', W / 2, 316);
    // 8C3: earned title + rareza — rendered ONLY when real (never flattery)
    if (stats.title) {
      ctx.font = `800 30px ${sans}`;
      ctx.fillStyle = GOLD_BRIGHT;
      ctx.fillText(`★ ${stats.title}${stats.rareza ? `  ·  💠 ${stats.rareza}` : ''}`, W / 2, 362);
    }

    // divider
    ctx.strokeStyle = 'rgba(212,175,55,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 120, 356);
    ctx.lineTo(W / 2 + 120, 356);
    ctx.stroke();

    // ── Stat tiles — zero stats don't render (a brag card, not a shame card)
    const tiles: Array<[string, string]> = [];
    if (stats.saboresDiscovered > 0) tiles.push([`${stats.saboresDiscovered}/${stats.saboresTotal}`, 'SABORES']);
    if (stats.plazasDiscovered > 0) tiles.push([`${stats.plazasDiscovered}/${stats.plazasTotal}`, 'PLAZAS']);
    if (stats.joyas > 0) tiles.push([`${stats.joyas}`, 'JOYAS LOCALES']);
    const tw = 280;
    const n = tiles.length;
    const tx0 = (W - tw * n - 20 * (n - 1)) / 2;
    tiles.forEach(([num, label], i) => {
      const x = tx0 + i * (tw + 20);
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      roundRect(ctx, x, 408, tw, 190, 24);
      ctx.fill();
      ctx.strokeStyle = 'rgba(212,175,55,0.35)';
      ctx.lineWidth = 1.5;
      roundRect(ctx, x, 408, tw, 190, 24);
      ctx.stroke();
      ctx.fillStyle = GOLD_BRIGHT;
      ctx.font = `800 72px ${sans}`;
      ctx.fillText(num, x + tw / 2, 505);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `700 22px ${sans}`;
      ctx.fillText(label, x + tw / 2, 555);
    });

    // ── Streak + neighborhood line ──
    let line = '';
    if (stats.streakBest > 1) line += `🔥 racha de ${stats.streakBest} días`;
    if (stats.topNeighborhood) {
      line += (line ? '   ·   ' : '') +
        `${stats.topNeighborhood.name} ${stats.topNeighborhood.discovered}/${stats.topNeighborhood.total}`;
    }
    if (line) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = `600 32px ${sans}`;
      ctx.fillText(line, W / 2, 678);
    }

    // ── Discovered venues ──
    const names = stats.recentVenueNames.slice(0, 6);
    if (names.length > 0) {
      ctx.fillStyle = 'rgba(212,175,55,0.8)';
      ctx.font = `700 24px ${sans}`;
      ctx.fillText('— DESCUBIERTOS —', W / 2, 768);
      ctx.font = `600 34px ${sans}`;
      names.forEach((n, i) => {
        ctx.fillStyle = i % 2 === 0 ? '#FFFFFF' : 'rgba(255,255,255,0.85)';
        const display = n.length > 38 ? n.slice(0, 37) + '…' : n;
        ctx.fillText(display, W / 2, 828 + i * 56);
      });
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = `600 34px ${sans}`;
      ctx.fillText('Mi pasaporte de Cartagena', W / 2, 820);
      ctx.fillText('acaba de empezar ✨', W / 2, 876);
    }

    // ── Footer brand ──
    ctx.strokeStyle = 'rgba(212,175,55,0.5)';
    ctx.beginPath();
    ctx.moveTo(W / 2 - 120, 1180);
    ctx.lineTo(W / 2 + 120, 1180);
    ctx.stroke();
    ctx.fillStyle = GOLD;
    ctx.font = `800 34px ${sans}`;
    ctx.fillText('AMO ❤ CARTAGENA', W / 2, 1236);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `600 26px ${sans}`;
    ctx.fillText('amocartagena.co', W / 2, 1278);

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
  // Fallback: download the image (+ put the unfurl link on the clipboard)
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
