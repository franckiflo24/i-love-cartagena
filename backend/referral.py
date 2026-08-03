"""Referral loop — Master Plan 1.5: tourist-to-tourist spread in group chats.

"Tu amigo se une con tu código → ambos ganan." Both sides earn the existing
POINTS_CONFIG referral award (500) through the real rewards economy — no
invented currencies, no fake passport stamps (a stamp means you were THERE;
referrals earn points instead).

Guardrails: referral_code unique per user (lazy-minted); one claim per user
for life (users.referred_by, set atomically); self-referral rejected.
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger("referral")

router = APIRouter()

db = None
_get_current_user = None
_check_rate_limit = None
_award_points = None

REFERRAL_POINTS = 500  # mirrors rewards.POINTS_CONFIG["referral"]


def init(*, db_, get_current_user, check_rate_limit, award_points):
    global db, _get_current_user, _check_rate_limit, _award_points
    db = db_
    _get_current_user = get_current_user
    _check_rate_limit = check_rate_limit
    _award_points = award_points


async def _ensure_code(user_id: str) -> str:
    u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "referral_code": 1})
    if u and u.get("referral_code"):
        return u["referral_code"]
    for _ in range(5):  # unique-index retry loop
        code = "AMO" + uuid.uuid4().hex[:5].upper()
        try:
            await db.users.update_one(
                {"user_id": user_id, "referral_code": {"$exists": False}},
                {"$set": {"referral_code": code}},
            )
            u = await db.users.find_one({"user_id": user_id}, {"_id": 0, "referral_code": 1})
            if u and u.get("referral_code"):
                return u["referral_code"]
        except Exception:
            continue
    raise HTTPException(status_code=500, detail="could not mint referral code")


@router.get("/referral/me")
async def referral_me(request: Request):
    """The caller's code + how many friends joined with it."""
    user = await _get_current_user(request)
    code = await _ensure_code(user["user_id"])
    referred = await db.users.count_documents({"referred_by": user["user_id"]})
    return {"code": code, "referred_count": referred, "points_each": REFERRAL_POINTS,
            "share_url": f"https://www.amocartagena.co/pasaporte?ref={code}"}


@router.post("/referral/claim")
async def referral_claim(request: Request):
    """New user enters a friend's code — once per life, both sides earn."""
    user = await _get_current_user(request)
    user_id = user["user_id"]
    _check_rate_limit(f"refclaim:{user_id}", max_calls=10, window_sec=3600)
    body = await request.json()
    code = (body.get("code") or "").strip().upper()
    if not code or len(code) > 12:
        raise HTTPException(status_code=400, detail="código requerido")

    referrer = await db.users.find_one({"referral_code": code}, {"_id": 0, "user_id": 1, "name": 1})
    if not referrer:
        raise HTTPException(status_code=404, detail="código no válido")
    if referrer["user_id"] == user_id:
        raise HTTPException(status_code=400, detail="no puedes usar tu propio código")

    # Atomic once-per-life: only flips if referred_by is not yet set.
    res = await db.users.update_one(
        {"user_id": user_id, "referred_by": {"$exists": False}},
        {"$set": {"referred_by": referrer["user_id"],
                  "referred_at": datetime.now(timezone.utc).isoformat()}},
    )
    if res.modified_count == 0:
        raise HTTPException(status_code=409, detail="ya usaste un código de invitación")

    points = 0
    try:
        await _award_points(db, user_id, REFERRAL_POINTS, "referral",
                            source_id=code, description="Te uniste con un código de amigo")
        await _award_points(db, referrer["user_id"], REFERRAL_POINTS, "referral",
                            source_id=user_id, description="Un amigo se unió con tu código")
        points = REFERRAL_POINTS
    except Exception as exc:
        logger.warning(f"[referral] points award failed: {exc}")

    return {"ok": True, "points_awarded": points,
            "referrer_name": (referrer.get("name") or "").split(" ")[0] or None}
