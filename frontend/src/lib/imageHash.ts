// Perceptual "difference hash" (dHash) computed in the browser canvas — the backend
// has no image library, so the client (which already decodes the image to downscale
// it) produces a 64-bit fingerprint the server uses for duplicate/reused-photo
// detection. dHash compares each pixel to its right neighbor (gradient direction),
// which distinguishes visually-similar-but-different photos far better than an
// average-hash (a venue's two shots of the same room must NOT collide) while still
// matching a re-uploaded / re-compressed copy of the same image.
// Resize to 9×8 grayscale → 8 comparisons per row × 8 rows = 64 bits → 16 hex chars.
// Returns '' on native/error.

export async function perceptualHash(src: string): Promise<string> {
  if (typeof document === 'undefined' || typeof window === 'undefined') return '';
  try {
    const img = await loadImage(src);
    const canvas = document.createElement('canvas');
    canvas.width = 9;
    canvas.height = 8;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(img, 0, 0, 9, 8);
    const data = ctx.getImageData(0, 0, 9, 8).data;
    const gray = (x: number, y: number) => {
      const i = (y * 9 + x) * 4;
      return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    };
    const bits: number[] = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) bits.push(gray(x, y) > gray(x + 1, y) ? 1 : 0);
    }
    let hex = '';
    for (let i = 0; i < 64; i += 4) {
      let nibble = 0;
      for (let j = 0; j < 4; j++) nibble = (nibble << 1) | bits[i + j];
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
