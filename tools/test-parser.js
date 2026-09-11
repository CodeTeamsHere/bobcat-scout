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
 * Add a case here whenever you change a pattern in parseTranscript.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'app.js');
const src = fs.readFileSync(SRC, 'utf8');

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

const BASE = {
  scoutName: '', eventKey: '', matchType: 'qm', matchNumber: '', teamNumber: '',
  alliance: '', driverStation: '', startingPosition: '', preloadedFuel: 0,
  autoHubMade: 0, autoLeft: false, autoClimb: '', teleopHubMade: 0,
  pickupEffectiveness: 0, passingEffectiveness: 0, pickedFromDepot: false,
  pickedFromHP: false, pickedFromFloor: false, endgameClimb: '', driverSkill: 0,
  defenseRating: 0, wasDefended: false, tipped: false, disabled: false,
  noShow: false, cardStatus: '', comments: ''
};

let pass = 0;
const failures = [];

/** expect: fields that must come out with these values.
 *  absent:  fields that must NOT have been filled in by the parser. */
function check(name, phrase, expect, absent) {
  const r = parseTranscript(phrase, Object.assign({}, BASE));
  const problems = [];
  for (const [k, v] of Object.entries(expect || {})) {
    if (r.fields[k] !== v) problems.push(`${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(r.fields[k])}`);
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
  'Scout name is Krish, event 2026ctwat, match 14, scouting team 177 red 2, preloaded 3 fuel. ' +
  'In auto they made 4 in the hub and left the line. Teleop 18 scored, pickup was pretty good, ' +
  'passing was amazing. Climbed the mid rung. Smooth driver.',
  // driverSkill is 4, not 5: "smooth" is the 4 tier, and "amazing" belongs to
  // the passing clause. Before the clause fix it leaked across and read 5.
  { scoutName: 'Krish', eventKey: '2026ctwat', matchNumber: 14, teamNumber: 177, alliance: 'red',
    driverStation: '2', preloadedFuel: 3, autoHubMade: 4, autoLeft: true, teleopHubMade: 18,
    endgameClimb: 'level2', driverSkill: 4, pickupEffectiveness: 4, passingEffectiveness: 5 });

check('spoken numbers throughout',
  'scouting team one seventy seven, match fourteen, they made four in auto and left the line, ' +
  'teleop eighteen scored, climbed high rung',
  { teamNumber: 177, matchNumber: 14, autoHubMade: 4, autoLeft: true, teleopHubMade: 18,
    endgameClimb: 'level3' });

check('terse call', '177 red 2 match 14 four in auto climbed high',
  { teamNumber: 177, alliance: 'red', driverStation: '2', matchNumber: 14, autoHubMade: 4,
    endgameClimb: 'level3' });

check('team number spoken in pairs', 'scouting team eleven fourteen on blue',
  { teamNumber: 1114, alliance: 'blue' });

// ---------------------------------------------------------------- climbing
// This is the phrasing on the pitch deck and the scouter handout; it has to work.
check('climbed high', 'team 1114 climbed high', { endgameClimb: 'level3' });
check('climbed mid', 'team 254 climbed mid', { endgameClimb: 'level2' });
check('climbed low', 'team 254 climbed low', { endgameClimb: 'level1' });
check('high rung', 'team 254 got the high rung', { endgameClimb: 'level3' });
check('level wording', 'team 254 hit level 2', { endgameClimb: 'level2' });
check('parked', 'team 254 just parked at the end', { endgameClimb: 'parked' });
check('no climb', 'team 118 did not climb', { endgameClimb: 'none' });

// ---------------------------------------------------------------- counts
check('count before the keyword', 'Team 177, 4 in auto, climbed high, driver was smooth',
  { teamNumber: 177, autoHubMade: 4, endgameClimb: 'level3', driverSkill: 4 });
check('count after the keyword', 'in auto they scored 5', { autoHubMade: 5 });
check('auto count does not land in teleop', 'team 2056 scored 2 in auto',
  { autoHubMade: 2 }, ['teleopHubMade']);
check('team number is not mistaken for a score', 'team 177 scored 3 in auto',
  { teamNumber: 177, autoHubMade: 3 });
check('teleop count before the keyword', 'team 177 put up 12 in teleop', { teleopHubMade: 12 });

// ------------------------------------------------------- false positives
check('"scored 3" is not a driver station', 'team 177 scored 3 in auto', {}, ['driverStation']);
check('"measured 2" is not a driver station', 'the drive team measured 2 cycles', {}, ['driverStation']);
check('started on the left is not a line cross', 'team 177 started on the left side in auto',
  {}, ['autoLeft']);
check('real driver station still works', 'team 177 blue 3', { alliance: 'blue', driverStation: '3' });
check('mobility still counts as leaving', 'auto mobility yes', { autoLeft: true });

// ---------------------------------------------------------------- states
check('robot died', 'team 118 match 9 blue 1, robot died halfway through teleop, no climb',
  { teamNumber: 118, matchNumber: 9, alliance: 'blue', driverStation: '1', disabled: true,
    endgameClimb: 'none' });
check('tipped over', 'team 118 tipped over in the trench', { tipped: true });
check('no show', 'team 118 was a no show', { noShow: true });
check('defense', 'team 2056 played great defense the whole match', { defenseRating: 5 });
check('driver praise does not leak from passing', 'passing was amazing, driver was rough',
  { driverSkill: 2 });

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
