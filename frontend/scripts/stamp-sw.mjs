// Post-export step: stamp dist/sw.js with a unique build version.
// A byte-changed sw.js makes every browser reinstall the worker on its next
// update check; the worker's activate handler then clears caches, claims
// clients and posts SW_UPDATED — which the app answers with one reload.
// Together with the APP_VERSION stamp in the HTML shell, this guarantees
// returning devices pick up every deploy without manual version bumps.
import fs from 'fs';

const path = new URL('../dist/sw.js', import.meta.url);
let src = fs.readFileSync(path, 'utf8');
const stamp = `3.2.0-${Date.now()}`;
src = src.replace(/const APP_VERSION = '[^']*';/, `const APP_VERSION = '${stamp}';`);
src = `// build ${stamp}\n` + src;
fs.writeFileSync(path, src);
console.log(`sw.js stamped: ${stamp}`);
