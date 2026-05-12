"""
Focused backend tests for the Alcaldía Tourist Heatmap endpoint.

Endpoint: GET /api/business/admin/heatmap

Runs against the public preview URL (EXPO_PUBLIC_BACKEND_URL).
"""
from __future__ import annotations

import os
import sys
import json
import re
from typing import Any

import requests

# ── Configuration ────────────────────────────────────────────────────────────
BASE_URL = "https://amo-preview-deploy.preview.emergentagent.com"
API = f"{BASE_URL}/api"

ALCALDIA_EMAIL = "alcaldia@amocartagena.app"
ALCALDIA_PASSWORD = "AlcaldiaCTG2026!"

PARTNER_EMAIL = "casaboheme@amocartagena.app"
PARTNER_PASSWORD = "amocartagena2026"

# ── Pretty-print helpers ─────────────────────────────────────────────────────
PASS = "\033[92m✓\033[0m"
FAIL = "\033[91m✗\033[0m"
WARN = "\033[93m!\033[0m"

results = []

def check(label: str, cond: bool, detail: str = ""):
    status = PASS if cond else FAIL
    line = f"  {status} {label}"
    if detail and not cond:
        line += f"   ⤷ {detail}"
    print(line)
    results.append((label, cond, detail))
    return cond

def section(title: str):
    print(f"\n=== {title} ===")

def login(email: str, password: str) -> str | None:
    r = requests.post(f"{API}/business/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        print(f"  Login failed for {email}: {r.status_code} {r.text[:200]}")
        return None
    data = r.json()
    return data.get("token") or data.get("session_token") or (data.get("session") or {}).get("token")


def main() -> int:
    # ── Pre-flight: get tokens ──
    section("0) Pre-flight — get tokens")
    alc_token = login(ALCALDIA_EMAIL, ALCALDIA_PASSWORD)
    check("Alcaldía login → token", bool(alc_token), "no token returned")
    if not alc_token:
        return 1
    partner_token = login(PARTNER_EMAIL, PARTNER_PASSWORD)
    check("Partner (casaboheme) login → token", bool(partner_token))
    if not partner_token:
        return 1

    H_ALC = {"Authorization": f"Bearer {alc_token}"}
    H_PARTNER = {"Authorization": f"Bearer {partner_token}"}

    # ── 1) AUTH GATING ──
    section("1) Auth gating")
    r = requests.get(f"{API}/business/admin/heatmap", timeout=30)
    check("1a) GET /heatmap no auth → 401", r.status_code == 401, f"got {r.status_code}: {r.text[:200]}")

    r = requests.get(f"{API}/business/admin/heatmap", headers=H_PARTNER, timeout=30)
    check("1b) GET /heatmap partner token → 403", r.status_code == 403, f"got {r.status_code}: {r.text[:200]}")

    r = requests.get(f"{API}/business/admin/heatmap", headers=H_ALC, timeout=30)
    check("1c) GET /heatmap alcaldía token → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:300]}")
    if r.status_code != 200:
        return 1

    # ── 2) RESPONSE SCHEMA (days=30) ──
    section("2) Response schema (days=30)")
    r = requests.get(f"{API}/business/admin/heatmap?days=30", headers=H_ALC, timeout=30)
    check("2.0) days=30 → 200", r.status_code == 200)
    body = r.json()
    print(f"   [debug] period_days={body.get('period_days')} total_pings={body.get('kpis',{}).get('total_pings')} active_zones={body.get('kpis',{}).get('active_zones')}")

    top_keys = {"period_days", "generated_at", "kpis", "points", "zones", "peak_hours", "city_center"}
    missing = top_keys - set(body.keys())
    check("2.1) Top-level keys present", not missing, f"missing: {missing}")

    check("2.2) period_days == 30", body.get("period_days") == 30, f"got {body.get('period_days')}")

    kpis = body.get("kpis", {})
    kpi_keys = {"total_pings", "unique_users", "active_zones", "busiest_hour", "busiest_hour_count"}
    missing_kpi = kpi_keys - set(kpis.keys())
    check("2.3) kpis has required keys", not missing_kpi, f"missing: {missing_kpi}")

    check("2.4) kpis.total_pings is int >= 0", isinstance(kpis.get("total_pings"), int) and kpis["total_pings"] >= 0)
    check("2.5) kpis.unique_users is int >= 0", isinstance(kpis.get("unique_users"), int) and kpis["unique_users"] >= 0)
    check("2.6) kpis.active_zones is int >= 0", isinstance(kpis.get("active_zones"), int) and kpis["active_zones"] >= 0)
    bh = kpis.get("busiest_hour")
    check("2.7) kpis.busiest_hour is int 0..23 or null", bh is None or (isinstance(bh, int) and 0 <= bh <= 23), f"got {bh}")
    check("2.8) kpis.busiest_hour_count is int >= 0", isinstance(kpis.get("busiest_hour_count"), int) and kpis["busiest_hour_count"] >= 0)

    # points
    points = body.get("points", [])
    check("2.9) points is list", isinstance(points, list))
    if points:
        sample = points[0]
        check("2.10) points[i] has lat/lng/weight/intensity",
              all(k in sample for k in ("lat", "lng", "weight", "intensity")),
              f"keys: {list(sample.keys())}")
        types_ok = (
            isinstance(sample.get("lat"), (float, int))
            and isinstance(sample.get("lng"), (float, int))
            and isinstance(sample.get("weight"), int) and sample["weight"] >= 1
            and isinstance(sample.get("intensity"), (float, int)) and 0.0 <= sample["intensity"] <= 1.0
        )
        check("2.11) points[i] types correct", types_ok, f"sample={sample}")
        max_int = max((p["intensity"] for p in points), default=0)
        check("2.12) max intensity is ~1.0", abs(max_int - 1.0) < 0.01, f"max={max_int}")

    # zones
    zones = body.get("zones", [])
    check("2.13) zones is list", isinstance(zones, list))
    if zones:
        z0 = zones[0]
        z_keys = {"zone", "label", "count", "percentage", "color", "lat", "lng"}
        missing_z = z_keys - set(z0.keys())
        check("2.14) zones[i] keys present", not missing_z, f"missing {missing_z}")
        z_types_ok = (
            isinstance(z0.get("zone"), str)
            and isinstance(z0.get("label"), str)
            and isinstance(z0.get("count"), int)
            and isinstance(z0.get("percentage"), (float, int)) and 0 <= z0["percentage"] <= 100
            and isinstance(z0.get("color"), str) and z0["color"].startswith("#")
            and (z0.get("lat") is None or isinstance(z0.get("lat"), (float, int)))
            and (z0.get("lng") is None or isinstance(z0.get("lng"), (float, int)))
        )
        check("2.15) zones[i] types ok", z_types_ok, f"sample={z0}")

    # peak_hours
    ph = body.get("peak_hours", [])
    check("2.16) peak_hours has exactly 24 items", isinstance(ph, list) and len(ph) == 24, f"len={len(ph)}")
    if isinstance(ph, list) and len(ph) == 24:
        hours_in_order = all(ph[i].get("hour") == i for i in range(24))
        check("2.17) peak_hours hours in order 0..23", hours_in_order)
        counts_ok = all(isinstance(it.get("count"), int) and it["count"] >= 0 for it in ph)
        check("2.18) peak_hours counts are int >= 0", counts_ok)

    # city_center
    cc = body.get("city_center", {})
    cc_ok = (
        isinstance(cc.get("lat"), (float, int)) and abs(cc["lat"] - 10.42) < 0.1
        and isinstance(cc.get("lng"), (float, int)) and abs(cc["lng"] - (-75.55)) < 0.1
        and isinstance(cc.get("zoom"), (int, float)) and cc["zoom"] >= 12
    )
    check("2.19) city_center lat~10.42, lng~-75.55, zoom>=12", cc_ok, f"cc={cc}")

    # ── 3) NUMERIC COHERENCE ──
    section("3) Numeric coherence")
    if bh is not None:
        peak_counts = [it["count"] for it in ph]
        max_count = max(peak_counts)
        max_hours = [it["hour"] for it in ph if it["count"] == max_count]
        check("3.1) kpis.busiest_hour matches peak_hours max", bh in max_hours,
              f"busiest_hour={bh}, peak max at hours={max_hours} count={max_count}")
        check("3.2) kpis.busiest_hour_count == max(peak_hours.count)",
              kpis["busiest_hour_count"] == max_count,
              f"kpi={kpis['busiest_hour_count']} vs max={max_count}")

    # Sum of zone.count == total_pings (only if all pings have a zone)
    zone_count_sum = sum(z["count"] for z in zones)
    check("3.3) sum(zone.count) == kpis.total_pings",
          zone_count_sum == kpis["total_pings"],
          f"sum={zone_count_sum} vs total_pings={kpis['total_pings']}")

    # active_zones == number of zones with count > 0 == len(zones)
    active_in_list = sum(1 for z in zones if z["count"] > 0)
    check("3.4) kpis.active_zones == #zones with count>0",
          kpis["active_zones"] == active_in_list,
          f"kpi={kpis['active_zones']} vs computed={active_in_list}")
    check("3.5) kpis.active_zones == len(zones)",
          kpis["active_zones"] == len(zones),
          f"kpi={kpis['active_zones']} vs len(zones)={len(zones)}")

    # zones sorted desc by count
    counts_seq = [z["count"] for z in zones]
    sorted_desc = counts_seq == sorted(counts_seq, reverse=True)
    check("3.6) zones sorted by count DESC", sorted_desc, f"counts={counts_seq}")

    # ── 4) DAYS PARAM CLAMPING ──
    section("4) days clamping")
    for d, expected in [(7, 7), (90, 90), (365, 365), (0, 1), (400, 365)]:
        r = requests.get(f"{API}/business/admin/heatmap?days={d}", headers=H_ALC, timeout=30)
        ok = r.status_code == 200 and r.json().get("period_days") == expected
        check(f"4.x) days={d} → 200, period_days={expected}",
              ok, f"status={r.status_code}, period_days={r.json().get('period_days') if r.ok else 'n/a'}")

    # days=invalid (non-numeric)
    r = requests.get(f"{API}/business/admin/heatmap?days=abc", headers=H_ALC, timeout=30)
    if r.status_code == 422:
        check("4.6) days=abc → 422 (FastAPI validation)", True)
    elif r.status_code == 200 and r.json().get("period_days") == 30:
        check("4.6) days=abc → 200 with default period_days=30", True)
    else:
        check("4.6) days=abc → 422 or default", False,
              f"got status={r.status_code} period_days={r.json().get('period_days') if r.ok else 'n/a'}")

    # ── 5) IDEMPOTENT SEED ──
    section("5) Idempotent seed (restart safety)")
    r1 = requests.get(f"{API}/business/admin/heatmap?days=365", headers=H_ALC, timeout=30).json()
    count_before = r1["kpis"]["total_pings"]
    print(f"   [debug] total_pings before restart (days=365): {count_before}")

    # Restart backend
    import subprocess
    res = subprocess.run(["sudo", "supervisorctl", "restart", "backend"], capture_output=True, text=True)
    print(f"   [restart] {res.stdout.strip()} {res.stderr.strip()}")
    import time
    # wait until backend healthy
    for _ in range(30):
        time.sleep(1)
        try:
            hr = requests.get(f"{API}/payments/config", timeout=5)
            if hr.status_code == 200:
                break
        except Exception:
            continue
    # Need to re-login because sessions may still be valid (token survives restart since DB-backed)
    r2 = requests.get(f"{API}/business/admin/heatmap?days=365", headers=H_ALC, timeout=30)
    if r2.status_code == 401:
        # token invalidated; re-login
        alc_token = login(ALCALDIA_EMAIL, ALCALDIA_PASSWORD)
        H_ALC = {"Authorization": f"Bearer {alc_token}"}
        r2 = requests.get(f"{API}/business/admin/heatmap?days=365", headers=H_ALC, timeout=30)
    body2 = r2.json()
    count_after = body2["kpis"]["total_pings"]
    print(f"   [debug] total_pings after restart (days=365): {count_after}")
    check("5.1) total_pings unchanged after restart (idempotent seed)",
          count_after == count_before,
          f"before={count_before} after={count_after}")
    check("5.2) total_pings >= 50 (seed threshold)", count_after >= 50, f"got {count_after}")

    # ── 6) REGRESSION SAFETY ──
    section("6) Regression safety — other admin endpoints still 200")
    for path in [
        "/business/admin/analytics",
        "/business/admin/users?limit=5",
        "/business/admin/payments?limit=5",
        "/business/admin/payouts",
    ]:
        r = requests.get(f"{API}{path}", headers=H_ALC, timeout=30)
        check(f"6) GET {path} → 200", r.status_code == 200, f"got {r.status_code}: {r.text[:200]}")

    # ── Summary ──
    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"\n{'='*60}")
    print(f"  RESULT: {passed}/{total} assertions passed")
    print(f"{'='*60}")
    failures = [(label, detail) for label, ok, detail in results if not ok]
    if failures:
        print("FAILURES:")
        for label, detail in failures:
            print(f"  - {label}   ⤷ {detail}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
