/* How well does a spoken or typed match description fill the form?
 *
 *   node tools/test-voice.js            score every set, fail under the bar
 *   node tools/test-voice.js --misses   also print every miss, grouped by field
 *   node tools/test-voice.js --set blind-scout   only one set
 *
 * Three kinds of test:
 *   1. The dictionary (scout-lexicon.js): misheard words in, game words out, and real
 *      English left alone ("go to the depot" keeps its "to").
 *   2. Made-up matches (tools/voice-corpus.js): thousands of descriptions, written, spoken
 *      the way speech recognition returns them, misheard, and typed as shorthand.
 *   3. Hand-written sets in tools/voice-cases/*.json, including blind sets written by
 *      someone who never saw the parser. A set whose name has "holdout" in it is scored
 *      but its misses are never printed, so it stays an honest check.
 *
 * A case's score: one point for every field it expects that comes out right, and one for
 * every field it says must stay empty that does. Accuracy = points / possible points.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'scout-lexicon.js'));
const LEX = globalThis.SCOUT_LEXICON;
const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const start = src.indexOf('const NUM_UNITS');
const end = src.indexOf('\n// =====================================================================\n// FIELD RENDERING');
const { parseTranscript } = new Function(src.slice(start, end) + '\nreturn { parseTranscript };')();
const { generate } = require('./voice-corpus');

const BAR = 0.94;
const args = process.argv.slice(2);
const SHOW = args.includes('--misses');
const ONLY = args.includes('--set') ? args[args.indexOf('--set') + 1] : null;

const ALL = cfg.sections.flatMap((s) => s.fields);
const CODES = new Set(ALL.map((f) => f.code));
function blank() {
  const st = {};
  for (const f of ALL) {
    if (f.type === 'multiselect') st[f.code] = [];
    else if (f.default !== undefined) st[f.code] = f.default;
    else if (f.type === 'boolean') st[f.code] = false;
    else if (f.type === 'number' || f.type === 'range' || f.type === 'counter') st[f.code] = 0;
    else st[f.code] = '';
  }
  return st;
}
function same(a, b) {
  if (Array.isArray(b)) return Array.isArray(a) && a.length === b.length && b.every((v) => a.indexOf(v) >= 0);
  // eslint-disable-next-line eqeqeq
  return a === b || (typeof b === 'number' && Number(a) === b && a !== '');
}

// ------------------------------------------------------------------ 1. the dictionary
let lexPass = 0;
const lexFail = [];
function fixes(input, expected) {
  const got = LEX.fix(input);
  if (got === expected) lexPass++;
  else lexFail.push(`"${input}"\n      expected "${expected}"\n      got      "${got}"`);
}
fixes('in tele op they scored twenty', 'in teleop they scored twenty');
fixes('teleport they scored six', 'teleop they scored six');
fixes('telly op eighteen', 'teleop eighteen');
fixes('scored for in otto', 'scored four in auto');
fixes('for in auto', 'four in auto');
fixes('to in teleop', 'two in teleop');
fixes('red to', 'red two');
fixes('read to', 'red two');
fixes('read tree', 'red three');
fixes('blew won', 'blue one');
fixes('team won seventy seven', 'team one seventy seven');
fixes('team to fifty four', 'team two fifty four');
fixes('match for', 'match four');
fixes('they scored ate balls', 'they scored eight balls');
fixes('picked up from the depo', 'picked up from the depot');
fixes('picked up from the deep oh', 'picked up from the depot');
fixes('went to the out post', 'went to the outpost');
fixes('went under the french', 'went under the trench');
fixes('climbed the high wrong', 'climbed the high rung');
fixes('got the mid run', 'got the mid rung');
fixes('climbed level to', 'climbed level 2');
fixes('climbed level tree', 'climbed level 3');
fixes('climbed el two', 'climbed l2');
fixes('l three climb', 'l3 climb');
fixes('played the fence all match', 'played defense all match');
fixes('fed the human layer', 'fed the human player');
fixes('grabbed from the natural zone', 'grabbed from the neutral zone');
fixes('they were a know show', 'they were a no show');
fixes('r2 q14 4 auto', 'red 2 match 14 4 auto');
fixes('b3 m22', 'blue 3 match 22');
fixes('um they uh climbed', 'they climbed');
fixes('the robot brown out', 'the robot browned out');
fixes('they intook from the floor', 'they intake from the floor');
// real English that must survive
fixes('they went to the depot', 'they went to the depot');
fixes('looking for fuel', 'looking for fuel');
fixes('they got to the tower', 'they got to the tower');
fixes('drove to the outpost for more', 'drove to the outpost for more');
fixes('read the manual', 'read the manual');
fixes('the motor blew up', 'the motor blew up');
fixes('anything else to add', 'anything else to add');
fixes('one of them climbed', 'one of them climbed');
fixes('went for the high rung', 'went for the high rung');
fixes('passed to the center', 'passed to the center');
fixes('scored to the hub', 'scored to the hub');
fixes('the second run of auto', 'the second run of auto');
fixes('they tried to climb', 'they tried to climb');
fixes('red alliance', 'red alliance');

// picking among speech recognition's guesses for the same words
function picks(alts, expected) {
  const got = LEX.pickAlternative(alts.map((transcript) => ({ transcript })));
  if (got === expected) lexPass++;
  else lexFail.push(`guesses ${JSON.stringify(alts)}\n      expected "${expected}"\n      got      "${got}"`);
}
picks(['tell a cop they scored four', 'teleop they scored four'], 'teleop they scored four');
picks(['they climbed the hi wrong', 'they climbed the high rung'], 'they climbed the high rung');
picks(['they went to the depot', 'they went to the deep oh'], 'they went to the depot');
picks(['team one seventy seven', 'team won seventy seven'], 'team one seventy seven');
picks(['great match today', 'grade match to day'], 'great match today');
picks([], '');

// ------------------------------------------------------------------ 2 + 3. the sets
function runSet(name, cases) {
  const byField = {};
  const misses = [];
  let pts = 0, max = 0;
  const byStyle = {};
  for (const c of cases) {
    const r = parseTranscript(c.text, blank());
    let cp = 0, cm = 0;
    const why = [];
    for (const [k, v] of Object.entries(c.expect || {})) {
      if (!CODES.has(k)) { why.push(`${k}: not a field`); continue; }
      const ok = same(r.fields[k], v);
      byField[k] = byField[k] || { ok: 0, n: 0, fp: 0, fn: 0 };
      byField[k].n++; if (ok) byField[k].ok++;
      cm++; if (ok) cp++; else why.push(`${k}: want ${JSON.stringify(v)} got ${JSON.stringify(r.fields[k])}`);
    }
    for (const k of c.absent || []) {
      if (!CODES.has(k)) continue;
      const ok = r.confidence[k] === undefined;
      byField[k] = byField[k] || { ok: 0, n: 0, fp: 0, fn: 0 };
      byField[k].n++; if (ok) byField[k].ok++; else byField[k].fp++;
      cm++; if (ok) cp++; else why.push(`${k}: should be empty, got ${JSON.stringify(r.fields[k])}`);
    }
    pts += cp; max += cm;
    const s = c.style || 'all';
    byStyle[s] = byStyle[s] || [0, 0]; byStyle[s][0] += cp; byStyle[s][1] += cm;
    if (why.length) misses.push({ id: c.id, text: c.text, why });
  }
  return { name, pts, max, acc: max ? pts / max : 1, byField, byStyle, misses, cases: cases.length, perfect: cases.length - misses.length };
}

const sets = [];
if (!ONLY || ONLY === 'generated') sets.push(runSet('generated', generate(4000, 177)));
const dir = path.join(__dirname, 'voice-cases');
if (fs.existsSync(dir)) {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const name = f.replace(/\.json$/, '');
    if (ONLY && ONLY !== name) continue;
    sets.push(runSet(name, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))));
  }
}

const pct = (x) => (x * 100).toFixed(1) + '%';
console.log(`\nDictionary: ${lexPass}/${lexPass + lexFail.length} rewrites right`);
lexFail.forEach((f) => console.log('  x ' + f));
let failed = lexFail.length > 0;
for (const s of sets) {
  console.log(`\n${s.name}: ${pct(s.acc)} of ${s.max} field checks right · ${s.perfect}/${s.cases} descriptions fully right`);
  console.log('  by style: ' + Object.entries(s.byStyle).map(([k, v]) => `${k} ${pct(v[0] / v[1])}`).join(' · '));
  const worst = Object.entries(s.byField).sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n).slice(0, 8);
  console.log('  weakest fields: ' + worst.map(([k, v]) => `${k} ${pct(v.ok / v.n)} (${v.n})`).join(' · '));
  if (s.acc < BAR) failed = true;
  // A holdout set is only ever scored: tuning the parser on its misses would turn it into
  // one more set the parser was fitted to, and it couldn't tell us how real scouts will do.
  if (SHOW && !/holdout/.test(s.name)) {
    for (const m of s.misses.slice(0, 400)) console.log(`  - [${m.id}] "${m.text}"\n      ${m.why.join('\n      ')}`);
  }
}
console.log(failed ? `\nBELOW THE ${pct(BAR)} BAR (or a dictionary rewrite failed).\n` : `\nEvery set is at or above ${pct(BAR)}.\n`);
process.exit(failed ? 1 : 0);
