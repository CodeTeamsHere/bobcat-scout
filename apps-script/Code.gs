/* ==========================================================================
   BOBCAT SCOUT — Google Sheet submission endpoint (Google Apps Script)
   --------------------------------------------------------------------------
   Turns YOUR Google Sheet into a private inbox the Bobcat Scout app submits to.

   Tabs it manages:
     • Config    — settings the team lead controls (passcode, event/date gate, login)
     • Data      — one row per MATCH report (quantitative match scouting)
     • Pit       — one row per TEAM (qualitative pit scouting: robot capabilities)
     • Super     — one row per robot per match per super-scout (tags, driver rating, a note)

   It does no analysis itself: the Bobcat Scout Analytics app does that, reading the
   Data tab (below). Sheets set up before 2026-10 may still have an "Analytics" tab
   from older versions of this script; it is no longer updated and can be deleted.

   It enforces: passcode • event gate • date gate • validation • dedupe • stamping,
   plus optional Google-login lockdown with an email/domain allow-list.

   Pit photos go into a private folder in the Sheet owner's Google Drive ("Bobcat Scout pit
   photos"); the Pit row keeps their file ids. Scouts can only add photos (with the Passcode);
   only the Analytics app, with the Analytics Password, can read them back, and only files in
   that folder. The first time after this update, Google asks the owner to allow Drive access.

   It also answers the Bobcat Scout Analytics app, which reads the Data and Pit tabs
   back (a request with action "read"; it never writes). Reading needs the Config
   tab's Analytics Password, not the scouts' Passcode, so scouts can send matches
   but never read them. Leave Analytics Password blank and nothing can read.

   ----- ONE-TIME SETUP -----------------------------------------------------
   1. sheets.google.com → new blank spreadsheet.
   2. Extensions → Apps Script. Delete the sample, paste THIS FILE, save (💾).
   3. Run `firstTimeSetup` once (authorize when asked). Creates Config/Data/Pit/Super.
   4. Config tab → set Passcode (+ optional Active Event / dates / Google login),
      and an Analytics Password for the strategy team's Analytics app.
   5. Deploy → New deployment → Web app → Execute as: Me, Access: Anyone → copy /exec URL.
   6. App → ⚙ SHEET → paste URL + passcode → Save (or share the Copy Scout Link).

   ----- UPDATING THIS SCRIPT LATER ------------------------------------------
   Paste the new version over the old one and save (💾). Then Deploy → Manage
   deployments → ✏ (Edit) → Version: New version → Deploy. The /exec URL stays
   the same, so nothing in the apps needs changing. (Saving alone is not enough:
   the web app keeps running the old version until you deploy a new one.)

   ========================================================================== */

var DATA_SHEET = 'Data';
var PIT_SHEET = 'Pit';
var SUPER_SHEET = 'Super';                      // super-scout notes: one row per robot per match per super-scout
var CONFIG_SHEET = 'Config';
var META_COLS = ['_id', '_submittedAt', '_scoutEmail'];   // appended after the scouting fields

// Server-side validation ranges for MATCH data. Anything outside is rejected as junk.
var RANGES = {
  matchNumber: [1, 200], teamNumber: [1, 99999], preloadedFuel: [0, 50],
  autoHubMade: [0, 500], teleopHubMade: [0, 500], climbSeconds: [0, 160],
  pickupEffectiveness: [1, 5], passingEffectiveness: [1, 5], driverSkill: [1, 5], defenseRating: [1, 5]
};
var REQUIRED = ['scoutName', 'eventKey', 'matchNumber', 'teamNumber'];
var PIT_REQUIRED = ['scoutName', 'teamNumber'];
var PHOTO_FOLDER_NAME = 'Bobcat Scout pit photos';
var PHOTO_MAX_BASE64 = 3000000;                 // about 2.2 MB of image; the app sends ~0.3 MB
var PHOTO_MAX_PER_TEAM = 6;
var PHOTO_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
var KEEP_COLS = ['photoIds'];                   // a re-sent pit report never wipes these

// Run once from the editor to create all tabs.
function firstTimeSetup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  getConfigSheet_(ss);
  getDataSheet_(ss);
  getPitSheet_(ss);
  getSuperSheet_(ss);
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
    var action = String(data.action || '');
    if (action === 'read') {  // the Analytics app reading the data back
      checkReadGate_(data, cfg);
      return respond_({ ok: true, data: readRows_(DATA_SHEET, data.eventKey), pit: readRows_(PIT_SHEET, data.eventKey), sup: readRows_(SUPER_SHEET, data.eventKey) }, cb);
    }
    if (action === 'photo') {  // the Analytics app reading one pit photo (Analytics Password only)
      checkReadGate_(data, cfg);
      return respond_(readPhoto_(String(data.fileId || '')), cb);
    }
    if (action === 'pitPhoto') {  // a scout adding a pit photo (sent as a POST: too big for a link)
      checkGate_(data, cfg);
      return respond_(savePitPhoto_(data), cb);
    }
    if (action === 'pitCheck') {  // a scout's phone checking its photos arrived (the POST can't be read)
      checkGate_(data, cfg);
      var found = findPitRow_(data.eventKey, data.teamNumber);
      return respond_({ ok: true, exists: !!found, photos: found ? found.photoIds.length : 0 }, cb);
    }
    checkGate_(data, cfg);                       // passcode + login + event + dates
    if (String(data._form) === 'pit') {
      checkPit_(data);
      var rp = upsertRow_(data, PIT_SHEET, ['eventKey', 'teamNumber']);   // one pit row per team/event
      return respond_({ ok: true, action: rp.action, row: rp.row, form: 'pit' }, cb);
    }
    if (String(data._form) === 'super') {
      checkSuper_(data);
      var rs = upsertRow_(data, SUPER_SHEET, ['eventKey', 'matchNumber', 'teamNumber', 'scoutName']);   // one note per robot per match per super-scout
      return respond_({ ok: true, action: rs.action, row: rs.row, form: 'super' }, cb);
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
    readPasscode: String(map['analytics password'] || '').trim(),
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

// Reading has its own password, so the scouts' passcode (which every invite link carries) can
// send matches but never read them back. It skips the event and date gates: the strategy team
// reads after submissions close, and past events too. Off until an Analytics Password is set.
function checkReadGate_(d, cfg) {
  if (!cfg.readPasscode) throw new Error('No Analytics Password: add one to the Config tab to let the Analytics app read');
  if (cfg.requireLogin) verifyLogin_(d, cfg);
  if (String(d.passcode || '') !== cfg.readPasscode) throw new Error('Wrong analytics password');
}

// A tab's rows as { header: value } objects. Dates go out as ISO text, blank rows are skipped,
// and an eventKey keeps only that event's rows. Never creates or changes a tab.
function readRows_(sheetName, eventKey) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2 || sh.getLastColumn() < 1) return [];
  var values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  var header = values[0].map(function (h) { return String(h).trim(); });
  var evCol = header.indexOf('eventKey');
  var want = String(eventKey || '').trim().toLowerCase();
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (row.every(function (v) { return v === '' || v === null; })) continue;
    if (want && evCol >= 0 && String(row[evCol]).trim().toLowerCase() !== want) continue;
    var o = {};
    header.forEach(function (h, i) {
      if (h) o[h] = row[i] instanceof Date ? row[i].toISOString() : row[i];
    });
    out.push(o);
  }
  return out;
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

function checkSuper_(d) {
  requireFields_(d, ['scoutName', 'eventKey', 'matchNumber', 'teamNumber']);
  var m = Number(d.matchNumber), t = Number(d.teamNumber);
  if (isNaN(m) || m < 1 || m > 200) throw new Error('Bad match number: ' + d.matchNumber);
  if (isNaN(t) || t < 1 || t > 99999) throw new Error('Bad team number: ' + d.teamNumber);
  if (d.driverRating !== undefined && d.driverRating !== null && d.driverRating !== '') {
    var r = Number(d.driverRating);
    if (isNaN(r) || r < 1 || r > 5) throw new Error('Driver rating must be 1 to 5');
  }
  ['tags', 'note'].forEach(function (k) { if (String(d[k] === undefined || d[k] === null ? '' : d[k]).length > 400) throw new Error(k + ' is too long'); });
}

function requireFields_(d, list) {
  list.forEach(function (k) {
    if (d[k] === undefined || d[k] === null || String(d[k]).trim() === '') throw new Error('Missing required field: ' + k);
  });
}

function upsertRow_(d, sheetName, keyCols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = sheetName === PIT_SHEET ? getPitSheet_(ss) : (sheetName === SUPER_SHEET ? getSuperSheet_(ss) : getDataSheet_(ss));
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
      var old = sh.getRange(existing, 1, 1, row.length).getValues()[0];
      KEEP_COLS.forEach(function (code) {   // e.g. photo ids added separately: a re-sent report keeps them
        var i = header.indexOf(code);
        if (i >= 0 && (d[code] === undefined || d[code] === null || d[code] === '')) row[i] = old[i];
      });
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

// ---------------------------------------------------------------- pit photos
// The folder lives in the owner's Drive; its id is remembered so renaming or moving it is fine.
function getPhotoFolder_() {
  var props = PropertiesService.getDocumentProperties();
  var id = props.getProperty('PIT_PHOTO_FOLDER');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* deleted: make a new one */ } }
  var folder = DriveApp.createFolder(PHOTO_FOLDER_NAME);
  props.setProperty('PIT_PHOTO_FOLDER', folder.getId());
  return folder;
}

// The Pit row for a team at an event, with its photo ids, or null.
function findPitRow_(eventKey, teamNumber) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PIT_SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  var values = sh.getRange(1, 1, sh.getLastRow(), Math.max(1, sh.getLastColumn())).getValues();
  var header = values[0].map(function (h) { return String(h).trim(); });
  var ev = header.indexOf('eventKey'), tm = header.indexOf('teamNumber'), ph = header.indexOf('photoIds');
  var want = String(eventKey || '').trim().toLowerCase();
  for (var r = 1; r < values.length; r++) {
    if (tm < 0 || String(values[r][tm]).trim() !== String(teamNumber).trim()) continue;
    if (ev >= 0 && String(values[r][ev]).trim().toLowerCase() !== want) continue;
    var ids = ph >= 0 ? String(values[r][ph] || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean) : [];
    return { sheet: sh, row: r + 1, header: header, photoIds: ids };
  }
  return null;
}

function savePitPhoto_(d) {
  requireFields_(d, ['eventKey', 'teamNumber', 'scoutName', 'data']);
  var n = Number(d.teamNumber);
  if (isNaN(n) || n < 1 || n > 99999) throw new Error('Bad team number: ' + d.teamNumber);
  var mime = String(d.mime || 'image/jpeg').toLowerCase();
  if (!PHOTO_TYPES[mime]) throw new Error('Not a photo (' + mime + ')');
  var b64 = String(d.data).replace(/^data:[^,]*,/, '');
  if (b64.length > PHOTO_MAX_BASE64) throw new Error('Photo too big');
  if (!findPitRow_(d.eventKey, d.teamNumber)) {   // the photo arrived before the report: start the team's row
    upsertRow_({ eventKey: d.eventKey, teamNumber: d.teamNumber, scoutName: d.scoutName, _order: ['scoutName', 'eventKey', 'teamNumber', 'photoIds'], _id: 'pit_' + String(d.eventKey).toLowerCase() + '_' + n },
      PIT_SHEET, ['eventKey', 'teamNumber']);   // (takes and releases the lock itself, so it runs before ours)
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var found = findPitRow_(d.eventKey, d.teamNumber);
    if (!found) throw new Error('Could not start the pit row for this team');
    if (found.photoIds.length >= PHOTO_MAX_PER_TEAM) throw new Error('This team already has ' + PHOTO_MAX_PER_TEAM + ' photos');
    // the same photo sent twice (a retry) is saved once
    var tag = String(d.photoId || '');
    var folder = getPhotoFolder_();
    if (tag) {
      var same = folder.getFilesByName(String(d.eventKey).toLowerCase() + '_' + n + '_' + tag + '.' + PHOTO_TYPES[mime]);
      if (same.hasNext()) return { ok: true, fileId: same.next().getId(), photos: found.photoIds.length, duplicate: true };
    }
    var name = String(d.eventKey).toLowerCase() + '_' + n + '_' + (tag || new Date().getTime()) + '.' + PHOTO_TYPES[mime];
    var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(b64), mime, name));
    var ids = found.photoIds.concat([file.getId()]);
    var col = found.header.indexOf('photoIds');
    if (col < 0) {
      found.header.push('photoIds');
      col = found.header.length - 1;
      found.sheet.getRange(1, col + 1).setValue('photoIds').setFontWeight('bold');
    }
    found.sheet.getRange(found.row, col + 1).setValue(ids.join(','));
    return { ok: true, fileId: file.getId(), photos: ids.length };
  } finally {
    lock.releaseLock();
  }
}

// One photo, only if it is in the pit-photo folder (so the password can't read any other Drive file).
function readPhoto_(fileId) {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(fileId)) throw new Error('Bad photo id');
  var props = PropertiesService.getDocumentProperties();
  var folderId = props.getProperty('PIT_PHOTO_FOLDER');
  if (!folderId) throw new Error('No pit photos yet');
  var file;
  try { file = DriveApp.getFileById(fileId); } catch (e) { throw new Error('Photo not found'); }
  var parents = file.getParents(), inFolder = false;
  while (parents.hasNext()) if (parents.next().getId() === folderId) inFolder = true;
  if (!inFolder) throw new Error('Photo not found');
  var blob = file.getBlob();
  return { ok: true, mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

function getConfigSheet_(ss) {
  var sh = ss.getSheetByName(CONFIG_SHEET);
  if (sh) return sh;
  sh = ss.insertSheet(CONFIG_SHEET);
  sh.getRange('A1:B1').setValues([['Setting', 'Value']]).setFontWeight('bold');
  sh.getRange('A2:B10').setValues([
    ['Passcode', 'changeme'], ['Active Event', ''], ['Start Date', ''], ['End Date', ''],
    ['Require Google Login', 'no'], ['Google Client ID', ''], ['Allowed Domain', ''], ['Allowed Emails', ''],
    ['Analytics Password', '']
  ]);
  sh.getRange('A12').setValue('Tips: leave Active Event and dates blank to allow any event/day. The Passcode must match the app. ' +
    'Analytics Password lets the Analytics app read the data; give it only to the strategy team, never the scouts. ' +
    'For max security set "Require Google Login" to yes, paste your Google Client ID, and limit to an Allowed Domain or Allowed Emails list. See SETUP-SHEET.md.');
  sh.setColumnWidth(1, 130);
  sh.setColumnWidth(2, 220);
  return sh;
}

function getDataSheet_(ss) { return ss.getSheetByName(DATA_SHEET) || ss.insertSheet(DATA_SHEET); }
function getPitSheet_(ss) { return ss.getSheetByName(PIT_SHEET) || ss.insertSheet(PIT_SHEET); }
function getSuperSheet_(ss) { return ss.getSheetByName(SUPER_SHEET) || ss.insertSheet(SUPER_SHEET); }

function startOfDay_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0); }
function endOfDay_(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59); }
