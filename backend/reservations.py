"""
Reservations module — Direct in-app reservation REQUESTS.

Business model: the app is a SaaS marketplace. Partners pay a monthly membership fee
to be listed. The app does NOT touch reservation payments — each reservation is a
"request" sent to the partner, who confirms manually and points the user to their own
payment link (Wompi/Bold/transfer/etc., stored as `default_payment_link` on the partner).

State machine:
  pending_confirmation  → request sent, awaiting the partner
  confirmed             → partner accepted. Client sees the partner's payment link + contacts.
  rejected_by_partner   → partner declined.
  cancelled_by_user     → user cancelled within the cancellation window (free).
  cancelled_late        → user cancelled too late (kept for analytics).
  completed             → partner marked it as honoured.
  no_show               → partner marked it as no-show.

Cancellation window:
  Free cancellation up to CANCELLATION_HOURS_TABLE (default 2h) before reservation time.

Routes are mounted on `router`. `init(deps)` must be called from server.py before
`app.include_router(router, prefix='/api')`.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Callable, Optional

from fastapi import APIRouter, HTTPException, Request

logger = logging.getLogger(__name__)

router = APIRouter()


# ─────────────────────────────────────────────────────────────
# Dependencies injected by server.py at startup
# ─────────────────────────────────────────────────────────────
_deps: dict[str, Any] = {}


def init(*, db, get_current_user, get_current_business, require_government_role,
         wompi=None, create_payment_record: Optional[Callable] = None):
    """Wire dependencies from server.py. (wompi/create_payment_record kept for backward
    compatibility but no longer used — reservations never touch app payments now.)"""
    _deps["db"] = db
    _deps["get_current_user"] = get_current_user
    _deps["get_current_business"] = get_current_business
    _deps["require_government_role"] = require_government_role


def _db():
    return _deps["db"]


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

CANCELLATION_HOURS_TABLE = 2  # universal cutoff — applies to ALL reservation types now

VALID_TYPES = {"table", "request"}  # accepts both for backward compatibility
ACTIVE_STATUSES = {"pending_confirmation", "confirmed"}
TERMINAL_STATUSES = {
    "cancelled_by_user", "cancelled_late", "rejected_by_partner",
    "completed", "no_show", "expired",
}


def _parse_iso_local(date_str: str, time_str: str = "") -> Optional[datetime]:
    """Parse 'YYYY-MM-DD' + optional 'HH:MM' as Cartagena local (UTC-5) → UTC."""
    try:
        if time_str:
            dt_local = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
        else:
            dt_local = datetime.strptime(date_str, "%Y-%m-%d")
        return dt_local.replace(tzinfo=timezone(timedelta(hours=-5))).astimezone(timezone.utc)
    except Exception:
        return None


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso() -> str:
    return _now().isoformat()


def _hours_until(dt: datetime) -> float:
    return (dt - _now()).total_seconds() / 3600.0


async def _enrich_partner(partner_id: str) -> dict:
    p = await _db().partners.find_one(
        {"partner_id": partner_id},
        {"_id": 0, "name": 1, "category": 1, "tier": 1, "image_url": 1, "address": 1,
         "instagram": 1, "phone": 1, "whatsapp": 1, "email": 1, "is_government": 1,
         "default_payment_link": 1, "partner_id": 1},
    )
    return p or {}


async def _hydrate_reservation(r: dict) -> dict:
    r = dict(r)
    r.pop("_id", None)
    if r.get("partner_id"):
        partner = await _enrich_partner(r["partner_id"])
        r["partner"] = partner
        # Surface payment info + contacts ONLY when confirmed (so the client knows
        # exactly when to pay). Pending requests don't get payment info yet.
        if r.get("status") == "confirmed":
            r["payment_info"] = {
                "payment_link": partner.get("default_payment_link") or None,
                "whatsapp": partner.get("whatsapp") or partner.get("phone") or None,
                "phone": partner.get("phone") or None,
                "email": partner.get("email") or None,
                "instagram": partner.get("instagram") or None,
                "note": r.get("partner_note") or None,
            }
    if r.get("event_id"):
        ev = await _db().partner_events.find_one(
            {"event_id": r["event_id"]},
            {"_id": 0, "title": 1, "date": 1, "start_time": 1, "category": 1,
             "flyer_url": 1, "price": 1, "is_free": 1, "event_id": 1},
        )
        r["event"] = ev
    return r


def _can_cancel(r: dict) -> tuple[bool, str]:
    if r.get("status") not in ACTIVE_STATUSES:
        return False, "Esta reserva ya no se puede cancelar."
    dt = _parse_iso_local(r.get("date", ""), r.get("time", "") or "")
    if not dt:
        return True, ""
    hrs = _hours_until(dt)
    if hrs < CANCELLATION_HOURS_TABLE:
        return False, f"Cancelación gratuita hasta {CANCELLATION_HOURS_TABLE}h antes de la reserva."
    return True, ""


# ─────────────────────────────────────────────────────────────
# Public — User-facing routes
# ─────────────────────────────────────────────────────────────

@router.post("/reservations")
async def create_reservation(request: Request):
    """Create a new reservation REQUEST. The app does NOT process payment — the partner
    will share their own payment link once they confirm.

    Body:
      partner_id (str, required)
      type ('table' | 'request', optional — defaults to 'table' for backward compat)
      date 'YYYY-MM-DD' (required)
      time 'HH:MM' (required)
      party_size (int 1-30, default 2)
      notes (str, optional, max 280)
      event_id (str, optional — link to a partner_event)

    Returns:
      { reservation, message }
    """
    user = await _deps["get_current_user"](request)
    body = await request.json()

    partner_id = (body.get("partner_id") or "").strip()
    rtype = (body.get("type") or "table").strip().lower()
    if rtype == "prepaid":
        # Legacy clients — reject. The new model never charges through the app.
        raise HTTPException(
            status_code=400,
            detail="El pago ya no se procesa en la app. El partner enviará su link de pago al confirmar.",
        )
    date = (body.get("date") or "").strip()
    time = (body.get("time") or "").strip()
    party_size_raw = body.get("party_size")
    party_size = int(party_size_raw if party_size_raw is not None else 2)
    notes = (body.get("notes") or "").strip()[:280]
    event_id = (body.get("event_id") or "").strip() or None

    if not partner_id:
        raise HTTPException(status_code=400, detail="partner_id requerido")
    if rtype not in VALID_TYPES:
        raise HTTPException(status_code=400, detail="type inválido")
    if not date or len(date) != 10:
        raise HTTPException(status_code=400, detail="date 'YYYY-MM-DD' requerido")
    if not time:
        raise HTTPException(status_code=400, detail="time 'HH:MM' requerido")
    if party_size < 1 or party_size > 30:
        raise HTTPException(status_code=400, detail="party_size debe estar entre 1 y 30")

    dt = _parse_iso_local(date, time)
    if not dt:
        raise HTTPException(status_code=400, detail="fecha/hora inválida")
    if dt < _now() - timedelta(hours=1):
        raise HTTPException(status_code=400, detail="La fecha de la reserva ya pasó")
    if dt > _now() + timedelta(days=365):
        raise HTTPException(status_code=400, detail="No se pueden reservar fechas con más de 1 año de antelación")

    partner = await _db().partners.find_one({"partner_id": partner_id}, {"_id": 0})
    if not partner:
        raise HTTPException(status_code=404, detail="Partner no encontrado")

    if event_id:
        ev = await _db().partner_events.find_one({"event_id": event_id, "partner_id": partner_id}, {"_id": 0})
        if not ev:
            raise HTTPException(status_code=404, detail="Evento del partner no encontrado")

    reservation_id = f"res_{uuid.uuid4().hex[:12]}"
    doc = {
        "reservation_id": reservation_id,
        "user_id": user["user_id"],
        "user_email": user.get("email"),
        "user_name": user.get("name"),
        "user_phone": user.get("phone"),
        "user_whatsapp": user.get("whatsapp") or user.get("phone"),
        "partner_id": partner_id,
        "partner_name": partner.get("name"),
        "event_id": event_id,
        "type": "table",  # normalised — there's only one type now
        "date": date,
        "time": time,
        "datetime_utc": dt.isoformat(),
        "party_size": party_size,
        "notes": notes,
        "status": "pending_confirmation",
        "created_at": _iso(),
        "updated_at": _iso(),
        "confirmed_at": None,
        "cancelled_at": None,
        "partner_confirmed_by": None,
        # Legacy fields kept at 0 — kept for backward compatibility with existing aggregations.
        "amount_cop": 0,
        "currency": "COP",
        "commission_pct": 0.0,
        "app_commission_cop": 0,
        "partner_amount_cop": 0,
    }
    await _db().reservations.insert_one(dict(doc))
    hydrated = await _hydrate_reservation(doc)
    return {
        "reservation": hydrated,
        "message": "Tu solicitud fue enviada al partner. Te avisaremos cuando confirme y verás su link de pago en la app.",
    }


@router.get("/reservations/my")
async def my_reservations(request: Request):
    user = await _deps["get_current_user"](request)
    now = _now()
    cursor = _db().reservations.find({"user_id": user["user_id"]}, {"_id": 0}).sort("datetime_utc", -1)
    docs = await cursor.to_list(200)
    upcoming, past = [], []
    for r in docs:
        hydrated = await _hydrate_reservation(r)
        dt = datetime.fromisoformat(r["datetime_utc"]) if r.get("datetime_utc") else None
        if dt and dt >= now and r.get("status") in ACTIVE_STATUSES:
            upcoming.append(hydrated)
        else:
            past.append(hydrated)
    upcoming.sort(key=lambda x: x.get("datetime_utc", ""))
    return {"upcoming": upcoming, "past": past, "total": len(docs)}


@router.get("/reservations/{reservation_id}")
async def get_reservation(reservation_id: str, request: Request):
    user = await _deps["get_current_user"](request)
    r = await _db().reservations.find_one({"reservation_id": reservation_id, "user_id": user["user_id"]}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reserva no encontrada")
    return await _hydrate_reservation(r)


@router.post("/reservations/{reservation_id}/cancel")
async def user_cancel_reservation(reservation_id: str, request: Request):
    user = await _deps["get_current_user"](request)
    r = await _db().reservations.find_one({"reservation_id": reservation_id, "user_id": user["user_id"]}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reserva no encontrada")

    if r.get("status") in TERMINAL_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"La reserva ya está en estado '{r['status']}' y no se puede volver a cancelar.",
        )

    allowed, reason = _can_cancel(r)
    new_status = "cancelled_by_user" if allowed else "cancelled_late"
    update = {
        "status": new_status,
        "cancelled_at": _iso(),
        "cancelled_reason": "user",
        "updated_at": _iso(),
    }
    await _db().reservations.update_one({"reservation_id": reservation_id}, {"$set": update})

    updated = await _db().reservations.find_one({"reservation_id": reservation_id}, {"_id": 0})
    return {
        "reservation": await _hydrate_reservation(updated),
        "free_cancellation": allowed,
        "message": reason or "Reserva cancelada correctamente.",
    }


# ─────────────────────────────────────────────────────────────
# Partner-facing routes
# ─────────────────────────────────────────────────────────────

@router.get("/business/reservations")
async def business_list_reservations(request: Request, status: str = "", limit: int = 100):
    biz = await _deps["get_current_business"](request)
    partner_id = biz["partner_id"]
    q: dict[str, Any] = {"partner_id": partner_id}
    if status:
        q["status"] = status
    cursor = _db().reservations.find(q, {"_id": 0}).sort("datetime_utc", -1).limit(min(max(int(limit), 1), 500))
    docs = await cursor.to_list(500)

    pending = await _db().reservations.count_documents({"partner_id": partner_id, "status": "pending_confirmation"})
    confirmed_upcoming = await _db().reservations.count_documents({
        "partner_id": partner_id,
        "status": "confirmed",
        "datetime_utc": {"$gte": _iso()},
    })
    completed_30d = await _db().reservations.count_documents({
        "partner_id": partner_id,
        "status": "completed",
        "datetime_utc": {"$gte": (_now() - timedelta(days=30)).isoformat()},
    })

    return {
        "reservations": [await _hydrate_reservation(r) for r in docs],
        "stats": {
            "pending_count": pending,
            "confirmed_upcoming_count": confirmed_upcoming,
            "completed_last_30d": completed_30d,
        },
    }


@router.patch("/business/reservations/{reservation_id}")
async def business_update_reservation(reservation_id: str, request: Request):
    """Partner confirms / rejects / completes / marks no-show.
    Body: { action: 'confirm' | 'reject' | 'complete' | 'no_show', note?: string }
    Confirmation does NOT trigger any payment — the user will see the partner's
    `default_payment_link` (saved on the partner profile) in the reservation card."""
    biz = await _deps["get_current_business"](request)
    body = await request.json()
    action = (body.get("action") or "").strip().lower()
    note = (body.get("note") or "").strip()[:280]

    r = await _db().reservations.find_one({"reservation_id": reservation_id, "partner_id": biz["partner_id"]}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reserva no encontrada")

    update = {"updated_at": _iso(), "partner_confirmed_by": biz.get("email")}
    if action == "confirm":
        if r["status"] != "pending_confirmation":
            raise HTTPException(status_code=400, detail=f"No se puede confirmar una reserva en estado '{r['status']}'")
        update["status"] = "confirmed"
        update["confirmed_at"] = _iso()
        if note:
            update["partner_note"] = note
    elif action == "reject":
        if r["status"] in TERMINAL_STATUSES:
            raise HTTPException(status_code=400, detail=f"No se puede rechazar una reserva en estado '{r['status']}'")
        update["status"] = "rejected_by_partner"
        update["cancelled_at"] = _iso()
        if note:
            update["partner_rejection_reason"] = note
    elif action == "complete":
        if r["status"] != "confirmed":
            raise HTTPException(status_code=400, detail="Solo se pueden completar reservas confirmadas")
        update["status"] = "completed"
    elif action == "no_show":
        if r["status"] != "confirmed":
            raise HTTPException(status_code=400, detail="Solo se puede marcar no-show en reservas confirmadas")
        update["status"] = "no_show"
    else:
        raise HTTPException(status_code=400, detail="action inválido (confirm|reject|complete|no_show)")

    await _db().reservations.update_one({"reservation_id": reservation_id}, {"$set": update})
    updated = await _db().reservations.find_one({"reservation_id": reservation_id}, {"_id": 0})
    return await _hydrate_reservation(updated)


# ─────────────────────────────────────────────────────────────
# Alcaldía (government) admin routes
# ─────────────────────────────────────────────────────────────

@router.get("/business/admin/reservations")
async def admin_list_reservations(request: Request, status: str = "", days: int = 30, limit: int = 200):
    await _deps["require_government_role"](request)
    q: dict[str, Any] = {}
    if status:
        q["status"] = status
    if days and days > 0:
        since = (_now() - timedelta(days=days)).isoformat()
        q["created_at"] = {"$gte": since}
    cursor = _db().reservations.find(q, {"_id": 0}).sort("created_at", -1).limit(min(max(int(limit), 1), 500))
    docs = await cursor.to_list(500)
    return {
        "reservations": [await _hydrate_reservation(r) for r in docs],
        "count": len(docs),
    }


@router.get("/business/admin/reservations/stats")
async def admin_reservations_stats(request: Request, days: int = 30):
    await _deps["require_government_role"](request)
    since = (_now() - timedelta(days=max(days, 1))).isoformat()
    base = {"created_at": {"$gte": since}}

    total = await _db().reservations.count_documents(base)
    by_status: dict[str, int] = {}
    async for r in _db().reservations.find(base, {"_id": 0, "status": 1}):
        s = r.get("status") or "unknown"
        by_status[s] = by_status.get(s, 0) + 1

    # Distinct partners with at least 1 reservation in the period
    active_partners = len(await _db().reservations.distinct("partner_id", base))

    # Acceptance rate
    confirmed = by_status.get("confirmed", 0) + by_status.get("completed", 0) + by_status.get("no_show", 0)
    rejected = by_status.get("rejected_by_partner", 0)
    decided = confirmed + rejected
    acceptance_rate = round(confirmed / decided * 100, 1) if decided else 0.0

    return {
        "period_days": days,
        "total": total,
        "by_status": by_status,
        "active_partners": active_partners,
        "acceptance_rate_pct": acceptance_rate,
    }


# ─────────────────────────────────────────────────────────────
# Indexes (called once at startup)
# ─────────────────────────────────────────────────────────────

async def ensure_indexes():
    try:
        await _db().reservations.create_index("reservation_id", unique=True)
        await _db().reservations.create_index([("user_id", 1), ("created_at", -1)])
        await _db().reservations.create_index([("partner_id", 1), ("status", 1), ("datetime_utc", -1)])
        await _db().reservations.create_index([("status", 1), ("created_at", -1)])
    except Exception as e:
        logger.warning(f"Could not create reservations indexes: {e}")
