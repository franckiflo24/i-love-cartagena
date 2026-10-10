"""Passkit unit tests — pure builders + signed-URL token discipline.

No DB, no network: build_pass_json / build_ics / build_pkpass are pure, and the
pkpass signature is exercised with a throwaway self-signed identity generated
in-test (never the real Pass Type ID key, which lives only in Vercel env).
"""
import datetime
import hashlib
import io
import json
import zipfile

import pytest
from fastapi import HTTPException

import passkit


TICKET = {
    "ticket_id": "amt_0123456789",
    "kind": "event_rsvp",
    "event_id": "ae_x1",
    "title": "Noche de Champeta",
    "venue_name": "Casa Bohême",
    "partner_name": "Casa Bohême",
    "holder_name": "Dana",
    "date": "2026-11-20",
    "start_time": "21:00",
    "status": "issued",
}


# ── pass.json ─────────────────────────────────────────────────────────────────

def test_pass_json_core_fields():
    p = passkit.build_pass_json(TICKET)
    assert p["passTypeIdentifier"] == "pass.com.amocartagena.app"
    assert p["teamIdentifier"] == "4C39DXRG9L"
    assert p["serialNumber"] == "amt_0123456789"
    assert p["eventTicket"]["primaryFields"][0]["value"] == "Noche de Champeta"
    # Cartagena is UTC-5 fixed: relevantDate carries the explicit offset.
    assert p["relevantDate"] == "2026-11-20T21:00:00-05:00"
    assert "voided" not in p


def test_pass_json_is_companion_not_credential():
    """HONESTY SPINE: no barcode of any spelling — the rotating QR stays the only credential."""
    p = passkit.build_pass_json(TICKET)
    assert "barcode" not in p and "barcodes" not in p
    back = json.dumps(p["eventTicket"]["backFields"])
    assert "amocartagena.co/ticket/amt_0123456789" in back


def test_pass_json_used_ticket_is_voided_and_dateless_has_no_relevant():
    used = dict(TICKET, status="used", date="", start_time="")
    p = passkit.build_pass_json(used)
    assert p.get("voided") is True
    assert "relevantDate" not in p


# ── .pkpass package ───────────────────────────────────────────────────────────

def _throwaway_identity():
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    def mk(cn):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])
        now = datetime.datetime.now(datetime.timezone.utc)
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                .public_key(key.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(now - datetime.timedelta(days=1))
                .not_valid_after(now + datetime.timedelta(days=30)).sign(key, hashes.SHA256()))
        return (cert.public_bytes(serialization.Encoding.PEM),
                key.private_bytes(serialization.Encoding.PEM,
                                  serialization.PrivateFormat.PKCS8,
                                  serialization.NoEncryption()))
    cert_pem, key_pem = mk("Test Pass Signer")
    wwdr_pem, _ = mk("Test WWDR")
    return {"cert": cert_pem, "key": key_pem, "wwdr": wwdr_pem}


def test_pkpass_package_manifest_and_signature():
    blob = passkit.build_pkpass(passkit.build_pass_json(TICKET), _throwaway_identity())
    z = zipfile.ZipFile(io.BytesIO(blob))
    names = set(z.namelist())
    assert {"pass.json", "manifest.json", "signature", "icon.png", "icon@2x.png",
            "icon@3x.png", "logo.png", "logo@2x.png"} == names
    manifest = json.loads(z.read("manifest.json"))
    for name, digest in manifest.items():
        assert hashlib.sha1(z.read(name)).hexdigest() == digest  # noqa: S324 — PassKit spec
    sig = z.read("signature")
    assert sig[:1] == b"\x30" and len(sig) > 500  # DER SEQUENCE, real PKCS#7 size
    assert json.loads(z.read("pass.json"))["serialNumber"] == TICKET["ticket_id"]


# ── .ics ──────────────────────────────────────────────────────────────────────

def test_ics_timed_event_converts_bogota_to_utc():
    ics = passkit.build_ics(TICKET)
    assert "DTSTART:20261121T020000Z" in ics  # 21:00-05:00 → 02:00Z next day
    assert "DTEND:20261121T050000Z" in ics
    assert "SUMMARY:Noche de Champeta" in ics
    assert "LOCATION:Casa Bohême\\, Cartagena de Indias\\, Colombia" in ics
    assert ics.endswith("\r\n") and "UID:amt_0123456789@amocartagena.co" in ics


def test_ics_allday_and_missing_date():
    allday = passkit.build_ics(dict(TICKET, start_time=""))
    assert "DTSTART;VALUE=DATE:20261120" in allday and "DTEND;VALUE=DATE:20261121" in allday
    assert passkit.build_ics(dict(TICKET, date="")) is None
    assert passkit.build_ics(dict(TICKET, date="pronto")) is None


# ── signed-URL tokens ─────────────────────────────────────────────────────────

def test_token_roundtrip_tamper_and_expiry(monkeypatch):
    monkeypatch.setenv("PKPASS_URL_SECRET", "s3cr3t-test")
    import time
    exp = int(time.time()) + 60
    tok = passkit._token("pass", "amt_0123456789", exp)
    passkit._check_token("pass", "amt_0123456789", str(exp), tok)  # no raise
    for bad in [("ics", "amt_0123456789", str(exp), tok),          # wrong kind
                ("pass", "amt_9999999999", str(exp), tok),          # wrong ticket
                ("pass", "amt_0123456789", str(exp), tok[:-1] + ("0" if tok[-1] != "0" else "1")),
                ("pass", "amt_0123456789", str(exp - 120), passkit._token("pass", "amt_0123456789", exp - 120)),
                ("pass", "amt_0123456789", "garbage", tok),
                ("pass", "amt_0123456789", str(exp), "ñöñ-àscii-tóken")]:  # non-ASCII must 403, not 500
        with pytest.raises(HTTPException) as exc:
            passkit._check_token(*bad)
        assert exc.value.status_code == 403


def test_token_fails_closed_without_secret(monkeypatch):
    monkeypatch.delenv("PKPASS_URL_SECRET", raising=False)
    with pytest.raises(HTTPException) as exc:
        passkit._token("pass", "amt_0123456789", 2_000_000_000)
    assert exc.value.status_code == 503
    with pytest.raises(HTTPException) as exc2:
        passkit._check_token("pass", "amt_0123456789", "2000000000", "x" * 40)
    assert exc2.value.status_code == 503
