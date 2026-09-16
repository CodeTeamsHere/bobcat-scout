/* Regression tests for the voice transcript parser.
 *
 *   node tools/test-parser.js
 *
 * The parser is the part of Bobcat Scout that fails quietly: a pattern that
 * stops matching does not throw, it just leaves a field blank or — worse —
 * fills the wrong one, and nobody notices until the data is already in the
 * spreadsheet. These cases are written the way scouters actually talk,
 * including the spelled-out numbers that browser speech recognition returns.
 *
 * Field codes here must match config.json. Add a case whenever you change a
 * pattern in parseTranscript.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

// The parser block is self-contained, so lift it out rather than loading the
// whole app (which expects a DOM).
const start = src.indexOf('const NUM_UNITS');
const end = src.indexOf('\n// =====================================================================\n// FIELD RENDERING');
if (start < 0 || end < 0) {
  console.error('Could not find the parser block in app.js — markers moved?');
  process.exit(1);
}
const { parseTranscript, normalizeNumberWords } = new Function(
  src.slice(start, end) + '\nreturn { parseTranscript, normalizeNumberWords };'
)();

// Build the blank state straight from config.json, so a field renamed in one
// place and not the other shows up here instead of at a competition.
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

let pass = 0;
const failures = [];

function eq(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v) => b.indexOf(v) >= 0);
  }
  return a === b;
}

/** expect: fields that must come out with these values.
 *  absent:  fields that must NOT have been filled in by the parser. */
function check(name, phrase, expect, absent) {
  const r = parseTranscript(phrase, blank());
  const problems = [];
  for (const [k, v] of Object.entries(expect || {})) {
    if (!CODES.has(k)) problems.push(`${k}: not a field in config.json`);
    else if (!eq(r.fields[k], v)) problems.push(`${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(r.fields[k])}`);
  }
  for (const k of absent || []) {
    if (r.confidence[k] !== undefined) problems.push(`${k}: should not have been filled, got ${JSON.stringify(r.fields[k])}`);
  }
  if (problems.length) failures.push({ name, phrase, problems });
  else pass++;
}

function checkNorm(name, input, expected) {
  const got = normalizeNumberWords(input);
  if (got !== expected) failures.push({ name, phrase: input, problems: [`expected "${expected}", got "${got}"`] });
  else pass++;
}

// ---------------------------------------------------------------- numbers
checkNorm('digits pass through', 'team 177 scored 4', 'team 177 scored 4');
checkNorm('simple count', 'made four in auto', 'made 4 in auto');
checkNorm('teen', 'scored eighteen', 'scored 18');
checkNorm('tens plus unit', 'scored twenty one in teleop', 'scored 21 in teleop');
checkNorm('frc team number', 'team one seventy seven', 'team 177');
checkNorm('frc paired reading', 'team eleven fourteen on blue', 'team 1114 on blue');
checkNorm('frc two fifty four', 'two fifty four was our partner', '254 was our partner');
checkNorm('hundred multiplier', 'team eleven hundred fourteen', 'team 1114');
checkNorm('pronoun one is left alone', 'no one climbed', 'no one climbed');
checkNorm('comma ends a run', 'team one seventy seven, match fourteen', 'team 177, match 14');

// ---------------------------------------------------------------- identity
check('full sample',
  'Scout name is Krish, event 2026ctwat, match 14, scouting team 177 red 2. ' +
  'In auto they scored 4 and picked up from the depot. Teleop they scored 18 shooting while driving, ' +
  'picked up off the floor and from the outpost chute. Pickup was pretty good, passing was amazing, ' +
  'about 60 percent. Played defense well. Went under the trench. Climbed the mid rung, ' +
  '2 alliance robots climbed. No issues.',
  { scoutName: 'Krish', eventKey: '2026ctwat', matchNumber: 14, teamNumber: 177,
    startingPosition: '2', alliance: 'red', autoFuel: 4, autoScored: true,
    autoPickupFrom: ['depot'], teleFuel: 18, teleHowScored: 'driving', teleScoringPct: 60,
    telePickupEff: 4, telePassingEff: 5, telePlayedDefense: 'yes', teleTrench: true,
    endClimbed: 'level2', endAllianceClimbs: 2 });

check('spoken numbers throughout',
  'scouting team one seventy seven, match fourteen, they scored four in auto, ' +
  'teleop eighteen scored, climbed high rung',
  { teamNumber: 177, matchNumber: 14, autoFuel: 4, teleFuel: 18, endClimbed: 'level3' });

check('terse call', '177 red 2 match 14 four in auto climbed high',
  { teamNumber: 177, startingPosition: '2', alliance: 'red', matchNumber: 14,
    autoFuel: 4, endClimbed: 'level3' });

check('blue maps to slots 4-6', 'team 1114 blue 1, climbed low',
  { teamNumber: 1114, startingPosition: '4', alliance: 'blue', endClimbed: 'level1' });

check('explicit starting position', 'team 254 starting position 6, no climb',
  { startingPosition: '6', alliance: 'blue', endClimbed: 'none' });

// ---------------------------------------------------------------- climbing
// This is the phrasing on the pitch deck and the scouter handout; it has to work.
check('climbed high', 'team 1114 climbed high', { endClimbed: 'level3' });
check('climbed mid', 'team 254 climbed mid', { endClimbed: 'level2' });
check('climbed low', 'team 254 climbed low', { endClimbed: 'level1' });
check('high rung', 'team 254 got the high rung', { endClimbed: 'level3' });
check('level wording', 'team 254 hit level 2', { endClimbed: 'level2' });
check('failed climb', 'team 254 tried to climb and fell off', { endClimbed: 'failed' });
check('no climb', 'team 118 did not climb', { endClimbed: 'none' });
check('auto climb', 'team 254 climbed level 1 in auto', { autoClimbed: 'level1' });
check('buddy climb', 'team 254 did a buddy climb in auto', { autoBuddyClimb: true });

// ---------------------------------------------------------------- counts
check('count before the keyword', 'Team 177, 4 in auto, climbed high',
  { teamNumber: 177, autoFuel: 4, autoScored: true, endClimbed: 'level3' });
check('count after the keyword', 'in auto they scored 5', { autoFuel: 5 });
check('auto count does not land in teleop', 'team 2056 scored 2 in auto',
  { autoFuel: 2 }, ['teleFuel']);
check('team number is not mistaken for a score', 'team 177 scored 3 in auto',
  { teamNumber: 177, autoFuel: 3 });
check('teleop count before the keyword', 'team 177 put up 12 in teleop', { teleFuel: 12 });

// ---------------------------------------------------- pickup and passing
check('pickup sources', 'team 177 picked up from the depot and the human player zone',
  { telePickupLoc: ['depot', 'hpzone'] });
check('passing targets', 'team 177 passed intentionally to the center',
  { telePassed: ['center', 'intentional'] });
check('no passing', 'team 177 did not pass all match', { telePassed: ['none'] });

// ---------------------------------------------------------------- defense
check('played defense', 'team 2056 played great defense the whole match',
  { telePlayedDefense: 'yes', teleDefenseEff: 5 });
check('attempted defense', 'team 2056 tried to play defense but could not catch anyone',
  { telePlayedDefense: 'attempted' });
check('defense praise does not leak from passing', 'passing was amazing, defense was rough',
  { teleDefenseEff: 2 });

// ------------------------------------------------------- false positives
check('"scored 3" is not a starting position', 'team 177 scored 3 in auto', {}, ['startingPosition']);
check('"measured 2" is not a starting position', 'the drive team measured 2 cycles', {}, ['startingPosition']);
check('real slot still works', 'team 177 blue 3', { startingPosition: '6', alliance: 'blue' });

// ---------------------------------------------------------------- states
check('robot died', 'team 118 match 9 blue 1, robot died halfway through teleop, no climb',
  { teamNumber: 118, matchNumber: 9, startingPosition: '4', alliance: 'blue',
    endDied: true, endClimbed: 'none' });
check('tipped over', 'team 118 tipped over in the trench', { endTipped: true });
check('mechanical issue', 'team 118 had a mechanical issue, intake jammed', { endMechIssue: true });
check('no show', 'team 118 was a no show', { noShow: true });
check('crossed zone', 'team 118 crossed into the opposite zone', { endCrossedZone: true });

// ---------------------------------------------------------------- report
if (failures.length) {
  console.log(`\n${pass} passed, ${failures.length} FAILED\n`);
  for (const f of failures) {
    console.log(`  x ${f.name}`);
    console.log(`    "${f.phrase}"`);
    for (const p of f.problems) console.log(`      - ${p}`);
    console.log('');
  }
  process.exit(1);
}
console.log(`\nAll ${pass} parser checks passed.\n`);
