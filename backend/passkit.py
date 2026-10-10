"""passkit.py — Apple Wallet companion pass + calendar file for a ticket.

A FREE RSVP ticket (backend/tickets.py) gets two Apple-device conveniences:

  GET /tickets/{id}/wallet-url      (holder session)  → short-lived signed URLs
  GET /tickets/{id}/pass.pkpass?e&t (signed URL)      → signed Apple Wallet pass
  GET /tickets/{id}/calendar.ics?e&t(signed URL)      → calendar event (any phone)

HONESTY SPINE (PALCO doctrine): the Wallet pass is a COMPANION, not a
credential. It carries the event, the holder and a deep link back to the live
rotating QR — it deliberately has NO door barcode, because a static barcode
would be a screenshot-shareable credential class the PALCO engine exists to
prevent. If a scannable Wallet tier is ever wanted, that is a credential-
surface decision (new namespace, scanner support, revocation) — not a tweak.

Why signed URLs: Safari / Wallet fetch the .pkpass as a plain navigation and
carry no Bearer. The holder's session mints `t = HMAC(PKPASS_URL_SECRET,
kind|ticket_id|e)` with a 15-minute `e`; the download endpoints verify it
byte-compared (hmac.compare_digest over encoded bytes) and re-read the ticket.
Fail closed: missing env answers an honest 503, never an unsigned pass.

Signing identity (set in Vercel env, never in the repo):
  PKPASS_CERT_PEM  — Pass Type ID cert  (pass.com.amocartagena.app, ASC C4HAX4H5Z2)
  PKPASS_KEY_PEM   — its private key
  PKPASS_WWDR_PEM  — Apple WWDR G4 intermediate
  PKPASS_URL_SECRET— HMAC key for the short-lived URLs
"""
from __future__ import annotations

import hashlib
import hmac as _hmac
import io
import json
import logging
import os
import re as _re
import time as _time
import zipfile
from typing import Any, Dict, Mapping, Optional

from fastapi import APIRouter, HTTPException, Request, Response

logger = logging.getLogger(__name__)

router = APIRouter()

PASS_TYPE_ID = "pass.com.amocartagena.app"
TEAM_ID = "4C39DXRG9L"
APP_STORE_ID = 6809565354
ORG_NAME = "Amo Cartagena S.A.S."
URL_TTL_SECONDS = 900  # 15 min: long enough for "tap → Wallet sheet", short enough to not be a shareable link
_TICKET_ID_RE = _re.compile(r"^amt_[a-f0-9]{10}$")
_ASSET_DIR = os.path.join(os.path.dirname(__file__), "data", "pass_assets")
_ASSET_NAMES = ("icon.png", "icon@2x.png", "icon@3x.png", "logo.png", "logo@2x.png")

db: Any = None


def init(db_: Any) -> None:
    global db
    db = db_


async def _user(request: Request) -> Dict[str, Any]:
    from server import get_current_user
    return await get_current_user(request)


async def _rl(request: Request, bucket: str, max_calls: int, window: int,
              subject: Optional[str] = None) -> None:
    try:
        from server import _check_rate_limit, _client_ip
        key = subject or _client_ip(request)
        await _check_rate_limit(f"{bucket}:{key}", max_calls=max_calls, window_sec=window)
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001
        pass


# ── signed-URL token ──────────────────────────────────────────────────────────

def _url_secret() -> Optional[str]:
    return os.environ.get("PKPASS_URL_SECRET") or None


def _token(kind: str, ticket_id: str, exp: int) -> str:
    secret = _url_secret()
    if not secret:
        raise HTTPException(status_code=503, detail={
            "error": "unavailable",
            "message": "No disponible por ahora / Not available right now"})
    msg = f"{kind}|{ticket_id}|{exp}"
    return _hmac.new(secret.encode(), msg.encode(), hashlib.sha256).hexdigest()[:40]


def _check_token(kind: str, ticket_id: str, e: str, t: str) -> None:
    """Validates exp + HMAC. Every refusal is the same 403 (no oracle between
    expired, forged and missing-secret beyond the 503 the mint already gave)."""
    refused = HTTPException(status_code=403, detail={
        "error": "forbidden",
        "message": "Enlace vencido o inválido / Link expired or invalid"})
    if not _url_secret():
        raise HTTPException(status_code=503, detail={
            "error": "unavailable",
            "message": "No disponible por ahora / Not available right now"})
    if not e.isdigit():
        raise refused
    exp = int(e)
    if exp < int(_time.time()):
        raise refused
    expected = _token(kind, ticket_id, exp)
    # compare_digest over ENCODED bytes (audit 2026-10-09: non-ASCII str inputs raised → 500).
    if not _hmac.compare_digest(expected.encode(), (t or "").encode()):
        raise refused


def _signing_env() -> Optional[Dict[str, bytes]]:
    cert = os.environ.get("PKPASS_CERT_PEM")
    key = os.environ.get("PKPASS_KEY_PEM")
    wwdr = os.environ.get("PKPASS_WWDR_PEM")
    if not (cert and key and wwdr):
        return None
    return {"cert": cert.encode(), "key": key.encode(), "wwdr": wwdr.encode()}


def _backend_base() -> str:
    return (os.environ.get("BACKEND_PUBLIC_URL") or "https://backend-mu-one-74.vercel.app").rstrip("/")


# ── the pass itself ───────────────────────────────────────────────────────────

def build_pass_json(t: Mapping[str, Any], lang_hint: str = "es") -> Dict[str, Any]:
    """pass.json for one ticket. Pure (unit-tested): no I/O, no clock."""
    title = (t.get("title") or "Evento AMO").strip()
    venue = (t.get("venue_name") or t.get("partner_name") or "").strip()
    holder = (t.get("holder_name") or "").strip()
    date = (t.get("date") or "").strip()
    start = (t.get("start_time") or "").strip()
    ticket_id = t["ticket_id"]
    used = t.get("status") == "used"

    secondary = []
    if venue:
        secondary.append({"key": "venue", "label": "LUGAR", "value": venue})
    if date:
        human = date + (f" · {start}" if start else "")
        secondary.append({"key": "when", "label": "FECHA", "value": human})
    aux = []
    if holder:
        aux.append({"key": "holder", "label": "INVITADO", "value": holder})
    aux.append({"key": "kind", "label": "TIPO", "value": "Entrada gratuita · RSVP"})

    pass_json: Dict[str, Any] = {
        "formatVersion": 1,
        "passTypeIdentifier": PASS_TYPE_ID,
        "teamIdentifier": TEAM_ID,
        "serialNumber": ticket_id,
        "organizationName": ORG_NAME,
        "description": f"Entrada AMO Life · {title}",
        "logoText": "AMO LIFE",
        "foregroundColor": "rgb(255,255,255)",
        "backgroundColor": "rgb(11,16,32)",
        "labelColor": "rgb(18,181,165)",
        "associatedStoreIdentifiers": [APP_STORE_ID],
        "eventTicket": {
            "primaryFields": [{"key": "event", "label": "EVENTO", "value": title}],
            "secondaryFields": secondary,
            "auxiliaryFields": aux,
            "backFields": [
                {"key": "qr", "label": "Código de acceso / Door code",
                 "value": ("Tu código QR vivo rota cada 10 segundos dentro de AMO — "
                           "ábrelo en la app o en "
                           f"https://www.amocartagena.co/ticket/{ticket_id} . "
                           "Your live QR rotates every 10 s inside AMO; this pass is "
                           "your event companion, not the door code.")},
                {"key": "tid", "label": "Entrada / Ticket", "value": ticket_id},
                {"key": "site", "label": "AMO Life", "value": "https://www.amocartagena.co"},
            ],
        },
    }
    if date and _re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        hhmm = start if _re.fullmatch(r"\d{2}:\d{2}", start) else "20:00"
        pass_json["relevantDate"] = f"{date}T{hhmm}:00-05:00"  # Cartagena is UTC-5 all year
    if used:
        pass_json["voided"] = True
    return pass_json


def build_pkpass(pass_json: Mapping[str, Any], signing: Mapping[str, bytes]) -> bytes:
    """Zip + SHA-1 manifest + detached PKCS#7 (SHA-256) per the PassKit package spec."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.serialization import pkcs7

    files: Dict[str, bytes] = {
        "pass.json": json.dumps(pass_json, ensure_ascii=False, separators=(",", ":")).encode()}
    for name in _ASSET_NAMES:
        path = os.path.join(_ASSET_DIR, name)
        with open(path, "rb") as fh:
            files[name] = fh.read()
    manifest = json.dumps(
        {name: hashlib.sha1(data).hexdigest() for name, data in files.items()},  # noqa: S324 — PassKit spec mandates SHA-1 file digests
        separators=(",", ":")).encode()

    cert = x509.load_pem_x509_certificate(signing["cert"])
    key = serialization.load_pem_private_key(signing["key"], password=None)
    wwdr = x509.load_pem_x509_certificate(signing["wwdr"])
    signature = (
        pkcs7.PKCS7SignatureBuilder()
        .set_data(manifest)
        .add_signer(cert, key, hashes.SHA256())
        .add_certificate(wwdr)
        .sign(serialization.Encoding.DER,
              [pkcs7.PKCS7Options.DetachedSignature, pkcs7.PKCS7Options.Binary])
    )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)
        z.writestr("manifest.json", manifest)
        z.writestr("signature", signature)
    return buf.getvalue()


# ── the calendar file ─────────────────────────────────────────────────────────

def _ics_escape(v: str) -> str:
    return v.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def build_ics(t: Mapping[str, Any]) -> Optional[str]:
    """VCALENDAR for one ticket; None when the event published no usable date.
    Cartagena is UTC-5 with no DST, so instants are emitted directly in UTC —
    no VTIMEZONE needed and every client agrees."""
    date = (t.get("date") or "").strip()
    m = _re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", date)
    if not m:
        return None
    start = (t.get("start_time") or "").strip()
    title = (t.get("title") or "Evento AMO").strip()
    venue = (t.get("venue_name") or t.get("partner_name") or "").strip()
    ticket_id = t["ticket_id"]
    ymd = date.replace("-", "")

    if _re.fullmatch(r"\d{2}:\d{2}", start):
        hh, mm = int(start[:2]), int(start[3:])
        from datetime import datetime, timedelta, timezone
        begin = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)), hh, mm,
                         tzinfo=timezone(timedelta(hours=-5))).astimezone(timezone.utc)
        end = begin + timedelta(hours=3)
        fmt = "%Y%m%dT%H%M%SZ"
        dt_lines = [f"DTSTART:{begin.strftime(fmt)}", f"DTEND:{end.strftime(fmt)}"]
    else:
        from datetime import date as _d, timedelta
        day = _d(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        nxt = (day + timedelta(days=1)).strftime("%Y%m%d")
        dt_lines = [f"DTSTART;VALUE=DATE:{ymd}", f"DTEND;VALUE=DATE:{nxt}"]

    loc = f"{venue}, Cartagena de Indias, Colombia" if venue else "Cartagena de Indias, Colombia"
    desc = (f"Entrada AMO Life (gratuita). Tu código QR vivo: "
            f"https://www.amocartagena.co/ticket/{ticket_id}")
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AMO Life//Tickets//ES",
        "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
        f"UID:{ticket_id}@amocartagena.co", *dt_lines,
        f"SUMMARY:{_ics_escape(title)}",
        f"LOCATION:{_ics_escape(loc)}",
        f"DESCRIPTION:{_ics_escape(desc)}",
        f"URL:https://www.amocartagena.co/ticket/{ticket_id}",
        "END:VEVENT", "END:VCALENDAR",
    ]
    return "\r\n".join(lines) + "\r\n"


# ── routes ────────────────────────────────────────────────────────────────────

async def _own_ticket_or_404(ticket_id: str, user_id: str) -> Dict[str, Any]:
    not_found = HTTPException(status_code=404, detail={
        "error": "not_found", "message": "Entrada no encontrada / Ticket not found"})
    if not _TICKET_ID_RE.fullmatch(ticket_id or ""):
        raise not_found
    doc = await db.amo_tickets.find_one({"ticket_id": ticket_id, "user_id": user_id},
                                        {"_id": 0, "qr_secret": 0})
    if not doc:
        raise not_found
    return doc


@router.get("/tickets/{ticket_id}/wallet-url")
async def ticket_wallet_url(ticket_id: str, request: Request):
    """Holder-only mint of the short-lived download URLs. pass_url is null (not an
    error) while the signing identity is not configured — the client hides the button."""
    user = await _user(request)
    await _rl(request, "tktwallet", 30, 60, subject=user["user_id"])
    await _own_ticket_or_404(ticket_id, user["user_id"])
    exp = int(_time.time()) + URL_TTL_SECONDS
    base = _backend_base()
    ics_url = (f"{base}/api/tickets/{ticket_id}/calendar.ics"
               f"?e={exp}&t={_token('ics', ticket_id, exp)}")
    pass_url = None
    if _signing_env() is not None:
        pass_url = (f"{base}/api/tickets/{ticket_id}/pass.pkpass"
                    f"?e={exp}&t={_token('pass', ticket_id, exp)}")
    return {"pass_url": pass_url, "ics_url": ics_url, "expires_in": URL_TTL_SECONDS}


@router.get("/tickets/{ticket_id}/pass.pkpass")
async def ticket_pkpass(ticket_id: str, e: str = "", t: str = "", request: Request = None):  # type: ignore[assignment]
    if request is not None:
        await _rl(request, "tktpkpass", 30, 60)
    if not _TICKET_ID_RE.fullmatch(ticket_id or ""):
        raise HTTPException(status_code=404, detail={
            "error": "not_found", "message": "Entrada no encontrada / Ticket not found"})
    _check_token("pass", ticket_id, e, t)
    signing = _signing_env()
    if signing is None:
        raise HTTPException(status_code=503, detail={
            "error": "unavailable",
            "message": "No disponible por ahora / Not available right now"})
    doc = await db.amo_tickets.find_one({"ticket_id": ticket_id}, {"_id": 0, "qr_secret": 0})
    if not doc:
        raise HTTPException(status_code=404, detail={
            "error": "not_found", "message": "Entrada no encontrada / Ticket not found"})
    try:
        blob = build_pkpass(build_pass_json(doc), signing)
    except Exception as exc:  # noqa: BLE001 — a mis-set PEM must be a clean 503, never a leak
        logger.error("[passkit] pkpass build failed: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail={
            "error": "unavailable",
            "message": "No disponible por ahora / Not available right now"})
    return Response(
        content=blob,
        media_type="application/vnd.apple.pkpass",
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": f'attachment; filename="amo-life-{ticket_id}.pkpass"',
        })


@router.get("/tickets/{ticket_id}/calendar.ics")
async def ticket_ics(ticket_id: str, e: str = "", t: str = "", request: Request = None):  # type: ignore[assignment]
    if request is not None:
        await _rl(request, "tktics", 30, 60)
    if not _TICKET_ID_RE.fullmatch(ticket_id or ""):
        raise HTTPException(status_code=404, detail={
            "error": "not_found", "message": "Entrada no encontrada / Ticket not found"})
    _check_token("ics", ticket_id, e, t)
    doc = await db.amo_tickets.find_one({"ticket_id": ticket_id}, {"_id": 0, "qr_secret": 0})
    if not doc:
        raise HTTPException(status_code=404, detail={
            "error": "not_found", "message": "Entrada no encontrada / Ticket not found"})
    ics = build_ics(doc)
    if ics is None:
        raise HTTPException(status_code=409, detail={
            "error": "no_date",
            "message": "Este evento no publicó fecha / This event published no date"})
    return Response(
        content=ics,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": f'inline; filename="amo-life-{ticket_id}.ics"',
        })
