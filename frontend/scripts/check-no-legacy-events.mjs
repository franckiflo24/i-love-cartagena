#!/usr/bin/env node
/**
 * check-no-legacy-events.mjs: EVENTS-ELITE build gate (docs/events-elite/DESIGN.md
 * §15 T5, §13 D1).
 *
 * Fails the web build (exit 1) when the static data that ships contains a legacy
 * event. Legacy means any event/concert/season id or slug from the pre-cutover
 * backup (docs/events-elite/legacy-backup-2026-09-28), or the `evt_0` / `con_0`
 * patterns, or any `evt_` id (city_events ids are `ce-…` and never start with
 * `evt_`; DESIGN §2).
 *
 * It also fails when a legacy static PATH exists again: public/data/events.json,
 * events/, concerts.json or concerts/. Vercel serves the filesystem BEFORE
 * rewrites, so one of those files would silently shadow the external rewrite in
 * vercel.json (/data/events.json → backend /api/events) and resurrect stale rows.
 *
 * Scanned roots: public/data always, and dist/data when it exists. vercel.json's
 * buildCommand runs this right after `expo export` (which wipes and rebuilds dist
 * first), so dist/data is exactly what deploys.
 *
 * Id source. Vercel uploads only frontend/ (rootDirectory is null), so the backup
 * under ../docs is absent in the remote build. The ids are therefore snapshotted
 * into scripts/legacy-event-ids.json, which must be committed with this script.
 * When the backup IS present (local runs) it is re-read and the snapshot must
 * contain every backup id; otherwise the run fails and asks for --write-snapshot.
 * Partner and venue backups are live catalog data, not events, so they are
 * excluded.
 *
 * Asset paths (`/images/...`) are ignored when matching. An image file named
 * after a legacy slug (e.g. /images/events/hay-festival-cartagena-2027.jpg) is a
 * photo that a verified row may legitimately reuse, not a legacy event record.
 *
 * Usage:
 *   node scripts/check-no-legacy-events.mjs                  # gate (exit 0 ok, 1 legacy found, 2 cannot verify)
 *   node scripts/check-no-legacy-events.mjs --write-snapshot # rebuild scripts/legacy-event-ids.json from the backup
 *   node scripts/check-no-legacy-events.mjs --data-dir=<dir> # scan <dir> instead of the default roots (repeatable; for tests)
 *
 * Fail-closed: with no loadable id list the gate exits 2, and the build fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKUP_DIR = path.resolve(FRONTEND, '..', 'docs', 'events-elite', 'legacy-backup-2026-09-28');
const SNAPSHOT = path.join(FRONTEND, 'scripts', 'legacy-event-ids.json');
const DEFAULT_ROOTS = [
  { dir: path.join(FRONTEND, 'public', 'data'), required: true },
  { dir: path.join(FRONTEND, 'dist', 'data'), required: false },
];

/** Paths (relative to a data root) that must never exist again: they shadow the rewrites. */
const LEGACY_PATHS = ['events.json', 'events', 'concerts.json', 'concerts'];
/** Record fields that carry an event identity in the backup files. */
const ID_FIELDS = ['event_id', 'id', 'slug', 'concert_id', 'season_id'];
/** Backup files that are live catalog data, not events. */
const NON_EVENT_BACKUP = /(partners|venues)/i;
/** Clean ids ([a-z0-9_-], ≥6 chars) are matched as exact tokens. */
const ID_SHAPE = /^[a-z0-9][a-z0-9_-]{5,}$/;
/** Other legacy slugs (e.g. "brunch-&-beats", "after-party-fénix") are matched as
 *  literal substrings. They must still be specific: ≥6 chars, a - or _, no whitespace. */
const isSpecific = (id) => id.length >= 6 && /[_-]/.test(id) && !/\s/.test(id);
/** Python json.dumps (ensure_ascii) form of a literal: é → é. */
const asciiEscaped = (s) => s.replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const PATTERNS = [
  { re: /\b(?:evt|con)_0/i, label: 'evt_0/con_0 legacy id pattern' },
  { re: /\bevt_[a-z0-9]/i, label: 'evt_ id (city_events ids are ce-…, DESIGN §2)' },
];
const TEXT_EXT = new Set(['.json', '.txt', '.csv', '.xml', '.html', '.js', '.ics', '.map']);
const MAX_TEXT_BYTES = 25 * 1024 * 1024;
const ASSET_PATH = /\/images\/[^"'\s)<>]*/gi;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    // static_calendar.json is {"YYYY-MM-DD": [rows]}; any array value holds rows.
    return Object.values(data).filter(Array.isArray).flat();
  }
  return [];
}

/** Every legacy id in the backup. Returns { ids:Set, rejected:string[] }. */
function idsFromBackup(dir) {
  const ids = new Set();
  const rejected = [];
  const take = (v) => {
    if (typeof v !== 'string') return;
    const id = v.trim().toLowerCase();
    if (!id) return;
    if (isSpecific(id)) ids.add(id);
    else if (!rejected.includes(id)) rejected.push(id);
  };
  const takeRow = (r) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return;
    for (const k of ID_FIELDS) take(r[k]);
  };
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json') || NON_EVENT_BACKUP.test(name)) continue;
    rowsOf(readJson(path.join(dir, name))).forEach(takeRow);
  }
  const detailDir = path.join(dir, 'past_event_detail');
  if (fs.existsSync(detailDir)) {
    for (const name of fs.readdirSync(detailDir)) {
      if (!name.endsWith('.json')) continue;
      const data = readJson(path.join(detailDir, name));
      if (name === '_status.json') {
        if (data && typeof data === 'object') Object.keys(data).forEach(take);
      } else {
        take(name.slice(0, -'.json'.length));
        takeRow(data);
      }
    }
  }
  return { ids, rejected };
}

function writeSnapshot() {
  if (!fs.existsSync(BACKUP_DIR)) {
    console.error(`FATAL: backup not found at ${BACKUP_DIR}; cannot write the snapshot.`);
    process.exit(2);
  }
  const { ids, rejected } = idsFromBackup(BACKUP_DIR);
  const body = {
    about: 'Legacy event/concert/season ids from docs/events-elite/legacy-backup-2026-09-28 (pre EVENTS-ELITE). Read by scripts/check-no-legacy-events.mjs; regenerate with --write-snapshot.',
    source: 'docs/events-elite/legacy-backup-2026-09-28',
    generated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    count: ids.size,
    ids: [...ids].sort(),
  };
  fs.writeFileSync(SNAPSHOT, `${JSON.stringify(body, null, 1)}\n`);
  console.log(`snapshot written: ${path.relative(FRONTEND, SNAPSHOT)} (${ids.size} ids${rejected.length ? `; ${rejected.length} values too generic to match, skipped: ${rejected.slice(0, 5).join(', ')}` : ''})`);
}

/** Splits ids into exact-token ids and literal-substring slugs (with their escaped forms). */
function matcherFor(ids) {
  const tokens = new Set();
  const literals = [];
  for (const id of ids) {
    if (ID_SHAPE.test(id)) tokens.add(id);
    else literals.push({ id, forms: [...new Set([id, asciiEscaped(id)])] });
  }
  return { all: ids, tokens, literals };
}

/** Snapshot ∪ backup. Exits 2 (fail-closed) when neither loads or the snapshot is stale. */
function loadLegacyIds() {
  let snap = null;
  if (fs.existsSync(SNAPSHOT)) {
    try {
      const raw = readJson(SNAPSHOT);
      if (!Array.isArray(raw?.ids)) throw new Error('no ids array');
      snap = new Set(raw.ids.map((s) => String(s).toLowerCase()));
    } catch (e) {
      console.error(`FATAL: ${path.relative(FRONTEND, SNAPSHOT)} is unreadable (${e instanceof Error ? e.message : 'parse error'}).`);
      process.exit(2);
    }
  }
  let backup = null;
  if (fs.existsSync(BACKUP_DIR)) {
    try {
      backup = idsFromBackup(BACKUP_DIR).ids;
    } catch (e) {
      console.error(`FATAL: legacy backup unreadable (${e instanceof Error ? e.message : 'parse error'}).`);
      process.exit(2);
    }
  }
  if (!snap && !backup) {
    console.error('FATAL: no legacy id list (scripts/legacy-event-ids.json missing and no backup). Cannot prove the data is clean.');
    process.exit(2);
  }
  if (backup) {
    const missing = [...backup].filter((id) => !snap || !snap.has(id));
    if (missing.length > 0) {
      console.error(`FATAL: scripts/legacy-event-ids.json is ${snap ? 'stale' : 'missing'}: ${missing.length} backup id(s) absent (e.g. ${missing.slice(0, 3).join(', ')}).`);
      console.error('       Run: node scripts/check-no-legacy-events.mjs --write-snapshot   (and commit the file; the Vercel build has no docs/ folder)');
      process.exit(2);
    }
  }
  return matcherFor(new Set([...(snap || []), ...(backup || [])]));
}

function walkFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else out.push({ abs: p, symlink: e.isSymbolicLink() });
  }
  return out;
}

function scanRoot(root, matcher, label) {
  const { all, tokens, literals } = matcher;
  const problems = [];
  for (const p of LEGACY_PATHS) {
    const abs = path.join(root, p);
    if (fs.existsSync(abs)) {
      problems.push(`${label}/${p}: legacy static path exists. It shadows the vercel.json rewrite to the backend (Vercel serves files before rewrites). Delete it.`);
    }
  }
  let scanned = 0;
  for (const f of walkFiles(root)) {
    const rel = path.relative(root, f.abs).split(path.sep).join('/');
    const where = `${label}/${rel}`;
    for (const seg of rel.toLowerCase().split('/')) {
      const stem = seg.replace(/\.[a-z0-9]+$/, '');
      if (all.has(stem)) problems.push(`${where}: file name is a legacy id (${stem}).`);
    }
    for (const { re, label: why } of PATTERNS) {
      if (re.test(rel)) { problems.push(`${where}: file name matches ${why}.`); break; }
    }
    if (f.symlink || !TEXT_EXT.has(path.extname(rel).toLowerCase())) continue;
    const size = fs.statSync(f.abs).size;
    if (size > MAX_TEXT_BYTES) { problems.push(`${where}: ${Math.round(size / 1048576)} MB text file is too large to verify.`); continue; }
    scanned++;
    const text = fs.readFileSync(f.abs, 'utf8').toLowerCase().replace(ASSET_PATH, ' ');
    const hits = new Set();
    for (const tok of text.split(/[^a-z0-9_-]+/)) if (tok && tokens.has(tok)) hits.add(tok);
    for (const { id, forms } of literals) if (forms.some((f) => text.includes(f))) hits.add(id);
    if (hits.size > 0) {
      const list = [...hits];
      problems.push(`${where}: contains ${list.length} legacy id(s): ${list.slice(0, 8).join(', ')}${list.length > 8 ? ', …' : ''}`);
    }
    for (const { re, label: why } of PATTERNS) {
      const m = re.exec(text);
      if (m) {
        const at = Math.max(0, m.index - 30);
        problems.push(`${where}: matches ${why} near "…${text.slice(at, m.index + 30).replace(/\s+/g, ' ')}…"`);
        break;
      }
    }
  }
  return { problems, scanned };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--write-snapshot')) { writeSnapshot(); return; }

  const custom = args.filter((a) => a.startsWith('--data-dir=')).map((a) => path.resolve(a.slice('--data-dir='.length)));
  const roots = custom.length > 0 ? custom.map((dir) => ({ dir, required: true })) : DEFAULT_ROOTS;
  const matcher = loadLegacyIds();

  const problems = [];
  const summary = [];
  for (const { dir, required } of roots) {
    const rel = path.relative(FRONTEND, dir);
    const label = rel && !rel.startsWith('..') ? rel : dir;
    if (!fs.existsSync(dir)) {
      if (required) problems.push(`${label}: data root is missing.`);
      else summary.push(`${label}: absent (skipped)`);
      continue;
    }
    const r = scanRoot(dir, matcher, label);
    problems.push(...r.problems);
    summary.push(`${label}: ${r.scanned} text files scanned`);
  }

  if (problems.length > 0) {
    console.error(`LEGACY EVENTS FOUND: ${problems.length} problem(s). The build must not ship these (DESIGN.md §15 T5).`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`NO LEGACY EVENTS: ${matcher.all.size} legacy ids + evt_/con_0 patterns checked (${summary.join('; ')}).`);
}

main();
