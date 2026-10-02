"""P1-2 (audit 2026-10-01): a non-ASCII QR token crashed the gate instead of failing it.

qr_credential.verify compared the attacker-controlled wire token with
hmac.compare_digest(str, str), which raises TypeError on non-ASCII — a 500 at the
door instead of FALSIFICADO. parse_wire now requires ^[0-9a-f]{12}$ (None → the
callers' FALSIFICADO), verify shape-checks as defence in depth, and civic_demo
routes its verdict through the ONE shared verifier (no inline compare).
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import qr_credential as qc  # noqa: E402

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GOOD_C = 178_080_000
NOW_MS = GOOD_C * 10 * 1000 + 1_500


def test_cross_runtime_vector_is_untouched() -> None:
    assert qc.derive_token("tkt_demo1", "s3cret", GOOD_C) == "5d22f5379637"


def test_roundtrip_still_parses_and_verifies() -> None:
    w = qc.build_wire("AMOTKT1", "tkt_demo1", "s3cret", now_ms=NOW_MS)
    p = qc.parse_wire("AMOTKT1", w)
    assert p == {"entity_id": "tkt_demo1", "counter": GOOD_C, "token": "5d22f5379637"}
    assert qc.verify(p, "s3cret", now_ms=NOW_MS) == "OK"
    assert qc.verify(p, "wrong", now_ms=NOW_MS) == "COUNTERFEIT"
    assert qc.verify(p, "s3cret", now_ms=NOW_MS + 40_000) == "EXPIRED"


@pytest.mark.parametrize("token", [
    "5d22f537963",        # 11 chars
    "5d22f53796377",      # 13 chars
    "5D22F5379637",       # uppercase hex — derive_token is lowercase
    "zzzzzzzzzzzz",       # non-hex ASCII
    "5d22f537963ñ",       # non-ASCII (the TypeError case)
    "ñññññññññññ",        # all non-ASCII
    "5d22f53796 7",       # inner whitespace (the payload-level strip only trims the ends)
])
def test_parse_wire_rejects_malformed_tokens(token: str) -> None:
    assert qc.parse_wire("AMOTKT1", f"AMOTKT1.tkt_demo1.{GOOD_C}.{token}") is None


def test_parse_wire_keeps_trimming_a_pasted_payload() -> None:
    assert qc.parse_wire("AMOTKT1", f" AMOTKT1.tkt_demo1.{GOOD_C}.5d22f5379637 \n") is not None


def test_parse_wire_rejects_wrong_namespace_and_counter_as_before() -> None:
    assert qc.parse_wire("AMOTKT1", "PALCO1.x.1.5d22f5379637") is None
    assert qc.parse_wire("AMOTKT1", "AMOTKT1.x.NaN.5d22f5379637") is None
    assert qc.parse_wire("AMOTKT1", "garbage") is None
    assert qc.parse_wire("AMOTKT1", "") is None


def test_verify_never_raises_on_a_hand_built_bad_token() -> None:
    for bad in ("ñññññññññññ", "ZZZZZZZZZZZZ", "", None, 12):
        assert qc.verify({"entity_id": "tkt_demo1", "counter": GOOD_C, "token": bad}, "s3cret", now_ms=NOW_MS) == "COUNTERFEIT"


def test_civic_uses_the_shared_verifier_only() -> None:
    with open(os.path.join(BACKEND, "civic_demo.py"), encoding="utf-8") as f:
        src = f.read()
    body = src[src.index("async def _verdict_for_wire("):]
    body = body[: body.index("\n\n\n")]
    assert "_qc.verify(" in body
    assert "hmac.compare_digest" not in body and "derive_token(" not in body, "no second verifier in the civic gate"
    assert 'v == "COUNTERFEIT"' in body and 'v == "EXPIRED"' in body
    assert "import hmac" not in src, "civic_demo no longer compares tokens itself"


def test_civic_scan_answers_falsificado_for_a_non_ascii_token() -> None:
    """End to end through the civic parse → the token shape fails in parse_wire, so the
    gate never reaches a compare that could raise."""
    import civic_demo as C
    assert C.parse_wire(f"{C.WIRE_VERSION}.civ_ab12cd34ef.{GOOD_C}.5d22f537963ñ") is None
    assert C.parse_wire(f"{C.WIRE_VERSION}.civ_ab12cd34ef.{GOOD_C}.5d22f5379637") is not None
