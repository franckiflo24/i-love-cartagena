"""
Dump catalog data from local Mongo to /frontend/public/data/*.json
so the frontend can run in STATIC mode (no backend needed) for investor demos.

The output files mirror the GET API response shapes used by the app.

Usage:
    python3 scripts/dump_static.py
"""
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from pymongo import MongoClient

BACKEND = Path(__file__).resolve().parent.parent
FRONTEND = BACKEND.parent / "frontend"
OUT = FRONTEND / "public" / "data"
OUT.mkdir(parents=True, exist_ok=True)

# Load .env
try:
    from dotenv import load_dotenv
    load_dotenv(BACKEND / ".env")
except ImportError:
    pass

url = os.environ.get("MONGO_URL_LOCAL") or os.environ.get("MONGO_URL", "mongodb://localhost:27017")
db_name = os.environ.get("DB_NAME", "amo_cartagena")
db = MongoClient(url)[db_name]

print(f"dumping from {db_name} → {OUT}\n")


def clean(docs):
    """Strip _id and convert datetimes to ISO strings."""
    out = []
    for d in docs:
        d.pop("_id", None)
        for k, v in list(d.items()):
            if isinstance(v, datetime):
                d[k] = v.isoformat()
            elif isinstance(v, dict):
                for kk, vv in list(v.items()):
                    if isinstance(vv, datetime):
                        v[kk] = vv.isoformat()
        out.append(d)
    return out


def write(rel_path: str, data):
    """Write data to OUT/<rel_path>.json"""
    p = OUT / rel_path
    p.parent.mkdir(parents=True, exist_ok=True)
    final = p.with_suffix(".json")
    final.write_text(json.dumps(data, ensure_ascii=False, indent=2, default=str))
    size = final.stat().st_size
    n = len(data) if isinstance(data, list) else 1
    print(f"  {rel_path:32s}  {n:>4} rows  ({size:>7} bytes)")


# ── Catalog collections ──────────────────────────────────────────
partners = clean(list(db.partners.find({}).sort("order", 1)))
write("partners", partners)

events = clean(list(db.events.find({}).sort("start_time", 1)))
write("events", events)

write("events/featured", [e for e in events if e.get("featured")][:10] or events[:6])

dates = sorted({e["date"] for e in events if e.get("date")})
write("events/dates/available", dates)

venues = clean(list(db.venues.find({})))
write("venues", venues)

concerts = clean(list(db.concerts.find({})))
write("concerts", concerts)
write("concerts/dates", sorted({c["date"] for c in concerts if c.get("date")}))
write("concerts/genres", sorted({c["genre"] for c in concerts if c.get("genre")}))

sponsors = clean(list(db.sponsors.find({"is_active": {"$ne": False}})))
write("sponsors", sponsors)

transport = clean(list(db.transport.find({})))
write("transport", transport)

emergency = clean(list(db.emergency_contacts.find({})))
write("emergency-contacts", emergency)

seasons = clean(list(db.seasons.find({})))
write("seasons", seasons)

# Promotions today — any partner_promotions active for current date
today = datetime.now().strftime("%Y-%m-%d")
promos = clean(list(db.partner_promotions.find({})))
active_promos = [
    p for p in promos
    if (not p.get("start_date") or p["start_date"] <= today)
    and (not p.get("end_date") or p["end_date"] >= today)
]
write("promotions/today", active_promos or promos[:10])

rewards = clean(list(db.rewards_offers.find({})))
write("rewards/offers", rewards)

port_tax_config = db.port_tax_config.find_one({}, {"_id": 0}) or {}
write("port-tax/config", port_tax_config)

# Static config / constants
write("payments/config", {"public_key": "", "mock": True, "wompi_configured": False})
write("partner-categories", [
    {"key": "restaurant", "label": "Restaurantes"},
    {"key": "hotel", "label": "Hoteles"},
    {"key": "activity", "label": "Actividades"},
    {"key": "wellness", "label": "Wellness & Spa"},
    {"key": "bar", "label": "Bares & Clubs"},
    {"key": "beach_club", "label": "Beach Clubs"},
    {"key": "realestate", "label": "Inmobiliario"},
])
write("event-types", [
    {"key": "concert", "label": "Concierto"},
    {"key": "party", "label": "Fiesta"},
    {"key": "festival", "label": "Festival"},
    {"key": "wellness", "label": "Wellness"},
    {"key": "cultural", "label": "Cultural"},
])

# City pass plans (read from collection if exists, else static demo)
try:
    cp_plans = clean(list(db.city_pass_plans.find({})))
except Exception:
    cp_plans = []
if not cp_plans:
    cp_plans = [
        {"plan_id": "day_pass", "name": "Day Pass", "price_cop": 75000, "duration_days": 1,
         "perks": ["Transporte ilimitado", "Descuentos en restaurantes", "Acceso prioritario"]},
        {"plan_id": "weekend", "name": "Weekend Pass", "price_cop": 180000, "duration_days": 3,
         "perks": ["Day Pass beneficios", "Acceso a beach clubs", "Yacht discount"]},
        {"plan_id": "week", "name": "Week Pass", "price_cop": 380000, "duration_days": 7,
         "perks": ["Weekend Pass beneficios", "Spa session gratis", "Cena de bienvenida"]},
    ]
write("city-pass/plans", cp_plans)

# ── Partner-events (Qué pasa hoy / esta noche) ────────────────────
# The home screen calls api.get(`/partner-events?date=YYYY-MM-DD`) which the
# static client resolves to /data/partner-events.json (query string stripped).
# Build a synthetic list of partner-events by joining events.json against
# partners.json so the home shows "Qué pasa hoy" (day) and "Qué pasa esta
# noche" (night, start_time>=17:00) cards with real titles, images, and
# partner names/tiers/IDs that route to real partner pages.
from collections import defaultdict

# Today + upcoming-this-week window so the home is never empty
_today_dt = datetime.now().date()
_today_iso = _today_dt.isoformat()
_week_end = (_today_dt.fromordinal(_today_dt.toordinal() + 6)).isoformat()

# Event type -> preferred partner category (for picking a plausible partner)
TYPE_TO_PARTNER_CAT = {
    "brunch": ["restaurant", "cafe", "beach_club"],
    "beach_club": ["beach_club"],
    "sunset": ["beach_club", "bar", "restaurant"],
    "wellness": ["wellness", "spa"],
    "cultural": ["bar", "restaurant", "activity"],
    "concert": ["club", "bar"],
    "candlelight": ["restaurant", "bar"],
    "after_party": ["club", "bar"],
    "pop_up": ["restaurant", "bar", "cafe"],
}

# Event type -> PEvent.category (the UI's CAT_COLORS keys)
TYPE_TO_PE_CATEGORY = {
    "brunch": "gastronomy",
    "beach_club": "daypass",
    "sunset": "sunset",
    "wellness": "wellness",
    "cultural": "art",
    "concert": "music",
    "candlelight": "music",
    "after_party": "party",
    "pop_up": "popup",
}

# Index partners by category for fast pick, prefer elite > premium > popular
_tier_rank = {"elite": 0, "premium": 1, "popular": 2, "institutional": 3}
partners_by_cat: dict = defaultdict(list)
for _p in partners:
    partners_by_cat[_p.get("category")].append(_p)
for _cat, _lst in partners_by_cat.items():
    _lst.sort(key=lambda x: _tier_rank.get(x.get("tier") or "popular", 9))

def _pick_partner(ev: dict, used: set) -> dict | None:
    """Pick a plausible partner for an event based on venue name match or type→category."""
    venue = (ev.get("venue_name") or "").lower().strip()
    # First try: exact-ish venue → partner name match
    if venue:
        for cat_list in partners_by_cat.values():
            for p in cat_list:
                pname = (p.get("name") or "").lower()
                if pname and (pname == venue or pname in venue or venue in pname):
                    return p
    # Fallback: by category preference, round-robin among unused tiers
    cats = TYPE_TO_PARTNER_CAT.get(ev.get("type") or "", ["restaurant"])
    for cat in cats:
        for p in partners_by_cat.get(cat, []):
            if p.get("partner_id") not in used:
                return p
    # Last resort: any partner in those cats even if used
    for cat in cats:
        if partners_by_cat.get(cat):
            return partners_by_cat[cat][0]
    return None

partner_events = []
_used_partner_ids: set = set()
for ev in events:
    d = ev.get("date") or ""
    if not (_today_iso <= d <= _week_end):
        continue
    p = _pick_partner(ev, _used_partner_ids)
    if not p:
        continue
    _used_partner_ids.add(p["partner_id"])
    partner_events.append({
        "event_id": ev.get("event_id"),
        "partner_id": p.get("partner_id"),
        "title": ev.get("title"),
        "category": TYPE_TO_PE_CATEGORY.get(ev.get("type") or "", "popup"),
        "date": d,
        "start_time": ev.get("start_time") or "",
        "end_time": ev.get("end_time") or "",
        "flyer_url": ev.get("image_url") or p.get("image_url") or "",
        "is_free": bool(ev.get("is_free")),
        "price": ev.get("price") or 0,
        "partner_name": p.get("name"),
        "partner_tier": p.get("tier"),
        "partner_image": p.get("image_url"),
    })

# Sort: today first, then by start_time so day/night ordering is sensible
partner_events.sort(key=lambda x: (x["date"], x["start_time"]))

# The home calls /partner-events?date=YYYY-MM-DD which static-mode flattens
# to /data/partner-events.json. Also write a per-date copy for completeness.
write("partner-events", partner_events)

# Calendar — events grouped by date for the next 90 days
cal = defaultdict(list)
for e in events:
    if e.get("date"):
        cal[e["date"]].append({
            "event_id": e.get("event_id"),
            "title": e.get("title"),
            "venue": e.get("venue_name"),
            "category": e.get("type") or e.get("category"),
            "image_url": e.get("image_url"),
            "start_time": e.get("start_time"),
        })
write("calendar", dict(sorted(cal.items())))

# User-scoped endpoints — empty for static demo
for empty_path in [
    "my-week", "favorites", "favorites/ids", "notifications",
    "city-pass/mine", "port-tax/my-tickets", "experience-bookings",
    "reservations/my", "rewards/me",
]:
    write(empty_path, [])

# Auth/business endpoints — null so the UI falls back to "logged-out" state cleanly
for null_path in ["auth/me", "profile", "business/me", "business/membership",
                  "business/onboarding-status", "business/stats", "business/events",
                  "business/reservations"]:
    write(null_path, None)

# Experiences featured (uses partners with category=activity)
activities = [p for p in partners if p.get("category") in ("activity", "yacht")][:8]
write("experiences/featured", activities)

print(f"\n✅ dumped to {OUT}")
print(f"   total files: {sum(1 for _ in OUT.rglob('*.json'))}")
