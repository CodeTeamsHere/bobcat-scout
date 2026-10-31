'use strict';
/* A pretend team Sheet on this computer, for trying the scouting and Analytics apps without
 * touching the real one. It runs the real apps-script/Code.gs against the fake Sheet and Drive
 * from tools/fake-google.js, and answers the way Google does: GET with ?callback= (JSONP) and POST.
 *
 *   node tools/fake-sheet-server.js [port]      (default 8099)
 *
 * Then, in the app's page (browser devtools), point it here:
 *   sheetEndpoint = 'http://127.0.0.1:8099/exec'; sheetPasscode = 'test-password';
 * The Analytics Password for reading is 'test-read-password'. GET /state shows what was saved.
 */
const http = require('http');
const { freshScript, PASS, READ_PASS } = require('./fake-google');

const port = Number(process.argv[2] || 8099);
const s = freshScript();

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/state') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    const files = Object.values(s.drive.files).filter((f) => f.parent !== 'someOtherFolder').map((f) => ({ id: f.id, name: f.name, bytes: f.bytes.length, mime: f.mime }));
    return res.end(JSON.stringify({ sheets: Object.fromEntries(Object.entries(s.sheets).map(([k, v]) => [k, v.rows])), files }, null, 1));
  }
  if (url.pathname === '/admin/people') {   // fake-only: fill the People tab and switch personal codes on or off, e.g. ?on=1&people=Ada:ABC234:scout,Bo:LEAD77:lead
    const sh = s.sandbox.getPeopleSheet_(s.ss);
    (url.searchParams.get('people') || '').split(',').filter(Boolean).forEach((p) => { const [n, c, r, a] = p.split(':'); sh.appendRow([n, c, r || 'scout', a || 'yes', '']); });
    s.setConfig('Personal Codes', url.searchParams.get('on') === '1' ? 'yes' : 'no');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({ ok: true, personal: s.sandbox.getConfig_().personal }));
  }
  if (url.pathname !== '/exec') { res.writeHead(404); return res.end(); }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const e = { parameter: Object.fromEntries(url.searchParams) };
    if (req.method === 'POST') e.postData = { contents: body };
    let out;
    try { out = s.handle(e); } catch (err) { out = { text: JSON.stringify({ ok: false, error: String(err.message || err) }) }; }
    const cb = e.parameter.callback;
    res.writeHead(200, { 'Content-Type': cb ? 'application/javascript' : 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(out.text);
    const what = req.method === 'POST' ? (() => { try { const d = JSON.parse(body); return d.action || d._form || 'match'; } catch (x) { return 'post'; } })() : (() => { try { const d = JSON.parse(e.parameter.data || '{}'); return d.action || d._form || 'match'; } catch (x) { return 'get'; } })();
    console.log(new Date().toISOString().slice(11, 19), req.method, what, '->', out.text.slice(cb ? cb.length + 1 : 0, (cb ? cb.length + 1 : 0) + 90));
  });
}).listen(port, '127.0.0.1', () => console.log('Fake Sheet on http://127.0.0.1:' + port + '/exec  (passcode ' + PASS + ', Analytics Password ' + READ_PASS + ')'));
