"""P1-4 (audit 2026-10-01): the Blob-URL trust check was a substring match.

partner_claims.validate_image_value accepted any https URL CONTAINING
"blob.vercel-storage.com" (so `https://evil.com/?x=blob.vercel-storage.com`
rendered as a trusted flyer), and blob_storage.is_blob_url matched http:// and
query-string lookalikes too. Both now require scheme https AND a hostname that
ends with ".public.blob.vercel-storage.com" (urlparse, host-exact).
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import blob_storage  # noqa: E402
import partner_claims as pc  # noqa: E402

GOOD = "https://abc123xyz.public.blob.vercel-storage.com/partners/ptr_x/flyer-1a2b3c4d.jpg"

BAD = [
    "https://evil.com/?x=blob.vercel-storage.com",
    "https://evil.com/blob.vercel-storage.com/x.jpg",
    "https://evil.com/abc.public.blob.vercel-storage.com/x.jpg",
    "https://abc.public.blob.vercel-storage.com.evil.com/x.jpg",      # suffix spoof
    "https://evil.public.blob.vercel-storage.com@evil.com/x.jpg",     # userinfo trick → host is evil.com
    "http://abc.public.blob.vercel-storage.com/x.jpg",                # not https
    "https://public.blob.vercel-storage.com/x.jpg",                   # no store prefix
    "https://blob.vercel-storage.com/x.jpg",                          # the API host, not a public URL
    "https://images.unsplash.com/photo-1.jpg",
    "blob.vercel-storage.com",
]


@pytest.mark.parametrize("url", BAD)
def test_validate_image_value_rejects_lookalikes(url: str) -> None:
    assert pc.validate_image_value(url) is False


@pytest.mark.parametrize("url", BAD)
def test_is_blob_url_rejects_lookalikes(url: str) -> None:
    assert blob_storage.is_blob_url(url) is False


def test_our_own_store_is_accepted_by_both() -> None:
    assert pc.validate_image_value(GOOD) is True
    assert blob_storage.is_blob_url(GOOD) is True
    assert blob_storage.is_blob_url("  " + GOOD + "\n") is True   # tolerates surrounding whitespace


def test_validate_image_value_keeps_its_other_rules() -> None:
    assert pc.validate_image_value("/images/partners/ptr_001.jpg") is True
    assert pc.validate_image_value("data:image/jpeg;base64,AAAA") is True
    assert pc.validate_image_value("") is False
    assert pc.validate_image_value(None) is False
    assert pc.validate_image_value({"url": GOOD}) is False
    assert pc.validate_image_value("data:image/jpeg;base64," + "A" * 700_001) is False


def test_is_blob_url_non_string_and_garbage() -> None:
    assert blob_storage.is_blob_url(None) is False
    assert blob_storage.is_blob_url(12) is False
    assert blob_storage.is_blob_url("https://[::1") is False     # urlparse ValueError path
