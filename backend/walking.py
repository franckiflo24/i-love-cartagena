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
import json
import os
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
_award_points = None
_get_current_business = None

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
    "location": 1, "distance_m": 1, "experience": 1, "gem_rarity": 1,
}


def init(*, db_, check_rate_limit, get_current_user, get_active_pulse_map,
         get_behavioral_pick_ids, award_points=None, get_current_business=None):
    global db, _check_rate_limit, _get_current_user, _get_active_pulse_map, _get_behavioral_pick_ids
    global _award_points, _get_current_business
    db = db_
    _check_rate_limit = check_rate_limit
    _get_current_user = get_current_user
    _get_active_pulse_map = get_active_pulse_map
    _get_behavioral_pick_ids = get_behavioral_pick_ids
    _award_points = award_points
    _get_current_business = get_current_business


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


# Grounded gem narration (A2): one line of WHY from the venue's OWN data —
# experience tagline, first signature dish, or top occasion tag. A gem with
# nothing real to say gets None (generic reveal), never invention. <=15 words.
_TAG_LINES = {
    "sunset_view": "atardeceres que los locales guardan en secreto",
    "rooftop": "un rooftop que los turistas pasan de largo",
    "live_music": "música en vivo de barrio",
    "romantic": "rincón romántico de los cartageneros",
    "budget": "precio de local, no de turista",
}


def _gem_reveal_line(r: Dict[str, Any]) -> Optional[str]:
    exp = (r.get("experience") or "").strip()
    dishes = r.get("signature_dishes") or []
    if exp and len(exp.split()) <= 12:
        return exp[:90]
    if dishes:
        return f"Probá: {str(dishes[0])[:70]}"
    for t in (r.get("tags") or []):
        if t in _TAG_LINES:
            return _TAG_LINES[t]
    return None


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
        is_gem = "local_favorite" in tags
        reveal_line = _gem_reveal_line(r) if is_gem else None
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
            "local_favorite": is_gem or (r["partner_id"] in pick_ids),
            "gem_rarity": r.get("gem_rarity"),
            "reveal_line": reveal_line,
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
    # For type=dish: WHICH plate was tried (sabores key). One check-in fills
    # one plate — never the venue's whole plate list (no fabricated progress).
    plate: Optional[str] = Field(default=None, max_length=40)


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

    # Dish check-ins must name a real plate that THIS venue actually serves.
    if body.type == "dish":
        if not body.plate:
            raise HTTPException(status_code=400, detail="plate required for dish check-in")
        try:
            cols = await _enriched_collections()
        except Exception:
            raise HTTPException(status_code=503, detail="collections unavailable")
        plate_def = next((s for s in cols["sabores"] if s["key"] == body.plate), None)
        if not plate_def:
            raise HTTPException(status_code=400, detail="unknown plate")
        if body.venue_id not in {v["id"] for v in plate_def["venues"]}:
            raise HTTPException(status_code=400, detail="venue does not serve this plate")
    loc = partner.get("location") or {}
    v_lat, v_lng = loc.get("lat"), loc.get("lng")
    if not isinstance(v_lat, (int, float)) or not isinstance(v_lng, (int, float)):
        raise HTTPException(status_code=409, detail="venue has no verified location")

    # ── Honesty gate: claimed venue must be within VERIFY_RADIUS_M ──
    # Linear/large landmarks (Murallas) carry multiple stamp_points in the
    # collections defs — verification is against the NEAREST point, so any
    # spot along the wall stamps, but a hotel room two blocks away does not.
    dist = _haversine_m(body.lat, body.lng, float(v_lat), float(v_lng))
    try:
        defs = _load_defs()
        for pl in defs.get("plazas", []):
            if pl.get("venue_id") == body.venue_id and pl.get("stamp_points"):
                dist = min(
                    _haversine_m(body.lat, body.lng, float(sp[0]), float(sp[1]))
                    for sp in pl["stamp_points"]
                )
                break
    except Exception:
        pass  # defs unavailable → single-point check stands (fail-safe)
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
    dedupe_match: Dict[str, Any] = {"venue_id": body.venue_id, "type": body.type}
    if body.type == "dish":
        discovery["plate"] = body.plate
        dedupe_match["plate"] = body.plate  # same venue, different plate = new stamp
    res = await db.user_passport.update_one(
        {"user_id": user_id,
         "discoveries": {"$not": {"$elemMatch": dedupe_match}}},
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
    """The caller's travel passport + collection progress. Auth required;
    empty default if new — the frontend renders an inviting empty state,
    never fabricated counts (progress comes only from real discoveries)."""
    user = await _get_current_user(request)
    doc = await db.user_passport.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not doc:
        doc = _empty_passport(user["user_id"])
    doc["total_discoveries"] = len(doc.get("discoveries") or [])
    doc["progress"] = await _compute_progress(doc.get("discoveries") or [])
    return doc


# ── Collections (Drop 3) — grounded definitions + progress ───────────
# Definitions live in backend/data/passport_collections.json: 20 plates built
# from verified_research signature dishes (+3-venue grounded dishes) and 12
# landmark records that already existed. Every entry maps to REAL venues —
# a plate without a venue cannot ship (honesty rule I9).

_COLLECTIONS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                 "data", "passport_collections.json")
_collections_cache: Dict[str, Any] = {"data": None, "enriched": None, "at": 0.0}
_COLLECTIONS_TTL = 300.0


def _load_defs() -> Dict[str, Any]:
    if _collections_cache["data"] is None:
        with open(_COLLECTIONS_PATH, "r", encoding="utf-8") as f:
            _collections_cache["data"] = json.load(f)
    return _collections_cache["data"]


async def _enriched_collections() -> Dict[str, Any]:
    """Definitions joined with live venue fields (name/image/coords) and
    neighborhood segmentation. Cached 5 min per instance."""
    now = time.monotonic()
    if _collections_cache["enriched"] and now - _collections_cache["at"] < _COLLECTIONS_TTL:
        return _collections_cache["enriched"]

    defs = _load_defs()
    all_ids = sorted({v for s in defs["sabores"] for v in s["venue_ids"]}
                     | {p["venue_id"] for p in defs["plazas"]})
    found: Dict[str, Dict[str, Any]] = {}
    async for p in db.partners.find(
        {"partner_id": {"$in": all_ids}},
        {"_id": 0, "partner_id": 1, "name": 1, "category": 1, "image_url": 1, "location": 1},
    ):
        found[p["partner_id"]] = p

    def venue_card(vid: str) -> Optional[Dict[str, Any]]:
        p = found.get(vid)
        if not p:
            return None  # venue vanished from catalog → drop, never a broken slot
        loc = p.get("location") or {}
        return {"id": vid, "name": p.get("name"), "category": p.get("category"),
                "image_url": p.get("image_url"), "lat": loc.get("lat"), "lng": loc.get("lng")}

    sabores = []
    for s in defs["sabores"]:
        venues = [v for v in (venue_card(vid) for vid in s["venue_ids"]) if v]
        if venues:
            sabores.append({"key": s["key"], "name": s["name"], "venues": venues})

    plazas = []
    for pl in defs["plazas"]:
        v = venue_card(pl["venue_id"])
        if v:
            plazas.append(v)

    # Neighborhood segmentation over the collection venues (sabores ∪ plazas),
    # nearest-centroid; out-of-range venues are EXCLUDED from denominators so
    # no neighborhood is impossible to complete.
    from local_signals import _nearest_neighborhood
    nbh: Dict[str, List[str]] = {}
    seen: set = set()
    for v in [v for s in sabores for v in s["venues"]] + plazas:
        if v["id"] in seen:
            continue
        seen.add(v["id"])
        slug = _nearest_neighborhood(v.get("lat"), v.get("lng"))
        if slug:
            nbh.setdefault(slug, []).append(v["id"])
    neighborhoods = [{"slug": k, "venue_ids": sorted(vs), "total": len(vs)}
                     for k, vs in sorted(nbh.items(), key=lambda x: -len(x[1]))]

    enriched = {"version": defs.get("version"), "sabores": sabores,
                "plazas": plazas, "neighborhoods": neighborhoods}
    _collections_cache["enriched"] = enriched
    _collections_cache["at"] = now
    return enriched


async def _compute_progress(discoveries: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Real discoveries only. Plate = 'dish' check-in at a mapped venue.
    Plaza = 'visit'. Joya = 'gem' (count, no denominator)."""
    cols = await _enriched_collections()
    dish_ids = {d["venue_id"] for d in discoveries if d.get("type") == "dish"}
    visit_ids = {d["venue_id"] for d in discoveries if d.get("type") == "visit"}
    gem_ids = {d["venue_id"] for d in discoveries if d.get("type") == "gem"}
    any_ids = dish_ids | visit_ids | gem_ids

    # A plate fills ONLY via a check-in that named it (and at a mapped venue).
    plate_stamps = {(d.get("plate"), d["venue_id"]) for d in discoveries
                    if d.get("type") == "dish" and d.get("plate")}
    plates = {s["key"]: any((s["key"], v["id"]) in plate_stamps for v in s["venues"])
              for s in cols["sabores"]}
    plaza_hits = {p["id"]: (p["id"] in visit_ids) for p in cols["plazas"]}
    # Rare gems count DOUBLE toward barrio completion (capped at total)
    rare_ids: set = set()
    if gem_ids:
        async for rp in db.partners.find(
            {"partner_id": {"$in": list(gem_ids)}, "gem_rarity": "rare"},
            {"_id": 0, "partner_id": 1},
        ):
            rare_ids.add(rp["partner_id"])
    nbh = [{"slug": n["slug"], "total": n["total"],
            "discovered": min(n["total"], sum(
                (2 if (vid in gem_ids and vid in rare_ids) else 1)
                for vid in n["venue_ids"] if vid in any_ids))}
           for n in cols["neighborhoods"]]
    return {
        "sabores": {"discovered": sum(plates.values()), "total": len(plates), "plates": plates},
        "plazas": {"discovered": sum(plaza_hits.values()), "total": len(plaza_hits), "venues": plaza_hits},
        "joyas": {"discovered": len(gem_ids)},
        "neighborhoods": nbh,
    }


# ── Share snapshots (Drop 3 fast-follow: OG link unfurls) ────────────
# A snapshot is what the share CARD shows and nothing more: counts, streak,
# top barrio, ≤6 venue names, a first name. NO coordinates, NO location
# history, NO email. user_id is stored internally (data-deletion path) and
# never exposed on the public read.

class ShareBody(BaseModel):
    name: Optional[str] = Field(default=None, max_length=40)


def _snapshot_from_passport(doc: Dict[str, Any], progress: Dict[str, Any],
                            venue_names: List[str], name: Optional[str]) -> Dict[str, Any]:
    nbhs = [n for n in progress.get("neighborhoods", []) if n.get("discovered", 0) > 0]
    top = max(nbhs, key=lambda n: n["discovered"]) if nbhs else None
    return {
        "name": (name or "").strip()[:40] or None,
        "streak_best": int((doc.get("streak") or {}).get("best") or 0),
        "sabores_d": progress["sabores"]["discovered"],
        "sabores_t": progress["sabores"]["total"],
        "plazas_d": progress["plazas"]["discovered"],
        "plazas_t": progress["plazas"]["total"],
        "joyas": progress["joyas"]["discovered"],
        "top_nbh": ({"slug": top["slug"], "d": top["discovered"], "t": top["total"]} if top else None),
        "venues": venue_names[:6],
    }


@router.post("/passport/share")
async def passport_share_create(request: Request, body: ShareBody):
    """Mint a public share snapshot of the caller's passport. Auth required."""
    import uuid as _uuid
    user = await _get_current_user(request)
    user_id = user["user_id"]
    _check_rate_limit(f"pshare:{user_id}", max_calls=20, window_sec=3600)

    doc = await db.user_passport.find_one({"user_id": user_id}, {"_id": 0})
    if not doc:
        doc = _empty_passport(user_id)
    discoveries = doc.get("discoveries") or []
    progress = await _compute_progress(discoveries)

    # Resolve venue display names for the most recent discoveries (≤6)
    recent_ids: List[str] = []
    for d in reversed(discoveries):
        if d["venue_id"] not in recent_ids:
            recent_ids.append(d["venue_id"])
        if len(recent_ids) >= 6:
            break
    names: List[str] = []
    if recent_ids:
        name_map = {}
        async for p in db.partners.find({"partner_id": {"$in": recent_ids}},
                                        {"_id": 0, "partner_id": 1, "name": 1}):
            name_map[p["partner_id"]] = p.get("name") or ""
        names = [name_map[i] for i in recent_ids if name_map.get(i)]

    share_id = f"shr_{_uuid.uuid4().hex[:12]}"
    snapshot = _snapshot_from_passport(doc, progress, names, body.name or (user.get("name") or "").split(" ")[0])
    await db.share_snapshots.insert_one({
        "share_id": share_id,
        "user_id": user_id,  # internal only
        "created_at": datetime.now(timezone.utc).isoformat(),
        **snapshot,
    })
    return {"ok": True, "share_id": share_id, "url": f"https://www.amocartagena.co/pasaporte/share/{share_id}"}


@router.get("/passport/share/{share_id}")
async def passport_share_get(request: Request, share_id: str):
    """PUBLIC: the card-visible fields of a share snapshot. Never user_id."""
    _check_rate_limit(f"pshareget:{_client_ip(request)}", max_calls=60, window_sec=60)
    if not share_id.startswith("shr_") or len(share_id) > 24:
        raise HTTPException(status_code=404, detail="not found")
    doc = await db.share_snapshots.find_one({"share_id": share_id}, {"_id": 0, "user_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="not found")
    return doc


@router.get("/passport/collections")
async def passport_collections():
    """PUBLIC collection definitions (no user data) — powers the guest teaser
    and the passport grids. Venue coords included for 'a 400m' hints."""
    try:
        return await _enriched_collections()
    except Exception as exc:
        logger.error(f"[walking] collections load failed: {exc}")
        raise HTTPException(status_code=500, detail="collections unavailable")


# ═══ TRAILS & QUESTS (Drop 5) ════════════════════════════════════════
# A trail is an ORDERED LENS over passport discoveries: every stop verifies
# through the same 75m server gate as any other discovery — no parallel
# verification machinery. Completion mints a logged, single-use redemption
# code (the Phase-2 attribution unit) and awards AMO points immediately.
# partner_reward slots stay null until a partner actually signs one (I9:
# never an invented promise).

_TRAILS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "data", "trails.json")
_trails_cache: Dict[str, Any] = {"data": None, "enriched": None, "at": 0.0}


def _load_trails() -> Dict[str, Any]:
    if _trails_cache["data"] is None:
        with open(_TRAILS_PATH, "r", encoding="utf-8") as f:
            _trails_cache["data"] = json.load(f)
    return _trails_cache["data"]


async def _enriched_trails() -> List[Dict[str, Any]]:
    now = time.monotonic()
    if _trails_cache["enriched"] and now - _trails_cache["at"] < 300:
        return _trails_cache["enriched"]
    defs = _load_trails()
    all_ids = sorted({s["venue_id"] for t in defs["trails"] for s in t["stops"]})
    found: Dict[str, Dict[str, Any]] = {}
    async for p in db.partners.find(
        {"partner_id": {"$in": all_ids}},
        {"_id": 0, "partner_id": 1, "name": 1, "category": 1, "image_url": 1, "location": 1},
    ):
        found[p["partner_id"]] = p
    out = []
    for t in defs["trails"]:
        stops = []
        for s in t["stops"]:
            v = found.get(s["venue_id"])
            if not v:
                continue  # venue vanished → stop drops, trail shortens, never breaks
            loc = v.get("location") or {}
            stops.append({**s, "name": v.get("name"), "category": v.get("category"),
                          "image_url": v.get("image_url"),
                          "lat": loc.get("lat"), "lng": loc.get("lng")})
        out.append({**t, "stops": stops})
    _trails_cache["enriched"] = out
    _trails_cache["at"] = now
    return out


def _stop_matched(stop: Dict[str, Any], discoveries: List[Dict[str, Any]]) -> bool:
    for d in discoveries:
        if d.get("venue_id") != stop["venue_id"]:
            continue
        if stop["type"] == "dish":
            if d.get("type") == "dish" and d.get("plate") == stop.get("plate"):
                return True
        elif d.get("type") in ("visit", "gem"):
            # a gem reveal at a visit-stop counts — you were physically there
            return True
    return False


def _daily_quest_for(day: str) -> Dict[str, Any]:
    defs = _load_trails()
    pool = defs["daily_quests"]["pool"]
    idx = sum(ord(c) for c in day) % len(pool)  # deterministic per Bogotá day
    return {**pool[idx], "date": day, "points": defs["daily_quests"]["points"]}


@router.get("/trails")
async def trails_public(request: Request):
    """PUBLIC trail definitions with venue cards — the guest teaser."""
    _check_rate_limit(f"trails:{_client_ip(request)}", max_calls=60, window_sec=60)
    return {"trails": await _enriched_trails(),
            "daily_quest": _daily_quest_for(datetime.now(timezone.utc).astimezone(BOGOTA).strftime("%Y-%m-%d"))}


@router.get("/trails/progress")
async def trails_progress(request: Request):
    """Auth: per-trail stop completion computed from real discoveries only."""
    user = await _get_current_user(request)
    doc = await db.user_passport.find_one({"user_id": user["user_id"]}, {"_id": 0}) or {}
    discoveries = doc.get("discoveries") or []
    completions = {c["trail_key"]: c async for c in db.trail_completions.find(
        {"user_id": user["user_id"]}, {"_id": 0})}
    out = []
    for t in await _enriched_trails():
        stops = [{**s, "done": _stop_matched(s, discoveries)} for s in t["stops"]]
        comp = completions.get(t["key"])
        out.append({**t, "stops": stops,
                    "stops_done": sum(1 for s in stops if s["done"]),
                    "completed": bool(comp),
                    "redemption_code": (comp or {}).get("redemption_code"),
                    "redeemed": bool((comp or {}).get("redeemed_at"))})
    today = datetime.now(timezone.utc).astimezone(BOGOTA).strftime("%Y-%m-%d")
    quest = _daily_quest_for(today)
    quest_done = any(
        d.get("type") == "dish" and d.get("plate") == quest["plate"]
        and str(d.get("ts", "")).split("T")[0] == today
        for d in discoveries
    )
    claimed = await db.quest_claims.find_one({"user_id": user["user_id"], "date": today}, {"_id": 1})
    return {"trails": out, "daily_quest": {**quest, "done": quest_done, "claimed": bool(claimed)}}


@router.post("/trails/{trail_key}/complete")
async def trail_complete(request: Request, trail_key: str):
    """All stops verified → mint the completion + single-use redemption code
    + award points. Server recomputes stop matching — the client claims
    nothing the passport can't prove."""
    import uuid as _uuid
    user = await _get_current_user(request)
    user_id = user["user_id"]
    _check_rate_limit(f"trailc:{user_id}", max_calls=10, window_sec=3600)
    trail = next((t for t in await _enriched_trails() if t["key"] == trail_key), None)
    if not trail:
        raise HTTPException(status_code=404, detail="trail not found")
    doc = await db.user_passport.find_one({"user_id": user_id}, {"_id": 0}) or {}
    discoveries = doc.get("discoveries") or []
    missing = [s["venue_id"] for s in trail["stops"] if not _stop_matched(s, discoveries)]
    if missing:
        raise HTTPException(status_code=409, detail=f"stops not yet stamped: {len(missing)} pending")
    existing = await db.trail_completions.find_one(
        {"user_id": user_id, "trail_key": trail_key}, {"_id": 0})
    if existing:
        return {"ok": True, "already_completed": True,
                "redemption_code": existing["redemption_code"],
                "points_awarded": 0}
    code = "AMO-" + _uuid.uuid4().hex[:6].upper()
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.trail_completions.insert_one({
        "completion_id": f"trc_{_uuid.uuid4().hex[:12]}",
        "user_id": user_id, "trail_key": trail_key,
        "completed_at": now_iso, "redemption_code": code,
        "redeemed_at": None, "redeemed_by_business": None,
        "points": trail.get("points", 250),
        "partner_reward": trail.get("partner_reward"),
    })
    points = 0
    if _award_points:
        try:
            await _award_points(db, user_id, trail.get("points", 250), "trail_complete",
                                source_id=trail_key, description=f"Ruta completada: {trail['name']}")
            points = trail.get("points", 250)
        except Exception as exc:
            logger.warning(f"[trails] points award failed: {exc}")
    return {"ok": True, "already_completed": False, "redemption_code": code,
            "points_awarded": points, "partner_reward": trail.get("partner_reward")}


@router.post("/quests/daily/claim")
async def daily_quest_claim(request: Request):
    """Claim today's quest — requires a REAL matching dish discovery today."""
    user = await _get_current_user(request)
    user_id = user["user_id"]
    _check_rate_limit(f"questc:{user_id}", max_calls=10, window_sec=3600)
    today = datetime.now(timezone.utc).astimezone(BOGOTA).strftime("%Y-%m-%d")
    quest = _daily_quest_for(today)
    doc = await db.user_passport.find_one({"user_id": user_id}, {"_id": 0}) or {}
    ok = any(d.get("type") == "dish" and d.get("plate") == quest["plate"]
             and str(d.get("ts", "")).split("T")[0] == today
             for d in (doc.get("discoveries") or []))
    if not ok:
        raise HTTPException(status_code=409, detail="quest not yet completed today")
    res = await db.quest_claims.update_one(
        {"user_id": user_id, "date": today},
        {"$setOnInsert": {"plate": quest["plate"], "claimed_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    if res.upserted_id is None:
        return {"ok": True, "already_claimed": True, "points_awarded": 0}
    points = 0
    if _award_points:
        try:
            await _award_points(db, user_id, quest["points"], "daily_quest",
                                source_id=today, description=f"Quest diario: {quest['text']}")
            points = quest["points"]
        except Exception as exc:
            logger.warning(f"[trails] quest points failed: {exc}")
    return {"ok": True, "already_claimed": False, "points_awarded": points}


@router.post("/business/redemptions/{code}")
async def redeem_code(request: Request, code: str):
    """Partner-side redemption: single-use, logged — the attribution unit
    Phase 2 sells with. Business auth required."""
    if _get_current_business is None:
        raise HTTPException(status_code=503, detail="redemptions unavailable")
    biz = await _get_current_business(request)
    comp = await db.trail_completions.find_one({"redemption_code": code.strip().upper()})
    if not comp:
        raise HTTPException(status_code=404, detail="código no válido")
    if comp.get("redeemed_at"):
        raise HTTPException(status_code=409, detail="código ya canjeado")
    await db.trail_completions.update_one(
        {"_id": comp["_id"]},
        {"$set": {"redeemed_at": datetime.now(timezone.utc).isoformat(),
                  "redeemed_by_business": biz.get("partner_id")}},
    )
    return {"ok": True, "trail_key": comp["trail_key"], "redeemed": True}
