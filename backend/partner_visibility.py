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
#
# is_public gates the ENTIRE admin_operator lifecycle (invited/activated/suspended
# are is_public=False; only admin approval/reactivation sets is_public=True). It was
# previously checked NOWHERE, so the admin "suspend" action — and the whole
# "don't show until approved" promise — was a no-op: a suspended venue stayed fully
# visible. `{"$ne": False}` matches docs MISSING the field, so the 422 catalog
# partners (no is_public field) are unaffected; only an explicit is_public=False is
# hidden. Verified live: OLD vs NEW filter delta = 0 today. "suspended" is added to
# the status $nin as a second, independent guard on the same moderation transition.
# "closed"/"unverified" added by CATALOG-HYGIENE v1 (2026-10-07): the research-
# verified STATUS_OVERRIDES in catalog_hygiene.py (Interno, Café del Mar, …)
# write these statuses so dead/dubious venues hide CATALOG-WIDE — never shown,
# never deleted. $nin still matches docs missing the field (editorial venues).
PUBLIC_PARTNER_FILTER = {
    "catalog_status": {"$nin": ["pending_review", "rejected", "sandbox"]},
    "status": {"$nin": ["pending_review", "rejected", "needs_verification",
                        "suspended", "closed", "unverified"]},
    "is_public": {"$ne": False},
}

# CATALOG-HYGIENE v1 — the CONCIERGE gate (docs: drop spec 2026-10-07).
# Everything Luna / instant retrieval reads merges THIS instead of the public
# filter: display_ready=False marks a venue whose name we could not confirm
# (directory/SEO blob, fragment head) or that fails the min_fill floor — the
# lenses' "won't ship until filled" philosophy applied to names. `$ne: False`
# deliberately passes docs MISSING the flag (unstamped vendor docs, pre-
# migration states) so the gate is additive and reversible by deleting one
# line. The wider catalog (explore, partner pages) stays on
# PUBLIC_PARTNER_FILTER — hiding there is a product decision, not hygiene.
CONCIERGE_PARTNER_FILTER = {
    **PUBLIC_PARTNER_FILTER,
    "display_ready": {"$ne": False},
}

# Internal ownership / moderation fields stripped from any PUBLIC partner response.
# Launch audit (2026-08-20): the anon /api/partners payload was leaking partner
# CONTACT PII (email, nit — tax ID) on 7 real listings [Ley 1581 violation] plus
# raw growth analytics (bookings/searches/views_30d, tier_score, claimed_boost)
# on all 893 — competitor-scrapeable ranking signal. Added below. NOTE: rank_score,
# tier and membership_* are deliberately KEPT — the client sorts/badges on them
# (partners.tsx/explore.tsx/data.ts). Full allowlist refactor is a post-launch item.
INTERNAL_PARTNER_FIELDS = (
    "submitted_email", "submitted_by", "claimed_by", "claim_method",
    "claim_verified_at", "approved_by", "rejected_by", "reject_reason",
    # ── contact PII (not read by any public client) ──
    # nit_digits was missed next to nit → 9-digit tax IDs leaked on /api/partners.
    "email", "nit", "nit_digits",
    # ── internal data-ops bookkeeping ──
    "email_backfill_source", "email_backfilled_at", "dup_review", "relocation_note",
    # ── raw growth/ranking analytics (internal signal) ──
    "bookings_30d", "searches_30d", "views_30d", "tier_score", "claimed_boost",
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
# P1 (audit 2026-10-01): the AI moderation verdict/issues/score, the vendor's
# original category and the raw view/click counters were still leaking on every
# public card — internal signal, never read by a consumer screen.
INTERNAL_EVENT_FIELDS = (
    "reviewed_by", "reviewed_at", "moderation_status", "moderation_reason",
    "moderation_verdict", "moderation_issues", "moderation_score", "original_category",
    "moderated_by_admin", "moderated_at", "rejection_reason",
    "views_count", "reserve_clicks",
)
PUBLIC_EVENT_PROJECTION = {"_id": 0, **{f: 0 for f in INTERNAL_EVENT_FIELDS}}

# EVENTS-ELITE §15 T4 / §13 D5: every public partner-event surface (server.py feeds, trips,
# shared trips) requires an EXPLICIT moderation_status == "approved" plus is_published. A pending
# or LLM-failed event is never public (moderation fails closed).
PARTNER_EVENT_PUBLIC = {"is_published": True, "moderation_status": "approved"}

# The curated/seasonal `events` collection (editorial, NOT partner-submitted) can
# carry a moderation_status from the AI auto-approval pipeline. Public reads must
# never render a pending/rejected editorial draft, and must strip the trail. $nin
# also matches docs missing the field, so plain editorial events are unaffected.
PUBLIC_CITY_EVENT_FILTER = {"moderation_status": {"$nin": ["pending", "rejected"]}}


def is_publicly_visible(partner: dict) -> bool:
    """True if a partner doc may be shown publicly (used where a filter can't be
    pushed into the query, e.g. after a geo/aggregation stage).

    MUST match PUBLIC_PARTNER_FILTER field-for-field — this is the in-Python mirror
    of that query. It previously checked only catalog_status, so a partner hidden by
    the legacy `status` field (pending_review/rejected/needs_verification with a null
    catalog_status) could pass this gate yet be excluded from every guest query —
    e.g. pulse.py's POST gate would let them publish a 'live' pulse no guest ever
    sees. Keep the two in lockstep."""
    p = partner or {}
    return (
        p.get("catalog_status") not in ("pending_review", "rejected", "sandbox")
        and p.get("status") not in ("pending_review", "rejected", "needs_verification",
                                    "suspended", "closed", "unverified")
        and p.get("is_public") is not False
    )


def partner_visibility_blocker(partner: dict) -> "str | None":
    """WHY a partner is hidden from the public catalog, or None when it is visible.

    The reason is derived from the SAME three fields PUBLIC_PARTNER_FILTER gates
    on (checked in the filter's own order), so a partner is blocked here if and
    only if is_publicly_visible() is False — keep the three in lockstep. Used to
    tell a vendor the truth about their event's reach (audit 2026-10-01: the
    form said "¡Publicado!" for events on venues no traveller could see).

    Values: venue_pending_review | venue_rejected | venue_sandbox |
            venue_needs_verification | venue_suspended | venue_closed |
            venue_unverified | venue_not_public
    (closed/unverified = CATALOG-HYGIENE v1 research-verified status overrides.)
    """
    p = partner or {}
    cs = p.get("catalog_status")
    if cs in ("pending_review", "rejected", "sandbox"):
        return f"venue_{cs}"
    st = p.get("status")
    if st in ("pending_review", "rejected", "needs_verification", "suspended",
              "closed", "unverified"):
        return f"venue_{st}"
    if p.get("is_public") is False:
        return "venue_not_public"
    return None
