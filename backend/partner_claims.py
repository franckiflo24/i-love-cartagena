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
# A create is blocked when the best existing candidate scores >= this. The score
# is asymmetric: it measures how much of the NEW name is covered by an existing
# venue (see similarity()), so recreating an existing venue is blocked while a
# genuinely different new venue that merely shares one common word is NOT.
DEDUP_THRESHOLD = 0.60

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
    """ASYMMETRIC 0..1 similarity of NEW name `a` against EXISTING name `b`.

    Returns max(fuzzy-Jaccard, containment-of-A), where containment-of-A =
    inter/len(tokens(a)) — i.e. how much of the NEW name is matched by the
    existing venue. This is the key to avoiding false positives:

      - "Belini Beach Club"  vs "Bethel Bellini Beach Club" -> the new name's one
        distinctive token fuzzy-matches -> containment 1.0 -> BLOCK (a recreation).
      - "Carmen"             vs "Restaurante Carmen"        -> 1.0 -> BLOCK.
      - "Loro Verde Cantina" vs "Verde Cartagena"           -> only 1 of the new
        name's 2 distinctive tokens matches -> containment 0.5 -> NOT a dup
        (a genuinely different venue that merely shares the common word "verde").

    Token overlap is fuzzy (tolerates a 1-char typo). Deliberate space-splits
    ("Bel lini") and 2-edit typos fall through to admin review (drafts stay
    pending_review) rather than risk blocking a legitimate new business — an
    over-block is a self-serve outage, strictly worse than an under-catch.
    """
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
    containment_new = inter / len(ta)   # how much of the NEW name is matched
    return max(jaccard, containment_new)


def dedup_score(
    new_name: str | None,
    new_hood: str | None,
    existing_name: str | None,
    existing_hood: str | None,
) -> float:
    """Duplicate score = asymmetric name similarity (new vs existing).

    Neighborhood is deliberately NOT used to boost the score: the old +0.15
    same-hood boost pushed borderline single-common-word overlaps over the line
    and blocked legitimate venues. A true duplicate already scores high on name
    alone.
    """
    return similarity(new_name, existing_name)


def is_duplicate(score: float, same_hood: bool = False) -> bool:
    # same_hood is accepted for call-site compatibility but no longer changes
    # the verdict (see dedup_score).
    return score >= DEDUP_THRESHOLD


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
    "default_payment_link": 300,
    # NOTE: price_range is deliberately NOT here — B2D routes ALL price changes
    # through the moderated partner-price submission, never a direct edit.
}
# List-of-strings fields a partner may edit directly (B2B): each capped.
_LIST_FIELD_MAX: dict[str, tuple[int, int]] = {  # field -> (max items, max item len)
    "signature_dishes": (12, 80),
    "amenities": (20, 40),
}
# Images are NOT directly editable (C3): a partner cannot set image_url / photos
# via PUT /business/profile — that path skipped AI moderation + review and had no
# size cap. ALL partner images now go through /business/media (moderate → admin
# review → appended to photos). The primary image_url is admin-controlled.
EDITABLE_FIELDS: set[str] = set(_TEXT_FIELD_MAX) | set(_LIST_FIELD_MAX)

# Fields a partner can NEVER write — editorial / trust / structural.
# A request carrying ANY of these is hard-rejected (403) so the block is
# observable, not silently dropped.
PROTECTED_FIELDS: set[str] = {
    # trust badges + confidence tier
    "trust", "confidence", "verified", "is_certified", "price_reference",
    "rnt", "place_verified",
    # partner_price is set ONLY by the moderated B2D flow, never a direct edit
    "partner_price",
    # images go ONLY through the moderated /business/media flow (C3) — a direct
    # write hard-403s so the block is observable, not silently dropped
    "image_url", "photos", "images",
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
    if len(v) > 700_000:   # ~500KB image — cap so a data: URL can't bloat the doc
        return False
    if v.startswith("data:image/"):
        return True
    if v.startswith("/images/"):
        return True
    # Our OWN Vercel Blob store — the URL is always generated server-side from the
    # partner's moderated upload (never partner-supplied), so it's trusted, not an
    # arbitrary external URL. Public Blob host: <store>.public.blob.vercel-storage.com
    if v.startswith("https://") and "blob.vercel-storage.com" in v:
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

    # 3b) List-of-strings fields (signature_dishes, amenities): capped count + item length.
    for f, (max_items, max_len) in _LIST_FIELD_MAX.items():
        if f in update:
            val = update[f]
            if not isinstance(val, list) or not all(isinstance(x, str) for x in val):
                raise FirewallError(400, f"{f} debe ser una lista de textos / must be a list of strings")
            update[f] = [x.strip()[:max_len] for x in val if x.strip()][:max_items]

    # Images are not in EDITABLE_FIELDS (they hard-403 as PROTECTED above); they
    # flow only through the moderated /business/media pipeline.
    return update
