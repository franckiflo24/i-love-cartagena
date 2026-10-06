# PALCO Credential Engine v2 — © MachineMind Consulting.
# Licensed to AMO (Amo Cartagena S.A.S.) and city partners; never transferred.
"""Issue · register devices · revoke (DESIGN §1, §5 server half).

Stage A issues against the catalog with full tier enforcement; real holder
enrollment (attestation) lands in Stage B — until then devices register only
through the admin surface and every Stage-A credential is `test:true`-flagged
unless minted by a payment (Stage D). Test credentials never appear on any
public surface.

Phone numbers are only ever stored HASHED (HMAC-SHA256 with a server pepper) —
`phone_hash()` here is the one canonical helper (DESIGN §5).
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from typing import Any, Dict, Mapping, Optional

from . import catalog, crypto
from .models import (COL_CREDENTIALS, COL_DEVICES, COL_LEDGER, DEVICE_STATUS_ACTIVE,
                     DEVICE_STATUS_REVOKED, S_ISSUED, S_REFUNDED, S_REVOKED,
                     TIER_HW, TIER_LEGACY, iso, new_cred_id)


class IssueError(ValueError):
    """Refused issuance — message is a machine key, callers map to HTTP."""


def phone_hash(phone_e164: str) -> str:
    pepper = (os.environ.get("PALCO_PHONE_PEPPER") or os.environ.get("EVENTS_ADMIN_TOKEN")
              or os.environ.get("CRON_SECRET") or "palco-dev-pepper")
    digits = "".join(c for c in (phone_e164 or "") if c.isdigit() or c == "+")
    return hmac.new(pepper.encode(), f"phone|{digits}".encode(), hashlib.sha256).hexdigest()[:32]


async def _ledger(db: Any, cred_id: str, event_type: str, data: Optional[Dict[str, Any]] = None) -> None:
    await getattr(db, COL_LEDGER).insert_one({
        "evt_id": f"ple_{secrets.token_hex(6)}", "cred_id": cred_id,
        "type": event_type, "at": iso(), "data": dict(data or {})})


async def register_device(db: Any, user_id: str, pubkey_jwk: Mapping[str, Any],
                          platform: str, hw_tier: str,
                          attestation: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Store a device PUBLIC key. Stage B adds the attestation verification in
    front of this; the stored shape is final now so Stage A tests and probes
    exercise the real thing."""
    key_id = crypto.key_id_for_jwk(dict(pubkey_jwk))
    if key_id is None or crypto.load_p256_jwk(dict(pubkey_jwk)) is None:
        raise IssueError("bad_pubkey")
    doc = {
        "device_key_id": key_id, "user_id": user_id,
        "pubkey_jwk": {k: pubkey_jwk[k] for k in ("kty", "crv", "x", "y")},
        "platform": platform[:20], "hw_tier": hw_tier[:20],
        "attestation": attestation or {"mode": "admin_registered"},
        "status": DEVICE_STATUS_ACTIVE, "created_at": iso(),
    }
    existing = await getattr(db, COL_DEVICES).find_one({"device_key_id": key_id}, {"_id": 0})
    if existing is None:
        await getattr(db, COL_DEVICES).insert_one(dict(doc))
    return {"device_key_id": key_id}


async def issue_credential(db: Any, product_id: str, holder: Mapping[str, Any],
                           device_key_id: Optional[str] = None,
                           scope: Optional[Dict[str, Any]] = None,
                           valid_from: Optional[str] = None, valid_to: Optional[str] = None,
                           payment_id: Optional[str] = None, test: bool = False) -> Dict[str, Any]:
    product = catalog.get(product_id)
    if product is None:
        raise IssueError("producto_invalido")
    if product["status"] != catalog.S_LIVE and not test:
        raise IssueError("producto_no_activo")  # honesty: waiting_agreement never issues for real
    tier = TIER_HW if device_key_id else TIER_LEGACY
    if product["tier_floor"] == TIER_HW and tier != TIER_HW:
        raise IssueError("requiere_dispositivo")
    if device_key_id:
        dev = await getattr(db, COL_DEVICES).find_one(
            {"device_key_id": device_key_id, "status": DEVICE_STATUS_ACTIVE}, {"_id": 0})
        if dev is None:
            raise IssueError("dispositivo_no_registrado")
    ent_tpl = product["entitlement"]
    scope = dict(scope or {})
    missing = [k for k in (ent_tpl.get("scope_keys") or []) if not scope.get(k)]
    if missing:
        raise IssueError("alcance_incompleto")
    doc = {
        "cred_id": new_cred_id(), "namespace": product["namespace"],
        "product_id": product_id, "product_type": product["product_type"],
        "entitlement": {
            "uses_total": ent_tpl["uses_total"], "uses_left": ent_tpl["uses_total"],
            "valid_from": valid_from, "valid_to": valid_to,
            "grace_min": int(ent_tpl.get("grace_min") or 0), "scope": scope,
        },
        "holder": {
            "user_id": holder.get("user_id"),
            "phone_hash": holder.get("phone_hash") or "",
            "display_name": str(holder.get("display_name") or "")[:60],
        },
        "device_key_id": device_key_id, "tier": tier,
        "status": S_ISSUED, "payment_id": payment_id,
        "issuer_id": product["issuer_id"],
        "price_cop": product["price_cop"], "tax_cop": product["tax_cop"],
        "created_at": iso(), "last_counter": -1, "transfer_count": 0,
        "used_at": None, "used_gate": None, "test": bool(test),
    }
    await getattr(db, COL_CREDENTIALS).insert_one(dict(doc))
    await _ledger(db, doc["cred_id"], "issue",
                  {"product_id": product_id, "tier": tier, "test": bool(test),
                   "payment_id": payment_id})
    return doc


async def revoke_credential(db: Any, cred_id: str, reason: str,
                            refund: bool = False) -> Optional[Dict[str, Any]]:
    """Flip server-side now; the next manifest carries it (DESIGN §7.3, A10)."""
    new_status = S_REFUNDED if refund else S_REVOKED
    flipped = await getattr(db, COL_CREDENTIALS).find_one_and_update(
        {"cred_id": cred_id, "status": {"$nin": [S_REVOKED, S_REFUNDED]}},
        {"$set": {"status": new_status, "revoked_at": iso(), "revoke_reason": reason[:120]}})
    if flipped is not None:
        await _ledger(db, cred_id, "refund" if refund else "revoke", {"reason": reason[:120]})
    return flipped


async def revoke_device(db: Any, device_key_id: str, reason: str) -> bool:
    flipped = await getattr(db, COL_DEVICES).find_one_and_update(
        {"device_key_id": device_key_id, "status": DEVICE_STATUS_ACTIVE},
        {"$set": {"status": DEVICE_STATUS_REVOKED, "revoked_at": iso(),
                  "revoke_reason": reason[:120]}})
    return flipped is not None
