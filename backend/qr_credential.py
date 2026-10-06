"""qr_credential.py — the ONE rotating-QR credential engine (PALCO1, byte-identical).

Shared by the civic demo (AMOCIV1), consumer tickets (AMOTKT1) and the City Pass
(AMOPASS1). Wire: <NS>.<id>.<counter>.<hex12 HMAC-SHA256(secret, "id|counter")>,
counter = floor(epoch/10 s), gate skew ±1 — a screenshot dies in ≤20 s. Cross-
runtime vector proven (py == node == 5d22f5379637). Verify NEVER decides
duplicates — that is the caller's atomic find_one_and_update. Production
hardening path: Ed25519 (PALCO2), already proven in palco-core.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import time
from typing import Any, Dict, Optional

TOKEN_STEP_SECONDS = 10
TOKEN_SKEW_STEPS = 1
TOKEN_LEN = 12
# derive_token is a hex digest prefix, so a genuine token is exactly 12 lowercase hex
# chars. hmac.compare_digest(str, str) raises TypeError on non-ASCII input, so an
# attacker-controlled token must be shape-checked BEFORE the compare (P1, audit
# 2026-10-01): anything else is a forgery, never a 500.
TOKEN_RE = re.compile(r"^[0-9a-f]{12}$")
# Counters are canonical decimal: int() alone also accepts "+1", "1_0", leading
# zeros and unicode digits — all verifying as the SAME credential+counter, i.e.
# many spellings of one wire. One spelling only (PALCO-V2 hardening, 2026-10-06);
# build_wire always emitted this form, so genuine wires are unaffected.
COUNTER_RE = re.compile(r"^(?:0|[1-9][0-9]{0,11})$")


def counter_for_now(now_ms: Optional[int] = None) -> int:
    ms = now_ms if now_ms is not None else int(time.time() * 1000)
    return ms // 1000 // TOKEN_STEP_SECONDS


def step_remaining_ms(now_ms: Optional[int] = None) -> int:
    ms = now_ms if now_ms is not None else int(time.time() * 1000)
    period = TOKEN_STEP_SECONDS * 1000
    return period - (ms % period)


def derive_token(entity_id: str, secret: str, counter: int) -> str:
    digest = hmac.new(secret.encode(), f"{entity_id}|{counter}".encode(), hashlib.sha256).hexdigest()
    return digest[:TOKEN_LEN]


def build_wire(namespace: str, entity_id: str, secret: str, now_ms: Optional[int] = None) -> str:
    c = counter_for_now(now_ms)
    return f"{namespace}.{entity_id}.{c}.{derive_token(entity_id, secret, c)}"


def parse_wire(namespace: str, payload: str) -> Optional[Dict[str, Any]]:
    parts = (payload or "").strip().split(".")
    if len(parts) != 4 or parts[0] != namespace or not parts[1] or not parts[3]:
        return None
    if not COUNTER_RE.match(parts[2]):
        return None
    counter = int(parts[2])
    if not TOKEN_RE.match(parts[3]):
        return None   # malformed / non-hex / non-ASCII token → callers answer FALSIFICADO
    return {"entity_id": parts[1], "counter": counter, "token": parts[3]}


def verify(parsed: Dict[str, Any], secret: str, now_ms: Optional[int] = None) -> str:
    """'OK' | 'COUNTERFEIT' | 'EXPIRED' — stale is never conflated with forged."""
    token = parsed.get("token")
    if not isinstance(token, str) or not TOKEN_RE.match(token):
        return "COUNTERFEIT"   # defence in depth for callers that bypass parse_wire
    expected = derive_token(parsed["entity_id"], secret, parsed["counter"])
    if not hmac.compare_digest(expected, token):
        return "COUNTERFEIT"
    if abs(counter_for_now(now_ms) - parsed["counter"]) > TOKEN_SKEW_STEPS:
        return "EXPIRED"
    return "OK"
