'use strict';
/* Checks for the shift-reminder push code (push-core.js) and the key maker (tools/make-push-keys.js).
 *
 *   node tools/test-push.js
 *
 * The big one is the worked example in RFC 8291 section 5: with the RFC's fixed keys and salt, our encrypt()
 * must produce exactly the RFC's bytes, and the RFC's receiver key must decrypt them. That proves the
 * encryption is the real standard, not just something that round-trips with itself.
 */
const P = require('../push-core.js');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let pass = 0; const fails = [];
function check(name, got, want) { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
function ok(name, cond, detail) { if (cond) pass++; else fails.push(`${name}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); }

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const hex = (b) => Buffer.from(b).toString('hex');

/** Opens an aes128gcm push body with the phone's private key (what a browser does). Returns the plaintext bytes. */
async function decrypt(body, uaPrivateKey, uaPublic, authSecret) {
  const salt = body.slice(0, 16), idlen = body[20], asPublic = body.slice(21, 21 + idlen), record = body.slice(21 + idlen);
  const asKey = await subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPrivateKey, 256));
  const hk = async (s, ikm, info, n) => new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const cat = (...a) => Buffer.concat(a.map((x) => Buffer.from(x)));
  const ikm = await hk(authSecret, shared, cat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hk(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hk(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), record));
  // strip the padding: zero bytes after the 0x02 delimiter, which is the last non-zero byte
  let end = plain.length - 1; while (end >= 0 && plain[end] === 0) end--;
  if (plain[end] !== 2) throw new Error('no padding delimiter');
  return plain.slice(0, end);
}

(async () => {
  // ---- RFC 8291 section 5 / appendix A, every value copied from the RFC text
  const RFC = {
    plaintext: 'When I grow up, I want to be a watermelon',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
    body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
          'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
          'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  };
  const sender = await P.ephemeralFromRaw(RFC.asPrivate, RFC.asPublic);
  const body = await P.encrypt({ uaPublic: P.b64uDecode(RFC.uaPublic), authSecret: P.b64uDecode(RFC.auth), plaintext: enc.encode(RFC.plaintext), salt: P.b64uDecode(RFC.salt), ephemeral: sender });
  check('RFC 8291 section 5: the encrypted body is exactly the RFC example', P.b64uEncode(body), RFC.body);
  check('RFC 8291: the header is 86 bytes (salt, record size 4096, key length 65, key)', hex(body.slice(0, 21)), hex(P.b64uDecode(RFC.salt)) + '00001000' + '41');
  check('RFC 8291: body length is 86 + 41 + 1 + 16 bytes', body.length, 86 + 42 + 16);
  // the RFC's receiver can read it
  const uaPair = await P.ephemeralFromRaw(RFC.uaPrivate, RFC.uaPublic);
  const back = await decrypt(body, uaPair.privateKey, P.b64uDecode(RFC.uaPublic), P.b64uDecode(RFC.auth));
  check('RFC 8291: the receiver key decrypts the RFC body back to the sentence', Buffer.from(back).toString(), RFC.plaintext);

  // ---- random salt / key: two messages differ, both decrypt
  const a = await P.encrypt({ uaPublic: P.b64uDecode(RFC.uaPublic), authSecret: P.b64uDecode(RFC.auth), plaintext: enc.encode('hi') });
  const b = await P.encrypt({ uaPublic: P.b64uDecode(RFC.uaPublic), authSecret: P.b64uDecode(RFC.auth), plaintext: enc.encode('hi') });
  ok('two encryptions of the same text differ (fresh salt and key)', P.b64uEncode(a) !== P.b64uEncode(b));
  check('a fresh-key message decrypts', Buffer.from(await decrypt(a, uaPair.privateKey, P.b64uDecode(RFC.uaPublic), P.b64uDecode(RFC.auth))).toString(), 'hi');
  let threw = '';
  try { await P.encrypt({ uaPublic: new Uint8Array(64), authSecret: new Uint8Array(16), plaintext: enc.encode('x') }); } catch (e) { threw = e.message; }
  ok('a bad subscription key is refused', /P-256/.test(threw), threw);
  threw = '';
  try { await P.encrypt({ uaPublic: P.b64uDecode(RFC.uaPublic), authSecret: new Uint8Array(15), plaintext: enc.encode('x') }); } catch (e) { threw = e.message; }
  ok('a bad auth secret is refused', /16 bytes/.test(threw), threw);

  // ---- VAPID JWT: structure and signature
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwkPriv = await subtle.exportKey('jwk', pair.privateKey);
  const pubRaw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const pubB64 = P.b64uEncode(pubRaw);
  const NOW = 1800000000;
  const jwt = await P.makeVapidJwt({ audience: 'https://fcm.googleapis.com', subject: 'mailto:team@example.org', privateKey: jwkPriv.d, publicKey: pubB64, now: NOW });
  const [h, c, s] = jwt.split('.');
  check('JWT has three parts', jwt.split('.').length, 3);
  check('JWT header', JSON.parse(Buffer.from(P.b64uDecode(h)).toString()), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(Buffer.from(P.b64uDecode(c)).toString());
  check('JWT claims: audience and subject', [claims.aud, claims.sub], ['https://fcm.googleapis.com', 'mailto:team@example.org']);
  ok('JWT expires within 12 hours', claims.exp > NOW && claims.exp - NOW <= 12 * 3600, claims.exp - NOW);
  check('JWT signature is 64 raw bytes (r||s)', P.b64uDecode(s).length, 64);
  ok('JWT signature verifies with the public key', await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, P.b64uDecode(s), enc.encode(h + '.' + c)));
  ok('a changed JWT claim fails verification', !(await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, P.b64uDecode(s), enc.encode(h + '.' + c + 'x'))));
  check('JWT has no padding or plus/slash characters', /[=+/]/.test(jwt), false);

  // ---- sendWebPush with a fake fetch
  const sent = [];
  const fakeFetch = async (url, init) => { sent.push({ url, init }); return new Response(null, { status: 201 }); };
  const r = await P.sendWebPush({ subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: RFC.uaPublic, auth: RFC.auth } }, payload: '{"title":"t"}', vapid: { subject: 'mailto:team@example.org', publicKey: pubB64, privateKey: jwkPriv.d }, fetch: fakeFetch, now: NOW });
  check('sendWebPush: ok result', [r.status, r.ok, r.gone], [201, true, false]);
  const hd = sent[0].init.headers;
  check('sendWebPush: headers', [hd['Content-Encoding'], hd.TTL, hd.Urgency, sent[0].init.method], ['aes128gcm', '600', 'high', 'POST']);
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(hd.Authorization);
  ok('sendWebPush: Authorization is "vapid t=<jwt>, k=<public key>"', m && m[2] === pubB64, hd.Authorization);
  ok('sendWebPush: the JWT in the header verifies', m && await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, P.b64uDecode(m[1].split('.')[2]), enc.encode(m[1].split('.').slice(0, 2).join('.'))));
  check('sendWebPush: audience is the push service origin', JSON.parse(Buffer.from(P.b64uDecode(m[1].split('.')[1])).toString()).aud, 'https://fcm.googleapis.com');
  check('sendWebPush: the body decrypts', Buffer.from(await decrypt(sent[0].init.body, uaPair.privateKey, P.b64uDecode(RFC.uaPublic), P.b64uDecode(RFC.auth))).toString(), '{"title":"t"}');
  const gone = await P.sendWebPush({ subscription: { endpoint: 'https://x.example/p', keys: { p256dh: RFC.uaPublic, auth: RFC.auth } }, payload: 'x', vapid: { subject: 'mailto:a@b.c', publicKey: pubB64, privateKey: jwkPriv.d }, fetch: async () => new Response('', { status: 410 }) });
  check('a 410 answer means gone', [gone.ok, gone.gone, gone.status], [false, true, 410]);

  // ---- the shift rules
  const S = (from, to, station) => ({ from, to, station });
  const shifts = [S(1, 4, 'R2'), S(5, 8, 'BREAK'), S(9, 12, 'B2'), S(13, 16, 'R1')];
  check('shiftKey', P.shiftKey(S(9, 12, 'B2')), '9-12-B2');
  check('a shift within the window is due', P.nextShiftToRemind(shifts, 7, 3, ''), S(9, 12, 'B2'));
  check('a shift beyond the window is not due yet', P.nextShiftToRemind(shifts, 5, 3, ''), null);
  check('exactly remindAhead matches away is due', P.nextShiftToRemind(shifts, 6, 3, '').from, 9);
  check('a shift that starts with the very next match is due', P.nextShiftToRemind(shifts, 9, 3, '').from, 9);
  check('a shift in progress is not reminded (the next one is too far)', P.nextShiftToRemind(shifts, 10, 2, ''), null);
  check('after it, the following shift is reminded when near', P.nextShiftToRemind(shifts, 11, 3, ''), S(13, 16, 'R1'));
  check('break shifts are skipped', P.nextShiftToRemind([S(5, 8, 'BREAK')], 4, 3, ''), null);
  check('a break does not hide the real shift after it', P.nextShiftToRemind([S(5, 8, 'BREAK'), S(9, 12, 'B2')], 5, 4, ''), S(9, 12, 'B2'));
  check('an already-reminded shift is skipped', P.nextShiftToRemind(shifts, 7, 3, '9-12-B2'), null);
  check('...but a different near shift is still reminded', P.nextShiftToRemind([S(9, 12, 'B2'), S(10, 12, 'R1')], 8, 3, '9-12-B2'), S(10, 12, 'R1'));
  check('unknown current match gives nothing', [P.nextShiftToRemind(shifts, null, 3, ''), P.nextShiftToRemind(shifts, 0, 3, ''), P.nextShiftToRemind(shifts, NaN, 3, ''), P.nextShiftToRemind(shifts, undefined, 3, '')], [null, null, null, null]);
  check('several due: the soonest wins (even if listed last)', P.nextShiftToRemind([S(12, 14, 'R3'), S(10, 11, 'B1'), S(11, 12, 'B3')], 9, 4, ''), S(10, 11, 'B1'));
  check('no shifts or junk gives nothing', [P.nextShiftToRemind([], 1, 3, ''), P.nextShiftToRemind(null, 1, 3, ''), P.nextShiftToRemind([null, { from: 3, to: 2, station: 'R1' }, { from: 3, to: 4, station: 'Z9' }], 2, 3, '')], [null, null, null]);
  check('reminder text', P.formatReminder(S(12, 15, 'R2')), { title: 'Scouting shift coming up', body: 'Your shift starts soon: Q12-15, Red 2', tag: 'shift-12-15-R2', url: '/' });
  check('one-match shift text', P.formatReminder(S(12, 12, 'B3')).body, 'Your shift starts soon: Q12, Blue 3');

  // ---- the service worker's push and notificationclick handlers, run in a fake worker scope
  {
    const handlers = {}, shown = [], opened = [], focused = [];
    let windows = [];
    const self_ = {
      addEventListener: (n, f) => { handlers[n] = f; },
      location: { origin: 'https://x.example' },
      registration: { showNotification: (title, opts) => { shown.push({ title, opts }); return Promise.resolve(); } },
      clients: { matchAll: () => Promise.resolve(windows), openWindow: (u) => { opened.push(u); return Promise.resolve(); }, claim: () => Promise.resolve() },
      skipWaiting: () => Promise.resolve(),
    };
    require('vm').runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8'), { self: self_, caches: {}, fetch: () => {}, Request: function () {}, URL, Promise, console });
    ok('the service worker listens for push and notificationclick', typeof handlers.push === 'function' && typeof handlers.notificationclick === 'function');
    const run = async (name, ev) => { let p; ev.waitUntil = (x) => { p = x; }; handlers[name](ev); await p; };
    await run('push', { data: { json: () => ({ title: 'Scouting shift coming up', body: 'Your shift starts soon: Q9-12, Red 2', tag: 'shift-9-12-R2', url: '/' }) } });
    check('a push becomes a notification with the tag, icon and text', [shown[0].title, shown[0].opts.body, shown[0].opts.tag, shown[0].opts.icon, shown[0].opts.data.url], ['Scouting shift coming up', 'Your shift starts soon: Q9-12, Red 2', 'shift-9-12-R2', 'icon-192.png', '/']);
    await run('push', { data: { json: () => { throw new Error('not json'); }, text: () => 'plain words' } });
    check('a push that is not JSON still shows its text', [shown[1].title, shown[1].opts.body], ['Bobcat Scout', 'plain words']);
    await run('push', { data: { json: () => ({ title: 't', url: 'https://evil.example/' }) } });
    check('a push cannot send the tap to another site', shown[2].opts.data.url, '/');
    let closed = 0;
    await run('notificationclick', { notification: { close: () => { closed++; }, data: { url: '/' } } });
    check('tapping with no app window open opens the app', [closed, opened], [1, ['/']]);
    windows = [{ focus: () => { focused.push(1); return Promise.resolve(); } }];
    await run('notificationclick', { notification: { close: () => {}, data: { url: '/' } } });
    check('tapping with the app open brings it to the front', [focused.length, opened.length], [1, 1]);
  }

  // ---- the key maker (dry run only: it never touches Wrangler here)
  const out = execFileSync(process.execPath, [path.join(__dirname, 'make-push-keys.js'), '--dry-run'], { encoding: 'utf8' });
  const tokens = out.match(/[A-Za-z0-9_-]{40,}/g) || [];
  const publicKeys = tokens.filter((t) => t.length === 87);
  check('make-push-keys prints exactly one public key (87 characters)', publicKeys.length, 1);
  ok('the printed public key is a P-256 point', P.b64uDecode(publicKeys[0]).length === 65 && P.b64uDecode(publicKeys[0])[0] === 4);
  ok('it prints nothing else that looks like a key (so never the private key)', tokens.length === 1, tokens);
  ok('it says it was a dry run and did not call wrangler', /DRY RUN/.test(out) && /secret put VAPID_PRIVATE/.test(out));
  const tmp = (/(\S+vapid-private-\S+)/.exec(out) || [])[1];
  ok('the temporary private key file is deleted afterwards', tmp && !fs.existsSync(tmp), tmp);

  if (fails.length) { console.log(`\n${pass} passed, ${fails.length} FAILED\n`); fails.forEach((f) => console.log('  x ' + f)); process.exit(1); }
  console.log(`\nAll ${pass} push checks passed.\n`);
})().catch((e) => { console.error(e); process.exit(1); });
