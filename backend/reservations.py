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
ACTIVE_STATUSES = {"pending_confirmation", "pending_partner_activation", "confirmed"}
TERMINAL_STATUSES = {
    "cancelled_by_user", "cancelled_late", "rejected_by_partner",
    "completed", "no_show", "expired",
}

# Estimated commercial value per locked lead (COP). Used in dashboard "locked value" metrics
# to drive partner upgrade. Conservative: avg restaurant ticket ~$80,000 COP × 2 pax.
LOCKED_LEAD_VALUE_COP = 160_000


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


async def _hydrate_reservation(r: dict, *, censor: bool = False) -> dict:
    """Hydrate a reservation with partner/event info.
    censor=True (used for FREE partners viewing their own leads) masks user contact fields,
    forcing the partner to upgrade to PRO to see who is requesting."""
    r = dict(r)
    r.pop("_id", None)
    if censor:
        # Mask user identity / contact channels — keep date/party/notes visible as proof of value
        full_name = r.get("user_name") or ""
        r["user_name"] = (full_name[:1].upper() + "•••") if full_name else "Cliente"
        r["user_email"] = "•••@•••"
        r["user_phone"] = "+57 ••• •• •••"
        r["user_whatsapp"] = "+57 ••• •• •••"
        r["is_locked"] = True
    if r.get("partner_id"):
        partner = await _enrich_partner(r["partner_id"])
        r["partner"] = partner
        # Surface payment info + contacts ONLY when confirmed (so the client knows
        # exactly when to pay). Pending/locked requests don't get payment info yet.
        if r.get("status") == "confirmed":
            r["payment_info"] = {
                "payment_link": partner.get("default_payment_link") or None,
                "whatsapp": partner.get("whatsapp") or partner.get("phone") or None,
                "phone": partner.get("phone") or None,
                "email": partner.get("email") or None,
                "instagram": partner.get("instagram") or None,
                "note": r.get("partner_note") or None,
            }
        # Expose partner plan so the user UI can render the right copy
        r["partner_plan"] = partner.get("membership_plan") or "free"
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


async def _notify_user(user_id: str, title: str, body: str, kind: str, ref: dict | None = None):
    """Insert a notification for an end user AND send a real push notification
    to all of their registered devices via Expo Push Service."""
    if not user_id:
        return
    try:
        await _db().notifications.insert_one({
            "notification_id": f"notif_{uuid.uuid4().hex[:10]}",
            "user_id": user_id,
            "audience": "user",
            "kind": kind,
            "title": title,
            "body": body,
            "ref": ref or {},
            "is_read": False,
            "created_at": _iso(),
        })
    except Exception as e:
        logger.warning("Could not insert user notification: %s", e)
    # Fire real push notification (non-blocking on failure)
    try:
        from push import push_to_user  # type: ignore
        await push_to_user(_db(), user_id, title, body, data={"kind": kind, **(ref or {})})
    except Exception as e:
        logger.warning("push_to_user failed: %s", e)


async def _notify_partner(partner_id: str, title: str, body: str, kind: str, ref: dict | None = None):
    """Insert a notification for a partner AND send a real push notification
    to all of the partner's registered devices."""
    if not partner_id:
        return
    try:
        await _db().notifications.insert_one({
            "notification_id": f"notif_{uuid.uuid4().hex[:10]}",
            "partner_id": partner_id,
            "audience": "partner",
            "kind": kind,
            "title": title,
            "body": body,
            "ref": ref or {},
            "is_read": False,
            "created_at": _iso(),
        })
    except Exception as e:
        logger.warning("Could not insert partner notification: %s", e)
    # Fire real push notification (non-blocking on failure)
    try:
        from push import push_to_partner  # type: ignore
        await push_to_partner(_db(), partner_id, title, body, data={"kind": kind, **(ref or {})})
    except Exception as e:
        logger.warning("push_to_partner failed: %s", e)


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

    partner_plan = partner.get("membership_plan") or "free"
    is_pro = partner_plan == "pro"

    if event_id:
        ev = await _db().partner_events.find_one({"event_id": event_id, "partner_id": partner_id}, {"_id": 0})
        if not ev:
            raise HTTPException(status_code=404, detail="Evento del partner no encontrado")

    reservation_id = f"res_{uuid.uuid4().hex[:12]}"
    # PRO partners → 'pending_confirmation' (they can confirm in their dashboard)
    # FREE partners → 'pending_partner_activation' (lead captured; partner sees it locked until upgrade)
    initial_status = "pending_confirmation" if is_pro else "pending_partner_activation"

    doc = {
        "reservation_id": reservation_id,
        "user_id": user["user_id"],
        "user_email": user.get("email"),
        "user_name": user.get("name"),
        "user_phone": user.get("phone"),
        "user_whatsapp": user.get("whatsapp") or user.get("phone"),
        "partner_id": partner_id,
        "partner_name": partner.get("name"),
        "partner_plan_at_request": partner_plan,
        "event_id": event_id,
        "type": "table",  # normalised — there's only one type now
        "date": date,
        "time": time,
        "datetime_utc": dt.isoformat(),
        "party_size": party_size,
        "notes": notes,
        "status": initial_status,
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

    # Notify the partner about the new request — message differs based on plan to drive upgrade
    if is_pro:
        notif_title = "Nueva solicitud de reserva"
        notif_body = f"{user.get('name') or 'Un cliente'} pidió mesa para {party_size} el {date}" + (f" a las {time}" if time else "")
    else:
        notif_title = "🔒 Solicitud recibida — Activa PRO para responder"
        notif_body = f"Una nueva solicitud para {party_size} personas el {date}. Activa tu cuenta PRO para ver al cliente y confirmar."
    await _notify_partner(
        partner_id,
        title=notif_title,
        body=notif_body,
        kind="reservation_request" if is_pro else "locked_lead",
        ref={"reservation_id": reservation_id, "locked": not is_pro},
    )

    # Notify the END USER too so they see "Reserva enviada" in their notifications inbox.
    partner_name = (partner or {}).get("name") or "el partner"
    if is_pro:
        user_notif_body = f"Tu solicitud para {partner_name} el {date}" + (f" a las {time}" if time else "") + " fue enviada. Te avisaremos cuando confirmen."
    else:
        user_notif_body = f"Tu solicitud para {partner_name} fue enviada. Este partner aún no gestiona reservas en la app — te avisaremos si activan su cuenta."
    await _notify_user(
        user.get("user_id"),
        title="Reserva enviada",
        body=user_notif_body,
        kind="reservation_created",
        ref={"reservation_id": reservation_id, "partner_id": partner_id},
    )

    hydrated = await _hydrate_reservation(doc)
    if is_pro:
        message = "Tu solicitud fue enviada al partner. Te avisaremos cuando confirme y verás su link de pago en la app."
    else:
        message = "Solicitud enviada. Este partner aún no gestiona reservas vía Amo Cartagena — le hemos notificado tu pedido y te avisaremos si activa su cuenta."
    return {
        "reservation": hydrated,
        "locked": not is_pro,
        "partner_plan": partner_plan,
        "message": message,
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


@router.get("/business/notifications")
async def business_list_notifications(request: Request, unread_only: bool = False, limit: int = 50):
    """List notifications addressed to the calling partner."""
    biz = await _deps["get_current_business"](request)
    q: dict[str, Any] = {"partner_id": biz["partner_id"], "audience": "partner"}
    if unread_only:
        q["is_read"] = False
    cursor = _db().notifications.find(q, {"_id": 0}).sort("created_at", -1).limit(min(max(int(limit), 1), 200))
    docs = await cursor.to_list(200)
    unread_count = await _db().notifications.count_documents({
        "partner_id": biz["partner_id"], "audience": "partner", "is_read": False,
    })
    return {"notifications": docs, "unread_count": unread_count}


@router.put("/business/notifications/{notification_id}/read")
async def business_mark_notification_read(notification_id: str, request: Request):
    biz = await _deps["get_current_business"](request)
    await _db().notifications.update_one(
        {"notification_id": notification_id, "partner_id": biz["partner_id"], "audience": "partner"},
        {"$set": {"is_read": True}},
    )
    return {"ok": True}


@router.put("/business/notifications/read-all")
async def business_mark_all_read(request: Request):
    biz = await _deps["get_current_business"](request)
    res = await _db().notifications.update_many(
        {"partner_id": biz["partner_id"], "audience": "partner", "is_read": False},
        {"$set": {"is_read": True}},
    )
    return {"ok": True, "marked": res.modified_count}


# ─────────────────────────────────────────────────────────────
# Partner-facing routes
# ─────────────────────────────────────────────────────────────

@router.get("/business/reservations")
async def business_list_reservations(request: Request, status: str = "", limit: int = 100):
    biz = await _deps["get_current_business"](request)
    partner_id = biz["partner_id"]
    partner = await _db().partners.find_one({"partner_id": partner_id}, {"_id": 0, "membership_plan": 1, "tier": 1})
    plan = (partner or {}).get("membership_plan") or "free"
    is_pro = plan == "pro"

    q: dict[str, Any] = {"partner_id": partner_id}
    if status:
        q["status"] = status
    cursor = _db().reservations.find(q, {"_id": 0}).sort("datetime_utc", -1).limit(min(max(int(limit), 1), 500))
    docs = await cursor.to_list(500)

    pending = await _db().reservations.count_documents({
        "partner_id": partner_id,
        "status": {"$in": ["pending_confirmation", "pending_partner_activation"]},
    })
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
    # Total locked leads ever (for upgrade pitch)
    locked_leads = await _db().reservations.count_documents({
        "partner_id": partner_id,
        "status": "pending_partner_activation",
    })

    # Hydrate; censor when partner is free
    hydrated = [await _hydrate_reservation(r, censor=not is_pro) for r in docs]

    return {
        "reservations": hydrated,
        "stats": {
            "pending_count": pending,
            "confirmed_upcoming_count": confirmed_upcoming,
            "completed_last_30d": completed_30d,
            "locked_leads_count": locked_leads,
            "estimated_locked_value_cop": locked_leads * LOCKED_LEAD_VALUE_COP,
        },
        "membership_plan": plan,
        "upgrade_required": not is_pro,
    }


@router.patch("/business/reservations/{reservation_id}")
async def business_update_reservation(reservation_id: str, request: Request):
    """Partner confirms / rejects / completes / marks no-show.
    Confirmation does NOT trigger any payment — the user will see the partner's
    `default_payment_link` (saved on the partner profile) in the reservation card.
    Locked behind PRO membership: FREE partners receive 402 and a CTA to upgrade."""
    biz = await _deps["get_current_business"](request)
    body = await request.json()
    action = (body.get("action") or "").strip().lower()
    note = (body.get("note") or "").strip()[:280]

    r = await _db().reservations.find_one({"reservation_id": reservation_id, "partner_id": biz["partner_id"]}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Reserva no encontrada")

    # ── Freemium gate ──
    partner = await _db().partners.find_one({"partner_id": biz["partner_id"]}, {"_id": 0, "membership_plan": 1})
    plan = (partner or {}).get("membership_plan") or "free"
    if plan != "pro":
        raise HTTPException(
            status_code=402,
            detail="Activa tu cuenta PRO para gestionar reservas. Toca 'Activar PRO' en tu panel.",
        )

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

    # Emit user-facing notification on partner decision
    user_id = r.get("user_id")
    if action == "confirm":
        await _notify_user(
            user_id,
            title="¡Reserva confirmada!",
            body=f"{r.get('partner_name') or 'El partner'} confirmó tu reserva del {r.get('date')}{' a las ' + r.get('time') if r.get('time') else ''}. Toca para ver el link de pago.",
            kind="reservation_confirmed",
            ref={"reservation_id": reservation_id, "partner_id": r.get("partner_id")},
        )
    elif action == "reject":
        await _notify_user(
            user_id,
            title="Reserva rechazada",
            body=(note or f"{r.get('partner_name') or 'El partner'} no pudo aceptar tu reserva. Prueba con otra fecha."),
            kind="reservation_rejected",
            ref={"reservation_id": reservation_id, "partner_id": r.get("partner_id")},
        )

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
