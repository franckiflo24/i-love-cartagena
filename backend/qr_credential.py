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
import time
from typing import Any, Dict, Optional

TOKEN_STEP_SECONDS = 10
TOKEN_SKEW_STEPS = 1
TOKEN_LEN = 12


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
    try:
        counter = int(parts[2])
    except ValueError:
        return None
    return {"entity_id": parts[1], "counter": counter, "token": parts[3]}


def verify(parsed: Dict[str, Any], secret: str, now_ms: Optional[int] = None) -> str:
    """'OK' | 'COUNTERFEIT' | 'EXPIRED' — stale is never conflated with forged."""
    expected = derive_token(parsed["entity_id"], secret, parsed["counter"])
    if not hmac.compare_digest(expected, parsed["token"]):
        return "COUNTERFEIT"
    if abs(counter_for_now(now_ms) - parsed["counter"]) > TOKEN_SKEW_STEPS:
        return "EXPIRED"
    return "OK"
