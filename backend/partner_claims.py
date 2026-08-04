"""
Partner Claim & Verify — pure logic (Drop B1).

Zero DB / zero framework dependencies so it is unit-testable in isolation.
The FastAPI routes in server.py import these helpers.

SECURITY SPINE (two failure modes this module is built to prevent):
  1. Duplication — a partner creates a NEW record for a venue that already
     exists.  `dedup_score` + `find_duplicates` + `DEDUP_THRESHOLD` are the
     server-side firewall that blocks a near-duplicate create.
  2. Impersonation-via-edit — a verified owner editing their way into trust
     badges / luxury collections / Luna's recs.  `EDITABLE_FIELDS` (allowlist)
     and `PROTECTED_FIELDS` (denylist) make that structurally impossible, not
     policy-only.
"""
from __future__ import annotations

import re
import unicodedata
from difflib import SequenceMatcher
from typing import Iterable

# ── Dedup threshold (reported in the deliverable) ────────────────────────────
# A create is blocked when the best existing candidate scores >= this.
DEDUP_THRESHOLD = 0.55
# Within the SAME neighborhood we are stricter (more likely a true dup); the
# +0.15 same-hood boost in dedup_score is applied before this compare.
DEDUP_THRESHOLD_SAME_HOOD = 0.50

# Stop / filler words that carry no disambiguating signal in venue names:
# articles/prepositions, the city name, and generic venue-TYPE words (multi-
# lingual) that many distinct venues share ("Rincón", "Cevichería", "Ristorante"…).
# Stripping these keeps the DISTINCTIVE token(s) dominant so dedup neither
# misses "Bellini" vs "Bellini Ristorante" nor falsely matches two venues that
# merely share "Rincón".
_STOP = {
    # articles / prepositions / conjunctions
    "el", "la", "los", "las", "de", "del", "y", "e", "a", "en", "por", "para",
    "con", "the", "of", "and", "le", "les", "du", "da", "di",
    # place / brand filler
    "cartagena", "indias", "colombia", "centro", "beach",
    # generic venue-type words (ES / EN / IT / FR)
    "bar", "cafe", "café", "coffee", "restaurante", "restaurant", "ristorante",
    "trattoria", "osteria", "pizzeria", "hotel", "hostal", "hostel", "club",
    "casa", "rooftop", "lounge", "bistro", "brasserie", "grill", "kitchen",
    "cocina", "cantina", "taberna", "fonda", "parrilla", "asadero", "cevicheria",
    "cebicheria", "marisqueria", "taqueria", "rincon", "esquina", "terraza",
    "jardin", "patio", "plaza", "punto", "sitio", "lugar", "house", "spa",
}


def strip_accents(s: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn"
    )


def normalize_name(s: str | None) -> str:
    """Lowercase, strip accents, collapse punctuation/space. Deterministic."""
    if not s:
        return ""
    s = strip_accents(str(s)).lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _tokens(s: str | None, drop_stop: bool = True) -> set[str]:
    toks = normalize_name(s).split()
    if drop_stop:
        stripped = [t for t in toks if t not in _STOP]
        # never return empty just because every token was a stop-word
        return set(stripped or toks)
    return set(toks)


def _token_match(a: str, b: str) -> bool:
    """Exact, or a near-miss typo of the SAME distinctive token.

    Fuzzy matching is gated to tokens of length >= 4 (so short generic words like
    "bar"/"mar" don't collide) and a high ratio, so it catches "belini"~"bellini"
    without inventing matches between unrelated words.
    """
    if a == b:
        return True
    if len(a) < 4 or len(b) < 4:
        return False
    return SequenceMatcher(None, a, b).ratio() >= 0.84


def _fuzzy_inter(ta: set[str], tb: set[str]) -> int:
    """Count tokens of `ta` that have an exact-or-fuzzy match in `tb` (1:1)."""
    used: set[str] = set()
    count = 0
    for a in ta:
        for b in tb:
            if b in used:
                continue
            if _token_match(a, b):
                used.add(b)
                count += 1
                break
    return count


def similarity(a: str | None, b: str | None) -> float:
    """0..1 name similarity: max(token-Jaccard, shorter-name containment), where
    token overlap is FUZZY (tolerates a 1-2 char typo of a distinctive token).

    Shorter-name containment = inter/min(len(a), len(b)) — so a short name that
    is FULLY inside a longer one scores 1.0 ("Bellini" vs "Bellini Ristorante",
    "Carmen" vs "Restaurante Carmen"). Fuzzy matching also traps deliberate
    single-character misspellings ("Belini" vs "Bellini"). False positives from a
    shared COMMON word are handled by stripping venue-type / filler words in
    `_STOP`, not by weakening this metric.
    """
    # exact normalized string match is a hard 1.0
    if normalize_name(a) == normalize_name(b):
        return 1.0
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    inter = _fuzzy_inter(ta, tb)
    if inter == 0:
        return 0.0
    union = len(ta) + len(tb) - inter
    jaccard = inter / union if union else 0.0
    containment_shorter = inter / min(len(ta), len(tb))
    return max(jaccard, containment_shorter)


def dedup_score(
    new_name: str | None,
    new_hood: str | None,
    existing_name: str | None,
    existing_hood: str | None,
) -> float:
    """Name similarity, nudged up when the neighborhood also matches."""
    name_sim = similarity(new_name, existing_name)
    if name_sim <= 0:
        return 0.0
    nh, eh = normalize_name(new_hood), normalize_name(existing_hood)
    same_hood = bool(nh) and bool(eh) and (nh == eh or nh in eh or eh in nh)
    if same_hood:
        # same name-ish AND same barrio => very likely the same venue
        return min(1.0, name_sim + 0.15)
    return name_sim


def is_duplicate(score: float, same_hood: bool) -> bool:
    thr = DEDUP_THRESHOLD_SAME_HOOD if same_hood else DEDUP_THRESHOLD
    return score >= thr


def find_duplicates(
    new_name: str | None,
    new_hood: str | None,
    candidates: Iterable[dict],
    name_key: str = "name",
    hood_key: str = "neighborhood",
    limit: int = 8,
) -> list[dict]:
    """Return candidate venues that trip the dedup firewall, best first.

    Each returned item: {..candidate.., _score, _is_duplicate}.
    """
    out: list[dict] = []
    nh_new = normalize_name(new_hood)
    for c in candidates:
        cname = c.get(name_key)
        chood = c.get(hood_key) or c.get("barrio") or c.get("address")
        score = dedup_score(new_name, new_hood, cname, chood)
        if score <= 0:
            continue
        nh_c = normalize_name(chood)
        same_hood = bool(nh_new) and bool(nh_c) and (
            nh_new == nh_c or nh_new in nh_c or nh_c in nh_new
        )
        item = dict(c)
        item["_score"] = round(score, 3)
        item["_is_duplicate"] = is_duplicate(score, same_hood)
        out.append(item)
    out.sort(key=lambda x: x["_score"], reverse=True)
    return out[:limit]


def search_catalog(
    q: str | None,
    neighborhood: str | None,
    candidates: Iterable[dict],
    name_key: str = "name",
    hood_key: str = "neighborhood",
    limit: int = 20,
) -> list[dict]:
    """Fuzzy "find your business" search — looser than dedup, ranked by score."""
    out: list[dict] = []
    for c in candidates:
        cname = c.get(name_key)
        score = similarity(q, cname)
        if neighborhood:
            chood = c.get(hood_key) or c.get("barrio") or c.get("address")
            if similarity(neighborhood, chood) >= 0.5 or normalize_name(neighborhood) in normalize_name(chood):
                score = min(1.0, score + 0.1)
        if score < 0.25:
            continue
        item = dict(c)
        item["_score"] = round(score, 3)
        out.append(item)
    out.sort(key=lambda x: x["_score"], reverse=True)
    return out[:limit]


# ── Edit firewall (B1E) ──────────────────────────────────────────────────────
# The ONLY fields a verified owner may write on their own venue record.
# Each maps to a max length — enforced so an edit can't corrupt a field's type
# or bloat the document (mirrors the caps applied at venue creation).
_TEXT_FIELD_MAX: dict[str, int] = {
    "description": 2000,
    "hours": 400,
    "phone": 40,
    "whatsapp": 40,
    "website": 300,
    "booking_link": 300,
    "menu_link": 300,
    "instagram": 120,
    "address": 300,
    "experience": 2000,
    "price_range": 40,
    "default_payment_link": 300,
}
EDITABLE_FIELDS: set[str] = set(_TEXT_FIELD_MAX) | {
    "image_url",            # value must pass validate_image_value (I3)
    "photos",               # each item must pass validate_image_value (I3)
    "images",               # each item must pass validate_image_value (I3)
}

# Fields a partner can NEVER write — editorial / trust / structural.
# A request carrying ANY of these is hard-rejected (403) so the block is
# observable, not silently dropped.
PROTECTED_FIELDS: set[str] = {
    # trust badges + confidence tier
    "trust", "confidence", "verified", "is_certified", "price_reference",
    "rnt", "place_verified",
    # occasion tags / curated-collection membership (Luna + collections integrity)
    "tags", "occasion_tags", "collections", "curated", "is_featured", "featured",
    "gem_rarity",
    # paid / partner status leaking into organic recs
    "membership_tier", "membership_status", "membership_plan", "membership_paid_until",
    "tier", "is_government", "sponsored", "promoted", "rank_boost", "order",
    # claim / catalog control surfaces
    "claim_status", "claimed_by", "claim_method", "catalog_status", "status",
    "partner_id", "business_id",
    # the venue's on-record email is the email-verification TARGET — if a
    # partner could edit it they could redirect their own verification code.
    "email",
    # editorial identity / scoring
    "rating", "reviews", "google_place_id", "geo", "location", "name", "category",
    "subcategory", "why_it_matters",
}

_IMAGE_FIELDS = {"image_url", "photos", "images"}


def is_external_url(value: str) -> bool:
    v = (value or "").strip().lower()
    return v.startswith("http://") or v.startswith("https://")


def validate_image_value(value) -> bool:
    """I3: a partner-supplied image must be a moderated data: URL or a
    self-hosted /images/ path — NEVER a raw external URL (e.g. Google Places).

    Non-string input (dict/list/int/None) is rejected outright — never coerced —
    so a malformed body cleanly fails validation instead of crashing on .strip().
    """
    if not isinstance(value, str):
        return False
    v = value.strip()
    if not v:
        return False
    if v.startswith("data:image/"):
        return True
    if v.startswith("/images/"):
        return True
    return False


class FirewallError(Exception):
    """Raised when a partner edit touches a protected field or violates I3.
    Carries an HTTP status + a bilingual message for the route layer."""

    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message
        super().__init__(message)


def sanitize_edit(body: dict) -> dict:
    """Apply the edit firewall to a raw request body.

    Returns the safe {field: value} update. Raises FirewallError on any
    protected field or I3 image violation — the caller maps it to an HTTP error.
    """
    if not isinstance(body, dict):
        raise FirewallError(400, "Cuerpo inválido / Invalid body")

    # 1) Hard-reject any protected field (observable block, not silent drop).
    present_protected = [k for k in body.keys() if k in PROTECTED_FIELDS]
    if present_protected:
        raise FirewallError(
            403,
            "Campo protegido — solo editorial: "
            + ", ".join(sorted(present_protected))
            + " / Protected field — editorial only",
        )

    # 2) Keep only allowlisted fields.
    update = {k: v for k, v in body.items() if k in EDITABLE_FIELDS}

    # 3) Text fields must be strings and are length-capped — a non-string (dict /
    #    list / number) would corrupt the field's type and break every downstream
    #    string consumer (Luna prompt builder, CSV export, rendering); an
    #    unbounded string is a document-bloat DoS vector.
    for f, maxlen in _TEXT_FIELD_MAX.items():
        if f in update:
            val = update[f]
            if not isinstance(val, str):
                raise FirewallError(400, f"{f} debe ser texto / must be a string")
            update[f] = val[:maxlen]

    # 4) I3 image validation.
    for f in _IMAGE_FIELDS & set(update.keys()):
        val = update[f]
        if f == "image_url":
            if not validate_image_value(val):
                raise FirewallError(
                    422,
                    "Imagen inválida: debe subirse moderada (I3), nunca un URL externo "
                    "/ Image must be a moderated upload, never a raw external URL",
                )
        else:  # photos / images arrays
            if not isinstance(val, list) or not all(isinstance(u, str) for u in val):
                raise FirewallError(400, f"{f} debe ser una lista de URLs / must be a list of URLs")
            for u in val:
                if not validate_image_value(u):
                    raise FirewallError(
                        422,
                        "Imagen inválida (I3): solo subidas moderadas o /images/ "
                        "/ Only moderated uploads or /images/ paths allowed",
                    )
            update[f] = val[:20]

    return update
