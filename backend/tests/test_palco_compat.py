"""PALCO v2 ↔ v1 compatibility + copy rules.
Locks: the v1 byte-contract stays intact (vector, grammar, polling shape),
the v1 adapter serves inspectors verify-only without consuming, canonical
counters, and the §0 claims language rule over engine + credential UI sources."""
from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import qr_credential as qc  # noqa: E402
from palco import verify, wire  # noqa: E402
from palco.models import (MODE_VERIFY, V_DUPLICADO, V_EXPIRADO, V_FALSIFICADO,  # noqa: E402
                          V_FUERA, V_PASE, V_VALIDO)

from test_palco_engine import _DB, GOV, SCOPE_A, SCOPE_B, _run  # noqa: E402


# ── byte-compat locks (the v1 contract must not drift) ────────────────────────

def test_v1_vector_and_grammar_unchanged() -> None:
    assert qc.derive_token("tkt_demo1", "s3cret", 178080000) == "5d22f5379637"
    w = qc.build_wire("AMOTKT1", "amt_0123456789", "s3cret")
    assert qc.parse_wire("AMOTKT1", w) is not None
    assert qc.TOKEN_STEP_SECONDS == 10 and qc.TOKEN_SKEW_STEPS == 1


def test_v1_counter_is_canonical_now() -> None:
    c = qc.counter_for_now()
    tok = qc.derive_token("amt_0123456789", "s3cret", c)
    assert qc.parse_wire("AMOTKT1", f"AMOTKT1.amt_0123456789.{c}.{tok}") is not None
    for spelling in (f"+{c}", f"0{c}", f"{c:_}", f" {c}"):
        assert qc.parse_wire("AMOTKT1", f"AMOTKT1.amt_0123456789.{spelling}.{tok}") is None
    # whole-payload surrounding whitespace stays tolerated (paste behavior)
    assert qc.parse_wire("AMOTKT1", f"  AMOTKT1.amt_0123456789.{c}.{tok}  ") is not None


def test_palco1_literal_prefix_still_rejected() -> None:
    assert qc.parse_wire("AMOTKT1", "PALCO1.amt_0123456789.178080000.5d22f5379637") is None
    assert wire.parse_wire_v1("PALCO1.amt_0123456789.178080000.5d22f5379637") is None


# ── legacy tier through the v2 pipeline: verify-only, never consuming ─────────

def _seed_ticket(db: _DB, status="issued"):
    sec = "a" * 32
    db.amo_tickets.rows.append({
        "ticket_id": "amt_1234567890", "kind": "event_rsvp", "user_id": "u1",
        "holder_name": "Ana Viajera", "event_id": "pe_v2", "partner_id": "ptr_A",
        "title": "Prueba", "qr_secret": sec, "status": status,
        "used_at": "2026-10-01T00:00:00Z" if status == "used" else None,
        "used_gate": "G1" if status == "used" else None})
    return sec


def test_legacy_ticket_verify_only_never_flips() -> None:
    db = _DB()
    sec = _seed_ticket(db)
    w = qc.build_wire("AMOTKT1", "amt_1234567890", sec)
    r = _run(verify.verify_scan(db, w, SCOPE_A))
    assert r["verdict"] == V_VALIDO and r["mode"] == MODE_VERIFY and r["tier"] == "legacy"
    assert db.amo_tickets.rows[0]["status"] == "issued"  # consuming stays on /business/tickets/scan
    db.amo_tickets.rows[0]["status"] = "used"
    r2 = _run(verify.verify_scan(db, w, SCOPE_A))
    assert r2["verdict"] == V_DUPLICADO
    r3 = _run(verify.verify_scan(db, w, SCOPE_B))
    assert r3["verdict"] == V_FUERA


def test_legacy_ticket_stale_and_tampered() -> None:
    db = _DB()
    sec = _seed_ticket(db)
    c = qc.counter_for_now() - (qc.TOKEN_SKEW_STEPS + 2)
    stale = f"AMOTKT1.amt_1234567890.{c}.{qc.derive_token('amt_1234567890', sec, c)}"
    assert _run(verify.verify_scan(db, stale, SCOPE_A))["verdict"] == V_EXPIRADO
    good = qc.build_wire("AMOTKT1", "amt_1234567890", sec)
    bad = good[:-12] + ("0" * 12 if not good.endswith("0" * 12) else "1" * 12)
    assert _run(verify.verify_scan(db, bad, SCOPE_A))["verdict"] == V_FALSIFICADO


def test_legacy_city_pass_pase_semantics() -> None:
    db = _DB()
    db.city_passes.rows.append({
        "pass_id": "cp_abcdef123456", "user_id": "u1", "plan_id": "basic",
        "qr_secret": "b" * 32, "is_active": True, "expires_at": "2027-01-01T00:00:00+00:00"})
    w = qc.build_wire("AMOPASS1", "cp_abcdef123456", "b" * 32)
    assert _run(verify.verify_scan(db, w, SCOPE_B))["verdict"] == V_PASE  # cross-venue perks pass
    db.city_passes.rows[0]["is_active"] = False
    assert _run(verify.verify_scan(db, w, SCOPE_B))["verdict"] == V_EXPIRADO


def test_legacy_civic_is_government_surface_only() -> None:
    db = _DB()
    db.civic_demo_tickets.rows.append({
        "ticket_id": "civ_0123456789", "kind": "credential", "qr_secret": "c" * 32,
        "status": "issued"})
    w = qc.build_wire("AMOCIV1", "civ_0123456789", "c" * 32)
    assert _run(verify.verify_scan(db, w, SCOPE_A))["verdict"] == V_FUERA
    assert _run(verify.verify_scan(db, w, GOV))["verdict"] == V_VALIDO
    assert db.civic_demo_tickets.rows[0]["status"] == "issued"


def test_garbage_wires_are_falsificado_never_500() -> None:
    db = _DB()
    for junk in ("", "x", "AMO2.", "AMO2.a.b.c.d", "AMOX9.amt_1.1.aaaaaaaaaaaa",
                 "AMO2.crd_123456789abc.1.ffffffffffff." + "A" * 86):
        r = _run(verify.verify_scan(db, junk, SCOPE_A))
        assert r["verdict"] == V_FALSIFICADO


# ── §0 claims language rule over engine + credential UI sources ──────────────

_BANNED = re.compile(
    r"unhackable|unforgeable|imposible\s+de\s+(falsificar|hackear|clonar)|100%\s*segur|inviolable",
    re.IGNORECASE)

_SOURCES = [
    BACKEND / "palco",
    BACKEND / "qr_credential.py",
    BACKEND / "tickets.py",
    BACKEND.parent / "frontend" / "src" / "components" / "tickets",
    BACKEND.parent / "frontend" / "app" / "ticket",
    BACKEND.parent / "frontend" / "app" / "tickets.tsx",
    BACKEND.parent / "frontend" / "app" / "business" / "scanner.tsx",
]


def _iter_files():
    for p in _SOURCES:
        if p.is_file():
            yield p
        elif p.is_dir():
            yield from (f for f in p.rglob("*") if f.suffix in (".py", ".ts", ".tsx"))


def test_no_absolute_security_claims_in_sources() -> None:
    offenders = []
    for f in _iter_files():
        text = f.read_text(encoding="utf-8", errors="ignore")
        if _BANNED.search(text):
            offenders.append(str(f))
    assert offenders == [], f"absolute security claims found in: {offenders}"
