'use strict';
/* node tools/test-generic.js: the generic fill (generic-fill.js) on the made-up 2027 game. */
const fs = require('fs');
const path = require('path');
const G = require('../generic-fill.js');
const pack = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pack-2027-test.json'), 'utf8'));
const SKIP = ['scoutName', 'eventKey', 'matchNumber', 'matchType', 'teamNumber', 'alliance', 'noShow', 'co'];
let pass = 0; const fails = [];
const ok = (n, c, d) => { if (c) pass++; else fails.push(n + (d !== undefined ? ': ' + JSON.stringify(d) : '')); };
const run = (t) => G.fill(t, pack, SKIP).fields;
const is = (name, t, want) => { const got = run(t); const bad = Object.keys(want).filter((k) => JSON.stringify(got[k]) !== JSON.stringify(want[k])); ok(name, bad.length === 0, { said: t, want, got }); };

is('counts by phase', 'In auto they scored 4 balls. Teleop they scored 12 balls.', { autoBalls: 4, teleBalls: 12 });
is('number before or after the word', 'Auto balls 3. In teleop, balls: 15.', { autoBalls: 3, teleBalls: 15 });
is('spoken in the other order', 'Teleop they put in 9 balls and in autonomous 2 balls.', { autoBalls: 2, teleBalls: 9 });
is('"no balls" means 0', 'In auto no balls. Teleop 7 balls.', { autoBalls: 0, teleBalls: 7 });
is('yes/no is yes when said', 'They left the start line in auto.', { leftLine: true });
is('yes/no is no when negated', 'They never left the start line in auto.', { leftLine: false });
is('died', 'The robot died in teleop.', { died: true });
is('did not die', 'Robot never died.', { died: false });
is('select by label', 'Endgame they did a hang level 2.', { endgame: 'H2' });
is('longer label wins over a shorter one', 'They managed hang level 1 at the end.', { endgame: 'H1' });
is('parked', 'At the end they parked.', { endgame: 'P' });
is('range box', 'Defense was 4 in teleop.', { defRating: 4 });
is('clamps to the box limits', 'Teleop 900 balls.', { teleBalls: 200 });
is('everything in one go', 'Auto 5 balls and left the line, teleop 20 balls, defense 2, endgame hang level 1, never died', { autoBalls: 5, leftLine: true, teleBalls: 20, defRating: 2, endgame: 'H1', died: false });

const got = run('Hello this is Krish, scouting team 177 red 2 in match 14.');
ok('talk with nothing about the game fills nothing', Object.keys(got).length === 0, got);
ok('identity boxes are never touched', !('scoutName' in run('scout name is Ava, team 100, match 4')) && !('teamNumber' in run('team 100')));
ok('every filled box is marked for the scout to check', Object.values(G.fill('Auto 5 balls', pack, SKIP).confidence).every((c) => c === 'medium'));
ok('empty or odd input does not crash', G.fill('', pack, SKIP) && G.fill(null, pack, SKIP) && G.fill('x', null, SKIP));

if (fails.length) { console.log(`${pass} passed, ${fails.length} FAILED`); fails.forEach((x) => console.log('  x ' + x)); process.exit(1); }
console.log(`All ${pass} generic-fill checks passed.`);
