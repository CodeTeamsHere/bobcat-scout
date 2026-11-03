/* ==========================================================================
   BOBCAT SCOUT: generic fill for any game
   --------------------------------------------------------------------------
   The talk-to-fill parser in app.js was written for the 2026 game (REBUILT): it knows fuel,
   depot, climb levels. A new season's boxes are not in it. This file fills those boxes from the
   game pack alone (config.json), with no game words written into the code:

     number / counter / range   a number next to a word from the box's title, inside the right
                                part of the match ("scored 4 balls in auto" -> Balls in auto = 4)
     yes/no                     the box's title words are mentioned (yes) or negated (no)
     select / multiselect       an option's label words are said ("hang level 2")

   It is rougher than the 2026 parser on purpose: every box it fills is marked "medium" so the
   scout is asked to check it. It never touches the identity boxes (name, event, match, team);
   those stay with the main parser. Plain functions, no page: tools/test-generic.js runs them.
   ========================================================================== */
(function (root) {
  'use strict';

  var STOP = /^(?:the|a|an|of|in|on|at|to|for|did|does|do|was|were|is|are|they|their|robot|team|scored|score|scoring|total|number|how|many|much|during|and|or|this|that|with|from|it|its|by|any|your|you|what|which|level|type|rate|rating)$/;
  var PHASES = [
    { key: 'auto', re: /\b(?:auto|autonomous)\b/ },
    { key: 'tele', re: /\b(?:teleop|tele\s*op|teleoperated|driver\s+control)\b/ },
    { key: 'end', re: /\b(?:endgame|end\s+game)\b/ }
  ];
  var NEG = /\b(?:no|not|never|didn'?t|did\s+not|doesn'?t|does\s+not|couldn'?t|could\s+not|wasn'?t|was\s+not|without|failed\s+to|unable\s+to|nothing)\s+(?:\w+\s+){0,2}$/;

  function stem(w) { var x = String(w).toLowerCase(), y = x.replace(/(?:ing|ed|es|s)$/, ''); return y.length >= 4 ? y : x; }
  function words(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean); }
  function camel(code) { return String(code).replace(/([a-z])([A-Z])/g, '$1 $2'); }
  function phaseOf(section, field) {
    var s = (section + ' ' + field.title + ' ' + camel(field.code)).toLowerCase();
    for (var i = 0; i < PHASES.length; i++) if (PHASES[i].re.test(s)) return PHASES[i].key;
    return null;
  }
  // The title's own words, minus filler and minus the match-part words (those pick the window).
  function keywords(field) {
    var out = [];
    words(field.title + ' ' + camel(field.code)).forEach(function (w) {
      if (w.length < 3 || STOP.test(w) || /^(?:auto|autonomous|teleop|tele|endgame|end|game)$/.test(w)) return;
      var st = stem(w);
      if (st.length >= 2 && out.indexOf(st) < 0) out.push(st);
    });
    return out;
  }
  // Cut the talk into the parts of the match. Each clause (split at commas and full stops) belongs to
  // the part it names ("... in auto"); a clause that names none stays with the part before it
  // ("teleop 20 balls, defense 2" keeps "defense 2" in teleop).
  function windows(text) {
    var w = { all: text, auto: '', tele: '', end: '' }, cur = null;
    var SWITCH = /\s+(?:and|then|also|plus)\s+(?=(?:in\s+|during\s+|for\s+|the\s+)?(?:autonomous|auto|teleop|tele\s*op|endgame|end\s+game)\b)/;
    text.split(/[.,;]+/).reduce(function (all, c) { return all.concat(c.split(SWITCH)); }, []).forEach(function (clause) {
      for (var i = 0; i < PHASES.length; i++) if (PHASES[i].re.test(clause)) { cur = PHASES[i].key; break; }
      if (cur) w[cur] += ' ' + clause + ' . ';
    });
    return w;
  }
  function hasStem(text, st) { return new RegExp('\\b' + st.replace(/[^a-z0-9]/g, '') + '[a-z]*').test(text); }
  function negatedAt(text, idx) { return NEG.test(text.slice(Math.max(0, idx - 28), idx)); }

  function numberFor(win, kws) {
    var best = null;
    kws.forEach(function (k) {
      var kw = k.replace(/[^a-z0-9]/g, '') + '[a-z]*';
      var re1 = new RegExp('(\\d+)\\s+(?:\\w+\\s+){0,2}?' + kw, 'g');     // "4 balls", "4 good balls"
      var re2 = new RegExp('\\b' + kw + '\\s*(?:was|were|is|of|:|=|-)?\\s*(\\d+)', 'g');   // "balls 4", "balls: 4"
      var m;
      while ((m = re1.exec(win))) best = best == null ? Number(m[1]) : best;
      while ((m = re2.exec(win))) best = best == null ? Number(m[1]) : best;
      if (best == null && new RegExp('\\b(?:no|zero|none|0)\\s+(?:\\w+\\s+){0,2}?' + kw).test(win)) best = 0;
    });
    return best;
  }

  function fill(rawText, config, skipCodes) {
    var out = { fields: {}, confidence: {} };
    var text = ' ' + String(rawText || '').toLowerCase().replace(/[!?]+/g, '.') + ' ';
    var win = windows(text);
    var skip = {};
    (skipCodes || []).forEach(function (c) { skip[c] = true; });
    ((config && config.sections) || []).forEach(function (sec) {
      (sec.fields || []).forEach(function (f) {
        if (!f.code || skip[f.code] || f.hidden) return;
        if (['number', 'counter', 'range', 'boolean', 'select', 'multiselect'].indexOf(f.type) < 0) return;
        var ph = phaseOf(sec.name || '', f);
        var scope = ph && win[ph] && win[ph].trim() ? win[ph] : text;
        var set = function (v) { out.fields[f.code] = v; out.confidence[f.code] = 'medium'; };

        if (f.type === 'number' || f.type === 'counter' || f.type === 'range') {
          var kws = keywords(f);
          if (!kws.length) return;
          var n = numberFor(scope, kws);
          if (n == null) return;
          if (f.min != null) n = Math.max(Number(f.min), n);
          if (f.max != null) n = Math.min(Number(f.max), n);
          set(n);
        } else if (f.type === 'boolean') {
          var bk = keywords(f);
          if (!bk.length) return;
          var hits = bk.filter(function (k) { return hasStem(scope, k); });
          if (hits.length < Math.min(bk.length, 2) && !(bk.length === 1 && hits.length === 1)) return;
          var re = new RegExp('\\b' + hits[0].replace(/[^a-z0-9]/g, '') + '[a-z]*'), m = re.exec(scope);
          set(!(m && negatedAt(scope, m.index)));
        } else {                                            // select / multiselect
          var chosen = [];
          (f.options || []).forEach(function (o) {
            var label = words(o.v || o.k).filter(function (w) { return !STOP.test(w) || /^\d$/.test(w); });
            if (!label.length || !String(o.k)) return;
            var all = label.every(function (w) { return /^\d+$/.test(w) ? new RegExp('(?:^|[^\\d])' + w + '(?!\\d)').test(scope) : hasStem(scope, stem(w)); });
            if (all) chosen.push({ k: o.k, n: label.length });
          });
          if (!chosen.length) return;
          chosen.sort(function (a, b) { return b.n - a.n; });
          if (f.type === 'select') set(chosen[0].k);
          else set(chosen.filter(function (c) { return c.n === chosen[0].n; }).map(function (c) { return c.k; }));
        }
      });
    });
    return out;
  }

  var API = { fill: fill, keywords: keywords, windows: windows };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.SCOUT_GENERIC = API;
})(typeof window !== 'undefined' ? window : this);
