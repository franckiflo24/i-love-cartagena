"""EVENTS-ELITE: Luna's deterministic event gate (DESIGN.md §9, §13 I, §15 V).

The honesty spine inside the concierge: Luna NEVER invents an event. An event answer comes
only from the published, source-verified feed (events_runtime.public_rows, which re-applies
events_gate.public_view on every read). Otherwise Luna declines deterministically, WITHOUT
calling the LLM.

  EVENTS_ELITE_CUTOVER                                   assistant turns older than this never reach the LLM
  detect_event_intent(text, lang, *, now=None)           -> {is_event, range, near, category}
  get_confirmed_events(db, range_key, near=None, category=None, limit=8, *, query=None, now=None)
  event_gate(db, intent, *, lang, location, query, now)  -> {payload: decline | None, rows: [PublicEvent]}
  decline_payload(lang, confirmed_top, verify_rows, kind='no_events'|'maintenance'|'no_location', ...)
  grounded_payload(rows, lang, range_key, ...)           deterministic list (LLM failure / no-LLM callers)
  context_rows(rows)                                     structured fields only (§15 S4: never descriptions)
  sanitize(recs, actions, injected_rows, ...)            open_event / event cards / external_link -> injected only
  prose_guard(message, injected_rows, lang, ...)         §15 V2: ungrounded event date/time -> grounded list
  strip_ungrounded(message, injected_rows, lang, ...)    same detector, sentence-level (non-event turns)
  citation_footer(message, recs, actions, injected_rows, lang)   §15 V4
  filter_history(history)                                §15 V3 cutover
  clean_location(location)                               validated (lat, lng) or None

Privacy (§1.2, §13 I3): a user location is only ever a function argument. It is never
stored, logged, or echoed back in any payload.
"""
from __future__ import annotations

import logging
import math
import os
import re
import unicodedata
from datetime import date, datetime, timedelta
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple

import events_gate as gate
import events_runtime as runtime
from events_time import BOGOTA

logger = logging.getLogger("luna_events")

# §15 V3 history cutover. The constant is the design default; set env EVENTS_ELITE_CUTOVER to the
# real production deploy time (ISO 'YYYY-MM-DDTHH:MM:SSZ') so assistant turns the OLD Luna wrote
# between this date and the deploy are never re-fed to the LLM. An unparsable value is ignored.
_CUTOVER_DEFAULT = "2026-09-29T00:00:00Z"


def _cutover_from_env() -> str:
    raw = os.environ.get("EVENTS_ELITE_CUTOVER", "").strip()
    ts = gate.parse_iso(raw) if raw else None
    floor = gate.parse_iso(_CUTOVER_DEFAULT)
    if ts is not None and floor is not None and ts >= floor:
        return raw
    return _CUTOVER_DEFAULT


EVENTS_ELITE_CUTOVER = _cutover_from_env()

LANGS: Tuple[str, ...] = ("es", "en", "fr", "pt")
NEAR_RADIUS_M = 3000.0
TONIGHT_FROM = "17:00"
PROSE_WINDOW = 80  # §15 V2: event word within 80 chars of an ungrounded date/time token

# Related categories a generic question should still surface (exact category sorts first).
CATEGORY_GROUPS: Dict[str, Tuple[str, ...]] = {
    "concert": ("concert", "festival", "nightlife"),
    "festival": ("festival", "concert", "cultural"),
    "cultural": ("cultural", "festival", "civic"),
    "sports": ("sports",),
    "family": ("family", "festival", "cultural", "civic"),
    "gastronomic": ("gastronomic", "festival"),
    "nightlife": ("nightlife", "concert"),
    "civic": ("civic", "cultural", "festival"),
}


# ── text helpers ─────────────────────────────────────────────────────────────

_APOS = {"’": "'", "‘": "'", "´": "'", "`": "'"}


@lru_cache(maxsize=4096)
def _fold1(ch: str) -> str:
    ch = _APOS.get(ch, ch)
    base = "".join(c for c in unicodedata.normalize("NFD", ch) if not unicodedata.combining(c)).lower()
    if len(base) == 1:
        return base
    low = ch.lower()
    return low if len(low) == 1 else " "


def fold_keep(s: Any) -> str:
    """Lowercase + accent-strip with the SAME length as the input, so regex spans on the
    folded text map 1:1 back onto the original (needed for sentence stripping)."""
    if not isinstance(s, str):
        return ""
    return "".join(_fold1(c) for c in s)


def _alnum(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", s)


def _norm_words(s: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", fold_keep(s if isinstance(s, str) else "")).strip()


def _lang(lang: Any) -> str:
    return lang if lang in LANGS else "es"


_LANG_HINTS: Dict[str, "re.Pattern[str]"] = {
    "fr": re.compile(r"\b(bonjour|salut|merci|quoi|quel(?:le)?s?|qu'est|qu'y|ce soir|aujourd'hui|demain|je|nous|vous|"
                     r"est-ce|pres de moi|evenements?|faire|cette semaine|week-end|le|les|des|du|aux?|une|il y a|"
                     r"janvier|fevrier|avril|juin|juillet|aout|octobre|novembre|decembre)\b"),
    "pt": re.compile(r"\b(ola|oi|obrigad[oa]|voce|quero|hoje|amanha|onde|tem|perto de mim|o que|fim de semana|"
                     r"esta rolando|shows? hoje|nesta|neste)\b"),
    "en": re.compile(r"\b(what'?s|what|where|when|who|how|the|tonight|today|tomorrow|weekend|near me|is|are|any|"
                     r"events?|please|thanks|hi|hello|happening|on)\b"),
    "es": re.compile(r"\b(que|donde|cuando|como|hoy|manana|esta noche|fin de semana|cerca de mi|hay|eventos?|"
                     r"conciertos?|quiero|gracias|hola|pasa|el|la|los|las|viene|toca)\b"),
}


def guess_lang(text: Any) -> str:
    """Cheap keyword vote for the deterministic (no-LLM) paths. Ties -> es."""
    t = fold_keep(text)
    best, best_score = "es", 0
    for lg in ("es", "en", "fr", "pt"):
        score = len(_LANG_HINTS[lg].findall(t))
        if score > best_score:
            best, best_score = lg, score
    return best


# ── dates / months / weekdays ────────────────────────────────────────────────

_MONTH_FULL: Dict[str, int] = {
    # es
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
    "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
    # en
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
    # fr
    "janvier": 1, "fevrier": 2, "mars": 3, "avril": 4, "mai": 5, "juin": 6, "juillet": 7, "aout": 8,
    "septembre": 9, "octobre": 10, "novembre": 11, "decembre": 12,
    # pt
    "janeiro": 1, "fevereiro": 2, "marco": 3, "maio": 5, "junho": 6, "julho": 7,
    "setembro": 9, "outubro": 10, "novembro": 11, "dezembro": 12,
}
_MONTH_ABBR: Dict[str, int] = {
    "ene": 1, "jan": 1, "janv": 1, "feb": 2, "fev": 2, "fevr": 2, "mar": 3, "abr": 4, "apr": 4, "avr": 4,
    "jun": 6, "jul": 7, "juil": 7, "ago": 8, "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11,
    "dic": 12, "dec": 12, "dez": 12,
}
_MONTH_PT_ONLY: Dict[str, int] = {"set": 9, "out": 10}  # English words otherwise ("sold out", "set")
# Standalone month words for the broad temporal scan ("Karol G viene en diciembre"). Words
# that are ordinary vocabulary on their own are left out.
_MONTH_ALONE = frozenset(k for k in _MONTH_FULL if k not in {"may", "marco", "mars"})

_WEEKDAYS: Dict[str, int] = {
    "lunes": 0, "martes": 1, "miercoles": 2, "jueves": 3, "viernes": 4, "sabado": 5, "domingo": 6,
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6,
    "lundi": 0, "mardi": 1, "mercredi": 2, "jeudi": 3, "vendredi": 4, "samedi": 5, "dimanche": 6,
    "segunda-feira": 0, "terca-feira": 1, "quarta-feira": 2, "quinta-feira": 3, "sexta-feira": 4,
}
_WEEKDAYS_PT_SHORT: Dict[str, int] = {"segunda": 0, "terca": 1, "quarta": 2, "quinta": 3, "sexta": 4}


def _alt(words: Iterable[str]) -> str:
    return "|".join(re.escape(w) for w in sorted(set(words), key=len, reverse=True))


def _month_map(lang: str) -> Dict[str, int]:
    m = dict(_MONTH_FULL)
    m.update(_MONTH_ABBR)
    if lang == "pt":
        m.update(_MONTH_PT_ONLY)
    return m


def _weekday_map(lang: str) -> Dict[str, int]:
    w = dict(_WEEKDAYS)
    if lang == "pt":
        w.update(_WEEKDAYS_PT_SHORT)
    return w


@lru_cache(maxsize=8)
def _date_res(lang: str) -> Dict[str, "re.Pattern[str]"]:
    mon = _alt(_month_map(lang))
    wd = _alt(_weekday_map(lang))
    ordn = r"(?:st|nd|rd|th|er|º|°)?"
    sep = r"\s*(?:al|a|-|–|—|y|e|and|to|au|et|ate)\s*"
    return {
        "range_d": re.compile(rf"\b(\d{{1,2}}){ordn}{sep}(\d{{1,2}}){ordn}\s*(?:de\s+|of\s+)?({mon})\b\.?"),
        "range_m": re.compile(rf"\b({mon})\.?\s+(\d{{1,2}}){ordn}{sep}(\d{{1,2}})\b"),
        "d_m": re.compile(rf"\b(\d{{1,2}}){ordn}\s*(?:de\s+|of\s+)?({mon})\b\.?"),
        "m_d": re.compile(rf"\b({mon})\.?\s+(\d{{1,2}}){ordn}(?!\d)\b"),
        "num": re.compile(r"(?<![\d/.,:])(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?(?![\d/])"),
        "iso": re.compile(r"\b(20\d{2})-(\d{2})-(\d{2})\b"),
        "wd_num": re.compile(rf"\b({wd})s?\s+(\d{{1,2}})\b(?!\s*(?::|h\b|am\b|pm\b|a\.m|p\.m|horas?\b|hrs?\b))"),
        "wd": re.compile(rf"\b({wd})s?\b"),
    }


_TIME_HM_RE = re.compile(r"(?<![\d:.,])([01]?\d|2[0-3]):([0-5]\d)(?!\d)")
_TIME_AMPM_RE = re.compile(r"(?<![\d:.,])(\d{1,2})(?::([0-5]\d))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)(?![a-z])")
_TIME_ALAS_RE = re.compile(r"\b(?:a las|desde las|hasta las|a partir de las|a eso de las)\s+(\d{1,2})\b"
                           r"(?!\s*(?::|h\b|a\.?\s?m|p\.?\s?m))")
_TIME_FR_RE = re.compile(r"\b(?:a|vers|des)\s+(\d{1,2})\s?h(?:([0-5]\d))?\b|\b(\d{1,2})h([0-5]\d)\b")
_TIME_HMIN_RE = re.compile(r"\b(\d{1,2})h([0-5]\d)\b")
_TIME_PT_RE = re.compile(r"\b(?:as|a partir das|das)\s+(\d{1,2})(?:h(?:([0-5]\d))?|:([0-5]\d))?\b")
_TIME_OCLOCK_RE = re.compile(r"\b(\d{1,2})\s+o'?clock\b")

_RELATIVE_RE = re.compile(
    r"\b(?:hoy|esta noche|manana|pasado manana|este fin|fin de semana|finde|tonight|today|tomorrow|this weekend|"
    r"ce soir|aujourd'hui|demain|ce week-end|hoje|amanha|esta noite|fim de semana)\b")
_MONTH_ALONE_RE = re.compile(rf"\b({_alt(_MONTH_ALONE)})\b")


def _mk_date(y: int, m: int, d: int) -> Optional[date]:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def _hhmm(h: int, m: int = 0) -> Optional[str]:
    if 0 <= h <= 23 and 0 <= m <= 59:
        return f"{h:02d}:{m:02d}"
    return None


def _ampm(h: int, m: int, suffix: str) -> Optional[str]:
    if not 1 <= h <= 12:
        return None
    pm = suffix.startswith("p")
    hh = (h % 12) + (12 if pm else 0)
    return _hhmm(hh, m)


class _Tok:
    """A date or time mention in a message: span + the values it could mean. kind 'days' is a
    relative day word resolved against today ('hoy', 'tonight', 'mañana', 'este fin'), kind
    'month' a month named alone ('en diciembre')."""
    __slots__ = ("start", "end", "kind", "md", "every", "dom", "wd", "times", "days", "months")

    def __init__(self, start: int, end: int, kind: str, *, md: Optional[Set[Tuple[int, int]]] = None,
                 every: bool = False, dom: Optional[int] = None, wd: Optional[int] = None,
                 times: Optional[Set[str]] = None, days: Optional[Set[date]] = None,
                 months: Optional[Set[int]] = None) -> None:
        self.start, self.end, self.kind = start, end, kind
        self.md = md or set()
        self.every = every      # range token: EVERY endpoint must be grounded
        self.dom = dom
        self.wd = wd
        self.times = times or set()
        self.days = days or set()
        self.months = months or set()


def _overlaps(a: Tuple[int, int], spans: Sequence[Tuple[int, int]]) -> bool:
    return any(a[0] < e and s < a[1] for s, e in spans)


def _scan_tokens(t: str, lang: str) -> List[_Tok]:
    """Date + time tokens in folded text `t` (§15 V2). Relative words ('hoy', 'tonight') are
    NOT date tokens here, so an honest 'hoy no tengo eventos confirmados' never trips."""
    res = _date_res(lang)
    months = _month_map(lang)
    wds = _weekday_map(lang)
    toks: List[_Tok] = []
    taken: List[Tuple[int, int]] = []

    def _ok(*days: int) -> bool:
        return all(1 <= d <= 31 for d in days)

    for m in res["range_d"].finditer(t):
        mo, a, b = months[m.group(3)], int(m.group(1)), int(m.group(2))
        if _ok(a, b):
            toks.append(_Tok(m.start(), m.end(), "md", md={(mo, a), (mo, b)}, every=True))
    for m in res["range_m"].finditer(t):
        mo, a, b = months[m.group(1)], int(m.group(2)), int(m.group(3))
        if _ok(a, b):
            toks.append(_Tok(m.start(), m.end(), "md", md={(mo, a), (mo, b)}, every=True))
    for m in res["d_m"].finditer(t):
        if _ok(int(m.group(1))):
            toks.append(_Tok(m.start(), m.end(), "md", md={(months[m.group(2)], int(m.group(1)))}))
    for m in res["m_d"].finditer(t):
        if _ok(int(m.group(2))):
            toks.append(_Tok(m.start(), m.end(), "md", md={(months[m.group(1)], int(m.group(2)))}))
    for m in res["iso"].finditer(t):
        toks.append(_Tok(m.start(), m.end(), "md", md={(int(m.group(2)), int(m.group(3)))}))
    for m in res["num"].finditer(t):
        a, b = int(m.group(1)), int(m.group(2))
        md_cands = {(mm, dd) for mm, dd in ((b, a), (a, b)) if 1 <= mm <= 12 and 1 <= dd <= 31}
        if md_cands:
            toks.append(_Tok(m.start(), m.end(), "md", md=md_cands))
    for m in res["wd_num"].finditer(t):
        if not _ok(int(m.group(2))):
            continue
        taken.append((m.start(), m.end()))
        toks.append(_Tok(m.start(), m.end(), "dom", dom=int(m.group(2)), wd=wds[m.group(1)]))
    for m in res["wd"].finditer(t):
        if _overlaps((m.start(), m.end()), taken):
            continue
        toks.append(_Tok(m.start(), m.end(), "wd", wd=wds[m.group(1)]))

    ampm_spans: List[Tuple[int, int]] = []
    for m in _TIME_AMPM_RE.finditer(t):
        v = _ampm(int(m.group(1)), int(m.group(2) or 0), m.group(3).replace(".", "").replace(" ", ""))
        if v:
            ampm_spans.append((m.start(), m.end()))
            toks.append(_Tok(m.start(), m.end(), "time", times={v}))
    for m in _TIME_HM_RE.finditer(t):
        if _overlaps((m.start(), m.end()), ampm_spans):
            continue
        v = _hhmm(int(m.group(1)), int(m.group(2)))
        if v:
            toks.append(_Tok(m.start(), m.end(), "time", times={v}))
    for m in _TIME_ALAS_RE.finditer(t):
        h = int(m.group(1))
        t_cands = {x for x in (_hhmm(h), _hhmm(h + 12) if h < 12 else None) if x}
        if t_cands:
            toks.append(_Tok(m.start(), m.end(), "time", times=t_cands))
    for m in (_TIME_FR_RE if lang == "fr" else _TIME_HMIN_RE).finditer(t):
        if lang == "fr":
            h, mi = int(m.group(1) or m.group(3)), int(m.group(2) or m.group(4) or 0)
        else:
            h, mi = int(m.group(1)), int(m.group(2))
        v = _hhmm(h, mi)
        if v:
            toks.append(_Tok(m.start(), m.end(), "time", times={v}))
    for m in _TIME_OCLOCK_RE.finditer(t):
        h = int(m.group(1))
        t_cands = {x for x in (_hhmm(h), _hhmm(h + 12) if h < 12 else None) if x}
        if t_cands:
            toks.append(_Tok(m.start(), m.end(), "time", times=t_cands))
    if lang == "pt":
        for m in _TIME_PT_RE.finditer(t):
            h = int(m.group(1))
            mi = int(m.group(2) or m.group(3) or 0)
            pt_cands = {x for x in (_hhmm(h, mi), _hhmm(h + 12, mi) if h < 12 else None) if x}
            if pt_cands:
                toks.append(_Tok(m.start(), m.end(), "time", times=pt_cands))
    return toks


def _broad_temporal_spans(t: str, lang: str) -> List[Tuple[int, int]]:
    spans = [(k.start, k.end) for k in _scan_tokens(t, lang)]
    spans += [(m.start(), m.end()) for m in _RELATIVE_RE.finditer(t)]
    spans += [(m.start(), m.end()) for m in _MONTH_ALONE_RE.finditer(t)]
    return spans


# ── row helpers ──────────────────────────────────────────────────────────────


def _ymd(v: Any) -> Optional[date]:
    if isinstance(v, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        try:
            return date.fromisoformat(v)
        except ValueError:
            return None
    return None


def _hm(v: Any) -> Optional[str]:
    if isinstance(v, str) and re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", v.strip()):
        return v.strip()
    return None


def _title(row: Mapping[str, Any], lang: str) -> str:
    t = row.get("title")
    if isinstance(t, Mapping):
        for k in (lang, "es", "en", "fr", "pt"):
            v = t.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
    if isinstance(t, str) and t.strip():
        return t.strip()
    return ""


def _titles_all(row: Mapping[str, Any]) -> List[str]:
    t = row.get("title")
    if isinstance(t, Mapping):
        return [v for v in t.values() if isinstance(v, str) and v.strip()]
    return [t] if isinstance(t, str) and t.strip() else []


_TITLE_TRIM_RE = re.compile(r"\((?:[^)]*)\)|\b20\d{2}\b|\bcartagena(?: de indias)?\b|\bcolombia\b|\d+(?:[.,]\d+)?")


def _short_title(title: str) -> str:
    """'Hay Festival Cartagena de Indias 2027' -> 'hay festival'; 'FICCI 66 · Festival …' -> 'ficci'."""
    head = re.split(r"\s[·|:–—-]\s", title)[0]
    s = _TITLE_TRIM_RE.sub(" ", fold_keep(head))
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _is_high(row: Mapping[str, Any]) -> bool:
    return row.get("confidence") == "HIGH"


def _source_name(row: Mapping[str, Any]) -> str:
    raw = row.get("source_name")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return gate.registrable_domain(row.get("source_url")) or "organizador"


# ── localized copy ───────────────────────────────────────────────────────────

_MON_SHORT: Dict[str, Tuple[str, ...]] = {
    "es": ("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"),
    "en": ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"),
    "fr": ("janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."),
    "pt": ("jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"),
}

_T: Dict[str, Dict[str, str]] = {
    "es": {
        "today": "hoy", "tonight": "esta noche", "weekend": "este fin de semana", "week": "esta semana",
        "upcoming": "los próximos días", "date": "el {d}",
        "no_events": "No tengo {noun} confirmados{near} para {range}.",
        "near": " cerca de ti (a menos de 3 km)",
        "offer": "Esto es lo que sí está en la agenda verificada:",
        "nothing": "Cuando haya algo verificado, aparecerá en la agenda.",
        "maintenance": "La agenda de eventos está en mantenimiento, así que ahora mismo no puedo confirmarte eventos. "
                       "Vuelve a preguntarme en un rato.",
        "no_location": "No tengo tu ubicación en este chat, así que no puedo filtrar eventos cerca de ti.",
        "grounded": "Esto es lo que tengo confirmado para {range}:",
        "replaced": "No puedo confirmarte eso con fuentes verificadas. Esto es lo que sí está en la agenda:",
        "confirmed": "Confirmado:", "unconfirmed": "Sin confirmar (verifica con el organizador):",
        "source": "Fuente: {src} · verificado {d}", "source_nodate": "Fuente: {src}", "hedge": " (sin confirmar)",
        "verify_vibe": "Sin confirmar · verifica con el organizador", "high_vibe": "Verificado · {src}",
        "agenda": "Ver agenda verificada", "pointer": "Para planes con fecha, mira la agenda verificada.",
        "sugg1": "Ver la agenda completa", "sugg2": "¿Dónde cenar esta noche?",
        "time_tbc": "hora por confirmar",
    },
    "en": {
        "today": "today", "tonight": "tonight", "weekend": "this weekend", "week": "this week",
        "upcoming": "the coming days", "date": "{d}",
        "no_events": "I don't have any confirmed {noun}{near} for {range}.",
        "near": " near you (within 3 km)",
        "offer": "Here's what the verified agenda does have:",
        "nothing": "As soon as something is verified, it will show up in the agenda.",
        "maintenance": "The events agenda is under maintenance, so I can't confirm any events right now. "
                       "Ask me again in a little while.",
        "no_location": "I don't have your location in this chat, so I can't filter events near you.",
        "grounded": "Here's what I have confirmed for {range}:",
        "replaced": "I can't confirm that with verified sources. Here's what the verified agenda has:",
        "confirmed": "Confirmed:", "unconfirmed": "Unconfirmed (check with the organizer):",
        "source": "Source: {src} · verified {d}", "source_nodate": "Source: {src}", "hedge": " (unconfirmed)",
        "verify_vibe": "Unconfirmed · check with the organizer", "high_vibe": "Verified · {src}",
        "agenda": "See the verified agenda", "pointer": "For plans on a specific date, check the verified agenda.",
        "sugg1": "See the full agenda", "sugg2": "Where should I eat tonight?",
        "time_tbc": "time to be confirmed",
    },
    "fr": {
        "today": "aujourd'hui", "tonight": "ce soir", "weekend": "ce week-end", "week": "cette semaine",
        "upcoming": "les prochains jours", "date": "le {d}",
        "no_events": "Je n'ai pas {de}{noun} confirmés{near} pour {range}.",
        "near": " près de toi (à moins de 3 km)",
        "offer": "Voici ce que l'agenda vérifié contient :",
        "nothing": "Dès que quelque chose sera vérifié, il apparaîtra dans l'agenda.",
        "maintenance": "L'agenda des événements est en maintenance : je ne peux confirmer aucun événement pour le "
                       "moment. Redemande-moi un peu plus tard.",
        "no_location": "Je n'ai pas ta position dans ce chat, donc je ne peux pas filtrer les événements près de toi.",
        "grounded": "Voici ce que j'ai de confirmé pour {range} :",
        "replaced": "Je ne peux pas confirmer cela avec des sources vérifiées. Voici ce que contient l'agenda vérifié :",
        "confirmed": "Confirmé :", "unconfirmed": "Non confirmé (vérifie auprès de l'organisateur) :",
        "source": "Source : {src} · vérifié le {d}", "source_nodate": "Source : {src}", "hedge": " (non confirmé)",
        "verify_vibe": "Non confirmé · vérifie auprès de l'organisateur", "high_vibe": "Vérifié · {src}",
        "agenda": "Voir l'agenda vérifié", "pointer": "Pour des sorties à une date précise, consulte l'agenda vérifié.",
        "sugg1": "Voir l'agenda complet", "sugg2": "Où dîner ce soir ?",
        "time_tbc": "heure à confirmer",
    },
    "pt": {
        "today": "hoje", "tonight": "hoje à noite", "weekend": "este fim de semana", "week": "esta semana",
        "upcoming": "os próximos dias", "date": "o dia {d}",
        "no_events": "Não tenho {noun} confirmados{near} para {range}.",
        "near": " perto de você (a menos de 3 km)",
        "offer": "Isto é o que a agenda verificada tem:",
        "nothing": "Assim que algo for verificado, vai aparecer na agenda.",
        "maintenance": "A agenda de eventos está em manutenção, então agora não consigo confirmar eventos. "
                       "Pergunte de novo daqui a pouco.",
        "no_location": "Não tenho a sua localização neste chat, então não consigo filtrar eventos perto de você.",
        "grounded": "Isto é o que tenho confirmado para {range}:",
        "replaced": "Não consigo confirmar isso com fontes verificadas. Isto é o que a agenda verificada tem:",
        "confirmed": "Confirmado:", "unconfirmed": "Não confirmado (confira com o organizador):",
        "source": "Fonte: {src} · verificado em {d}", "source_nodate": "Fonte: {src}", "hedge": " (não confirmado)",
        "verify_vibe": "Não confirmado · confira com o organizador", "high_vibe": "Verificado · {src}",
        "agenda": "Ver a agenda verificada", "pointer": "Para programas numa data específica, veja a agenda verificada.",
        "sugg1": "Ver a agenda completa", "sugg2": "Onde jantar hoje?",
        "time_tbc": "horário a confirmar",
    },
}

_NOUNS: Dict[str, Dict[Optional[str], str]] = {
    "es": {None: "eventos", "concert": "conciertos", "festival": "festivales", "cultural": "eventos culturales",
           "sports": "eventos deportivos", "family": "eventos para familias", "gastronomic": "eventos gastronómicos",
           "nightlife": "eventos nocturnos", "civic": "eventos cívicos"},
    "en": {None: "events", "concert": "concerts", "festival": "festivals", "cultural": "cultural events",
           "sports": "sports events", "family": "family events", "gastronomic": "food events",
           "nightlife": "nightlife events", "civic": "civic events"},
    "fr": {None: "événements", "concert": "concerts", "festival": "festivals", "cultural": "événements culturels",
           "sports": "événements sportifs", "family": "événements en famille", "gastronomic": "événements gastronomiques",
           "nightlife": "soirées", "civic": "événements civiques"},
    "pt": {None: "eventos", "concert": "shows", "festival": "festivais", "cultural": "eventos culturais",
           "sports": "eventos esportivos", "family": "eventos para famílias", "gastronomic": "eventos gastronômicos",
           "nightlife": "eventos noturnos", "civic": "eventos cívicos"},
}

_CAT_LABEL: Dict[str, Dict[str, str]] = {
    "es": {"concert": "Concierto", "festival": "Festival", "cultural": "Cultural", "nightlife": "Noche",
           "gastronomic": "Gastronomía", "sports": "Deporte", "family": "Familia", "civic": "Cívico"},
    "en": {"concert": "Concert", "festival": "Festival", "cultural": "Culture", "nightlife": "Nightlife",
           "gastronomic": "Food", "sports": "Sports", "family": "Family", "civic": "Civic"},
    "fr": {"concert": "Concert", "festival": "Festival", "cultural": "Culture", "nightlife": "Soirée",
           "gastronomic": "Gastronomie", "sports": "Sport", "family": "Famille", "civic": "Civique"},
    "pt": {"concert": "Show", "festival": "Festival", "cultural": "Cultura", "nightlife": "Noite",
           "gastronomic": "Gastronomia", "sports": "Esporte", "family": "Família", "civic": "Cívico"},
}


def _bogota_today(now: Optional[datetime]) -> date:
    return gate.as_utc(now).astimezone(BOGOTA).date()


def _day_label(d: date, lang: str, today: date) -> str:
    mon = _MON_SHORT[lang][d.month - 1]
    s = f"{d.day} {mon}"
    return s if d.year == today.year else f"{s} {d.year}"


def _when_label(row: Mapping[str, Any], lang: str, today: date) -> str:
    """'12 nov, 10:00–12:00' / '9–17 ene 2027' (dates from the row only)."""
    s, e = _ymd(row.get("start_date")), _ymd(row.get("end_date"))
    if s is None:
        return ""
    e = e or s
    if e == s:
        out = _day_label(s, lang, today)
    elif (s.year, s.month) == (e.year, e.month):
        out = f"{s.day}–{_day_label(e, lang, today)}"
    else:
        out = f"{_day_label(s, lang, today)} – {_day_label(e, lang, today)}"
    st, et = _hm(row.get("start_time")), _hm(row.get("end_time"))
    if st:
        out += f", {st}" + (f"–{et}" if et else "")
    return out


def verified_label(last_verified: Any, lang: str) -> Optional[str]:
    dt = gate.parse_iso(last_verified)
    if dt is None:
        return None
    d = dt.astimezone(BOGOTA).date()
    return f"{d.day} {_MON_SHORT[_lang(lang)][d.month - 1]}"


def _range_label(range_key: str, lang: str, today: date) -> str:
    t = _T[lang]
    if range_key.startswith("date:"):
        d = _ymd(range_key[5:])
        if d is not None:
            return t["date"].format(d=_day_label(d, lang, today))
        range_key = "upcoming"
    return t.get(range_key, t["upcoming"])


def _agenda_action(lang: str) -> Dict[str, Any]:
    return {"type": "navigate", "screen": "agenda", "label": _T[lang]["agenda"]}


def _line(row: Mapping[str, Any], lang: str, today: date) -> str:
    when = _when_label(row, lang, today)
    venue = row.get("venue_name") if isinstance(row.get("venue_name"), str) else ""
    parts = [f"• {_title(row, lang)}"]
    if when:
        parts.append(f" — {when}")
    if venue:
        parts.append(f" · {venue}")
    return "".join(parts)


def _lists(high: Sequence[Mapping[str, Any]], verify: Sequence[Mapping[str, Any]], lang: str,
           today: date) -> List[str]:
    t = _T[lang]
    out: List[str] = []
    if high:
        out.append(t["confirmed"])
        out.extend(_line(r, lang, today) for r in high)
    if verify:
        out.append(t["unconfirmed"])
        out.extend(_line(r, lang, today) for r in verify)
    return out


def _tidy(s: str) -> str:
    """'le 20 déc.' + '.' -> one period (never touches an ellipsis)."""
    return re.sub(r"(?<!\.)\.\.(?!\.)", ".", s)


def _payload(message: str, lang: str, *, actions: Optional[List[Dict[str, Any]]] = None,
             recs: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    t = _T[lang]
    return {
        "message": message,
        "language": lang,
        "actions": actions if actions is not None else [_agenda_action(lang)],
        "recommendations": recs or [],
        "suggestions": [t["sugg1"], t["sugg2"]],
    }


# ── intent detection (§9, strict) ────────────────────────────────────────────

_EVENT_NOUN_RE = re.compile(
    r"\b(?:eventos?|events?|evenements?|conciertos?|concerts?|concertos?|gigs?|festivales|festivals?|festivais"
    r"|espectaculos?|spectacles?|espetaculos?|recitales?|recital|carnaval|carnival|desfiles?|parades?|defiles?"
    r"|reinados?|cabildos?|ferias?|obras? de teatro|ficci|ironman|triatlon|triathlon|bando|alborada|novenas?"
    r"|alumbrado navideno|concurso nacional de belleza|senorita colombia)\b"
    r"|\bshows?\b(?!\s+(?:me|us|you|them|him|her|my|your|the|some|all|more|what|where|how)\b)"
    r"|\bfiestas?\s+(?:de\s+(?:la\s+)?)?(?:independencia|noviembre|novembrinas|patronales|patrias|candelaria)\b"
    r"|\bindependence\s+(?:festivities|celebrations?|day|festival|parade)\b"
    r"|\bfetes?\s+de\s+l'?\s*independance\b|\bfestas?\s+da\s+independencia\b"
    r"|(?<!\bmi )(?<!\bmy )(?<!\bma )(?<!\btu )(?<!\bminha )\bagenda\b(?!r)")
_EVENT_PLANNING_RE = re.compile(
    r"\b(?:lugar(?:es)?|sitios?|salon(?:es)?|espacios?|venues?|places?|finca|catering|decoracion|organizar|"
    r"organizo|organizamos|planear|planificar|celebrar|montar|host|hosting|organi[sz]e|throw|reservar)\s+"
    r"(?:(?:para|for|pour|un|una|mi|nuestro|nuestra|el|la|an|a|my|our|the|um|uma|meu|nosso)\s+){0,2}"
    r"(?:eventos?|events?|evenements?|fiestas?|party|parties)\b"
    r"|\beventos?\s+(?:corporativos?|privados?|empresariales?|sociales?)\b|\b(?:corporate|private|company)\s+events?\b"
    r"|\b(?:mi|my|nuestro|our|mon|notre|meu|nosso)\s+(?:evento|event|evenement)\b")
_WHATS_ON_RE = re.compile(
    r"\bque\s+(?:hay|pasa|esta pasando|se mueve)\b"
    r"|\bwhat'?s\s+(?:on|happening|going on)\b|\bwhat\s+is\s+(?:on|happening|going on)\b"
    r"|\banything\s+(?:on|happening|going on)\b"
    r"|\bqu'?est-ce qui se passe\b|\bque se passe-t-il\b|\bquoi de prevu\b|\bqu'?y a-t-il\b|\bqu'?est-ce qu'?il y a\b"
    r"|\bo que\s+(?:tem|ha|acontece|esta rolando|rola|esta acontecendo)\b")
# A "qué hay / qué pasa" that is NOT about what's on: "qué hay para hacer", "qué hay de bueno por
# hacer", "qu'est-ce qu'il y a à faire", "o que tem para fazer", "qué pasa si llueve", "qué pasa con
# el clima". Tested on the text right after the matched phrase.
_WHATS_ON_NEG_RE = re.compile(  # used with .match(t, pos): anchored at pos (no '^')
    r"\s*(?:(?:de bueno|de interesante|interesante|chevere|bonito)\s+)?(?:para|por|pra|a|to)\s+"
    r"(?:hacer|visitar|conocer|fazer|faire|visiter|do|visit)\b"
    r"|\s*(?:si|se|if|s'il|quand)\b"
    r"|\s*(?:con|with|avec|com)\s+(?:el\s+|la\s+|the\s+|le\s+|o\s+|a\s+)?(?:clima|tiempo|weather|meteo|temps|tempo|lluvia|rain)\b")
_WHATS_ON_STRONG_RE = re.compile(
    r"\bwhat'?s\s+(?:on|happening)\b|\bwhat\s+is\s+(?:on|happening)\b|\bquoi de prevu\b"
    r"|\bqu'?est-ce qui se passe\b|\bque se passe-t-il\b")
_TIME_WORD_RE = re.compile(
    r"\b(?:hoy|esta noche|manana|este fin|fin de semana|finde|esta semana|ahora|ahorita|lunes|martes|miercoles|"
    r"jueves|viernes|sabado|domingo|today|tonight|tomorrow|weekend|this week|now|monday|tuesday|wednesday|"
    r"thursday|friday|saturday|sunday|ce soir|aujourd'hui|demain|week-end|cette semaine|lundi|mardi|mercredi|"
    r"jeudi|vendredi|samedi|dimanche|hoje|amanha|fim de semana|agora|segunda|terca|quarta|quinta|sexta)\b")
# (A place alone — "¿qué hay en Cartagena para niños?" — is not a "what's on" time frame.)
_VENUE_INTENT_RE = re.compile(
    r"\b(?:cen(?:a|ar|amos|o)|com(?:er|emos)|almorz(?:ar|amos)|almuerzo|desayun(?:ar|o|amos)|brunch|"
    r"restaurantes?|comida|menu|carta|bar(?:es)?|cafes?|cafeteria|hotel(?:es)?|hostal|playas?|beach|spa|"
    r"masajes?|abiert[oa]s?|open|dinner|lunch|breakfast|eat|food|restaurants?|drinks?|manger|diner|dejeuner|"
    r"jantar|almoco|praia|plage|farmacias?|pharmacy|cajeros?|atm|taxi|lancha|bote|islas?|island)\b")
_WHO_PLAYS_RE = re.compile(
    r"\bquien(?:es)?\s+(?:toca|tocan|canta|cantan|se presenta|se presentan|viene|vienen|actua|actuan)\b"
    r"|\bwho'?s?\s+(?:is\s+)?(?:playing|performing|singing|headlining)\b"
    r"|\bqui\s+(?:joue|chante|se produit)\b|\bquem\s+(?:toca|canta|se apresenta|vem)\b")
_ARTIST_VERB = (r"(?:viene|vienen|vendra|vendran|toca|tocan|tocara|tocaran|canta|cantan|cantara|cantaran|"
                r"se presenta|se presentan|se presentara|se presentaran|llega|llegan|actua|actuan|is coming|"
                r"are coming|comes|plays|is playing|will play|performs|is performing|will perform|vient|viennent|"
                r"viendra|joue|jouent|chante|chantent|se produit|vem|vai tocar|vai cantar|se apresenta)")
_AFTER_NAME_VERB = (rf"(?:{_ARTIST_VERB}|coming|playing|performing|singing|touring|headlining|"
                    r"se presentara|va a tocar|va a cantar|vai se apresentar)")
_AFTER_NAME_VERB_RE = re.compile(
    rf"\s+(?:(?:cuando|when|quand|quando|donde|where|ou)\s+)?{_AFTER_NAME_VERB}\b"
    r"(?!\s+(?:con|conmigo|contigo|incluid[oa]s?|with|included|avec|com|incluso)\b)")
# "karol g viene a cartagena?" (no capitals): a performer verb + "a/en/to Cartagena", subject 1–3
# words with no article / possessive in front ("el crucero viene a …", "mi novia viene a …").
_ARRIVE_CTG_RE = re.compile(
    r"(?:^|[¿?¡!.,;:]\s*)((?:[a-z0-9'&.-]+\s+){1,3}?)"
    r"(?:viene|vienen|vendra|vendran|toca|tocan|canta|cantan|se presenta|se presentan|is coming|coming|"
    r"playing|performing|vient|viendra|vem|vai tocar)\s+(?:a|en|to|in|em|para)\s+cartagena\b")
_ARTICLE_OR_POSSESSIVE = frozenset("el la los las un una unos unas mi mis tu tus su sus nuestro nuestra the a an my "
                                   "your our his her their le les un une mon ma mes o os um uma meu minha".split())
# "Mi novia Laura llega mañana", "My sister Anna comes tomorrow": a named relative/friend, not an artist.
_KIN_BEFORE_RE = re.compile(
    r"\b(?:novi[oa]s?|amig[oa]s?|espos[oa]s?|herman[oa]s?|hij[oa]s?|prim[oa]s?|tia|tio|mama|papa|madre|padre|"
    r"suegr[oa]|jefe|jefa|colega|sister|brother|wife|husband|friends?|girlfriend|boyfriend|partner|mom|mum|dad|"
    r"mother|father|son|daughter|cousin|aunt|uncle|boss|colleague|namorad[oa]|irma|irmao|filh[oa]|femme|mari|"
    r"amie?s?|soeur|frere|copine|copain|fils|fille)\s*,?\s*$")
_VERB_THEN_NAME_RE = re.compile(rf"\b{_ARTIST_VERB}\s+(?:a\s+|al\s+|en\s+)?")
_NEAR_RE = re.compile(
    r"\bcerca de mi\b(?!\s+(?:hotel|casa|apartamento|apto|airbnb|hostal|hostel|crucero|barco|oficina|trabajo))"
    r"|\bcerca de aqui\b|\bpor aqui cerca\b|\baqui cerca\b|\bcerquita\b|\bcerca\s*[?!.]*$"
    r"|\bnear me\b|\bnearby\b|\bclose to me\b|\bclose by\b|\baround me\b|\baround here\b"
    r"|\bpres de moi\b|\ba proximite\b|\bautour de moi\b|\bperto de mim\b|\bperto daqui\b|\bpor perto\b|\baqui perto\b")

_CATEGORY_RULES: Tuple[Tuple[str, "re.Pattern[str]"], ...] = (
    ("concert", re.compile(r"\b(?:conciertos?|concerts?|concertos?|gigs?|recitales?|recital)\b")),
    ("sports", re.compile(r"\b(?:deportes?|deportiv[oa]s?|sports?|sportifs?|esportiv[oa]s?|maraton|marathon|"
                          r"triatlon|triathlon|ironman|regatas?)\b")),
    ("family", re.compile(r"\b(?:para ninos|para ninas|con ninos|kids|for kids|children|family|familiar(?:es)?|"
                          r"familias|pour enfants|en famille|para criancas|com criancas|infantil(?:es)?)\b")),
    ("gastronomic", re.compile(r"\b(?:gastronomic[oa]s?|gastronomy|food festival|gastronomiques?)\b")),
    ("cultural", re.compile(r"\b(?:culturales?|cultural|culturels?|culturais|teatro|theatre|theater|danza|opera|"
                            r"cine|film|filme|cinema|literatura|literary|poesia)\b")),
    ("festival", re.compile(r"\b(?:festival(?:es|s)?|festivais)\b")),
)

# Range words (folded).
_TONIGHT_RE = re.compile(r"\b(?:esta noche|hoy en la noche|hoy por la noche|tonight|this evening|ce soir|"
                         r"hoje a noite|hoje de noite|esta noite)\b")
_AFTER_TOMORROW_RE = re.compile(r"\bpasado manana\b|\bapres-demain\b|\bdepois de amanha\b|\bday after tomorrow\b")
_TOMORROW_RE = re.compile(r"\b(?:tomorrow|demain|amanha)\b")
_MANANA_RE = re.compile(r"\bmanana\b")
_TODAY_RE = re.compile(r"\b(?:hoy|today|aujourd'hui|aujourd hui|hoje|ahora|ahorita|right now|now|maintenant|agora|"
                       r"en este momento|esta manana|esta tarde|this morning|this afternoon|cet apres-midi)\b")
_WEEKEND_RE = re.compile(r"\b(?:este fin(?: de semana)?|el fin(?: de semana)?|fin de semana|finde|this weekend|"
                         r"the weekend|weekend|ce week-end|ce weekend|le week-end|week-end|este fim de semana|"
                         r"fim de semana)\b")
_WEEK_RE = re.compile(r"\b(?:esta semana|estos dias|proximos dias|this week|next few days|coming days|"
                      r"cette semaine|ces jours-ci|prochains jours|nos proximos dias)\b")

_ENTITY_CONNECT = frozenset({"de", "del", "la", "las", "los", "y", "and", "da", "do", "dos", "das", "e"})
_ENTITY_STOP = frozenset("""
que quien quienes cual cuales cuando donde como cuanto cuanta por para porque hay hola holi buenas buenos buen
dias tardes noches hi hello hey yo tu usted ustedes el la los las lo un una unos unas y o e a en de del al con sin
si no me mi mis te se nos le les su sus este esta estos estas ese esa eso esto aqui alla alli ahi algun alguno
alguna algo nada todo toda todos todas otro otra muy mas ya tambien pero sabes puedes podrias quiero quisiera
necesito busco recomienda recomiendame dime ayuda gracias luna amo ok okay vale bueno bien genial perfecto claro
hoy manana ayer ahora viene vienen toca tocan canta cantan llega llegan tonight today tomorrow what whats when
where who whom which why how is are was were will would can could should do does did any anything some
something the an and or of in on at to for with i im my we our you your it its there this that these those
please thanks thank bonjour salut merci quoi quel quelle quels quelles qui quand ou comment est ce cette il elle
je nous vous les des une au aux ola oi obrigado obrigada voce eu tem onde quando quem qual os as um uma isso
isto esse essa hoje amanha lunes martes miercoles jueves viernes sabado domingo monday tuesday wednesday
thursday friday saturday sunday lundi mardi mercredi jeudi vendredi samedi dimanche segunda terca quarta quinta
sexta enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre january february
march april may june july august september october november december janvier fevrier mars avril mai juin
juillet aout septembre octobre novembre decembre janeiro fevereiro maio junho julho setembro outubro novembro
dezembro evento eventos event events concierto conciertos concert concerts festival festivales festivals fiesta
fiestas show shows agenda desfile feria carnaval gig gigs espectaculo spectacle cartagena colombia indias bogota
medellin barranquilla getsemani centro historico bocagrande manga castillogrande laguito san diego crespo baru
rosario islas isla tierra bomba playa blanca ciudad amurallada caribe hotel restaurante restaurant bar cafe casa
club plaza parque museo teatro iglesia castillo muelle tour spa amo life app
""".split())
_NAME_RUN_RE = re.compile(
    r"(?<![\w])[A-ZÁÉÍÓÚÑÜÇÀÂÊÔÃÕ][\w'’.&-]*"
    r"(?:\s+(?:(?:de|del|la|las|los|y|and|&|da|do|dos|das)\s+)?[A-ZÁÉÍÓÚÑÜÇÀÂÊÔÃÕ][\w'’.&-]*)*")


def _entity_from_run(run: str) -> Optional[str]:
    toks = [_alnum(fold_keep(t)) for t in run.split()]
    i, j = 0, len(toks)
    while i < j and (not toks[i] or toks[i] in _ENTITY_STOP or toks[i] in _ENTITY_CONNECT):
        i += 1
    while j > i and (not toks[j - 1] or toks[j - 1] in _ENTITY_STOP or toks[j - 1] in _ENTITY_CONNECT):
        j -= 1
    core = [t for t in toks[i:j] if t]
    if not core or not any(len(t) >= 3 and t not in _ENTITY_STOP for t in core):
        return None
    return " ".join(core)


def query_entities(user_text: Any) -> List[str]:
    """Proper names the user asked about ('Karol G', 'Juan Luis Guerra'), folded. Leading /
    trailing function words, places, months and event nouns are stripped."""
    raw = user_text if isinstance(user_text, str) else ""
    out: List[str] = []
    for m in _NAME_RUN_RE.finditer(raw):
        ent = _entity_from_run(m.group(0))
        if ent and ent not in out:
            out.append(ent)
    # typed without capitals: "karol g viene a cartagena?"
    for m in _ARRIVE_CTG_RE.finditer(fold_keep(raw)):
        subj = m.group(1).split()
        if not subj or subj[0] in _ARTICLE_OR_POSSESSIVE or _KIN_BEFORE_RE.search(" ".join(subj)):
            continue
        ent = _entity_from_run(" ".join(subj))
        if ent and ent not in out:
            out.append(ent)
    return out


def _artist_question(raw: str, folded: str) -> bool:
    """'¿Karol G viene?', '¿Cuándo toca Juan Luis Guerra?', '¿Quién toca hoy?', 'Is Karol G
    coming?', '¿Juan Luis Guerra cuándo toca?', 'karol g viene a cartagena?'. A name preceded by
    a relative/friend word ('mi novia Laura llega mañana') is a person, not a performer."""
    if _WHO_PLAYS_RE.search(folded):
        return True
    for m in _NAME_RUN_RE.finditer(raw):
        if not _entity_from_run(m.group(0)):
            continue
        if _KIN_BEFORE_RE.search(folded[:m.start()]):
            continue
        if _AFTER_NAME_VERB_RE.match(folded, m.end()):
            return True
    for m in _VERB_THEN_NAME_RE.finditer(folded):
        nm = _NAME_RUN_RE.match(raw, m.end())
        if nm and _entity_from_run(nm.group(0)):
            return True
    for m in _ARRIVE_CTG_RE.finditer(folded):
        subj = m.group(1).split()
        if subj and subj[0] not in _ARTICLE_OR_POSSESSIVE and not _KIN_BEFORE_RE.search(" ".join(subj)) \
                and any(w not in _ENTITY_STOP for w in subj):
            return True
    return False


def _whats_on(t: str) -> bool:
    """A 'qué hay / qué pasa / what's on' phrase that is not '… para hacer', '… si llueve'."""
    return any(not _WHATS_ON_NEG_RE.match(t, m.end()) for m in _WHATS_ON_RE.finditer(t))


def _next_weekday(today: date, wd: int) -> date:
    return today + timedelta(days=(wd - today.weekday()) % 7)


def _explicit_date(t: str, lang: str, today: date) -> Optional[date]:
    res = _date_res(lang)
    months = _month_map(lang)
    found: List[Tuple[int, int, int, Optional[int]]] = []  # (pos, month, day, year)
    for key in ("range_d", "d_m"):
        for m in res[key].finditer(t):
            mo = months[m.group(3) if key == "range_d" else m.group(2)]
            found.append((m.start(), mo, int(m.group(1)), None))
    for key in ("range_m", "m_d"):
        for m in res[key].finditer(t):
            found.append((m.start(), months[m.group(1)], int(m.group(2)), None))
    for m in res["iso"].finditer(t):
        found.append((m.start(), int(m.group(2)), int(m.group(3)), int(m.group(1))))
    for m in res["num"].finditer(t):
        y = m.group(3)
        yy = (int(y) + 2000 if len(y) == 2 else int(y)) if y else None
        found.append((m.start(), int(m.group(2)), int(m.group(1)), yy))  # LATAM dd/mm
    for _pos, mo, d, y in sorted(found):
        if y is not None:
            cand = _mk_date(y, mo, d)
        else:
            cand = _mk_date(today.year, mo, d)
            if cand is not None and cand < today:
                cand = _mk_date(today.year + 1, mo, d)
        if cand is not None:
            return cand
    return None


def _tomorrow_hit(t: str) -> bool:
    if _TOMORROW_RE.search(t):
        return True
    for m in _MANANA_RE.finditer(t):
        before = t[max(0, m.start() - 8):m.start()]
        if not re.search(r"(?:\bla|\bpor la|\bde la|\ben la|\besta|\bcada|\blas)\s$", before):
            return True
    return False


def _detect_range(t: str, lang: str, today: date) -> str:
    d = _explicit_date(t, lang, today)
    if d is not None:
        return f"date:{d.isoformat()}"
    if _TONIGHT_RE.search(t):
        return "tonight"
    if _AFTER_TOMORROW_RE.search(t):
        return f"date:{(today + timedelta(days=2)).isoformat()}"
    if _tomorrow_hit(t):
        return f"date:{(today + timedelta(days=1)).isoformat()}"
    if _WEEKEND_RE.search(t):
        return "weekend"
    wm = _date_res(lang)["wd"].search(t)
    if wm:
        return f"date:{_next_weekday(today, _weekday_map(lang)[wm.group(1)]).isoformat()}"
    if _TODAY_RE.search(t):
        return "today"
    if _WEEK_RE.search(t):
        return "week"
    return "upcoming"


def _detect_category(t: str) -> Optional[str]:
    for cat, rx in _CATEGORY_RULES:
        if rx.search(t):
            return cat
    return None


def detect_event_intent(text: Any, lang: Any = "es", *, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Strict event-question detector (§9). An event noun, a 'what's on <when>' phrase, or an
    artist-at-a-date question fires it. Venue questions that merely carry a time ('dónde cenar
    hoy', 'restaurante abierto esta noche') do not."""
    lg = _lang(lang)
    raw = text if isinstance(text, str) else ""
    t = fold_keep(raw)
    out: Dict[str, Any] = {"is_event": False, "range": "upcoming", "near": False, "category": None}
    if not t.strip():
        return out
    today = _bogota_today(now)
    planning = bool(_EVENT_PLANNING_RE.search(t))
    venue = bool(_VENUE_INTENT_RE.search(t))
    noun = bool(_EVENT_NOUN_RE.search(t)) and not planning
    whats_on = _whats_on(t) and not venue and not planning and (
        bool(_WHATS_ON_STRONG_RE.search(t)) or bool(_TIME_WORD_RE.search(t))
        or _explicit_date(t, lg, today) is not None)
    artist = (not venue) and (not planning) and _artist_question(raw, t)
    if not (noun or whats_on or artist):
        return out
    out["is_event"] = True
    out["range"] = _detect_range(t, lg, today)
    out["near"] = bool(_NEAR_RE.search(t))
    out["category"] = _detect_category(t)
    return out


# ── reads ────────────────────────────────────────────────────────────────────


def _finite(v: Any) -> Optional[float]:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        f = float(v)
    elif isinstance(v, str) and v.strip():
        try:
            f = float(v.strip())
        except ValueError:
            return None
    else:
        return None
    return f if math.isfinite(f) else None


def clean_location(location: Any) -> Optional[Tuple[float, float]]:
    """{lat, lng} from the request body -> (lat, lng) or None. Never logged, never stored."""
    if not isinstance(location, Mapping):
        return None
    lat, lng = _finite(location.get("lat")), _finite(location.get("lng"))
    if lat is None or lng is None or not (-90.0 <= lat <= 90.0) or not (-180.0 <= lng <= 180.0):
        return None
    if lat == 0.0 and lng == 0.0:
        return None
    return lat, lng


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def _window(range_key: str, today: date) -> Optional[Tuple[date, date, bool, bool]]:
    """(start, end, tonight, exclude_umbrella) or None for 'upcoming'."""
    if range_key == "today":
        return today, today, False, True
    if range_key == "tonight":
        return today, today, True, True
    if range_key == "weekend":
        wd = today.weekday()
        if wd >= 4:
            return today, today + timedelta(days=6 - wd), False, True
        start = today + timedelta(days=4 - wd)
        return start, start + timedelta(days=2), False, True
    if range_key == "week":
        return today, today + timedelta(days=6), False, False
    if range_key.startswith("date:"):
        d = _ymd(range_key[5:])
        if d is not None:
            return d, d, False, False
    return None


def _in_window(row: Mapping[str, Any], win: Optional[Tuple[date, date, bool, bool]]) -> bool:
    if win is None:
        return True
    ws, we, tonight, no_umbrella = win
    if no_umbrella and row.get("is_umbrella"):
        return False
    s = _ymd(row.get("start_date"))
    if s is None:
        return False
    e = _ymd(row.get("end_date")) or s
    if s > we or e < ws:
        return False
    if tonight and s == e:
        st, et = _hm(row.get("start_time")), _hm(row.get("end_time"))
        if st and st < TONIGHT_FROM and (et is None or et <= TONIGHT_FROM):
            return False  # a daytime-only event is not "tonight"
    return True


_QUERY_STOP = _ENTITY_STOP | frozenset({"cuando", "donde", "tienes", "tiene", "sobre", "algun", "alguna", "evento",
                                        "fecha", "fechas", "date", "dates", "gran", "grande"})
_QUERY_WEAK = frozenset({"festival", "festivales", "concierto", "conciertos", "desfile", "desfiles", "fiesta",
                         "fiestas", "feria", "carnaval", "cabildo", "reinado", "show", "shows", "concert", "concerts"})


def _title_match(row: Mapping[str, Any], q_folded: str, q_tokens: Set[str]) -> bool:
    for title in _titles_all(row):
        short = _short_title(title)
        if len(short) >= 5 and re.search(rf"\b{re.escape(short)}\b", q_folded):
            return True
        ttoks = set(_norm_words(title).split())
        strong = {tk for tk in q_tokens & ttoks if tk not in _QUERY_WEAK}
        if strong:
            return True
    return False


async def get_confirmed_events(
    db: Any,
    range_key: str = "upcoming",
    near: Optional[Any] = None,
    category: Optional[str] = None,
    limit: int = 8,
    *,
    query: Optional[str] = None,
    now: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    """Published HIGH + VERIFY PublicEvents for a range (§9): the SAME read-time gate as the
    feed (events_runtime.public_rows -> events_gate.public_view). Umbrellas are excluded from
    today/tonight/weekend (§15 R5). `near` = (lat, lng) or {lat, lng}: keep ≤ 3 km, sort by
    distance. `query` (the user's words) floats title matches ('Hay Festival') to the front;
    otherwise rows sort by prominence desc, then date (§16.1). Any error -> [] (fail closed)."""
    try:
        now_utc = gate.as_utc(now)
        rows = await runtime.public_rows(db, statuses=("published",), min_confidence="VERIFY", limit=400, now=now_utc)
    except Exception as exc:  # noqa: BLE001 — a failed read is "no confirmed events", never stale data
        logger.error("[luna_events] public_rows failed: %s", type(exc).__name__)
        return []
    try:
        today = _bogota_today(now_utc)
        win = _window(range_key or "upcoming", today)
        out = [dict(r) for r in rows
               if r.get("status") == "published" and r.get("confidence") in ("HIGH", "VERIFY")
               and r.get("event_id") and _in_window(r, win)]
        q_folded = fold_keep(query or "")
        q_tokens = {w for w in _norm_words(query or "").split() if len(w) >= 4 and w not in _QUERY_STOP}
        matched = {r["event_id"] for r in out if (q_tokens or q_folded) and _title_match(r, q_folded, q_tokens)}
        if category:
            group = CATEGORY_GROUPS.get(category, (category,))
            out = [r for r in out if r["event_id"] in matched or r.get("category") in group]
        loc = near if isinstance(near, tuple) else clean_location(near)
        if near is not None and loc is not None:
            kept: List[Dict[str, Any]] = []
            for r in out:
                la, ln = _finite(r.get("lat")), _finite(r.get("lng"))
                if la is None or ln is None:
                    continue
                dist = haversine_m(loc[0], loc[1], la, ln)
                if dist <= NEAR_RADIUS_M:
                    r["distance_m"] = int(round(dist))
                    kept.append(r)
            kept.sort(key=lambda r: r["distance_m"])
            return kept[: max(0, int(limit))]
        if near is not None and loc is None:
            return []  # proximity asked with an unusable location: never fall back to "near" guesses
        # A title the user named first, then the asked category, then §16.1: prominence desc, then
        # date (nulls last) — so the city's top events lead every range, not the recurring ones.
        out.sort(key=lambda r: (0 if r["event_id"] in matched else 1,
                                0 if (category and r.get("category") == category) else 1,
                                *gate.prominence_sort_key(r)))
        return out[: max(0, int(limit))]
    except Exception as exc:  # noqa: BLE001
        logger.error("[luna_events] get_confirmed_events filter failed: %s", type(exc).__name__)
        return []


def _split(rows: Sequence[Mapping[str, Any]], n: int = 3) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    high = [dict(r) for r in rows if _is_high(r)][:n]
    verify = [dict(r) for r in rows if not _is_high(r)][:n]
    return high, verify


# ── deterministic payloads ───────────────────────────────────────────────────


def decline_payload(
    lang: Any,
    confirmed_top: Sequence[Mapping[str, Any]],
    verify_rows: Sequence[Mapping[str, Any]],
    kind: str = "no_events",
    *,
    range_key: str = "upcoming",
    near: bool = False,
    category: Optional[str] = None,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Deterministic decline, no LLM (§9, §15 V1/V4). 'Confirmado:' lists up to 3 HIGH rows,
    'Sin confirmar:' up to 3 VERIFY rows, each cited. Action: navigate → agenda (§13 I2)."""
    lg = _lang(lang)
    t = _T[lg]
    today = _bogota_today(now)
    high = [dict(r) for r in confirmed_top if _is_high(r)][:3]
    verify = [dict(r) for r in verify_rows if not _is_high(r)][:3]
    if kind == "maintenance":
        return _payload(t["maintenance"], lg)
    parts: List[str] = []
    if kind == "no_location":
        parts.append(t["no_location"])
    else:
        noun = _NOUNS[lg].get(category, _NOUNS[lg][None])
        de = ""
        if lg == "fr":
            de = "d'" if fold_keep(noun[:1]) in "aeiouh" else "de "
        parts.append(_tidy(t["no_events"].format(noun=noun, near=t["near"] if near else "", de=de,
                                                 range=_range_label(range_key, lg, today))))
    if high or verify:
        parts.append(t["offer"])
        body = "\n".join([" ".join(parts)] + _lists(high, verify, lg, today))
    else:
        parts.append(t["nothing"])
        body = " ".join(parts)
    body = citation_footer(body, [], [], high + verify, lg)
    return _payload(body, lg)


def grounded_message(rows: Sequence[Mapping[str, Any]], lang: Any, range_key: str = "upcoming", *,
                     replaced: bool = False, now: Optional[datetime] = None) -> str:
    """The deterministic grounded-list template (§15 V2). Every date, time and venue in it
    comes from the rows themselves."""
    lg = _lang(lang)
    t = _T[lg]
    today = _bogota_today(now)
    high = [dict(r) for r in rows if _is_high(r)][:5]
    verify = [dict(r) for r in rows if not _is_high(r)][:3]
    lead = t["replaced"] if replaced else t["grounded"].format(range=_range_label(range_key, lg, today))
    if not (high or verify):
        return f"{lead} {t['nothing']}" if not replaced else f"{t['replaced'].split('.')[0]}. {t['nothing']}"
    return "\n".join([lead] + _lists(high, verify, lg, today))


def event_card(row: Mapping[str, Any], lang: Any, *, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Recommendation card for an injected row, built ONLY from the row (the LLM's free text
    for name/vibe/reason is discarded, so a card can never carry an invented date)."""
    lg = _lang(lang)
    t = _T[lg]
    today = _bogota_today(now)
    src = _source_name(row)
    return {
        "kind": "event",
        "event_id": row.get("event_id"),
        "name": _title(row, lg)[:80],
        "type": _CAT_LABEL[lg].get(str(row.get("category")), "")[:60],
        "vibe": (t["high_vibe"].format(src=src) if _is_high(row) else t["verify_vibe"])[:120],
        "price_range": "",
        "address": (row.get("venue_name") or "")[:100] if isinstance(row.get("venue_name"), str) else "",
        "reason": _when_label(row, lg, today)[:160],
        "confidence": row.get("confidence"),
        "source_name": src,
    }


def openable_everywhere(row: Mapping[str, Any]) -> bool:
    """Can EVERY client open this row's card? 1.1.0 / 1.1.1 and the live web open a card through
    the legacy /events/{id}, which serves only published, HIGH, non-umbrella rows (§15 T1 / R5);
    anything else lands on 'Evento no encontrado'. Such rows stay in the message text (with the
    hedge / the date range) but never become a card or an open_event action."""
    return _is_high(row) and row.get("status", "published") == "published" and not row.get("is_umbrella")


def grounded_payload(rows: Sequence[Mapping[str, Any]], lang: Any, range_key: str = "upcoming", *,
                     now: Optional[datetime] = None) -> Dict[str, Any]:
    """No-LLM answer for an event question that HAS rows (LLM failure, or callers such as
    /search that want a deterministic answer, §13 D4). Cards only for rows every client
    (incl. 1.1.x legacy /events/{id}) can open: published, HIGH, not an umbrella."""
    lg = _lang(lang)
    msg = grounded_message(rows, lg, range_key, now=now)
    high, verify = [r for r in rows if _is_high(r)][:5], [r for r in rows if not _is_high(r)][:3]
    msg = citation_footer(msg, [], [], list(high) + list(verify), lg)
    cards = [event_card(r, lg, now=now) for r in high if openable_everywhere(r)]
    return _payload(msg, lg, recs=cards)


def context_rows(rows: Sequence[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    """What the LLM sees: structured fields only, never descriptions (§15 S4)."""
    out: List[Dict[str, Any]] = []
    for r in rows:
        raw_price = r.get("price")
        price: Mapping[str, Any] = raw_price if isinstance(raw_price, Mapping) else {}
        item: Dict[str, Any] = {
            "event_id": r.get("event_id"),
            "title": r.get("title"),
            "category": r.get("category"),
            "start_date": r.get("start_date"),
            "end_date": r.get("end_date"),
            "start_time": r.get("start_time"),
            "end_time": r.get("end_time"),
            "venue_name": r.get("venue_name"),
            "zone": r.get("zone"),
            "is_free": price.get("is_free") is True,
            "price_min_cop": price.get("min_cop"),
            "ticket_url": r.get("ticket_url"),
            "source_name": _source_name(r),
            "source_url": r.get("source_url"),
            "verified": verified_label(r.get("last_verified"), "es"),
            "confidence": r.get("confidence"),
            "sold_out": bool(r.get("sold_out")),
            "is_umbrella": bool(r.get("is_umbrella")),
            "parent_id": r.get("parent_id"),
            "distance_m": r.get("distance_m"),
        }
        out.append({k: v for k, v in item.items() if v is not None and v != "" and v is not False
                    or k in ("confidence", "start_time")})
    return out


async def event_gate(
    db: Any,
    intent: Mapping[str, Any],
    *,
    lang: Any,
    location: Any = None,
    query: Optional[str] = None,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """§15 V1 hook for an event question:
      flags.enabled false               -> maintenance decline (no LLM)
      'cerca de mí' without a location  -> proximity decline + the city-wide list (§13 I3)
      no rows for the range             -> no-events decline + what IS confirmed (no LLM)
      rows                              -> {'payload': None, 'rows': rows} (inject them)
    Returns {'payload': dict | None, 'rows': [PublicEvent]}. Never raises."""
    lg = _lang(lang)
    rng = str(intent.get("range") or "upcoming")
    cat = intent.get("category") if isinstance(intent.get("category"), str) else None
    near = bool(intent.get("near"))
    try:
        flags = await runtime.get_flags(db)
    except Exception as exc:  # noqa: BLE001
        logger.error("[luna_events] get_flags failed: %s", type(exc).__name__)
        flags = {"enabled": False}
    if not flags.get("enabled"):
        return {"payload": decline_payload(lg, [], [], kind="maintenance", range_key=rng, now=now), "rows": []}

    loc = clean_location(location)
    if near and loc is None:
        city = await get_confirmed_events(db, rng, None, cat, 8, query=query, now=now)
        city_offer = city or await get_confirmed_events(db, "upcoming", None, None, 8, query=query, now=now)
        high, verify = _split(city_offer)
        return {"payload": decline_payload(lg, high, verify, kind="no_location", range_key=rng,
                                           category=cat, now=now), "rows": []}

    rows = await get_confirmed_events(db, rng, loc if near else None, cat, 8, query=query, now=now)
    if rows:
        return {"payload": None, "rows": rows}
    offer: List[Dict[str, Any]] = []
    if near:
        offer = await get_confirmed_events(db, rng, None, cat, 8, query=query, now=now)
    if not offer:
        offer = await get_confirmed_events(db, "upcoming", None, None, 8, query=query, now=now)
    high, verify = _split(offer)
    return {"payload": decline_payload(lg, high, verify, kind="no_events", range_key=rng, near=near,
                                       category=cat, now=now), "rows": []}


# ── post-LLM guards ──────────────────────────────────────────────────────────


def sanitize(
    recs: Sequence[Any],
    actions: Sequence[Any],
    injected_rows: Sequence[Mapping[str, Any]],
    *,
    lang: Any = "es",
    allowed_urls: Iterable[str] = (),
    now: Optional[datetime] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """§9 sanitizer. Event cards and open_event actions survive only for injected ids whose row
    every client can open (openable_everywhere: published, HIGH, not an umbrella — event cards
    are rebuilt from the row); external_link survives only for an injected row's ticket/source
    URL (or an explicitly allowed official URL). Partner cards pass through."""
    by_id: Dict[str, Mapping[str, Any]] = {str(r["event_id"]): r for r in injected_rows if r.get("event_id")}
    urls: Set[str] = set()
    for r in injected_rows:
        for u in (r.get("ticket_url"), r.get("source_url")):
            if gate.is_http_url(u):
                urls.add(str(u).strip())
    urls.update(str(u).strip() for u in allowed_urls if gate.is_http_url(u))

    out_recs: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    for rec in recs or []:
        if not isinstance(rec, Mapping):
            continue
        eid = rec.get("event_id")
        is_event = rec.get("kind") == "event" or (bool(eid) and not rec.get("partner_id"))
        if not is_event:
            out_recs.append(dict(rec))
            continue
        row = by_id.get(eid) if isinstance(eid, str) else None
        if row is None or eid in seen or not openable_everywhere(row):
            continue
        seen.add(str(eid))
        out_recs.append(event_card(row, lang, now=now))

    out_actions: List[Dict[str, Any]] = []
    for a in actions or []:
        if not isinstance(a, Mapping):
            continue
        typ = a.get("type")
        if typ == "open_event" and (a.get("event_id") not in by_id or not openable_everywhere(by_id[a["event_id"]])):
            continue
        if typ == "external_link":
            u = a.get("url")
            if not isinstance(u, str) or u.strip() not in urls:
                continue
        out_actions.append(dict(a))
    return out_recs, out_actions


_GUARD_EVENT_RE = re.compile(
    r"\b(?:conciertos?|concerts?|concertos?|festival(?:es|s)?|festivais|eventos?|events?|evenements?"
    r"|fiestas?|presentacion(?:es)?|se presenta(?:n|ra|ran)?|gigs?|spectacles?|espetaculos?|espectaculos?"
    r"|desfiles?|parades?|defiles?|carnaval|reinados?|cabildos?|bando|alborada"
    r"|plays|performs|performing|headlines|headlining|joue(?:nt|ra)?|se produit|se apresenta(?:m|ra)?)\b"
    r"|\bshows?\b(?!\s+(?:me|us|you|them|him|her)\b)"
    r"|(?<!\bte )(?<!\ble )(?<!\bme )(?<!\bnos )(?<!\bles )\btoca(?:n|ra|ran)?\b")

# Idiomatic predicate uses on venue answers are not event claims: "…y es todo un show", "la terraza
# es una fiesta", "c'est un vrai spectacle dans l'assiette", "a cozinha é um espetáculo à parte",
# "it's quite a show", "ir de fiesta".
_IDIOM_FILLER = (r"(?:(?:todo|toda|tout|toute|quite|such|un|une|una|uno|uma|um|a|an|la|el|le|the|o|vrai|vraie|real|"
                 r"puro|pura|"
                 r"verdadera|verdadero|verdadeiro|gran|grande|great|big|total|autentico|autentica|true)\s+){0,3}")
_IDIOM_RE = re.compile(
    rf"(?:\b(?:es|is|e|son|are|sera|fue|was|est|era)\s+|c'est\s+|'s\s+){_IDIOM_FILLER}"
    r"(?:show|fiesta|party|spectacle|espetaculo|espectaculo)\b"
    r"|\bde fiesta\b|\bespetaculo a parte\b")

# Relative day words as DATE tokens (§15 V2 + verifier): "esta noche hay concierto de X" is a dated
# claim like any other. Resolved against today (Bogotá) and grounded only by a row on that day.
_REL_TODAY_RE = re.compile(
    r"\b(?:hoy|esta noche|hoy en la noche|hoy por la noche|tonight|today|this evening|ce soir|aujourd'hui|"
    r"aujourd hui|hoje|esta noite|hoje a noite|hoje de noite|esta tarde|this afternoon|cet apres-midi|"
    r"ahora mismo|right now|en este momento|en ce moment|neste momento)\b")
_NAME_GENERIC_WORDS = frozenset("""
independence independencia independance independencia parade desfile defile desfile music musica musique
film cine cinema jazz salsa night noche nuit noite grand gran great big festival fest fair feria national nacional
international internacional day dia jour week semana opening closing inauguration inauguracion gala awards premios
ceremony ceremonia beach old city walled amurallada historic center centre stadium estadio arena theater theatre
bay bahia port puerto castle square park market mercado church cathedral catedral museum island islands orquesta
orchestra sinfonica symphony philharmonic band banda
""".split())


def _relative_tokens(t: str, today: date, skip: Sequence[Tuple[int, int]] = ()) -> List[_Tok]:
    toks: List[_Tok] = []
    taken: List[Tuple[int, int]] = list(skip)

    def add(m: "re.Match[str]", days: Set[date]) -> None:
        span = (m.start(), m.end())
        if _overlaps(span, taken):
            return
        taken.append(span)
        toks.append(_Tok(span[0], span[1], "days", days=days))

    for m in _AFTER_TOMORROW_RE.finditer(t):
        add(m, {today + timedelta(days=2)})
    for m in _REL_TODAY_RE.finditer(t):
        add(m, {today})
    for m in _TOMORROW_RE.finditer(t):
        add(m, {today + timedelta(days=1)})
    for m in _MANANA_RE.finditer(t):
        before = t[max(0, m.start() - 8):m.start()]
        if not re.search(r"(?:\bla|\bpor la|\bde la|\ben la|\besta|\bcada|\blas)\s$", before):
            add(m, {today + timedelta(days=1)})
    win = _window("weekend", today)
    if win is not None:
        wk = {win[0] + timedelta(days=i) for i in range((win[1] - win[0]).days + 1)}
        for m in _WEEKEND_RE.finditer(t):
            add(m, wk)
    return toks


def _month_tokens(t: str, skip: Sequence[Tuple[int, int]]) -> List[_Tok]:
    out: List[_Tok] = []
    for m in _MONTH_ALONE_RE.finditer(t):
        span = (m.start(), m.end())
        if _overlaps(span, skip):
            continue
        mo = _MONTH_FULL.get(m.group(1))
        if mo:
            out.append(_Tok(span[0], span[1], "month", months={mo}))
    return out


class _Ground:
    """What the injected rows (plus venue-published times) can ground. An umbrella or any row
    spanning more than 3 days grounds ONLY its own first and last day: 'Fiestas 2 oct – 15 nov'
    must never make every date (and every weekday) in six weeks look sourced. Months are coarse:
    every month a row touches."""
    __slots__ = ("days", "md", "dom", "wd", "times", "months")

    def __init__(self, rows: Sequence[Mapping[str, Any]], extra_times: Iterable[Any]) -> None:
        days: Set[date] = set()
        months: Set[int] = set()
        for r in rows:
            s = _ymd(r.get("start_date"))
            if s is None:
                continue
            e = _ymd(r.get("end_date")) or s
            if e < s:
                e = s
            span = (e - s).days
            if span <= 3 and not r.get("is_umbrella"):
                days.update(s + timedelta(days=i) for i in range(span + 1))
            else:
                days.update({s, e})
            y, mo = s.year, s.month
            while (y, mo) <= (e.year, e.month):
                months.add(mo)
                y, mo = (y + 1, 1) if mo == 12 else (y, mo + 1)
            lv = gate.parse_iso(r.get("last_verified"))
            if lv is not None:
                days.add(lv.astimezone(BOGOTA).date())
        self.days = days
        self.months = months
        self.md = {(d.month, d.day) for d in days}
        self.dom = {d.day for d in days}
        self.wd = {d.weekday() for d in days}
        times = {t for r in rows for t in (_hm(r.get("start_time")), _hm(r.get("end_time"))) if t}
        times.update(t for t in (_hm(x) for x in extra_times) if t)
        self.times = times

    def grounded(self, tok: _Tok) -> bool:
        if tok.kind == "md":
            return all(md in self.md for md in tok.md) if tok.every else bool(tok.md & self.md)
        if tok.kind == "dom":
            return any(d.day == tok.dom and d.weekday() == tok.wd for d in self.days)
        if tok.kind == "wd":
            return tok.wd in self.wd
        if tok.kind == "time":
            return bool(tok.times & self.times)
        if tok.kind == "days":
            return bool(tok.days & self.days)
        if tok.kind == "month":
            return bool(tok.months & self.months)
        return False


def _near(a: Tuple[int, int], b: Tuple[int, int], window: int = PROSE_WINDOW) -> bool:
    gap = max(b[0] - a[1], a[0] - b[1], 0)
    return gap <= window


def _phrase_spans(t: str, phrase: str) -> List[Tuple[int, int]]:
    toks = phrase.split()
    if not toks:
        return []
    return [(m.start(), m.end()) for m in re.finditer(r"\b" + r"\W+".join(re.escape(x) for x in toks) + r"\b", t)]


def _title_spans(t: str, rows: Sequence[Mapping[str, Any]]) -> List[Tuple[int, int]]:
    """Where the message names an injected event (full title, or its short form ≥ 5 chars):
    '<event title> … <invented time>' is the same claim as '<concierto> … <invented time>'."""
    spans: List[Tuple[int, int]] = []
    for r in rows:
        for title in _titles_all(r):
            spans += _phrase_spans(t, _norm_words(title))
            short = _short_title(title)
            if len(short) >= 5:
                spans += _phrase_spans(t, short)
    return spans


def _entity_spans(t: str, entity: str) -> List[Tuple[int, int]]:
    toks = entity.split()
    spans = [(m.start(), m.end()) for m in re.finditer(r"\b" + r"\W+".join(re.escape(x) for x in toks) + r"\b", t)]
    longest = max(toks, key=len)
    if len(toks) > 1 and len(longest) >= 4:
        spans += [(m.start(), m.end()) for m in re.finditer(rf"\b{re.escape(longest)}\b", t)]
    return spans


# Cartagena landmarks as visitors name them in ES/EN/FR/PT. Not event venues (so not in the
# gazetteer, which geocodes events), but never an "unknown proper name" in an answer either:
# "a short walk from the Clock Tower in the Old City" is a correct answer, not an invented act.
LANDMARK_ALIASES: Tuple[str, ...] = (
    "Torre del Reloj", "Clock Tower", "Tour de l'Horloge", "Torre do Relógio", "Puerta del Reloj",
    "Ciudad Amurallada", "Walled City", "Old City", "Old Town", "Ville fortifiée", "Vieille ville",
    "Cidade Amuralhada", "Cidade Murada", "Cidade Velha", "Centro Histórico", "Historic Center",
    "Centre historique", "Las Murallas", "City Walls", "Les Remparts", "As Muralhas",
    "Castillo San Felipe", "San Felipe Castle", "Château San Felipe", "Castelo San Felipe",
    "Cerro de la Popa", "Convento de la Popa", "La Popa", "Las Bóvedas", "Zapatos Viejos",
    "India Catalina", "Palacio de la Inquisición", "Palace of the Inquisition", "Palais de l'Inquisition",
    "Museo del Oro Zenú", "Gold Museum", "Musée de l'Or", "Museu do Ouro", "Catedral de Santa Catalina",
    "Cathedral", "Cathédrale", "Iglesia de San Pedro Claver", "Santuario de San Pedro Claver",
    "Islas del Rosario", "Rosario Islands", "Îles du Rosaire", "Ilhas do Rosário", "Isla de Barú", "Barú",
    "Playa Blanca", "Tierra Bomba", "Isla Grande", "Cholón", "La Boquilla", "Bocagrande", "Castillogrande",
    "El Laguito", "Getsemaní", "San Diego", "Manga", "Crespo", "Pie de la Popa", "Bahía de Cartagena",
    "Cartagena Bay", "Muelle de los Pegasos", "Muelle Turístico", "Camellón de los Mártires",
    "Parque del Centenario", "Plaza de la Aduana", "Customs Square", "Plaza de los Coches",
    "Plaza Santo Domingo", "Plaza de Bolívar", "Bolívar Square", "Plaza Fernández de Madrid",
    "Calle de la Media Luna", "Calle del Arsenal", "Avenida Santander", "Avenida San Martín",
    "Caribbean Sea", "Mar Caribe", "Mer des Caraïbes", "Mar do Caribe",
)

# A capitalized run that starts with (or follows) one of these is a street / square / area,
# never a performer: "la Calle de la Media Luna", "Plaza Fernández de Madrid", "rua …".
_PLACE_PREFIX_WORDS = frozenset("""
calle carrera cra kra avenida av avda callejon plaza plazoleta parque paseo camellon barrio sector edificio
centro comercial muelle malecon via street st avenue ave road square boulevard blvd lane alley rue place
promenade quartier rua avenida praca largo travessa alameda beco bairro
""".split())

# A capitalized run right after a hospitality ROLE names the person who runs the place, not an
# act ("la chef Leonor Espinosa", "cocina del chef Jaime Rodríguez"). Performers (DJ, artista,
# cantante, banda …) are deliberately NOT here.
_ROLE_PREFIX_WORDS = frozenset("""
chef chefs cocinero cocinera cocineros sommelier sumiller bartender bartenders mixologo mixologa barista
anfitrion anfitriona dueno duena duenos propietario propietaria fundador fundadora fundadores owner owners
founder founders host hostess cuisinier cuisiniere proprietaire fondateur fondatrice cozinheiro cozinheira
dono dona proprietario proprietaria
""".split())


# Sentence-initial capitals that are never a performer: imperatives / verbs / adverbs the LLM
# opens a sentence with ("Recorre la Torre del Reloj", "Disfruta Café del Mar al atardecer").
_SENTENCE_START_WORDS = frozenset("""
recorre recorrer disfruta disfrutar visita visitar descubre descubrir cierra cerrar termina terminar empieza
empezar comienza comenzar prueba probar vive vivir siente sentir camina caminar pasea pasear explora explorar
relajate relajarte toma tomar come comer cena cenar almuerza almorzar desayuna desayunar baila bailar sube subir
baja bajar llega llegar conoce conocer admira admirar contempla contemplar aprovecha aprovechar brinda brindar
degusta degustar saborea saborear date regalate termina remata sigue seguir continua continuar arranca arrancar
ideal perfecto perfecta imperdible luego despues antes aqui alli ahi desde hasta entre frente cerca junto
enjoy visit explore discover walk stroll try taste dance end start begin finish relax grab head stop take
savor sip unwind wander then next finally ideal perfect
profitez visitez decouvrez goutez flanez terminez commencez dansez savourez promenez ensuite puis enfin
aproveite visite descubra descubra prove caminhe passeie termine comece dance saboreie relaxe depois entao
""".split())


@lru_cache(maxsize=1)
def _place_tokens() -> frozenset:
    """Word tokens of every gazetteer venue (names + aliases) and of the landmark aliases:
    Cartagena places are never an 'unknown proper name' by themselves."""
    import json
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "events_gazetteer.json")
    toks: Set[str] = set()

    def add(n: Any) -> None:
        if not isinstance(n, str):
            return
        toks.update(_norm_words(n).split())
        toks.update(w for w in (_alnum(fold_keep(x)) for x in n.split()) if w)   # "l'Horloge" -> lhorloge

    for alias in LANDMARK_ALIASES:
        add(alias)
    try:
        with open(path, encoding="utf-8") as f:
            rows = json.load(f)
        for r in rows if isinstance(rows, list) else []:
            if isinstance(r, dict):
                for n in [r.get("name")] + list(r.get("aliases") or []):
                    add(n)
    except Exception as exc:  # noqa: BLE001 — no gazetteer only makes the name rule stricter
        logger.error("[luna_events] gazetteer unavailable: %s", type(exc).__name__)
    return frozenset(toks)


def _event_word_spans(t: str, rows: Sequence[Mapping[str, Any]]) -> List[Tuple[int, int]]:
    idioms = [(m.start(), m.end()) for m in _IDIOM_RE.finditer(t)]
    spans = [(m.start(), m.end()) for m in _GUARD_EVENT_RE.finditer(t)
             if not _overlaps((m.start(), m.end()), idioms)]
    return spans + _title_spans(t, rows)


def _unknown_name_spans(raw: str, known_toks: Set[str]) -> List[Tuple[int, int]]:
    """Multi-word capitalized runs ('Marc Anthony', 'Silvestre Dangond', 'Karol G') none of whose
    words is an injected title/venue/source word, a partner name, a Cartagena place or a
    function/calendar word."""
    out: List[Tuple[int, int]] = []
    for m0 in _NAME_RUN_RE.finditer(raw):
        for start, end in _split_run_at_sentence_end(m0.start(), m0.group(0)):
            run = raw[start:end]
            words = [w for w in run.split() if _alnum(fold_keep(w)) not in _ENTITY_CONNECT]
            if len(words) < 2:
                continue
            first = _alnum(fold_keep(run.split()[0]))
            before = re.findall(r"[^\W\d_]+", fold_keep(raw[max(0, start - 24):start]))
            prev = before[-1] if before else ""
            if first in _PLACE_PREFIX_WORDS or prev in _PLACE_PREFIX_WORDS:
                continue    # a street / square / area
            if first in _ROLE_PREFIX_WORDS or prev in _ROLE_PREFIX_WORDS:
                continue    # the chef / owner of the place, not a performer
            ent = _entity_from_run(run)
            if not ent:
                continue
            toks = [x for x in ent.split() if x]
            unknown = [x for x in toks if x not in known_toks and x not in _ENTITY_STOP
                       and x not in _NAME_GENERIC_WORDS and x not in _place_tokens()
                       and x not in _SENTENCE_START_WORDS]
            if unknown and any(len(x) >= 3 for x in unknown):
                out.append((start, end))
    return out


_SENTENCE_END_WORD_RE = re.compile(r"[^\W\d_]{3,}[.!?;:]$")


def _split_run_at_sentence_end(offset: int, run: str) -> List[Tuple[int, int]]:
    """A capitalized run may cross a sentence end ('Celele. Cocina …', 'Amurallada. Recorre …'):
    the sentence-initial capital is not part of a name. Split after any word (≥ 3 letters, so not
    an initial like 'G.') that ends in . ! ? ; : — returns absolute (start, end) spans."""
    spans: List[Tuple[int, int]] = []
    cur = None
    for w in re.finditer(r"\S+", run):
        a, b = offset + w.start(), offset + w.end()
        if cur is None:
            cur = [a, b]
        else:
            cur[1] = b
        if _SENTENCE_END_WORD_RE.search(w.group(0)):
            spans.append((cur[0], cur[1] - 1))    # the name ends before the punctuation
            cur = None
    if cur is not None:
        spans.append((cur[0], cur[1]))
    return spans


def find_violations(
    message: Any,
    injected_rows: Sequence[Mapping[str, Any]],
    lang: Any = "es",
    *,
    user_text: Optional[str] = None,
    extra_times: Iterable[Any] = (),
    now: Optional[datetime] = None,
    names: bool = False,
    names_need_event: bool = True,
    known_names: Iterable[Any] = (),
    today_anchors: Iterable[Any] = (),
    bare_name_kinds: Optional[Iterable[str]] = None,
) -> List[Tuple[int, int]]:
    """Spans of ungrounded event claims in `message`.
      §15 V2: an event word (or an injected event's own title) within 80 chars of a date/time
              token absent from every injected row (a time token with no event word nearby
              never counts). Date tokens include relative days ('hoy', 'esta noche', 'mañana',
              'este fin') and a month named alone ('en diciembre'), each grounded only by a row
              on that day / in that month. Idiomatic 'es todo un show' is not an event word.
      + for event questions (`user_text` given): a proper name the user asked about that is in
              NO injected row ('Karol G'), within 80 chars of an event word or ANY date/time/
              month/relative-day word. This catches an invented date that happens to coincide
              with a real row's date.
      + `names`: ANY multi-word proper name in the message that no injected row / partner /
              Cartagena place carries, near an event word (unless `names_need_event` is False)
              AND near a date/time/relative/month word: '… el 28 de septiembre hay concierto de
              Marc Anthony' on the very day a real row is on.
    `today_anchors` (venue-published pulse titles/names, non-event turns): a 'today' word near
    one of them is the venue's own word ('según el local'), not an invented event.
    `bare_name_kinds` (with names_need_event=False): the temporal token kinds that make a name
    WITHOUT an event word nearby a claim (None = every kind). Non-event side channels pass the
    explicit-date kinds only ('md', 'dom', 'wd'), so "la chef … cocina esta noche" stays."""
    if not isinstance(message, str) or not message.strip():
        return []
    lg = _lang(lang)
    t = fold_keep(message)
    today = _bogota_today(now)
    ground = _Ground(injected_rows, extra_times)
    events = _event_word_spans(t, injected_rows)
    titles = _title_spans(t, injected_rows)
    base = _scan_tokens(t, lg)
    base_spans = [(k.start, k.end) for k in base]
    toks = base + _relative_tokens(t, today, skip=titles) + _month_tokens(t, base_spans + titles)
    anchors_today = [sp for a in today_anchors if isinstance(a, str) and len(_norm_words(a)) >= 4
                     for sp in _phrase_spans(t, _norm_words(a))]
    out: List[Tuple[int, int]] = []
    if events:
        for tok in toks:
            if ground.grounded(tok):
                continue
            span = (tok.start, tok.end)
            if tok.kind == "days" and today in tok.days and any(_near(span, a) for a in anchors_today):
                continue
            for ev in events:
                if _near(ev, span):
                    out.append((min(ev[0], span[0]), max(ev[1], span[1])))
    temporal_k = [(k.start, k.end, k.kind) for k in toks] + \
        [(m.start(), m.end(), "month") for m in _MONTH_ALONE_RE.finditer(t)]
    temporal = [(a, b) for a, b, _k in temporal_k]
    bare_kinds = None if bare_name_kinds is None else set(bare_name_kinds)
    if user_text:
        known = " " + " ".join(_norm_words(x) for r in injected_rows
                               for x in _titles_all(r) + [str(r.get("venue_name") or ""), _source_name(r)]) + " "
        known_toks = set(known.split())
        anchors = events + _broad_temporal_spans(t, lg)
        for ent in query_entities(user_text):
            if f" {ent} " in known or all(tk in known_toks for tk in ent.split() if len(tk) >= 3):
                continue
            for es in _entity_spans(t, ent):
                for an in anchors:
                    if _near(es, an):
                        out.append((min(es[0], an[0]), max(es[1], an[1])))
    if names and temporal:
        k_toks: Set[str] = set()
        for r in injected_rows:
            for x in _titles_all(r) + [str(r.get("venue_name") or ""), _source_name(r)]:
                k_toks.update(_norm_words(x).split())
        for n in known_names:
            k_toks.update(_norm_words(n).split())
        for ns in _unknown_name_spans(message, k_toks):
            has_event = any(_near(ns, ev) for ev in events)
            if names_need_event and not has_event:
                continue
            for a, b, kind in temporal_k:
                if not has_event and bare_kinds is not None and kind not in bare_kinds:
                    continue
                if _near(ns, (a, b)):
                    out.append((min(ns[0], a), max(ns[1], b)))
                    break
    return out


def prose_guard(
    message: Any,
    injected_rows: Sequence[Mapping[str, Any]],
    lang: Any = "es",
    *,
    user_text: Optional[str] = None,
    range_key: str = "upcoming",
    extra_times: Iterable[Any] = (),
    now: Optional[datetime] = None,
    known_names: Iterable[Any] = (),
) -> str:
    """§15 V2: if the reply claims an event date/time that no injected row carries — or names an
    event/performer no injected row carries next to a date — the whole message is replaced by
    the deterministic grounded list."""
    msg = message if isinstance(message, str) else ""
    try:
        bad = find_violations(msg, injected_rows, lang, user_text=user_text, extra_times=extra_times, now=now,
                              names=True, known_names=known_names)
    except Exception as exc:  # noqa: BLE001 — a guard that cannot run fails closed
        logger.error("[luna_events] prose_guard failed: %s", type(exc).__name__)
        bad = [(0, len(msg))]
    if not bad:
        return msg
    logger.warning("[luna_events] prose_guard replaced an ungrounded event claim (%d spans)", len(bad))
    return grounded_message(injected_rows, lang, range_key, replaced=True, now=now)


# Sentence ends: '.', '!', '?' before whitespace/end, or a newline — but never the dots of
# "a.m." / "p. m." ("At 10 p.m. there's a concert" is ONE claim, not two harmless halves).
_SENT_END_RE = re.compile(r"[.!?](?=\s|$)|\n")
_AMPM_TAIL_RE = re.compile(r"(?:\b[ap]\.\s?m|\b[ap])\.$", re.I)


def _sentences(msg: str) -> List[str]:
    out: List[str] = []
    start = 0
    for m in _SENT_END_RE.finditer(msg):
        if m.group(0) == "\n":
            if m.start() > start:
                out.append(msg[start:m.start()])
            out.append("\n")
            start = m.end()
            continue
        if _AMPM_TAIL_RE.search(msg[max(start, m.start() - 6):m.end()]):
            continue
        out.append(msg[start:m.end()])
        start = m.end()
    if start < len(msg):
        out.append(msg[start:])
    return out


def strip_ungrounded(
    message: Any,
    injected_rows: Sequence[Mapping[str, Any]],
    lang: Any = "es",
    *,
    extra_times: Iterable[Any] = (),
    now: Optional[datetime] = None,
    today_anchors: Iterable[Any] = (),
) -> str:
    """Same detector, sentence-level, for NON-event turns ('dónde cenar hoy'): drop only the
    sentences carrying an ungrounded event claim and keep the venue answer. Returns '' when
    nothing meaningful is left (the caller then points to the agenda)."""
    msg = message if isinstance(message, str) else ""
    kept: List[str] = []
    dropped = 0
    try:
        for sent in _sentences(msg):
            if sent != "\n" and find_violations(sent, injected_rows, lang, extra_times=extra_times, now=now,
                                                today_anchors=today_anchors):
                dropped += 1
                continue
            kept.append(sent)
    except Exception as exc:  # noqa: BLE001 — a guard that cannot run fails closed
        logger.error("[luna_events] strip_ungrounded failed: %s", type(exc).__name__)
        return ""
    if not dropped:
        return msg
    text = re.sub(r"[ \t]+", " ", "".join(kept))
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    logger.warning("[luna_events] stripped %d sentence(s) with an ungrounded event claim", dropped)
    return text if len(re.findall(r"[^\W\d_]{2,}", text)) >= 3 else ""


_NEUTRAL_LABEL = {"es": "Ver", "en": "View", "fr": "Voir", "pt": "Ver"}


def guard_side_channels(
    recs: Sequence[Any],
    actions: Sequence[Any],
    suggestions: Sequence[Any],
    injected_rows: Sequence[Mapping[str, Any]],
    lang: Any = "es",
    *,
    extra_times: Iterable[Any] = (),
    now: Optional[datetime] = None,
    partner_names: Optional[Mapping[str, str]] = None,
    today_anchors: Iterable[Any] = (),
    event_turn: bool = False,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[str]]:
    """The prose guard for every OTHER string the LLM writes (§15 V2 applied to all of them):
    partner-card name/type/vibe/reason/address, action labels, quick-reply suggestions. A field
    with an ungrounded event claim — or a proper name no row/partner carries next to a date —
    is blanked (a partner card's name falls back to its catalog name), a label becomes the
    neutral localized label, a suggestion is dropped. Event cards are already rebuilt from
    their row by sanitize() and pass unchanged.

    On a NON-event turn (`event_turn` False) a proper name without an event word counts only
    next to an explicit date (day+month, day+weekday, weekday), never a bare 'hoy' / 'esta
    noche' / opening hour: ordinary partner copy ('la chef X cocina esta noche') is kept."""
    lg = _lang(lang)
    bare_kinds: Optional[Tuple[str, ...]] = None if event_turn else ("md", "dom", "wd")
    pnames = dict(partner_names or {})
    known = list(pnames.values())
    extra = list(extra_times)
    anchors = list(today_anchors)

    def bad(text: Any) -> bool:
        if not isinstance(text, str) or not text.strip():
            return False
        try:
            return bool(find_violations(text, injected_rows, lg, extra_times=extra, now=now, names=True,
                                        names_need_event=False, known_names=known, today_anchors=anchors,
                                        bare_name_kinds=bare_kinds))
        except Exception as exc:  # noqa: BLE001 — fail closed
            logger.error("[luna_events] side-channel guard failed: %s", type(exc).__name__)
            return True

    out_recs: List[Dict[str, Any]] = []
    for rec in recs or []:
        if not isinstance(rec, Mapping):
            continue
        r = dict(rec)
        if r.get("kind") != "event":
            for k in ("type", "vibe", "reason", "address"):
                if bad(r.get(k)):
                    r[k] = ""
            if bad(r.get("name")):
                r["name"] = str(pnames.get(str(r.get("partner_id")), ""))[:80]
        out_recs.append(r)
    out_actions: List[Dict[str, Any]] = []
    for a in actions or []:
        if not isinstance(a, Mapping):
            continue
        d = dict(a)
        if bad(d.get("label")):
            d["label"] = _NEUTRAL_LABEL[lg]
        out_actions.append(d)
    out_sugg = [str(x) for x in suggestions or [] if isinstance(x, str) and x.strip() and not bad(x)]
    return out_recs, out_actions, out_sugg


def agenda_pointer(lang: Any) -> str:
    return _T[_lang(lang)]["pointer"]


def agenda_action(lang: Any) -> Dict[str, Any]:
    return _agenda_action(_lang(lang))


def _mentioned(message: str, recs: Sequence[Any], actions: Sequence[Any],
               rows: Sequence[Mapping[str, Any]]) -> List[Mapping[str, Any]]:
    ids: Set[str] = set()
    for rec in recs or []:
        if isinstance(rec, Mapping) and isinstance(rec.get("event_id"), str):
            ids.add(rec["event_id"])
    for a in actions or []:
        if isinstance(a, Mapping) and a.get("type") == "open_event" and isinstance(a.get("event_id"), str):
            ids.add(a["event_id"])
    t = " " + _norm_words(message) + " "
    out: List[Mapping[str, Any]] = []
    for r in rows:
        eid = r.get("event_id")
        hit = eid in ids
        if not hit:
            for title in _titles_all(r):
                full = _norm_words(title)
                short = _short_title(title)
                if (full and f" {full} " in t) or (len(short) >= 5 and f" {short} " in t):
                    hit = True
                    break
        if hit:
            out.append(r)
    return out


def citation_footer(
    message: Any,
    recs: Sequence[Any],
    actions: Sequence[Any],
    injected_rows: Sequence[Mapping[str, Any]],
    lang: Any = "es",
) -> str:
    """§15 V4: one 'Fuente: <source_name> · verificado <d MMM>' line per injected event whose
    id is in the cards/actions or whose title (any language) is in the message. VERIFY rows
    get '(sin confirmar)'. Lines already present are not repeated."""
    msg = message if isinstance(message, str) else ""
    lg = _lang(lang)
    t = _T[lg]
    rows = _mentioned(msg, recs, actions, injected_rows)
    if not rows:
        return msg
    lines: List[str] = []
    for r in rows:
        label = verified_label(r.get("last_verified"), lg)
        src = _source_name(r)
        line = t["source"].format(src=src, d=label) if label else t["source_nodate"].format(src=src)
        if not _is_high(r):
            line += t["hedge"]
        if len(rows) > 1:
            line = f"{_title(r, lg)} — {line}"
        if line not in lines and line not in msg:
            lines.append(line)
    if not lines:
        return msg
    return msg.rstrip() + "\n\n" + "\n".join(lines)


def filter_history(history: Any, cutover: Optional[str] = None) -> List[Dict[str, str]]:
    """§15 V3: assistant turns created before the cutover (or with no provable timestamp) are
    dropped from what the LLM sees, so pre-EVENTS-ELITE replies (legacy/invented events) are
    never re-fed. User turns are kept. Output is {role, content} only. The cutover is read from
    env EVENTS_ELITE_CUTOVER at call time (the design constant is the floor and the fallback)."""
    cut = gate.parse_iso(cutover if cutover is not None else _cutover_from_env())
    out: List[Dict[str, str]] = []
    for m in history if isinstance(history, list) else []:
        if not isinstance(m, Mapping):
            continue
        role, content = m.get("role"), m.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str) or not content.strip():
            continue
        if role == "assistant":
            ts = gate.parse_iso(m.get("created_at"))
            if ts is None or cut is None or ts < cut:
                continue
        out.append({"role": str(role), "content": content})
    return out


def intent_default() -> Dict[str, Any]:
    return {"is_event": False, "range": "upcoming", "near": False, "category": None}
