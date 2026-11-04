/* ==========================================================================
   BOBCAT SCOUT: Web Push, written by hand (no packages), plus the "when is a reminder due" rules
   --------------------------------------------------------------------------
   Used by the server code (worker/index.js) and by the tests (tools/test-push.js). Not loaded by the page.
   Plain functions with WebCrypto only, so the same file runs in Cloudflare and in Node.

   What a push message needs, in order:
     1. VAPID (RFC 8292): a short signed note (a JWT, ES256) that says "this message comes from the owner of
        this public key". Sent as   Authorization: vapid t=<jwt>, k=<public key>
     2. Encryption (RFC 8291 + RFC 8188, "aes128gcm"): the phone's subscription holds a public key (p256dh) and
        a secret (auth). We make a throw-away key pair, agree a shared secret with the phone's key (ECDH),
        stretch it into an encryption key and nonce (HKDF), and encrypt the text with AES-128-GCM.
        The push service (Google, Apple, Mozilla) only ever sees scrambled bytes.
     3. A POST of those bytes to the subscription's address, with TTL and Urgency headers.

   Keys are passed around as base64url text. The VAPID private key is the 32-byte "d" value, base64url.

   Then the shift rules (nextShiftToRemind, formatReminder): pure functions over the scout's shifts
   ([{ from, to, station }] in qualification match numbers, station R1-R3, B1-B3 or BREAK) and the match
   number that is up next. tools/test-push.js tests all of it, including the RFC 8291 section 5 example.
   ========================================================================== */
(function (root) {
  'use strict';

  var enc = new TextEncoder();
  function subtle() { return globalThis.crypto.subtle; }

  // ---- bytes <-> base64url ------------------------------------------------------------------
  function b64uEncode(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64uDecode(text) {
    var t = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    var bin = atob(t), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function concat() {
    var parts = Array.prototype.slice.call(arguments), n = 0, i;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n), at = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], at); at += parts[i].length; }
    return out;
  }

  // ---- encryption (RFC 8291) ----------------------------------------------------------------
  async function hkdf(salt, ikm, info, length) {
    var key = await subtle().importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt, info: info }, key, length * 8));
  }

  /** A fresh sender key pair: { privateKey (CryptoKey), publicRaw (65 bytes) }. */
  async function newEphemeral() {
    var pair = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    return { privateKey: pair.privateKey, publicRaw: new Uint8Array(await subtle().exportKey('raw', pair.publicKey)) };
  }

  /** A key pair from its raw parts (base64url private "d" and 65-byte public), for the RFC test and for tests. */
  async function ephemeralFromRaw(dB64, publicB64) {
    var pub = b64uDecode(publicB64);
    var jwk = { kty: 'EC', crv: 'P-256', d: dB64, x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)), ext: true };
    return { privateKey: await subtle().importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']), publicRaw: pub };
  }

  /**
   * Encrypts `plaintext` (Uint8Array) for one subscription and returns the whole request body
   * (header + one encrypted record).
   *   o.uaPublic     the phone's p256dh, 65 bytes     o.authSecret   the phone's auth, 16 bytes
   *   o.salt         16 random bytes (tests inject it)   o.ephemeral   sender key pair (tests inject it)
   */
  async function encrypt(o) {
    var uaPublic = o.uaPublic, authSecret = o.authSecret, plaintext = o.plaintext;
    if (!uaPublic || uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('The subscription public key is not a P-256 point.');
    if (!authSecret || authSecret.length !== 16) throw new Error('The subscription auth secret is not 16 bytes.');
    if (plaintext.length > 3993) throw new Error('The message is too long for one push record.');
    var salt = o.salt || globalThis.crypto.getRandomValues(new Uint8Array(16));
    var eph = o.ephemeral || await newEphemeral();
    var uaKey = await subtle().importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    var shared = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
    var keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, eph.publicRaw);
    var ikm = await hkdf(authSecret, shared, keyInfo, 32);
    var cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    var nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
    var aes = await subtle().importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
    var record = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));   // 0x02 = last record
    var header = concat(salt, new Uint8Array([0, 0, 0x10, 0]), new Uint8Array([eph.publicRaw.length]), eph.publicRaw);   // record size 4096
    return concat(header, record);
  }

  // ---- VAPID (RFC 8292) ---------------------------------------------------------------------
  async function vapidKey(privateD, publicKey) {
    var pub = b64uDecode(publicKey);
    var jwk = { kty: 'EC', crv: 'P-256', d: privateD, x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)), ext: true };
    return subtle().importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }

  /** The signed JWT: header {typ:JWT, alg:ES256}, claims {aud, exp, sub}. exp is at most 12 hours away (we use 11). */
  async function makeVapidJwt(o) {
    var now = o.now || Math.floor(Date.now() / 1000);
    var head = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    var claims = b64uEncode(enc.encode(JSON.stringify({ aud: o.audience, exp: now + (o.ttlSeconds || 11 * 3600), sub: o.subject })));
    var key = await vapidKey(o.privateKey, o.publicKey);
    // WebCrypto's ECDSA answer is already the 64-byte r||s form that JWT wants.
    var sig = new Uint8Array(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + claims)));
    return head + '.' + claims + '.' + b64uEncode(sig);
  }

  /** Encrypts and POSTs one message. Answer: { status, ok, gone } ("gone" = the phone unsubscribed: delete it). */
  async function sendWebPush(o) {
    var sub = o.subscription, endpoint = sub.endpoint, u = new URL(endpoint);
    var body = await encrypt({ uaPublic: b64uDecode(sub.keys.p256dh), authSecret: b64uDecode(sub.keys.auth), plaintext: enc.encode(o.payload), salt: o.salt, ephemeral: o.ephemeral });
    var jwt = await makeVapidJwt({ audience: u.origin, subject: o.vapid.subject, privateKey: o.vapid.privateKey, publicKey: o.vapid.publicKey, now: o.now });
    var res = await (o.fetch || fetch)(endpoint, {
      method: 'POST',
      headers: {
        Authorization: 'vapid t=' + jwt + ', k=' + o.vapid.publicKey,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(o.ttl || 600),
        Urgency: 'high',
      },
      body: body,
    });
    try { if (res.body && res.body.cancel) await res.body.cancel(); } catch (e) { /* nothing to read */ }
    return { status: res.status, ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410 };
  }

  // ---- when is a reminder due ---------------------------------------------------------------
  var NAMES = { R1: 'Red 1', R2: 'Red 2', R3: 'Red 3', B1: 'Blue 1', B2: 'Blue 2', B3: 'Blue 3' };

  /** A shift's identity, kept to remember "already reminded for this one". */
  function shiftKey(s) { return s.from + '-' + s.to + '-' + s.station; }

  /**
   * The shift to remind about now, or null.
   *   currentMatch   the qualification match number that is up next (the highest one already played, plus 1).
   *                  Unknown (null/0/NaN) means no reminder at all.
   *   remindAhead    how many matches before the shift to start reminding (3 = from three matches ahead).
   *   lastRemindedKey  shiftKey() of the shift this scout was last reminded about.
   * A shift is due when it has not started yet (from >= currentMatch, so a shift that starts with the very next
   * match still counts, but one already under way never does), starts within remindAhead matches, is not a
   * break, and is not the one already reminded. If several are due, the soonest wins.
   */
  function nextShiftToRemind(shifts, currentMatch, remindAhead, lastRemindedKey) {
    var cur = Number(currentMatch);
    if (!(cur >= 1) || !isFinite(cur)) return null;
    var ahead = Number(remindAhead); if (!(ahead >= 1)) ahead = 3;
    var best = null;
    (Array.isArray(shifts) ? shifts : []).forEach(function (s) {
      if (!s || !NAMES[s.station]) return;   // breaks and junk get no reminder
      if (!(s.from >= 1) || !(s.to >= s.from)) return;
      if (s.from < cur || s.from - cur > ahead) return;
      if (lastRemindedKey && shiftKey(s) === lastRemindedKey) return;
      if (!best || s.from < best.from) best = s;
    });
    return best;
  }

  /** The only text a reminder ever carries: fixed wording plus the shift's own numbers. */
  function formatReminder(shift, stationNames) {
    var names = stationNames || NAMES;
    var range = 'Q' + shift.from + (shift.to > shift.from ? '-' + shift.to : '');
    return {
      title: 'Scouting shift coming up',
      body: 'Your shift starts soon: ' + range + ', ' + (names[shift.station] || shift.station),
      tag: 'shift-' + shiftKey(shift),
      url: '/',
    };
  }

  var API = {
    b64uEncode: b64uEncode, b64uDecode: b64uDecode, encrypt: encrypt, newEphemeral: newEphemeral, ephemeralFromRaw: ephemeralFromRaw,
    makeVapidJwt: makeVapidJwt, sendWebPush: sendWebPush, shiftKey: shiftKey, nextShiftToRemind: nextShiftToRemind, formatReminder: formatReminder, STATION_NAMES: NAMES,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.PUSH_CORE = API;
})(typeof window !== 'undefined' ? window : this);
