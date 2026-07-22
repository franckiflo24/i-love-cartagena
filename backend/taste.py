"""Per-user taste engine — Phase 5 of the moat.

Aggregates what a user has actually done (reservations weigh 3, favorites 2,
onboarding interests 1) into affinity maps over the knowledge layers
(tags / cuisines / subcategories / categories). Cached on user_profiles for
an hour; consumed by personalized search boosts, the "Para ti" rail
(GET /api/for-you) and the concierge context.

The switching cost in one sentence: the longer you use AMO, the better it
knows your Cartagena — and a fresh install knows nothing.
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Request

logger = logging.getLogger("taste")

router = APIRouter()

db = None
_get_current_user = None
_get_active_pulse_map = None

TASTE_TTL_MINUTES = 60

CARD_FIELDS = {
    "_id": 0, "partner_id": 1, "name": 1, "category": 1, "subcategory": 1,
    "cuisine": 1, "tier": 1, "price_range": 1, "address": 1, "rating": 1,
    "image_url": 1, "tags": 1, "signature_dishes": 1,
}


def init(*, db_, get_current_user, get_active_pulse_map):
    global db, _get_current_user, _get_active_pulse_map
    db = db_
    _get_current_user = get_current_user
    _get_active_pulse_map = get_active_pulse_map


def _bump(d: Dict[str, float], key: Optional[str], w: float):
    if key and isinstance(key, str):
        d[key] = d.get(key, 0.0) + w


def _top(d: Dict[str, float], n: int) -> Dict[str, float]:
    if not d:
        return {}
    mx = max(d.values())
    if mx <= 0:
        return {}
    return {k: round(v / mx, 3) for k, v in sorted(d.items(), key=lambda x: -x[1])[:n]}


async def build_taste(db_, user_id: str, force: bool = False) -> Dict[str, Any]:
    """Compute (or return cached) taste profile for a user."""
    prof = await db_.user_profiles.find_one(
        {"user_id": user_id}, {"_id": 0, "taste": 1, "taste_at": 1, "interests": 1},
    ) or {}
    if not force and prof.get("taste") and prof.get("taste_at"):
        try:
            age = datetime.now(timezone.utc) - datetime.fromisoformat(prof["taste_at"])
            if age < timedelta(minutes=TASTE_TTL_MINUTES):
                return prof["taste"]
        except Exception:
            pass

    # Signal: partner ids weighted by strength of the action
    weighted_pids: Dict[str, float] = {}
    favs = await db_.favorites.find(
        {"user_id": user_id, "item_type": "partner"}, {"_id": 0, "item_id": 1},
    ).limit(100).to_list(100)
    for f in favs:
        weighted_pids[f["item_id"]] = max(weighted_pids.get(f["item_id"], 0), 2.0)
    try:
        resv = await db_.reservations.find(
            {"user_id": user_id}, {"_id": 0, "partner_id": 1},
        ).limit(50).to_list(50)
        for r in resv:
            if r.get("partner_id"):
                weighted_pids[r["partner_id"]] = max(weighted_pids.get(r["partner_id"], 0), 3.0)
    except Exception:
        pass

    tag_aff: Dict[str, float] = {}
    cuisine_aff: Dict[str, float] = {}
    sub_aff: Dict[str, float] = {}
    cat_aff: Dict[str, float] = {}
    fav_names: List[str] = []

    if weighted_pids:
        partners = await db_.partners.find(
            {"partner_id": {"$in": list(weighted_pids.keys())}},
            {"_id": 0, "partner_id": 1, "name": 1, "category": 1, "subcategory": 1, "cuisine": 1, "tags": 1},
        ).to_list(len(weighted_pids))
        for p in partners:
            w = weighted_pids.get(p["partner_id"], 1.0)
            _bump(cat_aff, p.get("category"), w)
            _bump(sub_aff, p.get("subcategory"), w)
            _bump(cuisine_aff, (p.get("cuisine") or "").lower() or None, w)
            for t in (p.get("tags") or []):
                _bump(tag_aff, t, w)
            if len(fav_names) < 8:
                fav_names.append(p.get("name"))

    # Onboarding interests are category-level, weight 1
    for c in (prof.get("interests") or []):
        _bump(cat_aff, c, 1.0)

    taste = {
        "tags": _top(tag_aff, 8),
        "cuisines": _top(cuisine_aff, 5),
        "subcategories": _top(sub_aff, 6),
        "categories": _top(cat_aff, 5),
        "liked_partners": fav_names,
        "signals": {"favorites": len(favs), "reservations": len(weighted_pids) - len(favs) if len(weighted_pids) > len(favs) else 0},
    }
    now_iso = datetime.now(timezone.utc).isoformat()
    await db_.user_profiles.update_one(
        {"user_id": user_id},
        {"$set": {"taste": taste, "taste_at": now_iso}, "$setOnInsert": {"user_id": user_id, "created_at": now_iso}},
        upsert=True,
    )
    return taste


def taste_boost(partner: Dict[str, Any], taste: Optional[Dict[str, Any]]) -> float:
    """Personal affinity boost for search ranking. Capped at 2.0 so taste
    reorders near-ties but never beats relevance."""
    if not taste:
        return 0.0
    b = 0.0
    tags = taste.get("tags") or {}
    for t in (partner.get("tags") or []):
        b += tags.get(t, 0.0) * 0.5
    b += (taste.get("cuisines") or {}).get((partner.get("cuisine") or "").lower(), 0.0) * 0.8
    b += (taste.get("subcategories") or {}).get(partner.get("subcategory") or "", 0.0) * 0.6
    b += (taste.get("categories") or {}).get(partner.get("category") or "", 0.0) * 0.3
    return min(b, 2.0)


@router.get("/for-you")
async def for_you(request: Request, limit: int = 12):
    """Personalized partner rail. Auth required — taste is per-user."""
    user = await _get_current_user(request)
    user_id = user["user_id"]
    limit = max(4, min(limit, 24))
    taste = await build_taste(db, user_id)

    # Candidates: partners matching the user's top tags/subcategories/categories
    ors = []
    if taste.get("tags"):
        ors.append({"tags": {"$in": list(taste["tags"].keys())}})
    if taste.get("subcategories"):
        ors.append({"subcategory": {"$in": list(taste["subcategories"].keys())}})
    if taste.get("categories"):
        ors.append({"category": {"$in": list(taste["categories"].keys())}})
    if not ors:
        # Cold start: top-rated across the board
        rows = await db.partners.find({}, CARD_FIELDS).sort([("rating", -1), ("reviews", -1)]).limit(limit).to_list(limit)
        return {"partners": rows, "personalized": False}

    cands = await db.partners.find({"$or": ors}, CARD_FIELDS).limit(400).to_list(400)
    scored = sorted(
        cands,
        key=lambda p: taste_boost(p, taste) + (p.get("rating") or 0) * 0.25,
        reverse=True,
    )[:limit]
    try:
        pulse_map = await _get_active_pulse_map(db, [p["partner_id"] for p in scored])
        for p in scored:
            pu = pulse_map.get(p["partner_id"])
            if pu:
                p["live_pulse"] = {k: pu.get(k) for k in ("type", "title", "details", "start_time", "end_time")}
    except Exception as exc:
        logger.warning(f"[taste] pulse attach failed: {exc}")
    return {"partners": scored, "personalized": True, "taste_summary": {
        "tags": list((taste.get("tags") or {}).keys())[:4],
        "cuisines": list((taste.get("cuisines") or {}).keys())[:3],
    }}
