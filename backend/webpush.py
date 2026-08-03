"""Web Push (VAPID) — Master Plan 1.4: push that respects the user.

Rules enforced SERVER-SIDE, not promised:
  - Opt-in only: a subscription exists solely because the browser granted it
    and the user posted it here.
  - HARD frequency cap: max 1 push per user per Bogotá day, enforced by a
    unique index on push_log (user_id, date) — a second send the same day is
    a silent no-op, never a bypass.
  - Value only: the only wired trigger is the streak milestone celebration
    (3/7/14/30 days). No proximity spam, no loss-aversion, no guilt copy.

Payloads carry title/body/url only — no coordinates, no tracking beacons.
"""

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger("webpush")

router = APIRouter()

db = None
_get_current_user = None
_check_rate_limit = None

BOGOTA = ZoneInfo("America/Bogota")

VAPID_PRIVATE = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
VAPID_PUBLIC = os.environ.get("VAPID_PUBLIC_KEY", "").strip()
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:hola@amocartagena.co").strip()


def init(*, db_, get_current_user, check_rate_limit):
    global db, _get_current_user, _check_rate_limit
    db = db_
    _get_current_user = get_current_user
    _check_rate_limit = check_rate_limit


def enabled() -> bool:
    return bool(VAPID_PRIVATE and VAPID_PUBLIC)


@router.get("/push/vapid-public-key")
async def vapid_public_key():
    if not enabled():
        raise HTTPException(status_code=503, detail="push not configured")
    return {"key": VAPID_PUBLIC}


@router.post("/push/subscribe")
async def push_subscribe(request: Request):
    """Store the browser's PushSubscription for the signed-in user."""
    user = await _get_current_user(request)
    _check_rate_limit(f"pushsub:{user['user_id']}", max_calls=10, window_sec=3600)
    body = await request.json()
    sub = body.get("subscription") or {}
    endpoint = sub.get("endpoint")
    keys = sub.get("keys") or {}
    if not endpoint or not keys.get("p256dh") or not keys.get("auth"):
        raise HTTPException(status_code=400, detail="valid subscription required")
    await db.push_subscriptions.update_one(
        {"endpoint": endpoint},
        {"$set": {
            "user_id": user["user_id"],
            "endpoint": endpoint,
            "keys": {"p256dh": keys["p256dh"], "auth": keys["auth"]},
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
         "$setOnInsert": {"created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"ok": True}


@router.post("/push/unsubscribe")
async def push_unsubscribe(request: Request):
    user = await _get_current_user(request)
    body = await request.json()
    endpoint = (body.get("endpoint") or "").strip()
    if not endpoint:
        raise HTTPException(status_code=400, detail="endpoint required")
    res = await db.push_subscriptions.delete_many(
        {"endpoint": endpoint, "user_id": user["user_id"]})
    return {"ok": True, "removed": res.deleted_count}


async def notify_user(db_, user_id: str, title: str, body: str,
                      url: str = "/pasaporte") -> Dict[str, Any]:
    """Send one push to all of a user's subscriptions. HARD 1/day cap via
    unique (user_id, date) insert — cap hit → no-op. Fail-soft everywhere."""
    if not enabled():
        return {"sent": 0, "capped": False, "reason": "not configured"}
    today = datetime.now(timezone.utc).astimezone(BOGOTA).strftime("%Y-%m-%d")
    try:
        await db_.push_log.insert_one({
            "user_id": user_id, "date": today,
            "title": title[:80], "sent_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        return {"sent": 0, "capped": True}  # unique index hit → daily cap

    subs = await db_.push_subscriptions.find({"user_id": user_id}).to_list(10)
    if not subs:
        return {"sent": 0, "capped": False, "reason": "no subscriptions"}

    from pywebpush import webpush, WebPushException
    payload = json.dumps({"title": title[:80], "body": body[:160], "url": url})
    sent = 0
    for s in subs:
        try:
            webpush(
                subscription_info={"endpoint": s["endpoint"], "keys": s["keys"]},
                data=payload,
                vapid_private_key=VAPID_PRIVATE,
                vapid_claims={"sub": VAPID_SUBJECT},
                ttl=3600,
            )
            sent += 1
        except WebPushException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 410):  # dead subscription → prune
                await db_.push_subscriptions.delete_one({"endpoint": s["endpoint"]})
            else:
                logger.warning(f"[webpush] send failed ({status}): {exc}")
        except Exception as exc:
            logger.warning(f"[webpush] send error: {exc}")
    return {"sent": sent, "capped": False}


@router.post("/admin/push/test")
async def push_test(request: Request):
    """Admin/cron-secret: send a test push to a user_id (verification only)."""
    secret = os.environ.get("CRON_SECRET", "").strip()
    auth = request.headers.get("Authorization", "")
    if not secret or auth != f"Bearer {secret}":
        raise HTTPException(status_code=403, detail="forbidden")
    body = await request.json()
    uid = (body.get("user_id") or "").strip()
    if not uid:
        raise HTTPException(status_code=400, detail="user_id required")
    result = await notify_user(db, uid,
                               body.get("title") or "AMO Cartagena",
                               body.get("body") or "Prueba de notificación ✓",
                               body.get("url") or "/pasaporte")
    return result
