# PALCO Credential Engine v2 — © MachineMind Consulting.
# Licensed to AMO (Amo Cartagena S.A.S.) and city partners; never transferred.
"""Ley 1581 server-side consent records (contract: docs/palco-v2/DESIGN.md §5, §9).

The login checkbox is client-only and auto-ticks on ?signup=1 — it is NOT consent.
A consent record is the durable, server-side proof that a specific user accepted a
named policy version for a named purpose at a point in time. Enrollment, transfer and
(Stage D) payment each record one. Retained on account deletion — proof-of-consent may
be kept under Ley 1581 — but stripped of the request IP (see deletion.purge_user).
"""
from __future__ import annotations

import secrets
from typing import Any, Dict, List, Optional

from .models import COL_CONSENT, iso

# Known policy versions — an unknown version is refused so nothing junk or forged can
# be recorded as "accepted". Add the next version here when the published policy changes.
CURRENT_POLICY_VERSION = "ley1581-v1-2026-10"
KNOWN_POLICY_VERSIONS = frozenset({CURRENT_POLICY_VERSION})

PURPOSES = frozenset({"general", "enrollment", "transfer", "payment", "whatsapp_otp"})


class ConsentError(ValueError):
    """Refused consent record — message is a machine key the router maps to HTTP."""


async def record_consent(db: Any, user_id: str, policy_version: str, purpose: str,
                         channel: str, ip_hash: Optional[str] = None,
                         phone_hash: Optional[str] = None) -> Dict[str, Any]:
    if policy_version not in KNOWN_POLICY_VERSIONS:
        raise ConsentError("unknown_policy_version")
    doc = {
        "consent_id": f"con_{secrets.token_hex(6)}",
        "user_id": user_id,
        "policy_version": policy_version,
        "purpose": purpose if purpose in PURPOSES else "general",
        "channel": str(channel or "app")[:20],
        "consented_at": iso(),
        "ip_hash": ip_hash or "",
        "phone_hash": phone_hash or "",
    }
    await getattr(db, COL_CONSENT).insert_one(dict(doc))
    return {"consent_id": doc["consent_id"], "policy_version": doc["policy_version"],
            "purpose": doc["purpose"], "consented_at": doc["consented_at"]}


async def list_consents(db: Any, user_id: str) -> List[Dict[str, Any]]:
    """Holder-facing projection — never returns the stored ip/phone digests."""
    rows = await getattr(db, COL_CONSENT).find(
        {"user_id": user_id}, {"_id": 0}).sort("consented_at", -1).to_list(50)
    return [{"consent_id": r.get("consent_id"), "policy_version": r.get("policy_version"),
             "purpose": r.get("purpose"), "channel": r.get("channel"),
             "consented_at": r.get("consented_at")} for r in rows]
