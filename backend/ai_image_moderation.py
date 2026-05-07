"""AI-powered image moderation for partner uploads (flyers, profile images).

Uses Emergent LLM Key + emergentintegrations multimodal (gpt-4o-mini)
to validate that uploaded images are appropriate for a city app.
"""
import os
import json
import logging
import uuid
import base64
import tempfile

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are reviewing images uploaded by partners (restaurants, clubs, hotels, beach clubs)
of "Amo Cartagena", a tourism app for Cartagena, Colombia.

Your job: decide if this image is appropriate for use as an event flyer or business profile picture.

Rules:
- REJECT: nudity, sexual content, drugs, violence, gore, hate symbols, watermarks of competing brands, blurred/illegible text in the main subject.
- NEEDS_REVIEW: low quality (very dark, blurry), text in another language we can't validate, ambiguous content.
- AUTO_APPROVE: clean, professional, fits a tourism context.

Also extract:
- A 1-line caption in Spanish describing what's in the image
- 3-6 visual tags (e.g. "sunset","beach","cocktail","interior","food","nightlife","yoga","artisan")
- Suggested usage: "flyer" | "profile" | "either"

Respond ONLY in valid JSON:
{
  "verdict": "AUTO_APPROVE" | "NEEDS_REVIEW" | "REJECT",
  "caption": "...",
  "tags": ["..."],
  "suggested_usage": "...",
  "reason": "1-line in Spanish",
  "issues": ["..."]
}"""


async def moderate_image_base64(b64_data: str, mime: str = "image/jpeg") -> dict:
    """Run AI moderation on a base64-encoded image and return verdict."""
    fallback = {
        "verdict": "NEEDS_REVIEW",
        "caption": "",
        "tags": [],
        "suggested_usage": "either",
        "reason": "Moderación de imagen no disponible — revisar manualmente",
        "issues": ["llm_unavailable"],
    }

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent  # type: ignore
    except Exception as e:
        logger.warning(f"emergentintegrations unavailable: {e}")
        return fallback

    api_key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not api_key:
        logger.warning("EMERGENT_LLM_KEY not set")
        return fallback

    try:
        chat = LlmChat(
            api_key=api_key,
            session_id=f"img_mod_{uuid.uuid4().hex[:10]}",
            system_message=SYSTEM_PROMPT,
        ).with_model("openai", "gpt-4o-mini")

        # ImageContent expects base64 (no prefix)
        clean_b64 = b64_data
        if "," in clean_b64 and clean_b64.startswith("data:"):
            clean_b64 = clean_b64.split(",", 1)[1]

        image_content = ImageContent(image_base64=clean_b64)
        message = UserMessage(
            text="Review this image and respond in JSON only.",
            file_contents=[image_content],
        )
        response = await chat.send_message(message)
        raw = (response or "").strip()

        if raw.startswith("```"):
            raw = raw.strip("`")
            if raw.lower().startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            raw = raw[start : end + 1]

        parsed = json.loads(raw)
        verdict = parsed.get("verdict", "NEEDS_REVIEW")
        if verdict not in ("AUTO_APPROVE", "NEEDS_REVIEW", "REJECT"):
            verdict = "NEEDS_REVIEW"
        return {
            "verdict": verdict,
            "caption": parsed.get("caption", "") or "",
            "tags": parsed.get("tags", []) or [],
            "suggested_usage": parsed.get("suggested_usage", "either"),
            "reason": parsed.get("reason", "") or "",
            "issues": parsed.get("issues", []) or [],
        }
    except Exception as e:
        logger.error(f"Image moderation failed: {e}")
        fallback["reason"] = f"Error: {str(e)[:120]}"
        return fallback
