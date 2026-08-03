"""Walking Layer — proximity API + travel-passport foundation.

GET  /nearby             — venues near a point via the partners 2dsphere index,
                           enriched with live pulse line, signature dish,
                           local-favorite flag and occasion tags. Public,
                           IP-rate-limited, cap 25.
POST /passport/discover  — record a proximity-VERIFIED discovery (visit|dish|gem).
                           Honesty gate: the claimed venue must be within
                           VERIFY_RADIUS_M of the reported position or the claim
                           is rejected — the passport means something.
GET  /passport           — the caller's passport (discoveries, streak, collections).

Privacy: the reported lat/lng is used ONLY for the in-request proximity check and
is never persisted. Passport documents store venue_id + timestamp, not coordinates.
There is no location-history write anywhere in this module.

Fail-soft: /nearby enrichment failures (pulse map, local picks) degrade to the
bare venue list — they never 500 the endpoint.
"""

import asyncio
import logging
import math
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

logger = logging.getLogger("walking")

router = APIRouter()

db = None
_check_rate_limit = None
_get_current_user = None
_get_active_pulse_map = None
_get_behavioral_pick_ids = None

BOGOTA = ZoneInfo("America/Bogota")

NEARBY_CAP = 25
RADIUS_DEFAULT_M = 200
RADIUS_MAX_M = 2000
VERIFY_RADIUS_M = 75  # honesty gate for passport discoveries

DISCOVERY_TYPES = ("visit", "dish", "gem")

# Card projection for /nearby — mirrors occasions.py CARD_FIELDS + geo needs.
_CARD_PROJECTION = {
    "_id": 0, "partner_id": 1, "name": 1, "category": 1, "subcategory": 1,
    "cuisine": 1, "tier": 1, "price_range": 1, "address": 1, "rating": 1,
    "reviews": 1, "image_url": 1, "tags": 1, "signature_dishes": 1,
    "location": 1, "distance_m": 1,
}


def init(*, db_, check_rate_limit, get_current_user, get_active_pulse_map,
         get_behavioral_pick_ids):
    global db, _check_rate_limit, _get_current_user, _get_active_pulse_map, _get_behavioral_pick_ids
    db = db_
    _check_rate_limit = check_rate_limit
    _get_current_user = get_current_user
    _get_active_pulse_map = get_active_pulse_map
    _get_behavioral_pick_ids = get_behavioral_pick_ids


# ── Helpers ──────────────────────────────────────────────────────────

def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _validate_point(lat: float, lng: float):
    if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lng <= 180.0):
        raise HTTPException(status_code=400, detail="lat/lng out of range")
    if lat == 0 and lng == 0:
        raise HTTPException(status_code=400, detail="lat and lng required")


def _client_ip(request: Request) -> str:
    return (request.headers.get("x-forwarded-for") or "").split(",")[0].strip() or "unknown"


# ── GET /nearby ──────────────────────────────────────────────────────

@router.get("/nearby")
async def nearby(request: Request, lat: float, lng: float,
                 radius: int = RADIUS_DEFAULT_M, category: Optional[str] = None):
    """Venues near (lat,lng) sorted by distance, enriched. Public, cap 25."""
    t0 = time.monotonic()
    _validate_point(lat, lng)
    radius = max(10, min(int(radius), RADIUS_MAX_M))
    _check_rate_limit(f"nearby:{_client_ip(request)}", max_calls=60, window_sec=60)

    geo_query: Dict[str, Any] = {
        "$geoNear": {
            # GeoJSON order: [lng, lat] — LONGITUDE FIRST
            "near": {"type": "Point", "coordinates": [lng, lat]},
            "distanceField": "distance_m",
            "maxDistance": float(radius),
            "spherical": True,
            "key": "geo",
        }
    }
    if category:
        geo_query["$geoNear"]["query"] = {"category": category}

    try:
        rows = await db.partners.aggregate([
            geo_query,
            {"$project": _CARD_PROJECTION},
            {"$limit": NEARBY_CAP},
        ]).to_list(NEARBY_CAP)
    except Exception as exc:
        logger.error(f"[walking] geoNear failed: {exc}")
        raise HTTPException(status_code=500, detail="nearby lookup failed")

    ids = [r["partner_id"] for r in rows]

    # Enrichment is fail-soft AND concurrent: a pulse/local-signal hiccup
    # never kills the list, and the two lookups don't serialize.
    pulse_map: Dict[str, Any] = {}
    pick_ids: frozenset = frozenset()
    pulse_res, picks_res = await asyncio.gather(
        _get_active_pulse_map(db, ids),
        _get_behavioral_pick_ids(),
        return_exceptions=True,
    )
    if isinstance(pulse_res, dict):
        pulse_map = pulse_res
    else:
        logger.warning(f"[walking] pulse enrich failed: {pulse_res}")
    if isinstance(picks_res, frozenset):
        pick_ids = picks_res
    else:
        logger.warning(f"[walking] local-pick enrich failed: {picks_res}")

    venues: List[Dict[str, Any]] = []
    for r in rows:
        tags = r.get("tags") or []
        dishes = r.get("signature_dishes") or []
        pulse = pulse_map.get(r["partner_id"])
        loc = r.get("location") or {}
        venues.append({
            "partner_id": r["partner_id"],
            "name": r.get("name"),
            "category": r.get("category"),
            "subcategory": r.get("subcategory"),
            "cuisine": r.get("cuisine"),
            "tier": r.get("tier"),
            "price_range": r.get("price_range"),
            "address": r.get("address"),
            "rating": r.get("rating"),
            "reviews": r.get("reviews"),
            "image_url": r.get("image_url"),
            "lat": loc.get("lat"),
            "lng": loc.get("lng"),
            "distance_m": round(r.get("distance_m", 0)),
            "tags": tags,
            "local_favorite": ("local_favorite" in tags) or (r["partner_id"] in pick_ids),
            "signature_dish": (dishes[0] if dishes else None),
            "pulse": ({k: pulse.get(k) for k in ("type", "title", "details", "start_time", "end_time")}
                      if pulse else None),
        })

    return {"venues": venues, "radius_m": radius, "count": len(venues),
            "took_ms": round((time.monotonic() - t0) * 1000)}


# ── Passport ─────────────────────────────────────────────────────────

class DiscoverBody(BaseModel):
    venue_id: str = Field(min_length=1, max_length=64)
    type: Literal["visit", "dish", "gem"]
    lat: float
    lng: float


def _empty_passport(user_id: str) -> Dict[str, Any]:
    return {
        "user_id": user_id,
        "discoveries": [],
        "streak": {"current": 0, "best": 0, "last_day": None},
        "collections": {},
    }


def _next_streak(streak: Dict[str, Any], today: str) -> Dict[str, Any]:
    """Day-granular streak in Bogota time. Same day: unchanged. Consecutive
    day: +1. Gap (or first ever): reset to 1. best = running max."""
    current = int(streak.get("current") or 0)
    best = int(streak.get("best") or 0)
    last_day = streak.get("last_day")
    if last_day == today:
        new_current = max(current, 1)
    else:
        yesterday = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
        new_current = current + 1 if last_day == yesterday else 1
    return {"current": new_current, "best": max(best, new_current), "last_day": today}


@router.post("/passport/discover")
async def passport_discover(request: Request, body: DiscoverBody):
    """Record a proximity-verified discovery. Auth required (guests get 401 —
    the frontend turns that into a contextual sign-in prompt, never a wall)."""
    user = await _get_current_user(request)
    user_id = user["user_id"]
    _check_rate_limit(f"passport:{user_id}", max_calls=30, window_sec=3600)

    _validate_point(body.lat, body.lng)

    partner = await db.partners.find_one(
        {"partner_id": body.venue_id},
        {"_id": 0, "partner_id": 1, "name": 1, "category": 1, "location": 1},
    )
    if not partner:
        raise HTTPException(status_code=404, detail="venue not found")
    loc = partner.get("location") or {}
    v_lat, v_lng = loc.get("lat"), loc.get("lng")
    if not isinstance(v_lat, (int, float)) or not isinstance(v_lng, (int, float)):
        raise HTTPException(status_code=409, detail="venue has no verified location")

    # ── Honesty gate: claimed venue must be within VERIFY_RADIUS_M ──
    dist = _haversine_m(body.lat, body.lng, float(v_lat), float(v_lng))
    if dist > VERIFY_RADIUS_M:
        raise HTTPException(
            status_code=403,
            detail=f"too far from venue ({round(dist)}m > {VERIFY_RADIUS_M}m) — discovery not recorded",
        )
    # The reported lat/lng is dropped here — never persisted (privacy).

    now = datetime.now(timezone.utc)
    today_bogota = now.astimezone(BOGOTA).strftime("%Y-%m-%d")

    # Ensure the passport doc exists (unique user_id index guards duplicates).
    await db.user_passport.update_one(
        {"user_id": user_id},
        {"$setOnInsert": {**_empty_passport(user_id), "created_at": now.isoformat()},
         "$set": {"updated_at": now.isoformat()}},
        upsert=True,
    )

    # Atomic dedupe: push only if this (venue_id, type) isn't already there.
    discovery = {
        "venue_id": body.venue_id,
        "type": body.type,
        "ts": now.isoformat(),
        "verified_proximity": True,
    }
    res = await db.user_passport.update_one(
        {"user_id": user_id,
         "discoveries": {"$not": {"$elemMatch": {"venue_id": body.venue_id, "type": body.type}}}},
        {"$push": {"discoveries": discovery}},
    )
    already = res.modified_count == 0

    doc = await db.user_passport.find_one({"user_id": user_id}, {"_id": 0})
    streak = doc.get("streak") or _empty_passport(user_id)["streak"]
    if not already:
        streak = _next_streak(streak, today_bogota)
        category = partner.get("category") or "other"
        await db.user_passport.update_one(
            {"user_id": user_id},
            {"$set": {"streak": streak, "updated_at": now.isoformat()},
             "$inc": {f"collections.{category}": 1}},
        )

    return {
        "ok": True,
        "already_discovered": already,
        "discovery": None if already else discovery,
        "venue_name": partner.get("name"),
        "verified_proximity": True,
        "distance_m": round(dist),
        "streak": streak,
        "total_discoveries": len(doc.get("discoveries") or []),
    }


@router.get("/passport")
async def passport_get(request: Request):
    """The caller's travel passport. Auth required; empty default if new."""
    user = await _get_current_user(request)
    doc = await db.user_passport.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not doc:
        doc = _empty_passport(user["user_id"])
    doc["total_discoveries"] = len(doc.get("discoveries") or [])
    return doc
