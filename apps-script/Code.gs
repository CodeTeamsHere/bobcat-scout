/* ==========================================================================
   BOBCAT SCOUT — Google Sheet submission endpoint (Google Apps Script)
   --------------------------------------------------------------------------
   Turns YOUR Google Sheet into a private inbox the Bobcat Scout app submits to.

   Tabs it manages:
     • Config    — settings the team lead controls (passcode, event/date gate, login)
     • Data      — one row per MATCH report (quantitative match scouting)
     • Pit       — one row per TEAM (qualitative pit scouting: robot capabilities)
     • Analytics — a LIVE per-team info guide that tunes itself to whatever game
                    the app is set to (the app sends a scoring model; formulas rebuild)

   It enforces: passcode • event gate • date gate • validation • dedupe • stamping,
   plus optional Google-login lockdown with an email/domain allow-list.

   ----- ONE-TIME SETUP -----------------------------------------------------
   1. sheets.google.com → new blank spreadsheet.
   2. Extensions → Apps Script. Delete the sample, paste THIS FILE, save (💾).
   3. Run `firstTimeSetup` once (authorize when asked). Creates Config/Data/Pit/Analytics.
   4. Config tab → set Passcode (+ optional Active Event / dates / Google login).
   5. Deploy → New deployment → Web app → Execute as: Me, Access: Anyone → copy /exec URL.
   6. App → ⚙ SHEET → paste URL + passcode → Save (or share the Copy Scout Link).

   The "Bobcat Scout" menu (top of the Sheet) has "Rebuild Analytics" if you ever need it.
   ========================================================================== */

var DATA_SHEET = 'Data';
var PIT_SHEET = 'Pit';
var CONFIG_SHEET = 'Config';
var ANALYTICS_SHEET = 'Analytics';
var META_COLS = ['_id', '_submittedAt', '_scoutEmail'];   // appended after the scouting fields

// Server-side validation ranges for MATCH data. Anything outside is rejected as junk.
var RANGES = {
  matchNumber: [1, 200], teamNumber: [1, 99999], preloadedFuel: [0, 50],
  autoHubMade: [0, 500], teleopHubMade: [0, 500], climbSeconds: [0, 160],
  pickupEffectiveness: [1, 5], passingEffectiveness: [1, 5], driverSkill: [1, 5], defenseRating: [1, 5]
};
var REQUIRED = ['scoutName', 'eventKey', 'matchNumber', 'teamNumber'];
var PIT_REQUIRED = ['scoutName', 'teamNumber'];

// Fallback field order (used only to locate columns if the Data header isn't readable yet).
var EXPECTED_FIELDS = ['scoutName', 'eventKey', 'matchNumber', 'matchType', 'teamNumber', 'alliance',
  'driverStation', 'noShow', 'startingPosition', 'preloadedFuel', 'autoLeft', 'autoHubMade', 'autoClimb',
  'teleopHubMade', 'pickedFromDepot', 'pickedFromHP', 'pickedFromFloor', 'pickupEffectiveness',
  'passingEffectiveness', 'endgameClimb', 'climbSeconds', 'driverSkill', 'defenseRating', 'wasDefended',
  'tipped', 'disabled', 'cardStatus', 'comments'];

// Scoring model the Analytics tab tunes itself to. The app sends `_scoring` (per game);
// we remember the latest in Document Properties and fall back to this REBUILT default
// so older sheets (and the very first build) still work.
var REBUILT_MODEL = [
  { code: 'autoHubMade', title: 'Auto Fuel', type: 'number', points: 1 },
  { code: 'autoLeft', title: 'Auto Leave', type: 'boolean', points: 3 },
  { code: 'autoClimb', title: 'Auto Climb', type: 'select', optionPoints: { level1: 15 } },
  { code: 'teleopHubMade', title: 'Teleop Fuel', type: 'number', points: 1 },
  { code: 'endgameClimb', title: 'Endgame Climb', type: 'select', optionPoints: { parked: 2, level1: 10, level2: 20, level3: 30 } },
  { code: 'pickupEffectiveness', title: 'Pickup', type: 'range' },
  { code: 'passingEffectiveness', title: 'Passing', type: 'range' },
  { code: 'driverSkill', title: 'Driver Skill', type: 'range' },
  { code: 'defenseRating', title: 'Defense', type: 'range' },
  { code: 'noShow', title: 'No-Show', type: 'boolean', fail: true },
  { code: 'tipped', title: 'Tipped', type: 'boolean', fail: true },
  { code: 'disabled', title: 'Died', type: 'boolean', fail: true }
];

function getScoringModel_() {
  try {
    var raw = PropertiesService.getDocumentProperties().getProperty('scoringModel');
    if (raw) { var m = JSON.parse(raw); if (Array.isArray(m) && m.length) return m; }
  } catch (e) {}
  return REBUILT_MODEL;
}

// Remember the latest scoring model the app sent; return true if it CHANGED (→ rebuild).
function maybeUpdateModel_(data) {
  try {
    var incoming = data._scoring;
    if (typeof incoming === 'string') incoming = JSON.parse(incoming);
    if (!Array.isArray(incoming) || !incoming.length) return false;
    var props = PropertiesService.getDocumentProperties();
    var next = JSON.stringify(incoming);
    if (props.getProperty('scoringModel') === next) return false;
    props.setProperty('scoringModel', next);
    return true;
  } catch (e) { return false; }
}

// A "Bobcat Scout" menu appears at the top of the Sheet.
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('Bobcat Scout')
      .addItem('Rebuild Analytics', 'buildAnalytics')
      .addToUi();
  } catch (e) {}
}

// Run once from the editor to create all tabs.
function firstTimeSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  getConfigSheet_(ss);
  getDataSheet_(ss);
  getPitSheet_(ss);
  buildAnalytics();
  SpreadsheetApp.flush();
}

// Both GET (used by the app via JSONP) and POST hit the same handler.
function doGet(e)  { return handle_(e); }
function doPost(e) { return handle_(e); }

function handle_(e) {
  var cb = e && e.parameter && e.parameter.callback;
  try {
    var data = readPayload_(e);
    var cfg = getConfig_();
    checkGate_(data, cfg);                       // passcode + login + event + dates
    if (String(data._form) === 'pit') {
      checkPit_(data);
      var rp = upsertRow_(data, PIT_SHEET, ['eventKey', 'teamNumber']);   // one pit row per team/event
      return respond_({ ok: true, action: rp.action, row: rp.row, form: 'pit' }, cb);
    }
    checkData_(data);
    var res = upsertRow_(data, DATA_SHEET, ['eventKey', 'matchType', 'matchNumber', 'teamNumber', 'scoutName']);
    if (maybeUpdateModel_(data)) { try { buildAnalytics(); } catch (e) {} }   // game changed → re-tune the Analytics tab
    return respond_({ ok: true, action: res.action, row: res.row }, cb);
  } catch (err) {
    return respond_({ ok: false, error: String((err && err.message) || err) }, cb);
  }
}

function readPayload_(e) {
  if (e && e.postData && e.postData.contents) return JSON.parse(e.postData.contents);
  if (e && e.parameter && e.parameter.data) return JSON.parse(e.parameter.data);
  throw new Error('No data received');
}

function respond_(obj, cb) {
  var json = JSON.stringify(obj);
  if (cb) {
    return ContentService.createTextOutput(cb + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function getConfig_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = getConfigSheet_(ss);
  var rows = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 2).getValues();
  var map = {};
  rows.forEach(function (r) { if (r[0]) map[String(r[0]).trim().toLowerCase()] = r[1]; });
  return {
    passcode: String(map['passcode'] || '').trim(),
    activeEvent: String(map['active event'] || '').trim().toLowerCase(),
    startDate: map['start date'] instanceof Date ? map['start date'] : null,
    endDate: map['end date'] instanceof Date ? map['end date'] : null,
    requireLogin: /^(yes|true|1)$/i.test(String(map['require google login'] || '').trim()),
    clientId: String(map['google client id'] || '').trim(),
    allowedDomain: String(map['allowed domain'] || '').trim().toLowerCase(),
    allowedEmails: String(map['allowed emails'] || '').split(',').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean)
  };
}

function checkGate_(d, cfg) {
  if (!cfg.passcode && !cfg.requireLogin) throw new Error('Set a Passcode or enable Google login in the Config tab');
  if (cfg.requireLogin) verifyLogin_(d, cfg);
  if (cfg.passcode && String(d.passcode || '') !== cfg.passcode) throw new Error('Wrong passcode');
  if (cfg.activeEvent && String(d.eventKey || '').toLowerCase() !== cfg.activeEvent) {
    throw new Error('Submissions are not open for event "' + d.eventKey + '"');
  }
  var now = new Date();
  if (cfg.startDate && now < startOfDay_(cfg.startDate)) throw new Error('Event has not started yet');
  if (cfg.endDate && now > endOfDay_(cfg.endDate)) throw new Error('Event submissions are closed');
}

function verifyLogin_(d, cfg) {
  var token = String(d.idToken || '');
  if (!token) throw new Error('Google sign-in required');
  var resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('Sign-in expired — please sign in again');
  var info = JSON.parse(resp.getContentText());
  if (cfg.clientId && info.aud !== cfg.clientId) throw new Error('Sign-in is not for this app');
  if (info.email_verified !== 'true' && info.email_verified !== true) throw new Error('Google email not verified');
  var email = String(info.email || '').toLowerCase();
  if (!email) throw new Error('No email on the sign-in');
  var ok = false;
  if (cfg.allowedDomain && email.slice(-(cfg.allowedDomain.length + 1)) === '@' + cfg.allowedDomain) ok = true;
  if (cfg.allowedEmails.length && cfg.allowedEmails.indexOf(email) !== -1) ok = true;
  if (!cfg.allowedDomain && !cfg.allowedEmails.length) ok = true;
  if (!ok) throw new Error('Account ' + email + ' is not on the allow-list');
  d.scoutEmail = email;
}

function checkData_(d) {
  requireFields_(d, REQUIRED);
  Object.keys(RANGES).forEach(function (k) {
    if (d[k] === undefined || d[k] === null || d[k] === '') return;
    var n = Number(d[k]);
    if (isNaN(n) || n < RANGES[k][0] || n > RANGES[k][1]) throw new Error('Value out of range for ' + k + ': ' + d[k]);
  });
}

function checkPit_(d) {
  requireFields_(d, PIT_REQUIRED);
  var n = Number(d.teamNumber);
  if (isNaN(n) || n < 1 || n > 99999) throw new Error('Bad team number: ' + d.teamNumber);
}

function requireFields_(d, list) {
  list.forEach(function (k) {
    if (d[k] === undefined || d[k] === null || String(d[k]).trim() === '') throw new Error('Missing required field: ' + k);
  });
}

function upsertRow_(d, sheetName, keyCols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = sheetName === PIT_SHEET ? getPitSheet_(ss) : getDataSheet_(ss);
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var header = ensureHeader_(sh, d);
    var row = header.map(function (code) {
      if (code === '_submittedAt') return new Date();
      if (code === '_id') return d._id || '';
      if (code === '_scoutEmail') return d.scoutEmail || '';
      return formatVal_(d[code]);
    });
    var existing = findExistingRow_(sh, header, d, keyCols);
    if (existing > 0) {
      sh.getRange(existing, 1, 1, row.length).setValues([row]);
      return { action: 'updated', row: existing };
    }
    sh.appendRow(row);
    return { action: 'added', row: sh.getLastRow() };
  } finally {
    lock.releaseLock();
  }
}

function ensureHeader_(sh, d) {
  var order = Array.isArray(d._order) ? d._order.slice() : [];
  META_COLS.forEach(function (m) { if (order.indexOf(m) === -1) order.push(m); });
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, order.length).setValues([order]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return order;
  }
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h); });
  order.forEach(function (code) {
    if (header.indexOf(code) === -1) {
      header.push(code);
      sh.getRange(1, header.length).setValue(code).setFontWeight('bold');
    }
  });
  return header;
}

// Dedupe: same submission id first, else the given key columns.
function findExistingRow_(sh, header, d, keyCols) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var idCol = header.indexOf('_id');
  if (d._id && idCol >= 0) {
    var ids = sh.getRange(2, idCol + 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(d._id)) return i + 2;
  }
  var idxs = keyCols.map(function (c) { return header.indexOf(c); });
  if (idxs.some(function (x) { return x < 0; })) return -1;
  var data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  for (var r = 0; r < data.length; r++) {
    var match = keyCols.every(function (c, j) { return String(data[r][idxs[j]]) === String(d[c] == null ? '' : d[c]); });
    if (match) return r + 2;
  }
  return -1;
}

function formatVal_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.join(',');
  return v;
}

// ===== ANALYTICS — a live per-team info guide, tuned to THIS game's scoring model =====
// Columns are generated from the model the app sent (see getScoringModel_): a weighted
// "Avg Total Pts", an average for each counted scoring field, average points from each
// tiered (select) field, average of each rating slider, and a count for each breakdown.
// All live ARRAYFORMULAs over the Data tab, so they keep updating as matches arrive.
function buildAnalytics() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = getDataSheet_(ss);
  var an = ss.getSheetByName(ANALYTICS_SHEET) || ss.insertSheet(ANALYTICS_SHEET);
  an.clear();

  var model = getScoringModel_();
  var present = dataHeaderCodes_(data);
  function has(code) { return present.length === 0 || present.indexOf(code) !== -1; }

  var team = colLetter_(data, 'teamNumber');
  var D = 'Data!';
  var teamCol = D + team + ':' + team;            // e.g. Data!E:E
  var rng = '$A$3:$A$202';                         // up to ~200 teams
  var countTeam = 'COUNTIF(' + teamCol + ',' + rng + ')';
  function colRef(code) { var c = colLetter_(data, code); return D + c + ':' + c; }
  function avgNum(code) { return 'IFERROR(SUMIF(' + teamCol + ',' + rng + ',' + colRef(code) + ')/' + countTeam + ',0)'; }
  function boolRate(code) { return 'IFERROR(COUNTIFS(' + teamCol + ',' + rng + ',' + colRef(code) + ',"true")/' + countTeam + ',0)'; }
  function boolCount(code) { return 'COUNTIFS(' + teamCol + ',' + rng + ',' + colRef(code) + ',"true")'; }
  function selectAvgPts(field) {
    var c = colRef(field.code), terms = [];
    Object.keys(field.optionPoints || {}).forEach(function (opt) {
      var p = Number(field.optionPoints[opt]) || 0; if (!p) return;
      terms.push(p + '*COUNTIFS(' + teamCol + ',' + rng + ',' + c + ',"' + String(opt).replace(/"/g, '') + '")');
    });
    return terms.length ? 'IFERROR((' + terms.join('+') + ')/' + countTeam + ',0)' : '0';
  }
  function contrib(field) {           // a field's average point contribution per match
    if (!has(field.code)) return null;
    if (field.type === 'select' && field.optionPoints) return selectAvgPts(field);
    if (field.type === 'boolean' && field.points != null) return '(' + (Number(field.points) || 0) + '*' + boolRate(field.code) + ')';
    if ((field.type === 'number' || field.type === 'range') && field.points != null) return '(' + (Number(field.points) || 0) + '*' + avgNum(field.code) + ')';
    return null;
  }

  var headers = ['Team', 'Matches', 'Avg Total Pts'];
  var exprs = [
    '=IFERROR(SORT(UNIQUE(FILTER(' + D + team + '2:' + team + ',' + D + team + '2:' + team + '<>""))),"")',
    '=ARRAYFORMULA(IF(' + rng + '="","",' + countTeam + '))',
    ''
  ];
  var totalTerms = model.map(contrib).filter(function (x) { return x; });
  exprs[2] = '=ARRAYFORMULA(IF(' + rng + '="","",ROUND(' + (totalTerms.length ? totalTerms.join('+') : '0') + ',1)))';

  function addCol(title, expr) { headers.push(title); exprs.push('=ARRAYFORMULA(IF(' + rng + '="","",' + expr + '))'); }
  model.forEach(function (f) { if (has(f.code) && f.type === 'number' && f.points != null) addCol('Avg ' + f.title, 'ROUND(' + avgNum(f.code) + ',1)'); });
  model.forEach(function (f) { if (has(f.code) && f.type === 'select' && f.optionPoints) addCol('Avg ' + f.title + ' Pts', 'ROUND(' + selectAvgPts(f) + ',1)'); });
  model.forEach(function (f) { if (has(f.code) && f.type === 'range' && f.points == null) addCol('Avg ' + f.title, 'ROUND(' + avgNum(f.code) + ',1)'); });
  model.forEach(function (f) { if (has(f.code) && f.fail) addCol(f.title + ' #', boolCount(f.code)); });

  an.getRange('A1').setValue('TEAM ANALYTICS — live from the Data tab, tuned to this season’s scoring. Add matches and it updates automatically. Click a column header, then Data → Sort sheet by column to rank.')
    .setFontWeight('bold');
  an.getRange(2, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#7B1F2B').setFontColor('#FFFFFF');
  an.setFrozenRows(2);
  for (var i = 0; i < exprs.length; i++) an.getRange(3, i + 1).setFormula(exprs[i]);
  an.setColumnWidth(1, 70);
  return an;
}

// The field codes currently in the Data tab header (so we don't build formulas for absent columns).
function dataHeaderCodes_(sh) {
  if (sh.getLastColumn() < 1 || sh.getLastRow() < 1) return [];
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

// Column letter for a field code: prefer the live Data header, fall back to EXPECTED_FIELDS.
function colLetter_(sh, code) {
  var idx = -1;
  if (sh.getLastColumn() > 0 && sh.getLastRow() > 0) {
    var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    idx = header.indexOf(code);
  }
  if (idx < 0) idx = EXPECTED_FIELDS.indexOf(code);
  if (idx < 0) idx = 0;
  return columnToLetter_(idx + 1);
}
function columnToLetter_(col) {
  var s = '';
  while (col > 0) { var m = (col - 1) % 26; s = String.fromCharCode(65 + m) + s; col = Math.floor((col - 1) / 26); }
  return s;
}

function getConfigSheet_(ss) {
  var sh = ss.getSheetByName(CONFIG_SHEET);
  if (sh) return sh;
  sh = ss.insertSheet(CONFIG_SHEET);
  sh.getRange('A1:B1').setValues([['Setting', 'Value']]).setFontWeight('bold');
  sh.getRange('A2:B9').setValues([
    ['Passcode', 'changeme'], ['Active Event', ''], ['Start Date', ''], ['End Date', ''],
    ['Require Google Login', 'no'], ['Google Client ID', ''], ['Allowed Domain', ''], ['Allowed Emails', '']
  ]);
  sh.getRange('A11').setValue('Tips: leave Active Event and dates blank to allow any event/day. The Passcode must match the app. ' +
    'For max security set "Require Google Login" to yes, paste your Google Client ID, and limit to an Allowed Domain or Allowed Emails list. See SETUP-SHEET.md.');
  sh.setColumnWidth(1, 130);
  sh.setColumnWidth(2, 220);
  return sh;
}

function getDataSheet_(ss) { return ss.getSheetByName(DATA_SHEET) || ss.insertSheet(DATA_SHEET); }
function getPitSheet_(ss) { return ss.getSheetByName(PIT_SHEET) || ss.insertSheet(PIT_SHEET); }

function startOfDay_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0); }
function endOfDay_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59); }
