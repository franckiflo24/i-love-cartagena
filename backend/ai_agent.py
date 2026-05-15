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
# Context builders — pull a smart snapshot of the DB
# ────────────────────────────────────────────────

# Spanish/English/Portuguese/French keyword → canonical filter
KEYWORD_FILTERS: Dict[str, Dict[str, Any]] = {
    # Cuisines
    "italian": {"subcategory": "italiana"}, "italiana": {"subcategory": "italiana"},
    "italien": {"subcategory": "italiana"}, "italienne": {"subcategory": "italiana"},
    "italiano": {"subcategory": "italiana"},
    "japanese": {"subcategory": "asiatica"}, "japonesa": {"subcategory": "asiatica"},
    "asian": {"subcategory": "asiatica"}, "asiatica": {"subcategory": "asiatica"},
    "asiática": {"subcategory": "asiatica"}, "asiatique": {"subcategory": "asiatica"},
    "sushi": {"subcategory": "asiatica"},
    "marisco": {"subcategory": "mariscos"}, "mariscos": {"subcategory": "mariscos"},
    "seafood": {"subcategory": "mariscos"}, "frutos do mar": {"subcategory": "mariscos"},
    "fruits de mer": {"subcategory": "mariscos"}, "fish": {"subcategory": "mariscos"},
    "ceviche": {"subcategory": "mariscos"},
    "vegetarian": {"subcategory": "vegetariana"}, "vegana": {"subcategory": "vegetariana"},
    "vegano": {"subcategory": "vegetariana"}, "vegetariana": {"subcategory": "vegetariana"},
    "végétarien": {"subcategory": "vegetariana"}, "vegano": {"subcategory": "vegetariana"},
    "arab": {"subcategory": "arabe"}, "árabe": {"subcategory": "arabe"},
    "arabe": {"subcategory": "arabe"}, "libanesa": {"subcategory": "arabe"},
    "gastro": {"subcategory": "gastro"}, "gourmet": {"subcategory": "gastro"},
    "international": {"subcategory": "internacional"}, "internacional": {"subcategory": "internacional"},
    "internacional": {"subcategory": "internacional"},
    "local": {"subcategory": "local"}, "típica": {"subcategory": "local"},
    "tipica": {"subcategory": "local"}, "criolla": {"subcategory": "local"},
    "colombiana": {"subcategory": "local"},
    # Categories
    "restaurant": {"category": "restaurant"}, "restaurante": {"category": "restaurant"},
    "restaurants": {"category": "restaurant"}, "comer": {"category": "restaurant"},
    "comida": {"category": "restaurant"}, "eat": {"category": "restaurant"},
    "manger": {"category": "restaurant"}, "dîner": {"category": "restaurant"},
    "almuerzo": {"category": "restaurant"}, "lunch": {"category": "restaurant"},
    "cena": {"category": "restaurant"}, "dinner": {"category": "restaurant"},
    "hotel": {"category": "hotel"}, "hoteles": {"category": "hotel"},
    "hotels": {"category": "hotel"}, "hôtel": {"category": "hotel"}, "hostel": {"category": "hotel"},
    "alojamiento": {"category": "hotel"}, "stay": {"category": "hotel"}, "logement": {"category": "hotel"},
    "beach": {"category": "beach_club"}, "playa": {"category": "beach_club"},
    "praia": {"category": "beach_club"}, "plage": {"category": "beach_club"},
    "beach club": {"category": "beach_club"}, "beach_club": {"category": "beach_club"},
    "isla": {"category": "tour"}, "islas": {"category": "tour"}, "island": {"category": "tour"},
    "islands": {"category": "tour"}, "îles": {"category": "tour"}, "ilha": {"category": "tour"},
    "baru": {"category": "tour"}, "barú": {"category": "tour"}, "rosario": {"category": "tour"},
    "wellness": {"category": "wellness"}, "spa": {"category": "wellness"}, "yoga": {"category": "wellness"},
    "massage": {"category": "wellness"}, "masaje": {"category": "wellness"},
    "fiesta": {"category": "nightclub"}, "party": {"category": "nightclub"},
    "fête": {"category": "nightclub"}, "festa": {"category": "nightclub"},
    "club": {"category": "nightclub"}, "discoteca": {"category": "nightclub"},
    "night": {"category": "nightclub"}, "noche": {"category": "nightclub"},
    # Tiers
    "luxury": {"tier": "luxe"}, "lujo": {"tier": "luxe"}, "luxe": {"tier": "luxe"},
    "luxo": {"tier": "luxe"}, "alto": {"tier": "luxe"},
    "premium": {"tier": "premium"},
    "popular": {"tier": "popular"}, "barato": {"tier": "popular"},
    "económico": {"tier": "popular"}, "cheap": {"tier": "popular"},
    "elite": {"tier": "elite"}, "élite": {"tier": "elite"},
    # Music / events
    "music": {"event_category": "music"}, "música": {"event_category": "music"},
    "musique": {"event_category": "music"}, "concierto": {"event_category": "music"},
    "concert": {"event_category": "music"}, "show": {"event_category": "music"},
    "sunset": {"event_category": "sunset", "vibe": "sunset"}, "atardecer": {"event_category": "sunset", "vibe": "sunset"},
    "coucher de soleil": {"event_category": "sunset", "vibe": "sunset"}, "pôr do sol": {"event_category": "sunset", "vibe": "sunset"},
    "pasa día": {"event_category": "daypass"}, "passa o dia": {"event_category": "daypass"},
    "day pass": {"event_category": "daypass"}, "journée": {"event_category": "daypass"},
    "cultura": {"event_category": "culture"}, "culture": {"event_category": "culture"},
    "arte": {"event_category": "culture"}, "art": {"event_category": "culture"},
    # Rooftop / aperitivo / vista al mar
    "rooftop": {"vibe": "rooftop"}, "terraza": {"vibe": "rooftop"}, "terrasse": {"vibe": "rooftop"},
    "azotea": {"vibe": "rooftop"}, "skybar": {"vibe": "rooftop"}, "terraço": {"vibe": "rooftop"},
    "apero": {"vibe": "aperitivo"}, "apéro": {"vibe": "aperitivo"}, "aperitivo": {"vibe": "aperitivo"},
    "aperitif": {"vibe": "aperitivo"}, "aperitif's": {"vibe": "aperitivo"}, "happy hour": {"vibe": "aperitivo"},
    "drinks": {"category": "bar", "vibe": "aperitivo"}, "tragos": {"category": "bar", "vibe": "aperitivo"},
    "cocktail": {"category": "bar"}, "cocktails": {"category": "bar"}, "coctel": {"category": "bar"},
    "cócteles": {"category": "bar"}, "bar": {"category": "bar"}, "bares": {"category": "bar"},
    "vista al mar": {"vibe": "sea_view"}, "vue mer": {"vibe": "sea_view"},
    "ocean view": {"vibe": "sea_view"}, "vista mar": {"vibe": "sea_view"},
}


def _extract_filters_from_text(text: str) -> Dict[str, Any]:
    """Use simple keyword matching to extract semantic filters from the user message."""
    t = (text or "").lower()
    filters: Dict[str, Any] = {}
    for kw, fil in KEYWORD_FILTERS.items():
        if kw in t:
            for k, v in fil.items():
                if k not in filters:
                    filters[k] = v
    return filters


async def _smart_partner_query(db, user_text: str, max_results: int = 50) -> List[Dict[str, Any]]:
    """
    Build a relevance-filtered partner list based on the user's question.

    1. Extract semantic filters (cuisine, category, tier, vibe) from the user message.
    2. Build a Mongo query honoring those filters.
    3. If no specific filter found, return a diverse top-50 sample.
    """
    fields = {
        "_id": 0, "partner_id": 1, "name": 1, "category": 1, "subcategory": 1,
        "tier": 1, "price_range": 1, "address": 1, "cuisine": 1, "rating": 1,
        "is_government": 1, "experience": 1, "instagram": 1, "booking_link": 1,
        "phone": 1, "schedule": 1, "features": 1,
    }
    semantic = _extract_filters_from_text(user_text)
    query: Dict[str, Any] = {}
    if "category" in semantic:
        query["category"] = semantic["category"]
    if "subcategory" in semantic:
        query["subcategory"] = semantic["subcategory"]
    if "tier" in semantic:
        query["tier"] = semantic["tier"]
    # ── Vibe-based fuzzy filter: rooftop / aperitivo / sunset / sea_view ──
    # We don't store a structured "vibe" field, so we match by regex over
    # name + experience + features + subcategory across multiple synonyms.
    vibe = semantic.get("vibe")
    if vibe:
        vibe_regex_map = {
            "rooftop": r"rooftop|terraza|terrasse|skybar|azotea|terra[cç]o|roof top|sky bar",
            "aperitivo": r"apero|ap[eé]ro|aperitivo|aperitif|happy hour|cocktail|coctel|bar|lounge",
            "sunset": r"sunset|atardecer|coucher de soleil|p[oô]r do sol|crep[uú]sculo|golden hour",
            "sea_view": r"vista al mar|sea view|ocean view|vue mer|vista mar|frente al mar|beachfront",
        }
        regex = vibe_regex_map.get(vibe)
        if regex:
            # OR across several text fields
            or_clause = [
                {"name": {"$regex": regex, "$options": "i"}},
                {"experience": {"$regex": regex, "$options": "i"}},
                {"subcategory": {"$regex": regex, "$options": "i"}},
                {"features": {"$regex": regex, "$options": "i"}},
                {"address": {"$regex": regex, "$options": "i"}},
            ]
            # Combine with existing category/tier constraints
            if query:
                query = {"$and": [query, {"$or": or_clause}]}
            else:
                query = {"$or": or_clause}
    free_text = (user_text or "").strip()
    if free_text and len(free_text) > 2 and not query:
        # Free text fallback (search across name + experience)
        query["$or"] = [
            {"name": {"$regex": free_text[:50], "$options": "i"}},
            {"experience": {"$regex": free_text[:50], "$options": "i"}},
        ]
    cursor = db.partners.find(query, fields).limit(max_results)
    rows = await cursor.to_list(max_results)
    # If query returned empty (no semantic match), fall back to a broader bar/restaurant pool
    # so the LLM still has lots of cards to pick from for "apero/sunset" style queries.
    if not rows and vibe in {"aperitivo", "sunset", "rooftop", "sea_view"}:
        cursor = db.partners.find(
            {"category": {"$in": ["bar", "beach_club", "nightclub", "restaurant"]}},
            fields,
        ).limit(max_results)
        rows = await cursor.to_list(max_results)
    if not rows:
        cursor = db.partners.find({}, fields).limit(max_results)
        rows = await cursor.to_list(max_results)
    return rows


async def _slim_all_partners_compact(db, limit: int = 200) -> List[Dict[str, Any]]:
    """Compact list of ALL partners — minimal fields, used as the 'master directory' the LLM scans."""
    cursor = db.partners.find({}, {
        "_id": 0, "partner_id": 1, "name": 1, "category": 1, "subcategory": 1,
        "tier": 1, "price_range": 1,
    }).limit(limit)
    return await cursor.to_list(limit)


async def _slim_upcoming_events(db, days: int = 14, limit: int = 60) -> List[Dict[str, Any]]:
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    cursor = db.events.find(
        {"date": {"$gte": today_str}},
        {"_id": 0, "event_id": 1, "title": 1, "type": 1, "date": 1, "time": 1,
         "venue_name": 1, "category": 1, "price": 1, "is_free": 1},
    ).sort("date", 1).limit(limit)
    return await cursor.to_list(limit)


async def _slim_partner_events(db, limit: int = 40) -> List[Dict[str, Any]]:
    """Pull upcoming partner-curated events (Daypass / Sunset / Cena especial / etc.)"""
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    cursor = db.partner_events.find(
        {"date": {"$gte": today_str}, "moderation_status": {"$in": ["approved", None]}},
        {"_id": 0, "event_id": 1, "title": 1, "date": 1, "time": 1, "partner_id": 1,
         "category": 1, "subcategory": 1, "price": 1, "is_free": 1},
    ).sort("date", 1).limit(limit)
    return await cursor.to_list(limit)


async def _port_tax_price(db) -> int:
    cfg = await db.port_tax_config.find_one({"active": True}, {"_id": 0, "price_per_person": 1})
    return int((cfg or {}).get("price_per_person", 31500))


async def build_context_snapshot(db, user: Optional[Dict[str, Any]] = None, user_text: str = "") -> Dict[str, Any]:
    """Pull the data the agent needs to reason about, focused on relevance to user_text."""
    # All partners, compact (directory)
    all_partners = await _slim_all_partners_compact(db, 200)
    # Relevance-filtered partners (rich data) — pre-filtered using simple keyword extraction
    relevant_partners = await _smart_partner_query(db, user_text, max_results=40)
    # Events
    upcoming_events = await _slim_upcoming_events(db, days=14, limit=50)
    partner_events = await _slim_partner_events(db, limit=30)
    port_tax_price = await _port_tax_price(db)
    has_pass = False
    if user and user.get("user_id"):
        cnt = await db.city_passes.count_documents({"user_id": user["user_id"], "is_active": True})
        has_pass = cnt > 0
    # Aggregate counts per category/subcategory so the LLM knows the full inventory
    cat_counts = await db.partners.aggregate([
        {"$group": {"_id": {"category": "$category", "subcategory": "$subcategory"}, "n": {"$sum": 1}}},
        {"$sort": {"n": -1}},
    ]).to_list(50)
    inventory_summary = [
        {"category": (r["_id"] or {}).get("category"), "subcategory": (r["_id"] or {}).get("subcategory"), "count": r["n"]}
        for r in cat_counts if r.get("_id")
    ]
    semantic_filters = _extract_filters_from_text(user_text)
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
        "inventory_summary": inventory_summary,  # counts per category/subcategory
        "semantic_filters_detected": semantic_filters,
        "relevant_partners": relevant_partners,  # rich data for top matches
        "all_partners_directory": all_partners,  # full catalog (compact)
        "upcoming_events": upcoming_events,
        "partner_curated_events": partner_events,  # daypass / sunset etc
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

══════════════════════════════════════════
🌐 REGLA CRÍTICA DE IDIOMA (NO NEGOCIABLE)
══════════════════════════════════════════
SIEMPRE detectá el idioma del ÚLTIMO mensaje del usuario y respondé EN EL MISMO IDIOMA.

- Si el usuario escribe en ESPAÑOL → respondé en español. language="es"
- Si el usuario escribe en INGLÉS (English) → respondé COMPLETAMENTE en inglés. language="en"
- Si el usuario escribe en FRANCÉS (Français) → respondé COMPLETAMENTE en francés. language="fr"
- Si el usuario escribe en PORTUGUÉS (Português) → respondé COMPLETAMENTE en portugués. language="pt"

Detectá el idioma por palabras clave universales:
- ES: hola, qué, dónde, cuándo, cómo, gracias, por favor, quiero, necesito, restaurante, isla
- EN: hi, hello, what, where, when, how, thanks, please, i want, i need, tonight, tomorrow, restaurant, island, beach
- FR: bonjour, salut, quoi, où, quand, comment, merci, je veux, je voudrais, ce soir, demain, restaurant, île, plage
- PT: olá, oi, o que, onde, quando, como, obrigado, eu quero, hoje à noite, amanhã, restaurante, ilha, praia

EJEMPLOS OBLIGATORIOS:
- User: "What can I do tonight in Cartagena?" → respondé en INGLÉS: "Tonight you can enjoy 'Jazz & Wine Night' at Bellini or a free 'Sunset Session' at La Muralla. Want me to show you more details?"
- User: "Bonjour, je veux aller aux îles demain" → respondé en FRANCÉS: "Bien sûr ! Le ticket Tasa Portuaria coûte 31.500 COP par personne. Pour combien de passagers ?"
- User: "Olá, quero comer frutos do mar" → respondé en PORTUGUÊS: "Ótimo! Te recomendo La Cevicheria ou Marea Restaurant. Quer ver mais detalhes?"

JAMÁS mezclés idiomas. JAMÁS respondas en español cuando el usuario habla otro idioma. Esto es CRÍTICO para turistas internacionales.

Si tenés DUDA del idioma (mensajes muy cortos como "ok", "hi"), mantené el idioma del MENSAJE ANTERIOR del usuario del historial. Si no hay historial, usá español por defecto.

══════════════════════════════════════════
TU TRABAJO
══════════════════════════════════════════
- Recomendás eventos, restaurantes, hoteles, beach clubs, paseos a las islas.
- Iniciás compras (Tasa Portuaria, City Pass) cuando el usuario lo pide claramente.
- Si el usuario pregunta algo general de Cartagena (historia, clima, seguridad) respondés con conocimiento local.
- ⚠️ **Usá EL CONTEXTO COMPLETO** que recibís en cada mensaje. Tenés:
  • `relevant_partners` (rich data): los 40 partners MÁS RELEVANTES para la consulta del usuario, pre-filtrados por el backend con keywords. **CITÁ partners de esta lista por nombre con su partner_id exacto.**
  • `all_partners_directory`: catálogo completo (200 partners en formato compacto) — usalo cuando `relevant_partners` no tenga match exacto.
  • `inventory_summary`: cuántos partners hay por categoría/subcategoría (ej: "hay 12 restaurantes italianos").
  • `semantic_filters_detected`: filtros que el backend detectó del mensaje del usuario.
  • `upcoming_events` (14 días) + `partner_curated_events` (Daypass/Sunset/Cenas especiales).
- **NUNCA INVENTÉS** partners o eventos. SOLO recomendá los que aparecen en el contexto.
- ⚠️ **OBLIGATORIO: GENERÁ MÍNIMO 5 TARJETAS y APUNTÁ A 6-8** en `recommendations` siempre que el catálogo lo permita (casi siempre). Mezclá libremente partners **Y** eventos en la misma lista cuando la consulta sea ambigua (ej: "apéro", "sunset", "rooftop", "cena", "donde salir").
- ⚠️ **NUNCA devuelvas 1 sola tarjeta** cuando el usuario pide ideas/sugerencias. Si solo hay 1 match perfecto, completá con 4-7 alternativas relevantes (mismo vibe, categoría parecida, partners cercanos, eventos del día, etc.).
- Variá los `tier`/`price_range` dentro de las tarjetas (mezclá popular/premium/luxe) para cubrir distintos presupuestos.
- Si no hay match preciso, sugerí explorar con `show_partners` filtrado o `navigate` al tab.
- Si la consulta es ambigua, hacé UNA pregunta corta de aclaración (ej: "¿Para cuántas personas?" / "How many people?" / "Pour combien de personnes ?").
- **PRECISIÓN > GENERALIDAD**. Si el usuario dice "italiano" y `relevant_partners` tiene 8 italianos, devolvé 5-8 tarjetas de esos italianos en `recommendations`, no digas "tenemos italianos" en general.

══════════════════════════════════════════
FORMATO DE RESPUESTA (JSON estricto, sin markdown, sin código de bloque)
══════════════════════════════════════════
{
  "message": "<respuesta conversacional, máximo 3 frases, EN EL IDIOMA DETECTADO DEL USUARIO>",
  "language": "<es|en|fr|pt>",
  "recommendations": [
    // 0 a 8 tarjetas ricas. Úsalas SIEMPRE que tengas matches del catálogo (partners o eventos).
    // Cada tarjeta DEBE tener partner_id O event_id real del contexto.
    // SUGERÍ AL MENOS 5 cuando haya matches suficientes para que el usuario tenga variedad.
    {
      "kind": "partner",                    // 'partner' o 'event'
      "partner_id": "ptr_R025",             // requerido si kind=partner
      "event_id": null,                     // requerido si kind=event
      "name": "Marea Restaurant",           // nombre real del contexto
      "type": "Mariscos · Premium",         // tipo de lugar (categoría · subcat · tier humano)
      "vibe": "Romántico con vista al mar", // 1 línea de "onda" (en idioma del usuario)
      "price_range": "$$$",                 // $, $$, $$$, $$$$ basado en tier (popular=$$, premium=$$$, luxe=$$$$)
      "address": "Calle del Arsenal",       // si está en contexto
      "reason": "Su ceviche es legendario y atardeceres únicos." // por qué lo recomendás (1 frase)
    }
  ],
  "actions": [
    // 0 a 4 acciones de navegación general (NO duplicar lo que ya está en recommendations).
    // Tipos disponibles:
    // {"type": "show_partners", "filters": {"category": "restaurant", "subcategory": "italiana", "tier": "premium"}, "label": "Ver todos los italianos"}
    // {"type": "show_events", "filters": {"category": "music", "date": "2026-05-15"}, "label": "Ver agenda"}
    // {"type": "open_port_tax_checkout", "qty": 2, "travel_date": "2026-05-15", "label": "Comprar Tasa Portuaria"}
    // {"type": "open_city_pass", "plan_id": "pass_premium", "label": "Comprar Premium Pass"}
    // {"type": "navigate", "screen": "agenda" | "concerts" | "partners" | "citypass" | "transport" | "itineraries", "label": "..."}
    // {"type": "show_itinerary", "category": "cultura" | "lifestyle" | "musical", "label": "..."}
  ],
  "suggestions": ["<3 quick-replies EN EL IDIOMA DETECTADO>"]
}

REGLAS DE recommendations:
- ⚠️ **DEBES proponer entre 5 y 8 tarjetas** cuando haya suficientes matches en `relevant_partners` o `all_partners_directory`.
- ⚠️ **PRECISIÓN MÁXIMA**: cada tarjeta apunta a un partner_id (o event_id) EXACTO del contexto. NUNCA inventés IDs.
- Variá los tiers para dar opciones de distintos presupuestos (1 popular + 2 premium + 1 luxe por ejemplo).
- `price_range`: derivá de `tier` → popular=$$, premium=$$$, luxe=$$$$, elite=$$$$$.
- `vibe` y `reason` SIEMPRE en el idioma detectado del usuario.
- Si la consulta es por evento (concert, sunset, daypass) usá kind="event" y event_id de `upcoming_events` o `partner_curated_events`.

EJEMPLOS DE COMPORTAMIENTO COMPLETOS:

ES: User: "Quiero comer italiano hoy"
{
  "message": "Tenemos varias opciones italianas según tu vibe y presupuesto. Mirá las recomendaciones:",
  "language": "es",
  "recommendations": [
    {"kind":"partner","partner_id":"ptr_R025","name":"Norma","type":"Italiana · Premium","vibe":"Romántico con pasta artesanal","price_range":"$$$","reason":"Ravioli de mariscos imperdible."},
    {"kind":"partner","partner_id":"ptr_R060","name":"Trattoria del Mare","type":"Italiana · Premium","vibe":"Casual con vista","price_range":"$$$","reason":"Pasta al mare con productos locales."},
    {"kind":"partner","partner_id":"ptr_R142","name":"Bellini","type":"Italiana · Premium","vibe":"Música en vivo","price_range":"$$$","reason":"Jazz & wine los jueves."},
    {"kind":"partner","partner_id":"ptr_R078","name":"Pizzeria Toscana","type":"Italiana · Popular","vibe":"Familiar y económico","price_range":"$$","reason":"Pizza al horno de leña, ideal para grupos."}
  ],
  "actions": [{"type":"show_partners","filters":{"category":"restaurant","subcategory":"italiana"},"label":"Ver todos los italianos"}],
  "suggestions": ["¿Para cuántas personas?", "Reservar mesa", "Otra cocina"]
}

EN: User: "What's on tonight?"
{
  "message": "Tonight you can enjoy Jazz & Wine Night at Bellini or a free Sunset Session at La Muralla. Want more details?",
  "language": "en",
  "actions": [{"type":"open_event","event_id":"evt_010","label":"Jazz & Wine Night"}],
  "suggestions": ["See full agenda", "Find a restaurant", "Book a tour"]
}

FR: User: "Je veux aller à Barú demain avec 3 amis"
{
  "message": "Parfait ! Pour aller à Barú vous devez payer la Tasa Portuaria : 31.500 COP par personne. Je peux lancer l'achat pour 4 personnes ?",
  "language": "fr",
  "actions": [{"type":"open_port_tax_checkout","qty":4,"travel_date":"2026-05-15","label":"Acheter Tasa Portuaria"}],
  "suggestions": ["Oui, acheter", "Voir tours organisés", "Autre date"]
}

PT: User: "Olá, o que tem hoje à noite?"
{
  "message": "Hoje à noite tem Jazz & Wine Night no Bellini ou a Sunset Session gratuita em La Muralla. Quer mais detalhes?",
  "language": "pt",
  "actions": [{"type":"open_event","event_id":"evt_010","label":"Ver Jazz & Wine"}],
  "suggestions": ["Ver agenda completa", "Encontrar restaurante", "Reservar tour"]
}

NUNCA pongás acciones que no estén en la lista de tipos disponibles. NUNCA pongás más de 4 actions. NUNCA respondas con markdown. SIEMPRE JSON válido. SIEMPRE en el idioma del usuario."""


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


def _fallback_response(user_text: str, forced_language: Optional[str] = None) -> Dict[str, Any]:
    """If the LLM fails, return a useful canned response."""
    t = (user_text or "").lower()
    lang = "es"  # default
    if forced_language and forced_language in {"es", "en", "fr", "pt"}:
        lang = forced_language
    else:
        # Strong detection: French first (most unique words), then PT, then EN, default ES
        if any(w in t for w in [" je ", "je v", "bonjour", "salut", "où", "comment", "où", "voudrais"]):
            lang = "fr"
        elif any(w in t for w in [" você", " olá", "obrigad", " quero ", "ilhas", "amanhã", "vegetarian"]):
            lang = "pt"
        elif any(w in t for w in [" the ", "where", "how ", "tonight", "tomorrow", "want to", " can ", " i "]):
            lang = "en"
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


def _sanitize_recommendations(recs: List[Dict[str, Any]], valid_partner_ids: set, valid_event_ids: set) -> List[Dict[str, Any]]:
    """Keep only recs that reference a real partner_id or event_id in the current context."""
    out: List[Dict[str, Any]] = []
    for r in recs or []:
        if not isinstance(r, dict):
            continue
        kind = r.get("kind") or ("partner" if r.get("partner_id") else "event" if r.get("event_id") else None)
        pid = r.get("partner_id")
        eid = r.get("event_id")
        if kind == "partner" and pid and pid in valid_partner_ids:
            out.append({
                "kind": "partner",
                "partner_id": pid,
                "name": str(r.get("name") or "")[:80],
                "type": str(r.get("type") or "")[:60],
                "vibe": str(r.get("vibe") or "")[:120],
                "price_range": str(r.get("price_range") or "")[:8],
                "address": str(r.get("address") or "")[:100],
                "reason": str(r.get("reason") or "")[:160],
            })
        elif kind == "event" and eid and eid in valid_event_ids:
            out.append({
                "kind": "event",
                "event_id": eid,
                "name": str(r.get("name") or "")[:80],
                "type": str(r.get("type") or "")[:60],
                "vibe": str(r.get("vibe") or "")[:120],
                "price_range": str(r.get("price_range") or "")[:8],
                "address": str(r.get("address") or "")[:100],
                "reason": str(r.get("reason") or "")[:160],
            })
        if len(out) >= 8:
            break
    return out


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
    forced_language: Optional[str] = None,
) -> Dict[str, Any]:
    """One turn of the conversational agent. Returns the assistant payload.

    `forced_language` (es|en|fr|pt) overrides the auto-detection: when the user
    has explicitly selected a UI language in the app, we honor it strictly so the
    concierge always answers in that language regardless of the message's language.
    """

    forced = (forced_language or "").lower().strip()
    if forced not in {"es", "en", "fr", "pt"}:
        forced = ""

    try:
        from emergentintegrations.llm.chat import LlmChat, UserMessage  # type: ignore
    except Exception as exc:
        logger.warning(f"emergentintegrations unavailable for ai_agent: {exc}")
        return _fallback_response(user_text, forced or None)

    api_key = os.environ.get("EMERGENT_LLM_KEY", "").strip()
    if not api_key:
        return _fallback_response(user_text, forced or None)

    context = await build_context_snapshot(db, user=user, user_text=user_text)

    # Compress history to last 10 user/assistant pairs
    short_history = history[-20:] if isinstance(history, list) else []

    # Build the user payload as a single JSON string. We send it all as one
    # UserMessage, since LlmChat manages session state internally.
    user_payload = {
        "now": context["today"],
        "context": context,
        "history": short_history,
        "user_message": user_text,
        "forced_language": forced or None,
        "instruction": (
            f"IMPORTANT: The user has selected language='{forced}' in the app settings. "
            f"You MUST answer in that language ({forced}) regardless of what language "
            f"the user typed in. All message text, action labels, and suggestions must "
            f"be in {forced}."
        ) if forced else None,
    }

    system_msg = SYSTEM_PROMPT
    if forced:
        lang_names = {"es": "Spanish", "en": "English", "fr": "French", "pt": "Portuguese"}
        system_msg = (
            f"⚠️ OVERRIDE: The app has language={forced} ({lang_names[forced]}) selected. "
            f"Ignore the language detection rules below — you MUST respond ONLY in {lang_names[forced]} "
            f"(language='{forced}') no matter what language the user types in. "
            f"Every word of the message, action labels, and suggestions MUST be in {lang_names[forced]}.\n\n"
            + SYSTEM_PROMPT
        )

    try:
        chat = LlmChat(
            api_key=api_key,
            session_id=f"amo-agent-{uuid.uuid4().hex[:10]}",
            system_message=system_msg,
        )
        chat.with_model("openai", "gpt-4o-mini")
        response = await chat.send_message(UserMessage(text=json.dumps(user_payload, ensure_ascii=False)))
    except Exception as exc:
        logger.warning(f"ai_agent LLM call failed: {exc}")
        return _fallback_response(user_text, forced or None)

    parsed = _safe_json_parse(response or "")
    if not parsed or not isinstance(parsed, dict):
        return _fallback_response(user_text, forced or None)

    # Validate keys
    message = (parsed.get("message") or "").strip()
    if not message:
        return _fallback_response(user_text, forced or None)
    language = parsed.get("language") or "es"
    if language not in {"es", "en", "fr", "pt"}:
        language = "es"
    # If we forced a language, lock it
    if forced:
        language = forced
    actions = _sanitize_actions(parsed.get("actions") or [])
    # Build valid IDs from context for sanitizing recommendations
    valid_partner_ids = {p.get("partner_id") for p in (context.get("relevant_partners") or [])}
    valid_partner_ids.update(p.get("partner_id") for p in (context.get("all_partners_directory") or []))
    valid_event_ids = {e.get("event_id") for e in (context.get("upcoming_events") or [])}
    valid_event_ids.update(e.get("event_id") for e in (context.get("partner_curated_events") or []))
    recommendations = _sanitize_recommendations(parsed.get("recommendations") or [], valid_partner_ids, valid_event_ids)
    suggestions = [str(s)[:80] for s in (parsed.get("suggestions") or [])[:4] if s]

    return {
        "message": message,
        "language": language,
        "actions": actions,
        "recommendations": recommendations,
        "suggestions": suggestions,
    }
