/* ==========================================================================
   The scouting app's server code: the game pack (config.json) and how a new one is published.
   --------------------------------------------------------------------------
   Everything else on the site is plain files (the assets folder). Four routes run here (plus the
   /api/push/* shift-reminder routes and the 2-minute reminder job, both in worker/push.js):

     GET  /config.json          the current game pack: the published one if there is one, else the
                                pack that shipped with the site. Open to everyone (scouts' phones
                                and the Analytics app read it).
     GET  /api/pack-status      which pack is live (name, year, when it was published, whether a
                                previous one can be brought back). Open.
     POST /api/pack             {password, pack}: check the pack, then publish it. Needs the
                                Analytics Password (the Sheet is asked, as Analytics does). The
                                pack that was live is kept so one tap can bring it back.
     POST /api/pack-reset       {password, to}: "previous" brings back the pack before the last
                                publish; "bundled" goes back to the pack that shipped with the site.

   A pack that fails pack-core.js's checks is refused with the reasons in plain words, so a bad
   draft can never replace a working form.
   ========================================================================== */
import packCore from '../pack-core.js';
import { pushRoute, runReminders } from './push.js';   // shift reminders on phones (see push.js)

const MAX_PACK_BYTES = 300 * 1024;
const PASSWORD_OK_MS = 30 * 60 * 1000;
const confirmed = new Map();   // password fingerprint -> time it was confirmed (per server instance)

const CORS = { 'Access-Control-Allow-Origin': '*' };
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  });
}

async function fingerprint(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('bobcat-scout-pack:' + text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Asks the Sheet. An event code that matches nothing keeps the answer tiny.
async function checkPassword(password, env) {
  const fp = await fingerprint(password);
  const at = confirmed.get(fp);
  if (at && Date.now() - at < PASSWORD_OK_MS) return { ok: true };
  if (!env.SHEET_URL) return { ok: false, unreachable: true };
  const payload = JSON.stringify({ action: 'read', passcode: password, eventKey: '__password_check__' });
  let reply;
  try {
    const r = await fetch(env.SHEET_URL + '?data=' + encodeURIComponent(payload), { redirect: 'follow' });
    reply = JSON.parse(await r.text());
  } catch (err) {
    return { ok: false, unreachable: true };
  }
  if (reply && reply.ok === true) { confirmed.set(fp, Date.now()); return { ok: true }; }
  return { ok: false, sheetError: String((reply && reply.error) || 'rejected') };
}

async function gate(body, env) {
  const password = String((body && body.password) || '');
  if (!password) return json({ error: 'Type the Analytics Password first.' }, 401);
  if (env.DEV_SKIP_PASSWORD === '1') return null;   // set only in .dev.vars, for testing on this computer
  const check = await checkPassword(password, env);
  if (check.unreachable) return json({ error: 'Could not reach the Sheet to check the Analytics Password. Try again.' }, 502);
  if (!check.ok) return json({ error: 'That is not the Analytics Password.', sheetError: check.sheetError }, 401);
  return null;
}

async function readBody(request) {
  try { return await request.json(); } catch (err) { return null; }
}

async function status(env) {
  const meta = env.PACK ? await env.PACK.get('meta', 'json') : null;
  const prev = env.PACK ? await env.PACK.get('previous') : null;
  return json({ custom: !!(meta && meta.live), name: meta && meta.name || null, year: meta && meta.year || null, savedAt: meta && meta.savedAt || null, canGoBack: !!prev });
}

async function publish(request, env) {
  if (request.method !== 'POST') return json({ error: 'Send the pack with POST.' }, 405);
  const body = await readBody(request);
  if (!body) return json({ error: 'The request was not JSON.' }, 400);
  const denied = await gate(body, env);
  if (denied) return denied;
  if (!env.PACK) return json({ error: 'Pack storage is not set up on this site.' }, 500);
  const pack = body.pack;
  const text = JSON.stringify(pack);
  if (!pack || typeof pack !== 'object') return json({ error: 'There was no pack.' }, 400);
  if (text.length > MAX_PACK_BYTES) return json({ error: 'That pack is too big.' }, 413);
  const check = packCore.validate(pack);
  if (check.errors.length) return json({ error: 'The pack has problems, so it was not published.', problems: check.errors, notes: check.warnings }, 400);

  const live = await env.PACK.get('pack');
  if (live) await env.PACK.put('previous', live);
  await env.PACK.put('pack', text);
  await env.PACK.put('meta', JSON.stringify({ live: true, name: pack.game.name, year: pack.game.year, savedAt: new Date().toISOString() }));
  return json({ ok: true, name: pack.game.name, year: pack.game.year, notes: check.warnings });
}

async function reset(request, env) {
  if (request.method !== 'POST') return json({ error: 'Send the request with POST.' }, 405);
  const body = await readBody(request);
  if (!body) return json({ error: 'The request was not JSON.' }, 400);
  const denied = await gate(body, env);
  if (denied) return denied;
  if (!env.PACK) return json({ error: 'Pack storage is not set up on this site.' }, 500);
  if (body.to === 'previous') {
    const prev = await env.PACK.get('previous');
    if (!prev) return json({ error: 'There is no earlier pack to bring back.' }, 404);
    const p = JSON.parse(prev);
    await env.PACK.put('pack', prev);
    await env.PACK.delete('previous');
    await env.PACK.put('meta', JSON.stringify({ live: true, name: p.game && p.game.name, year: p.game && p.game.year, savedAt: new Date().toISOString() }));
    return json({ ok: true, now: 'the pack from before the last publish' });
  }
  if (body.to === 'bundled') {
    await env.PACK.delete('pack');
    await env.PACK.delete('previous');
    await env.PACK.put('meta', JSON.stringify({ live: false, savedAt: new Date().toISOString() }));
    return json({ ok: true, now: 'the pack that shipped with the site' });
  }
  return json({ error: 'Say which pack to go back to: "previous" or "bundled".' }, 400);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // The new-game page lives on the Analytics site, so its POSTs to /api/* are cross-site: the browser
    // first asks (OPTIONS) whether that is allowed. Without this answer the publish fails with "Failed to fetch".
    if (request.method === 'OPTIONS' && url.pathname.indexOf('/api/') === 0) {
      return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
    }
    if (url.pathname === '/config.json') {
      const custom = env.PACK ? await env.PACK.get('pack') : null;
      if (custom) return new Response(custom, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', ...CORS } });
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      out.headers.set('Access-Control-Allow-Origin', '*');
      out.headers.set('Cache-Control', 'no-cache');
      return out;
    }
    if (url.pathname === '/api/pack-status') return status(env);
    if (url.pathname === '/api/pack') return publish(request, env);
    if (url.pathname === '/api/pack-reset') return reset(request, env);
    if (url.pathname.indexOf('/api/push/') === 0) {
      const answered = await pushRoute(request, env, url.pathname);
      if (answered) return answered;
    }
    return new Response('Not found', { status: 404 });
  },
  // Every 2 minutes (the cron in wrangler.jsonc): send any shift reminders that are due.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env).catch((err) => console.warn('push: reminder run failed: ' + (err && err.message))));
  },
};
