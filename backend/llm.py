"""
Provider-agnostic LLM helper for AMO Cartagena.

Decouples the app from the Emergent LLM proxy. Prefers the owner's own
Anthropic key (ANTHROPIC_API_KEY) via the official Anthropic SDK; falls back to
the legacy Emergent proxy (emergentintegrations + EMERGENT_LLM_KEY) only when
Anthropic is not configured, so the app keeps working during the migration.

Returns None when no provider is configured or the call fails — callers must
fall back to their non-AI path on None.
"""
import logging
import os
import uuid
from typing import Optional

logger = logging.getLogger(__name__)

# Cheap, fast default for classification/extraction. Override per call or via env.
DEFAULT_MODEL = os.environ.get("AMO_LLM_MODEL", "claude-haiku-4-5")

_anthropic_client = None


def _get_anthropic():
    """Lazily build (and cache) the async Anthropic client, or None if unconfigured."""
    global _anthropic_client
    if _anthropic_client is not None:
        return _anthropic_client
    api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not api_key:
        return None
    try:
        from anthropic import AsyncAnthropic
    except Exception as exc:  # SDK not installed
        logger.warning(f"anthropic SDK unavailable: {exc}")
        return None
    _anthropic_client = AsyncAnthropic(api_key=api_key)
    return _anthropic_client


async def llm_complete(
    system: str,
    user_text: str,
    *,
    model: Optional[str] = None,
    max_tokens: int = 1024,
) -> Optional[str]:
    """Send one system+user turn and return the model's text, or None on failure.

    Prefers the owner's Anthropic key; falls back to the Emergent proxy.
    """
    # 1. Preferred: owner-owned Anthropic key (official SDK).
    client = _get_anthropic()
    if client is not None:
        try:
            resp = await client.messages.create(
                model=model or DEFAULT_MODEL,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user_text}],
            )
            text = "".join(b.text for b in resp.content if b.type == "text")
            return text.strip()
        except Exception as exc:
            logger.warning(f"Anthropic LLM call failed: {exc}")
            return None

    # 2. Legacy fallback: Emergent proxy (remove once fully migrated off Emergent).
    api_key = os.environ.get("EMERGENT_LLM_KEY", "").strip()
    if not api_key:
        return None
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore

        chat = LlmChat(
            api_key=api_key,
            session_id=f"amo-{uuid.uuid4().hex[:10]}",
            system_message=system,
        )
        chat.with_model("openai", "gpt-4o-mini")
        return await chat.send_message(UserMessage(text=user_text))
    except Exception as exc:
        logger.warning(f"Emergent LLM fallback failed: {exc}")
        return None


async def llm_complete_image(
    system: str,
    user_text: str,
    image_b64: str,
    *,
    model: Optional[str] = None,
    max_tokens: int = 1024,
) -> Optional[str]:
    """Like llm_complete, but with one base64 image attached (vision).

    Accepts a raw base64 string or a `data:<mime>;base64,...` data URL.
    Returns None when no provider is configured or the call fails.
    """
    # Normalize: split off a data-URL prefix and recover the media type if present.
    media_type = "image/jpeg"
    clean = image_b64
    if clean.startswith("data:") and "," in clean:
        header, clean = clean.split(",", 1)
        if ":" in header and ";" in header:
            media_type = header[header.index(":") + 1 : header.index(";")] or media_type

    # 1. Preferred: owner-owned Anthropic key (vision via image content block).
    client = _get_anthropic()
    if client is not None:
        try:
            resp = await client.messages.create(
                model=model or "claude-sonnet-4-6",
                max_tokens=max_tokens,
                system=system,
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": clean,
                            },
                        },
                        {"type": "text", "text": user_text},
                    ],
                }],
            )
            text = "".join(b.text for b in resp.content if b.type == "text")
            return text.strip()
        except Exception as exc:
            logger.warning(f"Anthropic vision call failed: {exc}")
            return None

    # 2. Legacy fallback: Emergent proxy.
    api_key = os.environ.get("EMERGENT_LLM_KEY", "").strip()
    if not api_key:
        return None
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent  # type: ignore

        chat = LlmChat(
            api_key=api_key,
            session_id=f"amo-img-{uuid.uuid4().hex[:10]}",
            system_message=system,
        )
        chat.with_model("openai", "gpt-4o-mini")
        message = UserMessage(text=user_text, file_contents=[ImageContent(image_base64=clean)])
        return await chat.send_message(message)
    except Exception as exc:
        logger.warning(f"Emergent vision fallback failed: {exc}")
        return None
