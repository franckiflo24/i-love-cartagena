"""
Scrape real images for AMO Cartagena partners.
Strategy:
  1. Fetch partner's website → extract og:image meta tag
  2. If no og:image, try to find first large image on the page
  3. Update MongoDB with the real image URL
  4. Skip partners that already have non-Unsplash images
"""

import asyncio
import json
import re
import sys
import logging
from pathlib import Path

import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import os

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger(__name__)

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
}


def extract_og_image(html: str, base_url: str) -> str | None:
    """Extract og:image from HTML meta tags."""
    patterns = [
        r'<meta[^>]*property=["\']og:image["\'][^>]*content=["\']([^"\']+)["\']',
        r'<meta[^>]*content=["\']([^"\']+)["\'][^>]*property=["\']og:image["\']',
        r'<meta[^>]*name=["\']twitter:image["\'][^>]*content=["\']([^"\']+)["\']',
        r'<meta[^>]*content=["\']([^"\']+)["\'][^>]*name=["\']twitter:image["\']',
    ]
    for pat in patterns:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            url = m.group(1).strip()
            if url.startswith("//"):
                url = "https:" + url
            elif url.startswith("/"):
                url = base_url.rstrip("/") + url
            if url.startswith("http") and any(ext in url.lower() for ext in [".jpg", ".jpeg", ".png", ".webp", "image", "photo", "img", "media", "upload", "cdn"]):
                return url
            if url.startswith("http"):
                return url
    return None


def extract_hero_image(html: str, base_url: str) -> str | None:
    """Try to find a large hero/banner image in the HTML."""
    patterns = [
        r'<img[^>]*class=["\'][^"\']*(?:hero|banner|main|cover|header|feature)[^"\']*["\'][^>]*src=["\']([^"\']+)["\']',
        r'<img[^>]*src=["\']([^"\']+)["\'][^>]*class=["\'][^"\']*(?:hero|banner|main|cover|header|feature)[^"\']*["\']',
        r'background-image:\s*url\(["\']?([^"\')\s]+)["\']?\)',
    ]
    for pat in patterns:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            url = m.group(1).strip()
            if url.startswith("//"):
                url = "https:" + url
            elif url.startswith("/"):
                url = base_url.rstrip("/") + url
            if url.startswith("http") and not any(skip in url.lower() for skip in ["logo", "icon", "favicon", "1x1", "pixel", "blank"]):
                return url
    return None


async def scrape_image(client: httpx.AsyncClient, url: str) -> str | None:
    """Try to get an image from a URL."""
    try:
        resp = await client.get(url, follow_redirects=True, timeout=10)
        if resp.status_code != 200:
            return None
        html = resp.text
        base = str(resp.url).split("?")[0]
        base = "/".join(base.split("/")[:3])

        img = extract_og_image(html, base)
        if img:
            return img

        img = extract_hero_image(html, base)
        if img:
            return img

        return None
    except Exception as e:
        log.debug(f"  Error fetching {url}: {e}")
        return None


async def main():
    client_db = AsyncIOMotorClient(MONGO_URL)
    db = client_db[DB_NAME]

    partners = await db.partners.find({}).to_list(length=2000)
    log.info(f"Total partners: {len(partners)}")

    # Filter to partners with Unsplash images AND a website
    # PROTECTED: Partners with self-hosted images (/images/) are never touched.
    to_scrape = []
    for p in partners:
        img = p.get("image_url", "")
        if img.startswith("/images/"):
            continue
        url = p.get("booking_link") or p.get("website") or ""
        if "unsplash.com" in img and url and url.startswith("http"):
            to_scrape.append(p)

    # Deduplicate by partner_id
    seen_ids = set()
    unique = []
    for p in to_scrape:
        if p["partner_id"] not in seen_ids:
            seen_ids.add(p["partner_id"])
            unique.append(p)
    to_scrape = unique

    log.info(f"Partners with Unsplash placeholder + website: {len(to_scrape)}")

    updated = 0
    failed = 0

    async with httpx.AsyncClient(headers=HEADERS) as client:
        # Process in batches of 10 to avoid overwhelming
        batch_size = 10
        for i in range(0, len(to_scrape), batch_size):
            batch = to_scrape[i:i + batch_size]
            tasks = []
            for p in batch:
                url = p.get("booking_link") or p.get("website")
                tasks.append(scrape_image(client, url))

            results = await asyncio.gather(*tasks, return_exceptions=True)

            for p, result in zip(batch, results):
                url = p.get("booking_link") or p.get("website")
                name = p["name"]
                if isinstance(result, Exception) or not result:
                    log.info(f"  MISS  {name:35s} | {url}")
                    failed += 1
                else:
                    log.info(f"  FOUND {name:35s} | {result[:80]}")
                    await db.partners.update_many(
                        {"name": name, "image_url": {"$regex": "unsplash"}},
                        {"$set": {"image_url": result}},
                    )
                    updated += 1

            # Small delay between batches
            await asyncio.sleep(0.5)

    log.info(f"\nDone! Updated: {updated}, Failed: {failed}, Total scraped: {len(to_scrape)}")
    client_db.close()


if __name__ == "__main__":
    asyncio.run(main())
