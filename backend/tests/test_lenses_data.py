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


def test_fill_gate_launch_state() -> None:  # §2 + V2 (+ 4A amendment)
    fills = L.fill_counts(DATA)
    assert fills["golden_hour"]["live"] is True
    assert fills["golden_hour"]["high"] >= 8
    assert fills["port_day"]["live"] is True          # fares resolve from the city module
    # 4A: step_free is LIVE on exactly its 4 source-verified anchors (Playa 5/4/Azul +
    # Museo del Oro); min_fill moved 6→4 WITH the tagline reframe to "anchors + assisted
    # routes" — padding to 6 would have required unsourced claims (DESIGN.md §2).
    assert fills["step_free"]["live"] is True
    assert fills["step_free"]["high"] == 4 and fills["step_free"]["min_fill"] == 4
    assert fills["step_free"]["total"] >= 8           # the VERIFY assisted rows ride along
    # 4B: family is LIVE on its 4 official-site anchors (Aviario, Oceanario, Museo del Oro,
    # Hospital Serena del Mar) — min_fill moved 8→4 with the tagline reframe (DESIGN.md §2).
    assert fills["family"]["live"] is True
    assert fills["family"]["high"] == 4 and fills["family"]["min_fill"] == 4
    assert fills["family"]["total"] >= 9              # + the VERIFY reported picks
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


def test_validate_rejects_unprovenanced_4a_shapes() -> None:  # 4A rails
    import copy
    bad = copy.deepcopy(DATA)
    del bad["venue_tags"][0]["display_name"]
    assert any("display_name" in e for e in L.validate_lenses(bad, catalog_ids=CATALOG_IDS))
    bad2 = copy.deepcopy(DATA)
    sf = next(l for l in bad2["lenses"] if l["key"] == "step_free")
    sf["advisories"][0]["kind"] = "guessed"
    assert any("kind must be reported|unverified" in e
               for e in L.validate_lenses(bad2, catalog_ids=CATALOG_IDS))
    bad3 = copy.deepcopy(DATA)
    sf3 = next(l for l in bad3["lenses"] if l["key"] == "step_free")
    rep = next(a for a in sf3["advisories"] if a["kind"] == "reported")
    rep.pop("source_url")
    assert any("reported advisory needs source_url" in e
               for e in L.validate_lenses(bad3, catalog_ids=CATALOG_IDS))


def test_family_lens_never_tags_the_excluded_venues() -> None:  # 4B rails
    """Family-NEGATIVE list: adults/party clubs, the torture-display museum and the
    deep-water beach must never carry a family tag, whatever a future seed does."""
    excluded = {
        "attr_007",                 # Palacio de la Inquisición (instrumentos de tortura)
        "ptr_W140",                 # Bora Bora (adults-only)
        "attr_018",                 # Playa Blanca (deep water near shore)
        "ptr_NEW_playa_blanca_bc",  # Playa Blanca Beach Club
        "ptr_occ_010",              # Cholón (party)
        "ptr_X1143",                # LUXURY Beach Club (DJ-driven)
        "ptr_W141",                 # Makani (its own publisher's family list excludes it)
    }
    family_ids = {t["venue_id"] for t in DATA["venue_tags"] if t["lens"] == "family"}
    assert not (family_ids & excluded), family_ids & excluded


def test_family_never_claims_car_seats_or_life_jackets_on_a_venue() -> None:  # 4B rails
    """Per-booking realities are advisories, never venue attributes set true."""
    for t in DATA["venue_tags"]:
        if t["lens"] != "family":
            continue
        for k in ("car_seat_transfer", "child_life_jacket", "high_chairs", "kids_menu"):
            assert t["attrs"].get(k) is not True, f"{t['venue_id']}: {k} must never be claimed true"
    fam = next(l for l in DATA["lenses"] if l["key"] == "family")
    advisory_text = " ".join(a["text"]["es"] for a in fam["advisories"])
    assert "al reservar" in advisory_text          # the confirm-at-booking advisory exists
    assert "regazo" in advisory_text               # the published lap-riding red flag is surfaced
