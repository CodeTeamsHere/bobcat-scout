/* ==========================================================================
   BOBCAT SCOUT — Google Sheet submission endpoint (Google Apps Script)
   --------------------------------------------------------------------------
   This script turns YOUR Google Sheet into a private inbox that the Bobcat
   Scout app submits match data to — no scanning, straight into the Sheet.

   It enforces everything the team lead controls:
     • PASSCODE   — only the app carrying the right passcode can submit
     • EVENT GATE — optionally only accept one event key
     • DATE GATE  — optionally only accept during the event dates
     • VALIDATION — required fields + sane number ranges (junk is rejected)
     • DEDUPE     — same scout re-sending a match updates the row, never floods
     • STAMPING   — every row records who submitted and when

   ----- ONE-TIME SETUP (do this once) --------------------------------------
   1. Open https://sheets.google.com and create a new blank spreadsheet.
      Name it e.g. "Bobcat Scouting 2026".
   2. In the menu: Extensions → Apps Script. A code editor opens in a new tab.
   3. Delete whatever is in the editor, paste THIS ENTIRE FILE, click the
      save icon (💾).
   4. In the editor, run the function `firstTimeSetup` once:
        - pick `firstTimeSetup` in the function dropdown at the top → Run.
        - the first time, Google asks you to authorize — click through
          (Advanced → Go to project → Allow). This is normal for your own script.
      This creates two tabs in your Sheet: "Config" and "Data".
   5. Go back to the Sheet → open the "Config" tab and set:
        - Passcode      : make up a password (scouts' link will carry it)
        - Active Event  : e.g. 2026ctwat  (or leave blank to allow any event)
        - Start Date / End Date : optional; leave blank to allow any day
   6. Back in Apps Script: Deploy → New deployment → gear icon → "Web app".
        - Description : Bobcat Scout endpoint
        - Execute as  : Me
        - Who has access : Anyone
        - Deploy → copy the "Web app URL" (ends in /exec).
   7. Open the Bobcat Scout app → ⚙ SHEET → paste that URL + the same passcode
      → Save. (Or share a pre-filled link from that dialog with your scouts.)

   To re-open submissions for a NEW event later, just change the "Active Event"
   and dates in the Config tab — no code editing, no re-deploy needed.
   ========================================================================== */

var DATA_SHEET = 'Data';
var CONFIG_SHEET = 'Config';
var META_COLS = ['_id', '_submittedAt', '_scoutEmail'];   // appended after the scouting fields

// Server-side validation ranges. Anything outside these is rejected as junk.
var RANGES = {
  matchNumber: [1, 200],
  teamNumber: [1, 99999],
  preloadedFuel: [0, 50],
  autoHubMade: [0, 500],
  teleopHubMade: [0, 500],
  climbSeconds: [0, 160],
  pickupEffectiveness: [1, 5],
  passingEffectiveness: [1, 5],
  driverSkill: [1, 5],
  defenseRating: [1, 5]
};
var REQUIRED = ['scoutName', 'eventKey', 'matchNumber', 'teamNumber'];

// Run this once from the editor to create the Config + Data tabs.
function firstTimeSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  getConfigSheet_(ss);
  getDataSheet_(ss);
  SpreadsheetApp.getUi && SpreadsheetApp.flush();
}

// Both GET (used by the app via JSONP) and POST hit the same handler.
function doGet(e)  { return handle_(e); }
function doPost(e) { return handle_(e); }

function handle_(e) {
  var cb = e && e.parameter && e.parameter.callback;
  try {
    var data = readPayload_(e);
    var cfg = getConfig_();
    checkGate_(data, cfg);     // passcode + event + dates
    checkData_(data);          // required + ranges
    var res = upsertRow_(data);
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
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
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
  if (!cfg.passcode && !cfg.requireLogin) {
    throw new Error('Set a Passcode or enable Google login in the Config tab');
  }
  if (cfg.requireLogin) verifyLogin_(d, cfg);                 // throws if token invalid / not allowed
  if (cfg.passcode && String(d.passcode || '') !== cfg.passcode) throw new Error('Wrong passcode');
  if (cfg.activeEvent && String(d.eventKey || '').toLowerCase() !== cfg.activeEvent) {
    throw new Error('Submissions are not open for event "' + d.eventKey + '"');
  }
  var now = new Date();
  if (cfg.startDate && now < startOfDay_(cfg.startDate)) throw new Error('Event has not started yet');
  if (cfg.endDate && now > endOfDay_(cfg.endDate)) throw new Error('Event submissions are closed');
}

// Max-security mode: verify the Google ID token and that the account is allowed.
function verifyLogin_(d, cfg) {
  var token = String(d.idToken || '');
  if (!token) throw new Error('Google sign-in required');
  var resp = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true }
  );
  if (resp.getResponseCode() !== 200) throw new Error('Sign-in expired — please sign in again');
  var info = JSON.parse(resp.getContentText());
  if (cfg.clientId && info.aud !== cfg.clientId) throw new Error('Sign-in is not for this app');
  if (info.email_verified !== 'true' && info.email_verified !== true) throw new Error('Google email not verified');
  var email = String(info.email || '').toLowerCase();
  if (!email) throw new Error('No email on the sign-in');
  var ok = false;
  if (cfg.allowedDomain && email.slice(-(cfg.allowedDomain.length + 1)) === '@' + cfg.allowedDomain) ok = true;
  if (cfg.allowedEmails.length && cfg.allowedEmails.indexOf(email) !== -1) ok = true;
  if (!cfg.allowedDomain && !cfg.allowedEmails.length) ok = true;   // login required, but no allow-list → any Google account
  if (!ok) throw new Error('Account ' + email + ' is not on the allow-list');
  d.scoutEmail = email;                                   // stamped into the row for accountability
}

function checkData_(d) {
  REQUIRED.forEach(function (k) {
    if (d[k] === undefined || d[k] === null || String(d[k]).trim() === '') {
      throw new Error('Missing required field: ' + k);
    }
  });
  Object.keys(RANGES).forEach(function (k) {
    if (d[k] === undefined || d[k] === null || d[k] === '') return; // optional unless required
    var n = Number(d[k]);
    if (isNaN(n) || n < RANGES[k][0] || n > RANGES[k][1]) {
      throw new Error('Value out of range for ' + k + ': ' + d[k]);
    }
  });
}

function upsertRow_(d) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = getDataSheet_(ss);
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

    var existing = findExistingRow_(sh, header, d);
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

// Build/extend the header so it always covers the app's field order + meta cols.
function ensureHeader_(sh, d) {
  var order = Array.isArray(d._order) ? d._order.slice() : [];
  META_COLS.forEach(function (m) { if (order.indexOf(m) === -1) order.push(m); });

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, order.length).setValues([order]);
    sh.getRange(1, 1, 1, order.length).setFontWeight('bold');
    sh.setFrozenRows(1);
    return order;
  }
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h); });
  // Append any new codes that aren't in the sheet yet (schema can grow safely).
  order.forEach(function (code) {
    if (header.indexOf(code) === -1) {
      header.push(code);
      sh.getRange(1, header.length).setValue(code).setFontWeight('bold');
    }
  });
  return header;
}

// Dedupe: same submission id, or same (event, matchType, match, team, scout).
function findExistingRow_(sh, header, d) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var idCol = header.indexOf('_id');
  if (d._id && idCol >= 0) {
    var ids = sh.getRange(2, idCol + 1, last - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(d._id)) return i + 2;
  }
  var keyCols = ['eventKey', 'matchType', 'matchNumber', 'teamNumber', 'scoutName'];
  var idxs = keyCols.map(function (c) { return header.indexOf(c); });
  if (idxs.some(function (x) { return x < 0; })) return -1;
  var data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  for (var r = 0; r < data.length; r++) {
    var match = keyCols.every(function (c, j) {
      return String(data[r][idxs[j]]) === String(d[c] == null ? '' : d[c]);
    });
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

function getConfigSheet_(ss) {
  var sh = ss.getSheetByName(CONFIG_SHEET);
  if (sh) return sh;
  sh = ss.insertSheet(CONFIG_SHEET);
  sh.getRange('A1:B1').setValues([['Setting', 'Value']]).setFontWeight('bold');
  sh.getRange('A2:B9').setValues([
    ['Passcode', 'changeme'],
    ['Active Event', ''],
    ['Start Date', ''],
    ['End Date', ''],
    ['Require Google Login', 'no'],
    ['Google Client ID', ''],
    ['Allowed Domain', ''],
    ['Allowed Emails', '']
  ]);
  sh.getRange('A11').setValue(
    'Tips: leave Active Event and the dates blank to allow any event/day. The Passcode must match the app. ' +
    'For max security, set "Require Google Login" to yes, paste your Google Client ID, and limit to an Allowed Domain ' +
    '(e.g. team177.org) or a comma-separated Allowed Emails list. See SETUP-SHEET.md.'
  );
  sh.setColumnWidth(1, 130);
  sh.setColumnWidth(2, 220);
  return sh;
}

function getDataSheet_(ss) {
  return ss.getSheetByName(DATA_SHEET) || ss.insertSheet(DATA_SHEET);
}

function startOfDay_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0); }
function endOfDay_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59); }
