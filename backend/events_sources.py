"""EVENTS-ELITE source adapters, polite fetch helper and SOURCES registry.

Spec: docs/events-elite/DESIGN.md §5, §13 F1/F2, §15 S1-S3 (precedence §15 > §13 > §1-§12).

Honesty spine (§0): every Candidate produced here comes from a page we fetched ourselves and was
parsed deterministically. Nothing in this module calls an LLM, invents a date, or fills a field the
page does not state. When a page is ambiguous (visible date vs JSON-LD disagree, the weekday does not
match the date, a placeholder time, an older edition) the adapter drops the field or the whole row:
a missed event beats a wrong one.

Stdlib + httpx only (no bs4 / lxml).

Public surface (see the SOURCES registry at the bottom of the file):
    fetch(client, url, *, source, sched=None, url_guard=None, ...) -> FetchResult
    PoliteScheduler(deadline, max_domains=4)          (one in-flight request per domain, gaps, deadline)
    make_client(transport=None) -> httpx.AsyncClient
    SOURCES: list[dict]                                (registry, §13 F2 fields + adapter)
    adapter_for(doc) -> Adapter | None
    recheck_doc(client, doc, ...) -> Recheck           (adapter / generic / head dispatch)
    generic_recheck(client, doc, ...) -> Recheck
    head_recheck(client, doc, ...) -> Recheck
    Adapter.pull(client, deadline, *, offset=0, sched=None, checkpoint=None, now_utc=None) -> PullResult
    Adapter.recheck(client, doc, *, sched=None, cache=None, now_utc=None) -> Recheck
    parse_generic_jsonld(html, meta) -> (list[Candidate], skips)   (admin gate-check only, never pull)
    public_url_guard(url) -> refusal | None           (§15 X4; pass as fetch(url_guard=…))
    ld_placeholder_date(ld_start, ld_end, fetched_at) -> bool       (§15 R3 4c)
"""
from __future__ import annotations

import asyncio
import email.utils
import hashlib
import html as _html
import ipaddress
import json
import logging
import math
import re
import socket
import time
import unicodedata
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from typing import Any, AsyncIterator, Awaitable, Callable, Iterable, Mapping, Optional, Sequence
from urllib.parse import parse_qs, urljoin, urlsplit

import httpx

logger = logging.getLogger(__name__)

Candidate = dict[str, Any]
Recheck = dict[str, Any]
FetchResult = dict[str, Any]
PageMeta = dict[str, Any]

UA = "AMOLifeBot/1.0 (+https://www.amocartagena.co; contacto)"
FETCH_TIMEOUT_S = 8.0
MAX_BODY_BYTES = 1_500_000
MAX_REDIRECT_HOPS = 3
DISPATCH_BUDGET_S = 30.0
MAX_PARALLEL_DOMAINS = 4
DEFAULT_MIN_GAP_S = 1.0
SECUTIX_MIN_GAP_S = 6.0
PAGE_TEXT_CAP = 20_000
EVENT_TEXT_CAP = 2_000
SMALL_BODY_CHARS = 15_000

# Cartagena runs on UTC-5 with no DST; a fixed offset needs no tzdata on the Vercel runtime.
BOGOTA_TZ = timezone(timedelta(hours=-5), "America/Bogota")

# Hosts we never crawl automatically (§13 G: www.cartagena.gov.co sits behind a deliberate bot
# wall; its articles are anchor evidence only) and dead ends from §5 (eTicket DNS / spam takeover).
NEVER_CRAWL_HOSTS = ("cartagena.gov.co", "eticket.co", "eticket.com.co")

# §15 Q5 placeholder coordinates (mirrors events_gate.PLACEHOLDER_COORDS). Source coordinates that
# match one of these within 1e-3 are never passed on as "geocoded".
PLACEHOLDER_COORDS: tuple[tuple[float, float], ...] = (
    (10.4236, -75.5483),
    (10.3932277, -75.4832311),
    (10.3910, -75.4794),
    (10.3997, -75.5144),
)


# ════════════════════════════════════════════════════════════════════════════════════════════
# Time helpers
# ════════════════════════════════════════════════════════════════════════════════════════════
def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_utc(dt: Optional[datetime] = None) -> str:
    return (dt or utc_now()).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def bogota_today(now_utc: Optional[datetime] = None) -> date:
    return (now_utc or utc_now()).astimezone(BOGOTA_TZ).date()


def ymd(y: Any, m: Any, d: Any) -> Optional[str]:
    """'YYYY-MM-DD' for a real calendar date, else None (never raises)."""
    try:
        return date(int(y), int(m), int(d)).isoformat()
    except (TypeError, ValueError):
        return None


def _date_of(s: Optional[str]) -> Optional[date]:
    try:
        return date.fromisoformat(s) if s else None
    except ValueError:
        return None


# ════════════════════════════════════════════════════════════════════════════════════════════
# Text helpers (html -> visible text, folding, slugs)
# ════════════════════════════════════════════════════════════════════════════════════════════
_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)
_DROP_RE = re.compile(r"<(script|style|noscript|template|svg)\b[^>]*>.*?</\1\s*>", re.S | re.I)
_BLOCK_RE = re.compile(
    r"</?(?:br|p|div|li|ul|ol|h[1-6]|tr|td|th|table|tbody|thead|section|article|header|footer|nav|"
    r"main|aside|figure|figcaption|dd|dt|dl|blockquote|pre|form|fieldset|option|select|hr)\b[^>]*>",
    re.I,
)
_TAG_RE = re.compile(r"<[^>]+>")
_HSPACE_RE = re.compile(r"[ \t\r\f\v]+")
_SPACE_CHARS = {"\xa0": " ", " ": " ", " ": " ", " ": " ", "​": "", "﻿": "", "­": ""}


def _despace(s: str) -> str:
    for k, v in _SPACE_CHARS.items():
        s = s.replace(k, v)
    return s


def html_to_lines(fragment: str) -> list[str]:
    """Visible text of an HTML fragment, one entry per block-level line (scripts/styles dropped)."""
    s = _COMMENT_RE.sub(" ", fragment or "")
    s = _DROP_RE.sub(" ", s)
    s = _BLOCK_RE.sub("\n", s)
    s = _TAG_RE.sub(" ", s)
    s = _despace(_html.unescape(s))
    out: list[str] = []
    for line in s.split("\n"):
        line = _HSPACE_RE.sub(" ", line).strip()
        if line:
            out.append(line)
    return out


def html_to_text(fragment: str) -> str:
    return " ".join(html_to_lines(fragment))


def clean_text(s: Any) -> str:
    return _HSPACE_RE.sub(" ", _despace(_html.unescape(str(s or "")))).replace("\n", " ").strip()


def _fold_char(c: str) -> str:
    base = "".join(x for x in unicodedata.normalize("NFKD", c) if not unicodedata.combining(x)).lower()
    return base if len(base) == 1 else c.lower()[:1] or c


def fold(s: str) -> str:
    """Lowercase, accents stripped, LENGTH-PRESERVING (positions found in fold(s) index s itself).
    For matching only; never for stored text."""
    return "".join(_fold_char(c) for c in (s or ""))


def norm_key(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", fold(s)).strip()


def slugify(s: str, max_len: int = 56) -> str:
    return re.sub(r"[^a-z0-9]+", "-", fold(s)).strip("-")[:max_len].strip("-")


def page_title(html: str) -> str:
    m = re.search(r"<title[^>]*>(.*?)</title>", _COMMENT_RE.sub(" ", (html or "")[:200_000]), re.S | re.I)
    return clean_text(_TAG_RE.sub(" ", m.group(1))) if m else ""


def _first(pattern: str, s: str, flags: int = re.S) -> Optional[str]:
    m = re.search(pattern, s or "", flags)
    return m.group(1) if m else None


def _first_text(pattern: str, s: str, flags: int = re.S) -> Optional[str]:
    raw = _first(pattern, s, flags)
    if raw is None:
        return None
    t = html_to_text(raw)
    return t or None


def _cap(s: str, n: int) -> str:
    s = s or ""
    return s if len(s) <= n else s[:n]


def sentence_from(text: str, start: int, max_len: int = 320) -> str:
    """text from `start` to the end of that sentence (never pulls in the nav text before it)."""
    stop = [p for p in (text.find(". ", start), text.find("! ", start), text.find("? ", start)) if p >= 0]
    end = min(stop) + 1 if stop else len(text)
    return text[start:min(end, start + max_len)].strip()


def sentence_around(text: str, start: int, end: int, max_len: int = 320) -> str:
    """The sentence containing text[start:end] (bounded by . ! ? or max_len)."""
    left = max(text.rfind(". ", 0, start), text.rfind("! ", 0, start), text.rfind("? ", 0, start))
    left = left + 2 if left >= 0 else 0
    left = max(left, start - max_len // 2)
    right_candidates = [p for p in (text.find(". ", end), text.find("! ", end), text.find("? ", end)) if p >= 0]
    right = min(right_candidates) + 1 if right_candidates else len(text)
    right = min(right, end + max_len // 2)
    return text[left:right].strip()


# ════════════════════════════════════════════════════════════════════════════════════════════
# Dates and clock times (ES + EN), weekday-checked
# ════════════════════════════════════════════════════════════════════════════════════════════
_MONTH_NAMES: dict[str, int] = {
    "enero": 1, "ene": 1, "january": 1, "jan": 1,
    "febrero": 2, "feb": 2, "february": 2,
    "marzo": 3, "mar": 3, "march": 3,
    "abril": 4, "abr": 4, "april": 4, "apr": 4,
    "mayo": 5, "may": 5,
    "junio": 6, "jun": 6, "june": 6,
    "julio": 7, "jul": 7, "july": 7,
    "agosto": 8, "ago": 8, "august": 8, "aug": 8,
    "septiembre": 9, "setiembre": 9, "sep": 9, "sept": 9, "september": 9,
    "octubre": 10, "oct": 10, "october": 10,
    "noviembre": 11, "nov": 11, "november": 11,
    "diciembre": 12, "dic": 12, "december": 12, "dec": 12,
}
# "mar" is deliberately NOT a weekday abbreviation (collides with marzo).
_WEEKDAY_NAMES: dict[str, int] = {
    "lunes": 0, "martes": 1, "miercoles": 2, "jueves": 3, "viernes": 4, "sabado": 5, "domingo": 6,
    "lun": 0, "mie": 2, "jue": 3, "vie": 4, "sab": 5, "dom": 6,
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6,
    "mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6,
}


def _accent_tolerant(word: str) -> str:
    table = {"a": "[aá]", "e": "[eé]", "i": "[ií]", "o": "[oó]", "u": "[uúü]", "n": "[nñ]"}
    return "".join(table.get(c, re.escape(c)) for c in word)


MONTH_RE = r"(?:" + "|".join(_accent_tolerant(n) for n in sorted(_MONTH_NAMES, key=len, reverse=True)) + r")\b\.?"
WEEKDAY_RE = r"(?:" + "|".join(_accent_tolerant(n) for n in sorted(_WEEKDAY_NAMES, key=len, reverse=True)) + r")\b\.?"


def month_num(tok: Optional[str]) -> Optional[int]:
    return _MONTH_NAMES.get(fold(tok or "").strip(" .,")) if tok else None


def weekday_num(tok: Optional[str]) -> Optional[int]:
    return _WEEKDAY_NAMES.get(fold(tok or "").strip(" .,")) if tok else None


def weekday_ok(iso: Optional[str], wd: Optional[int]) -> bool:
    """True when no weekday was stated, or the stated weekday matches the date."""
    if wd is None:
        return True
    d = _date_of(iso)
    return bool(d and d.weekday() == wd)


def year_by_weekday(month: int, day: int, wd: Optional[int], ref_year: int, years_ahead: int = 1) -> Optional[int]:
    """Resolve a year-less 'Jueves 12 de noviembre' from the weekday, searching ref_year..+years_ahead.

    Never trust a dateline year (the Alcaldía 2026 release carries '16 de septiembre de 2025').
    Returns None when no year (or more than one) matches."""
    if wd is None:
        return None
    hits = [y for y in range(ref_year, ref_year + years_ahead + 1)
            if ymd(y, month, day) and date(y, month, day).weekday() == wd]
    return hits[0] if len(hits) == 1 else None


_CLOCK_12_RE = re.compile(r"(?<![\d.,$/])(\d{1,2})(?:[:.](\d{2}))?\s*(?:h\s*)?([ap])\.?\s?m\b\.?", re.I)
_CLOCK_WORDS_RE = re.compile(
    r"(?<![\d.,$/])(\d{1,2})(?:[:.](\d{2}))?\s+(?:de|en|por)\s+la\s+(ma[nñ]ana|tarde|noche)", re.I)
_CLOCK_24_RE = re.compile(r"(?<![\d.,$/])([01]?\d|2[0-3])[:.h]([0-5]\d)(?!\.?\d)(?:\s*(?:h|hrs?|horas?)\b)?", re.I)


def find_clock(text: str) -> Optional[tuple[str, int, int]]:
    """First clock time in `text` as ('HH:MM', start, end). Understands 7:00 p.m., 9:00 a. m.,
    8:00 PM, 12.00h, 19:00, 'a las 6:00 de la tarde'."""
    best: Optional[tuple[str, int, int]] = None
    for rx, kind in ((_CLOCK_12_RE, "12"), (_CLOCK_WORDS_RE, "words"), (_CLOCK_24_RE, "24")):
        m = rx.search(text or "")
        if not m:
            continue
        h = int(m.group(1))
        mi = int(m.group(2) or 0)
        if kind == "12":
            if not 1 <= h <= 12:
                continue
            h = h % 12 + (12 if m.group(3).lower() == "p" else 0)
        elif kind == "words":
            part = fold(m.group(3))
            if part in ("tarde", "noche"):
                h = 0 if (part == "noche" and h == 12) else (h + 12 if h < 12 else h)
            elif h == 12:
                h = 0
        if not (0 <= h <= 23 and 0 <= mi <= 59):
            continue
        hit = (f"{h:02d}:{mi:02d}", m.start(), m.end())
        if best is None or hit[1] < best[1]:
            best = hit
    return best


def parse_clock(text: Optional[str]) -> Optional[str]:
    hit = find_clock(text or "")
    return hit[0] if hit else None


def all_clocks(text: str) -> list[str]:
    out: list[str] = []
    rest = text or ""
    for _ in range(6):
        hit = find_clock(rest)
        if not hit:
            break
        out.append(hit[0])
        rest = rest[hit[2]:]
    return out


_ISO_RE = re.compile(
    r"^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2})[:\-](\d{2})(?:[:\-](\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?\s*$")


def split_iso(s: Any) -> Optional[dict[str, Any]]:
    """'2027-01-09T19:00:00Z' -> {date, time, offset} as WRITTEN (no conversion). Offset is
    normalised to 'Z' or '+HH:MM'. Returns None when the value is not an ISO-ish datetime."""
    m = _ISO_RE.match(str(s or ""))
    if not m:
        return None
    d = ymd(m.group(1), m.group(2), m.group(3))
    if not d:
        return None
    t = None
    if m.group(4) is not None:
        h, mi = int(m.group(4)), int(m.group(5))
        if 0 <= h <= 23 and 0 <= mi <= 59:
            t = f"{h:02d}:{mi:02d}"
    off = m.group(7)
    if off and off != "Z":
        off = off if ":" in off else f"{off[:3]}:{off[3:]}"
        if off in ("+00:00", "-00:00"):
            off = "Z"
    return {"date": d, "time": t, "offset": off}


def utc_to_bogota(s: str) -> Optional[dict[str, str]]:
    """A REAL UTC/offset timestamp converted to Bogotá wall-clock (FICCI's <time datetime='…Z'>)."""
    p = split_iso(s)
    if not p or not p["time"]:
        return None
    off = p["offset"]
    if off is None:
        return None
    tz = timezone.utc if off == "Z" else timezone(timedelta(hours=int(off[:3]), minutes=int(off[0] + off[4:6])))
    y, mo, d = (int(x) for x in p["date"].split("-"))
    h, mi = (int(x) for x in p["time"].split(":"))
    local = datetime(y, mo, d, h, mi, tzinfo=tz).astimezone(BOGOTA_TZ)
    return {"date": local.date().isoformat(), "time": local.strftime("%H:%M")}


# Generic date-expression finder (used by the generic recheck and several adapters).
_YEAR_TAIL = r"(?:,?\s+(?:de|del)?\s*(\d{4}))?"
_DATE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("wd_range", re.compile(
        rf"\b({WEEKDAY_RE}),?\s+(\d{{1,2}})\s+(?:de\s+({MONTH_RE})\s+)?(?:y|al|a)\s+({WEEKDAY_RE}),?\s+(\d{{1,2}})\s+de\s+({MONTH_RE}){_YEAR_TAIL}",
        re.I)),
    ("del_al", re.compile(
        rf"\bdel?\s+(\d{{1,2}})\s+(?:de\s+({MONTH_RE})\s+)?al?\s+(\d{{1,2}})\s+de\s+({MONTH_RE}){_YEAR_TAIL}", re.I)),
    ("m_range", re.compile(rf"\b({MONTH_RE})\s+(\d{{1,2}})\s+al?\s+(\d{{1,2}}),?\s+(?:de|del)\s+(\d{{4}})", re.I)),
    ("dash_range", re.compile(
        rf"\b(\d{{1,2}})\s*[–—-]\s*(\d{{1,2}})\s+(?:de\s+)?({MONTH_RE}){_YEAR_TAIL}", re.I)),
    ("list", re.compile(
        rf"\b(\d{{1,2}})((?:\s*,\s*\d{{1,2}})*)\s*,?\s+y\s+(\d{{1,2}})\s+de\s+({MONTH_RE}){_YEAR_TAIL}", re.I)),
    ("dmy_es", re.compile(rf"(?:\b({WEEKDAY_RE}),?\s+)?\b(\d{{1,2}})\s+de\s+({MONTH_RE}){_YEAR_TAIL}", re.I)),
    ("mdy_en", re.compile(
        rf"(?:\b({WEEKDAY_RE}),?\s+)?\b({MONTH_RE})\s+(\d{{1,2}})(?:st|nd|rd|th)?,?\s+(\d{{4}})", re.I)),
    ("dmy_space", re.compile(rf"(?:\b({WEEKDAY_RE}),?\s+)?\b(\d{{1,2}})\s+({MONTH_RE})\s*/?\s*(\d{{4}})", re.I)),
    ("num_dmy", re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b")),
    ("dots_dmy", re.compile(r"\b(\d{2})\.(\d{2})\.(\d{4})\b")),
    ("iso", re.compile(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b")),
]


def _resolve_year(y: Optional[str], month: int, day: int, wd: Optional[int], ref_year: Optional[int]) -> Optional[int]:
    if y:
        return int(y)
    if ref_year is None:
        return None
    if wd is not None:
        return year_by_weekday(month, day, wd, ref_year - 1, years_ahead=2)
    return ref_year


def find_date_expressions(text: str, ref_year: Optional[int] = None) -> list[dict[str, Any]]:
    """All date expressions in `text` (non-overlapping, longest first). Each hit:
    {start, end, text, span, weekday_ok, has_year}. Year-less hits use ref_year (or the weekday)."""
    raw: list[dict[str, Any]] = []
    for kind, rx in _DATE_PATTERNS:
        for m in rx.finditer(text or ""):
            g = m.groups()
            start = end = None
            wd = None
            has_year = True
            try:
                if kind == "wd_range":
                    wd = weekday_num(g[0])
                    m2 = month_num(g[5])
                    m1 = month_num(g[2]) if g[2] else m2
                    y1 = _resolve_year(g[6], m1 or 0, int(g[1]), wd, ref_year)
                    has_year = bool(g[6])
                    if y1 and m1 and m2:
                        y2 = y1 if m2 >= m1 else y1 + 1
                        if g[6] and m2 < m1:
                            y1, y2 = int(g[6]) - 1, int(g[6])
                        start, end = ymd(y1, m1, g[1]), ymd(y2, m2, g[4])
                        if not weekday_ok(end, weekday_num(g[3])):
                            wd = -1
                elif kind == "del_al":
                    m2 = month_num(g[3])
                    m1 = month_num(g[1]) if g[1] else m2
                    yend: Optional[int] = int(g[4]) if g[4] else ref_year
                    has_year = bool(g[4])
                    if yend and m1 and m2:
                        ystart = yend if m1 <= m2 else yend - 1
                        start, end = ymd(ystart, m1, g[0]), ymd(yend, m2, g[2])
                elif kind == "m_range":
                    mo = month_num(g[0])
                    start, end = ymd(g[3], mo, g[1]), ymd(g[3], mo, g[2])
                elif kind == "dash_range":
                    mo = month_num(g[2])
                    y = int(g[3]) if g[3] else ref_year
                    has_year = bool(g[3])
                    if y and mo:
                        start, end = ymd(y, mo, g[0]), ymd(y, mo, g[1])
                elif kind == "list":
                    mo = month_num(g[3])
                    y = int(g[4]) if g[4] else ref_year
                    has_year = bool(g[4])
                    if y and mo:
                        start, end = ymd(y, mo, g[0]), ymd(y, mo, g[2])
                elif kind == "dmy_es":
                    wd = weekday_num(g[0])
                    mo = month_num(g[2])
                    has_year = bool(g[3])
                    y = _resolve_year(g[3], mo or 0, int(g[1]), wd, ref_year)
                    if y and mo:
                        start = end = ymd(y, mo, g[1])
                elif kind == "mdy_en":
                    wd = weekday_num(g[0])
                    start = end = ymd(g[3], month_num(g[1]), g[2])
                elif kind == "dmy_space":
                    wd = weekday_num(g[0])
                    start = end = ymd(g[3], month_num(g[2]), g[1])
                elif kind in ("num_dmy", "dots_dmy"):
                    start = end = ymd(g[2], g[1], g[0])
                elif kind == "iso":
                    start = end = ymd(g[0], g[1], g[2])
            except (TypeError, ValueError):
                start = None
            if not start or not end or end < start:
                continue
            raw.append({
                "kind": kind, "start": start, "end": end, "text": m.group(0).strip(),
                "span": (m.start(), m.end()), "has_year": has_year,
                "weekday_ok": wd != -1 and weekday_ok(start, wd if wd != -1 else None),
            })
    raw.sort(key=lambda h: (h["span"][0], -(h["span"][1] - h["span"][0])))
    out: list[dict[str, Any]] = []
    last_end = -1
    for h in raw:
        if h["span"][0] >= last_end:
            out.append(h)
            last_end = h["span"][1]
    return out


def first_date(text: str, ref_year: Optional[int] = None, *, need_year: bool = False) -> Optional[dict[str, Any]]:
    for h in find_date_expressions(text, ref_year):
        if need_year and not h["has_year"]:
            continue
        return h
    return None


# ════════════════════════════════════════════════════════════════════════════════════════════
# Markers (§15 S2): cancel / sold-out / finished — matched ONLY inside event-scoped text
# ════════════════════════════════════════════════════════════════════════════════════════════
CANCEL_RE = re.compile(
    r"\b(cancelad[oa]s?|suspendid[oa]s?|aplazad[oa]s?|postergad[oa]s?|reprogramad[oa]s?|cancell?ed|postponed|called\s+off)\b",
    re.I)
DATE_NOTICE_RE = re.compile(r"\b(nueva\s+fecha|cambio\s+de\s+fecha|new\s+date)\b", re.I)
SOLD_OUT_RE = re.compile(r"\b(agotad[oa]s?|sold[\s-]?out)\b", re.I)
FINISHED_RE = re.compile(r"(ya\s+ha\s+sucedido|has\s+(?:already\s+)?taken\s+place|\bterminad[oa]\b|\bfinalizad[oa]\b|\brealizad[oa]\b)", re.I)
PRIVATE_RE = re.compile(r"(\(privado\)|evento\s+privado|puerta\s+cerrada|evento\s+cerrado|closed\s+event|acceso\s+privado|solo\s+invitad|acreditad[oa]s\s+de\s+industria)", re.I)

# Boilerplate every ticketer carries (T&C, nav links, comment forms). Stripped before matching.
GENERIC_BOILERPLATE: tuple[str, ...] = (
    r"(?:si|en\s+caso\s+de\s+que|cuando|en\s+el\s+evento\s+(?:de\s+)?que)\s+(?:el|un|este|la|una)\s+"
    r"(?:evento|espect[aá]culo|concierto|show|funci[oó]n|presentaci[oó]n)\s+(?:es|sea|fuera|fuese|resulta|resultare|llegara\s+a\s+ser|se)\s+"
    r"\w+(?:\s*(?:,|\s[oy])\s*\w+)*",
    r"eventos\s+cancelad[oa]s",
    r"pol[ií]ticas?\s+de\s+(?:cancelaci[oó]n|devoluci[oó]n)",
    r"cancelar\s+respuesta",
    r"if\s+(?:the|an|this)\s+(?:event|race|show)\s+is\s+(?:cancell?ed|postponed)(?:\s+or\s+\w+)?",
)


def _strip_boilerplate(text: str, denylist: Sequence[str] = ()) -> str:
    out = text or ""
    for pat in (*GENERIC_BOILERPLATE, *denylist):
        out = re.sub(pat, " ", out, flags=re.I)
    return out


def find_cancel_marker(event_text: str, denylist: Sequence[str] = ()) -> Optional[str]:
    m = CANCEL_RE.search(_strip_boilerplate(event_text, denylist))
    return m.group(1).lower() if m else None


def find_date_notice(event_text: str, denylist: Sequence[str] = ()) -> Optional[str]:
    m = DATE_NOTICE_RE.search(_strip_boilerplate(event_text, denylist))
    return m.group(1).lower() if m else None


def find_sold_out(status_text: str, denylist: Sequence[str] = ()) -> bool:
    """Sold-out ONLY from the event's status element (button / basket / function row), never a
    price-stage block (§15 S2); per-adapter boilerplate such as IRONMAN's 'Registration Sold Out'
    is stripped first."""
    return bool(SOLD_OUT_RE.search(_strip_boilerplate(status_text, denylist)))


def find_finished(status_text: str, denylist: Sequence[str] = ()) -> bool:
    """'Finalizado' / 'Terminado' / 'has taken place' ONLY from the event's status element; a
    price-stage badge ('GENERAL Finalizado') or T&C ('finalizada la compra') never counts. The
    sentinel never sets expired from this (§15 S2) — it only means 'not bookable any more'."""
    return bool(FINISHED_RE.search(_strip_boilerplate(status_text, denylist)))


def _deny(src: Mapping[str, Any]) -> tuple[str, ...]:
    """The adapter's boilerplate denylist for a registry entry (empty when unknown)."""
    ad = src.get("adapter")
    return tuple(getattr(ad, "denylist", ()) or ())


def event_markers(src: Mapping[str, Any], event_text: str) -> dict[str, Optional[str]]:
    """cancel + date-notice markers of one event-scoped block, with the source's denylist."""
    deny = _deny(src)
    return {"cancel": find_cancel_marker(event_text, deny), "date_notice": find_date_notice(event_text, deny)}


_NOTICE_TAIL_CHARS = 240        # how far after 'NUEVA FECHA' the announced date may sit
_NOTICE_FP_CHARS = 100          # notice fingerprint: the keyword + this much of what follows
_ORIGINAL_LABEL_RE = re.compile(
    r"(fecha\s+(?:original|anterior|inicial|previa)|original\s+date|previous(?:ly)?|antes|inicialmente|"
    r"era\s+el|was\s+scheduled|previst[oa]\s+para)\W{0,14}$", re.I)


def notice_announcement(text: str, *, ref_year: Optional[int] = None,
                        denylist: Sequence[str] = ()) -> Optional[dict[str, Any]]:
    """The date a 'nueva fecha' / 'cambio de fecha' / 'new date' notice ANNOUNCES (§7 table,
    §15 S3): for each notice keyword, the first date expression AFTER it (within 240 chars and
    before the next notice keyword) that the page does not label as the original one ('Fecha
    original: …'), plus the clock time right after that date. None when the text carries no notice.

    Returns {marker, start_date, end_date, start_time, original, fp}. start_date is None when no
    notice names a parseable date, or when two notices announce different dates (ambiguous).
    `quote` is the verbatim notice line up to the announced date (and its time). `original`
    lists the [start, end] ranges the page labels as the old date or prints before the first notice. `fp` fingerprints the notice text (keyword + what follows), so an admin
    acknowledgement is tied to this exact notice and a changed notice asks again."""
    body = _strip_boilerplate(text or "", denylist)
    hits = list(DATE_NOTICE_RE.finditer(body))
    if not hits:
        return None
    announced: list[tuple[str, str, Optional[str], str]] = []
    for i, m in enumerate(hits):
        stop = hits[i + 1].start() if i + 1 < len(hits) else len(body)
        tail = body[m.end(): min(stop, m.end() + _NOTICE_TAIL_CHARS)]
        exprs = [h for h in find_date_expressions(tail, ref_year) if h["weekday_ok"]]
        for j, h in enumerate(exprs):
            if _ORIGINAL_LABEL_RE.search(tail[max(0, h["span"][0] - 40): h["span"][0]]):
                continue
            clock_end = exprs[j + 1]["span"][0] if j + 1 < len(exprs) else len(tail)
            after = tail[h["span"][1]: min(clock_end, h["span"][1] + 60)]
            ck = find_clock(after)
            quote_end = h["span"][1] + (ck[2] if ck else 0)
            quote = clean_text(body[m.start(): m.end() + quote_end])[:300]
            announced.append((str(h["start"]), str(h["end"]), ck[0] if ck else None, quote))
            break
    original: list[list[str]] = []
    for h in find_date_expressions(body, ref_year):
        if not h["weekday_ok"]:
            continue
        before_first = h["span"][1] <= hits[0].start()
        labelled = bool(_ORIGINAL_LABEL_RE.search(body[max(0, h["span"][0] - 40): h["span"][0]]))
        if before_first or labelled:
            original.append([str(h["start"]), str(h["end"])])
    first = hits[0]
    fp_src = norm_key(body[first.start(): first.end() + _NOTICE_FP_CHARS])
    out: dict[str, Any] = {"marker": first.group(1).lower(), "start_date": None, "end_date": None,
                           "start_time": None, "quote": None, "original": original,
                           "fp": hashlib.sha1(fp_src.encode("utf-8")).hexdigest()[:12]}
    ranges = {(a[0], a[1]) for a in announced}
    if len(ranges) == 1:
        s, e = next(iter(ranges))
        times = {a[2] for a in announced if a[2]}
        timed = next((a for a in announced if a[2]), announced[0])
        out.update(start_date=s, end_date=e, start_time=next(iter(times)) if len(times) == 1 else None,
                   quote=timed[3] if len(times) == 1 else announced[0][3])
    return out


def _stored_range(doc: Mapping[str, Any]) -> tuple[Any, Any]:
    return doc.get("start_date"), doc.get("end_date") or doc.get("start_date")


def announces_dates(target: Mapping[str, Any], ann: Optional[Mapping[str, Any]]) -> bool:
    """The notice announces exactly target's dates (start + end), and its time when both state one."""
    if not ann or not isinstance(ann.get("start_date"), str):
        return False
    if (ann["start_date"], ann.get("end_date") or ann["start_date"]) != _stored_range(target):
        return False
    return not (ann.get("start_time") and target.get("start_time") and ann["start_time"] != target["start_time"])


def _ack_for_current_dates(doc: Mapping[str, Any]) -> bool:
    ack = doc.get("notice_ack")
    if not isinstance(ack, Mapping) or not doc.get("start_date"):
        return False
    return (ack.get("start_date"), ack.get("end_date") or ack.get("start_date"), ack.get("start_time")) == \
        (*_stored_range(doc), doc.get("start_time"))


def notice_ack_matches(doc: Mapping[str, Any], ann: Optional[Mapping[str, Any]], *, need_fp: bool = True) -> bool:
    """True when an admin already approved THIS notice (same fingerprint) for the row's CURRENT
    dates (approve_event stores notice_ack). Only a notice that names NO parseable date can be
    acknowledged: one that announces a date is always resolved against that date. A changed
    notice or a later date change asks again. `need_fp=False` (title-scope scan, whose block
    boundaries differ from the event block's) accepts any dateless notice once acknowledged."""
    if not ann or ann.get("start_date") or not _ack_for_current_dates(doc):
        return False
    return not need_fp or (bool(ann.get("fp")) and doc["notice_ack"].get("fp") == ann.get("fp"))


_TITLE_HEAD_SPLIT_RE = re.compile(r"\s*[(:·|,–—]\s*|\s+-\s+|\s+(?:y|e|and|&)\s+", re.I)
_NEAR_TITLE_LINE_CAP = 600      # chars kept on each side of the title mention in its own block
_NEAR_TITLE_NEIGHBOUR_CAP = 300  # chars kept from the adjacent block on each side


def _title_needles(title: str) -> list[str]:
    """The full title plus its head before ' y ' / '(' / ':' / ',' / ' - ' (≥ 10 chars, ≥ 2 words):
    notices name 'el Festival Náutico de la Independencia' without the rest of the row title."""
    t = clean_text(title)
    out = [t] if len(t) >= 5 else []
    head = _TITLE_HEAD_SPLIT_RE.split(t, maxsplit=1)[0].strip() if t else ""
    if head and head != t and len(head) >= 10 and len(norm_key(head).split()) >= 2:
        out.append(head)
    return out


def title_scope_notice(html: str, doc: Mapping[str, Any], denylist: Sequence[str] = ()) -> Optional[str]:
    """A cancel / postponement / 'nueva fecha' notice in the SAME or an ADJACENT visible block as a
    page-wide mention of the event title (an 'ACTUALIZACIÓN: … APLAZADOS' paragraph above the
    agenda, an 'EVENTO CANCELADO' banner under the <h1>). Boilerplate is stripped first (§15 S2).
    Returns 'cancel_near_title:<word>' / 'date_notice_near_title:<word>' or None. Callers turn a hit
    into a non-success recheck (VERIFY at once, reminders suppressed, alert): it never hides a row
    by itself, because a page-wide notice may concern a neighbouring row."""
    if doc.get("is_umbrella"):
        return None
    needles = [n for n in (_HSPACE_RE.sub(" ", fold(x)).strip() for x in _title_needles(_doc_title(doc))) if n]
    if not needles:
        return None
    lines = html_to_lines(html or "")
    for i, line in enumerate(lines):
        fl = fold(line)
        pos = next((fl.find(n) for n in needles if n in fl), -1)
        if pos < 0:
            continue
        own = line[max(0, pos - _NEAR_TITLE_LINE_CAP): pos + _NEAR_TITLE_LINE_CAP]
        prev = lines[i - 1][-_NEAR_TITLE_NEIGHBOUR_CAP:] if i > 0 else ""
        nxt = lines[i + 1][:_NEAR_TITLE_NEIGHBOUR_CAP] if i + 1 < len(lines) else ""
        block = _strip_boilerplate(f"{prev}\n{own}\n{nxt}", denylist)
        m = CANCEL_RE.search(block)
        if m:
            return f"cancel_near_title:{m.group(1).lower()}"
        m = DATE_NOTICE_RE.search(block)
        if m:
            # A notice that announces exactly the stored dates (an approved reschedule whose banner
            # stays up until the show), or one an admin already acknowledged for these dates, is
            # not news about this row.
            d0 = _date_of(doc.get("start_date"))
            ann = notice_announcement(block, ref_year=d0.year if d0 else None)
            if doc.get("start_date") and (announces_dates(doc, ann) or notice_ack_matches(doc, ann, need_fp=False)):
                continue
            return f"date_notice_near_title:{m.group(1).lower()}"
    return None


def with_title_scope(rec: "Recheck", fres: Optional[Mapping[str, Any]], doc: Mapping[str, Any],
                     denylist: Sequence[str] = ()) -> "Recheck":
    """Downgrade a success / sold_out recheck to not_found when title_scope_notice() fires on the
    same fetched page. Any other outcome passes through unchanged."""
    if rec.get("outcome") not in ("success", "sold_out") or not isinstance(fres, Mapping):
        return rec
    notice = title_scope_notice(str(fres.get("text") or ""), doc, denylist)
    if not notice:
        return rec
    return make_recheck("not_found", http_status=int(rec.get("http_status") or 0), final_url=rec.get("final_url"),
                        found_date_text=rec.get("found_date_text"), parsed=rec.get("parsed"), marker=notice,
                        detail="notice_near_title")


# ════════════════════════════════════════════════════════════════════════════════════════════
# JSON-LD, coordinates, prices
# ════════════════════════════════════════════════════════════════════════════════════════════
_LD_RE = re.compile(r"<script[^>]+type\s*=\s*[\"']application/ld\+json[\"'][^>]*>(.*?)</script>", re.S | re.I)
_EVENT_TYPES = {
    "event", "musicevent", "sportsevent", "theaterevent", "festival", "childrensevent", "comedyevent",
    "danceevent", "exhibitionevent", "literaryevent", "screeningevent", "socialevent", "educationevent",
    "foodevent", "businessevent", "visualartsevent",
}


def ld_nodes(html: str) -> list[dict[str, Any]]:
    """Every JSON-LD object on the page (@graph flattened, document order). Malformed blocks skipped."""
    out: list[dict[str, Any]] = []
    for raw in _LD_RE.findall(html or ""):
        raw = raw.strip()
        data: Any = None
        for attempt in (raw, re.sub(r"[\x00-\x1f]", " ", raw)):
            try:
                data = json.loads(attempt)
                break
            except ValueError:
                continue
        queue: list[Any] = [data]
        while queue:
            x = queue.pop(0)
            if isinstance(x, list):
                queue.extend(x)
            elif isinstance(x, dict):
                g = x.get("@graph")
                if g is not None:
                    queue.extend(g if isinstance(g, list) else [g])
                out.append(x)
    return out


def ld_type(node: Mapping[str, Any]) -> str:
    t = node.get("@type") or node.get("type") or ""
    if isinstance(t, list):
        t = t[0] if t else ""
    return str(t).lower()


def ld_events(html: str) -> list[dict[str, Any]]:
    return [n for n in ld_nodes(html) if ld_type(n) in _EVENT_TYPES]


def ld_location(node: Mapping[str, Any]) -> Optional[dict[str, Any]]:
    loc = node.get("location")
    if isinstance(loc, list):
        loc = loc[0] if loc else None
    if isinstance(loc, str):
        return {"name": clean_text(loc)}
    if not isinstance(loc, dict):
        return None
    out: dict[str, Any] = {"name": clean_text(loc.get("name")) or None}
    addr = loc.get("address")
    if isinstance(addr, str):
        out["streetAddress"] = clean_text(addr) or None
    elif isinstance(addr, dict):
        for k in ("streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"):
            v = addr.get(k)
            if isinstance(v, dict):
                v = v.get("name")
            out[k] = clean_text(v) or None
    geo = loc.get("geo")
    if isinstance(geo, dict) and geo.get("latitude") not in (None, "") and geo.get("longitude") not in (None, ""):
        out["geo"] = {"latitude": geo.get("latitude"), "longitude": geo.get("longitude")}
    return out


def ld_location_text(loc: Optional[Mapping[str, Any]]) -> str:
    if not loc:
        return ""
    parts = [loc.get(k) for k in ("name", "streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry")]
    return ", ".join(str(p) for p in parts if p)


def bogota_day_of(iso_ts: Any) -> Optional[str]:
    """'YYYY-MM-DD' in Bogotá for an ISO timestamp carrying an offset (fetched_at is '…Z')."""
    p = utc_to_bogota(str(iso_ts or ""))
    return p["date"] if p else None


def ld_placeholder_date(ld_start: Optional[Mapping[str, Any]], ld_end: Optional[Mapping[str, Any]],
                        fetched_at: Any) -> bool:
    """§15 R3 4c: a JSON-LD startDate == endDate (or no endDate) == the Bogotá day we fetched the
    page is a CMS placeholder, never a date (TuBoleta stamps evergreen rows with start=end=today).
    Takes split_iso() results. Mirrors events_gate.is_jsonld_placeholder_date."""
    if not ld_start or not ld_start.get("date"):
        return False
    day = bogota_day_of(fetched_at)
    end = (ld_end or {}).get("date") or ld_start["date"]
    return bool(day) and ld_start["date"] == end == day


def _decimals(v: Any) -> int:
    s = v if isinstance(v, str) else repr(float(v))
    s = s.strip()
    if "e" in s.lower():
        return 8
    return len(s.split(".", 1)[1]) if "." in s else 0


def clean_coords(lat: Any, lng: Any) -> tuple[Optional[float], Optional[float], Optional[str]]:
    """(lat, lng, dropped_reason). Coordinates are passed on only when precise (>= 3 decimals),
    not null-island and not a known placeholder/centroid (§15 Q5). Never invents coordinates."""
    if lat in (None, "") or lng in (None, ""):
        return None, None, None
    try:
        la, ln = float(lat), float(lng)
    except (TypeError, ValueError):
        return None, None, "unparseable"
    if not (math.isfinite(la) and math.isfinite(ln)):
        return None, None, "unparseable"
    if abs(la) < 1e-9 and abs(ln) < 1e-9:
        return None, None, "null_island"
    if _decimals(lat) < 3 or _decimals(lng) < 3:
        return None, None, "coarse"
    for pla, pln in PLACEHOLDER_COORDS:
        if abs(la - pla) <= 1e-3 and abs(ln - pln) <= 1e-3:
            return None, None, "placeholder"
    return la, ln, None


_COP_RE = re.compile(r"(?:COP|COL)?\s?\$\s?(\d{1,3}(?:[.,]\d{3})+|\d{4,})(?:[.,]\d{2}(?!\d))?")


def cop_amounts(text: str) -> list[int]:
    out: list[int] = []
    for m in _COP_RE.finditer(text or ""):
        try:
            v = int(re.sub(r"[.,]", "", m.group(1)))
        except ValueError:
            continue
        if v >= 1000:
            out.append(v)
    return out


_FREE_RE = re.compile(r"\b(gratis|entrada\s+libre|sin\s+costo|free\s+admission|free\s+entry|free\s*[–—-]\s*drop\s+in)\b", re.I)
_FREE_QUALIFIER_RE = re.compile(r"(menores|niñ[oa]s|ninos|parqueadero|env[ií]o|hasta\s+completar|\bzona\b|until\s+full|children|kids|parking|under\s+\d)", re.I)


def is_free_from(event_text: str, min_cop: Optional[int]) -> Optional[bool]:
    """§15 R6: True only on an unqualified free phrase in the EVENT text and no price > 0 parsed.
    Never from JSON-LD isAccessibleForFree. None = unknown."""
    if min_cop and min_cop > 0:
        return False
    for m in _FREE_RE.finditer(event_text or ""):
        window = event_text[max(0, m.start() - 60): m.end() + 60]
        if _FREE_QUALIFIER_RE.search(window):
            continue
        return True
    return None


def make_price(event_text: str, amounts: Sequence[int] = (), text: Optional[str] = None) -> dict[str, Any]:
    lo = min(amounts) if amounts else None
    hi = max(amounts) if amounts else None
    return {"is_free": is_free_from(event_text, lo), "min_cop": lo, "max_cop": hi, "text": text}


_CATEGORY_RULES: tuple[tuple[str, str], ...] = (
    (r"congreso|cumbre|convenci[oó]n|simposio|foro\b|summit|congress|seminario|asamblea|feria\s+(?:automotriz|empresarial)|reuni[oó]n", "civic"),
    (r"triat|ironman|marat[oó]n|carrera\s+atl|torneo|partido|f[uú]tbol|b[eé]isbol|boxeo|regata", "sports"),
    (r"festival", "festival"),
    (r"concierto|concert|orquesta|filarm|sinf[oó]n|recital|en\s+vivo|tour\b|gira\b", "concert"),
    (r"halloween|fiesta|party|club|\bdj\b|rumba|disco|beach", "nightlife"),
    (r"gastro|cocina|brunch|\bvino|cata\b|food|chef", "gastronomic"),
    (r"infantil|niñ[oa]s|familia|family|kids", "family"),
    (r"desfile|bando|cabildo|preludio|reinado|independencia", "cultural"),
)


def guess_category(title: str, default: str = "cultural") -> str:
    t = fold(title)
    for pat, cat in _CATEGORY_RULES:
        if re.search(pat, t):
            return cat
    return default


_PROFESSIONAL_RE = re.compile(r"congreso|cumbre|convenci[oó]n|simposio|summit|congress|seminario|asamblea|conferencia|encuentro\s+nacional|reuni[oó]n", re.I)


# ════════════════════════════════════════════════════════════════════════════════════════════
# Challenge detection (§15 S3 / §13 G) and polite fetching (§13 F1/F2)
# ════════════════════════════════════════════════════════════════════════════════════════════
_CHALLENGE_TITLE_RE = re.compile(r"just a moment|client challenge|attention required|waiting room|captcha|checking your browser|access denied", re.I)
_CHALLENGE_BODY_RE = re.compile(
    r"Just a moment|Client Challenge|cf-mitigated|captcha|Waiting Room|cookies est[aá]n desactivadas|en tu navegador las cookies|challenge-platform",
    re.I)
_COOKIE_WALL_URL_RE = re.compile(r"cookieWarning", re.I)
_WAITING_ROOM_URL_RE = re.compile(r"pkpcontroller|waiting-?room|queue-it\.net|/wr/[a-z]+/index", re.I)


class DeadlineReached(Exception):
    """Raised by the scheduler when nothing new may be dispatched (§13 F2: 30 s dispatch budget)."""


def detect_challenge(status: int, final_url: str, headers: Mapping[str, str], text: str,
                     chain: Sequence[str] = ()) -> Optional[str]:
    """A reason string when the response is a bot wall (cookie wall, waiting room, Cloudflare /
    Atrápalo challenge) and must NOT be read as the event page. None for a normal page.

    The body regex runs only on small bodies (< 15 KB) or the <title>: real CMF pages embed a
    reCAPTCHA script, so a page-wide 'captcha' match would block every recheck."""
    for u in (*chain, final_url):
        if not u:
            continue
        parts = urlsplit(u)
        path = f"{parts.path}?{parts.query}"
        if _COOKIE_WALL_URL_RE.search(path):
            return "cookie_wall"
        if _WAITING_ROOM_URL_RE.search(u):
            return "waiting_room"
    hdr = {k.lower(): v for k, v in (headers or {}).items()}
    if hdr.get("cf-mitigated"):
        return "cf_challenge"
    title = page_title((text or "")[:30000])
    if title and _CHALLENGE_TITLE_RE.search(title):
        return "waiting_room" if "waiting room" in title.lower() else "challenge_page"
    if text and len(text) < SMALL_BODY_CHARS and _CHALLENGE_BODY_RE.search(text):
        return "challenge_page"
    return None


def politeness_key(url_or_host: str) -> str:
    host = urlsplit(url_or_host).hostname if "://" in url_or_host else url_or_host
    host = (host or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if host.endswith(".checkout.tuboleta.com"):
        return "checkout.tuboleta.com"  # SecuTix hosts share one waiting room (peak51)
    return host


HOST_MIN_GAP_S: dict[str, float] = {"checkout.tuboleta.com": SECUTIX_MIN_GAP_S, "hayfestival.com": 2.0}


class PoliteScheduler:
    """One in-flight request per domain, >= min gap between requests to the same domain, at most
    `max_domains` domains in parallel, and no new dispatch after `deadline` (time.monotonic()).

        sched = PoliteScheduler(deadline=time.monotonic() + 30)
        async with sched.slot(url):   # raises DeadlineReached when the budget is spent
            ...
    `clock` / `sleep` are injectable for tests."""

    def __init__(self, deadline: Optional[float] = None, *, max_domains: int = MAX_PARALLEL_DOMAINS,
                 default_gap_s: float = DEFAULT_MIN_GAP_S,
                 clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep) -> None:
        self.deadline = deadline
        self.default_gap_s = default_gap_s
        self._clock = clock
        self._sleep = sleep
        self._sem = asyncio.Semaphore(max_domains)
        self._locks: dict[str, asyncio.Lock] = {}
        self._last: dict[str, float] = {}
        self.in_flight = 0
        self.max_in_flight = 0
        self.dispatched = 0

    def remaining(self) -> float:
        return math.inf if self.deadline is None else self.deadline - self._clock()

    def expired(self) -> bool:
        return self.remaining() <= 0

    @asynccontextmanager
    async def slot(self, url_or_host: str, min_gap_s: Optional[float] = None) -> AsyncIterator[None]:
        key = politeness_key(url_or_host)
        gap = max(min_gap_s if min_gap_s is not None else self.default_gap_s, HOST_MIN_GAP_S.get(key, 0.0))
        if self.expired():
            raise DeadlineReached(key)
        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            last = self._last.get(key)
            if last is not None:
                wait = last + gap - self._clock()
                if wait > 0:
                    if self.remaining() < wait:
                        raise DeadlineReached(key)
                    await self._sleep(wait)
            async with self._sem:
                if self.expired():
                    raise DeadlineReached(key)
                self.in_flight += 1
                self.dispatched += 1
                self.max_in_flight = max(self.max_in_flight, self.in_flight)
                try:
                    yield
                finally:
                    self.in_flight -= 1
                    self._last[key] = self._clock()


def make_client(transport: Optional[httpx.AsyncBaseTransport] = None) -> httpx.AsyncClient:
    """An AsyncClient with our descriptive UA. Create one per cookie-jar source (SecuTix) so
    cookies never leak across sources; the caller owns closing it."""
    return httpx.AsyncClient(
        headers={"User-Agent": UA, "Accept-Language": "es-CO,es;q=0.9,en;q=0.7",
                 "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.5"},
        timeout=httpx.Timeout(FETCH_TIMEOUT_S),
        transport=transport,
        follow_redirects=False,
    )


def _is_http_url(url: Any) -> bool:
    try:
        p = urlsplit(str(url or ""))
    except ValueError:
        return False
    return p.scheme in ("http", "https") and bool(p.hostname)


def _never_crawl(url: str) -> bool:
    host = politeness_key(url)
    return any(host == h or host.endswith("." + h) for h in NEVER_CRAWL_HOSTS)


# ── §15 X4: URL guard for admin-supplied URLs (gate-check / manual verify) ─────────────────────
UrlGuard = Callable[[str], Awaitable[Optional[str]]]
Resolver = Callable[[str, int], Awaitable[list[str]]]
DNS_TIMEOUT_S = 3.0


def ip_is_public(addr: str) -> bool:
    """True only for a globally routable unicast address (no private / loopback / link-local /
    reserved / CGNAT / multicast / unspecified; IPv4-mapped IPv6 is judged by its IPv4)."""
    try:
        ip = ipaddress.ip_address(str(addr).split("%", 1)[0])
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return bool(ip.is_global) and not (ip.is_multicast or ip.is_unspecified or ip.is_loopback
                                       or ip.is_link_local or ip.is_private or ip.is_reserved)


async def _system_resolve(host: str, port: int) -> list[str]:
    loop = asyncio.get_running_loop()
    infos = await asyncio.wait_for(loop.getaddrinfo(host, port, type=socket.SOCK_STREAM), timeout=DNS_TIMEOUT_S)
    return [str(i[4][0]) for i in infos]


async def public_url_guard(url: str, *, resolver: Optional[Resolver] = None) -> Optional[str]:
    """None when `url` may be fetched on an admin's behalf, else the refusal reason (§15 X4):
    http(s) only, ports 80/443 only, no credentials, and EVERY resolved address public.
    Pass it to fetch(url_guard=…) so each redirect hop is checked before it is requested."""
    try:
        p = urlsplit(str(url or ""))
        port = p.port
    except ValueError:
        return "bad_url"
    if p.scheme not in ("http", "https") or not p.hostname:
        return "bad_url"
    if port not in (None, 80, 443):
        return "port_not_allowed"
    if p.username or p.password:
        return "credentials_in_url"
    host = p.hostname
    try:
        addrs = [str(ipaddress.ip_address(host))]
    except ValueError:
        try:
            addrs = await (resolver or _system_resolve)(host, port or (443 if p.scheme == "https" else 80))
        except (OSError, asyncio.TimeoutError, UnicodeError) as exc:
            logger.error("[events] url guard dns failed: %s", type(exc).__name__)
            return "dns_error"
    if not addrs:
        return "dns_error"
    if not all(ip_is_public(a) for a in addrs):
        return "private_address"
    return None


def _peer_ip(resp: httpx.Response) -> Optional[str]:
    """The connected server address when the transport exposes it (httpcore network_stream);
    None under MockTransport. Used to catch DNS rebinding after the guard's own lookup."""
    stream = resp.extensions.get("network_stream")
    get = getattr(stream, "get_extra_info", None)
    if get is None:
        return None
    try:
        addr = get("server_addr")
    except Exception:  # an exotic transport; the pre-connect guard already ran
        return None
    return str(addr[0]) if isinstance(addr, (tuple, list)) and addr else None


def _decode(body: bytes, content_type: Optional[str]) -> str:
    charset = None
    if content_type:
        m = re.search(r"charset=([\w\-]+)", content_type, re.I)
        charset = m.group(1) if m else None
    if not charset:
        mb = re.search(rb"<meta[^>]+charset=[\"']?([\w\-]+)", body[:4096], re.I)
        charset = mb.group(1).decode("ascii", "ignore") if mb else None
    for enc in (charset, "utf-8"):
        if not enc:
            continue
        try:
            return body.decode(enc)
        except (LookupError, UnicodeDecodeError):
            continue
    return body.decode("cp1252", errors="replace")


def _source_entry(source: Any) -> dict[str, Any]:
    if isinstance(source, Mapping):
        return dict(source)
    if isinstance(source, str):
        e = SOURCES_BY_KEY.get(source)
        return dict(e) if e else {"key": source}
    return {}


async def fetch(client: httpx.AsyncClient, url: str, *, source: Any = None, sched: Optional[PoliteScheduler] = None,
                method: str = "GET", headers: Optional[Mapping[str, str]] = None,
                timeout_s: float = FETCH_TIMEOUT_S, max_bytes: int = MAX_BODY_BYTES,
                max_hops: int = MAX_REDIRECT_HOPS, url_guard: Optional[UrlGuard] = None) -> FetchResult:
    """§13 F1: asyncio.wait_for(streamed read capped at 1.5 MB, 8 s), redirects followed by hand
    (max 3 hops) so every hop is inspected for cookie walls / waiting rooms.

    `url_guard` (e.g. public_url_guard, §15 X4) is awaited for the first URL and for EVERY
    redirect hop before it is requested, and the connected peer address is re-checked when the
    transport exposes it; a refusal ends the fetch with blocked_reason 'guard:<reason>'.

    Returns {status, final_url, headers, text, challenged, blocked_reason, redirects, truncated,
    fetched_at, url, source}. blocked_reason is None only for a usable answer (2xx page or a real
    404/410). Never raises except DeadlineReached (so callers can checkpoint and stop)."""
    entry = _source_entry(source)
    res: FetchResult = {
        "url": url, "status": 0, "final_url": url, "headers": {}, "text": "", "challenged": False,
        "blocked_reason": None, "redirects": [], "truncated": False, "fetched_at": iso_utc(),
        "source": entry.get("key"),
    }
    if not _is_http_url(url):
        res["blocked_reason"] = "bad_url"
        return res
    if _never_crawl(url):
        res["blocked_reason"] = "never_crawl"
        return res
    req_headers = dict(entry.get("headers") or {})
    req_headers.update(headers or {})
    host = politeness_key(url)

    async def _run() -> None:
        current = url
        for hop in range(max_hops + 1):
            if url_guard is not None:
                refusal = await url_guard(current)
                if refusal:
                    res["blocked_reason"] = f"guard:{refusal}"
                    return
            request = client.build_request(method, current, headers=req_headers)
            resp = await client.send(request, stream=True, follow_redirects=False)
            try:
                if url_guard is not None:
                    peer = _peer_ip(resp)
                    if peer is not None and not ip_is_public(peer):
                        res["status"], res["final_url"] = resp.status_code, current
                        res["blocked_reason"] = "guard:private_peer"
                        return
                status = resp.status_code
                loc = resp.headers.get("location")
                if status in (301, 302, 303, 307, 308) and loc:
                    nxt = urljoin(current, loc)
                    res["redirects"].append(nxt)
                    res["status"], res["final_url"] = status, nxt
                    if not _is_http_url(nxt):
                        res["blocked_reason"] = "bad_redirect"
                        return
                    if _never_crawl(nxt):  # §13 G holds for redirect hops too
                        res["blocked_reason"] = "never_crawl"
                        return
                    if detect_challenge(status, nxt, {}, "", ()):
                        return  # cookie wall / waiting room: never fetch the wall itself
                    if hop >= max_hops:
                        res["blocked_reason"] = "too_many_redirects"
                        return
                    current = nxt
                    continue
                body = bytearray()
                if method.upper() != "HEAD":
                    async for chunk in resp.aiter_bytes():
                        body.extend(chunk)
                        if len(body) >= max_bytes:
                            res["truncated"] = True
                            break
                res["status"] = status
                res["final_url"] = current
                res["headers"] = {k.lower(): v for k, v in resp.headers.items()}
                res["text"] = _decode(bytes(body[:max_bytes]), resp.headers.get("content-type"))
                return
            finally:
                await resp.aclose()

    async def _timed() -> None:
        try:
            await asyncio.wait_for(_run(), timeout=timeout_s)
        except asyncio.TimeoutError:
            res["blocked_reason"] = "timeout"
        except httpx.HTTPError as exc:
            logger.error("[events] fetch %s failed: %s", host, type(exc).__name__)
            res["blocked_reason"] = "network_error"
        except Exception as exc:  # never let one source crash a run
            logger.error("[events] fetch %s unexpected error: %s", host, type(exc).__name__)
            res["blocked_reason"] = "fetch_error"

    min_gap = entry.get("min_gap_s")
    if sched is not None:
        async with sched.slot(url, min_gap_s=float(min_gap) if min_gap is not None else None):
            res["fetched_at"] = iso_utc()
            await _timed()
    else:
        await _timed()

    if res["blocked_reason"] is None:
        reason = detect_challenge(res["status"], res["final_url"], res["headers"], res["text"], res["redirects"])
        status = res["status"]
        if reason:
            res["challenged"] = True
            res["blocked_reason"] = reason
        elif status in (403, 429) or 500 <= status < 600:
            res["blocked_reason"] = f"http_{status}"
        elif status == 0:
            res["blocked_reason"] = "network_error"
    return res


def text_on_page(html: str, needle: str) -> bool:
    """§15 X3 manual verify: is `needle` (the admin's date_text) in the page's VISIBLE text?
    Accent/case/whitespace-insensitive; scripts, styles and JSON-LD never count; needles shorter
    than 6 characters never match (a bare '12' proves nothing)."""
    n = _HSPACE_RE.sub(" ", fold(clean_text(needle))).strip()
    if len(n) < 6:
        return False
    return n in _HSPACE_RE.sub(" ", fold(html_to_text(html or "")))


def page_meta(fres: Mapping[str, Any], url: Optional[str] = None) -> PageMeta:
    return {"url": url or fres.get("url"), "final_url": fres.get("final_url"),
            "fetched_at": fres.get("fetched_at") or iso_utc(), "http_status": int(fres.get("status") or 0)}


def page_text_of(html: str, extra: str = "") -> str:
    """page_text for the gate's PAGE-level Spain signals (§15 Q2): visible text (head + tail, so
    footers with addresses/phones survive the cap) plus the JSON-LD blobs (addressCountry, offsets)."""
    vis = html_to_text(html)
    if len(vis) > 15_000:
        vis = vis[:9_000] + " … " + vis[-6_000:]
    ld = " ".join(json.dumps(n, ensure_ascii=False) for n in ld_nodes(html))[:4_000]
    return _cap(" ".join(x for x in (vis, ld, extra) if x), PAGE_TEXT_CAP)


# ════════════════════════════════════════════════════════════════════════════════════════════
# Candidate / PullResult / Recheck builders
# ════════════════════════════════════════════════════════════════════════════════════════════
PLACEHOLDER_TIMES = frozenset({"00:00", "00:01", "01:00"})  # §15 S1 (+ Fever's 00:01 session stubs)


def edition_year_of(title: str, start_date: Optional[str], text: str = "") -> Optional[int]:
    """Year of the edition as the source states it (title first, then event text), else the
    start_date year (§15 P1)."""
    for s in (title, text):
        m = re.search(r"\b(20\d{2})\b", s or "")
        if m:
            return int(m.group(1))
    d = _date_of(start_date)
    return d.year if d else None


def make_candidate(src: Mapping[str, Any], meta: Mapping[str, Any], *, native_id: str, title: str,
                   start_date: Optional[str], end_date: Optional[str] = None,
                   start_time: Optional[str] = None, end_time: Optional[str] = None,
                   time_confirmed: bool = False, date_text: str, date_visible: bool,
                   event_text: str, page_text: str, venue_name: Optional[str] = None,
                   address: Optional[str] = None, lat: Any = None, lng: Any = None,
                   ld_loc: Optional[Mapping[str, Any]] = None, tz_offset: Optional[str] = None,
                   currency: Optional[str] = None, country_iso: Optional[str] = None,
                   category: Optional[str] = None, edition_year: Optional[int] = None,
                   ticket_url: Optional[str] = None, price: Optional[Mapping[str, Any]] = None,
                   sold_out: bool = False, markers: Optional[Mapping[str, Any]] = None,
                   flags: Iterable[str] = (), extra_source_keys: Iterable[str] = (),
                   parent_source_key: Optional[str] = None, is_umbrella_hint: bool = False,
                   detail_url: Optional[str] = None, recheck_url: Optional[str] = None,
                   context: Optional[Mapping[str, Any]] = None) -> Candidate:
    """One Candidate (§2 fields the adapter knows + gate inputs + evidence[0]). Nothing here is
    inferred beyond what the arguments state; coordinates go through clean_coords().

    source_url is ALWAYS the page we fetched (meta['url']) — §0. A nicer link we did not fetch
    (Hay /p- detail, SecuTix product page, Ticketshop public SPA page) goes to detail_url."""
    flag_list = list(dict.fromkeys(flags))
    la, ln, dropped = clean_coords(lat, lng)
    if dropped:
        flag_list.append(f"coords_dropped_{dropped}")
    title_clean = clean_text(title)
    event_text_c = _cap(clean_text(event_text), EVENT_TEXT_CAP)
    url = str(meta.get("url") or "")
    key = str(src.get("key") or "")
    evidence = {
        "url": url, "name": src.get("name"), "tier": src.get("tier"), "fetched_at": meta.get("fetched_at"),
        "http_status": meta.get("http_status"), "date_text": _cap(clean_text(date_text), 300),
        # §15 R2: HIGH (a) needs HUMAN-VISIBLE date text; JSON/API-only evidence says visible=False.
        "visible": bool(date_visible), "source_key": key,
        # The deterministic parse of THIS page, so the gate never re-derives a weaker one from
        # date_text ('Jueves 5 y Viernes 6 de noviembre', '09.01.2027 - 19:00', '12.00h COT').
        # A time is recorded only when visible text confirmed it.
        "start_date": start_date, "end_date": end_date or start_date,
        "start_time": start_time if (time_confirmed and start_time) else None,
    }
    mk = {"cancel": None, "sold_out": bool(sold_out), "finished": False, "date_notice": None}
    mk.update(dict(markers or {}))
    pr = dict(price) if price else make_price(event_text_c)
    if ticket_url and not _is_http_url(ticket_url):
        ticket_url = None
    return {
        "title": {"es": title_clean},
        "category": category or guess_category(title_clean),
        "start_date": start_date,
        "end_date": end_date or start_date,
        "start_time": start_time,
        "end_time": end_time,
        "time_confirmed": bool(time_confirmed and start_time),
        "edition_year": edition_year or edition_year_of(title_clean, start_date, event_text_c),
        "venue_name": clean_text(venue_name) or None,
        "address": clean_text(address) or None,
        "lat": la, "lng": ln,
        "geocode_source": "source" if la is not None else None,
        "price": pr,
        "ticket_url": ticket_url,
        "source_url": url,
        "detail_url": detail_url if detail_url and _is_http_url(detail_url) and detail_url != url else None,
        "source_name": src.get("name"),
        "source_tier": src.get("tier"),
        "source_key": key,
        "source_keys": list(dict.fromkeys([f"{key}:{native_id}", *extra_source_keys])),
        "recheck_url": recheck_url or url,
        "role": src.get("role"),
        "evidence": [evidence],
        "page_text": _cap(page_text, PAGE_TEXT_CAP),
        "event_text": event_text_c,
        "ld_location": dict(ld_loc) if ld_loc else None,
        "tz_offset": tz_offset,
        "currency": currency,
        "country_iso": country_iso,
        "sold_out": bool(mk.get("sold_out")),
        "markers": mk,
        "flags": flag_list,
        "parent_source_key": parent_source_key,
        "is_umbrella_hint": bool(is_umbrella_hint),
        "context": dict(context) if context else None,
        "origin": "pipeline",
    }


class PullResult(list):  # type: ignore[type-arg]
    """list[Candidate] plus run bookkeeping for the service's cursor (§13 F3):
    next_offset (None = source finished for today), skipped [{url,title,reason}], errors [codes],
    fetches, blocked (discovery page walled), deadline_hit."""

    def __init__(self, items: Iterable[Candidate] = (), *, source_key: str = "", offset: int = 0) -> None:
        super().__init__(items)
        self.source_key = source_key
        self.offset = offset
        self.next_offset: Optional[int] = None
        self.cursor = offset
        self.total = 0
        self.skipped: list[dict[str, Any]] = []
        self.errors: list[str] = []
        self.fetches = 0
        self.blocked = False
        self.deadline_hit = False

    def skip(self, url: Optional[str], reason: str, title: Optional[str] = None) -> None:
        self.skipped.append({"url": url, "title": title, "reason": reason})


RECHECK_OUTCOMES = ("success", "not_found", "blocked", "gone", "date_changed", "cancel_marker", "sold_out", "changed")


def make_recheck(outcome: str, *, http_status: int = 0, found_date_text: Optional[str] = None,
                 parsed: Optional[Mapping[str, Any]] = None, marker: Optional[str] = None,
                 final_url: Optional[str] = None, sold_out: bool = False, time_only: bool = False,
                 detail: Optional[str] = None, head: Optional[Mapping[str, Any]] = None,
                 event_text: Optional[str] = None, venue: Optional[str] = None,
                 notice: Optional[Mapping[str, Any]] = None) -> Recheck:
    """Recheck = {outcome, http_status, found_date_text, parsed:{start_date,end_date,start_time}|None,
    marker, final_url} + sold_out, time_only, detail, head, checked_at, event_text, venue.

    outcome 'sold_out' means: date VERIFIED on the page AND the event's status element says sold out
    (so the sentinel sets last_verified AND sold_out=true). outcome 'changed' is head_recheck only
    (PDF ETag/Last-Modified/Content-Length differ → review/source_changed). `event_text` / `venue`
    are the EVENT-SCOPED text and stated venue of the matched block (§15 Q1): the sentinel re-runs
    the country gate and the venue check on them (a row that moved city or venue is not a success).
    `notice` is notice_announcement() of an unresolved 'nueva fecha' (the sentinel keeps its
    fingerprint on the row so an admin approval acknowledges exactly that notice)."""
    assert outcome in RECHECK_OUTCOMES, outcome
    p = None
    if parsed is not None:
        p = {"start_date": parsed.get("start_date"), "end_date": parsed.get("end_date"),
             "start_time": parsed.get("start_time")}
    return {"outcome": outcome, "http_status": int(http_status or 0),
            "found_date_text": _cap(clean_text(found_date_text), 300) if found_date_text else None,
            "parsed": p, "marker": marker, "final_url": final_url, "sold_out": bool(sold_out),
            "time_only": bool(time_only), "detail": detail, "head": dict(head) if head else None,
            "event_text": _cap(clean_text(event_text), EVENT_TEXT_CAP) if event_text else None,
            "venue": clean_text(venue)[:200] if isinstance(venue, str) and venue.strip() else None,
            "notice": dict(notice) if notice else None,
            "checked_at": iso_utc()}


def _slug_token(url: str) -> Optional[str]:
    """What must survive a redirect for it to still be the same event page: productId/id query
    value, else the last path segment. None for a bare homepage (no off-slug check)."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    qs = parse_qs(parts.query)
    for k in ("productId", "id", "event_id", "p"):
        if qs.get(k):
            return fold(qs[k][0])
    segs = [s for s in parts.path.split("/") if s]
    if not segs:
        return None
    last = re.sub(r"\.(aspx|html?|php)$", "", fold(segs[-1]))
    return last or None


def classify_fetch(fres: Mapping[str, Any], url: str) -> Optional[Recheck]:
    """Terminal outcomes from transport alone (§15 S3): blocked / gone / cancel_marker.
    None means: a 200 page worth parsing."""
    status = int(fres.get("status") or 0)
    final = str(fres.get("final_url") or url)
    reason = fres.get("blocked_reason")
    if "view_canceled" in urlsplit(final).path:
        return make_recheck("cancel_marker", http_status=status, marker="view_canceled", final_url=final)
    if reason and status not in (404, 410):
        return make_recheck("blocked", http_status=status, marker=str(reason), final_url=final, detail=str(reason))
    if status in (404, 410):
        return make_recheck("gone", http_status=status, marker=f"http_{status}", final_url=final)
    token = _slug_token(url)
    if fres.get("redirects") and token and token not in fold(final):
        return make_recheck("gone", http_status=status, marker="redirect_off_slug", final_url=final)
    if status != 200:
        return make_recheck("blocked", http_status=status, marker=f"http_{status}", final_url=final)
    return None


def _doc_title(doc: Mapping[str, Any]) -> str:
    t = doc.get("title")
    if isinstance(t, Mapping):
        return str(t.get("es") or next((v for v in t.values() if v), "") or "")
    return str(t or "")


def compare_to_doc(doc: Mapping[str, Any], found: Mapping[str, Any], fres: Mapping[str, Any],
                   today: Optional[date] = None) -> Recheck:
    """found = {event_found, parsed|None, date_text, cancel, sold_out, finished, gone}.
    Priority: gone → cancel_marker → not_found → finished-while-future → date/time compare → sold_out → success."""
    status = int(fres.get("status") or 0)
    final = fres.get("final_url")
    date_text = found.get("date_text")
    ev_text = found.get("event_text") if isinstance(found.get("event_text"), str) else None
    venue = found.get("venue") if isinstance(found.get("venue"), str) else None
    if found.get("gone"):
        return make_recheck("gone", http_status=status, marker=str(found.get("gone")), final_url=final)
    if found.get("cancel"):
        return make_recheck("cancel_marker", http_status=status, marker=str(found["cancel"]), final_url=final,
                            found_date_text=date_text)
    parsed = found.get("parsed")
    if not found.get("event_found"):
        return make_recheck("not_found", http_status=status, final_url=final, detail="event_block_absent")
    doc_start = doc.get("start_date")
    today = today or bogota_today()
    if found.get("finished") and (_date_of(doc_start) or today) >= today:
        return make_recheck("not_found", http_status=status, final_url=final, marker="finished",
                            found_date_text=date_text, parsed=parsed)
    if not doc_start:  # date_tbc row: an announced date is a change; the named event still being there is success
        if parsed and parsed.get("start_date"):
            return make_recheck("date_changed", http_status=status, final_url=final, found_date_text=date_text,
                                parsed=parsed, marker="date_announced", event_text=ev_text, venue=venue)
        return make_recheck("success", http_status=status, final_url=final, found_date_text=date_text, event_text=ev_text, venue=venue)
    if found.get("date_notice"):
        # §7 table: "nueva fecha" / "cambio de fecha" is resolved against the date the notice
        # ANNOUNCES (the date after the keyword), never the first date on the page ("Fecha original
        # … NUEVA FECHA …"). Announced == stored → the normal compare below (success when the time
        # agrees too): an approved reschedule whose banner stays up until the show is NOT sent back
        # to review every day. Announced ≠ stored, unparseable or ambiguous → date_changed (never
        # auto-applied from this parse alone; the reminder recheck suppresses).
        d0 = _date_of(doc_start)
        ann = notice_announcement(str(found.get("notice_text") or ev_text or ""), ref_year=d0.year if d0 else None)
        resolved = _notice_resolved(doc, ann, parsed)
        if resolved is None and notice_ack_matches(doc, ann) and parsed and \
                (parsed.get("start_date"), parsed.get("end_date") or parsed.get("start_date")) == _stored_range(doc):
            resolved = dict(parsed)     # admin approved this exact notice for these dates; the page states them
        elif ann and ann.get("quote"):
            date_text = ann["quote"]    # the verbatim line that states the date we keep
        if resolved is None:
            ann_parsed = ({"start_date": ann["start_date"], "end_date": ann["end_date"], "start_time": ann["start_time"]}
                          if ann and ann.get("start_date") else parsed)
            return make_recheck("date_changed", http_status=status, final_url=final, found_date_text=date_text,
                                parsed=ann_parsed, marker=f"date_notice:{found['date_notice']}", event_text=ev_text,
                                venue=venue, notice=ann)
        parsed = resolved
    if not parsed or not parsed.get("start_date"):
        return make_recheck("not_found", http_status=status, final_url=final, detail="date_absent")
    if parsed.get("start_date") != doc_start or (
            doc.get("end_date") and parsed.get("end_date") and parsed.get("end_date") != doc.get("end_date")):
        return make_recheck("date_changed", http_status=status, final_url=final, found_date_text=date_text,
                            parsed=parsed, marker=found.get("date_notice"), event_text=ev_text, venue=venue)
    if doc.get("start_time") and parsed.get("start_time") != doc.get("start_time"):
        return make_recheck("date_changed", http_status=status, final_url=final, found_date_text=date_text,
                            parsed=parsed, time_only=True, marker="time_changed" if parsed.get("start_time") else "time_unconfirmed",
                            event_text=ev_text, venue=venue)
    if found.get("sold_out"):
        return make_recheck("sold_out", http_status=status, final_url=final, found_date_text=date_text,
                            parsed=parsed, sold_out=True, event_text=ev_text, venue=venue)
    return make_recheck("success", http_status=status, final_url=final, found_date_text=date_text, parsed=parsed,
                        event_text=ev_text, venue=venue)


def _notice_resolved(doc: Mapping[str, Any], ann: Optional[Mapping[str, Any]],
                     parsed: Optional[Mapping[str, Any]]) -> Optional[dict[str, Any]]:
    """The parse to compare when the notice announces EXACTLY the stored dates; else None.
    The time is the one stated after the announced date, else the block's own time when the
    block's parse is the stored date too (so a stored time that the page no longer confirms
    still ends as a time-only change in the normal compare)."""
    if not ann or not ann.get("start_date"):
        return None
    if (ann.get("start_date"), ann.get("end_date") or ann.get("start_date")) != _stored_range(doc):
        return None
    t = ann.get("start_time")
    if t is None and parsed and (parsed.get("start_date"), parsed.get("end_date") or parsed.get("start_date")) == \
            _stored_range(doc):
        t = parsed.get("start_time")
    return {"start_date": ann["start_date"], "end_date": ann.get("end_date") or ann["start_date"], "start_time": t}


_STOPWORDS = frozenset("de del la las el los en con y a al para por un una the of and in at".split())


def title_overlap(title: str, text: str) -> float:
    words = [w for w in norm_key(title).split() if len(w) >= 3 and w not in _STOPWORDS]
    if not words:
        return 0.0
    hay = f" {norm_key(text)} "
    return sum(1 for w in words if f" {w} " in hay) / len(words)


def _native_ids(doc: Mapping[str, Any], key: str) -> list[str]:
    pref = f"{key}:"
    return [str(k)[len(pref):] for k in (doc.get("source_keys") or []) if str(k).startswith(pref)]


_QUOTE_MIN_CHARS = 20


def _pick(items: Sequence[Candidate], doc: Mapping[str, Any], key: str,
          page_url: Optional[str] = None) -> Optional[Candidate]:
    """The parsed item on a page that corresponds to `doc`: by native source key, else by the
    verbatim evidence date_text (exact, then a UNIQUE row that contains the quote or is contained
    in it, >= 20 normalised chars, quotes taken from `page_url` first), else by title overlap
    (>= 0.75, best wins)."""
    natives = set(_native_ids(doc, key))
    for c in items:
        if any(k.split(":", 1)[1] in natives for k in c.get("source_keys", []) if ":" in k and k.startswith(key + ":")):
            return c
    evs = [e for e in (doc.get("evidence") or []) if isinstance(e, Mapping) and e.get("date_text")]
    ev_texts = {norm_key(str(e["date_text"])) for e in evs}
    ev_texts.discard("")
    for c in items:
        if norm_key(c["evidence"][0]["date_text"]) in ev_texts:
            return c
    rows = [(c, norm_key(c["evidence"][0]["date_text"])) for c in items]
    for e in sorted(evs, key=lambda x: 0 if page_url and x.get("url") == page_url else 1):
        q = norm_key(str(e["date_text"]))
        if len(q) < _QUOTE_MIN_CHARS:
            continue
        hits = [c for c, r in rows if len(r) >= _QUOTE_MIN_CHARS and (q in r or r in q)]
        if len(hits) == 1:
            return hits[0]
    title = _doc_title(doc)
    best, best_score = None, 0.0
    for c in items:
        s = title_overlap(title, c["title"]["es"] + " " + c.get("event_text", ""))
        if s > best_score:
            best, best_score = c, s
    return best if best_score >= 0.75 else None


def found_from_candidate(c: Optional[Candidate]) -> dict[str, Any]:
    if c is None:
        return {"event_found": False}
    mk = c.get("markers") or {}
    return {
        "event_found": True,
        "parsed": {"start_date": c.get("start_date"), "end_date": c.get("end_date"),
                   "start_time": c.get("start_time") if c.get("time_confirmed") else None},
        "date_text": c["evidence"][0]["date_text"],
        "cancel": mk.get("cancel"), "sold_out": bool(mk.get("sold_out")),
        "finished": bool(mk.get("finished")), "date_notice": mk.get("date_notice"),
        "event_text": c.get("event_text"), "notice_text": c.get("event_text"), "venue": c.get("venue_name"),
    }


# ════════════════════════════════════════════════════════════════════════════════════════════
# Adapter base
# ════════════════════════════════════════════════════════════════════════════════════════════
Checkpoint = Callable[[int, str], Awaitable[None]]


class Adapter:
    """pull(client, deadline) -> PullResult (list[Candidate]); recheck(client, doc) -> Recheck.

    Subclasses implement `_pull` and `_recheck`. The base handles the scheduler, per-call caps,
    cursor offsets, deadline and error containment (one bad page never kills a source)."""

    key = ""
    denylist: tuple[str, ...] = ()

    def __init__(self) -> None:
        self.entry: dict[str, Any] = {"key": self.key}

    def bind(self, entry: dict[str, Any]) -> "Adapter":
        self.entry = entry
        return self

    @property
    def src(self) -> dict[str, Any]:
        return self.entry

    async def _get(self, client: httpx.AsyncClient, sched: Optional[PoliteScheduler], url: str, *,
                   res: Optional[PullResult] = None, cache: Optional[dict[str, FetchResult]] = None,
                   fetch_url: Optional[str] = None, **kw: Any) -> FetchResult:
        if cache is not None and url in cache:
            return cache[url]
        fres = await fetch(client, fetch_url or url, source=self.entry, sched=sched, **kw)
        fres["url"] = url
        if res is not None:
            res.fetches += 1
        if cache is not None:
            cache[url] = fres
        return fres

    async def pull(self, client: httpx.AsyncClient, deadline: Optional[float] = None, *, offset: int = 0,
                   sched: Optional[PoliteScheduler] = None, checkpoint: Optional[Checkpoint] = None,
                   now_utc: Optional[datetime] = None) -> PullResult:
        sched = sched or PoliteScheduler(deadline)
        res = PullResult(source_key=self.key, offset=offset)
        try:
            await self._pull(client, sched, res, offset=max(0, int(offset or 0)), checkpoint=checkpoint,
                             now_utc=now_utc or utc_now())
        except DeadlineReached:
            # Resume at the item that was about to be fetched; if discovery itself never finished,
            # resume at the same offset next call.
            res.deadline_hit = True
            if res.total:
                res.next_offset = res.cursor if res.cursor < res.total else None
            else:
                res.next_offset = res.offset
        except Exception as exc:
            logger.error("[events] pull %s failed: %s", self.key, type(exc).__name__)
            res.errors.append(f"pull_failed:{type(exc).__name__}")
            res.next_offset = res.cursor if res.total and res.cursor < res.total else None
        return res

    async def recheck(self, client: httpx.AsyncClient, doc: Mapping[str, Any], *,
                      sched: Optional[PoliteScheduler] = None, cache: Optional[dict[str, FetchResult]] = None,
                      now_utc: Optional[datetime] = None) -> Recheck:
        try:
            return await self._recheck(client, doc, sched=sched, cache=cache, now_utc=now_utc or utc_now())
        except DeadlineReached:
            raise
        except Exception as exc:
            logger.error("[events] recheck %s failed: %s", self.key, type(exc).__name__)
            return make_recheck("blocked", marker="recheck_error", detail=type(exc).__name__)

    async def _pull(self, client: httpx.AsyncClient, sched: PoliteScheduler, res: PullResult, *, offset: int,
                    checkpoint: Optional[Checkpoint], now_utc: datetime) -> None:
        raise NotImplementedError

    async def _recheck(self, client: httpx.AsyncClient, doc: Mapping[str, Any], *, sched: Optional[PoliteScheduler],
                       cache: Optional[dict[str, FetchResult]], now_utc: datetime) -> Recheck:
        return await generic_recheck(client, doc, sched=sched, cache=cache, now_utc=now_utc, adapter=self)

    def _discovery_ok(self, fres: FetchResult, res: PullResult) -> bool:
        if fres.get("blocked_reason") or int(fres.get("status") or 0) != 200:
            res.blocked = True
            res.errors.append(f"discovery_blocked:{fres.get('blocked_reason') or fres.get('status')}")
            return False
        return True

    async def _iterate(self, items: Sequence[Any], res: PullResult, offset: int, checkpoint: Optional[Checkpoint],
                       handler: Callable[[Any], Awaitable[None]], url_of: Callable[[Any], str]) -> None:
        """Process items[offset:] up to max_items_per_call; save the cursor BEFORE each fetch."""
        cap = int(self.entry.get("max_items_per_call") or 10)
        res.total = len(items)
        res.cursor = offset
        done = 0
        for i in range(offset, len(items)):
            if done >= cap:
                break
            res.cursor = i
            item = items[i]
            if checkpoint is not None:
                await checkpoint(i, url_of(item))
            try:
                await handler(item)
            except DeadlineReached:
                raise
            except Exception as exc:
                logger.error("[events] %s item %s failed: %s", self.key, i, type(exc).__name__)
                res.errors.append(f"item_failed:{i}:{type(exc).__name__}")
            done += 1
            res.cursor = i + 1
        res.next_offset = res.cursor if res.cursor < len(items) else None


# ════════════════════════════════════════════════════════════════════════════════════════════
# Tier 1 — Cartagena Festival de Música (cartagenamusicfestival.com)
# ════════════════════════════════════════════════════════════════════════════════════════════
_CMF_EDITION_RES = (
    re.compile(rf"\bdel\s+(\d{{1,2}})\s+(?:de\s+({MONTH_RE})\s+)?al\s+(\d{{1,2}})\s+de\s+({MONTH_RE})\s+(?:de|del)\s+(\d{{4}})", re.I),
    re.compile(rf"\b({MONTH_RE})\s+(\d{{1,2}})\s+al\s+(\d{{1,2}})\s+de\s+(\d{{4}})", re.I),
)


def parse_cmf_editions(html: str) -> list[dict[str, Any]]:
    """Every festival-level 'Del 9 al 17 de enero de 2027' / 'Enero 9 al 17 de 2027' in visible text."""
    text = html_to_text(html)
    out: list[dict[str, Any]] = []
    for i, rx in enumerate(_CMF_EDITION_RES):
        for m in rx.finditer(text):
            g = m.groups()
            if i == 0:
                m2 = month_num(g[3])
                m1 = month_num(g[1]) if g[1] else m2
                y2 = int(g[4])
                y1 = y2 if (m1 or 0) <= (m2 or 0) else y2 - 1
                start, end = ymd(y1, m1, g[0]), ymd(y2, m2, g[2])
            else:
                mo = month_num(g[0])
                start, end = ymd(g[3], mo, g[1]), ymd(g[3], mo, g[2])
            if start and end and end >= start:
                out.append({"start": start, "end": end, "year": int(end[:4]), "text": m.group(0), "span": m.span()})
    return out


def select_newest_edition(editions: Sequence[Mapping[str, Any]]) -> tuple[Optional[Mapping[str, Any]], Optional[str]]:
    """Newest edition only (older editions ignored). All mentions of that edition must agree."""
    if not editions:
        return None, "no_edition_text"
    year = max(int(e["year"]) for e in editions)
    newest = [e for e in editions if int(e["year"]) == year]
    if len({(e["start"], e["end"]) for e in newest}) != 1:
        return None, "edition_dates_disagree"
    return newest[0], None


def parse_cmf_home(html: str, meta: PageMeta) -> tuple[list[Candidate], list[str]]:
    src = SOURCES_BY_KEY["cmf"]
    ed, why = select_newest_edition(parse_cmf_editions(html))
    if not ed:
        return [], [why or "no_edition_text"]
    text = html_to_text(html)
    name = (page_title(html).split("|")[0].strip() or "Cartagena Festival de Música")
    year = int(ed["year"])
    cand = make_candidate(
        src, meta, native_id=f"festival-{year}", title=f"{name} {year}", start_date=ed["start"], end_date=ed["end"],
        date_text=ed["text"], date_visible=True, event_text=sentence_from(text, ed["span"][0]),
        page_text=page_text_of(html), venue_name="Varios escenarios", category="festival", edition_year=year,
        is_umbrella_hint=True)
    return [cand], []


def parse_cmf_programme(html: str) -> list[dict[str, Any]]:
    """/programacion/ rows in page order: {title, subtitle, time, venue, show_url, tc_url, heading,
    private, broadcast}."""
    rows: list[dict[str, Any]] = []
    heading = None
    rx = re.compile(r'<h3[^>]*class="vc_custom_heading[^"]*"[^>]*>(.*?)</h3>|<div class="mkdf-event-list-item\b(.*?)</div>\s*</div>\s*</div>', re.S)
    for m in rx.finditer(html or ""):
        if m.group(1) is not None:
            heading = html_to_text(m.group(1))
            continue
        block = m.group(2)
        title = _first_text(r'class="mkdf-eli-title[^"]*"[^>]*>(.*?)</h6>', block)
        sub = _first_text(r'class="mkdf-eli-subtitle[^"]*"[^>]*>(.*?)</h6>', block) or ""
        show = _first(r'href="([^"]*/show-item/[^"]*)"', block)
        tc = _first(r'href="([^"]*/tc-events/[^"]*)"', block)
        if not title or not show:
            continue
        venue = sub.split("|", 1)[1].strip() if "|" in sub else ""
        rows.append({"title": title, "subtitle": sub, "time": parse_clock(sub.split("|", 1)[0]), "venue": venue,
                     "show_url": show, "tc_url": tc, "heading": heading,
                     "private": bool(PRIVATE_RE.search(sub)), "broadcast": "transmisi" in fold(sub)})
    return rows


def parse_cmf_show(html: str, meta: PageMeta, row: Optional[Mapping[str, Any]] = None,
                   edition_year: Optional[int] = None) -> tuple[Optional[Candidate], Optional[str]]:
    """/show-item/<slug>/: the h6 'Sábado 9 de enero de 2027 - 07:00 p.m.' is the year-bearing,
    human-visible date. Time is kept only when the programme row states the same time."""
    src = SOURCES_BY_KEY["cmf"]
    h6 = _first(r'<div class="mkdf-single-show-description">\s*<h6[^>]*>(.*?)</h6>', html)
    if not h6:
        return None, "no_show_date"
    line = re.sub(r"(\d)\s+(\d)", r"\1\2", html_to_text(h6))  # one page renders '202 7'
    m = re.search(rf"(?:({WEEKDAY_RE})\s+)?(\d{{1,2}})\s+de\s+({MONTH_RE})\s+(?:de|del)\s+(\d{{4}})", line, re.I)
    if not m:
        return None, "no_show_date"
    start = ymd(m.group(4), month_num(m.group(3)), m.group(2))
    if not start:
        return None, "bad_date"
    if not weekday_ok(start, weekday_num(m.group(1))):
        return None, "weekday_mismatch"
    show_time = parse_clock(line[m.end():])
    title = _first_text(r'<h2[^>]*class="[^"]*mkdf-page-title[^"]*"[^>]*>(.*?)</h2>', html) or (row or {}).get("title") or ""
    venue = None
    for rt, ul in re.findall(r'<h6 class="mkdf-show-role-title">(.*?)</h6>\s*<ul>(.*?)</ul>', html, re.S):
        if html_to_text(rt).upper() == "ESCENARIO":
            venue = html_to_text(ul) or None
    flags: list[str] = []
    start_time, confirmed = show_time, False
    if row is not None:
        if row.get("time") and show_time and row["time"] == show_time:
            confirmed = True
        elif row.get("time") != show_time:
            start_time = None
            flags.append("time_disagree")
    elif show_time:
        confirmed = True
    if (row or {}).get("broadcast") or "transmisi" in fold(venue or ""):
        flags.append("broadcast")
    event_text = " | ".join(x for x in (title, line, f"ESCENARIO: {venue}" if venue else "", (row or {}).get("subtitle", "")) if x)
    slug = _slug_token(str(meta.get("url") or "")) or slugify(title)
    year = edition_year or edition_year_of(page_title(html), start)
    cand = make_candidate(
        src, meta, native_id=f"show:{slug}", title=title, start_date=start, start_time=start_time,
        time_confirmed=confirmed, date_text=line, date_visible=True, event_text=event_text,
        page_text=page_text_of(html), venue_name=venue, category="concert", edition_year=year,
        ticket_url=(row or {}).get("tc_url"), flags=flags,
        parent_source_key=f"cmf:festival-{year}" if year else None,
        markers=event_markers(src, event_text))
    return cand, None


class CmfAdapter(Adapter):
    key = "cmf"
    denylist = (r"cancelar\s+respuesta", r"pol[ií]tica\s+de\s+(?:cancelaci[oó]n|devoluci[oó]n)[^.]*")
    HOME = "https://cartagenamusicfestival.com/"
    PROGRAMME = "https://cartagenamusicfestival.com/programacion/"

    async def _pull(self, client: httpx.AsyncClient, sched: PoliteScheduler, res: PullResult, *, offset: int,
                    checkpoint: Optional[Checkpoint], now_utc: datetime) -> None:
        home = await self._get(client, sched, self.HOME, res=res)
        if not self._discovery_ok(home, res):
            return
        cands, skips = parse_cmf_home(home["text"], page_meta(home))
        year = cands[0]["edition_year"] if cands else None
        if offset == 0:
            res.extend(cands)
            for s in skips:
                res.skip(self.HOME, s)
        prog = await self._get(client, sched, self.PROGRAMME, res=res)
        if not self._discovery_ok(prog, res):
            return
        rows = []
        for r in parse_cmf_programme(prog["text"]):
            if r["private"]:
                if offset == 0:
                    res.skip(r["show_url"], "private", r["title"])
                continue
            rows.append(r)

        async def handle(row: Mapping[str, Any]) -> None:
            f = await self._get(client, sched, row["show_url"], res=res)
            if f.get("blocked_reason") or f.get("status") != 200:
                res.skip(row["show_url"], f"fetch_{f.get('blocked_reason') or f.get('status')}", row["title"])
                return
            c, why = parse_cmf_show(f["text"], page_meta(f, row["show_url"]), row, year)
            if c:
                res.append(c)
            else:
                res.skip(row["show_url"], why or "unparsed", row["title"])

        await self._iterate(rows, res, offset, checkpoint, handle, lambda r: r["show_url"])

    async def _recheck(self, client: httpx.AsyncClient, doc: Mapping[str, Any], *, sched: Optional[PoliteScheduler],
                       cache: Optional[dict[str, FetchResult]], now_utc: datetime) -> Recheck:
        url = str(doc.get("recheck_url") or doc.get("source_url") or self.HOME)
        fres = await self._get(client, sched, url, cache=cache)
        term = classify_fetch(fres, url)
        if term:
            return term
        if "/show-item/" in url:
            c, _ = parse_cmf_show(fres["text"], page_meta(fres, url))
            if c:
                c["time_confirmed"] = bool(c.get("start_time"))
            return compare_to_doc(doc, found_from_candidate(c), fres, bogota_today(now_utc))
        cands, _ = parse_cmf_home(fres["text"], page_meta(fres, url))
        return compare_to_doc(doc, found_from_candidate(cands[0] if cands else None), fres, bogota_today(now_utc))


# ════════════════════════════════════════════════════════════════════════════════════════════
# Tier 1 — Hay Festival Cartagena de Indias (hayfestival.com, /cartagena/ ONLY)
# ════════════════════════════════════════════════════════════════════════════════════════════
HAY_BASE = "https://www.hayfestival.com"
_HAY_PROGRAMME_RE = re.compile(r"/m-(\d+)-cartagena-(\d{4})\.aspx")


def hay_programme_links(html: str) -> list[tuple[str, int]]:
    """[(listing_url, year)] for Cartagena programmes only (m-<id>-cartagena-<yyyy>.aspx)."""
    seen: dict[int, str] = {}
    for mid, yr in _HAY_PROGRAMME_RE.findall(html or ""):
        seen.setdefault(int(yr), f"{HAY_BASE}/m-{mid}-cartagena-{yr}.aspx?skinid=5&localesetting=es-ES&currencysetting=COP&categoryfilterid=0&sectionfilterid=0&genrefilterid=0&vectorfilterid=0&pagenum=1")
    return sorted(((u, y) for y, u in seen.items()), key=lambda x: x[1])


def parse_hay_inicio(html: str, meta: PageMeta) -> tuple[list[Candidate], list[str]]:
    src = SOURCES_BY_KEY["hay"]
    h1 = _first_text(r"<h1[^>]*>(.*?)</h1>", html) or ""
    lead_html = _first(r'<p class="lead"[^>]*>(.*?)</div>', html) or ""
    lead = html_to_text(lead_html)
    m = re.search(rf"\bdel\s+(\d{{1,2}})\s+(?:de\s+({MONTH_RE})\s+)?al\s+(\d{{1,2}})\s+de\s+({MONTH_RE})\s+(?:de|del)\s+(\d{{4}})", lead, re.I)
    if not m or "cartagena" not in fold(h1):
        return [], ["no_edition_text"]
    m2 = month_num(m.group(4))
    m1 = month_num(m.group(2)) if m.group(2) else m2
    y2 = int(m.group(5))
    start = ymd(y2 if (m1 or 0) <= (m2 or 0) else y2 - 1, m1, m.group(1))
    end = ymd(y2, m2, m.group(3))
    h1_year = re.search(r"\b(20\d{2})\b", h1)
    if not start or not end or (h1_year and int(h1_year.group(1)) != y2):
        return [], ["edition_year_mismatch"]
    cand = make_candidate(
        src, meta, native_id=f"festival-{y2}", title=h1, start_date=start, end_date=end, date_text=m.group(0),
        date_visible=True, event_text=f"{h1} | {sentence_from(lead, m.start())}", page_text=page_text_of(html),
        venue_name="Varios escenarios", category="festival", edition_year=y2, is_umbrella_hint=True)
    return [cand], []


def parse_hay_listing(html: str, meta: PageMeta, *, programme_year: Optional[int] = None) -> tuple[list[Candidate], list[dict[str, str]]]:
    """A Hay programme listing (list or grid layout). <time datetime='YYYY-MM-DD HH:MM'> is local
    COT; the visible time text must agree for time_confirmed."""
    src = SOURCES_BY_KEY["hay"]
    out: list[Candidate] = []
    skips: list[dict[str, str]] = []
    starts = [m.start() for m in re.finditer(r'<div class="(?:progItem|product-event-list)\b', html or "")]
    page_text = page_text_of(html)
    for s, e in zip(starts, starts[1:] + [len(html)]):
        card = html[s:e]
        h5 = _first(r'<h5 class="datetimevenue">(.*?)</h5>', card)
        if not h5:
            continue
        tm = re.search(r'<time datetime="(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})"[^>]*>(.*?)</time>', h5, re.S)
        if not tm:
            continue
        title = _first_text(r'<h2 class="event"[^>]*>(.*?)</h2>', card) or ""
        subtitle = _first_text(r'<h3 class="subtitle"[^>]*>(.*?)</h3>', card) or ""
        href = re.search(r'href="(/p-(\d+)-[^"]+?\.aspx)"', card)
        url = HAY_BASE + href.group(1) if href else str(meta.get("url"))
        vis = html_to_text(tm.group(3))
        venue = _first_text(r'<span class="venue"[^>]*>(.*?)</span>', h5) or html_to_text(h5).replace(vis, "").strip(" –-")
        basket = " | ".join(html_to_text(x) for x in re.findall(r'<span class="(?:BasketMessage|soldOut)[^"]*"[^>]*>(.*?)</span>', card, re.S))
        start, attr_time = tm.group(1), tm.group(2)
        vis_date = first_date(vis, int(start[:4]))
        if vis_date and vis_date["start"] != start:
            skips.append({"url": url, "title": title, "reason": "visible_date_disagrees"})
            continue
        if PRIVATE_RE.search(basket) or PRIVATE_RE.search(subtitle):
            skips.append({"url": url, "title": title, "reason": "private"})
            continue
        vis_time = parse_clock(vis)
        event_text = " | ".join(x for x in (title, subtitle, html_to_text(h5), basket) if x)
        cand = make_candidate(
            src, meta, native_id=f"p-{href.group(2)}" if href else f"{start}-{slugify(title, 40)}", title=title,
            start_date=start, start_time=attr_time, time_confirmed=vis_time == attr_time,
            date_text=vis, date_visible=vis_date is not None, event_text=event_text, page_text=page_text, venue_name=venue,
            category="cultural", edition_year=programme_year, detail_url=url,
            parent_source_key=f"hay:festival-{programme_year}" if programme_year else None,
            markers={"cancel": find_cancel_marker(basket, _deny(src)), "sold_out": find_sold_out(basket, _deny(src)),
                     "finished": find_finished(basket, _deny(src))},
            price=make_price(event_text))
        out.append(cand)
    return out, skips


def parse_hay_detail(html: str, meta: PageMeta) -> Optional[Candidate]:
    """/p-<id>-<slug>.aspx: <time datetime='2026-01-29 17:30'>Thursday 29 January 2026</time>."""
    src = SOURCES_BY_KEY["hay"]
    tm = re.search(r'<time datetime="(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})"[^>]*>(.*?)</time>', html or "", re.S)
    if not tm:
        return None
    vis = html_to_text(tm.group(3))
    vd = first_date(vis, int(tm.group(1)[:4]))
    if vd and vd["start"] != tm.group(1):
        return None
    title = (page_title(html).split(" - Hay Festival")[0]).strip()
    return make_candidate(src, meta, native_id=f"p-{_first(r'/p-(\d+)-', str(meta.get('url') or '')) or slugify(title, 40)}",
                          title=title, start_date=tm.group(1), start_time=tm.group(2),
                          time_confirmed=parse_clock(vis) == tm.group(2), date_text=vis, date_visible=vd is not None,
                          event_text=f"{title} | {vis}", page_text=page_text_of(html))


def _hay_is_cartagena_url(url: str) -> bool:
    p = urlsplit(url).path.lower()
    return p.startswith("/cartagena/") or bool(re.match(r"^/m-\d+-cartagena-\d{4}\.aspx$", p)) or p.startswith("/p-")


class HayAdapter(Adapter):
    key = "hay"
    denylist = (r"please\s+log\s+in\s+to\s+add\s+this\s+event\s+to\s+your\s+wish\s+list[^.]*",
                r"if\s+(?:an|the|this)\s+event\s+is\s+(?:cancell?ed|postponed)[^.]*")
    INICIO = f"{HAY_BASE}/cartagena/inicio"

    async def _pull(self, client: httpx.AsyncClient, sched: PoliteScheduler, res: PullResult, *, offset: int,
                    checkpoint: Optional[Checkpoint], now_utc: datetime) -> None:
        home = await self._get(client, sched, self.INICIO, res=res)
        if not self._discovery_ok(home, res):
            return
        cands, skips = parse_hay_inicio(home["text"], page_meta(home))
        if offset == 0:
            res.extend(cands)
            for s in skips:
                res.skip(self.INICIO, s)
        edition = cands[0]["edition_year"] if cands else None
        links = hay_programme_links(home["text"])
        if not links or edition is None or links[-1][1] < edition:
            if offset == 0:
                res.skip(self.INICIO, "programme_not_published")
            res.total = 0
            return
        first_url, year = links[-1]
        first = await self._get(client, sched, first_url, res=res)
        if not self._discovery_ok(first, res):
            return
        pages = max([1] + [int(p) for p in re.findall(r"pagenum=(\d+)", first["text"])])
        page_urls = [re.sub(r"pagenum=\d+", f"pagenum={n}", first_url) for n in range(1, pages + 1)]

        async def handle(u: str) -> None:
            f = first if u == first_url else await self._get(client, sched, u, res=res)
            if f.get("blocked_reason") or f.get("status") != 200:
                res.skip(u, f"fetch_{f.get('blocked_reason') or f.get('status')}")
                return
            items, sk = parse_hay_listing(f["text"], page_meta(f, u), programme_year=year)
            res.extend(items)
            for s in sk:
                res.skip(s["url"], s["reason"], s["title"])

        await self._iterate(page_urls, res, offset, checkpoint, handle, lambda u: u)

    async def _recheck(self, client: httpx.AsyncClient, doc: Mapping[str, Any], *, sched: Optional[PoliteScheduler],
                       cache: Optional[dict[str, FetchResult]], now_utc: datetime) -> Recheck:
        url = str(doc.get("recheck_url") or doc.get("source_url") or self.INICIO)
        if not _hay_is_cartagena_url(url):
            return make_recheck("blocked", marker="out_of_scope", detail="hay_non_cartagena_url")
        fres = await self._get(client, sched, url, cache=cache)
        term = classify_fetch(fres, url)
        if term:
            return term
        today = bogota_today(now_utc)
        if "/p-" in url:
            return compare_to_doc(doc, found_from_candidate(parse_hay_detail(fres["text"], page_meta(fres, url))), fres, today)
        if "/m-" in url:
            items, _ = parse_hay_listing(fres["text"], page_meta(fres, url))
            return compare_to_doc(doc, found_from_candidate(_pick(items, doc, self.key)), fres, today)
        cands, _ = parse_hay_inicio(fres["text"], page_meta(fres, url))
        return compare_to_doc(doc, found_from_candidate(cands[0] if cands else None), fres, today)


# ════════════════════════════════════════════════════════════════════════════════════════════
# Tier 1 — FICCI (ficcifestival.com)
# ════════════════════════════════════════════════════════════════════════════════════════════
FICCI_BASE = "https://www.ficcifestival.com"
_FICCI_RANGE_RE = re.compile(
    rf"(\d{{1,2}})\s+(?:de\s+)?({MONTH_RE})?\s*[–—-]\s*(\d{{1,2}})\s+(?:de\s+)?({MONTH_RE})\s+(?:de\s+)?(\d{{4}})", re.I)


def parse_ficci_home(html: str, meta: PageMeta) -> tuple[list[Candidate], list[str]]:
    src = SOURCES_BY_KEY["ficci"]
    h1 = _first_text(r'<h1[^>]*class="[^"]*overlay-text[^"]*"[^>]*>(.*?)</h1>', html) or _first_text(r"<h1[^>]*>(.*?)</h1>", html) or ""
    m = _FICCI_RANGE_RE.search(h1)
    if not m or "cartagena" not in fold(h1):
        return [], ["no_edition_text"]
    m2 = month_num(m.group(4))
    m1 = month_num(m.group(2)) if m.group(2) else m2
    y2 = int(m.group(5))
    start = ymd(y2 if (m1 or 0) <= (m2 or 0) else y2 - 1, m1, m.group(1))
    end = ymd(y2, m2, m.group(3))
    if not start or not end:
        return [], ["bad_date"]
    base = h1[:m.start()].strip(" -–|")
    cand = make_candidate(
        src, meta, native_id=f"festival-{y2}", title=f"{base} (FICCI) {y2}", start_date=start, end_date=end,
        date_text=m.group(0), date_visible=True, event_text=h1, page_text=page_text_of(html),
        venue_name="Varios escenarios", category="festival", edition_year=y2, is_umbrella_hint=True)
    return [cand], []


def parse_ficci_eventos(html: str, meta: PageMeta, *, edition_year: Optional[int] = None) -> tuple[list[Candidate], list[dict[str, str]]]:
    """/eventos?field_date_value=N — <time datetime='…Z'> is REAL UTC (07:00 COT = 12:00Z):
    converted to Bogotá; the visible text inside <time> must equal the converted time."""
    src = SOURCES_BY_KEY["ficci"]
    out: list[Candidate] = []
    skips: list[dict[str, str]] = []
    url = str(meta.get("url") or "")
    page_text = page_text_of(html)
    heading_positions = [(m.start(), html_to_text(m.group(1))) for m in re.finditer(r"<h3[^>]*>(.*?)</h3>", html or "", re.S)]
    for m in re.finditer(r'<div class="box-ev\b(.*?)<div class="ev-lug">(.*?)</div>', html or "", re.S):
        box = m.group(1)
        times = re.findall(r'<time datetime="([^"]+)"[^>]*>(.*?)</time>', box, re.S)
        if not times:
            continue
        title = _first_text(r'<h4 class="ev-title"[^>]*>(.*?)</h4>', box) or ""
        body = _first_text(r'<div class="ev-body"[^>]*>(.*?)</div>', box) or ""
        ctg = _first_text(r'<div class="ev-ctg"[^>]*>(.*?)</div>', box) or ""
        lug = html_to_text(m.group(2)).strip()
        venue = None if lug.endswith(":") else (lug or None)  # 'Barrios :' = several neighbourhoods, no venue
        if PRIVATE_RE.search(f"{title} {body}"):
            skips.append({"url": url, "title": title, "reason": "private"})
            continue
        loc = [utc_to_bogota(t[0]) for t in times]
        if not loc[0]:
            continue
        vis_start = parse_clock(html_to_text(times[0][1]))
        heading = next((h for pos, h in reversed(heading_positions) if pos < m.start()), "")
        hd = first_date(heading, int(loc[0]["date"][:4]))
        if hd and hd["start"] != loc[0]["date"]:
            skips.append({"url": url, "title": title, "reason": "heading_disagrees"})
            continue
        end_loc = loc[1] if len(loc) > 1 and loc[1] else None
        event_text = " | ".join(x for x in (title, ctg, heading, " - ".join(html_to_text(t[1]) for t in times), venue or "", body[:300]) if x)
        year = edition_year or int(loc[0]["date"][:4])
        out.append(make_candidate(
            src, meta, native_id=f"ev-{loc[0]['date'].replace('-', '')}-{slugify(title, 40)}", title=title,
            start_date=loc[0]["date"], end_date=end_loc["date"] if end_loc and end_loc["date"] >= loc[0]["date"] else None,
            start_time=loc[0]["time"], end_time=end_loc["time"] if end_loc else None,
            time_confirmed=vis_start == loc[0]["time"], date_text=f"{heading} {html_to_text(times[0][1])}".strip(),
            date_visible=hd is not None, event_text=event_text, page_text=page_text, venue_name=venue, category="cultural",
            edition_year=year, parent_source_key=f"ficci:festival-{year}",
            flags=[] if venue else ["no_venue"], markers=event_markers(src, f"{title} {body}")))
    return out, skips


class FicciAdapter(Adapter):
    key = "ficci"
    denylist = (r"cancelar\s+respuesta",)
    HOME = f"{FICCI_BASE}/"

    async def _pull(self, client: httpx.AsyncClient, sched: PoliteScheduler, res: PullResult, *, offset: int,
                    checkpoint: Optional[Checkpoint], now_utc: datetime) -> None:
        home = await self._get(client, sched, self.HOME, res=res)
        if not self._discovery_ok(home, res):
            return
        cands, skips = parse_ficci_home(home["text"], page_meta(home))
        if offset == 0:
            res.extend(cands)
            for s in skips:
                res.skip(self.HOME, s)
        edition = cands[0]["edition_year"] if cands else None
        d1_url = f"{FICCI_BASE}/eventos?field_date_value=1"
        d1 = await self._get(client, sched, d1_url, res=res)
        if not self._discovery_ok(d1, res):
            return
        years = {int(y) for y in re.findall(r'<time datetime="(\d{4})-', d1["text"])}
        if edition is None or edition not in years:
            if offset == 0:
                res.skip(d1_url, "programme_not_published")
            res.total = 0
            return
        days = sorted({int(n) for n in re.findall(r'id="edit-field-date-value-(\d+)"', d1["text"])}) or [1]
        urls = [f"{FICCI_BASE}/eventos?field_date_value={n}" for n in days]

        async def handle(u: str) -> None:
            f = d1 if u == d1_url else await self._get(client, sched, u, res=res)
            if f.get("blocked_reason") or f.get("status") != 200:
                res.skip(u, f"fetch_{f.get('blocked_reason') or f.get('status')}")
                return
            items, sk = parse_ficci_eventos(f["text"], page_meta(f, u), edition_year=edition)
            res.extend(items)
            for s in sk:
                res.skip(s["url"], s["reason"], s["title"])

        await self._iterate(urls, res, offset, checkpoint, handle, lambda u: u)

    async def _recheck(self, client: httpx.AsyncClient, doc: Mapping[str, Any], *, sched: Optional[PoliteScheduler],
                       cache: Optional[dict[str, FetchResult]], now_utc: datetime) -> Recheck:
        url = str(doc.get("recheck_url") or doc.get("source_url") or self.HOME)
        fres = await self._get(client, sched, url, cache=cache)
        term = classify_fetch(fres, url)
        if term:
            return term
        today = bogota_today(now_utc)
        if "/eventos" in url:
            items, _ = parse_ficci_eventos(fres["text"], page_meta(fres, url))
            return compare_to_doc(doc, found_from_candidate(_pick(items, doc, self.key)), fres, today)
        cands, _ = parse_ficci_home(fres["text"], page_meta(fres, url))
        return compare_to_doc(doc, found_from_candidate(cands[0] if cands else None), fres, today)


# ════════════════════════════════════════════════════════════════════════════════════════════
# Tier 1 — IRONMAN 70.3 Cartagena (ironman.com). tz_policy: date only.
# ════════════════════════════════════════════════════════════════════════════════════════════
def parse_ironman(html: str, meta: PageMeta) -> tuple[Optional[Candidate], Optional[str]]:
    """JSON-LD startDate '2026-11-29T00:00:00+0000' is a DATE: taken literally, never shifted
    (a naive conversion lands on 28 Nov 19:00). The hero's visible date must agree."""
    src = SOURCES_BY_KEY["ironman"]
    ev = next(iter(ld_events(html)), None)
    ld_s = split_iso(ev.get("startDate")) if ev else None
    ld_placeholder = ld_placeholder_date(ld_s, split_iso(ev.get("endDate")) if ev else None, meta.get("fetched_at"))
    ld_date = None if ld_placeholder else (ld_s or {}).get("date")
    i = (html or "").find("race-hero-content")
    hero = html[i:i + 6000] if i >= 0 else ""
    vis = _first_text(r'<p class="[^"]*\bdate\b[^"]*"[^>]*>(.*?)</p>', hero) or ""
    title = _first_text(r"<h1[^>]*>(.*?)</h1>", hero) or clean_text((ev or {}).get("name")) or page_title(html).split("|")[0].strip()
    label = _first_text(r'<span class="label">(.*?)</span>', hero) or ""
    tags = [html_to_text(t) for t in re.findall(r'<span class="[^"]*\btag\b[^"]*"[^>]*>(.*?)</span>', hero, re.S)]
    vd = first_date(vis, need_year=True)
    if not vd and not ld_date:
        return None, "no_date"
    if vd and ld_date and vd["start"] != ld_date:
        return None, "ld_visible_date_conflict"
    start = str(vd["start"] if vd else ld_date)
    loc = ld_location(ev) if ev else None
    geo = (loc or {}).get("geo") or {}
    event_text = " | ".join(x for x in (title, vis, label, *tags) if x)
    flags = ["registration_sold_out"] if any(re.search(r"registration\s+sold\s+out", t, re.I) for t in tags) else []
    if ld_placeholder:
        flags.append("ld_placeholder_date")
    slug = _slug_token(str(meta.get("url") or "")) or slugify(title)
    cand = make_candidate(
        src, meta, native_id=f"{slug}-{start[:4]}", title=title, start_date=start, date_text=vis or str((ev or {}).get("startDate")),
        date_visible=bool(vd), event_text=event_text, page_text=page_text_of(html), venue_name=None,
        lat=geo.get("latitude"), lng=geo.get("longitude"), ld_loc=loc, category="sports",
        flags=flags, markers=event_markers(src, " | ".join(tags + [vis])),
        price={"is_free": None, "min_cop": None, "max_cop": None, "text": None})
    return cand, None


class IronmanAdapter(Adapter):
    key = "ironman"
    # 'Registration Sold Out' is the entry list, not the race; refund/transfer policy is T&C.
    denylist = (r"registration\s+sold\s+out", r"if\s+the\s+race\s+is\s+(?:cancell?ed|postponed)[^.]*",
                r"race\s+cancell?ation\s+polic(?:y|ies)[^.]*")
    RACE = "https://www.ironman.com/races/im703-cartagena"

    async def _pull(self, client: httpx.AsyncClient, sched: PoliteScheduler, res: PullResult, *, offset: int,
                    checkpoint: Optional[Checkpoint], now_utc: datetime) -> None:
        f = await self._get(client, sched, self.RACE, res=res)
        if not self._discovery_ok(f, res):
            return
        c, why = parse_ironman(f["text"], page_meta(f, self.RACE))
        if c:
            res.append(c)
        else:
            res.skip(self.RACE, why or "unparsed")

    async def _recheck(self, client: httpx.AsyncClient, doc: Mapping[str, Any], *, sched: Optional[PoliteScheduler],
                       cache: Optional[dict[str, FetchResult]], now_utc: datetime) -> Recheck:
        url = str(doc.get("recheck_url") or doc.get("source_url") or self.RACE)
        fres = await self._get(client, sched, url, cache=cache)
        term = classify_fetch(fres, url)
        if term:
            return term
        c, _ = parse_ironman(fres["text"], page_meta(fres, url))
        return compare_to_doc(doc, found_from_candidate(c), fres, bogota_today(now_utc))


# ════════════════════════════════════════════════════════════════════════════════════════════
# Agenda rows ('Jueves 12 de noviembre: Gran Desfile … (Avenida Santander – 10:00 a.m. a 12:00 p.m.).')
# shared by IPCC (tier 1, corroboration + recheck) and El Universal (tier 5, corroboration only)
# ════════════════════════════════════════════════════════════════════════════════════════════
_ROW_RE = re.compile(
    rf"^\W*(?P<wd1>{WEEKDAY_RE})\s+(?P<d1>\d{{1,2}})(?:\s+de\s+(?P<m1>{MONTH_RE}))?"
    rf"(?:\s+(?:y|al|a)\s+(?:(?P<wd2>{WEEKDAY_RE})\s+)?(?P<d2>\d{{1,2}}))?\s+de\s+(?P<m2>{MONTH_RE})"
    r"\s*\**\s*:\s*\**\s*(?P<rest>\S.*)$", re.I)


def _split_row_rest(rest: str) -> dict[str, Any]:
    rest = rest.strip().rstrip(".").strip()
    cut = [p for p in (rest.find(" ("), rest.find(" con "), rest.find(";"), rest.find(", ")) if p > 0]
    title = rest[:min(cut)] if cut else rest
    title = title.strip(" .,*")
    if fold(title).startswith("con "):
        title = title[4:].strip()
    paren = _first(r"\(([^()]*)\)", rest)
    tentative = "por confirmar" in fold(rest)
    clocks = all_clocks(paren or "")
    venue = None
    if paren:
        v = re.split(r"\s[–—-]\s|\s-\s", paren)[0]
        v = re.sub(r"(?i)por confirmar", "", v).strip(" –-,")
        venue = v if v and not find_clock(v) else None
    # 'Sábado 14 de noviembre: Jader Tremendo, GiBlack, Mr Black, …' is a line-up, not an event title.
    lineup = paren is None and (rest.count(",") >= 3 or fold(rest).startswith("con "))
    return {"title": title, "venue": venue, "start_time": clocks[0] if clocks else None,
            "end_time": clocks[1] if len(clocks) > 1 else None, "tentative": tentative, "lineup": lineup}


def parse_agenda_rows(lines: Sequence[str], ref_year: int) -> list[dict[str, Any]]:
    """Weekday-anchored agenda rows. The year comes from the weekday (ref_year..+1), never from a
    dateline; rows whose weekday matches no year are dropped."""
    rows: list[dict[str, Any]] = []
    for line in lines:
        m = _ROW_RE.match(line.strip())
        if not m:
            continue
        m2 = month_num(m.group("m2"))
        m1 = month_num(m.group("m1")) if m.group("m1") else m2
        if not m1 or not m2:
            continue
        d1 = int(m.group("d1"))
        y1 = year_by_weekday(m1, d1, weekday_num(m.group("wd1")), ref_year)
        if y1 is None:
            continue
        start = ymd(y1, m1, d1)
        end = start
        if m.group("d2"):
            y2 = y1 if m2 >= m1 else y1 + 1
            end = ymd(y2, m2, m.group("d2"))
            if not end or end < (start or "") or not weekday_ok(end, weekday_num(m.group("wd2"))):
                continue
        rest = _split_row_rest(m.group("rest"))
        rows.append({"start_date": start, "end_date": end, "raw": line.strip(), **rest})
    return rows


def parse_rss_items(xml: str) -> list[dict[str, Any]]:
    """RSS 2.0 items (regex, CDATA-aware; tolerant of broken feeds)."""
    out: list[dict[str, Any]] = []
    for it in re.findall(r"<item\b[^>]*>(.*?)</item>", xml or "", re.S):
        def tag(name: str) -> str:
            m = re.search(rf"<{re.escape(name)}\b[^>]*>(.*?)</{re.escape(name)}>", it, re.S)
            v = m.group(1).strip() if m else ""
            cd = re.match(r"^<!\[CDATA\[(.*)\]\]>$", v, re.S)
            return cd.group(1) if cd else v
        pub = None
        try:
            pd = tag("pubDate")
            pub = email.utils.parsedate_to_datetime(pd).astimezone(timezone.utc) if pd else None
        except (TypeError, ValueError):
            pub = None
        out.append({"title": clean_text(tag("title")), "link": clean_text(tag("link")), "published": pub,
                    "content_html": tag("content:encoded") or _html.unescape(tag("description"))})
    return out


_AGENDA_TOPIC_RE = re.compile(r"agenda|programacion|fiestas|festival|concierto|preludio|desfile|teatro adolfo", re.I)


def agenda_candidates(src: Mapping[str, Any], meta: PageMeta, *, article_title: str, content_html: str,
                      published: Optional[datetime], page_text: str, ref_year: Optional[int] = None) -> list[Candidate]:
    if ref_year is None:
        ref_year = published.astimezone(BOGOTA_TZ).year if published else bogota_today().year
    rows = parse_agenda_rows(html_to_lines(content_html), ref_year)
    url = str(meta.get("url") or "")
    post_slug = _slug_token(url) or "post"
    out: list[Candidate] = []
    for r in rows:
        flags = ["agenda_row"] + (["tentative"] if r["tentative"] else []) + (["lineup"] if r["lineup"] else [])
        out.append(make_candidate(
            src, meta, native_id=f"{post_slug}#{r['start_date'].replace('-', '')}-{slugify(r['title'], 40)}",
            title=r["title"], start_date=r["start_date"], end_date=r["end_date"],
            start_time=None if r["tentative"] else r["start_time"], end_time=r["end_time"],
            time_confirmed=bool(r["start_time"]) and not r["tentative"], date_text=r["raw"], date_visible=True,
            event_text=r["raw"], page_text=page_text, venue_name=None if r["tentative"] else r["venue"],
            category=guess_category(r["title"]), flags=flags,
            markers=event_markers(src, r["raw"]),
            context={"article_title": article_title, "article_url": url,
                     "published": iso_utc(published) if published else None}))
    return out


def parse_agenda_feed(src_key: str, xml: str, fetched_at: str, http_status: int) -> tuple[list[Candidate], list[dict[str, str]]]:
    src = SOURCES_BY_KEY[src_key]
    out: list[Candidate] = []
    skips: list[dict[str, str]] = []
    for it in parse_rss_items(xml):
        hay = fold(f"{it['title']} {html_to_text(it['content_html'])[:4000]}")
        if not _AGENDA_TOPIC_RE.search(hay):
            continue
        meta = {"url": it["link"], "final_url": it["link"], "fetched_at": fetched_at, "http_status": http_status}
        cands = agenda_candidates(src, meta, article_title=it["title"], content_html=it["content_html"],
                                  published=it["published"], page_text=_cap(f"{it['title']} {html_to_text(it['content_html'])}", PAGE_TEXT_CAP))
        if not cands:
            skips.append({"url": it["link"], "title": it["title"], "reason": "no_agenda_rows"})
        out.extend(cands)
    return out, skips


def parse_wp_posts_json(src_key: str, body: str, fetched_at: str, http_status: int) -> list[Candidate]:
    """WordPress REST /wp-json/wp/v2/posts?search=… with _fields=link,title,content,date_gmt."""
    src = SOURCES_BY_KEY[src_key]
    try:
        posts = json.loads(body or "[]")
    except ValueError:
        return []
    out: list[Candidate] = []
    for p in posts if isinstance(posts, list) else []:
        if not isinstance(p, dict):
            continue
        link = str(p.get("link") or "")
        title = clean_text(_TAG_RE.sub(" ", str((p.get("title") or {}).get("rendered") or "")))
        content = str((p.get("content") or {}).get("rendered") or "")
        pub = None
        split = split_iso(str(p.get("date_gmt") or "") + "Z")
        if split and split.get("time"):
            pub = datetime.fromisoformat(f"{split['date']}T{split['time']}").replace(tzinfo=timezone.utc)
        meta = {"url": link, "final_url": link, "fetched_at": fetched_at, "http_status": http_status}
        out.extend(agenda_candidates(src, meta, article_title=title, content_html=content, published=pub,
                                     page_text=_cap(f"{title} {html_to_text(content)}", PAGE_TEXT_CAP)))
    return out


class _AgendaAdapter(Adapter):
    """RSS-driven agenda rows. role='corroborate': the service attaches these as evidence to
    matching docs; it must not publish a new doc from them alone."""

    FEEDS: tuple[str, ...] = ()

    async def _pull(self, client: httpx.AsyncClient, sched: PoliteScheduler, res: PullResult, *, offset: int,
                    checkpoint: Optional[Checkpoint], now_utc: datetime) -> None:
        feeds = list(self.FEEDS)

        async def handle(u: str) -> None:
            f = await self._get(client, sched, u, res=res)
            if f.get("blocked_reason") or f.get("status") != 200:
                res.errors.append(f"feed_blocked:{f.get('blocked_reason') or f.get('status')}")
                return
            if u.rstrip("/").endswith("feed") or "outboundfeeds" in u:
                items, sk = parse_agenda_feed(self.key, f["text"], f["fetched_at"], int(f["status"]))
            else:
                items, sk = parse_wp_posts_json(self.key, f["text"], f["fetched_at"], int(f["status"])), []
            seen = {k for c in res for k in c["source_keys"]}
            res.extend(c for c in items if not set(c["source_keys"]) & seen)
            for s in sk:
                res.skip(s["url"], s["reason"], s["title"])

        await self._iterate(feeds, res, offset, checkpoint, handle, lambda u: u)

    async def _recheck(self, client: httpx.AsyncClient, doc: Mapping[str, Any], *, sched: Optional[PoliteScheduler],
                       cache: Optional[dict[str, FetchResult]], now_utc: datetime) -> Recheck:
        url = str(doc.get("recheck_url") or doc.get("source_url") or "")
        fres = await self._get(client, sched, url, cache=cache)
        term = classify_fetch(fres, url)
        if term:
            return term
        d = _date_of(doc.get("start_date"))
        ref_year = (d.year - 1) if d else bogota_today(now_utc).year
        meta = page_meta(fres, url)
        items = agenda_candidates(self.entry, meta, article_title=page_title(fres["text"]), content_html=fres["text"],
                                  published=None, page_text="", ref_year=ref_year)
        if doc.get("is_umbrella"):
            return umbrella_coverage(doc, items, fres)
        return compare_to_doc(doc, found_from_candidate(_pick(items, doc, self.key, page_url=url)), fres,
                              bogota_today(now_utc))


def umbrella_coverage(doc: Mapping[str, Any], items: Sequence[Candidate], fres: Mapping[str, Any]) -> Recheck:
    """An umbrella (e.g. Fiestas 2 oct – 15 nov) rechecked on an agenda page whose rows ARE its
    sub-events: success when the page still has a row on the umbrella's first AND last day (never
    by matching one single-day row against the whole span). Otherwise date_changed with the span
    the page now states; no dated rows at all is not_found. A wider page span is reported in
    `detail`, not treated as a change."""
    status = int(fres.get("status") or 0)
    final = fres.get("final_url")
    rows = [c for c in items if c.get("start_date")]
    if not rows:
        return make_recheck("not_found", http_status=status, final_url=final, detail="agenda_rows_absent")
    lo = min(str(c["start_date"]) for c in rows)
    hi = max(str(c.get("end_date") or c["start_date"]) for c in rows)
    span = {"start_date": lo, "end_date": hi, "start_time": None}
    s = doc.get("start_date")
    e = doc.get("end_date") or s
    if not s:  # date_tbc umbrella: dated rows now exist → an announced span
        return make_recheck("date_changed", http_status=status, final_url=final, parsed=span, marker="date_announced",
                            found_date_text=rows[0]["evidence"][0]["date_text"])

    def covering(day: str) -> Optional[Candidate]:
        return next((c for c in rows if str(c["start_date"]) <= day <= str(c.get("end_date") or c["start_date"])), None)

    first, last = covering(str(s)), covering(str(e))
    if first is not None and last is not None:
        wider = (lo, hi) != (s, e)
        return make_recheck("success", http_status=status, final_url=final,
                            found_date_text=f"{first['evidence'][0]['date_text']} … {last['evidence'][0]['date_text']}",
                            parsed={"start_date": s, "end_date": e, "start_time": None},
                            detail=f"umbrella_span_covered;page_span={lo}..{hi}" if wider else "umbrella_span_covered")
    return make_recheck("date_changed", http_status=status, final_url=final, parsed=span, marker="umbrella_span_changed",
                        found_date_text=f"{rows[0]['evidence'][0]['date_text']} … {rows[-1]['evidence'][0]['date_text']}")


class IpccAdapter(_AgendaAdapter):
    key = "ipcc"
    denylist = (r"leave\s+a\s+comment", r"cancelar\s+respuesta")
    FEEDS =("https://ipcc.gov.co/feed/",
             "https://ipcc.gov.co/wp-json/wp/v2/posts?search=programaci%C3%B3n&per_page=10&_fields=id,date_gmt,modified_gmt,link,title,content")


class ElUniversalAdapter(_AgendaAdapter):
    key = "eluniversal"
    denylist = (r"lo\s+m[aá]s\s+visto.*$",)
    FEEDS = tuple(f"https://www.eluniversal.com.co/arc/outboundfeeds/rss/category/{c}/?outputType=xml"
                  for c in ("farandula", "cartagena", "cultural"))


# ════════════════════════════════════════════════════════════════════════════════════════════
# Tier 2 — La Tiquetera (latiquetera.com). tz_policy: honour -05:00, other offsets → country FAIL.
# ════════════════════════════════════════════════════════════════════════════════════════════
LT_BASE = "https://latiquetera.com"


def parse_latiquetera_boxes(html: str) -> list[dict[str, Any]]:
    """Catalogue boxes (home / search). Kept: Cartagena city tag or 'Cartagena' in the title, and
    only latiquetera.com event pages (external Ticketmaster boxes are skipped)."""
    out: list[dict[str, Any]] = []
    parts = (html or "").split('<div class="item-box item-box-event')
    for p in parts[1:]:
        box_id = _first(r'id="BoxEvent(\d+)"', p)
        title = _first_text(r'item-box-content-title[^>]*>(.*?)</h3>', p) or ""
        sub = _first_text(r'item-box-content-subtitle[^>]*>(.*?)</', p) or ""
        city = _first_text(r'item-box-tags"><span>(.*?)</span>', p) or ""
        href = _first(r'<a[^>]*class="cover"[^>]*href="([^"]*)"', p) or _first(r'<a[^>]*href="([^"]*)"[^>]*class="cover"', p)
        if not href:
            continue
        url = urljoin(LT_BASE + "/", href)
        if "cartagena" not in fold(city) and "cartagena" not in fold(title):
            continue
        out.append({"box_id": box_id, "title": title, "subtitle": sub, "city": city, "url": url,
                    "external": politeness_key(url) != "latiquetera.com"})
    return out


def _lt_block(html: str, cls: str) -> Optional[str]:
    return _first_text(rf'<div class="{cls}">(.*?)</div>', html)


def parse_latiquetera_event(html: str, meta: PageMeta) -> tuple[Optional[Candidate], Optional[str]]:
    src = SOURCES_BY_KEY["latiquetera"]
    final = str(meta.get("final_url") or meta.get("url") or "")
    body_cls = _first(r'<body[^>]*class="([^"]*)"', html) or ""
    canceled = ("event-view-canceled" in body_cls or '<div class="canceled-message">' in (html or "")
                or "/events/view_canceled/" in final)
    ev = next(iter(ld_events(html)), None)
    title = clean_text((ev or {}).get("name")) or clean_text(_first(r'<meta property="og:title" content="([^"]*)"', html)) or ""
    functions = [html_to_text(t) for _, t in re.findall(
        r'<div class="event-start-purchase event-date-(\d+)">.*?<div class="event-date-date">(.*?)</div>', html or "", re.S)]
    tips = {k: _lt_block(html, f"event-tips-{k}") for k in ("place", "hour", "open")}
    tips["date"] = _lt_block(html, "event-tip-date")
    ld_raw = split_iso((ev or {}).get("startDate"))
    ld_offset = ld_raw["offset"] if ld_raw else None
    ld_ph = ld_placeholder_date(ld_raw, split_iso((ev or {}).get("endDate")), meta.get("fetched_at"))
    ld_start = None if ld_ph else ld_raw  # §15 R3 4c: a fetch-day JSON-LD date is no date at all
    loc = ld_location(ev) if ev else None
    event_text = " | ".join(x for x in (title, tips["place"], tips["date"], tips["hour"], tips["open"],
                                        ld_location_text(loc), *functions) if x)
    if canceled:
        return None, "canceled"
    vis_src = functions[0] if functions else (tips["date"] or "")
    ref = int(ld_start["date"][:4]) if ld_start else None
    vd = first_date(vis_src, ref, need_year=True) or (first_date(tips["date"] or "", ref, need_year=True) if functions else None)
    if not vd:
        return None, "no_visible_date"
    if not vd["weekday_ok"]:
        return None, "weekday_mismatch"
    if ld_start and ld_start["date"] != vd["start"]:
        return None, "ld_visible_date_conflict"
    vis_time = parse_clock(vis_src[vd["span"][1]:] if functions else "") or parse_clock(tips["hour"] or "")
    ld_time = ld_start["time"] if ld_start else None
    start_time, confirmed = None, False
    if vis_time and (ld_time is None or ld_time == vis_time):
        start_time, confirmed = vis_time, True
    elif ld_time and not vis_time and ld_time not in PLACEHOLDER_TIMES and ld_offset == "-05:00":
        start_time = ld_time  # §15 S1: only an explicit Bogotá offset is honoured (unconfirmed)
    lng_lat = re.search(r"!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)", html or "")
    slug = _slug_token(str(meta.get("url") or "")) or slugify(title)
    sold = any(find_sold_out(f, _deny(src)) for f in functions)
    cand = make_candidate(
        src, meta, native_id=slug, title=title, start_date=vd["start"], end_date=vd["end"], start_time=start_time,
        time_confirmed=confirmed, date_text=vd["text"], date_visible=True, event_text=event_text,
        page_text=page_text_of(html), venue_name=(loc or {}).get("name") or tips["place"],
        address=(loc or {}).get("streetAddress"),
        lat=lng_lat.group(2) if lng_lat else None, lng=lng_lat.group(1) if lng_lat else None, ld_loc=loc,
        tz_offset=ld_offset,
        currency="COP" if re.search(r"\bCOP\b", html or "") else None,
        ticket_url=str(meta.get("url")) if functions else None, sold_out=sold,
        flags=["ld_placeholder_date"] if ld_ph else [], markers=event_markers(src, event_text))
    return cand, None


class LaTiqueteraAdapter(Adapter):
    key = "latiquetera"
    # Footer 'Cancelaciones y cambios', nav 'Eventos cancelados', T&C 'finalizada la compra' and the
    # 'Finalizado' PRICE-STAGE badges (Etapa) are never the event's status.
    denylist = (r"cancelaciones\s+y\s+cambios", r"eventos\s+cancelad[oa]s", r"finalizada\s+la\s+compra",
                r"\b(?:preventa|etapa|general|vip|platea|palco|preferencial)\s+finalizad[oa]\b")
    LISTS =(f"{LT_BASE}/", f"{LT_BASE}/events/search?city=cartagena")

    async def _pull(self, client: httpx.AsyncClient, sched: PoliteScheduler, res: PullResult, *, offset: int,
                    checkpoint: Optional[Checkpoint], now_utc: datetime) -> None:
        boxes: dict[str, dict[str, Any]] = {}
        for u in self.LISTS:
            f = await self._get(client, sched, u, res=res)
            if not self._discovery_ok(f, res):
                continue
            for b in parse_latiquetera_boxes(f["text"]):
                boxes.setdefault(b["url"], b)
        items = []
        for b in boxes.values():
            if b["external"]:
                if offset == 0:
                    res.skip(b["url"], "external_ticketer", b["title"])
                continue
            items.append(b)

        async def handle(b: Mapping[str, Any]) -> None:
            f = await self._get(client, sched, b["url"], res=res)
            if "/events/view_canceled/" in str(f.get("final_url")):
                res.skip(b["url"], "canceled", b["title"])
                return
            if f.get("blocked_reason") or f.get("status") != 200:
                res.skip(b["url"], f"fetch_{f.get('blocked_reason') or f.get('status')}", b["title"])
                return
            c, why = parse_latiquetera_event(f["text"], page_meta(f, b["url"]))
            if c:
                res.append(c)
            else:
                res.skip(b["url"], why or "unparsed", b["title"])

        await self._iterate(items, res, offset, checkpoint, handle, lambda b: b["url"])

    async def _recheck(self, client: httpx.AsyncClient, doc: Mapping[str, Any], *, sched: Optional[PoliteScheduler],
                       cache: Optional[dict[str, FetchResult]], now_utc: datetime) -> Recheck:
        url = str(doc.get("recheck_url") or doc.get("source_url") or "")
        fres = await self._get(client, sched, url, cache=cache)
        term = classify_fetch(fres, url)
        if term:
            return term
        c, why = parse_latiquetera_event(fres["text"], page_meta(fres, url))
        found = found_from_candidate(c)
        if why == "canceled":
            found = {"event_found": True, "cancel": "cancelado"}
        return compare_to_doc(doc, found, fres, bogota_today(now_utc))


# ════════════════════════════════════════════════════════════════════════════════════════════
# Tier 2 — TuBoleta (Drupal event pages) + its SecuTix checkout lists.
# tz_policy: JSON-LD suffix is local wall-clock and T07:00 is a placeholder; the time comes from
# data-date / visible text; if they disagree start_time is null.
# ════════════════════════════════════════════════════════════════════════════════════════════
TB_BASE = "https://tuboleta.com"
TB_CARTAGENA_CITY_ID = "22075"
SECUTIX_LISTS = ("https://special.checkout.tuboleta.com/list/events", "https://teatros.checkout.tuboleta.com/list/events")
# Site codes verified against each product page's JSON-LD address ('…, Cartagena, CO'). Exact
# match only: CARPA (Carpa Delirio) is NOT Cartagena, so never prefix-match 'CAR'.
SECUTIX_CTG_SITES = frozenset({"CARTADME", "CARSACLA", "CARCAPST", "CARTPA", "CCARTG", "CLOCK"})
TUBOLETA_PLACEHOLDER_TIMES = frozenset({"00:00", "01:00", "07:00"})


def parse_tuboleta_search(html: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for art in re.findall(r'<article class="p-3 h-100 bg-grey-light.*?</article>', html or "", re.S):
        href = _first(r'href="(/es/eventos/[^"]+)"', art)
        info = _first(r'<div class="content-info[^>]*>(.*?)</div>\s*<div class="dates-container', art)
        spans = [html_to_text(x) for x in re.findall(r"<span>\s*(.*?)\s*</span>", info or "", re.S)]
        if not href:
            continue
        out.append({"url": urljoin(TB_BASE, href), "title": spans[0] if spans else "",
                    "venue": spans[1] if len(spans) > 1 else "", "city": spans[2] if len(spans) > 2 else ""})
    return out


def parse_tuboleta_event(html: str, meta: PageMeta) -> tuple[list[Candidate], list[str]]:
    """One candidate per Cartagena performance block (data-id-venue is the CITY id, 22075)."""
    src = SOURCES_BY_KEY["tuboleta"]
    if "error 403" in fold(page_title(html)):
        return [], ["drupal_403"]
    title = _first_text(r"<h1[^>]*>(.*?)</h1>", html) or ""
    blocks = list(re.finditer(
        r'<div\s+class="desk paragraph-performance-design[^"]*"\s+data-id-venue="(\d+)"\s+data-date="([^"]+)"\s*>(.*?)(?=<div\s+class="mob paragraph-performance-design|<div\s+class="desk paragraph-performance-design|$)',
        html or "", re.S))
    if not blocks:
        return [], ["no_performance_blocks"]
    ev = next(iter(ld_events(html)), None)
    ld_start = split_iso((ev or {}).get("startDate"))  # offset only: dates/times come from data-date + visible text
    ld_ph = ld_placeholder_date(ld_start, split_iso((ev or {}).get("endDate")), meta.get("fetched_at"))
    price_text = html_to_text(_first(r"(Localidad y precios.*?)(?:Responsable:|$)", html) or "")
    # 'PRECIO BOLETA $25.000 + $2.500 $27.500': the base price is the amount before '+ $service'.
    base_prices = sorted({a for a in (cop_amounts(f"${x}")[0] if cop_amounts(f"${x}") else 0
                                      for x in re.findall(r"\$\s?([\d.]+)\s*\+\s*\$", price_text)) if a})
    ctg = [b for b in blocks if b.group(1) == TB_CARTAGENA_CITY_ID]
    if not ctg:
        return [], ["not_cartagena_city"]
    slug = _slug_token(str(meta.get("url") or "")) or slugify(title)
    page_text = page_text_of(html)
    out: list[Candidate] = []
    skips: list[str] = []
    for b in ctg:
        dd = re.search(r"(\d{2})/(\d{2})/(\d{4})\s*-\s*(\d{1,2}):(\d{2})", b.group(2))
        if not dd:
            skips.append("bad_data_date")
            continue
        start = ymd(dd.group(3), dd.group(2), dd.group(1))
        attr_time = f"{int(dd.group(4)):02d}:{dd.group(5)}"
        block = b.group(3)
        show = html_to_text(_first(r'<div class="d-flex show-date">(.*?)</div>\s*<div class="d-flex">', block) or block[:1500])
        vd = first_date(show, int(start[:4]) if start else None)
        if not start or (vd and vd["start"] != start):
            skips.append("visible_date_disagrees")
            continue
        vis_time = parse_clock(show)
        start_time = attr_time if vis_time == attr_time else None
        if start_time in TUBOLETA_PLACEHOLDER_TIMES and vis_time != start_time:
            start_time = None
        loc = re.search(r'<div class="location[^"]*">\s*<div[^>]*id="(\d+)">(.*?)</div>\s*<div[^>]*>(.*?)</div>', block, re.S)
        city, venue = (html_to_text(loc.group(2)), html_to_text(loc.group(3))) if loc else ("", "")
        buy = _first(r'<a href=([^\s>]+)\s+class="[^"]*main-button', block)
        pid = _first(r"productId=(\d+)", _html.unescape(buy or ""))
        btn = _first_text(r'class="[^"]*main-button[^"]*"[^>]*>(.*?)</a>', block) or ""
        event_text = " | ".join(x for x in (title, show, city, venue, btn) if x)
        native = slug if len(ctg) == 1 else f"{slug}:{start.replace('-', '')}"
        out.append(make_candidate(
            src, meta, native_id=native, title=title, start_date=start, start_time=start_time,
            time_confirmed=start_time is not None, date_text=show, date_visible=vd is not None, event_text=event_text,
            page_text=page_text, venue_name=venue or None, tz_offset=(ld_start or {}).get("offset"),
            currency="COP" if base_prices else None, ticket_url=_html.unescape(buy) if buy else None,
            price=make_price(event_text, base_prices, f"Desde ${min(base_prices):,} + servicio".replace(",", ".") if base_prices else None),
            sold_out=find_sold_out(btn, _deny(src)), extra_source_keys=[f"secutix:{pid}"] if pid else (),
            flags=([] if start_time else ["time_unconfirmed"]) + (["ld_placeholder_date"] if ld_ph else []),
            markers=event_markers(src, event_text)))
    return out, skips


def parse_secutix_list(html: str, meta: PageMeta) -> tuple[list[Candidate], list[dict[str, str]], int]:
    """SecuTix /list/events: one <section id='prod_<id>'> per product. Only allow-listed Cartagena
    site codes. Visible 'sábado 9 enero 2027' + '19:00' (the JSON-LD 'Z' on product pages is false)."""
    src = SOURCES_BY_KEY["tuboleta"]
    host = urlsplit(str(meta.get("url") or "")).hostname or "special.checkout.tuboleta.com"
    secs = re.findall(r'<section id="prod_(\d+)" class="([^"]*)"[^>]*>(.*?)</section>', html or "", re.S)
    out: list[Candidate] = []
    skips: list[dict[str, str]] = []
    page_text = page_text_of(html)
    for pid, cls, body in secs:
        site = _first(r"product_site_(\S+)", cls)
        if site not in SECUTIX_CTG_SITES:
            continue
        title = _first_text(r'accessibility-visually-hidden">(.*?)</h4>', body) or _first_text(r'class="title[^"]*">(.*?)</a>', body) or ""
        venue = _first_text(r'<span class="site">(.*?)</span>', body)
        url = f"https://{host}/selection/event/date?productId={pid}"
        day = _first_text(r'<span class="day">(.*?)</span>', body)
        tm = _first_text(r'<span class="time">(.*?)</span>', body)
        date_line = _first_text(r'<p class="semantic-no-styling-no-display date">(.*?)</p>', body) or ""
        if day:
            vd = first_date(day, need_year=True)
            if not vd or not vd["weekday_ok"]:
                skips.append({"url": url, "title": title, "reason": "bad_visible_date"})
                continue
            start, end, st = vd["start"], vd["start"], parse_clock(tm or "")
        else:
            rng = re.search(r"desde\s+(?:el\s+)?(.*?)\s+hasta\s+(?:el\s+)?(.*)$", date_line, re.I)
            a = first_date(rng.group(1), need_year=True) if rng else None
            z = first_date(rng.group(2), need_year=True) if rng else None
            if not a or not z:
                skips.append({"url": url, "title": title, "reason": "no_visible_date"})
                continue
            start, end, st = a["start"], z["start"], None
        sold = bool(re.search(r'class="[^"]*buy_unavailable[^"]*"[^>]*>\s*(?:Agotado|Sold out)', body, re.I))
        event_text = " | ".join(x for x in (title, venue or "", date_line) if x)
        out.append(make_candidate(
            src, meta, native_id=pid, title=title, start_date=start, end_date=end, start_time=st,
            time_confirmed=st is not None, date_text=date_line, date_visible=True, event_text=event_text,
            page_text=page_text, venue_name=venue, ticket_url=url, detail_url=url, recheck_url=str(meta.get("url")),
            sold_out=sold, extra_source_keys=[f"secutix:{pid}"], flags=[f"secutix_site_{site}"],
            markers=event_markers(src, event_text)))
    return out, skips, len(secs)


def parse_secutix_product(html: str, meta: PageMeta) -> Optional[Candidate]:
    """SecuTix product page. JSON-LD startDate '2027-01-09T19:00:00Z' is Bogotá WALL-CLOCK (false
    'Z'): the 'Z' is stripped, never converted. <title> '[Venue | 09.01.2027 - 19:00 | Title]' is the
    visible confirmation. Multi-performance pages (no JSON-LD) return None."""
    src = SOURCES_BY_KEY["tuboleta"]
    ev = next(iter(ld_events(html)), None)
    if not ev:
        return None
    ld = split_iso(ev.get("startDate"))
    if not ld:
        return None
    ld_ph = ld_placeholder_date(ld, split_iso(ev.get("endDate")), meta.get("fetched_at"))
    t = page_title(html)
    tv = re.search(r"\[(.*?)\|\s*(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{1,2}:\d{2})\s*\|(.*?)\]", t)
    vis_date = first_date(tv.group(2)) if tv else None
    vis_time = parse_clock(tv.group(3)) if tv else None
    if ld_ph:  # §15 R3 4c: the JSON-LD date is a placeholder; only the visible <title> date counts
        if not vis_date:
            return None
        start, st = str(vis_date["start"]), vis_time
    else:
        if vis_date and vis_date["start"] != ld["date"]:
            return None
        start = str(ld["date"])
        st = ld["time"] if vis_time is not None and vis_time == ld["time"] else None
    loc = ld_location(ev)
    pid = _first(r"productId=(\d+)", str(meta.get("url") or "")) or slugify(clean_text(ev.get("name")))
    title = clean_text(ev.get("name"))
    offers: dict[str, Any] = ev["offers"] if isinstance(ev.get("offers"), dict) else {}
    amounts = [a for a in (_cop_decimal(offers.get("lowPrice")), _cop_decimal(offers.get("highPrice"))) if a]
    event_text = " | ".join(x for x in (title, t, ld_location_text(loc)) if x)
    flags = ["ld_placeholder_date"] if ld_ph else (["ld_false_z_as_local"] if ld.get("offset") == "Z" else [])
    return make_candidate(
        src, meta, native_id=pid, title=title, start_date=start, start_time=st, time_confirmed=st is not None,
        date_text=t, date_visible=bool(tv), event_text=event_text, page_text=page_text_of(html),
        venue_name=(loc or {}).get("name"), address=(loc or {}).get("streetAddress"), ld_loc=loc,
        tz_offset=None, currency="COP" if amounts else None, extra_source_keys=[f"secutix:{pid}"],
        price=make_price(event_text, amounts), flags=flags, markers=event_markers(src, event_text))


def _cop_decimal(v: Any) -> Optional[int]:
    m = re.search(r"(\d+(?:\.\d+)?)", str(v or ""))
    if not m:
        return None
    try:
        n = int(float(m.group(1)))
    except ValueError:
        return None
    return n if n >= 1000 else None


class TuBoletaAdapter(Adapter):
    key = "tuboleta"
    # SecuTix checkout chrome ('El pedido ha sido cancelado', 'Tu cesta ha expirado', the queue's
    # 'cuando la distribución haya terminado') and Drupal T&C are never the event's status.
    denylist = (r"el\s+pedido\s+ha\s+sido\s+cancelad[oa]", r"tu\s+cesta\s+ha\s+expirado[^.]*",
                r"la\s+distribuci[oó]n\s+haya\s+terminado", r"su\s+sesi[oó]n\s+(?:ha\s+)?expira\w*[^.]*")
    SEARCH =f"{TB_BASE}/es/resultados-de-busqueda?ciudades={TB_CARTAGENA_CITY_ID}"

    async def _pull(self, client: httpx.AsyncClient, sched: PoliteScheduler, res: PullResult, *, offset: int,
                    checkpoint: Optional[Checkpoint], now_utc: datetime) -> None:
        work: list[str] = list(SECUTIX_LISTS)
        f = await self._get(client, sched, self.SEARCH, res=res)
        if self._discovery_ok(f, res):
            for card in parse_tuboleta_search(f["text"]):
                if fold(card["city"]) == "cartagena" and card["url"] not in work:
                    work.append(card["url"])

        async def handle(u: str) -> None:
            g = await self._get(client, sched, u, res=res)
            if g.get("blocked_reason") or g.get("status") != 200:
                res.skip(u, f"fetch_{g.get('blocked_reason') or g.get('status')}")
                return
            if u in SECUTIX_LISTS:
                items, sk, n = parse_secutix_list(g["text"], page_meta(g, u))
                if n < 5:
                    res.skip(u, "secutix_list_abnormal")
                    return
                res.extend(items)
                for s in sk:
                    res.skip(s["url"], s["reason"], s["title"])
                return
            items2, why = parse_tuboleta_event(g["text"], page_meta(g, u))
            res.extend(items2)
            for w in why:
                res.skip(u, w)

        await self._iterate(work, res, offset, checkpoint, handle, lambda u: u)

    async def _recheck(self, client: httpx.AsyncClient, doc: Mapping[str, Any], *, sched: Optional[PoliteScheduler],
                       cache: Optional[dict[str, FetchResult]], now_utc: datetime) -> Recheck:
        url = str(doc.get("recheck_url") or doc.get("source_url") or "")
        today = bogota_today(now_utc)
        fres = await self._get(client, sched, url, cache=cache)
        status = int(fres.get("status") or 0)
        # TuBoleta answers an unpublished slug with its own Drupal 403 page (not a bot wall): gone.
        if status == 403 and not fres.get("challenged") and "error 403" in fold(page_title(fres.get("text") or "")):
            return make_recheck("gone", http_status=403, marker="drupal_403", final_url=fres.get("final_url"))
        term = classify_fetch(fres, url)
        if term:
            return term
        meta = page_meta(fres, url)
        if url.rstrip("/").endswith("/list/events"):
            items, _, n = parse_secutix_list(fres["text"], meta)
            if n < 5:
                return make_recheck("blocked", http_status=status, marker="secutix_list_abnormal", final_url=fres.get("final_url"))
            c = _pick(items, doc, self.key)
            if c is None:  # the list loaded normally and the product is gone from it
                return make_recheck("gone", http_status=status, marker="missing_from_list", final_url=fres.get("final_url"))
            return compare_to_doc(doc, found_from_candidate(c), fres, today)
        if "/selection/event/" in url:
            return compare_to_doc(doc, found_from_candidate(parse_secutix_product(fres["text"], meta)), fres, today)
        items, _ = parse_tuboleta_event(fres["text"], meta)
        c = next((x for x in items if x["start_date"] == doc.get("start_date")), None) or _pick(items, doc, self.key)
        if c is None and len(items) == 1:
            c = items[0]
        return compare_to_doc(doc, found_from_candidate(c), fres, today)


# ════════════════════════════════════════════════════════════════════════════════════════════
# Tier 2 — Ticketshop (public Laravel JSON API). Cartagena = id_ciudad 176 (dept 6, Bolívar);
# NOT 366 (Cartagena del Chairá). Promoter PII (cliente.*) is never read into a Candidate.
# ════════════════════════════════════════════════════════════════════════════════════════════
TS_API = "https://api.ticketshop.com.co/api"
TS_CARTAGENA_CITY_ID = "176"


def parse_ticketshop_list(body: str) -> tuple[list[dict[str, Any]], int]:
    try:
        d = json.loads(body or "{}")
    except ValueError:
        return [], 0
    page = (d.get("data") or {}) if isinstance(d, dict) else {}
    rows = page.get("data") if isinstance(page, dict) else None
    if not isinstance(rows, list):
        return [], 0
    return [r for r in rows if isinstance(r, dict)], int(page.get("last_page") or 1)


def parse_ticketshop_event(body: str, meta: PageMeta) -> tuple[Optional[Candidate], Optional[str]]:
    src = SOURCES_BY_KEY["ticketshop"]
    try:
        d = json.loads(body or "{}")
    except ValueError:
        return None, "bad_json"
    ev = d.get("data") if isinstance(d, dict) else None
    if not isinstance(ev, dict):
        return None, "no_event"
    aud: dict[str, Any] = ev["auditorio"] if isinstance(ev.get("auditorio"), dict) else {}
    if str(aud.get("id_ciudad")) != TS_CARTAGENA_CITY_ID:
        return None, f"not_cartagena_city:{aud.get('id_ciudad')}"
    if str(ev.get("status")) != "1" or str(ev.get("publicar")) != "1":
        return None, "not_active"
    ds = split_iso(str(ev.get("fecha_evento") or "").replace(" ", "T"))
    if not ds:
        return None, "no_date"
    hora = _first(r"^(\d{1,2}:\d{2})", str(ev.get("hora_inicio") or ""))
    st = f"{int(hora.split(':')[0]):02d}:{hora.split(':')[1]}" if hora else None
    if st in PLACEHOLDER_TIMES:
        st = None
    slug = clean_text(ev.get("slug"))
    title = clean_text(ev.get("nombre"))
    currency = next((clean_text(m.get("codigo_moneda")) for m in ev.get("monedas_evento") or [] if isinstance(m, dict)), None)
    event_text = " | ".join(x for x in (title, clean_text(aud.get("nombre")), clean_text(aud.get("direccion"))) if x)
    public = f"https://ticketshop.com.co/eventos/{slug}"
    safe = {k: ev.get(k) for k in ("nombre", "fecha_evento", "hora_inicio", "codigo_pulep")}
    safe["auditorio"] = {k: aud.get(k) for k in ("nombre", "direccion", "id_ciudad", "id_departamento")}
    return make_candidate(
        src, meta, native_id=slug, title=title, start_date=ds["date"], start_time=st, time_confirmed=False,
        date_text=f"fecha_evento {ev.get('fecha_evento')} · hora_inicio {ev.get('hora_inicio')}", date_visible=False,
        event_text=event_text, page_text=json.dumps(safe, ensure_ascii=False), venue_name=aud.get("nombre"),
        address=aud.get("direccion"), lat=aud.get("latitud"), lng=aud.get("longitud"), currency=currency,
        ticket_url=public, detail_url=public, recheck_url=f"{TS_API}/evento/{slug}",
        price={"is_free": None, "min_cop": None, "max_cop": None, "text": None},
        flags=["api_only_time_unconfirmed"]), None


class TicketshopAdapter(Adapter):
    key = "ticketshop"
    denylist = (r"en\s+caso\s+de\s+cancelaci[oó]n\s+o\s+aplazamiento[^.•]*",)

    async def _pull(self, client: httpx.AsyncClient, sched: PoliteScheduler, res: PullResult, *, offset: int,
                    checkpoint: Optional[Checkpoint], now_utc: datetime) -> None:
        events: list[dict[str, Any]] = []
        page, last = 1, 1
        while page <= min(last, 5):
            f = await self._get(client, sched, f"{TS_API}/eventos_estado/1?page={page}", res=res)
            if not self._discovery_ok(f, res):
                return
            rows, last = parse_ticketshop_list(f["text"])
            events.extend(rows)
            page += 1

        async def handle(ev: Mapping[str, Any]) -> None:
            slug = clean_text(ev.get("slug"))
            api = f"{TS_API}/evento/{slug}"
            g = await self._get(client, sched, api, res=res)
            if g.get("blocked_reason") or g.get("status") != 200:
                res.skip(api, f"fetch_{g.get('blocked_reason') or g.get('status')}", ev.get("nombre"))
                return
            c, why = parse_ticketshop_event(g["text"], page_meta(g, api))
            if c:
                res.append(c)
            else:
                res.skip(api, why or "unparsed", ev.get("nombre"))

        await self._iterate(events, res, offset, checkpoint, handle, lambda e: f"{TS_API}/evento/{e.get('slug')}")

    async def _recheck(self, client: httpx.AsyncClient, doc: Mapping[str, Any], *, sched: Optional[PoliteScheduler],
                       cache: Optional[dict[str, FetchResult]], now_utc: datetime) -> Recheck:
        url = str(doc.get("recheck_url") or "")
        if not url.startswith(TS_API):
            slug = (_native_ids(doc, self.key) or [_slug_token(str(doc.get("source_url") or "")) or ""])[0]
            url = f"{TS_API}/evento/{slug}"
        fres = await self._get(client, sched, url, cache=cache)
        term = classify_fetch(fres, url)
        if term:
            return term
        c, why = parse_ticketshop_event(fres["text"], page_meta(fres, url))
        if c is None and why in ("not_active", "no_event"):
            return make_recheck("gone", http_status=int(fres.get("status") or 0), marker=why, final_url=fres.get("final_url"))
        found = found_from_candidate(c)
        if c is not None:
            found["parsed"]["start_time"] = c.get("start_time")
        return compare_to_doc(doc, found, fres, bogota_today(now_utc))


# ════════════════════════════════════════════════════════════════════════════════════════════
# Tier 2 — Fever Colombia: /en/cartagena-colombia/ ONLY (the bare /cartagena/ is Cartagena, Spain).
# ════════════════════════════════════════════════════════════════════════════════════════════
FEVER_CITY = "https://feverup.com/en/cartagena-colombia/"


def fever_state(html: str) -> dict[str, Any]:
    raw = _first(r'<script id="serverapp-state" type="application/json">(.*?)</script>', html)
    try:
        d = json.loads(raw) if raw else {}
    except ValueError:
        return {}
    return d if isinstance(d, dict) else {}


def parse_fever_city(html: str) -> tuple[Optional[dict[str, Any]], list[dict[str, Any]]]:
    st = fever_state(html)
    city = next((v for k, v in st.items() if k.startswith("CityService.bySlugAndLanguage.") and isinstance(v, dict)), None)
    feed = next((v for k, v in st.items() if k.startswith("city-feed-hydrated:") and isinstance(v, dict)), {})
    plans: dict[int, dict[str, Any]] = {}
    for sec in ((feed.get("b") or {}).get("sections") or []):
        for d in (sec.get("data") or []) if isinstance(sec, dict) else []:
            for p in (d.get("carousel_main_plans") or []) if isinstance(d, dict) else []:
                if isinstance(p, dict) and p.get("plan_id") is not None:
                    plans.setdefault(int(p["plan_id"]), p)
    return city, list(plans.values())


def fever_plan_is_event(plan: Mapping[str, Any], today: date) -> tuple[bool, str]:
    """Dated events only: not timeless, not expired, sessions spanning <= 3 days (Fever CTG lists
    tours/experiences with months-long session windows — those are not events)."""
    if (plan.get("extra") or {}).get("timeless"):
        return False, "timeless"
    a = split_iso(plan.get("first_active_session_date"))
    z = split_iso(plan.get("last_active_session_date"))
    if not a or not z:
        return False, "no_sessions"
    first_d, last_d = _date_of(a["date"]), _date_of(z["date"])
    if first_d is None or last_d is None:
        return False, "no_sessions"
    if last_d < today:
        return False, "expired"
    if (last_d - first_d).days > 3:
        return False, "long_session_window"
    if (plan.get("location") or {}).get("is_hidden"):
        return False, "hidden_location"
    return True, "ok"


def parse_fever_plan(html: str, meta: PageMeta) -> tuple[Optional[Candidate], Optional[str]]:
    """Plan detail (PlanService.getPlanDetail.<id>). An explicit -05:00 is honoured; any other
    offset is passed on as tz_offset so the country gate FAILS it (§15 S1)."""
    src = SOURCES_BY_KEY["fever_co"]
    st = fever_state(html)
    plan = next((v for k, v in st.items() if k.startswith("PlanService.getPlanDetail.") and isinstance(v, dict)), None)
    if not plan or not clean_text(plan.get("name")) or page_title(html).startswith("-"):
        return None, "empty_plan"
    first = split_iso(plan.get("firstSessionDate") or plan.get("firstActiveSessionDate"))
    last = split_iso(plan.get("lastSessionDate") or plan.get("lastActiveSessionDate"))
    if not first:
        return None, "no_sessions"
    # §15 S1: honour an explicit -05:00. A UTC 'Z' would pass the gate's offset rule but shift the
    # wall-clock (and possibly the day), so it is dropped here; any other offset (+01/+02 Spain,
    # -03 Chile) is passed on as tz_offset so the country gate FAILS and logs it.
    if first["offset"] == "Z" or (last and last["offset"] == "Z"):
        return None, "tz_offset_not_bogota"
    place: dict[str, Any] = next(iter(plan.get("places") or []), {}) or {}
    st_time = first["time"] if first["time"] not in PLACEHOLDER_TIMES else None
    title = clean_text(plan.get("name"))
    cur = clean_text((plan.get("priceInfo") or {}).get("currency")) or None
    amount = (plan.get("priceInfo") or {}).get("amount")
    event_text = " | ".join(x for x in (title, clean_text(place.get("name")), clean_text(place.get("address")),
                                        f"{plan.get('cityCode')}, {plan.get('cityCountryIsoCode')}") if x)
    pid = str(plan.get("id") or "")
    return make_candidate(
        src, meta, native_id=pid, title=title, start_date=first["date"], end_date=last["date"] if last else None,
        start_time=st_time, time_confirmed=False,
        date_text=f"firstSessionDate {plan.get('firstSessionDate')}", date_visible=False, event_text=event_text,
        page_text=page_text_of(html, extra=f"cityCountryIsoCode={plan.get('cityCountryIsoCode')} cityCode={plan.get('cityCode')} currency={cur}"),
        venue_name=place.get("name"), address=place.get("address"), lat=place.get("latitude"), lng=place.get("longitude"),
        tz_offset=first["offset"], currency=cur, country_iso=clean_text(plan.get("cityCountryIsoCode")) or None,
        ticket_url=f"https://feverup.com/m/{pid}",
        price={"is_free": None, "min_cop": int(amount) if cur == "COP" and isinstance(amount, (int, float)) and amount >= 1000 else None,
               "max_cop": None, "text": None},
        flags=["timeless"] if plan.get("isTimeless") else []), None


class FeverCoAdapter(Adapter):
    key = "fever_co"
    denylist = (r"free\s+cancell?ation[^.]*", r"cancell?ation\s+polic(?:y|ies)[^.]*")

    async def _pull(self, client: httpx.AsyncClient, sched: PoliteScheduler, res: PullResult, *, offset: int,
                    checkpoint: Optional[Checkpoint], now_utc: datetime) -> None:
        f = await self._get(client, sched, FEVER_CITY, res=res)
        if not self._discovery_ok(f, res):
            return
        city, plans = parse_fever_city(f["text"])
        if not city or city.get("country") != "CO" or city.get("code") != "CTG" or city.get("currency") != "COP":
            res.errors.append("fever_city_not_cartagena_co")
            return
        today = bogota_today(now_utc)
        keep = []
        for p in plans:
            ok, why = fever_plan_is_event(p, today)
            if ok:
                keep.append(p)
            elif offset == 0:
                res.skip(f"https://feverup.com/m/{p.get('plan_id')}/en", why, clean_text(p.get("name")))

        async def handle(p: Mapping[str, Any]) -> None:
            u = f"https://feverup.com/m/{p.get('plan_id')}/en"
            g = await self._get(client, sched, u, res=res)
            if g.get("blocked_reason") or g.get("status") != 200:
                res.skip(u, f"fetch_{g.get('blocked_reason') or g.get('status')}", clean_text(p.get("name")))
                return
            c, why = parse_fever_plan(g["text"], page_meta(g, u))
            if c:
                res.append(c)
            else:
                res.skip(u, why or "unparsed", clean_text(p.get("name")))

        await self._iterate(keep, res, offset, checkpoint, handle, lambda p: f"https://feverup.com/m/{p.get('plan_id')}/en")

    async def _recheck(self, client: httpx.AsyncClient, doc: Mapping[str, Any], *, sched: Optional[PoliteScheduler],
                       cache: Optional[dict[str, FetchResult]], now_utc: datetime) -> Recheck:
        url = str(doc.get("recheck_url") or doc.get("source_url") or "")
        fres = await self._get(client, sched, url, cache=cache)
        term = classify_fetch(fres, url)
        if term:
            return term
        c, why = parse_fever_plan(fres["text"], page_meta(fres, url))
        if c is None and why == "empty_plan":
            return make_recheck("gone", http_status=int(fres.get("status") or 0), marker="empty_plan", final_url=fres.get("final_url"))
        found = found_from_candidate(c)
        if c is not None:
            found["parsed"]["start_time"] = c.get("start_time")
        return compare_to_doc(doc, found, fres, bogota_today(now_utc))


# ════════════════════════════════════════════════════════════════════════════════════════════
# Tier 3 — Centro de Convenciones (cccartagena.com, EventON 2.6.15).
# tz_policy: microdata meta[itemprop=startDate] ONLY. The ICS export is banned (it echoes the URL's
# sunix with a false 'Z'); the JSON-LD dates are malformed. 00:00/01:00/01:30 are placeholders.
# Always fetched with a cache-busting query (Cloudflare caches 31 days).
# ════════════════════════════════════════════════════════════════════════════════════════════
CCC_SITEMAP = "https://cccartagena.com/ajde_events-sitemap.xml"
CCC_PLACEHOLDER_TIMES = frozenset({"00:00", "01:00", "01:30"})
CCC_LASTMOD_WINDOW_DAYS = 240


def parse_ccc_sitemap(xml: str) -> list[tuple[str, str]]:
    ent = re.findall(r"<loc><!\[CDATA\[([^\]]*)\]\]></loc>\s*<lastmod><!\[CDATA\[([^\]]*)\]\]></lastmod>", xml or "")
    if not ent:
        ent = re.findall(r"<loc>([^<]*)</loc>\s*<lastmod>([^<]*)</lastmod>", xml or "")
    return sorted(((u.strip(), l.strip()) for u, l in ent if "/events/" in u), key=lambda x: x[1], reverse=True)


def _ccc_bust(url: str, now_utc: Optional[datetime] = None) -> str:
    return f"{url}{'&' if '?' in url else '?'}amo={int((now_utc or utc_now()).timestamp())}"


def parse_ccc_event(html: str, meta: PageMeta) -> tuple[Optional[Candidate], Optional[str]]:
    src = SOURCES_BY_KEY["cccartagena"]
    metas = dict(re.findall(r"<meta itemprop=['\"](\w+)['\"] content=['\"]([^'\"]*)['\"]", html or ""))
    s = split_iso(metas.get("startDate"))
    e = split_iso(metas.get("endDate"))
    if not s:
        return None, "no_microdata_date"
    title = _first_text(r"<span itemprop=['\"]name['\"][^>]*>(.*?)</span>", html) or page_title(html).split(" - ")[0].strip()
    time_row = _first_text(r"evo_metarow_time.*?<p[^>]*>(.*?)</p>", html) or ""
    vis_start = _first_text(r"<span class='evo_start\s*'>.*?<em class='time'>(.*?)</em>", html) or ""
    # The human-visible date is EventON's box ('03' 'Oct') + the weekday in the Hora row
    # ('(Sábado) 1:00 a.m. …'); both must agree with the microdata or the row is dropped.
    box = re.search(r"<span class='evo_start\s*'>\s*<em class='date'>(\d{1,2})</em>\s*<em class='month'>([^<]+)</em>", html or "")
    sd = _date_of(s["date"])
    if box and (sd is None or int(box.group(1)) != sd.day or month_num(box.group(2)) != sd.month):
        return None, "visible_date_disagrees"
    wd = re.search(rf"\(({WEEKDAY_RE})\)", time_row, re.I)
    if wd and not weekday_ok(s["date"], weekday_num(wd.group(1))):
        return None, "weekday_mismatch"
    box_text = f"{box.group(1)} {clean_text(box.group(2))}" if box else ""
    all_day = "todo el dia" in fold(time_row)
    st = s["time"]
    placeholder = bool(all_day or st in CCC_PLACEHOLDER_TIMES or (e and e["time"] == st and e["date"] == s["date"]))
    vis_time = parse_clock(vis_start) or parse_clock(time_row)
    start_time = None if placeholder else st
    status = clean_text(metas.get("eventStatus"))
    cancel = None
    if status and status.lower() not in ("on-schedule", "eventscheduled", "https://schema.org/eventscheduled"):
        cancel = find_cancel_marker(status.replace("-", " "), _deny(src)) or ("postponed" if "postpon" in status.lower() else None)
    site = page_title(html).split(" - ", 1)[1].strip() if " - " in page_title(html) else "Centro de Convenciones Cartagena de Indias"
    event_text = " | ".join(x for x in (title, time_row, site) if x)
    eid = _first(r'data-event_id="(\d+)"', html) or slugify(title)
    flags = []
    if placeholder:
        flags.append("placeholder_time_dropped")
    if _PROFESSIONAL_RE.search(title):
        flags.append("professional")
    if status and not cancel and status.lower() != "on-schedule":
        flags.append(f"event_status_{slugify(status, 30)}")
    cand = make_candidate(
        src, meta, native_id=eid, title=title, start_date=s["date"], end_date=e["date"] if e and e["date"] >= s["date"] else None,
        start_time=start_time, end_time=None if placeholder or not e else e["time"],
        time_confirmed=bool(start_time and vis_time == start_time),
        date_text=" · ".join(x for x in (box_text, time_row) if x) or metas.get("startDate", ""),
        date_visible=bool(box), event_text=event_text, page_text=page_text_of(html), venue_name=site,
        category="civic" if "professional" in flags else guess_category(title), flags=flags,
        markers={"cancel": cancel})
    return cand, None


class CccAdapter(Adapter):
    key = "cccartagena"
    denylist = (r"cancelar\s+respuesta",)

    async def _pull(self, client: httpx.AsyncClient, sched: PoliteScheduler, res: PullResult, *, offset: int,
                    checkpoint: Optional[Checkpoint], now_utc: datetime) -> None:
        f = await self._get(client, sched, CCC_SITEMAP, res=res)
        if not self._discovery_ok(f, res):
            return
        cutoff = (bogota_today(now_utc) - timedelta(days=CCC_LASTMOD_WINDOW_DAYS)).isoformat()
        urls = [u for u, lm in parse_ccc_sitemap(f["text"]) if lm[:10] >= cutoff]

        async def handle(u: str) -> None:
            g = await self._get(client, sched, u, res=res, fetch_url=_ccc_bust(u, now_utc))
            if g.get("blocked_reason") or g.get("status") != 200:
                res.skip(u, f"fetch_{g.get('blocked_reason') or g.get('status')}")
                return
            c, why = parse_ccc_event(g["text"], page_meta(g, u))
            if c:
                res.append(c)
            else:
                res.skip(u, why or "unparsed")

        await self._iterate(urls, res, offset, checkpoint, handle, lambda u: u)

    async def _recheck(self, client: httpx.AsyncClient, doc: Mapping[str, Any], *, sched: Optional[PoliteScheduler],
                       cache: Optional[dict[str, FetchResult]], now_utc: datetime) -> Recheck:
        url = str(doc.get("recheck_url") or doc.get("source_url") or "")
        fres = await self._get(client, sched, url, cache=cache, fetch_url=_ccc_bust(url, now_utc))
        term = classify_fetch(fres, url)
        if term:
            return term
        c, _ = parse_ccc_event(fres["text"], page_meta(fres, url))
        return compare_to_doc(doc, found_from_candidate(c), fres, bogota_today(now_utc))


# ════════════════════════════════════════════════════════════════════════════════════════════
# Tier 6 — Cartagenaplay (aggregator; discovery only → review). The header 'FECHA: <today>' on
# every page is ignored; '12:00 am - 12:00 am' means time unknown.
# ════════════════════════════════════════════════════════════════════════════════════════════
CP_SITEMAP = "https://cartagenaplay.com/job_listing-sitemap.xml"
CP_LASTMOD_WINDOW_DAYS = 120
_CP_DATE_RE = re.compile(rf"(\d{{1,2}})\s+({MONTH_RE}),?\s+(\d{{4}})\s+(\d{{1,2}}:\d{{2}}\s*[ap]m)", re.I)


def parse_cartagenaplay_sitemap(xml: str) -> list[tuple[str, str]]:
    ent = re.findall(r"<loc>\s*(?:<!\[CDATA\[)?([^<\]]*)(?:\]\]>)?\s*</loc>\s*<lastmod>\s*(?:<!\[CDATA\[)?([^<\]]*)", xml or "")
    return sorted(((u.strip(), l.strip()) for u, l in ent if "/event/" in u), key=lambda x: x[1], reverse=True)


def parse_cartagenaplay_event(html: str, meta: PageMeta) -> tuple[list[Candidate], list[str]]:
    src = SOURCES_BY_KEY["cartagenaplay"]
    title = _first_text(r'<h1 class="case27-primary-text"[^>]*>(.*?)</h1>', html) or page_title(html).replace(" - Cartagenaplay", "")
    ul = _first(r'<ul class="event-dates-timeline[^"]*"[^>]*>(.*?)</ul>', html)
    if not ul:
        return [], ["no_timeline"]
    venue = _first_text(r'<span class="host-name">(.*?)</span>', html)
    opts = _first(r'class="c27-map map" data-options="([^"]*)"', html)
    lat = lng = address = None
    if opts:
        try:
            loc0 = (json.loads(_html.unescape(opts)).get("locations") or [{}])[0]
            lat, lng, address = loc0.get("marker_lat"), loc0.get("marker_lng"), loc0.get("address")
        except (ValueError, AttributeError, IndexError):
            pass
    prices = [cop_amounts(p)[0] for p in re.findall(r'data-ticket-price-formatted="([^"]*)"', html or "") if cop_amounts(p)]
    no_tickets = "No hay entradas disponibles" in (html or "")
    slug = _slug_token(str(meta.get("url") or "")) or slugify(title)
    out: list[Candidate] = []
    skips: list[str] = []
    for li_cls, li in re.findall(r'<li class="([^"]*)">(.*?)</li>', ul, re.S):
        span = _first_text(r"<span>(.*?)</span>", li) or ""
        status = " ".join(html_to_text(x) for x in re.findall(r'<i class="fa fa-check"></i>(.*?)</a>', li, re.S))
        if "event-ended" in li_cls or find_finished(status, _deny(src)):
            skips.append("ended")
            continue
        dates = list(_CP_DATE_RE.finditer(span))
        if not dates:
            skips.append("no_date")
            continue
        a = dates[0]
        start = ymd(a.group(3), month_num(a.group(2)), a.group(1))
        st = parse_clock(a.group(4))
        end = start
        et = None
        if len(dates) > 1:
            z = dates[1]
            end = ymd(z.group(3), month_num(z.group(2)), z.group(1))
            et = parse_clock(z.group(4))
        else:
            et = parse_clock(span[a.end():])
        if not start or not end or end < start:
            skips.append("bad_date")
            continue
        sd, ed = _date_of(start), _date_of(end)
        if sd and ed and (ed - sd).days == 1 and et and et <= "06:00":
            end = start  # overnight party, not a two-day event
        gcal = re.search(r"dates=(\d{8})T(\d{4})\d{2}/", _html.unescape(li))
        if st == "00:00" and (et in (None, "00:00")):
            st = et = None
        elif gcal and (f"{gcal.group(1)[:4]}-{gcal.group(1)[4:6]}-{gcal.group(1)[6:]}" != start or f"{gcal.group(2)[:2]}:{gcal.group(2)[2:]}" != st):
            st = et = None
        if et is not None and et == st and end == start:
            et = None  # '7:00 pm - 7:00 pm' is the theme's default, not an end time
        event_text = " | ".join(x for x in (title, span, venue or "", address or "", status) if x)
        out.append(make_candidate(
            src, meta, native_id=slug if not out else f"{slug}:{start.replace('-', '')}",
            title=title, start_date=start, end_date=end, start_time=st, end_time=et, time_confirmed=st is not None,
            date_text=span, date_visible=True, event_text=event_text, page_text=page_text_of(html),
            venue_name=venue, address=address, lat=lat, lng=lng,
            price=make_price(event_text, prices), ticket_url=None if no_tickets else str(meta.get("url")),
            flags=["aggregator"], markers=event_markers(src, event_text)))
    return out, skips


class CartagenaplayAdapter(Adapter):
    key = "cartagenaplay"
    denylist = (r"cancelar\s+respuesta", r"leave\s+a\s+comment")

    async def _pull(self, client: httpx.AsyncClient, sched: PoliteScheduler, res: PullResult, *, offset: int,
                    checkpoint: Optional[Checkpoint], now_utc: datetime) -> None:
        f = await self._get(client, sched, CP_SITEMAP, res=res)
        if not self._discovery_ok(f, res):
            return
        cutoff = (bogota_today(now_utc) - timedelta(days=CP_LASTMOD_WINDOW_DAYS)).isoformat()
        urls = [u for u, lm in parse_cartagenaplay_sitemap(f["text"]) if lm[:10] >= cutoff]

        async def handle(u: str) -> None:
            g = await self._get(client, sched, u, res=res)
            if g.get("blocked_reason") or g.get("status") != 200:
                res.skip(u, f"fetch_{g.get('blocked_reason') or g.get('status')}")
                return
            items, why = parse_cartagenaplay_event(g["text"], page_meta(g, u))
            res.extend(items)
            for w in why:
                res.skip(u, w)

        await self._iterate(urls, res, offset, checkpoint, handle, lambda u: u)

    async def _recheck(self, client: httpx.AsyncClient, doc: Mapping[str, Any], *, sched: Optional[PoliteScheduler],
                       cache: Optional[dict[str, FetchResult]], now_utc: datetime) -> Recheck:
        url = str(doc.get("recheck_url") or doc.get("source_url") or "")
        fres = await self._get(client, sched, url, cache=cache)
        term = classify_fetch(fres, url)
        if term:
            return term
        items, why = parse_cartagenaplay_event(fres["text"], page_meta(fres, url))
        c = next((x for x in items if x["start_date"] == doc.get("start_date")), None) or (items[0] if items else None)
        found = found_from_candidate(c)
        if c is None and "ended" in why:
            found = {"event_found": True, "finished": True}
        return compare_to_doc(doc, found, fres, bogota_today(now_utc))


# ════════════════════════════════════════════════════════════════════════════════════════════
# Generic JSON-LD Event parser — ONLY for the admin gate-check (§7 / §15 X4) and manual probes.
# Never registered in SOURCES and never used by pull: a domain without an adapter never feeds the
# collection. JSON-LD alone is not human-visible (§15 R2): date_visible needs the page to SHOW it.
# ════════════════════════════════════════════════════════════════════════════════════════════
_LD_STATUS_CANCEL = {"eventcancelled": "cancelled", "eventpostponed": "postponed", "eventrescheduled": "reprogramado"}
# Unknown CMS: every placeholder any adapter has met (§15 S1), incl. TuBoleta's 07:00.
_GENERIC_PLACEHOLDER_TIMES = PLACEHOLDER_TIMES | TUBOLETA_PLACEHOLDER_TIMES | CCC_PLACEHOLDER_TIMES
# Sources whose JSON-LD time is known to be fake or absent (§15 S1 table).
_LD_TIME_UNTRUSTED_POLICIES = frozenset({"ld_suffix_is_wallclock", "microdata_local", "date_only"})


def generic_source_entry(url: str) -> dict[str, Any]:
    """The registry entry for `url`'s domain when it has an adapter, else an unregistered tier-6
    'generic' entry (discovery grade: nothing parsed with it can reach HIGH on its own)."""
    host = urlsplit(str(url or "")).hostname or ""
    for e in SOURCES:
        if host and any(_host_matches(host, h) for h in e["hosts"]):
            return e
    return {"key": "generic", "name": politeness_key(str(url or "")) or "desconocido", "tier": 6, "role": "review",
            "adapter": None}


def _ld_offers(ev: Mapping[str, Any]) -> tuple[Optional[str], list[int]]:
    offers = ev.get("offers")
    rows = offers if isinstance(offers, list) else [offers] if isinstance(offers, dict) else []
    currency: Optional[str] = None
    amounts: list[int] = []
    for o in rows:
        if not isinstance(o, dict):
            continue
        currency = currency or (clean_text(o.get("priceCurrency")) or None)
        for k in ("price", "lowPrice", "highPrice"):
            a = _cop_decimal(o.get(k))
            if a:
                amounts.append(a)
    return currency, (amounts if (currency or "").upper() == "COP" else [])


def parse_generic_jsonld(html: str, meta: PageMeta, *,
                         source: Optional[Mapping[str, Any]] = None) -> tuple[list[Candidate], list[str]]:
    """Every JSON-LD Event on a page as a Candidate, for the gate-check probe. Placeholder dates
    (start==end==fetch day) are skipped; a date counts as visible only when the page text states
    the same day (with a year); a time only when a visible clock right after that date agrees, or,
    unconfirmed, when the node carries an explicit -05:00 and the time is not a placeholder."""
    src = dict(source) if source else generic_source_entry(str(meta.get("url") or ""))
    text = html_to_text(html)
    page_text = page_text_of(html)
    out: list[Candidate] = []
    skips: list[str] = []
    for ev in ld_events(html):
        title = clean_text(ev.get("name"))
        s, e = split_iso(ev.get("startDate")), split_iso(ev.get("endDate"))
        if not title:
            skips.append("no_name")
            continue
        if not s:
            skips.append("no_start_date")
            continue
        if ld_placeholder_date(s, e, meta.get("fetched_at")):
            skips.append("ld_placeholder_date")
            continue
        start = str(s["date"])
        vis = next((h for h in find_date_expressions(text, int(start[:4]))
                    if h["start"] == start and h["has_year"] and h["weekday_ok"]), None)
        vis_time = parse_clock(text[vis["span"][1]:vis["span"][1] + 80]) if vis else None
        start_time, confirmed = None, False
        if s["time"] and vis_time == s["time"]:
            start_time, confirmed = s["time"], True
        elif (s["time"] and s["offset"] == "-05:00" and s["time"] not in _GENERIC_PLACEHOLDER_TIMES
              and src.get("tz_policy") not in _LD_TIME_UNTRUSTED_POLICIES):
            start_time = s["time"]  # unconfirmed: never time_confirmed, never pushable
        loc = ld_location(ev)
        geo = (loc or {}).get("geo") or {}
        currency, amounts = _ld_offers(ev)
        status_raw = fold(str(ev.get("eventStatus") or "")).rsplit("/", 1)[-1]
        event_text = " | ".join(x for x in (title, vis["text"] if vis else "", ld_location_text(loc)) if x)
        end = str(e["date"]) if e and str(e["date"]) >= start else None
        out.append(make_candidate(
            src, meta, native_id=f"{slugify(title, 40)}-{start.replace('-', '')}", title=title, start_date=start,
            end_date=end, start_time=start_time, time_confirmed=confirmed,
            date_text=vis["text"] if vis else f"startDate {ev.get('startDate')}", date_visible=vis is not None,
            event_text=event_text, page_text=page_text, venue_name=(loc or {}).get("name"),
            address=(loc or {}).get("streetAddress"), lat=geo.get("latitude"), lng=geo.get("longitude"), ld_loc=loc,
            tz_offset=s["offset"], currency=currency, price=make_price(event_text, amounts), flags=["generic_jsonld"],
            markers={"cancel": _LD_STATUS_CANCEL.get(status_raw) or find_cancel_marker(event_text, _deny(src)),
                     "date_notice": find_date_notice(event_text, _deny(src))}))
    if not out and not skips:
        skips.append("no_jsonld_event")
    return out, skips


# ════════════════════════════════════════════════════════════════════════════════════════════
# Generic recheck (rows whose domain has no adapter) and HEAD recheck (PDF evidence)
# ════════════════════════════════════════════════════════════════════════════════════════════
def _windows(text: str, needles: Iterable[str], radius: int = 600) -> list[tuple[int, int, int, int]]:
    """(window_start, window_end, match_start, match_end) for each occurrence of each needle
    (accent/case-insensitive, whitespace-normalised)."""
    out: list[tuple[int, int, int, int]] = []
    ft = fold(text)
    for n in needles:
        n = _HSPACE_RE.sub(" ", fold(clean_text(n))).strip()
        if len(n) < 4:
            continue
        i = ft.find(n)
        while i != -1 and len(out) < 8:
            out.append((max(0, i - radius), min(len(text), i + len(n) + radius), i, i + len(n)))
            i = ft.find(n, i + 1)
    return out


async def generic_recheck(client: httpx.AsyncClient, doc: Mapping[str, Any], *, sched: Optional[PoliteScheduler] = None,
                          cache: Optional[dict[str, FetchResult]] = None, now_utc: Optional[datetime] = None,
                          adapter: Optional[Adapter] = None) -> Recheck:
    """Fetch recheck_url (or source_url) and look for the event: first the stored evidence
    date_text verbatim, else a date expression within ±600 chars of the title. Markers are matched
    only inside those windows (never page-wide)."""
    now_utc = now_utc or utc_now()
    url = str(doc.get("recheck_url") or doc.get("source_url") or "")
    if not _is_http_url(url):
        return make_recheck("blocked", marker="no_url")
    if url.lower().split("?")[0].endswith(".pdf"):
        return await head_recheck(client, doc, url=url, sched=sched)
    fetch_url = _ccc_bust(url, now_utc) if politeness_key(url) == "cccartagena.com" else url
    try:
        if cache is not None and url in cache:
            fres = cache[url]
        else:
            fres = await fetch(client, fetch_url, source=(adapter.entry if adapter else None), sched=sched)
            fres["url"] = url
            if cache is not None:
                cache[url] = fres
    except DeadlineReached:
        raise
    term = classify_fetch(fres, url)
    if term:
        return term
    text = html_to_text(fres.get("text") or "")
    d0 = _date_of(doc.get("start_date"))
    ref_year = d0.year if d0 else bogota_today(now_utc).year
    title = _doc_title(doc)
    ev_texts = [str(e.get("date_text")) for e in (doc.get("evidence") or [])
                if isinstance(e, Mapping) and e.get("date_text") and (e.get("url") in (url, doc.get("source_url")))]
    denylist = adapter.denylist if adapter else ()
    found: dict[str, Any] = {"event_found": False}
    for w0, w1, m0, m1 in _windows(text, ev_texts, radius=400):
        window = text[w0:w1]
        exact = text[m0:m1]  # the stored evidence text, verbatim on the page: its own date is the one
        hit = next((h for h in find_date_expressions(exact, ref_year) if h["weekday_ok"]), None)
        found = {"event_found": True, "date_text": exact,
                 "parsed": {"start_date": hit["start"], "end_date": hit["end"],
                            "start_time": parse_clock(exact[hit["span"][1]:])} if hit else None,
                 "cancel": find_cancel_marker(window, denylist), "date_notice": find_date_notice(window, denylist),
                 "notice_text": _strip_boilerplate(window, denylist)}
        if hit and hit["start"] == doc.get("start_date"):
            break
    if not found.get("parsed"):
        for w0, w1, _m0, _m1 in _windows(text, [title], radius=600):
            window = text[w0:w1]
            hits = [h for h in find_date_expressions(window, ref_year) if h["weekday_ok"]]
            if not hits:
                found = {**found, "event_found": True, "cancel": found.get("cancel") or find_cancel_marker(window, denylist)}
                continue
            best = next((h for h in hits if h["start"] == doc.get("start_date")), hits[0])
            found = {"event_found": True, "date_text": best["text"],
                     "parsed": {"start_date": best["start"], "end_date": best["end"],
                                "start_time": parse_clock(window[best["span"][1]:best["span"][1] + 60])},
                     "cancel": find_cancel_marker(window, denylist), "date_notice": find_date_notice(window, denylist),
                     "notice_text": _strip_boilerplate(window, denylist)}
            if best["start"] == doc.get("start_date"):
                break
    if found.get("parsed") and found["parsed"].get("start_date") == doc.get("start_date") and not doc.get("start_time"):
        found["parsed"]["start_time"] = None
    return with_title_scope(compare_to_doc(doc, found, fres, bogota_today(now_utc)), fres, doc, denylist)


async def head_recheck(client: httpx.AsyncClient, doc: Mapping[str, Any], *, url: Optional[str] = None,
                       sched: Optional[PoliteScheduler] = None) -> Recheck:
    """PDF evidence (§13 G recheck:'head'): compare ETag / Last-Modified / Content-Length with the
    row's stored etag / last_modified / content_length. success = unchanged; 'changed' = any stored
    value differs (→ review/source_changed); not_found+marker 'no_baseline' = nothing stored yet
    (the returned head{} is the baseline to store). Blocked/gone as usual."""
    target = url or str(doc.get("recheck_url") or doc.get("source_url") or "")
    fres = await fetch(client, target, source=None, sched=sched, method="HEAD")
    term = classify_fetch(fres, target)
    if term:
        return term
    h = fres.get("headers") or {}
    head = {"etag": h.get("etag"), "last_modified": h.get("last-modified"), "content_length": h.get("content-length")}
    stored = {k: doc.get(k) for k in ("etag", "last_modified", "content_length") if doc.get(k) not in (None, "")}
    status = int(fres.get("status") or 0)
    if not stored:
        return make_recheck("not_found", http_status=status, marker="no_baseline", final_url=fres.get("final_url"), head=head)
    diff = [k for k, v in stored.items() if head.get(k) is not None and str(head.get(k)) != str(v)]
    missing = [k for k in stored if head.get(k) is None]
    if diff:
        return make_recheck("changed", http_status=status, marker="source_changed", final_url=fres.get("final_url"),
                            head=head, detail=",".join(diff))
    if len(missing) == len(stored):
        return make_recheck("not_found", http_status=status, marker="no_validators", final_url=fres.get("final_url"), head=head)
    return make_recheck("success", http_status=status, final_url=fres.get("final_url"), head=head)


# ════════════════════════════════════════════════════════════════════════════════════════════
# SOURCES registry (§5 order; §13 F2 fields). role: discover | corroborate | review.
# scope: the URL path scope the adapter is allowed to fetch.
# ════════════════════════════════════════════════════════════════════════════════════════════
def _entry(adapter: Adapter, *, name: str, tier: int, domain: str, scope: str, role: str, tz_policy: str,
           min_gap_s: float = DEFAULT_MIN_GAP_S, cookie_jar: bool = False, max_items_per_call: int = 10,
           recheck: str = "adapter", enabled: bool = True, hosts: Sequence[str] = (), llm_text_ok: bool = True,
           headers: Optional[Mapping[str, str]] = None) -> dict[str, Any]:
    e: dict[str, Any] = {
        "key": adapter.key, "name": name, "tier": tier, "domain": domain, "hosts": list(hosts) or [domain],
        "scope": scope, "role": role, "min_gap_s": min_gap_s, "cookie_jar": cookie_jar,
        "max_items_per_call": max_items_per_call, "recheck": recheck, "enabled": enabled,
        "tz_policy": tz_policy, "llm_text_ok": llm_text_ok, "headers": dict(headers or {}), "adapter": adapter,
    }
    adapter.bind(e)
    return e


SOURCES: list[dict[str, Any]] = [
    _entry(CmfAdapter(), name="Cartagena Festival de Música (organizador)", tier=1, domain="cartagenamusicfestival.com",
           scope="/", role="discover", tz_policy="visible_text", max_items_per_call=12),
    _entry(HayAdapter(), name="Hay Festival Cartagena de Indias (organizador)", tier=1, domain="hayfestival.com",
           scope="/cartagena/", role="discover", tz_policy="local_datetime_attr", min_gap_s=2.0, max_items_per_call=3),
    _entry(FicciAdapter(), name="FICCI (organizador)", tier=1, domain="ficcifestival.com", scope="/",
           role="discover", tz_policy="utc_z_convert", max_items_per_call=6),
    _entry(IronmanAdapter(), name="IRONMAN (organizador)", tier=1, domain="ironman.com",
           scope="/races/im703-cartagena", role="discover", tz_policy="date_only", max_items_per_call=1),
    _entry(IpccAdapter(), name="IPCC · Instituto de Patrimonio y Cultura de Cartagena", tier=1, domain="ipcc.gov.co",
           scope="/", role="corroborate", tz_policy="visible_text", max_items_per_call=2),
    _entry(LaTiqueteraAdapter(), name="La Tiquetera", tier=2, domain="latiquetera.com", scope="/",
           role="discover", tz_policy="honour_minus5", max_items_per_call=10),
    _entry(TuBoletaAdapter(), name="TuBoleta", tier=2, domain="tuboleta.com", scope="/es/eventos/ + SecuTix /list/events",
           role="discover", tz_policy="ld_suffix_is_wallclock", cookie_jar=True, max_items_per_call=5,
           hosts=("tuboleta.com", "special.checkout.tuboleta.com", "teatros.checkout.tuboleta.com")),
    _entry(TicketshopAdapter(), name="Ticketshop", tier=2, domain="ticketshop.com.co", scope="/api/ (id_ciudad 176)",
           role="discover", tz_policy="api_local", max_items_per_call=8,
           hosts=("ticketshop.com.co", "api.ticketshop.com.co"), headers={"Accept": "application/json"}),
    _entry(FeverCoAdapter(), name="Fever Colombia", tier=2, domain="feverup.com", scope="/en/cartagena-colombia/",
           role="discover", tz_policy="honour_minus5", max_items_per_call=6),
    _entry(CccAdapter(), name="Centro de Convenciones Cartagena de Indias", tier=3, domain="cccartagena.com",
           scope="/events/", role="discover", tz_policy="microdata_local", max_items_per_call=10),
    _entry(ElUniversalAdapter(), name="El Universal", tier=5, domain="eluniversal.com.co",
           scope="/arc/outboundfeeds/rss/category/", role="corroborate", tz_policy="visible_text",
           max_items_per_call=3, llm_text_ok=False),
    _entry(CartagenaplayAdapter(), name="Cartagenaplay (agregador)", tier=6, domain="cartagenaplay.com",
           scope="/event/", role="review", tz_policy="visible_text", max_items_per_call=8, recheck="adapter"),
]
SOURCES_BY_KEY: dict[str, dict[str, Any]] = {e["key"]: e for e in SOURCES}


def public_sources() -> list[dict[str, Any]]:
    """The registry without adapter objects (JSON-safe, for admin/runs)."""
    return [{k: v for k, v in e.items() if k != "adapter"} for e in SOURCES]


def _host_matches(host: str, domain: str) -> bool:
    host = politeness_key(host)
    domain = politeness_key(domain)
    return host == domain or host.endswith("." + domain)


def adapter_for(doc: Mapping[str, Any]) -> Optional[Adapter]:
    """Adapter by doc.source_key, else by the domain of recheck_url / source_url. None → generic."""
    key = doc.get("source_key")
    if key and key in SOURCES_BY_KEY:
        ad = SOURCES_BY_KEY[key]["adapter"]
        return ad if isinstance(ad, Adapter) else None
    for u in (doc.get("recheck_url"), doc.get("source_url")):
        host = urlsplit(str(u or "")).hostname or ""
        if not host:
            continue
        for e in SOURCES:
            if any(_host_matches(host, h) for h in e["hosts"]):
                ad = e["adapter"]
                return ad if isinstance(ad, Adapter) else None
    return None


async def recheck_doc(client: httpx.AsyncClient, doc: Mapping[str, Any], *, sched: Optional[PoliteScheduler] = None,
                      cache: Optional[dict[str, FetchResult]] = None, now_utc: Optional[datetime] = None,
                      disabled: Iterable[str] = ()) -> Recheck:
    """Sentinel entry point: PDF → head_recheck; adapter source → adapter.recheck; else generic.
    Sources listed in `disabled` (flags.sources_disabled) report blocked without fetching."""
    url = str(doc.get("recheck_url") or doc.get("source_url") or "")
    if url.lower().split("?")[0].endswith(".pdf"):
        return await head_recheck(client, doc, url=url, sched=sched)
    ad = adapter_for(doc)
    if ad is not None and (ad.key in set(disabled) or not ad.entry.get("enabled", True)):
        return make_recheck("blocked", marker="source_disabled")
    if ad is not None and ad.entry.get("recheck") == "adapter":
        run_cache: dict[str, FetchResult] = cache if cache is not None else {}
        rec = await ad.recheck(client, doc, sched=sched, cache=run_cache, now_utc=now_utc)
        # A notice outside the event's own row/block (e.g. an 'ACTUALIZACIÓN … APLAZADOS' paragraph
        # above the agenda) is still news about this event: never a success (generic_recheck does
        # the same on its own page).
        return with_title_scope(rec, run_cache.get(url), doc, ad.denylist)
    return await generic_recheck(client, doc, sched=sched, cache=cache, now_utc=now_utc, adapter=ad)


__all__ = [
    "UA", "SOURCES", "SOURCES_BY_KEY", "PLACEHOLDER_COORDS", "BOGOTA_TZ", "Adapter", "PullResult", "PoliteScheduler",
    "DeadlineReached", "fetch", "make_client", "detect_challenge", "adapter_for", "recheck_doc", "generic_recheck",
    "head_recheck", "public_sources", "find_cancel_marker", "find_sold_out", "find_finished", "make_recheck", "compare_to_doc",
    "clean_coords", "is_free_from", "split_iso", "find_date_expressions", "parse_clock", "ld_placeholder_date",
    "public_url_guard", "ip_is_public", "parse_generic_jsonld", "generic_source_entry", "umbrella_coverage",
    "text_on_page", "page_meta", "page_text_of", "html_to_text",
]
