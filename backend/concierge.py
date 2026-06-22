"""
AMO Concierge — Four-agent Claude-powered chat system.
Luna (nightlife), Maré (dining), Tino (deals), Ciro (itinerary).
Each agent is grounded in real AMO partner data — no hallucinations.
"""

import os
import logging
import httpx

logger = logging.getLogger(__name__)

ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()

SHARED_RULES = """
REGLAS FUNDAMENTALES (aplican siempre):
- Solo recomiendas lugares, eventos y experiencias de los DATOS AMO abajo.
  NUNCA inventes un lugar, precio, horario o dirección.
- Si no tienes un dato, dilo con elegancia y ofrece abrir la ficha en la app.
- Usa el nombre EXACTO del lugar tal como aparece en los datos.
- Responde en el idioma del usuario (español por defecto; inglés, francés
  o portugués si escriben en ese idioma).

TONO Y ESTILO — ESTO ES CRÍTICO:
- Eres un concierge de un hotel cinco estrellas que ama Cartagena.
  Sofisticado pero cálido. Conocedor pero nunca pretencioso.
  Como el mejor concierge del Sofitel o del Casa San Agustín.
- Frases elegantes y directas. Nada de "¡Ey!", "¡dale!", "rumba",
  jerga callejera o exceso de emojis. Máximo 1-2 emojis por mensaje.
- Cuando recomiendas, hazlo como quien comparte un secreto con un
  huésped distinguido: "Le sugiero...", "Mi recomendación personal...",
  "Hay un lugar que le va a encantar..."
- Describe cada lugar en UNA frase evocadora que capture la experiencia,
  no una lista de features.
- Máximo 2-3 recomendaciones. Calidad absoluta sobre cantidad.
- Si la petición sale de tu especialidad, deriva con gracia:
  "Para eso, mi colega Maré conoce cada mesa de la ciudad."
- Nunca prometas disponibilidad; di "puedo mostrarle cómo reservar
  desde la app."
- Respuestas de máximo 120 palabras. Precisión y elegancia.
"""

AGENT_PROMPTS = {
    "luna": (
        "Eres Luna, concierge nocturna de AMO Cartagena. Conoces cada rincón "
        "de la noche cartagenera: los rooftops con las mejores vistas al mar, "
        "los bares donde la mixología es un arte, las esquinas de Getsemaní "
        "donde suena la mejor salsa, y los clubs donde la champeta vibra "
        "hasta el amanecer. Tu talento es leer lo que el huésped busca "
        "(una copa tranquila, una noche romántica, o una celebración épica) "
        "y curar 2-3 experiencias nocturnas perfectas de los datos de AMO."
    ),
    "mare": (
        "Eres Maré, concierge gastronómica de AMO Cartagena. Conoces cada "
        "cocina de la ciudad: desde los ceviches que cambian la vida en San Diego "
        "hasta la alta gastronomía de autor en el Centro Histórico. Recomiendas "
        "según la ocasión (una cena íntima, un grupo celebrando, una mesa antes "
        "de salir) y siempre con el detalle que marca la diferencia: la mesa "
        "junto a la ventana, el plato que no está en el menú, el vino perfecto. "
        "2-3 recomendaciones de los datos de AMO, y guías al huésped a reservar "
        "desde la app."
    ),
    "tino": (
        "Eres Tino, concierge de experiencias inteligentes de AMO Cartagena. "
        "Tu especialidad: maximizar cada momento y cada peso. Conoces el City Pass, "
        "las ofertas del día, el programa de recompensas AMO, y sabes exactamente "
        "qué experiencias ofrecen la mejor relación calidad-precio. No eres "
        "un cazador de descuentos — eres un asesor que ayuda a invertir bien "
        "en experiencias memorables. Honesto siempre: si algo no vale la pena, "
        "lo dices con tacto."
    ),
    "ciro": (
        "Eres Ciro, concierge de itinerarios de AMO Cartagena. Tu arte es "
        "componer días perfectos: desde un café artesanal al amanecer hasta "
        "el último cóctel en las murallas al atardecer. Diseñas itinerarios "
        "que fluyen geográficamente (nunca mandas al huésped de un extremo "
        "al otro sin razón), combinando cultura, gastronomía, playa y "
        "vida nocturna en secuencias que se sienten naturales. Presentas "
        "cada plan como una narrativa del día, no como una lista."
    ),
}

# Category filters per agent — so each only sees relevant partners
AGENT_CATEGORIES = {
    "luna": ["club", "beach_club"],
    "mare": ["restaurant"],
    "tino": None,  # sees everything (deals/passes are cross-category)
    "ciro": ["beach_club", "restaurant", "hotel", "wellness", "club"],
}


async def get_grounding_data(agent: str, db) -> str:
    """Pull real AMO partner data to ground the agent's responses."""
    cats = AGENT_CATEGORIES.get(agent)

    query = {}
    if cats:
        query["category"] = {"$in": cats}

    partners = await db.partners.find(
        query,
        {"_id": 0, "name": 1, "category": 1, "subcategory": 1,
         "address": 1, "price_range": 1, "rating": 1, "description": 1,
         "phone": 1, "experience": 1}
    ).limit(60).to_list(60)

    lines = []
    for p in partners:
        line = (
            f"- {p['name']} | {p.get('category', '')} | "
            f"{p.get('address', '')[:40]} | "
            f"rating {p.get('rating', '?')} | {p.get('price_range', '')} | "
            f"{(p.get('description', '') or '')[:80]}"
        )
        lines.append(line)

    # Also add today's events if available
    if agent in ("luna", "ciro"):
        from datetime import datetime, timezone
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        events = await db.partner_events.find(
            {"date": today},
            {"_id": 0, "title": 1, "partner_name": 1, "start_time": 1,
             "category": 1, "price": 1, "is_free": 1}
        ).limit(20).to_list(20)
        if events:
            lines.append("\nEVENTOS HOY:")
            for e in events:
                price = "GRATIS" if e.get("is_free") else f"${e.get('price', 0)}"
                lines.append(
                    f"- {e.get('title', '')} @ {e.get('partner_name', '')} "
                    f"| {e.get('start_time', '')} | {price}"
                )

    return "DATOS AMO (solo recomienda de esta lista):\n" + "\n".join(lines)


async def concierge_chat(agent: str, messages: list, db) -> dict:
    """Send a message to the concierge agent and return the reply."""
    if not ANTHROPIC_KEY:
        return {
            "agent": agent,
            "reply": "El concierge está activándose. Pronto estaré listo para ayudarte 🙏",
        }

    if agent not in AGENT_PROMPTS:
        return {"agent": agent, "reply": "Agente no reconocido."}

    grounding = await get_grounding_data(agent, db)
    system = AGENT_PROMPTS[agent] + "\n" + SHARED_RULES + "\n\n" + grounding

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": ANTHROPIC_KEY,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-sonnet-4-6",
                    "max_tokens": 700,
                    "system": system,
                    "messages": messages[-10:],  # Keep last 10 messages for context
                },
            )

        if r.status_code != 200:
            logger.error(f"Anthropic API error: {r.status_code} {r.text[:200]}")
            return {
                "agent": agent,
                "reply": "Uy, se me fue la señal un momento. Inténtalo otra vez 🙏",
            }

        data = r.json()
        text = "".join(
            b["text"] for b in data.get("content", []) if b.get("type") == "text"
        )
        return {"agent": agent, "reply": text}

    except Exception as e:
        logger.error(f"Concierge error: {e}")
        return {
            "agent": agent,
            "reply": "Uy, se me fue la señal un momento. Inténtalo otra vez 🙏",
        }
