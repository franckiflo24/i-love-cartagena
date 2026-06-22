"""
Admin Operator module.

The "Admin Operator" is YOU — the platform owner. This role is separate
from the Alcaldía (which has its analytics dashboard) and from partners.

It is authenticated with a single password stored in the ADMIN_OPERATOR_PASSWORD
env variable. It returns a stateless bearer token signed with HMAC-SHA256.

Capabilities:
  - Create a partner "skeleton" with a unique activation token
  - List all partners with their lifecycle status (invited/active/suspended)
  - Approve a partner so it appears publicly in the app
  - Suspend a partner (hides from public)
  - (Re)generate the activation magic link

Partner lifecycle:
    1. Admin creates partner       → status="invited",  is_public=False
    2. Partner clicks magic link   → status="active",   is_public=False
       (creates password, lands on dashboard)
    3. Admin reviews & approves    → status="active",   is_public=True
                                     (now appears in search, agenda, etc.)
    4. Admin suspends if needed    → status="suspended",is_public=False
"""
from __future__ import annotations
import hashlib
import hmac
import logging
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger("amo.admin_operator")

ADMIN_PASSWORD = os.getenv("ADMIN_OPERATOR_PASSWORD")
if not ADMIN_PASSWORD:
    raise RuntimeError("ADMIN_OPERATOR_PASSWORD env var is required — never use a hardcoded default")
ADMIN_TOKEN_SECRET = os.getenv("ADMIN_TOKEN_SECRET")
if not ADMIN_TOKEN_SECRET:
    raise RuntimeError("ADMIN_TOKEN_SECRET env var is required — never use a hardcoded default")
ADMIN_TOKEN_TTL_HOURS = int(os.getenv("ADMIN_TOKEN_TTL_HOURS", "12"))
ACTIVATION_TOKEN_TTL_DAYS = int(os.getenv("ACTIVATION_TOKEN_TTL_DAYS", "30"))

router = APIRouter(prefix="/admin/operator", tags=["admin-operator"])
public_router = APIRouter(tags=["business-activation"])  # for /business/activation/...


def _iso(d: datetime | None = None) -> str:
    return (d or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat()


# ──────────────────────────────────────────────────────────
# Auth: stateless HMAC tokens
# ──────────────────────────────────────────────────────────

def _sign_token() -> str:
    """Build an admin token: <expires_iso>|<hex_signature>."""
    expires = datetime.now(timezone.utc) + timedelta(hours=ADMIN_TOKEN_TTL_HOURS)
    payload = expires.isoformat()
    sig = hmac.new(ADMIN_TOKEN_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}|{sig}"


def _verify_token(token: str) -> bool:
    try:
        payload, sig = token.split("|", 1)
        expected_sig = hmac.new(ADMIN_TOKEN_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return False
        expires = datetime.fromisoformat(payload)
        return datetime.now(timezone.utc) < expires
    except Exception:
        return False


async def require_admin(request: Request) -> None:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Admin auth required")
    token = auth[7:].strip()
    if not _verify_token(token):
        raise HTTPException(status_code=401, detail="Invalid or expired admin token")


# ──────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────

def _get_db(request: Request):
    return request.app.state.db


@router.post("/login")
async def admin_login(request: Request):
    body = await request.json()
    password = (body.get("password") or "").strip()
    if not password or password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Contraseña incorrecta")
    return {"token": _sign_token(), "expires_in_hours": ADMIN_TOKEN_TTL_HOURS}


@router.get("/partners")
async def list_partners(request: Request):
    await require_admin(request)
    db = _get_db(request)
    cursor = db.partners.find(
        {},
        {
            "_id": 0, "partner_id": 1, "name": 1, "category": 1, "subcategory": 1,
            "tier": 1, "address": 1, "owner_email": 1, "phone": 1, "instagram": 1,
            "status": 1, "is_public": 1, "onboarding_percent": 1,
            "activation_expires_at": 1, "created_at": 1, "approved_at": 1,
            "membership_plan": 1, "membership_tier": 1,
        }
    ).sort("created_at", -1).limit(500)
    rows = await cursor.to_list(500)
    # Compute summary
    summary = {"invited": 0, "active_pending_approval": 0, "approved": 0, "suspended": 0}
    for r in rows:
        st = r.get("status") or "active"
        public = bool(r.get("is_public"))
        if st == "invited":
            summary["invited"] += 1
        elif st == "suspended":
            summary["suspended"] += 1
        elif public:
            summary["approved"] += 1
        else:
            summary["active_pending_approval"] += 1
    return {"partners": rows, "summary": summary, "total": len(rows)}


@router.post("/partners")
async def create_partner(request: Request):
    """Create a partner skeleton with an activation magic link."""
    await require_admin(request)
    db = _get_db(request)
    body = await request.json()
    name = (body.get("name") or "").strip()
    category = (body.get("category") or "").strip().lower()
    owner_email = (body.get("owner_email") or "").strip().lower()
    if not name or not category or not owner_email:
        raise HTTPException(status_code=400, detail="name, category, owner_email required")
    # Reject duplicates
    existing = await db.partners.find_one({"owner_email": owner_email}, {"_id": 0, "partner_id": 1, "name": 1})
    if existing:
        raise HTTPException(status_code=409, detail=f"Ya existe un partner con ese email: {existing.get('name')}")
    partner_id = f"ptr_{uuid.uuid4().hex[:10]}"
    activation_token = secrets.token_urlsafe(24)
    activation_expires = datetime.now(timezone.utc) + timedelta(days=ACTIVATION_TOKEN_TTL_DAYS)
    doc = {
        "partner_id": partner_id,
        "name": name,
        "category": category,
        "subcategory": (body.get("subcategory") or "").strip() or None,
        "tier": (body.get("tier") or "popular").strip().lower(),
        "address": (body.get("address") or "").strip() or None,
        "owner_email": owner_email,
        "phone": (body.get("phone") or "").strip() or None,
        "instagram": (body.get("instagram") or "").strip() or None,
        # Lifecycle
        "status": "invited",
        "is_public": False,
        "onboarding_percent": 10,
        "activation_token": activation_token,
        "activation_expires_at": _iso(activation_expires),
        # Defaults so reservation flow doesn't crash on free plan
        "membership_plan": "free",
        "membership_status": "active",
        "membership_tier": (body.get("tier") or "popular").strip().lower(),
        "created_at": _iso(),
        "created_by": "admin_operator",
    }
    await db.partners.insert_one(doc)
    # Build activation URL (frontend will read &token=)
    public_base = os.getenv("PUBLIC_APP_URL", "https://amocartagena.co")
    activation_url = f"{public_base}/business/activate?token={activation_token}"
    # WhatsApp template (URL-encoded done client-side)
    wa_message = (
        f"Hola {name} 🌟 Te invitamos a Amo Cartagena, la plataforma oficial de la ciudad. "
        f"Activa tu cuenta aquí y empieza a recibir reservas: {activation_url}"
    )
    return {
        "partner": _strip_internal(doc),
        "activation_url": activation_url,
        "whatsapp_message": wa_message,
    }


@router.post("/partners/{partner_id}/invite")
async def regenerate_invite(partner_id: str, request: Request):
    """Generate a fresh activation token (e.g., the previous one expired)."""
    await require_admin(request)
    db = _get_db(request)
    partner = await db.partners.find_one({"partner_id": partner_id})
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    activation_token = secrets.token_urlsafe(24)
    activation_expires = datetime.now(timezone.utc) + timedelta(days=ACTIVATION_TOKEN_TTL_DAYS)
    await db.partners.update_one(
        {"partner_id": partner_id},
        {"$set": {
            "activation_token": activation_token,
            "activation_expires_at": _iso(activation_expires),
            "status": "invited",
        }}
    )
    public_base = os.getenv("PUBLIC_APP_URL", "https://amocartagena.co")
    activation_url = f"{public_base}/business/activate?token={activation_token}"
    wa_message = (
        f"Hola {partner.get('name')} 🌟 Tu link de activación de Amo Cartagena fue actualizado. "
        f"Activa aquí: {activation_url}"
    )
    return {"activation_url": activation_url, "whatsapp_message": wa_message}


@router.patch("/partners/{partner_id}/approval")
async def set_approval(partner_id: str, request: Request):
    """Body: {action: 'approve' | 'suspend' | 'reactivate'}"""
    await require_admin(request)
    db = _get_db(request)
    body = await request.json()
    action = (body.get("action") or "").strip().lower()
    if action not in {"approve", "suspend", "reactivate"}:
        raise HTTPException(status_code=400, detail="Invalid action")
    update: dict[str, Any] = {}
    if action == "approve":
        update = {"is_public": True, "status": "active", "approved_at": _iso(), "approved_by": "admin_operator"}
    elif action == "suspend":
        update = {"is_public": False, "status": "suspended", "suspended_at": _iso()}
    elif action == "reactivate":
        update = {"is_public": True, "status": "active", "approved_at": _iso()}
    res = await db.partners.update_one({"partner_id": partner_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Partner not found")
    return {"ok": True, "status": update.get("status"), "is_public": update.get("is_public")}


# ──────────────────────────────────────────────────────────
# Public — partner self-activation via magic link
# ──────────────────────────────────────────────────────────

@public_router.get("/business/activation/{token}")
async def get_activation(token: str, request: Request):
    db = _get_db(request)
    partner = await db.partners.find_one(
        {"activation_token": token},
        {"_id": 0, "partner_id": 1, "name": 1, "category": 1, "owner_email": 1, "activation_expires_at": 1, "status": 1}
    )
    if not partner:
        raise HTTPException(status_code=404, detail="Token inválido o ya usado")
    expires = partner.get("activation_expires_at")
    if expires:
        try:
            if datetime.fromisoformat(expires) < datetime.now(timezone.utc):
                raise HTTPException(status_code=410, detail="Este link expiró. Pide uno nuevo a Amo Cartagena.")
        except HTTPException:
            raise
        except Exception:
            pass
    return {
        "partner_id": partner["partner_id"],
        "name": partner["name"],
        "category": partner.get("category"),
        "owner_email": partner.get("owner_email"),
    }


@public_router.post("/business/activate")
async def activate_partner(request: Request):
    """Body: {token, password, accept_terms: true}."""
    body = await request.json()
    token = (body.get("token") or "").strip()
    password = (body.get("password") or "").strip()
    accept = body.get("accept_terms")
    if not token or not password or not accept:
        raise HTTPException(status_code=400, detail="token, password and accept_terms required")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 8 caracteres")
    db = _get_db(request)
    partner = await db.partners.find_one({"activation_token": token})
    if not partner:
        raise HTTPException(status_code=404, detail="Token inválido o ya usado")
    expires = partner.get("activation_expires_at")
    if expires:
        try:
            if datetime.fromisoformat(expires) < datetime.now(timezone.utc):
                raise HTTPException(status_code=410, detail="Link expirado")
        except HTTPException:
            raise
        except Exception:
            pass

    # Create business_users entry (or update if email already registered)
    email = (partner.get("owner_email") or "").lower()
    import bcrypt  # type: ignore
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    # Re-use existing business_id if user already exists, else create one
    existing_biz = await db.business_users.find_one({"email": email}, {"_id": 0, "business_id": 1})
    business_id = existing_biz["business_id"] if existing_biz and existing_biz.get("business_id") else f"biz_{uuid.uuid4().hex[:10]}"

    biz_doc = {
        "business_id": business_id,
        "email": email,
        "password_hash": pw_hash,
        "partner_id": partner["partner_id"],
        "full_name": partner.get("name") or email,
        "role": "business",
        "activated_at": _iso(),
    }
    await db.business_users.update_one(
        {"email": email},
        {"$set": biz_doc, "$setOnInsert": {"created_at": _iso()}},
        upsert=True,
    )

    # Mark partner as active (still not public until admin approval)
    await db.partners.update_one(
        {"partner_id": partner["partner_id"]},
        {"$set": {
            "status": "active",
            "activated_at": _iso(),
            "onboarding_percent": 30,
        },
         "$unset": {"activation_token": ""}}
    )

    # Issue a business session token compatible with server.get_current_business
    biz_token = f"biz_{uuid.uuid4().hex}"
    await db.business_sessions.insert_one({
        "token": biz_token,
        "business_id": business_id,
        "partner_id": partner["partner_id"],
        "created_at": _iso(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
    })

    return {
        "ok": True,
        "token": biz_token,
        "partner_id": partner["partner_id"],
        "name": partner["name"],
        "needs_approval": True,
    }


# ──────────────────────────────────────────────────────────
# Onboarding completion %
# ──────────────────────────────────────────────────────────

ONBOARDING_FIELDS = [
    ("name",        10),
    ("category",     5),
    ("address",     10),
    ("phone",       10),
    ("whatsapp",    10),
    ("experience",  15),
    ("instagram",    5),
    ("schedule",    10),
    ("default_payment_link", 10),
    ("photos",      15),  # special: count >=1
]

def compute_onboarding_percent(partner: dict) -> int:
    total = 0
    for field, weight in ONBOARDING_FIELDS:
        val = partner.get(field)
        if field == "photos":
            photos = partner.get("photos") or partner.get("images") or []
            if isinstance(photos, list) and len(photos) > 0:
                total += weight
        else:
            if val and (not isinstance(val, str) or val.strip()):
                total += weight
    return min(100, total)


@public_router.get("/business/onboarding-status")
async def onboarding_status(request: Request):
    """Returns the partner's onboarding completion %. Requires biz auth."""
    try:
        from server import get_current_business  # type: ignore
        biz = await get_current_business(request)
    except Exception:
        raise HTTPException(status_code=401, detail="Not authenticated as business")
    db = _get_db(request)
    partner = await db.partners.find_one({"partner_id": biz["partner_id"]})
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    pct = compute_onboarding_percent(partner)
    # Save it for the admin list view
    await db.partners.update_one(
        {"partner_id": partner["partner_id"]},
        {"$set": {"onboarding_percent": pct}}
    )
    missing = []
    for field, _ in ONBOARDING_FIELDS:
        val = partner.get(field)
        if field == "photos":
            photos = partner.get("photos") or partner.get("images") or []
            if not (isinstance(photos, list) and len(photos) > 0):
                missing.append(field)
        else:
            if not (val and (not isinstance(val, str) or val.strip())):
                missing.append(field)
    return {
        "percent": pct,
        "is_public": bool(partner.get("is_public")),
        "status": partner.get("status", "active"),
        "missing": missing,
    }


def _strip_internal(d: dict) -> dict:
    out = dict(d)
    out.pop("activation_token", None)
    out.pop("_id", None)
    return out
