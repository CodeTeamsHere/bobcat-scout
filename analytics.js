/* ==========================================================================
   BOBCAT SCOUT — Analytics & Strategy engine (runs entirely in the browser)
   --------------------------------------------------------------------------
   Phase 1  structure last season's / this event's per-robot records
   Phase 2  capability score (points + consistency + reliability) and OPR
            (Offensive Power Rating via ridge least-squares linear algebra)
   Phase 3  win-probability prediction (logistic regression on OPR margins)
   Phase 4  pick-list recommendation + plain-language strategy
   Phase 5  backtest validation — accuracy / Brier on matches it didn't train on

   No Python / server needed — the equivalent of pandas + scikit-learn, in JS,
   so it works offline on a phone. Tuned to REBUILT 2026 scoring (see PTS).
   ========================================================================== */
(function () {
  'use strict';

  // ----- Phase 1: data + REBUILT point model (edit PTS to retune a new game) -----
  var PTS = {
    leave: 3, autoFuel: 1, teleopFuel: 1, autoClimbL1: 15,
    climb: { none: 0, attempted_failed: 0, parked: 2, level1: 10, level2: 20, level3: 30 }
  };
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
  function truthy(v) { return v === true || v === 'true' || v === 1 || v === '1'; }
  function robotPoints(r) {                       // legacy REBUILT model (fallback only)
    var p = 0;
    if (truthy(r.autoLeft)) p += PTS.leave;
    if (String(r.autoClimb) === 'level1') p += PTS.autoClimbL1;
    p += num(r.autoHubMade) * PTS.autoFuel;
    p += num(r.teleopHubMade) * PTS.teleopFuel;
    p += PTS.climb[String(r.endgameClimb)] || 0;
    return p;
  }

  // ----- config-driven scoring (so ANY game works from the Form Builder) -----
  // The active scouting config carries the point values on its fields:
  //   number/range field -> field.points       = points per unit
  //   boolean field      -> field.points        = points when true   (+ field.fail = a breakdown)
  //   select field       -> field.optionPoints  = { optionKey: points }
  // If a config has no such annotations we fall back to the REBUILT model above,
  // so older saved configs and bare datasets still score.
  var SCFG = null;                                // active config (set by the app via setConfig)
  function activeConfig() {
    if (SCFG) return SCFG;
    try { if (typeof CONFIG !== 'undefined' && CONFIG) return CONFIG; } catch (e) {}
    return null;
  }
  function scoringFields(cfg) {
    var out = [];
    if (cfg && cfg.sections) cfg.sections.forEach(function (s) {
      (s.fields || []).forEach(function (f) { if (f && (f.points != null || f.optionPoints)) out.push(f); });
    });
    return out;
  }
  function failCodes(cfg) {
    var out = [];
    if (cfg && cfg.sections) cfg.sections.forEach(function (s) {
      (s.fields || []).forEach(function (f) { if (f && f.fail && f.code) out.push(f.code); });
    });
    return out;
  }
  function recordPoints(r) {
    var fs = scoringFields(activeConfig());
    if (!fs.length) return robotPoints(r);        // no scoring metadata -> REBUILT fallback
    var p = 0;
    fs.forEach(function (f) {
      var v = r[f.code];
      if (f.type === 'boolean') { if (truthy(v)) p += num(f.points); }
      else if (f.type === 'select') { if (f.optionPoints) p += num(f.optionPoints[String(v)]); }
      else p += num(v) * num(f.points);            // number / range
    });
    return p;
  }
  function isFail(r) {
    var fc = failCodes(activeConfig());
    if (!fc.length) return truthy(r.disabled) || truthy(r.tipped) || truthy(r.noShow);
    for (var i = 0; i < fc.length; i++) if (truthy(r[fc[i]])) return true;
    return false;
  }
  function matchKey(r) { return [r.eventKey, r.matchType, r.matchNumber].join('|'); }

  function normalize(records) {
    return (records || []).filter(function (r) { return r && r.teamNumber !== undefined && r.teamNumber !== ''; })
      .map(function (r) {
        var o = {};
        for (var k in r) o[k] = r[k];
        o.teamNumber = String(r.teamNumber).trim();
        o.alliance = String(r.alliance || '').toLowerCase();
        o._pts = recordPoints(o);
        return o;
      });
  }
  function buildMatches(recs) {
    var by = {};
    recs.forEach(function (r) {
      var k = matchKey(r); by[k] = by[k] || { key: k, red: [], blue: [] };
      (r.alliance === 'blue' ? by[k].blue : by[k].red).push(r);
    });
    return Object.keys(by).map(function (k) {
      var m = by[k];
      m.redTeams = uniq(m.red.map(function (r) { return r.teamNumber; }));
      m.blueTeams = uniq(m.blue.map(function (r) { return r.teamNumber; }));
      m.redScore = m.red.reduce(function (s, r) { return s + r._pts; }, 0);
      m.blueScore = m.blue.reduce(function (s, r) { return s + r._pts; }, 0);
      m.redWin = m.redScore > m.blueScore ? 1 : (m.redScore < m.blueScore ? 0 : 0.5);
      return m;
    }).filter(function (m) { return m.red.length || m.blue.length; });
  }

  // ----- Phase 2: capability + OPR -----
  function capabilities(recs) {
    var by = {};
    recs.forEach(function (r) { (by[r.teamNumber] = by[r.teamNumber] || []).push(r); });
    var rows = {}, maxAvg = 0;
    Object.keys(by).forEach(function (t) {
      var ms = by[t], pts = ms.map(function (r) { return r._pts; });
      var avg = mean(pts), sd = stddev(pts), cv = avg > 0 ? sd / avg : 1;
      var fails = ms.filter(isFail).length;
      rows[t] = {
        team: t, matches: ms.length, avgPts: avg, sd: sd,
        consistency: clamp(1 - cv, 0, 1),
        reliability: ms.length ? 1 - fails / ms.length : 0,
        avgAuto: mean(ms.map(function (r) { return num(r.autoHubMade); })),
        avgTele: mean(ms.map(function (r) { return num(r.teleopHubMade); })),
        avgDefense: mean(ms.map(function (r) { return num(r.defenseRating); })),
        climbRate: ms.filter(function (r) { return ['level1', 'level2', 'level3'].indexOf(String(r.endgameClimb)) >= 0; }).length / ms.length,
        fails: fails
      };
      if (avg > maxAvg) maxAvg = avg;
    });
    Object.keys(rows).forEach(function (t) {
      var r = rows[t];
      r.pointsScore = maxAvg > 0 ? 100 * r.avgPts / maxAvg : 0;
      r.capability = 0.6 * r.pointsScore + 0.2 * 100 * r.consistency + 0.2 * 100 * r.reliability;
    });
    return rows;
  }

  // OPR: solve (A^T A + λI) x = A^T b, where each alliance contributes a row of 1s
  // for its teams and b = that alliance's scouted score. x = each team's contribution.
  function computeOPR(matches) {
    var tset = {};
    matches.forEach(function (m) { m.redTeams.concat(m.blueTeams).forEach(function (t) { tset[t] = 1; }); });
    var T = Object.keys(tset); var idx = {}; T.forEach(function (t, i) { idx[t] = i; });
    var n = T.length; if (!n) return {};
    var M = zeros(n, n), v = new Array(n).fill(0);
    function add(arr, score) {
      for (var i = 0; i < arr.length; i++) {
        var ti = idx[arr[i]]; v[ti] += score;
        for (var j = 0; j < arr.length; j++) M[ti][idx[arr[j]]] += 1;
      }
    }
    matches.forEach(function (m) {
      if (m.redTeams.length) add(m.redTeams, m.redScore);
      if (m.blueTeams.length) add(m.blueTeams, m.blueScore);
    });
    for (var i = 0; i < n; i++) M[i][i] += 1;   // ridge — keeps it solvable when teams always play together
    var x = solve(M, v);
    var opr = {}; T.forEach(function (t, i) { opr[t] = x[i]; });
    return opr;
  }
  function oprSum(arr, opr) { return arr.reduce(function (s, t) { return s + (opr[t] || 0); }, 0); }

  // ----- Phase 3: logistic win predictor -----
  function trainLogistic(matches, opr) {
    var S = matches.filter(function (m) { return m.redTeams.length && m.blueTeams.length && m.redWin !== 0.5; })
      .map(function (m) { return { x: oprSum(m.redTeams, opr) - oprSum(m.blueTeams, opr), y: m.redWin }; });
    if (S.length < 4) return null;
    var mu = mean(S.map(function (s) { return s.x; })), sg = stddev(S.map(function (s) { return s.x; })) || 1;
    S.forEach(function (s) { s.z = (s.x - mu) / sg; });
    var w0 = 0, w1 = 1, lr = 0.3;
    for (var it = 0; it < 3000; it++) {
      var g0 = 0, g1 = 0;
      S.forEach(function (s) { var p = sigmoid(w0 + w1 * s.z); g0 += (p - s.y); g1 += (p - s.y) * s.z; });
      w0 -= lr * g0 / S.length; w1 -= lr * g1 / S.length;
    }
    return { w0: w0, w1: w1, mu: mu, sg: sg, n: S.length };
  }
  function predictRedWin(redTeams, blueTeams, opr, model) {
    var x = oprSum(redTeams, opr) - oprSum(blueTeams, opr);
    if (model) return sigmoid(model.w0 + model.w1 * (x - model.mu) / model.sg);
    return sigmoid(x / 12);
  }

  // ----- Phase 5: backtest (train on a subset, score on the rest) -----
  function backtest(recs) {
    var all = buildMatches(normalize(recs)).filter(function (m) { return m.redTeams.length && m.blueTeams.length && m.redWin !== 0.5; });
    var train = [], test = [];
    all.forEach(function (m) { (hash(m.key) % 4 === 0 ? test : train).push(m); }); // ~25% held out, deterministic
    if (test.length < 3) { train = all; test = all; }                              // tiny dataset → in-sample
    var opr = computeOPR(train), model = trainLogistic(train, opr);
    var correct = 0, base = 0, brier = 0, n = 0, rows = [];
    test.forEach(function (m) {
      var p = predictRedWin(m.redTeams, m.blueTeams, opr, model);
      var pred = p >= 0.5 ? 1 : 0, b = oprSum(m.redTeams, opr) >= oprSum(m.blueTeams, opr) ? 1 : 0;
      if (pred === m.redWin) correct++;
      if (b === m.redWin) base++;
      brier += Math.pow(p - m.redWin, 2); n++;
      rows.push({ key: m.key, red: m.redTeams.join('+'), blue: m.blueTeams.join('+'), p: p, pred: pred ? 'Red' : 'Blue', actual: m.redWin ? 'Red' : 'Blue', ok: pred === m.redWin });
    });
    return { n: n, accuracy: n ? correct / n : 0, baseAccuracy: n ? base / n : 0, brier: n ? brier / n : 0, trainN: train.length, testN: test.length, rows: rows, inSample: test === all };
  }

  // ----- Phase 4: recommendation + strategy -----
  function recommendPicks(yourTeam, recs, opr, caps) {
    var your = caps[String(yourTeam)];
    var oprs = Object.keys(opr).map(function (k) { return opr[k]; });
    var maxOPR = Math.max.apply(null, oprs.concat([1]));
    return Object.keys(caps).filter(function (t) { return t !== String(yourTeam); }).map(function (t) {
      var c = caps[t], reasons = [], score = 0.55 * c.capability;
      if (your && your.avgDefense < 2 && c.avgDefense >= 2.5) { score += 12; reasons.push('plays defense — covers a gap on your alliance'); }
      if ((opr[t] || 0) > 0.65 * maxOPR) reasons.push('elite scorer (OPR ' + Math.round(opr[t]) + ')');
      else if ((opr[t] || 0) > 0.4 * maxOPR) reasons.push('solid scorer (OPR ' + Math.round(opr[t]) + ')');
      if (c.climbRate >= 0.7) { reasons.push('climbs almost every match'); score += 5; }
      if (c.reliability >= 0.9) { reasons.push('very reliable'); score += 5; }
      else if (c.reliability < 0.6) { reasons.push('⚠ breakdown risk (' + Math.round((1 - c.reliability) * 100) + '%)'); score -= 8; }
      if (!reasons.length) reasons.push('depth pick');
      return { team: t, score: score, opr: opr[t] || 0, capability: c.capability, combined: (your ? your.avgPts : 0) + c.avgPts, reasons: reasons };
    }).sort(function (a, b) { return b.score - a.score; });
  }
  function strategyText(redTeams, blueTeams, opr, caps, yourTeam) {
    var youRed = redTeams.indexOf(String(yourTeam)) >= 0;
    var us = youRed ? redTeams : blueTeams, them = youRed ? blueTeams : redTeams;
    var usO = oprSum(us, opr), themO = oprSum(them, opr);
    var lines = [];
    var p = predictRedWin(redTeams, blueTeams, opr, ENGINE._model);
    var winP = youRed ? p : 1 - p;
    lines.push('Projected win chance for your alliance: ' + Math.round(winP * 100) + '% (your est. ' + Math.round(usO) + ' vs their ' + Math.round(themO) + ').');
    var theirTop = them.slice().sort(function (a, b) { return (opr[b] || 0) - (opr[a] || 0); })[0];
    if (theirTop) {
      var defender = us.slice().sort(function (a, b) { return (caps[b] ? caps[b].avgDefense : 0) - (caps[a] ? caps[a].avgDefense : 0); })[0];
      lines.push('Their main threat is ' + theirTop + ' (OPR ' + Math.round(opr[theirTop] || 0) + '). Put ' + defender + ' on defense to contest it.');
    }
    var ourAuto = us.reduce(function (s, t) { return s + (caps[t] ? caps[t].avgAuto : 0); }, 0);
    var theirAuto = them.reduce(function (s, t) { return s + (caps[t] ? caps[t].avgAuto : 0); }, 0);
    if (ourAuto + theirAuto > 0) lines.push(ourAuto >= theirAuto
      ? 'You out-score in auto (' + ourAuto.toFixed(1) + ' vs ' + theirAuto.toFixed(1) + ') — press the early game and bank the lead.'
      : 'They win auto (' + theirAuto.toFixed(1) + ' vs ' + ourAuto.toFixed(1) + ') — protect the early game and win it back on cycles.');
    var anyClimb = Object.keys(caps).some(function (t) { return caps[t].climbRate > 0; });
    if (anyClimb) {
      var ourClimb = us.filter(function (t) { return caps[t] && caps[t].climbRate >= 0.6; }).length;
      lines.push(ourClimb >= 2 ? 'Endgame is a strength — lock in a multi-climb every match.' : 'Climb is shaky on your side — practice the endgame; it could decide a close one.');
    }
    return lines;
  }

  // ----- math helpers -----
  function mean(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : 0; }
  function stddev(a) { if (a.length < 2) return 0; var m = mean(a); return Math.sqrt(mean(a.map(function (x) { return (x - m) * (x - m); }))); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (!s[x]) { s[x] = 1; o.push(x); } }); return o; }
  function zeros(r, c) { var m = []; for (var i = 0; i < r; i++) m.push(new Array(c).fill(0)); return m; }
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function solve(A, b) {
    var n = b.length, M = A.map(function (row, i) { return row.slice().concat([b[i]]); });
    for (var col = 0; col < n; col++) {
      var piv = col;
      for (var r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      var t = M[col]; M[col] = M[piv]; M[piv] = t;
      var d = M[col][col]; if (Math.abs(d) < 1e-9) { M[col][col] += 1e-6; d = M[col][col]; }
      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === col) continue;
        var f = M[r2][col] / d;
        for (var c = col; c <= n; c++) M[r2][c] -= f * M[col][c];
      }
    }
    var x = new Array(n);
    for (var i = 0; i < n; i++) x[i] = M[i][n] / M[i][i];
    return x;
  }

  // ----- sample season (so the engine is demoable with realistic data) -----
  function rng(seed) { return function () { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; var t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function sampleSeason() {
    var R = rng(177);
    var nums = [177, 254, 1114, 1678, 118, 33, 2056, 195, 148, 469, 1323, 27, 67, 217, 1538, 330];
    var skill = {};
    nums.forEach(function (t) { skill[t] = { auto: 1 + R() * 6, tele: 6 + R() * 22, climbHi: R(), rel: 0.78 + R() * 0.21, def: R() }; });
    var recs = [], M = 40;
    for (var m = 1; m <= M; m++) {
      var pool = nums.slice().sort(function () { return R() - 0.5; }).slice(0, 6);
      ['red', 'blue'].forEach(function (al, ai) {
        pool.slice(ai * 3, ai * 3 + 3).forEach(function (t, st) {
          var s = skill[t], dead = R() > s.rel;
          var climb = dead ? 'none' : (R() < s.climbHi * 0.7 ? 'level3' : (R() < 0.5 ? 'level2' : (R() < 0.6 ? 'level1' : 'none')));
          recs.push({
            eventKey: '2025demo', matchType: 'qm', matchNumber: m, teamNumber: t, alliance: al, driverStation: String(st + 1),
            autoLeft: !dead && R() > 0.1, autoHubMade: dead ? 0 : Math.max(0, Math.round(s.auto + (R() - 0.5) * 3)),
            teleopHubMade: dead ? 0 : Math.max(0, Math.round(s.tele + (R() - 0.5) * 8)),
            autoClimb: 'none', endgameClimb: climb,
            driverSkill: Math.round(2 + R() * 3), defenseRating: s.def > 0.7 ? Math.round(2 + R() * 3) : 1,
            tipped: R() > 0.95, disabled: dead, noShow: false
          });
        });
      });
    }
    return recs;
  }

  // ===================== UI =====================
  var ENGINE = { data: [], caps: {}, opr: {}, matches: [], _model: null, source: '' };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  function recompute() {
    ENGINE.matches = buildMatches(ENGINE.data);
    ENGINE.caps = capabilities(ENGINE.data);
    ENGINE.opr = computeOPR(ENGINE.matches);
    ENGINE._model = trainLogistic(ENGINE.matches, ENGINE.opr);
  }
  function setData(recs, source) {
    ENGINE.data = normalize(recs);
    ENGINE.source = source;
    recompute();
  }
  function setConfig(cfg) {                      // app calls this whenever the game/config changes
    SCFG = cfg || null;
    if (ENGINE.data && ENGINE.data.length) {     // re-score already-loaded rows in place
      ENGINE.data.forEach(function (o) { o._pts = recordPoints(o); });
      recompute();
    }
  }

  function teamList() { return Object.keys(ENGINE.caps).sort(function (a, b) { return num(a) - num(b); }); }
  function teamOptions(sel) { return teamList().map(function (t) { return '<option value="' + t + '"' + (String(sel) === t ? ' selected' : '') + '>' + t + '</option>'; }).join(''); }

  function ensureOverlay() {
    if ($('analytics-overlay')) return;
    var ov = document.createElement('div');
    ov.id = 'analytics-overlay'; ov.className = 'an-overlay hidden';
    ov.innerHTML =
      '<div class="an-modal">' +
      '<div class="an-head"><h2>📈 ANALYZE — Alliance &amp; Strategy Engine</h2><button id="an-close" class="btn-help-close">×</button></div>' +
      '<div class="an-tabs">' +
      ['data', 'capabilities', 'predict', 'picklist', 'validation'].map(function (t, i) {
        var labels = { data: '1 · Data', capabilities: '2 · Capabilities', predict: '3 · Predict', picklist: '4 · Pick List', validation: '5 · Validation' };
        return '<button class="an-tab' + (i === 0 ? ' active' : '') + '" data-tab="' + t + '">' + labels[t] + '</button>';
      }).join('') +
      '</div>' +
      '<div id="an-body" class="an-body"></div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    $('an-close').addEventListener('click', close);
    ov.querySelectorAll('.an-tab').forEach(function (b) {
      b.addEventListener('click', function () {
        ov.querySelectorAll('.an-tab').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active'); renderTab(b.getAttribute('data-tab'));
      });
    });
    $('an-body').addEventListener('click', onBodyClick);
    $('an-body').addEventListener('change', onBodyChange);
  }

  function open() {
    ensureOverlay();
    $('analytics-overlay').classList.remove('hidden');
    document.body.classList.add('no-scroll');
    if (!ENGINE.data.length) {
      // default to saved session if any, else nothing yet
      try { if (typeof sessionMatches !== 'undefined' && sessionMatches.length) setData(sessionMatches, 'this session (' + sessionMatches.length + ' rows)'); } catch (e) {}
    }
    document.querySelector('#analytics-overlay .an-tab.active') || null;
    renderTab('data');
  }
  function close() { $('analytics-overlay').classList.add('hidden'); document.body.classList.remove('no-scroll'); }

  function renderTab(tab) {
    var b = $('an-body');
    if (tab === 'data') return renderData(b);
    if (!ENGINE.data.length) { b.innerHTML = '<div class="an-empty">Load a dataset in the <strong>Data</strong> tab first.</div>'; return; }
    if (tab === 'capabilities') renderCaps(b);
    else if (tab === 'predict') renderPredict(b);
    else if (tab === 'picklist') renderPickList(b);
    else if (tab === 'validation') renderValidation(b);
  }

  function renderData(b) {
    var summary = ENGINE.data.length
      ? '<div class="an-note">Loaded <strong>' + ENGINE.data.length + '</strong> robot-match rows · <strong>' + teamList().length + '</strong> teams · <strong>' + ENGINE.matches.length + '</strong> matches · source: ' + esc(ENGINE.source) + '</div>'
      : '<div class="an-note">No data yet. Load one of the sources below.</div>';
    b.innerHTML =
      '<p class="an-intro">Phase 1 — feed the engine a clean dataset of per-robot match rows (the same columns the app records). Use this session, import last season\'s export, or load a sample to explore.</p>' +
      '<div class="an-btnrow">' +
      '<button class="btn btn-primary" data-act="use-session">USE THIS SESSION</button>' +
      '<button class="btn btn-outline" data-act="import">IMPORT CSV / TSV / JSON</button>' +
      '<button class="btn btn-outline" data-act="sample">LOAD SAMPLE SEASON</button>' +
      '</div>' +
      '<input id="an-file" type="file" accept=".csv,.tsv,.json,text/csv,application/json" class="hidden">' +
      summary +
      '<div class="an-hint">Tip: in Google Sheets, File → Download → CSV of the <em>Data</em> tab, then Import here. Columns must include teamNumber, alliance, matchNumber and the scoring fields.</div>';
  }

  function renderCaps(b) {
    var rows = teamList().map(function (t) { return ENGINE.caps[t]; }).sort(function (a, b) { return (ENGINE.opr[b.team] || 0) - (ENGINE.opr[a.team] || 0); });
    var showClimb = rows.some(function (r) { return r.climbRate > 0; });   // REBUILT-style endgame data present?
    var h = '<p class="an-intro">Phase 2 — each robot\'s raw stats become one <strong>Capability</strong> score (points + consistency + reliability) and an <strong>OPR</strong> (its estimated point contribution, solved with linear algebra across all alliances).</p>';
    h += '<div class="an-scroll"><table class="an-table"><thead><tr><th>Team</th><th>Mch</th><th>OPR</th><th>Avg Pts</th><th>Consistency</th><th>Reliability</th>' + (showClimb ? '<th>Climb %</th>' : '') + '<th>Capability</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr><td><strong>' + r.team + '</strong></td><td>' + r.matches + '</td><td><strong>' + (ENGINE.opr[r.team] || 0).toFixed(1) + '</strong></td><td>' + r.avgPts.toFixed(1) +
        '</td><td>' + Math.round(r.consistency * 100) + '%</td><td>' + Math.round(r.reliability * 100) + '%</td>' + (showClimb ? '<td>' + Math.round(r.climbRate * 100) + '%</td>' : '') + '<td><strong>' + r.capability.toFixed(0) + '</strong></td></tr>';
    });
    h += '</tbody></table></div><div class="an-hint">OPR uses ridge least-squares on alliance scores — it untangles who actually contributes when teams keep playing together.</div>';
    b.innerHTML = h;
  }

  function renderPredict(b) {
    b.innerHTML =
      '<p class="an-intro">Phase 3 — pick two alliances; the logistic model (trained on past margins) estimates the win probability.</p>' +
      '<div class="an-vs"><div class="an-side an-red"><h4>RED</h4>' + [0, 1, 2].map(function (i) { return '<select data-pred="red" data-i="' + i + '">' + teamOptions() + '</select>'; }).join('') + '</div>' +
      '<div class="an-side an-blue"><h4>BLUE</h4>' + [0, 1, 2].map(function (i) { return '<select data-pred="blue" data-i="' + i + '">' + teamOptions() + '</select>'; }).join('') + '</div></div>' +
      '<button class="btn btn-primary" data-act="run-predict">PREDICT</button>' +
      '<div id="an-predict-out"></div>';
  }

  function renderPickList(b) {
    b.innerHTML =
      '<p class="an-intro">Phase 4 — choose your team; get a ranked pick list of partners that complement you, with reasons. Pick a matchup for a plain-language game plan.</p>' +
      '<label class="an-lbl">Your team</label> <select id="an-yourteam">' + teamOptions(177) + '</select> ' +
      '<button class="btn btn-primary" data-act="run-picks">BUILD PICK LIST</button>' +
      '<div id="an-picks-out"></div>' +
      '<hr class="an-hr"><h4 class="an-h4">Strategy for a matchup</h4>' +
      '<div class="an-vs"><div class="an-side an-red"><h4>RED</h4>' + [0, 1, 2].map(function (i) { return '<select data-strat="red" data-i="' + i + '">' + teamOptions() + '</select>'; }).join('') + '</div>' +
      '<div class="an-side an-blue"><h4>BLUE</h4>' + [0, 1, 2].map(function (i) { return '<select data-strat="blue" data-i="' + i + '">' + teamOptions() + '</select>'; }).join('') + '</div></div>' +
      '<button class="btn btn-outline" data-act="run-strategy">SUGGEST STRATEGY</button><div id="an-strat-out"></div>';
  }

  function renderValidation(b) {
    var r = backtest(ENGINE.data);
    var lift = r.accuracy - 0.5;
    b.innerHTML =
      '<p class="an-intro">Phase 5 — the credibility check. The engine trains on ~75% of matches and predicts the rest (' + (r.inSample ? 'dataset too small — shown in-sample' : 'matches it never saw') + '). If it beats a coin flip, it works.</p>' +
      '<div class="an-cards">' +
      card('Prediction accuracy', Math.round(r.accuracy * 100) + '%', (lift >= 0 ? '+' : '') + Math.round(lift * 100) + ' pts vs coin flip') +
      card('Brier score', r.brier.toFixed(3), 'lower is better (0 = perfect)') +
      card('OPR-only baseline', Math.round(r.baseAccuracy * 100) + '%', 'higher-OPR-wins rule') +
      card('Matches', r.testN + ' tested', r.trainN + ' trained') +
      '</div>' +
      '<div class="an-scroll"><table class="an-table"><thead><tr><th>Match</th><th>Red</th><th>Blue</th><th>Win prob (Red)</th><th>Predicted</th><th>Actual</th><th></th></tr></thead><tbody>' +
      r.rows.slice(0, 60).map(function (x) {
        return '<tr><td>' + esc(x.key.split('|').pop()) + '</td><td>' + esc(x.red) + '</td><td>' + esc(x.blue) + '</td><td>' + Math.round(x.p * 100) + '%</td><td>' + x.pred + '</td><td>' + x.actual + '</td><td>' + (x.ok ? '✅' : '❌') + '</td></tr>';
      }).join('') +
      '</tbody></table></div>';
  }
  function card(t, big, sub) { return '<div class="an-card"><div class="an-card-t">' + t + '</div><div class="an-card-big">' + big + '</div><div class="an-card-sub">' + sub + '</div></div>'; }

  function onBodyChange(e) {
    if (e.target.id === 'an-file') {
      var f = e.target.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { try { setData(parseDataset(rd.result, f.name), 'imported ' + f.name); renderTab('data'); } catch (err) { alert('Could not parse that file: ' + err.message); } };
      rd.readAsText(f);
    }
  }
  function onBodyClick(e) {
    var btn = e.target.closest('[data-act]'); if (!btn) return;
    var act = btn.getAttribute('data-act');
    if (act === 'use-session') {
      try { if (typeof sessionMatches !== 'undefined' && sessionMatches.length) { setData(sessionMatches, 'this session'); renderTab('data'); } else alert('No saved matches in this session yet — save some, or load the sample.'); } catch (e2) { alert('No session data.'); }
    } else if (act === 'import') { $('an-file').click(); }
    else if (act === 'sample') { setData(sampleSeason(), 'sample 2025 season'); renderTab('data'); }
    else if (act === 'run-predict') {
      var red = sel('[data-pred="red"]'), blue = sel('[data-pred="blue"]');
      var p = predictRedWin(red, blue, ENGINE.opr, ENGINE._model);
      $('an-predict-out').innerHTML = predictBar(p, red, blue);
    } else if (act === 'run-picks') {
      var yt = $('an-yourteam').value;
      var list = recommendPicks(yt, ENGINE.data, ENGINE.opr, ENGINE.caps);
      $('an-picks-out').innerHTML = '<ol class="an-picks">' + list.slice(0, 8).map(function (p, i) {
        return '<li><div class="an-pick-h"><span class="an-rank">#' + (i + 1) + '</span> <strong>' + p.team + '</strong> <span class="an-pill">OPR ' + Math.round(p.opr) + '</span> <span class="an-pill">cap ' + Math.round(p.capability) + '</span></div><div class="an-why">' + p.reasons.map(esc).join(' · ') + '</div></li>';
      }).join('') + '</ol>';
    } else if (act === 'run-strategy') {
      var r = sel('[data-strat="red"]'), bl = sel('[data-strat="blue"]'), yt2 = ($('an-yourteam') ? $('an-yourteam').value : r[0]);
      var lines = strategyText(r, bl, ENGINE.opr, ENGINE.caps, yt2);
      $('an-strat-out').innerHTML = '<div class="an-strategy"><div class="an-strat-title">Game plan (you = ' + esc(yt2) + ')</div>' + lines.map(function (l) { return '<div class="an-strat-line">• ' + esc(l) + '</div>'; }).join('') + '</div>';
    }
  }
  function sel(q) { return Array.prototype.map.call(document.querySelectorAll('#an-body ' + q), function (s) { return s.value; }); }
  function predictBar(p, red, blue) {
    var rp = Math.round(p * 100);
    return '<div class="an-predict"><div class="an-bar"><div class="an-bar-red" style="width:' + rp + '%">' + rp + '% RED</div><div class="an-bar-blue" style="width:' + (100 - rp) + '%">' + (100 - rp) + '% BLUE</div></div>' +
      '<div class="an-hint">Est. contributions: Red ' + Math.round(oprSum(red, ENGINE.opr)) + ' · Blue ' + Math.round(oprSum(blue, ENGINE.opr)) + '. ' + (rp >= 50 ? red.join('+') : blue.join('+')) + ' favored.</div></div>';
  }

  function parseDataset(text, name) {
    text = String(text).trim();
    if (/\.json$/i.test(name) || text[0] === '[' || text[0] === '{') {
      var j = JSON.parse(text); return Array.isArray(j) ? j : (j.data || j.matches || j.rows || []);
    }
    var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
    var delim = (lines[0].indexOf('\t') >= 0) ? '\t' : ',';
    var head = splitLine(lines[0], delim);
    return lines.slice(1).map(function (l) { var c = splitLine(l, delim), o = {}; head.forEach(function (h, i) { o[h] = c[i]; }); return o; });
  }
  function splitLine(l, d) {
    if (d === '\t') return l.split('\t');
    var out = [], cur = '', q = false;
    for (var i = 0; i < l.length; i++) { var ch = l[i]; if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; }
    out.push(cur); return out.map(function (s) { return s.trim(); });
  }

  // expose
  window.ANALYTICS = { open: open, setConfig: setConfig, engine: ENGINE, _: { computeOPR: computeOPR, capabilities: capabilities, backtest: backtest, sampleSeason: sampleSeason, setData: setData, setConfig: setConfig, recordPoints: recordPoints, recommendPicks: recommendPicks, robotPoints: robotPoints } };

  // wire the header button if present
  if (document.readyState !== 'loading') wire(); else document.addEventListener('DOMContentLoaded', wire);
  function wire() { var b = document.getElementById('btn-analyze'); if (b) b.addEventListener('click', open); }
})();
