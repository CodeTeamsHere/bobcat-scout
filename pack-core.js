/* ==========================================================================
   BOBCAT SCOUT: game pack tools (shared by both apps and the new-game page)
   --------------------------------------------------------------------------
   A "game pack" is config.json: the form, the point values, and (game.tba) which scouting boxes
   match which numbers in FIRST's official score breakdown. A new season only needs a new pack.

     validate(pack)               plain-words problems and notes about a pack
     cleanSpec(spec)              tidies a list of scoring actions (what the AI or a person writes)
     buildPack(spec)              turns that list into a full pack, with no AI writing form code
     selectScoringText(manual)    picks the parts of a game manual that talk about scoring
     draftMessages(...)           the question the AI is asked
     parseDraftReply(text)        reads the AI's answer back into a list of actions
     suggestTba(pack, breakdown)  candidate official-number paths, from one real match breakdown
     buildTba(pack, choices)      the game.tba block, from the choices a person made

   The AI only ever fills in the small action list. Code builds the pack and validate() checks it,
   so a wrong guess shows up as a visible, fixable row and never as broken code.
   Plain functions, no page: tools/test-pack-core.js runs them. Keep the copy in
   bobcat-scout-analytics identical (its test checks).
   ========================================================================== */
(function (root) {
  'use strict';

  // ---- Checking a pack ---------------------------------------------------------------------
  var TYPES = ['text', 'number', 'select', 'image', 'boolean', 'counter', 'multiselect', 'textarea', 'range'];
  // The rest of both apps depends on these: rows are matched, de-duplicated and grouped by them.
  var NEEDED = ['scoutName', 'eventKey', 'matchNumber', 'matchType', 'teamNumber'];

  function validate(cfg) {
    var errors = [], warnings = [];
    var bad = function (m) { errors.push(m); }, warn = function (m) { warnings.push(m); };
    if (!cfg || typeof cfg !== 'object') return { errors: ['The pack is not a JSON object.'], warnings: warnings };
    if (!cfg.title) bad('The pack has no "title".');
    if (!cfg.game || !cfg.game.name) bad('"game.name" is missing (the name of the game, like "Rebuilt").');
    if (!cfg.game || !Number.isInteger(cfg.game.year)) bad('"game.year" is missing or not a whole number (like 2026).');
    if (!Array.isArray(cfg.sections) || !cfg.sections.length) { bad('The pack has no "sections" (the form pages).'); return { errors: errors, warnings: warnings }; }

    var byCode = {};
    cfg.sections.forEach(function (s, si) {
      if (!s.name) bad('Section ' + (si + 1) + ' has no "name".');
      (s.fields || []).forEach(function (f, fi) {
        var where = (s.name || 'section ' + (si + 1)) + ', field ' + (fi + 1) + (f.title ? ' ("' + f.title + '")' : '');
        if (!f.code) { bad(where + ': no "code" (the short name the Sheet column uses).'); return; }
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(f.code)) bad(where + ': code "' + f.code + '" should be letters and digits only, starting with a letter.');
        if (byCode[f.code]) bad(where + ': code "' + f.code + '" is used twice. Every field needs its own.');
        byCode[f.code] = f;
        if (!f.title) bad(where + ': no "title" (what the scout reads).');
        if (TYPES.indexOf(f.type) < 0) bad(where + ': type "' + f.type + '" is not one of ' + TYPES.join(', ') + '.');
        if ((f.type === 'select' || f.type === 'multiselect') && !(Array.isArray(f.options) && f.options.length)) bad(where + ': a ' + f.type + ' needs a list of "options".');
        if (f.points != null && !isFinite(Number(f.points))) bad(where + ': "points" must be a number.');
        if (f.optionPoints) {
          var ks = (f.options || []).map(function (o) { return String(o.k); });
          Object.keys(f.optionPoints).forEach(function (k) { if (ks.indexOf(k) < 0) bad(where + ': "optionPoints" scores "' + k + '", which is not one of this field\'s options.'); });
        }
      });
    });
    NEEDED.forEach(function (c) { if (!byCode[c]) bad('The form has no "' + c + '" field. Both apps need it to match and group rows.'); });

    var scoring = Object.keys(byCode).map(function (k) { return byCode[k]; }).filter(function (f) { return f.points != null || f.optionPoints; });
    if (!scoring.length) warn('No field has point values ("points" or "optionPoints"), so every robot scores 0 in Analytics.');

    var d = (cfg.game && cfg.game.display) || {};
    ['autoCountCode', 'teleCountCode', 'defenseCode', 'climbCode'].forEach(function (k) {
      if (d[k] && !byCode[d[k]]) bad('game.display.' + k + ' is "' + d[k] + '", but the form has no field with that code.');
    });
    if (d.climbCode && byCode[d.climbCode] && d.climbLevels) {
      var cks = (byCode[d.climbCode].options || []).map(function (o) { return String(o.k); });
      d.climbLevels.forEach(function (l) { if (cks.indexOf(String(l)) < 0) bad('game.display.climbLevels lists "' + l + '", which is not an option of "' + d.climbCode + '".'); });
    }

    var t = cfg.game && cfg.game.tba;
    if (!t) warn('No "game.tba" block: Scout Trust will say it does not know this game and change nothing. Everything else works.');
    else {
      var opt = function (code, v, what) { if (v != null && byCode[code] && (byCode[code].options || []).every(function (o) { return String(o.k) !== String(v); })) bad('game.tba ' + what + ': "' + v + '" is not an option of "' + code + '".'); };
      (t.counts || []).forEach(function (c, i) {
        var w = 'count ' + (i + 1) + ' ("' + (c.label || c.key || '?') + '")';
        if (!c.key || !c.label) bad('game.tba ' + w + ': needs a "key" and a "label".');
        if (!byCode[c.field]) bad('game.tba ' + w + ': field "' + c.field + '" is not on the form.');
        if (!c.path) bad('game.tba ' + w + ': needs a "path" into the official breakdown, like "hubScore.autoCount".');
      });
      (t.robots || []).forEach(function (r, i) {
        var w = 'robot check ' + (i + 1) + ' ("' + (r.label || r.key || '?') + '")';
        if (!r.key || !r.label) bad('game.tba ' + w + ': needs a "key" and a "label".');
        if (!byCode[r.field]) bad('game.tba ' + w + ': field "' + r.field + '" is not on the form.');
        if (!r.path || String(r.path).indexOf('{n}') < 0) bad('game.tba ' + w + ': "path" must contain {n} for the robot\'s slot, like "endGameTowerRobot{n}".');
        if (r.kind === 'yesno') {
          if (!Array.isArray(r.yes) || !r.yes.length) bad('game.tba ' + w + ': a yesno check needs "yes" (official values that count as done).');
          ['scoutedYes', 'scoutedNo', 'failed'].forEach(function (k) { opt(r.field, r[k], w + ' ' + k); });
        } else if (r.kind === 'levels') {
          if (!r.levels || !Object.keys(r.levels).length) bad('game.tba ' + w + ': a levels check needs "levels" (official value -> form option).');
          else Object.keys(r.levels).forEach(function (o) { opt(r.field, r.levels[o], w + ' level ' + o); });
          ['none', 'failed'].forEach(function (k) { opt(r.field, r[k], w + ' ' + k); });
        } else bad('game.tba ' + w + ': kind must be "yesno" or "levels".');
      });
    }
    return { errors: errors, warnings: warnings };
  }

  // ---- A list of scoring actions -> a pack -------------------------------------------------
  var PHASES = { auto: 'Autonomous', tele: 'Teleop', end: 'Endgame' };

  function camelId(s) {
    if (/^[A-Za-z][A-Za-z0-9]*$/.test(String(s))) return String(s).charAt(0).toLowerCase() + String(s).slice(1);   // already an id
    var w = String(s || '').replace(/[^A-Za-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
    var id = w.map(function (x, i) { x = x.toLowerCase(); return i ? x.charAt(0).toUpperCase() + x.slice(1) : x; }).join('');
    if (!id) id = 'item';
    return /^[a-z]/i.test(id) ? id : 'a' + id;
  }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }

  // Tidies what the AI or a person wrote: valid kinds and parts of the match, numbers as numbers,
  // unique letters-and-digits ids. Returns { spec, notes } where notes say what was changed.
  function cleanSpec(spec) {
    var notes = [], used = {}, out = { gameName: String((spec && spec.gameName) || '').trim(), year: Math.round(num(spec && spec.year, 0)), actions: [] };
    ((spec && spec.actions) || []).forEach(function (a, i) {
      if (!a || !String(a.title || a.id || '').trim()) { notes.push('Row ' + (i + 1) + ' had no name and was dropped.'); return; }
      var title = String(a.title || a.id).trim();
      var phase = PHASES[a.phase] ? a.phase : 'tele';
      if (!PHASES[a.phase]) notes.push('"' + title + '" had no valid part of the match, so it was put in Teleop.');
      var kind = ['count', 'yesno', 'levels'].indexOf(a.kind) >= 0 ? a.kind : 'count';
      var id = camelId(a.id || title), base = id, n = 2;
      while (used[id]) id = base + n++;
      used[id] = true;
      var row = { id: id, title: title, phase: phase, kind: kind, quote: String(a.quote || '').slice(0, 400) };
      if (kind === 'levels') {
        var seen = {};
        row.levels = (Array.isArray(a.levels) ? a.levels : []).map(function (l, j) {
          var label = String((l && (l.label || l.name)) || ('Level ' + (j + 1))).trim();
          var key = String((l && l.key) || '').replace(/[^A-Za-z0-9]/g, '') || ('L' + (j + 1));
          while (seen[key]) key += 'x';
          seen[key] = true;
          return { key: key, label: label, points: num(l && l.points, 0) };
        });
        if (!row.levels.length) notes.push('"' + title + '" has no levels yet: add at least one.');
      } else row.points = num(a.points, 0);
      out.actions.push(row);
    });
    return { spec: out, notes: notes };
  }

  function buildPack(rawSpec) {
    var spec = cleanSpec(rawSpec).spec;
    var year = spec.year || new Date().getFullYear() + 1;
    var name = spec.gameName || 'New Game';
    var by = { auto: [], tele: [], end: [] };
    var display = {};
    spec.actions.forEach(function (a) {
      var f;
      if (a.kind === 'count') f = { title: a.title, type: 'counter', code: a.id, default: 0, min: 0, max: 300, points: a.points };
      else if (a.kind === 'yesno') f = { title: a.title, type: 'boolean', code: a.id, default: false, points: a.points };
      else {
        var opts = [{ k: '', v: '—' }, { k: 'No', v: 'No ' + a.title.toLowerCase().replace(/^did\s+(?:the\s+robot\s+)?/, '') }]
          .concat(a.levels.map(function (l) { return { k: l.key, v: l.label }; })).concat([{ k: 'F', v: 'Failed attempt' }]);
        var optionPoints = {};
        a.levels.forEach(function (l) { optionPoints[l.key] = l.points; });
        f = { title: a.title, type: 'select', code: a.id, default: '', options: opts, optionPoints: optionPoints };
      }
      by[a.phase].push(f);
      if (a.kind === 'count' && a.phase === 'auto' && !display.autoCountCode) display.autoCountCode = a.id;
      if (a.kind === 'count' && a.phase === 'tele' && !display.teleCountCode) display.teleCountCode = a.id;
      if (a.kind === 'levels' && (!display.climbCode || a.phase === 'end') && !(display.climbCode && display._climbPhase === 'end')) {
        display.climbCode = a.id; display.climbLevels = a.levels.map(function (l) { return l.key; }); display._climbPhase = a.phase;
      }
    });
    delete display._climbPhase;

    var identity = [
      { title: 'Abbreviated Scouter Name', type: 'text', code: 'scoutName', required: true, preserve: true, placeholder: 'Your name', help: 'Every row is stamped with it.' },
      { title: 'Event Key', type: 'text', code: 'eventKey', required: true, preserve: true, placeholder: year + 'ctwat', help: 'Set once per competition. The Sheet uses it to keep events apart.' },
      { title: 'Match Number', type: 'number', code: 'matchNumber', required: true, help: 'Select the match number.', default: 1, min: 1, max: 200 },
      { title: 'Match Type', type: 'select', code: 'matchType', default: 'qm', options: [{ k: 'qm', v: 'Qualification' }, { k: 'pm', v: 'Practice' }, { k: 'sf', v: 'Playoff' }] },
      { title: 'Team and Robot', type: 'number', code: 'teamNumber', required: true, help: 'Select the team and robot position you are scouting.', preserve: true, default: 177, min: 1, max: 99999 },
      { title: 'Alliance', type: 'select', code: 'alliance', default: '', help: 'Red or blue.', options: [{ k: '', v: '—' }, { k: 'red', v: 'Red' }, { k: 'blue', v: 'Blue' }] },
      { title: 'No Show', type: 'boolean', code: 'noShow', help: 'Check if the robot did not show up for the match.', default: false, fail: true }
    ];
    var used = {};
    spec.actions.forEach(function (a) { used[a.id] = true; });
    ['died', 'mechIssue', 'tipped', 'co'].forEach(function (c) { if (used[c]) throw new Error('"' + c + '" is used by a scoring action; rename that action.'); });
    var problems = [
      { title: 'Died?', type: 'boolean', code: 'died', help: 'Did the robot die during the match?', default: false, fail: true },
      { title: 'Mechanical Issue?', type: 'boolean', code: 'mechIssue', help: 'Did the robot have a mechanical issue during the match?', default: false, fail: true },
      { title: 'Tipped/Fell Over', type: 'boolean', code: 'tipped', help: 'Did the robot tip or fall over during the match?', default: false, fail: true },
      { title: 'Comments (Eg:Penalties/Defense/Uniqueness)', type: 'textarea', code: 'co', required: true, help: 'Eg: Penalties/Defense/Uniqueness, etc.', default: '', maxLength: 2500 }
    ];
    var sections = [{ name: 'Prematch', fields: identity }];
    ['auto', 'tele', 'end'].forEach(function (p) { if (by[p].length) sections.push({ name: PHASES[p], fields: by[p] }); });
    if (!by.end.length) sections.push({ name: 'Endgame', fields: problems });
    else sections[sections.length - 1].fields = sections[sections.length - 1].fields.concat(problems);
    return {
      title: name.toUpperCase() + ' ' + year, delimiter: '\t',
      game: { name: name, year: year, note: 'Drafted by the new-game tool from the game manual. A person must review it before use.', display: display },
      sections: sections
    };
  }

  // ---- Picking the scoring parts out of a long manual ---------------------------------------
  var SCORE_WORDS = /\b(?:points?|pts|scor(?:e|es|ed|ing)|autonomous|auto|teleop|tele-?op|endgame|end\s+game|ranking\s+point|bonus|park(?:ed|ing)?|climb(?:ed|ing)?|hang|level|tier|each|per)\b/gi;
  function selectScoringText(manual, maxChars) {
    maxChars = maxChars || 45000;
    var text = String(manual || '').replace(/\r\n/g, '\n');
    var paras = text.split(/\n\s*\n/).reduce(function (all, p) {
      p = p.trim();
      if (!p) return all;
      while (p.length > 1600) { var cut = p.lastIndexOf('. ', 1400); if (cut < 400) cut = 1400; all.push(p.slice(0, cut + 1)); p = p.slice(cut + 1).trim(); }
      all.push(p); return all;
    }, []);
    var scored = paras.map(function (p, i) {
      var hits = (p.match(SCORE_WORDS) || []).length, nums = (p.match(/\b\d+\s*(?:points?|pts)\b/gi) || []).length;
      return { i: i, p: p, s: hits + nums * 6 + (/\bpoints?\b/i.test(p) ? 3 : 0) };
    });
    var keep = {}, used = 0;
    scored.slice().sort(function (a, b) { return b.s - a.s || a.i - b.i; }).forEach(function (x) {
      if (x.s < 3 || used + x.p.length + 2 > maxChars) return;
      keep[x.i] = true; used += x.p.length + 2;
    });
    var picked = scored.filter(function (x) { return keep[x.i]; }).map(function (x) { return x.p; });
    var joined = picked.join('\n\n');
    return { text: joined, chars: joined.length, total: text.length, picked: picked.length, paragraphs: paras.length };
  }

  // ---- The question for the AI --------------------------------------------------------------
  var SCHEMA_HELP = '{"gameName": "...", "year": 2027, "actions": [\n' +
    '  {"id": "autoFuel", "title": "Fuel scored in auto", "phase": "auto", "kind": "count", "points": 1, "quote": "exact words from the manual"},\n' +
    '  {"id": "leftLine", "title": "Left the start line", "phase": "auto", "kind": "yesno", "points": 3, "quote": "..."},\n' +
    '  {"id": "climb", "title": "Endgame climb", "phase": "end", "kind": "levels", "quote": "...",\n' +
    '   "levels": [{"key": "L1", "label": "Level 1", "points": 10}, {"key": "L2", "label": "Level 2", "points": 20}]}\n' +
    ']}';
  function draftMessages(manualExcerpt, gameName, year) {
    return [
      { role: 'system', content: 'You read FIRST Robotics Competition game manual text and list what a robot SCORES POINTS for, so a scouting form can count it. Reply with ONE JSON object and nothing else (no prose, no code fence). Shape:\n' + SCHEMA_HELP +
        '\nRules: "phase" is "auto", "tele" or "end" (where in the match it happens). "kind" is "count" (a number of game pieces or actions, points is points EACH), "yesno" (done or not done, points when done) or "levels" (one of several tiers such as park / climb levels; give every tier its points). Use only point values written in the text; if the text does not give a value, use 0 and say so in "quote". "quote" must be words copied from the text that justify the row. Include one row per different thing that scores. Do not invent scoring that is not in the text. Ranking points and fouls are not actions.' },
      { role: 'user', content: 'Game: ' + (gameName || 'unknown') + ' ' + (year || '') + '\n\nManual text (scoring parts only):\n"""\n' + manualExcerpt + '\n"""' }
    ];
  }
  function parseDraftReply(reply) {
    var s = String(reply || '').trim();
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return { error: 'The AI did not send a list I could read.' };
    try {
      var obj = JSON.parse(s.slice(a, b + 1));
      if (!obj || !Array.isArray(obj.actions) || !obj.actions.length) return { error: 'The AI found no scoring actions in that text.' };
      return { spec: obj };
    } catch (e) { return { error: 'The AI\'s answer was not valid JSON (' + e.message + ').' }; }
  }

  // ---- Matching the form to FIRST's official score breakdown --------------------------------
  function flatten(obj, prefix, out) {
    out = out || {};
    Object.keys(obj || {}).forEach(function (k) {
      var v = obj[k], p = prefix ? prefix + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, p, out);
      else out[p] = v;
    });
    return out;
  }
  function wordSet(s) { return String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2; }); }
  function fieldPhase(pack, field) {
    var ph = null;
    pack.sections.forEach(function (s) { (s.fields || []).forEach(function (f) { if (f === field) ph = /auto/i.test(s.name) ? 'auto' : /tele/i.test(s.name) ? 'tele' : /end/i.test(s.name) ? 'end' : null; }); });
    return ph;
  }
  // One alliance's score_breakdown (from The Blue Alliance, after a match is played) in; candidate
  // paths out, best first. A person picks; nothing is applied automatically.
  function suggestTba(pack, breakdown) {
    var flat = flatten(breakdown), out = { counts: [], robots: [], groups: [] };
    var numeric = Object.keys(flat).filter(function (k) { return typeof flat[k] === 'number'; });
    var groups = {};
    Object.keys(flat).forEach(function (k) {
      var m = /^(.*?)([1-3])$/.exec(k);
      if (m && typeof flat[k] === 'string') (groups[m[1]] = groups[m[1]] || { prefix: m[1], values: {} }).values[flat[k]] = true;
    });
    out.groups = Object.keys(groups).map(function (p) { return { prefix: p, path: p + '{n}', values: Object.keys(groups[p].values) }; });
    var PHW = { auto: ['auto', 'autonomous'], tele: ['tele', 'teleop'], end: ['end', 'endgame'] };
    pack.sections.forEach(function (s) {
      (s.fields || []).forEach(function (f) {
        var ph = fieldPhase(pack, f), kw = wordSet(f.title + ' ' + f.code);
        var rank = function (path, isCount) {
          var w = wordSet(path), last = wordSet(String(path).split('.').pop()), score = 0;
          kw.forEach(function (k) { if (w.indexOf(k) >= 0) score += 2; });
          if (ph && PHW[ph].some(function (x) { return w.indexOf(x) >= 0; })) score += 3;
          if (isCount) {   // a count of pieces, not the points they earned
            if (last.some(function (x) { return /^(?:count|total|made|number|num|scored)$/.test(x); })) score += 2;
            if (last.some(function (x) { return /^(?:points?|pts|bonus|rp|penalty|fouls?)$/.test(x); })) score -= 4;
          }
          return score;
        };
        if (f.type === 'counter' && f.points != null) {
          out.counts.push({ field: f.code, label: f.title, candidates: numeric.map(function (p) { return { path: p, value: flat[p], score: rank(p, true) }; }).filter(function (c) { return c.score > 0; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 6) });
        } else if (f.type === 'select' && f.optionPoints) {
          out.robots.push({ field: f.code, label: f.title, candidates: out.groups.map(function (g) { return { path: g.path, values: g.values, score: rank(g.prefix) }; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 4) });
        }
      });
    });
    return out;
  }
  // choices: { counts: { fieldCode: path }, robots: { fieldCode: { path, noneOfficial, levels: { officialValue: optionKey } } } }
  function buildTba(pack, choices) {
    var by = {};
    pack.sections.forEach(function (s) { (s.fields || []).forEach(function (f) { by[f.code] = f; }); });
    var t = { year: pack.game.year, game: pack.game.name, counts: [], robots: [] };
    Object.keys((choices && choices.counts) || {}).forEach(function (code) {
      if (!choices.counts[code] || !by[code]) return;
      t.counts.push({ key: code, label: by[code].title, field: code, path: choices.counts[code] });
    });
    Object.keys((choices && choices.robots) || {}).forEach(function (code) {
      var c = choices.robots[code];
      if (!c || !c.path || !by[code]) return;
      var keys = (by[code].options || []).map(function (o) { return String(o.k); });
      t.robots.push({ key: code, label: by[code].title, field: code, path: c.path, kind: 'levels', levels: c.levels || {},
        none: keys.indexOf('No') >= 0 ? 'No' : '', failed: keys.indexOf('F') >= 0 ? 'F' : '', noneOfficial: c.noneOfficial || 'None' });
    });
    return t;
  }

  var API = { validate: validate, NEEDED: NEEDED, TYPES: TYPES, cleanSpec: cleanSpec, buildPack: buildPack, selectScoringText: selectScoringText,
    draftMessages: draftMessages, parseDraftReply: parseDraftReply, suggestTba: suggestTba, buildTba: buildTba, camelId: camelId };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.PACK_CORE = API;
})(typeof window !== 'undefined' ? window : this);
