"""Behavioral "Locals recommend" signal.

Aggregates which venues local-type users (user_type='local') actually
favorite, producing a per-partner local signal. A venue qualifies as a
behavioral "Local pick" only once enough distinct locals engage (the
confidence gate) AND — where a tourist baseline exists — locals over-index
there vs their share of all favorites (lift). Below the gate we fall back
to the editorial `local_favorite` tag so the filter is never empty.

Anti-gaming / privacy:
- distinct users only (a single user can't inflate a venue);
- each favorite counts under the user_type stamped AT FAVORITE TIME, so a
  later flip to 'local' via the profile badge does not retroactively count
  (historical favorites with no stamp fall back to the user's current type);
- the MIN_LOCAL_USERS gate doubles as a k-anonymity floor — we expose counts,
  never individuals.
"""

import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger("local_signals")

router = APIRouter()

db = None
_require_admin = None

# ── Confidence gate ──────────────────────────────────────────────────
MIN_LOCAL_USERS = 5      # distinct local users before a venue is a behavioral pick
MIN_LIFT = 1.2           # locals must over-index vs their overall favorite share…
MIN_TOURIST_BASELINE = 10  # …but only once there's enough tourist volume to compare
# Divergence gate (intel panel, spec 3c): a venue must have this many distinct
# locals AND out-index tourists by this ratio before it counts as "locals love,
# tourists miss" — stops a single favorite from manufacturing a false signal.
MIN_DIVERGENCE_LOCALS = 3
MIN_DIVERGENCE_RATIO = 2.0
SIGNAL_COLLECTION = "local_signals"

# Neighborhood centroids (mirror of frontend/public/data/neighborhoods.json).
# Venues have no clean neighborhood field — only lat/lng — so we assign each to
# the nearest centroid. Stable, 10 items; kept here so the serverless backend
# needs no file access.
NEIGHBORHOOD_CENTROIDS: List[Tuple[str, float, float]] = [
    ('centro', 10.4236, -75.5518),
    ('san_diego', 10.4275, -75.549),
    ('getsemani', 10.419, -75.546),
    ('bocagrande', 10.4, -75.556),
    ('laguito', 10.392, -75.561),
    ('castillogrande', 10.396, -75.568),
    ('manga', 10.41, -75.535),
    ('marbella', 10.435, -75.545),
    ('la_boquilla', 10.47, -75.51),
    ('tierrabomba', 10.376, -75.579),
]
# Beyond this rough distance (deg) a point isn't meaningfully "in" any barrio.
_NBH_MAX_DIST = 0.06


def _nearest_neighborhood(lat, lng) -> Optional[str]:
    if lat is None or lng is None:
        return None
    try:
        lat = float(lat); lng = float(lng)
    except (TypeError, ValueError):
        return None
    best, best_d = None, None
    for slug, clat, clng in NEIGHBORHOOD_CENTROIDS:
        d = (lat - clat) ** 2 + (lng - clng) ** 2
        if best_d is None or d < best_d:
            best, best_d = slug, d
    if best_d is not None and best_d ** 0.5 <= _NBH_MAX_DIST:
        return best
    return None


def init(*, db_, require_admin):
    global db, _require_admin
    db = db_
    _require_admin = require_admin


async def _auth(request: Request):
    """Admin user OR the Vercel cron secret (mirrors demand.py)."""
    secret = os.environ.get("CRON_SECRET", "").strip()
    auth_header = request.headers.get("Authorization", "")
    if secret and auth_header == f"Bearer {secret}":
        return {"via": "cron"}
    try:
        user = await _require_admin(request)
        return {"via": "admin", "user_id": user.get("user_id")}
    except HTTPException:
        raise HTTPException(status_code=403, detail="Admin or cron secret required")


# ── Aggregation ──────────────────────────────────────────────────────

async def _user_type_map() -> Dict[str, str]:
    """user_id -> user_type. user_profiles is the source of truth (it wins)."""
    m: Dict[str, str] = {}
    async for u in db.users.find(
        {"user_type": {"$in": ["local", "visitor"]}},
        {"_id": 0, "user_id": 1, "user_type": 1},
    ):
        m[u["user_id"]] = u["user_type"]
    async for p in db.user_profiles.find(
        {"user_type": {"$in": ["local", "visitor"]}},
        {"_id": 0, "user_id": 1, "user_type": 1},
    ):
        m[p["user_id"]] = p["user_type"]
    return m


async def recompute() -> Dict[str, Any]:
    """Rebuild the local_signals collection from partner favorites.

    Per partner: distinct local vs tourist favoriters, and a `lift` =
    (local share of THIS venue's favorites) / (local share of ALL favorites).
    Writes one doc per partner that has any favorite; returns run stats.
    """
    utype = await _user_type_map()

    local_users: Dict[str, set] = {}
    tourist_users: Dict[str, set] = {}

    async for f in db.favorites.find(
        {"item_type": "partner"},
        {"_id": 0, "user_id": 1, "item_id": 1, "user_type": 1},
    ):
        pid = f.get("item_id")
        uid = f.get("user_id")
        if not pid or not uid:
            continue
        # type stamped at favorite time wins; else the user's current type
        t = f.get("user_type") or utype.get(uid)
        if t == "local":
            local_users.setdefault(pid, set()).add(uid)
        elif t == "visitor":
            tourist_users.setdefault(pid, set()).add(uid)

    total_local = sum(len(s) for s in local_users.values())
    total_tourist = sum(len(s) for s in tourist_users.values())
    denom = total_local + total_tourist
    overall = (total_local / denom) if denom else 0.0
    have_baseline = total_tourist >= MIN_TOURIST_BASELINE

    now = datetime.now(timezone.utc).isoformat()
    partner_ids = set(local_users) | set(tourist_users)

    # Assign each signalled venue to its nearest neighborhood (for the intel
    # panel + neighborhood-aware surfaces). One batched location lookup.
    loc_map: Dict[str, Tuple[Any, Any]] = {}
    if partner_ids:
        async for p in db.partners.find(
            {"partner_id": {"$in": list(partner_ids)}},
            {"_id": 0, "partner_id": 1, "location": 1},
        ):
            loc = p.get("location") or {}
            loc_map[p["partner_id"]] = (loc.get("lat"), loc.get("lng"))

    qualifying = 0
    docs: List[Dict[str, Any]] = []
    for pid in partner_ids:
        lc = len(local_users.get(pid, ()))
        tc = len(tourist_users.get(pid, ()))
        venue_share = lc / (lc + tc) if (lc + tc) else 0.0
        lift = (venue_share / overall) if overall else 0.0
        # Raw distinct-local count is the primary evidence. Only demand
        # over-indexing (lift) once a real tourist baseline exists — early on,
        # with few tourists, lift can't discriminate and count is what matters.
        is_pick = lc >= MIN_LOCAL_USERS and ((lift >= MIN_LIFT) if have_baseline else True)
        if is_pick:
            qualifying += 1
        lat, lng = loc_map.get(pid, (None, None))
        docs.append({
            "partner_id": pid,
            "local_count": lc,
            "tourist_count": tc,
            "lift": round(lift, 3),
            "is_local_pick": is_pick,
            "neighborhood": _nearest_neighborhood(lat, lng),
            "updated_at": now,
        })

    # Replace the collection contents wholesale (small, cheap, idempotent)
    await db[SIGNAL_COLLECTION].delete_many({})
    if docs:
        await db[SIGNAL_COLLECTION].insert_many(docs)

    stats = {
        "partners_with_signal": len(docs),
        "behavioral_picks": qualifying,
        "total_local_favs": total_local,
        "total_tourist_favs": total_tourist,
        "overall_local_share": round(overall, 3),
        "lift_gate_active": have_baseline,
        "updated_at": now,
    }
    logger.info(f"[local_signals] recompute: {stats}")
    return stats


# ── Ranking helper ───────────────────────────────────────────────────

# Graded search boost. The boost is ADDITIVE and CAPPED at BOOST_CAP so it is a
# tiebreaker-plus, never an override: it sits below category-match, CTR, and
# pulse weights, so an intent/relevance match always wins. Strength scales with
# distinct local favoriters (more-loved venues nudge a touch higher), saturating
# at the cap. Empty map at cold start ⇒ exact no-op.
# Cap is deliberately BELOW one relevance tier (a field-weight step in
# _score_partner is >= 1.0), so the boost can only reorder genuine near-ties
# among already-on-intent venues — it can NEVER cross a full relevance step,
# and the min_score gate already bars off-intent venues before any boost. This
# keeps it a true tiebreaker-plus (2b): relevance always wins.
BOOST_CAP = 0.5
BOOST_PER_LOCAL = 0.05  # ×local_count, capped at BOOST_CAP (cap reached at 10 locals)

_pick_cache: Dict[str, Any] = {"map": {}, "loaded_at": 0.0}


async def _load_pick_map(ttl: float) -> Dict[str, int]:
    now = time.monotonic()
    if _pick_cache["loaded_at"] and (now - _pick_cache["loaded_at"] < ttl):
        return _pick_cache["map"]
    try:
        m = {
            d["partner_id"]: int(d.get("local_count", 0))
            async for d in db[SIGNAL_COLLECTION].find(
                {"is_local_pick": True}, {"_id": 0, "partner_id": 1, "local_count": 1}
            )
        }
        _pick_cache["map"] = m
        _pick_cache["loaded_at"] = now
    except Exception as exc:
        logger.warning(f"[local_signals] pick cache load failed: {exc}")
    return _pick_cache["map"]


async def get_behavioral_pick_ids(ttl: float = 300.0) -> frozenset:
    """Cached set of gate-cleared partner_ids. Empty until locals accrue."""
    return frozenset((await _load_pick_map(ttl)).keys())


def boost_for(pick_map: Dict[str, int], partner_id: str) -> float:
    """Additive, capped local boost for one venue (0.0 if not a pick)."""
    lc = pick_map.get(partner_id)
    if not lc:
        return 0.0
    return min(BOOST_CAP, BOOST_PER_LOCAL * lc)


async def get_behavioral_pick_map(ttl: float = 300.0) -> Dict[str, int]:
    """Cached {partner_id: local_count} for the graded search boost."""
    return await _load_pick_map(ttl)


# ── Endpoints ────────────────────────────────────────────────────────

@router.get("/local-picks")
async def local_picks():
    """Public: venues locals recommend. Behavioral picks (confidence-gated,
    with distinct-local counts) first, then editorial `local_favorite`-tagged
    venues as the never-empty baseline. The frontend uses the ids to filter
    and the counts to render the "Local pick · N locals" badge."""
    beh = await db[SIGNAL_COLLECTION].find(
        {"is_local_pick": True},
        {"_id": 0, "partner_id": 1, "local_count": 1, "lift": 1, "neighborhood": 1, "updated_at": 1},
    ).sort("local_count", -1).to_list(500)
    beh_ids = {d["partner_id"] for d in beh}

    picks: List[Dict[str, Any]] = [
        {
            "partner_id": d["partner_id"], "source": "behavioral",
            "local_count": d.get("local_count", 0), "lift": d.get("lift"),
            "neighborhood": d.get("neighborhood"),
        }
        for d in beh
    ]

    # Tag baseline — include neighborhood (nearest-centroid from location) so the
    # detail badge and other surfaces read one source instead of recomputing.
    tag_rows = await db.partners.find(
        {"tags": "local_favorite"}, {"_id": 0, "partner_id": 1, "location": 1}
    ).to_list(500)
    for r in tag_rows:
        if r["partner_id"] not in beh_ids:
            loc = r.get("location") or {}
            picks.append({
                "partner_id": r["partner_id"], "source": "tag",
                "neighborhood": _nearest_neighborhood(loc.get("lat"), loc.get("lng")),
            })

    updated_at = beh[0].get("updated_at") if beh else None
    return {
        "updated_at": updated_at,
        "behavioral_count": len(beh_ids),
        "tag_count": len(picks) - len(beh_ids),
        "picks": picks,
    }


@router.api_route("/admin/local-picks/refresh", methods=["GET", "POST"])
async def refresh(request: Request):
    """Recompute the behavioral local signal. Admin user OR Bearer CRON_SECRET."""
    via = await _auth(request)
    stats = await recompute()
    return {"status": "ok", "via": via.get("via"), **stats}


@router.get("/admin/local-picks/intel")
async def intel(request: Request):
    """Admin: 'locals vs tourists' intelligence — coverage, divergence
    (locals love / tourists miss, by over-indexing lift), and where local
    picks concentrate by neighborhood. Populates as local favorites accrue;
    top_neighborhoods is meaningful from day one off the tag baseline."""
    await _auth(request)

    sig = await db[SIGNAL_COLLECTION].find({}, {"_id": 0}).to_list(2000)
    behavioral = [d for d in sig if d.get("is_local_pick")]
    beh_ids = [d["partner_id"] for d in behavioral]
    beh_set = set(beh_ids)

    tag_rows = await db.partners.find(
        {"tags": "local_favorite"},
        {"_id": 0, "partner_id": 1, "name": 1, "location": 1},
    ).to_list(2000)

    name_map: Dict[str, str] = {}
    if beh_ids:
        async for p in db.partners.find(
            {"partner_id": {"$in": beh_ids}}, {"_id": 0, "partner_id": 1, "name": 1}
        ):
            name_map[p["partner_id"]] = p.get("name", "")

    # Divergence (spec 3c): ratio = local_favoriters / tourist_favoriters per
    # venue, MIN-THRESHOLD gated so one favorite can't manufacture a signal —
    # a venue must have >= MIN_DIVERGENCE_LOCALS distinct locals AND out-index
    # tourists by >= MIN_DIVERGENCE_RATIO. Only venues past the gate are shown;
    # until any exist the frontend renders the building-state (never a zero table).
    diverge = []
    for d in behavioral:
        lc = d.get("local_count", 0)
        tc = d.get("tourist_count", 0)
        if lc < MIN_DIVERGENCE_LOCALS:
            continue
        ratio = lc / max(tc, 1)  # tourists=0 ⇒ purest "locals love, tourists miss"
        if ratio < MIN_DIVERGENCE_RATIO:
            continue
        diverge.append((ratio, d))
    diverge.sort(key=lambda x: (x[0], x[1].get("local_count", 0)), reverse=True)
    divergence = [{
        "partner_id": d["partner_id"],
        "name": name_map.get(d["partner_id"], d["partner_id"]),
        "local_count": d.get("local_count", 0),
        "tourist_count": d.get("tourist_count", 0),
        "ratio": round(ratio, 2),
        "lift": d.get("lift"),
        "neighborhood": d.get("neighborhood"),
    } for ratio, d in diverge[:15]]

    # Where local picks concentrate — behavioral (stored) + tag venues (assigned)
    nbh_counts: Dict[str, int] = {}
    for d in behavioral:
        nb = d.get("neighborhood")
        if nb:
            nbh_counts[nb] = nbh_counts.get(nb, 0) + 1
    for r in tag_rows:
        if r["partner_id"] in beh_set:
            continue
        loc = r.get("location") or {}
        nb = _nearest_neighborhood(loc.get("lat"), loc.get("lng"))
        if nb:
            nbh_counts[nb] = nbh_counts.get(nb, 0) + 1
    top_neighborhoods = sorted(
        ({"neighborhood": k, "count": v} for k, v in nbh_counts.items()),
        key=lambda x: x["count"], reverse=True,
    )

    return {
        "coverage": {
            "behavioral_picks": len(behavioral),
            "tag_venues": len(tag_rows),
            "partners_with_signal": len(sig),
        },
        "divergence": divergence,
        "top_neighborhoods": top_neighborhoods,
        "updated_at": (sig[0].get("updated_at") if sig else None),
    }
