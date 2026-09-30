"""CIVIC DEMO: PALCO1 derivation vectors, verdict matrix + atomic duplicate,
fare math from the real city modules, secret hygiene, Luna isolation
(docs/civic-demo/DESIGN.md §3/§5). Throwaway FastAPI + in-memory db; no network."""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import civic_demo as C  # noqa: E402


# ── in-memory db ──────────────────────────────────────────────────────────────

class _Cursor:
    def __init__(self, rows): self._rows = list(rows)
    def sort(self, *_a, **_k): return self
    async def to_list(self, n): return self._rows[:n]


class _Tickets:
    def __init__(self): self.rows: Dict[str, Dict[str, Any]] = {}
    async def insert_one(self, doc): self.rows[doc["ticket_id"]] = dict(doc)
    async def find_one(self, q, proj=None):
        d = self.rows.get(q.get("ticket_id"))
        return dict(d) if d else None
    async def count_documents(self, q):
        return sum(1 for d in self.rows.values()
                   if d.get("ip_hash") == q.get("ip_hash") and d.get("status") == q.get("status"))
    async def find_one_and_update(self, q, u):
        d = self.rows.get(q.get("ticket_id"))
        if not d or d.get("status") != q.get("status"):
            return None
        before = dict(d)
        d.update(u["$set"])          # single-threaded check-and-set = the atomic contract
        return before
    def find(self, q, proj=None):
        return _Cursor([{k: v for k, v in d.items() if k not in ("qr_secret", "ip_hash")}
                        for d in self.rows.values()])
    async def create_index(self, *a, **k): return None


class _Scans:
    def __init__(self): self.rows: List[Dict[str, Any]] = []
    async def insert_one(self, doc): self.rows.append(dict(doc))
    def find(self, q, proj=None):
        return _Cursor([{k: v for k, v in r.items() if k != "ip_hash"} for r in reversed(self.rows)])
    async def create_index(self, *a, **k): return None


class _DB:
    def __init__(self):
        self.civic_demo_tickets = _Tickets()
        self.civic_demo_scans = _Scans()


async def _fake_session(request) -> Dict[str, Any]:  # the alcaldía-demo session, stubbed
    return {"business_id": "biz_alcaldia_demo", "role": "alcaldia_demo", "email": "demo@test"}


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("CIVIC_DEMO_ENABLED", "1")
    monkeypatch.setattr(C, "_require_demo", _fake_session)
    C.init(_DB())
    C._indexed = True
    app = FastAPI()
    app.include_router(C.router, prefix="/api")
    return TestClient(app)


def test_gate_fails_closed(monkeypatch) -> None:
    """Flag off → every route is a plain 404 (not discoverable); flag on without a
    session → the alcaldía gate's own 401/403 (server import raises in this harness,
    which the route surfaces as an error — never an open door)."""
    monkeypatch.delenv("CIVIC_DEMO_ENABLED", raising=False)
    C.init(_DB())
    app = FastAPI()
    app.include_router(C.router, prefix="/api")
    off = TestClient(app, raise_server_exceptions=False)
    for path in ("/api/civic/demo/services", "/api/civic/demo/summary", "/api/civic/demo/tickets"):
        assert off.get(path).status_code == 404, path
    assert off.post("/api/civic/demo/tickets", json={"service": "muelle"}).status_code == 404
    assert off.post("/api/civic/demo/scan", json={"wire": "AMOCIV1.civ_0000000000.1.x" }).status_code == 404
    monkeypatch.setenv("CIVIC_DEMO_ENABLED", "1")
    gated = TestClient(app, raise_server_exceptions=False)
    r = gated.get("/api/civic/demo/services")
    assert r.status_code in (401, 403, 500)  # no session → never 200
    assert r.status_code != 200


def _issue(client, body) -> Dict[str, Any]:
    r = client.post("/api/civic/demo/tickets", json=body)
    assert r.status_code == 200, r.text
    return r.json()["ticket"]


def _wire_for(tid: str) -> str:
    return C.build_wire(tid, C.db.civic_demo_tickets.rows[tid]["qr_secret"])


# ── derivation: byte-identical to palco-core lib/qr.ts ───────────────────────

def test_palco1_cross_runtime_vector() -> None:
    assert C.derive_token("tkt_demo1", "s3cret", 178080000) == "5d22f5379637"


def test_wire_build_parse_roundtrip_and_rejects() -> None:
    w = C.build_wire("civ_ab12cd34ef", "secret", now_ms=1_780_800_000_000)
    p = C.parse_wire(w)
    assert p and p["ticket_id"] == "civ_ab12cd34ef" and p["counter"] == 178080000
    assert C.parse_wire("PALCO1.x.1.abc") is None            # wrong namespace
    assert C.parse_wire("AMOCIV1.x.NaN.abc") is None
    assert C.parse_wire("garbage") is None
    assert len(p["token"]) == C.TOKEN_LEN


# ── fares: quoted ONLY from the real city modules ────────────────────────────

def test_services_resolve_real_city_facts(client) -> None:
    body = client.get("/api/civic/demo/services").json()
    assert body["demo"] is True and body["disclaimer"]["es"].startswith("Demostración")
    by_key = {s["key"]: s for s in body["services"]}
    assert set(by_key) == {"muelle", "transcaribe", "monumentos", "coches", "taxis", "acuatico", "citypass"}
    muelle = by_key["muelle"]
    assert "tasa" not in muelle["title"]["es"].lower()        # the retired word stays dead
    cops = {f["key"]: f["value_cop"] for f in muelle["facts"]}
    assert cops["pier_fee_2026"] == 18000 and cops["pnn_entry_fee_2026"] == 13500
    merchants = {f["key"]: (f.get("merchant") or {}).get("es", "") for f in muelle["facts"]}
    assert "Corpoturismo" in merchants["pier_fee_2026"]        # each line names ITS collector
    assert "Parques" in merchants["pnn_entry_fee_2026"]
    ins = next(f for f in muelle["facts"] if f["key"] == "insurance_price")
    assert ins["confidence"] == "VERIFY" and ins["option"] == "insurance"
    tc = by_key["transcaribe"]
    assert tc["mode"] == "recharge" and tc["amounts"][0] == 10000   # official PSE minimum
    assert tc["min_fact"]["key"] == "recharge_pse"
    assert len(by_key["monumentos"]["tiers"]) == 3
    coches = by_key["coches"]
    assert len(coches["tiers"]) == 4 and all(t["confidence"] == "VERIFY" for t in coches["tiers"])
    assert by_key["taxis"]["mode"] == "info" and by_key["acuatico"]["mode"] == "soon"
    assert "Ed25519" in body["security"]["production"]


def test_issue_math_and_kinds(client) -> None:
    t = _issue(client, {"service": "muelle"})
    assert t["amount_cop"] == 31500 and t["demo"] is True and t["kind"] == "credential"
    assert {(ln["key"], (ln.get("merchant") or {}).get("es", "")[:8]) for ln in t["lines"]} == \
           {("pier_fee_2026", "Corpotur"), ("pnn_entry_fee_2026", "Parques ")}
    t2 = _issue(client, {"service": "muelle", "insurance": True})
    assert t2["amount_cop"] == 40300
    t3 = _issue(client, {"service": "transcaribe", "amount_cop": 20000})
    assert t3["amount_cop"] == 20000 and t3["kind"] == "receipt"
    r_low = client.post("/api/civic/demo/tickets", json={"service": "transcaribe", "amount_cop": 5000})
    assert r_low.status_code == 400 and "10.000" in r_low.json()["detail"]["message"]
    t4 = _issue(client, {"service": "monumentos", "tier": "castillo_tarifa_nacionales"})
    assert t4["amount_cop"] == 33000
    t5 = _issue(client, {"service": "coches", "tier": "fare_long_low"})
    assert t5["amount_cop"] == 300000 and t5["lines"][0]["confidence"] == "VERIFY"
    assert client.post("/api/civic/demo/tickets", json={"service": "taxis"}).status_code == 400
    assert client.post("/api/civic/demo/tickets", json={"service": "nope"}).status_code == 400


def test_issue_cap_per_ip_counts_credentials_only(client) -> None:
    _issue(client, {"service": "transcaribe", "amount_cop": 10000})  # receipts never clog the cap
    for _ in range(C.MAX_LIVE_PER_IP):
        _issue(client, {"service": "muelle"})
    r = client.post("/api/civic/demo/tickets", json={"service": "muelle"})
    assert r.status_code == 429
    r2 = client.post("/api/civic/demo/tickets", json={"service": "transcaribe", "amount_cop": 10000})
    assert r2.status_code == 429  # the cap still limits total issuance while full


# ── the verdict matrix (§3) ──────────────────────────────────────────────────

def test_verdicts_valido_duplicado_falsificado_expirado(client) -> None:
    t = _issue(client, {"service": "muelle"})
    tid = t["ticket_id"]
    wire = _wire_for(tid)
    r1 = client.post("/api/civic/demo/scan", json={"wire": wire, "gate": "Puesto 1"}).json()
    assert r1["verdict"] == "VALIDO" and r1["ticket"]["status"] == "used"
    r2 = client.post("/api/civic/demo/scan", json={"wire": _wire_for(tid), "gate": "Puesto 2"}).json()
    assert r2["verdict"] == "DUPLICADO" and r2["first_gate"] == "Puesto 1" and r2["first_used_at"]
    tampered = wire[:-4] + ("0000" if not wire.endswith("0000") else "1111")
    assert client.post("/api/civic/demo/scan", json={"wire": tampered}).json()["verdict"] == "FALSIFICADO"
    t2 = _issue(client, {"service": "coches", "tier": "fare_short_low"})
    sec = C.db.civic_demo_tickets.rows[t2["ticket_id"]]["qr_secret"]
    stale_c = C.counter_for_now() - (C.TOKEN_SKEW_STEPS + 1)
    stale = f"{C.WIRE_VERSION}.{t2['ticket_id']}.{stale_c}.{C.derive_token(t2['ticket_id'], sec, stale_c)}"
    assert client.post("/api/civic/demo/scan", json={"wire": stale}).json()["verdict"] == "EXPIRADO"
    ghost_c = C.counter_for_now()
    ghost = f"{C.WIRE_VERSION}.civ_0000000000.{ghost_c}.{C.derive_token('civ_0000000000', 'x', ghost_c)}"
    assert client.post("/api/civic/demo/scan", json={"wire": ghost}).json()["verdict"] == "FALSIFICADO"
    assert client.post("/api/civic/demo/scan", json={"wire": "garbage-wire"}).json()["verdict"] == "FALSIFICADO"
    assert len(C.db.civic_demo_scans.rows) == 6      # every attempt hits the ledger


def test_receipt_verifies_but_never_admits(client) -> None:
    """Transcaribe is a RECHARGE RECEIPT: authenticity only — validation belongs to
    the fare concession, so a receipt never flips to used and never DUPLICADOs."""
    t = _issue(client, {"service": "transcaribe", "amount_cop": 10000})
    r1 = client.post("/api/civic/demo/scan", json={"wire": _wire_for(t["ticket_id"])}).json()
    r2 = client.post("/api/civic/demo/scan", json={"wire": _wire_for(t["ticket_id"])}).json()
    assert r1["verdict"] == "RECIBO" and r2["verdict"] == "RECIBO"
    assert C.db.civic_demo_tickets.rows[t["ticket_id"]]["status"] == "issued"


def test_simulated_scan_powers_the_validator(client) -> None:
    """Site ships Permissions-Policy: camera=() — the validator 'scans' server-side
    and can stage the two attacks; verdicts run the SAME pipeline as a pasted wire."""
    t = _issue(client, {"service": "muelle"})
    tid = t["ticket_id"]
    ok = client.post("/api/civic/demo/scan", json={"ticket_id": tid, "simulate": True, "gate": "Puesto 1"}).json()
    assert ok["verdict"] == "VALIDO"
    dup = client.post("/api/civic/demo/scan", json={"ticket_id": tid, "simulate": True}).json()
    assert dup["verdict"] == "DUPLICADO" and dup["first_gate"] == "Puesto 1"
    t2 = _issue(client, {"service": "muelle"})
    assert client.post("/api/civic/demo/scan",
                       json={"ticket_id": t2["ticket_id"], "simulate": True, "tamper": True}).json()["verdict"] == "FALSIFICADO"
    assert client.post("/api/civic/demo/scan",
                       json={"ticket_id": t2["ticket_id"], "simulate": True, "stale": True}).json()["verdict"] == "EXPIRADO"
    assert client.post("/api/civic/demo/scan",
                       json={"ticket_id": "civ_ffffffffff", "simulate": True}).status_code == 404
    live = client.get("/api/civic/demo/tickets").json()
    assert any(x["ticket_id"] == t2["ticket_id"] for x in live["tickets"])
    assert all("qr_secret" not in x for x in live["tickets"])


def test_duplicate_is_atomic_under_concurrency(client) -> None:
    """The one-winner contract lives in the single find_one_and_update check-and-set
    (Mongo guarantees it server-side; the fake honors the same contract)."""
    t = _issue(client, {"service": "muelle"})

    async def flip():
        return await C.db.civic_demo_tickets.find_one_and_update(
            {"ticket_id": t["ticket_id"], "status": "issued"},
            {"$set": {"status": "used", "used_at": "now", "used_gate": "g"}})

    async def race():
        return await asyncio.gather(flip(), flip())

    r1, r2 = asyncio.run(race())
    assert (r1 is None) != (r2 is None)              # exactly one winner


# ── hygiene ──────────────────────────────────────────────────────────────────

def test_secret_never_leaves_the_server(client) -> None:
    t = _issue(client, {"service": "muelle"})
    tid = t["ticket_id"]
    secret = C.db.civic_demo_tickets.rows[tid]["qr_secret"]
    for path in (f"/api/civic/demo/tickets/{tid}", f"/api/civic/demo/tickets/{tid}/qr",
                 "/api/civic/demo/summary", "/api/civic/demo/services"):
        assert secret not in client.get(path).text, path
    scan = client.post("/api/civic/demo/scan", json={"wire": _wire_for(tid)})
    assert secret not in scan.text
    assert "qr_secret" not in json.dumps(t)


def test_qr_endpoint_rotates_and_never_caches(client) -> None:
    t = _issue(client, {"service": "transcaribe", "amount_cop": 10000})
    r = client.get(f"/api/civic/demo/tickets/{t['ticket_id']}/qr")
    assert r.headers["cache-control"] == "no-store"
    b = r.json()
    assert b["wire"].startswith("AMOCIV1.") and b["step_ms"] == 10000
    assert 0 < b["expires_in_ms"] <= 10000
    assert b["kind"] == "receipt" and "matrix" not in b    # client renders the wire itself
    assert client.get("/api/civic/demo/tickets/civ_zzzzzzzzzz/qr").status_code == 404
    assert client.get("/api/civic/demo/tickets/not-an-id/qr").status_code == 404


def test_summary_aggregates_per_line_merchant(client) -> None:
    _issue(client, {"service": "muelle"})                       # 18000 Corpoturismo + 13500 PNN
    _issue(client, {"service": "transcaribe", "amount_cop": 20000})
    s = client.get("/api/civic/demo/summary").json()
    assert s["issued_n"] == 2 and s["collected_cop"] == 31500 + 20000
    ents = {e["entity_es"]: e["cop"] for e in s["by_entity"]}
    assert ents[C.M_CORPO["es"]] == 18000                       # split per collector,
    assert ents[C.M_PNN["es"]] == 13500                         # never one merged pot
    assert ents[C.M_TRANSCARIBE["es"]] == 20000


# ── isolation (§0): the demo never reaches Luna, the retired product stays dead ──

def test_luna_never_references_the_civic_demo() -> None:
    # "civic" alone is a legit EVENT CATEGORY in luna_events — the module name and
    # the route namespace are the precise leak signals.
    for name in ("ai_agent.py", "luna_events.py", "luna_cmw.py"):
        src = (BACKEND / name).read_text(encoding="utf-8")
        assert "civic_demo" not in src, name
        assert "/gobierno" not in src, name
    import lenses as L
    assert L.luna_context("quiero pagar la tasa del muelle en la demo del gobierno") is None


def test_port_tax_product_stays_retired() -> None:
    src = (BACKEND / "server.py").read_text(encoding="utf-8")
    assert src.count('"retired"') >= 1                       # the 410 layer is still present
    civic_src = (BACKEND / "civic_demo.py").read_text(encoding="utf-8")
    civic_code = civic_src.split('"""', 2)[2]                # past the module docstring,
    assert "port-tax" not in civic_code and "port_tax" not in civic_code  # which states the rule
