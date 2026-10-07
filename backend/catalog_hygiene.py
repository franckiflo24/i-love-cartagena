"""catalog_hygiene.py — CATALOG-HYGIENE v1 (drop 2026-10-07).

Stops SEO/directory strings from reaching a Luna answer or an instant card
WITHOUT fabricating a single venue fact. Pure logic + curated tables; no DB,
no I/O. Wired into: scripts/ingest_beauty.py (clean on write), maintenance.py
(idempotent + reversible migration over db.partners, backup-before-write),
partner_visibility.CONCIERGE_PARTNER_FILTER (the display_ready retrieval gate
every Luna/instant partner read merges).

Doctrine (both audits, 2026-10-07): clean what we can PROVE (override table =
the trusted path; recase/strip = mechanical, never inventive); hide what we
can't behind display_ready=False — the lenses' min_fill philosophy applied to
names. Every original string survives in name_raw for rollback and for the
"verified source" story.

Field reality of THIS catalog (853 editorial docs, verified live 2026-10-07 —
the drop spec said adapt, so the deltas are deliberate):
- there is NO `neighborhood` field; `location` is a {lat,lng} OBJECT and `geo`
  a GeoJSON Point. min_fill therefore = (address present) OR (coords present).
  Requiring a neighborhood would have flipped the entire catalog to hidden.
- editorial docs carry no `status`; STATUS_OVERRIDES write one, and
  partner_visibility's $nin hides "closed"/"unverified" catalog-wide.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, Mapping, Optional, Tuple

HYGIENE_V = 1

# Trailing/boilerplate category tokens we may safely STRIP from a name tail.
CATEGORY_WORDS = {
    "restaurant", "restaurants", "restaurante", "restaurantes", "bar", "bares",
    "cafe", "café", "cafetería", "cafeteria", "coffee", "hotel", "hostel",
    "seafood", "mariscos", "marisquería", "marisqueria", "tapas", "pizzeria",
    "pizzería", "pizza", "grill", "lounge", "club", "rooftop", "brunch",
    "cocina", "comida", "food", "drinks", "cocteles", "cócteles", "cartagena",
    "and", "&", "y", "de", "la", "el",
}

# Connectors/articles live in CATEGORY_WORDS for tail-STRIPPING only — they
# are NOT category evidence. Counting " el " as a category hit turned every
# 'El X Bar' into a blob (dry-run regression 2026-10-07).
CONNECTOR_TOKENS = {"and", "&", "y", "de", "la", "el"}
_COUNTABLE_CATEGORY = CATEGORY_WORDS - CONNECTOR_TOKENS

# Small words kept lowercase in Title Case (unless first token).
SMALL = {"de", "la", "el", "las", "los", "y", "del", "by", "con", "the", "of",
         "and", "à", "en", "a"}
# Tokens preserved verbatim (brand/acronym/roman).
PROTECT = {"AMO", "MM", "KGB", "NH", "GHL"}
ROMAN = re.compile(r"^[IVXLC]+$")
SEP = re.compile(r"\s*[/|·—–]\s*| - ")


def _nfc(s: Optional[str]) -> str:
    return unicodedata.normalize("NFC", s or "").strip()


def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s)
                   if not unicodedata.combining(c))


def normalize_key(s: Optional[str]) -> str:
    """Accent-stripped, punctuation-free lookup key. Stripped on purpose:
    the override/status tables are seeded in plain ASCII and must match
    'Época Café Bar' and 'Zaitún' as written in the wild."""
    s = _strip_accents(_nfc(s).lower())
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


# Override-FIRST. Seeded from verified research; GROW as Frank / verified
# sources confirm names. key = normalize_key(raw name). This is the trusted
# path — an override is the only way a cleaned name gains confident=True
# when the mechanical pass still smells directory.
CANONICAL_OVERRIDES: Dict[str, str] = {
    "celele": "Celele", "celele restaurante": "Celele",
    "carmen": "Carmen", "alma": "Alma", "alquimico": "Alquímico",
    "club de pesca": "Club de Pesca", "la cevicheria": "La Cevichería",
    "cande": "Candé", "donjuan": "Donjuán", "carta ajena": "Carta Ajena",
    "benitto": "Benitto", "da pietro": "Da Pietro", "moshi": "Moshi",
    "marea by rausch": "Marea by Rausch",
    "erre de ramon freixa": "Erre de Ramón Freixa",
    "el burlador de sevilla": "El Burlador de Sevilla",
    "buena vida marisqueria": "Buena Vida Marisquería",
    "clero": "Clero", "la mulata": "La Mulata", "7 cielos": "7 Cielos",
    "ana restaurante": "Ana Restaurante", "1811": "1811",
    "juan del mar": "Juan del Mar", "la vitrola": "La Vitrola",
    "epoca cafe bar": "Época Café Bar",
    "abaco libros y cafe": "Ábaco Libros y Café",
    "nia bakery": "Nía Bakery", "cafe san alberto": "Café San Alberto",
    "casa boheme": "Casa Bohème",
    # live-audit specimens (2026-10-07), heads verified against the venues:
    "ca fe cafeteria brunch cartagena": "CA.FÉ",
    "el bololo bowls del caribe": "El Bololó",
    "amo el cafe cafe de especialidad": "Amo el Café",
}

# Verified DEAD / MOVED / UNVERIFIED — never show, never delete.
# {normalize_key: (new_status, note)}. partner_visibility hides these statuses
# catalog-wide; reverse migration deliberately KEEPS them (spec).
STATUS_OVERRIDES: Dict[str, Tuple[str, str]] = {
    "interno": ("closed", "Ceased Cartagena ops ~2019 (research-verified)"),
    "cafe del mar": ("closed", "Evicted Baluarte Sto Domingo Sep-2024; now Baluarte de la Gente"),
    "sant just": ("unverified", "Only documented in Bogotá; no Cartagena listing"),
    "zaitun": ("unverified", "Appears closed/rebranded 'La Garza Café' — hold"),
}


def _titlecase(s: str) -> str:
    out = []
    for i, w in enumerate(s.split()):
        bare = w.strip("&")
        if w.upper() in PROTECT or ROMAN.match(bare.upper() or "-") or w.isdigit():
            out.append(w.upper() if w.isalpha() else w)
        elif i > 0 and w.lower() in SMALL:
            out.append(w.lower())
        else:
            out.append(w[:1].upper() + w[1:].lower())
    return " ".join(out)


def _looks_like_directory(s: str) -> bool:
    """True if a string still smells like an SEO/category blob."""
    low = f" {s.lower()} "
    if SEP.search(s):
        return True
    cat_hits = sum(1 for w in _COUNTABLE_CATEGORY if f" {w} " in low)
    caps_words = [w for w in s.split() if len(w) > 2 and w.isupper()]
    return cat_hits >= 2 or len(caps_words) >= 3


def clean_display_name(raw: Optional[str]) -> Tuple[str, Optional[str], bool]:
    """Returns (display_name, category_hint|None, confident).

    NEVER invents a brand: either we KNOW it (CANONICAL_OVERRIDES) or we only
    recase/strip mechanically; if the result still smells like a directory
    string — or the head is a fragment with no real brand token — confident
    stays False and the retrieval gate keeps it out of Luna until verified.
    """
    raw = _nfc(raw)
    if not raw:
        return (raw, None, False)
    key = normalize_key(raw)
    if key in CANONICAL_OVERRIDES:
        return (CANONICAL_OVERRIDES[key], None, True)

    parts = [p for p in SEP.split(raw) if p and p.strip()]
    head = parts[0].strip() if parts else ""
    hint = " · ".join(_titlecase(p.strip()) for p in parts[1:]) or None

    # Strip trailing category tokens — and then any connector the strip left
    # dangling ('Casa Pizarro in Cartagena' → 'Casa Pizarro', never
    # 'Casa Pizarro in'). Never down to empty.
    toks = head.split()
    _TRAIL = CATEGORY_WORDS | {"in", "en", "del", "los", "las"}
    while len(toks) > 1 and toks[-1].lower().strip("&") in _TRAIL:
        toks.pop()
    head = " ".join(toks)

    display = _titlecase(head) if (head.isupper() or head.islower()) else head
    # Confidence is earned, never guessed — but articles are not guesses:
    # - a raw that arrived MULTI-PART (separators) or category-stuffed stays
    #   unconfident even when its head cleans nicely — we don't guess the
    #   brand boundary; the override table is the only promotion path.
    #   An ALL-CAPS run alone is NOT blob evidence on the raw side: plain
    #   shouting ('LUNALA HOTEL BOUTIQUE') recases cleanly (dry-run 2026-10-07
    #   showed the caps rule alone would have hidden legitimate venues).
    # - a FRAGMENT head opens on a true connector ('by Rausch'); Spanish/
    #   English ARTICLES (El/La/The…) are legitimate name openers and never
    #   fragments (same dry-run: 'El Mirador', 'The Pink Mango').
    low_raw = f" {raw.lower()} "
    raw_cat_hits = sum(1 for w in _COUNTABLE_CATEGORY if f" {w} " in low_raw)
    raw_blob = len(parts) > 1 or raw_cat_hits >= 2
    toks_disp = display.split()
    _CONNECTOR_OPENERS = {"by", "de", "del", "con", "y", "and", "of", "en", "à", "a"}
    fragment = (not toks_disp) or (toks_disp[0].lower() in _CONNECTOR_OPENERS
                                   and len(toks_disp) <= 2)
    confident = (bool(display) and len(display) >= 2 and not fragment
                 and not raw_blob and not _looks_like_directory(display))
    return (display or raw, hint, confident)


def min_fill_ok(doc: Mapping[str, Any]) -> bool:
    """Concierge eligibility floor. Hours are NOT required — we don't
    fabricate what we don't have. Adapted to this catalog's real fields:
    locatable = a non-empty address OR usable coords (location{lat,lng} or
    geo.coordinates)."""
    if (doc.get("address") or "").strip():
        return True
    loc = doc.get("location") or {}
    if isinstance(loc, Mapping) and loc.get("lat") and loc.get("lng"):
        return True
    geo = doc.get("geo") or {}
    coords = geo.get("coordinates") if isinstance(geo, Mapping) else None
    return bool(coords and len(coords) == 2 and coords[0] and coords[1])


def compute_display_ready(doc: Mapping[str, Any], confident_name: bool) -> bool:
    status = doc.get("status") or "active"
    if status in ("closed", "unverified"):
        return False
    return bool(confident_name) and min_fill_ok(doc)


def apply_hygiene(doc: Dict[str, Any]) -> Dict[str, Any]:
    """The one write-path entry point (ingest + migration share it).
    Mutates and returns doc. Never clobbers a human-verified name
    (name_verified=True); always preserves name_raw once."""
    raw = doc.get("name_raw") or doc.get("name") or ""
    disp, hint, conf = clean_display_name(raw)
    so = STATUS_OVERRIDES.get(normalize_key(raw))
    if so:
        doc["status"], doc["status_note"] = so
    doc.setdefault("name_raw", raw)
    if not doc.get("name_verified"):
        doc["name"] = disp
    if hint:
        doc["category_hint"] = hint
    doc["display_ready"] = compute_display_ready(
        doc, conf or bool(doc.get("name_verified")))
    doc["hygiene_v"] = HYGIENE_V
    return doc
