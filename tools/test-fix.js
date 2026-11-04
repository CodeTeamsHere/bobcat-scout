/* Tests for fixing a match that was already saved or sent (fix-core.js).
 *
 *   node tools/test-fix.js
 *
 * A fix must REPLACE the Sheet row, never add a second one. That works because the fixed
 * copy keeps the original match id. This checks the lists on the phone (saved matches, the
 * waiting-to-send queue) and then runs the whole story against the real Sheet script
 * (apps-script/Code.gs) on a fake Sheet.
 */
const FIX = require('../fix-core.js');
const { freshScript } = require('./fake-google');

let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) pass++;
  else failures.push({ name, detail });
}

const PASS = 'test-password';
const ORDER = ['scoutName', 'eventKey', 'matchNumber', 'matchType', 'teamNumber', 'alliance',
  'autoFuelScored', 'noShow', 'co'];
// What the app puts in the Sheet message for a saved copy (app.js buildPayload does the same).
function payloadOf(saved) {
  const p = Object.assign({}, saved);
  delete p._ts;
  return Object.assign(p, { passcode: PASS, _order: ORDER });
}
function saved(over) {
  return Object.assign({ scoutName: 'Ada', eventKey: '2026ctwat', matchType: 'qm', matchNumber: 4, teamNumber: 117,
    alliance: 'red', autoFuelScored: 6, noShow: false, co: 'fast', _ts: 1000, _id: 'mA' }, over);
}

// ---- the saved list
{
  const list = [saved({ _id: 'm1', matchNumber: 1 }), saved({ _id: 'm2', matchNumber: 2 }), saved({ _id: 'm3', matchNumber: 3 })];
  check('a saved match is found by its id', FIX.findSaved(list, 'm2').matchNumber === 2);
  check('an unknown or missing id finds nothing', FIX.findSaved(list, 'zz') === null && FIX.findSaved(list, undefined) === null);

  const fixedCopy = FIX.fixedCopy(Object.assign(FIX.formValues(list[1]), { teamNumber: 177 }), 'm2', 5000);
  const after = FIX.replaceSaved(list, fixedCopy);
  check('the fixed copy replaces the old one, not added', after.length === 3, 'length ' + after.length);
  check('and keeps its place in the list', after[1].teamNumber === 177 && after[0]._id === 'm1' && after[2]._id === 'm3');
  check('the original list is not changed', list[1].teamNumber === 117);
  const fresh = FIX.replaceSaved(list, saved({ _id: 'm9' }));
  check('a copy with a new id is added at the end', fresh.length === 4 && fresh[3]._id === 'm9');
}

// ---- the form values and the fixed copy
{
  const s = saved({});
  const v = FIX.formValues(s);
  check('the form gets the fields but not the bookkeeping', v.teamNumber === 117 && !('_id' in v) && !('_ts' in v), JSON.stringify(v));
  const c = FIX.fixedCopy(Object.assign({}, v, { teamNumber: 177, _ts: 1 }), s._id, 9000);
  check('the fixed copy keeps the ORIGINAL id (so the Sheet replaces the row)', c._id === 'mA');
  check('the fixed copy carries the new value and a new time', c.teamNumber === 177 && c._ts === 9000);
}

// ---- the waiting-to-send queue
{
  const q0 = [{ url: 'u', payload: payloadOf(saved({ _id: 'mA' })) }, { url: 'u', payload: payloadOf(saved({ _id: 'mB' })) }];
  const fixed = payloadOf(saved({ _id: 'mA', teamNumber: 177 }));
  const q1 = FIX.queueWith(q0, fixed, 'u');
  check('a fix of a match still waiting REPLACES the queued one', q1.filter((p) => FIX.queuedId(p) === 'mA').length === 1 && q1.length === 2,
    JSON.stringify(q1.map(FIX.queuedId)));
  check('the queued copy is the fixed one', q1.find((p) => FIX.queuedId(p) === 'mA').payload.teamNumber === 177);
  check('the other waiting match is untouched', q1.some((p) => FIX.queuedId(p) === 'mB'));
  check('queueWith does not change the list it was given', q0.length === 2 && q0[0].payload.teamNumber === 117);
  check('isQueued says which matches wait', FIX.isQueued(q1, 'mA') && !FIX.isQueued(q1, 'zz'));
  check('older bare payloads in the queue are understood', FIX.queuedId({ _id: 'old' }) === 'old' && FIX.queueWith([{ _id: 'old' }], { _id: 'old', x: 1 }, 'u').length === 1);
  const q2 = FIX.queueWithout(q1, 'mA');
  check('once a match is in the Sheet nothing for it stays queued', q2.length === 1 && FIX.queuedId(q2[0]) === 'mB');
}

// ---- mark as a mistake (uses only fields the Sheet already has)
{
  const m = FIX.mistakeCopy(saved({}), 7000);
  check('a mistake keeps the id', m._id === 'mA');
  check('a mistake ticks No Show and says so in the comment', m.noShow === true && m.co === FIX.MISTAKE_NOTE && /mistake/i.test(m.co));
  check('the rest of the match is kept', m.teamNumber === 117 && m.matchNumber === 4);
  check('isMistake recognises it, and not a normal match', FIX.isMistake(m) && !FIX.isMistake(saved({})));
}

// ---- the match in progress
{
  const blank = { scoutName: '', eventKey: '', matchNumber: '', teamNumber: '', matchType: 'qm', autoFuelScored: 0, co: '' };
  const mine = Object.assign({}, blank, { scoutName: 'Ada', eventKey: '2026ctwat', matchNumber: 5, teamNumber: 254 });
  check('only the four identity boxes filled: nothing worth setting aside', !FIX.draftHasContent(mine, blank, '', {}));
  check('a number entered counts', FIX.draftHasContent(Object.assign({}, mine, { autoFuelScored: 3 }), blank, '', {}));
  check('typed text counts', FIX.draftHasContent(mine, blank, 'they climbed', {}));
  check('anything filled in counts', FIX.draftHasContent(mine, blank, '', { co: 'high' }));
}

// ---- the whole story against the real Sheet script on a fake Sheet
{
  const s = freshScript();
  const original = saved({ _id: 'mA', teamNumber: 117 });          // typo: should have been 177
  const other = saved({ _id: 'mB', matchNumber: 5, teamNumber: 254 });
  const a = s.call(payloadOf(original));
  s.call(payloadOf(other));
  check('the first send adds a row', a.ok && a.action === 'added', JSON.stringify(a));
  const rows = () => s.sheets.Data.rows.length;
  const before = rows();

  // fix the team number: same id, new value
  const fixed = FIX.fixedCopy(Object.assign(FIX.formValues(original), { teamNumber: 177 }), original._id, 2000);
  const b = s.call(payloadOf(fixed));
  check('the fix is reported as updated', b.ok && b.action === 'updated', JSON.stringify(b));
  check('the Sheet has no second row', rows() === before, rows() + ' vs ' + before);
  const header = s.sheets.Data.rows[0];
  const teamCol = header.indexOf('teamNumber');
  const teams = s.sheets.Data.rows.slice(1).map((r) => r[teamCol]);
  check('the row now shows the corrected team, and the typo is gone', teams.includes(177) && !teams.includes(117), JSON.stringify(teams));
  check('the other match is untouched', teams.includes(254));

  // sending the same fix again is harmless
  const c = s.call(payloadOf(fixed));
  check('sending the fix twice still gives one row', c.ok && rows() === before);

  // a fix that changes the match number (the id, not the key columns, finds the row)
  const fixed2 = FIX.fixedCopy(Object.assign(FIX.formValues(fixed), { matchNumber: 40 }), original._id, 3000);
  const d = s.call(payloadOf(fixed2));
  check('changing the match number also replaces, not adds', d.ok && d.action === 'updated' && rows() === before, JSON.stringify(d));

  // mark as a mistake
  const mk = s.call(payloadOf(FIX.mistakeCopy(fixed2, 4000)));
  const noShowCol = header.indexOf('noShow'), coCol = header.indexOf('co');
  const row = s.sheets.Data.rows.find((r) => r[teamCol] === 177);
  check('a mistake updates the same row', mk.ok && mk.action === 'updated' && rows() === before, JSON.stringify(mk));
  check('and marks it No Show with the note', row[noShowCol] === true && row[coCol] === FIX.MISTAKE_NOTE, JSON.stringify(row));
}

// ---- offline story: the original is still queued when the scout fixes it
{
  const s = freshScript();
  let queue = [];
  const original = saved({ _id: 'mQ', teamNumber: 117 });
  queue = FIX.queueWith(queue, payloadOf(original), 'u');                 // offline: queued
  const fixed = FIX.fixedCopy(Object.assign(FIX.formValues(original), { teamNumber: 177 }), 'mQ', 2000);
  queue = FIX.queueWith(queue, payloadOf(fixed), 'u');                    // fixed while still offline
  check('offline: one queued item after the fix', queue.length === 1);
  queue.forEach((item) => s.call(item.payload));                         // back online: the queue flushes
  const header = s.sheets.Data.rows[0];
  const teams = s.sheets.Data.rows.slice(1).map((r) => r[header.indexOf('teamNumber')]);
  check('offline: the Sheet gets one row with the fixed team', teams.length === 1 && teams[0] === 177, JSON.stringify(teams));
}

if (failures.length) {
  console.error('FAILED ' + failures.length + ' of ' + (pass + failures.length) + ' checks:');
  failures.forEach((f) => console.error('  - ' + f.name + (f.detail ? ' :: ' + f.detail : '')));
  process.exit(1);
}
console.log('test-fix: all ' + pass + ' checks passed');
