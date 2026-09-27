"""
Regenerate backend/data/public_images.json — the manifest of self-hosted image
paths that ship in frontend/public/images (events, partners, categories, city…).

Why: the backend deploys from backend/ alone (Vercel), so at runtime it cannot
see frontend/public. server._normalize_event_media only emits a synthesized
/images/events/<id>.jpg (or /images/partners/<partner_id>.jpg) when that file is
KNOWN to exist — in production that knowledge comes from this manifest. A stale
manifest fails safe: an event whose image was added after the last sync renders
its category fallback, never a broken/black card. Re-run this whenever files are
added under frontend/public/images, before `cd backend && npx vercel --prod`.

Usage:
    python3 backend/scripts/sync_public_images.py          # (re)write the manifest
    python3 backend/scripts/sync_public_images.py --check  # exit 1 if it is stale
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
PUBLIC = BACKEND.parent / "frontend" / "public"
IMAGES = PUBLIC / "images"
OUT = BACKEND / "data" / "public_images.json"
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif"}


def collect() -> list:
    if not IMAGES.is_dir():
        raise SystemExit(f"[sync_public_images] missing folder: {IMAGES}")
    paths = []
    for dirpath, _dirs, files in os.walk(IMAGES):
        rel = Path(dirpath).relative_to(PUBLIC).as_posix()
        for name in files:
            if name.startswith(".") or Path(name).suffix.lower() not in IMAGE_EXT:
                continue
            paths.append(f"/{rel}/{name}")
    return sorted(paths)


def main() -> int:
    paths = collect()
    if "--check" in sys.argv:
        try:
            current = json.loads(OUT.read_text(encoding="utf-8")).get("paths") or []
        except Exception:
            current = []
        added = sorted(set(paths) - set(current))
        removed = sorted(set(current) - set(paths))
        if added or removed:
            print(f"[sync_public_images] STALE: +{len(added)} / -{len(removed)} vs {OUT.name} — rerun without --check")
            return 1
        print(f"[sync_public_images] up to date ({len(paths)} paths)")
        return 0
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "frontend/public/images",
        "count": len(paths),
        "paths": paths,
    }
    OUT.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[sync_public_images] wrote {len(paths)} paths → {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
