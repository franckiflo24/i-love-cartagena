# PALCO Credential Engine v2 — © MachineMind Consulting.
# Licensed to AMO (Amo Cartagena S.A.S.) and city partners; the engine itself is
# never transferred. AMO code imports `palco`; the engine never imports AMO code
# (the only exceptions are the repo-local shared primitives qr_credential.py and
# events_time.py, which the license covers as part of the engine's v1 tier).
"""PALCO v2 — one credential engine: issue · rotate · transfer · validate.

Contract: docs/palco-v2/DESIGN.md (the doc wins). Wire v2:

    AMO2.<cred_id>.<counter>.<key_id>.<sig>

ECDSA P-256 signed ON DEVICE by a non-exportable key; the server stores public
keys only. v1 (PALCO1-scheme HMAC namespaces AMOTKT1/AMOPASS1/AMOCIV1) remains
live as the LEGACY tier through qr_credential.py — extended, never rebuilt.
"""
from __future__ import annotations

from . import catalog, crypto, issue, manifest, models, verify, wire  # noqa: F401

__all__ = ["catalog", "crypto", "issue", "manifest", "models", "verify", "wire"]
__version__ = "2.0.0-stage-a"
