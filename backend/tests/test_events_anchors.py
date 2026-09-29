"""EVENTS-ELITE anchors + gazetteer: schema and honesty checks (DESIGN §2, §6, §13, §15 P/Q/R/W).

Pure tests: they read backend/data/events_anchors.json and backend/data/events_gazetteer.json only.
No network, no Mongo, never imports server.py.

When backend/events_gate.py exists (core builder), the last block also runs every anchor through
country_check() and evaluate(); until then those tests are skipped.

Run:  cd backend && python -m pytest -q tests/test_events_anchors.py
"""
import json
import math
import os
import re
import sys
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

DATA = os.path.join(BACKEND, "data")
with open(os.path.join(DATA, "events_anchors.json"), encoding="utf-8") as _f:
    ANCHORS_FILE: Dict[str, Any] = json.load(_f)
ANCHORS: List[Dict[str, Any]] = ANCHORS_FILE["anchors"]
with open(os.path.join(DATA, "events_gazetteer.json"), encoding="utf-8") as _f:
    GAZ: List[Dict[str, Any]] = json.load(_f)

BY_KEY = {a["key"]: a for a in ANCHORS}
GAZ_BY_ID = {g["id"]: g for g in GAZ}

# The day the anchors were re-verified against their sources. Nothing may be dated before it (§15 W, task brief).
CUTOFF = "2026-09-28"
LANGS = ("es", "en", "fr", "pt")
CATEGORIES = {"concert", "festival", "cultural", "nightlife", "gastronomic", "sports", "family", "civic"}
TIERS = {1, 2, 3, 4, 5, 6}
YMD = re.compile(r"^\d{4}-\d{2}-\d{2}$")
HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
KEY_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
ISO_Z = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

# §15 Q5 geo box + Turbaco/Arjona exclusion + placeholder list (tolerance 1e-3)
BOX_LAT = (10.10, 10.62)
BOX_LNG = (-75.82, -75.42)
PLACEHOLDERS = [(10.4236, -75.5483), (10.3932277, -75.4832311), (10.3910, -75.4794), (10.3997, -75.5144)]

MONTHS = {
    1: ("enero", "january", "ene", "jan"), 2: ("febrero", "february", "feb"), 3: ("marzo", "march", "mar"),
    4: ("abril", "april", "abr", "apr"), 5: ("mayo", "may"), 6: ("junio", "june", "jun"),
    7: ("julio", "july", "jul"), 8: ("agosto", "august", "ago", "aug"), 9: ("septiembre", "september", "sep", "sept"),
    10: ("octubre", "october", "oct"), 11: ("noviembre", "november", "nov"), 12: ("diciembre", "december", "dic", "dec"),
}

REQUIRED_FIELDS = {
    "key": str, "anchor_version": int, "origin": str, "title": dict, "description": dict, "category": str,
    "flagship": bool,
    "start_date": (str, type(None)), "end_date": (str, type(None)), "start_time": (str, type(None)),
    "end_time": (str, type(None)), "time_confirmed": bool, "edition_year": int, "venue_name": str,
    "address": (str, type(None)), "date_tbc_note": (dict, type(None)), "tbc_window_end": (str, type(None)),
    "parent_key": (str, type(None)), "is_umbrella": bool, "price": dict, "ticket_url": (str, type(None)),
    "source_url": str, "source_name": str, "source_tier": int, "recheck_url": str, "source_keys": list,
    "evidence": list,
}


# ── helpers ──────────────────────────────────────────────────────────────────────
def _is_http(u: Optional[str]) -> bool:
    return isinstance(u, str) and re.match(r"^https?://[^\s/]+\.[^\s/]+", u) is not None


def _is_pdf(u: str) -> bool:
    return u.lower().split("?")[0].endswith(".pdf")


def _date(s: str) -> date:
    y, m, d = map(int, s.split("-"))
    return date(y, m, d)


def _mentions(text: str, ymd: str) -> bool:
    """True when `text` names the day number and the month of `ymd` (no year needed: the sources often omit it)."""
    d = _date(ymd)
    low = text.lower()
    month_ok = any(re.search(rf"(?<![a-záéíóúñ]){m}(?![a-záéíóúñ])", low) for m in MONTHS[d.month])
    day_ok = re.search(rf"(?<![\d:.]){d.day:d}(?![\d:])|(?<![\d:.])0{d.day:d}(?![\d:])", low) is not None
    return month_ok and day_ok


def _days_mentioned(text: str) -> Set[int]:
    return {int(x) for x in re.findall(r"(?<![\d:.])(\d{1,2})(?![\d:])", text) if 1 <= int(x) <= 31}


def _html_ev(a: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [e for e in a["evidence"] if e.get("format", "html") == "html"]


def _official(a: Dict[str, Any]) -> List[Dict[str, Any]]:
    return [e for e in a["evidence"] if e["tier"] <= 3]


def _digits(s: str) -> Set[str]:
    return set(re.findall(r"\d+", s))


# ── anchors: schema ──────────────────────────────────────────────────────────────
def test_anchor_file_is_a_nonempty_list():
    assert isinstance(ANCHORS, list) and len(ANCHORS) >= 6


@pytest.mark.parametrize("a", ANCHORS, ids=lambda a: a.get("key", "?"))
def test_anchor_required_fields_and_types(a):
    for field, typ in REQUIRED_FIELDS.items():
        assert field in a, f"{a.get('key')}: missing {field}"
        assert isinstance(a[field], typ), f"{a['key']}: {field} has type {type(a[field]).__name__}"
    assert a["origin"] == "anchor"
    assert a["anchor_version"] >= 1
    assert KEY_RE.match(a["key"]) and len(a["key"]) <= 80, a["key"]
    assert not a["key"].startswith(("evt_", "pe_", "evt-", "pe-"))
    assert a["source_keys"] == [f"anchor:{a['key']}"]
    assert a["category"] in CATEGORIES
    assert 1 <= a["source_tier"] <= 3, "an anchor's primary source must be tier 1–3"
    assert a["venue_name"].strip()


def test_anchor_keys_unique():
    keys = [a["key"] for a in ANCHORS]
    assert len(keys) == len(set(keys))
    sk = [k for a in ANCHORS for k in a["source_keys"]]
    assert len(sk) == len(set(sk))


@pytest.mark.parametrize("a", ANCHORS, ids=lambda a: a["key"])
def test_anchor_l4_text(a):
    for f in ("title", "description"):
        assert set(a[f]) == set(LANGS), f"{a['key']}.{f} must carry exactly es/en/fr/pt"
        for lang in LANGS:
            assert isinstance(a[f][lang], str) and a[f][lang].strip(), f"{a['key']}.{f}.{lang} empty"
    # §15 S4: title translations keep every digit
    es_digits = _digits(a["title"]["es"])
    for lang in LANGS:
        assert _digits(a["title"][lang]) == es_digits, f"{a['key']}: title.{lang} changes digits"
    # our own short rewrite: no dates/prices/times that could go stale → no digit that is not in the title
    for lang in LANGS:
        desc = a["description"][lang]
        assert len(desc) <= 200, f"{a['key']}: description.{lang} too long"
        assert _digits(desc) <= es_digits, f"{a['key']}: description.{lang} carries digits {_digits(desc) - es_digits}"
        for e in a["evidence"]:
            assert desc not in e["date_text"], f"{a['key']}: description.{lang} copies the source verbatim"


@pytest.mark.parametrize("a", ANCHORS, ids=lambda a: a["key"])
def test_anchor_dates_and_times(a):
    tbc = a.get("status_hint") == "date_tbc"
    if tbc:
        assert a["start_date"] is None and a["end_date"] is None
        note = a["date_tbc_note"]
        assert isinstance(note, dict) and set(note) == set(LANGS)
        assert a["tbc_window_end"] and YMD.match(a["tbc_window_end"])
        assert a["tbc_window_end"] >= CUTOFF
    else:
        assert YMD.match(a["start_date"]) and YMD.match(a["end_date"]), a["key"]
        _date(a["start_date"]), _date(a["end_date"])  # real calendar dates
        assert a["start_date"] <= a["end_date"]
        assert a["start_date"] >= CUTOFF and a["end_date"] >= CUTOFF, f"{a['key']} is dated before {CUTOFF}"
        assert a["date_tbc_note"] is None and a["tbc_window_end"] is None
        assert a["edition_year"] in {int(a["start_date"][:4]), int(a["end_date"][:4])}
    for t in ("start_time", "end_time"):
        assert a[t] is None or HHMM.match(a[t]), f"{a['key']}.{t}={a[t]!r}"
        assert a[t] not in {"00:00", "01:00", "07:00"}, f"{a['key']}.{t} is a placeholder time (§15 S1)"
    # time_confirmed is true only when visible text states the time, and then a time must be set
    if a["start_time"] is None:
        assert a["time_confirmed"] is False
    if a["end_time"] is not None:
        assert a["start_time"] is not None


@pytest.mark.parametrize("a", ANCHORS, ids=lambda a: a["key"])
def test_anchor_price_ticket_and_hints(a):
    p = a["price"]
    assert set(p) == {"is_free", "min_cop", "max_cop", "text"}
    assert p["is_free"] in (None, True, False)
    if p["is_free"] is True:
        # §2/§15 R6: only when a first-party page says free for the event
        ev_text = " ".join(e["date_text"] for e in _official(a)).lower() + " " + (p["text"] or "").lower()
        assert re.search(r"gratis|entrada libre|sin costo", ev_text), f"{a['key']}: is_free without a first-party 'gratis'"
    for k in ("min_cop", "max_cop"):
        assert p[k] is None or (isinstance(p[k], int) and p[k] >= 0)
    assert a["ticket_url"] is None or _is_http(a["ticket_url"])
    assert a.get("status_hint") in (None, "review", "date_tbc")
    if a.get("status_hint") == "review":
        assert a.get("status_reason_hint") == "conflict"
        assert a.get("hint_note")
    else:
        assert a.get("status_reason_hint") is None
    assert a.get("confidence_cap") in (None, "VERIFY")


# ── anchors: sources & evidence (the honesty spine) ─────────────────────────────
@pytest.mark.parametrize("a", ANCHORS, ids=lambda a: a["key"])
def test_anchor_source_is_html_page_with_verbatim_evidence(a):
    assert _is_http(a["source_url"]) and not _is_pdf(a["source_url"]), f"{a['key']}: source_url must be an HTML page"
    assert _is_http(a["recheck_url"]) and not _is_pdf(a["recheck_url"]), f"{a['key']}: recheck_url must be HTML (§15 W3)"
    evs = a["evidence"]
    assert 1 <= len(evs) <= 6
    urls = [e["url"] for e in evs]
    assert len(urls) == len(set(urls)), f"{a['key']}: one evidence entry per URL"
    for e in evs:
        for f in ("url", "name", "tier", "fetched_at", "http_status", "date_text"):
            assert f in e, f"{a['key']}: evidence missing {f}"
        assert _is_http(e["url"])
        assert e["tier"] in TIERS
        assert ISO_Z.match(e["fetched_at"]) and e["fetched_at"][:10] >= CUTOFF
        assert e["http_status"] == 200
        assert isinstance(e["date_text"], str) and len(e["date_text"].strip()) >= 8
        assert e.get("format", "html") in ("html", "pdf-image")
        if e.get("format") == "pdf-image":
            # §13 G: image-only PDFs are evidence only, rechecked by HEAD
            assert _is_pdf(e["url"]) and e.get("recheck") == "head"
            assert e.get("etag") and e.get("last_modified") and isinstance(e.get("content_length"), int)
        else:
            assert not _is_pdf(e["url"])
    fetched = [e["fetched_at"] for e in evs]
    assert fetched == sorted(fetched, reverse=True), f"{a['key']}: evidence must be newest first"
    # the primary source is itself an evidence page, and it is official (tier ≤ 3)
    src = [e for e in _html_ev(a) if e["url"] == a["source_url"]]
    assert src, f"{a['key']}: source_url has no evidence entry"
    assert src[0]["tier"] == a["source_tier"] <= 3


@pytest.mark.parametrize("a", ANCHORS, ids=lambda a: a["key"])
def test_pdf_structured_dates_match_their_transcription(a):
    """Image-PDF evidence carries start/end_date normalised from its own verbatim transcription, so the gate can
    see a PDF-vs-HTML conflict. They must never say more than the transcription does."""
    for e in a["evidence"]:
        if e.get("format") != "pdf-image":
            continue
        assert YMD.match(e["start_date"]) and YMD.match(e["end_date"]) and e["start_date"] <= e["end_date"]
        assert e.get("date_source") == "pdf-image-transcription"
        assert _mentions(e["date_text"], e["start_date"]) and _mentions(e["date_text"], e["end_date"]), a["key"]
        assert _days_mentioned(e["date_text"]) >= {_date(e["start_date"]).day, _date(e["end_date"]).day}


@pytest.mark.parametrize("a", [a for a in ANCHORS if a.get("status_hint") is None], ids=lambda a: a["key"])
def test_published_anchor_dates_are_stated_by_its_source_page(a):
    src = [e for e in _html_ev(a) if e["url"] == a["source_url"]][0]
    assert _mentions(src["date_text"], a["start_date"]), f"{a['key']}: source quote does not state {a['start_date']}"
    if a["end_date"] != a["start_date"]:
        assert any(_mentions(e["date_text"], a["end_date"]) for e in _official(a)), \
            f"{a['key']}: no official quote states the end date {a['end_date']}"
    # no official source contradicts the start day in a single-day row
    if a["start_date"] == a["end_date"] and not a["is_umbrella"]:
        d = _date(a["start_date"]).day
        for e in _official(a):
            assert d in _days_mentioned(e["date_text"]), f"{a['key']}: {e['url']} quotes another day"


@pytest.mark.parametrize("a", [a for a in ANCHORS if a.get("status_hint") == "review"], ids=lambda a: a["key"])
def test_review_anchor_carries_both_sides_of_the_conflict(a):
    official = [e for e in a["evidence"] if e["tier"] == 1]
    assert any(_mentions(e["date_text"], a["start_date"]) for e in official), f"{a['key']}: stored date unsupported"
    d = _date(a["start_date"]).day
    assert any(d not in _days_mentioned(e["date_text"]) and _days_mentioned(e["date_text"]) for e in official), \
        f"{a['key']}: review/conflict without the conflicting official quote"


# ── anchors: the §6 / §15 W minimum set ──────────────────────────────────────────
def _find(pred) -> Dict[str, Any]:
    hits = [a for a in ANCHORS if pred(a)]
    assert len(hits) == 1, f"expected exactly one anchor, got {[h['key'] for h in hits]}"
    return hits[0]


def test_minimum_set_festivals():
    cmf = _find(lambda a: "cartagenamusicfestival.com" in a["source_url"])
    assert (cmf["start_date"], cmf["end_date"]) == ("2027-01-09", "2027-01-17")
    hay = _find(lambda a: "hayfestival.com" in a["source_url"])
    assert hay["source_url"].rstrip("/").endswith("/cartagena/inicio")
    assert (hay["start_date"], hay["end_date"]) == ("2027-01-28", "2027-01-31")
    assert any("del 28 al 31 de enero del 2027" in e["date_text"] for e in hay["evidence"])
    ficci = _find(lambda a: "ficcifestival.com" in a["source_url"])
    assert (ficci["start_date"], ficci["end_date"]) == ("2027-04-06", "2027-04-11")
    assert "66" in ficci["title"]["es"]
    im = _find(lambda a: "ironman.com" in a["source_url"])
    assert "cartagena" in im["source_url"] and im["start_date"] == im["end_date"] == "2026-11-29"
    assert im["start_time"] is None  # §15 S1: ironman is date-only
    assert im["price"]["is_free"] is None  # never from JSON-LD isAccessibleForFree


def test_minimum_set_fiestas():
    umb = _find(lambda a: a["is_umbrella"] and a["key"].startswith("fiestas-independencia-2026"))
    kids = [a for a in ANCHORS if a["parent_key"] == umb["key"]]
    assert len(kids) >= 5
    for k in kids:
        assert umb["start_date"] <= k["start_date"] <= k["end_date"] <= umb["end_date"], k["key"]
    bando = _find(lambda a: a["parent_key"] == umb["key"] and "Gran Desfile" in a["title"]["es"])
    assert bando["start_date"] == "2026-11-12"
    assert bando["start_time"] is None and bando["time_confirmed"] is False  # §15 W1
    assert bando["venue_gazetteer_id"] is None or GAZ_BY_ID[bando["venue_gazetteer_id"]]["lat"] is None  # route
    nautico = _find(lambda a: a["parent_key"] == umb["key"] and "Náutico" in a["title"]["es"] and "Guerra" not in a["title"]["es"])
    assert (nautico["start_date"], nautico["end_date"]) == ("2026-11-13", "2026-11-14")
    assert all("Guerra" not in t for t in nautico["title"].values())  # §15 W1: never in the Náutico title
    jlg = _find(lambda a: a["parent_key"] == umb["key"] and "Juan Luis Guerra" in a["title"]["es"])
    assert jlg["start_date"] == "2026-11-13" and jlg["confidence_cap"] == "VERIFY"
    assert jlg["start_time"] is None and jlg["status_hint"] is None
    assert jlg.get("recent_confirmation_days") == 7  # §15 W1, enforced by events_gate.evaluate
    for a in ANCHORS:
        rcd = a.get("recent_confirmation_days")
        assert rcd is None or (isinstance(rcd, int) and not isinstance(rcd, bool) and rcd > 0), a["key"]
    getsemani = _find(lambda a: a["parent_key"] == umb["key"] and "Getsemaní" in a["title"]["es"])
    assert getsemani["status_hint"] == "review" and getsemani["status_reason_hint"] == "conflict"
    texts = " | ".join(e["date_text"] for e in getsemani["evidence"])
    assert "14 de noviembre" in texts and "15 de noviembre" in texts


def test_umbrella_flags_and_parents():
    parents = {a["parent_key"] for a in ANCHORS if a["parent_key"]}
    for a in ANCHORS:
        if a["parent_key"]:
            assert a["parent_key"] in BY_KEY, f"{a['key']}: unknown parent"
            assert BY_KEY[a["parent_key"]]["is_umbrella"] is True
            assert not a["is_umbrella"], "no nested umbrellas"
        # §15 P3: is_umbrella is true exactly when a child references the row
        assert a["is_umbrella"] == (a["key"] in parents), a["key"]
        if a["is_umbrella"]:
            assert a.get("venue_gazetteer_id") is None, "umbrellas are never geocoded (§15 R5)"


def test_nothing_is_notifiable_from_the_seed():
    """§15 R5: notif needs start_time + time_confirmed. No anchor carries a confirmed time today."""
    for a in ANCHORS:
        if a["start_time"] is not None:
            assert a["time_confirmed"] is True and a["source_tier"] <= 3, a["key"]


# ── gazetteer ───────────────────────────────────────────────────────────────────
def _norm(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def test_gazetteer_schema_and_unique_names():
    assert len(GAZ) >= 12
    ids = [g["id"] for g in GAZ]
    assert len(ids) == len(set(ids))
    seen: Dict[str, str] = {}
    for g in GAZ:
        assert KEY_RE.match(g["id"])
        assert isinstance(g["name"], str) and g["name"].strip()
        assert isinstance(g["aliases"], list) and all(isinstance(x, str) and x.strip() for x in g["aliases"])
        assert isinstance(g["ambiguous"], bool)
        assert g["kind"] in {"venue", "square", "park", "street", "pier", "route", "water", "area", "unresolved"}
        assert _is_http(g["citation_url"])
        for n in [g["name"], *g["aliases"]]:
            k = _norm(n)
            assert k not in seen or seen[k] == g["id"], f"name {n!r} maps to both {seen.get(k)} and {g['id']}"
            seen[k] = g["id"]


@pytest.mark.parametrize("g", GAZ, ids=lambda g: g["id"])
def test_gazetteer_coordinates(g):
    lat, lng = g["lat"], g["lng"]
    if lat is None or lng is None:
        assert lat is None and lng is None
        assert g["source"] is None, "no coordinates → no coordinate source"
        assert g["kind"] in {"route", "water", "area", "unresolved"}, f"{g['id']}: a point venue without coordinates"
        assert g.get("note"), f"{g['id']}: say why there are no coordinates"
        return
    assert g["kind"] != "unresolved"
    assert isinstance(lat, float) and isinstance(lng, float)
    assert BOX_LAT[0] <= lat <= BOX_LAT[1] and BOX_LNG[0] <= lng <= BOX_LNG[1], f"{g['id']} outside the Distrito box"
    assert not (lat < 10.36 and lng > -75.47), f"{g['id']} falls in the Turbaco/Arjona exclusion"
    for plat, plng in PLACEHOLDERS:
        assert max(abs(lat - plat), abs(lng - plng)) >= 1e-3, f"{g['id']} sits on placeholder {plat},{plng}"
        assert math.hypot(lat - plat, lng - plng) >= 1e-3
    # precision: a real geocode, not a rounded city centroid
    assert len(repr(lat).split(".")[1]) >= 4 and len(repr(lng).split(".")[1]) >= 4
    assert g["source"] in {"catalog", "osm"}
    if g["source"] == "osm":
        assert re.match(r"^https://www\.openstreetmap\.org/(node|way|relation)/\d+$", g["citation_url"])
    else:
        assert g["citation_url"] == "https://www.amocartagena.co/data/partners.json"
        assert g.get("catalog_id")
        cc = g.get("crosscheck") or {}
        assert cc.get("osm_url", "").startswith("https://www.openstreetmap.org/")
        assert cc.get("distance_m") is not None and cc["distance_m"] < 100, "catalog point disagrees with OSM"


def test_gazetteer_routes_and_bays_are_never_points():
    for needle in ("avenida santander", "bahia"):
        rows = [g for g in GAZ if needle in _norm(g["name"])]
        assert rows, needle
        for g in rows:
            assert g["lat"] is None and g["lng"] is None, f"{g['id']} must not be a single point"


def test_gazetteer_covers_common_venues():
    want = ["centro de convenciones", "teatro adolfo mejia", "plaza de la aduana", "plaza de toros",
            "estadio jaime moron", "coliseo bernardo caraballo", "plaza de la trinidad", "camellon de los martires",
            "muelle de la bodeguita", "castillo san felipe", "plaza de san pedro claver", "parque de la marina",
            "calle del arsenal", "plaza de los coches"]
    names = [_norm(n) for g in GAZ for n in [g["name"], *g["aliases"]]]
    for w in want:
        assert any(w in n for n in names), f"gazetteer lacks {w}"


def test_gazetteer_flags_nationwide_generic_names_as_ambiguous():
    """Names every Colombian city has must never count, alone, as proof the event is in Cartagena (§0)."""
    generic = ["plaza de bolivar", "plaza de toros", "centro de convenciones", "plaza de la aduana",
               "parque de la marina", "plaza de santo domingo"]
    for w in generic:
        rows = [g for g in GAZ if any(_norm(n) == w for n in [g["name"], *g["aliases"]])
                or _norm(g["name"]).startswith(w)]
        assert rows, w
        for g in rows:
            assert g["ambiguous"] is True, f"{g['id']} carries the generic name {w!r} but is not flagged ambiguous"


def test_gazetteer_covers_task_venue_list_including_unresolved():
    """Baluarte San Miguel is named by the official agenda but has no catalog/OSM point: listed, never geocoded."""
    rows = [g for g in GAZ if "baluarte san miguel" in _norm(g["name"])]
    assert len(rows) == 1 and rows[0]["lat"] is None and rows[0]["kind"] == "unresolved"


def test_anchor_venues_resolve_in_gazetteer():
    for a in ANCHORS:
        gid = a.get("venue_gazetteer_id")
        multi = a["is_umbrella"] or a["venue_name"].startswith(("Varios", "Recorrido")) or " y " in a["venue_name"]
        if multi:
            assert gid is None, f"{a['key']}: a multi-venue row must not be geocoded"
        if gid is None:
            continue
        g = GAZ_BY_ID[gid]
        assert _norm(a["venue_name"]) in {_norm(n) for n in [g["name"], *g["aliases"]]}, a["key"]


# ── integration with the core gate (runs once backend/events_gate.py exists) ────
def _gate():
    return pytest.importorskip("events_gate", reason="backend/events_gate.py not built yet (core builder)")


NOW = datetime(2026, 9, 29, 0, 0, tzinfo=timezone.utc)  # 2026-09-28 19:00 Bogotá


def _candidate(a: Dict[str, Any]) -> Dict[str, Any]:
    g = GAZ_BY_ID.get(a.get("venue_gazetteer_id") or "", {})
    src = [e for e in _html_ev(a) if e["url"] == a["source_url"]][0]
    return {
        "source_url": a["source_url"],
        "page_text": "\n".join(e["date_text"] for e in _html_ev(a) if e["url"] == a["source_url"]),
        "event_text": f"{a['title']['es']}\n{a['venue_name']}\n{src['date_text']}",
        "ld_location": {}, "tz_offset": None, "currency": None, "country_iso": None,
        "venue_name": a["venue_name"], "address": a["address"],
        "lat": g.get("lat"), "lng": g.get("lng"),
    }


def _seeded_doc(a: Dict[str, Any]) -> Dict[str, Any]:
    """The doc seed-anchors is expected to insert. confidence_cap and recent_confirmation_days are KEPT:
    events_gate.evaluate() reads both from the stored doc (§15 W1)."""
    g = GAZ_BY_ID.get(a.get("venue_gazetteer_id") or "", {})
    geocoded = g.get("lat") is not None
    now_iso = NOW.strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        **{k: v for k, v in a.items() if k not in ("key", "status_hint", "status_reason_hint", "hint_note")},
        "status": a.get("status_hint") or "published",
        "status_reason": a.get("status_reason_hint"),
        "confidence": a.get("confidence_cap") or "HIGH",
        "country_check": "pass", "country_signals": ["anchor"],
        "last_verified": now_iso, "verified_by": "manual",
        "lat": g.get("lat"), "lng": g.get("lng"),
        "geocode_source": "gazetteer" if geocoded else None,
        "parent_id": a["parent_key"], "notif_eligible": False, "sold_out": a.get("sold_out", False),
        "created_at": now_iso, "updated_at": now_iso,
    }


@pytest.mark.parametrize("a", ANCHORS, ids=lambda a: a["key"])
def test_gate_country_check_passes_every_anchor(a):
    gate = _gate()
    verdict, signals = gate.country_check(_candidate(a))
    assert verdict == "pass", f"{a['key']}: country_check → {verdict} {signals}"


@pytest.mark.parametrize("a", ANCHORS, ids=lambda a: a["key"])
def test_gate_evaluate_gives_expected_status(a):
    gate = _gate()
    out = gate.evaluate(_seeded_doc(a), NOW)
    want = a.get("status_hint") or "published"
    assert out["status"] == want, f"{a['key']}: evaluate → {out}"
    assert out["notif_eligible"] is False, f"{a['key']}: no seeded anchor has a confirmed time (§15 R5)"
    if want == "review":
        assert out["status_reason"] == "conflict", f"{a['key']}: {out}"  # sticky (§15 R1)
    if a.get("confidence_cap") == "VERIFY" or want != "published":
        assert out["confidence"] == "VERIFY", f"{a['key']}: {out}"


@pytest.mark.parametrize("a", [a for a in ANCHORS if a.get("status_hint") == "review"], ids=lambda a: a["key"])
def test_gate_catches_every_conflict_even_if_the_seed_ignored_the_hint(a):
    """Defence in depth: seeded as a plain published row, the conflicting evidence alone must still send
    the row to review/conflict (it must never publish a date an official source contradicts)."""
    gate = _gate()
    doc = {**_seeded_doc(a), "status": "published", "status_reason": None}
    out = gate.evaluate(doc, NOW)
    assert (out["status"], out["status_reason"]) == ("review", "conflict"), f"{a['key']}: {out}"


def test_gate_parses_every_html_source_quote_to_the_anchor_dates():
    """Each published anchor's primary quote parses (with the gate's own parser) inside its range, at least one
    official HTML quote parses exactly to start_date (so §15 R2(a) can reach HIGH), and no HTML quote parses
    outside the range (that would read as a conflict)."""
    gate = _gate()
    for a in ANCHORS:
        if a.get("status_hint") is not None:
            continue
        src = [e for e in _html_ev(a) if e["url"] == a["source_url"]][0]
        p = gate.parse_date_text(src["date_text"], a["edition_year"])
        assert p and a["start_date"] <= p["start_date"] <= a["end_date"], f"{a['key']}: source quote → {p}"
        exact = [e for e in _html_ev(a) if e["tier"] <= 3
                 and (gate.parse_date_text(e["date_text"], a["edition_year"]) or {}).get("start_date") == a["start_date"]]
        assert exact, f"{a['key']}: no official HTML quote parses to {a['start_date']}"
        for e in _html_ev(a):
            q = gate.parse_date_text(e["date_text"], a["edition_year"])
            if q:
                assert a["start_date"] <= q["start_date"] <= a["end_date"], f"{a['key']}: {e['url']} → {q}"


def test_gate_geocodes_anchor_venues_from_the_gazetteer():
    """Format contract with events_gate.geocode(): point rows resolve to their own coordinates; routes, bays
    and unresolved venues never resolve (no coordinates are ever invented)."""
    gate = _gate()
    for a in ANCHORS:
        gid = a.get("venue_gazetteer_id")
        if not gid:
            continue
        g = GAZ_BY_ID[gid]
        hit = gate.geocode(a["venue_name"], a["address"], [], GAZ)
        if g["lat"] is None:
            assert hit is None, f"{a['key']}: {hit}"
        else:
            assert hit and hit["geocode_source"] == "gazetteer", f"{a['key']}: {hit}"
            assert (hit["lat"], hit["lng"]) == (g["lat"], g["lng"])
    for g in GAZ:
        if g["lat"] is None:
            assert gate.geocode(g["name"], None, [], GAZ) is None, g["id"]
        assert not gate.is_placeholder_coord(g["lat"], g["lng"]), g["id"]


@pytest.mark.parametrize("key", ["cartagena-festival-musica-2027", "hay-festival-cartagena-2027", "ficci-66-2027",
                                 "ironman-70-3-cartagena-2026"])
def test_gate_evaluate_high_for_tier1_festivals(key):
    gate = _gate()
    out = gate.evaluate(_seeded_doc(BY_KEY[key]), NOW)
    assert out["confidence"] == "HIGH", f"{key}: §6 promises HIGH from the organizer's visible date text → {out}"


# ── §16.1 flagship + §16.4 anchors_version ───────────────────────────────────

FLAGSHIP_KEYS = {
    "cartagena-festival-musica-2027", "hay-festival-cartagena-2027", "ficci-66-2027", "ironman-70-3-cartagena-2026",
    "fiestas-independencia-2026", "fiestas-2026-gran-desfile-de-independencia",
    "fiestas-2026-festival-nautico-y-bololo-del-arsenal",
}


def test_file_carries_an_integer_anchors_version():
    v = ANCHORS_FILE.get("anchors_version")
    assert isinstance(v, int) and not isinstance(v, bool) and v >= 2


def test_flagship_is_exactly_the_section_16_1_list():
    assert {a["key"] for a in ANCHORS if a["flagship"] is True} == FLAGSHIP_KEYS
    # Juan Luis Guerra is NOT flagship while VERIFY (§16.1)
    assert BY_KEY["fiestas-2026-juan-luis-guerra-festival-nautico"]["flagship"] is False
    # existing docs pick the new descriptive field up only when anchor_version grew (§15 W2)
    for k in FLAGSHIP_KEYS:
        assert BY_KEY[k]["anchor_version"] >= 2, k
