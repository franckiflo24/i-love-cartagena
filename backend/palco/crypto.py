# PALCO Credential Engine v2 — © MachineMind Consulting.
# Licensed to AMO (Amo Cartagena S.A.S.) and city partners; never transferred.
"""Asymmetric primitives (contract: docs/palco-v2/DESIGN.md §2, §7.3).

- Wire signatures: ECDSA P-256, raw r‖s (64 B) base64url, signed ON DEVICE by a
  non-exportable key. The server holds PUBLIC JWKs only — the qr_secret leak
  class (a per-credential symmetric key on a readable document) cannot exist on
  this tier.
- Manifests: Ed25519, server private key from env PALCO_MANIFEST_SK (32-byte
  hex seed); the Validador app pins the public key.
- Key ids: RFC 7638 JWK thumbprint input (EC/P-256 canonical members), SHA-256,
  first 12 hex — matches the wire's <key_id> field.

Verification failures NEVER raise to callers: they return False and the
pipeline answers FALSIFICADO (stale is a separate, honest EXPIRADO).
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
from typing import Any, Dict, Optional, Tuple

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, ed25519
from cryptography.hazmat.primitives.asymmetric.utils import (
    decode_dss_signature, encode_dss_signature)

_P256_COORD_LEN = 32
_RAW_SIG_LEN = 64


def b64u_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def b64u_decode(data: str) -> Optional[bytes]:
    try:
        pad = "=" * (-len(data) % 4)
        return base64.urlsafe_b64decode(data + pad)
    except Exception:  # noqa: BLE001 — malformed input is a verdict, not a 500
        return None


# ── P-256 public keys (JWK in, verification only — no private keys server-side) ──

def load_p256_jwk(jwk: Dict[str, Any]) -> Optional[ec.EllipticCurvePublicKey]:
    try:
        if jwk.get("kty") != "EC" or jwk.get("crv") != "P-256":
            return None
        x = b64u_decode(str(jwk.get("x") or ""))
        y = b64u_decode(str(jwk.get("y") or ""))
        if not x or not y or len(x) != _P256_COORD_LEN or len(y) != _P256_COORD_LEN:
            return None
        nums = ec.EllipticCurvePublicNumbers(
            int.from_bytes(x, "big"), int.from_bytes(y, "big"), ec.SECP256R1())
        return nums.public_key()
    except Exception:  # noqa: BLE001
        return None


def key_id_for_jwk(jwk: Dict[str, Any]) -> Optional[str]:
    """RFC 7638 thumbprint members for EC, SHA-256, first 12 hex."""
    try:
        canonical = json.dumps(
            {"crv": jwk["crv"], "kty": jwk["kty"], "x": jwk["x"], "y": jwk["y"]},
            separators=(",", ":"), sort_keys=True)
        return hashlib.sha256(canonical.encode()).hexdigest()[:12]
    except Exception:  # noqa: BLE001
        return None


def verify_p256(pub: ec.EllipticCurvePublicKey, payload: str, sig_b64u: str) -> bool:
    raw = b64u_decode(sig_b64u)
    if not raw or len(raw) != _RAW_SIG_LEN:
        return False
    try:
        der = encode_dss_signature(
            int.from_bytes(raw[:_P256_COORD_LEN], "big"),
            int.from_bytes(raw[_P256_COORD_LEN:], "big"))
        pub.verify(der, payload.encode(), ec.ECDSA(hashes.SHA256()))
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False
    except Exception:  # noqa: BLE001
        return False


# ── test/dev helper: software P-256 keypair (devices use Secure Enclave/Keystore;
#    this exists so the whole pipeline is provable in pytest without hardware) ──

def generate_p256_keypair() -> Tuple[ec.EllipticCurvePrivateKey, Dict[str, str]]:
    priv = ec.generate_private_key(ec.SECP256R1())
    nums = priv.public_key().public_numbers()
    jwk = {
        "kty": "EC", "crv": "P-256",
        "x": b64u_encode(nums.x.to_bytes(_P256_COORD_LEN, "big")),
        "y": b64u_encode(nums.y.to_bytes(_P256_COORD_LEN, "big")),
    }
    return priv, jwk


def sign_p256_raw(priv: ec.EllipticCurvePrivateKey, payload: str) -> str:
    der = priv.sign(payload.encode(), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    return b64u_encode(r.to_bytes(_P256_COORD_LEN, "big") + s.to_bytes(_P256_COORD_LEN, "big"))


# ── Ed25519 manifests (server-signed; Validador pins the public key) ──────────

def manifest_key_from_env() -> Optional[ed25519.Ed25519PrivateKey]:
    seed_hex = os.environ.get("PALCO_MANIFEST_SK") or ""
    try:
        seed = bytes.fromhex(seed_hex)
        if len(seed) != 32:
            return None
        return ed25519.Ed25519PrivateKey.from_private_bytes(seed)
    except Exception:  # noqa: BLE001
        return None


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"), sort_keys=True, ensure_ascii=True)


def sign_manifest(priv: ed25519.Ed25519PrivateKey, body: Dict[str, Any]) -> str:
    return b64u_encode(priv.sign(canonical_json(body).encode()))


def manifest_public_hex(priv: ed25519.Ed25519PrivateKey) -> str:
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    return priv.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw).hex()


def verify_manifest(public_hex: str, body: Dict[str, Any], sig_b64u: str) -> bool:
    try:
        pub = ed25519.Ed25519PublicKey.from_public_bytes(bytes.fromhex(public_hex))
        raw = b64u_decode(sig_b64u)
        if not raw:
            return False
        pub.verify(raw, canonical_json(body).encode())
        return True
    except Exception:  # noqa: BLE001
        return False
