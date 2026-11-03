/* Puts the scouting app on the web: https://bobcat-scout.krishmunukotiishere.workers.dev
 *
 *   node tools/deploy.js               test, then upload
 *   node tools/deploy.js --stage-only  test and fill dist/, without uploading (for  npx wrangler dev)
 *
 * Runs every test suite first and stops if any fails. Then copies only the page's own files
 * into dist/ (never the docs, tests, tools, Apps Script or reference files) and uploads that
 * folder with Wrangler, Cloudflare's command-line tool, which npx fetches by itself.
 *
 * The first time on a computer, sign Wrangler in to Cloudflare once:
 *   npx --yes wrangler@4 login        (a browser opens: click Allow)
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// Everything the page loads or the service worker pre-caches, plus the two header/robots files.
const SITE_FILES = ['index.html', 'styles.css', 'app.js', 'demo.js', 'demo.css', 'practice-data.js', 'trainer-core.js', 'trainer.js', 'trainer.css',
  'pit-form.js', 'pit-core.js', 'pit.js', 'pit.css', 'super-form.js', 'super-core.js', 'super.js', 'super.css', 'assign-core.js', 'assign.js', 'assign.css',
  'team-config.js', 'scout-modes.js', 'scout-lexicon.js', 'config.json', 'browser-check.js', 'service-worker.js', 'manifest.webmanifest',
  'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'assets/field-layout.jpg', 'vendor/qrcode-generator.js', '_headers', 'robots.txt'];
const TESTS = ['test-config', 'test-parser', 'test-modes', 'test-voice', 'test-trainer', 'test-pit', 'test-super', 'test-assign', 'test-apps-script'].map((t) => `node tools/${t}.js`);

function run(cmd) { execSync(cmd, { cwd: ROOT, stdio: 'inherit' }); }

// A file the page loads but this list forgets would be missing on the live site only.
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const used = [...html.matchAll(/(?:src|href)="([^"#?]+)"/g)].map((m) => m[1]).filter((u) => !/^[a-z]+:/i.test(u));
const sw = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
const cached = (sw.match(/const ASSETS = \[([\s\S]*?)\]/)[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1)).filter((f) => f !== '.');
const forgotten = used.concat(cached).filter((u) => !SITE_FILES.includes(u));
if (forgotten.length) {
  console.error(`The page or service worker loads ${[...new Set(forgotten)].join(', ')}, which tools/deploy.js would not upload. Add it to SITE_FILES.`);
  process.exit(1);
}
const absent = SITE_FILES.filter((f) => !fs.existsSync(path.join(ROOT, f)));
if (absent.length) { console.error(`Missing ${absent.join(', ')}.`); process.exit(1); }

TESTS.forEach(run);

fs.rmSync(DIST, { recursive: true, force: true });
for (const f of SITE_FILES) {
  fs.mkdirSync(path.dirname(path.join(DIST, f)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f));
}

if (process.argv.includes('--stage-only')) {
  console.log('dist/ is ready. Try it with:  npx --yes wrangler@4 dev');
} else {
  run('npx --yes wrangler@4 deploy');
}
