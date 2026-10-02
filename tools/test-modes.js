/* Tests for the three ways to scout (scout-modes.js).
 *
 *   node tools/test-modes.js
 *
 * Way 2 shows only the boxes the app didn't hear; way 3 asks one question at a time and
 * moves on when it hears an answer. Both stand or fall on two things checked here:
 * turning a few spoken words into the right value for the field being asked about
 * (scouts say "uh, twelve", "left side by the depot", "nah"), and choosing what to ask
 * next (and what NOT to ask: no shooting spot after zero fuel, no climb spot without a climb).
 *
 * Field codes and option keys come from config.json, so a renamed field fails here.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const M = require('../scout-modes.js').SCOUT_MODES;

// The app's own spoken-number reader, lifted out of app.js the way test-parser.js does it.
const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const start = src.indexOf('const NUM_UNITS');
const end = src.indexOf('function parseTranscript');
const { normalizeNumberWords } = new Function(src.slice(start, end) + '\nreturn { normalizeNumberWords };')();
const ctx = { normalizeNumbers: normalizeNumberWords };

const ALL = cfg.sections.flatMap((s) => s.fields);
const byCode = Object.fromEntries(ALL.map((f) => [f.code, f]));
function blank() {
  const st = {};
  for (const f of ALL) {
    if (f.type === 'image') continue;
    if (f.type === 'multiselect') st[f.code] = [];
    else if (f.default !== undefined) st[f.code] = f.default;
    else if (f.type === 'boolean') st[f.code] = false;
    else st[f.code] = (f.type === 'number' || f.type === 'range' || f.type === 'counter') ? 0 : '';
  }
  return st;
}
const Q = {};
M.questions(cfg).forEach((q) => { Q[q.id] = q; });

let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) pass++;
  else failures.push(`${name}\n      ${detail}`);
}
function same(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v) => b.includes(v));
  return a === b;
}
// heard -> the values it must produce for that question (null = must not answer).
function says(id, heard, expect) {
  const q = Q[id];
  if (!q) { failures.push(`question ${id}\n      no such question (is the field in config.json?)`); return; }
  const r = M.answer(q, heard, ctx);
  if (expect === null) { check(`"${heard}" is not an answer to ${id}`, r === null, JSON.stringify(r && r.values)); return; }
  const got = r ? r.values : null;
  const ok = !!got && Object.entries(expect).every(([k, v]) => same(got[k], v));
  check(`"${heard}" -> ${JSON.stringify(expect)}`, ok, `got ${JSON.stringify(got)}`);
}

// ---- every guided question refers to a real field and real options ----
for (const [code, g] of Object.entries(M.GUIDE)) {
  check(`GUIDE.${code} is a field in config.json`, !!byCode[code], 'unknown field code');
  for (const key of Object.keys(g.words || {})) {
    const f = byCode[code];
    const ok = !f || f.type === 'boolean' ? key === 'true' : (f.options || []).some((o) => o.k === key);
    check(`GUIDE.${code}.words.${key} is one of its options`, ok, `options: ${(f && f.options || []).map((o) => o.k).join(', ')}`);
  }
}
const asked = new Set(M.questions(cfg).flatMap((q) => q.fields.map((f) => f.code)));
const unasked = ALL.filter((f) => f.type !== 'image' && !f.hidden && !asked.has(f.code) && !(M.GUIDE[f.code] || {}).never);
check('every field the scout fills in is asked about', unasked.length === 0, unasked.map((f) => f.code).join(', '));
check('every question has something to say', M.questions(cfg).every((q) => q.ask && q.ask.length > 3), 'a question has no prompt');

// ---- commands said on their own ----
for (const [heard, cmd] of [['skip', 'skip'], ['next', 'skip'], ["I don't know", 'skip'], ['go back', 'back'], ['repeat', 'repeat'],
  ['say that again', 'repeat'], ["I'm done", 'done'], ['finish', 'done'], ['stop', 'done'], ['none', null], ['done', null], ['twelve', null]]) {
  check(`"${heard}" is ${cmd ? 'the ' + cmd + ' command' : 'not a command'}`, M.command(heard) === cmd, String(M.command(heard)));
}

// ---- numbers ----
says('autoFuelScored', 'twelve', { autoFuelScored: 12 });
says('autoFuelScored', 'uh about 12 fuel', { autoFuelScored: 12 });
says('autoFuelScored', 'none', { autoFuelScored: 0 });
says('autoFuelScored', "they didn't score", { autoFuelScored: 0 });
says('autoFuelScored', 'a lot', null);
says('teleopFuelScored', 'forty five', { teleopFuelScored: 45 });
says('teamNumber', 'one seventy seven', { teamNumber: 177 });
says('teamNumber', 'eleven fourteen', { teamNumber: 1114 });
says('matchNumber', 'match fourteen', { matchNumber: 14 });

// ---- ratings and percents ----
says('pickupEffe', 'four', { pickupEffe: 4 });
says('pickupEffe', 'pretty good', { pickupEffe: 4 });
says('passingEffe', 'amazing', { passingEffe: 5 });
says('defenceEffe', 'poor', { defenceEffe: 2 });
says('scoringEffe', '60 percent', { scoringEffe: 60 });
says('scoringEffe', 'three', { scoringEffe: 60 });
says('scoringEffe', 'great', { scoringEffe: 100 });
says('AllianceClimb', 'two of them', { AllianceClimb: 2 });

// ---- yes / no ----
says('TrenchRizz', 'yes', { TrenchRizz: true });
says('TrenchRizz', 'yeah they did', { TrenchRizz: true });
says('TrenchRizz', 'nope', { TrenchRizz: false });
says('TrenchRizz', 'they did not', { TrenchRizz: false });
says('doubleClimb', 'they could', { doubleClimb: true });
says('noShow', 'yes', { noShow: false });
says('noShow', 'no show', { noShow: true });
says('noShow', "they're here", { noShow: false });
says('noShow', 'no', { noShow: true });

// ---- one option ----
says('startPos', 'three', { startPos: '3' });
says('startPos', '5', { startPos: '5' });
says('startPos', 'blue two', { startPos: '5' });
says('startPos', 'red one', { startPos: '1' });
says('scoringMannerismAuto', 'while driving', { scoringMannerismAuto: 'WHILE_DRIVE' });
says('scoringMannerismAuto', 'they were standing still', { scoringMannerismAuto: 'STATIONARY' });
says('scoringMannerismAuto', 'both', { scoringMannerismAuto: 'BOTH' });
says('scoringMannerismTele', "didn't score", { scoringMannerismTele: 'NONE' });
says('autoClimbed', 'yes', { autoClimbed: 'Success' });
says('autoClimbed', 'they tried but failed', { autoClimbed: 'Failed' });
says('autoClimbed', 'no', { autoClimbed: 'NA' });
says('autoClimbPos', 'left side', { autoClimbPos: 'LS' });
says('climbed', 'level two', { climbed: 'L2' });
says('climbed', 'high rung', { climbed: 'L3' });
says('climbed', 'level 1', { climbed: 'L1' });
says('climbed', 'they fell off', { climbed: 'F' });
says('climbed', 'no', { climbed: 'No' });
says('climbPos', 'in the middle', { climbPos: 'MD' });
says('robotDefended', 'they tried', { robotDefended: 'Attempted' });
says('robotDefended', 'yes', { robotDefended: 'Yes' });
says('climbed', 'banana', null);

// ---- several options ----
says('pickupfrom', 'depot and the floor', { pickupfrom: ['DEPOT', 'FLOOR'] });
says('pickupfrom', 'human player', { pickupfrom: ['H_Player'] });
says('pickupfrom', 'none', { pickupfrom: ['NONE'] });
says('pickupTele', 'floor, depot', { pickupTele: ['FLOOR', 'DEPOT'] });
says('fuelPassed', 'no', { fuelPassed: ['No_Passing'] });
says('fuelPassed', 'center and intentional', { fuelPassed: ['Center', 'Intentional'] });
says('fuelPassed', 'center intentional', { fuelPassed: ['Center', 'Intentional'] });
says('AutoPath', 'bump to trench', { AutoPath: ['Bump-Trench'] });
says('AutoPath', 'bump to trench same side', { AutoPath: ['Same Side Trench/Bump'] });
says('AutoPath', 'straight to depot', { AutoPath: ['Depot'] });
says('AutoPath', 'pre load only', { AutoPath: ['Pre-Load'] });
says('AutoPath', 'they did nothing', { AutoPath: ['N/A'] });
says('AutoSL', 'left side near the depot', { AutoSL: ['LSH/Depot'] });
says('AutoSL', 'middle near the tower', { AutoSL: ['MH/Tower'] });
says('TeleSL', 'right side near outpost', { TeleSL: ['RSH/Outpost'] });
says('TeleSL', "didn't shoot", { TeleSL: ['NS'] });

// ---- "which of these happened" ----
says('group:problems', 'it died and tipped over', { died: true, tipped: true, mechIssue: false, crossedZone: false });
says('group:problems', 'none', { died: false, tipped: false, mechIssue: false, crossedZone: false });
says('group:problems', 'no issues', { died: false, tipped: false, mechIssue: false, crossedZone: false });
says('group:problems', 'mechanical issue, the intake broke', { mechIssue: true, died: false });
says('group:problems', 'crossed into the opposite zone', { crossedZone: true });

// ---- free text ----
says('scoutName', 'my name is krish', { scoutName: 'Krish' });
says('co', 'none', { co: 'None' });
says('co', 'got a yellow card for pinning', { co: 'got a yellow card for pinning' });
says('eventKey', 'twenty twenty six c t w a t', { eventKey: '2026ctwat' });

// ---- extras: words for one period never fill its twin in the other ----
check('auto "How Scored" and teleop "How Scored" are twins', M.twinOf(Q.scoringMannerismAuto, byCode.scoringMannerismTele), 'not twins');
check('auto pickup and teleop pickup are twins', M.twinOf(Q.pickupfrom, byCode.pickupTele), 'not twins');
check('the auto climb and the endgame climb are twins', M.twinOf(Q.autoClimbed, byCode.climbed), 'not twins');
check('auto fuel and teleop fuel are twins', M.twinOf(Q.autoFuelScored, byCode.teleopFuelScored), 'not twins');
check('teleop fuel and the endgame climb are not', !M.twinOf(Q.teleopFuelScored, byCode.climbed), 'twins');

// ---- only a clearly added clause is searched for other boxes ----
for (const [heard, clause] of [['thirty and they climbed level two', 'they climbed level two'], ['twelve, also it tipped over', 'it tipped over'],
  ['left side near the depot', ''], ['while driving', ''], ['eight', '']]) {
  check(`extra clause of "${heard}" is "${clause}"`, M.extraClause(heard) === clause, JSON.stringify(M.extraClause(heard)));
}

// ---- what to ask next ----
function walk(fields, marks, ctxExtra) {
  const c = Object.assign({}, ctx, ctxExtra || {});
  const answered = M.answeredSet(cfg, fields, marks, c);
  Object.assign(fields, M.derive(cfg, fields, answered));
  const a2 = M.answeredSet(cfg, fields, Object.assign({}, marks, Object.fromEntries(Object.keys(M.derive(cfg, fields, answered)).map((k) => [k, 1]))), c);
  const q = M.nextQuestion(cfg, fields, Object.assign({}, answered, a2), {}, c);
  return q ? q.id : null;
}
{
  const f = blank();
  f.scoutName = 'Krish'; f.eventKey = '2026ctwat'; f.matchNumber = 14;
  check('name, event and match carry over, so the first question is the starting position', walk(f, {}) === 'startPos', walk(f, {}));
  check('on the first match of the day the match number is asked too', walk(f, {}, { askMatchNumber: true }) === 'matchNumber', walk(f, {}, { askMatchNumber: true }));
  const marks = { startPos: 1 };
  f.startPos = '2';
  check('after the position, the team (no schedule to fill it)', walk(f, marks) === 'teamNumber', walk(f, marks));
  marks.teamNumber = 1; f.teamNumber = 177;
  check('then whether the robot showed up', walk(f, marks) === 'noShow', walk(f, marks));
  marks.noShow = 1;
  check('then auto fuel (scored-in-auto is worked out from it, not asked)', walk(f, marks) === 'autoFuelScored', walk(f, marks));
  marks.autoFuelScored = 1; f.autoFuelScored = 0;
  check('zero auto fuel: no "how did they score", straight to pickup', walk(f, marks) === 'pickupfrom', walk(f, marks));
  check('...and the scoring style became None by itself', f.scoringMannerismAuto === 'NONE' && same(f.AutoSL, ['N/A']) && f.AutoScored === false,
    JSON.stringify({ s: f.scoringMannerismAuto, sl: f.AutoSL, a: f.AutoScored }));
  marks.pickupfrom = 1; f.pickupfrom = ['NONE'];
  check('then the auto climb', walk(f, marks) === 'autoClimbed', walk(f, marks));
  marks.autoClimbed = 1; f.autoClimbed = 'NA';
  check('no auto climb: no "where" or "with whom", on to the auto path', walk(f, marks) === 'AutoPath', walk(f, marks));
  f.noShow = true;
  check('a no-show skips straight to comments', walk(f, marks) === 'co', walk(f, marks));
}
{
  const f = blank();
  f.scoutName = 'K'; f.eventKey = '2026ctwat'; f.matchNumber = 3; f.teleopFuelScored = 30; f.climbed = 'No'; f.robotDefended = 'No';
  const answered = M.answeredSet(cfg, f, { teleopFuelScored: 1, climbed: 1, robotDefended: 1 }, ctx);
  check('no climb: "where did they climb" is not needed', !M.needed(byCode.climbPos, f, ctx, answered), 'still needed');
  check('no defense: "rate their defense" is not needed', !M.needed(byCode.defenceEffe, f, ctx, answered), 'still needed');
  check('fuel scored: "what percent went in" is needed', M.needed(byCode.scoringEffe, f, ctx, answered), 'not needed');
}

// ---- way 2: what is still open after listening ----
{
  const f = blank();
  f.scoutName = 'K'; f.eventKey = '2026ctwat'; f.matchNumber = 3; f.teamNumber = 177; f.startPos = '1'; f.autoFuelScored = 4; f.climbed = 'L2';
  const marks = { teamNumber: 1, startPos: 1, autoFuelScored: 1, climbed: 1 };
  const answered = M.answeredSet(cfg, f, marks, ctx);
  const g = M.gaps(cfg, f, ctx, answered);
  const must = g.must.map((x) => x.code), maybe = g.maybe.map((x) => x.code);
  check('heard fields are not listed again', !must.concat(maybe).some((c) => ['startPos', 'autoFuelScored', 'climbed', 'teamNumber', 'scoutName'].includes(c)), must.concat(maybe).join(', '));
  check('required ones not heard must be filled', ['scoringMannerismAuto', 'pickupfrom', 'autoClimbed', 'co'].every((c) => must.includes(c)), must.join(', '));
  check('optional ones not heard are offered, not demanded', ['teleopFuelScored', 'TrenchRizz', 'died'].every((c) => maybe.includes(c)), maybe.join(', '));
  check('a climb heard opens "where did they climb"', maybe.includes('climbPos'), maybe.join(', '));
  check('a field derived from another is not shown', !must.concat(maybe).some((c) => c === 'AutoScored' || c === 'AutoPickup'), must.concat(maybe).join(', '));
  const before = M.requiredGaps(cfg, f, ctx, answered).length;
  check('submitting is blocked while required boxes are empty', before > 0, String(before));
  for (const x of M.requiredGaps(cfg, f, ctx, answered)) {
    f[x.code] = x.type === 'multiselect' ? [x.options[0].k] : x.type === 'select' ? x.options.filter((o) => o.k)[0].k : 'x';
  }
  check('...and allowed once they are all filled', M.requiredGaps(cfg, f, ctx, M.answeredSet(cfg, f, marks, ctx)).length === 0,
    M.requiredGaps(cfg, f, ctx, answered).map((x) => x.code).join(', '));
  const ns = blank(); ns.scoutName = 'K'; ns.eventKey = 'e'; ns.matchNumber = 1; ns.teamNumber = 177; ns.noShow = true;
  check('a no-show only needs the identity boxes', M.requiredGaps(cfg, ns, ctx, {}).length === 0, M.requiredGaps(cfg, ns, ctx, {}).map((x) => x.code).join(', '));
}

if (failures.length) {
  console.log(`\n${pass} passed, ${failures.length} FAILED\n`);
  failures.forEach((f) => console.log('  x ' + f + '\n'));
  process.exit(1);
}
console.log(`\nAll ${pass} scouting-mode checks passed.\n`);
