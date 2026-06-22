"""
One-shot deploy helper:
  1. Read backend/.env raw
  2. Heal MONGO_URL_ATLAS (strips quotes, joins broken multi-line URLs, drops dupes)
  3. Write .env back clean
  4. Set os.environ from healed values
  5. Run the Atlas migration

Run from anywhere:
    python3 /Users/showowt/i-love-cartagena/backend/scripts/deploy_now.py
"""
import os
import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
ENV = BACKEND / ".env"

if not ENV.exists():
    print(f"ERROR: {ENV} not found", file=sys.stderr)
    sys.exit(2)

raw = ENV.read_text()
print(f"[1/5] read {ENV}  ({len(raw)} bytes)")

# Split into logical lines, then reconstruct broken MONGO_URL_ATLAS that wraps
lines = raw.splitlines()

# Find any MONGO_URL_ATLAS= line and collect continuation lines that start with
# @cluster, or otherwise look like part of the URL (no = sign, not blank)
healed = []
i = 0
seen_keys = set()
while i < len(lines):
    line = lines[i]
    stripped = line.strip()

    # Skip blank or comment lines but preserve blanks once
    if not stripped or stripped.startswith("#"):
        healed.append(line)
        i += 1
        continue

    m = re.match(r"^\s*([A-Z_][A-Z0-9_]*)\s*=(.*)$", line)
    if not m:
        # Orphan continuation line (e.g. starts with @cluster0...) — skip, we'll have folded it in
        i += 1
        continue

    key, val = m.group(1), m.group(2)
    # Strip surrounding single/double quotes
    val = val.strip()
    if (val.startswith("'") and val.endswith("'")) or (val.startswith('"') and val.endswith('"')):
        val = val[1:-1]
    # If quoted-open but not closed, drop the leading quote (will rejoin continuation)
    elif val.startswith("'") or val.startswith('"'):
        val = val[1:]

    # Look ahead for continuation lines (start with @ or are bare URL fragments)
    j = i + 1
    while j < len(lines):
        nxt = lines[j].strip()
        if not nxt:
            break
        # Continuation if: starts with @, or is the mongo fragment, or doesn't contain =
        if nxt.startswith("@") or nxt.startswith("?") or nxt.startswith("&") or ("=" not in nxt.split("&")[0] and nxt.split(".")[0] in {"mongodb", "cluster0"}):
            # Strip trailing/leading quotes from continuation
            if nxt.endswith("'") or nxt.endswith('"'):
                nxt = nxt[:-1]
            val += nxt
            j += 1
        else:
            break
    i = j

    # Clean trailing quote chars left over
    val = val.rstrip("'\"").rstrip()

    # Dedup keys (last wins for ATLAS specifically; first wins for others by default — but we'll use last for all)
    # Strategy: keep last definition
    if key in seen_keys:
        # Remove previous occurrence
        healed = [l for l in healed if not l.startswith(f"{key}=")]
    seen_keys.add(key)
    healed.append(f"{key}={val}")

# Write back
new_text = "\n".join(healed) + "\n"
ENV.write_text(new_text)
print(f"[2/5] healed .env  ({len(new_text)} bytes, {len(seen_keys)} unique keys)")

# Verify ATLAS URL looks sane
atlas = next((l for l in healed if l.startswith("MONGO_URL_ATLAS=")), None)
local = next((l for l in healed if l.startswith("MONGO_URL_LOCAL=")), None)

if not atlas:
    print("ERROR: MONGO_URL_ATLAS missing after heal. Open .env in nano and add it.", file=sys.stderr)
    sys.exit(3)
if not local:
    # Auto-add MONGO_URL_LOCAL from MONGO_URL if present
    base = next((l for l in healed if l.startswith("MONGO_URL=")), None)
    if base:
        local_val = base.split("=", 1)[1]
        ENV.write_text(new_text + f"MONGO_URL_LOCAL={local_val}\n")
        os.environ["MONGO_URL_LOCAL"] = local_val
        print(f"[+] auto-added MONGO_URL_LOCAL={local_val}")
    else:
        print("ERROR: MONGO_URL_LOCAL missing and no MONGO_URL to fall back on", file=sys.stderr)
        sys.exit(4)

atlas_val = atlas.split("=", 1)[1]
print(f"[3/5] Atlas URL length: {len(atlas_val)} chars")
if "mongodb+srv://" not in atlas_val or "@cluster" not in atlas_val:
    print(f"ERROR: Atlas URL malformed: {atlas_val[:60]}...", file=sys.stderr)
    sys.exit(5)
if " " in atlas_val:
    print(f"ERROR: Atlas URL contains a space — open .env and remove it", file=sys.stderr)
    sys.exit(6)

# Inject into os.environ for the migration script to read
for line in healed:
    if "=" in line:
        k, v = line.split("=", 1)
        os.environ[k] = v

print(f"[4/5] env loaded -> os.environ")

# Now run the migration
print(f"[5/5] running migrate_to_atlas.py --apply\n")
sys.argv = ["migrate_to_atlas.py", "--apply"]
sys.path.insert(0, str(BACKEND / "scripts"))
import migrate_to_atlas
sys.exit(migrate_to_atlas.main())
