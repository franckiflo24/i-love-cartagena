# PALCO Credential Engine v2 — © MachineMind Consulting.
# Licensed to AMO (Amo Cartagena S.A.S.) and city partners; never transferred.
"""Product catalog loader — config, not code (DESIGN §1.2–§1.3).

`backend/data/palco_products.json` is the single source. Adding a vertical =
adding a product config + an issuer agreement; nothing else changes. The loader
FAILS LOUD on an invalid catalog (the engine refuses to issue against a shape
it can't trust), and enforces the honesty rules at load time:

- a `ride` may be `live` only with a DIMAR authorization on the agreement;
- an AMOBUS product may NEVER be `live` without a validator-acceptance
  agreement (a recharge channel is the only pre-agreement bus product, and it
  still needs the operator agreement to go live);
- `waiting_agreement` products carry no purchasable price downstream (the
  public projection strips it).
"""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

from .models import NAMESPACES, NS_BUS, PRODUCT_TYPES

CATALOG_PATH = Path(__file__).resolve().parent.parent / "data" / "palco_products.json"

S_LIVE = "live"
S_WAITING = "waiting_agreement"
_STATUSES = (S_LIVE, S_WAITING)

_TRANSFER_KEYS = {"allowed", "not_after_first_use", "lock_minutes_before_start",
                  "max_transfers", "require_named_id", "face_value_cap_cop"}

_lock = threading.Lock()
_cache: Optional[Dict[str, Dict[str, Any]]] = None
_cache_mtime: Optional[float] = None


class CatalogError(ValueError):
    """Invalid catalog — raised loud; the engine refuses to run on bad config."""


def _validate(raw: Any) -> Dict[str, Dict[str, Any]]:
    if not isinstance(raw, dict) or not isinstance(raw.get("products"), list):
        raise CatalogError("catalog root must be {catalog_version, products: []}")
    out: Dict[str, Dict[str, Any]] = {}
    for p in raw["products"]:
        pid = p.get("product_id")
        if not isinstance(pid, str) or not pid:
            raise CatalogError("product without product_id")
        if pid in out:
            raise CatalogError(f"duplicate product_id {pid}")
        if p.get("product_type") not in PRODUCT_TYPES:
            raise CatalogError(f"{pid}: bad product_type")
        if p.get("namespace") not in NAMESPACES:
            raise CatalogError(f"{pid}: bad namespace")
        if p.get("status") not in _STATUSES:
            raise CatalogError(f"{pid}: bad status")
        if p.get("tier_floor") not in ("hw", "legacy"):
            raise CatalogError(f"{pid}: bad tier_floor")
        if not isinstance(p.get("issuer_id"), str) or not p["issuer_id"]:
            raise CatalogError(f"{pid}: missing issuer_id")
        ent = p.get("entitlement")
        if not isinstance(ent, dict) or not isinstance(ent.get("uses_total"), int) or ent["uses_total"] < 1:
            raise CatalogError(f"{pid}: entitlement.uses_total must be a positive int")
        tr = p.get("transfer_rules")
        if not isinstance(tr, dict) or not set(tr) <= _TRANSFER_KEYS or "allowed" not in tr:
            raise CatalogError(f"{pid}: bad transfer_rules")
        agreement = p.get("agreement")
        if p["status"] == S_LIVE:
            if p["product_type"] == "ride" and not (isinstance(agreement, dict) and agreement.get("dimar_auth")):
                raise CatalogError(f"{pid}: a live ride requires agreement.dimar_auth")
            if p["namespace"] == NS_BUS and not (isinstance(agreement, dict) and agreement.get("validator_acceptance")):
                raise CatalogError(f"{pid}: AMOBUS may not be live without validator acceptance")
        if not isinstance(p.get("price_cop"), int) or p["price_cop"] < 0:
            raise CatalogError(f"{pid}: price_cop must be a non-negative int")
        if not isinstance(p.get("tax_cop"), int) or p["tax_cop"] < 0:
            raise CatalogError(f"{pid}: tax_cop must be a non-negative int")
        out[pid] = p
    return out


def load(force: bool = False) -> Dict[str, Dict[str, Any]]:
    global _cache, _cache_mtime
    with _lock:
        try:
            mtime = CATALOG_PATH.stat().st_mtime
        except OSError as exc:
            raise CatalogError(f"catalog missing at {CATALOG_PATH.name}") from exc
        if not force and _cache is not None and _cache_mtime == mtime:
            return _cache
        raw = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
        _cache = _validate(raw)
        _cache_mtime = mtime
        return _cache


def get(product_id: str) -> Optional[Dict[str, Any]]:
    return load().get(product_id)


def public_view() -> List[Dict[str, Any]]:
    """Honest public projection: waiting_agreement products show NO price and
    read as upcoming; nothing ever renders a dead buy CTA (DESIGN §0)."""
    rows = []
    for p in load().values():
        row = {
            "product_id": p["product_id"], "product_type": p["product_type"],
            "namespace": p["namespace"], "name": p.get("name") or {},
            "status": p["status"], "issuer_id": p["issuer_id"],
        }
        if p["status"] == S_LIVE:
            row["price_cop"] = p["price_cop"]
            row["tax_cop"] = p["tax_cop"]
        else:
            row["note"] = {"es": "Próximamente — sujeto a acuerdo con el operador.",
                           "en": "Coming soon — subject to an operator agreement."}
        rows.append(row)
    return rows
