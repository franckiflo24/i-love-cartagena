"""PALCO v2 Stage B — Apple App Attest attester (DESIGN §5, §13.5).

Exercises the REAL verification path (CBOR -> chain -> nonce -> key id -> app id ->
counter -> aaguid -> credential id) by forging an attestation chain against a test
root CA injected through the module's test hook — pyattest accepts a custom trust
root exactly for this. No network, no hardware, server.py never imported.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import struct
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from palco import app_attest, crypto, enroll  # noqa: E402
from test_palco_stage_b import _DB  # noqa: E402 — shared in-memory fake

cbor2 = pytest.importorskip("cbor2")
pytest.importorskip("pyattest")

from asn1crypto.keys import PublicKeyInfo  # noqa: E402 — pyattest dependency
from cryptography import x509  # noqa: E402
from cryptography.hazmat.primitives import hashes, serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402

APP_ID = "4C39DXRG9L.com.amocartagena.app"
AAGUID_PROD = b"appattest" + b"\x00" * 7
AAGUID_DEV = b"appattestdevelop"
NONCE_OID = x509.ObjectIdentifier("1.2.840.113635.100.8.2")


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


# ── forged-chain factory ─────────────────────────────────────────────────────────

def _name(cn: str) -> x509.Name:
    return x509.Name([x509.NameAttribute(x509.NameOID.COMMON_NAME, cn)])


def _make_root():
    key = ec.generate_private_key(ec.SECP256R1())
    now = datetime.now(timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(_name("Fake App Attest Root"))
        .issuer_name(_name("Fake App Attest Root"))
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=30))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .add_extension(x509.KeyUsage(
            digital_signature=True, key_cert_sign=True, crl_sign=True,
            content_commitment=False, key_encipherment=False, data_encipherment=False,
            key_agreement=False, encipher_only=False, decipher_only=False), critical=True)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False)
        .sign(key, hashes.SHA256())
    )
    return key, cert


def _fake(nonce_str: str, *, app_id: str = APP_ID, aaguid: bytes = AAGUID_PROD,
          counter: int = 0, root=None):
    """Build (attestation_dict_fields, root_pem) the way a genuine device would,
    except signed by our fake root. Returns (aa_key_id_b64, att_b64, root_pem)."""
    root_key, root_cert = root or _make_root()
    leaf_key = ec.generate_private_key(ec.SECP256R1())
    spki = leaf_key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    aa_key_id = PublicKeyInfo.load(spki).sha256   # what pyattest compares against

    auth_data = (
        hashlib.sha256(app_id.encode()).digest()   # rp_id
        + b"\x40"                                   # flags
        + struct.pack("!I", counter)
        + aaguid
        + struct.pack("!H", len(aa_key_id))
        + aa_key_id
    )
    # leaf nonce extension: SEQUENCE([1] OCTET STRING(expected_nonce)) — pyattest
    # reads extension value contents[6:].
    expected_nonce = hashlib.sha256(
        auth_data + hashlib.sha256(nonce_str.encode()).digest()).digest()
    ext_der = b"\x30\x24\xa1\x22\x04\x20" + expected_nonce

    now = datetime.now(timezone.utc)
    leaf = (
        x509.CertificateBuilder()
        .subject_name(_name("Fake credCert"))
        .issuer_name(root_cert.subject)
        .public_key(leaf_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=30))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.KeyUsage(
            digital_signature=True, key_cert_sign=False, crl_sign=False,
            content_commitment=False, key_encipherment=False, data_encipherment=False,
            key_agreement=False, encipher_only=False, decipher_only=False), critical=True)
        .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(
            root_key.public_key()), critical=False)
        .add_extension(x509.UnrecognizedExtension(NONCE_OID, ext_der), critical=False)
        .sign(root_key, hashes.SHA256())
    )
    att = cbor2.dumps({
        "fmt": "apple-appattest",
        "attStmt": {"x5c": [leaf.public_bytes(serialization.Encoding.DER)], "receipt": b""},
        "authData": auth_data,
    })
    root_pem = root_cert.public_bytes(serialization.Encoding.PEM)
    return base64.b64encode(aa_key_id).decode(), base64.b64encode(att).decode(), root_pem


@pytest.fixture()
def aa_env(monkeypatch):
    """Pin the module to the production app id; the test root is injected per test."""
    monkeypatch.setattr(app_attest, "APP_ID", APP_ID)
    monkeypatch.setattr(app_attest, "PRODUCTION", True)
    def use_root(pem: bytes):
        monkeypatch.setattr(app_attest, "_TEST_ROOT_CA_PEM", pem)
    return use_root


async def _enroll_with(db, attestation_extra: dict, nonce_override: str | None = None):
    """Shared flow: software wallet key + challenge + PoP, then app_attest verify."""
    priv, jwk = crypto.generate_p256_keypair()
    key_id = crypto.key_id_for_jwk(jwk)
    ch = await enroll.new_challenge(db, "u1")
    binding = enroll.enroll_binding_payload(ch["challenge"], key_id)
    pop = crypto.sign_p256_raw(priv, binding)
    att = {"mode": "app_attest", "pop_sig": pop, **attestation_extra}
    out = await enroll.verify_enrollment(db, "u1", ch["challenge_id"], jwk, att, "ios")
    return out, key_id, (nonce_override or binding)


# ── tests ────────────────────────────────────────────────────────────────────────

def test_attester_registered():
    assert app_attest.AVAILABLE
    assert "app_attest" in enroll._ATTESTERS


def test_happy_path_binds_device_with_app_attest_tier(aa_env):
    db = _DB()
    async def go():
        priv, jwk = crypto.generate_p256_keypair()
        key_id = crypto.key_id_for_jwk(jwk)
        ch = await enroll.new_challenge(db, "u1")
        binding = enroll.enroll_binding_payload(ch["challenge"], key_id)
        aa_key_id, att_b64, root_pem = _fake(binding)
        aa_env(root_pem)
        out = await enroll.verify_enrollment(
            db, "u1", ch["challenge_id"], jwk,
            {"mode": "app_attest", "pop_sig": crypto.sign_p256_raw(priv, binding),
             "key_id": aa_key_id, "attestation": att_b64}, "ios")
        assert out["device_key_id"] == key_id and out["hw_tier"] == "app_attest"
        dev = await db.credential_devices.find_one({"device_key_id": key_id})
        assert dev["hw_tier"] == "app_attest"
        assert dev["attestation"]["mode"] == "app_attest"
        assert dev["attestation"]["aa_key_id"] == aa_key_id
        assert dev["attestation"]["aa_env"] == "production"
        assert len(dev["attestation"]["att_sha256"]) == 64
    _run(go())


def _expect_refusal(db, attestation_extra):
    async def go():
        with pytest.raises(enroll.EnrollError) as e:
            await _enroll_with(db, attestation_extra)
        assert str(e.value) == "attestation_failed"
        assert db.credential_devices.rows == []
    _run(go())


def test_wrong_nonce_rejected(aa_env):
    """Attestation minted for a DIFFERENT challenge/key binding replays nowhere."""
    db = _DB()
    aa_key_id, att_b64, root_pem = _fake("palco-enroll|other-challenge|000000000000")
    aa_env(root_pem)
    _expect_refusal(db, {"key_id": aa_key_id, "attestation": att_b64})


def test_key_id_mismatch_rejected(aa_env):
    db = _DB()
    async def go():
        priv, jwk = crypto.generate_p256_keypair()
        key_id = crypto.key_id_for_jwk(jwk)
        ch = await enroll.new_challenge(db, "u1")
        binding = enroll.enroll_binding_payload(ch["challenge"], key_id)
        _, att_b64, root_pem = _fake(binding)
        aa_env(root_pem)
        wrong = base64.b64encode(hashlib.sha256(b"not-that-key").digest()).decode()
        with pytest.raises(enroll.EnrollError) as e:
            await enroll.verify_enrollment(
                db, "u1", ch["challenge_id"], jwk,
                {"mode": "app_attest", "pop_sig": crypto.sign_p256_raw(priv, binding),
                 "key_id": wrong, "attestation": att_b64}, "ios")
        assert str(e.value) == "attestation_failed"
    _run(go())


def test_pop_still_required_with_valid_attestation(aa_env):
    """App Attest proves the app; it does NOT replace possession of the wallet key."""
    db = _DB()
    async def go():
        priv, jwk = crypto.generate_p256_keypair()
        other, _ = crypto.generate_p256_keypair()
        key_id = crypto.key_id_for_jwk(jwk)
        ch = await enroll.new_challenge(db, "u1")
        binding = enroll.enroll_binding_payload(ch["challenge"], key_id)
        aa_key_id, att_b64, root_pem = _fake(binding)
        aa_env(root_pem)
        with pytest.raises(enroll.EnrollError) as e:
            await enroll.verify_enrollment(
                db, "u1", ch["challenge_id"], jwk,
                {"mode": "app_attest", "pop_sig": crypto.sign_p256_raw(other, binding),
                 "key_id": aa_key_id, "attestation": att_b64}, "ios")
        assert str(e.value) == "attestation_failed"
        assert db.credential_devices.rows == []
    _run(go())


def test_nonzero_counter_rejected(aa_env):
    db = _DB()
    async def go():
        priv, jwk = crypto.generate_p256_keypair()
        key_id = crypto.key_id_for_jwk(jwk)
        ch = await enroll.new_challenge(db, "u1")
        binding = enroll.enroll_binding_payload(ch["challenge"], key_id)
        aa_key_id, att_b64, root_pem = _fake(binding, counter=3)
        aa_env(root_pem)
        with pytest.raises(enroll.EnrollError):
            await enroll.verify_enrollment(
                db, "u1", ch["challenge_id"], jwk,
                {"mode": "app_attest", "pop_sig": crypto.sign_p256_raw(priv, binding),
                 "key_id": aa_key_id, "attestation": att_b64}, "ios")
    _run(go())


def test_development_aaguid_rejected_in_production(aa_env):
    db = _DB()
    async def go():
        priv, jwk = crypto.generate_p256_keypair()
        key_id = crypto.key_id_for_jwk(jwk)
        ch = await enroll.new_challenge(db, "u1")
        binding = enroll.enroll_binding_payload(ch["challenge"], key_id)
        aa_key_id, att_b64, root_pem = _fake(binding, aaguid=AAGUID_DEV)
        aa_env(root_pem)
        with pytest.raises(enroll.EnrollError):
            await enroll.verify_enrollment(
                db, "u1", ch["challenge_id"], jwk,
                {"mode": "app_attest", "pop_sig": crypto.sign_p256_raw(priv, binding),
                 "key_id": aa_key_id, "attestation": att_b64}, "ios")
    _run(go())


def test_foreign_app_id_rejected(aa_env):
    db = _DB()
    async def go():
        priv, jwk = crypto.generate_p256_keypair()
        key_id = crypto.key_id_for_jwk(jwk)
        ch = await enroll.new_challenge(db, "u1")
        binding = enroll.enroll_binding_payload(ch["challenge"], key_id)
        aa_key_id, att_b64, root_pem = _fake(binding, app_id="4C39DXRG9L.com.other.app")
        aa_env(root_pem)
        with pytest.raises(enroll.EnrollError):
            await enroll.verify_enrollment(
                db, "u1", ch["challenge_id"], jwk,
                {"mode": "app_attest", "pop_sig": crypto.sign_p256_raw(priv, binding),
                 "key_id": aa_key_id, "attestation": att_b64}, "ios")
    _run(go())


def test_untrusted_root_rejected(aa_env):
    """A chain to any root other than the pinned one fails, even if self-consistent."""
    db = _DB()
    async def go():
        priv, jwk = crypto.generate_p256_keypair()
        key_id = crypto.key_id_for_jwk(jwk)
        ch = await enroll.new_challenge(db, "u1")
        binding = enroll.enroll_binding_payload(ch["challenge"], key_id)
        aa_key_id, att_b64, _their_root = _fake(binding)
        _, other_root_cert = _make_root()
        aa_env(other_root_cert.public_bytes(serialization.Encoding.PEM))
        with pytest.raises(enroll.EnrollError):
            await enroll.verify_enrollment(
                db, "u1", ch["challenge_id"], jwk,
                {"mode": "app_attest", "pop_sig": crypto.sign_p256_raw(priv, binding),
                 "key_id": aa_key_id, "attestation": att_b64}, "ios")
    _run(go())


def test_garbage_attestation_refused_not_crashed(aa_env):
    db = _DB()
    _, root_cert = _make_root()
    aa_env(root_cert.public_bytes(serialization.Encoding.PEM))
    garbage = base64.b64encode(b"\x00\x01definitely-not-cbor" * 10).decode()
    key32 = base64.b64encode(hashlib.sha256(b"k").digest()).decode()
    _expect_refusal(db, {"key_id": key32, "attestation": garbage})


def test_missing_fields_refused(aa_env):
    db = _DB()
    _, root_cert = _make_root()
    aa_env(root_cert.public_bytes(serialization.Encoding.PEM))
    _expect_refusal(db, {})                           # no key_id / attestation at all
    _expect_refusal(db, {"key_id": "tooshort", "attestation": ""})


def test_unavailable_module_fails_closed(monkeypatch):
    """If pyattest disappears at runtime the attester refuses rather than downgrades."""
    db = _DB()
    monkeypatch.setattr(app_attest, "AVAILABLE", False)
    _expect_refusal(db, {"key_id": "x", "attestation": "y"})
