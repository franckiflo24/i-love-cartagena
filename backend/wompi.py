"""
Wompi (Colombia) payment integration — Sandbox + Production.

Architecture (Phase 1: master account):
- ALL payments are collected on the app's master Wompi account.
- The backend records `app_commission` (3% by default) and `partner_amount` per transaction.
- The Alcaldía and Tasa Portuaria do NOT pay commission (0%).
- Partner payouts are reconciled manually (or via Wompi Transfers API in Phase 2).

Required environment variables (loaded in server.py via load_dotenv):
- WOMPI_ENV          : 'sandbox' | 'production'
- WOMPI_PUBLIC_KEY   : pub_test_... | pub_prod_...
- WOMPI_PRIVATE_KEY  : prv_test_... | prv_prod_...
- WOMPI_EVENTS_SECRET   : webhook signature secret
- WOMPI_INTEGRITY_SECRET: checkout URL integrity secret
- APP_COMMISSION_PCT : default 3
"""

import os
import hashlib
import hmac
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def env() -> str:
    return (os.environ.get("WOMPI_ENV") or "sandbox").strip().lower()


def is_configured() -> bool:
    """Return True if all 4 Wompi keys are set (not placeholders)."""
    for key in ("WOMPI_PUBLIC_KEY", "WOMPI_PRIVATE_KEY", "WOMPI_EVENTS_SECRET", "WOMPI_INTEGRITY_SECRET"):
        v = (os.environ.get(key) or "").strip()
        if not v or "REPLACE_ME" in v:
            return False
    return True


def api_base() -> str:
    return "https://production.wompi.co/v1" if env() == "production" else "https://sandbox.wompi.co/v1"


def checkout_base() -> str:
    return "https://checkout.wompi.co/p/" if env() == "production" else "https://checkout.wompi.co/p/"


def app_commission_pct() -> float:
    try:
        return float(os.environ.get("APP_COMMISSION_PCT") or "3")
    except Exception:
        return 3.0


def compute_app_commission(amount_cop: int, is_government: bool = False, kind: str = "partner") -> dict:
    """
    Compute commission split.
    - kind='city_pass'  → 100% Alcaldía/app (0% commission)
    - kind='port_tax'   → 100% Alcaldía/app (0% commission)
    - kind='partner' & is_government=True → 0% commission
    - kind='partner' & is_government=False → APP_COMMISSION_PCT (default 3%)

    Returns: {'app_commission': int, 'partner_amount': int, 'gross': int, 'commission_pct': float}
    """
    amount = int(amount_cop)
    if kind in ("city_pass", "port_tax") or is_government:
        pct = 0.0
    else:
        pct = app_commission_pct()
    commission = int(round(amount * pct / 100.0))
    return {
        "gross": amount,
        "app_commission": commission,
        "partner_amount": amount - commission,
        "commission_pct": pct,
    }


def integrity_signature(reference: str, amount_in_cents: int, currency: str, expiration_iso: Optional[str] = None) -> str:
    """
    Compute the integrity signature required by Wompi Web Checkout.

    Per Wompi docs: the string is
        f"{reference}{amount_in_cents}{currency}{expiration_iso?}{integrity_secret}"
    hashed with SHA-256 (NOT HMAC). Reference: https://docs.wompi.co/docs/colombia/widget-checkout-web
    """
    secret = (os.environ.get("WOMPI_INTEGRITY_SECRET") or "").strip()
    if not secret:
        raise RuntimeError("WOMPI_INTEGRITY_SECRET not configured")
    base = f"{reference}{int(amount_in_cents)}{currency}"
    if expiration_iso:
        base += expiration_iso
    base += secret
    return hashlib.sha256(base.encode("utf-8")).hexdigest()


def verify_event_signature(body_dict: dict, provided_checksum: str) -> bool:
    """
    Verify a Wompi webhook event.

    Wompi sends an `event.signature.properties` list (e.g. ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'])
    and a `event.signature.checksum`. The checksum is SHA-256 of:
        f"{value_of_prop_1}{value_of_prop_2}...{event.timestamp}{events_secret}"
    """
    try:
        secret = (os.environ.get("WOMPI_EVENTS_SECRET") or "").strip()
        if not secret:
            return False
        sig = (body_dict or {}).get("signature") or {}
        props = sig.get("properties") or []
        data = (body_dict or {}).get("data") or {}
        timestamp = (body_dict or {}).get("timestamp")
        if not provided_checksum:
            provided_checksum = sig.get("checksum") or ""
        if not provided_checksum or not props or timestamp is None:
            return False

        # Walk the dotted property paths over the `data` dict
        concatenated = ""
        for path in props:
            value = data
            for piece in path.split("."):
                if isinstance(value, dict):
                    value = value.get(piece)
                else:
                    value = None
                    break
            concatenated += "" if value is None else str(value)
        concatenated += str(timestamp) + secret
        expected = hashlib.sha256(concatenated.encode("utf-8")).hexdigest().upper()
        return hmac.compare_digest(expected.lower(), str(provided_checksum).lower())
    except Exception as e:
        logger.error(f"verify_event_signature error: {e}")
        return False


def build_checkout_url(reference: str, amount_cop: int, currency: str, customer_email: str, redirect_url: str, customer_data: Optional[dict] = None) -> dict:
    """
    Build a Wompi Web Checkout URL with the integrity signature.
    Wompi expects amount IN CENTS.
    """
    public_key = (os.environ.get("WOMPI_PUBLIC_KEY") or "").strip()
    if not public_key:
        raise RuntimeError("WOMPI_PUBLIC_KEY not configured")
    amount_in_cents = int(amount_cop) * 100  # COP has 2 decimal places by convention
    sig = integrity_signature(reference, amount_in_cents, currency)
    base = checkout_base()
    params = {
        "public-key": public_key,
        "currency": currency,
        "amount-in-cents": str(amount_in_cents),
        "reference": reference,
        "signature:integrity": sig,
        "redirect-url": redirect_url,
        "customer-data:email": customer_email or "",
    }
    if customer_data:
        if customer_data.get("name"):
            params["customer-data:full-name"] = customer_data["name"]
        if customer_data.get("phone"):
            params["customer-data:phone-number"] = customer_data["phone"]
    from urllib.parse import urlencode
    qs = urlencode(params, safe=":")
    return {
        "checkout_url": f"{base}?{qs}",
        "reference": reference,
        "amount_in_cents": amount_in_cents,
        "currency": currency,
        "env": env(),
    }


async def fetch_transaction(transaction_id: str) -> Optional[dict]:
    """Pull transaction status from Wompi (used as fallback if webhook is delayed)."""
    import httpx
    private_key = (os.environ.get("WOMPI_PRIVATE_KEY") or "").strip()
    if not private_key:
        return None
    url = f"{api_base()}/transactions/{transaction_id}"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url, headers={"Authorization": f"Bearer {private_key}"})
            if r.status_code == 200:
                return (r.json() or {}).get("data")
    except Exception as e:
        logger.error(f"fetch_transaction error: {e}")
    return None


async def fetch_transaction_by_reference(reference: str) -> Optional[dict]:
    """Look up a transaction by our reference string."""
    import httpx
    private_key = (os.environ.get("WOMPI_PRIVATE_KEY") or "").strip()
    if not private_key:
        return None
    url = f"{api_base()}/transactions"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url, params={"reference": reference}, headers={"Authorization": f"Bearer {private_key}"})
            if r.status_code == 200:
                data = (r.json() or {}).get("data") or []
                if isinstance(data, list) and data:
                    return data[0]
    except Exception as e:
        logger.error(f"fetch_transaction_by_reference error: {e}")
    return None
