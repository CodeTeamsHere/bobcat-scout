'use strict';
/* Checks for the scout assignment strip's logic (assign-core.js).
 *
 *   node tools/test-assign.js
 */
const A = require('../assign-core.js');

let pass = 0; const fails = [];
function check(name, got, want) { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
function ok(name, cond, detail) { if (cond) pass++; else fails.push(`${name}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); }

const sched = { matches: { 1: { red: ['frc177', 'frc254', 'frc1678'], blue: ['frc118', 'frc2056', 'frc973'] }, 9: { red: ['frc1', 'frc2', 'frc3'], blue: ['frc4', 'frc5', 'frc6'] } } };
const shifts = [{ from: 9, to: 12, station: 'B2' }, { from: 1, to: 4, station: 'R2' }, { from: 5, to: 8, station: 'BREAK' }];

check('a station in a match is a team', [A.teamAt(sched, 1, 'R1'), A.teamAt(sched, 1, 'B3'), A.teamAt(sched, 9, 'B2')], ['177', '973', '5']);
check('no schedule, no match, no such station', [A.teamAt(null, 1, 'R1'), A.teamAt(sched, 77, 'R1'), A.teamAt(sched, 1, 'BREAK'), A.teamAt(sched, 1, 'X1')], ['', '', '', '']);
check('station names', [A.stationName('R1'), A.stationName('B3'), A.stationName('BREAK')], ['Red 1', 'Blue 3', 'a break']);

// ---- which shift is next (the match after the last one sent) ----
check('nothing sent yet: the first shift is now', [A.nextShift(shifts, 0).state, A.nextShift(shifts, 0).shift.station, A.nextShift(shifts, 0).match], ['now', 'R2', 1]);
check('in the middle of a shift', [A.nextShift(shifts, 2).state, A.nextShift(shifts, 2).match], ['now', 3]);
check('the last match of a shift was sent: the break is next, and it is "now"', [A.nextShift(shifts, 4).state, A.nextShift(shifts, 4).shift.station], ['now', 'BREAK']);
check('after the break the next scouting shift is "now" at its first match', [A.nextShift(shifts, 8).state, A.nextShift(shifts, 8).shift.station, A.nextShift(shifts, 8).match], ['now', 'B2', 9]);
check('a gap before the next shift is "later"', A.nextShift([{ from: 20, to: 22, station: 'R1' }], 3).state, 'later');
check('a shift only a few matches away is still "later", not forgotten', [A.nextShift([{ from: 5, to: 6, station: 'R1' }], 2).state, A.nextShift([{ from: 5, to: 6, station: 'R1' }], 2).match], ['later', 5]);
check('all shifts finished', A.nextShift(shifts, 12).state, 'done');
check('no shifts', [A.nextShift([], 0).state, A.nextShift(null, 0).state], ['none', 'none']);
check('a shift with its numbers backwards is ignored', A.nextShift([{ from: 5, to: 2, station: 'R1' }], 0).state, 'none');
check('a last match that is not a number counts as none', A.nextShift(shifts, 'abc').match, 1);

// ---- the words ----
check('now, with a team from the schedule', A.stripText(A.nextShift(shifts, 0), sched), 'Scout Red 2 (team 254) in Q1, through Q4.');
check('now, last match of the shift', A.stripText(A.nextShift([{ from: 1, to: 1, station: 'R1' }], 0), sched), 'Scout Red 1 (team 177) in Q1.');
check('now, no schedule loaded: no team, still useful', A.stripText(A.nextShift(shifts, 0), null), 'Scout Red 2 in Q1, through Q4.');
check('a break', A.stripText(A.nextShift(shifts, 4), sched), 'You are on a break until Q8. Take it.');
check('later', A.stripText(A.nextShift([{ from: 9, to: 12, station: 'B2' }], 3), sched), 'Next shift: Q9–12, Blue 2 (team 5 in Q9).');
check('done', A.stripText(A.nextShift(shifts, 12), sched), 'No more shifts on the rotation.');
check('none: nothing shown at all', A.stripText(A.nextShift([], 0), sched), '');
check('the whole list in order', A.summary(shifts), 'Q1–4 Red 2 · Q5–8 break · Q9–12 Blue 2');

// ---- last match sent ----
const sm = [{ eventKey: '2026ctwat', matchNumber: 3 }, { eventKey: '2026ctwat', matchNumber: '7' }, { eventKey: '2026cthar', matchNumber: 40 }, { eventKey: '2026CTWAT', matchNumber: 'x' }];
check('the highest match for this event, in any case, ignoring other events and junk', [A.lastSent(sm, '2026ctwat'), A.lastSent(sm, '2026CTHAR'), A.lastSent([], 'x'), A.lastSent(null, 'x')], [7, 40, 0, 0]);

if (fails.length) { console.log(`${pass} passed, ${fails.length} FAILED`); fails.forEach((x) => console.log('  x ' + x)); process.exit(1); }
console.log(`All ${pass} assignment checks passed.`);
