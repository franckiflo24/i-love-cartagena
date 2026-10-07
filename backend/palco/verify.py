# PALCO Credential Engine v2 — © MachineMind Consulting.
# Licensed to AMO (Amo Cartagena S.A.S.) and city partners; never transferred.
"""The verdict pipeline (DESIGN §4). Fail closed, named reasons, zero PII in logs.

Order (first match wins):
  malformed / unknown credential / unknown-or-foreign key / bad sig → FALSIFICADO
  counter outside ±1 (validator clock)                              → EXPIRADO
  replay (counter ≤ last_counter; atomic advance on consume)        → DUPLICADO
  status revoked|refunded → REVOCADO · transferred → TRANSFERIDO
  single-use already used / exhausted                               → DUPLICADO
  scope mismatch                                                    → FUERA_DE_ALCANCE
  validity window / backing state missing-or-dead (fail closed)     → EXPIRADO + reason
  then: event_ticket|ride → VALIDO (atomic flip on consume)
        pass → PASE (decrements uses_left on consume when counted)
        recharge → RECIBO (never admits, never consumes, no replay gate)

MODE_VERIFY (inspector) runs the same checks and consumes NOTHING: no flip, no
decrement, no last_counter advance. RECIBO is exempt from the replay gate by
contract (receipts never admit, so "already seen" has no meaning for them).

The v1 (LEGACY) tier is served verify-only here: consuming v1 scans stay on the
proven /business/tickets/scan path, so nothing in the field changes behavior.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Mapping, Optional

import qr_credential as _v1qc
from events_time import event_is_live

from . import catalog, crypto, wire
from .models import (COL_CREDENTIALS, COL_DEVICES, COL_SCAN_LOG, CONSUMABLE_STATUSES,
                     DEVICE_STATUS_ACTIVE, MODE_CONSUME, MODE_VERIFY, S_ACTIVE,
                     S_EXHAUSTED, S_EXPIRED, S_ISSUED, S_REFUNDED, S_REVOKED,
                     S_TRANSFERRED, S_USED, TIER_LEGACY, V_DUPLICADO, V_EXPIRADO,
                     V_FALSIFICADO, V_FUERA, V_PASE, V_RECIBO, V_REVOCADO,
                     V_TRANSFERIDO, V_VALIDO, iso, now_utc, reason_line)

logger = logging.getLogger(__name__)


def _first_name(full: str) -> str:
    return (full or "").strip().split(" ")[0][:40]


def _res(verdict: str, reason: Optional[str] = None, **extra: Any) -> Dict[str, Any]:
    out: Dict[str, Any] = {"verdict": verdict}
    if reason:
        out.update(reason_line(reason))
    out.update(extra)
    return out


async def _log(db: Any, scope: Mapping[str, Any], verdict: str, mode: str,
               cred_id: str = "", tier: str = "hw", namespace: str = "") -> None:
    try:
        await getattr(db, COL_SCAN_LOG).insert_one({
            "at": iso(), "verdict": verdict, "mode": mode, "tier": tier,
            "cred_id": cred_id, "namespace": namespace,
            "gate": (scope.get("gate") or "")[:40],
            "scanner_partner_id": scope.get("partner_id"),
            "scanned_by": scope.get("scanner_id"),
            "validator_id": scope.get("validator_id"),
        })
    except Exception as exc:  # noqa: BLE001 — logging never breaks the gate
        logger.error("[palco] scan log failed: %s", type(exc).__name__)


def _parse_iso(s: Any) -> Optional[datetime]:
    if not isinstance(s, str) or not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        return None


def _within_window(ent: Mapping[str, Any], now: datetime) -> bool:
    grace = int(ent.get("grace_min") or 0)
    vf, vt = _parse_iso(ent.get("valid_from")), _parse_iso(ent.get("valid_to"))
    if vf is not None and (now - vf).total_seconds() < -grace * 60:
        return False
    if vt is not None and (now - vt).total_seconds() > grace * 60:
        return False
    return True


async def _scope_ok(db: Any, cred: Mapping[str, Any], scope: Mapping[str, Any]) -> Optional[bool]:
    """True = in scope · False = out of scope · None = backing state unreadable
    (caller fails closed). Stage A scopes: gov/admin sees all; a venue session
    may admit only credentials whose backing EVENT belongs to it; every other
    scope kind (vessel/route/monument/operator) requires an enrolled validator
    assignment, which Stage C ships — until then those are gov-only."""
    if scope.get("gov"):
        return True
    cscope = (cred.get("entitlement") or {}).get("scope") or {}
    event_id = cscope.get("event_id")
    if event_id:
        ev = await db.partner_events.find_one({"event_id": event_id}, {"_id": 0, "partner_id": 1})
        if ev is None:
            return None
        return bool(scope.get("partner_id")) and ev.get("partner_id") == scope.get("partner_id")
    return False  # non-event scopes: fail closed until validator enrollment (Stage C)


async def _backing_state_ok(db: Any, cred: Mapping[str, Any]) -> Optional[bool]:
    """Re-read CURRENT backing state — never trust the copy on the credential.
    True = live · False = dead (unpublished/rejected/cancelled/past) · None =
    unreadable (fail closed). Publication state counts: an event pulled from
    the public surface stops admitting, exactly like a cancelled one."""
    cscope = (cred.get("entitlement") or {}).get("scope") or {}
    event_id = cscope.get("event_id")
    if not event_id:
        return True  # nothing event-backed to re-read in Stage A shapes
    try:
        ev = await db.partner_events.find_one({"event_id": event_id}, {"_id": 0})
        if ev is None:
            return None
        if not ev.get("is_published") or ev.get("moderation_status") != "approved":
            return False
        return bool(event_is_live(ev))
    except Exception:  # noqa: BLE001
        return None


def _guest(cred: Mapping[str, Any], product: Optional[Mapping[str, Any]]) -> Dict[str, Any]:
    holder = cred.get("holder") or {}
    name = (product or {}).get("name") or {}
    ent = cred.get("entitlement") or {}
    return {"name": _first_name(holder.get("display_name") or ""),
            "ticket_title": name.get("es") or cred.get("product_id") or "",
            "event_date": str(ent.get("valid_to") or "")[:10],
            "venue_name": ""}


async def verify_scan(db: Any, raw_wire: str, scope: Mapping[str, Any],
                      mode: str = MODE_CONSUME, now_ms: Optional[int] = None) -> Dict[str, Any]:
    consume = mode == MODE_CONSUME
    parsed = wire.parse_wire_v2(raw_wire)
    if parsed is None:
        legacy = wire.parse_wire_v1(raw_wire)
        if legacy is not None:
            return await _verify_legacy(db, legacy, scope)
        await _log(db, scope, V_FALSIFICADO, mode)
        return _res(V_FALSIFICADO, "firma_invalida")

    cred_id, counter, key_id = parsed["cred_id"], parsed["counter"], parsed["key_id"]

    async def done(result: Dict[str, Any], cred: Optional[Mapping[str, Any]] = None) -> Dict[str, Any]:
        await _log(db, scope, result["verdict"], mode, cred_id=cred_id,
                   namespace=(cred or {}).get("namespace") or "")
        return result

    cred = await getattr(db, COL_CREDENTIALS).find_one({"cred_id": cred_id}, {"_id": 0})
    if cred is None or cred.get("device_key_id") != key_id:
        return await done(_res(V_FALSIFICADO, "llave_desconocida"), cred)

    device = await getattr(db, COL_DEVICES).find_one({"device_key_id": key_id}, {"_id": 0})
    if device is None or device.get("status") != DEVICE_STATUS_ACTIVE:
        return await done(_res(V_FALSIFICADO, "llave_desconocida"), cred)

    pub = crypto.load_p256_jwk(device.get("pubkey_jwk") or {})
    payload = wire.signing_payload(cred.get("namespace") or "", cred_id, counter, key_id)
    if pub is None or not crypto.verify_p256(pub, payload, parsed["sig"]):
        return await done(_res(V_FALSIFICADO, "firma_invalida"), cred)

    if not wire.counter_fresh(counter, now_ms):
        return await done(_res(V_EXPIRADO, "codigo_vencido"), cred)

    product = catalog.get(cred.get("product_id") or "")
    if product is None:
        return await done(_res(V_FALSIFICADO, "producto_invalido"), cred)
    ptype = product["product_type"]

    # Replay gate (monotonic last_counter). Receipts are exempt by contract.
    if ptype != "recharge":
        if consume:
            advanced = await getattr(db, COL_CREDENTIALS).find_one_and_update(
                {"cred_id": cred_id, "last_counter": {"$lt": counter}},
                {"$set": {"last_counter": counter}})
            if advanced is None:
                return await done(_res(V_DUPLICADO, "repetido"), cred)
        elif counter <= int(cred.get("last_counter") or -1):
            return await done(_res(V_DUPLICADO, "repetido"), cred)

    status = cred.get("status")
    if status in (S_REVOKED,):
        return await done(_res(V_REVOCADO, "revocada"), cred)
    if status == S_REFUNDED:
        return await done(_res(V_REVOCADO, "reembolsada"), cred)
    if status == S_TRANSFERRED:
        return await done(_res(V_TRANSFERIDO, "transferida"), cred)
    if status == S_EXPIRED:
        return await done(_res(V_EXPIRADO, "fuera_de_ventana"), cred)
    if status in (S_USED, S_EXHAUSTED) and ptype in ("event_ticket", "ride"):
        # CLOSURE-AUDIT FIX (V-A4b, 2026-10-06): this exit fires before the
        # scope gate, so enrichment must check scope itself — the verdict is
        # contractual (§4 precedence), the guest panel is in-scope-only.
        enrich: Dict[str, Any] = {}
        if await _scope_ok(db, cred, scope) is True:
            enrich = {"first_used_at": cred.get("used_at"),
                      "first_gate": cred.get("used_gate"),
                      "guest": _guest(cred, product)}
        return await done(_res(V_DUPLICADO, "ya_usada", **enrich), cred)

    in_scope = await _scope_ok(db, cred, scope)
    if in_scope is None:
        return await done(_res(V_EXPIRADO, "estado_inaccesible"), cred)
    if not in_scope:
        return await done(_res(V_FUERA, "fuera_de_alcance"), cred)

    now = now_utc()
    ent = cred.get("entitlement") or {}
    if not _within_window(ent, now):
        return await done(_res(V_EXPIRADO, "fuera_de_ventana", guest=_guest(cred, product)), cred)
    backing = await _backing_state_ok(db, cred)
    if backing is None:
        return await done(_res(V_EXPIRADO, "estado_inaccesible"), cred)
    if backing is False:
        return await done(_res(V_EXPIRADO, "evento_no_activo"), cred)

    guest = _guest(cred, product)

    if ptype == "recharge":
        return await done(_res(V_RECIBO, guest=guest), cred)

    if ptype == "pass":
        uses_left = ent.get("uses_left")
        if isinstance(uses_left, int):
            if uses_left <= 0:
                return await done(_res(V_DUPLICADO, "sin_usos", guest=guest), cred)
            if consume:
                dec = await getattr(db, COL_CREDENTIALS).find_one_and_update(
                    {"cred_id": cred_id, "entitlement.uses_left": {"$gt": 0}},
                    {"$inc": {"entitlement.uses_left": -1}})
                if dec is None:
                    return await done(_res(V_DUPLICADO, "sin_usos", guest=guest), cred)
                uses_left = int((dec.get("entitlement") or {}).get("uses_left", uses_left)) - 1
            return await done(_res(V_PASE, guest=guest, uses_left=uses_left), cred)
        return await done(_res(V_PASE, guest=guest), cred)

    # event_ticket | ride — single-use admit
    if not consume:
        return await done(_res(V_VALIDO, guest=guest, mode=MODE_VERIFY), cred)
    flipped = await getattr(db, COL_CREDENTIALS).find_one_and_update(
        {"cred_id": cred_id, "status": {"$in": list(CONSUMABLE_STATUSES)}},
        {"$set": {"status": S_USED, "used_at": iso(now), "used_gate": (scope.get("gate") or "")[:40]}})
    if flipped is None:
        fresh = await getattr(db, COL_CREDENTIALS).find_one({"cred_id": cred_id}, {"_id": 0})
        return await done(_res(V_DUPLICADO, "ya_usada",
                               first_used_at=(fresh or {}).get("used_at"),
                               first_gate=(fresh or {}).get("used_gate"), guest=guest), cred)
    return await done(_res(V_VALIDO, guest=guest), cred)


# ── LEGACY tier: verify-only over the live v1 namespaces (inspectors/city) ────

_V1_COLLECTIONS = {
    "AMOTKT1": ("amo_tickets", "ticket_id"),
    "AMOPASS1": ("city_passes", "pass_id"),
    "AMOCIV1": ("civic_demo_tickets", "ticket_id"),
}


async def _verify_legacy(db: Any, legacy: Mapping[str, Any], scope: Mapping[str, Any]) -> Dict[str, Any]:
    ns, entity_id = legacy["namespace"], legacy["entity_id"]

    async def done(result: Dict[str, Any]) -> Dict[str, Any]:
        await _log(db, scope, result["verdict"], MODE_VERIFY, cred_id=entity_id,
                   tier=TIER_LEGACY, namespace=ns)
        result["mode"] = MODE_VERIFY
        result["tier"] = TIER_LEGACY
        return result

    coll_name, id_field = _V1_COLLECTIONS[ns]
    doc = await getattr(db, coll_name).find_one({id_field: entity_id}, {"_id": 0})
    if doc is None or not doc.get("qr_secret"):
        return await done(_res(V_FALSIFICADO, "llave_desconocida"))
    v = _v1qc.verify({"entity_id": entity_id, "counter": legacy["counter"],
                      "token": legacy["token"]}, doc["qr_secret"])
    if v == "COUNTERFEIT":
        return await done(_res(V_FALSIFICADO, "firma_invalida"))
    if v == "EXPIRED":
        return await done(_res(V_EXPIRADO, "codigo_vencido"))

    if ns == "AMOTKT1":
        if not scope.get("gov") and doc.get("partner_id") != scope.get("partner_id"):
            return await done(_res(V_FUERA, "fuera_de_alcance"))
        if doc.get("status") == "used":
            return await done(_res(V_DUPLICADO, "ya_usada",
                                   first_used_at=doc.get("used_at"), first_gate=doc.get("used_gate")))
        return await done(_res(V_VALIDO))
    if ns == "AMOPASS1":
        active = bool(doc.get("is_active")) and str(doc.get("expires_at") or "") > iso()
        return await done(_res(V_PASE) if active else _res(V_EXPIRADO, "fuera_de_ventana"))
    # AMOCIV1 — civic demo is government-surface only
    if not scope.get("gov"):
        return await done(_res(V_FUERA, "fuera_de_alcance"))
    if doc.get("kind") == "receipt":
        return await done(_res(V_RECIBO))
    if doc.get("status") == "used":
        return await done(_res(V_DUPLICADO, "ya_usada"))
    return await done(_res(V_VALIDO))
