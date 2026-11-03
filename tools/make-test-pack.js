'use strict';
/* Builds tools/fixtures/pack-2027-test.json: a made-up game ("Test Game 2027") that shares nothing
 * with REBUILT except the identity fields every game needs. Tests run both apps against it to prove
 * a new season needs only a new pack, never new code.   node tools/make-test-pack.js
 */
const fs = require('fs');
const path = require('path');
const real = require('../config.json');
const pick = (code) => real.sections[0].fields.find((f) => f.code === code);
const opt = (...ks) => ks.map(([k, v]) => ({ k, v }));
const pack = {
  title: 'TEST GAME 2027', delimiter: '\t',
  game: {
    name: 'Test Game', year: 2027,
    note: 'Made-up game for tests. Not a real FRC game.',
    display: { autoCountCode: 'autoBalls', teleCountCode: 'teleBalls', defenseCode: 'defRating', climbCode: 'endgame', climbLevels: ['P', 'H1', 'H2'] },
    tba: {
      year: 2027, game: 'Test Game',
      counts: [
        { key: 'autoBalls', label: 'Auto balls', field: 'autoBalls', path: 'balls.autoTotal' },
        { key: 'teleBalls', label: 'Teleop balls', field: 'teleBalls', path: 'balls.teleTotal' }
      ],
      robots: [
        { key: 'endgame', label: 'Endgame', field: 'endgame', path: 'endgameRobot{n}', kind: 'levels',
          levels: { Park: 'P', Hang1: 'H1', Hang2: 'H2' }, none: 'N', failed: 'X', noneOfficial: 'None' }
      ]
    }
  },
  sections: [
    { name: 'Prematch', fields: ['scoutName', 'eventKey', 'matchNumber', 'matchType', 'teamNumber', 'alliance', 'noShow'].map(pick) },
    { name: 'Autonomous', fields: [
      { title: 'Balls scored in auto', type: 'counter', code: 'autoBalls', default: 0, min: 0, max: 60, points: 2 },
      { title: 'Left the start line?', type: 'boolean', code: 'leftLine', default: false, points: 3 }
    ] },
    { name: 'Teleop', fields: [
      { title: 'Balls scored in teleop', type: 'counter', code: 'teleBalls', default: 0, min: 0, max: 200, points: 1 },
      { title: 'Defense (0-5)', type: 'range', code: 'defRating', default: 0, min: 0, max: 5 }
    ] },
    { name: 'Endgame', fields: [
      { title: 'Endgame', type: 'select', code: 'endgame', default: 'N',
        options: opt(['N', 'Nothing'], ['P', 'Parked'], ['H1', 'Hang level 1'], ['H2', 'Hang level 2'], ['X', 'Failed']),
        optionPoints: { P: 2, H1: 8, H2: 15 } },
      { title: 'Died?', type: 'boolean', code: 'died', default: false, fail: true },
      { title: 'Comments', type: 'textarea', code: 'co', default: '', maxLength: 2500 }
    ] }
  ]
};
fs.mkdirSync(path.join(__dirname, 'fixtures'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'fixtures', 'pack-2027-test.json'), JSON.stringify(pack, null, 2) + '\n');
console.log('wrote tools/fixtures/pack-2027-test.json');
