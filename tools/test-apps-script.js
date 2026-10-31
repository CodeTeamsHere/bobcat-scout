/* Tests for the Google Sheet script (apps-script/Code.gs), run against a fake Sheet.
 *
 *   node tools/test-apps-script.js
 *
 * The script only runs inside Google, where a mistake shows up as a scout's match that
 * never arrived, or an Analytics app that reads nothing. This loads Code.gs with stand-ins
 * for Google's services and checks both jobs: saving what the scouting app sends, and
 * answering the Analytics app's "read" with those rows, only for the Analytics Password
 * (never the scouts' passcode, which every invite link carries).
 *
 * The fake Sheet stores values the way a real one does: text like "true" or "12" typed
 * into a cell becomes a tick box value or a number.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PASS = 'test-password';          // the scouts' passcode
const READ_PASS = 'test-read-password'; // the strategy team's Analytics Password

const { freshScript } = require('./fake-google');

// ---------------------------------------------------------------- checks
let pass = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) pass++;
  else failures.push({ name, detail });
}

const ORDER = ['scoutName', 'eventKey', 'matchNumber', 'matchType', 'teamNumber', 'alliance',
  'AutoScored', 'autoFuelScored', 'climbed', 'died', 'comments'];
let nextId = 1;
function match(over) {
  return Object.assign({
    passcode: PASS, _order: ORDER, _id: 'm' + nextId++,
    scoutName: 'Ada', eventKey: '2026ctwat', matchNumber: 1, matchType: 'qm', teamNumber: 177,
    alliance: 'red', AutoScored: true, autoFuelScored: 6, climbed: 'L2', died: false, comments: 'fast',
  }, over);
}

// ---- saving what the scouting app sends still works
{
  const s = freshScript();
  const a = s.call(match({}));
  check('a match report is saved', a.ok && a.action === 'added', JSON.stringify(a));
  const again = s.call(match({ _id: 'm1', autoFuelScored: 9 }));
  check('sending the same match again updates it', again.ok && again.action === 'updated', JSON.stringify(again));
  const wrong = s.call(match({ passcode: 'nope' }));
  check('a match with the wrong password is turned away', !wrong.ok && /wrong passcode/i.test(wrong.error), JSON.stringify(wrong));
}

// ---- reading it back
{
  const s = freshScript();
  s.call(match({ teamNumber: 177, matchNumber: 1 }));
  s.call(match({ teamNumber: 254, matchNumber: 1, alliance: 'blue', died: true }));
  s.call(match({ teamNumber: 118, matchNumber: 2, eventKey: '2026ctsou' }));
  s.call({ passcode: PASS, _form: 'pit', _order: ['scoutName', 'eventKey', 'teamNumber', 'drivetrain'],
    scoutName: 'Ada', eventKey: '2026ctwat', teamNumber: 177, drivetrain: 'swerve' });
  s.call(match({ teamNumber: 999, matchNumber: 9 }));
  s.call(match({ teamNumber: 195, matchNumber: 3 }));
  // Someone cleared a row's contents, leaving a blank row in the middle of the tab.
  const cleared = s.sheets.Data.rows.findIndex((r) => r && r.includes(999));
  s.sheets.Data.rows[cleared] = s.sheets.Data.rows[cleared].map(() => '');

  const before = JSON.stringify(s.sheets.Data.rows);
  const all = s.call({ action: 'read', passcode: READ_PASS, eventKey: '' });
  check('the right password reads every match', all.ok && all.data.length === 4, JSON.stringify(all).slice(0, 200));
  check('pit reports come back too', all.ok && all.pit.length === 1 && all.pit[0].drivetrain === 'swerve', JSON.stringify(all.pit));
  check('reading changes nothing in the Sheet', JSON.stringify(s.sheets.Data.rows) === before, 'the Data tab changed during a read');

  const row = (all.data || []).find((r) => r.teamNumber === 254) || {};
  check('each row is keyed by field code', row.scoutName === 'Ada' && row.alliance === 'blue', JSON.stringify(row));
  check('numbers come back as numbers', row.autoFuelScored === 6 && row.matchNumber === 1, JSON.stringify(row));
  check('tick boxes come back as true/false', row.died === true && row.AutoScored === true, JSON.stringify(row));
  check('the time it arrived comes back as text', typeof row._submittedAt === 'string' && !isNaN(Date.parse(row._submittedAt)),
    String(row._submittedAt));

  const one = s.call({ action: 'read', passcode: READ_PASS, eventKey: '2026CTWAT' });
  check('an event code keeps only that event (any capitals)', one.ok && one.data.length === 3 &&
    one.data.every((r) => r.eventKey === '2026ctwat'), JSON.stringify(one).slice(0, 200));

  const wrong = s.call({ action: 'read', passcode: 'nope' });
  check('a wrong password reads nothing', !wrong.ok && /wrong analytics password/i.test(wrong.error) && !wrong.data,
    JSON.stringify(wrong));
  const scout = s.call({ action: 'read', passcode: PASS });
  check('the scouts\' passcode reads nothing', !scout.ok && !scout.data, JSON.stringify(scout));
  const send = s.call(match({ passcode: READ_PASS, _id: 'from-analytics' }));
  check('the Analytics Password cannot send matches', !send.ok, JSON.stringify(send));
  const none = s.call({ action: 'read' });
  check('no password reads nothing', !none.ok && !none.data, JSON.stringify(none));
}

// ---- the event and date gates only stop saving, not reading
{
  const s = freshScript();
  s.call(match({}));
  s.setConfig('Active Event', '2026ctsou');
  s.setConfig('End Date', new Date(2020, 0, 1));
  const save = s.call(match({ _id: 'late' }));
  check('saving is closed by the event gate', !save.ok, JSON.stringify(save));
  const read = s.call({ action: 'read', passcode: READ_PASS, eventKey: '2026ctwat' });
  check('reading still works after submissions close', read.ok && read.data.length === 1, JSON.stringify(read));
}

// ---- Google login, if switched on, applies to reading too
{
  const s = freshScript();
  s.setConfig('Require Google Login', 'yes');
  const read = s.call({ action: 'read', passcode: READ_PASS });
  check('a read needs Google sign-in when the Sheet requires it', !read.ok && /google sign-in/i.test(read.error), JSON.stringify(read));
}

// ---- nothing can read until an Analytics Password is set
{
  const s = freshScript();
  s.call(match({}));
  s.setConfig('Analytics Password', '');
  const blank = s.call({ action: 'read', passcode: '' });
  check('with no Analytics Password, a blank password reads nothing', !blank.ok && /no analytics password/i.test(blank.error),
    JSON.stringify(blank));
  const scout = s.call({ action: 'read', passcode: PASS });
  check('with no Analytics Password, the scouts\' passcode reads nothing', !scout.ok && !scout.data, JSON.stringify(scout));
}

// ---- a Sheet made before the Analytics Password existed has no row for it
{
  const s = freshScript();
  const config = s.sheets.Config;
  const row = config.rows.findIndex((r) => r && r[0] === 'Analytics Password');
  config.rows[row] = ['', ''];
  const read = s.call({ action: 'read', passcode: '' });
  check('an old Config tab reads nothing', !read.ok && /no analytics password/i.test(read.error), JSON.stringify(read));
}

// ---- a brand-new Sheet reads as empty and is left alone
{
  const s = freshScript();
  const read = s.call({ action: 'read', passcode: READ_PASS });
  check('an empty Sheet reads as no rows', read.ok && read.data.length === 0 && read.pit.length === 0, JSON.stringify(read));
  check('reading never creates a tab', !s.sheets.Data && !s.sheets.Pit, Object.keys(s.sheets).join(', '));
}

// ---- pit photos: into a private Drive folder, ids on the team's Pit row
{
  const s = freshScript();
  const JPG = Buffer.from('fake jpeg bytes for team 177').toString('base64');
  const photo = (extra) => Object.assign({ action: 'pitPhoto', passcode: PASS, eventKey: '2026ctwat', teamNumber: 177, scoutName: 'Ada', mime: 'image/jpeg', data: 'data:image/jpeg;base64,' + JPG }, extra || {});

  const first = s.call(photo({ photoId: 'p1' }));
  check('a scout can add a pit photo with the passcode', first.ok && first.photos === 1 && /^file/.test(first.fileId), JSON.stringify(first));
  const folders = Object.values(s.drive.folders);
  check('the photo goes in the pit-photo folder', folders.length === 1 && folders[0].name === 'Bobcat Scout pit photos' && folders[0].files.length === 1, JSON.stringify(folders));
  check('the file is the photo, named by event and team', s.drive.files[first.fileId].name === '2026ctwat_177_p1.jpg' && Buffer.from(s.drive.files[first.fileId].bytes).toString() === 'fake jpeg bytes for team 177', s.drive.files[first.fileId].name);
  let pit = s.call({ action: 'read', passcode: READ_PASS, eventKey: '2026ctwat' }).pit;
  check('a photo before the report starts the team\'s Pit row', pit.length === 1 && pit[0].teamNumber === 177 && pit[0].photoIds === first.fileId, JSON.stringify(pit));

  // the report arrives after the photo: the photo ids stay
  s.call({ passcode: PASS, _form: 'pit', _order: ['scoutName', 'eventKey', 'teamNumber', 'drivetrain'], _id: 'pit_2026ctwat_177',
    scoutName: 'Ada', eventKey: '2026ctwat', teamNumber: 177, drivetrain: 'swerve' });
  pit = s.call({ action: 'read', passcode: READ_PASS, eventKey: '2026ctwat' }).pit;
  check('the report fills the same row and keeps the photo', pit.length === 1 && pit[0].drivetrain === 'swerve' && pit[0].photoIds === first.fileId, JSON.stringify(pit));

  const second = s.call(photo({ photoId: 'p2' }));
  check('a second photo is added to the list', second.ok && second.photos === 2, JSON.stringify(second));
  const again = s.call(photo({ photoId: 'p2' }));
  check('the same photo sent twice (a retry) is saved once', again.ok && again.duplicate === true && Object.values(s.drive.folders)[0].files.length === 2, JSON.stringify(again));

  // a re-sent report (say, a fixed typo) doesn't wipe the photos
  s.call({ passcode: PASS, _form: 'pit', _order: ['scoutName', 'eventKey', 'teamNumber', 'drivetrain'], _id: 'pit_2026ctwat_177',
    scoutName: 'Ada', eventKey: '2026ctwat', teamNumber: 177, drivetrain: 'tank' });
  pit = s.call({ action: 'read', passcode: READ_PASS, eventKey: '2026ctwat' }).pit;
  check('a re-sent report keeps both photos', pit.length === 1 && pit[0].drivetrain === 'tank' && String(pit[0].photoIds).split(',').length === 2, JSON.stringify(pit));

  // the phone checking its upload arrived (the upload itself can't be read back from the browser)
  const chk = s.call({ action: 'pitCheck', passcode: PASS, eventKey: '2026ctwat', teamNumber: 177 });
  check('the scout\'s phone can check how many photos arrived', chk.ok && chk.exists && chk.photos === 2, JSON.stringify(chk));
  const none = s.call({ action: 'pitCheck', passcode: PASS, eventKey: '2026ctwat', teamNumber: 4321 });
  check('a team with no pit report says so', none.ok && !none.exists && none.photos === 0, JSON.stringify(none));

  // what can't get in
  const filesBefore = Object.keys(s.drive.files).length;
  const wrong = s.call(photo({ passcode: 'nope', photoId: 'x1' }));
  check('a wrong passcode adds no photo', !wrong.ok && /wrong passcode/i.test(wrong.error) && Object.keys(s.drive.files).length === filesBefore, JSON.stringify(wrong));
  const pdf = s.call(photo({ mime: 'application/pdf', photoId: 'x2' }));
  check('only photos are accepted', !pdf.ok && /not a photo/i.test(pdf.error), JSON.stringify(pdf));
  const big = s.call(photo({ data: 'A'.repeat(3000001), photoId: 'x3' }));
  check('a photo that is far too big is refused', !big.ok && /too big/i.test(big.error), JSON.stringify(big).slice(0, 120));
  const noTeam = s.call(photo({ teamNumber: '', photoId: 'x4' }));
  check('a photo needs a team number', !noTeam.ok && /teamNumber/.test(noTeam.error), JSON.stringify(noTeam));
  check('none of those created a file', Object.keys(s.drive.files).length === filesBefore, String(Object.keys(s.drive.files).length));
  const chkWrong = s.call({ action: 'pitCheck', passcode: 'nope', eventKey: '2026ctwat', teamNumber: 177 });
  check('checking needs the passcode too', !chkWrong.ok, JSON.stringify(chkWrong));

  // at most six photos a team
  for (let i = 3; i <= 6; i++) s.call(photo({ photoId: 'p' + i }));
  const seventh = s.call(photo({ photoId: 'p7' }));
  check('a team keeps at most six photos', !seventh.ok && /already has 6/.test(seventh.error), JSON.stringify(seventh));

  // reading a photo back: Analytics Password only, and only from the pit-photo folder
  const got = s.call({ action: 'photo', passcode: READ_PASS, fileId: first.fileId });
  check('the Analytics Password reads a pit photo back', got.ok && got.mime === 'image/jpeg' && got.data === JPG, JSON.stringify(got).slice(0, 120));
  const scoutRead = s.call({ action: 'photo', passcode: PASS, fileId: first.fileId });
  check('the scouts\' passcode cannot read photos', !scoutRead.ok && !scoutRead.data, JSON.stringify(scoutRead));
  const elsewhere = s.call({ action: 'photo', passcode: READ_PASS, fileId: 'privateDocument12345' });
  check('a file outside the pit-photo folder can never be read', !elsewhere.ok && !elsewhere.data && /not found/i.test(elsewhere.error), JSON.stringify(elsewhere));
  const junk = s.call({ action: 'photo', passcode: READ_PASS, fileId: '../../x' });
  check('a made-up photo id is refused', !junk.ok && /bad photo id/i.test(junk.error), JSON.stringify(junk));
  const missing = s.call({ action: 'photo', passcode: READ_PASS, fileId: 'doesNotExist123456' });
  check('a photo that isn\'t there says so', !missing.ok && /not found/i.test(missing.error), JSON.stringify(missing));

  // the event gate applies to photos like to matches
  s.setConfig('Active Event', '2026ctwat');
  const otherEvent = s.call(photo({ eventKey: '2026cthar', photoId: 'z1' }));
  check('photos follow the Active Event gate', !otherEvent.ok && /not open for event/i.test(otherEvent.error), JSON.stringify(otherEvent));
}

// ---- a photo for a brand-new Sheet: the folder and the Pit tab are made on the way
{
  const s = freshScript();
  const r = s.call({ action: 'pitPhoto', passcode: PASS, eventKey: '2026ctwat', teamNumber: 254, scoutName: 'Bo', mime: 'image/png', data: Buffer.from('png').toString('base64') });
  check('the first photo on a new Sheet works', r.ok && r.photos === 1 && !!s.sheets.Pit, JSON.stringify(r));
  check('the folder is remembered for next time', !!s.props.PIT_PHOTO_FOLDER, JSON.stringify(s.props));
  const r2 = s.call({ action: 'pitPhoto', passcode: PASS, eventKey: '2026ctwat', teamNumber: 254, scoutName: 'Bo', mime: 'image/png', data: Buffer.from('png2').toString('base64') });
  check('and the second photo uses the same folder', r2.ok && Object.keys(s.drive.folders).length === 1, JSON.stringify(s.drive.folders));
}

// ---- super-scout notes: one row per robot per match per super-scout, in their own tab
{
  const s = freshScript();
  const SORDER = ['scoutName', 'eventKey', 'matchNumber', 'teamNumber', 'alliance', 'tags', 'driverRating', 'note'];
  // the app gives every note an id of its own (event, match, robot, scout), like this
  const sup = (over) => { const o = Object.assign({ passcode: PASS, _form: 'super', _order: SORDER, scoutName: 'Sam', eventKey: '2026ctwat', matchNumber: 7, teamNumber: 254, alliance: 'red', tags: 'Plays defense, Fast cycles', driverRating: 4, note: 'strong' }, over); if (!over || !over._id) o._id = ['sup', o.eventKey, o.matchNumber, o.teamNumber, o.scoutName].join('_'); return o; };
  const a = s.call(sup({}));
  check('a super-scout note is saved in its own Super tab', a.ok && a.action === 'added' && a.form === 'super' && !!s.sheets.Super && !s.sheets.Data, JSON.stringify(a));
  const header = s.sheets.Super.rows[0], row = s.sheets.Super.rows[1];
  check('the columns are who, event, match, team, tags, rating, note', ['scoutName', 'eventKey', 'matchNumber', 'teamNumber', 'tags', 'driverRating', 'note'].every((k) => header.indexOf(k) >= 0), JSON.stringify(header));
  check('the tags and note are kept as sent', row[header.indexOf('tags')] === 'Plays defense, Fast cycles' && row[header.indexOf('note')] === 'strong', JSON.stringify(row));
  const again = s.call(sup({ note: 'changed my mind', driverRating: 5 }));
  check('the same super-scout, match and robot again updates the row (no duplicate)', again.action === 'updated' && s.sheets.Super.rows.length === 2, JSON.stringify(again));
  const other = s.call(sup({ scoutName: 'Dee' }));
  check('a second super-scout on the same robot gets their own row', other.action === 'added' && s.sheets.Super.rows.length === 3, JSON.stringify(other));
  const other2 = s.call(sup({ teamNumber: 118 }));
  check('and another robot in the same match too', other2.action === 'added' && s.sheets.Super.rows.length === 4, JSON.stringify(other2));
  check('the wrong passcode is turned away', /wrong passcode/i.test(s.call(sup({ passcode: 'nope' })).error || ''));
  check('a match number out of range is refused', !s.call(sup({ matchNumber: 999 })).ok);
  check('a driver rating of 9 is refused', /1 to 5/.test(s.call(sup({ driverRating: 9 })).error || ''));
  check('no rating at all is fine (tags only)', s.call(sup({ teamNumber: 971, driverRating: '' })).ok);
  check('a missing team is refused', /teamNumber/.test(s.call(sup({ teamNumber: '' })).error || ''));
  check('a note that is far too long is refused', /too long/.test(s.call(sup({ teamNumber: 33, note: 'x'.repeat(500) })).error || ''));
  check('super rows follow the Active Event gate', (() => { s.setConfig('Active Event', '2026ctwat'); const r = s.call(sup({ eventKey: '2026cthar', teamNumber: 55 })); return !r.ok && /not open for event/i.test(r.error); })());
  const rd = s.call({ action: 'read', passcode: READ_PASS, eventKey: '2026ctwat' });
  check('the Analytics Password reads the super rows back, with the data and pit rows', rd.ok && Array.isArray(rd.sup) && rd.sup.length === 4 && rd.sup[0].tags === 'Plays defense, Fast cycles' && Array.isArray(rd.data) && Array.isArray(rd.pit), JSON.stringify(rd).slice(0, 200));
  check('the scouts\' passcode cannot read them', !s.call({ action: 'read', passcode: PASS, eventKey: '2026ctwat' }).ok);
}

// ---- personal codes: each person's own code, off until the lead turns it on
{
  const people = (s, rows) => { const sh = s.sandbox.getPeopleSheet_(s.ss); rows.forEach((r) => sh.appendRow(r)); return sh; };
  const SORDER2 = ['scoutName', 'eventKey', 'matchNumber', 'teamNumber', 'alliance', 'tags', 'driverRating', 'note'];
  const sup = (code, over) => Object.assign({ passcode: code, _form: 'super', _order: SORDER2, _id: 'sup_p_' + Math.random(), scoutName: 'Spoofed Name', eventKey: '2026ctwat', matchNumber: 3, teamNumber: 254, tags: 'Fast cycles', driverRating: 4, note: '' }, over);

  // off by default: nothing changes
  {
    const s = freshScript();
    check('a new Sheet has the Personal Codes setting, set to no', s.sandbox.getConfig_().personal === false);
    people(s, [['Ada', 'ABC234', 'scout', 'yes', '']]);
    check('with it off, the shared passcode works and a personal code does not', s.call(match({})).ok && !s.call(match({ passcode: 'ABC234' })).ok);
    check('with it off, whoami just checks the shared passcode', s.call({ action: 'whoami', passcode: PASS }).ok && s.call({ action: 'whoami', passcode: PASS }).personal === false && !s.call({ action: 'whoami', passcode: 'nope' }).ok);
  }

  // on: the people in the People tab, and only them
  {
    const s = freshScript();
    people(s, [['Ada Scout', 'abc-234', 'scout', 'yes', ''], ['Bo Lead', 'LEAD77', 'lead', '', ''], ['Cy Strategy', 'STRAT9', 'Strategy', 'yes', ''], ['Di Gone', 'GONE22', 'scout', 'no', ''], ['Ed Odd', 'ODD123', 'wizard', 'yes', '']]);
    s.setConfig('Personal Codes', 'yes');
    const sendAs = (code, over) => s.call(match(Object.assign({ passcode: code, scoutName: 'Spoofed Name' }, over || {})));
    const a = sendAs('ABC234', { teamNumber: 971 });
    check('a personal code sends a match, whatever case or dashes it is typed with', a.ok, JSON.stringify(a));
    check('the row carries the code owner\'s name, not the name the phone sent', s.sheets.Data.rows[1][s.sheets.Data.rows[0].indexOf('scoutName')] === 'Ada Scout', JSON.stringify(s.sheets.Data.rows[1]));
    check('the shared passcode no longer works', /code not recognised/i.test(sendAs(PASS, { teamNumber: 972 }).error || ''));
    check('no code at all', /code not recognised/i.test(sendAs('', { teamNumber: 973 }).error || ''));
    check('a wrong code', /code not recognised/i.test(sendAs('ZZZZZZ', { teamNumber: 974 }).error || ''));
    check('a lead (Active left blank) sends too', sendAs('lead77', { teamNumber: 975 }).ok);
    check('a code that is turned off is refused, and says so', /turned off/i.test(sendAs('GONE22', { teamNumber: 976 }).error || ''));
    check('a strategy code can read but not send', /read the data but not send/i.test(sendAs('STRAT9', { teamNumber: 977 }).error || ''));
    check('a role that is not scout, lead or strategy gets no access and the error says why', /"wizard".*not scout, lead or strategy/i.test(sendAs('ODD123', { teamNumber: 978 }).error || ''));
    // pit, photo, super: the name is forced there too
    const sp = s.call(sup('ABC234'));
    check('a super-scout note under a personal code is saved under the person\'s name', sp.ok && s.sheets.Super.rows[1][s.sheets.Super.rows[0].indexOf('scoutName')] === 'Ada Scout', JSON.stringify(sp));
    const ph = s.call({ action: 'pitPhoto', passcode: 'ABC234', eventKey: '2026ctwat', teamNumber: 254, scoutName: 'Spoofed Name', mime: 'image/png', data: Buffer.from('png').toString('base64') });
    check('a photo under a personal code works', ph.ok && ph.photos === 1, JSON.stringify(ph));
    check('the pit row it started carries the real name', s.sheets.Pit.rows[1][s.sheets.Pit.rows[0].indexOf('scoutName')] === 'Ada Scout', JSON.stringify(s.sheets.Pit.rows[1]));
    check('pitCheck follows the same gate', !s.call({ action: 'pitCheck', passcode: PASS, eventKey: '2026ctwat', teamNumber: 254 }).ok && s.call({ action: 'pitCheck', passcode: 'ABC234', eventKey: '2026ctwat', teamNumber: 254 }).ok);
    // reading
    check('a scout\'s code cannot read the data', /scouting only/i.test(s.call({ action: 'read', passcode: 'ABC234', eventKey: '2026ctwat' }).error || ''));
    check('a strategy code can read', s.call({ action: 'read', passcode: 'STRAT9', eventKey: '2026ctwat' }).ok);
    check('a lead\'s code can read', s.call({ action: 'read', passcode: 'LEAD77', eventKey: '2026ctwat' }).ok);
    check('the Analytics Password still reads until it is blanked', s.call({ action: 'read', passcode: READ_PASS, eventKey: '2026ctwat' }).ok);
    s.setConfig('Analytics Password', '');
    check('blank the Analytics Password and only people can read', !s.call({ action: 'read', passcode: READ_PASS, eventKey: '2026ctwat' }).ok && s.call({ action: 'read', passcode: 'STRAT9', eventKey: '2026ctwat' }).ok);
    check('the shared scouts\' passcode cannot read either', !s.call({ action: 'read', passcode: PASS, eventKey: '2026ctwat' }).ok);
    check('a strategy code can read a photo, a scout code cannot', (() => { const id = ph.fileId; return s.call({ action: 'photo', passcode: 'STRAT9', fileId: id }).ok && !s.call({ action: 'photo', passcode: 'ABC234', fileId: id }).ok; })());
    // whoami
    const w = s.call({ action: 'whoami', passcode: 'abc 234' });
    check('whoami says the name and role, and what the code may do', w.ok && w.personal === true && w.name === 'Ada Scout' && w.role === 'scout' && w.canSend === true && w.canRead === false, JSON.stringify(w));
    check('whoami for a strategy person', (() => { const x = s.call({ action: 'whoami', passcode: 'STRAT9' }); return x.ok && x.canSend === false && x.canRead === true; })());
    check('whoami refuses an unknown code', !s.call({ action: 'whoami', passcode: 'nope' }).ok);
    // revoking one person leaves the others working
    const sh = s.ss.getSheetByName('People'); sh.rows[1][3] = 'no';
    check('turn one person off: their code stops, the others keep working', !sendAs('ABC234', { teamNumber: 979 }).ok && sendAs('LEAD77', { teamNumber: 980 }).ok);
    // last seen
    check('last seen is written (once per few minutes)', s.ss.getSheetByName('People').rows[2][4] instanceof Date || typeof s.ss.getSheetByName('People').rows[2][4] === 'object', JSON.stringify(s.ss.getSheetByName('People').rows[2]));
    const stamp = s.ss.getSheetByName('People').rows[2][4]; s.call(sendAs.bind(null) ? { action: 'whoami', passcode: 'LEAD77' } : {});
    check('and not rewritten on every request', s.ss.getSheetByName('People').rows[2][4] === stamp);
  }

  // switched on but nobody listed
  {
    const s = freshScript(); s.setConfig('Personal Codes', 'yes');
    check('on, with nobody in the People tab: a clear error, nothing is accepted', /nobody in it/i.test(s.call(match({})).error || '') && !s.call(match({ passcode: PASS })).ok);
  }

  // event gate still applies, and Google login (if on) still applies on top
  {
    const s = freshScript(); s.setConfig('Personal Codes', 'yes'); s.setConfig('Active Event', '2026ctwat');
    s.sandbox.getPeopleSheet_(s.ss).appendRow(['Ada', 'ABC234', 'scout', 'yes', '']);
    check('the event gate still applies to a personal code', /not open for event/i.test(s.call(match({ passcode: 'ABC234', eventKey: '2026cthar' })).error || '') && s.call(match({ passcode: 'ABC234' })).ok);
  }

  // making codes
  {
    const s = freshScript();
    const sh = s.sandbox.getPeopleSheet_(s.ss);
    sh.appendRow(['Ada', '', '', '', '']); sh.appendRow(['Bo', 'KEEP22', 'lead', 'yes', '']); sh.appendRow(['', 'ORPHAN', '', '', '']); sh.appendRow(['Cy', '', 'strategy', '', '']);
    const made = s.sandbox.makePersonalCodes();
    const rows = s.ss.getSheetByName('People').rows;
    check('codes are made for people who have none (2 of 3 names; a row with no name is ignored)', made === 2, made);
    check('a code that was already there is kept, and blank role and active are filled in', rows[2][1] === 'KEEP22' && rows[1][2] === 'scout' && rows[1][3] === 'yes' && rows[4][2] === 'strategy' && rows[4][3] === 'yes', JSON.stringify(rows));
    check('each made code is 6 characters from the readable alphabet (no 0 O 1 I)', [rows[1][1], rows[4][1]].every((c) => /^[A-HJ-NP-Z2-9]{6}$/.test(c)), [rows[1][1], rows[4][1]]);
    check('they are different', rows[1][1] !== rows[4][1]);
    check('a row with no name gets no role or active added', rows[3][2] === '' && rows[3][3] === '', JSON.stringify(rows[3]));
    check('running it again changes nothing', s.sandbox.makePersonalCodes() === 0);
    // a collision with an existing code is skipped over
    const s2 = freshScript(); const sh2 = s2.sandbox.getPeopleSheet_(s2.ss); sh2.appendRow(['Taken', 'AAAAAA', 'scout', 'yes', '']); sh2.appendRow(['New', '', '', '', '']);
    let calls = 0; const seq = [0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];   // first try is AAAAAA (taken), second is not
    s2.sandbox.makePersonalCodes(() => seq[calls++ % seq.length]);
    check('a code someone already has is never handed out twice', s2.ss.getSheetByName('People').rows[2][1] !== 'AAAAAA' && /^[A-Z2-9]{6}$/.test(s2.ss.getSheetByName('People').rows[2][1]), JSON.stringify(s2.ss.getSheetByName('People').rows));
  }

  // an older Sheet gets the new Config row, once, without disturbing the others
  {
    const s = freshScript();
    const cfg = s.ss.getSheetByName('Config');
    const idx = cfg.rows.findIndex((r) => r && String(r[0]) === 'Personal Codes'); cfg.rows[idx] = ['', ''];   // an old Sheet: no such row
    check('an old Sheet reads as personal codes off', s.sandbox.getConfig_().personal === false);
    s.sandbox.ensureConfigRow_(s.ss, 'Personal Codes', 'no'); s.sandbox.ensureConfigRow_(s.ss, 'Personal Codes', 'no');
    check('the row is added once, and the passcode row is untouched', cfg.rows.filter((r) => r && String(r[0]) === 'Personal Codes').length === 1 && cfg.rows.some((r) => r && r[0] === 'Passcode' && r[1] === PASS), JSON.stringify(cfg.rows.slice(0, 14)));
  }
}

// ---------------------------------------------------------------- report
if (failures.length) {
  console.log(`\n${pass} passed, ${failures.length} FAILED\n`);
  for (const f of failures) console.log(`  x ${f.name}\n      ${f.detail}\n`);
  process.exit(1);
}
console.log(`\nAll ${pass} Sheet script checks passed.\n`);
