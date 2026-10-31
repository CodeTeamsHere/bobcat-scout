/* Two small jobs for the phone, both about the team's whole-event picture (assign-core.js has the rules):
 *
 *  1. The shift strip: the scouting lead publishes the rotation from Analytics; every few minutes (and when the
 *     phone gets signal) this asks the Sheet for THIS scout's own shifts and shows what to do next, such as
 *     "Scout Red 2 (team 254) in Q9, through Q12". The last answer is kept, so it still shows with no signal.
 *  2. The heartbeat: every few minutes it tells the Sheet it is alive, which app version it runs, and how much is
 *     waiting to send. No scouting data. The lead's board shows phones that are stuck or out of date.
 */
(function () {
  'use strict';
  if (!window.ASSIGN_CORE) return;
  var C = window.ASSIGN_CORE;
  var EVERY_MS = 5 * 60 * 1000;

  function $(sel) { return document.querySelector(sel); }
  function ls(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function eventKey() { return ls('event_key').toLowerCase(); }
  function sched() { try { return typeof scheduleCache !== 'undefined' ? scheduleCache : null; } catch (e) { return null; } }   // eslint-disable-line no-undef
  function connected() { try { return typeof isSheetConnected === 'function' && isSheetConnected() && !!sheetPasscode; } catch (e) { return false; } }   // eslint-disable-line no-undef
  function sessionMatches() { try { return JSON.parse(localStorage.getItem('session_matches') || '[]'); } catch (e) { return []; } }
  function cached() { try { return JSON.parse(localStorage.getItem('my_shifts_' + eventKey()) || '[]'); } catch (e) { return []; } }

  function auth(p) {
    p.passcode = sheetPasscode;   // eslint-disable-line no-undef
    try { if (typeof googleTokenValid === 'function' && googleTokenValid()) p.idToken = googleIdToken; } catch (e) {}   // eslint-disable-line no-undef
    return p;
  }

  /* ---------- the strip ---------- */
  function strip() {
    var el = $('#assign-strip');
    if (!el) {
      el = document.createElement('div'); el.id = 'assign-strip'; el.className = 'assign-strip hidden'; el.setAttribute('role', 'status');
      var main = $('main'); if (!main) return null;
      main.insertBefore(el, main.firstChild);
    }
    return el;
  }
  function render() {
    var el = strip(); if (!el) return;
    var shifts = cached(), next = C.nextShift(shifts, C.lastSent(sessionMatches(), eventKey())), text = C.stripText(next, sched());
    if (!text) { el.classList.add('hidden'); return; }
    el.className = 'assign-strip assign-' + next.state + (next.shift && next.shift.station === 'BREAK' ? ' assign-break' : '');
    el.innerHTML = '<span class="assign-ico">' + (next.shift && next.shift.station === 'BREAK' ? '&#9749;' : '&#128205;') + '</span><span class="assign-txt">' + text.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }) + '</span>' +
      '<button type="button" class="assign-all" aria-label="Show all my shifts" title="All my shifts">&#9776;</button>';
    var b = el.querySelector('.assign-all');
    if (b) b.addEventListener('click', function () { alert('Your shifts:\n\n' + C.summary(cached()).split(' · ').join('\n')); });
  }

  async function fetchShifts() {
    if (!connected() || !navigator.onLine || !eventKey()) return;
    try {
      var r = await jsonpSubmit(auth({ action: 'assignMine', eventKey: eventKey(), scoutName: ls('scout_name') }), 12000, sheetEndpoint);   // eslint-disable-line no-undef
      if (r && r.ok && Array.isArray(r.shifts)) { try { localStorage.setItem('my_shifts_' + eventKey(), JSON.stringify(r.shifts)); } catch (e) {} render(); }
    } catch (e) { /* no signal: the last answer stays */ }
  }

  /* ---------- the heartbeat ---------- */
  async function version() {
    try { var keys = await caches.keys(); var k = keys.filter(function (x) { return /^bobcat-scout-/.test(x); }).sort().pop(); return k || ''; } catch (e) { return ''; }
  }
  async function ping() {
    if (!connected() || !eventKey() || !ls('scout_name')) return;
    var waitingPit = 0;
    try { if (window.PIT_UI && window.PIT_UI._allItems) waitingPit = (await window.PIT_UI._allItems()).length; } catch (e) {}
    var waiting = 0; try { waiting = pendingQueue.length; } catch (e) {}   // eslint-disable-line no-undef
    try {
      await jsonpSubmit(auth({ action: 'ping', eventKey: eventKey(), scoutName: ls('scout_name'), appVersion: await version(), waiting: waiting, waitingPit: waitingPit,
        lastMatch: C.lastSent(sessionMatches(), eventKey()), online: navigator.onLine }), 12000, sheetEndpoint);   // eslint-disable-line no-undef
    } catch (e) { /* no signal: the Sheet will show this phone as quiet, which is the point */ }
  }

  function tick() { fetchShifts(); ping(); }
  function start() {
    render();
    setTimeout(tick, 4000);
    setInterval(tick, EVERY_MS);
    setInterval(render, 15000);   // a match was just saved: move on to the next shift without waiting for the Sheet
    window.addEventListener('online', function () { setTimeout(tick, 1500); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) render(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.ASSIGN_UI = { render: render, fetchShifts: fetchShifts, ping: ping };
})();
