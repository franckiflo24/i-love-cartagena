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
# Also honor a legacy `status` field: 14 partners carry status:"pending_review"
# with catalog_status:None, so the catalog_status gate alone let them leak public
# unhedged (audit). $nin matches docs missing `status` too, so editorial venues
# (no status) are unaffected — only genuinely pending/rejected ones are hidden.
PUBLIC_PARTNER_FILTER = {
    "catalog_status": {"$nin": ["pending_review", "rejected", "sandbox"]},
    "status": {"$nin": ["pending_review", "rejected", "needs_verification"]},
}

# Internal ownership / moderation fields stripped from any PUBLIC partner response.
INTERNAL_PARTNER_FIELDS = (
    "submitted_email", "submitted_by", "claimed_by", "claim_method",
    "claim_verified_at", "approved_by", "rejected_by", "reject_reason",
)
# Internal metadata that lives INSIDE sub-documents — a top-level exclusion can't
# reach these, so they must be named explicitly (e.g. the moderator email stamped
# into partner_price at approval time). MongoDB honours dotted-path exclusions.
INTERNAL_PARTNER_NESTED_FIELDS = (
    "partner_price.approved_by", "partner_price.approved_at",
)
PUBLIC_PARTNER_PROJECTION = {
    "_id": 0,
    **{f: 0 for f in INTERNAL_PARTNER_FIELDS},
    **{f: 0 for f in INTERNAL_PARTNER_NESTED_FIELDS},
}

# partner_events carry their own moderation trail, stamped directly onto the doc by
# the government moderation route (reviewed_by = the moderator's account email). The
# PUBLIC event reads (/partner-events, /experiences) must strip these; the OWNER's
# own /business/* views and the /admin moderation queue keep them (different routes).
INTERNAL_EVENT_FIELDS = ("reviewed_by", "reviewed_at", "moderation_status", "moderation_reason")
PUBLIC_EVENT_PROJECTION = {"_id": 0, **{f: 0 for f in INTERNAL_EVENT_FIELDS}}

# The curated/seasonal `events` collection (editorial, NOT partner-submitted) can
# carry a moderation_status from the AI auto-approval pipeline. Public reads must
# never render a pending/rejected editorial draft, and must strip the trail. $nin
# also matches docs missing the field, so plain editorial events are unaffected.
PUBLIC_CITY_EVENT_FILTER = {"moderation_status": {"$nin": ["pending", "rejected"]}}


def is_publicly_visible(partner: dict) -> bool:
    """True if a partner doc may be shown publicly (used where a filter can't be
    pushed into the query, e.g. after a geo/aggregation stage)."""
    return (partner or {}).get("catalog_status") not in ("pending_review", "rejected", "sandbox")
