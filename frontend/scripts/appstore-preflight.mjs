#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// App Store PREFLIGHT — Tier-1 automated gate. Run BEFORE every `eas submit`.
//
// WHY THIS EXISTS: Amo Cartagena was rejected three times on things a checklist
// catches in seconds — not bad luck, a process gap. Apple reviews iPhone-only
// apps ON AN iPAD; we test on web + iPhone. Web passes where native fails
// (navigator.language is empty on native → forced Spanish → permission-prompt
// language mismatch). This script front-loads the known rejection classes so we
// stop letting App Review be our QA.
//
// It does NOT replace the Tier-2 human pass (run the binary on an iPad simulator,
// non-Spanish device language, walk login → onboarding → permission → tabs).
// See APP_STORE_PREFLIGHT.md.
//
// USAGE:  node scripts/appstore-preflight.mjs [--skip-tsc] [--no-net]
// EXIT:   non-zero if any ERROR-level check fails.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');           // the frontend/ dir
const APP_JSON = path.join(ROOT, 'app.json');
const EAS_JSON = path.join(ROOT, 'eas.json');
const PKG_JSON = path.join(ROOT, 'package.json');
const APP_DIR = path.join(ROOT, 'app');
const TRANSLATIONS = path.join(ROOT, 'src', 'i18n', 'translations.ts');

const args = new Set(process.argv.slice(2));
const SKIP_TSC = args.has('--skip-tsc');
const NO_NET = args.has('--no-net');

// Native permission modules → the iOS usage-description key each one triggers.
// If the module is installed, that key MUST exist in Info.plist AND in every
// localized strings file, or the reviewer sees a prompt in the wrong language.
const PERMISSION_MODULES = {
  'expo-location': 'NSLocationWhenInUseUsageDescription',
  'expo-image-picker': 'NSPhotoLibraryUsageDescription',
  'expo-media-library': 'NSPhotoLibraryUsageDescription',
  'expo-camera': 'NSCameraUsageDescription',
  'expo-contacts': 'NSContactsUsageDescription',
  'expo-calendar': 'NSCalendarsFullAccessUsageDescription',
  'expo-tracking-transparency': 'NSUserTrackingUsageDescription',
  'expo-av': 'NSMicrophoneUsageDescription',
};

const findings = []; // { level: 'ERROR'|'WARN'|'INFO'|'OK', check, msg }
const add = (level, check, msg) => findings.push({ level, check, msg });

function readJSON(p) { return JSON.parse(readFileSync(p, 'utf8')); }

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

// ── A. TypeScript ────────────────────────────────────────────────────────────
function checkTsc() {
  if (SKIP_TSC) { add('INFO', 'typescript', 'skipped (--skip-tsc)'); return; }
  try {
    execSync('npx tsc --noEmit', { cwd: ROOT, stdio: 'pipe' });
    add('OK', 'typescript', 'tsc --noEmit clean');
  } catch (e) {
    const out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
    const n = (out.match(/error TS/g) || []).length;
    add('ERROR', 'typescript', `tsc reported ${n || 'some'} error(s). Run \`npx tsc --noEmit\`.`);
  }
}

// ── B. Permission strings localized (the repeat-offender) ────────────────────
function checkPermissionLocalization() {
  const app = readJSON(APP_JSON).expo;
  const infoPlist = app?.ios?.infoPlist || {};
  const locales = app?.locales || {};
  const pkg = readJSON(PKG_JSON);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  // Which usage-description keys does this app actually need?
  const requiredKeys = new Set(
    Object.keys(infoPlist).filter((k) => /UsageDescription$/.test(k)),
  );
  for (const [mod, key] of Object.entries(PERMISSION_MODULES)) {
    if (deps[mod]) requiredKeys.add(key);
  }

  if (requiredKeys.size === 0) {
    add('OK', 'permissions', 'no native permission strings required');
    return;
  }

  // Every required key must be declared in Info.plist.
  for (const key of requiredKeys) {
    if (!(key in infoPlist)) {
      add('ERROR', 'permissions',
        `${key} is required (a permission module is installed) but missing from ios.infoPlist.`);
    }
  }

  // If we request permissions, they must be localized via expo.locales.
  const localeCodes = Object.keys(locales);
  if (localeCodes.length === 0) {
    add('ERROR', 'permissions',
      `App requests ${requiredKeys.size} permission(s) but expo.locales is empty — prompts will show in one hardcoded language. Add locales/<lang>.json for every supported language.`);
    return;
  }

  // Each locale file must carry every required key.
  for (const [code, relPath] of Object.entries(locales)) {
    const file = path.resolve(ROOT, relPath);
    if (!existsSync(file)) {
      add('ERROR', 'permissions', `locale file for "${code}" not found: ${relPath}`);
      continue;
    }
    let loc;
    try { loc = readJSON(file); }
    catch { add('ERROR', 'permissions', `locale file for "${code}" is not valid JSON: ${relPath}`); continue; }
    const missing = [...requiredKeys].filter((k) => !(k in loc));
    if (missing.length) {
      add('ERROR', 'permissions',
        `locales/${code}: missing ${missing.join(', ')} — this prompt will fall back to another language on a ${code} device.`);
    }
  }

  // Do the localizations cover every language the app's UI supports?
  const appLangs = detectAppLanguages();
  const uncovered = appLangs.filter((l) => !localeCodes.includes(l));
  if (uncovered.length) {
    add('WARN', 'permissions',
      `App UI supports [${appLangs.join(', ')}] but expo.locales is missing [${uncovered.join(', ')}] — permission prompts won't match the app language on those devices.`);
  }

  if (!findings.some((f) => f.check === 'permissions' && f.level === 'ERROR')) {
    add('OK', 'permissions',
      `all ${requiredKeys.size} permission string(s) localized across [${localeCodes.join(', ')}]`);
  }
}

function detectAppLanguages() {
  try {
    const src = readFileSync(TRANSLATIONS, 'utf8');
    const m = src.match(/export\s+type\s+Lang\s*=\s*([^;]+);/);
    if (m) return [...m[1].matchAll(/'([a-z]{2})'/g)].map((x) => x[1]);
  } catch { /* best effort */ }
  return [];
}

// ── C. Screen layout: scroll + keyboard (Guideline 4 iPad clipping) ──────────
function checkScreenLayout() {
  if (!existsSync(APP_DIR)) { add('INFO', 'layout', 'no app/ dir found'); return; }
  const files = walk(APP_DIR);
  const noScroll = [];
  const noKav = [];
  for (const file of files) {
    const base = path.basename(file);
    if (base.startsWith('_') || base.startsWith('+')) continue;   // layouts / html
    const src = readFileSync(file, 'utf8');
    if (src.length < 400 || /<Redirect\b/.test(src)) continue;    // redirect stubs
    const rel = path.relative(ROOT, file);

    const hasScroll = /\b(ScrollView|FlatList|SectionList|VirtualizedList|WebView)\b/.test(src);
    const hasInput = /<TextInput\b/.test(src);
    const hasKav = /\bKeyboardAvoidingView\b/.test(src);
    const hasCTA = /<(TouchableOpacity|Pressable|Button|TouchableHighlight)\b/.test(src);

    // A substantial interactive screen with no scroller can clip its CTA on the
    // shorter iPad-compat window — exactly the onboarding rejection.
    if (!hasScroll && hasCTA && src.length > 1500) noScroll.push(rel);
    // A text-entry screen with no KeyboardAvoidingView hides its submit button
    // behind the keyboard — exactly the complete-profile rejection.
    if (hasInput && !hasKav) noKav.push(rel);
  }
  if (noScroll.length) {
    add('WARN', 'layout',
      `No ScrollView/FlatList — verify the primary button is reachable on iPad:\n      - ${noScroll.join('\n      - ')}`);
  }
  if (noKav.length) {
    add('WARN', 'layout',
      `Has <TextInput> but no KeyboardAvoidingView — verify the submit button clears the keyboard:\n      - ${noKav.join('\n      - ')}`);
  }
  if (!noScroll.length && !noKav.length) {
    add('OK', 'layout', `${files.length} screens scanned — no obvious scroll/keyboard gaps`);
  }
}

// ── D. Versioning config (build-number collisions) ───────────────────────────
function checkVersioning() {
  let eas;
  try { eas = readJSON(EAS_JSON); } catch { add('WARN', 'versioning', 'eas.json unreadable'); return; }
  const prod = eas?.build?.production || {};
  const src = eas?.cli?.appVersionSource;
  const autoInc = prod.autoIncrement ?? prod.ios?.autoIncrement;
  if (src === 'remote' && autoInc) {
    add('OK', 'versioning', 'appVersionSource=remote + autoIncrement — build number bumps automatically');
  } else {
    add('WARN', 'versioning',
      `appVersionSource=${src ?? 'unset'}, autoIncrement=${autoInc ?? 'unset'} — you must manually ensure ios.buildNumber is higher than the latest build on App Store Connect.`);
  }
  add('INFO', 'versioning',
    'A finished EAS build can still FAIL submit if its build number already exists on ASC (fast ~18s fail). If so: rebuild (autoIncrement) or `eas build:version:set`.');
}

// ── E. Privacy policy URL (required by Apple) ────────────────────────────────
async function checkPrivacyUrl() {
  const app = readJSON(APP_JSON).expo;
  const url = app?.extra?.privacyPolicyUrl;
  if (!url) { add('ERROR', 'privacy', 'extra.privacyPolicyUrl missing — Apple requires a privacy policy URL.'); return; }
  if (NO_NET) { add('INFO', 'privacy', `privacy URL set (${url}) — liveness check skipped (--no-net)`); return; }
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ac.signal });
    clearTimeout(t);
    if (r.ok) add('OK', 'privacy', `privacy policy live (${r.status}): ${url}`);
    else add('WARN', 'privacy', `privacy policy URL returned ${r.status}: ${url}`);
  } catch {
    add('WARN', 'privacy', `could not reach privacy policy URL: ${url}`);
  }
}

// ── F. Sign in with Apple (Guideline 4.8) ────────────────────────────────────
function checkSignInWithApple() {
  const dirs = [APP_DIR, path.join(ROOT, 'src')].filter(existsSync);
  const files = dirs.flatMap((d) => walk(d));
  let social = false, apple = false;
  const socialRe = /logo-google|GoogleSignin|signInWithGoogle|logo-facebook|FacebookLogin|react-native-fbsdk/i;
  const appleRe = /expo-apple-authentication|AppleAuthentication|AuthenticationServices|logo-apple|APPLE_SIGNIN/i;
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    if (socialRe.test(s)) social = true;
    if (appleRe.test(s)) apple = true;
  }
  const pkg = readJSON(PKG_JSON);
  if (pkg.dependencies?.['expo-apple-authentication']) apple = true;
  if (social && !apple) {
    add('WARN', 'sign-in-with-apple',
      'Third-party social login (Google/Facebook) detected without Sign in with Apple. If any social login is exposed on iOS, Guideline 4.8 requires Sign in with Apple. (OK if social is web-only or gated off native.)');
  } else {
    add('OK', 'sign-in-with-apple', social ? 'social login + Apple auth present' : 'no third-party social login on native');
  }
}

// ── G. Encryption export-compliance declaration ──────────────────────────────
function checkEncryptionDeclaration() {
  const app = readJSON(APP_JSON).expo;
  const v = app?.ios?.infoPlist?.ITSAppUsesNonExemptEncryption;
  if (v === undefined) {
    add('WARN', 'encryption',
      'ITSAppUsesNonExemptEncryption not set — submission will prompt for export compliance each time (and can stall automated submits). Set it in ios.infoPlist (false for standard HTTPS-only apps).');
  } else {
    add('OK', 'encryption', `ITSAppUsesNonExemptEncryption=${v}`);
  }
}

// ── Runner ───────────────────────────────────────────────────────────────────
function printReport() {
  const icon = { OK: '✅', WARN: '⚠️ ', INFO: 'ℹ️ ', ERROR: '❌' };
  const order = ['ERROR', 'WARN', 'OK', 'INFO'];
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  APP STORE PREFLIGHT');
  console.log('═══════════════════════════════════════════════════════════════');
  for (const level of order) {
    for (const f of findings.filter((x) => x.level === level)) {
      console.log(`${icon[f.level]} [${f.check}] ${f.msg}`);
    }
  }
  const errors = findings.filter((f) => f.level === 'ERROR').length;
  const warns = findings.filter((f) => f.level === 'WARN').length;
  console.log('───────────────────────────────────────────────────────────────');
  console.log(`  ${errors} error(s), ${warns} warning(s)`);
  if (errors) {
    console.log('  ❌ BLOCKED — fix the errors above before `eas submit`.');
  } else if (warns) {
    console.log('  ⚠️  Tier-1 passed WITH WARNINGS — review each, then do the');
    console.log('     Tier-2 iPad-simulator walk (non-Spanish language) before submit.');
  } else {
    console.log('  ✅ Tier-1 clean. Still do the Tier-2 iPad-simulator walk before submit.');
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
  return errors;
}

(async () => {
  checkTsc();
  checkPermissionLocalization();
  checkScreenLayout();
  checkVersioning();
  await checkPrivacyUrl();
  checkSignInWithApple();
  checkEncryptionDeclaration();
  const errors = printReport();
  process.exit(errors ? 1 : 0);
})();
