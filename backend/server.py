from fastapi import FastAPI, APIRouter, HTTPException, Request, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, logging, uuid, httpx
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ── Models ──────────────────────────────────────────────────
class UserOut(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None

class SessionExchange(BaseModel):
    session_id: str

# ── Auth Endpoints ──────────────────────────────────────────
@api_router.post("/auth/session")
async def exchange_session(body: SessionExchange, response: Response):
    try:
        async with httpx.AsyncClient() as hc:
            r = await hc.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": body.session_id},
                timeout=15
            )
            if r.status_code != 200:
                raise HTTPException(status_code=401, detail="Invalid session")
            data = r.json()
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Auth service unavailable")

    email = data["email"]
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = {
            "user_id": user_id,
            "email": email,
            "name": data.get("name", ""),
            "picture": data.get("picture", ""),
            "favorites": [],
            "my_week": [],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.users.insert_one(user)
        user = await db.users.find_one({"email": email}, {"_id": 0})
    else:
        user_id = user["user_id"]

    session_token = data.get("session_token", f"st_{uuid.uuid4().hex}")
    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user["user_id"],
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })

    response.set_cookie(
        key="session_token", value=session_token,
        httponly=True, secure=True, samesite="none",
        path="/", max_age=7*24*3600
    )
    return {"user": {k: v for k, v in user.items() if k != "_id"}, "session_token": session_token}


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("session_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    expires_at = session["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")

    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@api_router.get("/auth/me")
async def auth_me(request: Request):
    user = await get_current_user(request)
    return UserOut(**user)


@api_router.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/")
    return {"ok": True}


# ── Events ──────────────────────────────────────────────────
@api_router.get("/events")
async def list_events(
    date: Optional[str] = None,
    event_type: Optional[str] = None,
    is_free: Optional[bool] = None,
    venue_id: Optional[str] = None,
):
    query = {}
    if date:
        query["date"] = date
    if event_type:
        query["type"] = event_type
    if is_free is not None:
        query["is_free"] = is_free
    if venue_id:
        query["venue_id"] = venue_id
    events = await db.events.find(query, {"_id": 0}).sort("start_time", 1).to_list(200)
    return events


@api_router.get("/events/featured")
async def featured_events():
    events = await db.events.find({"featured": True}, {"_id": 0}).to_list(10)
    if not events:
        events = await db.events.find({}, {"_id": 0}).limit(6).to_list(6)
    return events


@api_router.get("/events/{event_id}")
async def get_event(event_id: str):
    event = await db.events.find_one({"event_id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


@api_router.get("/events/dates/available")
async def available_dates():
    dates = await db.events.distinct("date")
    return sorted(dates)


# ── Venues ──────────────────────────────────────────────────
@api_router.get("/venues")
async def list_venues(venue_type: Optional[str] = None):
    query = {"type": venue_type} if venue_type else {}
    venues = await db.venues.find(query, {"_id": 0}).to_list(100)
    return venues


@api_router.get("/venues/{venue_id}")
async def get_venue(venue_id: str):
    venue = await db.venues.find_one({"venue_id": venue_id}, {"_id": 0})
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")
    return venue


# ── Partners ────────────────────────────────────────────────
@api_router.get("/partners")
async def list_partners(category: Optional[str] = None):
    query = {"category": category} if category else {}
    partners = await db.partners.find(query, {"_id": 0}).to_list(100)
    return partners


@api_router.get("/partners/{partner_id}")
async def get_partner(partner_id: str):
    partner = await db.partners.find_one({"partner_id": partner_id}, {"_id": 0})
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    return partner


# ── Itineraries ─────────────────────────────────────────────
@api_router.get("/itineraries")
async def list_itineraries():
    return await db.itineraries.find({}, {"_id": 0}).to_list(20)


@api_router.get("/itineraries/{itinerary_id}")
async def get_itinerary(itinerary_id: str):
    it = await db.itineraries.find_one({"itinerary_id": itinerary_id}, {"_id": 0})
    if not it:
        raise HTTPException(status_code=404, detail="Itinerary not found")
    return it


# ── Transport ───────────────────────────────────────────────
@api_router.get("/transport")
async def list_transport():
    return await db.transport.find({}, {"_id": 0}).to_list(50)


# ── Notifications ───────────────────────────────────────────
@api_router.get("/notifications")
async def list_notifications(request: Request):
    user = await get_current_user(request)
    notifs = await db.notifications.find(
        {"$or": [{"user_id": user["user_id"]}, {"user_id": None}]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    return notifs


@api_router.put("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, request: Request):
    await get_current_user(request)
    await db.notifications.update_one(
        {"notification_id": notification_id},
        {"$set": {"is_read": True}}
    )
    return {"ok": True}


# ── Favorites ───────────────────────────────────────────────
@api_router.post("/favorites/toggle")
async def toggle_favorite(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    event_id = body.get("event_id")
    if not event_id:
        raise HTTPException(status_code=400, detail="event_id required")
    favs = user.get("favorites", [])
    if event_id in favs:
        favs.remove(event_id)
        action = "removed"
    else:
        favs.append(event_id)
        action = "added"
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"favorites": favs}})
    return {"action": action, "favorites": favs}


@api_router.get("/favorites")
async def list_favorites(request: Request):
    user = await get_current_user(request)
    favs = user.get("favorites", [])
    if not favs:
        return []
    events = await db.events.find({"event_id": {"$in": favs}}, {"_id": 0}).to_list(100)
    return events


# ── My Week ─────────────────────────────────────────────────
@api_router.post("/my-week/toggle")
async def toggle_my_week(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    event_id = body.get("event_id")
    if not event_id:
        raise HTTPException(status_code=400, detail="event_id required")
    week = user.get("my_week", [])
    if event_id in week:
        week.remove(event_id)
        action = "removed"
    else:
        week.append(event_id)
        action = "added"
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": {"my_week": week}})
    return {"action": action, "my_week": week}


@api_router.get("/my-week")
async def list_my_week(request: Request):
    user = await get_current_user(request)
    week = user.get("my_week", [])
    if not week:
        return []
    events = await db.events.find({"event_id": {"$in": week}}, {"_id": 0}).to_list(100)
    return events


# ── Event Types & Categories ────────────────────────────────
@api_router.get("/event-types")
async def event_types():
    return ["sunset", "concert", "wellness", "brunch", "beach_club", "after_party", "cultural", "candlelight", "pop_up"]


@api_router.get("/partner-categories")
async def partner_categories():
    return ["restaurant", "club", "beach_club", "hotel", "wellness", "cultural"]


# ── Seasons (Multi-event platform) ──────────────────────────
@api_router.get("/seasons")
async def list_seasons(active: Optional[bool] = None):
    query = {}
    if active is not None:
        query["is_active"] = active
    seasons = await db.seasons.find(query, {"_id": 0}).sort("start_date", 1).to_list(50)
    return seasons


@api_router.get("/seasons/{season_id}")
async def get_season(season_id: str):
    season = await db.seasons.find_one({"season_id": season_id}, {"_id": 0})
    if not season:
        raise HTTPException(status_code=404, detail="Season not found")
    return season


@api_router.get("/seasons/{season_id}/events")
async def season_events(season_id: str, date: Optional[str] = None):
    query = {"season_id": season_id}
    if date:
        query["date"] = date
    events = await db.events.find(query, {"_id": 0}).sort("start_time", 1).to_list(200)
    return events


# ── Analytics ───────────────────────────────────────────────
class AnalyticsEvent(BaseModel):
    event_type: str  # page_view, event_click, partner_click, booking_click, search, filter
    target_id: Optional[str] = None
    target_type: Optional[str] = None  # event, venue, partner, season, itinerary
    metadata: Optional[dict] = None

@api_router.post("/analytics/track")
async def track_analytics(body: AnalyticsEvent, request: Request):
    user_id = None
    try:
        user = await get_current_user(request)
        user_id = user["user_id"]
    except:
        pass  # Anonymous tracking OK

    doc = {
        "analytics_id": f"an_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "event_type": body.event_type,
        "target_id": body.target_id,
        "target_type": body.target_type,
        "metadata": body.metadata or {},
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "user_agent": request.headers.get("user-agent", ""),
    }
    await db.analytics.insert_one(doc)
    return {"ok": True}


@api_router.get("/analytics/summary")
async def analytics_summary(request: Request):
    """Dashboard summary for admins - event popularity, user engagement, etc."""
    total_users = await db.users.count_documents({})
    total_events = await db.events.count_documents({})
    total_partners = await db.partners.count_documents({})
    total_interactions = await db.analytics.count_documents({})
    total_seasons = await db.seasons.count_documents({})
    total_passes = await db.city_passes.count_documents({})

    # Top viewed events
    pipeline = [
        {"$match": {"event_type": "event_click"}},
        {"$group": {"_id": "$target_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 10}
    ]
    top_events_raw = await db.analytics.aggregate(pipeline).to_list(10)
    top_events = []
    for e in top_events_raw:
        evt = await db.events.find_one({"event_id": e["_id"]}, {"_id": 0, "event_id": 1, "title": 1, "type": 1, "venue_name": 1})
        top_events.append({"event_id": e["_id"], "views": e["count"], "title": evt["title"] if evt else "Unknown", "type": evt.get("type", "") if evt else "", "venue": evt.get("venue_name", "") if evt else ""})

    # Interactions by type
    type_pipeline = [
        {"$group": {"_id": "$event_type", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}
    ]
    interactions_by_type = await db.analytics.aggregate(type_pipeline).to_list(20)

    # Top partners clicked
    partner_pipeline = [
        {"$match": {"event_type": "partner_click"}},
        {"$group": {"_id": "$target_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 5}
    ]
    top_partners_raw = await db.analytics.aggregate(partner_pipeline).to_list(5)
    top_partners = []
    for p in top_partners_raw:
        ptr = await db.partners.find_one({"partner_id": p["_id"]}, {"_id": 0, "partner_id": 1, "name": 1, "category": 1})
        top_partners.append({"partner_id": p["_id"], "clicks": p["count"], "name": ptr["name"] if ptr else "Unknown", "category": ptr.get("category", "") if ptr else ""})

    # Events per season
    season_pipeline = [
        {"$group": {"_id": "$season_id", "count": {"$sum": 1}}},
    ]
    events_per_season_raw = await db.events.aggregate(season_pipeline).to_list(20)
    events_per_season = []
    for s in events_per_season_raw:
        ssn = await db.seasons.find_one({"season_id": s["_id"]}, {"_id": 0, "season_id": 1, "name": 1, "color": 1}) if s["_id"] else None
        events_per_season.append({"season_id": s["_id"] or "none", "count": s["count"], "name": ssn["name"] if ssn else "Sin temporada", "color": ssn.get("color", "#666") if ssn else "#666"})

    # Booking clicks (revenue potential)
    booking_clicks = await db.analytics.count_documents({"event_type": "booking_click"})

    return {
        "total_users": total_users,
        "total_events": total_events,
        "total_partners": total_partners,
        "total_interactions": total_interactions,
        "total_seasons": total_seasons,
        "total_passes": total_passes,
        "booking_clicks": booking_clicks,
        "top_events": top_events,
        "top_partners": top_partners,
        "interactions_by_type": [{"type": e["_id"] or "unknown", "count": e["count"]} for e in interactions_by_type],
        "events_per_season": events_per_season,
    }


@api_router.get("/analytics/dashboard")
async def analytics_dashboard_v2(request: Request):
    """Enhanced dashboard for government/sponsors - comprehensive city data."""
    import random

    # ── Core KPIs ──
    total_users = await db.users.count_documents({})
    total_events = await db.events.count_documents({})
    total_partners = await db.partners.count_documents({})
    total_interactions = await db.analytics.count_documents({})
    total_seasons = await db.seasons.count_documents({})
    total_passes = await db.city_passes.count_documents({})
    booking_clicks = await db.analytics.count_documents({"event_type": "booking_click"})

    # ── User Demographics (from analytics_demographics collection) ──
    demographics = await db.analytics_demographics.find({}, {"_id": 0}).to_list(500)
    nationality_counts = {}
    age_counts = {}
    gender_counts = {}
    for d in demographics:
        nat = d.get("nationality", "Desconocido")
        nationality_counts[nat] = nationality_counts.get(nat, 0) + 1
        age = d.get("age_group", "Desconocido")
        age_counts[age] = age_counts.get(age, 0) + 1
        gen = d.get("gender", "Desconocido")
        gender_counts[gen] = gender_counts.get(gen, 0) + 1

    nationalities = [{"country": k, "count": v, "percentage": round(v / max(len(demographics), 1) * 100, 1)} for k, v in sorted(nationality_counts.items(), key=lambda x: -x[1])]
    age_groups = [{"group": k, "count": v} for k, v in sorted(age_counts.items())]
    genders = [{"gender": k, "count": v} for k, v in sorted(gender_counts.items(), key=lambda x: -x[1])]

    # ── Daily Activity (last 14 days from analytics) ──
    daily_data = await db.analytics_daily.find({}, {"_id": 0}).sort("date", 1).to_list(30)

    # ── Hourly Heatmap ──
    hourly_data = await db.analytics_hourly.find({}, {"_id": 0}).to_list(24)

    # ── Conversion Funnel ──
    page_views = await db.analytics.count_documents({"event_type": "page_view"})
    event_clicks = await db.analytics.count_documents({"event_type": "event_click"})
    partner_clicks = await db.analytics.count_documents({"event_type": "partner_click"})

    funnel = [
        {"stage": "Visitas", "count": page_views, "color": "#3B82F6"},
        {"stage": "Clicks eventos", "count": event_clicks, "color": "#D97706"},
        {"stage": "Clicks partners", "count": partner_clicks, "color": "#8B5CF6"},
        {"stage": "Clicks reserva", "count": booking_clicks, "color": "#22C55E"},
    ]

    # ── Revenue Estimates ──
    passes_by_tier = await db.city_passes.aggregate([
        {"$group": {"_id": "$plan_id", "count": {"$sum": 1}}}
    ]).to_list(10)
    tier_prices = {"pass_basic": 99000, "pass_premium": 299000, "pass_ultimate": 599000}
    tier_names = {"pass_basic": "Explorer", "pass_premium": "VIP", "pass_ultimate": "Ultimate"}
    revenue_data = []
    total_revenue = 0
    for t in passes_by_tier:
        plan = t["_id"] or "unknown"
        count = t["count"]
        price = tier_prices.get(plan, 0)
        rev = count * price
        total_revenue += rev
        revenue_data.append({
            "tier": tier_names.get(plan, plan),
            "count": count,
            "unit_price": price,
            "total": rev,
        })

    # ── Top Events ──
    top_events_pipeline = [
        {"$match": {"event_type": "event_click"}},
        {"$group": {"_id": "$target_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 10}
    ]
    top_events_raw = await db.analytics.aggregate(top_events_pipeline).to_list(10)
    top_events = []
    for e in top_events_raw:
        evt = await db.events.find_one({"event_id": e["_id"]}, {"_id": 0, "event_id": 1, "title": 1, "type": 1, "venue_name": 1})
        top_events.append({
            "event_id": e["_id"], "views": e["count"],
            "title": evt["title"] if evt else "Unknown",
            "type": evt.get("type", "") if evt else "",
            "venue": evt.get("venue_name", "") if evt else ""
        })

    # ── Top Partners ──
    partner_pipeline = [
        {"$match": {"event_type": "partner_click"}},
        {"$group": {"_id": "$target_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 8}
    ]
    top_partners_raw = await db.analytics.aggregate(partner_pipeline).to_list(8)
    top_partners = []
    for p in top_partners_raw:
        ptr = await db.partners.find_one({"partner_id": p["_id"]}, {"_id": 0, "partner_id": 1, "name": 1, "category": 1})
        top_partners.append({
            "partner_id": p["_id"], "clicks": p["count"],
            "name": ptr["name"] if ptr else "Unknown",
            "category": ptr.get("category", "") if ptr else ""
        })

    # ── Interactions by Type ──
    type_pipeline = [
        {"$group": {"_id": "$event_type", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}
    ]
    interactions_by_type = await db.analytics.aggregate(type_pipeline).to_list(20)

    # ── Events per Season ──
    season_pipeline = [{"$group": {"_id": "$season_id", "count": {"$sum": 1}}}]
    eps_raw = await db.events.aggregate(season_pipeline).to_list(20)
    events_per_season = []
    for s in eps_raw:
        ssn = await db.seasons.find_one({"season_id": s["_id"]}, {"_id": 0, "season_id": 1, "name": 1, "color": 1}) if s["_id"] else None
        events_per_season.append({
            "season_id": s["_id"] or "none", "count": s["count"],
            "name": ssn["name"] if ssn else "Sin temporada",
            "color": ssn.get("color", "#666") if ssn else "#666"
        })

    # ── Venue Heatmap (top venues by interactions) ──
    venue_pipeline = [
        {"$match": {"target_type": "venue"}},
        {"$group": {"_id": "$target_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 10}
    ]
    top_venues_raw = await db.analytics.aggregate(venue_pipeline).to_list(10)
    top_venues = []
    for v in top_venues_raw:
        ven = await db.venues.find_one({"venue_id": v["_id"]}, {"_id": 0, "venue_id": 1, "name": 1, "type": 1})
        top_venues.append({
            "venue_id": v["_id"], "interactions": v["count"],
            "name": ven["name"] if ven else "Unknown",
            "type": ven.get("type", "") if ven else ""
        })

    # ── Transport Usage ──
    transport_usage = await db.analytics.count_documents({"event_type": "transport_view"})
    map_views = await db.analytics.count_documents({"event_type": "map_view"})

    return {
        "kpis": {
            "total_users": total_users,
            "total_events": total_events,
            "total_partners": total_partners,
            "total_interactions": total_interactions,
            "total_seasons": total_seasons,
            "total_passes": total_passes,
            "booking_clicks": booking_clicks,
            "total_revenue_cop": total_revenue,
            "transport_views": transport_usage,
            "map_views": map_views,
        },
        "demographics": {
            "nationalities": nationalities,
            "age_groups": age_groups,
            "genders": genders,
            "total_profiled": len(demographics),
        },
        "daily_activity": daily_data,
        "hourly_activity": hourly_data,
        "funnel": funnel,
        "revenue": {
            "total_cop": total_revenue,
            "by_tier": revenue_data,
        },
        "top_events": top_events,
        "top_partners": top_partners,
        "top_venues": top_venues,
        "interactions_by_type": [{"type": e["_id"] or "unknown", "count": e["count"]} for e in interactions_by_type],
        "events_per_season": events_per_season,
    }


# ── City Pass ───────────────────────────────────────────────
@api_router.get("/city-pass/plans")
async def city_pass_plans():
    return [
        {"plan_id": "pass_basic", "name": "Explorer Pass", "price": 99000, "currency": "COP", "duration_days": 7, "color": "#D97706",
         "benefits": ["Welcome drink en partners", "Prioridad de reserva", "5% descuento en experiencias", "Transporte nocturno gratis", "Acceso anticipado a eventos"]},
        {"plan_id": "pass_premium", "name": "VIP Pass", "price": 299000, "currency": "COP", "duration_days": 7, "color": "#EAB308",
         "benefits": ["Todo lo del Explorer Pass", "15% descuento en experiencias", "Mesa prioritaria en restaurantes", "Acceso VIP a venues", "Concierge personal", "Boat transfer incluido"]},
        {"plan_id": "pass_ultimate", "name": "Ultimate Pass", "price": 599000, "currency": "COP", "duration_days": 7, "color": "#F59E0B",
         "benefits": ["Todo lo del VIP Pass", "30% descuento en experiencias", "Acceso backstage", "Experiencias exclusivas", "Chef privado una noche", "Transfer aeropuerto incluido"]},
    ]


@api_router.post("/city-pass/activate")
async def activate_city_pass(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    plan_id = body.get("plan_id")
    if not plan_id:
        raise HTTPException(status_code=400, detail="plan_id required")

    existing = await db.city_passes.find_one({"user_id": user["user_id"], "is_active": True}, {"_id": 0})
    if existing:
        return {"status": "already_active", "pass": existing}

    pass_doc = {
        "pass_id": f"cp_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "plan_id": plan_id,
        "activated_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
        "is_active": True,
    }
    await db.city_passes.insert_one(pass_doc)
    return {"status": "activated", "pass": {k: v for k, v in pass_doc.items() if k != "_id"}}


@api_router.get("/city-pass/mine")
async def my_city_pass(request: Request):
    user = await get_current_user(request)
    active = await db.city_passes.find_one({"user_id": user["user_id"], "is_active": True}, {"_id": 0})
    return active


# ── Seed Data ───────────────────────────────────────────────
async def seed_database():
    count = await db.seasons.count_documents({})
    if count > 0:
        logger.info("Database already seeded")
        return

    logger.info("Seeding database...")

    IMG_SUNSET = "https://images.unsplash.com/photo-1651421479936-e24edc3e3143?w=800"
    IMG_CONCERT = "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800"
    IMG_BEACH = "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800"
    IMG_YOGA = "https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800"
    IMG_BRUNCH = "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800"
    IMG_NIGHT = "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800"
    IMG_CULTURE = "https://images.unsplash.com/photo-1583037189850-1921ae7c6c22?w=800"
    IMG_CANDLE = "https://images.unsplash.com/photo-1543747579-795b9c2c3ada?w=800"
    IMG_POPUP = "https://images.unsplash.com/photo-1531058020387-3be344556be6?w=800"
    IMG_JAZZ = "https://images.unsplash.com/photo-1415201364774-f6f0bb35f28f?w=800"
    IMG_DJ = "https://images.unsplash.com/photo-1571266028243-e4733b0f0bb0?w=800"
    IMG_CLOSING = "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800"
    IMG_FOOD = "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800"
    IMG_FILM = "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800"
    IMG_WELLNESS = "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=800"

    # ── Seasons ──
    seasons = [
        {
            "season_id": "season_001",
            "name": "Music Week",
            "subtitle": "La experiencia de ciudad",
            "description": "La semana de música más importante de Cartagena. Sunsets, Templo, beach clubs, cultura y wellness.",
            "start_date": "2025-12-30",
            "end_date": "2026-01-10",
            "image_url": IMG_SUNSET,
            "color": "#D97706",
            "tags": ["Sunset", "Templo", "Beach", "Cultura", "Wellness"],
            "is_active": True,
            "event_count": 15,
        },
        {
            "season_id": "season_002",
            "name": "Semana Gastronómica",
            "subtitle": "Sabores del Caribe",
            "description": "Los mejores chefs y restaurantes de Cartagena se unen para una semana de experiencias gastronómicas únicas.",
            "start_date": "2026-02-09",
            "end_date": "2026-02-15",
            "image_url": IMG_FOOD,
            "color": "#DC2626",
            "tags": ["Gastronomía", "Chefs", "Maridaje", "Street Food", "Fine Dining"],
            "is_active": True,
            "event_count": 0,
        },
        {
            "season_id": "season_003",
            "name": "Summer Vibes",
            "subtitle": "El verano de Cartagena",
            "description": "Tres semanas de fiesta, playa, música electrónica y experiencias de verano en los mejores venues de Cartagena.",
            "start_date": "2026-08-01",
            "end_date": "2026-08-21",
            "image_url": IMG_BEACH,
            "color": "#06B6D4",
            "tags": ["Beach Party", "Pool Party", "DJ Sets", "Sunset", "Summer"],
            "is_active": True,
            "event_count": 0,
        },
        {
            "season_id": "season_004",
            "name": "Wellness Week",
            "subtitle": "Reconecta cuerpo y mente",
            "description": "Yoga, meditación, sound healing, retiros y experiencias de bienestar en los lugares más hermosos de Cartagena.",
            "start_date": "2026-04-06",
            "end_date": "2026-04-12",
            "image_url": IMG_WELLNESS,
            "color": "#059669",
            "tags": ["Yoga", "Meditación", "Sound Healing", "Retiros", "Spa"],
            "is_active": False,
            "event_count": 0,
        },
    ]

    events = [
        {"event_id":"evt_001","title":"Sunset Session","description":"Live DJ set contra el telón del legendario atardecer de Cartagena desde las murallas coloniales. Música chill, cócteles y vistas increíbles.","date":"2026-01-12","start_time":"17:00","end_time":"20:00","venue_id":"ven_001","venue_name":"La Muralla","type":"sunset","is_free":True,"price":0,"image_url":IMG_SUNSET,"booking_link":"","capacity":500,"tags":["outdoor","music","sunset","free"],"location":{"lat":10.4236,"lng":-75.5483},"featured":True},
        {"event_id":"evt_002","title":"Electronic Sunset","description":"Sesión electrónica al atardecer con los mejores DJs internacionales. Drinks premium incluidos.","date":"2026-01-12","start_time":"16:00","end_time":"21:00","venue_id":"ven_005","venue_name":"Café del Mar","type":"sunset","is_free":False,"price":150000,"image_url":IMG_DJ,"booking_link":"https://cafeDelmar.com/reserve","capacity":200,"tags":["electronic","sunset","premium"],"location":{"lat":10.4260,"lng":-75.5490},"featured":True},
        {"event_id":"evt_003","title":"Templo Night I","description":"La primera noche de Templo. Line-up internacional con los artistas más relevantes de la escena electrónica latina.","date":"2026-01-12","start_time":"22:00","end_time":"05:00","venue_id":"ven_002","venue_name":"Templo","type":"concert","is_free":False,"price":250000,"image_url":IMG_CONCERT,"booking_link":"https://templo.co/tickets","capacity":2000,"tags":["electronic","nightlife","headline"],"location":{"lat":10.4195,"lng":-75.5455},"featured":True},
        {"event_id":"evt_004","title":"Sunrise Yoga","description":"Yoga al amanecer en la muralla con vista al mar Caribe. Incluye mat y agua.","date":"2026-01-13","start_time":"06:00","end_time":"07:30","venue_id":"ven_001","venue_name":"La Muralla","type":"wellness","is_free":True,"price":0,"image_url":IMG_YOGA,"booking_link":"","capacity":60,"tags":["wellness","yoga","free","morning"],"location":{"lat":10.4236,"lng":-75.5483},"featured":False},
        {"event_id":"evt_005","title":"Brunch & Beats","description":"Brunch gourmet con DJ en vivo. Menú de autor con ingredientes locales y cócteles tropicales.","date":"2026-01-13","start_time":"11:00","end_time":"15:00","venue_id":"ven_003","venue_name":"Casa Bohème","type":"brunch","is_free":False,"price":180000,"image_url":IMG_BRUNCH,"booking_link":"https://casaboheme.co/brunch","capacity":80,"tags":["food","music","brunch"],"location":{"lat":10.4228,"lng":-75.5510},"featured":True},
        {"event_id":"evt_006","title":"Beach Day Party","description":"Fiesta de día completa en la playa de Barú. Open bar, DJ internacional, comida de mar.","date":"2026-01-13","start_time":"10:00","end_time":"18:00","venue_id":"ven_008","venue_name":"Isla Barú Beach Club","type":"beach_club","is_free":False,"price":350000,"image_url":IMG_BEACH,"booking_link":"https://barubeach.com/party","capacity":300,"tags":["beach","party","all-inclusive"],"location":{"lat":10.1817,"lng":-75.5847},"featured":True},
        {"event_id":"evt_007","title":"Candlelight Classical","description":"Concierto íntimo de música clásica a la luz de velas en el claustro de San Pedro Claver.","date":"2026-01-13","start_time":"20:00","end_time":"22:00","venue_id":"ven_006","venue_name":"San Pedro Claver","type":"candlelight","is_free":False,"price":200000,"image_url":IMG_CANDLE,"booking_link":"https://candlelight.co/cartagena","capacity":120,"tags":["classical","intimate","cultural"],"location":{"lat":10.4228,"lng":-75.5498},"featured":False},
        {"event_id":"evt_008","title":"Templo Night II","description":"Segunda noche de Templo. After movie night con artistas sorpresa y producción inmersiva.","date":"2026-01-14","start_time":"22:00","end_time":"06:00","venue_id":"ven_002","venue_name":"Templo","type":"concert","is_free":False,"price":280000,"image_url":IMG_NIGHT,"booking_link":"https://templo.co/tickets","capacity":2000,"tags":["electronic","nightlife","headline"],"location":{"lat":10.4195,"lng":-75.5455},"featured":True},
        {"event_id":"evt_009","title":"Pop-Up Art Gallery","description":"Exposición de arte contemporáneo colombiano en los salones del Hotel Santa Clara.","date":"2026-01-14","start_time":"10:00","end_time":"20:00","venue_id":"ven_007","venue_name":"Hotel Santa Clara","type":"pop_up","is_free":True,"price":0,"image_url":IMG_POPUP,"booking_link":"","capacity":0,"tags":["art","culture","free"],"location":{"lat":10.4232,"lng":-75.5502},"featured":False},
        {"event_id":"evt_010","title":"Jazz & Wine Night","description":"Noche de jazz en vivo con maridaje de vinos premium. Artistas locales e internacionales.","date":"2026-01-14","start_time":"20:00","end_time":"00:00","venue_id":"ven_004","venue_name":"Bellini","type":"cultural","is_free":False,"price":220000,"image_url":IMG_JAZZ,"booking_link":"https://bellini.co/jazz","capacity":80,"tags":["jazz","wine","intimate"],"location":{"lat":10.4240,"lng":-75.5475},"featured":False},
        {"event_id":"evt_011","title":"Morning Spinning","description":"Clase de spinning de alta energía frente al mar. 45 minutos de música y sudor.","date":"2026-01-15","start_time":"07:00","end_time":"08:00","venue_id":"ven_009","venue_name":"Blue Apple Beach","type":"wellness","is_free":False,"price":80000,"image_url":IMG_YOGA,"booking_link":"https://blueapple.co/spinning","capacity":30,"tags":["wellness","fitness","morning"],"location":{"lat":10.1780,"lng":-75.5800},"featured":False},
        {"event_id":"evt_012","title":"Folklore Show","description":"Show de danzas folclóricas colombianas en la Plaza Santo Domingo. Cultura viva.","date":"2026-01-15","start_time":"18:00","end_time":"20:00","venue_id":"ven_001","venue_name":"Plaza Santo Domingo","type":"cultural","is_free":True,"price":0,"image_url":IMG_CULTURE,"booking_link":"","capacity":500,"tags":["folklore","dance","free","cultural"],"location":{"lat":10.4233,"lng":-75.5512},"featured":False},
        {"event_id":"evt_013","title":"After Party Fénix","description":"After party oficial en Fénix. Los mejores DJs de la semana se reúnen para una última noche épica.","date":"2026-01-15","start_time":"01:00","end_time":"07:00","venue_id":"ven_010","venue_name":"Fénix","type":"after_party","is_free":False,"price":120000,"image_url":IMG_NIGHT,"booking_link":"https://fenix.co/after","capacity":400,"tags":["nightlife","electronic","after-party"],"location":{"lat":10.4200,"lng":-75.5460},"featured":False},
        {"event_id":"evt_014","title":"Sunset Closing","description":"Ceremonia de cierre con DJ set y performance artístico en la muralla. El atardecer final de I ❤️ Cartagena.","date":"2026-01-16","start_time":"17:00","end_time":"21:00","venue_id":"ven_001","venue_name":"La Muralla","type":"sunset","is_free":True,"price":0,"image_url":IMG_CLOSING,"booking_link":"","capacity":1000,"tags":["closing","sunset","free","special"],"location":{"lat":10.4236,"lng":-75.5483},"featured":True},
        {"event_id":"evt_015","title":"DJ Set Blue Apple","description":"Set electrónico en el beach club más exclusivo de las islas. Transporte en lancha incluido.","date":"2026-01-14","start_time":"14:00","end_time":"20:00","venue_id":"ven_009","venue_name":"Blue Apple Beach","type":"beach_club","is_free":False,"price":400000,"image_url":IMG_BEACH,"booking_link":"https://blueapple.co/djset","capacity":150,"tags":["beach","electronic","exclusive"],"location":{"lat":10.1780,"lng":-75.5800},"featured":False},
    ]

    venues = [
        {"venue_id":"ven_001","name":"La Muralla","description":"Las icónicas murallas coloniales de Cartagena. Escenario principal de los sunsets y eventos culturales al aire libre.","type":"historic","address":"Murallas de Cartagena, Centro Histórico","location":{"lat":10.4236,"lng":-75.5483},"images":[IMG_SUNSET,IMG_CLOSING],"contact":{"phone":"+57 300 123 4567"},"hours":"Acceso 24h","price_range":"Gratis","booking_link":""},
        {"venue_id":"ven_002","name":"Templo","description":"El venue principal de Cartagena Music Week. Producción de primer nivel mundial con sonido e iluminación inmersiva.","type":"nightclub","address":"Av. Pedro de Heredia, Getsemaní","location":{"lat":10.4195,"lng":-75.5455},"images":[IMG_CONCERT,IMG_NIGHT],"contact":{"phone":"+57 300 234 5678","email":"info@templo.co"},"hours":"22:00 - 06:00","price_range":"$$$","booking_link":"https://templo.co/tickets"},
        {"venue_id":"ven_003","name":"Casa Bohème","description":"Restaurante y bar de diseño en el corazón del centro histórico. Cocina de autor y cócteles artesanales.","type":"restaurant","address":"Calle de la Iglesia #35-76, Centro Histórico","location":{"lat":10.4228,"lng":-75.5510},"images":[IMG_BRUNCH],"contact":{"phone":"+57 300 345 6789","email":"reservas@casaboheme.co"},"hours":"11:00 - 02:00","price_range":"$$","booking_link":"https://casaboheme.co"},
        {"venue_id":"ven_004","name":"Bellini","description":"Fine dining con vista al mar. Cocina mediterránea fusión con ingredientes locales del Caribe colombiano.","type":"restaurant","address":"Calle del Arsenal #10-40, Getsemaní","location":{"lat":10.4240,"lng":-75.5475},"images":[IMG_JAZZ],"contact":{"phone":"+57 300 456 7890","email":"reservas@bellini.co"},"hours":"18:00 - 00:00","price_range":"$$$","booking_link":"https://bellini.co"},
        {"venue_id":"ven_005","name":"Café del Mar","description":"Bar icónico sobre las murallas con las mejores vistas del atardecer de Cartagena.","type":"restaurant","address":"Baluarte de Santo Domingo, Centro Histórico","location":{"lat":10.4260,"lng":-75.5490},"images":[IMG_SUNSET],"contact":{"phone":"+57 300 567 8901"},"hours":"16:00 - 02:00","price_range":"$$","booking_link":"https://cafedelmar.com"},
        {"venue_id":"ven_006","name":"San Pedro Claver","description":"Iglesia y claustro del siglo XVII. Escenario de los conciertos candlelight y eventos culturales.","type":"cultural","address":"Plaza de San Pedro Claver, Centro Histórico","location":{"lat":10.4228,"lng":-75.5498},"images":[IMG_CANDLE,IMG_CULTURE],"contact":{"phone":"+57 300 678 9012"},"hours":"08:00 - 18:00 (eventos especiales hasta 23:00)","price_range":"$","booking_link":""},
        {"venue_id":"ven_007","name":"Hotel Santa Clara","description":"Hotel boutique de lujo en un convento del siglo XVII. Sede de pop-ups artísticos y experiencias exclusivas.","type":"hotel","address":"Calle del Torno #39-29, Centro Histórico","location":{"lat":10.4232,"lng":-75.5502},"images":[IMG_POPUP],"contact":{"phone":"+57 300 789 0123","email":"events@hotelsantaclara.com"},"hours":"24h","price_range":"$$$$","booking_link":"https://hotelsantaclara.com"},
        {"venue_id":"ven_008","name":"Isla Barú Beach Club","description":"Beach club exclusivo en Playa Blanca, Barú. El destino de playa del festival.","type":"beach_club","address":"Playa Blanca, Isla Barú","location":{"lat":10.1817,"lng":-75.5847},"images":[IMG_BEACH],"contact":{"phone":"+57 300 890 1234"},"hours":"09:00 - 18:00","price_range":"$$$","booking_link":"https://barubeach.com"},
        {"venue_id":"ven_009","name":"Blue Apple Beach","description":"Beach club boutique en la Isla del Encanto. Experiencias wellness, gastronomía y fiestas exclusivas.","type":"beach_club","address":"Isla del Encanto, Islas del Rosario","location":{"lat":10.1780,"lng":-75.5800},"images":[IMG_BEACH],"contact":{"phone":"+57 300 901 2345","email":"info@blueapple.co"},"hours":"08:00 - 18:00","price_range":"$$$$","booking_link":"https://blueapple.co"},
        {"venue_id":"ven_010","name":"Fénix","description":"Club nocturno de diseño en Getsemaní. After parties oficiales de Cartagena Music Week.","type":"nightclub","address":"Calle de la Sierpe #9-75, Getsemaní","location":{"lat":10.4200,"lng":-75.5460},"images":[IMG_NIGHT],"contact":{"phone":"+57 300 012 3456"},"hours":"00:00 - 07:00","price_range":"$$","booking_link":"https://fenix.co"},
    ]

    partners = [
        {"partner_id":"ptr_001","name":"Casa Bohème","description":"Restaurante & cócteles de autor. Brunch oficial de I ❤️ Cartagena.","category":"restaurant","image_url":IMG_BRUNCH,"location":{"lat":10.4228,"lng":-75.5510},"address":"Calle de la Iglesia #35-76","booking_link":"https://casaboheme.co","price_range":"$$ - $$$","experience":"Brunch & Beats, cenas temáticas, cócteles de autor","is_certified":True},
        {"partner_id":"ptr_002","name":"Bellini","description":"Fine dining mediterráneo con fusión caribeña. Jazz & Wine nights.","category":"restaurant","image_url":IMG_JAZZ,"location":{"lat":10.4240,"lng":-75.5475},"address":"Calle del Arsenal #10-40","booking_link":"https://bellini.co","price_range":"$$$","experience":"Menú degustación, Jazz & Wine Night, cena pre-Templo","is_certified":True},
        {"partner_id":"ptr_003","name":"Blue Apple Beach","description":"Beach club exclusivo en las Islas del Rosario. Wellness y fiestas privadas.","category":"beach_club","image_url":IMG_BEACH,"location":{"lat":10.1780,"lng":-75.5800},"address":"Isla del Encanto, Islas del Rosario","booking_link":"https://blueapple.co","price_range":"$$$$","experience":"Day pass, spinning frente al mar, DJ sets exclusivos","is_certified":True},
        {"partner_id":"ptr_004","name":"Hotel Santa Clara","description":"Hotel boutique de lujo. Pop-ups artísticos y experiencias exclusivas.","category":"hotel","image_url":IMG_POPUP,"location":{"lat":10.4232,"lng":-75.5502},"address":"Calle del Torno #39-29","booking_link":"https://hotelsantaclara.com","price_range":"$$$$","experience":"Habitaciones premium, pop-ups de arte, spa","is_certified":True},
        {"partner_id":"ptr_005","name":"Café del Mar","description":"El sunset bar más icónico de Cartagena sobre las murallas.","category":"club","image_url":IMG_SUNSET,"location":{"lat":10.4260,"lng":-75.5490},"address":"Baluarte de Santo Domingo","booking_link":"https://cafedelmar.com","price_range":"$$ - $$$","experience":"Sunset sessions, cócteles signature, DJ sets","is_certified":True},
        {"partner_id":"ptr_006","name":"El Arsenal Wellness","description":"Centro de bienestar con yoga, meditación y terapias holísticas.","category":"wellness","image_url":IMG_YOGA,"location":{"lat":10.4215,"lng":-75.5470},"address":"Calle del Arsenal #8-12, Getsemaní","booking_link":"https://elarsenal.co/wellness","price_range":"$$","experience":"Yoga sunrise, meditación, masajes, sound healing","is_certified":True},
        {"partner_id":"ptr_007","name":"Movich Hotel Cartagena","description":"Hotel moderno con rooftop pool y vistas al centro histórico.","category":"hotel","image_url":IMG_CLOSING,"location":{"lat":10.4210,"lng":-75.5440},"address":"Calle del Porvenir #35-66","booking_link":"https://movich.co/cartagena","price_range":"$$$","experience":"Rooftop bar, pool party, paquete I ❤️ Cartagena","is_certified":True},
        {"partner_id":"ptr_008","name":"Isla Barú Beach Club","description":"Beach club all-inclusive en la playa más hermosa de Colombia.","category":"beach_club","image_url":IMG_BEACH,"location":{"lat":10.1817,"lng":-75.5847},"address":"Playa Blanca, Isla Barú","booking_link":"https://barubeach.com","price_range":"$$$","experience":"Beach party, gastronomía de mar, transporte en lancha","is_certified":True},
    ]

    itineraries = [
        {"itinerary_id":"itn_001","name":"Ruta Lifestyle","description":"El día perfecto en Cartagena. Del amanecer al Templo.","type":"lifestyle","image_url":IMG_BEACH,"stops":[
            {"time":"07:00","title":"Spinning frente al mar","event_id":"evt_011","venue":"Blue Apple Beach"},
            {"time":"11:00","title":"Brunch & Beats","event_id":"evt_005","venue":"Casa Bohème"},
            {"time":"14:00","title":"Beach Day Party","event_id":"evt_006","venue":"Isla Barú"},
            {"time":"17:00","title":"Sunset Session","event_id":"evt_001","venue":"La Muralla"},
            {"time":"20:00","title":"Cena en Bellini","event_id":"evt_010","venue":"Bellini"},
            {"time":"22:00","title":"Templo Night","event_id":"evt_003","venue":"Templo"},
        ]},
        {"itinerary_id":"itn_002","name":"Ruta Cultura","description":"Descubre la Cartagena histórica y artística con música y arte.","type":"culture","image_url":IMG_CULTURE,"stops":[
            {"time":"10:00","title":"Pop-Up Art Gallery","event_id":"evt_009","venue":"Hotel Santa Clara"},
            {"time":"14:00","title":"Recorrido Centro Histórico","event_id":"","venue":"Centro Histórico"},
            {"time":"18:00","title":"Folklore Show","event_id":"evt_012","venue":"Plaza Santo Domingo"},
            {"time":"20:00","title":"Candlelight Classical","event_id":"evt_007","venue":"San Pedro Claver"},
        ]},
        {"itinerary_id":"itn_003","name":"Ruta Premium","description":"La experiencia VIP de Cartagena Music Week. Todo lo mejor, sin límites.","type":"premium","image_url":IMG_NIGHT,"stops":[
            {"time":"09:00","title":"Yoga privado en la muralla","event_id":"evt_004","venue":"La Muralla"},
            {"time":"12:00","title":"Almuerzo VIP en Santa Clara","event_id":"","venue":"Hotel Santa Clara"},
            {"time":"14:00","title":"Boat transfer a Blue Apple","event_id":"evt_015","venue":"Blue Apple Beach"},
            {"time":"17:00","title":"Electronic Sunset VIP","event_id":"evt_002","venue":"Café del Mar"},
            {"time":"21:00","title":"Cena privada Bellini","event_id":"evt_010","venue":"Bellini"},
            {"time":"23:00","title":"Mesa VIP Templo","event_id":"evt_008","venue":"Templo"},
        ]},
    ]

    transport_data = [
        {"transport_id":"trn_001","type":"boat","route":"Muelle Turístico → Islas del Rosario","schedule":[
            {"departure":"08:00","arrival":"09:30","notes":"Primera salida"},
            {"departure":"09:30","arrival":"11:00","notes":"Segunda salida"},
            {"departure":"10:30","arrival":"12:00","notes":"Última salida mañana"},
        ],"departure_point":"Muelle Turístico de la Bodeguita","departure_location":{"lat":10.4200,"lng":-75.5500},"price":"90,000 COP ida / 160,000 COP ida y vuelta","notes":"Llevar protector solar. Regreso última lancha 16:00.","partner_name":"Transporte Oficial I ❤️ Cartagena","last_return":"16:00"},
        {"transport_id":"trn_002","type":"boat","route":"Muelle Turístico → Isla Barú (Playa Blanca)","schedule":[
            {"departure":"08:30","arrival":"09:30","notes":"Servicio directo"},
            {"departure":"10:00","arrival":"11:00","notes":"Segunda salida"},
        ],"departure_point":"Muelle Turístico de la Bodeguita","departure_location":{"lat":10.4200,"lng":-75.5500},"price":"70,000 COP ida / 120,000 COP ida y vuelta","notes":"Regreso última lancha 17:00. Incluye chaleco salvavidas.","partner_name":"Lanchas I ❤️ Cartagena","last_return":"17:00"},
        {"transport_id":"trn_003","type":"night_transport","route":"Transporte nocturno Centro → Venues","schedule":[
            {"departure":"21:00","arrival":"","notes":"Inicio servicio nocturno"},
            {"departure":"Cada 30 min","arrival":"","notes":"Frecuencia de vans"},
            {"departure":"05:00","arrival":"","notes":"Último servicio"},
        ],"departure_point":"Múltiples paradas en Centro Histórico y Getsemaní","departure_location":{"lat":10.4220,"lng":-75.5470},"price":"Gratis con brazalete I ❤️ Cartagena","notes":"Identificar vans con logo I ❤️ Cartagena. Rutas: Centro-Templo, Centro-Getsemaní, Bocagrande-Centro.","partner_name":"I ❤️ Cartagena Mobility","last_return":"05:00"},
        {"transport_id":"trn_004","type":"shuttle","route":"Shuttle Aeropuerto → Centro Histórico","schedule":[
            {"departure":"Cada hora","arrival":"","notes":"Desde las 06:00 hasta 22:00"},
        ],"departure_point":"Aeropuerto Rafael Núñez","departure_location":{"lat":10.4427,"lng":-75.5130},"price":"25,000 COP","notes":"Reserva previa recomendada. Duración aprox. 20 min.","partner_name":"I ❤️ Cartagena Transfer","last_return":"22:00"},
    ]

    notifications = [
        {"notification_id":"ntf_001","user_id":None,"title":"Bienvenido a I ❤️ Cartagena","message":"I ❤️ Cartagena te da la bienvenida. Explora la agenda y planifica tu semana perfecta.","type":"general","event_id":"","is_read":False,"created_at":datetime.now(timezone.utc).isoformat()},
        {"notification_id":"ntf_002","user_id":None,"title":"Sunset en 30 min","message":"El Sunset Session en La Muralla comienza en 30 minutos. No te lo pierdas.","type":"event_reminder","event_id":"evt_001","is_read":False,"created_at":datetime.now(timezone.utc).isoformat()},
        {"notification_id":"ntf_003","user_id":None,"title":"Última lancha 16:00","message":"Recuerda: la última lancha de regreso de Islas del Rosario sale a las 16:00.","type":"transport","event_id":"","is_read":False,"created_at":datetime.now(timezone.utc).isoformat()},
        {"notification_id":"ntf_004","user_id":None,"title":"Templo Night I - Sold Out","message":"Templo Night I está sold out. Quedan pocas mesas VIP disponibles.","type":"event_reminder","event_id":"evt_003","is_read":False,"created_at":datetime.now(timezone.utc).isoformat()},
    ]

    await db.seasons.insert_many(seasons)
    await db.events.insert_many(events)
    await db.venues.insert_many(venues)
    await db.partners.insert_many(partners)
    await db.itineraries.insert_many(itineraries)
    await db.transport.insert_many(transport_data)
    await db.notifications.insert_many(notifications)

    # Create indexes for analytics
    await db.analytics.create_index("event_type")
    await db.analytics.create_index("timestamp")
    await db.analytics.create_index("user_id")
    await db.events.create_index("season_id")

    # ── Seed Analytics Demo Data (for government/sponsor dashboard) ──
    await seed_analytics_demo_data()

    logger.info("Database seeded successfully!")


async def seed_analytics_demo_data():
    """Seed realistic analytics data for the admin dashboard demo."""
    import random

    logger.info("Seeding analytics demo data...")

    event_ids = [f"evt_{str(i).zfill(3)}" for i in range(1, 16)]
    partner_ids = [f"ptr_{str(i).zfill(3)}" for i in range(1, 9)]
    venue_ids = [f"ven_{str(i).zfill(3)}" for i in range(1, 11)]
    event_types_list = ["page_view", "event_click", "partner_click", "booking_click",
                        "season_click", "quick_access", "partner_section_click",
                        "transport_view", "map_view", "search", "filter"]

    # Generate ~500 analytics events over 14 days
    analytics_docs = []
    base_date = datetime(2026, 1, 1, tzinfo=timezone.utc)
    for i in range(500):
        day_offset = random.randint(0, 13)
        hour = random.choices(range(24), weights=[
            2, 1, 1, 1, 1, 2, 4, 6, 8, 10, 12, 14,
            12, 10, 8, 10, 14, 16, 18, 16, 14, 12, 8, 4
        ])[0]
        minute = random.randint(0, 59)
        ts = base_date + timedelta(days=day_offset, hours=hour, minutes=minute)

        etype = random.choices(event_types_list, weights=[25, 20, 12, 5, 8, 6, 5, 4, 5, 6, 4])[0]
        target_id = None
        target_type = None
        if etype == "event_click":
            target_id = random.choice(event_ids)
            target_type = "event"
        elif etype == "partner_click":
            target_id = random.choice(partner_ids)
            target_type = "partner"
        elif etype == "booking_click":
            target_id = random.choice(event_ids[:8])
            target_type = "event"
        elif etype == "season_click":
            target_id = random.choice(["season_001", "season_002", "season_003"])
            target_type = "season"
        elif etype in ("transport_view", "map_view"):
            target_id = random.choice(venue_ids)
            target_type = "venue"

        analytics_docs.append({
            "analytics_id": f"an_{uuid.uuid4().hex[:12]}",
            "user_id": f"user_{random.choice(['demo1', 'demo2', 'demo3', 'demo4', 'demo5', None])}",
            "event_type": etype,
            "target_id": target_id,
            "target_type": target_type,
            "metadata": {},
            "timestamp": ts.isoformat(),
            "user_agent": random.choice([
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)",
                "Mozilla/5.0 (Linux; Android 14)",
                "Mozilla/5.0 (Macintosh; Intel Mac OS X)",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            ]),
        })

    if analytics_docs:
        await db.analytics.insert_many(analytics_docs)

    # ── Demographics Data ──
    nationalities_pool = [
        ("Colombia", 35), ("USA", 15), ("México", 10), ("Argentina", 8),
        ("España", 7), ("Brasil", 6), ("Chile", 5), ("Perú", 4),
        ("Francia", 3), ("Alemania", 3), ("UK", 2), ("Italia", 2),
    ]
    age_groups_pool = [("18-24", 15), ("25-34", 35), ("35-44", 25), ("45-54", 15), ("55+", 10)]
    gender_pool = [("Masculino", 48), ("Femenino", 47), ("No binario", 3), ("Prefiero no decir", 2)]

    demographics_docs = []
    for i in range(200):
        nat = random.choices([n[0] for n in nationalities_pool], weights=[n[1] for n in nationalities_pool])[0]
        age = random.choices([a[0] for a in age_groups_pool], weights=[a[1] for a in age_groups_pool])[0]
        gen = random.choices([g[0] for g in gender_pool], weights=[g[1] for g in gender_pool])[0]
        demographics_docs.append({
            "demo_id": f"dm_{uuid.uuid4().hex[:12]}",
            "nationality": nat,
            "age_group": age,
            "gender": gen,
            "created_at": (base_date + timedelta(days=random.randint(0, 13))).isoformat(),
        })

    if demographics_docs:
        await db.analytics_demographics.insert_many(demographics_docs)

    # ── Daily Activity Summary ──
    daily_docs = []
    for day in range(14):
        d = base_date + timedelta(days=day)
        date_str = d.strftime("%Y-%m-%d")
        # Realistic curve: ramp up, peak, slight decline
        base_users = int(30 + 25 * (1 - abs(day - 7) / 7) + random.randint(-5, 10))
        base_interactions = int(base_users * random.uniform(3.5, 6.0))
        base_bookings = int(base_interactions * random.uniform(0.04, 0.10))
        daily_docs.append({
            "date": date_str,
            "users": base_users,
            "interactions": base_interactions,
            "bookings": base_bookings,
            "page_views": int(base_interactions * random.uniform(0.35, 0.50)),
            "event_clicks": int(base_interactions * random.uniform(0.20, 0.30)),
            "partner_clicks": int(base_interactions * random.uniform(0.10, 0.18)),
        })

    if daily_docs:
        await db.analytics_daily.insert_many(daily_docs)

    # ── Hourly Activity Pattern ──
    hourly_docs = []
    hour_weights = [8, 5, 3, 2, 2, 4, 12, 18, 25, 30, 35, 40,
                    38, 35, 28, 30, 38, 45, 52, 48, 42, 35, 25, 15]
    for h in range(24):
        hourly_docs.append({
            "hour": h,
            "avg_interactions": hour_weights[h] + random.randint(-3, 5),
            "label": f"{str(h).zfill(2)}:00",
        })

    if hourly_docs:
        await db.analytics_hourly.insert_many(hourly_docs)

    # ── Seed some City Passes for revenue demo ──
    pass_docs = []
    for i in range(25):
        plan = random.choices(["pass_basic", "pass_premium", "pass_ultimate"], weights=[50, 35, 15])[0]
        pass_docs.append({
            "pass_id": f"cp_{uuid.uuid4().hex[:12]}",
            "user_id": f"user_demo{random.randint(1, 50)}",
            "plan_id": plan,
            "activated_at": (base_date + timedelta(days=random.randint(0, 13))).isoformat(),
            "expires_at": (base_date + timedelta(days=random.randint(7, 20))).isoformat(),
            "is_active": True,
        })

    if pass_docs:
        await db.city_passes.insert_many(pass_docs)

    logger.info("Analytics demo data seeded!")


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await seed_database()
    # Seed analytics demo data separately if not yet seeded
    analytics_count = await db.analytics_demographics.count_documents({})
    if analytics_count == 0:
        await seed_analytics_demo_data()
    # Seed Ruta Musical if missing
    music_itn = await db.itineraries.find_one({"itinerary_id": "itn_004"})
    if not music_itn:
        IMG_CONCERT = "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800"
        await db.itineraries.insert_one({
            "itinerary_id": "itn_004",
            "name": "Ruta Musical",
            "description": "El programa musical completo de Cartagena. Conciertos, DJ sets, jazz y after parties.",
            "type": "music",
            "image_url": IMG_CONCERT,
            "stops": [
                {"time": "16:00", "title": "Electronic Sunset", "event_id": "evt_002", "venue": "Café del Mar", "price": 150000, "is_free": False},
                {"time": "17:00", "title": "Sunset Session", "event_id": "evt_001", "venue": "La Muralla", "price": 0, "is_free": True},
                {"time": "20:00", "title": "Jazz & Wine Night", "event_id": "evt_010", "venue": "Bellini", "price": 220000, "is_free": False},
                {"time": "22:00", "title": "Templo Night I", "event_id": "evt_003", "venue": "Templo", "price": 250000, "is_free": False},
                {"time": "22:00", "title": "Templo Night II", "event_id": "evt_008", "venue": "Templo", "price": 280000, "is_free": False},
                {"time": "14:00", "title": "DJ Set Blue Apple", "event_id": "evt_015", "venue": "Blue Apple Beach", "price": 400000, "is_free": False},
                {"time": "01:00", "title": "After Party Fénix", "event_id": "evt_013", "venue": "Fénix", "price": 120000, "is_free": False},
                {"time": "17:00", "title": "Sunset Closing", "event_id": "evt_014", "venue": "La Muralla", "price": 0, "is_free": True},
            ]
        })
        logger.info("Ruta Musical seeded!")
    # Add price info to existing itinerary stops if missing
    existing_itns = await db.itineraries.find({}).to_list(20)
    for itn in existing_itns:
        updated = False
        for stop in itn.get("stops", []):
            if "is_free" not in stop:
                evt = await db.events.find_one({"event_id": stop.get("event_id")}, {"_id": 0, "is_free": 1, "price": 1})
                if evt:
                    stop["is_free"] = evt.get("is_free", True)
                    stop["price"] = evt.get("price", 0)
                else:
                    stop["is_free"] = True
                    stop["price"] = 0
                updated = True
        if updated:
            await db.itineraries.update_one({"_id": itn["_id"]}, {"$set": {"stops": itn["stops"]}})


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
