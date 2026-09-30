#!/usr/bin/env python3
"""
fetch_event_flyers.py — import each EVENTS-ELITE event's OWN official flyer/poster
from its source page and self-host it, so the feed shows a real image instead of a
category placeholder. Honesty spine: only the source's real published image is used
(og:image / twitter:image / JSON-LD image). Nothing is fabricated or AI-generated;
an event whose source exposes no usable image is skipped (stays on its placeholder).

Flow:
  1. Read the working set (event_id + source_url) from --events JSON
     (each row: {event_id, source_url, source_name, ...}).
  2. For each event, fetch the source page and extract the best real image URL.
  3. Download + validate (decodes as an image, >= MIN_W x MIN_H, sane aspect).
  4. Optimize: cover-agnostic downscale to <= MAX_W, progressive JPEG, <= MAX_KB.
  5. Write frontend/public/images/events/<event_id>.jpg.
  6. Print a per-event report and a JSON summary to --out.

The backend serves it automatically: sync_public_images.py registers the path in
the manifest, and events_elite.feed_payload/feed_item synthesise
/images/events/<event_id>.jpg when the manifest ships it (mirrors
server._normalize_event_media for the legacy path). No per-event DB write.

Usage:
    python3 backend/scripts/fetch_event_flyers.py \
        --events /tmp/events_all.json --out /tmp/flyer_report.json [--only DOMAIN] [--force]
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from typing import Optional

from PIL import Image

BACKEND = Path(__file__).resolve().parent.parent
EVENTS_DIR = BACKEND.parent / "frontend" / "public" / "images" / "events"

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
MIN_W, MIN_H = 600, 400      # reject logos / icons / sprites
MAX_W = 1400                 # downscale ceiling
MAX_KB = 160                 # per-file weight target
MIN_ASPECT, MAX_ASPECT = 0.30, 3.60


def _get(url: str, timeout: int = 15) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


class _MetaImg(HTMLParser):
    """Collect og:image / twitter:image / <link rel=image_src> in document order."""
    def __init__(self) -> None:
        super().__init__()
        self.og: list[str] = []
        self.tw: list[str] = []
        self.link: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            prop = (a.get("property") or a.get("name") or "").lower()
            content = a.get("content") or ""
            if not content:
                return
            if prop in ("og:image", "og:image:url", "og:image:secure_url"):
                self.og.append(content)
            elif prop in ("twitter:image", "twitter:image:src"):
                self.tw.append(content)
        elif tag == "link" and (a.get("rel") or "").lower() in ("image_src", "apple-touch-icon"):
            if a.get("href"):
                self.link.append(a["href"])


def _jsonld_images(html: str) -> list[str]:
    out: list[str] = []
    for m in re.finditer(r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
                         html, re.I | re.S):
        try:
            data = json.loads(m.group(1).strip())
        except Exception:
            continue
        stack = [data]
        while stack:
            node = stack.pop()
            if isinstance(node, dict):
                img = node.get("image")
                if isinstance(img, str):
                    out.append(img)
                elif isinstance(img, dict) and isinstance(img.get("url"), str):
                    out.append(img["url"])
                elif isinstance(img, list):
                    for it in img:
                        if isinstance(it, str):
                            out.append(it)
                        elif isinstance(it, dict) and isinstance(it.get("url"), str):
                            out.append(it["url"])
                stack.extend(v for v in node.values() if isinstance(v, (dict, list)))
            elif isinstance(node, list):
                stack.extend(node)
    return out


def _abs(base: str, u: str) -> str:
    if u.startswith("//"):
        return "https:" + u
    if u.startswith("http"):
        return u
    from urllib.parse import urljoin
    return urljoin(base, u)


def candidates(page_url: str) -> list[str]:
    try:
        raw = _get(page_url)
    except Exception as e:
        print(f"    page fetch failed: {type(e).__name__}", file=sys.stderr)
        return []
    html = raw.decode("utf-8", "ignore")
    p = _MetaImg()
    try:
        p.feed(html)
    except Exception:
        pass
    seen: set[str] = set()
    ordered: list[str] = []
    for u in p.og + p.tw + _jsonld_images(html) + p.link:
        au = _abs(page_url, u.strip())
        if au and au not in seen and au.startswith("http"):
            seen.add(au)
            ordered.append(au)
    return ordered


def try_image(url: str) -> Optional[Image.Image]:
    try:
        data = _get(url)
        im = Image.open(io.BytesIO(data))
        im.load()
    except Exception:
        return None
    w, h = im.size
    if w < MIN_W or h < MIN_H:
        return None
    ar = w / h
    if ar < MIN_ASPECT or ar > MAX_ASPECT:
        return None
    return im


def optimize_and_save(im: Image.Image, dest: Path) -> int:
    if im.mode in ("RGBA", "P", "LA"):
        bg = Image.new("RGB", im.size, (17, 17, 17))
        im = im.convert("RGBA")
        bg.paste(im, mask=im.split()[-1])
        im = bg
    else:
        im = im.convert("RGB")
    w, h = im.size
    if w > MAX_W:
        im = im.resize((MAX_W, round(h * MAX_W / w)), Image.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    q = 85
    while q >= 60:
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
        if buf.tell() <= MAX_KB * 1024 or q == 60:
            dest.write_bytes(buf.getvalue())
            return buf.tell()
        q -= 5
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--events", required=True)
    ap.add_argument("--out", default="/tmp/flyer_report.json")
    ap.add_argument("--only", default="", help="only source_urls containing this substring")
    ap.add_argument("--force", action="store_true", help="re-fetch even if the file exists")
    args = ap.parse_args()

    events = json.loads(Path(args.events).read_text())
    report = {"saved": [], "skipped": [], "failed": []}
    for e in events:
        eid = e["event_id"]
        su = e.get("source_url") or ""
        title = (e.get("title") or "")[:40]
        if args.only and args.only not in su:
            continue
        dest = EVENTS_DIR / f"{eid}.jpg"
        if dest.exists() and not args.force:
            report["skipped"].append({"event_id": eid, "why": "exists"})
            print(f"  · exists   {eid}")
            continue
        if not su:
            report["skipped"].append({"event_id": eid, "why": "no source_url"})
            continue
        cand = candidates(su)
        chosen = None
        for cu in cand:
            im = try_image(cu)
            if im is not None:
                chosen = (cu, im)
                break
        if chosen is None:
            report["failed"].append({"event_id": eid, "source_url": su, "n_candidates": len(cand), "title": title})
            print(f"  ✗ NO IMG   {eid}  ({len(cand)} cand)  {title}")
            continue
        cu, im = chosen
        size = optimize_and_save(im, dest)
        report["saved"].append({"event_id": eid, "from": cu, "bytes": size,
                                "credit": e.get("source_name"), "title": title})
        print(f"  ✓ {size//1024:3}KB   {eid}  <- {cu[:60]}")

    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=1))
    print(f"\nSAVED {len(report['saved'])} · FAILED {len(report['failed'])} · SKIPPED {len(report['skipped'])}")
    print(f"report -> {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
