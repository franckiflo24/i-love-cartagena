#!/usr/bin/env python3
"""Replace the iPhone 6.9"/6.7" screenshot set on the EDITABLE App Store version with
store-assets/app-store/v1.1/<locale>/*.png (one set per locale, ordered by filename).

  python3 scripts/asc-upload-screenshots.py [--dry-run]

Idempotent: deletes every existing screenshot in the APP_IPHONE_67 set of each locale
(creating the set if the locale has none), then reserves + uploads + commits each file.
Never touches a READY_FOR_SALE version and never submits. Auth from scripts/asc-status.py.
"""
import glob, hashlib, importlib.util, os, sys, time
from pathlib import Path
import requests

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("asc", HERE / "asc-status.py")
asc = importlib.util.module_from_spec(spec); spec.loader.exec_module(asc)
API = "https://api.appstoreconnect.apple.com/v1"
SHOTS = HERE.parent / "store-assets/app-store/v1.1"
DISPLAY = "APP_IPHONE_67"
DRY = "--dry-run" in sys.argv


def h():
    return {"Authorization": f"Bearer {asc.token()}", "Content-Type": "application/json"}


def call(method, path, body=None, ok=(200, 201, 204)):
    r = requests.request(method, API + path, headers=h(), json=body, timeout=120)
    if r.status_code not in ok:
        raise SystemExit(f"{method} {path} -> {r.status_code}: {r.text[:600]}")
    return r.json() if r.content else {}


def editable_version():
    vers = call("GET", f"/apps/{asc.APP_ID}/appStoreVersions?filter[platform]=IOS&limit=10")["data"]
    ed = [v for v in vers if v["attributes"]["appStoreState"] in ("PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED")]
    if not ed:
        raise SystemExit("no editable version")
    return ed[0]


def upload_one(set_id: str, path: Path) -> None:
    data = path.read_bytes()
    res = call("POST", "/appScreenshots", {"data": {"type": "appScreenshots",
        "attributes": {"fileName": path.name, "fileSize": len(data)},
        "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": set_id}}}}})["data"]
    for op in res["attributes"]["uploadOperations"]:
        chunk = data[op["offset"]: op["offset"] + op["length"]]
        hdrs = {x["name"]: x["value"] for x in op["requestHeaders"]}
        r = requests.request(op["method"], op["url"], headers=hdrs, data=chunk, timeout=300)
        if r.status_code >= 300:
            raise SystemExit(f"chunk upload failed {r.status_code}: {r.text[:300]}")
    call("PATCH", f"/appScreenshots/{res['id']}", {"data": {"type": "appScreenshots", "id": res["id"],
        "attributes": {"uploaded": True, "sourceFileChecksum": hashlib.md5(data).hexdigest()}}})
    # wait for Apple to accept the asset
    for _ in range(30):
        st = call("GET", f"/appScreenshots/{res['id']}")["data"]["attributes"]["assetDeliveryState"]["state"]
        if st == "COMPLETE":
            return
        if st == "FAILED":
            raise SystemExit(f"{path.name}: asset FAILED")
        time.sleep(2)
    raise SystemExit(f"{path.name}: asset still processing")


def main() -> int:
    ver = editable_version()
    print(f"version {ver['attributes']['versionString']} ({ver['attributes']['appStoreState']})")
    locs = call("GET", f"/appStoreVersions/{ver['id']}/appStoreVersionLocalizations")["data"]
    for loc in locs:
        lc = loc["attributes"]["locale"]
        files = sorted(Path(p) for p in glob.glob(str(SHOTS / lc / "*.png")))
        if not files:
            print(f"  {lc}: no files, skipped"); continue
        sets = call("GET", f"/appStoreVersionLocalizations/{loc['id']}/appScreenshotSets")["data"]
        s = next((x for x in sets if x["attributes"]["screenshotDisplayType"] == DISPLAY), None)
        if s is None:
            if DRY:
                print(f"  {lc}: would create {DISPLAY} set"); s = {"id": "dry"}
            else:
                s = call("POST", "/appScreenshotSets", {"data": {"type": "appScreenshotSets",
                    "attributes": {"screenshotDisplayType": DISPLAY},
                    "relationships": {"appStoreVersionLocalization": {"data": {"type": "appStoreVersionLocalizations", "id": loc["id"]}}}}})["data"]
                print(f"  {lc}: created {DISPLAY} set {s['id']}")
        existing = [] if s["id"] == "dry" else call("GET", f"/appScreenshotSets/{s['id']}/appScreenshots?limit=50")["data"]
        print(f"  {lc}: {len(existing)} existing -> replacing with {len(files)} files")
        if DRY:
            for f in files: print("     ", f.name)
            continue
        for e in existing:
            call("DELETE", f"/appScreenshots/{e['id']}")
        for f in files:
            upload_one(s["id"], f); print("     uploaded", f.name)
    print("done — screenshots only; nothing submitted")
    return 0


if __name__ == "__main__":
    sys.exit(main())
