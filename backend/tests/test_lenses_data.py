"""LENSES committed data: schema, provenance (V1: zero tags without a source),
F5 corrections, fill gate expectations (docs/lenses/DESIGN.md §1/§2/§6).
Pure file tests — no network, no Mongo."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import lenses as L  # noqa: E402

DATA = json.loads((BACKEND / "data" / "lenses.json").read_text(encoding="utf-8"))
PARTNERS = json.loads((BACKEND.parent / "frontend" / "public" / "data" / "partners.json")
                      .read_text(encoding="utf-8"))
CATALOG_IDS = {p["partner_id"] for p in PARTNERS}


def test_validator_passes_with_catalog() -> None:
    assert L.validate_lenses(DATA, catalog_ids=CATALOG_IDS) == []


def test_every_pin_and_tag_has_full_provenance() -> None:
    rows = (DATA.get("pins") or []) + (DATA.get("venue_tags") or [])
    assert rows, "seed must not be empty"
    for r in rows:
        for f in ("source_url", "source_name", "last_verified", "confidence"):
            assert isinstance(r.get(f), str) and r[f].strip(), f"{r.get('id') or r.get('venue_id')}: {f}"
        assert r["confidence"] in ("HIGH", "VERIFY")
        assert r["source_url"].startswith("http")


def test_every_pin_has_an_access_tier_and_best_light() -> None:  # F3 + F2
    tiers = set(DATA["access_tiers"])
    for p in DATA["pins"]:
        assert p["access_tier"] in tiers, p["id"]
        assert p["best_light"] and set(p["best_light"]) <= {"sunrise", "midday", "sunset"}, p["id"]


def test_f5_corrections_are_law() -> None:
    names = [p["name"].lower() for p in DATA["pins"]]
    joined = " | ".join(names)
    for banned in ("café del mar", "interno", "mvngata", "mangata", "gozne", "btexia",
                   "moni", "pergamino", "coralina"):
        assert not any(n == banned or n.startswith(banned + " ") for n in names), banned
    # Café del Mar may appear ONLY inside the Baluarte pin's explanatory copy, never as a name.
    assert "café del mar" not in joined.replace("ex-café del mar", "")
    assert any("candé" in n for n in names), "Candé must stay (guide: open)"
    assert any("baluarte de la gente" in n for n in names)
    assert not any("café del mar" in n for n in names)


def test_fill_gate_launch_state() -> None:  # §2 + V2
    fills = L.fill_counts(DATA)
    assert fills["golden_hour"]["live"] is True
    assert fills["golden_hour"]["high"] >= 8
    assert fills["port_day"]["live"] is True          # fares resolve from the city module
    assert fills["step_free"]["live"] is False        # VERIFY-only seed stays gated
    assert fills["family"]["live"] is False
    assert fills["women_verified"]["live"] is False   # fills ONLY from in-app ratings
    assert (DATA_tags_high := [t for t in DATA["venue_tags"]
                               if t["lens"] == "women_verified"]) == [], DATA_tags_high


def test_castillo_pin_links_to_city_hub_and_states_no_price() -> None:
    p = next(x for x in DATA["pins"] if x["venue_id"] == "attr_001")
    assert p["link"] == "/ciudad/monumentos"
    body = json.dumps(p, ensure_ascii=False)
    assert "38.000" not in body and "38,000" not in body and "33.000" not in body, \
        "prices belong to the city hub, never duplicated on a pin"


def test_venue_refs_resolve_and_carry_no_copied_coords() -> None:
    for p in DATA["pins"]:
        if p.get("venue_id"):
            assert p["venue_id"] in CATALOG_IDS, p["id"]
            assert "lat" not in p and "lng" not in p, f"{p['id']}: coords come from the catalog only"
        else:
            assert p.get("geo_precision") in ("exact", "approx"), p["id"]


def test_itineraries_are_editorial_and_resolve() -> None:
    ids = {p["id"] for p in DATA["pins"]}
    its = DATA["port_day"]["itineraries"]
    assert its
    for it in its:
        assert it["editorial"] is True
        assert all(s["pin"] in ids for s in it["stops"])
    assert DATA["port_day"]["fare_module"] == "taxis"
    city = json.loads((BACKEND / "data" / "city_modules.json").read_text(encoding="utf-8"))
    assert any(m["id"] == "taxis" for m in city["modules"])


def test_sunset_table_serves_real_hours() -> None:
    t = L.sunset_hhmm_by_month()
    assert set(t) == {str(m) for m in range(1, 13)}
    assert t["9"] == "17:52" and t["10"] == "17:40"  # seasonal_stamps.json is the owner


def test_mirror_matches_source_resolution() -> None:
    """The committed frontend mirror must be the sync script's output for this source
    (same discipline as test_city_context.py's sync equality)."""
    mirror_path = BACKEND.parent / "frontend" / "public" / "data" / "lenses.json"
    assert mirror_path.exists(), "run: node frontend/scripts/sync-lenses-data.mjs"
    mirror = json.loads(mirror_path.read_text(encoding="utf-8"))
    assert mirror.get("version") == DATA.get("version")
    assert {p["id"] for p in mirror["pins"]} == {p["id"] for p in DATA["pins"]}
    by_id = {p["partner_id"]: p for p in PARTNERS}
    for p in mirror["pins"]:
        assert p.get("lat") is not None and p.get("lng") is not None, f"{p['id']}: mirror must resolve coords"
        vid = p.get("venue_id")
        if vid:
            loc = (by_id[vid].get("location") or {})
            assert abs(p["lat"] - loc.get("lat", 0)) < 1e-6, p["id"]
            img = by_id[vid].get("image_url")
            assert p.get("image_url") == img, f"{p['id']}: image must be the catalog's own"
    # luna trigger/decline blocks are internal — never in the public mirror (city-hub rule)
    for ln in mirror["lenses"]:
        assert "luna" not in ln, ln["key"]
