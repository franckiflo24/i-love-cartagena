// Drop 10 (10E) — "Nuestro viaje" share card. Same brand system + share path
// as the passport card (shareCard.ts): dark/gold canvas 1080×1350, image-first.
// Privacy: trip name, dates, member first names, venue names ONLY — never
// coordinates, never emails, never user ids.
import { Platform } from 'react-native';

export interface TripCardData {
  name: string;
  dates?: { start?: string; end?: string } | null;
  members: string[];
  itemsByDay: { day: number | null; names: string[] }[];
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

export async function renderTripCard(data: TripCardData): Promise<Blob | null> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const sans = 'Manrope, "DM Sans", system-ui, sans-serif';

    ctx.fillStyle = '#07070B';
    ctx.fillRect(0, 0, W, H);
    const grad = ctx.createRadialGradient(W / 2, 260, 80, W / 2, 260, 900);
    grad.addColorStop(0, 'rgba(212,175,55,0.14)');
    grad.addColorStop(1, 'rgba(212,175,55,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Header
    ctx.fillStyle = GOLD;
    ctx.font = `600 34px ${sans}`;
    ctx.textAlign = 'center';
    ctx.fillText('NUESTRO VIAJE', W / 2, 120);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 64px ${sans}`;
    const title = data.name.length > 26 ? data.name.slice(0, 25) + '…' : data.name;
    ctx.fillText(title, W / 2, 205);
    if (data.dates?.start) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `500 30px ${sans}`;
      ctx.fillText(`${data.dates.start}${data.dates.end ? `  →  ${data.dates.end}` : ''}`, W / 2, 258);
    }

    // Members
    ctx.fillStyle = GOLD_BRIGHT;
    ctx.font = `600 28px ${sans}`;
    const memberLine = data.members.slice(0, 6).join(' · ');
    ctx.fillText(memberLine.length > 52 ? memberLine.slice(0, 51) + '…' : memberLine, W / 2, 316);

    // Day blocks
    let y = 390;
    ctx.textAlign = 'left';
    for (const block of data.itemsByDay.slice(0, 5)) {
      if (y > H - 260) break;
      roundRect(ctx, 70, y, W - 140, 54 + block.names.length * 46, 22);
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(212,175,55,0.28)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = GOLD;
      ctx.font = `700 30px ${sans}`;
      ctx.fillText(block.day === null ? 'IDEAS' : `DÍA ${block.day}`, 100, y + 44);
      ctx.font = `500 30px ${sans}`;
      let iy = y + 90;
      for (const nm of block.names) {
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        const line = nm.length > 40 ? nm.slice(0, 39) + '…' : nm;
        ctx.fillText(`•  ${line}`, 100, iy);
        iy += 46;
      }
      y += 54 + block.names.length * 46 + 26;
    }

    // Footer brand
    ctx.textAlign = 'center';
    ctx.fillStyle = GOLD;
    ctx.font = `800 40px ${sans}`;
    ctx.fillText('AMO CARTAGENA', W / 2, H - 110);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `500 28px ${sans}`;
    ctx.fillText('amocartagena.co', W / 2, H - 64);

    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  } catch {
    return null;
  }
}

/** Share the trip card. Returns 'shared' | 'downloaded' | 'failed'. */
export async function shareTripCard(
  data: TripCardData,
  shareUrl?: string | null,
): Promise<'shared' | 'downloaded' | 'failed'> {
  const blob = await renderTripCard(data);
  if (!blob) return 'failed';
  const text = shareUrl
    ? `Nuestro viaje a Cartagena — ${shareUrl}`
    : 'Nuestro viaje a Cartagena — amocartagena.co';
  try {
    const file = new File([blob], 'nuestro-viaje.png', { type: 'image/png' });
    const nav: any = typeof navigator !== 'undefined' ? navigator : null;
    if (nav?.canShare && nav.canShare({ files: [file] })) {
      await nav.share({ files: [file], title: 'Nuestro viaje', text });
      return 'shared';
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') return 'shared';
  }
  try {
    if (shareUrl) {
      try { await (navigator as any)?.clipboard?.writeText?.(shareUrl); } catch {}
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nuestro-viaje.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}
