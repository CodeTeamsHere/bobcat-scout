'use strict';
/* Checks for the scout trainer (trainer-core.js grading and progress) and for the practice data.
 *
 *   node tools/test-trainer.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('../trainer-core.js');

let pass = 0; const fails = [];
function check(name, got, want) { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
function ok(name, cond, detail) { if (cond) pass++; else fails.push(`${name}${detail !== undefined ? ': ' + JSON.stringify(detail) : ''}`); }

const practice = {
  counts: [{ code: 'autoFuel', label: 'Auto: fuel scored' }, { code: 'teleFuel', label: 'Teleop: fuel scored' }],
  robotChoices: [
    { code: 'autoClimb', label: 'Auto climb', options: [{ k: 'NA', v: 'No climb' }, { k: 'Success', v: 'Climbed' }] },
    { code: 'climb', label: 'Endgame climb', options: [{ k: 'No', v: 'No climb' }, { k: 'L1', v: 'Level 1' }, { k: 'L2', v: 'Level 2' }, { k: 'L3', v: 'Level 3' }, { k: 'F', v: 'Tried and failed' }] },
  ],
};
const match = { id: 'x-q1-red', teams: ['177', '254', '1678'], answers: { counts: { autoFuel: 12, teleFuel: 50 }, robots: [
  { team: '177', choices: { autoClimb: 'NA', climb: 'L1' } }, { team: '254', choices: { autoClimb: 'Success', climb: 'No' } }, { team: '1678', choices: { autoClimb: 'NA', climb: 'No' } }] } };
const perfect = { counts: { autoFuel: [4, 4, 4], teleFuel: [20, 15, 15] }, robots: [{ autoClimb: 'NA', climb: 'L1' }, { autoClimb: 'Success', climb: 'No' }, { autoClimb: 'NA', climb: 'No' }] };

// ---- a perfect scout ----
let g = T.grade(match, practice, perfect);
check('perfect: score 100', g.score, 100);
check('perfect: complete', g.complete, true);
check('perfect: counts spot on', g.counts.map((c) => c.band), ['spot', 'spot']);
check('perfect: every choice matches', [g.choicesRight, g.choicesTotal], [6, 6]);
check('perfect: the sums are shown', g.counts.map((c) => [c.yours, c.official, c.diff]), [[12, 12, 0], [50, 50, 0]]);
check('perfect: verdict', g.verdict, 'Excellent scouting');

// ---- counts: bands and direction ----
check('band: 2 off of 12 is spot on', T.band(2, 12), 'spot');
check('band: 3 off of 12 is close', T.band(3, 12), 'close');
check('band: 5 off of 12 is a bit off', T.band(5, 12), 'off');
check('band: 9 off of 12 is worth another look', T.band(9, 12), 'far');
check('band: a big count allows a bigger miss (8% of 100)', [T.band(8, 100), T.band(9, 100)], ['spot', 'close']);
check('band: over and under are the same size', T.band(-5, 12), T.band(5, 12));
check('score: perfect 100, way off 0', [T.countScore(0, 50), T.countScore(40, 50)], [100, 0]);
g = T.grade(match, practice, Object.assign({}, perfect, { counts: { autoFuel: [4, 4, 4], teleFuel: [25, 20, 15] } }));
check('ten too many teleop: says so and suggests a fix', [g.counts[1].diff, /counted 10 more/.test(g.counts[1].tip), /twice/.test(g.counts[1].tip)], [10, true, true]);
g = T.grade(match, practice, Object.assign({}, perfect, { counts: { autoFuel: [2, 2, 2], teleFuel: [20, 15, 15] } }));
check('six too few in auto: says so and suggests half speed', [g.counts[0].diff, /counted 6 fewer/.test(g.counts[0].tip), /half speed/.test(g.counts[0].tip)], [-6, true, true]);
check('a worse count scores lower', g.scoreCounts < 100 && g.score < 100, true);

// ---- choices: climbs ----
g = T.grade(match, practice, Object.assign({}, perfect, { robots: [{ autoClimb: 'NA', climb: 'No' }, { autoClimb: 'Success', climb: 'No' }, { autoClimb: 'NA', climb: 'No' }] }));
const missed = g.robots[0].rows.find((r) => r.code === 'climb');
check('a missed climb: not ok, kind "missed", names the level the field saw', [missed.ok, missed.kind, /level 1/.test(missed.text)], [false, 'missed', true]);
g = T.grade(match, practice, Object.assign({}, perfect, { robots: [{ autoClimb: 'NA', climb: 'L1' }, { autoClimb: 'Success', climb: 'L2' }, { autoClimb: 'NA', climb: 'No' }] }));
const extra = g.robots[1].rows.find((r) => r.code === 'climb');
check('a climb the field did not see: kind "extra"', [extra.ok, extra.kind], [false, 'extra']);
g = T.grade(match, practice, Object.assign({}, perfect, { robots: [{ autoClimb: 'NA', climb: 'L3' }, { autoClimb: 'Success', climb: 'No' }, { autoClimb: 'NA', climb: 'No' }] }));
const lvl = g.robots[0].rows.find((r) => r.code === 'climb');
check('the wrong rung: kind "level"', [lvl.ok, lvl.kind, /level 3/.test(lvl.text)], [false, 'level', true]);
g = T.grade(match, practice, Object.assign({}, perfect, { robots: [{ autoClimb: 'NA', climb: 'L1' }, { autoClimb: 'Success', climb: 'F' }, { autoClimb: 'NA', climb: 'No' }] }));
const fail = g.robots[1].rows.find((r) => r.code === 'climb');
check('"tried and failed" where the field saw nothing is fine', [fail.ok, fail.kind], [true, 'unverifiable']);
g = T.grade(match, practice, Object.assign({}, perfect, { robots: [{ autoClimb: 'NA', climb: 'F' }, { autoClimb: 'Success', climb: 'No' }, { autoClimb: 'NA', climb: 'No' }] }));
check('"tried and failed" where the field saw a Level 1 is not right', g.robots[0].rows.find((r) => r.code === 'climb').ok, false);

// ---- the overall score: climbs 40%, counts 60% ----
g = T.grade(match, practice, { counts: { autoFuel: [0, 0, 0], teleFuel: [0, 0, 0] }, robots: perfect.robots });
check('every climb right but no counts at all: 40', [g.scoreChoices, g.scoreCounts, g.score], [100, 0, 40]);
g = T.grade(match, practice, { counts: perfect.counts, robots: [{ autoClimb: 'Success', climb: 'L3' }, { autoClimb: 'NA', climb: 'L2' }, { autoClimb: 'Success', climb: 'L1' }] });
check('every count right but no climb right: 60', [g.scoreChoices, g.scoreCounts, g.score], [0, 100, 60]);

// ---- incomplete answers and kind wording ----
g = T.grade(match, practice, { counts: { autoFuel: [4, 4, ''], teleFuel: [20, 15, 15] }, robots: [{ autoClimb: 'NA', climb: 'L1' }] });
check('missing answers: not complete', g.complete, false);
const all = JSON.stringify(g);
ok('the feedback never says "wrong"', !/wrong/i.test(all));
ok('nor "incorrect", "mistake" or "bad"', !/incorrect|mistake|\bbad\b/i.test(all));
check('no answers at all does not crash', T.grade(match, practice, null).complete, false);

// ---- progress ----
const res = (score, id) => ({ id: id || 'm' + score, score });
check('no results', T.progress([], [1, 2]).attempts, 0);
let p = T.progress([res(70, 'a'), res(85, 'b'), res(90, 'c'), res(81, 'd')], [{}, {}, {}, {}, {}]);
check('streak counts the latest matches at 80 or better', p.streak, 3);
check('three in a row makes a trusted scout', p.trusted, true);
check('matches done and total', [p.matchesDone, p.matchesTotal], [4, 5]);
p = T.progress([res(90, 'a'), res(70, 'b'), res(88, 'c')], []);
check('a low score breaks the streak', [p.streak, p.trusted], [1, false]);
p = T.progress([res(60, 'a'), res(90, 'a')], []);
check('best score per match is kept', p.best.a, 90);
check('improving is shown after six tries', T.progress([50, 55, 60, 65, 70, 80, 85, 90, 92, 95].map((s, i) => res(s, 'm' + i)), []).improving > 0, true);
check('not enough tries: improving is null', T.progress([res(60, 'a')], []).improving, null);
const ms = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
check('next match: the first not done', T.nextMatch(ms, { a: 90 }).id, 'b');
check('next match: none left', T.nextMatch(ms, { a: 1, b: 1, c: 1 }), null);

// ---- the real practice data ----
const box = { window: {} }; vm.createContext(box);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'practice-data.js'), 'utf8'), box);
const P = box.window.PRACTICE;
ok('practice data loads', P && P.matches && P.matches.length >= 8, P && P.matches && P.matches.length);
ok('every practice match has three teams, a video and answers for every robot and count', P.matches.every((m) => m.teams.length === 3 && m.video && m.answers.robots.length === 3 && P.counts.every((c) => typeof m.answers.counts[c.code] === 'number')));
ok('every answer is one of the options the form offers', P.matches.every((m) => m.answers.robots.every((r) => P.robotChoices.every((c) => c.options.some((o) => o.k === r.choices[c.code])))));
ok('ids are unique', new Set(P.matches.map((m) => m.id)).size === P.matches.length);
ok('the easy ones come first', P.matches.map((m) => ({ easy: 0, medium: 1, harder: 2 }[m.level])).every((v, i, a) => i === 0 || a[i - 1] <= v));
ok('the matches are small enough to count by hand', P.matches.every((m) => m.answers.counts.autoFuel <= 26 && m.answers.counts.teleFuel <= 70));
ok('some matches have a climb to find', P.matches.some((m) => m.answers.robots.some((r) => r.choices.climb !== 'No')));
ok('some have none (so "no climb" is practised too)', P.matches.some((m) => m.answers.robots.every((r) => r.choices.climb === 'No')));
ok('a perfect scout scores 100 on every real practice match', P.matches.every((m) => {
  const a = { counts: {}, robots: m.answers.robots.map((r) => Object.assign({}, r.choices)) };
  P.counts.forEach((c) => { const t = m.answers.counts[c.code]; a.counts[c.code] = [Math.floor(t / 3), Math.floor(t / 3), t - 2 * Math.floor(t / 3)]; });
  return T.grade(m, P, a).score === 100;
}));
ok('no key or secret ended up in the data file', !/tba|key=|X-TBA/i.test(fs.readFileSync(path.join(__dirname, '..', 'practice-data.js'), 'utf8').replace(/"video"[^\n]*/g, '')));

if (fails.length) { console.log(`${pass} passed, ${fails.length} FAILED`); fails.forEach((f) => console.log('  x ' + f)); process.exit(1); }
console.log(`All ${pass} scout-trainer checks passed.`);
