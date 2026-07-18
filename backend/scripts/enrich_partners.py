"""
DROP 1: Enrich all partners with search_profile field.
Generates searchable tags, vibe, best-for moments, signature items using Haiku.
Writes via the batch-update API endpoint (no direct MongoDB access needed).

Usage:
    python3 scripts/enrich_partners.py           # dry-run (print profiles, don't write)
    python3 scripts/enrich_partners.py --apply    # write to DB via API
"""
import json
import os
import sys
import time
import urllib.request

BACKEND_URL = os.environ.get("BACKEND_URL", "https://backend-mu-one-74.vercel.app")
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
BATCH_SECRET = os.environ.get("BATCH_SECRET", "")
BATCH_SIZE = 20  # partners per enrichment call (Haiku can handle 20 at once)

def load_partners():
    """Load all partners from the backend API."""
    url = f"{BACKEND_URL}/api/partners"
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read())

def enrich_batch(partners_batch):
    """Generate search profiles for a batch of partners using Haiku."""
    partner_summaries = []
    for p in partners_batch:
        summary = {
            "partner_id": p.get("partner_id", ""),
            "name": p.get("name", ""),
            "category": p.get("category", ""),
            "subcategory": p.get("subcategory", ""),
            "cuisine": p.get("cuisine", ""),
            "description": (p.get("description", "") or "")[:200],
            "experience": (p.get("experience", "") or "")[:200],
            "price_range": p.get("price_range", ""),
            "rating": p.get("rating", ""),
            "address": (p.get("address", "") or "")[:100],
        }
        partner_summaries.append(summary)

    system = """You are a Cartagena tourism expert. For each partner, generate a search_profile string that helps match user queries to this venue.

RULES:
- Derive ONLY from the partner's real data. Do NOT invent specific dishes/drinks the venue may not serve.
- For restaurants/cafes: include typical drinks/dishes for their cuisine type (e.g., cafe → latte, macchiato, cortado, tinto; seafood → ceviche, langosta, lobster)
- Include: vibe/atmosphere tags, best-for moments (date night, family, solo, work, sunset, late night), and 8-15 search keywords
- Include Spanish AND English terms
- Keep each profile under 300 chars
- Return a JSON array of objects: [{"partner_id": "...", "search_profile": "..."}]"""

    user = json.dumps(partner_summaries, ensure_ascii=False)

    body = json.dumps({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 4096,
        "temperature": 0.3,
        "system": [{"type": "text", "text": system}],
        "messages": [{"role": "user", "content": user}],
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
        },
    )

    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.loads(r.read())

    text = ""
    for block in resp.get("content", []):
        if block.get("type") == "text":
            text += block["text"]

    # Parse JSON from response
    start = text.find("[")
    end = text.rfind("]") + 1
    if start >= 0 and end > start:
        return json.loads(text[start:end])
    return []

def write_batch(updates):
    """Write search_profile updates via batch-update API."""
    body = json.dumps({
        "secret": BATCH_SECRET,
        "updates": [{"partner_id": u["partner_id"], "search_profile": u["search_profile"]} for u in updates],
    }).encode()

    req = urllib.request.Request(
        f"{BACKEND_URL}/api/admin/batch-update",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def main():
    apply = "--apply" in sys.argv

    if not ANTHROPIC_KEY:
        print("ERROR: Set ANTHROPIC_API_KEY env var")
        sys.exit(1)
    if apply and not BATCH_SECRET:
        print("ERROR: Set BATCH_SECRET env var for --apply mode")
        sys.exit(1)

    partners = load_partners()
    print(f"Loaded {len(partners)} partners")

    all_profiles = []
    total = len(partners)

    for i in range(0, total, BATCH_SIZE):
        batch = partners[i:i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        total_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE
        print(f"  Batch {batch_num}/{total_batches} ({len(batch)} partners)...", end=" ", flush=True)

        try:
            profiles = enrich_batch(batch)
            all_profiles.extend(profiles)
            print(f"OK ({len(profiles)} profiles)")
        except Exception as e:
            print(f"FAILED: {e}")
            # Continue with remaining batches
            continue

        # Rate limit: ~1 req/sec for Haiku
        if i + BATCH_SIZE < total:
            time.sleep(0.5)

    print(f"\nGenerated {len(all_profiles)} profiles out of {total} partners")

    # Show 5 samples
    print("\n=== SAMPLE PROFILES ===")
    for p in all_profiles[:5]:
        print(f"  {p['partner_id']}: {p['search_profile'][:120]}...")

    if apply:
        print(f"\nWriting {len(all_profiles)} profiles to DB...")
        # Write in batches of 50
        written = 0
        for i in range(0, len(all_profiles), 50):
            batch = all_profiles[i:i + 50]
            try:
                result = write_batch(batch)
                written += result.get("updated", 0)
                print(f"  Batch {i//50 + 1}: {result}")
            except Exception as e:
                print(f"  Batch {i//50 + 1}: FAILED — {e}")
        print(f"\nTotal written: {written}/{len(all_profiles)}")
    else:
        print(f"\nDRY RUN — use --apply to write to DB")
        # Save to file for review
        with open("scripts/enrichment_output.json", "w") as f:
            json.dump(all_profiles, f, indent=2, ensure_ascii=False)
        print(f"Saved to scripts/enrichment_output.json for review")

if __name__ == "__main__":
    main()
