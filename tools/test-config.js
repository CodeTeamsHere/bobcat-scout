/* Guard against publishing private values.
 *
 *   node tools/test-config.js
 *
 * team-config.js is served to the browser, and this repository is public, so
 * anything in that file is readable by anyone — permanently, because git keeps
 * history. This check fails the build if a value that should stay private is
 * about to be committed.
 *
 * Deliberately publishing one anyway? Put  // PUBLISH-OK  at the end of that
 * line. That makes it a decision someone made on purpose rather than something
 * that slipped through.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'team-config.js');
const src = fs.readFileSync(FILE, 'utf8');

// Only look at the settings object, not the instructions above it, so an
// example passcode written in a comment does not trip the check.
const start = src.indexOf('window.TEAM_CONFIG');
const body = start >= 0 ? src.slice(start) : src;

function valueOf(key) {
  const m = new RegExp(key + "\\s*:\\s*'([^']*)'\\s*,?\\s*(//.*)?").exec(body);
  if (!m) return null;
  return { value: m[1], comment: m[2] || '' };
}

const problems = [];
const notes = [];

// --- does the file even load? --------------------------------------------
// A typo here does not throw anywhere you would see it: the script fails to
// load, window.TEAM_CONFIG never exists, the preset silently does not apply,
// and the settings page reappears for every scouter. The classic one is
// putting the comma after the comment —  key: 'x'  // PUBLISH-OK,  — which
// swallows the comma and breaks the object.
let loaded = null;
try {
  const sandbox = { window: {} };
  new Function('window', src + '\nreturn window.TEAM_CONFIG;')(sandbox.window);
  loaded = new Function('window', src + '\nreturn window.TEAM_CONFIG;')(sandbox.window);
  if (!loaded || typeof loaded !== 'object') {
    problems.push('team-config.js loaded but did not set window.TEAM_CONFIG to an object.');
  }
} catch (e) {
  problems.push(
    'team-config.js is not valid JavaScript, so the app would ignore it entirely ' +
    'and show every scouter the settings page. ' + e.message +
    "\n      Most likely a misplaced comma. It goes BEFORE the comment:" +
    "\n          tbaKey: 'yourkey',  // PUBLISH-OK      <-- right" +
    "\n          tbaKey: 'yourkey'   // PUBLISH-OK,     <-- wrong"
  );
}

if (loaded) {
  for (const k of ['sheetUrl', 'passcode', 'eventKey', 'tbaKey', 'googleClientId']) {
    if (!(k in loaded)) problems.push(`team-config.js is missing the "${k}" setting.`);
  }
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s) in team-config.js:\n`);
  for (const p of problems) console.log('  x ' + p);
  console.log('');
  process.exit(1);
}

// --- things that must never be published ---------------------------------
for (const [key, why] of [
  ['passcode', 'Anyone who finds this repo could then submit rows. Leave it blank and send it in the invite link instead: python tools/make-invite-link.py'],
  ['tbaKey', 'It is tied to your Blue Alliance account. Leave it blank and send it in the invite link instead: python tools/make-invite-link.py']
]) {
  const f = valueOf(key);
  if (!f) continue;
  if (f.value && !/PUBLISH-OK/.test(f.comment)) {
    problems.push(`${key} is set and would be published. ${why}`);
  } else if (f.value) {
    notes.push(`${key} is set and marked PUBLISH-OK — published on purpose.`);
  }
}

// --- things that are fine to publish, but must be consistent -------------
const sheetUrl = valueOf('sheetUrl');
if (sheetUrl && sheetUrl.value && !/\/exec$/.test(sheetUrl.value)) {
  problems.push('sheetUrl does not end in /exec. Copy the Web app URL from Deploy > Manage deployments, not the editor address.');
}

// The Sheet rejects everything when it requires Google login and the app has
// no client ID to sign in with, so catch that pairing here.
const clientId = valueOf('googleClientId');
if (clientId && !clientId.value) {
  notes.push('googleClientId is empty. That is only OK if the Sheet\'s Config tab has "Require Google Login" set to no — otherwise every submission is rejected with "Google sign-in required".');
}

if (notes.length) {
  console.log('');
  for (const n of notes) console.log('  note: ' + n);
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s) in team-config.js — this repository is PUBLIC:\n`);
  for (const p of problems) console.log('  x ' + p);
  console.log('\nSee SETUP-ONCE.md, "Read this before you publish".\n');
  process.exit(1);
}

console.log('\nteam-config.js is safe to publish.\n');
