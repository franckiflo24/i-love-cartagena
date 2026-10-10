# PALCO Credential Engine v2 — © MachineMind Consulting.
# Licensed to AMO (Amo Cartagena S.A.S.) and city partners; never transferred.
"""Shared constants + document shapes (contract: docs/palco-v2/DESIGN.md §1, §4).

Plain dicts at the storage layer (house style); pydantic stays at route edges.
"""
from __future__ import annotations

import re
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, Optional

# ── namespaces (v2 logical; the wire prefix is always AMO2) ───────────────────
NS_EVENT = "AMOEVT"
NS_RIDE = "AMORIDE"
NS_PASS = "AMOPASS"
NS_CIVIC = "AMOCIV"
NS_BUS = "AMOBUS"          # parse-valid; no product may go live without a validator agreement
NAMESPACES = frozenset({NS_EVENT, NS_RIDE, NS_PASS, NS_CIVIC, NS_BUS})

PRODUCT_TYPES = frozenset({"event_ticket", "ride", "pass", "recharge"})

# ── verdicts (superset of v1; clients fail closed on unknowns → ship lockstep) ─
V_VALIDO = "VALIDO"
V_DUPLICADO = "DUPLICADO"
V_FALSIFICADO = "FALSIFICADO"
V_EXPIRADO = "EXPIRADO"
V_FUERA = "FUERA_DE_ALCANCE"
V_REVOCADO = "REVOCADO"
V_TRANSFERIDO = "TRANSFERIDO"
V_PASE = "PASE"
V_RECIBO = "RECIBO"
# SUPPLY-SPRINT v1: a live wire must not admit to a dead event.
V_EVENTO_CANCELADO = "EVENTO_CANCELADO"
V_EVENTO_VENCIDO = "EVENTO_VENCIDO"
VERDICTS = frozenset({V_VALIDO, V_DUPLICADO, V_FALSIFICADO, V_EXPIRADO, V_FUERA,
                      V_REVOCADO, V_TRANSFERIDO, V_PASE, V_RECIBO,
                      V_EVENTO_CANCELADO, V_EVENTO_VENCIDO})

# credential statuses (DESIGN §1.1)
S_ISSUED, S_ACTIVE, S_USED, S_EXHAUSTED = "issued", "active", "used", "exhausted"
S_TRANSFERRED, S_REVOKED, S_REFUNDED, S_EXPIRED = "transferred", "revoked", "refunded", "expired"
CONSUMABLE_STATUSES = (S_ISSUED, S_ACTIVE)

TIER_HW = "hw"
TIER_LEGACY = "legacy"

MODE_CONSUME = "consume"
MODE_VERIFY = "verify"     # inspector: full verdict, zero consumption (DESIGN §4)

# named rejection reasons (machine key → es/en line; the scanner shows them)
REASONS: Dict[str, Dict[str, str]] = {
    "firma_invalida":    {"es": "La firma no es auténtica.", "en": "Signature is not authentic."},
    "llave_desconocida": {"es": "Dispositivo no registrado para esta credencial.", "en": "Device not enrolled for this credential."},
    "codigo_vencido":    {"es": "Código vencido: rota cada 10 s.", "en": "Code expired: it rotates every 10 s."},
    "repetido":          {"es": "Este código ya fue aceptado.", "en": "This code was already accepted."},
    "sin_usos":          {"es": "La credencial no tiene usos disponibles.", "en": "No uses left on this credential."},
    "revocada":          {"es": "Credencial revocada.", "en": "Credential revoked."},
    "reembolsada":       {"es": "Credencial reembolsada.", "en": "Credential refunded."},
    "transferida":       {"es": "Credencial transferida a otra persona.", "en": "Credential transferred to someone else."},
    "fuera_de_alcance":  {"es": "Fuera del alcance asignado a este validador.", "en": "Outside this validator's assigned scope."},
    "fuera_de_ventana":  {"es": "Fuera de la ventana de validez.", "en": "Outside the validity window."},
    "evento_no_activo":  {"es": "El evento respaldante no está activo.", "en": "The backing event is not live."},
    "estado_inaccesible":{"es": "No se pudo confirmar el estado respaldante.", "en": "Backing state could not be confirmed."},
    "ya_usada":          {"es": "Esta credencial ya fue usada.", "en": "This credential was already used."},
    "producto_invalido": {"es": "Producto no reconocido.", "en": "Unknown product."},
    "evento_cancelado":  {"es": "El evento fue cancelado.", "en": "The event was cancelled."},
    "evento_vencido":    {"es": "El evento ya terminó.", "en": "The event already ended."},
}

CRED_ID_RE = re.compile(r"^crd_[a-f0-9]{12}$")
KEY_ID_RE = re.compile(r"^[a-f0-9]{12}$")
DEVICE_STATUS_ACTIVE, DEVICE_STATUS_REVOKED = "active", "revoked"

# Mongo collections owned by the engine (NEW in Stage A; legacy rows stay put)
COL_CREDENTIALS = "credentials"
COL_DEVICES = "credential_devices"
COL_LEDGER = "credential_ledger"
COL_VALIDATORS = "validators"
COL_SCAN_LOG = "palco_scan_log"
COL_CONSENT = "consent_records"              # Ley 1581 proof records (DESIGN §5, §13)
COL_ENROLL_CHALLENGES = "palco_enroll_challenges"  # one-time enrollment nonces (TTL)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: Optional[datetime] = None) -> str:
    return (dt or now_utc()).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_cred_id() -> str:
    return f"crd_{secrets.token_hex(6)}"


def reason_line(key: str) -> Dict[str, str]:
    r = REASONS.get(key) or {"es": "Rechazada.", "en": "Rejected."}
    return {"reason": key, "reason_es": r["es"], "reason_en": r["en"]}


def public_credential(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Holder-facing projection — never leaks device internals beyond key id."""
    ent = dict(doc.get("entitlement") or {})
    return {
        "cred_id": doc.get("cred_id"), "namespace": doc.get("namespace"),
        "product_id": doc.get("product_id"), "product_type": doc.get("product_type"),
        "status": doc.get("status"), "tier": doc.get("tier"),
        "entitlement": {k: ent.get(k) for k in ("uses_total", "uses_left", "valid_from", "valid_to", "grace_min", "scope")},
        "issuer_id": doc.get("issuer_id"), "created_at": doc.get("created_at"),
        "transfer_count": doc.get("transfer_count", 0),
    }
