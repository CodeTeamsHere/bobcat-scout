/* Tests for the Google Sheet script (apps-script/Code.gs), run against a fake Sheet.
 *
 *   node tools/test-apps-script.js
 *
 * The script only runs inside Google, where a mistake shows up as a scout's match that
 * never arrived, or an Analytics app that reads nothing. This loads Code.gs with stand-ins
 * for Google's services and checks both jobs: saving what the scouting app sends, and
 * answering the Analytics app's "read" with those rows, only for the Analytics Password
 * (never the scouts' passcode, which every invite link carries).
 *
 * The fake Sheet stores values the way a real one does: text like "true" or "12" typed
 * into a cell becomes a tick box value or a number.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PASS = 'test-password';          // the scouts' passcode
const READ_PASS = 'test-read-password'; // the strategy team's Analytics Password

// ---------------------------------------------------------------- a fake Sheet
function asStored(v) {
  if (typeof v !== 'string') return v;
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  if (v.trim() !== '' && !isNaN(Number(v))) return Number(v);
  return v;
}

function makeRange(sheet, r, c, nr, nc) {
  const range = {
    getValues() {
      const out = [];
      for (let i = 0; i < nr; i++) {
        const row = sheet.rows[r - 1 + i] || [];
        const o = [];
        for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]);
        out.push(o);
      }
      return out;
    },
    setValues(vals) {
      vals.forEach((row, i) => {
        const target = sheet.rows[r - 1 + i] || (sheet.rows[r - 1 + i] = []);
        row.forEach((v, j) => { target[c - 1 + j] = asStored(v); });
      });
      return range;
    },
    setValue(v) { return range.setValues([[v]]); },
    setFormula(f) { return range.setValues([[f]]); },
    setFontWeight() { return range; },
    setBackground() { return range; },
    setFontColor() { return range; },
  };
  return range;
}

function colNumber(letters) {
  return letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}

function makeSheet(name) {
  const sheet = {
    name,
    rows: [],
    getLastRow() {
      let last = 0;
      sheet.rows.forEach((row, i) => { if (row && row.some((v) => v !== '' && v != null)) last = i + 1; });
      return last;
    },
    getLastColumn() {
      let last = 0;
      sheet.rows.forEach((row) => (row || []).forEach((v, j) => { if (v !== '' && v != null) last = Math.max(last, j + 1); }));
      return last;
    },
    getRange(a, b, nr, nc) {
      if (typeof a === 'string') {
        const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a);
        const c1 = colNumber(m[1]), r1 = Number(m[2]);
        const c2 = m[3] ? colNumber(m[3]) : c1, r2 = m[4] ? Number(m[4]) : r1;
        return makeRange(sheet, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
      }
      return makeRange(sheet, a, b, nr || 1, nc || 1);
    },
    appendRow(values) { sheet.rows[sheet.getLastRow()] = values.map(asStored); },
    clear() { sheet.rows.length = 0; },
    setFrozenRows() {},
    setColumnWidth() {},
  };
  return sheet;
}

// Loads a fresh copy of Code.gs against an empty spreadsheet.
function freshScript() {
  const sheets = {};
  const props = {};
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n)),
  };
  const sandbox = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush() {} },
    ContentService: {
      createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
      MimeType: { JAVASCRIPT: 'javascript', JSON: 'json' },
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: {
      getDocumentProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; } }),
    },
    UrlFetchApp: { fetch() { throw new Error('the tests never reach Google'); } },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps-script', 'Code.gs'), 'utf8'), sandbox, { filename: 'Code.gs' });

  // The Config tab, with a known password.
  const config = sandbox.getConfigSheet_(ss);
  function setConfig(name, value) {
    const row = config.rows.findIndex((r) => r && String(r[0]).toLowerCase() === name.toLowerCase());
    config.rows[row][1] = value;
  }
  setConfig('Passcode', PASS);
  setConfig('Analytics Password', READ_PASS);

  // Same shape as a JSONP call: ?callback=cb&data=<json>
  function call(payload) {
    const out = sandbox.handle_({ parameter: { callback: 'cb', data: JSON.stringify(payload) } });
    const m = /^cb\(([\s\S]*)\)$/.exec(out.text);
    if (!m) throw new Error('not a JSONP answer: ' + out.text.slice(0, 80));
    return JSON.parse(m[1]);
  }
  return { call, sheets, setConfig };
}

// ---------------------------------------------------------------- checks
let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) pass++;
  else failures.push({ name, detail });
}

const ORDER = ['scoutName', 'eventKey', 'matchNumber', 'matchType', 'teamNumber', 'alliance',
  'AutoScored', 'autoFuelScored', 'climbed', 'died', 'comments'];
let nextId = 1;
function match(over) {
  return Object.assign({
    passcode: PASS, _order: ORDER, _id: 'm' + nextId++,
    scoutName: 'Ada', eventKey: '2026ctwat', matchNumber: 1, matchType: 'qm', teamNumber: 177,
    alliance: 'red', AutoScored: true, autoFuelScored: 6, climbed: 'L2', died: false, comments: 'fast',
  }, over);
}

// ---- saving what the scouting app sends still works
{
  const s = freshScript();
  const a = s.call(match({}));
  check('a match report is saved', a.ok && a.action === 'added', JSON.stringify(a));
  const again = s.call(match({ _id: 'm1', autoFuelScored: 9 }));
  check('sending the same match again updates it', again.ok && again.action === 'updated', JSON.stringify(again));
  const wrong = s.call(match({ passcode: 'nope' }));
  check('a match with the wrong password is turned away', !wrong.ok && /wrong passcode/i.test(wrong.error), JSON.stringify(wrong));
}

// ---- reading it back
{
  const s = freshScript();
  s.call(match({ teamNumber: 177, matchNumber: 1 }));
  s.call(match({ teamNumber: 254, matchNumber: 1, alliance: 'blue', died: true }));
  s.call(match({ teamNumber: 118, matchNumber: 2, eventKey: '2026ctsou' }));
  s.call({ passcode: PASS, _form: 'pit', _order: ['scoutName', 'eventKey', 'teamNumber', 'drivetrain'],
    scoutName: 'Ada', eventKey: '2026ctwat', teamNumber: 177, drivetrain: 'swerve' });
  s.call(match({ teamNumber: 999, matchNumber: 9 }));
  s.call(match({ teamNumber: 195, matchNumber: 3 }));
  // Someone cleared a row's contents, leaving a blank row in the middle of the tab.
  const cleared = s.sheets.Data.rows.findIndex((r) => r && r.includes(999));
  s.sheets.Data.rows[cleared] = s.sheets.Data.rows[cleared].map(() => '');

  const before = JSON.stringify(s.sheets.Data.rows);
  const all = s.call({ action: 'read', passcode: READ_PASS, eventKey: '' });
  check('the right password reads every match', all.ok && all.data.length === 4, JSON.stringify(all).slice(0, 200));
  check('pit reports come back too', all.ok && all.pit.length === 1 && all.pit[0].drivetrain === 'swerve', JSON.stringify(all.pit));
  check('reading changes nothing in the Sheet', JSON.stringify(s.sheets.Data.rows) === before, 'the Data tab changed during a read');

  const row = (all.data || []).find((r) => r.teamNumber === 254) || {};
  check('each row is keyed by field code', row.scoutName === 'Ada' && row.alliance === 'blue', JSON.stringify(row));
  check('numbers come back as numbers', row.autoFuelScored === 6 && row.matchNumber === 1, JSON.stringify(row));
  check('tick boxes come back as true/false', row.died === true && row.AutoScored === true, JSON.stringify(row));
  check('the time it arrived comes back as text', typeof row._submittedAt === 'string' && !isNaN(Date.parse(row._submittedAt)),
    String(row._submittedAt));

  const one = s.call({ action: 'read', passcode: READ_PASS, eventKey: '2026CTWAT' });
  check('an event code keeps only that event (any capitals)', one.ok && one.data.length === 3 &&
    one.data.every((r) => r.eventKey === '2026ctwat'), JSON.stringify(one).slice(0, 200));

  const wrong = s.call({ action: 'read', passcode: 'nope' });
  check('a wrong password reads nothing', !wrong.ok && /wrong analytics password/i.test(wrong.error) && !wrong.data,
    JSON.stringify(wrong));
  const scout = s.call({ action: 'read', passcode: PASS });
  check('the scouts\' passcode reads nothing', !scout.ok && !scout.data, JSON.stringify(scout));
  const send = s.call(match({ passcode: READ_PASS, _id: 'from-analytics' }));
  check('the Analytics Password cannot send matches', !send.ok, JSON.stringify(send));
  const none = s.call({ action: 'read' });
  check('no password reads nothing', !none.ok && !none.data, JSON.stringify(none));
}

// ---- the event and date gates only stop saving, not reading
{
  const s = freshScript();
  s.call(match({}));
  s.setConfig('Active Event', '2026ctsou');
  s.setConfig('End Date', new Date(2020, 0, 1));
  const save = s.call(match({ _id: 'late' }));
  check('saving is closed by the event gate', !save.ok, JSON.stringify(save));
  const read = s.call({ action: 'read', passcode: READ_PASS, eventKey: '2026ctwat' });
  check('reading still works after submissions close', read.ok && read.data.length === 1, JSON.stringify(read));
}

// ---- Google login, if switched on, applies to reading too
{
  const s = freshScript();
  s.setConfig('Require Google Login', 'yes');
  const read = s.call({ action: 'read', passcode: READ_PASS });
  check('a read needs Google sign-in when the Sheet requires it', !read.ok && /google sign-in/i.test(read.error), JSON.stringify(read));
}

// ---- nothing can read until an Analytics Password is set
{
  const s = freshScript();
  s.call(match({}));
  s.setConfig('Analytics Password', '');
  const blank = s.call({ action: 'read', passcode: '' });
  check('with no Analytics Password, a blank password reads nothing', !blank.ok && /no analytics password/i.test(blank.error),
    JSON.stringify(blank));
  const scout = s.call({ action: 'read', passcode: PASS });
  check('with no Analytics Password, the scouts\' passcode reads nothing', !scout.ok && !scout.data, JSON.stringify(scout));
}

// ---- a Sheet made before the Analytics Password existed has no row for it
{
  const s = freshScript();
  const config = s.sheets.Config;
  const row = config.rows.findIndex((r) => r && r[0] === 'Analytics Password');
  config.rows[row] = ['', ''];
  const read = s.call({ action: 'read', passcode: '' });
  check('an old Config tab reads nothing', !read.ok && /no analytics password/i.test(read.error), JSON.stringify(read));
}

// ---- a brand-new Sheet reads as empty and is left alone
{
  const s = freshScript();
  const read = s.call({ action: 'read', passcode: READ_PASS });
  check('an empty Sheet reads as no rows', read.ok && read.data.length === 0 && read.pit.length === 0, JSON.stringify(read));
  check('reading never creates a tab', !s.sheets.Data && !s.sheets.Pit, Object.keys(s.sheets).join(', '));
}

// ---------------------------------------------------------------- report
if (failures.length) {
  console.log(`\n${pass} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.log(`  x ${f.name}\n      ${f.detail}\n`);
  process.exit(1);
}
console.log(`\nAll ${pass} Sheet script checks passed.\n`);
