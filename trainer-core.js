/* The scout trainer's grading (no page needed, so tools/test-trainer.js can test it).
 *
 * A scout watches a real past match and scouts the three robots of one alliance. The Blue Alliance's
 * official score breakdown gives the alliance's fuel counts and each robot's climbs, so:
 *   - climbs are checked robot by robot, exactly;
 *   - counts are checked for the alliance: what the three robots add up to against the official number
 *     (the official count is for the whole alliance, so one robot's count can't be checked alone).
 * The feedback is meant to teach: it says what the field recorded and what to try, and never calls a
 * scout "wrong".
 */
(function (root) {
  'use strict';

  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  /** How close a count is: spot on, close, a bit off, or worth another look. */
  function band(diff, official) {
    var d = Math.abs(diff);
    if (d <= Math.max(2, 0.08 * official)) return 'spot';
    if (d <= Math.max(4, 0.2 * official)) return 'close';
    if (d <= Math.max(8, 0.35 * official)) return 'off';
    return 'far';
  }
  function countScore(diff, official) { return Math.round(100 * clamp(1 - Math.abs(diff) / Math.max(4, 0.4 * official), 0, 1)); }
  var BAND_TEXT = { spot: 'Spot on', close: 'Close', off: 'A bit off', far: 'Worth another look' };

  function countTip(diff, label, official) {
    if (band(diff, official) === 'spot') return diff === 0 ? 'Exactly what the field recorded.' : 'Within a ball or two of the field. That is as good as a person can count.';
    var phase = /auto/i.test(label) ? 'auto' : 'teleop';
    if (diff > 0) {
      return 'You counted ' + Math.abs(diff) + ' more than the field. With three robots shooting it is easy to count a ball twice or count one that bounced out. Count a ball only when you see it go in' +
        (phase === 'auto' ? '; auto is short, so replay it at half speed.' : '.');
    }
    return 'You counted ' + Math.abs(diff) + ' fewer than the field. Balls go in quickly when a robot is firing: try the video at half speed, and count in groups of five.';
  }

  var CHOICE_WORDS = {};
  /**
   * match: one entry of PRACTICE.matches; practice: the PRACTICE object (labels and options);
   * answers: { counts: { autoFuel: [r1, r2, r3], teleFuel: [...] }, robots: [{ autoClimb: 'NA', climb: 'L1' }, ...] }
   */
  function grade(match, practice, answers) {
    answers = answers || {};
    var out = { counts: [], robots: [], complete: true };
    // counts, for the alliance
    var cs = [];
    practice.counts.forEach(function (c) {
      var per = (answers.counts && answers.counts[c.code]) || [];
      var given = per.map(function (v) { return v === '' || v == null ? null : num(v); });
      if (given.length < match.teams.length || given.some(function (v) { return v == null; })) out.complete = false;
      var yours = given.reduce(function (s, v) { return s + (v || 0); }, 0);
      var official = num(match.answers.counts[c.code]), diff = yours - official;
      var b = band(diff, official), sc = countScore(diff, official);
      cs.push(sc);
      out.counts.push({ code: c.code, label: c.label, perRobot: given, yours: yours, official: official, diff: diff, band: b, bandText: BAND_TEXT[b], score: sc, tip: countTip(diff, c.label, official) });
    });
    // climbs and other choices, robot by robot
    var right = 0, total = 0;
    match.answers.robots.forEach(function (rob, i) {
      var mine = (answers.robots && answers.robots[i]) || {}, rows = [];
      practice.robotChoices.forEach(function (ch) {
        var yours = mine[ch.code], official = rob.choices[ch.code];
        if (yours == null || yours === '') out.complete = false;
        var word = function (k) { var o = ch.options.filter(function (x) { return x.k === k; })[0]; return o ? o.v : (k == null || k === '' ? 'no answer' : String(k)); };
        var kind, ok, text;
        // The field only records climbs that worked, so "tried and failed" on a robot the field did not
        // see climb is as right as "no climb": nobody can tell them apart from the official numbers.
        // A generated practice match (practice-gen.js) names its own "nothing happened" answers in ch.noneKeys.
        var isNone = function (v) { return v === 'No' || v === 'NA' || (ch.noneKeys || []).indexOf(v) >= 0; };
        var unverifiable = yours === 'F' && (official === 'No' || official == null);
        if (yours === official || unverifiable) {
          ok = true; kind = unverifiable ? 'unverifiable' : 'same';
          text = unverifiable ? 'The field only records climbs that worked, so it can\'t say if it tried. Nothing to fix.' : 'Matches the field.';
        } else if (isNone(official)) {
          ok = false; kind = 'extra';
          text = 'The field recorded no ' + ch.label.toLowerCase() + ' for this robot, and you said ' + word(yours).toLowerCase() + '. Check whether it reached the tower but let go, or whether you were watching a different robot.';
        } else if (isNone(yours)) {
          ok = false; kind = 'missed';
          text = 'The field recorded ' + word(official).toLowerCase() + '. Watch the last seconds of the match again: a climb is easy to miss when three robots crowd the tower.';
        } else {
          ok = false; kind = 'level';
          text = 'The field recorded ' + word(official).toLowerCase() + ' and you said ' + word(yours).toLowerCase() + '. Look at which rung the robot ended on, not where it started.';
        }
        total++; if (ok) right++;
        rows.push({ code: ch.code, label: ch.label, yours: yours, yoursText: word(yours), official: official, officialText: word(official), ok: ok, kind: kind, text: text });
      });
      out.robots.push({ team: rob.team, rows: rows });
    });
    out.choicesRight = right; out.choicesTotal = total;
    out.scoreChoices = total ? Math.round(100 * right / total) : 100;
    out.scoreCounts = cs.length ? Math.round(cs.reduce(function (s, x) { return s + x; }, 0) / cs.length) : 100;
    out.score = Math.round(0.4 * out.scoreChoices + 0.6 * out.scoreCounts);
    out.verdict = out.score >= 90 ? 'Excellent scouting' : out.score >= 75 ? 'Solid scouting' : out.score >= 55 ? 'Getting there' : 'Good first try: rewatch at half speed';
    return out;
  }

  /**
   * Progress from the saved results: [{ id, score, at }] oldest first.
   * A "trusted scout" has three matches in a row at 80 or better.
   */
  function progress(results, matches) {
    results = (results || []).filter(function (r) { return r && r.id; });
    var best = {};
    results.forEach(function (r) { if (best[r.id] == null || r.score > best[r.id]) best[r.id] = r.score; });
    var streak = 0;
    for (var i = results.length - 1; i >= 0 && results[i].score >= 80; i--) streak++;
    var done = Object.keys(best);
    var avg = results.length ? Math.round(results.slice(-5).reduce(function (s, r) { return s + r.score; }, 0) / Math.min(5, results.length)) : null;
    var firstFive = results.slice(0, 5), lastFive = results.slice(-5);
    return {
      attempts: results.length, matchesDone: done.length, matchesTotal: (matches || []).length, best: best, streak: streak,
      trusted: streak >= 3, recentAverage: avg,
      improving: results.length >= 6 ? Math.round(lastFive.reduce(function (s, r) { return s + r.score; }, 0) / lastFive.length) - Math.round(firstFive.reduce(function (s, r) { return s + r.score; }, 0) / firstFive.length) : null
    };
  }

  /** The next match to try: the first one not done yet, in the order given (easy first). */
  function nextMatch(matches, best) {
    for (var i = 0; i < matches.length; i++) if (best[matches[i].id] == null) return matches[i];
    return null;
  }

  var TRAINER = { grade: grade, progress: progress, nextMatch: nextMatch, band: band, countScore: countScore, BAND_TEXT: BAND_TEXT };
  if (typeof module !== 'undefined' && module.exports) module.exports = TRAINER;
  else root.TRAINER = TRAINER;
})(typeof window !== 'undefined' ? window : this);
