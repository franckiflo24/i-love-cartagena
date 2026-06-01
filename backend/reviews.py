"""
Reviews & Ratings module — User reviews for partners and experiences.

Features:
  - Star rating (1-5) with 4 subcategories (experience, service, location, value)
  - Text review with optional photos
  - One review per user per partner (enforced by unique index)
  - Aggregate partner ratings auto-updated on insert/delete
  - Helpful votes and reporting

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


def init(*, db, get_current_user, award_points=None):
    """Wire dependencies from server.py."""
    _deps["db"] = db
    _deps["get_current_user"] = get_current_user
    _deps["award_points"] = award_points


def _db():
    return _deps["db"]


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────
async def _update_partner_rating(db, partner_id: str):
    """Re-aggregate reviews and update the partner's rating + review count."""
    pipeline = [
        {"$match": {"partner_id": partner_id}},
        {"$group": {
            "_id": None,
            "avg_rating": {"$avg": "$rating"},
            "count": {"$sum": 1},
            "avg_experience": {"$avg": "$subcategories.experience"},
            "avg_service": {"$avg": "$subcategories.service"},
            "avg_location": {"$avg": "$subcategories.location"},
            "avg_value": {"$avg": "$subcategories.value"},
        }},
    ]
    result = await db.reviews.aggregate(pipeline).to_list(1)
    if result:
        agg = result[0]
        await db.partners.update_one(
            {"partner_id": partner_id},
            {"$set": {
                "rating": round(agg["avg_rating"], 1),
                "reviews": agg["count"],
                "rating_breakdown": {
                    "experience": round(agg["avg_experience"] or 0, 1),
                    "service": round(agg["avg_service"] or 0, 1),
                    "location": round(agg["avg_location"] or 0, 1),
                    "value": round(agg["avg_value"] or 0, 1),
                },
            }},
        )
    else:
        await db.partners.update_one(
            {"partner_id": partner_id},
            {"$set": {"rating": 0, "reviews": 0, "rating_breakdown": {}}},
        )


async def _check_verified_booking(db, user_id: str, partner_id: str) -> bool:
    """Check if the user has a confirmed reservation or booking at this partner."""
    res = await db.reservations.find_one(
        {"user_id": user_id, "partner_id": partner_id, "status": {"$in": ["confirmed", "completed"]}},
        {"_id": 1},
    )
    if res:
        return True
    bk = await db.partner_bookings.find_one(
        {"user_id": user_id, "partner_id": partner_id},
        {"_id": 1},
    )
    return bool(bk)


# ─────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────

@router.post("/reviews")
async def submit_review(request: Request):
    """Submit a review for a partner. One review per user per partner."""
    try:
        user = await _deps["get_current_user"](request)
        db = _db()
        body = await request.json()

        partner_id = (body.get("partner_id") or "").strip()
        rating = body.get("rating")
        text = (body.get("text") or "").strip()
        photos = body.get("photos") or []
        subcategories = body.get("subcategories") or {}

        if not partner_id:
            raise HTTPException(status_code=400, detail="partner_id required")
        if not rating or not isinstance(rating, (int, float)) or rating < 1 or rating > 5:
            raise HTTPException(status_code=400, detail="rating must be between 1 and 5")

        partner = await db.partners.find_one({"partner_id": partner_id}, {"_id": 0, "partner_id": 1, "name": 1})
        if not partner:
            raise HTTPException(status_code=404, detail="Partner not found")

        existing = await db.reviews.find_one(
            {"user_id": user["user_id"], "partner_id": partner_id},
            {"_id": 0, "review_id": 1},
        )
        if existing:
            raise HTTPException(status_code=409, detail="You have already reviewed this partner")

        sub = {
            "experience": min(5, max(1, float(subcategories.get("experience", rating)))),
            "service": min(5, max(1, float(subcategories.get("service", rating)))),
            "location": min(5, max(1, float(subcategories.get("location", rating)))),
            "value": min(5, max(1, float(subcategories.get("value", rating)))),
        }

        is_verified = await _check_verified_booking(db, user["user_id"], partner_id)

        now = datetime.now(timezone.utc).isoformat()
        review = {
            "review_id": f"rev_{uuid.uuid4().hex[:12]}",
            "user_id": user["user_id"],
            "user_name": user.get("name", "Anonymous"),
            "user_picture": user.get("picture", ""),
            "partner_id": partner_id,
            "rating": round(float(rating), 1),
            "subcategories": sub,
            "text": text[:2000],
            "photos": photos[:5],
            "helpful_count": 0,
            "is_verified_booking": is_verified,
            "is_moderated": False,
            "created_at": now,
            "updated_at": now,
        }
        await db.reviews.insert_one(review)
        await _update_partner_rating(db, partner_id)

        award_fn = _deps.get("award_points")
        if award_fn:
            try:
                await award_fn(db, user["user_id"], 50, "review", review["review_id"], f"Review: {partner.get('name', partner_id)}")
            except Exception as e:
                logger.error(f"[Reviews] Failed to award points: {e}")

        return {k: v for k, v in review.items() if k != "_id"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Reviews] submit_review error: {e}")
        raise HTTPException(status_code=500, detail="Failed to submit review")


@router.get("/reviews/partner/{partner_id}")
async def get_partner_reviews(request: Request, partner_id: str):
    """Get paginated reviews + aggregate stats for a partner."""
    try:
        db = _db()

        page = int(request.query_params.get("page", "1"))
        limit = min(int(request.query_params.get("limit", "15")), 50)
        skip = (page - 1) * limit

        total = await db.reviews.count_documents({"partner_id": partner_id})
        reviews = await db.reviews.find(
            {"partner_id": partner_id},
            {"_id": 0},
        ).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)

        partner = await db.partners.find_one({"partner_id": partner_id}, {"_id": 0, "rating": 1, "reviews": 1, "rating_breakdown": 1})
        aggregate = {
            "avg_rating": partner.get("rating", 0) if partner else 0,
            "total_reviews": partner.get("reviews", 0) if partner else 0,
            "breakdown": partner.get("rating_breakdown", {}) if partner else {},
        }

        return {
            "reviews": reviews,
            "aggregate": aggregate,
            "total": total,
            "page": page,
            "pages": (total + limit - 1) // limit if total > 0 else 1,
        }
    except Exception as e:
        logger.error(f"[Reviews] get_partner_reviews error: {e}")
        raise HTTPException(status_code=500, detail="Failed to load reviews")


@router.get("/reviews/me")
async def get_my_reviews(request: Request):
    """Get the current user's reviews."""
    user = await _deps["get_current_user"](request)
    db = _db()

    reviews = await db.reviews.find(
        {"user_id": user["user_id"]},
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)

    return {"reviews": reviews}


@router.post("/reviews/{review_id}/helpful")
async def mark_helpful(request: Request, review_id: str):
    """Increment the helpful count on a review."""
    await _deps["get_current_user"](request)
    db = _db()

    result = await db.reviews.update_one(
        {"review_id": review_id},
        {"$inc": {"helpful_count": 1}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Review not found")

    return {"ok": True}


@router.post("/reviews/{review_id}/report")
async def report_review(request: Request, review_id: str):
    """Report a review for moderation."""
    user = await _deps["get_current_user"](request)
    db = _db()
    body = await request.json()
    reason = (body.get("reason") or "").strip()

    review = await db.reviews.find_one({"review_id": review_id}, {"_id": 0, "review_id": 1})
    if not review:
        raise HTTPException(status_code=404, detail="Review not found")

    existing = await db.review_reports.find_one(
        {"review_id": review_id, "reporter_user_id": user["user_id"]},
        {"_id": 1},
    )
    if existing:
        raise HTTPException(status_code=409, detail="Already reported")

    now = datetime.now(timezone.utc).isoformat()
    report = {
        "report_id": f"rpt_{uuid.uuid4().hex[:12]}",
        "review_id": review_id,
        "reporter_user_id": user["user_id"],
        "reason": reason[:500],
        "created_at": now,
    }
    await db.review_reports.insert_one(report)

    report_count = await db.review_reports.count_documents({"review_id": review_id})
    if report_count >= 3:
        await db.reviews.update_one({"review_id": review_id}, {"$set": {"is_moderated": True}})

    return {"ok": True}
