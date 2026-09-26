#!/usr/bin/env python3
"""Geo-aware link audit for the city hub (backend/data/city_modules.json).

Fetches every official_links[].url, facts[].source_url and image.source_url with a real
browser User-Agent and classifies the answer, so a CloudFront COUNTRY block is never
mistaken for a dead link or a bot wall:

  ok         2xx/3xx
  geo-block  403 from CloudFront whose body says the distribution blocks the caller's
             country (transitocartagena.gov.co does this for non-Colombian egress —
             a roaming tourist on a home-routed SIM hits it too; the label carries a
             "(solo desde Colombia)" hint for that reason)
  bot-wall   403 "Attention Required! | Cloudflare" / "Sorry, you have been blocked"
             (www.cartagena.gov.co) — a real phone browser most likely passes; verify
             on a handset once and record it in store-assets/city/RESEARCH_2026-09.md
  slow       2xx but time-to-first-byte above --slow seconds (fortificacionescartagena
             .com.co answers in 2–7 s; a HEAD with a short timeout looked dead)
  dead       4xx/5xx of any other kind, or a network error / timeout

Usage:  python3 scripts/audit-city-links.py [--timeout 25] [--slow 3] [--only host]
Exit code 1 only when a link is dead. Uses the stdlib only (urllib), GET not HEAD.
"""
import argparse
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(REPO, "backend", "data", "city_modules.json")
UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
      "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")
# Hosts with a slow origin: give the GET room instead of calling them dead on a 25 s HEAD.
HOST_TIMEOUT = {"fortificacionescartagena.com.co": 60, "compraenlinea.fortificacionescartagena.com.co": 60}


def collect(data):
    for m in data.get("modules") or []:
        for link in m.get("official_links") or []:
            if link.get("url"):
                yield m["id"], "link", link["url"]
        for fact in m.get("facts") or []:
            if fact.get("source_url"):
                yield m["id"], f"fact:{fact.get('key')}", fact["source_url"]
        img = m.get("image") or {}
        if img.get("source_url"):
            yield m["id"], "image", img["source_url"]


def classify(status, body, ttfb, slow):
    low = (body or "")[:20000].lower()
    if status == 403 and "cloudfront" in low and "block access from your country" in low:
        return "geo-block"
    if status == 403 and ("attention required" in low or "you have been blocked" in low or "__cf_bm" in low):
        return "bot-wall"
    if 200 <= status < 400:
        return "slow" if ttfb > slow else "ok"
    return "dead"


def fetch(url, timeout):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "es-CO,es;q=0.9,en;q=0.8"})
    ctx = ssl.create_default_context()
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            ttfb = time.time() - t0
            body = r.read(20000).decode("utf-8", "replace")
            return r.status, r.headers.get("server", ""), body, ttfb
    except urllib.error.HTTPError as e:
        ttfb = time.time() - t0
        try:
            body = e.read(20000).decode("utf-8", "replace")
        except Exception:
            body = ""
        return e.code, e.headers.get("server", "") if e.headers else "", body, ttfb
    except Exception as e:  # timeout, DNS, TLS
        return 0, "", f"{type(e).__name__}: {e}", time.time() - t0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeout", type=float, default=25)
    ap.add_argument("--slow", type=float, default=3)
    ap.add_argument("--only", default="", help="only URLs whose host contains this text")
    args = ap.parse_args()

    data = json.load(open(SRC, encoding="utf-8"))
    seen = {}
    rows = []
    for mod, where, url in collect(data):
        host = url.split("/")[2] if "//" in url else url
        if args.only and args.only not in host:
            continue
        if url not in seen:
            timeout = HOST_TIMEOUT.get(host, args.timeout)
            status, server, body, ttfb = fetch(url, timeout)
            seen[url] = (classify(status, body, ttfb, args.slow), status, server, ttfb)
        verdict, status, server, ttfb = seen[url]
        rows.append((verdict, status, f"{ttfb:.1f}s", server[:14], mod, where, url))

    order = {"dead": 0, "geo-block": 1, "bot-wall": 2, "slow": 3, "ok": 4}
    rows.sort(key=lambda r: (order.get(r[0], 9), r[4], r[6]))
    for r in rows:
        print("\t".join(str(x) for x in r))
    counts = {}
    for r in rows:
        counts[r[0]] = counts.get(r[0], 0) + 1
    print(f"\n[audit-city-links] {len(seen)} unique URLs: " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    if counts.get("geo-block"):
        print("  geo-block = country block, not a dead link: keep the '(solo desde Colombia)' label hint.")
    if counts.get("bot-wall"):
        print("  bot-wall = Cloudflare challenge for scripted clients; confirm once on a real phone.")
    return 1 if counts.get("dead") else 0


if __name__ == "__main__":
    sys.exit(main())
