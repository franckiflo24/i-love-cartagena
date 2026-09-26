#!/usr/bin/env python3
"""Create/refresh the App Store v1.1 DRAFT (AMO Life rename) from store-assets/v1.1/metadata.json.

Idempotent: reuses an existing editable 1.1.0 version, PATCHes version localizations
(description, keywords, promotionalText, whatsNew) and the EDITABLE appInfo
localizations (name, subtitle). Never attaches a build and never submits for review.
Auth + identifiers come from scripts/asc-status.py (the .p8 key stays out of git).
"""
import json, sys, importlib.util
from pathlib import Path
import requests

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("asc", HERE / "asc-status.py")
asc = importlib.util.module_from_spec(spec); spec.loader.exec_module(asc)
API = "https://api.appstoreconnect.apple.com/v1"
META = json.loads((HERE.parent / "store-assets/v1.1/metadata.json").read_text())
VERSION = META["version"]

def h():
    return {"Authorization": f"Bearer {asc.token()}", "Content-Type": "application/json"}

def call(method, path, body=None, ok=(200, 201, 204)):
    r = requests.request(method, API + path, headers=h(), json=body, timeout=60)
    if r.status_code not in ok:
        detail = "; ".join(f"{e.get('code')}: {e.get('detail')}" for e in (r.json().get("errors") or [])) if r.content else r.text
        raise SystemExit(f"{method} {path} -> {r.status_code}: {detail}")
    return r.json() if r.content else {}

# 1) editable version 1.1.0 (create if missing)
vers = call("GET", f"/apps/{asc.APP_ID}/appStoreVersions?filter[platform]=IOS&limit=20")["data"]
ver = next((v for v in vers if v["attributes"]["versionString"] == VERSION), None)
if ver is None:
    ver = call("POST", "/appStoreVersions", {"data": {"type": "appStoreVersions",
        "attributes": {"platform": "IOS", "versionString": VERSION, "releaseType": "AFTER_APPROVAL"},
        "relationships": {"app": {"data": {"type": "apps", "id": asc.APP_ID}}}}})["data"]
    print(f"created version {VERSION}: {ver['id']}")
else:
    print(f"version {VERSION} exists: {ver['id']} state={ver['attributes']['appStoreState']}")

# 2) version localizations
locs = call("GET", f"/appStoreVersions/{ver['id']}/appStoreVersionLocalizations")["data"]
for loc in locs:
    lc = loc["attributes"]["locale"]
    m = META["locales"].get(lc)
    if not m:
        print(f"  skip version locale {lc} (no metadata)"); continue
    call("PATCH", f"/appStoreVersionLocalizations/{loc['id']}", {"data": {"type": "appStoreVersionLocalizations", "id": loc["id"],
        "attributes": {k: m[k] for k in ("description", "keywords", "promotionalText", "whatsNew")}}})
    print(f"  version locale {lc}: description/keywords/promo/whatsNew set")

# 3) editable appInfo (name/subtitle live here)
infos = call("GET", f"/apps/{asc.APP_ID}/appInfos")["data"]
editable = [i for i in infos if i["attributes"].get("appStoreState") in ("PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED", "WAITING_FOR_REVIEW") or i["attributes"].get("state") in ("PREPARE_FOR_SUBMISSION",)]
if not editable:
    raise SystemExit("no editable appInfo found (states: " + ", ".join(str(i['attributes']) for i in infos) + ")")
info = editable[0]
for loc in call("GET", f"/appInfos/{info['id']}/appInfoLocalizations")["data"]:
    lc = loc["attributes"]["locale"]; m = META["locales"].get(lc)
    if not m:
        print(f"  skip appInfo locale {lc}"); continue
    call("PATCH", f"/appInfoLocalizations/{loc['id']}", {"data": {"type": "appInfoLocalizations", "id": loc["id"],
        "attributes": {"name": m["name"], "subtitle": m["subtitle"]}}})
    print(f"  appInfo locale {lc}: name='{m['name']}' subtitle='{m['subtitle']}'")
print("done — draft only; no build attached, nothing submitted")
