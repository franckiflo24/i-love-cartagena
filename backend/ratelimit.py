"""Drop RL — hardened rate limiting. The foundation before money moves.

Fixes the two weaknesses Drop 10's audit flagged:
1. SPOOFABLE IP: every abuse gate keyed on client-supplied X-Forwarded-For —
   an attacker rotated fake IPs to mint fresh buckets. client_ip() now reads
   ONLY Vercel's trusted `x-real-ip` (set from the actual connection; Vercel
   overwrites spoof attempts) with the socket peer as fallback. The raw XFF
   chain is never consulted.
2. PER-INSTANCE MEMORY: counters lived in a process-local dict, so limits
   fragmented across serverless instances (N instances = N x limit) and reset
   on cold start. Counters now live in Mongo (`rate_buckets`) — the store
   every instance already shares — with ATOMIC $inc upserts (no check-then-
   write gap; B1's non-atomic-throttle lesson) and a TTL index for expiry.

Fixed-window semantics: window_start = floor(now / window) * window; the doc
_id is f"{key}:{window_start}" so one atomic upsert both creates and counts.

FAIL MODE per surface (RL-B4):
- SENSITIVE prefixes (auth codes, referral claim, share-code resolution,
  LLM-cost endpoints) FAIL CLOSED: store unreachable -> 503, deny.
- Everything else degrades to the old in-process limiter (still real
  protection within an instance) so a transient store blip never breaks
  browsing. Never allow-all silently.

Zero behavior change for legitimate users: same real IP, same limits.
"""

import logging
import time
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import HTTPException, Request
from pymongo.errors import DuplicateKeyError

logger = logging.getLogger("ratelimit")

db = None  # injected via init()

# Prefixes whose gates protect auth, codes, enumeration brakes, or paid LLM
# calls — these DENY when the store is unreachable (fail closed).
SENSITIVE_PREFIXES = (
    "verify", "signup", "signupip", "refclaim",   # auth + verification codes
    "bizverify",                                  # venue-claim OTP (fraud vector)
    "tripguest", "tripcode", "tripjoin",          # share-code enumeration brakes
    "bizforgot", "bizforgotip", "bizreset", "bizresetip",  # partner-portal recovery
    "paycreate",                                  # payment-record creation (pre-B3)
    "agent", "concierge", "bizupload", "pulse", "bizpulse", "lunataste",  # paid-LLM cost abuse
)

# Degraded-mode fallback: the pre-RL in-process buckets. Per-instance only,
# but infinitely better than allow-all during a store blip.
_local_buckets: dict[str, list[float]] = defaultdict(list)


def init(*, db_):
    global db
    db = db_


def client_ip(request: Request) -> str:
    """The TRUSTED client IP. Vercel sets x-real-ip from the connection and
    overwrites client spoof attempts (proven during the B1 hardening). The
    client-supplied X-Forwarded-For chain is deliberately ignored."""
    real = (request.headers.get("x-real-ip") or "").strip()
    if real:
        return real
    return request.client.host if request.client else "unknown"


def _local_check(key: str, max_calls: int, window_sec: int):
    now = time.time()
    bucket = [t for t in _local_buckets[key] if now - t < window_sec]
    _local_buckets[key] = bucket
    if len(bucket) >= max_calls:
        raise HTTPException(status_code=429, detail="Too many requests. Please wait before trying again.")
    bucket.append(now)


async def check(key: str, max_calls: int = 10, window_sec: int = 60):
    """Raise 429 when key exceeds max_calls in the current fixed window.
    Atomic cluster-wide count; fail mode by key prefix (see module doc)."""
    now = time.time()
    window_start = int(now // window_sec) * window_sec
    doc_id = f"{key}:{window_start}"

    async def _atomic_inc():
        return await db.rate_buckets.find_one_and_update(
            {"_id": doc_id},
            {"$inc": {"n": 1},
             "$setOnInsert": {
                 # TTL cleanup a minute after the window closes
                 "exp": datetime.fromtimestamp(window_start + window_sec + 60, tz=timezone.utc),
             }},
            upsert=True,
            return_document=True,  # AFTER
        )

    try:
        try:
            doc = await _atomic_inc()
        except DuplicateKeyError:
            # Two requests raced to CREATE the same brand-new window doc (a known
            # findAndModify-upsert race). It exists now — retry once counts it
            # correctly instead of falsely failing closed on a legit burst.
            doc = await _atomic_inc()
        if int(doc.get("n", 1)) > max_calls:
            raise HTTPException(status_code=429, detail="Too many requests. Please wait before trying again.")
        return
    except HTTPException:
        raise
    except Exception as exc:
        prefix = key.split(":", 1)[0]
        if prefix in SENSITIVE_PREFIXES:
            # Fail CLOSED: an auth/code/brake surface without its limiter does
            # not run open. Deny until the store returns.
            logger.error(f"[ratelimit] store unreachable, failing CLOSED for {prefix}: {exc}")
            raise HTTPException(status_code=503, detail="Seguridad temporalmente no disponible. Intenta de nuevo. / Security check unavailable, try again shortly.")
        logger.warning(f"[ratelimit] store unreachable, degraded to local bucket for {prefix}: {exc}")
        _local_check(key, max_calls, window_sec)
