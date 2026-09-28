#!/usr/bin/env python3
"""Create/refresh an App Store version DRAFT that only changes What's New.

Usage: python3 scripts/asc-new-version.py store-assets/v1.1.1/whats-new.json

Idempotent: reuses the version if it already exists (editable states only), else
POSTs it — Apple copies description/keywords/promo/screenshots from the live
version. Then PATCHes whatsNew per locale from the JSON. Never attaches a build
and never submits for review. Auth + identifiers come from scripts/asc-status.py.
"""
import json, sys, importlib.util
from pathlib import Path
import requests

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("asc", HERE / "asc-status.py")
asc = importlib.util.module_from_spec(spec); spec.loader.exec_module(asc)
API = "https://api.appstoreconnect.apple.com/v1"
if len(sys.argv) != 2:
    raise SystemExit(__doc__)
META = json.loads(Path(sys.argv[1]).read_text())
VERSION = META["version"]
EDITABLE = {"PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED"}

def call(method, path, body=None, ok=(200, 201, 204)):
    r = requests.request(method, API + path, json=body, timeout=60,
                         headers={"Authorization": f"Bearer {asc.token()}", "Content-Type": "application/json"})
    if r.status_code not in ok:
        detail = "; ".join(f"{e.get('code')}: {e.get('detail')}" for e in (r.json().get("errors") or [])) if r.content else r.text
        raise SystemExit(f"{method} {path} -> {r.status_code}: {detail}")
    return r.json() if r.content else {}

vers = call("GET", f"/apps/{asc.APP_ID}/appStoreVersions?filter[platform]=IOS&limit=20")["data"]
ver = next((v for v in vers if v["attributes"]["versionString"] == VERSION), None)
if ver is None:
    ver = call("POST", "/appStoreVersions", {"data": {"type": "appStoreVersions",
        "attributes": {"platform": "IOS", "versionString": VERSION, "releaseType": "AFTER_APPROVAL"},
        "relationships": {"app": {"data": {"type": "apps", "id": asc.APP_ID}}}}})["data"]
    print(f"created version {VERSION}: {ver['id']}")
else:
    state = ver["attributes"]["appStoreState"]
    print(f"version {VERSION} exists: {ver['id']} state={state}")
    if state not in EDITABLE:
        raise SystemExit(f"version {VERSION} is {state} — not editable, nothing changed")

for loc in call("GET", f"/appStoreVersions/{ver['id']}/appStoreVersionLocalizations")["data"]:
    lc = loc["attributes"]["locale"]
    text = META["whatsNew"].get(lc)
    if not text:
        print(f"  skip locale {lc} (no whatsNew in {sys.argv[1]})"); continue
    call("PATCH", f"/appStoreVersionLocalizations/{loc['id']}", {"data": {"type": "appStoreVersionLocalizations",
        "id": loc["id"], "attributes": {"whatsNew": text}}})
    print(f"  {lc}: whatsNew set ({len(text)} chars)")
print(f"done — {VERSION} draft only; no build attached, nothing submitted")
