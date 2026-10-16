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

CMW-2 (2026-10-15) adds the growth/comms capture layer from Franck's spec:
  - Apellido (last_name) + Género (optional) fields; Instagram becomes REQUIRED
    (the spec marks it obligatorio — the handle is CMW's audience-building asset).
  - Personal referral codes: every pre-reg mints a unique `referral_code`
    (CMW-XXXXXX); an incoming `source.ref` matching another person's code stamps
    `referred_by` on FIRST insert (never on self, never rewritten on re-submit).
    Partner links keep using arbitrary ?ref= values — they simply never match.
  - Funnel events (cmw_funnel_events, 180-day TTL): client fires cmw_link_abierto /
    preinscripcion_iniciada / referido_compartido (+ native later: push_aceptado,
    app_instalada); the SERVER stamps preinscripcion_completada and cuenta_creada
    itself, so conversion truth never depends on client JS. No PII in events.
  - CSV export + download log: every export writes db.cmw_admin_downloads
    (who/when/filters/rows — the spec's "registro de quién descargó qué").
  - Admin guard widens to require_admin_read (EVENTS_ADMIN_TOKEN bearer OR an
    is_admin session) so the /cmw-panel screen works with Phil's admin session.

Mounted by server.py on api prefix. Responses follow {data, error, message}.

  public:
    POST /cmw/prereg                 the pre-registration (20/h per IP, 6/h per contact)
    POST /cmw/event                  funnel event (whitelisted kinds, 120/h per IP)
  admin (Bearer EVENTS_ADMIN_TOKEN or is_admin session):
    GET  /admin/cmw/prereg           rows + breakdowns + funnel  (?limit=)
    GET  /admin/cmw/prereg.csv       filtered export (logged to cmw_admin_downloads)

Logging: '[cmw-prereg] ...' with type(exc).__name__ only. Never a name, an email,
a phone, a DOB, an IP or a token.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import re
import secrets
import base64
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Literal, Mapping, Optional, Tuple

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response
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

# Personal referral codes: no 0/O/1/I/L so a code read aloud at a party survives the
# retelling. 31^6 ≈ 887M — collisions are a unique-index retry, never a user error.
REFERRAL_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
REFERRAL_RE = re.compile(r"^CMW-?([A-Z0-9]{6})$")

# Funnel events. Client-fireable kinds only — the two conversion truths
# (preinscripcion_completada, cuenta_creada) are stamped SERVER-side and a client
# claiming them is rejected, so the funnel can never be inflated from a browser.
EVENT_KINDS_CLIENT = frozenset({
    "cmw_link_abierto", "preinscripcion_iniciada", "referido_compartido",
    "push_aceptado", "app_instalada",
})
EVENT_TTL_SECONDS = 180 * 24 * 3600  # capture window → presale window, then gone

# Rate buckets: same fail-closed prefixes as the concierge requests (they are in
# ratelimit.SENSITIVE_PREFIXES), but `:pre:`-namespaced so the buckets are separate.
RATE_PER_IP = 20        # a shared venue/booth NAT must not lock out real signups
RATE_PER_CONTACT = 6
RATE_PER_IP_EVENTS = 120  # `:evt:` bucket — a browsing session fires a handful
RATE_WINDOW_S = 3600
CSV_MAX_ROWS = 20000

MSG: Dict[str, str] = {
    "received": ("Preinscripción recibida. Te avisaremos de la preventa antes que al público general. / "
                 "You're pre-registered. We'll notify you about the presale before the general public."),
    "invalid_request": "Solicitud no válida. / Invalid request.",
    "invalid_name": "Escribe tu nombre (2 a 80 caracteres). / Enter your name (2 to 80 characters).",
    "invalid_email": "Escribe un correo válido. / Enter a valid email.",
    "invalid_whatsapp": ("Escribe un número de WhatsApp con indicativo. / "
                         "Enter a WhatsApp number with country code."),
    "invalid_instagram": ("Escribe tu usuario de Instagram (sin @). / "
                          "Enter your Instagram handle (no @)."),
    "invalid_last_name": ("Escribe tu apellido (2 a 80 caracteres). / "
                          "Enter your last name (2 to 80 characters)."),
    "invalid_gender": "Género no válido. / Invalid gender option.",
    "invalid_event": "Evento no válido. / Invalid event.",
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


def new_referral_code() -> str:
    """'CMW-' + 6 chars from the ambiguity-free alphabet. Uniqueness is the sparse
    unique index's job — the mint loop retries on DuplicateKeyError."""
    return "CMW-" + "".join(secrets.choice(REFERRAL_ALPHABET) for _ in range(6))


def normalize_referral(v: Any) -> Optional[str]:
    """A source.ref that LOOKS like a personal code → canonical CMW-XXXXXX; anything
    else (partner tags, campaign slugs) → None, and stays plain attribution."""
    if not isinstance(v, str):
        return None
    m = REFERRAL_RE.match(v.strip().upper())
    return f"CMW-{m.group(1)}" if m else None


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
    last_name: Optional[str] = None
    email: str
    whatsapp: str
    instagram: str
    gender: Optional[Literal["femenino", "masculino", "otro", "prefiero_no_decir"]] = None
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

    @field_validator("last_name", mode="before")
    @classmethod
    def _lname(cls, v: Any) -> Optional[str]:
        # Optional on the wire (profiles prefill one combined name); same hygiene as
        # full_name when present.
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        s = _cmw._clean_text(_cmw._FORMAT_RE.sub("", v), 2, 80) if isinstance(v, str) and len(v) <= 400 else None
        if s is None or not re.search(r"[^\W\d_]", s) or re.search(r"[<>]|https?://|www\.", s, re.I):
            raise ValueError("last name must be 2-80 characters")
        return s

    @field_validator("email", "whatsapp", mode="before")
    @classmethod
    def _contactish(cls, v: Any) -> str:
        if not isinstance(v, str) or not v.strip() or len(v) > 300:
            raise ValueError("required")
        return v.strip()

    @field_validator("instagram", mode="before")
    @classmethod
    def _ig(cls, v: Any) -> str:
        # CMW-2: REQUIRED (the spec marks Instagram obligatorio). Rows captured while
        # it was optional stay valid; a re-submit must now include it.
        if not isinstance(v, str) or not v.strip():
            raise ValueError("instagram required")
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
    "full_name": "invalid_name", "last_name": "invalid_last_name", "email": "invalid_email",
    "whatsapp": "invalid_whatsapp", "instagram": "invalid_instagram", "gender": "invalid_gender",
    "city": "invalid_city", "country": "invalid_city",
    "dob": "invalid_dob", "lang": "invalid_lang", "consent": "consent_required",
}
_FIELD_ORDER: Tuple[str, ...] = ("consent", "full_name", "last_name", "email", "whatsapp", "dob",
                                 "instagram", "gender", "city", "country", "lang")


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
        "full_name": req.full_name, "last_name": req.last_name, "email": email,
        "whatsapp": whatsapp, "instagram": req.instagram, "gender": req.gender,
        "city": req.city, "country": req.country,
        "dob": req.dob, "lang": req.lang, "marketing_opt_in": req.marketing_opt_in,
        "source": req.source.model_dump(),
    }, None


# ── storage ───────────────────────────────────────────────────────────────────

_indexes_done = False


async def ensure_prereg_indexes(db_: Any = None) -> bool:
    """Idempotent. The unique email index IS the dedupe guarantee under races; the
    sparse unique referral_code index is the mint-collision guarantee."""
    global _indexes_done
    if _indexes_done:
        return True
    d = db_ if db_ is not None else db
    if d is None:
        return False
    ok = True
    for keys, opts in (("email", {"unique": True}), ("whatsapp", {}),
                       ("created_at_dt", {}), ("user_id", {"sparse": True}),
                       ("referral_code", {"unique": True, "sparse": True})):
        try:
            await d.cmw_preregistrations.create_index(keys, **opts)
        except Exception as exc:  # noqa: BLE001
            ok = False
            logger.error("[cmw-prereg] create_index %s failed: %s", keys, type(exc).__name__)
    for keys, opts in (("event", {}), ("created_at_dt", {"expireAfterSeconds": EVENT_TTL_SECONDS}),):
        try:
            await d.cmw_funnel_events.create_index(keys, **opts)
        except Exception as exc:  # noqa: BLE001
            ok = False
            logger.error("[cmw-prereg] event index %s failed: %s", keys, type(exc).__name__)
    _indexes_done = ok
    return ok


async def record_event(db_: Any, event: str, *, lang: str = "es", landing: str = "web",
                       source: Optional[Dict[str, Any]] = None, ip_hash: str = "",
                       client: str = "", prereg_id: Optional[str] = None,
                       now: Optional[datetime] = None) -> None:
    """One funnel row. Analytics is best-effort by design: a failed insert is logged
    and swallowed — it must never break a capture, a signup or a page view."""
    try:
        ts = now or datetime.now(timezone.utc)
        await db_.cmw_funnel_events.insert_one({
            "event": event, "created_at": ts.isoformat(), "created_at_dt": ts,
            "lang": lang, "landing": landing, "source": source or {},
            "ip_hash": ip_hash, "client": client, "prereg_id": prereg_id,
        })
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw-prereg] event insert failed: %s", type(exc).__name__)


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
    paths in server.py). Never raises: linking is best-effort, auth never depends on it.
    A link that actually moved rows IS the spec's `cuenta_creada` conversion — stamped
    here, server-side, so the funnel cannot be inflated or missed by client JS."""
    try:
        e = _cmw.normalize_email(email)
        if not e or not user_id:
            return
        res = await db_.cmw_preregistrations.update_many(
            {"email": e, "user_id": None},
            {"$set": {"user_id": user_id, "updated_at": datetime.now(timezone.utc).isoformat()}})
        if getattr(res, "modified_count", 0) > 0:
            await record_event(db_, "cuenta_creada")
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
            {"_id": 0, "prereg_id": 1, "marketing_opt_in": 1, "marketing": 1, "referral_code": 1})
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw-prereg] read failed: %s", type(exc).__name__)
        return 503, {"data": None, "error": "unavailable", "message": MSG["unavailable"]}

    # Referral resolution — FIRST insert only ($setOnInsert): a source.ref shaped like a
    # personal code that belongs to someone ELSE stamps referred_by. A partner tag never
    # matches; your own code never counts; a re-submit never rewrites attribution.
    referred_by: Optional[str] = None
    ref_code = normalize_referral(clean["source"].get("ref"))
    if ref_code and not existing:
        try:
            referrer = await db_.cmw_preregistrations.find_one(
                {"referral_code": ref_code}, {"_id": 0, "prereg_id": 1, "email": 1})
            if isinstance(referrer, Mapping) and referrer.get("email") != clean["email"]:
                referred_by = str(referrer.get("prereg_id") or "") or None
        except Exception as exc:  # noqa: BLE001
            logger.error("[cmw-prereg] referrer lookup failed: %s", type(exc).__name__)

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
    # told us before" (a partial resubmit must not null last_name/city/country).
    # instagram is required since CMW-2, so it always lands in sets above the loop.
    sets["instagram"] = clean["instagram"]
    for opt in ("last_name", "gender", "city", "country"):
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

    stored = None
    # on_insert is rebuilt per attempt: a referral_code collision (sparse unique index)
    # must retry with a FRESH code, and the email race must retake the update path.
    # 3 attempts cover email-race + one code collision (31^6 space — effectively never).
    for _attempt in range(3):
        # email itself comes from the upsert FILTER — putting it in $setOnInsert too
        # would be a conflicting-update-operators error on first insert.
        on_insert: Dict[str, Any] = {
            "prereg_id": new_prereg_id(), "created_at": iso, "created_at_dt": ts,
            "source": clean["source"], "referral_code": new_referral_code(),
            "ticketing_handoff": {"system": None, "external_id": None, "status": "pending"},
            "program_ref": _program_ref(),
        }
        if referred_by is not None:
            on_insert["referred_by"] = referred_by
        if linked_user is None:
            on_insert["user_id"] = None

        update = {
            "$set": sets,
            "$setOnInsert": on_insert,
            "$push": {"consent_log": {"version": CONSENT_VERSION, "text_id": CONSENT_TEXT_ID,
                                      "accepted_at": iso, "ip_hash": ip_hash, "client": client,
                                      "landing": clean["source"].get("landing", "web")}},
        }
        try:
            stored = await db_.cmw_preregistrations.find_one_and_update(
                {"email": clean["email"]}, update, upsert=True, return_document=True,
                projection={"_id": 0, "prereg_id": 1, "created_at": 1, "referral_code": 1})
            break
        except DuplicateKeyError:
            continue  # email race → update path; code collision → fresh mint
        except Exception as exc:  # noqa: BLE001
            logger.error("[cmw-prereg] upsert failed: %s", type(exc).__name__)
            break
    if not isinstance(stored, Mapping):
        return 503, {"data": None, "error": "unavailable", "message": MSG["unavailable"]}

    referral_code = stored.get("referral_code")
    if not referral_code:
        # A CMW-1 row predating referral codes re-submitted: mint one now. The filter
        # guards the race (only a row still missing the field takes the write).
        for _attempt in range(3):
            code = new_referral_code()
            try:
                res = await db_.cmw_preregistrations.update_one(
                    {"email": clean["email"], "referral_code": {"$exists": False}},
                    {"$set": {"referral_code": code}})
                if getattr(res, "modified_count", 0) == 1:
                    referral_code = code
                else:  # someone else won the race — read theirs
                    row = await db_.cmw_preregistrations.find_one(
                        {"email": clean["email"]}, {"_id": 0, "referral_code": 1})
                    referral_code = (row or {}).get("referral_code")
                break
            except DuplicateKeyError:
                continue
            except Exception as exc:  # noqa: BLE001
                logger.error("[cmw-prereg] code backfill failed: %s", type(exc).__name__)
                break

    updated = bool(existing)
    # The conversion truth, stamped by the server that stored the row — never by JS.
    await record_event(db_, "preinscripcion_completada", lang=clean["lang"],
                       landing=clean["source"].get("landing", "web"), source=clean["source"],
                       ip_hash=ip_hash, client=client, prereg_id=stored.get("prereg_id"), now=ts)
    logger.info("[cmw-prereg] stored: %s landing=%s updated=%s linked=%s referred=%s",
                stored.get("prereg_id"), clean["source"].get("landing"), updated,
                bool(linked_user), bool(referred_by))
    data = {"prereg_id": stored.get("prereg_id"), "status": "prereg",
            "priority_access": True, "updated": updated,
            "referral_code": referral_code}
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


class EventIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    event: str
    lang: Literal["es", "en", "fr", "pt"] = "es"
    source: SourceIn = SourceIn()


@router.post("/cmw/event")
async def funnel_event_route(request: Request) -> Any:
    """Client-side funnel beacons (page open, form start, share tap, native push/install
    later). Whitelisted kinds only; the server-stamped conversions are rejected here so
    a browser can never inflate them. No PII travels: tags + lang + salted ip only."""
    if db is None:
        return _fail(503, "unavailable")
    try:
        raw = await request.body()
    except Exception:  # noqa: BLE001
        return _fail(400, "invalid_request")
    if not raw or len(raw) > 4 * 1024:
        return _fail(400, "invalid_request")
    try:
        body = EventIn.model_validate(json.loads(raw))
    except Exception:  # noqa: BLE001
        return _fail(422, "invalid_event")
    if body.event not in EVENT_KINDS_CLIENT:
        return _fail(422, "invalid_event")
    ip = ratelimit.client_ip(request)
    denied = await _rate_limit(f"{_cmw.RL_PREFIX_IP}:evt:{_cmw.salted_hash(ip, 'ip')}", RATE_PER_IP_EVENTS)
    if denied is not None:
        return denied
    await ensure_prereg_indexes(db)
    src = body.source.model_dump()
    await record_event(db, body.event, lang=body.lang, landing=src.get("landing", "web"),
                       source=src, ip_hash=_cmw.salted_hash(ip, "ip"),
                       client=_cmw._client_stamp(request))
    return JSONResponse(content=_ok({"ok": True}, MSG["ok"]), headers={"Cache-Control": "no-store"})


async def _admin_guard(request: Request) -> Optional[JSONResponse]:
    """Bearer EVENTS_ADMIN_TOKEN or an is_admin session (events_elite.require_admin_read —
    the same gate the events admin screens use). Never a bare cookie."""
    try:
        await _events_elite.require_admin_read(request)
        return None
    except HTTPException as exc:
        return _fail(exc.status_code if exc.status_code in (401, 403) else 401, "unauthorized")
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw-prereg] admin guard failed: %s", type(exc).__name__)
        return _fail(503, "unavailable")


@router.get("/admin/cmw/prereg")
async def admin_prereg_route(request: Request) -> Any:
    denied = await _admin_guard(request)
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
            "by_city": [{"$group": {"_id": "$city", "n": {"$sum": 1}}},
                        {"$sort": {"n": -1}}, {"$limit": 25}],
            "by_country": [{"$group": {"_id": "$country", "n": {"$sum": 1}}},
                           {"$sort": {"n": -1}}, {"$limit": 25}],
            "by_birth_year": [{"$group": {"_id": {"$substrBytes": ["$dob", 0, 4]}, "n": {"$sum": 1}}},
                              {"$sort": {"_id": 1}}, {"$limit": 110}],
            "marketing": [{"$match": {"marketing_opt_in": True}}, {"$count": "n"}],
            "linked": [{"$match": {"user_id": {"$type": "string", "$ne": ""}}}, {"$count": "n"}],
            # Spec KPI "% perfiles completos": IG + WhatsApp + DOB all present.
            "profiles_complete": [{"$match": {
                "instagram": {"$type": "string", "$ne": ""},
                "whatsapp": {"$type": "string", "$ne": ""},
                "dob": {"$type": "string", "$ne": ""}}}, {"$count": "n"}],
            "referred": [{"$match": {"referred_by": {"$type": "string", "$ne": ""}}}, {"$count": "n"}],
            "top_referrers": [{"$match": {"referred_by": {"$type": "string", "$ne": ""}}},
                              {"$group": {"_id": "$referred_by", "n": {"$sum": 1}}},
                              {"$sort": {"n": -1}}, {"$limit": 10}],
        }}]).to_list(length=1)
        funnel_rows = await db.cmw_funnel_events.aggregate([
            {"$group": {"_id": "$event", "n": {"$sum": 1}}}, {"$sort": {"n": -1}},
        ]).to_list(length=20)
        downloads = await db.cmw_admin_downloads.count_documents({})
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
            "by_city": _pairs("by_city"), "by_country": _pairs("by_country"),
            "by_birth_year": _pairs("by_birth_year"),
            "marketing_opt_in": _count("marketing"), "linked_users": _count("linked"),
            "profiles_complete": _count("profiles_complete"),
            "referred": _count("referred"), "top_referrers": _pairs("top_referrers"),
        },
        "funnel": [{"event": r.get("_id"), "n": r.get("n", 0)} for r in funnel_rows],
        "csv_downloads_logged": downloads,
        "consent_version": CONSENT_VERSION, "consent_text_id": CONSENT_TEXT_ID,
    }
    return JSONResponse(content=_ok(data, MSG["ok"]), headers={"Cache-Control": "no-store"})


# CSV export — the spec's "exportación CSV filtrable" with its download log.
_CSV_COLUMNS: Tuple[str, ...] = (
    "prereg_id", "created_at", "full_name", "last_name", "email", "whatsapp", "instagram",
    "gender", "city", "country", "dob", "lang", "marketing_opt_in", "user_linked",
    "utm_source", "utm_medium", "utm_campaign", "utm_content", "ref", "landing",
    "referral_code", "referred_by", "status",
)
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@router.get("/admin/cmw/prereg.csv")
async def admin_prereg_csv_route(request: Request) -> Any:
    denied = await _admin_guard(request)
    if denied is not None:
        return denied
    if db is None:
        return _fail(503, "unavailable")
    q: Dict[str, Any] = {}
    p = request.query_params
    for param, field in (("utm_source", "source.utm_source"), ("ref", "source.ref"),
                         ("landing", "source.landing"), ("city", "city"), ("country", "country")):
        v = _clean_src(p.get(param))
        if v:
            q[field] = v
    span: Dict[str, Any] = {}
    if _DATE_RE.match(p.get("from") or ""):
        span["$gte"] = p.get("from")
    if _DATE_RE.match(p.get("to") or ""):
        span["$lte"] = (p.get("to") or "") + "T23:59:59"
    if span:
        q["created_at"] = span
    try:
        rows = await db.cmw_preregistrations.find(
            q, {"_id": 0, "consent": 0, "marketing": 0, "consent_log": 0, "created_at_dt": 0,
                "ip_hash": 0, "client": 0},
        ).sort("created_at_dt", -1).limit(CSV_MAX_ROWS).to_list(length=CSV_MAX_ROWS)
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw-prereg] csv read failed: %s", type(exc).__name__)
        return _fail(503, "unavailable")

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(_CSV_COLUMNS)
    for r in rows:
        src = r.get("source") if isinstance(r.get("source"), Mapping) else {}
        w.writerow([
            r.get("prereg_id"), r.get("created_at"), r.get("full_name"), r.get("last_name"),
            r.get("email"), r.get("whatsapp"), r.get("instagram"), r.get("gender"),
            r.get("city"), r.get("country"), r.get("dob"), r.get("lang"),
            "1" if r.get("marketing_opt_in") else "0", "1" if r.get("user_id") else "0",
            src.get("utm_source"), src.get("utm_medium"), src.get("utm_campaign"),
            src.get("utm_content"), src.get("ref"), src.get("landing"),
            r.get("referral_code"), r.get("referred_by"), r.get("status"),
        ])

    # The download log: who pulled what, when — exports of personal data are auditable.
    try:
        ts = datetime.now(timezone.utc)
        await db.cmw_admin_downloads.insert_one({
            "at": ts.isoformat(), "at_dt": ts, "rows": len(rows),
            "filters": {k: v for k, v in q.items() if k != "created_at"},
            "date_from": p.get("from") or None, "date_to": p.get("to") or None,
            "ip_hash": _cmw.salted_hash(ratelimit.client_ip(request), "ip"),
            "client": _cmw._client_stamp(request),
            "via": "token" if _events_elite.is_events_admin_token(request) else "admin_session",
        })
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw-prereg] download log failed: %s", type(exc).__name__)

    fname = f"cmw-preinscripciones-{datetime.now(timezone.utc).strftime('%Y%m%d')}.csv"
    return Response(content=buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Cache-Control": "no-store",
                             "Content-Disposition": f'attachment; filename="{fname}"'})


@router.delete("/admin/cmw/prereg/{prereg_id}")
async def admin_prereg_delete_route(prereg_id: str, request: Request) -> Any:
    """The Ley 1581 suppression lever: the consent text promises 'suprimir' via
    privacidad@, and an anonymous lead has no account whose deletion would purge the
    row — the operator honors those requests here. One row, by prereg_id, admin only."""
    denied = await _admin_guard(request)
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
