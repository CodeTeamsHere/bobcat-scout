/* Tests for the scouting site's server code (worker/index.js): serving and publishing the game pack.
 *
 *   node tools/test-worker.mjs
 *
 * A pack that is published replaces the form on every phone, so the gates matter: no password,
 * a wrong password, a pack that fails the checks, and the wrong method must never change what is live.
 */
import worker from '../worker/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundled = fs.readFileSync(path.join(here, '..', 'config.json'), 'utf8');
const test27 = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'pack-2027-test.json'), 'utf8'));

let pass = 0;
const failures = [];
const check = (name, ok, detail) => { if (ok) pass++; else failures.push(`${name}\n      ${detail}`); };

const GOOD = 'right-password';
let sheetCalls = 0;
globalThis.fetch = async (url) => {
  sheetCalls++;
  const data = JSON.parse(decodeURIComponent(String(url).split('?data=')[1]));
  return new Response(JSON.stringify(data.passcode === GOOD ? { ok: true, data: [] } : { ok: false, error: 'Wrong analytics password' }));
};
const kv = new Map();
const env = {
  SHEET_URL: 'https://script.google.com/macros/s/TEST/exec',
  PACK: {
    get: async (k, type) => { const v = kv.get(k); if (v === undefined) return null; return type === 'json' ? JSON.parse(v) : v; },
    put: async (k, v) => { kv.set(k, v); },
    delete: async (k) => { kv.delete(k); },
  },
  ASSETS: { fetch: async () => new Response(bundled, { headers: { 'Content-Type': 'application/json' } }) },
};
async function call(path_, body, method = 'POST') {
  const init = { method };
  if (method === 'POST') init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await worker.fetch(new Request('https://example.workers.dev' + path_, init), env);
  const text = await res.text();
  let j = null; try { j = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: res.status, json: j, text, headers: res.headers };
}

// ---- nothing published: the shipped pack is served, open to other sites
{
  const r = await call('/config.json', null, 'GET');
  check('serves the shipped pack when none is published', r.status === 200 && r.text === bundled, r.status);
  check('it can be read from the Analytics site (CORS) and is never stale', r.headers.get('access-control-allow-origin') === '*' && /no-cache/.test(r.headers.get('cache-control')), JSON.stringify([...r.headers]));
  const s = await call('/api/pack-status', null, 'GET');
  check('status: nothing published yet', s.json.custom === false && s.json.canGoBack === false, JSON.stringify(s.json));
}

// ---- the gates
{
  const pack = test27;
  let r = await call('/api/pack', { password: '', pack });
  check('publish: no password is refused', r.status === 401 && sheetCalls === 0, JSON.stringify(r.json));
  r = await call('/api/pack', { password: 'nope', pack });
  check('publish: a wrong password is refused', r.status === 401 && /wrong analytics password/i.test(r.json.sheetError), JSON.stringify(r.json));
  r = await call('/api/pack', null, 'GET');
  check('publish: GET is refused', r.status === 405, r.status);
  r = await call('/api/pack', 'not json');
  check('publish: a body that is not JSON is refused', r.status === 400, r.status);
  r = await call('/api/pack', { password: GOOD });
  check('publish: no pack is refused', r.status === 400, JSON.stringify(r.json));
  const broken = JSON.parse(JSON.stringify(pack)); delete broken.sections[0].fields[0].code;
  r = await call('/api/pack', { password: GOOD, pack: broken });
  check('publish: a pack with problems is refused, with the reasons', r.status === 400 && r.json.problems.length > 0, JSON.stringify(r.json));
  r = await call('/api/pack', { password: GOOD, pack: { ...pack, padding: 'x'.repeat(310 * 1024) } });
  check('publish: a huge pack is refused', r.status === 413, r.status);
  check('none of those changed what is live', !kv.has('pack'), [...kv.keys()].join());
  const cfg = await call('/config.json', null, 'GET');
  check('...so the shipped pack is still served', cfg.text === bundled);
}

// ---- publishing, going back
{
  let r = await call('/api/pack', { password: GOOD, pack: test27 });
  check('publish: a good pack with the right password goes live', r.status === 200 && r.json.ok && r.json.year === 2027, JSON.stringify(r.json));
  let cfg = await call('/config.json', null, 'GET');
  check('/config.json now serves the published pack', JSON.parse(cfg.text).game.year === 2027 && cfg.headers.get('access-control-allow-origin') === '*');
  const s = await call('/api/pack-status', null, 'GET');
  check('status: says which pack is live', s.json.custom === true && s.json.year === 2027 && s.json.name === 'Test Game', JSON.stringify(s.json));

  const second = JSON.parse(JSON.stringify(test27)); second.game.year = 2028; second.game.name = 'Second';
  second.game.tba.year = 2028;
  r = await call('/api/pack', { password: GOOD, pack: second });
  check('publishing again keeps the one before it', r.status === 200 && kv.has('previous') && JSON.parse(kv.get('previous')).game.year === 2027);
  const s2 = await call('/api/pack-status', null, 'GET');
  check('status: can go back', s2.json.canGoBack === true && s2.json.year === 2028);

  r = await call('/api/pack-reset', { password: 'nope', to: 'previous' });
  check('reset: a wrong password is refused', r.status === 401);
  r = await call('/api/pack-reset', { password: GOOD, to: 'sideways' });
  check('reset: an unknown target is refused', r.status === 400);
  r = await call('/api/pack-reset', { password: GOOD, to: 'previous' });
  cfg = await call('/config.json', null, 'GET');
  check('reset to previous: brings back the one before', r.status === 200 && JSON.parse(cfg.text).game.year === 2027);
  r = await call('/api/pack-reset', { password: GOOD, to: 'previous' });
  check('reset to previous: nothing left to go back to', r.status === 404);
  r = await call('/api/pack-reset', { password: GOOD, to: 'bundled' });
  cfg = await call('/config.json', null, 'GET');
  const s3 = await call('/api/pack-status', null, 'GET');
  check('reset to bundled: the shipped pack is back', r.status === 200 && cfg.text === bundled && s3.json.custom === false);
}

// ---- the rest
{
  const r = await call('/somewhere-else', null, 'GET');
  check('other paths are not found', r.status === 404);
  const before = sheetCalls;
  await call('/api/pack', { password: GOOD, pack: test27 });
  await call('/api/pack', { password: GOOD, pack: test27 });
  check('a confirmed password is remembered (one Sheet call for two publishes)', sheetCalls - before <= 1, sheetCalls - before);
}

if (failures.length) {
  console.log(`\n${pass} passed, ${failures.length} FAILED\n`);
  failures.forEach((f) => console.log('  x ' + f + '\n'));
  process.exit(1);
}
console.log(`\nAll ${pass} game-pack server checks passed.\n`);
