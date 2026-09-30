"""EVENTS-ELITE legacy-shape mappers (pure). Spec: docs/events-elite/DESIGN.md §13 D2, §15 T.

Old binaries (iOS 1.1.0/1.1.1) and the pre-cutover web render /api/events and
/api/concerts rows with fixed logic (frontend/src/utils/price.ts, app/event/[id].tsx,
app/concerts.tsx, app/(tabs)/index.tsx). These mappers emit EXACT field types so that
logic can never print NaN, 'null', a false 'Acceso libre'/'Entrada libre' or a false GRATIS:

  * price / price_min_cop: int or None, never an object (an object renders '$NaN COP').
  * booking_link / ticket_link: ticket_url, else source_url, http(s) only. Old detail
    screens show 'Acceso libre' whenever booking_link is not http(s), so a row without
    an http(s) link is never emitted (mapper returns None).
  * start_time / end_time: '' when unknown, never None (share text would print 'null').
  * is_free: True only when price.is_free is True and no price > 0 contradicts it.
  * Concerts: the old concerts card prints formatPrice(price) + ' COP' for every non-free
    row, so a concert whose price is unknown cannot be rendered honestly and is skipped.

Callers pass PublicEvent dicts from events_gate.public_view (legacy endpoints must only
pass published + HIGH + not-umbrella rows; events_runtime.public_rows(legacy=True) does).
"""
from __future__ import annotations

import math
import re
from typing import Any, Dict, Iterable, List, Mapping, Optional

from events_gate import is_http_url, parse_iso, registrable_domain
from events_time import BOGOTA

# §2 category -> a category key the 1.1.x UI already renders:
#   * Home CAT_COLORS (app/(tabs)/index.tsx) labels music/party/gastronomy/festival/
#     cultural/sports; Agenda's filter chips (app/(tabs)/agenda.tsx PARTNER_CATEGORIES)
#     filter city events on music/party/gastronomy, so those keys keep the chips working.
#   * SafeImage placeholders (src/constants/images.ts BUNDLED_MAP) resolve every value.
LEGACY_CAT: Dict[str, str] = {
    "concert": "music",
    "festival": "festival",
    "cultural": "cultural",
    "nightlife": "party",
    "gastronomic": "gastronomy",
    "sports": "sports",
    "family": "cultural",
    "civic": "cultural",
}
LEGACY_CONCERT_GENRE = "Concierto"

VERIFY_PREFIX = "Sin confirmar — verifica con el organizador. "
_MESES = ("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")
_HTTP_RE = re.compile(r"^https?://[^\s]+$", re.I)


def _es(v: Any) -> str:
    if isinstance(v, Mapping):
        s = v.get("es")
        return s.strip() if isinstance(s, str) else ""
    return v.strip() if isinstance(v, str) else ""


def _int_cop(v: Any) -> Optional[int]:
    if isinstance(v, bool) or v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f) or f <= 0:
        return None
    return int(round(f))


def _link(v: Any) -> Optional[str]:
    if isinstance(v, str) and _HTTP_RE.match(v.strip()) and is_http_url(v):
        return v.strip()
    return None


def verified_label(last_verified: Any) -> Optional[str]:
    """'28 sep' (Bogotá date of last_verified, Spanish month)."""
    dt = parse_iso(last_verified)
    if dt is None:
        return None
    d = dt.astimezone(BOGOTA)
    return f"{d.day} {_MESES[d.month - 1]}"


def source_footer(pv: Mapping[str, Any]) -> str:
    """'Fuente: <source_name> · verificado <d MMM>' (verificado omitted if unknown)."""
    raw = pv.get("source_name")
    name = raw.strip() if isinstance(raw, str) and raw.strip() else None
    name = name or registrable_domain(pv.get("source_url")) or "organizador"
    label = verified_label(pv.get("last_verified"))
    return f"Fuente: {name.strip()}" + (f" · verificado {label}" if label else "")


def legacy_description(pv: Mapping[str, Any]) -> str:
    """VERIFY prefix + description.es + '\\n\\nFuente: … · verificado d MMM' (§13 D2)."""
    body = _es(pv.get("description"))
    prefix = VERIFY_PREFIX if pv.get("confidence") != "HIGH" else ""
    head = (prefix + body).strip()
    footer = source_footer(pv)
    return f"{head}\n\n{footer}" if head else footer


def _price_fields(pv: Mapping[str, Any]) -> Dict[str, Any]:
    raw = pv.get("price")
    p: Mapping[str, Any] = raw if isinstance(raw, Mapping) else {}
    min_cop = _int_cop(p.get("min_cop"))
    max_cop = _int_cop(p.get("max_cop"))
    is_free = p.get("is_free") is True and not (min_cop or max_cop)
    return {"is_free": bool(is_free), "price": None if is_free else min_cop}


def to_legacy_event(pv: Mapping[str, Any], *, featured: Optional[bool] = None) -> Optional[Dict[str, Any]]:
    """PublicEvent -> legacy /api/events row (§13 D2). None when the row cannot be
    rendered honestly by old clients (no id/title/date or no http(s) link)."""
    eid = pv.get("event_id")
    title = _es(pv.get("title"))
    start = pv.get("start_date")
    if not isinstance(eid, str) or not eid or not title or not isinstance(start, str) or not start:
        return None
    source_url = _link(pv.get("source_url"))
    ticket_url = _link(pv.get("ticket_url"))
    booking = ticket_url or source_url
    if booking is None:
        return None
    end = pv.get("end_date") if isinstance(pv.get("end_date"), str) and pv.get("end_date") else start
    cat = LEGACY_CAT.get(str(pv.get("category") or ""), "cultural")
    pf = _price_fields(pv)
    img = pv.get("image_url") if isinstance(pv.get("image_url"), str) else ""
    row: Dict[str, Any] = {
        "event_id": eid,
        "id": eid,
        "slug": eid,
        "title": title,
        "description": legacy_description(pv),
        "date": start,
        "date_start": start,
        "date_end": end,
        "start_time": pv.get("start_time") if isinstance(pv.get("start_time"), str) else "",
        "end_time": pv.get("end_time") if isinstance(pv.get("end_time"), str) else "",
        "venue_name": pv.get("venue_name") if isinstance(pv.get("venue_name"), str) else "",
        "category": cat,
        "type": cat,
        "is_free": pf["is_free"],
        "price": pf["price"],
        "price_min_cop": pf["price"],
        "booking_link": booking,
        "ticket_url": ticket_url,
        "image_url": img or "",
        "source": [source_url] if source_url else [booking],
        "confidence": "high",
        "featured": bool(featured) if featured is not None else pv.get("category") == "festival",
        "recurring": False,
    }
    lat, lng = pv.get("lat"), pv.get("lng")
    if isinstance(lat, (int, float)) and isinstance(lng, (int, float)) and not isinstance(lat, bool) \
            and not isinstance(lng, bool) and math.isfinite(lat) and math.isfinite(lng):
        row["location"] = {"lat": float(lat), "lng": float(lng)}
    return row


def to_legacy_concert(pv: Mapping[str, Any]) -> Optional[Dict[str, Any]]:
    """PublicEvent (category concert) -> legacy /api/concerts row. Same rules as events,
    plus: a non-free concert with an unknown price is skipped (the 1.1.x concerts card
    would print '$null COP'), and ticket_link is always http(s) (else 'Entrada libre')."""
    base = to_legacy_event(pv)
    if base is None:
        return None
    if not base["is_free"] and base["price"] is None:
        return None
    title = base["title"]
    row: Dict[str, Any] = {
        "concert_id": base["event_id"],
        "event_id": base["event_id"],
        "id": base["event_id"],
        "artist": title,
        "title": title,
        "genre": LEGACY_CONCERT_GENRE,
        "description": base["description"],
        "date": base["date"],
        "start_time": base["start_time"],
        "end_time": base["end_time"],
        "venue_id": None,
        "venue_name": base["venue_name"],
        "is_free": base["is_free"],
        "price": base["price"],
        "currency": "COP",
        "image_url": base["image_url"],
        "ticket_link": base["booking_link"],
        "lineup": [],
        "tags": [],
        "source": base["source"],
        "confidence": "high",
    }
    if "location" in base:
        row["location"] = base["location"]
    return row


def legacy_events(pvs: Iterable[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for pv in pvs:
        # §16.1: a flagship row is featured for old binaries too (else featured = festival).
        row = to_legacy_event(pv, featured=True if pv.get("flagship") is True else None)
        if row is not None:
            out.append(row)
    return out


def legacy_concerts(pvs: Iterable[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for pv in pvs:
        if pv.get("category") != "concert":
            continue
        row = to_legacy_concert(pv)
        if row is not None:
            out.append(row)
    return out


def legacy_featured(rows: Iterable[Mapping[str, Any]], limit: int = 10,
                    prominence: Optional[Mapping[str, int]] = None,
                    flagship: Optional[Iterable[str]] = None) -> List[Dict[str, Any]]:
    """/events/featured: rows that are geocoded, festivals or §16.1 flagship (by event_id — the
    IRONMAN course and the Bando route have no pin, yet they are headline events), first 10,
    sorted by prominence desc (by event_id; the legacy row shape itself never changes), then
    start date and time. Without a prominence map every row weighs 0 (plain date order)."""
    prom = prominence or {}
    flag = set(flagship or ())
    picked = [dict(r) for r in rows
              if "location" in r or r.get("category") == "festival" or str(r.get("event_id")) in flag]

    def weight(r: Mapping[str, Any]) -> int:
        v = prom.get(str(r.get("event_id")), 0)
        return v if isinstance(v, int) and not isinstance(v, bool) else 0

    picked.sort(key=lambda r: (-weight(r), r.get("date_start") or "", r.get("start_time") or "99:99"))
    return picked[:limit]


def legacy_dates(rows: Iterable[Mapping[str, Any]]) -> List[str]:
    """/events/dates/available and /concerts/dates: sorted distinct start dates."""
    return sorted({str(r.get("date") or r.get("date_start")) for r in rows if r.get("date") or r.get("date_start")})


def legacy_concert_genres(rows: Iterable[Mapping[str, Any]]) -> List[str]:
    return sorted({str(r.get("genre")) for r in rows if isinstance(r.get("genre"), str) and r.get("genre")})


def rows_on_date(rows: Iterable[Mapping[str, Any]], ymd: str) -> List[Dict[str, Any]]:
    """/events?date=YYYY-MM-DD: rows whose [date_start, date_end] range contains ymd."""
    out = []
    for r in rows:
        s = r.get("date_start") or r.get("date")
        e = r.get("date_end") or s
        if isinstance(s, str) and isinstance(e, str) and s <= ymd <= e:
            out.append(dict(r))
    return out
