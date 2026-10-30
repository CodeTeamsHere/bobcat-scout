'use strict';
/* Builds practice-data.js: real past matches for the scout trainer (the PRACTICE button).
 *
 *   node tools/build-practice.js [event key ...]        (default: 2026cthar 2026ctwat)
 *
 * For each chosen qualification match it keeps the alliance's three teams, the match video, and the
 * official answers from The Blue Alliance's score breakdown: the alliance's auto and teleop fuel counts
 * and each robot's climbs. Nothing here is secret (it is all public Blue Alliance data), but the Blue
 * Alliance read key is needed to fetch it: set TBA_KEY, or it is read from the Analytics app's settings.
 *
 * After Kickoff the game changes: write the new game's mapping in GAME below and rebuild, like the
 * form (CHANGE-IT.md). The trainer itself (trainer-core.js, trainer.js) only knows "counts per alliance"
 * and "choices per robot", so it needs no change.
 */
const fs = require('fs');
const path = require('path');

const events = process.argv.slice(2).length ? process.argv.slice(2) : ['2026cthar', '2026ctwat'];
const PER_EVENT = 6;

// ---- the game: which official numbers the trainer checks (REBUILT 2026) ----
const GAME = {
  name: 'REBUILT 2026',
  counts: [
    { code: 'autoFuel', label: 'Auto: fuel scored', hint: 'Count fuel that goes into the hub during the first 20 seconds.', official: (sb) => sb.hubScore && sb.hubScore.autoCount },
    { code: 'teleFuel', label: 'Teleop: fuel scored', hint: 'Count fuel that goes into the hub after auto, including the endgame.', official: (sb) => sb.hubScore && sb.hubScore.teleopCount },
  ],
  robotChoices: [
    { code: 'autoClimb', label: 'Auto climb', options: [{ k: 'NA', v: 'No climb' }, { k: 'Success', v: 'Climbed' }],
      official: (sb, n) => ({ Level1: 'Success' }[sb['autoTowerRobot' + n]] || 'NA') },
    { code: 'climb', label: 'Endgame climb', options: [{ k: 'No', v: 'No climb' }, { k: 'L1', v: 'Level 1' }, { k: 'L2', v: 'Level 2' }, { k: 'L3', v: 'Level 3' }, { k: 'F', v: 'Tried and failed' }],
      official: (sb, n) => ({ Level1: 'L1', Level2: 'L2', Level3: 'L3' }[sb['endGameTowerRobot' + n]] || 'No') },
  ],
  // matches a beginner can count by hand: not hundreds of fuel
  maxAuto: 26, maxTele: 70,
};

function tbaKey() {
  if (process.env.TBA_KEY) return process.env.TBA_KEY;
  const cfg = path.join(__dirname, '..', '..', 'bobcat-scout-analytics', 'analytics-config.js');
  const m = fs.readFileSync(cfg, 'utf8').match(/tbaKey['"]?\s*:\s*['"]([A-Za-z0-9]+)['"]/);
  if (!m) throw new Error('No Blue Alliance key: set TBA_KEY');
  return m[1];
}

async function get(p, key) {
  const r = await fetch('https://www.thebluealliance.com/api/v3' + p, { headers: { 'X-TBA-Auth-Key': key } });
  if (!r.ok) throw new Error('TBA ' + r.status + ' for ' + p);
  return r.json();
}

function difficulty(counts, climbs) {
  const total = counts.reduce((s, c) => s + c, 0);
  if (!climbs && total <= 30) return 'easy';
  if (total <= 60) return 'medium';
  return 'harder';
}

(async () => {
  const key = tbaKey();
  const matches = [];
  for (const ev of events) {
    const info = await get('/event/' + ev + '/simple', key);
    const all = (await get('/event/' + ev + '/matches', key)).filter((m) => m.comp_level === 'qm' && m.score_breakdown && (m.videos || []).some((v) => v.type === 'youtube'));
    const cands = [];
    for (const m of all) for (const al of ['red', 'blue']) {
      const sb = m.score_breakdown[al];
      const counts = GAME.counts.map((c) => c.official(sb));
      if (counts.some((c) => c == null)) continue;
      if (counts[0] > GAME.maxAuto || counts[1] > GAME.maxTele || counts[0] + counts[1] < 6) continue;
      const robots = m.alliances[al].team_keys.map((tk, i) => ({ team: tk.replace('frc', ''), answers: Object.fromEntries(GAME.robotChoices.map((c) => [c.code, c.official(sb, i + 1)])) }));
      const climbs = robots.filter((r) => r.answers.climb !== 'No' || r.answers.autoClimb !== 'NA').length;
      cands.push({ m, al, counts, robots, climbs });
    }
    // a spread: some with climbs, some without, from across the event; the same selection every run
    const withClimb = cands.filter((c) => c.climbs > 0), without = cands.filter((c) => !c.climbs);
    const pick = (list, n) => { const step = Math.max(1, Math.floor(list.length / n)); const out = []; for (let i = 0; i < list.length && out.length < n; i += step) out.push(list[i]); return out; };
    const chosen = pick(withClimb, Math.ceil(PER_EVENT / 2)).concat(pick(without, PER_EVENT)).slice(0, PER_EVENT);
    chosen.sort((a, b) => a.m.match_number - b.m.match_number);
    console.log(ev, '(' + info.name + '):', cands.length, 'usable alliances;', chosen.length, 'chosen');
    for (const c of chosen) {
      matches.push({
        id: ev + '-q' + c.m.match_number + '-' + c.al,
        event: ev, eventName: info.name, match: c.m.match_number, alliance: c.al,
        video: c.m.videos.find((v) => v.type === 'youtube').key,
        level: difficulty(c.counts, c.climbs),
        teams: c.robots.map((r) => r.team),
        answers: { counts: Object.fromEntries(GAME.counts.map((g, i) => [g.code, c.counts[i]])), robots: c.robots.map((r) => ({ team: r.team, choices: r.answers })) },
      });
    }
  }
  const order = { easy: 0, medium: 1, harder: 2 };
  matches.sort((a, b) => order[a.level] - order[b.level] || a.id.localeCompare(b.id));
  const data = {
    game: GAME.name, made: new Date().toISOString().slice(0, 10),
    counts: GAME.counts.map(({ code, label, hint }) => ({ code, label, hint })),
    robotChoices: GAME.robotChoices.map(({ code, label, options }) => ({ code, label, options })),
    matches,
  };
  const out = path.join(__dirname, '..', 'practice-data.js');
  fs.writeFileSync(out, '/* Real past matches for the scout trainer. Made by tools/build-practice.js from The Blue Alliance\'s public data; do not edit by hand. */\nwindow.PRACTICE = ' + JSON.stringify(data, null, 1) + ';\n');
  console.log('wrote practice-data.js:', matches.length, 'matches (' + matches.map((m) => m.level).join(', ') + ')');
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
