/* Practice matches for any game, made from the game pack (config.json). No page needed: tools/test-trainer-pack.js tests it.
 *
 * practice-data.js holds real 2026 matches with video. A new season has none yet, so this builds a
 * small set of made-up matches from the pack's own boxes. Each match has three robots. For each robot
 * it picks the true answers at random (seeded, so the same pack always gives the same set) and writes
 * a short plain description from the box titles, for example:
 *
 *     In auto they scored 4 balls. In auto they left the start line. In teleop they scored 12 balls.
 *     In the endgame they did hang level 2.
 *
 * The scout reads it, fills in the practice form, and the trainer grades the form against the true
 * answers. The description is written so generic-fill.js (the talk-to-fill) can read it back: each
 * match is tried through generic-fill and its answers are re-rolled until the two agree, so the
 * practice also works as a test of talk-to-fill. The result has the same shape as window.PRACTICE,
 * plus a "narrations" list on each match (one text per robot) in place of a video.
 */
(function (root) {
  'use strict';

  // Boxes that identify the match rather than describe the robot; never practised.
  var SKIP = ['scoutName', 'eventKey', 'matchNumber', 'matchType', 'teamNumber', 'alliance', 'driverStation', 'noShow'];
  var NAMES = [177, 254, 1114, 1678, 118, 33, 2056, 195, 148, 469, 1323, 27, 67, 217, 1538, 330, 971, 1690];

  function rng(seed) { return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; var t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function generic() { return (typeof module !== 'undefined' && module.exports) ? require('./generic-fill.js') : root.SCOUT_GENERIC; }
  function lower(s) { return String(s || '').toLowerCase(); }
  function plain(title) { return lower(title).replace(/\([^)]*\)/g, ' ').replace(/[?!:]/g, ' ').replace(/\s+/g, ' ').trim(); }

  // The title's own words in their written form (generic-fill.keywords gives only stems).
  function coreWords(f, G) {
    var stems = G.keywords(f), out = [];
    plain(f.title).split(/[^a-z0-9]+/).forEach(function (w) {
      if (!w || /^\d+$/.test(w)) return;
      var k = G.keywords({ title: w, code: '' });
      if (k.length && stems.indexOf(k[0]) >= 0 && out.indexOf(w) < 0) out.push(w);
    });
    return out;
  }
  // "Did they leave the start line?" -> "leave the start line"; "Left the start line?" -> "left the start line"
  function actionText(f) {
    return plain(f.title).replace(/^(?:did|does|do|was|were|is|are|can|could)\s+/, '').replace(/^(?:they|the robot|robot|it)\s+/, '');
  }

  /**
   * The boxes worth practising, as the trainer wants them: counts (summed over the alliance) and
   * choices (checked robot by robot). Returns { counts, robotChoices, boxes }.
   */
  function describe(config, opts) {
    var G = (opts && opts.G) || generic(), skip = {};
    SKIP.concat((opts && opts.skip) || []).forEach(function (c) { skip[c] = true; });
    var counts = [], choices = [], boxes = [];
    ((config && config.sections) || []).forEach(function (sec) {
      (sec.fields || []).forEach(function (f) {
        if (!f || !f.code || skip[f.code] || f.hidden) return;
        var ph = G.phaseOf(sec.name || '', f), box = { f: f, phase: ph, section: sec.name || '' };
        if (f.type === 'counter' || f.type === 'number') {
          box.core = coreWords(f, G); if (!box.core.length) return;
          box.kind = 'count'; box.hi = Math.min(f.max != null ? Number(f.max) : 12, 12); box.lo = Math.max(f.min != null ? Number(f.min) : 0, 0);
          counts.push({ code: f.code, label: String(f.title).replace(/\s*\([^)]*\)\s*$/, ''), hint: 'Read the description of each robot and enter its ' + plain(f.title) + '. The three are added up and checked together.' });
        } else if (f.type === 'range') {
          var lo = f.min != null ? Number(f.min) : 0, hi = f.max != null ? Number(f.max) : 5;
          box.core = coreWords(f, G); if (!box.core.length || hi - lo > 10 || hi <= lo) return;
          box.kind = 'range'; box.lo = lo; box.hi = hi;
          var ro = []; for (var v = lo; v <= hi; v++) ro.push({ k: String(v), v: String(v) });
          choices.push({ code: f.code, label: String(f.title).replace(/\s*\([^)]*\)\s*$/, ''), kind: 'range', options: ro, noneKeys: [] });
        } else if (f.type === 'boolean') {
          if (!G.keywords(f).length) return;
          box.kind = 'bool';
          choices.push({ code: f.code, label: String(f.title).replace(/[?]+$/, ''), kind: 'bool', options: [{ k: 'yes', v: 'Yes' }, { k: 'no', v: 'No' }], noneKeys: ['no'] });
        } else if (f.type === 'select') {
          var opts2 = (f.options || []).filter(function (o) { return String(o.k) !== '' && /[a-z0-9]/i.test(String(o.v || o.k)); });
          if (opts2.length < 2) return;
          box.kind = 'select'; box.options = opts2;
          var none = f.default != null && opts2.some(function (o) { return String(o.k) === String(f.default); }) ? [String(f.default)] : [];
          choices.push({ code: f.code, label: String(f.title), kind: 'select', options: opts2.map(function (o) { return { k: String(o.k), v: String(o.v || o.k) }; }), noneKeys: none });
        } else return;
        boxes.push(box);
      });
    });
    return { counts: counts, robotChoices: choices, boxes: boxes };
  }

  // The part-of-match words generic-fill listens for.
  var PREFIX = { auto: 'In auto', tele: 'In teleop', end: 'In the endgame' };

  function sentence(box, value) {
    var f = box.f, pre = box.phase ? PREFIX[box.phase] + ' they ' : 'They ';
    if (box.kind === 'count') return pre + 'scored ' + value + ' ' + box.core.join(' ') + '.';
    if (box.kind === 'range') return (box.phase ? PREFIX[box.phase] + ' ' : '') + box.core.join(' ') + ' was ' + value + '.';
    if (box.kind === 'bool') return value === 'yes' ? pre + actionText(f) + '.' : pre + 'never ' + actionText(f) + '.';
    var o = box.options.filter(function (x) { return String(x.k) === value; })[0];
    return (box.phase ? PREFIX[box.phase] + ' the result was ' : 'The result was ') + lower(o.v || o.k).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim() + '.';
  }
  // Boxes with no part of the match come first, so the part-of-match words later on cannot swallow them.
  function narrate(boxes, truth) {
    var order = boxes.filter(function (b) { return !b.phase; }).concat(boxes.filter(function (b) { return b.phase; }));
    return order.map(function (b) { return sentence(b, truth[b.f.code]); }).join(' ');
  }

  function rollTruth(boxes, R, busy) {
    var t = {};
    boxes.forEach(function (b) {
      var f = b.f;
      if (b.kind === 'count') { var top = Math.max(b.lo, Math.round(b.hi * busy)); t[f.code] = b.lo + Math.floor(R() * (top - b.lo + 1)); }
      else if (b.kind === 'range') t[f.code] = String(b.lo + Math.floor(R() * (b.hi - b.lo + 1)));
      else if (b.kind === 'bool') t[f.code] = R() < 0.3 + 0.4 * busy ? 'yes' : 'no';
      else t[f.code] = String(b.options[Math.floor(R() * b.options.length)].k);
    });
    return t;
  }
  // What generic-fill should return for a truth value.
  function asFilled(box, value) { return box.kind === 'count' || box.kind === 'range' ? Number(value) : box.kind === 'bool' ? value === 'yes' : value; }
  function agrees(box, value, got) {
    if (got == null) return false;
    return box.kind === 'select' ? String(got) === String(value) : got === asFilled(box, value);
  }

  /**
   * config: the game pack. opts: { seed (default 177), count (default 6), alliance, eventName, skip, G }.
   * Returns { game, made, generated: true, counts, robotChoices, matches }; matches are easy first.
   */
  function generate(config, opts) {
    opts = opts || {};
    var G = opts.G || generic(), R = rng(opts.seed == null ? 177 : opts.seed), count = opts.count || 6;
    var d = describe(config, opts), game = (config && config.game) || {};
    var matches = [], skipCodes = SKIP.concat(opts.skip || []);
    for (var i = 0; i < count; i++) {
      var level = i < count / 3 ? 'easy' : i < 2 * count / 3 ? 'medium' : 'harder';
      var busy = level === 'easy' ? 0.35 : level === 'medium' ? 0.65 : 1;
      var pool = NAMES.slice().sort(function () { return R() - 0.5; }), teams = pool.slice(0, 3).map(String);
      var robots, narrations, tries = 0;
      do {
        robots = teams.map(function (t) { return { team: t, truth: rollTruth(d.boxes, R, busy) }; });
        narrations = robots.map(function (r) { return narrate(d.boxes, r.truth); });
        // every box must read back from the narration, or this roll is thrown away (up to 40 tries)
        var good = robots.every(function (r, ri) {
          var got = G.fill(narrations[ri], config, skipCodes).fields;
          return d.boxes.every(function (b) { return agrees(b, r.truth[b.f.code], got[b.f.code]); });
        });
        tries++;
      } while (!good && tries < 40);
      var totals = {};
      d.counts.forEach(function (c) { totals[c.code] = robots.reduce(function (s, r) { return s + Number(r.truth[c.code]); }, 0); });
      matches.push({
        id: 'gen-' + (game.year || 'x') + '-' + (i + 1), level: level, match: i + 1, alliance: opts.alliance || (i % 2 ? 'blue' : 'red'),
        eventName: opts.eventName || 'Made-up practice match', video: null, teams: teams, narrations: narrations,
        answers: { counts: totals, robots: robots.map(function (r) { return { team: r.team, choices: r.truth }; }) }
      });
    }
    return { game: (game.name || 'New game') + ' ' + (game.year || ''), made: 'generated', generated: true, counts: d.counts, robotChoices: d.robotChoices, matches: matches };
  }

  /**
   * Which practice set to use: the real 2026 matches (fixed, from practice-data.js) when the pack is the
   * 2026 game, otherwise a generated set. A pack with nothing to practise gives null.
   */
  function forConfig(config, fixed, opts) {
    var year = config && config.game && config.game.year;
    if (!config || Number(year) === 2026) return fixed || null;
    var p = generate(config, opts);
    return p.matches.length && (p.counts.length || p.robotChoices.length) ? p : null;
  }

  var API = { generate: generate, forConfig: forConfig, describe: describe, narrate: narrate };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.PRACTICE_GEN = API;
})(typeof window !== 'undefined' ? window : this);
