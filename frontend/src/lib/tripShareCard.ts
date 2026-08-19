// Drop 10 (10E) → refined Drop 11 (11A2): "Nuestro viaje" trip card on the
// same "wax seals on midnight paper" system as the passport trophy — shared
// frame + seal medallions (days pressed like stamps), Georgia serif display.
// Privacy: trip name, dates, member first names, venue names ONLY.
import { Platform } from 'react-native';
import { drawPassportFrame, drawSeal } from './shareCard';

export interface TripCardData {
  name: string;
  dates?: { start?: string; end?: string } | null;
  members: string[];
  itemsByDay: { day: number | null; names: string[] }[];
}

const W = 1080;
const H = 1350;
const GOLD = '#12B5A5';
const GOLD_BRIGHT = '#FF6B75';
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = 'Manrope, "DM Sans", system-ui, sans-serif';

export async function renderTripCard(data: TripCardData): Promise<Blob | null> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    drawPassportFrame(ctx);

    // Eyebrow
    ctx.textAlign = 'center';
    ctx.fillStyle = GOLD;
    ctx.font = `700 26px ${SANS}`;
    ctx.save();
    (ctx as any).letterSpacing = '8px';
    ctx.fillText('NUESTRO VIAJE A CARTAGENA', W / 2, 148);
    ctx.restore();

    // Trip name in serif
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `56px ${SERIF}`;
    const title = data.name.length > 24 ? data.name.slice(0, 23) + '…' : data.name;
    ctx.fillText(title, W / 2, 230);
    if (data.dates?.start) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = `italic 32px ${SERIF}`;
      ctx.fillText(`${data.dates.start}${data.dates.end ? `  —  ${data.dates.end}` : ''}`, W / 2, 284);
    }
    // Members
    ctx.fillStyle = GOLD_BRIGHT;
    ctx.font = `600 28px ${SANS}`;
    const memberLine = data.members.slice(0, 6).join(' · ');
    ctx.fillText(memberLine.length > 52 ? memberLine.slice(0, 51) + '…' : memberLine, W / 2, 342);

    // Day blocks — each day pressed as a small seal + its plans
    let y = 420;
    const ROTS = [-0.08, 0.06, -0.05, 0.09, -0.07];
    const blocks = data.itemsByDay.slice(0, 4);
    blocks.forEach((block, bi) => {
      if (y > H - 300) return;
      const names = block.names.slice(0, 4);
      const blockH = Math.max(120, 40 + names.length * 48);
      drawSeal(ctx, 160, y + blockH / 2 - 10, 62,
        block.day === null ? '✦' : String(block.day),
        '', ROTS[bi % ROTS.length]);
      ctx.textAlign = 'left';
      ctx.fillStyle = GOLD;
      ctx.font = `700 24px ${SANS}`;
      ctx.fillText(block.day === null ? 'IDEAS' : `DÍA ${block.day}`, 268, y + 18);
      ctx.font = `34px ${SERIF}`;
      names.forEach((nm, i) => {
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        const line = nm.length > 36 ? nm.slice(0, 35) + '…' : nm;
        ctx.fillText(line, 268, y + 66 + i * 48);
      });
      ctx.textAlign = 'center';
      y += blockH + 46;
    });

    // Footer
    ctx.textAlign = 'center';
    ctx.fillStyle = GOLD;
    ctx.font = `800 36px ${SANS}`;
    ctx.fillText('AMO ❤ CARTAGENA', W / 2, 1238);
    ctx.fillStyle = 'rgba(255,255,255,0.48)';
    ctx.font = `600 26px ${SANS}`;
    ctx.fillText('amocartagena.co', W / 2, 1280);

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
