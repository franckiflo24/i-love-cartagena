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
from partner_visibility import PUBLIC_PARTNER_FILTER, PUBLIC_CITY_EVENT_FILTER  # U4: Luna never recommends unapproved venues/events
from events_time import upcoming_query, filter_live, now_bogota  # Luna's "now" is Bogota; passed events fall out
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
    # Espresso-drink vocabulary — parity with /api/search coffee anchoring
    "macchiato": {"category": "cafe"}, "latte": {"category": "cafe"},
    "cortado": {"category": "cafe"}, "espresso": {"category": "cafe"},
    "capuchino": {"category": "cafe"}, "cappuccino": {"category": "cafe"},
    "tinto": {"category": "cafe"}, "flat white": {"category": "cafe"},
    "cold brew": {"category": "cafe"},
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


import unicodedata as _ud


def _strip_accents(s: str) -> str:
    return "".join(c for c in _ud.normalize("NFD", s or "") if _ud.category(c) != "Mn")


# Generic words that name a whole category (handled by category routing) — excluded
# from the distinctive stems so "mediterranean restaurant" recalls the mediterranean
# venues, not every restaurant.
_STEM_STOPWORDS = {
    "el", "la", "de", "en", "un", "una", "los", "las", "que", "es", "para", "con",
    "the", "a", "an", "in", "of", "for", "to", "is", "i", "my", "me", "do", "can",
    "where", "what", "how", "want", "quiero", "donde", "cual", "como", "busco",
    "recomienda", "recomiendame", "cerca", "near", "best", "mejor", "mejores", "good",
    "restaurant", "restaurante", "restaurantes", "comida", "food", "lugar", "sitio",
    "place", "bar", "cafe", "hotel", "spa", "club", "algo", "sitios", "lugares",
    # City/country + filler adjectives — a stem like 'cartag' from "cartagena" matched
    # EVERY "…Cartagena" venue name and _relevance_rerank then floated those yachts/
    # hotels above the real category. This is the same junk-token class as the other
    # three stopword sets; keep them in lockstep.
    "cartagena", "indias", "colombia", "ciudad", "city", "ciudade",
    "great", "top", "nice", "cool", "bueno", "buena", "buen", "buenos", "buenas",
    "cherche", "meilleur", "meilleure", "melhor", "melhores", "bom", "boa",
}


def _query_stems(search_terms, user_text: str):
    """Accent-stripped 6-char prefix stems of the distinctive query words. A prefix
    stem bridges EN/ES morphology and accents WITHOUT a per-word synonym table:
    barbero→'barber' (matches barber/barbershop/barbería), bohème→'boheme' (matches
    Bohême), mediterranean/mediterráneo→'medite' (and 'medite' does NOT prefix
    'medicina', so aesthetic-medicine venues are not pulled in)."""
    words = list(search_terms or [])
    words += _strip_accents((user_text or "").lower()).split()
    stems, seen = [], set()
    for w in words:
        w = _strip_accents(str(w).lower()).strip()
        if len(w) < 4 or w in _STEM_STOPWORDS:
            continue
        stem = w[:6] if len(w) > 6 else w
        if stem not in seen:
            seen.add(stem)
            stems.append(stem)
    return stems[:6]


def _accent_flex(frag: str) -> str:
    """Turn an accent-stripped fragment into an accent-insensitive regex fragment."""
    m = {"a": "[aáàäâ]", "e": "[eéèëê]", "i": "[iíìïî]", "o": "[oóòöô]", "u": "[uúùüû]", "n": "[nñ]", "c": "[cç]"}
    return "".join(m.get(ch, re.escape(ch)) for ch in frag)


def _relevance_rerank(rows, stems):
    """Re-order fetched rows by how well name/subcategory/cuisine/category/tags match
    the query stems (accent-insensitive), rating as the tiebreak. Pure reordering —
    it never drops or invents a venue. Fixes the rating-sorted pool burying the venue
    the user actually asked for (Casa Bohême under generic 'Casa' hotels; barbershops
    under higher-rated nail salons)."""
    if not rows or not stems:
        return rows

    def sc(p):
        name = _strip_accents((p.get("name") or "").lower())
        sub = _strip_accents((p.get("subcategory") or "").lower())
        cui = _strip_accents((p.get("cuisine") or "").lower())
        cat = _strip_accents((p.get("category") or "").lower())
        tags = _strip_accents(" ".join(p.get("tags") or []).lower())
        stags = _strip_accents(" ".join(p.get("style_tags") or []).lower())
        s = 0
        for st in stems:
            if st in name: s += 6
            if st in sub: s += 4
            if st in cui: s += 4
            if st in stags: s += 4
            if st in cat: s += 2
            if st in tags: s += 1
        # tiebreak by rank_score (tier + claimed + engagement) so among equally-relevant
        # venues the elite/claimed/high-engagement ones surface first.
        return (s, p.get("rank_score") or 0, p.get("rating") or 0)

    return sorted(rows, key=sc, reverse=True)


# DB categories were renamed in CATALOG-MIGRATE (spa→wellness, club→nightlife).
# Normalize legacy keys so every existing keyword/synonym mapping — which still says
# spa/club — resolves to the live category instead of returning zero.
_CAT_ALIAS = {"spa": "wellness", "club": "nightlife"}

def _alias_cats(cats):
    return [_CAT_ALIAS.get(c, c) for c in (cats or [])]

# Multilingual cuisine terms → canonical style_tags (the enriched multi-cuisine field),
# so "mariscos"/"seafood" both hit style_tags:seafood, "mediterránea"/"mediterranean"
# hit :mediterranean, "árabe"/"lebanese" hit :middle_eastern — both languages, one venue set.
_TAG_SYN = {
    "seafood": "seafood", "mariscos": "seafood", "pescado": "seafood", "ceviche": "seafood",
    "mediterranean": "mediterranean", "mediterranea": "mediterranean", "mediterraneo": "mediterranean",
    "middle_eastern": "middle_eastern", "arabe": "middle_eastern", "arabic": "middle_eastern",
    "libanes": "middle_eastern", "libanesa": "middle_eastern", "lebanese": "middle_eastern",
    "marroqui": "middle_eastern", "moroccan": "middle_eastern", "turco": "middle_eastern", "turkish": "middle_eastern",
    "italian": "italian", "italiana": "italian", "italiano": "italian", "pizza": "italian", "pasta": "italian",
    "french": "french", "francesa": "french", "frances": "french",
    "spanish": "spanish", "espanola": "spanish", "espanol": "spanish", "tapas": "spanish", "paella": "spanish",
    "mexican": "mexican", "mexicana": "mexican", "tacos": "mexican",
    "peruvian": "peruvian", "peruana": "peruvian", "nikkei": "peruvian",
    "asian": "asian", "asiatica": "asian", "asiatico": "asian", "thai": "thai", "tailandesa": "thai",
    "sushi": "sushi", "japonesa": "sushi", "japanese": "sushi",
    "colombian": "colombian", "colombiana": "colombian", "tipica": "colombian",
    "caribbean": "caribbean", "caribena": "caribbean", "caribeno": "caribbean",
    "healthy": "healthy", "saludable": "healthy", "vegano": "healthy", "vegetariano": "healthy", "vegan": "healthy",
    "grill": "grill", "parrilla": "grill", "asado": "grill", "steak": "grill", "carnes": "grill",
    "fine_dining": "fine_dining", "gourmet": "fine_dining",
    "fast_food": "fast_food", "burger": "fast_food", "hamburguesa": "fast_food",
    "cafe_brunch": "cafe_brunch", "brunch": "cafe_brunch", "desayuno": "cafe_brunch",
    "fusion": "fusion", "international": "international", "internacional": "international",
    "cocktails": "cocktails", "cocteles": "cocktails", "coctel": "cocktails",
}

# "Mediterranean" is a basin, not one cuisine: a guest asking for Mediterranean
# means the Levantine/Arab, Spanish, French and Greek kitchens too — expand it so
# the search returns the whole family, not only the 4 tagged literally 'mediterranean'.
_TAG_EXPAND = {
    "mediterranean": ["mediterranean", "middle_eastern", "spanish", "french", "greek"],
}

def _canonical_tags(terms):
    out = []
    for t in terms or []:
        k = _strip_accents(str(t).lower()).strip()
        if k in _TAG_SYN:
            for tag in _TAG_EXPAND.get(_TAG_SYN[k], [_TAG_SYN[k]]):
                if tag not in out:
                    out.append(tag)
    return out


def _extract_filters_from_text(text: str) -> Dict[str, Any]:
    """Extract semantic filters (category/subcategory) from the user message via the
    keyword map. WORD-AWARE, not raw substring: a plain `kw in t` let 'bar' match
    'BARbershop' (→ bar/club/beach_club) and 'art' match 'cARTagena' (→ culture), so
    "best barbershop in cartagena" got routed to bars + events and Luna wrongly said it
    had no barbershops. Rule: multi-word/hyphen keys → phrase match; single keys ≥4
    chars → a query WORD that equals or STARTS WITH the key (barber→barbershop/barbers,
    restaurant→restaurantes); short keys (<4 chars: bar, spa, art, gym, pub…) → exact
    word only, so they can't hide inside a longer unrelated word. Mirrors the
    word-boundary fix already on intent-type routing (_kw_hit)."""
    t = (text or "").lower()
    words = re.findall(r"[0-9a-záéíóúñüçàâêôãõ]+", t)
    wordset = set(words)
    filters: Dict[str, Any] = {}
    for kw, fil in _KEYWORD_FALLBACK.items():
        if " " in kw or "-" in kw:
            matched = kw in t
        elif len(kw) >= 4:
            matched = any(w == kw or w.startswith(kw) for w in words)
        else:
            matched = kw in wordset
        if matched:
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
    """Route user intent using the 525-entry keyword fallback — instant, no LLM call.

    The Haiku LLM routing was removed because:
    1. It failed to parse JSON responses ~50% of the time
    2. Each failed call wasted 3-5 seconds of latency
    3. The keyword fallback (525 entries across EN/ES/FR/PT) now covers all cases
       that LLM routing was supposed to handle

    Returns a dict like:
        {
            "categories": ["cafe", "restaurant"],
            "subcategories": ["coffee", "brunch"],
            "search_terms": ["latte", "cafe"],
            "intent_type": "recommendation"
        }
    """
    semantic = _extract_filters_from_text(user_text)

    categories: List[str] = []
    subcategories: List[str] = []
    search_terms: List[str] = []

    if "category" in semantic:
        categories.append(semantic["category"])
    if "category_in" in semantic:
        categories.extend(semantic["category_in"])
    if "subcategory" in semantic:
        subcategories.append(semantic["subcategory"])

    # Extract meaningful words as search terms (skip very short/common words)
    t = (user_text or "").lower().strip()
    stopwords = {"el", "la", "de", "en", "un", "una", "los", "las", "que", "es",
                 "para", "con", "the", "a", "an", "in", "of", "for", "to", "is",
                 "i", "my", "me", "do", "can", "where", "what", "how", "want",
                 "quiero", "donde", "cual", "como",
                 # City/country + filler adjectives carry ZERO discriminative signal —
                 # as free-text search terms they matched every "…Cartagena" venue NAME
                 # (yachts, hotels, tours) which then floated to the top by rank_score and
                 # buried the routed category (barbershop → beauty). Mirrors global_search
                 # _STOP_WORDS/_GENERIC_TERMS. Neighborhoods are handled separately.
                 "cartagena", "indias", "colombia", "ciudad", "city", "ciudade",
                 "best", "mejor", "mejores", "bueno", "buena", "buen", "buenos", "buenas",
                 "good", "great", "top", "nice", "cool", "cerca", "near", "recomienda",
                 "cherche", "meilleur", "meilleure", "melhor", "melhores", "bom", "boa"}
    search_terms = [w for w in t.split() if len(w) >= 3 and w not in stopwords][:4]

    # Detect intent type
    intent_type = "general"
    event_kws = {"event", "evento", "concert", "concierto", "tonight", "noche",
                 "esta noche", "agenda", "hoy", "ce soir", "hoje"}
    essential_kws = {"money", "dinero", "safe", "seguro", "emergency", "emergencia",
                     "hospital", "pharmacy", "farmacia", "atm", "cajero", "sim", "esim",
                     "agua", "water", "clinic", "clinica", "clínica",
                     "supermercado", "supermarket", "laundry", "lavandería", "lavanderia",
                     # Every essentials taxonomy category MUST have a trigger, or the honesty
                     # layer (essentials_layer) never loads and Luna answers ungrounded — the
                     # exact invention risk for health/safety categories (adversarial CAT-HIGH).
                     "médico", "medico", "doctor", "enfermo", "fiebre", "vacuna", "ambulancia",
                     "veterinario", "veterinaria", "mascota",
                     "coworking", "maleta", "equipaje", "luggage", "guardaequipaje",
                     "dólares", "dolares", "exchange"}
    # Word-BOUNDARY match, not substring: "vet"∈muévete, "agua"∈aguacate, "bus"∈busca
    # were misrouting normal queries into essentials/logistics (adversarial re-audit).
    # Ambiguous real-words (vet/perro/gato/banco/cambio) dropped — mascota/veterinario/
    # dólares/exchange cover the real intent without the collisions.
    def _kw_hit(kws):
        return any(re.search(rf"(?<!\w){re.escape(kw)}(?!\w)", t) for kw in kws)
    logistics_kws = {"taxi", "uber", "airport", "aeropuerto", "boat", "lancha",
                     "transport", "transporte", "transfer", "bus"}
    if _kw_hit(event_kws):
        intent_type = "events"
    elif _kw_hit(essential_kws):
        intent_type = "essentials"
    elif _kw_hit(logistics_kws):
        intent_type = "logistics"
    elif categories or subcategories:
        intent_type = "recommendation"

    # Deduplicate
    categories = list(dict.fromkeys(categories))[:3]
    subcategories = list(dict.fromkeys(subcategories))[:3]

    return {
        "categories": categories,
        "subcategories": subcategories,
        "search_terms": search_terms,
        "intent_type": intent_type,
    }


async def _smart_partner_query(db, user_text: str, max_results: int = 50) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Build a relevance-filtered partner list based on the user's question.

    Strategy:
    1. Try LLM-based intent routing (cheap Haiku call) for accurate category mapping.
    2. If LLM routing fails or returns nothing, fall back to keyword matching.
    3. Build a Mongo query from the routed categories/subcategories + text search.
    4. If nothing matches, return a diverse top-50 sample.
    """
    # Lean fields — only what the LLM needs to build recommendation cards.
    # Removed: description, search_profile, features, schedule, instagram,
    # booking_link, phone, is_government (saves ~60% tokens per partner)
    fields = {
        "_id": 0, "partner_id": 1, "name": 1, "category": 1, "subcategory": 1,
        "tier": 1, "price_range": 1, "address": 1, "rating": 1,
        "neighborhood": 1, "experience": 1, "tags": 1, "signature_dishes": 1,
        "zone": 1, "serves_destinations": 1, "status": 1,
        "cuisine": 1,  # needed for cuisine-based recall/ranking (e.g. "Mediterráneo")
        "style_tags": 1, "rank_score": 1, "brand": 1,  # enriched catalog (CATALOG-MIGRATE)
    }

    # ── Step 1: Try LLM intent routing ──
    routed = await _route_intent(db, user_text)
    routed_cats = _alias_cats(routed.get("categories") or [])  # spa→wellness, club→nightlife
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

        # Text-search search_terms against multiple fields (incl. the enriched style_tags)
        if search_terms:
            term_regex = "|".join(re.escape(t) for t in search_terms)
            text_or = [
                {"name": {"$regex": term_regex, "$options": "i"}},
                {"experience": {"$regex": term_regex, "$options": "i"}},
                {"description": {"$regex": term_regex, "$options": "i"}},
                {"cuisine": {"$regex": term_regex, "$options": "i"}},
                {"subcategory": {"$regex": term_regex, "$options": "i"}},
                {"search_profile": {"$regex": term_regex, "$options": "i"}},
                {"tags": {"$regex": term_regex, "$options": "i"}},
                {"signature_dishes": {"$regex": term_regex, "$options": "i"}},
                {"style_tags": {"$regex": term_regex, "$options": "i"}},
            ]
            # Multilingual → canonical style_tags (mariscos→seafood, mediterránea→mediterranean…)
            canon = _canonical_tags(search_terms + (user_text or "").split())
            if canon:
                text_or.append({"style_tags": {"$in": canon}})
            conditions.append({"$or": text_or})

        if conditions:
            if len(conditions) == 1:
                query = conditions[0]
            else:
                # Use $or at top level so we get partners matching category OR search terms
                # (not $and, which would be too restrictive)
                query = {"$or": conditions}
    else:
        # Keyword fallback path (alias legacy spa/club → wellness/nightlife)
        if "category" in semantic:
            query["category"] = _CAT_ALIAS.get(semantic["category"], semantic["category"])
        elif "category_in" in semantic:
            query["category"] = {"$in": _alias_cats(semantic["category_in"])}
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

    cursor = db.partners.find({**PUBLIC_PARTNER_FILTER, **query}, fields).sort([("rank_score", -1), ("rating", -1)]).limit(max_results)
    rows = await cursor.to_list(max_results)

    # If LLM-routed query returned empty, try with just category (drop search_terms)
    if not rows and used_llm_routing and routed_cats:
        fallback_q: Dict[str, Any] = {"category": {"$in": routed_cats}} if len(routed_cats) > 1 else {"category": routed_cats[0]}
        cursor = db.partners.find({**PUBLIC_PARTNER_FILTER, **fallback_q}, fields).sort([("rank_score", -1), ("rating", -1)]).limit(max_results)
        rows = await cursor.to_list(max_results)

    # Keyword fallback: broader bar/restaurant pool
    if not rows and not used_llm_routing:
        vibe = semantic.get("vibe")
        if (
            vibe in {"aperitivo", "sunset", "rooftop", "sea_view", "electro", "salsa", "reggaeton", "champeta"}
            or "category_in" in semantic
        ):
            cats = _alias_cats(semantic.get("category_in") or ["bar", "nightlife", "beach_club", "restaurant"])
            cursor = db.partners.find(
                {**PUBLIC_PARTNER_FILTER, "category": {"$in": cats}}, fields,
            ).sort([("rank_score", -1), ("rating", -1)]).limit(max_results)
            rows = await cursor.to_list(max_results)

    # Ultimate fallback: diverse top partners
    if not rows:
        cursor = db.partners.find(dict(PUBLIC_PARTNER_FILTER), fields).sort([("rank_score", -1), ("rating", -1)]).limit(max_results)
        rows = await cursor.to_list(max_results)

    # ── Recall + relevance pass (accent/language-insensitive) ──
    # The queries above sort by rating, which BURIES or misses the venues that
    # literally match the user's words across accents/languages (barbero↔barber,
    # bohème↔Bohême, mediterráneo↔mediterranean). Fetch those directly by stem and
    # merge (never dropping the routed results), then relevance-rank so the real
    # matches surface for the LLM instead of generic high-rated lookalikes.
    stems = _query_stems(search_terms, user_text)
    if stems:
        stem_regex = "|".join(_accent_flex(s) for s in stems)
        stem_q = {"$or": [{f: {"$regex": stem_regex, "$options": "i"}}
                          for f in ("name", "subcategory", "cuisine", "tags", "experience", "style_tags")]}
        try:
            stem_rows = await db.partners.find(
                {**PUBLIC_PARTNER_FILTER, **stem_q}, fields
            ).sort([("rank_score", -1), ("rating", -1)]).limit(80).to_list(80)
            seen = {r.get("partner_id") for r in rows}
            rows = rows + [r for r in stem_rows if r.get("partner_id") not in seen]
        except Exception as exc:
            logger.warning(f"[concierge] stem recall failed: {exc}")
        rows = _relevance_rerank(rows, stems)

    # Prioritize the routed category (STABLE sort — preserves the rank_score/relevance
    # order within it): recall stays inclusive (category OR text/stem), but venues that
    # are actually IN the asked-for category lead. Without this a bare category word
    # ("spa", "hotel", "barbershop") surfaced a high-rated lookalike from another
    # category first (a hotel-with-spa above real spas; a restaurant-in-a-hotel above
    # hotels). Runs before the transport prepend so boat operators still lead their case.
    if routed_cats:
        _rc = set(routed_cats)
        rows = sorted(rows, key=lambda p: 0 if p.get("category") in _rc else 1)

    # Transport intent: a boat query ("lancha a rosario", "cómo llego a las islas")
    # must be answered by the OPERATORS first, then the destinations they serve —
    # the concierge's rosario->beach_club routing would otherwise return only islands.
    _t = (user_text or "").lower()
    _boat = any(w in _t for w in ("lancha", "bote", "barco", "catamaran", "velero", "yate", "charter",
                                  "cruise", "crucero", "sail", "sailing"))
    _phrase = any(ph in _t for ph in ("transporte", "traslado", "como llego", "como llegar",
                                      "como voy", "quiero ir", "ir a", "llegar a",
                                      "paseo", "tour", "excursion", "island tour", "day trip",
                                      "island hopping"))
    _DEST = {"rosario": "islas_del_rosario", "baru": "baru", "playa blanca": "baru",
             "tierra bomba": "tierra_bomba", "bomba": "tierra_bomba", "cholon": "islas_del_rosario",
             "isla": "", "islas": ""}
    _dest = list(dict.fromkeys(v for k, v in _DEST.items() if k in _t and v))
    _island = any(k in _t for k in _DEST)
    if _boat or (_phrase and _island):
        op_q: Dict[str, Any] = {"category": "yacht"}
        if _dest:
            op_q = {"category": {"$in": ["yacht", "service"]}, "serves_destinations": {"$in": _dest}}
        try:
            op_rows = await db.partners.find({**PUBLIC_PARTNER_FILTER, **op_q}, fields).sort(
                [("rank_score", -1), ("rating", -1)]).limit(12).to_list(12)
            if op_rows:
                seen = {r.get("partner_id") for r in op_rows}
                rows = op_rows + [r for r in rows if r.get("partner_id") not in seen]
        except Exception as exc:
            logger.warning(f"[concierge] transport prepend failed: {exc}")

    return rows[:max_results], routed


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
        "taxis": "Safe if official (yellow). No meter — agree on price BEFORE. Official 2026 minimum ~$12,250 COP; use essentials_layer/trust_reference for exact per-zone fares. Uber/InDriver/DiDi work but legally grey.",
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


async def _slim_all_partners_compact(db, limit: int = 80) -> List[Dict[str, Any]]:
    """Top partners — ultra-compact. Only partner_id + name + category for ID resolution."""
    cursor = db.partners.find(dict(PUBLIC_PARTNER_FILTER), {
        "_id": 0, "partner_id": 1, "name": 1, "category": 1, "subcategory": 1,
    }).sort([("rank_score", -1), ("rating", -1)]).limit(limit)
    return await cursor.to_list(limit)


async def _slim_upcoming_events(db, days: int = 7, limit: int = 20) -> List[Dict[str, Any]]:
    # "Now" is Bogota, not UTC; a passed event must never enter Luna's grounding.
    # PUBLIC_CITY_EVENT_FILTER: a pending/rejected editorial event is excluded too.
    cursor = db.events.find(
        upcoming_query(dict(PUBLIC_CITY_EVENT_FILTER)),
        {"_id": 0, "event_id": 1, "slug": 1, "title": 1, "name_es": 1,
         "date_start": 1, "date": 1, "date_end": 1, "start_time": 1, "venue": 1, "venue_name": 1, "is_free": 1},
    ).sort([("date_start", 1), ("date", 1)]).limit(limit * 2)
    rows = await cursor.to_list(limit * 2)
    return filter_live(rows)[:limit]


async def _slim_partner_events(db, limit: int = 15) -> List[Dict[str, Any]]:
    """Pull upcoming partner-curated events (Daypass / Sunset / Cena especial / etc.)"""
    cursor = db.partner_events.find(
        upcoming_query({"is_published": True}),
        {"_id": 0, "event_id": 1, "title": 1, "date": 1, "date_end": 1, "start_time": 1, "end_time": 1, "partner_id": 1, "category": 1},
    ).sort([("date", 1), ("start_time", 1)]).limit(limit * 2)
    rows = filter_live(await cursor.to_list(limit * 2))[:limit]
    # drop events whose venue isn't catalog-approved, and carry the venue NAME —
    # an event Luna can't place ("¿dónde?") is unusable in a recommendation
    pids = {r.get("partner_id") for r in rows if r.get("partner_id")}
    ok: Dict[str, str] = {}
    if pids:
        async for p in db.partners.find({**PUBLIC_PARTNER_FILTER, "partner_id": {"$in": list(pids)}}, {"_id": 0, "partner_id": 1, "name": 1}):
            ok[p["partner_id"]] = p.get("name", "")
    out: List[Dict[str, Any]] = []
    for r in rows:
        if r.get("partner_id") in ok:
            r["partner_name"] = ok[r["partner_id"]]
            out.append(r)
    return out


async def _curated_expert_picks(db, user_text: str) -> Optional[Dict[str, Any]]:
    """The authoritative recommendation layer (Franck's ranked answer key).

    When the query maps to a known curated intent, return the expert's ranked
    venues as ready-to-use cards *in his exact order*, already linked to real
    partner_ids. The concierge builds recommendation cards from these FIRST —
    no name→id guessing, no competing with rating-sorted results.
    """
    from knowledge import best_curated
    bc = best_curated(user_text)
    if not bc:
        return None
    ids = bc.get("partner_ids") or []
    picks: List[Dict[str, Any]] = []
    if ids:
        fields = {
            "_id": 0, "partner_id": 1, "name": 1, "category": 1, "subcategory": 1,
            "tier": 1, "price_range": 1, "address": 1, "rating": 1,
            "neighborhood": 1, "experience": 1, "tags": 1, "signature_dishes": 1,
        }
        # U8: an expert-curated id that points to an unapproved / sandbox / rejected
        # venue must NOT become a Luna recommendation — same gate as /search (4631).
        found = await db.partners.find({**PUBLIC_PARTNER_FILTER, "partner_id": {"$in": ids}}, fields).to_list(len(ids))
        by_id = {p.get("partner_id"): p for p in found}
        # Preserve the expert's exact rank order; drop any id missing from DB.
        for rank, pid in enumerate(ids, start=1):
            p = by_id.get(pid)
            if p:
                p["expert_rank"] = rank
                picks.append(p)
    # I9: mention_only (expert picks NOT in the catalog) is deliberately NOT
    # returned to Luna — it made her recommend non-existent venues ("Oh La La
    # Green… aún no está en el catálogo pero buscalo"). Those names live only
    # in the demand/gap report (things to add), never in a recommendation.
    if not picks:
        return None
    return {
        "matched_question": bc.get("question", ""),
        "category": bc.get("category", ""),
        "expert_ranked": picks,                      # real cards only, in Franck's order
    }


async def _port_tax_price(db) -> int:
    cfg = await db.port_tax_config.find_one({"active": True}, {"_id": 0, "price_per_person": 1})
    return int((cfg or {}).get("price_per_person", 31500))


async def _trip_context(db, user_id: str) -> Optional[Dict[str, Any]]:
    """Drop 10 (10D): the user's most-recently-touched trip, compact, for
    gap-aware planning. Item names come from the stored snapshot (ref_name /
    custom_text) — Luna only ever references items that really exist."""
    trip = await db.trips.find_one(
        {"members.user_id": user_id},
        {"_id": 0, "trip_id": 1, "name": 1, "dates": 1, "members": 1, "updated_at": 1},
        sort=[("updated_at", -1)],
    )
    if not trip:
        return None
    rows = await db.trip_items.find(
        {"trip_id": trip["trip_id"]},
        {"_id": 0, "ref_type": 1, "ref_id": 1, "ref_name": 1, "custom_text": 1,
         "day": 1, "time_slot": 1, "votes": 1},
    ).sort([("day", 1), ("added_at", 1)]).to_list(30)
    # attach real categories for venue refs so Luna can see WHAT KIND of plans exist
    vids = [r["ref_id"] for r in rows if r.get("ref_type") == "venue" and r.get("ref_id")]
    cats: Dict[str, str] = {}
    if vids:
        async for p in db.partners.find({**PUBLIC_PARTNER_FILTER, "partner_id": {"$in": vids}},
                                        {"_id": 0, "partner_id": 1, "category": 1}):
            cats[p["partner_id"]] = p.get("category", "")
    items = [{
        "name": r.get("ref_name") or r.get("custom_text") or "",
        "category": cats.get(r.get("ref_id"), "custom" if r.get("ref_type") == "custom" else r.get("ref_type")),
        "day": r.get("day"),
        "votes": len(r.get("votes") or []),
    } for r in rows]
    return {
        "name": trip.get("name"),
        "dates": trip.get("dates"),
        "members": [m.get("name") or "Viajero" for m in trip.get("members", [])][:12],
        "items": items,
        "days_used": sorted({i["day"] for i in items if i["day"]}),
    }


async def build_context_snapshot(db, user: Optional[Dict[str, Any]] = None, user_text: str = "") -> Dict[str, Any]:
    """Pull the data the agent needs to reason about, focused on relevance to user_text.

    PERFORMANCE: All MongoDB queries run in parallel via asyncio.gather.
    Context is kept lean (~6K tokens) to ensure fast LLM responses.
    """
    import asyncio

    semantic_filters = _extract_filters_from_text(user_text)

    # Run ALL MongoDB queries in parallel
    from pulse import get_active_pulse_map
    results = await asyncio.gather(
        _slim_all_partners_compact(db, 80),
        _smart_partner_query(db, user_text, max_results=15),
        _slim_upcoming_events(db, days=7, limit=20),
        _slim_partner_events(db, limit=15),
        _port_tax_price(db),
        get_active_pulse_map(db, None, limit=30),
        _curated_expert_picks(db, user_text),
        return_exceptions=True,
    )

    all_partners = results[0] if not isinstance(results[0], Exception) else []
    relevant_result = results[1] if not isinstance(results[1], Exception) else ([], {"intent_type": "general"})
    relevant_partners, routed_intent = relevant_result
    intent_type = routed_intent.get("intent_type", "general")
    upcoming_events = results[2] if not isinstance(results[2], Exception) else []
    partner_events = results[3] if not isinstance(results[3], Exception) else []
    port_tax_price = results[4] if not isinstance(results[4], Exception) else 31500
    pulse_map = results[5] if not isinstance(results[5], Exception) else {}
    curated = results[6] if not isinstance(results[6], Exception) else None
    live_tonight = [
        {"partner_id": pid, "partner_name": pu.get("partner_name"), "type": pu.get("type"),
         "title": pu.get("title"), "details": pu.get("details"),
         "start_time": pu.get("start_time"), "end_time": pu.get("end_time")}
        for pid, pu in list(pulse_map.items())[:20]
    ]

    has_pass = False
    if user and user.get("user_id"):
        try:
            cnt = await db.city_passes.count_documents({"user_id": user["user_id"], "is_active": True})
            has_pass = cnt > 0
        except Exception:
            pass
    # Drop 8D2: earned passport title — Luna mirrors identity the user actually
    # walked for. Thin passports (<5 stamps) can't hold a title; skip the compute.
    passport_title = None
    if user and user.get("user_id"):
        try:
            pdoc = await db.user_passport.find_one(
                {"user_id": user["user_id"]}, {"_id": 0, "discoveries": 1})
            if pdoc and len(pdoc.get("discoveries") or []) >= 5:
                import walking as _walking
                prog = await _walking._compute_progress(pdoc["discoveries"])
                passport_title = (_walking._titles_for(prog).get("primary") or {}).get("name")
        except Exception:
            pass
    # Drop 10 (10D): Luna plans WITH the user's trip — most-recently-touched
    # trip they belong to, compact. Fail-soft: no trip → key absent → the
    # prompt section says nothing.
    mi_viaje = None
    if user and user.get("user_id"):
        try:
            mi_viaje = await _trip_context(db, user["user_id"])
        except Exception:
            mi_viaje = None
    _nb = now_bogota()
    _part = ("madrugada" if _nb.hour < 6 else "mañana" if _nb.hour < 12
             else "tarde" if _nb.hour < 18 else "noche")
    ctx: Dict[str, Any] = {
        "today": _nb.strftime("%A %Y-%m-%d"),
        "now": {
            "date": _nb.strftime("%Y-%m-%d"),
            "weekday": _nb.strftime("%A"),
            "local_time": _nb.strftime("%H:%M"),
            "part_of_day": _part,
            "is_weekend": _nb.weekday() >= 4,
        },
        **({"mi_viaje": mi_viaje} if mi_viaje else {}),
        "user": {
            "name": (user or {}).get("name"),
            "has_city_pass": has_pass,
            **({"passport_title": passport_title} if passport_title else {}),
            **({"profile": {
                # Drop 4 C1: user_type + travel_dates were validated/stored but
                # never injected — the prompt's local/dates rules were dead code.
                "user_type": profile.get("user_type"),
                "party_type": profile.get("party_type"),
                "interests": profile.get("interests", []),
                "travel_dates": profile.get("travel_dates"),
            }} if (profile := (user or {}).get("_profile")) else {}),
            **({"taste": {
                "tags": list((t.get("tags") or {}).keys())[:5],
                "cuisines": list((t.get("cuisines") or {}).keys())[:3],
                "liked_partners": (t.get("liked_partners") or [])[:5],
            }} if (t := (user or {}).get("_taste")) and (t.get("tags") or t.get("liked_partners")) else {}),
        } if user else {},
        "port_tax_cop": port_tax_price,
        **({"curated_recommendations": curated} if curated else {}),
        **({"live_tonight": live_tonight} if live_tonight else {}),
        **({"trust_reference": tc} if (tc := _trust_context(user_text)) else {}),
        **({"seasonal": sc} if (sc := _seasonal_context(user_text)) else {}),
        **({"occasions": oc} if (oc := _occasion_context(user_text)) else {}),
        "relevant_partners": relevant_partners,
        "partner_directory": all_partners,
        "events": upcoming_events,
        "partner_events": partner_events,
    }
    # Include knowledge spine ONLY for essentials/logistics queries
    if intent_type in {"essentials", "logistics"}:
        ctx["cartagena_knowledge"] = CARTAGENA_KNOWLEDGE
        # Drop CAT: the LIVE essentials taxonomy — the verified essentials Luna
        # MAY answer from + the categories she must honestly DECLINE (same live-
        # gate as the user UI, so Luna and the app never disagree; no empty shelves).
        try:
            import essentials as _ess
            ctx["essentials_layer"] = await _ess.essentials_coverage()
        except Exception as exc:
            logger.warning(f"[agent] essentials layer load failed: {exc}")
    return ctx


# ────────────────────────────────────────────────
# Session management
# ────────────────────────────────────────────────

async def get_or_create_session(db, user_id: Optional[str], session_id: Optional[str]) -> Dict[str, Any]:
    if session_id:
        # Ownership-scoped: only resume a session that belongs to THIS user. Trusting
        # any client-supplied session_id let an attacker read another user's Luna
        # history into the LLM context and inject writes into their session (IDOR).
        # The sibling GET /agent/session/{id} already enforces this — mirror it here.
        s = await db.chat_sessions.find_one({"session_id": session_id, "user_id": user_id}, {"_id": 0})
        if s:
            return s
        # Supplied id is foreign (belongs to someone else) — never reuse it, or the
        # insert below would collide with / write into their document. Mint a fresh id.
        if await db.chat_sessions.find_one({"session_id": session_id}, {"_id": 1}):
            session_id = None
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

# ── Trust & price reference (Drop 7): grounded, tiered — never invented ──
_TRUST_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "trust_knowledge.json")
try:
    with open(_TRUST_PATH, "r", encoding="utf-8") as _f:
        _TRUST = json.load(_f)
except Exception:
    _TRUST = None

_TRUST_TRIGGERS = ("taxi", "precio", "cuanto", "cuánto", "tarifa", "aeropuerto", "seguro",
                   "seguridad", "estafa", "scam", "peligro", "propina", "agua", "tasa",
                   "muelle", "emergencia", "efectivo", "cash", "safe", "price", "cost",
                   "fare", "fee", "tip", "airport", "dangerous", "water",
                   # boat/island intents need the pier-fee + cash guidance
                   "lancha", "bote", "barco", "boat", "isla", "islas", "rosario",
                   "baru", "barú", "playa blanca", "catamaran", "catamarán", "tour")


def _trust_context(user_text: str) -> Optional[Dict[str, Any]]:
    if not _TRUST:
        return None
    t = (user_text or "").lower()
    if not any(k in t for k in _TRUST_TRIGGERS):
        return None
    return {"config": _TRUST.get("config"), "entries": _TRUST.get("entries"),
            "safety": _TRUST.get("safety")}


_SEASONAL_TRIGGERS = ("sello", "sellos", "temporada", "festival", "fiesta", "fiestas",
                      "atardecer", "sunset", "evento", "eventos", "hoy", "ahora",
                      "season", "stamp", "hay festival", "independencia", "candelaria",
                      "qué hacer", "que hacer", "novena", "navidad", "semana santa")


# Drop 9 (3d): grounded occasion → real venue guide (from occasions.py curated
# collections). Luna cites these real tagged venues, never invents. Venues
# flagged (verificar) are needs_confirmation — hedge, never a confident top pick.
_OCCASION_GUIDE = {
    "aniversario / cena romántica": ["Celele", "Carmen", "Alma", "Restaurante 1621", "La Vitrola", "Club de Pesca"],
    "ocasión especial / celebrar": ["Celele", "Carmen", "Restaurante 1621", "Club de Pesca", "Candé"],
    "atardecer / rooftop": ["Café del Mar", "Movich", "Alquímico", "The Townhouse"],
    "primera cita": ["El Barón", "Demente", "Época"],
    "con niños / familia": ["Aviario Nacional", "Gelateria Tramonti", "Isla del Encanto", "Juan del Mar"],
    "día de lluvia": ["Palacio de la Inquisición", "Museo del Oro Zenú", "La Serrezuela"],
    "música en vivo": ["Café Havana", "Bazurto Social Club", "Casa Quiebra-Canto"],
    "favoritos locales / dónde comen los cartageneros": ["La Cocina de Pepina", "La Mulata", "Espíritu Santo"],
    "café / desayuno": ["Época", "Café San Alberto", "Ábaco Libros y Café"],
    "ceviche / mariscos": ["La Cevichería", "El Boliche", "Marea"],
    "street food": ["Donde Magola", "Donde Olano", "Portal de los Dulces"],
    "coctelería": ["Alquímico", "El Barón", "Malagana"],
    "rumba / baile": ["La Movida", "La Jugada", "Bazurto Social Club"],
    "grupo / fiesta": ["Cholón", "Bora Bora Beach Club", "Colombia Luxury Group"],
    "beach clubs": ["Makani Beach Club", "Blue Apple Beach", "Bora Bora Beach Club", "Sabai"],
    "saludable / vegano": ["Gokela", "Pezetarian", "Girasoles (verificar)"],
    "café para trabajar": ["Café San Alberto", "Ábaco Libros y Café", "Café Stepping Stone"],
    "postres": ["Gelateria Tramonti", "Mila Pastelería", "La Palettería"],
    "spa / bienestar": ["Tcherassi Spa", "Bastión Spa", "Zaitún Spa"],
    "lujo": ["Sofitel Legend Santa Clara", "Casa San Agustín", "Four Seasons", "Carmen", "Celele"],
}
_OCC_TRIGGERS = ("aniversario", "romántic", "romantic", "cita", "ceno", "cena", "cenar", "niños", "nino",
                 "familia", "family", "lluvia", "rain", "música", "musica", "music", "atardecer", "sunset",
                 "rooftop", "playa", "beach", "rumba", "bailar", "baile", "dance", "coctel", "cocktail",
                 "trago", "café", "cafe", "coffee", "desayuno", "breakfast", "brunch", "ceviche", "marisco",
                 "seafood", "postre", "dessert", "spa", "masaje", "trabajar", "work", "wifi", "fiesta",
                 "grupo", "group", "party", "especial", "celebrar", "vegano", "vegetarian", "saludable",
                 "qué hago", "que hago", "recomiend", "recommend", "dónde", "donde")


def _occasion_context(user_text: str) -> Optional[Dict[str, Any]]:
    t = (user_text or "").lower()
    if not any(k in t for k in _OCC_TRIGGERS):
        return None
    try:
        import walking as _walking
        now = datetime.now(timezone.utc).astimezone(_walking.BOGOTA)
        now_occ = _walking._now_occasion(now)
    except Exception:
        now_occ = None
    return {
        "right_now": now_occ,  # the occasion that fits the current real hour/sunset
        "occasion_guide": _OCCASION_GUIDE,
        "_rule": "Recomendá SOLO estos venues reales por ocasión. '(verificar)' = aún sin confirmar, hedgealo. Para 'qué hago ahora' usá right_now (hora + atardecer reales).",
    }


def _seasonal_context(user_text: str) -> Optional[Dict[str, Any]]:
    """Grounded time-engine facts for Luna — what's earnable NOW and what's
    confirmed-upcoming. She NEVER announces a passed or unconfirmed date
    (suppressed stamps are absent; unconfirmed editions carry no date)."""
    t = (user_text or "").lower()
    if not any(k in t for k in _SEASONAL_TRIGGERS):
        return None
    try:
        import walking as _walking
        now = datetime.now(timezone.utc).astimezone(_walking.BOGOTA)
        defs = _walking._load_seasonal()
        lo, hi = _walking._sunset_window_min(now)
        sunset_min = (lo + 45)  # base = window-open + pre_min
        sunset_hhmm = f"{sunset_min // 60:02d}:{sunset_min % 60:02d}"
        available, upcoming = [], []
        for sp in defs.get("stamps", []):
            if sp.get("pulse_gated") and not defs.get("pulse_active"):
                continue
            state = _walking._stamp_state(sp, now, {})
            if state == "available_now":
                available.append(sp.get("name_es"))
            elif state == "upcoming":
                w = sp.get("window") or {}
                d = f"{w.get('start_md')}" if sp.get("type") == "event_fixed" else None
                upcoming.append({"name": sp.get("name_es"), "when": d})
        season = _walking._season_now(now)
        return {"sunset_today": sunset_hhmm,
                "season_now": (season or {}).get("name_es"),
                "earnable_now": available[:6],
                "upcoming_confirmed": upcoming[:6],
                "_rule": "Solo anunciá lo earnable_now o upcoming_confirmed. NUNCA una fecha pasada ni sin confirmar."}
    except Exception:
        return None


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
🏷️ TAGS DE OCASIÓN (partners[].tags)
══════════════════════════════════════════
Los partners pueden traer "tags" (romantic, first_date, family, kid_friendly, group_friendly, business, celebration, sea_view, sunset_view, rooftop, outdoor_terrace, live_music, late_night, english_friendly, indoor, budget, luxury, local_favorite, pet_friendly, healthy).
Usalos para preguntas de ocasión o característica: "cena romántica" → tags romantic/sea_view; "con niños" → kid_friendly/family; "está lloviendo" → indoor; "que hablen inglés" → english_friendly; "algo local, no turístico" → local_favorite. Preferí partners cuyo tag coincide con la ocasión pedida y mencioná el porqué ("terraza con vista al atardecer").

Los partners también pueden traer "signature_dishes" (platos/bebidas insignia verificados). Cuando el usuario pide un plato o bebida específica ("lychee martini", "paella", "ceviche"), preferí partners cuyo signature_dishes lo incluye y NOMBRÁ el plato exacto al recomendar ("pedí el Pargo Platero con curry amarillo"). JAMÁS atribuyas un plato que no esté en signature_dishes del partner.

Si context.user trae "taste" (gustos reales del usuario: tags, cocinas, lugares que le gustaron), usalo con sutileza: priorizá recomendaciones afines y podés referenciar su historial con naturalidad ("como te gustó {lugar}, creo que esto va contigo"). No lo recites como lista ni menciones la palabra "taste".

══════════════════════════════════════════
🔥 EN VIVO HOY (context.live_tonight)
══════════════════════════════════════════
Si el context trae "live_tonight", son novedades REALES DE HOY enviadas por los propios negocios (música en vivo, happy hours, promos, cierres). Es tu superpoder: ninguna otra app las tiene.
- Para preguntas tipo "esta noche / hoy / ahora / qué hay", priorizá partners con entrada en live_tonight y mencioná el dato concreto (hora, promo) al recomendarlos.
- Si recomendás un partner que aparece en live_tonight por cualquier otra razón, mencioná su novedad de hoy.
- Si live_tonight NO existe o no aplica, no digas nada al respecto. JAMÁS inventes novedades "de hoy" que no estén en live_tonight.

══════════════════════════════════════════
🎟 AGENDA DE PARTNERS (context.partner_events)
══════════════════════════════════════════
"partner_events" son eventos PRÓXIMOS REALES publicados por los propios negocios y aprobados por moderación (day pass, sunset sessions, cenas especiales, clases). Cada uno trae título, fecha (date), hora (start_time), el venue (partner_name) y su event_id.
- Para "qué hacer", "planes", "eventos", "este fin de semana" o una fecha concreta: revisá partner_events junto con events y ofrecé los que calcen con la fecha y el tipo de plan.
- Al recomendarlos, dá el dato concreto: título + fecha/hora + venue ("el viernes hay Sunset Sessions en el rooftop del Movich a las 5pm").
- Podés devolverlos como card: {"kind": "event", "event_id": "..."} usando el event_id EXACTO que aparece en context.partner_events.
- Si recomendás un venue que además tiene un partner_event próximo, mencionalo ("y este sábado tienen {título}").
- Si ningún partner_event calza, no digas nada al respecto. JAMÁS inventes eventos, fechas u horas que no estén en context.partner_events.

══════════════════════════════════════════
🧳 MI VIAJE (context.mi_viaje)
══════════════════════════════════════════
Si el context trae "mi_viaje", es el viaje REAL que el usuario está planeando en la app (nombre, fechas, miembros, items con su día). Planeá CON él:
- Detectá huecos REALES del itinerario: una noche sin cena, un día sin plan, ningún atardecer/rooftop, ninguna experiencia de islas. Sugerí venues reales del catálogo que llenen ese hueco ("ya tienen Celele — les falta un atardecer, ¿qué tal Café del Mar?").
- Referite a lo que YA tienen POR NOMBRE y por día ("el día 2 tienen la lancha a Rosario"). JAMÁS menciones un item que no esté en mi_viaje.items.
- Tus sugerencias para el viaje son cards normales (kind "partner") — desde ahí el usuario las agrega a su viaje con un tap.
- Si hay varios miembros, hablá en plural ("les falta", "para el grupo"). Los votos (votes) te dicen qué quiere el grupo — priorizá lo más votado al armar el día.
- Si NO hay mi_viaje, no menciones viajes ni itinerarios compartidos.

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
- ⚠️ **HONESTIDAD (REGLA DURA, prioridad máxima)**: SOLO podés nombrar lugares que estén en el contexto (`relevant_partners`, `occasion_guide`, `curated_recommendations`, `partner_directory`, `all_partners_directory`). Un lugar que no está en el contexto NO EXISTE para vos. PROHIBIDO ABSOLUTO: nombrar un venue que no esté en el contexto; decir "X no está en el catálogo/app pero buscalo/vale la pena"; sugerir que el usuario busque un lugar por fuera. Si no tenés una opción real en el contexto, decilo ("no tengo un lugar de eso todavía en la app") y ofrecé la alternativa REAL más cercana del contexto — nunca un nombre inventado, dirección, teléfono ni precio. Si mencionás "el experto local", solo puede ser sobre venues que SÍ están en el contexto.
## CONFIANZA Y PRECIOS (un precio equivocado es una promesa rota)
- Si `trust_reference` está en el contexto, respondé precios/seguridad DESDE AHÍ, nunca de memoria.
- Entradas confidence=HIGH → afirmá con el año: "COP $20.200 (tarifa oficial 2026)".
- Entradas confidence=VERIFY (traen range_cop) → dá el RANGO COMPLETO + "confirmá en el lugar". JAMÁS un número único para estas — ni promedio, ni "~aproximado", ni el punto medio. Si el rango es [16000, 41000] decí "$16–41 mil según el tour", nunca "~31.500". Si low==high (una sola cifra NO oficial), presentala como aproximada: "alrededor de $14.000, confirmá en taquilla".
- Si el dato no está en trust_reference ni en el catálogo → "confírmalo en el lugar", nunca una cifra inventada.
- Una línea proactiva de seguridad cuando el intent lo amerita (UNA, no un sermón): lancha/islas → "la tasa del muelle/parque se paga en efectivo ($16–41 mil según el tour), confirmá qué incluye"; vida nocturna → "nunca dejes tu trago solo"; taxi → "acordá el precio antes de subir".
- Zonas: hablá de "zonas turísticas principales" — nunca declares una zona "peligrosa".

## ESENCIALES DE LA CIUDAD (la capa invisible — SOLO lo verificado, sin estantes vacíos)
- Si `essentials_layer` está en el contexto, respondé las necesidades básicas (traslado del aeropuerto, taxi, cajeros/cambio, SIM, farmacias, supermercados, agua, emergencias, hospitales, salud del viajero) DESDE `essentials_layer.live_essentials` — cada categoría trae `guidance` y `entries` verificadas (cadenas reales, tarifas oficiales, números). Da el dato con su fuente/año cuando es HIGH.
- AUTORIDAD: para ATM/hospital/tarifa/policía de turismo/agua, `essentials_layer` y `trust_reference` MANDAN sobre `cartagena_knowledge` (que es solo contexto de fondo, sin verificar). Si difieren, seguí SIEMPRE a essentials_layer/trust_reference.
- Datos clave verificados que SÍ podés afirmar (HIGH): emergencias **123**, aeropuerto→Centro **$20.200** (oficial 2026), mínima taxi **$12.250**, farmacias = cadenas (Cruz Verde/Farmatodo/La Rebaja/Olímpica), hospital de referencia = **Serena del Mar** (JCI). Nunca inventes otro número, cadena, clínica o tarifa.
- Entradas confidence=VERIFY en `essentials_layer` → decilas SIEMPRE con la salvedad exacta de su value_text/source ("no oficial", "confirmá vigencia"); ante urgencia remití al 123. NUNCA las afirmes con el mismo peso que una HIGH (ej: el teléfono de la Policía de Turismo es VERIFY — dalo con el hedge, no como dato firme).
- `essentials_layer.live_directory` = categorías que SÍ están cubiertas con lugares reales (lavanderías, coworking, etc.). RESPONDELAS desde `relevant_partners`/el mapa — NUNCA digas que no están cubiertas.
- `essentials_layer.hidden_categories` = categorías SIN cobertura verificada suficiente todavía. Si el usuario pide una de esas —o cualquier esencial que NO esté en `live_essentials` ni en `live_directory`— decí honestamente "eso todavía no lo tengo cubierto en la app" y ofrecé lo más cercano que SÍ esté vivo. JAMÁS inventes una farmacia, clínica, tarifa, dirección ni número. Un estante vacío inventado es peor que decir "todavía no".

## SELLOS DE TEMPORADA (una fecha vencida es una mentira)
- Si `seasonal` está en el contexto, hablá de sellos/temporada/festivales DESDE AHÍ, nunca de memoria.
- `seasonal.earnable_now` = sellos que se pueden ganar AHORA MISMO — invitá a ganarlos ("hoy podés ganar el Sello del Atardecer — el sol se pone a las {seasonal.sunset_today}, andá a la muralla").
- `seasonal.upcoming_confirmed` = eventos con fecha REAL futura — anunciá con la fecha ("las Fiestas de Independencia arrancan el 6 de noviembre").
- JAMÁS anuncies un festival cuya edición ya pasó como si fuera próximo, ni una fecha "sin confirmar" como si fuera fija. Si no está en earnable_now ni upcoming_confirmed, no inventes fecha — decí "la próxima edición aún no tiene fecha confirmada".
- `seasonal.season_now` = la temporada actual (seca/verde) — usala como color ambiental si viene al caso.

## AHORA MISMO EN CARTAGENA (contexto temporal REAL — usalo SIEMPRE)
- `now` trae el momento REAL en Cartagena: `now.weekday` (día), `now.local_time` (hora), `now.part_of_day` (madrugada/mañana/tarde/noche), `now.is_weekend`. Recomendá para ESTE momento, no en abstracto: mañana→desayuno/brunch/café; tarde→almuerzo/playa/plan; atardecer→rooftop/muralla; noche→cena/cócteles; finde de noche→rumba. Fin de semana ≠ día de semana (jue–sáb hay más vida nocturna; lun–mié más tranquilo).
- Si el usuario no dice cuándo, asumí AHORA (`now`) y decilo con naturalidad ("son las {now.local_time} de un {now.weekday} — buen momento para…").
- `events`/`partner_events` que recibís YA vienen filtrados a lo que sigue vigente (nada pasado, hora de Cartagena). Si algo es HOY, priorizalo ("hoy a las {start_time}…"). Un evento que NO está en la lista NO existe para vos — jamás menciones una fecha ya pasada.

## OCASIONES (la recomendación correcta para el momento)
- Si `occasions` está en el contexto, recomendá DESDE `occasions.occasion_guide` — venues REALES por ocasión (aniversario→Celele/Carmen/Alma; atardecer→Café del Mar/Movich/Alquímico; niños→Aviario/Gelateria Tramonti; etc.). NO inventes un venue que no esté ahí ni en el catálogo.
- Un venue marcado "(verificar)" es needs_confirmation → recomendalo con hedge ("estamos confirmando este lugar, chequeá antes de ir"), NUNCA como pick estrella confiado. Lo mismo con venues del contexto con `status: pending_review`.
- Para "¿qué hago ahora?" / "son las 9am, ¿qué hago?" usá `occasions.right_now` — la ocasión que corresponde a la hora y al atardecer REALES ("son las {hora} — buen momento para {ocasión}"). Nunca una hora inventada.
- Elegí 2-3 nombres, no la lista entera. Personalizá con el perfil si lo tenés.

## VOZ (lo que hace que la gente VUELVA)
- **Nombre**: si `user.name` existe, usalo natural y con moderación — en el saludo o el remate, nunca en cada frase ("Listo, Phil —" / "Vas a amar esto").
- **Título del pasaporte**: si `user.passport_title` existe (ej. "Sibarita", "Explorador de Getsemaní"), es un título GANADO caminando — usalo de vez en cuando como reconocimiento natural ("vas por buen camino, Sibarita"). Si no existe, JAMÁS inventes uno ni halagues con títulos no ganados.
- **CORTO**: máximo 2-3 frases antes de las cards. La respuesta de la captura de pantalla de 12 líneas es EXACTAMENTE lo que no queremos. La info densa (precios, horarios, logística) va en UNA frase clave + el resto en cards/actions, no en párrafo.
- **Callback personal**: cuando uses profile/taste, DECILO ("como van en pareja...", "ya que te gustó Alquímico...", "con tus 4 horas de crucero alcanza perfecto para..."). El usuario tiene que SENTIR que la respuesta es suya, no genérica.
- **Remate con anzuelo**: cerrá con UNA micro-pregunta que avance el plan ("¿Para hoy o mañana?", "¿Los quieres cerca de tu hotel?", "¿Reservo por dos?"). Nunca dos preguntas. Nunca "¿algo más?".
- **Energía espejo**: mensaje corto y casual → respuesta corta y casual. Pregunta detallada → precisión. Emoji: máximo 1, y solo si el usuario los usa.
- **PROHIBIDO markdown**: nada de **asteriscos**, guiones de lista ni encabezados en `message` — texto plano conversacional. Los datos estructurados viven en las cards.

- ⚠️ **VENUES EN VERIFICACIÓN**: si un venue del contexto tiene `status: "pending_review"`, podés recomendarlo pero agregá una advertencia honesta de una frase ("confirmá horario/disponibilidad antes de ir — estamos verificando este lugar"). Nunca lo presentes con la misma certeza que un venue verificado.
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
RECOMENDACIONES CURADAS (PRIORIDAD MÁXIMA — ES LA VOZ DEL EXPERTO LOCAL)
══════════════════════════════════════════
Si `curated_recommendations` aparece en el contexto, es la lista curada por un EXPERTO LOCAL de Cartagena. Es la RESPUESTA CORRECTA a lo que el usuario pregunta — PERO verificá primero que coincida con la intención: si el usuario pide CENAR/COMER y la lista curada es de bares/vida nocturna (o viceversa), IGNORÁ la curada y respondé desde relevant_partners con la categoría correcta. Tiene:
  • `expert_ranked`: tarjetas REALES con `partner_id` y `expert_rank`, YA en el orden exacto de prioridad del experto (rank 1 = el mejor). El `partner_id` ya está resuelto — NO tenés que buscarlo.
  • `matched_question` / `category`: la intención que se detectó.

REGLAS (obligatorias):
1. Armá tus `recommendations` EMPEZANDO por `expert_ranked`, EN ESE MISMO ORDEN (expert_rank 1 primero, después 2, 3…). Copiá su `partner_id` tal cual.
2. Este orden GANA sobre `relevant_partners`, sobre el rating del catálogo, y sobre tu propio criterio. NO reordenes por rating. NO reemplaces los picks del experto por otros que "te parezcan mejores".
3. Después de listar TODOS los picks del experto que estén en catálogo, si necesitás llegar a 5-8 tarjetas, completá con partners relevantes de `relevant_partners` (sin repetir).
4. Si `curated_recommendations` NO aparece, seguí con el ranking normal del catálogo.

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
    fast: bool = False,
) -> Dict[str, Any]:
    """One turn of the conversational agent. Returns the assistant payload.

    `forced_language` (es|en|fr|pt) overrides the auto-detection.
    `fast` uses Haiku for speed (~2-3s) instead of Sonnet (~8-15s).
    Use fast=True for search bar, fast=False for chat sessions.
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

    # fast=True (search bar): Haiku 4.5 for 2-3s responses
    # fast=False (chat sessions): Sonnet 4.6 for deeper reasoning
    model = "claude-haiku-4-5" if fast else "claude-sonnet-4-6"
    max_tok = 1024 if fast else 2048

    response = await llm_complete(
        system_msg, json.dumps(user_payload, ensure_ascii=False),
        model=model,
        max_tokens=max_tok,
        temperature=0.5 if fast else 0.7,
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
    valid_partner_ids.update(p.get("partner_id") for p in (context.get("partner_directory") or []))
    # Curated expert picks are authoritative — never let the sanitizer drop them.
    _cur = context.get("curated_recommendations") or {}
    valid_partner_ids.update(p.get("partner_id") for p in (_cur.get("expert_ranked") or []))
    valid_event_ids = set()
    for e in (context.get("events") or []):
        valid_event_ids.add(e.get("event_id") or e.get("slug"))
    for e in (context.get("partner_events") or []):
        valid_event_ids.add(e.get("event_id") or e.get("slug"))
    valid_event_ids.discard(None)
    recommendations = _sanitize_recommendations(parsed.get("recommendations") or [], valid_partner_ids, valid_event_ids)
    suggestions = [str(s)[:80] for s in (parsed.get("suggestions") or [])[:4] if s]

    return {
        "message": message,
        "language": language,
        "actions": actions,
        "recommendations": recommendations,
        "suggestions": suggestions,
    }
