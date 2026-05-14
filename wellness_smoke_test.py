"""
Smoke test for the Wellness / Beach Club / Hotel bulk-seed.
Idempotent read-only — no data mutation.
"""
import os
import sys
import re
import unicodedata
import requests

# Read backend URL from frontend/.env
BACKEND_URL = None
with open("/app/frontend/.env", "r") as f:
    for line in f:
        if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BACKEND_URL = line.split("=", 1)[1].strip().strip('"').strip("'")
            break

assert BACKEND_URL, "EXPO_PUBLIC_BACKEND_URL not found"
API = BACKEND_URL.rstrip("/") + "/api"
print(f"Using API: {API}")

failures = []
successes = []


def norm(s: str) -> str:
    """case-insensitive, strip accents, drop apostrophes/punct, collapse whitespace."""
    if not s:
        return ""
    s = s.lower()
    s = "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))
    s = s.replace("'", "").replace("'", "").replace("`", "")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def names_match(haystack_names, needle):
    n = norm(needle)
    return any(n in norm(h) for h in haystack_names)


def assert_partners(category, subcategory, min_count, must_include):
    label = f"GET /partners?category={category}" + (f"&subcategory={subcategory}" if subcategory else "")
    params = {"category": category}
    if subcategory:
        params["subcategory"] = subcategory
    try:
        r = requests.get(f"{API}/partners", params=params, timeout=30)
    except Exception as e:
        failures.append(f"{label} → EXCEPTION: {e}")
        return None
    if r.status_code != 200:
        failures.append(f"{label} → status {r.status_code}\nBody: {r.text[:1000]}")
        return None
    data = r.json()
    if not isinstance(data, list):
        failures.append(f"{label} → expected list, got {type(data).__name__}\nBody: {r.text[:500]}")
        return None
    count = len(data)
    names = [(p.get("name") or "") for p in data]
    ok = True
    if count < min_count:
        failures.append(f"{label} → count={count} < min {min_count}")
        ok = False
    missing = [m for m in must_include if not names_match(names, m)]
    if missing:
        failures.append(f"{label} → missing required names: {missing}\nReturned names ({count}): {names[:30]}{'...' if count>30 else ''}")
        ok = False
    if ok:
        successes.append(f"{label} → count={count} ✓ all required names present")
    return data


# 1) Yoga
assert_partners("wellness", "yoga", 7, ["Soma Yoga", "Mandala Yoga", "Omm Wellness", "Vive Yoga"])

# 2) Sport
assert_partners("wellness", "sport", 14, ["Shaka Surf Club", "Cartagena Surf 420", "Padel Club Bocagrande", "Karib Kayak Center"])

# 3) Spa
assert_partners("wellness", "spa", 18, ["Aurium", "Mg Spa Centro", "Spa Kalamari", "Lili Spa Massage"])

# 4) Fitness
assert_partners("wellness", "fitness", 7, ["Bodytech Bocagrande", "Spinning Sport Center", "Pilate Pro Works"])

# 5) Nails
assert_partners("wellness", "nails", 10, ["Mg Spa De Uñas Centro", "Francys Nails"])

# 6) Hair
assert_partners("wellness", "hair", 10, ["Morgan's Barber Centro", "Felipe Walker Hair Salon"])

# 7) Recovery
assert_partners("wellness", "recovery", 3, ["Rebalance Sueroterapia", "Valeo"])

# 8) Beach clubs
bc_data = assert_partners("beach_club", None, 35, ["Pao Pao", "Makani", "Karibana Beach Club"])
# Bellini OR Bethel Bellini
if bc_data is not None:
    names = [p.get("name", "") for p in bc_data]
    if not (names_match(names, "Bellini") or names_match(names, "Bethel Bellini")):
        failures.append(f"GET /partners?category=beach_club → missing 'Bellini' or 'Bethel Bellini'\nNames sample: {names[:30]}")
    else:
        successes.append("beach_club → Bellini/Bethel Bellini present ✓")

# 9) Hotels lujo (≥18, at least 3 of given list)
lujo_data = assert_partners("hotel", "lujo", 18, [])
if lujo_data is not None:
    expected = ["Sofitel Legend Santa Clara Cartagena", "Hyatt Regency Cartagena", "Hilton Cartagena",
                "InterContinental Cartagena de Indias", "Charleston Santa Teresa Cartagena",
                "Hotel Movich Cartagena De Indias", "Bastion Luxury Hotel"]
    names = [p.get("name", "") for p in lujo_data]
    present = [e for e in expected if names_match(names, e)]
    if len(present) < 3:
        failures.append(f"hotel/lujo → only {len(present)} of expected luxury hotels present: {present}\nAll lujo names ({len(names)}): {names[:40]}")
    else:
        successes.append(f"hotel/lujo → {len(present)} luxury brands present: {present[:5]} ✓")

# 10) Hotels premium ≥40
assert_partners("hotel", "premium", 40, [])

# 11) Hotels popular ≥80
assert_partners("hotel", "popular", 80, [])

# 12) Regression: Alcaldía token
print("\n--- Regression: Alcaldía admin endpoints ---")
login_resp = requests.post(
    f"{API}/business/login",
    json={"email": "alcaldia@amocartagena.app", "password": "AlcaldiaCTG2026!"},
    timeout=30,
)
if login_resp.status_code != 200:
    failures.append(f"Alcaldía login → status {login_resp.status_code}\nBody: {login_resp.text[:500]}")
else:
    token = login_resp.json().get("token")
    if not token:
        failures.append(f"Alcaldía login → no token in response: {login_resp.text[:500]}")
    else:
        headers = {"Authorization": f"Bearer {token}"}
        for path in [
            "/business/admin/analytics?days=30",
            "/business/admin/payments?limit=10",
            "/business/admin/payouts",
            "/business/admin/heatmap?days=30",
        ]:
            r = requests.get(f"{API}{path}", headers=headers, timeout=30)
            if r.status_code != 200:
                failures.append(f"GET {path} → status {r.status_code}\nBody: {r.text[:500]}")
            else:
                successes.append(f"GET {path} → 200 ✓")

# Summary
print("\n" + "=" * 70)
print(f"RESULTS: {len(successes)} passed, {len(failures)} failed")
print("=" * 70)
print("\n--- PASSED ---")
for s in successes:
    print("  ✅", s)
if failures:
    print("\n--- FAILED ---")
    for f in failures:
        print("  ❌", f)
        print()
sys.exit(0 if not failures else 1)
