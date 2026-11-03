'use strict';
/* node tools/test-pack.js: the game-pack validator accepts the real packs and explains broken ones. */
const fs = require('fs');
const path = require('path');
const { validate } = require('./validate-pack');
let pass = 0; const fails = [];
const ok = (n, c, d) => { if (c) pass++; else fails.push(n + (d !== undefined ? ': ' + JSON.stringify(d) : '')); };
const real = require('../config.json');
const test27 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pack-2027-test.json'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));
const field = (cfg, code) => cfg.sections.flatMap((s) => s.fields).find((f) => f.code === code);

ok('the real 2026 pack is valid', validate(real).errors.length === 0, validate(real).errors);
ok('the made-up 2027 pack is valid', validate(test27).errors.length === 0, validate(test27).errors);
ok('the 2026 pack carries its Scout Trust map', real.game.tba && real.game.tba.counts.length === 2 && real.game.tba.robots.length === 2);

function breaks(name, mutate, expect) {
  const c = clone(test27); mutate(c);
  const e = validate(c).errors;
  ok(name, e.some((m) => expect.test(m)), e);
}
breaks('missing identity field is named', (c) => { c.sections[0].fields = c.sections[0].fields.filter((f) => f.code !== 'teamNumber'); }, /no "teamNumber" field/);
breaks('duplicate code is caught', (c) => { field(c, 'teleBalls').code = 'autoBalls'; }, /used twice/);
breaks('unknown field type is caught', (c) => { field(c, 'autoBalls').type = 'slider'; }, /not one of/);
breaks('select with no options is caught', (c) => { delete field(c, 'endgame').options; }, /needs a list of "options"/);
breaks('points for an option that does not exist', (c) => { field(c, 'endgame').optionPoints.H9 = 40; }, /"H9".*not one of this field's options/);
breaks('display code that is not a field', (c) => { c.game.display.climbCode = 'hangg'; }, /display\.climbCode.*"hangg"/);
breaks('climb level that is not an option', (c) => { c.game.display.climbLevels.push('H3'); }, /"H3"/);
breaks('tba count pointing at a missing field', (c) => { c.game.tba.counts[0].field = 'nope'; }, /field "nope" is not on the form/);
breaks('tba robot path without {n}', (c) => { c.game.tba.robots[0].path = 'endgameRobot1'; }, /\{n\}/);
breaks('tba level mapped to a missing option', (c) => { c.game.tba.robots[0].levels.Hang3 = 'H3'; }, /"H3" is not an option/);
breaks('tba unknown kind', (c) => { c.game.tba.robots[0].kind = 'maybe'; }, /kind must be/);
breaks('no year', (c) => { delete c.game.year; }, /game\.year/);
const noTba = clone(test27); delete noTba.game.tba;
ok('a pack with no tba block is valid but says Scout Trust will not work', validate(noTba).errors.length === 0 && validate(noTba).warnings.some((w) => /Scout Trust/.test(w)));
ok('garbage input does not crash', validate(null).errors.length === 1 && validate({}).errors.length > 0);

if (fails.length) { console.log(`${pass} passed, ${fails.length} FAILED`); fails.forEach((x) => console.log('  x ' + x)); process.exit(1); }
console.log(`All ${pass} game-pack checks passed.`);
