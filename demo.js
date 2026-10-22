/* Presenter demo: a guided walk through the whole app on the right-hand side.
 *
 * Click DEMO, then NEXT (or press the right arrow / space) and the demo fills in and clicks the real
 * page for you, with made-up data, while a panel on the right says what is happening and what to say.
 * Nothing is sent anywhere: requests to the team Sheet are blocked while the demo runs, and the
 * browser's saved settings are put back exactly as they were when you press EXIT.
 */
(function () {
  'use strict';

  var CFG = null;              // set by Demo.register(): { key, title, steps, seed, back }
  var S = { i: -1, busy: false, fast: false, on: false, ctx: {} };
  var KEY_ACTIVE = 'demo_active', KEY_STEP = 'demo_step', KEY_SNAP = 'demo_snapshot';

  /* ---------- small helpers ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, S.fast ? Math.min(ms, 40) : ms); }); }
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) {} return null; }
  function waitFor(test, ms) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function poll() { var v; try { v = test(); } catch (e) { v = null; } if (v) return resolve(v); if (Date.now() - t0 > (ms || 8000)) return resolve(null); setTimeout(poll, 80); })();
    });
  }
  function setValue(el, v) {
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : (el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype);
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function done(el) { el.dispatchEvent(new Event('change', { bubbles: true })); }
  function target(t) { return typeof t === 'function' ? t() : (typeof t === 'string' ? $(t) : t); }

  /* type text into a box, a few letters at a time, so the room can watch it fill in */
  function typeInto(t, text) {
    var el = target(t);
    if (!el) return Promise.resolve();
    el.focus && el.focus({ preventScroll: true });
    if (S.fast) { setValue(el, text); done(el); return Promise.resolve(); }
    return new Promise(function (resolve) {
      var n = 0, step = Math.max(2, Math.round(text.length / 70));
      (function tick() {
        n = Math.min(text.length, n + step);
        setValue(el, text.slice(0, n));
        if (n >= text.length) { done(el); return resolve(); }
        setTimeout(tick, 28);
      })();
    });
  }
  function click(t) { var el = target(t); if (el) el.click(); return !!el; }

  /* ---------- the ring that points at what the step is about ---------- */
  var ring = null, ringTarget = null, raf = 0;
  function pointAt(t) {
    ringTarget = t || null;
    if (!ring) { ring = document.createElement('div'); ring.id = 'demo-ring'; document.body.appendChild(ring); }
    if (!raf) (function loop() {
      raf = requestAnimationFrame(loop);
      var el = ringTarget ? target(ringTarget) : null;
      if (!el || !S.on) { ring.style.display = 'none'; return; }
      var r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) { ring.style.display = 'none'; return; }
      // a very tall target (a whole form) is outlined only as far as the screen shows it
      var top = Math.max(6, r.top - 6), bottom = Math.min(window.innerHeight - 6, r.bottom + 6);
      if (bottom - top < 8) { ring.style.display = 'none'; return; }
      ring.style.display = 'block';
      ring.style.left = (r.left - 6) + 'px'; ring.style.top = top + 'px';
      ring.style.width = (r.width + 12) + 'px'; ring.style.height = (bottom - top) + 'px';
    })();
    var el0 = ringTarget ? target(ringTarget) : null;
    if (el0 && el0.scrollIntoView) {
      var tall = el0.getBoundingClientRect().height > window.innerHeight * 0.7;
      el0.scrollIntoView({ behavior: S.fast ? 'auto' : 'smooth', block: tall ? 'start' : 'center' });
      if (tall) setTimeout(function () { window.scrollBy(0, -16); }, S.fast ? 0 : 450);
    }
  }

  /* ---------- the panel on the right ---------- */
  var panel = null;
  function buildPanel() {
    panel = document.createElement('aside');
    panel.id = 'demo-panel';
    panel.setAttribute('aria-label', 'Demo');
    panel.innerHTML =
      '<div class="dp-head"><span class="dp-tag">DEMO</span><span id="dp-count" class="dp-count"></span>' +
      '<button type="button" id="dp-exit" class="dp-exit" title="Leave the demo and put everything back">EXIT</button></div>' +
      '<div class="dp-bar"><i id="dp-progress"></i></div>' +
      '<div class="dp-body"><h2 id="dp-title" class="dp-title"></h2>' +
      '<p id="dp-what" class="dp-what"></p>' +
      '<div id="dp-say-wrap" class="dp-say"><b>SAY</b><p id="dp-say"></p></div>' +
      '<p id="dp-note" class="dp-note"></p></div>' +
      '<div class="dp-nav"><button type="button" id="dp-back" class="dp-btn dp-back">&larr; BACK</button>' +
      '<button type="button" id="dp-next" class="dp-btn dp-next">NEXT &rarr;</button></div>' +
      '<div class="dp-hint">Right arrow or space = next &middot; left arrow = back</div>';
    document.body.appendChild(panel);
    $('#dp-next').onclick = next; $('#dp-back').onclick = back; $('#dp-exit').onclick = exit;
  }
  function render() {
    var st = CFG.steps[S.i], n = CFG.steps.length;
    $('#dp-count').textContent = 'Step ' + (S.i + 1) + ' of ' + n;
    $('#dp-progress').style.width = Math.round(100 * (S.i + 1) / n) + '%';
    $('#dp-title').textContent = st.title;
    $('#dp-what').innerHTML = st.what || '';
    $('#dp-say-wrap').style.display = st.say ? '' : 'none';
    $('#dp-say').textContent = st.say || '';
    var note = $('#dp-note'); note.innerHTML = S.note || (st.note || ''); note.style.display = note.innerHTML ? '' : 'none';
    $('#dp-back').disabled = S.i <= 0;
    $('#dp-next').innerHTML = S.i >= n - 1 ? 'FINISH &#10003;' : 'NEXT &rarr;';
    $('#dp-next').disabled = false;
    panel.classList.toggle('dp-busy', S.busy);
  }

  /* ---------- moving between steps ---------- */
  async function runStep(k) {
    var st = CFG.steps[k];
    S.note = '';
    if (st.run) { try { await st.run(helpers); } catch (e) { S.note = 'Skipped a part of this step: ' + esc(e && e.message || e); } }
  }
  async function show(k) {
    S.i = k; render();
    var st = CFG.steps[k];
    pointAt(st.point || null);
    render();
  }
  async function next() {
    if (S.busy) return;
    if (S.i >= CFG.steps.length - 1) return exit();
    S.busy = true; panel.classList.add('dp-busy'); $('#dp-next').disabled = true;
    var k = S.i + 1;
    await runStep(k);
    S.busy = false; await show(k);
  }
  async function back() {
    if (S.busy || S.i <= 0) return;
    var k = S.i - 1;
    if (CFG.back === 'reload') { ss(KEY_STEP, String(k)); location.reload(); return; }
    S.busy = true; panel.classList.add('dp-busy');
    await runStep(k);
    S.busy = false; await show(k);
  }
  /* replay steps 0..k quickly (after a reload) so the page is exactly where step k leaves it */
  async function replayTo(k) {
    S.fast = true;
    for (var j = 0; j <= k; j++) await runStep(j);
    S.fast = false;
    await show(k);
  }

  /* ---------- keeping the demo from touching anything real ---------- */
  var realFetch = null, realConfirm = null, realAlert = null;
  function guards(on) {
    if (on) {
      realFetch = window.fetch; realConfirm = window.confirm; realAlert = window.alert;
      window.fetch = function (url, opts) {
        var u = String(url && url.url ? url.url : url);
        if (/script\.google\.com|script\.googleusercontent\.com/.test(u)) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, demo: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return realFetch.apply(this, arguments);
      };
      window.confirm = function () { return true; };
      window.alert = function () {};
    } else {
      if (realFetch) window.fetch = realFetch;
      if (realConfirm) window.confirm = realConfirm;
      if (realAlert) window.alert = realAlert;
    }
  }

  /* ---------- start and stop ---------- */
  function snapshot() {
    var snap = {};
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k !== KEY_SNAP) snap[k] = localStorage.getItem(k); } } catch (e) {}
    return snap;
  }
  function restore(snap) {
    try {
      localStorage.clear();
      Object.keys(snap || {}).forEach(function (k) { localStorage.setItem(k, snap[k]); });
      localStorage.removeItem(KEY_SNAP);
    } catch (e) {}
  }
  function begin() {                 // the DEMO button: save the real settings, load demo ones, reload
    if (CFG.seed) {
      var snap = snapshot();
      try { localStorage.setItem(KEY_SNAP, JSON.stringify(snap)); } catch (e) {}
      try { localStorage.clear(); localStorage.setItem(KEY_SNAP, JSON.stringify(snap)); Object.keys(CFG.seed).forEach(function (k) { localStorage.setItem(k, CFG.seed[k]); }); } catch (e) {}
    }
    ss(KEY_ACTIVE, CFG.key); ss(KEY_STEP, '0');
    location.reload();
  }
  function exit() {
    guards(false); S.on = false;
    if (CFG.seed) { try { restore(JSON.parse(localStorage.getItem(KEY_SNAP) || '{}')); } catch (e) {} }
    ss(KEY_ACTIVE, null); ss(KEY_STEP, null);
    location.reload();
  }
  function onKey(e) {
    if (!S.on || /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) return;
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); back(); }
    else if (e.key === 'Escape') { exit(); }
  }
  async function launch() {
    S.on = true;
    document.body.classList.add('demo-on');
    guards(true);
    buildPanel();
    document.addEventListener('keydown', onKey);
    if (CFG.ready) await waitFor(CFG.ready, 12000);
    var k = parseInt(ss(KEY_STEP) || '0', 10) || 0;
    if (k > 0) await replayTo(k); else { await runStep(0); await show(0); }
  }

  var helpers = { $: $, sleep: sleep, waitFor: waitFor, typeInto: typeInto, click: click, setValue: setValue, done: done, esc: esc,
    get fast() { return S.fast; }, ctx: S.ctx, point: pointAt };

  window.Demo = {
    register: function (cfg) {
      CFG = cfg;
      // a demo left half-way (tab closed) must not leave the demo's settings behind
      if (!ss(KEY_ACTIVE) && cfg.seed) {
        try { var stale = localStorage.getItem(KEY_SNAP); if (stale) { restore(JSON.parse(stale)); location.reload(); return; } } catch (e) {}
      }
      function ready() {
        var host = $(cfg.buttonHost || 'body');
        var b = document.createElement('button');
        b.type = 'button'; b.id = 'btn-demo'; b.className = 'demo-launch'; b.innerHTML = '&#9654; DEMO';
        b.title = 'A guided walk through the whole app, with made-up data (for presenting)';
        b.onclick = begin;
        if (cfg.buttonBefore && $(cfg.buttonBefore)) $(cfg.buttonBefore).parentNode.insertBefore(b, $(cfg.buttonBefore));
        else host.appendChild(b);
        if (ss(KEY_ACTIVE) === cfg.key) {
          if (document.readyState === 'complete') launch(); else window.addEventListener('load', launch);
        }
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready); else ready();
    }
  };
})();

/* ---------- Bobcat Scout: the steps ---------- */
(function () {
  'use strict';
  var TEXT1 = 'Scout name is Krish, event 2026ctwat, match 14, scouting team 177 red 2. In auto they scored 4 off the depot. ' +
    'Teleop 18 while driving, pickup was pretty good, passing was amazing. Played defense well. Climbed the mid rung.';
  var TEXT2 = 'Match 15, team 254 on blue 1. Scored 6 in auto and 20 in teleop. Climbed the high rung.';

  function mode(h, n) {                      // pick a way (opens the chooser first if a way is already chosen)
    var chooser = h.$('#mode-card');
    if (chooser && chooser.classList.contains('hidden')) { var change = h.$('#btn-mode-change'); if (change) change.click(); }
    return h.sleep(250).then(function () { var b = h.$('.mode-option[data-mode="' + n + '"]'); if (b) b.click(); return h.sleep(450); });
  }
  Demo.register({
    key: 'scout',
    title: 'Bobcat Scout',
    back: 'reload',
    buttonHost: '.header-actions',
    buttonBefore: '#btn-setup',
    seed: {
      scout_name: 'Krish', event_key: '2026ctwat',
      setup_state: JSON.stringify({ role: 'scouter', done: { name: true, event: true, connect: true, mic: true, practice: true }, hideStrip: true, tested: true })
    },
    ready: function () { var f = document.getElementById('fields-container'); return f && f.children.length > 3; },
    steps: [
      { title: 'One match, start to finish',
        what: 'This is the real <b>Bobcat Scout</b> app, running with made-up data. Press <b>NEXT</b> and it fills everything in for you.',
        say: 'Normally a scout is up in the stands with a phone. Today I\'ll play that scout, one match from start to finish, without touching the keyboard.',
        point: '.wordmark',
        run: function (h) { h.click('#btn-setup-close'); } },

      { title: 'Pick how to scout this match',
        what: 'Every match starts here. Four ways to scout, so each scout picks what fits the moment.',
        say: 'One: describe it. Two: talk, then it asks what you missed. Three: it asks questions out loud. Four: describe, but strict. Most scouts will use one or two.',
        point: '#mode-card',
        run: function (h) { var chooser = h.$('#mode-card'); if (chooser && chooser.classList.contains('hidden')) h.click('#btn-mode-change'); return h.sleep(300); } },

      { title: 'Way 1 · Describe it',
        what: 'Tapping <b>Describe it</b> opens the box where the scout talks (the mic) or types what they saw.',
        say: 'The scout taps the mic and just talks like they would to a friend. I\'ll type it so you can see it, but on a phone it\'s their voice.',
        point: '#mode-bar',
        run: function (h) { return mode(h, 1); } },

      { title: 'Say what you saw',
        what: 'The scout\'s words go into the box. Name, event, match, team, the robot\'s points, the climb, how it drove. All in one go.',
        say: 'Scout name Krish, event, match 14, team 177 red 2. Four in auto, eighteen in teleop, good pickup, amazing passing, played defense, climbed the mid rung. That\'s ten seconds of talking.',
        point: '#step-describe',
        run: function (h) {
          var t = h.$('#transcript'); h.setValue(t, ''); h.done(t);
          return h.typeInto(t, TEXT1);
        } },

      { title: 'AUTO-FILL FIELDS',
        what: 'One tap, and the app reads the sentence and fills in the form.',
        say: 'It knows the game: depot, mid rung, passing. It also fixes the usual speech mistakes, so "to fifty four" becomes team 254.',
        point: '#btn-process',
        run: function (h) { h.click('#btn-process'); return h.sleep(1100); } },

      { title: 'The form filled itself',
        what: 'Every box the scout mentioned is filled. They can tap any box to change it.',
        say: 'Match 14, team 177, four in auto, eighteen in teleop, the climb. Nobody typed those boxes. The scout just checks them and moves on.',
        point: '#fields-container',
        run: function (h) { return h.sleep(200); } },

      { title: 'Make the QR, TSV and JSON',
        what: 'One more tap makes the scouting row in the formats the team already uses.',
        say: 'This is the same row our QRScout scanner expects, so everything downstream keeps working. Nothing about our process had to change.',
        point: '#step-output .card-bar',
        run: function (h) { h.click('#btn-generate'); return h.sleep(1200); } },

      { title: 'The row, as a QR code',
        what: 'The QR code holds the whole match. A scanner can read it straight off the phone.',
        say: 'If the internet is bad at the venue, you can still scan this to the laptop.',
        point: '.qr-frame',
        run: function (h) { h.click('.tab[data-tab="qr"]'); return h.sleep(300); } },

      { title: 'The same row as a spreadsheet line',
        what: 'The <b>TSV</b> tab is the same match as a row you can paste into a Sheet.',
        say: 'Same data, a different shape. QR for the scanner, TSV for the spreadsheet, JSON for the nerds.',
        point: '#tsv-output',
        run: function (h) { h.click('.tab[data-tab="tsv"]'); return h.sleep(300); } },

      { title: 'Send it to the team Sheet',
        what: 'In real use the scout taps <b>SUBMIT TO SHEET</b> and the match lands in the team\'s Google Sheet. <b>The demo never sends anything</b>, so this button is only pointed at.',
        say: 'One tap sends it to our Google Sheet. If there\'s no signal, it waits on the phone and sends itself when the signal is back. Strategy sees it a few seconds later.',
        point: '#btn-submit-sheet',
        run: function (h) { return h.sleep(200); } },

      { title: 'Way 2 · Talk, then fill the gaps',
        what: 'A shorter description this time. The app fills what it heard and lists what is <b>still missing</b>.',
        say: 'Say a scout only caught the score and the climb. It doesn\'t guess. It shows what\'s left to fill, so nothing slips through half-empty.',
        point: '#gaps-banner',
        run: function (h) {
          h.click('#btn-clear-all');
          return h.sleep(500).then(function () { return mode(h, 2); }).then(function () {
            var t = h.$('#transcript'); h.setValue(t, ''); h.done(t);
            return h.typeInto(t, TEXT2);
          }).then(function () { return h.sleep(250); }).then(function () { h.click('#btn-process'); return h.sleep(1000); });
        } },

      { title: 'Way 3 · Guided',
        what: 'The app asks one question at a time, out loud, and listens. Answer in a few words.',
        say: 'For loud gyms. The phone asks "how many in auto?", the scout answers, and it moves on by itself. You can say skip, go back, or I\'m done. It needs the mic, so I\'m only showing the start screen.',
        point: '#guided-card',
        run: function (h) { return mode(h, 3); } },

      { title: 'Way 4 · Describe, strict',
        what: 'Like way 1, but it only fills what the scout clearly said. It leaves unsure boxes empty.',
        say: 'For scouts who would rather get a blank than a wrong guess.',
        point: '#mode-bar',
        run: function (h) { return mode(h, 4); } },

      { title: 'That\'s the whole loop',
        what: 'Pick a way, talk, auto-fill, check, send. About a minute a match, with no typing in the stands.',
        say: 'That\'s the scouting side. Next, what the strategy team gets out of all those rows: the analytics app.',
        point: '.wordmark',
        run: function (h) { return h.sleep(100); } }
    ]
  });
})();
