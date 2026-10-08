#!/usr/bin/env python3
"""LOCAL door-scan proof of the live PALCO ticketing engine — no Atlas, no
credentials, no prod. It imports the REAL backend/tickets.py scan route and the
REAL backend/qr_credential.py rotating-wire math, drives them through FastAPI's
TestClient against an in-memory DB seeded with the actual Casa Bohême × We Are Us
Cartagena Music Week night, and narrates the full gate sequence:

  rotate → VALIDO (admit) → DUPLICADO (replay blocked) → FALSIFICADO (tamper)
  → EXPIRADO (stale capture) → FUERA_DE_ALCANCE (wrong venue) → GOV override.

Run:  cd backend && python3 ../<path>/door_scan_demo.py
"""
from __future__ import annotations

import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List

os.environ.pop("VERCEL_ENV", None)  # dev mode → simulate attacks allowed (prod blocks them)

BACKEND = Path("/Users/showowt/i-love-cartagena/backend")
sys.path.insert(0, str(BACKEND))

from fastapi import FastAPI                    # noqa: E402
from fastapi.testclient import TestClient      # noqa: E402
import qr_credential as qc                      # noqa: E402  the REAL rotating-wire engine
import tickets as T                             # noqa: E402  the REAL scan route

NOW = datetime.now(timezone.utc)
NIGHT = (NOW + timedelta(days=40)).strftime("%Y-%m-%d")

C = {"g": "\033[92m", "r": "\033[91m", "y": "\033[93m", "c": "\033[96m", "b": "\033[1m", "x": "\033[0m"}
def say(s=""): print(s)
def step(n, s): say(f"\n{C['b']}{C['c']}━━ {n} ━━{C['x']} {s}")
def verdict(v, note=""):
    good = v in ("VALIDO", "PASE")
    col = C["g"] if good else C["r"]
    mark = "✅ ADMIT" if good else "⛔ REFUSE"
    say(f"   → verdict: {col}{C['b']}{v}{C['x']}   {mark}   {C['y']}{note}{C['x']}")


# ── in-memory DB mirroring the test harness, seeded as Casa Bohême ──
class _Cur:
    def __init__(s, rows): s._r = list(rows)
    def sort(s, *a, **k): return s
    async def to_list(s, n): return s._r[:n]

def _match(d, q):
    for k, v in q.items():
        if k == "$and":
            if not all(_match(d, s) for s in v): return False
        elif k == "$or":
            if not any(_match(d, s) for s in v): return False
        elif isinstance(v, dict):
            if "$gte" in v and not (d.get(k) is not None and d.get(k) >= v["$gte"]): return False
            if "$in" in v and d.get(k) not in v["$in"]: return False
            if "$exists" in v and (k in d) != bool(v["$exists"]): return False
        elif d.get(k) != v:
            return False
    return True

class _Coll:
    def __init__(s, rows=None): s.rows: List[Dict[str, Any]] = list(rows or [])
    async def insert_one(s, doc): s.rows.append(dict(doc))
    async def find_one(s, q, proj=None):
        for d in s.rows:
            if _match(d, q):
                out = dict(d)
                if proj:
                    keep = {k for k, v in proj.items() if v == 1 and k != "_id"}
                    if keep: out = {k: out.get(k) for k in keep}
                    else:
                        for k, v in proj.items():
                            if v == 0 and k != "_id": out.pop(k, None)
                return out
        return None
    def find(s, q, proj=None):
        outs = []
        for d in s.rows:
            if _match(d, q):
                out = dict(d)
                if proj:
                    for k, v in proj.items():
                        if v == 0 and k != "_id": out.pop(k, None)
                    keep = {k for k, v in proj.items() if v == 1 and k != "_id"}
                    if keep: out = {k: dict(d).get(k) for k in keep}
                outs.append(out)
        return _Cur(outs)
    async def count_documents(s, q): return sum(1 for d in s.rows if _match(d, q))
    async def update_one(s, q, u):
        for d in s.rows:
            if _match(d, q): d.update(u.get("$set", {})); return
    async def find_one_and_update(s, q, u, upsert=False, return_document=None, projection=None):
        for d in s.rows:
            if _match(d, q):
                before = dict(d); d.update(u.get("$set", {}))
                return dict(d) if return_document else before
        if upsert:
            doc = dict(u.get("$setOnInsert", {})); doc.update(u.get("$set", {}))
            s.rows.append(doc); return dict(doc) if return_document else None
        return None
    async def create_index(s, *a, **k): return None

class _DB:
    def __init__(s):
        s.partner_events = _Coll([{
            "event_id": "ae_aa746ce087", "partner_id": "ptr_V014",
            "title": "Casa Bohême × We Are Us — Cartagena Music Week · RSVP",
            "date": NIGHT, "start_time": "21:00", "is_published": True,
            "moderation_status": "approved", "host": "AMO", "is_free": True,
        }])
        s.partners = _Coll([{"partner_id": "ptr_V014", "name": "Casa Bohême"}])
        s.amo_tickets = _Coll(); s.amo_ticket_scans = _Coll(); s.city_passes = _Coll()
        s.users = _Coll([{"user_id": "u1", "name": "Phil McGill", "email": "phil@machinemind.co"}])

GUEST = {"user_id": "u1", "name": "Phil McGill", "email": "phil@machinemind.co"}
DOOR_CASA = {"business_id": "bizV014", "partner_id": "ptr_V014", "role": "business"}  # Casa Bohême's own door
DOOR_OTHER = {"business_id": "bizX", "partner_id": "ptr_OTHER", "role": "business"}   # a different venue
GOV = {"business_id": "bizGov", "partner_id": None, "role": "government"}             # city override

STATE = {"user": GUEST, "biz": DOOR_CASA}

async def _fake_user(request): return STATE["user"]
async def _fake_biz(request): return STATE["biz"]
async def _no_rl(request, bucket, max_calls, window): return None  # the limiter uses its own Mongo; off for a local demo
T._user = _fake_user
T._business = _fake_biz
T._rl = _no_rl
T.init(_DB())
T._indexed = True
app = FastAPI(); app.include_router(T.router, prefix="/api")
client = TestClient(app)

def wire_now(tid: str) -> str:
    sec = next(d["qr_secret"] for d in T.db.amo_tickets.rows if d["ticket_id"] == tid)
    return qc.build_wire(T.NS_TICKET, tid, sec)

def scan(**body):
    return client.post("/api/business/tickets/scan", json=body)


say(f"{C['b']}PALCO DOOR-SCAN — live engine, local, no credentials{C['x']}")
say(f"event: Casa Bohême × We Are Us · Cartagena Music Week ({NIGHT} 21:00) · FREE RSVP")
say(f"engine vector self-check: derive_token('tkt_demo1','s3cret',178080000) = {qc.derive_token('tkt_demo1','s3cret',178080000)} "
    f"({'OK' if qc.derive_token('tkt_demo1','s3cret',178080000)=='5d22f5379637' else 'MISMATCH'})")

# 1 · guest reserves → ticket to profile
step(1, "Guest reserves the free ticket (saved to their profile wallet)")
t = client.post("/api/tickets/event-rsvp", json={"event_id": "ae_aa746ce087"}).json()["ticket"]
tid = t["ticket_id"]
say(f"   minted {C['b']}{tid}{C['x']}  status={t['status']}  holder={GUEST['name']}")
mine = client.get("/api/tickets/mine").json()["tickets"]
say(f"   wallet /tickets/mine → {[x['ticket_id'] for x in mine]}  (secret leaked in list? "
    f"{'YES ⚠️' if 'qr_secret' in str(mine) else 'no ✓'})")

# 2 · rotating wire changes
step(2, "The QR rotates every 10s — same ticket, different code")
w1 = wire_now(tid); say(f"   wire @T   : {w1}")
say("   …waiting 10s for the counter to advance…")
time.sleep(10.5)
w2 = wire_now(tid); say(f"   wire @T+10: {w2}")
say(f"   changed? {C['g']}YES ✓{C['x']}  (a screenshot of w1 is now dead)" if w1 != w2
    else f"   changed? {C['r']}NO{C['x']}")

# 3 · VALIDO
step(3, "Door scans the CURRENT code (Casa Bohême's own scanner)")
r = scan(wire=wire_now(tid), gate="Puerta Casa Bohême").json()
verdict(r["verdict"], f"guest: {r.get('guest',{}).get('name','')}")

# 4 · DUPLICADO
step(4, "Same person tries to get a friend in on a re-scan (replay)")
r = scan(wire=wire_now(tid), gate="Puerta Casa Bohême").json()
verdict(r["verdict"], f"already used at {r.get('first_gate','')}")

# reset to a fresh unused ticket for the attack demos
T.db.amo_tickets.rows[0]["status"] = "issued"
T.db.amo_tickets.rows[0].pop("used_at", None); T.db.amo_tickets.rows[0].pop("used_gate", None)

# 5 · FALSIFICADO (tampered signature)
step(5, "Attacker tampers the signature bytes of a real code")
w = wire_now(tid); tam = w[:-4] + ("0000" if not w.endswith("0000") else "1111")
verdict(scan(wire=tam).json()["verdict"], "bad HMAC → forged")

# 6 · EXPIRADO (stale screenshot beyond the skew window)
step(6, "Someone scans a screenshot taken a minute ago (stale counter)")
sec = T.db.amo_tickets.rows[0]["qr_secret"]
c = qc.counter_for_now() - (qc.TOKEN_SKEW_STEPS + 2)
stale = f"{T.NS_TICKET}.{tid}.{c}.{qc.derive_token(tid, sec, c)}"
verdict(scan(wire=stale).json()["verdict"], "outside the ±rotation window")

# 7 · FUERA_DE_ALCANCE (another venue's scanner)
step(7, "A DIFFERENT venue's scanner tries this ticket (wrong door)")
STATE["biz"] = DOOR_OTHER
r = scan(wire=wire_now(tid)).json()
verdict(r["verdict"], f"verified real, but not this venue — no guest PII leaked ({'guest' not in r})")

# 8 · GOV override admits anywhere
step(8, "City (gobierno) scanner — authorized to validate any event")
STATE["biz"] = GOV
r = scan(wire=wire_now(tid), gate="Control Ciudad").json()
verdict(r["verdict"], f"guest: {r.get('guest',{}).get('name','')}")

say(f"\n{C['b']}{C['g']}DOOR-SCAN COMPLETE — real PALCO engine, every verdict from backend/tickets.py.{C['x']}")
