/* Super-scout screen: the 👁 SUPER button in the header.
 *
 * A super-scout watches a whole alliance (not one robot) and notes what numbers miss: who played defense, who
 * drives well, who is in trouble. Pick the match, and the six robots appear (from the loaded schedule, or type
 * the team numbers). Tap tags, give the driver a 1-5, add a few words, and send. One row per robot goes to the
 * Sheet's Super tab through the same send-and-wait queue the match rows use, so no signal loses nothing.
 * super-core.js has the rules; the tags are in super-form.js.
 */
(function () {
  'use strict';
  if (!window.SUPER_FORM || !window.SUPER_CORE) return;
  var F = window.SUPER_FORM, C = window.SUPER_CORE;
  var DRAFT = 'super_draft';
  var S = { overlay: null, match: '', entries: [], sent: '' };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ls(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function meta() { return { scoutName: ls('scout_name'), eventKey: ls('event_key').toLowerCase() }; }
  function schedule() { try { return typeof scheduleCache !== 'undefined' ? scheduleCache : null; } catch (e) { return null; } }   // eslint-disable-line no-undef

  function saveDraft() { try { localStorage.setItem(DRAFT, JSON.stringify({ match: S.match, entries: S.entries })); } catch (e) {} }
  function loadDraft() {
    try { var d = JSON.parse(localStorage.getItem(DRAFT) || 'null'); if (d && Array.isArray(d.entries)) { S.match = String(d.match || ''); S.entries = d.entries; } } catch (e) {}
  }
  function blank(team, alliance) { return { team: team || '', alliance: alliance || '', tags: [], rating: '', note: '' }; }
  function loadMatch(m) {
    S.match = String(m || '').trim();
    var bots = C.robotsFor(schedule(), S.match);
    if (bots.length) S.entries = bots.map(function (r) { return blank(r.team, r.alliance); });
    else S.entries = [blank('', 'red'), blank('', 'red'), blank('', 'red'), blank('', 'blue'), blank('', 'blue'), blank('', 'blue')];
    saveDraft();
  }

  /* ---------- sending: the same queue the match rows use (app.js: jsonpSubmit, enqueue) ---------- */
  function auth(p) {
    p.passcode = typeof sheetPasscode !== 'undefined' ? sheetPasscode : '';   // eslint-disable-line no-undef
    try { if (typeof googleTokenValid === 'function' && googleTokenValid()) p.idToken = googleIdToken; } catch (e) {}   // eslint-disable-line no-undef
    return p;
  }
  async function sendRows(rows) {
    var sent = 0, queued = 0, rejected = [];
    if (typeof isSheetConnected !== 'function' || !isSheetConnected()) return { sent: 0, queued: 0, rejected: [], notConnected: true };   // eslint-disable-line no-undef
    for (var i = 0; i < rows.length; i++) {
      var p = auth(Object.assign({}, rows[i]));
      if (!navigator.onLine) { enqueue(p, sheetEndpoint); queued++; continue; }   // eslint-disable-line no-undef
      try {
        var r = await jsonpSubmit(p, undefined, sheetEndpoint);   // eslint-disable-line no-undef
        if (r && r.ok) sent++; else rejected.push((r && r.error) || 'rejected');
      } catch (e) { enqueue(p, sheetEndpoint); queued++; }   // eslint-disable-line no-undef
    }
    return { sent: sent, queued: queued, rejected: rejected };
  }

  /* ---------- the screen ---------- */
  function open() {
    if (!S.overlay) {
      var o = document.createElement('div');
      o.id = 'super-overlay'; o.className = 'sup-overlay'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-label', 'Super-scout');
      o.innerHTML = '<div class="sup-card"><div class="sup-top"><div class="sup-title">SUPER-SCOUT</div><button type="button" class="sup-close" aria-label="Close super-scout">&times;</button></div><div id="sup-body" class="sup-body"></div></div>';
      document.body.appendChild(o); S.overlay = o;
      $('.sup-close', o).addEventListener('click', close);
      o.addEventListener('click', function (e) { if (e.target === o) close(); else onClick(e); });
      o.addEventListener('input', onInput);
    }
    if (!S.entries.length) { loadDraft(); }
    S.overlay.classList.add('sup-open'); document.body.classList.add('sup-lock');
    render();
  }
  function close() { if (S.overlay) { S.overlay.classList.remove('sup-open'); document.body.classList.remove('sup-lock'); } }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.overlay && S.overlay.classList.contains('sup-open')) close(); });

  function nextMatchGuess() {
    var d = ls('super_last_match'); var n = parseInt(d, 10);
    return isFinite(n) ? String(n + 1) : '';
  }

  function render() {
    var b = $('#sup-body'), m = meta(), h = '';
    h += '<p class="sup-lead">Watch a whole alliance and note what the numbers miss. One quick note per robot; skip the robots you didn\'t watch.</p>';
    if (!m.scoutName || !m.eventKey) h += '<div class="sup-note sup-warn">Finish <strong>SETUP</strong> first (your name and the event), then come back.</div>';
    if (S.sent) h += '<div class="sup-note sup-good">' + esc(S.sent) + '</div>';
    h += '<div class="sup-start"><label>Match number <input id="sup-match" type="number" inputmode="numeric" min="1" max="200" value="' + esc(S.match || nextMatchGuess()) + '" placeholder="e.g. 14"></label><button type="button" class="sup-btn sup-primary" data-sup="load">' + (S.entries.length ? 'RELOAD ROBOTS' : 'SHOW THE ROBOTS') + '</button></div>';
    if (S.entries.length && !C.robotsFor(schedule(), S.match).length) h += '<div class="sup-sub">The schedule isn\'t loaded for this match, so type each team number. (⚙ SHEET → LOAD MATCH SCHEDULE fills them in.)</div>';
    S.entries.forEach(function (e, i) {
      h += '<div class="sup-bot sup-' + (e.alliance || 'none') + '"><div class="sup-bot-h">' +
        (e.alliance ? '<span class="sup-ally">' + (e.alliance === 'blue' ? 'BLUE' : 'RED') + '</span>' : '') +
        '<input class="sup-team" type="number" inputmode="numeric" data-i="' + i + '" data-f="team" value="' + esc(e.team) + '" placeholder="team" aria-label="Team number"></div>';
      F.groups.forEach(function (g) {
        h += '<div class="sup-group"><span class="sup-gt">' + esc(g.title) + '</span>' + g.tags.map(function (t) {
          return '<button type="button" class="sup-chip' + (e.tags.indexOf(t) >= 0 ? ' on' : '') + '" data-sup="tag" data-i="' + i + '" data-t="' + esc(t) + '" aria-pressed="' + (e.tags.indexOf(t) >= 0) + '">' + esc(t) + '</button>';
        }).join('') + '</div>';
      });
      h += '<div class="sup-rate"><span class="sup-gt">' + esc(F.ratingLabel) + '</span>' + [1, 2, 3, 4, 5].map(function (n) {
        return '<button type="button" class="sup-star' + (String(e.rating) === String(n) ? ' on' : '') + '" data-sup="rate" data-i="' + i + '" data-n="' + n + '" aria-label="' + n + ' of 5">' + n + '</button>';
      }).join('') + '</div>';
      h += '<input class="sup-notebox" type="text" maxlength="' + F.maxNote + '" data-i="' + i + '" data-f="note" value="' + esc(e.note) + '" placeholder="a few words (optional)"></div>';
    });
    if (S.entries.length) h += '<div id="sup-problems"></div><div class="sup-actions"><button type="button" class="sup-btn sup-primary" data-sup="send">SEND NOTES</button><button type="button" class="sup-btn" data-sup="clear">CLEAR</button></div>';
    b.innerHTML = h;
  }

  function onInput(e) {
    var t = e.target, i = t.getAttribute && t.getAttribute('data-i'), f = t.getAttribute && t.getAttribute('data-f');
    if (i != null && f && S.entries[i]) { S.entries[i][f] = t.value; saveDraft(); }
  }
  async function onClick(e) {
    var btn = e.target.closest('[data-sup]'); if (!btn) return;
    var a = btn.getAttribute('data-sup'), i = Number(btn.getAttribute('data-i')), en = S.entries[i];
    if (a === 'load') { var v = ($('#sup-match') || {}).value; if (!String(v || '').trim()) { ($('#sup-match') || {}).focus(); return; } S.sent = ''; loadMatch(v); render(); }
    else if (a === 'tag' && en) { var t = btn.getAttribute('data-t'), k = en.tags.indexOf(t); if (k >= 0) en.tags.splice(k, 1); else en.tags.push(t); saveDraft(); btn.classList.toggle('on', k < 0); btn.setAttribute('aria-pressed', String(k < 0)); }
    else if (a === 'rate' && en) { var n = btn.getAttribute('data-n'); en.rating = String(en.rating) === n ? '' : n; saveDraft(); btn.parentNode.querySelectorAll('.sup-star').forEach(function (x) { x.classList.toggle('on', String(en.rating) === x.getAttribute('data-n')); }); }
    else if (a === 'clear') { S.entries = []; S.match = ''; S.sent = ''; try { localStorage.removeItem(DRAFT); } catch (x) {} render(); }
    else if (a === 'send') {
      var m = meta(), problems = C.check(F, m, ($('#sup-match') || {}).value || S.match, S.entries);
      var box = $('#sup-problems');
      if (problems.length) { box.innerHTML = '<div class="sup-note sup-warn">' + problems.map(esc).join('<br>') + '</div>'; return; }
      var matchNo = String(($('#sup-match') || {}).value || S.match).trim();
      var rows = C.buildRows(F, m, matchNo, S.entries);
      box.innerHTML = '<div class="sup-note">Sending ' + rows.length + ' note' + (rows.length === 1 ? '' : 's') + '…</div>';
      var res = await sendRows(rows);
      if (res.notConnected) { box.innerHTML = '<div class="sup-note sup-warn">This phone isn\'t connected to the team Sheet yet. Open the scouting link your lead sent. Your notes are still here.</div>'; return; }
      if (res.rejected.length && !res.sent && !res.queued) { box.innerHTML = '<div class="sup-note sup-warn">The Sheet did not accept them: ' + esc(res.rejected[0]) + '. Your notes are still here.</div>'; return; }
      try { localStorage.setItem('super_last_match', matchNo); localStorage.removeItem(DRAFT); } catch (x) {}
      S.sent = 'Q' + matchNo + ': ' + res.sent + ' sent' + (res.queued ? ', ' + res.queued + ' waiting for signal (they go by themselves)' : '') + (res.rejected.length ? ', ' + res.rejected.length + ' refused: ' + res.rejected[0] : '') + '. Ready for the next match.';
      S.entries = []; S.match = ''; render();
    }
  }

  function addButton() {
    var host = $('.header-actions'); if (!host || $('#btn-super')) return;
    var btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'btn-super'; btn.className = 'btn-header-outline'; btn.title = 'Super-scout: watch a whole alliance and note defense, driving and trouble';
    btn.innerHTML = '&#128065; SUPER';
    btn.addEventListener('click', open);
    var before = $('#btn-pit') || $('#btn-practice') || $('#btn-demo') || $('#btn-setup'); if (before) host.insertBefore(btn, before); else host.appendChild(btn);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButton); else addButton();
  window.SUPER_UI = { open: open, close: close };
})();
