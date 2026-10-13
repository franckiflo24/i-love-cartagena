"""DROP 3C-GOV — civic & municipal event ingestion (the Nairo Fest fix, no Meta).

The class that made us miss the Gran Fondo Nairo Fest closing concert (Carlos Vives,
Camellón de los Mártires, 2026-10-11): free civic events with no ticket page and no
JSON-LD. Official/news agenda sources now CREATE review rows — and NOTHING civic ever
auto-publishes: every new row lands review/civic_review (sticky) until a human in
/admin/eventos approves it at the source's tier (1 = OFICIAL, 5 = REPORTADO).

Replay: fixtures/events/eu_nairo_transito_20261007.xml is the VERBATIM El Universal
/cartagena feed item of 2026-10-07 (four days pre-event), which the pipeline polled
and dropped as corroboration_unmatched under the old role. The same item must now
produce a review row.

Run: cd backend && python -m pytest -q tests/test_civic_ingestion.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from typing import Any, Dict

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(TESTS)
for p in (BACKEND, TESTS):
    if p not in sys.path:
        sys.path.insert(0, p)

import events_elite as E  # noqa: E402
import events_gate as G  # noqa: E402
import events_runtime as R  # noqa: E402
import events_sources as S  # noqa: E402
import telegram_alerts as T  # noqa: E402
import test_events_pull as TP  # noqa: E402

NOW = TP.NOW  # 2026-10-01 — frozen PRE-event, so the replay runs "as if" before Oct 11

IPCC_SRC = {"key": "ipcc", "name": "IPCC · Instituto de Patrimonio y Cultura de Cartagena",
            "tier": 1, "role": "discover"}
EU_SRC = {"key": "eluniversal", "name": "El Universal", "tier": 5, "role": "discover"}

FIXTURE = os.path.join(TESTS, "fixtures", "events", "eu_nairo_transito_20261007.xml")
EU_ARTICLE = ("https://www.eluniversal.com.co/cartagena/2026/10/07/"
              "este-es-el-plan-de-manejo-de-transito-para-el-gran-fondo-nairo-fest-2026/")


@pytest.fixture(autouse=True)
def _reset(monkeypatch: pytest.MonkeyPatch) -> Dict[str, Any]:
    R.invalidate_caches()
    sent: Dict[str, Any] = {"alerts": []}

    async def fake_send(text: Any, **_k: Any) -> Dict[str, Any]:
        sent["alerts"].append(str(text))
        return {"configured": False, "sent": 0, "chats": 0, "errors": []}

    monkeypatch.setattr(T, "send", fake_send)
    return sent


# ── registry: who creates, who is civic, who is trimmed ──────────────────────

def test_registry_civic_roles_tiers_and_trims() -> None:
    by_key = {e["key"]: e for e in S.SOURCES}
    ipcc, eu = by_key["ipcc"], by_key["eluniversal"]
    # official primary: creates rows, civic-gated, tier 1 (OFICIAL once approved)
    assert ipcc["role"] == "discover" and ipcc["civic"] is True and ipcc["tier"] == 1
    # news agenda: creates rows, civic-gated, tier 5 (REPORTADO once approved)
    assert eu["role"] == "discover" and eu["civic"] is True and eu["tier"] == 5
    assert S.is_civic_source("ipcc") and S.is_civic_source("eluniversal")
    # ticketers are NOT civic-gated (their flow is unchanged)
    assert not S.is_civic_source("tuboleta") and not S.is_civic_source("latiquetera")
    assert not S.is_civic_source("") and not S.is_civic_source(None)
    # Alcaldía stays behind its bot wall: never crawled, never an adapter
    assert any(h == "cartagena.gov.co" for h in S.NEVER_CRAWL_HOSTS)
    assert "cartagena.gov.co" not in {e["domain"] for e in S.SOURCES}
    # Corpoturismo trimmed ("Sitio en reconstrucción", probed 2026-10-13)
    assert not any("cartagenadeindias.travel" in str(e.get("domain")) for e in S.SOURCES)
    # the sticky contract exists
    assert "civic_review" in G.STICKY_REVIEW_REASONS


# ── behavior: civic rows land review-gated, sticky, approvable ───────────────

def test_civic_insert_lands_review_sticky_until_human_approve() -> None:
    db = TP.new_db()
    c = TP.cand(IPCC_SRC, url="https://ipcc.gov.co/preludio-cultural-localidad-2/",
                native="preludio-l2", title="Preludio Cultural de la Localidad 2",
                venue="Plaza de la Paz", page_text="IPCC · Cartagena de Indias, Bolívar")
    TP.pull(db, [TP.entry(IPCC_SRC, [c])])
    rows = TP.docs(db)
    assert len(rows) == 1
    d = rows[0]
    assert d["status"] == "review" and d["status_reason"] == "civic_review"
    assert d["confidence"] == "VERIFY" and d["notif_eligible"] is False
    assert d["source_tier"] == 1 and d["source_key"] == "ipcc"
    # sticky: a later evaluate() must NOT flip it live on its own
    ev = G.evaluate(d, NOW)
    assert ev["status"] == "review" and ev["status_reason"] == "civic_review"
    # the human path still works: approve publishes at the source's tier
    res = asyncio.run(E.approve_event(db, d["event_id"], actor="admin:t", now=NOW))
    assert res["status"] == "published"


def test_probation_outranks_civic_reason_but_both_hold() -> None:
    """A civic source ALSO on 3B probation stays held — reason reads source_probation
    (the flag check runs first); either way it is sticky review."""
    db = TP.new_db()
    asyncio.run(db.city_events_state.update_one(
        {"_id": "flags"}, {"$set": {"enabled": True, "review_only_sources": ["ipcc"]}}, upsert=True))
    R.invalidate_caches()
    TP.pull(db, [TP.entry(IPCC_SRC, [TP.cand(IPCC_SRC, url="https://ipcc.gov.co/x/", native="x",
                                             title="Noche de Museos")])])
    d = TP.docs(db)[0]
    assert d["status"] == "review"
    assert d["status_reason"] in ("source_probation", "civic_review")
    assert d["status_reason"] in G.STICKY_REVIEW_REASONS


def test_non_civic_discover_source_still_publishes_gate_clean() -> None:
    """The ticketing lanes are untouched: a gate-clean TuBoleta insert still publishes."""
    db = TP.new_db()
    TP.pull(db, [TP.entry(TP.TB, [TP.cand(TP.TB)])])
    assert TP.docs(db)[0]["status"] == "published"


# ── the Nairo Fest replay ────────────────────────────────────────────────────

def test_replay_nairo_fest_feed_item_becomes_a_review_row() -> None:
    """Had this run before Oct 11: the REAL 2026-10-07 El Universal feed item (verbatim
    fixture) must parse into candidates and land in the review queue with the source
    link — never published, never a fabricated pin."""
    xml = open(FIXTURE, encoding="utf-8").read()
    cands, _skips = S.parse_agenda_feed("eluniversal", xml, "2026-10-07T17:00:00Z", 200)
    assert cands, "the pre-event article produced no candidates"
    in_window = [c for c in cands
                 if str(c.get("start_date") or "") >= "2026-10-07"
                 and str(c.get("start_date") or "") <= "2026-10-12"]
    assert in_window, [c.get("start_date") for c in cands]
    assert all(c.get("source_url") == EU_ARTICLE for c in cands)

    db = TP.new_db()
    TP.pull(db, [TP.entry(EU_SRC, cands)], now=NOW)
    rows = TP.docs(db)
    assert rows, "no review row was created"
    for d in rows:
        # review-gated, never auto-published, tier carried for the REPORTADO badge
        assert d["status"] == "review", (d["status"], d.get("status_reason"))
        assert d["status_reason"] in G.STICKY_REVIEW_REASONS, d["status_reason"]
        assert d["source_tier"] == 5 and d["source_key"] == "eluniversal"
        assert d["source_url"] == EU_ARTICLE  # the citable public record
        assert d["notif_eligible"] is False
        # honesty rails: no verifiable coords in a news article → no invented pin
        assert not d.get("lat") and not d.get("lng")
    assert any("nairo" in str(d.get("title")).lower() for d in rows)
