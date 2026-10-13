"""DROP 5A — activities verification: Reportado at seed, Verified only when earned.

Pure-gate tests for the promote action + seed-data rails. The endpoints themselves
are operator-token writes proven live (grant-admin precedent)."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import server as S  # noqa: E402

PARTNERS = json.loads((BACKEND.parent / "frontend" / "public" / "data" / "partners.json")
                      .read_text(encoding="utf-8"))


def test_promote_gate_requires_every_check() -> None:
    base = {"rues_url": "https://rues.org.co/x", "rues_checked_at": "2026-10-13",
            "camara_ref": "CC-123"}
    assert S._verify_evidence_missing({}, water=False, discipline="") == [
        "rues_url", "rues_checked_at", "camara_ref"]
    assert S._verify_evidence_missing(base, water=False, discipline="") == []
    # anything on the water needs DIMAR — zero DIMAR numbers were found at seed,
    # so no water operator can be promoted without one recorded
    assert S._verify_evidence_missing(base, water=True, discipline="") == ["dimar_ref"]
    assert S._verify_evidence_missing({**base, "dimar_ref": "D-1"}, water=True, discipline="") == []
    # dive needs PADI, kite needs IKO, on top of the water gate
    assert "padi_ref" in S._verify_evidence_missing({**base, "dimar_ref": "D-1"},
                                                    water=True, discipline="dive")
    assert "iko_ref" in S._verify_evidence_missing({**base, "dimar_ref": "D-1"},
                                                   water=True, discipline="kite")
    assert S._verify_evidence_missing({**base, "dimar_ref": "D", "padi_ref": "P"},
                                      water=True, discipline="dive") == []
    # blank strings never count as evidence
    assert "camara_ref" in S._verify_evidence_missing({**base, "camara_ref": "  "},
                                                      water=False, discipline="")


def test_upsert_verification_is_always_reportado() -> None:
    v = S._clean_reportado_verification({"status": "verificado", "rnt_rues_checked": True,
                                         "rnt_number": "15394", "evil": "x"})
    assert v["status"] == "reportado" and v["rnt_rues_checked"] is False
    assert v["rnt_number"] == "15394" and "evil" not in v
    assert S._clean_reportado_verification("nope") is None


def test_seed_rows_are_reportado_never_certified_never_selfclaiming() -> None:
    acts = [p for p in PARTNERS if p.get("verification")]
    assert len(acts) >= 11  # 4 new + 4 tagged + 3 demo-stripped
    for p in acts:
        assert p["verification"]["status"] == "reportado", p["partner_id"]
        assert p["verification"].get("rnt_rues_checked") is False, p["partner_id"]
        assert not p.get("is_certified"), f"{p['partner_id']}: CERTIFICADO is unearned"
        blob = (p.get("description", "") + " " + json.dumps(p.get("verification"))).lower()
        for banned in ("primer ", "único ", "first ", "precio más bajo", "lowest price",
                       "best price guaranteed", "award"):
            assert banned not in blob, f"{p['partner_id']}: self-claim {banned!r}"
        assert "verificado por amo" not in blob, p["partner_id"]
    # the four new activity records exist, placed, with the anti-scam line
    for pid in ("ptr_act_cartagena_divers", "ptr_act_bonavida",
                "ptr_act_ecotours_boquilla", "ptr_act_nexperience"):
        p = next(x for x in PARTNERS if x["partner_id"] == pid)
        assert p["category"] == "activity" and p["location"]["lat"], pid
        assert "Pide el RNT" in p["description"], pid
        assert p["image_url"] == "", pid  # SafeImage placeholder, like the 4A/4B seeds
    # Drop 6 TRUST LEDGER: the demo-era fabricated rows and the pre-existing twins
    # are HIDDEN (status unverified in Mongo) and gone from the static catalog.
    hidden = {"ptr_ac_001", "ptr_ac_002", "ptr_ac_004", "ptr_dv2_047", "ptr_dv2_049"}
    present = {p["partner_id"] for p in PARTNERS}
    assert not (hidden & present), hidden & present
    # dedup rail: exactly ONE record per operator remains
    for name, canonical in (("Diving Planet", "ptr_X1086"), ("Beyond Colombia", "ptr_V055")):
        rows = [p["partner_id"] for p in PARTNERS if name.lower() in p["name"].lower()]
        assert rows == [canonical], f"{name}: {rows}"


def test_6a_fabricated_render_nowhere_and_twins_resolve() -> None:
    """DROP 6A acceptance, locked: the fabricated set renders NOWHERE in the
    static-first layer (partners.json, catalog.json, experiences/featured.json,
    per-partner files — every surface the app can paint without the backend),
    and saved links to a hidden twin resolve to its canonical record."""
    DATA = BACKEND.parent / "frontend" / "public" / "data"
    HIDDEN = {"ptr_ac_001", "ptr_ac_002", "ptr_ac_003", "ptr_ac_004",
              "ptr_dv2_047", "ptr_dv2_049"}
    FABRICATED_NAMES = {"cartagena diving center", "cartagena food tours",
                        "aventura rosario islands", "walking cartagena"}

    # partners.json (explore/collections source)
    assert not (HIDDEN & {p["partner_id"] for p in PARTNERS})
    # catalog.json (Luna instant/offline layer)
    catalog = json.loads((DATA / "catalog.json").read_text(encoding="utf-8"))
    assert not (HIDDEN & {r.get("partner_id") for r in catalog})
    assert not (FABRICATED_NAMES & {str(r.get("name", "")).lower() for r in catalog})
    # experiences/featured.json (Featured Experiences rail — merges into the rail
    # even when the API answers, so a stale row here IS a live render)
    featured = json.loads((DATA / "experiences" / "featured.json").read_text(encoding="utf-8"))
    assert not (HIDDEN & {e.get("partner_id") for e in featured})
    assert not (FABRICATED_NAMES & {str(e.get("name", "")).lower() for e in featured})
    # per-partner static files (the partner-detail static fallback path)
    for pid in HIDDEN:
        assert not (DATA / "partners" / f"{pid}.json").exists(), f"{pid}.json still served"

    # dedupe rail: alias map sends each hidden twin to its canonical, the canonical
    # is live in the catalog, and Diving Planet's survivor carries the real RNT.
    aliases = json.loads((BACKEND.parent / "frontend" / "src" / "data" /
                          "partnerAliases.json").read_text(encoding="utf-8"))
    assert aliases == {"ptr_dv2_049": "ptr_X1086", "ptr_dv2_047": "ptr_V055"}
    by_id = {p["partner_id"]: p for p in PARTNERS}
    for dup, canonical in aliases.items():
        assert canonical in by_id, f"canonical {canonical} missing for {dup}"
    assert by_id["ptr_X1086"]["verification"]["rnt_number"] == "15394"
    # the redirect is wired into the partner screen (map imported + replace on alias)
    screen = (BACKEND.parent / "frontend" / "app" / "partner" / "[id].tsx").read_text(encoding="utf-8")
    assert "partnerAliases.json" in screen and "aliasTarget" in screen


def test_static_layer_is_subset_of_approved_partners() -> None:
    """Phil's 6A corollary (2026-10-13): 'A clean API is not a clean surface.'
    Every partner_id referenced ANYWHERE under frontend/public/data — and every
    per-partner detail file by filename — must belong to the approved static
    catalog (partners.json, the mirror of Mongo's PUBLIC filter). A hide/remove
    that misses a static surface fails here, not in prod. First catch of this
    sweep: 30 orphan detail files for closed/hidden venues + a promotions file
    advertising 5 dead venues with June-expired promos."""
    DATA = BACKEND.parent / "frontend" / "public" / "data"
    approved = {p["partner_id"] for p in PARTNERS}
    bad: dict[str, list[str]] = {}
    for f in sorted(DATA.rglob("*.json")):
        ids = set(re.findall(r'"partner_id"\s*:\s*"([^"]+)"', f.read_text(encoding="utf-8")))
        if f.parent.name == "partners":
            ids.add(f.stem)
        extra = sorted(ids - approved)
        if extra:
            bad[str(f.relative_to(DATA))] = extra
    assert not bad, f"static files reference non-approved partner_ids: {bad}"


def test_fabricated_seed_rows_never_return() -> None:
    """The ptr_ac_* operators were BORN in server.py startup seeds: ACTIVITY_PARTNERS
    ($setOnInsert, certified + invented ratings) and their pe_ac_* partner_events
    (re-stamped to TODAY on every boot via $set). Prod rows are hidden, but the
    seeds were a resurrection vector for any fresh/restored environment. Both are
    removed; this locks the tombstone."""
    src = (BACKEND / "server.py").read_text(encoding="utf-8")
    assert "ACTIVITY_PARTNERS = [" not in src, "fabricated partner seed is back"
    for marker in ("Cartagena Diving Center", "Cartagena Food Tours",
                   "Walking Cartagena", "Aventura Rosario", "bautizo submarino",
                   "cartagenadivers.com", "aventurarosario.co"):
        assert marker not in src, f"fabricated seed content resurfacing: {marker}"
    # seed dicts for the fabricated ids must not exist; pe_ac_* may appear only
    # inside the cleanup migration (unpublish+cancel), never as a seeded event.
    assert '"partner_id": "ptr_ac_' not in src
    assert '"event_id": "pe_ac_' not in src, "fabricated event seed is back"
    assert "unpublish_reason" in src and '"pe_ac_001"' in src  # the cleanup stays


def test_6b_only_earned_verification_ranks() -> None:
    """DROP 6B honesty rail, locked: ranking boosts ride EARNED verification only
    ('verificado', set by the evidence-gated verify-provider action). Seed-stamped
    'reportado' must never branch a rank weight — a `'reportado' ?` ternary inside
    either ranking site is the banned seed-based boost coming back."""
    FRONTEND = BACKEND.parent / "frontend"
    explore = (FRONTEND / "app" / "(tabs)" / "explore.tsx").read_text(encoding="utf-8")
    coll = (FRONTEND / "app" / "collections" / "[key].tsx").read_text(encoding="utf-8")
    for src, name in ((explore, "explore.tsx"), (coll, "collections/[key].tsx")):
        assert "'reportado' ?" not in src, f"{name}: seed-based rank boost reintroduced"
    assert "=== 'verificado' ? 0 : 1" in explore      # bounded in-stream boost
    assert "=== 'verificado' ? 100 : 0" in coll       # earned weight only
    # the cross-category axis stays the FINAL pass (diversity beats boost)
    assert "capConsecutiveByCategory(interleaveByCategory(partners), 2)" in explore


def test_hold_registry_exists_and_publishes_nothing() -> None:
    reg = json.loads((BACKEND / "data" / "activities_registry_5c.json").read_text(encoding="utf-8"))
    names = " ".join(r["name"] for r in reg["rows"]).lower()
    for held in ("colombia4u", "uncover colombia", "travel city", "cultural cartagena"):
        assert held in names, held
    pub_names = {p["name"].lower() for p in PARTNERS}
    for r in reg["rows"]:
        head = r["name"].split("/")[0].split("·")[0].strip().lower()
        if head in ("colombia4u", "uncover colombia", "travel city tours", "cultural cartagena"):
            assert head not in pub_names, f"HOLD row published: {head}"


def test_5b_classes_rows_follow_the_model() -> None:
    """5B: schools + cooking at Reportado; the price-spread exemplar states its spread;
    self-claims stripped; the gateway tag present; the door-conflict row NOT published."""
    by_id = {p["partner_id"]: p for p in PARTNERS}
    for pid in ("ptr_act_nueva_lengua", "ptr_act_centro_catalina"):
        p = by_id[pid]
        assert p["verification"]["status"] == "reportado", pid
        assert "classes" in (p.get("style_tags") or []), pid
        assert p["category"] == "activity" and p["location"]["lat"], pid
        blob = p["description"].lower()
        assert "antes de pagar" in blob, pid
        assert "la mejor escuela" not in blob, pid  # Nueva Lengua's self-claim never ships
    lun = by_id["ptr_V054"]
    assert lun["verification"]["status"] == "reportado"
    assert "classes" in (lun.get("style_tags") or [])
    assert "85" in lun["description"] and "116" in lun["description"], "the spread is the point"
    assert "según la plataforma" in lun["description"]
    # door-conflict and no-door rows stay unpublished
    names = {p["name"].lower() for p in PARTNERS}
    assert "crazy salsa" not in names
    reg = json.loads((BACKEND / "data" / "activities_registry_5c.json").read_text(encoding="utf-8"))
    reg_names = " ".join(r["name"] for r in reg["rows"]).lower()
    for held in ("crazy salsa", "babel", "soma yoga", "tata"):
        assert held in reg_names, held


def test_5c_funnel_public_rows_and_claim_validation() -> None:
    """5C: the public registry projection strips internals; claim intake validates;
    the honeypot swallows bots silently."""
    import activities_funnel as F
    from fastapi import HTTPException as HX
    import pytest as _pt
    rows = F.public_rows()
    assert len(rows) >= 10
    blob = json.dumps(rows, ensure_ascii=False).lower()
    # internal research material NEVER ships publicly: the registry's keys and the
    # concrete research values (addresses, directory names, the client note)
    for internal in ("hold_reason", "\"evidence\"", "einforma", "banco santander",
                     "cliente de phil", "calle 30 #10-151", "flash pack"):
        assert internal not in blob, internal
    for r in rows:
        assert r["id"] and r["name"] and r["reason"]["es"] and r["needed"]["es"], r
        assert "shame" not in json.dumps(r).lower()
    # validation: business name + one contact channel required; shapes enforced
    with _pt.raises(HX):
        F.validate_claim({"business_name": ""})
    with _pt.raises(HX):
        F.validate_claim({"business_name": "X"})  # no contact
    with _pt.raises(HX):
        F.validate_claim({"business_name": "X", "email": "nope"})
    with _pt.raises(HX):
        F.validate_claim({"business_name": "X", "whatsapp": "+57 300 123 4567",
                          "registry_id": "no-such-row"})
    ok = F.validate_claim({"business_name": "Crazy Salsa", "whatsapp": "+57 300 123 4567",
                           "registry_id": "crazy-salsa", "rnt": "12345",
                           "website": "@crazysalsa"})
    assert ok["registry_id"] == "crazy-salsa" and ok["status" if False else "rnt"] == "12345"
    # honeypot: bots fill `company` → accept-and-drop (empty doc, no exception)
    assert F.validate_claim({"business_name": "Bot", "email": "a@b.co", "company": "x"}) == {}
