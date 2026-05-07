"""
AI User Profile Builder.
Uses Emergent LLM to analyze user favorites + behavior and generate a
detailed profile for personalized recommendations.
"""
import os
import json
import uuid
import logging
from typing import Optional

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an expert user-profiling AI for a Cartagena city app.

Given a user's favorited venues, partners, events, and saved agenda items,
generate a concise but rich profile in JSON ONLY (no markdown, no prose).

Return this exact schema:
{
  "persona_label": "short 2-4 word vibe label (e.g. 'Bon vivant Caribe', 'Foodie de noche')",
  "interests": ["3-6 short interest tags"],
  "vibe": ["energetic" | "chill" | "luxe" | "cultural" | "party" | "wellness" | "foodie"],
  "preferred_budget": "low" | "medium" | "premium" | "mixed",
  "preferred_categories": ["top categories from their behavior, max 4"],
  "preferred_time_slots": ["day" | "sunset" | "night" | "late_night"],
  "music_genres": ["genres seen in their concert favorites, max 4"],
  "summary": "2-3 sentence Spanish summary describing the user as a Cartagena traveler/local",
  "next_recommendations": ["3-5 short tags of things to recommend next"]
}

Be specific and use Spanish for the summary and persona_label.
Do NOT invent — if not enough data, lean on what is available and mark sparse fields with empty arrays."""


async def build_user_profile(
    user_id: str,
    favorites_data: list,   # list of dicts: {item_type, name, category, tier, price, genre, etc}
    calendar_data: list,    # list of saved agenda items
    locations_seen: list,   # list of categories or zone names where the user opened the map
) -> dict:
    """Build a detailed user profile via LLM. Returns dict with profile fields + metadata."""
    fallback = {
        "user_id": user_id,
        "persona_label": "Explorador Cartagena",
        "interests": [],
        "vibe": [],
        "preferred_budget": "mixed",
        "preferred_categories": [],
        "preferred_time_slots": [],
        "music_genres": [],
        "summary": "Perfil aún en construcción. Guarda más favoritos para personalizar tus recomendaciones.",
        "next_recommendations": [],
        "data_points": len(favorites_data) + len(calendar_data),
        "ai_status": "fallback",
    }

    if not favorites_data and not calendar_data:
        fallback["summary"] = "Aún no tienes favoritos. Empieza a guardar lugares y eventos para construir tu perfil personal."
        return fallback

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore
    except Exception as e:
        logger.warning(f"emergentintegrations unavailable: {e}")
        return fallback

    api_key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not api_key:
        logger.warning("EMERGENT_LLM_KEY not set")
        return fallback

    user_text = f"""User favorites ({len(favorites_data)} items):
{json.dumps(favorites_data, ensure_ascii=False)}

Saved agenda items ({len(calendar_data)} items):
{json.dumps(calendar_data, ensure_ascii=False)}

Map zones explored: {json.dumps(locations_seen, ensure_ascii=False)}

Generate the user profile JSON now."""

    try:
        chat = LlmChat(
            api_key=api_key,
            session_id=f"profile_{uuid.uuid4().hex[:10]}",
            system_message=SYSTEM_PROMPT,
        ).with_model("openai", "gpt-4.1-mini")

        response = await chat.send_message(UserMessage(text=user_text))
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
        # Merge with fallback to guarantee keys exist
        profile = {**fallback, **parsed}
        profile["user_id"] = user_id
        profile["data_points"] = len(favorites_data) + len(calendar_data)
        profile["ai_status"] = "ok"
        return profile
    except Exception as e:
        logger.error(f"AI user-profile failed: {e}")
        fallback["ai_status"] = f"error: {str(e)[:60]}"
        return fallback
