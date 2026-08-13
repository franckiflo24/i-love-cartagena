// Perceptual "average hash" (aHash) computed in the browser canvas — the backend
// has no image library, so the client (which already decodes the image to downscale
// it) produces a 64-bit fingerprint the server uses for duplicate/reused-photo
// detection. Scale- and compression-invariant: it downsamples to 8×8 grayscale and
// thresholds each pixel against the mean. Returns 16 hex chars, or '' on native/error.

export async function averageHash(src: string): Promise<string> {
  if (typeof document === 'undefined' || typeof window === 'undefined') return '';
  try {
    const img = await loadImage(src);
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(img, 0, 0, 8, 8);
    const data = ctx.getImageData(0, 0, 8, 8).data;
    const gray: number[] = [];
    for (let i = 0; i < 64; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      gray.push(0.299 * r + 0.587 * g + 0.114 * b);
    }
    const avg = gray.reduce((a, b) => a + b, 0) / 64;
    let hex = '';
    for (let i = 0; i < 64; i += 4) {
      let nibble = 0;
      for (let j = 0; j < 4; j++) nibble = (nibble << 1) | (gray[i + j] >= avg ? 1 : 0);
      hex += nibble.toString(16);
    }
    return hex;
  } catch {
    return '';
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('decode failed'));
    img.src = src;
  });
}
