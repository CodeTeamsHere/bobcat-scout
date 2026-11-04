'use strict';
/* node tools/test-trainer-pack.js: practice matches made from a game pack (practice-gen.js).
 *
 * On the made-up 2027 game: the narrations read back through the talk-to-fill (generic-fill.js) to the
 * true answers, the set is the same every time for a seed, the trainer grades it, and the 2026 game
 * still gets the real practice-data.js matches.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const GEN = require('../practice-gen.js');
const G = require('../generic-fill.js');
const T = require('../trainer-core.js');
const pack = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pack-2027-test.json'), 'utf8'));
const SKIP = ['scoutName', 'eventKey', 'matchNumber', 'matchType', 'teamNumber', 'alliance', 'noShow', 'co'];

let pass = 0; const fails = [];
const ok = (n, c, d) => { if (c) pass++; else fails.push(n + (d !== undefined ? ': ' + JSON.stringify(d) : '')); };

const P = GEN.generate(pack, { seed: 2027, count: 12 });
ok('a set of 12 matches is made', P.matches.length === 12, P.matches.length);
ok('it is marked as generated and says which game', P.generated === true && /Test Game/.test(P.game), P.game);
ok('counts are the pack\'s counter boxes', P.counts.map((c) => c.code).join() === 'autoBalls,teleBalls', P.counts.map((c) => c.code));
ok('choices are its yes/no, rating and select boxes', P.robotChoices.map((c) => c.code).join() === 'leftLine,defRating,endgame,died', P.robotChoices.map((c) => c.code));
ok('no identity box or comment box is practised', !P.counts.concat(P.robotChoices).some((c) => SKIP.indexOf(c.code) >= 0));
ok('every match has three teams, three narrations and answers for every robot', P.matches.every((m) => m.teams.length === 3 && m.narrations.length === 3 && m.answers.robots.length === 3 && m.narrations.every((n) => n.length > 20)));
ok('easy ones come first', P.matches.map((m) => ({ easy: 0, medium: 1, harder: 2 }[m.level])).every((v, i, a) => i === 0 || a[i - 1] <= v));
ok('ids are unique', new Set(P.matches.map((m) => m.id)).size === 12);
ok('every true answer is one of the options the form offers', P.matches.every((m) => m.answers.robots.every((r) => P.robotChoices.every((c) => c.options.some((o) => o.k === r.choices[c.code])))));
ok('counts stay inside the pack\'s limits', P.matches.every((m) => m.answers.robots.every((r) => r.choices.autoBalls >= 0 && r.choices.autoBalls <= 60 && r.choices.teleBalls >= 0 && r.choices.teleBalls <= 200)));
ok('the narration uses the box titles\' own words', P.matches.every((m) => m.narrations.every((n) => /balls/.test(n) && /start line/.test(n) && /endgame/i.test(n))));
ok('the alliance counts are the sum of the three robots', P.matches.every((m) => P.counts.every((c) => m.answers.counts[c.code] === m.answers.robots.reduce((s, r) => s + r.choices[c.code], 0))));

// Read every narration back with the talk-to-fill and compare with the truth, box by box.
let boxes = 0, same = 0; const misses = [];
P.matches.forEach((m) => m.narrations.forEach((text, i) => {
  const got = G.fill(text, pack, SKIP).fields, truth = m.answers.robots[i].choices;
  Object.keys(truth).forEach((code) => {
    const ch = P.robotChoices.filter((c) => c.code === code)[0];
    const want = ch ? (ch.kind === 'bool' ? truth[code] === 'yes' : ch.kind === 'range' ? Number(truth[code]) : truth[code]) : truth[code];
    boxes++; if (got[code] === want) same++; else misses.push({ text, code, want, got: got[code] });
  });
}));
ok('at least 90% of boxes read back to the truth (' + same + '/' + boxes + ')', same / boxes >= 0.9, misses.slice(0, 3));
ok('no narration is nothing but empty values (several boxes differ across the set)', new Set(P.matches.map((m) => JSON.stringify(m.answers.robots[0].choices))).size > 6);

// repeatable, but a new seed gives a new set
ok('same seed, same set', JSON.stringify(GEN.generate(pack, { seed: 2027, count: 12 })) === JSON.stringify(P));
ok('default seed is repeatable too', JSON.stringify(GEN.generate(pack)) === JSON.stringify(GEN.generate(pack)));
ok('a different seed gives different matches', JSON.stringify(GEN.generate(pack, { seed: 5, count: 12 }).matches) !== JSON.stringify(P.matches));

// the trainer grades a generated match
const m0 = P.matches[3];
const perfect = { counts: {}, robots: m0.answers.robots.map((r) => Object.assign({}, r.choices)) };
P.counts.forEach((c) => { perfect.counts[c.code] = m0.answers.robots.map((r) => r.choices[c.code]); });
perfect.robots.forEach((r) => P.counts.forEach((c) => delete r[c.code]));
let g = T.grade(m0, P, perfect);
ok('a scout who reads it right scores 100', g.score === 100 && g.complete, g.score);
const flipped = JSON.parse(JSON.stringify(perfect));
flipped.robots[0].died = m0.answers.robots[0].choices.died === 'yes' ? 'no' : 'yes';
g = T.grade(m0, P, flipped);
ok('one choice off lowers the score kindly', g.score < 100 && !/wrong|incorrect|mistake/i.test(JSON.stringify(g)), g.score);
const died = g.robots[0].rows.filter((r) => r.code === 'died')[0];
ok('"no" counts as the nothing-happened answer in the feedback', died.kind === (m0.answers.robots[0].choices.died === 'yes' ? 'missed' : 'extra'), died.kind);

// which set is used
const box = { window: {} }; vm.createContext(box);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'practice-data.js'), 'utf8'), box);
const real = box.window.PRACTICE;
const cfg2026 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
ok('the repo\'s own config.json is the 2026 game', cfg2026.game && cfg2026.game.year === 2026, cfg2026.game && cfg2026.game.year);
ok('2026 keeps the real practice data, unchanged', GEN.forConfig(cfg2026, real) === real);
ok('2027 gets a generated set', GEN.forConfig(pack, real).generated === true && GEN.forConfig(pack, real) !== real);
ok('no config yet keeps the real data', GEN.forConfig(null, real) === real);
ok('a pack with nothing to practise gives null', GEN.forConfig({ game: { year: 2030 }, sections: [{ name: 'Prematch', fields: [{ code: 'scoutName', type: 'text', title: 'Name' }] }] }, real) === null);
ok('the real practice file was not touched (still 2026 matches with video)', real.matches.every((m) => m.video && !m.narrations));

if (fails.length) { console.log(`${pass} passed, ${fails.length} FAILED`); fails.forEach((x) => console.log('  x ' + x)); process.exit(1); }
console.log(`All ${pass} generated-practice checks passed (${same}/${boxes} boxes read back from the narrations).`);
