#!/usr/bin/env python3
"""SUPPLY-SPRINT v1 — starter AMO-hosted inventory (idempotent, batch-tagged).

Drives the admin API over HTTPS (Atlas is IP-whitelisted; the API is the
sanctioned write path). Auth: EVENTS_ADMIN_TOKEN env, or the ops file
~/.claude/scripts/amo-events-admin.json.

WHAT IT SEEDS
  cmw  — one FREE-RSVP record per Cartagena Music Week night that has a real
         catalog venue_id in backend/data/cmw_program.json (AMO co-produces
         CMW, so pre-listing as RSVP is sanctioned by the drop spec). Dates
         are REAL (Dec 31 – Jan 7). Default capacity 80 (override later).
  t1   — "AMO Sunset en las Murallas" template @ Baluarte de la Gente.
  t2   — "AMO Getsemaní Street-Art Walk" template @ Plaza de la Trinidad.
         T1/T2 are DRAFTS with placeholder dates: they NEVER publish from
         this script unless --publish-templates AND --t1-date/--t2-date are
         given — do not publish an event AMO won't actually host.

VENUE GATE: every event's venue must be display_ready. If a target venue is
in the hygiene 114-gate, the script PROMOTES it first via
POST /admin/amo-events/promote-venue (name_verified lever) and logs it —
attaching real inventory is exactly the act that drains the gate.

USAGE
  python3 scripts/seed_amo_experiences.py --dry-run
  python3 scripts/seed_amo_experiences.py --publish --only cmw
  (re-runs are idempotent: an existing batch_tag event_key is skipped)

ROLLBACK: cancel by batch tag via the admin API; promotions are additive.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

BASE = os.environ.get("AMO_API", "https://backend-mu-one-74.vercel.app/api")
BATCH = "supply-sprint-v1"
REPO = Path(__file__).resolve().parent.parent
CMW_PROGRAM = REPO / "data" / "cmw_program.json"

T1 = {"key": "t1-sunset-murallas", "title": "AMO Sunset en las Murallas",
      "blurb": "Encuentro gratuito al atardecer en las murallas — el punto exacto, la historia del baluarte y la mejor luz de Cartagena. Cupo limitado, reserva gratis.",
      "partner_query_name": "Baluarte", "category": "sunset",
      "start_time": "17:30", "capacity": 25}
T2 = {"key": "t2-getsemani-walk", "title": "AMO Getsemaní Street-Art Walk",
      "blurb": "Caminata gratuita por el arte urbano de Getsemaní desde la Plaza de la Trinidad — murales, historias de barrio y paradas que no salen en los mapas.",
      "partner_query_name": "Trinidad", "category": "walk",
      "start_time": "16:30", "capacity": 15}
CMW_CAPACITY = 80


def _token() -> str:
    t = os.environ.get("EVENTS_ADMIN_TOKEN", "").strip()
    if t:
        return t
    ops = Path.home() / ".claude/scripts/amo-events-admin.json"
    return json.load(open(ops))["EVENTS_ADMIN_TOKEN"]


def call(method: str, path: str, body=None):
    req = urllib.request.Request(BASE + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    req.add_header("Authorization", f"Bearer {_token()}")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.load(r)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def get(path: str):
    with urllib.request.urlopen(BASE + path, timeout=60) as r:
        return json.load(r)


def find_venue(name_part: str):
    rows = get("/partners")
    rows = rows if isinstance(rows, list) else rows.get("partners", [])
    hits = [p for p in rows if name_part.lower() in (p.get("name") or "").lower()]
    return hits[0] if hits else None


def ensure_ready(venue, dry: bool, log: list) -> bool:
    if venue.get("display_ready") is not False:
        return True
    pid = venue["partner_id"]
    if dry:
        log.append(f"WOULD PROMOTE venue {pid} ({venue.get('name')!r}) from the hygiene gate")
        return True
    s, d = call("POST", "/admin/amo-events/promote-venue", {"partner_id": pid})
    log.append(f"PROMOTED venue {pid}: {s} -> display_ready={d.get('display_ready')}")
    return s == 200 and d.get("display_ready") is not False


def existing_batch_titles() -> set:
    rows = get("/partner-events")
    rows = rows if isinstance(rows, list) else rows.get("events", [])
    return {e.get("title") for e in rows}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--publish", action="store_true", help="publish CMW nights after create")
    ap.add_argument("--only", choices=["cmw", "t1", "t2"], default=None)
    ap.add_argument("--publish-templates", action="store_true")
    ap.add_argument("--t1-date"), ap.add_argument("--t2-date")
    args = ap.parse_args()
    dry = args.dry_run
    log: list = []
    made = published = skipped = 0
    live_titles = existing_batch_titles()

    def create(payload, publish: bool):
        nonlocal made, published, skipped
        if payload["title"] in live_titles:
            skipped += 1
            log.append(f"SKIP (exists in feed): {payload['title']}")
            return
        if dry:
            made += 1
            log.append(f"WOULD CREATE{' + PUBLISH' if publish else ' (draft)'}: "
                       f"{payload['title']} · {payload['date']} {payload['start_time']} "
                       f"@ {payload['partner_id']} cap={payload['capacity']}")
            return
        s, d = call("POST", "/admin/amo-events", payload)
        if s != 200:
            log.append(f"CREATE FAILED {s}: {payload['title']} -> {d}")
            return
        made += 1
        eid = d["event"]["event_id"]
        log.append(f"created {eid} (draft): {payload['title']}")
        if publish:
            s2, d2 = call("PATCH", f"/admin/amo-events/{eid}", {"publish": True})
            if s2 == 200:
                published += 1
                log.append(f"  PUBLISHED {eid}")
            else:
                log.append(f"  publish FAILED {s2}: {d2}")

    # ── CMW nights (real dates, sanctioned pre-listing) ──
    if args.only in (None, "cmw"):
        prog = json.load(open(CMW_PROGRAM))
        evs = prog.get("events", prog if isinstance(prog, list) else [])
        for e in evs:
            vid = e.get("venue_id")
            if not vid:
                log.append(f"skip CMW {e.get('id')} — no catalog venue_id (El Lago/Templo class)")
                continue
            venue = None
            rows = get("/partners")
            rows = rows if isinstance(rows, list) else rows.get("partners", [])
            venue = next((p for p in rows if p.get("partner_id") == vid), None)
            if not venue:
                log.append(f"skip CMW {e.get('id')} — venue {vid} not public")
                continue
            if not ensure_ready(venue, dry, log):
                log.append(f"skip CMW {e.get('id')} — venue promotion failed")
                continue
            create({
                "title": f"{e.get('title')} — Cartagena Music Week · RSVP",
                "blurb": (e.get("blurb") or e.get("description") or
                          "Noche oficial de Cartagena Music Week — powered by AMO LIFE. Reserva gratis; el consumo se paga en el lugar."),
                "partner_id": vid,
                "date": e.get("date"),
                "start_time": (e.get("time") or e.get("start_time") or "21:00")[:5],
                "capacity": CMW_CAPACITY,
                "category": "cmw",
                "batch_tag": BATCH,
            }, publish=args.publish)

    # ── Templates (drafts unless explicitly dated + flagged) ──
    for tpl, date_arg in ((T1, args.t1_date), (T2, args.t2_date)):
        if args.only not in (None, tpl["key"][:2]):
            continue
        venue = find_venue(tpl["partner_query_name"])
        if not venue:
            log.append(f"skip {tpl['key']} — no catalog venue matching {tpl['partner_query_name']!r}")
            continue
        if not ensure_ready(venue, dry, log):
            continue
        pub = bool(args.publish_templates and date_arg)
        create({
            "title": tpl["title"], "blurb": tpl["blurb"],
            "partner_id": venue["partner_id"],
            "date": date_arg or "2099-01-01",   # placeholder keeps it a draft
            "start_time": tpl["start_time"], "capacity": tpl["capacity"],
            "category": tpl["category"], "batch_tag": BATCH,
        }, publish=pub)

    print("\n".join(log))
    print(f"\nSUMMARY mode={'DRY' if dry else 'LIVE'} created={made} published={published} skipped={skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
