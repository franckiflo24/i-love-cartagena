# PALCO Credential Engine v2 — © MachineMind Consulting.
# Licensed to AMO (Amo Cartagena S.A.S.) and city partners; never transferred.
"""Device enrollment — challenge + attestation (contract: docs/palco-v2/DESIGN.md §5, §13).

The holder's wallet proves it controls a non-exportable P-256 key and binds that public
key to the account before the key can carry credentials. The flow:

  1. POST /palco/enroll/challenge -> a one-time server nonce (>=16 B, TTL 10 min).
  2. the device signs the enrollment binding (nonce + key id) with its key and posts
     {pubkey_jwk, attestation} to POST /palco/enroll/verify.
  3. the registered attester for attestation.mode verifies it; on success the public key
     is stored via issue.register_device with the attested hardware tier.

Attesters are pluggable by mode. The `sandbox` attester proves possession of the private
key bound to the server challenge — a real cryptographic check, testable without hardware
(App Attest / Play Integrity sandbox builds use it). The hardware attesters (`app_attest`,
`play_integrity`), which additionally prove the key lives in Secure Enclave / StrongBox,
register here with the Stage B binary; until one is registered its mode is refused
(fail closed — never a silent downgrade to software).
"""
from __future__ import annotations

import secrets
from datetime import timedelta
from typing import Any, Callable, Dict, Mapping

from . import crypto, issue
from .models import COL_ENROLL_CHALLENGES, iso, now_utc

CHALLENGE_TTL_SEC = 600


class EnrollError(ValueError):
    """Refused enrollment — message is a machine key the router maps to HTTP."""


def enroll_binding_payload(challenge: str, key_id: str) -> str:
    """What the device signs to prove possession + challenge binding (DESIGN §5: covers
    the challenge and the device public key, here via its RFC-7638 thumbprint key id)."""
    return f"palco-enroll|{challenge}|{key_id}"


def _now_ms() -> int:
    return int(now_utc().timestamp() * 1000)


# ── attester registry ──────────────────────────────────────────────────────────
Attester = Callable[[str, Mapping[str, Any], str, Mapping[str, Any]], Dict[str, Any]]
_ATTESTERS: Dict[str, Attester] = {}


def register_attester(mode: str, fn: Attester) -> None:
    _ATTESTERS[mode] = fn


def _sandbox_attester(challenge: str, pubkey_jwk: Mapping[str, Any], key_id: str,
                      attestation: Mapping[str, Any]) -> Dict[str, Any]:
    """Proof-of-possession: the enroller signed the binding with the private key for the
    public key it is registering. Not a hardware-origin proof (that is the hw attesters)
    — the stored tier reads `sandbox` so nothing over-claims (honesty spine, §0)."""
    pub = crypto.load_p256_jwk(dict(pubkey_jwk))
    pop_sig = str((attestation or {}).get("pop_sig") or "")
    if pub is None or not pop_sig:
        return {"ok": False}
    if not crypto.verify_p256(pub, enroll_binding_payload(challenge, key_id), pop_sig):
        return {"ok": False}
    return {"ok": True, "hw_tier": "sandbox"}


register_attester("sandbox", _sandbox_attester)
# Stage B binary registers "app_attest" (iOS, pyattest) and "play_integrity" (Android)
# here; an unregistered mode is refused `attester_unavailable` in verify_enrollment.


# ── flow ─────────────────────────────────────────────────────────────────────────
async def new_challenge(db: Any, user_id: str) -> Dict[str, Any]:
    challenge = secrets.token_urlsafe(24)          # ~32 chars, >=16 bytes (DESIGN §5)
    doc = {
        "challenge_id": f"ech_{secrets.token_hex(6)}", "user_id": user_id,
        "challenge": challenge, "created_at": iso(),
        "expires_at_ms": _now_ms() + CHALLENGE_TTL_SEC * 1000,
        "expire_at": now_utc() + timedelta(seconds=CHALLENGE_TTL_SEC),  # BSON date — TTL reaps
        "consumed": False,
    }
    await getattr(db, COL_ENROLL_CHALLENGES).insert_one(dict(doc))
    return {"challenge_id": doc["challenge_id"], "challenge": challenge,
            "expires_in_ms": CHALLENGE_TTL_SEC * 1000}


async def verify_enrollment(db: Any, user_id: str, challenge_id: str,
                            pubkey_jwk: Mapping[str, Any], attestation: Mapping[str, Any],
                            platform: str) -> Dict[str, Any]:
    ch = await getattr(db, COL_ENROLL_CHALLENGES).find_one(
        {"challenge_id": challenge_id, "user_id": user_id}, {"_id": 0})
    if ch is None:
        raise EnrollError("challenge_unknown")
    if ch.get("consumed"):
        raise EnrollError("challenge_used")
    if int(ch.get("expires_at_ms") or 0) < _now_ms():
        raise EnrollError("challenge_expired")
    key_id = crypto.key_id_for_jwk(dict(pubkey_jwk))
    if key_id is None or crypto.load_p256_jwk(dict(pubkey_jwk)) is None:
        raise EnrollError("bad_pubkey")
    mode = str((attestation or {}).get("mode") or "")
    attester = _ATTESTERS.get(mode)
    if attester is None:
        raise EnrollError("attester_unavailable")        # fail closed — no silent downgrade
    result = attester(ch["challenge"], pubkey_jwk, key_id, attestation or {})
    if not result.get("ok"):
        raise EnrollError("attestation_failed")
    # one-time: consume the challenge atomically BEFORE binding the key
    claimed = await getattr(db, COL_ENROLL_CHALLENGES).find_one_and_update(
        {"challenge_id": challenge_id, "consumed": {"$ne": True}},
        {"$set": {"consumed": True, "consumed_at": iso()}})
    if claimed is None:
        raise EnrollError("challenge_used")
    reg = await issue.register_device(
        db, user_id, pubkey_jwk, platform, result.get("hw_tier", "sandbox"),
        attestation={"mode": mode, "attested_at": iso()})
    return {"device_key_id": reg["device_key_id"], "hw_tier": result.get("hw_tier", "sandbox")}
