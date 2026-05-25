"""
E2E backend tests for Hybrid Partner Onboarding (Option C).

Flow tested:
  1) Admin operator login (good + bad password)
  2) Admin lists partners (with/without auth)
  3) Admin creates a partner skeleton (returns activation_url)
  4) Duplicate owner_email → 409
  5) Public GET /business/activation/{token} (good + bad)
  6) Activation validations (short password, missing accept_terms)
  7) Activation success → returns biz_ token, partner_id, needs_approval
  8) Re-using consumed activation token → 404/410
  9) /business/me with new biz token
 10) /business/onboarding-status with new biz token
 11) /business/login with the new credentials (works post-activation)
 12) PATCH approval (approve / suspend / reactivate) + 401 anon
 13) POST regenerate-invite returns new activation_url
 14) Cleanup created test data
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback to frontend/.env value (read by the testing runner usually)
    BASE_URL = "https://cartagena-live.preview.emergentagent.com"

ADMIN_PASSWORD = os.environ.get("ADMIN_OPERATOR_PASSWORD", "amocartagena-admin-2026")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

# A unique email per test session for full isolation
UNIQUE_SUFFIX = uuid.uuid4().hex[:10]
TEST_EMAIL = f"test_onb_{UNIQUE_SUFFIX}@amocartagena.app"
TEST_PASSWORD = "Test12345!"
TEST_NAME = f"TEST_Onboarding_{UNIQUE_SUFFIX}"


# ────────────────────────────────────────────────
# Fixtures
# ────────────────────────────────────────────────

@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def state():
    """Shared dictionary between tests."""
    return {}


@pytest.fixture(scope="module", autouse=True)
def cleanup(state):
    """Delete test partner + business_users + business_sessions at the end."""
    yield
    try:
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        if state.get("partner_id"):
            db.partners.delete_many({"partner_id": state["partner_id"]})
        db.business_users.delete_many({"email": TEST_EMAIL})
        if state.get("biz_token"):
            db.business_sessions.delete_many({"token": state["biz_token"]})
        # Also nuke any other sessions for the business_id we created
        if state.get("business_id"):
            db.business_sessions.delete_many({"business_id": state["business_id"]})
        # Defensive: kill any partner created with our TEST_ prefix (in case test failed mid-way)
        db.partners.delete_many({"name": TEST_NAME})
        client.close()
        print(f"\n[cleanup] Removed test partner/business for {TEST_EMAIL}")
    except Exception as exc:
        print(f"[cleanup] WARNING: {exc}")


# ────────────────────────────────────────────────
# 1) Admin operator login
# ────────────────────────────────────────────────

class TestAdminLogin:
    def test_login_wrong_password(self, api):
        r = api.post(f"{BASE_URL}/api/admin/operator/login", json={"password": "wrong"})
        assert r.status_code == 401, r.text

    def test_login_correct_password(self, api, state):
        r = api.post(f"{BASE_URL}/api/admin/operator/login", json={"password": ADMIN_PASSWORD})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "token" in data and "|" in data["token"]
        assert data.get("expires_in_hours") == 12
        state["admin_token"] = data["token"]


# ────────────────────────────────────────────────
# 2) List partners
# ────────────────────────────────────────────────

class TestListPartners:
    def test_list_partners_anonymous_401(self, api):
        r = api.get(f"{BASE_URL}/api/admin/operator/partners")
        assert r.status_code == 401, r.text

    def test_list_partners_with_admin(self, api, state):
        token = state["admin_token"]
        r = api.get(
            f"{BASE_URL}/api/admin/operator/partners",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "partners" in data and isinstance(data["partners"], list)
        assert "summary" in data
        for k in ("invited", "active_pending_approval", "approved", "suspended"):
            assert k in data["summary"]


# ────────────────────────────────────────────────
# 3 & 4) Create partner skeleton + duplicates
# ────────────────────────────────────────────────

class TestCreatePartner:
    def test_create_partner_skeleton(self, api, state):
        token = state["admin_token"]
        payload = {
            "name": TEST_NAME,
            "category": "gastronomia",
            "owner_email": TEST_EMAIL,
            "tier": "popular",
        }
        r = api.post(
            f"{BASE_URL}/api/admin/operator/partners",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "activation_url" in data
        assert "token=" in data["activation_url"]
        assert "whatsapp_message" in data
        assert data["partner"]["status"] == "invited"
        assert data["partner"]["is_public"] is False
        # Extract activation token from URL
        activation_token = data["activation_url"].split("token=")[-1]
        state["activation_url"] = data["activation_url"]
        state["activation_token"] = activation_token
        state["partner_id"] = data["partner"]["partner_id"]

    def test_duplicate_owner_email_returns_409(self, api, state):
        token = state["admin_token"]
        payload = {
            "name": TEST_NAME + "_dup",
            "category": "gastronomia",
            "owner_email": TEST_EMAIL,
        }
        r = api.post(
            f"{BASE_URL}/api/admin/operator/partners",
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert r.status_code == 409, r.text


# ────────────────────────────────────────────────
# 5) Public GET activation
# ────────────────────────────────────────────────

class TestActivationFetch:
    def test_get_activation_bad_token(self, api):
        r = api.get(f"{BASE_URL}/api/business/activation/not-a-real-token-zzz")
        assert r.status_code == 404, r.text

    def test_get_activation_valid_token(self, api, state):
        tok = state["activation_token"]
        r = api.get(f"{BASE_URL}/api/business/activation/{tok}")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["partner_id"] == state["partner_id"]
        assert data["name"] == TEST_NAME
        assert data["owner_email"] == TEST_EMAIL


# ────────────────────────────────────────────────
# 6 & 7) Activate validations + success
# ────────────────────────────────────────────────

class TestActivate:
    def test_activate_short_password(self, api, state):
        r = api.post(
            f"{BASE_URL}/api/business/activate",
            json={"token": state["activation_token"], "password": "short", "accept_terms": True},
        )
        assert r.status_code == 400, r.text

    def test_activate_missing_accept_terms(self, api, state):
        r = api.post(
            f"{BASE_URL}/api/business/activate",
            json={"token": state["activation_token"], "password": TEST_PASSWORD},
        )
        assert r.status_code == 400, r.text

    def test_activate_success(self, api, state):
        r = api.post(
            f"{BASE_URL}/api/business/activate",
            json={
                "token": state["activation_token"],
                "password": TEST_PASSWORD,
                "accept_terms": True,
            },
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["partner_id"] == state["partner_id"]
        assert data["needs_approval"] is True
        assert data["token"].startswith("biz_")
        state["biz_token"] = data["token"]

    def test_activate_token_single_use(self, api, state):
        """Re-using a consumed token should fail (token is $unset after activation)."""
        r = api.post(
            f"{BASE_URL}/api/business/activate",
            json={
                "token": state["activation_token"],
                "password": TEST_PASSWORD,
                "accept_terms": True,
            },
        )
        assert r.status_code in (404, 410), r.text


# ────────────────────────────────────────────────
# 9 & 10) Business endpoints with new biz token
# ────────────────────────────────────────────────

class TestBusinessSession:
    def test_business_me_with_new_token(self, api, state):
        r = api.get(
            f"{BASE_URL}/api/business/me",
            headers={"Authorization": f"Bearer {state['biz_token']}"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # /business/me returns {business, partner} shape — be lenient
        biz = data.get("business") or data
        assert biz.get("email", "").lower() == TEST_EMAIL
        # Capture business_id for cleanup
        if biz.get("business_id"):
            state["business_id"] = biz["business_id"]

    def test_onboarding_status(self, api, state):
        r = api.get(
            f"{BASE_URL}/api/business/onboarding-status",
            headers={"Authorization": f"Bearer {state['biz_token']}"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["is_public"] is False
        assert data["status"] == "active"
        assert isinstance(data.get("missing"), list)
        # percent should be ~15 (name=10 + category=5) right after activation
        assert 10 <= data["percent"] <= 25, f"unexpected percent: {data['percent']}"


# ────────────────────────────────────────────────
# 11) Business password login post-activation
# ────────────────────────────────────────────────

class TestBusinessLogin:
    def test_login_with_new_credentials(self, api, state):
        r = api.post(
            f"{BASE_URL}/api/business/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("token", "").startswith("biz_")
        assert data.get("business", {}).get("email", "").lower() == TEST_EMAIL


# ────────────────────────────────────────────────
# 12) Approval workflow
# ────────────────────────────────────────────────

class TestApprovalWorkflow:
    def test_patch_approval_unauthenticated(self, api, state):
        r = api.patch(
            f"{BASE_URL}/api/admin/operator/partners/{state['partner_id']}/approval",
            json={"action": "approve"},
        )
        assert r.status_code == 401, r.text

    def test_approve(self, api, state):
        r = api.patch(
            f"{BASE_URL}/api/admin/operator/partners/{state['partner_id']}/approval",
            json={"action": "approve"},
            headers={"Authorization": f"Bearer {state['admin_token']}"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["status"] == "active"
        assert data["is_public"] is True

    def test_suspend(self, api, state):
        r = api.patch(
            f"{BASE_URL}/api/admin/operator/partners/{state['partner_id']}/approval",
            json={"action": "suspend"},
            headers={"Authorization": f"Bearer {state['admin_token']}"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "suspended"

    def test_reactivate(self, api, state):
        r = api.patch(
            f"{BASE_URL}/api/admin/operator/partners/{state['partner_id']}/approval",
            json={"action": "reactivate"},
            headers={"Authorization": f"Bearer {state['admin_token']}"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "active"
        assert body["is_public"] is True


# ────────────────────────────────────────────────
# 13) Re-invite (regenerate activation token)
# ────────────────────────────────────────────────

class TestReinvite:
    def test_regenerate_invite(self, api, state):
        r = api.post(
            f"{BASE_URL}/api/admin/operator/partners/{state['partner_id']}/invite",
            headers={"Authorization": f"Bearer {state['admin_token']}"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "activation_url" in data and "token=" in data["activation_url"]
        assert "whatsapp_message" in data
        # Make sure it's a brand new token (different from the first one)
        new_tok = data["activation_url"].split("token=")[-1]
        assert new_tok != state.get("activation_token")
