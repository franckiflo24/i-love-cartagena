"""TICKETS: free RSVP credentials + City Pass rotating QR + the venue gate.
Shared-engine vectors, ownership walls, verdict matrix with guest-on-scan,
PASE semantics. Throwaway FastAPI + in-memory db; server.py never imported."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import qr_credential as qc  # noqa: E402
import tickets as T  # noqa: E402

NOW = datetime.now(timezone.utc)
D1 = (NOW + timedelta(days=5)).strftime("%Y-%m-%d")


class _Cursor:
    def __init__(self, rows): self._rows = list(rows)
    def sort(self, *a, **k): return self
    async def to_list(self, n): return self._rows[:n]


def _match(d, q):
    for k, v in q.items():
        if k == "$and":
            if not all(_match(d, s) for s in v):
                return False
        elif k == "$or":
            if not any(_match(d, s) for s in v):
                return False
        elif isinstance(v, dict):
            if "$gte" in v and not (d.get(k) is not None and d.get(k) >= v["$gte"]):
                return False
            if "$in" in v and d.get(k) not in v["$in"]:
                return False
            if "$exists" in v and (k in d) != bool(v["$exists"]):
                return False
        elif d.get(k) != v:
            return False
    return True


class _Coll:
    def __init__(self, rows=None): self.rows: List[Dict[str, Any]] = list(rows or [])
    async def insert_one(self, doc): self.rows.append(dict(doc))
    async def find_one(self, q, proj=None):
        for d in self.rows:
            if _match(d, q):
                out = dict(d)
                if proj:
                    keep = {k for k, v in proj.items() if v == 1 and k != "_id"}
                    if keep:
                        out = {k: out.get(k) for k in keep}
                    else:
                        for k, v in proj.items():
                            if v == 0 and k != "_id":
                                out.pop(k, None)
                return out
        return None
    def find(self, q, proj=None):
        outs = []
        for d in self.rows:
            if _match(d, q):
                out = dict(d)
                if proj:
                    for k, v in proj.items():
                        if v == 0 and k != "_id":
                            out.pop(k, None)
                    keep = {k for k, v in proj.items() if v == 1 and k != "_id"}
                    if keep:
                        out = {k: dict(d).get(k) for k in keep}
                outs.append(out)
        return _Cursor(outs)
    async def count_documents(self, q):
        return sum(1 for d in self.rows if _match(d, q))
    async def update_one(self, q, u):
        for d in self.rows:
            if _match(d, q):
                d.update(u.get("$set", {})); return
    async def find_one_and_update(self, q, u, upsert=False, return_document=None, projection=None):
        def _proj(doc):
            if not projection:
                return doc
            out = dict(doc)
            for k, v in projection.items():
                if v == 0:
                    out.pop(k, None)
            return out
        for d in self.rows:
            if _match(d, q):
                before = dict(d); d.update(u.get("$set", {}))
                return _proj(dict(d) if return_document else before)
        if upsert:
            doc = dict(u.get("$setOnInsert", {})); doc.update(u.get("$set", {}))
            self.rows.append(doc)
            return _proj(dict(doc)) if return_document else None
        return None
    async def create_index(self, *a, **k): return None


class _DB:
    def __init__(self):
        self.partner_events = _Coll([{
            "event_id": "pe_live1", "partner_id": "ptr_A", "title": "Noche de salsa",
            "date": D1, "start_time": "21:00", "is_published": True,
            "moderation_status": "approved",
        }])
        self.partners = _Coll([{"partner_id": "ptr_A", "name": "Casa Prueba"}])
        self.amo_tickets = _Coll()
        self.amo_ticket_scans = _Coll()
        self.city_passes = _Coll()
        self.users = _Coll([{"user_id": "u1", "name": "Ana Viajera", "email": "a@x.co"}])


USER = {"user_id": "u1", "name": "Ana Viajera", "email": "a@x.co"}
BIZ_A = {"business_id": "bizA", "partner_id": "ptr_A", "role": "business"}
BIZ_B = {"business_id": "bizB", "partner_id": "ptr_B", "role": "business"}
GOV = {"business_id": "bizG", "partner_id": None, "role": "government"}


@pytest.fixture()
def ctx(monkeypatch):
    state = {"user": USER, "biz": BIZ_A}

    async def fake_user(request): return state["user"]
    async def fake_biz(request): return state["biz"]
    monkeypatch.setattr(T, "_user", fake_user)
    monkeypatch.setattr(T, "_business", fake_biz)
    T.init(_DB())
    T._indexed = True
    app = FastAPI()
    app.include_router(T.router, prefix="/api")
    return TestClient(app), state


def _rsvp(client) -> Dict[str, Any]:
    r = client.post("/api/tickets/event-rsvp", json={"event_id": "pe_live1"})
    assert r.status_code == 200, r.text
    return r.json()["ticket"]


def _wire(tid: str) -> str:
    sec = next(d["qr_secret"] for d in T.db.amo_tickets.rows if d["ticket_id"] == tid)
    return qc.build_wire(T.NS_TICKET, tid, sec)


def test_shared_engine_vector() -> None:
    assert qc.derive_token("tkt_demo1", "s3cret", 178080000) == "5d22f5379637"


def test_rsvp_once_then_already(ctx) -> None:
    client, _ = ctx
    t = _rsvp(client)
    assert t["ticket_id"].startswith("amt_") and t["status"] == "issued"
    assert t["title"] == "Noche de salsa" and t["venue_name"] == "Casa Prueba"
    r2 = client.post("/api/tickets/event-rsvp", json={"event_id": "pe_live1"}).json()
    assert r2["already"] is True and r2["ticket"]["ticket_id"] == t["ticket_id"]
    assert len(T.db.amo_tickets.rows) == 1
    assert "qr_secret" not in json.dumps(r2)


def test_rsvp_gates_unpublished_and_unknown(ctx) -> None:
    client, _ = ctx
    T.db.partner_events.rows.append({"event_id": "pe_held", "partner_id": "ptr_A",
                                     "title": "X", "date": D1, "is_published": False,
                                     "moderation_status": "pending"})
    assert client.post("/api/tickets/event-rsvp", json={"event_id": "pe_held"}).status_code == 404
    assert client.post("/api/tickets/event-rsvp", json={"event_id": "pe_nope"}).status_code == 404


def test_mine_one_and_qr_owner_only(ctx) -> None:
    client, state = ctx
    t = _rsvp(client)
    assert [x["ticket_id"] for x in client.get("/api/tickets/mine").json()["tickets"]] == [t["ticket_id"]]
    r = client.get(f"/api/tickets/{t['ticket_id']}/qr")
    assert r.headers["cache-control"] == "no-store"
    b = r.json()
    assert b["wire"].startswith("AMOTKT1.") and 0 < b["expires_in_ms"] <= 10000
    state["user"] = {"user_id": "u2", "name": "Otro"}
    assert client.get(f"/api/tickets/{t['ticket_id']}").status_code == 404
    assert client.get(f"/api/tickets/{t['ticket_id']}/qr").status_code == 404
    state["user"] = USER


def test_gate_verdicts_with_guest_panel(ctx) -> None:
    client, state = ctx
    t = _rsvp(client)
    r1 = client.post("/api/business/tickets/scan", json={"wire": _wire(t["ticket_id"]), "gate": "Puerta 1"}).json()
    assert r1["verdict"] == "VALIDO" and r1["guest"]["name"] == "Ana Viajera"
    r2 = client.post("/api/business/tickets/scan", json={"wire": _wire(t["ticket_id"]), "gate": "Puerta 2"}).json()
    assert r2["verdict"] == "DUPLICADO" and r2["first_gate"] == "Puerta 1" and r2["guest"]["name"] == "Ana Viajera"
    w = _wire(t["ticket_id"])
    tam = w[:-4] + ("0000" if not w.endswith("0000") else "1111")
    assert client.post("/api/business/tickets/scan", json={"wire": tam}).json()["verdict"] == "FALSIFICADO"
    sec = next(d["qr_secret"] for d in T.db.amo_tickets.rows)
    c = qc.counter_for_now() - (qc.TOKEN_SKEW_STEPS + 1)
    stale = f"AMOTKT1.{t['ticket_id']}.{c}.{qc.derive_token(t['ticket_id'], sec, c)}"
    assert client.post("/api/business/tickets/scan", json={"wire": stale}).json()["verdict"] == "EXPIRADO"
    # cross-venue wall (PALCO-V2 Stage A): simulate for a foreign ticket is a
    # plain 404 (no existence oracle), and a genuine foreign WIRE answers the
    # FUERA_DE_ALCANCE verdict — verified first, never flipped, no guest panel.
    state["biz"] = BIZ_B
    assert client.post("/api/business/tickets/scan", json={"ticket_id": t["ticket_id"], "simulate": True}).status_code == 404
    rf = client.post("/api/business/tickets/scan", json={"wire": _wire(t["ticket_id"])}).json()
    assert rf["verdict"] == "FUERA_DE_ALCANCE" and "guest" not in rf
    state["biz"] = GOV
    assert client.post("/api/business/tickets/scan", json={"ticket_id": t["ticket_id"], "simulate": True}).json()["verdict"] == "DUPLICADO"
    state["biz"] = BIZ_A


def test_simulated_attacks(ctx) -> None:
    client, _ = ctx
    t = _rsvp(client)
    tid = t["ticket_id"]
    assert client.post("/api/business/tickets/scan", json={"ticket_id": tid, "simulate": True, "tamper": True}).json()["verdict"] == "FALSIFICADO"
    assert client.post("/api/business/tickets/scan", json={"ticket_id": tid, "simulate": True, "stale": True}).json()["verdict"] == "EXPIRADO"
    ok = client.post("/api/business/tickets/scan", json={"ticket_id": tid, "simulate": True}).json()
    assert ok["verdict"] == "VALIDO"


def test_city_pass_qr_and_pase(ctx) -> None:
    client, _ = ctx
    exp = (NOW + timedelta(days=9)).strftime("%Y-%m-%dT%H:%M:%SZ")
    T.db.city_passes.rows.append({"pass_id": "cp_abc123", "user_id": "u1", "plan_id": "pass_classic",
                                  "is_active": True, "expires_at": exp})
    q = client.get("/api/city-pass/qr").json()
    assert q["wire"].startswith("AMOPASS1.cp_abc123.") and q["plan_id"] == "pass_classic"
    assert T.db.city_passes.rows[0].get("qr_secret")            # secret minted + stored
    pase1 = client.post("/api/business/tickets/scan", json={"wire": q["wire"]}).json()
    q2 = client.get("/api/city-pass/qr").json()
    pase2 = client.post("/api/business/tickets/scan", json={"wire": q2["wire"]}).json()
    assert pase1["verdict"] == "PASE" and pase2["verdict"] == "PASE"   # multi-scan by nature
    assert pase1["guest"]["name"] == "Ana Viajera" and pase1["guest"]["plan_id"] == "pass_classic"
    # expired pass → EXPIRADO even with a fresh wire
    T.db.city_passes.rows[0]["expires_at"] = "2020-01-01T00:00:00Z"
    q3 = client.get("/api/city-pass/qr").json()
    assert client.post("/api/business/tickets/scan", json={"wire": q3["wire"]}).json()["verdict"] == "EXPIRADO"


def test_events_guestlist_and_feed(ctx) -> None:
    client, state = ctx
    t = _rsvp(client)
    evs = client.get("/api/business/tickets/events").json()["events"]
    assert evs and evs[0]["event_id"] == "pe_live1" and evs[0]["rsvp_count"] == 1
    gl = client.get("/api/business/tickets/event/pe_live1").json()["tickets"]
    assert gl[0]["holder_name"] == "Ana Viajera" and "qr_secret" not in json.dumps(gl)
    state["biz"] = BIZ_B
    assert client.get("/api/business/tickets/event/pe_live1").status_code == 403
    state["biz"] = BIZ_A
    client.post("/api/business/tickets/scan", json={"ticket_id": t["ticket_id"], "simulate": True})
    feed = client.get("/api/business/tickets/scan-feed").json()["scans"]
    assert feed and feed[0]["verdict"] in ("VALIDO", "DUPLICADO")


def test_no_payment_language_anywhere() -> None:
    src = (BACKEND / "tickets.py").read_text(encoding="utf-8")
    code = src.split('"""', 2)[2].lower()   # past the module docstring, which states the rule
    for banned in ("wompi", "price", "checkout", "payment_link", "cobro"):
        assert banned not in code, banned
