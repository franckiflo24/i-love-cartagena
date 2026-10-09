"""tickets.py — consumer-visible TICKETING with the PALCO-grade rotating QR.

Contract: the two frontend builders code against the shapes below verbatim.
Payments-free by design: an event ticket is a FREE registration (RSVP) on a
published partner event — never a sale, never a price (the payments hard gate
stands). The credential is the shared engine (qr_credential.py, PALCO1
byte-identical): wire `AMOTKT1.<ticket_id>.<counter>.<hmac12>` rotating every
10 s, and the City Pass rides the same engine as `AMOPASS1.<pass_id>.…` —
replacing its old static unsigned-JSON QR.

Verdicts at the venue gate: VALIDO / DUPLICADO / FALSIFICADO / EXPIRADO for
event tickets (atomic one-winner flip), and PASE for a City Pass (multi-scan by
nature — it proves the pass is genuine and active; it never "admits"). Guest
name rides every resolvable verdict (PALCO guest-on-scan). A venue may only
scan tickets for ITS OWN events (government sees all); any verified business
may validate a City Pass (it is a cross-venue perks pass).

Secrets never leave the server: holders poll /qr per step; scanners decode the
LIVE camera wire (/business/scanner ships Permissions-Policy: camera=(self);
web getUserMedia + native expo-camera twins) or paste it. Simulate mode derives
the wire server-side and is prod-gated to the AMO door's plain check-in.
"""
from __future__ import annotations

import logging
import os
import secrets as _secrets
import time as _time
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

import qr_credential as qc
from events_time import event_is_live, upcoming_query
from partner_visibility import PARTNER_EVENT_PUBLIC

logger = logging.getLogger(__name__)

router = APIRouter()

NS_TICKET = "AMOTKT1"
NS_PASS = "AMOPASS1"
TICKET_RE = r"^amt_[a-f0-9]{10}$"
import re as _re
_TICKET_ID_RE = _re.compile(TICKET_RE)
_PASS_ID_RE = _re.compile(r"^cp_[a-f0-9]{6,32}$")

db: Any = None
_indexed = False


def init(db_: Any) -> None:
    global db
    db = db_


async def _ensure_indexed() -> None:
    global _indexed
    if _indexed:
        return
    _indexed = True
    try:
        await db.amo_tickets.create_index("ticket_id", unique=True)
        await db.amo_tickets.create_index([("user_id", 1), ("event_id", 1)])
        await db.amo_ticket_scans.create_index("at")
        # LAST on purpose: the RSVP atomic claim's one-winner guarantee NEEDS this partial
        # unique index. Idempotent (the dedupe maintenance route builds the same spec); if
        # legacy duplicates still exist it fails and logs WITHOUT skipping the indexes above —
        # run /palco/admin/maintenance/dedupe-rsvp, which backs up before deleting.
        await db.amo_tickets.create_index(
            [("user_id", 1), ("event_id", 1), ("kind", 1)], unique=True,
            partialFilterExpression={"kind": "event_rsvp"}, name="uniq_user_event_rsvp")
    except Exception as exc:  # noqa: BLE001
        logger.error("[tickets] index ensure failed: %s", type(exc).__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


async def _user(request: Request) -> Dict[str, Any]:
    from server import get_current_user
    return await get_current_user(request)


async def _business(request: Request) -> Dict[str, Any]:
    from server import get_current_business
    return await get_current_business(request)


async def _rl(request: Request, bucket: str, max_calls: int, window: int,
              subject: Optional[str] = None) -> None:
    """Rate limit keyed on `subject` (the authenticated principal) when given, else the
    trusted client IP. Principal keys matter at a door: 120/min/IP is only ~20 open QR
    screens, so a crowd on one venue-WiFi NAT starved its own wallets and the scanner."""
    try:
        from server import _check_rate_limit, _client_ip
        key = subject or _client_ip(request)
        await _check_rate_limit(f"{bucket}:{key}", max_calls=max_calls, window_sec=window)
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001
        pass


def _public_ticket(doc: Mapping[str, Any]) -> Dict[str, Any]:
    return {k: doc.get(k) for k in ("ticket_id", "kind", "event_id", "title", "venue_name",
                                    "partner_id", "partner_name", "date", "start_time",
                                    "status", "used_at", "created_at")}


# ── consumer: free RSVP tickets ───────────────────────────────────────────────

class RsvpBody(BaseModel):
    event_id: str = Field(min_length=4, max_length=60)


@router.post("/tickets/event-rsvp")
async def ticket_rsvp(body: RsvpBody, request: Request):
    user = await _user(request)
    await _rl(request, "tktrsvp", 20, 60)
    await _ensure_indexed()
    ev = await db.partner_events.find_one({"event_id": body.event_id, **PARTNER_EVENT_PUBLIC}, {"_id": 0})
    if not ev or not event_is_live(ev):
        raise HTTPException(status_code=404, detail={
            "error": "not_available",
            "message": "Este evento no está disponible para reservas / This event is not available for registration"})
    # SUPPLY-SPRINT v1: AMO-hosted events carry an RSVP window + capacity.
    # All checks are field-conditional — legacy vendor events (no such fields)
    # behave exactly as before. Window strings are naive America/Bogota
    # "YYYY-MM-DDTHH:MM" (events_time doctrine), compared lexicographically.
    from events_time import now_bogota as _nb
    _now_local = _nb().strftime("%Y-%m-%dT%H:%M")
    if ev.get("rsvp_opens_at") and _now_local < str(ev["rsvp_opens_at"])[:16]:
        raise HTTPException(status_code=409, detail={
            "error": "rsvp_not_open",
            "message": "Las reservas aún no abren para este evento / RSVPs have not opened yet"})
    if ev.get("rsvp_closes_at") and _now_local > str(ev["rsvp_closes_at"])[:16]:
        raise HTTPException(status_code=409, detail={
            "error": "rsvp_closed",
            "message": "Las reservas ya cerraron para este evento / RSVPs are closed"})
    _cap = ev.get("capacity")
    if isinstance(_cap, int) and _cap > 0 and int(ev.get("rsvp_count") or 0) >= _cap:
        raise HTTPException(status_code=409, detail={
            "error": "sold_out",
            "message": "Evento lleno — se acabaron los cupos / Sold out — no spots left"})
    existing = await db.amo_tickets.find_one(
        {"user_id": user["user_id"], "event_id": body.event_id, "kind": "event_rsvp"}, {"_id": 0, "qr_secret": 0})
    if existing:
        return {"ticket": _public_ticket(existing), "already": True}
    partner = await db.partners.find_one({"partner_id": ev.get("partner_id")}, {"_id": 0, "name": 1})
    now = _now()
    doc = {
        "ticket_id": f"amt_{_secrets.token_hex(5)}",
        "kind": "event_rsvp",
        "user_id": user["user_id"],
        # Never the full email: it rides the door list, the guest panel and the scan log
        # (Ley 1581). The local part still lets the door match a name-less account.
        "holder_name": ((user.get("name") or "").strip()
                        or (user.get("email") or "").split("@")[0].strip()
                        or "Invitado")[:60],
        "event_id": body.event_id,
        "host": ev.get("host"),   # "AMO" for AMO-produced nights → the amo_scanner door scope
        "title": ev.get("title") or "",
        "venue_name": (partner or {}).get("name") or "",
        "partner_id": ev.get("partner_id"),
        "partner_name": (partner or {}).get("name") or "",
        "date": ev.get("date"),
        "start_time": ev.get("start_time"),
        "qr_secret": _secrets.token_hex(16),
        "status": "issued",
        "used_at": None,
        "used_gate": None,
        "created_at": _iso(now),
    }
    # Atomic claim (PALCO-V2 Stage A): the old read-then-insert let two
    # concurrent RSVPs mint two tickets. $setOnInsert + the partial unique index
    # (built by /palco/admin/maintenance/dedupe-rsvp) make one winner; the loser
    # gets the winner's ticket back as already=True.
    try:
        claimed = await db.amo_tickets.find_one_and_update(
            {"user_id": user["user_id"], "event_id": body.event_id, "kind": "event_rsvp"},
            {"$setOnInsert": dict(doc)},
            upsert=True, return_document=ReturnDocument.AFTER, projection={"_id": 0, "qr_secret": 0})
    except DuplicateKeyError:
        # Two concurrent upserts raced to CREATE the brand-new row (the known findAndModify-
        # upsert race, now surfaced by uniq_user_event_rsvp): the loser lands here. The
        # winner's ticket IS this user's ticket — hand it back as already=True.
        claimed = await db.amo_tickets.find_one(
            {"user_id": user["user_id"], "event_id": body.event_id, "kind": "event_rsvp"},
            {"_id": 0, "qr_secret": 0})
    if claimed and claimed.get("ticket_id") != doc["ticket_id"]:
        return {"ticket": _public_ticket(claimed), "already": True}

    # Genuine new ticket. On capacity-managed events, atomically claim a seat:
    # the $expr guard makes overselling impossible under any concurrency; if
    # the claim loses (full / closed between checks), the just-minted ticket is
    # compensating-deleted and the caller gets the honest 409 (SUPPLY-SPRINT).
    if isinstance(_cap, int) and _cap > 0:
        seat = await db.partner_events.find_one_and_update(
            {"event_id": body.event_id, "cancelled": {"$ne": True},
             "$expr": {"$lt": [{"$ifNull": ["$rsvp_count", 0]}, "$capacity"]}},
            [{"$set": {"rsvp_count": {"$add": [{"$ifNull": ["$rsvp_count", 0]}, 1]}}}],
            return_document=ReturnDocument.AFTER)
        if seat is None:
            await db.amo_tickets.delete_one({"ticket_id": doc["ticket_id"], "status": "issued"})
            raise HTTPException(status_code=409, detail={
                "error": "sold_out",
                "message": "Evento lleno — se acabaron los cupos / Sold out — no spots left"})
        if int(seat.get("rsvp_count") or 0) >= int(seat.get("capacity") or 0):
            await db.partner_events.update_one({"event_id": body.event_id},
                                               {"$set": {"soldout": True}})
    return {"ticket": _public_ticket(doc)}


@router.get("/tickets/mine")
async def tickets_mine(request: Request):
    user = await _user(request)
    rows = await db.amo_tickets.find(
        {"user_id": user["user_id"]}, {"_id": 0, "qr_secret": 0}).sort("created_at", -1).to_list(100)
    return {"tickets": [_public_ticket(r) for r in rows]}


@router.get("/tickets/{ticket_id}")
async def ticket_one(ticket_id: str, request: Request):
    user = await _user(request)
    if not _TICKET_ID_RE.fullmatch(ticket_id or ""):
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Entrada no encontrada / Ticket not found"})
    doc = await db.amo_tickets.find_one({"ticket_id": ticket_id, "user_id": user["user_id"]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Entrada no encontrada / Ticket not found"})
    return {"ticket": _public_ticket(doc)}


@router.get("/tickets/{ticket_id}/qr")
async def ticket_qr(ticket_id: str, request: Request, response: Response):
    user = await _user(request)
    # Per-USER budget (one open screen needs 6/min; 30 leaves headroom for flapping), with a
    # loose per-IP backstop: a 300-guest crowd on one venue NAT polls ~1800/min legitimately.
    await _rl(request, "tktqr", 30, 60, subject=user["user_id"])
    await _rl(request, "tktqrip", 2400, 60)
    response.headers["Cache-Control"] = "no-store"
    if not _TICKET_ID_RE.fullmatch(ticket_id or ""):
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Entrada no encontrada / Ticket not found"})
    doc = await db.amo_tickets.find_one({"ticket_id": ticket_id, "user_id": user["user_id"]},
                                        {"_id": 0, "qr_secret": 1, "status": 1})
    if not doc:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Entrada no encontrada / Ticket not found"})
    now_ms = int(_time.time() * 1000)  # ONE clock read: wire and expires_in_ms agree at a step boundary
    return {"wire": qc.build_wire(NS_TICKET, ticket_id, doc["qr_secret"], now_ms),
            "step_ms": qc.TOKEN_STEP_SECONDS * 1000, "expires_in_ms": qc.step_remaining_ms(now_ms),
            "status": doc.get("status")}


# ── City Pass: the rotating credential replaces the static unsigned QR ────────

@router.get("/city-pass/qr")
async def city_pass_qr(request: Request, response: Response):
    user = await _user(request)
    # Same split as /tickets/{id}/qr: per-user budget + loose shared-NAT backstop.
    await _rl(request, "passqr", 30, 60, subject=user["user_id"])
    await _rl(request, "passqrip", 2400, 60)
    response.headers["Cache-Control"] = "no-store"
    doc = await db.city_passes.find_one({"user_id": user["user_id"], "is_active": True}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail={"error": "no_pass", "message": "No tienes un pase activo / No active pass"})
    secret = doc.get("qr_secret")
    if not secret:
        # Guarded mint (PALCO-V2 Stage A): the old unconditional $set let two
        # concurrent first calls race, briefly leaving one holder with a wire
        # that scans FALSIFICADO. Set-if-absent, then re-read the winner.
        candidate = _secrets.token_hex(16)
        await db.city_passes.update_one(
            {"pass_id": doc["pass_id"], "$or": [{"qr_secret": {"$exists": False}},
                                                {"qr_secret": None}, {"qr_secret": ""}]},
            {"$set": {"qr_secret": candidate}})
        fresh = await db.city_passes.find_one({"pass_id": doc["pass_id"]}, {"_id": 0, "qr_secret": 1})
        secret = (fresh or {}).get("qr_secret") or candidate
    now_ms = int(_time.time() * 1000)  # ONE clock read: wire and expires_in_ms agree at a step boundary
    return {"wire": qc.build_wire(NS_PASS, doc["pass_id"], secret, now_ms),
            "step_ms": qc.TOKEN_STEP_SECONDS * 1000, "expires_in_ms": qc.step_remaining_ms(now_ms),
            "plan_id": doc.get("plan_id"), "expires_at": doc.get("expires_at")}


# ── venue side: events, guest lists, the gate ─────────────────────────────────

def _is_gov(biz: Mapping[str, Any]) -> bool:
    return biz.get("role") == "government"


def _same_partner(biz: Mapping[str, Any], pid: Any) -> bool:
    """Non-null partner equality. A business row whose partner_id is None must NEVER
    scope-match an event whose partner_id is also None: plain `==` let any unlinked
    account (signup hands out a live session with partner_id None) into the guest list,
    scan and feed of any null-partner event."""
    return bool(pid) and pid == biz.get("partner_id")


@router.get("/business/tickets/events")
async def biz_ticket_events(request: Request):
    biz = await _business(request)
    q: Dict[str, Any] = dict(PARTNER_EVENT_PUBLIC)
    if _is_gov(biz):
        pass  # government sees all events
    elif biz.get("role") == "amo_scanner":
        q["host"] = "AMO"  # the AMO door scanner: every AMO-hosted event
    else:
        if not biz.get("partner_id"):
            return {"events": []}  # an unlinked account scopes to nothing (never partner_id:None)
        q["partner_id"] = biz["partner_id"]
    rows = await db.partner_events.find(upcoming_query(q), {"_id": 0, "event_id": 1, "title": 1,
                                                            "date": 1, "start_time": 1}).sort("date", 1).to_list(50)
    out = []
    for ev in rows:
        rsvp = await db.amo_tickets.count_documents({"event_id": ev["event_id"], "kind": "event_rsvp"})
        used = await db.amo_tickets.count_documents({"event_id": ev["event_id"], "kind": "event_rsvp", "status": "used"})
        out.append({**ev, "rsvp_count": rsvp, "used_count": used})
    return {"events": out}


@router.get("/business/tickets/event/{event_id}")
async def biz_ticket_guestlist(event_id: str, request: Request):
    biz = await _business(request)
    ev = await db.partner_events.find_one({"event_id": event_id}, {"_id": 0, "partner_id": 1, "host": 1})
    if not ev:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Evento no encontrado / Event not found"})
    allowed = (_is_gov(biz) or _same_partner(biz, ev.get("partner_id"))
               or (biz.get("role") == "amo_scanner" and ev.get("host") == "AMO"))
    if not allowed:
        raise HTTPException(status_code=403, detail={"error": "forbidden", "message": "Este evento es de otro negocio / This event belongs to another venue"})
    rows = await db.amo_tickets.find({"event_id": event_id, "kind": "event_rsvp"},
                                     {"_id": 0, "ticket_id": 1, "holder_name": 1, "status": 1,
                                      "used_at": 1, "used_gate": 1}).sort("created_at", -1).to_list(200)
    return {"tickets": rows}


class ScanBody(BaseModel):
    wire: Optional[str] = Field(default=None, min_length=8, max_length=200)
    ticket_id: Optional[str] = None
    simulate: bool = False
    tamper: bool = False
    stale: bool = False
    gate: Optional[str] = Field(default=None, max_length=40)
    # The event the operator is working (optional: older clients omit it). A genuine wire
    # for a DIFFERENT event answers FUERA_DE_ALCANCE instead of admitting+burning it tonight.
    event_id: Optional[str] = Field(default=None, max_length=60)


def _guest_panel(t: Mapping[str, Any]) -> Dict[str, Any]:
    return {"name": t.get("holder_name") or "", "ticket_title": t.get("title") or "",
            "event_date": t.get("date") or "", "venue_name": t.get("venue_name") or ""}


async def _log_scan(verdict: str, biz: Mapping[str, Any], gate: str,
                    guest_name: str = "", title: str = "", ticket_id: str = "",
                    event_id: str = "", method: str = "qr") -> None:
    try:
        await db.amo_ticket_scans.insert_one({
            "at": _iso(_now()), "verdict": verdict, "gate": gate,
            "guest_name": guest_name, "ticket_title": title,
            "ticket_id": ticket_id,   # audit trail (PALCO-V2 §7.4): scans are traceable
            "event_id": event_id,     # which night, without a join through amo_tickets
            "method": method,         # "qr" (possession) vs "manual" (AMO-door check-in)
            "partner_id": biz.get("partner_id"), "scanned_by": biz.get("business_id"),
        })
    except Exception as exc:  # noqa: BLE001
        # Best-effort by design (the atomic flip is the authoritative admit record, and it
        # carries used_by/used_at/used_gate) — but a failing ledger must be LOUD in logs.
        logger.error("[tickets] scan log failed (verdict=%s ticket=%s): %s",
                     verdict, ticket_id or "-", type(exc).__name__)


@router.post("/business/tickets/scan")
async def biz_ticket_scan(body: ScanBody, request: Request):
    biz = await _business(request)
    # Per-ACCOUNT budget (a hot multi-phone door runs ~60-90 scans/min) + a loose IP backstop:
    # the door phones share the venue NAT with the whole crowd's wallet polling.
    await _rl(request, "tktscan", 120, 60, subject=biz.get("business_id"))
    await _rl(request, "tktscanip", 1200, 60)
    await _ensure_indexed()
    gate = body.gate or "Puerta 1"
    wire = body.wire or ""
    method = "manual" if body.simulate else "qr"  # the ledger separates check-ins from possession scans

    if body.simulate:
        # Simulate builds the wire server-side from a ticket id (bypasses
        # proof-of-possession), so it is OFF in production — PALCO-V2 Stage A —
        # EXCEPT a plain check-in admit by the AMO door scanner on its own
        # AMO-hosted event (free-RSVP check-in by trusted staff; never the
        # tamper/stale attack sims, never another venue). Tests/dev keep it all.
        tid = body.ticket_id or ""
        if not _TICKET_ID_RE.fullmatch(tid):
            raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Entrada no encontrada / Ticket not found"})
        doc = await db.amo_tickets.find_one({"ticket_id": tid}, {"_id": 0, "qr_secret": 1, "partner_id": 1, "host": 1, "event_id": 1})
        host = doc.get("host") if doc else None
        if doc and host is None and biz.get("role") == "amo_scanner":
            _hv = await db.partner_events.find_one({"event_id": doc.get("event_id")}, {"_id": 0, "host": 1})
            host = (_hv or {}).get("host")
        amo_scanner_ok = biz.get("role") == "amo_scanner" and host == "AMO"
        in_scope_sim = _is_gov(biz) or (doc is not None and _same_partner(biz, doc.get("partner_id"))) or amo_scanner_ok
        # Foreign venue gets the same 404 as a missing ticket: simulate must not
        # be an existence oracle for other venues' ticket ids.
        if not doc or not in_scope_sim:
            raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Entrada no encontrada / Ticket not found"})
        amo_checkin = amo_scanner_ok and not body.tamper and not body.stale
        if (os.environ.get("VERCEL_ENV") == "production"
                and os.environ.get("PALCO_SIMULATE_ENABLED") != "1"
                and not amo_checkin):
            raise HTTPException(status_code=403, detail={
                "error": "simulate_disabled",
                "message": "Simulación deshabilitada en producción / Simulation is disabled in production"})
        if os.environ.get("VERCEL_ENV") == "production":
            # Burst brake on QR-less admits: a leaked or shared door token cannot loop a
            # guest list through check-in. Prod-only so test suites keep unthrottled runs.
            await _rl(request, "tktsim", 30, 60, subject=biz.get("business_id"))
        c = qc.counter_for_now() - (qc.TOKEN_SKEW_STEPS + 2 if body.stale else 0)
        token = qc.derive_token(tid, doc["qr_secret"], c)
        if body.tamper:
            token = ("0" * qc.TOKEN_LEN) if token[0] != "0" else ("1" * qc.TOKEN_LEN)
        wire = f"{NS_TICKET}.{tid}.{c}.{token}"
    if not wire:
        raise HTTPException(status_code=400, detail={"error": "empty", "message": "Código vacío / Empty code"})

    # City Pass wire → PASE (genuine + active), never a flip, scannable by any business.
    pp = qc.parse_wire(NS_PASS, wire)
    if pp is not None:
        verdict = "FALSIFICADO"
        guest: Optional[Dict[str, Any]] = None
        if _PASS_ID_RE.fullmatch(pp["entity_id"]):
            pdoc = await db.city_passes.find_one({"pass_id": pp["entity_id"]}, {"_id": 0})
            if pdoc and pdoc.get("qr_secret"):
                v = qc.verify(pp, pdoc["qr_secret"])
                if v == "OK":
                    active = bool(pdoc.get("is_active")) and str(pdoc.get("expires_at") or "") > _iso(_now())
                    verdict = "PASE" if active else "EXPIRADO"
                    holder = await db.users.find_one({"user_id": pdoc.get("user_id")}, {"_id": 0, "name": 1, "email": 1})
                    guest = {"name": (holder or {}).get("name") or "", "ticket_title": "City Pass",
                             "event_date": str(pdoc.get("expires_at") or "")[:10], "venue_name": "",
                             "plan_id": pdoc.get("plan_id")}
                elif v == "EXPIRED":
                    verdict = "EXPIRADO"
        await _log_scan(verdict, biz, gate, (guest or {}).get("name", ""), "City Pass",
                        ticket_id=pp["entity_id"], method=method)
        out: Dict[str, Any] = {"verdict": verdict}
        if guest:
            out["guest"] = guest
        return out

    pt = qc.parse_wire(NS_TICKET, wire)
    verdict = "FALSIFICADO"
    detail: Dict[str, Any] = {}
    tdoc = None
    if pt and _TICKET_ID_RE.fullmatch(pt["entity_id"]):
        tdoc = await db.amo_tickets.find_one({"ticket_id": pt["entity_id"]}, {"_id": 0})
    # A doc without a signing key can never authenticate (same guard the pass branch and
    # palco/verify already apply): it answers bare FALSIFICADO, byte-identical to a ghost.
    if pt is not None and tdoc is not None and tdoc.get("qr_secret"):
        # Verify FIRST, scope after (PALCO-V2 Stage A): the old pre-verify 403
        # was an existence oracle for other venues' ticket ids. Signature and
        # freshness precede scope; a genuine-but-foreign wire answers the
        # FUERA_DE_ALCANCE verdict — no flip.
        # CLOSURE-AUDIT FIX (V-A4b, 2026-10-06): enrichment is gated on scope
        # for EVERY verdict, not just FUERA. Out-of-scope responses carry the
        # verdict alone, so a forged wire with a real foreign ticket id is
        # byte-identical to a ghost id (bare FALSIFICADO) — no existence
        # oracle, and the guest panel (holder PII) never crosses venues.
        in_scope = _is_gov(biz) or _same_partner(biz, tdoc.get("partner_id"))
        if not in_scope and biz.get("role") == "amo_scanner":
            # Least-privilege door role: an AMO scanner validates AMO-HOSTED
            # events (Casa Bohême / Zamna CMW nights etc.), whose ticket
            # partner_id is the VENUE, not AMO — so same-partner never matches.
            # It can ONLY scan (no PII/payouts/moderation: those stay gov-gated),
            # and only host=="AMO" tickets; a vendor's own ticket stays out of
            # scope (FUERA_DE_ALCANCE), byte-identical to any wrong-venue scan.
            host = tdoc.get("host")
            if host is None:  # ticket minted before host was stamped on the doc
                _hv = await db.partner_events.find_one(
                    {"event_id": tdoc.get("event_id")}, {"_id": 0, "host": 1})
                host = (_hv or {}).get("host")
            if host == "AMO":
                in_scope = True
        v = qc.verify(pt, tdoc["qr_secret"])
        if v == "COUNTERFEIT":
            verdict = "FALSIFICADO"
        elif v == "EXPIRED":
            verdict = "EXPIRADO"
        elif not in_scope:
            verdict = "FUERA_DE_ALCANCE"
            detail["reason"] = "fuera_de_alcance"
        else:
            # The operator's selected event rides the scan: a genuine wire for a DIFFERENT
            # event must not admit (and burn) at this door. Older clients send no event_id
            # and keep today's behavior.
            if body.event_id and tdoc.get("event_id") != body.event_id:
                verdict = "FUERA_DE_ALCANCE"
                detail["reason"] = "otro_evento"
                await _log_scan(verdict, biz, gate,
                                _guest_panel(tdoc).get("name", ""),
                                tdoc.get("title") or "", ticket_id=pt["entity_id"],
                                event_id=tdoc.get("event_id") or "", method=method)
                detail["guest"] = _guest_panel(tdoc)
                return {"verdict": verdict, **detail}
            # SUPPLY-SPRINT event-state gate: a fresh, correctly-rotating QR
            # must NOT admit to a dead event. Re-read CURRENT event state —
            # cancelled/unpublished → EVENTO_CANCELADO; finished (Bogota,
            # end_time-aware via event_is_live) → EVENTO_VENCIDO. Fail closed:
            # a ticket whose event is missing is a ticket to nothing.
            _ev = await db.partner_events.find_one(
                {"event_id": tdoc.get("event_id")},
                {"_id": 0, "date": 1, "date_end": 1, "date_start": 1,
                 "start_time": 1, "end_time": 1, "cancelled": 1,
                 "is_published": 1, "moderation_status": 1})
            if (_ev is None or _ev.get("cancelled")
                    or not _ev.get("is_published")
                    or _ev.get("moderation_status") != "approved"):
                verdict = "EVENTO_CANCELADO"
                detail["reason"] = "evento_cancelado"
                await _log_scan(verdict, biz, gate,
                                _guest_panel(tdoc).get("name", ""),
                                tdoc.get("title") or "", ticket_id=pt["entity_id"],
                                event_id=tdoc.get("event_id") or "", method=method)
                detail["guest"] = _guest_panel(tdoc)
                return {"verdict": verdict, **detail}
            if not event_is_live(_ev):
                verdict = "EVENTO_VENCIDO"
                detail["reason"] = "evento_vencido"
                await _log_scan(verdict, biz, gate,
                                _guest_panel(tdoc).get("name", ""),
                                tdoc.get("title") or "", ticket_id=pt["entity_id"],
                                event_id=tdoc.get("event_id") or "", method=method)
                detail["guest"] = _guest_panel(tdoc)
                return {"verdict": verdict, **detail}
            # The wrong-NIGHT hole (a next-week ticket burned tonight, because event_is_live
            # only means "not finished yet" and the amo_scanner scope spans every AMO event)
            # is closed above by the event_id binding: the door sends the event it is
            # working, and a ticket for another event already answered FUERA_DE_ALCANCE. A
            # blanket "start_date > today" gate was rejected — it breaks soft-open and
            # multi-day scanning and the established event_is_live contract.
            flipped = await db.amo_tickets.find_one_and_update(
                {"ticket_id": pt["entity_id"], "status": "issued"},
                {"$set": {"status": "used", "used_at": _iso(_now()), "used_gate": gate,
                          # Operator attribution rides the AUTHORITATIVE admit record, so a
                          # lost ledger insert can never orphan an admit (audit 2026-10-09).
                          "used_by": biz.get("business_id")}},
            )
            if flipped is not None:
                verdict = "VALIDO"
            else:
                verdict = "DUPLICADO"
                # Re-read: when two scans race, the loser's pre-flip snapshot has no used_at —
                # the door needs the REAL first-use time + gate, not null.
                fresh = await db.amo_tickets.find_one(
                    {"ticket_id": pt["entity_id"]}, {"_id": 0, "used_at": 1, "used_gate": 1})
                detail["first_used_at"] = (fresh or tdoc).get("used_at")
                detail["first_gate"] = (fresh or tdoc).get("used_gate")
        if in_scope:
            detail["guest"] = _guest_panel(tdoc)
    # Ledger row for every resolved outcome. Name AND title/event are scope-gated (guest is
    # set only in scope): an out-of-scope or ghost row must not carry another venue's event
    # title into this scanner's feed (byte-identical-to-ghost doctrine, V-A4b).
    _scoped = "guest" in detail
    await _log_scan(verdict, biz, gate, ((detail.get("guest") or {}).get("name") or ""),
                    ((tdoc or {}).get("title") or "") if _scoped else "",
                    ticket_id=(pt or {}).get("entity_id") or "",
                    event_id=((tdoc or {}).get("event_id") or "") if _scoped else "",
                    method=method)
    return {"verdict": verdict, **detail}


@router.get("/business/tickets/scan-feed")
async def biz_scan_feed(request: Request):
    biz = await _business(request)
    if _is_gov(biz):
        q: Dict[str, Any] = {}
    elif biz.get("role") == "amo_scanner":
        q = {"scanned_by": biz.get("business_id")}  # its own door log only
    else:
        if not biz.get("partner_id"):
            return {"scans": []}  # an unlinked account scopes to nothing (never partner_id:None)
        q = {"partner_id": biz["partner_id"]}
    rows = await db.amo_ticket_scans.find(q, {"_id": 0}).sort("at", -1).to_list(20)
    return {"scans": rows}
