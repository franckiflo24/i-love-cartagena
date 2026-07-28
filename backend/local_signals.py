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
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger("local_signals")

router = APIRouter()

db = None
_require_admin = None

# ── Confidence gate ──────────────────────────────────────────────────
MIN_LOCAL_USERS = 5      # distinct local users before a venue is a behavioral pick
MIN_LIFT = 1.2           # locals must over-index vs their overall favorite share…
MIN_TOURIST_BASELINE = 10  # …but only once there's enough tourist volume to compare
SIGNAL_COLLECTION = "local_signals"


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
        docs.append({
            "partner_id": pid,
            "local_count": lc,
            "tourist_count": tc,
            "lift": round(lift, 3),
            "is_local_pick": is_pick,
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


# ── Endpoints ────────────────────────────────────────────────────────

@router.get("/local-picks")
async def local_picks():
    """Public: venues locals recommend. Behavioral picks (confidence-gated,
    with distinct-local counts) first, then editorial `local_favorite`-tagged
    venues as the never-empty baseline. The frontend uses the ids to filter
    and the counts to render the "Local pick · N locals" badge."""
    beh = await db[SIGNAL_COLLECTION].find(
        {"is_local_pick": True},
        {"_id": 0, "partner_id": 1, "local_count": 1, "lift": 1, "updated_at": 1},
    ).sort("local_count", -1).to_list(500)
    beh_ids = {d["partner_id"] for d in beh}

    picks: List[Dict[str, Any]] = [
        {
            "partner_id": d["partner_id"], "source": "behavioral",
            "local_count": d.get("local_count", 0), "lift": d.get("lift"),
        }
        for d in beh
    ]

    tag_rows = await db.partners.find(
        {"tags": "local_favorite"}, {"_id": 0, "partner_id": 1}
    ).to_list(500)
    for r in tag_rows:
        if r["partner_id"] not in beh_ids:
            picks.append({"partner_id": r["partner_id"], "source": "tag"})

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
