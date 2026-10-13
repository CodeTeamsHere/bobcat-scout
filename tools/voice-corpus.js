/* Makes thousands of made-up match descriptions, each with the form values it should give.
 *
 * Used by tools/test-voice.js. Every description is built from a random match (team,
 * station, counts, climb, ...) said in one of many ways, then said again the way speech
 * recognition hands it back: no punctuation, numbers as words, game words misheard
 * ("tele op", "depo", "high wrong", "read to"), filler ("um", "like"). The same seed
 * always makes the same set, so a score can be compared run to run.
 */
'use strict';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const UNITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEENS = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function say2(n) {               // 0..99
  if (n < 10) return UNITS[n];
  if (n < 20) return TEENS[n - 10];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + UNITS[n % 10] : '');
}
// Team numbers the way people say them: 177 "one seventy seven", 1114 "eleven fourteen",
// 254 "two fifty four", 4 "four", 3146 "thirty one forty six", 1100 "eleven hundred".
function sayTeam(n) {
  if (n < 100) return say2(n);
  const s = String(n);
  if (n < 1000) {
    const h = Math.floor(n / 100), r = n % 100;
    if (r === 0) return UNITS[h] + ' hundred';
    return UNITS[h] + ' ' + (r < 10 ? 'oh ' + UNITS[r] : say2(r));
  }
  const a = Math.floor(n / 100), b = n % 100;
  if (b === 0) return say2(a) + ' hundred';
  return say2(a) + ' ' + (b < 10 ? 'oh ' + UNITS[b] : say2(b));
}

const RATE = {
  5: ['amazing', 'great', 'excellent', 'really good', 'awesome', 'perfect'],
  4: ['pretty good', 'solid', 'strong', 'consistent'],
  3: ['decent', 'okay', 'average', 'fine'],
  2: ['bad', 'poor', 'weak', 'rough'],
  1: ['terrible', 'awful', 'horrible'],
};
const LOC = {
  DEPOT: ['the depot', 'depot'],
  H_Player: ['the outpost', 'the human player', 'the outpost chute', 'the human player station'],
  FLOOR: ['the floor', 'the ground', 'off the floor', 'off the ground'],
  MID: ['the neutral zone', 'midfield', 'the middle of the field', 'the neutral zone in the middle'],
};

function build(r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const chance = (p) => r() < p;
  const int = (a, b) => a + Math.floor(r() * (b - a + 1));
  const expect = {};
  const absent = [];
  const parts = [];   // [{text, phase}] in speaking order

  // ---- identity
  const team = pick([int(1, 99), int(100, 999), int(1000, 9999), int(1000, 9999), 177, 254, 1114, 2056, 118]);
  const match = int(1, 90);
  const red = chance(0.5);
  const st = int(1, 3);
  const ally = red ? 'red' : 'blue';
  const pos = String(red ? st : st + 3);
  const id = [];
  if (chance(0.9)) { id.push(pick([`team ${team}`, `scouting team ${team}`, `team number ${team}`, `robot ${team}`, `${team}`])); expect.teamNumber = team; }
  if (chance(0.8)) { id.push(pick([`match ${match}`, `match number ${match}`, `qualification match ${match}`, `qual ${match}`])); expect.matchNumber = match; }
  if (chance(0.85)) {
    id.push(pick([`${ally} ${st}`, `on ${ally} ${st}`, `${ally} alliance ${st}`, `${ally} station ${st}`, `starting position ${pos}`, `position ${pos}`]));
    expect.startPos = pos; expect.alliance = ally;
  }
  // the first two parts in any order: "team 177 match 14 red 2" or "match 14, 177 red 2"
  if (chance(0.4)) id.reverse();
  if (id.length) parts.push({ text: id.join(pick([' ', ', ', ' '])), phase: 'id' });

  if (chance(0.04)) {
    parts.push({ text: pick(['no show', 'they were a no show', 'they never showed up', 'robot did not show up']), phase: 'end' });
    expect.noShow = true;
    return { parts, expect, absent: ['teleopFuelScored', 'climbed'] };
  }

  // ---- auto
  if (chance(0.8)) {
    const n = chance(0.15) ? 0 : int(1, 20);
    if (n === 0) {
      parts.push({ text: pick(['no fuel scored in auto', 'they did not score in auto', 'nothing in auto', 'zero in auto']), phase: 'auto' });
      expect.autoFuelScored = 0;
      absent.push('AutoScored');
    } else {
      parts.push({ text: pick([`${n} in auto`, `in auto they scored ${n}`, `scored ${n} in auto`, `auto they made ${n}`,
        `${n} fuel in auto`, `during auto they shot ${n}`, `in autonomous they scored ${n}`, `auto was ${n}`, `they made ${n} during auto`]), phase: 'auto' });
      expect.autoFuelScored = n; expect.AutoScored = true;
      if (chance(0.35)) {
        const m = pick(['STATIONARY', 'WHILE_DRIVE']);
        parts.push({ text: m === 'STATIONARY' ? pick(['shooting while stationary', 'from a stop', 'while stationary', 'standing still'])
          : pick(['shooting while driving', 'while moving', 'on the move', 'while driving']), phase: 'auto', glue: true });
        expect.scoringMannerismAuto = m;
      }
    }
    if (chance(0.4)) {
      const locs = [pick(['DEPOT', 'H_Player', 'FLOOR', 'MID'])];
      if (chance(0.3)) { const l2 = pick(['DEPOT', 'H_Player', 'FLOOR', 'MID']); if (locs.indexOf(l2) < 0) locs.push(l2); }
      const verb = pick(['picked up from', 'grabbed fuel from', 'picked up fuel from', 'collected from', 'intaked from']);
      parts.push({ text: `${chance(0.5) ? 'in auto they ' : 'and '}${verb} ${locs.map((l) => pick(LOC[l]).replace(/^off /, '')).join(' and ')}`, phase: 'auto' });
      expect.AutoPickup = true; expect.pickupfrom = locs;
    }
    if (chance(0.12)) {
      const ok = chance(0.7);
      parts.push({ text: ok ? pick(['they climbed in auto', 'and climbed in auto', 'auto climb was successful', 'they did an auto climb'])
        : pick(['failed the climb in auto', 'auto climb failed', 'they missed the auto climb']), phase: 'auto' });
      expect.autoClimbed = ok ? 'Success' : 'Failed';
    }
  }

  // ---- teleop
  if (chance(0.85)) {
    const n = int(0, 40);
    parts.push({ text: pick([`${n} in teleop`, `teleop they scored ${n}`, `scored ${n} in teleop`, `in teleop they made ${n}`,
      `${n} fuel in teleop`, `during teleop they shot ${n}`, `teleop ${n}`, `they put ${n} in during teleop`]), phase: 'tele' });
    expect.teleopFuelScored = n;
    if (chance(0.35)) {
      const m = pick(['STATIONARY', 'WHILE_DRIVE', 'BOTH']);
      parts.push({ text: m === 'STATIONARY' ? pick(['shooting while stationary', 'while stationary', 'from a stop'])
        : m === 'WHILE_DRIVE' ? pick(['shooting while driving', 'while moving', 'on the move'])
          : pick(['both stationary and while driving', 'while stationary and while driving']), phase: 'tele', glue: true });
      expect.scoringMannerismTele = m;
    }
    if (chance(0.25)) { const p = int(2, 19) * 5; parts.push({ text: pick([`about ${p} percent accuracy`, `${p} percent of shots went in`, `accuracy was ${p} percent`]), phase: 'tele' }); expect.scoringEffe = p; }
  }
  if (chance(0.45)) {
    const locs = [pick(['DEPOT', 'H_Player', 'FLOOR', 'MID'])];
    if (chance(0.35)) { const l2 = pick(['DEPOT', 'H_Player', 'FLOOR', 'MID']); if (locs.indexOf(l2) < 0) locs.push(l2); }
    const verb = pick(['picked up from', 'picked up fuel from', 'grabbed from', 'collected from', 'got fuel from']);
    parts.push({ text: `${pick(['in teleop they ', 'teleop they ', 'during teleop they '])}${verb} ${locs.map((l) => pick(LOC[l]).replace(/^off /, '')).join(' and ')}`, phase: 'tele' });
    expect.pickupTele = locs;
    if (!expect.pickupfrom) absent.push('pickupfrom');
  }
  if (chance(0.25)) { const v = int(1, 5); parts.push({ text: pick([`pickup was ${pick(RATE[v])}`, `their intake was ${pick(RATE[v])}`, `${pick(RATE[v])} intake`]), phase: 'tele' }); expect.pickupEffe = v; }
  if (chance(0.25)) {
    const kind = pick(['none', 'Center', 'Intentional', 'Opp_Zone']);
    if (kind === 'none') { parts.push({ text: pick(['no passing', 'they did not pass', 'never passed']), phase: 'tele' }); expect.fuelPassed = ['No_Passing']; }
    else {
      parts.push({ text: kind === 'Center' ? pick(['passed to the center', 'passing to the center']) : kind === 'Intentional' ? pick(['passed intentionally', 'intentional passes'])
        : pick(['passed into the opponent zone', 'passing into the opp zone']), phase: 'tele' });
      expect.fuelPassed = [kind];
      if (chance(0.6)) { const v = int(1, 5); parts.push({ text: `passing was ${pick(RATE[v])}`, phase: 'tele' }); expect.passingEffe = v; }
    }
  }
  if (chance(0.2)) { parts.push({ text: pick(['went under the trench', 'drove under the trench', 'went through the trench', 'used the trench']), phase: 'tele' }); expect.TrenchRizz = true; }
  if (chance(0.3)) {
    const d = pick(['Yes', 'Yes', 'No', 'Attempted']);
    if (d === 'Yes') {
      if (chance(0.6)) { const v = int(1, 5); parts.push({ text: pick([`played ${pick(RATE[v])} defense`, `defense was ${pick(RATE[v])}`]), phase: 'tele' }); expect.defenceEffe = v; }
      else parts.push({ text: pick(['played defense', 'played defense most of the match', 'they were on defense']), phase: 'tele' });
    } else if (d === 'No') parts.push({ text: pick(['no defense', 'did not play defense']), phase: 'tele' });
    else parts.push({ text: pick(['tried to play defense', 'attempted defense']), phase: 'tele' });
    expect.robotDefended = d;
  } else absent.push('robotDefended');

  // ---- endgame
  if (chance(0.75)) {
    const c = pick(['L1', 'L2', 'L3', 'L3', 'No', 'F']);
    const say = {
      L1: ['climbed level 1', 'climbed low', 'got the low rung', 'climbed to L1', 'climbed the low rung'],
      L2: ['climbed level 2', 'climbed mid', 'got the mid rung', 'climbed to L2', 'climbed the middle rung'],
      L3: ['climbed level 3', 'climbed high', 'got the high rung', 'climbed to L3', 'climbed the top rung'],
      No: ['no climb', 'did not climb', 'never climbed'],
      F: ['tried to climb and fell off', 'failed the climb', 'climb failed'],
    }[c];
    if (!(expect.autoClimbed && (c === 'F'))) {
      parts.push({ text: pick(say), phase: 'end' });
      expect.climbed = c;
    }
    if (chance(0.25)) { const k = int(0, 3); parts.push({ text: k === 3 ? pick(['3 robots climbed', 'all 3 robots climbed']) : `${k} robots climbed`, phase: 'end' }); expect.AllianceClimb = k; }
  }
  if (chance(0.08)) { parts.push({ text: pick(['robot died', 'they died at the end', 'lost power halfway through', 'robot was disabled']), phase: 'end' }); expect.died = true; }
  if (chance(0.06)) { parts.push({ text: pick(['tipped over', 'they fell over', 'flipped on the bump']), phase: 'end' }); expect.tipped = true; }
  if (chance(0.08)) { parts.push({ text: pick(['intake jammed', 'had a mechanical issue', 'something broke']), phase: 'end' }); expect.mechIssue = true; }
  if (!expect.died) absent.push('died');
  return { parts, expect, absent };
}

// ---- How it reaches the parser --------------------------------------------------------------
function written(parts) {
  let s = '';
  parts.forEach((p, i) => {
    if (i === 0) s = p.text;
    else s += (p.glue ? ' ' : '. ') + p.text;
  });
  return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

const MISHEAR = [
  [/\bteleop\b/g, ['tele op', 'teleport', 'telly op', 'tele-op', 'teleop', 'teleop']],
  [/\bauto\b/g, ['auto', 'auto', 'auto', 'otto']],
  [/\bdepot\b/g, ['depo', 'deep oh', 'depot', 'depot']],
  [/\boutpost\b/g, ['out post', 'outpost']],
  [/\btrench\b/g, ['french', 'trench', 'trench']],
  [/\bdefense\b/g, ['the fence', 'defense', 'defense']],
  [/\brung\b/g, ['wrong', 'rung', 'rung']],
  [/\bhuman player\b/g, ['human layer', 'human player']],
  [/\bneutral zone\b/g, ['natural zone', 'neutral zone']],
  [/\bred\b/g, ['read', 'red', 'red', 'red']],
  [/\bblue\b/g, ['blew', 'blue', 'blue', 'blue']],
  [/\bl([123])\b/g, ['l $1', 'el $1', 'l$1']],
];
const SOUND_ALIKE = { 1: ['won', 'one'], 2: ['to', 'too', 'two'], 3: ['three', 'tree'], 4: ['for', 'four'], 8: ['ate', 'eight'] };

function spoken(parts, r, level) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  let s = parts.map((p) => p.text).join(' ').toLowerCase();
  // numbers become words most of the time
  s = s.replace(/\b(team(?: number)?|robot|scouting team)\s+(\d+)/g, (m, lead, n) => lead + ' ' + (r() < 0.7 ? sayTeam(+n) : n));
  s = s.replace(/\b\d+\b/g, (n) => {
    if (r() < 0.35) return n;
    const v = +n;
    if (v <= 9 && SOUND_ALIKE[v] && r() < level) return pick(SOUND_ALIKE[v]);
    return v < 100 ? say2(v) : sayTeam(v);
  });
  if (level > 0) {
    MISHEAR.forEach(([re, alts]) => {
      s = s.replace(re, (m, g1) => {
        if (r() > level * 1.4) return m;
        return pick(alts).replace('$1', g1 ? (r() < 0.5 ? g1 : UNITS[+g1]) : '');
      });
    });
  }
  // filler: "um" and "uh" anywhere, "like" in front of a number or a place
  s = s.split(' ').map((w) => (r() < 0.04 ? pick(['um', 'uh']) + ' ' + w
    : r() < 0.06 && /^(\d+|the|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty)$/.test(w) ? 'like ' + w : w)).join(' ');
  return s;
}

function typed(parts, r) {
  // terse notes: "177 r2 q14 4 auto 18 tele L2"
  return parts.map((p) => p.text).join(r() < 0.5 ? ', ' : ' ')
    .replace(/\bteleop\b/g, () => (r() < 0.5 ? 'tele' : 'teleop'))
    .replace(/\b(red|blue) (\d)\b/g, (m, a, n) => (r() < 0.5 ? a[0] + n : m))
    .replace(/\bmatch (\d+)\b/g, (m, n) => (r() < 0.5 ? 'q' + n : m))
    .replace(/\bdefense\b/g, (m) => (r() < 0.5 ? 'def' : m));
}

function generate(count, seed) {
  const r = rng(seed || 177);
  const out = [];
  for (let i = 0; i < count; i++) {
    const c = build(r);
    const style = i % 4 === 0 ? 'written' : i % 4 === 1 ? 'spoken' : i % 4 === 2 ? 'misheard' : 'typed';
    const text = style === 'written' ? written(c.parts) : style === 'spoken' ? spoken(c.parts, r, 0)
      : style === 'misheard' ? spoken(c.parts, r, 0.45) : typed(c.parts, r);
    out.push({ id: 'g' + i, style, text, expect: c.expect, absent: c.absent.filter((a) => c.expect[a] === undefined) });
  }
  return out;
}

module.exports = { generate, sayTeam, say2 };
