# PALCO Credential Engine v2 — © MachineMind Consulting.
# Licensed to AMO (Amo Cartagena S.A.S.) and city partners; never transferred.
"""Non-reversible identity hashing (contract: docs/palco-v2/DESIGN.md §5, §13).

The engine never stores a raw IP, phone or contact: a value that must survive as an
audit/forensic link is kept only as an HMAC-SHA256 digest under a server pepper. This
reuses the same pepper chain as `issue.phone_hash` (the phone-specific canonical
helper, left as-is) so every engine hash shares one secret.
"""
from __future__ import annotations

import hashlib
import hmac
import os

_DEV_PEPPER = "palco-dev-pepper"


def pepper() -> bytes:
    """Server pepper — same resolution order as issue.phone_hash (one secret)."""
    return (os.environ.get("PALCO_PHONE_PEPPER") or os.environ.get("EVENTS_ADMIN_TOKEN")
            or os.environ.get("CRON_SECRET") or _DEV_PEPPER).encode()


def hash_value(scope: str, value: str) -> str:
    """HMAC-SHA256(pepper, "scope|value"), first 32 hex. Not reversible; the scope
    keeps a digest made for one field from matching another (ip vs phone vs …)."""
    return hmac.new(pepper(), f"{scope}|{value or ''}".encode(), hashlib.sha256).hexdigest()[:32]
