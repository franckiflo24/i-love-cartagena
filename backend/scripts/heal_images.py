"""
Bulk-validate every image URL across the static dump and swap broken ones
(non-200, timeout, network error) for category-appropriate Unsplash fallbacks.

Runs in parallel with a HEAD request. Re-writes the JSON files in place.

IMAGE PROTECTION: Self-hosted images at /images/ are NEVER replaced unless
--force is passed. This prevents verified, self-hosted images from being
overwritten with Unsplash fallbacks. See: heal_images.py killed 683 images
in pre-launch when url_ok() returned False for relative paths.

Usage:
    python3 backend/scripts/heal_images.py
    python3 backend/scripts/heal_images.py --dry-run
    python3 backend/scripts/heal_images.py --force   # override protection
"""
import json
import sys
import argparse
import concurrent.futures
from pathlib import Path

import urllib.request
import urllib.error

DATA = Path(__file__).resolve().parent.parent.parent / "frontend" / "public" / "data"

# Curated, high-quality Cartagena/category Unsplash fallbacks (verified 200)
CAT_FALLBACK = {
    "restaurant":   "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=80",
    "hotel":        "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200&q=80",
    "bar":          "https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=1200&q=80",
    "club":         "https://images.unsplash.com/photo-1571266028243-d220bc562d12?w=1200&q=80",
    "cafe":         "https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=1200&q=80",
    "spa":          "https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=1200&q=80",
    "wellness":     "https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=1200&q=80",
    "beach_club":   "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=80",
    "activity":     "https://images.unsplash.com/photo-1530541930197-ff16ac917b0e?w=1200&q=80",
    "yacht":        "https://images.unsplash.com/photo-1567899378494-47b22a2ae96a?w=1200&q=80",
    "realestate":   "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1200&q=80",
    "institutional":"https://images.unsplash.com/photo-1486325212027-8081e485255e?w=1200&q=80",
    # event categories
    "concert":      "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1200&q=80",
    "music":        "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1200&q=80",
    "party":        "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&q=80",
    "festival":     "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=1200&q=80",
    "cultural":     "https://images.unsplash.com/photo-1577720580479-7d839d829c73?w=1200&q=80",
    "art":          "https://images.unsplash.com/photo-1577720580479-7d839d829c73?w=1200&q=80",
    "brunch":       "https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?w=1200&q=80",
    "gastronomy":   "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=80",
    "sunset":       "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200&q=80",
    "daypass":      "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1200&q=80",
    "popup":        "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&q=80",
}
GENERIC = "https://images.unsplash.com/photo-1583037189850-1921ae7c6c22?w=1200&q=80"  # Cartagena

# ─── IMAGE PROTECTION ──────────────────────────────────────────────
# Self-hosted images (/images/*) are the source of truth and must
# NEVER be replaced. They are relative paths served by Vercel CDN.
# url_ok() returns False for them (no http:// prefix), which would
# cause this script to classify all 683+ self-hosted images as broken
# and overwrite them with Unsplash. The PROTECTED check prevents this.
# ────────────────────────────────────────────────────────────────────
PROTECTED_PREFIXES = ["/images/"]


def is_protected(url: str) -> bool:
    """Return True if URL is a self-hosted image that must not be replaced."""
    return any(url.startswith(p) for p in PROTECTED_PREFIXES)


def url_ok(url: str, timeout: float = 6.0) -> bool:
    """HEAD (fall back to GET range 0-0) — true if 2xx."""
    if not url or not url.startswith("http"):
        return False
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return 200 <= r.status < 300
    except urllib.error.HTTPError as e:
        if e.code == 405:  # method not allowed — try GET
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Range": "bytes=0-0"})
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    return 200 <= r.status < 300 or r.status == 206
            except Exception:
                return False
        return False
    except Exception:
        return False


def collect_urls_to_check():
    """Return (file, json_path, url) tuples for every image URL field."""
    targets = []

    # partners.json — image_url
    pf = DATA / "partners.json"
    if pf.exists():
        for i, p in enumerate(json.loads(pf.read_text())):
            u = p.get("image_url")
            if u: targets.append((pf, ("[]", i, "image_url"), u, p.get("category")))

    # events.json — image_url
    ef = DATA / "events.json"
    if ef.exists():
        for i, e in enumerate(json.loads(ef.read_text())):
            u = e.get("image_url")
            if u: targets.append((ef, ("[]", i, "image_url"), u, e.get("type") or e.get("category")))

    # events/featured.json
    eff = DATA / "events" / "featured.json"
    if eff.exists():
        for i, e in enumerate(json.loads(eff.read_text())):
            u = e.get("image_url")
            if u: targets.append((eff, ("[]", i, "image_url"), u, e.get("type") or e.get("category")))

    # concerts.json
    cf = DATA / "concerts.json"
    if cf.exists():
        for i, c in enumerate(json.loads(cf.read_text())):
            u = c.get("image_url")
            if u: targets.append((cf, ("[]", i, "image_url"), u, c.get("genre") or "concert"))

    # partner-events.json — flyer_url + partner_image
    pef = DATA / "partner-events.json"
    if pef.exists():
        for i, e in enumerate(json.loads(pef.read_text())):
            for k in ("flyer_url", "partner_image"):
                u = e.get(k)
                if u: targets.append((pef, ("[]", i, k), u, e.get("category")))

    # experiences/featured.json — image_url
    xf = DATA / "experiences" / "featured.json"
    if xf.exists():
        for i, x in enumerate(json.loads(xf.read_text())):
            u = x.get("image_url")
            if u: targets.append((xf, ("[]", i, "image_url"), u, x.get("category")))

    # sponsors.json — logo_url
    sf = DATA / "sponsors.json"
    if sf.exists():
        for i, s in enumerate(json.loads(sf.read_text())):
            for k in ("logo_url", "image_url"):
                u = s.get(k)
                if u: targets.append((sf, ("[]", i, k), u, "institutional"))

    # venues.json — images[]
    vf = DATA / "venues.json"
    if vf.exists():
        for i, v in enumerate(json.loads(vf.read_text())):
            for j, u in enumerate(v.get("images") or []):
                if u: targets.append((vf, ("[]", i, "images", j), u, v.get("type")))

    return targets


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="Override image protection (replace self-hosted images)")
    ap.add_argument("--workers", type=int, default=24)
    args = ap.parse_args()

    targets = collect_urls_to_check()

    # Filter out protected self-hosted images unless --force
    protected_count = 0
    if not args.force:
        filtered = []
        for t in targets:
            url = t[2]
            if is_protected(url):
                protected_count += 1
            else:
                filtered.append(t)
        targets = filtered

    print(f"checking {len(targets)} image URLs across {len({t[0] for t in targets})} files…")
    if protected_count:
        print(f"  PROTECTED: {protected_count} self-hosted images skipped (use --force to override)\n")
    else:
        print()

    # Deduplicate URLs to reduce checks
    unique_urls = list({t[2] for t in targets})
    print(f"  unique URLs: {len(unique_urls)}")

    results: dict[str, bool] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(url_ok, u): u for u in unique_urls}
        for i, fut in enumerate(concurrent.futures.as_completed(futures), 1):
            u = futures[fut]
            results[u] = fut.result()
            if i % 50 == 0:
                bad = sum(1 for v in results.values() if not v)
                print(f"  checked {i}/{len(unique_urls)} ({bad} broken so far)")

    broken_urls = {u for u, ok in results.items() if not ok}
    print(f"\n  broken unique URLs: {len(broken_urls)} / {len(unique_urls)}")

    if not broken_urls:
        print("\n✅ all image URLs returned 200. nothing to heal.")
        return 0

    # Group broken URLs by file + apply fallback
    by_file: dict[Path, list[tuple]] = {}
    for f, path, u, cat in targets:
        if u in broken_urls:
            by_file.setdefault(f, []).append((path, cat, u))

    print(f"\nhealing {sum(len(v) for v in by_file.values())} entries across {len(by_file)} files…\n")

    for f, entries in by_file.items():
        data = json.loads(f.read_text())
        for path, cat, old in entries:
            fallback = CAT_FALLBACK.get(cat or "", GENERIC)
            # Apply path to data
            obj = data
            # path is ('[]', idx, key) or ('[]', idx, key, subidx)
            assert path[0] == "[]"
            obj = obj[path[1]]
            if len(path) == 3:
                obj[path[2]] = fallback
            elif len(path) == 4:
                obj[path[2]][path[3]] = fallback
        if not args.dry_run:
            f.write_text(json.dumps(data, ensure_ascii=False, indent=2))
            print(f"  ✓ healed {f.relative_to(DATA)}  ({len(entries)} entries)")
        else:
            print(f"  [dry] would heal {f.relative_to(DATA)}  ({len(entries)} entries)")

    print("\n✅ done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
