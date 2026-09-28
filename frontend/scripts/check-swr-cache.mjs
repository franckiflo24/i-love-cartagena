#!/usr/bin/env node
/**
 * check-swr-cache.mjs — unit-style check for src/lib/swrCache.ts in plain Node.
 *
 *   cd frontend && node scripts/check-swr-cache.mjs
 *
 * Transpiles the REAL module with the project's TypeScript, swaps the
 * AsyncStorage import for an in-memory mock (with a "throws" switch) and drives
 * the factory with a fake clock and a synchronous defer. Exits non-zero on the
 * first failing assertion. No network, no Expo, no bundler.
 *
 * What it proves:
 *   1. put → peek round-trip (memory) and round-trip through a cold instance (disk)
 *   2. TTL: an entry older than SWR_TTL_MS is not served and is evicted
 *   3. private paths never cache while anonymous; scoped keys carry the user_id;
 *      user B cannot read user A's rows
 *   4. clearScope wipes ONLY that user's rows (memory + disk), public rows survive
 *   5. oversize payloads stay memory-only (no AsyncStorage row > SWR_PERSIST_MAX)
 *   6. unchanged content is not re-persisted (hash skip); changed content is
 *   7. a throwing store degrades to memory-only — peek/put never reject
 *   8. corrupt / foreign JSON on disk reads as a miss
 *   9. NO_CACHE_PATH (search/auth/health) is never stored
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');

// ── Mock AsyncStorage ────────────────────────────────────────────
function makeStore() {
  const map = new Map();
  const log = { get: 0, set: 0, remove: 0, multiRemove: 0 };
  const store = {
    throws: false,
    map,
    log,
    async getItem(k) { log.get++; if (store.throws) throw new Error('storage unavailable'); return map.has(k) ? map.get(k) : null; },
    async setItem(k, v) { log.set++; if (store.throws) throw new Error('storage unavailable'); map.set(k, v); },
    async removeItem(k) { log.remove++; if (store.throws) throw new Error('storage unavailable'); map.delete(k); },
    async getAllKeys() { if (store.throws) throw new Error('storage unavailable'); return Array.from(map.keys()); },
    async multiRemove(keys) { log.multiRemove++; if (store.throws) throw new Error('storage unavailable'); for (const k of keys) map.delete(k); },
  };
  return store;
}

// ── Load the real module ─────────────────────────────────────────
const srcPath = path.join(root, 'src', 'lib', 'swrCache.ts');
const source = readFileSync(srcPath, 'utf8');
const { outputText, diagnostics } = ts.transpileModule(source, {
  fileName: srcPath,
  reportDiagnostics: true,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
    strict: true,
  },
});
if (diagnostics && diagnostics.length) {
  for (const d of diagnostics) console.error('transpile:', ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  process.exit(2);
}
const defaultStore = makeStore();
const mod = { exports: {} };
const fakeRequire = (spec) => {
  if (spec === '@react-native-async-storage/async-storage') return { __esModule: true, default: defaultStore };
  throw new Error(`swrCache.ts imported an unexpected module in Node: ${spec}`);
};
new Function('require', 'module', 'exports', outputText)(fakeRequire, mod, mod.exports);
const { createSwrCache, PRIVATE_PATH, NO_CACHE_PATH, SWR_NS, SWR_TTL_MS, SWR_PERSIST_MAX, swr: defaultSwr } = mod.exports;

// ── Tiny assertion harness ───────────────────────────────────────
let passed = 0;
const failures = [];
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n${t}`);

// Fake clock + synchronous defer so persists are observable immediately.
let clock = 1_700_000_000_000;
const now = () => clock;
const defer = (fn) => fn();
const mk = (store) => createSwrCache(store, { now, defer });

// ── 1. round-trip ─────────────────────────────────────────────────
section('1. put → peek round-trip');
{
  const store = makeStore();
  const c = mk(store);
  check('cold peek is null', (await c.peek('/seasons')) === null);
  c.put('/seasons', [{ id: 's1', name: 'Verde' }]);
  const m = await c.peek('/seasons');
  check('memory peek returns payload', Array.isArray(m) && m[0].id === 's1');
  await c.flush();
  check('persisted under namespaced key', store.map.has(`${SWR_NS}/seasons`), Array.from(store.map.keys()).join(','));
  const cold = mk(store); // new instance, same disk
  const d = await cold.peek('/seasons');
  check('cold instance reads from disk', Array.isArray(d) && d[0].name === 'Verde');
  const entry = await cold.peekEntry('/seasons');
  check('peekEntry carries timestamp', entry && entry.t === clock);
  check('memSize counts hydrated rows', cold.memSize() === 1);
  c.put('/partner-events?date=2026-09-26', [{ id: 'pe1' }]);
  check('query-string paths are keyed by full path', c.keyFor('/partner-events?date=2026-09-26').endsWith('?date=2026-09-26'));
}

// ── 2. TTL ────────────────────────────────────────────────────────
section('2. TTL expiry');
{
  const store = makeStore();
  const c = mk(store);
  c.put('/events', [{ id: 'e1' }]);
  await c.flush();
  clock += SWR_TTL_MS + 1;
  check('expired memory entry is not served', (await c.peek('/events')) === null);
  const cold = mk(store);
  check('expired disk entry is not served', (await cold.peek('/events')) === null);
  await cold.flush();
  check('expired disk entry is evicted', !store.map.has(`${SWR_NS}/events`));
  clock -= SWR_TTL_MS + 1;
}

// ── 3. private scoping ────────────────────────────────────────────
section('3. private paths + scope');
{
  const store = makeStore();
  const c = mk(store);
  check('PRIVATE_PATH matches /reservations/my', PRIVATE_PATH.test('/reservations/my'));
  check('PRIVATE_PATH matches /favorites/ids', PRIVATE_PATH.test('/favorites/ids'));
  check('PRIVATE_PATH does not match /partners', !PRIVATE_PATH.test('/partners'));
  check('anon: private path not cacheable', !c.isCacheable('/reservations/my'));
  c.put('/reservations/my', { upcoming: [{ reservation_id: 'r-anon' }] });
  await c.flush();
  check('anon: private put is a no-op (memory)', c.memSize() === 0);
  check('anon: private put is a no-op (disk)', store.map.size === 0);
  check('anon: private peek is null', (await c.peek('/reservations/my')) === null);

  c.setScope('user-A');
  check('scope set', c.getScope() === 'user-A');
  check('scoped key carries user id', c.keyFor('/reservations/my') === `${SWR_NS}user-A:/reservations/my`);
  check('public key has no user id', c.keyFor('/partners') === `${SWR_NS}/partners`);
  c.put('/reservations/my', { upcoming: [{ reservation_id: 'r-A' }] });
  c.put('/partners', [{ partner_id: 'p1' }]);
  await c.flush();
  const a = await c.peek('/reservations/my');
  check('user A reads own private row', a && a.upcoming[0].reservation_id === 'r-A');

  c.setScope('user-B');
  check('user B cannot read user A private row', (await c.peek('/reservations/my')) === null);
  check('user B still reads public row', Array.isArray(await c.peek('/partners')));

  c.setScope(null);
  check('null scope → anon', c.getScope() === 'anon');
  check('anon after logout cannot read A private row', (await c.peek('/reservations/my')) === null);
}

// ── 4. clearScope ─────────────────────────────────────────────────
section('4. clearScope wipes only that user');
{
  const store = makeStore();
  const c = mk(store);
  c.setScope('user-A');
  c.put('/reservations/my', { upcoming: [1] });
  c.put('/favorites/ids', ['x']);
  c.put('/partners', [{ partner_id: 'p1' }]);
  c.setScope('user-B');
  c.put('/reservations/my', { upcoming: [2] });
  await c.flush();
  check('setup: 4 rows on disk', store.map.size === 4, `${store.map.size}`);
  await c.clearScope('user-A');
  const keys = Array.from(store.map.keys());
  check('A private rows removed from disk', !keys.some((k) => k.startsWith(`${SWR_NS}user-A:`)), keys.join(','));
  check('B private row survives', keys.includes(`${SWR_NS}user-B:/reservations/my`));
  check('public row survives', keys.includes(`${SWR_NS}/partners`));
  c.setScope('user-A');
  check('A memory rows removed', (await c.peek('/reservations/my')) === null && (await c.peek('/favorites/ids')) === null);
  check('memSize excludes wiped rows', c.memSize() === 2, `${c.memSize()}`);
  await c.clearScope('');
  check('clearScope("") is a no-op', store.map.size === 2);
}

// ── 5. oversize ───────────────────────────────────────────────────
section('5. oversize payload stays memory-only');
{
  const store = makeStore();
  const c = mk(store);
  const big = { blob: 'x'.repeat(SWR_PERSIST_MAX + 10) };
  c.put('/partners', big);
  await c.flush();
  check('oversize not persisted', store.map.size === 0);
  check('oversize served from memory', (await c.peek('/partners'))?.blob.length === SWR_PERSIST_MAX + 10);
  check('oversize did not call setItem', store.log.set === 0);
}

// ── 6. hash skip ──────────────────────────────────────────────────
section('6. unchanged content is not re-persisted');
{
  const store = makeStore();
  const c = mk(store);
  const rows = [{ partner_id: 'p1', name: 'Carmen' }];
  c.put('/partners', rows);
  clock += 1000;
  c.put('/partners', [{ partner_id: 'p1', name: 'Carmen' }]); // same content, new timestamp
  await c.flush();
  check('second identical put skipped setItem', store.log.set === 1, `set=${store.log.set}`);
  clock += 1000;
  c.put('/partners', [{ partner_id: 'p1', name: 'Carmen ' }]); // changed content
  await c.flush();
  check('changed content persisted', store.log.set === 2, `set=${store.log.set}`);
  const entry = await c.peekEntry('/partners');
  check('memory timestamp is the latest put', entry.t === clock);
  // A cold instance that hydrates from disk must also learn the hash so its first
  // identical put does not rewrite 1.3 MB.
  const cold = mk(store);
  await cold.peek('/partners');
  cold.put('/partners', [{ partner_id: 'p1', name: 'Carmen ' }]);
  await cold.flush();
  check('cold instance skips re-persist of identical disk content', store.log.set === 2, `set=${store.log.set}`);
}

// ── 7. throwing store ─────────────────────────────────────────────
section('7. throwing store degrades to memory-only');
{
  const store = makeStore();
  store.throws = true;
  const c = mk(store);
  let threw = false;
  try {
    c.put('/seasons', [1]);
    await c.flush();
    const v = await c.peek('/seasons');
    check('peek served from memory despite throwing store', Array.isArray(v) && v[0] === 1);
    c.setScope('user-A');
    await c.clearScope('user-A');
    await c.invalidate('/seasons');
    check('invalidate cleared memory despite throwing store', (await c.peek('/seasons')) === null);
  } catch (e) { threw = true; console.error(e); }
  check('no rejection escaped put/peek/clearScope/invalidate', !threw);
  store.throws = false;
  c.put('/seasons', [2]);
  await c.flush();
  check('recovers once storage works again', store.map.has(`${SWR_NS}/seasons`));
}

// ── 8. corrupt disk rows ──────────────────────────────────────────
section('8. corrupt / foreign rows read as a miss');
{
  const store = makeStore();
  store.map.set(`${SWR_NS}/seasons`, '{not json');
  store.map.set(`${SWR_NS}/events`, JSON.stringify({ foo: 'bar' })); // no t/data
  store.map.set(`${SWR_NS}/concerts`, JSON.stringify({ t: 'yesterday', data: [] })); // wrong t type
  const c = mk(store);
  check('malformed JSON → null', (await c.peek('/seasons')) === null);
  check('missing envelope → null', (await c.peek('/events')) === null);
  check('wrong timestamp type → null', (await c.peek('/concerts')) === null);
  check('nothing hydrated into memory', c.memSize() === 0);
}

// ── 9. NO_CACHE_PATH ──────────────────────────────────────────────
section('9. never-cache paths');
{
  const store = makeStore();
  const c = mk(store);
  c.setScope('user-A');
  for (const p of ['/search?q=ceviche', '/auth/me', '/health', '/intel/overview', '/admin/stats']) {
    check(`${p} not cacheable`, !c.isCacheable(p) && NO_CACHE_PATH.test(p));
    c.put(p, { hit: true });
  }
  await c.flush();
  check('none stored', c.memSize() === 0 && store.map.size === 0);
}

// ── 10. default instance wiring ───────────────────────────────────
section('10. default export is wired to AsyncStorage');
{
  defaultSwr.put('/seasons', [{ id: 'default' }]);
  await new Promise((r) => setTimeout(r, 5)); // real defer = setTimeout(0)
  await defaultSwr.flush();
  check('default swr persisted through the injected AsyncStorage', defaultStore.map.has(`${SWR_NS}/seasons`));
  check('default swr peek', (await defaultSwr.peek('/seasons'))?.[0]?.id === 'default');
}

// ── Summary ───────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error('FAILED:', failures.join(' | '));
  process.exit(1);
}
console.log('SWR CACHE OK');
