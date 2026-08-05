"""Single source of truth for partner-catalog visibility (Drop B1/B2).

EVERY public-facing partner / partner_event read — in ANY module — must merge
PUBLIC_PARTNER_FILTER (and, for events, require is_published + drop events whose
venue isn't approved). Keeping this in one importable place is what stops a new
route in a new module from silently reintroducing the ghost/unapproved-content
leak (the U1-U6 class of finding).
"""

# Partner-submitted drafts, rejected drafts, and the demo sandbox never surface
# publicly. $nin ALSO matches documents missing the field, so the 861 pre-existing
# editorial venues (no catalog_status) are unaffected.
PUBLIC_PARTNER_FILTER = {"catalog_status": {"$nin": ["pending_review", "rejected", "sandbox"]}}

# Internal ownership / moderation fields stripped from any PUBLIC partner response.
INTERNAL_PARTNER_FIELDS = (
    "submitted_email", "submitted_by", "claimed_by", "claim_method",
    "claim_verified_at", "approved_by", "rejected_by", "reject_reason",
)
PUBLIC_PARTNER_PROJECTION = {"_id": 0, **{f: 0 for f in INTERNAL_PARTNER_FIELDS}}


def is_publicly_visible(partner: dict) -> bool:
    """True if a partner doc may be shown publicly (used where a filter can't be
    pushed into the query, e.g. after a geo/aggregation stage)."""
    return (partner or {}).get("catalog_status") not in ("pending_review", "rejected", "sandbox")
