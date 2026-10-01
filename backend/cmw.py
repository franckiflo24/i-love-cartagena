"""CMW: Cartagena Music Week — official program + concierge-led requests.

Spec: docs/cmw/DESIGN.md (§0 honesty spine, §2 data, §3 API). If code and the doc disagree, the
doc wins.

Honesty spine (§0): the app states ONLY what the official deck prints. Everything else is
"Por confirmar". Nothing here invents an artist, a lineup, a time, a price, an address, a
boarding point or a venue, and the "Very Special Guest" is never named. Booking is concierge-led:
no checkout, no payment, and the public API never returns a "confirmed" state.

  load_program()                     base truth, backend/data/cmw_program.json, read once per process
  validate_program(program, base)    -> [problem, ...]   (empty = valid)
  apply_overrides(program, docs)     pure merge of cmw_overrides docs over a program
  merged_program(db)                 base + overrides + catalog venues resolved at read time
  whatsapp_text / whatsapp_url       the prefilled concierge message (no personal data in it)
  ensure_cmw_indexes(db)             idempotent

Mounted by server.py BEFORE api_router (prefix /api). Every response is {data, error, message}:

  public:
    GET   /cmw/program                 merged program + generated_at        (_cache 300 / swr 600)
    POST  /cmw/requests                concierge request                    (5/h per IP, 3/h per contact)
  admin (ONLY Authorization: Bearer EVENTS_ADMIN_TOKEN — never a cookie, never a session):
    GET   /admin/cmw/requests          ?status=&limit=
    PATCH /admin/cmw/requests/{id}     {status}
    PATCH /admin/cmw/events/{id}       {fields: {...}, source_note}         writes cmw_log
    GET   /admin/cmw/log               ?limit=

Logging: '[cmw] ...' with type(exc).__name__ only. Never a name, a phone, an email, an IP or a
token.
"""
from __future__ import annotations

import asyncio
import base64
import copy
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import time as _time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Literal, Mapping, Optional, Sequence, Set, Tuple
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, ValidationError, field_validator
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

import emails
import events_elite as _events_elite
import events_gate as gate
import luna_events as _luna_events   # name / place scanners for the description leak rule (§2)
import ratelimit
import telegram_alerts
from partner_visibility import PUBLIC_PARTNER_FILTER

logger = logging.getLogger("cmw")

router = APIRouter()

db: Any = None

# ── constants ────────────────────────────────────────────────────────────────

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
PROGRAM_PATH = os.path.join(DATA_DIR, "cmw_program.json")

LANGS: Tuple[str, ...] = ("es", "en", "fr", "pt")
BRAND_NAME = "Cartagena Music Week"
CONCIERGE_WA = "573116844492"                      # the deck's contact, digits only (§1)
CONCIERGE_DISPLAY = "+57 311 6844492"
WA_BASE = f"https://wa.me/{CONCIERGE_WA}"
HUB_URL = "https://www.amocartagena.co/music-week"
PLACEHOLDER_ARTIST = "Very Special Guest"           # the ONLY artist string while artist_status is 'tba'

CATEGORIES = frozenset({"main_event", "after", "wellness", "party", "sunset", "dining", "island"})
EVENT_STATUSES: Tuple[str, ...] = ("confirmed", "tba")
ARTIST_STATUSES: Tuple[str, ...] = ("tba", "confirmed", "none")
TBA_FIELDS: Tuple[str, ...] = ("time", "price", "venue", "artist", "boarding_point")
# tba tag -> the event fields that must carry NO value while the tag is present ('artist' has its
# own rule: the placeholder is the only allowed string).
TBA_VALUE_FIELDS: Dict[str, Tuple[str, ...]] = {
    "time": ("time", "end_time"),
    "price": ("price_info",),
    "venue": ("venue_name", "venue_id"),
    "boarding_point": ("boarding_point",),
}
# Tags that keep an event 'tba' as a whole (§2: "tba when venue or headline artist is unannounced").
UNANNOUNCED_TAGS = frozenset({"venue", "artist", "boarding_point"})
# §2: "An override can change time, end_time, artist, price_info, venue_name, venue_id, date,
# description, image and status."
OVERRIDE_FIELDS: Tuple[str, ...] = ("time", "end_time", "artist", "price_info", "venue_name", "venue_id",
                                    "date", "description", "image", "status")
# A fact the program states. Setting one needs a source_note (who confirmed it and when). The
# description is prose the app and Luna print as fact, so it needs one too; only the image is free.
FACT_FIELDS = frozenset({"time", "end_time", "artist", "price_info", "venue_name", "venue_id", "date", "status",
                         "description"})
REQUEST_STATUSES: Tuple[str, ...] = ("received", "contacted", "confirmed", "closed")

REQUEST_ID_PREFIX = "cmw-r-"
REQUEST_ID_RE = re.compile(r"^cmw-r-[a-z2-7]{8}$")
MAX_BODY_BYTES = 16 * 1024
RATE_WINDOW_S = 3600
RATE_PER_IP = 5
RATE_PER_CONTACT = 3
RL_PREFIX_IP = "cmwip"              # both prefixes are in ratelimit.SENSITIVE_PREFIXES (fail closed)
RL_PREFIX_CONTACT = "cmwcontact"
ALERT_TIMEOUT_S = 8.0
MERGED_TTL_S = 60.0
ADMIN_ACTOR = "admin:token"
_BUILT_IN_PEPPER = "amo-cmw-v1"

_YMD_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_HM_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9\-]{0,62}[A-Za-z0-9])?"
                       r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]{0,62}[A-Za-z0-9])?)+$")
_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_CTRL_ALL_RE = re.compile(r"[\x00-\x1f\x7f]")
# Unicode format characters (bidi overrides, zero-width joiners, soft hyphens…): invisible in
# a form, but they can reverse or hide text in an alert or an admin list.
_FORMAT_RE = re.compile(r"[\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff]")
_WS_RE = re.compile(r"\s+")
_CLIENT_RE = re.compile(r"[^A-Za-z0-9._/ \-]")

# Free-text leak scan (validate_program): a time or an amount written into a description while
# that field is still tagged 'tba'.
TIME_TEXT_RE = re.compile(
    r"(?<![\d:/.])(?:[01]?\d|2[0-3])\s?[:hH]\s?[0-5]\d(?!\d)"
    r"|(?<![\d:/.])\d{1,2}(?::[0-5]\d)?\s?(?:a\.?\s?m\.?|p\.?\s?m\.?)(?![A-Za-z])", re.I)
PRICE_TEXT_RE = re.compile(
    r"[$€£]\s?\d|\b\d[\d.,]*\s?(?:cop|usd|eur|pesos?|d[oó]lares|dollars?|euros?|reais|mil pesos)\b", re.I)

_MON: Dict[str, Tuple[str, ...]] = {
    "es": ("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"),
    "en": ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"),
    "fr": ("janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."),
    "pt": ("jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"),
}

# User-facing errors: Spanish + English, never an internal detail (§3).
MSG: Dict[str, str] = {
    "ok": "ok",
    "received": ("Solicitud recibida. Un concierge te contactará. / "
                 "Request received. A concierge will contact you."),
    "invalid_request": ("No pudimos enviar tu solicitud. Escríbenos por WhatsApp. / "
                        "We couldn't send your request. Message us on WhatsApp."),
    "invalid_name": "Escribe tu nombre (2 a 80 caracteres). / Enter your name (2 to 80 characters).",
    "invalid_party_size": ("El número de personas debe estar entre 1 y 50. / "
                           "The party size must be between 1 and 50."),
    "invalid_contact": ("Escribe un número de WhatsApp con indicativo o un correo válido. / "
                        "Enter a WhatsApp number with country code or a valid email."),
    "invalid_note": "La nota puede tener hasta 500 caracteres. / The note can be up to 500 characters.",
    "unknown_event": ("Ese evento no está en el programa oficial. / "
                      "That event is not in the official program."),
    "invalid_lang": "Idioma no disponible. / Language not available.",
    "consent_required": ("Necesitamos tu autorización para que el concierge te contacte. / "
                         "We need your consent so the concierge can contact you."),
    "rate_limited": ("Demasiadas solicitudes. Intenta de nuevo en una hora o escríbenos por WhatsApp. / "
                     "Too many requests. Try again in an hour or message us on WhatsApp."),
    "unavailable": ("El servicio no está disponible en este momento. Intenta de nuevo o escríbenos por "
                    "WhatsApp. / The service is unavailable right now. Try again or message us on WhatsApp."),
    "program_unavailable": ("El programa no está disponible en este momento. Intenta de nuevo. / "
                            "The program is unavailable right now. Please try again."),
    "unauthorized": "No autorizado. / Not authorized.",
    "forbidden": "Acceso denegado. / Access denied.",
    "not_found": "No encontrado. / Not found.",
    "invalid_status": "Estado no válido. / Invalid status.",
    "no_fields": "No hay cambios para guardar. / There are no changes to save.",
    "invalid_field": "Ese campo no se puede modificar. / That field cannot be changed.",
    "invalid_value": "El valor no es válido. / The value is not valid.",
    "source_note_required": ("Falta la nota de fuente: quién lo confirmó y cuándo. / "
                             "The source note is missing: who confirmed it and when."),
    "unknown_venue": "Ese lugar no está en el catálogo. / That venue is not in the catalog.",
    "invalid_override": ("El cambio deja el programa en un estado no válido. / "
                         "The change leaves the program in an invalid state."),
}


class ProgramError(RuntimeError):
    """The base program file is missing, unreadable or fails validate_program."""


class OverrideError(ValueError):
    """A rejected override field. `code` is a MSG key, `field` the override key."""

    def __init__(self, code: str, field: str) -> None:
        super().__init__(f"{code}:{field}")
        self.code = code
        self.field = field


def init(*, db_: Any) -> None:
    global db
    db = db_
    invalidate_cache()


# ── response helpers ─────────────────────────────────────────────────────────


def _ok(data: Any, message: str = "ok") -> Dict[str, Any]:
    return {"data": data, "error": None, "message": message}


def _fail(status: int, code: str, message_key: Optional[str] = None, data: Any = None) -> JSONResponse:
    body = {"data": data, "error": code, "message": MSG.get(message_key or code, MSG["invalid_request"])}
    return JSONResponse(status_code=status, content=body, headers={"Cache-Control": "no-store"})


def _cache(response: Response, seconds: int, swr: int = 300) -> None:
    """Same public cache hint as server._cache (anonymous, identity-independent GET
    only), including its CORS rule: a CDN entry filled by an Origin-less caller
    must still carry ACAO or a browser on www rejects the cached HIT."""
    response.headers["Cache-Control"] = (
        f"public, max-age={seconds}, s-maxage={seconds}, stale-while-revalidate={swr}"
    )
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Vary"] = "Origin"


def _now(now: Optional[datetime] = None) -> datetime:
    return gate.as_utc(now)


# ── dates ────────────────────────────────────────────────────────────────────


def parse_ymd(v: Any) -> Optional[date]:
    if not isinstance(v, str) or not _YMD_RE.match(v):
        return None
    try:
        return date(int(v[0:4]), int(v[5:7]), int(v[8:10]))
    except ValueError:
        return None


def _lang(lang: Any) -> str:
    return lang if lang in LANGS else "es"


def day_label(v: Any, lang: Any = "es", *, year: bool = True) -> str:
    """'31 dic 2026' / 'Dec 31, 2026' / '31 déc. 2026' / '31 dez 2026'. '' when not a date."""
    d = v if isinstance(v, date) else parse_ymd(v)
    if d is None:
        return ""
    lg = _lang(lang)
    mon = _MON[lg][d.month - 1]
    if lg == "en":
        return f"{mon} {d.day}, {d.year}" if year else f"{mon} {d.day}"
    return f"{d.day} {mon} {d.year}" if year else f"{d.day} {mon}"


def range_label(brand: Mapping[str, Any], lang: Any = "es") -> str:
    a, b = day_label(brand.get("start_date"), lang), day_label(brand.get("end_date"), lang)
    return f"{a} – {b}" if a and b else ""


def window(program: Mapping[str, Any]) -> Optional[Tuple[date, date]]:
    brand = program.get("brand") if isinstance(program, Mapping) else None
    if not isinstance(brand, Mapping):
        return None
    s, e = parse_ymd(brand.get("start_date")), parse_ymd(brand.get("end_date"))
    return (s, e) if s is not None and e is not None and s <= e else None


def bogota_date(now: Optional[datetime] = None) -> date:
    return gate.bogota_now(now).date()


def phase(program: Mapping[str, Any], now: Optional[datetime] = None) -> str:
    """'before' | 'during' | 'after', in Bogotá time."""
    win = window(program)
    today = bogota_date(now)
    if win is None or today < win[0]:
        return "before"
    return "after" if today > win[1] else "during"


# ── validation ───────────────────────────────────────────────────────────────


def l4_ok(v: Any) -> bool:
    return isinstance(v, Mapping) and all(isinstance(v.get(k), str) and v[k].strip() for k in LANGS)


def _event_ids(program: Any) -> List[str]:
    events = program.get("events") if isinstance(program, Mapping) else None
    return [str(e.get("id")) for e in events or [] if isinstance(e, Mapping)]


def _l4_texts(v: Any) -> List[str]:
    return [str(v[k]) for k in LANGS if isinstance(v, Mapping) and isinstance(v.get(k), str)]


def _validate_brand(brand: Any, problems: List[str]) -> None:
    if not isinstance(brand, Mapping):
        problems.append("brand: missing")
        return
    if not isinstance(brand.get("name"), str) or not brand["name"].strip():
        problems.append("brand.name: missing")
    s, e = parse_ymd(brand.get("start_date")), parse_ymd(brand.get("end_date"))
    if s is None or e is None or s > e:
        problems.append("brand.start_date/end_date: not a valid range")
    for key in ("tagline", "access_note"):
        if not l4_ok(brand.get(key)):
            problems.append(f"brand.{key}: L4 incomplete")
    if "days_label" in brand and not l4_ok(brand.get("days_label")):
        problems.append("brand.days_label: L4 incomplete")
    for i, t in enumerate(brand.get("taglines") or []):
        if not l4_ok(t):
            problems.append(f"brand.taglines[{i}]: L4 incomplete")
    pillars = brand.get("pillars")
    if not isinstance(pillars, list) or not pillars:
        problems.append("brand.pillars: missing")
    for i, p in enumerate(pillars if isinstance(pillars, list) else []):
        if not isinstance(p, Mapping) or not isinstance(p.get("key"), str) or not l4_ok(p.get("label")):
            problems.append(f"brand.pillars[{i}]: key or L4 label incomplete")
    con = brand.get("concierge")
    if not isinstance(con, Mapping):
        problems.append("brand.concierge: missing")
    else:
        if con.get("whatsapp_e164") != f"+{CONCIERGE_WA}":
            problems.append("brand.concierge.whatsapp_e164: is not the deck's contact")
        for key in ("intro", "assistant_note"):
            if key in con and not l4_ok(con.get(key)):
                problems.append(f"brand.concierge.{key}: L4 incomplete")
        for i, sv in enumerate(con.get("services") or []):
            if not l4_ok(sv):
                problems.append(f"brand.concierge.services[{i}]: L4 incomplete")
    for i, pr in enumerate(brand.get("practical") or []):
        if not isinstance(pr, Mapping) or not l4_ok(pr.get("title")) or not l4_ok(pr.get("body")):
            problems.append(f"brand.practical[{i}]: L4 incomplete")
            continue
        link = pr.get("link")
        if link is not None and not (isinstance(link, str) and link.startswith("/") and not link.startswith("//")):
            problems.append(f"brand.practical[{i}].link: must be an in-app path or null")


def _known_tokens(program: Mapping[str, Any]) -> Set[str]:
    """Word tokens of everything the program itself names (brand, pillars, taglines, concierge
    and practical copy, every printed title, venue and confirmed artist): the only proper nouns
    a description may carry while a venue, an artist or a boarding point is to be confirmed."""
    names: List[Any] = [PLACEHOLDER_ARTIST, "Cartagena Music Week", "AMO Life", "AMO"]
    raw_brand = program.get("brand")
    brand: Mapping[str, Any] = raw_brand if isinstance(raw_brand, Mapping) else {}
    names.append(brand.get("name"))
    for key in ("days_label", "tagline", "access_note"):
        names.extend(_l4_texts(brand.get(key)))
    for tg in brand.get("taglines") or []:
        names.extend(_l4_texts(tg))
    for pl in brand.get("pillars") or []:
        if isinstance(pl, Mapping):
            names.extend(_l4_texts(pl.get("label")))
    raw_con = brand.get("concierge")
    con: Mapping[str, Any] = raw_con if isinstance(raw_con, Mapping) else {}
    names.append(con.get("assistant"))
    for key in ("intro", "assistant_note"):
        names.extend(_l4_texts(con.get(key)))
    for sv in con.get("services") or []:
        names.extend(_l4_texts(sv))
    for pr in brand.get("practical") or []:
        if isinstance(pr, Mapping):
            names.extend(_l4_texts(pr.get("title")) + _l4_texts(pr.get("body")))
    for e in program.get("events") or []:
        if not isinstance(e, Mapping):
            continue
        names.extend([e.get("title"), e.get("venue_name")])
        if e.get("artist_status") == "confirmed":
            names.append(e.get("artist"))
    out: Set[str] = set()
    for n in names:
        if isinstance(n, str):
            out.update(_luna_events._norm_words(n).split())
    return out


def _leaked_names_or_places(texts: Sequence[str], known: Set[str], *, places: bool) -> bool:
    """True when a text names a person the program does not (a capitalized run of unknown
    words) or, with `places`, a Cartagena place (gazetteer / landmark token) the program does
    not name."""
    for txt in texts:
        try:
            if _luna_events._unknown_name_spans(txt, known):
                return True
        except Exception as exc:  # noqa: BLE001 — fail closed: an unscannable text is a leak
            logger.error("[cmw] name scan failed: %s", type(exc).__name__)
            return True
        if places:
            for w in _luna_events._norm_words(txt).split():
                if len(w) >= 3 and w in _luna_events._place_tokens() and w not in known \
                        and w not in _luna_events._ENTITY_STOP and w not in _luna_events._NAME_GENERIC_WORDS:
                    return True
    return False


def _validate_event(ev: Mapping[str, Any], win: Optional[Tuple[date, date]],
                    base_ev: Optional[Mapping[str, Any]], problems: List[str],
                    known: Optional[Set[str]] = None) -> None:
    eid = str(ev.get("id"))
    p = f"events[{eid}]"
    d = parse_ymd(ev.get("date"))
    if d is None:
        problems.append(f"{p}.date: not YYYY-MM-DD")
    elif win is not None:
        if not win[0] <= d <= win[1]:
            problems.append(f"{p}.date: outside the program window")
        elif ev.get("day_index") != (d - win[0]).days + 1:
            problems.append(f"{p}.day_index: does not match the date")
    title = ev.get("title")
    if not isinstance(title, str) or not title.strip():
        problems.append(f"{p}.title: missing")
    elif base_ev is not None and title != base_ev.get("title"):
        problems.append(f"{p}.title: differs from the printed title")
    if ev.get("subtitle") is not None and not l4_ok(ev.get("subtitle")):
        problems.append(f"{p}.subtitle: L4 incomplete")
    if not l4_ok(ev.get("description")):
        problems.append(f"{p}.description: L4 incomplete")
    if ev.get("category") not in CATEGORIES:
        problems.append(f"{p}.category: unknown")
    if ev.get("status") not in EVENT_STATUSES:
        problems.append(f"{p}.status: must be confirmed|tba")
    if ev.get("booking_type") != "concierge":
        problems.append(f"{p}.booking_type: must be concierge")
    if ev.get("lat") is not None or ev.get("lng") is not None:
        problems.append(f"{p}.lat/lng: coordinates come only from the catalog")
    for key in ("venue_name", "venue_id"):
        v = ev.get(key)
        if v is not None and not (isinstance(v, str) and v.strip()):
            problems.append(f"{p}.{key}: must be a non-empty string or null")
    if ev.get("venue_id") is not None and ev.get("venue_name") is None:
        problems.append(f"{p}.venue_id: needs a venue_name")
    for key in ("time", "end_time"):
        v = ev.get(key)
        if v is not None and not (isinstance(v, str) and _HM_RE.match(v)):
            problems.append(f"{p}.{key}: must be HH:MM or null")
    if ev.get("end_time") is not None and ev.get("time") is None:
        problems.append(f"{p}.end_time: needs a start time")
    price = ev.get("price_info")
    if price is not None and not ((isinstance(price, str) and price.strip()) or l4_ok(price)):
        problems.append(f"{p}.price_info: must be text, L4 or null")
    img = ev.get("image")
    if img is not None and not (isinstance(img, str) and img.startswith("/images/")):
        problems.append(f"{p}.image: must be a self-hosted /images/ path or null")

    tba = ev.get("tba")
    if not isinstance(tba, list) or any(t not in TBA_FIELDS for t in tba) or len(set(tba)) != len(tba):
        problems.append(f"{p}.tba: must list distinct fields of {', '.join(TBA_FIELDS)}")
        tba = [t for t in (tba if isinstance(tba, list) else []) if t in TBA_FIELDS]
    for tag in tba:
        for f in TBA_VALUE_FIELDS.get(tag, ()):
            if ev.get(f) not in (None, ""):
                problems.append(f"{p}.{f}: has a value while '{tag}' is to be confirmed")
    a_status, artist = ev.get("artist_status"), ev.get("artist")
    if a_status not in ARTIST_STATUSES:
        problems.append(f"{p}.artist_status: must be tba|confirmed|none")
    if artist is not None and not (isinstance(artist, str) and artist.strip()):
        problems.append(f"{p}.artist: must be a non-empty string or null")
    if "artist" in tba and a_status != "tba":
        problems.append(f"{p}.artist_status: must be tba while 'artist' is to be confirmed")
    if a_status == "tba":
        if "artist" not in tba:
            problems.append(f"{p}.tba: must list 'artist' while artist_status is tba")
        if artist not in (None, PLACEHOLDER_ARTIST):
            problems.append(f"{p}.artist: only '{PLACEHOLDER_ARTIST}' is allowed while the artist is to be confirmed")
    elif a_status == "none" and artist is not None:
        problems.append(f"{p}.artist: must be null while artist_status is none")
    elif a_status == "confirmed" and (not isinstance(artist, str) or artist.strip() == PLACEHOLDER_ARTIST):
        problems.append(f"{p}.artist: a confirmed artist needs a name")
    if ev.get("status") == "confirmed" and UNANNOUNCED_TAGS.intersection(tba):
        problems.append(f"{p}.status: cannot be confirmed while venue, artist or boarding point is to be confirmed")

    texts = _l4_texts(ev.get("description")) + _l4_texts(ev.get("subtitle"))
    if "time" in tba and any(TIME_TEXT_RE.search(t) for t in texts):
        problems.append(f"{p}.description: states a time while 'time' is to be confirmed")
    if "price" in tba and any(PRICE_TEXT_RE.search(t) for t in texts):
        problems.append(f"{p}.description: states a price while 'price' is to be confirmed")
    # §0: the guest is never named or hinted at; a venue / boarding point is never hinted at.
    unannounced = UNANNOUNCED_TAGS.intersection(tba)
    if unannounced and known is not None:
        vocab = set(known) | set(_luna_events._norm_words(str(ev.get("title") or "")).split())
        if _leaked_names_or_places(texts, vocab, places=bool(unannounced - {"artist"})):
            problems.append(f"{p}.description: names a person or a place the program does not while "
                            f"{', '.join(sorted(unannounced))} is to be confirmed")


def validate_program(program: Any, base: Optional[Mapping[str, Any]] = None) -> List[str]:
    """Every rule of §2 / §6. `base` is the program the ids and printed titles are compared with
    (default: the program itself, i.e. the base file being loaded). Returns the problems."""
    problems: List[str] = []
    if not isinstance(program, Mapping):
        return ["program: not an object"]
    _validate_brand(program.get("brand"), problems)
    events = program.get("events")
    if not isinstance(events, list) or not events or not all(isinstance(e, Mapping) for e in events):
        problems.append("events: missing")
        return problems
    ids = _event_ids(program)
    if len(set(ids)) != len(ids) or any(not i or i == "None" for i in ids):
        problems.append("events: ids must be present and unique")
    ref = base if base is not None else program
    ref_ids = _event_ids(ref)
    if sorted(ids) != sorted(ref_ids):
        problems.append("events: must be exactly the ids of the base program")
    ref_by_id = {str(e.get("id")): e for e in (ref.get("events") or []) if isinstance(e, Mapping)}
    win = window(program)
    known = _known_tokens(program)
    for ev in events:
        _validate_event(ev, win, ref_by_id.get(str(ev.get("id"))) if base is not None else None, problems, known)
    return problems


# ── base program (read once per process) ─────────────────────────────────────

_program_cache: Optional[Dict[str, Any]] = None


def load_program() -> Dict[str, Any]:
    """The committed base truth, read and validated ONCE per process. Returns a copy."""
    global _program_cache
    if _program_cache is None:
        try:
            with open(PROGRAM_PATH, encoding="utf-8") as f:
                data = json.load(f)
        except Exception as exc:  # noqa: BLE001
            logger.error("[cmw] program file unreadable: %s", type(exc).__name__)
            raise ProgramError("program_unreadable") from None
        problems = validate_program(data)
        if problems:
            logger.error("[cmw] program file invalid (%d): %s", len(problems), "; ".join(problems[:6]))
            raise ProgramError("program_invalid")
        _program_cache = data
    return copy.deepcopy(_program_cache)


def reset_program_cache() -> None:
    """Tests only."""
    global _program_cache
    _program_cache = None
    invalidate_cache()


def event_by_id(program: Mapping[str, Any], event_id: Any) -> Optional[Dict[str, Any]]:
    for ev in program.get("events") or []:
        if isinstance(ev, dict) and ev.get("id") == event_id:
            return ev
    return None


def events_on(program: Mapping[str, Any], day: Any) -> List[Dict[str, Any]]:
    ymd = day.isoformat() if isinstance(day, date) else str(day or "")
    return [ev for ev in program.get("events") or [] if isinstance(ev, dict) and ev.get("date") == ymd]


# ── overrides (pure merge) ───────────────────────────────────────────────────


def _clean_text(v: Any, lo: int, hi: int) -> Optional[str]:
    if not isinstance(v, str):
        return None
    s = _WS_RE.sub(" ", _CTRL_ALL_RE.sub(" ", v)).strip()
    return s if lo <= len(s) <= hi else None


def clean_override_value(key: str, value: Any, brand: Mapping[str, Any]) -> Any:
    """The validated value for one override field. Raises OverrideError('invalid_value', key)."""
    out: Any = None
    if key in ("time", "end_time"):
        out = value if isinstance(value, str) and _HM_RE.match(value) else None
    elif key in ("artist", "venue_name"):
        out = _clean_text(value, 2, 80)
    elif key == "venue_id":
        out = _clean_text(value, 2, 80)
    elif key == "price_info":
        if l4_ok(value):
            out = {k: _clean_text(value[k], 1, 160) for k in LANGS}
            out = out if all(out.values()) else None
        else:
            out = _clean_text(value, 1, 160)
    elif key == "date":
        d = parse_ymd(value)
        s, e = parse_ymd(brand.get("start_date")), parse_ymd(brand.get("end_date"))
        out = value if d is not None and s is not None and e is not None and s <= d <= e else None
    elif key == "description":
        if l4_ok(value):
            out = {k: _clean_text(value[k], 1, 400) for k in LANGS}
            out = out if all(out.values()) else None
    elif key == "image":
        ok = isinstance(value, str) and value.startswith("/images/") and ".." not in value and len(value) <= 200
        out = value if ok else None
    elif key == "status":
        out = value if value in EVENT_STATUSES else None
    if out is None:
        raise OverrideError("invalid_value", key)
    return out


def _apply_one(ev: Dict[str, Any], fields: Mapping[str, Any], note: str, brand: Mapping[str, Any], *,
               strict: bool) -> List[str]:
    """Apply one override doc's fields to `ev` in place. Returns the applied keys.
    strict=True (admin write): a bad field raises OverrideError. strict=False (read): a bad
    field is skipped, so one malformed row can never take the program down."""
    applied: List[str] = []
    for key in OVERRIDE_FIELDS:            # fixed order: venue_name before venue_id, time before end_time
        if key not in fields or fields[key] is None:
            continue
        try:
            if key in FACT_FIELDS and not note:
                raise OverrideError("source_note_required", key)
            value = clean_override_value(key, fields[key], brand)
        except OverrideError as exc:
            if strict:
                raise
            logger.error("[cmw] override skipped: %s on %s.%s", exc.code, ev.get("id"), key)
            continue
        tba = [t for t in ev.get("tba") or [] if isinstance(t, str)]
        if key == "artist":
            if value == PLACEHOLDER_ARTIST:
                ev["artist_status"] = "tba"
                if "artist" not in tba:
                    tba.append("artist")
            else:
                ev["artist_status"] = "confirmed"
                tba = [t for t in tba if t != "artist"]
        elif key == "time":
            tba = [t for t in tba if t != "time"]
        elif key == "price_info":
            tba = [t for t in tba if t != "price"]
        elif key == "venue_name":
            tba = [t for t in tba if t != "venue"]
        elif key == "date":
            s = parse_ymd(brand.get("start_date"))
            d = parse_ymd(value)
            if s is not None and d is not None:
                ev["day_index"] = (d - s).days + 1
        ev[key] = value
        ev["tba"] = tba
        applied.append(key)
    return applied


def apply_overrides(program: Mapping[str, Any], overrides: Iterable[Mapping[str, Any]], *,
                    strict: bool = False) -> Dict[str, Any]:
    """Pure merge of cmw_overrides docs {event_id, fields, source_note} over `program`.
    Unknown event ids and unknown fields are ignored. Events stay sorted by date, then by their
    printed order."""
    out = copy.deepcopy(dict(program))
    events = [e for e in out.get("events") or [] if isinstance(e, dict)]
    raw_brand = out.get("brand")
    brand: Mapping[str, Any] = raw_brand if isinstance(raw_brand, Mapping) else {}
    by_id = {e.get("id"): e for e in events}
    order = {e.get("id"): i for i, e in enumerate(events)}
    for ov in overrides or []:
        if not isinstance(ov, Mapping):
            continue
        ev = by_id.get(ov.get("event_id"))
        fields = ov.get("fields")
        if ev is None or not isinstance(fields, Mapping):
            continue
        note = ov.get("source_note")
        _apply_one(ev, fields, note.strip() if isinstance(note, str) else "", brand, strict=strict)
    events.sort(key=lambda e: (str(e.get("date") or ""), order.get(e.get("id"), 0)))
    out["events"] = events
    return out


# ── merged program (overrides + catalog venues, resolved at read time) ───────

_merged_cache: Dict[str, Any] = {"value": None, "exp": 0.0, "db": None}


def invalidate_cache() -> None:
    _merged_cache.update(value=None, exp=0.0, db=None)


async def _read_overrides(db_: Any) -> Tuple[List[Dict[str, Any]], bool]:
    if db_ is None:
        return [], False
    try:
        rows = await db_.cmw_overrides.find({}, {"_id": 0}).to_list(length=200)
        return [dict(r) for r in rows or [] if isinstance(r, Mapping)], True
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] overrides read failed: %s", type(exc).__name__)
        return [], False


def _venue_view(row: Mapping[str, Any]) -> Dict[str, Any]:
    """{id, name, lat, lng, neighborhood} from a catalog partner. Coordinates only when they are
    real ones (in the Distrito, not a placeholder). Never the catalog address."""
    lat, lng = gate._row_coords(row)
    valid = lat is not None and lng is not None and gate._valid_geo(lat, lng)
    hood = row.get("neighborhood") if isinstance(row.get("neighborhood"), str) and row["neighborhood"].strip() \
        else row.get("zone")
    return {
        "id": str(row.get("partner_id")),
        "name": str(row.get("name") or "").strip(),
        "lat": lat if valid else None,
        "lng": lng if valid else None,
        "neighborhood": hood.strip() if isinstance(hood, str) and hood.strip() else None,
    }


async def resolve_venues(db_: Any, program: Dict[str, Any]) -> Dict[str, Any]:
    """Attach `venue` (or None) to every event and copy the catalog coordinates into lat/lng.
    An event without a catalog venue keeps lat/lng null: no map pin (§1.1)."""
    events = [e for e in program.get("events") or [] if isinstance(e, dict)]
    ids = sorted({str(e["venue_id"]) for e in events if isinstance(e.get("venue_id"), str) and e["venue_id"]})
    found: Dict[str, Dict[str, Any]] = {}
    if ids and db_ is not None:
        try:
            cur = db_.partners.find(
                {**PUBLIC_PARTNER_FILTER, "partner_id": {"$in": ids}},
                {"_id": 0, "partner_id": 1, "name": 1, "location": 1, "lat": 1, "lng": 1, "geo": 1,
                 "neighborhood": 1, "zone": 1},
            )
            for row in await cur.to_list(length=len(ids) + 5):
                if isinstance(row, Mapping) and row.get("partner_id") and str(row.get("name") or "").strip():
                    found[str(row["partner_id"])] = _venue_view(row)
        except Exception as exc:  # noqa: BLE001 — no catalog read means no pins, never a guess
            logger.error("[cmw] venue resolve failed: %s", type(exc).__name__)
            found = {}
    for ev in events:
        venue = found.get(str(ev.get("venue_id"))) if ev.get("venue_id") else None
        ev["venue"] = dict(venue) if venue else None
        ev["lat"] = venue["lat"] if venue else None
        ev["lng"] = venue["lng"] if venue else None
    return program


async def merged_program(db_: Any = None, *, use_cache: bool = True) -> Dict[str, Any]:
    """The program every surface reads: base file + cmw_overrides + catalog venues. Raises
    ProgramError only when the base file itself is unusable. A failed overrides read, or a merge
    that does not validate, serves the base program (what the deck prints) and is not cached."""
    d = db_ if db_ is not None else db
    now = _time.monotonic()
    if use_cache and _merged_cache["value"] is not None and _merged_cache["db"] is d and now < _merged_cache["exp"]:
        return copy.deepcopy(_merged_cache["value"])
    base = load_program()
    rows, read_ok = await _read_overrides(d)
    program = base
    healthy = read_ok
    if rows:
        try:
            trial = apply_overrides(base, rows)
            problems = validate_program(trial, base)
        except Exception as exc:  # noqa: BLE001
            logger.error("[cmw] override merge failed: %s", type(exc).__name__)
            problems = ["merge failed"]
            trial = base
        if problems:
            logger.error("[cmw] merged program invalid (%d), serving the base: %s", len(problems),
                         "; ".join(problems[:4]))
            healthy = False
        else:
            program = trial
    program = await resolve_venues(d, program)
    if healthy:
        _merged_cache.update(value=copy.deepcopy(program), exp=now + MERGED_TTL_S, db=d)
    program["_degraded"] = not healthy
    return program


def public_program(program: Mapping[str, Any], now: Optional[datetime] = None) -> Dict[str, Any]:
    out = {k: v for k, v in dict(program).items() if not str(k).startswith("_")}
    out["generated_at"] = gate.iso_utc(_now(now))
    return out


# ── WhatsApp (prefilled concierge message; never personal data) ──────────────

_WA_T: Dict[str, Dict[str, str]] = {
    "es": {"event": "Hola, quiero solicitar acceso a {title} ({date}) de Cartagena Music Week",
           "general": "Hola, quiero información sobre Cartagena Music Week ({range})",
           "one": " para 1 persona", "many": " para {n} personas", "rid": " Solicitud {rid}."},
    "en": {"event": "Hi, I'd like to request access to {title} ({date}) at Cartagena Music Week",
           "general": "Hi, I'd like information about Cartagena Music Week ({range})",
           "one": " for 1 person", "many": " for {n} people", "rid": " Request {rid}."},
    "fr": {"event": "Bonjour, je souhaite demander l'accès à {title} ({date}) de Cartagena Music Week",
           "general": "Bonjour, je souhaite des informations sur Cartagena Music Week ({range})",
           "one": " pour 1 personne", "many": " pour {n} personnes", "rid": " Demande {rid}."},
    "pt": {"event": "Olá, quero solicitar acesso a {title} ({date}) da Cartagena Music Week",
           "general": "Olá, quero informações sobre a Cartagena Music Week ({range})",
           "one": " para 1 pessoa", "many": " para {n} pessoas", "rid": " Pedido {rid}."},
}
_DEFAULT_BRAND: Dict[str, Any] = {"start_date": "2026-12-31", "end_date": "2027-01-07"}


def whatsapp_text(event: Optional[Mapping[str, Any]], lang: Any = "es", *, party_size: Optional[int] = None,
                  request_id: Optional[str] = None, brand: Optional[Mapping[str, Any]] = None) -> str:
    """The message the guest sends to the concierge: the event as printed, its date, the party
    size and the request id. No name, no phone, no email."""
    lg = _lang(lang)
    t = _WA_T[lg]
    title = event.get("title") if isinstance(event, Mapping) else None
    if isinstance(title, str) and title.strip():
        text = t["event"].format(title=title.strip(), date=day_label(event.get("date") if event else None, lg))
    else:
        text = t["general"].format(range=range_label(brand if isinstance(brand, Mapping) else _DEFAULT_BRAND, lg))
    if isinstance(party_size, int) and not isinstance(party_size, bool) and party_size >= 1:
        text += t["one"] if party_size == 1 else t["many"].format(n=party_size)
    text += "."
    if isinstance(request_id, str) and REQUEST_ID_RE.match(request_id):
        text += t["rid"].format(rid=request_id)
    return text


def whatsapp_url(event: Optional[Mapping[str, Any]], lang: Any = "es", *, party_size: Optional[int] = None,
                 request_id: Optional[str] = None, brand: Optional[Mapping[str, Any]] = None) -> str:
    text = whatsapp_text(event, lang, party_size=party_size, request_id=request_id, brand=brand)
    return f"{WA_BASE}?text={quote(text, safe='')}"


# ── request intake ───────────────────────────────────────────────────────────


def normalize_phone(value: Any) -> Optional[str]:
    """E.164-ish: an optional '+' (or '00'), then 7–15 digits. Separators are dropped."""
    if not isinstance(value, str):
        return None
    s = value.strip()
    if not s or re.search(r"[^\d+\s().\-]", s):
        return None
    plus = s.startswith("+")
    if s.count("+") > (1 if plus else 0):
        return None
    digits = re.sub(r"\D", "", s)
    if not plus and digits.startswith("00"):
        digits, plus = digits[2:], True
    if not 7 <= len(digits) <= 15:
        return None
    return f"+{digits}" if plus else digits


def normalize_email(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    s = value.strip()
    if len(s) > 254 or ".." in s or not _EMAIL_RE.match(s):
        return None
    return s.lower()


class ContactIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    type: Literal["whatsapp", "email"]
    value: str

    @field_validator("value", mode="before")
    @classmethod
    def _value(cls, v: Any) -> str:
        if not isinstance(v, str) or not v.strip() or len(v) > 300:
            raise ValueError("contact value required")
        return v.strip()


class RequestIn(BaseModel):
    """POST /cmw/requests body (§3)."""
    model_config = ConfigDict(extra="ignore")
    event_id: Optional[str] = None
    name: str
    party_size: int
    contact: ContactIn
    note: Optional[str] = None
    lang: Literal["es", "en", "fr", "pt"] = "es"
    consent: bool

    @field_validator("event_id", mode="before")
    @classmethod
    def _event_id(cls, v: Any) -> Optional[str]:
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        if not isinstance(v, str) or len(v) > 80:
            raise ValueError("unknown event")
        return v.strip()

    @field_validator("name", mode="before")
    @classmethod
    def _name(cls, v: Any) -> str:
        s = _clean_text(_FORMAT_RE.sub("", v), 2, 80) if isinstance(v, str) and len(v) <= 400 else None
        if s is None or not re.search(r"[^\W\d_]", s) or re.search(r"[<>]|https?://|www\.", s, re.I):
            raise ValueError("name must be 2-80 characters")
        return s

    @field_validator("party_size", mode="before")
    @classmethod
    def _party(cls, v: Any) -> int:
        if isinstance(v, bool):
            raise ValueError("party size must be 1-50")
        if isinstance(v, str) and re.fullmatch(r"\d{1,2}", v.strip()):
            v = int(v.strip())
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        if not isinstance(v, int) or not 1 <= v <= 50:
            raise ValueError("party size must be 1-50")
        return v

    @field_validator("note", mode="before")
    @classmethod
    def _note(cls, v: Any) -> Optional[str]:
        if v is None:
            return None
        if not isinstance(v, str):
            raise ValueError("note must be text")
        s = _CTRL_RE.sub(" ", _FORMAT_RE.sub("", v)).replace("\r", "").strip()
        if len(s) > 500:
            raise ValueError("note too long")
        return s or None

    @field_validator("consent", mode="before")
    @classmethod
    def _consent(cls, v: Any) -> bool:
        if v is not True:
            raise ValueError("consent required")
        return True


_FIELD_CODES: Dict[str, str] = {
    "name": "invalid_name", "party_size": "invalid_party_size", "contact": "invalid_contact",
    "note": "invalid_note", "event_id": "unknown_event", "lang": "invalid_lang", "consent": "consent_required",
}
_FIELD_ORDER: Tuple[str, ...] = ("name", "party_size", "contact", "event_id", "note", "lang", "consent")


def validate_request(body: Any, program: Mapping[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """(clean, None) or (None, error code). `clean` = {event_id, event, name, party_size, contact,
    note, lang}. The error code never carries the rejected value."""
    if not isinstance(body, Mapping):
        return None, "invalid_request"
    try:
        req = RequestIn.model_validate(dict(body))
    except ValidationError as exc:
        bad = {str(e["loc"][0]) for e in exc.errors() if e.get("loc")}
        for f in _FIELD_ORDER:
            if f in bad:
                return None, _FIELD_CODES[f]
        return None, "invalid_request"
    value = normalize_phone(req.contact.value) if req.contact.type == "whatsapp" else normalize_email(req.contact.value)
    if value is None:
        return None, "invalid_contact"
    event: Optional[Dict[str, Any]] = None
    if req.event_id is not None:
        event = event_by_id(program, req.event_id)
        if event is None:
            return None, "unknown_event"
    return {
        "event_id": req.event_id, "event": event, "name": req.name, "party_size": req.party_size,
        "contact": {"type": req.contact.type, "value": value}, "note": req.note, "lang": req.lang,
    }, None


def new_request_id() -> str:
    """'cmw-r-' + 8 base32 characters (40 random bits), lowercase."""
    return REQUEST_ID_PREFIX + base64.b32encode(secrets.token_bytes(5)).decode("ascii").lower()


_pepper_warned = False


def _salt() -> bytes:
    global _pepper_warned
    for key in ("CMW_IP_SALT", "EVENTS_ADMIN_TOKEN", "CRON_SECRET"):
        v = os.environ.get(key, "").strip()
        if len(v) >= 16:
            return v.encode()
    if not _pepper_warned:
        logger.warning("[cmw] no secret salt in the environment (CMW_IP_SALT); using the built-in pepper")
        _pepper_warned = True
    return _BUILT_IN_PEPPER.encode()


def salted_hash(value: str, scope: str) -> str:
    """HMAC-SHA256(salt, scope + value), 32 hex chars. The raw IP / contact is never stored."""
    return hmac.new(_salt(), f"{scope}:{value}".encode(), hashlib.sha256).hexdigest()[:32]


def _bearer(request: Request) -> Optional[str]:
    h = request.headers.get("authorization") or ""
    if h[:7].lower() == "bearer ":
        return h[7:].strip() or None
    return None


async def _session_user_id(db_: Any, request: Request) -> Optional[str]:
    """The signed-in user's id when the request carries a live session, else None. Never raises:
    a request is public, the session only lets delete_account purge the row later."""
    token = request.cookies.get("session_token") or _bearer(request)
    if not token or len(token) > 512:
        return None
    try:
        session = await db_.user_sessions.find_one({"session_token": token}, {"_id": 0})
        if not isinstance(session, Mapping):
            return None
        exp = gate.parse_iso(session.get("expires_at"))
        if exp is None or exp < datetime.now(timezone.utc):
            return None
        uid = session.get("user_id")
        return str(uid) if isinstance(uid, str) and uid else None
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] session lookup failed: %s", type(exc).__name__)
        return None


def _client_stamp(request: Request) -> str:
    raw = (request.headers.get("x-amo-client") or "web").strip()[:40]
    return _CLIENT_RE.sub("", raw) or "web"


_indexes_done = False


async def ensure_cmw_indexes(db_: Any = None) -> bool:
    """Idempotent. Each index in its own try so one failure never blocks the rest."""
    global _indexes_done
    if _indexes_done:
        return True
    d = db_ if db_ is not None else db
    if d is None:
        return False
    specs: List[Tuple[str, Any, Dict[str, Any]]] = [
        ("cmw_requests", "request_id", {"unique": True}),
        ("cmw_requests", "created_at_dt", {}),
        ("cmw_requests", "user_id", {"sparse": True}),
        ("cmw_overrides", "event_id", {"unique": True}),
        ("cmw_log", "at_dt", {}),
    ]
    ok = True
    for coll, keys, opts in specs:
        try:
            await getattr(d, coll).create_index(keys, **opts)
        except Exception as exc:  # noqa: BLE001
            ok = False
            logger.error("[cmw] create_index %s.%s failed: %s", coll, keys, type(exc).__name__)
    _indexes_done = ok
    return ok


def reset_indexes_flag() -> None:
    """Tests only."""
    global _indexes_done
    _indexes_done = False


def _one_line(v: Any) -> str:
    """A visitor-typed value on ONE alert line: whitespace (incl. newlines) collapsed and format /
    control characters dropped, so a note can never forge a 'Solicitud:' or 'Contacto:' line."""
    s = _FORMAT_RE.sub("", _CTRL_ALL_RE.sub(" ", str(v if v is not None else "")))
    return _WS_RE.sub(" ", s).strip()


def _alert_lines(row: Mapping[str, Any], *, personal: bool) -> List[str]:
    lines = [
        f"Solicitud: {row.get('request_id')}",
        f"Evento: {row.get('event_title')}" + (f" · {row.get('event_date')}" if row.get("event_date") else ""),
        f"Personas: {row.get('party_size')}",
        f"Idioma: {row.get('lang')}",
        f"Contacto por: {(row.get('contact') or {}).get('type')}",
    ]
    if personal:
        lines.append(f"Nombre: {_one_line(row.get('name'))}")
        lines.append(f"Contacto: {_one_line((row.get('contact') or {}).get('value'))}")
        if row.get("note"):
            lines.append(f"Nota: «{_one_line(row.get('note'))}»")
    else:
        lines.append("Datos de contacto: en /api/admin/cmw/requests")
    return lines


async def _guarded(label: str, coro: Any) -> bool:
    """Await one alert with a timeout. A failed alert never fails the request."""
    try:
        return bool(await asyncio.wait_for(coro, timeout=ALERT_TIMEOUT_S))
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] %s alert failed: %s", label, type(exc).__name__)
        return False


async def send_alerts(row: Mapping[str, Any]) -> Dict[str, bool]:
    """Telegram + admin email. The contact details go out only on a CONFIGURED channel: an
    unconfigured Telegram helper logs the text it was given, so it gets the redacted lines."""
    title = "CMW · nueva solicitud de concierge"
    try:
        tg_personal = telegram_alerts.configured()
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] telegram config check failed: %s", type(exc).__name__)
        tg_personal = False
    tg_text = "\n".join([title] + _alert_lines(row, personal=tg_personal))

    async def _tg() -> bool:
        res = await telegram_alerts.send(tg_text)
        return bool(isinstance(res, Mapping) and res.get("sent"))

    async def _mail() -> bool:
        return bool(await emails.send_admin_alert(
            subject=f"CMW · nueva solicitud {row.get('request_id')}", title=title,
            lines=_alert_lines(row, personal=True)))

    tg_ok, mail_ok = await asyncio.gather(_guarded("telegram", _tg()), _guarded("email", _mail()))
    return {"telegram": tg_ok, "email": mail_ok}


async def _rate_limit(key: str, max_calls: int) -> Optional[JSONResponse]:
    try:
        await ratelimit.check(key, max_calls=max_calls, window_sec=RATE_WINDOW_S)
    except HTTPException as exc:
        if exc.status_code == 429:
            return _fail(429, "rate_limited")
        return _fail(503, "unavailable")
    except Exception as exc:  # noqa: BLE001 — a limiter that cannot run fails closed
        logger.error("[cmw] rate limit check failed: %s", type(exc).__name__)
        return _fail(503, "unavailable")
    return None


async def create_request(db_: Any, body: Any, *, ip: str, user_id: Optional[str], client: str,
                         now: Optional[datetime] = None) -> Tuple[int, Dict[str, Any]]:
    """Validate, rate-limit, store, alert. Returns (http status, response body)."""
    if isinstance(body, Mapping) and isinstance(body.get("website"), str) and body["website"].strip():
        # Honeypot: nothing is stored, nothing is sent, and a person who somehow filled it is told
        # the truth (not sent) so the WhatsApp button is the next step.
        logger.warning("[cmw] request rejected: honeypot")
        return 400, {"data": None, "error": "invalid_request", "message": MSG["invalid_request"]}
    if isinstance(body, Mapping) and body.get("website") not in (None, ""):
        return 400, {"data": None, "error": "invalid_request", "message": MSG["invalid_request"]}
    try:
        program = await merged_program(db_)
    except ProgramError:
        return 503, {"data": None, "error": "unavailable", "message": MSG["unavailable"]}
    clean, code = validate_request(body, program)
    if clean is None:
        err = code or "invalid_request"
        return 422, {"data": None, "error": err, "message": MSG[err]}

    for key, limit in ((f"{RL_PREFIX_IP}:{salted_hash(ip, 'ip')}", RATE_PER_IP),
                       (f"{RL_PREFIX_CONTACT}:{salted_hash(clean['contact']['value'], 'contact')}", RATE_PER_CONTACT)):
        denied = await _rate_limit(key, limit)
        if denied is not None:
            return denied.status_code, json.loads(bytes(denied.body))

    await ensure_cmw_indexes(db_)
    ts = _now(now)
    event = clean["event"]
    row: Dict[str, Any] = {
        "event_id": clean["event_id"],
        "event_title": event["title"] if event else BRAND_NAME,
        "event_date": event.get("date") if event else None,
        "name": clean["name"],
        "party_size": clean["party_size"],
        "contact": clean["contact"],
        "note": clean["note"],
        "lang": clean["lang"],
        "user_id": user_id,
        "status": "received",
        "created_at": gate.iso_utc(ts),
        "created_at_dt": ts,
        "ip_hash": salted_hash(ip, "ip"),
        "client": client,
    }
    stored = False
    for _attempt in range(4):
        row["request_id"] = new_request_id()
        try:
            await db_.cmw_requests.insert_one(dict(row))
            stored = True
            break
        except DuplicateKeyError:
            continue
        except Exception as exc:  # noqa: BLE001
            logger.error("[cmw] request insert failed: %s", type(exc).__name__)
            break
    if not stored:
        return 503, {"data": None, "error": "unavailable", "message": MSG["unavailable"]}

    alerts = await send_alerts(row)
    try:
        await db_.cmw_requests.update_one({"request_id": row["request_id"]}, {"$set": {"alerts": alerts}})
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] alert outcome write failed: %s", type(exc).__name__)
    logger.info("[cmw] request stored: %s event=%s party=%s", row["request_id"], row["event_id"] or "general",
                row["party_size"])
    data = {
        "request_id": row["request_id"],
        "status": "received",
        "whatsapp_url": whatsapp_url(event, clean["lang"], party_size=clean["party_size"],
                                     request_id=row["request_id"], brand=program.get("brand")),
    }
    return 200, {"data": data, "error": None, "message": MSG["received"]}


# ── admin ────────────────────────────────────────────────────────────────────


def admin_guard(request: Request) -> Optional[JSONResponse]:
    """ONLY Authorization: Bearer EVENTS_ADMIN_TOKEN (events_elite's constant-time check).
    Never a cookie and never a user session, so a cross-site request can never carry it."""
    if _events_elite.is_events_admin_token(request):
        return None
    if _bearer(request) is None:
        return _fail(401, "unauthorized")
    return _fail(403, "forbidden")


async def _json_body(request: Request) -> Any:
    try:
        raw = await request.body()
        if not raw or len(raw) > MAX_BODY_BYTES:
            return None
        return json.loads(raw)
    except Exception:  # noqa: BLE001 — malformed body
        return None


async def _log(db_: Any, entry: Dict[str, Any], now: Optional[datetime] = None) -> None:
    ts = _now(now)
    try:
        await db_.cmw_log.insert_one({**entry, "at": gate.iso_utc(ts), "at_dt": ts, "actor": ADMIN_ACTOR})
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] log write failed: %s", type(exc).__name__)


async def patch_event(db_: Any, event_id: str, body: Any, *, now: Optional[datetime] = None
                      ) -> Tuple[int, Dict[str, Any]]:
    """Write one event's override (§2). A fact field needs a non-empty source_note; null clears
    a field back to the base; the merged program must still validate. Writes cmw_log."""
    def fail(status: int, code: str, data: Any = None) -> Tuple[int, Dict[str, Any]]:
        return status, {"data": data, "error": code, "message": MSG[code]}

    try:
        base = load_program()
    except ProgramError:
        return fail(503, "program_unavailable")
    if event_by_id(base, event_id) is None:
        return fail(404, "unknown_event")
    if not isinstance(body, Mapping):
        return fail(422, "no_fields")
    raw_fields = body.get("fields")
    fields: Dict[str, Any] = dict(raw_fields) if isinstance(raw_fields, Mapping) else \
        {k: body[k] for k in body if k not in ("source_note", "fields")}
    if not fields:
        return fail(422, "no_fields")
    unknown = sorted(str(k) for k in fields if k not in OVERRIDE_FIELDS)
    if unknown:
        return fail(422, "invalid_field", {"fields": unknown})
    note = _clean_text(body.get("source_note"), 1, 300) or ""
    if not note and any(k in FACT_FIELDS and v is not None for k, v in fields.items()):
        return fail(422, "source_note_required")

    rows, read_ok = await _read_overrides(db_)
    if not read_ok:
        return fail(503, "unavailable")
    existing = next((r for r in rows if r.get("event_id") == event_id), None) or {}
    others = [r for r in rows if r.get("event_id") != event_id]
    merged_fields: Dict[str, Any] = dict(existing.get("fields") or {}) if isinstance(existing.get("fields"), Mapping) else {}
    brand = base.get("brand") or {}
    try:
        for k, v in fields.items():
            if v is None:
                merged_fields.pop(k, None)
            else:
                merged_fields[k] = clean_override_value(k, v, brand)
    except OverrideError as exc:
        return fail(422, exc.code, {"fields": [exc.field]})
    venue_id = fields.get("venue_id")
    if venue_id is not None:
        try:
            hit = await db_.partners.find_one({**PUBLIC_PARTNER_FILTER, "partner_id": merged_fields["venue_id"]},
                                              {"_id": 0, "partner_id": 1})
        except Exception as exc:  # noqa: BLE001
            logger.error("[cmw] venue check failed: %s", type(exc).__name__)
            return fail(503, "unavailable")
        if not hit:
            return fail(422, "unknown_venue")
    kept_note = note or (existing.get("source_note") if isinstance(existing.get("source_note"), str) else "") or ""
    doc = {"event_id": event_id, "fields": merged_fields, "source_note": kept_note}
    before = event_by_id(apply_overrides(base, rows), event_id) or {}
    try:
        trial = apply_overrides(base, others + [doc], strict=True)
    except OverrideError as exc:
        return fail(422, exc.code, {"fields": [exc.field]})
    problems = validate_program(trial, base)
    if problems:
        return fail(422, "invalid_override", {"problems": problems[:10]})
    after = event_by_id(trial, event_id) or {}

    await ensure_cmw_indexes(db_)
    ts = _now(now)
    try:
        await db_.cmw_overrides.update_one(
            {"event_id": event_id},
            {"$set": {"fields": merged_fields, "source_note": kept_note, "updated_at": gate.iso_utc(ts),
                      "updated_by": ADMIN_ACTOR}},
            upsert=True)
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] override write failed: %s", type(exc).__name__)
        return fail(503, "unavailable")
    watched = list(OVERRIDE_FIELDS) + ["tba", "artist_status", "day_index"]
    changes = {k: {"from": before.get(k), "to": after.get(k)} for k in watched if before.get(k) != after.get(k)}
    await _log(db_, {"kind": "event_override", "event_id": event_id, "changes": changes,
                     "fields": sorted(fields), "source_note": note}, now)
    invalidate_cache()
    resolved = await resolve_venues(db_, {"events": [copy.deepcopy(after)]})
    return 200, {"data": {"event": resolved["events"][0], "changes": changes}, "error": None, "message": MSG["ok"]}


def _public_row(row: Mapping[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in dict(row).items() if k not in ("_id", "created_at_dt", "at_dt", "ip_hash")}


# ═════════════════════════════════════════════════════════════════════════════
# ROUTES
# ═════════════════════════════════════════════════════════════════════════════


@router.get("/cmw/program")
async def program_route(response: Response) -> Any:
    try:
        program = await merged_program(db)
    except ProgramError:
        return _fail(503, "program_unavailable")
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] program read failed: %s", type(exc).__name__)
        return _fail(503, "program_unavailable")
    if program.get("_degraded"):
        _cache(response, 30, swr=60)      # overrides unreadable: recover fast
    else:
        _cache(response, 300, swr=600)
    return _ok(public_program(program), MSG["ok"])


@router.post("/cmw/requests")
async def create_request_route(request: Request) -> Any:
    if db is None:
        return _fail(503, "unavailable")
    try:
        raw = await request.body()
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] request body read failed: %s", type(exc).__name__)
        return _fail(400, "invalid_request")
    if not raw or len(raw) > MAX_BODY_BYTES:
        return _fail(400, "invalid_request")
    try:
        body = json.loads(raw)
    except Exception:  # noqa: BLE001 — malformed JSON
        return _fail(400, "invalid_request")
    try:
        status, payload = await create_request(
            db, body, ip=ratelimit.client_ip(request), user_id=await _session_user_id(db, request),
            client=_client_stamp(request))
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] request failed: %s", type(exc).__name__)
        return _fail(503, "unavailable")
    return JSONResponse(status_code=status, content=payload, headers={"Cache-Control": "no-store"})


@router.get("/admin/cmw/requests")
async def admin_requests_route(request: Request) -> Any:
    denied = admin_guard(request)
    if denied is not None:
        return denied
    if db is None:
        return _fail(503, "unavailable")
    status = (request.query_params.get("status") or "").strip()
    if status and status not in REQUEST_STATUSES:
        return _fail(422, "invalid_status")
    try:
        limit = max(1, min(200, int(request.query_params.get("limit") or 100)))
    except ValueError:
        limit = 100
    try:
        query = {"status": status} if status else {}
        rows = await db.cmw_requests.find(query, {"_id": 0}).sort("created_at_dt", -1).limit(limit) \
            .to_list(length=limit)
        total = await db.cmw_requests.count_documents(query)
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] requests read failed: %s", type(exc).__name__)
        return _fail(503, "unavailable")
    data = {"requests": [_public_row(r) for r in rows], "count": len(rows), "total": total,
            "status": status or None}
    return JSONResponse(content=_ok(data, MSG["ok"]), headers={"Cache-Control": "no-store"})


@router.patch("/admin/cmw/requests/{request_id}")
async def admin_request_patch_route(request_id: str, request: Request) -> Any:
    denied = admin_guard(request)
    if denied is not None:
        return denied
    if db is None:
        return _fail(503, "unavailable")
    rid = request_id.strip().lower()
    if not REQUEST_ID_RE.match(rid):
        return _fail(404, "not_found")
    body = await _json_body(request)
    status = body.get("status") if isinstance(body, Mapping) else None
    if status not in REQUEST_STATUSES:
        return _fail(422, "invalid_status")
    ts = _now()
    try:
        before = await db.cmw_requests.find_one_and_update(
            {"request_id": rid},
            {"$set": {"status": status, "updated_at": gate.iso_utc(ts), "updated_by": ADMIN_ACTOR}},
            return_document=ReturnDocument.BEFORE)
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] request status write failed: %s", type(exc).__name__)
        return _fail(503, "unavailable")
    if not isinstance(before, Mapping):
        return _fail(404, "not_found")
    await _log(db, {"kind": "request_status", "request_id": rid, "changes":
                    {"status": {"from": before.get("status"), "to": status}}})
    return JSONResponse(content=_ok({"request_id": rid, "status": status}, MSG["ok"]),
                        headers={"Cache-Control": "no-store"})


@router.patch("/admin/cmw/events/{event_id}")
async def admin_event_patch_route(event_id: str, request: Request) -> Any:
    denied = admin_guard(request)
    if denied is not None:
        return denied
    if db is None:
        return _fail(503, "unavailable")
    body = await _json_body(request)
    try:
        status, payload = await patch_event(db, event_id.strip(), body)
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] event override failed: %s", type(exc).__name__)
        return _fail(503, "unavailable")
    return JSONResponse(status_code=status, content=json.loads(json.dumps(payload, default=str)),
                        headers={"Cache-Control": "no-store"})


@router.get("/admin/cmw/log")
async def admin_log_route(request: Request) -> Any:
    denied = admin_guard(request)
    if denied is not None:
        return denied
    if db is None:
        return _fail(503, "unavailable")
    try:
        limit = max(1, min(200, int(request.query_params.get("limit") or 100)))
    except ValueError:
        limit = 100
    try:
        rows = await db.cmw_log.find({}, {"_id": 0}).sort("at_dt", -1).limit(limit).to_list(length=limit)
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] log read failed: %s", type(exc).__name__)
        return _fail(503, "unavailable")
    return JSONResponse(content=_ok({"log": [_public_row(r) for r in rows], "count": len(rows)}, MSG["ok"]),
                        headers={"Cache-Control": "no-store"})


__all__: Sequence[str] = (
    "router", "init", "load_program", "validate_program", "apply_overrides", "merged_program",
    "public_program", "whatsapp_text", "whatsapp_url", "ensure_cmw_indexes", "create_request", "patch_event",
    "events_on", "event_by_id", "phase", "window", "day_label", "range_label", "bogota_date",
)

_ = timedelta  # re-exported for luna_cmw's day arithmetic
