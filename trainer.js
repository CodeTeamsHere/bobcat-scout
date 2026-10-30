/* The scout trainer's screens: the PRACTICE button in the header opens a practice scouting session.
 *
 * A scout picks a real past match, watches its video, scouts the three robots of one alliance on a
 * small form, and gets feedback against The Blue Alliance's official score breakdown (trainer-core.js
 * does the grading; practice-data.js holds the matches). Nothing is sent anywhere: results are kept
 * on this phone only, so a scout can see their own progress and earn a "trusted scout" badge.
 */
(function () {
  'use strict';
  if (!window.PRACTICE || !window.TRAINER) return;
  var P = window.PRACTICE, T = window.TRAINER;
  var KEY = 'trainer_results';
  var S = { view: 'home', match: null, answers: null, result: null, overlay: null };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function loadResults() { try { var r = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(r) ? r : []; } catch (e) { return []; } }
  function saveResult(r) { try { var all = loadResults(); all.push(r); localStorage.setItem(KEY, JSON.stringify(all.slice(-200))); } catch (e) {} }
  function name(m) { return 'Q' + m.match + ' · ' + (m.alliance === 'red' ? 'Red' : 'Blue') + ' alliance'; }
  function emptyAnswers(m) {
    var a = { counts: {}, robots: [] };
    P.counts.forEach(function (c) { a.counts[c.code] = m.teams.map(function () { return ''; }); });
    m.teams.forEach(function () { var o = {}; P.robotChoices.forEach(function (c) { o[c.code] = ''; }); a.robots.push(o); });
    return a;
  }
  function complete(m, a) {
    return P.counts.every(function (c) { return a.counts[c.code].every(function (v) { return v !== '' && isFinite(Number(v)) && Number(v) >= 0; }); }) &&
      a.robots.every(function (r) { return P.robotChoices.every(function (c) { return r[c.code] !== ''; }); });
  }

  /* ---------- the overlay ---------- */
  function open() {
    if (!S.overlay) {
      var o = document.createElement('div');
      o.id = 'trainer-overlay'; o.className = 'tr-overlay'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-label', 'Practice scouting');
      o.innerHTML = '<div class="tr-card"><div class="tr-top"><div class="tr-title">PRACTICE SCOUTING</div><button type="button" class="tr-close" aria-label="Close practice">&times;</button></div><div id="tr-body" class="tr-body"></div></div>';
      document.body.appendChild(o); S.overlay = o;
      $('.tr-close', o).addEventListener('click', close);
      o.addEventListener('click', function (e) { if (e.target === o) close(); });
      o.addEventListener('click', onClick);
      o.addEventListener('input', onInput);
      o.addEventListener('change', onInput);
    }
    S.overlay.classList.add('tr-open'); document.body.classList.add('tr-lock');
    S.view = 'home'; render();
  }
  function close() {
    if (!S.overlay) return;
    S.overlay.classList.remove('tr-open'); document.body.classList.remove('tr-lock');
    $('#tr-body').innerHTML = '';                      // stops a playing video
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.overlay && S.overlay.classList.contains('tr-open')) close(); });

  function render() {
    var b = $('#tr-body');
    if (S.view === 'home') b.innerHTML = home();
    else if (S.view === 'scout') b.innerHTML = scout();
    else b.innerHTML = result();
    b.scrollTop = 0; S.overlay.querySelector('.tr-card').scrollTop = 0;
    refreshCheck();
  }

  /* ---------- the list ---------- */
  function home() {
    var results = loadResults(), pr = T.progress(results, P.matches), next = T.nextMatch(P.matches, pr.best);
    var h = '<p class="tr-lead">Watch a real match, scout the three robots of one alliance, and see how close you were to the <strong>official</strong> numbers. It takes about 10 minutes. Nothing is sent anywhere: your results stay on this phone.</p>';
    h += '<div class="tr-stats"><div><b>' + pr.matchesDone + ' / ' + P.matches.length + '</b><span>matches practised</span></div>' +
      '<div><b>' + (pr.recentAverage == null ? '–' : pr.recentAverage) + '</b><span>recent average</span></div>' +
      '<div class="' + (pr.trusted ? 'tr-badge-on' : '') + '"><b>' + (pr.trusted ? '✓' : pr.streak + ' / 3') + '</b><span>' + (pr.trusted ? 'trusted scout!' : 'in a row at 80+') + '</span></div></div>';
    if (pr.trusted) h += '<div class="tr-note tr-good">You are a <strong>trusted scout</strong>: three practice matches in a row at 80 or better. Tell your scouting lead.</div>';
    else h += '<div class="tr-note">Score 80 or better on three matches in a row to earn the <strong>trusted scout</strong> badge. The matches start easy.</div>';
    h += '<div class="tr-actions">' + (next ? '<button type="button" class="tr-btn tr-primary" data-tr="start" data-id="' + esc(next.id) + '">START THE NEXT MATCH</button>' : '<span class="tr-note">You have done every match. Try some again to beat your best.</span>') + '</div>';
    var order = ['easy', 'medium', 'harder'], names = { easy: 'Easy: not many pieces', medium: 'Medium', harder: 'Harder: more pieces and climbs' };
    order.forEach(function (lv) {
      var list = P.matches.filter(function (m) { return m.level === lv; });
      if (!list.length) return;
      h += '<h3 class="tr-h">' + names[lv] + '</h3><ul class="tr-list">' + list.map(function (m) {
        var best = pr.best[m.id];
        return '<li><div><strong>' + esc(name(m)) + '</strong><span class="tr-sub">' + esc(m.eventName) + '</span></div>' +
          '<div class="tr-li-r">' + (best == null ? '<span class="tr-new">new</span>' : '<span class="tr-best ' + (best >= 80 ? 'tr-ok' : '') + '">best ' + best + '</span>') +
          '<button type="button" class="tr-btn" data-tr="start" data-id="' + esc(m.id) + '">' + (best == null ? 'START' : 'AGAIN') + '</button></div></li>';
      }).join('') + '</ul>';
    });
    return h;
  }

  /* ---------- scouting a match ---------- */
  function scout() {
    var m = S.match, a = S.answers, side = m.alliance === 'red' ? 'Red' : 'Blue';
    var h = '<div class="tr-nav"><button type="button" class="tr-link" data-tr="home">← All matches</button></div>';
    h += '<h2 class="tr-h2">' + esc(name(m)) + ' <span class="tr-sub">' + esc(m.eventName) + '</span></h2>';
    h += '<p class="tr-lead">Watch the video. Then scout <strong>all three ' + side.toLowerCase() + ' robots</strong>: watch it once for each robot, at half speed if you like (the ⚙ in the video). The field only counts the whole alliance, so the three counts are added up and checked together.</p>';
    h += '<div class="tr-video"><iframe src="https://www.youtube-nocookie.com/embed/' + esc(m.video) + '?rel=0" title="Match video" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>';
    h += '<p class="tr-sub tr-center"><a href="https://www.youtube.com/watch?v=' + esc(m.video) + '" target="_blank" rel="noopener">Video not showing? Open it on YouTube</a> · the match starts at the beginning of the video</p>';
    m.teams.forEach(function (team, i) {
      h += '<div class="tr-robot"><div class="tr-robot-h"><span class="tr-pos">' + side + ' ' + (i + 1) + '</span> <strong>Team ' + esc(team) + '</strong></div>';
      P.counts.forEach(function (c) {
        h += '<label class="tr-field"><span>' + esc(c.label) + '</span><div class="tr-counter"><button type="button" data-tr="dec" data-c="' + c.code + '" data-i="' + i + '" aria-label="one less">−</button>' +
          '<input type="number" inputmode="numeric" min="0" max="999" data-count="' + c.code + '" data-i="' + i + '" value="' + esc(a.counts[c.code][i]) + '" placeholder="0">' +
          '<button type="button" data-tr="inc" data-c="' + c.code + '" data-i="' + i + '" aria-label="one more">+</button></div></label>';
      });
      P.robotChoices.forEach(function (c) {
        h += '<label class="tr-field"><span>' + esc(c.label) + '</span><select data-choice="' + c.code + '" data-i="' + i + '"><option value="">—</option>' +
          c.options.map(function (o) { return '<option value="' + esc(o.k) + '"' + (a.robots[i][c.code] === o.k ? ' selected' : '') + '>' + esc(o.v) + '</option>'; }).join('') + '</select></label>';
      });
      h += '</div>';
    });
    h += '<div class="tr-hints">' + P.counts.map(function (c) { return '<div><strong>' + esc(c.label) + ':</strong> ' + esc(c.hint) + '</div>'; }).join('') + '</div>';
    h += '<div class="tr-actions"><button type="button" class="tr-btn tr-primary" id="tr-check" data-tr="check" disabled>CHECK MY WORK</button><span class="tr-sub" id="tr-check-hint">Fill in every box to check.</span></div>';
    return h;
  }
  function refreshCheck() {
    var btn = $('#tr-check'); if (!btn || !S.match) return;
    var ok = complete(S.match, S.answers);
    btn.disabled = !ok; var hint = $('#tr-check-hint'); if (hint) hint.textContent = ok ? '' : 'Fill in every box to check.';
  }

  /* ---------- the result ---------- */
  function result() {
    var r = S.result, m = S.match, pr = T.progress(loadResults(), P.matches);
    var h = '<div class="tr-nav"><button type="button" class="tr-link" data-tr="home">← All matches</button></div>';
    h += '<div class="tr-score ' + (r.score >= 80 ? 'tr-ok' : '') + '"><div class="tr-score-n">' + r.score + '</div><div><div class="tr-verdict">' + esc(r.verdict) + '</div><div class="tr-sub">' + esc(name(m)) + ' · ' + esc(m.eventName) + '</div></div></div>';
    if (pr.trusted && r.score >= 80) h += '<div class="tr-note tr-good">🎉 Three in a row at 80 or better: you are a <strong>trusted scout</strong>.</div>';
    h += '<h3 class="tr-h">Counts for the whole alliance</h3><p class="tr-sub">The field only records the alliance\'s total, so your three counts are added up and compared.</p>';
    r.counts.forEach(function (c) {
      h += '<div class="tr-count tr-b-' + c.band + '"><div class="tr-count-h"><strong>' + esc(c.label) + '</strong><span class="tr-chip">' + esc(c.bandText) + '</span></div>' +
        '<div class="tr-count-n"><div><b>' + c.yours + '</b><span>you counted<br>(' + c.perRobot.join(' + ') + ')</span></div><div><b>' + c.official + '</b><span>the field<br>recorded</span></div></div>' +
        '<p>' + esc(c.tip) + '</p></div>';
    });
    h += '<h3 class="tr-h">Climbs, robot by robot</h3>';
    r.robots.forEach(function (rob, i) {
      var allOk = rob.rows.every(function (x) { return x.ok; });
      h += '<div class="tr-rob ' + (allOk ? 'tr-rob-ok' : '') + '"><div class="tr-robot-h"><span class="tr-pos">' + (m.alliance === 'red' ? 'Red ' : 'Blue ') + (i + 1) + '</span> <strong>Team ' + esc(rob.team) + '</strong>' + (allOk ? ' <span class="tr-chip tr-chip-ok">all match</span>' : '') + '</div>';
      rob.rows.forEach(function (x) {
        h += '<div class="tr-row ' + (x.ok ? 'tr-row-ok' : '') + '"><div class="tr-row-l">' + (x.ok ? '✓' : '→') + ' ' + esc(x.label) + '</div><div class="tr-row-v"><span>you: ' + esc(x.yoursText) + '</span><span>field: ' + esc(x.officialText) + '</span></div>' + (x.ok && x.kind === 'same' ? '' : '<p>' + esc(x.text) + '</p>') + '</div>';
      });
      h += '</div>';
    });
    h += '<div class="tr-actions"><button type="button" class="tr-btn" data-tr="again">TRY THIS MATCH AGAIN</button>' +
      (T.nextMatch(P.matches, pr.best) ? '<button type="button" class="tr-btn tr-primary" data-tr="start" data-id="' + esc(T.nextMatch(P.matches, pr.best).id) + '">NEXT MATCH</button>' : '') + '</div>';
    h += '<p class="tr-sub tr-center">Practice results stay on this phone. They are not sent to the Sheet or to anyone.</p>';
    return h;
  }

  /* ---------- clicks and typing ---------- */
  function setCount(code, i, v) { S.answers.counts[code][i] = v; }
  function onInput(e) {
    var t = e.target;
    if (t.getAttribute && t.getAttribute('data-count')) { var v = t.value === '' ? '' : String(Math.max(0, Math.min(999, Math.floor(Number(t.value) || 0)))); setCount(t.getAttribute('data-count'), Number(t.getAttribute('data-i')), v); refreshCheck(); }
    else if (t.getAttribute && t.getAttribute('data-choice')) { S.answers.robots[Number(t.getAttribute('data-i'))][t.getAttribute('data-choice')] = t.value; refreshCheck(); }
  }
  function onClick(e) {
    var b = e.target.closest('[data-tr]'); if (!b) return;
    var act = b.getAttribute('data-tr');
    if (act === 'home') { S.view = 'home'; render(); }
    else if (act === 'start') { S.match = P.matches.filter(function (m) { return m.id === b.getAttribute('data-id'); })[0]; S.answers = emptyAnswers(S.match); S.view = 'scout'; render(); }
    else if (act === 'again') { S.view = 'scout'; render(); }                                 // keeps what they entered, so they can fix it
    else if (act === 'inc' || act === 'dec') {
      var code = b.getAttribute('data-c'), i = Number(b.getAttribute('data-i'));
      var cur = S.answers.counts[code][i] === '' ? 0 : Number(S.answers.counts[code][i]);
      var nv = Math.max(0, Math.min(999, cur + (act === 'inc' ? 1 : -1)));
      setCount(code, i, String(nv)); var inp = $('[data-count="' + code + '"][data-i="' + i + '"]'); if (inp) inp.value = nv; refreshCheck();
    } else if (act === 'check') {
      if (!complete(S.match, S.answers)) return;
      S.result = T.grade(S.match, P, S.answers);
      saveResult({ id: S.match.id, score: S.result.score, at: new Date().toISOString() });
      S.view = 'result'; render();
    }
  }

  /* ---------- the button ---------- */
  function addButton() {
    var host = $('.header-actions'); if (!host || $('#btn-practice')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'btn-practice'; b.className = 'btn-header-outline'; b.title = 'Practice scouting a real match and see how close you were';
    b.innerHTML = '&#127919; PRACTICE';
    b.addEventListener('click', open);
    var before = $('#btn-demo') || $('#btn-setup'); if (before) host.insertBefore(b, before); else host.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButton); else addButton();
  window.TRAINER_UI = { open: open, close: close };
})();
