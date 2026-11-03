'use strict';
/* Checks a game pack (config.json) and says what is wrong in plain words.
 *
 *   node tools/validate-pack.js                 checks config.json
 *   node tools/validate-pack.js some-pack.json  checks another file
 *
 * A game pack is the one file that describes a season: the form, the point values, and (under
 * game.tba) which scouting fields match which numbers in FIRST's official score breakdown.
 * Used by hand, by tests, and by the "new game" draft tool before a pack is accepted.
 */
const fs = require('fs');
const path = require('path');

const TYPES = ['text', 'number', 'select', 'image', 'boolean', 'counter', 'multiselect', 'textarea', 'range'];
// The rest of both apps depends on these: rows are matched, de-duplicated and grouped by them.
const NEEDED = ['scoutName', 'eventKey', 'matchNumber', 'matchType', 'teamNumber'];

function validate(cfg) {
  const errors = [], warnings = [];
  const bad = (m) => errors.push(m), warn = (m) => warnings.push(m);
  if (!cfg || typeof cfg !== 'object') return { errors: ['The pack is not a JSON object.'], warnings };
  if (!cfg.title) bad('The pack has no "title".');
  if (!cfg.game || !cfg.game.name) bad('"game.name" is missing (the name of the game, like "Rebuilt").');
  if (!cfg.game || !Number.isInteger(cfg.game.year)) bad('"game.year" is missing or not a whole number (like 2026).');
  if (!Array.isArray(cfg.sections) || !cfg.sections.length) { bad('The pack has no "sections" (the form pages).'); return { errors, warnings }; }

  const byCode = {};
  cfg.sections.forEach((s, si) => {
    if (!s.name) bad(`Section ${si + 1} has no "name".`);
    (s.fields || []).forEach((f, fi) => {
      const where = `${s.name || 'section ' + (si + 1)}, field ${fi + 1}${f.title ? ' ("' + f.title + '")' : ''}`;
      if (!f.code) { bad(`${where}: no "code" (the short name the Sheet column uses).`); return; }
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(f.code)) bad(`${where}: code "${f.code}" should be letters and digits only, starting with a letter.`);
      if (byCode[f.code]) bad(`${where}: code "${f.code}" is used twice. Every field needs its own.`);
      byCode[f.code] = f;
      if (!f.title) bad(`${where}: no "title" (what the scout reads).`);
      if (TYPES.indexOf(f.type) < 0) bad(`${where}: type "${f.type}" is not one of ${TYPES.join(', ')}.`);
      if ((f.type === 'select' || f.type === 'multiselect') && !(Array.isArray(f.options) && f.options.length)) bad(`${where}: a ${f.type} needs a list of "options".`);
      if (f.points != null && !isFinite(Number(f.points))) bad(`${where}: "points" must be a number.`);
      if (f.optionPoints) {
        const ks = (f.options || []).map((o) => String(o.k));
        Object.keys(f.optionPoints).forEach((k) => { if (ks.indexOf(k) < 0) bad(`${where}: "optionPoints" scores "${k}", which is not one of this field's options.`); });
      }
    });
  });
  NEEDED.forEach((c) => { if (!byCode[c]) bad(`The form has no "${c}" field. Both apps need it to match and group rows.`); });

  const scoring = Object.values(byCode).filter((f) => f.points != null || f.optionPoints);
  if (!scoring.length) warn('No field has point values ("points" or "optionPoints"), so every robot scores 0 in Analytics.');

  const d = (cfg.game && cfg.game.display) || {};
  ['autoCountCode', 'teleCountCode', 'defenseCode', 'climbCode'].forEach((k) => {
    if (d[k] && !byCode[d[k]]) bad(`game.display.${k} is "${d[k]}", but the form has no field with that code.`);
  });
  if (d.climbCode && byCode[d.climbCode] && d.climbLevels) {
    const ks = (byCode[d.climbCode].options || []).map((o) => String(o.k));
    d.climbLevels.forEach((l) => { if (ks.indexOf(String(l)) < 0) bad(`game.display.climbLevels lists "${l}", which is not an option of "${d.climbCode}".`); });
  }

  const t = cfg.game && cfg.game.tba;
  if (!t) warn('No "game.tba" block: Scout Trust will say it does not know this game and change nothing. Everything else works.');
  else {
    const opt = (code, v, what) => { if (v != null && byCode[code] && (byCode[code].options || []).every((o) => String(o.k) !== String(v))) bad(`game.tba ${what}: "${v}" is not an option of "${code}".`); };
    (t.counts || []).forEach((c, i) => {
      const w = `count ${i + 1} ("${c.label || c.key || '?'}")`;
      if (!c.key || !c.label) bad(`game.tba ${w}: needs a "key" and a "label".`);
      if (!byCode[c.field]) bad(`game.tba ${w}: field "${c.field}" is not on the form.`);
      if (!c.path) bad(`game.tba ${w}: needs a "path" into the official breakdown, like "hubScore.autoCount".`);
    });
    (t.robots || []).forEach((r, i) => {
      const w = `robot check ${i + 1} ("${r.label || r.key || '?'}")`;
      if (!r.key || !r.label) bad(`game.tba ${w}: needs a "key" and a "label".`);
      if (!byCode[r.field]) bad(`game.tba ${w}: field "${r.field}" is not on the form.`);
      if (!r.path || String(r.path).indexOf('{n}') < 0) bad(`game.tba ${w}: "path" must contain {n} for the robot's slot, like "endGameTowerRobot{n}".`);
      if (r.kind === 'yesno') {
        if (!Array.isArray(r.yes) || !r.yes.length) bad(`game.tba ${w}: a yesno check needs "yes" (official values that count as done).`);
        ['scoutedYes', 'scoutedNo', 'failed'].forEach((k) => opt(r.field, r[k], `${w} ${k}`));
      } else if (r.kind === 'levels') {
        if (!r.levels || !Object.keys(r.levels).length) bad(`game.tba ${w}: a levels check needs "levels" (official value -> form option).`);
        else Object.keys(r.levels).forEach((o) => opt(r.field, r.levels[o], `${w} level ${o}`));
        ['none', 'failed'].forEach((k) => opt(r.field, r[k], `${w} ${k}`));
      } else bad(`game.tba ${w}: kind must be "yesno" or "levels".`);
    });
  }
  return { errors, warnings };
}

module.exports = { validate, NEEDED, TYPES };

if (require.main === module) {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'config.json');
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`Could not read ${file} as JSON: ${e.message}`); process.exit(1); }
  const r = validate(cfg);
  r.warnings.forEach((w) => console.log('  note: ' + w));
  r.errors.forEach((e) => console.log('  PROBLEM: ' + e));
  console.log(r.errors.length ? `${r.errors.length} problem(s) in ${path.basename(file)}.` : `${path.basename(file)} is a valid game pack.`);
  process.exit(r.errors.length ? 1 : 0);
}
