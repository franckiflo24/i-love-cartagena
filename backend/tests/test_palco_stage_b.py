"""PALCO v2 Stage B — backend half (DESIGN §5, §13, §8 A12): enrollment challenge +
sandbox proof-of-possession attestation, Ley 1581 consent records, and account-
deletion purge. Software P-256 keys; in-memory db; server.py never imported."""
from __future__ import annotations

import asyncio
import copy
import sys
import types
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from palco import consent, crypto, deletion, enroll, identity  # noqa: E402


# ── a fake collection that supports what Stage-B code uses ──────────────────────
def _get(d, key):
    cur = d
    for p in key.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(p)
    return cur


def _match(d, q):
    for k, v in q.items():
        have = _get(d, k)
        if isinstance(v, dict):
            if "$in" in v and have not in v["$in"]:
                return False
            if "$nin" in v and have in v["$nin"]:
                return False
            if "$ne" in v and have == v["$ne"]:
                return False
            if "$exists" in v and (have is not None) != bool(v["$exists"]):
                return False
        elif have != v:
            return False
    return True


def _apply(d, u):
    for k, val in (u.get("$set") or {}).items():
        parts = k.split("."); cur = d
        for p in parts[:-1]:
            cur = cur.setdefault(p, {})
        cur[parts[-1]] = val
    for k in (u.get("$unset") or {}):
        parts = k.split("."); cur = d
        ok = True
        for p in parts[:-1]:
            if not isinstance(cur, dict) or p not in cur:
                ok = False; break
            cur = cur[p]
        if ok and isinstance(cur, dict):
            cur.pop(parts[-1], None)


class _Cursor:
    def __init__(self, rows): self._rows = list(rows)
    def sort(self, *a, **k): return self
    async def to_list(self, n): return self._rows[:n]


class _Coll:
    def __init__(self): self.rows = []
    async def insert_one(self, doc): self.rows.append(copy.deepcopy(doc))
    async def find_one(self, q, proj=None):
        for d in self.rows:
            if _match(d, q):
                return copy.deepcopy(d)
        return None
    def find(self, q, proj=None):
        return _Cursor([copy.deepcopy(d) for d in self.rows if _match(d, q)])
    async def find_one_and_update(self, q, u, **k):
        for d in self.rows:
            if _match(d, q):
                before = copy.deepcopy(d); _apply(d, u); return before
        return None
    async def update_many(self, q, u):
        n = 0
        for d in self.rows:
            if _match(d, q):
                _apply(d, u); n += 1
        return types.SimpleNamespace(modified_count=n)
    async def create_index(self, *a, **k): return None


class _DB:
    def __init__(self):
        for n in ("credentials", "credential_devices", "consent_records",
                  "palco_enroll_challenges"):
            setattr(self, n, _Coll())


def _run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def _mk():
    priv, jwk = crypto.generate_p256_keypair()
    return priv, jwk, crypto.key_id_for_jwk(jwk)


async def _issue_and_pop(db, priv, jwk, key_id, user_id="u1"):
    ch = await enroll.new_challenge(db, user_id)
    pop = crypto.sign_p256_raw(priv, enroll.enroll_binding_payload(ch["challenge"], key_id))
    return ch, pop


# ── enrollment ──────────────────────────────────────────────────────────────────

def test_enroll_sandbox_binds_device() -> None:
    db = _DB()
    async def go():
        priv, jwk, key_id = _mk()
        ch, pop = await _issue_and_pop(db, priv, jwk, key_id)
        out = await enroll.verify_enrollment(
            db, "u1", ch["challenge_id"], jwk, {"mode": "sandbox", "pop_sig": pop}, "ios")
        assert out["device_key_id"] == key_id and out["hw_tier"] == "sandbox"
        dev = await db.credential_devices.find_one({"device_key_id": key_id})
        assert dev and dev["status"] == "active" and dev["user_id"] == "u1"
        assert dev["attestation"]["mode"] == "sandbox"
    _run(go())


def test_enroll_unknown_attester_fail_closed() -> None:
    """A hardware mode with no registered attester is refused — never a silent
    downgrade to software (DESIGN §13.1)."""
    db = _DB()
    async def go():
        priv, jwk, key_id = _mk()
        ch, pop = await _issue_and_pop(db, priv, jwk, key_id)
        with pytest.raises(enroll.EnrollError) as e:
            await enroll.verify_enrollment(
                db, "u1", ch["challenge_id"], jwk, {"mode": "app_attest", "pop_sig": pop}, "ios")
        assert str(e.value) == "attester_unavailable"
        assert await db.credential_devices.find_one({"device_key_id": key_id}) is None
    _run(go())


def test_enroll_bad_pop_rejected() -> None:
    """A binding signed by a DIFFERENT key is not proof-of-possession of pubkey_jwk."""
    db = _DB()
    async def go():
        priv, jwk, key_id = _mk()
        other, _ = crypto.generate_p256_keypair()
        ch = await enroll.new_challenge(db, "u1")
        pop = crypto.sign_p256_raw(other, enroll.enroll_binding_payload(ch["challenge"], key_id))
        with pytest.raises(enroll.EnrollError) as e:
            await enroll.verify_enrollment(
                db, "u1", ch["challenge_id"], jwk, {"mode": "sandbox", "pop_sig": pop}, "ios")
        assert str(e.value) == "attestation_failed"
        assert db.credential_devices.rows == []
    _run(go())


def test_enroll_challenge_is_one_time() -> None:
    db = _DB()
    async def go():
        priv, jwk, key_id = _mk()
        ch, pop = await _issue_and_pop(db, priv, jwk, key_id)
        att = {"mode": "sandbox", "pop_sig": pop}
        assert (await enroll.verify_enrollment(db, "u1", ch["challenge_id"], jwk, att, "ios"))["device_key_id"] == key_id
        with pytest.raises(enroll.EnrollError) as e:
            await enroll.verify_enrollment(db, "u1", ch["challenge_id"], jwk, att, "ios")
        assert str(e.value) == "challenge_used"
    _run(go())


def test_enroll_challenge_expired() -> None:
    db = _DB()
    async def go():
        priv, jwk, key_id = _mk()
        ch, pop = await _issue_and_pop(db, priv, jwk, key_id)
        db.palco_enroll_challenges.rows[0]["expires_at_ms"] = 0
        with pytest.raises(enroll.EnrollError) as e:
            await enroll.verify_enrollment(
                db, "u1", ch["challenge_id"], jwk, {"mode": "sandbox", "pop_sig": pop}, "ios")
        assert str(e.value) == "challenge_expired"
    _run(go())


def test_enroll_challenge_is_user_bound() -> None:
    db = _DB()
    async def go():
        priv, jwk, key_id = _mk()
        ch, pop = await _issue_and_pop(db, priv, jwk, key_id, user_id="u1")
        with pytest.raises(enroll.EnrollError) as e:
            await enroll.verify_enrollment(
                db, "u2", ch["challenge_id"], jwk, {"mode": "sandbox", "pop_sig": pop}, "ios")
        assert str(e.value) == "challenge_unknown"
    _run(go())


# ── consent ─────────────────────────────────────────────────────────────────────

def test_consent_record_and_list_hides_ip() -> None:
    db = _DB()
    async def go():
        rec = await consent.record_consent(
            db, "u1", consent.CURRENT_POLICY_VERSION, "enrollment", "app", ip_hash="a" * 32)
        assert rec["consent_id"].startswith("con_") and rec["purpose"] == "enrollment"
        lst = await consent.list_consents(db, "u1")
        assert len(lst) == 1 and lst[0]["policy_version"] == consent.CURRENT_POLICY_VERSION
        assert "ip_hash" not in lst[0] and "phone_hash" not in lst[0]
    _run(go())


def test_consent_unknown_policy_version_rejected() -> None:
    db = _DB()
    async def go():
        with pytest.raises(consent.ConsentError) as e:
            await consent.record_consent(db, "u1", "made-up-v9", "general", "app")
        assert str(e.value) == "unknown_policy_version"
        assert db.consent_records.rows == []
    _run(go())


def test_consent_unknown_purpose_defaults_general() -> None:
    db = _DB()
    async def go():
        rec = await consent.record_consent(db, "u1", consent.CURRENT_POLICY_VERSION, "nonsense", "app")
        assert rec["purpose"] == "general"
    _run(go())


# ── identity hashing ─────────────────────────────────────────────────────────────

def test_identity_hash_scoped_stable_irreversible() -> None:
    h1 = identity.hash_value("ip", "190.0.0.1")
    h2 = identity.hash_value("ip", "190.0.0.1")
    h3 = identity.hash_value("phone", "190.0.0.1")
    assert h1 == h2 and len(h1) == 32 and "190" not in h1
    assert h1 != h3   # the scope keeps an ip digest from matching a phone digest


# ── A12 deletion ─────────────────────────────────────────────────────────────────

def test_purge_user_deidentifies_revokes_and_keeps_consent_proof() -> None:
    db = _DB()
    async def go():
        await db.credentials.insert_one({"cred_id": "crd_a", "status": "issued",
            "holder": {"user_id": "u1", "display_name": "Ana Viajera", "phone_hash": "abc"}})
        await db.credentials.insert_one({"cred_id": "crd_b", "status": "used", "used_gate": "G1",
            "holder": {"user_id": "u1", "display_name": "Ana Viajera", "phone_hash": "abc"}})
        await db.credentials.insert_one({"cred_id": "crd_c", "status": "issued",
            "holder": {"user_id": "u2", "display_name": "Otro", "phone_hash": "zzz"}})
        await db.credential_devices.insert_one({"device_key_id": "d1", "user_id": "u1", "status": "active"})
        await db.consent_records.insert_one({"consent_id": "con_1", "user_id": "u1",
            "policy_version": consent.CURRENT_POLICY_VERSION, "ip_hash": "y" * 32, "phone_hash": "abc"})

        summary = await deletion.purge_user(db, "u1")

        rows = {r["cred_id"]: r for r in db.credentials.rows}
        assert rows["crd_a"]["status"] == "revoked" and rows["crd_a"]["revoke_reason"] == "account_deleted"
        assert rows["crd_b"]["status"] == "used"   # terminal status preserved
        for cid in ("crd_a", "crd_b"):
            assert rows[cid]["holder"]["display_name"] == "Cuenta eliminada"
            assert rows[cid]["holder"]["phone_hash"] == ""
        assert rows["crd_c"]["status"] == "issued" and rows["crd_c"]["holder"]["display_name"] == "Otro"
        assert db.credential_devices.rows[0]["status"] == "revoked"
        c = db.consent_records.rows[0]
        assert c["policy_version"] == consent.CURRENT_POLICY_VERSION
        assert "ip_hash" not in c and "phone_hash" not in c
        assert summary["credentials_revoked"] == 1 and summary["devices_revoked"] == 1
    _run(go())
