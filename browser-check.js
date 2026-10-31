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
