#!/usr/bin/env python3
"""
Smoke test for Cartagena restaurants & bars bulk-seed v2 (Feb 2026).
Tests the /api/partners endpoints and Alcaldía admin regression endpoints.
"""
import os
import sys
import re
import requests

BASE = "https://amo-preview-deploy.preview.emergentagent.com"
API = f"{BASE}/api"

# Track results
passes = []
fails = []

def assert_true(name, cond, detail=""):
    if cond:
        passes.append(name)
        print(f"  ✅ {name}")
    else:
        fails.append((name, detail))
        print(f"  ❌ {name}  -- {detail}")


def section(title):
    print(f"\n=== {title} ===")


def normalize(s):
    if not s:
        return ""
    s = s.lower().strip()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


# ─────────────────────────────────────────────────────────────────────
# 1) GET /api/partners
# ─────────────────────────────────────────────────────────────────────
section("1) GET /api/partners — total count & category distribution")
r = requests.get(f"{API}/partners", timeout=30)
assert_true("GET /api/partners returns 200", r.status_code == 200, f"status={r.status_code}")
partners = r.json() if r.status_code == 200 else []
total = len(partners)
print(f"  total partners = {total}")
assert_true(f"total partners >= 250 (got {total})", total >= 250)

cat_counts = {}
for p in partners:
    c = p.get("category", "unknown")
    cat_counts[c] = cat_counts.get(c, 0) + 1
print(f"  category distribution: {cat_counts}")

rest_count = cat_counts.get("restaurant", 0)
club_count = cat_counts.get("club", 0)
assert_true(f"restaurant count >= 200 (got {rest_count})", rest_count >= 200)
assert_true(f"club count >= 35 (got {club_count})", club_count >= 35)


# ─────────────────────────────────────────────────────────────────────
# 2) GET /api/partners?category=restaurant&subcategory=peruvian
# ─────────────────────────────────────────────────────────────────────
section("2) Peruvian subcategory")
r = requests.get(f"{API}/partners", params={"category": "restaurant", "subcategory": "peruvian"}, timeout=30)
assert_true("GET peruvian returns 200", r.status_code == 200, f"status={r.status_code}")
peruvian = r.json() if r.status_code == 200 else []
print(f"  peruvian count = {len(peruvian)}")
assert_true(f"peruvian count >= 10 (got {len(peruvian)})", len(peruvian) >= 10)

expected_peruvian = [
    "Cuzco", "Humo", "Sierpe", "Montesacro", "Tac Restaurante",
    "Koyo Rio Steakhouse", "Cuiko", "Restaurante Olano", "Uma",
    "Casa Pura", "Baruco", "Abare", "La Unica Perú"
]
peru_names_norm = {normalize(p.get("name", "")) for p in peruvian}
peru_names_raw = [p.get("name", "") for p in peruvian]
print(f"  peruvian names: {peru_names_raw}")
matches = [e for e in expected_peruvian if normalize(e) in peru_names_norm]
print(f"  matches: {matches}")
assert_true(
    f"at least 4 of expected peruvian names present (got {len(matches)}: {matches})",
    len(matches) >= 4
)

# Negative check
forbidden = ["Niku", "Nami"]
unwanted_found = [n for n in forbidden if normalize(n) in peru_names_norm]
assert_true(
    f"peruvian list must NOT contain Niku/Nami (found: {unwanted_found})",
    len(unwanted_found) == 0
)


# ─────────────────────────────────────────────────────────────────────
# 3) GET /api/partners?category=restaurant&subcategory=mediterranean
# ─────────────────────────────────────────────────────────────────────
section("3) Mediterranean subcategory")
r = requests.get(f"{API}/partners", params={"category": "restaurant", "subcategory": "mediterranean"}, timeout=30)
assert_true("GET mediterranean returns 200", r.status_code == 200, f"status={r.status_code}")
med = r.json() if r.status_code == 200 else []
print(f"  mediterranean count = {len(med)}")
assert_true(f"mediterranean count >= 7 (got {len(med)})", len(med) >= 7)

med_names_norm = {normalize(p.get("name", "")) for p in med}
print(f"  mediterranean names: {[p.get('name','') for p in med]}")
expected_med_any = ["Habbab", "Harissa", "Tahini Kebab", "M Cocina Arabe"]
med_matches = [e for e in expected_med_any if normalize(e) in med_names_norm]
assert_true(
    f"at least 1 expected mediterranean name present (got {med_matches})",
    len(med_matches) >= 1
)


# ─────────────────────────────────────────────────────────────────────
# 4) GET /api/partners?category=club
# ─────────────────────────────────────────────────────────────────────
section("4) Club category")
r = requests.get(f"{API}/partners", params={"category": "club"}, timeout=30)
assert_true("GET club returns 200", r.status_code == 200, f"status={r.status_code}")
clubs = r.json() if r.status_code == 200 else []
print(f"  club count = {len(clubs)}")
assert_true(f"club count >= 35 (got {len(clubs)})", len(clubs) >= 35)

expected_clubs = ["Alquimico", "Cafe Havana", "Tucandela", "Donde Fidel", "Eivissa", "El Coro Lounge Bar"]
club_names_norm = {normalize(p.get("name", "")) for p in clubs}
club_matches = [e for e in expected_clubs if normalize(e) in club_names_norm]
print(f"  club expected matches: {club_matches}")
missing_clubs = [e for e in expected_clubs if normalize(e) not in club_names_norm]
assert_true(
    f"all 6 expected clubs present (missing: {missing_clubs})",
    len(missing_clubs) == 0
)


# ─────────────────────────────────────────────────────────────────────
# 5) No partner has subcategory="arab"
# ─────────────────────────────────────────────────────────────────────
section("5) No restaurant has subcategory='arab'")
r = requests.get(f"{API}/partners", params={"category": "restaurant"}, timeout=30)
assert_true("GET restaurants returns 200", r.status_code == 200)
restaurants = r.json() if r.status_code == 200 else []
arab_partners = [p for p in restaurants if p.get("subcategory") == "arab"]
print(f"  arab subcategory count = {len(arab_partners)}")
if arab_partners:
    print(f"  FAIL — found arab partners: {[p.get('name') for p in arab_partners]}")
assert_true(
    f"no restaurant has subcategory='arab' (found {len(arab_partners)})",
    len(arab_partners) == 0
)

# Also explicit query
r2 = requests.get(f"{API}/partners", params={"category": "restaurant", "subcategory": "arab"}, timeout=30)
if r2.status_code == 200:
    arab2 = r2.json()
    assert_true(
        f"GET ?subcategory=arab returns 0 entries (got {len(arab2)})",
        len(arab2) == 0
    )


# ─────────────────────────────────────────────────────────────────────
# 6) Alcaldía regression
# ─────────────────────────────────────────────────────────────────────
section("6) Alcaldía token regression")
login_r = requests.post(
    f"{API}/business/login",
    json={"email": "alcaldia@amocartagena.app", "password": "AlcaldiaCTG2026!"},
    timeout=30
)
assert_true("Alcaldía login returns 200", login_r.status_code == 200, f"status={login_r.status_code} body={login_r.text[:200]}")
token = None
if login_r.status_code == 200:
    token = login_r.json().get("token")
assert_true("login returned a token", token is not None)

if token:
    h = {"Authorization": f"Bearer {token}"}

    # analytics
    r = requests.get(f"{API}/business/admin/analytics", params={"days": 30}, headers=h, timeout=30)
    assert_true(f"GET /admin/analytics?days=30 returns 200 (got {r.status_code})", r.status_code == 200)
    if r.status_code == 200:
        body = r.json()
        for key in ("kpis", "demographics", "city_pass", "port_tax", "user_growth", "top_events", "funnel"):
            assert_true(f"analytics has key '{key}'", key in body)

    # payments
    r = requests.get(f"{API}/business/admin/payments", params={"limit": 10}, headers=h, timeout=30)
    assert_true(f"GET /admin/payments?limit=10 returns 200 (got {r.status_code})", r.status_code == 200)
    if r.status_code == 200:
        body = r.json()
        assert_true("payments response has 'payments' list", isinstance(body.get("payments"), list))
        assert_true(f"payments returned <= 10 (got {len(body.get('payments', []))})", len(body.get("payments", [])) <= 10)

    # payouts
    r = requests.get(f"{API}/business/admin/payouts", headers=h, timeout=30)
    assert_true(f"GET /admin/payouts returns 200 (got {r.status_code})", r.status_code == 200)
    if r.status_code == 200:
        body = r.json()
        for key in ("rows", "totals", "currency"):
            assert_true(f"payouts has key '{key}'", key in body)

    # heatmap
    r = requests.get(f"{API}/business/admin/heatmap", params={"days": 30}, headers=h, timeout=30)
    assert_true(f"GET /admin/heatmap?days=30 returns 200 (got {r.status_code})", r.status_code == 200)
    if r.status_code == 200:
        body = r.json()
        for key in ("kpis", "points", "zones", "peak_hours", "city_center", "period_days"):
            assert_true(f"heatmap has key '{key}'", key in body)
        assert_true("heatmap.peak_hours has 24 items", len(body.get("peak_hours", [])) == 24)

    # ─────────────────────────────────────────────────────
    # 7) Sanity — users endpoint
    # ─────────────────────────────────────────────────────
    section("7) Users sanity")
    r = requests.get(f"{API}/business/admin/users", params={"limit": 5}, headers=h, timeout=30)
    assert_true(f"GET /admin/users?limit=5 returns 200 (got {r.status_code})", r.status_code == 200)
    if r.status_code == 200:
        body = r.json()
        users = body.get("users", [])
        assert_true(f"users is a list (got {type(users).__name__})", isinstance(users, list))
        assert_true(f"users length <= 5 (got {len(users)})", len(users) <= 5)


# ─────────────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print(f"PASSED: {len(passes)}")
print(f"FAILED: {len(fails)}")
if fails:
    print("\nFailed assertions:")
    for name, detail in fails:
        print(f"  ❌ {name}  {detail}")
    sys.exit(1)
else:
    print("\nALL ASSERTIONS PASSED ✓")
    sys.exit(0)
