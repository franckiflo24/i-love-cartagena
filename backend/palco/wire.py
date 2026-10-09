# PALCO Credential Engine v2 — © MachineMind Consulting.
# Licensed to AMO (Amo Cartagena S.A.S.) and city partners; never transferred.
"""Wire v2 build/parse + the v1 (PALCO1-scheme) adapter (DESIGN §2, §3).

v2:  AMO2.<cred_id>.<counter>.<key_id>.<sig>
     sig = ECDSA P-256 raw r‖s b64url over "<namespace>|<cred_id>|<counter>|<key_id>"
     — the namespace is INSIDE the signature (v1's HMAC omitted it).

v1:  <NS>.<id>.<counter>.<hmac12> for AMOTKT1 / AMOPASS1 / AMOCIV1 stays
     byte-identical through qr_credential.py (vector 5d22f5379637). Literal
     "PALCO1." wires remain rejected — PALCO1 is the scheme name, not a prefix.

Counters are STRICT on v2 (^0|[1-9][0-9]{0,11}$): one credential+counter has
exactly one spelling, so replay dedupe can never be sidestepped by int-parse
leniency. ~131 chars total — under the existing 200-char wire cap and
low-density enough to scan in full sun.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Optional

import qr_credential as _v1

from .models import CRED_ID_RE, KEY_ID_RE, NAMESPACES

WIRE_PREFIX = "AMO2"
STEP_SECONDS = _v1.TOKEN_STEP_SECONDS          # 10 s — one engine, one clock
SKEW_STEPS = _v1.TOKEN_SKEW_STEPS              # ±1 against the VALIDATOR's clock

COUNTER_RE = re.compile(r"^(?:0|[1-9][0-9]{0,11})$")
SIG_RE = re.compile(r"^[A-Za-z0-9_-]{86}$")     # 64-byte raw r‖s, b64url, no padding

V1_NAMESPACES = ("AMOTKT1", "AMOPASS1", "AMOCIV1")

counter_for_now = _v1.counter_for_now
step_remaining_ms = _v1.step_remaining_ms


def signing_payload(namespace: str, cred_id: str, counter: int, key_id: str) -> str:
    return f"{namespace}|{cred_id}|{counter}|{key_id}"


def build_wire(cred_id: str, counter: int, key_id: str, sig_b64u: str) -> str:
    return f"{WIRE_PREFIX}.{cred_id}.{counter}.{key_id}.{sig_b64u}"


def parse_wire_v2(payload: str) -> Optional[Dict[str, Any]]:
    parts = (payload or "").strip().split(".")
    if len(parts) != 5 or parts[0] != WIRE_PREFIX:
        return None
    cred_id, counter_s, key_id, sig = parts[1], parts[2], parts[3], parts[4]
    # fullmatch, never match: re's `$` also matches before a trailing "\n", which would
    # give one credential+counter a second spelling (audit 2026-10-09).
    if not CRED_ID_RE.fullmatch(cred_id) or not COUNTER_RE.fullmatch(counter_s):
        return None
    if not KEY_ID_RE.fullmatch(key_id) or not SIG_RE.fullmatch(sig):
        return None
    return {"cred_id": cred_id, "counter": int(counter_s), "key_id": key_id, "sig": sig}


def parse_wire_v1(payload: str) -> Optional[Dict[str, Any]]:
    """Adapter view over the LEGACY tier: returns {namespace, entity_id, counter,
    token} for the three live v1 namespaces, None otherwise."""
    stripped = (payload or "").strip()
    for ns in V1_NAMESPACES:
        if stripped.startswith(ns + "."):
            parsed = _v1.parse_wire(ns, stripped)
            if parsed is None:
                return None
            return {"namespace": ns, **parsed}
    return None


def counter_fresh(counter: int, now_ms: Optional[int] = None) -> bool:
    return abs(counter_for_now(now_ms) - counter) <= SKEW_STEPS


def is_valid_namespace(ns: str) -> bool:
    return ns in NAMESPACES
