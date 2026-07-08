"""Amo Together — Social layer backend regression tests.

Covers 11 endpoints under /api (mounted from /app/backend/social.py) plus
match-score correctness, self-exclusion, blocking, visibility filtering,
report auto-suspend and auth requirements.

Uses preseeded users (session tokens) documented in /app/memory/test_credentials.md.
Test event: pe_001 (Brunch & Beats — Sunday Edition).
"""
from __future__ import annotations

import os
import time
import uuid
import pytest
import requests
from pathlib import Path

# --- Resolve BASE_URL from frontend .env (public preview URL) --------------
BASE_URL = "https://cartagena-live.preview.emergentagent.com"
fe = Path("/app/frontend/.env")
if fe.exists():
    for line in fe.read_text().splitlines():
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
            break

EVENT_ID = "pe_001"

TOKENS = {
    "marta": "seed_marta_token",
    "carlos": "seed_carlos_token",
    "sarah": "seed_sarah_token",
    "lea": "seed_lea_token",
    "marco": "seed_marco_token",
    "ana": "seed_ana_token",
}
UIDS = {k: f"seed_{k}" for k in TOKENS}


def _h(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# =============================================================================
# 1. Public config endpoint
# =============================================================================
class TestSocialConfig:
    def test_config_public_no_auth(self):
        r = requests.get(f"{BASE_URL}/api/users/social/config", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "supported_cities" in d and isinstance(d["supported_cities"], list)
        slugs = [c["slug"] for c in d["supported_cities"]]
        assert "cartagena" in slugs
        assert "vibes" in d and "foodie" in d["vibes"] and "nightlife" in d["vibes"]
        assert d.get("max_vibes_per_user") == 5


# =============================================================================
# 2. Attendance preview (PUBLIC)
# =============================================================================
class TestAttendancePreview:
    def test_preview_public_no_auth(self):
        r = requests.get(f"{BASE_URL}/api/events/{EVENT_ID}/attendance/preview", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["event_id"] == EVENT_ID
        assert d["total"] == 6, f"expected total=6, got {d['total']}"
        assert d["solo_open_count"] == 4, f"expected solo_open_count=4, got {d['solo_open_count']}"
        assert isinstance(d["avatars"], list)
        assert len(d["avatars"]) <= 6

    def test_preview_solo_open_first(self):
        r = requests.get(f"{BASE_URL}/api/events/{EVENT_ID}/attendance/preview", timeout=15)
        d = r.json()
        # Solo-open users should be listed first
        solo_uids = {"seed_marta", "seed_carlos", "seed_sarah", "seed_lea"}
        public_uids = {"seed_marco", "seed_ana"}
        avatar_uids = [a["user_id"] for a in d["avatars"]]
        # first 4 must all be solo_open
        first4 = set(avatar_uids[:4])
        assert first4 == solo_uids, f"first 4 avatars should be solo_open users, got {first4}"
        remaining = set(avatar_uids[4:])
        assert remaining.issubset(public_uids)


# =============================================================================
# 3. Auth requirements
# =============================================================================
class TestAuth:
    def test_attendees_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/events/{EVENT_ID}/attendees", timeout=15)
        assert r.status_code == 401

    def test_me_social_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/users/me/social", timeout=15)
        assert r.status_code == 401

    def test_invalid_token_rejected(self):
        r = requests.get(f"{BASE_URL}/api/users/me/social",
                         headers=_h("nope-not-a-token"), timeout=15)
        assert r.status_code == 401


# =============================================================================
# 4. My attendance / me/social
# =============================================================================
class TestMe:
    def test_me_social_marta(self):
        r = requests.get(f"{BASE_URL}/api/users/me/social",
                         headers=_h(TOKENS["marta"]), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["user_id"] == UIDS["marta"]
        assert d["social"].get("social_enabled") is True
        assert set(d["social"].get("vibes") or []) >= {"electro", "nightlife", "foodie", "art"}
        assert d.get("badge") is not None

    def test_my_attendance_marta_on_pe001(self):
        r = requests.get(f"{BASE_URL}/api/events/{EVENT_ID}/attendance/me",
                         headers=_h(TOKENS["marta"]), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["attending"] is True
        assert d["visibility"] == "solo_open"


# =============================================================================
# 5. Attendees endpoint — the CORE test with match score & sort
# =============================================================================
class TestAttendeesFromMarta:
    @pytest.fixture(scope="class")
    def payload(self):
        r = requests.get(f"{BASE_URL}/api/events/{EVENT_ID}/attendees",
                         headers=_h(TOKENS["marta"]), timeout=15)
        assert r.status_code == 200, r.text
        return r.json()

    def test_counts(self, payload):
        assert payload["event_id"] == EVENT_ID
        assert payload["total"] == 6
        assert payload["solo_open_count"] == 4
        assert payload["public_count"] == 2
        assert payload["private_count"] == 0

    def test_self_excluded_from_solo(self, payload):
        uids = [c["user_id"] for c in payload["solo_open"]]
        assert UIDS["marta"] not in uids
        assert len(payload["solo_open"]) == 3

    def test_self_excluded_from_others(self, payload):
        uids = [c["user_id"] for c in payload["others"]]
        assert UIDS["marta"] not in uids
        assert len(payload["others"]) == 2
        assert set(uids) == {UIDS["marco"], UIDS["ana"]}

    def test_me_object(self, payload):
        me = payload["me"]
        assert me["attending"] is True
        assert me["visibility"] == "solo_open"

    def test_solo_open_sorted_by_score_desc(self, payload):
        cards = payload["solo_open"]
        scores = [c["match"]["score"] for c in cards]
        assert scores == sorted(scores, reverse=True), f"not desc sorted: {scores}"

    def test_lea_first_score_8(self, payload):
        cards = payload["solo_open"]
        assert cards[0]["user_id"] == UIDS["lea"]
        m = cards[0]["match"]
        assert m["score"] == 8, m
        assert set(m["common_vibes"]) == {"electro", "nightlife", "foodie"}
        assert set(m["common_languages"]) == {"en", "fr"}

    def test_carlos_second_score_7(self, payload):
        cards = payload["solo_open"]
        assert cards[1]["user_id"] == UIDS["carlos"]
        m = cards[1]["match"]
        assert m["score"] == 7, m
        assert set(m["common_vibes"]) == {"electro", "nightlife", "art"}
        assert set(m["common_languages"]) == {"en"}

    def test_sarah_third_score_5(self, payload):
        cards = payload["solo_open"]
        assert cards[2]["user_id"] == UIDS["sarah"]
        m = cards[2]["match"]
        assert m["score"] == 5, m
        assert set(m["common_vibes"]) == {"electro", "nightlife"}
        assert set(m["common_languages"]) == {"en"}

    def test_solo_cards_have_full_profile(self, payload):
        for c in payload["solo_open"]:
            assert c.get("display_name")
            assert "vibes" in c and isinstance(c["vibes"], list)
            assert "languages" in c
            assert "instagram" in c
            assert "bio" in c
            assert "badge" in c

    def test_others_grid_is_minimal(self, payload):
        for o in payload["others"]:
            # Must have minimal fields
            assert o.get("user_id")
            assert "display_name" in o
            assert "photo_url" in o
            assert "user_type" in o
            # Must NOT leak profile fields
            assert "instagram" not in o
            assert "bio" not in o
            assert "vibes" not in o
            assert "match" not in o


# =============================================================================
# 6. PATCH /users/me/social & attend + unattend flow with a temp user
#    We use seed_marco (currently public) as a temp sandbox — restore at end.
# =============================================================================
class TestAttendFlow:
    """Uses a temp user (marco) so we can join/leave without perturbing marta view."""

    @pytest.fixture(autouse=True)
    def _restore_marco(self):
        # snapshot marco's attendance before
        r = requests.get(f"{BASE_URL}/api/events/{EVENT_ID}/attendance/me",
                         headers=_h(TOKENS["marco"]), timeout=15)
        before = r.json() if r.status_code == 200 else {"attending": False}
        yield
        # restore his original attendance (public)
        if before.get("attending"):
            requests.post(f"{BASE_URL}/api/events/{EVENT_ID}/attend",
                          headers=_h(TOKENS["marco"]),
                          json={"visibility": before.get("visibility") or "public"},
                          timeout=15)
        else:
            requests.delete(f"{BASE_URL}/api/events/{EVENT_ID}/attend",
                            headers=_h(TOKENS["marco"]), timeout=15)

    def test_attend_event_not_found(self):
        r = requests.post(f"{BASE_URL}/api/events/does_not_exist_xyz/attend",
                          headers=_h(TOKENS["marco"]),
                          json={"visibility": "public"}, timeout=15)
        assert r.status_code == 404

    def test_unattend_then_attend_private(self):
        # First remove
        r = requests.delete(f"{BASE_URL}/api/events/{EVENT_ID}/attend",
                            headers=_h(TOKENS["marco"]), timeout=15)
        assert r.status_code == 200
        # Now attend as private
        r = requests.post(f"{BASE_URL}/api/events/{EVENT_ID}/attend",
                          headers=_h(TOKENS["marco"]),
                          json={"visibility": "private"}, timeout=15)
        assert r.status_code == 200, r.text
        # Verify /me shows private
        r = requests.get(f"{BASE_URL}/api/events/{EVENT_ID}/attendance/me",
                         headers=_h(TOKENS["marco"]), timeout=15)
        d = r.json()
        assert d["attending"] is True
        assert d["visibility"] == "private"

        # Verify Marta's view now shows private_count=1 and marco not in either list
        r = requests.get(f"{BASE_URL}/api/events/{EVENT_ID}/attendees",
                         headers=_h(TOKENS["marta"]), timeout=15)
        d = r.json()
        assert d["private_count"] >= 1
        all_ids = {c["user_id"] for c in d["solo_open"]} | {o["user_id"] for o in d["others"]}
        assert UIDS["marco"] not in all_ids  # private users are hidden from lists

    def test_invalid_visibility_rejected(self):
        r = requests.post(f"{BASE_URL}/api/events/{EVENT_ID}/attend",
                          headers=_h(TOKENS["marco"]),
                          json={"visibility": "hacker"}, timeout=15)
        assert r.status_code in (400, 422)


# =============================================================================
# 7. Visibility gating — user without social_enabled cannot join as public
# =============================================================================
class TestVisibilityGating:
    """Create a fresh user with no social_enabled and try to attend."""

    @pytest.fixture(scope="class")
    def temp_user(self):
        """Insert a fresh user directly via a helper endpoint — we don't have one,
        so we mutate marco temporarily: disable social, run the check, re-enable.
        """
        # Snapshot marco current social state + attendance
        r = requests.get(f"{BASE_URL}/api/users/me/social",
                         headers=_h(TOKENS["marco"]), timeout=15)
        assert r.status_code == 200
        snapshot = r.json().get("social") or {}
        r = requests.get(f"{BASE_URL}/api/events/{EVENT_ID}/attendance/me",
                         headers=_h(TOKENS["marco"]), timeout=15)
        att_before = r.json() if r.status_code == 200 else {"attending": False}
        # Turn OFF social
        r = requests.patch(f"{BASE_URL}/api/users/me/social",
                           headers=_h(TOKENS["marco"]),
                           json={"social_enabled": False}, timeout=15)
        assert r.status_code == 200
        yield
        # Restore social_enabled state
        requests.patch(f"{BASE_URL}/api/users/me/social",
                       headers=_h(TOKENS["marco"]),
                       json={"social_enabled": bool(snapshot.get("social_enabled"))},
                       timeout=15)
        # Restore attendance visibility (default to public for seed integrity)
        vis = (att_before.get("visibility") if att_before.get("attending") else None) or "public"
        requests.post(f"{BASE_URL}/api/events/{EVENT_ID}/attend",
                      headers=_h(TOKENS["marco"]),
                      json={"visibility": vis}, timeout=15)

    def test_public_rejected_without_social_enabled(self, temp_user):
        r = requests.post(f"{BASE_URL}/api/events/{EVENT_ID}/attend",
                          headers=_h(TOKENS["marco"]),
                          json={"visibility": "public"}, timeout=15)
        assert r.status_code == 400

    def test_solo_open_rejected_without_social_enabled(self, temp_user):
        r = requests.post(f"{BASE_URL}/api/events/{EVENT_ID}/attend",
                          headers=_h(TOKENS["marco"]),
                          json={"visibility": "solo_open"}, timeout=15)
        assert r.status_code == 400

    def test_private_allowed_without_social_enabled(self, temp_user):
        r = requests.post(f"{BASE_URL}/api/events/{EVENT_ID}/attend",
                          headers=_h(TOKENS["marco"]),
                          json={"visibility": "private"}, timeout=15)
        assert r.status_code == 200, r.text


# =============================================================================
# 8. PATCH /users/me/social validations
# =============================================================================
class TestPatchSocial:
    def test_update_bio_and_get_reflects(self):
        new_bio = f"TEST_bio_{uuid.uuid4().hex[:6]}"
        r = requests.patch(f"{BASE_URL}/api/users/me/social",
                           headers=_h(TOKENS["marta"]),
                           json={"bio": new_bio}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["social"]["bio"] == new_bio
        # Read back
        r = requests.get(f"{BASE_URL}/api/users/me/social",
                         headers=_h(TOKENS["marta"]), timeout=15)
        assert r.json()["social"]["bio"] == new_bio

    def test_unsupported_city_rejected(self):
        r = requests.patch(f"{BASE_URL}/api/users/me/social",
                           headers=_h(TOKENS["marta"]),
                           json={"current_city": "paris"}, timeout=15)
        assert r.status_code == 400

    def test_empty_patch_rejected(self):
        r = requests.patch(f"{BASE_URL}/api/users/me/social",
                           headers=_h(TOKENS["marta"]),
                           json={}, timeout=15)
        assert r.status_code == 400

    def test_vibes_capped_to_5(self):
        """Use Sarah for this test — the PATCH endpoint filters vibes to the
        server-side VIBES whitelist, so we send only in-catalog values and
        restore Sarah's original vibes via direct DB write (her seeded
        'electro' vibe is NOT in the whitelist and would be silently dropped
        by any PATCH restore attempt)."""
        many = ["foodie", "salsa", "beach", "nightlife", "culture", "wellness", "photo"]
        r = requests.patch(f"{BASE_URL}/api/users/me/social",
                           headers=_h(TOKENS["sarah"]),
                           json={"vibes": many}, timeout=15)
        assert r.status_code == 200
        assert len(r.json()["social"]["vibes"]) == 5
        # Restore Sarah's original vibes directly in mongo (bypass whitelist)
        try:
            import pymongo
            client = pymongo.MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            dbn = os.environ.get("DB_NAME", "test_database")
            client[dbn].users.update_one(
                {"user_id": UIDS["sarah"]},
                {"$set": {"social.vibes": ["electro", "nightlife", "photo"]}},
            )
        except Exception as e:
            print(f"warn: could not restore sarah vibes: {e}")


# =============================================================================
# 9. GET /users/social/{uid}
# =============================================================================
class TestPublicProfile:
    def test_get_public_profile_of_lea(self):
        r = requests.get(f"{BASE_URL}/api/users/social/{UIDS['lea']}",
                         headers=_h(TOKENS["marta"]), timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["user_id"] == UIDS["lea"]
        # first name + initial
        assert d["display_name"].startswith("L")
        assert "instagram" in d
        assert "vibes" in d

    def test_get_unknown_user_404(self):
        r = requests.get(f"{BASE_URL}/api/users/social/nope_unknown_uid",
                         headers=_h(TOKENS["marta"]), timeout=15)
        assert r.status_code == 404

    def test_get_public_profile_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/users/social/{UIDS['lea']}", timeout=15)
        assert r.status_code == 401


# =============================================================================
# 10. Block flow — blocked users disappear from attendee lists (bidirectional)
# =============================================================================
class TestBlocking:
    @pytest.fixture(autouse=True)
    def _cleanup_blocks(self):
        yield
        # Cleanup blocks in DB (best-effort — remove any block between marta<->lea)
        try:
            from motor.motor_asyncio import AsyncIOMotorClient  # noqa
        except Exception:
            pass
        # We can't easily reach mongo from here; use the app: no unblock endpoint exists.
        # Fall back to a direct pymongo call.
        try:
            import pymongo
            client = pymongo.MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            dbn = os.environ.get("DB_NAME", "test_database")
            client[dbn].user_blocks.delete_many({
                "$or": [
                    {"blocker_id": UIDS["marta"], "blocked_id": UIDS["lea"]},
                    {"blocker_id": UIDS["lea"], "blocked_id": UIDS["marta"]},
                ]
            })
        except Exception as e:
            print(f"warn: could not cleanup blocks: {e}")

    def test_block_removes_target_from_marta_view(self):
        # Marta blocks Léa
        r = requests.post(f"{BASE_URL}/api/users/social/block",
                          headers=_h(TOKENS["marta"]),
                          json={"target_user_id": UIDS["lea"]}, timeout=15)
        assert r.status_code == 200, r.text
        # Marta's attendee list must NOT contain Léa
        r = requests.get(f"{BASE_URL}/api/events/{EVENT_ID}/attendees",
                         headers=_h(TOKENS["marta"]), timeout=15)
        d = r.json()
        ids = {c["user_id"] for c in d["solo_open"]} | {o["user_id"] for o in d["others"]}
        assert UIDS["lea"] not in ids
        # Now only 2 solo_open cards (Carlos, Sarah)
        assert len(d["solo_open"]) == 2

    def test_block_is_bidirectional(self):
        # Marta blocks Léa
        requests.post(f"{BASE_URL}/api/users/social/block",
                      headers=_h(TOKENS["marta"]),
                      json={"target_user_id": UIDS["lea"]}, timeout=15)
        # Léa's attendee view should also NOT contain Marta
        r = requests.get(f"{BASE_URL}/api/events/{EVENT_ID}/attendees",
                         headers=_h(TOKENS["lea"]), timeout=15)
        d = r.json()
        ids = {c["user_id"] for c in d["solo_open"]} | {o["user_id"] for o in d["others"]}
        assert UIDS["marta"] not in ids

    def test_cannot_block_self(self):
        r = requests.post(f"{BASE_URL}/api/users/social/block",
                          headers=_h(TOKENS["marta"]),
                          json={"target_user_id": UIDS["marta"]}, timeout=15)
        assert r.status_code == 400

    def test_blocked_profile_returns_403(self):
        requests.post(f"{BASE_URL}/api/users/social/block",
                      headers=_h(TOKENS["marta"]),
                      json={"target_user_id": UIDS["lea"]}, timeout=15)
        r = requests.get(f"{BASE_URL}/api/users/social/{UIDS['lea']}",
                         headers=_h(TOKENS["marta"]), timeout=15)
        assert r.status_code == 403


# =============================================================================
# 11. Report + auto-suspend after 3 reports
# =============================================================================
class TestReportAutoSuspend:
    """Report seed_ana 3 times from 3 different reporters → auto-suspend."""

    @pytest.fixture(autouse=True)
    def _cleanup(self):
        yield
        # Best-effort cleanup: remove reports + unsuspend
        try:
            import pymongo
            client = pymongo.MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
            dbn = os.environ.get("DB_NAME", "test_database")
            client[dbn].user_reports.delete_many({"target_user_id": UIDS["ana"]})
            client[dbn].users.update_one(
                {"user_id": UIDS["ana"]},
                {"$unset": {"social.suspended_until": "", "social.auto_suspended": ""}},
            )
        except Exception as e:
            print(f"warn: could not cleanup reports: {e}")

    def test_cannot_report_self(self):
        r = requests.post(f"{BASE_URL}/api/users/social/report",
                          headers=_h(TOKENS["marta"]),
                          json={"target_user_id": UIDS["marta"], "reason": "spam"}, timeout=15)
        assert r.status_code == 400

    def test_invalid_reason_rejected(self):
        r = requests.post(f"{BASE_URL}/api/users/social/report",
                          headers=_h(TOKENS["marta"]),
                          json={"target_user_id": UIDS["ana"], "reason": "banana"}, timeout=15)
        assert r.status_code == 422

    def test_three_reports_auto_suspend(self):
        for reporter in ("marta", "carlos", "sarah"):
            r = requests.post(f"{BASE_URL}/api/users/social/report",
                              headers=_h(TOKENS[reporter]),
                              json={"target_user_id": UIDS["ana"], "reason": "spam"}, timeout=15)
            assert r.status_code == 200, r.text
            last = r.json()
        # Last (3rd) response must indicate auto_suspended
        assert last.get("action") == "auto_suspended", last
        assert last.get("reports_count") >= 3

        # Verify Ana no longer appears in Marta's attendee list (suspended)
        r = requests.get(f"{BASE_URL}/api/events/{EVENT_ID}/attendees",
                         headers=_h(TOKENS["marta"]), timeout=15)
        d = r.json()
        others_ids = {o["user_id"] for o in d["others"]}
        assert UIDS["ana"] not in others_ids, "suspended user should be hidden from attendee grid"
