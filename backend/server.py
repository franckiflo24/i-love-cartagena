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

    # Top viewed events
    pipeline = [
        {"$match": {"event_type": "event_click"}},
        {"$group": {"_id": "$target_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 10}
    ]
    top_events = await db.analytics.aggregate(pipeline).to_list(10)

    # Interactions by type
    type_pipeline = [
        {"$group": {"_id": "$event_type", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}}
    ]
    interactions_by_type = await db.analytics.aggregate(type_pipeline).to_list(20)

    return {
        "total_users": total_users,
        "total_events": total_events,
        "total_partners": total_partners,
        "total_interactions": total_interactions,
        "top_events": [{"event_id": e["_id"], "views": e["count"]} for e in top_events],
        "interactions_by_type": [{"type": e["_id"], "count": e["count"]} for e in interactions_by_type],
    }


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
            "start_date": "2026-01-12",
            "end_date": "2026-01-16",
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
            "name": "Festival de Cine",
            "subtitle": "Cartagena en pantalla",
            "description": "Proyecciones al aire libre, charlas con directores y premieres exclusivas en venues históricos.",
            "start_date": "2026-03-02",
            "end_date": "2026-03-08",
            "image_url": IMG_FILM,
            "color": "#7C3AED",
            "tags": ["Cine", "Documentales", "Premieres", "Directores", "Al Aire Libre"],
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

    logger.info("Database seeded successfully!")


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


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
