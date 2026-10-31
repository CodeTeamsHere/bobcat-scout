/* A fake Google Sheet and Google Drive that run the real apps-script/Code.gs, for the tests
 * (tools/test-apps-script.js) and for trying the apps against a Sheet that isn't the team's
 * (tools/fake-sheet-server.js). Nothing here ever reaches Google.
 */
'use strict';
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
    clearContent() { for (let i = 0; i < nr; i++) { const row = sheet.rows[r - 1 + i]; if (row) for (let j = 0; j < nc; j++) row[c - 1 + j] = ''; } return range; },
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

// A fake Google Drive: folders and files with parents, enough for the pit photos.
function makeDrive() {
  const d = { folders: {}, files: {}, n: 0 };
  const fileObj = (f) => ({
    getId: () => f.id,
    getName: () => f.name,
    getDateCreated: () => new Date(f.created || 0),
    setTrashed(v) { f.trashed = !!v; },
    getParents() { let done = false; return { hasNext: () => !done, next: () => { done = true; return { getId: () => f.parent }; } }; },
    getBlob: () => ({ getContentType: () => f.mime, getBytes: () => f.bytes }),
  });
  const folderObj = (fo) => ({
    getId: () => fo.id,
    createFile(blob) {
      const id = 'file' + (++d.n) + 'abcdefghijkl';
      const f = { id, name: blob.name, bytes: blob.bytes, mime: blob.mime, parent: fo.id };
      d.files[id] = f; fo.files.push(id);
      return fileObj(f);
    },
    getFiles() {   // the folder's files that are not in the trash
      const list = fo.files.map((i) => d.files[i]).filter((f) => !f.trashed);
      let i = 0;
      return { hasNext: () => i < list.length, next: () => fileObj(list[i++]) };
    },
    getFilesByName(name) {
      const list = fo.files.map((i) => d.files[i]).filter((f) => f.name === name);
      let i = 0;
      return { hasNext: () => i < list.length, next: () => fileObj(list[i++]) };
    },
  });
  d.api = {
    createFolder(name) { const id = 'folder' + (++d.n) + 'abcdefghij'; d.folders[id] = { id, name, files: [] }; return folderObj(d.folders[id]); },
    getFolderById(id) { if (!d.folders[id]) throw new Error('no folder'); return folderObj(d.folders[id]); },
    getFileById(id) {
      if (id === 'the-spreadsheet') {   // the Sheet itself: it can be copied into a folder
        return { makeCopy(name, folder) { const f = { id: 'copy' + (++d.n) + 'abcdefghijkl', name, bytes: [], mime: 'application/vnd.google-apps.spreadsheet', parent: folder.getId(), created: (d.clock = (d.clock || 1000) + 1000) }; d.files[f.id] = f; d.folders[folder.getId()].files.push(f.id); return fileObj(f); } };
      }
      if (!d.files[id]) throw new Error('no file'); return fileObj(d.files[id]);
    },
  };
  // a private file elsewhere in the owner's Drive, which a photo request must never reach
  d.files.privateDocument12345 = { id: 'privateDocument12345', name: 'budget.xlsx', bytes: [1, 2, 3], mime: 'application/vnd.ms-excel', parent: 'someOtherFolder' };
  return d;
}

// Loads a fresh copy of Code.gs against an empty spreadsheet.
function freshScript() {
  const fakeDrive = makeDrive();
  const sheets = {};
  const props = {};
  const cache = {};
  const triggers = [];
  const ss = {
    getId: () => 'the-spreadsheet',
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
    DriveApp: fakeDrive.api,
    ScriptApp: {
      newTrigger: (fn) => ({ timeBased() { return { everyHours() { return { create() { triggers.push({ fn }); } }; } }; } }),
      getProjectTriggers: () => triggers.map((t) => ({ getHandlerFunction: () => t.fn, _t: t })),
      deleteTrigger: (t) => { const i = triggers.indexOf(t._t); if (i >= 0) triggers.splice(i, 1); },
    },
    CacheService: { getScriptCache: () => ({ get: (k) => (cache[k] === undefined ? null : cache[k]), put: (k, v) => { cache[k] = String(v); }, remove: (k) => { delete cache[k]; } }) },
    Utilities: {
      getUuid: () => require('crypto').randomUUID(),
      base64Decode: (b64) => Array.from(Buffer.from(b64, 'base64')),
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
      newBlob: (bytes, mime, name) => ({ bytes, mime, name }),
    },
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
  return { call, sheets, setConfig, drive: fakeDrive, props, cache, sandbox, ss, triggers, handle: (e) => sandbox.handle_(e) };
}

module.exports = { freshScript, PASS, READ_PASS };
