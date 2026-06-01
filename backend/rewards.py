"""
AMO Rewards — Loyalty points, tier system, offers, and redemptions.

Tier thresholds (lifetime_points):
  explorer:  0 – 2,999
  voyager:   3,000 – 9,999
  elite:     10,000 – 24,999
  legend:    25,000+

Points are awarded automatically on:
  - Payment fulfilled (city_pass=500, port_tax=200, partner_event=300, experience=400)
  - Reservation confirmed (100)
  - Review submitted (50)
  - Profile completed (200)

Routes are mounted on `router`. `init(deps)` must be called from server.py
before `app.include_router(router, prefix='/api')`.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger(__name__)

router = APIRouter()

# ─────────────────────────────────────────────────────────────
# Dependencies injected by server.py at startup
# ─────────────────────────────────────────────────────────────
_deps: dict[str, Any] = {}


def init(*, db, get_current_user):
    """Wire dependencies from server.py."""
    _deps["db"] = db
    _deps["get_current_user"] = get_current_user


def _db():
    return _deps["db"]


# ─────────────────────────────────────────────────────────────
# Tier system
# ─────────────────────────────────────────────────────────────
TIER_THRESHOLDS = [
    ("legend", 25000),
    ("elite", 10000),
    ("voyager", 3000),
    ("explorer", 0),
]

TIER_ORDER = {"explorer": 0, "voyager": 1, "elite": 2, "legend": 3}

TIER_BENEFITS = {
    "explorer": {
        "discount_pct": 0,
        "perks": ["Access to all events", "Save favorites", "AI concierge"],
    },
    "voyager": {
        "discount_pct": 5,
        "perks": ["5% off select experiences", "Priority booking", "Early event access"],
    },
    "elite": {
        "discount_pct": 15,
        "perks": ["15% off experiences", "VIP event access", "Exclusive invites", "Welcome gift"],
    },
    "legend": {
        "discount_pct": 30,
        "perks": ["Up to 30% off", "Room upgrades", "VIP treatment", "Birthday surprises", "Private events"],
    },
}

POINTS_CONFIG = {
    "city_pass": 500,
    "port_tax": 200,
    "partner_event": 300,
    "experience": 400,
    "reservation": 100,
    "review": 50,
    "profile_complete": 200,
    "referral": 500,
}


def _calculate_tier(lifetime_points: int) -> str:
    for tier_name, threshold in TIER_THRESHOLDS:
        if lifetime_points >= threshold:
            return tier_name
    return "explorer"


def _next_tier_info(current_tier: str, lifetime_points: int) -> dict:
    idx = TIER_ORDER.get(current_tier, 0)
    if idx >= 3:
        return {"next_tier": None, "points_to_next": 0, "progress_pct": 100}
    next_tier_name = [t for t, o in TIER_ORDER.items() if o == idx + 1][0]
    next_threshold = [th for name, th in TIER_THRESHOLDS if name == next_tier_name][0]
    current_threshold = [th for name, th in TIER_THRESHOLDS if name == current_tier][0]
    points_to_next = max(0, next_threshold - lifetime_points)
    range_size = next_threshold - current_threshold
    progress_in_range = lifetime_points - current_threshold
    progress_pct = min(100, round((progress_in_range / range_size) * 100)) if range_size > 0 else 100
    return {"next_tier": next_tier_name, "points_to_next": points_to_next, "progress_pct": progress_pct}


# ─────────────────────────────────────────────────────────────
# Core: award_points (called from server.py hooks)
# ─────────────────────────────────────────────────────────────
async def award_points(
    db,
    user_id: str,
    delta: int,
    action_type: str,
    source_id: str = "",
    description: str = "",
) -> dict:
    """Award (or deduct) points. Auto-creates account on first call. Returns updated account."""
    now = datetime.now(timezone.utc).isoformat()

    account = await db.rewards_accounts.find_one({"user_id": user_id}, {"_id": 0})
    if not account:
        account = {
            "reward_id": f"rwd_{uuid.uuid4().hex[:12]}",
            "user_id": user_id,
            "points_balance": 0,
            "lifetime_points": 0,
            "tier": "explorer",
            "tier_updated_at": now,
            "created_at": now,
            "updated_at": now,
        }
        await db.rewards_accounts.insert_one(account)

    new_balance = max(0, account["points_balance"] + delta)
    new_lifetime = account["lifetime_points"] + max(0, delta)
    new_tier = _calculate_tier(new_lifetime)

    update_fields = {
        "points_balance": new_balance,
        "lifetime_points": new_lifetime,
        "tier": new_tier,
        "updated_at": now,
    }
    if new_tier != account["tier"]:
        update_fields["tier_updated_at"] = now

    await db.rewards_accounts.update_one(
        {"user_id": user_id},
        {"$set": update_fields},
    )

    history_entry = {
        "history_id": f"rh_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "delta": delta,
        "balance_after": new_balance,
        "action_type": action_type,
        "source_id": source_id,
        "description": description,
        "created_at": now,
    }
    await db.rewards_history.insert_one(history_entry)

    logger.info(f"[Rewards] {user_id}: {'+' if delta >= 0 else ''}{delta} pts ({action_type}) → balance={new_balance}, tier={new_tier}")

    return {**account, **update_fields, "last_delta": delta}


# ─────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────

@router.get("/rewards/me")
async def get_my_rewards(request: Request):
    """Get the current user's rewards account, tier info, and benefits."""
    try:
        user = await _deps["get_current_user"](request)
        db = _db()

        account = await db.rewards_accounts.find_one({"user_id": user["user_id"]}, {"_id": 0})
        if not account:
            now = datetime.now(timezone.utc).isoformat()
            account = {
                "reward_id": f"rwd_{uuid.uuid4().hex[:12]}",
                "user_id": user["user_id"],
                "points_balance": 0,
                "lifetime_points": 0,
                "tier": "explorer",
                "tier_updated_at": now,
                "created_at": now,
                "updated_at": now,
            }
            await db.rewards_accounts.insert_one(account)
            account = await db.rewards_accounts.find_one({"user_id": user["user_id"]}, {"_id": 0})

        tier = account["tier"]
        tier_info = _next_tier_info(tier, account["lifetime_points"])
        benefits = TIER_BENEFITS.get(tier, TIER_BENEFITS["explorer"])

        recent_history = await db.rewards_history.find(
            {"user_id": user["user_id"]},
            {"_id": 0},
        ).sort("created_at", -1).limit(10).to_list(10)

        # Include offers so the frontend can read data.offers from this single endpoint
        user_tier_level = TIER_ORDER.get(tier, 0)
        all_offers = await db.rewards_offers.find(
            {"is_active": True},
            {"_id": 0},
        ).sort("points_cost", 1).to_list(100)
        offers = []
        for offer in all_offers:
            min_tier = offer.get("min_tier", "explorer")
            min_level = TIER_ORDER.get(min_tier, 0)
            eligible = user_tier_level >= min_level
            max_uses = offer.get("max_uses", 0)
            uses_count = offer.get("uses_count", 0)
            available = max_uses == 0 or uses_count < max_uses
            offers.append({
                **offer,
                "eligible": eligible,
                "available": available,
            })

        return {
            "account": account,
            "tier": tier,
            "tierLabel": tier.capitalize(),
            "tier_label": tier.capitalize(),
            "points_balance": account["points_balance"],
            "points": account["points_balance"],
            "lifetime_points": account["lifetime_points"],
            **tier_info,
            "benefits": benefits.get("perks", []) if isinstance(benefits, dict) else benefits,
            "benefits_full": benefits,
            "recent_history": recent_history,
            "offers": offers,
            "points_config": POINTS_CONFIG,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Rewards] get_my_rewards error: {e}")
        raise HTTPException(status_code=500, detail="Failed to load rewards")


@router.get("/rewards/history")
async def get_rewards_history(request: Request):
    """Get paginated points history."""
    try:
        user = await _deps["get_current_user"](request)
        db = _db()

        page = int(request.query_params.get("page", "1"))
        limit = min(int(request.query_params.get("limit", "20")), 50)
        skip = (page - 1) * limit

        total = await db.rewards_history.count_documents({"user_id": user["user_id"]})
        history = await db.rewards_history.find(
            {"user_id": user["user_id"]},
            {"_id": 0},
        ).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)

        return {
            "history": history,
            "total": total,
            "page": page,
            "pages": (total + limit - 1) // limit if total > 0 else 1,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Rewards] get_rewards_history error: {e}")
        raise HTTPException(status_code=500, detail="Failed to load rewards history")


@router.get("/rewards/offers")
async def get_rewards_offers(request: Request):
    """Get available offers filtered by user's tier eligibility."""
    try:
        user = await _deps["get_current_user"](request)
        db = _db()

        account = await db.rewards_accounts.find_one({"user_id": user["user_id"]}, {"_id": 0})
        user_tier = account["tier"] if account else "explorer"
        user_tier_level = TIER_ORDER.get(user_tier, 0)

        all_offers = await db.rewards_offers.find(
            {"is_active": True},
            {"_id": 0},
        ).sort("points_cost", 1).to_list(100)

        offers = []
        for offer in all_offers:
            min_tier = offer.get("min_tier", "explorer")
            min_level = TIER_ORDER.get(min_tier, 0)
            eligible = user_tier_level >= min_level
            max_uses = offer.get("max_uses", 0)
            uses_count = offer.get("uses_count", 0)
            available = max_uses == 0 or uses_count < max_uses
            offers.append({
                **offer,
                "eligible": eligible,
                "available": available,
            })

        return {"offers": offers, "user_tier": user_tier}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Rewards] get_rewards_offers error: {e}")
        raise HTTPException(status_code=500, detail="Failed to load offers")


@router.post("/rewards/redeem")
async def redeem_offer(request: Request):
    """Redeem an offer using points."""
    try:
        user = await _deps["get_current_user"](request)
        db = _db()
        body = await request.json()
        offer_id = (body.get("offer_id") or "").strip()

        if not offer_id:
            raise HTTPException(status_code=400, detail="offer_id required")

        offer = await db.rewards_offers.find_one({"offer_id": offer_id, "is_active": True}, {"_id": 0})
        if not offer:
            raise HTTPException(status_code=404, detail="Offer not found or inactive")

        account = await db.rewards_accounts.find_one({"user_id": user["user_id"]}, {"_id": 0})
        if not account:
            raise HTTPException(status_code=400, detail="No rewards account")

        min_tier_level = TIER_ORDER.get(offer.get("min_tier", "explorer"), 0)
        user_tier_level = TIER_ORDER.get(account["tier"], 0)
        if user_tier_level < min_tier_level:
            raise HTTPException(status_code=403, detail=f"Requires {offer.get('min_tier', 'explorer')} tier or higher")

        points_cost = offer.get("points_cost", 0)
        if account["points_balance"] < points_cost:
            raise HTTPException(status_code=400, detail=f"Not enough points. Need {points_cost}, have {account['points_balance']}")

        max_uses = offer.get("max_uses", 0)
        uses_count = offer.get("uses_count", 0)
        if max_uses > 0 and uses_count >= max_uses:
            raise HTTPException(status_code=400, detail="Offer fully redeemed")

        now = datetime.now(timezone.utc).isoformat()
        redemption = {
            "redemption_id": f"rdm_{uuid.uuid4().hex[:12]}",
            "user_id": user["user_id"],
            "offer_id": offer_id,
            "points_spent": points_cost,
            "status": "active",
            "redeemed_at": now,
            "used_at": None,
            "expires_at": offer.get("expires_at"),
            "qr_payload": f"AMO-RDM-{uuid.uuid4().hex[:8].upper()}",
        }
        await db.rewards_redemptions.insert_one(redemption)

        await db.rewards_offers.update_one(
            {"offer_id": offer_id},
            {"$inc": {"uses_count": 1}},
        )

        await award_points(
            db, user["user_id"], -points_cost, "redeem", redemption["redemption_id"],
            f"Redeemed: {offer.get('title', 'Offer')}",
        )

        return {"redemption": {k: v for k, v in redemption.items() if k != "_id"}, "new_balance": account["points_balance"] - points_cost}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Rewards] redeem error: {e}")
        raise HTTPException(status_code=500, detail="Failed to redeem offer")


# ─────────────────────────────────────────────────────────────
# Seed offers (called from server.py startup)
# ─────────────────────────────────────────────────────────────
async def seed_default_offers(db):
    """Seed initial offers if the collection is empty."""
    count = await db.rewards_offers.count_documents({})
    if count > 0:
        return

    now = datetime.now(timezone.utc).isoformat()
    offers = [
        {
            "offer_id": f"offer_{uuid.uuid4().hex[:8]}",
            "title": "Free Welcome Drink",
            "description": "A complimentary cocktail at any participating beach club or restaurant.",
            "partner_id": None,
            "min_tier": "explorer",
            "points_cost": 500,
            "value_cop": 35000,
            "expires_at": None,
            "max_uses": 0,
            "uses_count": 0,
            "is_active": True,
            "image_url": "",
            "created_at": now,
        },
        {
            "offer_id": f"offer_{uuid.uuid4().hex[:8]}",
            "title": "15% Off Sunset Session",
            "description": "Enjoy 15% off at select beach clubs during sunset hours.",
            "partner_id": None,
            "min_tier": "voyager",
            "points_cost": 1500,
            "value_cop": 75000,
            "expires_at": None,
            "max_uses": 100,
            "uses_count": 0,
            "is_active": True,
            "image_url": "",
            "created_at": now,
        },
        {
            "offer_id": f"offer_{uuid.uuid4().hex[:8]}",
            "title": "VIP Table Upgrade",
            "description": "Automatic upgrade to VIP seating at participating restaurants.",
            "partner_id": None,
            "min_tier": "elite",
            "points_cost": 5000,
            "value_cop": 200000,
            "expires_at": None,
            "max_uses": 50,
            "uses_count": 0,
            "is_active": True,
            "image_url": "",
            "created_at": now,
        },
        {
            "offer_id": f"offer_{uuid.uuid4().hex[:8]}",
            "title": "Private Yacht Experience",
            "description": "Exclusive 2-hour private yacht experience for up to 8 guests.",
            "partner_id": None,
            "min_tier": "legend",
            "points_cost": 15000,
            "value_cop": 800000,
            "expires_at": None,
            "max_uses": 10,
            "uses_count": 0,
            "is_active": True,
            "image_url": "",
            "created_at": now,
        },
    ]
    await db.rewards_offers.insert_many(offers)
    logger.info(f"[Rewards] Seeded {len(offers)} default offers")
