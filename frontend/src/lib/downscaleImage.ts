// Client-side image downscaler — shrinks a picked image to a JPEG that fits under
// the backend's ~500KB base64 cap (server rejects image_base64 > 700_000 chars with
// a 413). The old flow only set the picker `quality`, which does NOT reduce pixel
// dimensions — and on WEB the picker ignores quality entirely and hands back the
// full-resolution original — so real phone photos/flyers (2–8MB) always 413'd.
//
// On web we re-encode via <canvas>: cap the longest edge, then step quality (and,
// if still too big, dimensions) down until the resulting data: URL is safely under
// the cap. On native (no document/canvas) we return the input unchanged — the
// picker `quality` is the only lever there; a resize lib (expo-image-manipulator)
// would be the native follow-up.

// Measured against the FULL `data:image/jpeg;base64,...` string, exactly like the
// server (`len(image_b64)`). Photos now go to Vercel Blob (URL, not inline base64),
// so we keep full quality — target well under the backend cap (~3.8M) + Vercel's
// ~4.5MB function request-body limit. Big source photos still step down to fit.
const TARGET_LEN = 3_500_000;

/** Downscale a data:/blob: image URL to a JPEG under the upload cap. Web only;
 *  returns the input unchanged on native or if it's already small enough. */
export async function downscaleForUpload(
  input: string,
  opts: { maxDim?: number; targetLen?: number } = {},
): Promise<string> {
  const targetLen = opts.targetLen ?? TARGET_LEN;

  // Native / SSR / no canvas → can't resize here.
  if (typeof document === 'undefined' || typeof window === 'undefined') return input;
  // Already under the cap → nothing to do.
  if (input.startsWith('data:') && input.length <= targetLen) return input;

  let img: HTMLImageElement;
  try {
    img = await loadImage(input);
  } catch {
    // Couldn't decode (e.g. tainted/remote) → let the caller/server handle it.
    return input;
  }

  let best = input;
  // Largest → smallest longest-edge; at each size step quality down. Start high
  // (2400px @ 0.9) for full-quality photos; only shrink if a source is huge.
  for (const maxDim of [opts.maxDim ?? 2400, 2000, 1600, 1200, 900]) {
    for (const quality of [0.9, 0.82, 0.72, 0.6, 0.5]) {
      const encoded = drawToJpeg(img, maxDim, quality);
      if (!encoded) continue;
      if (encoded.length <= targetLen) return encoded;
      if (best === input || encoded.length < best.length) best = encoded;
    }
  }
  return best; // best effort — if still over, the server 413 surfaces a clear message
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode failed'));
    img.src = src;
  });
}

function drawToJpeg(img: HTMLImageElement, maxDim: number, quality: number): string | null {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, cw, ch);
  try {
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return null;
  }
}
