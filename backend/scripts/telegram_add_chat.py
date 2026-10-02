#!/usr/bin/env python3
"""Add a person to TELEGRAM_ALERT_CHAT_IDS (production) WITHOUT ever printing a chat id.

Precondition: the person has opened Telegram, started the AMO alert bot and sent it
any message (e.g. /start) within the last ~24h, so the bot's getUpdates lists them.

Usage (from backend/, with a freshly pulled env file that is NOT named .env*):
    npx vercel env pull /tmp/some/prod.vars --environment production --yes
    python3 scripts/telegram_add_chat.py --env /tmp/some/prod.vars --name Sergio
    npx vercel --prod            # env changes apply on the next deploy
    # then prove delivery: POST /api/admin/maintenance/alert-test (Bearer CRON_SECRET)

Prints only: who was matched (first name), the resulting list COUNT, and the vercel
CLI exit status. Delete the pulled env file afterwards.
"""
import argparse
import json
import subprocess
import sys
import urllib.request


def load_env(path: str) -> dict:
    env = {}
    for line in open(path, encoding="utf-8"):
        if "=" in line and not line.startswith("#"):
            k, v = line.rstrip("\n").split("=", 1)
            env[k] = v.strip().strip('"')
    return env


def find_chat(token: str, name: str) -> str | None:
    with urllib.request.urlopen(f"https://api.telegram.org/bot{token}/getUpdates?limit=100", timeout=20) as r:
        updates = json.load(r).get("result", [])
    want = name.strip().lower()
    for u in reversed(updates):  # newest first
        m = u.get("message") or u.get("my_chat_member") or {}
        ch = m.get("chat") or {}
        label = " ".join(str(ch.get(k) or "") for k in ("first_name", "last_name", "username", "title")).lower()
        if ch.get("id") is not None and want in label:
            return str(ch["id"])
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", required=True, help="pulled production env file (never a .env* path)")
    ap.add_argument("--name", required=True, help="first name / username to match in the bot's recent chats")
    args = ap.parse_args()
    env = load_env(args.env)
    token = env.get("TELEGRAM_BOT_TOKEN", "")
    if not token:
        print("TELEGRAM_BOT_TOKEN missing in env file"); return 2
    current = [c.strip() for c in env.get("TELEGRAM_ALERT_CHAT_IDS", "").split(",") if c.strip()]
    cid = find_chat(token, args.name)
    if not cid:
        print(f"no recent chat matching {args.name!r} — ask them to open the bot and send /start, then re-run")
        return 3
    if cid in current:
        print(f"{args.name}: already on the list (count {len(current)})"); return 0
    new_list = current + [cid]
    proc = subprocess.run(
        ["npx", "vercel", "env", "add", "TELEGRAM_ALERT_CHAT_IDS", "production", "--force", "--yes"],
        input=",".join(new_list), text=True, capture_output=True)
    ok = proc.returncode == 0
    print(f"{args.name}: matched ✓ | list count {len(current)} -> {len(new_list)} | vercel env add exit {proc.returncode}{'' if ok else ' (see stderr)'}")
    if not ok:
        sys.stderr.write(proc.stderr[-400:] + "\n")
    return 0 if ok else 4


if __name__ == "__main__":
    sys.exit(main())
