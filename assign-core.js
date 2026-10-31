/* Scout assignment logic with no page (tools/test-assign.js tests it): which of a scout's shifts is the one to
 * look at next, which team that station is in a match, and the words for the strip under the header.
 * A shift is { from, to, station } with station R1-R3, B1-B3 or BREAK (the lead publishes the rotation from Analytics). */
(function (root) {
  'use strict';

  var NAMES = { R1: 'Red 1', R2: 'Red 2', R3: 'Red 3', B1: 'Blue 1', B2: 'Blue 2', B3: 'Blue 3', BREAK: 'a break' };

  function stationName(s) { return NAMES[s] || String(s || ''); }

  /** The team in a station of a match, from the loaded schedule ({ matches: { "14": { red: ['frc177', ...], blue: [...] } } }), or ''. */
  function teamAt(schedule, match, station) {
    var m = schedule && schedule.matches ? schedule.matches[String(match)] : null;
    if (!m || !/^[RB][1-3]$/.test(String(station))) return '';
    var list = station.charAt(0) === 'R' ? m.red : m.blue, t = list && list[Number(station.charAt(1)) - 1];
    return t ? String(t).replace(/^frc/i, '') : '';
  }

  /**
   * What to show for the match after `lastMatch` (the last one this scout sent; 0 if none).
   * Returns { state: 'now' | 'later' | 'done' | 'none', shift, match }.
   */
  function nextShift(shifts, lastMatch) {
    var list = (shifts || []).filter(function (s) { return s && s.to >= s.from; }).sort(function (a, b) { return a.from - b.from; });
    if (!list.length) return { state: 'none', shift: null, match: null };
    var want = (Number(lastMatch) || 0) + 1;
    for (var i = 0; i < list.length; i++) {
      if (want >= list[i].from && want <= list[i].to) return { state: 'now', shift: list[i], match: want };
      if (list[i].from > want) return { state: 'later', shift: list[i], match: list[i].from };
    }
    return { state: 'done', shift: null, match: null };
  }

  /** The line for the strip: what to do next, in plain words. */
  function stripText(next, schedule) {
    if (!next || next.state === 'none') return '';
    if (next.state === 'done') return 'No more shifts on the rotation.';
    var s = next.shift, range = 'Q' + s.from + (s.to > s.from ? '–' + s.to : '');
    if (next.state === 'later') {
      if (s.station === 'BREAK') return 'Break until Q' + s.to + '. (Your next shift after it comes up then.)';
      var t0 = teamAt(schedule, s.from, s.station);
      return 'Next shift: ' + range + ', ' + stationName(s.station) + (t0 ? ' (team ' + t0 + ' in Q' + s.from + ')' : '') + '.';
    }
    if (s.station === 'BREAK') return 'You are on a break until Q' + s.to + '. Take it.';
    var t = teamAt(schedule, next.match, s.station);
    return 'Scout ' + stationName(s.station) + (t ? ' (team ' + t + ')' : '') + ' in Q' + next.match + (s.to > next.match ? ', through Q' + s.to : '') + '.';
  }

  /** A short list of all the shifts: "Q1–4 Red 1 · Q5–8 break". */
  function summary(shifts) {
    return (shifts || []).slice().sort(function (a, b) { return a.from - b.from; }).map(function (s) {
      return 'Q' + s.from + (s.to > s.from ? '–' + s.to : '') + ' ' + (s.station === 'BREAK' ? 'break' : stationName(s.station));
    }).join(' · ');
  }

  /** The highest match number this scout has sent for this event (0 if none). sessionMatches: [{ eventKey, matchNumber }]. */
  function lastSent(sessionMatches, eventKey) {
    var ek = String(eventKey || '').toLowerCase(), best = 0;
    (sessionMatches || []).forEach(function (m) {
      if (ek && String(m.eventKey || '').toLowerCase() !== ek) return;
      var n = parseInt(m.matchNumber, 10); if (n > best) best = n;
    });
    return best;
  }

  var ASSIGN = { stationName: stationName, teamAt: teamAt, nextShift: nextShift, stripText: stripText, summary: summary, lastSent: lastSent };
  if (typeof module !== 'undefined' && module.exports) module.exports = ASSIGN;
  else root.ASSIGN_CORE = ASSIGN;
})(typeof window !== 'undefined' ? window : this);
