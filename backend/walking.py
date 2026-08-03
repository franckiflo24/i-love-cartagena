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

# ── Drop 8: ranks + achievements (all derived from REAL verified data —
# a medal that can be earned without walking the city cannot exist) ──
RANKS = [
    {"key": "recien_llegado", "name": "Recién Llegado", "icon": "🧳", "min": 0},
    {"key": "caminante", "name": "Caminante", "icon": "👟", "min": 5},
    {"key": "explorador", "name": "Explorador", "icon": "🧭", "min": 15},
    {"key": "conocedor", "name": "Conocedor", "icon": "🗺️", "min": 30},
    {"key": "cartagenero", "name": "Cartagenero de Corazón", "icon": "💛", "min": 60},
]

# Points per verified stamp — the FIRST time only (dedupe upstream).
STAMP_POINTS = {"visit": 10, "dish": 10, "gem": 25}

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
        {"_id": 0, "partner_id": 1, "name": 1, "category": 1, "location": 1, "tags": 1},
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

    # Gem check-ins must be a REAL gem — the exact definition /nearby reveals:
    # editorial local_favorite tag OR a behavioral local pick. Without this
    # gate, a proximity-only 'gem' at any venue forges the 25-pt / 3-rareza
    # stamp and the Cazador de Joyas title (honesty spine: no fake progress).
    if body.type == "gem":
        is_gem = "local_favorite" in (partner.get("tags") or [])
        if not is_gem and _get_behavioral_pick_ids:
            try:
                is_gem = body.venue_id in (await _get_behavioral_pick_ids())
            except Exception:
                pass  # signal unavailable → tag check stands (fail-safe = stricter)
        if not is_gem:
            raise HTTPException(status_code=400, detail="venue is not a gem")
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
    points_earned = 0
    new_achievements: List[Dict[str, Any]] = []
    new_specials: List[Dict[str, Any]] = []
    completed_collections: List[Dict[str, str]] = []
    rank_up = False
    total = len(doc.get("discoveries") or [])
    if not already:
        prev_current = int((doc.get("streak") or {}).get("current") or 0)
        streak = _next_streak(streak, today_bogota)
        category = partner.get("category") or "other"
        await db.user_passport.update_one(
            {"user_id": user_id},
            {"$set": {"streak": streak, "updated_at": now.isoformat()},
             "$inc": {f"collections.{category}": 1}},
        )
        # 1.4: streak-milestone celebration push (value, never guilt) —
        # fail-soft, capped 1/day server-side in webpush.notify_user.
        if streak["current"] in (3, 7, 14, 30) and streak["current"] > prev_current:
            try:
                from webpush import notify_user
                await notify_user(db, user_id,
                                  f"🔥 Racha de {streak['current']} días",
                                  "Tu pasaporte de Cartagena sigue creciendo — hoy sellaste otro día.")
            except Exception as exc:
                logger.warning(f"[walking] milestone push failed: {exc}")

        # Drop 8: every FIRST verified stamp pays real points (fail-soft).
        if _award_points:
            try:
                await _award_points(db, user_id, STAMP_POINTS.get(body.type, 10),
                                    "discovery", source_id=body.venue_id,
                                    description=f"Sello: {partner.get('name') or body.venue_id}")
                points_earned = STAMP_POINTS.get(body.type, 10)
            except Exception as exc:
                logger.warning(f"[walking] stamp points failed: {exc}")

        # Drop 8: rank-up + newly earned medals — celebrated once, client-side.
        rank_up = _rank_for(total)["key"] != _rank_for(total - 1)["key"]
        try:
            progress = await _compute_progress(doc.get("discoveries") or [])
            earned = _discovery_achievements(doc, progress)
            new_achievements = await _persist_new_achievements(user_id, doc, earned)
        except Exception as exc:
            logger.warning(f"[walking] achievements on discover failed: {exc}")

        # Drop 8B: real-window seasonal stamps — venue-anchored where the def
        # names venues (sunset must be AT a sunset venue), city-wide otherwise.
        try:
            new_specials = await _earn_specials(user_id, doc, now.astimezone(BOGOTA), body.venue_id)
        except Exception as exc:
            logger.warning(f"[walking] specials on discover failed: {exc}")

        # Drop 8E1: did THIS stamp complete a collection? (payoff moment)
        try:
            ds_all = doc.get("discoveries") or []
            prev_ds = [d for d in ds_all
                       if not (d.get("venue_id") == discovery["venue_id"]
                               and d.get("type") == discovery["type"]
                               and d.get("plate") == discovery.get("plate"))]
            prog_prev = await _compute_progress(prev_ds)
            prog_now = await _compute_progress(ds_all)
            completed_collections = _collection_completions(prog_prev, prog_now)
        except Exception as exc:
            logger.warning(f"[walking] completion detect failed: {exc}")

    return {
        "ok": True,
        "already_discovered": already,
        "discovery": None if already else discovery,
        "venue_name": partner.get("name"),
        "verified_proximity": True,
        "distance_m": round(dist),
        "streak": streak,
        "total_discoveries": total,
        "points_earned": points_earned,
        "new_achievements": new_achievements,
        "new_specials": new_specials,
        "completed_collections": completed_collections,
        "rank": _rank_for(total),
        "rank_up": rank_up,
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
    total = len(doc.get("discoveries") or [])
    doc["total_discoveries"] = total
    doc["progress"] = await _compute_progress(doc.get("discoveries") or [])
    # Drop 8: rank + medals + honest standing. Extended medals (trails/quests/
    # referrals) are awarded lazily here — the passport reloads after actions.
    doc["rank"] = _rank_for(total)
    try:
        earned = _discovery_achievements(doc, doc["progress"]) | await _extended_achievements(user["user_id"])
        fresh = await _persist_new_achievements(user["user_id"], doc, earned)
        have = dict(doc.get("achievements") or {})
        have.update({a["key"]: a["ts"] for a in fresh})
        doc["achievements"] = have
    except Exception as exc:
        logger.warning(f"[walking] achievements on get failed: {exc}")
        doc.setdefault("achievements", {})
    doc["standing"] = await _explorer_percentile(total)
    # Drop 8C/8D: titles. Drop 8B-data: seasonal stamps with honest window
    # states — suppressed (stale-date) stamps are filtered out entirely.
    doc["titles"] = _titles_for(doc["progress"])
    now_bog = datetime.now(timezone.utc).astimezone(BOGOTA)
    earned_specials = doc.get("special_stamps") or {}
    pulse_active = _load_seasonal().get("pulse_active")
    projected = [_stamp_public(sp, now_bog, earned_specials)
                 for sp in _load_seasonal().get("stamps", [])
                 if not sp.get("pulse_gated") or pulse_active]
    doc["specials"] = [p for p in projected if p]
    doc["season_now"] = _season_now(now_bog)
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
    # Drop 8 — rareza: how IMPRESSIVE the passport is, not just how full.
    # Weights from real discovery difficulty: visit 1 · dish 2 · gem 3 ·
    # RARE gem 8 (Drop 4 rarity tier). Never assigned — always computed.
    rareza = 0
    for d in discoveries:
        t = d.get("type")
        if t == "dish":
            rareza += 2
        elif t == "gem":
            rareza += 8 if d["venue_id"] in rare_ids else 3
        else:
            rareza += 1

    return {
        "sabores": {"discovered": sum(plates.values()), "total": len(plates), "plates": plates},
        "plazas": {"discovered": sum(plaza_hits.values()), "total": len(plaza_hits), "venues": plaza_hits},
        "joyas": {"discovered": len(gem_ids)},
        "neighborhoods": nbh,
        "rareza": rareza,
    }


# ── Drop 8: rank + achievements engine ───────────────────────────────

def _rank_for(total: int) -> Dict[str, Any]:
    """Rank block from total verified stamps: current + next + progress."""
    current = RANKS[0]
    for r in RANKS:
        if total >= r["min"]:
            current = r
    nxt = next((r for r in RANKS if r["min"] > current["min"]), None)
    block: Dict[str, Any] = {"key": current["key"], "name": current["name"],
                             "icon": current["icon"], "min": current["min"], "stamps": total}
    if nxt:
        span = nxt["min"] - current["min"]
        block["next"] = {"key": nxt["key"], "name": nxt["name"], "icon": nxt["icon"], "min": nxt["min"]}
        block["progress"] = min(1.0, round((total - current["min"]) / max(1, span), 3))
    return block


def _bogota_hour(ts: str) -> Optional[int]:
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(BOGOTA).hour
    except Exception:
        return None


def _discovery_achievements(doc: Dict[str, Any], progress: Dict[str, Any]) -> set:
    """Achievement keys earnable from the passport doc alone (cheap — runs on
    every discover). Extended (trails/quests/referrals) checks live in
    _extended_achievements and run on GET only."""
    ds = doc.get("discoveries") or []
    total = len(ds)
    best = int((doc.get("streak") or {}).get("best") or 0)
    sab = progress.get("sabores") or {}
    plz = progress.get("plazas") or {}
    gems = int((progress.get("joyas") or {}).get("discovered") or 0)
    earned: set = set()
    if total >= 1: earned.add("primer_sello")
    if total >= 10: earned.add("diez_sellos")
    if total >= 25: earned.add("veinticinco_sellos")
    if total >= 50: earned.add("cincuenta_sellos")
    if any(d.get("type") == "dish" for d in ds): earned.add("primer_sabor")
    if int(sab.get("discovered") or 0) >= 5: earned.add("cinco_sabores")
    if int(sab.get("discovered") or 0) >= 10: earned.add("diez_sabores")
    if sab.get("total") and sab.get("discovered") == sab.get("total"): earned.add("paladar_maestro")
    if int(plz.get("discovered") or 0) >= 1: earned.add("primera_plaza")
    if plz.get("total") and plz.get("discovered") == plz.get("total"): earned.add("todas_las_plazas")
    if gems >= 1: earned.add("primera_joya")
    if gems >= 3: earned.add("tres_joyas")
    if gems >= 7: earned.add("siete_joyas")
    for n, k in ((3, "racha_3"), (7, "racha_7"), (14, "racha_14"), (30, "racha_30")):
        if best >= n: earned.add(k)
    if any(n.get("total") and n.get("discovered", 0) >= n["total"]
           for n in progress.get("neighborhoods") or []):
        earned.add("barrio_completo")
    for d in ds:
        h = _bogota_hour(d.get("ts") or "")
        if h is None: continue
        if h >= 21 or h < 3: earned.add("noctambulo")
        if 5 <= h < 9: earned.add("madrugador")
    return earned


async def _extended_achievements(user_id: str) -> set:
    """Trail/quest/referral medals — three indexed counts, GET-only."""
    earned: set = set()
    try:
        trail_keys = await db.trail_completions.distinct("trail_key", {"user_id": user_id})
        if len(trail_keys) >= 1: earned.add("primera_ruta")
        if len(trail_keys) >= 4: earned.add("cuatro_rutas")
        if await db.quest_claims.count_documents({"user_id": user_id}) >= 5:
            earned.add("misiones_5")
        if await db.users.count_documents({"referred_by": user_id}) >= 1:
            earned.add("embajador")
    except Exception as exc:
        logger.warning(f"[walking] extended achievements failed: {exc}")
    return earned


async def _persist_new_achievements(user_id: str, doc: Dict[str, Any],
                                    earned: set) -> List[Dict[str, Any]]:
    """Diff earned keys against the stored map; persist + return only NEW ones
    (each with its award timestamp) so the client can celebrate exactly once."""
    have = doc.get("achievements") or {}
    fresh = sorted(earned - set(have.keys()))
    if not fresh:
        return []
    ts = datetime.now(timezone.utc).isoformat()
    await db.user_passport.update_one(
        {"user_id": user_id},
        {"$set": {f"achievements.{k}": ts for k in fresh}},
    )
    return [{"key": k, "ts": ts} for k in fresh]


async def _explorer_percentile(my_total: int) -> Optional[Dict[str, Any]]:
    """Honest standing among explorers with ≥1 verified stamp. Below 20 active
    explorers a 'top X%' is noise — return the real count instead, no fake status."""
    if my_total <= 0:
        return None
    try:
        agg = db.user_passport.aggregate([
            {"$project": {"n": {"$size": {"$ifNull": ["$discoveries", []]}}}},
            {"$match": {"n": {"$gt": 0}}},
            {"$group": {"_id": None, "active": {"$sum": 1},
                        "better": {"$sum": {"$cond": [{"$gt": ["$n", my_total]}, 1, 0]}}}},
        ])
        row = (await agg.to_list(1) or [{}])[0]
        active = int(row.get("active") or 0)
        if active < 20:
            return {"active": active}
        pct = max(1, math.ceil((int(row.get("better") or 0) + 1) / active * 100))
        return {"active": active, "top_pct": pct}
    except Exception as exc:
        logger.warning(f"[walking] percentile failed: {exc}")
        return None


# ── Drop 8C/8D: titles + special (time-real) stamps ──────────────────

_NBH_TITLE_NAMES = {
    "centro": "Centro", "san_diego": "San Diego", "getsemani": "Getsemaní",
    "bocagrande": "Bocagrande", "manga": "Manga", "la_boquilla": "La Boquilla",
}


def _titles_for(progress: Dict[str, Any]) -> Dict[str, Any]:
    """Earned identity titles — computed from real discoveries only, in
    priority order. An empty/thin passport earns NOTHING (no participation
    trophies); the frontend keeps its inviting start state instead."""
    titles: List[Dict[str, str]] = []
    nbhs = progress.get("neighborhoods") or []
    multi = [n for n in nbhs if n.get("discovered", 0) >= 3]
    if len(multi) >= 3:
        titles.append({"key": "trotamundos", "name": "Trotamundos"})
    for n in nbhs:
        # ≥5-venue barrios only — completing a 2-venue "barrio" is not a title
        if n.get("total", 0) >= 5 and n.get("discovered", 0) >= n["total"]:
            pretty = _NBH_TITLE_NAMES.get(n["slug"], n["slug"].replace("_", " ").title())
            titles.append({"key": f"explorador_{n['slug']}", "name": f"Explorador de {pretty}"})
    if int((progress.get("sabores") or {}).get("discovered") or 0) >= 10:
        titles.append({"key": "sibarita", "name": "Sibarita"})
    if int((progress.get("joyas") or {}).get("discovered") or 0) >= 5:
        titles.append({"key": "cazador_joyas", "name": "Cazador de Joyas"})
    return {"all": titles, "primary": titles[0] if titles else None}


# ── Drop 8B-DATA: the Time Engine (seasonal_stamps.json) ─────────────
# Two tiers, enforced here not by hope: 'fixed' recurs forever; 'reverify'
# MUST carry window.valid_until — once now>valid_until the stamp suppresses
# from every user surface and appears only on the admin re-verify list. A
# stamp NEVER renders a passed date as upcoming.
_SEASONAL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                              "data", "seasonal_stamps.json")
_seasonal_cache: Dict[str, Any] = {"data": None}


def _load_seasonal() -> Dict[str, Any]:
    if _seasonal_cache["data"] is None:
        try:
            with open(_SEASONAL_PATH, "r", encoding="utf-8") as f:
                _seasonal_cache["data"] = json.load(f)
        except Exception as exc:
            logger.warning(f"[walking] seasonal defs unavailable: {exc}")
            _seasonal_cache["data"] = {"stamps": [], "pulse_active": False,
                                       "sunset_minutes_by_month": {}}
    return _seasonal_cache["data"]


def _sunset_window_min(now: datetime) -> tuple:
    """(open_from, open_to) in minutes-from-midnight for TODAY's sunset."""
    defs = _load_seasonal()
    base = (defs.get("sunset_minutes_by_month") or {}).get(str(now.month), 1080)
    return base - int(defs.get("sunset_pre_min", 45)), base + int(defs.get("sunset_post_min", 20))


def _hours_open(now: datetime, start: int, end: int) -> bool:
    """Hour window; end<=start means it wraps past midnight (e.g. 16→2)."""
    h = now.hour
    if end > start:
        return start <= h < end
    return h >= start or h < end


def _is_last_sunday(now: datetime) -> bool:
    return now.weekday() == 6 and (now + timedelta(days=7)).month != now.month


def _reverify_expired(sp: Dict[str, Any], now: datetime) -> bool:
    if sp.get("tier") != "reverify":
        return False
    vu = (sp.get("window") or {}).get("valid_until")
    return bool(vu) and now.strftime("%Y-%m-%d") > vu


def _stamp_window_open(sp: Dict[str, Any], now: datetime) -> bool:
    """Is this stamp earnable RIGHT NOW? Real astronomical/clock/date windows.
    Pulse-gated + reverify-expired stamps are never earnable."""
    if sp.get("pulse_gated") and not _load_seasonal().get("pulse_active"):
        return False
    if _reverify_expired(sp, now):
        return False
    w = sp.get("window") or {}
    t = sp.get("type")
    if t == "sunset":
        lo, hi = _sunset_window_min(now)
        m = now.hour * 60 + now.minute
        return lo <= m <= hi
    if t == "venue_hours":
        rec = w.get("recurrence", "daily")
        if rec == "last_sunday_except_jan_dec" and not (_is_last_sunday(now) and now.month not in (1, 12)):
            return False
        hrs = w.get("hours") or [0, 24]
        return _hours_open(now, hrs[0], hrs[1])
    if t == "weekly":
        if now.weekday() not in (w.get("weekdays") or []):
            return False
        hrs = w.get("hours") or [0, 24]
        return _hours_open(now, hrs[0], hrs[1])
    if t == "event_fixed":
        md = now.strftime("%m-%d")
        return w.get("start_md", "99-99") <= md <= w.get("end_md", "00-00")
    if t == "event_annual":
        if not w.get("date_confirmed", True) or not w.get("start") or not w.get("end"):
            return False
        return w["start"] <= now.strftime("%Y-%m-%d") <= w["end"]
    if t == "season":
        m = now.month
        s, e = w.get("start_month"), w.get("end_month")
        if s is None or e is None:
            return False
        return (s <= m <= e) if s <= e else (m >= s or m <= e)
    return False


def _stamp_state(sp: Dict[str, Any], now: datetime, earned: Dict[str, str]) -> str:
    """earned | available_now | upcoming | out_of_window | pasada | suppressed.
    'suppressed' (reverify past valid_until, unearned) is filtered from user
    surfaces entirely — the honesty guard against a stale date. Recurring
    stamps out of window read 'out_of_window'; a finished non-recurring
    edition reads 'pasada' (dated, neutral), NEVER a passed date as upcoming."""
    if sp["id"] in earned:
        return "earned"
    if _reverify_expired(sp, now):
        return "suppressed"
    if _stamp_window_open(sp, now):
        return "available_now"
    t = sp.get("type")
    w = sp.get("window") or {}
    if t in ("sunset", "venue_hours", "weekly"):
        return "out_of_window"          # comes back today / this week
    if t == "season":
        return "upcoming"               # seasons recur every year
    if t == "event_fixed":
        md = now.strftime("%m-%d")
        return "upcoming" if md < w.get("start_md", "99-99") else "upcoming"  # recurs annually
    if t == "event_annual":
        if not w.get("date_confirmed", True):
            return "pasada"             # edition done, next date unconfirmed — never a date
        if w.get("start") and now.strftime("%Y-%m-%d") < w["start"]:
            return "upcoming"
        return "pasada"
    return "out_of_window"


def _stamp_public(sp: Dict[str, Any], now: datetime, earned: Dict[str, str]) -> Optional[Dict[str, Any]]:
    """User-facing projection with an honest display date. Returns None for
    suppressed stamps (never shown to users)."""
    state = _stamp_state(sp, now, earned)
    if state == "suppressed":
        return None
    w = sp.get("window") or {}
    # Display date ONLY when it is a real, non-passed date. event_annual with
    # an unconfirmed next edition carries NO date (prevents a stale-date lie).
    display = None
    if sp.get("type") == "event_fixed":
        display = f"{w.get('start_md')} → {w.get('end_md')}"
    elif sp.get("type") == "event_annual" and w.get("date_confirmed") and state == "upcoming":
        display = f"{w.get('start')} → {w.get('end')}"
    elif sp.get("type") == "season":
        display = None
    return {
        "id": sp["id"],
        "name": sp.get("name_es"),
        "icon": sp.get("icon"),
        "desc": sp.get("desc_es"),
        "type": sp.get("type"),
        "tier": sp.get("tier"),
        "state": state,
        "display_date": display,
        "date_unconfirmed": (sp.get("type") == "event_annual" and not w.get("date_confirmed")),
        "earned_ts": earned.get(sp["id"]),
    }


def _reverify_list(now: datetime) -> List[Dict[str, Any]]:
    """Admin surface: reverify stamps past valid_until that need fresh dates."""
    out = []
    for sp in _load_seasonal().get("stamps", []):
        if _reverify_expired(sp, now):
            out.append({
                "id": sp["id"], "name": sp.get("name_es"),
                "valid_until": (sp.get("window") or {}).get("valid_until"),
                "confirm_source": sp.get("confirm_source"),
                "source": sp.get("source"),
            })
    return out


async def _earn_specials(user_id: str, doc: Dict[str, Any], now_bogota: datetime,
                         venue_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """On a NEW verified stamp: earn any seasonal stamp whose REAL window is
    open now AND (if venue-anchored) whose venues include THIS venue — the
    75m proximity is already gated upstream. Pulse-gated + reverify-expired
    stamps never earn."""
    defs = _load_seasonal()
    have = doc.get("special_stamps") or {}
    fresh: List[Dict[str, Any]] = []
    for sp in defs.get("stamps", []):
        if sp["id"] in have:
            continue
        venues = sp.get("venues")
        if venues and venue_id not in venues:
            continue  # venue-anchored stamp, wrong venue
        if _stamp_window_open(sp, now_bogota):
            ts = datetime.now(timezone.utc).isoformat()
            await db.user_passport.update_one(
                {"user_id": user_id},
                {"$set": {f"special_stamps.{sp['id']}": ts}},
            )
            fresh.append({"key": sp["id"], "name": sp.get("name_es"), "icon": sp.get("icon"), "ts": ts})
    return fresh


def _season_now(now: datetime) -> Optional[Dict[str, Any]]:
    """The current season stamp (for the 'Qué pasa ahora' banner)."""
    for sp in _load_seasonal().get("stamps", []):
        if sp.get("type") == "season" and _stamp_window_open(sp, now):
            return {"id": sp["id"], "name": sp.get("name_es"), "icon": sp.get("icon")}
    return None


def _collection_completions(prev: Dict[str, Any], now: Dict[str, Any]) -> List[Dict[str, str]]:
    """Which collections did THIS stamp complete? Drives the 8E1 payoff
    moment. Compares real progress before/after — no fabricated completions."""
    done: List[Dict[str, str]] = []
    ps, ns = prev.get("sabores") or {}, now.get("sabores") or {}
    if ns.get("total") and ns.get("discovered") == ns.get("total") and ps.get("discovered") != ps.get("total"):
        done.append({"type": "sabores", "name": "Sabores de Cartagena"})
    pp, np_ = prev.get("plazas") or {}, now.get("plazas") or {}
    if np_.get("total") and np_.get("discovered") == np_.get("total") and pp.get("discovered") != pp.get("total"):
        done.append({"type": "plazas", "name": "Plazas y Rincones"})
    prev_nbh = {n["slug"]: n for n in prev.get("neighborhoods") or []}
    for n in now.get("neighborhoods") or []:
        p = prev_nbh.get(n["slug"]) or {}
        # ≥3-venue barrios only — "completing" a 1-venue barrio is not a moment
        if n.get("total", 0) >= 3 and n.get("discovered", 0) >= n["total"] and p.get("discovered", 0) < n["total"]:
            pretty = _NBH_TITLE_NAMES.get(n["slug"], n["slug"].replace("_", " ").title())
            done.append({"type": "barrio", "slug": n["slug"], "name": pretty})
    return done


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
    titles = _titles_for(progress)
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
        # Drop 8C3 — earned identity on the card (or nothing; never flattery)
        "title": (titles.get("primary") or {}).get("name"),
        "rareza": int(progress.get("rareza") or 0),
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


# ═══ PASSPORT GROUPS (Drop 8C2 — opt-in, real participants only) ══════
# A group is a cruise ship, a couple, a crew of friends. Standing is shown
# ONLY to members, only among members, with a handle each member chose.
# There is no city-wide public board, no invented names, no "3 people near
# you are ahead" — the comparison set is exactly who opted in.

class GroupCreateBody(BaseModel):
    name: Optional[str] = Field(default=None, max_length=40)
    handle: str = Field(min_length=2, max_length=24)


class GroupJoinBody(BaseModel):
    code: str = Field(min_length=4, max_length=12)
    handle: str = Field(min_length=2, max_length=24)


async def _group_standings(group: Dict[str, Any], me: str) -> Dict[str, Any]:
    members = await db.group_members.find(
        {"group_id": group["group_id"]}, {"_id": 0, "user_id": 1, "handle": 1},
    ).to_list(100)
    docs = {d["user_id"]: d async for d in db.user_passport.find(
        {"user_id": {"$in": [m["user_id"] for m in members]}},
        {"_id": 0, "user_id": 1, "discoveries": 1},
    )}
    # One batched rare-gem lookup for the whole group (rareza weights)
    gem_ids = {d["venue_id"] for doc in docs.values()
               for d in (doc.get("discoveries") or []) if d.get("type") == "gem"}
    rare_ids: set = set()
    if gem_ids:
        async for rp in db.partners.find(
            {"partner_id": {"$in": list(gem_ids)}, "gem_rarity": "rare"},
            {"_id": 0, "partner_id": 1},
        ):
            rare_ids.add(rp["partner_id"])
    rows = []
    for m in members:
        ds = (docs.get(m["user_id"]) or {}).get("discoveries") or []
        rareza = sum(2 if d.get("type") == "dish"
                     else (8 if d["venue_id"] in rare_ids else 3) if d.get("type") == "gem"
                     else 1 for d in ds)
        rows.append({"handle": m["handle"], "stamps": len(ds), "rareza": rareza,
                     "is_me": m["user_id"] == me})
    rows.sort(key=lambda r: (-r["rareza"], -r["stamps"], r["handle"]))
    return {"group_id": group["group_id"], "name": group.get("name"),
            "code": group["code"], "members": rows, "member_count": len(rows),
            "is_owner": group.get("created_by") == me,
            "share_url": f"https://www.amocartagena.co/pasaporte?join={group['code']}"}


@router.post("/passport/groups")
async def group_create(request: Request, body: GroupCreateBody):
    """Create a group + join it. Returns the shareable code."""
    import uuid as _uuid
    user = await _get_current_user(request)
    _check_rate_limit(f"grpcreate:{user['user_id']}", max_calls=5, window_sec=86400)
    handle = body.handle.strip()
    if len(handle) < 2:
        raise HTTPException(status_code=400, detail="apodo requerido (mín. 2 caracteres)")
    now = datetime.now(timezone.utc).isoformat()
    for _ in range(5):  # unique-code retry
        # 6 hex = 16.7M space — a 4-hex code (65k) is brute-forceable, and
        # guessing it lets a stranger JOIN and read/inject the members-only
        # board, breaking the opt-in privacy guarantee.
        code = "AMOG-" + _uuid.uuid4().hex[:6].upper()
        group = {"group_id": f"grp_{_uuid.uuid4().hex[:10]}", "code": code,
                 "name": (body.name or "").strip()[:40] or None,
                 "created_by": user["user_id"], "created_at": now}
        try:
            await db.passport_groups.insert_one(dict(group))
            break
        except Exception:
            continue
    else:
        raise HTTPException(status_code=500, detail="no se pudo crear el grupo")
    await db.group_members.update_one(
        {"group_id": group["group_id"], "user_id": user["user_id"]},
        {"$setOnInsert": {"handle": handle[:24], "joined_at": now}},
        upsert=True,
    )
    return {"ok": True, "code": group["code"], "group_id": group["group_id"],
            "name": group.get("name"),
            "share_url": f"https://www.amocartagena.co/pasaporte?join={group['code']}"}


@router.post("/passport/groups/join")
async def group_join(request: Request, body: GroupJoinBody):
    user = await _get_current_user(request)
    _check_rate_limit(f"grpjoin:{user['user_id']}", max_calls=10, window_sec=3600)
    handle = body.handle.strip()
    if len(handle) < 2:
        raise HTTPException(status_code=400, detail="apodo requerido (mín. 2 caracteres)")
    code = body.code.strip().upper()
    group = await db.passport_groups.find_one({"code": code}, {"_id": 0})
    if not group:
        raise HTTPException(status_code=404, detail="código de grupo no válido")
    now = datetime.now(timezone.utc).isoformat()
    await db.group_members.update_one(
        {"group_id": group["group_id"], "user_id": user["user_id"]},
        {"$setOnInsert": {"handle": handle[:24], "joined_at": now}},
        upsert=True,
    )
    return {"ok": True, "group_id": group["group_id"], "name": group.get("name")}


@router.post("/passport/groups/{group_id}/leave")
async def group_leave(request: Request, group_id: str):
    """Leave a group. If the last member leaves, the empty group is deleted so
    its code frees up — no orphaned boards."""
    user = await _get_current_user(request)
    res = await db.group_members.delete_one(
        {"group_id": group_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="no perteneces a este grupo")
    remaining = await db.group_members.count_documents({"group_id": group_id})
    if remaining == 0:
        await db.passport_groups.delete_one({"group_id": group_id})
    return {"ok": True, "left": True, "group_deleted": remaining == 0}


@router.get("/passport/groups/mine")
async def groups_mine(request: Request):
    """Standings for every group the caller belongs to. Members only."""
    user = await _get_current_user(request)
    memberships = await db.group_members.find(
        {"user_id": user["user_id"]}, {"_id": 0, "group_id": 1},
    ).to_list(20)
    out = []
    for m in memberships:
        group = await db.passport_groups.find_one({"group_id": m["group_id"]}, {"_id": 0})
        if group:
            out.append(await _group_standings(group, user["user_id"]))
    return {"groups": out}


# ═══ COMMUNITY PRICE SIGNAL (Drop 7F — foundation only) ═══════════════
# Users confirm/flag venue prices. NOTHING is surfaced until a real
# threshold accrues (like the locals gate) — no fake "community verified".

@router.post("/trust/price-flag")
async def price_flag(request: Request):
    user = await _get_current_user(request)
    user_id = user["user_id"]
    _check_rate_limit(f"pflag:{user_id}", max_calls=20, window_sec=3600)
    body = await request.json()
    venue_id = (body.get("venue_id") or "").strip()[:64]
    signal = body.get("signal")
    if not venue_id or signal not in ("precio_correcto", "me_cobraron_de_mas"):
        raise HTTPException(status_code=400, detail="venue_id + signal válido requeridos")
    if not await db.partners.find_one({"partner_id": venue_id}, {"_id": 1}):
        raise HTTPException(status_code=404, detail="venue no encontrado")
    day = datetime.now(timezone.utc).astimezone(BOGOTA).strftime("%Y-%m-%d")
    await db.price_flags.update_one(
        {"user_id": user_id, "venue_id": venue_id, "date": day},
        {"$set": {"signal": signal, "note": (body.get("note") or "")[:200],
                  "at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"ok": True}


_TRUST_PUB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "trust_knowledge.json")
_trust_pub_cache: Dict[str, Any] = {}


@router.get("/trust/reference")
async def trust_reference(request: Request):
    """PUBLIC tiered trust knowledge — powers the 'Cartagena sin sustos'
    sheet and price answers. HIGH entries carry a year; VERIFY entries carry
    ranges + the confirmá hedge. Served verbatim from the seeded file."""
    _check_rate_limit(f"trustref:{_client_ip(request)}", max_calls=60, window_sec=60)
    if not _trust_pub_cache:
        try:
            with open(_TRUST_PUB_PATH, "r", encoding="utf-8") as f:
                _trust_pub_cache.update(json.load(f))
        except Exception as exc:
            logger.error(f"[trust] load failed: {exc}")
            raise HTTPException(status_code=503, detail="trust reference unavailable")
    return {k: _trust_pub_cache[k] for k in ("config", "entries", "safety", "scam_cards") if k in _trust_pub_cache}


# ═══ SEASONAL STAMPS (Drop 8B-data) ══════════════════════════════════

@router.get("/seasonal/now")
async def seasonal_now(request: Request):
    """PUBLIC 'Qué pasa ahora' — current season + which seasonal stamps are
    earnable RIGHT NOW (no auth needed; used by the Home banner). Suppressed
    (stale) stamps are never included."""
    _check_rate_limit(f"seasonal:{_client_ip(request)}", max_calls=60, window_sec=60)
    now = datetime.now(timezone.utc).astimezone(BOGOTA)
    pulse_active = _load_seasonal().get("pulse_active")
    available = []
    for sp in _load_seasonal().get("stamps", []):
        if sp.get("pulse_gated") and not pulse_active:
            continue
        if _stamp_window_open(sp, now):
            available.append({"id": sp["id"], "name": sp.get("name_es"),
                              "icon": sp.get("icon"), "venues": sp.get("venues")})
    return {"season": _season_now(now), "available_now": available,
            "pulse_active": bool(pulse_active)}


@router.get("/admin/stamps/reverify")
async def admin_stamps_reverify(request: Request):
    """ADMIN/CRON — seasonal stamps past their valid_until that need fresh
    official dates. Auth: Bearer CRON_SECRET (same key the Intel dashboard
    uses). This is the surface that keeps 'reverify' honest."""
    secret = os.environ.get("CRON_SECRET", "").strip()
    if not secret or request.headers.get("Authorization", "") != f"Bearer {secret}":
        raise HTTPException(status_code=403, detail="cron secret required")
    now = datetime.now(timezone.utc).astimezone(BOGOTA)
    items = _reverify_list(now)
    return {"count": len(items), "as_of": now.strftime("%Y-%m-%d"), "stamps": items}
