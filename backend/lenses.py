"""lenses.py — demographic lenses + Golden Hour map over the ONE catalog.

Contract: docs/lenses/DESIGN.md (the doc wins). Honesty spine:
  - A lens is a saved filter + sourced attribute set over the EXISTING catalog —
    never a new content silo. Every pin/tag carries source_url + source_name +
    last_verified + confidence HIGH|VERIFY. Nothing is guessed.
  - min_fill gate: a lens below its HIGH-entry threshold is "En construcción" —
    its content is NEVER served publicly (preview=1 serves it marked preview for
    QA, with every VERIFY treatment intact).
  - Prices/hours are never duplicated here: port-day fares are read from the city
    hub module (`city_modules.json`) at read time; Castillo pins link to /ciudad.
  - The cruise crowd badge serves ONLY a fresh cached count (< 26 h, today,
    Bogotá). Any fetch/parse anomaly stores ships=None and the badge hides —
    nothing is faked (mirrors events_runtime.sentinel_healthy, not /fx).

Serving mirrors the city hub (server.py:4795-4861): committed JSON, mtime cache,
last-good on error, raw payload + Cache-Control (no envelope), internal `luna`
blocks stripped from public output. Luna reads lens data as `lens_reference`
via ai_agent.build_context_snapshot — same AUTORIDAD pattern as city_reference.
"""
from __future__ import annotations

import hmac
import json
import logging
import os
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Tuple
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Request, Response

logger = logging.getLogger(__name__)

router = APIRouter()

BOGOTA = ZoneInfo("America/Bogota")
LANGS = ("es", "en", "fr", "pt")
LENS_KINDS = {"places", "venues", "kit"}
CONFIDENCES = {"HIGH", "VERIFY"}
BEST_LIGHT = {"sunrise", "midday", "sunset"}
PIN_ID = re.compile(r"^gh-[a-z0-9][a-z0-9-]{0,79}$")
VENUE_ID = re.compile(r"^(ptr|attr|svc)_[A-Za-z0-9_]{1,40}$")

# F5 corrections are law: these names must never appear as a pin (guide 2026-09).
BANNED_PIN_NAMES = ("café del mar", "cafe del mar", "interno", "mvngata", "mangata", "gozne",
                    "btexia", "eléctrica", "electrica", "moni", "pergamino", "café sofía",
                    "cafe sofia", "coralina")
REQUIRED_PIN_NAMES = ("candé", "baluarte de la gente")

_DATA_DIR = Path(__file__).resolve().parent / "data"
_LENSES_PATH = _DATA_DIR / "lenses.json"
_CITY_PATH = _DATA_DIR / "city_modules.json"
_SEASONAL_PATH = _DATA_DIR / "seasonal_stamps.json"

CRUISE_URL = "https://www.cruisemapper.com/ports/cartagena-colombia-port-3733"
CRUISE_FRESH_H = 26          # like the events sentinel: stale cache = hide, never fake
CRUISE_MAX_SHIPS = 20        # parse sanity cap

db: Any = None


def init(db_: Any) -> None:
    global db
    db = db_


# ── file caches (mtime, last-good; mirrors server._city_modules) ─────────────

_cache: Dict[str, Dict[str, Any]] = {
    "lenses": {"mtime": None, "data": None},
    "city": {"mtime": None, "data": None},
    "seasonal": {"mtime": None, "data": None},
}


def _load(name: str, path: Path) -> Optional[Dict[str, Any]]:
    slot = _cache[name]
    try:
        mtime = os.path.getmtime(path)
        if slot["data"] is None or slot["mtime"] != mtime:
            with open(path, "r", encoding="utf-8") as f:
                slot["data"] = json.load(f)
            slot["mtime"] = mtime
    except Exception as exc:  # noqa: BLE001 — keep last good copy, never 500
        logger.error("[lenses] %s load failed: %s", name, type(exc).__name__)
    return slot["data"]


def load_lenses() -> Optional[Dict[str, Any]]:
    return _load("lenses", _LENSES_PATH)


def _city_data() -> Optional[Dict[str, Any]]:
    return _load("city", _CITY_PATH)


def sunset_hhmm_by_month() -> Dict[str, str]:
    """Month → local sunset 'HH:MM' from seasonal_stamps.json (the walking-engine
    source of truth); {} when unavailable — the UI then shows no clock claim."""
    d = _load("seasonal", _SEASONAL_PATH) or {}
    table = d.get("sunset_minutes_by_month")
    out: Dict[str, str] = {}
    if isinstance(table, Mapping):
        for m, mins in table.items():
            if isinstance(mins, int) and 0 <= mins < 1440:
                out[str(m)] = f"{mins // 60:02d}:{mins % 60:02d}"
    return out


# ── validation (V1: zero tags without a source; F5 bans; L4; refs) ───────────

def _l4_ok(v: Any) -> bool:
    return isinstance(v, Mapping) and all(isinstance(v.get(k), str) and v[k].strip() for k in LANGS)


def _prov_ok(row: Mapping[str, Any]) -> List[str]:
    errs = []
    for f in ("source_url", "source_name", "last_verified"):
        if not (isinstance(row.get(f), str) and row[f].strip()):
            errs.append(f"missing {f}")
    if row.get("confidence") not in CONFIDENCES:
        errs.append("confidence must be HIGH|VERIFY")
    return errs


def validate_lenses(data: Any, catalog_ids: Optional[set] = None) -> List[str]:
    """Every rule the mirror sync re-checks. catalog_ids (from partners.json)
    enables venue-existence checks where the caller has the catalog."""
    errs: List[str] = []
    if not isinstance(data, Mapping):
        return ["root must be an object"]
    lenses = data.get("lenses")
    if not isinstance(lenses, list) or not lenses:
        return ["lenses[] missing"]
    keys = set()
    for ln in lenses:
        k = ln.get("key")
        if not isinstance(k, str) or k in keys:
            errs.append(f"lens key invalid/duplicate: {k!r}")
            continue
        keys.add(k)
        if ln.get("kind") not in LENS_KINDS:
            errs.append(f"{k}: bad kind")
        if not (isinstance(ln.get("min_fill"), int) and ln["min_fill"] >= 1):
            errs.append(f"{k}: min_fill must be a positive int")
        for f in ("label", "tagline"):
            if not _l4_ok(ln.get(f)):
                errs.append(f"{k}: {f} not L4-complete")
        luna = ln.get("luna") or {}
        if not (isinstance(luna.get("triggers"), list) and luna["triggers"]):
            errs.append(f"{k}: luna.triggers missing")
        if not _l4_ok(luna.get("decline_line")):
            errs.append(f"{k}: luna.decline_line not L4-complete")
    tiers = data.get("access_tiers")
    if not isinstance(tiers, Mapping) or not all(_l4_ok(v) for v in tiers.values()):
        errs.append("access_tiers missing or not L4-complete")

    pins = data.get("pins") or []
    pin_ids = set()
    names = []
    for p in pins:
        pid = p.get("id") or "?"
        if not (isinstance(pid, str) and PIN_ID.match(pid)) or pid in pin_ids:
            errs.append(f"pin id invalid/duplicate: {pid!r}")
        pin_ids.add(pid)
        if p.get("lens") not in keys:
            errs.append(f"{pid}: unknown lens")
        if not (isinstance(p.get("name"), str) and p["name"].strip()):
            errs.append(f"{pid}: name missing")
        else:
            names.append(p["name"].lower())
        vid = p.get("venue_id")
        if vid is not None:
            if not (isinstance(vid, str) and VENUE_ID.match(vid)):
                errs.append(f"{pid}: bad venue_id {vid!r}")
            elif catalog_ids is not None and vid not in catalog_ids:
                errs.append(f"{pid}: venue_id not in catalog: {vid}")
        else:
            lat, lng = p.get("lat"), p.get("lng")
            if not (isinstance(lat, (int, float)) and isinstance(lng, (int, float))):
                errs.append(f"{pid}: no venue_id and no coords")
            if p.get("geo_precision") not in ("exact", "approx"):
                errs.append(f"{pid}: geo_precision must be exact|approx")
        bl = p.get("best_light")
        if not (isinstance(bl, list) and bl and set(bl) <= BEST_LIGHT):
            errs.append(f"{pid}: best_light invalid")
        if p.get("access_tier") not in (tiers or {}):
            errs.append(f"{pid}: access_tier missing/unknown (F3)")
        if not _l4_ok(p.get("photogenic")):
            errs.append(f"{pid}: photogenic not L4-complete")
        if p.get("etiquette") is not None and not _l4_ok(p.get("etiquette")):
            errs.append(f"{pid}: etiquette not L4-complete")
        errs += [f"{pid}: {e}" for e in _prov_ok(p)]
    joined = " | ".join(names)
    for banned in BANNED_PIN_NAMES:
        if any(banned == n or banned in n.split(" (")[0] or banned in n for n in names):
            errs.append(f"BANNED pin name present (F5): {banned}")
    for req in REQUIRED_PIN_NAMES:
        if not any(req in n for n in names):
            errs.append(f"required pin missing (F5): {req}")
    _ = joined

    for t in data.get("venue_tags") or []:
        lens, vid = t.get("lens"), t.get("venue_id")
        tid = f"tag {lens}/{vid}"
        if lens not in keys:
            errs.append(f"{tid}: unknown lens")
        if not (isinstance(vid, str) and VENUE_ID.match(vid or "")):
            errs.append(f"{tid}: bad venue_id")
        elif catalog_ids is not None and vid not in catalog_ids:
            errs.append(f"{tid}: venue_id not in catalog")
        if not isinstance(t.get("attrs"), Mapping) or not t["attrs"]:
            errs.append(f"{tid}: attrs missing")
        if t.get("note") is not None and not _l4_ok(t.get("note")):
            errs.append(f"{tid}: note not L4-complete")
        errs += [f"{tid}: {e}" for e in _prov_ok(t)]

    pd = data.get("port_day")
    if not isinstance(pd, Mapping):
        errs.append("port_day missing")
    else:
        if not isinstance(pd.get("fare_module"), str):
            errs.append("port_day.fare_module missing")
        crowd = pd.get("crowd") or {}
        for hp in crowd.get("hotspot_pins") or []:
            if hp not in pin_ids:
                errs.append(f"port_day crowd hotspot unknown pin: {hp}")
        if not _l4_ok(crowd.get("note")):
            errs.append("port_day.crowd.note not L4-complete")
        its = pd.get("itineraries") or []
        if not its:
            errs.append("port_day.itineraries empty")
        for it in its:
            iid = it.get("id") or "?"
            if it.get("editorial") is not True:
                errs.append(f"{iid}: itineraries must be marked editorial:true")
            for f in ("title", "note"):
                if not _l4_ok(it.get(f)):
                    errs.append(f"{iid}: {f} not L4-complete")
            for s in it.get("stops") or []:
                if s.get("pin") not in pin_ids:
                    errs.append(f"{iid}: stop references unknown pin {s.get('pin')!r}")
                if not (isinstance(s.get("minutes"), int) and s["minutes"] > 0):
                    errs.append(f"{iid}: stop minutes invalid")
    return errs


# ── fill gate (§2) ───────────────────────────────────────────────────────────

def fill_counts(data: Mapping[str, Any]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    pins = data.get("pins") or []
    tags = data.get("venue_tags") or []
    pd = data.get("port_day") or {}
    for ln in data.get("lenses") or []:
        k, kind, need = ln.get("key"), ln.get("kind"), int(ln.get("min_fill") or 1)
        if kind == "places":
            mine = [p for p in pins if p.get("lens") == k]
            high = sum(1 for p in mine if p.get("confidence") == "HIGH")
            total = len(mine)
        elif kind == "venues":
            mine_v = {t["venue_id"] for t in tags if t.get("lens") == k}
            high = len({t["venue_id"] for t in tags
                        if t.get("lens") == k and t.get("confidence") == "HIGH"})
            total = len(mine_v)
        else:  # kit — live when its data deps resolve
            fares = _fare_rows(pd.get("fare_module"))
            ok = bool(fares) and bool(pd.get("itineraries"))
            high = total = 1 if ok else 0
        out[k] = {"high": high, "total": total, "min_fill": need, "live": high >= need}
    return out


# ── catalog resolution (Mongo at read time, TTL last-good cache) ─────────────

_VENUE_TTL_S = 600
_venue_cache: Dict[str, Any] = {"at": 0.0, "views": {}}


async def _venue_views(ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """partner_id → {name, lat, lng, zone, image_url, category} for publicly
    visible catalog rows. Last-good on any failure (pins then resolve from the
    previous copy; a cold failure resolves none and those pins are omitted)."""
    now = datetime.now(timezone.utc).timestamp()
    if _venue_cache["views"] and now - _venue_cache["at"] < _VENUE_TTL_S:
        return _venue_cache["views"]
    views: Dict[str, Dict[str, Any]] = {}
    try:
        from partner_visibility import PUBLIC_PARTNER_FILTER
        cur = db.partners.find(
            {"partner_id": {"$in": ids}, **PUBLIC_PARTNER_FILTER},
            {"_id": 0, "partner_id": 1, "name": 1, "location": 1, "zone": 1,
             "image_url": 1, "category": 1},
        )
        async for r in cur:
            loc = r.get("location") or {}
            views[r["partner_id"]] = {
                "name": r.get("name"),
                "lat": loc.get("lat"), "lng": loc.get("lng"),
                "zone": r.get("zone"), "image_url": r.get("image_url"),
                "category": r.get("category"),
            }
        _venue_cache.update(at=now, views=views)
    except Exception as exc:  # noqa: BLE001
        logger.error("[lenses] venue resolve failed: %s", type(exc).__name__)
    return _venue_cache["views"]


def _resolved_pin(p: Mapping[str, Any], views: Mapping[str, Mapping[str, Any]]) -> Optional[Dict[str, Any]]:
    out = {k: p.get(k) for k in ("id", "lens", "name", "venue_id", "zone", "best_light",
                                 "access_tier", "crowd_hotspot", "photogenic", "etiquette",
                                 "link", "source_url", "source_name", "last_verified",
                                 "confidence", "geo_precision")}
    vid = p.get("venue_id")
    if vid:
        v = views.get(vid)
        if not v or v.get("lat") is None:
            return None  # not resolvable/visible right now — omit, never guess
        out.update(lat=v["lat"], lng=v["lng"], image_url=v.get("image_url"),
                   venue_name=v.get("name"), link=out.get("link") or f"/partner/{vid}")
        out["geo_precision"] = "exact"
    else:
        out.update(lat=p.get("lat"), lng=p.get("lng"), image_url=None, venue_name=None)
    return out


# ── port-day kit (§3): fares from the city module, single owner ──────────────

def _fare_rows(module_id: Optional[str]) -> List[Dict[str, Any]]:
    city = _city_data() or {}
    for m in city.get("modules") or []:
        if isinstance(m, dict) and m.get("id") == module_id:
            rows = []
            for f in m.get("facts") or []:
                rows.append({k: f.get(k) for k in ("key", "label", "value_cop", "value_text",
                                                    "confidence", "source_name", "source_url",
                                                    "last_verified", "note")})
            return rows
    return []


async def _crowd_today(now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    """The cached cruise count for TODAY (Bogotá), only when fresh (< 26 h).
    Anything else → None and the badge hides. ships may be 0 (honest quiet day)."""
    n = now or datetime.now(timezone.utc)
    try:
        doc = await db.lens_state.find_one({"_id": "cruise"})
    except Exception as exc:  # noqa: BLE001
        logger.error("[lenses] crowd read failed: %s", type(exc).__name__)
        return None
    if not doc or doc.get("ships") is None:
        return None
    try:
        fetched = datetime.fromisoformat(str(doc.get("fetched_at")).replace("Z", "+00:00"))
    except Exception:
        return None
    if (n - fetched).total_seconds() > CRUISE_FRESH_H * 3600:
        return None
    today = n.astimezone(BOGOTA).date().isoformat()
    if doc.get("date") != today:
        return None
    ships = doc.get("ships")
    if not isinstance(ships, int) or not (0 <= ships <= CRUISE_MAX_SHIPS):
        return None
    return {"date": today, "ships": ships}


# ── cruise page parse (D3: conservative; any anomaly → None) ─────────────────

_MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
# The schedule marks each day once ("<tr class=newDay><td><span>9 September, 2026</span>…"),
# then that day's ships follow until the next marker. Day-first, full or abbreviated
# month, optional comma+year (year required to disambiguate — the page spans months).
_CRUISE_DATE_RE = re.compile(
    r"\b(\d{1,2})\s+(" + "|".join(m + r"[a-z]*" for m in _MONTHS) + r")\.?,?\s+(\d{4})\b"
)


def parse_cruise_ships(html: str, today: Any) -> Optional[int]:
    """Count ship calls for `today` on the CruiseMapper port schedule page by
    segmenting on its day markers and counting /ships/ links inside today's
    segment. Returns None whenever the page does not look like the schedule we
    know (no ship links, no day markers) — the caller stores None and the badge
    hides. 0 is a real answer (today simply is not marked / has no ships)."""
    if not isinstance(html, str) or "/ships/" not in html:
        return None
    text = html.lower()
    markers = [(m.start(), int(m.group(1)), m.group(2)[:3], int(m.group(3)))
               for m in _CRUISE_DATE_RE.finditer(text)]
    if not markers:
        return None
    d, mon, y = today.day, _MONTHS[today.month - 1], today.year
    count = 0
    for i, (pos, dd, mm, yy) in enumerate(markers):
        if (dd, mm, yy) != (d, mon, y):
            continue
        end = markers[i + 1][0] if i + 1 < len(markers) else len(text)
        # The last day's segment otherwise runs to end-of-page, where "popular
        # ships" footer widgets also carry /ships/ links — stop at the table end.
        tbl = text.find("</table>", pos)
        if tbl != -1 and tbl < end:
            end = tbl
        count += text.count("/ships/", pos, end)
    if count > CRUISE_MAX_SHIPS:
        return None
    return count


async def cruise_pull(*, dry: bool = False, now: Optional[datetime] = None) -> Dict[str, Any]:
    n = now or datetime.now(timezone.utc)
    today = n.astimezone(BOGOTA).date()
    ships: Optional[int] = None
    try:
        import events_sources as srcs
        # The schedule is month-paginated server-side; without ?month the page
        # serves a stale window and today never appears (verified 2026-09-30).
        target = f"{CRUISE_URL}?month={today.strftime('%Y-%m')}"
        async with srcs.make_client() as client:
            # fetch returns a FetchResult DICT; public_url_guard goes in as the
            # per-hop url_guard (it returns a refusal string, None = allowed).
            page = await srcs.fetch(
                client, target, url_guard=srcs.public_url_guard,
                headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                                       "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"},
            )
            if (isinstance(page, dict) and not page.get("blocked_reason")
                    and 200 <= int(page.get("status") or 0) < 300 and not page.get("challenged")):
                ships = parse_cruise_ships(page.get("text") or "", today)
    except Exception as exc:  # noqa: BLE001 — hide, never fake
        logger.error("[lenses] cruise fetch failed: %s", type(exc).__name__)
        ships = None
    doc = {"_id": "cruise", "date": today.isoformat(), "ships": ships,
           "fetched_at": n.strftime("%Y-%m-%dT%H:%M:%SZ"), "source_url": CRUISE_URL}
    if not dry:
        try:
            await db.lens_state.update_one({"_id": "cruise"}, {"$set": doc}, upsert=True)
        except Exception as exc:  # noqa: BLE001
            logger.error("[lenses] cruise store failed: %s", type(exc).__name__)
    return {"date": doc["date"], "ships": ships, "dry": dry}


# ── public payloads ──────────────────────────────────────────────────────────

def _public_lens_def(ln: Mapping[str, Any], f: Mapping[str, Any]) -> Dict[str, Any]:
    return {"key": ln.get("key"), "kind": ln.get("kind"), "icon": ln.get("icon"),
            "label": ln.get("label"), "tagline": ln.get("tagline"),
            "live": f.get("live", False),
            "fill": {"high": f.get("high", 0), "total": f.get("total", 0),
                     "min_fill": f.get("min_fill", 0)}}


async def lenses_index() -> Optional[Dict[str, Any]]:
    data = load_lenses()
    if not data:
        return None
    fills = fill_counts(data)
    return {
        "version": data.get("version"),
        "updated": data.get("updated"),
        "lenses": [_public_lens_def(ln, fills.get(ln.get("key"), {})) for ln in data["lenses"]],
        "access_tiers": data.get("access_tiers"),
        "sunset_by_month": sunset_hhmm_by_month(),
    }


async def lens_payload(key: str, *, preview: bool = False) -> Optional[Dict[str, Any]]:
    data = load_lenses()
    if not data:
        return None
    ln = next((x for x in data["lenses"] if x.get("key") == key), None)
    if ln is None:
        return {"__404": True}
    fills = fill_counts(data)
    f = fills.get(key, {})
    base = _public_lens_def(ln, f)
    if not f.get("live") and not preview:
        return {**base, "coming_soon": True}
    if ln.get("kind") == "places":
        views = await _venue_views([p["venue_id"] for p in data.get("pins") or []
                                    if p.get("lens") == key and p.get("venue_id")])
        pins = [rp for p in data.get("pins") or [] if p.get("lens") == key
                for rp in [_resolved_pin(p, views)] if rp is not None]
        base["pins"] = pins
        base["sunset_by_month"] = sunset_hhmm_by_month()
    elif ln.get("kind") == "venues":
        tags = [t for t in data.get("venue_tags") or [] if t.get("lens") == key]
        views = await _venue_views([t["venue_id"] for t in tags])
        base["venues"] = [
            {**{k: t.get(k) for k in ("venue_id", "attrs", "note", "source_url",
                                       "source_name", "last_verified", "confidence")},
             "name": views.get(t["venue_id"], {}).get("name"),
             "lat": views.get(t["venue_id"], {}).get("lat"),
             "lng": views.get(t["venue_id"], {}).get("lng")}
            for t in tags if t.get("venue_id") in views
        ]
    else:  # kit: port_day
        pd = data.get("port_day") or {}
        pin_by_id = {p["id"]: p for p in data.get("pins") or []}
        views = await _venue_views([p["venue_id"] for p in pin_by_id.values() if p.get("venue_id")])
        def stop_view(s: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
            rp = _resolved_pin(pin_by_id.get(s.get("pin"), {}), views) if s.get("pin") in pin_by_id else None
            if rp is None:
                return None
            return {"pin": s["pin"], "minutes": s.get("minutes"), "name": rp["name"],
                    "lat": rp["lat"], "lng": rp["lng"], "access_tier": rp["access_tier"]}
        base["fares"] = _fare_rows(pd.get("fare_module"))
        base["fare_link"] = "/ciudad/" + str(pd.get("fare_module") or "")
        base["muelle_link"] = "/ciudad/" + str(pd.get("muelle_module") or "")
        base["return_buffer_min"] = pd.get("return_buffer_min")
        base["crowd_note"] = (pd.get("crowd") or {}).get("note")
        base["hotspot_pins"] = (pd.get("crowd") or {}).get("hotspot_pins") or []
        base["crowd_today"] = await _crowd_today()
        base["itineraries"] = [
            {**{k: it.get(k) for k in ("id", "duration_h", "editorial", "title", "note")},
             "stops": [sv for s in it.get("stops") or [] for sv in [stop_view(s)] if sv]}
            for it in pd.get("itineraries") or []
        ]
    if preview and not f.get("live"):
        base["preview"] = True
        base["coming_soon"] = True
    return base


# ── Luna (§5): deterministic lens_reference, same shape discipline as city ───

def _norm(s: str) -> str:
    return unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()


_trigger_cache: Dict[str, Any] = {"mtime": None, "res": None}


def _trigger_res() -> List[Tuple[str, Any]]:
    data = load_lenses()
    if not data:
        return []
    if _trigger_cache["res"] is None or _trigger_cache["mtime"] != _cache["lenses"]["mtime"]:
        res = []
        for ln in data.get("lenses") or []:
            words = [re.escape(_norm(t)) for t in (ln.get("luna") or {}).get("triggers") or []]
            if words:
                # bounded like _city_trigger_re, but a plain plural still matches
                # ("fotos", "photos", "fotogénicos"): one optional trailing s.
                res.append((ln["key"], re.compile(r"(?<![a-z0-9])(?:" + "|".join(words) + r")s?(?![a-z0-9])")))
        _trigger_cache.update(mtime=_cache["lenses"]["mtime"], res=res)
    return _trigger_cache["res"] or []


def luna_context(user_text: str) -> Optional[Dict[str, Any]]:
    """Deterministic lens_reference for the agent context. LIVE lens → up to 6
    HIGH entries with name + one-line note + access + source (es/en compact,
    like _city_compact). GATED lens → ONLY the four decline lines. Never both,
    never an invented entry."""
    data = load_lenses()
    if not data:
        return None
    text = _norm(user_text or "")
    if not text:
        return None
    hits = [k for k, rx in _trigger_res() if rx.search(text)]
    if not hits:
        return None
    fills = fill_counts(data)
    tiers = data.get("access_tiers") or {}
    out = []
    for key in hits[:2]:
        ln = next(x for x in data["lenses"] if x["key"] == key)
        f = fills.get(key, {})
        if not f.get("live"):
            out.append({"key": key, "live": False,
                        "label_es": (ln.get("label") or {}).get("es"),
                        "decline_line": (ln.get("luna") or {}).get("decline_line")})
            continue
        entries = []
        if ln.get("kind") == "places":
            for p in data.get("pins") or []:
                if p.get("lens") != key or p.get("confidence") != "HIGH":
                    continue
                entries.append({
                    "name": p.get("name"),
                    "note_es": (p.get("photogenic") or {}).get("es"),
                    "note_en": (p.get("photogenic") or {}).get("en"),
                    "best_light": p.get("best_light"),
                    "access_es": (tiers.get(p.get("access_tier")) or {}).get("es"),
                    "etiquette_es": (p.get("etiquette") or {}).get("es") if p.get("etiquette") else None,
                    "partner_id": p.get("venue_id"),
                    "source_name": p.get("source_name"),
                })
                if len(entries) >= 6:
                    break
        elif ln.get("kind") == "kit":
            pd = data.get("port_day") or {}
            entries.append({"kind": "port_day",
                            "fares": _fare_rows(pd.get("fare_module"))[:6],
                            "crowd_note_es": ((pd.get("crowd") or {}).get("note") or {}).get("es"),
                            "itineraries": [{"title_es": (it.get("title") or {}).get("es"),
                                             "duration_h": it.get("duration_h")}
                                            for it in pd.get("itineraries") or []]})
        out.append({"key": key, "live": True, "label_es": (ln.get("label") or {}).get("es"),
                    "entries": entries, "sunset_by_month": sunset_hhmm_by_month()
                    if key == "golden_hour" else None})
    return {"updated": data.get("updated"), "lenses": out} if out else None


# ── routes (mounted before api_router, like cmw) ─────────────────────────────

async def _rl(request: Request) -> None:
    try:
        from server import _check_rate_limit, _client_ip  # late import; server mounts us
        await _check_rate_limit(f"lenses:{_client_ip(request)}", max_calls=60, window_sec=60)
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 — never let limiter plumbing 500 a read
        pass


@router.get("/lenses")
async def get_lenses(request: Request, response: Response):
    await _rl(request)
    data = await lenses_index()
    if not data:
        raise HTTPException(status_code=503, detail="Lentes no disponibles / Lenses unavailable")
    response.headers["Cache-Control"] = "public, max-age=300"
    return data


@router.get("/lenses/{key}")
async def get_lens(key: str, request: Request, response: Response, preview: int = 0):
    await _rl(request)
    payload = await lens_payload(key, preview=preview == 1)
    if payload is None:
        raise HTTPException(status_code=503, detail="Lentes no disponibles / Lenses unavailable")
    if payload.get("__404"):
        raise HTTPException(status_code=404, detail={"error": "not_found",
                                                     "message": "Lente no encontrado / Lens not found"})
    response.headers["Cache-Control"] = "no-store" if preview == 1 else "public, max-age=300"
    return payload


def _cron_ok(request: Request) -> bool:
    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        return False
    tok = auth[7:].strip()
    for env in ("CRON_SECRET", "EVENTS_ADMIN_TOKEN"):
        want = os.environ.get(env) or ""
        if len(want) >= 16 and hmac.compare_digest(tok, want):
            return True
    return False


@router.api_route("/admin/lenses/cruise-pull", methods=["GET", "POST"])
async def cruise_pull_route(request: Request):
    if not _cron_ok(request):
        raise HTTPException(status_code=401, detail="unauthorized")
    return await cruise_pull(dry=request.query_params.get("dry") == "1")
