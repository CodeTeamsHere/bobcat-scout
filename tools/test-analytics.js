/* Regression tests for the ANALYZE engine.
 *
 *   node tools/test-analytics.js
 *
 * These exist because the engine is config-driven: rename a field in
 * config.json and the scoring silently becomes zero rather than throwing.
 * That looks like "the analytics are broken" at an event, with no error
 * anywhere to explain it.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

// analytics.js is a browser IIFE that hangs itself off window and only touches
// the DOM when opened, so a stub window/document is enough to load it.
const noop = () => {};
const el = () => ({
  style: {}, dataset: {}, innerHTML: '', textContent: '', value: '',
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  addEventListener: noop, appendChild: noop, querySelector: () => null,
  querySelectorAll: () => [], setAttribute: noop, getAttribute: () => null
});
const sandbox = {
  window: {},
  document: {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: el,
    addEventListener: noop,
    body: el()
  },
  console,
  setTimeout,
  clearTimeout
};
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'analytics.js'), 'utf8'), sandbox, { filename: 'analytics.js' });

const A = sandbox.window.ANALYTICS;
if (!A || !A._) {
  console.error('analytics.js did not expose window.ANALYTICS');
  process.exit(1);
}
A.setConfig(cfg);
const api = A._;

let pass = 0;
const failures = [];
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else failures.push(`${name}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}
function checkTrue(name, cond, detail) {
  if (cond) pass++;
  else failures.push(`${name}: ${detail}`);
}

// ---- the config still annotates something to score ----------------------
const scoring = cfg.sections.flatMap((s) => s.fields).filter((f) => f.points != null || f.optionPoints);
checkTrue('config has scoring fields', scoring.length > 0,
  'no field in config.json carries points or optionPoints, so every team would rate 0');

const failFields = cfg.sections.flatMap((s) => s.fields).filter((f) => f.fail);
checkTrue('config marks breakdowns', failFields.length > 0,
  'no field is flagged fail:true, so reliability would always read 100%');

// ---- the display columns point at fields that exist ---------------------
const codes = new Set(cfg.sections.flatMap((s) => s.fields).map((f) => f.code));
const disp = (cfg.game && cfg.game.display) || {};
for (const key of ['autoCountCode', 'teleCountCode', 'defenseCode', 'climbCode']) {
  checkTrue(`display.${key} exists in the form`, codes.has(disp[key]),
    `game.display.${key} is "${disp[key]}", which is not a field code`);
}
const climbField = cfg.sections.flatMap((s) => s.fields).find((f) => f.code === disp.climbCode);
if (climbField) {
  const opts = new Set((climbField.options || []).map((o) => o.k));
  for (const lvl of disp.climbLevels || []) {
    checkTrue(`climb level "${lvl}" is a real option`, opts.has(lvl),
      `game.display.climbLevels lists "${lvl}", which ${disp.climbCode} does not offer`);
  }
}

// ---- scoring maths ------------------------------------------------------
const row = (over) => Object.assign({
  teamNumber: '177', alliance: 'red', eventKey: 'e', matchType: 'qm', matchNumber: 1,
  autoFuelScored: 0, teleopFuelScored: 0, autoClimbed: 'NA', climbed: 'No'
}, over);

check('empty match scores nothing', api.recordPoints(row({})), 0);
check('fuel counts one point each', api.recordPoints(row({ autoFuelScored: 4, teleopFuelScored: 18 })), 22);
check('endgame climb levels', [
  api.recordPoints(row({ climbed: 'L1' })),
  api.recordPoints(row({ climbed: 'L2' })),
  api.recordPoints(row({ climbed: 'L3' }))
], [10, 20, 30]);
check('an auto climb scores more than a level 1 endgame climb',
  api.recordPoints(row({ autoClimbed: 'Success' })) > api.recordPoints(row({ climbed: 'L1' })), true);
check('a failed endgame climb scores nothing', api.recordPoints(row({ climbed: 'F' })), 0);
check('a failed auto climb scores nothing', api.recordPoints(row({ autoClimbed: 'Failed' })), 0);
check('full line', api.recordPoints(row({ autoFuelScored: 4, teleopFuelScored: 18, climbed: 'L2' })), 42);

// ---- the model actually predicts better than chance ---------------------
const recs = api.sampleSeason();
checkTrue('demo season generates rows', recs.length > 0, 'sampleSeason returned nothing');
checkTrue('demo rows use the current field codes', recs[0][disp.teleCountCode] !== undefined,
  `sampleSeason emits ${Object.keys(recs[0]).join(', ')} — none of which is ${disp.teleCountCode}`);
checkTrue('demo rows score above zero', api.recordPoints(recs[0]) > 0,
  'every demo record scores 0, so the engine is reading fields that are not there');

const bt = api.backtest(recs);
checkTrue('backtest holds matches out', bt.n > 0, 'no held-out matches had a decided winner');
checkTrue('backtest beats the baseline', bt.accuracy >= bt.baseAccuracy,
  `accuracy ${bt.accuracy} vs baseline ${bt.baseAccuracy}`);
checkTrue('backtest is better than a coin flip', bt.accuracy > 0.6,
  `accuracy was only ${bt.accuracy}`);

// ---- reliability reads the breakdown flags ------------------------------
api.setData(recs, 'test');
const caps = A.engine.caps || {};
const someTeam = Object.values(caps)[0];
checkTrue('capabilities computes points', someTeam && someTeam.avgPts > 0,
  'avgPts came out 0 for every team');
checkTrue('capabilities computes the auto column', someTeam && someTeam.avgAuto > 0,
  'avgAuto came out 0, so the display column is pointing at the wrong field');
checkTrue('capabilities computes the climb rate', someTeam && someTeam.climbRate > 0,
  'climbRate came out 0, so climbCode or climbLevels is wrong');

// ---- report -------------------------------------------------------------
if (failures.length) {
  console.log(`\n${pass} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.log('  x ' + f);
  console.log('');
  process.exit(1);
}
console.log(`\nAll ${pass} analytics checks passed  (backtest ${Math.round(bt.accuracy * 100)}% vs ${Math.round(bt.baseAccuracy * 100)}% baseline, n=${bt.n}).\n`);
