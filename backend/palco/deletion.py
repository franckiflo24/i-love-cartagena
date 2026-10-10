# PALCO Credential Engine v2 — © MachineMind Consulting.
# Licensed to AMO (Amo Cartagena S.A.S.) and city partners; never transferred.
"""Account deletion for the engine's rows (contract: docs/palco-v2/DESIGN.md §5, §8 A12).

server.py delete_account calls purge_user. The holder's credentials de-identify and any
still-live one is revoked (so an outstanding wire dies at the gate as REVOCADO); their
devices revoke; consent records are retained as proof-of-consent (Ley 1581 permits
keeping it) but stripped of the request IP / phone digests. The credential ledger stores
only hashes by construction, so it holds no raw PII to scrub. Terminal statuses
(used / refunded / transferred) are preserved — deletion never rewrites gate history.
"""
from __future__ import annotations

from typing import Any, Dict

from .models import (COL_CONSENT, COL_CREDENTIALS, COL_DEVICES, DEVICE_STATUS_ACTIVE,
                     DEVICE_STATUS_REVOKED, S_ACTIVE, S_ISSUED, S_REVOKED, iso)


def _modified(res: Any) -> int:
    return int(getattr(res, "modified_count", 0) or 0)


async def purge_user(db: Any, user_id: str) -> Dict[str, int]:
    ts = iso()
    anon = await getattr(db, COL_CREDENTIALS).update_many(
        {"holder.user_id": user_id},
        {"$set": {"holder.display_name": "Cuenta eliminada", "holder.phone_hash": ""}})
    revoked = await getattr(db, COL_CREDENTIALS).update_many(
        {"holder.user_id": user_id, "status": {"$in": [S_ISSUED, S_ACTIVE]}},
        {"$set": {"status": S_REVOKED, "revoke_reason": "account_deleted", "revoked_at": ts}})
    devices = await getattr(db, COL_DEVICES).update_many(
        {"user_id": user_id, "status": DEVICE_STATUS_ACTIVE},
        {"$set": {"status": DEVICE_STATUS_REVOKED, "revoke_reason": "account_deleted", "revoked_at": ts}})
    await getattr(db, COL_CONSENT).update_many(
        {"user_id": user_id}, {"$unset": {"ip_hash": "", "phone_hash": ""}})
    return {"credentials_anonymized": _modified(anon),
            "credentials_revoked": _modified(revoked),
            "devices_revoked": _modified(devices)}
