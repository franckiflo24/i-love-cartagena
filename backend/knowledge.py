"""
Curated knowledge base for Amo Cartagena.

Loads expert Q&A entries from data/knowledge.json at import time and builds
an inverted index for fast keyword matching against user queries.
"""

from __future__ import annotations

import json
import logging
import os
import re
import unicodedata
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

# ── Load knowledge entries ────────────────────────────────────────

_KNOWLEDGE_PATH = os.path.join(os.path.dirname(__file__), "data", "knowledge.json")

_ENTRIES: List[Dict[str, Any]] = []
_INDEX: Dict[str, List[int]] = {}  # keyword → list of entry indices

# Stopwords common in ES/EN/FR/PT tourism queries — stripped from indexing
_STOPWORDS = frozenset({
    "de", "la", "el", "en", "los", "las", "un", "una", "del", "al", "y", "o",
    "que", "es", "por", "para", "con", "se", "su", "como", "mas", "cual",
    "cuales", "donde", "son", "the", "a", "an", "in", "of", "for", "to",
    "and", "or", "is", "are", "at", "on", "it", "les", "des", "du", "le",
    "est", "et", "ou", "dans", "pour", "avec", "da", "do", "dos", "das",
    "no", "na", "em", "os", "as", "um", "mais", "mejor", "mejores",
    "cartagena",
})

# ── Synonym expansion ───────────────────────────────────────────
# Maps user terms (EN/ES/FR/PT) to database vocabulary so that queries like
# "fish" also search for "mariscos", "seafood", "pescado", etc.
_SYNONYMS: Dict[str, List[str]] = {
    # ── Food concepts ──
    "fish": ["mariscos", "seafood", "pescado", "ceviche", "langosta"],
    "seafood": ["mariscos", "pescado", "ceviche", "langosta", "camarones"],
    "mariscos": ["seafood", "fish", "pescado", "ceviche", "langosta", "camarones"],
    "pescado": ["mariscos", "seafood", "fish", "ceviche"],
    "lobster": ["langosta", "mariscos", "seafood"],
    "langosta": ["lobster", "mariscos", "seafood"],
    "shrimp": ["camarones", "mariscos", "seafood"],
    "camarones": ["shrimp", "mariscos", "seafood"],
    "ceviche": ["mariscos", "seafood", "pescado", "peruano"],
    "steak": ["carnes", "parrilla", "carne"],
    "meat": ["carnes", "parrilla", "carne"],
    "carne": ["carnes", "parrilla", "steak", "meat"],
    "carnes": ["carne", "parrilla", "steak", "meat"],
    "chicken": ["pollo", "restaurante", "comida"],
    "pollo": ["chicken", "restaurante", "comida"],
    "pizza": ["italiana", "pizza", "restaurante"],
    "pasta": ["italiana", "pasta", "restaurante"],
    "sushi": ["sushi", "japones", "asiatica", "japanese"],
    "ramen": ["asiatica", "japones", "noodles"],
    "tacos": ["mexicana", "restaurante"],
    "curry": ["asiatica", "india", "restaurante"],

    # ── Meals ──
    "hungry": ["restaurante", "comida", "comer", "gastronomia"],
    "hambre": ["restaurante", "comida", "comer", "gastronomia"],
    "breakfast": ["desayuno", "brunch", "cafe", "cafeteria"],
    "desayuno": ["breakfast", "brunch", "cafe"],
    "brunch": ["brunch", "desayuno", "breakfast", "cafe"],
    "lunch": ["almuerzo", "comida", "restaurante"],
    "almuerzo": ["lunch", "comida", "restaurante"],
    "dinner": ["cena", "restaurante", "comida"],
    "cena": ["dinner", "restaurante", "comida"],

    # ── Drinks ──
    "coffee": ["cafe", "cafeteria"],
    "cafe": ["coffee", "cafeteria"],
    "wine": ["vino", "bar", "restaurante"],
    "vino": ["wine", "bar", "restaurante"],
    "beer": ["cerveza", "cerveceria", "bar"],
    "cerveza": ["beer", "cerveceria", "bar"],
    "cocktail": ["coctel", "cocteleria", "bar"],
    "coctel": ["cocktail", "cocteleria", "bar"],

    # ── Sweets ──
    "ice cream": ["helados", "helado", "postres"],
    "helado": ["ice cream", "helados", "postres"],
    "helados": ["ice cream", "helado", "postres"],
    "cake": ["pasteleria", "postres", "torta"],
    "bakery": ["panaderia", "pasteleria"],

    # ── Vibe / Intent ──
    "bored": ["actividad", "tour", "experiencia", "noche", "nightlife"],
    "aburrido": ["actividad", "tour", "experiencia", "noche"],
    "tired": ["spa", "masaje", "bienestar", "relajar"],
    "cansado": ["spa", "masaje", "bienestar", "relajar"],
    "relax": ["spa", "playa", "bienestar", "piscina", "relajar"],
    "chill": ["relajar", "tranquilo", "playa", "spa"],
    "romantic": ["romantico", "pareja", "cena", "intimo"],
    "romantico": ["romantic", "pareja", "cena", "intimo"],
    "date": ["romantico", "cita", "pareja", "cena"],
    "date night": ["romantico", "restaurante", "bar", "intimo"],
    "celebrate": ["fiesta", "cumpleanos", "celebracion"],
    "celebrar": ["fiesta", "cumpleanos", "celebracion"],
    "birthday": ["cumpleanos", "fiesta", "celebracion"],
    "cumpleanos": ["birthday", "fiesta", "celebracion"],
    "anniversary": ["aniversario", "romantico", "cena"],
    "aniversario": ["anniversary", "romantico", "cena"],
    "party": ["fiesta", "discoteca", "club", "noche"],
    "fiesta": ["party", "discoteca", "club", "noche"],
    "fun": ["diversion", "actividad", "experiencia", "nightlife"],
    "adventure": ["aventura", "actividad", "tour", "experiencia"],
    "aventura": ["adventure", "actividad", "tour", "experiencia"],
    "cheap": ["economico", "barato", "popular"],
    "barato": ["cheap", "economico", "popular"],
    "fancy": ["lujo", "premium", "elegante", "exclusivo"],
    "elegante": ["lujo", "premium", "fancy", "exclusivo"],
    "view": ["vista", "rooftop", "mirador", "terraza"],
    "vista": ["view", "rooftop", "mirador", "terraza"],
    "pool": ["piscina", "hotel", "beach", "day pass"],
    "piscina": ["pool", "hotel", "beach club", "day pass"],
    "dance": ["bailar", "salsa", "discoteca", "club"],
    "bailar": ["dance", "salsa", "discoteca", "club"],

    # ── Practical ──
    "tonight": ["noche", "nocturno", "bar", "discoteca"],
    "esta noche": ["noche", "nocturno", "bar", "discoteca"],
    "today": ["hoy", "agenda", "evento"],
    "hoy": ["today", "agenda", "evento"],
    "hot": ["playa", "piscina", "helado", "beach club"],
    "calor": ["playa", "piscina", "helado", "beach club"],
    "rain": ["museo", "shopping", "spa", "indoor"],
    "lluvia": ["museo", "shopping", "spa", "indoor"],
    "safe": ["seguridad", "seguro", "zona segura"],
    "seguridad": ["safe", "seguro", "zona segura"],
    "money": ["cajero", "cambio", "banco", "dinero"],
    "dinero": ["money", "cajero", "cambio", "banco"],
    "atm": ["cajero", "banco", "dinero"],
    "cajero": ["atm", "banco", "dinero"],
    "sick": ["hospital", "farmacia", "clinica", "medico"],
    "enfermo": ["hospital", "farmacia", "clinica", "medico"],
    "pharmacy": ["farmacia", "medicina"],
    "farmacia": ["pharmacy", "medicina"],
    "gym": ["gimnasio", "crossfit", "ejercicio"],
    "gimnasio": ["gym", "crossfit", "ejercicio"],
    "taxi": ["taxi", "uber", "transporte"],
    "uber": ["taxi", "transporte"],
    "airport": ["aeropuerto", "transporte", "transfer"],
    "aeropuerto": ["airport", "transporte", "transfer"],
    "gift": ["souvenir", "artesania", "recuerdo", "regalo"],
    "souvenir": ["gift", "artesania", "recuerdo", "regalo"],
    "photo": ["fotografia", "instagram", "spots"],
    "instagram": ["fotografia", "photo", "spots"],
    "walk": ["caminata", "tour", "paseo"],
    "caminata": ["walk", "tour", "paseo"],
    "museum": ["museo", "cultura", "historia"],
    "museo": ["museum", "cultura", "historia"],
    "boat": ["lancha", "barco", "islas"],
    "lancha": ["boat", "barco", "islas"],
    "hotel": ["hospedaje", "alojamiento", "stay"],

    # ── French equivalents ──
    "poisson": ["mariscos", "pescado", "ceviche", "seafood", "fish"],
    "viande": ["carnes", "carne", "parrilla", "steak"],
    "biere": ["cerveza", "cerveceria", "bar", "beer"],
    "gateau": ["pasteleria", "postres", "torta", "cake"],
    "petit dejeuner": ["desayuno", "cafe", "brunch", "breakfast"],
    "dejeuner": ["almuerzo", "comida", "lunch"],
    "diner": ["cena", "restaurante", "dinner"],
    "glace": ["helados", "helado", "postres"],
    "pharmacie": ["farmacia", "medicina"],
    "musee": ["museo", "cultura", "historia"],
    "aeroport": ["aeropuerto", "transporte", "transfer"],
    "bateau": ["lancha", "barco", "islas"],
    "cadeau": ["souvenir", "artesania", "recuerdo", "regalo"],
    "marche": ["mercado", "artesania", "local"],
    "pluie": ["museo", "shopping", "spa"],
    "ennuye": ["actividad", "tour", "experiencia"],
    "fatigue": ["spa", "masaje", "bienestar"],
    "romantique": ["romantico", "pareja", "cena"],
    "danser": ["bailar", "salsa", "discoteca"],
    "securite": ["seguridad", "seguro"],
    "urgence": ["emergencia", "hospital", "policia"],
    "ce soir": ["noche", "nocturno", "bar", "discoteca"],
    "anniversaire": ["cumpleanos", "fiesta", "celebracion"],
    "fete": ["fiesta", "discoteca", "club"],
    "mariage": ["boda", "evento", "venue"],
    "medecin": ["clinica", "hospital", "medico"],

    # ── Portuguese equivalents ──
    "peixe": ["mariscos", "pescado", "ceviche", "seafood", "fish"],
    "carne pt": ["carnes", "carne", "parrilla"],
    "cerveja": ["cerveza", "cerveceria", "bar", "beer"],
    "sorvete": ["helados", "helado", "postres"],
    "cafe da manha": ["desayuno", "cafe", "brunch"],
    "almoco": ["almuerzo", "comida", "lunch"],
    "jantar": ["cena", "restaurante", "dinner"],
    "farmacia pt": ["farmacia", "medicina"],
    "aeroporto": ["aeropuerto", "transporte", "transfer"],
    "presente": ["souvenir", "artesania", "recuerdo"],
    "chuva": ["museo", "shopping", "spa"],
    "entediado": ["actividad", "tour", "experiencia"],
    "cansado pt": ["spa", "masaje", "bienestar"],
    "dancar": ["bailar", "salsa", "discoteca"],
    "seguranca": ["seguridad", "seguro"],
    "emergencia pt": ["emergencia", "hospital", "policia"],
    "hoje a noite": ["noche", "nocturno", "bar"],
    "festa": ["fiesta", "discoteca", "club"],
    "casamento": ["boda", "evento", "venue"],

    # ── Inflections & slang (catch what people actually type) ──
    "raining": ["lluvia", "museo", "shopping", "spa", "indoor"],
    "rainy": ["lluvia", "museo", "shopping", "spa", "indoor"],
    "faim": ["restaurante", "comida", "comer", "gastronomia"],
    "fome": ["restaurante", "comida", "comer", "gastronomia"],
    "vibes": ["ambiente", "bar", "noche", "sunset", "rooftop", "discoteca"],
    "vibe": ["ambiente", "bar", "noche", "sunset", "rooftop"],
    "drinks": ["bar", "coctel", "cocteleria", "tragos"],
    "drinking": ["bar", "coctel", "tragos", "cerveza"],
    "eating": ["comida", "restaurante", "comer"],
    "swimming": ["playa", "piscina", "nadar", "beach"],
    "dancing": ["bailar", "salsa", "discoteca", "club"],
    "shopping": ["compras", "boutique", "tienda", "mercado"],
    "walking": ["caminata", "paseo", "tour", "recorrido"],
    "running": ["correr", "ejercicio", "parque"],
    "relaxing": ["relajar", "spa", "playa", "bienestar"],
    "celebrating": ["celebracion", "fiesta", "cumpleanos"],
    "partying": ["fiesta", "discoteca", "club", "noche"],
    "exploring": ["tour", "experiencia", "recorrido", "paseo"],
    "snorkeling": ["snorkel", "buceo", "islas"],
    "diving": ["buceo", "snorkel", "islas"],
    "surfing": ["surf", "kitesurf", "deporte"],
    "chillin": ["relajar", "tranquilo", "playa", "spa"],
    "chilling": ["relajar", "tranquilo", "playa", "spa"],
    "pregame": ["happy hour", "bar", "coctel"],
    "pregaming": ["happy hour", "bar", "coctel"],
    "bougie": ["lujo", "premium", "exclusivo", "elegante"],
    "boujee": ["lujo", "premium", "exclusivo", "elegante"],
    "lit": ["fiesta", "discoteca", "club", "noche"],
    "turnt": ["fiesta", "discoteca", "club", "noche"],
    "yolo": ["aventura", "experiencia", "exclusivo"],
    "hangover": ["brunch", "desayuno", "cafe", "jugos"],
    "sunburn": ["farmacia", "spa", "aloe"],
    "tanned": ["playa", "beach club", "piscina"],
    "starving": ["restaurante", "comida", "comer", "gastronomia"],
    "craving": ["comida", "restaurante", "antojo"],
    "splurge": ["lujo", "premium", "exclusivo", "degustacion"],
    "affordable": ["economico", "barato", "popular"],
    "budget": ["economico", "barato", "popular"],
    "romantic": ["romantico", "pareja", "cena", "intimo"],
    "instagrammable": ["fotografia", "instagram", "spots"],
}


def _normalize(text: str) -> List[str]:
    """Lowercase, strip accents, split into keywords, remove stopwords."""
    # Lowercase
    t = text.lower()
    # Strip accents: NFD decompose then remove combining marks
    t = unicodedata.normalize("NFD", t)
    t = re.sub(r"[\u0300-\u036f]", "", t)
    # Remove punctuation
    t = re.sub(r"[^\w\s]", " ", t)
    # Split and filter
    words = [w for w in t.split() if len(w) >= 2 and w not in _STOPWORDS]
    return words


def _build_index() -> None:
    """Load JSON and build inverted index. Called once at import time."""
    global _ENTRIES, _INDEX
    try:
        with open(_KNOWLEDGE_PATH, "r", encoding="utf-8") as f:
            _ENTRIES = json.load(f)
    except FileNotFoundError:
        logger.warning(f"[knowledge] File not found: {_KNOWLEDGE_PATH}")
        _ENTRIES = []
        return
    except json.JSONDecodeError as exc:
        logger.error(f"[knowledge] Invalid JSON in {_KNOWLEDGE_PATH}: {exc}")
        _ENTRIES = []
        return

    index: Dict[str, List[int]] = {}
    for i, entry in enumerate(_ENTRIES):
        # Index question text
        question_words = _normalize(entry.get("question", ""))
        # Index category
        category_words = _normalize(entry.get("category", ""))
        # Index ranked venue names (first 3 for relevance signal)
        ranked = entry.get("ranked", [])
        venue_words: List[str] = []
        for name in ranked[:3]:
            venue_words.extend(_normalize(name))

        all_words = set(question_words + category_words + venue_words)
        for word in all_words:
            if word not in index:
                index[word] = []
            index[word].append(i)

    _INDEX = index
    logger.info(f"[knowledge] Loaded {len(_ENTRIES)} entries, {len(_INDEX)} indexed keywords")


# Build index on import
_build_index()


def _expand_with_synonyms(words: List[str]) -> List[str]:
    """Expand a list of search words using the _SYNONYMS dict.

    For each word, if it exists as a key in _SYNONYMS, append all synonym
    words to the search terms. Also tries multi-word phrases (bigrams) from
    the original word list.
    """
    expanded = list(words)  # start with original words
    seen = set(words)

    # Try bigrams first (e.g., "ice cream", "date night", "petit dejeuner")
    if len(words) >= 2:
        for i in range(len(words) - 1):
            bigram = f"{words[i]} {words[i + 1]}"
            if bigram in _SYNONYMS:
                for syn in _SYNONYMS[bigram]:
                    # Normalize the synonym and add each resulting word
                    for sw in _normalize(syn):
                        if sw not in seen:
                            expanded.append(sw)
                            seen.add(sw)

    # Then single words
    for word in words:
        if word in _SYNONYMS:
            for syn in _SYNONYMS[word]:
                for sw in _normalize(syn):
                    if sw not in seen:
                        expanded.append(sw)
                        seen.add(sw)

    return expanded


def match_knowledge(user_text: str, top_k: int = 5) -> List[Dict[str, Any]]:
    """Match user text against the knowledge base using keyword overlap.

    Expands user words with synonyms BEFORE matching so that "fish" also
    matches entries containing "mariscos", "seafood", etc.

    Returns up to top_k entries sorted by relevance score (descending).
    Each result includes: category, question, ranked, score.
    """
    if not _ENTRIES or not _INDEX:
        return []

    user_words = _normalize(user_text)
    if not user_words:
        return []

    # Expand user words with synonyms before lookup
    search_words = _expand_with_synonyms(user_words)

    # Score each entry by counting how many search keywords match
    scores: Dict[int, int] = {}
    for word in search_words:
        for idx in _INDEX.get(word, []):
            scores[idx] = scores.get(idx, 0) + 1

    if not scores:
        return []

    # Sort by score descending, break ties by entry order (earlier = more popular category)
    ranked_indices = sorted(scores.keys(), key=lambda i: (-scores[i], i))

    results: List[Dict[str, Any]] = []
    for idx in ranked_indices[:top_k]:
        entry = _ENTRIES[idx]
        results.append({
            "category": entry.get("category", ""),
            "question": entry.get("question", ""),
            "ranked": entry.get("ranked", []),
            "score": scores[idx],
        })

    return results
