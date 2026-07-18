"""
Fetch real photos for AMO Cartagena partners using Google Places API.
For each partner: search by name → get photo_reference → build photo URL → update MongoDB.
"""

import asyncio
import json
import logging
import os
import sys
from pathlib import Path

import httpx
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger(__name__)

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
API_KEY = os.environ.get('GOOGLE_API_KEY', '')

PLACES_SEARCH = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
PLACES_PHOTO = "https://maps.googleapis.com/maps/api/place/photo"


async def find_place_photo(client: httpx.AsyncClient, name: str, category: str) -> str | None:
    """Search Google Places for a business and return a photo URL."""
    query = f"{name} {category} Cartagena Colombia"

    try:
        resp = await client.get(PLACES_SEARCH, params={
            "input": query,
            "inputtype": "textquery",
            "fields": "place_id,name,photos",
            "key": API_KEY,
        }, timeout=10)

        data = resp.json()
        if data.get("status") != "OK" or not data.get("candidates"):
            return None

        candidate = data["candidates"][0]
        photos = candidate.get("photos", [])
        if not photos:
            return None

        photo_ref = photos[0]["photo_reference"]
        # Build the photo URL - this redirects to the actual image
        photo_url = f"{PLACES_PHOTO}?maxwidth=800&photo_reference={photo_ref}&key={API_KEY}"

        # Follow the redirect to get the actual CDN URL (so we don't expose API key)
        photo_resp = await client.get(photo_url, follow_redirects=True, timeout=10)
        if photo_resp.status_code == 200:
            final_url = str(photo_resp.url)
            return final_url

        return None

    except Exception as e:
        log.debug(f"  Error for {name}: {e}")
        return None


async def main():
    client_db = AsyncIOMotorClient(MONGO_URL)
    db = client_db[DB_NAME]

    partners = await db.partners.find({}).to_list(length=2000)
    log.info(f"Total partners: {len(partners)}")

    # Only update partners still using unsplash placeholders or category fallbacks
    # PROTECTED: Partners with self-hosted images (/images/) are never touched.
    to_update = []
    seen = set()
    for p in partners:
        img = p.get("image_url", "")
        pid = p["partner_id"]
        name = p["name"]
        # Skip self-hosted images — these are the source of truth
        if img.startswith("/images/"):
            continue
        # Skip if already has a real image (not unsplash)
        if "unsplash.com" not in img and img:
            continue
        # Deduplicate by name
        if name in seen:
            continue
        seen.add(name)
        to_update.append(p)

    log.info(f"Partners needing real photos: {len(to_update)}")

    updated = 0
    failed = 0

    async with httpx.AsyncClient() as client:
        # Process in batches of 5 to respect rate limits
        batch_size = 5
        for i in range(0, len(to_update), batch_size):
            batch = to_update[i:i + batch_size]
            tasks = []
            for p in batch:
                tasks.append(find_place_photo(client, p["name"], p.get("category", "")))

            results = await asyncio.gather(*tasks, return_exceptions=True)

            for p, result in zip(batch, results):
                name = p["name"]
                if isinstance(result, Exception) or not result:
                    log.info(f"  MISS  {name:40s}")
                    failed += 1
                else:
                    log.info(f"  FOUND {name:40s} | {result[:70]}...")
                    # Update ALL partners with this name (handles duplicates)
                    await db.partners.update_many(
                        {"name": name},
                        {"$set": {"image_url": result}},
                    )
                    updated += 1

            # Rate limit: ~5 requests per second
            await asyncio.sleep(1.0)

            # Progress
            done = i + len(batch)
            if done % 25 == 0 or done == len(to_update):
                log.info(f"  --- Progress: {done}/{len(to_update)} ({updated} found, {failed} missed) ---")

    log.info(f"\nDone! Updated: {updated}, Failed: {failed}, Total processed: {len(to_update)}")
    client_db.close()


if __name__ == "__main__":
    asyncio.run(main())
