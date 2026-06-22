"""
Geocode all AMO Cartagena partners using Google Places API.
Finds real lat/lng for each business by name search.
"""
import asyncio, json, logging, os
from motor.motor_asyncio import AsyncIOMotorClient
import httpx

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger()

API_KEY = os.environ.get('GOOGLE_API_KEY', '')
FIND_PLACE = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
DEFAULT_LAT, DEFAULT_LNG = 10.4220, -75.5482

async def geocode(client: httpx.AsyncClient, name: str, address: str) -> dict | None:
    """Search Google Places for a business and return lat/lng."""
    query = f"{name} {address}" if "Cartagena" in address else f"{name} Cartagena Colombia"
    try:
        resp = await client.get(FIND_PLACE, params={
            "input": query,
            "inputtype": "textquery",
            "fields": "geometry,formatted_address,name",
            "locationbias": "circle:15000@10.4000,-75.5200",  # Bias to Cartagena area
            "key": API_KEY,
        }, timeout=10)
        data = resp.json()
        if data.get("status") != "OK" or not data.get("candidates"):
            return None
        geo = data["candidates"][0].get("geometry", {}).get("location", {})
        lat = geo.get("lat")
        lng = geo.get("lng")
        if not lat or not lng:
            return None
        # Sanity check — must be within Cartagena area (roughly 10.3-10.5, -75.4 to -75.7)
        if lat < 10.1 or lat > 10.6 or lng < -75.8 or lng > -75.3:
            return None
        addr = data["candidates"][0].get("formatted_address", "")
        return {"lat": lat, "lng": lng, "address": addr}
    except Exception as e:
        return None

async def main():
    mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.environ.get("DB_NAME", "amo_cartagena")
    client_db = AsyncIOMotorClient(mongo_url)
    db = client_db[db_name]

    partners = await db.partners.find({}).to_list(2000)

    # Filter to those needing geocoding
    to_geocode = []
    for p in partners:
        loc = p.get("location", {})
        lat = loc.get("lat", 0)
        lng = loc.get("lng", 0)
        if abs(lat - DEFAULT_LAT) < 0.001 and abs(lng - DEFAULT_LNG) < 0.001:
            to_geocode.append(p)

    log.info(f"Partners needing geocoding: {len(to_geocode)}")
    updated = 0
    failed = 0

    async with httpx.AsyncClient() as client:
        for i in range(0, len(to_geocode), 5):
            batch = to_geocode[i:i+5]
            tasks = [geocode(client, p["name"], p.get("address", "")) for p in batch]
            results = await asyncio.gather(*tasks)

            for p, result in zip(batch, results):
                if result:
                    update = {"location": {"lat": result["lat"], "lng": result["lng"]}}
                    # Also update address if we got a better one from Google
                    if result["address"] and (not p.get("address") or p["address"] == "Cartagena de Indias, Colombia" or p["address"] == "Cartagena de Indias"):
                        update["address"] = result["address"]
                    await db.partners.update_one(
                        {"partner_id": p["partner_id"]},
                        {"$set": update}
                    )
                    updated += 1
                else:
                    failed += 1

            await asyncio.sleep(0.8)
            done = min(i + 5, len(to_geocode))
            if done % 50 == 0 or done == len(to_geocode):
                log.info(f"  Progress: {done}/{len(to_geocode)} ({updated} geocoded, {failed} missed)")

    log.info(f"\nDone! Geocoded: {updated}, Failed: {failed}")
    client_db.close()

if __name__ == "__main__":
    asyncio.run(main())
