"""
Expo Push Notifications module.

Sends push notifications to user/partner devices via the Expo Push Service
(https://exp.host/--/api/v2/push/send). No external keys required — works
out-of-the-box with Expo Go AND with EAS native builds.

Usage:
    from push import send_expo_push
    await send_expo_push(
        tokens=["ExponentPushToken[xxx]", ...],
        title="¡Reserva confirmada!",
        body="Casa Bohème confirmó tu reserva...",
        data={"kind": "reservation_confirmed", "reservation_id": "res_..."},
    )

Token registration helpers:
    await register_push_token(db, owner_type="user", owner_id=user_id, token=expo_token)
    await deregister_push_token(db, token=expo_token)
"""
from __future__ import annotations
import logging
import os
from typing import Any

import httpx

logger = logging.getLogger("amo.push")

EXPO_PUSH_URL = os.getenv("EXPO_PUSH_URL", "https://exp.host/--/api/v2/push/send")
EXPO_PUSH_TIMEOUT = float(os.getenv("EXPO_PUSH_TIMEOUT", "10"))


def is_expo_token(token: str | None) -> bool:
    """Validates the format of an Expo push token."""
    if not token or not isinstance(token, str):
        return False
    return token.startswith("ExponentPushToken[") or token.startswith("ExpoPushToken[")


async def send_expo_push(
    tokens: list[str],
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
    sound: str = "default",
    priority: str = "high",
    channel_id: str = "default",
) -> dict[str, Any]:
    """
    Send a push notification to one or more Expo push tokens.

    Returns a summary dict {sent, errors, invalid_tokens}.
    Invalid tokens (DeviceNotRegistered) are NOT removed here — the caller
    can choose to dispose of them via deregister_push_token().
    """
    valid_tokens = [t for t in (tokens or []) if is_expo_token(t)]
    if not valid_tokens:
        return {"sent": 0, "errors": [], "invalid_tokens": []}

    messages = [
        {
            "to": tok,
            "title": title[:120] if title else "",
            "body": body[:240] if body else "",
            "sound": sound,
            "priority": priority,
            "channelId": channel_id,
            "data": data or {},
        }
        for tok in valid_tokens
    ]

    sent = 0
    errors: list[str] = []
    invalid: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=EXPO_PUSH_TIMEOUT) as client:
            # Expo accepts batched arrays; split to chunks of 100 just in case
            for i in range(0, len(messages), 100):
                batch = messages[i : i + 100]
                resp = await client.post(
                    EXPO_PUSH_URL,
                    json=batch,
                    headers={
                        "Accept": "application/json",
                        "Accept-Encoding": "gzip, deflate",
                        "Content-Type": "application/json",
                    },
                )
                if resp.status_code != 200:
                    errors.append(f"HTTP {resp.status_code}: {resp.text[:200]}")
                    continue
                payload = resp.json()
                receipts = payload.get("data") or []
                for tok, receipt in zip([m["to"] for m in batch], receipts):
                    status = (receipt or {}).get("status")
                    if status == "ok":
                        sent += 1
                    else:
                        err_details = (receipt or {}).get("details") or {}
                        err_msg = (receipt or {}).get("message") or "unknown"
                        errors.append(f"{tok[:20]}…: {err_msg}")
                        if err_details.get("error") in {"DeviceNotRegistered", "InvalidCredentials"}:
                            invalid.append(tok)
    except Exception as exc:  # pragma: no cover (network failure)
        logger.warning(f"send_expo_push failed: {exc}")
        errors.append(str(exc))

    return {"sent": sent, "errors": errors, "invalid_tokens": invalid}


# ─────────────────────────────────────────────────────────────
# Database helpers — keep tokens deduplicated per owner
# ─────────────────────────────────────────────────────────────

async def register_push_token(
    db,
    owner_type: str,
    owner_id: str,
    token: str,
    platform: str | None = None,
    device_name: str | None = None,
) -> bool:
    """
    Register (or refresh) a push token for a user or partner.
    `owner_type` must be one of: 'user' | 'partner'.
    Tokens are stored in a dedicated `push_tokens` collection so the same
    device can roam between users (and so we don't bloat user/partner docs).
    """
    if not is_expo_token(token):
        return False
    if owner_type not in {"user", "partner"}:
        return False
    now = _iso_now()
    # Upsert by token (one row per device); reassign to the most recent owner
    await db.push_tokens.update_one(
        {"token": token},
        {
            "$set": {
                "token": token,
                "owner_type": owner_type,
                "owner_id": owner_id,
                "platform": platform,
                "device_name": device_name,
                "active": True,
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
    return True


async def deregister_push_token(db, token: str) -> None:
    """Mark a token as inactive so it won't receive future pushes."""
    if not token:
        return
    await db.push_tokens.update_one(
        {"token": token},
        {"$set": {"active": False, "updated_at": _iso_now()}},
    )


async def get_active_tokens_for_owner(
    db, owner_type: str, owner_id: str | None
) -> list[str]:
    """Return all active push tokens for a user or partner."""
    if not owner_id or owner_type not in {"user", "partner"}:
        return []
    cursor = db.push_tokens.find(
        {"owner_type": owner_type, "owner_id": owner_id, "active": True},
        {"_id": 0, "token": 1},
    )
    rows = await cursor.to_list(50)
    return [r["token"] for r in rows if r.get("token")]


async def push_to_user(db, user_id: str | None, title: str, body: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Convenience: send a push to all of a user's registered devices."""
    tokens = await get_active_tokens_for_owner(db, "user", user_id)
    if not tokens:
        return {"sent": 0, "errors": [], "invalid_tokens": []}
    result = await send_expo_push(tokens, title, body, data=data)
    # Auto-cleanup invalid tokens
    for tok in result.get("invalid_tokens") or []:
        await deregister_push_token(db, tok)
    return result


async def push_to_partner(db, partner_id: str | None, title: str, body: str, data: dict[str, Any] | None = None) -> dict[str, Any]:
    """Convenience: send a push to all of a partner's registered devices."""
    tokens = await get_active_tokens_for_owner(db, "partner", partner_id)
    if not tokens:
        return {"sent": 0, "errors": [], "invalid_tokens": []}
    result = await send_expo_push(tokens, title, body, data=data)
    for tok in result.get("invalid_tokens") or []:
        await deregister_push_token(db, tok)
    return result


def _iso_now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
