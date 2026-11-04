/* ==========================================================================
   Shift reminders on phones (the "Remind me before my shift" toggle). Called from worker/index.js.
   --------------------------------------------------------------------------
   Routes (all under /api/push/, open to other sites like /api/pack-status):
     GET  /api/push/status        { configured, publicKey }: the app shows the toggle only when configured.
     POST /api/push/subscribe     { eventKey, scoutName, subscription, shifts, leadMatches }: a phone asks for
                                  reminders (or re-sends its shifts after the rotation changed).
     POST /api/push/unsubscribe   { eventKey, endpoint }: the phone no longer wants them.

   Every 2 minutes (the cron in wrangler.jsonc) runReminders() asks The Blue Alliance which qualification match
   is up next, and sends a push to every phone whose next shift starts within REMIND_AHEAD matches and has not
   been reminded yet.

   There is no passcode check here (this server does not have the scouting passcode), so abuse is limited by
   what is accepted and kept instead:
     - only the fields below, with strict sizes; the endpoint must be https on a known push service
       (Google, Mozilla, Apple, Microsoft), so the server cannot be pointed at other places;
     - at most 100 phones per event and 40 events in total;
     - the ONLY text ever sent is push-core.js's fixed "Your shift starts soon: Q12-15, Red 2";
     - anything not refreshed for 30 days is dropped; a push service saying 404/410 drops it at once.

   Storage (KV namespace PUSH): one entry per event, "ev:<eventKey>" = { subs: { <hash of endpoint>: {...} } },
   and a short-lived "tba:<eventKey>" answer cache. Nothing is stored for events nobody subscribed to.
   If the secrets (VAPID_PRIVATE, TBA_KEY), the var VAPID_PUBLIC or the PUSH namespace are missing, everything
   here quietly does nothing.
   ========================================================================== */
import pushCore from '../push-core.js';

const MAX_BODY = 12 * 1024;
const MAX_PER_EVENT = 100;
const MAX_EVENTS = 40;
const MAX_SENDS_PER_RUN = 30;        // a Worker may only make so many outside requests per run; the rest go next run
const STALE_MS = 30 * 24 * 3600 * 1000;
const TBA_CACHE_MS = 90 * 1000;
const STATIONS = ['R1', 'R2', 'R3', 'B1', 'B2', 'B3', 'BREAK'];

// Push services whose addresses we are willing to send to.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];

const CORS = { 'Access-Control-Allow-Origin': '*' };
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS } });
}

export function isConfigured(env) {
  return !!(env.PUSH && env.VAPID_PUBLIC && env.VAPID_PRIVATE && env.TBA_KEY);
}

async function hashEndpoint(endpoint) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('bobcat-scout-push:' + endpoint));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function cleanEventKey(v) {
  const k = String(v || '').toLowerCase();
  return /^[a-z0-9]{3,24}$/.test(k) ? k : '';
}

// Checks and tidies a phone's request. Returns { error } or { clean }.
function checkEndpoint(sub) {
  const endpoint = sub && sub.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return 'The subscription address is missing or too long.';
  let u; try { u = new URL(endpoint); } catch (e) { return 'The subscription address is not a web address.'; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return 'The subscription address must be a plain https address.';
  if (!PUSH_HOSTS.some((re) => re.test(u.hostname))) return 'That is not a known push service.';
  return '';
}

function validateSubscribe(body) {
  if (!body || typeof body !== 'object') return { error: 'The request was not JSON.' };
  const eventKey = cleanEventKey(body.eventKey);
  if (!eventKey) return { error: 'The event code is missing or not valid.' };
  const sub = body.subscription;
  const bad = checkEndpoint(sub);
  if (bad) return { error: bad };
  const keys = sub.keys || {};
  try {
    const p = pushCore.b64uDecode(keys.p256dh), a = pushCore.b64uDecode(keys.auth);
    if (p.length !== 65 || p[0] !== 4 || a.length !== 16) throw new Error('size');
  } catch (e) { return { error: 'The subscription keys are not valid.' }; }
  const scoutName = String(body.scoutName == null ? '' : body.scoutName).replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
  if (scoutName.length > 40) return { error: 'The scout name is too long.' };
  const rawShifts = body.shifts;
  if (!Array.isArray(rawShifts) || rawShifts.length > 20) return { error: 'There must be at most 20 shifts.' };
  const shifts = [];
  for (const s of rawShifts) {
    const from = s && s.from, to = s && s.to;
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > 999 || !STATIONS.includes(s.station)) return { error: 'A shift is not valid.' };
    shifts.push({ from, to, station: s.station });
  }
  let lead = 0;
  if (body.leadMatches != null) {
    lead = Number(body.leadMatches);
    if (!Number.isInteger(lead) || lead < 1 || lead > 6) return { error: 'leadMatches must be a whole number from 1 to 6.' };
  }
  return { clean: { eventKey, endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth, name: scoutName, shifts, lead } };
}

async function readText(request) {
  try { return await request.text(); } catch (e) { return ''; }
}
async function readJson(request) {
  const text = await readText(request);
  if (text.length > MAX_BODY) return { tooBig: true };
  try { return { body: JSON.parse(text) }; } catch (e) { return { body: null }; }
}

async function subscribe(request, env) {
  if (request.method !== 'POST') return json({ error: 'Send the request with POST.' }, 405);
  if (!isConfigured(env)) return json({ error: 'Reminders are not switched on for this site.' }, 503);
  const parsed = await readJson(request);
  if (parsed.tooBig) return json({ error: 'That request is too big.' }, 413);
  const v = validateSubscribe(parsed.body);
  if (v.error) return json({ error: v.error }, 400);
  const c = v.clean, id = await hashEndpoint(c.endpoint), docKey = 'ev:' + c.eventKey;
  const doc = (await env.PUSH.get(docKey, 'json')) || { subs: {} };
  const existing = doc.subs[id];
  if (!existing) {
    if (Object.keys(doc.subs).length >= MAX_PER_EVENT) return json({ error: 'This event already has the most phones it can remind (' + MAX_PER_EVENT + ').' }, 429);
    if (!Object.keys(doc.subs).length) {   // a brand-new event
      const listed = await env.PUSH.list({ prefix: 'ev:' });
      if (listed.keys.length >= MAX_EVENTS) return json({ error: 'Too many events are using reminders.' }, 429);
    }
  }
  doc.subs[id] = { endpoint: c.endpoint, p256dh: c.p256dh, auth: c.auth, name: c.name, shifts: c.shifts, lead: c.lead || 0, last: existing ? existing.last || '' : '', upd: Date.now() };
  await env.PUSH.put(docKey, JSON.stringify(doc));
  return json({ ok: true });
}

async function unsubscribe(request, env) {
  if (request.method !== 'POST') return json({ error: 'Send the request with POST.' }, 405);
  if (!env.PUSH) return json({ ok: true });
  const parsed = await readJson(request);
  if (parsed.tooBig) return json({ error: 'That request is too big.' }, 413);
  const body = parsed.body;
  const eventKey = cleanEventKey(body && body.eventKey);
  if (!eventKey || typeof body.endpoint !== 'string' || body.endpoint.length > 1000) return json({ error: 'Say which event and which subscription.' }, 400);
  const docKey = 'ev:' + eventKey, id = await hashEndpoint(body.endpoint);
  const doc = await env.PUSH.get(docKey, 'json');
  if (doc && doc.subs && doc.subs[id]) {
    delete doc.subs[id];
    if (Object.keys(doc.subs).length) await env.PUSH.put(docKey, JSON.stringify(doc)); else await env.PUSH.delete(docKey);
  }
  return json({ ok: true });
}

/** Handles /api/push/*; returns null for other paths. */
export async function pushRoute(request, env, pathname) {
  if (pathname === '/api/push/status') {
    const on = isConfigured(env);
    return json({ configured: on, publicKey: on ? String(env.VAPID_PUBLIC) : '', remindAhead: Math.min(6, Math.max(1, parseInt(env.REMIND_AHEAD, 10) || 3)) });
  }
  if (pathname === '/api/push/subscribe') return subscribe(request, env);
  if (pathname === '/api/push/unsubscribe') return unsubscribe(request, env);
  return null;
}

// ---- the match number, from The Blue Alliance --------------------------------------------------
const tbaMemory = new Map();   // eventKey -> { at, current }

/** The qualification match that is up next: the highest one already played, plus 1. null = unknown. */
export function currentMatchFrom(matches) {
  if (!Array.isArray(matches)) return null;
  const quals = matches.filter((m) => m && m.comp_level === 'qm' && Number.isInteger(m.match_number));
  if (!quals.length) return null;
  let top = 0;
  for (const m of quals) {
    const a = m.alliances || {};
    const rs = a.red && a.red.score, bs = a.blue && a.blue.score;
    const played = !!(m.actual_time || m.post_result_time) || (typeof rs === 'number' && rs >= 0 && typeof bs === 'number' && bs >= 0);
    if (played && m.match_number > top) top = m.match_number;
  }
  return top + 1;
}

async function currentMatch(env, eventKey, now, fetchFn) {
  const hit = tbaMemory.get(eventKey);
  if (hit && now - hit.at < TBA_CACHE_MS) return hit.current;
  try {
    const cached = await env.PUSH.get('tba:' + eventKey, 'json');
    if (cached && now - cached.at < TBA_CACHE_MS) { tbaMemory.set(eventKey, cached); return cached.current; }
  } catch (e) { /* no cache: ask TBA */ }
  let current = null;
  try {
    const res = await fetchFn('https://www.thebluealliance.com/api/v3/event/' + eventKey + '/matches/simple', { headers: { 'X-TBA-Auth-Key': env.TBA_KEY, Accept: 'application/json' } });
    if (!res.ok) { console.warn('push: The Blue Alliance answered ' + res.status + ' for ' + eventKey); return null; }
    current = currentMatchFrom(await res.json());
  } catch (e) { console.warn('push: could not read The Blue Alliance for ' + eventKey); return null; }
  if (current == null) return null;
  const entry = { at: now, current };
  tbaMemory.set(eventKey, entry);
  try { await env.PUSH.put('tba:' + eventKey, JSON.stringify(entry), { expirationTtl: 90 }); } catch (e) { /* memory copy still works */ }
  return current;
}

// ---- the 2-minute job ---------------------------------------------------------------------------
let warnedOff = false;

export async function runReminders(env, opts = {}) {
  const out = { events: 0, sent: 0, removed: 0 };
  if (!isConfigured(env)) {
    if (!warnedOff) { warnedOff = true; console.log('push: reminders are off (a push setting is missing: PUSH namespace, VAPID_PUBLIC, VAPID_PRIVATE or TBA_KEY).'); }
    return out;
  }
  const now = opts.now || Date.now(), fetchFn = opts.fetch || fetch;
  const vapid = { subject: env.VAPID_SUBJECT || 'mailto:admin@example.org', publicKey: env.VAPID_PUBLIC, privateKey: env.VAPID_PRIVATE };
  const defaultAhead = Math.min(6, Math.max(1, parseInt(env.REMIND_AHEAD, 10) || 3));
  let budget = MAX_SENDS_PER_RUN;

  const names = [];
  let cursor;
  do {
    const page = await env.PUSH.list({ prefix: 'ev:', cursor });
    page.keys.forEach((k) => names.push(k.name));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  for (const docKey of names) {
    const eventKey = docKey.slice(3);
    const doc = await env.PUSH.get(docKey, 'json');
    if (!doc || !doc.subs) continue;
    out.events++;
    const removed = new Set(), reminded = {};
    for (const id of Object.keys(doc.subs)) if (now - (doc.subs[id].upd || 0) > STALE_MS) removed.add(id);
    const live = Object.keys(doc.subs).filter((id) => !removed.has(id));
    let current = null;
    if (live.length) current = await currentMatch(env, eventKey, now, fetchFn);
    if (current != null) {
      for (const id of live) {
        if (budget <= 0) break;
        const sub = doc.subs[id];
        const shift = pushCore.nextShiftToRemind(sub.shifts, current, Math.min(6, sub.lead || defaultAhead), sub.last);
        if (!shift) continue;
        budget--;
        let r;
        try {
          r = await pushCore.sendWebPush({ subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload: JSON.stringify(pushCore.formatReminder(shift)), vapid, fetch: fetchFn, now: Math.floor(now / 1000), ttl: 600 });
        } catch (e) { console.warn('push: a send failed (' + (e && e.message) + ')'); continue; }
        if (r.ok) { reminded[id] = { endpoint: sub.endpoint, key: pushCore.shiftKey(shift) }; out.sent++; }
        else if (r.gone) removed.add(id);
        else console.warn('push: push service answered ' + r.status);
      }
    }
    if (!removed.size && !Object.keys(reminded).length) continue;
    // Write back on top of the latest copy, so a phone that subscribed while we were sending is not lost.
    const fresh = (await env.PUSH.get(docKey, 'json')) || { subs: {} };
    removed.forEach((id) => { if (fresh.subs[id] && (!doc.subs[id] || fresh.subs[id].endpoint === doc.subs[id].endpoint)) { delete fresh.subs[id]; out.removed++; } });
    Object.keys(reminded).forEach((id) => { if (fresh.subs[id] && fresh.subs[id].endpoint === reminded[id].endpoint) fresh.subs[id].last = reminded[id].key; });
    if (Object.keys(fresh.subs).length) await env.PUSH.put(docKey, JSON.stringify(fresh)); else await env.PUSH.delete(docKey);
  }
  return out;
}

// For tests: forget the in-memory TBA answers and the "already said it is off" note.
export function _resetForTests() { tbaMemory.clear(); warnedOff = false; }
