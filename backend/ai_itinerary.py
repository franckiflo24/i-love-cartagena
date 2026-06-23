"""
AI Daily Itinerary Generator.
Uses Emergent LLM to curate a personalised daily route in Cartagena
based on the user's profile + favourites + location pings + available
partners and partner_events for the chosen category.
"""
import os
import json
import uuid
import logging
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)


CATEGORY_LABELS = {
    "lifestyle": "Lifestyle (gastronomía, beach, wellness, mixto del día)",
    "cultura":   "Cultura (historia, arte, museos, patrimonio, eventos culturales)",
    "musical":   "Musical (conciertos, DJ sets, fiestas, bares con música en vivo)",
}

SYSTEM_PROMPT = """Eres el curador oficial de rutas diarias de Amo Cartagena.

Tu trabajo: dado el perfil del usuario, sus favoritos y la lista de partners disponibles
para una categoría específica, devuelves UNA ruta del día con 4 a 6 paradas perfectamente
encadenadas en horario natural cartagenero (mañana → tarde → noche).

Devuelve JSON ESTRICTO sin markdown:
{
  "name": "Nombre creativo y corto de la ruta del día (max 6 palabras)",
  "description": "1-2 frases en español describiendo la propuesta personalizada",
  "category": "<lifestyle|cultura|musical>",
  "vibe_tags": ["3-5 tags cortos en español (ej: 'sunset', 'caribe', 'historia viva')"],
  "stops": [
    {
      "time": "HH:MM",
      "title": "Título de la parada",
      "venue": "Nombre real del partner (debe coincidir con uno de la lista)",
      "partner_id": "el partner_id si lo encuentras en la lista",
      "type": "wellness|gastro|culture|music|beach|nightlife|other",
      "duration_min": 60,
      "why": "1 frase en español: por qué este lugar es perfecto para ESTE usuario"
    }
  ],
  "personal_note": "Mensaje cálido en 1 frase dirigido al usuario por su persona/intereses"
}

Reglas estrictas:
1. SOLO usa partners que estén en la lista provista. No inventes nombres.
2. Si la categoría es 'cultura', prioriza venues de tipo museum/heritage/cultural; añade alguna comida ligera entre paradas.
3. Si la categoría es 'musical', termina la ruta con un evento o club nocturno; intercala cena.
4. Si la categoría es 'lifestyle', mezcla wellness AM, gastronomía/playa día, sunset y cena.
5. Personaliza según los favoritos y el persona_label si existen. Si NO hay datos, haz una ruta trending para un turista promedio.
6. Las paradas deben tener horarios coherentes (no 2 paradas a la misma hora, mínimo 60 min entre stops).
7. Responde SOLO el JSON, nada más."""


async def generate_itinerary(
    *,
    user_id: Optional[str],
    category: str,
    user_profile: Optional[Dict[str, Any]],
    favorites_data: List[Dict[str, Any]],
    partners_pool: List[Dict[str, Any]],   # available partners pre-filtered for the category
    today_events: List[Dict[str, Any]],     # partner_events happening today
    locale: str = "es",
) -> Dict[str, Any]:
    """Generate a personalised daily itinerary. Returns dict (never raises)."""
    cat = (category or "lifestyle").lower()
    if cat not in CATEGORY_LABELS:
        cat = "lifestyle"

    fallback = _fallback_itinerary(cat, partners_pool)

    from llm import llm_complete

    # Slim down payloads to keep prompt tight
    slim_partners = [
        {
            "partner_id": p.get("partner_id"),
            "name": p.get("name"),
            "category": p.get("category"),
            "subcategory": p.get("subcategory"),
            "tier": p.get("tier"),
            "address": p.get("address"),
            "experience": p.get("experience") or p.get("description", "")[:120],
            "price_range": p.get("price_range"),
        }
        for p in partners_pool[:25]
    ]
    slim_events = [
        {
            "event_id": e.get("event_id"),
            "title": e.get("title"),
            "venue": e.get("venue") or e.get("partner_name"),
            "start_time": e.get("start_time"),
            "category": e.get("category"),
            "is_free": e.get("is_free"),
            "price": e.get("price"),
        }
        for e in today_events[:10]
    ]

    profile_summary = "Sin perfil aún (usuario nuevo o invitado)."
    if user_profile:
        profile_summary = json.dumps(
            {
                "persona_label": user_profile.get("persona_label"),
                "interests": user_profile.get("interests"),
                "vibe": user_profile.get("vibe"),
                "preferred_budget": user_profile.get("preferred_budget"),
                "preferred_categories": user_profile.get("preferred_categories"),
                "preferred_time_slots": user_profile.get("preferred_time_slots"),
                "music_genres": user_profile.get("music_genres"),
                "summary": user_profile.get("summary"),
            },
            ensure_ascii=False,
        )

    fav_summary = json.dumps(
        [
            {
                "name": f.get("name"),
                "category": f.get("category"),
                "tier": f.get("tier"),
            }
            for f in favorites_data[:15]
        ],
        ensure_ascii=False,
    )

    user_text = f"""Categoría solicitada: {cat} — {CATEGORY_LABELS[cat]}

Perfil del usuario:
{profile_summary}

Favoritos del usuario (resumen):
{fav_summary}

Partners disponibles HOY para esta categoría (usa SOLO estos):
{json.dumps(slim_partners, ensure_ascii=False)}

Eventos de partners de HOY:
{json.dumps(slim_events, ensure_ascii=False)}

Genera la ruta del día en JSON estricto siguiendo el esquema indicado."""

    try:
        response = await llm_complete(SYSTEM_PROMPT, user_text)
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

        # Validate / patch result
        parsed.setdefault("name", fallback["name"])
        parsed.setdefault("description", fallback["description"])
        parsed["category"] = cat
        parsed.setdefault("vibe_tags", [])
        if not parsed.get("stops"):
            parsed["stops"] = fallback["stops"]
        # Re-attach partner_id from name when LLM forgot it
        partner_by_name = {p["name"].lower(): p["partner_id"] for p in slim_partners if p.get("name") and p.get("partner_id")}
        for s in parsed["stops"]:
            if not s.get("partner_id") and s.get("venue"):
                s["partner_id"] = partner_by_name.get(s["venue"].lower())
        parsed["ai_status"] = "ok"
        parsed["personal_note"] = parsed.get("personal_note") or "Disfruta tu día en Cartagena."
        return parsed

    except Exception as e:
        logger.error(f"AI itinerary generation failed: {e}")
        fallback["ai_status"] = f"error: {str(e)[:80]}"
        return fallback


def _fallback_itinerary(category: str, partners_pool: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Lightweight deterministic itinerary if LLM is unavailable."""
    pool = partners_pool[:6] if partners_pool else []
    base_times = ["09:00", "12:30", "15:30", "18:30", "21:00"]
    stops = []
    for i, p in enumerate(pool[:5]):
        stops.append({
            "time": base_times[i] if i < len(base_times) else "20:00",
            "title": p.get("name", "Parada Cartagena"),
            "venue": p.get("name", ""),
            "partner_id": p.get("partner_id"),
            "type": p.get("category", "other"),
            "duration_min": 90,
            "why": "Recomendación trending de Cartagena.",
        })
    titles = {
        "lifestyle": "Día Lifestyle Caribe",
        "cultura":   "Cartagena entre Murallas",
        "musical":   "Noche Musical de Cartagena",
    }
    return {
        "name": titles.get(category, "Tu día en Cartagena"),
        "description": "Propuesta del día en Cartagena (modo offline).",
        "category": category,
        "vibe_tags": ["caribe", "cartagena", category],
        "stops": stops,
        "personal_note": "Activa tu sesión y agrega favoritos para una ruta hecha a tu medida.",
        "ai_status": "fallback",
    }
