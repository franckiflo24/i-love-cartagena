"""AI-powered content moderation for partner events.

Uses Emergent LLM Key + emergentintegrations to:
  1. Validate appropriateness (no inappropriate content)
  2. Auto-correct category if it's clearly wrong
  3. Auto-improve description if too short / unclear
  4. Decide: AUTO_APPROVE | NEEDS_REVIEW | REJECT
"""
import os
import json
import logging
import uuid
from typing import Optional

logger = logging.getLogger(__name__)

VALID_CATEGORIES = ["gastronomy", "music", "party", "wellness", "art", "popup"]

SYSTEM_PROMPT = """You are the AI content moderator for "Amo Cartagena", a city-experience app for tourists in Cartagena, Colombia.
Your job is to review event listings published by local partners (restaurants, clubs, hotels, beach clubs, wellness centers).

IMPORTANT — structured fields: the event's date, start time, end time, price (or free entry) and booking link are captured as SEPARATE STRUCTURED FORM FIELDS and are always displayed to users from those fields. They are provided to you below as "Structured data". NEVER lower the completeness score, flag an issue, or return NEEDS_REVIEW because the description text does not repeat the date, schedule, hours, price, or entry conditions — that information is guaranteed by the form. Completeness measures only how well the description explains WHAT the event is (atmosphere, lineup, activity, audience).

For each event, you must:
1. Detect any inappropriate content (drugs, sexual content, violence, hate speech, scams).
2. Classify it into ONE of these categories: gastronomy, music, party, wellness, art, popup.
3. Score completeness of the description (0-100) — content quality only, per the structured-fields rule above.
4. Decide a verdict: AUTO_APPROVE / NEEDS_REVIEW / REJECT.

Decision rules:
- REJECT: Inappropriate content (drugs/sexual/violence/hate/scams) or clearly fake. This is the ONLY verdict that blocks publication.
- NEEDS_REVIEW: Description too vague (<60), or partner-stated category is wrong AND you're unsure of correct one, or borderline content. The event is STILL PUBLISHED — this verdict only flags it for an optional human spot-check, so reserve it for genuine doubts.
- AUTO_APPROVE: Clean, complete, correct category.

You can SUGGEST a better category and a polished description. The system will auto-apply if verdict is AUTO_APPROVE.

Respond ONLY in valid JSON with this exact schema:
{
  "verdict": "AUTO_APPROVE" | "NEEDS_REVIEW" | "REJECT",
  "category": "gastronomy" | "music" | "party" | "wellness" | "art" | "popup",
  "category_changed": true|false,
  "completeness_score": 0-100,
  "improved_description": "polished version (if useful) or empty string",
  "tags": ["chill","elegant","family-friendly", ...],
  "reason": "1-line explanation in Spanish for the admin",
  "issues": ["list of issues found, empty if none"]
}"""


async def moderate_event(
    title: str,
    description: str,
    category: str,
    partner_name: str = "",
    date: str = "",
    start_time: str = "",
    end_time: str = "",
    price: int | None = None,
    is_free: bool = False,
    booking_link: str = "",
) -> dict:
    """Run AI moderation and return structured verdict.

    Returns a dict with at least:
      verdict, category, category_changed, completeness_score,
      improved_description, tags, reason, issues
    """
    fallback = {
        "verdict": "NEEDS_REVIEW",
        "category": category if category in VALID_CATEGORIES else "gastronomy",
        "category_changed": False,
        "completeness_score": 50,
        "improved_description": "",
        "tags": [],
        "reason": "Moderación IA no disponible — revisar manualmente",
        "issues": ["llm_unavailable"],
    }

    from llm import llm_complete

    if is_free:
        price_line = "Gratis (free entry)"
    elif price:
        price_line = f"{price:,} COP"
    else:
        price_line = "not specified"
    user_text = f"""Partner: {partner_name or 'unknown'}
Stated category: {category}
Title: {title}
Description: {description}

Structured data (already captured by the form — do NOT expect it in the description):
- Date: {date or 'not specified'}
- Start time: {start_time or 'not specified'}
- End time: {end_time or 'not specified'}
- Price/entry: {price_line}
- Booking link: {booking_link or 'none'}

Review and respond in JSON only."""

    try:
        # Moderation benefits from a stronger model than the cheap default.
        response = await llm_complete(SYSTEM_PROMPT, user_text, model="claude-sonnet-4-6")
        raw = (response or "").strip()

        # Strip code fences if present
        if raw.startswith("```"):
            raw = raw.strip("`")
            if raw.lower().startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        # Find first { and last } to safely extract JSON
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            raw = raw[start : end + 1]

        parsed = json.loads(raw)

        # Sanitize output
        verdict = parsed.get("verdict", "NEEDS_REVIEW")
        if verdict not in ("AUTO_APPROVE", "NEEDS_REVIEW", "REJECT"):
            verdict = "NEEDS_REVIEW"
        cat_out = parsed.get("category", category)
        if cat_out not in VALID_CATEGORIES:
            cat_out = category if category in VALID_CATEGORIES else "gastronomy"
        return {
            "verdict": verdict,
            "category": cat_out,
            "category_changed": bool(parsed.get("category_changed", cat_out != category)),
            "completeness_score": int(parsed.get("completeness_score", 50)),
            "improved_description": parsed.get("improved_description", "") or "",
            "tags": parsed.get("tags", []) or [],
            "reason": parsed.get("reason", "") or "",
            "issues": parsed.get("issues", []) or [],
        }
    except Exception as e:
        logger.error(f"AI moderation failed: {e}")
        fallback["reason"] = f"Error de moderación: {str(e)[:100]}"
        return fallback
