'use strict';
/* Checks for the super-scout's logic (super-core.js) and tags (super-form.js).
 *
 *   node tools/test-super.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const C = require('../super-core.js');

let pass = 0; const fails = [];
function check(name, got, want) { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
function ok(name, cond, detail) { if (cond) pass++; else fails.push(`${name}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); }

const box = { window: {} }; vm.createContext(box);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'super-form.js'), 'utf8'), box);
const FORM = box.window.SUPER_FORM;
const meta = { scoutName: 'Sam Lee', eventKey: '2026CTWAT' };

// ---- the tags ----
const tags = C.allTags(FORM);
ok('there are tags in groups', FORM.groups.length >= 4 && tags.length >= 15);
ok('no tag is used twice', new Set(tags).size === tags.length);
ok('no tag has a comma (they are joined with commas)', tags.every((t) => t.indexOf(',') < 0));
ok('every group has a title', FORM.groups.every((g) => g.title && g.tags.length));

// ---- six robots from the schedule ----
const sched = { matches: { 14: { red: ['frc177', 'frc254', 'frc1678'], blue: ['frc118', 'frc2056', 'frc973'] } } };
check('red then blue, no frc', C.robotsFor(sched, 14).map((r) => r.team + r.alliance[0]), ['177r', '254r', '1678r', '118b', '2056b', '973b']);
check('a match not in the schedule', C.robotsFor(sched, 15), []);
check('no schedule loaded', C.robotsFor(null, 14), []);

// ---- checking ----
const good = [{ team: '254', tags: ['Played defense'], rating: '4', note: '' }];
check('a good note has no problems', C.check(FORM, meta, 14, good), []);
ok('a robot with nothing noted is not a problem, and is not sent', C.check(FORM, meta, 14, good.concat([{ team: '118', tags: [], rating: '', note: '' }])).length === 0 && C.buildRows(FORM, meta, 14, good.concat([{ team: '118', tags: [], rating: '', note: '' }])).length === 1);
ok('nothing noted at all', C.check(FORM, meta, 14, [{ team: '1', tags: [] }]).some((p) => /at least one/.test(p)));
ok('no match number', C.check(FORM, meta, '', good).some((p) => /match number/.test(p)));
ok('a match number of 500', C.check(FORM, meta, 500, good).some((p) => /match number/.test(p)));
ok('a match number of 2.5', C.check(FORM, meta, 2.5, good).some((p) => /match number/.test(p)));
ok('no scout name', C.check(FORM, { eventKey: 'x' }, 14, good).some((p) => /name/.test(p)));
ok('no event', C.check(FORM, { scoutName: 'a' }, 14, good).some((p) => /event/.test(p)));
ok('a tag that is not on the list', C.check(FORM, meta, 14, [{ team: '254', tags: ['Is a wizard'] }]).some((p) => /not one of the tags/.test(p)));
ok('a rating of 9', C.check(FORM, meta, 14, [{ team: '254', rating: '9' }]).some((p) => /1 to 5/.test(p)));
ok('a rating of 0', C.check(FORM, meta, 14, [{ team: '254', rating: '0' }]).some((p) => /1 to 5/.test(p)));
ok('a bad team number', C.check(FORM, meta, 14, [{ team: 'abc', tags: ['Fast cycles'] }]).some((p) => /team number/.test(p)));
ok('a note that is too long', C.check(FORM, meta, 14, [{ team: '254', note: 'x'.repeat(301) }]).some((p) => /too long/.test(p)));
ok('the same robot twice', C.check(FORM, meta, 14, [{ team: '254', tags: ['Fast cycles'] }, { team: 'frc254', rating: '3' }]).some((p) => /twice/.test(p)));

// ---- the rows ----
const rows = C.buildRows(FORM, meta, ' 14 ', [{ team: 'frc254', alliance: 'red', tags: ['Played defense', 'Fast cycles'], rating: '4', note: '  hit hard  ' }, { team: '118', alliance: 'blue', tags: [], rating: '', note: 'quiet match' }]);
check('two rows, with the right shape', [rows.length, rows[0]._form, rows[0].teamNumber, rows[0].matchNumber, rows[0].eventKey, rows[0].alliance], [2, 'super', 254, 14, '2026ctwat', 'red']);
check('tags joined, rating a number, note trimmed', [rows[0].tags, rows[0].driverRating, rows[0].note], ['Played defense, Fast cycles', 4, 'hit hard']);
check('no rating stays blank', [rows[1].driverRating, rows[1].tags], ['', '']);
check('the id is per event, match, robot and scout (so a resend replaces)', rows[0]._id, 'sup_2026ctwat_14_254_sam-lee');
ok('two scouts get different ids for the same robot', C.buildRows(FORM, { scoutName: 'Dee', eventKey: 'x' }, 14, good)[0]._id !== C.buildRows(FORM, { scoutName: 'Sam', eventKey: 'x' }, 14, good)[0]._id);
check('the column order starts with who and ends with the note', [rows[0]._order[0], rows[0]._order[rows[0]._order.length - 1]], ['scoutName', 'note']);
ok('no passcode in the queued row', !('passcode' in rows[0]));
check('a tag that is not on the list is dropped from the row', C.buildRows(FORM, meta, 14, [{ team: '9', tags: ['Fast cycles', 'Is a wizard'] }])[0].tags, 'Fast cycles');
check('a bad alliance word becomes blank', C.buildRows(FORM, meta, 14, [{ team: '9', alliance: 'green', tags: ['Fast cycles'] }])[0].alliance, '');

if (fails.length) { console.log(`${pass} passed, ${fails.length} FAILED`); fails.forEach((f) => console.log('  x ' + f)); process.exit(1); }
console.log(`All ${pass} super-scout checks passed.`);
