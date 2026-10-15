"""CMW-1: Cartagena Music Week pre-registration — the acquisition front door.

Captures presale pre-registrations from the web form (amocartagena.co/cmw) and the
in-app screen (same route). Each pre-reg is a REAL user record with REAL Ley-1581
consent, so every rail here is load-bearing:

  - Consent is demonstrable: the record stores the exact canonical consent text, its
    version + sha256 text_id, the affirmative-action timestamp, the Responsable and
    the policy URL. The server writes a consent block ONLY when the client sent the
    affirmative flag with the matching version — it can never be defaulted on.
  - Two separate authorizations: core pre-registration consent (required) and CMW
    marketing comms (optional, independently stamped, revocable by unticking).
  - 18+ hard gate: a DOB under 18 is rejected with NOTHING stored and NOTHING logged
    about the person. DOB exists in storage only for adults.
  - No "datos sensibles" (Ley 1581 art. 5): contact + attribution only.
  - The only promise is notification priority — no inventory guarantee exists here.
  - Attribution (utm_*/ref/landing) is internal, admin-only, never a public claim.

Identity key = email (lowercased, unique index): a re-submit upserts, never
duplicates. `source` keeps the FIRST touch; `last_source` tracks the latest.
user_id links when a session is present, when the email already belongs to an
account, or later via link_user_by_email() (called from the signup paths) — and
delete-account purges rows by user_id AND email (server.py).

Reuses the hardened plumbing of cmw.py / ratelimit.py: trusted client IP, salted
hashes (raw IP never stored), honeypot, Mongo-backed atomic rate buckets under the
fail-closed `cmwip` / `cmwcontact` prefixes (own `:pre:` sub-buckets, so prereg
traffic never eats the concierge quota).

Mounted by server.py on api prefix. Responses follow {data, error, message}.

  public:
    POST /cmw/prereg                 the pre-registration (20/h per IP, 6/h per contact)
  admin (ONLY Authorization: Bearer EVENTS_ADMIN_TOKEN):
    GET  /admin/cmw/prereg           rows + source breakdown  (?limit=)

Logging: '[cmw-prereg] ...' with type(exc).__name__ only. Never a name, an email,
a phone, a DOB, an IP or a token.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import secrets
import base64
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Literal, Mapping, Optional, Tuple

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, ValidationError, field_validator
from pymongo.errors import DuplicateKeyError

import cmw as _cmw
import events_elite as _events_elite
import ratelimit

logger = logging.getLogger("cmw_prereg")

router = APIRouter()
db: Any = None


def init(*, db_: Any) -> None:
    global db
    db = db_


# ── the legal block (recon #6: every value is the one the LIVE policy publishes) ──
RESPONSABLE = "Amo Cartagena S.A.S."
PRIVACY_EMAIL = "privacidad@amocartagena.co"
POLICY_URL = "https://www.amocartagena.co/privacidad"

CONSENT_VERSION = "cmw-prereg-v1"
CONSENT_TEXT_ES = (
    "Autorizo a Amo Cartagena S.A.S. a tratar mis datos personales con la finalidad de "
    "gestionar mi preinscripción a Cartagena Music Week, conforme a la Ley 1581 de 2012 "
    "y la Política de Privacidad. Conozco mi derecho a consultar, actualizar, rectificar, "
    "suprimir y revocar esta autorización escribiendo a privacidad@amocartagena.co."
)
CONSENT_TEXT_ID = hashlib.sha256(CONSENT_TEXT_ES.encode()).hexdigest()[:16]
CONSENT_PURPOSES = ["preinscripcion_cmw", "aviso_preventa_prioritaria"]

MARKETING_VERSION = "cmw-mkt-v1"
MARKETING_TEXT_ES = (
    "Quiero recibir noticias, preventas y avisos de Cartagena Music Week por WhatsApp y correo."
)
MARKETING_TEXT_ID = hashlib.sha256(MARKETING_TEXT_ES.encode()).hexdigest()[:16]

MIN_AGE = 18
MAX_BODY_BYTES = 16 * 1024
PREREG_ID_PREFIX = "cmw-p-"
PREREG_ID_RE = re.compile(r"^cmw-p-[a-z2-7]{8}$")

# Rate buckets: same fail-closed prefixes as the concierge requests (they are in
# ratelimit.SENSITIVE_PREFIXES), but `:pre:`-namespaced so the buckets are separate.
RATE_PER_IP = 20        # a shared venue/booth NAT must not lock out real signups
RATE_PER_CONTACT = 6
RATE_WINDOW_S = 3600

MSG: Dict[str, str] = {
    "received": ("Preinscripción recibida. Te avisaremos de la preventa antes que al público general. / "
                 "You're pre-registered. We'll notify you about the presale before the general public."),
    "invalid_request": "Solicitud no válida. / Invalid request.",
    "invalid_name": "Escribe tu nombre (2 a 80 caracteres). / Enter your name (2 to 80 characters).",
    "invalid_email": "Escribe un correo válido. / Enter a valid email.",
    "invalid_whatsapp": ("Escribe un número de WhatsApp con indicativo. / "
                         "Enter a WhatsApp number with country code."),
    "invalid_instagram": "Ese usuario de Instagram no es válido. / That Instagram handle is not valid.",
    "invalid_city": "Ciudad o país no válidos. / City or country not valid.",
    "invalid_dob": "Escribe tu fecha de nacimiento (DD/MM/AAAA). / Enter your date of birth (DD/MM/YYYY).",
    "under_18": ("La preinscripción es solo para mayores de 18 años. / "
                 "Pre-registration is 18+ only."),
    "consent_required": ("Necesitamos tu autorización para gestionar tu preinscripción. / "
                         "We need your consent to process your pre-registration."),
    "consent_version": ("El texto de autorización cambió. Recarga e inténtalo de nuevo. / "
                        "The consent text changed. Reload and try again."),
    "invalid_lang": "Idioma no disponible. / Language not available.",
    "rate_limited": ("Demasiadas solicitudes. Intenta de nuevo en una hora. / "
                     "Too many requests. Try again in an hour."),
    "unavailable": ("El servicio no está disponible en este momento. Intenta de nuevo. / "
                    "The service is unavailable right now. Please try again."),
    "unauthorized": "No autorizado. / Not authorized.",
    "ok": "ok",
}


def _ok(data: Any, message: str = "ok") -> Dict[str, Any]:
    return {"data": data, "error": None, "message": message}


def _fail(status: int, code: str) -> JSONResponse:
    return JSONResponse(status_code=status,
                        content={"data": None, "error": code, "message": MSG.get(code, MSG["invalid_request"])},
                        headers={"Cache-Control": "no-store"})


def new_prereg_id() -> str:
    """'cmw-p-' + 8 base32 characters (40 random bits), lowercase."""
    return PREREG_ID_PREFIX + base64.b32encode(secrets.token_bytes(5)).decode("ascii").lower()


# ── validation ────────────────────────────────────────────────────────────────

_IG_RE = re.compile(r"^[A-Za-z0-9._]{1,30}$")
_SRC_CLEAN_RE = re.compile(r"[<>\x00-\x1f\x7f​-‏  ]")
_DOB_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _clean_src(v: Any) -> Optional[str]:
    if not isinstance(v, str):
        return None
    s = _SRC_CLEAN_RE.sub("", v).strip()[:80]
    return s or None


class SourceIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    utm_source: Optional[str] = None
    utm_medium: Optional[str] = None
    utm_campaign: Optional[str] = None
    utm_content: Optional[str] = None
    ref: Optional[str] = None
    landing: Literal["web", "app"] = "web"

    @field_validator("utm_source", "utm_medium", "utm_campaign", "utm_content", "ref", mode="before")
    @classmethod
    def _clean(cls, v: Any) -> Optional[str]:
        return _clean_src(v)


class ConsentIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    accepted: bool
    version: str = ""

    @field_validator("accepted", mode="before")
    @classmethod
    def _accepted(cls, v: Any) -> bool:
        if v is not True:
            raise ValueError("consent required")
        return True


class PreregIn(BaseModel):
    """POST /cmw/prereg body."""
    model_config = ConfigDict(extra="ignore")
    full_name: str
    email: str
    whatsapp: str
    instagram: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    dob: str
    lang: Literal["es", "en", "fr", "pt"] = "es"
    consent: ConsentIn
    marketing_opt_in: bool = False
    source: SourceIn = SourceIn()

    @field_validator("full_name", mode="before")
    @classmethod
    def _name(cls, v: Any) -> str:
        s = _cmw._clean_text(_cmw._FORMAT_RE.sub("", v), 2, 80) if isinstance(v, str) and len(v) <= 400 else None
        if s is None or not re.search(r"[^\W\d_]", s) or re.search(r"[<>]|https?://|www\.", s, re.I):
            raise ValueError("name must be 2-80 characters")
        return s

    @field_validator("email", "whatsapp", mode="before")
    @classmethod
    def _contactish(cls, v: Any) -> str:
        if not isinstance(v, str) or not v.strip() or len(v) > 300:
            raise ValueError("required")
        return v.strip()

    @field_validator("instagram", mode="before")
    @classmethod
    def _ig(cls, v: Any) -> Optional[str]:
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        if not isinstance(v, str):
            raise ValueError("invalid instagram")
        s = v.strip().lstrip("@")
        if not _IG_RE.match(s):
            raise ValueError("invalid instagram")
        return s

    @field_validator("city", "country", mode="before")
    @classmethod
    def _place(cls, v: Any) -> Optional[str]:
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        s = _cmw._clean_text(v, 2, 60) if isinstance(v, str) and len(v) <= 200 else None
        if s is None or re.search(r"[<>]|https?://", s, re.I):
            raise ValueError("invalid place")
        return s

    @field_validator("dob", mode="before")
    @classmethod
    def _dob(cls, v: Any) -> str:
        if not isinstance(v, str) or not _DOB_RE.match(v.strip()):
            raise ValueError("invalid dob")
        return v.strip()

    @field_validator("marketing_opt_in", mode="before")
    @classmethod
    def _mkt(cls, v: Any) -> bool:
        return v is True


_FIELD_CODES: Dict[str, str] = {
    "full_name": "invalid_name", "email": "invalid_email", "whatsapp": "invalid_whatsapp",
    "instagram": "invalid_instagram", "city": "invalid_city", "country": "invalid_city",
    "dob": "invalid_dob", "lang": "invalid_lang", "consent": "consent_required",
}
_FIELD_ORDER: Tuple[str, ...] = ("consent", "full_name", "email", "whatsapp", "dob",
                                 "instagram", "city", "country", "lang")


def _age_on(today: date, dob: date) -> int:
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def validate_prereg(body: Any) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """(clean, None) or (None, error code). The code never carries the rejected value.
    A minor is rejected here, before anything touches storage or logs."""
    if not isinstance(body, Mapping):
        return None, "invalid_request"
    try:
        req = PreregIn.model_validate(dict(body))
    except ValidationError as exc:
        bad = {str(e["loc"][0]) for e in exc.errors() if e.get("loc")}
        for f in _FIELD_ORDER:
            if f in bad:
                return None, _FIELD_CODES[f]
        return None, "invalid_request"
    if req.consent.version != CONSENT_VERSION:
        return None, "consent_version"
    email = _cmw.normalize_email(req.email)
    if email is None:
        return None, "invalid_email"
    whatsapp = _cmw.normalize_phone(req.whatsapp)
    if whatsapp is None:
        return None, "invalid_whatsapp"
    try:
        dob = date.fromisoformat(req.dob)
    except ValueError:
        return None, "invalid_dob"
    today = _cmw.bogota_date()
    if dob > today or _age_on(today, dob) > 120:
        return None, "invalid_dob"
    if _age_on(today, dob) < MIN_AGE:
        return None, "under_18"
    return {
        "full_name": req.full_name, "email": email, "whatsapp": whatsapp,
        "instagram": req.instagram, "city": req.city, "country": req.country,
        "dob": req.dob, "lang": req.lang, "marketing_opt_in": req.marketing_opt_in,
        "source": req.source.model_dump(),
    }, None


# ── storage ───────────────────────────────────────────────────────────────────

_indexes_done = False


async def ensure_prereg_indexes(db_: Any = None) -> bool:
    """Idempotent. The unique email index IS the dedupe guarantee under races."""
    global _indexes_done
    if _indexes_done:
        return True
    d = db_ if db_ is not None else db
    if d is None:
        return False
    ok = True
    for keys, opts in (("email", {"unique": True}), ("whatsapp", {}),
                       ("created_at_dt", {}), ("user_id", {"sparse": True})):
        try:
            await d.cmw_preregistrations.create_index(keys, **opts)
        except Exception as exc:  # noqa: BLE001
            ok = False
            logger.error("[cmw-prereg] create_index %s failed: %s", keys, type(exc).__name__)
    _indexes_done = ok
    return ok


def _program_ref() -> Dict[str, Any]:
    """A snapshot of the program identity this pre-reg belongs to. The program file
    being unreadable must NEVER block a capture."""
    try:
        p = _cmw.load_program()
        brand = p.get("brand") or {}
        return {"name": brand.get("name") or _cmw.BRAND_NAME,
                "start_date": brand.get("start_date"), "end_date": brand.get("end_date"),
                "program_version": p.get("version")}
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw-prereg] program ref unavailable: %s", type(exc).__name__)
        return {"name": _cmw.BRAND_NAME, "start_date": None, "end_date": None, "program_version": None}


async def link_user_by_email(db_: Any, *, email: str, user_id: str) -> None:
    """Attach an account to its earlier anonymous pre-regs (called from the signup
    paths in server.py). Never raises: linking is best-effort, auth never depends on it."""
    try:
        e = _cmw.normalize_email(email)
        if not e or not user_id:
            return
        await db_.cmw_preregistrations.update_many(
            {"email": e, "user_id": None},
            {"$set": {"user_id": user_id, "updated_at": datetime.now(timezone.utc).isoformat()}})
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw-prereg] link_user failed: %s", type(exc).__name__)


async def _rate_limit(key: str, max_calls: int) -> Optional[JSONResponse]:
    try:
        await ratelimit.check(key, max_calls=max_calls, window_sec=RATE_WINDOW_S)
    except Exception as exc:  # noqa: BLE001 — a limiter that cannot run fails closed
        status = getattr(exc, "status_code", None)
        if status == 429:
            return _fail(429, "rate_limited")
        if status not in (None, 429):
            return _fail(503, "unavailable")
        logger.error("[cmw-prereg] rate limit check failed: %s", type(exc).__name__)
        return _fail(503, "unavailable")
    return None


async def create_prereg(db_: Any, body: Any, *, ip: str, user_id: Optional[str],
                        client: str, now: Optional[datetime] = None) -> Tuple[int, Dict[str, Any]]:
    """Validate, rate-limit, upsert. Returns (http status, response body)."""
    if isinstance(body, Mapping) and body.get("website") not in (None, ""):
        # Honeypot: nothing stored, nothing logged about the content.
        logger.warning("[cmw-prereg] rejected: honeypot")
        return 400, {"data": None, "error": "invalid_request", "message": MSG["invalid_request"]}

    clean, code = validate_prereg(body)
    if clean is None:
        err = code or "invalid_request"
        if err == "under_18":
            logger.info("[cmw-prereg] rejected: under_18")  # deliberately nothing else
        return 422, {"data": None, "error": err, "message": MSG[err]}

    for key, limit in ((f"{_cmw.RL_PREFIX_IP}:pre:{_cmw.salted_hash(ip, 'ip')}", RATE_PER_IP),
                       (f"{_cmw.RL_PREFIX_CONTACT}:pre:{_cmw.salted_hash(clean['email'], 'contact')}", RATE_PER_CONTACT)):
        denied = await _rate_limit(key, limit)
        if denied is not None:
            return denied.status_code, json.loads(bytes(denied.body))

    await ensure_prereg_indexes(db_)
    ts = now or datetime.now(timezone.utc)
    iso = ts.isoformat()
    ip_hash = _cmw.salted_hash(ip, "ip")

    # Session first; else an email already on an account links immediately.
    linked_user = user_id
    if linked_user is None:
        try:
            owner = await db_.users.find_one({"email": clean["email"]}, {"_id": 0, "user_id": 1})
            if isinstance(owner, Mapping) and owner.get("user_id"):
                linked_user = str(owner["user_id"])
        except Exception as exc:  # noqa: BLE001
            logger.error("[cmw-prereg] owner lookup failed: %s", type(exc).__name__)

    try:
        existing = await db_.cmw_preregistrations.find_one(
            {"email": clean["email"]},
            {"_id": 0, "prereg_id": 1, "marketing_opt_in": 1, "marketing": 1})
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw-prereg] read failed: %s", type(exc).__name__)
        return 503, {"data": None, "error": "unavailable", "message": MSG["unavailable"]}

    # The consent block exists ONLY because the affirmative flag + version arrived.
    consent_doc = {
        "version": CONSENT_VERSION, "text_id": CONSENT_TEXT_ID, "text": CONSENT_TEXT_ES,
        "accepted": True, "accepted_at": iso, "responsable": RESPONSABLE,
        "purposes": list(CONSENT_PURPOSES), "policy_url": POLICY_URL,
        "privacy_email": PRIVACY_EMAIL, "lang_shown": clean["lang"],
        "method": f"checkbox_{clean['source'].get('landing', 'web')}",
        "ip_hash": ip_hash, "client": client,
    }

    sets: Dict[str, Any] = {
        "full_name": clean["full_name"], "whatsapp": clean["whatsapp"],
        "dob": clean["dob"], "lang": clean["lang"], "updated_at": iso,
        "consent": consent_doc, "marketing_opt_in": clean["marketing_opt_in"],
        "last_source": clean["source"], "status": "prereg", "priority_access": True,
        "ip_hash": ip_hash, "client": client,
    }
    # Optional fields: an omitted value means "no change", never "erase what they
    # told us before" (a partial resubmit must not null instagram/city/country).
    for opt in ("instagram", "city", "country"):
        if clean[opt] is not None:
            sets[opt] = clean[opt]
        elif not existing:
            sets[opt] = None  # first insert: the field exists explicitly, as null
    if clean["marketing_opt_in"]:
        sets["marketing"] = {"version": MARKETING_VERSION, "text_id": MARKETING_TEXT_ID,
                             "text": MARKETING_TEXT_ES, "accepted_at": iso}
    elif isinstance(existing, Mapping) and existing.get("marketing_opt_in"):
        # They unticked it on a re-submit: that is a revocation, honor and stamp it.
        prior = existing.get("marketing") if isinstance(existing.get("marketing"), Mapping) else {}
        sets["marketing"] = {**dict(prior), "revoked_at": iso}
    if linked_user is not None:
        sets["user_id"] = linked_user

    # email itself comes from the upsert FILTER — putting it in $setOnInsert too
    # would be a conflicting-update-operators error on first insert.
    on_insert: Dict[str, Any] = {
        "prereg_id": new_prereg_id(), "created_at": iso, "created_at_dt": ts,
        "source": clean["source"],
        "ticketing_handoff": {"system": None, "external_id": None, "status": "pending"},
        "program_ref": _program_ref(),
    }
    if linked_user is None:
        on_insert["user_id"] = None

    update = {
        "$set": sets,
        "$setOnInsert": on_insert,
        "$push": {"consent_log": {"version": CONSENT_VERSION, "text_id": CONSENT_TEXT_ID,
                                  "accepted_at": iso, "ip_hash": ip_hash, "client": client,
                                  "landing": clean["source"].get("landing", "web")}},
    }

    stored = None
    for _attempt in range(2):
        try:
            stored = await db_.cmw_preregistrations.find_one_and_update(
                {"email": clean["email"]}, update, upsert=True, return_document=True,
                projection={"_id": 0, "prereg_id": 1, "created_at": 1})
            break
        except DuplicateKeyError:
            continue  # two first-submits raced; the retry takes the update path
        except Exception as exc:  # noqa: BLE001
            logger.error("[cmw-prereg] upsert failed: %s", type(exc).__name__)
            break
    if not isinstance(stored, Mapping):
        return 503, {"data": None, "error": "unavailable", "message": MSG["unavailable"]}

    updated = bool(existing)
    logger.info("[cmw-prereg] stored: %s landing=%s updated=%s linked=%s",
                stored.get("prereg_id"), clean["source"].get("landing"), updated, bool(linked_user))
    data = {"prereg_id": stored.get("prereg_id"), "status": "prereg",
            "priority_access": True, "updated": updated}
    return 200, {"data": data, "error": None, "message": MSG["received"]}


# ── routes ────────────────────────────────────────────────────────────────────


@router.post("/cmw/prereg")
async def create_prereg_route(request: Request) -> Any:
    if db is None:
        return _fail(503, "unavailable")
    try:
        raw = await request.body()
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw-prereg] body read failed: %s", type(exc).__name__)
        return _fail(400, "invalid_request")
    if not raw or len(raw) > MAX_BODY_BYTES:
        return _fail(400, "invalid_request")
    try:
        body = json.loads(raw)
    except Exception:  # noqa: BLE001 — malformed JSON
        return _fail(400, "invalid_request")
    try:
        status, payload = await create_prereg(
            db, body, ip=ratelimit.client_ip(request),
            user_id=await _cmw._session_user_id(db, request),
            client=_cmw._client_stamp(request))
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw-prereg] request failed: %s", type(exc).__name__)
        return _fail(503, "unavailable")
    return JSONResponse(status_code=status, content=payload, headers={"Cache-Control": "no-store"})


def _admin_guard(request: Request) -> Optional[JSONResponse]:
    """ONLY Authorization: Bearer EVENTS_ADMIN_TOKEN — never a cookie, never a session."""
    if _events_elite.is_events_admin_token(request):
        return None
    return _fail(401, "unauthorized")


@router.get("/admin/cmw/prereg")
async def admin_prereg_route(request: Request) -> Any:
    denied = _admin_guard(request)
    if denied is not None:
        return denied
    if db is None:
        return _fail(503, "unavailable")
    try:
        limit = max(1, min(500, int(request.query_params.get("limit") or 200)))
    except ValueError:
        limit = 200
    try:
        # created_at_dt is a real datetime (sort key) — JSONResponse can't serialize
        # it; clients get the ISO twin created_at.
        rows = await db.cmw_preregistrations.find(
            {}, {"_id": 0, "consent.text": 0, "marketing.text": 0, "consent_log": 0, "created_at_dt": 0},
        ).sort("created_at_dt", -1).limit(limit).to_list(length=limit)
        total = await db.cmw_preregistrations.count_documents({})
        facets = await db.cmw_preregistrations.aggregate([{"$facet": {
            "by_utm_source": [{"$group": {"_id": "$source.utm_source", "n": {"$sum": 1}}},
                              {"$sort": {"n": -1}}, {"$limit": 25}],
            "by_ref": [{"$group": {"_id": "$source.ref", "n": {"$sum": 1}}},
                       {"$sort": {"n": -1}}, {"$limit": 25}],
            "by_landing": [{"$group": {"_id": "$source.landing", "n": {"$sum": 1}}}],
            "marketing": [{"$match": {"marketing_opt_in": True}}, {"$count": "n"}],
            "linked": [{"$match": {"user_id": {"$type": "string", "$ne": ""}}}, {"$count": "n"}],
        }}]).to_list(length=1)
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw-prereg] admin read failed: %s", type(exc).__name__)
        return _fail(503, "unavailable")
    f = facets[0] if facets else {}

    def _count(key: str) -> int:
        arr = f.get(key) or []
        return int(arr[0].get("n", 0)) if arr else 0

    def _pairs(key: str) -> List[Dict[str, Any]]:
        return [{"value": r.get("_id"), "n": r.get("n", 0)} for r in (f.get(key) or [])]

    data = {
        "preregs": rows, "count": len(rows), "total": total,
        "breakdown": {
            "by_utm_source": _pairs("by_utm_source"), "by_ref": _pairs("by_ref"),
            "by_landing": _pairs("by_landing"),
            "marketing_opt_in": _count("marketing"), "linked_users": _count("linked"),
        },
        "consent_version": CONSENT_VERSION, "consent_text_id": CONSENT_TEXT_ID,
    }
    return JSONResponse(content=_ok(data, MSG["ok"]), headers={"Cache-Control": "no-store"})


@router.delete("/admin/cmw/prereg/{prereg_id}")
async def admin_prereg_delete_route(prereg_id: str, request: Request) -> Any:
    """The Ley 1581 suppression lever: the consent text promises 'suprimir' via
    privacidad@, and an anonymous lead has no account whose deletion would purge the
    row — the operator honors those requests here. One row, by prereg_id, admin only."""
    denied = _admin_guard(request)
    if denied is not None:
        return denied
    if db is None:
        return _fail(503, "unavailable")
    rid = prereg_id.strip().lower()
    if not PREREG_ID_RE.match(rid):
        return _fail(404, "not_found")
    try:
        res = await db.cmw_preregistrations.delete_one({"prereg_id": rid})
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw-prereg] delete failed: %s", type(exc).__name__)
        return _fail(503, "unavailable")
    if getattr(res, "deleted_count", 0) != 1:
        return _fail(404, "not_found")
    logger.info("[cmw-prereg] deleted: %s", rid)
    return JSONResponse(content=_ok({"deleted": rid}, MSG["ok"]), headers={"Cache-Control": "no-store"})
