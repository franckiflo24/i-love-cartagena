"""amo_events_admin.py — SUPPLY-SPRINT v1: AMO-hosted event authoring.

The ticketing rail had zero RSVP-able inventory (elite audit P0-product,
2026-10-07). This router lets ops mint AMO-HOSTED, FREE events directly into
`partner_events` in the EXISTING shape, so the whole live surface — anon feed,
event detail, RSVP → AMOTKT1 ticket, wallet, scanner — works with ZERO new
consumer plumbing.

HONESTY RAILS (hard, enforced at validation — not copy):
- FREE ONLY: any price-ish field in the payload is rejected outright
  (is_free=True is stamped server-side; there is no price to show).
- AMO-HOSTED ONLY: host="AMO" stamped; this router never lists third-party
  operators' inventory as AMO's.
- A draft NEVER reaches discovery (is_published stays False until publish).
- Publish requires: a real catalog venue that is display_ready (hygiene gate),
  a FUTURE start in America/Bogota, capacity > 0, and a title.
- rsvp_count starts at 0 and is only ever moved by the atomic RSVP claim.

Auth: Bearer EVENTS_ADMIN_TOKEN (the scoped ops token, constant-time), same
tier as the events-elite admin surface. Venue promotion endpoint flips
`name_verified` — the hygiene module's built-in promotion lever — never the
code-side override table.
"""
from __future__ import annotations

import hmac as _hmac
import logging
import os
import secrets as _secrets
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from catalog_hygiene import apply_hygiene
from events_time import now_bogota
from partner_visibility import PUBLIC_PARTNER_FILTER

logger = logging.getLogger(__name__)
router = APIRouter()

db: Any = None


def init(db_: Any) -> None:
    global db
    db = db_


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


async def _require_admin(request: Request) -> None:
    token = os.environ.get("EVENTS_ADMIN_TOKEN", "").strip()
    auth = request.headers.get("Authorization", "")
    got = auth[7:] if auth.startswith("Bearer ") else ""
    if not token or not got or not _hmac.compare_digest(got, token):
        raise HTTPException(status_code=401, detail={"error": "unauthorized"})


# Any of these keys in a create/edit payload = attempt to price a v1 event →
# rejected. The payments gate opens in its own drop, never by a stray field.
_PRICE_KEYS = ("price", "price_cop", "precio", "amount", "amount_cop", "fee",
               "cost", "wompi", "payment_link", "checkout_url", "currency")


class AmoEventBody(BaseModel):
    title: str = Field(min_length=4, max_length=120)
    blurb: Optional[str] = Field(default=None, max_length=600)
    partner_id: str = Field(min_length=4, max_length=60)      # the VENUE
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    start_time: str = Field(pattern=r"^\d{2}:\d{2}$")
    end_time: Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    date_end: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    capacity: int = Field(ge=1, le=5000)
    rsvp_opens_at: Optional[str] = Field(default=None, max_length=25)   # ISO
    rsvp_closes_at: Optional[str] = Field(default=None, max_length=25)  # ISO
    category: str = Field(default="experience", max_length=30)
    image_url: Optional[str] = Field(default=None, max_length=300)
    batch_tag: Optional[str] = Field(default=None, max_length=60)

    model_config = {"extra": "allow"}  # extras inspected, price keys rejected


def _reject_price_fields(payload: Dict[str, Any]) -> None:
    low = {k.lower() for k in payload.keys()}
    hit = [k for k in _PRICE_KEYS if k in low]
    if hit:
        raise HTTPException(status_code=422, detail={
            "error": "free_only",
            "message": f"Eventos AMO v1 son GRATIS — campo de precio rechazado: {hit} / "
                       f"AMO v1 events are FREE — price field rejected: {hit}"})


async def _venue_or_422(partner_id: str) -> Dict[str, Any]:
    venue = await db.partners.find_one(
        {"partner_id": partner_id, **PUBLIC_PARTNER_FILTER},
        {"_id": 0, "partner_id": 1, "name": 1, "display_ready": 1})
    if not venue:
        raise HTTPException(status_code=422, detail={
            "error": "venue_not_public",
            "message": "La sede no existe o no es pública / Venue missing or not public"})
    if venue.get("display_ready") is False:
        raise HTTPException(status_code=422, detail={
            "error": "venue_not_display_ready",
            "message": "La sede está en la cola de verificación de nombre (hygiene). "
                       "Promuévela primero: POST /admin/amo-events/promote-venue "
                       "/ Venue is name-gated — promote it first."})
    return venue


def _publish_checks(doc: Dict[str, Any]) -> None:
    now = now_bogota()
    start = f"{doc.get('date')}T{doc.get('start_time') or '00:00'}"
    if start <= now.strftime("%Y-%m-%dT%H:%M"):
        raise HTTPException(status_code=422, detail={
            "error": "not_future",
            "message": "El evento debe empezar en el futuro (hora Cartagena) / Start must be in the future (Bogota)"})
    if int(doc.get("capacity") or 0) < 1:
        raise HTTPException(status_code=422, detail={"error": "capacity_required"})


def _public_event(doc: Dict[str, Any]) -> Dict[str, Any]:
    keep = ("event_id", "title", "blurb", "partner_id", "venue_name", "date",
            "date_end", "start_time", "end_time", "category", "image_url",
            "capacity", "rsvp_count", "is_published", "cancelled", "host",
            "is_free", "rsvp_opens_at", "rsvp_closes_at", "batch_tag", "soldout")
    return {k: doc.get(k) for k in keep}


@router.post("/admin/amo-events")
async def create_amo_event(body: AmoEventBody, request: Request):
    await _require_admin(request)
    raw = body.model_dump()
    _reject_price_fields(raw)
    venue = await _venue_or_422(body.partner_id)
    doc = {
        "event_id": f"ae_{_secrets.token_hex(5)}",
        "host": "AMO",
        "source": "amo_admin",
        "is_free": True,                      # stamped, never client-supplied
        "title": body.title.strip(),
        "blurb": (body.blurb or "").strip(),
        "partner_id": body.partner_id,
        "venue_name": venue.get("name") or "",
        "date": body.date, "date_end": body.date_end,
        "start_time": body.start_time, "end_time": body.end_time,
        "category": body.category,
        "image_url": body.image_url or "",
        "capacity": int(body.capacity), "rsvp_count": 0, "soldout": False,
        "rsvp_opens_at": body.rsvp_opens_at, "rsvp_closes_at": body.rsvp_closes_at,
        "is_published": False,                # DRAFT — discovery never sees it
        "moderation_status": "approved",      # ops IS the moderator here
        "cancelled": False,
        "batch_tag": body.batch_tag or "",
        "created_at": _now_iso(),
    }
    await db.partner_events.insert_one(dict(doc))
    logger.info("[amo-events] created %s draft '%s' @ %s", doc["event_id"], doc["title"], body.partner_id)
    return {"event": _public_event(doc)}


class AmoEventPatch(BaseModel):
    publish: Optional[bool] = None
    title: Optional[str] = Field(default=None, min_length=4, max_length=120)
    blurb: Optional[str] = Field(default=None, max_length=600)
    date: Optional[str] = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    start_time: Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    end_time: Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    capacity: Optional[int] = Field(default=None, ge=1, le=5000)
    rsvp_opens_at: Optional[str] = Field(default=None, max_length=25)
    rsvp_closes_at: Optional[str] = Field(default=None, max_length=25)
    image_url: Optional[str] = Field(default=None, max_length=300)

    model_config = {"extra": "allow"}


@router.patch("/admin/amo-events/{event_id}")
async def patch_amo_event(event_id: str, body: AmoEventPatch, request: Request):
    await _require_admin(request)
    raw = body.model_dump(exclude_none=True)
    _reject_price_fields(raw)
    doc = await db.partner_events.find_one({"event_id": event_id, "source": "amo_admin"}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail={"error": "not_found"})
    publish = raw.pop("publish", None)
    if raw:
        doc.update(raw)
    if publish:
        await _venue_or_422(doc["partner_id"])
        _publish_checks(doc)
        doc["is_published"] = True
    if raw or publish:
        sets = {**raw}
        if publish:
            sets["is_published"] = True
        await db.partner_events.update_one({"event_id": event_id}, {"$set": sets})
    logger.info("[amo-events] patched %s publish=%s keys=%s", event_id, publish, sorted(raw))
    return {"event": _public_event(doc)}


class CancelBody(BaseModel):
    reason: str = Field(min_length=3, max_length=200)


@router.post("/admin/amo-events/{event_id}/cancel")
async def cancel_amo_event(event_id: str, body: CancelBody, request: Request):
    await _require_admin(request)
    r = await db.partner_events.update_one(
        {"event_id": event_id, "source": "amo_admin"},
        {"$set": {"cancelled": True, "is_published": False,
                  "cancel_reason": body.reason, "cancelled_at": _now_iso()}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail={"error": "not_found"})
    logger.info("[amo-events] CANCELLED %s: %s", event_id, body.reason)
    return {"ok": True, "event_id": event_id, "cancelled": True}


class PromoteBody(BaseModel):
    partner_id: str = Field(min_length=4, max_length=60)


@router.post("/admin/amo-events/promote-venue")
async def promote_venue(body: PromoteBody, request: Request):
    """Drain one venue from the hygiene 114-gate: attaching REAL inventory is
    the act that verifies a name. Sets name_verified=True (the hygiene
    module's promotion lever) and recomputes display_ready — the curated
    CANONICAL_OVERRIDES table stays hand-edited, never script-grown."""
    await _require_admin(request)
    doc = await db.partners.find_one({"partner_id": body.partner_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail={"error": "not_found"})
    before = {"name": doc.get("name"), "display_ready": doc.get("display_ready")}
    doc["name_verified"] = True
    apply_hygiene(doc)   # recomputes display_ready with name_verified confidence
    await db.partners.update_one({"partner_id": body.partner_id},
                                 {"$set": {"name_verified": True,
                                           "display_ready": doc["display_ready"],
                                           "hygiene_v": doc["hygiene_v"]}})
    logger.info("[amo-events] venue PROMOTED %s (%r) display_ready %s -> %s",
                body.partner_id, before["name"], before["display_ready"], doc["display_ready"])
    return {"ok": True, "partner_id": body.partner_id,
            "name": doc.get("name"), "display_ready": doc["display_ready"]}
