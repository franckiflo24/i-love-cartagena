"""EVENTS-ELITE verification core: pure functions, no I/O.

Spec: docs/events-elite/DESIGN.md (precedence §15 > §13 > §1-§12). This module is the
honesty spine in code. Every public event read (feed, feed/item, legacy endpoints,
search, Luna, reminders) goes through `public_view`, which re-applies `evaluate` at read
time; stored status / confidence / notif_eligible are caches and never trusted alone.

When in doubt every function here fails CLOSED: a missed event beats a wrong one.

Public surface (other modules import these, keep the names stable):
  country_check(c) -> (verdict, signals)            §15 Q
  evaluate(doc, now_utc) -> {status, status_reason, confidence, notif_eligible}   §4 + §15 R
  public_view(doc, now_utc, sentinel_healthy) -> PublicEvent | None               §13 B + §15 R4
  match_key / slug / make_event_id / norm / EVENT_ID_RE                           §15 P
  registrable_domain / domain_tier / mirror_group / TIER_BY_DOMAIN / MIRRORS
  geocode / venue_keys / is_placeholder_coord / in_distrito / PLACEHOLDER_COORDS
  parse_date_text / parse_time_text / clean_time / is_jsonld_placeholder_date
  find_cancel_marker / status_marker / is_challenge / classify_fetch / detect_is_free
  tbc_window_end / make_date_tbc_note / bogota_today / parse_iso / iso_utc
"""
from __future__ import annotations

import hashlib
import html as _html
import math
import re
import unicodedata
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import urlsplit

from events_time import BOGOTA

# ── constants ────────────────────────────────────────────────────────────────

CATEGORIES: Tuple[str, ...] = (
    "concert", "festival", "cultural", "nightlife", "gastronomic", "sports", "family", "civic",
)
STATUSES: Tuple[str, ...] = ("published", "review", "hidden", "expired", "date_tbc")
CONFIDENCES: Tuple[str, ...] = ("HIGH", "VERIFY")

# §15 R1: review reasons that evaluate() never recomputes. Every `hidden` is sticky too.
STICKY_REVIEW_REASONS = frozenset({
    "date_changed", "conflict", "country_fail", "aggregator_only", "partner_pending",
    "long_span", "stale_long", "source_changed", "legacy_unverified", "merged",
    # Verifier additions (same R1 class: a source disagrees with the row; only admin approve clears):
    # a tier 4–5 page matching the row says cancelled/postponed; the source row now names another venue.
    "cancel_reported", "venue_changed",
})

# §15 Q5 Distrito box + Turbaná/Turbaco exclusion.
DISTRITO_LAT = (10.10, 10.62)
DISTRITO_LNG = (-75.82, -75.42)
EXCLUSION_LAT_BELOW = 10.36
EXCLUSION_LNG_ABOVE = -75.47

# §15 Q5 placeholder / centroid coordinates. Never "geocoded". Mirrored in
# frontend/src/lib/eventsFeed.ts. Matching rule: |Δlat| ≤ 1e-3 AND |Δlng| ≤ 1e-3.
PLACEHOLDER_COORDS: Tuple[Tuple[float, float], ...] = (
    (10.4236, -75.5483),       # legacy "Cartagena" / La Muralla seed point
    (10.3932277, -75.4832311), # Fever CO city centroid (cartagena-colombia)
    (10.3910, -75.4794),
    (10.3997, -75.5144),
)
PLACEHOLDER_TOLERANCE = 1e-3

HIGH_MAX_AGE = timedelta(hours=72)     # §13 B1: HIGH decays to VERIFY after 72 h
STALE_LONG_AGE = timedelta(days=10)    # §15 R3 6b: review/stale_long
LONG_SPAN_DAYS = 21                    # §15 R3 4b
NOTIF_MAX_SPAN_DAYS = 3                # §15 R5

GEOCODE_SOURCES = ("catalog", "gazetteer", "source")

# Registrable-domain helper: hardcoded public suffixes (§13 C2). Two-label suffixes only;
# everything else is treated as a one-label TLD.
_TWO_LEVEL_SUFFIXES = frozenset({
    "com.co", "gov.co", "org.co", "edu.co", "net.co", "mil.co", "nom.co",
    "com.es", "gob.es", "org.es", "nom.es", "edu.es",
    "co.uk", "org.uk", "com.mx", "gob.mx", "com.ar", "gob.ar", "com.pe", "gob.pe",
})

# Source tiers (§2, §15 R2: IPCC is tier 1). The registry is authoritative for known
# domains; an adapter's declared tier is only used for unknown domains.
TIER_BY_DOMAIN: Dict[str, int] = {
    # 1 organizer / official government
    "cartagenamusicfestival.com": 1,
    "hayfestival.com": 1,
    "ficcifestival.com": 1,
    "ironman.com": 1,
    "cartagena.gov.co": 1,
    "ipcc.gov.co": 1,
    # 2 primary ticketers
    "latiquetera.com": 2,
    "tuboleta.com": 2,
    "ticketshop.com.co": 2,
    "feverup.com": 2,
    # 3 venue first-party
    "cccartagena.com": 3,
    # 5 media
    "eluniversal.com.co": 5,
    # 6 aggregator / social (discovery only)
    "cartagenaplay.com": 6,
    "instagram.com": 6,
    "facebook.com": 6,
}
# §15 R2: mirror groups count as ONE source. Any registrable domain starting with a
# prefix in MIRROR_PREFIXES joins that group (Q'hubo is El Universal's tabloid).
MIRRORS: Tuple[frozenset, ...] = (
    frozenset({"ipcc.gov.co", "cartagena.gov.co"}),
    frozenset({"eluniversal.com.co"}),
)
MIRROR_PREFIXES: Dict[str, str] = {"qhubo": "eluniversal.com.co"}
# Never ingest (research: hijacked gambling spam domain).
DENY_DOMAINS = frozenset({"eticket.com.co"})

# §3 / §15 Q4 Tier-1 registries scoped to Cartagena de Indias.
_TIER1_SCOPED_DOMAINS = frozenset({
    "cartagenamusicfestival.com", "ficcifestival.com", "cartagena.gov.co", "ipcc.gov.co",
    "cccartagena.com",
})

_HTTP_URL_RE = re.compile(r"^https?://[^\s]+$", re.I)  # same rule as frontend isHttpUrl
EVENT_ID_RE = re.compile(r"^ce-[a-z0-9]+(?:-[a-z0-9]+)*$")
_YMD_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_HM_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_ISO_ONLY_RE = re.compile(r"^\s*\d{4}-\d{2}-\d{2}(?:[t ][\d:.+\-z]*)?\s*$", re.I)

# ── small helpers ────────────────────────────────────────────────────────────


def fold(s: Any) -> str:
    """Lowercase + strip accents (NFKD). 'Bogotá' -> 'bogota', 'España' -> 'espana'."""
    if not isinstance(s, str):
        s = "" if s is None else str(s)
    nk = unicodedata.normalize("NFKD", s)
    return "".join(ch for ch in nk if not unicodedata.combining(ch)).lower()


def norm(s: Any) -> str:
    """Identity normalizer (§15 P1): folded, non-alphanumerics collapsed to one space."""
    return re.sub(r"[^a-z0-9]+", " ", fold(s)).strip()


_JSON_U_RE = re.compile(r"\\u([0-9a-fA-F]{4})")


def _prep_text(s: Any) -> str:
    """Raw page/event text -> matchable text: HTML entities and JSON \\uXXXX unescaped,
    `\\/` unescaped, then folded. Tags are KEPT (page-level regexes use them as fences)."""
    if not isinstance(s, str) or not s:
        return ""
    t = _html.unescape(s)
    t = _JSON_U_RE.sub(lambda m: chr(int(m.group(1), 16)), t)
    t = t.replace("\\/", "/")
    return fold(t)


def is_http_url(u: Any) -> bool:
    if not isinstance(u, str):
        return False
    u = u.strip()
    if not _HTTP_URL_RE.match(u):
        return False
    try:
        return bool(urlsplit(u).hostname)
    except ValueError:
        return False


def _host(url_or_host: Any) -> str:
    if not isinstance(url_or_host, str) or not url_or_host.strip():
        return ""
    s = url_or_host.strip()
    if "://" not in s:
        s = "http://" + s
    try:
        h = urlsplit(s).hostname or ""
    except ValueError:
        return ""
    return h.strip(".").lower()


def registrable_domain(url_or_host: Any) -> Optional[str]:
    """'https://www.cartagena.gov.co/x' -> 'cartagena.gov.co'; 'special.checkout.tuboleta.com'
    -> 'tuboleta.com'. None when there is no host."""
    host = _host(url_or_host)
    if not host:
        return None
    if re.match(r"^\d+(\.\d+){3}$", host) or ":" in host:
        return host
    labels = host.split(".")
    if len(labels) >= 3 and ".".join(labels[-2:]) in _TWO_LEVEL_SUFFIXES:
        return ".".join(labels[-3:])
    if len(labels) >= 2:
        return ".".join(labels[-2:])
    return host


def mirror_group(url_or_domain: Any) -> str:
    """Independence key: mirror-grouped registrable domain (§15 R2)."""
    d = registrable_domain(url_or_domain) or ""
    for prefix, group in MIRROR_PREFIXES.items():
        if d.startswith(prefix):
            return group
    for grp in MIRRORS:
        if d in grp:
            return sorted(grp)[0]
    return d


def domain_tier(url: Any, declared: Any = None) -> Optional[int]:
    """Tier for a URL. Registry wins for known domains; unknown domains use the declared
    tier (1..6) or default to 6 (discovery only). None for denylisted domains."""
    d = registrable_domain(url)
    if not d or d in DENY_DOMAINS:
        return None
    if d in TIER_BY_DOMAIN:
        return TIER_BY_DOMAIN[d]
    for prefix, group in MIRROR_PREFIXES.items():
        if d.startswith(prefix):
            return TIER_BY_DOMAIN.get(group, 6)
    if isinstance(declared, int) and not isinstance(declared, bool) and 1 <= declared <= 6:
        return declared
    return 6


def _finite(x: Any) -> Optional[float]:
    if isinstance(x, bool) or x is None:
        return None
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def is_placeholder_coord(lat: Any, lng: Any) -> bool:
    la, ln = _finite(lat), _finite(lng)
    if la is None or ln is None:
        return False
    return any(
        abs(la - plat) <= PLACEHOLDER_TOLERANCE and abs(ln - plng) <= PLACEHOLDER_TOLERANCE
        for plat, plng in PLACEHOLDER_COORDS
    )


def in_distrito(lat: Any, lng: Any) -> bool:
    """Inside the Distrito box and outside the Turbaná/Turbaco exclusion (§15 Q5)."""
    la, ln = _finite(lat), _finite(lng)
    if la is None or ln is None:
        return False
    if not (DISTRITO_LAT[0] <= la <= DISTRITO_LAT[1] and DISTRITO_LNG[0] <= ln <= DISTRITO_LNG[1]):
        return False
    if la < EXCLUSION_LAT_BELOW and ln > EXCLUSION_LNG_ABOVE:
        return False
    return True


def _valid_geo(lat: Any, lng: Any) -> bool:
    """Real, usable coordinates: finite, not null island, not a placeholder, in the Distrito."""
    la, ln = _finite(lat), _finite(lng)
    if la is None or ln is None or (la == 0 and ln == 0):
        return False
    return in_distrito(la, ln) and not is_placeholder_coord(la, ln)


# ── time helpers (Bogotá) ────────────────────────────────────────────────────


def _as_utc(now_utc: Optional[datetime]) -> datetime:
    if now_utc is None:
        return datetime.now(timezone.utc)
    if now_utc.tzinfo is None:
        return now_utc.replace(tzinfo=timezone.utc)
    return now_utc.astimezone(timezone.utc)


as_utc = _as_utc  # public alias: aware-UTC coercion (naive = UTC, None = now)


def bogota_now(now_utc: Optional[datetime] = None) -> datetime:
    return _as_utc(now_utc).astimezone(BOGOTA)


def bogota_today(now_utc: Optional[datetime] = None) -> str:
    return bogota_now(now_utc).strftime("%Y-%m-%d")


def parse_iso(v: Any) -> Optional[datetime]:
    """ISO-8601 string or datetime -> aware UTC datetime (naive = UTC). None if unparseable."""
    if isinstance(v, datetime):
        return v.replace(tzinfo=timezone.utc) if v.tzinfo is None else v.astimezone(timezone.utc)
    if not isinstance(v, str) or not v.strip():
        return None
    s = v.strip()
    if s.endswith(("Z", "z")):
        s = s[:-1] + "+00:00"
    try:
        d = datetime.fromisoformat(s)
    except ValueError:
        return None
    return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d.astimezone(timezone.utc)


def iso_utc(dt: datetime) -> str:
    """K4 timestamp format: YYYY-MM-DDTHH:MM:SSZ."""
    return _as_utc(dt).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ymd(v: Any) -> Optional[date]:
    if not isinstance(v, str) or not _YMD_RE.match(v):
        return None
    try:
        return date.fromisoformat(v)
    except ValueError:
        return None


def _hm(v: Any) -> Optional[str]:
    if isinstance(v, str) and _HM_RE.match(v.strip()):
        return v.strip()
    return None


def tbc_window_end(year: int, month: int) -> str:
    """Last day of the stated month (§15 P3 tbc_window_end)."""
    if month == 12:
        last = date(year, 12, 31)
    else:
        last = date(year, month + 1, 1) - timedelta(days=1)
    return last.isoformat()


_MONTH_NAMES_L4 = {
    "es": ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto",
           "Septiembre", "Octubre", "Noviembre", "Diciembre"],
    "en": ["January", "February", "March", "April", "May", "June", "July", "August",
           "September", "October", "November", "December"],
    "fr": ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août",
           "Septembre", "Octobre", "Novembre", "Décembre"],
    "pt": ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto",
           "Setembro", "Outubro", "Novembro", "Dezembro"],
}


def make_date_tbc_note(year: int, month: int) -> Dict[str, str]:
    """Template-built date_tbc_note (§15 S4: never through the LLM)."""
    m = month - 1
    return {
        "es": f"{_MONTH_NAMES_L4['es'][m]} {year} · fecha por confirmar",
        "en": f"{_MONTH_NAMES_L4['en'][m]} {year} · date to be confirmed",
        "fr": f"{_MONTH_NAMES_L4['fr'][m]} {year} · date à confirmer",
        "pt": f"{_MONTH_NAMES_L4['pt'][m]} de {year} · data a confirmar",
    }


# ── date / time text parsing (deterministic; returns None when unsure) ───────

_MONTHS: Dict[str, int] = {
    "enero": 1, "ene": 1, "january": 1, "jan": 1,
    "febrero": 2, "feb": 2, "february": 2,
    "marzo": 3, "mar": 3, "march": 3,
    "abril": 4, "abr": 4, "april": 4, "apr": 4,
    "mayo": 5, "may": 5,
    "junio": 6, "jun": 6, "june": 6,
    "julio": 7, "jul": 7, "july": 7,
    "agosto": 8, "ago": 8, "august": 8, "aug": 8,
    "septiembre": 9, "setiembre": 9, "sept": 9, "sep": 9, "september": 9,
    "octubre": 10, "oct": 10, "october": 10,
    "noviembre": 11, "nov": 11, "november": 11,
    "diciembre": 12, "dic": 12, "december": 12, "dec": 12,
}
_WEEKDAYS: Dict[str, int] = {
    "lunes": 0, "martes": 1, "miercoles": 2, "jueves": 3, "viernes": 4, "sabado": 5, "domingo": 6,
    "lun": 0, "mie": 2, "jue": 3, "vie": 4, "sab": 5, "dom": 6,
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5,
    "sunday": 6, "mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6,
}
_M = r"(" + "|".join(sorted(_MONTHS, key=len, reverse=True)) + r")\b\.?"
_W = r"(" + "|".join(sorted(_WEEKDAYS, key=len, reverse=True)) + r")\b\.?"
_SEP = r"\s*(?:al|a|hasta(?:\s+el)?|–|—|-)\s*"
_YR = r"(?:\s*(?:,|/)?\s*(?:de|del)?\s*(20\d{2})\b)?"

_P_RANGE_CROSS = re.compile(
    r"\b(\d{1,2})\s+(?:de\s+)?" + _M + r"(?:\s+(?:de|del)\s+(20\d{2}))?" + _SEP
    + r"(\d{1,2})\s+(?:de\s+)?" + _M + _YR)
_P_RANGE_SAME = re.compile(
    r"\b(\d{1,2})\s*(?:al|a|y|–|—|-)\s*(\d{1,2})\s+(?:de\s+)?" + _M + _YR)
_P_MONTH_FIRST = re.compile(
    _M + r"\s+(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\s*,\s*(20\d{2})\b")
_P_SINGLE = re.compile(r"(?:" + _W + r",?\s+)?\b(\d{1,2})\s+(?:de\s+)?" + _M + _YR)
_P_NUMERIC = re.compile(
    r"\b(\d{1,2})/(\d{1,2})/(20\d{2})\b(?:\s*[-–]\s*(\d{1,2})/(\d{1,2})/(20\d{2})\b)?")
_P_ISO = re.compile(r"\b(20\d{2})-(\d{2})-(\d{2})(?:[t ](\d{2}):(\d{2}))?")

_T12 = re.compile(r"\b(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?\s*m\b\.?")
_T24 = re.compile(r"\b([01]?\d|2[0-3]):([0-5]\d)\b")


def _mk(y: Optional[int], m: int, d: int) -> Optional[date]:
    if y is None:
        return None
    try:
        return date(y, m, d)
    except ValueError:
        return None


def parse_time_text(text: Any) -> Optional[str]:
    """First clock time in `text` -> 'HH:MM' (Bogotá wall clock). '7:00 p.m.' -> '19:00'."""
    t = fold(text)
    best: Optional[Tuple[int, str]] = None
    for m in _T12.finditer(t):
        h = int(m.group(1))
        mi = int(m.group(2) or 0)
        if not (1 <= h <= 12 and 0 <= mi <= 59):
            continue
        h = (h % 12) + (12 if m.group(3) == "p" else 0)
        best = (m.start(), f"{h:02d}:{mi:02d}")
        break
    for m in _T24.finditer(t):
        tail = t[m.end():m.end() + 6]
        if re.match(r"\s*[ap]\.?\s*m\b", tail):
            continue  # a 12h time already handled above
        if best is None or m.start() < best[0]:
            best = (m.start(), f"{int(m.group(1)):02d}:{m.group(2)}")
        break
    return best[1] if best else None


_Cand = Tuple[str, str, Optional[str]]  # (start_date, end_date, start_time)


@lru_cache(maxsize=4096)
def _parse_cands_cached(t: str, year_hint: Optional[int]) -> Tuple[_Cand, ...]:
    raw: List[Tuple[int, int, date, date, Optional[str]]] = []  # (pos, end, start, end, iso_time)

    for m in _P_RANGE_CROSS.finditer(t):
        d1, mo1, y1, d2, mo2, y2 = m.groups()
        m1, m2 = _MONTHS[mo1], _MONTHS[mo2]
        ye = int(y2) if y2 else (int(y1) if y1 else year_hint)
        ys = int(y1) if y1 else (None if ye is None else (ye - 1 if m1 > m2 else ye))
        s, e = _mk(ys, m1, int(d1)), _mk(ye, m2, int(d2))
        if s and e and s <= e:
            raw.append((m.start(), m.end(), s, e, None))
    for m in _P_RANGE_SAME.finditer(t):
        d1, d2, mo, y = m.groups()
        yy = int(y) if y else year_hint
        s, e = _mk(yy, _MONTHS[mo], int(d1)), _mk(yy, _MONTHS[mo], int(d2))
        if s and e and s <= e:
            raw.append((m.start(), m.end(), s, e, None))
    for m in _P_MONTH_FIRST.finditer(t):
        mo, d1, d2, y = m.groups()
        s = _mk(int(y), _MONTHS[mo], int(d1))
        e = _mk(int(y), _MONTHS[mo], int(d2)) if d2 else s
        if s and e and s <= e:
            raw.append((m.start(), m.end(), s, e, None))
    for m in _P_SINGLE.finditer(t):
        wd, d1, mo, y = m.groups()
        yy = int(y) if y else year_hint
        s = _mk(yy, _MONTHS[mo], int(d1))
        if s is None:
            continue
        if wd and _WEEKDAYS[wd] != s.weekday():
            continue  # weekday contradicts the date: never guess (research: resolve year by weekday)
        raw.append((m.start(), m.end(), s, s, None))
    for m in _P_NUMERIC.finditer(t):
        d1, mo1, y1, d2, mo2, y2 = m.groups()
        s = _mk(int(y1), int(mo1), int(d1))
        e = _mk(int(y2), int(mo2), int(d2)) if d2 else s
        if s and e and s <= e:
            raw.append((m.start(), m.end(), s, e, None))
    for m in _P_ISO.finditer(t):
        y, mo, d, hh, mi = m.groups()
        s = _mk(int(y), int(mo), int(d))
        if s:
            tm = f"{int(hh):02d}:{mi}" if hh is not None and int(hh) < 24 and int(mi) < 60 else None
            raw.append((m.start(), m.end(), s, s, tm))
    if not raw:
        return ()

    # Non-overlapping spans, left to right; on a tie the widest (range) match wins.
    raw.sort(key=lambda c: (c[0], -(c[1] - c[0])))
    chosen: List[List[Any]] = []
    last_end = -1
    for pos, stop, s, e, tm in raw:
        if pos < last_end:
            continue
        if chosen and (chosen[-1][2], chosen[-1][3]) == (s, e):
            chosen[-1][1] = stop           # same dates repeated back to back: one mention
            chosen[-1][4] = chosen[-1][4] or tm
        else:
            chosen.append([pos, stop, s, e, tm])
        last_end = stop

    out: List[_Cand] = []
    for i, (pos, stop, s, e, tm) in enumerate(chosen):
        nxt = chosen[i + 1][0] if i + 1 < len(chosen) else len(t)
        if tm is None:
            tm = parse_time_text(t[stop:nxt])
        if tm is None and len(chosen) == 1:
            tm = parse_time_text(t[:pos])
        cand = (s.isoformat(), e.isoformat(), tm)
        if cand not in out:
            out.append(cand)
    return tuple(out)


def _hint(year_hint: Any) -> Optional[int]:
    return year_hint if isinstance(year_hint, int) and not isinstance(year_hint, bool) else None


def parse_date_candidates(text: Any, year_hint: Optional[int] = None) -> List[Dict[str, Optional[str]]]:
    """EVERY date (range) a snippet states, left to right, each with the first time that
    follows it: prose like 'abre el 31 de agosto … se celebrará del 6 al 11 de abril de 2027'
    yields two candidates. A candidate whose weekday contradicts its date is dropped."""
    t = fold(text)
    if not t.strip():
        return []
    return [{"start_date": a, "end_date": b, "start_time": c}
            for a, b, c in _parse_cands_cached(t, _hint(year_hint))]


def parse_date_text(text: Any, year_hint: Optional[int] = None) -> Optional[Dict[str, Optional[str]]]:
    """Verbatim date snippet -> its FIRST {start_date, end_date, start_time}, or None.

    Handles 'Del 9 al 17 de enero de 2027', '6 – 11 ABRIL 2027', 'Jueves 12 de noviembre',
    '15 Oct / 2026 Jue / 8:00 PM', 'Jue, 15/10/2026 - 20:00', 'enero 12, 2027 7:00 am',
    'Thursday 26 November 2026, 7.30pm', ISO dates. A year missing from the text comes
    from `year_hint`; with neither, None. A weekday that contradicts the date -> None."""
    cands = parse_date_candidates(text, year_hint)
    return cands[0] if cands else None


PLACEHOLDER_TIMES = frozenset({"00:00", "01:00", "07:00"})


def clean_time(value: Any, *, visible_confirmed: bool) -> Optional[str]:
    """§15 S1: placeholder times (00:00, 01:00, 07:00) become null unless visible text
    states them. Any non 'HH:MM' value -> None."""
    hm = _hm(value)
    if hm is None:
        return None
    if hm in PLACEHOLDER_TIMES and not visible_confirmed:
        return None
    return hm


def is_jsonld_placeholder_date(start_date: Any, end_date: Any, fetched_at: Any) -> bool:
    """§15 R3 4c: JSON-LD start == end == fetch day (Bogotá) is a placeholder date."""
    fa = parse_iso(fetched_at)
    if fa is None or not isinstance(start_date, str) or not start_date:
        return False
    return start_date == (end_date or start_date) == bogota_today(fa)


# ── detectors (sentinel / adapters) ──────────────────────────────────────────

CANCEL_MARKER_RE = re.compile(
    r"\b(cancelad[oa]s?|suspendid[oa]s?|aplazad[oa]s?|postergad[oa]s?|reprogramad[oa]s?"
    r"|cancell?ed|postponed|called off)\b")
DEFAULT_CANCEL_BOILERPLATE: Tuple[str, ...] = (
    "si el evento es cancelado o aplazado", "si el evento es cancelado", "si el evento es aplazado",
    "si el evento es reprogramado", "en caso de que el evento sea cancelado",
    "en caso de cancelacion", "eventos cancelados", "if the event is cancelled",
    "if the event is canceled", "if an event is cancelled", "if an event is canceled",
    "in case of cancellation", "cancelled events", "canceled events",
)
_SOLD_OUT_RE = re.compile(r"\b(agotad[oa]s?|sold[\s-]?out)\b")
_FINISHED_RE = re.compile(r"\b(finalizad[oa]s?|terminad[oa]s?)\b")


def find_cancel_marker(event_text: Any, boilerplate: Iterable[str] = ()) -> Optional[str]:
    """Cancel marker inside the EVENT-SCOPED block only (§15 S2). Boilerplate phrases
    (defaults + per-adapter denylist) are removed first. Returns the folded marker."""
    t = " " + re.sub(r"\s+", " ", _prep_text(event_text)) + " "
    for phrase in list(DEFAULT_CANCEL_BOILERPLATE) + [fold(p) for p in boilerplate if p]:
        if phrase:
            t = t.replace(phrase, " ")
    m = CANCEL_MARKER_RE.search(t)
    return m.group(1) if m else None


def status_marker(status_element_text: Any) -> Optional[str]:
    """Only for the event's STATUS element (never a price/stage block): 'sold_out' |
    'finished' | None. The sentinel never sets expired from 'finished' (§15 S2)."""
    t = _prep_text(status_element_text)
    if _SOLD_OUT_RE.search(t):
        return "sold_out"
    if _FINISHED_RE.search(t):
        return "finished"
    return None


_CHALLENGE_BODY_RE = re.compile(
    r"just a moment|client challenge|waiting room|cf-mitigated|captcha", re.I)
_CHALLENGE_PATH_RE = re.compile(r"cookiewarning|pkpcontroller|waiting-?room|/challenge", re.I)
CHALLENGE_MAX_BODY = 15_000  # real pages carry reCAPTCHA scripts (CMF, La Tiquetera)


def is_challenge(status: Optional[int], headers: Optional[Mapping[str, str]], body: Any,
                 final_url: Any) -> bool:
    """Bot wall / waiting room / challenge page (§13 G, §15 S3)."""
    h = {str(k).lower(): str(v) for k, v in (headers or {}).items()}
    if "cf-mitigated" in h:
        return True
    try:
        path = (urlsplit(final_url).path + "?" + urlsplit(final_url).query) if isinstance(final_url, str) else ""
    except ValueError:
        path = ""
    if path and _CHALLENGE_PATH_RE.search(path):
        return True
    b = body if isinstance(body, str) else ""
    if len(b.encode("utf-8", "ignore")) < CHALLENGE_MAX_BODY and _CHALLENGE_BODY_RE.search(b):
        return True
    return False


def classify_fetch(status: Optional[int], headers: Optional[Mapping[str, str]], body: Any,
                   final_url: Any, *, expected_token: Optional[str] = None) -> str:
    """-> 'ok' | 'blocked' | 'gone' (§15 S3). `expected_token` (event slug or id) must
    appear in the final URL, else a redirect off the event page counts as gone."""
    if status is None:
        return "blocked"  # timeout / network error
    if is_challenge(status, headers, body, final_url):
        return "blocked"
    if status in (404, 410):
        return "gone"
    if status == 403 or status == 429 or status >= 500:
        return "blocked"
    if status != 200:
        return "blocked"
    if expected_token and isinstance(final_url, str) and fold(expected_token) not in fold(final_url):
        return "gone"
    return "ok"


_FREE_RE = re.compile(r"\b(gratis|entrada libre|sin costo|gratuit[oa])\b")
_FREE_QUALIFIERS = ("menores", "ninos", "parqueadero", "envio", "hasta completar", "zona")


def detect_is_free(event_text: Any, parsed_prices: Iterable[Any] = ()) -> bool:
    """§15 R6: true only when an unqualified free phrase is in event_text and no price > 0
    was parsed for the event."""
    for p in parsed_prices or ():
        f = _finite(p)
        if f is not None and f > 0:
            return False
    t = _prep_text(event_text)
    for m in _FREE_RE.finditer(t):
        window = t[max(0, m.start() - 40): m.end() + 40]
        if not any(q in window for q in _FREE_QUALIFIERS):
            return True
    return False


# ── §15 Q country gate ───────────────────────────────────────────────────────

_MAJOR_CO_CITIES = ("barranquilla", "valledupar", "bogota", "medellin", "cali", "santa marta",
                    "cucuta", "monteria", "sincelejo")
_NEAR_OR_FOREIGN = ("chaira", "caqueta", "chile", "valparaiso", "turbaco", "turbana", "arjona",
                    "santa catalina", "tolu", "covenas")
# Bolívar municipalities OUTSIDE the Distrito, and other countries. Event text routinely mentions
# them without placing the event there (artist bios "escenarios en México", "hamacas de San
# Jacinto", musicians "de Palenque"), so they FAIL only where the event is LOCATED: venue_name,
# address, ld_location — or event text in address form "<municipio>, Bolívar".
_NON_DISTRITO_BOLIVAR = ("mompox", "mompos", "magangue", "el carmen de bolivar", "maria la baja", "san jacinto",
                         "mahates", "san basilio de palenque", "palenque de san basilio", "galerazamba",
                         "san estanislao", "san juan nepomuceno", "arroyo hondo")
_FOREIGN_COUNTRIES = ("venezuela", "panama", "peru", "mexico", "ecuador", "republica dominicana",
                      "puerto cabello", "costa rica", "cuba", "argentina", "brasil", "brazil", "estados unidos")
_MUNI_BOLIVAR_RE = re.compile(
    r"\b(" + "|".join(re.escape(m) for m in _NON_DISTRITO_BOLIVAR) + r")\s*,\s*(?:departamento de\s+)?bolivar\b")
# Cartagena de Indias landmarks that contain a FAIL word; blanked before the scan.
_LANDMARK_EXCEPTIONS = ("santa catalina de alejandria", "baluarte de santa catalina",
                        "baluarte santa catalina")
_SPAIN_VENUES = ("auditorio el batel", "nuevo teatro circo", "teatro circo",
                 "plaza de espana cartagena", "parque torres", "castillo de la concepcion",
                 "palacio de deportes cartagena", "cartagena puerto de culturas")
_HAY_MARKERS = ("hay-on-wye", "hay on wye", "castle marquee", "richard booth", "segovia",
                "arequipa", "queretaro", "forum", "medellin", "jerico", "mompox")

_PAGE_EURO_RE = re.compile(
    r"€\s?\d|\d\s?€|\beur\s?\d|\d\s?eur\b|\"(?:price)?currency(?:code)?\"\s*:\s*\"eur\"")
_PLUS34_RE = re.compile(r"\(?\+\s?34\)?[\s.\-]?\d")
_MURCIA_RE = re.compile(r"\bmurcia\b")
_ESPANA_LOC_RE = re.compile(
    r"\(\s*(?:espana|spain)\s*\)"
    r"|\bcartagena\b[^<>{}\n/\"=]{0,60}?\bespana\b(?![-/])"
    r"|\"addresscountry\"\s*:\s*\"(?:es|esp|espana|spain)\"")
_POSTCODE_RE = re.compile(
    r"\bcartagena\b[^<>{}\n/\"=]{0,40}?\b30[23]\d\d\b|\b30[23]\d\d\b[^<>{}\n/\"=]{0,40}?\bcartagena\b")
_TZ_SPAIN_RE = re.compile(r"\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\+0[12]:?00\b")
_FEVER_SPAIN_PATH_RE = re.compile(r"/cartagena(?!-colombia)(?:/|$)")
_VIA_AL_MAR_RE = re.compile(r"\bvia al mar\b")
_MIN_DE_CTG_RE = re.compile(r"\ba\s+\d+\s*(?:min|mins|minutos|km|kms|kilometros)\.?\s+de\s+cartagena\b")
_DESDE_CTG_RE = re.compile(r"\bdesde cartagena\b")
_CLP_RE = re.compile(r"\bclp\b")
_PLUS56_RE = re.compile(r"\+\s?56\b")
_BOLIVAR_RE = re.compile(r"\bbolivar\b")
_COP_RE = re.compile(r"\bcop\b")
_PLUS57_RE = re.compile(r"\+\s?57\b")
_OK_TZ = frozenset({"z", "+00:00", "+0000", "+00", "-05:00", "-0500", "-05"})


def _ld_strings(ld: Any) -> List[str]:
    out: List[str] = []
    if isinstance(ld, Mapping):
        for k, v in ld.items():
            if k == "geo":
                continue
            out.extend(_ld_strings(v))
    elif isinstance(ld, (list, tuple)):
        for v in ld:
            out.extend(_ld_strings(v))
    elif isinstance(ld, str):
        out.append(ld)
    return out


def _ld_geo(ld: Any) -> Tuple[Optional[float], Optional[float]]:
    if not isinstance(ld, Mapping):
        return None, None
    g = ld.get("geo")
    if isinstance(g, Mapping):
        return _finite(g.get("latitude", g.get("lat"))), _finite(g.get("longitude", g.get("lng")))
    if isinstance(g, (list, tuple)) and len(g) == 2:
        return _finite(g[0]), _finite(g[1])
    return None, None


def _word_in(word: str, text: str) -> bool:
    return re.search(r"\b" + re.escape(word) + r"\b", text) is not None


def country_check(c: Mapping[str, Any]) -> Tuple[str, List[str]]:
    """§15 Q country gate. -> ('pass'|'fail', signals).

    Input keys: source_url, final_url?, page_text (RAW page, for page-level Spain signals
    only), event_text (ONLY the Event node / card / row whose date we took), ld_location
    {name, streetAddress, addressLocality, addressRegion, addressCountry, postalCode, geo},
    tz_offset, currency, country_iso, venue_name, address, lat, lng, geocode_source,
    venue_ambiguous (from geocode(): the gazetteer row is a name many cities share).
    Fails closed: PASS needs zero FAIL signals and at least one positive signal."""
    fails: List[str] = []
    passes: List[str] = []
    notes: List[str] = []

    # page level: URL rules
    urls = [u for u in (c.get("source_url"), c.get("final_url")) if isinstance(u, str) and u.strip()]
    for u in urls:
        host = _host(u)
        try:
            path = urlsplit(u.strip()).path.lower()
        except ValueError:
            path = ""
        if host == "es" or host.endswith(".es"):
            fails.append("page:es_domain")
        if registrable_domain(host) == "feverup.com" and _FEVER_SPAIN_PATH_RE.search(path):
            fails.append("page:fever_spain_city")
        if "atrapalo." in host and "/murcia/" in path:
            fails.append("page:atrapalo_murcia")

    # page level: raw page text (+ URLs)
    page = _prep_text(c.get("page_text"))
    if page:
        if _PAGE_EURO_RE.search(page):
            fails.append("page:euro")
        if _PLUS34_RE.search(page):
            fails.append("page:phone_34")
        if _MURCIA_RE.search(page):
            fails.append("page:murcia")
        if _ESPANA_LOC_RE.search(page):
            fails.append("page:espana")
        if _POSTCODE_RE.search(page):
            fails.append("page:postcode_30x")
        if "europe/madrid" in page:
            fails.append("page:europe_madrid")
        if _TZ_SPAIN_RE.search(page):
            fails.append("page:tz_spain")

    # event scope: event_text + ld_location + venue_name + address
    ld_raw = c.get("ld_location")
    ld: Mapping[str, Any] = ld_raw if isinstance(ld_raw, Mapping) else {}
    ld_text = _prep_text(" | ".join(_ld_strings(ld)))
    ev_raw = " | ".join(s for s in (c.get("event_text"), c.get("venue_name"), c.get("address"))
                        if isinstance(s, str) and s)
    ev = _prep_text(ev_raw)
    scope = re.sub(r"\s+", " ", ev + " | " + ld_text)
    scan = scope
    for lm in _LANDMARK_EXCEPTIONS:
        scan = scan.replace(lm, " ")
    has_cdi = "cartagena de indias" in scope
    ld_locality = _prep_text(" ".join(str(ld.get(k) or "") for k in ("addressLocality", "addressRegion")))
    # Where the event IS: venue, address, structured location. A place named here is never excused
    # by a festival name that happens to contain "Cartagena de Indias" (§15 Q3 intent).
    loc = re.sub(r"\s+", " ", _prep_text(" | ".join(s for s in (c.get("venue_name"), c.get("address"))
                                                    if isinstance(s, str) and s)) + " | " + ld_text)
    for lm in _LANDMARK_EXCEPTIONS:
        loc = loc.replace(lm, " ")

    for city in _MAJOR_CO_CITIES:
        if _word_in(city, scan):
            if has_cdi and not _word_in(city, ld_locality) and not _word_in(city, loc):
                notes.append(f"note:other_city_excepted:{city.replace(' ', '_')}")
            else:
                fails.append(f"event:other_city:{city.replace(' ', '_')}")
    for place in _NEAR_OR_FOREIGN:
        if _word_in(place, scan):
            fails.append(f"event:outside_distrito:{place.replace(' ', '_')}")
    for place in _NON_DISTRITO_BOLIVAR + _FOREIGN_COUNTRIES:
        if _word_in(place, loc):
            fails.append(f"event:location_outside:{place.replace(' ', '_')}")
    for m in _MUNI_BOLIVAR_RE.finditer(scan):
        fails.append(f"event:outside_distrito:{m.group(1).replace(' ', '_')}")
    if _VIA_AL_MAR_RE.search(scan):
        fails.append("event:via_al_mar")
    if _MIN_DE_CTG_RE.search(scan):
        fails.append("event:distance_from_cartagena")
    if _DESDE_CTG_RE.search(scan):
        fails.append("event:desde_cartagena")
    if _CLP_RE.search(scan):
        fails.append("event:clp")
    if _PLUS56_RE.search(scan):
        fails.append("event:phone_56")
    if _MURCIA_RE.search(scan):
        fails.append("event:murcia")
    if _ESPANA_LOC_RE.search(scan):
        fails.append("event:espana")
    if _PAGE_EURO_RE.search(scan):
        fails.append("event:euro")
    for v in _SPAIN_VENUES:
        if v in scan:
            fails.append("event:spain_venue")
            break

    # Hay editions: only on hayfestival.com, from the event node.
    src = c.get("source_url") if isinstance(c.get("source_url"), str) else ""
    if registrable_domain(src) == "hayfestival.com":
        try:
            hay_path = urlsplit(src).path.lower()
        except ValueError:
            hay_path = ""
        if "cartagena" not in hay_path:
            fails.append("event:hay_non_cartagena_path")
        for mk in _HAY_MARKERS:
            if mk in scan:
                fails.append(f"event:hay_edition:{mk.replace(' ', '_')}")

    # structured fields
    country_ld = fold(ld.get("addressCountry") or "").strip()
    if country_ld:
        if country_ld in ("es", "esp", "espana", "spain"):
            fails.append("event:address_country_es")
        elif country_ld not in ("co", "col", "colombia"):
            fails.append("event:address_country_foreign")
    iso = fold(c.get("country_iso") or "").strip()
    if iso and iso != "co":
        fails.append(f"event:country_iso_{iso}")
    cur = fold(c.get("currency") or "").strip()
    if cur in ("eur", "clp"):
        fails.append(f"event:currency_{cur}")
    tz = fold(c.get("tz_offset") or "").strip()
    if tz and tz not in _OK_TZ:
        fails.append("event:tz_offset_foreign")

    # A gazetteer hit on a row flagged `ambiguous` (a name every Colombian city has: Plaza de
    # Bolívar, Plaza de Toros, Centro de Convenciones…) is never the proof that the event is in
    # Cartagena: neither the name match nor the coordinates it produced count as a positive.
    # The coordinates may still be stored once another positive passes.
    ambiguous_venue = c.get("geocode_source") == "gazetteer" and c.get("venue_ambiguous") is True

    # geo
    lat, lng = _finite(c.get("lat")), _finite(c.get("lng"))
    if lat is None or lng is None:
        lat, lng = _ld_geo(ld)
    if lat is not None and lng is not None:
        if lat == 0 and lng == 0:
            notes.append("note:geo_null_island_ignored")
        elif is_placeholder_coord(lat, lng):
            notes.append("note:geo_placeholder_ignored")
        elif not in_distrito(lat, lng):
            fails.append("event:geo_outside_distrito")
        elif ambiguous_venue:
            notes.append("note:geo_from_ambiguous_venue_not_positive")
        else:
            passes.append("geo_in_distrito")

    # positives
    if ambiguous_venue:
        notes.append("note:venue_ambiguous_not_positive")
    elif c.get("geocode_source") in ("catalog", "gazetteer"):
        passes.append(f"venue_match:{c.get('geocode_source')}")
    if has_cdi:
        passes.append("cartagena_de_indias")
    elif _word_in("cartagena", scope) and (
            _BOLIVAR_RE.search(scope) or _COP_RE.search(scope) or _PLUS57_RE.search(scope)
            or cur == "cop" or iso == "co"):
        passes.append("cartagena_colombia_marker")
    dom = registrable_domain(src) or ""
    try:
        src_path = urlsplit(src).path.lower() if src else ""
    except ValueError:
        src_path = ""
    if dom in _TIER1_SCOPED_DOMAINS:
        passes.append(f"tier1_scoped:{dom}")
    elif dom == "hayfestival.com" and (src_path.startswith("/cartagena/")
                                       or re.match(r"^/m-\d+-cartagena-\d{4}\.aspx$", src_path)):
        passes.append("tier1_scoped:hayfestival.com")
    elif dom == "ironman.com" and "cartagena" in src_path:
        passes.append("tier1_scoped:ironman.com")

    signals: List[str] = []
    for s in [f"fail:{f}" for f in fails] + [f"pass:{p}" for p in passes] + notes:
        if s not in signals:
            signals.append(s)
    if fails:
        return "fail", signals
    if not passes:
        signals.append("fail:no_positive")
        return "fail", signals
    return "pass", signals


# ── §15 P identity ───────────────────────────────────────────────────────────


def match_key(title: Any, edition_year: Any, venue: Any, perf_date: Optional[str] = None) -> str:
    """norm(title)|edition_year|norm(venue) — no date. `perf_date` ('YYYY-MM-DD') is
    appended ONLY for distinct performances found on the same page (§15 P1)."""
    try:
        yr = int(edition_year)
    except (TypeError, ValueError):
        raise ValueError("edition_year is required")
    k = f"{norm(title)}|{yr}|{norm(venue)}"
    if perf_date:
        if _ymd(perf_date) is None:
            raise ValueError("perf_date must be YYYY-MM-DD")
        k += "|" + perf_date.replace("-", "")
    return k


def slug(title: Any, max_len: int = 56) -> str:
    s = norm(title).replace(" ", "-")[:max_len].strip("-")
    s = re.sub(r"-{2,}", "-", s)
    return s or "evento"


def make_event_id(title: Any, key: str, *, start_date: Optional[str] = None,
                  tbc_year: Optional[int] = None, tbc_month: Optional[int] = None) -> str:
    """ce-<slug≤56>-<yyyymmdd first seen | yyyymm+'tbc'>-<sha1(match_key)[:4]> (§15 P2).
    Minted once at insert and never recomputed."""
    if not isinstance(key, str) or not key:
        raise ValueError("match_key is required")
    h4 = hashlib.sha1(key.encode("utf-8")).hexdigest()[:4]
    if start_date is not None:
        if _ymd(start_date) is None:
            raise ValueError("start_date must be YYYY-MM-DD")
        part = start_date.replace("-", "")
    elif tbc_year is not None and tbc_month is not None and 1 <= int(tbc_month) <= 12:
        part = f"{int(tbc_year):04d}{int(tbc_month):02d}tbc"
    else:
        raise ValueError("start_date or (tbc_year, tbc_month) is required")
    eid = f"ce-{slug(title)}-{part}-{h4}"
    if len(eid) > 80 or not EVENT_ID_RE.match(eid):
        raise ValueError("event_id out of contract")
    return eid


def edition_year_from(text: Any, start_date: Optional[str] = None) -> Optional[int]:
    """Edition year stated in the source text ('... 2027'), else the start_date year."""
    m = re.search(r"\b(20[2-3]\d)\b", fold(text))
    if m:
        return int(m.group(1))
    d = _ymd(start_date)
    return d.year if d else None


# ── geocoding (catalog, then gazetteer; never placeholder coordinates) ───────

_MULTI_VENUE_RE = re.compile(
    r"\b(varios|varias|multiples|various|multiple|several|escenarios|sedes|toda la ciudad)\b")
_CTG_SUFFIX_RE = re.compile(r"\s+(?:de\s+)?cartagena(?:\s+de\s+indias)?(?:\s+colombia)?$")


def venue_keys(name: Any) -> List[str]:
    """Normalized match keys for a venue name: full, before '(' / ' - ' / ',' / '|', each
    also without a trailing 'Cartagena (de Indias)'. Empty for multi-venue names."""
    if not isinstance(name, str) or not name.strip():
        return []
    if _MULTI_VENUE_RE.search(fold(name)) or "·" in name:
        return []
    raw = [name, re.split(r"\(", name)[0], re.split(r"\s[-–|]\s", name)[0], name.split(",")[0]]
    keys: List[str] = []
    for r in raw:
        k = norm(r)
        for cand in (k, _CTG_SUFFIX_RE.sub("", k).strip()):
            if len(cand) >= 4 and cand not in keys:
                keys.append(cand)
    return keys


def _row_coords(row: Mapping[str, Any]) -> Tuple[Optional[float], Optional[float]]:
    lat, lng = _finite(row.get("lat")), _finite(row.get("lng"))
    if lat is None or lng is None:
        loc = row.get("location")
        if isinstance(loc, Mapping):
            lat = _finite(loc.get("lat", loc.get("latitude")))
            lng = _finite(loc.get("lng", loc.get("longitude")))
    if lat is None or lng is None:
        g = row.get("geo")
        if isinstance(g, Mapping) and isinstance(g.get("coordinates"), (list, tuple)) and len(g["coordinates"]) == 2:
            lng, lat = _finite(g["coordinates"][0]), _finite(g["coordinates"][1])
    return lat, lng


def _row_keys(row: Mapping[str, Any]) -> List[str]:
    keys = venue_keys(row.get("name"))
    for a in row.get("aliases") or []:
        for k in venue_keys(a):
            if k not in keys:
                keys.append(k)
    return keys


def _pick(rows: Sequence[Mapping[str, Any]], keys: List[str], address: Any) -> Optional[Mapping[str, Any]]:
    hits = []
    for row in rows or []:
        if not isinstance(row, Mapping):
            continue
        lat, lng = _row_coords(row)
        if lat is None or lng is None or (lat == 0 and lng == 0) or is_placeholder_coord(lat, lng):
            continue
        if set(keys) & set(_row_keys(row)):
            hits.append(row)
    if not hits:
        return None
    distinct = {(round(_row_coords(r)[0] or 0, 3), round(_row_coords(r)[1] or 0, 3)) for r in hits}
    if len(distinct) == 1:
        return hits[0]
    a = norm(address)
    if a:
        narrowed = [r for r in hits if a and (a in norm(r.get("address")) or norm(r.get("address")) in a)
                    and norm(r.get("address"))]
        nd = {(round(_row_coords(r)[0] or 0, 3), round(_row_coords(r)[1] or 0, 3)) for r in narrowed}
        if len(nd) == 1:
            return narrowed[0]
    return None  # ambiguous: never guess


def geocode(venue_name: Any, address: Any, catalog_rows: Sequence[Mapping[str, Any]],
            gazetteer_rows: Sequence[Mapping[str, Any]]) -> Optional[Dict[str, Any]]:
    """Venue -> {lat, lng, geocode_source, venue_id} from the catalog, then the gazetteer,
    by normalized-name match. Never returns placeholder coordinates; ambiguous or
    multi-venue names -> None."""
    keys = venue_keys(venue_name)
    if not keys:
        return None
    row = _pick(catalog_rows, keys, address)
    if row is not None:
        lat, lng = _row_coords(row)
        vid = row.get("partner_id") or row.get("venue_id") or row.get("id")
        return {"lat": lat, "lng": lng, "geocode_source": "catalog",
                "venue_id": str(vid) if vid else None}
    row = _pick(gazetteer_rows, keys, address)
    if row is not None:
        lat, lng = _row_coords(row)
        vid = row.get("partner_id") or row.get("venue_id")
        hit: Dict[str, Any] = {"lat": lat, "lng": lng, "geocode_source": "gazetteer",
                               "venue_id": str(vid) if vid else None}
        if row.get("ambiguous") is True:
            hit["venue_ambiguous"] = True  # country_check: never the only proof of Cartagena
        return hit
    return None


# ── §4 + §15 R verification gate ─────────────────────────────────────────────


def _out(status: str, reason: Optional[str], confidence: str, notif: bool) -> Dict[str, Any]:
    return {"status": status, "status_reason": reason, "confidence": confidence,
            "notif_eligible": bool(notif)}


def _is_sticky(status: Any, reason: Any) -> bool:
    if status == "hidden":
        return True
    return status == "review" and reason in STICKY_REVIEW_REASONS


def _year_hint(doc: Mapping[str, Any]) -> Optional[int]:
    ey = doc.get("edition_year")
    if isinstance(ey, int) and not isinstance(ey, bool):
        return ey
    d = _ymd(doc.get("start_date"))
    return d.year if d else None


# A snippet that says the event (or its venue/time) is not confirmed can never support HIGH
# (research: official rows marked 'Baluarte San Miguel – por confirmar' map to VERIFY).
_TBC_MARKER_RE = re.compile(
    r"\b(por confirmar|por definir|pendiente(?:s)? de confirma\w*|sujeto a cambios|to be confirmed"
    r"|to be announced|tbc|tba)\b")


class _Ev:
    __slots__ = ("url", "tier", "group", "fetched", "visible", "cands", "tbc", "ok")

    def __init__(self) -> None:
        self.url = ""
        self.tier: Optional[int] = None
        self.group = ""
        self.fetched: Optional[datetime] = None
        self.visible = False
        self.cands: List[Tuple[date, date, Optional[str]]] = []
        self.tbc = False
        self.ok = False

    def states(self, start: date) -> bool:
        return any(c[0] == start for c in self.cands)

    def times_for(self, start: date) -> List[str]:
        return [c[2] for c in self.cands if c[0] == start and c[2]]

    def overlaps(self, start: date, end: date) -> bool:
        return any(c[0] <= end and c[1] >= start for c in self.cands)


def _url_key(u: str) -> str:
    try:
        p = urlsplit(u.strip())
    except ValueError:
        return u.strip()
    return f"{(p.hostname or '').lower()}{p.path.rstrip('/')}?{p.query}"


def _evidence(doc: Mapping[str, Any]) -> List[_Ev]:
    """Newest evidence entry per URL (§15 R2), parsed. Superseded fetches never count."""
    newest: Dict[str, Tuple[datetime, Mapping[str, Any]]] = {}
    floor = datetime(1970, 1, 1, tzinfo=timezone.utc)
    for e in doc.get("evidence") or []:
        if not isinstance(e, Mapping) or not is_http_url(e.get("url")):
            continue
        k = _url_key(e["url"])
        fa = parse_iso(e.get("fetched_at")) or floor
        if k not in newest or fa >= newest[k][0]:
            newest[k] = (fa, e)
    hint = _year_hint(doc)
    out: List[_Ev] = []
    for fa, e in newest.values():
        ev = _Ev()
        ev.url = e["url"]
        ev.tier = domain_tier(e["url"], e.get("tier"))
        ev.group = mirror_group(e["url"])
        ev.fetched = fa if fa != floor else None
        hs = e.get("http_status")
        ev.ok = ev.tier is not None and (hs is None or (isinstance(hs, int) and 200 <= hs < 300))
        dt = e.get("date_text")
        if isinstance(e.get("date_visible"), bool):
            ev.visible = e["date_visible"]
        elif isinstance(e.get("visible"), bool):      # events_sources.make_candidate spelling
            ev.visible = e["visible"]
        else:
            ev.visible = (e.get("date_source") != "jsonld" and isinstance(dt, str)
                          and bool(dt.strip()) and not _ISO_ONLY_RE.match(dt))
        ev.tbc = isinstance(dt, str) and bool(_TBC_MARKER_RE.search(fold(dt)))
        sd = _ymd(e.get("start_date"))
        if sd is not None:
            ev.cands = [(sd, _ymd(e.get("end_date")) or sd, _hm(e.get("start_time")))]
        elif isinstance(dt, str) and dt.strip():
            for c in parse_date_candidates(dt, hint):
                cs, ce = _ymd(c["start_date"]), _ymd(c["end_date"])
                if cs is not None and ce is not None:
                    ev.cands.append((cs, ce, c["start_time"]))
        out.append(ev)
    return out


def independent_agreement(entries: Sequence[Mapping[str, Any]], start_date: str,
                          start_time: Optional[str] = None, *, year_hint: Optional[int] = None,
                          max_tier: int = 3) -> bool:
    """§15 R1 / S3: True when ≥2 INDEPENDENT pages (different mirror groups) of tier ≤
    `max_tier`, fetched in the same run, state `start_date` (and `start_time` when given).
    The only automatic way to clear a sticky review or apply a sentinel date change."""
    target = _ymd(start_date)
    if target is None:
        return False
    hint = year_hint if isinstance(year_hint, int) else target.year
    groups = set()
    for e in entries or []:
        if not isinstance(e, Mapping) or not is_http_url(e.get("url")):
            continue
        hs = e.get("http_status")
        if hs is not None and not (isinstance(hs, int) and 200 <= hs < 300):
            continue
        tier = domain_tier(e["url"], e.get("tier"))
        if tier is None or tier > max_tier:
            continue
        dt = e.get("date_text")
        if isinstance(dt, str) and _TBC_MARKER_RE.search(fold(dt)):
            continue
        sd = _ymd(e.get("start_date"))
        stated: List[Tuple[Optional[date], Optional[str]]]
        if sd is not None:
            stated = [(sd, _hm(e.get("start_time")))]
        else:
            stated = [(_ymd(c["start_date"]), c["start_time"]) for c in parse_date_candidates(dt, hint)]
        if any(d == target and (start_time is None or tm == start_time) for d, tm in stated):
            groups.add(mirror_group(e["url"]))
    return len(groups) >= 2


def _live_until_passed(start: date, end: date, start_time: Optional[str], end_time: Optional[str],
                       now_b: datetime) -> bool:
    """True when the event is over in Bogotá (§4 rule 5)."""
    today = now_b.date()
    if end < today:
        return True
    if end > today:
        return False
    if start_time and end_time and end_time < start_time:
        return False  # overnight session: runs past midnight
    cutoff = end_time or start_time
    if cutoff is None:
        return False
    return cutoff < now_b.strftime("%H:%M")


def evaluate(doc: Mapping[str, Any], now_utc: Optional[datetime]) -> Dict[str, Any]:
    """§4 + §15 R verification gate. Pure; returns ONLY {status, status_reason, confidence,
    notif_eligible}. status 'drop' means: never store / never serve (rule 1)."""
    now = _as_utc(now_utc)
    now_b = now.astimezone(BOGOTA)
    today = now_b.date()
    stored_status, stored_reason = doc.get("status"), doc.get("status_reason")

    # 1. a real http(s) source_url we can stand behind
    src = doc.get("source_url")
    if not is_http_url(src) or registrable_domain(src) in DENY_DOMAINS:
        return _out("drop", "no_source", "VERIFY", False)

    # 2. stored country verdict (§15 Q6); missing -> fail closed without poisoning
    cc = doc.get("country_check")
    if cc == "fail":
        return _out("hidden", "country_fail", "VERIFY", False)
    if cc != "pass":
        if _is_sticky(stored_status, stored_reason):
            return _out(str(stored_status), stored_reason, "VERIFY", False)
        return _out("review", "country_unchecked", "VERIFY", False)

    # 3. sticky states (§15 R1)
    if _is_sticky(stored_status, stored_reason):
        return _out(str(stored_status), stored_reason, "VERIFY", False)

    origin = doc.get("origin")
    is_partner = origin == "partner"
    evs = [e for e in _evidence(doc) if e.ok]
    lv = parse_iso(doc.get("last_verified"))
    start = _ymd(doc.get("start_date"))
    end = _ymd(doc.get("end_date")) or start

    def _source_rules() -> Optional[Dict[str, Any]]:
        """Shared rules 6b / 7 that also bind date_tbc rows."""
        if lv is None:
            return _out("review", "unverified", "VERIFY", False)
        if now - lv > STALE_LONG_AGE:
            return _out("review", "stale_long", "VERIFY", False)
        if is_partner:
            if doc.get("moderation_status") != "approved":
                return _out("review", "partner_pending", "VERIFY", False)
            return None
        if not evs:
            return _out("review", "no_evidence", "VERIFY", False)
        if min(e.tier or 6 for e in evs) >= 6:
            return _out("review", "aggregator_only", "VERIFY", False)
        return None

    # 4. dates unknown / unannounced -> date_tbc (bounded by tbc_window_end)
    if start is None:
        twe = _ymd(doc.get("tbc_window_end"))
        if twe is None:
            return _out("review", "tbc_no_window", "VERIFY", False)
        if today > twe:
            return _out("expired", "tbc_window_passed", "VERIFY", False)
        blocked = _source_rules()
        if blocked:
            return blocked
        return _out("date_tbc", None, "VERIFY", False)

    if end is None or end < start:
        return _out("review", "bad_dates", "VERIFY", False)

    is_umbrella = bool(doc.get("is_umbrella"))
    parent_id = doc.get("parent_id")

    # 4b. long span without an umbrella relation
    if (end - start).days > LONG_SPAN_DAYS and not parent_id and not is_umbrella:
        return _out("review", "long_span", "VERIFY", False)

    matching = [e for e in evs if e.states(start)]
    # 4c. JSON-LD start == end == fetch day is a placeholder date
    if start == end and matching and all(
            (not e.visible) and e.fetched is not None and e.fetched.astimezone(BOGOTA).date() == start
            for e in matching):
        return _out("review", "placeholder_date", "VERIFY", False)

    start_time = _hm(doc.get("start_time"))
    end_time = _hm(doc.get("end_time"))

    # 5. expired (Bogotá date + time)
    if _live_until_passed(start, end, start_time, end_time, now_b):
        return _out("expired", None, "VERIFY", False)

    # 6. confidence (§15 R2: newest evidence per URL; MIRRORS count once)
    reason: Optional[str] = None
    solid = [e for e in matching if not e.tbc]   # 'por confirmar' snippets never support HIGH
    time_conflict = bool(start_time) and any(
        e.tier is not None and e.tier <= 3 and e.times_for(start)
        and start_time not in e.times_for(start) for e in solid)
    high_a = any(
        e.tier is not None and e.tier <= 3 and e.visible
        and (start_time is None or start_time in e.times_for(start)) for e in solid)
    high_b = False
    for a in solid:
        if a.tier is None or a.tier > 3:
            continue
        if any(b is not a and b.tier is not None and b.tier <= 5 and b.group != a.group for b in solid):
            high_b = True
            break
    confidence = "HIGH" if (high_a or high_b) else "VERIFY"

    # caps: each forces VERIFY and names itself as the reason (first one wins)
    caps: List[str] = []
    if time_conflict:
        caps.append("time_conflict")          # a tier<=3 page states another time (§15 S3)
    nf, bd = doc.get("not_found_count"), doc.get("blocked_days")
    if isinstance(nf, int) and not isinstance(nf, bool) and nf >= 1:
        caps.append("not_found")              # §15 S3: first not_found -> VERIFY at once
    if isinstance(bd, int) and not isinstance(bd, bool) and bd >= 3:
        caps.append("blocked")                # §13 G: blocked 3 consecutive days -> VERIFY
    if doc.get("confidence_cap") == "VERIFY":
        caps.append("confidence_cap")
    window = doc.get("recent_confirmation_days")
    if confidence == "HIGH" and isinstance(window, int) and not isinstance(window, bool) and window > 0:
        floor_day = start - timedelta(days=window)
        recent = [e for e in solid if e.tier is not None and e.tier <= 3 and e.fetched is not None
                  and e.fetched.astimezone(BOGOTA).date() >= floor_day]
        if not recent:
            caps.append("awaiting_recent_confirmation")   # §15 W1
    if caps:
        confidence, reason = "VERIFY", caps[0]
    if is_partner:
        confidence = "VERIFY"
    # staleness decay: HIGH needs a verification in the last 72 h
    if confidence == "HIGH" and (lv is None or now - lv > HIGH_MAX_AGE):
        confidence, reason = "VERIFY", "stale"

    # 6b + 7. staleness bound, partner moderation, aggregator-only, conflict
    blocked = _source_rules()
    if blocked:
        return blocked
    if not is_partner:
        for e in evs:
            # a source (tier <= 5) whose stated dates never overlap ours contradicts them
            if e.tier is not None and e.tier <= 5 and e.cands and not e.overlaps(start, end):
                return _out("review", "conflict", "VERIFY", False)

    status = "published"

    # 8. notif_eligible (§4 rule 8 + §15 R5)
    notif = False
    geo_ok = (doc.get("geocode_source") in ("catalog", "gazetteer")
              and _valid_geo(doc.get("lat"), doc.get("lng")))
    if (confidence == "HIGH" and not is_partner and not doc.get("sold_out") and geo_ok
            and not parent_id and not is_umbrella
            and (end - start).days <= NOTIF_MAX_SPAN_DAYS
            and start_time is not None and doc.get("time_confirmed") is True):
        today_start = datetime.combine(today, time.fromisoformat(start_time), BOGOTA)
        first_start = datetime.combine(start, time.fromisoformat(start_time), BOGOTA)
        if first_start > now_b:
            notif = True
        elif start < today <= end and today_start > now_b:
            notif = True

    return _out(status, reason, confidence, notif)


# ── §13 B read-time truth ────────────────────────────────────────────────────

PUBLIC_FIELDS: Tuple[str, ...] = (
    "event_id", "title", "description", "category", "start_date", "end_date", "start_time",
    "end_time", "date_tbc_note", "venue_name", "zone", "lat", "lng", "price", "ticket_url",
    "source_url", "source_name", "second_source_name", "last_verified", "confidence", "status",
    "sold_out", "image_url", "image_credit", "notif_eligible", "parent_id", "is_verified",
    "origin", "status_reason", "address", "is_umbrella", "prominence", "flagship",
)


# ── §16.1 prominence (pure, deterministic) ───────────────────────────────────

PROMINENCE_CATEGORY: Dict[str, int] = {
    "festival": 40, "concert": 35, "sports": 25, "cultural": 20,
    "gastronomic": 15, "family": 15, "nightlife": 10, "civic": 10,
}
PROMINENCE_FLAGSHIP = 50
PROMINENCE_UMBRELLA = 10
PROMINENCE_TIER1 = 10
PROMINENCE_HIGH = 10
PROMINENCE_SUB_EVENT = -10
PROMINENCE_PARTNER = -5


def is_series(doc: Mapping[str, Any]) -> bool:
    """Recurring / evergreen rows (a weekly night, a standing tour, a run with no single date)."""
    flags = doc.get("flags")
    return (doc.get("series") is True or doc.get("recurring") is True or bool(doc.get("recurrence_rule"))
            or (isinstance(flags, (list, tuple)) and "series" in flags))


def is_long_span(doc: Mapping[str, Any]) -> bool:
    """§15 R3 4b: more than 21 days with no parent and not an umbrella (or already held for it)."""
    if doc.get("status_reason") == "long_span":
        return True
    s, e = _ymd(doc.get("start_date")), _ymd(doc.get("end_date"))
    return (s is not None and e is not None and (e - s).days > LONG_SPAN_DAYS
            and not doc.get("parent_id") and not doc.get("is_umbrella"))


def prominence(doc: Mapping[str, Any]) -> int:
    """§16.1: how strongly a row is promoted (Destacados, featured, Luna, within-day order).
    Category base (festival 40, concert 35, sports 25, cultural 20, gastronomic/family 15,
    nightlife/civic 10; unknown = cultural) + flagship 50 + umbrella 10 + tier-1 source 10 +
    HIGH 10 − sub-event 10 − partner origin 5. Recurring/evergreen ('series') and long_span rows
    are never promoted: 0. Pure; `confidence` is whatever the doc carries (public_view passes
    the read-time value). flagship counts only as a literal True (anchors / registry allowlist)."""
    if is_series(doc) or is_long_span(doc):
        return 0
    cat = doc.get("category") if doc.get("category") in PROMINENCE_CATEGORY else "cultural"
    score = PROMINENCE_CATEGORY[str(cat)]
    if doc.get("flagship") is True:
        score += PROMINENCE_FLAGSHIP
    if doc.get("is_umbrella") is True:
        score += PROMINENCE_UMBRELLA
    if domain_tier(doc.get("source_url"), doc.get("source_tier")) == 1:
        score += PROMINENCE_TIER1
    if doc.get("confidence") == "HIGH":
        score += PROMINENCE_HIGH
    if isinstance(doc.get("parent_id"), str) and doc.get("parent_id"):
        score += PROMINENCE_SUB_EVENT
    if doc.get("origin") == "partner":
        score += PROMINENCE_PARTNER
    return score


def prominence_sort_key(pv: Mapping[str, Any]) -> Tuple[int, str, str]:
    """§16.1 featured / Luna order: prominence desc, then start_date, then start_time (nulls last)."""
    p = pv.get("prominence")
    pr = p if isinstance(p, int) and not isinstance(p, bool) else 0
    return (-pr, pv.get("start_date") or "9999-99-99", pv.get("start_time") or "99:99")


def _l4(v: Any) -> Dict[str, str]:
    if isinstance(v, str):
        return {"es": v} if v.strip() else {}
    if isinstance(v, Mapping):
        out: Dict[str, str] = {}
        for k in ("es", "en", "fr", "pt"):
            s = v.get(k)
            if isinstance(s, str) and s.strip():
                out[k] = s
        return out
    return {}


def _cop(v: Any) -> Optional[int]:
    f = _finite(v)
    if f is None or f <= 0:
        return None
    return int(round(f))


def _norm_price(raw: Any) -> Dict[str, Any]:
    p: Mapping[str, Any] = raw if isinstance(raw, Mapping) else {}
    min_cop, max_cop = _cop(p.get("min_cop")), _cop(p.get("max_cop"))
    is_free = p.get("is_free") if isinstance(p.get("is_free"), bool) else None
    if is_free is True and ((min_cop or 0) > 0 or (max_cop or 0) > 0):
        is_free = False  # a parsed price > 0 contradicts "free" (§15 R6)
    raw_text = p.get("text")
    text = raw_text if isinstance(raw_text, str) and raw_text.strip() else None
    return {"is_free": is_free, "min_cop": min_cop, "max_cop": max_cop, "text": text}


def public_view(doc: Mapping[str, Any], now_utc: Optional[datetime], sentinel_healthy: bool) -> Optional[Dict[str, Any]]:
    """PublicEvent for ANY status (feed/item needs hidden/expired too), re-evaluated now.
    None for dropped rows. Hidden/review rows get dates, times, tbc note and ticket_url
    nulled. An unhealthy sentinel serves every row as VERIFY, never notif-eligible."""
    ev = evaluate(doc, now_utc)
    status = ev["status"]
    if status == "drop":
        return None
    confidence, notif, reason = ev["confidence"], ev["notif_eligible"], ev["status_reason"]
    if not sentinel_healthy:
        confidence, notif = "VERIFY", False
        if status == "published" and reason is None:
            reason = "sentinel_unhealthy"

    is_umbrella = bool(doc.get("is_umbrella"))
    geocoded = (doc.get("geocode_source") in GEOCODE_SOURCES and not is_umbrella
                and _valid_geo(doc.get("lat"), doc.get("lng")))
    ticket = doc.get("ticket_url") if is_http_url(doc.get("ticket_url")) else None
    img = doc.get("image_url")
    img = img if isinstance(img, str) and img.startswith("/images/") and ".." not in img else None
    cat = doc.get("category") if doc.get("category") in CATEGORIES else "cultural"
    tbc_note = _l4(doc.get("date_tbc_note")) or None

    pv: Dict[str, Any] = {
        "event_id": doc.get("event_id"),
        "title": _l4(doc.get("title")),
        "description": _l4(doc.get("description")),
        "category": cat,
        "start_date": doc.get("start_date") if _ymd(doc.get("start_date")) else None,
        "end_date": (doc.get("end_date") if _ymd(doc.get("end_date")) else
                     (doc.get("start_date") if _ymd(doc.get("start_date")) else None)),
        "start_time": _hm(doc.get("start_time")),
        "end_time": _hm(doc.get("end_time")),
        "date_tbc_note": tbc_note,
        "venue_name": doc.get("venue_name") if isinstance(doc.get("venue_name"), str) else None,
        "zone": doc.get("zone") if isinstance(doc.get("zone"), str) else None,
        "lat": float(doc["lat"]) if geocoded else None,
        "lng": float(doc["lng"]) if geocoded else None,
        "price": _norm_price(doc.get("price")),
        "ticket_url": ticket,
        "source_url": doc.get("source_url"),
        "source_name": doc.get("source_name") if isinstance(doc.get("source_name"), str) else None,
        "second_source_name": doc.get("second_source_name") if isinstance(doc.get("second_source_name"), str) else None,
        "last_verified": doc.get("last_verified") if isinstance(doc.get("last_verified"), str) else (
            iso_utc(doc["last_verified"]) if isinstance(doc.get("last_verified"), datetime) else None),
        "confidence": confidence,
        "status": status,
        "sold_out": bool(doc.get("sold_out")),
        "image_url": img,
        "image_credit": doc.get("image_credit") if img and isinstance(doc.get("image_credit"), str) else None,
        "notif_eligible": bool(notif),
        "parent_id": doc.get("parent_id") if isinstance(doc.get("parent_id"), str) else None,
        "is_verified": confidence == "HIGH",
        "origin": doc.get("origin") if isinstance(doc.get("origin"), str) else None,
        "status_reason": reason,
        "address": doc.get("address") if isinstance(doc.get("address"), str) else None,
        "is_umbrella": is_umbrella,
        "prominence": prominence({**doc, "category": cat, "confidence": confidence}),
        "flagship": doc.get("flagship") is True,
    }
    if status in ("hidden", "review"):
        for k in ("start_date", "end_date", "start_time", "end_time", "date_tbc_note", "ticket_url"):
            pv[k] = None
    if status == "date_tbc":
        for k in ("start_date", "end_date", "start_time", "end_time"):
            pv[k] = None
    return pv


def public_sort_key(pv: Mapping[str, Any]) -> Tuple[str, int, str]:
    """start_date (nulls last), then — within a day — prominence desc (§16.1), then start_time
    (nulls last)."""
    p = pv.get("prominence")
    pr = p if isinstance(p, int) and not isinstance(p, bool) else 0
    return (pv.get("start_date") or "9999-99-99", -pr, pv.get("start_time") or "99:99")


# ── CMW conflict (docs/cmw/DESIGN.md §0) ─────────────────────────────────────
# The official Cartagena Music Week program is a curated dataset, separate from city_events:
# only it may state a time, a venue or a price for a Music Week event. A scraped or general row
# that names the brand (or one of its printed titles in its own title) is a conflict, dropped at
# read time by events_runtime so the two can never contradict each other on one screen.
CMW_ANCHOR_RE = re.compile(
    r"\bmusic[\s\-_]*week\b|\bcmw\b|\bvery[\s\-]+special[\s\-]+guest\b|\bzamna\b|\bstardust\b|\bsaraga\b"
    r"|\bwe[\s\-]+are[\s\-]+us\b")
CMW_TITLE_RE = re.compile(
    r"\bmain[\s\-]+event\b|\bafter[\s\-]+temple\b|\bafter[\s\-]+new[\s\-]+year\b"
    r"|\bcatamaran[\s\-]+sunset[\s\-]+party\b")


def _l4_values(v: Any) -> List[str]:
    if isinstance(v, str):
        return [v]
    if isinstance(v, Mapping):
        return [x for x in v.values() if isinstance(x, str)]
    return []


def cmw_conflict(doc: Mapping[str, Any]) -> bool:
    """True when a city_events doc names Cartagena Music Week: a CMW anchor term anywhere in the
    title or the description, or one of the printed CMW titles used as the row's own title."""
    title = fold(" ".join(_l4_values(doc.get("title"))))
    if CMW_ANCHOR_RE.search(title) or CMW_TITLE_RE.search(title):
        return True
    desc = fold(" ".join(_l4_values(doc.get("description"))))
    return bool(CMW_ANCHOR_RE.search(desc))
