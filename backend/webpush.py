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

EVENTS-ELITE §13 H3 / §15 U — consent SCOPES. One browser subscription can carry several
consents: 'passport' (the streak milestone push above) and 'events' (reminders for events
the user saved). POST /push/subscribe {subscription, scopes} $sets the FULL scope list for
that endpoint; a body without `scopes` means ['passport'], and rows stored before scopes
existed count as ['passport'] too. notify_user() only reaches 'passport' subscriptions;
send_to_subscriptions(..., scope='events') only reaches 'events' ones and never touches
push_log (event reminders have their own daily cap, event_push_log, in events_elite).
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger("webpush")

router = APIRouter()

db: Any = None
_get_current_user: Any = None
_check_rate_limit: Any = None

BOGOTA = ZoneInfo("America/Bogota")

VAPID_PRIVATE = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
VAPID_PUBLIC = os.environ.get("VAPID_PUBLIC_KEY", "").strip()
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:hola@amocartagena.co").strip()

SCOPES = ("passport", "events")
LEGACY_SCOPES = ["passport"]      # a subscribe body without scopes, and every pre-scope row
SEND_TIMEOUT_S = 5.0              # pywebpush HTTP timeout per subscription
TOTAL_TIMEOUT_S = 6.0             # send_to_subscriptions' own deadline (all subscriptions, in parallel)


def scope_query(user_id: str, scope: str) -> Dict[str, Any]:
    """Mongo filter for a user's subscriptions that consented to `scope`. Rows stored before
    scopes existed carry no `scopes` field and count as ['passport']."""
    if scope == "passport":
        return {"user_id": user_id, "$or": [{"scopes": "passport"}, {"scopes": {"$exists": False}}]}
    return {"user_id": user_id, "scopes": scope}


def parse_scopes(raw: Any) -> List[str]:
    """Body `scopes` -> the stored list. Missing -> ['passport']; unknown values dropped;
    a list is the FULL desired set (an empty list = no consent left on this endpoint)."""
    if raw is None:
        return list(LEGACY_SCOPES)
    if not isinstance(raw, list):
        raise HTTPException(status_code=400, detail="scopes must be a list")
    out: List[str] = []
    for s in raw:
        if isinstance(s, str) and s in SCOPES and s not in out:
            out.append(s)
    return out


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
    await _check_rate_limit(f"pushsub:{user['user_id']}", max_calls=10, window_sec=3600)
    body = await request.json()
    sub = body.get("subscription") or {}
    endpoint = sub.get("endpoint")
    keys = sub.get("keys") or {}
    if not endpoint or not keys.get("p256dh") or not keys.get("auth"):
        raise HTTPException(status_code=400, detail="valid subscription required")
    scopes = parse_scopes(body.get("scopes"))
    await db.push_subscriptions.update_one(
        {"endpoint": endpoint},
        {"$set": {
            "user_id": user["user_id"],
            "endpoint": endpoint,
            "keys": {"p256dh": keys["p256dh"], "auth": keys["auth"]},
            "scopes": scopes,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
         "$setOnInsert": {"created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    return {"ok": True, "scopes": scopes}


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

    # Only subscriptions that consented to the streak push ('passport'; pre-scope rows count).
    subs = await db_.push_subscriptions.find(scope_query(user_id, "passport")).to_list(10)
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


async def send_to_subscriptions(db_, user_id: str, title: str, body: str, url: str,
                                scope: str = "events") -> Dict[str, Any]:
    """Send one push to the user's subscriptions that consented to `scope` (EVENTS-ELITE
    §13 H2/H3). Unlike notify_user this writes NO push_log row: the caller owns its own cap
    (event reminders use event_push_log). pywebpush is blocking, so every send runs in a
    worker thread with an HTTP timeout, all subscriptions IN PARALLEL under one total deadline
    (TOTAL_TIMEOUT_S), so the partial count always comes back to the caller. `uncertain` counts
    sends whose outcome is unknown (timed out: the worker thread may still deliver) — a caller
    must never treat those as "not sent" and retry. Never raises; dead endpoints (404/410) are
    pruned. Web limits: title 80, body 160 characters."""
    out: Dict[str, Any] = {"sent": 0, "subscriptions": 0, "uncertain": 0}
    if not enabled():
        return {**out, "reason": "not configured"}
    if scope not in SCOPES or not user_id:
        return {**out, "reason": "bad scope"}
    try:
        subs = await db_.push_subscriptions.find(scope_query(user_id, scope)).to_list(10)
    except Exception as exc:  # noqa: BLE001
        logger.error("[webpush] subscription read failed: %s", type(exc).__name__)
        return {**out, "reason": "db error"}
    out["subscriptions"] = len(subs)
    if not subs:
        return {**out, "reason": "no subscriptions"}
    try:
        from pywebpush import webpush as _wp_send, WebPushException
    except ImportError:
        logger.error("[webpush] pywebpush not installed")
        return {**out, "reason": "not installed"}
    payload = json.dumps({"title": (title or "")[:80], "body": (body or "")[:160], "url": url})
    per_sub = min(SEND_TIMEOUT_S + 1.0, TOTAL_TIMEOUT_S)

    async def one(sub: Dict[str, Any]) -> str:
        try:
            await asyncio.wait_for(asyncio.to_thread(
                _wp_send,
                subscription_info={"endpoint": sub["endpoint"], "keys": sub["keys"]},
                data=payload,
                vapid_private_key=VAPID_PRIVATE,
                vapid_claims={"sub": VAPID_SUBJECT},   # fresh dict per call: pywebpush mutates it
                ttl=3600,
                timeout=SEND_TIMEOUT_S,
            ), timeout=per_sub)
            return "sent"
        except WebPushException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 410):  # dead subscription → prune
                try:
                    await db_.push_subscriptions.delete_one({"endpoint": sub["endpoint"]})
                except Exception as exc2:  # noqa: BLE001
                    logger.error("[webpush] prune failed: %s", type(exc2).__name__)
            else:
                logger.error("[webpush] %s send failed: http %s", scope, status)
            return "failed"
        except asyncio.TimeoutError:
            logger.error("[webpush] %s send timed out", scope)
            return "uncertain"
        except Exception as exc:  # noqa: BLE001
            logger.error("[webpush] %s send error: %s", scope, type(exc).__name__)
            return "failed"

    tasks = [asyncio.ensure_future(one(sub)) for sub in subs]
    done, pending = await asyncio.wait(tasks, timeout=TOTAL_TIMEOUT_S)
    for t in pending:
        t.cancel()   # the worker thread may still deliver: counted as uncertain, never as failed
    for t in done:
        res = t.result() if not t.cancelled() else "uncertain"
        if res == "sent":
            out["sent"] += 1
        elif res == "uncertain":
            out["uncertain"] += 1
    out["uncertain"] += len(pending)
    return out


@router.post("/admin/push/test")
async def push_test(request: Request):
    """Admin/cron-secret: send a test push to a user_id (verification only)."""
    secret = os.environ.get("CRON_SECRET", "").strip()
    auth = request.headers.get("Authorization", "")
    import hmac
    if not secret or not hmac.compare_digest(auth.encode(), f"Bearer {secret}".encode()):
        raise HTTPException(status_code=403, detail="forbidden")
    body = await request.json()
    uid = (body.get("user_id") or "").strip()
    if not uid:
        raise HTTPException(status_code=400, detail="user_id required")
    result = await notify_user(db, uid,
                               body.get("title") or "AMO Life",
                               body.get("body") or "Prueba de notificación ✓",
                               body.get("url") or "/pasaporte")
    return result
