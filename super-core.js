/* Super-scout logic with no page (tools/test-super.js tests it): which six robots are in a match, checking
 * the notes, and the rows sent to the Sheet's Super tab. One row per robot per match per super-scout;
 * a robot with nothing noted gets no row. */
(function (root) {
  'use strict';

  function str(v) { return v == null ? '' : String(v).trim(); }
  function teamNum(x) { return str(x).replace(/^frc/i, ''); }

  /** Every tag the form offers. */
  function allTags(form) { var out = []; (form.groups || []).forEach(function (g) { (g.tags || []).forEach(function (t) { out.push(t); }); }); return out; }

  /** The six robots in a match from the loaded schedule ({ "14": { red: ['frc1',..], blue: [..] } }), or []. */
  function robotsFor(scheduleCache, matchNumber) {
    var m = scheduleCache && scheduleCache.matches ? scheduleCache.matches[String(matchNumber)] : null;
    if (!m) return [];
    var out = [];
    (m.red || []).forEach(function (t) { out.push({ team: teamNum(t), alliance: 'red' }); });
    (m.blue || []).forEach(function (t) { out.push({ team: teamNum(t), alliance: 'blue' }); });
    return out;
  }

  /** Does this robot's entry say anything? ({ team, tags: [], rating, note }) */
  function hasNotes(e) { return !!((e.tags && e.tags.length) || str(e.rating) || str(e.note)); }

  /** Problems to fix before sending: [] when fine. */
  function check(form, meta, match, entries) {
    var out = [], m = Number(str(match));
    if (!str(meta && meta.scoutName)) out.push('Your name is missing: finish SETUP first.');
    if (!str(meta && meta.eventKey)) out.push('The event code is missing: finish SETUP first.');
    if (!str(match) || !isFinite(m) || Math.floor(m) !== m || m < 1 || m > 200) out.push('Type the match number (1 to 200).');
    var used = (entries || []).filter(hasNotes);
    if (!used.length) out.push('Note at least one robot (a tag, a rating or a few words).');
    var known = allTags(form);
    used.forEach(function (e) {
      var t = Number(teamNum(e.team));
      if (!isFinite(t) || t < 1 || t > 99999 || Math.floor(t) !== t) out.push('A robot has no valid team number.');
      (e.tags || []).forEach(function (tag) { if (known.indexOf(tag) < 0) out.push('"' + tag + '" is not one of the tags.'); });
      if (str(e.rating) && !(Number(e.rating) >= 1 && Number(e.rating) <= 5)) out.push(teamNum(e.team) + ': the rating is 1 to 5.');
      if (str(e.note).length > (form.maxNote || 300)) out.push(teamNum(e.team) + ': the note is too long.');
    });
    var seen = {}; used.forEach(function (e) { var t = teamNum(e.team); if (seen[t]) out.push('Team ' + t + ' is listed twice.'); seen[t] = 1; });
    return out;
  }

  /** The rows for the Sheet (the passcode is added when they are sent). */
  function buildRows(form, meta, match, entries) {
    var ek = str(meta.eventKey).toLowerCase(), m = Number(str(match)), scout = str(meta.scoutName);
    var order = ['scoutName', 'eventKey', 'matchNumber', 'teamNumber', 'alliance', 'tags', 'driverRating', 'note'];
    var known = allTags(form);
    return (entries || []).filter(hasNotes).map(function (e) {
      var t = Number(teamNum(e.team));
      return {
        _form: 'super', _id: ['sup', ek, m, t, scout.toLowerCase().replace(/[^a-z0-9]+/g, '-')].join('_'), _order: order,
        scoutName: scout, eventKey: ek, matchNumber: m, teamNumber: t, alliance: e.alliance === 'blue' ? 'blue' : (e.alliance === 'red' ? 'red' : ''),
        tags: (e.tags || []).filter(function (x) { return known.indexOf(x) >= 0; }).join(', '),
        driverRating: str(e.rating) ? Number(e.rating) : '', note: str(e.note).slice(0, form.maxNote || 300)
      };
    });
  }

  var SUPER = { allTags: allTags, robotsFor: robotsFor, hasNotes: hasNotes, check: check, buildRows: buildRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = SUPER;
  else root.SUPER_CORE = SUPER;
})(typeof window !== 'undefined' ? window : this);
