// Post-export step: stamp dist/sw.js with a unique build version.
// A byte-changed sw.js makes every browser reinstall the worker on its next
// update check; the worker's activate handler then clears caches, claims
// clients and posts SW_UPDATED — which the app answers with one reload.
// Together with the APP_VERSION stamp in the HTML shell, this guarantees
// returning devices pick up every deploy without manual version bumps.
import fs from 'fs';

// CRITICAL: reuse the HTML shell's APP_VERSION instead of minting a second
// Date.now(). Two different stamps in one deploy = two separate reload
// triggers per device per deploy (HTML version-check reload + SW_UPDATED
// reload) — the "site keeps reloading" bug. One stamp → one reconciled
// version → at most one reload per deploy.
const htmlPath = new URL('../dist/index.html', import.meta.url);
const html = fs.readFileSync(htmlPath, 'utf8');
const m = html.match(/var APP_VERSION = '([^']+)'/);
const stamp = m ? m[1] : `3.2.0-${Date.now()}`;
if (!m) console.warn('stamp-sw: APP_VERSION not found in dist/index.html — falling back to Date.now()');

const path = new URL('../dist/sw.js', import.meta.url);
let src = fs.readFileSync(path, 'utf8');
src = src.replace(/const APP_VERSION = '[^']*';/, `const APP_VERSION = '${stamp}';`);
src = `// build ${stamp}\n` + src;
fs.writeFileSync(path, src);
console.log(`sw.js stamped: ${stamp}`);
