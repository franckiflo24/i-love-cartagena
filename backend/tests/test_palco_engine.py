"""PALCO v2 engine: wire, verdict pipeline, catalog, revocation, manifest.
Covers the server-side rows of docs/palco-v2/DESIGN.md §8 (A1/A2/A5/A7/A8/A13,
A10 server half) with software P-256 keys; device cases run on hardware later.
In-memory db; server.py never imported."""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from palco import catalog, crypto, issue, manifest, verify, wire  # noqa: E402
from palco.models import (MODE_CONSUME, MODE_VERIFY, V_DUPLICADO, V_EXPIRADO,  # noqa: E402
                          V_FALSIFICADO, V_FUERA, V_PASE, V_RECIBO, V_REVOCADO,
                          V_TRANSFERIDO, V_VALIDO, iso)

NOW = datetime.now(timezone.utc)
D_PAST = (NOW - timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
D_FUT = (NOW + timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
EV_DATE = (NOW + timedelta(days=1)).strftime("%Y-%m-%d")


def _get_path(d: Dict[str, Any], key: str):
    cur: Any = d
    for part in key.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def _deep(d: Dict[str, Any]) -> Dict[str, Any]:
    """Deep copy — a shallow dict() shares nested entitlement objects, so a
    $inc would mutate the 'before' snapshot a real driver keeps intact."""
    import copy
    return copy.deepcopy(d)


def _match(d: Dict[str, Any], q: Dict[str, Any]) -> bool:
    for k, v in q.items():
        have = _get_path(d, k)
        if isinstance(v, dict):
            if "$lt" in v and not (have is not None and have < v["$lt"]):
                return False
            if "$gt" in v and not (have is not None and have > v["$gt"]):
                return False
            if "$in" in v and have not in v["$in"]:
                return False
            if "$nin" in v and have in v["$nin"]:
                return False
            if "$exists" in v and (have is not None) != bool(v["$exists"]):
                return False
        elif have != v:
            return False
    return True


def _apply(d: Dict[str, Any], u: Dict[str, Any]) -> None:
    for k, v in u.get("$set", {}).items():
        parts = k.split("."); cur = d
        for p in parts[:-1]:
            cur = cur.setdefault(p, {})
        cur[parts[-1]] = v
    for k, inc in u.get("$inc", {}).items():
        parts = k.split("."); cur = d
        for p in parts[:-1]:
            cur = cur.setdefault(p, {})
        cur[parts[-1]] = int(cur.get(parts[-1]) or 0) + inc


class _Cursor:
    def __init__(self, rows): self._rows = list(rows)
    def sort(self, *a, **k): return self
    async def to_list(self, n): return self._rows[:n]


class _Coll:
    def __init__(self): self.rows: List[Dict[str, Any]] = []
    async def insert_one(self, doc): self.rows.append(_deep(doc))
    async def find_one(self, q, proj=None):
        for d in self.rows:
            if _match(d, q):
                return _deep(d)
        return None
    def find(self, q, proj=None):
        return _Cursor([dict(d) for d in self.rows if _match(d, q)])
    async def update_one(self, q, u):
        for d in self.rows:
            if _match(d, q):
                _apply(d, u); return
    async def find_one_and_update(self, q, u, upsert=False, return_document=None, projection=None):
        for d in self.rows:
            if _match(d, q):
                before = _deep(d); _apply(d, u)
                return _deep(d) if return_document else before
        if upsert:
            doc = _deep(u.get("$setOnInsert", {})); _apply(doc, u)
            self.rows.append(doc)
            return _deep(doc) if return_document else None
        return None
    async def delete_one(self, q):
        for i, d in enumerate(self.rows):
            if _match(d, q):
                self.rows.pop(i); return
    async def create_index(self, *a, **k): return None


class _DB:
    def __init__(self):
        for name in ("credentials", "credential_devices", "credential_ledger",
                     "palco_scan_log", "amo_tickets", "city_passes",
                     "civic_demo_tickets", "maintenance_backups"):
            setattr(self, name, _Coll())
        self.partner_events = _Coll()
        self.partner_events.rows.append({
            "event_id": "pe_v2", "partner_id": "ptr_A", "title": "Prueba",
            "date": EV_DATE, "start_time": "20:00", "is_published": True,
            "moderation_status": "approved"})


SCOPE_A = {"gov": False, "partner_id": "ptr_A", "scanner_id": "bizA", "gate": "G1"}
SCOPE_B = {"gov": False, "partner_id": "ptr_B", "scanner_id": "bizB", "gate": "G2"}
GOV = {"gov": True, "partner_id": None, "scanner_id": "bizG", "gate": "GG"}


def _run(coro):
    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(coro)


async def _setup(db: _DB, product="evt_rsvp_general", scope=None, **kw):
    priv, jwk = crypto.generate_p256_keypair()
    reg = await issue.register_device(db, "u1", jwk, "test", "software")
    cred = await issue.issue_credential(
        db, product, {"user_id": "u1", "display_name": "Ana Viajera"},
        device_key_id=reg["device_key_id"],
        scope=scope if scope is not None else {"event_id": "pe_v2"},
        valid_from=kw.pop("valid_from", D_PAST), valid_to=kw.pop("valid_to", D_FUT),
        test=True, **kw)
    return priv, reg["device_key_id"], cred


def _wire_for(priv, cred, key_id, counter=None):
    c = counter if counter is not None else wire.counter_for_now()
    payload = wire.signing_payload(cred["namespace"], cred["cred_id"], c, key_id)
    return wire.build_wire(cred["cred_id"], c, key_id, crypto.sign_p256_raw(priv, payload))


# ── wire + catalog shape ──────────────────────────────────────────────────────

def test_wire_v2_roundtrip_and_strictness() -> None:
    db = _DB()
    priv, kid, cred = _run(_setup(db))
    w = _wire_for(priv, cred, kid)
    assert len(w) <= 200
    p = wire.parse_wire_v2(w)
    assert p and p["cred_id"] == cred["cred_id"] and p["key_id"] == kid
    base = w.split(".")
    assert wire.parse_wire_v2(".".join([base[0], base[1], "+" + base[2], base[3], base[4]])) is None
    assert wire.parse_wire_v2(".".join([base[0], base[1], "0" + base[2], base[3], base[4]])) is None
    assert wire.parse_wire_v2("AMO2.crd_zz.1.2.3") is None
    assert wire.parse_wire_v1(w) is None  # v2 wires never fall into the v1 adapter


def test_catalog_honest_public_view() -> None:
    rows = catalog.public_view()
    by_id = {r["product_id"]: r for r in rows}
    assert by_id["evt_rsvp_general"]["status"] == "live" and "price_cop" in by_id["evt_rsvp_general"]
    waiting = [r for r in rows if r["status"] == "waiting_agreement"]
    assert waiting and all("price_cop" not in r and r["note"]["es"].startswith("Próximamente") for r in waiting)


# ── pipeline rows of the §8 matrix (server side) ──────────────────────────────

def test_a1_stale_counter_expirado() -> None:
    db = _DB()
    priv, kid, cred = _run(_setup(db))
    old = wire.counter_for_now() - (wire.SKEW_STEPS + 2)
    r = _run(verify.verify_scan(db, _wire_for(priv, cred, kid, counter=old), SCOPE_A))
    assert r["verdict"] == V_EXPIRADO and r["reason"] == "codigo_vencido"


def test_a2_same_counter_second_scan_duplicado() -> None:
    db = _DB()
    priv, kid, cred = _run(_setup(db, product="palco_sandbox", scope={}))
    w = _wire_for(priv, cred, kid)
    async def both():
        r1 = await verify.verify_scan(db, w, GOV)
        r2 = await verify.verify_scan(db, w, GOV)
        return r1, r2
    r1, r2 = _run(both())
    assert r1["verdict"] == V_VALIDO
    assert r2["verdict"] == V_DUPLICADO and r2["reason"] in ("repetido", "ya_usada")


def test_a5_bad_signature_and_namespace_binding() -> None:
    db = _DB()
    priv, kid, cred = _run(_setup(db))
    w = _wire_for(priv, cred, kid)
    parts = w.split(".")
    sig = parts[4]
    flipped = ("A" if sig[0] != "A" else "B") + sig[1:]
    r = _run(verify.verify_scan(db, ".".join(parts[:4] + [flipped]), SCOPE_A))
    assert r["verdict"] == V_FALSIFICADO
    # same key signing for a DIFFERENT namespace must not verify for this one
    c = wire.counter_for_now()
    other = crypto.sign_p256_raw(priv, wire.signing_payload("AMORIDE", cred["cred_id"], c, kid))
    r2 = _run(verify.verify_scan(db, wire.build_wire(cred["cred_id"], c, kid, other), SCOPE_A))
    assert r2["verdict"] == V_FALSIFICADO and r2["reason"] == "firma_invalida"


def test_unknown_credential_and_foreign_key_falsificado() -> None:
    db = _DB()
    priv, kid, cred = _run(_setup(db))
    c = wire.counter_for_now()
    ghost = "crd_aaaaaaaaaaaa"
    sig = crypto.sign_p256_raw(priv, wire.signing_payload("AMOEVT", ghost, c, kid))
    r = _run(verify.verify_scan(db, wire.build_wire(ghost, c, kid, sig), SCOPE_A))
    assert r["verdict"] == V_FALSIFICADO and r["reason"] == "llave_desconocida"
    # a second registered key cannot speak for the first credential
    priv2, jwk2 = crypto.generate_p256_keypair()
    reg2 = _run(issue.register_device(db, "u2", jwk2, "test", "software"))
    sig2 = crypto.sign_p256_raw(priv2, wire.signing_payload(cred["namespace"], cred["cred_id"], c, reg2["device_key_id"]))
    r2 = _run(verify.verify_scan(db, wire.build_wire(cred["cred_id"], c, reg2["device_key_id"], sig2), SCOPE_A))
    assert r2["verdict"] == V_FALSIFICADO


def test_a7_backing_event_gone_or_dead_fails_closed() -> None:
    db = _DB()
    priv, kid, cred = _run(_setup(db))
    db.partner_events.rows[0]["is_published"] = False
    r = _run(verify.verify_scan(db, _wire_for(priv, cred, kid), SCOPE_A))
    assert r["verdict"] == V_EXPIRADO and r["reason"] in ("evento_no_activo", "estado_inaccesible")
    db.partner_events.rows.clear()
    db.credentials.rows[0]["last_counter"] = -1  # replay precedes state checks (§4)
    r2 = _run(verify.verify_scan(db, _wire_for(priv, cred, kid), GOV))
    assert r2["verdict"] == V_EXPIRADO and r2["reason"] == "estado_inaccesible"


def test_a7_validity_window() -> None:
    db = _DB()
    priv, kid, cred = _run(_setup(db, product="palco_sandbox", scope={},
                                  valid_from=(NOW - timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                  valid_to=D_PAST))
    r = _run(verify.verify_scan(db, _wire_for(priv, cred, kid), GOV))
    assert r["verdict"] == V_EXPIRADO and r["reason"] == "fuera_de_ventana"


def test_a8_verify_mode_consumes_nothing() -> None:
    db = _DB()
    priv, kid, cred = _run(_setup(db))
    r = _run(verify.verify_scan(db, _wire_for(priv, cred, kid), SCOPE_A, mode=MODE_VERIFY))
    assert r["verdict"] == V_VALIDO
    row = db.credentials.rows[0]
    assert row["status"] == "issued" and row["last_counter"] == -1
    r2 = _run(verify.verify_scan(db, _wire_for(priv, cred, kid), SCOPE_A, mode=MODE_CONSUME))
    assert r2["verdict"] == V_VALIDO and db.credentials.rows[0]["status"] == "used"


def test_a4b_out_of_scope_enrichment_suppressed() -> None:
    """Closure-audit lock: pre-scope early exits (ya_usada) carry NO holder
    detail for an out-of-scope scanner; in-scope keeps the full panel."""
    db = _DB()
    priv, kid, cred = _run(_setup(db))
    db.credentials.rows[0]["status"] = "used"
    db.credentials.rows[0]["used_at"] = iso()
    db.credentials.rows[0]["used_gate"] = "G1"
    r = _run(verify.verify_scan(db, _wire_for(priv, cred, kid), SCOPE_B))
    assert r["verdict"] == V_DUPLICADO
    assert "guest" not in r and "first_used_at" not in r and "first_gate" not in r
    db.credentials.rows[0]["last_counter"] = -1
    r2 = _run(verify.verify_scan(db, _wire_for(priv, cred, kid), SCOPE_A))
    assert r2["verdict"] == V_DUPLICADO and r2["guest"]["name"] == "Ana"
    assert r2["first_gate"] == "G1"


def test_a13_out_of_scope_verdict() -> None:
    db = _DB()
    priv, kid, cred = _run(_setup(db))
    r = _run(verify.verify_scan(db, _wire_for(priv, cred, kid), SCOPE_B))
    assert r["verdict"] == V_FUERA and "guest" not in r
    assert db.credentials.rows[0]["status"] == "issued"  # never flipped out of scope


def test_revoked_refunded_transferred_statuses() -> None:
    db = _DB()
    priv, kid, cred = _run(_setup(db))
    _run(issue.revoke_credential(db, cred["cred_id"], "ops"))
    assert _run(verify.verify_scan(db, _wire_for(priv, cred, kid), SCOPE_A))["verdict"] == V_REVOCADO
    # replay precedes status by contract (§4) — reset the counter between
    # same-window rescans so each case exercises its own branch
    db.credentials.rows[0]["status"] = "refunded"
    db.credentials.rows[0]["last_counter"] = -1
    r = _run(verify.verify_scan(db, _wire_for(priv, cred, kid), SCOPE_A))
    assert r["verdict"] == V_REVOCADO and r["reason"] == "reembolsada"
    db.credentials.rows[0]["status"] = "transferred"
    db.credentials.rows[0]["last_counter"] = -1
    assert _run(verify.verify_scan(db, _wire_for(priv, cred, kid), SCOPE_A))["verdict"] == V_TRANSFERIDO


def test_pass_decrements_and_exhausts() -> None:
    db = _DB()
    priv, kid, cred = _run(_setup(db, product="pass_monumentos", scope={"monument_ids": ["m1"]}))
    db.credentials.rows[0]["entitlement"]["uses_left"] = 2
    async def seq():
        out = []
        for _ in range(3):
            await asyncio.sleep(0)  # distinct counters not needed; replay allows new counter per step
            db.credentials.rows[0]["last_counter"] = -1  # isolate uses-accounting from rotation
            out.append(await verify.verify_scan(db, _wire_for(priv, cred, kid), GOV))
        return out
    r1, r2, r3 = _run(seq())
    assert r1["verdict"] == V_PASE and r1["uses_left"] == 1
    assert r2["verdict"] == V_PASE and r2["uses_left"] == 0
    assert r3["verdict"] == V_DUPLICADO and r3["reason"] == "sin_usos"


def test_recharge_is_receipt_and_replay_exempt() -> None:
    db = _DB()
    priv, kid, cred = _run(_setup(db, product="recharge_transcaribe", scope={"operator_id": "op1"}))
    w = _wire_for(priv, cred, kid)
    async def twice():
        return await verify.verify_scan(db, w, GOV), await verify.verify_scan(db, w, GOV)
    r1, r2 = _run(twice())
    assert r1["verdict"] == V_RECIBO and r2["verdict"] == V_RECIBO


def test_issue_enforces_tier_floor_and_scope_keys() -> None:
    db = _DB()
    with pytest.raises(issue.IssueError):
        _run(issue.issue_credential(db, "pass_monumentos", {"user_id": "u1"}, test=True))  # hw floor, no device
    with pytest.raises(issue.IssueError):
        _run(issue.issue_credential(db, "ride_bodeguita_island", {"user_id": "u1"}, test=False))  # waiting + not test
    priv, jwk = crypto.generate_p256_keypair()
    reg = _run(issue.register_device(db, "u1", jwk, "test", "software"))
    with pytest.raises(issue.IssueError):
        _run(issue.issue_credential(db, "evt_rsvp_general", {"user_id": "u1"},
                                    device_key_id=reg["device_key_id"], scope={}, test=True))  # missing event_id


def test_a10_manifest_signed_and_carries_revocations(monkeypatch) -> None:
    db = _DB()
    monkeypatch.setenv("PALCO_MANIFEST_SK", "11" * 32)
    priv, kid, cred = _run(_setup(db))
    env1 = _run(manifest.build_manifest(db, {"event_id": "pe_v2", "include_test": True}))
    pub_hex = crypto.manifest_public_hex(crypto.manifest_key_from_env())
    assert manifest.verify_manifest_envelope(pub_hex, env1)
    assert cred["cred_id"] in [c["cred_id"] for c in env1["body"]["credentials"]]
    assert env1["body"]["revoked"] == []
    _run(issue.revoke_credential(db, cred["cred_id"], "ops"))
    _run(issue.revoke_device(db, kid, "ops"))
    env2 = _run(manifest.build_manifest(db, {"event_id": "pe_v2", "include_test": True}))
    assert cred["cred_id"] in env2["body"]["revoked"]
    assert kid in env2["body"]["revoked_device_keys"]
    bad = dict(env2); bad["body"] = dict(env2["body"]); bad["body"]["revoked"] = []
    assert not manifest.verify_manifest_envelope(pub_hex, bad)


def test_manifest_unconfigured_fails_closed(monkeypatch) -> None:
    db = _DB()
    monkeypatch.delenv("PALCO_MANIFEST_SK", raising=False)
    with pytest.raises(manifest.ManifestUnavailable):
        _run(manifest.build_manifest(db, {}))


def test_scan_log_has_no_pii() -> None:
    db = _DB()
    priv, kid, cred = _run(_setup(db))
    _run(verify.verify_scan(db, _wire_for(priv, cred, kid), SCOPE_A))
    assert db.palco_scan_log.rows
    for row in db.palco_scan_log.rows:
        joined = " ".join(str(v) for v in row.values())
        assert "Ana" not in joined and "@" not in joined


def test_phone_hash_is_stable_and_not_reversible_shaped() -> None:
    h1 = issue.phone_hash("+57 311 684-4492")
    h2 = issue.phone_hash("+573116844492")
    assert h1 == h2 and len(h1) == 32 and "311" not in h1
