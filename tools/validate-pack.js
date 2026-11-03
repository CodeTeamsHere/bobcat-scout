'use strict';
/* Checks a game pack (config.json) and says what is wrong in plain words.
 *
 *   node tools/validate-pack.js                 checks config.json
 *   node tools/validate-pack.js some-pack.json  checks another file
 *
 * The checks themselves live in pack-core.js (shared with the new-game page).
 */
const fs = require('fs');
const path = require('path');
const core = require('../pack-core.js');

module.exports = { validate: core.validate, NEEDED: core.NEEDED, TYPES: core.TYPES };

if (require.main === module) {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', 'config.json');
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`Could not read ${file} as JSON: ${e.message}`); process.exit(1); }
  const r = core.validate(cfg);
  r.warnings.forEach((w) => console.log('  note: ' + w));
  r.errors.forEach((e) => console.log('  PROBLEM: ' + e));
  console.log(r.errors.length ? `${r.errors.length} problem(s) in ${path.basename(file)}.` : `${path.basename(file)} is a valid game pack.`);
  process.exit(r.errors.length ? 1 : 0);
}
