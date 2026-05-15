"""
Reservations module — Direct in-app bookings with 5% app commission.

Two flows supported (single collection `reservations`):
  • table   → Reserva de mesa en restaurante. Sin prepago. Partner confirma manualmente.
  • prepaid → Day Pass, Tour a islas, hotel, cena fija. Cobro 100% vía Wompi al reservar.
              Comisión 5% al partner (0% si es Alcaldía).

State machine:
  pending_payment       (prepaid esperando webhook de Wompi)
  pending_confirmation  (table esperando que el partner acepte)
  confirmed             (prepaid pagado, o table aceptado por el partner)
  rejected_by_partner   (el partner rechazó — si era prepaid: pendiente de reembolso manual)
  cancelled_by_user     (usuario canceló dentro del plazo)
  cancelled_late        (usuario canceló fuera del plazo — no reembolso)
  completed             (fecha pasó, marcado como utilizado)
  no_show               (el partner marcó no-show)
  expired               (prepaid no pagado en 30 min)

Cancellation windows (default):
  table   → hasta 2h antes de date+time
  prepaid → hasta 24h antes de date

All routes are mounted on the `router` exported by this module. `init(deps)` must be
called from server.py before `app.include_router(router, prefix='/api')`.
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
         wompi, create_payment_record: Callable):
    """Wire dependencies from server.py."""
    _deps["db"] = db
    _deps["get_current_user"] = get_current_user
    _deps["get_current_business"] = get_current_business
    _deps["require_government_role"] = require_government_role
    _deps["wompi"] = wompi
    _deps["create_payment_record"] = create_payment_record


def _db():
    return _deps["db"]


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

CANCELLATION_HOURS_TABLE = 2
CANCELLATION_HOURS_PREPAID = 24
PREPAID_PAYMENT_TIMEOUT_MIN = 30

VALID_TYPES = {"table", "prepaid"}
ACTIVE_STATUSES = {"pending_payment", "pending_confirmation", "confirmed"}


def _parse_iso_local(date_str: str, time_str: str = "") -> Optional[datetime]:
    """Parse 'YYYY-MM-DD' + optional 'HH:MM' as a Bogota-naive datetime. We treat times
    as local Cartagena (UTC-5) and convert to UTC for comparisons."""
    try:
        if time_str:
            dt_local = datetime.strptime(f"{date_str} {time_str}", "%Y-%m-%d %H:%M")
        else:
            dt_local = datetime.strptime(date_str, "%Y-%m-%d")
        # Cartagena is UTC-5
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
         "instagram": 1, "phone": 1, "is_government": 1, "partner_id": 1},
    )
    return p or {}


async def _hydrate_reservation(r: dict) -> dict:
    r = dict(r)
    r.pop("_id", None)
    if r.get("partner_id"):
        r["partner"] = await _enrich_partner(r["partner_id"])
    if r.get("event_id"):
        ev = await _db().partner_events.find_one(
            {"event_id": r["event_id"]},
            {"_id": 0, "title": 1, "date": 1, "start_time": 1, "category": 1,
             "flyer_url": 1, "price": 1, "is_free": 1, "event_id": 1},
        )
        r["event"] = ev
    return r


def _can_cancel(r: dict) -> tuple[bool, str]:
    """Return (allowed, reason). Reason is non-empty when not allowed."""
    if r.get("status") not in {"pending_payment", "pending_confirmation", "confirmed"}:
        return False, "Esta reserva ya no se puede cancelar."
    dt = _parse_iso_local(r.get("date", ""), r.get("time", "") or "")
    if not dt:
        return True, ""  # malformed date: be lenient
    hrs = _hours_until(dt)
    cutoff = CANCELLATION_HOURS_PREPAID if r.get("type") == "prepaid" else CANCELLATION_HOURS_TABLE
    if hrs < cutoff:
        return False, f"Cancelación gratuita hasta {cutoff}h antes de la reserva."
    return True, ""


# ─────────────────────────────────────────────────────────────
# Public — User-facing routes
# ─────────────────────────────────────────────────────────────

@router.post("/reservations")
async def create_reservation(request: Request):
    """Create a new reservation.
    Body:
      partner_id (str, required)
      type ('table'|'prepaid', required)
      date 'YYYY-MM-DD' (required)
      time 'HH:MM' (required for table; optional for prepaid)
      party_size (int >=1, default 1)
      notes (str, optional, max 280)
      event_id (str, optional — if linked to a partner_event)
      qty (int, for prepaid — defaults to party_size)
      amount_cop (int, prepaid only — server validates against event/partner pricing if event_id provided)

    Returns:
      table   → {reservation, requires_payment: false}
      prepaid → {reservation, requires_payment: true, checkout_url, payment_id, reference, split}
    """
    user = await _deps["get_current_user"](request)
    body = await request.json()

    partner_id = (body.get("partner_id") or "").strip()
    rtype = (body.get("type") or "").strip().lower()
    date = (body.get("date") or "").strip()
    time = (body.get("time") or "").strip()
    party_size = int(body.get("party_size") or 1)
    notes = (body.get("notes") or "").strip()[:280]
    event_id = (body.get("event_id") or "").strip() or None

    if not partner_id:
        raise HTTPException(status_code=400, detail="partner_id requerido")
    if rtype not in VALID_TYPES:
        raise HTTPException(status_code=400, detail="type debe ser 'table' o 'prepaid'")
    if not date or len(date) != 10:
        raise HTTPException(status_code=400, detail="date 'YYYY-MM-DD' requerido")
    if rtype == "table" and not time:
        raise HTTPException(status_code=400, detail="time 'HH:MM' requerido para reservas de mesa")
    if party_size < 1 or party_size > 30:
        raise HTTPException(status_code=400, detail="party_size debe estar entre 1 y 30")

    dt = _parse_iso_local(date, time or "12:00")
    if not dt:
        raise HTTPException(status_code=400, detail="fecha/hora inválida")
    if dt < _now() - timedelta(hours=1):
        raise HTTPException(status_code=400, detail="La fecha de la reserva ya pasó")
    if dt > _now() + timedelta(days=365):
        raise HTTPException(status_code=400, detail="No se pueden reservar fechas con más de 1 año de antelación")

    partner = await _db().partners.find_one({"partner_id": partner_id}, {"_id": 0})
    if not partner:
        raise HTTPException(status_code=404, detail="Partner no encontrado")

    # Validate event if provided
    event_doc = None
    if event_id:
        event_doc = await _db().partner_events.find_one({"event_id": event_id, "partner_id": partner_id}, {"_id": 0})
        if not event_doc:
            raise HTTPException(status_code=404, detail="Evento del partner no encontrado")

    reservation_id = f"res_{uuid.uuid4().hex[:12]}"
    base_doc = {
        "reservation_id": reservation_id,
        "user_id": user["user_id"],
        "user_email": user.get("email"),
        "user_name": user.get("name"),
        "user_phone": user.get("phone"),
        "partner_id": partner_id,
        "partner_name": partner.get("name"),
        "event_id": event_id,
        "type": rtype,
        "date": date,
        "time": time or None,
        "datetime_utc": dt.isoformat(),
        "party_size": party_size,
        "notes": notes,
        "status": "pending_payment" if rtype == "prepaid" else "pending_confirmation",
        "created_at": _iso(),
        "updated_at": _iso(),
        "confirmed_at": None,
        "cancelled_at": None,
        "partner_confirmed_by": None,
        "payment_id": None,
        "amount_cop": 0,
        "currency": "COP",
        "commission_pct": 0.0,
        "app_commission_cop": 0,
        "partner_amount_cop": 0,
    }

    if rtype == "table":
        await _db().reservations.insert_one(dict(base_doc))
        hydrated = await _hydrate_reservation(base_doc)
        return {"reservation": hydrated, "requires_payment": False}

    # ── PREPAID ──
    # Determine amount: from event price * qty, or explicit amount_cop * party_size for fallback.
    qty = int(body.get("qty") or party_size)
    if qty < 1:
        qty = 1
    unit_price = 0
    if event_doc and not event_doc.get("is_free"):
        unit_price = int(event_doc.get("price") or 0)
    if unit_price == 0:
        unit_price = int(body.get("amount_cop") or 0)
    if unit_price < 1000:
        raise HTTPException(status_code=400, detail="amount_cop inválido (mínimo 1000 COP por unidad)")
    amount_cop = unit_price * qty
    if amount_cop > 50_000_000:
        raise HTTPException(status_code=400, detail="monto excede el máximo permitido")

    base_doc["amount_cop"] = amount_cop
    base_doc["qty"] = qty
    base_doc["expires_at"] = (_now() + timedelta(minutes=PREPAID_PAYMENT_TIMEOUT_MIN)).isoformat()

    # Create Wompi payment via shared helper. We use kind='partner_reservation' so wompi.py
    # applies the 5% reservation commission.
    payment = await _deps["create_payment_record"](
        user=user,
        kind="partner_reservation",
        partner_id=partner_id,
        amount_cop=amount_cop,
        currency="COP",
        description=f"Reserva en {partner.get('name')} · {date}" + (f" {time}" if time else ""),
        metadata={
            "reservation_id": reservation_id,
            "party_size": party_size,
            "qty": qty,
            "date": date,
            "time": time or "",
            "event_id": event_id,
        },
        redirect_url=f"/payments/return?reservation_id={reservation_id}",
    )

    base_doc["payment_id"] = payment["payment_id"]
    base_doc["payment_reference"] = payment["reference"]
    base_doc["commission_pct"] = float(payment["split"].get("commission_pct") or 0)
    base_doc["app_commission_cop"] = int(payment["split"].get("app_commission") or 0)
    base_doc["partner_amount_cop"] = int(payment["split"].get("partner_amount") or 0)
    await _db().reservations.insert_one(dict(base_doc))
    # Cross-link payment → reservation
    await _db().payments.update_one(
        {"payment_id": payment["payment_id"]},
        {"$set": {"reservation_id": reservation_id, "metadata.reservation_id": reservation_id}},
    )

    hydrated = await _hydrate_reservation(base_doc)
    return {
        "reservation": hydrated,
        "requires_payment": True,
        "checkout_url": payment["checkout_url"],
        "payment_id": payment["payment_id"],
        "reference": payment["reference"],
        "split": payment["split"],
    }


@router.get("/reservations/my")
async def my_reservations(request: Request):
    """List the calling user's reservations grouped into 'upcoming' & 'past'."""
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

    allowed, reason = _can_cancel(r)
    new_status = "cancelled_by_user" if allowed else "cancelled_late"
    refund_pending = (r.get("type") == "prepaid" and r.get("status") in {"confirmed", "pending_confirmation"} and allowed)

    update = {
        "status": new_status,
        "cancelled_at": _iso(),
        "cancelled_reason": "user",
        "updated_at": _iso(),
    }
    if refund_pending:
        update["refund_status"] = "pending"
    await _db().reservations.update_one({"reservation_id": reservation_id}, {"$set": update})

    updated = await _db().reservations.find_one({"reservation_id": reservation_id}, {"_id": 0})
    return {
        "reservation": await _hydrate_reservation(updated),
        "free_cancellation": allowed,
        "refund_status": "pending" if refund_pending else None,
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

    # Lightweight stats
    pending = await _db().reservations.count_documents({"partner_id": partner_id, "status": "pending_confirmation"})
    confirmed_upcoming = await _db().reservations.count_documents({
        "partner_id": partner_id,
        "status": "confirmed",
        "datetime_utc": {"$gte": _iso()},
    })
    total_commission = 0
    paid_total = 0
    async for r in _db().reservations.find(
        {"partner_id": partner_id, "type": "prepaid", "status": {"$in": ["confirmed", "completed"]}},
        {"_id": 0, "amount_cop": 1, "app_commission_cop": 1},
    ):
        paid_total += int(r.get("amount_cop") or 0)
        total_commission += int(r.get("app_commission_cop") or 0)

    return {
        "reservations": [await _hydrate_reservation(r) for r in docs],
        "stats": {
            "pending_count": pending,
            "confirmed_upcoming_count": confirmed_upcoming,
            "prepaid_revenue_cop": paid_total,
            "prepaid_app_commission_cop": total_commission,
        },
    }


@router.patch("/business/reservations/{reservation_id}")
async def business_update_reservation(reservation_id: str, request: Request):
    """Partner confirms / rejects / completes / marks no-show.
    Body: { action: 'confirm' | 'reject' | 'complete' | 'no_show', note?: string }
    """
    biz = await _deps["get_current_business"](request)
    body = await request.json()
    action = (body.get("action") or "").strip().lower()
    note = (body.get("note") or "").strip()[:280]

    r = await _db().reservations.find_one({"reservation_id": reservation_id, "partner_id": biz["partner_id"]}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reserva no encontrada")

    update = {"updated_at": _iso(), "partner_confirmed_by": biz.get("email")}
    if action == "confirm":
        if r["status"] not in {"pending_confirmation", "pending_payment"}:
            raise HTTPException(status_code=400, detail=f"No se puede confirmar una reserva en estado '{r['status']}'")
        update["status"] = "confirmed"
        update["confirmed_at"] = _iso()
        if note:
            update["partner_note"] = note
    elif action == "reject":
        if r["status"] in {"cancelled_by_user", "cancelled_late", "completed", "no_show"}:
            raise HTTPException(status_code=400, detail=f"No se puede rechazar una reserva en estado '{r['status']}'")
        update["status"] = "rejected_by_partner"
        update["cancelled_at"] = _iso()
        if r.get("type") == "prepaid" and r.get("payment_id"):
            update["refund_status"] = "pending"
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

    pipeline = [
        {"$match": {**base, "type": "prepaid", "status": {"$in": ["confirmed", "completed"]}}},
        {"$group": {
            "_id": None,
            "revenue": {"$sum": "$amount_cop"},
            "app_commission": {"$sum": "$app_commission_cop"},
            "count": {"$sum": 1},
        }},
    ]
    agg = await _db().reservations.aggregate(pipeline).to_list(1)
    revenue = int(agg[0]["revenue"]) if agg else 0
    app_commission = int(agg[0]["app_commission"]) if agg else 0
    prepaid_count = int(agg[0]["count"]) if agg else 0

    table_count = await _db().reservations.count_documents({**base, "type": "table"})

    return {
        "period_days": days,
        "total": total,
        "by_status": by_status,
        "by_type": {"table": table_count, "prepaid": prepaid_count},
        "prepaid_revenue_cop": revenue,
        "prepaid_app_commission_cop": app_commission,
        "currency": "COP",
    }


# ─────────────────────────────────────────────────────────────
# Fulfillment — called by server.py when a Wompi webhook arrives
# ─────────────────────────────────────────────────────────────

async def fulfill_prepaid_reservation(payment: dict) -> Optional[str]:
    """Called from server.py `_fulfill_payment` when kind=='partner_reservation'.
    Moves reservation from pending_payment → pending_confirmation (manual confirm by partner)
    UNLESS the user opted out of partner confirmation. For MVP we keep manual confirmation."""
    reservation_id = (payment.get("metadata") or {}).get("reservation_id") or payment.get("reservation_id")
    if not reservation_id:
        logger.warning("partner_reservation payment without reservation_id: %s", payment.get("payment_id"))
        return None
    r = await _db().reservations.find_one({"reservation_id": reservation_id}, {"_id": 0})
    if not r:
        logger.warning("Reservation %s not found for payment %s", reservation_id, payment.get("payment_id"))
        return None
    # Already fulfilled?
    if r.get("status") not in {"pending_payment"}:
        return reservation_id  # idempotent
    await _db().reservations.update_one(
        {"reservation_id": reservation_id},
        {"$set": {
            "status": "pending_confirmation",
            "paid_at": _iso(),
            "updated_at": _iso(),
            "wompi_transaction_id": payment.get("wompi_transaction_id"),
        }},
    )
    await _db().payments.update_one(
        {"payment_id": payment.get("payment_id")},
        {"$set": {"fulfillment.reservation_id": reservation_id}},
    )
    return reservation_id


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
