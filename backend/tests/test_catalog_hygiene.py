"""CATALOG-HYGIENE v1 — spec acceptance (pure fns) + wiring locks.
No DB: clean_display_name/min_fill/compute are pure; the retrieval-gate and
ingest wiring are locked by source/shape asserts (house verify-map pattern)."""
from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import catalog_hygiene as H  # noqa: E402

AUDIT_BLOB = ("LA VIEJA GUARDIA FISH & WINE / RESTAURANTES DE TAPAS Y MARISCOS "
              "/ COMIDA DE MAR EN CARTAGENA/ MARISQUERÍA/ COCTELES /")


# ── spec unit acceptance ──────────────────────────────────────────────────────

def test_audit_specimen_cleans_but_stays_unconfident() -> None:
    disp, hint, conf = H.clean_display_name(AUDIT_BLOB)
    assert disp == "La Vieja Guardia Fish & Wine"
    assert hint and "Tapas" in hint and "Mariscos" in hint
    assert conf is False  # we never guess the brand boundary
    assert "/" not in disp and "|" not in disp


def test_override_promotes_to_confident() -> None:
    key = H.normalize_key(AUDIT_BLOB)
    H.CANONICAL_OVERRIDES[key] = "La Vieja Guardia"
    try:
        disp, hint, conf = H.clean_display_name(AUDIT_BLOB)
        assert (disp, hint, conf) == ("La Vieja Guardia", None, True)
    finally:
        del H.CANONICAL_OVERRIDES[key]


def test_celele_restaurante() -> None:
    disp, _hint, conf = H.clean_display_name("CELELE RESTAURANTE")
    assert disp == "Celele" and conf is True


def test_accents_preserved_and_untouched() -> None:
    disp, hint, conf = H.clean_display_name("Erre de Ramón Freixa")
    assert disp == "Erre de Ramón Freixa" and hint is None and conf is True


def test_digit_names_preserved() -> None:
    disp, _h, conf = H.clean_display_name("7 Cielos")
    assert disp == "7 Cielos" and conf is True


def test_fragment_head_not_confident() -> None:
    disp, _h, conf = H.clean_display_name("by Rausch")
    assert conf is False and disp  # cleaned, shown nowhere near Luna


def test_pipe_specimens_from_live_catalog() -> None:
    disp, _h, conf = H.clean_display_name("CA.FÉ | Cafetería & Brunch Cartagena")
    assert disp == "CA.FÉ" and conf is True  # override — the trusted path
    disp2, _h2, _c2 = H.clean_display_name("El Bololó | Bowls del Caribe")
    assert disp2 == "El Bololó"


def test_normalize_key_strips_accents_and_punct() -> None:
    assert H.normalize_key("Época Café Bar") == "epoca cafe bar"
    assert H.normalize_key("Zaitún") == "zaitun"
    assert H.normalize_key("CA.FÉ | Brunch") == "ca fe brunch"


def test_status_overrides_hit_and_block_display() -> None:
    doc = {"name": "Café del Mar", "address": "Baluarte", "location": {}}
    H.apply_hygiene(doc)
    assert doc["status"] == "closed" and doc["display_ready"] is False
    assert doc["name_raw"] == "Café del Mar"


def test_min_fill_adapted_to_real_fields() -> None:
    assert H.min_fill_ok({"address": "Cra 4 #38-40"}) is True
    assert H.min_fill_ok({"location": {"lat": 10.4, "lng": -75.5}}) is True
    assert H.min_fill_ok({"geo": {"type": "Point", "coordinates": [-75.5, 10.4]}}) is True
    assert H.min_fill_ok({"address": "", "location": {}, "geo": {}}) is False


def test_apply_hygiene_idempotent_and_respects_verified() -> None:
    doc = {"name": AUDIT_BLOB, "address": "Centro San Diego"}
    H.apply_hygiene(doc)
    first = dict(doc)
    H.apply_hygiene(doc)  # second pass: name_raw stays the ORIGINAL blob
    assert doc["name_raw"] == AUDIT_BLOB and doc["name"] == first["name"]
    assert doc["display_ready"] is False and doc["hygiene_v"] == H.HYGIENE_V

    frank = {"name": "Nombre De Frank", "name_raw": AUDIT_BLOB,
             "name_verified": True, "address": "x"}
    H.apply_hygiene(frank)
    assert frank["name"] == "Nombre De Frank"      # never clobbered
    assert frank["display_ready"] is True          # verified name = confident


def test_no_fabrication_display_is_subset_recase_of_raw() -> None:
    import re as _re
    samples = [AUDIT_BLOB, "CELELE RESTAURANTE", "El Bololó | Bowls del Caribe",
               "MIRADOR del CARAJO", "Fruto Bendito Café - Historia del Café Colombiano"]
    for raw in samples:
        disp, _h, _c = H.clean_display_name(raw)
        if H.normalize_key(raw) in H.CANONICAL_OVERRIDES:
            continue  # overrides are human-verified by definition
        raw_words = set(H.normalize_key(raw).split())
        for w in _re.sub(r"[^0-9a-záéíóúñü&\s]", " ", disp.lower()).split():
            if w == "&":
                continue
            assert H._strip_accents(w) in raw_words, (raw, disp, w)


# ── dry-run regressions (prod specimens, 2026-10-07) ─────────────────────────

def test_articles_are_not_fragments() -> None:
    for raw, want in [("El Mirador Gastro Bar", "El Mirador Gastro Bar"),
                      ("The Pink Mango (formerly Amare Beach)",
                       "The Pink Mango (formerly Amare Beach)"),
                      ("La Mulata", "La Mulata")]:
        disp, _h, conf = H.clean_display_name(raw)
        assert conf is True, (raw, disp)
        assert disp == want


def test_conservative_strip_keeps_brand_nouns() -> None:
    # category nouns are usually THE brand — never stripped (dry-run #2)
    for raw in ("Bora Bora Beach Club", "Érase Un Café", "Avatar Disco Bar"):
        disp, _h, conf = H.clean_display_name(raw)
        assert disp == raw and conf is True, (raw, disp)
    # locative + spec's restaurante tail still strip, hotels stay confident
    assert H.clean_display_name("Padel Club Cartagena")[0] == "Padel Club"
    disp, _h, conf = H.clean_display_name("Movich Hotel Cartagena")
    assert disp == "Movich Hotel" and conf is True


def test_allcaps_simple_name_recases_confident() -> None:
    disp, _h, conf = H.clean_display_name("LUNALA HOTEL BOUTIQUE")
    assert disp == "Lunala Hotel Boutique" and conf is True


def test_no_dangling_connector_after_strip() -> None:
    disp, _h, conf = H.clean_display_name("Casa Pizarro in Cartagena")
    assert disp == "Casa Pizarro" and conf is True


def test_true_fragment_still_blocked() -> None:
    assert H.clean_display_name("by Rausch")[2] is False
    assert H.clean_display_name("de la")[2] is False


# ── wiring locks ──────────────────────────────────────────────────────────────

def test_concierge_filter_composes_public_plus_gate() -> None:
    import partner_visibility as PV
    f = PV.CONCIERGE_PARTNER_FILTER
    assert f["display_ready"] == {"$ne": False}
    for k, v in PV.PUBLIC_PARTNER_FILTER.items():
        assert f[k] == v
    # closed/unverified are hidden CATALOG-WIDE (status overrides have teeth)
    assert "closed" in PV.PUBLIC_PARTNER_FILTER["status"]["$nin"]
    assert "unverified" in PV.PUBLIC_PARTNER_FILTER["status"]["$nin"]


def test_ai_agent_partner_reads_use_concierge_gate() -> None:
    src = (BACKEND / "ai_agent.py").read_text(encoding="utf-8")
    assert src.count("CONCIERGE_PARTNER_FILTER") >= 9
    # no partner find() left on the ungated filter
    import re as _re
    leftovers = [m for m in _re.finditer(r"db\.partners\.find\([^)\n]*PUBLIC_PARTNER_FILTER", src)]
    assert leftovers == []


def test_ingest_beauty_hygiene_wired_and_honest() -> None:
    src = (BACKEND / "scripts" / "ingest_beauty.py").read_text(encoding="utf-8")
    assert "apply_hygiene" in src
    assert "descs[:2]" not in src            # full hours, UI clamps
    assert "Lun-Sáb 09:00 - 19:00" not in src  # no fabricated default hours


def test_migration_route_exists_with_dry_run_and_reverse() -> None:
    src = (BACKEND / "maintenance.py").read_text(encoding="utf-8")
    assert "catalog-hygiene" in src and "dry_run" in src and "reverse" in src
    assert "maintenance_backups" in src
