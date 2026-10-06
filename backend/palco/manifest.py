# PALCO Credential Engine v2 — © MachineMind Consulting.
# Licensed to AMO (Amo Cartagena S.A.S.) and city partners; never transferred.
"""Signed validator manifests — the offline trust channel (DESIGN §7.3, A10).

Before a shift a validator pulls the manifest for ITS scope: credential ids,
device public keys, slim entitlements, and revocations. Ed25519-signed with
the server key (env PALCO_MANIFEST_SK, 32-byte hex seed); the Validador app
pins the public key and refuses unsigned/foreign manifests. Revocations and
revoked DEVICE keys propagate through the next pull — that is the A10 path.

No key in env ⇒ the endpoint fails closed (503); nothing unsigned ever ships.
"""
from __future__ import annotations

from typing import Any, Dict, List, Mapping, Optional

from . import crypto
from .models import (COL_CREDENTIALS, COL_DEVICES, DEVICE_STATUS_REVOKED,
                     S_REFUNDED, S_REVOKED, S_TRANSFERRED, iso)

MANIFEST_VERSION = 1
_MAX_CREDENTIALS = 2000  # one scope's shift, not a dump


class ManifestUnavailable(RuntimeError):
    """PALCO_MANIFEST_SK missing/invalid — callers answer 503, never unsigned."""


def _slim_cred(c: Mapping[str, Any], jwk_by_key: Mapping[str, Any]) -> Dict[str, Any]:
    ent = c.get("entitlement") or {}
    holder = c.get("holder") or {}
    return {
        "cred_id": c.get("cred_id"), "namespace": c.get("namespace"),
        "product_id": c.get("product_id"), "product_type": c.get("product_type"),
        "status": c.get("status"), "device_key_id": c.get("device_key_id"),
        "pubkey_jwk": jwk_by_key.get(c.get("device_key_id") or ""),
        "entitlement": {k: ent.get(k) for k in ("uses_total", "uses_left", "valid_from",
                                                "valid_to", "grace_min", "scope")},
        "last_counter": c.get("last_counter", -1),
        # First name only — the gate greets the guest; the wire carries no PII.
        "holder_first_name": ((holder.get("display_name") or "").strip().split(" ")[0])[:40],
    }


async def build_manifest(db: Any, scope: Dict[str, Any]) -> Dict[str, Any]:
    """scope: {"event_id": …} in Stage A (vessel/route/monument join in Stage C)."""
    q: Dict[str, Any] = {"test": {"$in": [False, None]}}
    event_id = scope.get("event_id")
    if event_id:
        q["entitlement.scope.event_id"] = event_id
    if scope.get("include_test"):
        q.pop("test")
    rows: List[Dict[str, Any]] = await getattr(db, COL_CREDENTIALS).find(
        q, {"_id": 0}).to_list(_MAX_CREDENTIALS)

    key_ids = sorted({r.get("device_key_id") for r in rows if r.get("device_key_id")})
    jwk_by_key: Dict[str, Any] = {}
    revoked_keys: List[str] = []
    for kid in key_ids:
        dev = await getattr(db, COL_DEVICES).find_one({"device_key_id": kid}, {"_id": 0})
        if dev is None:
            continue
        if dev.get("status") == DEVICE_STATUS_REVOKED:
            revoked_keys.append(kid)
        else:
            jwk_by_key[kid] = dev.get("pubkey_jwk")

    body = {
        "manifest_version": MANIFEST_VERSION,
        "generated_at": iso(),
        "scope": {k: v for k, v in scope.items() if k != "include_test"},
        "credentials": [_slim_cred(r, jwk_by_key) for r in rows],
        "revoked": sorted([r["cred_id"] for r in rows
                           if r.get("status") in (S_REVOKED, S_REFUNDED, S_TRANSFERRED)]),
        "revoked_device_keys": sorted(revoked_keys),
    }
    priv = crypto.manifest_key_from_env()
    if priv is None:
        raise ManifestUnavailable("PALCO_MANIFEST_SK not configured")
    return {"body": body, "sig": crypto.sign_manifest(priv, body),
            "pub_hint": crypto.manifest_public_hex(priv)[:12]}


def verify_manifest_envelope(public_hex: str, envelope: Mapping[str, Any]) -> bool:
    body = envelope.get("body")
    sig = envelope.get("sig")
    if not isinstance(body, dict) or not isinstance(sig, str):
        return False
    return crypto.verify_manifest(public_hex, body, sig)
