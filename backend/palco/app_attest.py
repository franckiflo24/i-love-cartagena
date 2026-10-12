# PALCO Credential Engine v2 — © MachineMind Consulting.
# Licensed to AMO (Amo Cartagena S.A.S.) and city partners; never transferred.
"""Apple App Attest attester (contract: docs/palco-v2/DESIGN.md §5, §13.5).

The iOS hardware attester for enrollment: on top of the sandbox tier's
proof-of-possession of the device P-256 key, the device submits a DCAppAttest
attestation object. Verifying it (pyattest) proves the ATTESTATION came from a
genuine instance of our app on a real Apple device:

  - certificate chain rooted in Apple's App Attestation Root CA,
  - nonce in the leaf cert covers SHA-256 of our enrollment binding payload
    (`palco-enroll|<challenge>|<key_id>`), so the attestation is tied to this
    exact challenge AND this exact device public key — it cannot be replayed
    for another enrollment,
  - the submitted App Attest key id matches the attested key,
  - app id pinned to <team>.<bundle>, counter 0, production aaguid.

Honesty spine (§0): the stored hw_tier is `app_attest` — Apple attests the app
instance and its attestation key; it does not NAME the enclave residency of the
separate wallet signing key, so we don't claim `secure_enclave`. The PoP check
still proves the wallet key is controlled by the same enroller.

Fail-closed: if pyattest (or a dependency) is missing, the mode never
registers, and /palco/enroll/verify answers `attester_unavailable` — never a
silent downgrade to the sandbox tier.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import os
from typing import Any, Dict, Mapping, Optional

from . import crypto, enroll

logger = logging.getLogger("palco.app_attest")

MODE = "app_attest"
# Team + bundle are public identifiers, not secrets. Env overrides exist for the
# dev-signed binary (appattest-environment=development) and tests.
APP_ID = os.environ.get("PALCO_APP_ATTEST_APP_ID") or "4C39DXRG9L.com.amocartagena.app"
PRODUCTION = (os.environ.get("PALCO_APP_ATTEST_ENV") or "production") != "development"

_AA_KEY_ID_LEN = 32          # SHA-256 of the attestation public key
_MAX_ATTESTATION_B64 = 64 * 1024   # genuine objects are ~5.5 KB; cap abuse

# Test hook: pyattest accepts a custom trust root so the full verification path
# (CBOR → chain → nonce → key id → app id → counter → aaguid → credential id)
# is provable in pytest with a forged chain. Never set outside tests.
_TEST_ROOT_CA_PEM: Optional[bytes] = None

try:  # pragma: no cover - exercised implicitly on import
    from pyattest.attestation import Attestation as _Attestation
    from pyattest.configs.apple import AppleConfig as _AppleConfig
    from pyattest.exceptions import PyAttestException as _PyAttestException
    AVAILABLE = True
except Exception as _imp_exc:  # noqa: BLE001 — missing dep = mode stays unregistered
    _Attestation = _AppleConfig = None  # type: ignore[assignment]
    _PyAttestException = Exception  # type: ignore[assignment,misc]
    AVAILABLE = False
    logger.error("[palco.app_attest] pyattest unavailable (%s) — app_attest enrollment FAIL-CLOSED", _imp_exc)


def _b64_decode(data: str, max_len: int) -> Optional[bytes]:
    """Standard base64 (what iOS `base64EncodedString()` emits); size-capped."""
    if not isinstance(data, str) or not data or len(data) > max_len:
        return None
    try:
        return base64.b64decode(data, validate=True)
    except Exception:  # noqa: BLE001 — malformed input is a refusal, not a 500
        return None


async def attest(challenge: str, pubkey_jwk: Mapping[str, Any], key_id: str,
                 attestation: Mapping[str, Any]) -> Dict[str, Any]:
    """Attester entrypoint (enroll.Attester shape, async — registry awaits it)."""
    if not AVAILABLE:  # registration is guarded, but double fail-closed
        return {"ok": False}

    binding = enroll.enroll_binding_payload(challenge, key_id)

    # 1) Proof-of-possession of the wallet signing key — same bar as sandbox.
    pub = crypto.load_p256_jwk(dict(pubkey_jwk))
    pop_sig = str((attestation or {}).get("pop_sig") or "")
    if pub is None or not pop_sig or not crypto.verify_p256(pub, binding, pop_sig):
        return {"ok": False}

    # 2) The App Attest object. The client passed the SAME binding string to
    #    attestKeyAsync (native side hashes it to clientDataHash), and pyattest
    #    re-derives sha256(authData || sha256(binding)) for the nonce check.
    aa_key_id = _b64_decode(str((attestation or {}).get("key_id") or ""), 128)
    att_raw = _b64_decode(str((attestation or {}).get("attestation") or ""), _MAX_ATTESTATION_B64)
    if aa_key_id is None or len(aa_key_id) != _AA_KEY_ID_LEN or att_raw is None:
        return {"ok": False}

    config = _AppleConfig(key_id=aa_key_id, app_id=APP_ID, production=PRODUCTION,
                          root_ca=_TEST_ROOT_CA_PEM)
    try:
        obj = _Attestation(att_raw, binding.encode(), config)
        await obj.verify()
    except _PyAttestException as exc:
        logger.info("[palco.app_attest] attestation refused: %s", type(exc).__name__)
        return {"ok": False}
    except Exception as exc:  # noqa: BLE001 — malformed CBOR etc.; refuse, never 500
        logger.info("[palco.app_attest] attestation unreadable: %s", type(exc).__name__)
        return {"ok": False}

    return {
        "ok": True,
        "hw_tier": MODE,
        # PII-free audit trail: which App Attest key backed this enrollment, and a
        # digest of the attestation object (the ~5.5 KB blob itself is not stored).
        "record": {
            "aa_key_id": base64.b64encode(aa_key_id).decode(),
            "att_sha256": hashlib.sha256(att_raw).hexdigest(),
            "aa_env": "production" if PRODUCTION else "development",
        },
    }


if AVAILABLE:
    enroll.register_attester(MODE, attest)
