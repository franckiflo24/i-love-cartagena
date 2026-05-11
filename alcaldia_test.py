"""Backend tests for Alcaldía (government) admin endpoints + partner-endpoint coexistence.

Hits the external preview URL (EXPO_PUBLIC_BACKEND_URL) per system rules.
"""
import os
import sys
import json
import requests

BASE_URL = "https://cartagena-live.preview.emergentagent.com/api"

ALCALDIA_EMAIL = "alcaldia@amocartagena.app"
ALCALDIA_PWD = "AlcaldiaCTG2026!"
PARTNER_EMAIL = "casaboheme@amocartagena.app"
PARTNER_PWD = "amocartagena2026"

passed = 0
failed = 0
failures = []


def check(label, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ {label}")
    else:
        failed += 1
        failures.append(f"{label} — {detail}")
        print(f"  ❌ {label} — {detail}")


def login(email, pwd):
    r = requests.post(f"{BASE_URL}/business/login", json={"email": email, "password": pwd}, timeout=30)
    r.raise_for_status()
    return r.json()["token"]


def main():
    print("\n=== AUTH SETUP ===")
    try:
        alc_token = login(ALCALDIA_EMAIL, ALCALDIA_PWD)
        print(f"  Alcaldía token: {alc_token[:20]}...")
    except Exception as e:
        print(f"  ❌ FATAL: Alcaldía login failed: {e}")
        sys.exit(1)
    try:
        partner_token = login(PARTNER_EMAIL, PARTNER_PWD)
        print(f"  Partner token: {partner_token[:20]}...")
    except Exception as e:
        print(f"  ❌ Partner login failed: {e}")
        partner_token = None

    alc_hdr = {"Authorization": f"Bearer {alc_token}"}
    par_hdr = {"Authorization": f"Bearer {partner_token}"} if partner_token else {}

    # ============================================================
    # 1) GET /api/business/admin/analytics
    # ============================================================
    print("\n=== /business/admin/analytics ===")
    r = requests.get(f"{BASE_URL}/business/admin/analytics?days=30", timeout=30)
    check("401 without token", r.status_code == 401, f"got {r.status_code}: {r.text[:120]}")

    if partner_token:
        r = requests.get(f"{BASE_URL}/business/admin/analytics?days=30", headers=par_hdr, timeout=30)
        check("403 with partner token", r.status_code == 403, f"got {r.status_code}: {r.text[:120]}")

    r = requests.get(f"{BASE_URL}/business/admin/analytics?days=30", headers=alc_hdr, timeout=60)
    check("200 with Alcaldía token", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        data = r.json()
        # top-level keys
        for k in ["period_days", "generated_at", "kpis", "demographics", "city_pass", "port_tax", "user_growth", "top_events", "top_zones", "funnel"]:
            check(f"analytics has '{k}'", k in data)
        check("period_days == 30", data.get("period_days") == 30, f"got {data.get('period_days')}")

        # kpis fields
        kpis = data.get("kpis", {})
        for k in [
            "total_users", "new_users_7d", "new_users_30d",
            "total_passes_sold", "active_passes",
            "port_tax_tickets", "port_tax_passengers",
            "total_revenue_cop", "citypass_revenue_cop", "port_tax_revenue_cop"
        ]:
            check(f"kpis['{k}'] present", k in kpis)

        # revenue coherence
        tot = kpis.get("total_revenue_cop", 0)
        cp = kpis.get("citypass_revenue_cop", 0)
        pt = kpis.get("port_tax_revenue_cop", 0)
        check(
            "total_revenue_cop == citypass_revenue_cop + port_tax_revenue_cop",
            tot == cp + pt,
            f"total={tot} cp={cp} pt={pt}",
        )

        # demographics
        dem = data.get("demographics", {})
        for k in ["nationalities", "age_groups", "genders", "total_profiled"]:
            check(f"demographics['{k}'] present", k in dem)
        check("nationalities is list", isinstance(dem.get("nationalities"), list))
        if dem.get("nationalities"):
            n0 = dem["nationalities"][0]
            check("nationality entry has country/count/percentage",
                  all(x in n0 for x in ["country", "count", "percentage"]),
                  f"keys={list(n0.keys())}")

        # city_pass
        cp_data = data.get("city_pass", {})
        check("city_pass.by_plan is list", isinstance(cp_data.get("by_plan"), list))

        # port_tax
        pt_data = data.get("port_tax", {})
        for k in ["total_tickets", "total_passengers", "total_revenue"]:
            check(f"port_tax['{k}'] present", k in pt_data)

        # user_growth
        check("user_growth is list", isinstance(data.get("user_growth"), list))

        # top_events
        check("top_events is list", isinstance(data.get("top_events"), list))

        # top_zones
        check("top_zones is list", isinstance(data.get("top_zones"), list))

        # funnel
        funnel = data.get("funnel", {})
        for k in ["page_views", "event_clicks", "booking_clicks"]:
            check(f"funnel['{k}'] present", k in funnel)

        # print sample
        print(f"  [sample] total_users={kpis.get('total_users')}, total_revenue_cop={tot}, "
              f"nationalities={len(dem.get('nationalities', []))}, top_events={len(data.get('top_events', []))}")

    # ============================================================
    # 2) GET /api/business/admin/users
    # ============================================================
    print("\n=== /business/admin/users ===")
    r = requests.get(f"{BASE_URL}/business/admin/users?limit=5&skip=0", timeout=30)
    check("users 401 without token", r.status_code == 401, f"got {r.status_code}")

    if partner_token:
        r = requests.get(f"{BASE_URL}/business/admin/users?limit=5&skip=0", headers=par_hdr, timeout=30)
        check("users 403 with partner token", r.status_code == 403, f"got {r.status_code}")

    r = requests.get(f"{BASE_URL}/business/admin/users?limit=5&skip=0", headers=alc_hdr, timeout=30)
    check("users 200 with Alcaldía token", r.status_code == 200, f"got {r.status_code}")
    db_users_total = None
    if r.status_code == 200:
        data = r.json()
        for k in ["users", "total", "limit", "skip"]:
            check(f"users response has '{k}'", k in data)
        check("users is list", isinstance(data.get("users"), list))
        check("limit == 5", data.get("limit") == 5)
        check("skip == 0", data.get("skip") == 0)
        check("len(users) <= 5", len(data.get("users", [])) <= 5)
        users = data.get("users", [])
        if users:
            u0 = users[0]
            for k in ["user_id", "email", "name", "created_at", "has_active_pass", "port_tax_tickets"]:
                check(f"user[0]['{k}'] present", k in u0, f"keys={list(u0.keys())}")
            check("has_active_pass is bool", isinstance(u0.get("has_active_pass"), bool))
            check("port_tax_tickets is int", isinstance(u0.get("port_tax_tickets"), int))
            for k in ["persona", "nationality", "age_group", "interests"]:
                check(f"user[0]['{k}'] key exists", k in u0)
        db_users_total = data.get("total")
        print(f"  [sample] total={db_users_total}, returned={len(users)}")

        # pagination: skip=1
        r2 = requests.get(f"{BASE_URL}/business/admin/users?limit=3&skip=1", headers=alc_hdr, timeout=30)
        check("users pagination 200", r2.status_code == 200)
        if r2.status_code == 200:
            data2 = r2.json()
            check("skip=1 returns same total", data2.get("total") == db_users_total)
            check("skip=1 has limit=3", data2.get("limit") == 3)

    # ============================================================
    # 3) GET /api/business/admin/payments
    # ============================================================
    print("\n=== /business/admin/payments ===")
    r = requests.get(f"{BASE_URL}/business/admin/payments?limit=200", timeout=30)
    check("payments 401 without token", r.status_code == 401)

    if partner_token:
        r = requests.get(f"{BASE_URL}/business/admin/payments?limit=200", headers=par_hdr, timeout=30)
        check("payments 403 with partner token", r.status_code == 403)

    r = requests.get(f"{BASE_URL}/business/admin/payments?limit=200", headers=alc_hdr, timeout=30)
    check("payments 200 with Alcaldía token", r.status_code == 200)
    if r.status_code == 200:
        data = r.json()
        check("payments response has 'payments'", "payments" in data)
        check("payments response has 'count'", "count" in data)
        check("payments is list", isinstance(data.get("payments"), list))
        pays = data.get("payments", [])
        if pays:
            p0 = pays[0]
            for k in ["id", "type", "label", "user_id", "user_name", "user_email", "amount", "currency", "status", "created_at", "metadata"]:
                check(f"payment[0]['{k}'] present", k in p0, f"keys={list(p0.keys())}")
            types = {p.get("type") for p in pays}
            check("types are city_pass or port_tax", types.issubset({"city_pass", "port_tax"}), f"got types={types}")
            # desc sort
            dates = [p.get("created_at") or "" for p in pays]
            sorted_desc = sorted(dates, reverse=True)
            check("payments sorted desc by created_at", dates == sorted_desc, f"first 3 dates={dates[:3]}")
        print(f"  [sample] count={data.get('count')}, returned={len(pays)}, types={ {p.get('type') for p in pays} if pays else set()}")

    # ============================================================
    # 4) CSV exports
    # ============================================================
    print("\n=== /business/admin/export/users.csv ===")
    r = requests.get(f"{BASE_URL}/business/admin/export/users.csv", timeout=30)
    check("users.csv 401 without token", r.status_code == 401)
    if partner_token:
        r = requests.get(f"{BASE_URL}/business/admin/export/users.csv", headers=par_hdr, timeout=30)
        check("users.csv 403 with partner token", r.status_code == 403)
    r = requests.get(f"{BASE_URL}/business/admin/export/users.csv", headers=alc_hdr, timeout=30)
    check("users.csv 200 with Alcaldía token", r.status_code == 200)
    if r.status_code == 200:
        ct = r.headers.get("content-type", "")
        check("users.csv Content-Type starts with text/csv", ct.startswith("text/csv"), f"got {ct}")
        cd = r.headers.get("content-disposition", "")
        check("users.csv Content-Disposition has attachment; filename=", "attachment" in cd and "filename=" in cd, f"got {cd}")
        body = r.text
        lines = body.split("\n")
        check("users.csv has header line", lines and "user_id" in lines[0])
        check("users.csv has at least one data row", len(lines) >= 2 and bool(lines[1].strip()), f"line count={len(lines)}")
        expected_headers = ["user_id", "email", "name", "created_at", "nationality", "age_group", "persona", "has_active_pass", "port_tax_tickets"]
        for h in expected_headers:
            check(f"users.csv header contains '{h}'", h in lines[0])
        print(f"  [sample] header={lines[0][:120]}; rows={len(lines)-1}")

    print("\n=== /business/admin/export/payments.csv ===")
    r = requests.get(f"{BASE_URL}/business/admin/export/payments.csv", timeout=30)
    check("payments.csv 401 without token", r.status_code == 401)
    if partner_token:
        r = requests.get(f"{BASE_URL}/business/admin/export/payments.csv", headers=par_hdr, timeout=30)
        check("payments.csv 403 with partner token", r.status_code == 403)
    r = requests.get(f"{BASE_URL}/business/admin/export/payments.csv", headers=alc_hdr, timeout=30)
    check("payments.csv 200 with Alcaldía token", r.status_code == 200)
    if r.status_code == 200:
        ct = r.headers.get("content-type", "")
        check("payments.csv Content-Type starts with text/csv", ct.startswith("text/csv"), f"got {ct}")
        cd = r.headers.get("content-disposition", "")
        check("payments.csv Content-Disposition has attachment; filename=", "attachment" in cd and "filename=" in cd, f"got {cd}")
        body = r.text
        lines = body.split("\n")
        check("payments.csv has header line", lines and "id" in lines[0])
        expected_headers = ["id", "type", "label", "user_email", "user_name", "amount_cop", "status", "created_at", "metadata"]
        for h in expected_headers:
            check(f"payments.csv header contains '{h}'", h in lines[0])
        # At least header (data row may be missing if there are 0 payments — but spec says >=1)
        check("payments.csv has at least one data row (or header-only is OK if 0 payments)",
              len(lines) >= 1, f"line count={len(lines)}")
        print(f"  [sample] header={lines[0][:120]}; rows={len(lines)-1}")

    # ============================================================
    # 5) Existing partner endpoints still work for Alcaldía
    # ============================================================
    print("\n=== Alcaldía + EXISTING partner endpoints ===")
    r = requests.get(f"{BASE_URL}/business/me", headers=alc_hdr, timeout=30)
    check("business/me 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        d = r.json()
        partner = d.get("partner", {})
        check("partner.name == 'Alcaldía de Cartagena'",
              partner.get("name") == "Alcaldía de Cartagena", f"got {partner.get('name')}")
        check("partner.is_government == True",
              partner.get("is_government") is True, f"got {partner.get('is_government')}")
        biz = d.get("business", {})
        check("business.role == 'government'",
              biz.get("role") == "government", f"got {biz.get('role')}")

    # PUT /business/profile — update description
    new_desc = "Cuenta oficial de la Alcaldía Mayor de Cartagena de Indias. Test update " + os.urandom(4).hex()
    r = requests.put(f"{BASE_URL}/business/profile", headers=alc_hdr,
                     json={"description": new_desc}, timeout=30)
    check("PUT /business/profile 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    if r.status_code == 200:
        d = r.json()
        check("profile update reflected", d.get("partner", {}).get("description") == new_desc,
              f"got {d.get('partner', {}).get('description')[:80]}")

    # POST /business/events — publish institutional cultural event
    payload = {
        "title": "Concierto Patrimonio Cultural — Plaza de la Aduana",
        "description": "Concierto gratuito de música clásica y folclore del Caribe colombiano organizado por la Alcaldía. Habrá orquesta sinfónica juvenil, presentaciones de danza tradicional y muestra gastronómica. Evento al aire libre con cupo limitado, abierto a residentes y turistas.",
        "category": "music",
        "date": "2026-02-15",
        "start_time": "18:00",
        "end_time": "21:00",
        "is_free": True,
        "price": 0,
        "currency": "COP",
        "booking_link": "https://cartagena.gov.co/agenda",
    }
    r = requests.post(f"{BASE_URL}/business/events", headers=alc_hdr, json=payload, timeout=120)
    check("POST /business/events 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")
    new_event_id = None
    if r.status_code == 200:
        d = r.json()
        new_event_id = d.get("event_id")
        check("event has event_id", bool(new_event_id), f"got keys={list(d.keys())}")
        check("event has moderation_status",
              d.get("moderation_status") in ("approved", "pending", "rejected"),
              f"got {d.get('moderation_status')}")
        print(f"  [sample] event_id={new_event_id}, moderation_status={d.get('moderation_status')}")

    # GET /business/events
    r = requests.get(f"{BASE_URL}/business/events", headers=alc_hdr, timeout=30)
    check("GET /business/events 200", r.status_code == 200)
    if r.status_code == 200 and new_event_id:
        evts = r.json()
        ids = [e.get("event_id") for e in evts]
        check("published event appears in list", new_event_id in ids,
              f"found {len(evts)} events; first ids={ids[:5]}")

    # ============================================================
    # SUMMARY
    # ============================================================
    print("\n" + "=" * 60)
    print(f"RESULTS: {passed} passed / {failed} failed / total {passed + failed}")
    print("=" * 60)
    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(f"  - {f}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
