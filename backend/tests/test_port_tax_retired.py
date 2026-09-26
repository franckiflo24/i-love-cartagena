"""Port-tax product retired (2026-09-26) — route + Luna guards. Pure unit tests: no network, no Mongo.

There is no single "tasa portuaria": the pier fee, the PNN entry and the insurance are paid at the
Muelle La Bodeguita taquillas and AMO sells none of them. Every sale/config route must answer
410 {"error": "retired"}, the historical ticket reads must stay read-only, and Luna must never
emit open_port_tax_checkout again (open_city_module → /ciudad replaces it).

Route harness: the /port-tax and /payments/wompi/port-tax route sources are sliced out of
server.py and exec'd into a throwaway FastAPI app with stubbed db/auth, so the real handlers run
without importing server.py (which opens Mongo at import).

Run from the repo root (pytest is not required):  python3 backend/tests/test_port_tax_retired.py
"""
import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(BACKEND)
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

import ai_agent as A  # noqa: E402
import ai_search as S  # noqa: E402

SERVER_PATH = os.path.join(BACKEND, "server.py")
with open(SERVER_PATH, encoding="utf-8") as _f:
    SERVER_SRC = _f.read()

RETIRED_ROUTES = [
    ("GET", "/api/port-tax/config", None),
    ("PUT", "/api/admin/port-tax/config", {"price_per_person": 31500}),
    ("POST", "/api/port-tax/checkout", {"qty": 2, "travel_date": "2026-10-01"}),
    ("POST", "/api/port-tax/tickets/pt_deadbeef/redeem", {}),
    ("POST", "/api/payments/wompi/port-tax", {"qty": 2, "travel_date": "2026-10-01"}),
]

ROUTE_ANCHORS = [
    "PORT_TAX_RETIRED_DETAIL = {",
    "def _port_tax_retired()",
    '@api_router.get("/port-tax/config")',
    '@api_router.put("/admin/port-tax/config")',
    '@api_router.post("/port-tax/checkout")',
    '@api_router.get("/port-tax/my-tickets")',
    '@api_router.get("/port-tax/tickets/{ticket_id}")',
    '@api_router.post("/port-tax/tickets/{ticket_id}/redeem")',
    '@api_router.post("/payments/wompi/port-tax")',
]


def _block(anchor: str) -> str:
    """Top-level source block starting at `anchor`, ending at the next two-blank-line gap."""
    i = SERVER_SRC.index(anchor)
    j = SERVER_SRC.find("\n\n\n", i)
    return SERVER_SRC[i:j if j != -1 else None]


# ── stubs ────────────────────────────────────────────────────────────────────
class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    def sort(self, *_a, **_k):
        return self

    async def to_list(self, length=None):
        return [dict(r) for r in self._rows][: length or None]


class _Coll:
    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.writes = 0

    def find(self, query=None, *_a, **_k):
        q = query or {}
        return _Cursor([r for r in self.rows if all(r.get(k) == v for k, v in q.items())])

    async def find_one(self, query=None, *_a, **_k):
        q = query or {}
        for r in self.rows:
            if all(r.get(k) == v for k, v in q.items()):
                return dict(r)
        return None

    async def insert_one(self, *_a, **_k):
        self.writes += 1

    async def update_one(self, *_a, **_k):
        self.writes += 1

    async def update_many(self, *_a, **_k):
        self.writes += 1


class _DB:
    def __init__(self, tickets=None):
        self.port_tax_tickets = _Coll(tickets)
        self.port_tax_config = _Coll()
        self.payments = _Coll()

    def writes(self) -> int:
        return self.port_tax_tickets.writes + self.port_tax_config.writes + self.payments.writes


def _harness(tickets=None):
    db = _DB(tickets)

    async def get_current_user(request: Request):
        return {"user_id": "u_test", "email": "t@example.com", "name": "T", "is_admin": True}

    async def _check_rate_limit(*_a, **_k):
        return None

    ns = {
        "api_router": APIRouter(),
        "HTTPException": HTTPException,
        "Request": Request,
        "db": db,
        "get_current_user": get_current_user,
        "_check_rate_limit": _check_rate_limit,
        "os": os, "uuid": uuid, "datetime": datetime, "timezone": timezone,
    }
    src = "\n\n".join(_block(a) for a in ROUTE_ANCHORS)
    exec(compile(src, "server.py[port-tax]", "exec"), ns)
    app = FastAPI()
    app.include_router(ns["api_router"], prefix="/api")
    return TestClient(app), db


# ── routes ───────────────────────────────────────────────────────────────────
def test_every_sale_and_config_route_is_410_retired():
    client, db = _harness()
    for method, path, body in RETIRED_ROUTES:
        res = client.request(method, path, json=body)
        assert res.status_code == 410, (method, path, res.status_code, res.text)
        detail = res.json()["detail"]
        assert detail["error"] == "retired", (path, detail)
        assert detail["see"] == "/api/city/modules/muelle-bodeguita", (path, detail)
        assert "muelle-bodeguita" in detail["message"], (path, detail)
    assert db.writes() == 0, "a retired route wrote to the database"


def test_my_tickets_is_200_empty_list_with_empty_collection():
    client, db = _harness()
    res = client.get("/api/port-tax/my-tickets")
    assert res.status_code == 200, res.text
    assert res.json() == []
    assert db.writes() == 0


def test_my_tickets_returns_history_without_mutating_it():
    stale = {"ticket_id": "pt_old", "user_id": "u_test", "status": "paid", "travel_date": "2024-01-01",
             "qty": 2, "total_amount": 63000, "created_at": "2024-01-01T00:00:00+00:00"}
    other = {**stale, "ticket_id": "pt_other", "user_id": "u_someone_else"}
    client, db = _harness([stale, other])
    res = client.get("/api/port-tax/my-tickets")
    assert res.status_code == 200, res.text
    rows = res.json()
    assert [r["ticket_id"] for r in rows] == ["pt_old"]
    assert rows[0]["status"] == "paid", "read-only: the old auto-expire write must be gone"
    assert db.writes() == 0
    # detail: own ticket 200, foreign / unknown ticket 404
    assert client.get("/api/port-tax/tickets/pt_old").status_code == 200
    assert client.get("/api/port-tax/tickets/pt_other").status_code == 404
    assert client.get("/api/port-tax/tickets/pt_nope").status_code == 404
    assert db.writes() == 0


def test_no_price_is_ever_seeded_again():
    assert "DEFAULT_PORT_TAX_PRICE" not in SERVER_SRC
    assert "_get_active_port_tax_config" not in SERVER_SRC
    assert "db.port_tax_config" not in SERVER_SRC
    assert re.search(r"31[.,]?500", SERVER_SRC) is None
    # the retired detail is the single source of the 410 body
    assert SERVER_SRC.count('"error": "retired"') == 1


def _server_plans():
    ns = {}
    exec(compile(_block("CITY_PASS_PLANS = {"), "server.py[city-pass]", "exec"), ns)
    return ns["CITY_PASS_PLANS"]


def _static_plans():
    path = os.path.join(REPO, "frontend", "public", "data", "city-pass", "plans.json")
    return json.load(open(path, encoding="utf-8"))


def _auto_tr_keys():
    """Spanish keys of the frontend AUTO_TR dictionary (tr() returns the key itself on a miss)."""
    src = open(os.path.join(REPO, "frontend", "src", "i18n", "autoTr.ts"), encoding="utf-8").read()
    pairs = re.findall(r"^\s*(?:'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\")\s*:\s*\{", src, re.M)
    return {(a or b).replace("\\'", "'") for a, b in pairs}


def test_city_pass_perks_promise_no_transport_and_keep_ids_prices():
    plans = _server_plans()
    assert set(plans) == {"pass_basic", "pass_classic", "pass_premium", "pass_ultimate"}
    assert [plans[k]["price"] for k in ("pass_basic", "pass_classic", "pass_premium", "pass_ultimate")] == [99000, 200000, 350000, 599000]
    for pid, plan in plans.items():
        for perk in plan["perks"]:
            assert "acuático" not in perk.lower(), (pid, perk)
            assert "tasa" not in perk.lower(), (pid, perk)
            # AMO operates no boats, cars or private transfers: no tier may promise transport.
            assert "transporte" not in perk.lower(), (pid, perk)
            assert "muelle" not in perk.lower(), (pid, perk)


def test_static_plans_mirror_server_plans():
    """GET /city-pass/plans serves CITY_PASS_PLANS when the backend is up and plans.json on
    fallback — the same tier must show the same perks either way."""
    server = _server_plans()
    static = _static_plans()
    assert [p["plan_id"] for p in static] == list(server), "tier order / ids differ"
    for row in static:
        plan = server[row["plan_id"]]
        assert row["name"] == plan["name"], row["plan_id"]
        assert row["price"] == plan["price"], row["plan_id"]
        assert row["currency"] == "COP", row["plan_id"]
        assert row["duration_days"] == plan["duration_days"], row["plan_id"]
        assert row["color"] == plan["color"], row["plan_id"]
        assert row["benefits"] == plan["perks"], (row["plan_id"], row["benefits"], plan["perks"])


def test_auto_tr_covers_every_city_pass_perk_and_city_intent():
    """citypass.tsx wraps every benefit in tr(b); a missing key leaks Spanish under EN/FR/PT chrome."""
    keys = _auto_tr_keys()
    missing = sorted({perk for plan in _server_plans().values() for perk in plan["perks"]} - keys)
    assert not missing, f"AUTO_TR entries missing for City Pass perks: {missing}"
    # search.tsx INTENT_META label for the new 'city' intent goes through tr() too
    assert "Ciudad" in keys


def test_transport_flows_never_invent_a_port_tax():
    """The transport purchase paths used to add a fictional COP 25.000 'impuesto portuario' per
    passenger and stamp port_tax_paid into a QR the taquillas never honoured."""
    assert "PORT_TAX_PER_PERSON" not in SERVER_SRC
    assert "port_tax_included" not in SERVER_SRC
    assert "port_tax_amount" not in SERVER_SRC
    assert "impuesto portuario" not in SERVER_SRC.lower()
    # the only remaining "port_tax_paid" is the government dashboard's read-only history KPI
    assert SERVER_SRC.count('"port_tax_paid"') == 1
    for anchor in ('@api_router.post("/transport/{transport_id}/buy")', '@api_router.post("/payments/wompi/transport")'):
        block = _block(anchor)
        assert "port_tax" not in block, anchor
    transport_branch = SERVER_SRC[SERVER_SRC.index('elif kind == "transport":'):]
    transport_branch = transport_branch[:transport_branch.index("# ── Award loyalty points")]
    assert "port_tax" not in transport_branch


def test_dump_and_migrate_never_recreate_port_tax_files():
    """dump_static.py is the documented post-Atlas sync: it must never write
    frontend/public/data/port-tax/* again (that static file resurrects the retired card on
    iOS build 14), and migrate_to_atlas.py must never re-seed db.port_tax_config."""
    dump = open(os.path.join(BACKEND, "scripts", "dump_static.py"), encoding="utf-8").read()
    assert 'write("port-tax/' not in dump
    assert '"port-tax/my-tickets"' not in dump
    assert "db.port_tax_config" not in dump
    assert 'assert not (OUT / "port-tax").exists()' in dump
    migrate = open(os.path.join(BACKEND, "scripts", "migrate_to_atlas.py"), encoding="utf-8").read()
    catalog = migrate[migrate.index("CATALOG_COLLECTIONS = {"):migrate.index("}", migrate.index("CATALOG_COLLECTIONS = {"))]
    assert "port_tax_config" not in catalog
    skip = migrate[migrate.index("SKIP = {"):migrate.index("}", migrate.index("SKIP = {"))]
    assert "port_tax_config" in skip
    assert not os.path.exists(os.path.join(REPO, "frontend", "public", "data", "port-tax"))


def test_fulfillment_never_mints_a_port_tax_ticket():
    body = SERVER_SRC[SERVER_SRC.index("async def _fulfill_payment("):]
    branch = body[body.index('elif kind == "port_tax":'):]
    branch = branch[:branch.index("elif kind ==", 1)]  # up to the next kind branch
    assert branch.strip(), "port_tax branch not found in _fulfill_payment"
    assert "port_tax_tickets.insert_one" not in branch
    assert "_get_active_port_tax_config" not in branch
    assert "fulfillment.retired" in branch
    assert "return" in branch, "retired branch must skip the loyalty-points award"


# ── Luna ─────────────────────────────────────────────────────────────────────
def test_allowed_actions_swap_checkout_for_city_module():
    assert "open_port_tax_checkout" not in A.ALLOWED_ACTIONS
    assert "open_city_module" in A.ALLOWED_ACTIONS
    assert "ciudad" in A.ALLOWED_TABS


def test_city_module_ids_mirror_the_hub_data_file():
    data = json.load(open(os.path.join(BACKEND, "data", "city_modules.json"), encoding="utf-8"))
    assert A.CITY_MODULE_IDS == {m["id"] for m in data["modules"]}
    assert A.CITY_MODULE_IDS == {"transcaribe", "muelle-bodeguita", "monumentos", "coches-electricos",
                                 "transcaribe-acuatico", "taxis"}


def test_sanitizer_drops_bad_module_id_and_legacy_checkout():
    out = A._sanitize_actions([
        {"type": "open_city_module", "module_id": "disneyland", "label": "nope"},
        {"type": "open_city_module", "label": "no id"},
        {"type": "open_city_module", "module_id": ["muelle-bodeguita"], "label": "wrong type"},
        {"type": "open_port_tax_checkout", "qty": 2, "travel_date": "2026-10-01"},
        {"type": "navigate", "screen": "ciudad", "label": "Ver ciudad"},
        {"type": "open_city_module", "module_id": "muelle-bodeguita", "label": "Ver costo real de las islas"},
    ])
    assert out == [
        {"type": "navigate", "screen": "ciudad", "label": "Ver ciudad"},
        {"type": "open_city_module", "module_id": "muelle-bodeguita", "label": "Ver costo real de las islas"},
    ]


def test_prompt_and_context_have_no_port_tax_leftovers():
    src = open(os.path.join(BACKEND, "ai_agent.py"), encoding="utf-8").read()
    assert "open_port_tax_checkout" not in A.SYSTEM_PROMPT
    assert "port_tax_cop" not in src
    assert "_port_tax_price" not in src
    assert re.search(r"31[.,]500", src) is None
    assert "Pegasos" not in A.SYSTEM_PROMPT
    assert "open_city_module" in A.SYSTEM_PROMPT
    assert '"ciudad"' in A.SYSTEM_PROMPT
    # the islands few-shot declines + redirects with the hub action, never a checkout
    fr = A.SYSTEM_PROMPT[A.SYSTEM_PROMPT.index('FR: User:'):A.SYSTEM_PROMPT.index('PT: User:')]
    assert '"type":"open_city_module","module_id":"muelle-bodeguita"' in fr
    assert "AMO ne vend" in fr


def test_ai_search_retires_port_tax_type_with_legacy_mapping():
    assert "port_tax" not in S.KNOWN_TYPES
    assert "city" in S.KNOWN_TYPES
    assert S._normalize_intent("port_tax") == "city"
    assert S._normalize_intent("PORT_TAX") == "city"
    assert S._normalize_intent("city") == "city"
    assert S._normalize_intent("bogus") == "general"
    assert S._normalize_intent(None) == "general"


def test_trust_knowledge_notes_use_tu_not_vos():
    data = json.load(open(os.path.join(BACKEND, "data", "trust_knowledge.json"), encoding="utf-8"))
    vos = re.compile(r"\b(marcá|acordá|confirmá|pedí|tenés|podés|sabés|llamá|preguntá|revisá|usá|andá|"
                     r"averiguá|buscá|mirá|tomá|pagá|mostrá|llevá|reservá|verificá|evitá|chequeá|guardá|"
                     r"exigí|decí|salí|vení|hacé|tené|querés|necesitás|vos)\b", re.I)
    blob = json.dumps(data, ensure_ascii=False)
    assert vos.search(blob) is None, vos.search(blob).group(0)


if __name__ == "__main__":
    import traceback

    failed = 0
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    for name, fn in tests:
        try:
            fn()
            print(f"PASS {name}")
        except Exception:
            failed += 1
            print(f"FAIL {name}")
            traceback.print_exc()
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
