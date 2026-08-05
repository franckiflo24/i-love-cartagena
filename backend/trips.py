"""Drop 10 — MI VIAJE: the collaborative trip planner.

Model: shared-and-refreshes. ONE shared itinerary per trip, multi-user edit,
sync on open / pull-to-refresh, per-item last-write-wins (edits logged on the
item). NOT live-cursor sync — no websocket infra; the schema leaves room for it.

SECURITY (the B2 chat-IDOR lesson applied to trips): a trip is permissioned
data. EVERY read/write resolves the trip server-side and checks the requester
is a member with sufficient role — a non-member gets 403 (not the trip), a
viewer cannot write. Ownership is never trusted from the client. The ONLY
unauthenticated surface is GET /trips/shared/{share_code} (guest VIEW — the
I6 never-wall principle), which serves a read-only projection with internal
user_ids stripped.

VENUE BINDING (the Drop 9/8 lesson): items snapshot ref_name at add time; on
read, refs are re-resolved against the LIVE catalog through
PUBLIC_PARTNER_FILTER — a churned/ghost/unapproved ref degrades to the saved
name + resolved:false ("ya no disponible"), never a broken card, and
unapproved partner content can never leak in through a trip item.

HONESTY: no fake presence — the trip shows real members and real updated_at.
Suggested ordering uses real category time-bands + the real sunset table
(walking's month table); it is a SUGGESTION the user applies or ignores.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from partner_visibility import PUBLIC_PARTNER_FILTER

logger = logging.getLogger("trips")

router = APIRouter()

db = None
_check_rate_limit = None
_get_current_user = None

ROLE_RANK = {"viewer": 1, "editor": 2, "owner": 3}
MAX_TRIPS_PER_USER = 20
MAX_ITEMS_PER_TRIP = 120
MAX_MEMBERS_PER_TRIP = 12
ITEM_HISTORY_CAP = 15

REF_TYPES = ("venue", "experience", "stamp", "custom")

# Honest time-band suggestion: category → typical band (1=morning … 6=night).
# Bar with a sunset/rooftop tag slots to the REAL sunset band; everything is a
# suggestion the user can override — never auto-applied.
_CATEGORY_BAND = {
    "cafe": 1, "bakery": 1,
    "attraction": 2, "activity": 2, "yacht": 2, "beach_club": 2, "service": 2,
    "spa": 3, "shop": 3,
    "bar": 5, "restaurant": 5, "hotel": 3,
    "club": 6, "nightclub": 6,
}
_SUNSET_TAGS = {"sunset_view", "rooftop", "sea_view"}


def init(*, db_, get_current_user, check_rate_limit):
    global db, _get_current_user, _check_rate_limit
    db = db_
    _get_current_user = get_current_user
    _check_rate_limit = check_rate_limit


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return (fwd.split(",")[0].strip() if fwd else None) or (request.client.host if request.client else "?")


# ── Access control (the IDOR gate) ───────────────────────────────────
async def _trip_for(user_id: str, trip_id: str, min_role: str) -> Dict[str, Any]:
    """Resolve the trip AND enforce membership+role server-side. 403 for a
    non-member or an insufficient role — the trip itself is never returned
    to someone below the required role."""
    trip = await db.trips.find_one({"trip_id": trip_id}, {"_id": 0})
    if not trip:
        raise HTTPException(status_code=404, detail="Viaje no encontrado / Trip not found")
    me = next((m for m in trip.get("members", []) if m.get("user_id") == user_id), None)
    if not me or ROLE_RANK.get(me.get("role"), 0) < ROLE_RANK[min_role]:
        raise HTTPException(status_code=403, detail="No tenés acceso a este viaje / You don't have access to this trip")
    trip["_my_role"] = me.get("role")
    return trip


# ── Item enrichment (venue binding, B2 content guard) ────────────────
async def _enrich_items(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    venue_ids = [i.get("ref_id") for i in items if i.get("ref_type") == "venue" and i.get("ref_id")]
    exp_ids = [i.get("ref_id") for i in items if i.get("ref_type") == "experience" and i.get("ref_id")]
    venues: Dict[str, Dict[str, Any]] = {}
    exps: Dict[str, Dict[str, Any]] = {}
    if venue_ids:
        async for p in db.partners.find(
            {**PUBLIC_PARTNER_FILTER, "partner_id": {"$in": venue_ids}},
            {"_id": 0, "partner_id": 1, "name": 1, "category": 1, "subcategory": 1,
             "image_url": 1, "neighborhood": 1, "zone": 1, "rating": 1, "tags": 1},
        ):
            venues[p["partner_id"]] = p
    if exp_ids:
        async for e in db.partner_events.find(
            {"event_id": {"$in": exp_ids}, "is_published": True},
            {"_id": 0, "event_id": 1, "title": 1, "date": 1, "start_time": 1, "partner_id": 1, "category": 1},
        ):
            exps[e["event_id"]] = e
        # experience venue must ALSO be approved (same guard as every public feed)
        pe_pids = list({e.get("partner_id") for e in exps.values() if e.get("partner_id")})
        ok_pids = set()
        if pe_pids:
            async for p in db.partners.find(
                {**PUBLIC_PARTNER_FILTER, "partner_id": {"$in": pe_pids}}, {"_id": 0, "partner_id": 1}
            ):
                ok_pids.add(p["partner_id"])
        exps = {k: v for k, v in exps.items() if v.get("partner_id") in ok_pids}

    out = []
    for i in items:
        item = dict(i)
        rt = item.get("ref_type")
        if rt == "venue":
            v = venues.get(item.get("ref_id"))
            item["resolved"] = bool(v)
            if v:
                item["venue"] = v
        elif rt == "experience":
            e = exps.get(item.get("ref_id"))
            item["resolved"] = bool(e)
            if e:
                item["experience"] = e
        elif rt == "stamp":
            try:
                import walking as _walking
                sp = next((s for s in _walking._load_seasonal().get("stamps", [])
                           if s.get("id") == item.get("ref_id")), None)
            except Exception:
                sp = None
            item["resolved"] = bool(sp)
            if sp:
                item["stamp"] = {"id": sp["id"], "name": sp.get("name_es"), "icon": sp.get("icon")}
        else:  # custom — free text, always safe
            item["resolved"] = True
        out.append(item)
    return out


def _member_public(m: Dict[str, Any]) -> Dict[str, Any]:
    return {"user_id": m.get("user_id"), "name": m.get("name") or "Viajero", "role": m.get("role")}


def _write_limit(user_id: str):
    """One throttle for EVERY mutating trip route (audit #4) — each write also
    touches the trip doc, so an unthrottled loop is 2x write amplification."""
    _check_rate_limit(f"tripwrite:{user_id}", max_calls=120, window_sec=60)


async def _trip_payload(trip: Dict[str, Any]) -> Dict[str, Any]:
    # `history` (raw superseded edits, incl. free text) stays server-side for
    # the edit log — it is NOT shipped to every member (audit #6b).
    items = await db.trip_items.find({"trip_id": trip["trip_id"]}, {"_id": 0, "history": 0}).sort(
        [("day", 1), ("order", 1), ("added_at", 1)]).to_list(MAX_ITEMS_PER_TRIP)
    return {
        "trip_id": trip["trip_id"],
        "name": trip.get("name"),
        "dates": trip.get("dates"),
        "share_code": trip.get("share_code"),
        "members": [_member_public(m) for m in trip.get("members", [])],
        "my_role": trip.get("_my_role"),
        "updated_at": trip.get("updated_at"),
        "items": await _enrich_items(items),
    }


async def _touch(trip_id: str):
    await db.trips.update_one({"trip_id": trip_id}, {"$set": {"updated_at": _now_iso()}})


# ── Trips CRUD ───────────────────────────────────────────────────────
class TripCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    dates: Optional[Dict[str, str]] = None  # {start, end} YYYY-MM-DD


class TripPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    dates: Optional[Dict[str, str]] = None


def _clean_dates(dates: Optional[Dict[str, str]]) -> Optional[Dict[str, str]]:
    if not dates:
        return None
    out = {}
    for k in ("start", "end"):
        v = (dates.get(k) or "").strip()[:10]
        if v:
            try:
                datetime.strptime(v, "%Y-%m-%d")
            except ValueError:
                raise HTTPException(status_code=400, detail="Fecha inválida / Invalid date (YYYY-MM-DD)")
            out[k] = v
    return out or None


@router.post("/trips")
async def create_trip(body: TripCreate, request: Request):
    user = await _get_current_user(request)
    _check_rate_limit(f"trips:{user['user_id']}", max_calls=20, window_sec=3600)
    mine = await db.trips.count_documents({"members.user_id": user["user_id"]})
    if mine >= MAX_TRIPS_PER_USER:
        raise HTTPException(status_code=400, detail="Límite de viajes alcanzado / Trip limit reached")
    trip = {
        "trip_id": f"trip_{uuid.uuid4().hex[:12]}",
        "name": body.name.strip(),
        "owner_user_id": user["user_id"],
        "dates": _clean_dates(body.dates),
        "members": [{"user_id": user["user_id"], "name": user.get("name") or "Viajero",
                     "role": "owner", "joined": _now_iso()}],
        "share_code": None,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
    await db.trips.insert_one(trip)
    trip.pop("_id", None)
    trip["_my_role"] = "owner"
    return await _trip_payload(trip)


@router.get("/trips/mine")
async def my_trips(request: Request):
    user = await _get_current_user(request)
    rows = await db.trips.find({"members.user_id": user["user_id"]}, {"_id": 0}).sort(
        "updated_at", -1).to_list(MAX_TRIPS_PER_USER)
    out = []
    for t in rows:
        me = next((m for m in t.get("members", []) if m["user_id"] == user["user_id"]), {})
        out.append({
            "trip_id": t["trip_id"], "name": t.get("name"), "dates": t.get("dates"),
            "members_count": len(t.get("members", [])), "my_role": me.get("role"),
            "updated_at": t.get("updated_at"),
            "items_count": await db.trip_items.count_documents({"trip_id": t["trip_id"]}),
        })
    return {"trips": out}


@router.get("/trips/{trip_id}")
async def get_trip(trip_id: str, request: Request):
    user = await _get_current_user(request)
    trip = await _trip_for(user["user_id"], trip_id, "viewer")
    return await _trip_payload(trip)


@router.patch("/trips/{trip_id}")
async def patch_trip(trip_id: str, body: TripPatch, request: Request):
    user = await _get_current_user(request)
    await _trip_for(user["user_id"], trip_id, "owner")
    _write_limit(user["user_id"])
    sets: Dict[str, Any] = {"updated_at": _now_iso()}
    if body.name is not None:
        sets["name"] = body.name.strip()
    if body.dates is not None:
        sets["dates"] = _clean_dates(body.dates)
    await db.trips.update_one({"trip_id": trip_id}, {"$set": sets})
    return {"ok": True}


@router.delete("/trips/{trip_id}")
async def delete_trip(trip_id: str, request: Request):
    user = await _get_current_user(request)
    await _trip_for(user["user_id"], trip_id, "owner")
    _write_limit(user["user_id"])
    await db.trip_items.delete_many({"trip_id": trip_id})
    await db.trips.delete_one({"trip_id": trip_id})
    return {"ok": True}


# ── Items ────────────────────────────────────────────────────────────
class ItemCreate(BaseModel):
    ref_type: Literal["venue", "experience", "stamp", "custom"]
    ref_id: Optional[str] = Field(default=None, max_length=64)
    custom_text: Optional[str] = Field(default=None, max_length=120)
    day: Optional[int] = Field(default=None, ge=1, le=30)
    time_slot: Optional[str] = Field(default=None, max_length=20)
    note: Optional[str] = Field(default=None, max_length=200)


class ItemPatch(BaseModel):
    day: Optional[int] = Field(default=None, ge=0, le=30)  # 0 clears the day
    time_slot: Optional[str] = Field(default=None, max_length=20)
    note: Optional[str] = Field(default=None, max_length=200)
    status: Optional[Literal["idea", "planned", "done"]] = None
    order: Optional[float] = None


async def _ref_snapshot(ref_type: str, ref_id: Optional[str]) -> Optional[str]:
    """Resolve + snapshot the display name at add time. Returns the name, or
    raises 404 if a catalog ref doesn't resolve (custom needs no ref)."""
    if ref_type == "custom":
        return None
    if not ref_id:
        raise HTTPException(status_code=400, detail="ref_id requerido / ref_id required")
    if ref_type == "venue":
        p = await db.partners.find_one({**PUBLIC_PARTNER_FILTER, "partner_id": ref_id},
                                       {"_id": 0, "name": 1})
        if p:
            return p.get("name")
    elif ref_type == "experience":
        # Same guard as the venue branch (audit #3a): the event's HOSTING
        # venue must be catalog-approved right now, not just at publish time.
        e = await db.partner_events.find_one({"event_id": ref_id, "is_published": True},
                                             {"_id": 0, "title": 1, "partner_id": 1})
        if e and await db.partners.find_one(
            {**PUBLIC_PARTNER_FILTER, "partner_id": e.get("partner_id")},
            {"_id": 0, "partner_id": 1},
        ):
            return e.get("title")
    elif ref_type == "stamp":
        try:
            import walking as _walking
            sp = next((s for s in _walking._load_seasonal().get("stamps", [])
                       if s.get("id") == ref_id), None)
            if sp:
                return sp.get("name_es")
        except Exception:
            pass
    raise HTTPException(status_code=404, detail="Referencia no encontrada / Reference not found")


@router.post("/trips/{trip_id}/items")
async def add_item(trip_id: str, body: ItemCreate, request: Request):
    user = await _get_current_user(request)
    await _trip_for(user["user_id"], trip_id, "editor")
    _check_rate_limit(f"tripitem:{user['user_id']}", max_calls=60, window_sec=3600)
    if await db.trip_items.count_documents({"trip_id": trip_id}) >= MAX_ITEMS_PER_TRIP:
        raise HTTPException(status_code=400, detail="Límite de items alcanzado / Item limit reached")
    if body.ref_type == "custom" and not (body.custom_text or "").strip():
        raise HTTPException(status_code=400, detail="Texto requerido / Text required")
    name = await _ref_snapshot(body.ref_type, body.ref_id)
    item = {
        "item_id": f"ti_{uuid.uuid4().hex[:12]}",
        "trip_id": trip_id,
        "ref_type": body.ref_type,
        "ref_id": body.ref_id if body.ref_type != "custom" else None,
        "ref_name": name,
        "custom_text": (body.custom_text or "").strip() or None,
        "added_by_user_id": user["user_id"],
        "added_by_name": user.get("name") or "Viajero",
        "added_at": _now_iso(),
        "day": body.day,
        "time_slot": (body.time_slot or "").strip() or None,
        "note": (body.note or "").strip() or None,
        "votes": [],
        "status": "idea",
        "order": datetime.now(timezone.utc).timestamp(),
        "updated_at": _now_iso(),
        "history": [],
    }
    await db.trip_items.insert_one(item)
    item.pop("_id", None)
    await _touch(trip_id)
    return (await _enrich_items([item]))[0]


@router.patch("/trips/{trip_id}/items/{item_id}")
async def patch_item(trip_id: str, item_id: str, body: ItemPatch, request: Request):
    user = await _get_current_user(request)
    await _trip_for(user["user_id"], trip_id, "editor")
    _write_limit(user["user_id"])
    existing = await db.trip_items.find_one({"item_id": item_id, "trip_id": trip_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Item no encontrado / Item not found")
    sets: Dict[str, Any] = {"updated_at": _now_iso()}
    changed: Dict[str, Any] = {}
    if body.day is not None:
        sets["day"] = body.day or None
        changed["day"] = body.day or None
    if body.time_slot is not None:
        sets["time_slot"] = body.time_slot.strip() or None
        changed["time_slot"] = sets["time_slot"]
    if body.note is not None:
        sets["note"] = body.note.strip() or None
        changed["note"] = sets["note"]
    if body.status is not None:
        sets["status"] = body.status
        changed["status"] = body.status
    if body.order is not None:
        sets["order"] = body.order
        changed["order"] = body.order
    # Last-write-wins per item; BOTH edits stay visible in the capped history.
    entry = {"by": user.get("name") or "Viajero", "at": _now_iso(), "changed": changed}
    await db.trip_items.update_one(
        {"item_id": item_id, "trip_id": trip_id},
        {"$set": sets, "$push": {"history": {"$each": [entry], "$slice": -ITEM_HISTORY_CAP}}},
    )
    await _touch(trip_id)
    return {"ok": True}


@router.delete("/trips/{trip_id}/items/{item_id}")
async def delete_item(trip_id: str, item_id: str, request: Request):
    user = await _get_current_user(request)
    await _trip_for(user["user_id"], trip_id, "editor")
    _write_limit(user["user_id"])
    r = await db.trip_items.delete_one({"item_id": item_id, "trip_id": trip_id})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Item no encontrado / Item not found")
    await _touch(trip_id)
    return {"ok": True}


@router.post("/trips/{trip_id}/items/{item_id}/vote")
async def vote_item(trip_id: str, item_id: str, request: Request):
    """Toggle my vote. ANY member (incl. viewer) can vote — a reaction is not
    an edit, and the consensus view is the point of the group layer."""
    user = await _get_current_user(request)
    await _trip_for(user["user_id"], trip_id, "viewer")
    _write_limit(user["user_id"])
    existing = await db.trip_items.find_one({"item_id": item_id, "trip_id": trip_id},
                                            {"_id": 0, "votes": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Item no encontrado / Item not found")
    if user["user_id"] in (existing.get("votes") or []):
        await db.trip_items.update_one({"item_id": item_id, "trip_id": trip_id},
                                       {"$pull": {"votes": user["user_id"]},
                                        "$set": {"updated_at": _now_iso()}})
        voted = False
    else:
        await db.trip_items.update_one({"item_id": item_id, "trip_id": trip_id},
                                       {"$addToSet": {"votes": user["user_id"]},
                                        "$set": {"updated_at": _now_iso()}})
        voted = True
    await _touch(trip_id)
    return {"ok": True, "voted": voted}


# ── Sharing + membership ─────────────────────────────────────────────
@router.post("/trips/{trip_id}/share")
async def ensure_share(trip_id: str, request: Request):
    user = await _get_current_user(request)
    trip = await _trip_for(user["user_id"], trip_id, "owner")
    _write_limit(user["user_id"])
    code = trip.get("share_code")
    if not code:
        for _ in range(5):
            # 48 bits of entropy (12 hex chars) — a guessable code IS the trip's
            # read capability, so it must not be brute-forceable (audit #2).
            code = "VIAJE" + uuid.uuid4().hex[:12].upper()
            try:
                await db.trips.update_one({"trip_id": trip_id}, {"$set": {"share_code": code}})
                break
            except Exception:
                continue
    return {"share_code": code, "url": f"https://www.amocartagena.co/viaje/shared/{code}"}


@router.get("/trips/shared/{share_code}")
async def guest_view(share_code: str, request: Request):
    """PUBLIC guest VIEW (I6 — never wall the view). Read-only projection:
    member display names only (no user_ids), items enriched, vote COUNTS.
    Actions require sign-in — enforced by every write route above."""
    _check_rate_limit(f"tripguest:{_client_ip(request)}", max_calls=30, window_sec=60)
    # Secondary enumeration brake keyed by the CODE itself — survives spoofed
    # X-Forwarded-For buckets (audit #2): a code can only be probed so fast
    # globally, whoever is asking.
    _check_rate_limit(f"tripcode:{share_code.strip().upper()[:24]}", max_calls=60, window_sec=60)
    trip = await db.trips.find_one({"share_code": share_code.strip().upper()}, {"_id": 0})
    if not trip:
        raise HTTPException(status_code=404, detail="Viaje no encontrado / Trip not found")
    items = await db.trip_items.find({"trip_id": trip["trip_id"]}, {"_id": 0}).sort(
        [("day", 1), ("order", 1), ("added_at", 1)]).to_list(MAX_ITEMS_PER_TRIP)
    enriched = await _enrich_items(items)
    return {
        "name": trip.get("name"),
        "dates": trip.get("dates"),
        "members": [{"name": m.get("name") or "Viajero"} for m in trip.get("members", [])],
        "updated_at": trip.get("updated_at"),
        # Data minimization (audit #6a): the guest UI renders name/day/time/
        # who-added/votes ONLY — so that is ALL the public payload carries.
        # No ref_id, no member free-text notes, no vote identities.
        "items": [{
            "item_id": i["item_id"], "ref_type": i["ref_type"],
            "ref_name": i.get("ref_name"), "custom_text": i.get("custom_text"),
            "added_by_name": i.get("added_by_name"), "day": i.get("day"),
            "time_slot": i.get("time_slot"),
            "votes_count": len(i.get("votes") or []), "status": i.get("status"),
            "resolved": i.get("resolved"),
            **({"venue": i["venue"]} if i.get("venue") else {}),
            **({"experience": i["experience"]} if i.get("experience") else {}),
            **({"stamp": i["stamp"]} if i.get("stamp") else {}),
        } for i in enriched],
        "share_code": trip.get("share_code"),
    }


class JoinBody(BaseModel):
    share_code: str = Field(min_length=4, max_length=20)


@router.post("/trips/join")
async def join_trip(body: JoinBody, request: Request):
    """Join via share code → EDITOR. Judgment call: the share link IS the
    invite ('Únete a nuestro viaje') — the owner shared it to collaborate.
    Owner can demote to viewer or remove afterwards."""
    user = await _get_current_user(request)
    _check_rate_limit(f"tripjoin:{user['user_id']}", max_calls=10, window_sec=3600)
    trip = await db.trips.find_one({"share_code": body.share_code.strip().upper()}, {"_id": 0})
    if not trip:
        raise HTTPException(status_code=404, detail="Código inválido / Invalid code")
    if any(m["user_id"] == user["user_id"] for m in trip.get("members", [])):
        return {"ok": True, "trip_id": trip["trip_id"], "already_member": True}
    if len(trip.get("members", [])) >= MAX_MEMBERS_PER_TRIP:
        raise HTTPException(status_code=400, detail="Viaje lleno / Trip is full")
    await db.trips.update_one(
        {"trip_id": trip["trip_id"]},
        {"$push": {"members": {"user_id": user["user_id"], "name": user.get("name") or "Viajero",
                               "role": "editor", "joined": _now_iso()}},
         "$set": {"updated_at": _now_iso()}},
    )
    return {"ok": True, "trip_id": trip["trip_id"]}


class MemberPatch(BaseModel):
    role: Literal["viewer", "editor"]


@router.patch("/trips/{trip_id}/members/{member_user_id}")
async def patch_member(trip_id: str, member_user_id: str, body: MemberPatch, request: Request):
    user = await _get_current_user(request)
    trip = await _trip_for(user["user_id"], trip_id, "owner")
    _write_limit(user["user_id"])
    if member_user_id == trip["owner_user_id"]:
        raise HTTPException(status_code=400, detail="El dueño no cambia de rol / Owner role is fixed")
    r = await db.trips.update_one(
        {"trip_id": trip_id, "members.user_id": member_user_id},
        {"$set": {"members.$.role": body.role, "updated_at": _now_iso()}},
    )
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Miembro no encontrado / Member not found")
    return {"ok": True}


@router.delete("/trips/{trip_id}/members/{member_user_id}")
async def remove_member(trip_id: str, member_user_id: str, request: Request):
    """Owner removes anyone (except self); any member can remove THEMSELF (leave)."""
    user = await _get_current_user(request)
    trip = await _trip_for(user["user_id"], trip_id, "viewer")
    _write_limit(user["user_id"])
    is_owner = trip["owner_user_id"] == user["user_id"]
    if member_user_id == trip["owner_user_id"]:
        raise HTTPException(status_code=400, detail="El dueño no puede salir; borrá el viaje / Owner can't leave; delete the trip")
    if not is_owner and member_user_id != user["user_id"]:
        raise HTTPException(status_code=403, detail="Solo el dueño remueve miembros / Only the owner removes members")
    await db.trips.update_one({"trip_id": trip_id},
                              {"$pull": {"members": {"user_id": member_user_id}},
                               "$set": {"updated_at": _now_iso()}})
    return {"ok": True}


# ── Honest suggested order (10B4) ────────────────────────────────────
@router.get("/trips/{trip_id}/suggest-order")
async def suggest_order(trip_id: str, request: Request):
    """SUGGESTION ONLY: a proposed within-day order from real category
    time-bands + the real sunset table. The client shows it; the user applies
    or ignores it. Nothing is written here."""
    user = await _get_current_user(request)
    trip = await _trip_for(user["user_id"], trip_id, "viewer")
    payload = await _trip_payload(trip)
    sunset_hhmm = None
    try:
        import walking as _walking
        now_bog = datetime.now(timezone.utc).astimezone(_walking.BOGOTA)
        lo, _hi = _walking._sunset_window_min(now_bog)
        smin = lo + 45
        sunset_hhmm = f"{smin // 60:02d}:{smin % 60:02d}"
    except Exception:
        pass

    def band(it: Dict[str, Any]) -> int:
        v = it.get("venue") or {}
        cat = v.get("category") or ""
        tags = set(v.get("tags") or [])
        if tags & _SUNSET_TAGS and cat in ("bar", "restaurant", "hotel"):
            return 4  # real sunset band
        if it.get("ref_type") == "experience":
            return 2  # tours/experiences run daytime
        return _CATEGORY_BAND.get(cat, 3)

    by_day: Dict[Any, List[Dict[str, Any]]] = {}
    for it in payload["items"]:
        by_day.setdefault(it.get("day"), []).append(it)
    suggestion = []
    for day, its in sorted(by_day.items(), key=lambda kv: (kv[0] is None, kv[0])):
        ordered = sorted(its, key=band)
        suggestion.append({"day": day, "item_ids": [i["item_id"] for i in ordered]})
    return {"suggestion": suggestion, "sunset": sunset_hhmm,
            "note": "Sugerencia según franjas reales (café→mañana, rooftop→atardecer, cena→noche). Vos decidís."}
