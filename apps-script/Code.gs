/* ==========================================================================
   BOBCAT SCOUT — Google Sheet submission endpoint (Google Apps Script)
   --------------------------------------------------------------------------
   Turns YOUR Google Sheet into a private inbox the Bobcat Scout app submits to.

   Tabs it manages:
     • Config    — settings the team lead controls (passcode, event/date gate, login)
     • Data      — one row per MATCH report (quantitative match scouting)
     • Pit       — one row per TEAM (qualitative pit scouting: robot capabilities)
     • Analytics — a LIVE per-team info guide (auto-updates from Data via formulas)

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

// ===== ANALYTICS — a live per-team info guide built from the Data tab =====
function buildAnalytics() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = getDataSheet_(ss);
  var an = ss.getSheetByName(ANALYTICS_SHEET) || ss.insertSheet(ANALYTICS_SHEET);
  an.clear();

  var team = colLetter_(data, 'teamNumber');
  var D = 'Data!';
  var teamCol = D + team + ':' + team;            // e.g. Data!E:E
  var rng = '$A$3:$A$202';                         // up to ~200 teams
  function avg(code) {
    var c = colLetter_(data, code);
    return 'ROUND(IFERROR(SUMIF(' + teamCol + ',' + rng + ',' + D + c + ':' + c + ')/COUNTIF(' + teamCol + ',' + rng + '),0),1)';
  }
  function cnt(code, val) {
    var c = colLetter_(data, code);
    return 'COUNTIFS(' + teamCol + ',' + rng + ',' + D + c + ':' + c + ',"' + val + '")';
  }
  var climb = colLetter_(data, 'endgameClimb');
  var climbCount = '(COUNTIFS(' + teamCol + ',' + rng + ',' + D + climb + ':' + climb + ',"level1")+COUNTIFS(' + teamCol + ',' + rng + ',' + D + climb + ':' + climb + ',"level2")+COUNTIFS(' + teamCol + ',' + rng + ',' + D + climb + ':' + climb + ',"level3"))';

  an.getRange('A1').setValue('TEAM ANALYTICS — live from the Data tab. Add matches and it updates automatically. Click a column, then Data → Sort to rank.')
    .setFontWeight('bold');
  var headers = ['Team', 'Matches', 'Avg Auto', 'Avg Teleop', 'Avg Total', 'Climb %', 'L3 Climbs', 'Avg Driver', 'Avg Defense', 'Died', 'Tipped', 'No-Show'];
  an.getRange(2, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#7B1F2B').setFontColor('#FFFFFF');
  an.setFrozenRows(2);

  var f = {
    A3: '=IFERROR(SORT(UNIQUE(FILTER(' + D + team + '2:' + team + ',' + D + team + '2:' + team + '<>""))),"")',
    B3: '=ARRAYFORMULA(IF(' + rng + '="","",COUNTIF(' + teamCol + ',' + rng + ')))',
    C3: '=ARRAYFORMULA(IF(' + rng + '="","",' + avg('autoHubMade') + '))',
    D3: '=ARRAYFORMULA(IF(' + rng + '="","",' + avg('teleopHubMade') + '))',
    E3: '=ARRAYFORMULA(IF(' + rng + '="","",IFERROR($C$3:$C$202+$D$3:$D$202,"")))',
    F3: '=ARRAYFORMULA(IF(' + rng + '="","",ROUND(IFERROR(' + climbCount + '/COUNTIF(' + teamCol + ',' + rng + '),0)*100,0)))',
    G3: '=ARRAYFORMULA(IF(' + rng + '="","",' + cnt('endgameClimb', 'level3') + '))',
    H3: '=ARRAYFORMULA(IF(' + rng + '="","",' + avg('driverSkill') + '))',
    I3: '=ARRAYFORMULA(IF(' + rng + '="","",' + avg('defenseRating') + '))',
    J3: '=ARRAYFORMULA(IF(' + rng + '="","",' + cnt('disabled', 'true') + '))',
    K3: '=ARRAYFORMULA(IF(' + rng + '="","",' + cnt('tipped', 'true') + '))',
    L3: '=ARRAYFORMULA(IF(' + rng + '="","",' + cnt('noShow', 'true') + '))'
  };
  Object.keys(f).forEach(function (cell) { an.getRange(cell).setFormula(f[cell]); });
  an.setColumnWidth(1, 70);
  return an;
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
