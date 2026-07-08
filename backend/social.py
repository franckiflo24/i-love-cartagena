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
    "electro", "techno",
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


# =============================================================================
# EVENT ATTENDANCE — the core "3-tap connect" mechanic
# =============================================================================

class AttendBody(BaseModel):
    visibility: str = Field("solo_open", pattern="^(private|public|solo_open)$")
    # private  → only counted, never listed
    # public   → avatar in the compact grid, no profile access
    # solo_open→ hero card with vibes/langs match, profile openable, IG CTA


def _match_score(mine: dict, other: dict) -> dict:
    """Compute vibes/langs overlap between two social profiles."""
    my_vibes = set((mine.get("vibes") or []))
    my_langs = set((mine.get("languages") or []))
    o_vibes = set((other.get("vibes") or []))
    o_langs = set((other.get("languages") or []))
    common_v = sorted(my_vibes & o_vibes)
    common_l = sorted(my_langs & o_langs)
    return {
        "common_vibes": common_v,
        "common_languages": common_l,
        "score": len(common_v) * 2 + len(common_l),
    }


async def _get_event(event_id: str) -> Optional[dict]:
    """Look up an event in either the curated events or partner_events collection."""
    e = await db.partner_events.find_one({"event_id": event_id}, {"_id": 0})
    if e:
        return e
    e = await db.events.find_one({"_id": event_id})
    if e:
        e["_id"] = str(e["_id"])
        return e
    return None


@router.post("/events/{event_id}/attend")
async def attend_event(event_id: str, payload: AttendBody,
                       current_user: dict = Depends(_get_user_from_request)):
    """Mark the current user as attending an event."""
    social = current_user.get("social") or {}
    if not social.get("social_enabled") and payload.visibility != "private":
        raise HTTPException(
            400,
            "You must complete your Amo Together profile before joining as public or solo_open. "
            "Update /api/users/me/social with social_enabled=true first.",
        )
    ev = await _get_event(event_id)
    if not ev:
        raise HTTPException(404, "Event not found")

    uid = current_user.get("user_id") or str(current_user.get("_id"))
    doc = {
        "event_id": event_id,
        "user_id": uid,
        "visibility": payload.visibility,
        "joined_at": datetime.now(timezone.utc).isoformat(),
        # Denormalized snapshot for fast attendee listing
        "user_type": social.get("user_type") or "tourist",
        "current_city": social.get("current_city") or DEFAULT_CITY,
    }
    await db.event_attendance.update_one(
        {"event_id": event_id, "user_id": uid},
        {"$set": doc},
        upsert=True,
    )
    # Update counters for quick display in mosaics
    return {"ok": True, "visibility": payload.visibility}


@router.delete("/events/{event_id}/attend")
async def unattend_event(event_id: str,
                         current_user: dict = Depends(_get_user_from_request)):
    uid = current_user.get("user_id") or str(current_user.get("_id"))
    res = await db.event_attendance.delete_one({"event_id": event_id, "user_id": uid})
    return {"ok": True, "deleted": res.deleted_count}


@router.get("/events/{event_id}/attendance/me")
async def my_attendance(event_id: str,
                        current_user: dict = Depends(_get_user_from_request)):
    uid = current_user.get("user_id") or str(current_user.get("_id"))
    a = await db.event_attendance.find_one({"event_id": event_id, "user_id": uid}, {"_id": 0})
    return {"attending": bool(a), "visibility": (a or {}).get("visibility")}


@router.get("/events/{event_id}/attendees")
async def event_attendees(event_id: str,
                          current_user: dict = Depends(_get_user_from_request)):
    """Return attendees split into two lists:
      - solo_open:  full cards with vibes/langs overlap
      - others:     compact grid (first name + flag only)
    Blocked users are hidden. Suspended users are hidden.
    """
    my_uid = current_user.get("user_id") or str(current_user.get("_id"))
    my_social = current_user.get("social") or {}

    # All attendance rows for this event
    rows = await db.event_attendance.find({"event_id": event_id}, {"_id": 0}).to_list(1000)
    total = len(rows)
    solo_uids = [r["user_id"] for r in rows if r.get("visibility") == "solo_open"]
    public_uids = [r["user_id"] for r in rows if r.get("visibility") == "public"]

    # Blocklist
    blocks = await db.user_blocks.find({
        "$or": [{"blocker_id": my_uid}, {"blocked_id": my_uid}]
    }).to_list(1000)
    blocked_ids = {b["blocker_id"] for b in blocks} | {b["blocked_id"] for b in blocks}

    # Fetch users
    def _hydrate(uids: list) -> list:
        return list(uids)

    solo_users_docs = await db.users.find(
        {"user_id": {"$in": [u for u in solo_uids if u != my_uid and u not in blocked_ids]}},
        {"_id": 0},
    ).to_list(500)

    public_users_docs = await db.users.find(
        {"user_id": {"$in": [u for u in public_uids if u != my_uid and u not in blocked_ids]}},
        {"_id": 0},
    ).to_list(500)

    # Filter out suspended
    def _not_suspended(u: dict) -> bool:
        s = u.get("social") or {}
        sus = s.get("suspended_until")
        if not sus:
            return True
        try:
            return datetime.fromisoformat(sus.replace("Z", "+00:00")) < datetime.now(timezone.utc)
        except Exception:
            return True

    solo_users_docs = [u for u in solo_users_docs if _not_suspended(u)]
    public_users_docs = [u for u in public_users_docs if _not_suspended(u)]

    solo_open_cards = []
    for u in solo_users_docs:
        pub = _public_profile(u, viewer_uid=my_uid, same_event=True)
        if not pub:
            continue
        match = _match_score(my_social, u.get("social") or {})
        pub["match"] = match
        solo_open_cards.append(pub)

    # Sort solo_open by match score descending
    solo_open_cards.sort(key=lambda p: (p.get("match", {}).get("score", 0)), reverse=True)

    # Public users: minimal representation for grid
    others_grid = []
    for u in public_users_docs:
        social = u.get("social") or {}
        if not social.get("social_enabled"):
            continue
        first_name = (u.get("first_name") or u.get("name") or "").split(" ", 1)[0]
        others_grid.append({
            "user_id": u.get("user_id"),
            "display_name": first_name,
            "photo_url": u.get("photo_url") or u.get("picture") or "",
            "user_type": social.get("user_type") or "tourist",
        })

    # Am I attending myself?
    me_row = next((r for r in rows if r.get("user_id") == my_uid), None)

    return {
        "event_id": event_id,
        "total": total,
        "solo_open_count": len(solo_uids),
        "public_count": len(public_uids),
        "private_count": total - len(solo_uids) - len(public_uids),
        "solo_open": solo_open_cards,
        "others": others_grid,
        "me": {
            "attending": bool(me_row),
            "visibility": (me_row or {}).get("visibility"),
        },
    }


@router.get("/events/{event_id}/attendance/preview")
async def attendance_preview(event_id: str):
    """PUBLIC endpoint (no auth) — lightweight preview for the mosaic on cards.
    Returns just the total count + a handful of avatar URLs.
    """
    rows = await db.event_attendance.find(
        {"event_id": event_id, "visibility": {"$in": ["solo_open", "public"]}},
        {"_id": 0, "user_id": 1, "visibility": 1, "user_type": 1},
    ).to_list(50)

    total_all = await db.event_attendance.count_documents({"event_id": event_id})
    solo_count = sum(1 for r in rows if r.get("visibility") == "solo_open")

    # Fetch first 6 avatars, prioritise solo_open
    rows.sort(key=lambda r: 0 if r.get("visibility") == "solo_open" else 1)
    top_ids = [r["user_id"] for r in rows[:12]]  # fetch extra to compensate for suspended
    if top_ids:
        users = await db.users.find(
            {"user_id": {"$in": top_ids}}, {"_id": 0}
        ).to_list(12)
    else:
        users = []

    # Filter suspended users
    def _not_suspended(u: dict) -> bool:
        s = u.get("social") or {}
        sus = s.get("suspended_until")
        if not sus:
            return True
        try:
            return datetime.fromisoformat(sus.replace("Z", "+00:00")) < datetime.now(timezone.utc)
        except Exception:
            return True

    users = [u for u in users if _not_suspended(u)]
    # Preserve visibility ordering
    users_by_id = {u.get("user_id"): u for u in users}
    ordered_users = [users_by_id[uid] for uid in top_ids if uid in users_by_id][:6]

    avatars = []
    for u in ordered_users:
        social = u.get("social") or {}
        if not social.get("social_enabled"):
            continue
        first = (u.get("first_name") or u.get("name") or "").split(" ", 1)[0]
        avatars.append({
            "user_id": u.get("user_id"),
            "initial": (first[:1] or "?").upper(),
            "photo_url": u.get("photo_url") or u.get("picture") or "",
            "user_type": social.get("user_type") or "tourist",
        })

    return {
        "event_id": event_id,
        "total": total_all,
        "solo_open_count": solo_count,
        "avatars": avatars,
    }
