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


def match_knowledge(user_text: str, top_k: int = 5) -> List[Dict[str, Any]]:
    """Match user text against the knowledge base using keyword overlap.

    Returns up to top_k entries sorted by relevance score (descending).
    Each result includes: category, question, ranked, score.
    """
    if not _ENTRIES or not _INDEX:
        return []

    user_words = _normalize(user_text)
    if not user_words:
        return []

    # Score each entry by counting how many user keywords match
    scores: Dict[int, int] = {}
    for word in user_words:
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
