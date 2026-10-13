"""DROP 5A — activities verification: Reportado at seed, Verified only when earned.

Pure-gate tests for the promote action + seed-data rails. The endpoints themselves
are operator-token writes proven live (grant-admin precedent)."""
from __future__ import annotations

import json
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
    # demo-era rows lost the unearned seal
    for pid in ("ptr_ac_001", "ptr_ac_002", "ptr_ac_004"):
        p = next(x for x in PARTNERS if x["partner_id"] == pid)
        assert p.get("is_certified") is False, pid
    # dedup rail: the tagged existing records are THE records (no ptr_act_ twin)
    for existing, name in (("ptr_X1086", "Diving Planet"), ("ptr_V055", "Beyond Colombia")):
        twins = [p["partner_id"] for p in PARTNERS
                 if p["partner_id"].startswith("ptr_act_") and name.lower() in p["name"].lower()]
        assert twins == [], f"{existing} twinned by {twins}"


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
