"""Source-level guards for the 2026-10-01 stop-the-bleed drop (never import server.py).

P0-5: every public CDN cache hint must also emit Access-Control-Allow-Origin, or a
      CDN entry filled by an Origin-less caller is rejected by browsers on www.
P0-6: /auth/signup's per-email cap lives in its own bucket (not the verify bucket),
      so a stranger's wrong guesses can't lock an address out of requesting a code.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from events_service_stubs import server_block, server_src  # noqa: E402

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(name: str) -> str:
    with open(os.path.join(BACKEND, name), encoding="utf-8") as f:
        return f.read()


def test_every_public_cache_hint_carries_cors_wildcard():
    offenders = []
    for name in sorted(os.listdir(BACKEND)):
        if not name.endswith(".py") or name.startswith("test"):
            continue
        src = _read(name)
        for m in re.finditer(r'response\.headers\["Cache-Control"\]\s*=\s*\(?\s*f?"public, max-age', src):
            window = src[m.start(): m.start() + 900]
            if 'Access-Control-Allow-Origin"] = "*"' not in window:
                line = src.count("\n", 0, m.start()) + 1
                offenders.append(f"{name}:{line}")
    assert not offenders, f"public cache hint without ACAO wildcard: {offenders}"


def test_signup_uses_its_own_email_bucket():
    signup = server_block('@api_router.post("/auth/signup")')
    assert 'f"signupemail:{email}"' in signup
    assert 'f"verify:{email}"' not in signup, "/auth/signup must not share the verify bucket"
    assert 'f"signupip:{' in signup, "per-IP signup cap must remain"


def test_verify_keeps_ip_and_email_caps():
    verify = server_block('@api_router.post("/auth/verify")')
    assert 'f"verify:{_client_ip(request)}"' in verify
    assert 'f"verify:{email}"' in verify
    assert '"attempts": {"$lt": 5}' in verify, "atomic 5-attempt cap must remain"


def test_review_exemption_is_scoped_to_the_env_gated_address_only():
    signup = server_block('@api_router.post("/auth/signup")')
    verify = server_block('@api_router.post("/auth/verify")')
    for blk in (signup, verify):
        assert 'os.environ.get("REVIEW_DEMO_EMAIL"' in blk
        assert "applereview@" not in blk, "exemption must key off the env var, never a hardcoded address"


def test_signupemail_prefix_fails_closed():
    import ratelimit
    assert "signupemail" in ratelimit.SENSITIVE_PREFIXES
