"""
AI-powered global search assistant for "Amo Cartagena".

- Receives a free-text query (in any language).
- Uses the Emergent LLM Key (gpt-4o-mini) to:
    • Detect the user's intent and the relevant entity types
      (partner / event / concert / transport / itinerary / city_pass / port_tax).
    • Generate a friendly 1-2 sentence answer in the user's language.
    • Pick the top 3 result IDs from the items we pass.

Falls back gracefully (returns plain regex matches with no AI answer) when:
  - The library isn't available.
  - EMERGENT_LLM_KEY is missing.
  - The LLM call fails or times out.
"""

import os
import json
import logging
import uuid
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

KNOWN_TYPES = {"partner", "event", "concert", "transport", "itinerary", "city_pass", "port_tax", "general"}


def _slim_partner(p: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": p.get("partner_id"),
        "type": "partner",
        "name": p.get("name"),
        "category": p.get("category"),
        "subcategory": p.get("subcategory"),
        "tier": p.get("tier"),
        "cuisine": p.get("cuisine"),
        "address": (p.get("address") or "")[:80],
        "rating": p.get("rating"),
        "price_range": p.get("price_range"),
    }


def _slim_event(e: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": e.get("event_id"),
        "type": "event",
        "title": e.get("title"),
        "category": e.get("category") or e.get("type"),
        "venue": e.get("venue_name") or e.get("venue"),
        "start_time": e.get("start_time") or e.get("start_at") or e.get("date"),
    }


def _slim_concert(c: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": c.get("concert_id"),
        "type": "concert",
        "title": c.get("title") or c.get("artist"),
        "artist": c.get("artist"),
        "genre": c.get("genre"),
        "venue": c.get("venue_name"),
        "date": c.get("date"),
    }


def _slim_transport(t: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": t.get("transport_id"),
        "type": "transport",
        "route": t.get("route"),
        "transport_type": t.get("type"),
        "departure_point": t.get("departure_point"),
    }


async def ai_search_answer(query: str, matches: Dict[str, List[Dict[str, Any]]]) -> Dict[str, Any]:
    """
    Build a smart answer payload for a search query.

    `matches` is a dict containing already-fetched candidates from MongoDB
    (regex matches) keyed by entity type: partners, events, concerts, venues,
    transport, partner_events.
    """
    # Default fallback shape — always return this if AI is unavailable.
    fallback = {
        "query": query,
        "intent": "general",
        "answer": "",
        "highlights": [],  # list of {type, id, reason}
    }

    if not query or len(query.strip()) < 2:
        return fallback

    # Build the items pool we'll show to the LLM (capped).
    pool: List[Dict[str, Any]] = []
    for p in matches.get("partners", [])[:8]:
        pool.append(_slim_partner(p))
    for e in matches.get("events", [])[:6]:
        pool.append(_slim_event(e))
    for c in matches.get("concerts", [])[:6]:
        pool.append(_slim_concert(c))
    for t in matches.get("transport", [])[:4]:
        pool.append(_slim_transport(t))
    for pe in matches.get("partner_events", [])[:4]:
        pool.append({
            "id": pe.get("event_id"),
            "type": "event",
            "title": pe.get("title"),
            "category": pe.get("category"),
            "venue": pe.get("partner_name"),
            "start_time": pe.get("start_time") or pe.get("date"),
        })

    # If nothing matched, we can still let the LLM suggest a category to browse.
    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore
    except Exception as exc:
        logger.warning(f"emergentintegrations unavailable for ai_search: {exc}")
        return fallback

    api_key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not api_key:
        return fallback

    system_prompt = (
        "Eres el asistente conversacional de la app 'Amo Cartagena'. "
        "Recibes una consulta libre del usuario y una lista de elementos disponibles. "
        "Tu trabajo es: "
        "1) detectar la intención principal (partner | event | concert | transport | "
        "itinerary | city_pass | port_tax | general), "
        "2) responder en máximo 2 frases breves y útiles, en el mismo idioma que la consulta, "
        "y 3) elegir hasta 3 ítems del pool que mejor respondan, devolviendo su id/type y una "
        "razón corta (<=10 palabras). "
        "Si la consulta menciona islas, lanchas, Bodeguita, Barú, Rosario → considera el módulo "
        "'port_tax' (tasa portuaria $31.500 COP / persona, módulo dentro de City Pass). "
        "Si menciona pase, pass, museos, descuentos → 'city_pass'. "
        "Si nada calza, intención='general' y sugiere una pestaña que ayude (Agenda / Conciertos / "
        "Partners / City Pass / Transporte). "
        "Devuelve SOLO JSON estricto con: "
        "{ intent, answer, suggested_tab (opcional), highlights: [{type, id, reason}] }."
    )

    user_payload = {"query": query, "pool": pool}

    try:
        chat = LlmChat(api_key=api_key, session_id=f"search-{uuid.uuid4().hex[:8]}",
                       system_message=system_prompt)
        chat.with_model("openai", "gpt-4o-mini")
        response = await chat.send_message(UserMessage(text=json.dumps(user_payload)))
    except Exception as exc:
        logger.warning(f"ai_search LLM call failed: {exc}")
        return fallback

    if not response:
        return fallback

    text = response.strip()
    # Strip code fences if any
    if text.startswith("```"):
        text = text.split("```")[1] if "```" in text[3:] else text
        if text.startswith("json"):
            text = text[4:]
    try:
        data = json.loads(text)
    except Exception:
        return {**fallback, "answer": text[:300]}

    intent = (data.get("intent") or "general").lower()
    if intent not in KNOWN_TYPES:
        intent = "general"
    highlights = []
    for h in (data.get("highlights") or [])[:3]:
        if isinstance(h, dict) and h.get("id") and h.get("type"):
            highlights.append({
                "type": str(h["type"]),
                "id": str(h["id"]),
                "reason": (h.get("reason") or "")[:120],
            })

    return {
        "query": query,
        "intent": intent,
        "answer": (data.get("answer") or "")[:300],
        "suggested_tab": (data.get("suggested_tab") or "")[:30] or None,
        "highlights": highlights,
    }
