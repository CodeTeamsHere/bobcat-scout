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

// The way this match is being scouted, chosen at the start of every match (scout-modes.js):
// '1' describe it · '2' talk, then fill the gaps · '3' guided questions. null = not chosen yet.
const MODES = window.SCOUT_MODES;
const LEXICON = window.SCOUT_LEXICON;   // the robotics dictionary for speech (scout-lexicon.js)
const MODE_NAMES = { '1': '1 · Describe it', '2': '2 · Talk, then fill gaps', '3': '3 · Guided', '4': '4 · Describe it, strict' };
// Way 4 is way 1 with submitting locked until every required box that applies is filled.
function strictMode() { return scoutMode === '2' || scoutMode === '3' || scoutMode === '4'; }
let scoutMode = null;
let choosingMode = false;      // the picker reopened mid-match with CHANGE WAY
let gapPlan = null;            // way 2: the boxes shown after CHECK, kept still while they're filled in
let showAllFields = false;     // way 2: the whole form instead of only what was missed
let guidedReview = false;      // way 3: the questions are over, the form is being checked


function activeSections() { return CONFIG.sections || []; }
function applyForm() {
  ALL_FIELDS = activeSections().flatMap(s => s.fields);
  // Images carry no value, so they get no column in the TSV / QR / Sheet row.
  FIELD_ORDER = ALL_FIELDS.filter(f => f.type !== 'image').map(f => f.code);
}

const SAMPLE_TEXT = "Scout name is Krish, event 2026ctwat, match 14, scouting team 177 red 2. In auto they scored 4 and picked up from the depot. Teleop they scored 18 shooting while driving, picked up off the floor and from the outpost chute. Pickup was pretty good, passing was amazing, about 60 percent. Played defense well. Went under the trench. Climbed the mid rung, 2 alliance robots climbed. No issues.";

// =====================================================================
// HELPERS
// =====================================================================

function $(id) { return document.getElementById(id); }
function $$(sel) { return document.querySelectorAll(sel); }

function initialFieldState() {
  const state = {};
  ALL_FIELDS.forEach(f => {
    if (f.type === 'image') return;                 // decoration, not data
    if (f.type === 'multiselect') state[f.code] = [];
    else if (f.default !== undefined) state[f.code] = f.default;
    else if (f.type === 'boolean') state[f.code] = false;
    else if (f.type === 'number' || f.type === 'range' || f.type === 'counter') state[f.code] = 0;
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
    const fromMult = [];   // chunks made by "hundred" / "thousand"
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
        fromMult[chunks.length - 1] = true;
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

    // A run that is a single small value stays a single value. Longer runs join up the
    // way team numbers are spoken, but only where a team number is expected (after
    // "team", "robot", or at the very start): speech recognition drops the commas, so
    // "team eight sixty eight eleven fuel in auto" is 868 and 11, and "shot seventeen
    // twenty nine in teleop" is two counts, not 1729.
    let p = runStart - 1;
    while (p >= 0 && /^\s*$/.test(tokens[p] || '')) p--;   // split() leaves empty strings between separators
    const atStart = p < 0 || /^[,.;!?]$/.test(tokens[p]);
    const before = atStart ? '' : wordAt(p);
    let pieces = chunks;
    if (chunks.length > 1 && (atStart || /^(team|teams|robot|bot|number|scouting|watching|got|on)$/.test(before))) {
      pieces = [];
      let cur = '', curMult = false;
      chunks.forEach((c, k) => {
        if (!cur) { cur = c; curMult = !!fromMult[k]; }
        // the padding "eleven hundred" leaves behind: 1100 + 14 -> 1114 (but "thirty oh five" is 3005)
        else if (curMult && c.length <= 2) { cur = String(parseInt(cur, 10) + parseInt(c, 10)); curMult = false; }
        else if ((cur + c).length <= 4) cur += c;
        else { pieces.push(cur); cur = c; curMult = !!fromMult[k]; }
      });
      pieces.push(cur);
    } else if (chunks.length === 2 && /^(match|qual|qualification|qm)$/.test(before) &&
               /^[12]$/.test(chunks[0]) && chunks[1].length === 2) {
      pieces = [chunks.join('')];                    // "match one twelve" -> 112
    } else if (chunks.length > 1 && fromMult[0] && chunks[1].length <= 2) {
      pieces = [String(parseInt(chunks[0], 10) + parseInt(chunks[1], 10))].concat(chunks.slice(2));
    }
    out.push(pieces.join(' '));
    // the run swallowed the whitespace that ended it; put one space back so
    // "one one one four on blue" stays "1114 on blue", not "1114on blue"
    if (j > 0 && isSep(j - 1) && !/^[,.;!?]$/.test(tokens[j - 1])) out.push(' ');
    i = j;
  }
  return out.join('');
}

function parseTranscript(text, initialState) {
  const original = text;
  // Misheard game words back into the game's words first ("tele op", "depo", "read to").
  const lex = (typeof window !== 'undefined' ? window : globalThis).SCOUT_LEXICON;
  // A scout who corrects themselves means the second number: "three, no wait, four",
  // "11 in auto, sorry, I mean 13".
  // "fourteen, no fifteen, no fourteen, yeah fourteen" keeps going until the last one.
  const CORRECTION = /\b\d+((?:\s+(?:fuel|balls?))?(?:\s+(?:in|during)\s+(?:the\s+)?(?:auto|teleop))?)[\s,.?!]*(?:no\s*,?\s*wait|wait\s*,?\s*no|wait|actually|sorry|correction|scratch\s+that|make\s+that|i\s+mean|my\s+bad|hold\s+on|no\s+sorry|no)[\s,.?!]*(?:(?:sorry|actually|wait|no)[\s,.?!]*)?(?:i\s+mean[\s,]*|it\s+was\s+|it'?s\s+|make\s+that\s+|they\s+(?:got|scored|made|had)\s+)?(\d+)\b/;
  let t0 = normalizeNumberWords(lex ? lex.fix(text) : text.toLowerCase());
  for (let k = 0; k < 6 && CORRECTION.test(t0); k++) t0 = t0.replace(CORRECTION, '$2$1');
  // a corrected station: "blue 1. no wait, blue 2", "station 2... actually no, it's station 3"
  t0 = t0.replace(/\b(?:(?:red|blue)\s+|station\s+)\d\b[\s,.?!]*(?:no\s*,?\s*wait|wait\s*,?\s*no|actually\s*,?\s*no|actually|sorry|i\s+mean|no)[\s,.?!]*(?:it'?s\s+|it\s+is\s+|they'?re\s+)?(?=(?:(?:red|blue)\s+|station\s+)\d\b)/g, '');
  // event codes said letter by letter: "2026 c t w a t"
  t0 = t0.replace(/\b(20\d{2})\s+((?:[a-z]\s+){2,9}[a-z])\b/g, (m, y, letters) => y + letters.replace(/\s+/g, ''));
  // Talk about OTHER robots, other matches and the arena isn't about this robot: drop it.
  // A whole sentence that says "not my robot" goes; otherwise just the clause.
  // (no lookbehind in these patterns: older iPhones can't parse it)
  t0 = t0.replace(/[^.!?]+[.!?]*/g, (sent) => (/\bnot\s+(?:my|our)\s+(?:robot|team|bot)\b|\bnot\s+(?:mine|ours)\b|\bnot\s+the\s+one\s+i'?m\s+(?:watching|scouting)\b/.test(sent) ? ' ' : sent));
  const OTHERS = /\b(?:did\s+you\s+see|(?:the\s+)?announcer|next\s+match\s+is|(?:our|my)\s+(?:robot|team)\s+is\s+in\s+the\s+queue|who\s+is\s+scouting|who'?s\s+scouting|(?:the|that|this)\s+(?:other\s+)?(?:robot|bot|team|one)\s+(?:next\s+to\s+(?:them|us|it)|across\s+the\s+field|over\s+there|on\s+the\s+other\s+side)|that\s+team\s+\d+|team\s+\d+\s+(?:across\s+the\s+field|over\s+there|on\s+the\s+other\s+side)|the\s+(?:blue|red)\s+(?:alliance\s+)?(?:robot|one|bot)\b|their\s+partners?'?s?\s+(?:passing|pickup|intake|defense|auto|robot|climb)|the\s+other\s+(?:robot|alliance|team)'?s?)\b[^.?!;|]*/g;
  t0 = t0.replace(OTHERS, (m, at, all) => (/\b(?:to|with|for|and|by|into|over|in|on|onto|across|against|at)\s+$/.test(all.slice(Math.max(0, at - 8), at)) ? m : ' '));
  const t = t0;
  const result = Object.assign({}, initialState);
  const conf = {};

  const titleCase = s => s.replace(/\b\w/g, c => c.toUpperCase());
  const set = (code, value, level) => { result[code] = value; conf[code] = level || 'high'; };
  const addMulti = (code, key) => {
    const cur = Array.isArray(result[code]) ? result[code].slice() : [];
    if (cur.indexOf(key) < 0) cur.push(key);
    result[code] = cur;
    conf[code] = 'high';
  };

  // Numbers already used for something (the team, the match, the station, a percent),
  // by their position in the text, so they are never also read as a count.
  const claimed = [];
  const claim = (at, len) => claimed.push([at, at + len]);
  const isClaimed = (at) => claimed.some(([a, b]) => at >= a && at < b);
  // First match of a pattern whose number (group 1) isn't claimed yet; claims it.
  const takeNumber = (re) => {
    const g = new RegExp(re.source, re.flags.replace('g', '') + 'gd');
    let m;
    while ((m = g.exec(t)) !== null) {
      const at = m.indices[1][0];
      if (!isClaimed(at)) { claim(at, m[1].length); return m; }
    }
    return null;
  };

  // ---- Ratings: the describing word nearest to what it describes ----
  // "passing was amazing defense was rough" has no commas once speech recognition is done
  // with it, so a rating comes from the words right next to its keyword, not the clause.
  const RATINGS = [
    [/^(?:not\s+(?:good|great)|not\s+very\s+good)$/, 2], [/^not\s+bad$/, 3],
    [/^(?:pretty|fairly|quite)\s+(?:good|well)$/, 4], [/^(?:really|very|super)\s+well$/, 5],
    [/^(?:really|very|super)\s+(?:good|strong|solid)$/, 5],
    [/^(?:amazing|incredible|elite|insane|fantastic|excellent|perfect|flawless|great|awesome|outstanding|dominant|unstoppable|good)$/, 5],
    [/^(?:solid|strong|nice|effective|consistent|reliable|quick|fast)$/, 4],
    [/^(?:decent|okay|ok|alright|average|fine|mid|mediocre|so\s+so)$/, 3],
    [/^(?:bad|poor|weak|rough|messy|struggled|struggling|slow|sloppy|inconsistent|shaky|meh)$/, 2],
    [/^(?:awful|terrible|horrible|useless|nonexistent|abysmal)$/, 1],
    [/^rate([0-5])$/, null]
  ];
  const rateWord = (phrase) => {
    for (const [re, v] of RATINGS) {
      const m = re.exec(phrase);
      if (m) return v === null ? Math.max(1, parseInt(m[1], 10)) : v;
    }
    return null;
  };
  // "def 4/5", "intake 3 out of 5" become a word the rating table knows
  const rated = t.replace(/\b([0-5])\s*(?:\/|out\s+of|of)\s*5\b/g, 'rate$1');
  const rateNear = (keywordRe) => {
    const words = rated.replace(/[.!?]/g, ' || ').replace(/[,;]/g, ' | ').replace(/[:=()\-]/g, ' ').split(/\s+/).filter(Boolean);
    let best = null;
    for (let i = 0; i < words.length; i++) {
      if (!keywordRe.test(words[i])) continue;
      // "...but they could not do it at all" in the same sentence is the bottom of the scale
      const sentence = words.slice(i, i + 22).join(' ').split('||')[0];
      if (/\b(?:could\s*n'?t|could\s+not|unable\s+to|can'?t)\s+(?:do\s+it|stop\s+(?:anyone|anybody|anything)|do\s+anything)\b|\bat\s+all\b/.test(sentence) && /\b(?:could|can|unable|at\s+all)\b/.test(sentence)) { best = [0, 1]; break; }
      // after: "passing was really good", "intake: solid"; before: "great defense", "pretty good intake"
      const cands = [];
      for (let d = 1; d <= 7 && i + d < words.length; d++) {
        if (words[i + d] === '|' || words[i + d] === '||') break;
        const one = words[i + d], two = words[i + d] + ' ' + (words[i + d + 1] || ''), three = two + ' ' + (words[i + d + 2] || '');
        for (const [ph] of [[three], [two], [one]]) {
          const v = rateWord(ph.trim());
          if (v !== null && /^(?:okay|ok|alright)$/.test(ph.trim()) && !/^(?:was|is|were|looked|seemed|felt|pretty|kinda|just)$/.test(words[i + d - 1] || '')) break;
          if (v !== null) { cands.push([/^(?:was|is|were|looked|seemed|felt)$/.test(words[i + d - 1] || '') ? d - 0.75 : d, v]); break; }
        }
        if (cands.length) break;
        if (!/^(?:was|is|were|are|looked|seemed|very|really|pretty|super|quite|fairly|so|kind|of|their|the|its|at|not|overall|honestly|just|and|it|they|but|kinda|also|got|felt|did|honest|tbh|bot|robot|too|up|rating|rated|eff|effectiveness|grade|wise|from|floor|ground|depot|outpost|all|match|whole|game|pretty|much|i|would|say|think)$/.test(words[i + d])) break;
      }
      // A full sentence that comes back to it: "They tried to play defense for a bit, but
      // honestly it was terrible."
      if (!cands.length) {
        for (let d = 1; d <= 20 && i + d < words.length; d++) {
          if (words[i + d] === '||') break;            // only a full stop ends the sentence
          if (keywordRe.test(words[i + d]) || /^(?:pickup|intake|passing|defense|auto|teleop|climb\w*|shooting|driving|drive)$/.test(words[i + d])) break;
          const v2w = rateWord(words[i + d] + ' ' + (words[i + d + 1] || ''));
          const v = v2w !== null ? v2w : rateWord(words[i + d]);
          const lead = words.slice(Math.max(0, i + d - 4), i + d).join(' ') + ' ';
          if (v !== null && (/\b(?:it|that|which|they|he|she)\s+(?:was|were|looked|seemed|worked)\s+(?:\w+\s+){0,2}$/.test(lead) || words[i + d + 1] === '||' || i + d + 1 === words.length)) { cands.push([10 + d, v]); break; }
        }
      }
      for (let d = 1; d <= 3 && i - d >= 0; d++) {
        if (words[i - d] === '|' || words[i - d] === '||') break;
        const one = words[i - d], two = (words[i - d - 1] || '') + ' ' + words[i - d];
        const v2 = rateWord(two.trim()), v1 = /^(?:okay|ok|alright|so)$/.test(one) ? null : rateWord(one);
        if (v2 !== null) { cands.push([d + 0.5, v2]); break; }
        if (v1 !== null) { cands.push([d + 0.5, v1]); break; }
        if (!/^(?:a|an|the|their|some|played|play|plays|playing|with|had|has|very|really|pretty|super|at|in|was|were)$/.test(words[i - d])) break;
      }
      cands.sort((a, b) => a[0] - b[0]);
      if (cands.length && (best === null || cands[0][0] < best[0])) best = cands[0];
    }
    return best ? best[1] : null;
  };

  // How a team scored: stationary, driving, or both.
  const HOW_DRIVING = /\(\s*moving\s*\)|\bmoving\b(?=\s*[).;]|\s*$)|\b(?:while\s+(?:driving|moving|on the move|in motion|going)|on the move|on the run|on the fly|in motion|shooting\s+and\s+driving|driving\s+and\s+shooting|moving\s+shots?|shot\s+while\s+moving|shoot(?:s|ing)?\s+(?:while\s+)?moving|while\s+drive|drive\s+by|mobile|on\s+the\s+way|kept\s+moving|running\s+and\s+gunning|driving\s+shots?)\b/i;
  const HOW_STATIONARY = /\b(?:without\s+moving|never\s+moved\s+(?:while|when)\s+shooting|did\s*n'?t\s+move\s+(?:while|when)\s+(?:shooting|they\s+shot)|sit\s+(?:by|at|near)\s+the\s+hub|sat\s+(?:by|at|near)\s+the\s+hub|camp(?:ed|ing)?\s+(?:and\s+)?sho\w*|while\s+(?:stationary|stopped|still|parked|standing still|sitting still)|from\s+a\s+(?:stop|standstill)|a\s+standstill|sitting\s+still|standing\s+still|stood\s+still|sat\s+still|sat\s+and\s+shot|stationary|parked(?:\s+and\s+shot|\s+shots?|\s+to\s+shoot)?|stopped\s+to\s+shoot|stopped\s+and\s+shot|stop\s+and\s+shoot|parks?\s+and\s+shoot|parked\s+before\s+shooting|stationary\s+shoot\w*|stopped\s+shots?|from\s+one\s+spot|from\s+the\s+same\s+spot|planted|stayed\s+still|sometimes\s+(?:they\s+)?stopped|stopped)\b/i;
  // "never stopped to shoot", "didn't stop" is the opposite of stationary
  const NOT_STATIONARY = /\b(?:never|didn'?t|did\s+not|without|no|wouldn'?t)\s+(?:even\s+)?(?:stop(?:ped|ping)?|park(?:ed|ing)?|stand(?:ing)?\s+still)\b(?!\s+(?:while|when)\s+shooting)/gi;
  const how = (ctx) => {
    if (!ctx) return '';
    // "stopped moving" is the robot dying, not a way of shooting
    const still = /\b(?:without|not|never|wasn'?t|weren'?t|didn'?t\s+keep)\s+moving\b|\bnever\s+left\s+(?:it|the\s+\w+)|\bcamp(?:ed|ing)\b[^.?!]{0,60}?\bshoot\w*|\bshot\s+from\s+there\b/.test(ctx);
    const c = ctx.replace(NOT_STATIONARY, ' ').replace(/\bstopped\s+(?:moving|working|responding)\b|\b(?:without|not|never|wasn'?t|weren'?t)\s+moving\b/g, ' ') + (still ? ' stationary' : '');
    const d = HOW_DRIVING.test(c), s = HOW_STATIONARY.test(c);
    if ((d && s) || /\bboth\b[^.?!]{0,25}\b(?:stationary|driving|moving|ways)\b|\bmoving\s+and\s+stopped\b|\bmix\s+of\s+(?:moving|stationary|stopped|parked)|\b(?:moving|driving)\s+(?:and|or)\s+(?:stationary|stopped|still|standing)\b|\b(?:stationary|stopped|still)\s+(?:and|or)\s+(?:moving|driving)\b|\bboth\s+(?:shooting\s+)?styles\b/.test(c)) return 'BOTH';
    if (d) return 'WHILE_DRIVE';
    if (s) return 'STATIONARY';
    return '';
  };

  // ---- Scout name ----
  // The name is the word or two after "scouter is", "my name is", "this is", or before
  // "here" / "scouting"; it stops at the first ordinary word ("ava watching 6324" -> Ava).
  const NOT_NAME = /^(?:and|event|match|team|teams|alliance|station|position|for|at|in|on|teleop|auto|scouting|watching|here|from|with|robot|bot|red|blue|qual|i|im|i'm|okay|ok|so|uh|um|like|this|that|the|a|an|they|it|its|number|today|now|again|is|was|scout|scouter|me|my|our|their|then|also|just|not|no|yes|going|gonna|about|for|good|great|bad|crazy|awesome|insane|wild|close|loud|fun|done|ready|all|one|two|three|four|five|six|seven|eight|nine|ten|starting|start|driver|playing|practice|finals?|playoff|semifinal|quarterfinal|hey|hi|hello|guys|everyone|recording|testing|mic|check|can|you|hear|we|us|very|really|pretty|sure|probably|maybe|watching|of|to|but|or|over|right|out|down|up|there|back|were|was|are|been|keep|still|be|started|am|been|in|everyone|everybody|who|whos|who's|someone|nobody|anyone|stuff|things|thing|people|robots|well|alright|yeah|yep|nope|guess|think|said|lol)$/i;
  const nameFrom = (s) => {
    const ws = String(s || '').split(/[\s,.;:|/]+/).filter(Boolean);
    const out = [];
    for (const w of ws) {
      if (NOT_NAME.test(w) || /\d/.test(w) || !/^[a-z][a-z'-]*$/i.test(w)) break;
      out.push(w);
      if (out.length === 2) break;
    }
    return out.length ? titleCase(out.join(' ')) : '';
  };
  const scoutPatterns = [
    /\b(?:scouter|scout)\b\s*(?:name\s*)?(?:is|:|=|-)?\s*([a-z][a-z\s'-]{1,30})/i,
    /\b(?:hi|hey|hello)\s*,?\s*(?:it'?s|its|it\s+is|this\s+is|i'?m|im|i\s+am)\s+([a-z][a-z'-]{1,20})/i,
    /\bmy\s+name\s+is\s+([a-z][a-z\s'-]{1,30})/i,
    /^[\s\-–]*([a-z][a-z'-]{1,20})\s*[|;]/i,
    /\b(?:this\s+is|it'?s|its)\s+([a-z][a-z'-]{1,20})\s+(?:here|scouting|speaking)\b/i,
    /\bthis\s+is\s+([a-z][a-z'-]{1,20})\b/i,
    /\bi\s*am\s+([a-z][a-z'-]{1,20})\b/i,
    /\b([a-z][a-z'-]{1,20})\s+(?:here\b|scouting\b(?!\s+(?:team|robot|\d)))/i
  ];
  for (const p of scoutPatterns) {
    const m = original.match(p);
    const name = m ? nameFrom(m[1]) : '';
    if (name) { set('scoutName', name); break; }
  }

  // ---- Event key ----
  for (const p of [/\bev(?:ent)?\s*(?:key\s*|code\s*)?(?:is|:|=)?\s*(20\d{2})\s*([a-z]{3,10})\b/i, /\b(20\d{2})([a-z]{3,10})\b/]) {
    const m = new RegExp(p.source, 'id').exec(t);
    if (m && m[1]) { set('eventKey', (m[1] + m[2]).toLowerCase()); claim(m.indices[1][0], 4); break; }
  }

  {
    const g = /\b(?:final|score|scored|ended|won|lost|result|results)\b[^.?!;|]{0,25}?\b(\d{1,3})\s*(?:-|to)\s*(\d{1,3})\b/gd;
    let m;
    while ((m = g.exec(t)) !== null) { claim(m.indices[1][0], m[1].length); claim(m.indices[2][0], m[2].length); }
  }
  // ---- Percent (claimed first: "60 percent" is never a count or a team) ----
  const pct = /\b(?:phone|battery|charge|charging|chance|sure|confident|certain|signal|volume|brightness)\b[^.?!]{0,30}\d{1,3}\s*(?:%|percent)|\d{1,3}\s*(?:%|percent)\s+(?:sure|chance|battery|charged|confident)/.test(t)
    ? null : takeNumber(/(\d{1,3})\s*(?:%|percent|per\s+cent)/);
  if (!pct) {
    const frac = t.match(/\b(?:made|hit|sank|scored|landed)\s+(?:about\s+|around\s+|like\s+|roughly\s+)?(half|a\s+third|a\s+quarter|three\s+quarters|most|all)\s+(?:of\s+)?(?:their|there|its|the)\s+shots\b/);
    const F = { half: 50, 'a third': 33, 'a quarter': 25, 'three quarters': 75, all: 100 };
    if (frac && F[frac[1].replace(/\s+/g, ' ')] !== undefined) set('scoringEffe', F[frac[1].replace(/\s+/g, ' ')], 'medium');
  }
  if (pct) {
    const n = parseInt(pct[1], 10);
    if (n >= 0 && n <= 100) set('scoringEffe', n);
  }

  // ---- Match number ----
  const mn = takeNumber(/\b(?:match|qual(?:ification|ifier)?s?|qm|sf|qf|practice|playoffs?|finals?|semifinals?|semis?|elims?|elimination|quarterfinals?)\s*(?:match\s*|round\s*)?(?:number\s*|#\s*|no\.?\s*)?(\d{1,3})\b(?!\s*(?:-|to)\s*\d)/);
  if (mn) {
    const n = parseInt(mn[1], 10);
    if (n > 0 && n <= 200) set('matchNumber', n);
  }

  // ---- Match type ----
  if (/\b(playoffs?|elims?|elimination|finals|final\s+match|sf|qf|semifinals?|semis|bracket|quarterfinals?)\b/i.test(t)) set('matchType', 'sf');
  else if (/\bpractice\s+(?:match|round|\d)/i.test(t) || /\bpm\s*\d/i.test(t)) set('matchType', 'pm');
  else if (/\b(qualification|qual|quals|qm)\b/i.test(t)) set('matchType', 'qm', 'medium');

  // ---- Starting position (1-3 red, 4-6 blue; alliance falls out of it) ----
  let slot = '';
  const posDirect = takeNumber(/\b(?:starting\s*)?(?:position|slot|start\s+spot)\s*(?:is\s*|number\s*|of\s*)?([1-6])\b/) ||
    takeNumber(/\b(?:start(?:ing)?|sp)\s*(?:spot\s*|pos\s*)?(?:is\s*)?([1-6])\b(?!\s*(?:%|percent|in\b|fuel|balls?))/);
  if (posDirect) slot = posDirect[1];
  else {
    const side = takeNumber(/\b(?:red|blue)\s*(?:side\s*)?(?:alliance\s*)?(?:drivers?\s*)?(?:stations?\s*|side\s*)?(?:number\s*)?([1-3])\b(?!\s*(?:%|percent|robots?|of\b))/);
    if (side) {
      const isBlue = /^blue/.test(side[0]);
      slot = String(parseInt(side[1], 10) + (isBlue ? 3 : 0));
    } else {
      const st = takeNumber(/\b(?:driver\s+)?station\s*([1-3])\s*(?:on\s+)?(?:the\s+)?(?:red|blue)\b/);
      if (st) slot = String(parseInt(st[1], 10) + (/blue\b/.test(st[0]) ? 3 : 0));
    }
  }
  if (slot) {
    set('startPos', slot);
    set('alliance', parseInt(slot, 10) <= 3 ? 'red' : 'blue');
  } else {
    // typed notes: "Q62; BLUE; ..."
    const ITEM = '(?:^|[;|/,]|\\s[-–]\\s)\\s*';
    const ABOUT = '(?:^|[,.;:|]\\s*|\\b(?:on|for|they\'?re|theyre|its|it\'?s|starting|start|playing\\s+for|scouting|robot\\s+\\d+|team\\s+\\d+|\\d+)\\s+(?:the\\s+)?)';
    // "the human player on blue", "a timeout on the red side", "the depot on the red side"
    const tAll = t.replace(/\b(?:human\s+player|hp|depot|outpost|timeout|time\s+out|hub|tower|trench|bump|zone|field|crowd|stands|fans|driver|drivers|coach)\s+(?:on|for|of)\s+(?:the\s+)?(?:red|blue)\b(?:\s+side)?/g, ' ');
    const red = /(?:^|\b(?!the\b)[a-z']+\s+|[^a-z\s]\s*)red\s+alliance\b/.test(tAll) || /\b(?:alliance\s*(?:is\s*)?red|on\s*(?:the\s+)?red|red\s+side|for\s+red|they'?re\s+red)\b/i.test(tAll) || new RegExp(ITEM + 'red\\s*(?:$|[;|/,]|\\s[-–]\\s)').test(tAll);
    const blue = /(?:^|\b(?!the\b)[a-z']+\s+|[^a-z\s]\s*)blue\s+alliance\b/.test(tAll) || /\b(?:alliance\s*(?:is\s*)?blue|on\s*(?:the\s+)?blue|blue\s+side|for\s+blue|they'?re\s+blue)\b/i.test(tAll) || new RegExp(ITEM + 'blue\\s*(?:$|[;|/,]|\\s[-–]\\s)').test(tAll);
    if (red && !blue) set('alliance', 'red');
    else if (blue && !red) set('alliance', 'blue');
  }

  // ---- Team number ----
  let team = takeNumber(/\b(?:team|robot|bot|scouting|watching|teams)\s*(?:number\s*|#\s*|no\.?\s*)?(\d{1,5})\b/) ||
    takeNumber(/\b(?:i'?m|i\s+am|im)\s+(?:on|watching|scouting|with)\s+(?:team\s+)?(\d{1,5})\b/) ||
    takeNumber(/\b(?:i'?ve|ive|i\s+have|i)\s+got\s+(?:team\s+)?(\d{1,5})\b(?!\s*(?:fuel|balls?|shots?|in\b))/) ||
    takeNumber(/\b(?:t|frc)(\d{1,5})\b/) ||
    takeNumber(/\bfrc\s+(\d{1,5})\b/) ||
    takeNumber(/(?:^|[\s;|,(])#\s?(\d{2,5})\b/) ||
    takeNumber(/\b(\d{1,5})\s+(?:is|was)\s+(?:my|the|our)\s+(?:robot|team|bot)\b/) ||
    takeNumber(/\bmy\s+(?:robot|team|bot)\s*(?:,|is|was|:)?\s*(?:team\s+)?(\d{1,5})\b/) ||
    takeNumber(/\bno\s*show\s*(?:[:=-]\s*)?(?:team\s+)?(\d{1,5})\b/) ||
    takeNumber(/\b(\d{1,5})\s+(?:on\s+|is\s+)?(?:the\s+)?(?:red|blue)\b/) ||
    takeNumber(/^\W*(\d{1,5})\b(?!\s*(?:in\s+(?:the\s+)?(?:auto|teleop)\b|fuel\b|balls?\b|shots?\b|percent\b|%|robots?\b|to\s+\d|-\s*\d))/);
  let teamLevel = 'high';
  if (!team && (conf.matchNumber || conf.startPos)) {
    // Typed notes put the team anywhere in the opening ("b3 q54 118 ..."): the first number
    // left over before the match itself is described.
    const zoneEnd = t.search(/\b(?:auto|teleop|endgame|scored|made|shot|sank|dumped|launched|landed|hit|put|climb\w*|picked|defense|died)\b/);
    const zone = zoneEnd >= 0 ? zoneEnd : t.length;
    const g = /\b(\d{1,5})\b/g;
    let m;
    while ((m = g.exec(t)) !== null && m.index < zone) {
      if (isClaimed(m.index)) continue;
      if (/^\s*(?:in\b|into\b|fuel\b|balls?\b|shots?\b|robots?\b|auto\b|teleop\b|percent\b|%|\/\s*[35]\b)/.test(t.slice(m.index + m[0].length)) || m[1] === '0') continue;
      if (/\b(?:scored|made|shot|sank|dumped|launched|landed|hit|put|got|about|around)\s+$/.test(t.slice(Math.max(0, m.index - 12), m.index))) continue;
      claim(m.index, m[1].length);
      team = m; teamLevel = 'medium';
      break;
    }
  }
  if (team) {
    const n = parseInt(team[1], 10);
    if (n >= 1 && n <= 99999) set('teamNumber', n, teamLevel);
  }

  // ---- No show ----
  if (/\b(no\s*show|did(n'?t| not)\s+show(?:\s+up)?|never\s+show(?:ed)?\s+up|never\s+showed|absent|did(?:n'?t| not)\s+come\s+out|never\s+came\s+out|was(?:n'?t| not)\s+(?:even\s+)?(?:there|on the field)|no\s+robot\s+(?:on the field|showed)|nobody\s+(?:came\s+out|showed(?:\s+up)?)|empty\s+(?:spot|station|slot)|did(?:n'?t| not)\s+make\s+it\s+(?:to|onto)\s+the\s+field|never\s+made\s+it\s+(?:to|onto)\s+the\s+field|no\s+robot\s+(?:there|in\s+(?:that|this|the)\s+(?:spot|station|slot)))\b/i.test(t)) {
    set('noShow', true);
  }

  // Numbers that count something else: "3 robots climbed", "level 2".
  {
    const g = /\b(\d)\s+(?:of\s+(?:the|our|their)\s+)?(?:alliance\s+)?(?:robots?|bots?|teams?)\b/gd;
    let m;
    while ((m = g.exec(t)) !== null) claim(m.indices[1][0], 1);
    const lv = /\b(?:level|rung|position|station)\s*(\d)\b/gd;
    while ((m = lv.exec(t)) !== null) claim(m.indices[1][0], 1);
  }

  // ================================================================ PHASES
  // Speech recognition returns one long run of words with no full stops, so the text is
  // cut into auto / teleop / endgame stretches at those words. "4 in auto" starts the
  // auto stretch at the 4; "in auto they scored 4" starts it at "in".
  const ZERO = '(?:nothing|none|zero|0|missed\\s+(?:everything|all(?:\\s+(?:of\\s+)?(?:their|its)\\s+shots)?)|no\\s+(?:fuel|balls?|shots?|points|scoring|score)\\b|(?:did\\s*n\'?t|did\\s+not|never|could\\s*n\'?t|could\\s+not)\\s+(?:score|shoot|make)\\w*(?:\\s+(?:any(?:thing)?|fuel|balls?))?)';
  let ITEM_SEP = /\s[-–]\s|\s*\|\s*|;|\s\/\s|\n/g;
  const commaItems = t.split(',');
  const commaTyped = commaItems.length >= 5 && commaItems.reduce((n, x) => n + x.trim().split(/\s+/).length, 0) / commaItems.length <= 4.5;
  if (commaTyped) ITEM_SEP = /\s[-–]\s|\s*\|\s*|;|\s\/\s|\n|,/g;
  const typedNotes = commaTyped || (t.match(ITEM_SEP) || []).length >= 2;
  const marks = [];
  {
    const g = /\b(auto|teleop|endgame)\b/g;
    let m;
    while ((m = g.exec(t)) !== null) {
      const phase = m[1] === 'auto' ? 'auto' : m[1] === 'teleop' ? 'tele' : 'end';
      const head = t.slice(0, m.index);
      let start = m.index, bound = false;
      const lastEnd = marks.length ? marks[marks.length - 1].kwEnd : 0;
      const since = head.slice(lastEnd);
      const b = since.match(new RegExp('(\\d+|' + ZERO + ')\\s+(?:(?!(?:auto|teleop|endgame|in|during|and|then|also|so|but|okay)\\b)[a-z\']+\\s+){0,3}?(?:(?:in|into|at)\\s+(?:the\\s+)?(?:hub|goal|basket)\\s+|in\\s+(?=during\\b))?(?:in|during|for)\\s+(?:the\\s+)?$')) ||
        // typed "29 teleop" (but in "auto they made 1 teleop they ..." the 1 is auto's)
        since.match(/(?:^\s*|[^a-z\s]\s*|\b(?!(?:scored|made|shot|sank|put|got|hit|landed|launched|dumped|like|about)\b)[a-z]+\s+)(\d+)\s+(?:(?:fuel|balls?|shots?|points?)\s+)?$/) ||
        since.match(/(\d+)\s+(?:fuel|balls?|shots?)\s+$/);
      // ...unless the words after the keyword carry their own count: in "auto they made 8
      // during teleop they shot 29" the 8 is auto's and 29 is teleop's.
      const after = t.slice(m.index + m[0].length, m.index + m[0].length + 50);
      // (a count that is itself followed by "in teleop" belongs to teleop, not here)
      const ownCount = /^\s*(?:[,(]\s*)?(?:(?:they|it|the\s+robot|robot|then)\s+)?(?:also\s+|only\s+|just\s+)?(?:scored|shot|made|sank|hit|put|dumped|got|landed|launched|had)\s+(?:in\s+)?(?:like\s+|about\s+|around\s+|maybe\s+)?\d+\b(?!\s*(?:%|percent))(?!\s+(?:[a-z]+\s+){0,3}?(?:in|during|for)\s+(?:the\s+)?(?:auto|teleop)\b)/.test(after) ||
        (/^\s*(?:was\s+|:\s*|=\s*|-\s*)?\d+\b(?!\s*(?:%|percent))/.test(after) && !/^\s*(?:was\s+|:\s*)?\d+\s+(?:[a-z]+\s+){0,2}?(?:(?:in|during|for)\s+(?:the\s+)?)?(?:auto|teleop)\b/.test(after));
      if (b && !ownCount) {
        const at = head.length - b[0].length;   // b ran on head.slice(lastEnd), which ends where head ends
        if (!(/^\d/.test(b[1]) && isClaimed(at))) { start = at; bound = true; }
      }
      const kwEnd = m.index + m[0].length;
      let capEnd = t.length;
      if (!bound) {
        const prep = head.match(/\b(?:in|during|for|of|at|on|then|and\s+then|the\s+whole|the\s+entire|the\s+rest\s+of|all|all\s+of|throughout|through|whole)\s+(?:the\s+)?$/);
        if (prep) {
          start = head.length - prep[0].length;
          // "they scooped from the outpost during auto, then ..." names the phase at the END of
          // its clause: the clause before it is auto, and what follows is not.
          const headTag = /^\s*(?:[,(]\s*)?(?:they|it|the\s+robot|robot|he|she|we|:|was\b|were\b|=|-?\s*\d|(?:scored|shot|made|picked|grabbed|intook|collected|pickup|pick|climbed|they|sank|launched|landed|hit|went|drove|did|had|got|ran|stayed|sat)\b)/.test(after);
          const before0 = t.slice(lastEnd, start).trim();
          const wholeTag = /\b(?:whole|entire|all|throughout|rest\s+of)\s+(?:the\s+)?$/.test(head);
          const tailTag = (wholeTag || !headTag) && before0.split(/\s+/).filter(Boolean).length >= 2;
          if (tailTag) {
            const before = t.slice(lastEnd, start);
            let cut = -1;
            const bre = /[.;!?|]|,(?=(?:\s+\S+){3,}\s*$)|\b(?:then|also|so|okay|plus|but|and\s+then)\b/g;
            let bm;
            while ((bm = bre.exec(before)) !== null) cut = bm.index + bm[0].length;
            // at most about six words back: "they scooped from the outpost during auto"
            const words6 = before.slice(cut >= 0 ? cut : 0).match(/(?:\S+\s*){1,10}$/);
            start = lastEnd + (cut >= 0 ? cut : 0) + (words6 ? before.slice(cut >= 0 ? cut : 0).length - words6[0].length : 0);
            capEnd = kwEnd;
          }
        }
      }
      // Typed notes are a list of items ("auto pu floor - tele 6 - L2"): a phase word only
      // covers its own item.
      if (typedNotes) {
        const itemStart = Math.max(0, ...[...head.matchAll(ITEM_SEP)].map((x) => x.index + x[0].length));
        start = itemStart;
        ITEM_SEP.lastIndex = 0;
        let end = kwEnd + Math.max(0, t.slice(kwEnd).search(ITEM_SEP));
        if (t.slice(kwEnd).search(ITEM_SEP) < 0) end = t.length;
        // the next item carries on this one: ", and picked up from the depot", ", standing still"
        for (let guard = 0; guard < 4 && end < t.length; guard++) {
          const restItems = t.slice(end).replace(/^(?:\s[-–]\s|\s*\|\s*|;|\s\/\s|\n|,)/, '');
          const item = restItems.split(ITEM_SEP)[0];
          ITEM_SEP.lastIndex = 0;
          if (/\b(?:auto|teleop|endgame)\b/.test(item) || !/^\s*(?:and|then|while|also|plus|but|standing|shooting|from\s+a|on\s+the\s+move|stationary|moving|parked)\b/.test(item)) break;
          end = t.length - restItems.length + item.length;
        }
        capEnd = Math.min(capEnd, end);
      }
      // "auto climb" names the climb, not a stretch of the match
      const isAutoClimbName = phase === 'auto' && !bound && /^\s*climbs?\b/.test(t.slice(m.index + 4));
      if (isAutoClimbName) continue;
      if (marks.length && start < marks[marks.length - 1].kwEnd) start = Math.max(start, marks[marks.length - 1].kwEnd);
      marks.push({ phase, start, kwEnd, bound, capEnd });
    }
  }
  const segs = [];
  {
    let pos = 0;
    marks.forEach((mk, k) => {
      const s0 = Math.max(mk.start, pos);
      if (s0 > pos) segs.push({ phase: 'none', start: pos, end: s0 });
      const next = k + 1 < marks.length ? marks[k + 1].start : t.length;
      const end = Math.max(s0, Math.min(next, mk.capEnd));
      segs.push({ phase: mk.phase, start: s0, end, bound: mk.bound, kwEnd: mk.kwEnd });
      pos = end;
    });
    if (pos < t.length) segs.push({ phase: 'none', start: pos, end: t.length });
  }
  const phaseAt = (i) => { for (const s of segs) if (i >= s.start && i < s.end) return s.phase; return 'none'; };
  const joinSegs = (list) => list.reduce((acc, sg, k) => acc + (k && list[k - 1].end !== sg.start ? ' . ' : '') + t.slice(sg.start, sg.end), '');
  const textOf = (phase) => joinSegs(segs.filter((sg) => sg.phase === phase));
  const hasPhase = (phase) => segs.some((s) => s.phase === phase);
  const autoText = textOf('auto');
  const teleText = textOf('tele');
  // With no "teleop" said, everything that isn't auto is about teleop and the endgame.
  const teleOrRest = joinSegs(segs.filter((sg) => sg.phase !== 'auto'));

  // ---- Counts ----
  const countIn = (phase) => {
    const g = /\b(\d{1,3})\b/g;
    let m;
    while ((m = g.exec(t)) !== null) {
      if (isClaimed(m.index) || phaseAt(m.index) !== phase) continue;
      const after = t.slice(m.index + m[0].length, m.index + m[0].length + 24);
      if (/^\s*(?:%|percent\b|robots?\b|bots?\b|seconds?\b|secs?\b|minutes?\b|points?\s+(?:penalty|foul))/.test(after)) continue;
      const n = parseInt(m[1], 10);
      if (n > 300) continue;
      return n;
    }
    return null;
  };
  const ZERO_RE = new RegExp('\\b' + ZERO + '\\b');
  const autoN = countIn('auto');
  if (autoN !== null) {
    set('autoFuelScored', autoN);
    if (autoN > 0) set('AutoScored', true);
    else set('scoringMannerismAuto', 'NONE');
  } else if (hasPhase('auto') && ZERO_RE.test(autoText)) {
    set('autoFuelScored', 0);
    set('scoringMannerismAuto', 'NONE');
  }
  if (/\b(?:scored|shot|made)\s+(?:fuel\s+|some\s+|a\s+few\s+)?in\s+auto\b/i.test(t) && !(conf.autoFuelScored && result.autoFuelScored === 0)) set('AutoScored', true);

  let teleN = countIn('tele');
  let teleLevel = 'high';
  if (teleN === null && !hasPhase('tele')) {
    // a count with no period named: "scored 12", "they made 20 fuel"
    const m = t.match(/\b(?:made|scored|shot|sank|hit|dumped|landed|launched|put\s+in|put\s+up)\s+(?:about\s+|around\s+|like\s+)?(\d{1,3})\b|\b(\d{1,3})\s+(?:points?\s+of\s+)?(?:fuel|balls?|shots?)\b/);
    if (m) {
      const at = t.indexOf(m[0]) + m[0].indexOf(m[1] || m[2]);
      if (!isClaimed(at) && phaseAt(at) !== 'auto') { teleN = parseInt(m[1] || m[2], 10); teleLevel = 'medium'; }
    }
  }
  const noneSaid = (ph) => new RegExp('\\bno\\s+' + ph + '\\s+(?:score|scoring|points|fuel|shots?)\\b|\\b' + ph + '\\s*(?:score|scoring|fuel)?\\s*(?:[:=-]\\s*)?(?:none|nothing|zero)\\b').test(t);
  if (noneSaid('auto') && !conf.autoFuelScored) { set('autoFuelScored', 0); set('scoringMannerismAuto', 'NONE'); }
  if (teleN !== null) set('teleopFuelScored', teleN, teleLevel);
  else if (noneSaid('teleop') || (hasPhase('tele') && ZERO_RE.test(teleText))) { set('teleopFuelScored', 0); set('scoringMannerismTele', 'NONE'); }
  else if (!hasPhase('tele') && /\b(?:did\s*n'?t|did\s+not|never|could\s*n'?t)\s+score\b(?!\s+(?:in|during)\s+auto)|\bno\s+scoring\b/.test(teleOrRest)) {
    set('teleopFuelScored', 0, 'medium'); set('scoringMannerismTele', 'NONE', 'medium');
  }
  if (teleN === 0 && !conf.scoringMannerismTele) set('scoringMannerismTele', 'NONE');

  // ---- How they scored ----
  // a way of shooting said right before "in auto" / "during teleop" belongs to that phase
  const howTagged = { auto: '', teleop: '' };
  {
    const g = /((?:shoot\w*|shot|were|was|they|it)?\s*(?:while\s+\w+|on\s+the\s+(?:move|fly|run)|stationary(?:\s+when\s+shooting)?|standing\s+still|sat\s+still|parked\s+and\s+shot|stopped\s+to\s+shoot|from\s+a\s+(?:stop|standstill)))\s+(?:\w+\s+){0,2}?(?:in|during)\s+(?:the\s+)?(auto|teleop)\b/g;
    let m;
    while ((m = g.exec(t)) !== null) howTagged[m[2]] += ' ' + m[1];
  }
  const howAuto = how(autoText + ' . ' + howTagged.auto);
  if (howAuto) set('scoringMannerismAuto', howAuto);
  const howTele = how(teleOrRest + ' . ' + howTagged.teleop);
  if (howTele) set('scoringMannerismTele', howTele);

  // ---- Pickup ----
  // Only places named right after a pickup word count: "picked up from the depot and the
  // floor" is a pickup; "went under the trench near the depot" is not.
  const PICK_VERB = /\b(?:pick(?:ed|s|ing)?\s*(?:it\s+|them\s+|fuel\s+|balls?\s+)?up|pickups?|grab(?:bed|s|bing)?|intake[ds]?|intaking|collect(?:ed|s|ing)?|scoop(?:ed|s|ing)?|gather(?:ed|s|ing)?|got\s+(?:fuel|balls?|more|it)|load(?:ed|s|ing)?\s+(?=up|from|fuel|balls?|off)|reload(?:ed|s|ing)?|pull(?:ed|s|ing)?|took|refill(?:ed|s)?|fed\s+(?:from|by|off)|feeding\s+from|sourc(?:ed|ing)|cycl(?:ed|ing|es)\s+(?=from|off)|came\s+from|getting\s+(?:fuel|balls?)|went\s+to\s+(?=the\s+(?:depot|outpost|neutral|floor)))\b/g;
  const PICK_SPAN = /^(?:\s*,?\s+(?:\d+|consistent|good|great|okay|ok|fine|solid|decent|fast|quick|mostly|usually|from|off|of|at|in|on|the|a|and|both|also|plus|fuel|balls?|some|more|it|them|then|near|by|human|player|players|station|zone|chute|depot|outpost|floor|ground|carpet|neutral|mid|midfield|middle|center|centre|field|loose|their|our|own|alliance|side|area|wall|corner|hp|up|lot|lots|everywhere|mostly|mainly|only|just|too|as|well|bin|feeder|loading|was|were|is|all|over|nz)\b)+/;
  const LOCS = [
    ['DEPOT', /\bdepot\b/],
    ['H_Player', /\b(?:human\s+player|hp|chute|outpost|feeder|loading\s+station)\b/],
    ['FLOOR', /\b(?:floor|ground|carpet|loose)\b/],
    ['MID', /\b(?:midfield|mid\s+field|neutral\s+zone|middle(?:\s+of\s+the\s+field)?|center(?:\s+of\s+the\s+field)?|centre|field|mid|nz|neutral)\b/]
  ];
  const pickupsIn = (ctx) => {
    const found = [];
    let any = false;
    if (!ctx) return { found, any };
    ctx = ctx.replace(/[:=]/g, ' ');
    PICK_VERB.lastIndex = 0;
    let m;
    while ((m = PICK_VERB.exec(ctx)) !== null) {
      const before = ctx.slice(Math.max(0, m.index - 14), m.index);
      if (/\b(?:no|not|never|didn'?t|did\s+not|couldn'?t|could\s+not|without)\s+$/.test(before)) continue;
      any = true;
      const span = (ctx.slice(m.index + m[0].length).match(PICK_SPAN) || [''])[0];
      // "depot pickup", "floor intake": the place said first
      const lead = (ctx.slice(Math.max(0, m.index - 30), m.index).match(/(?:depot|outpost|floor|ground|human\s+player|hp|neutral\s+zone|midfield|chute)\s+$/) || [''])[0];
      for (const [key, re] of LOCS) if ((re.test(span) || re.test(lead)) && found.indexOf(key) < 0) found.push(key);
    }
    // "the human player fed them", "human player gave them everything"
    if (/\b(?:human\s+player|hp)\s+(?:was\s+|kept\s+)?(?:fed|feeds|feeding|gave|gives|giving|handed|handing|loaded|loading)\b/.test(ctx) && found.indexOf('H_Player') < 0) { found.push('H_Player'); any = true; }
    // "from the depot and the floor", "off the floor": wherever fuel came from, whatever the verb.
    // "went to / camped / drove to the neutral zone" too (not "passed to the center").
    const LOC_WORD = '(?:depot|outpost|chute|human\\s+player(?:\\s+station)?|hp|floor|ground|carpet|neutral\\s+zone|midfield|mid\\s+field|middle\\s+of\\s+the\\s+field|center\\s+of\\s+the\\s+field)';
    const LIST = LOC_WORD + '(?:\\s*(?:,|and|&)\\s*(?:the\\s+)?' + LOC_WORD + ')*';
    const reFrom = new RegExp('\\b(?:from|off(?:\\s+of)?)\\s+(?:the\\s+)?(?:the\\s+)?' + LIST, 'g');
    const reGo = new RegExp('\\b(?:went|go|goes|going|drove|drive|drives|ran|run|runs|headed|heading|cycled|cycling|camp(?:ed|ing|s)?|sat|sitting|parked|lived|stayed)\\s+(?:out\\s+|right\\s+|straight\\s+|over\\s+|back\\s+)*(?:to|at|in|by|for|on|into)?\\s*(?:the\\s+)?(?:depot|outpost|neutral\\s+zone|midfield|human\\s+player(?:\\s+station)?)\\b', 'g');
    const reGo2 = /\b(?:went|go|goes|going|drove|drive|drives|ran|run|runs|headed|heading)\b[^.?!]{0,45}?\bto\s+(?:the\s+)?(?:neutral\s+zone|midfield|depot|outpost)\b/g;
    // "straight to the depot ... and picked up there": the place said before "there"
    const there = ctx.match(/\b(depot|outpost|neutral\s+zone|midfield|floor)\b[^.?!]{0,60}?\b(?:picked\s+(?:it\s+|them\s+)?up|grabbed|loaded\s+up|intake[ds]?|collected)\s+(?:from\s+)?there\b/);
    if (there) { any = true; for (const [key, rr] of LOCS) if (rr.test(there[1]) && found.indexOf(key) < 0) found.push(key); }
    for (const re of [reFrom, reGo, reGo2]) {
      let mm;
      while ((mm = re.exec(ctx)) !== null) {
        const before = ctx.slice(Math.max(0, mm.index - 40), mm.index);
        // "shot from near the depot", "passed from the ...", "came back from"
        if (re === reFrom && /\b(?:shot|shoot|shooting|passed|pass|passing|lobbed|launched|came\s+back|back)\s+$/.test(before)) continue;
        if (/\b(?:pass\w*|lob\w*|fed|feed\w*)\b[^.?!]{0,20}$/.test(before) && re === reGo) continue;
        any = true;
        for (const [key, rr] of LOCS) if (rr.test(mm[0]) && found.indexOf(key) < 0) found.push(key);
      }
    }
    return { found, any };
  };
  const NO_PICK = /\b(?:no\s+(?:teleop\s+)?pick\s*ups?|did\s*n'?t\s+(?:grab|pick|intake|collect|get)\s+(?:up\s+)?(?:any(?:thing)?|fuel|balls?)|never\s+(?:grabbed|collected|intook)\s+(?:any(?:thing)?|fuel)|never\s+(?:intake[ds]?|intook|grabbed|picked\s+up|collected)\b(?!\s+(?:from|off))|teleop\s+(?:pick\s*up|intake)\s*(?:[:=-]\s*)?none|did\s*n'?t\s+pick\s+(?:anything\s+)?up|did\s+not\s+pick\s+(?:anything\s+)?up|never\s+picked\s+(?:anything\s+)?up|no\s+intake|did\s*n'?t\s+intake|pick\s*up\s*(?:[:=-]\s*)?none|intake\s*(?:[:=-]\s*)?none)\b/;
  const autoPick = pickupsIn(autoText);
  if (autoPick.any) set('AutoPickup', true);
  autoPick.found.forEach((k) => addMulti('pickupfrom', k));
  if (!autoPick.found.length && ((hasPhase('auto') && NO_PICK.test(autoText)) || /\bno\s+auto\s+pick\s*ups?\b|\bno\s+pick\s*ups?\s+(?:in|during)\s+auto\b|\bauto\s+(?:pick\s*up|intake)\s*(?:[:=-]\s*)?none\b/.test(t))) set('pickupfrom', ['NONE']);
  const telePick = pickupsIn(teleOrRest.replace(/\bno\s+auto\s+pick\s*ups?\b/g, ' '));
  telePick.found.forEach((k) => addMulti('pickupTele', k));
  if (!telePick.found.length && NO_PICK.test(teleOrRest)) set('pickupTele', ['NONE']);

  const pickupRating = rateNear(/^(?:pickup|pickups|intake|intaking|intakes|collecting|collection|pick|picking)$/);
  if (pickupRating !== null) set('pickupEffe', pickupRating);
  const passRating = rateNear(/^(?:passing|passes|pass|feeding|feeds|passer)$/);
  if (passRating !== null) set('passingEffe', passRating);

  // ---- Passing ----
  if (/\bno\s+pass(?:ing|es)?\b|\b(?:did\s+not|did\s*n'?t|never|could\s*n'?t)\s+(?:do\s+)?(?:any\s+)?(?:pass|feed)\w*\b|\bno\s+feeding\b|\bpass(?:ing)?\s*(?:[:=-]\s*)?none\b/i.test(t)) addMulti('fuelPassed', 'No_Passing');
  else {
    const PASS = '(?:pass\\w*|fed|feed\\w*|lob\\w*|shuttl\\w*|ferr\\w*|launch\\w*\\s+(?:it\\s+|balls?\\s+|fuel\\s+)?(?:over|across|into\\s+the\\s+(?:center|middle)))';
    if (new RegExp('\\b' + PASS + '\\b[^.?!]{0,30}\\b(?:center|centre|middle)\\b|\\b(?:center|centre|middle)\\b[^.?!]{0,12}\\b' + PASS).test(t)) addMulti('fuelPassed', 'Center');
    if (new RegExp('\\b' + PASS + '\\b(?:(?!cross|went|drove|ran)[^.?!]){0,60}?\\b(?:opp(?:onent)?(?:\'?s|s\')?|opposing|other|enemy|their)\\s+(?:alliance(?:\'?s|s\')?\\s+)?(?:zone|side|half)\\b|\\bopp\\s+zone\\s+pass').test(t)) addMulti('fuelPassed', 'Opp_Zone');
    if (/\blaunch\w*\s+(?:\w+\s+){0,2}into\s+the\s+(?:center|centre|middle)\b/.test(t)) addMulti('fuelPassed', 'Center');
    if (/\bscatter\w*|\bsprayed\b|\ball\s+over\s+the\s+place\b/i.test(t)) addMulti('fuelPassed', 'Scattered');
    if (/\bintentional(?:ly)?\b|\bon\s+purpose\b|\bdeliberate(?:ly)?\b|\b(?:pass\w*|feed\w*|fed)\s+(?:fuel\s+)?(?:to\s+)?(?:a|their|its)\s+(?:alliance\s+)?(?:partner|teammate)s?\b|\bto\s+(?:a|their|its)\s+(?:alliance\s+)?(?:partner|teammate)s?\b|\btargeted\s+pass/i.test(t)) addMulti('fuelPassed', 'Intentional');
  }

  // ---- Trench ----
  const tNoPath = t.replace(/\bout\s+(?:over|through|under|via)?\s*(?:the\s+)?(?:trench|bump)\b[^.?!]{0,30}?\bback\s+(?:over|through|under|via)?\s*(?:the\s+)?(?:trench|bump)\b|\btrench\s+trench\b/g, ' ').replace(/\b(?:trench|bump)\s*(?:to\s+(?:the\s+)?|-|\/|\s+(?:then|and\s+then)\s+(?:the\s+)?|\s+out\s*(?:,|and)?\s*(?:then\s+)?(?:the\s+)?)(?:trench|bump)\b(?:\s+back)?/g, ' ').replace(/\bpath\b[^.?!;|]{0,30}/g, ' ');
  if (/\btrench\b/i.test(tNoPath) && !/\b(?:can ?not|can'?t|couldn'?t|could not|no|did\s*n'?t|did not|never|too\s+(?:tall|big)\s+(?:for|to))\s+(?:fit\s+|go\s+|drive\s+|use\s+|get\s+)?(?:under\s+|through\s+|in\s+)?(?:the\s+)?trench\b|\bno\s+trench\b/i.test(t)) {
    set('TrenchRizz', true);
  }

  // ---- Defense ----
  if (/\b(tried|attempt\w*|try|trying)\b[^.?!]{0,25}\b(?:defense|defend\w*)\b|\bdefense\b[^.?!]{0,25}\b(attempt\w*)\b/i.test(t)) {
    set('robotDefended', 'Attempted');
  } else if (/\b(?:not|n't|never|no)\b(?:\s+\w+){0,4}\s+(?:played|play|playing|do|did)\s+any\s+defense\b|\b(?:no|not|never|zero|without)\s+(?:any\s+|much\s+)?(?:play(?:ing|ed)?\s+)?defense\b|\b(?:did\s*n'?t|did\s+not|never|wouldn'?t)\s+(?:play\s+|do\s+)?(?:any\s+|much\s+)?(?:defense|defend\w*)\b|\bdefense\s*\??\s*[:=-]?\s*(?:nope|none|no|nah|n\/a)\b/i.test(t)) {
    set('robotDefended', 'No');
  } else if (/\bdefense\b|\bdefend(?:ed|ing|s)?\b|\bpinn(?:ed|ing)\b|\bblock(?:ed|ing)\s+(?:shots?|them|robots?|the)\b|\bpush(?:ed|ing)?\s+(?:people|robots|others|everyone|teams|them)\s+around\b|\bbull(?:ied|ying)\b/i.test(t.replace(/\b(?:got|were|was|being|get|gets)\s+(?:defended|pinned|blocked|pushed\s+around|bullied)\b|\bdefended\s+by\b|\b(?:against|through|despite)\s+(?:heavy\s+|the\s+|their\s+)?defense\b|\bdefense\s+(?:on|against)\s+them\b|\bby\s+(?:the\s+)?(?:other|opposing|their|red|blue|opponents?'?s?)\s+(?:alliance'?s?\s+)?defense\b|\b(?:defensive|defense)\s+(?:match|game|battle)\b/g, ' '))) {
    set('robotDefended', 'Yes');
  }
  const defRating = rateNear(/^(?:defense|defended|defending|defender)$/);
  if (defRating !== null && (result.robotDefended === 'Yes' || result.robotDefended === 'Attempted')) set('defenceEffe', defRating);

  // ============================================================= CLIMBING
  // In REBUILT a robot can only reach level 1 in auto, so a level 2 or 3 climb is always
  // the endgame, wherever it was said.
  const sideOf = (ctx) => /\bleft\s+side\b|\bon\s+the\s+left\b|\bleft\s+of\s+the\s+tower\b|\bthe\s+left\b|\bleft\b(?=\s*(?:$|[;|/,.)]))|\b(?:climb\w*|l[123]|level\s*[123])\s+(?:on\s+the\s+)?left\b/.test(ctx) ? 'LS'
    : /\bright\s+side\b|\bon\s+the\s+right\b|\bright\s+of\s+the\s+tower\b|\bthe\s+right\b|\bright\b(?=\s*(?:$|[;|/,.)]))|\b(?:climb\w*|l[123]|level\s*[123])\s+(?:on\s+the\s+)?right\b/.test(ctx) ? 'RS'
      : /\b(?:middle|center|centre)\s+(?:of\s+the\s+tower|side|spot|position|of\s+it)\b|\bin\s+the\s+(?:middle|center|centre)\b|\b(?:center|centre|middle|mid)\b(?=\s*(?:$|[;|/,.)]))|\bbuddy\s+(?:center|middle)\b|\b(?:climb\w*|l[123]|level\s*[123])\s+(?:in\s+the\s+)?(?:middle|center|mid)\b|\bmiddle\s+of\s+the\s+tower\b/.test(ctx) ? 'MD' : '';
  const CLIMB_VERB = '(?:climb\\w*|hung|hang\\w*|got\\s+up(?:\\s+on)?|went\\s+up|made\\s+it\\s+(?:up\\s+)?(?:to|on|onto)?|made\\s+it\\s+up|reached|got\\s+to|got\\s+on(?:to)?|got\\s+onto)';
  let rest = t;
  const autoClimbSpans = [];
  {
    const res = [
      /\bauto\s+climb(?:s|ed|ing)?\b|\bauto\s+(?:they|it|then|and|robot)\s+climb\w*/g,
      new RegExp('\\b' + CLIMB_VERB + '(?:\\s+[a-z0-9]+){0,4}?\\s+(?:in|during)\\s+(?:the\\s+)?auto\\b', 'g'),
    ];
    for (const re of res) {
      let m;
      while ((m = re.exec(t)) !== null) {
        const tail = t.slice(m.index + m[0].length, m.index + m[0].length + 22).split(/[,.;]/)[0];
        if (/\b(?:level\s*[23]|l[23]|high|top|mid|middle)\b/.test(m[0] + ' ' + tail)) continue;
        if (/^got\s+to|^reached|^made/.test(m[0]) && !/climb|rung|tower|level|l1/.test(m[0])) continue;
        autoClimbSpans.push([m.index, m.index + m[0].length]);
      }
    }
    // a climb inside an auto stretch that started with "in auto ..." (not "4 in auto")
    for (const s of segs) {
      if (s.phase !== 'auto' || s.bound) continue;
      const seg = t.slice(s.start, s.end);
      const re = /\b(?:climb\w*|hung|hang\w*|got\s+up\s+on|made\s+it\s+up|got\s+on(?:to)?\s+the\s+tower)(?:\s+(?:the\s+)?(?:level\s*1|l1|low(?:\s+rung)?|first\s+rung|tower))?/g;
      let m;
      while ((m = re.exec(seg)) !== null) {
        const after = seg.slice(m.index + m[0].length, m.index + m[0].length + 25);
        if (/^\s*(?:(?:up\s+)?to\s+)?(?:the\s+)?(?:level\s*[23]|l[23]|high|top|mid|middle|second|third)/.test(after)) continue;
        if (m.index > 45) continue;   // far from "auto": probably the endgame
        autoClimbSpans.push([s.start + m.index, s.start + m.index + m[0].length]);
      }
    }
  }
  // a failed auto climb takes its "and slipped off" with it
  for (const span of autoClimbSpans) {
    const m = t.slice(span[1], span[1] + 45).match(/^[^.,;!?|]{0,30}?\b(?:slipped|fell|failed|missed|didn'?t\s+make\s+it|did\s+not\s+make\s+it|couldn'?t)\b(?:\s+off)?/);
    if (m) span[1] += m[0].length;
  }
  if (autoClimbSpans.length) {
    const near = autoClimbSpans.map(([a, b]) => t.slice(Math.max(0, a - 30), Math.min(t.length, b + 90)).split(/[.!?;|]/)[0]).join(' | ');
    const spans = autoClimbSpans.map(([a, b]) => t.slice(Math.max(0, a - 22), b + 70).split(/[.!?;|]/)[0]).join(' | ');
    if (/\b(?:no\s+auto\s+climb|did\s*n'?t\s+(?:try\s+to\s+)?climb|did\s+not\s+(?:try\s+to\s+)?climb|never\s+climbed|no\s+climb|not\s+attempted|n\/a|none|didn'?t\s+attempt|never\s+(?:tried|attempted)|did\s*n'?t\s+(?:even\s+)?(?:try|go\s+for)|did\s+not\s+even\s+try)\b/.test(spans)) set('autoClimbed', 'NA');
    else if (/\b(?:fail\w*|missed|fell|slipped|slid|unsuccessful|could\s*n'?t|could\s+not|did\s*n'?t\s+(?:make|get|work)|tried|attempted)\b/.test(spans)) set('autoClimbed', 'Failed');
    else set('autoClimbed', 'Success');
    const aside = sideOf(near);
    if (aside) set('autoClimbPos', aside);
    // blank the auto climb out, so it isn't read again as the endgame climb
    const chars = t.split('');
    autoClimbSpans.forEach(([a, b]) => { for (let i = a; i < b; i++) chars[i] = ' '; });
    rest = chars.join('');
  }
  if (!conf.autoClimbed && /\b(?:did\s*n'?t|did\s+not|never)\s+(?:go\s+for|try\s+for|attempt|tried|try)\s+(?:to\s+climb\s+|(?:the|a|an)\s+(?:tower|climb)\s+)?(?:in|during)\s+auto\b|\b(?:did\s*n'?t|did\s+not|never)\s+(?:even\s+)?(?:tried|try|attempt\w*)\s+(?:an?\s+)?auto\s+climb/.test(t)) set('autoClimbed', 'NA');
  if (/\bbuddy\s*climb|double\s*climb|climbed\s+(?:together|with\s+(?:a|their|an?)\s+(?:alliance\s+)?partner)\b|\bbuddy\b[^.?!]{0,20}\bclimb|\bclimb\w*[^.?!]{0,20}\bbuddy\b/i.test(t)) set('doubleClimb', true);

  const CLIMB_NONE = /\b(?:nobody|no\s+one|no\s+robots?|none)\b(?:\s+\w+){0,4}\s+climbed\b(?![^.?!]{0,30}\bexcept\s+them)|\bit\s+was(?:n'?t|\s+not)\s+them\b|\bincluding\s+them\b|\bno\s+climb\b|\bno\s+endgame\b|\bdid\s*n'?t\s+(?:even\s+)?(?:try\s+to\s+|attempt\s+(?:to\s+|a\s+)?)?climb\b|\bdid\s+not\s+(?:even\s+)?(?:try\s+to\s+|attempt\s+(?:to\s+|a\s+)?)?climb\b|\bnever\s+(?:tried\s+to\s+)?climb(?:ed)?\b|\bno\s+attempt\s+(?:to|at)\s+(?:a\s+)?climb|\bdid\s*n'?t\s+(?:go\s+for|attempt|try\s+for)\s+(?:the\s+|a\s+)?(?:tower|climb)|\bclimb\s*(?:[:=-]\s*)?(?:none|no|n\/a)\b|\bno\s+hang\b|\bdid\s*n'?t\s+hang\b/i;
  const CLIMB_FAIL = /\b(?:fell\s+(?:over|off)\s+(?:while\s+|when\s+)?(?:trying\s+to\s+)?climb\w*|tried\s+climbing|did\s*n'?t\s+make\s+it\s+up|tried\s+to\s+climb|attempted\s+(?:a\s+|to\s+)?climb|climb\w*\s+(?:attempt\s+)?fail\w*|fail\w*\s+(?:the\s+|to\s+|their\s+|at\s+)?climb\w*|fell\s+off|slipped\s+off|could\s*n'?t\s+climb|could\s+not\s+climb|unsuccessful\s+climb|missed\s+(?:the\s+)?climb|climb\s*(?:[:=-]\s*)?f\b|climb\s+(?:attempt\s+)?(?:didn'?t|did\s+not)\s+work)\b/i;
  const UP = '(?:' + CLIMB_VERB + '|got|on|to)\\s*(?:up\\s*)?(?:to\\s*)?(?:on\\s*)?(?:the\\s*)?';
  const CLIMB_L3 = new RegExp('\\blevel\\s*3\\b|\\bl3\\b|\\b(?:high|top|highest|third|upper)\\s*(?:rung|bar|level)\\b|\\b' + UP + '(?:high|top|highest)\\b|\\bhigh\\s*climb\\b|\\ball\\s+the\\s+way\\s+(?:up|to\\s+the\\s+top)\\b|\\btriple\\b', 'i');
  const CLIMB_L2 = new RegExp('\\blevel\\s*2\\b|\\bl2\\b|\\b(?:mid|middle|second)\\s*(?:rung|bar|level)\\b|\\b' + UP + '(?:mid|middle)\\b|\\bmid\\s*climb\\b', 'i');
  const CLIMB_L1 = new RegExp('\\blevel\\s*1\\b|\\bl1\\b|\\b(?:low|lowest|first|bottom)\\s*(?:rung|bar|level)\\b|\\b' + UP + '(?:low|lowest|bottom)\\b|\\blow\\s*climb\\b', 'i');

  if (CLIMB_NONE.test(rest)) set('climbed', 'No');
  else if (CLIMB_FAIL.test(rest)) set('climbed', 'F');
  else if (CLIMB_L3.test(rest)) set('climbed', 'L3');
  else if (CLIMB_L2.test(rest)) set('climbed', 'L2');
  else if (CLIMB_L1.test(rest)) set('climbed', 'L1');

  // where on the tower: the side said right next to the climb
  if (conf.climbed && /^L/.test(result.climbed)) {
    const re = /\b(?:climb\w*|hung|hang\w*|tower|rung|bar|l[123]|level\s*[123])\b/g;
    let m, side = '';
    while (!side && (m = re.exec(rest)) !== null) {
      side = sideOf(rest.slice(Math.max(0, m.index - 25), m.index + m[0].length + 40).split(/[.!?;|]/).join(' '));
    }
    if (side) set('climbPos', side, 'medium');
  }

  // how many of their alliance climbed
  {
    const m = t.match(/\b(\d)\s+(?:of\s+(?:the|our|their)\s+)?(?:alliance\s+)?(?:robots?|bots?|teams?)\s+(?:on\s+(?:the|their)\s+alliance\s+)?(?:\w+\s+)?(?:climb\w*|up\b|hung|on\s+the\s+tower)/i) ||
      t.match(/\b(?:alliance|ally)\s+climbs?\s*(?:[:=-]\s*|was\s+|of\s+)?(\d)\b/i) ||
      t.match(/\b(\d)\s*\/\s*3\s+(?:robots?\s+)?(?:climbed|climb|up)\b/i) ||
      t.match(/\b(\d)\s+(?:robots?|bots?)\s+from\s+(?:their|the|our)\s+alliance\s+(?:climb\w*|got\s+up|hung)/i) ||
      t.match(/\b(\d)\s+alliance\s+climbs?\b/i) ||
      t.match(/\b(\d)\s+of\s+(?:the\s+)?3\s+(?:robots?\s+)?(?:climbed|got\s+up)/i) ||
      t.match(/\balliance\s+up\s*[=:]?\s*(\d)\b/i) ||
      t.match(/\bonly\s+(\d)\s+(?:robots?\s+)?(?:on|of|from)\s+(?:their|the)\s+alliance\s+climbed/i) ||
      t.match(/\b(\d)\s+of\s+(?:their|the|our)\s+alliance\s+(?:climbed|got\s+up|hung)/i) ||
      t.match(/\b(\d)\s+climbs?\s+(?:for|on)\s+(?:their|the|our)\s+alliance\b/i) ||
      t.match(/\balliance\s+(?:got|had)\s+(\d)\s+(?:robots?|bots?)?\s*(?:up|climbed|on\s+the\s+tower)/i) ||
      t.match(/\b(?:just|only)\s+(\d)\s+(?:robots?|bots?)?\s*(?:up|climb\w*)\s+for\s+(?:their|the)\s+alliance/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 0 && n <= 3) set('AllianceClimb', n);
    } else if (/\b(?:all\s+(?:3|three)(?:\s+(?:robots?|bots?|teams?))?|whole\s+alliance|entire\s+alliance|everyone|everybody)\s+(?:on\s+(?:the|their)\s+alliance\s+)?(?:climb\w*|got\s+up|hung)\b|\btriple\s+climb\b/i.test(t)) set('AllianceClimb', 3);
    else if (/\b(?:nobody|no\s+one|no\s+robots?|none\s+of\s+(?:the|them|their))\b[^.?!]{0,25}\bclimb/i.test(t)) set('AllianceClimb', 0);
    else if (/\bonly\s+(?:them|they)\s+(?:climbed|got\s+up)|\bthey\s+were\s+the\s+only\s+(?:one|robot)\s+(?:to\s+)?climb/i.test(t)) set('AllianceClimb', 1);
    else if (/\bwhole\s+alliance\s+(?:up|climbed|got\s+up)/i.test(t)) set('AllianceClimb', 3);
  }

  // ---- Auto path ----
  if (/\bpre\s*-?\s*load\s*only\b|\bonly\s+(?:shot|scored|shoot|did)\s+(?:the|their|its)\s+pre\s*-?\s*load\b|\bjust\s+(?:(?:did|shot|scored)\s+)?(?:the|their|its)?\s*pre\s*-?\s*load\b|\bpre\s*-?\s*load\b[^.?!]{0,25}\b(?:and\s+that\s+was\s+it|that'?s\s+it|nothing\s+else)/i.test(t)) addMulti('AutoPath', 'Pre-Load');
  if (/\bstraight\s+to\s+(?:the\s+)?depot\b/i.test(t)) addMulti('AutoPath', 'Depot');
  if (/\bstraight\s+to\s+(?:the\s+)?outpost\b/i.test(t)) addMulti('AutoPath', 'Outpost');
  if (/\ball\s+they\s+did\s+in\s+auto\s+was\s+(?:go\s+|to\s+)?climb|\bauto\s+was\s+(?:literally\s+|just\s+|only\s+)*(?:a\s+)?climb\b/.test(t) || /\bclimb\s+only\b|\bonly\s+climbed\b|\ball\s+they\s+did\b[^.?!]{0,25}\bclimb|\bjust\s+(?:went\s+to\s+|went\s+and\s+)?climb(?:ed)?\b/i.test(autoText || '') || /\bauto\s*(?:path\s*)?(?:[:=-]\s*)?climb\s+only\b/.test(t)) addMulti('AutoPath', 'Climb');
  if (/\b(?:did\s+nothing|did\s*n'?t\s+(?:do\s+anything|move)|did\s+not\s+(?:do\s+anything|move)|never\s+moved|sat\s+(?:still|there)(?!\s+(?:and|to|while)\s+sho)|no\s+auto\b(?!\s+(?:pick|climb|scor|fuel|shot|point))|stayed\s+(?:still|put))/i.test(autoText || '') ||
      /\bno\s+auto\b(?!\s+(?:pick|climb|scor|fuel|shot|point))|\b(?:did\s*n'?t|did\s+not|never)\s+move\s+(?:in\s+|during\s+)?auto\b|\b(?:did\s+nothing|sat\s+(?:still|there))\s+(?:in|during)\s+auto\b/.test(t)) addMulti('AutoPath', 'N/A');
  if (/\bauto\s*(?:path\s*)?(?:[:=-]\s*|to\s+|went\s+(?:straight\s+)?to\s+(?:the\s+)?)outpost\b/.test(t) || (/\bauto\b/.test(t) && /\b(?:right|directly)\s+(?:over\s+)?to\s+(?:the\s+)?outpost\b/.test(autoText || ''))) addMulti('AutoPath', 'Outpost');
  if (/\b(?:right|directly)\s+(?:over\s+)?to\s+(?:the\s+)?depot\b/.test(autoText || '')) addMulti('AutoPath', 'Depot');
  if (/\bauto\s*(?:path\s*)?(?:[:=-]\s*|to\s+|went\s+(?:straight\s+)?to\s+(?:the\s+)?)depot\b/.test(t)) addMulti('AutoPath', 'Depot');
  for (const [a, b, same] of [['bump', 'bump'], ['trench', 'trench'], ['bump', 'trench'], ['trench', 'bump']]) {
    // "bump to trench", "bump-trench", "trench/trench", "trench out and bump back", "bump out, trench back"
    const re = new RegExp('\\b' + a + '\\s*(?:to\\s+(?:the\\s+)?|-|/|\\s+(?:then|and\\s+then)\\s+(?:the\\s+)?|\\s+out\\s*(?:,|and)?\\s*(?:then\\s+)?(?:the\\s+)?)' + b + '\\b(?:\\s+back)?(?:\\s+(?:on\\s+the\\s+)?(same\\s+side))?' +
      '|\\bout\\s+(?:through|over|via|under)\\s+(?:the\\s+)?' + a + '\\b[^.?!]{0,30}?\\bback\\s+(?:through|over|via|under)\\s+(?:the\\s+)?' + b + '\\b' +
      '|\\b(?:went|drove|go(?:es)?|got)\\s+(?:out\\s+)?(?:over|through|under)\\s+(?:the\\s+)?' + a + '\\b[^.?!]{0,30}?\\b(?:came|come|drove|went|got)\\s+back\\s+(?:over|through|under)\\s+(?:the\\s+)?' + b + '\\b' +
      '|\\bout\\s+(?:the\\s+)?' + a + '\\b[^.?!]{0,20}?\\bback\\s+(?:over|through|under|via)?\\s*(?:the\\s+)?' + b + '\\b' +
      '|\\b(?:the\\s+)?' + a + '\\s+and\\s+back\\s+(?:over|through|under)\\s+(?:the\\s+)?' + b + '\\b' +
      (a === b ? '|\\b(?:did|went|was|path)\\s+(?:the\\s+)?' + a + '\\s+' + a + '\\b|\\b(?:over|through|under)\\s+the\\s+' + a + '\\s+twice\\b' : ''));
    const m = re.exec(t);
    if (!m) continue;
    const key = m[1] ? ({ 'bump-bump': 'Same Side Bump', 'trench-trench': 'Same Side Trench', 'trench-bump': 'Same Side Bump/Trench', 'bump-trench': 'Same Side Trench/Bump' })[a + '-' + b]
      : ({ 'bump-bump': 'Bump/Bump', 'trench-trench': 'Trench/Trench', 'bump-trench': 'Bump-Trench', 'trench-bump': 'Trench-Bump' })[a + '-' + b];
    void same;
    addMulti('AutoPath', key);
  }

  // ---- Problems ----
  // "that robot on the other side of the field is totally broken" is about someone else
  const own = t.replace(/\b(?:that|the\s+other|another|other|opposing|opponents?'?s?|their\s+opponents?'?s?)\s+(?:robot|team|bot|alliance)\b[^.?!]{0,60}/g, ' ');
  {
    const OTHER = "(?:opposite|other|opp|opponent(?:'?s|s')?|opponents|opposing|enemy|their)\\s+(?:alliance(?:'?s|s')?\\s+)?(?:zone|side|half)\\b";
    if (new RegExp('\\b(?:cross\\w*|went|drove|go(?:es)?|got|ended\\s+up|ventured|pushed)\\s+(?:all\\s+the\\s+way\\s+)?(?:over\\s+)?(?:in(?:to)?|to|onto|over)\\s+(?:the\\s+)?' + OTHER + '|\\bcrossed\\s+(?:the\\s+)?(?:center\\s*line|midline|centerline|over)\\b|\\bcross(?:ed)?\\s+(?:into\\s+)?opp\\s+zone\\b|\\bcrossed\\s+zones?\\b|\\bcrossed\\b(?=\\s*(?:$|[;|,]))|\\bin\\s+the\\s+' + OTHER, 'i').test(t.replace(/\bpass\w*(?:(?!cross|went|drove|ran)[^.?!]){0,30}?(?:zone|side)\b/g, ' '))) set('crossedZone', true);
  }
  if (/\b(tipped|tip\s+over|tipping|fell\s+over|flipped|flipping|fell\s+on\s+(?:its|it'?s|their)\s+side|on\s+its\s+side|toppled|rolled\s+over|turtled)\b/i.test(own.replace(/\b(?:almost|nearly|close\s+to|didn'?t|did\s+not|never|without)\s+(?:\w+\s+)?(?:tipp\w*|tip\w*|fell\s+over|flipp\w*|fall(?:ing)?\s+over)/g, ' '))) set('tipped', true);
  if (/\b(bricked|brick|dead\s+bot|never\s+moved(?:\s+again|\s+all\s+match|\s+the\s+whole\s+match)?|died|dead|went\s+dead|browned\s+out|brownout|lost\s+(?:power|comms|communication|connection|signal)|disconnected|disabled|stopped\s+(?:moving|working|responding)|e-?\s?stopped|shut\s+down|froze|frozen|dc'?d|no\s+comms)\b/i.test(own)) set('died', true);
  if (/\b(mechanical|broke|broken|breaks|jam+(?:ed|ing|s)?|fell\s+apart|came\s+(?:off|loose|apart)|snapped|(?:turret|shooter|intake|arm|elevator|climber|drivetrain|wheel|hood|indexer)\s+(?:stopped|quit)\s+(?:working|turning|spinning|moving)|lost\s+(?:a\s+|its\s+|their\s+|the\s+)?(?:wheel|chain|belt|bumper|intake|arm|shooter)|bumper\s+(?:fell|came)\s+off|smok(?:e|ing|ed)|stuck\s+(?:intake|shooter)|(?:intake|shooter|arm|elevator|climber|turret)\s+(?:was\s+|got\s+)?stuck)\b/i.test(own)) {
    set('mechIssue', true);
  }

  // The raw description is always kept as the comment.
  result.co = text.trim().slice(0, 500);
  conf.co = 'high';

  return { fields: result, confidence: conf };
}

// =====================================================================
// FIELD RENDERING
// =====================================================================

// The old "AI" chip is gone by request. Confidence is still tracked, so the
// marker can come back later as a neutral review cue if the team wants one.
function confBadgeHTML(code) {
  return '';
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

function renderFieldHTML(f) {
  const val = fields[f.code];
  const reqMark = f.required ? '<span class="req">*</span>' : '';
  const helpHTML = f.help ? `<span class="field-help">${escapeHTML(f.help)}</span>` : '';
  const labelHTML = `<label class="field-label">${escapeHTML(f.title)}${reqMark} ${confBadgeHTML(f.code)}</label>${helpHTML}`;

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
        <input type="range" data-input="${f.code}" value="${val == null ? f.default : val}" min="${f.min}" max="${f.max}" step="${f.step || 1}">
        <span class="range-value" data-range-value="${f.code}">${val == null ? f.default : val}</span>
      </div>
    </div>`;
  }
  if (f.type === 'textarea') {
    return `<div data-field="${f.code}" class="field-wide">${labelHTML}<textarea data-input="${f.code}" rows="3" placeholder="${escapeHTML(f.placeholder || '')}">${escapeHTML(val || '')}</textarea></div>`;
  }
  // Big +/- pad. Scouters are watching the field, not the screen, so the
  // targets are deliberately large and the running total is the biggest thing.
  if (f.type === 'counter') {
    const steps = f.steps || [1, 5, 10];
    const minus = steps.map(n => `<button type="button" class="count-btn" data-count="${f.code}" data-delta="-${n}">&minus;${n}</button>`).join('');
    const plus = steps.map(n => `<button type="button" class="count-btn count-plus" data-count="${f.code}" data-delta="${n}">+${n}</button>`).join('');
    return `<div data-field="${f.code}" class="field-wide">${labelHTML}
      <div class="counter">
        <div class="count-value" data-count-value="${f.code}">${val == null ? 0 : val}</div>
        <div class="count-pad">${minus}${plus}</div>
      </div>
    </div>`;
  }
  // The field-layout diagram. Scouters use it to work out which of the six
  // starting slots they are looking at, so it belongs in the form itself.
  if (f.type === 'image') {
    if (!f.src) return '';
    return `<div data-field="${f.code}" class="field-wide">${labelHTML}
      <img class="field-image" src="${escapeHTML(f.src)}" alt="${escapeHTML(f.alt || f.title || '')}" loading="lazy" onerror="this.closest('[data-field]').style.display='none'">
    </div>`;
  }
  if (f.type === 'multiselect') {
    const chosen = Array.isArray(val) ? val : [];
    const chips = (f.options || []).map(o =>
      `<button type="button" class="chip ${chosen.indexOf(o.k) >= 0 ? 'chip-on' : ''}" data-multi="${f.code}" data-key="${escapeHTML(o.k)}" aria-pressed="${chosen.indexOf(o.k) >= 0}">${escapeHTML(o.v)}</button>`
    ).join('');
    return `<div data-field="${f.code}" class="field-wide">${labelHTML}<div class="chip-row">${chips}</div></div>`;
  }
  return '';
}

function renderAllFields() {
  const container = $('fields-container');
  let html = '';
  fieldGroups().forEach(g => {
    html += `<div class="section-header${g.cls ? ' ' + g.cls : ''}">${escapeHTML(g.heading)}</div>`;
    if (g.note) html += `<div class="section-note">${escapeHTML(g.note)}</div>`;
    html += `<div class="field-grid">`;
    // `hidden` fields stay in FIELD_ORDER (the Sheet still wants the column) but
    // are derived rather than typed, so don't draw them.
    g.fields.forEach(f => { if (!f.hidden) html += renderFieldHTML(f); });
    html += `</div>`;
  });
  container.innerHTML = html;
  attachFieldListeners(container);
}

// The whole form, or in way 2 (until SHOW EVERY FIELD) only the boxes the app didn't catch.
function fieldGroups() {
  if (scoutMode === '2' && gapPlan && !showAllFields) {
    // Grouped by match period, because some titles repeat ("Climbed" in auto and endgame).
    const out = [];
    const add = (codes, label, cls) => activeSections().forEach(sec => {
      const here = sec.fields.filter(f => codes.indexOf(f.code) !== -1);
      if (here.length) out.push({ heading: label + ' · ' + sec.name.toUpperCase(), fields: here, cls: cls });
    });
    add(gapPlan.must, 'STILL NEEDED', 'section-must');
    add(gapPlan.maybe, 'NOT CAUGHT, FILL IN IF IT HAPPENED', '');
    if (!out.length) out.push({ heading: 'NOTHING MISSING', fields: [], note: 'The app caught everything. Tap SHOW EVERY FIELD to check its work.' });
    return out;
  }
  return activeSections().map(sec => ({ heading: sec.name.toUpperCase(), fields: sec.fields }));
}

function attachFieldListeners(root) {
  // Inputs (text/number/select/range)
  root.querySelectorAll('[data-input]').forEach(el => {
    el.addEventListener('input', e => {
      const code = el.getAttribute('data-input');
      const field = ALL_FIELDS.find(f => f.code === code);
      let v = el.value;
      if (field.type === 'number' || field.type === 'counter') v = parseInt(v) || 0;
      if (field.type === 'range') {
        v = parseInt(v) || field.default;
        const valSpan = document.querySelector(`[data-range-value="${code}"]`);
        if (valSpan) valSpan.textContent = v;
      }
      setField(code, v);
    });
  });

  // Toggles
  root.querySelectorAll('[data-toggle]').forEach(el => {
    el.addEventListener('click', e => {
      const code = el.getAttribute('data-toggle');
      setField(code, !fields[code]);
      const toggleEl = el.querySelector('.toggle');
      if (toggleEl) toggleEl.classList.toggle('on', fields[code]);
    });
  });

  // Counter pads
  root.querySelectorAll('[data-count]').forEach(el => {
    el.addEventListener('click', () => {
      const code = el.getAttribute('data-count');
      const f = ALL_FIELDS.find(x => x.code === code) || {};
      const lo = f.min === undefined ? 0 : f.min;
      const hi = f.max === undefined ? 999 : f.max;
      const next = Math.max(lo, Math.min(hi, (parseInt(fields[code], 10) || 0) + parseInt(el.getAttribute('data-delta'), 10)));
      setField(code, next);
      const out = document.querySelector(`[data-count-value="${code}"]`);
      if (out) out.textContent = next;
    });
  });

  // Multi-select chips
  root.querySelectorAll('[data-multi]').forEach(el => {
    el.addEventListener('click', () => {
      const code = el.getAttribute('data-multi');
      const key = el.getAttribute('data-key');
      const cur = Array.isArray(fields[code]) ? fields[code].slice() : [];
      const at = cur.indexOf(key);
      if (at >= 0) cur.splice(at, 1); else cur.push(key);
      setField(code, cur);
      el.classList.toggle('chip-on', at < 0);
      el.setAttribute('aria-pressed', String(at < 0));
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

  // Starting position 1-3 is red, 4-6 is blue, so the alliance never has to be
  // asked for separately — and can't disagree with the slot.
  if (code === 'startPos') fields.alliance = slotToAlliance(value);

  updateGenerateButton();
  saveDraft();
  if (code === 'matchNumber' || code === 'startPos' || code === 'matchType' || code === 'eventKey') {
    maybeAutoFillTeam();
  }
  // Way 2: an answer can make another box matter (a climb opens "where did they climb").
  const f = ALL_FIELDS.find(x => x.code === code);
  if (scoutMode === '2' && gapPlan && !showAllFields && f && /^(select|multiselect|boolean)$/.test(f.type)) growGapPlan();
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

// Ways 2, 3 and 4 need every required box that applies; way 1 keeps its original check.
function missingForSubmit() {
  if (strictMode()) return MODES.requiredGaps(CONFIG, fields, modeCtx(), answeredNow()).map(fieldLabel);
  return getMissingRequired();
}

function updateGenerateButton() {
  updateGapsBanner();
  const btn = $('btn-generate');
  if (!btn) return;
  const missing = missingForSubmit();
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
let voiceSink = null;           // way 3 takes the words it hears, instead of the transcript box
let voicePaused = false;        // while the app is speaking, so it doesn't hear itself

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
  // Ask for a few guesses per phrase: the dictionary (scout-lexicon.js) picks the one that
  // sounds most like scouting, so "teleop" wins over "tell a cop".
  recognition.maxAlternatives = 5;

  recognition.onresult = (event) => {
    lastResultAt = Date.now();
    micRestarts = 0;
    let interim = '';
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) final += (LEXICON ? LEXICON.pickAlternative(Array.from(res)) : res[0].transcript) + ' ';
      else interim += res[0].transcript;
    }
    if (voiceSink) {
      if (!voicePaused) voiceSink(final.trim(), interim.trim());
      return;
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
    if (voicePaused) return;            // the app is speaking; resumeListening() starts it again
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
    // In guided mode, long quiet stretches are normal (waiting for the match), so only
    // warn if nothing at all has been heard yet.
    const heardSomething = voiceSink ? guide.heardAny : !!$('transcript').value.trim();
    if (quiet > 9000 && !heardSomething && !voicePaused) {
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
  voicePaused = false;
  if (recognition) { try { recognition.stop(); } catch (e) {} }
  finishRecording();
}

// Guided mode stops listening while it speaks, then starts again.
function pauseListening() {
  if (!wantRecording || voicePaused) return;
  voicePaused = true;
  try { recognition.stop(); } catch (e) {}
}
function resumeListening() {
  if (!voicePaused) return;
  voicePaused = false;
  if (!wantRecording) return;
  try { beginRecognition(); recognition.start(); }
  catch (e) {
    setTimeout(() => {
      if (!wantRecording || voicePaused) return;
      try { beginRecognition(); recognition.start(); } catch (err) { guidedStatus('The microphone stopped. Tap the answers, or press START again.', 'warn'); }
    }, 350);
  }
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
  if (guide.running) guidedStatus(msg, kind);
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
  if (guide.running) guidedStatus(msg, 'warn');
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
  // Remember which boxes the scout set by hand, so they still count as answered.
  const byHand = {};
  Object.keys(confidence).forEach(k => { if (confidence[k] === 'user') byHand[k] = 'user'; });
  const result = parseTranscript(text, fields);
  fields = result.fields;
  confidence = Object.assign(byHand, result.confidence);
  if (strictMode()) refreshDerived();
  maybeAutoFillTeam();
  renderAllFields();
  updateGenerateButton();
  saveDraft();
}

function generateOutput() {
  const missing = missingForSubmit();
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
  // Ask for the team password first, so the questions below are not asked twice.
  if (isSheetConnected() && !sheetPasscode) {
    askForPasscode('Type the team password to save this match and send it to the Sheet.', saveMatchAndNext);
    return;
  }
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
      if (res.status === 'rejected' && isWrongPasscode(res.error)) {
        // Keep it waiting on this phone, and send it once the right password is typed.
        enqueue(buildPayload(snap), sheetEndpoint);
        forgetPasscode();
        askForPasscode('That password doesn’t match the Sheet. The match is saved on this phone and goes as soon as you type the right one.', null);
      } else if (res.status === 'rejected') {
        alert('Saved on this phone, but the Sheet rejected it:\n' + res.error + '\n\nShow this message to your lead.');
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
  guidedStop();
  scoutMode = null; gapPlan = null; showAllFields = false; guidedReview = false; choosingMode = false;
  applyModeUI();
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
  guidedStop();
  scoutMode = null; gapPlan = null; showAllFields = false; guidedReview = false; choosingMode = false;
  applyModeUI();
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
  list.innerHTML = sessionMatches.map(m => {
    const parts = [`<strong>Match ${escapeHTML(m.matchNumber)}</strong>`, `Team ${escapeHTML(m.teamNumber)}`];
    if (m.alliance) parts.push(escapeHTML(String(m.alliance).toUpperCase()));
    return `<div class="row">${parts.join(' · ')}</div>`;
  }).join('');
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
    selector: '#mode-bar',
    title: '2 · Pick a way for each match',
    body: 'At the start of every match, pick how to scout it: 1 describe it, 2 talk then fill the gaps the app missed, or 3 guided, where the app asks one question at a time and listens. CHANGE WAY switches without losing anything. This tour shows way 1.'
  },
  {
    selector: '.voice-row',
    title: '3 · Describe the match',
    body: 'Tap the maroon mic and just talk — or type — in plain English. Example: "Team 177, scored 4 in auto, climbed the mid rung." No special wording needed.'
  },
  {
    selector: '#btn-process',
    title: '4 · Auto-fill the fields',
    body: 'Tap AUTO-FILL FIELDS. The app reads your description and fills in the scouting form for you automatically.'
  },
  {
    selector: '#fields-container',
    title: '5 · Review & fix',
    body: 'Check the filled values. A green "AI" badge means it was auto-filled — tap any field to correct it. Fields marked with a red * are required.'
  },
  {
    selector: '#btn-generate',
    title: '6 · Generate output',
    body: 'Once the required fields are set, tap GENERATE to get a scannable QR code (works with no internet) plus TSV and JSON for your QRScout pipeline.'
  },
  {
    selector: '#btn-sheet',
    title: '7 · Send to the Sheet (optional)',
    body: 'If your host connected a Google Sheet — tap ⚙ SHEET, or just open the link they shared — each match auto-submits here, no scanning. Offline, it queues and sends later. The dot shows the status.'
  },
  {
    selector: '#btn-help',
    title: '8 · Save & keep going',
    body: 'Use SAVE & NEXT MATCH — it saves, submits to the Sheet if connected, and bumps the match number automatically. Scout as many matches as you want — there is no limit. Reopen this walkthrough anytime from HELP.'
  }
];

let tourIndex = 0;
let tourAutoplay = false;
let tourTimer = null;
const TOUR_AUTOPLAY_MS = 4500;

function startTour() {
  if (scoutMode !== '1') chooseMode('1');     // the tour points at way 1's boxes
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

// team-config.js carries the settings for the whole team. When it is filled
// in, nobody has to configure anything on their own phone and the settings
// page is hidden — the values here win over anything stored on the device.
function teamPreset() {
  return (window.TEAM_CONFIG && typeof window.TEAM_CONFIG === 'object') ? window.TEAM_CONFIG : {};
}
function presetValue(key) {
  const v = teamPreset()[key];
  return typeof v === 'string' ? v.trim() : '';
}
function isPreset() { return !!presetValue('sheetUrl'); }

function loadSheetConfig() {
  try {
    pendingQueue = JSON.parse(localStorage.getItem('pending_submissions') || '[]');
  } catch (e) { pendingQueue = []; }
  if (isPreset()) {
    sheetEndpoint = presetValue('sheetUrl');
    // Prefer a passcode from the invite link; the preset only carries one when
    // the host decided it was fine to publish.
    let fromLink = '';
    try { fromLink = localStorage.getItem('sheet_passcode') || ''; } catch (e) {}
    sheetPasscode = presetValue('passcode') || fromLink;
    return;
  }
  try {
    sheetEndpoint = localStorage.getItem('sheet_endpoint') || '';
    sheetPasscode = localStorage.getItem('sheet_passcode') || '';
  } catch (e) {}
}

// Hide every trace of the settings page once the team preset is in place,
// so a scouter never sees a screen full of URLs and passcodes.
function applyPresetUI() {
  if (!isPreset()) return;
  const btn = $('btn-sheet');
  if (btn) btn.classList.add('hidden');
  const dlg = $('sheet-overlay');
  if (dlg) dlg.classList.add('hidden');
}

// A lead can share a link like  ...?sheet=<webAppUrl>&key=<passcode>  to auto-connect a scout's phone.
function applyUrlConfig() {
  const p = new URLSearchParams(location.search);
  const url = p.get('sheet'), key = p.get('key'), tba = p.get('tba'), gid = p.get('gid');
  let changed = false;

  // The two values that must stay out of a public repo — the passcode and the
  // Blue Alliance key — ride the invite link instead. A preset still owns the
  // address and the client ID, which are safe to publish, but it deliberately
  // does NOT own these two, so the link is what grants access.
  if (key) { try { localStorage.setItem('sheet_passcode', key); } catch (e) {} changed = true; }
  if (tba) { try { localStorage.setItem('tba_key', tba); } catch (e) {} changed = true; }

  if (!isPreset()) {
    if (url) { try { localStorage.setItem('sheet_endpoint', url); } catch (e) {} changed = true; }
    if (gid) { try { localStorage.setItem('google_client_id', gid); } catch (e) {} changed = true; }
  }
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
// field's configured min/max (set per game in config.json), or are implausibly
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
  return Object.assign(clean, extra);
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
    if (url === sheetEndpoint) {
      // Send with the password this phone knows now: it may have been retyped since this queued.
      if (!sheetPasscode) continue;                // wait until someone types it
      payload.passcode = sheetPasscode;
    }
    try {
      const resp = await jsonpSubmit(payload, undefined, url);
      if (resp && !resp.ok && url === sheetEndpoint && isWrongPasscode(resp.error)) {
        // Mistyped or changed: keep everything waiting, and ask at the next send.
        forgetPasscode();
        break;
      }
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

// ---- Team password, asked for only when it is needed ----
// The Sheet checks one team password on every row. A scouter whose link carried it (?key=)
// is never asked. Anyone else is asked the first time they send a match; the Sheet checks
// it, and the phone remembers it after that.
let afterPasscode = null;

function isWrongPasscode(error) { return /wrong passcode/i.test(String(error || '')); }

function askForPasscode(message, then) {
  afterPasscode = then || null;
  $('pass-msg').textContent = message;
  $('pass-error').classList.add('hidden');
  $('pass-input').value = '';
  $('pass-overlay').classList.remove('hidden');
  document.body.classList.add('no-scroll');
  setTimeout(() => $('pass-input').focus(), 50);
}
function closePasscodePrompt() {
  $('pass-overlay').classList.add('hidden');
  document.body.classList.remove('no-scroll');
}
function forgetPasscode() {
  sheetPasscode = '';
  try { localStorage.removeItem('sheet_passcode'); } catch (e) {}
}
function onPasscodeEntered(e) {
  e.preventDefault();
  const typed = $('pass-input').value.trim();
  if (!typed) {
    const err = $('pass-error');
    err.textContent = 'Type the password first.';
    err.classList.remove('hidden');
    return;
  }
  sheetPasscode = typed;
  try { localStorage.setItem('sheet_passcode', typed); } catch (e2) {}
  closePasscodePrompt();
  const then = afterPasscode;
  afterPasscode = null;
  flushQueue(); // anything that was waiting for the password goes now
  if (then) then();
}
function cancelPasscodePrompt() {
  afterPasscode = null;
  closePasscodePrompt();
  showSubmitStatus('Not sent yet: the Sheet needs the team password.', 'warn');
}

// ---- Explicit "Submit to Sheet" button in the output step ----
async function submitCurrentMatch() {
  const v = validateForSubmit(fields);
  if (!v.ok) { showSubmitStatus(v.error, 'err'); return; }
  if (!isSheetConnected()) { showSubmitStatus('No Sheet connected — scan the QR code, or tap ⚙ SHEET above to connect one.', 'warn'); return; }
  // Before the questions below, so they are not asked twice when this runs again.
  if (!sheetPasscode) { askForPasscode('Type the team password to send this match to the Sheet.', submitCurrentMatch); return; }
  if (googleEnabled() && !googleTokenValid()) { showSubmitStatus('Sign in with Google first — open ⚙ SHEET and tap the Google button.', 'warn'); return; }
  if (!confirmUnusual()) { showSubmitStatus('Submission paused — adjust the flagged values, or confirm to continue.', 'warn'); return; }
  showSubmitStatus('Sending to Sheet…', 'info');
  const res = await submitMatch(Object.assign({}, fields, { _id: currentMatchId }));
  if (res.status === 'sent') showSubmitStatus('✓ Saved to your Sheet (' + res.action + '). Tap SAVE & NEXT MATCH to scout your next one.', 'ok');
  else if (res.status === 'queued') showSubmitStatus('No connection right now — saved on this phone and queued. It sends automatically when you’re back online.', 'warn');
  else if (res.status === 'rejected' && isWrongPasscode(res.error)) {
    forgetPasscode();
    showSubmitStatus('Not sent: that password doesn’t match the Sheet.', 'err');
    askForPasscode('That password doesn’t match the Sheet. Check it with your lead and type it again.', submitCurrentMatch);
  }
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
    // With a team preset, the preset alone decides. A phone that once saved a Client ID must
    // not bring Google sign-in back after the team has turned it off.
    googleClientId = isPreset()
      ? presetValue('googleClientId')
      : (presetValue('googleClientId') || localStorage.getItem('google_client_id') || '');
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
// CONFIG LOADING — this season's form, shipped with the app
// =====================================================================

let defaultConfig = null;

async function fetchDefaultConfig() {
  if (defaultConfig) return defaultConfig;
  const resp = await fetch('config.json');
  if (!resp.ok) throw new Error('Failed to load config.json');
  defaultConfig = await resp.json();
  return defaultConfig;
}

// One config for everyone. The season's form lives in config.json and ships
// with the app, so every scouter is guaranteed to be on the identical form —
// there is nothing per-device to drift, and nothing for a scouter to edit.
// New game: the form is rebuilt in config.json and redeployed, once.
async function loadConfig() {
  return await fetchDefaultConfig();
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
  $('btn-process').addEventListener('click', () => (scoutMode === '2' ? checkWhatWasMissed() : processTranscript()));
  wireModes();
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
  $('pass-form').addEventListener('submit', onPasscodeEntered);
  $('btn-pass-cancel').addEventListener('click', cancelPasscodePrompt);
  $('btn-pass-close').addEventListener('click', cancelPasscodePrompt);
  $('btn-load-schedule').addEventListener('click', doLoadSchedule);
  $('btn-save-google').addEventListener('click', saveGoogleConfig);
  $('btn-google-signout').addEventListener('click', googleSignOut);
  $('sheet-overlay').addEventListener('click', e => { if (e.target === $('sheet-overlay')) closeSheetDialog(); });
  window.addEventListener('online', flushQueue);
}

// =====================================================================
// THE THREE WAYS TO SCOUT A MATCH (the thinking is in scout-modes.js)
// =====================================================================

function lastMode() {
  try { return localStorage.getItem('scout_mode_last') || '1'; } catch (e) { return '1'; }
}
function modeCtx() {
  return {
    normalizeNumbers: normalizeNumberWords,
    // On the first match of the day the match number isn't known yet; after that it counts up.
    askMatchNumber: !sessionMatches.some(m => String(m.eventKey || '') === String(fields.eventKey || ''))
  };
}
function answeredNow() {
  const a = MODES.answeredSet(CONFIG, fields, confidence, modeCtx());
  const team = teamFromSchedule();
  if (!a.teamNumber && team && String(team) === String(fields.teamNumber)) a.teamNumber = true;
  return a;
}
// Fill what can be worked out (no fuel scored: no scoring style, no shooting spot), from scratch
// each time, so changing an earlier answer changes what follows.
function refreshDerived() {
  Object.keys(confidence).forEach(k => { if (confidence[k] === 'derived') delete confidence[k]; });
  const d = MODES.derive(CONFIG, fields, answeredNow());
  Object.keys(d).forEach(k => { fields[k] = d[k]; confidence[k] = 'derived'; if (k === 'startPos') fields.alliance = slotToAlliance(d[k]); });
}

function chooseMode(mode) {
  if (scoutMode === '3' && mode !== '3') guidedStop();
  scoutMode = mode;
  choosingMode = false;
  try { localStorage.setItem('scout_mode_last', mode); } catch (e) {}
  showAllFields = false;
  if (mode === '3') guidedReady();
  applyModeUI();
  renderAllFields();
  updateGenerateButton();
  saveDraft();
  const target = mode === '3' ? $('guided-card') : $('step-describe');
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function applyModeUI() {
  const m = choosingMode ? null : scoutMode;
  const show = (id, on) => { const el = $(id); if (el) el.classList.toggle('hidden', !on); };
  show('mode-card', !m);
  show('mode-bar', !!m);
  if ($('mode-bar-name')) $('mode-bar-name').textContent = m ? MODE_NAMES[m] : '';
  const describing = m === '1' || m === '4';
  show('step-describe', describing || m === '2');
  show('ref-card', describing);
  show('guided-card', m === '3' && !guidedReview);
  const formOn = describing || (m === '2' && !!gapPlan) || (m === '3' && guidedReview);
  show('step-fields', formOn);
  show('step-output', formOn);
  show('btn-all-fields', m === '2' && !!gapPlan);
  if ($('btn-all-fields')) $('btn-all-fields').textContent = showAllFields ? 'ONLY WHAT WAS MISSED' : 'SHOW EVERY FIELD';
  const bar = document.querySelector('#step-describe .card-bar');
  if (bar) bar.textContent = m === '2' ? 'STEP 1 · TALK THROUGH THE WHOLE MATCH' : 'STEP 1 · DESCRIBE THE MATCH';
  if ($('btn-process')) $('btn-process').textContent = m === '2' ? 'DONE · CHECK WHAT I MISSED →' : 'AUTO-FILL FIELDS →';
  if ($('step-fields-title')) {
    $('step-fields-title').textContent = m === '2' && !showAllFields ? 'STEP 2 · FILL IN WHAT THE APP DIDN’T CATCH'
      : m === '3' ? 'CHECK YOUR WORK' : 'STEP 2 · REVIEW FIELDS';
  }
  const last = lastMode();
  $$('.mode-option').forEach(b => b.classList.toggle('mode-last', b.getAttribute('data-mode') === last));
  updateGapsBanner();
}

// Way 2: read everything said, then show only what's still open.
function checkWhatWasMissed() {
  processTranscript();
  refreshDerived();
  const g = MODES.gaps(CONFIG, fields, modeCtx(), answeredNow());
  gapPlan = { must: g.must.map(f => f.code), maybe: g.maybe.map(f => f.code) };
  showAllFields = false;
  applyModeUI();
  renderAllFields();
  updateGenerateButton();
  saveDraft();
  $('step-fields').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// An answer can make another box matter; add it to the list (answered boxes stay visible).
function growGapPlan() {
  const g = MODES.gaps(CONFIG, fields, modeCtx(), answeredNow());
  let added = false;
  g.must.concat(g.maybe).forEach(f => {
    if (gapPlan.must.indexOf(f.code) !== -1 || gapPlan.maybe.indexOf(f.code) !== -1) return;
    (f.required ? gapPlan.must : gapPlan.maybe).push(f.code);
    added = true;
  });
  if (added) { renderAllFields(); saveDraft(); }
}

// Ways 2 and 3: the required boxes still empty, each a link to its box.
function updateGapsBanner() {
  const el = $('gaps-banner');
  if (!el || !CONFIG) return;
  // Way 4 shows it once the scout has filled something, not as a wall of names at the start.
  const on = !choosingMode && ((scoutMode === '2' && gapPlan) || (scoutMode === '3' && guidedReview) ||
    (scoutMode === '4' && Object.keys(confidence).length > 0));
  el.classList.toggle('hidden', !on);
  if (!on) return;
  const gaps = MODES.requiredGaps(CONFIG, fields, modeCtx(), answeredNow());
  el.className = 'gaps-banner ' + (gaps.length ? 'gaps-open' : 'gaps-done');
  el.innerHTML = gaps.length
    ? '<strong>' + gaps.length + ' required ' + (gaps.length === 1 ? 'box' : 'boxes') + ' left:</strong> ' +
      gaps.map(f => `<button type="button" class="gap-chip" data-goto="${escapeHTML(f.code)}">${escapeHTML(fieldLabel(f))}</button>`).join(' ')
    : '<strong>✓ Every required box is filled.</strong> Tap GENERATE, then SUBMIT TO SHEET or SAVE &amp; NEXT MATCH.';
}

// A field's title, plus its match period when another field has the same title.
function fieldLabel(f) {
  const twin = ALL_FIELDS.some(x => x !== f && x.title === f.title);
  if (!twin) return f.title;
  const sec = activeSections().find(sc => sc.fields.indexOf(f) !== -1);
  return sec ? f.title + ' (' + sec.name + ')' : f.title;
}

function wireModes() {
  $$('.mode-option').forEach(b => b.addEventListener('click', () => chooseMode(b.getAttribute('data-mode'))));
  $('btn-mode-change').addEventListener('click', () => {
    if (guide.running) guidedPause();
    choosingMode = true;
    applyModeUI();
    $('mode-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('btn-all-fields').addEventListener('click', () => {
    showAllFields = !showAllFields;
    applyModeUI();
    renderAllFields();
  });
  $('gaps-banner').addEventListener('click', e => {
    const chip = e.target.closest('[data-goto]');
    if (!chip) return;
    const box = document.querySelector(`#fields-container [data-field="${chip.getAttribute('data-goto')}"]`);
    if (!box) return;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const input = box.querySelector('input, select, textarea, button');
    if (input) setTimeout(() => input.focus({ preventScroll: true }), 400);
  });
  // Guided
  $('btn-guided-start').addEventListener('click', guidedStart);
  $('btn-guided-back').addEventListener('click', () => guidedCommand('back'));
  $('btn-guided-repeat').addEventListener('click', () => guidedCommand('repeat'));
  $('btn-guided-skip').addEventListener('click', () => guidedCommand('skip'));
  $('btn-guided-done').addEventListener('click', () => guidedCommand('done'));
  $('guided-speak').addEventListener('change', () => {
    try { localStorage.setItem('guided_speak', $('guided-speak').checked ? 'on' : 'off'); } catch (e) {}
    if (!$('guided-speak').checked && window.speechSynthesis) speechSynthesis.cancel();
  });
  $('guided-taps').addEventListener('click', onGuidedTap);
  $('guided-taps').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); onGuidedTap({ target: $('guided-taps').querySelector('[data-gnext]') }); }
  });
}

// =====================================================================
// WAY 3 · GUIDED — one question at a time, out loud, eyes on the field
// =====================================================================

const guide = { running: false, current: null, history: [], skipped: {}, comment: '', commentTimer: null, heardAny: false, advanceTimer: null, lastSpoken: '' };
const COMMENT_PAUSE_MS = 2500;   // this long without talking ends a comment

function guidedReady() {
  guidedReview = false;
  guide.running = false;
  $('guided-intro').classList.remove('hidden');
  $('guided-run').classList.add('hidden');
  $('guided-progress').textContent = '';
  $('btn-guided-start').textContent = Object.keys(confidence).length ? 'CARRY ON' : 'START';
  try { $('guided-speak').checked = localStorage.getItem('guided_speak') !== 'off'; } catch (e) {}
}

function guidedStart() {
  Object.assign(guide, { running: true, current: null, comment: '', heardAny: false });
  guide.history = [];
  guide.skipped = {};
  $('guided-intro').classList.add('hidden');
  $('guided-run').classList.remove('hidden');
  unlockSpeech();
  voiceSink = onGuidedHeard;
  if (window.SpeechRecognition || window.webkitSpeechRecognition) startRecording();
  else guidedStatus('This browser can’t listen (iPhone: use Safari). Tap the answers instead.', 'warn');
  guidedNext();
}

// Stop everything without finishing (a new match, or another way chosen).
function guidedStop() {
  clearTimeout(guide.commentTimer);
  clearTimeout(guide.advanceTimer);
  const was = guide.running;
  guide.running = false;
  voiceSink = null;
  if (was && wantRecording) stopRecording();
  if (window.speechSynthesis) { try { speechSynthesis.cancel(); } catch (e) {} }
}
// CHANGE WAY in the middle: stop listening; START (CARRY ON) picks up where it left off.
function guidedPause() {
  guidedStop();
  guidedReady();
}

function questionPosition(q) {
  const ctx = modeCtx(), answered = answeredNow();
  const all = MODES.questions(CONFIG).filter(x => x.fields.some(f => MODES.needed(f, fields, ctx, answered)));
  const at = all.findIndex(x => x.id === q.id);
  return (at < 0 ? all.length : at + 1) + ' of ' + all.length;
}

function guidedNext(prefix) {
  clearTimeout(guide.advanceTimer);
  clearTimeout(guide.commentTimer);
  refreshDerived();
  const q = MODES.nextQuestion(CONFIG, fields, answeredNow(), guide.skipped, modeCtx());
  guide.current = q;
  guide.comment = '';
  if (!q) { guidedFinish(prefix); return; }
  $('guided-progress').textContent = '· ' + questionPosition(q);
  $('guided-section').textContent = String(q.section || '').toUpperCase();
  $('guided-question').textContent = q.ask;
  $('guided-say').textContent = q.say ? 'Say: ' + q.say : '';
  $('guided-heard').textContent = '';
  $('guided-heard').className = 'guided-heard';
  renderGuidedTaps(q);
  // Options are read out too, so the scout never has to look down to know what to say.
  const readSay = q.say && /select|boolean|flags|range/.test(q.kind);
  speak((prefix ? prefix + ' ' : '') + q.ask + (readSay ? ' ' + q.say + '.' : ''));
}

function onGuidedHeard(final, interim) {
  if (!guide.running || !guide.current) return;
  if (final || interim) guide.heardAny = true;
  const q = guide.current;
  const live = ((guide.comment ? guide.comment + ' ' : '') + (final || interim || '')).trim();
  if (live) { $('guided-heard').textContent = '“' + live + '”'; $('guided-heard').className = 'guided-heard'; }
  if (!final) return;
  if (MODES.isEcho(final, guide.lastSpoken)) return;   // the app hearing its own question
  const cmd = MODES.command(final);
  if (q.kind === 'textarea' && cmd !== 'back' && cmd !== 'repeat') { onCommentHeard(final, cmd); return; }
  if (cmd) { guidedCommand(cmd); return; }
  // The answer is read after the dictionary fixes misheard game words ("deep oh" -> depot).
  const res = MODES.answer(q, LEXICON ? LEXICON.fix(final) : final, modeCtx());
  // Anything else mentioned is only taken alongside a real answer: words that don't fit the
  // question shouldn't quietly fill other boxes ("while driving" alone isn't auto or teleop).
  if (res) { applyGuidedAnswer(q, res, noteExtras(final, q)); return; }
  $('guided-heard').textContent = '“' + final + '” — didn’t catch an answer.';
  $('guided-heard').className = 'guided-heard guided-miss';
  speak(q.say ? 'Say ' + q.say + '.' : 'Say that again?');
}

// Comments run on until a pause, or "next" / "I'm done". "None" ends them at once.
function onCommentHeard(final, cmd) {
  const q = guide.current;
  if (cmd === 'skip' || cmd === 'done') { commitComment(cmd === 'done'); return; }
  if (!guide.comment) {
    const quick = MODES.answer(q, final, modeCtx());
    if (quick && quick.values[q.fields[0].code] === 'None') { applyGuidedAnswer(q, quick, []); return; }
  }
  guide.comment = (guide.comment + ' ' + final).trim();
  $('guided-heard').textContent = '“' + guide.comment + '”';
  clearTimeout(guide.commentTimer);
  guide.commentTimer = setTimeout(() => commitComment(false), COMMENT_PAUSE_MS);
}
function commitComment(thenFinish) {
  clearTimeout(guide.commentTimer);
  const q = guide.current;
  if (!q || q.kind !== 'textarea') return;
  const text = guide.comment.trim();
  guide.comment = '';
  if (text) {
    Object.keys(MODES.answer(q, text, modeCtx()).values).forEach(code => setField(code, text));
    guide.history.push(q.id);
  } else {
    guide.skipped[q.id] = true;
    guide.history.push(q.id);
  }
  if (thenFinish) guidedFinish();
  else guidedNext(text ? 'Got it.' : 'Skipped.');
}

// Anything else the scout mentioned that the form hasn't got yet ("…and they climbed level two").
function noteExtras(final, q) {
  const clause = MODES.extraClause(final);
  if (!clause) return [];
  const answered = answeredNow();
  const own = q.fields.map(f => f.code);
  const r = parseTranscript(clause, fields);
  const notes = [];
  Object.keys(r.confidence).forEach(code => {
    if (code === 'co' || own.indexOf(code) !== -1 || answered[code]) return;
    const f = ALL_FIELDS.find(x => x.code === code);
    // Not the same question for another period: "while driving" for auto says nothing about teleop.
    if (!f || f.hidden || MODES.twinOf(q, f)) return;
    setField(code, r.fields[code]);
    const v = r.fields[code];
    notes.push(fieldLabel(f) + ': ' + (Array.isArray(v) ? v.join(', ') : (typeof v === 'boolean' ? (v ? 'yes' : 'no') : v)));
  });
  return notes;
}

function applyGuidedAnswer(q, res, extras) {
  Object.keys(res.values).forEach(code => setField(code, res.values[code]));
  guide.history.push(q.id);
  delete guide.skipped[q.id];
  $('guided-heard').textContent = '✓ ' + res.said;
  $('guided-heard').className = 'guided-heard guided-got';
  $('guided-noted').textContent = extras && extras.length ? 'Also noted: ' + extras.join(' · ') : '';
  clearTimeout(guide.advanceTimer);
  guide.advanceTimer = setTimeout(() => guidedNext(res.said + '.'), 500);
}

function guidedCommand(cmd) {
  const q = guide.current;
  if (cmd === 'repeat') { if (q) speak(q.ask + (q.say ? ' ' + q.say + '.' : '')); return; }
  if (cmd === 'done') { if (q && q.kind === 'textarea' && guide.comment) { commitComment(true); return; } guidedFinish(); return; }
  if (cmd === 'skip') {
    if (!q) return;
    if (q.kind === 'textarea' && guide.comment) { commitComment(false); return; }
    guide.skipped[q.id] = true;
    guide.history.push(q.id);
    guidedNext('Skipped.');
    return;
  }
  if (cmd === 'back') {
    const prev = guide.history.pop();
    if (!prev) { speak('That was the first question.'); return; }
    // Open the previous question again: forget its answer, and that it was skipped.
    const pq = MODES.questions(CONFIG).find(x => x.id === prev);
    const fresh = initialFieldState();
    if (pq) pq.fields.forEach(f => { delete confidence[f.code]; fields[f.code] = fresh[f.code]; });
    delete guide.skipped[prev];
    guidedNext('Going back.');
  }
}

function guidedFinish(prefix) {
  guidedStop();
  guidedReview = true;
  refreshDerived();
  applyModeUI();
  renderAllFields();
  updateGenerateButton();
  saveDraft();
  const left = missingForSubmit().length;
  speak((prefix ? prefix + ' ' : '') + (left
    ? 'Done. ' + left + ' required ' + (left === 1 ? 'box is' : 'boxes are') + ' still empty. Check the form.'
    : 'Done. Check your answers, then submit.'), true);
  $('gaps-banner').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function guidedStatus(msg, kind) {
  const el = $('guided-status');
  if (!el) return;
  $('guided-status-text').textContent = msg;
  el.className = 'mic-status ' + (kind === 'warn' ? 'mic-status-warn' : 'mic-status-live');
}

// Tapping is always an option: buttons for choices, a box for numbers and words.
function renderGuidedTaps(q) {
  const f = q.fields[0], g = MODES.GUIDE[f.code] || {};
  let h = '';
  if (q.kind === 'select') {
    h = (f.options || []).filter(o => o.k !== '').map(o => `<button type="button" class="gtap" data-gtap="${escapeHTML(o.k)}">${escapeHTML(o.v)}</button>`).join('');
  } else if (q.kind === 'boolean') {
    h = g.invert
      ? '<button type="button" class="gtap" data-gtap="false">Showed up</button><button type="button" class="gtap" data-gtap="true">No-show</button>'
      : '<button type="button" class="gtap" data-gtap="true">Yes</button><button type="button" class="gtap" data-gtap="false">No</button>';
  } else if (q.kind === 'range') {
    const vals = [];
    for (let v = Number(f.min) || 0; v <= Number(f.max); v += Number(f.step) || 1) vals.push(v);
    h = vals.map(v => `<button type="button" class="gtap" data-gtap="${v}">${v}${Number(f.max) === 100 ? '%' : ''}</button>`).join('');
  } else if (q.kind === 'multiselect' || q.kind === 'flags') {
    const items = q.kind === 'flags' ? q.fields.map(x => ({ k: x.code, v: x.title })) : (f.options || []);
    h = items.map(o => `<button type="button" class="gchip chip" data-gchip="${escapeHTML(o.k)}">${escapeHTML(o.v)}</button>`).join('') +
      (q.kind === 'flags' ? '<button type="button" class="gtap" data-gnone="1">None of these</button>' : '') +
      '<button type="button" class="btn btn-primary gnext" data-gnext="1">NEXT →</button>';
  } else if (q.kind === 'number') {
    h = `<input type="number" inputmode="numeric" class="ginput" data-ginput="1" min="${f.min === undefined ? 0 : f.min}" ${f.max === undefined ? '' : 'max="' + f.max + '"'}>` +
      '<button type="button" class="btn btn-primary gnext" data-gnext="1">NEXT →</button>';
  } else {
    h = (q.kind === 'textarea' ? '<textarea class="ginput" data-ginput="1" rows="2"></textarea>' : '<input type="text" class="ginput" data-ginput="1">') +
      '<button type="button" class="btn btn-primary gnext" data-gnext="1">NEXT →</button>';
  }
  $('guided-taps').innerHTML = h;
  $('guided-noted').textContent = '';
}

function onGuidedTap(e) {
  const q = guide.current;
  const t = e.target && e.target.closest ? e.target.closest('[data-gtap], [data-gchip], [data-gnext], [data-gnone]') : null;
  if (!q || !t) return;
  const f = q.fields[0];
  if (t.hasAttribute('data-gchip')) { t.classList.toggle('chip-on'); return; }
  let values = {}, said = '';
  if (t.hasAttribute('data-gnone')) {
    q.fields.forEach(x => { values[x.code] = false; });
    said = 'none of them';
  } else if (t.hasAttribute('data-gtap')) {
    const raw = t.getAttribute('data-gtap');
    values[f.code] = q.kind === 'boolean' ? raw === 'true' : (q.kind === 'range' ? Number(raw) : raw);
    said = t.textContent;
  } else {
    if (q.kind === 'flags') {
      const on = Array.from($('guided-taps').querySelectorAll('[data-gchip].chip-on')).map(b => b.getAttribute('data-gchip'));
      q.fields.forEach(x => { values[x.code] = on.indexOf(x.code) !== -1; });
      said = on.length ? q.fields.filter(x => on.indexOf(x.code) !== -1).map(x => x.title).join(', ') : 'none of them';
    } else if (q.kind === 'multiselect') {
      const on = Array.from($('guided-taps').querySelectorAll('[data-gchip].chip-on')).map(b => b.getAttribute('data-gchip'));
      if (!on.length) { guidedCommand('skip'); return; }
      values[f.code] = on;
      said = on.map(k => ((f.options || []).find(o => o.k === k) || { v: k }).v).join(', ');
    } else {
      const input = $('guided-taps').querySelector('[data-ginput]');
      const raw = input ? input.value.trim() : '';
      if (!raw) { guidedCommand('skip'); return; }
      const res = q.kind === 'number' ? MODES.answer(q, raw, modeCtx()) : { values: { [f.code]: raw }, said: raw };
      if (!res) { $('guided-heard').textContent = 'That number is out of range.'; return; }
      values = res.values; said = res.said;
    }
  }
  applyGuidedAnswer(q, { values: values, said: said }, []);
}

// Speech out. Browsers only allow it after a tap, so START unlocks it.
let speechUnlocked = false;
function unlockSpeech() {
  if (speechUnlocked || !window.speechSynthesis) return;
  try { speechSynthesis.speak(new SpeechSynthesisUtterance('')); speechUnlocked = true; } catch (e) {}
}
function speakingOn() {
  return !!(window.speechSynthesis && $('guided-speak') && $('guided-speak').checked);
}
// Speaks, with the microphone paused so the app doesn't hear itself, unless a headset is
// in use: then the question goes to the scout's ear, not into the mic, so they can answer
// over it. Resolves when done.
function usingHeadset() { return HEADSET_HINT.test(micDeviceLabel || ''); }
function speak(text, finalWords) {
  return new Promise(resolve => {
    if (!text || !speakingOn()) return resolve();
    guide.lastSpoken = text;
    const overTheTop = usingHeadset();
    if (!finalWords && !overTheTop) pauseListening();
    if (guide.running) guidedStatus(overTheTop ? '🔊 Asking… you can answer any time' : '🔊 Asking… (the mic is off while the app talks)', 'live');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      setTimeout(() => {
        resumeListening();
        if (guide.running && wantRecording) guidedStatus('🎙 Your turn. Listening…', 'live');
        resolve();
      }, 200);
    };
    const timer = setTimeout(finish, 2000 + text.length * 70);   // some browsers never say they finished
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 1.08;
      u.onend = finish;
      u.onerror = finish;
      speechSynthesis.speak(u);
    } catch (e) { finish(); }
  });
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
      transcript: $('transcript') ? $('transcript').value : '',
      mode: scoutMode,
      gapPlan: gapPlan,
      guidedReview: guidedReview
    }));
  } catch (e) {}
}

function loadDraft() {
  try {
    const raw = localStorage.getItem('bobcat_draft');
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !d.fields) return null;
    fields = Object.assign(initialFieldState(), d.fields);
    confidence = d.confidence || {};
    if (d.matchId) currentMatchId = d.matchId;
    scoutMode = d.mode || null;
    gapPlan = d.gapPlan || null;
    guidedReview = !!d.guidedReview;
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

let reloadingForUpdate = false;
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('service-worker.js').catch(() => {});
  // A new version of the app just took over. Load it now, so nobody keeps scouting on an
  // old copy, unless someone is mid-recording: then offer it instead. The draft is saved,
  // so a reload loses nothing.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloadingForUpdate) return;
    if (wantRecording || guide.running) { showUpdateBanner(); return; }
    reloadingForUpdate = true;
    saveDraft();
    location.reload();
  });
}
function showUpdateBanner() {
  if ($('update-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'update-banner';
  bar.className = 'update-banner';
  bar.innerHTML = 'A new version of Bobcat Scout is ready. <button type="button" class="btn btn-gold">LOAD IT</button>';
  bar.querySelector('button').addEventListener('click', () => { saveDraft(); location.reload(); });
  document.body.appendChild(bar);
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
// Starting slot 1-6 is the whole answer: 1-3 is red 1-3, 4-6 is blue 1-3.
function slotToAlliance(slot) {
  const n = parseInt(slot, 10);
  if (n >= 1 && n <= 3) return 'red';
  if (n >= 4 && n <= 6) return 'blue';
  return '';
}
function slotToStation(slot) {
  const n = parseInt(slot, 10);
  return n >= 1 && n <= 6 ? ((n - 1) % 3) + 1 : 0;
}

// The team the match schedule puts in this match and starting position, or null.
function teamFromSchedule() {
  if (!scheduleCache) return null;
  if (scheduleCache.event !== String(fields.eventKey || '').toLowerCase()) return null;
  if (fields.matchType !== 'qm') return null;
  const m = scheduleCache.matches[String(fields.matchNumber)];
  if (!m) return null;
  const arr = m[slotToAlliance(fields.startPos)];
  if (!arr) return null;
  return arr[slotToStation(fields.startPos) - 1] || null;
}

function maybeAutoFillTeam() {
  const team = teamFromSchedule();
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
      auto: () => !!presetValue('eventKey') || !!ls('event_key'),
      body: `<p>The event code tells the spreadsheet which competition this data belongs to. Your host will give it to you. It looks like <code>2026ctwat</code>, which is the year plus a short code for the event.</p>
             <p class="setup-dim">If the host sent you a setup link, this is probably already filled in.</p>`,
      input: { key: 'event_key', field: 'eventKey', label: 'Event code', placeholder: 'e.g. 2026ctwat' }
    },
    {
      id: 'connect',
      title: 'Check you are connected',
      time: '10 sec',
      auto: () => (isPreset() && (!!presetValue('passcode') || !!ls('sheet_passcode'))) || (!isPreset() && !!ls('sheet_endpoint')),
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

function setupSteps() {
  // With the team preset in place the host work is already done in code,
  // so everyone who opens the app is a scouter.
  if (isPreset()) return SETUP_TRACKS.scouter;
  return SETUP_TRACKS[setupState.role] || [];
}
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
  if (isPreset() && !setupState.role) setupState.role = 'scouter';
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
    const on = isPreset() || !!ls('sheet_endpoint');
    const needsKey = isPreset() && !presetValue('passcode') && !ls('sheet_passcode');
    cs.className = 'setup-state ' + (on && !needsKey ? 'setup-state-ok' : 'setup-state-warn');
    cs.textContent = needsKey
      ? 'Almost. Open the invite link your host sent you — it carries the team passcode. Without it your matches will be turned away.'
      : on
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
  if (scoutMode !== '1') chooseMode('1');
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
  const back = $('btn-setup-back');
  if (isPreset()) back.classList.add('hidden');
  back.addEventListener('click', () => {
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
    const ek = presetValue('eventKey') || localStorage.getItem('event_key');
    if (ek) fields.eventKey = ek;
    const sm = localStorage.getItem('session_matches');
    if (sm) sessionMatches = JSON.parse(sm);
  } catch(e) { console.warn('Restore failed', e); }

  // Restore an in-progress match draft (survives a refresh or crash)
  const draft = loadDraft();

  // Match schedule (optional) for team-number auto-fill
  loadCachedSchedule();
  try {
    const tk = presetValue('tbaKey') || localStorage.getItem('tba_key');
    const ek = String(fields.eventKey || '').toLowerCase();
    if (tk && ek && navigator.onLine && (!scheduleCache || scheduleCache.event !== ek)) {
      loadSchedule(tk, ek).then(maybeAutoFillTeam).catch(() => {});
    }
  } catch (e) {}

  if (scoutMode === '3' && !guidedReview) guidedReady();   // a guided match interrupted by a reload
  renderAllFields();
  wireUI();
  applyModeUI();
  if (draft && draft.transcript) { $('transcript').value = draft.transcript; resetTranscriptBuffer(); }
  updateProcessButton();
  updateGenerateButton();
  updateSessionBar();
  updateSheetStatus();
  flushQueue();
  initGoogleSignIn();
  registerServiceWorker();
  applyPresetUI();
  wireSetup();
  refreshSetupUI();
}

document.addEventListener('DOMContentLoaded', init);
