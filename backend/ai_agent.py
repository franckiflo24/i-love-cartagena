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
import time
import uuid
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

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

# Spanish/English/Portuguese/French keyword → canonical filter (FALLBACK for when LLM routing fails)
_KEYWORD_FALLBACK: Dict[str, Dict[str, Any]] = {
    # ── Cuisines (existing + expanded) ──
    "italian": {"subcategory": "italiana"}, "italiana": {"subcategory": "italiana"},
    "italien": {"subcategory": "italiana"}, "italienne": {"subcategory": "italiana"},
    "italiano": {"subcategory": "italiana"},
    "pizza": {"subcategory": "italiana"}, "pasta": {"subcategory": "italiana"},
    "japanese": {"subcategory": "asiatica"}, "japonesa": {"subcategory": "asiatica"},
    "asian": {"subcategory": "asiatica"}, "asiatica": {"subcategory": "asiatica"},
    "asiática": {"subcategory": "asiatica"}, "asiatique": {"subcategory": "asiatica"},
    "sushi": {"subcategory": "asiatica"}, "ramen": {"subcategory": "asiatica"},
    "noodles": {"subcategory": "asiatica"},
    "marisco": {"subcategory": "mariscos"}, "mariscos": {"subcategory": "mariscos"},
    "seafood": {"subcategory": "mariscos"}, "frutos do mar": {"subcategory": "mariscos"},
    "fruits de mer": {"subcategory": "mariscos"}, "fish": {"subcategory": "mariscos"},
    "ceviche": {"subcategory": "mariscos"},
    "lobster": {"subcategory": "mariscos"}, "langosta": {"subcategory": "mariscos"},
    "shrimp": {"subcategory": "mariscos"}, "camarones": {"subcategory": "mariscos"},
    "pescado": {"subcategory": "mariscos"}, "poisson": {"subcategory": "mariscos"},
    "peixe": {"subcategory": "mariscos"},
    "steak": {"subcategory": "carnes"}, "carne": {"subcategory": "carnes"},
    "carnes": {"subcategory": "carnes"}, "meat": {"subcategory": "carnes"},
    "viande": {"subcategory": "carnes"}, "parrilla": {"subcategory": "carnes"},
    "tacos": {"subcategory": "mexicana"}, "mexican": {"subcategory": "mexicana"},
    "mexicana": {"subcategory": "mexicana"}, "burrito": {"subcategory": "mexicana"},
    # New cuisine subcategories (matching enriched MongoDB data)
    "peruana": {"subcategory": "peruana"}, "peruvian": {"subcategory": "peruana"},
    "peruano": {"subcategory": "peruana"}, "pisco": {"subcategory": "peruana"},
    "caribena": {"subcategory": "caribena"}, "caribeña": {"subcategory": "caribena"},
    "caribbean food": {"subcategory": "caribena"}, "comida caribeña": {"subcategory": "caribena"},
    "francesa": {"subcategory": "francesa"}, "french food": {"subcategory": "francesa"},
    "francés": {"subcategory": "francesa"}, "crêpe": {"subcategory": "francesa"},
    "espanola": {"subcategory": "espanola"}, "española": {"subcategory": "espanola"},
    "spanish food": {"subcategory": "espanola"}, "tapas": {"subcategory": "espanola"},
    "paella": {"subcategory": "espanola"},
    "argentina": {"subcategory": "argentina"}, "argentino": {"subcategory": "argentina"},
    "asado": {"subcategory": "argentina"},
    "arabe": {"subcategory": "arabe"}, "arab food": {"subcategory": "arabe"},
    "falafel": {"subcategory": "arabe"}, "shawarma": {"subcategory": "arabe"},
    "hummus": {"subcategory": "arabe"}, "kebab": {"subcategory": "arabe"},
    "fusion": {"subcategory": "fusion"}, "fusión": {"subcategory": "fusion"},
    "autor": {"subcategory": "fusion"}, "creative cuisine": {"subcategory": "fusion"},
    "brunch": {"subcategory": "brunch", "category": "cafe"},
    "curry": {"subcategory": "asiatica"}, "indian": {"subcategory": "asiatica"},
    "brunch": {"subcategory": "brunch"},
    "vegetarian": {"subcategory": "vegetariana"}, "vegana": {"subcategory": "vegetariana"},
    "vegano": {"subcategory": "vegetariana"}, "vegetariana": {"subcategory": "vegetariana"},
    "végétarien": {"subcategory": "vegetariana"}, "vegan": {"subcategory": "vegetariana"},
    "arab": {"subcategory": "arabe"}, "árabe": {"subcategory": "arabe"},
    "arabe": {"subcategory": "arabe"}, "libanesa": {"subcategory": "arabe"},
    "gastro": {"subcategory": "gastro"}, "gourmet": {"subcategory": "gastro"},
    "international": {"subcategory": "internacional"}, "internacional": {"subcategory": "internacional"},
    "internationale": {"subcategory": "internacional"},
    "local": {"subcategory": "local"}, "típica": {"subcategory": "local"},
    "tipica": {"subcategory": "local"}, "criolla": {"subcategory": "local"},
    "colombiana": {"subcategory": "local"},
    "ice cream": {"subcategory": "postres"}, "helado": {"subcategory": "postres"},
    "helados": {"subcategory": "postres"}, "glace": {"subcategory": "postres"},
    "sorvete": {"subcategory": "postres"}, "postres": {"subcategory": "postres"},
    "cake": {"subcategory": "postres"}, "pastel": {"subcategory": "postres"},
    "torta": {"subcategory": "postres"}, "gâteau": {"subcategory": "postres"},
    "gateau": {"subcategory": "postres"}, "bolo": {"subcategory": "postres"},
    "bakery": {"subcategory": "panaderia"}, "panadería": {"subcategory": "panaderia"},
    "panaderia": {"subcategory": "panaderia"}, "boulangerie": {"subcategory": "panaderia"},
    "padaria": {"subcategory": "panaderia"}, "pastelería": {"subcategory": "panaderia"},
    "pasteleria": {"subcategory": "panaderia"},

    # ── Categories (existing + expanded) ──
    "restaurant": {"category": "restaurant"}, "restaurante": {"category": "restaurant"},
    "restaurants": {"category": "restaurant"}, "comer": {"category": "restaurant"},
    "comida": {"category": "restaurant"}, "eat": {"category": "restaurant"},
    "manger": {"category": "restaurant"}, "dîner": {"category": "restaurant"},
    "almuerzo": {"category": "restaurant"}, "lunch": {"category": "restaurant"},
    "cena": {"category": "restaurant"}, "dinner": {"category": "restaurant"},
    "hungry": {"category": "restaurant"}, "hambre": {"category": "restaurant"},
    "tengo hambre": {"category": "restaurant"}, "j'ai faim": {"category": "restaurant"},
    "fome": {"category": "restaurant"}, "estou com fome": {"category": "restaurant"},

    "breakfast": {"category": "cafe"}, "desayuno": {"category": "cafe"},
    "petit déjeuner": {"category": "cafe"}, "petit dejeuner": {"category": "cafe"},
    "café da manhã": {"category": "cafe"}, "cafe da manha": {"category": "cafe"},
    "coffee": {"category": "cafe"}, "café": {"category": "cafe"},
    "cafe": {"category": "cafe"}, "cafeteria": {"category": "cafe"},
    "juice": {"category": "cafe"}, "jugo": {"category": "cafe"},
    "jus": {"category": "cafe"}, "suco": {"category": "cafe"},
    "smoothie": {"category": "cafe"},

    "hotel": {"category": "hotel"}, "hoteles": {"category": "hotel"},
    "hotels": {"category": "hotel"}, "hôtel": {"category": "hotel"}, "hostel": {"category": "hotel"},
    "alojamiento": {"category": "hotel"}, "stay": {"category": "hotel"}, "logement": {"category": "hotel"},

    "beach": {"category": "beach_club"}, "playa": {"category": "beach_club"},
    "praia": {"category": "beach_club"}, "plage": {"category": "beach_club"},
    "beach club": {"category": "beach_club"}, "beach_club": {"category": "beach_club"},
    "isla": {"category": "beach_club"}, "islas": {"category": "beach_club"}, "island": {"category": "beach_club"},
    "islands": {"category": "beach_club"}, "îles": {"category": "beach_club"}, "ilha": {"category": "beach_club"},
    "barú": {"category": "beach_club", "subcategory": "baru"}, "baru": {"category": "beach_club", "subcategory": "baru"},
    "rosario": {"category": "beach_club", "subcategory": "islas_del_rosario"}, "isla grande": {"category": "beach_club", "subcategory": "islas_del_rosario"},
    "tierra bomba": {"category": "beach_club", "subcategory": "tierra_bomba"}, "tierrabomba": {"category": "beach_club", "subcategory": "tierra_bomba"},
    "cholon": {"category": "beach_club", "subcategory": "islas_del_rosario"}, "cholón": {"category": "beach_club", "subcategory": "islas_del_rosario"},

    "wellness": {"category": "spa"}, "spa": {"category": "spa"}, "yoga": {"category": "activity"},
    "massage": {"category": "spa"}, "masaje": {"category": "spa"},
    "tired": {"category": "spa"}, "cansado": {"category": "spa"}, "cansada": {"category": "spa"},
    "fatigué": {"category": "spa"}, "fatigue": {"category": "spa"},
    "cansada pt": {"category": "spa"},

    # ── Intent / Vibe → category mapping ──
    "bored": {"category_in": ["activity", "bar", "club", "beach_club"]},
    "aburrido": {"category_in": ["activity", "bar", "club", "beach_club"]},
    "aburrida": {"category_in": ["activity", "bar", "club", "beach_club"]},
    "ennuyé": {"category_in": ["activity", "bar", "club", "beach_club"]},
    "ennuye": {"category_in": ["activity", "bar", "club", "beach_club"]},
    "entediado": {"category_in": ["activity", "bar", "club", "beach_club"]},
    "entediada": {"category_in": ["activity", "bar", "club", "beach_club"]},

    "relax": {"category_in": ["spa", "beach_club"]}, "relajar": {"category_in": ["spa", "beach_club"]},
    "chill": {"category_in": ["spa", "beach_club"]}, "tranquilo": {"category_in": ["spa", "beach_club"]},
    "détendre": {"category_in": ["spa", "beach_club"]}, "relaxar": {"category_in": ["spa", "beach_club"]},

    "romantic": {"category_in": ["restaurant", "bar", "spa"]},
    "romántico": {"category_in": ["restaurant", "bar", "spa"]},
    "romantico": {"category_in": ["restaurant", "bar", "spa"]},
    "romantique": {"category_in": ["restaurant", "bar", "spa"]},
    "romântico": {"category_in": ["restaurant", "bar", "spa"]},
    "date": {"category_in": ["restaurant", "bar", "spa"]},
    "cita": {"category_in": ["restaurant", "bar", "spa"]},
    "date night": {"category_in": ["restaurant", "bar", "spa"]},

    "celebrate": {"category_in": ["bar", "club", "restaurant"]},
    "celebrar": {"category_in": ["bar", "club", "restaurant"]},
    "célébrer": {"category_in": ["bar", "club", "restaurant"]},
    "celebrar pt": {"category_in": ["bar", "club", "restaurant"]},
    "birthday": {"category_in": ["bar", "club", "restaurant"]},
    "cumpleaños": {"category_in": ["bar", "club", "restaurant"]},
    "cumpleanos": {"category_in": ["bar", "club", "restaurant"]},
    "anniversaire": {"category_in": ["bar", "club", "restaurant"]},
    "aniversário": {"category_in": ["bar", "club", "restaurant"]},
    "aniversario": {"category_in": ["bar", "club", "restaurant"]},
    "anniversary": {"category_in": ["bar", "club", "restaurant"]},

    "pool": {"category_in": ["hotel", "beach_club"]}, "piscina": {"category_in": ["hotel", "beach_club"]},
    "piscine": {"category_in": ["hotel", "beach_club"]},

    "dance": {"category_in": ["club", "beach_club", "nightclub"]},
    "bailar": {"category_in": ["club", "beach_club", "nightclub"]},
    "danser": {"category_in": ["club", "beach_club", "nightclub"]},
    "dançar": {"category_in": ["club", "beach_club", "nightclub"]},
    "dancar": {"category_in": ["club", "beach_club", "nightclub"]},

    "fun": {"category_in": ["activity", "bar", "club", "beach_club"]},
    "divertido": {"category_in": ["activity", "bar", "club", "beach_club"]},
    "diversión": {"category_in": ["activity", "bar", "club", "beach_club"]},
    "diversion": {"category_in": ["activity", "bar", "club", "beach_club"]},
    "amusant": {"category_in": ["activity", "bar", "club", "beach_club"]},

    "adventure": {"category": "activity"}, "aventura": {"category": "activity"},
    "aventure": {"category": "activity"},
    "gym": {"category": "activity"}, "gimnasio": {"category": "activity"},
    "workout": {"category": "activity"}, "exercise": {"category": "activity"},
    "ejercicio": {"category": "activity"}, "exercice": {"category": "activity"},
    "exercício": {"category": "activity"}, "crossfit": {"category": "activity"},
    "run": {"category": "activity"}, "correr": {"category": "activity"},
    "courir": {"category": "activity"}, "walk": {"category": "activity"},
    "caminar": {"category": "activity"}, "marcher": {"category": "activity"},
    "caminhar": {"category": "activity"},

    "hair": {"category": "beauty"}, "pelo": {"category": "beauty"},
    "haircut": {"category": "beauty"}, "corte": {"category": "beauty"},
    "barber": {"category": "beauty"}, "barbería": {"category": "beauty"},
    "barberia": {"category": "beauty"}, "peluquería": {"category": "beauty"},
    "peluqueria": {"category": "beauty"}, "coiffeur": {"category": "beauty"},
    "cabeleireiro": {"category": "beauty"},
    "nails": {"category": "beauty"}, "uñas": {"category": "beauty"},
    "unas": {"category": "beauty"}, "manicure": {"category": "beauty"},
    "pedicure": {"category": "beauty"}, "salon": {"category": "beauty"},
    "tattoo": {"category": "beauty"}, "tatuaje": {"category": "beauty"},
    "tatouage": {"category": "beauty"}, "tatuagem": {"category": "beauty"},

    "wine": {"category_in": ["bar", "restaurant"]}, "vino": {"category_in": ["bar", "restaurant"]},
    "vin": {"category_in": ["bar", "restaurant"]}, "vinho": {"category_in": ["bar", "restaurant"]},
    "beer": {"category_in": ["bar"]}, "cerveza": {"category_in": ["bar"]},
    "bière": {"category_in": ["bar"]}, "biere": {"category_in": ["bar"]},
    "cerveja": {"category_in": ["bar"]},
    "rum": {"category_in": ["bar"]}, "ron": {"category_in": ["bar"]},
    "rhum": {"category_in": ["bar"]},
    "tequila": {"category_in": ["bar"]}, "mezcal": {"category_in": ["bar"]},
    "whisky": {"category_in": ["bar"]}, "whiskey": {"category_in": ["bar"]},
    "thirsty": {"category_in": ["bar", "cafe"]}, "sed": {"category_in": ["bar", "cafe"]},
    "soif": {"category_in": ["bar", "cafe"]}, "sede": {"category_in": ["bar", "cafe"]},

    # ── Weather / Time context ──
    "hot": {"category": "beach_club"}, "calor": {"category": "beach_club"},
    "chaud": {"category": "beach_club"}, "caliente": {"category": "beach_club"},
    "rain": {"category_in": ["attraction", "spa", "shopping"]},
    "lluvia": {"category_in": ["attraction", "spa", "shopping"]},
    "pluie": {"category_in": ["attraction", "spa", "shopping"]},
    "chuva": {"category_in": ["attraction", "spa", "shopping"]},

    # ── Services (existing + expanded) ──
    "bank": {"category": "service"}, "banco": {"category": "service"}, "banque": {"category": "service"},
    "atm": {"category": "service"}, "cajero": {"category": "service"},
    "cambio": {"category": "service"}, "exchange": {"category": "service"}, "currency": {"category": "service"},
    "money": {"category": "service"}, "dinero": {"category": "service"}, "argent": {"category": "service"},
    "dinheiro": {"category": "service"}, "cash": {"category": "service"}, "efectivo": {"category": "service"},
    "farmacia": {"category": "service"}, "pharmacy": {"category": "service"}, "pharmacie": {"category": "service"},
    "farmácia": {"category": "service"},
    "medicine": {"category": "service"}, "medicamento": {"category": "service"},
    "médicament": {"category": "service"}, "remédio": {"category": "service"},
    "sick": {"category": "service"}, "enfermo": {"category": "service"}, "enferma": {"category": "service"},
    "malade": {"category": "service"}, "doente": {"category": "service"},
    "rappi": {"category": "service"}, "delivery": {"category": "service"}, "domicilio": {"category": "service"},
    "sim": {"category": "service"}, "data plan": {"category": "service"}, "celular": {"category": "service"},
    "phone": {"category": "service"}, "teléfono": {"category": "service"}, "telefono": {"category": "service"},
    "téléphone": {"category": "service"}, "telefone": {"category": "service"},
    "lavandería": {"category": "service"}, "laundry": {"category": "service"}, "laverie": {"category": "service"},
    "lavanderia": {"category": "service"}, "lavandaria": {"category": "service"},
    "supermercado": {"category": "service"}, "supermarket": {"category": "service"}, "grocery": {"category": "service"},
    "supermarché": {"category": "service"}, "supermercado pt": {"category": "service"},
    "hospital": {"category": "service"}, "clínica": {"category": "service"}, "clinic": {"category": "service"},
    "clinica": {"category": "service"}, "clinique": {"category": "service"},
    "doctor": {"category": "service"}, "médico": {"category": "service"}, "medico": {"category": "service"},
    "médecin": {"category": "service"}, "medecin": {"category": "service"},
    "coworking": {"category": "service"}, "wifi": {"category": "service"}, "internet": {"category": "service"},
    "taxi": {"category": "service"}, "uber": {"category": "service"}, "ride": {"category": "service"},
    "transporte": {"category": "service"}, "transport": {"category": "service"},
    "airport": {"category": "service"}, "aeropuerto": {"category": "service"}, "aéroport": {"category": "service"},
    "aeroport": {"category": "service"}, "aeroporto": {"category": "service"},
    "emergency": {"category": "service"}, "emergencia": {"category": "service"},
    "urgence": {"category": "service"}, "emergência": {"category": "service"},
    "safe": {"category": "service"}, "seguro": {"category": "service"},
    "safety": {"category": "service"}, "seguridad": {"category": "service"},
    "sécurité": {"category": "service"}, "securite": {"category": "service"},
    "segurança": {"category": "service"}, "seguranca": {"category": "service"},

    # ── Attractions (existing + expanded) ──
    "museo": {"category": "attraction"}, "museum": {"category": "attraction"}, "musée": {"category": "attraction"},
    "musee": {"category": "attraction"}, "museu": {"category": "attraction"},
    "castillo": {"category": "attraction"}, "castle": {"category": "attraction"}, "fortress": {"category": "attraction"},
    "château": {"category": "attraction"}, "chateau": {"category": "attraction"}, "castelo": {"category": "attraction"},
    "murallas": {"category": "attraction"}, "walls": {"category": "attraction"},
    "iglesia": {"category": "attraction"}, "church": {"category": "attraction"}, "cathedral": {"category": "attraction"},
    "église": {"category": "attraction"}, "eglise": {"category": "attraction"}, "igreja": {"category": "attraction"},
    "monumento": {"category": "attraction"}, "monument": {"category": "attraction"},
    "history": {"category": "attraction"}, "historia": {"category": "attraction"},
    "histoire": {"category": "attraction"}, "história": {"category": "attraction"},
    "culture": {"category": "attraction"}, "cultura": {"category": "attraction"},

    # ── Shopping ──
    "souvenir": {"category": "shopping"}, "recuerdo": {"category": "shopping"},
    "regalo": {"category": "shopping"}, "gift": {"category": "shopping"},
    "cadeau": {"category": "shopping"}, "presente": {"category": "shopping"},
    "artesanía": {"category": "shopping"}, "artesania": {"category": "shopping"},
    "artisanat": {"category": "shopping"}, "artesanato": {"category": "shopping"},
    "market": {"category": "shopping"}, "mercado": {"category": "shopping"},
    "marché": {"category": "shopping"}, "marche": {"category": "shopping"},

    # ── Vibes ──
    "view": {"vibe": "sea_view"}, "vista": {"vibe": "sea_view"},
    "vue": {"vibe": "sea_view"},
    "instagrammable": {"vibe": "rooftop"}, "instagram": {"vibe": "rooftop"},
    "photo": {"vibe": "rooftop"}, "selfie": {"vibe": "rooftop"},

    # ── Tiers ──
    "luxury": {"tier": "luxe"}, "lujo": {"tier": "luxe"}, "luxe": {"tier": "luxe"},
    "luxo": {"tier": "luxe"}, "alto": {"tier": "luxe"},
    "premium": {"tier": "premium"},
    "fancy": {"tier": "luxe"}, "elegante": {"tier": "luxe"},
    "élégant": {"tier": "luxe"}, "elegant": {"tier": "luxe"},
    "bougie": {"tier": "luxe"}, "luxurious": {"tier": "luxe"}, "lujoso": {"tier": "luxe"},
    "popular": {"tier": "popular"}, "barato": {"tier": "popular"},
    "económico": {"tier": "popular"}, "cheap": {"tier": "popular"},
    "budget": {"tier": "popular"}, "economico": {"tier": "popular"},
    "bon marché": {"tier": "popular"}, "bon marche": {"tier": "popular"},
    "elite": {"tier": "elite"}, "élite": {"tier": "elite"},

    # ── Music / events ──
    "music": {"event_category": "music"}, "música": {"event_category": "music"},
    "musique": {"event_category": "music"}, "concierto": {"event_category": "music"},
    "concert": {"event_category": "music"}, "show": {"event_category": "music"},
    "live music": {"event_category": "music"}, "música en vivo": {"event_category": "music"},
    "musica en vivo": {"event_category": "music"}, "musique live": {"event_category": "music"},
    "música ao vivo": {"event_category": "music"}, "musica ao vivo": {"event_category": "music"},
    "sunset": {"event_category": "sunset", "vibe": "sunset"}, "atardecer": {"event_category": "sunset", "vibe": "sunset"},
    "coucher de soleil": {"event_category": "sunset", "vibe": "sunset"}, "pôr do sol": {"event_category": "sunset", "vibe": "sunset"},
    "pasa día": {"event_category": "daypass"}, "passa o dia": {"event_category": "daypass"},
    "day pass": {"event_category": "daypass"}, "journée": {"event_category": "daypass"},
    "arte": {"event_category": "culture"}, "art": {"event_category": "culture"},
    "karaoke": {"category_in": ["bar", "club"]},
    "sports": {"category_in": ["bar"]}, "deportes": {"category_in": ["bar"]},
    "football": {"category_in": ["bar"]}, "fútbol": {"category_in": ["bar"]},
    "futbol": {"category_in": ["bar"]}, "soccer": {"category_in": ["bar"]},

    # ── Bars / clubs / nightlife (existing) ──
    "bar": {"category_in": ["bar", "club", "beach_club"]}, "bares": {"category_in": ["bar", "club", "beach_club"]},
    "bars": {"category_in": ["bar", "club", "beach_club"]}, "lounge": {"category_in": ["bar", "club", "beach_club"]},
    "cocktail": {"category_in": ["bar", "club", "beach_club"]}, "cocktails": {"category_in": ["bar", "club", "beach_club"]},
    "coctel": {"category_in": ["bar", "club", "beach_club"]}, "cócteles": {"category_in": ["bar", "club", "beach_club"]},
    "drink": {"category_in": ["bar", "club", "beach_club"]}, "trago": {"category_in": ["bar", "club", "beach_club"]},
    "drinks": {"category_in": ["bar", "club", "beach_club"], "vibe": "aperitivo"},
    "tragos": {"category_in": ["bar", "club", "beach_club"], "vibe": "aperitivo"},
    "nightclub": {"category_in": ["club", "beach_club", "nightclub"]},
    "discoteca": {"category_in": ["club", "beach_club", "nightclub"]},
    "fiesta": {"category_in": ["club", "beach_club", "nightclub"]},
    "party": {"category_in": ["club", "beach_club", "nightclub"]},
    "fête": {"category_in": ["club", "beach_club", "nightclub"]},
    "fete": {"category_in": ["club", "beach_club", "nightclub"]},
    "festa": {"category_in": ["club", "beach_club", "nightclub"]},
    "club": {"category_in": ["club", "beach_club"]},
    "clubs": {"category_in": ["club", "beach_club"]},
    "night": {"category_in": ["bar", "club", "beach_club", "nightclub"]},
    "noche": {"category_in": ["bar", "club", "beach_club", "nightclub"]},
    "tonight": {"category_in": ["bar", "club", "beach_club", "nightclub"]},
    "esta noche": {"category_in": ["bar", "club", "beach_club", "nightclub"]},
    "ce soir": {"category_in": ["bar", "club", "beach_club", "nightclub"]},
    "hoje à noite": {"category_in": ["bar", "club", "beach_club", "nightclub"]},
    "hoje a noite": {"category_in": ["bar", "club", "beach_club", "nightclub"]},
    "nuit": {"category_in": ["bar", "club", "beach_club", "nightclub"]},
    "soir": {"category_in": ["bar", "club", "beach_club", "nightclub"]},
    "soirée": {"category_in": ["bar", "club", "beach_club", "nightclub"]},
    "pregame": {"category_in": ["bar", "club"]},
    "vibes": {"category_in": ["bar", "club", "beach_club"]},
    "electro": {"category_in": ["club", "beach_club", "nightclub"], "vibe": "electro"},
    "électro": {"category_in": ["club", "beach_club", "nightclub"], "vibe": "electro"},
    "electronic": {"category_in": ["club", "beach_club", "nightclub"], "vibe": "electro"},
    "electronica": {"category_in": ["club", "beach_club", "nightclub"], "vibe": "electro"},
    "electrónica": {"category_in": ["club", "beach_club", "nightclub"], "vibe": "electro"},
    "techno": {"category_in": ["club", "beach_club", "nightclub"], "vibe": "electro"},
    "house": {"category_in": ["club", "beach_club", "nightclub"], "vibe": "electro"},
    "dj": {"category_in": ["club", "beach_club", "nightclub"], "vibe": "electro"},
    "rumba": {"category_in": ["club", "beach_club", "nightclub"]},
    "salsa": {"category_in": ["club", "beach_club", "nightclub"], "vibe": "salsa"},
    "reggaeton": {"category_in": ["club", "beach_club", "nightclub"], "vibe": "reggaeton"},
    "champeta": {"category_in": ["club", "beach_club", "nightclub"], "vibe": "champeta"},

    # ── Rooftop / aperitivo / vista al mar ──
    "rooftop": {"vibe": "rooftop"}, "terraza": {"vibe": "rooftop"}, "terrasse": {"vibe": "rooftop"},
    "azotea": {"vibe": "rooftop"}, "skybar": {"vibe": "rooftop"}, "terraço": {"vibe": "rooftop"},
    "apero": {"vibe": "aperitivo"}, "apéro": {"vibe": "aperitivo"}, "aperitivo": {"vibe": "aperitivo"},
    "aperitif": {"vibe": "aperitivo"}, "happy hour": {"vibe": "aperitivo"},
    "vista al mar": {"vibe": "sea_view"}, "vue mer": {"vibe": "sea_view"},
    "ocean view": {"vibe": "sea_view"}, "vista mar": {"vibe": "sea_view"},

    # ── Special occasions ──
    "wedding": {"category_in": ["restaurant", "hotel", "beach_club"]},
    "boda": {"category_in": ["restaurant", "hotel", "beach_club"]},
    "mariage": {"category_in": ["restaurant", "hotel", "beach_club"]},
    "casamento": {"category_in": ["restaurant", "hotel", "beach_club"]},
    "proposal": {"category_in": ["restaurant", "bar", "spa"]},
    "propuesta": {"category_in": ["restaurant", "bar", "spa"]},
    "honeymoon": {"category_in": ["hotel", "spa", "restaurant"]},
    "luna de miel": {"category_in": ["hotel", "spa", "restaurant"]},
    "lune de miel": {"category_in": ["hotel", "spa", "restaurant"]},
    "lua de mel": {"category_in": ["hotel", "spa", "restaurant"]},
}


def _extract_filters_from_text(text: str) -> Dict[str, Any]:
    """Use simple keyword matching to extract semantic filters from the user message.
    This is the FALLBACK path used when LLM intent routing fails."""
    t = (text or "").lower()
    filters: Dict[str, Any] = {}
    for kw, fil in _KEYWORD_FALLBACK.items():
        if kw in t:
            for k, v in fil.items():
                if k not in filters:
                    filters[k] = v
    return filters


# ────────────────────────────────────────────────
# Taxonomy cache — avoids hitting MongoDB distinct() on every request
# ────────────────────────────────────────────────

_taxonomy_cache: Dict[str, Any] = {"categories": [], "subcategories": [], "ts": 0.0}
_TAXONOMY_TTL = 300  # 5 minutes


async def _get_taxonomy(db) -> Tuple[List[str], List[str]]:
    """Return (categories, subcategories) from MongoDB, cached for 5 minutes."""
    now = time.time()
    if _taxonomy_cache["categories"] and (now - _taxonomy_cache["ts"]) < _TAXONOMY_TTL:
        return _taxonomy_cache["categories"], _taxonomy_cache["subcategories"]
    try:
        cats = await db.partners.distinct("category")
        subcats = await db.partners.distinct("subcategory")
        cats = [c for c in cats if c]
        subcats = [s for s in subcats if s]
        _taxonomy_cache["categories"] = cats
        _taxonomy_cache["subcategories"] = subcats
        _taxonomy_cache["ts"] = now
    except Exception as exc:
        logger.warning(f"[_get_taxonomy] Failed to load taxonomy: {exc}")
        # Return whatever we have cached, even if stale
    return _taxonomy_cache["categories"], _taxonomy_cache["subcategories"]


async def _route_intent(db, user_text: str) -> Dict[str, Any]:
    """Use a cheap Haiku call to map the user message to canonical categories/subcategories.

    Returns a dict like:
        {
            "categories": ["cafe", "restaurant"],
            "subcategories": ["coffee", "brunch"],
            "search_terms": ["latte", "cafe"],
            "intent_type": "recommendation"
        }

    Falls back to empty routing (diverse partners) if the LLM call fails.
    """
    from llm import llm_complete

    categories, subcategories = await _get_taxonomy(db)

    if not categories:
        # If taxonomy is empty, fall back gracefully
        return {"categories": [], "subcategories": [], "search_terms": [], "intent_type": "general"}

    routing_prompt = f"""You are a routing classifier for a Cartagena concierge app. Given a user message, map it to the app's taxonomy.

AVAILABLE CATEGORIES (from database):
{json.dumps(categories, ensure_ascii=False)}

AVAILABLE SUBCATEGORIES (from database):
{json.dumps(subcategories, ensure_ascii=False)}

Return ONLY valid JSON (no markdown, no explanation):
{{
  "categories": ["<1-3 matching categories from the list above, or empty if none fit>"],
  "subcategories": ["<0-3 matching subcategories from the list above, or empty>"],
  "search_terms": ["<1-4 keywords to text-search in partner name/description/cuisine/experience>"],
  "intent_type": "<one of: recommendation, essentials, logistics, events, general>"
}}

RULES:
- Only use categories/subcategories that EXIST in the lists above.
- "recommendation" = user wants a place (restaurant, bar, hotel, beach, spa, activity, etc.)
- "essentials" = user asks about safety, money, emergency, health, SIM cards, ATMs
- "logistics" = user asks about transport, taxis, airport, boats, getting around
- "events" = user asks about concerts, parties, what's on tonight, agenda
- "general" = greetings, small talk, general Cartagena questions
- search_terms should capture the SPECIFIC thing the user wants (e.g. "latte", "lobster", "matcha", "rooftop", "sunset")
- If the user says "bar" include "bar" in categories. If they say "coffee" or "latte" include "cafe" in categories.
- Be generous with categories: if unsure, include 2-3 plausible categories."""

    try:
        raw = await llm_complete(
            routing_prompt,
            user_text,
            model="claude-haiku-4-5",
            max_tokens=300,
            temperature=0.0,
        )
        if not raw:
            return {"categories": [], "subcategories": [], "search_terms": [], "intent_type": "general"}

        parsed = json.loads(raw)
        # Validate and sanitize
        result: Dict[str, Any] = {
            "categories": [c for c in (parsed.get("categories") or []) if isinstance(c, str)][:3],
            "subcategories": [s for s in (parsed.get("subcategories") or []) if isinstance(s, str)][:3],
            "search_terms": [t for t in (parsed.get("search_terms") or []) if isinstance(t, str)][:4],
            "intent_type": parsed.get("intent_type", "general"),
        }
        if result["intent_type"] not in {"recommendation", "essentials", "logistics", "events", "general"}:
            result["intent_type"] = "general"
        return result

    except json.JSONDecodeError:
        logger.warning(f"[_route_intent] Failed to parse LLM routing response")
        return {"categories": [], "subcategories": [], "search_terms": [], "intent_type": "general"}
    except Exception as exc:
        logger.warning(f"[_route_intent] LLM routing failed: {exc}")
        return {"categories": [], "subcategories": [], "search_terms": [], "intent_type": "general"}


async def _smart_partner_query(db, user_text: str, max_results: int = 50) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Build a relevance-filtered partner list based on the user's question.

    Strategy:
    1. Try LLM-based intent routing (cheap Haiku call) for accurate category mapping.
    2. If LLM routing fails or returns nothing, fall back to keyword matching.
    3. Build a Mongo query from the routed categories/subcategories + text search.
    4. If nothing matches, return a diverse top-50 sample.
    """
    fields = {
        "_id": 0, "partner_id": 1, "name": 1, "category": 1, "subcategory": 1,
        "tier": 1, "price_range": 1, "address": 1, "cuisine": 1, "rating": 1,
        "reviews": 1, "description": 1,
        "is_government": 1, "experience": 1, "instagram": 1, "booking_link": 1,
        "phone": 1, "hours": 1, "schedule": 1, "features": 1, "neighborhood": 1,
        "search_profile": 1,
    }

    # ── Step 1: Try LLM intent routing ──
    routed = await _route_intent(db, user_text)
    routed_cats = routed.get("categories") or []
    routed_subcats = routed.get("subcategories") or []
    search_terms = routed.get("search_terms") or []
    used_llm_routing = bool(routed_cats or routed_subcats or search_terms)

    # ── Step 2: If LLM routing returned nothing useful, fall back to keyword matching ──
    semantic: Dict[str, Any] = {}
    if not used_llm_routing:
        semantic = _extract_filters_from_text(user_text)

    query: Dict[str, Any] = {}

    if used_llm_routing:
        # Build query from LLM-routed categories/subcategories
        conditions: List[Dict[str, Any]] = []
        if routed_cats:
            if len(routed_cats) == 1:
                conditions.append({"category": routed_cats[0]})
            else:
                conditions.append({"category": {"$in": routed_cats}})
        if routed_subcats:
            if len(routed_subcats) == 1:
                conditions.append({"subcategory": routed_subcats[0]})
            else:
                conditions.append({"subcategory": {"$in": routed_subcats}})

        # Text-search search_terms against multiple fields
        if search_terms:
            term_regex = "|".join(re.escape(t) for t in search_terms)
            text_or = [
                {"name": {"$regex": term_regex, "$options": "i"}},
                {"experience": {"$regex": term_regex, "$options": "i"}},
                {"description": {"$regex": term_regex, "$options": "i"}},
                {"cuisine": {"$regex": term_regex, "$options": "i"}},
                {"subcategory": {"$regex": term_regex, "$options": "i"}},
                {"search_profile": {"$regex": term_regex, "$options": "i"}},
            ]
            conditions.append({"$or": text_or})

        if conditions:
            if len(conditions) == 1:
                query = conditions[0]
            else:
                # Use $or at top level so we get partners matching category OR search terms
                # (not $and, which would be too restrictive)
                query = {"$or": conditions}
    else:
        # Keyword fallback path (same as original logic)
        if "category" in semantic:
            query["category"] = semantic["category"]
        elif "category_in" in semantic:
            query["category"] = {"$in": semantic["category_in"]}
        if "subcategory" in semantic:
            query["subcategory"] = semantic["subcategory"]
        if "tier" in semantic:
            query["tier"] = semantic["tier"]

        # Vibe-based fuzzy filter
        vibe = semantic.get("vibe")
        if vibe:
            vibe_regex_map = {
                "rooftop": r"rooftop|terraza|terrasse|skybar|azotea|terra[cç]o|roof top|sky bar",
                "aperitivo": r"apero|ap[eé]ro|aperitivo|aperitif|happy hour|cocktail|coctel|bar|lounge",
                "sunset": r"sunset|atardecer|coucher de soleil|p[oô]r do sol|crep[uú]sculo|golden hour",
                "sea_view": r"vista al mar|sea view|ocean view|vue mer|vista mar|frente al mar|beachfront|playa",
                "electro": r"electro|electronic|electr[oó]nica|techno|house|dj|dance|deep house|edm",
                "salsa": r"salsa|son cubano|son|guaracha",
                "reggaeton": r"reggaeton|reggaet[oó]n|perreo|urbano",
                "champeta": r"champeta|caribe|caribbean|afro caribe",
            }
            regex = vibe_regex_map.get(vibe)
            if regex:
                or_clause = [
                    {"name": {"$regex": regex, "$options": "i"}},
                    {"experience": {"$regex": regex, "$options": "i"}},
                    {"subcategory": {"$regex": regex, "$options": "i"}},
                    {"features": {"$regex": regex, "$options": "i"}},
                    {"address": {"$regex": regex, "$options": "i"}},
                ]
                if query:
                    query = {"$and": [query, {"$or": or_clause}]}
                else:
                    query = {"$or": or_clause}

        free_text = (user_text or "").strip()
        if free_text and len(free_text) > 2 and not query:
            query["$or"] = [
                {"name": {"$regex": free_text[:50], "$options": "i"}},
                {"experience": {"$regex": free_text[:50], "$options": "i"}},
            ]

    cursor = db.partners.find(query, fields).sort([("rating", -1), ("reviews", -1)]).limit(max_results)
    rows = await cursor.to_list(max_results)

    # If LLM-routed query returned empty, try with just category (drop search_terms)
    if not rows and used_llm_routing and routed_cats:
        fallback_q: Dict[str, Any] = {"category": {"$in": routed_cats}} if len(routed_cats) > 1 else {"category": routed_cats[0]}
        cursor = db.partners.find(fallback_q, fields).sort([("rating", -1), ("reviews", -1)]).limit(max_results)
        rows = await cursor.to_list(max_results)

    # Keyword fallback: broader bar/restaurant pool
    if not rows and not used_llm_routing:
        vibe = semantic.get("vibe")
        if (
            vibe in {"aperitivo", "sunset", "rooftop", "sea_view", "electro", "salsa", "reggaeton", "champeta"}
            or "category_in" in semantic
        ):
            cats = semantic.get("category_in") or ["bar", "club", "beach_club", "nightclub", "restaurant"]
            cursor = db.partners.find(
                {"category": {"$in": cats}}, fields,
            ).sort([("rating", -1), ("reviews", -1)]).limit(max_results)
            rows = await cursor.to_list(max_results)

    # Ultimate fallback: diverse top partners
    if not rows:
        cursor = db.partners.find({}, fields).sort([("rating", -1), ("reviews", -1)]).limit(max_results)
        rows = await cursor.to_list(max_results)

    return rows, routed


# ────────────────────────────────────────────────
# DROP 3: Knowledge Spine — structured local knowledge for essentials/logistics
# ────────────────────────────────────────────────

CARTAGENA_KNOWLEDGE: Dict[str, Any] = {
    "emergencies": {
        "police": "123",
        "fire": "125",
        "ambulance": "132",
        "tourist_police": "Calle de la Tablada, Centro Historico (near Plaza Santo Domingo). Bilingual officers available.",
        "english_speaking_clinics": [
            {"name": "Hospital Universitario del Caribe", "note": "Public hospital, emergency dept, some English-speaking staff"},
            {"name": "Medihelp", "note": "Private clinic popular with tourists, English-speaking doctors, Bocagrande"},
        ],
    },
    "transport": {
        "airport": "Rafael Nunez International (CTG), ~15 min to Centro Historico by taxi",
        "taxis": "Safe if official (yellow). No meter — agree on price BEFORE. ~$15,000-25,000 COP within city. Uber/InDriver/DiDi work but legally grey.",
        "water_taxis": "To islands from Muelle de la Bodeguita (main dock, Centro) and Muelle de Manga. Tasa Portuaria required (~$31,500 COP/person).",
        "transcaribe": "TransCaribe bus system, prepaid card, covers Bocagrande-Centro-Manga corridor. Cheap but crowded.",
        "cruise_terminal": "SPRC terminal in Manga, ~10-15 min to Centro Historico by taxi.",
    },
    "money": {
        "currency": "Colombian Peso (COP). 1 USD ~ 4,200 COP (varies).",
        "usd_accepted": "USD widely accepted in tourist areas (hotels, tours, some restaurants). Change given in COP.",
        "tipping": "10% voluntary service charge at restaurants (can decline). Tip porters, guides, boat captains.",
        "atms": "Bancolombia ATMs give best rate. Found in Bocagrande, Centro, and malls. Daily limit ~$600,000 COP.",
        "exchange_houses": "Casas de cambio in Centro (near Torre del Reloj) and Bocagrande. Compare rates. Avoid street changers.",
    },
    "safety": {
        "safe_zones": "Centro Historico, Getsemani, Bocagrande, Castillogrande, San Diego are safe during the day. Normal caution at night.",
        "avoid": "San Francisco and Nelson Mandela neighborhoods. Bazurto market at night.",
        "tips": "Don't flash valuables. Use official taxis or ride apps. Keep phone in front pocket. Use hotel safe for passport.",
    },
    "neighborhoods": {
        "centro_historico": "Colonial walled city. UNESCO World Heritage. Romantic, museums, galleries, premium dining. Walk everywhere.",
        "getsemani": "Bohemian quarter. Street art, hostels, Plaza Trinidad nightlife, salsa bars, budget-friendly. Rapidly gentrifying.",
        "bocagrande": "Modern high-rise zone. Beach (urban), malls, banks, pharmacies, chain hotels. Convenient but less authentic.",
        "manga": "Local residential. Cruise terminal area. Some excellent restaurants (Club de Pesca). Real neighborhood feel.",
        "castillogrande": "Quiet peninsula. Resort hotels. Beautiful sunset views. Low-key beach. Good for families.",
    },
    "islands": {
        "tierra_bomba": "30 min by boat. Half-day trip. Budget to luxury beach clubs (Fenix, Makani, Namaste). Most accessible island.",
        "islas_del_rosario": "1-1.5 hr by boat. Full day trip. Snorkeling, diving, premium beach clubs (Bora Bora, Blue Apple, PA'UE). Depart ~8-9am.",
        "baru_playa_blanca": "1 hr by boat or 50 min by road. Most famous beach in Cartagena. Can be crowded. Hotel Las Islas for ultra-luxury.",
        "cholon": "Part of Rosario archipelago. Party island. Floating bars, music, groups. Full day trip.",
    },
}


async def _slim_all_partners_compact(db, limit: int = 200) -> List[Dict[str, Any]]:
    """Compact list of ALL partners — minimal fields, used as the 'master directory' the LLM scans."""
    cursor = db.partners.find({}, {
        "_id": 0, "partner_id": 1, "name": 1, "category": 1, "subcategory": 1,
        "tier": 1, "price_range": 1, "rating": 1,
    }).sort([("rating", -1), ("reviews", -1)]).limit(limit)
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
    # Relevance-filtered partners (rich data) — pre-filtered using LLM routing with keyword fallback
    relevant_partners, routed_intent = await _smart_partner_query(db, user_text, max_results=40)
    intent_type = routed_intent.get("intent_type", "general")
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
    # Curated knowledge base matching
    from knowledge import match_knowledge
    curated = match_knowledge(user_text, top_k=5)
    ctx: Dict[str, Any] = {
        "today": datetime.now(timezone.utc).strftime("%A %Y-%m-%d"),
        "user": {
            "name": (user or {}).get("name"),
            "is_logged_in": bool(user),
            "has_active_city_pass": has_pass,
            **({"profile": {
                "user_type": profile.get("user_type"),
                "party_type": profile.get("party_type"),
                "interests": profile.get("interests", []),
                "travel_dates": profile.get("travel_dates"),
            }} if (profile := (user or {}).get("_profile")) else {}),
        } if user else {"is_logged_in": False},
        "port_tax_price_cop": port_tax_price,
        "city_pass_plans": [
            {"plan_id": "pass_basic", "name": "Explorer", "price_cop": 99000},
            {"plan_id": "pass_classic", "name": "Classic", "price_cop": 200000},
            {"plan_id": "pass_premium", "name": "Premium", "price_cop": 350000},
            {"plan_id": "pass_ultimate", "name": "Ultimate", "price_cop": 599000},
        ],
        "partner_categories": ["restaurant", "hotel", "beach_club", "bar", "club", "cafe", "spa", "beauty", "activity", "yacht", "attraction", "service"],
        "inventory_summary": inventory_summary,  # counts per category/subcategory
        "semantic_filters_detected": semantic_filters,
        **({"curated_recommendations": curated} if curated else {}),
        "intent_routing": routed_intent,  # LLM-routed intent (categories, subcategories, search_terms, intent_type)
        "relevant_partners": relevant_partners,  # rich data for top matches
        "all_partners_directory": all_partners,  # full catalog (compact)
        "upcoming_events": upcoming_events,
        "partner_curated_events": partner_events,  # daypass / sunset etc
        "tabs": ["agenda", "concerts", "partners", "citypass", "transport", "itineraries"],
    }
    # Include knowledge spine for essentials/logistics queries
    if intent_type in {"essentials", "logistics"}:
        ctx["cartagena_knowledge"] = CARTAGENA_KNOWLEDGE
    return ctx


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
CONOCIMIENTO LOCAL DE CARTAGENA (usá esto para dar contexto experto)
══════════════════════════════════════════
BARRIOS Y ZONAS:
- Centro Histórico (Ciudad Amurallada): UNESCO, colonial, restaurantes premium, galerías, San Pedro Claver, Catedral, Plaza Santo Domingo (Botero). Caminar es la mejor forma de moverse.
- San Diego: dentro de las murallas, más tranquilo, boutique hotels, Las Bóvedas artesanías. Café del Mar está en la muralla.
- Getsemaní: barrio bohemio, street art, Plaza Trinidad vida nocturna, hostels, salsa en vivo (Café Havana, Bazurto Social Club). Más económico que Centro.
- Bocagrande: zona hotelera moderna, playas urbanas, centros comerciales, bancos, farmacias. Más cómodo pero menos auténtico.
- Manga: barrio residencial, terminal de cruceros SPRC (3.2km del Centro), restaurantes locales.
- Castillogrande/El Laguito: peninsular, hoteles resort, tranquilo, sunset bonito.
- Crespo: cerca del aeropuerto, residencial.
ISLAS:
- Islas del Rosario: 45 min en lancha, snorkel, beach clubs premium (Bora Bora, Capri, Blue Apple, PA'UE). Salida desde Muelle de la Bodeguita ~8-9am.
- Barú: acceso por carretera (50 min) o lancha. Playa Blanca (la más famosa pero crowded). Hotel Las Islas (ultra-lujo).
- Tierra Bomba: 10-20 min lancha, más accesible, beach clubs variados (Makani luxury, Namaste wellness, Fenix, Carex). Mejor opción para medio día.
TRANSPORTE:
- Uber/InDriver/DiDi funcionan pero son legalmente grises. Recomendados sobre taxis callejeros de noche.
- Taxis amarillos: SIN taxímetro — acordar precio ANTES.
- Lanchas a islas: Muelle de la Bodeguita (principal) y Muelle de los Pegasos.
- Tasa Portuaria: ~$31,500 COP/persona para ir a las islas.
DATOS CLAVE:
- Moneda: Peso colombiano (COP). ATMs de Bancolombia dan mejor tasa.
- Propina: ~10% "servicio voluntario" en restaurantes.
- Clima: caliente todo el año (28-32°C). Dic-Abr seco. Jul-Aug lluvias cortas.
- Seguridad: Centro/Getsemaní/Bocagrande son seguros. Evitar Bazurto de noche.
- Celular: SIM prepago Claro tiene mejor cobertura.
- La Patrona de Cartagena es la Virgen de la Candelaria (2 de febrero).
HIGHLIGHTS:
- Alquímico: #11 en World's 50 Best Bars. 3 pisos de cócteles artesanales.
- Celele: #5 en Latin America's 50 Best Restaurants. Tasting menu caribeño.
- Castillo San Felipe: la fortaleza española más grande de las Américas.
- Café Havana: salsa en vivo legendaria. Clinton bailó acá.

══════════════════════════════════════════
TU TRABAJO
══════════════════════════════════════════
- Recomendás eventos, restaurantes, hoteles, beach clubs, paseos a las islas.
- Iniciás compras (Tasa Portuaria, City Pass) cuando el usuario lo pide claramente.
- Si el usuario pregunta algo general de Cartagena (historia, clima, seguridad) respondés con conocimiento local.
- ⚠️ **PERSONALIZACIÓN**: Si `user.profile` existe en el contexto, usalo para adaptar recomendaciones:
  • `party_type=cruise` → priorizá lugares CENTRALES cerca del puerto, eficientes en tiempo (6-8 horas max), no nightlife.
  • `party_type=couple` → priorizá romántico, íntimo, especial (rooftops, cenas privadas, spa).
  • `party_type=family` → priorizá familiar, seguro, actividades para niños.
  • `party_type=friends` → priorizá diversión, energía, grupo (beach clubs, clubs, bares).
  • `user_type=local` → evitá lo turístico obvio, sugerí descubrimientos y nuevos.
  • `interests` → priorizá categorías que coincidan con sus intereses del onboarding.
- ⚠️ **CALIDAD DE RECOMENDACIÓN**: Cuando recomendés un lugar, SIEMPRE incluí UNA LÍNEA explicando POR QUÉ ese lugar específico encaja con lo que el usuario pidió.
- ⚠️ **HONESTIDAD**: Cuando nada en el catálogo coincide con lo que el usuario pide, decilo honestamente y ofrecé la alternativa real más cercana. NUNCA inventés un nombre de venue, dirección, teléfono o precio.
- ⚠️ **PERFIL DEL USUARIO**: Usá `user.profile` (user_type, party_type, interests, travel_dates) del contexto para ponderar recomendaciones: pasajeros de crucero → central/caminable/eficiente; parejas → romántico/íntimo; familias → kid-friendly/seguro; locales → hidden gems/descubrimientos.
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
RECOMENDACIONES CURADAS (PRIORIDAD MÁXIMA)
══════════════════════════════════════════
Si `curated_recommendations` aparece en el contexto, estas son recomendaciones de un EXPERTO LOCAL que conoce la ciudad.
- Los venues están en ORDEN DE PRIORIDAD (el primero es el mejor).
- SIEMPRE priorizá estas recomendaciones sobre el ranking por rating del catálogo general.
- Usá los nombres exactos de las recomendaciones curadas y buscá su partner_id en `relevant_partners` o `all_partners_directory` para armar las tarjetas.
- Si un venue curado no aparece en el catálogo de la app, mencionalo en el texto del mensaje pero no lo pongas en recommendations (no podemos linkear a algo que no existe).
- Las recomendaciones curadas cubren categorías muy específicas: coctelería, rooftops, reguetón, brunch, sushi, etc. Usá la categoría y pregunta como guía de lo que el usuario realmente busca.

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

    from llm import llm_complete

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

    response = await llm_complete(
        system_msg, json.dumps(user_payload, ensure_ascii=False),
        model="claude-sonnet-4-6",
        max_tokens=2048,
        temperature=0.7,
    )

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
