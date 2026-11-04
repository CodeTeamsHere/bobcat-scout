/* Bobcat Scout: fixing a match that was already saved or sent (fix-core.js).
 *
 * Pure helpers, no page needed, so tools/test-fix.js can check them. The idea: a fixed match
 * keeps the SAME match id as the original. The Sheet script finds a row by that id and
 * replaces it, so a fix never adds a second row. These helpers only handle the lists on the
 * phone (saved matches, the waiting-to-send queue) and build the copies to re-send.
 */
(function (root) {
  'use strict';

  // The id a queued item carries (new items wrap a payload, older ones are the bare payload).
  function queuedId(item) {
    return item && item.payload ? item.payload._id : (item ? item._id : undefined);
  }

  // Find the saved copy of a match by its id. null when there is none.
  function findSaved(list, id) {
    if (!id) return null;
    for (var i = 0; i < list.length; i++) if (list[i] && list[i]._id === id) return list[i];
    return null;
  }

  // The saved list after a fixed copy arrives: the old copy with the same id is replaced
  // in place (same spot in the list), or the copy is added when there was none.
  function replaceSaved(list, copy) {
    var done = false;
    var out = list.map(function (m) {
      if (m && copy._id && m._id === copy._id) { done = true; return copy; }
      return m;
    });
    if (!done) out.push(copy);
    return out;
  }

  // The waiting-to-send queue after adding a payload: any item for the same match id is
  // dropped first, so the queue never holds two versions of one match.
  function queueWith(queue, payload, url) {
    var out = queue.filter(function (p) { return queuedId(p) !== payload._id; });
    out.push({ url: url, payload: payload });
    return out;
  }

  // The queue once a match has reached the Sheet: nothing for that id may stay waiting,
  // or an older version could be sent later over the fix.
  function queueWithout(queue, id) {
    return queue.filter(function (p) { return queuedId(p) !== id; });
  }

  // Is a copy of this match still waiting to be sent?
  function isQueued(queue, id) {
    return queue.some(function (p) { return queuedId(p) === id; });
  }

  // The values to load into the form to fix a saved match: its fields only, no bookkeeping.
  // The id is returned separately because the form keeps it as the current match id.
  function formValues(saved) {
    var out = {};
    Object.keys(saved).forEach(function (k) {
      if (k !== '_ts' && k !== '_id') out[k] = saved[k];
    });
    return out;
  }

  // The fixed copy to save and send: the edited form values with the ORIGINAL id.
  function fixedCopy(values, id, now) {
    var copy = {};
    Object.keys(values).forEach(function (k) { if (k !== '_ts') copy[k] = values[k]; });
    copy._id = id;
    copy._ts = now;
    return copy;
  }

  // "Entered by mistake": the same match re-sent with the existing No Show box ticked and a
  // comment that says so. It uses only fields the Sheet already has, so the Sheet script
  // needs no change. The row stays in the Sheet, marked, rather than being deleted.
  var MISTAKE_NOTE = 'ENTERED BY MISTAKE - ignore this row';
  function mistakeCopy(saved, now) {
    var copy = fixedCopy(formValues(saved), saved._id, now);
    copy.noShow = true;
    copy.co = MISTAKE_NOTE;
    return copy;
  }
  function isMistake(saved) {
    return !!saved && saved.noShow === true && saved.co === MISTAKE_NOTE;
  }

  // Does the scout's match in progress hold anything worth setting aside? Only the four
  // identity boxes (scout, event, match number, team) and nothing typed or said means no.
  function draftHasContent(fields, blank, transcript, confidence) {
    if (transcript && String(transcript).trim()) return true;
    if (confidence && Object.keys(confidence).length) return true;
    var identity = { scoutName: 1, eventKey: 1, matchNumber: 1, teamNumber: 1, matchType: 1 };
    return Object.keys(fields).some(function (k) {
      if (identity[k]) return false;
      return JSON.stringify(fields[k]) !== JSON.stringify(blank[k]);
    });
  }

  var api = {
    queuedId: queuedId, findSaved: findSaved, replaceSaved: replaceSaved,
    queueWith: queueWith, queueWithout: queueWithout, isQueued: isQueued,
    formValues: formValues, fixedCopy: fixedCopy, mistakeCopy: mistakeCopy, isMistake: isMistake,
    draftHasContent: draftHasContent, MISTAKE_NOTE: MISTAKE_NOTE
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BOBCAT_FIX = api;
})(typeof window !== 'undefined' ? window : this);
