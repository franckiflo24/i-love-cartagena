#!/usr/bin/env python3
"""Shrink self-hosted photos to phone weight (in place, idempotent).

  python3 scripts/optimize-images.py [--dry-run] [--max 1400] [--quality 82]

Every JPEG under frontend/public/images/ larger than 250 KB or longer than --max px
on its long edge is resized to fit --max px and re-saved as a progressive JPEG at
--quality with EXIF stripped. Files already within limits are left untouched, so the
script can run after every photo drop. Prints before/after totals.
"""
import argparse, os, sys
from PIL import Image, ImageOps

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "public", "images")
LIMIT_BYTES = 250_000

def main() -> int:
    ap = argparse.ArgumentParser(); ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--max", type=int, default=1400); ap.add_argument("--quality", type=int, default=82)
    a = ap.parse_args()
    before = after = 0; touched = 0; skipped = 0; failed = []
    for dp, _, fns in os.walk(ROOT):
        for fn in fns:
            if not fn.lower().endswith((".jpg", ".jpeg")): continue
            p = os.path.join(dp, fn); size = os.path.getsize(p); before += size
            try:
                with Image.open(p) as im:
                    w, h = im.size
                    if size <= LIMIT_BYTES and max(w, h) <= a.max:
                        after += size; skipped += 1; continue
                    im = ImageOps.exif_transpose(im).convert("RGB")
                    if max(w, h) > a.max:
                        im.thumbnail((a.max, a.max), Image.LANCZOS)
                    if a.dry_run:
                        after += size; touched += 1; continue
                    tmp = p + ".tmp"
                    im.save(tmp, "JPEG", quality=a.quality, optimize=True, progressive=True)
                os.replace(tmp, p); after += os.path.getsize(p); touched += 1
            except Exception as e:  # keep the original on any failure
                failed.append(f"{os.path.relpath(p, ROOT)}: {e}"); after += size
    print(f"[optimize-images] {touched} resized/recompressed, {skipped} already fine, {len(failed)} failed | {before/1e6:.1f} MB -> {after/1e6:.1f} MB")
    for f in failed: print("  FAILED", f)
    return 1 if failed else 0

if __name__ == "__main__":
    sys.exit(main())
