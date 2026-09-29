"""EVENTS-ELITE Telegram alerts (DESIGN.md §1.3, §13 C2, §15 X5).

  send(text)                 -> {'configured', 'sent', 'chats', 'errors'}   instant alert
  digest(title, lines)       -> same                                       daily summary

Configuration is env-only: TELEGRAM_BOT_TOKEN and TELEGRAM_ALERT_CHAT_IDS (comma-separated).
When either is unset the alert is logged and nothing is sent.

Guarantees:
  * never raises (every failure is logged and reported in the returned dict);
  * one 5 s wall-clock budget per call, whatever the number of chats;
  * logs only type(exc).__name__ or the HTTP status. httpx exception text embeds the request
    URL, and that URL embeds the bot token, so str(exc) and the URL are never logged (§15 X5);
  * plain text only (no parse_mode) and no links: an alert never carries a state-changing
    action (§15 X5);
  * a per-process ceiling (MAX_PER_MINUTE) so a sentinel storm cannot hammer the Bot API;
    the sentinel also caps its own instant alerts and folds the rest into one message.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

import httpx

logger = logging.getLogger("events.telegram")

_TG_BOT_PATH_RE = re.compile(r"(api\.telegram\.org/bot)[^/\s\"']+")


class _RedactBotToken(logging.Filter):
    """§15 X5: httpx logs 'HTTP Request: POST https://api.telegram.org/bot<TOKEN>/sendMessage …'
    at INFO for every request, and server.py configures the root logger at INFO. Redact the
    token from any httpx / httpcore record instead of trusting the log level of the runtime."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:  # noqa: BLE001 — a malformed record is not ours to fix
            return True
        red = _TG_BOT_PATH_RE.sub(r"\1<redacted>", msg)
        token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
        if token and len(token) >= 8:
            red = red.replace(token, "<redacted>")
        if red != msg:
            record.msg, record.args = red, None
        return True


_REDACTOR = _RedactBotToken()
for _name in ("httpx", "httpcore"):
    _lg = logging.getLogger(_name)
    if not any(isinstance(f, _RedactBotToken) for f in _lg.filters):
        _lg.addFilter(_REDACTOR)

API_BASE = "https://api.telegram.org"
TIMEOUT_S = 5.0
MAX_TEXT = 3800           # Telegram's hard limit is 4096 characters
MAX_PER_MINUTE = 20       # messages per process per rolling minute (all chats together)

_sent_at: List[float] = []


def _config() -> Tuple[str, List[str]]:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chats = [c.strip() for c in os.environ.get("TELEGRAM_ALERT_CHAT_IDS", "").split(",") if c.strip()]
    return token, chats


def configured() -> bool:
    token, chats = _config()
    return bool(token and chats)


def _clip(text: Any) -> str:
    s = text if isinstance(text, str) else str(text or "")
    s = s.strip()
    if len(s) > MAX_TEXT:
        s = s[: MAX_TEXT - 1].rstrip() + "…"
    return s


def _take_budget(n: int, now: Optional[float] = None) -> bool:
    """Reserve n sends in the rolling one-minute window. False when the ceiling is hit."""
    t = time.monotonic() if now is None else now
    while _sent_at and t - _sent_at[0] > 60.0:
        _sent_at.pop(0)
    if len(_sent_at) + n > MAX_PER_MINUTE:
        return False
    _sent_at.extend([t] * n)
    return True


def reset_budget() -> None:
    """Tests only."""
    _sent_at.clear()


async def _post_one(client: httpx.AsyncClient, token: str, chat_id: str, text: str) -> Optional[str]:
    """None on success, else a short error code (never the URL / exception text)."""
    try:
        resp = await client.post(
            f"{API_BASE}/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": text, "disable_web_page_preview": True},
        )
    except Exception as exc:  # noqa: BLE001 — network / TLS / timeout: name only (X5)
        logger.error("[events] telegram send failed: %s", type(exc).__name__)
        return type(exc).__name__
    if resp.status_code != 200:
        logger.error("[events] telegram send failed: http %s", resp.status_code)
        return f"http_{resp.status_code}"
    return None


async def send(text: Any, *, transport: Optional[httpx.AsyncBaseTransport] = None) -> Dict[str, Any]:
    """Send `text` to every configured chat. Never raises."""
    out: Dict[str, Any] = {"configured": False, "sent": 0, "chats": 0, "errors": []}
    try:
        body = _clip(text)
        if not body:
            return out
        token, chats = _config()
        out["chats"] = len(chats)
        if not token or not chats:
            logger.info("[events] telegram not configured, alert logged only: %s", body[:500])
            return out
        out["configured"] = True
        if not _take_budget(len(chats)):
            logger.error("[events] telegram per-minute ceiling reached, alert dropped (%d chars)", len(body))
            out["errors"].append("rate_limited")
            return out
        async with httpx.AsyncClient(timeout=httpx.Timeout(TIMEOUT_S), transport=transport) as client:
            try:
                results = await asyncio.wait_for(
                    asyncio.gather(*(_post_one(client, token, c, body) for c in chats)),
                    timeout=TIMEOUT_S,
                )
            except asyncio.TimeoutError:
                logger.error("[events] telegram send timed out after %.0f s", TIMEOUT_S)
                out["errors"].append("timeout")
                return out
        for err in results:
            if err is None:
                out["sent"] += 1
            else:
                out["errors"].append(err)
    except Exception as exc:  # noqa: BLE001 — alerts never break the caller
        logger.error("[events] telegram send crashed: %s", type(exc).__name__)
        out["errors"].append(type(exc).__name__)
    return out


def format_digest(title: str, lines: Sequence[Any]) -> str:
    body = [str(title or "").strip() or "AMO · agenda"]
    for ln in lines or ():
        s = str(ln if ln is not None else "").rstrip()
        body.append(s)
    return _clip("\n".join(body))


async def digest(title: str, lines: Sequence[Any], *,
                 transport: Optional[httpx.AsyncBaseTransport] = None) -> Dict[str, Any]:
    """One summary message (the sentinel's daily digest). Never raises."""
    try:
        text = format_digest(title, lines)
    except Exception as exc:  # noqa: BLE001
        logger.error("[events] telegram digest format failed: %s", type(exc).__name__)
        return {"configured": configured(), "sent": 0, "chats": 0, "errors": ["format_failed"]}
    return await send(text, transport=transport)
