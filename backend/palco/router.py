# PALCO Credential Engine v2 — © MachineMind Consulting.
# Licensed to AMO (Amo Cartagena S.A.S.) and city partners; never transferred.
"""HTTP surface of the engine (Stage A; DESIGN §11).

Public:   GET /palco/products · GET /palco/time
Holder:   GET /palco/credentials/mine
Venue:    POST /palco/scan  (business session; mode=consume|verify)
Admin:    Bearer EVENTS_ADMIN_TOKEN (constant-time) OR a government business
          session — device register/revoke, issue, revoke, manifest, and the
          one-shot RSVP dedupe+unique-index maintenance (backs up to
          db.maintenance_backups BEFORE deleting anything, house pattern).

AMO imports this router; the engine never imports AMO route modules (server.py
accessors are injected lazily, same pattern as tickets.py).
"""
from __future__ import annotations

import hmac as _hmac
import logging
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from . import catalog, issue as issue_mod, manifest as manifest_mod, verify as verify_mod, wire
from .models import (COL_CREDENTIALS, COL_DEVICES, COL_LEDGER, COL_SCAN_LOG,
                     MODE_CONSUME, MODE_VERIFY, iso, now_utc, public_credential)

logger = logging.getLogger(__name__)
router = APIRouter()

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
        await getattr(db, COL_CREDENTIALS).create_index("cred_id", unique=True)
        await getattr(db, COL_CREDENTIALS).create_index("entitlement.scope.event_id")
        await getattr(db, COL_CREDENTIALS).create_index([("holder.user_id", 1), ("created_at", -1)])
        await getattr(db, COL_DEVICES).create_index("device_key_id", unique=True)
        await getattr(db, COL_LEDGER).create_index([("cred_id", 1), ("at", 1)])
        await getattr(db, COL_SCAN_LOG).create_index("at")
    except Exception as exc:  # noqa: BLE001
        logger.error("[palco] index ensure failed: %s", type(exc).__name__)


async def _user(request: Request) -> Dict[str, Any]:
    from server import get_current_user
    return await get_current_user(request)


async def _business(request: Request) -> Dict[str, Any]:
    from server import get_current_business
    return await get_current_business(request)


async def _rl(request: Request, bucket: str, max_calls: int, window: int) -> None:
    try:
        from server import _check_rate_limit, _client_ip
        await _check_rate_limit(f"{bucket}:{_client_ip(request)}", max_calls=max_calls, window_sec=window)
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001
        pass


async def _require_admin(request: Request) -> Dict[str, Any]:
    """Bearer EVENTS_ADMIN_TOKEN (constant-time) or a government session."""
    token = os.environ.get("EVENTS_ADMIN_TOKEN") or ""
    auth = request.headers.get("authorization") or ""
    if token and auth.startswith("Bearer ") and _hmac.compare_digest(auth[7:], token):
        return {"admin": "token"}
    try:
        biz = await _business(request)
        if biz.get("role") == "government":
            return {"admin": "government", "business_id": biz.get("business_id")}
    except HTTPException:
        pass
    raise HTTPException(status_code=401, detail={
        "error": "unauthorized", "message": "Credencial de administración requerida / Admin credential required"})


# ── public ────────────────────────────────────────────────────────────────────

@router.get("/palco/products")
async def palco_products():
    return {"products": catalog.public_view()}


@router.get("/palco/time")
async def palco_time(response: Response):
    """Server clock for the wallet's counter-correction delta (DESIGN §2)."""
    response.headers["Cache-Control"] = "no-store"
    now = now_utc()
    return {"now_ms": int(now.timestamp() * 1000), "step_ms": wire.STEP_SECONDS * 1000,
            "server_time": iso(now)}


# ── holder ────────────────────────────────────────────────────────────────────

@router.get("/palco/credentials/mine")
async def palco_mine(request: Request):
    user = await _user(request)
    rows = await getattr(db, COL_CREDENTIALS).find(
        {"holder.user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"credentials": [public_credential(r) for r in rows]}


# ── venue / inspector gate ────────────────────────────────────────────────────

class ScanBody(BaseModel):
    wire: str = Field(min_length=8, max_length=200)
    mode: str = Field(default=MODE_CONSUME, pattern="^(consume|verify)$")
    gate: Optional[str] = Field(default=None, max_length=40)


@router.post("/palco/scan")
async def palco_scan(body: ScanBody, request: Request):
    biz = await _business(request)
    await _rl(request, "palscan", 120, 60)
    await _ensure_indexed()
    scope = {"gov": biz.get("role") == "government", "partner_id": biz.get("partner_id"),
             "scanner_id": biz.get("business_id"), "gate": body.gate or "Puerta 1"}
    return await verify_mod.verify_scan(db, body.wire, scope, mode=body.mode)


# ── admin ─────────────────────────────────────────────────────────────────────

class DeviceRegisterBody(BaseModel):
    user_id: str = Field(min_length=1, max_length=60)
    pubkey_jwk: Dict[str, Any]
    platform: str = Field(default="test", max_length=20)
    hw_tier: str = Field(default="software", max_length=20)


@router.post("/palco/admin/devices/register")
async def palco_admin_register_device(body: DeviceRegisterBody, request: Request):
    await _require_admin(request)
    await _rl(request, "paladmin", 60, 60)
    await _ensure_indexed()
    try:
        return await issue_mod.register_device(db, body.user_id, body.pubkey_jwk,
                                               body.platform, body.hw_tier)
    except issue_mod.IssueError as exc:
        raise HTTPException(status_code=422, detail={"error": str(exc)})


class IssueBody(BaseModel):
    product_id: str = Field(min_length=1, max_length=60)
    holder: Dict[str, Any] = Field(default_factory=dict)
    device_key_id: Optional[str] = Field(default=None, max_length=24)
    scope: Optional[Dict[str, Any]] = None
    valid_from: Optional[str] = Field(default=None, max_length=25)
    valid_to: Optional[str] = Field(default=None, max_length=25)
    test: bool = True   # Stage A admin issuance is test-only; payments mint for real (Stage D)


@router.post("/palco/admin/issue")
async def palco_admin_issue(body: IssueBody, request: Request):
    await _require_admin(request)
    await _rl(request, "paladmin", 60, 60)
    await _ensure_indexed()
    try:
        doc = await issue_mod.issue_credential(
            db, body.product_id, body.holder, device_key_id=body.device_key_id,
            scope=body.scope, valid_from=body.valid_from, valid_to=body.valid_to,
            test=True if body.test is not False else False)
    except issue_mod.IssueError as exc:
        raise HTTPException(status_code=422, detail={"error": str(exc)})
    return {"credential": public_credential(doc)}


class RevokeBody(BaseModel):
    cred_id: str = Field(min_length=4, max_length=40)
    reason: str = Field(min_length=1, max_length=120)
    refund: bool = False


@router.post("/palco/admin/revoke")
async def palco_admin_revoke(body: RevokeBody, request: Request):
    await _require_admin(request)
    await _rl(request, "paladmin", 60, 60)
    flipped = await issue_mod.revoke_credential(db, body.cred_id, body.reason, refund=body.refund)
    if flipped is None:
        raise HTTPException(status_code=404, detail={"error": "not_found_or_already",
                            "message": "Credencial no encontrada o ya revocada / Not found or already revoked"})
    return {"ok": True, "cred_id": body.cred_id, "status": "refunded" if body.refund else "revoked"}


class DeviceRevokeBody(BaseModel):
    device_key_id: str = Field(min_length=12, max_length=24)
    reason: str = Field(min_length=1, max_length=120)


@router.post("/palco/admin/devices/revoke")
async def palco_admin_revoke_device(body: DeviceRevokeBody, request: Request):
    await _require_admin(request)
    await _rl(request, "paladmin", 60, 60)
    ok = await issue_mod.revoke_device(db, body.device_key_id, body.reason)
    if not ok:
        raise HTTPException(status_code=404, detail={"error": "not_found_or_already"})
    return {"ok": True}


@router.get("/palco/admin/manifest")
async def palco_admin_manifest(request: Request, event_id: Optional[str] = None,
                               include_test: bool = False):
    await _require_admin(request)
    await _rl(request, "paladmin", 60, 60)
    scope: Dict[str, Any] = {}
    if event_id:
        scope["event_id"] = event_id
    if include_test:
        scope["include_test"] = True
    try:
        return await manifest_mod.build_manifest(db, scope)
    except manifest_mod.ManifestUnavailable:
        raise HTTPException(status_code=503, detail={
            "error": "manifest_unconfigured",
            "message": "Manifiesto no disponible: falta la llave de firma / Signing key not configured"})


@router.post("/palco/admin/maintenance/dedupe-rsvp")
async def palco_admin_dedupe_rsvp(request: Request):
    """One-shot migration for the RSVP uniqueness gap (DESIGN §10 Stage A):
    backs duplicates up to db.maintenance_backups, keeps the best row per
    (user_id, event_id) — a used ticket wins, else the oldest — deletes the
    rest, then builds the partial unique index. Idempotent; reports everything."""
    await _require_admin(request)
    await _rl(request, "paladmin", 10, 60)
    rows = await db.amo_tickets.find({"kind": "event_rsvp"}, {"_id": 0}).to_list(100000)
    by_key: Dict[tuple, list] = {}
    for r in rows:
        by_key.setdefault((r.get("user_id"), r.get("event_id")), []).append(r)
    removed = []
    for (_, _), docs in by_key.items():
        if len(docs) < 2:
            continue
        docs.sort(key=lambda d: (0 if d.get("status") == "used" else 1, d.get("created_at") or ""))
        for extra in docs[1:]:
            if extra.get("status") == "used":
                continue  # never delete a used ticket; leave the conflict for humans
            removed.append(extra)
    if removed:
        await db.maintenance_backups.insert_one({
            "kind": "palco_dedupe_rsvp", "at": iso(), "count": len(removed), "docs": removed})
        for r in removed:
            await db.amo_tickets.delete_one({"ticket_id": r["ticket_id"], "status": "issued"})
    index_ok, index_error = True, None
    try:
        await db.amo_tickets.create_index(
            [("user_id", 1), ("event_id", 1), ("kind", 1)], unique=True,
            partialFilterExpression={"kind": "event_rsvp"}, name="uniq_user_event_rsvp")
    except Exception as exc:  # noqa: BLE001
        index_ok, index_error = False, type(exc).__name__
    return {"duplicates_removed": len(removed), "backed_up": bool(removed),
            "unique_index": index_ok, "index_error": index_error}
