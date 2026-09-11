#!/usr/bin/env python3
"""App Store Connect submission status checker for Amo Cartagena.

Re-run any time to see the authoritative review state straight from Apple's API
(not the web UI). Reads the private key from ~/.appstoreconnect/private_keys.

    python3 scripts/asc-status.py

Non-secret identifiers below are safe to commit; the .p8 key stays out of git.
"""
import json
import time
import sys
from pathlib import Path

import jwt
import requests

KEY_ID = "U23PJ7SP52"
ISSUER_ID = "18ea1a6b-9f32-4076-b95b-56b7f0955a4c"
APP_ID = "6809565354"
KEY_PATHS = [
    Path.home() / ".appstoreconnect/private_keys" / f"AuthKey_{KEY_ID}.p8",
    Path.home() / "Downloads" / f"AuthKey_{KEY_ID}.p8",
]
BASE = "https://api.appstoreconnect.apple.com"


def token() -> str:
    key = next((p for p in KEY_PATHS if p.exists()), None)
    if not key:
        sys.exit(f"Private key not found in: {[str(p) for p in KEY_PATHS]}")
    now = int(time.time())
    return jwt.encode(
        {"iss": ISSUER_ID, "iat": now, "exp": now + 1200, "aud": "appstoreconnect-v1"},
        key.read_text(),
        algorithm="ES256",
        headers={"kid": KEY_ID, "typ": "JWT"},
    )


def get(path: str, tok: str, **params):
    r = requests.get(f"{BASE}{path}", headers={"Authorization": f"Bearer {tok}"}, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def main() -> None:
    tok = token()

    print("=" * 60)
    print("APP STORE CONNECT — Amo Cartagena — live review status")
    print("=" * 60)

    # 1) App store versions + the build attached to each
    versions = get(f"/v1/apps/{APP_ID}/appStoreVersions", tok, limit=5, include="build")
    included = {(i["type"], i["id"]): i for i in versions.get("included", [])}
    for v in versions["data"]:
        a = v["attributes"]
        state = a.get("appStoreState") or a.get("appVersionState") or a.get("state") or "?"
        print(f"\nVERSION {a.get('versionString')} | state: {state}")
        print(f"  created: {a.get('createdDate')}  releaseType: {a.get('releaseType')}")
        bref = (v.get("relationships", {}).get("build", {}) or {}).get("data")
        if bref:
            b = included.get((bref["type"], bref["id"]))
            if b:
                ba = b["attributes"]
                print(f"  BUILD ATTACHED: {ba.get('version')} | state: {ba.get('processingState')} "
                      f"| uploaded: {ba.get('uploadedDate')} | expired: {ba.get('expired')}")
        else:
            print("  BUILD ATTACHED: (none)")

    # 2) Review submissions (the queue entry) + their items' resolved state
    subs = get("/v1/reviewSubmissions", tok, **{"filter[app]": APP_ID, "limit": 5, "include": "items"})
    print("\n" + "-" * 60)
    print("REVIEW SUBMISSIONS (newest first):")
    for s in subs["data"]:
        a = s["attributes"]
        print(f"  state: {a.get('state')} | platform: {a.get('platform')} "
              f"| submitted: {a.get('submittedDate')}")

    print("\n" + "=" * 60)
    print("Read: state WAITING_FOR_REVIEW = in queue, all good.")
    print("      IN_REVIEW = reviewer started.  UNRESOLVED_ISSUES = rejected/needs reply.")
    print("      PENDING_DEVELOPER_RELEASE / READY_FOR_SALE = approved.")
    print("=" * 60)


if __name__ == "__main__":
    main()
