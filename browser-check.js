/* Tells a person with a very old browser what is wrong, instead of leaving a blank page.
 * Plain old JavaScript on purpose (it must run in the browsers the apps can't). Loaded first.
 * The apps need about: Chrome or Edge 90+, Firefox 88+, Safari 15+ (all from 2021 or later).
 */
(function () {
  var missing = [];
  try { new RegExp('a', 'd'); } catch (e) { missing.push('regular expression match positions'); }
  try { if (!(window.Promise && window.fetch && window.localStorage && Object.fromEntries && window.IntersectionObserver)) missing.push('modern web features'); } catch (e) { missing.push('browser storage (is private browsing blocking it?)'); }
  try { if (!(window.CSS && CSS.supports && CSS.supports('aspect-ratio', '1 / 1'))) missing.push('modern page layout'); } catch (e) { /* not fatal */ }
  if (!missing.length) return;
  window.addEventListener('DOMContentLoaded', function () {
    var d = document.createElement('div');
    d.setAttribute('role', 'alert');
    d.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#7B1F2B;color:#fff;padding:14px 16px;font:16px/1.4 system-ui,Arial,sans-serif';
    d.innerHTML = '<strong>This browser is too old for this app.</strong> It is missing: ' + missing.join(', ') + '. ' +
      'Please update it, or open this page in the latest <strong>Chrome</strong>, <strong>Edge</strong>, <strong>Firefox</strong> or <strong>Safari</strong>. Nothing you typed is lost.';
    document.body.appendChild(d);
  });
})();

/* Remembers the last thing that broke on this phone (a short message, never scouting data) so the
 * heartbeat can tell the lead: "Ben's app hit an error 12 minutes ago". Plain old JavaScript.
 * Only this site's own scripts are counted, not browser extensions.
 */
(function () {
  function clean(m) { return String(m || '').replace(/https?:[^\s)]*/g, '').replace(/\s+/g, ' ').slice(0, 110); }
  function remember(msg) {
    try {
      var old = JSON.parse(localStorage.getItem('last_error') || 'null');
      var n = (old && old.n ? old.n : 0) + 1;
      localStorage.setItem('last_error', JSON.stringify({ msg: clean(msg), at: new Date().getTime(), n: n }));
    } catch (e) { /* storage blocked: nothing to remember it in */ }
  }
  window.addEventListener('error', function (ev) {
    var f = ev && ev.filename ? String(ev.filename) : '';
    if (f && f.indexOf(location.origin) !== 0) return;
    remember((ev && ev.message) || 'Script error');
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev && ev.reason;
    remember('Promise: ' + ((r && r.message) || r || 'rejected'));
  });
})();
