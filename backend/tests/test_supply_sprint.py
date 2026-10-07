"""SUPPLY-SPRINT v1 acceptance: honesty rails, atomic capacity, event-state
gate, drought math. In-memory db (pipeline-update aware); server.py never
imported — module accessors are monkeypatched like the sibling suites."""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import amo_events_admin as A  # noqa: E402
import qr_credential as qc  # noqa: E402
import tickets as T  # noqa: E402
from palco import verify as pv  # noqa: E402

NOW = datetime.now(timezone.utc)
FUT = (NOW + timedelta(days=3)).strftime("%Y-%m-%d")
PAST = (NOW - timedelta(days=2)).strftime("%Y-%m-%d")


# ── fake db (adds pipeline-update + $expr/$ifNull/$add + delete) ──────────────

def _gp(d, k):
    cur = d
    for p in k.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(p)
    return cur


def _ev_expr(expr, doc):
    if isinstance(expr, str) and expr.startswith("$"):
        return _gp(doc, expr[1:])
    if isinstance(expr, dict):
        if "$ifNull" in expr:
            a, b = expr["$ifNull"]
            v = _ev_expr(a, doc)
            return b if v is None else v
        if "$lt" in expr:
            a, b = expr["$lt"]
            return _ev_expr(a, doc) < _ev_expr(b, doc)
        if "$add" in expr:
            return sum(_ev_expr(x, doc) for x in expr["$add"])
    return expr


def _match(d, q):
    for k, v in q.items():
        if k == "$expr":
            if not _ev_expr(v, d):
                return False
        elif k == "$and":
            if not all(_match(d, s) for s in v):
                return False
        elif k == "$or":
            if not any(_match(d, s) for s in v):
                return False
        elif isinstance(v, dict):
            if "$ne" in v and _gp(d, k) == v["$ne"]:
                return False
            if "$in" in v and _gp(d, k) not in v["$in"]:
                return False
            if "$nin" in v and _gp(d, k) in v["$nin"]:
                return False
            if "$gte" in v and not (_gp(d, k) is not None and _gp(d, k) >= v["$gte"]):
                return False
            if "$lt" in v and not (_gp(d, k) is not None and _gp(d, k) < v["$lt"]):
                return False
        elif _gp(d, k) != v:
            return False
    return True


class _Cur:
    def __init__(self, rows): self._r = rows
    def sort(self, *a, **k): return self
    async def to_list(self, n): return self._r[:n]


class _Coll:
    def __init__(self, rows=None): self.rows: List[Dict[str, Any]] = [dict(r) for r in (rows or [])]
    async def insert_one(self, doc): self.rows.append(dict(doc))
    async def find_one(self, q, proj=None):
        for d in self.rows:
            if _match(d, q):
                out = dict(d)
                if proj:
                    for k, v in proj.items():
                        if v == 0 and k != "_id":
                            out.pop(k, None)
                return out
        return None
    def find(self, q, proj=None):
        return _Cur([dict(d) for d in self.rows if _match(d, q)])
    async def count_documents(self, q):
        return sum(1 for d in self.rows if _match(d, q))
    async def update_one(self, q, u):
        class R: matched_count = 0
        r = R()
        for d in self.rows:
            if _match(d, q):
                r.matched_count = 1
                for k, v in u.get("$set", {}).items():
                    d[k] = v
                return r
        return r
    async def find_one_and_update(self, q, u, upsert=False, return_document=None, projection=None):
        for d in self.rows:
            if _match(d, q):
                before = {k: (dict(v) if isinstance(v, dict) else v) for k, v in d.items()}
                if isinstance(u, list):           # pipeline update
                    for stage in u:
                        for k, v in stage.get("$set", {}).items():
                            d[k] = _ev_expr(v, d)
                else:
                    for k, v in u.get("$set", {}).items():
                        d[k] = v
                return dict(d) if return_document else before
        if upsert and not isinstance(u, list):
            doc = dict(u.get("$setOnInsert", {}))
            self.rows.append(doc)
            return dict(doc) if return_document else None
        return None
    async def delete_one(self, q):
        for i, d in enumerate(self.rows):
            if _match(d, q):
                self.rows.pop(i)
                return
    async def create_index(self, *a, **k): return None


class _DB:
    def __init__(self):
        self.partners = _Coll([
            {"partner_id": "ptr_ok", "name": "Baluarte de la Gente",
             "display_ready": True},
            {"partner_id": "ptr_gated", "name": "RAW NAME / SEO BLOB",
             "display_ready": False, "name_raw": "RAW NAME / SEO BLOB",
             "address": "Calle Real #1, Getsemaní"},
        ])
        self.partner_events = _Coll()
        self.amo_tickets = _Coll()
        self.amo_ticket_scans = _Coll()
        self.city_passes = _Coll()
        self.civic_demo_tickets = _Coll()
        self.palco_scan_log = _Coll()
        self.credentials = _Coll()
        self.credential_devices = _Coll()
        self.users = _Coll([{"user_id": "u1", "name": "Ana"}])


USER = {"user_id": "u1", "name": "Ana Viajera", "email": "a@x.co"}
BIZ = {"business_id": "bizA", "partner_id": "ptr_ok", "role": "business"}


@pytest.fixture()
def ctx(monkeypatch):
    db = _DB()
    A.init(db)
    T.init(db)
    pv_db = db
    state = {"user": USER, "biz": BIZ}

    async def fake_user(req): return state["user"]
    async def fake_biz(req): return state["biz"]
    async def fake_rl(req, *a, **k): return None
    async def fake_admin(req): return None
    monkeypatch.setattr(T, "_user", fake_user)
    monkeypatch.setattr(T, "_business", fake_biz)
    monkeypatch.setattr(T, "_rl", fake_rl)
    monkeypatch.setattr(A, "_require_admin", fake_admin)

    app = FastAPI()
    app.include_router(A.router, prefix="/api")
    app.include_router(T.router, prefix="/api")
    return TestClient(app), db, state, pv_db


def _mk_event(client, **over):
    body = {"title": "AMO Sunset en las Murallas", "partner_id": "ptr_ok",
            "date": FUT, "start_time": "17:30", "capacity": 3,
            "batch_tag": "t"}
    body.update(over)
    r = client.post("/api/admin/amo-events", json=body)
    assert r.status_code == 200, r.text
    return r.json()["event"]


def _publish(client, eid):
    r = client.patch(f"/api/admin/amo-events/{eid}", json={"publish": True})
    assert r.status_code == 200, r.text


# ── honesty rails ─────────────────────────────────────────────────────────────

def test_price_fields_rejected_everywhere(ctx):
    client, db, _s, _ = ctx
    r = client.post("/api/admin/amo-events", json={
        "title": "Paid thing", "partner_id": "ptr_ok", "date": FUT,
        "start_time": "20:00", "capacity": 10, "price_cop": 50000})
    assert r.status_code == 422 and "free_only" in r.text
    ev = _mk_event(client)
    r2 = client.patch(f"/api/admin/amo-events/{ev['event_id']}", json={"precio": "10"})
    assert r2.status_code == 422


def test_created_event_is_free_amo_hosted_draft(ctx):
    client, db, _s, _ = ctx
    ev = _mk_event(client)
    row = db.partner_events.rows[0]
    assert row["is_free"] is True and row["host"] == "AMO"
    assert row["is_published"] is False and row["rsvp_count"] == 0
    # a draft never reaches discovery
    from partner_visibility import PARTNER_EVENT_PUBLIC
    assert _match(row, PARTNER_EVENT_PUBLIC) is False


def test_publish_requires_future_and_ready_venue(ctx):
    client, db, _s, _ = ctx
    past = _mk_event(client, date=PAST, title="Past thing ok len")
    r = client.patch(f"/api/admin/amo-events/{past['event_id']}", json={"publish": True})
    assert r.status_code == 422 and "not_future" in r.text
    r2 = client.post("/api/admin/amo-events", json={
        "title": "At gated venue", "partner_id": "ptr_gated", "date": FUT,
        "start_time": "20:00", "capacity": 5})
    assert r2.status_code == 422 and "display_ready" in r2.text


def test_promote_venue_drains_gate(ctx):
    client, db, _s, _ = ctx
    r = client.post("/api/admin/amo-events/promote-venue", json={"partner_id": "ptr_gated"})
    assert r.status_code == 200 and r.json()["display_ready"] is True
    assert db.partners.rows[1]["name_verified"] is True


def test_cancel_unpublishes_and_flags(ctx):
    client, db, _s, _ = ctx
    ev = _mk_event(client)
    _publish(client, ev["event_id"])
    r = client.post(f"/api/admin/amo-events/{ev['event_id']}/cancel",
                    json={"reason": "lluvia"})
    assert r.status_code == 200
    row = db.partner_events.rows[0]
    assert row["cancelled"] is True and row["is_published"] is False
    from partner_visibility import PARTNER_EVENT_PUBLIC
    assert _match(row, PARTNER_EVENT_PUBLIC) is False


# ── atomic RSVP + capacity ───────────────────────────────────────────────────

def test_capacity_exact_and_soldout_flip(ctx):
    client, db, state, _ = ctx
    ev = _mk_event(client)           # capacity 3
    _publish(client, ev["event_id"])
    for i in range(3):
        state["user"] = {"user_id": f"u{i}", "name": f"User {i}", "email": "x@x.co"}
        r = client.post("/api/tickets/event-rsvp", json={"event_id": ev["event_id"]})
        assert r.status_code == 200 and not r.json().get("already")
    row = db.partner_events.rows[0]
    assert row["rsvp_count"] == 3 and row["soldout"] is True
    state["user"] = {"user_id": "u99", "name": "Tarde", "email": "t@x.co"}
    r4 = client.post("/api/tickets/event-rsvp", json={"event_id": ev["event_id"]})
    assert r4.status_code == 409 and "sold_out" in r4.text
    assert len(db.amo_tickets.rows) == 3          # no phantom ticket
    assert row["rsvp_count"] == 3                  # no phantom seat


def test_same_user_concurrent_rsvp_is_one_ticket_one_seat(ctx):
    client, db, state, _ = ctx
    ev = _mk_event(client, capacity=10)
    _publish(client, ev["event_id"])
    rs = [client.post("/api/tickets/event-rsvp", json={"event_id": ev["event_id"]})
          for _ in range(20)]
    assert all(r.status_code == 200 for r in rs)
    assert sum(1 for r in rs if not r.json().get("already")) == 1
    assert len(db.amo_tickets.rows) == 1
    assert db.partner_events.rows[0]["rsvp_count"] == 1


def test_rsvp_window_honest_rejects(ctx):
    client, db, state, _ = ctx
    far = (NOW + timedelta(days=5)).strftime("%Y-%m-%dT%H:%M")
    ev = _mk_event(client, rsvp_opens_at=far, title="Opens later event")
    _publish(client, ev["event_id"])
    r = client.post("/api/tickets/event-rsvp", json={"event_id": ev["event_id"]})
    assert r.status_code == 409 and "rsvp_not_open" in r.text
    ev2 = _mk_event(client, rsvp_closes_at="2020-01-01T00:00", title="Closed event ok")
    _publish(client, ev2["event_id"])
    r2 = client.post("/api/tickets/event-rsvp", json={"event_id": ev2["event_id"]})
    assert r2.status_code == 409 and "rsvp_closed" in r2.text


# ── event-state gate at the door ─────────────────────────────────────────────

def _wire_for(db, tid):
    sec = next(d["qr_secret"] for d in db.amo_tickets.rows if d["ticket_id"] == tid)
    return qc.build_wire("AMOTKT1", tid, sec)


def _rsvp(client, state, eid, uid="u1"):
    state["user"] = {"user_id": uid, "name": "Ana Viajera", "email": "a@x.co"}
    r = client.post("/api/tickets/event-rsvp", json={"event_id": eid})
    assert r.status_code == 200
    return r.json()["ticket"]["ticket_id"]


def test_scan_gate_cancelled_vencido_valido(ctx):
    client, db, state, _ = ctx
    ev = _mk_event(client, capacity=10)
    _publish(client, ev["event_id"])
    tid = _rsvp(client, state, ev["event_id"])
    # live event → VALIDO
    r = client.post("/api/business/tickets/scan", json={"wire": _wire_for(db, tid)})
    assert r.json()["verdict"] == "VALIDO"
    # cancelled event, FRESH wire from a second ticket holder → EVENTO_CANCELADO
    tid2 = _rsvp(client, state, ev["event_id"], uid="u2")
    client.post(f"/api/admin/amo-events/{ev['event_id']}/cancel", json={"reason": "lluvia"})
    r2 = client.post("/api/business/tickets/scan", json={"wire": _wire_for(db, tid2)})
    assert r2.json()["verdict"] == "EVENTO_CANCELADO"
    assert next(d for d in db.amo_tickets.rows if d["ticket_id"] == tid2)["status"] == "issued"
    # past event → EVENTO_VENCIDO
    db.partner_events.rows[0].update({"cancelled": False, "is_published": True,
                                      "date": PAST, "date_end": PAST})
    r3 = client.post("/api/business/tickets/scan", json={"wire": _wire_for(db, tid2)})
    assert r3.json()["verdict"] == "EVENTO_VENCIDO"


def test_palco_legacy_mirror_sees_same_truth(ctx):
    client, db, state, _ = ctx
    ev = _mk_event(client, capacity=10)
    _publish(client, ev["event_id"])
    tid = _rsvp(client, state, ev["event_id"])
    scope = {"gov": True, "partner_id": None, "scanner_id": "g", "gate": "G"}
    async def run(w):
        return await pv.verify_scan(db, w, scope)
    r = asyncio.new_event_loop().run_until_complete(run(_wire_for(db, tid)))
    assert r["verdict"] == "VALIDO"
    client.post(f"/api/admin/amo-events/{ev['event_id']}/cancel", json={"reason": "lluvia"})
    r2 = asyncio.new_event_loop().run_until_complete(run(_wire_for(db, tid)))
    assert r2["verdict"] == "EVENTO_CANCELADO"


# ── drought math + honesty sweep ─────────────────────────────────────────────

def test_drought_counts_only_rsvpable(ctx):
    client, db, state, _ = ctx
    a = _mk_event(client, capacity=2, title="Night A ok length")
    _publish(client, a["event_id"])
    b = _mk_event(client, capacity=1, title="Night B ok length")
    _publish(client, b["event_id"])
    _rsvp(client, state, b["event_id"])            # B is now full
    _mk_event(client, title="Draft never counts")  # draft
    from partner_visibility import PARTNER_EVENT_PUBLIC
    rows = [r for r in db.partner_events.rows if _match(r, PARTNER_EVENT_PUBLIC)]
    live = [r for r in rows
            if not (isinstance(r.get("capacity"), int) and r["capacity"] > 0
                    and int(r.get("rsvp_count") or 0) >= r["capacity"])]
    assert len(rows) == 2 and len(live) == 1       # only A is RSVP-able


def test_honesty_no_payment_wording_in_new_surface():
    src = (BACKEND / "amo_events_admin.py").read_text(encoding="utf-8")
    seed = (BACKEND / "scripts" / "seed_amo_experiences.py").read_text(encoding="utf-8")
    # The _PRICE_KEYS blocklist legitimately NAMES the banned words in order to
    # reject them — exempt those lines, then sweep the rest of both files.
    def strip_blocklist(text: str) -> str:
        return "\n".join(l for l in text.splitlines()
                         if "_PRICE_KEYS" not in l and '"wompi"' not in l
                         and '"checkout_url"' not in l)
    body = strip_blocklist(src)
    for banned in ("Pagar", "MOCK_PAY", "IAP", "checkout", "wompi", "Wompi"):
        assert banned not in body, banned
    assert '"is_free": True' in src                   # stamped server-side
    assert '"rsvp_count": 0' in src
    assert "reserva gratis" in seed.lower()
    for banned in ("Pagar", "MOCK_PAY", "precio:", "price_cop"):
        assert banned not in seed, banned
