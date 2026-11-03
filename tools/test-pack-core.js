'use strict';
/* node tools/test-pack-core.js: building a pack from a list of scoring actions, reading the AI's
 * answer, picking scoring text out of a manual, and suggesting official-number paths. */
const fs = require('fs');
const path = require('path');
const core = require('../pack-core.js');
let pass = 0; const fails = [];
const ok = (n, c, d) => { if (c) pass++; else fails.push(n + (d !== undefined ? ': ' + JSON.stringify(d) : '')); };

// ---- the 2026 game, described the way the AI would ------------------------------------------
const spec2026 = {
  gameName: 'Rebuilt', year: 2026,
  actions: [
    { id: 'autoFuelScored', title: 'Fuel scored in auto', phase: 'auto', kind: 'count', points: 1, quote: 'Each FUEL scored in the HUB during AUTO is worth 1 point.' },
    { id: 'autoClimbed', title: 'Climb in auto', phase: 'auto', kind: 'levels', levels: [{ key: 'Success', label: 'Level 1', points: 15 }], quote: 'AUTO TOWER LEVEL 1: 15 points' },
    { id: 'teleopFuelScored', title: 'Fuel scored in teleop', phase: 'tele', kind: 'count', points: 1, quote: 'x' },
    { id: 'climbed', title: 'Endgame climb', phase: 'end', kind: 'levels', levels: [{ key: 'L1', label: 'Level 1', points: 10 }, { key: 'L2', label: 'Level 2', points: 20 }, { key: 'L3', label: 'Level 3', points: 30 }], quote: 'x' }
  ]
};
const pack = core.buildPack(spec2026);
const v = core.validate(pack);
ok('a pack built from actions is valid', v.errors.length === 0, v.errors);
ok('its Scout Trust warning is the only note', v.warnings.length === 1 && /Scout Trust/.test(v.warnings[0]), v.warnings);
const f = (code) => pack.sections.flatMap((s) => s.fields).find((x) => x.code === code);
ok('counts become counters worth their points', f('autoFuelScored').type === 'counter' && f('autoFuelScored').points === 1);
ok('levels become a select with option points', f('climbed').type === 'select' && f('climbed').optionPoints.L3 === 30 && f('climbed').options.some((o) => o.k === 'F') && f('climbed').options.some((o) => o.k === 'No'));
ok('the display codes follow the actions', pack.game.display.autoCountCode === 'autoFuelScored' && pack.game.display.teleCountCode === 'teleopFuelScored' && pack.game.display.climbCode === 'climbed' && pack.game.display.climbLevels.join() === 'L1,L2,L3', pack.game.display);
ok('the endgame climb wins over the auto climb for the display', pack.game.display.climbCode === 'climbed');
ok('fail flags and comments are always there', ['died', 'mechIssue', 'tipped', 'noShow'].every((c) => f(c) && f(c).fail) && f('co'));
ok('sections come out in match order', pack.sections.map((s) => s.name).join() === 'Prematch,Autonomous,Teleop,Endgame', pack.sections.map((s) => s.name));

// ---- the same points as the hand-made 2026 pack -----------------------------------------------
const real = require('../config.json');
const pts = (cfg) => { const o = {}; cfg.sections.forEach((s) => s.fields.forEach((x) => { if (x.points != null) o[x.code] = x.points; if (x.optionPoints) o[x.code] = JSON.stringify(x.optionPoints); })); return o; };
ok('it scores the 2026 game the same way as the hand-made pack', JSON.stringify(pts(pack)) === JSON.stringify(pts(real)), { built: pts(pack), real: pts(real) });

// ---- tidying ------------------------------------------------------------------------------------
const messy = core.cleanSpec({ gameName: ' X ', year: '2027', actions: [
  { title: 'Balls in goal', phase: 'weird', kind: 'nope', points: '3' }, { title: 'Balls in goal', phase: 'auto', kind: 'count', points: 1 },
  { title: '', id: '' }, { title: 'Hang', kind: 'levels', phase: 'end', levels: [{ label: 'Low', points: '5' }, { label: 'High', points: 9 }] }] });
ok('messy rows are repaired', messy.spec.actions.length === 3 && messy.spec.actions[0].phase === 'tele' && messy.spec.actions[0].kind === 'count' && messy.spec.actions[0].points === 3 && messy.spec.year === 2027);
ok('same-name rows get different ids', messy.spec.actions[0].id !== messy.spec.actions[1].id, messy.spec.actions.map((a) => a.id));
ok('levels get keys and number points', messy.spec.actions[2].levels.map((l) => l.key + ':' + l.points).join() === 'L1:5,L2:9', messy.spec.actions[2].levels);
ok('every repair is reported', messy.notes.length >= 2, messy.notes);
ok('an action named like a built-in field is refused', (() => { try { core.buildPack({ gameName: 'X', year: 2027, actions: [{ title: 'Died', id: 'died', kind: 'yesno', phase: 'end' }] }); return false; } catch (e) { return /died/.test(e.message); } })());
ok('a pack built from nothing is still valid except for having no points', core.validate(core.buildPack({ gameName: 'Empty', year: 2030, actions: [] })).errors.length === 0);

// ---- the AI's answer ----------------------------------------------------------------------------
const good = JSON.stringify({ gameName: 'G', year: 2027, actions: [{ title: 'A', kind: 'count', phase: 'auto', points: 1 }] });
ok('reads plain JSON', !!core.parseDraftReply(good).spec);
ok('reads JSON in a code fence with chatter around it', !!core.parseDraftReply('Sure! Here it is:\n```json\n' + good + '\n```\nHope that helps.').spec);
ok('says so when there is no JSON', /could read/.test(core.parseDraftReply('I could not find anything.').error));
ok('says so when the JSON is broken', /not valid JSON/.test(core.parseDraftReply('{"actions": [}').error));
ok('says so when there are no actions', /no scoring actions/.test(core.parseDraftReply('{"gameName":"G","actions":[]}').error));
const msgs = core.draftMessages('text', 'Rebuilt', 2026);
ok('the question carries the schema, the rules and the text', msgs.length === 2 && /"kind"/.test(msgs[0].content) && /Do not invent/.test(msgs[0].content) && /text/.test(msgs[1].content));

// ---- picking scoring text out of a long manual -------------------------------------------------
const filler = (n) => Array.from({ length: n }, (_, i) => `Section ${i}. Teams must bring their robots in a cart to the pit area before inspection opens. Bumpers are required.`).join('\n\n');
const manual = filler(200) + '\n\nSCORING: Each FUEL scored in the HUB is worth 1 point in AUTO and 1 point in TELEOP. A robot that climbs to LEVEL 3 earns 30 points.\n\n' + filler(200);
const sel = core.selectScoringText(manual, 3000);
ok('the scoring paragraph is kept, the filler is not', /30 points/.test(sel.text) && sel.chars < 3100 && sel.picked >= 1 && sel.total === manual.length, { chars: sel.chars, picked: sel.picked });
ok('it never goes over the size limit', core.selectScoringText(manual.repeat(5), 5000).chars <= 5000);
ok('an empty manual gives empty text', core.selectScoringText('').text === '');

// ---- suggestions from a real official breakdown -------------------------------------------------
const fx = path.join(__dirname, '..', '..', 'bobcat-scout-analytics', 'tools', 'fixtures', '2026cthar-matches.json');
if (fs.existsSync(fx)) {
  const m = JSON.parse(fs.readFileSync(fx, 'utf8')).find((x) => x.comp_level === 'qm' && x.score_breakdown);
  const s = core.suggestTba(real, m.score_breakdown.red);
  const top = (code) => (s.counts.find((c) => c.field === code) || { candidates: [] }).candidates[0];
  ok('auto fuel: the best guess is the official auto count', top('autoFuelScored') && top('autoFuelScored').path === 'hubScore.autoCount', s.counts.map((c) => c.field + '=' + (c.candidates[0] && c.candidates[0].path)));
  ok('teleop fuel: the best guess is the official teleop count', top('teleopFuelScored') && top('teleopFuelScored').path === 'hubScore.teleopCount');
  const r = (code) => (s.robots.find((x) => x.field === code) || { candidates: [] }).candidates[0];
  ok('endgame climb: the best guess is the endgame tower group', r('climbed') && r('climbed').path === 'endGameTowerRobot{n}', s.robots.map((x) => x.field + '=' + (x.candidates[0] && x.candidates[0].path)));
  ok('auto climb: the best guess is the auto tower group', r('autoClimbed') && r('autoClimbed').path === 'autoTowerRobot{n}');
  const t = core.buildTba(pack, { counts: { autoFuelScored: 'hubScore.autoCount' }, robots: { climbed: { path: 'endGameTowerRobot{n}', noneOfficial: 'None', levels: { Level1: 'L1', Level2: 'L2', Level3: 'L3' } } } });
  const withTba = JSON.parse(JSON.stringify(pack)); withTba.game.tba = t;
  ok('a pack with the chosen paths is valid, and has no Scout Trust warning', core.validate(withTba).errors.length === 0 && core.validate(withTba).warnings.length === 0, core.validate(withTba));
  ok('the built block is the same shape Scout Trust reads', t.robots[0].kind === 'levels' && t.robots[0].none === 'No' && t.robots[0].failed === 'F' && t.counts[0].path === 'hubScore.autoCount');
} else console.log('  (skipped the breakdown checks: the Analytics fixture was not found next to this repo)');

if (fails.length) { console.log(`${pass} passed, ${fails.length} FAILED`); fails.forEach((x) => console.log('  x ' + x)); process.exit(1); }
console.log(`All ${pass} pack-core checks passed.`);
