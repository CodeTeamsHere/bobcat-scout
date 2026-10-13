/* ==========================================================================
   BOBCAT SCOUT — the robotics dictionary for speech
   --------------------------------------------------------------------------
   Browser speech recognition is trained on everyday English, not on FRC. In a
   loud arena it hears "teleop" as "tele op" or "teleport", "depot" as "depo",
   "high rung" as "high wrong", "red two" as "read to", and "four in auto" as
   "for in auto". Every one of those quietly empties a box on the form.

   This file fixes the transcript before the form is filled:
     1. fix(text)          rewrites misheard words into the game's words, using
                           the words around them so real English is left alone
                           ("go to the depot" keeps its "to"; "red to" becomes
                           "red two").
     2. pickAlternative()  speech recognition can offer several guesses for the
                           same words; this picks the one that sounds most like
                           scouting.
     3. PHRASES            the game's words, handed to browsers that let a page
                           bias recognition toward expected phrases.

   A new game needs its own words here, the same way the parser in app.js needs
   new patterns. Keep corrections narrow: a rule that rewrites a real word in
   the wrong place does more harm than the mishearing it fixes. Every rule has
   a test in tools/test-voice.js.
   ========================================================================== */
(function (root) {
  'use strict';

  // ---- Always-safe rewrites: these misspellings never mean anything else in a match note ----
  // [pattern, replacement], applied in order, whole words, case-insensitive.
  var ALWAYS = [
    // teleop
    [/\btele[\s-]+op(?:erated)?\b/g, 'teleop'],
    [/\b(?:telly|telli|tely|tella|telle|tell)[\s-]*op\b/g, 'teleop'],
    [/\b(?:telop|tellop|teliop|telyop|teleopp|teleops|tele-op's|teleop's)\b/g, 'teleop'],
    [/\bteleport(?:ed)?\b/g, 'teleop'],
    [/\b(?:tele|telly|telle)[\s-]*up\b/g, 'teleop'],
    [/\btele[\s-]+operat\w*\b/g, 'teleop'],
    [/\btell\s+a\s+op\b/g, 'teleop'],
    // auto
    [/\b(?:otto|autto|audo|ottoh|auto's|autos)\b/g, 'auto'],
    [/\b(in|during|for|of)\s+(?:the\s+)?(?:audio|odo|oughta|otter)\b/g, '$1 auto'],
    [/\bauton(?:omous|omus|amous|imous)\b/g, 'auto'],
    [/\bauto\s+period\b/g, 'auto'],
    // endgame
    [/\bend[\s-]+game\b/g, 'endgame'],
    // depot
    [/\b(?:depo|deppo|deepo|depoe|depos|depots|deepot|deep\s+oh|deep\s+o|de\s+po|deep\s+pot|the\s+depot's)\b/g, 'depot'],
    [/\b(?:depot's)\b/g, 'depot'],
    // outpost
    [/\b(?:out[\s-]+post|outposts|outpust|outpost's|out\s+posts)\b/g, 'outpost'],
    // trench
    [/\b(?:french|tranch|tranche|trenches|trench's|trentch|tench)\b/g, 'trench'],
    // hub
    [/\b(?:hubs|hub's|hob|hubb)\b/g, 'hub'],
    // fuel
    [/\b(?:fuels|fuel's|feul|fule|fool|fools|fuell|fewel|fual)\b/g, 'fuel'],
    // climb
    [/\b(?:clime|climbe|clyme|climed)\b/g, 'climb'],
    [/\b(?:climed|clymed|climbd)\b/g, 'climbed'],
    [/\b(?:climing|climbin)\b/g, 'climbing'],
    // defense
    [/\b(?:the|da|de)\s+fence\b/g, 'defense'],
    [/\b(?:defence|defens|defense's|deffense|defnse)\b/g, 'defense'],
    [/\bdefens(?:ive|ively)\b/g, 'defense'],
    // human player
    [/\bhuman\s+(?:layer|prayer|players|playa|plaier|play\s+er)\b/g, 'human player'],
    // intake
    [/\b(?:in[\s-]+take|intakes|in[\s-]+took|intook|intaked)\b/g, 'intake'],
    // neutral zone
    [/\b(?:natural|new\s+tral|nutral|neutral)\s+(?:zones?|soon|zoom|sewn|zon|own)\b/g, 'neutral zone'],
    // no show
    [/\b(?:know|no)[\s-]+show(?:ed)?\b/g, 'no show'],
    // tower
    [/\btowers\b/g, 'tower'],
    // bump
    [/\b(?:bumps|bum|bomb|bunp)\b/g, 'bump'],
    // brownout
    [/\bbrown[\s-]+(?:out|outs|outed|dout)\b/g, 'browned out'],
    // event codes spelled out letter by letter: "2026 c t w a t" -> 2026ctwat
    [/\b(20\d{2})\s+((?:[a-z]\s+){2,9}[a-z])\b/g, function (m, y, letters) { return y + letters.replace(/\s+/g, ''); }],
    // "a hundred and ten" -> one hundred ten
    [/\ba\s+hundred\b/g, 'one hundred'],
    [/\bhundred\s+and\s+(?=(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b)/g, 'hundred '],
    // "D" for defense: "no D", "played D", "D was solid", "D rating"
    [/\b(no|played|play|plays|playing|good|great|solid|bad|tried|tried\s+to\s+play|did|on)\s+d\b/g, '$1 defense'],
    [/\bd\s+(?=(?:was|is|rating|all|eff|effectiveness)\b|\()/g, 'defense '],
    // sides of the tower, misheard: "lift side", "write side", "the metal of the tower"
    [/\blift\s+side\b/g, 'left side'], [/\b(?:write|wright|rite)\s+side\b/g, 'right side'],
    [/\b(?:metal|meddle|medal)\s+of\s+the\s+tower\b/g, 'middle of the tower'],
    // "stationery" is how speech recognition spells stationary
    [/\bstationery\b/g, 'stationary'],
    // typed: "WD" = while driving
    [/\bwd\b/g, 'while driving'],
    [/\bfor\s+d\b/g, 'for defense'],
    // more mishearings heard in testing
    [/\bd[\s-]+fence\b/g, 'defense'],
    [/\b(play|played|plays|playing)\s+d\b/g, '$1 defense'],
    [/\b(under|through|in)\s+the\s+trend\b/g, '$1 the trench'],
    [/\bpump\b/g, 'bump'],
    [/\bthe\s+trend\b/g, 'the trench'],
    [/\b(?:free|pree|pre)[\s-]*load(?:ed)?\b/g, 'preload'],
    [/\b(?:go|went|going)\s+for\s+the\s+power\b/g, 'go for the tower'],
    [/\bprac\b/g, 'practice'],
    [/\bctr\b/g, 'center'],
    [/\bautonomist\b/g, 'auto'],
    [/\b(in|into|at)\s+the\s+(?:hug|hob|hut|hum|pub)\b/g, '$1 the hub'],
    [/\bauto\s+(?:nomous|nomus|gnomous)\b/g, 'auto'],
    [/\bswords?\b/g, 'scored'],
    [/\b(?:clammed|climed|clymed|climbd|claimed)\b(?=[^.?!]{0,30}\b(?:rung|level|l[123]|tower|high|mid|low|top)\b|\s*$)/g, 'climbed'],
    [/\b(?:clammed|climed|clymed)\b/g, 'climbed'],
    [/\bside\s+of\s+the\s+power\b/g, 'side of the tower'],
    [/\bplay[\s-]+offs?\b/g, 'playoff'],
    [/\b(?:in|during)\s+(?:telly|tele|telle|tely)\b(?!\s*op)/g, 'in teleop'],
    [/\bno[\s-]*show\b/g, 'no show'],
    // typed shorthand: "frc2876", "sp3", "pos4", "PM12", "ev 2026x"
    [/\bsp\s?([1-6])\b/g, 'position $1'],
    [/\bpm\s?(\d{1,3})\b/g, 'practice match $1'],
    [/(^|[;|,]\s*|\s[-–]\s*)a\s+(\d{1,2})\s*(?=$|[;|,]|\s[-–]\s)/g, '$1auto $2'],
    [/(^|[;|,]\s*|\s[-–]\s*)t\s+(\d{1,2})\s*(?=$|[;|,]|\s[-–]\s)/g, '$1teleop $2'],
    // "the pot bin", "from the pot" -> depot
    [/\b(?:the\s+)?pot\s+bin\b/g, 'the depot bin'],
    [/\b(from|at|to|by|near)\s+the\s+pot\b/g, '$1 the depot'],
    // "got up on the power" -> tower ("lost power" is left alone)
    [/\b(up\s+on|onto|on|up|climbed|climb)\s+the\s+power\b/g, '$1 the tower'],
    // "lost comes" -> lost comms
    [/\blost\s+(?:comes|calms|combs|coms|calm)\b/g, 'lost comms'],
    // "cool fifty" -> qual fifty
    [/\b(?:cool|quail|kwal|call)\s+(?=(?:\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b)/g, 'qual '],
    // typed symbols
    [/\s*(?:&|\+)\s*/g, ' and '],
    [/\s*(?:->|=>|→)\s*/g, ' to '],
    // shorthand people type
    [/\bpu\b/g, 'pickup'],
    [/\bdep\b/g, 'depot'],
    [/\bacc\b/g, 'accuracy'],
    [/\bally\s+(?=climb)/g, 'alliance '],
    [/\bdef\b/g, 'defense'],
    [/\bnz\b/g, 'neutral zone'],
    [/\btele\b(?!\s*op)/g, 'teleop'],
    [/\bauton\b/g, 'auto']
  ];

  // ---- Rung and level wording ----------------------------------------------------------------
  // "high wrong", "the top run", "level tree", "el two", "l to", "else 3"
  var LEVEL_WORD = { one: '1', won: '1', '1': '1', two: '2', to: '2', too: '2', '2': '2',
    three: '3', tree: '3', free: '3', '3': '3' };
  var LEVEL_RULES = [
    [/\b(high|top|mid|middle|low|bottom)\s+(?:wrong|rang|run|wrung|rong|rungs)\b/g, '$1 rung'],
    [/\b(first|second|third)\s+(?:wrong|rang|wrung|rong)\b/g, '$1 rung'],
    [/\b(?:level|levels|lvl|leveled)\s*(one|won|two|to|too|three|tree|free|[123])\b/g, function (m, n) { return 'level ' + LEVEL_WORD[n]; }],
    [/\b(?:l|el|elle|ell|l\.)\s*-?\s*(one|won|two|to|too|three|tree|free|[123])\b(?!\s*(?:zone|minutes?|seconds?))/g,
      function (m, n) { return 'l' + LEVEL_WORD[n]; }]
  ];

  // ---- Alliance and station ------------------------------------------------------------------
  // "read to" -> red two, "blew won" -> blue one. Only when a station number or "alliance"
  // follows, so "read the manual" and "the motor blew" are left alone.
  var STATION = '(one|won|two|to|too|three|tree|free|[1-3]|alliance|side|station|start)';
  var ALLIANCE_RULES = [
    [new RegExp('\\b(?:read|redd|rhett|rad|wred)\\s+' + STATION + '\\b', 'g'), 'red $1'],
    [new RegExp('\\b(?:blew|bloo|blu|blues)\\s+' + STATION + '\\b', 'g'), 'blue $1'],
    // "red won" is a station unless it ends the thought ("the score was 112 to 98, red won")
    [/\b(red|blue)\s+won\b/g, function (m, side, at, all) {
      var talksScore = /\b\d+\s*(?:to|-)\s*\d+\b|\bscore\b|\bfinal\b|\bwon\s+by\b/.test(all);
      var endsThought = /^\s*(?:$|[,.;!?]|the\b|by\b|it\b|that\b|again\b|easily\b|anyway\b)/.test(all.slice(at + m.length));
      return talksScore && endsThought ? m : side + ' one';
    }],
    [/\b(red|blue)\s+(?:to|too)\b/g, '$1 two'],
    [/\b(red|blue)\s+(?:tree|free)\b/g, '$1 three'],
    // typed shorthand: r2, b3, red2
    [/\b(?:r|red)\s*-?\s*([1-3])\b(?!\s*(?:%|percent))/g, 'red $1'],
    [/\b(?:b|blue)\s*-?\s*([1-3])\b(?!\s*(?:%|percent))/g, 'blue $1']
  ];

  // ---- Numbers that sound like words ---------------------------------------------------------
  // Rewritten to the number WORD, so "team won seventy seven" still joins into 177 later.
  var SOUNDS = { won: 'one', to: 'two', too: 'two', for: 'four', fore: 'four', ate: 'eight',
    tree: 'three', free: 'three', sicks: 'six', sex: 'six', nein: 'nine', tin: 'ten', fiver: 'five' };
  // A number is expected right after these words: "team won seventy seven", "scored for".
  var CUE_BEFORE = /^(team|teams|match|number|station|position|slot|spot|scored|score|scores|made|makes|shot|shoots|sank|sunk|hit|dumped|landed|launched|banked|about|maybe|probably|roughly|exactly|qual|grabbed|collected|intook|intake|scooped|put|round)$/;
  // ...or right before these: "for balls", "ate fuel", "to in auto".
  var CUE_AFTER = /^(balls?|fuel|pieces?|shots?|points?|percent|cycles?|robots?|bots?|climbs?)$/;
  // A word after which the sound-alike is a real word: "went to", "looking for".
  var REAL_BEFORE = /^(go|goes|went|got|get|gets|going|way|back|up|down|over|close|next|due|able|tried|try|tries|want|wanted|had|has|have|used|need|needs|needed|look|looked|looking|seemed|seems|began|started|chose|decided|managed|failed|forgot|headed|heading|drove|drive|drives|came|come|comes|aimed|aiming|waited|waiting|reached|ran|run|runs|moved|moving|it|them|this|that|also|just|only|like|and|then|so)$/;
  // ...and after which it is: "for the", "to them".
  var REAL_AFTER = /^(the|a|an|their|its|his|her|our|my|them|it|that|this|us|me|him|you|get|go|be|do|make|score|shoot|pick|climb|drive|move|play|defend|feed|pass|intake|cross|help|stop|try|see|keep|stay|start|end|win|block|grab|collect|reach|load|park|hang|dump|launch|feed)$/;

  function fixNumbers(text) {
    var parts = text.split(/(\s+)/);
    var idx = [];
    for (var i = 0; i < parts.length; i++) if (parts[i] && !/^\s+$/.test(parts[i])) idx.push(i);
    var bare = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9%]/g, ''); };
    for (var k = 0; k < idx.length; k++) {
      var raw = parts[idx[k]];
      var w = bare(raw);
      if (!SOUNDS.hasOwnProperty(w)) continue;
      var prevRaw = k > 0 ? parts[idx[k - 1]] : '';
      var prev = /[,.;!?]$/.test(prevRaw) ? '' : bare(prevRaw);
      var next = k + 1 < idx.length ? bare(parts[idx[k + 1]]) : '';
      var next2 = k + 2 < idx.length ? bare(parts[idx[k + 2]]) : '';
      // A counted noun right after wins over everything but a verb of going: "got won robot up".
      var strongAfter = CUE_AFTER.test(next) && w !== 'to' && w !== 'too' &&
        !/^(go|goes|went|going|headed|heading|drove|way|looking|look|looked|aimed|aiming)$/.test(prev);
      // "all for of them", "grabbed for from the depot"
      var countOf = (next === 'of' && prev === 'all') ||
        (next === 'from' && /^(grabbed|collected|scooped|intook|picked|got|took)$/.test(prev));
      // after "station", "position", "red", "blue", "team" or "match" a number is certain
      var strongBefore = /^(station|position|red|blue|team|match|qual|slot)$/.test(prev) && w !== 'for';
      if (!strongAfter && !countOf && !strongBefore && (REAL_BEFORE.test(prev) || REAL_AFTER.test(next))) continue;
      // "fifty for" -> fifty four (a tens word then a sound-alike unit)
      var afterTens = /^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)$/.test(prev) && /^(won|for|fore|ate|tree|free|sicks|sex|nein)$/.test(w);
      // an answer that opens with one: "too fifty four", "won seventy seven"
      var leadsNumber = prev === '' && k === 0 && /^(oh|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)$/.test(next);
      var ok = leadsNumber || afterTens || strongAfter || countOf || CUE_BEFORE.test(prev) ||
        CUE_AFTER.test(next) ||
        // "for in auto", "to during teleop"
        ((next === 'in' || next === 'during') && /^(auto|teleop|endgame)$/.test(next2));
      if (ok) parts[idx[k]] = raw.replace(new RegExp(w, 'i'), SOUNDS[w]);
    }
    return parts.join('');
  }

  // ---- Words that are often misheard in front of a number ------------------------------------
  var LEAD_RULES = [
    // "teen 177" / "tim 254" -> team
    [/\b(?:teen|tim|teem|tame|teams|teamed|teamd)\s+(?=(?:number\s+)?(?:\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b)/g, 'team '],
    // "much 14", "mash 9", "matches 12" -> match
    [/\b(?:much|mash|matt|mats|matches|matched)\s+(?=(?:number\s+)?(?:\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b)/g, 'match '],
    // typed "q14", "qm 14", "m14" -> match 14
    [/\b(?:qm|q)\s*-?\s*(\d{1,3})\b/g, 'match $1'],
    [/\bm(\d{1,3})\b/g, 'match $1'],
    // "station to" etc handled by numbers; "pos 2" -> position 2
    [/\bpos\.?\s*(?=\d)/g, 'position '],
    // "qualifier 51", "elim 4", "playoff round 15"
    [/\bqualifier\b/g, 'qualification']
  ];

  // Filler that breaks phrase matching ("climbed uh the high rung"), and "like" / "so" in
  // front of a number or a place ("shot like 20", "from like the depot").
  var FILLER = /\b(?:um+|uh+|uhm|er+m?|ah+|hmm+|you know|i mean|kinda|sort of)\b[,]?\s*/g;
  var SOFT_FILLER = /\b(?:like|so|maybe\s+like)\s+(?=(?:\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|the|a)\b)/g;

  function applyRules(text, rules) {
    for (var i = 0; i < rules.length; i++) text = text.replace(rules[i][0], rules[i][1]);
    return text;
  }

  /* Rewrite a transcript into the game's words. Lowercases it: the parser does too. */
  function fix(text) {
    var t = String(text || '').toLowerCase();
    t = t.replace(FILLER, '').replace(SOFT_FILLER, '');
    t = applyRules(t, ALWAYS);
    t = applyRules(t, LEVEL_RULES);
    t = applyRules(t, ALLIANCE_RULES);
    t = applyRules(t, LEAD_RULES);
    t = fixNumbers(t);
    // a level word that became a number word after "level": "level two" is fine as it is
    return t.replace(/[ \t]{2,}/g, ' ').trim();
  }

  // ---- The game's words, for picking between recognition guesses and for biasing --------------
  var VOCAB = ('team match red blue alliance station position auto autonomous teleop endgame scored score shot ' +
    'shooting made fuel ball balls hub depot outpost chute human player floor ground neutral zone midfield ' +
    'trench bump tower climb climbed climbing rung level high mid middle low l1 l2 l3 buddy double ' +
    'defense defended defending passing passed pass feeding intake pickup picked stationary driving moving ' +
    'died disabled tipped flipped broke broken jammed mechanical no show preload sweep percent accuracy ' +
    'left right side center opposite zone scattered intentional').split(' ');
  var VOCAB_SET = {};
  VOCAB.forEach(function (w) { VOCAB_SET[w] = 1; });

  // How much a transcript sounds like scouting: game words, plus numbers.
  function score(text) {
    var w = String(text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
    var s = 0;
    for (var i = 0; i < w.length; i++) {
      if (VOCAB_SET[w[i]]) s += 1;
      else if (/^\d+$/.test(w[i])) s += 0.5;
    }
    return s;
  }

  /* Pick among speech recognition's guesses ([{transcript, confidence}]). The first guess
     wins unless another one is clearly more about the game. */
  function pickAlternative(alts) {
    if (!alts || !alts.length) return '';
    var best = alts[0], bestScore = score(fix(alts[0].transcript)) + 0.6;
    for (var i = 1; i < alts.length; i++) {
      var s = score(fix(alts[i].transcript));
      if (s > bestScore) { best = alts[i]; bestScore = s; }
    }
    return best.transcript;
  }

  // Phrases a scout says, for browsers that support recognition biasing.
  var PHRASES = ['teleop', 'in auto', 'autonomous', 'endgame', 'depot', 'outpost', 'human player', 'neutral zone',
    'trench', 'bump', 'hub', 'fuel', 'tower', 'climbed', 'level one', 'level two', 'level three', 'L1', 'L2', 'L3',
    'high rung', 'mid rung', 'low rung', 'red one', 'red two', 'red three', 'blue one', 'blue two', 'blue three',
    'played defense', 'no show', 'while driving', 'stationary', 'buddy climb', 'tipped over', 'browned out',
    'scored', 'picked up', 'intake', 'passing', 'match', 'team'];

  root.SCOUT_LEXICON = { fix: fix, score: score, pickAlternative: pickAlternative, PHRASES: PHRASES, VOCAB: VOCAB };
})(typeof window !== 'undefined' ? window : globalThis);
