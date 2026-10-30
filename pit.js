/* Pit scouting screens: the PIT button in the header.
 *
 * One report per team (the questions are in pit-form.js) with up to 3 photos. Photos are shrunk on the
 * phone first (about 0.2-0.4 MB each). Reports wait in the phone's own database until they are sent,
 * so no signal in the pits loses nothing; they go by themselves when the signal comes back.
 * Sending: the report goes like a match does (jsonpSubmit in app.js); each photo is uploaded separately
 * (a POST, since a photo is too big for a link); then the phone asks the Sheet how many photos the team
 * has, because the browser can't read the answer to an upload. pit-core.js has the rules.
 */
(function () {
  'use strict';
  if (!window.PIT_FORM || !window.PIT_CORE) return;
  var F = window.PIT_FORM, C = window.PIT_CORE;
  var S = { overlay: null, team: '', answers: null, photos: [], busy: false, items: [], view: '' };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ls(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function meta() { return { scoutName: ls('scout_name'), eventKey: ls('event_key').toLowerCase() }; }
  // app.js's globals (top-level let/function), read safely
  function endpoint() { try { return typeof sheetEndpoint !== 'undefined' ? sheetEndpoint : ''; } catch (e) { return ''; } }
  function passcode() { try { return typeof sheetPasscode !== 'undefined' ? sheetPasscode : ''; } catch (e) { return ''; } }
  function jsonp(payload) { return jsonpSubmit(payload, 20000, endpoint()); }   // eslint-disable-line no-undef
  function withAuth(p) {
    p.passcode = passcode();
    try { if (typeof googleTokenValid === 'function' && googleTokenValid()) p.idToken = googleIdToken; } catch (e) {}   // eslint-disable-line no-undef
    return p;
  }

  /* ---------- the phone's own database (IndexedDB) for reports waiting to send ---------- */
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error('no database'));
      var req = indexedDB.open('bobcat-pit', 1);
      req.onupgradeneeded = function () { req.result.createObjectStore('queue', { keyPath: 'id' }); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction('queue', mode), st = t.objectStore('queue'), out = fn(st);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }
  function allItems() { return tx('readonly', function (st) { return st.getAll(); }).then(function (r) { return r || []; }); }
  function putItem(it) { return tx('readwrite', function (st) { st.put(it); }); }
  function delItem(id) { return tx('readwrite', function (st) { st.delete(id); }); }

  /* ---------- sending ---------- */
  function upload(item, photo) {
    var body = JSON.stringify(withAuth({ action: 'pitPhoto', eventKey: item.eventKey, teamNumber: item.teamNumber, scoutName: item.row.scoutName,
      photoId: photo.photoId, mime: photo.mime, data: photo.data }));
    // no-cors: the Sheet saves it, but the browser may not show us the answer, hence pitCheck afterwards
    return fetch(endpoint(), { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body });
  }
  function count(item) {
    return jsonp(withAuth({ action: 'pitCheck', eventKey: item.eventKey, teamNumber: item.teamNumber })).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || 'no answer');
      return r.photos || 0;
    });
  }
  async function sendItem(item) {
    if (!endpoint()) { item.error = 'this phone is not connected to the team Sheet'; return item; }
    if (!passcode()) { item.error = 'no team password on this phone: open your scouting link first'; return item; }
    item.tries++; item.error = '';
    if (!item.rowSent) {
      var r = await jsonp(withAuth(Object.assign({}, item.row)));
      if (!r || !r.ok) { item.error = (r && r.error) || 'the Sheet did not answer'; return item; }
      item.rowSent = true; await putItem(item);
    }
    var left = C.unsent(item);
    if (left.length) {
      var before = await count(item);
      for (var i = 0; i < left.length; i++) { try { await upload(item, left[i]); } catch (e) { /* offline: checked below */ } }
      var after = await count(item);
      if (C.photosArrived(before, after, left.length)) left.forEach(function (p) { p.sent = true; p.data = ''; });   // free the space
      else item.error = 'some photos did not arrive yet; they will be sent again';
    }
    return item;
  }
  async function flush() {
    if (S.busy || !navigator.onLine) return;
    S.busy = true;
    try {
      var items = await allItems();
      for (var i = 0; i < items.length; i++) {
        var it;
        try { it = await sendItem(items[i]); } catch (e) { it = items[i]; it.error = 'no signal yet'; }
        if (C.done(it)) { markDone(it); await delItem(it.id); } else await putItem(it);
        S.last = it;
      }
    } catch (e) { /* no database: nothing to send */ }
    S.busy = false;
    // refresh the list if it is showing (never over a report being filled in)
    if (S.overlay && S.overlay.classList.contains('pit-open') && S.view === 'list') renderList();
  }
  function markDone(it) {
    try {
      var k = 'pit_done_' + it.eventKey, done = JSON.parse(localStorage.getItem(k) || '{}');
      done[it.teamNumber] = { at: Date.now(), photos: it.photos.length };
      localStorage.setItem(k, JSON.stringify(done));
    } catch (e) {}
  }
  function doneTeams(ek) { try { return JSON.parse(localStorage.getItem('pit_done_' + ek) || '{}'); } catch (e) { return {}; } }
  window.addEventListener('online', function () { flush(); });

  /* ---------- photos: shrink on the phone before saving ---------- */
  function shrink(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var size = C.fitSize(img.naturalWidth, img.naturalHeight), cv = document.createElement('canvas');
        cv.width = size.w; cv.height = size.h;
        cv.getContext('2d').drawImage(img, 0, 0, size.w, size.h);
        URL.revokeObjectURL(url);
        for (var i = 0; i < C.QUALITIES.length; i++) {
          var data = cv.toDataURL('image/jpeg', C.QUALITIES[i]);
          if (C.photoFits(data)) return resolve({ mime: 'image/jpeg', data: data });
        }
        reject(new Error('photo too big even after shrinking'));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('not a photo this phone can read')); };
      img.src = url;
    });
  }

  /* ---------- the screens ---------- */
  function open(team) {
    if (!S.overlay) {
      var o = document.createElement('div');
      o.id = 'pit-overlay'; o.className = 'pit-overlay'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-label', 'Pit scouting');
      o.innerHTML = '<div class="pit-card"><div class="pit-top"><div class="pit-title">PIT SCOUTING</div><button type="button" class="pit-close" aria-label="Close pit scouting">&times;</button></div><div id="pit-body" class="pit-body"></div></div>';
      document.body.appendChild(o); S.overlay = o;
      $('.pit-close', o).addEventListener('click', close);
      o.addEventListener('click', function (e) { if (e.target === o) close(); });
      o.addEventListener('click', onClick);
      o.addEventListener('input', onInput);
      o.addEventListener('change', onChange);
    }
    S.overlay.classList.add('pit-open'); document.body.classList.add('pit-lock');
    if (team) startForm(team); else renderList();
    flush();
  }
  function close() { if (S.overlay) { S.overlay.classList.remove('pit-open'); document.body.classList.remove('pit-lock'); } }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.overlay && S.overlay.classList.contains('pit-open')) close(); });

  function eventTeams(ek) {
    var set = {};
    try {
      if (typeof scheduleCache !== 'undefined' && scheduleCache && scheduleCache.event === ek) {   // eslint-disable-line no-undef
        Object.keys(scheduleCache.matches || {}).forEach(function (k) { var m = scheduleCache.matches[k]; (m.red || []).concat(m.blue || []).forEach(function (t) { set[String(t).replace('frc', '')] = 1; }); });   // eslint-disable-line no-undef
      }
    } catch (e) {}
    return Object.keys(set).sort(function (a, b) { return a - b; });
  }

  async function renderList() {
    S.view = 'list';
    var m = meta(), b = $('#pit-body');
    var items = []; try { items = await allItems(); } catch (e) {}
    var done = doneTeams(m.eventKey), waiting = {};
    items.forEach(function (it) { if (it.eventKey === m.eventKey) waiting[it.teamNumber] = it; });
    var teams = eventTeams(m.eventKey);
    if (S.view !== 'list') return;   // a report was opened while the list was loading
    var h = '<p class="pit-lead">One report per robot: walk up to their pit, ask the questions, take a photo or two. It saves on this phone first and sends when there is signal.</p>';
    if (!m.scoutName || !m.eventKey) h += '<div class="pit-note pit-warn">Finish <strong>SETUP</strong> first (your name and the event), then come back.</div>';
    if (!endpoint() || !passcode()) h += '<div class="pit-note pit-warn">This phone isn\'t connected to the team Sheet yet. Open the scouting link your lead sent; reports will wait here until then.</div>';
    h += '<div class="pit-start"><label>Team number <input id="pit-team-input" type="number" inputmode="numeric" min="1" max="99999" placeholder="e.g. 177"></label><button type="button" class="pit-btn pit-primary" data-pit="new">START REPORT</button></div>';
    var waitingList = Object.keys(waiting);
    if (waitingList.length) {
      h += '<h3 class="pit-h">Waiting to send</h3><ul class="pit-items">' + waitingList.map(function (t) {
        var it = waiting[t];
        return '<li><strong>' + esc(t) + '</strong><span class="pit-sub">' + esc(C.statusText(it)) + '</span></li>';
      }).join('') + '</ul><button type="button" class="pit-btn" data-pit="flush">' + (S.busy ? 'SENDING…' : 'SEND NOW') + '</button>';
    }
    if (teams.length) {
      var doneN = teams.filter(function (t) { return done[t]; }).length;
      h += '<h3 class="pit-h">Teams at ' + esc(m.eventKey) + ' <span class="pit-sub">' + doneN + ' of ' + teams.length + ' done on this phone</span></h3><div class="pit-teams">' + teams.map(function (t) {
        var cls = done[t] ? 'pit-t-done' : (waiting[t] ? 'pit-t-wait' : '');
        return '<button type="button" class="pit-t ' + cls + '" data-pit="team" data-team="' + esc(t) + '">' + esc(t) + (done[t] ? ' ✓' : (waiting[t] ? ' ⏳' : '')) + '</button>';
      }).join('') + '</div><p class="pit-sub">✓ sent from this phone · ⏳ waiting to send. Other scouts\' reports don\'t show here; the scouting lead sees all of them in Analytics.</p>';
    } else {
      h += '<p class="pit-sub">Load the match schedule (the ⚙ SHEET button, LOAD MATCH SCHEDULE) to see a list of the teams here.</p>';
    }
    b.innerHTML = h;
  }

  function startForm(team) {
    S.team = String(team); S.answers = { teamNumber: String(team) }; S.photos = [];
    renderForm();
  }
  function renderForm() {
    S.view = 'form';
    var b = $('#pit-body'), a = S.answers;
    var h = '<div class="pit-nav"><button type="button" class="pit-link" data-pit="list">← All teams</button></div>';
    h += '<h2 class="pit-h2">Team <input class="pit-team-num" data-pit-field="teamNumber" type="number" inputmode="numeric" value="' + esc(a.teamNumber) + '" aria-label="Team number"></h2>';
    F.fields.forEach(function (f) {
      var v = a[f.code] == null ? '' : a[f.code], ctl;
      if (f.type === 'select') ctl = '<select data-pit-field="' + f.code + '"><option value="">—</option>' + f.options.map(function (o) { return '<option' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
      else if (f.type === 'number') ctl = '<input type="number" inputmode="numeric" data-pit-field="' + f.code + '" value="' + esc(v) + '"' + (f.min != null ? ' min="' + f.min + '"' : '') + (f.max != null ? ' max="' + f.max + '"' : '') + '>';
      else if (f.type === 'textarea') ctl = '<textarea rows="3" data-pit-field="' + f.code + '" placeholder="' + esc(f.placeholder || '') + '">' + esc(v) + '</textarea>';
      else ctl = '<input type="text" data-pit-field="' + f.code + '" value="' + esc(v) + '" placeholder="' + esc(f.placeholder || '') + '">';
      h += '<label class="pit-field"><span>' + esc(f.label) + '</span>' + ctl + '</label>';
    });
    var max = F.maxPhotos || 3;
    h += '<div class="pit-photos"><div class="pit-field"><span>Photos (up to ' + max + ')</span></div><div class="pit-thumbs">' + S.photos.map(function (p, i) {
      return '<div class="pit-thumb"><img src="' + p.data + '" alt="Photo ' + (i + 1) + '"><button type="button" data-pit="rmphoto" data-i="' + i + '" aria-label="Remove photo">×</button></div>';
    }).join('') + (S.photos.length < max ? '<label class="pit-add"><input type="file" accept="image/*" capture="environment" multiple id="pit-file" hidden><span>📷<br>Add photo</span></label>' : '') + '</div>' +
      '<p class="pit-sub">Photos of the robot only, not of people. Ask the team first.</p></div>';
    h += '<div id="pit-problems"></div><div class="pit-actions"><button type="button" class="pit-btn pit-primary" data-pit="save">SAVE &amp; SEND</button><button type="button" class="pit-btn" data-pit="list">CANCEL</button></div>';
    b.innerHTML = h;
  }

  function onInput(e) { var k = e.target.getAttribute && e.target.getAttribute('data-pit-field'); if (k && S.answers) S.answers[k] = e.target.value; }
  async function onChange(e) {
    onInput(e);
    if (e.target.id !== 'pit-file') return;
    var files = Array.prototype.slice.call(e.target.files || []), max = F.maxPhotos || 3, msg = $('#pit-problems');
    for (var i = 0; i < files.length && S.photos.length < max; i++) {
      try { S.photos.push(await shrink(files[i])); } catch (err) { if (msg) msg.innerHTML = '<div class="pit-note pit-warn">' + esc(err.message) + '</div>'; }
    }
    renderForm();
  }
  async function onClick(e) {
    var b = e.target.closest('[data-pit]'); if (!b) return;
    var act = b.getAttribute('data-pit');
    if (act === 'list') { renderList(); }
    else if (act === 'new') { var v = ($('#pit-team-input') || {}).value; if (v) startForm(v); else ($('#pit-team-input') || {}).focus(); }
    else if (act === 'team') startForm(b.getAttribute('data-team'));
    else if (act === 'flush') { await flush(); renderList(); }
    else if (act === 'rmphoto') { S.photos.splice(Number(b.getAttribute('data-i')), 1); renderForm(); }
    else if (act === 'save') {
      var problems = C.check(F, Object.assign({}, S.answers, { photos: S.photos }), meta());
      if (problems.length) { $('#pit-problems').innerHTML = '<div class="pit-note pit-warn">' + problems.map(esc).join('<br>') + '</div>'; return; }
      var item = C.newItem(C.buildRow(F, S.answers, meta()), S.photos);
      try { await putItem(item); }
      catch (err) { $('#pit-problems').innerHTML = '<div class="pit-note pit-warn">This phone could not save the report (' + esc(err.message || err) + '). Try again, or with fewer photos.</div>'; return; }
      S.photos = []; S.answers = null; S.view = 'sending';
      $('#pit-body').innerHTML = '<div class="pit-note pit-good">Saved on this phone. Sending…</div>';
      await flush();
      renderList();
    }
  }

  /* ---------- the button ---------- */
  function addButton() {
    var host = $('.header-actions'); if (!host || $('#btn-pit')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.id = 'btn-pit'; b.className = 'btn-header-outline'; b.title = 'Pit scouting: one report and photos per robot';
    b.innerHTML = '&#128295; PIT';
    b.addEventListener('click', function () { open(); });
    var before = $('#btn-practice') || $('#btn-demo') || $('#btn-setup'); if (before) host.insertBefore(b, before); else host.appendChild(b);
    // anything left from last time goes when there is signal
    setTimeout(flush, 3000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButton); else addButton();
  window.PIT_UI = { open: open, close: close, flush: flush, _allItems: allItems };
})();
