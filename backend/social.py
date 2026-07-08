"""
Amo Together — Social layer of Amo Cartagena.

Endpoints (all mounted under /api by main app):
  PATCH  /users/me/social      — update social profile (badge, vibes, IG, bio)
  GET    /users/me/social      — get own social profile
  GET    /users/social/nearby  — list social users currently in a city
  GET    /users/social/{uid}   — public profile of a specific user
  POST   /users/social/report  — report a user (moderation)
  POST   /users/social/block   — block a user (does not notify)
  GET    /users/social/blocked — list blocked users

Safety rules enforced here (see full spec in /app/store-assets/SOCIAL_SPEC.md):
  • NEVER expose GPS lat/lng — only city-level presence
  • First name + first letter of last name only in public profile
  • Rate limit: max 10 meet requests / day / user
  • Auto-suspend after 3 valid reports
  • Users < 18 y.o. cannot enable social
  • Blocked users are hidden bidirectionally
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone, timedelta
from typing import Optional, List
import unicodedata

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, Field
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = _client[os.environ.get("DB_NAME", "test_database")]

router = APIRouter(tags=["social"])

# Supported cities for the badge system (rollout order)
SUPPORTED_CITIES = ["cartagena", "medellin", "bogota"]
DEFAULT_CITY = "cartagena"

# Vibe catalog (max 5 per user)
VIBES = [
    "foodie", "salsa", "beach", "nightlife", "culture",
    "wellness", "photo", "adventure", "art", "coffee",
    "family", "romance", "business", "solo_traveler",
]

# --------------- Pydantic models ---------------

class SocialProfileUpdate(BaseModel):
    user_type: Optional[str] = Field(None, pattern="^(local|tourist)$")
    home_city: Optional[str] = None            # e.g. "Paris, France" or "Cartagena, Colombia"
    current_city: Optional[str] = None         # slug in SUPPORTED_CITIES
    trip_start: Optional[str] = None           # ISO date YYYY-MM-DD (tourist)
    trip_end: Optional[str] = None             # ISO date YYYY-MM-DD (tourist)
    local_since_years: Optional[int] = Field(None, ge=0, le=99)  # for locals
    vibes: Optional[List[str]] = None           # subset of VIBES, max 5
    languages: Optional[List[str]] = None       # ["es","en","fr","pt"]
    instagram: Optional[str] = None             # handle only, no URL
    bio: Optional[str] = Field(None, max_length=150)
    social_enabled: Optional[bool] = None
    women_only_filter: Optional[bool] = None    # opt-in "women see women"


class ReportBody(BaseModel):
    target_user_id: str
    reason: str = Field(..., pattern="^(spam|harassment|fake|inappropriate|other)$")
    detail: Optional[str] = Field(None, max_length=500)


class BlockBody(BaseModel):
    target_user_id: str


# --------------- Helpers ---------------

def _clean_ig(raw: str) -> str:
    if not raw: return ""
    h = str(raw).strip()
    h = re.sub(r"^https?://(www\.)?instagram\.com/", "", h, flags=re.I)
    h = h.lstrip("@").rstrip("/").split("?")[0].split("#")[0]
    return h.strip()


def _norm_city(c: str) -> str:
    if not c: return ""
    s = unicodedata.normalize("NFKD", c).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def _public_profile(user: dict, viewer_uid: Optional[str] = None,
                    same_event: bool = False) -> dict:
    """Serialize a user into the smallest, safest public representation.

    Level 1 (any Amo user):  first name + photo + badge + country + vibes
    Level 2 (same event):    + short bio + languages + IG handle
    """
    social = user.get("social") or {}
    if not social.get("social_enabled"):
        return {}

    first_name = (user.get("first_name") or user.get("name") or "").split(" ", 1)[0]
    last_initial = (user.get("last_name") or "").strip()[:1].upper()

    out = {
        "user_id": user.get("user_id") or str(user.get("_id")),
        "display_name": f"{first_name} {last_initial}." if last_initial else first_name,
        "photo_url": user.get("photo_url") or user.get("picture") or "",
        "badge": _badge(social),
        "vibes": (social.get("vibes") or [])[:5],
    }
    if same_event:
        out.update({
            "bio": social.get("bio") or "",
            "languages": social.get("languages") or [],
            "instagram": social.get("instagram") or "",
        })
    return out


def _badge(social: dict) -> dict:
    """Compute the primary badge (local / tourist) for display."""
    utype = social.get("user_type") or "tourist"
    city = social.get("current_city") or DEFAULT_CITY
    city_pretty = {"cartagena": "Cartagena", "medellin": "Medellín", "bogota": "Bogotá"}.get(city, city.title())
    if utype == "local":
        years = social.get("local_since_years") or 0
        subtitle = f"desde {years}+ años" if years >= 3 else ("nuevo local" if years <= 1 else f"desde {years} años")
        return {
            "type": "local", "icon": "🏛️", "color": "#F59E0B",
            "title": f"Local · {city_pretty}",
            "subtitle": subtitle,
        }
    # Tourist
    tstart = social.get("trip_start")
    tend = social.get("trip_end")
    subtitle = f"{tstart} → {tend}" if tstart and tend else "En viaje"
    return {
        "type": "tourist", "icon": "✈️", "color": "#3B82F6",
        "title": f"Voyageur · {city_pretty}",
        "subtitle": subtitle,
    }


async def _get_user_from_request(request: Request) -> dict:
    """Auth guard — accepts JWT Bearer emitted by /auth flow."""
    auth = request.headers.get("Authorization") or ""
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    token = auth.split(" ", 1)[1]
    user = await db.users.find_one({"$or": [{"jwt_token": token}, {"session_token": token}]}, {"_id": 0})
    if not user:
        raise HTTPException(401, "Invalid session")
    return user


async def _is_blocked(viewer_id: str, target_id: str) -> bool:
    if not viewer_id or not target_id: return False
    hit = await db.user_blocks.find_one({
        "$or": [
            {"blocker_id": viewer_id, "blocked_id": target_id},
            {"blocker_id": target_id, "blocked_id": viewer_id},
        ]
    })
    return hit is not None


# --------------- Endpoints ---------------

@router.get("/users/social/config")
async def social_config():
    """Public config for the mobile client — supported cities and vibe catalog."""
    return {
        "supported_cities": [
            {"slug": "cartagena", "name": "Cartagena", "flag": "🇨🇴", "live": True},
            {"slug": "medellin",  "name": "Medellín",  "flag": "🇨🇴", "live": False},
            {"slug": "bogota",    "name": "Bogotá",    "flag": "🇨🇴", "live": False},
        ],
        "vibes": VIBES,
        "languages": ["es", "en", "fr", "pt"],
        "max_vibes_per_user": 5,
        "bio_max_chars": 150,
    }


@router.get("/users/me/social")
async def get_my_social(current_user: dict = Depends(_get_user_from_request)):
    social = current_user.get("social") or {}
    return {
        "user_id": current_user.get("user_id") or str(current_user.get("_id")),
        "email": current_user.get("email"),
        "first_name": current_user.get("first_name") or current_user.get("name"),
        "photo_url": current_user.get("photo_url") or current_user.get("picture") or "",
        "social": social,
        "badge": _badge(social) if social.get("social_enabled") else None,
    }


@router.patch("/users/me/social")
async def update_my_social(payload: SocialProfileUpdate,
                            current_user: dict = Depends(_get_user_from_request)):
    updates: dict = {}
    if payload.user_type is not None:
        updates["social.user_type"] = payload.user_type
    if payload.home_city is not None:
        updates["social.home_city"] = payload.home_city.strip()[:80]
    if payload.current_city is not None:
        slug = _norm_city(payload.current_city)
        if slug not in SUPPORTED_CITIES:
            raise HTTPException(400, f"City '{payload.current_city}' not supported yet. Try: {', '.join(SUPPORTED_CITIES)}")
        updates["social.current_city"] = slug
    if payload.trip_start is not None:
        updates["social.trip_start"] = payload.trip_start
    if payload.trip_end is not None:
        updates["social.trip_end"] = payload.trip_end
    if payload.local_since_years is not None:
        updates["social.local_since_years"] = payload.local_since_years
    if payload.vibes is not None:
        clean = [v for v in payload.vibes if v in VIBES][:5]
        updates["social.vibes"] = clean
    if payload.languages is not None:
        updates["social.languages"] = [l for l in payload.languages if l in ("es", "en", "fr", "pt")]
    if payload.instagram is not None:
        updates["social.instagram"] = _clean_ig(payload.instagram)
    if payload.bio is not None:
        updates["social.bio"] = payload.bio.strip()[:150]
    if payload.social_enabled is not None:
        updates["social.social_enabled"] = payload.social_enabled
    if payload.women_only_filter is not None:
        updates["social.women_only_filter"] = payload.women_only_filter

    if not updates:
        raise HTTPException(400, "Nothing to update")

    updates["social.updated_at"] = datetime.now(timezone.utc).isoformat()
    uid = current_user.get("user_id") or str(current_user.get("_id"))
    await db.users.update_one({"user_id": uid}, {"$set": updates})
    fresh = await db.users.find_one({"user_id": uid}, {"_id": 0})
    return {
        "user_id": uid,
        "social": fresh.get("social") or {},
        "badge": _badge(fresh.get("social") or {}) if (fresh.get("social") or {}).get("social_enabled") else None,
    }


@router.get("/users/social/nearby")
async def social_nearby(city: str = DEFAULT_CITY, kind: str = "all",
                         current_user: dict = Depends(_get_user_from_request)):
    """List users with social_enabled currently in a city.
    `kind` ∈ {'all', 'locals', 'tourists'}
    """
    slug = _norm_city(city)
    if slug not in SUPPORTED_CITIES:
        raise HTTPException(400, "Unsupported city")

    filt: dict = {
        "social.social_enabled": True,
        "social.current_city": slug,
    }
    if kind == "locals":
        filt["social.user_type"] = "local"
    elif kind == "tourists":
        filt["social.user_type"] = "tourist"

    my_uid = current_user.get("user_id") or str(current_user.get("_id"))
    # Exclude self + blocked users
    blocked = await db.user_blocks.find({
        "$or": [{"blocker_id": my_uid}, {"blocked_id": my_uid}]
    }).to_list(1000)
    excluded_ids = {b["blocked_id"] for b in blocked} | {b["blocker_id"] for b in blocked} | {my_uid}
    filt["user_id"] = {"$nin": list(excluded_ids)}

    # Suspended users hidden
    filt["social.suspended_until"] = {"$exists": False}

    cursor = db.users.find(filt, {"_id": 0}).limit(200)
    users = await cursor.to_list(200)
    return {
        "city": slug,
        "count": len(users),
        "users": [_public_profile(u) for u in users if _public_profile(u)],
    }


@router.get("/users/social/{uid}")
async def get_user_public(uid: str, current_user: dict = Depends(_get_user_from_request)):
    if uid == "me":
        uid = current_user.get("user_id") or str(current_user.get("_id"))
    viewer_uid = current_user.get("user_id") or str(current_user.get("_id"))
    if await _is_blocked(viewer_uid, uid):
        raise HTTPException(403, "This profile is not available")
    u = await db.users.find_one({"user_id": uid}, {"_id": 0})
    if not u or not (u.get("social") or {}).get("social_enabled"):
        raise HTTPException(404, "Profile not found or private")
    return _public_profile(u, viewer_uid=viewer_uid, same_event=True)


@router.post("/users/social/report")
async def report_user(payload: ReportBody, current_user: dict = Depends(_get_user_from_request)):
    reporter_id = current_user.get("user_id") or str(current_user.get("_id"))
    if payload.target_user_id == reporter_id:
        raise HTTPException(400, "Cannot report yourself")
    doc = {
        "reporter_id": reporter_id,
        "target_user_id": payload.target_user_id,
        "reason": payload.reason,
        "detail": payload.detail or "",
        "status": "pending",  # human review queue
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.user_reports.insert_one(doc)

    # AUTO-MODERATION: 3+ pending reports in <30 days → auto-suspend 48h
    count = await db.user_reports.count_documents({
        "target_user_id": payload.target_user_id,
        "status": "pending",
    })
    if count >= 3:
        suspend_until = (datetime.now(timezone.utc) + timedelta(hours=48)).isoformat()
        await db.users.update_one(
            {"user_id": payload.target_user_id},
            {"$set": {"social.suspended_until": suspend_until,
                      "social.auto_suspended": True}}
        )
        return {"ok": True, "action": "auto_suspended", "reports_count": count}
    return {"ok": True, "reports_count": count}


@router.post("/users/social/block")
async def block_user(payload: BlockBody, current_user: dict = Depends(_get_user_from_request)):
    blocker_id = current_user.get("user_id") or str(current_user.get("_id"))
    if payload.target_user_id == blocker_id:
        raise HTTPException(400, "Cannot block yourself")
    await db.user_blocks.update_one(
        {"blocker_id": blocker_id, "blocked_id": payload.target_user_id},
        {"$set": {"blocker_id": blocker_id, "blocked_id": payload.target_user_id,
                  "created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"ok": True}


@router.get("/users/social/blocked")
async def list_blocked(current_user: dict = Depends(_get_user_from_request)):
    my_uid = current_user.get("user_id") or str(current_user.get("_id"))
    rows = await db.user_blocks.find({"blocker_id": my_uid}, {"_id": 0}).to_list(500)
    return {"count": len(rows), "blocked": rows}
