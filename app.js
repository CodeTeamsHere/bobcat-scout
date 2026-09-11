/* ==========================================================
   BOBCAT SCOUT — app.js
   Main application logic (vanilla JavaScript, no frameworks)
   ========================================================== */

// =====================================================================
// STATE
// =====================================================================

let CONFIG = null;            // loaded from config.json
let ALL_FIELDS = [];          // flat list of every field
let FIELD_ORDER = [];         // ordered list of field codes for TSV
let fields = {};              // current values
let confidence = {};          // confidence map per field
let sessionMatches = [];      // saved matches in this session
let isRecording = false;
let recognition = null;
let baseTranscript = '';      // text before this recording started
let activeTab = 'qr';
let currentForm = 'match';    // 'match' (quantitative) or 'pit' (qualitative robot info)

function activeSections() { return currentForm === 'pit' ? (CONFIG.pitSections || []) : CONFIG.sections; }
function applyForm() { ALL_FIELDS = activeSections().flatMap(s => s.fields); FIELD_ORDER = ALL_FIELDS.map(f => f.code); }

const SAMPLE_TEXT = "Scout name is Krish, event 2026ctwat, match 14, scouting team 177 red 2, preloaded 3 fuel. In auto they made 4 in the hub and left the line. Teleop they scored 18, picked from the neutral zone and the outpost chute. Pickup was pretty good, passing was amazing. Endgame climbed the mid rung. Smooth driver. Got defended a bit but no issues.";

// =====================================================================
// HELPERS
// =====================================================================

function $(id) { return document.getElementById(id); }
function $$(sel) { return document.querySelectorAll(sel); }

function initialFieldState() {
  const state = {};
  ALL_FIELDS.forEach(f => {
    if (f.default !== undefined) state[f.code] = f.default;
    else if (f.type === 'boolean') state[f.code] = false;
    else if (f.type === 'number' || f.type === 'range') state[f.code] = 0;
    else state[f.code] = '';
  });
  return state;
}

function generateTSV(fieldVals, withHeader) {
  const values = FIELD_ORDER.map(code => {
    const val = fieldVals[code];
    if (Array.isArray(val)) return val.join(',');
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    return String(val == null ? '' : val);
  });
  if (withHeader) {
    return FIELD_ORDER.join('\t') + '\n' + values.join('\t');
  }
  return values.join('\t');
}

// =====================================================================
// PARSER — converts free-form transcript text into structured fields.
// Same logic as the React prototype, ported to plain JS.
// =====================================================================

// ---------------------------------------------------------------------
// Spoken numbers. Browser speech recognition hands back "four in auto" and
// "team one seventy seven" at least as often as it hands back digits, so
// every number pattern below would miss unless we digitise them first.
// ---------------------------------------------------------------------

const NUM_UNITS = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9
};
const NUM_TEENS = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19
};
const NUM_TENS = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90
};
// "one" on its own is usually the word, not the number ("no one climbed").
const BARE_ONE_GUARD = /^(no|any|each|some|every|only|which|that|another|either|neither)$/;

function numWordValue(w) {
  if (w in NUM_UNITS) return NUM_UNITS[w];
  if (w in NUM_TEENS) return NUM_TEENS[w];
  if (w in NUM_TENS) return NUM_TENS[w];
  return null;
}

/* Turn runs of number words into digits.

   Team numbers are read the way people actually say them — as chunks that get
   concatenated, not summed. "one seventy seven" is 177, not 78. "eleven
   fourteen" is 1114. "two fifty four" is 254. Plain counts fall out of the
   same rule: "four" -> 4, "eighteen" -> 18, "twenty one" -> 21.
   "hundred" and "thousand" are handled as multipliers so "eleven hundred
   fourteen" also lands on 1114. */
function normalizeNumberWords(text) {
  const tokens = text.split(/(\s+|[,.;!?])/);
  const out = [];
  let i = 0;

  const wordAt = (k) => (tokens[k] || '').toLowerCase().replace(/[^a-z]/g, '');
  const isSep = (k) => /^(\s+|[,.;!?])$/.test(tokens[k] || '');

  while (i < tokens.length) {
    if (isSep(i) || !tokens[i]) { out.push(tokens[i]); i++; continue; }

    const w = wordAt(i);
    if (numWordValue(w) === null && w !== 'hundred' && w !== 'thousand') {
      out.push(tokens[i]); i++; continue;
    }

    // Walk the whole run of number words (separators inside the run are skipped,
    // but a comma or period ends it — "team 177, match 14" must stay two numbers).
    const runStart = i;
    const chunks = [];
    let guarded = false;
    let j = i;
    while (j < tokens.length) {
      if (/^[,.;!?]$/.test(tokens[j])) break;
      if (isSep(j)) { j++; continue; }
      const a = wordAt(j);
      const av = numWordValue(a);
      if (av === null && a !== 'hundred' && a !== 'thousand') break;

      if (a === 'hundred' || a === 'thousand') {
        const mult = a === 'hundred' ? 100 : 1000;
        const prev = chunks.pop();
        chunks.push(String((prev ? parseInt(prev, 10) : 1) * mult));
        j++;
        continue;
      }

      // tens + unit reads as one chunk: "seventy seven" -> 77
      if (a in NUM_TENS) {
        let k = j + 1;
        while (k < tokens.length && isSep(k) && !/^[,.;!?]$/.test(tokens[k])) k++;
        const b = wordAt(k);
        if (b && b in NUM_UNITS && NUM_UNITS[b] !== 0) {
          chunks.push(String(NUM_TENS[a] + NUM_UNITS[b]));
          j = k + 1;
          continue;
        }
      }
      if (a === 'one' && chunks.length === 0) {
        // is this a lone "one" used as a pronoun?
        let p = runStart - 1;
        while (p >= 0 && isSep(p)) p--;
        if (p >= 0 && BARE_ONE_GUARD.test(wordAt(p))) { guarded = true; break; }
      }
      chunks.push(String(av));
      j++;
    }

    if (guarded || !chunks.length) { out.push(tokens[i]); i++; continue; }

    // A run that is a single small value stays a single value; longer runs
    // concatenate, which is how team numbers are spoken.
    let digits = chunks.length === 1 ? chunks[0] : chunks.join('');
    // strip the padding "eleven hundred" leaves behind: 1100 + 14 -> 1114
    if (chunks.length > 1 && /00$/.test(chunks[0])) {
      const head = parseInt(chunks[0], 10);
      const tail = chunks.slice(1).join('');
      if (tail.length <= String(head).length - 1) {
        digits = String(head + parseInt(tail, 10));
      }
    }
    out.push(digits);
    // the run swallowed the whitespace that ended it; put one space back so
    // "one one one four on blue" stays "1114 on blue", not "1114on blue"
    if (j > 0 && isSep(j - 1) && !/^[,.;!?]$/.test(tokens[j - 1])) out.push(' ');
    i = j;
  }
  return out.join('');
}

function parseTranscript(text, initialState) {
  const original = text;
  const t = normalizeNumberWords(text.toLowerCase());
  const result = Object.assign({}, initialState);
  const conf = {};

  const titleCase = s => s.replace(/\b\w/g, c => c.toUpperCase());

  // ---- Scout name ----
  const scoutPatterns = [
    /(?:scouter|scout)\s*(?:name\s*)?(?:is|:|=)\s*([a-z][a-z\s'-]{1,30}?)(?=[,.]|\s+(?:and|event|match|team|alliance|station|for|at|preload|in auto|teleop|scouting|\d)|$)/i,
    /my\s+name\s+is\s+([a-z][a-z\s'-]{1,30}?)(?=[,.]|\s+(?:and|event|match|team|alliance|station|for|at|preload|\d)|$)/i,
    /this\s+is\s+([a-z][a-z'-]{1,20})\s+scouting/i,
    /i\s*am\s+([a-z][a-z'-]{1,20})(?=[,.]|\s+(?:scouting|and|event|match|team)|$)/i,
    /^([a-z][a-z'-]{1,20})\s+scouting\b/i,
  ];
  for (const p of scoutPatterns) {
    const m = original.match(p);
    if (m && m[1]) {
      result.scoutName = titleCase(m[1].trim());
      conf.scoutName = 'high';
      break;
    }
  }

  // ---- Event key ----
  const eventPatterns = [
    /event\s*(?:key\s*)?(?:is|:|=)?\s*(\d{4}[a-z]{3,10})/i,
    /\b(20\d{2}[a-z]{3,10})\b/,
  ];
  for (const p of eventPatterns) {
    const m = t.match(p);
    if (m && m[1]) {
      result.eventKey = m[1].toLowerCase();
      conf.eventKey = 'high';
      break;
    }
  }

  // ---- Match number ----
  const mn = t.match(/(?:match\s*(?:number|#)?\s*|qm\s*)(\d{1,3})\b/i);
  if (mn) {
    const n = parseInt(mn[1]);
    if (n > 0 && n <= 200) {
      result.matchNumber = n;
      conf.matchNumber = 'high';
    }
  }

  // ---- Match type ----
  if (/\b(playoff|elim|elimination|finals|semifinal|bracket)\b/i.test(t)) {
    result.matchType = 'sf'; conf.matchType = 'high';
  } else if (/\bpractice\s+match\b/i.test(t) || /\bpm\s*\d/i.test(t)) {
    result.matchType = 'pm'; conf.matchType = 'high';
  } else if (/\b(qualification|qual|qm)\b/i.test(t)) {
    result.matchType = 'qm'; conf.matchType = 'medium';
  }

  // ---- Team number ----
  const teamPatterns = [
    /team\s*(?:number|#)?\s*(\d{1,5})\b/i,
    /\bscouting\s+(?:team\s+)?(\d{2,5})\b/i,
    // terse call: "177 red 2" / "1114 on blue"
    /\b(\d{1,5})\s+(?:on\s+)?(?:red|blue)\b/i,
  ];
  for (const p of teamPatterns) {
    const m = t.match(p);
    if (m && m[1]) {
      const n = parseInt(m[1]);
      if (n >= 1 && n <= 99999) {
        result.teamNumber = n;
        conf.teamNumber = 'high';
        break;
      }
    }
  }

  // ---- Alliance ----
  const redMatch = t.match(/\b(?:red\s*(?:alliance|\d)|alliance\s*(?:is\s*)?red|on\s*red)\b/i);
  const blueMatch = t.match(/\b(?:blue\s*(?:alliance|\d)|alliance\s*(?:is\s*)?blue|on\s*blue)\b/i);
  if (redMatch && !blueMatch) {
    result.alliance = 'red'; conf.alliance = 'high';
  } else if (blueMatch && !redMatch) {
    result.alliance = 'blue'; conf.alliance = 'high';
  } else if (redMatch && blueMatch) {
    result.alliance = redMatch.index < blueMatch.index ? 'red' : 'blue';
    conf.alliance = 'medium';
  }

  // ---- Driver station ----
  const stationPatterns = [
    /driver\s*station\s*(\d)/i,
    /station\s*(\d)/i,
    // \b matters: without it "scored 3" matches as "red 3" and silently
    // sets the driver station on any sentence containing a score.
    /\b(?:red|blue)\s*(\d)\b/i,
    /\bd\s*(\d)\b/i,
  ];
  for (const p of stationPatterns) {
    const m = t.match(p);
    if (m && m[1]) {
      const n = m[1];
      if (n === '1' || n === '2' || n === '3') {
        result.driverStation = n;
        conf.driverStation = 'high';
        break;
      }
    }
  }

  // ---- Starting position ----
  if (/\b(wall\s*side|on\s+the\s+wall|wall\s+start)\b/i.test(t)) {
    result.startingPosition = 'wall'; conf.startingPosition = 'high';
  } else if (/\bcenter\s*(?:start|position)?\b/i.test(t)) {
    result.startingPosition = 'center'; conf.startingPosition = 'high';
  } else if (/\b(field\s*side|far\s*side)\b/i.test(t)) {
    result.startingPosition = 'field'; conf.startingPosition = 'high';
  }

  // ---- Preloaded fuel ----
  // Look only RIGHT of "preload" to avoid grabbing earlier numbers (team #, station, etc.)
  const preloadMatch = t.match(/preload(?:ed)?(?:\s*(?:with|of))?\s*(\d{1,2})\b/i);
  if (preloadMatch) {
    result.preloadedFuel = Math.min(parseInt(preloadMatch[1]), 8);
    conf.preloadedFuel = 'high';
  } else {
    // Alt phrasing: "with 3 preloaded"
    const preBeforeMatch = t.match(/(\d{1,2})\s*preload(?:ed)?/i);
    if (preBeforeMatch) {
      result.preloadedFuel = Math.min(parseInt(preBeforeMatch[1]), 8);
      conf.preloadedFuel = 'high';
    }
  }

  // ---- Auto scoring ----
  // The count is said before the word "auto" as often as after it
  // ("four in auto" vs "in auto they made four"), so check both directly
  // instead of only scanning forward from the keyword.
  // The gap is letters-only on purpose. \w would let "team 177 scored 3 in
  // auto" match starting at 177 and record the team number as the score.
  const AUTO_BEFORE = /(\d+)\s+(?:[a-z]+\s+){0,2}?(?:in|during|for)\s+(?:the\s+)?auto(?:nomous)?\b/i;
  const AUTO_AFTER = /\bauto(?:nomous)?\b(?:[^.?!]{0,60}?)(?:made|scored|put in|hit|got|sank|banked)\s*(\d+)/i;
  const autoHit = t.match(AUTO_BEFORE) || t.match(AUTO_AFTER);
  if (autoHit) { result.autoHubMade = parseInt(autoHit[1]); conf.autoHubMade = 'high'; }

  const autoSection = t.match(/\b(auto|autonomous)\b[\s\S]{0,200}/i);
  if (autoSection) {
    const as = autoSection[0];
    if (conf.autoHubMade === undefined) {
      const autoMade = as.match(/(?:made|scored|put in|hit)\s*(\d+)/i) || as.match(/(\d+)\s*(?:in auto|made|scored)/i);
      if (autoMade) { result.autoHubMade = parseInt(autoMade[1]); conf.autoHubMade = 'high'; }
    }
    // "left the line" yes; "started on the left" no
    if (/\b(?:left|leave|exited|exit)\s*(?:the\s*)?(?:line|tarmac|zone|community|starting)?\b/i.test(as)
        && !/\b(?:on|from|to)\s+the\s+left\b/i.test(as)) { result.autoLeft = true; conf.autoLeft = 'high'; }
    else if (/\bmobility\b/i.test(as)) { result.autoLeft = true; conf.autoLeft = 'high'; }
    if (/\bclimb(ed)?\s*(in\s*auto|level\s*1|l1|low\s*rung)/i.test(as)) {
      result.autoClimb = 'level1'; conf.autoClimb = 'high';
    }
  }

  // ---- Teleop ----
  const TELE_BEFORE = /(\d+)\s+(?:[a-z]+\s+){0,2}?(?:in|during)\s+(?:the\s+)?tele\s*-?\s*op(?:erated)?\b/i;
  const TELE_AFTER = /\btele\s*-?\s*op(?:erated)?\b(?:[^.?!]{0,60}?)(?:made|scored|put in|hit|got|sank|banked)\s*(\d+)/i;
  const teleHit = t.match(TELE_BEFORE) || t.match(TELE_AFTER);
  if (teleHit) { result.teleopHubMade = parseInt(teleHit[1]); conf.teleopHubMade = 'high'; }

  const teleopIdx = t.search(/\b(teleop|tele op|teleoperated)\b/i);
  if (teleopIdx >= 0 && conf.teleopHubMade === undefined) {
    const ts = t.slice(teleopIdx, teleopIdx + 400);
    // "made 18", "scored 18", "18 made", "got 18 in"
    const teleMade = ts.match(/(?:made|scored|put in|hit)\s*(\d+)/i) || ts.match(/(\d+)\s*(?:made|scored|in the hub)/i);
    if (teleMade) { result.teleopHubMade = parseInt(teleMade[1]); conf.teleopHubMade = 'high'; }
  }

  // ---- No show ----
  if (/\b(no\s*show|did(n'?t| not)\s+show(?:\s+up)?|never\s+showed|absent|didn'?t\s+come\s+out)\b/i.test(t)) {
    result.noShow = true; conf.noShow = 'high';
  }

  // Sentiment has to stay inside its own clause. A flat character window lets
  // "passing was amazing, driver was rough" rate the driver a 5, so stop at
  // the nearest comma or full stop on each side.
  const clauseWindow = (idx, len, back, fwd) => {
    let a = Math.max(0, idx - back);
    let b = Math.min(t.length, idx + len + fwd);
    const left = t.slice(a, idx);
    const lb = Math.max(left.lastIndexOf(','), left.lastIndexOf('.'), left.lastIndexOf(';'));
    if (lb >= 0) a += lb + 1;
    const right = t.slice(idx + len, b);
    const rb = right.search(/[,.;!?]/);
    if (rb >= 0) b = idx + len + rb;
    return t.slice(a, b);
  };

  // ---- Passing & pickup effectiveness (1–5 from sentiment near keyword) ----
  const rateAround = (keywords) => {
    for (const kw of keywords) {
      const re = new RegExp(kw, 'gi');
      let m;
      while ((m = re.exec(t)) !== null) {
        const ctx = clauseWindow(m.index, m[0].length, 40, 50);
        if (/\bpretty\s+good\b/i.test(ctx)) return 4;
        if (/\b(amazing|incredible|elite|insane|fantastic|excellent|perfect|flawless|great|awesome)\b/i.test(ctx)) return 5;
        if (/\bgood\b/i.test(ctx)) return 5;
        if (/\b(solid|strong|really\s+good|very\s+good|nice|effective|consistent)\b/i.test(ctx)) return 4;
        if (/\b(decent|okay|ok|alright|average|fine)\b/i.test(ctx)) return 3;
        if (/\b(bad|poor|weak|rough|messy|struggled|maybe|kinda|few|barely)\b/i.test(ctx)) return 2;
        if (/\b(awful|terrible|horrible|never|couldn'?t|could\s+not|failed|none)\b/i.test(ctx)) return 1;
      }
    }
    return null;
  };
  const pickupRating = rateAround(['picking\\s+up', 'pickup', 'pick\\s+up', 'intake', 'intaking']);
  if (pickupRating !== null) { result.pickupEffectiveness = pickupRating; conf.pickupEffectiveness = 'high'; }
  const passRating = rateAround(['passing', 'passes', '\\bpass\\b']);
  if (passRating !== null) { result.passingEffectiveness = passRating; conf.passingEffectiveness = 'high'; }

  // ---- Fallback ----
  // Only guess "teleop" for a bare count when auto was never mentioned —
  // otherwise "scored 2 in auto" silently lands in the wrong column.
  if (conf.teleopHubMade === undefined && conf.autoHubMade === undefined
      && !/\bauto(?:nomous)?\b/i.test(t)) {
    const anyMade = t.match(/(?:made|scored)\s*(\d+)/i);
    if (anyMade) { result.teleopHubMade = parseInt(anyMade[1]); conf.teleopHubMade = 'medium'; }
  }

  // ---- Pickup sources ----
  if (/\bdepot\b/i.test(t)) { result.pickedFromDepot = true; conf.pickedFromDepot = 'high'; }
  if (/\b(human player|hp|chute|outpost)\b/i.test(t)) { result.pickedFromHP = true; conf.pickedFromHP = 'high'; }
  if (/\b(floor|ground|off the ground|loose fuel|scooped|neutral zone)\b/i.test(t)) { result.pickedFromFloor = true; conf.pickedFromFloor = 'high'; }

  // ---- Endgame climb ----
  // "climbed high" is how scouters actually say it, so match the bare
  // high/mid/low wording as well as the rung/level phrasing.
  const CLIMB_L3 = /\blevel\s*3\b|\bl3\b|\b(?:high|top)\s*(?:rung|bar)\b|\bclimb(?:ed|ing)?\s*(?:up\s*)?(?:to\s*)?(?:the\s*)?(?:high|top)\b|\bhigh\s*climb\b/i;
  const CLIMB_L2 = /\blevel\s*2\b|\bl2\b|\b(?:mid|middle)\s*(?:rung|bar)\b|\bclimb(?:ed|ing)?\s*(?:up\s*)?(?:to\s*)?(?:the\s*)?(?:mid|middle)\b|\bmid\s*climb\b/i;
  const CLIMB_L1 = /\blevel\s*1\b|\bl1\b|\blow\s*(?:rung|bar)\b|\bclimb(?:ed|ing)?\s*(?:up\s*)?(?:to\s*)?(?:the\s*)?low\b|\blow\s*climb\b/i;
  if (CLIMB_L3.test(t)) { result.endgameClimb = 'level3'; conf.endgameClimb = 'high'; }
  else if (CLIMB_L2.test(t)) { result.endgameClimb = 'level2'; conf.endgameClimb = 'high'; }
  else if (CLIMB_L1.test(t)) { result.endgameClimb = 'level1'; conf.endgameClimb = 'high'; }
  else if (/\bparked\b/i.test(t)) { result.endgameClimb = 'parked'; conf.endgameClimb = 'high'; }
  else if (/\b(tried to climb|attempted.*climb|climb.*fail|fell off)\b/i.test(t)) { result.endgameClimb = 'attempted_failed'; conf.endgameClimb = 'high'; }
  else if (/\bno climb|didn't climb|did not climb\b/i.test(t)) { result.endgameClimb = 'none'; conf.endgameClimb = 'high'; }

  // ---- Driver skill ----
  // Only judge sentiment words that appear NEAR a "driver/driving/drove" mention,
  // so unrelated praise (e.g. "passing was amazing") can't inflate the driver rating.
  const driverMention = t.match(/\bdriv(?:er|ing|e)\b|\bdrove\b/i);
  if (driverMention) {
    const di = driverMention.index;
    const dctx = clauseWindow(di, driverMention[0].length, 30, 40);
    if (/\b(elite|amazing|incredible|insane|fantastic|flawless|phenomenal)\b/i.test(dctx)) { result.driverSkill = 5; conf.driverSkill = 'high'; }
    else if (/\b(great|really good|very good|smooth|strong|excellent|clean)\b/i.test(dctx)) { result.driverSkill = 4; conf.driverSkill = 'high'; }
    else if (/\b(solid|decent|fine|okay|ok|competent|average)\b/i.test(dctx)) { result.driverSkill = 3; conf.driverSkill = 'medium'; }
    else if (/\b(rough|struggled|messy|shaky|sloppy|jerky)\b/i.test(dctx)) { result.driverSkill = 2; conf.driverSkill = 'high'; }
    else if (/\b(crashed|awful|terrible|horrible|could ?n'?t drive|could not drive)\b/i.test(dctx)) { result.driverSkill = 1; conf.driverSkill = 'high'; }
  }

  // ---- Defense ----
  if (/\b(played\s*(great|strong|heavy)\s*defense|dominant defense|lockdown defense)\b/i.test(t)) { result.defenseRating = 5; conf.defenseRating = 'high'; }
  else if (/\b(played.*defense.*well|good defense)\b/i.test(t)) { result.defenseRating = 4; conf.defenseRating = 'high'; }
  else if (/\b(played some defense|some defense)\b/i.test(t)) { result.defenseRating = 3; conf.defenseRating = 'medium'; }
  else if (/\b(tried.*defense|weak defense|bad defense)\b/i.test(t)) { result.defenseRating = 2; conf.defenseRating = 'medium'; }

  // ---- Was defended ----
  if (/\b(got defended|played defense on|defended against|smacked around|hit by)\b/i.test(t)) {
    result.wasDefended = true; conf.wasDefended = 'high';
  }

  // ---- Tipped / disabled / cards ----
  if (/\b(tipped|fell over|flipped)\b/i.test(t)) { result.tipped = true; conf.tipped = 'high'; }
  if (/\b(broke|died|disabled|stopped working|went dead|bot died)\b/i.test(t)) { result.disabled = true; conf.disabled = 'high'; }
  if (/\bred card\b/i.test(t)) { result.cardStatus = 'red'; conf.cardStatus = 'high'; }
  else if (/\byellow card\b|\bcarded\b/i.test(t)) { result.cardStatus = 'yellow'; conf.cardStatus = 'high'; }

  // Always copy the raw transcript into comments
  result.comments = text.trim().slice(0, 500);
  conf.comments = 'high';

  return { fields: result, confidence: conf };
}

// =====================================================================
// FIELD RENDERING
// =====================================================================

function confBadgeHTML(code) {
  const c = confidence[code];
  if (!c || c === 'user') return '';
  const map = { high: ['conf-high', 'AI'], medium: ['conf-medium', '?'], low: ['conf-low', '!'] };
  if (!map[c]) return '';
  return `<span class="conf-badge ${map[c][0]}">${map[c][1]}</span>`;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

function renderFieldHTML(f) {
  const val = fields[f.code];
  const reqMark = f.required ? '<span class="req">*</span>' : '';
  const labelHTML = `<label class="field-label">${escapeHTML(f.title)}${reqMark} ${confBadgeHTML(f.code)}</label>`;

  if (f.type === 'text') {
    return `<div data-field="${f.code}">${labelHTML}<input type="text" data-input="${f.code}" value="${escapeHTML(val || '')}" placeholder="${escapeHTML(f.placeholder || '')}"></div>`;
  }
  if (f.type === 'number') {
    const min = f.min !== undefined ? `min="${f.min}"` : '';
    const max = f.max !== undefined ? `max="${f.max}"` : '';
    return `<div data-field="${f.code}">${labelHTML}<input type="number" data-input="${f.code}" value="${val == null ? 0 : val}" ${min} ${max}></div>`;
  }
  if (f.type === 'select') {
    const opts = f.options.map(o => `<option value="${o.k}" ${val === o.k ? 'selected' : ''}>${escapeHTML(o.v)}</option>`).join('');
    return `<div data-field="${f.code}">${labelHTML}<select data-input="${f.code}">${opts}</select></div>`;
  }
  if (f.type === 'boolean') {
    return `<div data-field="${f.code}">
      <label class="toggle-wrap" data-toggle="${f.code}">
        <div class="toggle ${val ? 'on' : ''}"></div>
        <span class="toggle-label">${escapeHTML(f.title)} ${confBadgeHTML(f.code)}</span>
      </label>
    </div>`;
  }
  if (f.type === 'range') {
    return `<div data-field="${f.code}">${labelHTML}
      <div class="range-row">
        <input type="range" data-input="${f.code}" value="${val == null ? f.default : val}" min="${f.min}" max="${f.max}" step="1">
        <span class="range-value" data-range-value="${f.code}">${val == null ? f.default : val}</span>
      </div>
    </div>`;
  }
  return '';
}

function renderAllFields() {
  const container = $('fields-container');
  let html = '';
  activeSections().forEach(sec => {
    html += `<div class="section-header">${escapeHTML(sec.name.toUpperCase())}</div>`;
    html += `<div class="field-grid">`;
    sec.fields.forEach(f => { html += renderFieldHTML(f); });
    html += `</div>`;
  });
  container.innerHTML = html;
  attachFieldListeners();
}

function attachFieldListeners() {
  // Inputs (text/number/select/range)
  $$('[data-input]').forEach(el => {
    el.addEventListener('input', e => {
      const code = el.getAttribute('data-input');
      const field = ALL_FIELDS.find(f => f.code === code);
      let v = el.value;
      if (field.type === 'number') v = parseInt(v) || 0;
      if (field.type === 'range') {
        v = parseInt(v) || field.default;
        const valSpan = document.querySelector(`[data-range-value="${code}"]`);
        if (valSpan) valSpan.textContent = v;
      }
      setField(code, v);
    });
  });

  // Toggles
  $$('[data-toggle]').forEach(el => {
    el.addEventListener('click', e => {
      const code = el.getAttribute('data-toggle');
      setField(code, !fields[code]);
      const toggleEl = el.querySelector('.toggle');
      if (toggleEl) toggleEl.classList.toggle('on', fields[code]);
    });
  });
}

function setField(code, value) {
  fields[code] = value;
  confidence[code] = 'user';

  // Re-render just the badge area (simplest: rerender all)
  // But only if the badge was visible before — to avoid flicker, we just remove the badge from the DOM
  const fieldEl = document.querySelector(`[data-field="${code}"]`);
  if (fieldEl) {
    const badge = fieldEl.querySelector('.conf-badge');
    if (badge) badge.remove();
  }

  // Persist
  if (code === 'scoutName' && value) {
    try { localStorage.setItem('scout_name', value); } catch(e) {}
  }
  if (code === 'eventKey' && value) {
    try { localStorage.setItem('event_key', value); } catch(e) {}
  }

  updateGenerateButton();
  saveDraft();
  if (code === 'matchNumber' || code === 'alliance' || code === 'driverStation' || code === 'matchType' || code === 'eventKey') {
    maybeAutoFillTeam();
  }
}

// =====================================================================
// VALIDATION
// =====================================================================

function getMissingRequired() {
  const missing = [];
  ALL_FIELDS.forEach(f => {
    if (!f.required) return;
    const v = fields[f.code];
    if (f.type === 'text') {
      if (!v || String(v).trim() === '') missing.push(f.title);
    } else if (f.type === 'number') {
      if (v === null || v === undefined || v === '' || isNaN(parseInt(v))) missing.push(f.title);
    }
  });
  return missing;
}

function updateGenerateButton() {
  const btn = $('btn-generate');
  if (!btn) return;
  const missing = getMissingRequired();
  btn.disabled = missing.length > 0;
  const help = btn.parentElement && btn.parentElement.querySelector('.help-text');
  if (help) {
    if (missing.length > 0) {
      help.textContent = 'Fill required fields to enable: ' + missing.join(', ');
      help.classList.add('help-text-warn');
    } else {
      help.textContent = 'Review the fields above before generating. You can edit any field.';
      help.classList.remove('help-text-warn');
    }
  }
}

// =====================================================================
// VOICE
//
// Two things break voice scouting in a real venue, and neither throws:
//   1. Every mobile browser ends recognition after a few seconds of silence,
//      whatever `continuous` says. A scouter who pauses to watch the field
//      comes back to a mic that quietly switched itself off.
//   2. The headset is muted at the cable, or the OS is still listening to the
//      laptop's built-in mic. Nothing appears, and there is no clue why.
// So: restart automatically while the scouter still wants to record, name the
// microphone actually in use, and speak up when nothing is being heard.
// =====================================================================

let wantRecording = false;      // what the scouter asked for, vs. what the engine is doing
let micRestarts = 0;            // consecutive restarts, to catch a restart loop
let lastResultAt = 0;
let silenceTimer = null;
let micDeviceLabel = '';        // e.g. "Logitech USB Headset H390"
let micProbed = false;

const HEADSET_HINT = /headset|headphone|h390|h340|h650|usb audio|wireless|airpods|buds|bluetooth/i;

/* Whenever the transcript box is emptied or replaced we must resync the
   recogniser's buffer. Otherwise the next spoken word re-appends everything
   that was just cleared — which, on SAVE & NEXT, drags the previous match's
   notes into the new one. */
function resetTranscriptBuffer() {
  baseTranscript = $('transcript') ? $('transcript').value : '';
  if (baseTranscript.length > 0 && !baseTranscript.endsWith(' ')) baseTranscript += ' ';
}

function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $('mic-button').disabled = true;
    showMicError('Voice input is not supported in this browser. On an iPhone use Safari; on a computer use Chrome, Edge or Safari. You can always type into the box instead.');
    return;
  }
  $('mic-button').addEventListener('click', () => {
    if (wantRecording) stopRecording();
    else startRecording();
  });
}

/* Ask the browser which input it is actually going to use. The Web Speech API
   gives no way to pick a device — it follows the system default — so the most
   useful thing we can do is tell the scouter which one that is. */
async function probeMicDevice() {
  if (micProbed) return micDeviceLabel;
  micProbed = true;
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return '';
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const track = stream.getAudioTracks()[0];
    micDeviceLabel = (track && track.label) ? track.label : '';
    stream.getTracks().forEach((t) => t.stop());   // release it before recognition opens its own
  } catch (e) {
    micDeviceLabel = '';
  }
  return micDeviceLabel;
}

/* If a headset is plugged in but the system default is something else, the
   scouter will be recording crowd noise without knowing it. */
async function headsetNotSelectedWarning() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return '';
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === 'audioinput' && d.label);
    if (inputs.length < 2 || !micDeviceLabel) return '';
    const usingHeadset = HEADSET_HINT.test(micDeviceLabel);
    const headsetAvailable = inputs.some((d) => HEADSET_HINT.test(d.label));
    if (headsetAvailable && !usingHeadset) {
      return 'A headset is plugged in, but this device is still listening through “' +
        micDeviceLabel + '”. Set the headset as your default microphone in your system sound settings, then reload.';
    }
  } catch (e) {}
  return '';
}

function startRecording() {
  hideMicError();
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;

  wantRecording = true;
  micRestarts = 0;
  lastResultAt = Date.now();

  baseTranscript = $('transcript').value;
  if (baseTranscript.length > 0 && !baseTranscript.endsWith(' ')) baseTranscript += ' ';

  beginRecognition();
  try {
    recognition.start();
  } catch (e) {
    wantRecording = false;
    showMicError('Could not start the microphone. Close any other app using it (Zoom, Meet, a recorder), then try again — or type into the box.');
    finishRecording();
    return;
  }
  setRecordingState(true);
  showMicStatus('Listening…', 'live');

  // Naming the device is best-effort and must never delay or block recording.
  // It opens a second, short-lived audio stream, so give recognition a moment
  // to take the microphone first — then we only look, and let go immediately.
  setTimeout(() => { if (wantRecording) probeMicDevice().then(afterMicProbe); }, 700);
  startSilenceWatch();
}

async function afterMicProbe() {
  if (!wantRecording) return;
  if (micDeviceLabel) showMicStatus('Listening through ' + micDeviceLabel, 'live');
  const warn = await headsetNotSelectedWarning();
  if (warn && wantRecording) showMicStatus(warn, 'warn');
}

function beginRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    lastResultAt = Date.now();
    micRestarts = 0;
    let interim = '';
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) final += res[0].transcript + ' ';
      else interim += res[0].transcript;
    }
    if (final) baseTranscript += final;
    $('transcript').value = baseTranscript + interim;
    if (wantRecording) {
      showMicStatus(micDeviceLabel ? 'Hearing you · ' + micDeviceLabel : 'Hearing you…', 'live');
    }
    updateProcessButton();
  };

  recognition.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      wantRecording = false;
      showMicError('The browser blocked the microphone. Tap the lock icon next to the web address, allow the microphone, then reload. Full per-device steps are under HELP. You can type into the box instead.');
      finishRecording();
    } else if (e.error === 'no-speech' || e.error === 'aborted') {
      // Normal on a pause — onend restarts us.
    } else if (e.error === 'audio-capture') {
      wantRecording = false;
      showMicError('No microphone was found. Check that your headset is plugged in, then reload. You can type into the box instead.');
      finishRecording();
    } else if (e.error === 'network') {
      wantRecording = false;
      showMicError('Speech recognition needs a connection and this device is offline. Type the match in instead — everything else works offline, and your matches still queue and send later.');
      finishRecording();
    } else {
      showMicStatus('Voice hiccup (' + e.error + '). Still listening.', 'warn');
    }
  };

  // Mobile browsers end the session on their own after a pause. Restart it so
  // the scouter can keep talking through the whole match.
  recognition.onend = () => {
    if (!wantRecording) { finishRecording(); return; }
    micRestarts++;
    if (micRestarts > 12) {
      wantRecording = false;
      showMicError('Voice kept dropping out on this device. Type the match in instead — it works exactly the same.');
      finishRecording();
      return;
    }
    try {
      beginRecognition();
      recognition.start();
    } catch (e) {
      // Chrome throws if start() lands too close to the previous stop; try once more.
      setTimeout(() => {
        if (!wantRecording) return;
        try { beginRecognition(); recognition.start(); }
        catch (err) { wantRecording = false; showMicError('Could not keep the microphone open. Type into the box instead.'); finishRecording(); }
      }, 350);
    }
  };
}

function startSilenceWatch() {
  stopSilenceWatch();
  silenceTimer = setInterval(async () => {
    if (!wantRecording) { stopSilenceWatch(); return; }
    const quiet = Date.now() - lastResultAt;
    if (quiet > 9000 && !$('transcript').value.trim()) {
      const extra = /h390|logitech/i.test(micDeviceLabel)
        ? ' The H390 has a mute switch on the cable — check it is not muted.'
        : ' If your headset has a mute switch or button, check it.';
      showMicStatus('Not hearing anything yet.' + extra, 'warn');
    }
  }, 3000);
}
function stopSilenceWatch() {
  if (silenceTimer) { clearInterval(silenceTimer); silenceTimer = null; }
}

function stopRecording() {
  wantRecording = false;
  if (recognition) { try { recognition.stop(); } catch (e) {} }
  finishRecording();
}

function finishRecording() {
  stopSilenceWatch();
  setRecordingState(false);
  hideMicStatus();
}

function setRecordingState(rec) {
  isRecording = rec;
  const btn = $('mic-button');
  if (rec) {
    btn.classList.add('recording');
    btn.setAttribute('aria-label', 'Stop recording');
  } else {
    btn.classList.remove('recording');
    btn.setAttribute('aria-label', 'Start recording');
  }
}

function showMicStatus(msg, kind) {
  const el = $('mic-status');
  if (!el) return;
  $('mic-status-text').textContent = msg;
  el.className = 'mic-status ' + (kind === 'warn' ? 'mic-status-warn' : 'mic-status-live');
  el.classList.remove('hidden');
}
function hideMicStatus() {
  const el = $('mic-status');
  if (el) el.classList.add('hidden');
}

function showMicError(msg) {
  $('mic-error-text').textContent = msg;
  $('mic-error').classList.remove('hidden');
}

function hideMicError() {
  $('mic-error').classList.add('hidden');
}

// =====================================================================
// PROCESS / GENERATE / OUTPUT
// =====================================================================

function processTranscript() {
  const text = $('transcript').value.trim();
  if (!text) return;
  const result = parseTranscript(text, fields);
  fields = result.fields;
  confidence = result.confidence;
  maybeAutoFillTeam();
  renderAllFields();
  updateGenerateButton();
  saveDraft();
}

function generateOutput() {
  const missing = getMissingRequired();
  if (missing.length > 0) {
    alert('Please fill required fields first:\n• ' + missing.join('\n• '));
    return;
  }
  if (!confirmUnusual()) return;
  $('generate-row').classList.add('hidden');
  $('output-section').classList.remove('hidden');
  showTab(activeTab);
}

function showTab(tab) {
  activeTab = tab;
  $$('.tab').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tab));
  $$('.tab-content').forEach(el => el.classList.add('hidden'));
  $('tab-' + tab).classList.remove('hidden');

  const tsv = generateTSV(fields);
  if (tab === 'qr') {
    renderQR(tsv);
  } else if (tab === 'tsv') {
    $('tsv-output').textContent = tsv;
  } else if (tab === 'json') {
    $('json-output').textContent = JSON.stringify(fields, null, 2);
  }
}

let lastQRCanvas = null;

function renderQR(text) {
  const container = $('qrcode');
  container.innerHTML = '';
  lastQRCanvas = null;
  const dlBtn = $('btn-download-qr');
  if (typeof qrcode !== 'function') {
    container.innerHTML = '<p style="padding:20px;color:var(--gray);font-size:13px;">QR library not loaded. The TSV/JSON tabs and Submit to Sheet still work.</p>';
    if (dlBtn) dlBtn.disabled = true;
    return;
  }
  let qr;
  try {
    qr = qrcode(0, 'M');        // type 0 = auto-size to fit the data
    qr.addData(text);
    qr.make();
  } catch (e) {
    container.innerHTML = '<p style="padding:20px;color:var(--error);font-size:13px;">This match is too long for a single QR — use the TSV/JSON tab or Submit to Sheet.</p>';
    if (dlBtn) dlBtn.disabled = true;
    return;
  }
  const count = qr.getModuleCount();
  const quiet = 4;             // 4-module quiet zone (QR spec) for reliable scanning
  const target = 320;
  const cell = Math.max(2, Math.floor(target / (count + quiet * 2)));
  const dim = cell * (count + quiet * 2);
  const canvas = document.createElement('canvas');
  canvas.width = dim;
  canvas.height = dim;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, dim, dim);
  ctx.fillStyle = '#1F1F1F';
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
    }
  }
  canvas.style.cssText = 'width:100%;max-width:280px;height:auto;image-rendering:pixelated;';
  container.appendChild(canvas);
  lastQRCanvas = canvas;
  if (dlBtn) dlBtn.disabled = false;
}

function downloadQR() {
  if (!lastQRCanvas) return;
  const a = document.createElement('a');
  a.download = 'qr_match' + (fields.matchNumber || '') + '_team' + (fields.teamNumber || '') + '.png';
  a.href = lastQRCanvas.toDataURL('image/png');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.innerHTML;
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> COPIED';
    setTimeout(() => { btn.innerHTML = orig; }, 2000);
  }).catch(() => {
    alert('Could not copy. Select the text manually.');
  });
}

// =====================================================================
// SESSION (saved matches across the day)
// =====================================================================

function saveMatchAndNext() {
  if (!confirmUnusual()) return;
  if (isDuplicateInSession(fields)) {
    if (!confirm('You already saved Match ' + fields.matchNumber + ' for team ' + fields.teamNumber + ' this session.\n\nSave it again anyway?')) return;
  }
  const snap = Object.assign({}, fields, { _ts: Date.now(), _id: currentMatchId });
  sessionMatches.push(snap);
  try {
    localStorage.setItem('session_matches', JSON.stringify(sessionMatches));
  } catch(e) { console.warn('Storage save failed', e); }
  updateSessionBar();
  // If a Sheet is connected, also push this match online (queues if offline).
  if (isSheetConnected()) {
    submitMatch(snap).then(res => {
      if (res.status === 'rejected') {
        alert('Saved on this device, but the Sheet rejected it:\n' + res.error + '\n\nOpen ⚙ SHEET to check the passcode/settings.');
      }
      updateSheetStatus();
    });
  }
  resetMatch();
}

function resetMatch() {
  const fresh = initialFieldState();
  fresh.scoutName = fields.scoutName;
  fresh.eventKey = fields.eventKey;
  fresh.matchNumber = (parseInt(fields.matchNumber) || 0) + 1;
  fresh.teamNumber = fields.teamNumber;
  fresh.matchType = fields.matchType;
  fields = fresh;
  confidence = {};
  currentMatchId = newMatchId();
  $('transcript').value = '';
  resetTranscriptBuffer();
  $('output-section').classList.add('hidden');
  $('generate-row').classList.remove('hidden');
  const ss = $('submit-status'); if (ss) ss.classList.add('hidden');
  renderAllFields();
  updateProcessButton();
  updateGenerateButton();
  saveDraft();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearAll() {
  if (!confirm('Clear EVERYTHING — all fields, transcript, and saved scout name/event? This cannot be undone.')) return;
  fields = initialFieldState();
  confidence = {};
  currentMatchId = newMatchId();
  $('transcript').value = '';
  resetTranscriptBuffer();
  $('output-section').classList.add('hidden');
  $('generate-row').classList.remove('hidden');
  hideMicError();
  try {
    localStorage.removeItem('scout_name');
    localStorage.removeItem('event_key');
    localStorage.removeItem('bobcat_draft');
  } catch(e) {}
  renderAllFields();
  updateProcessButton();
  updateGenerateButton();
}

function clearSession() {
  if (!confirm('Clear all saved matches from this session?')) return;
  sessionMatches = [];
  try { localStorage.removeItem('session_matches'); } catch(e) {}
  updateSessionBar();
}

function exportSession() {
  if (sessionMatches.length === 0) return;
  const header = FIELD_ORDER.join('\t');
  const rows = sessionMatches.map(m => generateTSV(m));
  const tsv = [header].concat(rows).join('\n');
  const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bobcat_scout_${new Date().toISOString().slice(0,10)}.tsv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function updateSessionBar() {
  const n = sessionMatches.length;
  if (n > 0) {
    $('btn-session').classList.remove('hidden');
    $('session-count').textContent = n;
  } else {
    $('btn-session').classList.add('hidden');
    $('session-card').classList.add('hidden');
  }
  // refresh list contents if visible
  const list = $('session-list');
  list.innerHTML = sessionMatches.map(m => `
    <div class="row"><strong>Match ${escapeHTML(m.matchNumber)}</strong> · Team ${escapeHTML(m.teamNumber)} · ${escapeHTML(m.alliance)} ${escapeHTML(m.driverStation)} · Climb: ${escapeHTML(m.endgameClimb)} · Hub made: ${(parseInt(m.autoHubMade)||0) + (parseInt(m.teleopHubMade)||0)}</div>
  `).join('');
  const sb = $('summary-box');
  if (sb && !sb.classList.contains('hidden')) renderSummary();
}

function toggleSessionCard() {
  const card = $('session-card');
  const arrow = $('session-arrow');
  if (card.classList.contains('hidden')) {
    card.classList.remove('hidden');
    arrow.textContent = '▲';
  } else {
    card.classList.add('hidden');
    arrow.textContent = '▼';
  }
}

// =====================================================================
// INTERACTIVE WALKTHROUGH (guided tour built from the real page)
// =====================================================================

const TOUR_STEPS = [
  {
    selector: '#btn-setup',
    title: '1 · Set yourself up first',
    body: 'Tap ⚡ SETUP any time you are stuck. It asks whether you are a scouter or the host and then walks you down a numbered checklist — your name, the event code, a mic test, and for hosts, the whole spreadsheet setup with the script copied for you.'
  },
  {
    selector: '.voice-row',
    title: '2 · Describe the match',
    body: 'Tap the maroon mic and just talk — or type — in plain English. Example: "Team 177, scored 4 in auto, climbed the mid rung." No special wording needed.'
  },
  {
    selector: '#btn-process',
    title: '3 · Auto-fill the fields',
    body: 'Tap AUTO-FILL FIELDS. The app reads your description and fills in the scouting form for you automatically.'
  },
  {
    selector: '#fields-container',
    title: '4 · Review & fix',
    body: 'Check the filled values. A green "AI" badge means it was auto-filled — tap any field to correct it. Fields marked with a red * are required.'
  },
  {
    selector: '#btn-generate',
    title: '5 · Generate output',
    body: 'Once the required fields are set, tap GENERATE to get a scannable QR code (works with no internet) plus TSV and JSON for your QRScout pipeline.'
  },
  {
    selector: '#btn-sheet',
    title: '6 · Send to the Sheet (optional)',
    body: 'If your host connected a Google Sheet — tap ⚙ SHEET, or just open the link they shared — each match auto-submits here, no scanning. Offline, it queues and sends later. The dot shows the status.'
  },
  {
    selector: '#btn-help',
    title: '7 · Save & keep going',
    body: 'Use SAVE & NEXT MATCH — it saves, submits to the Sheet if connected, and bumps the match number automatically. Scout as many matches as you want — there is no limit. Reopen this walkthrough anytime from HELP.'
  }
];

let tourIndex = 0;
let tourAutoplay = false;
let tourTimer = null;
const TOUR_AUTOPLAY_MS = 4500;

function startTour() {
  $('help-overlay').classList.add('hidden');
  document.body.classList.remove('no-scroll'); // tour needs to scroll the page
  tourIndex = 0;
  tourAutoplay = false;
  $('tour').classList.remove('hidden');
  setTourAutoplayUI();
  showTourStep(0);
  window.addEventListener('resize', repositionTour);
  window.addEventListener('scroll', repositionTour, { passive: true });
  document.addEventListener('keydown', tourKeyHandler);
}

function endTour() {
  stopTourTimer();
  tourAutoplay = false;
  $('tour').classList.add('hidden');
  window.removeEventListener('resize', repositionTour);
  window.removeEventListener('scroll', repositionTour);
  document.removeEventListener('keydown', tourKeyHandler);
}

function showTourStep(i) {
  tourIndex = Math.max(0, Math.min(i, TOUR_STEPS.length - 1));
  const step = TOUR_STEPS[tourIndex];

  $('tour-step-count').textContent = `Step ${tourIndex + 1} of ${TOUR_STEPS.length}`;
  $('tour-title').textContent = step.title;
  $('tour-body').textContent = step.body;
  $('tour-progress-bar').style.width = ((tourIndex + 1) / TOUR_STEPS.length * 100) + '%';
  $('tour-back').disabled = tourIndex === 0;
  $('tour-next').textContent = tourIndex === TOUR_STEPS.length - 1 ? 'FINISH' : 'NEXT';

  const target = document.querySelector(step.selector);
  if (target) {
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    requestAnimationFrame(() => placeTour(target));
  }
}

function placeTour(target) {
  const margin = 8;
  const r = target.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;

  // Clamp the highlighted box to the viewport so it's always visible.
  const top = Math.max(r.top - 6, margin);
  const left = Math.max(r.left - 6, margin);
  const right = Math.min(r.right + 6, vw - margin);
  const bottom = Math.min(r.bottom + 6, vh - margin);
  const w = Math.max(right - left, 0);
  const h = Math.max(bottom - top, 0);

  const sp = $('tour-spotlight');
  sp.style.top = top + 'px';
  sp.style.left = left + 'px';
  sp.style.width = w + 'px';
  sp.style.height = h + 'px';

  // Position the card below the spotlight if there's room, else above, else pinned.
  const card = $('tour-card');
  const cardH = card.offsetHeight || 200;
  const cardW = card.offsetWidth || 360;
  let cardTop;
  if (vh - bottom > cardH + 16) cardTop = bottom + 12;
  else if (top > cardH + 16) cardTop = top - cardH - 12;
  else cardTop = vh - cardH - margin;

  let cardLeft = (left + w / 2) - cardW / 2;
  cardLeft = Math.max(margin, Math.min(cardLeft, vw - cardW - margin));
  cardTop = Math.max(margin, Math.min(cardTop, vh - cardH - margin));
  card.style.top = cardTop + 'px';
  card.style.left = cardLeft + 'px';
}

function repositionTour() {
  if ($('tour').classList.contains('hidden')) return;
  const target = document.querySelector(TOUR_STEPS[tourIndex].selector);
  if (target) placeTour(target);
}

function nextTourStep() {
  if (tourIndex >= TOUR_STEPS.length - 1) { endTour(); return; }
  showTourStep(tourIndex + 1);
}

function prevTourStep() {
  if (tourIndex > 0) showTourStep(tourIndex - 1);
}

function setTourAutoplayUI() {
  const b = $('tour-autoplay');
  b.classList.toggle('tour-autoplay-on', tourAutoplay);
  b.setAttribute('aria-pressed', tourAutoplay ? 'true' : 'false');
  b.textContent = tourAutoplay ? '⏸ PAUSE' : '▶ AUTO-PLAY';
}

function toggleTourAutoplay() {
  tourAutoplay = !tourAutoplay;
  setTourAutoplayUI();
  if (tourAutoplay) scheduleTourAdvance();
  else stopTourTimer();
}

function scheduleTourAdvance() {
  stopTourTimer();
  tourTimer = setTimeout(() => {
    if (!tourAutoplay) return;
    if (tourIndex >= TOUR_STEPS.length - 1) { endTour(); return; }
    showTourStep(tourIndex + 1);
    scheduleTourAdvance();
  }, TOUR_AUTOPLAY_MS);
}

function stopTourTimer() {
  if (tourTimer) { clearTimeout(tourTimer); tourTimer = null; }
}

// Manual navigation pauses auto-play so the two never fight.
function pauseTourAutoplay() {
  if (tourAutoplay) { tourAutoplay = false; setTourAutoplayUI(); }
  stopTourTimer();
}

function tourKeyHandler(e) {
  if (e.key === 'Escape') endTour();
  else if (e.key === 'ArrowRight') { pauseTourAutoplay(); nextTourStep(); }
  else if (e.key === 'ArrowLeft') { pauseTourAutoplay(); prevTourStep(); }
}

// =====================================================================
// GOOGLE SHEET SUBMISSION (optional online pipeline + offline queue)
// QR always works offline; this adds one-tap auto-submit when there's signal.
// =====================================================================

let sheetEndpoint = '';      // Web App URL (from the team's Sheet)
let sheetPasscode = '';      // shared passcode that must match the Config tab
let pendingQueue = [];       // submissions saved while offline / on failure
let currentMatchId = null;   // stable id for the match being scouted (idempotent re-sends)

const SUBMIT_REQUIRED = ['scoutName', 'eventKey', 'matchNumber', 'teamNumber'];
const SUBMIT_RANGES = {
  matchNumber: [1, 200], teamNumber: [1, 99999], preloadedFuel: [0, 50],
  autoHubMade: [0, 500], teleopHubMade: [0, 500], climbSeconds: [0, 160],
  pickupEffectiveness: [1, 5], passingEffectiveness: [1, 5],
  driverSkill: [1, 5], defenseRating: [1, 5]
};

function newMatchId() {
  return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function isSheetConnected() { return !!sheetEndpoint; }

function loadSheetConfig() {
  try {
    sheetEndpoint = localStorage.getItem('sheet_endpoint') || '';
    sheetPasscode = localStorage.getItem('sheet_passcode') || '';
    pendingQueue = JSON.parse(localStorage.getItem('pending_submissions') || '[]');
  } catch (e) { pendingQueue = []; }
}

// A lead can share a link like  ...?sheet=<webAppUrl>&key=<passcode>  to auto-connect a scout's phone.
function applyUrlConfig() {
  const p = new URLSearchParams(location.search);
  const url = p.get('sheet'), key = p.get('key'), tba = p.get('tba'), gid = p.get('gid');
  let changed = false;
  if (url) { try { localStorage.setItem('sheet_endpoint', url); } catch (e) {} changed = true; }
  if (key) { try { localStorage.setItem('sheet_passcode', key); } catch (e) {} changed = true; }
  if (tba) { try { localStorage.setItem('tba_key', tba); } catch (e) {} changed = true; }
  if (gid) { try { localStorage.setItem('google_client_id', gid); } catch (e) {} changed = true; }
  if (changed) history.replaceState(null, '', location.pathname); // don't leave the passcode in the address bar
}

function savePendingQueue() {
  try { localStorage.setItem('pending_submissions', JSON.stringify(pendingQueue)); } catch (e) {}
}

// Same checks the server runs — gives instant feedback and avoids pointless sends.
function validateForSubmit(d) {
  for (const k of SUBMIT_REQUIRED) {
    if (d[k] === undefined || d[k] === null || String(d[k]).trim() === '') {
      return { ok: false, error: 'Missing required field: ' + k };
    }
  }
  for (const k in SUBMIT_RANGES) {
    const v = d[k];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (isNaN(n) || n < SUBMIT_RANGES[k][0] || n > SUBMIT_RANGES[k][1]) {
      return { ok: false, error: 'Out of range: ' + k + ' = ' + v };
    }
  }
  return { ok: true };
}

// Game-agnostic "fat-finger" guard: flag number/range values that fall outside the
// field's configured min/max (set per game in the Form Builder), or are implausibly
// high when no max is set. Soft check — it asks the scouter to confirm, never silently
// drops data. Catches the classic "50 scored in a 30-second period" mis-tap for ANY game.
function getSanityWarnings() {
  const warn = [];
  activeSections().forEach(s => (s.fields || []).forEach(f => {
    if (f.type !== 'number' && f.type !== 'range') return;
    const raw = fields[f.code];
    if (raw === undefined || raw === null || raw === '') return;
    const n = Number(raw);
    if (isNaN(n)) { warn.push(f.title + ' = "' + raw + '" — not a number'); return; }
    const min = (f.min != null) ? Number(f.min) : null;
    const max = (f.max != null) ? Number(f.max) : null;
    if (min != null && n < min) warn.push(f.title + ' = ' + n + ' (below the ' + min + ' minimum)');
    else if (max != null && n > max) warn.push(f.title + ' = ' + n + ' (above the ' + max + ' max)');
    else if (max == null && n > 200) warn.push(f.title + ' = ' + n + ' (unusually high — sure?)');
  }));
  return warn;
}
function confirmUnusual() {
  const w = getSanityWarnings();
  if (!w.length) return true;
  return confirm('⚠ Some entries look unusual — please double-check before saving:\n\n• ' + w.join('\n• ') + '\n\nKeep these values and continue?');
}

function buildPayload(data) {
  const clean = Object.assign({}, data);
  delete clean._ts;
  const extra = {
    passcode: sheetPasscode,
    _order: FIELD_ORDER.slice(),
    _id: data._id || currentMatchId || newMatchId()
  };
  if (googleTokenValid()) extra.idToken = googleIdToken;   // max-security mode
  if (currentForm === 'pit') extra._form = 'pit';          // route to the Pit sheet
  else extra._scoring = analyticsModel();                  // let the Sheet re-tune its Analytics tab to this game
  return Object.assign(clean, extra);
}

// Compact scoring model the Sheet uses to build a game-agnostic Analytics tab:
// which fields score (points / per-option points), which are rating sliders, which
// mark a breakdown. The Apps Script remembers the latest and rebuilds when it changes.
function analyticsModel() {
  const out = [];
  (CONFIG.sections || []).forEach(s => (s.fields || []).forEach(f => {
    const scoring = (f.points != null) || f.optionPoints;
    if (!scoring && !f.fail && f.type !== 'range') return;
    const m = { code: f.code, title: f.title, type: f.type };
    if (f.points != null) m.points = f.points;
    if (f.optionPoints) m.optionPoints = f.optionPoints;
    if (f.fail) m.fail = true;
    out.push(m);
  }));
  return out;
}

// JSONP call: works around the cross-origin limits of Apps Script web apps,
// and (unlike no-cors fetch) lets us actually READ the ok/error reply.
function jsonpSubmit(payload, timeoutMs, url) {
  return new Promise((resolve, reject) => {
    const target = url || sheetEndpoint;
    const cb = 'bscb_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    let done = false;
    const script = document.createElement('script');
    const timer = setTimeout(() => finish(() => reject(new Error('timeout'))), timeoutMs || 12000);
    function finish(fn) {
      if (done) return; done = true;
      clearTimeout(timer);
      delete window[cb];
      if (script.parentNode) script.parentNode.removeChild(script);
      fn();
    }
    window[cb] = (resp) => finish(() => resolve(resp));
    script.onerror = () => finish(() => reject(new Error('network')));
    script.src = target + '?callback=' + cb + '&data=' + encodeURIComponent(JSON.stringify(payload));
    document.body.appendChild(script);
  });
}

// Submit one match. Resolves { status: 'sent'|'queued'|'rejected'|'notconfigured' }.
async function submitMatch(data) {
  if (!isSheetConnected()) return { status: 'notconfigured' };
  const payload = buildPayload(data);
  if (!navigator.onLine) { enqueue(payload, sheetEndpoint); return { status: 'queued' }; }
  try {
    const resp = await jsonpSubmit(payload, undefined, sheetEndpoint);
    if (resp && resp.ok) return { status: 'sent', action: resp.action };
    return { status: 'rejected', error: (resp && resp.error) || 'rejected' }; // config issue, don't queue
  } catch (e) {
    enqueue(payload, sheetEndpoint); // network/timeout — keep it for auto-retry
    return { status: 'queued' };
  }
}

// Each queued item remembers its OWN destination sheet, so switching hosts never misroutes data.
function qid(item) { return (item && item.payload ? item.payload._id : (item ? item._id : undefined)); }

function enqueue(payload, url) {
  pendingQueue = pendingQueue.filter(p => qid(p) !== payload._id); // de-dupe by match id
  pendingQueue.push({ url: url || sheetEndpoint, payload: payload });
  savePendingQueue();
  updateSheetStatus();
}

async function flushQueue() {
  if (!navigator.onLine || pendingQueue.length === 0) return;
  for (const item of pendingQueue.slice()) {
    const payload = item.payload || item;          // tolerate older bare-payload items
    const url = item.url || sheetEndpoint;
    if (!url) continue;
    try {
      const resp = await jsonpSubmit(payload, undefined, url);
      // Drop on success OR on a server rejection (a config problem won't fix itself by retrying).
      // The local session copy is always kept, so nothing is lost.
      if (resp) { pendingQueue = pendingQueue.filter(p => qid(p) !== payload._id); savePendingQueue(); }
    } catch (e) {
      break; // still offline — stop, try again on the next 'online' event
    }
  }
  updateSheetStatus();
}

function updateSheetStatus() {
  const dot = $('sheet-dot'), label = $('sheet-label');
  if (!dot || !label) return;
  const n = pendingQueue.length;
  if (!isSheetConnected()) { dot.className = 'sheet-dot dot-off'; label.textContent = 'SHEET'; }
  else if (n > 0) { dot.className = 'sheet-dot dot-queued'; label.textContent = 'SHEET (' + n + ')'; }
  else { dot.className = 'sheet-dot dot-on'; label.textContent = 'SHEET'; }
  refreshSheetDialog();
}

// ---- Connect-to-Sheet dialog ----
function openSheetDialog() {
  $('sheet-url').value = sheetEndpoint;
  $('sheet-pass').value = sheetPasscode;
  try { $('tba-key').value = localStorage.getItem('tba_key') || ''; } catch (e) {}
  try { $('google-client-id').value = localStorage.getItem('google_client_id') || DEFAULT_GOOGLE_CLIENT_ID; } catch (e) {}
  $('sheet-msg').classList.add('hidden');
  if (scheduleCache && scheduleCache.count) showScheduleMsg('Schedule loaded: ' + scheduleCache.count + ' qual matches for ' + scheduleCache.event + '.', 'ok');
  else $('schedule-status').classList.add('hidden');
  initGoogleSignIn();
  updateGoogleStatus();
  $('sheet-overlay').classList.remove('hidden');
  document.body.classList.add('no-scroll');
  refreshSheetDialog();
}
function closeSheetDialog() {
  $('sheet-overlay').classList.add('hidden');
  document.body.classList.remove('no-scroll');
}
function refreshSheetDialog() {
  const note = $('sheet-queue-note');
  if (!note) return;
  const n = pendingQueue.length;
  if (n > 0) { note.textContent = n + ' submission(s) waiting to send — they go automatically when you’re back online.'; note.classList.remove('hidden'); }
  else note.classList.add('hidden');
  const retry = $('btn-sheet-retry');
  if (retry) retry.classList.toggle('hidden', n === 0);
}
function saveSheetConfig() {
  sheetEndpoint = $('sheet-url').value.trim();
  sheetPasscode = $('sheet-pass').value.trim();
  try {
    localStorage.setItem('sheet_endpoint', sheetEndpoint);
    localStorage.setItem('sheet_passcode', sheetPasscode);
  } catch (e) {}
  updateSheetStatus();
  showSheetMsg(sheetEndpoint ? 'Saved. Matches will now also go to your Sheet.' : 'Cleared.', 'ok');
  flushQueue();
}
function disconnectSheet() {
  sheetEndpoint = ''; sheetPasscode = '';
  try { localStorage.removeItem('sheet_endpoint'); localStorage.removeItem('sheet_passcode'); } catch (e) {}
  $('sheet-url').value = ''; $('sheet-pass').value = '';
  updateSheetStatus();
  showSheetMsg('Disconnected. The app is back to QR-only.', 'ok');
}
async function sendTestRow() {
  sheetEndpoint = $('sheet-url').value.trim();
  sheetPasscode = $('sheet-pass').value.trim();
  if (!sheetEndpoint) { showSheetMsg('Paste the Web App URL first.', 'err'); return; }
  showSheetMsg('Sending a test row…', 'ok');
  const test = { scoutName: 'CONNECTION TEST', eventKey: fields.eventKey || 'test', matchType: 'pm', matchNumber: 1, teamNumber: 177, _id: 'test-' + Date.now().toString(36) };
  try {
    const resp = await jsonpSubmit(buildPayload(test));
    if (resp && resp.ok) showSheetMsg('✓ Success! A "CONNECTION TEST" row was added to your Sheet — you can delete it. (' + resp.action + ')', 'ok');
    else showSheetMsg('Reached the Sheet, but it replied: ' + ((resp && resp.error) || 'rejected') + '. Check the passcode matches the Config tab.', 'err');
  } catch (e) {
    showSheetMsg('Could not reach the Sheet. Check the URL is the /exec link and the deployment is set to "Anyone".', 'err');
  }
}
function copyScoutLink() {
  const url = $('sheet-url').value.trim(), pass = $('sheet-pass').value.trim();
  if (!url) { showSheetMsg('Paste the Web App URL first.', 'err'); return; }
  let link = location.origin + location.pathname + '?sheet=' + encodeURIComponent(url) + '&key=' + encodeURIComponent(pass);
  const tk = $('tba-key').value.trim(); if (tk) link += '&tba=' + encodeURIComponent(tk);
  const gid = $('google-client-id').value.trim(); if (gid) link += '&gid=' + encodeURIComponent(gid);
  navigator.clipboard.writeText(link).then(
    () => showSheetMsg('Scout link copied! Send it to your scouts — opening it auto-connects their app (Sheet, schedule, and sign-in).', 'ok'),
    () => showSheetMsg('Copy failed. Here is the link:\n' + link, 'err')
  );
}
function showSheetMsg(msg, kind) {
  const el = $('sheet-msg');
  el.textContent = msg;
  el.className = 'sheet-msg ' + (kind === 'err' ? 'sheet-msg-err' : 'sheet-msg-ok');
  el.classList.remove('hidden');
}

// ---- Explicit "Submit to Sheet" button in the output step ----
async function submitCurrentMatch() {
  const v = validateForSubmit(fields);
  if (!v.ok) { showSubmitStatus(v.error, 'err'); return; }
  if (!confirmUnusual()) { showSubmitStatus('Submission paused — adjust the flagged values, or confirm to continue.', 'warn'); return; }
  if (!isSheetConnected()) { showSubmitStatus('No Sheet connected — scan the QR code, or tap ⚙ SHEET above to connect one.', 'warn'); return; }
  if (googleEnabled() && !googleTokenValid()) { showSubmitStatus('Sign in with Google first — open ⚙ SHEET and tap the Google button.', 'warn'); return; }
  showSubmitStatus('Sending to Sheet…', 'info');
  const res = await submitMatch(Object.assign({}, fields, { _id: currentMatchId }));
  if (res.status === 'sent') showSubmitStatus('✓ Saved to your Sheet (' + res.action + '). Tap SAVE & NEXT MATCH to scout your next one.', 'ok');
  else if (res.status === 'queued') showSubmitStatus('No connection right now — saved on this phone and queued. It sends automatically when you’re back online.', 'warn');
  else if (res.status === 'rejected') showSubmitStatus('The Sheet rejected it: ' + res.error, 'err');
  else showSubmitStatus('No Sheet connected.', 'warn');
}
function showSubmitStatus(msg, kind) {
  const el = $('submit-status');
  if (!el) return;
  const map = { ok: 'submit-ok', err: 'submit-err', warn: 'submit-warn', info: 'submit-info' };
  el.textContent = msg;
  el.className = 'submit-status ' + (map[kind] || 'submit-info');
  el.classList.remove('hidden');
}

// =====================================================================
// GOOGLE SIGN-IN (optional max-security mode — enabled when a Client ID is set)
// =====================================================================

// Shared, published OAuth Client ID for this app (NOT a secret — OAuth client IDs are public
// and this one only works from the app's own web origin). Any host can use it for Google
// sign-in by tapping "Save & Enable" and setting their own allow-list; it never forces login
// on passcode-only hosts. Hosts may also paste their own Client ID instead.
const DEFAULT_GOOGLE_CLIENT_ID = '404429673783-0mue3sktcon2ca4v7fgjmn8iu8bqitpe.apps.googleusercontent.com';

let googleClientId = '';
let googleIdToken = '';
let googleEmail = '';

function googleEnabled() { return !!googleClientId; }

function loadGoogleConfig() {
  try {
    googleClientId = localStorage.getItem('google_client_id') || '';
    googleIdToken = localStorage.getItem('google_token') || '';
    googleEmail = localStorage.getItem('google_email') || '';
  } catch (e) {}
}

function decodeJwt(t) {
  try { return JSON.parse(atob(String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); }
  catch (e) { return null; }
}

function googleTokenValid() {
  if (!googleIdToken) return false;
  const p = decodeJwt(googleIdToken);
  return !!(p && p.exp && (p.exp * 1000) > Date.now() + 10000);
}

function initGoogleSignIn() {
  if (!googleEnabled()) return;
  if (window.google && google.accounts && google.accounts.id) { setupGoogleButton(); return; }
  if (document.getElementById('gis-script')) return;
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true; s.defer = true; s.id = 'gis-script';
  s.onload = setupGoogleButton;
  document.head.appendChild(s);
}

function setupGoogleButton() {
  if (!googleEnabled() || !window.google || !google.accounts || !google.accounts.id) return;
  try {
    google.accounts.id.initialize({ client_id: googleClientId, callback: onGoogleCredential });
    const holder = $('google-btn');
    if (holder) { holder.innerHTML = ''; google.accounts.id.renderButton(holder, { theme: 'filled_blue', size: 'large', text: 'signin_with', width: 240 }); }
  } catch (e) {}
  updateGoogleStatus();
}

function onGoogleCredential(resp) {
  googleIdToken = (resp && resp.credential) || '';
  const p = decodeJwt(googleIdToken);
  googleEmail = (p && p.email) || '';
  try { localStorage.setItem('google_token', googleIdToken); localStorage.setItem('google_email', googleEmail); } catch (e) {}
  updateGoogleStatus();
  flushQueue();
}

function updateGoogleStatus() {
  const el = $('google-status');
  if (!el) return;
  if (!googleEnabled()) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  if (googleTokenValid()) { el.className = 'sheet-msg sheet-msg-ok'; el.innerHTML = 'Signed in as <strong>' + escapeHTML(googleEmail) + '</strong>'; }
  else { el.className = 'sheet-msg'; el.textContent = 'Sign in with your team Google account to submit.'; }
}

function saveGoogleConfig() {
  googleClientId = $('google-client-id').value.trim();
  try { localStorage.setItem('google_client_id', googleClientId); } catch (e) {}
  if (googleEnabled()) { showSheetMsg('Google sign-in enabled. Scouters tap the Google button to sign in.', 'ok'); initGoogleSignIn(); }
  else { showSheetMsg('Google sign-in disabled (Client ID cleared).', 'ok'); }
  updateGoogleStatus();
}

function googleSignOut() {
  googleIdToken = ''; googleEmail = '';
  try {
    localStorage.removeItem('google_token'); localStorage.removeItem('google_email');
    if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect();
  } catch (e) {}
  updateGoogleStatus();
}

// =====================================================================
// CONFIG LOADING — built-in game (config.json) OR a custom one saved on this device
// =====================================================================

let defaultConfig = null;

async function fetchDefaultConfig() {
  if (defaultConfig) return defaultConfig;
  const resp = await fetch('config.json');
  if (!resp.ok) throw new Error('Failed to load config.json');
  defaultConfig = await resp.json();
  return defaultConfig;
}

async function loadConfig() {
  const def = await fetchDefaultConfig();
  try {
    const custom = localStorage.getItem('custom_config');
    if (custom) {
      const c = JSON.parse(custom);
      if (c && Array.isArray(c.sections)) return c;
    }
  } catch (e) {}
  return def;
}

// Hand the live config (with its scoring point-values) to the Analytics engine
// so OPR / predictions / pick-list re-derive points for whatever game is loaded.
function syncAnalyticsConfig() {
  try { if (window.ANALYTICS && ANALYTICS.setConfig) ANALYTICS.setConfig(CONFIG); } catch (e) {}
}

// =====================================================================
// FORM BUILDER — define this year's game fields with no code; the boxes rebuild live
// =====================================================================

let builderConfig = null;
let builderForm = 'match';
let draftFromImport = false;   // true right after an AI/JSON import → show the "review point values" banner

// Identity columns are never scored — don't clutter them with a "pts" box.
const NONSCORING_CODES = ['scoutName', 'eventKey', 'matchNumber', 'matchType', 'teamNumber', 'alliance', 'driverStation'];

const FIELD_TYPES = [['text', 'Text'], ['number', 'Number'], ['boolean', 'Yes/No toggle'], ['select', 'Dropdown'], ['range', 'Rating slider']];

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

function slug(title, existing) {
  let base = String(title || 'field').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .map((w, i) => i === 0 ? w : (w ? w.charAt(0).toUpperCase() + w.slice(1) : '')).join('');
  if (!base) base = 'field';
  if (!/^[a-z]/.test(base)) base = 'f' + base;
  let code = base, n = 2;
  while (existing && existing.indexOf(code) !== -1) { code = base + n; n++; }
  return code;
}

function builderSections() {
  const key = builderForm === 'pit' ? 'pitSections' : 'sections';
  if (!Array.isArray(builderConfig[key])) builderConfig[key] = [];
  return builderConfig[key];
}

function normalizeField(f) {
  if (f.type === 'select') {
    if (!Array.isArray(f.options) || !f.options.length) f.options = [{ k: 'option1', v: 'Option 1' }];
    if (f.default == null) f.default = f.options[0].k;
  } else if (f.type === 'range') {
    if (f.min == null) f.min = 1; if (f.max == null) f.max = 5;
    f.default = f.default != null ? f.default : Math.round((Number(f.min) + Number(f.max)) / 2);
  } else if (f.type === 'number') {
    if (f.default == null) f.default = 0;
  } else if (f.type === 'boolean') {
    f.default = !!f.default;
  } else {
    f.default = f.default != null ? f.default : '';
  }
}

function openBuilder() {
  builderConfig = deepClone(CONFIG);
  if (!Array.isArray(builderConfig.sections)) builderConfig.sections = [];
  if (!Array.isArray(builderConfig.pitSections)) builderConfig.pitSections = [];
  builderForm = 'match';
  draftFromImport = false;
  $('builder-msg').classList.add('hidden');
  if ($('manual-status')) $('manual-status').classList.add('hidden');
  if ($('builder-paste')) $('builder-paste').value = '';
  renderBuilder();
  $('builder-overlay').classList.remove('hidden');
  document.body.classList.add('no-scroll');
}
function closeBuilder() {
  $('builder-overlay').classList.add('hidden');
  document.body.classList.remove('no-scroll');
}

// Per-field scoring inputs (match form only) — these write the point values the
// Analytics engine reads, so a new game's math works without touching code.
function scoringControls(f, i, j) {
  if (f.code && NONSCORING_CODES.indexOf(f.code) !== -1) return '';   // identity fields aren't scored
  const d = 'data-sec="' + i + '" data-fld="' + j + '"';
  if (f.type === 'number') {   // ranges are subjective 1-5 ratings, not point-scored → no pts box
    return '<span class="b-pts" title="Points each one is worth (e.g. 1 per ball)">pts ea <input type="number" step="any" class="b-mm" ' + d + ' data-prop="points" value="' + (f.points != null ? f.points : '') + '" placeholder="—"></span>';
  }
  if (f.type === 'boolean') {
    return '<span class="b-pts" title="Points if YES (leave blank if not scored)">pts if yes <input type="number" step="any" class="b-mm" ' + d + ' data-prop="points" value="' + (f.points != null ? f.points : '') + '" placeholder="—"></span>'
      + '<label class="b-req" title="Tick if YES means the robot broke down / no-showed / tipped — used for the reliability score"><input type="checkbox" ' + d + ' data-prop="fail"' + (f.fail ? ' checked' : '') + '> breakdown</label>';
  }
  if (f.type === 'select') {
    const opts = f.options || [];
    if (!opts.length) return '';
    const op = f.optionPoints || {};
    return '<div class="b-optpts" title="Points for each choice (e.g. L3 climb = 30)">' + opts.map(o =>
      '<span class="b-optpt"><span class="b-optpt-k">' + escapeHTML(o.v) + '</span><input type="number" step="any" class="b-mm" ' + d + ' data-prop="optpts" data-optk="' + escapeHTML(o.k) + '" value="' + (op[o.k] != null ? op[o.k] : '') + '" placeholder="0"></span>'
    ).join('') + '</div>';
  }
  return '';
}

function renderBuilder() {
  $('bf-match').classList.toggle('b-mode-active', builderForm === 'match');
  $('bf-pit').classList.toggle('b-mode-active', builderForm === 'pit');
  const secs = builderSections();
  let h = '';
  if (draftFromImport && builderForm === 'match') {
    h += '<div class="b-review-banner">⚠ <strong>Review before you save.</strong> This form was drafted from your manual — read every <span class="b-review-pts">pts</span> value below and fix any the AI misread, then tap APPLY &amp; SAVE. The scoring drives the whole ANALYZE engine.</div>';
  }
  secs.forEach((sec, i) => {
    h += '<div class="b-section">';
    h += '<div class="b-sec-head">'
      + '<input class="b-sec-name" data-sec="' + i + '" data-prop="name" value="' + escapeHTML(sec.name || '') + '" placeholder="Section name (e.g. Auto)">'
      + '<button class="b-icon" data-action="sec-up" data-sec="' + i + '" title="Move up">↑</button>'
      + '<button class="b-icon" data-action="sec-down" data-sec="' + i + '" title="Move down">↓</button>'
      + '<button class="b-icon b-del" data-action="del-section" data-sec="' + i + '" title="Delete section">✕</button>'
      + '</div>';
    (sec.fields || []).forEach((f, j) => {
      h += '<div class="b-field">';
      h += '<input class="b-title" data-sec="' + i + '" data-fld="' + j + '" data-prop="title" value="' + escapeHTML(f.title || '') + '" placeholder="Field label (e.g. Goals Scored)">';
      h += '<select class="b-type" data-sec="' + i + '" data-fld="' + j + '" data-prop="type">'
        + FIELD_TYPES.map(t => '<option value="' + t[0] + '"' + (f.type === t[0] ? ' selected' : '') + '>' + t[1] + '</option>').join('')
        + '</select>';
      if (f.type === 'select') {
        const opts = (f.options || []).map(o => o.v).join('\n');
        h += '<textarea class="b-opts" data-sec="' + i + '" data-fld="' + j + '" data-prop="options" placeholder="One choice per line">' + escapeHTML(opts) + '</textarea>';
      } else if (f.type === 'number' || f.type === 'range') {
        h += '<span class="b-minmax">min <input type="number" class="b-mm" data-sec="' + i + '" data-fld="' + j + '" data-prop="min" value="' + (f.min != null ? f.min : '') + '"> '
          + 'max <input type="number" class="b-mm" data-sec="' + i + '" data-fld="' + j + '" data-prop="max" value="' + (f.max != null ? f.max : '') + '"></span>';
      }
      if (builderForm === 'match') h += scoringControls(f, i, j);
      h += '<label class="b-req"><input type="checkbox" data-sec="' + i + '" data-fld="' + j + '" data-prop="required"' + (f.required ? ' checked' : '') + '> required</label>';
      h += '<button class="b-icon" data-action="fld-up" data-sec="' + i + '" data-fld="' + j + '" title="Move up">↑</button>';
      h += '<button class="b-icon" data-action="fld-down" data-sec="' + i + '" data-fld="' + j + '" title="Move down">↓</button>';
      h += '<button class="b-icon b-del" data-action="del-field" data-sec="' + i + '" data-fld="' + j + '" title="Delete field">✕</button>';
      h += '</div>';
    });
    h += '<button class="btn btn-ghost b-add" data-action="add-field" data-sec="' + i + '">+ Add field</button>';
    h += '</div>';
  });
  h += '<button class="btn btn-outline b-add-sec" data-action="add-section">+ Add section</button>';
  $('builder-body').innerHTML = h;
}

function onBuilderEdit(e) {
  const el = e.target, prop = el.getAttribute('data-prop');
  if (!prop) return;
  const si = el.getAttribute('data-sec'), fi = el.getAttribute('data-fld');
  const secs = builderSections();
  if (!secs[si]) return;
  if (prop === 'name') { secs[si].name = el.value; return; }
  const f = secs[si].fields[fi];
  if (!f) return;
  if (prop === 'title') f.title = el.value;
  else if (prop === 'type') { f.type = el.value; normalizeField(f); renderBuilder(); }
  else if (prop === 'required') f.required = el.checked;
  else if (prop === 'min') f.min = el.value === '' ? undefined : Number(el.value);
  else if (prop === 'max') f.max = el.value === '' ? undefined : Number(el.value);
  else if (prop === 'points') f.points = el.value === '' ? undefined : Number(el.value);
  else if (prop === 'fail') f.fail = el.checked;
  else if (prop === 'optpts') {
    const k = el.getAttribute('data-optk');
    f.optionPoints = f.optionPoints || {};
    if (el.value === '') delete f.optionPoints[k]; else f.optionPoints[k] = Number(el.value);
  }
  else if (prop === 'options') {
    f.options = el.value.split('\n').map(s => s.trim()).filter(Boolean).map(v => ({ k: slug(v), v: v }));
    if (e.type === 'change') renderBuilder();   // refresh the per-choice point inputs once they finish typing
  }
}

function onBuilderClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.getAttribute('data-action');
  const si = parseInt(btn.getAttribute('data-sec'), 10);
  const fi = parseInt(btn.getAttribute('data-fld'), 10);
  const secs = builderSections();
  if (action === 'add-section') secs.push({ name: 'New Section', fields: [] });
  else if (action === 'del-section') { if (!confirm('Delete this whole section?')) return; secs.splice(si, 1); }
  else if (action === 'sec-up') { if (si > 0) { const t = secs[si]; secs[si] = secs[si - 1]; secs[si - 1] = t; } }
  else if (action === 'sec-down') { if (si < secs.length - 1) { const t = secs[si]; secs[si] = secs[si + 1]; secs[si + 1] = t; } }
  else if (action === 'add-field') { const f = { title: 'New Field', type: 'text' }; normalizeField(f); secs[si].fields = secs[si].fields || []; secs[si].fields.push(f); }
  else if (action === 'del-field') secs[si].fields.splice(fi, 1);
  else if (action === 'fld-up') { const a = secs[si].fields; if (fi > 0) { const t = a[fi]; a[fi] = a[fi - 1]; a[fi - 1] = t; } }
  else if (action === 'fld-down') { const a = secs[si].fields; if (fi < a.length - 1) { const t = a[fi]; a[fi] = a[fi + 1]; a[fi + 1] = t; } }
  else return;
  renderBuilder();
}

function showBuilderMsg(msg, kind) {
  const el = $('builder-msg');
  el.textContent = msg;
  el.className = 'sheet-msg ' + (kind === 'err' ? 'sheet-msg-err' : (kind === 'warn' ? 'builder-warn' : 'sheet-msg-ok'));
  el.classList.remove('hidden');
}

function applyConfig() {
  ['sections', 'pitSections'].forEach(key => {
    if (!Array.isArray(builderConfig[key])) { builderConfig[key] = []; return; }
    const used = [];
    builderConfig[key].forEach(s => {
      s.name = String(s.name || 'Section');
      (s.fields || []).forEach(f => {
        f.title = String(f.title || 'Field');
        if (!f.type) f.type = 'text';
        normalizeField(f);
        if (!f.code) f.code = slug(f.title, used);     // existing fields keep their code; new ones derive from the label
        used.push(f.code);
      });
    });
  });
  const matchCodes = (builderConfig.sections || []).flatMap(s => (s.fields || []).map(f => f.code));
  const missing = ['scoutName', 'eventKey', 'matchType', 'matchNumber', 'teamNumber'].filter(c => matchCodes.indexOf(c) === -1);
  const scoringCount = (builderConfig.sections || []).reduce((n, s) => n + (s.fields || []).filter(f => f.points != null || f.optionPoints).length, 0);

  CONFIG = deepClone(builderConfig);
  try { localStorage.setItem('custom_config', JSON.stringify(CONFIG)); } catch (e) {}
  syncAnalyticsConfig();
  draftFromImport = false;
  clearDraft();
  currentForm = 'match';
  applyForm();
  fields = initialFieldState();
  confidence = {};
  currentMatchId = newMatchId();
  if ($('transcript')) $('transcript').value = '';
  resetTranscriptBuffer();
  renderAllFields();
  syncFormUI();
  updateProcessButton();
  updateGenerateButton();
  if (missing.length) showBuilderMsg('Saved — but the match form no longer has the standard ' + missing.join(', ') + ' field(s). Those codes power Sheet de-duplication; keep fields titled "Scout Name", "Event Key", "Match Type", "Match #", "Team #" for full cloud support.', 'warn');
  else if (!scoringCount) showBuilderMsg('✓ Saved — but no field has a point value yet, so the 📈 ANALYZE engine can\'t rate teams or predict matches. Add a "pts" value to each scoring field (or re-import the manual).', 'warn');
  else showBuilderMsg('✓ Saved! The form rebuilt to match (' + scoringCount + ' scoring fields wired to ANALYZE). Export it to share with your scouts.', 'ok');
}

function exportConfig() {
  const blob = new Blob([JSON.stringify(CONFIG, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bobcat-scout-config.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
  showBuilderMsg('Config downloaded. Scouts can load it here via "Load pasted/uploaded".', 'ok');
}

function importConfigText(text) {
  let c;
  try { c = JSON.parse(text); } catch (e) { showBuilderMsg('That is not valid JSON — check for a missing bracket or comma.', 'err'); return; }
  if (!c || !Array.isArray(c.sections)) { showBuilderMsg('A config must have a "sections" array.', 'err'); return; }
  reconcileSelectScoring(c);
  builderConfig = c;
  if (!Array.isArray(builderConfig.pitSections)) builderConfig.pitSections = [];
  builderForm = 'match';
  draftFromImport = true;
  renderBuilder();
  showBuilderMsg('Loaded into the editor. Review the fields, then tap APPLY & SAVE.', 'ok');
}

async function resetConfig() {
  if (!confirm('Switch back to this year\'s game (REBUILT 2026)? Any custom game you built or imported will be replaced on this device.')) return;
  try { localStorage.removeItem('custom_config'); } catch (e) {}
  const def = await fetchDefaultConfig();
  builderConfig = deepClone(def);
  CONFIG = deepClone(def);
  syncAnalyticsConfig();
  draftFromImport = false;
  currentForm = 'match'; applyForm(); fields = initialFieldState(); confidence = {}; currentMatchId = newMatchId(); clearDraft();
  renderAllFields(); syncFormUI(); updateGenerateButton();
  renderBuilder();
  showBuilderMsg('✓ Switched back to this year\'s game — REBUILT 2026.', 'ok');
}

// =====================================================================
// IMPORT FROM GAME MANUAL — upload the year's manual, AI drafts the fields + scoring
// =====================================================================

// The identity columns every game needs (Sheet de-dup + analytics group-by).
// We always inject these so an AI/hand-built form can't accidentally drop them.
const IDENTITY_FIELDS = [
  { title: 'Scout Name', type: 'text', code: 'scoutName', required: true, preserve: true, placeholder: 'Your name' },
  { title: 'Event Key', type: 'text', code: 'eventKey', required: true, preserve: true, placeholder: '2026ctwat' },
  { title: 'Match #', type: 'number', code: 'matchNumber', required: true, default: 1, min: 1, max: 200 },
  { title: 'Match Type', type: 'select', code: 'matchType', default: 'qm', options: [{ k: 'qm', v: 'Qualification' }, { k: 'pm', v: 'Practice' }, { k: 'sf', v: 'Playoff' }] },
  { title: 'Team #', type: 'number', code: 'teamNumber', required: true, default: 0, min: 1, max: 99999 },
  { title: 'Alliance', type: 'select', code: 'alliance', preserve: true, default: 'red', options: [{ k: 'red', v: 'Red' }, { k: 'blue', v: 'Blue' }] },
  { title: 'Driver Station', type: 'select', code: 'driverStation', default: '1', options: [{ k: '1', v: '1' }, { k: '2', v: '2' }, { k: '3', v: '3' }] },
  { title: 'No Show', type: 'boolean', code: 'noShow', default: false, fail: true }
];
const IDENTITY_TITLE_RE = /^(scout\s*name|event\s*key|match\s*#|match\s*number|match\s*type|team\s*#|team\s*number|alliance|driver\s*station|no\s*show)$/i;

function ensureScoutingIdentity(cfg) {
  cfg.sections = Array.isArray(cfg.sections) ? cfg.sections : [];
  const idCodes = IDENTITY_FIELDS.map(f => f.code);
  cfg.sections.forEach(s => {
    s.fields = (s.fields || []).filter(f =>
      idCodes.indexOf(f.code) === -1 && !IDENTITY_TITLE_RE.test(String(f.title || '').trim()));
  });
  cfg.sections = cfg.sections.filter(s => s.fields && s.fields.length);
  cfg.sections.unshift({ name: 'Prematch', fields: deepClone(IDENTITY_FIELDS) });   // always lead with clean identity
  return cfg;
}

// Reliability robustness: a boolean that READS like a breakdown counts as one,
// even if an AI draft set "0 points" instead of ticking breakdown.
const BREAKDOWN_RE = /(tipp|disab|died|dead|broke|broken|fell|fall|no[\s-]*show|stuck|immobil)/i;
function markBreakdownFields(cfg) {
  (cfg.sections || []).forEach(s => (s.fields || []).forEach(f => {
    if (f.type === 'boolean' && f.fail == null && BREAKDOWN_RE.test(String(f.title || ''))) f.fail = true;
  }));
  return cfg;
}

// Scoring robustness: an AI sometimes keys optionPoints by the choice's LABEL or a
// near-miss slug instead of its option key — re-map so every point value actually lands.
function reconcileSelectScoring(cfg) {
  (cfg.sections || []).forEach(s => (s.fields || []).forEach(f => {
    if (f.type !== 'select' || !f.optionPoints || !Array.isArray(f.options) || !f.options.length) return;
    const keys = f.options.map(o => o.k);
    const fixed = {};
    Object.keys(f.optionPoints).forEach(k => {
      const val = f.optionPoints[k];
      if (keys.indexOf(k) !== -1) { fixed[k] = val; return; }                 // already a valid key
      const hit = f.options.find(o =>
        o.k === slug(k) || String(o.v).toLowerCase() === String(k).toLowerCase() || slug(o.v) === slug(k));
      if (hit) fixed[hit.k] = val;                                            // matched by label/slug
    });
    f.optionPoints = fixed;
  }));
  return cfg;
}

// A short human summary of what scoring the engine will read (for the import banner).
function summarizeScoring(cfg) {
  const out = [];
  (cfg.sections || []).forEach(s => (s.fields || []).forEach(f => {
    if (f.optionPoints) { const p = Object.keys(f.optionPoints).map(k => f.optionPoints[k]); if (p.length) out.push(f.title + ' (' + Math.min.apply(null, p) + '–' + Math.max.apply(null, p) + ')'); }
    else if (f.points != null) out.push(f.title + ' ' + f.points + 'pt');
  }));
  return out;
}

const MANUAL_PROMPT = [
  'You configure a robotics-competition scouting form. From the game-manual excerpt below, design the MATCH scouting fields and their SCORING.',
  'Output ONLY one JSON object (no markdown fences, no prose) of exactly this shape:',
  '{"title":"<Game> <Year>","sections":[{"name":"Auto","fields":[{"title":"Human label","type":"number|boolean|select|range|text","points":0,"optionPoints":{"key":0},"options":[{"k":"key","v":"Label"}],"fail":false}]}]}',
  'Rules:',
  '- Do NOT include identity fields (scout name, team #, match #, match type, alliance, driver station, no-show) — the app injects those itself.',
  '- Create one section per game period, e.g. "Auto", "Teleop", "Endgame", then a final "Qualitative" section.',
  '- type "number": a counted scoring action (balls/notes/cones/links scored). Set "points" to its value THAT period; make separate Auto vs Teleop fields when the value differs.',
  '- type "select" with "optionPoints": tiered actions (climb/park/stage levels). Give every option a point value and include its "options" list.',
  '- type "boolean": a yes/no scoring action (e.g. left the starting line). Set "points" if it scores; omit otherwise.',
  '- Set "fail":true ONLY on boolean breakdown fields (Tipped, Died/Disabled).',
  '- Always end with a "Qualitative" section containing: a 1-5 "range" Driver Skill, a 1-5 "range" Defense Rating, a boolean "Tipped" (fail), a boolean "Died / Disabled" (fail), and a text "Comments". No points on these.',
  '- Keep labels short. Use real point values from the manual. Output strictly valid JSON with numeric (not string) points.'
].join('\n');

function loadExternalScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector('script[data-ext="' + src + '"]')) return res();
    const s = document.createElement('script');
    s.src = src; s.async = true; s.setAttribute('data-ext', src);
    s.onload = () => res();
    s.onerror = () => rej(new Error('Could not load a helper (need internet for manual import).'));
    document.head.appendChild(s);
  });
}

async function extractPdfText(file) {
  await loadExternalScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
  if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions)
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  if (!window.pdfjsLib) throw new Error('PDF reader failed to load — paste the scoring text instead.');
  const buf = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  const out = [];
  const maxPages = Math.min(pdf.numPages, 140);
  for (let p = 1; p <= maxPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    out.push(tc.items.map(it => it.str).join(' '));
  }
  const joined = out.join('\n');
  if (joined.replace(/\s/g, '').length < 120)
    throw new Error('No readable text in that PDF — it looks like scanned images. Use PASTE SCORING TEXT and paste the scoring section instead.');
  return joined;
}

// Manuals are huge; send the AI the densest scoring region rather than 150 pages.
function pickScoringExcerpt(text) {
  text = String(text).replace(/\s+/g, ' ').trim();
  if (text.length <= 14000) return text;
  const kw = /(point|scor|ranking|climb|cargo|cone|cube|note|fuel|goal|rung|barge|amp|speaker|tarmac|auto|endgame|penalt|hatch|panel|cell|link)/gi;
  let best = 0, bestI = 0; const win = 14000;
  for (let i = 0; i < text.length - 1; i += 2000) {
    const m = text.slice(i, i + win).match(kw);
    const c = m ? m.length : 0;
    if (c > best) { best = c; bestI = i; }
  }
  return text.slice(bestI, bestI + win);
}

function extractJsonObject(s) {
  s = String(s).trim().replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('The AI did not return a form. Try again or paste a cleaner scoring section.');
  return JSON.parse(s.slice(a, b + 1));
}

async function aiDraftConfig(rawText) {
  const excerpt = pickScoringExcerpt(rawText);
  if (excerpt.length < 40) throw new Error('That looked empty — paste the scoring section, or the PDF may be scanned images (no text).');
  await loadExternalScript('https://js.puter.com/v2/');
  if (!window.puter || !puter.ai || !puter.ai.chat) throw new Error('AI service unavailable — check internet, or build the form by hand below.');
  try { puter.quiet = true; } catch (e) {}
  const resp = await Promise.race([
    puter.ai.chat(MANUAL_PROMPT + '\n\nMANUAL EXCERPT:\n"""\n' + excerpt + '\n"""'),
    new Promise((_, rej) => setTimeout(() => rej(new Error('AI timed out. If a Puter sign-in window opened, finish it and retry — or just build the form by hand below (the pts boxes set the scoring).')), 75000))
  ]);
  let text;
  if (resp && typeof resp === 'object') {
    const mc = resp.message && resp.message.content;
    text = resp.text || (typeof mc === 'string' ? mc : (mc && mc[0] && mc[0].text)) || String(resp);
  } else text = String(resp);
  const cfg = extractJsonObject(text);
  if (!cfg || !Array.isArray(cfg.sections)) throw new Error('The AI returned an invalid form. Try again.');
  ensureScoutingIdentity(cfg);
  markBreakdownFields(cfg);
  reconcileSelectScoring(cfg);
  cfg.title = cfg.title || 'Imported game';
  cfg.delimiter = '\t';
  if (!Array.isArray(cfg.pitSections)) cfg.pitSections = deepClone((CONFIG && CONFIG.pitSections) || []);
  return cfg;
}

function setManualStatus(msg, kind) {
  const el = $('manual-status'); if (!el) return;
  el.textContent = msg;
  el.className = 'b-import-status' + (kind === 'err' ? ' b-import-err' : (kind === 'ok' ? ' b-import-ok' : ''));
  el.classList.remove('hidden');
}

async function runManualDraft(getText, label) {
  setManualStatus('Reading ' + label + '… (10–30s)', '');
  try {
    const raw = await getText();
    setManualStatus('Designing your form from the manual with AI…', '');
    const cfg = await aiDraftConfig(raw);
    builderConfig = cfg;
    builderForm = 'match';
    draftFromImport = true;
    renderBuilder();
    const scoring = summarizeScoring(cfg);
    setManualStatus('✓ Drafted ' + scoring.length + ' scoring fields: ' + scoring.slice(0, 8).join(' · ') + (scoring.length > 8 ? ' …' : '') + '. DOUBLE-CHECK these below, then APPLY & SAVE.', 'ok');
    showBuilderMsg('Draft loaded from your manual — verify the point values, then APPLY & SAVE.', 'ok');
  } catch (e) {
    setManualStatus('⚠ ' + (e && e.message ? e.message : 'Import failed'), 'err');
  }
}

// =====================================================================
// UI WIRING
// =====================================================================

function updateProcessButton() {
  const btn = $('btn-process');
  const has = $('transcript').value.trim().length > 0;
  btn.disabled = !has;
}

function wireUI() {
  // Voice
  setupVoice();

  // Buttons
  $('btn-process').addEventListener('click', processTranscript);
  $('btn-sample').addEventListener('click', () => {
    $('transcript').value = SAMPLE_TEXT;
    resetTranscriptBuffer();
    updateProcessButton();
  });
  $('btn-clear-transcript').addEventListener('click', () => {
    $('transcript').value = '';
  resetTranscriptBuffer();
    updateProcessButton();
  });
  $('btn-clear-all').addEventListener('click', clearAll);
  $('btn-generate').addEventListener('click', generateOutput);
  $('btn-save-next').addEventListener('click', saveMatchAndNext);
  $('btn-reset').addEventListener('click', resetMatch);
  $('btn-export-session').addEventListener('click', exportSession);
  $('btn-clear-session').addEventListener('click', clearSession);
  $('btn-session').addEventListener('click', toggleSessionCard);
  $('btn-copy-tsv').addEventListener('click', e => copyToClipboard(generateTSV(fields), e.currentTarget));
  $('btn-copy-json').addEventListener('click', e => copyToClipboard(JSON.stringify(fields, null, 2), e.currentTarget));
  $('btn-download-qr').addEventListener('click', downloadQR);

  // Tabs
  $$('.tab').forEach(t => t.addEventListener('click', () => showTab(t.getAttribute('data-tab'))));

  // Transcript
  $('transcript').addEventListener('input', () => { updateProcessButton(); saveDraft(); });

  // Reference toggle
  $('ref-toggle').addEventListener('click', () => {
    $('ref-content').classList.toggle('hidden');
    $('ref-arrow').style.transform = $('ref-content').classList.contains('hidden') ? '' : 'rotate(180deg)';
  });

  // Help modal
  const helpOverlay = $('help-overlay');
  const openHelp = () => {
    helpOverlay.classList.remove('hidden');
    document.body.classList.add('no-scroll');
  };
  const closeHelp = () => {
    helpOverlay.classList.add('hidden');
    document.body.classList.remove('no-scroll');
  };
  $('btn-help').addEventListener('click', openHelp);
  $('btn-help-close').addEventListener('click', closeHelp);
  helpOverlay.addEventListener('click', e => {
    if (e.target === helpOverlay) closeHelp();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !helpOverlay.classList.contains('hidden')) closeHelp();
  });

  // Interactive walkthrough
  $('btn-start-tour').addEventListener('click', startTour);
  $('tour-next').addEventListener('click', () => { pauseTourAutoplay(); nextTourStep(); });
  $('tour-back').addEventListener('click', () => { pauseTourAutoplay(); prevTourStep(); });
  $('tour-close').addEventListener('click', endTour);
  $('tour-autoplay').addEventListener('click', toggleTourAutoplay);

  // Google Sheet connection
  $('btn-sheet').addEventListener('click', openSheetDialog);
  $('btn-sheet-close').addEventListener('click', closeSheetDialog);
  $('btn-sheet-save').addEventListener('click', saveSheetConfig);
  $('btn-sheet-test').addEventListener('click', sendTestRow);
  $('btn-sheet-share').addEventListener('click', copyScoutLink);
  $('btn-sheet-disconnect').addEventListener('click', disconnectSheet);
  $('btn-sheet-retry').addEventListener('click', () => flushQueue());
  $('btn-submit-sheet').addEventListener('click', submitCurrentMatch);
  $('btn-load-schedule').addEventListener('click', doLoadSchedule);
  $('btn-save-google').addEventListener('click', saveGoogleConfig);
  $('btn-google-signout').addEventListener('click', googleSignOut);
  $('sheet-overlay').addEventListener('click', e => { if (e.target === $('sheet-overlay')) closeSheetDialog(); });
  window.addEventListener('online', flushQueue);

  // Session summary
  $('btn-summary').addEventListener('click', toggleSummary);

  // Match / Pit mode
  $('mode-match').addEventListener('click', () => setForm('match'));
  $('mode-pit').addEventListener('click', () => setForm('pit'));

  // Form builder
  $('btn-builder').addEventListener('click', openBuilder);
  $('btn-builder-close').addEventListener('click', closeBuilder);
  $('bf-match').addEventListener('click', () => { builderForm = 'match'; renderBuilder(); });
  $('bf-pit').addEventListener('click', () => { builderForm = 'pit'; renderBuilder(); });
  $('builder-body').addEventListener('input', onBuilderEdit);
  $('builder-body').addEventListener('change', onBuilderEdit);
  $('builder-body').addEventListener('click', onBuilderClick);
  $('btn-builder-apply').addEventListener('click', applyConfig);
  $('btn-builder-export').addEventListener('click', exportConfig);
  $('btn-builder-reset').addEventListener('click', resetConfig);
  $('btn-builder-load').addEventListener('click', () => importConfigText($('builder-paste').value));
  // Import from game manual (AI-assisted draft)
  if ($('btn-manual-pdf')) $('btn-manual-pdf').addEventListener('click', () => $('manual-file').click());
  if ($('manual-file')) $('manual-file').addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (file) runManualDraft(() => extractPdfText(file), file.name);
    e.target.value = '';
  });
  if ($('btn-manual-text')) $('btn-manual-text').addEventListener('click', () => {
    const wrap = $('manual-text-wrap');
    wrap.classList.toggle('hidden');
    if (!wrap.classList.contains('hidden')) $('manual-text').focus();
  });
  if ($('btn-manual-go')) $('btn-manual-go').addEventListener('click', () => {
    const t = $('manual-text').value.trim();
    if (t.length < 40) { setManualStatus('Paste a bit more of the scoring section first.', 'err'); return; }
    runManualDraft(() => Promise.resolve(t), 'pasted text');
  });
  $('builder-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) { const r = new FileReader(); r.onload = () => { $('builder-paste').value = r.result; importConfigText(r.result); }; r.readAsText(file); }
  });
  $('btn-builder-upload').addEventListener('click', () => $('builder-file').click());
  $('builder-overlay').addEventListener('click', e => { if (e.target === $('builder-overlay')) closeBuilder(); });
}

// =====================================================================
// DRAFT AUTOSAVE — persist the in-progress match so a refresh/crash never loses it
// =====================================================================

function saveDraft() {
  try {
    localStorage.setItem('bobcat_draft', JSON.stringify({
      fields: fields,
      confidence: confidence,
      matchId: currentMatchId,
      form: currentForm,
      transcript: $('transcript') ? $('transcript').value : ''
    }));
  } catch (e) {}
}

function loadDraft() {
  try {
    const raw = localStorage.getItem('bobcat_draft');
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !d.fields) return null;
    if (d.form === 'match') { currentForm = d.form; applyForm(); }   // pit scouting removed — match only
    fields = Object.assign(initialFieldState(), d.fields);
    confidence = d.confidence || {};
    if (d.matchId) currentMatchId = d.matchId;
    return d;
  } catch (e) { return null; }
}

function clearDraft() {
  try { localStorage.removeItem('bobcat_draft'); } catch (e) {}
}

// Warn before saving a match+team already logged this session (catches mistakes early).
function isDuplicateInSession(d) {
  return sessionMatches.some(m =>
    String(m.matchNumber) === String(d.matchNumber) &&
    String(m.teamNumber) === String(d.teamNumber) &&
    String(m.matchType) === String(d.matchType) &&
    String(m.eventKey) === String(d.eventKey)
  );
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

// ---- Match / Pit mode ----
function syncFormUI() {
  const isPit = currentForm === 'pit';
  const step1 = $('step-describe'); if (step1) step1.classList.toggle('hidden', isPit);
  const saveNext = $('btn-save-next'); if (saveNext) saveNext.classList.toggle('hidden', isPit);
  const mm = $('mode-match'), mp = $('mode-pit');
  if (mm) mm.classList.toggle('mode-active', !isPit);
  if (mp) mp.classList.toggle('mode-active', isPit);
}

function setForm(form) {
  if (form === currentForm) return;
  currentForm = form;
  applyForm();
  const sn = fields.scoutName, ek = fields.eventKey;   // carry identity across the switch
  fields = initialFieldState();
  if (sn) fields.scoutName = sn;
  if (ek) fields.eventKey = ek;
  confidence = {};
  currentMatchId = newMatchId();
  $('output-section').classList.add('hidden');
  $('generate-row').classList.remove('hidden');
  const ss = $('submit-status'); if (ss) ss.classList.add('hidden');
  if ($('transcript')) $('transcript').value = '';
  resetTranscriptBuffer();
  renderAllFields();
  syncFormUI();
  updateProcessButton();
  updateGenerateButton();
  saveDraft();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// =====================================================================
// SESSION SUMMARY — per-team averages computed on the phone (no internet)
// =====================================================================

const CLIMB_RANK = { none: 0, attempted_failed: 0, parked: 1, level1: 2, level2: 3, level3: 4 };
const CLIMB_SHORT = { none: '—', attempted_failed: 'Fail', parked: 'Park', level1: 'L1', level2: 'L2', level3: 'L3' };

function computeSummary() {
  const byTeam = {};
  sessionMatches.forEach(m => {
    const t = (m.teamNumber == null || m.teamNumber === '') ? '?' : m.teamNumber;
    (byTeam[t] = byTeam[t] || []).push(m);
  });
  const num = v => parseFloat(v) || 0;
  const rows = Object.keys(byTeam).map(team => {
    const ms = byTeam[team], n = ms.length;
    const avg = key => ms.reduce((s, m) => s + num(m[key]), 0) / n;
    const a = avg('autoHubMade'), te = avg('teleopHubMade');
    let best = 'none';
    ms.forEach(m => { if ((CLIMB_RANK[m.endgameClimb] || 0) > (CLIMB_RANK[best] || 0)) best = m.endgameClimb; });
    const died = ms.filter(m => m.disabled).length;
    const tip = ms.filter(m => m.tipped).length;
    return {
      team: team, n: n,
      auto: a.toFixed(1), tele: te.toFixed(1), total: (a + te).toFixed(1),
      climb: CLIMB_SHORT[best] || best,
      driver: avg('driverSkill').toFixed(1),
      defense: avg('defenseRating').toFixed(1),
      issues: (died || tip) ? [died ? died + '✕died' : '', tip ? tip + '✕tip' : ''].filter(Boolean).join(' ') : '—'
    };
  });
  rows.sort((x, y) => parseFloat(y.total) - parseFloat(x.total));
  return rows;
}

function renderSummary() {
  const box = $('summary-box');
  if (!box) return;
  const rows = computeSummary();
  if (!rows.length) { box.innerHTML = '<div class="summary-empty">No saved matches yet this session.</div>'; return; }
  let h = '<div class="summary-scroll"><table class="summary-table"><thead><tr>'
    + '<th>Team</th><th>Mch</th><th>Auto</th><th>Tele</th><th>Total</th><th>Climb</th><th>Drv</th><th>Def</th><th>Issues</th>'
    + '</tr></thead><tbody>';
  rows.forEach(r => {
    h += '<tr><td><strong>' + escapeHTML(r.team) + '</strong></td><td>' + r.n + '</td><td>' + r.auto + '</td><td>' + r.tele
      + '</td><td><strong>' + r.total + '</strong></td><td>' + escapeHTML(r.climb) + '</td><td>' + r.driver + '</td><td>' + r.defense + '</td><td>' + escapeHTML(r.issues) + '</td></tr>';
  });
  h += '</tbody></table></div><div class="summary-note">Averages across matches saved this session, sorted by total fuel. Total = avg auto + avg teleop. "Climb" = best achieved.</div>';
  box.innerHTML = h;
}

function toggleSummary() {
  const box = $('summary-box');
  if (!box) return;
  if (box.classList.contains('hidden')) { renderSummary(); box.classList.remove('hidden'); }
  else box.classList.add('hidden');
}

// =====================================================================
// TBA MATCH SCHEDULE (optional) — auto-fill team # from match/alliance/station
// =====================================================================

let scheduleCache = null;  // { event, matches: { "14": {red:[...],blue:[...]} }, count }

function loadCachedSchedule() {
  try {
    const ek = String(fields.eventKey || '').toLowerCase();
    if (!ek) return;
    const raw = localStorage.getItem('tba_sched_' + ek);
    if (raw) scheduleCache = JSON.parse(raw);
  } catch (e) {}
}

async function loadSchedule(tbaKey, eventKey) {
  eventKey = String(eventKey || '').toLowerCase().trim();
  if (!eventKey) throw new Error('set the Event Key first');
  const resp = await fetch('https://www.thebluealliance.com/api/v3/event/' + eventKey + '/matches/simple', {
    headers: { 'X-TBA-Auth-Key': tbaKey }
  });
  if (!resp.ok) throw new Error('TBA ' + resp.status + (resp.status === 401 ? ' (check the API key)' : ''));
  const data = await resp.json();
  const matches = {};
  let count = 0;
  data.forEach(mt => {
    if (mt.comp_level !== 'qm') return;          // qualification matches
    matches[String(mt.match_number)] = {
      red: (mt.alliances.red.team_keys || []).map(k => k.replace('frc', '')),
      blue: (mt.alliances.blue.team_keys || []).map(k => k.replace('frc', ''))
    };
    count++;
  });
  scheduleCache = { event: eventKey, matches: matches, count: count };
  try {
    localStorage.setItem('tba_sched_' + eventKey, JSON.stringify(scheduleCache));
    localStorage.setItem('tba_key', tbaKey);
  } catch (e) {}
  return count;
}

// Fill the team number from the cached schedule whenever match/alliance/station changes.
function maybeAutoFillTeam() {
  if (!scheduleCache) return;
  if (scheduleCache.event !== String(fields.eventKey || '').toLowerCase()) return;
  if (fields.matchType !== 'qm') return;
  const m = scheduleCache.matches[String(fields.matchNumber)];
  if (!m) return;
  const arr = m[fields.alliance];
  if (!arr) return;
  const team = arr[parseInt(fields.driverStation, 10) - 1];
  if (!team || String(fields.teamNumber) === String(team)) return;
  fields.teamNumber = parseInt(team, 10) || team;
  confidence.teamNumber = 'high';
  const input = document.querySelector('[data-input="teamNumber"]');
  if (input) input.value = fields.teamNumber;
  saveDraft();
  updateGenerateButton();
}

async function doLoadSchedule() {
  const key = $('tba-key').value.trim();
  const ek = String(fields.eventKey || '').trim();
  if (!key) { showScheduleMsg('Paste your free TBA API key first (thebluealliance.com/account/login).', 'err'); return; }
  if (!ek) { showScheduleMsg('Set the Event Key field (e.g. 2026ctwat) first.', 'err'); return; }
  showScheduleMsg('Loading schedule from The Blue Alliance…', 'ok');
  try {
    const n = await loadSchedule(key, ek);
    showScheduleMsg('✓ Loaded ' + n + ' qual matches for ' + ek.toLowerCase() + '. Team # now auto-fills from match, alliance & station.', 'ok');
    maybeAutoFillTeam();
  } catch (e) {
    showScheduleMsg('Could not load schedule: ' + e.message, 'err');
  }
}

// ----- Rich Blue Alliance data for analytics (team names, official OPR, rankings, results) -----
// Lets the ANALYZE engine show real team names and validate its scouting-based
// predictions against the official match outcomes from the field.
async function fetchTBAEvent(tbaKey, eventKey) {
  eventKey = String(eventKey || '').toLowerCase().trim();
  if (!eventKey) throw new Error('set the Event Key first');
  if (!tbaKey) throw new Error('add your free TBA API key first');
  const base = 'https://www.thebluealliance.com/api/v3/event/' + eventKey;
  const opts = { headers: { 'X-TBA-Auth-Key': tbaKey } };
  async function get(path) {
    const r = await fetch(base + path, opts);
    if (!r.ok) throw new Error('TBA ' + r.status + (r.status === 401 ? ' — check the API key' : (r.status === 404 ? ' — no event "' + eventKey + '"' : '')));
    return r.json();
  }
  const [teams, oprs, rankings, matches] = await Promise.all([
    get('/teams/simple').catch(() => []),
    get('/oprs').catch(() => null),
    get('/rankings').catch(() => null),
    get('/matches/simple').catch(() => [])
  ]);
  const names = {};
  (teams || []).forEach(t => { if (t && t.team_number != null) names[String(t.team_number)] = t.nickname || ''; });
  const opr = {};
  if (oprs && oprs.oprs) Object.keys(oprs.oprs).forEach(k => { opr[k.replace('frc', '')] = Math.round(oprs.oprs[k] * 10) / 10; });
  const rank = {};
  if (rankings && rankings.rankings) rankings.rankings.forEach(r => {
    const rec = r.record || {};
    rank[String(r.team_key).replace('frc', '')] = { rank: r.rank, w: rec.wins, l: rec.losses, t: rec.ties };
  });
  const results = [];
  (matches || []).forEach(mt => {
    if (mt.comp_level !== 'qm' || !mt.alliances) return;
    const rs = mt.alliances.red.score, bs = mt.alliances.blue.score;
    if (rs == null || rs < 0 || bs == null || bs < 0) return;   // not played yet
    results.push({
      matchNumber: mt.match_number,
      redTeams: (mt.alliances.red.team_keys || []).map(k => k.replace('frc', '')),
      blueTeams: (mt.alliances.blue.team_keys || []).map(k => k.replace('frc', '')),
      redScore: rs, blueScore: bs,
      winner: mt.winning_alliance || (rs > bs ? 'red' : (bs > rs ? 'blue' : ''))
    });
  });
  const tba = { event: eventKey, names, opr, rank, results, pulledAt: Date.now() };
  try { localStorage.setItem('tba_event_' + eventKey, JSON.stringify(tba)); localStorage.setItem('tba_key', tbaKey); } catch (e) {}
  return tba;
}

// Called by the ANALYZE "Add official TBA data" button.
async function loadTBAData() {
  const tbaKey = ((localStorage.getItem('tba_key') || '') || ($('tba-key') ? $('tba-key').value : '')).trim();
  const ek = String(fields.eventKey || '').trim();
  if (!ek) throw new Error('Set the Event Key on the scouting form first (e.g. 2026ctwat).');
  if (!tbaKey) throw new Error('Add your free TBA API key in ⚙ SHEET → "Match schedule" first.');
  const tba = await fetchTBAEvent(tbaKey, ek);
  if (window.ANALYTICS && ANALYTICS.setTBA) ANALYTICS.setTBA(tba);
  return tba;
}
window.loadTBAData = loadTBAData;

// On startup, hand any cached official data to the analytics engine.
function loadCachedTBA() {
  try {
    const ek = String(fields.eventKey || '').toLowerCase();
    if (!ek) return;
    const raw = localStorage.getItem('tba_event_' + ek);
    if (raw && window.ANALYTICS && ANALYTICS.setTBA) ANALYTICS.setTBA(JSON.parse(raw));
  } catch (e) {}
}

function showScheduleMsg(msg, kind) {
  const el = $('schedule-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'sheet-msg ' + (kind === 'err' ? 'sheet-msg-err' : 'sheet-msg-ok');
  el.classList.remove('hidden');
}

// =====================================================================
// INIT
// =====================================================================

// =====================================================================
// SETUP WIZARD — zero-to-scouting, click by click
// Two tracks: Scouter (2 min) and Host (one time, ~15 min).
// Steps the app can verify tick themselves; the rest are manual
// checkboxes so a host can stop halfway and come back later.
// =====================================================================

const SETUP_STORE = 'setup_state';
const SCRIPT_URL = 'apps-script/Code.gs';   // same-origin on GitHub Pages
let setupState = { role: '', done: {}, hideStrip: false, tested: false };

function loadSetupState() {
  try {
    const raw = localStorage.getItem(SETUP_STORE);
    if (raw) setupState = Object.assign(setupState, JSON.parse(raw));
  } catch (e) {}
  if (!setupState.done) setupState.done = {};
}
function saveSetupState() {
  try { localStorage.setItem(SETUP_STORE, JSON.stringify(setupState)); } catch (e) {}
}
function ls(k) { try { return (localStorage.getItem(k) || '').trim(); } catch (e) { return ''; } }

// ---------------------------------------------------------------- steps

const SETUP_TRACKS = {
  scouter: [
    {
      id: 'name',
      title: 'Put your name in',
      time: '10 sec',
      auto: () => !!ls('scout_name'),
      body: `<p>Every match you send is stamped with your name, so the team knows whose data is whose. Type the name your team knows you by.</p>`,
      input: { key: 'scout_name', field: 'scoutName', label: 'Your name', placeholder: 'e.g. Krish' }
    },
    {
      id: 'event',
      title: 'Set the event code',
      time: '15 sec',
      auto: () => !!ls('event_key'),
      body: `<p>The event code tells the spreadsheet which competition this data belongs to. Your host will give it to you. It looks like <code>2026ctwat</code>, which is the year plus a short code for the event.</p>
             <p class="setup-dim">If the host sent you a setup link, this is probably already filled in.</p>`,
      input: { key: 'event_key', field: 'eventKey', label: 'Event code', placeholder: 'e.g. 2026ctwat' }
    },
    {
      id: 'connect',
      title: 'Check you are connected',
      time: '10 sec',
      auto: () => !!ls('sheet_endpoint'),
      body: `<p>When you are connected, every match you save goes straight into the team spreadsheet on its own. You never need a password for the spreadsheet itself, and you cannot open it. You can only send matches into it.</p>
             <div id="setup-conn-state" class="setup-state"></div>
             <p class="setup-dim">Not connected? Ask your host for the setup link and open it on this phone. You can still scout without it, because the app makes a QR code your host can scan instead.</p>`,
      actions: [
        { label: 'RECHECK', act: 'recheck', cls: 'btn-outline' },
        { label: 'WE ARE USING QR INSTEAD', act: 'qronly', cls: 'btn-ghost' }
      ]
    },
    {
      id: 'mic',
      title: 'Try the microphone',
      time: '30 sec',
      body: `<p>Tap the button, then say something like <em>"team one seventy seven scored four in auto and climbed high"</em>. Whatever you say shows up below. This is only a test and nothing gets saved.</p>
             <div id="setup-mic-out" class="setup-state">Nothing heard yet.</div>
             <p class="setup-dim">The microphone is optional. If you would rather type, tap <strong>I will type instead</strong> and the app works exactly the same.</p>`,
      actions: [
        { label: '&#127908; TEST MY MIC', act: 'mictest', cls: 'btn-primary' },
        { label: 'I WILL TYPE INSTEAD', act: 'micskip', cls: 'btn-ghost' }
      ]
    },
    {
      id: 'practice',
      title: 'Do one practice match',
      time: '1 min',
      body: `<p>This drops a sample match description into the box and fills the form from it, so you see the whole thing work before a real match starts. Nothing is sent anywhere.</p>
             <p class="setup-dim">Read the filled in fields afterwards. Anything the app guessed gets a small green <strong>AI</strong> badge, and you can tap any field to fix it.</p>`,
      actions: [{ label: '&#9654; RUN A PRACTICE MATCH', act: 'practice', cls: 'btn-primary' }]
    }
  ],
  host: [
    {
      id: 'sheet',
      title: 'Make the spreadsheet',
      time: '1 min',
      body: `<ol class="help-list">
               <li>Tap the button below. A brand new blank Google Sheet opens.</li>
               <li>Click the name in the top left corner where it says <strong>Untitled spreadsheet</strong>.</li>
               <li>Rename it to something like <strong>Bobcat Scouting 2026</strong>.</li>
             </ol>
             <p class="setup-dim">Use the account you want to own the data. Whoever owns this sheet is the only person who can ever open it.</p>`,
      actions: [{ label: '&#8599; OPEN A NEW GOOGLE SHEET', act: 'open:https://sheets.new', cls: 'btn-primary' }]
    },
    {
      id: 'script',
      title: 'Paste in the script',
      time: '3 min',
      body: `<ol class="help-list">
               <li>Tap <strong>COPY THE SCRIPT</strong> below. It copies the whole thing to your clipboard.</li>
               <li>Back in your spreadsheet, click <strong>Extensions</strong> in the top menu, then <strong>Apps Script</strong>. A code editor opens in a new tab.</li>
               <li>Click once inside the code area, press <strong>Ctrl and A</strong> together to select everything, then press <strong>Delete</strong>. The editor should be completely empty.</li>
               <li>Press <strong>Ctrl and V</strong> together to paste the script in.</li>
               <li>Click the <strong>save</strong> icon near the top, the one shaped like a floppy disk.</li>
             </ol>
             <p class="setup-dim">On a Mac use Command instead of Ctrl.</p>
             <div id="setup-script-msg" class="setup-state hidden"></div>`,
      actions: [
        { label: '&#128203; COPY THE SCRIPT', act: 'copyscript', cls: 'btn-primary' },
        { label: 'VIEW IT INSTEAD', act: 'openscript', cls: 'btn-ghost' }
      ]
    },
    {
      id: 'run',
      title: 'Run it once and approve it',
      time: '2 min',
      body: `<ol class="help-list">
               <li>Still in the Apps Script editor, find the dropdown near the top that lists function names. Choose <strong>firstTimeSetup</strong>.</li>
               <li>Click <strong>Run</strong>.</li>
               <li>Google asks for permission. Click <strong>Review permissions</strong>, pick your Google account, click <strong>Advanced</strong>, then <strong>Go to (project name)</strong>, then <strong>Allow</strong>.</li>
               <li>Go back to your spreadsheet tab. You should now see two new tabs at the bottom named <strong>Config</strong> and <strong>Data</strong>.</li>
             </ol>
             <div class="help-note">The scary looking warning screen is normal. Google shows it for any script that is not published in their store. This is your own script, running in your own account, writing to your own sheet.</div>`
    },
    {
      id: 'config',
      title: 'Pick a passcode',
      time: '1 min',
      body: `<ol class="help-list">
               <li>In your spreadsheet, click the <strong>Config</strong> tab at the bottom.</li>
               <li>In column B next to <strong>Passcode</strong>, make up a password such as <code>bobcat26</code>. Scouters never type this. It rides along inside the link you send them.</li>
               <li>Next to <strong>Active Event</strong>, put your event code such as <code>2026ctwat</code>, or leave it blank to accept any event.</li>
               <li><strong>Start Date</strong> and <strong>End Date</strong> are optional. Fill them in and the sheet only accepts data during your competition.</li>
             </ol>
             <p class="setup-dim">You can change any of this later by editing the Config tab. You never have to redeploy the script again.</p>`
    },
    {
      id: 'deploy',
      title: 'Publish the script',
      time: '2 min',
      body: `<p>This is the step people get wrong most often, so go slowly and match every dropdown exactly.</p>
             <ol class="help-list">
               <li>Back in the Apps Script tab, click <strong>Deploy</strong> in the top right, then <strong>New deployment</strong>.</li>
               <li>Click the small <strong>gear icon</strong> next to "Select type" and choose <strong>Web app</strong>.</li>
               <li><strong>Description</strong>: type <code>Bobcat Scout endpoint</code>.</li>
               <li><strong>Execute as</strong>: choose <strong>Me</strong>.</li>
               <li><strong>Who has access</strong>: choose <strong>Anyone</strong>.</li>
               <li>Click <strong>Deploy</strong>, then copy the <strong>Web app URL</strong>. It is long and it ends in <code>/exec</code>.</li>
             </ol>
             <div class="help-note"><strong>Why "Anyone" is safe here.</strong> "Anyone" only means a phone is allowed to knock on the door. It gives nobody access to your spreadsheet. The script still checks the passcode, the event, the dates and the numbers before it writes a single row, and it runs as you, not as them.</div>`
    },
    {
      id: 'connect',
      title: 'Connect this app and test it',
      time: '2 min',
      auto: () => !!(ls('sheet_endpoint') && setupState.tested),
      body: `<p>Paste the two things you just made, then send a test row and watch it land in the spreadsheet.</p>
             <div class="setup-fieldrow">
               <label>Web app URL</label>
               <input type="text" id="setup-url" placeholder="https://script.google.com/macros/s/AKfy.../exec">
             </div>
             <div class="setup-fieldrow">
               <label>Passcode</label>
               <input type="text" id="setup-pass" placeholder="the same passcode you typed in the Config tab">
             </div>
             <div id="setup-conn-msg" class="setup-state hidden"></div>
             <p class="setup-dim">A row called <strong>CONNECTION TEST</strong> appears in your Data tab. Delete it afterwards.</p>`,
      actions: [{ label: 'SAVE AND TEST', act: 'savetest', cls: 'btn-primary' }]
    },
    {
      id: 'share',
      title: 'Send the link to your scouters',
      time: '1 min',
      auto: () => !!setupState.done.share,
      body: `<p>One link sets up every scouter. It carries the address, the passcode and the event, so nobody has to type anything or be told a password.</p>
             <ol class="help-list">
               <li>Tap <strong>COPY SCOUT LINK</strong> and paste it into your team group chat.</li>
               <li>Or tap <strong>SHOW QR</strong> and let people scan it off your screen or a printed poster.</li>
               <li>Tell scouters to open the link once, then use the browser menu and <strong>Add to Home Screen</strong> so it behaves like a normal app.</li>
             </ol>
             <div id="setup-qr-out" class="setup-qr hidden"></div>`,
      actions: [
        { label: '&#128279; COPY SCOUT LINK', act: 'copylink', cls: 'btn-primary' },
        { label: 'SHOW QR', act: 'showqr', cls: 'btn-outline' }
      ]
    },
    {
      id: 'form',
      title: 'Build this year’s form',
      time: '5 min',
      optional: true,
      auto: () => !!ls('custom_config'),
      body: `<p>The app ships with this season’s game already built in, so you can skip this today. When next year’s game drops, this is the one step that makes everything else work again.</p>
             <ol class="help-list">
               <li>Tap <strong>OPEN THE FORM BUILDER</strong>.</li>
               <li>Upload the new game manual as a PDF, or paste the scoring section as text.</li>
               <li>Check every point value against the manual’s scoring table, fix anything wrong, then tap <strong>APPLY AND SAVE</strong>.</li>
             </ol>
             <div class="help-note">The point values you set here are what the ratings, the win predictions and the pick list are all built on. Nothing else needs to change.</div>`,
      actions: [{ label: '&#128736; OPEN THE FORM BUILDER', act: 'builder', cls: 'btn-outline' }]
    },
    {
      id: 'tba',
      title: 'Turn on automatic team numbers',
      time: '3 min',
      optional: true,
      auto: () => !!ls('tba_key'),
      body: `<p>This is the single best thing you can do for data quality. With it on, a scouter picks the match number and their station and the team number fills itself in, so nobody can fat finger a team number again. It also unlocks real team names, official rankings and the accuracy check against real results.</p>
             <ol class="help-list">
               <li>Tap <strong>GET A FREE KEY</strong> and sign in to The Blue Alliance.</li>
               <li>Scroll to <strong>Read API Keys</strong>, type any description, and click <strong>Add New Key</strong>.</li>
               <li>Copy the long key it gives you and paste it below.</li>
             </ol>
             <div class="setup-fieldrow">
               <label>Blue Alliance read key</label>
               <input type="text" id="setup-tba" placeholder="paste the read key here">
             </div>
             <div id="setup-tba-msg" class="setup-state hidden"></div>
             <p class="setup-dim">The key is free, it is read only, and it cannot change anything on The Blue Alliance.</p>`,
      actions: [
        { label: '&#8599; GET A FREE KEY', act: 'open:https://www.thebluealliance.com/account', cls: 'btn-outline' },
        { label: 'SAVE KEY', act: 'savetba', cls: 'btn-primary' }
      ]
    },
    {
      id: 'login',
      title: 'Lock it to your team’s accounts',
      time: '5 min',
      optional: true,
      auto: () => !!ls('google_client_id'),
      body: `<p>Optional and stricter. With this on, a scouter has to sign in with Google before anything they send is accepted, and every row records which account sent it. Most teams do not need this. Turn it on if you are worried about someone outside the team getting hold of the link.</p>
             <ol class="help-list">
               <li>In your spreadsheet’s <strong>Config</strong> tab, set <strong>Require Google Login</strong> to <code>yes</code>.</li>
               <li>Fill in either <strong>Allowed Domain</strong> with your school’s email domain, or <strong>Allowed Emails</strong> with a comma separated list.</li>
               <li>In this app, open <strong>SHEET</strong>, scroll to <strong>Google sign in</strong>, and tap <strong>Save and Enable</strong>. The Client ID is already filled in for you.</li>
             </ol>
             <div class="help-note">Sign ins last about an hour. When one expires a scouter taps the button again and anything waiting sends itself. Nothing is ever lost.</div>`,
      actions: [{ label: 'OPEN SHEET SETTINGS', act: 'sheetdlg', cls: 'btn-outline' }]
    }
  ]
};

// ---------------------------------------------------------------- state

function setupSteps() { return SETUP_TRACKS[setupState.role] || []; }
function stepDone(st) {
  if (st.auto && st.auto()) return true;
  return !!setupState.done[st.id];
}
function setupCounts() {
  const steps = setupSteps().filter((s) => !s.optional);
  return { done: steps.filter(stepDone).length, total: steps.length };
}

// ---------------------------------------------------------------- render

function renderSetup() {
  const roles = $('setup-roles'), track = $('setup-track');
  if (!setupState.role) {
    roles.classList.remove('hidden');
    track.classList.add('hidden');
    return;
  }
  roles.classList.add('hidden');
  track.classList.remove('hidden');

  const steps = setupSteps();
  const { done, total } = setupCounts();
  $('setup-progress-bar').style.width = (total ? (done / total) * 100 : 0) + '%';
  $('setup-progress-text').textContent = done + ' of ' + total + ' done';
  $('setup-done-banner').classList.toggle('hidden', done < total);

  let n = 0;
  $('setup-steps').innerHTML = steps.map((st) => {
    const ok = stepDone(st);
    if (!st.optional) n++;
    const num = st.optional ? '&#9734;' : String(n);
    const acts = (st.actions || []).map((a) =>
      `<button class="btn ${a.cls}" data-sact="${a.act}" data-step="${st.id}">${a.label}</button>`).join('');
    const inp = st.input
      ? `<div class="setup-fieldrow"><label>${st.input.label}</label>
           <input type="text" data-sinput="${st.id}" placeholder="${st.input.placeholder}" value="${escapeHTML(ls(st.input.key))}"></div>`
      : '';
    const manual = st.auto ? '' :
      `<button class="btn btn-ghost setup-mark" data-sdone="${st.id}">${ok ? '&#8617; NOT DONE YET' : '&#10003; MARK THIS DONE'}</button>`;
    return `<div class="setup-step ${ok ? 'setup-ok' : ''}" data-step-id="${st.id}" data-step-num="${num}">
      <div class="setup-step-head">
        <span class="setup-num">${ok ? '&#10003;' : num}</span>
        <div class="setup-step-title">
          <strong>${st.title}</strong>
          <span class="setup-time">${st.optional ? 'Optional &middot; ' : ''}${st.time}</span>
        </div>
      </div>
      <div class="setup-step-body">${st.body}${inp}
        <div class="setup-actions">${acts}${manual}</div>
      </div>
    </div>`;
  }).join('');

  if (setupState.role === 'host') {
    const u = $('setup-url'), p = $('setup-pass'), t = $('setup-tba');
    if (u) u.value = ls('sheet_endpoint');
    if (p) p.value = ls('sheet_passcode');
    if (t) t.value = ls('tba_key');
  }
  const cs = $('setup-conn-state');
  if (cs) {
    const on = !!ls('sheet_endpoint');
    cs.className = 'setup-state ' + (on ? 'setup-state-ok' : 'setup-state-warn');
    cs.textContent = on
      ? '✓ Connected. Matches you save go straight into the team spreadsheet.'
      : 'Not connected yet. You can still scout — the app makes a QR code your host can scan.';
  }
}

// ---------------------------------------------------------------- actions

function setupSay(id, msg, kind) {
  const el = $(id);
  if (!el) return;
  el.className = 'setup-state ' + (kind === 'err' ? 'setup-state-err' : kind === 'warn' ? 'setup-state-warn' : 'setup-state-ok');
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function copyScriptCode() {
  setupSay('setup-script-msg', 'Fetching the script…', 'warn');
  try {
    const r = await fetch(SCRIPT_URL, { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const code = await r.text();
    if (!/function\s+doGet/.test(code)) throw new Error('unexpected file');
    await navigator.clipboard.writeText(code);
    setupSay('setup-script-msg', '✓ Copied ' + Math.round(code.length / 1024) + ' KB. Now paste it into the Apps Script editor with Ctrl and V.', 'ok');
  } catch (e) {
    setupSay('setup-script-msg', 'Could not copy it automatically. Tap VIEW IT INSTEAD, then select all and copy by hand.', 'err');
  }
}

let setupRec = null;
function setupMicTest() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    setupSay('setup-mic-out', 'This browser has no built in speech recognition. On iPhone use Safari, on a computer use Chrome or Edge. Typing works everywhere.', 'warn');
    return;
  }
  if (setupRec) { try { setupRec.stop(); } catch (e) {} setupRec = null; return; }
  try {
    setupRec = new SR();
    setupRec.continuous = false;
    setupRec.interimResults = true;
    setupRec.lang = 'en-US';
    setupSay('setup-mic-out', 'Listening… say anything.', 'warn');
    setupRec.onresult = (ev) => {
      let txt = '';
      for (let i = 0; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
      if (txt.trim()) {
        setupSay('setup-mic-out', '✓ Heard: “' + txt.trim() + '”', 'ok');
        setupState.done.mic = true;
        saveSetupState();
      }
    };
    setupRec.onerror = (ev) => {
      const why = ev.error === 'not-allowed'
        ? 'The browser blocked the microphone. Tap the lock icon next to the web address, allow the microphone, then reload.'
        : ev.error === 'no-speech' ? 'Did not hear anything. Try again and speak up.'
        : 'Microphone error: ' + ev.error + '. You can always type instead.';
      setupSay('setup-mic-out', why, 'err');
      setupRec = null;
    };
    setupRec.onend = () => { setupRec = null; refreshSetupUI(); };
    setupRec.start();
  } catch (e) {
    setupSay('setup-mic-out', 'Could not start the microphone. You can always type instead.', 'err');
    setupRec = null;
  }
}

async function setupSaveTest() {
  const url = ($('setup-url').value || '').trim();
  const pass = ($('setup-pass').value || '').trim();
  if (!url) { setupSay('setup-conn-msg', 'Paste the web app URL first.', 'err'); return; }
  if (!/\/exec\/?$/.test(url)) {
    setupSay('setup-conn-msg', 'That URL does not end in /exec. Go back to Deploy and copy the Web app URL, not the editor address.', 'err');
    return;
  }
  $('sheet-url').value = url;
  $('sheet-pass').value = pass;
  saveSheetConfig();
  setupSay('setup-conn-msg', 'Sending a test row…', 'warn');
  const test = { scoutName: 'CONNECTION TEST', eventKey: fields.eventKey || 'test', matchType: 'pm', matchNumber: 1, teamNumber: 177, _id: 'test-' + Date.now().toString(36) };
  try {
    const resp = await jsonpSubmit(buildPayload(test));
    if (resp && resp.ok) {
      setupState.tested = true; saveSetupState();
      setupSay('setup-conn-msg', '✓ It works. A row called CONNECTION TEST is now in your Data tab — delete it whenever you like.', 'ok');
    } else if (resp && resp.status === 'queued') {
      setupState.tested = true; saveSetupState();
      setupSay('setup-conn-msg', '✓ Sent. The sheet took a moment to answer, so check the Data tab for a CONNECTION TEST row. If it is there you are all set.', 'ok');
    } else {
      setupSay('setup-conn-msg', 'The sheet answered but turned it away: ' + ((resp && resp.error) || 'rejected') + '. Usually the passcode here does not match the one in the Config tab.', 'err');
    }
  } catch (e) {
    setupSay('setup-conn-msg', 'Could not reach the sheet. Check that the deployment says Who has access: Anyone, and that you copied the URL ending in /exec.', 'err');
  }
  refreshSetupUI();
}

function scoutLinkFromStorage() {
  const url = ls('sheet_endpoint'), pass = ls('sheet_passcode');
  if (!url) return '';
  let link = location.origin + location.pathname + '?sheet=' + encodeURIComponent(url) + '&key=' + encodeURIComponent(pass);
  const tk = ls('tba_key'); if (tk) link += '&tba=' + encodeURIComponent(tk);
  const gid = ls('google_client_id'); if (gid) link += '&gid=' + encodeURIComponent(gid);
  return link;
}

function setupShowQR() {
  const box = $('setup-qr-out');
  const link = scoutLinkFromStorage();
  if (!link) { setupSay('setup-conn-msg', 'Connect the sheet first, in the step above.', 'err'); return; }
  box.innerHTML = '';
  box.classList.remove('hidden');
  if (typeof qrcode !== 'function') { box.textContent = 'QR library not loaded — use COPY SCOUT LINK instead.'; return; }
  try {
    const qr = qrcode(0, 'M'); qr.addData(link); qr.make();
    const count = qr.getModuleCount(), quiet = 4, cell = Math.max(2, Math.floor(300 / (count + quiet * 2)));
    const dim = cell * (count + quiet * 2);
    const c = document.createElement('canvas'); c.width = dim; c.height = dim;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = '#1F1F1F';
    for (let r = 0; r < count; r++) for (let k = 0; k < count; k++) if (qr.isDark(r, k)) ctx.fillRect((k + quiet) * cell, (r + quiet) * cell, cell, cell);
    c.style.cssText = 'width:100%;max-width:260px;height:auto;image-rendering:pixelated;';
    box.appendChild(c);
    const p = document.createElement('p');
    p.className = 'setup-dim';
    p.style.marginTop = '8px';
    p.textContent = 'Scouters scan this to connect. Anyone holding it can submit matches, so share it inside your team only.';
    box.appendChild(p);
    setupState.done.share = true; saveSetupState(); refreshSetupUI();
  } catch (e) { box.textContent = 'Could not build the QR — use COPY SCOUT LINK instead.'; }
}

function handleSetupAction(act, stepId) {
  if (act.indexOf('open:') === 0) { window.open(act.slice(5), '_blank', 'noopener'); return; }
  switch (act) {
    case 'copyscript': copyScriptCode(); break;
    case 'openscript': window.open(SCRIPT_URL, '_blank', 'noopener'); break;
    case 'recheck': renderSetup(); refreshSetupUI(); break;
    case 'qronly':
      setupState.done.connect = true; saveSetupState();
      setupSay('setup-conn-state', 'Fine. Scout the match, tap GENERATE, and show the QR code to your host so they can scan it into the spreadsheet.', 'ok');
      refreshSetupUI();
      break;
    case 'mictest': setupMicTest(); break;
    case 'micskip':
      setupState.done.mic = true; saveSetupState();
      setupSay('setup-mic-out', 'No problem. Type your match into the big box and every feature works the same.', 'ok');
      refreshSetupUI();
      break;
    case 'practice': closeSetup(); runPracticeMatch(); break;
    case 'savetest': setupSaveTest(); break;
    case 'copylink': {
      const link = scoutLinkFromStorage();
      if (!link) { setupSay('setup-conn-msg', 'Connect the sheet first, in the step above.', 'err'); return; }
      navigator.clipboard.writeText(link).then(
        () => { setupState.done.share = true; saveSetupState(); refreshSetupUI(); alert('Scout link copied. Paste it into your team chat.'); },
        () => { window.prompt('Copy this link and send it to your scouters:', link); }
      );
      break;
    }
    case 'showqr': setupShowQR(); break;
    case 'builder': closeSetup(); openBuilder(); break;
    case 'sheetdlg': closeSetup(); openSheetDialog(); break;
    case 'savetba': {
      const v = ($('setup-tba').value || '').trim();
      if (v.length < 20) { setupSay('setup-tba-msg', 'That does not look like a full key. Copy the whole thing from the Read API Keys section.', 'err'); return; }
      try { localStorage.setItem('tba_key', v); } catch (e) {}
      if ($('tba-key')) $('tba-key').value = v;
      setupSay('setup-tba-msg', '✓ Saved. Set the event code on the main form, then use LOAD MATCH SCHEDULE in SHEET settings to pull the schedule.', 'ok');
      refreshSetupUI();
      break;
    }
  }
}

function runPracticeMatch() {
  const btn = $('btn-sample');
  if (btn) btn.click();
  setTimeout(() => { const p = $('btn-process'); if (p && !p.disabled) p.click(); }, 250);
  setTimeout(() => {
    const fc = $('fields-container');
    if (fc) fc.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 700);
  setupState.done.practice = true; saveSetupState(); refreshSetupUI();
}

function markStep(id, val) {
  setupState.done[id] = val;
  saveSetupState();
  refreshSetupUI();
}

// ---------------------------------------------------------------- shell

function openSetup() {
  loadSetupState();
  renderSetup();
  $('setup-overlay').classList.remove('hidden');
  document.body.classList.add('no-scroll');
}
function closeSetup() {
  $('setup-overlay').classList.add('hidden');
  document.body.classList.remove('no-scroll');
  if (setupRec) { try { setupRec.stop(); } catch (e) {} setupRec = null; }
  refreshSetupUI();
}

// Update the open wizard's ticks and progress without rebuilding it, so a
// half-typed URL or key in a step doesn't get wiped out mid-edit.
function refreshSetupProgress() {
  const track = $('setup-track');
  if (!track || track.classList.contains('hidden')) return;
  const byId = {};
  setupSteps().forEach((st) => { byId[st.id] = st; });
  document.querySelectorAll('#setup-steps .setup-step').forEach((card) => {
    const st = byId[card.getAttribute('data-step-id')];
    if (!st) return;
    const ok = stepDone(st);
    card.classList.toggle('setup-ok', ok);
    const num = card.querySelector('.setup-num');
    if (num) num.innerHTML = ok ? '&#10003;' : card.getAttribute('data-step-num');
    const mark = card.querySelector('[data-sdone]');
    if (mark) mark.innerHTML = ok ? '&#8617; NOT DONE YET' : '&#10003; MARK THIS DONE';
  });
  const { done, total } = setupCounts();
  $('setup-progress-bar').style.width = (total ? (done / total) * 100 : 0) + '%';
  $('setup-progress-text').textContent = done + ' of ' + total + ' done';
  $('setup-done-banner').classList.toggle('hidden', done < total);
}

function refreshSetupUI() {
  refreshSetupProgress();
  const badge = $('setup-badge'), strip = $('ready-strip');
  if (!badge || !strip) return;
  if (!setupState.role) {
    badge.textContent = '!';
    badge.classList.remove('hidden');
    strip.classList.toggle('hidden', !!setupState.hideStrip);
    $('ready-title').textContent = 'Start here';
    $('ready-sub').textContent = 'Tell the app whether you are a scouter or the host and it walks you through the rest.';
    $('btn-ready-go').textContent = 'OPEN SETUP';
    return;
  }
  const { done, total } = setupCounts();
  const left = total - done;
  if (left > 0) {
    badge.textContent = String(left);
    badge.classList.remove('hidden');
    strip.classList.toggle('hidden', !!setupState.hideStrip);
    $('ready-title').textContent = left + (left === 1 ? ' step left' : ' steps left');
    $('ready-sub').textContent = setupState.role === 'host'
      ? 'Finish setup so your scouters’ matches land in the spreadsheet.'
      : 'Finish setup so your matches send themselves.';
    $('btn-ready-go').textContent = 'FINISH SETUP';
  } else {
    badge.classList.add('hidden');
    strip.classList.add('hidden');
  }
}

function wireSetup() {
  loadSetupState();
  $('btn-setup').addEventListener('click', openSetup);
  $('btn-setup-close').addEventListener('click', closeSetup);
  $('setup-overlay').addEventListener('click', (e) => { if (e.target === $('setup-overlay')) closeSetup(); });
  $('btn-setup-back').addEventListener('click', () => {
    setupState.role = ''; saveSetupState(); renderSetup(); refreshSetupUI();
  });
  $('btn-ready-go').addEventListener('click', openSetup);
  $('btn-ready-hide').addEventListener('click', () => {
    setupState.hideStrip = true; saveSetupState();
    $('ready-strip').classList.add('hidden');
  });

  document.querySelectorAll('.setup-role').forEach((b) => {
    b.addEventListener('click', () => {
      setupState.role = b.getAttribute('data-role');
      setupState.hideStrip = false;
      saveSetupState();
      renderSetup();
      refreshSetupUI();
    });
  });

  $('setup-steps').addEventListener('click', (e) => {
    const a = e.target.closest('[data-sact]');
    if (a) { handleSetupAction(a.getAttribute('data-sact'), a.getAttribute('data-step')); return; }
    const d = e.target.closest('[data-sdone]');
    if (d) { const id = d.getAttribute('data-sdone'); markStep(id, !setupState.done[id]); }
  });

  $('setup-steps').addEventListener('change', (e) => {
    const inp = e.target.closest('[data-sinput]');
    if (!inp) return;
    const st = setupSteps().find((s) => s.id === inp.getAttribute('data-sinput'));
    if (!st || !st.input) return;
    const v = inp.value.trim();
    try { localStorage.setItem(st.input.key, v); } catch (err) {}
    fields[st.input.field] = v;
    renderAllFields();
    updateGenerateButton();
    refreshSetupUI();
  });

  // Very first visit: open the wizard instead of dropping people into a blank form.
  if (!setupState.role && !ls('sheet_endpoint') && !ls('scout_name')) {
    setTimeout(openSetup, 400);
  }
}

async function init() {
  // Load config (a custom one the host built for this season, else the built-in game)
  try {
    CONFIG = await loadConfig();
  } catch (e) {
    document.body.innerHTML = `
      <div style="padding:40px;text-align:center;font-family:sans-serif;">
        <h2 style="color:#7B1F2B;">Failed to load config.json</h2>
        <p style="color:#6B6B6B;margin-top:10px;">Make sure config.json is in the same folder as index.html.</p>
        <p style="color:#6B6B6B;font-size:13px;margin-top:6px;">Error: ${escapeHTML(e.message)}</p>
      </div>`;
    return;
  }
  syncAnalyticsConfig();

  applyForm();
  fields = initialFieldState();
  currentMatchId = newMatchId();

  // Sheet connection: honor a shared ?sheet=&key=&tba=&gid= link, then load saved settings.
  applyUrlConfig();
  loadSheetConfig();
  loadGoogleConfig();

  // Restore persisted preferences
  try {
    const sn = localStorage.getItem('scout_name');
    if (sn) fields.scoutName = sn;
    const ek = localStorage.getItem('event_key');
    if (ek) fields.eventKey = ek;
    const sm = localStorage.getItem('session_matches');
    if (sm) sessionMatches = JSON.parse(sm);
  } catch(e) { console.warn('Restore failed', e); }

  // Restore an in-progress match draft (survives a refresh or crash)
  const draft = loadDraft();

  // Match schedule (optional) for team-number auto-fill
  loadCachedSchedule();
  loadCachedTBA();           // hand any cached official Blue Alliance data to the analytics engine
  try {
    const tk = localStorage.getItem('tba_key');
    const ek = String(fields.eventKey || '').toLowerCase();
    if (tk && ek && navigator.onLine && (!scheduleCache || scheduleCache.event !== ek)) {
      loadSchedule(tk, ek).then(maybeAutoFillTeam).catch(() => {});
    }
  } catch (e) {}

  renderAllFields();
  wireUI();
  syncFormUI();
  if (draft && draft.transcript) { $('transcript').value = draft.transcript; resetTranscriptBuffer(); }
  updateProcessButton();
  updateGenerateButton();
  updateSessionBar();
  updateSheetStatus();
  flushQueue();
  initGoogleSignIn();
  registerServiceWorker();
  wireSetup();
  refreshSetupUI();
}

document.addEventListener('DOMContentLoaded', init);
