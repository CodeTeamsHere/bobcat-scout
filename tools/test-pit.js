'use strict';
/* Checks for pit scouting's logic (pit-core.js) and the pit form's settings (pit-form.js).
 *
 *   node tools/test-pit.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const P = require('../pit-core.js');

let pass = 0; const fails = [];
function check(name, got, want) { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
function ok(name, cond, detail) { if (cond) pass++; else fails.push(`${name}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); }

const box = { window: {} }; vm.createContext(box);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'pit-form.js'), 'utf8'), box);
const FORM = box.window.PIT_FORM;
const meta = { scoutName: 'Ada', eventKey: '2026CTWAT' };

// ---- the form's settings ----
ok('the form loads', FORM && FORM.fields && FORM.fields.length >= 5);
ok('every field has a code, a label and a known type', FORM.fields.every((f) => f.code && f.label && ['select', 'number', 'text', 'textarea'].includes(f.type)));
ok('codes are unique and are not the fixed columns', new Set(FORM.fields.map((f) => f.code)).size === FORM.fields.length && !FORM.fields.some((f) => ['scoutName', 'eventKey', 'teamNumber', 'photoIds', '_id'].includes(f.code)));
ok('every select has options', FORM.fields.filter((f) => f.type === 'select').every((f) => Array.isArray(f.options) && f.options.length >= 2));
ok('codes are safe column names', FORM.fields.every((f) => /^[A-Za-z][A-Za-z0-9]*$/.test(f.code)));

// ---- checking a report ----
check('a good report has no problems', P.check(FORM, { teamNumber: '177', drivetrain: 'Swerve' }, meta), []);
ok('no team number', P.check(FORM, { drivetrain: 'Swerve' }, meta).some((p) => /team number/.test(p)));
ok('a silly team number', P.check(FORM, { teamNumber: '12.5', drivetrain: 'Swerve' }, meta).length === 1);
ok('no scout name', P.check(FORM, { teamNumber: '177', drivetrain: 'Swerve' }, { eventKey: 'x' }).some((p) => /name/.test(p)));
ok('no event', P.check(FORM, { teamNumber: '177', drivetrain: 'Swerve' }, { scoutName: 'A' }).some((p) => /event/.test(p)));
ok('an empty report (nothing filled, no photo)', P.check(FORM, { teamNumber: '177' }, meta).some((p) => /at least one/.test(p)));
check('a photo alone is enough', P.check(FORM, { teamNumber: '177', photos: [{}] }, meta), []);
ok('a number out of range', P.check(FORM, { teamNumber: '177', weightLb: '900' }, meta).some((p) => /Weight/.test(p)));
ok('a number that is not a number', P.check(FORM, { teamNumber: '177', fuelCapacity: 'lots' }, meta).some((p) => /Fuel/.test(p)));
ok('a choice that is not an option', P.check(FORM, { teamNumber: '177', drivetrain: 'Hover' }, meta).some((p) => /Drivetrain/.test(p)));
ok('too many photos', P.check(FORM, { teamNumber: '177', photos: [{}, {}, {}, {}] }, meta).some((p) => /photos/.test(p)));

// ---- the row sent to the Sheet ----
const row = P.buildRow(FORM, { teamNumber: ' 177 ', drivetrain: 'Swerve', fuelCapacity: '12', notes: '  quick robot  ' }, meta);
check('the row is a pit report with a stable id', [row._form, row._id], ['pit', 'pit_2026ctwat_177']);
check('event in small letters, team as a number', [row.eventKey, row.teamNumber], ['2026ctwat', 177]);
check('numbers as numbers, text trimmed, blanks blank', [row.fuelCapacity, row.notes, row.bestClimb], [12, 'quick robot', '']);
check('the column order: who, event, team, the questions, then photo ids', row._order.slice(0, 3).concat(row._order.slice(-1)), ['scoutName', 'eventKey', 'teamNumber', 'photoIds']);
ok('every question has a column', FORM.fields.every((f) => row._order.includes(f.code)));
ok('no passcode in the queued row (it is added when sending)', !('passcode' in row));
ok('photoIds is not sent with the row (so a re-sent report keeps the photos)', !('photoIds' in row));

// ---- photo sizes ----
check('a big landscape photo shrinks to 1280 wide', P.fitSize(4032, 3024), { w: 1280, h: 960 });
check('a portrait photo shrinks to 1280 tall', P.fitSize(3024, 4032), { w: 960, h: 1280 });
check('a small photo is never enlarged', P.fitSize(800, 600), { w: 800, h: 600 });
check('no size: nothing', P.fitSize(0, 0), { w: 0, h: 0 });
ok('a normal photo fits', P.photoFits('data:image/jpeg;base64,' + 'A'.repeat(400000)));
ok('a huge photo does not fit', !P.photoFits('data:image/jpeg;base64,' + 'A'.repeat(3000000)));
ok('quality steps go down', P.QUALITIES.every((q, i, a) => i === 0 || a[i - 1] > q));

// ---- the queue's bookkeeping ----
const item = P.newItem(row, [{ data: 'x', mime: 'image/jpeg' }, { data: 'y' }], 1700000000000);
check('a new item: row and photos not sent', [item.rowSent, P.unsent(item).length, P.done(item)], [false, 2, false]);
ok('each photo has its own id (so a retry is saved once)', item.photos[0].photoId !== item.photos[1].photoId);
check('a photo with no type is a JPEG', item.photos[1].mime, 'image/jpeg');
check('status while waiting', P.statusText(item), 'Waiting to send (it will go by itself when there is signal).');
item.rowSent = true;
check('status with the photos left', P.statusText(item), 'Report sent; 2 photos still to send.');
item.photos.forEach((p) => { p.sent = true; });
check('status when everything arrived', [P.done(item), P.statusText(item)], [true, 'Sent with 2 photos.']);
check('a report with no photos is done once the row is sent', P.done(Object.assign(P.newItem(row, []), { rowSent: true })), true);
check('status with an error', P.statusText(Object.assign(P.newItem(row, []), { error: 'Wrong passcode' })), 'Not sent: Wrong passcode');

// ---- did the photos arrive? ----
check('all arrived: 1 before, 2 sent, 3 after', P.photosArrived(1, 3, 2), true);
check('one missing: 1 before, 2 sent, 2 after', P.photosArrived(1, 2, 2), false);
check('at the six-photo limit, it counts as arrived', P.photosArrived(5, 6, 3), true);
check('nothing arrived', P.photosArrived(0, 0, 1), false);

if (fails.length) { console.log(`${pass} passed, ${fails.length} FAILED`); fails.forEach((f) => console.log('  x ' + f)); process.exit(1); }
console.log(`All ${pass} pit-scouting checks passed.`);
