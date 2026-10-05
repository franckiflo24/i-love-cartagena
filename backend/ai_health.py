"""AI-health guard: page the ops channel the moment the LLM is DOWN FOR EVERYONE.

Context: every Anthropic call in this backend goes through llm.py, whose except
blocks swallow the error and return None -> callers fall back to a canned reply.
That is correct for resilience but SILENT: on 2026-10-05 the Anthropic credit
balance hit zero and Luna (and every other feature on the shared key) served the
generic fallback to all users for ~an hour with no signal. This module turns that
silent class into a throttled Telegram page via telegram_alerts (same channel as
every other AMO alert, so Sergio receives it — see feedback_sergio_notifications).

What it pages on (the "AI is down for everyone" class, not transient blips):
  * credit balance exhausted      -> HTTP 400 "...credit balance is too low..."
  * API key rejected / forbidden   -> HTTP 401 / 403 (bad or revoked key, no access)
Transient errors (429 rate-limit, 529 overloaded, timeouts, parse issues) are
EXPECTED and self-recover, so they never page.

Throttle: at most one page per class per THROTTLE_SEC, deduped both per-process
(cheap pre-filter) and across serverless instances (an atomic Mongo claim on
`system_alerts`). Never raises and never blocks the caller for more than the
telegram_alerts 5 s budget, and only the first failure in a window pays even that.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Optional, Tuple

logger = logging.getLogger("ai.health")

THROTTLE_SEC = 1800  # 30 min between pages for the same class
_local_last: dict[str, float] = {}  # per-process throttle (avoids a Mongo hit per failed call)
_db = None


def _get_db():
    """Lazy, cached motor handle for the throttle collection only (or None)."""
    global _db
    if _db is not None:
        return _db
    url = os.environ.get("MONGO_URL", "").strip()
    if not url:
        return None
    try:
        from motor.motor_asyncio import AsyncIOMotorClient
        _db = AsyncIOMotorClient(url)[os.environ.get("DB_NAME", "amo_cartagena")]
    except Exception as exc:  # noqa: BLE001 — the guard must never break the LLM path
        logger.error("[ai.health] db init failed: %s", type(exc).__name__)
        return None
    return _db


def classify(exc: BaseException) -> Optional[Tuple[str, str]]:
    """Return (alert_key, human_detail) when `exc` means the LLM is down for
    EVERYONE, else None (transient / not our concern)."""
    status = getattr(exc, "status_code", None)
    low = str(exc).lower()
    if status == 400 and "credit balance" in low:
        return ("llm_credits", "Saldo de créditos de Anthropic agotado (HTTP 400 'credit balance too low').")
    if status in (401, 403) or "authentication_error" in low or "invalid x-api-key" in low or "permission_error" in low:
        return (f"llm_auth_{status or 'x'}", f"Clave de Anthropic rechazada o sin acceso (HTTP {status or '401/403'}).")
    return None


async def on_llm_error(exc: BaseException) -> None:
    """Classify a swallowed LLM error and page (throttled) on the systemic class.
    Call from llm.py's except blocks. NEVER raises."""
    try:
        hit = classify(exc)
        if not hit:
            return
        key, detail = hit
        now = time.time()

        # Cheap per-process throttle first (no Mongo / no network on the hot path).
        if now - _local_last.get(key, 0.0) < THROTTLE_SEC:
            return
        _local_last[key] = now

        # Cross-instance dedupe: only the instance that wins the atomic claim pages.
        send = True
        db = _get_db()
        if db is not None:
            try:
                from pymongo import ReturnDocument
                from pymongo.errors import DuplicateKeyError
                try:
                    await db.system_alerts.find_one_and_update(
                        {"_id": key, "last_sent": {"$lt": now - THROTTLE_SEC}},
                        {"$set": {"last_sent": now, "detail": detail}},
                        upsert=True, return_document=ReturnDocument.BEFORE,
                    )
                except DuplicateKeyError:
                    send = False  # a doc exists inside the window -> another instance paged already
            except Exception as exc2:  # noqa: BLE001 — Mongo hiccup: fall back to the per-process throttle
                logger.error("[ai.health] throttle claim failed: %s", type(exc2).__name__)

        if not send:
            return

        import telegram_alerts as _tg
        res = await _tg.send(
            "🧠 URGENTE — AMO sin IA (Luna y funciones con IA)\n"
            f"{detail}\n"
            "Ahora mismo CADA consulta a Luna devuelve la respuesta genérica (sin IA) para TODOS "
            "los usuarios — web y app. Las demás apps que usan la misma clave de Anthropic también "
            "están caídas.\n"
            "Acción: recargar créditos / revisar la clave en console.anthropic.com → Plans & Billing."
        )
        logger.error("[ai.health] PAGED %s -> sent=%s chats=%s", key, res.get("sent"), res.get("chats"))
    except Exception as exc3:  # noqa: BLE001 — a monitor that breaks the thing it monitors is worse than none
        logger.error("[ai.health] on_llm_error crashed: %s", type(exc3).__name__)
