/* node tools/test-cors.mjs
 *
 * The new-game page lives on the Analytics site but publishes to this site: two different web
 * addresses, so the browser applies its cross-site rules. A test that calls the server directly
 * cannot see those rules (that is how "Failed to fetch" got through once). This test plays the
 * browser: for each call the Analytics page makes, it does what a browser does (ask permission
 * first for anything but a plain GET/POST, then check the reply's headers) and fails if the
 * browser would have blocked it.
 */
import worker from '../worker/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bundled = fs.readFileSync(path.join(here, '..', 'config.json'), 'utf8');
const ANALYTICS = 'https://bobcat-scout-analytics.krishmunukotiishere.workers.dev';
const SITE = 'https://bobcat-scout.krishmunukotiishere.workers.dev';

let pass = 0; const failures = [];
const check = (name, ok, detail) => { if (ok) pass++; else failures.push(`${name}\n      ${detail}`); };

globalThis.fetch = async (url) => {
  const data = JSON.parse(decodeURIComponent(String(url).split('?data=')[1]));
  return new Response(JSON.stringify(data.passcode === 'good' ? { ok: true, data: [] } : { ok: false, error: 'Wrong analytics password' }));
};
const kv = new Map();
const env = {
  SHEET_URL: 'https://script.google.com/macros/s/TEST/exec',
  PACK: { get: async (k, t) => { const v = kv.get(k); return v === undefined ? null : (t === 'json' ? JSON.parse(v) : v); }, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } },
  ASSETS: { fetch: async () => new Response(bundled, { headers: { 'Content-Type': 'application/json' } }) },
  // shift reminders: a fake store and fake keys, so the /api/push/* answers are the real, configured ones
  PUSH: { get: async (k, t) => { const v = kv.get('push:' + k); return v === undefined ? null : (t === 'json' ? JSON.parse(v) : v); }, put: async (k, v) => { kv.set('push:' + k, v); }, delete: async (k) => { kv.delete('push:' + k); }, list: async () => ({ keys: [], list_complete: true }) },
  VAPID_PUBLIC: 'BFAKEPUBLICKEY', VAPID_PRIVATE: 'fake', TBA_KEY: 'fake',
};
const phoneKey = globalThis.crypto.getRandomValues(new Uint8Array(65)); phoneKey[0] = 4;
const b64u = (u8) => Buffer.from(u8).toString('base64url');
const pushSub = { eventKey: '2026ctwat', scoutName: 'Pat', subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/cors-test', keys: { p256dh: b64u(phoneKey), auth: b64u(globalThis.crypto.getRandomValues(new Uint8Array(16))) } }, shifts: [{ from: 9, to: 12, station: 'R2' }], leadMatches: 3 };

// What a browser does for a request made from `origin` to another site, following the Fetch standard's
// CORS rules closely enough for this: simple requests go straight out; anything else asks first.
async function browserFetch(origin, target, urlPath, init = {}) {
  const method = (init.method || 'GET').toUpperCase();
  const headers = init.headers || {};
  const ct = String(headers['Content-Type'] || headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const simple = ['GET', 'HEAD', 'POST'].includes(method) && Object.keys(headers).every((h) => h.toLowerCase() === 'content-type') &&
    (!ct || ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'].includes(ct));
  const url = SITE + urlPath;
  if (!simple) {
    const pre = await target.fetch(new Request(url, { method: 'OPTIONS', headers: {
      Origin: origin, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': Object.keys(headers).map((h) => h.toLowerCase()).join(',') } }), env);
    const allowOrigin = pre.headers.get('access-control-allow-origin');
    const methods = String(pre.headers.get('access-control-allow-methods') || '').toUpperCase().split(/\s*,\s*/);
    const allowedHeaders = String(pre.headers.get('access-control-allow-headers') || '').toLowerCase().split(/\s*,\s*/);
    const okStatus = pre.status >= 200 && pre.status < 300;
    const need = Object.keys(headers).map((h) => h.toLowerCase());
    if (!okStatus || !(allowOrigin === '*' || allowOrigin === origin) || !methods.includes(method) || !need.every((h) => allowedHeaders.includes(h))) {
      return { blocked: 'the permission check failed (status ' + pre.status + ', allow-origin ' + allowOrigin + ', methods ' + methods + ', headers ' + allowedHeaders + ')' };
    }
  }
  const res = await target.fetch(new Request(url, { method, headers: { ...headers, Origin: origin }, body: init.body }), env);
  const allowOrigin = res.headers.get('access-control-allow-origin');
  if (!(allowOrigin === '*' || allowOrigin === origin)) return { blocked: 'the reply has no Access-Control-Allow-Origin header' };
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: res.status, json, text };
}

// ---- the harness itself must be able to fail (a stand-in that behaves like the old server)
{
  const old = { fetch: async (req) => new Response('{}', { status: req.method === 'OPTIONS' ? 405 : 200, headers: { 'Access-Control-Allow-Origin': '*' } }) };
  const r = await browserFetch(ANALYTICS, old, '/api/pack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('the harness blocks a JSON POST when the server does not answer the permission check', !!r.blocked, JSON.stringify(r));
  const noHeader = { fetch: async () => new Response('{}', { status: 200 }) };
  const g = await browserFetch(ANALYTICS, noHeader, '/config.json');
  check('the harness blocks a reply with no cross-site header', !!g.blocked, JSON.stringify(g));
}

// ---- every call the new-game page and the Analytics app make to this site
{
  const J = { 'Content-Type': 'application/json' };
  const pack = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'pack-2027-test.json'), 'utf8'));
  const calls = [
    ['Analytics reads the pack', '/config.json', { method: 'GET' }, (r) => r.status === 200 && JSON.parse(r.text).sections],
    ['the page reads what is live', '/api/pack-status', { method: 'GET' }, (r) => r.status === 200 && r.json && 'custom' in r.json],
    ['the page publishes', '/api/pack', { method: 'POST', headers: J, body: JSON.stringify({ password: 'good', pack }) }, (r) => r.status === 200 && r.json.ok],
    ['the page brings back the previous pack', '/api/pack-reset', { method: 'POST', headers: J, body: JSON.stringify({ password: 'good', to: 'previous' }) }, (r) => r.status === 404 || r.status === 200],
    ['the page goes back to the built-in pack', '/api/pack-reset', { method: 'POST', headers: J, body: JSON.stringify({ password: 'good', to: 'bundled' }) }, (r) => r.status === 200 && r.json.ok],
    ['the app asks whether reminders are available', '/api/push/status', { method: 'GET' }, (r) => r.status === 200 && r.json && r.json.configured === true],
    ['a phone asks for shift reminders', '/api/push/subscribe', { method: 'POST', headers: J, body: JSON.stringify(pushSub) }, (r) => r.status === 200 && r.json.ok],
    ['a refused reminder request is a readable answer too', '/api/push/subscribe', { method: 'POST', headers: J, body: JSON.stringify({ ...pushSub, eventKey: '' }) }, (r) => r.status === 400 && r.json && r.json.error],
    ['a phone turns shift reminders off', '/api/push/unsubscribe', { method: 'POST', headers: J, body: JSON.stringify({ eventKey: pushSub.eventKey, endpoint: pushSub.subscription.endpoint }) }, (r) => r.status === 200 && r.json.ok],
    ['a wrong password is still a readable answer, not a blocked one', '/api/pack', { method: 'POST', headers: J, body: JSON.stringify({ password: 'nope', pack }) }, (r) => r.status === 401 && r.json],
  ];
  for (const [name, p, init, good] of calls) {
    const r = await browserFetch(ANALYTICS, worker, p, init);
    check('browser allows: ' + name, !r.blocked && good(r), JSON.stringify(r).slice(0, 300));
  }
}

if (failures.length) {
  console.log(`\n${pass} passed, ${failures.length} FAILED\n`);
  failures.forEach((f) => console.log('  x ' + f + '\n'));
  process.exit(1);
}
console.log(`\nAll ${pass} cross-site (browser rules) checks passed.\n`);
