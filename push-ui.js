/* The "Remind me before my shift" switch, right under the shift strip (assign.js).
 *
 *   Off -> tap: the phone asks permission to show notifications, subscribes to Web Push, and tells the server
 *   (POST /api/push/subscribe) which shifts to remind about. The server (worker/push.js) then sends
 *   "Your shift starts soon: Q12-15, Red 2" a few matches ahead, even with the app closed.
 *   On -> tap: the phone unsubscribes and tells the server (POST /api/push/unsubscribe).
 *
 * The switch only shows when /api/push/status says the server is set up for it (PUSH-SETUP.md), and only
 * when this scout has shifts. When reminders cannot work here it says why in plain words instead.
 * assign.js calls PUSH_UI.shiftsChanged() whenever the lead's rotation changes, so the server never
 * keeps old shifts. Nothing but the event code, the scout's name, the shifts and the phone's push address
 * is sent.
 */
(function () {
  'use strict';
  var STATUS_URL = '/api/push/status';
  var status = null;          // { configured, publicKey, remindAhead } once known
  var busy = false;
  var message = '';           // the last thing to tell the scout (shown under the switch)
  var RESYNC_MS = 7 * 24 * 3600 * 1000;   // the server forgets a phone after 30 quiet days; this keeps it fresh

  function ls(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* private mode */ } }
  function eventKey() { return ls('event_key').toLowerCase(); }
  function shifts() { try { var s = JSON.parse(ls('my_shifts_' + eventKey()) || '[]'); return Array.isArray(s) ? s : []; } catch (e) { return []; } }
  function isOn() { return ls('push_on_' + eventKey()) === '1'; }

  function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function isInstalled() { return navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches); }
  function supported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }

  function bytes(b64u) {
    var t = String(b64u).replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    var bin = atob(t), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function sameKey(sub, publicKey) {
    try {
      var have = sub.options && sub.options.applicationServerKey;
      if (!have) return true;   // cannot tell: assume it matches
      var a = new Uint8Array(have), b = bytes(publicKey);
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    } catch (e) { return true; }
  }

  /* ---------- talking to the server ---------- */
  function loadStatus() {
    return fetch(STATUS_URL, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (j && typeof j === 'object') { status = { configured: j.configured === true && !!j.publicKey, publicKey: String(j.publicKey || ''), remindAhead: Number(j.remindAhead) || 3 }; lsSet('push_status', JSON.stringify(status)); }
      else status = null;
    }).catch(function () {
      // offline or no server: use the last answer so a scout who already turned it on still sees the switch
      try { status = JSON.parse(ls('push_status') || 'null'); } catch (e) { status = null; }
    });
  }
  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var err = new Error(j.error || ('The server said ' + r.status)); err.status = r.status; throw err; }
        return j;
      });
    });
  }
  function payload(sub) {
    return { eventKey: eventKey(), scoutName: ls('scout_name').slice(0, 40), subscription: sub.toJSON(), shifts: shifts().slice(0, 20), leadMatches: (status && status.remindAhead) || 3 };
  }
  function signature() { return JSON.stringify([eventKey(), ls('scout_name'), shifts(), status && status.remindAhead]); }
  function sync(sub) {
    return post('/api/push/subscribe', payload(sub)).then(function () { lsSet('push_sig_' + eventKey(), signature()); lsSet('push_sync_' + eventKey(), String(Date.now())); });
  }

  /* ---------- turning it on and off ---------- */
  async function turnOn() {
    var perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();   // must be asked straight from the tap
    if (perm !== 'granted') {
      message = perm === 'denied' ? '' : 'You did not allow notifications, so reminders stay off. Tap the switch again when you are ready.';
      return;
    }
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub, status.publicKey)) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(status.publicKey) });
    await sync(sub);
    lsSet('push_on_' + eventKey(), '1');
    message = 'Reminders are on. You will get a notification about ' + ((status && status.remindAhead) || 3) + ' matches before each shift, even if the app is closed.';
  }
  async function turnOff() {
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    lsDel('push_on_' + eventKey()); lsDel('push_sig_' + eventKey());
    message = 'Reminders are off.';
    if (sub) {
      try { await post('/api/push/unsubscribe', { eventKey: eventKey(), endpoint: sub.endpoint }); } catch (e) { message = 'Reminders are off on this phone. (The server could not be reached to say so; it stops sending by itself.)'; }
      try { await sub.unsubscribe(); } catch (e) { /* already gone */ }
    }
  }
  function toggle() {
    if (busy) return;
    busy = true; message = ''; render();
    (isOn() ? turnOff() : turnOn()).catch(function (e) {
      message = e && e.status === 503 ? 'Reminders are not switched on for this site yet.' :
        'Could not turn reminders on' + (navigator.onLine ? '' : ' (no signal: try again when you are online)') + '. ' + ((e && e.message) || '');
    }).then(function () { busy = false; render(); });
  }

  /** assign.js calls this whenever the rotation may have changed (and every few minutes): keep the server's copy current. */
  function shiftsChanged() {
    if (!status || !status.configured || !isOn() || busy || !supported() || !eventKey()) { render(); return Promise.resolve(); }
    var stale = signature() !== ls('push_sig_' + eventKey()) || Date.now() - (Number(ls('push_sync_' + eventKey())) || 0) > RESYNC_MS;
    if (!stale || !navigator.onLine) { render(); return Promise.resolve(); }
    return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
      if (!sub || Notification.permission !== 'granted') {   // the phone no longer has the subscription: show the switch as off
        lsDel('push_on_' + eventKey()); lsDel('push_sig_' + eventKey());
        message = 'Reminders were switched off on this phone. Tap the switch to turn them on again.';
        return null;
      }
      return sync(sub);
    }).catch(function () { /* no signal: tried again at the next tick */ }).then(render);
  }

  /* ---------- the row ---------- */
  function row() {
    var el = document.getElementById('push-row');
    if (el) return el;
    var strip = document.getElementById('assign-strip');
    if (!strip || !strip.parentNode) return null;
    el = document.createElement('div'); el.id = 'push-row'; el.className = 'push-row hidden';
    strip.parentNode.insertBefore(el, strip.nextSibling);
    return el;
  }
  function explain() {
    if (!supported()) {
      if (isIOS() && !isInstalled()) return 'To get shift reminders on an iPhone, first add this app to your Home Screen: tap the Share button (the square with an arrow) in Safari, choose “Add to Home Screen”, then open Bobcat Scout from the new icon on your Home Screen and come back here. (iPhones need iOS 16.4 or newer.)';
      if (isIOS()) return 'This iPhone’s software is too old for reminders. They need iOS 16.4 or newer. The shift bar above still shows your next shift.';
      return 'This browser cannot send reminders. On Android, open the app in Chrome and use the menu → “Add to Home screen”. The shift bar above still shows your next shift.';
    }
    if (Notification.permission === 'denied' && !isOn()) return 'Notifications are blocked for this app, so reminders cannot work. To allow them: open your phone’s Settings, find this app (or your browser), tap Notifications, and turn them on. Then come back and tap the switch.';
    return '';
  }
  function render() {
    var el = row(); if (!el) return;
    if (!status || !status.configured || !eventKey() || (!shifts().length && !isOn())) { el.className = 'push-row hidden'; return; }
    var why = explain(), on = isOn();
    el.className = 'push-row';
    el.textContent = '';
    if (why) {
      var p = document.createElement('p'); p.className = 'push-note push-why'; p.textContent = why; el.appendChild(p);
      return;
    }
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'push-switch' + (on ? ' on' : ''); b.setAttribute('role', 'switch'); b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.disabled = busy;
    b.innerHTML = '<span class="push-knob" aria-hidden="true"></span><span class="push-label"></span>';
    b.querySelector('.push-label').textContent = busy ? 'Working…' : 'Remind me before my shift';
    b.addEventListener('click', toggle);
    el.appendChild(b);
    if (message) { var m = document.createElement('p'); m.className = 'push-note'; m.setAttribute('role', 'status'); m.textContent = message; el.appendChild(m); }
  }

  function refresh() { return loadStatus().then(function () { return shiftsChanged(); }).then(render); }
  function start() {
    render();
    refresh();
    setInterval(render, 15000);   // the strip appears when the first shifts arrive
    setInterval(function () { if (!status) loadStatus().then(render); }, 5 * 60 * 1000);
    window.addEventListener('online', function () { setTimeout(function () { shiftsChanged(); }, 2000); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.PUSH_UI = { render: render, refresh: refresh, shiftsChanged: shiftsChanged };
})();
