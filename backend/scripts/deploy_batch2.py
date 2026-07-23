#!/usr/bin/env python3
"""
Publish dossier BATCH 2 into the live static catalog — RUN ONLY AFTER FRANCK SIGN-OFF.

Appends the 49 staged, research-verified venues (backend/data/dossier_venues_batch2_2026-07.json)
to frontend/public/data/partners.json + writes per-partner detail files, exactly like the
batch-1 flow. Photos are already self-hosted at public/images/partners/ptr_dv2_*.jpg.

  # optionally drop specific ids Franck rejects:
  python3 scripts/deploy_batch2.py --skip ptr_dv2_007,ptr_dv2_045
  # then:  cd frontend && npx vercel --prod   (and later the Atlas upsert)

Idempotent (keyed by partner_id). Strips the internal 'status' field on publish.
Does NOT deploy — it only updates the static files; you still run `npx vercel --prod`.
"""
import argparse, json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
SEED = REPO / "backend/data/dossier_venues_batch2_2026-07.json"
PARTNERS = REPO / "frontend/public/data/partners.json"
PDIR = REPO / "frontend/public/data/partners"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip", default="", help="comma-separated partner_ids to exclude")
    args = ap.parse_args()
    skip = {s.strip() for s in args.skip.split(",") if s.strip()}

    recs = json.loads(SEED.read_text())
    parts = json.loads(PARTNERS.read_text())
    ids = {p["partner_id"] for p in parts}
    PDIR.mkdir(parents=True, exist_ok=True)

    added = 0
    for r in recs:
        if r["partner_id"] in skip or r["partner_id"] in ids:
            continue
        pub = {k: v for k, v in r.items() if k != "status"}  # drop internal review flag
        parts.append(pub)
        (PDIR / f"{r['partner_id']}.json").write_text(json.dumps(pub, ensure_ascii=False, indent=2))
        added += 1

    PARTNERS.write_text(json.dumps(parts, ensure_ascii=False, indent=2))
    print(f"published {added} batch-2 venues → partners.json now {len(parts)}")
    print("next: cd frontend && npx vercel --prod   (then Atlas upsert once whitelisted)")


if __name__ == "__main__":
    main()
