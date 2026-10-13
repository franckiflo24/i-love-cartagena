"""activities_funnel.py — DROP 5C: the "Reclama tu listado" funnel over the
verify-before-publish registry (backend/data/activities_registry_5c.json).

The 5A/5B drops held operators the rails would not publish (door conflicts,
operator-unknown resellers, verified RNTs without a Cartagena door). This module
turns those holds into a supply-side onboarding funnel:

  GET  /api/activities/registry      public — the claimable rows, HONEST framing:
                                     name + neutral reason + exactly what's missing.
                                     Internal research evidence NEVER ships.
  POST /api/activities/claims        public, rate-limited — an operator (listed or
                                     not) submits door + contact + RNT/NIT + links.
                                     Stored to db.activity_claims, admin notified.
                                     NOTHING auto-publishes.
  GET  /api/admin/activities/claims  operator-token — the review queue.
  POST /api/admin/activities/claims/{id}/resolve
                                     operator-token — mark reviewed/actioned/
                                     rejected + note. Publishing itself stays on
                                     the existing gated levers: upsert-editorial-
                                     venue (Reportado) and verify-provider
                                     (earned Verificado). This module never
                                     writes a partner record.

Monetizing the earned badge is explicitly LATER — no payment surface here.
"""
from __future__ import annotations

import json
import logging
import os
import re
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional

from fastapi import APIRouter, HTTPException, Request, Response

logger = logging.getLogger(__name__)
router = APIRouter()

_REGISTRY_PATH = Path(__file__).resolve().parent / "data" / "activities_registry_5c.json"
_cache: Dict[str, Any] = {"mtime": None, "data": None}

db: Any = None


def init(db_: Any) -> None:
    global db
    db = db_


def _load_registry() -> Optional[Dict[str, Any]]:
    try:
        mtime = os.path.getmtime(_REGISTRY_PATH)
        if _cache["data"] is None or _cache["mtime"] != mtime:
            with open(_REGISTRY_PATH, "r", encoding="utf-8") as f:
                _cache["data"] = json.load(f)
            _cache["mtime"] = mtime
    except Exception as exc:  # noqa: BLE001 — keep last good, never 500 a read
        logger.error("[funnel] registry load failed: %s", type(exc).__name__)
    return _cache["data"]


# Per hold-class: a NEUTRAL public reason (never shaming — these are prospects)
# and exactly what unlocks publication. The requirements mirror the 5A promote
# gate: RUES/Cámara always; DIMAR on the water; PADI dive / IKO kite.
_CLASS_PUBLIC: Dict[str, Dict[str, Any]] = {
    "door_conflict": {
        "reason": {"es": "Las direcciones publicadas no coinciden entre canales.",
                   "en": "Published addresses differ between channels."},
        "needed": {"es": ["Dirección confirmada", "NIT / Cámara de Comercio", "RNT (si aplica)"],
                   "en": ["Confirmed address", "NIT / Chamber of Commerce", "RNT (if applicable)"]},
    },
    "verified_rnt_no_local_door": {
        "reason": {"es": "RNT verificado — falta una sede o punto de encuentro en Cartagena.",
                   "en": "RNT verified — a Cartagena base or meeting point is missing."},
        "needed": {"es": ["Sede o punto de encuentro en Cartagena"],
                   "en": ["A Cartagena base or meeting point"]},
    },
    "no_evidence": {
        "reason": {"es": "No encontramos web propia ni registro citable.",
                   "en": "We found no own site or citable registration."},
        "needed": {"es": ["Web o perfil oficial", "NIT / Cámara de Comercio", "RNT"],
                   "en": ["Official site or profile", "NIT / Chamber of Commerce", "RNT"]},
    },
    "operator_unknown": {
        "reason": {"es": "El operador detrás de los listados no está identificado.",
                   "en": "The operator behind the listings is not identified."},
        "needed": {"es": ["Nombre legal del operador", "NIT / Cámara de Comercio", "RNT"],
                   "en": ["Operator legal name", "NIT / Chamber of Commerce", "RNT"]},
    },
    "reviewer_claims_only": {
        "reason": {"es": "Solo hay reseñas de viajeros — falta evidencia propia.",
                   "en": "Traveler reviews only — own evidence is missing."},
        "needed": {"es": ["Web o perfil oficial", "Dirección o punto de encuentro", "NIT / RNT"],
                   "en": ["Official site or profile", "Address or meeting point", "NIT / RNT"]},
    },
    "no_own_evidence": {
        "reason": {"es": "Sin fuente propia que podamos citar.",
                   "en": "No own source we can cite."},
        "needed": {"es": ["Web o perfil oficial", "Dirección confirmada", "NIT / Cámara"],
                   "en": ["Official site or profile", "Confirmed address", "NIT / Chamber of Commerce"]},
    },
    "no_local_door": {
        "reason": {"es": "Falta una sede o estudio con dirección en Cartagena.",
                   "en": "A Cartagena venue or studio address is missing."},
        "needed": {"es": ["Dirección de la sede o estudio"],
                   "en": ["Venue or studio address"]},
    },
    "accommodation_primary": {
        "reason": {"es": "Es principalmente hospedaje — la ficha correcta sería de alojamiento.",
                   "en": "Primarily accommodation — the right listing would be lodging."},
        "needed": {"es": ["Confirmar el tipo de ficha", "NIT / RNT"],
                   "en": ["Confirm the listing type", "NIT / RNT"]},
    },
    "retreats_no_studio": {
        "reason": {"es": "Opera retiros — falta una puerta de estudio para el mapa.",
                   "en": "Runs retreats — a studio door for the map is missing."},
        "needed": {"es": ["Dirección del estudio o sede"],
                   "en": ["Studio or base address"]},
    },
}


def _slug(name: str) -> str:
    s = unicodedata.normalize("NFD", name).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:60]


def public_rows() -> List[Dict[str, Any]]:
    """The claimable registry rows, with internals (research evidence, hold notes)
    stripped — only the honest why + the exact unlock list ships."""
    data = _load_registry() or {}
    out: List[Dict[str, Any]] = []
    for r in data.get("rows") or []:
        cls = _CLASS_PUBLIC.get(r.get("class") or "")
        if not cls:
            continue
        out.append({"id": _slug(r.get("name") or ""), "name": r.get("name"),
                    "reason": cls["reason"], "needed": cls["needed"]})
    return out


# ── claim intake (public, write-only) ────────────────────────────────────────

_WA_RE = re.compile(r"^\+?[0-9 ()\-]{7,20}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
_URLISH_RE = re.compile(r"^https?://\S{4,290}$|^@[A-Za-z0-9_.]{2,60}$")

_CLAIM_FIELDS = {
    "business_name": 120, "contact_name": 80, "whatsapp": 20, "email": 120,
    "address": 200, "rnt": 20, "nit": 20, "website": 300, "message": 1000,
    "registry_id": 60,
}


def validate_claim(body: Mapping[str, Any]) -> Dict[str, Any]:
    """Shape-validate a public claim. Returns the clean doc or raises 422.
    Honeypot: the hidden field `company` must be EMPTY (bots fill it)."""
    if str(body.get("company") or "").strip():
        # Bot-shaped: accept-and-drop (no signal back to the bot).
        return {}
    doc: Dict[str, Any] = {}
    for f, lim in _CLAIM_FIELDS.items():
        v = str(body.get(f) or "").strip()[:lim]
        if v:
            doc[f] = v
    if not doc.get("business_name"):
        raise HTTPException(status_code=422, detail={"error": "business_name_required"})
    wa, em = doc.get("whatsapp"), doc.get("email")
    if not wa and not em:
        raise HTTPException(status_code=422, detail={"error": "contact_required",
                            "hint": "WhatsApp o email"})
    if wa and not _WA_RE.match(wa):
        raise HTTPException(status_code=422, detail={"error": "bad_whatsapp"})
    if em and not _EMAIL_RE.match(em):
        raise HTTPException(status_code=422, detail={"error": "bad_email"})
    if doc.get("website") and not _URLISH_RE.match(doc["website"]):
        raise HTTPException(status_code=422, detail={"error": "bad_website",
                            "hint": "https://… o @instagram"})
    if doc.get("registry_id") and doc["registry_id"] not in {r["id"] for r in public_rows()}:
        raise HTTPException(status_code=422, detail={"error": "unknown_registry_id"})
    return doc


async def _rl(request: Request, key: str, max_calls: int, window: int) -> None:
    try:
        from server import _check_rate_limit, _client_ip  # late import; server mounts us
        await _check_rate_limit(f"{key}:{_client_ip(request)}", max_calls=max_calls, window_sec=window)
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 — limiter plumbing must never 500 a route
        pass


@router.get("/activities/registry")
async def get_registry(request: Request, response: Response):
    await _rl(request, "funnel-read", 60, 60)
    response.headers["Cache-Control"] = "public, max-age=300"
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Vary"] = "Origin"
    return {"rows": public_rows(),
            "process": {
                "es": "Publicamos como «Reportado» y el sello «Verificado por AMO» solo se gana con chequeo humano: RUES + Cámara de Comercio, DIMAR para operaciones en el agua y PADI/IKO para buceo/kite. Nada se publica automáticamente.",
                "en": "We publish as “Reported”, and the “AMO Verified” badge is only earned through a human check: RUES + Chamber of Commerce, DIMAR for anything on the water and PADI/IKO for dive/kite. Nothing publishes automatically.",
            }}


@router.post("/activities/claims")
async def submit_claim(request: Request):
    await _rl(request, "funnel-claim", 5, 600)
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=422, detail={"error": "json_required"})
    doc = validate_claim(body if isinstance(body, dict) else {})
    if not doc:  # honeypot hit — pretend success, store nothing
        return {"ok": True}
    doc.update(claim_id=f"aclaim_{uuid.uuid4().hex[:10]}", status="new",
               created_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    try:
        await db.activity_claims.insert_one(dict(doc))
    except Exception as exc:  # noqa: BLE001
        logger.error("[funnel] claim store failed: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail={"error": "store_unavailable"})
    try:
        from server import _notify_admin
        await _notify_admin("activity_claim",
                            f"Reclamo de listado: {doc['business_name']}",
                            {"claim_id": doc["claim_id"],
                             "registry_id": doc.get("registry_id", "")}, alert=True)
    except Exception as exc:  # noqa: BLE001 — a failed notification never fails the intake
        logger.error("[funnel] notify failed: %s", type(exc).__name__)
    return {"ok": True, "claim_id": doc["claim_id"],
            "message": {"es": "Recibido. Verificamos antes de publicar — te contactamos.",
                        "en": "Received. We verify before publishing — we'll contact you."}}


# ── admin queue (operator token — same footing as the 5A levers) ─────────────

def _admin_ok(request: Request) -> bool:
    try:
        import events_elite as _ee
        return bool(_ee.is_events_admin_token(request))
    except Exception:  # noqa: BLE001
        return False


@router.get("/admin/activities/claims")
async def admin_list_claims(request: Request, status: str = ""):
    if not _admin_ok(request):
        raise HTTPException(status_code=401, detail={"error": "operator_token_required"})
    q: Dict[str, Any] = {}
    if status:
        q["status"] = status
    rows = await db.activity_claims.find(q, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"claims": rows, "count": len(rows)}


@router.post("/admin/activities/claims/{claim_id}/resolve")
async def admin_resolve_claim(claim_id: str, request: Request):
    """Mark a claim reviewed/actioned/rejected with a note. PUBLISHING NEVER HAPPENS
    HERE: a resolved claim is actioned through upsert-editorial-venue (Reportado) and,
    with evidence, verify-provider (Verificado) — the gates stay the gates."""
    if not _admin_ok(request):
        raise HTTPException(status_code=401, detail={"error": "operator_token_required"})
    body = await request.json() if request.headers.get("content-type", "").startswith("application/json") else {}
    new_status = str((body or {}).get("status") or "").strip()
    if new_status not in ("reviewed", "actioned", "rejected"):
        raise HTTPException(status_code=422, detail={"error": "bad_status",
                            "allowed": ["reviewed", "actioned", "rejected"]})
    note = str((body or {}).get("note") or "").strip()[:500]
    res = await db.activity_claims.update_one(
        {"claim_id": claim_id},
        {"$set": {"status": new_status, "resolution_note": note,
                  "resolved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "resolved_by": "operator_token"}})
    if not res.matched_count:
        raise HTTPException(status_code=404, detail={"error": "no_such_claim"})
    try:
        from server import _log_activity
        await _log_activity("activity_claim_resolved", scope="admin",
                            user_id="operator_token", detail=f"{claim_id} · {new_status}")
    except Exception:  # noqa: BLE001
        pass
    return {"ok": True, "claim_id": claim_id, "status": new_status}
