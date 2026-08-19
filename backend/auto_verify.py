"""Auto-Verify — deterministic verification for partner PRICE submissions.

Photos (ai_image_moderation) and events (ai_moderation) already auto-verify via
AI. Prices are numeric, so we verify them DETERMINISTICALLY against data we can
actually check — never a guess:

  1. Hard realistic COP bounds (a number outside them is a typo / wrong unit).
  2. The venue's OWN declared price tier ($ / $$ / $$$ / $$$$) — the most
     verifiable reference we have. A range that can't overlap its tier (even
     generously) is escalated, not auto-approved.

Plausible → AUTO_APPROVE (published as "informado por el negocio", NEVER an
editorial/verified price). Implausible or unverifiable → NEEDS_REVIEW (a human
decides, with the evidence pre-attached). Prices never auto-REJECT — a price is
not a policy violation, only more or less plausible.

Every verdict carries its `evidence` so the decision is auditable, never a black
box. The tier→COP bands below are a documented bootstrap; once enough partner
prices are approved they can be re-derived from real data per category.
"""
from __future__ import annotations

from typing import Optional

# Realistic per-person / per-service COP bounds for Cartagena tourism (2026).
# Outside these is almost always a typo or wrong unit → human review, never auto.
HARD_MIN = 100
HARD_MAX = 20_000_000

# A submitted range wider than this ratio (e.g. 1,000 – 5,000,000) is nonsensical.
MAX_RANGE_RATIO = 200

# Expected per-person COP band per declared price tier — the venue's own symbol
# is the reference. Bootstrap heuristic; re-derivable from approved data later.
TIER_BANDS = {
    "$":    (5_000, 60_000),
    "$$":   (25_000, 180_000),
    "$$$":  (80_000, 500_000),
    "$$$$": (250_000, 3_000_000),
}
# Generous tolerance so a legit outlier item (a $ café with one premium tasting
# menu) is not wrongly flagged: a band is stretched down to LO× and up to HI×.
LO_TOLERANCE = 0.4
HI_TOLERANCE = 2.5


def verify_price(*, price_range: Optional[str], low: Optional[int],
                 high: Optional[int], label: str = "") -> dict:
    """Deterministically verify a partner price submission.

    Returns {"verdict": "AUTO_APPROVE"|"NEEDS_REVIEW", "reason": str, "evidence": dict}.
    """
    vals = [v for v in (low, high) if v is not None]

    # A note-only submission (no numbers) can't be numerically verified → human.
    if not vals:
        return {
            "verdict": "NEEDS_REVIEW",
            "reason": "Nota de precio sin rango numérico — revisión manual",
            "evidence": {"reason_code": "no_numeric_range", "label": label[:120]},
        }

    lo = min(vals)
    hi = max(vals)

    # 1) Hard realistic bounds — an impossible number is a typo / wrong unit.
    if lo < HARD_MIN or hi > HARD_MAX:
        return {
            "verdict": "NEEDS_REVIEW",
            "reason": f"Precio fuera del rango realista (COP {HARD_MIN:,}–{HARD_MAX:,}) — revisión manual",
            "evidence": {"reason_code": "out_of_hard_bounds", "submitted": [lo, hi],
                         "hard_bounds": [HARD_MIN, HARD_MAX]},
        }

    # 2) Nonsensical range width.
    if lo > 0 and hi > lo * MAX_RANGE_RATIO:
        return {
            "verdict": "NEEDS_REVIEW",
            "reason": "Rango de precio demasiado amplio — revisión manual",
            "evidence": {"reason_code": "range_too_wide", "submitted": [lo, hi],
                         "max_ratio": MAX_RANGE_RATIO},
        }

    # 3) Consistency vs the venue's OWN declared price level.
    band = TIER_BANDS.get((price_range or "").strip())
    if band:
        band_lo, band_hi = band
        allowed_lo = band_lo * LO_TOLERANCE
        allowed_hi = band_hi * HI_TOLERANCE
        # Overlap of the submitted range with the (tolerant) tier band.
        if hi < allowed_lo or lo > allowed_hi:
            return {
                "verdict": "NEEDS_REVIEW",
                "reason": (f"No coincide con el nivel de precio del negocio "
                           f"({price_range}: ~COP {band_lo:,}–{band_hi:,}) — revisión manual"),
                "evidence": {"reason_code": "tier_mismatch", "price_range": price_range,
                             "tier_band": [band_lo, band_hi], "submitted": [lo, hi]},
            }
        return {
            "verdict": "AUTO_APPROVE",
            "reason": f"Coherente con el nivel {price_range} del negocio",
            "evidence": {"reason_code": "tier_consistent", "price_range": price_range,
                         "tier_band": [band_lo, band_hi], "submitted": [lo, hi]},
        }

    # 4) No tier reference (Varía / none) — passed hard bounds, but there is
    #    nothing to verify against, so we escalate honestly rather than guess.
    return {
        "verdict": "NEEDS_REVIEW",
        "reason": "Sin nivel de precio de referencia para verificar — revisión manual",
        "evidence": {"reason_code": "no_tier_reference", "price_range": price_range,
                     "submitted": [lo, hi]},
    }
