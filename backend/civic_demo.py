"""civic_demo.py — the government-pitch civic payments DEMO.

Contract: docs/civic-demo/DESIGN.md (the doc wins). This is a DEMONSTRATION for
the Alcaldía/entidades — no real money moves, every payload carries demo:true,
and the model it demonstrates is: EACH PUBLIC ENTITY is the merchant of record
for ITS OWN line (Corpoturismo the pier, Parques Nacionales the park entry,
Transcaribe S.A. the recharge, ETCAR the Castillo, the cocheros' association the
carriage ride) — AMO is the technology channel that issues the QR credential.
The retired public port-tax product stays retired; Luna never mentions this
area; fares quoted here come ONLY from city_modules.json facts (HIGH = decree-
cited, VERIFY = hedged), never invented, and the word "tasa" is never used.

ACCESS (fail-closed, two layers): env CIVIC_DEMO_ENABLED must be "1" or every
route 404s, AND every call requires the Alcaldía demo/government BUSINESS
session (server._require_alcaldia_view — the same short-lived passcode session
the KPI overview uses). The demo is reached by pitch, not discovery.

Security: the credential is the PALCO-proven dynamic QR (palco-core lib/qr.ts),
ported byte-identically — wire `AMOCIV1.<ticketId>.<counter>.<token>`, counter =
floor(epoch/10 s), token = hex(HMAC-SHA256(secret, "ticketId|counter"))[:12],
gate skew ±1 step, so a screenshot dies in ≤ 20 s. Cross-runtime vector proven:
py == node == 5d22f5379637 for ("tkt_demo1","s3cret",178080000). Verdicts keep
PALCO's gate language — VALIDO / DUPLICADO / FALSIFICADO / EXPIRADO — plus
RECIBO for recharge receipts (a receipt verifies but never "admits": Transcaribe
validation belongs to its fare concession, which the demo does NOT simulate).
Duplicates are decided ATOMICALLY (one find_one_and_update flips issued→used
exactly once, credentials only). Secrets never leave the server: the client
polls /qr per step and renders the wire; the validador screen "scans"
server-side (simulate mode) because it ships no camera UI — the consumer door
scanner (/business/scanner) does carry a live camera, this demo keeps the
server-derived path. Production hardening documented in the pitch: Ed25519
(PALCO2) — gates verify, never forge.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import secrets as _secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

import json

logger = logging.getLogger(__name__)

router = APIRouter()

import qr_credential as _qc

WIRE_VERSION = "AMOCIV1"
TOKEN_STEP_SECONDS = _qc.TOKEN_STEP_SECONDS
TOKEN_SKEW_STEPS = _qc.TOKEN_SKEW_STEPS
TOKEN_LEN = _qc.TOKEN_LEN
TICKET_TTL_H = 48
MAX_LIVE_PER_IP = 10
TICKET_ID_RE = re.compile(r"^civ_[a-f0-9]{10}$")
RECHARGE_AMOUNTS = (10000, 20000, 30000, 50000)  # min = the official PSE minimum

DISCLAIMER = {
    "es": ("Demostración — ningún pago es real. En el modelo propuesto, cada entidad "
           "(Corpoturismo, Parques Nacionales, ETCAR, Transcaribe S.A.) es el comercio y "
           "recauda en su propia cuenta; Amo Cartagena S.A.S. actúa solo como canal "
           "tecnológico y emite la credencial QR. Hoy no existe ningún convenio firmado "
           "con estas entidades."),
    "en": ("Demonstration — no payment is real. In the proposed model, each entity "
           "(Corpoturismo, National Parks, ETCAR, Transcaribe S.A.) is the merchant and "
           "collects into its own account; Amo Cartagena S.A.S. acts only as the "
           "technology channel and issues the QR credential. No agreement with these "
           "entities exists today."),
}

db: Any = None
_indexed = False


def init(db_: Any) -> None:
    global db
    db = db_


def _enabled() -> bool:
    return (os.environ.get("CIVIC_DEMO_ENABLED") or "").strip() == "1"


def _off() -> HTTPException:  # fail closed as a plain 404 — not discoverable
    return HTTPException(status_code=404, detail={"error": "not_found", "message": "No encontrado / Not found"})


async def _require_demo(request: Request) -> Dict[str, Any]:
    """Two-layer gate: env flag (404 when off) + the Alcaldía demo/government
    business session (401/403 from server's own gate)."""
    if not _enabled():
        raise _off()
    from server import _require_alcaldia_view
    return await _require_alcaldia_view(request)


async def ensure_indexes() -> None:
    try:
        await db.civic_demo_tickets.create_index("expires_at", expireAfterSeconds=0)
        await db.civic_demo_tickets.create_index("ticket_id", unique=True)
        await db.civic_demo_scans.create_index("expires_at", expireAfterSeconds=0)
    except Exception as exc:  # noqa: BLE001
        logger.error("[civic] index ensure failed: %s", type(exc).__name__)


async def _ensure_indexed() -> None:
    global _indexed
    if _indexed:
        return
    _indexed = True
    await ensure_indexes()


# ── city-module facts (single fare owner; mtime cache like server._city_modules) ──

_CITY_PATH = Path(__file__).resolve().parent / "data" / "city_modules.json"
_city_cache: Dict[str, Any] = {"mtime": None, "data": None}


def _city() -> Dict[str, Any]:
    try:
        mtime = os.path.getmtime(_CITY_PATH)
        if _city_cache["data"] is None or _city_cache["mtime"] != mtime:
            with open(_CITY_PATH, "r", encoding="utf-8") as f:
                _city_cache["data"] = json.load(f)
            _city_cache["mtime"] = mtime
    except Exception as exc:  # noqa: BLE001
        logger.error("[civic] city modules load failed: %s", type(exc).__name__)
    return _city_cache["data"] or {}


def _fact(module_id: str, key: str) -> Optional[Dict[str, Any]]:
    for m in _city().get("modules") or []:
        if m.get("id") == module_id:
            for f in m.get("facts") or []:
                if f.get("key") == key:
                    return {"key": key, "label": f.get("label"), "value_cop": f.get("value_cop"),
                            "confidence": f.get("confidence"), "source_name": f.get("source_name"),
                            "last_verified": f.get("last_verified")}
    return None


# ── service registry (§2): each LINE names its own collecting entity ──────────
# mode: pay | recharge (receipt, never an access credential) | info | soon | amo.
M_CORPO = {"es": "Corpoturismo (corporación de derecho privado)", "en": "Corpoturismo (private-law corporation)"}
M_PNN = {"es": "Parques Nacionales Naturales", "en": "National Natural Parks"}
M_SEGURO = {"es": "Aseguradora autorizada", "en": "Authorized insurer"}
M_TRANSCARIBE = {"es": "Transcaribe S.A. (recaudo vía su concesionario)", "en": "Transcaribe S.A. (collection via its concessionaire)"}
M_ETCAR = {"es": "ETCAR — Escuela Taller Cartagena", "en": "ETCAR — Escuela Taller Cartagena"}
M_COCHEROS = {"es": "Asociación de Cocheros", "en": "Carriage drivers' association"}

SERVICES: List[Dict[str, Any]] = [
    {
        "key": "muelle", "module": "muelle-bodeguita", "mode": "pay", "icon": "boat-outline",
        "title": {"es": "Tarifa de uso de muelle + ingreso PNN (islas)", "en": "Pier use fee + National Park entry (islands)"},
        "items": [
            {"fact": "pier_fee_2026", "required": True, "merchant": M_CORPO},
            {"fact": "pnn_entry_fee_2026", "required": True, "merchant": M_PNN},
            {"fact": "insurance_price", "required": False, "option": "insurance", "merchant": M_SEGURO},
        ],
    },
    {
        "key": "transcaribe", "module": "transcaribe", "mode": "recharge", "icon": "bus-outline",
        "title": {"es": "Recarga Transcaribe (comprobante)", "en": "Transcaribe top-up (receipt)"},
        "merchant": M_TRANSCARIBE,
        "amounts": list(RECHARGE_AMOUNTS),
        "min_fact": "recharge_pse",
    },
    {
        "key": "monumentos", "module": "monumentos", "mode": "pay", "icon": "business-outline",
        "title": {"es": "Castillo San Felipe — boleta", "en": "Castillo San Felipe — ticket"},
        "merchant": M_ETCAR,
        "tiers": ["castillo_tarifa_plena", "castillo_tarifa_nacionales", "castillo_tarifa_reducida"],
    },
    {
        "key": "coches", "module": "coches-electricos", "mode": "pay", "icon": "sparkles-outline",
        "title": {"es": "Coches eléctricos — paseo", "en": "Electric carriages — ride"},
        "merchant": M_COCHEROS,
        "tiers": ["fare_short_low", "fare_short_high", "fare_long_low", "fare_long_high"],
    },
    {
        "key": "taxis", "module": "taxis", "mode": "info", "icon": "car-outline",
        "title": {"es": "Taxi — tarifas oficiales 2026", "en": "Taxi — official 2026 fares"},
        "merchant": {"es": "DATT — tarifas fijas; pago directo al conductor", "en": "DATT — fixed fares; paid to the driver"},
        "items": [{"fact": "taxi_minimum", "required": True}, {"fact": "taxi_airport_centro", "required": True}],
    },
    {
        "key": "acuatico", "module": "transcaribe-acuatico", "mode": "soon", "icon": "water-outline",
        "title": {"es": "Transporte acuático (próximamente)", "en": "Aquatic transit (coming soon)"},
        "merchant": {"es": "Distrito — piloto en estructuración", "en": "District — pilot under structuring"},
        "items": [],
    },
    {
        "key": "citypass", "module": None, "mode": "amo", "icon": "card-outline",
        "title": {"es": "City Pass AMO", "en": "AMO City Pass"},
        "merchant": {"es": "AMO Life (producto propio, no municipal)", "en": "AMO Life (our own product, not municipal)"},
        "items": [],
    },
]


def _service(key: str) -> Optional[Dict[str, Any]]:
    return next((s for s in SERVICES if s["key"] == key), None)


def _resolved_service(s: Mapping[str, Any]) -> Dict[str, Any]:
    out = {k: s.get(k) for k in ("key", "mode", "icon", "title", "module", "merchant", "amounts")}
    out["facts"] = []
    for it in s.get("items") or []:
        f = _fact(s["module"], it["fact"]) if s.get("module") else None
        if f:
            out["facts"].append({**f, "required": it.get("required", True),
                                 "option": it.get("option"), "merchant": it.get("merchant")})
    if s.get("tiers"):
        out["tiers"] = [t for t in (_fact(s["module"], k) for k in s["tiers"]) if t]
    if s.get("min_fact") and s.get("module"):
        out["min_fact"] = _fact(s["module"], s["min_fact"])
    return out


# ── PALCO1 derivation — thin wrappers over the SHARED engine (qr_credential.py),
# so the civic demo, consumer tickets and the City Pass can never drift apart. ──

def counter_for_now(now_ms=None) -> int:
    return _qc.counter_for_now(now_ms)


def step_remaining_ms(now_ms=None) -> int:
    return _qc.step_remaining_ms(now_ms)


def derive_token(ticket_id: str, secret: str, counter: int) -> str:
    return _qc.derive_token(ticket_id, secret, counter)


def build_wire(ticket_id: str, secret: str, now_ms=None) -> str:
    return _qc.build_wire(WIRE_VERSION, ticket_id, secret, now_ms)


def parse_wire(payload: str):
    p = _qc.parse_wire(WIRE_VERSION, payload)
    if p is None:
        return None
    return {"ticket_id": p["entity_id"], "counter": p["counter"], "token": p["token"]}


# ── helpers ───────────────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _ip_hash(request: Request) -> str:
    try:
        from server import _client_ip
        ip = _client_ip(request)
    except Exception:  # noqa: BLE001
        ip = request.client.host if request.client else "?"
    pepper = os.environ.get("EVENTS_ADMIN_TOKEN") or os.environ.get("CRON_SECRET") or "civic-demo"
    return hashlib.sha256(f"{pepper}|{ip}".encode()).hexdigest()[:16]


async def _rl(request: Request, bucket: str, max_calls: int, window: int) -> None:
    try:
        from server import _check_rate_limit, _client_ip
        await _check_rate_limit(f"{bucket}:{_client_ip(request)}", max_calls=max_calls, window_sec=window)
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001
        pass


def _public_ticket(doc: Mapping[str, Any]) -> Dict[str, Any]:
    return {k: doc.get(k) for k in ("ticket_id", "service", "kind", "title", "merchant", "lines",
                                    "amount_cop", "status", "created_at", "expires_at",
                                    "used_at", "demo")}


# ── routes (every one: env flag 404 → alcaldía/government session) ───────────

@router.get("/civic/demo/services")
async def civic_services(request: Request, response: Response):
    await _rl(request, "civic", 120, 60)
    await _require_demo(request)
    response.headers["Cache-Control"] = "no-store"
    return {"demo": True, "disclaimer": DISCLAIMER,
            "services": [_resolved_service(s) for s in SERVICES],
            "security": {"scheme": "AMOCIV1 (HMAC-SHA256 rotante, paso 10 s, tolerancia ±1)",
                         "production": "Ed25519 — el punto de control verifica y no puede falsificar (PALCO2, probado en producción)"}}


class IssueBody(BaseModel):
    service: str
    tier: Optional[str] = None
    amount_cop: Optional[int] = Field(default=None, ge=1, le=10_000_000)
    insurance: bool = False


@router.post("/civic/demo/tickets")
async def civic_issue(body: IssueBody, request: Request):
    await _rl(request, "civicissue", 20, 60)
    await _require_demo(request)
    await _ensure_indexed()
    s = _service(body.service)
    if s is None or s.get("mode") not in ("pay", "recharge"):
        raise HTTPException(status_code=400, detail={"error": "invalid_service",
                                                     "message": "Servicio no disponible en la demo / Service not available in the demo"})
    iph = _ip_hash(request)
    try:
        # Credentials only: a receipt never flips to used, so counting receipts would
        # clog the cap for its whole 48 h TTL after a couple of recharge demos.
        live = await db.civic_demo_tickets.count_documents(
            {"ip_hash": iph, "status": "issued", "kind": "credential"})
    except Exception as exc:  # noqa: BLE001
        logger.error("[civic] live count failed: %s", type(exc).__name__)
        live = 0
    if live >= MAX_LIVE_PER_IP:
        raise HTTPException(status_code=429, detail={"error": "too_many_demo_tickets",
                                                     "message": "Límite de boletas demo alcanzado / Demo ticket limit reached"})

    lines: List[Dict[str, Any]] = []
    total = 0
    kind = "credential"
    if s.get("mode") == "recharge":
        kind = "receipt"
        amount = int(body.amount_cop or 0)
        if amount not in (s.get("amounts") or []):
            raise HTTPException(status_code=400, detail={
                "error": "invalid_amount",
                "message": "Monto de recarga inválido (mínimo oficial PSE: COP 10.000) / Invalid top-up amount (official PSE minimum: COP 10,000)"})
        ref = _fact(s["module"], s.get("min_fact") or "") or {}
        lines.append({"key": "recharge", "label": {"es": "Recarga de tarjeta Transcaribe", "en": "Transcaribe card top-up"},
                      "value_cop": amount, "confidence": ref.get("confidence") or "HIGH",
                      "source_name": ref.get("source_name"), "last_verified": ref.get("last_verified"),
                      "merchant": s.get("merchant"), "qty": 1, "subtotal_cop": amount})
        total = amount
    elif s.get("tiers"):
        tier_key = body.tier if body.tier in (s.get("tiers") or []) else s["tiers"][0]
        f = _fact(s["module"], tier_key)
        if not f or f.get("value_cop") in (None, 0):
            raise HTTPException(status_code=400, detail={"error": "invalid_tier", "message": "Tarifa inválida / Invalid tier"})
        lines.append({**f, "merchant": s.get("merchant"), "qty": 1, "subtotal_cop": int(f["value_cop"])})
        total = int(f["value_cop"])
    else:
        for it in s.get("items") or []:
            f = _fact(s["module"], it["fact"])
            if not f or f.get("value_cop") is None:
                continue
            if it.get("option") == "insurance" and not body.insurance:
                continue
            lines.append({**f, "merchant": it.get("merchant"), "qty": 1, "subtotal_cop": int(f["value_cop"])})
            total += int(f["value_cop"])
    if total <= 0 or not lines:
        raise HTTPException(status_code=400, detail={"error": "empty", "message": "Nada que cobrar / Nothing to charge"})

    now = _now()
    doc = {
        "ticket_id": f"civ_{_secrets.token_hex(5)}",
        "demo": True,
        "service": s["key"],
        "kind": kind,
        "title": s["title"],
        "merchant": s.get("merchant"),
        "lines": lines,
        "amount_cop": total,
        "qr_secret": _secrets.token_hex(16),
        "status": "issued",
        "created_at": _iso(now),
        "expires_at": now + timedelta(hours=TICKET_TTL_H),
        "used_at": None,
        "ip_hash": iph,
    }
    await db.civic_demo_tickets.insert_one(dict(doc))
    return {"demo": True, "disclaimer": DISCLAIMER, "ticket": _public_ticket(doc)}


@router.get("/civic/demo/tickets")
async def civic_tickets_live(request: Request, response: Response, live: int = 1):
    """The validator's 'boletas vivas' list — no secrets, session-gated."""
    await _rl(request, "civic", 120, 60)
    await _require_demo(request)
    response.headers["Cache-Control"] = "no-store"
    q = {"status": "issued"} if live == 1 else {}
    try:
        rows = await db.civic_demo_tickets.find(q, {"_id": 0, "qr_secret": 0, "ip_hash": 0}).sort("created_at", -1).to_list(50)
    except Exception as exc:  # noqa: BLE001
        logger.error("[civic] live list failed: %s", type(exc).__name__)
        rows = []
    return {"demo": True, "tickets": [_public_ticket(r) for r in rows]}


@router.get("/civic/demo/tickets/{ticket_id}")
async def civic_ticket(ticket_id: str, request: Request):
    await _rl(request, "civic", 120, 60)
    await _require_demo(request)
    if not TICKET_ID_RE.fullmatch(ticket_id or ""):
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Boleta no encontrada / Ticket not found"})
    doc = await db.civic_demo_tickets.find_one({"ticket_id": ticket_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Boleta no encontrada / Ticket not found"})
    return {"demo": True, "disclaimer": DISCLAIMER, "ticket": _public_ticket(doc)}


@router.get("/civic/demo/tickets/{ticket_id}/qr")
async def civic_ticket_qr(ticket_id: str, request: Request, response: Response):
    """The rotating credential. The secret NEVER leaves the server — the client
    polls per step and renders the wire (react-native-qrcode-svg). no-store."""
    # 120/min: each open boleta polls ~6×/min and a pitch room shares one Wi-Fi IP —
    # 30/min 429'd at five phones (builder verification 2026-09-30). Session-gated anyway.
    await _rl(request, "civicqr", 120, 60)
    await _require_demo(request)
    response.headers["Cache-Control"] = "no-store"
    if not TICKET_ID_RE.fullmatch(ticket_id or ""):
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Boleta no encontrada / Ticket not found"})
    doc = await db.civic_demo_tickets.find_one({"ticket_id": ticket_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Boleta no encontrada / Ticket not found"})
    now_ms = int(time.time() * 1000)  # ONE clock read: wire and expires_in_ms agree at a step boundary
    return {"demo": True, "wire": build_wire(ticket_id, doc["qr_secret"], now_ms),
            "step_ms": TOKEN_STEP_SECONDS * 1000, "expires_in_ms": step_remaining_ms(now_ms),
            "status": doc.get("status"), "kind": doc.get("kind")}


class ScanBody(BaseModel):
    wire: Optional[str] = Field(default=None, min_length=8, max_length=200)
    ticket_id: Optional[str] = None
    simulate: bool = False
    tamper: bool = False
    stale: bool = False
    gate: Optional[str] = Field(default=None, max_length=40)


async def _verdict_for_wire(wire: str, gate: str, request: Request) -> Dict[str, Any]:
    now = _now()
    verdict = "FALSIFICADO"
    detail: Dict[str, Any] = {}
    parts = parse_wire(wire)
    doc = None
    if parts and TICKET_ID_RE.fullmatch(parts["ticket_id"]):
        doc = await db.civic_demo_tickets.find_one({"ticket_id": parts["ticket_id"]}, {"_id": 0})
    if parts is not None and doc is not None:
        # ONE verifier for the civic demo, consumer tickets and the City Pass
        # (qr_credential.verify: hex-shape check → constant-time HMAC → ±1 step skew).
        # The old inline compare raised TypeError on a non-ASCII token (P1, audit 2026-10-01).
        v = _qc.verify({"entity_id": parts["ticket_id"], "counter": parts["counter"], "token": parts["token"]},
                       doc["qr_secret"])
        if v == "COUNTERFEIT":
            verdict = "FALSIFICADO"
        elif v == "EXPIRED":
            verdict = "EXPIRADO"
        elif doc.get("kind") == "receipt":
            # A receipt VERIFIES but never "admits": Transcaribe validation belongs
            # to its fare concession — the demo proves authenticity, nothing more.
            verdict = "RECIBO"
        else:
            flipped = await db.civic_demo_tickets.find_one_and_update(
                {"ticket_id": parts["ticket_id"], "status": "issued"},
                {"$set": {"status": "used", "used_at": _iso(now), "used_gate": gate}},
            )
            if flipped is not None:
                verdict = "VALIDO"
            else:
                verdict = "DUPLICADO"
                # Re-read: when two scans race, the loser's pre-flip snapshot has no used_at.
                fresh = await db.civic_demo_tickets.find_one(
                    {"ticket_id": parts["ticket_id"]}, {"_id": 0, "used_at": 1, "used_gate": 1})
                detail["first_used_at"] = (fresh or doc).get("used_at")
                detail["first_gate"] = (fresh or doc).get("used_gate")
        detail["ticket"] = _public_ticket({**doc, "status": "used" if verdict == "VALIDO" else doc.get("status"),
                                           "used_at": _iso(now) if verdict == "VALIDO" else doc.get("used_at")})
    try:
        await db.civic_demo_scans.insert_one({
            "at": _iso(now), "verdict": verdict,
            "ticket_id": (parts or {}).get("ticket_id"),
            "service": (doc or {}).get("service"),
            "amount_cop": (doc or {}).get("amount_cop"),
            "merchant_es": ((doc or {}).get("merchant") or {}).get("es"),
            "gate": gate, "ip_hash": _ip_hash(request),
            "expires_at": now + timedelta(hours=TICKET_TTL_H),
        })
    except Exception as exc:  # noqa: BLE001
        logger.error("[civic] scan log failed: %s", type(exc).__name__)
    return {"demo": True, "verdict": verdict, **detail}


@router.post("/civic/demo/scan")
async def civic_scan(body: ScanBody, request: Request):
    """Atomic gate verdict (PALCO admit semantics) + ledger. `simulate` exists
    because the civic validador screen ships no camera UI — the server derives
    the CURRENT wire (or a tampered / stale one for the attack demos) and runs
    the SAME pipeline as a pasted code. (The consumer door scanner at
    /business/scanner carries the live camera; this demo keeps simulate.)"""
    await _rl(request, "civicscan", 60, 60)
    await _require_demo(request)
    gate = body.gate or "demo"
    wire = body.wire or ""
    if body.simulate:
        tid = body.ticket_id or ""
        doc = await db.civic_demo_tickets.find_one({"ticket_id": tid}, {"_id": 0, "qr_secret": 1}) \
            if TICKET_ID_RE.fullmatch(tid) else None
        if not doc:
            raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Boleta no encontrada / Ticket not found"})
        c = counter_for_now() - (TOKEN_SKEW_STEPS + 2 if body.stale else 0)
        token = derive_token(tid, doc["qr_secret"], c)
        if body.tamper:
            token = ("0" * TOKEN_LEN) if token[0] != "0" else ("1" * TOKEN_LEN)
        wire = f"{WIRE_VERSION}.{tid}.{c}.{token}"
    if not wire:
        raise HTTPException(status_code=400, detail={"error": "empty", "message": "Código vacío / Empty code"})
    return await _verdict_for_wire(wire, gate, request)


@router.get("/civic/demo/summary")
async def civic_summary(request: Request, response: Response):
    """The 'recaudo de la demo' board: what EACH entity would have collected
    (aggregated per LINE merchant), plus the live scan feed."""
    await _rl(request, "civic", 120, 60)
    await _require_demo(request)
    response.headers["Cache-Control"] = "no-store"
    since = _now() - timedelta(hours=24)
    out = {"demo": True, "disclaimer": DISCLAIMER, "window_h": 24,
           "issued_n": 0, "used_n": 0, "collected_cop": 0, "by_entity": [], "scans": []}
    try:
        rows = await db.civic_demo_tickets.find(
            {"created_at": {"$gte": _iso(since)}}, {"_id": 0, "qr_secret": 0, "ip_hash": 0},
        ).to_list(500)
        agg: Dict[str, int] = {}
        for r in rows:
            out["issued_n"] += 1
            out["collected_cop"] += int(r.get("amount_cop") or 0)
            if r.get("status") == "used":
                out["used_n"] += 1
            for ln in r.get("lines") or []:
                ent = ((ln.get("merchant") or {}).get("es")
                       or ((r.get("merchant") or {}).get("es")) or "?")
                agg[ent] = agg.get(ent, 0) + int(ln.get("subtotal_cop") or 0)
        out["by_entity"] = [{"entity_es": k, "cop": v} for k, v in sorted(agg.items(), key=lambda x: -x[1])]
        out["scans"] = await db.civic_demo_scans.find(
            {}, {"_id": 0, "ip_hash": 0}).sort("at", -1).to_list(20)
    except Exception as exc:  # noqa: BLE001
        logger.error("[civic] summary failed: %s", type(exc).__name__)
    return out
