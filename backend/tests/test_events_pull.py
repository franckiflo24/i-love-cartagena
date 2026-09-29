"""EVENTS-ELITE pull / seed-anchors / enrich / import-legacy (DESIGN.md §6, §7, §13 A/F/L, §15 P/Q/S4/W2).

Fake adapters emit REAL events_sources.make_candidate() candidates; the real events_gate decides.
Covers: insert + re-pull without duplicates (immutable event_id), Spain page rejected and logged,
past dropped, same-source date change → review/date_changed (dates untouched), cross-source date
disagreement → review/conflict, same-page performances, corroboration-only rows, fuzzy dedupe onto
an anchor, cancel markers, umbrella parents, the cursor lease / day rollover / poison skip, dry runs,
anchor seeding that never rewrites sentinel-owned fields, the enrich validator and legacy import.
Pure: no network, no Atlas, never imports server.py.

Run: cd backend && python -m pytest -q tests/test_events_pull.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = os.path.dirname(os.path.abspath(__file__))
for p in (BACKEND, TESTS):
    if p not in sys.path:
        sys.path.insert(0, p)

import events_elite as E  # noqa: E402
import events_gate as G  # noqa: E402
import events_runtime as R  # noqa: E402
import events_sources as S  # noqa: E402
import telegram_alerts as T  # noqa: E402
from events_service_stubs import StubDB, with_event_indexes  # noqa: E402

UTC = timezone.utc
NOW = datetime(2026, 10, 1, 11, 0, tzinfo=UTC)          # 06:00 Bogotá, inside the pull cron hour
FETCHED = "2026-10-01T10:59:00Z"
TB_URL = "https://tuboleta.com/es/eventos/concierto-sinfonico"
LT_URL = "https://latiquetera.com/evento/concierto-sinfonico"
TB = {"key": "tuboleta", "name": "TuBoleta", "tier": 2, "role": "discover"}
LT = {"key": "latiquetera", "name": "La Tiquetera", "tier": 2, "role": "discover"}
IPCC = {"key": "ipcc", "name": "IPCC", "tier": 1, "role": "corroborate"}


def cand(src: Dict[str, Any], *, url: str = TB_URL, native: str = "sinfonico", title: str = "Concierto Sinfónico",
         start: str = "2026-11-12", end: Optional[str] = None, time_: Optional[str] = "19:00",
         venue: Optional[str] = "Teatro Adolfo Mejía", date_text: Optional[str] = None,
         page_text: str = "TuBoleta Colombia · Cartagena de Indias, Bolívar", markers: Optional[Dict[str, Any]] = None,
         parent: Optional[str] = None, umbrella: bool = False, fetched: str = FETCHED) -> Dict[str, Any]:
    dt = date_text or f"{int(start[8:])} de noviembre de {start[:4]} · 7:00 p. m."
    meta = {"url": url, "final_url": url, "fetched_at": fetched, "http_status": 200}
    return S.make_candidate(src, meta, native_id=native, title=title, start_date=start, end_date=end,
                            start_time=time_, time_confirmed=bool(time_), date_text=dt, date_visible=True,
                            event_text=f"{title} · {venue or ''} · {dt} · Cartagena de Indias", page_text=page_text,
                            venue_name=venue, markers=markers, parent_source_key=parent, is_umbrella_hint=umbrella)


class FakeAdapter:
    def __init__(self, items: List[Dict[str, Any]], key: str = "tuboleta", cap: int = 50) -> None:
        self.items = items
        self.key = key
        self.cap = cap
        self.offsets: List[int] = []

    async def pull(self, client: Any, deadline: Any = None, *, offset: int = 0, sched: Any = None,
                   checkpoint: Any = None, now_utc: Any = None) -> S.PullResult:
        self.offsets.append(offset)
        res = S.PullResult(source_key=self.key, offset=offset)
        res.total = len(self.items)
        for i in range(offset, min(len(self.items), offset + self.cap)):
            if checkpoint is not None:
                await checkpoint(i, f"item-{i}")
            res.append(self.items[i])
        nxt = offset + self.cap
        res.next_offset = nxt if nxt < len(self.items) else None
        return res


class FakeClient:
    async def aclose(self) -> None:
        return None


def entry(src: Dict[str, Any], items: List[Dict[str, Any]], **kw: Any) -> Dict[str, Any]:
    return {**src, "enabled": True, "adapter": FakeAdapter(items, key=src["key"], **kw)}


@pytest.fixture(autouse=True)
def _reset(monkeypatch: pytest.MonkeyPatch) -> Dict[str, List[str]]:
    R.invalidate_caches()
    sent: Dict[str, List[str]] = {"alerts": []}

    async def fake_send(text: Any, **_k: Any) -> Dict[str, Any]:
        sent["alerts"].append(str(text))
        return {"configured": False, "sent": 0, "chats": 0, "errors": []}

    monkeypatch.setattr(T, "send", fake_send)
    return sent


def new_db() -> StubDB:
    return asyncio.run(with_event_indexes(StubDB()))


def pull(db: StubDB, registry: List[Dict[str, Any]], *, now: datetime = NOW, **kw: Any) -> Dict[str, Any]:
    return asyncio.run(E.run_pull(db, now=now, source_list=registry, client_factory=FakeClient, run_enrich=False, **kw))


def docs(db: StubDB) -> List[Dict[str, Any]]:
    return db.city_events.rows


def _unlease(db: StubDB) -> None:
    for r in db.city_events_state.rows:
        r.pop("lease_until", None)


# ── insert / re-pull ─────────────────────────────────────────────────────────


def test_new_candidate_is_inserted_geocoded_high_and_notif_eligible() -> None:
    db = new_db()
    out = pull(db, [entry(TB, [cand(TB)])])
    assert out["counts"]["inserted"] == 1 and out["counts"]["published"] == 1 and out["done"] is True
    d = docs(db)[0]
    assert G.EVENT_ID_RE.match(d["event_id"]) and d["event_id"].startswith("ce-concierto-sinfonico-20261112-")
    assert d["canonical_key"] == G.match_key("Concierto Sinfónico", 2026, "Teatro Adolfo Mejía")
    assert d["geocode_source"] == "gazetteer" and d["geo"]["type"] == "Point"
    assert d["country_check"] == "pass" and d["last_verified"] == FETCHED
    assert (d["status"], d["confidence"], d["notif_eligible"]) == ("published", "HIGH", True)
    assert "page_text" not in d
    assert db.city_events_runs.rows[-1]["kind"] == "pull" and db.city_events_runs.rows[-1]["inserted"] == 1
    assert any(lg["to"] == "published" for lg in db.city_events_log.rows)


def test_re_pull_updates_in_place_with_an_immutable_event_id() -> None:
    db = new_db()
    pull(db, [entry(TB, [cand(TB)])])
    eid = docs(db)[0]["event_id"]
    _unlease(db)
    db.city_events_state.rows.clear()
    later = "2026-10-02T10:59:00Z"
    pull(db, [entry(TB, [cand(TB, fetched=later)])], now=NOW + timedelta(days=1))
    assert len(docs(db)) == 1 and docs(db)[0]["event_id"] == eid
    assert docs(db)[0]["last_verified"] == later
    assert len(docs(db)[0]["evidence"]) == 1, "newest evidence per URL (§15 R2)"


def test_spain_page_is_rejected_and_logged_never_stored() -> None:
    db = new_db()
    spain = cand(TB, url="https://www.atrapalo.com/entradas/murcia/cartagena/concierto", venue="Auditorio El Batel",
                 page_text="Auditorio El Batel, Cartagena (Murcia) · desde 25 € · +34 968 000 000")
    out = pull(db, [entry(TB, [spain])])
    assert docs(db) == [] and out["counts"]["dropped_wrong_country"] == 1
    rej = db.city_events_rejects.rows[0]
    assert rej["reason"] == "country_fail" and any(s.startswith("fail:") for s in rej["signals"])
    assert isinstance(rej["at_dt"], datetime), "TTL index needs a BSON date"


def test_past_candidates_are_dropped() -> None:
    db = new_db()
    out = pull(db, [entry(TB, [cand(TB, start="2026-09-20", date_text="20 de septiembre de 2026 · 7:00 p. m.")])])
    assert docs(db) == [] and out["counts"]["dropped_past"] == 1


# ── dates: change, conflict, performances ───────────────────────────────────


def test_same_source_date_change_goes_to_review_and_keeps_the_verified_date(_reset: Any) -> None:
    db = new_db()
    pull(db, [entry(TB, [cand(TB)])])
    db.city_events_state.rows.clear()
    pull(db, [entry(TB, [cand(TB, start="2026-11-19", fetched="2026-10-02T10:59:00Z")])], now=NOW + timedelta(days=1))
    d = docs(db)[0]
    assert len(docs(db)) == 1
    assert (d["status"], d["status_reason"]) == ("review", "date_changed")
    assert d["start_date"] == "2026-11-12" and d["proposed_dates"]["start_date"] == "2026-11-19"
    assert any("2026-11-19" in a for a in _reset["alerts"])


def test_different_sources_with_different_dates_become_one_conflict_row() -> None:
    db = new_db()
    pull(db, [entry(TB, [cand(TB)]),
              entry(LT, [cand(LT, url=LT_URL, start="2026-11-14",
                              date_text="14 de noviembre de 2026 · 7:00 p. m.")])])
    assert len(docs(db)) == 1
    d = docs(db)[0]
    assert (d["status"], d["status_reason"]) == ("review", "conflict")
    assert sorted(d["source_keys"]) == ["latiquetera:sinfonico", "tuboleta:sinfonico"]


def test_two_dates_on_the_same_page_are_distinct_performances() -> None:
    db = new_db()
    a = cand(TB, native="sinf-1112")
    b = cand(TB, native="sinf-1113", start="2026-11-13", date_text="13 de noviembre de 2026 · 7:00 p. m.")
    pull(db, [entry(TB, [a, b])])
    keys = sorted(d["canonical_key"] for d in docs(db))
    base = G.match_key("Concierto Sinfónico", 2026, "Teatro Adolfo Mejía")
    assert keys == [f"{base}|20261112", f"{base}|20261113"]


# ── corroboration / dedupe / markers / umbrella ─────────────────────────────


def test_corroboration_attaches_evidence_and_never_creates_a_row() -> None:
    db = new_db()
    ipcc_url = "https://ipcc.gov.co/programacion-noviembre"
    pull(db, [entry(TB, [cand(TB)]),
              entry(IPCC, [cand(IPCC, url=ipcc_url, native="post#1", title="Concierto Sinfónico en el Teatro",
                                venue=None),
                           cand(IPCC, url=ipcc_url, native="post#2", title="Desfile que no existe",
                                start="2026-11-20", venue=None, date_text="20 de noviembre de 2026")])])
    assert len(docs(db)) == 1
    d = docs(db)[0]
    assert {e["url"] for e in d["evidence"]} == {TB_URL, ipcc_url}
    assert d["source_url"] == TB_URL, "a corroborating page never becomes the primary source"


def test_fuzzy_duplicate_of_an_anchor_is_merged_not_inserted() -> None:
    db = new_db()
    anchor = {"event_id": "ce-festival-de-musica-2026-20261112-aaaa", "canonical_key": "festival de musica 2026|2026|varios",
              "title": {"es": "Festival de Música 2026"}, "start_date": "2026-11-12", "end_date": "2026-11-15",
              "status": "published", "source_keys": ["anchor:fm"], "source_url": "https://ipcc.gov.co/fm",
              "source_tier": 1, "evidence": [], "country_check": "pass", "venue_name": "Varios escenarios · Cartagena"}
    asyncio.run(db.city_events.insert_one(anchor))
    c = cand(TB, native="fm", title="Festival de Música 2026", end="2026-11-15", venue="Varios escenarios",
             umbrella=True, time_=None, date_text="Del 12 al 15 de noviembre de 2026")
    out = pull(db, [entry(TB, [c])])
    assert len(docs(db)) == 1 and out["counts"]["dupes_merged"] == 1
    assert "tuboleta:fm" in docs(db)[0]["source_keys"]


def test_fuzzy_never_merges_across_two_known_venues_but_merges_a_venue_alias() -> None:
    """§0 / §15 R2 b: a same-title, same-date show at ANOTHER venue must not pool its evidence
    into this row (it could lift it to HIGH); a venue alias that geocodes to the same place
    still merges instead of duplicating."""
    db = new_db()
    other = cand(LT, url=LT_URL, native="sinfonico-cc", venue="Centro de Convenciones")
    out = pull(db, [entry(TB, [cand(TB)]), entry(LT, [other])])
    assert len(docs(db)) == 2 and out["counts"]["dupes_merged"] == 0
    by_venue = {d["venue_name"]: d for d in docs(db)}
    assert {e["url"] for e in by_venue["Teatro Adolfo Mejía"]["evidence"]} == {TB_URL}, "no foreign evidence"

    db2 = new_db()
    alias = cand(LT, url=LT_URL, native="sinfonico-heredia", venue="Teatro Heredia")
    out2 = pull(db2, [entry(TB, [cand(TB)]), entry(LT, [alias])])
    assert len(docs(db2)) == 1 and out2["counts"]["dupes_merged"] == 1
    assert {e["url"] for e in docs(db2)[0]["evidence"]} == {TB_URL, LT_URL}


def test_cancel_marker_rejects_new_rows_and_hides_known_ones(_reset: Any) -> None:
    db = new_db()
    out = pull(db, [entry(TB, [cand(TB, markers={"cancel": "cancelado"})])])
    assert docs(db) == [] and out["counts"]["dropped_other"] == 1
    db2 = new_db()
    pull(db2, [entry(TB, [cand(TB)])])
    db2.city_events_state.rows.clear()
    pull(db2, [entry(TB, [cand(TB, markers={"cancel": "aplazado"})])], now=NOW + timedelta(days=1))
    d = docs(db2)[0]
    assert (d["status"], d["status_reason"]) == ("hidden", "cancel_marker")
    assert any("cancelación" in a for a in _reset["alerts"])


def test_children_mark_their_parent_as_umbrella() -> None:
    db = new_db()
    parent = cand(TB, native="festival-2026", title="Festival de Jazz 2026", start="2026-11-10", end="2026-11-15",
                  venue="Varios escenarios", umbrella=True, time_=None, date_text="Del 10 al 15 de noviembre de 2026")
    child = cand(TB, native="jazz-noche-1", title="Noche de Jazz I", parent="tuboleta:festival-2026")
    pull(db, [entry(TB, [parent, child])])
    by_title = {d["title"]["es"]: d for d in docs(db)}
    p, c = by_title["Festival de Jazz 2026"], by_title["Noche de Jazz I"]
    assert p["is_umbrella"] is True and p["lat"] is None and "geo" not in p
    assert c["parent_id"] == p["event_id"] and c["notif_eligible"] is False, "sub-events never push (§15 R5)"


# ── cursor / dry / disabled ──────────────────────────────────────────────────


def test_cursor_done_is_a_noop_until_the_next_bogota_day() -> None:
    db = new_db()
    ad = FakeAdapter([cand(TB)])
    reg = [{**TB, "enabled": True, "adapter": ad}]
    pull(db, reg)
    again = pull(db, reg, now=NOW + timedelta(minutes=5))
    assert again.get("noop") is True and ad.offsets == [0]
    pull(db, reg, now=NOW + timedelta(days=1))
    assert ad.offsets == [0, 0], "a new Bogotá day restarts the sources"


def test_lease_held_skips_and_poison_item_is_skipped_after_a_dead_lease() -> None:
    db = new_db()
    asyncio.run(db.city_events_state.insert_one({"_id": "cursor:pull", "lease_until": "2099-01-01T00:00:00Z"}))
    assert pull(db, [entry(TB, [cand(TB)])]).get("skipped") == "lease_held"
    db = new_db()
    asyncio.run(db.city_events_state.insert_one({"_id": "cursor:pull", "day": "2026-10-01", "idx": 0, "offset": 0,
                                                 "done": False, "lease_until": "2026-10-01T10:00:00Z",
                                                 "inflight": {"idx": 0, "offset": 0, "source": "tuboleta"}}))
    ad = FakeAdapter([cand(TB, native="a"), cand(TB, native="b", title="Otro Concierto")])
    out = pull(db, [{**TB, "enabled": True, "adapter": ad}])
    assert ad.offsets == [1], "the item that killed the dead invocation is skipped"
    assert any(e.startswith("poison_skipped") for e in out["errors"])
    assert [d["title"]["es"] for d in docs(db)] == ["Otro Concierto"]


def test_dry_run_returns_verdicts_and_writes_nothing() -> None:
    db = new_db()
    out = pull(db, [entry(TB, [cand(TB)])], dry=True)
    assert out["dry"] is True and out["candidates"][0]["action"] == "insert"
    assert out["candidates"][0]["country"] == "pass" and out["candidates"][0]["status"] == "published"
    assert docs(db) == [] and db.city_events_runs.rows == [] and db.city_events_state.rows == []


def test_disabled_sources_are_skipped() -> None:
    db = new_db()
    asyncio.run(db.city_events_state.insert_one({"_id": "flags", "enabled": True, "sources_disabled": ["tuboleta"]}))
    ad = FakeAdapter([cand(TB)])
    out = pull(db, [{**TB, "enabled": True, "adapter": ad}])
    assert ad.offsets == [] and docs(db) == [] and out["per_source"][0]["skipped"] == "disabled"


# ── seed-anchors (§6, §15 W2) ────────────────────────────────────────────────

SEED_NOW = datetime(2026, 9, 29, 0, 0, tzinfo=UTC)


def test_seed_anchors_inserts_every_anchor_with_the_gate_verdicts() -> None:
    db = new_db()
    anchors = E.load_anchors()
    rep = asyncio.run(E.seed_anchors(db, now=SEED_NOW))
    assert len(rep["inserted"]) == len(anchors) and rep["errors"] == []
    by_key = {d["anchor_key"]: d for d in docs(db)}
    for a in anchors:
        d = by_key[a["key"]]
        assert G.EVENT_ID_RE.match(d["event_id"]) and d["source_keys"] == [f"anchor:{a['key']}"]
        want = a.get("status_hint") or "published"
        assert d["status"] == want, (a["key"], d["status"], d["status_reason"])
        assert d["country_check"] == "pass" and d["notif_eligible"] is False
        if a.get("parent_key"):
            assert d["parent_id"] == by_key[a["parent_key"]]["event_id"]
    fiestas = by_key["fiestas-independencia-2026"]
    assert fiestas["is_umbrella"] is True and fiestas["lat"] is None
    assert by_key["hay-festival-cartagena-2027"]["confidence"] == "HIGH"
    assert by_key["fiestas-2026-juan-luis-guerra-festival-nautico"]["confidence"] == "VERIFY"


def test_reseed_never_rewrites_sentinel_owned_fields_but_adds_evidence_and_descriptive_updates() -> None:
    db = new_db()
    asyncio.run(E.seed_anchors(db, now=SEED_NOW))
    hay = next(d for d in docs(db) if d["anchor_key"] == "hay-festival-cartagena-2027")
    hay.update(status="hidden", status_reason="cancel_marker", start_date="2027-02-01", confidence="VERIFY",
               last_verified="2026-10-05T00:00:00Z")
    anchors = E.load_anchors()
    a = json.loads(json.dumps(next(x for x in anchors if x["key"] == "hay-festival-cartagena-2027")))
    a["anchor_version"] = a["anchor_version"] + 1
    a["description"]["es"] = "Descripción nueva."
    a["evidence"].append({"url": "https://www.hayfestival.com/cartagena/programa", "name": "Hay", "tier": 1,
                          "fetched_at": "2026-10-04T00:00:00Z", "http_status": 200,
                          "date_text": "del 28 al 31 de enero del 2027", "format": "html"})
    rep = asyncio.run(E.seed_anchors(db, now=SEED_NOW + timedelta(days=6), anchors=[a]))
    assert rep["evidence_added"] == [a["key"]] and rep["descriptive_updated"] == [a["key"]]
    hay = next(d for d in docs(db) if d["anchor_key"] == "hay-festival-cartagena-2027")
    assert (hay["status"], hay["status_reason"], hay["start_date"], hay["confidence"], hay["last_verified"]) == \
        ("hidden", "cancel_marker", "2027-02-01", "VERIFY", "2026-10-05T00:00:00Z")
    assert hay["description"]["es"] == "Descripción nueva."
    assert any(e["url"].endswith("/programa") for e in hay["evidence"])
    again = asyncio.run(E.seed_anchors(db, now=SEED_NOW + timedelta(days=7), anchors=[a]))
    assert again["unchanged"] == [a["key"]], "idempotent"


# ── enrich (§15 S4) ──────────────────────────────────────────────────────────


def _enrich_row(**over: Any) -> Dict[str, Any]:
    d = {"event_id": "ce-concierto-sinfonico-20261112-ab12", "title": {"es": "Concierto Sinfónico 2026"},
         "description": {}, "category": "cultural", "venue_name": "Teatro Adolfo Mejía", "status": "published",
         "origin": "pipeline", "event_text": "Concierto Sinfónico 2026 con la Orquesta de Cartagena en el Teatro Adolfo Mejía.",
         "llm_text_ok": True}
    d.update(over)
    return d


def _complete(answer: Optional[str]) -> Any:
    async def fake(system: str, user: str, **_k: Any) -> Optional[str]:
        assert "Concierto Sinfónico 2026" in user and "descripción interna" not in user.lower()
        return answer
    return fake


def test_enrich_none_changes_nothing_but_counts_the_attempt() -> None:
    db = new_db()
    asyncio.run(db.city_events.insert_one(_enrich_row()))
    rep = asyncio.run(E.run_enrich_batch(db, now=NOW, complete=_complete(None)))
    d = docs(db)[0]
    assert rep["report"][0]["rejected"] == ["llm_none"] and d["enrich_attempts"] == 1
    assert d["title"] == {"es": "Concierto Sinfónico 2026"} and "enriched_at" not in d


def test_enrich_accepts_grounded_text_and_rejects_invented_facts() -> None:
    db = new_db()
    asyncio.run(db.city_events.insert_one(_enrich_row()))
    answer = json.dumps({
        "title": {"en": "Symphonic concert 2026", "fr": "Concert symphonique 2027", "pt": "Concerto sinfônico 2026"},
        "description": {"es": "Una noche con la Orquesta de Cartagena en el Teatro Adolfo Mejía.",
                        "en": "Tickets from $50.000 on 12 November at 7:00 pm.",
                        "fr": "Une soirée avec la Orquesta de Cartagena.",
                        "pt": "Veja em https://exemplo.com"},
        "category": "concert"})
    asyncio.run(E.run_enrich_batch(db, now=NOW, complete=_complete(answer)))
    d = docs(db)[0]
    assert d["title"]["en"] == "Symphonic concert 2026" and d["title"]["pt"] == "Concerto sinfônico 2026"
    assert "fr" not in d["title"], "a translated title must keep the source digits"
    assert d["description"] == {"es": "Una noche con la Orquesta de Cartagena en el Teatro Adolfo Mejía.",
                                "fr": "Une soirée avec la Orquesta de Cartagena."}
    assert d["category"] == "concert"
    assert "enriched_at" in d


@pytest.mark.parametrize("bad,why", [
    ("El 15 de marzo en el teatro.", "digits"),
    ("Cada viernes en el teatro.", "calendar_word"),
    ("Desde las 8:00 en el teatro.", "digits"),
    ("Entradas en pesos colombianos.", "currency"),
    ("Info en www.ejemplo.com hoy.", "url"),
    ("Con la estrella Shakira en escena.", "capitalized_name"),
])
def test_enrich_validator_rejects_anything_not_in_the_source(bad: str, why: str) -> None:
    src = "Concierto Sinfónico con la Orquesta de Cartagena en el Teatro Adolfo Mejía."
    assert E.validate_llm_text(bad, src) == why
    assert E.validate_llm_text("Una noche con la Orquesta de Cartagena.", src) is None


# ── import-legacy (§13 L) ────────────────────────────────────────────────────


def test_import_legacy_takes_only_sourced_short_future_district_rows_as_review() -> None:
    db = new_db()
    base = {"title": "Noche de Tango", "venue_name": "Teatro Adolfo Mejía", "date_start": "2026-11-20",
            "date_end": "2026-11-20", "source": ["https://www.teatroheredia.com/tango"], "category": "music"}

    async def seed() -> None:
        await db.events.insert_one({**base, "event_id": "evt_ok"})
        await db.events.insert_one({**base, "event_id": "evt_nosrc", "source": ["no-url"], "title": "Sin fuente"})
        await db.events.insert_one({**base, "event_id": "evt_rec", "recurring": True, "title": "Salsa semanal"})
        await db.events.insert_one({**base, "event_id": "evt_long", "date_end": "2027-03-01", "title": "Tour largo"})
        await db.events.insert_one({**base, "event_id": "evt_past", "date_start": "2026-01-01", "date_end": "2026-01-01",
                                    "title": "Pasado"})
        await db.events.insert_one({**base, "event_id": "evt_far", "venue_name": "Plaza de Barranquilla",
                                    "location": {"lat": 10.96, "lng": -74.79}, "title": "Carnaval"})

    asyncio.run(seed())
    rep = asyncio.run(E.import_legacy(db, now=NOW))
    assert [r["legacy_id"] for r in rep["imported"]] == ["evt_ok"]
    assert rep["skipped"] == {"no_source": 1, "recurring": 1, "long_span": 1, "past": 1,
                              "outside_or_unknown_district": 1}
    d = docs(db)[0]
    assert (d["status"], d["status_reason"], d["origin"]) == ("review", "legacy_unverified", "legacy-import")
    assert d["evidence"] == [] and d["last_verified"] is None, "nothing we did not fetch counts as verified"
    view = G.public_view(d, NOW, True)
    assert view and view["status"] == "review" and view["start_date"] is None
    again = asyncio.run(E.import_legacy(db, now=NOW))
    assert again["imported"] == [] and again["skipped"].get("conflict_existing_wins") == 1
