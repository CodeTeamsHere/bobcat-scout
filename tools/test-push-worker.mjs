/* Tests for the shift-reminder part of the server (worker/push.js, wired in worker/index.js).
 *
 *   node tools/test-push-worker.mjs
 *
 * Everything is fake: a fake KV, a fake fetch that stands in for The Blue Alliance and for the push services
 * (and records what was sent), and freshly made test keys. No real secret, no network.
 * The push body is decrypted again with the "phone's" private key, so what the phone would read is what is checked.
 */
import worker from '../worker/index.js';
import { runReminders, currentMatchFrom, _resetForTests } from '../worker/push.js';
import P from '../push-core.js';

let pass = 0;
const failures = [];
const check = (name, ok, detail) => { if (ok) pass++; else failures.push(`${name}\n      ${detail === undefined ? '' : (typeof detail === 'string' ? detail : JSON.stringify(detail))}`); };
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

// ---- test keys: the site's VAPID pair, and one "phone"
const vapidPair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const VAPID_PUBLIC = P.b64uEncode(new Uint8Array(await subtle.exportKey('raw', vapidPair.publicKey)));
const VAPID_PRIVATE = (await subtle.exportKey('jwk', vapidPair.privateKey)).d;
async function newPhone() {
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicRaw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return { privateKey: pair.privateKey, publicRaw, auth, p256dh: P.b64uEncode(publicRaw), authB64: P.b64uEncode(auth) };
}
async function decrypt(body, phone) {
  const salt = body.slice(0, 16), idlen = body[20], asPublic = body.slice(21, 21 + idlen), record = body.slice(21 + idlen);
  const asKey = await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, phone.privateKey, 256));
  const hk = async (s, ikm, info, n) => new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const cat = (...a) => Buffer.concat(a.map((x) => Buffer.from(x)));
  const ikm = await hk(phone.auth, shared, cat(enc.encode('WebPush: info\0'), phone.publicRaw, asPublic), 32);
  const cek = await hk(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hk(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), record));
  return Buffer.from(plain.slice(0, plain.length - 1)).toString();   // one 0x02 delimiter, no extra padding from us
}

// ---- fakes
function fakeKV() {
  const m = new Map();
  return {
    m,
    get: async (k, t) => { const v = m.get(k); if (v === undefined) return null; return t === 'json' ? JSON.parse(v) : v; },
    put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix = '' } = {}) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}
const world = { tba: [], pushes: [], tbaReply: null, pushStatus: {} };
function matchesUpTo(n, level = 'qm') { return Array.from({ length: n }, (_, i) => ({ comp_level: level, match_number: i + 1, alliances: { red: { score: 50 }, blue: { score: 40 } }, actual_time: 1 })); }
async function fakeFetch(url, init) {
  url = String(url);
  if (url.includes('thebluealliance.com')) {
    world.tba.push({ url, key: init.headers['X-TBA-Auth-Key'] });
    const r = world.tbaReply;
    if (r === 'throw') throw new Error('network down');
    if (typeof r === 'number') return new Response('nope', { status: r });
    return new Response(JSON.stringify(r), { status: 200 });
  }
  world.pushes.push({ url, init });
  return new Response(null, { status: world.pushStatus[url] || 201 });
}
globalThis.fetch = fakeFetch;
function resetWorld() { world.tba.length = 0; world.pushes.length = 0; world.tbaReply = null; world.pushStatus = {}; _resetForTests(); }

function makeEnv(extra = {}) {
  return { PUSH: fakeKV(), VAPID_PUBLIC, VAPID_PRIVATE, TBA_KEY: 'fake-tba-key', VAPID_SUBJECT: 'mailto:team@example.org', REMIND_AHEAD: '3', ASSETS: { fetch: async () => new Response('{}') }, ...extra };
}
async function call(env, path_, body, method = 'POST') {
  const init = { method };
  if (method === 'POST') init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await worker.fetch(new Request('https://example.workers.dev' + path_, init), env);
  const text = await res.text();
  let j = null; try { j = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: res.status, json: j, text, headers: res.headers };
}

const BASE = Date.now();
let nextId = 0;
async function goodSub(phone, over = {}) {
  return { eventKey: '2026ctwat', scoutName: 'Pat', subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/test-' + (++nextId), keys: { p256dh: phone.p256dh, auth: phone.authB64 } }, shifts: [{ from: 9, to: 12, station: 'R2' }], leadMatches: 3, ...over };
}

const phone = await newPhone();

// ---- status
{
  let r = await call(makeEnv(), '/api/push/status', null, 'GET');
  check('status: configured with every setting present', r.status === 200 && r.json.configured === true && r.json.publicKey === VAPID_PUBLIC, r.text);
  check('status is open to other sites and never cached', r.headers.get('access-control-allow-origin') === '*' && /no-store/.test(r.headers.get('cache-control')));
  for (const missing of ['VAPID_PUBLIC', 'VAPID_PRIVATE', 'TBA_KEY', 'PUSH']) {
    const env = makeEnv(); delete env[missing];
    r = await call(env, '/api/push/status', null, 'GET');
    check('status: not configured without ' + missing, r.json.configured === false && r.json.publicKey === '', r.text);
  }
  r = await call(makeEnv(), '/api/push/nothing', null, 'GET');
  check('an unknown push route is a 404', r.status === 404);
}

// ---- cross-site permission check
{
  for (const p of ['/api/push/subscribe', '/api/push/unsubscribe', '/api/push/status']) {
    const res = await worker.fetch(new Request('https://example.workers.dev' + p, { method: 'OPTIONS', headers: { Origin: 'https://other.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } }), makeEnv());
    check('preflight for ' + p, res.status === 204 && res.headers.get('access-control-allow-origin') === '*' && /POST/.test(res.headers.get('access-control-allow-methods')) && /content-type/i.test(res.headers.get('access-control-allow-headers')), res.status);
  }
}

// ---- subscribe: validation
{
  const env = makeEnv();
  const bad = async (name, body, status = 400) => { const r = await call(env, '/api/push/subscribe', body); check('subscribe refuses ' + name, r.status === status && r.json && r.json.error, r.status + ' ' + r.text); };
  const ok1 = await goodSub(phone);
  await bad('text that is not JSON', 'nope');
  await bad('no event code', { ...ok1, eventKey: '' });
  await bad('an event code with symbols', { ...ok1, eventKey: '../x' });
  await bad('an http endpoint', { ...ok1, subscription: { ...ok1.subscription, endpoint: 'http://fcm.googleapis.com/fcm/send/x' } });
  await bad('an endpoint that is not a known push service', { ...ok1, subscription: { ...ok1.subscription, endpoint: 'https://evil.example/collect' } });
  await bad('an endpoint that only ends like a push service', { ...ok1, subscription: { ...ok1.subscription, endpoint: 'https://evilfcm.googleapis.com.evil.example/x' } });
  await bad('an endpoint with a login in it', { ...ok1, subscription: { ...ok1.subscription, endpoint: 'https://user:pw@fcm.googleapis.com/x' } });
  await bad('an endpoint that is far too long', { ...ok1, subscription: { ...ok1.subscription, endpoint: 'https://fcm.googleapis.com/' + 'a'.repeat(1100) } });
  await bad('keys of the wrong size', { ...ok1, subscription: { ...ok1.subscription, keys: { p256dh: 'AAAA', auth: phone.authB64 } } });
  await bad('an auth secret of the wrong size', { ...ok1, subscription: { ...ok1.subscription, keys: { p256dh: phone.p256dh, auth: 'AAAA' } } });
  await bad('a scout name over 40 characters', { ...ok1, scoutName: 'x'.repeat(41) });
  await bad('more than 20 shifts', { ...ok1, shifts: Array.from({ length: 21 }, (_, i) => ({ from: i + 1, to: i + 1, station: 'R1' })) });
  await bad('a shift with a made-up station', { ...ok1, shifts: [{ from: 1, to: 2, station: 'X9' }] });
  await bad('a shift that ends before it starts', { ...ok1, shifts: [{ from: 5, to: 2, station: 'R1' }] });
  await bad('shifts that are not a list', { ...ok1, shifts: 'all of them' });
  await bad('a lead of 0 matches', { ...ok1, leadMatches: 0 });
  await bad('a lead of 50 matches', { ...ok1, leadMatches: 50 });
  await bad('a request over 12 KB', { ...ok1, scoutName: 'ok', junk: 'x'.repeat(13000) }, 413);
  let r = await call(env, '/api/push/subscribe', null, 'GET');
  check('subscribe with GET is 405', r.status === 405);
  check('nothing was stored by all the refused requests', env.PUSH.m.size === 0, [...env.PUSH.m.keys()]);
  const noSecrets = makeEnv(); delete noSecrets.VAPID_PRIVATE;
  r = await call(noSecrets, '/api/push/subscribe', ok1);
  check('subscribe says reminders are off when a secret is missing', r.status === 503 && noSecrets.PUSH.m.size === 0, r.text);
}

// ---- subscribe: storing, updating, cap, unsubscribe
{
  const env = makeEnv();
  const body = await goodSub(phone);
  let r = await call(env, '/api/push/subscribe', { ...body, eventKey: '2026CTWAT' });
  check('a good subscription is accepted (event code is lower-cased)', r.status === 200 && r.json.ok === true, r.text);
  const doc = JSON.parse(env.PUSH.m.get('ev:2026ctwat'));
  const stored = Object.values(doc.subs)[0];
  check('only what is needed is stored', Object.keys(stored).sort().join() === 'auth,endpoint,last,lead,name,p256dh,shifts,upd' && stored.name === 'Pat' && stored.shifts.length === 1, stored);
  check('the key is a hash, not the endpoint', !Object.keys(doc.subs)[0].includes('fcm') && Object.keys(doc.subs)[0].length === 32);
  doc.subs[Object.keys(doc.subs)[0]].last = '9-12-R2'; env.PUSH.m.set('ev:2026ctwat', JSON.stringify(doc));
  r = await call(env, '/api/push/subscribe', { ...body, shifts: [{ from: 20, to: 24, station: 'B1' }] });
  const doc2 = JSON.parse(env.PUSH.m.get('ev:2026ctwat'));
  const s2 = Object.values(doc2.subs)[0];
  check('re-sending shifts replaces them without making a second entry, and keeps the "already reminded" note', Object.keys(doc2.subs).length === 1 && s2.shifts[0].from === 20 && s2.last === '9-12-R2', s2);
  r = await call(env, '/api/push/unsubscribe', { eventKey: '2026ctwat', endpoint: 'https://fcm.googleapis.com/fcm/send/someone-else' });
  check('unsubscribing an unknown phone is harmless', r.status === 200 && Object.keys(JSON.parse(env.PUSH.m.get('ev:2026ctwat')).subs).length === 1);
  r = await call(env, '/api/push/unsubscribe', { eventKey: '', endpoint: 'x' });
  check('unsubscribe needs an event and an address', r.status === 400);
  r = await call(env, '/api/push/unsubscribe', { eventKey: '2026ctwat', endpoint: body.subscription.endpoint });
  check('unsubscribing removes the phone, and the empty event entry', r.status === 200 && !env.PUSH.m.has('ev:2026ctwat'), [...env.PUSH.m.keys()]);
  r = await call(env, '/api/push/unsubscribe', null, 'GET');
  check('unsubscribe with GET is 405', r.status === 405);

  // the cap: 100 phones per event
  for (let i = 0; i < 100; i++) {
    r = await call(env, '/api/push/subscribe', await goodSub(phone, { eventKey: '2026capped' }));
    if (r.status !== 200) break;
  }
  check('100 phones fit in one event', Object.keys(JSON.parse(env.PUSH.m.get('ev:2026capped')).subs).length === 100, r.text);
  const extra = await goodSub(phone, { eventKey: '2026capped' });
  r = await call(env, '/api/push/subscribe', extra);
  check('the 101st phone is refused', r.status === 429, r.text);
  const first = Object.values(JSON.parse(env.PUSH.m.get('ev:2026capped')).subs)[0];
  r = await call(env, '/api/push/subscribe', await goodSub(phone, { eventKey: '2026capped', subscription: { endpoint: first.endpoint, keys: { p256dh: phone.p256dh, auth: phone.authB64 } } }));
  check('a phone already in a full event can still update its shifts', r.status === 200, r.text);
  // the cap on events
  const env2 = makeEnv();
  for (let i = 0; i < 40; i++) await call(env2, '/api/push/subscribe', await goodSub(phone, { eventKey: '2026e' + i }));
  r = await call(env2, '/api/push/subscribe', await goodSub(phone, { eventKey: '2026over' }));
  check('a 41st event is refused', r.status === 429, r.text);
}

// ---- the reminder job
{
  resetWorld();
  const env = makeEnv();
  const a = await goodSub(phone, { shifts: [{ from: 9, to: 12, station: 'R2' }] });
  const phoneB = await newPhone();
  const b = await goodSub(phoneB, { shifts: [{ from: 2, to: 3, station: 'B1' }, { from: 5, to: 8, station: 'BREAK' }, { from: 40, to: 44, station: 'R1' }] });
  await call(env, '/api/push/subscribe', a);
  await call(env, '/api/push/subscribe', b);
  world.tbaReply = matchesUpTo(6).concat(matchesUpTo(2, 'sf'));   // 6 quals played: match 7 is up next; playoffs ignored
  const T0 = BASE;
  let out = await runReminders(env, { now: T0 });
  check('the job asked The Blue Alliance once for two phones, with the key', world.tba.length === 1 && world.tba[0].key === 'fake-tba-key' && /\/event\/2026ctwat\/matches\/simple$/.test(world.tba[0].url), world.tba);
  check('one reminder went out (the shift 2 matches away); the break, the far shift and the shift already under way sent nothing', world.pushes.length === 1 && out.sent === 1, { n: world.pushes.length, out });
  const push = world.pushes[0];
  check('it went to that phone\'s own address', push.url === a.subscription.endpoint, push.url);
  const h = push.init.headers;
  check('headers: aes128gcm, TTL, high urgency, POST', h['Content-Encoding'] === 'aes128gcm' && Number(h.TTL) > 0 && h.Urgency === 'high' && push.init.method === 'POST', h);
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(h.Authorization);
  const [jh, jc, js] = m[1].split('.');
  const claims = JSON.parse(Buffer.from(P.b64uDecode(jc)).toString());
  check('VAPID: key is our public key; audience is the push service; subject is the team mailto; expiry within 12 h', m[2] === VAPID_PUBLIC && claims.aud === 'https://fcm.googleapis.com' && claims.sub === 'mailto:team@example.org' && claims.exp - Math.floor(T0 / 1000) <= 12 * 3600 && claims.exp > Math.floor(T0 / 1000), claims);
  check('VAPID: the signature verifies with the public key', await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vapidPair.publicKey, P.b64uDecode(js), enc.encode(jh + '.' + jc)));
  const message = JSON.parse(await decrypt(push.init.body, phone));
  check('the phone decrypts the fixed-format reminder', message.title === 'Scouting shift coming up' && message.body === 'Your shift starts soon: Q9-12, Red 2' && message.tag === 'shift-9-12-R2' && message.url === '/', message);
  check('the reminder carries no scout name', !JSON.stringify(message).includes('Pat'));
  let wrongPhone = true; try { await decrypt(push.init.body, phoneB); } catch (e) { wrongPhone = false; }
  check('another phone cannot read it', !wrongPhone);

  out = await runReminders(env, { now: T0 + 120_000 });
  check('two minutes later: no repeat reminder for the same shift, and TBA asked again (cache is 90 s)', world.pushes.length === 1 && out.sent === 0 && world.tba.length === 2, { pushes: world.pushes.length, tba: world.tba.length });
  out = await runReminders(env, { now: T0 + 130_000 });
  check('inside 90 s the match number comes from the cache (no new TBA call)', world.tba.length === 2, world.tba.length);

  world.tbaReply = matchesUpTo(8);   // match 9 is up next and a's shift is now starting: already reminded, still silent
  await runReminders(env, { now: T0 + 400_000 });
  check('a shift that has started is not reminded again', world.pushes.length === 1, world.pushes.length);

  // the shift after: re-subscribe with a new shift, it is reminded once
  await call(env, '/api/push/subscribe', { ...a, shifts: [{ from: 9, to: 12, station: 'R2' }, { from: 13, to: 16, station: 'B3' }] });
  world.tbaReply = matchesUpTo(10);
  await runReminders(env, { now: T0 + 800_000 });
  await runReminders(env, { now: T0 + 1_000_000 });
  check('the next shift gets exactly one reminder', world.pushes.length === 2 && JSON.parse(await decrypt(world.pushes[1].init.body, phone)).body === 'Your shift starts soon: Q13-16, Blue 3', world.pushes.length);
}

// ---- push service answers
{
  resetWorld();
  const env = makeEnv();
  const gone = await goodSub(phone, { shifts: [{ from: 3, to: 4, station: 'R1' }] });
  const flaky = await goodSub(phone, { shifts: [{ from: 3, to: 4, station: 'R3' }] });
  await call(env, '/api/push/subscribe', gone);
  await call(env, '/api/push/subscribe', flaky);
  world.tbaReply = matchesUpTo(1);
  world.pushStatus[gone.subscription.endpoint] = 410;
  world.pushStatus[flaky.subscription.endpoint] = 503;
  const out = await runReminders(env, { now: BASE });
  const subs = JSON.parse(env.PUSH.m.get('ev:2026ctwat')).subs;
  check('a 410 from the push service deletes that subscription', out.removed === 1 && Object.values(subs).length === 1 && Object.values(subs)[0].endpoint === flaky.subscription.endpoint, subs);
  check('a 503 keeps the subscription and does not mark the shift as reminded (it is retried)', Object.values(subs)[0].last === '', subs);
  world.pushStatus[flaky.subscription.endpoint] = 201;
  await runReminders(env, { now: (BASE + 2_00_000) });
  check('the retry succeeds and marks it', JSON.parse(env.PUSH.m.get('ev:2026ctwat')).subs && Object.values(JSON.parse(env.PUSH.m.get('ev:2026ctwat')).subs)[0].last === '3-4-R3');
  world.pushStatus[flaky.subscription.endpoint] = 404;
  const env2 = makeEnv();
  await call(env2, '/api/push/subscribe', flaky);
  world.pushes.length = 0; _resetForTests();
  await runReminders(env2, { now: BASE });
  check('a 404 deletes the last subscription and the whole event entry', !env2.PUSH.m.has('ev:2026ctwat'), [...env2.PUSH.m.keys()]);
}

// ---- things that must not crash or send
{
  resetWorld();
  const env = makeEnv();
  await call(env, '/api/push/subscribe', await goodSub(phone, { shifts: [{ from: 3, to: 4, station: 'R1' }] }));
  world.tbaReply = 500;
  let out = await runReminders(env, { now: BASE });
  check('TBA answering 500: no crash, no sends, nothing cached', out.sent === 0 && world.pushes.length === 0 && ![...env.PUSH.m.keys()].some((k) => k.startsWith('tba:')), out);
  world.tbaReply = 'throw';
  out = await runReminders(env, { now: (BASE + 2_00_000) });
  check('TBA unreachable: no crash, no sends', out.sent === 0 && world.pushes.length === 0, out);
  world.tbaReply = { not: 'a list' };
  out = await runReminders(env, { now: (BASE + 4_00_000) });
  check('TBA sending junk: no crash, no sends', out.sent === 0 && world.pushes.length === 0, out);
  world.tbaReply = [];
  out = await runReminders(env, { now: (BASE + 6_00_000) });
  check('no schedule posted yet: no sends', out.sent === 0 && world.pushes.length === 0, out);

  for (const missing of ['VAPID_PRIVATE', 'VAPID_PUBLIC', 'TBA_KEY', 'PUSH']) {
    resetWorld();
    const e2 = makeEnv(); await call(e2, '/api/push/subscribe', await goodSub(phone, { shifts: [{ from: 3, to: 4, station: 'R1' }] }));
    delete e2[missing];
    world.tbaReply = matchesUpTo(1);
    const r = await runReminders(e2, { now: BASE });
    check('without ' + missing + ' the job does nothing at all (no TBA call, no push)', r.sent === 0 && world.tba.length === 0 && world.pushes.length === 0, { r, tba: world.tba.length });
  }

  // an old subscription nobody refreshed for a month is dropped
  resetWorld();
  const e3 = makeEnv();
  await call(e3, '/api/push/subscribe', await goodSub(phone));
  world.tbaReply = matchesUpTo(1);
  await runReminders(e3, { now: Date.now() + 31 * 24 * 3600 * 1000 });
  check('a subscription not refreshed for 30 days is dropped', !e3.PUSH.m.has('ev:2026ctwat') && world.tba.length === 0, [...e3.PUSH.m.keys()]);

  // a send budget: more phones due than one run may serve; the rest go next run
  resetWorld();
  const e4 = makeEnv();
  for (let i = 0; i < 35; i++) await call(e4, '/api/push/subscribe', await goodSub(phone, { shifts: [{ from: 3, to: 4, station: 'R1' }] }));
  world.tbaReply = matchesUpTo(1);
  await runReminders(e4, { now: BASE });
  check('one run sends at most 30', world.pushes.length === 30, world.pushes.length);
  await runReminders(e4, { now: (BASE + 2_00_000) });
  check('the next run sends the rest, and nobody twice', world.pushes.length === 35 && new Set(world.pushes.map((p) => p.url)).size === 35, world.pushes.length);
}

// ---- the real scheduled() entry point
{
  resetWorld();
  const env = makeEnv();
  await call(env, '/api/push/subscribe', await goodSub(phone, { shifts: [{ from: 2, to: 3, station: 'B2' }] }));
  world.tbaReply = matchesUpTo(1);
  const waiting = [];
  await worker.scheduled({ cron: '*/2 * * * *' }, env, { waitUntil: (p) => waiting.push(p) });
  await Promise.all(waiting);
  check('worker.scheduled sends the due reminder', world.pushes.length === 1, world.pushes.length);
  resetWorld();
  const e5 = makeEnv(); delete e5.TBA_KEY;
  const w2 = [];
  await worker.scheduled({}, e5, { waitUntil: (p) => w2.push(p) });
  await Promise.all(w2);
  check('worker.scheduled with a missing secret does nothing and does not throw', world.pushes.length === 0 && world.tba.length === 0);
  const e6 = makeEnv(); e6.PUSH.list = async () => { throw new Error('kv down'); };
  const w3 = [];
  await worker.scheduled({}, e6, { waitUntil: (p) => w3.push(p) });
  let threw = false; try { await Promise.all(w3); } catch (e) { threw = true; }
  check('worker.scheduled swallows a storage failure', !threw);
}

// ---- reading the match number
{
  const q = (n, extra) => ({ comp_level: 'qm', match_number: n, alliances: { red: { score: -1 }, blue: { score: -1 } }, actual_time: null, post_result_time: null, ...extra });
  check('nothing played yet: match 1 is next', currentMatchFrom([q(1), q(2), q(3)]) === 1);
  check('a score counts as played', currentMatchFrom([q(1, { alliances: { red: { score: 10 }, blue: { score: 0 } } }), q(2), q(3)]) === 2);
  check('actual_time counts as played', currentMatchFrom([q(1, { actual_time: 5 }), q(2, { actual_time: 6 }), q(3)]) === 3);
  check('post_result_time counts as played', currentMatchFrom([q(1), q(2, { post_result_time: 5 })]) === 3);
  check('the highest played match wins even if the list is shuffled', currentMatchFrom([q(5, { actual_time: 1 }), q(2, { actual_time: 1 }), q(9)]) === 6);
  check('no qualification matches: unknown', currentMatchFrom([{ comp_level: 'sf', match_number: 1 }]) === null && currentMatchFrom([]) === null && currentMatchFrom(null) === null);
}

if (failures.length) {
  console.log(`\n${pass} passed, ${failures.length} FAILED\n`);
  failures.forEach((f) => console.log('  x ' + f + '\n'));
  process.exit(1);
}
console.log(`\nAll ${pass} reminder-server checks passed.\n`);
