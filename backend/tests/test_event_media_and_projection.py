"""P1-5 (audit 2026-10-01): vendor flyers vanished from consumer cards; internal
moderation fields leaked on every public partner event.

_normalize_event_media only accepted /images/… candidates, so a flyer uploaded
through /business/upload-image (stored on our Vercel Blob store) was discarded
and the card fell back to the category art. PartnerEventCard.tsx made the same
call client-side. INTERNAL_EVENT_FIELDS lacked moderation_verdict / issues /
score, original_category and the raw views/clicks counters.
"""
import os
import sys
import types

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from events_service_stubs import server_block  # noqa: E402
import blob_storage  # noqa: E402
from partner_visibility import INTERNAL_EVENT_FIELDS, PUBLIC_EVENT_PROJECTION  # noqa: E402

BLOB = "https://abc123xyz.public.blob.vercel-storage.com/partners/ptr_x/flyer-1a2b3c4d.jpg"
THIRD_PARTY = "https://images.unsplash.com/photo-1.jpg"
FRONTEND = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "frontend")


def _normalize(known=()):
    ns = {
        "_blob": blob_storage,
        "_public_image_exists": lambda p: p in set(known),
        "_is_external_url": lambda u: isinstance(u, str) and u.lstrip().lower().startswith(("http://", "https://", "//")),
    }
    exec(server_block("def _normalize_event_media("), ns)
    return ns["_normalize_event_media"]


def test_vendor_flyer_on_our_blob_store_is_self_hosted() -> None:
    f = _normalize()
    out = f([{"event_id": "pe_1", "flyer_url": BLOB, "partner_image": "/images/partners/ptr_x.jpg"}])
    assert out[0]["image_url"] == BLOB


def test_images_path_still_wins_over_a_blob_flyer_when_it_is_the_record_image() -> None:
    f = _normalize()
    out = f([{"event_id": "pe_1", "image_url": "/images/events/pe_1.jpg", "flyer_url": BLOB}])
    assert out[0]["image_url"] == "/images/events/pe_1.jpg"


def test_third_party_flyer_is_still_discarded() -> None:
    f = _normalize(known={"/images/events/pe_2.jpg"})
    out = f([{"event_id": "pe_2", "flyer_url": THIRD_PARTY, "partner_image": THIRD_PARTY}])
    assert out[0]["image_url"] == "/images/events/pe_2.jpg"   # synthesized, not the hotlink
    out2 = f([{"event_id": "pe_3", "flyer_url": THIRD_PARTY, "partner_image": THIRD_PARTY}])
    assert out2[0]["image_url"] == ""


def test_blob_lookalike_is_not_trusted_by_the_normaliser() -> None:
    f = _normalize()
    out = f([{"event_id": "pe_4", "flyer_url": "https://evil.com/?x=blob.vercel-storage.com"}])
    assert out[0]["image_url"] == ""


def test_internal_event_fields_cover_the_leaked_fields() -> None:
    for fld in ("moderation_verdict", "moderation_issues", "moderation_score", "original_category",
                "views_count", "reserve_clicks", "moderated_by_admin", "moderated_at", "rejection_reason",
                "reviewed_by", "reviewed_at", "moderation_status", "moderation_reason"):
        assert fld in INTERNAL_EVENT_FIELDS, fld
        assert PUBLIC_EVENT_PROJECTION[fld] == 0, fld
    assert PUBLIC_EVENT_PROJECTION["_id"] == 0
    # the fields a consumer card DOES read stay out of the denylist
    for keep in ("title", "date", "start_time", "flyer_url", "price", "is_free", "category", "partner_id", "is_published"):
        assert keep not in INTERNAL_EVENT_FIELDS, keep


def test_consumer_card_accepts_our_blob_host_only() -> None:
    with open(os.path.join(FRONTEND, "src", "components", "PartnerEventCard.tsx"), encoding="utf-8") as f:
        src = f.read()
    assert r"^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/" in src, "host-exact, https-only regex"
    assert "isOurs(ev.image_url)" in src and "isOurs(ev.flyer_url)" in src
    assert "!isExternal(u) || isOwnBlob(u)" in src
