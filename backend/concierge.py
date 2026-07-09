"""
AMO Concierge — World-class AI concierge for Cartagena de Indias.

Four specialist agents, each with deep local knowledge, grounded in 745+
real venues. Every recommendation comes from verified AMO partner data.
The concierge reads the user's profile (visitor/local, party type, interests,
travel dates) to personalize every response.

Quality standard: Sofitel-level concierge. Not a chatbot — a trusted advisor.
"""

import os
import re
import logging
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()

# ═══════════════════════════════════════════════════════════
# SYSTEM ARCHITECTURE
# ═══════════════════════════════════════════════════════════

SHARED_RULES = """
REGLAS FUNDAMENTALES (aplican siempre):
1. SOLO recomiendas lugares de los DATOS AMO proporcionados. NUNCA inventes.
2. Usa el nombre EXACTO del lugar tal como aparece en los datos.
3. Responde en el idioma del usuario (español por defecto; inglés si escriben en inglés).
4. Máximo 2-3 recomendaciones por respuesta. Calidad absoluta sobre cantidad.
5. Si no tienes un dato, dilo con elegancia: "Puedo verificar eso — ¿te muestro la ficha en la app?"
6. Nunca prometas disponibilidad. Di "puedo mostrarle cómo reservar desde la app."

TONO Y ESTILO — ESTO ES CRÍTICO:
- Eres un concierge de hotel cinco estrellas que AMA Cartagena.
- Sofisticado pero cálido. Conocedor pero nunca pretencioso.
- Como el mejor concierge del Sofitel Santa Clara o del Casa San Agustín.
- Cuando recomiendas, hazlo como quien comparte un secreto:
  "Le sugiero...", "Mi recomendación personal sería...",
  "Hay un lugar que le va a encantar..."
- Describe cada lugar en UNA frase evocadora que capture la EXPERIENCIA,
  no una lista de features. Ejemplo:
  ✗ "Tiene buena comida y buen ambiente"
  ✓ "Una terraza escondida en San Diego donde el ceviche llega con brisa de mar"
- Si la petición sale de tu especialidad, deriva con gracia:
  "Para eso, mi colega Maré conoce cada mesa de la ciudad."
- Respuestas de máximo 150 palabras. Precisión y elegancia.
- Máximo 1-2 emojis por mensaje. Nada de "¡Ey!", "¡dale!", jerga callejera.
"""

# ═══════════════════════════════════════════════════════════
# AGENT PERSONALITIES
# ═══════════════════════════════════════════════════════════

AGENT_PROMPTS = {
    "luna": """Eres Luna, concierge nocturna de AMO Cartagena.

Tu dominio: la noche cartagenera en toda su profundidad.
- Los rooftops donde el atardecer es religión (Alquímico, Café del Mar, Movich)
- Los bares donde la mixología es un arte (Alquímico es #11 mundial en 50 Best Bars)
- Las esquinas de Getsemaní donde suena la mejor salsa en vivo (Café Havana, Bazurto Social Club)
- Los clubs donde la champeta vibra hasta el amanecer
- Los restaurantes con ambiente nocturno perfecto para antes o después de salir

Tu talento: leer lo que el huésped realmente busca.
"Una copa tranquila" → rooftop íntimo, no un club.
"Noche romántica" → terraza con velas, cena primero, cócteles después.
"Celebración épica" → beach club de día → cena → club → after.

Siempre piensa en la SECUENCIA de la noche: dónde cenar antes, dónde ir después.
REGLA CRÍTICA: Solo recomienda venues de la lista de DATOS AMO.""",

    "mare": """Eres Maré, concierge gastronómica de AMO Cartagena.

Tu dominio: cada cocina de la ciudad, desde el ceviche callejero hasta el tasting menu.
- Alta gastronomía: Celele (#5 Latin America's 50 Best), Carmen, Alma, 1621
- Cocina colombiana auténtica: La Mulata (posta negra), Candé (con show de cumbia)
- Seafood: La Cevichería (la de Bourdain), Lobo de Mar, Coroncoro
- Internacional: Uma (peruano), La Fontana (italiano), Quebracho (argentino)
- Cafés de especialidad: Época, San Alberto, Libertario, Café Stepping Stone
- Brunch: Manna, Al Alma, Érase Un Café

Tu talento: recomendar según la OCASIÓN, no solo la comida.
"Cena romántica" → mesa con velas en patio colonial, no fast casual.
"Grupo celebrando" → mesa larga, buenos cócteles, ambiente festivo.
"Desayuno sano" → bowl de açaí, jugo natural, café de origen.
"Presupuesto" → almuerzo ejecutivo, menú del día, cocina local.

Siempre menciona el BARRIO y el rango de precios. Un dato memorable del lugar.
REGLA CRÍTICA: Solo recomienda de la lista de DATOS AMO.""",

    "tino": """Eres Tino, concierge de experiencias inteligentes de AMO Cartagena.

Tu dominio: maximizar cada momento y cada peso en Cartagena.
- City Pass AMO: Explorer $99K, Classic $200K, Premium $350K, Ultimate $599K
- Beach clubs: cuál tiene mejor relación calidad-precio, cuál es trendy
- Tours y experiencias: walking tours, food tours, cooking classes, snorkel
- Islas: Rosario vs Barú vs Tierra Bomba — cuál según el viajero
- Transporte: lanchas, chivas, taxis, apps — cuánto cuesta realmente
- Ofertas del día y promociones activas de partners

Tu talento: ser honesto sobre qué vale la pena y qué no.
No eres un cazador de descuentos — eres un asesor de inversión en experiencias.
"¿Vale la pena la chiva?" → "Es divertida con amigos, pero si buscan algo más
sofisticado les recomiendo mejor un rooftop con DJ."

Siempre da el PRECIO REAL y compara opciones. Nunca vendas — asesora.
REGLA CRÍTICA: Solo recomienda de la lista de DATOS AMO.""",

    "ciro": """Eres Ciro, concierge de itinerarios de AMO Cartagena.

Tu dominio: componer días perfectos desde el café al amanecer hasta el último cóctel.
- Diseñas rutas que fluyen GEOGRÁFICAMENTE (Centro → Getsemaní → Bocagrande, no zigzag)
- Combinas cultura + gastronomía + playa + vida nocturna en secuencias naturales
- Conoces los HORARIOS de Cartagena: museos cierran ~17h, restaurants abren 12h+19h,
  clubs abren 22h+, beach clubs requieren salir ~8-9am
- Sabes que el calor de mediodía (12-15h) pide sombra, piscina o A/C
- Incluyes ATRACCIONES: San Felipe, Murallas, Museo del Oro, Palacio de la Inquisición,
  Las Bóvedas, Getsemaní street art, Cerro de la Popa

Tu talento: presentar cada plan como una narrativa del día, no como una lista.
"Mañana comienzan en San Felipe cuando la luz es perfecta para fotos. Después,
bajan por las murallas hasta Las Bóvedas para souvenirs artesanales. Para almorzar,
les tengo reservado un secreto en San Diego..."

Adapta según: cruceristas (6-8 horas max), familias (incluir Aviario), parejas (sunset).
REGLA CRÍTICA: Solo recomienda de la lista de DATOS AMO.""",
}

# Categories each agent can see — broader access for better recommendations
AGENT_CATEGORIES = {
    "luna": ["club", "beach_club", "bar", "restaurant"],  # restaurants for dinner-before-going-out
    "mare": ["restaurant", "cafe", "bar", "hotel"],  # hotels for hotel restaurants, bars for cocktail dinners
    "tino": None,  # sees everything
    "ciro": None,  # sees everything — needs all categories for day planning
}

# ═══════════════════════════════════════════════════════════
# INTENT DETECTION — pre-filter partners by query context
# ═══════════════════════════════════════════════════════════

ZONE_KEYWORDS = {
    "centro": "Centro Histórico",
    "centro histórico": "Centro Histórico",
    "walled city": "Centro Histórico",
    "old city": "Centro Histórico",
    "getsemaní": "Getsemaní",
    "getsemani": "Getsemaní",
    "bocagrande": "Bocagrande",
    "san diego": "San Diego",
    "manga": "Manga",
    "castillogrande": "Castillogrande",
    "laguito": "El Laguito",
    "rosario": "Islas del Rosario",
    "barú": "Barú",
    "baru": "Barú",
    "tierra bomba": "Tierra Bomba",
}

OCCASION_KEYWORDS = {
    "romántic": "romantic",
    "romantic": "romantic",
    "pareja": "romantic",
    "couple": "romantic",
    "aniversario": "romantic",
    "anniversary": "romantic",
    "familia": "family",
    "family": "family",
    "niños": "family",
    "kids": "family",
    "amigos": "friends",
    "friends": "friends",
    "grupo": "friends",
    "group": "friends",
    "fiesta": "party",
    "party": "party",
    "celebr": "party",
    "cumpleaños": "party",
    "birthday": "party",
    "solo": "solo",
    "relax": "wellness",
    "tranquil": "wellness",
    "spa": "wellness",
    "wellness": "wellness",
    "breakfast": "breakfast",
    "desayuno": "breakfast",
    "brunch": "brunch",
    "almuerzo": "lunch",
    "lunch": "lunch",
    "cena": "dinner",
    "dinner": "dinner",
    "sunset": "sunset",
    "atardecer": "sunset",
    "rooftop": "rooftop",
    "terraza": "rooftop",
    "playa": "beach",
    "beach": "beach",
    "isla": "island",
    "island": "island",
}


def detect_intent(messages: list) -> dict:
    """Analyze the user's messages to detect zone, occasion, and category hints."""
    text = " ".join(m.get("content", "") for m in messages if m.get("role") == "user").lower()

    zones = []
    for kw, zone in ZONE_KEYWORDS.items():
        if kw in text:
            zones.append(zone)

    occasions = set()
    for kw, occ in OCCASION_KEYWORDS.items():
        if kw in text:
            occasions.add(occ)

    return {"zones": list(set(zones)), "occasions": list(occasions), "raw_query": text}


# ═══════════════════════════════════════════════════════════
# GROUNDING DATA — rich, sorted, zone-aware
# ═══════════════════════════════════════════════════════════

async def get_grounding_data(agent: str, db, user_profile: Optional[dict] = None, intent: Optional[dict] = None) -> str:
    """Pull rich AMO partner data, sorted by rating, with zone awareness."""
    cats = AGENT_CATEGORIES.get(agent)

    query: dict = {}
    if cats:
        query["category"] = {"$in": cats}

    # Zone-aware: if user asked about a specific zone, boost those partners
    zone_filter = intent.get("zones", []) if intent else []

    # Richer field projection
    partners = await db.partners.find(
        query,
        {"_id": 0, "partner_id": 1, "name": 1, "category": 1, "subcategory": 1,
         "address": 1, "price_range": 1, "rating": 1, "reviews": 1,
         "description": 1, "phone": 1, "experience": 1, "tier": 1,
         "cuisine": 1, "hours": 1, "neighborhood": 1}
    ).sort("rating", -1).to_list(200)

    # If zone filter, put zone-matching partners first
    if zone_filter:
        in_zone = []
        out_zone = []
        for p in partners:
            addr = (p.get("address", "") or "").lower()
            neighborhood = (p.get("neighborhood", "") or "").lower()
            if any(z.lower() in addr or z.lower() in neighborhood for z in zone_filter):
                in_zone.append(p)
            else:
                out_zone.append(p)
        partners = in_zone[:40] + out_zone[:40]
    else:
        partners = partners[:80]

    lines = []
    for p in partners:
        tier_badge = f" [{p.get('tier', '').upper()}]" if p.get('tier') in ('elite', 'premium', 'gold') else ""
        cuisine = f" | cocina: {p['cuisine']}" if p.get('cuisine') else ""
        hours_info = f" | horario: {p['hours'][:50]}" if p.get('hours') else ""
        reviews_info = f" ({p.get('reviews', 0)} reseñas)" if p.get('reviews') else ""
        exp = p.get('experience') or p.get('description', '') or ''

        line = (
            f"- {p['name']}{tier_badge} | {p.get('category', '')} | "
            f"{p.get('subcategory', '')} | "
            f"{p.get('address', '')[:60]} | "
            f"rating {p.get('rating', '?')}{reviews_info} | {p.get('price_range', '')}"
            f"{cuisine}{hours_info} | "
            f"{exp[:120]}"
        )
        lines.append(line)

    # Add today's events
    if agent in ("luna", "ciro", "tino"):
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        events = await db.partner_events.find(
            {"date": today},
            {"_id": 0, "title": 1, "partner_name": 1, "start_time": 1,
             "category": 1, "price": 1, "is_free": 1}
        ).limit(20).to_list(20)
        if events:
            lines.append("\n🎫 EVENTOS HOY:")
            for e in events:
                price = "GRATIS" if e.get("is_free") else f"${e.get('price', 0):,} COP"
                lines.append(
                    f"- {e.get('title', '')} @ {e.get('partner_name', '')} "
                    f"| {e.get('start_time', '')} | {price}"
                )

    # Add attractions for Ciro (day planning)
    if agent == "ciro":
        attractions = await db.partners.find(
            {"category": "attraction"},
            {"_id": 0, "name": 1, "subcategory": 1, "address": 1,
             "description": 1, "price_range": 1, "rating": 1}
        ).sort("rating", -1).to_list(25)
        if attractions:
            lines.append("\n🏛️ ATRACCIONES Y MONUMENTOS:")
            for a in attractions:
                lines.append(
                    f"- {a['name']} | {a.get('subcategory', '')} | "
                    f"{a.get('address', '')[:50]} | {a.get('price_range', '')} | "
                    f"{(a.get('description', '') or '')[:100]}"
                )

    # City Pass info for Tino
    if agent == "tino":
        promos = await db.partner_promotions.find(
            {}, {"_id": 0, "title": 1, "partner_name": 1, "discount": 1,
                 "description": 1}
        ).limit(15).to_list(15)
        if promos:
            lines.append("\n💰 OFERTAS ACTIVAS:")
            for pr in promos:
                lines.append(f"- {pr.get('title', '')} @ {pr.get('partner_name', '')} | {pr.get('discount', '')}")
        lines.append("\n🎫 CITY PASS AMO CARTAGENA:")
        lines.append("- Explorer: $99,000 COP / 7 días — descuentos en restaurants y bares")
        lines.append("- Classic: $200,000 COP / 12 días — acceso a eventos exclusivos")
        lines.append("- Premium: $350,000 COP / 12 días — tours privados + concierge")
        lines.append("- Ultimate: $599,000 COP / 30 días — todo incluido, yates, islas")

    return "DATOS AMO — SOLO RECOMIENDA DE ESTA LISTA:\n" + "\n".join(lines)


def build_user_context(user_profile: Optional[dict]) -> str:
    """Build a context string from the user's profile for personalized recommendations."""
    if not user_profile:
        return "PERFIL DEL HUÉSPED: Visitante nuevo (sin perfil). Haz recomendaciones generales de alta calidad."

    parts = ["PERFIL DEL HUÉSPED:"]

    user_type = user_profile.get("user_type")
    if user_type == "local":
        parts.append("- Es LOCAL de Cartagena — conoce lo básico, busca descubrimientos")
    elif user_type == "visitor":
        parts.append("- Es VISITANTE — necesita orientación, puede no conocer los barrios")

    travel_dates = user_profile.get("travel_dates")
    if travel_dates and travel_dates.get("start"):
        parts.append(f"- Viaja del {travel_dates['start']} al {travel_dates.get('end', '?')}")

    party_type = user_profile.get("party_type")
    if party_type:
        labels = {
            "couple": "Viaja en PAREJA — prioriza romántico, íntimo, especial",
            "friends": "Viaja con AMIGOS — prioriza diversión, energía, grupo",
            "family": "Viaja en FAMILIA — prioriza seguro, familiar, accesible",
            "solo": "Viaja SOLO — prioriza experiencias únicas, socializar, descubrir",
            "cruise": "Llega en CRUCERO — tiene 6-8 horas max, prioriza lo imperdible cerca del puerto",
        }
        parts.append(f"- {labels.get(party_type, party_type)}")

    interests = user_profile.get("interests", [])
    if interests:
        parts.append(f"- Intereses: {', '.join(interests)}")

    return "\n".join(parts)


# ═══════════════════════════════════════════════════════════
# MAIN CHAT FUNCTION
# ═══════════════════════════════════════════════════════════

async def concierge_chat(agent: str, messages: list, db, user_profile: Optional[dict] = None) -> dict:
    """Send a message to the concierge agent and return the reply."""
    if not ANTHROPIC_KEY:
        return {
            "agent": agent,
            "reply": "El concierge está activándose. Pronto estaré listo para ayudarte.",
        }

    if agent not in AGENT_PROMPTS:
        return {"agent": agent, "reply": "Agente no reconocido."}

    # Detect intent from user messages (zones, occasions, etc.)
    intent = detect_intent(messages)

    # Build rich grounding data with intent-aware filtering
    grounding = await get_grounding_data(agent, db, user_profile, intent)

    # Build user context
    user_context = build_user_context(user_profile)

    # Compose system prompt
    system = (
        AGENT_PROMPTS[agent] + "\n\n"
        + SHARED_RULES + "\n\n"
        + user_context + "\n\n"
        + grounding
    )

    try:
        import anthropic
        fresh_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        if not fresh_key:
            logger.error("[Concierge] ANTHROPIC_API_KEY env var is empty")
        aclient = anthropic.AsyncAnthropic(api_key=fresh_key)
        r = await aclient.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=700,
            system=system,
            messages=messages[-10:],
        )
        reply_text = r.content[0].text if r.content else ""
        if not reply_text:
            return {
                "agent": agent,
                "reply": "Disculpe, no pude procesar su solicitud. ¿Podría reformularla?",
            }
        return {"agent": agent, "reply": reply_text}

    except Exception as e:
        logger.error(f"Concierge error: {e}")
        return {
            "agent": agent,
            "reply": "Disculpe, tuve un momento de desconexión. ¿Podría intentarlo de nuevo?",
        }
