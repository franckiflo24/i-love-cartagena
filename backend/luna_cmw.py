"""CMW: Luna's deterministic Cartagena Music Week answers (docs/cmw/DESIGN.md §5).

Luna states ONLY what the official program states (cmw.merged_program: the deck + admin
overrides with a source note). A CMW question NEVER reaches the LLM: this module answers it
deterministically in es/en/fr/pt. Nothing here invents an artist, a lineup, a time, a price,
an address, a boarding point or a venue, and the "Very Special Guest" is never named.

  detect_cmw_intent(text, lang, now)  -> {is_cmw, kind: program|day|event|tba|booking|directions,
                                          date, event_id, dates, event_ids, field, range}
  answer(program, intent, lang, now)  -> assistant payload {message, language, actions,
                                          recommendations, suggestions}
  combined_answer(program, dates, city, lang, now)   during the week: the day's official program
                                          FIRST, then the verified city agenda (luna_events)
  gate(db, user_text, ...)            -> payload | None   the run_agent_turn hook
  guard_turn(db, payload, ...)        -> payload          non-CMW turns: an LLM text that puts a
                                          time, a price or an unknown person next to a CMW
                                          term is replaced by the deterministic program answer

Actions use only types the shipped binaries understand: external_link to the concierge
WhatsApp and to the hub (the two prefixes luna_events.cmw_url_allowed allows), open_partner
for catalog venues, and navigate → ciudad for "how do I get around". Booking is concierge-led:
no checkout, no payment, never a "confirmed" / "reservado" state.

Privacy: a user location is only ever forwarded to luna_events for this turn (never stored or
logged). Logging: '[cmw] ...' with type(exc).__name__ only.
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import date, datetime, timedelta
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple

import cmw
import events_gate as _eg
import luna_events as _le

logger = logging.getLogger("luna_cmw")

LANGS: Tuple[str, ...] = ("es", "en", "fr", "pt")
KINDS: Tuple[str, ...] = ("program", "day", "event", "tba", "booking", "directions")
TBA_FIELDS: Tuple[str, ...] = ("artist", "time", "price", "venue", "boarding_point")
PLACEHOLDER_ARTIST = cmw.PLACEHOLDER_ARTIST
HUB_URL = cmw.HUB_URL
CONCIERGE_DISPLAY = cmw.CONCIERGE_DISPLAY
GUARD_WINDOW = 160          # chars between a CMW term and a time / price / person name
GUARD_DATE_WINDOW = 60      # chars between a CMW term and a date that is not in the program
FOLLOWUP_MAX_CHARS = 80
FOLLOWUP_MAX_AGE = timedelta(hours=24)

# ── event ids (fixed by the contract, DESIGN §1.1; validated against the program in tests) ──
ID_ZAMNA = "cmw-zamna-on-the-beach"
ID_BOHEME = "cmw-casa-boheme-we-are-us"
ID_AFTER_NY = "cmw-after-new-year"
ID_WELLNESS = "cmw-wellness"
ID_CATAMARAN = "cmw-catamaran-sunset-party"
ID_STARDUST = "cmw-stardust-by-saraga"
ID_MAIN_04 = "cmw-main-event-jan-04"
ID_MAIN_AFTER = "cmw-main-event-after"
ID_MAIN_06 = "cmw-main-event-jan-06"
ID_AFTER_TEMPLE = "cmw-after-temple"
MAIN_EVENT_IDS: Tuple[str, ...] = (ID_MAIN_04, ID_MAIN_06)

# ── CMW keywords (§5): a question is CMW only when one of these is present ──────────────────
# Matched on folded text (luna_events.fold_keep: lowercase, accent-stripped, same length).
# The brand-unique tokens are anchors: alone they make a turn CMW. The printed titles that are
# also ordinary phrases ("main event", "after new year", "after temple", "catamaran sunset
# party") count only under _secondary_is_cmw: with an anchor, in Title Case, with a program
# date, or when nothing else in the question points elsewhere (a venue, another festival).
_KW_RES: Tuple[Tuple[str, "re.Pattern[str]"], ...] = (
    ("music_week", re.compile(r"\bmusic[\s\-_]*week\b")),
    ("cmw", re.compile(r"\bcmw\b")),
    ("zamna", re.compile(r"\bzamna\b")),
    ("stardust", re.compile(r"\bstardust\b")),
    ("saraga", re.compile(r"\bsaraga\b")),
    ("we_are_us", re.compile(r"\bwe[\s\-]+are[\s\-]+us\b")),
    ("main_event", re.compile(r"\bmain[\s\-]+event\b")),
    ("very_special_guest", re.compile(r"\bvery[\s\-]+special[\s\-]+guest\b")),
    ("after_new_year", re.compile(r"\bafter[\s\-]+new[\s\-]+year(?:'?s)?\b")),
    ("after_temple", re.compile(r"\bafter[\s\-]+temple\b")),
    ("catamaran_sunset", re.compile(r"\bcatamaran[\s\-]+sunset[\s\-]+party\b")),
)
_ANCHOR_KWS = frozenset({"music_week", "cmw", "zamna", "stardust", "saraga", "we_are_us", "very_special_guest"})
# A printed title written as a proper noun ("Main Event", "After New Year", "MAIN EVENT").
_TITLE_CASE_RE = re.compile(
    r"\b(?:Main|MAIN)[\s\-]+(?:Event|EVENT)\b|\b(?:After|AFTER)[\s\-]+(?:New|NEW)[\s\-]+(?:Year|YEAR)\b"
    r"|\b(?:After|AFTER)[\s\-]+(?:Temple|TEMPLE)\b|\b(?:Catamaran|CATAMARAN)[\s\-]+(?:Sunset|SUNSET)[\s\-]+(?:Party|PARTY)\b")
# Another event the question is really about ("the main event at the Hay Festival", boxing).
_OTHER_EVENT_RE = re.compile(
    r"\bfestival\b|\bironman\b|\bficci\b|\bfiestas\b|\bcarnaval\b|\bcarnival\b|\bconciertos?\b|\bconcerts?\b"
    r"|\bgala\b|\bdesfiles?\b|\bparade\b|\bferia\b|\bfair\b|\bpartidos?\b|\bmatch\b|\bfinal\b|\bmundial\b"
    r"|\bworld cup\b|\bboxe?o?\b|\bboxing\b|\bufc\b|\bwrestling\b|\blucha\b|\btorneo\b|\btournament\b")
# The terms the post-LLM guard watches (§5 guard list + the other printed titles).
_TERM_RE = re.compile(
    r"\bmusic[\s\-_]*week\b|\bcmw\b|\bvery[\s\-]+special[\s\-]+guest\b|\bzamna\b|\bstardust\b|\bsaraga\b"
    r"|\bwe[\s\-]+are[\s\-]+us\b|\bmain[\s\-]+event\b|\bafter[\s\-]+temple\b|\bafter[\s\-]+new[\s\-]+year\b"
    r"|\bcatamaran[\s\-]+sunset\b")

# Secondary aliases: they name an event only once a CMW keyword made the turn CMW.
_ALIAS_RES: Tuple[Tuple["re.Pattern[str]", Tuple[str, ...]], ...] = (
    (re.compile(r"\bmain[\s\-]+event[\s\-]+after\b|\bafter[\s\-]+(?:del|of[\s\-]+the|du|do)?[\s\-]*main[\s\-]+event\b"),
     (ID_MAIN_AFTER,)),
    (re.compile(r"\bafter[\s\-]+temple\b"), (ID_AFTER_TEMPLE,)),
    (re.compile(r"\bafter[\s\-]+new[\s\-]+year(?:'?s)?\b"), (ID_AFTER_NY,)),
    (re.compile(r"\bmain[\s\-]+event\b|\bvery[\s\-]+special[\s\-]+guest\b|\bspecial[\s\-]+guest\b"), MAIN_EVENT_IDS),
    (re.compile(r"\bzamna\b"), (ID_ZAMNA,)),
    (re.compile(r"\bwe[\s\-]+are[\s\-]+us\b|\bcasa[\s\-]+boheme\b|\bboheme\b"), (ID_BOHEME,)),
    (re.compile(r"\bstardust\b|\bsaraga\b|\bel[\s\-]+lago\b"), (ID_STARDUST,)),
    (re.compile(r"\bcatamaran(?:es|s)?\b|\bcatamara\b"), (ID_CATAMARAN,)),
    (re.compile(r"\bwellness\b|\bbienestar\b|\byoga\b|\bbien[\s\-]*etre\b|\bbem[\s\-]*estar\b"), (ID_WELLNESS,)),
    (re.compile(r"\bbellini\b|\bbethel\b"), (ID_ZAMNA, ID_WELLNESS)),
    (re.compile(r"\btemplo\b|\btemple\b"), (ID_MAIN_AFTER, ID_AFTER_TEMPLE)),
)

# ── question kinds ──────────────────────────────────────────────────────────────────────────
_BOOKING_RE = re.compile(
    r"\breserv(?:a|ar|o|ame|arme|acion|aciones|ation|ations|e|er|ez|as)\b|\bbook(?:ing|ings|ed)?\b"
    r"|\bentradas?\b|\bboletas?\b|\bboletos?\b|\btickets?\b|\bbillets?\b|\bingressos?\b"
    r"|\bmesas?\b|\btables?\b|\bvip\b|\bcomprar\b|\bcompro\b|\bbuy\b|\bacheter\b"
    r"|\bacces[os]?\b|\bacceso\b|\baccess\b|\bacesso\b|\bsolicit(?:ar|o|ud|ation)?\b|\brequest\b"
    r"|\bguest[\s\-]*list\b|\blista\b|\binscri(?:birme|bir|ption|cao|cion)\b|\bsign[\s\-]+up\b"
    r"|\bquiero ir\b|\bquisiera ir\b|\bwant to go\b|\bcomo voy\b|\bcomo asisto\b|\basistir\b|\battend\b"
    r"|\bparticipar\b|\bcomo consigo\b|\bhow (?:do i|can i) get (?:in|tickets)\b|\bapuntar\b")
_PRICE_RE = re.compile(
    r"\bprecios?\b|\bprices?\b|\bprix\b|\bprecos?\b|\bcuanto (?:cuesta|cuestan|vale|valen|es|sale)\b"
    r"|\bcuanto\b|\bhow much\b|\bcombien\b|\bquanto (?:custa|custam|e)\b|\bquanto\b|\bcosto\b|\bcost\b|\bcout\b"
    r"|\bcusto\b|\btarifa\b|\bcover\b|\bgratis\b|\bfree\b|\bgratuit\b")
_ARTIST_RE = re.compile(
    r"\bquien(?:es)?\b|\bwho\b|\bqui\b|\bquem\b|\bartistas?\b|\bartists?\b|\bartistes?\b|\blineup\b"
    r"|\bline[\s\-]+up\b|\bcartel\b|\bdjs?\b|\bheadliners?\b|\binvitad[oa]s?\b|\bguest\b|\bcanta\b|\btoca\b"
    r"|\btocan\b|\bplays?\b|\bplaying\b|\bperform(?:s|ing|er|ers)?\b|\bjoue\b|\bchante\b|\bse apresenta\b"
    r"|\bcantante\b|\bsinger\b|\bbanda\b|\bband\b")
_TIME_RE = re.compile(
    r"\b(?:a )?que horas?\b|\bhorarios?\b|\bwhat time\b|\bwhen does\b|\bstarts?\b|\bstarting\b"
    r"|\bquelle heure\b|\bhoraires?\b|\bque horas\b|\bhorario\b|\bempieza\b|\bcomienza\b|\bcommence\b"
    r"|\bcomeca\b|\bschedule\b|\bhora\b|\btermina\b|\bends?\b|\bfinit\b|\bhasta que hora\b")
_WHERE_RE = re.compile(
    r"\bdonde\b|\bwhere\b|\bonde\b|\bou est\b|\bou se\b|\bou a lieu\b|\bou aura\b|\bc'est ou\b|\bou ca\b"
    r"|\blugar\b|\bsitio\b|\bvenue\b|\blocation\b|\bubicacion\b|\bdireccion\b|\baddress\b|\badresse\b"
    r"|\bendereco\b|\bcomo llego\b|\bcomo llegar\b|\bhow (?:do i|to|can i) get\b|\bcomment (?:aller|venir|s'y rendre|y aller)\b"
    r"|\bcomo chegar\b|\bcomo chego\b|\bdirections?\b|\bindicaciones\b|\bmapa\b|\bmap\b|\bqueda\b|\bfica\b")
_TRANSFER_RE = re.compile(
    r"\btraslados?\b|\btransfers?\b|\bbotes?\b|\blanchas?\b|\bboats?\b|\bbateaux?\b|\bbarcos?\b"
    r"|\bembarque\b|\bboarding\b|\bmuelle\b|\bpier\b|\btransporte\b|\btransport\b|\bllegar en\b")
_FOLLOWUP_WORDS = frozenset("""
y a que hora es empieza comienza termina abre abren cierra cierran hora horario cuando when what time does it start
begin end open opens close closes quelle heure commence a et quand que horas comeca termina abre fecha quanto custa
cuesta cuestan vale valen precio price prix preco how much combien cost costo entrada entradas boleta boletas boleto
boletos tickets ticket billet billets ingresso ingressos mesa mesas table tables vip reservar reserva reservo book
booking reserver reservation quien quienes toca tocan canta who is playing performs qui joue chante quem artista
artistas artist artists artiste artistes invitado invitada invitados invitadas guest guests headliner headliners
especial special lineup line up dj djs cartel donde where ou onde lugar venue address direccion adresse endereco
como llego llegar get there se arrive chegar chego eso ese esa this that ca isso o la el le the de del du da do
en in a las las los un una une um uma para pour por l'evento evento event evenement fiesta party show para mi me
je eu yo puedo can i podria i'd like quiero quisiera want to go ir aller and or ou e y ok ok? si yes oui sim hay
tem there il y
""".split())
_FOLLOWUP_CUE_RE = re.compile(
    r"\bhora\b|\bhorario\b|\btime\b|\bheure\b|\bhoras\b|\bempieza\b|\bstart\b|\babre\b|\bcierra\b|\bopen\b"
    r"|\bcuanto\b|\bprecio\b|\bprice\b|\bcombien\b|\bprix\b|\bquanto\b|\bpreco\b|\bentradas?\b|\bboletas?\b"
    r"|\bboletos?\b|\btickets?\b|\bbillets?\b|\bingressos?\b|\breserv|\bbook\b|\bquien\b|\bwho\b|\bqui\b|\bquem\b"
    r"|\bartistas?\b|\bartists?\b|\bartistes?\b|\binvitad[oa]s?\b|\bguests?\b|\bheadliners?\b|\blineup\b|\bdjs?\b"
    r"|\bdonde\b|\bwhere\b|\bonde\b|\bou\b|\blugar\b|\bvenue\b|\bllegar\b|\bllego\b|\bchegar\b|\bget there\b"
    r"|\bmesas?\b|\btables?\b|\bvip\b|\bhay\b")
_STRIP_24_7_RE = re.compile(r"\b24\s*/\s*7\b")

# Supplementary time forms the shared scanner leaves out ("a las 10 de la noche" is covered).
_EXTRA_TIME_RE = re.compile(
    r"(?<![\d:/.,])(?:[01]?\d|2[0-3])\s?(?:h|hs|hrs|horas)\b(?![\d:])"
    r"|\b(?:medianoche|midnight|minuit|meia[\s\-]noite|mediodia|noon|midi|meio[\s\-]dia)\b")
_NUM_WORD = (r"(?:un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte|treinta|cuarenta|cincuenta"
             r"|sesenta|setenta|ochenta|noventa|cien|ciento|doscient[oa]s|trescient[oa]s|cuatrocient[oa]s|quinient[oa]s"
             r"|seiscient[oa]s|setecient[oa]s|ochocient[oa]s|novecient[oa]s|one|two|three|four|five|ten|twenty|fifty"
             r"|hundred|deux|trois|cinq|dix|vingt|cinquante|cent|cents|duzentos|trezentos|quinhentos)")
_PRICE_TEXT_RE = re.compile(
    r"[$€£]\s?\d|\b\d[\d.,]*\s?(?:cop|usd|eur|k|mil|millon|millones|million|milhao|milhoes|pesos?|dolares|dollars?"
    r"|euros?|reais)\b"
    # spelled-out amounts: "doscientos mil pesos", "dos millones de pesos", "two hundred thousand pesos"
    r"|\b" + _NUM_WORD + r"(?:\s+" + _NUM_WORD + r")?\s+(?:mil|millon|millones|thousand|million|mille|milhao|milhoes)"
    r"(?:\s+de)?(?:\s+" + _NUM_WORD + r")?\s*(?:pesos?|cop|usd|dolares|dollars?|euros?|reais|k)?\b"
    r"|\b(?:gratis|free of charge|entrada libre|gratuit|gratuito|gratuita|entrada gratis|free entry|free entrance)\b"
    r"|\bcover\s?(?:de|of|:)?\s?[$\d]", re.I)
# §0: NO checkout, NO payment, never a "sold out" / age / dress-code / capacity claim from the LLM.
_SALE_STATE_RE = re.compile(
    r"\ben venta\b|\bon sale\b|\bcompra(?:r|s|los|las)?\b|\bbuy\b|\bacheter\b|\bcomprar\b|\bsold[\s\-]?out\b"
    r"|\bagotad[oa]s?\b|\bcheckout\b|\bpagar\b|\bpago\b|\bpayment\b|\bpaiement\b|\bpagamento\b|\bcomplet\b|\besgotad[oa]s?\b"
    r"|\+\s?18\b|\b18\s?\+|\+\s?21\b|\b21\s?\+|\bmayores de\s?\d+\b|\bover\s?\d\d\b|\bplus de\s?\d+\s?ans\b"
    r"|\bdress[\s\-]?code\b|\bcodigo de vestimenta\b|\baforo\b|\bcapacity\b|\bcapacidad\b|\bcupos?\b|\blotacao\b")
# A street address next to a CMW term ("Calle 38 #9-20", "Cra. 3 #35-10").
_ADDRESS_RE = re.compile(
    r"\b(?:calle|cl|cll|carrera|cra|kra|kr|avenida|av|avda|diagonal|dg|transversal|tv|rua|rue)\.?\s?\d{1,3}[a-z]?\b"
    r"|#\s?\d{1,3}\s?[a-z]?\s?[-–]\s?\d{1,3}\b")
# A performer named after a cue, in Title Case ("con Shakira") or lowercase ("dj solomun").
_PERFORMER_CUE = (r"(?:feat|ft|featuring|djs?|headliners?|headlined by|presenta a|presentan a|presents|presenting"
                  r"|apresenta|invitad[oa]s? especial(?:es)?|special guests?|guests?|artistas? invitad[oa]s?"
                  r"|trae a|trae al|toca|tocan|canta|cantan|plays|performs|line[\s\-]?up|cartel)")
_NAME_CUE_RE = re.compile(
    r"(?:\b(?:con|with|avec|com|feat|ft|featuring|dj|headliner|headlined by|presenta a|presenta|presentan a|"
    r"presents|presenting|apresenta|invitado especial|invitada especial|guest)\b\.?\s*:?\s*"
    r"(?:(?:es|is|est|será|sera|will be|c'est|é)\s+)?)"
    r"([A-ZÁÉÍÓÚÑÜÇÀÂÊÔÃÕ][\w'’.-]{2,})")
_LOWER_CUE_RE = re.compile(
    r"\b" + _PERFORMER_CUE + r"\b\.?\s*:?\s*(?:es|is|est|e|sera|será|will be|the|el|la|le|o|a|al|del|de)?\s*"
    r"((?:[a-z][a-z'’.-]{1,}\s?){1,8})")
# "el very special guest del main event es bad bunny": a lowercase claim after the term + copula.
_COPULA_CUE_RE = re.compile(
    r"\b(?:very[\s\-]+special[\s\-]+guest|main[\s\-]+event|headliners?)\b\s+(?:es|is|est|e|sera|will be|c'est|:)\s*"
    r"((?:[a-z][a-z'’.-]{1,}\s?){1,4})")
_CAP_WORD_RE = re.compile(r"(?<![\w'’])([A-ZÁÉÍÓÚÑÜÇÀÂÊÔÃÕ][\w'’.-]{2,})")
_SENT_BREAK_RE = re.compile(r"[.!?;\n]")

# ── localized copy (tú voice; FR "tu", PT "você") ───────────────────────────────────────────
_T: Dict[str, Dict[str, str]] = {
    "es": {
        "official": "Programa oficial Cartagena Music Week",
        "overview": "{official} · {range} · {days}.",
        "before_today": "Cartagena Music Week todavía no empieza: va del {start} al {end}. Este es el programa oficial:",
        "after": "Cartagena Music Week fue del {start} al {end} y ya terminó.",
        "day_lead": "{official} · {day}:",
        "day_none": "Ese día no está en el programa: Cartagena Music Week va del {start} al {end}. Este es el programa oficial:",
        "today": "hoy", "tomorrow": "mañana",
        "venue_tba": "lugar por confirmar", "time_tba": "hora por confirmar", "artist_tba": "artista por confirmar",
        "price_tba": "precio por confirmar", "boarding_tba": "punto de embarque por confirmar",
        "price_line": "Precio: por confirmar (consúltalo con el concierge).",
        "price_known": "Precio: {price}.",
        "concierge": "Concierge Cartagena Music Week: {phone} (WhatsApp).",
        "tba_artist": "El artista aún está por confirmar — el concierge te puede ayudar.",
        "tba_time": "La hora aún está por confirmar — el concierge te puede ayudar.",
        "tba_price": "El precio aún está por confirmar — el concierge te puede ayudar.",
        "tba_venue": "El lugar aún está por confirmar — el concierge te puede ayudar.",
        "tba_boarding_point": "El punto de embarque aún está por confirmar — el concierge te puede ayudar.",
        "no_lineup": "El programa oficial no anuncia artistas para {title} — el concierge te puede ayudar.",
        "vsg_note": "El programa oficial anuncia un Very Special Guest para el Main Event ({days}).",
        "known_time": "{title} ({day}): {time}.",
        "known_venue": "{title} ({day}) es en {venue}.",
        "known_artist": "{title} ({day}): {artist}.",
        "booking": "Las entradas, mesas y experiencias VIP de Cartagena Music Week se gestionan con el concierge. "
                   "Envía tu solicitud desde el programa o escribe por WhatsApp: "
                   "un concierge te contactará.",
        "booking_event": "Para {title} ({day}), envía tu solicitud desde el programa o escribe por WhatsApp: "
                         "un concierge te contactará.",
        "dir_catalog": "{title} ({day}) es en {venue}: abre su ficha en AMO para ver cómo llegar.",
        "dir_name_only": "El programa oficial solo indica el lugar de {title} ({day}): {venue}. "
                         "La dirección está por confirmar — el concierge te puede ayudar.",
        "dir_tba": "El lugar de {title} ({day}) está por confirmar — el concierge te puede ayudar.",
        "dir_boarding": "El punto de embarque de {title} ({day}) está por confirmar. El concierge coordina los traslados.",
        "transfers": "El concierge coordina los traslados.",
        "dir_general": "Para moverte por la ciudad y llegar a los eventos, mira la guía de transporte en AMO. "
                       "El concierge coordina los traslados.",
        "city_header": "Agenda de la ciudad:",
        "unavailable": "No puedo cargar el programa oficial en este momento. El concierge de Cartagena Music Week "
                       "te puede ayudar: {phone} (WhatsApp).",
        "lbl_hub": "Ver programa oficial", "lbl_event": "Ver evento", "lbl_wa": "Escribir al concierge",
        "lbl_partner": "Ver lugar", "lbl_city": "Cómo moverte por la ciudad",
        "sugg1": "Programa de Music Week", "sugg2": "Solicitar acceso a Music Week",
    },
    "en": {
        "official": "Official Cartagena Music Week program",
        "overview": "{official} · {range} · {days}.",
        "before_today": "Cartagena Music Week hasn't started yet: it runs {start} – {end}. This is the official program:",
        "after": "Cartagena Music Week ran {start} – {end} and is over.",
        "day_lead": "{official} · {day}:",
        "day_none": "That day isn't in the program: Cartagena Music Week runs {start} – {end}. This is the official program:",
        "today": "today", "tomorrow": "tomorrow",
        "venue_tba": "venue to be confirmed", "time_tba": "time to be confirmed", "artist_tba": "artist to be confirmed",
        "price_tba": "price to be confirmed", "boarding_tba": "boarding point to be confirmed",
        "price_line": "Price: to be confirmed (ask the concierge).",
        "price_known": "Price: {price}.",
        "concierge": "Cartagena Music Week concierge: {phone} (WhatsApp).",
        "tba_artist": "The artist is still to be confirmed — the concierge can help you.",
        "tba_time": "The time is still to be confirmed — the concierge can help you.",
        "tba_price": "The price is still to be confirmed — the concierge can help you.",
        "tba_venue": "The venue is still to be confirmed — the concierge can help you.",
        "tba_boarding_point": "The boarding point is still to be confirmed — the concierge can help you.",
        "no_lineup": "The official program doesn't announce artists for {title} — the concierge can help you.",
        "vsg_note": "The official program announces a Very Special Guest for the Main Event ({days}).",
        "known_time": "{title} ({day}): {time}.",
        "known_venue": "{title} ({day}) is at {venue}.",
        "known_artist": "{title} ({day}): {artist}.",
        "booking": "Tickets, tables and VIP experiences for Cartagena Music Week are handled by the concierge. "
                   "Send your request from the program or message us on WhatsApp: "
                   "a concierge will contact you.",
        "booking_event": "For {title} ({day}), send your request from the program or message us on WhatsApp: "
                         "a concierge will contact you.",
        "dir_catalog": "{title} ({day}) is at {venue}: open its page in AMO for directions.",
        "dir_name_only": "The official program only names the venue of {title} ({day}): {venue}. "
                         "The address is to be confirmed — the concierge can help you.",
        "dir_tba": "The venue of {title} ({day}) is to be confirmed — the concierge can help you.",
        "dir_boarding": "The boarding point of {title} ({day}) is to be confirmed. The concierge coordinates transfers.",
        "transfers": "The concierge coordinates transfers.",
        "dir_general": "To get around the city and reach the events, see the transport guide in AMO. "
                       "The concierge coordinates transfers.",
        "city_header": "City agenda:",
        "unavailable": "I can't load the official program right now. The Cartagena Music Week concierge can help "
                       "you: {phone} (WhatsApp).",
        "lbl_hub": "See the official program", "lbl_event": "See the event", "lbl_wa": "Message the concierge",
        "lbl_partner": "See the venue", "lbl_city": "Getting around the city",
        "sugg1": "Music Week program", "sugg2": "Request access to Music Week",
    },
    "fr": {
        "official": "Programme officiel Cartagena Music Week",
        "overview": "{official} · {range} · {days}.",
        "before_today": "Cartagena Music Week n'a pas encore commencé : du {start} au {end}. Voici le programme officiel :",
        "after": "Cartagena Music Week a eu lieu du {start} au {end} et c'est terminé.",
        "day_lead": "{official} · {day} :",
        "day_none": "Ce jour n'est pas au programme : Cartagena Music Week va du {start} au {end}. Voici le programme officiel :",
        "today": "aujourd'hui", "tomorrow": "demain",
        "venue_tba": "lieu à confirmer", "time_tba": "heure à confirmer", "artist_tba": "artiste à confirmer",
        "price_tba": "prix à confirmer", "boarding_tba": "point d'embarquement à confirmer",
        "price_line": "Prix : à confirmer (demande au concierge).",
        "price_known": "Prix : {price}.",
        "concierge": "Concierge Cartagena Music Week : {phone} (WhatsApp).",
        "tba_artist": "L'artiste est encore à confirmer — le concierge peut t'aider.",
        "tba_time": "L'heure est encore à confirmer — le concierge peut t'aider.",
        "tba_price": "Le prix est encore à confirmer — le concierge peut t'aider.",
        "tba_venue": "Le lieu est encore à confirmer — le concierge peut t'aider.",
        "tba_boarding_point": "Le point d'embarquement est encore à confirmer — le concierge peut t'aider.",
        "no_lineup": "Le programme officiel n'annonce pas d'artistes pour {title} — le concierge peut t'aider.",
        "vsg_note": "Le programme officiel annonce un Very Special Guest pour le Main Event ({days}).",
        "known_time": "{title} ({day}) : {time}.",
        "known_venue": "{title} ({day}) a lieu à {venue}.",
        "known_artist": "{title} ({day}) : {artist}.",
        "booking": "Les entrées, tables et expériences VIP de Cartagena Music Week passent par le concierge. "
                   "Envoie ta demande depuis le programme ou écris-nous sur WhatsApp : "
                   "un concierge te contactera.",
        "booking_event": "Pour {title} ({day}), envoie ta demande depuis le programme ou écris-nous sur WhatsApp : "
                         "un concierge te contactera.",
        "dir_catalog": "{title} ({day}) a lieu à {venue} : ouvre sa fiche dans AMO pour l'itinéraire.",
        "dir_name_only": "Le programme officiel n'indique que le nom du lieu de {title} ({day}) : {venue}. "
                         "L'adresse est à confirmer — le concierge peut t'aider.",
        "dir_tba": "Le lieu de {title} ({day}) est à confirmer — le concierge peut t'aider.",
        "dir_boarding": "Le point d'embarquement de {title} ({day}) est à confirmer. Le concierge coordonne les transferts.",
        "transfers": "Le concierge coordonne les transferts.",
        "dir_general": "Pour te déplacer en ville et rejoindre les événements, consulte le guide transport dans AMO. "
                       "Le concierge coordonne les transferts.",
        "city_header": "Agenda de la ville :",
        "unavailable": "Je ne peux pas charger le programme officiel pour le moment. Le concierge de Cartagena Music "
                       "Week peut t'aider : {phone} (WhatsApp).",
        "lbl_hub": "Voir le programme officiel", "lbl_event": "Voir l'événement", "lbl_wa": "Écrire au concierge",
        "lbl_partner": "Voir le lieu", "lbl_city": "Se déplacer en ville",
        "sugg1": "Programme de Music Week", "sugg2": "Demander l'accès à Music Week",
    },
    "pt": {
        "official": "Programa oficial da Cartagena Music Week",
        "overview": "{official} · {range} · {days}.",
        "before_today": "A Cartagena Music Week ainda não começou: vai de {start} a {end}. Este é o programa oficial:",
        "after": "A Cartagena Music Week foi de {start} a {end} e já terminou.",
        "day_lead": "{official} · {day}:",
        "day_none": "Esse dia não está no programa: a Cartagena Music Week vai de {start} a {end}. Este é o programa oficial:",
        "today": "hoje", "tomorrow": "amanhã",
        "venue_tba": "local a confirmar", "time_tba": "horário a confirmar", "artist_tba": "artista a confirmar",
        "price_tba": "preço a confirmar", "boarding_tba": "ponto de embarque a confirmar",
        "price_line": "Preço: a confirmar (consulte o concierge).",
        "price_known": "Preço: {price}.",
        "concierge": "Concierge Cartagena Music Week: {phone} (WhatsApp).",
        "tba_artist": "O artista ainda está a confirmar — o concierge pode ajudar você.",
        "tba_time": "O horário ainda está a confirmar — o concierge pode ajudar você.",
        "tba_price": "O preço ainda está a confirmar — o concierge pode ajudar você.",
        "tba_venue": "O local ainda está a confirmar — o concierge pode ajudar você.",
        "tba_boarding_point": "O ponto de embarque ainda está a confirmar — o concierge pode ajudar você.",
        "no_lineup": "O programa oficial não anuncia artistas para {title} — o concierge pode ajudar você.",
        "vsg_note": "O programa oficial anuncia um Very Special Guest para o Main Event ({days}).",
        "known_time": "{title} ({day}): {time}.",
        "known_venue": "{title} ({day}) é no {venue}.",
        "known_artist": "{title} ({day}): {artist}.",
        "booking": "Ingressos, mesas e experiências VIP da Cartagena Music Week são tratados pelo concierge. "
                   "Envie seu pedido pelo programa ou escreva no WhatsApp: "
                   "um concierge vai entrar em contato com você.",
        "booking_event": "Para {title} ({day}), envie seu pedido pelo programa ou escreva no WhatsApp: "
                         "um concierge vai entrar em contato com você.",
        "dir_catalog": "{title} ({day}) é no {venue}: abra a página dele no AMO para ver como chegar.",
        "dir_name_only": "O programa oficial só indica o nome do local de {title} ({day}): {venue}. "
                         "O endereço está a confirmar — o concierge pode ajudar você.",
        "dir_tba": "O local de {title} ({day}) está a confirmar — o concierge pode ajudar você.",
        "dir_boarding": "O ponto de embarque de {title} ({day}) está a confirmar. O concierge coordena os traslados.",
        "transfers": "O concierge coordena os traslados.",
        "dir_general": "Para se locomover pela cidade e chegar aos eventos, veja o guia de transporte no AMO. "
                       "O concierge coordena os traslados.",
        "city_header": "Agenda da cidade:",
        "unavailable": "Não consigo carregar o programa oficial agora. O concierge da Cartagena Music Week pode "
                       "ajudar você: {phone} (WhatsApp).",
        "lbl_hub": "Ver programa oficial", "lbl_event": "Ver evento", "lbl_wa": "Falar com o concierge",
        "lbl_partner": "Ver local", "lbl_city": "Como se locomover pela cidade",
        "sugg1": "Programa da Music Week", "sugg2": "Solicitar acesso à Music Week",
    },
}


def _lang(lang: Any) -> str:
    return lang if lang in LANGS else "es"


def _l4(v: Any, lang: str) -> str:
    if isinstance(v, Mapping):
        s = v.get(lang) or v.get("es") or ""
        return str(s).strip()
    return str(v).strip() if isinstance(v, str) else ""


def intent_default() -> Dict[str, Any]:
    return {"is_cmw": False, "kind": "program", "date": None, "event_id": None, "dates": [], "event_ids": [],
            "field": None, "range": "upcoming", "keywords": []}


# ── window helpers ──────────────────────────────────────────────────────────────────────────


def _base_window() -> Optional[Tuple[date, date]]:
    try:
        return cmw.window(cmw.load_program())
    except Exception as exc:  # noqa: BLE001 — no base program: the detector still works on keywords
        logger.error("[cmw] base program unavailable for Luna: %s", type(exc).__name__)
        return None


def _window_dates(win: Optional[Tuple[date, date]]) -> List[date]:
    if win is None:
        return []
    return [win[0] + timedelta(days=i) for i in range((win[1] - win[0]).days + 1)]


def _today(now: Optional[datetime]) -> date:
    return cmw.bogota_date(now)


# ── intent detection ────────────────────────────────────────────────────────────────────────


def _keywords(t: str) -> List[Tuple[str, int, int]]:
    out: List[Tuple[str, int, int]] = []
    for name, rx in _KW_RES:
        for m in rx.finditer(t):
            out.append((name, m.start(), m.end()))
    return out


def _blank(t: str, spans: Iterable[Tuple[int, int]]) -> str:
    chars = list(t)
    for a, b in spans:
        for i in range(a, min(b, len(chars))):
            chars[i] = " "
    return "".join(chars)


def _match_events(t: str) -> List[str]:
    """Event ids the text names, longest alias first, each matched span consumed once."""
    ids: List[str] = []
    rest = t
    for rx, targets in _ALIAS_RES:
        spans = [(m.start(), m.end()) for m in rx.finditer(rest)]
        if not spans:
            continue
        rest = _blank(rest, spans)
        for eid in targets:
            if eid not in ids:
                ids.append(eid)
    return ids


def _asked_dates(t: str, lang: str, today: date, win: Optional[Tuple[date, date]]) -> Tuple[List[date], str, bool]:
    """(dates inside the window, range key, explicit-outside) for the day words in `t`.
    An explicit date is resolved onto the program window by (month, day), whatever year the
    user typed or implied; relative words resolve against today (Bogotá)."""
    wdates = _window_dates(win)
    by_md = {(d.month, d.day): d for d in wdates}
    t2 = _STRIP_24_7_RE.sub("    ", t)
    found: List[date] = []
    outside = False
    explicit = False
    try:
        toks = _le._scan_tokens(t2, lang)
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] date scan failed: %s", type(exc).__name__)
        toks = []
    for tok in toks:
        if tok.kind == "md":
            explicit = True
            hits = sorted(by_md[md] for md in tok.md if md in by_md)
            if not hits:
                outside = True
            elif tok.every and len(hits) >= 2:
                lo, hi = hits[0], hits[-1]
                found.extend(d for d in wdates if lo <= d <= hi)
            else:
                found.extend(hits)
        elif tok.kind == "dom":
            explicit = True
            hits = [d for d in wdates if d.day == tok.dom]
            if hits:
                found.extend(hits)
            else:
                outside = True
        elif tok.kind == "wd":
            explicit = True
            hits = [d for d in wdates if d.weekday() == tok.wd and (d >= today or today > wdates[-1])]
            if not hits:
                hits = [d for d in wdates if d.weekday() == tok.wd]
            if hits:
                found.append(hits[0])
    if explicit:
        rng = f"date:{found[0].isoformat()}" if found else "upcoming"
        return sorted(set(found)), rng, outside
    try:
        rng = _le._detect_range(t2, lang, today)
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] range detection failed: %s", type(exc).__name__)
        rng = "upcoming"
    days: List[date] = []
    if rng in ("today", "tonight"):
        days = [today]
    elif rng.startswith("date:"):
        d = cmw.parse_ymd(rng[5:])
        days = [d] if d is not None else []
    elif rng in ("weekend", "week"):
        w = _le._window(rng, today)
        if w is not None:
            days = [w[0] + timedelta(days=i) for i in range((w[1] - w[0]).days + 1)]
    inside = [d for d in days if d in by_md.values()]
    return inside, rng, False   # a relative day outside the week is not an 'outside' date


def _kind_for(t: str, event_ids: Sequence[str], dates: Sequence[date], asked_day: bool,
              base: Optional[Mapping[str, Any]]) -> Tuple[str, Optional[str]]:
    """(kind, field). Booking and price/artist/time/venue questions win over the plain
    event/day/program shapes; a where/how-to-get question is 'directions' unless the base
    program prints no venue for every event asked (then it is a 'tba' venue question)."""
    if _PRICE_RE.search(t):
        return "tba", "price"
    if _BOOKING_RE.search(t):
        return "booking", None
    if _ARTIST_RE.search(t):
        return "tba", "artist"
    if _TIME_RE.search(t):
        return "tba", "time"
    if _WHERE_RE.search(t) or _TRANSFER_RE.search(t):
        if event_ids and base is not None:
            evs = [cmw.event_by_id(base, eid) for eid in event_ids]
            tags = [set(e.get("tba") or []) for e in evs if e is not None]
            if tags and all("boarding_point" in tg for tg in tags):
                return "tba", "boarding_point"
            if tags and all("venue" in tg for tg in tags):
                return "tba", "venue"
        return "directions", None
    if event_ids:
        return "event", None
    if dates or asked_day:
        return "day", None
    return "program", None


def _secondary_is_cmw(raw: str, t_days: str, dates: Sequence[date]) -> bool:
    """A question whose only CMW keyword is a printed title that is also an ordinary phrase
    ("main event", "after new year", "after temple", "catamaran sunset party") is CMW when the
    title is written as a proper noun, when it carries a program date, or when nothing else in
    it points elsewhere: no venue / dining intent and no other event or festival named."""
    if _TITLE_CASE_RE.search(raw) or dates:
        return True
    try:
        if _le._VENUE_INTENT_RE.search(t_days):
            return False
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] venue-intent check failed: %s", type(exc).__name__)
        return False
    return not _OTHER_EVENT_RE.search(t_days)


def detect_cmw_intent(text: Any, lang: Any = "es", now: Optional[datetime] = None) -> Dict[str, Any]:
    """§5 detector. CMW only when a CMW keyword is present: a question that only names a venue
    (Bellini, Casa Bohème) is NOT CMW. Pure: no I/O beyond the base program file (cached)."""
    lg = _lang(lang)
    out = intent_default()
    raw = text if isinstance(text, str) else ""
    t = _le.fold_keep(raw)
    if not t.strip():
        return out
    kws = _keywords(t)
    if not kws:
        return out
    try:
        base: Optional[Dict[str, Any]] = cmw.load_program()
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] base program unavailable for the detector: %s", type(exc).__name__)
        base = None
    win = cmw.window(base) if base is not None else None
    today = _today(now)
    event_ids = _match_events(t)
    # Day words are read with every CMW alias blanked ("After New Year" is a title, not a day).
    t_days = _blank(t, [(a, b) for _k, a, b in kws])
    for rx, _ids in _ALIAS_RES:
        t_days = _blank(t_days, [(m.start(), m.end()) for m in rx.finditer(t_days)])
    dates, rng, outside = _asked_dates(t_days, lg, today, win)
    names = {k for k, _a, _b in kws}
    if not (names & _ANCHOR_KWS) and not _secondary_is_cmw(raw, t_days, dates):
        return out          # "brunch after New Year's Day", "the main event at the Hay Festival"
    out["is_cmw"] = True
    out["keywords"] = sorted(names)
    if event_ids and dates and base is not None:
        on_days = {e.get("id") for d in dates for e in cmw.events_on(base, d)}
        narrowed = [eid for eid in event_ids if eid in on_days]
        if narrowed:
            event_ids = narrowed
    kind, field = _kind_for(t_days, event_ids, dates, outside or rng != "upcoming", base)
    out.update({
        "kind": kind, "field": field, "range": rng,
        "dates": [d.isoformat() for d in dates], "date": dates[0].isoformat() if dates else None,
        "event_ids": list(event_ids), "event_id": event_ids[0] if len(event_ids) == 1 else None,
        "asked_outside": outside,
    })
    return out


def _names_something_else(text: str, t: str) -> bool:
    """A venue / dining intent or an outside entity ("¿dónde queda Alquímico?") in a short
    question: it is about that, not a follow-up on Music Week. Follow-up vocabulary that the
    entity scanner returns ("vip", "main") does not count."""
    if _le._VENUE_INTENT_RE.search(t) or _OTHER_EVENT_RE.search(t):
        return True
    for ent in _le.query_entities(text):
        if not all(w in _FOLLOWUP_WORDS for w in str(ent).split()):
            return True
    return False


def _bare_followup(text: str) -> bool:
    """'¿Y a qué hora empieza?', 'how much?', 'où est-ce ?': a short question made only of
    follow-up vocabulary and function words (no venue, dish, place or other topic)."""
    t = _le.fold_keep(text)
    if len(t) > FOLLOWUP_MAX_CHARS or not _FOLLOWUP_CUE_RE.search(t):
        return False
    try:
        if _names_something_else(text, t):
            return False
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] follow-up check failed: %s", type(exc).__name__)
        return False
    words = re.findall(r"[a-z0-9']+", t)
    return bool(words) and all(w in _FOLLOWUP_WORDS or w in _le._ENTITY_STOP for w in words)


def _prev_user_text(history: Any, now: Optional[datetime]) -> Optional[str]:
    """The previous USER turn's text when it is at most 24 h old, else None."""
    if not isinstance(history, list) or not history:
        return None
    for m in reversed(history):
        if not isinstance(m, Mapping) or m.get("role") != "user":
            continue
        content = m.get("content")
        if not isinstance(content, str) or not content.strip():
            return None
        ts = _eg.parse_iso(m.get("created_at"))
        if ts is not None and _eg.as_utc(now) - ts > FOLLOWUP_MAX_AGE:
            return None
        return content
    return None


def in_cmw_context(history: Any, text: Any, lang: str, now: Optional[datetime]) -> bool:
    """True when the previous user turn (≤ 24 h ago) was a CMW question and this turn reads as
    a follow-up about it: short, asking a time / price / who / where / tickets question, and
    naming no venue, dish, other event or outside entity. The LLM's reply must then not state
    a time, a price, a venue or a name for it (guard_turn `cmw_context`)."""
    try:
        prev_text = _prev_user_text(history, now)
        if not prev_text:
            return False
        raw = text if isinstance(text, str) else ""
        t = _le.fold_keep(raw)
        if len(t) > FOLLOWUP_MAX_CHARS or not _FOLLOWUP_CUE_RE.search(t):
            return False
        if _names_something_else(raw, t):
            return False        # "¿dónde queda Alquímico?" is about Alquímico
        return bool(detect_cmw_intent(prev_text, lang, now).get("is_cmw"))
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] context check failed: %s", type(exc).__name__)
        return False


def followup_intent(history: Any, text: str, lang: str, now: Optional[datetime]) -> Optional[Dict[str, Any]]:
    """When the previous USER turn (≤ 24 h ago) was CMW and this turn is a bare follow-up, the
    CMW intent of this turn: the previous events/dates with this turn's question kind."""
    prev_text = _prev_user_text(history, now)
    if prev_text is None or not _bare_followup(text):
        return None
    prev = detect_cmw_intent(prev_text, lang, now)
    if not prev.get("is_cmw"):
        return None
    cur = detect_cmw_intent(f"{prev_text} {text}", lang, now)
    cur["followup"] = True
    return cur


# ── answer building ─────────────────────────────────────────────────────────────────────────


def _day(d: Any, lang: str, today: Optional[date] = None) -> str:
    dd = d if isinstance(d, date) else cmw.parse_ymd(d)
    if dd is None:
        return ""
    label = cmw.day_label(dd, lang, year=False)
    if today is not None and dd == today:
        return f"{_T[lang]['today']}, {label}"
    if today is not None and dd == today + timedelta(days=1):
        return f"{_T[lang]['tomorrow']}, {label}"
    return label


def _venue_text(ev: Mapping[str, Any], lang: str) -> str:
    t = _T[lang]
    tba = set(ev.get("tba") or [])
    name = ev.get("venue_name")
    if isinstance(name, str) and name.strip() and "venue" not in tba:
        return name.strip()
    if "boarding_point" in tba:
        return t["boarding_tba"]
    return t["venue_tba"]


def _time_text(ev: Mapping[str, Any], lang: str) -> str:
    t = _T[lang]
    st, et = ev.get("time"), ev.get("end_time")
    if isinstance(st, str) and st and "time" not in set(ev.get("tba") or []):
        return f"{st}–{et}" if isinstance(et, str) and et else st
    return t["time_tba"]


def _artist_text(ev: Mapping[str, Any], lang: str) -> str:
    status, artist = ev.get("artist_status"), ev.get("artist")
    if status == "tba":
        return f"{PLACEHOLDER_ARTIST} ({_T[lang]['artist_tba']})"
    if status == "confirmed" and isinstance(artist, str) and artist.strip():
        return artist.strip()
    return ""


def _line(ev: Mapping[str, Any], lang: str, *, with_day: bool = False, today: Optional[date] = None) -> str:
    title = str(ev.get("title"))
    if with_day:
        title = f"{title} ({_day(ev.get('date'), lang, today)})"
    parts = [f"• {title} — {_venue_text(ev, lang)} · {_time_text(ev, lang)}"]
    art = _artist_text(ev, lang)
    if art:
        parts.append(f" · {art}")
    return "".join(parts)


def _day_block(program: Mapping[str, Any], d: date, lang: str, today: Optional[date]) -> List[str]:
    evs = cmw.events_on(program, d)
    if not evs:
        return []
    return [f"{_day(d, lang, today)}:"] + [_line(e, lang) for e in evs]


def _overview_lines(program: Mapping[str, Any], lang: str, today: Optional[date] = None) -> List[str]:
    out: List[str] = []
    for d in _window_dates(cmw.window(program)):
        out.extend(_day_block(program, d, lang, today))
    return out


def _brand(program: Mapping[str, Any]) -> Mapping[str, Any]:
    b = program.get("brand")
    return b if isinstance(b, Mapping) else {}


def _range(program: Mapping[str, Any], lang: str) -> Tuple[str, str, str]:
    b = _brand(program)
    return cmw.day_label(b.get("start_date"), lang), cmw.day_label(b.get("end_date"), lang), cmw.range_label(b, lang)


def _concierge_line(program: Mapping[str, Any], lang: str) -> str:
    raw_con = _brand(program).get("concierge")
    con: Mapping[str, Any] = raw_con if isinstance(raw_con, Mapping) else {}
    phone = str(con.get("display") or CONCIERGE_DISPLAY)
    note = _l4(con.get("assistant_note"), lang)
    line = _T[lang]["concierge"].format(phone=phone)
    return f"{line} {note}".strip()


def _wa_action(program: Mapping[str, Any], ev: Optional[Mapping[str, Any]], lang: str) -> Dict[str, Any]:
    return {"type": "external_link", "url": cmw.whatsapp_url(ev, lang, brand=_brand(program)),
            "label": _T[lang]["lbl_wa"]}


def _hub_action(lang: str, event_id: Optional[str] = None) -> Dict[str, Any]:
    if event_id:
        return {"type": "external_link", "url": f"{HUB_URL}/{event_id}", "label": _T[lang]["lbl_event"]}
    return {"type": "external_link", "url": HUB_URL, "label": _T[lang]["lbl_hub"]}


def _partner_action(ev: Mapping[str, Any], lang: str) -> Optional[Dict[str, Any]]:
    venue = ev.get("venue")
    if isinstance(venue, Mapping) and isinstance(venue.get("id"), str) and venue["id"]:
        return {"type": "open_partner", "partner_id": venue["id"], "label": _T[lang]["lbl_partner"]}
    return None


def _city_action(lang: str) -> Dict[str, Any]:
    return {"type": "navigate", "screen": "ciudad", "label": _T[lang]["lbl_city"]}


def _venue_card(ev: Mapping[str, Any], lang: str) -> Optional[Dict[str, Any]]:
    """Partner card for a catalog venue, built only from the program's resolved venue."""
    venue = ev.get("venue")
    if not isinstance(venue, Mapping) or not isinstance(venue.get("id"), str) or not venue["id"]:
        return None
    hood = venue.get("neighborhood")
    return {
        "kind": "partner", "partner_id": venue["id"],
        "name": str(venue.get("name") or ev.get("venue_name") or "")[:80],
        "type": "", "vibe": _T[lang]["official"][:120], "price_range": "",
        "address": str(hood)[:100] if isinstance(hood, str) else "",
        "reason": f"{ev.get('title')} · {_day(ev.get('date'), lang)}"[:160],
    }


def _payload(message: str, lang: str, actions: Sequence[Dict[str, Any]],
             recs: Optional[Sequence[Dict[str, Any]]] = None) -> Dict[str, Any]:
    seen: Set[str] = set()
    acts: List[Dict[str, Any]] = []
    for a in actions:
        key = f"{a.get('type')}|{a.get('url') or a.get('partner_id') or a.get('screen')}"
        if key in seen:
            continue
        seen.add(key)
        acts.append(dict(a))
    return {
        "message": message.strip(),
        "language": lang,
        "actions": acts[:4],
        "recommendations": [dict(r) for r in (recs or [])][:8],
        "suggestions": [_T[lang]["sugg1"], _T[lang]["sugg2"]],
    }


def _events_for(program: Mapping[str, Any], intent: Mapping[str, Any]) -> List[Dict[str, Any]]:
    ids = [i for i in (intent.get("event_ids") or []) if isinstance(i, str)]
    if not ids and isinstance(intent.get("event_id"), str):
        ids = [str(intent["event_id"])]
    out: List[Dict[str, Any]] = []
    for eid in ids:
        ev = cmw.event_by_id(program, eid)
        if ev is not None:
            out.append(ev)
    return out


def _overview_payload(program: Mapping[str, Any], lang: str, lead: str, *, today: Optional[date],
                      booking: bool = True) -> Dict[str, Any]:
    lines = [lead] + _overview_lines(program, lang, today) + ["", _concierge_line(program, lang)]
    actions: List[Dict[str, Any]] = [_hub_action(lang)]
    if booking:
        actions.append(_wa_action(program, None, lang))
    return _payload("\n".join(lines), lang, actions)


def _after_payload(program: Mapping[str, Any], lang: str) -> Dict[str, Any]:
    s, e, _r = _range(program, lang)
    return _payload(_T[lang]["after"].format(start=s, end=e), lang, [_hub_action(lang)])


def _program_answer(program: Mapping[str, Any], lang: str, now: Optional[datetime]) -> Dict[str, Any]:
    t = _T[lang]
    today = _today(now)
    ph = cmw.phase(program, now)
    if ph == "after":
        return _after_payload(program, lang)
    b = _brand(program)
    s, e, r = _range(program, lang)
    lead = t["overview"].format(official=t["official"], range=r, days=_l4(b.get("days_label"), lang) or "")
    lead = lead.replace(" · .", ".")
    return _overview_payload(program, lang, lead, today=today if ph == "during" else None)


def _day_answer(program: Mapping[str, Any], intent: Mapping[str, Any], lang: str,
                now: Optional[datetime]) -> Dict[str, Any]:
    t = _T[lang]
    today = _today(now)
    ph = cmw.phase(program, now)
    s, e, _r = _range(program, lang)
    dates = [d for d in (cmw.parse_ymd(x) for x in intent.get("dates") or []) if d is not None]
    if ph == "after":
        return _after_payload(program, lang)
    if not dates:
        lead = t["before_today"] if ph == "before" and not intent.get("asked_outside") else t["day_none"]
        return _overview_payload(program, lang, lead.format(start=s, end=e), today=today if ph == "during" else None)
    lines: List[str] = []
    if len(dates) == 1:
        block = _day_block(program, dates[0], lang, today if ph == "during" else None)
        if block:
            lines.append(t["day_lead"].format(official=t["official"], day=block[0].rstrip(":")))
            lines.extend(block[1:])
    else:
        lines.append(t["official"] + ":")
        for d in dates:
            lines.extend(_day_block(program, d, lang, today if ph == "during" else None))
    if len(lines) <= 1:
        return _overview_payload(program, lang, t["day_none"].format(start=s, end=e),
                                 today=today if ph == "during" else None)
    lines += ["", _concierge_line(program, lang)]
    evs = [e for d in dates for e in cmw.events_on(program, d)]
    only = evs[0] if len(evs) == 1 else None
    actions = [_hub_action(lang, only.get("id") if only else None), _wa_action(program, only, lang)]
    return _payload("\n".join(lines), lang, actions)


def _event_answer(program: Mapping[str, Any], evs: Sequence[Mapping[str, Any]], lang: str,
                  now: Optional[datetime]) -> Dict[str, Any]:
    t = _T[lang]
    today = _today(now) if cmw.phase(program, now) == "during" else None
    if cmw.phase(program, now) == "after":
        return _after_payload(program, lang)
    lines: List[str] = [t["official"] + ":"]
    actions: List[Dict[str, Any]] = []
    for ev in evs:
        lines.append(f"{_day(ev.get('date'), lang, today)}:")
        lines.append(_line(ev, lang))
        if len(evs) == 1:
            desc = _l4(ev.get("description"), lang)
            if desc:
                lines.append(desc)
            price = ev.get("price_info")
            if price and "price" not in set(ev.get("tba") or []):
                lines.append(t["price_known"].format(price=_l4(price, lang)))
            else:
                lines.append(t["price_line"])
    lines += ["", _concierge_line(program, lang)]
    only = evs[0] if len(evs) == 1 else None
    actions.append(_hub_action(lang, only.get("id") if only else None))
    actions.append(_wa_action(program, only, lang))
    for ev in evs:
        pa = _partner_action(ev, lang)
        if pa:
            actions.append(pa)
    return _payload("\n".join(lines), lang, actions)


def _tba_answer(program: Mapping[str, Any], evs: Sequence[Mapping[str, Any]], field: str, lang: str,
                now: Optional[datetime]) -> Dict[str, Any]:
    """The honest answer for an artist / time / price / venue / boarding-point question: the
    program's value when it is confirmed, else 'por confirmar' plus the concierge."""
    t = _T[lang]
    if cmw.phase(program, now) == "after":
        return _after_payload(program, lang)
    today = _today(now) if cmw.phase(program, now) == "during" else None
    lines: List[str] = []
    targets = list(evs) if evs else [e for e in program.get("events") or [] if isinstance(e, Mapping)
                                     and e.get("artist_status") == "tba"] if field == "artist" else list(evs)
    if field == "artist" and not evs:
        days = ", ".join(_day(e.get("date"), lang) for e in targets)
        if days:
            lines.append(t["vsg_note"].format(days=days))
        lines.append(t["tba_artist"])
    else:
        for ev in targets:
            tba = set(ev.get("tba") or [])
            day = _day(ev.get("date"), lang, today)
            title = str(ev.get("title"))
            if field == "artist":
                if ev.get("artist_status") == "confirmed" and isinstance(ev.get("artist"), str):
                    lines.append(t["known_artist"].format(title=title, day=day, artist=ev["artist"]))
                elif ev.get("artist_status") == "tba":
                    lines.append(f"{title} ({day}): {PLACEHOLDER_ARTIST}. {t['tba_artist']}")
                else:
                    lines.append(t["no_lineup"].format(title=title))
            elif field == "time":
                if "time" not in tba and isinstance(ev.get("time"), str):
                    lines.append(t["known_time"].format(title=title, day=day, time=_time_text(ev, lang)))
                else:
                    lines.append(f"{title} ({day}): {t['tba_time']}")
            elif field == "price":
                if "price" not in tba and ev.get("price_info"):
                    lines.append(f"{title} ({day}): {t['price_known'].format(price=_l4(ev.get('price_info'), lang))}")
                else:
                    lines.append(f"{title} ({day}): {t['tba_price']}")
            elif field == "boarding_point":
                lines.append(f"{title} ({day}): {t['tba_boarding_point']} {t['transfers']}")
            else:
                if "venue" not in tba and isinstance(ev.get("venue_name"), str) and ev["venue_name"].strip():
                    lines.append(t["known_venue"].format(title=title, day=day, venue=ev["venue_name"].strip()))
                else:
                    lines.append(f"{title} ({day}): {t['tba_venue']}")
        if not lines:
            lines.append(t["tba_" + field] if field in TBA_FIELDS else t["tba_artist"])
    lines += ["", _concierge_line(program, lang)]
    only = evs[0] if len(evs) == 1 else None
    actions = [_wa_action(program, only, lang), _hub_action(lang, only.get("id") if only else None)]
    for ev in evs:
        pa = _partner_action(ev, lang)
        if pa and field == "venue":
            actions.append(pa)
    return _payload("\n".join(lines), lang, actions)


def _booking_answer(program: Mapping[str, Any], evs: Sequence[Mapping[str, Any]], lang: str,
                    now: Optional[datetime]) -> Dict[str, Any]:
    t = _T[lang]
    if cmw.phase(program, now) == "after":
        return _after_payload(program, lang)
    today = _today(now) if cmw.phase(program, now) == "during" else None
    lines: List[str] = [t["booking"]]
    if len(evs) == 1:
        ev = evs[0]
        lines = [_line(ev, lang, with_day=True, today=today),
                 t["booking_event"].format(title=ev.get("title"), day=_day(ev.get("date"), lang, today))]
    elif evs:
        lines = [_line(ev, lang, with_day=True, today=today) for ev in evs] + [t["booking"]]
    lines += ["", _concierge_line(program, lang)]
    only = evs[0] if len(evs) == 1 else None
    actions = [_hub_action(lang, only.get("id") if only else None), _wa_action(program, only, lang)]
    return _payload("\n".join(lines), lang, actions)


def _directions_answer(program: Mapping[str, Any], evs: Sequence[Mapping[str, Any]], lang: str,
                       now: Optional[datetime]) -> Dict[str, Any]:
    t = _T[lang]
    if cmw.phase(program, now) == "after":
        return _after_payload(program, lang)
    today = _today(now) if cmw.phase(program, now) == "during" else None
    lines: List[str] = []
    actions: List[Dict[str, Any]] = []
    recs: List[Dict[str, Any]] = []
    for ev in evs:
        tba = set(ev.get("tba") or [])
        title, day = str(ev.get("title")), _day(ev.get("date"), lang, today)
        raw_name = ev.get("venue_name")
        venue_name: str = raw_name if isinstance(raw_name, str) else ""
        card = _venue_card(ev, lang)
        if "boarding_point" in tba:
            lines.append(t["dir_boarding"].format(title=title, day=day))
        elif "venue" in tba or not venue_name.strip():
            lines.append(t["dir_tba"].format(title=title, day=day))
        elif card is not None:
            lines.append(t["dir_catalog"].format(title=title, day=day, venue=venue_name.strip()))
            if not any(r.get("partner_id") == card.get("partner_id") for r in recs):
                recs.append(card)      # one card per venue (Zamna + Wellness share Bellini)
            pa = _partner_action(ev, lang)
            if pa:
                actions.append(pa)
        else:
            lines.append(t["dir_name_only"].format(title=title, day=day, venue=venue_name.strip()))
    if not evs:
        lines.append(t["dir_general"])
        for pr in _brand(program).get("practical") or []:
            if isinstance(pr, Mapping) and pr.get("key") in ("getting_here", "getting_around", "boats"):
                body = _l4(pr.get("body"), lang)
                if body:
                    lines.append(f"• {_l4(pr.get('title'), lang)}: {body}")
    elif not any(t["transfers"] in ln for ln in lines):
        lines.append(t["transfers"])
    lines += ["", _concierge_line(program, lang)]
    actions.append(_city_action(lang))
    only = evs[0] if len(evs) == 1 else None
    actions.append(_wa_action(program, only, lang))
    actions.append(_hub_action(lang, only.get("id") if only else None))
    return _payload("\n".join(lines), lang, actions, recs)


def answer(program: Mapping[str, Any], intent: Mapping[str, Any], lang: Any = "es",
           now: Optional[datetime] = None) -> Dict[str, Any]:
    """§5: deterministic answer from the (merged) program only. No LLM."""
    lg = _lang(lang)
    kind = str(intent.get("kind") or "program")
    evs = _events_for(program, intent)
    if not evs and kind in ("tba", "booking", "directions"):
        days = [d for d in (cmw.parse_ymd(x) for x in intent.get("dates") or []) if d is not None]
        evs = [e for d in days for e in cmw.events_on(program, d)]
    if kind == "booking":
        return _booking_answer(program, evs, lg, now)
    if kind == "directions":
        return _directions_answer(program, evs, lg, now)
    if kind == "tba":
        field = str(intent.get("field") or "artist")
        return _tba_answer(program, evs, field if field in TBA_FIELDS else "artist", lg, now)
    if kind == "event" and evs:
        return _event_answer(program, evs, lg, now)
    if kind == "day":
        return _day_answer(program, intent, lg, now)
    return _program_answer(program, lg, now)


def unavailable_payload(lang: Any = "es") -> Dict[str, Any]:
    lg = _lang(lang)
    msg = _T[lg]["unavailable"].format(phone=CONCIERGE_DISPLAY)
    wa = {"type": "external_link", "url": cmw.whatsapp_url(None, lg), "label": _T[lg]["lbl_wa"]}
    return _payload(msg, lg, [wa, _hub_action(lg)])


# ── the combined answer (during the week, a GENERAL event question) ─────────────────────────


def cmw_dates_for_range(program: Mapping[str, Any], range_key: str, now: Optional[datetime]) -> List[date]:
    """The program days a luna_events range covers ('today', 'tonight', 'weekend', 'week',
    'date:<ymd>', 'upcoming' = the rest of the week from today)."""
    today = _today(now)
    win = cmw.window(program)
    wdates = _window_dates(win)
    if not wdates:
        return []
    rk = range_key or "upcoming"
    if rk in ("today", "tonight"):
        days = [today]
    elif rk.startswith("date:"):
        d = cmw.parse_ymd(rk[5:])
        days = [d] if d is not None else []
    elif rk in ("weekend", "week"):
        w = _le._window(rk, today)
        days = [w[0] + timedelta(days=i) for i in range((w[1] - w[0]).days + 1)] if w is not None else []
    else:
        days = [d for d in wdates if d >= today]
    return [d for d in days if d in wdates and cmw.events_on(program, d)]


def combined_answer(program: Mapping[str, Any], dates: Sequence[date], city: Mapping[str, Any], lang: Any,
                    now: Optional[datetime] = None) -> Dict[str, Any]:
    """The official program for the asked days FIRST (clearly labelled), then the verified city
    agenda exactly as luna_events would have answered (its decline or its grounded list)."""
    lg = _lang(lang)
    t = _T[lg]
    today = _today(now)
    lines: List[str] = []
    if len(dates) == 1:
        block = _day_block(program, dates[0], lg, today)
        lines.append(t["day_lead"].format(official=t["official"], day=block[0].rstrip(":") if block else _day(dates[0], lg, today)))
        lines.extend(block[1:])
    else:
        lines.append(t["official"] + ":")
        for d in dates:
            lines.extend(_day_block(program, d, lg, today))
    city_msg = str(city.get("message") or "").strip()
    if city_msg:
        lines += ["", t["city_header"], city_msg]
    evs = [e for d in dates for e in cmw.events_on(program, d)]
    only = evs[0] if len(evs) == 1 else None
    actions: List[Dict[str, Any]] = [_hub_action(lg, only.get("id") if only else None), _wa_action(program, only, lg)]
    actions += [dict(a) for a in (city.get("actions") or []) if isinstance(a, Mapping)]
    recs = [dict(r) for r in (city.get("recommendations") or []) if isinstance(r, Mapping)]
    out = _payload("\n".join(lines), lg, actions, recs)
    out["suggestions"] = [t["sugg1"]] + [str(s) for s in (city.get("suggestions") or [])[:1] if isinstance(s, str)]
    return out


# ── the hook ────────────────────────────────────────────────────────────────────────────────


def _strip_terms(text: str) -> str:
    """The text with every CMW keyword, alias and printed title blanked (same length)."""
    t = _le.fold_keep(text)
    spans = [(a, b) for _k, a, b in _keywords(t)]
    for rx, _ids in _ALIAS_RES:
        spans += [(m.start(), m.end()) for m in rx.finditer(t)]
    try:
        titles = [str(e.get("title") or "") for e in cmw.load_program().get("events") or [] if isinstance(e, Mapping)]
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] titles unavailable: %s", type(exc).__name__)
        titles = []
    for title in titles:
        folded = _le.fold_keep(title).strip()
        if folded:
            spans += [(m.start(), m.end()) for m in re.finditer(re.escape(folded), t)]
    return _blank(t, spans)


# Question words that decide the language of a short CMW question (folded text).
_LANG_Q: Dict[str, "re.Pattern[str]"] = {
    "es": re.compile(r"\b(?:quien(?:es)?|cual(?:es)?|donde|cuanto|cuesta|cuestan|entradas?|boletas?|hoy|manana|"
                     r"esta noche|quiero|quisiera|gracias|reservar|hay|como llego)\b"),
    "en": re.compile(r"\b(?:who|what|which|where|how much|tickets?|schedule|today|tonight|tomorrow|thanks|"
                     r"i want|book|is there|what's)\b"),
    "fr": re.compile(r"\b(?:qui|quel(?:le)?s?|ou est|ou a lieu|combien|coute|billets?|horaires?|aujourd'hui|"
                     r"demain|ce soir|je veux|merci|reserver|c'est)\b"),
    "pt": re.compile(r"\b(?:quem|qual|quais|onde|quanto|custa|ingressos?|programacao|voce|hoje|amanha|"
                     r"obrigad[oa]|quero|reservar|tem)\b"),
}


def guess_lang(text: Any, forced: Optional[str] = None) -> str:
    """The answer language: the app's forced language, else luna_events.guess_lang on the text
    with every CMW title / keyword removed ('Zamna on the Beach' is a brand, not English)."""
    if forced in LANGS:
        return str(forced)
    raw = text if isinstance(text, str) else ""
    try:
        stripped = _strip_terms(raw)
        scores = {lg: len(rx.findall(stripped)) for lg, rx in _LANG_Q.items()}
        best = max(scores.values())
        winners = [lg for lg, n in scores.items() if n == best]
        if best > 0 and len(winners) == 1:
            return winners[0]
        return _le.guess_lang(stripped)
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] language guess failed: %s", type(exc).__name__)
        return "es"


async def _program(db: Any) -> Optional[Dict[str, Any]]:
    try:
        return await cmw.merged_program(db)
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] Luna could not read the program: %s", type(exc).__name__)
        return None


async def gate(
    db: Any,
    user_text: Any,
    *,
    lang: Any = "es",
    history: Any = None,
    location: Any = None,
    now: Optional[datetime] = None,
) -> Optional[Dict[str, Any]]:
    """The run_agent_turn hook (§5), BEFORE the general events gate. Returns the deterministic
    payload for a CMW turn (or a general event question during the week), else None so the
    normal flow continues. Never raises."""
    text = user_text if isinstance(user_text, str) else ""
    lg = _lang(lang)
    try:
        intent = detect_cmw_intent(text, lg, now)
        if not intent.get("is_cmw"):
            fu = followup_intent(history, text, lg, now)
            if fu is not None:
                intent = fu
    except Exception as exc:  # noqa: BLE001 — a broken detector must not swallow the turn
        logger.error("[cmw] intent detection failed: %s", type(exc).__name__)
        intent = intent_default()
    if intent.get("is_cmw"):
        program = await _program(db)
        if program is None:
            return unavailable_payload(lg)
        try:
            return answer(program, intent, lg, now)
        except Exception as exc:  # noqa: BLE001 — never the LLM for a CMW question
            logger.error("[cmw] answer failed: %s", type(exc).__name__)
            return unavailable_payload(lg)

    # During the week, a GENERAL event question gets the official program first (§5, task 3).
    try:
        win = _base_window()
        if win is None or not (win[0] <= _today(now) <= win[1]):
            return None
        ev_intent = _le.detect_event_intent(text, lg, now=now)
        if not ev_intent.get("is_event"):
            return None
        if _le.query_entities(text):
            return None            # a named artist / event: not a general question
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] general-question check failed: %s", type(exc).__name__)
        return None
    program = await _program(db)
    if program is None:
        return None
    dates = cmw_dates_for_range(program, str(ev_intent.get("range") or "upcoming"), now)
    if not dates:
        return None
    try:
        city_gate = await _le.event_gate(db, ev_intent, lang=lg, location=location, query=text, now=now)
        city = city_gate.get("payload")
        if city is None:
            city = _le.grounded_payload(list(city_gate.get("rows") or []), lg, str(ev_intent.get("range") or "upcoming"),
                                        now=now)
    except Exception as exc:  # noqa: BLE001 — the city part fails closed to "nothing confirmed"
        logger.error("[cmw] city agenda read failed: %s", type(exc).__name__)
        city = _le.decline_payload(lg, [], [], kind="maintenance", now=now)
    try:
        return combined_answer(program, dates, city, lg, now)
    except Exception as exc:  # noqa: BLE001
        logger.error("[cmw] combined answer failed: %s", type(exc).__name__)
        return None


# ── the guard for non-CMW turns ─────────────────────────────────────────────────────────────


# Words of the program's own copy that are never a person: they sit next to CMW terms in every
# honest answer ("Programa oficial Cartagena Music Week", "Concierge Cartagena Music Week").
_CMW_VOCAB = frozenset("""
concierge programa program programme oficial official officiel whatsapp amo life app agenda ciudad city ville
cidade calendario calendar calendrier evento event evenement hoy today tonight aujourd hui hoje beach club
""".split())


def _copy_vocab() -> Set[str]:
    """Every word of this module's own localized copy (built once)."""
    if not _COPY_VOCAB:
        for table in _T.values():
            for v in table.values():
                _COPY_VOCAB.update(_le._norm_words(v).split())
    return _COPY_VOCAB


_COPY_VOCAB: Set[str] = set()


def _program_vocab(program: Mapping[str, Any]) -> Tuple[Set[str], Set[str], Set[str]]:
    """(known name tokens, program times, program month-days)."""
    toks: Set[str] = set()
    times: Set[str] = set()
    md: Set[Tuple[int, int]] = set()
    b = _brand(program)
    names: List[str] = [str(b.get("name") or ""), PLACEHOLDER_ARTIST, "Cartagena Music Week", "AMO Life", "AMO"]
    raw_con = b.get("concierge")
    con: Mapping[str, Any] = raw_con if isinstance(raw_con, Mapping) else {}
    names.append(str(con.get("assistant") or ""))
    for p in b.get("pillars") or []:
        if isinstance(p, Mapping):
            names.extend(_l4(p.get("label"), lg) for lg in LANGS)
    for key in ("days_label", "tagline", "access_note"):
        names.extend(_l4(b.get(key), lg) for lg in LANGS)
    for tg in b.get("taglines") or []:
        names.extend(_l4(tg, lg) for lg in LANGS)
    for sv in con.get("services") or []:
        names.extend(_l4(sv, lg) for lg in LANGS)
    for key in ("intro", "assistant_note"):
        names.extend(_l4(con.get(key), lg) for lg in LANGS)
    for pr in b.get("practical") or []:
        if isinstance(pr, Mapping):
            names.extend(_l4(pr.get(k), lg) for k in ("title", "body") for lg in LANGS)
    for ev in program.get("events") or []:
        if not isinstance(ev, Mapping):
            continue
        names.extend(str(ev.get(k) or "") for k in ("title", "venue_name"))
        venue = ev.get("venue")
        if isinstance(venue, Mapping):
            names.append(str(venue.get("name") or ""))
        if ev.get("artist_status") == "confirmed" and isinstance(ev.get("artist"), str):
            names.append(ev["artist"])
        for k in ("time", "end_time"):
            v = ev.get(k)
            if isinstance(v, str) and v:
                times.add(v)
        d = cmw.parse_ymd(ev.get("date"))
        if d is not None:
            md.add((d.month, d.day))
    for k in ("start_date", "end_date"):
        d = cmw.parse_ymd(b.get(k))
        if d is not None:
            md.add((d.month, d.day))
    for ev in program.get("events") or []:
        if isinstance(ev, Mapping):
            for key in ("description", "subtitle"):      # program copy is never a performer
                names.extend(_l4(ev.get(key), lg) for lg in LANGS)
    for n in names:
        toks.update(_le._norm_words(n).split())
    toks.update(_CMW_VOCAB)
    toks.update(_copy_vocab())
    toks.update(_le._MONTH_FULL)
    toks.update(_le._MONTH_ABBR)
    toks.update(_le._MONTH_PT_ONLY)
    toks.update(_le._WEEKDAYS)
    toks.update(_le._WEEKDAYS_PT_SHORT)
    md_all: Set[Tuple[int, int]] = set(md)
    return toks, times, {f"{m}-{d}" for m, d in md_all}


def _near(a: Tuple[int, int], b: Tuple[int, int], window: int) -> bool:
    return max(b[0] - a[1], a[0] - b[1], 0) <= window


def _same_sentence(t: str, a: Tuple[int, int], b: Tuple[int, int]) -> bool:
    lo, hi = min(a[1], b[1]), max(a[0], b[0])
    return not _SENT_BREAK_RE.search(t[lo:hi]) if hi > lo else True


def _sentence_initial(raw: str, pos: int) -> bool:
    """A capital at the start of a sentence / line / bullet is ordinary casing, not a name.
    A colon does NOT count: "Main Event: Shakira" is exactly the claim the guard exists for."""
    tail = raw[:pos].rstrip(" \t")
    return not tail or tail[-1] in "\n.!?;¿¡\"“(•"


@lru_cache(maxsize=1)
def _place_phrases() -> Tuple[str, ...]:
    """Normalized Cartagena place phrases (gazetteer names + aliases, landmark aliases): next to
    a CMW term one of these is an invented venue / boarding point unless the program names it."""
    out: Set[str] = set()
    for alias in _le.LANDMARK_ALIASES:
        n = _le._norm_words(alias)
        if n:
            out.add(n)
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "events_gazetteer.json")
    try:
        with open(path, encoding="utf-8") as f:
            rows = json.load(f)
        for r in rows if isinstance(rows, list) else []:
            if isinstance(r, Mapping):
                for name in [r.get("name")] + list(r.get("aliases") or []):
                    n = _le._norm_words(name) if isinstance(name, str) else ""
                    if n:
                        out.add(n)
    except Exception as exc:  # noqa: BLE001 — no gazetteer only makes the place rule narrower
        logger.error("[cmw] gazetteer unavailable for the guard: %s", type(exc).__name__)
    return tuple(sorted(out, key=len, reverse=True))


def find_cmw_violations(message: Any, program: Mapping[str, Any], lang: Any = "es", *,
                        known_names: Iterable[Any] = (), context: bool = False) -> List[Tuple[int, int]]:
    """§5 guard: spans where the text puts, next to a CMW term, a time the program does not
    state, a price, a person's name that is not in the program, a place the program does not
    name, a street address, a sale / sold-out / age / dress-code / capacity claim, or (same
    sentence) a date that is not in the program. Empty when the text never mentions CMW —
    unless `context` (the conversation is about Music Week): then the whole text counts as
    being next to a CMW term."""
    raw = message if isinstance(message, str) else ""
    if not raw.strip():
        return []
    lg = _lang(lang)
    t = _le.fold_keep(raw)
    terms = [(m.start(), m.end()) for m in _TERM_RE.finditer(t)]
    whole = False
    if not terms:
        if not context:
            return []
        terms, whole = [(0, len(t))], True       # the conversation IS the term
    known, times, mds = _program_vocab(program)
    for n in known_names:
        known.update(_le._norm_words(n).split())
    out: List[Tuple[int, int]] = []

    def flag(span: Tuple[int, int], window: int = GUARD_WINDOW, sentence: bool = False) -> None:
        for tm in terms:
            if _near(tm, span, window) and (not sentence or _same_sentence(t, tm, span)):
                out.append((min(tm[0], span[0]), max(tm[1], span[1])))
                return

    t2 = _STRIP_24_7_RE.sub("    ", t)
    for tok in _le._scan_tokens(t2, lg):
        if tok.kind == "time" and not (tok.times & times):
            flag((tok.start, tok.end))
        elif tok.kind == "md":
            cands = {f"{m}-{d}" for m, d in tok.md}
            ok = cands <= mds if tok.every else bool(cands & mds)
            if not ok:
                flag((tok.start, tok.end), GUARD_DATE_WINDOW, sentence=True)
    for m in _EXTRA_TIME_RE.finditer(t2):
        flag((m.start(), m.end()))
    for m in _PRICE_TEXT_RE.finditer(t2):
        flag((m.start(), m.end()))
    for m in _SALE_STATE_RE.finditer(t2):
        flag((m.start(), m.end()))
    for m in _ADDRESS_RE.finditer(t2):
        flag((m.start(), m.end()))
    stop = _le._ENTITY_STOP | _le._NAME_GENERIC_WORDS | _le._SENTENCE_START_WORDS
    # A Cartagena place the program does not name, next to a CMW term: an invented venue.
    for phrase in _place_phrases():
        if all(w in known or w in stop for w in phrase.split()):
            continue
        for m in re.finditer(r"\b" + r"\W+".join(re.escape(x) for x in phrase.split()) + r"\b", t2):
            flag((m.start(), m.end()))
    try:
        name_spans = _le._unknown_name_spans(raw, known)
    except Exception as exc:  # noqa: BLE001 — fail closed: treat as a violation
        logger.error("[cmw] name scan failed: %s", type(exc).__name__)
        name_spans = [(0, len(raw))]
    for span in name_spans:
        flag(span)
    inside = (lambda _pos: False) if whole else (lambda pos: any(a <= pos < b for a, b in terms))
    after_terms = list(_CAP_WORD_RE.finditer(raw)) if whole else \
        [mm for tm in terms for mm in _CAP_WORD_RE.finditer(raw, tm[1]) if mm.start() <= tm[1] + 60]
    for m in list(_NAME_CUE_RE.finditer(raw)) + after_terms:
        word = m.group(1)
        pos = m.start(1)
        if _sentence_initial(raw, pos):
            continue
        wtok = _le._alnum(_le.fold_keep(re.sub(r"^[LlDdJjCcSsNnMmTt]['’]|['’]s$", "", word)))
        if not wtok or len(wtok) < 3 or wtok in known or wtok in stop or wtok in _le._place_tokens():
            continue
        if inside(pos):
            continue
        flag((pos, pos + len(word)))
    # A performer cue followed by a lowercase name the program does not know ("dj solomun",
    # "el very special guest … es bad bunny"): casing never hides an invented act.
    for m in list(_LOWER_CUE_RE.finditer(t2)) + list(_COPULA_CUE_RE.finditer(t2)):
        run = m.group(1)
        pos = m.start(1)
        if inside(pos):
            continue
        toks = [_le._alnum(re.sub(r"^[ldjcsnmt]['’]", "", w)) for w in run.split()]   # "l'artiste" → artiste
        if any(len(w) >= 3 and w not in known and w not in stop and w not in _le._place_tokens() for w in toks):
            flag((pos, pos + len(run.rstrip())))
    return sorted(set(out))


def mentions_cmw(text: Any) -> bool:
    return bool(_TERM_RE.search(_le.fold_keep(text if isinstance(text, str) else "")))


def _cmw_link_label(url: Any, lg: str) -> Optional[str]:
    """The deterministic label for an action that opens the hub or the concierge WhatsApp."""
    u = str(url or "")
    if u.startswith(HUB_URL):
        return _T[lg]["lbl_hub"]
    if u.startswith(cmw.WA_BASE):
        return _T[lg]["lbl_wa"]
    return None


async def guard_turn(
    db: Any,
    payload: Mapping[str, Any],
    *,
    lang: Any = "es",
    now: Optional[datetime] = None,
    known_names: Iterable[Any] = (),
    cmw_context: bool = False,
) -> Dict[str, Any]:
    """§5 guard for NON-CMW turns. When the LLM message carries a violation, the message and
    the actions are replaced by the deterministic program answer; a rec field, an action label
    or a suggestion with a violation is blanked / dropped; an action that opens the hub or the
    concierge WhatsApp always carries the deterministic label (never "buy tickets" wording).
    `cmw_context` (the previous user turn was CMW): the message is checked as if it named
    Music Week, so a follow-up reply can never state a time, a price, a venue or a name.
    Payloads that never mention CMW (and are not in a CMW context) pass through untouched
    (no program read). Never raises: a guard that cannot run replaces a CMW-mentioning
    message."""
    out: Dict[str, Any] = dict(payload)
    lg = _lang(lang)
    strings: List[Any] = [out.get("message")]
    for r in out.get("recommendations") or []:
        if isinstance(r, Mapping):
            strings.extend(r.get(k) for k in ("name", "type", "vibe", "reason", "address"))
    strings.extend(a.get("label") for a in out.get("actions") or [] if isinstance(a, Mapping))
    strings.extend(out.get("suggestions") or [])
    cmw_links = any(_cmw_link_label(a.get("url"), lg) for a in out.get("actions") or [] if isinstance(a, Mapping))
    if not cmw_context and not cmw_links and not any(mentions_cmw(s) for s in strings if isinstance(s, str)):
        return out
    program = await _program(db)
    if program is None:
        try:
            program = cmw.load_program()
        except Exception as exc:  # noqa: BLE001
            logger.error("[cmw] guard has no program: %s", type(exc).__name__)
            program = None
    names = list(known_names)

    def bad(s: Any, *, context: bool = False) -> bool:
        if not isinstance(s, str) or not (context or mentions_cmw(s)):
            return False
        if program is None:
            return True
        try:
            return bool(find_cmw_violations(s, program, lg, known_names=names, context=context))
        except Exception as exc:  # noqa: BLE001
            logger.error("[cmw] guard failed: %s", type(exc).__name__)
            return True

    replaced = False
    if bad(out.get("message"), context=cmw_context):
        replaced = True
        if program is not None:
            det = _program_answer(program, lg, now)
        else:
            det = unavailable_payload(lg)
        out["message"] = det["message"]
        out["actions"] = det["actions"]
        out["suggestions"] = det["suggestions"]
        logger.warning("[cmw] guard replaced an LLM reply that contradicted the official program")
    recs: List[Dict[str, Any]] = []
    for r in out.get("recommendations") or []:
        if not isinstance(r, Mapping):
            continue
        d = dict(r)
        for k in ("type", "vibe", "reason", "address"):
            if bad(d.get(k)):
                d[k] = ""
        if bad(d.get("name")):
            d["name"] = ""
        recs.append(d)
    out["recommendations"] = recs
    if not replaced:
        acts: List[Dict[str, Any]] = []
        for a in out.get("actions") or []:
            if not isinstance(a, Mapping):
                continue
            d = dict(a)
            fixed = _cmw_link_label(d.get("url"), lg)
            if fixed is not None:
                d["label"] = fixed          # the LLM never words a hub / concierge link
            elif bad(d.get("label")):
                d["label"] = _le._NEUTRAL_LABEL[lg]
            acts.append(d)
        out["actions"] = acts
        out["suggestions"] = [s for s in out.get("suggestions") or [] if isinstance(s, str) and not bad(s)]
    return out


__all__: Sequence[str] = (
    "detect_cmw_intent", "answer", "combined_answer", "cmw_dates_for_range", "gate", "guard_turn",
    "find_cmw_violations", "mentions_cmw", "followup_intent", "in_cmw_context", "guess_lang", "unavailable_payload",
    "intent_default",
)
