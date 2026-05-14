"""
"Amo" — AI concierge agent for Amo Cartagena.

This module orchestrates a conversational agent that:
- Detects intent in any language (ES/EN/FR/PT).
- Calls "tools" (in reality, returns structured JSON actions that the backend executes
  and that the frontend can render as action buttons / deep links).
- Persists chat history per user in `chat_sessions` collection.

Tools available:
  - search_partners(category, subcategory, tier, query)
  - search_events(category, date_from, date_to, query)
  - show_today_events()
  - get_partner(partner_id)
  - open_partner(partner_id)              ← frontend deep link
  - open_event(event_id)                  ← frontend deep link
  - open_port_tax_checkout(qty, travel_date) ← frontend deep link → Wompi
  - open_city_pass(plan_id)               ← frontend deep link → Wompi
  - open_transport(transport_id)
  - get_daily_itinerary(category)         ← reuses ai_itinerary
  - navigate(screen)                      ← deep link to a tab
  - external_link(url, label)             ← e.g. partner website / WhatsApp
  - reservation_link(partner_id)          ← opens partner.booking_link

Responses are returned as:
  {
    "message": "<conversational reply in user's language>",
    "language": "es" | "en" | "fr" | "pt",
    "actions": [{"type": "...", ...}],
    "suggestions": ["short reply 1", "short reply 2"]  # quick replies
  }
"""

from __future__ import annotations

import os
import json
import logging
import uuid
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


AGENT_NAME = "Amo"
AGENT_BIO = (
    "Soy Amo, el concierge digital de Cartagena. Hablo español, inglés, francés y portugués. "
    "Conozco cada rincón de la ciudad: agenda cultural, restaurantes, hoteles, beach clubs, "
    "transporte a las islas (Tasa Portuaria), City Pass y eventos del día."
)

# ────────────────────────────────────────────────
# Context builders — pull a slim snapshot of the DB
# ────────────────────────────────────────────────

async def _slim_partners(db, limit: int = 30) -> List[Dict[str, Any]]:
    cursor = db.partners.find({}, {
        "_id": 0, "partner_id": 1, "name": 1, "category": 1, "subcategory": 1,
        "tier": 1, "price_range": 1, "address": 1, "cuisine": 1, "rating": 1,
        "is_government": 1,
    }).limit(limit)
    return await cursor.to_list(limit)


async def _slim_today_events(db, limit: int = 20) -> List[Dict[str, Any]]:
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    cursor = db.events.find(
        {"date": {"$gte": today_str}},
        {"_id": 0, "event_id": 1, "title": 1, "type": 1, "date": 1, "time": 1, "venue_name": 1, "category": 1, "price": 1},
    ).sort("date", 1).limit(limit)
    return await cursor.to_list(limit)


async def _port_tax_price(db) -> int:
    cfg = await db.port_tax_config.find_one({"active": True}, {"_id": 0, "price_per_person": 1})
    return int((cfg or {}).get("price_per_person", 31500))


async def build_context_snapshot(db, user: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Pull the data the agent needs to reason about."""
    partners = await _slim_partners(db, 40)
    events = await _slim_today_events(db, 25)
    port_tax_price = await _port_tax_price(db)
    has_pass = False
    if user and user.get("user_id"):
        cnt = await db.city_passes.count_documents({"user_id": user["user_id"], "is_active": True})
        has_pass = cnt > 0
    return {
        "today": datetime.now(timezone.utc).strftime("%A %Y-%m-%d"),
        "user": {"name": (user or {}).get("name"), "is_logged_in": bool(user), "has_active_city_pass": has_pass} if user else {"is_logged_in": False},
        "port_tax_price_cop": port_tax_price,
        "city_pass_plans": [
            {"plan_id": "pass_basic", "name": "Explorer", "price_cop": 99000},
            {"plan_id": "pass_classic", "name": "Classic", "price_cop": 200000},
            {"plan_id": "pass_premium", "name": "Premium", "price_cop": 350000},
            {"plan_id": "pass_ultimate", "name": "Ultimate", "price_cop": 599000},
        ],
        "partner_categories": ["restaurant", "hotel", "beach_club", "nightclub", "wellness", "tour", "transport"],
        "partner_sample": partners[:25],
        "today_events": events[:20],
        "tabs": ["agenda", "concerts", "partners", "citypass", "transport", "itineraries"],
    }


# ────────────────────────────────────────────────
# Session management
# ────────────────────────────────────────────────

async def get_or_create_session(db, user_id: Optional[str], session_id: Optional[str]) -> Dict[str, Any]:
    if session_id:
        s = await db.chat_sessions.find_one({"session_id": session_id}, {"_id": 0})
        if s:
            return s
    sid = session_id or f"chat_{uuid.uuid4().hex[:12]}"
    doc = {
        "session_id": sid,
        "user_id": user_id,
        "title": "Nuevo chat",
        "messages": [],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.chat_sessions.insert_one(dict(doc))
    return doc


async def append_messages(db, session_id: str, user_msg: Dict[str, Any], assistant_msg: Dict[str, Any]):
    await db.chat_sessions.update_one(
        {"session_id": session_id},
        {
            "$push": {"messages": {"$each": [user_msg, assistant_msg]}},
            "$set": {"updated_at": datetime.now(timezone.utc).isoformat()},
        },
    )


# ────────────────────────────────────────────────
# LLM call (structured JSON via Emergent LLM Key)
# ────────────────────────────────────────────────

SYSTEM_PROMPT = """Eres "Amo", el concierge digital oficial de la app Amo Cartagena (Cartagena de Indias, Colombia).
Hablás como un guía local cartagenero: cálido, conocedor, profesional, jamás repetitivo.

REGLAS DE IDIOMA: Detectá el idioma del último mensaje del usuario y respondé en ese mismo idioma (ES, EN, FR o PT). Si el usuario cambia de idioma, vos también.

TU TRABAJO:
- Recomendás eventos, restaurantes, hoteles, beach clubs, paseos a las islas.
- Iniciás compras (Tasa Portuaria, City Pass) cuando el usuario lo pide claramente.
- Si el usuario pregunta algo general de Cartagena (historia, clima, seguridad) respondés con conocimiento local.
- NUNCA inventés precios o partners. Solo recomendá los que aparecen en el `context.partner_sample` o `context.today_events`. Si no hay match, sugerí navegar a la pestaña adecuada.
- Si la consulta es ambigua, hacé UNA pregunta corta de aclaración (ej: "¿Para cuántas personas?").

FORMATO DE RESPUESTA (JSON estricto, sin markdown, sin código de bloque):
{
  "message": "<respuesta conversacional, máximo 3 frases, en el idioma del usuario>",
  "language": "<es|en|fr|pt>",
  "actions": [
    // 0 a 4 acciones que el frontend convertirá en botones / deep links
    // Tipos disponibles:
    // {"type": "show_partners", "filters": {"category": "restaurant", "subcategory": "italiana", "tier": "premium"}, "label": "Ver restaurantes italianos"}
    // {"type": "show_events", "filters": {"category": "music", "date": "2026-05-15"}, "label": "Ver eventos"}
    // {"type": "open_partner", "partner_id": "ptr_002", "label": "Ver Bellini"}
    // {"type": "open_event", "event_id": "evt_xxx", "label": "Ver detalle"}
    // {"type": "open_port_tax_checkout", "qty": 2, "travel_date": "2026-05-15", "label": "Comprar Tasa Portuaria"}
    // {"type": "open_city_pass", "plan_id": "pass_premium", "label": "Comprar Premium Pass"}
    // {"type": "navigate", "screen": "agenda" | "concerts" | "partners" | "citypass" | "transport" | "itineraries", "label": "Ir a Agenda"}
    // {"type": "reservation_link", "partner_id": "ptr_002", "label": "Reservar mesa"}
    // {"type": "show_itinerary", "category": "cultura" | "lifestyle" | "musical", "label": "Itinerario cultural del día"}
  ],
  "suggestions": ["<pregunta rápida 1>", "<pregunta rápida 2>", "<pregunta rápida 3>"]
}

EJEMPLOS DE COMPORTAMIENTO:
- "Quiero comer italiano hoy" → message ofreciendo opciones del context, actions=[{show_partners filters italian}, {open_partner ptr_X}].
- "Cuánto cuesta ir a Barú?" → message explicando Tasa Portuaria $31.500 COP/persona, actions=[{open_port_tax_checkout}].
- "Bonjour, je veux voir un concert ce soir" → responde en francés, propone eventos de música.
- "Hola, qué tal?" → saludo cálido + 3 suggestions concretas.
- Si user no logueado y quiere comprar → message dice que se loguee primero, action={navigate: "citypass"}.

NUNCA pongás acciones que no estén en la lista de tipos disponibles. NUNCA pongás más de 4 actions. NUNCA respondas con markdown. SIEMPRE JSON válido."""


def _strip_json_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("```")[1] if "```" in text[3:] else text
        if text.startswith("json"):
            text = text[4:]
    return text.strip()


def _safe_json_parse(text: str) -> Optional[Dict[str, Any]]:
    """Try to parse JSON, with several fallbacks."""
    try:
        return json.loads(text)
    except Exception:
        pass
    # Try stripping fences
    cleaned = _strip_json_fences(text)
    try:
        return json.loads(cleaned)
    except Exception:
        pass
    # Try to extract the first {...} block
    m = re.search(r"\{[\s\S]+\}", cleaned)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            return None
    return None


def _fallback_response(user_text: str) -> Dict[str, Any]:
    """If the LLM fails, return a useful canned response."""
    t = (user_text or "").lower()
    lang = "es"
    if any(w in t for w in ["hello", "hi ", "hi.", "the ", "where", "how"]):
        lang = "en"
    elif any(w in t for w in ["bonjour", "salut", "où", "comment"]):
        lang = "fr"
    elif any(w in t for w in ["olá", "como", "onde"]):
        lang = "pt"
    msg = {
        "es": "Soy Amo, tu concierge de Cartagena. ¿Querés ver la agenda de hoy, restaurantes, conciertos o un paseo a las islas?",
        "en": "I'm Amo, your Cartagena concierge. Want to see today's agenda, restaurants, concerts or a boat ride to the islands?",
        "fr": "Je suis Amo, votre concierge à Carthagène. Voulez-vous voir l'agenda du jour, les restaurants, les concerts ou une sortie aux îles ?",
        "pt": "Sou Amo, seu concierge em Cartagena. Quer ver a agenda de hoje, restaurantes, shows ou um passeio às ilhas?",
    }[lang]
    return {
        "message": msg,
        "language": lang,
        "actions": [
            {"type": "navigate", "screen": "agenda", "label": {"es": "Ver agenda", "en": "See agenda", "fr": "Voir l'agenda", "pt": "Ver agenda"}[lang]},
            {"type": "navigate", "screen": "partners", "label": {"es": "Ver partners", "en": "See partners", "fr": "Voir partenaires", "pt": "Ver parceiros"}[lang]},
            {"type": "navigate", "screen": "citypass", "label": "City Pass"},
        ],
        "suggestions": {
            "es": ["¿Qué hay esta noche?", "Comer mariscos", "Ir a las islas mañana"],
            "en": ["What's on tonight?", "Find seafood", "Visit the islands"],
            "fr": ["Que faire ce soir ?", "Trouver des fruits de mer", "Aller aux îles"],
            "pt": ["O que tem hoje à noite?", "Frutos do mar", "Ir às ilhas"],
        }[lang],
    }


# Allowed action types — we sanitize the LLM output
ALLOWED_ACTIONS = {
    "show_partners",
    "show_events",
    "open_partner",
    "open_event",
    "open_port_tax_checkout",
    "open_city_pass",
    "navigate",
    "reservation_link",
    "show_itinerary",
    "external_link",
}
ALLOWED_TABS = {"agenda", "concerts", "partners", "citypass", "transport", "itineraries", "search"}


def _sanitize_actions(actions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for a in actions or []:
        if not isinstance(a, dict):
            continue
        t = a.get("type")
        if t not in ALLOWED_ACTIONS:
            continue
        if t == "navigate":
            screen = a.get("screen")
            if screen not in ALLOWED_TABS:
                continue
        out.append(a)
        if len(out) >= 4:
            break
    return out


async def run_agent_turn(
    db,
    *,
    user: Optional[Dict[str, Any]],
    user_text: str,
    history: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """One turn of the conversational agent. Returns the assistant payload."""

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore
    except Exception as exc:
        logger.warning(f"emergentintegrations unavailable for ai_agent: {exc}")
        return _fallback_response(user_text)

    api_key = os.environ.get("EMERGENT_LLM_KEY", "").strip()
    if not api_key:
        return _fallback_response(user_text)

    context = await build_context_snapshot(db, user=user)

    # Compress history to last 10 user/assistant pairs
    short_history = history[-20:] if isinstance(history, list) else []

    # Build the user payload as a single JSON string. We send it all as one
    # UserMessage, since LlmChat manages session state internally.
    user_payload = {
        "now": context["today"],
        "context": context,
        "history": short_history,
        "user_message": user_text,
    }

    try:
        chat = LlmChat(
            api_key=api_key,
            session_id=f"amo-agent-{uuid.uuid4().hex[:10]}",
            system_message=SYSTEM_PROMPT,
        )
        chat.with_model("openai", "gpt-4o-mini")
        response = await chat.send_message(UserMessage(text=json.dumps(user_payload, ensure_ascii=False)))
    except Exception as exc:
        logger.warning(f"ai_agent LLM call failed: {exc}")
        return _fallback_response(user_text)

    parsed = _safe_json_parse(response or "")
    if not parsed or not isinstance(parsed, dict):
        return _fallback_response(user_text)

    # Validate keys
    message = (parsed.get("message") or "").strip()
    if not message:
        return _fallback_response(user_text)
    language = parsed.get("language") or "es"
    if language not in {"es", "en", "fr", "pt"}:
        language = "es"
    actions = _sanitize_actions(parsed.get("actions") or [])
    suggestions = [str(s)[:80] for s in (parsed.get("suggestions") or [])[:4] if s]

    return {
        "message": message,
        "language": language,
        "actions": actions,
        "suggestions": suggestions,
    }
