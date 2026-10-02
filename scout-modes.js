/* ==========================================================================
   BOBCAT SCOUT — the ways to scout a match
   --------------------------------------------------------------------------
     1. Describe it         talk or type, then check the whole form (the original way)
     2. Talk, then fill gaps talk; the app shows only the boxes it didn't hear
     3. Guided              the app asks one question at a time and listens

   This file is the thinking behind 2 and 3, with no page code, so the tests can
   run it: which fields still need an answer, which question comes next, and how
   a few spoken words become a field value. Scouts don't talk in sentences
   ("uh, twelve", "left side by the depot", "nah"), so every answer is read by
   keywords, scoped to the one field being asked about.

   GUIDE holds this season's questions and the extra words that mean each
   option. A new game needs new prompts and words here, the same way the voice
   parser in app.js needs new patterns. A field missing from GUIDE still gets a
   plain question built from its title, so a new form never breaks this.
   ========================================================================== */
(function (root) {
  'use strict';

  // ---- This season's questions: REBUILT (2026) ------------------------------------------------
  // ask:    the question, read aloud in guided mode
  // say:    what to answer, shown (and read) under it
  // words:  extra phrases that mean each option, beyond its label
  // when:   ask only if this is true (e.g. "where did they climb" only after a climb)
  // derive: work the answer out from another field instead of asking
  // never:  never ask (an answer is always derived, or it's set elsewhere)
  // invert: a yes/no field whose question is asked the other way round
  var LEVELS = ['L1', 'L2', 'L3'];
  var GUIDE = {
    scoutName: { ask: 'What is your name?', say: 'your first name' },
    eventKey: { ask: 'Which event? Type the event code.', say: 'for example 2026ctwat' },
    matchNumber: { ask: 'Which match number?', say: 'a number', when: function (f, ctx) { return !!ctx.askMatchNumber; } },
    matchType: { never: true },
    startPos: {
      ask: 'Which starting position, 1 to 6?', say: '1 to 3 is red, 4 to 6 is blue',
      words: { '1': ['one', 'red one', 'red 1'], '2': ['two', 'red two', 'red 2'], '3': ['three', 'red three', 'red 3'],
        '4': ['four', 'blue one', 'blue 1'], '5': ['five', 'blue two', 'blue 2'], '6': ['six', 'blue three', 'blue 3'] }
    },
    // Asked after the starting position: with a match schedule loaded, the position fills
    // the team in and this question is skipped.
    teamNumber: { ask: 'Which team are you scouting?', say: 'the team number', askAfter: 'startPos' },
    noShow: { ask: 'Did the robot show up?', say: 'yes, or no-show', invert: true, words: { 'true': ['no show', 'not here', 'not there', 'didn\'t show', 'absent', 'missing'] } },

    AutoScored: { never: true, derive: function (f, a) { return a.autoFuelScored ? Number(f.autoFuelScored) > 0 : undefined; } },
    autoFuelScored: { ask: 'How much fuel did they score in auto?', say: 'a number, or none' },
    scoringMannerismAuto: {
      ask: 'How did they score in auto?', say: 'stationary, while driving, both, or none',
      derive: function (f, a) { return a.autoFuelScored && Number(f.autoFuelScored) === 0 ? 'NONE' : undefined; },
      words: { NONE: ['none', 'no scoring', 'didn\'t score', 'did not score', 'nothing'], STATIONARY: ['stationary', 'standing', 'still', 'not moving', 'parked', 'stopped'], WHILE_DRIVE: ['driving', 'moving', 'on the move', 'while moving'], BOTH: ['both', 'mix', 'mixed'] }
    },
    AutoPickup: { never: true, derive: function (f, a) { return a.pickupfrom ? (f.pickupfrom || []).some(function (k) { return k !== 'NONE'; }) : undefined; } },
    pickupfrom: {
      ask: 'Where did they pick up fuel in auto?', say: 'depot, midfield, human player, floor, or none',
      words: { NONE: ['none', 'no pickup', 'didn\'t pick up', 'nothing', 'nowhere'], DEPOT: ['depot'], MID: ['midfield', 'mid field', 'middle', 'neutral zone', 'center'], H_Player: ['human player', 'outpost', 'chute', 'human'], FLOOR: ['floor', 'ground'] }
    },
    autoClimbed: {
      ask: 'Did they climb in auto?', say: 'yes, failed, or no',
      words: { NA: ['no', 'nope', 'didn\'t', 'did not', 'not attempted', 'no climb', 'none'], Success: ['yes', 'yeah', 'yep', 'climbed', 'success', 'successful', 'made it'], Failed: ['failed', 'fail', 'fell', 'missed', 'tried', 'unsuccessful'] }
    },
    autoClimbPos: {
      ask: 'Where did they climb in auto?', say: 'left, middle, or right', when: function (f) { return f.autoClimbed === 'Success'; },
      words: { LS: ['left'], MD: ['middle', 'mid', 'center', 'centre'], RS: ['right'] }
    },
    doubleClimb: { ask: 'Did they climb with another robot?', say: 'yes or no', when: function (f) { return f.autoClimbed === 'Success'; } },
    AutoPath: {
      ask: 'Which auto path did they run?', say: 'for example bump to trench, same side bump, straight to depot, pre-load only, climb only, or nothing',
      // Plain "bump to trench" is the sweep; "same side" picks the same-side path. (QRScout's
      // labels for the two mixed same-side paths are the reverse of their keys; the words
      // follow the labels, which is what scouts see.)
      words: { 'Bump/Bump': ['bump to bump'], 'Trench/Trench': ['trench to trench'], 'Bump-Trench': ['bump to trench'], 'Trench-Bump': ['trench to bump'],
        'Same Side Bump': ['same side bump', 'bump to bump same side'], 'Same Side Trench': ['same side trench', 'trench to trench same side'],
        'Same Side Bump/Trench': ['trench to bump same side', 'same side trench to bump'], 'Same Side Trench/Bump': ['bump to trench same side', 'same side bump to trench'],
        'Pre-Load': ['pre load', 'preload', 'pre load only'], Depot: ['straight to depot', 'to the depot', 'depot'], Outpost: ['straight to outpost', 'to the outpost', 'outpost'],
        Climb: ['climb only', 'just climbed', 'only climbed'], 'N/A': ['nothing', 'did nothing', 'didn\'t move', 'did not move', 'none', 'stayed still'] }
    },
    AutoSL: {
      ask: 'Where did they shoot from in auto?', say: 'for example left side near depot, middle near tower, or did not shoot',
      derive: function (f, a) { return a.autoFuelScored && Number(f.autoFuelScored) === 0 ? ['N/A'] : undefined; },
      words: { 'N/A': ['nowhere', 'didn\'t shoot', 'did not shoot', 'none', 'nothing'], Climb: ['climb only'] }
    },
    Aco: { ask: 'Any auto comments?', say: 'say them, or say none' },

    teleopFuelScored: { ask: 'How much fuel did they score in teleop?', say: 'a number, or none' },
    scoringEffe: {
      ask: 'About what percent of their shots went in?', say: 'a percent like 60, or great, good, okay, poor',
      when: function (f, ctx, a) { return !(a.teleopFuelScored && Number(f.teleopFuelScored) === 0); }
    },
    scoringMannerismTele: {
      ask: 'How did they score in teleop?', say: 'stationary, while driving, both, or none',
      derive: function (f, a) { return a.teleopFuelScored && Number(f.teleopFuelScored) === 0 ? 'NONE' : undefined; },
      words: { NONE: ['none', 'no scoring', 'didn\'t score', 'did not score', 'nothing'], STATIONARY: ['stationary', 'standing', 'still', 'not moving', 'parked', 'stopped'], WHILE_DRIVE: ['driving', 'moving', 'on the move', 'while moving'], BOTH: ['both', 'mix', 'mixed'] }
    },
    TeleSL: {
      ask: 'Where did they shoot from in teleop?', say: 'for example right side near outpost, middle near hub, or no shooting',
      derive: function (f, a) { return a.teleopFuelScored && Number(f.teleopFuelScored) === 0 ? ['NS'] : undefined; },
      words: { NS: ['no shooting', 'didn\'t shoot', 'did not shoot', 'nowhere', 'none', 'nothing'] }
    },
    pickupTele: {
      ask: 'Where did they pick up fuel in teleop?', say: 'depot, midfield, human player, floor, or none',
      words: { NONE: ['none', 'no pickup', 'didn\'t pick up', 'nothing', 'nowhere'], DEPOT: ['depot'], MID: ['midfield', 'mid field', 'middle', 'neutral zone', 'center'], H_Player: ['human player', 'outpost', 'chute', 'human'], FLOOR: ['floor', 'ground'] }
    },
    pickupEffe: {
      ask: 'Rate their pickup, 1 to 5.', say: '1 to 5, or great, good, okay, poor',
      when: function (f, ctx, a) { return !a.pickupTele || (f.pickupTele || []).some(function (k) { return k !== 'NONE'; }); }
    },
    fuelPassed: {
      ask: 'Did they pass fuel?', say: 'no, or where: center, opponent zone, scattered, intentional',
      words: { No_Passing: ['no', 'nope', 'no passing', 'didn\'t pass', 'did not pass', 'none'], Center: ['center', 'centre', 'middle'], Opp_Zone: ['opponent zone', 'opponent', 'opposite zone', 'other zone', 'their zone'], Scattered: ['scattered', 'all over', 'everywhere', 'random'], Intentional: ['intentional', 'on purpose', 'deliberate', 'to a partner'] }
    },
    passingEffe: {
      ask: 'Rate their passing, 1 to 5.', say: '1 to 5, or great, good, okay, poor',
      when: function (f, ctx, a) { return !a.fuelPassed || (f.fuelPassed || []).some(function (k) { return k !== 'No_Passing'; }); }
    },
    TrenchRizz: { ask: 'Could they drive under the trench?', say: 'yes or no' },
    robotDefended: {
      ask: 'Did they play defense?', say: 'yes, no, or tried',
      words: { Yes: ['yes', 'yeah', 'yep', 'played defense', 'defended'], No: ['no', 'nope', 'didn\'t', 'did not'], Attempted: ['tried', 'attempted', 'a little', 'sort of', 'kind of', 'some'] }
    },
    defenceEffe: {
      ask: 'Rate their defense, 1 to 5.', say: '1 to 5, or great, good, okay, poor',
      when: function (f) { return f.robotDefended === 'Yes' || f.robotDefended === 'Attempted'; }
    },

    climbed: {
      ask: 'Endgame. Did they climb?', say: 'level 1, 2 or 3, failed, or no',
      words: { No: ['no', 'nope', 'didn\'t climb', 'did not climb', 'no climb', 'none'], L1: ['level 1', 'level one', 'l1', 'low', 'first rung', 'bottom'], L2: ['level 2', 'level two', 'l2', 'mid', 'middle', 'second rung'], L3: ['level 3', 'level three', 'l3', 'high', 'top', 'third rung'], F: ['failed', 'fail', 'fell', 'missed', 'tried', 'unsuccessful'] }
    },
    climbPos: {
      ask: 'Where did they climb?', say: 'left, middle, or right', when: function (f) { return LEVELS.indexOf(f.climbed) !== -1; },
      words: { LS: ['left'], MD: ['middle', 'mid', 'center', 'centre'], RS: ['right'] }
    },
    AllianceClimb: { ask: 'How many robots on their alliance climbed?', say: '0 to 3' },
    crossedZone: { group: 'problems', words: { 'true': ['crossed', 'opposite zone', 'other zone', 'crossed over', 'into their zone'] } },
    mechIssue: { group: 'problems', words: { 'true': ['mechanical', 'broke', 'broken', 'jammed', 'jam', 'fell apart', 'chain', 'issue'] } },
    died: { group: 'problems', words: { 'true': ['died', 'dead', 'disabled', 'stopped working', 'lost power', 'browned out', 'brownout'] } },
    tipped: { group: 'problems', words: { 'true': ['tipped', 'tip', 'fell over', 'flipped', 'tipped over'] } },
    co: { ask: 'Any comments? Penalties, defense, anything unusual.', say: 'say them, or say none' },
  };
  var GROUPS = {
    problems: { ask: 'Did any of these happen: crossed into the opposite zone, a mechanical issue, died, or tipped?', say: 'say the ones that happened, or none' },
  };
  var IDENTITY = ['scoutName', 'eventKey', 'matchNumber', 'teamNumber'];

  // ---- Reading words ----------------------------------------------------------------------------
  var FILLER = { the: 1, a: 1, an: 1, um: 1, uh: 1, uhh: 1, like: 1, they: 1, it: 1, was: 1, were: 1, i: 1, think: 1, so: 1, and: 1, from: 1, at: 1, on: 1, of: 1, to: 1, okay: 0 };
  function words(text) {
    return String(text || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function tokens(text) { return words(text).split(' ').filter(function (w) { return w && !FILLER[w]; }); }
  function has(heard, phrase) {
    var p = words(phrase);
    return !!p && (' ' + heard + ' ').indexOf(' ' + p + ' ') !== -1;
  }
  var NONE_RE = /^(none|nothing|no|nope|nah|zero|no comments?|nothing else|all good|no issues|no problems|none of them|none of those|didnt|did not)$/;
  var YES_RE = /\b(yes|yeah|yep|yup|ya|sure|correct|affirmative|true|absolutely)\b/;
  var NO_RE = /\b(no|nope|nah|didnt|did not|never|negative|false|not|couldnt|could not|cant|cannot|wasnt|was not)\b/;
  var WEAK_YES_RE = /\b(did|could|can|was|were|do|does)\b/;   // "they did", only when nothing says no

  // Voice commands, said on their own. "done" alone is too close to "none", so finishing
  // takes "I'm done", "finish" or "stop".
  var COMMANDS = [
    ['back', /^(go back|back|previous|previous question|undo|last question|wait go back)$/],
    ['repeat', /^(repeat|repeat that|again|say again|say that again|what|pardon|huh|come again)$/],
    ['skip', /^(skip|skip it|skip this|next|next question|pass|i dont know|dont know|not sure|no idea)$/],
    ['done', /^(im done|i am done|all done|were done|finish|finished|stop|stop scouting|review|thats all|thats it|end)$/],
  ];
  function command(heard) {
    var w = words(heard);
    for (var i = 0; i < COMMANDS.length; i++) if (COMMANDS[i][1].test(w)) return COMMANDS[i][0];
    return null;
  }

  // Speech recognition often writes a number said on its own as a word that sounds like it
  // ("for" for 4). Only trusted when that word is the whole answer, or follows "number".
  var SOUNDS_LIKE = { to: 2, too: 2, for: 4, fore: 4, won: 1, ate: 8, tree: 3, free: 3 };
  var NUMBER_LEAD = { number: 1, match: 1, team: 1, um: 1, uh: 1, about: 1 };
  function firstNumber(heard, normalize) {
    var t = normalize ? normalize(String(heard || '').toLowerCase()) : String(heard || '');
    var m = t.match(/-?\d+(?:\.\d+)?/);
    if (m) return Number(m[0]);
    var w = words(heard).split(' ');
    var last = w[w.length - 1];
    if (SOUNDS_LIKE[last] !== undefined && (w.length === 1 || (w.length === 2 && NUMBER_LEAD[w[0]]))) return SOUNDS_LIKE[last];
    return null;
  }

  // Did the microphone just hear the app's own question instead of the scout? Only when what
  // was heard is long, nearly all words of the question, and a good part of it: a short
  // answer that repeats the question's words ("they did climb") is still an answer.
  function isEcho(heard, spoken) {
    var h = words(heard).split(' ').filter(Boolean), q = words(spoken).split(' ').filter(Boolean);
    if (h.length < 4 || !q.length) return false;
    var s = ' ' + q.join(' ') + ' ';
    var inside = h.filter(function (x) { return s.indexOf(' ' + x + ' ') !== -1; }).length;
    return inside / h.length >= 0.8 && h.length >= q.length * 0.5;
  }

  // great / good / okay / poor / bad as a share of the top of the scale.
  var RATING_WORDS = [
    [/\b(great|excellent|amazing|awesome|perfect|elite|insane|fantastic)\b/, 1],
    [/\b(good|solid|pretty good|strong|well)\b/, 0.8],
    [/\b(okay|ok|average|decent|fine|alright|mid|so so)\b/, 0.6],
    [/\b(poor|weak|not great|meh|rough)\b/, 0.4],
    [/\b(bad|terrible|awful|horrible|useless)\b/, 0.2],
  ];

  // ---- Options: which option did they mean? -----------------------------------------------------
  // Every option is known by its label, its key and the extra words in GUIDE. A phrase heard
  // whole wins outright; otherwise the option whose distinctive words were heard wins
  // ("depot" counts for more than "side", which is in every shooting location).
  function optionTable(field) {
    var g = GUIDE[field.code] || {};
    var opts = (field.options || []).filter(function (o) { return o.k !== ''; });
    var df = {};
    var rows = opts.map(function (o) {
      var phrases = [o.v, String(o.k).replace(/[_/-]+/g, ' ')].concat((g.words && g.words[o.k]) || []);
      var toks = {};
      tokens(o.v + ' ' + String(o.k).replace(/[_/-]+/g, ' ')).forEach(function (t) { toks[t] = 1; });
      Object.keys(toks).forEach(function (t) { df[t] = (df[t] || 0) + 1; });
      return { key: o.k, phrases: phrases.map(words).filter(Boolean), toks: Object.keys(toks) };
    });
    var n = rows.length || 1;
    rows.forEach(function (r) {
      r.weights = r.toks.map(function (t) { return Math.log(1 + n / df[t]); });
      r.total = r.weights.reduce(function (s, w) { return s + w; }, 0) || 1;
    });
    return rows;
  }
  function scoreOption(row, heard) {
    var best = 0;
    row.phrases.forEach(function (p) { if (has(heard, p)) best = Math.max(best, 2 + p.split(' ').length * 0.1); });
    if (best) return best;
    var heardToks = {};
    tokens(heard).forEach(function (t) { heardToks[t] = 1; });
    var got = 0;
    row.toks.forEach(function (t, i) { if (heardToks[t]) got += row.weights[i]; });
    return got / row.total;
  }
  function bestOption(field, heard) {
    var rows = optionTable(field), w = words(heard), top = null, second = 0;
    rows.forEach(function (r) {
      var s = scoreOption(r, w);
      if (!top || s > top.score) { second = top ? top.score : 0; top = { key: r.key, score: s }; }
      else if (s > second) second = s;
    });
    if (!top || top.score < 0.5 || top.score - second < 0.05) return null;   // nothing heard, or a tie
    return top.key;
  }
  function manyOptions(field, heard) {
    var w = words(heard), picked = [], rows = optionTable(field);
    // "depot and the floor", "center, intentional": one option per part.
    String(heard || '').toLowerCase().split(/[,;]|\b(?:and|plus|also|then|or)\b/).forEach(function (part) {
      var k = bestOption(field, words(part));
      if (k != null && picked.indexOf(k) === -1) picked.push(k);
    });
    // A phrase heard whole anywhere counts too: any longer phrase, or a single word that
    // belongs to just one option ("floor" in "floor intentional center") — unless it's only
    // part of a longer phrase already used ("bump to trench" inside "bump to trench same side").
    var owners = {};
    rows.forEach(function (r) {
      r.phrases.forEach(function (p) {
        if (p.indexOf(' ') !== -1) return;
        owners[p] = owners[p] || [];
        if (owners[p].indexOf(r.key) === -1) owners[p].push(r.key);
      });
    });
    var used = [];
    rows.forEach(function (r) { if (picked.indexOf(r.key) !== -1) r.phrases.forEach(function (p) { if (has(w, p)) used.push(p); }); });
    rows.forEach(function (r) {
      if (picked.indexOf(r.key) !== -1) return;
      var hit = r.phrases.some(function (p) {
        if (!has(w, p) || used.some(function (u) { return u !== p && has(u, p); })) return false;
        return p.indexOf(' ') !== -1 || (owners[p] || []).length === 1;
      });
      if (hit) picked.push(r.key);
    });
    return picked;
  }
  function noneKey(field) {
    var opts = (field.options || []).map(function (o) { return o.k; });
    for (var i = 0; i < opts.length; i++) if (/^(none|no_?passing|n\/?a|ns|no)$/i.test(opts[i])) return opts[i];
    return null;
  }
  function label(field, key) {
    var o = (field.options || []).filter(function (x) { return x.k === key; })[0];
    return o ? o.v : String(key);
  }

  // ---- The questions ----------------------------------------------------------------------------
  // In form order, one per field, except fields with the same `group` (asked together as a
  // "which of these happened" list) and fields that are never asked.
  function questions(config) {
    var out = [];
    (config.sections || []).forEach(function (sec) {
      var fieldsIn = (sec.fields || []).filter(function (f) { return f.type !== 'image' && !f.hidden; });
      for (var i = 0; i < fieldsIn.length; i++) {
        var f = fieldsIn[i], g = GUIDE[f.code] || {};
        if (g.never) continue;
        if (f.type === 'boolean' && (g.group || !GUIDE[f.code])) {
          // A run of booleans with the same group (or, for a field this file doesn't know,
          // any run of plain yes/no boxes) becomes one question.
          var group = g.group || null, run = [f];
          while (i + 1 < fieldsIn.length && fieldsIn[i + 1].type === 'boolean') {
            var ng = GUIDE[fieldsIn[i + 1].code] || {};
            if ((group && ng.group === group) || (!group && !GUIDE[fieldsIn[i + 1].code])) { run.push(fieldsIn[++i]); } else break;
          }
          if (run.length > 1) {
            var gg = group ? GROUPS[group] || {} : {};
            out.push({
              id: 'group:' + (group || run[0].code), kind: 'flags', section: sec.name, fields: run,
              ask: gg.ask || 'Did any of these happen: ' + run.map(function (x) { return x.title; }).join(', ') + '?',
              say: gg.say || 'say the ones that happened, or none'
            });
            continue;
          }
        }
        out.push(questionFor(f, sec.name));
      }
    });
    // A question that has to wait for another (askAfter) moves to just behind it.
    out.slice().forEach(function (q) {
      var after = (GUIDE[q.id] || {}).askAfter;
      if (!after) return;
      var from = out.indexOf(q), to = out.map(function (x) { return x.id; }).indexOf(after);
      if (to > from) { out.splice(from, 1); out.splice(to, 0, q); }
    });
    return out;
  }
  function questionFor(f, section) {
    var g = GUIDE[f.code] || {};
    var kind = f.type === 'counter' ? 'number' : f.type;
    var ask = g.ask, say = g.say;
    if (!ask) {
      if (kind === 'number') { ask = 'How many: ' + f.title + '?'; say = 'a number'; }
      else if (kind === 'boolean') { ask = f.title + '?'; say = 'yes or no'; }
      else if (kind === 'range') { ask = f.title + '?'; say = f.min + ' to ' + f.max; }
      else if (kind === 'select' || kind === 'multiselect') {
        ask = f.title + '?';
        say = (f.options || []).filter(function (o) { return o.k !== ''; }).map(function (o) { return o.v; }).join(', ');
      } else { ask = f.title + '?'; say = kind === 'textarea' ? 'say it, or say none' : ''; }
    }
    return { id: f.code, kind: kind, section: section, fields: [f], ask: ask, say: say || '' };
  }

  // ---- Which fields are done ----------------------------------------------------------------------
  function emptyValue(f, v) {
    if (f.type === 'multiselect') return !Array.isArray(v) || v.length === 0;
    if (f.type === 'number') return v === null || v === undefined || v === '' || isNaN(parseInt(v, 10));
    if (f.type === 'text' || f.type === 'textarea' || f.type === 'select') return v === null || v === undefined || String(v).trim() === '';
    return false;   // booleans, counters and ranges always hold a value
  }
  // A field counts as answered when the app heard it, the scout set it, it was worked out from
  // another answer, or it's carried over from the last match (name, event, match type).
  function answeredSet(config, fields, marks, ctx) {
    var a = {};
    Object.keys(marks || {}).forEach(function (k) { if (marks[k]) a[k] = true; });
    allFields(config).forEach(function (f) {
      var v = fields[f.code];
      if ((f.code === 'scoutName' || f.code === 'eventKey' || f.code === 'matchType') && !emptyValue(f, v)) a[f.code] = true;
      if (f.code === 'matchNumber' && !emptyValue(f, v) && !(ctx && ctx.askMatchNumber)) a[f.code] = true;
      if (f.type !== 'boolean' && f.type !== 'counter' && f.type !== 'range' && f.type !== 'number' && !emptyValue(f, v) && f.code !== 'teamNumber') a[f.code] = true;
    });
    return a;
  }
  function allFields(config) {
    var out = [];
    (config.sections || []).forEach(function (s) { (s.fields || []).forEach(function (f) { if (f.type !== 'image') out.push(f); }); });
    return out;
  }
  // Is this field asked about at all right now? (A no-show only needs its comments.)
  function needed(f, fields, ctx, answered) {
    if (f.type === 'image' || f.hidden) return false;
    var g = GUIDE[f.code] || {};
    if (g.never && !g.derive) return false;
    if (fields.noShow && f.code !== 'co' && f.code !== 'noShow' && IDENTITY.indexOf(f.code) === -1 && f.code !== 'startPos') return false;
    if (g.when && !g.when(fields, ctx || {}, answered || {})) return false;
    return true;
  }
  // Fill in what can be worked out from answers already given. Returns { code: value } it set.
  function derive(config, fields, answered) {
    var set = {};
    allFields(config).forEach(function (f) {
      var g = GUIDE[f.code] || {};
      if (!g.derive || answered[f.code]) return;
      var v = g.derive(fields, answered);
      if (v !== undefined) set[f.code] = v;
    });
    return set;
  }
  // Required boxes that are needed and still empty (what blocks submitting in ways 2 and 3).
  function requiredGaps(config, fields, ctx, answered) {
    return allFields(config).filter(function (f) {
      if (!f.required || f.hidden) return false;
      if (fields.noShow && IDENTITY.indexOf(f.code) === -1) return false;
      if (!needed(f, fields, ctx, answered)) return false;
      return emptyValue(f, fields[f.code]);
    });
  }
  // Way 2: what's still open after listening, split into must-fill and maybe.
  function gaps(config, fields, ctx, answered) {
    var must = [], maybe = [];
    allFields(config).forEach(function (f) {
      if (f.hidden || !needed(f, fields, ctx, answered) || answered[f.code]) return;
      if ((GUIDE[f.code] || {}).never) return;
      if (f.required && (fields.noShow ? IDENTITY.indexOf(f.code) !== -1 : true)) must.push(f);
      else maybe.push(f);
    });
    return { must: must, maybe: maybe };
  }

  // Way 3: the next question to ask, or null when there is nothing left.
  function nextQuestion(config, fields, answered, skipped, ctx) {
    var qs = questions(config);
    for (var i = 0; i < qs.length; i++) {
      var q = qs[i];
      if (skipped && skipped[q.id]) continue;
      var open = q.fields.filter(function (f) { return needed(f, fields, ctx, answered) && !answered[f.code]; });
      if (q.kind === 'flags' ? open.length === q.fields.length : open.length) return q;
    }
    return null;
  }

  // ---- Turning words into a value -----------------------------------------------------------------
  // Returns { values: { code: value }, said } or null when the words didn't answer the question.
  function answer(q, heard, ctx) {
    var normalize = (ctx && ctx.normalizeNumbers) || null;
    var w = words(heard);
    if (!w) return null;
    var f = q.fields[0], g = GUIDE[f.code] || {};
    var values = {}, said = '';

    if (q.kind === 'flags') {
      var on = q.fields.filter(function (x) {
        var xs = ((GUIDE[x.code] || {}).words || {})['true'] || [];
        return xs.concat([x.title]).some(function (p) { return has(w, p); });
      });
      if (!on.length && !NONE_RE.test(w) && !/\b(none|nothing|no issues|no problems|all good)\b/.test(w)) return null;
      q.fields.forEach(function (x) { values[x.code] = on.indexOf(x) !== -1; });
      return { values: values, said: on.length ? on.map(function (x) { return x.title; }).join(', ') : 'none of them' };
    }
    if (q.kind === 'number') {
      var n = firstNumber(heard, normalize);
      if (n === null && (NONE_RE.test(w) || /\b(none|nothing|zero|didnt score|did not score)\b/.test(w))) n = 0;
      if (n === null) return null;
      n = Math.round(n);
      var lo = f.min === undefined ? 0 : f.min, hi = f.max === undefined ? 99999 : f.max;
      if (n < lo || n > hi) return null;
      values[f.code] = n;
      return { values: values, said: String(n) };
    }
    if (q.kind === 'range') {
      var max = Number(f.max), min = Number(f.min) || 0, step = Number(f.step) || 1;
      var v = firstNumber(heard, normalize);
      if (v === null) {
        for (var i = 0; i < RATING_WORDS.length && v === null; i++) if (RATING_WORDS[i][0].test(w)) v = RATING_WORDS[i][1] * max;
      } else if (max > 5 && v <= 5 && !/percent|%/.test(String(heard))) {
        v = v * (max / 5);          // "3" on a 0-100 scale means 3 out of 5
      }
      if (v === null && /\b(none|zero|nothing|didnt|did not)\b/.test(w)) v = min;
      if (v === null) return null;
      v = Math.max(min, Math.min(max, Math.round(v / step) * step));
      values[f.code] = v;
      return { values: values, said: String(v) + (max === 100 ? '%' : '') };
    }
    if (q.kind === 'boolean') {
      var yes = ((g.words || {})['true'] || []).some(function (p) { return has(w, p); });
      var isNo = NO_RE.test(w), isYes = YES_RE.test(w);
      var val;
      if (g.invert) {                      // "Did the robot show up?" for the No Show box
        if (yes) val = true; else if (isNo && !isYes) val = true; else if (isYes || /\b(here|showed|there)\b/.test(w)) val = false;
      } else if (isNo && !isYes) val = false;
      else if (isYes && !isNo) val = true;
      else if (!isNo && (yes || WEAK_YES_RE.test(w))) val = true;
      if (val === undefined) return null;
      values[f.code] = val;
      return { values: values, said: g.invert ? (val ? 'no-show' : 'showed up') : (val ? 'yes' : 'no') };
    }
    if (q.kind === 'select') {
      // Words first ("blue two" is position 5), then a bare number for numbered options.
      var key = bestOption(f, w);
      if (key === null) {
        var num = firstNumber(heard, normalize);
        if (num !== null && (f.options || []).some(function (o) { return o.k === String(num); })) key = String(num);
      }
      if (key === null) return null;
      values[f.code] = key;
      return { values: values, said: label(f, key) };
    }
    if (q.kind === 'multiselect') {
      var keys = manyOptions(f, heard);
      var nk = noneKey(f);
      if (!keys.length && nk && NONE_RE.test(w)) keys = [nk];
      if (keys.length > 1 && nk) keys = keys.filter(function (k) { return k !== nk; });   // "none" plus a place: the place
      if (!keys.length) return null;
      values[f.code] = keys;
      return { values: values, said: keys.map(function (k) { return label(f, k); }).join(', ') };
    }
    if (q.kind === 'text') {
      if (f.code === 'eventKey') {
        var compact = (normalize ? normalize(w) : w).replace(/\s+/g, '');
        if (!/^\d{4}[a-z][a-z0-9]+$/.test(compact)) return null;
        values[f.code] = compact;
        return { values: values, said: compact };
      }
      var text = String(heard).trim().replace(/^(my name is|my names|name is|its|it is|im|i am|this is|call me)\s+/i, '').replace(/[.!?]+$/, '');
      if (!text) return null;
      if (f.code === 'scoutName') text = text.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
      values[f.code] = text;
      return { values: values, said: text };
    }
    if (q.kind === 'textarea') {
      var note = NONE_RE.test(w) ? 'None' : String(heard).trim();
      values[f.code] = note;
      return { values: values, said: note.length > 60 ? note.slice(0, 57) + '…' : note };
    }
    return null;
  }

  // Is this field the same question for another period (auto's "How Scored" and teleop's,
  // the two "Climbed")? Then words that answer one say nothing about the other.
  function twinOf(q, field) {
    var opts = function (f) { return (f.options || []).map(function (o) { return o.k; }).filter(Boolean).join('|'); };
    return q.fields.some(function (f) {
      return f !== field && (f.title === field.title || (opts(f) && opts(f) === opts(field)));
    });
  }

  // The part of an answer that adds something else: "thirty AND THEY CLIMBED LEVEL TWO".
  // Only this part is searched for other boxes; short answers ("left side near the depot")
  // are never stretched to fill boxes nobody asked about.
  function extraClause(text) {
    var m = String(text || '').match(/\b(?:and|also|plus|then|but)\b\s+(?:also\s+)?(.+)$/i);
    return m ? m[1].trim() : '';
  }

  root.SCOUT_MODES = {
    isEcho: isEcho,
    twinOf: twinOf,
    extraClause: extraClause,
    GUIDE: GUIDE, GROUPS: GROUPS, command: command, questions: questions, nextQuestion: nextQuestion,
    answer: answer, answeredSet: answeredSet, derive: derive, needed: needed, requiredGaps: requiredGaps,
    gaps: gaps, emptyValue: emptyValue, bestOption: bestOption, manyOptions: manyOptions,
  };
})(typeof window !== 'undefined' ? window : module.exports);
