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

function parseTranscript(text, initialState) {
  const original = text;
  const t = text.toLowerCase();
  const result = Object.assign({}, initialState);
  const conf = {};

  const titleCase = s => s.replace(/\b\w/g, c => c.toUpperCase());

  // Helper: find a number near a keyword
  const numNear = (patterns, window) => {
    window = window || 40;
    for (const pattern of patterns) {
      const regex = new RegExp(pattern, 'i');
      const m = t.match(regex);
      if (m) {
        const start = Math.max(0, m.index - window);
        const end = Math.min(t.length, m.index + m[0].length + window);
        const ctx = t.slice(start, end);
        const numMatch = ctx.match(/\b(\d{1,2})\b/);
        if (numMatch) return parseInt(numMatch[1]);
      }
    }
    return null;
  };

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
    /(?:red|blue)\s*(\d)\b/i,
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
  const autoSection = t.match(/\b(auto|autonomous)\b[\s\S]{0,200}/i);
  if (autoSection) {
    const as = autoSection[0];
    const autoMade = as.match(/(?:made|scored|put in|hit)\s*(\d+)/i) || as.match(/(\d+)\s*(?:in auto|made|scored)/i);
    if (autoMade) { result.autoHubMade = parseInt(autoMade[1]); conf.autoHubMade = 'high'; }
    if (/\b(left|mobility|leave|exit)\b/i.test(as)) { result.autoLeft = true; conf.autoLeft = 'high'; }
    if (/\bclimb(ed)?\s*(in\s*auto|level\s*1|l1|low\s*rung)/i.test(as)) {
      result.autoClimb = 'level1'; conf.autoClimb = 'high';
    }
  }

  // ---- Teleop ----
  const teleopIdx = t.search(/\b(teleop|tele op|teleoperated)\b/i);
  if (teleopIdx >= 0) {
    const ts = t.slice(teleopIdx, teleopIdx + 400);
    // "made 18", "scored 18", "18 made", "got 18 in"
    const teleMade = ts.match(/(?:made|scored|put in|hit)\s*(\d+)/i) || ts.match(/(\d+)\s*(?:made|scored|in the hub)/i);
    if (teleMade) { result.teleopHubMade = parseInt(teleMade[1]); conf.teleopHubMade = 'high'; }
  }

  // ---- No show ----
  if (/\b(no\s*show|did(n'?t| not)\s+show(?:\s+up)?|never\s+showed|absent|didn'?t\s+come\s+out)\b/i.test(t)) {
    result.noShow = true; conf.noShow = 'high';
  }

  // ---- Passing & pickup effectiveness (1–5 from sentiment near keyword) ----
  const rateAround = (keywords) => {
    for (const kw of keywords) {
      const re = new RegExp(kw, 'gi');
      let m;
      while ((m = re.exec(t)) !== null) {
        const start = Math.max(0, m.index - 60);
        const end = Math.min(t.length, m.index + m[0].length + 60);
        const ctx = t.slice(start, end);
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
  if (conf.teleopHubMade === undefined && conf.autoHubMade === undefined) {
    const anyMade = t.match(/(?:made|scored)\s*(\d+)/i);
    if (anyMade) { result.teleopHubMade = parseInt(anyMade[1]); conf.teleopHubMade = 'medium'; }
  }

  // ---- Pickup sources ----
  if (/\bdepot\b/i.test(t)) { result.pickedFromDepot = true; conf.pickedFromDepot = 'high'; }
  if (/\b(human player|hp|chute|outpost)\b/i.test(t)) { result.pickedFromHP = true; conf.pickedFromHP = 'high'; }
  if (/\b(floor|ground|off the ground|loose fuel|scooped|neutral zone)\b/i.test(t)) { result.pickedFromFloor = true; conf.pickedFromFloor = 'high'; }

  // ---- Endgame climb ----
  if (/\blevel\s*3\b|\bl3\b|\bhigh rung\b/i.test(t)) { result.endgameClimb = 'level3'; conf.endgameClimb = 'high'; }
  else if (/\blevel\s*2\b|\bl2\b|\bmid rung\b/i.test(t)) { result.endgameClimb = 'level2'; conf.endgameClimb = 'high'; }
  else if (/\blevel\s*1\b|\bl1\b|\blow rung\b/i.test(t)) { result.endgameClimb = 'level1'; conf.endgameClimb = 'high'; }
  else if (/\bparked\b/i.test(t)) { result.endgameClimb = 'parked'; conf.endgameClimb = 'high'; }
  else if (/\b(tried to climb|attempted.*climb|climb.*fail|fell off)\b/i.test(t)) { result.endgameClimb = 'attempted_failed'; conf.endgameClimb = 'high'; }
  else if (/\bno climb|didn't climb|did not climb\b/i.test(t)) { result.endgameClimb = 'none'; conf.endgameClimb = 'high'; }

  // ---- Driver skill ----
  if (/\b(elite|amazing|incredible|insane|fantastic driver)\b/i.test(t)) { result.driverSkill = 5; conf.driverSkill = 'high'; }
  else if (/\b(great|really good|smooth|strong driver)\b/i.test(t)) { result.driverSkill = 4; conf.driverSkill = 'high'; }
  else if (/\b(solid|decent|fine|okay|competent)\b/i.test(t)) { result.driverSkill = 3; conf.driverSkill = 'medium'; }
  else if (/\b(rough|struggled|messy|shaky)\b/i.test(t)) { result.driverSkill = 2; conf.driverSkill = 'high'; }
  else if (/\b(crashed|awful|terrible|could not drive)\b/i.test(t)) { result.driverSkill = 1; conf.driverSkill = 'high'; }

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
  CONFIG.sections.forEach(sec => {
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
// =====================================================================

function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    $('mic-button').disabled = true;
    showMicError('Voice input not supported in this browser. Type into the box instead.');
    return;
  }
  $('mic-button').addEventListener('click', () => {
    if (isRecording) stopRecording();
    else startRecording();
  });
}

function startRecording() {
  hideMicError();
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  baseTranscript = $('transcript').value;
  if (baseTranscript.length > 0 && !baseTranscript.endsWith(' ')) baseTranscript += ' ';

  recognition.onresult = (event) => {
    let interim = '';
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      if (res.isFinal) final += res[0].transcript + ' ';
      else interim += res[0].transcript;
    }
    if (final) baseTranscript += final;
    $('transcript').value = baseTranscript + interim;
    updateProcessButton();
  };

  recognition.onerror = (e) => {
    if (e.error === 'not-allowed') {
      showMicError('Microphone permission denied. Enable it in your browser settings.');
    } else if (e.error === 'no-speech') {
      // silent
    } else {
      showMicError('Voice error: ' + e.error + '. Type into the box instead.');
    }
    setRecordingState(false);
  };

  recognition.onend = () => setRecordingState(false);

  try {
    recognition.start();
    setRecordingState(true);
  } catch(e) {
    showMicError('Could not start recording.');
  }
}

function stopRecording() {
  if (recognition) recognition.stop();
  setRecordingState(false);
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
  renderAllFields();
  updateGenerateButton();
}

function generateOutput() {
  const missing = getMissingRequired();
  if (missing.length > 0) {
    alert('Please fill required fields first:\n• ' + missing.join('\n• '));
    return;
  }
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

function renderQR(text) {
  const container = $('qrcode');
  container.innerHTML = '';
  if (typeof QRCode === 'undefined' || !QRCode.toCanvas) {
    container.innerHTML = '<p style="padding:20px;color:var(--gray);font-size:13px;">QR code library failed to load. The TSV tab still works.</p>';
    return;
  }
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  QRCode.toCanvas(canvas, text, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 280,
    color: { dark: '#1F1F1F', light: '#FFFFFF' }
  }, err => {
    if (err) {
      container.innerHTML = '<p style="padding:20px;color:var(--error);font-size:13px;">QR generation failed. Use TSV tab instead.</p>';
    }
  });
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
  $('output-section').classList.add('hidden');
  $('generate-row').classList.remove('hidden');
  const ss = $('submit-status'); if (ss) ss.classList.add('hidden');
  renderAllFields();
  updateProcessButton();
  updateGenerateButton();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearAll() {
  if (!confirm('Clear EVERYTHING — all fields, transcript, and saved scout name/event? This cannot be undone.')) return;
  fields = initialFieldState();
  confidence = {};
  currentMatchId = newMatchId();
  $('transcript').value = '';
  $('output-section').classList.add('hidden');
  $('generate-row').classList.remove('hidden');
  hideMicError();
  try {
    localStorage.removeItem('scout_name');
    localStorage.removeItem('event_key');
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
    selector: '.voice-row',
    title: '1 · Describe the match',
    body: 'Tap the maroon mic and just talk — or type — in plain English. Example: "Team 177, scored 4 in auto, climbed the mid rung." No special wording needed.'
  },
  {
    selector: '#btn-process',
    title: '2 · Auto-fill the fields',
    body: 'Tap AUTO-FILL FIELDS. The app reads your description and fills in the scouting form for you automatically.'
  },
  {
    selector: '#fields-container',
    title: '3 · Review & fix',
    body: 'Check the filled values. A green "AI" badge means it was auto-filled — tap any field to correct it. Fields marked with a red * are required.'
  },
  {
    selector: '#btn-generate',
    title: '4 · Generate output',
    body: 'Once the required fields are set, tap GENERATE to get a scannable QR code (works with no internet) plus TSV and JSON for your QRScout pipeline.'
  },
  {
    selector: '#btn-sheet',
    title: '5 · Send to the Sheet (optional)',
    body: 'If your host connected a Google Sheet — tap ⚙ SHEET, or just open the link they shared — each match auto-submits here, no scanning. Offline, it queues and sends later. The dot shows the status.'
  },
  {
    selector: '#btn-help',
    title: '6 · Save & keep going',
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
  const url = p.get('sheet'), key = p.get('key');
  let changed = false;
  if (url) { try { localStorage.setItem('sheet_endpoint', url); } catch (e) {} changed = true; }
  if (key) { try { localStorage.setItem('sheet_passcode', key); } catch (e) {} changed = true; }
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

function buildPayload(data) {
  const clean = Object.assign({}, data);
  delete clean._ts;
  return Object.assign(clean, {
    passcode: sheetPasscode,
    _order: FIELD_ORDER.slice(),
    _id: data._id || currentMatchId || newMatchId()
  });
}

// JSONP call: works around the cross-origin limits of Apps Script web apps,
// and (unlike no-cors fetch) lets us actually READ the ok/error reply.
function jsonpSubmit(payload, timeoutMs) {
  return new Promise((resolve, reject) => {
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
    script.src = sheetEndpoint + '?callback=' + cb + '&data=' + encodeURIComponent(JSON.stringify(payload));
    document.body.appendChild(script);
  });
}

// Submit one match. Resolves { status: 'sent'|'queued'|'rejected'|'notconfigured' }.
async function submitMatch(data) {
  if (!isSheetConnected()) return { status: 'notconfigured' };
  const payload = buildPayload(data);
  if (!navigator.onLine) { enqueue(payload); return { status: 'queued' }; }
  try {
    const resp = await jsonpSubmit(payload);
    if (resp && resp.ok) return { status: 'sent', action: resp.action };
    return { status: 'rejected', error: (resp && resp.error) || 'rejected' }; // config issue, don't queue
  } catch (e) {
    enqueue(payload); // network/timeout — keep it for auto-retry
    return { status: 'queued' };
  }
}

function enqueue(payload) {
  pendingQueue = pendingQueue.filter(p => p._id !== payload._id); // de-dupe by match id
  pendingQueue.push(payload);
  savePendingQueue();
  updateSheetStatus();
}

async function flushQueue() {
  if (!isSheetConnected() || !navigator.onLine || pendingQueue.length === 0) return;
  for (const payload of pendingQueue.slice()) {
    try {
      const resp = await jsonpSubmit(payload);
      // Drop on success OR on a server rejection (config problem won't fix itself by retrying).
      // The local session copy is always kept, so nothing is lost.
      if (resp) { pendingQueue = pendingQueue.filter(p => p._id !== payload._id); savePendingQueue(); }
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
  $('sheet-msg').classList.add('hidden');
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
  const link = location.origin + location.pathname + '?sheet=' + encodeURIComponent(url) + '&key=' + encodeURIComponent(pass);
  navigator.clipboard.writeText(link).then(
    () => showSheetMsg('Scout link copied! Send it to your scouts — opening it auto-connects their app.', 'ok'),
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
  if (!isSheetConnected()) { showSubmitStatus('No Sheet connected — scan the QR code, or tap ⚙ SHEET above to connect one.', 'warn'); return; }
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
    updateProcessButton();
  });
  $('btn-clear-transcript').addEventListener('click', () => {
    $('transcript').value = '';
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

  // Tabs
  $$('.tab').forEach(t => t.addEventListener('click', () => showTab(t.getAttribute('data-tab'))));

  // Transcript
  $('transcript').addEventListener('input', updateProcessButton);

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
  $('sheet-overlay').addEventListener('click', e => { if (e.target === $('sheet-overlay')) closeSheetDialog(); });
  window.addEventListener('online', flushQueue);
}

// =====================================================================
// INIT
// =====================================================================

async function init() {
  // Load config
  try {
    const resp = await fetch('config.json');
    if (!resp.ok) throw new Error('Failed to load config.json');
    CONFIG = await resp.json();
  } catch (e) {
    document.body.innerHTML = `
      <div style="padding:40px;text-align:center;font-family:sans-serif;">
        <h2 style="color:#7B1F2B;">Failed to load config.json</h2>
        <p style="color:#6B6B6B;margin-top:10px;">Make sure config.json is in the same folder as index.html.</p>
        <p style="color:#6B6B6B;font-size:13px;margin-top:6px;">Error: ${escapeHTML(e.message)}</p>
      </div>`;
    return;
  }

  ALL_FIELDS = CONFIG.sections.flatMap(s => s.fields);
  FIELD_ORDER = ALL_FIELDS.map(f => f.code);
  fields = initialFieldState();
  currentMatchId = newMatchId();

  // Sheet connection: honor a shared ?sheet=&key= link, then load saved settings.
  applyUrlConfig();
  loadSheetConfig();

  // Restore persisted preferences
  try {
    const sn = localStorage.getItem('scout_name');
    if (sn) fields.scoutName = sn;
    const ek = localStorage.getItem('event_key');
    if (ek) fields.eventKey = ek;
    const sm = localStorage.getItem('session_matches');
    if (sm) sessionMatches = JSON.parse(sm);
  } catch(e) { console.warn('Restore failed', e); }

  renderAllFields();
  wireUI();
  updateProcessButton();
  updateGenerateButton();
  updateSessionBar();
  updateSheetStatus();
  flushQueue();
}

document.addEventListener('DOMContentLoaded', init);
