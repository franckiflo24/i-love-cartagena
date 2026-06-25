from fastapi import FastAPI, APIRouter, HTTPException, Request, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, logging, uuid, httpx, hmac
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
# Lazy import — google-auth may not be installed in all environments
google_id_token = None
google_auth_requests = None
try:
    from google.oauth2 import id_token as _gid
    from google.auth.transport import requests as _greq
    google_id_token = _gid
    google_auth_requests = _greq
except ImportError:
    pass  # logged after logger is created

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ.get('MONGO_URL')
if not mongo_url:
    raise RuntimeError("MONGO_URL environment variable is required")
client = AsyncIOMotorClient(mongo_url)
db_name = os.environ.get('DB_NAME')
if not db_name:
    raise RuntimeError("DB_NAME environment variable is required")
db = client[db_name]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ── In-memory rate limiter for expensive AI endpoints ──────────
from collections import defaultdict
import time as _time

_rate_buckets: dict[str, list[float]] = defaultdict(list)

def _check_rate_limit(key: str, max_calls: int = 10, window_sec: int = 60):
    """Raise 429 if key has exceeded max_calls within window_sec."""
    now = _time.time()
    bucket = _rate_buckets[key]
    # Prune expired entries
    _rate_buckets[key] = [t for t in bucket if now - t < window_sec]
    bucket = _rate_buckets[key]
    if len(bucket) >= max_calls:
        raise HTTPException(status_code=429, detail="Too many requests. Please wait before trying again.")
    bucket.append(now)

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

class GoogleAuthBody(BaseModel):
    id_token: str

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")

# ── Auth Endpoints ──────────────────────────────────────────

@api_router.post("/auth/google")
async def google_auth(body: GoogleAuthBody, response: Response):
    """Exchange a Google ID token for an app session token."""
    if not google_id_token or not google_auth_requests:
        raise HTTPException(status_code=503, detail="Google auth not configured")
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=503, detail="Google client ID not configured")
    try:
        idinfo = google_id_token.verify_oauth2_token(
            body.id_token, google_auth_requests.Request(), GOOGLE_CLIENT_ID
        )
    except ValueError as e:
        logger.error(f"[google_auth] Token verification failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid Google token")

    email = idinfo.get("email")
    if not email:
        raise HTTPException(status_code=401, detail="Google token missing email")

    name = idinfo.get("name", "")
    picture = idinfo.get("picture", "")

    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = {
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "provider": "google",
            "favorites": [],
            "my_week": [],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.users.insert_one(user)
        user = await db.users.find_one({"email": email}, {"_id": 0})
    else:
        update_fields: dict = {}
        if not user.get("provider"):
            update_fields["provider"] = "google"
        if picture and not user.get("picture"):
            update_fields["picture"] = picture
        if name and not user.get("name"):
            update_fields["name"] = name
        if update_fields:
            await db.users.update_one({"email": email}, {"$set": update_fields})
            user.update(update_fields)

    session_token = f"st_{uuid.uuid4().hex}"
    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user["user_id"],
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    })

    response.set_cookie(
        key="session_token", value=session_token,
        httponly=True, secure=True, samesite="none",
        path="/", max_age=7 * 24 * 3600
    )
    return {"user": {k: v for k, v in user.items() if k != "_id"}, "session_token": session_token}


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


class DemoLoginBody(BaseModel):
    email: str
    name: str = ""
    phone: str = ""
    provider: str = "email_local"
    signup_code: str = ""  # required in prod (DEMO_SIGNUP_CODE env var)

# Providers this endpoint is allowed to issue sessions for.
# Real-auth providers (google, apple, password) are NEVER touched here —
# this is the account-takeover guard.
DEMO_LOGIN_ALLOWED_PROVIDERS = {"email_local", "whatsapp_local", "guest"}

@api_router.post("/auth/demo-login")
async def demo_login(body: DemoLoginBody, response: Response):
    """Create a real user + session for demo/local signups.
    Returns a valid session_token the frontend can store and send.

    Security model:
      * If DEMO_SIGNUP_CODE env var is set, the client must pass a matching
        signup_code. Dev environments leave it unset (open).
      * Will refuse to log into an existing account whose provider is a
        real-auth provider (google/apple/password) — prevents takeover.
      * provider must be one of DEMO_LOGIN_ALLOWED_PROVIDERS.
    """
    email = body.email.strip().lower()
    if not email:
        raise HTTPException(400, "email required")

    # Provider whitelist
    if body.provider not in DEMO_LOGIN_ALLOWED_PROVIDERS:
        raise HTTPException(400, f"provider must be one of {sorted(DEMO_LOGIN_ALLOWED_PROVIDERS)}")

    # Signup code check — required in production, optional in dev
    expected_code = os.environ.get("DEMO_SIGNUP_CODE", "").strip()
    if not expected_code and os.environ.get("VERCEL"):
        raise HTTPException(503, "Demo login not configured for production")
    if expected_code:
        if not body.signup_code or not hmac.compare_digest(body.signup_code, expected_code):
            raise HTTPException(403, "Invalid signup code")

    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = {
            "user_id": user_id,
            "email": email,
            "name": body.name or email.split("@")[0],
            "phone": body.phone,
            "picture": "",
            "provider": body.provider,
            "favorites": [],
            "my_week": [],
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.users.insert_one(user)
        user = await db.users.find_one({"email": email}, {"_id": 0})
    else:
        # Block takeover of accounts created via real-auth providers.
        existing_provider = user.get("provider", "")
        if existing_provider and existing_provider not in DEMO_LOGIN_ALLOWED_PROVIDERS:
            raise HTTPException(
                403,
                "This account uses a different sign-in method. Please sign in with that provider.",
            )
        # Update name if provided
        if body.name and body.name != user.get("name"):
            await db.users.update_one({"email": email}, {"$set": {"name": body.name}})
            user["name"] = body.name

    session_token = f"st_{uuid.uuid4().hex}"
    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user["user_id"],
        "expires_at": datetime.now(timezone.utc) + timedelta(days=30),
        "created_at": datetime.now(timezone.utc),
    })

    response.set_cookie(
        key="session_token", value=session_token,
        httponly=True, secure=True, samesite="none",
        path="/", max_age=30 * 24 * 3600,
    )
    return {
        "user": {k: v for k, v in user.items() if k != "_id"},
        "session_token": session_token,
    }


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


async def require_admin(request: Request) -> dict:
    """Require an authenticated user with is_admin=True.
    Use on every /admin/* route. Returns the admin user dict."""
    user = await get_current_user(request)
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin only")
    return user


# ── Business (Partner) Auth ─────────────────────────────────
import bcrypt as _bcrypt


async def get_current_business(request: Request) -> dict:
    """Authenticate a partner business user via Bearer token."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else None
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated as business")
    session = await db.business_sessions.find_one({"token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid business session")
    expires_at = session.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Business session expired")
    biz = await db.business_users.find_one({"business_id": session["business_id"]}, {"_id": 0, "password_hash": 0})
    if not biz:
        raise HTTPException(status_code=404, detail="Business user not found")
    return biz


@api_router.post("/business/login")
async def business_login(request: Request):
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    password = body.get("password") or ""
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password are required")
    biz = await db.business_users.find_one({"email": email}, {"_id": 0})
    if not biz:
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    pw_hash = biz.get("password_hash", "").encode("utf-8")
    if not pw_hash or not _bcrypt.checkpw(password.encode("utf-8"), pw_hash):
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    token = f"biz_{uuid.uuid4().hex}"
    await db.business_sessions.insert_one({
        "token": token,
        "business_id": biz["business_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
    })
    biz_safe = {k: v for k, v in biz.items() if k != "password_hash"}
    partner = await db.partners.find_one({"partner_id": biz["partner_id"]}, {"_id": 0})
    return {"token": token, "business": biz_safe, "partner": partner}


@api_router.post("/business/logout")
async def business_logout(request: Request):
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else None
    if token:
        await db.business_sessions.delete_one({"token": token})
    return {"ok": True}


@api_router.get("/business/me")
async def business_me(request: Request):
    biz = await get_current_business(request)
    partner = await db.partners.find_one({"partner_id": biz["partner_id"]}, {"_id": 0})
    return {"business": biz, "partner": partner}


@api_router.get("/business/membership")
async def business_membership(request: Request):
    """Return the calling partner's membership status. SaaS model — partners pay a
    monthly fee to be listed. For now this is managed manually by the Alcaldía."""
    biz = await get_current_business(request)
    partner = await db.partners.find_one(
        {"partner_id": biz["partner_id"]},
        {"_id": 0, "partner_id": 1, "name": 1, "membership_tier": 1, "membership_status": 1,
         "membership_paid_until": 1, "tier": 1},
    )
    if not partner:
        raise HTTPException(status_code=404, detail="Partner no encontrado")

    tier = partner.get("membership_tier") or partner.get("tier") or "popular"
    status = partner.get("membership_status") or "active"
    paid_until = partner.get("membership_paid_until")
    days_left = None
    if paid_until:
        try:
            dt = datetime.fromisoformat(paid_until.replace("Z", "+00:00"))
            days_left = max(0, (dt - datetime.now(timezone.utc)).days)
        except Exception:
            pass

    # Membership pricing reference (monthly fees, COP). Used for display only.
    PRICING = {"popular": 0, "premium": 150_000, "elite": 500_000}
    return {
        "partner_id": partner.get("partner_id"),
        "membership_tier": tier,
        "membership_status": status,
        "membership_paid_until": paid_until,
        "days_left": days_left,
        "monthly_fee_cop": PRICING.get(tier, 0),
        "currency": "COP",
    }


@api_router.patch("/business/admin/partners/{partner_id}/membership")
async def admin_update_membership(partner_id: str, request: Request):
    """Alcaldía-only: update a partner's membership tier/status/paid_until."""
    await _require_government_role(request)
    body = await request.json()
    update: dict = {}
    if "membership_tier" in body:
        tier = (body["membership_tier"] or "").strip().lower()
        if tier not in {"popular", "premium", "elite"}:
            raise HTTPException(status_code=400, detail="membership_tier inválido")
        update["membership_tier"] = tier
    if "membership_status" in body:
        st = (body["membership_status"] or "").strip().lower()
        if st not in {"active", "pending", "suspended", "expired"}:
            raise HTTPException(status_code=400, detail="membership_status inválido")
        update["membership_status"] = st
    if "membership_paid_until" in body:
        val = body["membership_paid_until"]
        if val:
            try:
                # accept YYYY-MM-DD or ISO
                if len(val) == 10:
                    val = f"{val}T23:59:59+00:00"
                datetime.fromisoformat(val.replace("Z", "+00:00"))
                update["membership_paid_until"] = val
            except Exception:
                raise HTTPException(status_code=400, detail="membership_paid_until inválido")
        else:
            update["membership_paid_until"] = None
    if not update:
        raise HTTPException(status_code=400, detail="Sin campos a actualizar")
    update["membership_updated_at"] = datetime.now(timezone.utc).isoformat()
    result = await db.partners.update_one({"partner_id": partner_id}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Partner no encontrado")
    partner = await db.partners.find_one({"partner_id": partner_id}, {"_id": 0})
    return {"updated": True, "partner": partner}


@api_router.get("/business/admin/memberships")
async def admin_list_memberships(request: Request, status: str = "", tier: str = ""):
    """Alcaldía-only: list all partners with their membership state for monthly billing."""
    await _require_government_role(request)
    q: dict = {}
    if status:
        q["membership_status"] = status
    if tier:
        q["membership_tier"] = tier
    cursor = db.partners.find(
        q,
        {"_id": 0, "partner_id": 1, "name": 1, "category": 1, "tier": 1,
         "membership_tier": 1, "membership_status": 1, "membership_paid_until": 1,
         "email": 1, "whatsapp": 1, "phone": 1},
    ).sort("name", 1)
    docs = await cursor.to_list(1000)
    by_status: dict = {}
    by_tier: dict = {}
    for d in docs:
        s = d.get("membership_status") or "unknown"
        t = d.get("membership_tier") or d.get("tier") or "popular"
        by_status[s] = by_status.get(s, 0) + 1
        by_tier[t] = by_tier.get(t, 0) + 1
    return {"partners": docs, "count": len(docs), "by_status": by_status, "by_tier": by_tier}


@api_router.put("/business/profile")
async def update_business_profile(request: Request):
    biz = await get_current_business(request)
    body = await request.json()
    allowed = {"description", "address", "instagram", "booking_link", "price_range",
               "experience", "image_url", "default_payment_link", "phone", "whatsapp", "email",
               "photos", "images", "hours", "website"}
    update = {k: v for k, v in body.items() if k in allowed}
    # Validate photos/images are lists of strings (URLs)
    for list_field in ("photos", "images"):
        if list_field in update:
            val = update[list_field]
            if not isinstance(val, list) or not all(isinstance(u, str) for u in val):
                raise HTTPException(status_code=400, detail=f"{list_field} must be a list of URL strings")
            update[list_field] = val[:20]  # cap at 20 photos
    if not update:
        return {"updated": False}
    await db.partners.update_one({"partner_id": biz["partner_id"]}, {"$set": update})
    partner = await db.partners.find_one({"partner_id": biz["partner_id"]}, {"_id": 0})
    return {"updated": True, "partner": partner}


@api_router.post("/business/photos")
async def business_add_photo(request: Request):
    """Add a photo URL to the partner's photos array. Returns updated photos list."""
    biz = await get_current_business(request)
    body = await request.json()
    url = (body.get("url") or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="url required")
    partner = await db.partners.find_one({"partner_id": biz["partner_id"]}, {"_id": 0, "photos": 1, "images": 1})
    photos = partner.get("photos") or partner.get("images") or []
    if len(photos) >= 20:
        raise HTTPException(status_code=400, detail="Maximum 20 photos")
    if url in photos:
        return {"photos": photos}
    photos.append(url)
    await db.partners.update_one({"partner_id": biz["partner_id"]}, {"$set": {"photos": photos}})
    return {"photos": photos}


@api_router.delete("/business/photos")
async def business_remove_photo(request: Request):
    """Remove a photo URL from the partner's photos array."""
    biz = await get_current_business(request)
    body = await request.json()
    url = (body.get("url") or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="url required")
    partner = await db.partners.find_one({"partner_id": biz["partner_id"]}, {"_id": 0, "photos": 1, "images": 1})
    photos = partner.get("photos") or partner.get("images") or []
    photos = [p for p in photos if p != url]
    await db.partners.update_one({"partner_id": biz["partner_id"]}, {"$set": {"photos": photos}})
    return {"photos": photos}


@api_router.get("/business/events")
async def business_list_events(request: Request):
    biz = await get_current_business(request)
    events = await db.partner_events.find({"partner_id": biz["partner_id"]}, {"_id": 0}).sort("date", -1).to_list(200)
    return events


@api_router.post("/business/events")
async def business_create_event(request: Request):
    biz = await get_current_business(request)
    body = await request.json()
    required = ["title", "description", "category", "date", "start_time", "end_time"]
    for r in required:
        if not body.get(r):
            raise HTTPException(status_code=400, detail=f"{r} is required")

    # ── AI Moderation ──
    from ai_moderation import moderate_event
    partner = await db.partners.find_one({"partner_id": biz["partner_id"]}, {"_id": 0, "name": 1})
    mod = await moderate_event(
        title=body["title"],
        description=body["description"],
        category=body["category"],
        partner_name=(partner or {}).get("name", ""),
    )
    verdict = mod["verdict"]
    final_category = mod["category"] if verdict == "AUTO_APPROVE" else body["category"]
    final_description = body["description"]
    if verdict == "AUTO_APPROVE" and mod.get("improved_description") and mod["completeness_score"] < 70:
        final_description = mod["improved_description"]

    is_published = (verdict == "AUTO_APPROVE")
    moderation_status = {
        "AUTO_APPROVE": "approved",
        "NEEDS_REVIEW": "pending",
        "REJECT": "rejected",
    }[verdict]

    event = {
        "event_id": f"pe_{uuid.uuid4().hex[:10]}",
        "partner_id": biz["partner_id"],
        "title": body["title"],
        "description": final_description,
        "category": final_category,
        "date": body["date"],
        "start_time": body["start_time"],
        "end_time": body["end_time"],
        "flyer_url": body.get("flyer_url", ""),
        "is_free": bool(body.get("is_free", False)),
        "price": int(body.get("price", 0) or 0),
        "currency": body.get("currency", "COP"),
        "booking_link": body.get("booking_link", ""),
        "is_published": is_published,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "views_count": 0,
        "reserve_clicks": 0,
        # Moderation metadata
        "moderation_status": moderation_status,
        "moderation_verdict": verdict,
        "moderation_reason": mod.get("reason", ""),
        "moderation_issues": mod.get("issues", []),
        "moderation_score": mod.get("completeness_score", 0),
        "moderation_tags": mod.get("tags", []),
        "category_auto_corrected": mod.get("category_changed", False),
        "original_category": body["category"],
        "description_auto_improved": (final_description != body["description"]),
    }
    await db.partner_events.insert_one(event)
    event.pop("_id", None)

    # If needs review or rejected, create admin notification
    if verdict != "AUTO_APPROVE":
        await db.admin_notifications.insert_one({
            "notification_id": f"notif_{uuid.uuid4().hex[:10]}",
            "type": "event_moderation",
            "event_id": event["event_id"],
            "partner_id": biz["partner_id"],
            "partner_name": (partner or {}).get("name", ""),
            "event_title": event["title"],
            "verdict": verdict,
            "reason": mod.get("reason", ""),
            "issues": mod.get("issues", []),
            "is_read": False,
            "is_resolved": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    return event


@api_router.post("/business/upload-image")
async def business_upload_image(request: Request):
    """Upload + AI-moderate a business image (flyer / profile).

    Body: { "image_base64": "data:image/jpeg;base64,...", "purpose": "flyer"|"profile" }
    Returns: { url, verdict, caption, tags, reason } — url is the data URL ready to use.
    """
    biz = await get_current_business(request)
    body = await request.json()
    image_b64 = body.get("image_base64", "")
    purpose = body.get("purpose", "flyer")
    if not image_b64:
        raise HTTPException(status_code=400, detail="image_base64 is required")
    # Detect mime
    mime = "image/jpeg"
    if image_b64.startswith("data:"):
        try:
            mime = image_b64.split(";")[0].replace("data:", "")
        except Exception:
            pass

    # Run AI image moderation
    from ai_image_moderation import moderate_image_base64
    result = await moderate_image_base64(image_b64, mime=mime)

    # If REJECTED, do not return URL
    if result["verdict"] == "REJECT":
        return {
            "uploaded": False,
            "verdict": "REJECT",
            "reason": result["reason"],
            "issues": result.get("issues", []),
        }

    # Ensure a data URL is returned
    data_url = image_b64 if image_b64.startswith("data:") else f"data:{mime};base64,{image_b64}"

    # Persist record (optional — for tracking in admin)
    await db.uploaded_images.insert_one({
        "image_id": f"img_{uuid.uuid4().hex[:10]}",
        "partner_id": biz["partner_id"],
        "purpose": purpose,
        "verdict": result["verdict"],
        "caption": result.get("caption", ""),
        "tags": result.get("tags", []),
        "reason": result.get("reason", ""),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "data_url_preview": data_url[:80],  # don't save full image to keep DB lean
    })

    return {
        "uploaded": True,
        "url": data_url,
        "verdict": result["verdict"],
        "caption": result.get("caption", ""),
        "tags": result.get("tags", []),
        "reason": result.get("reason", ""),
        "issues": result.get("issues", []),
    }


@api_router.put("/business/events/{event_id}")
async def business_update_event(event_id: str, request: Request):
    biz = await get_current_business(request)
    existing = await db.partner_events.find_one({"event_id": event_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Event not found")
    if existing["partner_id"] != biz["partner_id"]:
        raise HTTPException(status_code=403, detail="Not your event")
    body = await request.json()
    allowed = {"title", "description", "category", "date", "start_time", "end_time", "flyer_url", "is_free", "price", "booking_link", "is_published"}
    update = {k: v for k, v in body.items() if k in allowed}
    if "price" in update:
        update["price"] = int(update["price"] or 0)
    if "is_free" in update:
        update["is_free"] = bool(update["is_free"])

    # ── Re-moderation if substantial fields changed ──
    needs_remoderation = any(
        k in update and update[k] != existing.get(k)
        for k in ("title", "description", "category", "flyer_url")
    )
    if needs_remoderation:
        from ai_moderation import moderate_event
        partner = await db.partners.find_one({"partner_id": biz["partner_id"]}, {"_id": 0, "name": 1})
        new_title = update.get("title", existing["title"])
        new_desc = update.get("description", existing["description"])
        new_cat = update.get("category", existing["category"])
        mod = await moderate_event(
            title=new_title, description=new_desc, category=new_cat,
            partner_name=(partner or {}).get("name", ""),
        )
        verdict = mod["verdict"]
        update["moderation_status"] = {"AUTO_APPROVE": "approved", "NEEDS_REVIEW": "pending", "REJECT": "rejected"}[verdict]
        update["moderation_verdict"] = verdict
        update["moderation_reason"] = mod.get("reason", "")
        update["moderation_issues"] = mod.get("issues", [])
        update["moderation_score"] = mod.get("completeness_score", 0)
        update["moderation_tags"] = mod.get("tags", [])
        update["is_published"] = (verdict == "AUTO_APPROVE")
        if verdict == "AUTO_APPROVE" and mod.get("category") in ("gastronomy","music","party","wellness","art","popup"):
            update["category"] = mod["category"]
            if mod.get("category") != new_cat:
                update["category_auto_corrected"] = True
        update["last_remoderation_at"] = datetime.now(timezone.utc).isoformat()

        # Notify admin if needs review or rejected
        if verdict != "AUTO_APPROVE":
            await db.admin_notifications.insert_one({
                "notification_id": f"notif_{uuid.uuid4().hex[:10]}",
                "type": "event_remoderation",
                "event_id": event_id,
                "partner_id": biz["partner_id"],
                "partner_name": (partner or {}).get("name", ""),
                "event_title": new_title,
                "verdict": verdict,
                "reason": mod.get("reason", ""),
                "issues": mod.get("issues", []),
                "is_read": False,
                "is_resolved": False,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })

    await db.partner_events.update_one({"event_id": event_id}, {"$set": update})
    updated = await db.partner_events.find_one({"event_id": event_id}, {"_id": 0})
    # add a hint flag for the frontend if remoderation happened
    if needs_remoderation:
        updated["_remoderation"] = {
            "verdict": update.get("moderation_verdict"),
            "reason": update.get("moderation_reason"),
        }
    return updated


@api_router.delete("/business/events/{event_id}")
async def business_delete_event(event_id: str, request: Request):
    biz = await get_current_business(request)
    existing = await db.partner_events.find_one({"event_id": event_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Event not found")
    if existing["partner_id"] != biz["partner_id"]:
        raise HTTPException(status_code=403, detail="Not your event")
    await db.partner_events.delete_one({"event_id": event_id})
    return {"deleted": True}


@api_router.get("/business/stats")
async def business_stats(request: Request):
    biz = await get_current_business(request)
    pid = biz["partner_id"]
    total_events = await db.partner_events.count_documents({"partner_id": pid})
    pipeline = [
        {"$match": {"partner_id": pid}},
        {"$group": {"_id": None, "views": {"$sum": "$views_count"}, "reserves": {"$sum": "$reserve_clicks"}}}
    ]
    agg = await db.partner_events.aggregate(pipeline).to_list(1)
    stats = agg[0] if agg else {"views": 0, "reserves": 0}
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    upcoming = await db.partner_events.count_documents({"partner_id": pid, "date": {"$gte": today_str}})
    pending = await db.partner_events.count_documents({"partner_id": pid, "moderation_status": "pending"})
    rejected = await db.partner_events.count_documents({"partner_id": pid, "moderation_status": "rejected"})
    return {
        "total_events": total_events,
        "upcoming_events": upcoming,
        "total_views": stats.get("views", 0),
        "total_reserves": stats.get("reserves", 0),
        "pending_review": pending,
        "rejected": rejected,
    }


# ── Business: Promotion CRUD ──────────────────────────────────
@api_router.get("/business/promotions")
async def business_list_promotions(request: Request):
    """List promotions belonging to the authenticated partner."""
    biz = await get_current_business(request)
    promos = await db.partner_promotions.find(
        {"partner_id": biz["partner_id"]}, {"_id": 0}
    ).sort([("created_at", -1)]).to_list(50)
    return {"promotions": promos}


@api_router.post("/business/promotions")
async def business_create_promotion(request: Request):
    """Create a new promotion for the authenticated partner."""
    biz = await get_current_business(request)
    body = await request.json()
    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title required")
    promo = {
        "promo_id": f"promo_{uuid.uuid4().hex[:10]}",
        "partner_id": biz["partner_id"],
        "title": title,
        "description": (body.get("description") or "").strip(),
        "category": body.get("category", "gastronomy"),
        "discount_pct": int(body.get("discount_pct") or 0),
        "original_price": int(body.get("original_price") or 0),
        "promo_price": int(body.get("promo_price") or 0),
        "valid_until": (body.get("valid_until") or "").strip(),
        "image_url": (body.get("image_url") or "").strip(),
        "tag_label": (body.get("tag_label") or "").strip(),
        "is_active": True,
        "click_count": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.partner_promotions.insert_one(dict(promo))
    promo.pop("_id", None)
    return promo


@api_router.put("/business/promotions/{promo_id}")
async def business_update_promotion(promo_id: str, request: Request):
    """Update an existing promotion. Only the owning partner can update."""
    biz = await get_current_business(request)
    existing = await db.partner_promotions.find_one({"promo_id": promo_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Promotion not found")
    if existing["partner_id"] != biz["partner_id"]:
        raise HTTPException(status_code=403, detail="Not your promotion")
    body = await request.json()
    allowed = {"title", "description", "category", "discount_pct", "original_price", "promo_price", "valid_until", "image_url", "tag_label", "is_active"}
    update = {k: v for k, v in body.items() if k in allowed}
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.partner_promotions.update_one({"promo_id": promo_id}, {"$set": update})
    updated = await db.partner_promotions.find_one({"promo_id": promo_id}, {"_id": 0})
    return updated


@api_router.delete("/business/promotions/{promo_id}")
async def business_delete_promotion(promo_id: str, request: Request):
    """Delete a promotion. Only the owning partner can delete."""
    biz = await get_current_business(request)
    existing = await db.partner_promotions.find_one({"promo_id": promo_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Promotion not found")
    if existing["partner_id"] != biz["partner_id"]:
        raise HTTPException(status_code=403, detail="Not your promotion")
    await db.partner_promotions.delete_one({"promo_id": promo_id})
    return {"deleted": True, "promo_id": promo_id}


# ── Government (Alcaldía) Admin Endpoints ───────────────────
async def _require_government_role(request: Request) -> dict:
    """Ensure the requesting business user has the `government` role."""
    biz = await get_current_business(request)
    if biz.get("role") != "government":
        raise HTTPException(status_code=403, detail="Access restricted to government accounts")
    return biz


# ── City Pass Plans — single source of truth ──────────────────
CITY_PASS_PLANS = {
    "pass_basic": {"name": "Explorer Pass", "price": 99000, "duration_days": 7, "color": "#22C55E",
                   "perks": ["5% descuentos en restaurantes", "Mapa interactivo premium", "Soporte prioritario"]},
    "pass_classic": {"name": "Classic Pass", "price": 200000, "duration_days": 12, "color": "#3B82F6",
                     "perks": ["10% descuentos en restaurantes y bares", "Entrada a eventos exclusivos", "Transporte acuático incluido", "Soporte VIP"]},
    "pass_premium": {"name": "Premium Pass", "price": 350000, "duration_days": 12, "color": "#D97706",
                     "perks": ["15% descuentos en restaurantes y bares", "Acceso VIP a eventos y fiestas", "Transporte acuático ilimitado", "Tour privado por la ciudad amurallada", "Concierge personal 24/7"]},
    "pass_ultimate": {"name": "Ultimate Pass", "price": 599000, "duration_days": 30, "color": "#A855F7",
                      "perks": ["20% descuentos universales", "Acceso ilimitado a todo", "Transporte privado incluido", "Chef privado una noche", "Concierge AI personalizado"]},
}
CITY_PASS_PLAN_PRICES = {k: v["price"] for k, v in CITY_PASS_PLANS.items()}


@api_router.get("/business/admin/analytics")
async def admin_alcaldia_analytics(request: Request, days: int = 30):
    """Aggregate analytics for the Alcaldía dashboard.
    Focused on tourists / app users (NOT individual partners).
    Returns: KPIs, demographics, payments (City Pass + Port Tax), user growth.
    """
    await _require_government_role(request)

    now = datetime.now(timezone.utc)
    days = max(1, min(days, 365))
    since = now - timedelta(days=days)
    since_iso = since.isoformat()

    # ── User KPIs ──
    total_users = await db.users.count_documents({})
    new_users_period = await db.users.count_documents({"created_at": {"$gte": since_iso}})
    new_users_7d = await db.users.count_documents({"created_at": {"$gte": (now - timedelta(days=7)).isoformat()}})
    new_users_30d = await db.users.count_documents({"created_at": {"$gte": (now - timedelta(days=30)).isoformat()}})

    # ── City Pass ──
    total_passes = await db.city_passes.count_documents({})
    active_passes = await db.city_passes.count_documents({"is_active": True})
    passes_period = await db.city_passes.count_documents({"activated_at": {"$gte": since_iso}})

    passes_by_plan = await db.city_passes.aggregate([
        {"$group": {"_id": "$plan_id", "count": {"$sum": 1}}}
    ]).to_list(20)
    citypass_revenue = 0
    citypass_breakdown = []
    for row in passes_by_plan:
        plan = row["_id"] or "unknown"
        cnt = row["count"]
        price = CITY_PASS_PLAN_PRICES.get(plan, 0)
        rev = cnt * price
        citypass_revenue += rev
        citypass_breakdown.append({
            "plan_id": plan,
            "count": cnt,
            "unit_price": price,
            "total_revenue": rev,
        })

    # ── Port Tax (Tasa Portuaria) ──
    pt_total = await db.port_tax_tickets.count_documents({})
    pt_paid = await db.port_tax_tickets.count_documents({"status": {"$in": ["paid", "used"]}})
    pt_used = await db.port_tax_tickets.count_documents({"status": "used"})
    pt_period = await db.port_tax_tickets.count_documents({"created_at": {"$gte": since_iso}})

    pt_revenue_agg = await db.port_tax_tickets.aggregate([
        {"$match": {"status": {"$in": ["paid", "used"]}}},
        {"$group": {"_id": None, "total": {"$sum": "$total_amount"}, "passengers": {"$sum": "$qty"}}}
    ]).to_list(1)
    pt_revenue = pt_revenue_agg[0]["total"] if pt_revenue_agg else 0
    pt_passengers = pt_revenue_agg[0]["passengers"] if pt_revenue_agg else 0

    # ── Demographics ──
    demographics = await db.analytics_demographics.find({}, {"_id": 0}).to_list(2000)
    nationality_counts: dict = {}
    age_counts: dict = {}
    gender_counts: dict = {}
    for d in demographics:
        nat = d.get("nationality", "Desconocido")
        nationality_counts[nat] = nationality_counts.get(nat, 0) + 1
        age = d.get("age_group", "Desconocido")
        age_counts[age] = age_counts.get(age, 0) + 1
        gen = d.get("gender", "Desconocido")
        gender_counts[gen] = gender_counts.get(gen, 0) + 1
    profiled = max(len(demographics), 1)
    nationalities = sorted(
        [{"country": k, "count": v, "percentage": round(v / profiled * 100, 1)} for k, v in nationality_counts.items()],
        key=lambda x: -x["count"]
    )
    age_groups = [{"group": k, "count": v} for k, v in sorted(age_counts.items())]
    genders = sorted(
        [{"gender": k, "count": v} for k, v in gender_counts.items()],
        key=lambda x: -x["count"]
    )

    # ── User Growth Daily (last `days` days) ──
    user_growth_pipeline = [
        {"$match": {"created_at": {"$gte": since_iso}}},
        {"$group": {"_id": {"$substr": ["$created_at", 0, 10]}, "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}}
    ]
    user_growth_raw = await db.users.aggregate(user_growth_pipeline).to_list(400)
    user_growth = [{"date": r["_id"], "users": r["count"]} for r in user_growth_raw]

    # ── Top events users engaged with ──
    top_events_pipeline = [
        {"$match": {"event_type": "event_click"}},
        {"$group": {"_id": "$target_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 8}
    ]
    top_events_raw = await db.analytics.aggregate(top_events_pipeline).to_list(8)
    top_events = []
    for e in top_events_raw:
        evt = await db.events.find_one({"event_id": e["_id"]}, {"_id": 0, "title": 1, "type": 1, "venue_name": 1})
        top_events.append({
            "event_id": e["_id"],
            "views": e["count"],
            "title": evt["title"] if evt else "—",
            "type": evt.get("type", "") if evt else "",
            "venue": evt.get("venue_name", "") if evt else "",
        })

    # ── Most visited zones ──
    zone_pipeline = [
        {"$match": {"zone": {"$ne": None}}},
        {"$group": {"_id": "$zone", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 10}
    ]
    top_zones_raw = await db.location_pings.aggregate(zone_pipeline).to_list(10)
    top_zones = [{"zone": z["_id"], "count": z["count"]} for z in top_zones_raw]

    # ── Activity funnel ──
    page_views = await db.analytics.count_documents({"event_type": "page_view"})
    event_clicks = await db.analytics.count_documents({"event_type": "event_click"})
    booking_clicks = await db.analytics.count_documents({"event_type": "booking_click"})

    total_revenue = citypass_revenue + pt_revenue

    return {
        "period_days": days,
        "generated_at": now.isoformat(),
        "kpis": {
            "total_users": total_users,
            "new_users_period": new_users_period,
            "new_users_7d": new_users_7d,
            "new_users_30d": new_users_30d,
            "total_passes_sold": total_passes,
            "active_passes": active_passes,
            "passes_period": passes_period,
            "port_tax_tickets": pt_total,
            "port_tax_paid": pt_paid,
            "port_tax_used": pt_used,
            "port_tax_period": pt_period,
            "port_tax_passengers": pt_passengers,
            "total_revenue_cop": total_revenue,
            "citypass_revenue_cop": citypass_revenue,
            "port_tax_revenue_cop": pt_revenue,
        },
        "demographics": {
            "nationalities": nationalities,
            "age_groups": age_groups,
            "genders": genders,
            "total_profiled": len(demographics),
        },
        "city_pass": {
            "by_plan": citypass_breakdown,
            "total_revenue": citypass_revenue,
        },
        "port_tax": {
            "total_tickets": pt_total,
            "total_passengers": pt_passengers,
            "total_revenue": pt_revenue,
            "used": pt_used,
            "paid": pt_paid - pt_used,
        },
        "user_growth": user_growth,
        "top_events": top_events,
        "top_zones": top_zones,
        "funnel": {
            "page_views": page_views,
            "event_clicks": event_clicks,
            "booking_clicks": booking_clicks,
        },
    }


@api_router.get("/business/admin/users")
async def admin_alcaldia_users(request: Request, limit: int = 100, skip: int = 0):
    """Paginated list of users (aggregate / privacy-friendly view)."""
    await _require_government_role(request)
    limit = max(1, min(limit, 500))
    skip = max(0, skip)
    cursor = db.users.find({}, {"_id": 0, "user_id": 1, "email": 1, "name": 1, "picture": 1, "created_at": 1}).sort("created_at", -1).skip(skip).limit(limit)
    rows = await cursor.to_list(limit)
    # Enrich with profile snippets (nationality, age, persona) if available
    enriched = []
    for u in rows:
        prof = await db.user_profiles.find_one({"user_id": u["user_id"]}, {"_id": 0, "persona": 1, "interests": 1, "nationality": 1, "age_group": 1})
        # has_pass / has_port_tax
        has_pass = await db.city_passes.count_documents({"user_id": u["user_id"], "is_active": True}) > 0
        pt_count = await db.port_tax_tickets.count_documents({"user_id": u["user_id"]})
        enriched.append({
            **u,
            "has_active_pass": has_pass,
            "port_tax_tickets": pt_count,
            "persona": (prof or {}).get("persona", ""),
            "nationality": (prof or {}).get("nationality", ""),
            "age_group": (prof or {}).get("age_group", ""),
            "interests": (prof or {}).get("interests", []),
        })
    total = await db.users.count_documents({})
    return {"users": enriched, "total": total, "limit": limit, "skip": skip}


@api_router.get("/business/admin/payments")
async def admin_alcaldia_payments(request: Request, limit: int = 200):
    """Combined payment history (City Pass purchases + Port Tax tickets)."""
    await _require_government_role(request)
    limit = max(1, min(limit, 1000))

    # City Pass purchases
    passes = await db.city_passes.find({}, {"_id": 0}).sort("activated_at", -1).limit(limit).to_list(limit)
    pt_tickets = await db.port_tax_tickets.find({}, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)

    # Build a unified payment log
    payments = []
    for p in passes:
        plan = p.get("plan_id", "unknown")
        amount = CITY_PASS_PLAN_PRICES.get(plan, 0)
        user = await db.users.find_one({"user_id": p.get("user_id")}, {"_id": 0, "name": 1, "email": 1}) or {}
        payments.append({
            "id": p.get("pass_id"),
            "type": "city_pass",
            "label": f"City Pass {plan.replace('pass_', '').title()}",
            "user_id": p.get("user_id"),
            "user_name": user.get("name", "—"),
            "user_email": user.get("email", "—"),
            "amount": amount,
            "currency": "COP",
            "status": "active" if p.get("is_active") else "expired",
            "created_at": p.get("activated_at"),
            "metadata": {"plan_id": plan, "expires_at": p.get("expires_at")},
        })
    for t in pt_tickets:
        user = await db.users.find_one({"user_id": t.get("user_id")}, {"_id": 0, "name": 1, "email": 1}) or {}
        payments.append({
            "id": t.get("ticket_id"),
            "type": "port_tax",
            "label": f"Tasa Portuaria ({t.get('qty', 1)} pax)",
            "user_id": t.get("user_id"),
            "user_name": user.get("name", "—"),
            "user_email": user.get("email", "—"),
            "amount": t.get("total_amount", 0),
            "currency": t.get("currency", "COP"),
            "status": t.get("status", "paid"),
            "created_at": t.get("created_at"),
            "metadata": {"travel_date": t.get("travel_date"), "qty": t.get("qty", 1)},
        })
    payments.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return {"payments": payments[:limit], "count": len(payments)}


def _csv_escape(v) -> str:
    if v is None:
        return ""
    s = str(v).replace('"', '""')
    if any(c in s for c in [",", "\n", "\r", '"']):
        return f'"{s}"'
    return s


@api_router.get("/business/admin/export/users.csv")
async def admin_export_users_csv(request: Request):
    await _require_government_role(request)
    users = await db.users.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    headers = ["user_id", "email", "name", "created_at", "nationality", "age_group", "persona", "has_active_pass", "port_tax_tickets"]
    rows_out = [",".join(headers)]
    for u in users:
        prof = await db.user_profiles.find_one({"user_id": u.get("user_id")}, {"_id": 0, "persona": 1, "nationality": 1, "age_group": 1}) or {}
        has_pass = await db.city_passes.count_documents({"user_id": u.get("user_id"), "is_active": True}) > 0
        pt_count = await db.port_tax_tickets.count_documents({"user_id": u.get("user_id")})
        row = [
            _csv_escape(u.get("user_id")),
            _csv_escape(u.get("email")),
            _csv_escape(u.get("name")),
            _csv_escape(u.get("created_at")),
            _csv_escape(prof.get("nationality", "")),
            _csv_escape(prof.get("age_group", "")),
            _csv_escape(prof.get("persona", "")),
            _csv_escape("yes" if has_pass else "no"),
            _csv_escape(pt_count),
        ]
        rows_out.append(",".join(row))
    csv_body = "\n".join(rows_out)
    return Response(
        content=csv_body,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=usuarios_amocartagena.csv"},
    )


@api_router.get("/business/admin/export/payments.csv")
async def admin_export_payments_csv(request: Request):
    await _require_government_role(request)
    # Reuse the aggregated list
    passes = await db.city_passes.find({}, {"_id": 0}).sort("activated_at", -1).to_list(5000)
    pt_tickets = await db.port_tax_tickets.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)

    headers = ["id", "type", "label", "user_email", "user_name", "amount_cop", "status", "created_at", "metadata"]
    rows_out = [",".join(headers)]
    all_rows = []
    for p in passes:
        plan = p.get("plan_id", "unknown")
        amount = CITY_PASS_PLAN_PRICES.get(plan, 0)
        user = await db.users.find_one({"user_id": p.get("user_id")}, {"_id": 0, "name": 1, "email": 1}) or {}
        all_rows.append({
            "id": p.get("pass_id"),
            "type": "city_pass",
            "label": f"City Pass {plan}",
            "user_email": user.get("email", ""),
            "user_name": user.get("name", ""),
            "amount": amount,
            "status": "active" if p.get("is_active") else "expired",
            "created_at": p.get("activated_at", ""),
            "metadata": f"plan={plan}",
        })
    for t in pt_tickets:
        user = await db.users.find_one({"user_id": t.get("user_id")}, {"_id": 0, "name": 1, "email": 1}) or {}
        all_rows.append({
            "id": t.get("ticket_id"),
            "type": "port_tax",
            "label": f"Tasa Portuaria x{t.get('qty', 1)}",
            "user_email": user.get("email", ""),
            "user_name": user.get("name", ""),
            "amount": t.get("total_amount", 0),
            "status": t.get("status", ""),
            "created_at": t.get("created_at", ""),
            "metadata": f"travel_date={t.get('travel_date', '')};qty={t.get('qty', 1)}",
        })
    all_rows.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    for r in all_rows:
        rows_out.append(",".join([
            _csv_escape(r["id"]),
            _csv_escape(r["type"]),
            _csv_escape(r["label"]),
            _csv_escape(r["user_email"]),
            _csv_escape(r["user_name"]),
            _csv_escape(r["amount"]),
            _csv_escape(r["status"]),
            _csv_escape(r["created_at"]),
            _csv_escape(r["metadata"]),
        ]))
    csv_body = "\n".join(rows_out)
    return Response(
        content=csv_body,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=pagos_amocartagena.csv"},
    )


# ── Admin Moderation Endpoints ──────────────────────────────
@api_router.get("/admin/moderation/notifications")
async def admin_notifications(request: Request, unread_only: bool = False):
    """List moderation notifications for admin."""
    await require_admin(request)
    query: dict = {} if not unread_only else {"is_resolved": False}
    notifs = await db.admin_notifications.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)
    unread_count = await db.admin_notifications.count_documents({"is_resolved": False})
    return {"notifications": notifs, "unread_count": unread_count}


@api_router.get("/admin/moderation/pending")
async def admin_pending_events(request: Request):
    """List events that need moderator review."""
    await require_admin(request)
    events = await db.partner_events.find(
        {"moderation_status": {"$in": ["pending", "rejected"]}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    # enrich with partner info
    partner_ids = list({e["partner_id"] for e in events})
    partners_map = {}
    if partner_ids:
        async for p in db.partners.find({"partner_id": {"$in": partner_ids}}, {"_id": 0, "partner_id": 1, "name": 1, "tier": 1, "image_url": 1}):
            partners_map[p["partner_id"]] = p
    for e in events:
        p = partners_map.get(e["partner_id"], {})
        e["partner_name"] = p.get("name", "")
        e["partner_tier"] = p.get("tier", "")
        e["partner_image"] = p.get("image_url", "")
    return events


@api_router.post("/admin/moderation/{event_id}/approve")
async def admin_approve_event(event_id: str, request: Request):
    await require_admin(request)
    body = {}
    try:
        body = await request.json()
    except Exception:
        body = {}
    update: dict = {
        "moderation_status": "approved",
        "is_published": True,
        "moderated_by_admin": True,
        "moderated_at": datetime.now(timezone.utc).isoformat(),
    }
    if body.get("category"):
        update["category"] = body["category"]
    if body.get("description"):
        update["description"] = body["description"]
    res = await db.partner_events.update_one({"event_id": event_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Event not found")
    await db.admin_notifications.update_many({"event_id": event_id}, {"$set": {"is_resolved": True, "is_read": True, "resolution": "approved"}})
    return {"approved": True}


@api_router.post("/admin/moderation/{event_id}/reject")
async def admin_reject_event(event_id: str, request: Request):
    await require_admin(request)
    body = {}
    try:
        body = await request.json()
    except Exception:
        body = {}
    res = await db.partner_events.update_one(
        {"event_id": event_id},
        {"$set": {
            "moderation_status": "rejected",
            "is_published": False,
            "moderated_by_admin": True,
            "moderated_at": datetime.now(timezone.utc).isoformat(),
            "rejection_reason": body.get("reason", "Contenido no apto"),
        }},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Event not found")
    await db.admin_notifications.update_many({"event_id": event_id}, {"$set": {"is_resolved": True, "is_read": True, "resolution": "rejected"}})
    return {"rejected": True}


@api_router.get("/admin/moderation/stats")
async def admin_moderation_stats(request: Request):
    await require_admin(request)
    pending = await db.partner_events.count_documents({"moderation_status": "pending"})
    approved = await db.partner_events.count_documents({"moderation_status": "approved"})
    rejected = await db.partner_events.count_documents({"moderation_status": "rejected"})
    auto_corrected = await db.partner_events.count_documents({"category_auto_corrected": True})
    descriptions_improved = await db.partner_events.count_documents({"description_auto_improved": True})
    unread = await db.admin_notifications.count_documents({"is_resolved": False})
    return {
        "pending": pending,
        "approved": approved,
        "rejected": rejected,
        "auto_corrected_categories": auto_corrected,
        "auto_improved_descriptions": descriptions_improved,
        "unread_notifications": unread,
    }



@api_router.get("/auth/me")
async def auth_me(request: Request):
    user = await get_current_user(request)
    return UserOut(**user)


# ── User Profile ─────────────────────────────────────────────
class ProfileUpdate(BaseModel):
    nationality: Optional[str] = None
    age_group: Optional[str] = None
    instagram: Optional[str] = None
    phone: Optional[str] = None
    interests: Optional[list] = None

@api_router.put("/profile")
async def update_profile(body: ProfileUpdate, request: Request):
    user = await get_current_user(request)
    update = {}
    if body.nationality is not None: update["nationality"] = body.nationality
    if body.age_group is not None: update["age_group"] = body.age_group
    if body.instagram is not None: update["instagram"] = body.instagram
    if body.phone is not None: update["phone"] = body.phone
    if body.interests is not None: update["interests"] = body.interests
    if update:
        update["profile_completed"] = True
        update["profile_updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.users.update_one({"user_id": user["user_id"]}, {"$set": update})
    updated = await db.users.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return updated

@api_router.get("/profile")
async def get_profile(request: Request):
    user = await get_current_user(request)
    return user


# ── Admin: Users Management ──────────────────────────────────
@api_router.get("/admin/users")
async def admin_list_users(request: Request):
    """List all registered users with full profile data - admin only."""
    await require_admin(request)
    users = await db.users.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    total = len(users)
    countries = {}
    age_groups = {}
    with_instagram = 0
    with_profile = 0
    for u in users:
        nat = u.get("nationality", "")
        if nat:
            countries[nat] = countries.get(nat, 0) + 1
        age = u.get("age_group", "")
        if age:
            age_groups[age] = age_groups.get(age, 0) + 1
        if u.get("instagram"):
            with_instagram += 1
        if u.get("profile_completed"):
            with_profile += 1

    return {
        "total": total,
        "users": users,
        "stats": {
            "with_profile": with_profile,
            "with_instagram": with_instagram,
            "countries": [{"country": k, "count": v} for k, v in sorted(countries.items(), key=lambda x: -x[1])],
            "age_groups": [{"group": k, "count": v} for k, v in sorted(age_groups.items())],
        }
    }


@api_router.post("/auth/logout")
async def logout(request: Request, response: Response):
    # Accept token from cookie OR Authorization: Bearer (mirrors get_current_user).
    # Previously this only read the cookie, so mobile / Bearer-auth clients
    # could clear their local token while the server-side session remained
    # valid for 30 days — stolen tokens were unrevocable.
    token = request.cookies.get("session_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
    deleted = 0
    if token:
        result = await db.user_sessions.delete_one({"session_token": token})
        deleted = result.deleted_count
    response.delete_cookie("session_token", path="/")
    return {"ok": True, "session_revoked": bool(deleted)}


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
        event = await db.events.find_one({"slug": event_id}, {"_id": 0})
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
async def list_partners(category: Optional[str] = None, subcategory: Optional[str] = None):
    query: dict = {}
    if category:
        query["category"] = category
    if subcategory:
        query["subcategory"] = subcategory
    partners = await db.partners.find(query, {"_id": 0}).sort("order", 1).to_list(1500)
    return partners


@api_router.get("/partners/{partner_id}")
async def get_partner(partner_id: str):
    partner = await db.partners.find_one({"partner_id": partner_id}, {"_id": 0})
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    return partner


# ── Partner Events (publicados por los partners) ────────────
@api_router.get("/partner-events")
async def list_partner_events(
    date: Optional[str] = None,
    category: Optional[str] = None,
    partner_id: Optional[str] = None,
    upcoming: Optional[bool] = None,
):
    """List partner-published events. Filter by date (YYYY-MM-DD), category, partner_id, or upcoming=true."""
    query: dict = {"is_published": True}
    if date:
        query["date"] = date
    if category and category != "all":
        query["category"] = category
    if partner_id:
        query["partner_id"] = partner_id
    if upcoming:
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        query["date"] = {"$gte": today_str}
    events = await db.partner_events.find(query, {"_id": 0}).sort([("date", 1), ("start_time", 1)]).to_list(200)
    # enrich with partner info
    partner_ids = list({e["partner_id"] for e in events})
    partners_map = {}
    if partner_ids:
        async for p in db.partners.find({"partner_id": {"$in": partner_ids}}, {"_id": 0, "partner_id": 1, "name": 1, "tier": 1, "category": 1, "image_url": 1}):
            partners_map[p["partner_id"]] = p
    for e in events:
        p = partners_map.get(e["partner_id"], {})
        e["partner_name"] = p.get("name", "")
        e["partner_tier"] = p.get("tier", "popular")
        e["partner_category"] = p.get("category", "")
        e["partner_image"] = p.get("image_url", "")
    return events


@api_router.get("/partner-events/{event_id}")
async def get_partner_event(event_id: str):
    event = await db.partner_events.find_one({"event_id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    # Increment views asynchronously
    await db.partner_events.update_one({"event_id": event_id}, {"$inc": {"views_count": 1}})
    # enrich with partner
    p = await db.partners.find_one({"partner_id": event["partner_id"]}, {"_id": 0})
    if p:
        event["partner"] = p
    return event


# ── Promotions (ofertas del día publicadas por partners) ────────────
@api_router.get("/promotions/today")
async def list_today_promotions(category: Optional[str] = None):
    """Return active promotions valid today, sorted by partner tier + recency.

    Each promotion includes: promo_id, partner_id, title, description, category,
    discount_pct (or 0 if not %-based), original_price, promo_price, valid_until,
    image_url, is_active, partner_name, partner_tier, partner_image, partner_address.
    """
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    query: dict = {"is_active": True, "valid_until": {"$gte": today_str}}
    if category and category != "all":
        query["category"] = category
    promos = await db.partner_promotions.find(query, {"_id": 0}).sort([("created_at", -1)]).to_list(50)
    # Enrich with partner info
    partner_ids = list({p["partner_id"] for p in promos})
    partners_map: dict = {}
    if partner_ids:
        async for p in db.partners.find({"partner_id": {"$in": partner_ids}}, {"_id": 0, "partner_id": 1, "name": 1, "tier": 1, "category": 1, "image_url": 1, "address": 1}):
            partners_map[p["partner_id"]] = p
    # Tier ordering for sort
    TIER_ORDER = {"elite": 0, "premium": 1, "popular": 2}
    for promo in promos:
        p = partners_map.get(promo["partner_id"], {})
        promo["partner_name"] = p.get("name", "")
        promo["partner_tier"] = p.get("tier", "popular")
        promo["partner_image"] = p.get("image_url", "")
        promo["partner_address"] = p.get("address", "")
    promos.sort(key=lambda x: TIER_ORDER.get(x.get("partner_tier", "popular"), 3))
    return promos


@api_router.post("/promotions/{promo_id}/track-click")
async def track_promotion_click(promo_id: str):
    promo = await db.partner_promotions.find_one({"promo_id": promo_id}, {"_id": 0})
    if not promo:
        raise HTTPException(status_code=404, detail="Promotion not found")
    await db.partner_promotions.update_one({"promo_id": promo_id}, {"$inc": {"click_count": 1}})
    return {"ok": True, "partner_id": promo["partner_id"]}


@api_router.post("/partner-events/{event_id}/track-reserve")
async def track_partner_event_reserve(event_id: str, request: Request):
    """Track a reservation click and return the booking URL with UTM params so the partner knows it came from Amo Cartagena."""
    event = await db.partner_events.find_one({"event_id": event_id}, {"_id": 0})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    await db.partner_events.update_one({"event_id": event_id}, {"$inc": {"reserve_clicks": 1}})
    # Try to identify user (optional)
    try:
        user = await get_current_user(request)
        user_id = user.get("user_id")
    except Exception:
        user_id = None
    # Log analytics
    await db.analytics.insert_one({
        "event_type": "partner_event_reserve_click",
        "event_id": event_id,
        "partner_id": event.get("partner_id"),
        "user_id": user_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    # Build tracking URL
    booking_link = event.get("booking_link") or ""
    if not booking_link:
        # fallback to partner booking link
        partner = await db.partners.find_one({"partner_id": event["partner_id"]}, {"_id": 0, "booking_link": 1})
        booking_link = (partner or {}).get("booking_link", "") or ""
    if booking_link:
        sep = "&" if "?" in booking_link else "?"
        tracking = f"utm_source=amocartagena&utm_medium=app&utm_campaign=partner_event&utm_content={event_id}"
        if user_id:
            tracking += f"&ref_user={user_id}"
        booking_link = f"{booking_link}{sep}{tracking}"
    return {"booking_url": booking_link, "tracked": True}


@api_router.post("/partners/{partner_id}/track-reserve")
async def track_partner_reserve(partner_id: str, request: Request):
    """Track a reservation click on the partner's profile (not tied to a specific event)."""
    partner = await db.partners.find_one({"partner_id": partner_id}, {"_id": 0})
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    try:
        user = await get_current_user(request)
        user_id = user.get("user_id")
    except Exception:
        user_id = None
    await db.analytics.insert_one({
        "event_type": "partner_reserve_click",
        "partner_id": partner_id,
        "user_id": user_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })
    booking_link = partner.get("booking_link", "") or ""
    if booking_link:
        sep = "&" if "?" in booking_link else "?"
        tracking = f"utm_source=amocartagena&utm_medium=app&utm_campaign=partner_profile"
        if user_id:
            tracking += f"&ref_user={user_id}"
        booking_link = f"{booking_link}{sep}{tracking}"
    return {"booking_url": booking_link, "tracked": True}


# ── Itineraries (AI Daily Routes) ───────────────────────────
ITINERARY_CATEGORIES = {"lifestyle", "cultura", "musical"}

# Mapping from itinerary category to partner categories used to build the pool
_LIFESTYLE_PCATS = {"restaurant", "beach_club", "wellness", "hotel", "shopping"}
_CULTURA_PCATS   = {"culture", "concierge"}
_MUSICAL_PCATS   = {"club", "restaurant"}  # restaurants with live music + clubs

# Mapping to partner_events categories
_LIFESTYLE_ECATS = {"gastronomy", "wellness", "lifestyle", "beach"}
_CULTURA_ECATS   = {"culture", "art", "history"}
_MUSICAL_ECATS   = {"music", "party", "concert", "dj"}


def _pcats_for(category: str) -> set:
    return {
        "lifestyle": _LIFESTYLE_PCATS,
        "cultura":   _CULTURA_PCATS,
        "musical":   _MUSICAL_PCATS,
    }.get(category, _LIFESTYLE_PCATS)


def _ecats_for(category: str) -> set:
    return {
        "lifestyle": _LIFESTYLE_ECATS,
        "cultura":   _CULTURA_ECATS,
        "musical":   _MUSICAL_ECATS,
    }.get(category, _LIFESTYLE_ECATS)


async def _get_optional_user(request: Request) -> Optional[dict]:
    try:
        return await get_current_user(request)
    except HTTPException:
        return None


async def _build_user_profile_for_routes(user_id: str) -> tuple[Optional[dict], list]:
    """Return (profile, favorites_data) for a given user. Light queries only."""
    profile = await db.user_profiles.find_one({"user_id": user_id}, {"_id": 0})
    favs_cur = db.favorites.find({"user_id": user_id}, {"_id": 0})
    fav_docs = await favs_cur.to_list(50)
    enriched = []
    for f in fav_docs:
        item_type = f.get("item_type") or f.get("type")
        item_id = f.get("item_id") or f.get("id")
        if item_type == "partner":
            p = await db.partners.find_one({"partner_id": item_id}, {"_id": 0})
            if p:
                enriched.append({"item_type": "partner", "name": p.get("name"), "category": p.get("category"), "subcategory": p.get("subcategory"), "tier": p.get("tier")})
        elif item_type == "event":
            e = await db.events.find_one({"event_id": item_id}, {"_id": 0}) or await db.partner_events.find_one({"event_id": item_id}, {"_id": 0})
            if e:
                enriched.append({"item_type": "event", "name": e.get("title") or e.get("name"), "category": e.get("category"), "tier": "event"})
        elif item_type == "venue":
            v = await db.venues.find_one({"venue_id": item_id}, {"_id": 0})
            if v:
                enriched.append({"item_type": "venue", "name": v.get("name"), "category": v.get("type"), "tier": "venue"})
    return profile, enriched


async def _generate_daily_itinerary(user: Optional[dict], category: str, force: bool = False) -> dict:
    from ai_itinerary import generate_itinerary

    cat = (category or "lifestyle").lower()
    if cat not in ITINERARY_CATEGORIES:
        cat = "lifestyle"

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    user_id = (user or {}).get("user_id") or "guest"
    cache_key = f"{user_id}:{cat}:{today}"

    if not force:
        cached = await db.ai_itineraries.find_one({"cache_key": cache_key}, {"_id": 0})
        if cached:
            return cached

    # Build partner pool for this category
    pcats = list(_pcats_for(cat))
    partners_pool = await db.partners.find({"category": {"$in": pcats}}, {"_id": 0}).to_list(40)

    # Fetch today's partner events for category
    ecats = list(_ecats_for(cat))
    today_events = await db.partner_events.find(
        {"date": today, "category": {"$in": ecats}, "moderation_status": {"$in": ["approved", None]}},
        {"_id": 0},
    ).to_list(20)

    profile, favorites = (None, [])
    if user:
        profile, favorites = await _build_user_profile_for_routes(user["user_id"])

    result = await generate_itinerary(
        user_id=user_id,
        category=cat,
        user_profile=profile,
        favorites_data=favorites,
        partners_pool=partners_pool,
        today_events=today_events,
    )

    record = {
        "cache_key": cache_key,
        "user_id": user_id,
        "category": cat,
        "date": today,
        "itinerary_id": f"itn_ai_{cat}_{user_id[:8]}_{today.replace('-', '')}",
        **result,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.ai_itineraries.update_one({"cache_key": cache_key}, {"$set": record}, upsert=True)
    record.pop("_id", None)
    return record


@api_router.get("/itineraries")
async def list_itineraries(request: Request, category: Optional[str] = None):
    """If `category` is provided returns the user's AI-generated daily route for that category.
    Otherwise returns the 3 default routes (one per category) for the home grid."""
    user = await _get_optional_user(request)
    if category:
        return await _generate_daily_itinerary(user, category, force=False)

    out = []
    for cat in ["lifestyle", "cultura", "musical"]:
        try:
            it = await _generate_daily_itinerary(user, cat, force=False)
            out.append(it)
        except Exception as e:
            logger.error(f"itinerary {cat} failed: {e}")
    return out


@api_router.post("/itineraries/regenerate")
async def regenerate_itinerary(request: Request):
    # Auth required — itinerary regeneration calls the LLM
    user = await get_current_user(request)
    body = await request.json() if await request.body() else {}
    category = (body.get("category") or "lifestyle").lower()
    return await _generate_daily_itinerary(user, category, force=True)


@api_router.get("/itineraries/{itinerary_id}")
async def get_itinerary(itinerary_id: str):
    it = await db.itineraries.find_one({"itinerary_id": itinerary_id}, {"_id": 0})
    if it:
        return it
    it = await db.ai_itineraries.find_one({"itinerary_id": itinerary_id}, {"_id": 0})
    if not it:
        raise HTTPException(status_code=404, detail="Itinerary not found")
    return it


# ── Transport ───────────────────────────────────────────────
@api_router.get("/transport")
async def list_transport():
    return await db.transport.find({}, {"_id": 0}).to_list(50)


# ── Emergency Contacts ──────────────────────────────────────
@api_router.get("/emergency-contacts")
async def list_emergency_contacts():
    return await db.emergency_contacts.find({}, {"_id": 0}).to_list(50)


# ── Concierge (Four-Agent Claude Chat) ──────────────────────
@api_router.post("/concierge/chat")
async def concierge_chat_endpoint(request: Request):
    # Auth required — prevents anonymous abuse of the Anthropic key
    user = await get_current_user(request)
    _check_rate_limit(f"concierge:{user['user_id']}", max_calls=15, window_sec=60)
    body = await request.json()
    agent = body.get("agent", "luna")
    messages = body.get("messages", [])
    if not messages:
        raise HTTPException(400, "messages required")
    from concierge import concierge_chat
    result = await concierge_chat(agent, messages, db)
    return result


# ── Notifications ───────────────────────────────────────────
@api_router.get("/notifications")
async def list_notifications(request: Request):
    user = await get_current_user(request)
    notifs = await db.notifications.find(
        {
            "$and": [
                {"$or": [{"user_id": user["user_id"]}, {"user_id": None}]},
                {"$or": [{"audience": "user"}, {"audience": {"$exists": False}}]},
            ]
        },
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


# ── Feedback & Crash Reports (auth-optional) ────────────────
@api_router.post("/feedback")
async def submit_feedback(request: Request):
    """Receive bug reports, suggestions, partner enquiries and automatic
    crash reports from the ErrorBoundary. Auth is optional."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    kind = (body.get("kind") or "other").strip().lower()
    if kind not in {"bug", "idea", "partner", "other", "crash"}:
        kind = "other"
    message = (body.get("message") or "").strip()[:5000]
    user_id = None
    try:
        u = await get_current_user(request)
        user_id = u.get("user_id") if u else None
    except Exception:
        pass
    doc = {
        "feedback_id": f"fb_{uuid.uuid4().hex[:10]}",
        "kind": kind,
        "message": message,
        "stack": (body.get("stack") or "")[:5000] or None,
        "component_stack": (body.get("component_stack") or "")[:3000] or None,
        "platform": (body.get("platform") or "unknown")[:30],
        "app_version": (body.get("app_version") or "unknown")[:30],
        "user_id": user_id,
        "user_agent": request.headers.get("user-agent", "")[:300],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "new",
    }
    try:
        await db.feedback.insert_one(doc)
    except Exception as exc:
        logger.warning(f"feedback insert failed: {exc}")
        raise HTTPException(status_code=500, detail="could not save feedback")
    if kind == "crash":
        logger.error(f"CRASH report: {message[:200]}")
    return {"ok": True, "feedback_id": doc["feedback_id"]}



@api_router.post("/users/push-token")
async def register_user_push_token(request: Request):
    """Register/refresh an Expo push token for the current user."""
    user = await get_current_user(request)
    body = await request.json()
    token = (body.get("token") or "").strip()
    platform = body.get("platform")
    device_name = body.get("device_name")
    if not token:
        raise HTTPException(status_code=400, detail="token required")
    try:
        from push import register_push_token, is_expo_token  # type: ignore
        if not is_expo_token(token):
            raise HTTPException(status_code=400, detail="Invalid Expo push token")
        ok = await register_push_token(db, "user", user["user_id"], token, platform, device_name)
        return {"ok": ok}
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning(f"register push token failed: {exc}")
        raise HTTPException(status_code=500, detail="Could not register token")


@api_router.delete("/users/push-token")
async def deregister_user_push_token(request: Request):
    """Remove a push token (e.g. on logout)."""
    await get_current_user(request)
    body = await request.json()
    token = (body.get("token") or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="token required")
    try:
        from push import deregister_push_token  # type: ignore
        await deregister_push_token(db, token)
    except Exception as exc:
        logger.warning(f"deregister push token failed: {exc}")
    return {"ok": True}


@api_router.post("/business/push-token")
async def register_business_push_token(request: Request):
    """Register/refresh an Expo push token for the current partner business."""
    biz = await get_current_business(request)
    body = await request.json()
    token = (body.get("token") or "").strip()
    platform = body.get("platform")
    device_name = body.get("device_name")
    if not token:
        raise HTTPException(status_code=400, detail="token required")
    try:
        from push import register_push_token, is_expo_token  # type: ignore
        if not is_expo_token(token):
            raise HTTPException(status_code=400, detail="Invalid Expo push token")
        ok = await register_push_token(db, "partner", biz["partner_id"], token, platform, device_name)
        return {"ok": ok}
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning(f"register partner push token failed: {exc}")
        raise HTTPException(status_code=500, detail="Could not register token")


@api_router.delete("/business/push-token")
async def deregister_business_push_token(request: Request):
    await get_current_business(request)
    body = await request.json()
    token = (body.get("token") or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="token required")
    try:
        from push import deregister_push_token  # type: ignore
        await deregister_push_token(db, token)
    except Exception as exc:
        logger.warning(f"deregister partner push token failed: {exc}")
    return {"ok": True}


# ── Favorites ───────────────────────────────────────────────
# Legacy favorites/toggle and list removed — superseded by the richer
# version at line ~1843 that uses item_id/item_type and the favorites collection.


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
    return ["restaurant", "club", "beach_club", "hotel", "wellness", "cultural", "yacht", "activity"]


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


# ── Sponsors ─────────────────────────────────────────────────
@api_router.get("/sponsors")
async def list_sponsors():
    sponsors = await db.sponsors.find({"is_active": True}, {"_id": 0}).sort("order", 1).to_list(20)
    return sponsors


# ── Concerts ─────────────────────────────────────────────────
@api_router.get("/concerts")
async def list_concerts(date: Optional[str] = None, genre: Optional[str] = None):
    query = {}
    if date:
        query["date"] = date
    if genre:
        query["genre"] = genre
    concerts = await db.concerts.find(query, {"_id": 0}).sort([("date", 1), ("start_time", 1)]).to_list(100)
    return concerts


@api_router.get("/concerts/dates")
async def concert_dates():
    dates = await db.concerts.distinct("date")
    return sorted(dates)


@api_router.get("/concerts/genres")
async def concert_genres():
    genres = await db.concerts.distinct("genre")
    return sorted(genres)


@api_router.get("/concerts/{concert_id}")
async def get_concert(concert_id: str):
    concert = await db.concerts.find_one({"concert_id": concert_id}, {"_id": 0})
    if not concert:
        raise HTTPException(status_code=404, detail="Concert not found")
    return concert


# ── Favorites / Mi Agenda ─────────────────────────────────────
class FavoriteToggle(BaseModel):
    item_id: str
    item_type: str  # event, concert

@api_router.post("/favorites/toggle")
async def toggle_favorite(body: FavoriteToggle, request: Request):
    user = await get_current_user(request)
    user_id = user["user_id"]
    existing = await db.favorites.find_one({"user_id": user_id, "item_id": body.item_id, "item_type": body.item_type})
    if existing:
        await db.favorites.delete_one({"_id": existing["_id"]})
        return {"status": "removed", "item_id": body.item_id}
    else:
        await db.favorites.insert_one({
            "fav_id": f"fav_{uuid.uuid4().hex[:12]}",
            "user_id": user_id,
            "item_id": body.item_id,
            "item_type": body.item_type,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        return {"status": "added", "item_id": body.item_id}

@api_router.get("/favorites")
async def get_favorites(request: Request):
    user = await get_current_user(request)
    user_id = user["user_id"]
    favs = await db.favorites.find({"user_id": user_id}, {"_id": 0}).to_list(200)

    # Enrich with full data
    result = []
    for f in favs:
        item = None
        if f["item_type"] == "event":
            item = await db.events.find_one({"event_id": f["item_id"]}, {"_id": 0})
        elif f["item_type"] == "concert":
            item = await db.concerts.find_one({"concert_id": f["item_id"]}, {"_id": 0})
        if item:
            item["_fav_type"] = f["item_type"]
            item["_fav_id"] = f["fav_id"]
            result.append(item)

    return result

@api_router.get("/favorites/ids")
async def get_favorite_ids(request: Request):
    user = await get_current_user(request)
    user_id = user["user_id"]
    favs = await db.favorites.find({"user_id": user_id}, {"_id": 0, "item_id": 1, "item_type": 1}).to_list(200)
    return [{"item_id": f["item_id"], "item_type": f["item_type"]} for f in favs]


# ── My Calendar (personal schedule for users) ────────────────────
@api_router.get("/calendar")
async def get_my_calendar(request: Request):
    user = await get_current_user(request)
    items = await db.user_calendar.find({"user_id": user["user_id"]}, {"_id": 0}).sort("date", 1).to_list(500)
    return items


@api_router.post("/calendar")
async def add_to_calendar(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    item_id = body.get("item_id")
    if not item_id:
        raise HTTPException(status_code=400, detail="item_id required")
    existing = await db.user_calendar.find_one({"user_id": user["user_id"], "item_id": item_id}, {"_id": 0})
    if existing:
        return existing
    record = {
        "user_id": user["user_id"],
        "item_id": item_id,
        "item_type": body.get("item_type", "partner_event"),
        "date": body.get("date", ""),
        "start_time": body.get("start_time", ""),
        "end_time": body.get("end_time", ""),
        "title": body.get("title", ""),
        "source": body.get("source", "manual"),
        "added_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.user_calendar.insert_one(record)
    record.pop("_id", None)
    return record


@api_router.delete("/calendar/{item_id}")
async def remove_from_calendar(item_id: str, request: Request):
    user = await get_current_user(request)
    res = await db.user_calendar.delete_one({"user_id": user["user_id"], "item_id": item_id})
    return {"deleted": res.deleted_count > 0}


def _fast_partner_match_localized(lang: str, partner_name: str) -> dict:
    """Conversational copy for the instant fast-path response."""
    L = (lang or "es").lower()
    if L == "en":
        return {
            "msg": f"Found it 👇 Here's {partner_name}. You can book or check upcoming events below.",
            "open_label": f"Open {partner_name}",
            "reserve_label": f"Book at {partner_name}",
            "suggestions": ["Events tonight", "Romantic dinner", "Beach club", "Day Pass"],
        }
    if L == "fr":
        return {
            "msg": f"Trouvé 👇 Voici {partner_name}. Tu peux réserver ou voir les prochains événements.",
            "open_label": f"Ouvrir {partner_name}",
            "reserve_label": f"Réserver à {partner_name}",
            "suggestions": ["Événements ce soir", "Dîner romantique", "Beach club", "Day Pass"],
        }
    if L == "pt":
        return {
            "msg": f"Achei 👇 Aqui está {partner_name}. Você pode reservar ou ver os próximos eventos abaixo.",
            "open_label": f"Abrir {partner_name}",
            "reserve_label": f"Reservar em {partner_name}",
            "suggestions": ["Eventos hoje à noite", "Jantar romântico", "Beach club", "Day Pass"],
        }
    return {
        "msg": f"¡Listo! 👇 Aquí tienes a {partner_name}. Puedes reservar o ver los próximos eventos abajo.",
        "open_label": f"Abrir {partner_name}",
        "reserve_label": f"Reservar en {partner_name}",
        "suggestions": ["Eventos esta noche", "Cena romántica", "Beach club", "Day Pass"],
    }


def _fast_partner_match(q: str, partners: list, _events_ignored: list) -> Optional[dict]:
    """If the query unambiguously points to ONE partner, return the instant
    response payload. Otherwise return None (fall back to LLM)."""
    import unicodedata as _ud
    import re as _re

    def _n(s: str) -> str:
        s = _ud.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii")
        return _re.sub(r"\s+", " ", s).strip().lower()

    qn = _n(q)
    if len(qn) < 3 or not partners:
        return None

    def _score(p):
        n = _n(p.get("name") or "")
        if not n: return 0
        if n == qn: return 100
        if n.startswith(qn) or qn.startswith(n): return 80
        if qn in n or n in qn: return 60
        return 0

    scored = sorted([(p, _score(p)) for p in partners], key=lambda x: x[1], reverse=True)
    top, top_score = scored[0]
    if top_score < 60:
        return None
    # Ambiguous: another partner has equal contains-match weight and we're not on a
    # strong (>=80) prefix/equal match — better to ask the LLM.
    if len(scored) > 1 and scored[1][1] >= 60 and top_score < 80:
        return None

    return {
        "partner": top,
        "intent": "partner",
    }


def _build_fast_path_ai(match: dict, q: str, lang: str) -> dict:
    """Wrap _fast_partner_match() output with localized conversational copy."""
    top = match["partner"]
    pname = top.get("name") or ""
    copy = _fast_partner_match_localized(lang, pname)
    rec = {
        "kind": "partner",
        "partner_id": top.get("partner_id"),
        "name": pname,
        "category": top.get("category"),
        "subcategory": top.get("subcategory"),
        "tier": top.get("tier"),
        "image_url": top.get("image_url"),
        "address": top.get("address") or "",
        "reason": "",
        "vibe": "",
    }
    return {
        "query": q,
        "intent": "partner",
        "answer": copy["msg"],
        "message": copy["msg"],
        "language": lang,
        "highlights": [{"type": "partner", "id": top.get("partner_id"), "reason": "Match directo"}],
        "recommendations": [rec],
        "actions": [
            {"type": "open_partner", "label": copy["open_label"], "partner_id": top.get("partner_id")},
            {"type": "open_reservation", "label": copy["reserve_label"], "partner_id": top.get("partner_id")},
        ],
        "suggestions": copy["suggestions"],
        "fast_path": True,
    }



# ── Search ────────────────────────────────────────────────────
@api_router.get("/search")
async def global_search(q: str = "", request: Request = None):
    """
    Global search across the whole app + AI assistant.
    Saves every query in `search_history` for analytics.
    """
    if not q or len(q) < 2:
        return {
            "events": [], "concerts": [], "partners": [], "venues": [],
            "transport": [], "partner_events": [],
            "ai": {"query": q, "intent": "general", "answer": "", "highlights": []},
        }

    import re as _re
    regex = {"$regex": _re.escape(q), "$options": "i"}

    events = await db.events.find(
        {"$or": [
            {"title": regex}, {"name_es": regex}, {"name_en": regex},
            {"description": regex}, {"description_es": regex}, {"description_en": regex},
            {"venue_name": regex}, {"venue": regex},
            {"type": regex}, {"category": regex}, {"slug": regex},
        ]},
        {"_id": 0}
    ).limit(15).to_list(15)

    concerts = await db.concerts.find(
        {"$or": [
            {"artist": regex}, {"title": regex}, {"name_es": regex},
            {"genre": regex}, {"venue_name": regex}, {"venue": regex},
            {"description": regex},
        ]},
        {"_id": 0}
    ).limit(10).to_list(10)

    partners = await db.partners.find(
        {"$or": [
            {"name": regex}, {"description": regex}, {"category": regex},
            {"subcategory": regex}, {"cuisine": regex}, {"address": regex},
            {"experience": regex},
        ]},
        {"_id": 0}
    ).limit(20).to_list(20)

    venues = await db.venues.find(
        {"$or": [{"name": regex}, {"description": regex}, {"type": regex}]},
        {"_id": 0}
    ).limit(10).to_list(10)

    transport = await db.transport.find(
        {"$or": [
            {"route": regex}, {"type": regex}, {"departure_point": regex},
            {"notes": regex}, {"partner_name": regex},
        ]},
        {"_id": 0}
    ).limit(10).to_list(10)

    partner_events = await db.partner_events.find(
        {"$or": [
            {"title": regex}, {"description": regex},
            {"category": regex}, {"partner_name": regex},
        ]},
        {"_id": 0}
    ).limit(10).to_list(10)

    matches = {
        "events": events, "concerts": concerts, "partners": partners,
        "venues": venues, "transport": transport, "partner_events": partner_events,
    }

    # ── FAST-PATH: if the user typed something that uniquely identifies a partner
    # (e.g. "carmen", "casa boheme", "celele"), skip the LLM entirely and respond
    # instantly. This covers ~70% of searches and brings latency from 8-15s → <200ms.
    user_lang = (request.query_params.get("lang") if request is not None else None) or "es"
    if user_lang not in {"es", "en", "fr", "pt"}:
        user_lang = "es"
    direct_hit = _fast_partner_match(q, partners, events + partner_events)
    if direct_hit is not None:
        ai_payload = _build_fast_path_ai(direct_hit, q, user_lang)
        try:
            await db.search_history.insert_one({
                "query": q,
                "user_id": None,
                "matches_count": sum(len(v) for v in matches.values()),
                "intent": direct_hit["intent"],
                "ai_used": False,
                "fast_path": True,
                "ts": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass
        return {**matches, "ai": ai_payload}

    # Resolve user — AUTH optional. Unauthenticated users get raw results without AI.
    # Authenticated users get the full AI-enriched experience.
    user_obj = None
    try:
        if request is not None:
            user_obj = await get_current_user(request)
    except HTTPException:
        pass  # Not authenticated — return raw results without AI enrichment

    if user_obj is None:
        # Return raw matches without AI for unauthenticated users
        return {**matches, "ai": {"query": q, "intent": "general", "answer": "", "highlights": []}}

    user_id = user_obj.get("user_id")

    # ── FULL CONCIERGE AGENT ──
    # Run the Amo agent so the search bar feels like a real concierge:
    # rich partner/event recommendation cards, conversational answer, quick replies, actions.
    ai_payload: Dict[str, Any] = {
        "query": q, "intent": "general", "answer": "",
        "highlights": [], "recommendations": [], "actions": [], "suggestions": [],
    }
    try:
        from ai_agent import run_agent_turn  # type: ignore
        # Honor user-selected UI language if passed as a query param
        forced_lang = None
        try:
            if request is not None:
                forced_lang = request.query_params.get("lang") or None
        except Exception:
            forced_lang = None
        agent_payload = await run_agent_turn(
            db,
            user=user_obj,
            user_text=q,
            history=[],
            forced_language=forced_lang,
        )
        # Derive a coarse intent from the first recommendation kind (or "general")
        recs = agent_payload.get("recommendations") or []
        intent = "general"
        if recs:
            first_kind = (recs[0].get("kind") or "").lower()
            if first_kind == "partner":
                intent = "partner"
            elif first_kind == "event":
                intent = "event"
        # Build highlights list (for the small "AI picks" pill row, back-compat).
        highlights = []
        for r in recs[:3]:
            if r.get("partner_id"):
                highlights.append({"type": "partner", "id": r["partner_id"], "reason": r.get("reason") or r.get("vibe") or ""})
            elif r.get("event_id"):
                highlights.append({"type": "event", "id": r["event_id"], "reason": r.get("reason") or r.get("vibe") or ""})
        ai_payload = {
            "query": q,
            "intent": intent,
            "answer": agent_payload.get("message") or "",
            "language": agent_payload.get("language") or "es",
            "recommendations": recs,
            "actions": agent_payload.get("actions") or [],
            "suggestions": agent_payload.get("suggestions") or [],
            "highlights": highlights,
        }
    except Exception as exc:
        logger.warning(f"amo agent search call failed, falling back: {exc}")
        # Fallback to the legacy lite ai_search
        try:
            from ai_search import ai_search_answer  # type: ignore
            lite = await ai_search_answer(q, matches)
            ai_payload.update({
                "intent": lite.get("intent") or "general",
                "answer": lite.get("answer") or "",
                "highlights": lite.get("highlights") or [],
                "suggested_tab": lite.get("suggested_tab"),
            })
        except Exception as exc2:
            logger.warning(f"ai_search lite fallback also failed: {exc2}")

    # Persist the query in search_history
    try:
        await db.search_history.insert_one({
            "history_id": f"sh_{uuid.uuid4().hex[:10]}",
            "user_id": user_id,
            "query": q,
            "query_lower": q.strip().lower(),
            "result_counts": {k: len(v) for k, v in matches.items()},
            "ai_intent": ai_payload.get("intent"),
            "ai_recs": len(ai_payload.get("recommendations") or []),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as exc:
        logger.warning(f"search_history insert failed: {exc}")

    return {**matches, "ai": ai_payload}


@api_router.get("/admin/search/analytics")
async def search_analytics(request: Request, limit: int = 50, days: int = 30):
    """Top searched queries + intents for the admin/CRM dashboard."""
    user = await get_current_user(request)
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin only")
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    pipeline = [
        {"$match": {"created_at": {"$gte": cutoff}}},
        {"$group": {
            "_id": "$query_lower",
            "count": {"$sum": 1},
            "last_seen": {"$max": "$created_at"},
            "intents": {"$addToSet": "$ai_intent"},
            "unique_users": {"$addToSet": "$user_id"},
        }},
        {"$project": {
            "_id": 0, "query": "$_id", "count": 1, "last_seen": 1, "intents": 1,
            "unique_users": {"$size": "$unique_users"},
        }},
        {"$sort": {"count": -1}},
        {"$limit": limit},
    ]
    top = await db.search_history.aggregate(pipeline).to_list(limit)
    total = await db.search_history.count_documents({"created_at": {"$gte": cutoff}})
    return {"window_days": days, "total_searches": total, "top_queries": top}


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
    except Exception:
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


# ── Geolocation tracking + AI user profile ─────────────────────────
class LocationPing(BaseModel):
    user_id: Optional[str] = None
    lat: float
    lng: float
    accuracy: Optional[float] = None
    zone: Optional[str] = None  # rough zone label e.g. "centro", "bocagrande"
    context: Optional[str] = None  # e.g. "map_open", "near_partner"


@api_router.post("/analytics/location")
async def track_location(body: LocationPing, request: Request):
    """Store user geolocation pings while they are on the map. Used to:
    1. Personalize partner suggestions based on proximity.
    2. Build aggregate heatmaps for the government/sponsor dashboard.
    """
    # Security: always use server-verified user_id, never trust client body
    try:
        user = await get_current_user(request)
        user_id = user.get("user_id")
    except Exception:
        raise HTTPException(status_code=401, detail="Authentication required for location tracking")

    doc = {
        "ping_id": f"geo_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "lat": body.lat,
        "lng": body.lng,
        "accuracy": body.accuracy,
        "zone": body.zone,
        "context": body.context or "map_open",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    await db.location_pings.insert_one(doc)
    return {"ok": True, "ping_id": doc["ping_id"]}


@api_router.post("/profile/build")
async def build_or_refresh_user_profile(request: Request):
    """Trigger AI profile generation for the current user using their
    favorites + saved agenda + visited zones.

    Body (optional): {"user_id": "...", "favorites": [...], "calendar": [...]}
    Anonymous/guest users can pass user_id (e.g. local_xxx) and inline data.
    """
    body = {}
    try:
        body = await request.json()
    except Exception:
        body = {}

    user_id = body.get("user_id")
    if not user_id:
        try:
            user = await get_current_user(request)
            if user:
                user_id = user.get("user_id")
        except Exception:
            user_id = None
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id required")

    # Pull favorites: prefer DB, fallback to inline payload (for guest users)
    favs_data: list = body.get("favorites") or []
    if not favs_data:
        async for f in db.favorites.find({"user_id": user_id}, {"_id": 0}):
            favs_data.append(f)

    # Hydrate favorite items with full metadata so the LLM has signal
    enriched: list = []
    for f in favs_data[:50]:  # cap for prompt size
        item_id = f.get("item_id")
        item_type = f.get("item_type")
        meta: dict = {"item_type": item_type, "item_id": item_id}
        try:
            if item_type == "partner":
                p = await db.partners.find_one({"partner_id": item_id}, {"_id": 0, "name": 1, "category": 1, "tier": 1, "price_range": 1, "experience": 1})
                if p: meta.update(p)
            elif item_type == "partner_event":
                e = await db.partner_events.find_one({"event_id": item_id}, {"_id": 0, "title": 1, "category": 1, "is_free": 1, "price": 1, "start_time": 1})
                if e: meta.update(e)
            elif item_type == "concert":
                c = await db.concerts.find_one({"concert_id": item_id}, {"_id": 0, "artist": 1, "genre": 1, "price": 1, "is_free": 1, "start_time": 1})
                if c: meta.update(c)
            elif item_type == "event":
                ev = await db.events.find_one({"event_id": item_id}, {"_id": 0, "title": 1, "type": 1, "is_free": 1, "price": 1, "start_time": 1})
                if ev: meta.update(ev)
        except Exception:
            pass
        enriched.append(meta)

    calendar_data: list = body.get("calendar") or []

    # Recent zones from location pings
    locations_seen: list = []
    async for lp in db.location_pings.find({"user_id": user_id, "zone": {"$ne": None}}, {"_id": 0, "zone": 1}).limit(50):
        if lp.get("zone"):
            locations_seen.append(lp["zone"])
    locations_seen = list(set(locations_seen))

    from ai_user_profile import build_user_profile
    profile = await build_user_profile(user_id, enriched, calendar_data, locations_seen)
    profile["updated_at"] = datetime.now(timezone.utc).isoformat()

    await db.user_profiles.update_one(
        {"user_id": user_id},
        {"$set": profile},
        upsert=True,
    )
    return profile


@api_router.get("/profile/me")
async def get_user_profile(request: Request):
    """Get the cached AI profile for the current/specified user."""
    user_id = request.query_params.get("user_id")
    if not user_id:
        try:
            user = await get_current_user(request)
            user_id = user.get("user_id") if user else None
        except Exception:
            user_id = None
    if not user_id:
        raise HTTPException(status_code=400, detail="user_id required")
    profile = await db.user_profiles.find_one({"user_id": user_id}, {"_id": 0})
    if not profile:
        return {"user_id": user_id, "ai_status": "not_built", "summary": "", "data_points": 0}
    return profile


# ── Transport tickets (online payment + QR for port entry) ──────────
class TransportTicketBody(BaseModel):
    user_id: Optional[str] = None
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    trip_type: str = "round_trip"  # 'one_way' | 'round_trip'
    passengers: int = 1
    departure_time: Optional[str] = None
    departure_date: Optional[str] = None  # YYYY-MM-DD
    port_tax_included: bool = True


def _parse_price(price_str: str) -> tuple[int, int]:
    """Extract (one_way, round_trip) from a string like
    '90,000 COP ida / 160,000 COP ida y vuelta' or '25,000 COP'."""
    import re
    nums = [int(n.replace(",", "")) for n in re.findall(r"(\d{1,3}(?:,\d{3})+|\d+)", price_str or "")]
    if not nums:
        return (0, 0)
    if len(nums) == 1:
        return (nums[0], nums[0])
    return (nums[0], nums[1] if len(nums) > 1 else nums[0] * 2)


PORT_TAX_PER_PERSON = 25000  # COP — impuesto portuario aproximado


@api_router.post("/transport/{transport_id}/buy")
async def buy_transport_ticket(transport_id: str, body: TransportTicketBody, request: Request):
    """Create a transport ticket. Defaults to 'pending_payment' — a Wompi/Stripe
    webhook must flip it to 'paid' before boarding. Opt-in MOCK_PAY=1 env var
    preserves legacy demo behaviour."""
    # Auth required — was also a body-user_id trust bypass (Layer 1 finding)
    user = await get_current_user(request)
    route = await db.transport.find_one({"transport_id": transport_id}, {"_id": 0})
    if not route:
        raise HTTPException(status_code=404, detail="Transport route not found")

    one_way, round_trip = _parse_price(route.get("price", ""))
    base_price = round_trip if body.trip_type == "round_trip" else one_way
    if base_price <= 0:
        raise HTTPException(status_code=400, detail="This transport is not paid online (free service)")

    subtotal = base_price * max(1, body.passengers)
    port_tax = (PORT_TAX_PER_PERSON * max(1, body.passengers)) if body.port_tax_included else 0
    total = subtotal + port_tax

    ticket_id = f"TKT-{uuid.uuid4().hex[:10].upper()}"
    qr_payload = {
        "type": "amo_cartagena_transport",
        "ticket_id": ticket_id,
        "route": route.get("route_name", ""),
        "transport_id": transport_id,
        "passengers": body.passengers,
        "trip_type": body.trip_type,
        "departure_date": body.departure_date,
        "departure_time": body.departure_time,
        "port_tax_paid": body.port_tax_included,
        "valid_until": body.departure_date or datetime.now(timezone.utc).date().isoformat(),
        "issued_at": datetime.now(timezone.utc).isoformat(),
    }
    qr_data_obj = qr_payload
    import json as _json
    qr_data = _json.dumps(qr_data_obj)

    # Payment status — default to pending_payment, not paid. Stripe/Wompi
    # webhook flips it to 'paid'. MOCK_PAY=1 env var opt-in for demo only.
    _mock_pay = os.environ.get("MOCK_PAY") == "1"
    _payment_status = "paid" if _mock_pay else "pending_payment"
    _payment_method = "mock_card" if _mock_pay else "pending"

    ticket = {
        "ticket_id": ticket_id,
        "user_id": user["user_id"],     # trust the session, ignore body.user_id
        "user_name": body.user_name or user.get("name") or "Visitante",
        "user_email": body.user_email or user.get("email"),
        "transport_id": transport_id,
        "route_name": route.get("route_name", ""),
        "route_partner": route.get("partner", ""),
        "departure_location": route.get("departure_location"),
        "trip_type": body.trip_type,
        "passengers": body.passengers,
        "departure_date": body.departure_date,
        "departure_time": body.departure_time,
        "subtotal": subtotal,
        "port_tax": port_tax,
        "total": total,
        "currency": "COP",
        "payment_status": _payment_status,
        "payment_method": _payment_method,
        "qr_data": qr_data,
        "qr_url": f"https://api.qrserver.com/v1/create-qr-code/?size=300x300&data={uuid.uuid4().hex}{ticket_id}",
        "purchased_at": datetime.now(timezone.utc).isoformat(),
        "valid_until": body.departure_date or datetime.now(timezone.utc).date().isoformat(),
    }
    # Use deterministic QR URL embedding the payload
    import urllib.parse as _u
    ticket["qr_url"] = "https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data=" + _u.quote(qr_data)

    await db.transport_tickets.insert_one(ticket)
    ticket.pop("_id", None)
    return ticket


@api_router.get("/transport/tickets")
async def list_transport_tickets(request: Request):
    """List user's purchased tickets, most recent first."""
    user = await get_current_user(request)
    tickets = await db.transport_tickets.find({"user_id": user["user_id"]}, {"_id": 0}).sort([("purchased_at", -1)]).to_list(50)
    return tickets


@api_router.get("/transport/tickets/{ticket_id}")
async def get_transport_ticket(ticket_id: str, request: Request):
    user = await get_current_user(request)
    t = await db.transport_tickets.find_one({"ticket_id": ticket_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if t.get("user_id") != user["user_id"]:
        raise HTTPException(status_code=403, detail="Access denied")
    return t


@api_router.get("/analytics/summary")
async def analytics_summary(request: Request):
    """Dashboard summary for admins - event popularity, user engagement, etc."""
    await require_admin(request)
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
    await require_admin(request)
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
    tier_prices = CITY_PASS_PLAN_PRICES
    tier_names = {k: v["name"] for k, v in CITY_PASS_PLANS.items()}
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

    # ── Intelligence Layer: avg spend, visitor count, booking channels, hotel occupancy ──
    avg_spend_pipeline = [
        {"$match": {"status": "approved"}},
        {"$group": {"_id": None, "avg": {"$avg": "$amount_cop"}, "total": {"$sum": "$amount_cop"}, "count": {"$sum": 1}}},
    ]
    avg_spend_result = await db.payments.aggregate(avg_spend_pipeline).to_list(1)
    avg_spend = round(avg_spend_result[0]["avg"]) if avg_spend_result and avg_spend_result[0].get("avg") else 0
    total_payment_revenue = avg_spend_result[0]["total"] if avg_spend_result else 0
    total_transactions = avg_spend_result[0]["count"] if avg_spend_result else 0

    visitor_count = await db.location_pings.count_documents({})
    unique_visitors = await db.users.count_documents({})

    channels_pipeline = [
        {"$match": {"status": "approved"}},
        {"$group": {"_id": "$kind", "count": {"$sum": 1}, "revenue": {"$sum": "$amount_cop"}}},
        {"$sort": {"count": -1}},
    ]
    booking_channels = await db.payments.aggregate(channels_pipeline).to_list(10)

    total_reservations = await db.reservations.count_documents({})

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
        "intelligence": {
            "avg_spend_cop": avg_spend,
            "total_payment_revenue_cop": total_payment_revenue,
            "total_transactions": total_transactions,
            "visitor_count": unique_visitors,
            "location_pings": visitor_count,
            "total_reservations": total_reservations,
            "booking_channels": [{"channel": c["_id"] or "unknown", "count": c["count"], "revenue_cop": c["revenue"]} for c in booking_channels],
        },
    }


# ── Heatmap endpoint for location data ──
@api_router.get("/analytics/heatmap")
async def analytics_heatmap(request: Request):
    """Aggregate location pings into heatmap buckets. Admin only."""
    user = await get_current_user(request)
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    try:
        pipeline = [
            {"$group": {
                "_id": {
                    "lat": {"$round": ["$lat", 3]},
                    "lng": {"$round": ["$lng", 3]},
                },
                "count": {"$sum": 1},
            }},
            {"$sort": {"count": -1}},
            {"$limit": 200},
        ]
        buckets = await db.location_pings.aggregate(pipeline).to_list(200)
        return [{"lat": b["_id"]["lat"], "lng": b["_id"]["lng"], "count": b["count"]} for b in buckets if b["_id"].get("lat")]
    except Exception as e:
        logger.error(f"[Analytics] heatmap error: {e}")
        return []


# ── City Pass ───────────────────────────────────────────────
@api_router.get("/city-pass/plans")
async def city_pass_plans():
    return [
        {
            "plan_id": pid,
            "name": plan["name"],
            "price": plan["price"],
            "currency": "COP",
            "duration_days": plan["duration_days"],
            "color": plan["color"],
            "benefits": plan["perks"],
        }
        for pid, plan in CITY_PASS_PLANS.items()
    ]


@api_router.post("/city-pass/activate")
async def activate_city_pass(request: Request):
    """Activate a city pass for the authenticated user.

    Defaults to status='pending_payment' and is_active=False until Wompi/Stripe
    confirms. MOCK_PAY=1 env var preserves legacy free-activation for demos.
    """
    user = await get_current_user(request)
    body = await request.json()
    plan_id = body.get("plan_id")
    if not plan_id:
        raise HTTPException(status_code=400, detail="plan_id required")

    existing = await db.city_passes.find_one({"user_id": user["user_id"], "is_active": True}, {"_id": 0})
    if existing:
        return {"status": "already_active", "pass": existing}

    _mock_pay = os.environ.get("MOCK_PAY") == "1"
    now = datetime.now(timezone.utc)
    pass_doc = {
        "pass_id": f"cp_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "plan_id": plan_id,
        "status": "active" if _mock_pay else "pending_payment",
        "payment_status": "paid" if _mock_pay else "pending",
        "activated_at": now.isoformat() if _mock_pay else None,
        "expires_at": (now + timedelta(days=7)).isoformat() if _mock_pay else None,
        "is_active": bool(_mock_pay),
        "created_at": now.isoformat(),
    }
    await db.city_passes.insert_one(pass_doc)
    return {
        "status": "activated" if _mock_pay else "pending_payment",
        "pass": {k: v for k, v in pass_doc.items() if k != "_id"},
    }


@api_router.get("/city-pass/mine")
async def my_city_pass(request: Request):
    user = await get_current_user(request)
    active = await db.city_passes.find_one({"user_id": user["user_id"], "is_active": True}, {"_id": 0})
    return active


# ─────────────────────────────────────────────────────────────
# Port Tax (Tasa Portuaria — La Bodeguita → Islas)
# ─────────────────────────────────────────────────────────────
DEFAULT_PORT_TAX_PRICE = 31500  # COP (referencia 2026, Corpoturismo)

async def _get_active_port_tax_config():
    """Return the currently active port-tax config, seeding a default if missing."""
    cfg = await db.port_tax_config.find_one({"active": True}, {"_id": 0})
    if not cfg:
        cfg = {
            "config_id": f"ptc_{uuid.uuid4().hex[:8]}",
            "price_per_person": DEFAULT_PORT_TAX_PRICE,
            "currency": "COP",
            "season_label": "Temporada actual 2026",
            "note": "Tasa portuaria oficial Muelle La Bodeguita — Islas del Rosario / Barú / Tierra Bomba.",
            "active": True,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.port_tax_config.insert_one(dict(cfg))
    cfg.pop("_id", None)
    return cfg


@api_router.get("/port-tax/config")
async def port_tax_config():
    """Public endpoint returning current price + season metadata."""
    cfg = await _get_active_port_tax_config()
    return cfg


@api_router.put("/admin/port-tax/config")
async def admin_update_port_tax_config(request: Request):
    """Admin can adjust the price per person and season label."""
    user = await get_current_user(request)
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin only")
    body = await request.json()
    price = int(body.get("price_per_person") or DEFAULT_PORT_TAX_PRICE)
    if price <= 0 or price > 200000:
        raise HTTPException(status_code=400, detail="Invalid price")
    # Deactivate any previous configs
    await db.port_tax_config.update_many({"active": True}, {"$set": {"active": False}})
    new_cfg = {
        "config_id": f"ptc_{uuid.uuid4().hex[:8]}",
        "price_per_person": price,
        "currency": "COP",
        "season_label": body.get("season_label") or "Temporada actual",
        "note": body.get("note") or "Tasa portuaria oficial Muelle La Bodeguita.",
        "active": True,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.port_tax_config.insert_one(dict(new_cfg))
    return new_cfg


@api_router.post("/port-tax/checkout")
async def port_tax_checkout(request: Request):
    """
    Create a port-tax ticket purchase.
    Body: { qty: int, travel_date: 'YYYY-MM-DD', passengers?: [name,...] }

    Tickets are created in 'pending_payment' status. A separate Wompi webhook
    must mark them as 'paid' before they're valid for boarding. To preserve the
    legacy demo behaviour of auto-paying (for staging/demo only), set
    PORT_TAX_AUTO_PAY=1 — never enable this in production.
    """
    user = await get_current_user(request)
    body = await request.json()
    qty_raw = body.get("qty")
    qty = int(qty_raw if qty_raw is not None else 1)
    travel_date = (body.get("travel_date") or "").strip()
    passengers = body.get("passengers") or []
    if qty < 1 or qty > 20:
        raise HTTPException(status_code=400, detail="qty must be between 1 and 20")
    if not travel_date:
        raise HTTPException(status_code=400, detail="travel_date required (YYYY-MM-DD)")
    try:
        datetime.strptime(travel_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="travel_date must be YYYY-MM-DD")

    cfg = await _get_active_port_tax_config()
    price_per_person = int(cfg["price_per_person"])
    total = price_per_person * qty
    ticket_id = f"pt_{uuid.uuid4().hex[:14]}"
    qr_payload = {
        "type": "port_tax",
        "ticket_id": ticket_id,
        "user_id": user["user_id"],
        "qty": qty,
        "travel_date": travel_date,
        "issued_at": datetime.now(timezone.utc).isoformat(),
        "app": "amo_cartagena",
    }
    # Default to pending_payment. Auto-pay is opt-in via env var for demo only.
    auto_pay = os.environ.get("PORT_TAX_AUTO_PAY") == "1"
    initial_status = "paid" if auto_pay else "pending_payment"
    now_iso = datetime.now(timezone.utc).isoformat()
    ticket = {
        "ticket_id": ticket_id,
        "user_id": user["user_id"],
        "qty": qty,
        "passengers": passengers[:qty] if isinstance(passengers, list) else [],
        "price_per_person": price_per_person,
        "total_amount": total,
        "currency": cfg["currency"],
        "travel_date": travel_date,
        "status": initial_status,
        "qr_payload": qr_payload,
        "paid_at": now_iso if auto_pay else None,
        "used_at": None,
        "created_at": now_iso,
    }
    await db.port_tax_tickets.insert_one(dict(ticket))
    ticket.pop("_id", None)
    return ticket


@api_router.get("/port-tax/my-tickets")
async def port_tax_my_tickets(request: Request):
    user = await get_current_user(request)
    cursor = db.port_tax_tickets.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1)
    tickets = await cursor.to_list(length=200)
    # Auto-expire tickets whose travel_date has passed by more than 1 day and never used
    today = datetime.now(timezone.utc).date()
    for t in tickets:
        if t.get("status") == "paid":
            try:
                td = datetime.strptime(t["travel_date"], "%Y-%m-%d").date()
                if (today - td).days > 1:
                    t["status"] = "expired"
                    await db.port_tax_tickets.update_one(
                        {"ticket_id": t["ticket_id"]},
                        {"$set": {"status": "expired"}},
                    )
            except Exception:
                pass
    return tickets


@api_router.get("/port-tax/tickets/{ticket_id}")
async def port_tax_ticket_detail(ticket_id: str, request: Request):
    user = await get_current_user(request)
    t = await db.port_tax_tickets.find_one(
        {"ticket_id": ticket_id, "user_id": user["user_id"]}, {"_id": 0}
    )
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return t


@api_router.post("/port-tax/tickets/{ticket_id}/redeem")
async def port_tax_redeem(ticket_id: str, request: Request):
    """Mark a ticket as USED (one-time redemption).
    Returns 409 if already used or expired. Future-proof for a partner scanner app:
    accepts an optional 'operator_id' in body for analytics.
    """
    user = await get_current_user(request)
    try:
        body = await request.json()
    except Exception:
        body = {}
    operator_id = (body or {}).get("operator_id")
    t = await db.port_tax_tickets.find_one(
        {"ticket_id": ticket_id, "user_id": user["user_id"]}, {"_id": 0}
    )
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if t.get("status") == "used":
        raise HTTPException(status_code=409, detail="Ticket already used")
    if t.get("status") == "expired":
        raise HTTPException(status_code=409, detail="Ticket expired")
    if t.get("status") != "paid":
        raise HTTPException(status_code=409, detail=f"Ticket not redeemable (status={t.get('status')})")
    now = datetime.now(timezone.utc).isoformat()
    update = {"status": "used", "used_at": now}
    if operator_id:
        update["redeemed_by"] = operator_id
    await db.port_tax_tickets.update_one({"ticket_id": ticket_id}, {"$set": update})
    t.update(update)
    return t



# ─────────────────────────────────────────────────────────────
# Wompi Payments (Colombia) — Cards, Nequi, PSE, Bancolombia, Daviplata
# ─────────────────────────────────────────────────────────────
import wompi as _wompi
import ai_agent as _ai_agent
import reservations as _reservations
import rewards as _rewards
import reviews as _reviews


@api_router.get("/payments/config")
async def payments_config():
    """Lightweight public config consumed by the frontend to know if Wompi is enabled and which env."""
    return {
        "enabled": _wompi.is_configured(),
        "env": _wompi.env(),
        "public_key": (os.environ.get("WOMPI_PUBLIC_KEY") or "") if _wompi.is_configured() else "",
        "commission_pct": _wompi.app_commission_pct(),
    }


async def _create_payment_record(*, user, kind: str, partner_id: Optional[str], amount_cop: int, currency: str, description: str, metadata: dict, redirect_url: str):
    """Shared helper: builds the Wompi checkout URL and stores a `payments` document."""
    if not _wompi.is_configured():
        raise HTTPException(status_code=503, detail="Wompi no está configurado. Pega las llaves en backend/.env y reinicia el backend.")

    # Determine commission split
    is_gov = False
    if partner_id:
        p = await db.partners.find_one({"partner_id": partner_id}, {"_id": 0, "is_government": 1, "name": 1})
        is_gov = bool((p or {}).get("is_government"))
    split = _wompi.compute_app_commission(amount_cop, is_government=is_gov, kind=kind)

    reference = f"PAY-{uuid.uuid4().hex[:18].upper()}"
    checkout = _wompi.build_checkout_url(
        reference=reference,
        amount_cop=amount_cop,
        currency=currency,
        customer_email=(user or {}).get("email", ""),
        redirect_url=redirect_url,
        customer_data={"name": (user or {}).get("name", "")},
    )

    payment_doc = {
        "payment_id": f"pay_{uuid.uuid4().hex[:12]}",
        "reference": reference,
        "user_id": (user or {}).get("user_id"),
        "user_email": (user or {}).get("email"),
        "user_name": (user or {}).get("name"),
        "kind": kind,  # 'city_pass' | 'port_tax' | 'partner_event' | 'partner_reservation'
        "partner_id": partner_id,
        "is_government": is_gov,
        "amount_cop": int(amount_cop),
        "currency": currency,
        "split": split,
        "description": description,
        "metadata": metadata or {},
        "status": "pending",  # pending → approved | declined | error | voided
        "provider": "wompi",
        "wompi_env": _wompi.env(),
        "wompi_transaction_id": None,
        "wompi_status": None,
        "wompi_payment_method_type": None,
        "checkout_url": checkout["checkout_url"],
        "webhook_received": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "paid_at": None,
    }
    await db.payments.insert_one(dict(payment_doc))
    payment_doc.pop("_id", None)
    return payment_doc


@api_router.post("/payments/wompi/city-pass")
async def wompi_city_pass_checkout(request: Request):
    """Initiate a Wompi checkout for a City Pass plan."""
    user = await get_current_user(request)
    body = await request.json()
    plan_id = (body.get("plan_id") or "").strip()
    _app_url = os.environ.get('PUBLIC_APP_URL')
    if not _app_url:
        raise HTTPException(status_code=503, detail="PUBLIC_APP_URL not configured")
    redirect_url = (body.get("redirect_url") or "").strip() or f"{_app_url}/payments/return"
    plan = CITY_PASS_PLANS.get(plan_id)
    if not plan:
        raise HTTPException(status_code=400, detail="plan_id inválido")
    return await _create_payment_record(
        user=user,
        kind="city_pass",
        partner_id=None,
        amount_cop=plan["price"],
        currency="COP",
        description=f"City Pass · {plan['name']}",
        metadata={"plan_id": plan_id, "plan_name": plan["name"]},
        redirect_url=redirect_url,
    )


@api_router.post("/payments/wompi/port-tax")
async def wompi_port_tax_checkout(request: Request):
    """Initiate a Wompi checkout for the Tasa Portuaria."""
    user = await get_current_user(request)
    body = await request.json()
    qty_raw = body.get("qty")
    qty = int(qty_raw if qty_raw is not None else 1)
    travel_date = (body.get("travel_date") or "").strip()
    passengers = body.get("passengers") or []
    _app_url = os.environ.get('PUBLIC_APP_URL')
    if not _app_url:
        raise HTTPException(status_code=503, detail="PUBLIC_APP_URL not configured")
    redirect_url = (body.get("redirect_url") or "").strip() or f"{_app_url}/payments/return"
    if qty < 1 or qty > 20:
        raise HTTPException(status_code=400, detail="qty must be between 1 and 20")
    if not travel_date:
        raise HTTPException(status_code=400, detail="travel_date required (YYYY-MM-DD)")
    try:
        datetime.strptime(travel_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="travel_date must be YYYY-MM-DD")
    cfg = await _get_active_port_tax_config()
    price = int(cfg["price_per_person"]) * qty
    return await _create_payment_record(
        user=user,
        kind="port_tax",
        partner_id=None,
        amount_cop=price,
        currency="COP",
        description=f"Tasa Portuaria · {qty} pax · {travel_date}",
        metadata={"qty": qty, "travel_date": travel_date, "passengers": passengers[:qty] if isinstance(passengers, list) else []},
        redirect_url=redirect_url,
    )


@api_router.post("/payments/wompi/partner-event")
async def wompi_partner_event_checkout(request: Request):
    """Initiate a Wompi checkout for booking a partner event (e.g. dinner, beach day pass)."""
    user = await get_current_user(request)
    body = await request.json()
    event_id = (body.get("event_id") or "").strip()
    qty = int(body.get("qty") or 1)
    _app_url = os.environ.get('PUBLIC_APP_URL')
    if not _app_url:
        raise HTTPException(status_code=503, detail="PUBLIC_APP_URL not configured")
    redirect_url = (body.get("redirect_url") or "").strip() or f"{_app_url}/payments/return"
    if not event_id:
        raise HTTPException(status_code=400, detail="event_id required")
    if qty < 1 or qty > 50:
        raise HTTPException(status_code=400, detail="qty must be 1..50")
    ev = await db.partner_events.find_one({"event_id": event_id}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    if ev.get("is_free"):
        raise HTTPException(status_code=400, detail="Event is free, no payment required")
    price = int(ev.get("price") or 0) * qty
    if price <= 0:
        raise HTTPException(status_code=400, detail="Event has no price configured")
    return await _create_payment_record(
        user=user,
        kind="partner_event",
        partner_id=ev.get("partner_id"),
        amount_cop=price,
        currency=ev.get("currency", "COP"),
        description=f"{ev.get('title', 'Evento')} · {qty} pax",
        metadata={"event_id": event_id, "qty": qty, "event_title": ev.get("title")},
        redirect_url=redirect_url,
    )


# ── Experience Commerce ────────────────────────────────────────
@api_router.get("/experiences")
async def list_experiences(request: Request):
    """List experiences with optional category filter."""
    try:
        category = request.query_params.get("category")
        query = {"$or": [{"is_active": True}, {"is_published": True}]}
        if category:
            query["category"] = category
        experiences = await db.partner_events.find(
            query,
            {"_id": 0},
        ).sort("created_at", -1).to_list(200)
        return experiences
    except Exception as e:
        logger.error(f"[Experiences] list error: {e}")
        raise HTTPException(status_code=500, detail="Failed to load experiences")


@api_router.get("/experiences/featured")
async def featured_experiences():
    """Return featured experiences (highest rated active events)."""
    try:
        featured = await db.partner_events.find(
            {"$or": [{"is_active": True}, {"is_published": True}]},
            {"_id": 0},
        ).sort([("is_featured", -1), ("created_at", -1)]).limit(10).to_list(10)
        return featured
    except Exception as e:
        logger.error(f"[Experiences] featured error: {e}")
        raise HTTPException(status_code=500, detail="Failed to load featured experiences")


@api_router.get("/experiences/{experience_id}")
async def get_experience(experience_id: str):
    """Get a single experience by ID."""
    try:
        exp = await db.partner_events.find_one({"event_id": experience_id}, {"_id": 0})
        if not exp:
            raise HTTPException(status_code=404, detail="Experience not found")
        partner = await db.partners.find_one({"partner_id": exp.get("partner_id")}, {"_id": 0, "name": 1, "rating": 1, "reviews": 1, "rating_breakdown": 1, "image_url": 1, "phone": 1, "whatsapp": 1})
        exp["partner"] = partner
        return exp
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Experiences] get error for {experience_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to load experience")


@api_router.get("/experience-bookings")
async def my_experience_bookings(request: Request):
    """Get the current user's experience bookings."""
    try:
        user = await get_current_user(request)
        bookings = await db.experience_bookings.find(
            {"user_id": user["user_id"]},
            {"_id": 0},
        ).sort("created_at", -1).to_list(100)
        return bookings
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Experiences] bookings error: {e}")
        raise HTTPException(status_code=500, detail="Failed to load bookings")


@api_router.post("/payments/wompi/experience")
async def wompi_experience_checkout(request: Request):
    """Initiate a Wompi checkout for an experience booking."""
    user = await get_current_user(request)
    body = await request.json()
    experience_id = (body.get("experience_id") or "").strip()
    qty = int(body.get("qty") or 1)
    date = (body.get("date") or "").strip()
    _app_url = os.environ.get('PUBLIC_APP_URL')
    if not _app_url:
        raise HTTPException(status_code=503, detail="PUBLIC_APP_URL not configured")
    redirect_url = (body.get("redirect_url") or "").strip() or f"{_app_url}/payments/return"

    if not experience_id:
        raise HTTPException(status_code=400, detail="experience_id required")
    if qty < 1 or qty > 20:
        raise HTTPException(status_code=400, detail="qty must be between 1 and 20")

    exp = await db.partner_events.find_one({"event_id": experience_id, "$or": [{"is_active": True}, {"is_published": True}]}, {"_id": 0})
    if not exp:
        raise HTTPException(status_code=404, detail="Experience not found or inactive")

    price_per = exp.get("price_cop") or exp.get("price") or 0
    total = int(price_per) * qty
    if total <= 0:
        raise HTTPException(status_code=400, detail="Experience has no price configured")

    return await _create_payment_record(
        user=user,
        kind="experience",
        partner_id=exp.get("partner_id"),
        amount_cop=total,
        currency=exp.get("currency", "COP"),
        description=f"{exp.get('title', 'Experience')} · {qty} pax",
        metadata={"experience_id": experience_id, "qty": qty, "date": date, "experience_title": exp.get("title")},
        redirect_url=redirect_url,
    )


@api_router.post("/payments/wompi/transport")
async def wompi_transport_checkout(request: Request):
    """Initiate a Wompi checkout for a transport ticket (boat, etc)."""
    user = await get_current_user(request)
    body = await request.json()
    transport_id = (body.get("transport_id") or "").strip()
    passengers = int(body.get("passengers") or 1)
    trip_type = body.get("trip_type", "one_way")
    departure_date = (body.get("departure_date") or "").strip()
    departure_time = (body.get("departure_time") or "").strip()
    port_tax_included = bool(body.get("port_tax_included", False))
    _app_url = os.environ.get('PUBLIC_APP_URL')
    if not _app_url:
        raise HTTPException(status_code=503, detail="PUBLIC_APP_URL not configured")
    redirect_url = (body.get("redirect_url") or "").strip() or f"{_app_url}/payments/return"

    if not transport_id:
        raise HTTPException(status_code=400, detail="transport_id required")
    if passengers < 1 or passengers > 20:
        raise HTTPException(status_code=400, detail="passengers must be between 1 and 20")
    if not departure_date:
        raise HTTPException(status_code=400, detail="departure_date required (YYYY-MM-DD)")
    try:
        datetime.strptime(departure_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="departure_date must be YYYY-MM-DD")

    route = await db.transport.find_one({"transport_id": transport_id}, {"_id": 0})
    if not route:
        raise HTTPException(status_code=404, detail="Transport route not found")

    one_way, round_trip = _parse_price(route.get("price", ""))
    base_price = round_trip if trip_type == "round_trip" else one_way
    if base_price <= 0:
        raise HTTPException(status_code=400, detail="This transport is not paid online")

    subtotal = base_price * passengers
    port_tax = (PORT_TAX_PER_PERSON * passengers) if port_tax_included else 0
    total = subtotal + port_tax

    return await _create_payment_record(
        user=user,
        kind="transport",
        partner_id=None,
        amount_cop=total,
        currency="COP",
        description=f"{route.get('route_name', 'Transport')} · {passengers} pax · {trip_type}",
        metadata={
            "transport_id": transport_id,
            "route_name": route.get("route_name"),
            "passengers": passengers,
            "trip_type": trip_type,
            "departure_date": departure_date,
            "departure_time": departure_time,
            "port_tax_included": port_tax_included,
            "port_tax_amount": port_tax,
        },
        redirect_url=redirect_url,
    )


@api_router.get("/partners/nearby")
async def nearby_partners(request: Request):
    """Get partners near a location, sorted by distance."""
    try:
        import math
        lat = float(request.query_params.get("lat", "0"))
        lng = float(request.query_params.get("lng", "0"))
        radius = int(request.query_params.get("radius", "5000"))
        category = request.query_params.get("category")

        if lat == 0 and lng == 0:
            raise HTTPException(status_code=400, detail="lat and lng required")

        query: dict = {}
        if category:
            query["category"] = category

        partners = await db.partners.find(query, {"_id": 0}).to_list(500)

        def haversine(lat1, lon1, lat2, lon2):
            R = 6371000
            phi1, phi2 = math.radians(lat1), math.radians(lat2)
            dphi = math.radians(lat2 - lat1)
            dlam = math.radians(lon2 - lon1)
            a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
            return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

        results = []
        for p in partners:
            loc = p.get("location") or {}
            p_lat = loc.get("lat") or loc.get("latitude")
            p_lng = loc.get("lng") or loc.get("longitude")
            if p_lat and p_lng:
                dist = haversine(lat, lng, float(p_lat), float(p_lng))
                if dist <= radius:
                    p["distance_m"] = round(dist)
                    results.append(p)

        results.sort(key=lambda x: x.get("distance_m", 999999))
        return results[:50]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[Partners] nearby error: {e}")
        raise HTTPException(status_code=500, detail="Failed to load nearby partners")


@api_router.get("/payments/{payment_id}")
async def get_payment(payment_id: str, request: Request):
    """Get current status of a payment (used by the success/return page)."""
    user = await get_current_user(request)
    p = await db.payments.find_one({"payment_id": payment_id, "user_id": user["user_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    # If still pending, poll Wompi to refresh status
    if p["status"] == "pending" and not p.get("webhook_received"):
        tx = await _wompi.fetch_transaction_by_reference(p["reference"])
        if tx:
            await _apply_wompi_transaction(p["reference"], tx)
            p = await db.payments.find_one({"payment_id": payment_id, "user_id": user["user_id"]}, {"_id": 0})
    return p


@api_router.get("/payments/by-reference/{reference}")
async def get_payment_by_reference(reference: str, request: Request):
    """Public lookup by reference (used by the post-payment screen)."""
    user = await get_current_user(request)
    p = await db.payments.find_one({"reference": reference, "user_id": user["user_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Payment not found")
    if p["status"] == "pending" and not p.get("webhook_received"):
        tx = await _wompi.fetch_transaction_by_reference(reference)
        if tx:
            await _apply_wompi_transaction(reference, tx)
            p = await db.payments.find_one({"reference": reference, "user_id": user["user_id"]}, {"_id": 0})
    return p


@api_router.get("/payments/my/list")
async def list_my_payments(request: Request):
    user = await get_current_user(request)
    cursor = db.payments.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=200)


async def _apply_wompi_transaction(reference: str, tx: dict):
    """Update our payment doc with the latest Wompi transaction state and trigger fulfillment if APPROVED."""
    if not tx:
        return
    wompi_status = (tx.get("status") or "").upper()
    status_map = {"APPROVED": "approved", "DECLINED": "declined", "VOIDED": "voided", "ERROR": "error", "PENDING": "pending"}
    new_status = status_map.get(wompi_status, "pending")
    payment_method = (tx.get("payment_method") or {}).get("type")

    p = await db.payments.find_one({"reference": reference}, {"_id": 0})
    if not p:
        return
    # Idempotency: if already approved + fulfilled, no-op
    if p.get("status") == "approved" and p.get("paid_at"):
        return

    update = {
        "wompi_transaction_id": tx.get("id"),
        "wompi_status": wompi_status,
        "wompi_payment_method_type": payment_method,
        "wompi_raw": tx,
        "status": new_status,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if new_status == "approved":
        update["paid_at"] = datetime.now(timezone.utc).isoformat()

    await db.payments.update_one({"reference": reference}, {"$set": update})

    # Trigger fulfillment on first approval
    if new_status == "approved":
        await _fulfill_payment(p, tx)


async def _fulfill_payment(payment: dict, tx: dict):
    """Provision the product (City Pass / Port Tax ticket / Event booking) after a successful Wompi payment."""
    kind = payment.get("kind")
    user_id = payment.get("user_id")
    metadata = payment.get("metadata") or {}
    try:
        if kind == "city_pass":
            existing = await db.city_passes.find_one({"user_id": user_id, "is_active": True}, {"_id": 0})
            if not existing:
                pass_doc = {
                    "pass_id": f"cp_{uuid.uuid4().hex[:12]}",
                    "user_id": user_id,
                    "plan_id": metadata.get("plan_id"),
                    "activated_at": datetime.now(timezone.utc).isoformat(),
                    "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
                    "is_active": True,
                    "payment_id": payment.get("payment_id"),
                    "wompi_transaction_id": tx.get("id"),
                }
                await db.city_passes.insert_one(pass_doc)
                await db.payments.update_one({"payment_id": payment["payment_id"]}, {"$set": {"fulfillment.pass_id": pass_doc["pass_id"]}})
        elif kind == "port_tax":
            cfg = await _get_active_port_tax_config()
            ticket_id = f"pt_{uuid.uuid4().hex[:14]}"
            qty = int(metadata.get("qty") or 1)
            travel_date = metadata.get("travel_date") or ""
            qr_payload = {
                "type": "port_tax",
                "ticket_id": ticket_id,
                "user_id": user_id,
                "qty": qty,
                "travel_date": travel_date,
                "issued_at": datetime.now(timezone.utc).isoformat(),
                "app": "amo_cartagena",
            }
            ticket = {
                "ticket_id": ticket_id,
                "user_id": user_id,
                "qty": qty,
                "passengers": metadata.get("passengers", [])[:qty] if isinstance(metadata.get("passengers"), list) else [],
                "price_per_person": int(cfg["price_per_person"]),
                "total_amount": payment["amount_cop"],
                "currency": payment["currency"],
                "travel_date": travel_date,
                "status": "paid",
                "qr_payload": qr_payload,
                "paid_at": datetime.now(timezone.utc).isoformat(),
                "used_at": None,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "payment_id": payment.get("payment_id"),
                "wompi_transaction_id": tx.get("id"),
            }
            await db.port_tax_tickets.insert_one(dict(ticket))
            await db.payments.update_one({"payment_id": payment["payment_id"]}, {"$set": {"fulfillment.ticket_id": ticket_id}})
        elif kind == "partner_event":
            booking_id = f"bk_{uuid.uuid4().hex[:12]}"
            booking = {
                "booking_id": booking_id,
                "user_id": user_id,
                "partner_id": payment.get("partner_id"),
                "event_id": metadata.get("event_id"),
                "qty": int(metadata.get("qty") or 1),
                "total_amount": payment["amount_cop"],
                "currency": payment["currency"],
                "status": "confirmed",
                "payment_id": payment.get("payment_id"),
                "wompi_transaction_id": tx.get("id"),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.partner_bookings.insert_one(dict(booking))
            await db.payments.update_one({"payment_id": payment["payment_id"]}, {"$set": {"fulfillment.booking_id": booking_id}})
        elif kind == "experience":
            booking_id = f"eb_{uuid.uuid4().hex[:12]}"
            booking = {
                "booking_id": booking_id,
                "user_id": user_id,
                "partner_id": payment.get("partner_id"),
                "experience_id": metadata.get("experience_id"),
                "experience_title": metadata.get("experience_title", ""),
                "qty": int(metadata.get("qty") or 1),
                "date": metadata.get("date", ""),
                "total_amount": payment["amount_cop"],
                "currency": payment["currency"],
                "status": "confirmed",
                "payment_id": payment.get("payment_id"),
                "wompi_transaction_id": tx.get("id"),
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.experience_bookings.insert_one(dict(booking))
            await db.payments.update_one({"payment_id": payment["payment_id"]}, {"$set": {"fulfillment.booking_id": booking_id}})
        elif kind == "transport":
            ticket_id = f"TKT-{uuid.uuid4().hex[:10].upper()}"
            import json as _json
            import urllib.parse as _u
            qr_payload = {
                "type": "amo_cartagena_transport",
                "ticket_id": ticket_id,
                "route": metadata.get("route_name", ""),
                "transport_id": metadata.get("transport_id"),
                "passengers": int(metadata.get("passengers") or 1),
                "trip_type": metadata.get("trip_type", "one_way"),
                "departure_date": metadata.get("departure_date", ""),
                "departure_time": metadata.get("departure_time", ""),
                "port_tax_paid": metadata.get("port_tax_included", False),
                "issued_at": datetime.now(timezone.utc).isoformat(),
            }
            qr_data = _json.dumps(qr_payload)
            ticket = {
                "ticket_id": ticket_id,
                "user_id": user_id,
                "transport_id": metadata.get("transport_id"),
                "route_name": metadata.get("route_name", ""),
                "trip_type": metadata.get("trip_type", "one_way"),
                "passengers": int(metadata.get("passengers") or 1),
                "departure_date": metadata.get("departure_date", ""),
                "departure_time": metadata.get("departure_time", ""),
                "subtotal": payment["amount_cop"] - int(metadata.get("port_tax_amount") or 0),
                "port_tax": int(metadata.get("port_tax_amount") or 0),
                "total": payment["amount_cop"],
                "currency": "COP",
                "payment_status": "paid",
                "payment_method": "wompi",
                "qr_data": qr_data,
                "qr_url": "https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data=" + _u.quote(qr_data),
                "purchased_at": datetime.now(timezone.utc).isoformat(),
                "valid_until": metadata.get("departure_date", ""),
                "payment_id": payment.get("payment_id"),
                "wompi_transaction_id": tx.get("id"),
            }
            await db.transport_tickets.insert_one(dict(ticket))
            await db.payments.update_one({"payment_id": payment["payment_id"]}, {"$set": {"fulfillment.ticket_id": ticket_id}})

        # ── Award loyalty points ──
        points_map = {"city_pass": 500, "port_tax": 200, "partner_event": 300, "experience": 400, "transport": 250}
        pts = points_map.get(kind, 0)
        if pts and user_id:
            try:
                await _rewards.award_points(db, user_id, pts, kind, payment.get("payment_id", ""), f"Purchase: {kind.replace('_', ' ').title()}")
            except Exception as rw_err:
                logger.error(f"[Rewards] Failed to award points for {payment.get('payment_id')}: {rw_err}")

    except Exception as e:
        logger.error(f"Fulfillment failed for payment {payment.get('payment_id')}: {e}")


@api_router.post("/webhooks/wompi")
async def wompi_webhook(request: Request):
    """Receive Wompi event notifications. Signature verified via SHA-256 of the configured properties."""
    raw = await request.body()
    try:
        body = (await request.json()) if raw else {}
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    sig = (body.get("signature") or {}).get("checksum") or ""
    if not _wompi.verify_event_signature(body, sig):
        # Log & 401 — never trust an unverified event
        logger.warning("Wompi webhook with invalid signature received")
        raise HTTPException(status_code=401, detail="Invalid signature")

    event = body.get("event")
    data = (body.get("data") or {})
    tx = data.get("transaction") or {}
    reference = tx.get("reference")
    if event == "transaction.updated" and reference:
        # Mark webhook received and apply state
        await db.payments.update_one({"reference": reference}, {"$set": {"webhook_received": True}})
        await _apply_wompi_transaction(reference, tx)

    return {"ok": True}


@api_router.get("/business/admin/payouts")
async def admin_alcaldia_payouts(request: Request, status: Optional[str] = None):
    """Aggregate of money owed to each partner (APPROVED payments minus app commission)."""
    await _require_government_role(request)
    match = {"status": "approved", "kind": {"$in": ["partner_event", "partner_reservation"]}}
    pipeline = [
        {"$match": match},
        {"$group": {
            "_id": "$partner_id",
            "transactions": {"$sum": 1},
            "gross": {"$sum": "$amount_cop"},
            "app_commission": {"$sum": "$split.app_commission"},
            "partner_amount": {"$sum": "$split.partner_amount"},
        }},
        {"$sort": {"partner_amount": -1}},
    ]
    rows = await db.payments.aggregate(pipeline).to_list(500)
    enriched = []
    total_gross = 0
    total_commission = 0
    total_owed = 0
    for r in rows:
        pid = r["_id"]
        partner = await db.partners.find_one({"partner_id": pid}, {"_id": 0, "name": 1, "tier": 1, "category": 1}) if pid else None
        enriched.append({
            "partner_id": pid,
            "partner_name": (partner or {}).get("name", "—"),
            "tier": (partner or {}).get("tier"),
            "category": (partner or {}).get("category"),
            "transactions": r["transactions"],
            "gross_cop": r["gross"],
            "app_commission_cop": r["app_commission"],
            "partner_amount_cop": r["partner_amount"],
        })
        total_gross += r["gross"]
        total_commission += r["app_commission"]
        total_owed += r["partner_amount"]
    return {
        "rows": enriched,
        "totals": {
            "gross_cop": total_gross,
            "app_commission_cop": total_commission,
            "partner_owed_cop": total_owed,
        },
        "currency": "COP",
    }


# ─────────────────────────────────────────────────────────────
# AI Concierge Agent — "Amo"
# ─────────────────────────────────────────────────────────────

@api_router.post("/agent/chat")
async def agent_chat(request: Request):
    """Send a message to the AI concierge. Authentication required —
    anonymous calls would let anyone drain the Anthropic API key.
    Body: { message: str, session_id?: str, screen_context?: str }
    Returns: { session_id, assistant: {message, language, actions, suggestions}, messages_count }
    """
    # Auth required to prevent LLM cost abuse
    user = await get_current_user(request)
    user_id = user["user_id"]
    _check_rate_limit(f"agent:{user_id}", max_calls=15, window_sec=60)

    body = await request.json()
    user_text = (body.get("message") or "").strip()
    session_id = body.get("session_id")
    forced_lang = (body.get("language") or "").strip().lower()
    if not user_text:
        raise HTTPException(status_code=400, detail="message required")
    if len(user_text) > 1000:
        raise HTTPException(status_code=400, detail="message too long (max 1000 chars)")

    session = await _ai_agent.get_or_create_session(db, user_id, session_id)
    history = session.get("messages", [])
    short_history = [
        {"role": m.get("role"), "content": m.get("content")}
        for m in history[-20:]
        if m.get("role") in ("user", "assistant") and m.get("content")
    ]

    assistant_payload = await _ai_agent.run_agent_turn(
        db,
        user=user,
        user_text=user_text,
        history=short_history,
        forced_language=forced_lang or None,
    )

    now_iso = datetime.now(timezone.utc).isoformat()
    user_msg = {"role": "user", "content": user_text, "created_at": now_iso}
    assistant_msg = {
        "role": "assistant",
        "content": assistant_payload["message"],
        "language": assistant_payload.get("language", "es"),
        "actions": assistant_payload.get("actions", []),
        "recommendations": assistant_payload.get("recommendations", []),
        "suggestions": assistant_payload.get("suggestions", []),
        "created_at": now_iso,
    }
    await _ai_agent.append_messages(db, session["session_id"], user_msg, assistant_msg)

    # Auto-title the session from the first user message
    if not session.get("title") or session["title"] == "Nuevo chat":
        title = user_text[:60]
        await db.chat_sessions.update_one(
            {"session_id": session["session_id"]},
            {"$set": {"title": title}},
        )

    return {
        "session_id": session["session_id"],
        "assistant": assistant_msg,
        "messages_count": len(history) + 2,
    }


@api_router.get("/agent/session/{session_id}")
async def agent_get_session(session_id: str, request: Request):
    user = await _get_optional_user(request)
    s = await db.chat_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    # If session has a user_id, only that user can read it
    if s.get("user_id") and s["user_id"] != (user or {}).get("user_id"):
        raise HTTPException(status_code=403, detail="Forbidden")
    return s


@api_router.get("/agent/sessions")
async def agent_list_sessions(request: Request):
    user = await get_current_user(request)
    cursor = db.chat_sessions.find(
        {"user_id": user["user_id"]},
        {"_id": 0, "session_id": 1, "title": 1, "created_at": 1, "updated_at": 1, "messages": {"$slice": -1}},
    ).sort("updated_at", -1).limit(50)
    rows = await cursor.to_list(50)
    return {"sessions": rows}


@api_router.delete("/agent/session/{session_id}")
async def agent_delete_session(session_id: str, request: Request):
    user = await get_current_user(request)
    res = await db.chat_sessions.delete_one({"session_id": session_id, "user_id": user["user_id"]})
    return {"deleted": res.deleted_count}



# ─────────────────────────────────────────────────────────────


# ── Seed Data ───────────────────────────────────────────────
async def seed_database():
    # SAFETY: never wipe production data on startup. Seeding only runs when
    # collections are empty (fresh DB) or when SEED_RESET=1 is set explicitly.
    # Previous behavior (unconditional delete_many) would erase live data on
    # every Render restart.
    force_reset = os.environ.get("SEED_RESET") == "1"
    seasons_count = await db.seasons.count_documents({})
    events_count = await db.events.count_documents({})
    partner_events_count = await db.partner_events.count_documents({})
    already_seeded = (seasons_count + events_count + partner_events_count) > 0

    if already_seeded and not force_reset:
        logger.info(
            f"Seed skipped — DB already populated (seasons={seasons_count}, "
            f"events={events_count}, partner_events={partner_events_count}). "
            "Set SEED_RESET=1 to force re-seed."
        )
        return

    if force_reset:
        logger.warning("SEED_RESET=1 — wiping and re-seeding seasons/events/partner_events")
        await db.seasons.delete_many({})
        await db.events.delete_many({})
        await db.partner_events.delete_many({})

    logger.info("Seeding database...")

    # Helper to compute date string offset from today (used by seasons, events, partner_events)
    today = datetime.now(timezone.utc).date()
    def d(offset: int) -> str:
        return (today + timedelta(days=offset)).strftime("%Y-%m-%d")

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
            "start_date": d(0),
            "end_date": d(14),
            "image_url": IMG_SUNSET,
            "color": "#D97706",
            "tags": ["Sunset", "Templo", "Beach", "Cultura", "Wellness"],
            "is_active": True,
            "event_count": 15,
        },
        {
            "season_id": "season_003",
            "name": "Summer Vibes",
            "subtitle": "El verano de Cartagena",
            "description": "Tres semanas de fiesta, playa, música electrónica y experiencias de verano en los mejores venues de Cartagena.",
            "start_date": d(30),
            "end_date": d(50),
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
            "start_date": d(60),
            "end_date": d(66),
            "image_url": IMG_WELLNESS,
            "color": "#059669",
            "tags": ["Yoga", "Meditación", "Sound Healing", "Retiros", "Spa"],
            "is_active": False,
            "event_count": 0,
        },
    ]

    events = [
        {"event_id":"evt_001","title":"Sunset Session","description":"Live DJ set contra el telón del legendario atardecer de Cartagena desde las murallas coloniales. Música chill, cócteles y vistas increíbles.","date":d(0),"start_time":"17:00","end_time":"20:00","venue_id":"ven_001","venue_name":"La Muralla","type":"sunset","is_free":True,"price":0,"image_url":IMG_SUNSET,"booking_link":"","capacity":500,"tags":["outdoor","music","sunset","free"],"location":{"lat":10.4236,"lng":-75.5483},"featured":True},
        {"event_id":"evt_002","title":"Electronic Sunset","description":"Sesión electrónica al atardecer con los mejores DJs internacionales. Drinks premium incluidos.","date":d(0),"start_time":"16:00","end_time":"21:00","venue_id":"ven_005","venue_name":"Café del Mar","type":"sunset","is_free":False,"price":150000,"image_url":IMG_DJ,"booking_link":"https://cafeDelmar.com/reserve","capacity":200,"tags":["electronic","sunset","premium"],"location":{"lat":10.4260,"lng":-75.5490},"featured":True},
        {"event_id":"evt_003","title":"Templo Night I","description":"La primera noche de Templo. Line-up internacional con los artistas más relevantes de la escena electrónica latina.","date":d(0),"start_time":"22:00","end_time":"05:00","venue_id":"ven_002","venue_name":"Templo","type":"concert","is_free":False,"price":250000,"image_url":IMG_CONCERT,"booking_link":"https://templo.co/tickets","capacity":2000,"tags":["electronic","nightlife","headline"],"location":{"lat":10.4195,"lng":-75.5455},"featured":True},
        {"event_id":"evt_004","title":"Sunrise Yoga","description":"Yoga al amanecer en la muralla con vista al mar Caribe. Incluye mat y agua.","date":d(1),"start_time":"06:00","end_time":"07:30","venue_id":"ven_001","venue_name":"La Muralla","type":"wellness","is_free":True,"price":0,"image_url":IMG_YOGA,"booking_link":"","capacity":60,"tags":["wellness","yoga","free","morning"],"location":{"lat":10.4236,"lng":-75.5483},"featured":False},
        {"event_id":"evt_005","title":"Brunch & Beats","description":"Brunch gourmet con DJ en vivo. Menú de autor con ingredientes locales y cócteles tropicales.","date":d(1),"start_time":"11:00","end_time":"15:00","venue_id":"ven_003","venue_name":"Casa Bohème","type":"brunch","is_free":False,"price":180000,"image_url":IMG_BRUNCH,"booking_link":"https://casaboheme.co/brunch","capacity":80,"tags":["food","music","brunch"],"location":{"lat":10.4228,"lng":-75.5510},"featured":True},
        {"event_id":"evt_006","title":"Beach Day Party","description":"Fiesta de día completa en la playa de Barú. Open bar, DJ internacional, comida de mar.","date":d(2),"start_time":"10:00","end_time":"18:00","venue_id":"ven_008","venue_name":"Isla Barú Beach Club","type":"beach_club","is_free":False,"price":350000,"image_url":IMG_BEACH,"booking_link":"https://barubeach.com/party","capacity":300,"tags":["beach","party","all-inclusive"],"location":{"lat":10.1817,"lng":-75.5847},"featured":True},
        {"event_id":"evt_007","title":"Candlelight Classical","description":"Concierto íntimo de música clásica a la luz de velas en el claustro de San Pedro Claver.","date":d(2),"start_time":"20:00","end_time":"22:00","venue_id":"ven_006","venue_name":"San Pedro Claver","type":"candlelight","is_free":False,"price":200000,"image_url":IMG_CANDLE,"booking_link":"https://candlelight.co/cartagena","capacity":120,"tags":["classical","intimate","cultural"],"location":{"lat":10.4228,"lng":-75.5498},"featured":False},
        {"event_id":"evt_008","title":"Templo Night II","description":"Segunda noche de Templo. After movie night con artistas sorpresa y producción inmersiva.","date":d(3),"start_time":"22:00","end_time":"06:00","venue_id":"ven_002","venue_name":"Templo","type":"concert","is_free":False,"price":280000,"image_url":IMG_NIGHT,"booking_link":"https://templo.co/tickets","capacity":2000,"tags":["electronic","nightlife","headline"],"location":{"lat":10.4195,"lng":-75.5455},"featured":True},
        {"event_id":"evt_009","title":"Pop-Up Art Gallery","description":"Exposición de arte contemporáneo colombiano en los salones del Hotel Santa Clara.","date":d(3),"start_time":"10:00","end_time":"20:00","venue_id":"ven_007","venue_name":"Hotel Santa Clara","type":"pop_up","is_free":True,"price":0,"image_url":IMG_POPUP,"booking_link":"","capacity":0,"tags":["art","culture","free"],"location":{"lat":10.4232,"lng":-75.5502},"featured":False},
        {"event_id":"evt_010","title":"Jazz & Wine Night","description":"Noche de jazz en vivo con maridaje de vinos premium. Artistas locales e internacionales.","date":d(4),"start_time":"20:00","end_time":"00:00","venue_id":"ven_004","venue_name":"Bellini","type":"cultural","is_free":False,"price":220000,"image_url":IMG_JAZZ,"booking_link":"https://bellini.co/jazz","capacity":80,"tags":["jazz","wine","intimate"],"location":{"lat":10.4240,"lng":-75.5475},"featured":False},
        {"event_id":"evt_011","title":"Morning Spinning","description":"Clase de spinning de alta energía frente al mar. 45 minutos de música y sudor.","date":d(4),"start_time":"07:00","end_time":"08:00","venue_id":"ven_009","venue_name":"Blue Apple Beach","type":"wellness","is_free":False,"price":80000,"image_url":IMG_YOGA,"booking_link":"https://blueapple.co/spinning","capacity":30,"tags":["wellness","fitness","morning"],"location":{"lat":10.1780,"lng":-75.5800},"featured":False},
        {"event_id":"evt_012","title":"Folklore Show","description":"Show de danzas folclóricas colombianas en la Plaza Santo Domingo. Cultura viva.","date":d(5),"start_time":"18:00","end_time":"20:00","venue_id":"ven_001","venue_name":"Plaza Santo Domingo","type":"cultural","is_free":True,"price":0,"image_url":IMG_CULTURE,"booking_link":"","capacity":500,"tags":["folklore","dance","free","cultural"],"location":{"lat":10.4233,"lng":-75.5512},"featured":False},
        {"event_id":"evt_013","title":"After Party Fénix","description":"After party oficial en Fénix. Los mejores DJs de la semana se reúnen para una última noche épica.","date":d(5),"start_time":"01:00","end_time":"07:00","venue_id":"ven_010","venue_name":"Fénix","type":"after_party","is_free":False,"price":120000,"image_url":IMG_NIGHT,"booking_link":"https://fenix.co/after","capacity":400,"tags":["nightlife","electronic","after-party"],"location":{"lat":10.4200,"lng":-75.5460},"featured":False},
        {"event_id":"evt_014","title":"Sunset Closing","description":"Ceremonia de cierre con DJ set y performance artístico en la muralla. El atardecer final de Amo Cartagena.","date":d(6),"start_time":"17:00","end_time":"21:00","venue_id":"ven_001","venue_name":"La Muralla","type":"sunset","is_free":True,"price":0,"image_url":IMG_CLOSING,"booking_link":"","capacity":1000,"tags":["closing","sunset","free","special"],"location":{"lat":10.4236,"lng":-75.5483},"featured":True},
        {"event_id":"evt_015","title":"DJ Set Blue Apple","description":"Set electrónico en el beach club más exclusivo de las islas. Transporte en lancha incluido.","date":d(6),"start_time":"14:00","end_time":"20:00","venue_id":"ven_009","venue_name":"Blue Apple Beach","type":"beach_club","is_free":False,"price":400000,"image_url":IMG_BEACH,"booking_link":"https://blueapple.co/djset","capacity":150,"tags":["beach","electronic","exclusive"],"location":{"lat":10.1780,"lng":-75.5800},"featured":False},
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
        {"partner_id":"ptr_001","name":"Casa Bohème","description":"Restaurante & cócteles de autor. Brunch oficial de Amo Cartagena.","category":"restaurant","tier":"premium","image_url":IMG_BRUNCH,"location":{"lat":10.4228,"lng":-75.5510},"address":"Calle de la Iglesia #35-76","booking_link":"https://casaboheme.co","price_range":"$$ - $$$","experience":"Brunch & Beats, cenas temáticas, cócteles de autor","is_certified":True},
        {"partner_id":"ptr_002","name":"Bellini","description":"Fine dining mediterráneo con fusión caribeña. Jazz & Wine nights.","category":"restaurant","tier":"elite","image_url":IMG_JAZZ,"location":{"lat":10.4240,"lng":-75.5475},"address":"Calle del Arsenal #10-40","booking_link":"https://bellini.co","price_range":"$$$","experience":"Menú degustación, Jazz & Wine Night, cena pre-Templo","is_certified":True},
        {"partner_id":"ptr_003","name":"Blue Apple Beach","description":"Beach club exclusivo en las Islas del Rosario. Wellness y fiestas privadas.","category":"beach_club","tier":"elite","image_url":IMG_BEACH,"location":{"lat":10.1780,"lng":-75.5800},"address":"Isla del Encanto, Islas del Rosario","booking_link":"https://blueapple.co","price_range":"$$$$","experience":"Day pass, spinning frente al mar, DJ sets exclusivos","is_certified":True},
        {"partner_id":"ptr_004","name":"Hotel Santa Clara","description":"Hotel boutique de lujo. Pop-ups artísticos y experiencias exclusivas.","category":"hotel","tier":"elite","image_url":IMG_POPUP,"location":{"lat":10.4232,"lng":-75.5502},"address":"Calle del Torno #39-29","booking_link":"https://hotelsantaclara.com","price_range":"$$$$","experience":"Habitaciones premium, pop-ups de arte, spa","is_certified":True},
        {"partner_id":"ptr_005","name":"Café del Mar","description":"El sunset bar más icónico de Cartagena sobre las murallas.","category":"club","tier":"premium","image_url":IMG_SUNSET,"location":{"lat":10.4260,"lng":-75.5490},"address":"Baluarte de Santo Domingo","booking_link":"https://cafedelmar.com","price_range":"$$ - $$$","experience":"Sunset sessions, cócteles signature, DJ sets","is_certified":True},
        {"partner_id":"ptr_006","name":"El Arsenal Wellness","description":"Centro de bienestar con yoga, meditación y terapias holísticas.","category":"wellness","tier":"popular","image_url":IMG_YOGA,"location":{"lat":10.4215,"lng":-75.5470},"address":"Calle del Arsenal #8-12, Getsemaní","booking_link":"https://elarsenal.co/wellness","price_range":"$$","experience":"Yoga sunrise, meditación, masajes, sound healing","is_certified":True},
        {"partner_id":"ptr_007","name":"Movich Hotel Cartagena","description":"Hotel moderno con rooftop pool y vistas al centro histórico.","category":"hotel","tier":"premium","image_url":IMG_CLOSING,"location":{"lat":10.4210,"lng":-75.5440},"address":"Calle del Porvenir #35-66","booking_link":"https://movich.co/cartagena","price_range":"$$$","experience":"Rooftop bar, pool party, paquete Amo Cartagena","is_certified":True},
        {"partner_id":"ptr_008","name":"Isla Barú Beach Club","description":"Beach club all-inclusive en la playa más hermosa de Colombia.","category":"beach_club","tier":"popular","image_url":IMG_BEACH,"location":{"lat":10.1817,"lng":-75.5847},"address":"Playa Blanca, Isla Barú","booking_link":"https://barubeach.com","price_range":"$$$","experience":"Beach party, gastronomía de mar, transporte en lancha","is_certified":True},
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
        ],"departure_point":"Muelle Turístico de la Bodeguita","departure_location":{"lat":10.4200,"lng":-75.5500},"price":"","notes":"Llevar protector solar. Regreso última lancha 16:00.","partner_name":"Transporte Oficial Amo Cartagena","last_return":"16:00"},
        {"transport_id":"trn_002","type":"boat","route":"Muelle Turístico → Isla Barú (Playa Blanca)","schedule":[
            {"departure":"08:30","arrival":"09:30","notes":"Servicio directo"},
            {"departure":"10:00","arrival":"11:00","notes":"Segunda salida"},
        ],"departure_point":"Muelle Turístico de la Bodeguita","departure_location":{"lat":10.4200,"lng":-75.5500},"price":"","notes":"Regreso última lancha 17:00. Incluye chaleco salvavidas.","partner_name":"Lanchas Amo Cartagena","last_return":"17:00"},
    ]

    notifications = [
        {"notification_id":"ntf_001","user_id":None,"title":"Bienvenido a Amo Cartagena","message":"Amo Cartagena te da la bienvenida. Explora la agenda y planifica tu semana perfecta.","type":"general","event_id":"","is_read":False,"created_at":datetime.now(timezone.utc).isoformat()},
        {"notification_id":"ntf_002","user_id":None,"title":"Sunset en 30 min","message":"El Sunset Session en La Muralla comienza en 30 minutos. No te lo pierdas.","type":"event_reminder","event_id":"evt_001","is_read":False,"created_at":datetime.now(timezone.utc).isoformat()},
        {"notification_id":"ntf_003","user_id":None,"title":"Última lancha 16:00","message":"Recuerda: la última lancha de regreso de Islas del Rosario sale a las 16:00.","type":"transport","event_id":"","is_read":False,"created_at":datetime.now(timezone.utc).isoformat()},
        {"notification_id":"ntf_004","user_id":None,"title":"Templo Night I - Sold Out","message":"Templo Night I está sold out. Quedan pocas mesas VIP disponibles.","type":"event_reminder","event_id":"evt_003","is_read":False,"created_at":datetime.now(timezone.utc).isoformat()},
    ]

    await db.seasons.insert_many(seasons)
    await db.events.insert_many(events)
    await db.venues.delete_many({}); await db.venues.insert_many(venues)
    # Upsert partners to avoid duplicates on restart
    for p in partners:
        await db.partners.update_one(
            {"partner_id": p["partner_id"]},
            {"$setOnInsert": p},
            upsert=True,
        )
    await db.itineraries.delete_many({}); await db.itineraries.insert_many(itineraries)
    await db.transport.delete_many({}); await db.transport.insert_many(transport_data)
    await db.notifications.delete_many({}); await db.notifications.insert_many(notifications)

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
    base_date = datetime.now(timezone.utc) - timedelta(days=13)
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

# ── Admin Operator & Partner Activation routers ──
try:
    from admin_operator import router as _admin_op_router, public_router as _biz_activation_router  # type: ignore
    app.include_router(_admin_op_router, prefix="/api")
    app.include_router(_biz_activation_router, prefix="/api")
    # Expose db so admin_operator handlers can reach it
    app.state.db = db
except Exception as _exc:
    logger.warning(f"admin_operator router not loaded: {_exc}")

# Mount the reservations router (separate module — see /app/backend/reservations.py)
_reservations.init(
    db=db,
    get_current_user=get_current_user,
    get_current_business=get_current_business,
    require_government_role=_require_government_role,
    wompi=_wompi,
    create_payment_record=_create_payment_record,
)
app.include_router(_reservations.router, prefix="/api")

_rewards.init(db=db, get_current_user=get_current_user)
app.include_router(_rewards.router, prefix="/api")

_reviews.init(db=db, get_current_user=get_current_user, award_points=_rewards.award_points)
app.include_router(_reviews.router, prefix="/api")

# ── CORS ─────────────────────────────────────────────────────
# Browsers REJECT the combination of `allow_credentials=True` + `allow_origins=["*"]`
# (CORS spec disallows credentialed wildcard). The previous config silently broke
# cookie-auth from mobile Safari (commit edc0e75 tried to patch the symptom).
#
# Strategy:
#   * Production: explicit origin allow-list from CORS_ALLOWED_ORIGINS env var
#     (comma-separated). Required if credentials are used.
#   * Dev fallback: regex matching common local + preview hosts.
_default_dev_origins = [
    "http://localhost:8081",
    "http://localhost:3000",
    "http://localhost:19006",
]
_env_origins = [o.strip() for o in os.environ.get("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()]
_allowed_origins = _env_origins or _default_dev_origins

# Production: CORS_ALLOWED_ORIGINS must be set explicitly. No wildcard regex.
if not _env_origins:
    logger.warning("CORS_ALLOWED_ORIGINS not set — using localhost-only dev defaults. "
                    "Set CORS_ALLOWED_ORIGINS in production (e.g. https://amocartagena.app)")

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=_allowed_origins,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With", "Accept", "Cookie"],
)


@app.on_event("startup")
async def startup():
    # On Vercel serverless: skip ALL seeding, migrations, and background tasks.
    # Data is already in Atlas. Indexes were created by local runs.
    if os.environ.get("VERCEL"):
        logger.info("Vercel serverless — skipping startup seed/migrations")
        return
    await seed_database()
    # Ensure indexes for the reservations module
    await _reservations.ensure_indexes()
    # Rewards indexes and seed data
    await db.rewards_accounts.create_index("user_id", unique=True)
    await db.rewards_history.create_index([("user_id", 1), ("created_at", -1)])
    await db.rewards_offers.create_index("offer_id", unique=True)
    await db.rewards_redemptions.create_index([("user_id", 1), ("created_at", -1)])
    await _rewards.seed_default_offers(db)
    # Reviews indexes
    await db.reviews.create_index([("partner_id", 1), ("created_at", -1)])
    await db.reviews.create_index([("user_id", 1), ("partner_id", 1)], unique=True)
    await db.review_reports.create_index([("review_id", 1), ("reporter_user_id", 1)], unique=True)
    # ── Start the favorite-event reminder scheduler (24h push reminders) ──
    # Skip on Vercel — no persistent process for background tasks
    if not os.environ.get("VERCEL"):
        try:
            from reminders import start_reminder_scheduler  # type: ignore
            start_reminder_scheduler(db)
        except Exception as exc:
            logger.warning(f"Could not start reminder scheduler: {exc}")
    # Seed analytics demo data separately if not yet seeded (skip on Vercel)
    if not os.environ.get("VERCEL"):
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


    # Seed concerts if not yet seeded
    concerts_count = await db.concerts.count_documents({})
    if concerts_count == 0:
        await seed_concerts()

    # ── Migration: Add tier field to existing partners ──
    PARTNER_TIERS = {
        # Original 8
        "ptr_001": "premium", "ptr_002": "elite",   "ptr_003": "elite",
        "ptr_004": "elite",   "ptr_005": "premium", "ptr_006": "popular",
        "ptr_007": "premium", "ptr_008": "popular",
        # NuestraCartagena partners
        "ptr_nc_001": "premium",  # Carmen (restaurante destacado)
        "ptr_nc_002": "premium",  # El Beso
        "ptr_nc_003": "popular",  # Nia Bakery
        "ptr_nc_004": "premium",  # Salon Tropical
        "ptr_nc_005": "elite",    # Casa Carolina (boutique hotel)
        "ptr_nc_006": "premium",  # Townhouse
        "ptr_nc_007": "premium",  # Casa Bohème
        "ptr_nc_008": "elite",    # Members Only (exclusivo)
        "ptr_nc_009": "elite",    # Blue Apple
        "ptr_nc_010": "premium",  # The Pink Mango
        "ptr_nc_011": "elite",    # La Serrezuela (lujo)
        "ptr_nc_012": "elite",    # Lucy Jewelry
        "ptr_nc_013": "elite",    # Lunático Experience
        "ptr_nc_014": "elite",    # Boating Cartagena (yates)
        "ptr_nc_015": "popular",  # Green Apple Foundation
        "ptr_nc_016": "premium",  # Casa Bohème (duplicado)
        # LAGO
        "ptr_lago_001": "premium",
        # Monumentos & Museos (cultura accesible)
        "ptr_mon_001": "popular", "ptr_mon_002": "popular",
        "ptr_mon_003": "popular", "ptr_mon_004": "popular",
        "ptr_mon_005": "popular", "ptr_mon_006": "popular",
        "ptr_mon_007": "popular", "ptr_mon_008": "popular",
    }
    # Always ensure tiers are correctly set for known partner IDs
    for pid, tier in PARTNER_TIERS.items():
        await db.partners.update_one({"partner_id": pid}, {"$set": {"tier": tier}})
    # Default any remaining partners without explicit tier to popular
    await db.partners.update_many({"tier": {"$exists": False}}, {"$set": {"tier": "popular"}})
    logger.info("Partner tier migration applied!")

    # ── Migration: Add Instagram + extended fields to partners ──
    PARTNER_INSTAGRAM = {
        "ptr_001": "casaboheme.cartagena", "ptr_002": "bellini.cartagena",
        "ptr_003": "blueapplebeach", "ptr_004": "hotelsantaclara",
        "ptr_005": "cafedelmar.cartagena", "ptr_006": "elarsenalwellness",
        "ptr_007": "movichcartagena", "ptr_008": "barubeachclub",
        "ptr_nc_001": "carmen.cartagena", "ptr_nc_002": "elbeso.cartagena",
        "ptr_nc_003": "niabakery", "ptr_nc_004": "salontropical.co",
        "ptr_nc_005": "casacarolinacartagena", "ptr_nc_006": "townhouse.cartagena",
        "ptr_nc_007": "casaboheme.cartagena", "ptr_nc_008": "membersonly.cartagena",
        "ptr_nc_009": "blueapplebeach", "ptr_nc_010": "thepinkmango",
        "ptr_nc_011": "laserrezuela", "ptr_nc_012": "lucyjewelry",
        "ptr_nc_013": "lunatico.experience", "ptr_nc_014": "boatingcartagena",
        "ptr_nc_015": "greenapplefoundation", "ptr_nc_016": "casaboheme.cartagena",
        "ptr_lago_001": "lagocartagena",
    }
    for pid, ig in PARTNER_INSTAGRAM.items():
        await db.partners.update_one(
            {"partner_id": pid, "instagram": {"$exists": False}},
            {"$set": {"instagram": ig}}
        )

    # ── Migration: Ensure every partner has an image_url ──
    PARTNER_IMAGES = {
        "ptr_nc_001": "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&q=80",   # Carmen — fine dining
        "ptr_nc_002": "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&q=80",       # El Beso — cocktail bar
        "ptr_nc_003": "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600&q=80",    # Nia Bakery — bakery
        "ptr_nc_004": "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&q=80",    # Salon Tropical — restaurant
        "ptr_nc_005": "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600&q=80",    # Casa Carolina — boutique hotel
        "ptr_nc_006": "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&q=80",       # Townhouse — bar/restaurant
        "ptr_nc_007": "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&q=80",    # Casa Boheme — brunch/restaurant
        "ptr_nc_008": "https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=600&q=80",    # Members Only — exclusive club
        "ptr_nc_009": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600&q=80",    # Blue Apple — beach club
        "ptr_nc_010": "https://images.unsplash.com/photo-1540541338287-41700207dee6?w=600&q=80",    # Pink Mango — beach/pool
        "ptr_nc_011": "https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=600&q=80",    # La Serrezuela — luxury shopping
        "ptr_nc_012": "https://images.unsplash.com/photo-1515562141589-67f0d382c7b4?w=600&q=80",    # Lucy Jewelry — jewelry
        "ptr_nc_013": "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600&q=80",    # Lunatico — nightlife
        "ptr_nc_014": "https://images.unsplash.com/photo-1567899378494-47b22a2ae96a?w=600&q=80",    # Boating Cartagena — yachts
        "ptr_nc_015": "https://images.unsplash.com/photo-1569154941061-e231b4725ef1?w=600&q=80",    # Green Apple — cultural/charity
        "ptr_nc_016": "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&q=80",    # Casa Boheme dup — restaurant
        "ptr_lago_001": "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=600&q=80",     # LAGO — wellness
    }
    for pid, img in PARTNER_IMAGES.items():
        await db.partners.update_one(
            {"partner_id": pid, "$or": [{"image_url": {"$exists": False}}, {"image_url": ""}, {"image_url": None}]},
            {"$set": {"image_url": img}}
        )
    logger.info("Partner image migration applied — 17 partners backfilled")

    # ── Seed: Partner Events (eventos publicados por partners) ──
    # Gated: only wipe + re-seed if collection is empty OR SEED_RESET=1.
    # Prevents data loss on every Render restart.
    pe_count = await db.partner_events.count_documents({})
    if pe_count > 0 and os.environ.get("SEED_RESET") != "1":
        logger.info(f"Partner events already seeded ({pe_count}) — skipping re-seed")
    else:
        if pe_count > 0:
            logger.warning("SEED_RESET=1 — wiping partner_events")
            await db.partner_events.delete_many({})
        logger.info("Seeding partner events...")
        today = datetime.now(timezone.utc).date()
        def d(offset: int) -> str:
            return (today + timedelta(days=offset)).strftime("%Y-%m-%d")

        FLYER_BRUNCH = "https://images.unsplash.com/photo-1551218808-94e220e084d2?w=800&h=1000&fit=crop"
        FLYER_DJ = "https://images.unsplash.com/photo-1571266028243-e4733b0f0bb0?w=800&h=1000&fit=crop"
        FLYER_DINNER = "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&h=1000&fit=crop"
        FLYER_BEACH = "https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&h=1000&fit=crop"
        FLYER_YOGA = "https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=800&h=1000&fit=crop"
        FLYER_SUNSET = "https://images.unsplash.com/photo-1495567720989-cebdbdd97913?w=800&h=1000&fit=crop"
        FLYER_JAZZ = "https://images.unsplash.com/photo-1415201364774-f6f0bb35f28f?w=800&h=1000&fit=crop"
        FLYER_PARTY = "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&h=1000&fit=crop"
        FLYER_ART = "https://images.unsplash.com/photo-1531058020387-3be344556be6?w=800&h=1000&fit=crop"
        FLYER_SHOPPING = "https://images.unsplash.com/photo-1581291518633-83b4ebd1d83e?w=800&h=1000&fit=crop"

        partner_events_seed = [
            # Hoy
            {"event_id": "pe_001", "partner_id": "ptr_001", "title": "Brunch & Beats — Sunday Edition", "description": "Brunch dominical con DJ en vivo. Mimosas ilimitadas hasta las 14:00. Reserva tu mesa.", "category": "gastronomy", "date": d(0), "start_time": "11:00", "end_time": "15:00", "flyer_url": FLYER_BRUNCH, "is_free": False, "price": 95000, "currency": "COP", "booking_link": "https://casaboheme.co/reservar"},
            {"event_id": "pe_002", "partner_id": "ptr_005", "title": "Sunset Sessions ft. DJ Local", "description": "Las mejores vistas de la ciudad amurallada con un set de deep house. Cócteles signature al 2x1 hasta las 19:00.", "category": "music", "date": d(0), "start_time": "17:00", "end_time": "22:00", "flyer_url": FLYER_SUNSET, "is_free": False, "price": 60000, "currency": "COP", "booking_link": "https://cafedelmar.com/reservar"},
            {"event_id": "pe_003", "partner_id": "ptr_006", "title": "Yoga al amanecer", "description": "Sesión de yoga frente al mar guiada por instructora certificada. Incluye té matcha y fruta tropical.", "category": "wellness", "date": d(0), "start_time": "06:30", "end_time": "08:00", "flyer_url": FLYER_YOGA, "is_free": False, "price": 45000, "currency": "COP", "booking_link": "https://elarsenal.co/wellness"},
            # Mañana
            {"event_id": "pe_004", "partner_id": "ptr_002", "title": "Jazz & Wine Night", "description": "Trío de jazz en vivo + maridaje de vinos italianos. Menú degustación 5 tiempos.", "category": "music", "date": d(1), "start_time": "20:00", "end_time": "23:30", "flyer_url": FLYER_JAZZ, "is_free": False, "price": 220000, "currency": "COP", "booking_link": "https://bellini.co/reservar"},
            {"event_id": "pe_005", "partner_id": "ptr_003", "title": "Pool Party — White Edition", "description": "Vístete de blanco y disfruta de DJs internacionales, cocteles infusionados y la mejor piscina de Cartagena.", "category": "party", "date": d(1), "start_time": "13:00", "end_time": "20:00", "flyer_url": FLYER_PARTY, "is_free": False, "price": 280000, "currency": "COP", "booking_link": "https://blueapple.co/reservar"},
            {"event_id": "pe_006", "partner_id": "ptr_nc_001", "title": "Cena Maridaje — Sabores del Caribe", "description": "5 platos del chef ejecutivo maridados con vinos de la región. Cupos limitados.", "category": "gastronomy", "date": d(1), "start_time": "19:30", "end_time": "23:00", "flyer_url": FLYER_DINNER, "is_free": False, "price": 280000, "currency": "COP", "booking_link": "https://carmen.com.co/reservar"},
            # +2
            {"event_id": "pe_007", "partner_id": "ptr_nc_011", "title": "Pop-Up Diseñadores Locales", "description": "10 diseñadores colombianos exhiben sus colecciones cápsula. Acceso libre con cocktail de bienvenida.", "category": "popup", "date": d(2), "start_time": "16:00", "end_time": "21:00", "flyer_url": FLYER_SHOPPING, "is_free": True, "price": 0, "currency": "COP", "booking_link": ""},
            {"event_id": "pe_008", "partner_id": "ptr_nc_008", "title": "Members Only — Disco Night", "description": "Una noche de pura disco music. Lista exclusiva, dress code obligatorio.", "category": "party", "date": d(2), "start_time": "23:00", "end_time": "04:00", "flyer_url": FLYER_DJ, "is_free": False, "price": 150000, "currency": "COP", "booking_link": "https://membersonly.co/reservar"},
            {"event_id": "pe_009", "partner_id": "ptr_004", "title": "Pop-Up Art Gallery", "description": "Exposición de arte contemporáneo del Caribe colombiano. Coctel de inauguración.", "category": "art", "date": d(2), "start_time": "18:00", "end_time": "22:00", "flyer_url": FLYER_ART, "is_free": True, "price": 0, "currency": "COP", "booking_link": "https://hotelsantaclara.com"},
            # +3
            {"event_id": "pe_010", "partner_id": "ptr_007", "title": "Rooftop Pool Sunday", "description": "Tarde de domingo en la piscina rooftop con DJ acústico. Brunch buffet disponible.", "category": "party", "date": d(3), "start_time": "12:00", "end_time": "19:00", "flyer_url": FLYER_BEACH, "is_free": False, "price": 120000, "currency": "COP", "booking_link": "https://movich.co/cartagena"},
            {"event_id": "pe_011", "partner_id": "ptr_nc_003", "title": "Workshop de pastelería francesa", "description": "Aprende a hacer croissants y pain au chocolat con la chef Camille. Te llevas tus creaciones.", "category": "gastronomy", "date": d(3), "start_time": "09:00", "end_time": "12:00", "flyer_url": FLYER_BRUNCH, "is_free": False, "price": 180000, "currency": "COP", "booking_link": "https://niabakery.com/reservar"},
            # +4
            {"event_id": "pe_012", "partner_id": "ptr_nc_013", "title": "Lunático Experience — Cena Inmersiva", "description": "Una experiencia gastronómica multisensorial con proyecciones, música y cocina molecular.", "category": "gastronomy", "date": d(4), "start_time": "20:00", "end_time": "23:30", "flyer_url": FLYER_DINNER, "is_free": False, "price": 380000, "currency": "COP", "booking_link": "https://lunatico.co/reservar"},
            {"event_id": "pe_013", "partner_id": "ptr_nc_014", "title": "Yacht Day — Islas del Rosario", "description": "Día completo en yate privado: snorkeling, almuerzo a bordo, open bar. 12 personas máximo.", "category": "party", "date": d(4), "start_time": "09:00", "end_time": "17:00", "flyer_url": FLYER_BEACH, "is_free": False, "price": 750000, "currency": "COP", "booking_link": "https://boatingcartagena.com/reservar"},
            # +5
            {"event_id": "pe_014", "partner_id": "ptr_nc_009", "title": "Wellness Retreat Day", "description": "Día completo de bienestar: yoga, meditación, masaje, almuerzo plant-based y acceso a la playa privada.", "category": "wellness", "date": d(5), "start_time": "08:00", "end_time": "17:00", "flyer_url": FLYER_YOGA, "is_free": False, "price": 320000, "currency": "COP", "booking_link": "https://blueapple.co/wellness"},
            # +6
            {"event_id": "pe_015", "partner_id": "ptr_nc_004", "title": "Salsa & Rumba Tropical", "description": "Noche de salsa con orquesta en vivo y clases gratuitas para principiantes desde las 21:00.", "category": "music", "date": d(6), "start_time": "21:00", "end_time": "02:00", "flyer_url": FLYER_PARTY, "is_free": False, "price": 50000, "currency": "COP", "booking_link": "https://salontropical.co/reservar"},
            # +7
            {"event_id": "pe_016", "partner_id": "ptr_nc_005", "title": "Brunch en el patio colonial", "description": "Brunch a la carta en el patio del hotel boutique Casa Carolina. Reserva una mesa al sol.", "category": "gastronomy", "date": d(7), "start_time": "10:00", "end_time": "14:00", "flyer_url": FLYER_BRUNCH, "is_free": False, "price": 110000, "currency": "COP", "booking_link": "https://casacarolina.com/reservar"},
            {"event_id": "pe_017", "partner_id": "ptr_nc_002", "title": "Late Night Tapas", "description": "Tapas españolas + DJ set hasta tarde. Ambientazo y cocktails creativos.", "category": "gastronomy", "date": d(7), "start_time": "22:00", "end_time": "02:00", "flyer_url": FLYER_DINNER, "is_free": False, "price": 80000, "currency": "COP", "booking_link": "https://elbeso.co/reservar"},
            # +10
            {"event_id": "pe_018", "partner_id": "ptr_lago_001", "title": "LAGO Music Festival — Day 1", "description": "Festival de música electrónica con line-up internacional. 3 stages, food trucks y pool zone.", "category": "music", "date": d(10), "start_time": "16:00", "end_time": "04:00", "flyer_url": FLYER_DJ, "is_free": False, "price": 320000, "currency": "COP", "booking_link": "https://lago.co/festival"},
            {"event_id": "pe_019", "partner_id": "ptr_nc_010", "title": "Tropical Cocktail Masterclass", "description": "Aprende a preparar 3 cocteles tropicales con el bartender residente. Incluye degustación.", "category": "gastronomy", "date": d(10), "start_time": "18:00", "end_time": "20:30", "flyer_url": FLYER_DINNER, "is_free": False, "price": 95000, "currency": "COP", "booking_link": "https://thepinkmango.co/reservar"},
            # +14
            {"event_id": "pe_020", "partner_id": "ptr_001", "title": "Cena Tematica — Marruecos en Cartagena", "description": "Menú degustación de inspiración marroquí con música oriental en vivo.", "category": "gastronomy", "date": d(14), "start_time": "20:00", "end_time": "23:30", "flyer_url": FLYER_DINNER, "is_free": False, "price": 240000, "currency": "COP", "booking_link": "https://casaboheme.co/reservar"},
        ]
        # Add common fields
        for pe in partner_events_seed:
            pe["is_published"] = True
            pe["is_active"] = True
            pe["created_at"] = datetime.now(timezone.utc).isoformat()
            pe["views_count"] = 0
            pe["reserve_clicks"] = 0
        await db.partner_events.insert_many(partner_events_seed)
        await db.partner_events.create_index("date")
        await db.partner_events.create_index("category")
        await db.partner_events.create_index("partner_id")
        logger.info(f"Seeded {len(partner_events_seed)} partner events!")

    # ── Migration: Backfill is_active on partner_events that only have is_published ──
    await db.partner_events.update_many(
        {"is_published": True, "is_active": {"$exists": False}},
        {"$set": {"is_active": True}},
    )

    # ── Migration: Re-map partner events with non-existent partner IDs ──
    PARTNER_ID_REMAP = {
        "ptr_001": "ptr_nc_007",   # Casa Bohème
        "ptr_003": "ptr_nc_009",   # Blue Apple
        "ptr_008": "ptr_nc_009",   # Isla Barú → Blue Apple (closest match)
    }
    for old_id, new_id in PARTNER_ID_REMAP.items():
        await db.partner_events.update_many({"partner_id": old_id}, {"$set": {"partner_id": new_id}})

    # ── Migration: Seed Real Estate (Inmobiliario) partners (idempotent) ──
    REALESTATE_PARTNERS = [
        {
            "partner_id": "ptr_re_001",
            "name": "Cartagena Luxury Rentals",
            "description": "Apartamentos y casas de lujo en el Centro Histórico, Bocagrande y Manga. Estancias cortas y largas.",
            "category": "realestate",
            "tier": "premium",
            "image_url": "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800&h=600&fit=crop",
            "location": {"lat": 10.4231, "lng": -75.5519},
            "address": "Centro Histórico, Cartagena",
            "booking_link": "https://cartagenaluxuryrentals.com",
            "price_range": "$$$",
            "experience": "Apartamentos boutique, casas coloniales restauradas, concierge incluido",
            "is_certified": True,
            "instagram": "@cartagenaluxuryrentals",
        },
        {
            "partner_id": "ptr_re_002",
            "name": "Inmobiliaria Centro",
            "description": "Compra, venta y alquiler de propiedades en el Centro Histórico de Cartagena. Inversiones turísticas.",
            "category": "realestate",
            "tier": "popular",
            "image_url": "https://images.unsplash.com/photo-1582407947304-fd86f028f716?w=800&h=600&fit=crop",
            "location": {"lat": 10.4239, "lng": -75.5489},
            "address": "Calle de la Factoría, Centro",
            "booking_link": "https://inmobiliariacentro.co",
            "price_range": "$$",
            "experience": "Casas coloniales, lofts modernos, asesoría legal completa",
            "is_certified": True,
            "instagram": "@inmobiliariacentro",
        },
        {
            "partner_id": "ptr_re_003",
            "name": "Bocagrande Properties",
            "description": "Propiedades premium frente al mar en Bocagrande y Castillogrande. Vistas espectaculares al Caribe.",
            "category": "realestate",
            "tier": "elite",
            "image_url": "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&h=600&fit=crop",
            "location": {"lat": 10.3989, "lng": -75.5547},
            "address": "Avenida San Martín, Bocagrande",
            "booking_link": "https://bocagrandeproperties.com",
            "price_range": "$$$",
            "experience": "Penthouses, apartamentos vista al mar, asesoría para extranjeros, gestión 360°",
            "is_certified": True,
            "instagram": "@bocagrandeproperties",
        },
    ]
    for partner in REALESTATE_PARTNERS:
        await db.partners.update_one(
            {"partner_id": partner["partner_id"]},
            {"$setOnInsert": partner},
            upsert=True,
        )

    # ── Migration: Seed Wellness & Spa partners with subcategories (idempotent) ──
    WELLNESS_PARTNERS = [
        # SPA
        {
            "partner_id": "ptr_wn_001", "subcategory": "spa",
            "name": "Cartagena Spa & Wellness",
            "description": "Centro de bienestar holístico con masajes, faciales, sauna y piscina termal. Ambiente sereno frente al mar.",
            "category": "wellness", "tier": "premium",
            "image_url": "https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=800&h=600&fit=crop",
            "location": {"lat": 10.4192, "lng": -75.5538},
            "address": "Centro Histórico, Cartagena",
            "booking_link": "https://cartagenaspa.com",
            "price_range": "$$$",
            "experience": "Masajes signature, ritual de chocolate, piscina termal",
            "is_certified": True, "instagram": "@cartagenaspa",
        },
        # YOGA
        {
            "partner_id": "ptr_wn_002", "subcategory": "yoga",
            "name": "Yoga Caribe Studio",
            "description": "Clases de yoga y meditación en rooftop con vista al mar. Sesiones diarias al amanecer y atardecer.",
            "category": "wellness", "tier": "popular",
            "image_url": "https://images.unsplash.com/photo-1545205597-3d9d02c29597?w=800&h=600&fit=crop",
            "location": {"lat": 10.4255, "lng": -75.5482},
            "address": "Getsemaní, Cartagena",
            "booking_link": "https://yogacaribe.com",
            "price_range": "$$",
            "experience": "Hatha, vinyasa, meditación guiada, sound healing",
            "is_certified": True, "instagram": "@yogacaribe",
        },
        # FITNESS
        {
            "partner_id": "ptr_wn_003", "subcategory": "fitness",
            "name": "Pilates Studio Bocagrande",
            "description": "Estudio boutique de Pilates con reformer, mat y barre. Entrenadores certificados, ambiente premium.",
            "category": "wellness", "tier": "premium",
            "image_url": "https://images.unsplash.com/photo-1518611012118-696072aa579a?w=800&h=600&fit=crop",
            "location": {"lat": 10.4001, "lng": -75.5552},
            "address": "Avenida San Martín, Bocagrande",
            "booking_link": "https://pilatesbocagrande.com",
            "price_range": "$$",
            "experience": "Clases privadas, grupales y plan mensual",
            "is_certified": True, "instagram": "@pilatesbocagrande",
        },
        # BEAUTY
        {
            "partner_id": "ptr_wn_004", "subcategory": "beauty",
            "name": "Glow Beauty Lounge",
            "description": "Salón de belleza integral: faciales, depilación, maquillaje profesional para eventos.",
            "category": "wellness", "tier": "popular",
            "image_url": "https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?w=800&h=600&fit=crop",
            "location": {"lat": 10.4198, "lng": -75.5512},
            "address": "Manga, Cartagena",
            "booking_link": "https://glowbeauty.co",
            "price_range": "$$",
            "experience": "Tratamientos faciales con productos coreanos, maquillaje pro",
            "is_certified": True, "instagram": "@glowbeauty",
        },
        # HAIR
        {
            "partner_id": "ptr_wn_005", "subcategory": "hair",
            "name": "Salón Tropical Hair Studio",
            "description": "Hair stylists especialistas en cabello tropical. Cortes, color, balayage, tratamientos hidratantes.",
            "category": "wellness", "tier": "premium",
            "image_url": "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800&h=600&fit=crop",
            "location": {"lat": 10.4221, "lng": -75.5530},
            "address": "Centro, Cartagena",
            "booking_link": "https://tropicalhair.co",
            "price_range": "$$$",
            "experience": "Color, balayage, brushing, novia",
            "is_certified": True, "instagram": "@tropicalhair",
        },
        # NAILS
        {
            "partner_id": "ptr_wn_006", "subcategory": "nails",
            "name": "Bella Nails Bar",
            "description": "Bar de uñas premium: manicura, pedicura, gel, nail art y nail spa con cócteles incluidos.",
            "category": "wellness", "tier": "popular",
            "image_url": "https://images.unsplash.com/photo-1604654894610-df63bc536371?w=800&h=600&fit=crop",
            "location": {"lat": 10.4068, "lng": -75.5491},
            "address": "Bocagrande, Cartagena",
            "booking_link": "https://bellanails.co",
            "price_range": "$$",
            "experience": "Mani-pedi spa, gel, acrílico, nail art tropical",
            "is_certified": True, "instagram": "@bellanails",
        },
        # RECOVERY
        {
            "partner_id": "ptr_wn_007", "subcategory": "recovery",
            "name": "RecoveryLab Cartagena",
            "description": "Centro de recuperación deportiva: crioterapia, presoterapia, baños de hielo, infrarrojos.",
            "category": "wellness", "tier": "elite",
            "image_url": "https://images.unsplash.com/photo-1599447421416-3414500d18a5?w=800&h=600&fit=crop",
            "location": {"lat": 10.4012, "lng": -75.5543},
            "address": "Castillogrande, Cartagena",
            "booking_link": "https://recoverylab.co",
            "price_range": "$$$",
            "experience": "Crioterapia full body, presoterapia, sauna infrarroja, masaje deportivo",
            "is_certified": True, "instagram": "@recoverylab",
        },
        # FITNESS extra
        {
            "partner_id": "ptr_wn_008", "subcategory": "fitness",
            "name": "CrossFit Cartagena",
            "description": "Box de CrossFit con coaches certificados L1/L2. Clases grupales, open gym y personal training.",
            "category": "wellness", "tier": "popular",
            "image_url": "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&h=600&fit=crop",
            "location": {"lat": 10.4045, "lng": -75.5503},
            "address": "Manga, Cartagena",
            "booking_link": "https://crossfitcartagena.co",
            "price_range": "$$",
            "experience": "WOD diario, mobility, gymnastics, weightlifting",
            "is_certified": True, "instagram": "@crossfitcartagena",
        },
        # SPA extra
        {
            "partner_id": "ptr_wn_009", "subcategory": "spa",
            "name": "Sereno Spa Boutique",
            "description": "Spa boutique con cabinas privadas. Rituales de aromaterapia, masaje balinés y faciales personalizados.",
            "category": "wellness", "tier": "premium",
            "image_url": "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&h=600&fit=crop",
            "location": {"lat": 10.4175, "lng": -75.5495},
            "address": "Getsemaní, Cartagena",
            "booking_link": "https://serenospa.com",
            "price_range": "$$$",
            "experience": "Aromaterapia, balinés, hot stone, ritual de novia",
            "is_certified": True, "instagram": "@serenospa",
        },
        # SPORT (deportes outdoor / competitivos)
        {
            "partner_id": "ptr_wn_010", "subcategory": "sport",
            "name": "Padel Club Cartagena",
            "description": "Club de padel con 6 canchas profesionales. Clases con coaches certificados, torneos semanales y alquiler.",
            "category": "wellness", "tier": "premium",
            "image_url": "https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=800&h=600&fit=crop",
            "location": {"lat": 10.3985, "lng": -75.5510},
            "address": "Castillogrande, Cartagena",
            "booking_link": "https://padelcartagena.com",
            "price_range": "$$",
            "experience": "Canchas iluminadas, clases privadas y grupales, torneos",
            "is_certified": True, "instagram": "@padelcartagena",
        },
        {
            "partner_id": "ptr_wn_011", "subcategory": "sport",
            "name": "Tennis Club Bocagrande",
            "description": "Club de tenis con 4 canchas de polvo de ladrillo. Clases para todos los niveles y ranking interno.",
            "category": "wellness", "tier": "popular",
            "image_url": "https://images.unsplash.com/photo-1622279457486-62dcc4a431d6?w=800&h=600&fit=crop",
            "location": {"lat": 10.4019, "lng": -75.5530},
            "address": "Bocagrande, Cartagena",
            "booking_link": "https://tennisbocagrande.co",
            "price_range": "$$",
            "experience": "Clases pro, sparring, alquiler de canchas, torneos amateur",
            "is_certified": True, "instagram": "@tennisbocagrande",
        },
        {
            "partner_id": "ptr_wn_012", "subcategory": "sport",
            "name": "Cartagena Surf School",
            "description": "Escuela de surf y kitesurf en La Boquilla. Clases para principiantes y avanzados, alquiler de tablas.",
            "category": "wellness", "tier": "popular",
            "image_url": "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=800&h=600&fit=crop",
            "location": {"lat": 10.4582, "lng": -75.5028},
            "address": "La Boquilla, Cartagena",
            "booking_link": "https://cartagenasurf.com",
            "price_range": "$$",
            "experience": "Surf, kitesurf, paddle board, packs grupales",
            "is_certified": True, "instagram": "@cartagenasurf",
        },
    ]
    for partner in WELLNESS_PARTNERS:
        await db.partners.update_one(
            {"partner_id": partner["partner_id"]},
            {"$setOnInsert": partner},
            upsert=True,
        )
    # Always backfill subcategory on existing wellness partners (idempotent)
    for partner in WELLNESS_PARTNERS:
        await db.partners.update_one(
            {"partner_id": partner["partner_id"], "subcategory": {"$exists": False}},
            {"$set": {"subcategory": partner["subcategory"]}}
        )
    # ── Migration: Seed Yacht partners (idempotent) ──
    YACHT_PARTNERS = [
        {
            "partner_id": "ptr_yt_001",
            "name": "Boating Cartagena Premium",
            "description": "Yates y veleros de lujo para experiencias privadas en las Islas del Rosario y Barú. Tripulación profesional, chef a bordo.",
            "category": "yacht", "tier": "elite",
            "image_url": "https://images.unsplash.com/photo-1605281317010-fe5ffe798166?w=800&h=600&fit=crop",
            "location": {"lat": 10.4188, "lng": -75.5523},
            "address": "Muelle de la Bodeguita, Centro",
            "booking_link": "https://boatingcartagena.com",
            "price_range": "$$$$",
            "experience": "Yate privado, snorkel, almuerzo gourmet, open bar, DJ a bordo",
            "is_certified": True, "instagram": "boatingcartagena",
            "rating": 4.8, "reviews": 320,
        },
        {
            "partner_id": "ptr_yt_002",
            "name": "Sailing Cartagena",
            "description": "Veleros catamarán para grupos de hasta 20 personas. Sunset sailing, island hopping y fiestas privadas.",
            "category": "yacht", "tier": "premium",
            "image_url": "https://images.unsplash.com/photo-1500514966906-fe245eea9344?w=800&h=600&fit=crop",
            "location": {"lat": 10.4015, "lng": -75.5556},
            "address": "Marina de Manga, Cartagena",
            "booking_link": "https://sailingcartagena.co",
            "price_range": "$$$",
            "experience": "Catamarán, sunset sailing, island hopping, snorkel, open bar",
            "is_certified": True, "instagram": "sailingcartagena",
            "rating": 4.6, "reviews": 185,
        },
        {
            "partner_id": "ptr_yt_003",
            "name": "Caribbean Yacht Club",
            "description": "Club náutico exclusivo con flota de yates de lujo. Experiencias VIP, pesca deportiva y tours privados.",
            "category": "yacht", "tier": "elite",
            "image_url": "https://images.unsplash.com/photo-1567899378494-47b22a2ae96a?w=800&h=600&fit=crop",
            "location": {"lat": 10.4108, "lng": -75.5380},
            "address": "Marina de Manga, Cartagena",
            "booking_link": "https://caribbeanyachtclub.co",
            "price_range": "$$$$",
            "experience": "Yate VIP, pesca deportiva, chef privado, masaje a bordo",
            "is_certified": True, "instagram": "caribbeanyachtclub",
            "rating": 4.9, "reviews": 98,
        },
    ]
    for partner in YACHT_PARTNERS:
        await db.partners.update_one(
            {"partner_id": partner["partner_id"]},
            {"$setOnInsert": partner},
            upsert=True,
        )

    # ── Migration: Seed Activity partners (idempotent) ──
    ACTIVITY_PARTNERS = [
        {
            "partner_id": "ptr_ac_001",
            "name": "Cartagena Diving Center",
            "description": "Centro de buceo PADI 5 estrellas. Cursos, inmersiones y snorkel en los arrecifes de las Islas del Rosario.",
            "category": "activity", "tier": "premium",
            "image_url": "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&h=600&fit=crop",
            "location": {"lat": 10.4188, "lng": -75.5523},
            "address": "Muelle de la Bodeguita, Centro",
            "booking_link": "https://cartagenadivers.com",
            "price_range": "$$$",
            "experience": "Buceo PADI, snorkel, inmersión nocturna, bautizo submarino",
            "is_certified": True, "instagram": "cartagenadivers",
            "rating": 4.7, "reviews": 412,
        },
        {
            "partner_id": "ptr_ac_002",
            "name": "Cartagena Food Tours",
            "description": "Tours gastronómicos por el Centro Histórico y Getsemaní. Degustación de comida callejera, mercados y restaurantes locales.",
            "category": "activity", "tier": "popular",
            "image_url": "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&h=600&fit=crop",
            "location": {"lat": 10.4228, "lng": -75.5510},
            "address": "Plaza Santo Domingo, Centro Histórico",
            "booking_link": "https://cartagenafoodtours.com",
            "price_range": "$$",
            "experience": "Tour gastronómico, cocina callejera, mercado Bazurto, clase de cocina",
            "is_certified": True, "instagram": "cartagenafoodtours",
            "rating": 4.8, "reviews": 567,
        },
        {
            "partner_id": "ptr_ac_003",
            "name": "Walking Cartagena",
            "description": "Tours históricos a pie por la ciudad amurallada. Guías bilingües, historia colonial, leyendas y arquitectura.",
            "category": "activity", "tier": "popular",
            "image_url": "https://images.unsplash.com/photo-1583037189850-1921ae7c6c22?w=800&h=600&fit=crop",
            "location": {"lat": 10.4236, "lng": -75.5483},
            "address": "Torre del Reloj, Centro Histórico",
            "booking_link": "https://walkingcartagena.co",
            "price_range": "$",
            "experience": "Tour colonial, leyendas, foto tour, tour nocturno",
            "is_certified": True, "instagram": "walkingcartagena",
            "rating": 4.6, "reviews": 823,
        },
        {
            "partner_id": "ptr_ac_004",
            "name": "Aventura Rosario Islands",
            "description": "Kayak, paddleboard, jet ski y banana boat en las Islas del Rosario. Paquetes para familias y grupos.",
            "category": "activity", "tier": "premium",
            "image_url": "https://images.unsplash.com/photo-1530053969600-caed2596d242?w=800&h=600&fit=crop",
            "location": {"lat": 10.1780, "lng": -75.5800},
            "address": "Islas del Rosario",
            "booking_link": "https://aventurarosario.co",
            "price_range": "$$",
            "experience": "Kayak, paddle board, jet ski, banana boat, snorkel",
            "is_certified": True, "instagram": "aventurarosario",
            "rating": 4.5, "reviews": 290,
        },
    ]
    for partner in ACTIVITY_PARTNERS:
        await db.partners.update_one(
            {"partner_id": partner["partner_id"]},
            {"$setOnInsert": partner},
            upsert=True,
        )

    # Tag the original El Arsenal Wellness with subcategory
    await db.partners.update_one(
        {"partner_id": "ptr_006", "category": "wellness"},
        {"$set": {"subcategory": "spa"}}
    )

    # ── Cleanup: revert previous neighborhood-based restaurant experiment ──
    # (Delete the ptr_rs_* partners that were added when subcategories were
    # neighborhoods, and restore legacy cuisine subcategories on rows that
    # were temporarily remapped to a barrio.)
    await db.partners.delete_many({"partner_id": {"$regex": "^ptr_rs_"}})
    BARRIO_TO_CUISINE_REVERT = [
        ("ptr_001", "cafe"),               # Casa Bohème
        ("ptr_002", "mediterranean"),      # Bellini
        ("ptr_005", "gastronomic"),        # Café del Mar
    ]
    for pid, cuisine in BARRIO_TO_CUISINE_REVERT:
        await db.partners.update_one(
            {"partner_id": pid, "subcategory": {"$in": ["centro", "getsemani", "bocagrande", "castillogrande"]}},
            {"$set": {"subcategory": cuisine}},
        )
    # For any restaurant whose subcategory got remapped to a barrio,
    # restore it from the saved `cuisine` field (lowercased), or default to "gastronomic".
    CUISINE_LABEL_TO_KEY = {
        "cafe": "cafe", "italian": "italian", "asian": "asian",
        "colombian": "colombian", "seafood": "seafood", "mediterranean": "mediterranean",
        "arab": "international",  # Árabe ahora va dentro de Internacional
        "fastfood": "fastfood", "gastronomic": "gastronomic",
        "vegetarian": "vegetarian", "international": "international",
        "brunch": "brunch", "bakery": "bakery",
    }
    barrio_remapped = db.partners.find(
        {"category": "restaurant", "subcategory": {"$in": ["centro", "getsemani", "bocagrande", "castillogrande"]}}
    )
    async for p in barrio_remapped:
        cuisine = (p.get("cuisine") or "").strip().lower()
        new_sub = CUISINE_LABEL_TO_KEY.get(cuisine, "gastronomic")
        await db.partners.update_one(
            {"partner_id": p["partner_id"]},
            {"$set": {"subcategory": new_sub}},
        )

    # Merge legacy "arab" subcategory into "international"
    await db.partners.update_many(
        {"category": "restaurant", "subcategory": "arab"},
        {"$set": {"subcategory": "international"}},
    )

    # ── Curated restaurant catalog (Feb 2026 user-provided list) ──
    # Delete all previous restaurant filler partners except those still
    # referenced by partner_events (Carmen, El Beso, Nia Bakery, Salon Tropical
    # have events scheduled) AND those imported from the official xlsx base.
    PROTECTED_RESTAURANT_IDS = {"ptr_nc_001", "ptr_nc_002", "ptr_nc_003", "ptr_nc_004"}
    await db.partners.delete_many({
        "category": "restaurant",
        "partner_id": {"$nin": list(PROTECTED_RESTAURANT_IDS)},
        # Preserve partners that came from external sources (e.g. official xlsx)
        "$or": [
            {"source": {"$exists": False}},
            {"source": None},
            {"source": ""},
        ],
    })
    try:
        from restaurants_seed import RESTAURANTS as _RESTAURANTS_CATALOG
    except Exception as _e:
        logger.warning(f"restaurants_seed import failed: {_e}")
        _RESTAURANTS_CATALOG = []
    for r in _RESTAURANTS_CATALOG:
        await db.partners.update_one(
            {"partner_id": r["partner_id"]},
            {"$set": r},
            upsert=True,
        )
    # ── Venues seed (bars, cafes, clubs, spas, activities) ──
    try:
        from venues_seed import VENUES as _VENUES_CATALOG
    except Exception as _ve:
        logger.warning(f"venues_seed import failed: {_ve}")
        _VENUES_CATALOG = []
    for v in _VENUES_CATALOG:
        await db.partners.update_one(
            {"partner_id": v["partner_id"]},
            {"$set": v},
            upsert=True,
        )
    # ── Venues seed v2 (comprehensive web-researched additions) ──
    try:
        from venues_seed_v2 import VENUES_V2 as _VENUES_V2
    except Exception as _v2e:
        logger.warning(f"venues_seed_v2 import failed: {_v2e}")
        _VENUES_V2 = []
    for v2 in _VENUES_V2:
        await db.partners.update_one(
            {"partner_id": v2["partner_id"]},
            {"$set": v2},
            upsert=True,
        )
    # Re-classify the 4 protected legacy IDs so they appear under the right barrio/cuisine
    LEGACY_NC_OVERRIDES = {
        "ptr_nc_001": {  # Carmen
            "subcategory": "gastronomic",
            "rating": 4.7, "reviews": 1850,
            "cuisine": "Cocina de autor",
            "instagram": "carmencartagena",
            "booking_link": "https://carmen.com.co",
        },
        "ptr_nc_002": {  # El Beso (mantén como international/popular)
            "subcategory": "international",
            "rating": 4.3, "reviews": 240,
            "cuisine": "Tapas · Internacional",
            "instagram": "elbesocartagena",
        },
        "ptr_nc_003": {  # Nia Bakery
            "subcategory": "cafe",
            "rating": 4.6, "reviews": 720,
            "cuisine": "Panadería · Pastelería",
            "instagram": "niabakery",
            "booking_link": "https://niabakery.co",
        },
        "ptr_nc_004": {  # Salon Tropical (no es restaurante puro, sino lounge)
            "subcategory": "international",
            "rating": 4.2, "reviews": 180,
            "cuisine": "Salsa · Cocktails",
            "instagram": "salontropicalcartagena",
        },
    }
    for pid, payload in LEGACY_NC_OVERRIDES.items():
        await db.partners.update_one(
            {"partner_id": pid},
            {"$set": payload},
        )

    # ── Migration: Ensure Taxi Boat exists as trn_003 (replaces legacy night_transport) ──
    await db.transport.delete_many({"type": "night_transport"})
    # ── Migration: Remove airport shuttle (trn_004) per product decision ──
    await db.transport.delete_many({"transport_id": "trn_004"})
    await db.transport.delete_many({"type": "shuttle"})
    TAXI_BOAT_ROUTE = {
        "transport_id": "trn_003",
        "type": "boat",
        "partner": "Taxi Boat Cartagena",
        "route_name": "Taxi Boat — Muelle Bodeguita / Manga / Bocagrande",
        "description": "Servicio de taxi boat regular conectando Muelle de la Bodeguita, Manga y Bocagrande. Ideal para evitar el tráfico y disfrutar la bahía.",
        "schedule": [
            {"time": "07:00", "destination": "Bodeguita → Manga → Bocagrande", "note": "Primer servicio"},
            {"time": "Cada 30 min", "destination": "Loop continuo", "note": "Frecuencia diurna"},
            {"time": "22:00", "destination": "Último servicio", "note": "Cierre del día"},
        ],
        "price": "15,000 COP por trayecto / 25,000 COP ida y vuelta",
        "duration": "10–15 min entre paradas",
        "departure_location": {"lat": 10.4188, "lng": -75.5523},  # Muelle Bodeguita
        "stops": [
            {"name": "Muelle Bodeguita", "lat": 10.4188, "lng": -75.5523, "zone": "Centro"},
            {"name": "Manga (Muelle Pegaso)", "lat": 10.4108, "lng": -75.5380, "zone": "Manga"},
            {"name": "Bocagrande (Muelle La Bodeguita BG)", "lat": 10.4019, "lng": -75.5550, "zone": "Bocagrande"},
        ],
        "phone": "+57 300 000 0000",
        "instructions": "Aborde en cualquiera de las 3 paradas. Pague online y muestre el QR al capitán para evitar fila en el muelle.",
    }
    await db.transport.update_one(
        {"transport_id": "trn_003"},
        {"$set": TAXI_BOAT_ROUTE},
        upsert=True,
    )

    # ── Migration: Hotel sub-categories (Popular / Premium / Lujo) ──
    # Map existing hotel partners by tier
    TIER_TO_HOTEL_SUBCAT = {"popular": "popular", "premium": "premium", "elite": "lujo"}
    async for h in db.partners.find({"category": "hotel"}, {"_id": 0}):
        if not h.get("subcategory"):
            sub = TIER_TO_HOTEL_SUBCAT.get(h.get("tier"), "popular")
            await db.partners.update_one(
                {"partner_id": h["partner_id"]},
                {"$set": {"subcategory": sub}},
            )

    # Add 1-2 demo hotels per subcategory if missing, so each has good content
    HOTEL_DEMO = [
        # POPULAR
        {
            "partner_id": "ptr_ho_001", "subcategory": "popular",
            "name": "Hotel Casa del Reloj",
            "description": "Hotel boutique acogedor en pleno Centro Histórico. Habitaciones cómodas, terraza con vista a las murallas y desayuno incluido.",
            "category": "hotel", "tier": "popular",
            "image_url": "https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800&h=600&fit=crop",
            "location": {"lat": 10.4232, "lng": -75.5510},
            "address": "Calle del Cuartel, Centro Histórico",
            "booking_link": "https://hotelcasareloj.com",
            "price_range": "$$",
            "experience": "Boutique acogedor, terraza con vista, desayuno típico",
            "is_certified": True, "instagram": "@hotelcasareloj",
        },
        {
            "partner_id": "ptr_ho_002", "subcategory": "popular",
            "name": "Casa Getsemaní Hostal",
            "description": "Hostal con encanto en Getsemaní. Patio interior, habitaciones limpias y a 2 cuadras de la zona de la rumba.",
            "category": "hotel", "tier": "popular",
            "image_url": "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=800&h=600&fit=crop",
            "location": {"lat": 10.4198, "lng": -75.5468},
            "address": "Calle de la Sierpe, Getsemaní",
            "booking_link": "https://casagetsemani.co",
            "price_range": "$$",
            "experience": "Hostal con patio, ubicación en zona rumba, desayuno tropical",
            "is_certified": True, "instagram": "@casagetsemani",
        },
        # PREMIUM
        {
            "partner_id": "ptr_ho_003", "subcategory": "premium",
            "name": "Bastión Luxury Hotel",
            "description": "Hotel premium frente al Mar Caribe. Spa, piscina infinity y restaurante con cocina de autor.",
            "category": "hotel", "tier": "premium",
            "image_url": "https://images.unsplash.com/photo-1582719508461-905c673771fd?w=800&h=600&fit=crop",
            "location": {"lat": 10.4225, "lng": -75.5500},
            "address": "Calle del Sargento Mayor, Centro",
            "booking_link": "https://bastionhotel.com",
            "price_range": "$$$",
            "experience": "Spa de lujo, piscina infinity, cocina de autor",
            "is_certified": True, "instagram": "@bastionhotel",
        },
        # LUJO
        {
            "partner_id": "ptr_ho_004", "subcategory": "lujo",
            "name": "Sofitel Legend Santa Clara",
            "description": "Convento del siglo XVII convertido en hotel 5 estrellas. Patio histórico, spa So Spa y gastronomía Michelin.",
            "category": "hotel", "tier": "elite",
            "image_url": "https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=800&h=600&fit=crop",
            "location": {"lat": 10.4255, "lng": -75.5482},
            "address": "Calle del Torno, Centro",
            "booking_link": "https://sofitel-legend-santaclara.com",
            "price_range": "$$$$",
            "experience": "Hotel 5★ histórico, So Spa, restaurante 1621 con estrella Michelin",
            "is_certified": True, "instagram": "@sofitelsantaclara",
        },
        {
            "partner_id": "ptr_ho_005", "subcategory": "lujo",
            "name": "Casa San Agustín",
            "description": "Tres casonas coloniales del siglo XVII convertidas en hotel ultra-luxury. Biblioteca, piscina entre arcos y restaurante Alma.",
            "category": "hotel", "tier": "elite",
            "image_url": "https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=800&h=600&fit=crop",
            "location": {"lat": 10.4239, "lng": -75.5502},
            "address": "Calle de la Universidad, Centro",
            "booking_link": "https://hotelcasasanagustin.com",
            "price_range": "$$$$",
            "experience": "Casonas coloniales restauradas, restaurante Alma, biblioteca privada",
            "is_certified": True, "instagram": "@casasanagustin",
        },
    ]
    for h in HOTEL_DEMO:
        await db.partners.update_one(
            {"partner_id": h["partner_id"]},
            {"$set": h},
            upsert=True,
        )

    # ── Cleanup: remove orphan daypass/sunset partner seeds added by mistake ──
    await db.partners.delete_many({"category": {"$in": ["daypass", "sunset"]}})

    # ── Migration: Seed partner_events for "Pasa día" and "Sunset Experience" ──
    # These appear as event categories in Agenda + Qué pasa hoy
    today_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    DAY_SUNSET_EVENTS = [
        # PASA DÍA
        {
            "event_id": "pe_dp_001", "partner_id": "ptr_003",
            "title": "Day Pass — Blue Apple Beach",
            "description": "Pasa el día en la Isla del Encanto. Almuerzo gourmet, piscina infinita y traslado en lancha incluido.",
            "category": "daypass",
            "date": today_iso, "start_time": "09:00", "end_time": "17:00",
            "flyer_url": "https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=800&h=600&fit=crop",
            "venue": "Blue Apple Beach — Tierra Bomba",
            "is_free": False, "price": 320000, "currency": "COP",
            "booking_link": "https://blueapple.co/daypass",
            "status": "approved", "is_published": True,
        },
        {
            "event_id": "pe_dp_002", "partner_id": "ptr_008",
            "title": "Day Pass — Isla Barú Beach Club",
            "description": "Day pass all-inclusive en Playa Blanca. Almuerzo, snorkel, kayak y traslado.",
            "category": "daypass",
            "date": today_iso, "start_time": "08:30", "end_time": "16:00",
            "flyer_url": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&h=600&fit=crop",
            "venue": "Isla Barú Beach Club — Playa Blanca",
            "is_free": False, "price": 280000, "currency": "COP",
            "booking_link": "https://barubeach.com/daypass",
            "status": "approved", "is_published": True,
        },
        {
            "event_id": "pe_dp_003", "partner_id": "ptr_004",
            "title": "Pool Day Pass — Sofitel Santa Clara",
            "description": "Acceso por el día a la piscina del Sofitel Legend Santa Clara. Crédito de consumo incluido.",
            "category": "daypass",
            "date": today_iso, "start_time": "10:00", "end_time": "18:00",
            "flyer_url": "https://images.unsplash.com/photo-1540541338287-41700207dee6?w=800&h=600&fit=crop",
            "venue": "Sofitel Santa Clara — Centro Histórico",
            "is_free": False, "price": 220000, "currency": "COP",
            "booking_link": "https://sofitel-legend-santaclara.com/daypass",
            "status": "approved", "is_published": True,
        },
        {
            "event_id": "pe_dp_004", "partner_id": "ptr_nc_014",
            "title": "Yacht Day Tour — Islas del Rosario",
            "description": "Día completo en yate privado: snorkel, almuerzo a bordo y open bar.",
            "category": "daypass",
            "date": today_iso, "start_time": "09:00", "end_time": "17:00",
            "flyer_url": "https://images.unsplash.com/photo-1605281317010-fe5ffe798166?w=800&h=600&fit=crop",
            "venue": "Salida Muelle La Bodeguita",
            "is_free": False, "price": 750000, "currency": "COP",
            "booking_link": "https://boatingcartagena.com/yacht",
            "status": "approved", "is_published": True,
        },
        # SUNSET EXPERIENCE
        {
            "event_id": "pe_ss_001", "partner_id": "ptr_007",
            "title": "Sunset Sessions — Movich Rooftop",
            "description": "Sunset 360° sobre las murallas. Cócteles de autor y DJ chill desde las 17:30.",
            "category": "sunset",
            "date": today_iso, "start_time": "17:30", "end_time": "21:00",
            "flyer_url": "https://images.unsplash.com/photo-1519214605650-76a613ee3245?w=800&h=600&fit=crop",
            "venue": "Movich Rooftop — Centro",
            "is_free": False, "price": 60000, "currency": "COP",
            "booking_link": "https://movichhotels.com/sunset",
            "status": "approved", "is_published": True,
        },
        {
            "event_id": "pe_ss_002", "partner_id": "ptr_001",
            "title": "Sunset on the Walls — Café del Mar",
            "description": "El atardecer más icónico de Cartagena, sobre las murallas frente al Caribe.",
            "category": "sunset",
            "date": today_iso, "start_time": "17:00", "end_time": "20:00",
            "flyer_url": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&h=600&fit=crop",
            "venue": "Café del Mar — Las Murallas",
            "is_free": False, "price": 50000, "currency": "COP",
            "booking_link": "https://cafedelmarcartagena.com",
            "status": "approved", "is_published": True,
        },
        {
            "event_id": "pe_ss_003", "partner_id": "ptr_nc_014",
            "title": "Sunset Sailing — Velero Privado",
            "description": "Salida en velero por la bahía al atardecer. Champagne y skyline iluminado.",
            "category": "sunset",
            "date": today_iso, "start_time": "16:30", "end_time": "19:30",
            "flyer_url": "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=800&h=600&fit=crop",
            "venue": "Salida Muelle La Bodeguita",
            "is_free": False, "price": 380000, "currency": "COP",
            "booking_link": "https://sunsetsailing.co",
            "status": "approved", "is_published": True,
        },
    ]
    for ev in DAY_SUNSET_EVENTS:
        ev["created_at"] = datetime.now(timezone.utc).isoformat()
        ev.setdefault("views", 0)
        ev.setdefault("reserve_clicks", 0)
        ev.setdefault("is_active", True)
        await db.partner_events.update_one(
            {"event_id": ev["event_id"]},
            {"$set": ev},
            upsert=True,
        )

    # ── Migration: Seed Yacht & Activity experience events (idempotent) ──
    today_yacht = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    YACHT_ACTIVITY_EVENTS = [
        # YACHT experiences
        {
            "event_id": "pe_yt_001", "partner_id": "ptr_yt_001",
            "title": "Yacht Day — Islas del Rosario VIP",
            "description": "Día completo en yate de lujo: snorkel en arrecifes, almuerzo gourmet a bordo, open bar premium y DJ. Hasta 12 personas.",
            "category": "yacht",
            "date": today_yacht, "start_time": "09:00", "end_time": "17:00",
            "flyer_url": "https://images.unsplash.com/photo-1605281317010-fe5ffe798166?w=800&h=600&fit=crop",
            "venue": "Salida Muelle La Bodeguita",
            "is_free": False, "price": 850000, "price_cop": 850000, "currency": "COP",
            "booking_link": "https://boatingcartagena.com/vip",
            "status": "approved", "is_published": True, "is_active": True,
        },
        {
            "event_id": "pe_yt_002", "partner_id": "ptr_yt_002",
            "title": "Sunset Sailing — Bahía de Cartagena",
            "description": "Velero catamarán al atardecer por la bahía. Champagne, tabla de quesos y skyline iluminado de Cartagena.",
            "category": "yacht",
            "date": today_yacht, "start_time": "16:30", "end_time": "19:30",
            "flyer_url": "https://images.unsplash.com/photo-1500514966906-fe245eea9344?w=800&h=600&fit=crop",
            "venue": "Marina de Manga",
            "is_free": False, "price": 420000, "price_cop": 420000, "currency": "COP",
            "booking_link": "https://sailingcartagena.co/sunset",
            "status": "approved", "is_published": True, "is_active": True,
        },
        {
            "event_id": "pe_yt_003", "partner_id": "ptr_yt_003",
            "title": "Pesca Deportiva — Mar Caribe",
            "description": "Salida de pesca deportiva en yate equipado. Capitán experto, cañas profesionales, almuerzo incluido. Captura y libera.",
            "category": "yacht",
            "date": today_yacht, "start_time": "06:00", "end_time": "14:00",
            "flyer_url": "https://images.unsplash.com/photo-1567899378494-47b22a2ae96a?w=800&h=600&fit=crop",
            "venue": "Marina de Manga",
            "is_free": False, "price": 1200000, "price_cop": 1200000, "currency": "COP",
            "booking_link": "https://caribbeanyachtclub.co/fishing",
            "status": "approved", "is_published": True, "is_active": True,
        },
        # ACTIVITY experiences
        {
            "event_id": "pe_ac_001", "partner_id": "ptr_ac_001",
            "title": "Bautizo de Buceo — Islas del Rosario",
            "description": "Primera inmersión con instructor PADI. Incluye equipo, lancha y snack. Sin experiencia previa necesaria.",
            "category": "activity",
            "date": today_yacht, "start_time": "08:00", "end_time": "13:00",
            "flyer_url": "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&h=600&fit=crop",
            "venue": "Islas del Rosario",
            "is_free": False, "price": 280000, "price_cop": 280000, "currency": "COP",
            "booking_link": "https://cartagenadivers.com/bautizo",
            "status": "approved", "is_published": True, "is_active": True,
        },
        {
            "event_id": "pe_ac_002", "partner_id": "ptr_ac_002",
            "title": "Food Tour Getsemaní",
            "description": "Recorrido gastronómico de 3 horas por Getsemaní: comida callejera, mercados locales y cocina tradicional. 8 paradas de degustación.",
            "category": "activity",
            "date": today_yacht, "start_time": "10:00", "end_time": "13:00",
            "flyer_url": "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&h=600&fit=crop",
            "venue": "Getsemaní, Centro Histórico",
            "is_free": False, "price": 150000, "price_cop": 150000, "currency": "COP",
            "booking_link": "https://cartagenafoodtours.com/getsemani",
            "status": "approved", "is_published": True, "is_active": True,
        },
        {
            "event_id": "pe_ac_003", "partner_id": "ptr_ac_003",
            "title": "Tour Histórico — Ciudad Amurallada",
            "description": "Recorrido de 2.5 horas por la ciudad colonial. Murallas, palacios, iglesias, leyendas de piratas. Guía bilingüe.",
            "category": "activity",
            "date": today_yacht, "start_time": "09:00", "end_time": "11:30",
            "flyer_url": "https://images.unsplash.com/photo-1583037189850-1921ae7c6c22?w=800&h=600&fit=crop",
            "venue": "Torre del Reloj, Centro",
            "is_free": False, "price": 80000, "price_cop": 80000, "currency": "COP",
            "booking_link": "https://walkingcartagena.co/colonial",
            "status": "approved", "is_published": True, "is_active": True,
        },
        {
            "event_id": "pe_ac_004", "partner_id": "ptr_ac_004",
            "title": "Kayak & Paddle Board — Islas del Rosario",
            "description": "Medio día de deportes acuáticos: kayak, paddle board y snorkel en aguas cristalinas. Incluye transporte en lancha.",
            "category": "activity",
            "date": today_yacht, "start_time": "08:30", "end_time": "13:00",
            "flyer_url": "https://images.unsplash.com/photo-1530053969600-caed2596d242?w=800&h=600&fit=crop",
            "venue": "Islas del Rosario",
            "is_free": False, "price": 180000, "price_cop": 180000, "currency": "COP",
            "booking_link": "https://aventurarosario.co/watersports",
            "status": "approved", "is_published": True, "is_active": True,
        },
    ]
    for ev in YACHT_ACTIVITY_EVENTS:
        ev["created_at"] = datetime.now(timezone.utc).isoformat()
        ev.setdefault("views", 0)
        ev.setdefault("reserve_clicks", 0)
        await db.partner_events.update_one(
            {"event_id": ev["event_id"]},
            {"$set": ev},
            upsert=True,
        )

    # ── Migration: Seed Cafés (subcategory of Restaurantes) ──
    CAFE_PARTNERS = [
        {
            "partner_id": "ptr_cf_001", "subcategory": "cafe",
            "name": "Niabakery & Café",
            "description": "Café de especialidad y panadería francesa. Croissants, pain au chocolat y espresso de origen colombiano.",
            "category": "restaurant", "tier": "popular",
            "image_url": "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800&h=600&fit=crop",
            "location": {"lat": 10.4218, "lng": -75.5505},
            "address": "Calle del Arzobispado, Centro",
            "booking_link": "https://niabakery.co",
            "price_range": "$$",
            "experience": "Brunch francés, café de especialidad, panadería artesanal",
            "is_certified": True, "instagram": "@niabakery",
        },
        {
            "partner_id": "ptr_cf_002", "subcategory": "cafe",
            "name": "Abacus Coffee Lab",
            "description": "Coffee lab con baristas campeones nacionales. Métodos V60, Chemex, AeroPress y cold brew de la casa.",
            "category": "restaurant", "tier": "premium",
            "image_url": "https://images.unsplash.com/photo-1453614512568-c4024d13c247?w=800&h=600&fit=crop",
            "location": {"lat": 10.4256, "lng": -75.5478},
            "address": "Calle del Pozo, Getsemaní",
            "booking_link": "https://abacuscoffee.co",
            "price_range": "$$",
            "experience": "Catación de café, V60, AeroPress, postres de autor",
            "is_certified": True, "instagram": "@abacuscoffee",
        },
        {
            "partner_id": "ptr_cf_003", "subcategory": "cafe",
            "name": "Café del Pueblo",
            "description": "Café local en plaza colonial. Tinto típico, jugos naturales, arepas con huevo y desayunos costeños.",
            "category": "restaurant", "tier": "popular",
            "image_url": "https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=800&h=600&fit=crop",
            "location": {"lat": 10.4202, "lng": -75.5538},
            "address": "Plaza San Diego, Centro",
            "booking_link": "https://cafedelpueblo.co",
            "price_range": "$",
            "experience": "Desayuno costeño, arepa de huevo, café tinto, jugo de corozo",
            "is_certified": True, "instagram": "@cafedelpueblo",
        },
        {
            "partner_id": "ptr_cf_004", "subcategory": "cafe",
            "name": "Café San Alberto",
            "description": "Café boutique en la muralla. Granos colombianos premium, ambiente moderno con vista al mar.",
            "category": "restaurant", "tier": "premium",
            "image_url": "https://images.unsplash.com/photo-1559496417-e7f25cb247f3?w=800&h=600&fit=crop",
            "location": {"lat": 10.4248, "lng": -75.5520},
            "address": "Plaza Santo Domingo, Centro",
            "booking_link": "https://cafesanalberto.com",
            "price_range": "$$",
            "experience": "Café de origen, latte art, postres con cacao",
            "is_certified": True, "instagram": "@cafesanalberto",
        },
        {
            "partner_id": "ptr_cf_005", "subcategory": "brunch",
            "name": "Mila Pastelería",
            "description": "Pastelería boutique francesa para brunch dominical. Tartas, eclairs y degustación de chocolate.",
            "category": "restaurant", "tier": "premium",
            "image_url": "https://images.unsplash.com/photo-1486427944299-d1955d23e34d?w=800&h=600&fit=crop",
            "location": {"lat": 10.4240, "lng": -75.5513},
            "address": "Calle de la Iglesia, Centro",
            "booking_link": "https://milapasteleria.com",
            "price_range": "$$$",
            "experience": "Brunch francés, pastelería autoral, té de tarde",
            "is_certified": True, "instagram": "@milapasteleria",
        },
    ]
    for partner in CAFE_PARTNERS:
        await db.partners.update_one(
            {"partner_id": partner["partner_id"]},
            {"$setOnInsert": partner},
            upsert=True,
        )
    # Backfill 'restaurant' subcategory on existing restaurant partners that lack it
    await db.partners.update_many(
        {"category": "restaurant", "subcategory": {"$exists": False}},
        {"$set": {"subcategory": "international"}}
    )
    # Migrate old subcategory keys to new picker keys
    await db.partners.update_many({"category": "restaurant", "subcategory": "restaurant"}, {"$set": {"subcategory": "international"}})
    await db.partners.update_many({"category": "restaurant", "subcategory": "brunch"}, {"$set": {"subcategory": "cafe"}})
    await db.partners.update_many({"category": "restaurant", "subcategory": "bakery"}, {"$set": {"subcategory": "cafe"}})

    # Manual reassignments of known restaurants to proper cuisines
    CUISINE_REMAP = {
        "ptr_001": "mediterranean",   # Casa Bohème → mediterránea
        "ptr_002": "gastronomic",     # Bellini (italiano de autor) — gastronómico
        "ptr_004": "international",   # El Beso → internacional
        "ptr_007": "international",   # Movich Hotel (resto)
        "ptr_nc_007": "mediterranean",  # Casa Bohème NC
    }
    for pid, sub in CUISINE_REMAP.items():
        await db.partners.update_one({"partner_id": pid, "category": "restaurant"}, {"$set": {"subcategory": sub}})

    # ── Seed: Cuisine partners (idempotent) — at least 1 per subcategory ──
    CUISINE_PARTNERS = [
        # ITALIANO
        {"partner_id":"ptr_cu_001","subcategory":"italian","name":"Trattoria del Mare","description":"Auténtica trattoria italiana con pasta fresca hecha a mano y horno de leña.","category":"restaurant","tier":"premium","image_url":"https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=800&h=600&fit=crop","location":{"lat":10.4218,"lng":-75.5512},"address":"Calle de la Iglesia, Centro","booking_link":"https://trattoriadelmare.co","price_range":"$$$","experience":"Pasta fresca, pizza al horno de leña, vinos italianos","is_certified":True,"instagram":"@trattoriadelmare"},
        # ASIATICO
        {"partner_id":"ptr_cu_002","subcategory":"asian","name":"Nikkei Cartagena","description":"Cocina nikkei: fusión peruano-japonesa. Sushi de autor, ceviches, tiraditos.","category":"restaurant","tier":"elite","image_url":"https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=800&h=600&fit=crop","location":{"lat":10.4189,"lng":-75.5491},"address":"Centro Histórico","booking_link":"https://nikkei.co","price_range":"$$$","experience":"Sushi omakase, tiraditos, sake premium","is_certified":True,"instagram":"@nikkeicartagena"},
        # COLOMBIANO
        {"partner_id":"ptr_cu_003","subcategory":"colombian","name":"La Cevichería","description":"Restaurante icónico de cocina caribeña-colombiana. Ceviches, pescado frito, arroz con coco.","category":"restaurant","tier":"popular","image_url":"https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=800&h=600&fit=crop","location":{"lat":10.4231,"lng":-75.5510},"address":"Calle Stuart, Centro","booking_link":"https://lacevicheria.co","price_range":"$$","experience":"Ceviche cartagenero, pescado frito, patacones","is_certified":True,"instagram":"@lacevicheria"},
        {"partner_id":"ptr_cu_004","subcategory":"colombian","name":"Restaurante Donde Olano","description":"Cocina tradicional caribeña en casa colonial. Arroz con coco, mojarra, sancocho.","category":"restaurant","tier":"popular","image_url":"https://images.unsplash.com/photo-1565299507177-b0ac66763828?w=800&h=600&fit=crop","location":{"lat":10.4221,"lng":-75.5530},"address":"Calle Santo Domingo","booking_link":"https://dondeolano.co","price_range":"$$","experience":"Cocina tradicional cartagenera","is_certified":True,"instagram":"@dondeolano"},
        # DEL MAR
        {"partner_id":"ptr_cu_005","subcategory":"seafood","name":"Marea by Rausch","description":"Mariscos y pescados frescos del Caribe colombiano. Cocina del chef Jorge Rausch.","category":"restaurant","tier":"elite","image_url":"https://images.unsplash.com/photo-1559737558-2f5a35f4523b?w=800&h=600&fit=crop","location":{"lat":10.4015,"lng":-75.5556},"address":"Bocagrande","booking_link":"https://marea.co","price_range":"$$$","experience":"Pescado del día, langosta, ostra fresca","is_certified":True,"instagram":"@marea"},
        # MEDITERRANEO extra
        {"partner_id":"ptr_cu_006","subcategory":"mediterranean","name":"Aluna","description":"Cocina mediterránea contemporánea con productos locales. Tapas, paella, vinos españoles.","category":"restaurant","tier":"premium","image_url":"https://images.unsplash.com/photo-1544025162-d76694265947?w=800&h=600&fit=crop","location":{"lat":10.4205,"lng":-75.5519},"address":"Calle del Coliseo","booking_link":"https://aluna.co","price_range":"$$$","experience":"Tapas, paella valenciana, vinos","is_certified":True,"instagram":"@alunarestaurante"},
        # ARABE
        {"partner_id":"ptr_cu_007","subcategory":"arab","name":"Layla Cocina Árabe","description":"Cocina árabe-libanesa auténtica: hummus, kibbe, shawarma, tajine y postres tradicionales.","category":"restaurant","tier":"popular","image_url":"https://images.unsplash.com/photo-1541518763669-27fef04b14ea?w=800&h=600&fit=crop","location":{"lat":10.4198,"lng":-75.5508},"address":"Centro Histórico","booking_link":"https://layla.co","price_range":"$$","experience":"Hummus, kibbe, shawarma, tajine de cordero","is_certified":True,"instagram":"@laylaarabe"},
        # FAST FOOD
        {"partner_id":"ptr_cu_008","subcategory":"fastfood","name":"Burger Cartagena","description":"Smash burgers de autor con carne 100% colombiana. Papas trufadas y milkshakes.","category":"restaurant","tier":"popular","image_url":"https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&h=600&fit=crop","location":{"lat":10.4186,"lng":-75.5495},"address":"Getsemaní","booking_link":"https://burgercartagena.co","price_range":"$$","experience":"Smash burger, papas trufadas, milkshakes","is_certified":True,"instagram":"@burgercartagena"},
        {"partner_id":"ptr_cu_009","subcategory":"fastfood","name":"Tropical Tacos","description":"Tacos al pastor, quesadillas y nachos con un toque caribeño. Cocteles de tequila.","category":"restaurant","tier":"popular","image_url":"https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=800&h=600&fit=crop","location":{"lat":10.4234,"lng":-75.5478},"address":"Plaza Trinidad, Getsemaní","booking_link":"https://tropicaltacos.co","price_range":"$","experience":"Tacos al pastor, quesadillas, margaritas","is_certified":True,"instagram":"@tropicaltacos"},
        # GASTRONOMICOS
        {"partner_id":"ptr_cu_010","subcategory":"gastronomic","name":"Carmen","description":"Restaurante de alta cocina con menú degustación. Concepto: 'Coastal Caribbean Fine Dining'.","category":"restaurant","tier":"elite","image_url":"https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&h=600&fit=crop","location":{"lat":10.4239,"lng":-75.5489},"address":"Plaza San Pedro","booking_link":"https://carmencartagena.com","price_range":"$$$","experience":"Menú degustación 7 tiempos, maridaje","is_certified":True,"instagram":"@carmencartagena"},
        # VEGETARIANO
        {"partner_id":"ptr_cu_011","subcategory":"vegetarian","name":"Verde Cartagena","description":"Cocina 100% vegetariana y vegana. Bowls, smoothies, hamburguesas plant-based, postres crudos.","category":"restaurant","tier":"popular","image_url":"https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&h=600&fit=crop","location":{"lat":10.4256,"lng":-75.5485},"address":"Getsemaní","booking_link":"https://verdecartagena.co","price_range":"$$","experience":"Bowls, hamburguesas vegetales, raw cakes","is_certified":True,"instagram":"@verdecartagena"},
        # INTERNACIONAL extra
        {"partner_id":"ptr_cu_012","subcategory":"international","name":"Bistró 1621","description":"Bistró europeo en hotel boutique 1621. Cocina internacional con influencias francesas.","category":"restaurant","tier":"premium","image_url":"https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&h=600&fit=crop","location":{"lat":10.4230,"lng":-75.5525},"address":"Hotel Sofitel Legend Santa Clara","booking_link":"https://hotel1621.co","price_range":"$$$","experience":"Cocina internacional, cava, terraza colonial","is_certified":True,"instagram":"@bistro1621"},
    ]
    for partner in CUISINE_PARTNERS:
        await db.partners.update_one(
            {"partner_id": partner["partner_id"]},
            {"$setOnInsert": partner},
            upsert=True,
        )

    # ── Seed: Partner Promotions (ofertas del día) ──
    promo_count = await db.partner_promotions.count_documents({})
    if promo_count == 0:
        logger.info("Seeding partner promotions...")
        today = datetime.now(timezone.utc).date()
        def d(offset: int) -> str:
            return (today + timedelta(days=offset)).strftime("%Y-%m-%d")

        IMG_COCKTAIL = "https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=800&h=800&fit=crop"
        IMG_PIZZA = "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&h=800&fit=crop"
        IMG_SPA = "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=800&h=800&fit=crop"
        IMG_ROOFTOP = "https://images.unsplash.com/photo-1529417305485-480f579e7578?w=800&h=800&fit=crop"
        IMG_BEACH_DAY = "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&h=800&fit=crop"
        IMG_FASHION = "https://images.unsplash.com/photo-1483985988355-763728e1935b?w=800&h=800&fit=crop"
        IMG_DINNER2 = "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800&h=800&fit=crop"
        IMG_COFFEE = "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800&h=800&fit=crop"

        promotions_seed = [
            {
                "promo_id": "promo_001", "partner_id": "ptr_nc_007",
                "title": "2x1 en cocteles signature",
                "description": "Disfruta dos cocteles por el precio de uno todos los días entre 17:00 y 19:00. Válido en barra y mesas.",
                "category": "gastronomy",
                "discount_pct": 50, "original_price": 60000, "promo_price": 30000,
                "valid_until": d(7), "image_url": IMG_COCKTAIL,
                "tag_label": "Happy Hour",
            },
            {
                "promo_id": "promo_002", "partner_id": "ptr_005",
                "title": "Pizza + cerveza por $45K",
                "description": "Combo pizza personal + cerveza artesanal local. Solo hoy en Café del Mar.",
                "category": "gastronomy",
                "discount_pct": 30, "original_price": 65000, "promo_price": 45000,
                "valid_until": d(0), "image_url": IMG_PIZZA,
                "tag_label": "Combo del día",
            },
            {
                "promo_id": "promo_003", "partner_id": "ptr_006",
                "title": "Masaje 60 min + acceso al spa",
                "description": "Masaje relajante de aromaterapia + uso de sauna y piscina termal. Reserva con 24h de anticipación.",
                "category": "wellness",
                "discount_pct": 25, "original_price": 280000, "promo_price": 210000,
                "valid_until": d(5), "image_url": IMG_SPA,
                "tag_label": "Wellness Pack",
            },
            {
                "promo_id": "promo_004", "partner_id": "ptr_007",
                "title": "Día de piscina rooftop incluido",
                "description": "Acceso a la piscina rooftop con cóctel de bienvenida si reservas almuerzo. Mejor vista de la ciudad amurallada.",
                "category": "party",
                "discount_pct": 0, "original_price": 0, "promo_price": 0,
                "valid_until": d(3), "image_url": IMG_ROOFTOP,
                "tag_label": "Bonus rooftop",
            },
            {
                "promo_id": "promo_005", "partner_id": "ptr_nc_009",
                "title": "Beach Day pass 30% off",
                "description": "Pase de día con tumbona, almuerzo y bebida de bienvenida en Blue Apple. Reserva online.",
                "category": "party",
                "discount_pct": 30, "original_price": 220000, "promo_price": 154000,
                "valid_until": d(2), "image_url": IMG_BEACH_DAY,
                "tag_label": "-30%",
            },
            {
                "promo_id": "promo_006", "partner_id": "ptr_nc_011",
                "title": "Pop-up con descuentos diseñadores locales",
                "description": "Hasta 40% off en piezas seleccionadas de la nueva colección de 10 diseñadores colombianos.",
                "category": "popup",
                "discount_pct": 40, "original_price": 0, "promo_price": 0,
                "valid_until": d(4), "image_url": IMG_FASHION,
                "tag_label": "Hasta -40%",
            },
            {
                "promo_id": "promo_007", "partner_id": "ptr_002",
                "title": "Botella de vino gratis con menú degustación",
                "description": "Por cada menú degustación 5 tiempos para 2, regalamos una botella de vino italiano seleccionada por nuestro sommelier.",
                "category": "gastronomy",
                "discount_pct": 0, "original_price": 0, "promo_price": 0,
                "valid_until": d(6), "image_url": IMG_DINNER2,
                "tag_label": "Botella gratis",
            },
            {
                "promo_id": "promo_008", "partner_id": "ptr_nc_003",
                "title": "Café + croissant — $18K",
                "description": "Combo desayuno francés todas las mañanas hasta las 11. Espresso o filtrado + croissant artesanal.",
                "category": "gastronomy",
                "discount_pct": 25, "original_price": 24000, "promo_price": 18000,
                "valid_until": d(10), "image_url": IMG_COFFEE,
                "tag_label": "Brunch deal",
            },
        ]
        for promo in promotions_seed:
            promo["is_active"] = True
            promo["currency"] = "COP"
            promo["created_at"] = datetime.now(timezone.utc).isoformat()
            promo["click_count"] = 0
            promo["view_count"] = 0
        await db.partner_promotions.insert_many(promotions_seed)
        await db.partner_promotions.create_index("valid_until")
        await db.partner_promotions.create_index("partner_id")
        await db.partner_promotions.create_index("category")
        logger.info(f"Seeded {len(promotions_seed)} partner promotions!")

    # Always refresh `valid_until` of existing demo promos so they stay valid for testing
    today_iso = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if (await db.partner_promotions.find_one({"valid_until": {"$lt": today_iso}}, {"_id": 0})):
        future = (datetime.now(timezone.utc).date() + timedelta(days=10)).strftime("%Y-%m-%d")
        await db.partner_promotions.update_many(
            {"valid_until": {"$lt": today_iso}},
            {"$set": {"valid_until": future}}
        )

    # ── Seed: Business Accounts (cuentas de partners para el dashboard) ──
    biz_count = await db.business_users.count_documents({})
    if biz_count == 0:
        logger.info("Seeding business accounts...")
        DEMO_PASSWORD = os.environ.get("DEMO_PARTNER_PASSWORD")
        if not DEMO_PASSWORD:
            logger.warning("DEMO_PARTNER_PASSWORD not set — skipping business account seeding")
        else:
            pw_hash = _bcrypt.hashpw(DEMO_PASSWORD.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")
            demo_accounts = [
                {"business_id": "biz_001", "email": "casaboheme@amocartagena.app", "password_hash": pw_hash, "partner_id": "ptr_nc_007", "full_name": "Casa Bohème", "role": "business", "created_at": datetime.now(timezone.utc).isoformat()},
                {"business_id": "biz_002", "email": "bellini@amocartagena.app", "password_hash": pw_hash, "partner_id": "ptr_002", "full_name": "Bellini", "role": "business", "created_at": datetime.now(timezone.utc).isoformat()},
                {"business_id": "biz_003", "email": "cafedelmar@amocartagena.app", "password_hash": pw_hash, "partner_id": "ptr_005", "full_name": "Café del Mar", "role": "business", "created_at": datetime.now(timezone.utc).isoformat()},
                {"business_id": "biz_004", "email": "blueapple@amocartagena.app", "password_hash": pw_hash, "partner_id": "ptr_nc_009", "full_name": "Blue Apple Beach", "role": "business", "created_at": datetime.now(timezone.utc).isoformat()},
                {"business_id": "biz_005", "email": "elarsenal@amocartagena.app", "password_hash": pw_hash, "partner_id": "ptr_006", "full_name": "El Arsenal Wellness", "role": "business", "created_at": datetime.now(timezone.utc).isoformat()},
            ]
            await db.business_users.insert_many(demo_accounts)
            await db.business_users.create_index("email", unique=True)
            logger.info(f"Seeded {len(demo_accounts)} business accounts!")

    # ── Seed: Alcaldía de Cartagena (Government / Admin Account) ──
    # Idempotent: ensures the Alcaldía partner + business user always exist.
    ALCALDIA_PARTNER_ID = "ptr_alcaldia"
    ALCALDIA_EMAIL = "alcaldia@amocartagena.app"
    ALCALDIA_PASSWORD = os.environ.get("ALCALDIA_PASSWORD")
    if not ALCALDIA_PASSWORD:
        logger.warning("ALCALDIA_PASSWORD not set — skipping Alcaldía account seeding")
        return
    alcaldia_partner = await db.partners.find_one({"partner_id": ALCALDIA_PARTNER_ID})
    if not alcaldia_partner:
        logger.info("Seeding Alcaldía partner profile...")
        await db.partners.insert_one({
            "partner_id": ALCALDIA_PARTNER_ID,
            "name": "Alcaldía de Cartagena",
            "description": "Cuenta oficial de la Alcaldía Mayor de Cartagena de Indias. Publicamos la agenda cultural oficial, anuncios, programas turísticos y noticias de la ciudad patrimonio.",
            "category": "institutional",
            "subcategory": "government",
            "tier": "institutional",
            "image_url": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Escudo_de_Cartagena_de_Indias.svg/400px-Escudo_de_Cartagena_de_Indias.svg.png",
            "location": {"lat": 10.4236, "lng": -75.5519},
            "address": "Plaza de la Aduana, Centro Histórico",
            "booking_link": "https://cartagena.gov.co",
            "instagram": "alcaldiacartagena",
            "price_range": "Gratis",
            "experience": "Agenda oficial de la ciudad, eventos culturales, anuncios institucionales.",
            "is_certified": True,
            "is_government": True,
        })
        logger.info("Alcaldía partner seeded!")
    alcaldia_biz = await db.business_users.find_one({"email": ALCALDIA_EMAIL})
    if not alcaldia_biz:
        pw_hash = _bcrypt.hashpw(ALCALDIA_PASSWORD.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")
        await db.business_users.insert_one({
            "business_id": "biz_alcaldia",
            "email": ALCALDIA_EMAIL,
            "password_hash": pw_hash,
            "partner_id": ALCALDIA_PARTNER_ID,
            "full_name": "Alcaldía de Cartagena",
            "role": "government",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        try:
            await db.business_users.create_index("email", unique=True)
        except Exception:
            pass
        logger.info("Alcaldía business account seeded!")
    # Seed emergency contacts if not yet seeded
    ec_count = await db.emergency_contacts.count_documents({})
    if ec_count == 0:
        emergency_contacts = [
            {"contact_id": "ec_001", "name": "Policía Nacional", "number": "123", "description": "Emergencias policiales", "description_en": "Police emergencies", "icon": "shield", "category": "emergency", "order": 1},
            {"contact_id": "ec_002", "name": "Bomberos", "number": "119", "description": "Incendios y rescates", "description_en": "Fire and rescue", "icon": "flame", "category": "emergency", "order": 2},
            {"contact_id": "ec_003", "name": "Ambulancia / CRUE", "number": "125", "description": "Emergencias médicas", "description_en": "Medical emergencies", "icon": "medkit", "category": "emergency", "order": 3},
            {"contact_id": "ec_004", "name": "Línea de la Vida", "number": "106", "description": "Crisis emocional 24/7", "description_en": "Emotional crisis hotline 24/7", "icon": "heart", "category": "emergency", "order": 4},
            {"contact_id": "ec_005", "name": "Policía de Turismo", "number": "+576054350000", "description": "Asistencia a turistas", "description_en": "Tourist assistance", "icon": "people", "category": "tourism", "order": 5},
            {"contact_id": "ec_006", "name": "Defensa Civil", "number": "144", "description": "Desastres naturales", "description_en": "Natural disasters", "icon": "alert-circle", "category": "emergency", "order": 6},
            {"contact_id": "ec_007", "name": "Tránsito Cartagena", "number": "+576046501818", "description": "Accidentes de tránsito", "description_en": "Traffic accidents", "icon": "car", "category": "services", "order": 7},
            {"contact_id": "ec_008", "name": "Hospital Universitario del Caribe", "number": "+576046698181", "description": "Hospital público principal", "description_en": "Main public hospital", "icon": "medical", "category": "medical", "order": 8},
            {"contact_id": "ec_009", "name": "Clínica Medihelp", "number": "+576046935999", "description": "Clínica privada 24h", "description_en": "Private clinic 24h", "icon": "medical", "category": "medical", "order": 9},
            {"contact_id": "ec_010", "name": "Consulado de EE.UU.", "number": "+576046648100", "description": "Emergencias ciudadanos estadounidenses", "description_en": "US citizen emergencies", "icon": "flag", "category": "consulate", "order": 10},
            {"contact_id": "ec_011", "name": "Migración Colombia", "number": "+576013810101", "description": "Temas migratorios", "description_en": "Immigration services", "icon": "document-text", "category": "services", "order": 11},
            {"contact_id": "ec_012", "name": "Amo Cartagena Soporte", "number": "+573176481183", "description": "Soporte de la app", "description_en": "App support via WhatsApp", "icon": "chatbubbles", "category": "app", "order": 12},
        ]
        await db.emergency_contacts.insert_many(emergency_contacts)
        logger.info(f"Seeded {len(emergency_contacts)} emergency contacts!")

    # Seed sponsors if not yet seeded
    sponsors_count = await db.sponsors.count_documents({})
    if sponsors_count == 0:
        sponsors = [
            {"sponsor_id": "sp_001", "name": "Avianca", "logo_url": "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b4/Avianca_Logo.svg/320px-Avianca_Logo.svg.png", "tagline": "Aerolínea oficial", "color": "#E31837", "url": "https://avianca.com", "tier": "gold", "is_active": True, "order": 1},
            {"sponsor_id": "sp_002", "name": "Aguila", "logo_url": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/Cerveza_%C3%81guila_logo.svg/320px-Cerveza_%C3%81guila_logo.svg.png", "tagline": "La cerveza de Colombia", "color": "#FFD700", "url": "https://cervezaaguila.com", "tier": "gold", "is_active": True, "order": 2},
            {"sponsor_id": "sp_003", "name": "Alcaldía de Cartagena", "logo_url": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Escudo_de_Cartagena_de_Indias.svg/200px-Escudo_de_Cartagena_de_Indias.svg.png", "tagline": "Ciudad patrimonio", "color": "#1B4F72", "url": "https://cartagena.gov.co", "tier": "institutional", "is_active": True, "order": 3},
            {"sponsor_id": "sp_004", "name": "Ron Cartagena", "logo_url": "", "tagline": "El sabor del Caribe", "color": "#8B4513", "url": "", "tier": "silver", "is_active": True, "order": 4},
            {"sponsor_id": "sp_005", "name": "Hotel Santa Clara", "logo_url": "", "tagline": "Lujo en la ciudad amurallada", "color": "#C9A96E", "url": "https://hotelsantaclara.com", "tier": "silver", "is_active": True, "order": 5},
            {"sponsor_id": "sp_006", "name": "Templo", "logo_url": "", "tagline": "La catedral de la música", "color": "#EC4899", "url": "https://templo.co", "tier": "silver", "is_active": True, "order": 6},
        ]
        await db.sponsors.insert_many(sponsors)
        logger.info(f"Seeded {len(sponsors)} sponsors!")

    # ── FINAL MIGRATION: Membership fields ──
    # MUST run at the very end of startup because earlier migration blocks delete &
    # re-insert restaurant partners (lines 3924-3940 area), which would wipe membership_*
    # fields if applied earlier. Idempotent: only writes to partners missing the fields.
    miss_status = await db.partners.update_many(
        {"membership_status": {"$exists": False}},
        {"$set": {
            "membership_status": "active",
            "membership_paid_until": None,
            "default_payment_link": "",
        }},
    )
    miss_tier_count = 0
    async for p in db.partners.find({"membership_tier": {"$exists": False}}, {"partner_id": 1, "tier": 1}):
        await db.partners.update_one(
            {"partner_id": p["partner_id"]},
            {"$set": {"membership_tier": p.get("tier") or "popular"}},
        )
        miss_tier_count += 1

    # ── Freemium plan migration ──
    # Every partner gets membership_plan='free' by default. Alcaldía promotes them to 'pro'
    # manually. Demo partners are pre-seeded as pro for testing the flow end-to-end.
    DEMO_PRO_PARTNERS = {"ptr_001", "ptr_002", "ptr_nc_007", "ptr_nc_009", "ptr_005"}  # Casa Bohème, Bellini, Casa Bohème (NC), Blue Apple, Café del Mar
    miss_plan = await db.partners.update_many(
        {"membership_plan": {"$exists": False}},
        {"$set": {"membership_plan": "free"}},
    )
    pro_upd = await db.partners.update_many(
        {"partner_id": {"$in": list(DEMO_PRO_PARTNERS)}},
        {"$set": {"membership_plan": "pro"}},
    )
    logger.info(f"Membership migration: {miss_status.modified_count} status, {miss_tier_count} tier, {miss_plan.modified_count} plan-defaulted, {pro_upd.modified_count} promoted to PRO")


async def seed_concerts():
    """Seed concerts with artists, genres, lineups for Music Week."""
    logger.info("Seeding concerts...")

    IMG_CONCERT = "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?w=800"
    IMG_DJ = "https://images.unsplash.com/photo-1571266028243-e4733b0f0bb0?w=800"
    IMG_NIGHT = "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800"
    IMG_JAZZ = "https://images.unsplash.com/photo-1415201364774-f6f0bb35f28f?w=800"
    IMG_SUNSET = "https://images.unsplash.com/photo-1651421479936-e24edc3e3143?w=800"
    IMG_BEACH = "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800"
    IMG_CLOSING = "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800"

    concerts = [
        {
            "concert_id": "con_001",
            "artist": "Solomun",
            "title": "Solomun Live",
            "genre": "Deep House / Melodic Techno",
            "description": "El legendario DJ bosnio-alemán trae su set signature a Cartagena. Una experiencia inmersiva de deep house bajo las estrellas.",
            "date": "2026-12-30",
            "start_time": "22:00",
            "end_time": "04:00",
            "venue_id": "ven_002",
            "venue_name": "Templo",
            "is_free": False,
            "price": 350000,
            "currency": "COP",
            "image_url": IMG_CONCERT,
            "ticket_link": "https://templo.co/solomun",
            "lineup": ["Solomun", "Local Support TBA"],
            "capacity": 2000,
            "tags": ["headliner", "electronic", "deep house"],
        },
        {
            "concert_id": "con_002",
            "artist": "Karol G",
            "title": "Karol G - Mañana Será Bonito Tour",
            "genre": "Reggaeton / Latin Pop",
            "description": "La Bichota llega a Cartagena con su gira más exitosa. Reggaeton, perreo y hits que mueven al mundo.",
            "date": "2027-01-02",
            "start_time": "21:00",
            "end_time": "01:00",
            "venue_id": "ven_002",
            "venue_name": "Templo",
            "is_free": False,
            "price": 450000,
            "currency": "COP",
            "image_url": IMG_NIGHT,
            "ticket_link": "https://templo.co/karolg",
            "lineup": ["Karol G", "DJ invitado sorpresa"],
            "capacity": 2500,
            "tags": ["headliner", "reggaeton", "latin"],
        },
        {
            "concert_id": "con_003",
            "artist": "Disclosure",
            "title": "Disclosure DJ Set",
            "genre": "UK Garage / House",
            "description": "El dúo británico de música electrónica presenta un set exclusivo de house y garage en el beach club más exclusivo.",
            "date": "2027-01-03",
            "start_time": "15:00",
            "end_time": "21:00",
            "venue_id": "ven_009",
            "venue_name": "Blue Apple Beach",
            "is_free": False,
            "price": 400000,
            "currency": "COP",
            "image_url": IMG_BEACH,
            "ticket_link": "https://blueapple.co/disclosure",
            "lineup": ["Disclosure", "Warm-up: DJ Local"],
            "capacity": 300,
            "tags": ["electronic", "house", "beach"],
        },
        {
            "concert_id": "con_004",
            "artist": "Celia Cruz Tribute Band",
            "title": "Noche de Salsa - Tributo a Celia",
            "genre": "Salsa / Son Cubano",
            "description": "Una noche mágica de salsa en vivo rindiendo homenaje a la reina. Orquesta en vivo de 12 músicos.",
            "date": "2026-12-31",
            "start_time": "20:00",
            "end_time": "02:00",
            "venue_id": "ven_003",
            "venue_name": "Casa Bohème",
            "is_free": False,
            "price": 180000,
            "currency": "COP",
            "image_url": IMG_JAZZ,
            "ticket_link": "https://casaboheme.co/salsa",
            "lineup": ["Orquesta Tributo Celia Cruz", "DJ Salsa"],
            "capacity": 150,
            "tags": ["salsa", "live band", "cultural"],
        },
        {
            "concert_id": "con_005",
            "artist": "Sunset Sounds",
            "title": "Sunset Sessions - Opening",
            "genre": "Chill / Downtempo",
            "description": "La sesión de apertura oficial de Music Week. DJs locales e internacionales con el atardecer de Cartagena de fondo.",
            "date": "2026-12-30",
            "start_time": "16:00",
            "end_time": "21:00",
            "venue_id": "ven_005",
            "venue_name": "Café del Mar",
            "is_free": True,
            "price": 0,
            "currency": "COP",
            "image_url": IMG_SUNSET,
            "ticket_link": "",
            "lineup": ["DJ Raíz", "Tropical Collective", "Sunset Sounds Residents"],
            "capacity": 500,
            "tags": ["free", "sunset", "chill", "opening"],
        },
        {
            "concert_id": "con_006",
            "artist": "Boris Brejcha",
            "title": "Boris Brejcha - High-Tech Minimal",
            "genre": "Minimal Techno",
            "description": "El hombre de la máscara presenta su minimal techno único. Producción visual inmersiva.",
            "date": "2027-01-04",
            "start_time": "23:00",
            "end_time": "06:00",
            "venue_id": "ven_002",
            "venue_name": "Templo",
            "is_free": False,
            "price": 320000,
            "currency": "COP",
            "image_url": IMG_DJ,
            "ticket_link": "https://templo.co/boris",
            "lineup": ["Boris Brejcha", "Ann Clue"],
            "capacity": 2000,
            "tags": ["techno", "minimal", "headliner"],
        },
        {
            "concert_id": "con_007",
            "artist": "Jazz Cartagena Ensemble",
            "title": "Jazz Under the Stars",
            "genre": "Jazz / Bossa Nova",
            "description": "Noche de jazz en vivo con músicos locales e internacionales. Maridaje con vinos premium incluido.",
            "date": "2027-01-01",
            "start_time": "20:00",
            "end_time": "00:00",
            "venue_id": "ven_004",
            "venue_name": "Bellini",
            "is_free": False,
            "price": 220000,
            "currency": "COP",
            "image_url": IMG_JAZZ,
            "ticket_link": "https://bellini.co/jazz",
            "lineup": ["Jazz Cartagena Ensemble", "Invitada: Voz Femenina"],
            "capacity": 80,
            "tags": ["jazz", "intimate", "wine"],
        },
        {
            "concert_id": "con_008",
            "artist": "Feid",
            "title": "Feid - Ferxxocalipsis",
            "genre": "Reggaeton / Trap Latino",
            "description": "Ferxxo llega a Cartagena con toda su energía. Reggaeton, trap y los hits que dominan las playlists.",
            "date": "2027-01-05",
            "start_time": "22:00",
            "end_time": "03:00",
            "venue_id": "ven_002",
            "venue_name": "Templo",
            "is_free": False,
            "price": 380000,
            "currency": "COP",
            "image_url": IMG_NIGHT,
            "ticket_link": "https://templo.co/feid",
            "lineup": ["Feid", "DJ invitado"],
            "capacity": 2500,
            "tags": ["reggaeton", "trap", "headliner"],
        },
        {
            "concert_id": "con_009",
            "artist": "Adriatique",
            "title": "Adriatique Sunset Set",
            "genre": "Melodic House / Progressive",
            "description": "El dúo suizo de melodic house en una sesión sunset exclusiva sobre las murallas.",
            "date": "2027-01-06",
            "start_time": "16:00",
            "end_time": "22:00",
            "venue_id": "ven_001",
            "venue_name": "La Muralla",
            "is_free": True,
            "price": 0,
            "currency": "COP",
            "image_url": IMG_SUNSET,
            "ticket_link": "",
            "lineup": ["Adriatique", "Warm-up local"],
            "capacity": 800,
            "tags": ["free", "sunset", "melodic house"],
        },
        {
            "concert_id": "con_010",
            "artist": "Beach Club All Stars",
            "title": "Beach Day Festival",
            "genre": "House / Afro House",
            "description": "Festival de día en la playa con los mejores DJs de la escena afro house y house tropical.",
            "date": "2027-01-07",
            "start_time": "11:00",
            "end_time": "19:00",
            "venue_id": "ven_008",
            "venue_name": "Isla Barú Beach Club",
            "is_free": False,
            "price": 280000,
            "currency": "COP",
            "image_url": IMG_BEACH,
            "ticket_link": "https://barubeach.com/festival",
            "lineup": ["Keinemusik", "Black Coffee", "Residents"],
            "capacity": 500,
            "tags": ["beach", "afro house", "day party"],
        },
        {
            "concert_id": "con_011",
            "artist": "Cumbia Digital Collective",
            "title": "Cumbia Electrónica",
            "genre": "Cumbia / Electrónica Tropical",
            "description": "Fusión de cumbia tradicional con beats electrónicos. La nueva ola del sonido colombiano.",
            "date": "2027-01-08",
            "start_time": "19:00",
            "end_time": "01:00",
            "venue_id": "ven_010",
            "venue_name": "Fénix",
            "is_free": False,
            "price": 120000,
            "currency": "COP",
            "image_url": IMG_CLOSING,
            "ticket_link": "https://fenix.co/cumbia",
            "lineup": ["Cumbia Digital Collective", "Systema Solar", "DJ Raíz"],
            "capacity": 400,
            "tags": ["cumbia", "colombian", "electronic"],
        },
        {
            "concert_id": "con_012",
            "artist": "Grand Closing",
            "title": "Music Week Closing Ceremony",
            "genre": "Multi-género",
            "description": "La ceremonia de cierre de Music Week. DJs, artistas en vivo y un show de luces sobre las murallas.",
            "date": "2027-01-10",
            "start_time": "17:00",
            "end_time": "02:00",
            "venue_id": "ven_001",
            "venue_name": "La Muralla",
            "is_free": True,
            "price": 0,
            "currency": "COP",
            "image_url": IMG_CLOSING,
            "ticket_link": "",
            "lineup": ["Artistas sorpresa", "Orquesta en vivo", "DJ Residents", "Show de luces"],
            "capacity": 2000,
            "tags": ["free", "closing", "special", "multi-genre"],
        },
    ]

    await db.concerts.insert_many(concerts)
    await db.concerts.create_index("date")
    await db.concerts.create_index("genre")
    logger.info(f"Seeded {len(concerts)} concerts!")


@app.on_event("shutdown")
async def shutdown_db_client():
    try:
        from reminders import stop_reminder_scheduler  # type: ignore
        stop_reminder_scheduler()
    except Exception:
        pass
    client.close()
