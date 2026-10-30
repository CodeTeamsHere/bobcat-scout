/* Pit scouting logic with no page (tools/test-pit.js tests it): checking a report, building what is
 * sent to the Sheet, sizing photos, and the send queue's bookkeeping.
 *
 * How a report travels (pit.js does the sending):
 *   1. the report row goes the usual way (a link the Sheet answers, like a match), and
 *   2. each photo goes as a separate upload (a photo is far too big for a link). The browser can't read
 *      the Sheet's answer to an upload, so
 *   3. the phone asks the Sheet how many photos that team now has, and only then counts them as sent.
 *      A photo sent twice is saved once (each has its own id), so retrying is always safe.
 */
(function (root) {
  'use strict';

  var MAX_EDGE = 1280;            // longest side of a photo after shrinking, in pixels
  var MAX_BASE64 = 2800000;       // the Sheet refuses more than ~3,000,000 characters

  function str(v) { return v == null ? '' : String(v).trim(); }

  /** Problems with a report before it is sent: [] when it can be sent. */
  function check(form, answers, meta) {
    var out = [];
    var team = Number(str(answers.teamNumber));
    if (!str(answers.teamNumber) || !isFinite(team) || team < 1 || team > 99999 || Math.floor(team) !== team) out.push('Type the team number.');
    if (!str(meta && meta.scoutName)) out.push('Your name is missing: finish SETUP first.');
    if (!str(meta && meta.eventKey)) out.push('The event code is missing: finish SETUP first.');
    (form.fields || []).forEach(function (f) {
      var v = str(answers[f.code]);
      if (f.type === 'number' && v !== '') {
        var n = Number(v);
        if (!isFinite(n) || (f.min != null && n < f.min) || (f.max != null && n > f.max)) out.push(f.label + ': ' + v + ' is not a sensible number' + (f.max != null ? ' (0 to ' + f.max + ')' : '') + '.');
      }
      if (f.type === 'select' && v !== '' && (f.options || []).indexOf(v) < 0) out.push(f.label + ': choose one of the options.');
    });
    var filled = (form.fields || []).filter(function (f) { return str(answers[f.code]) !== ''; }).length;
    if (!filled && !(answers.photos || []).length) out.push('Fill in at least one question or add a photo.');
    if ((answers.photos || []).length > (form.maxPhotos || 3)) out.push('At most ' + (form.maxPhotos || 3) + ' photos.');
    return out;
  }

  /** The report row as the Sheet's script expects it (the passcode is added when it is sent). */
  function buildRow(form, answers, meta) {
    var ek = str(meta.eventKey).toLowerCase(), team = Number(str(answers.teamNumber));
    var row = { _form: 'pit', _id: 'pit_' + ek + '_' + team, scoutName: str(meta.scoutName), eventKey: ek, teamNumber: team };
    var order = ['scoutName', 'eventKey', 'teamNumber'];
    (form.fields || []).forEach(function (f) {
      var v = str(answers[f.code]);
      row[f.code] = f.type === 'number' && v !== '' ? Number(v) : v;
      order.push(f.code);
    });
    order.push('photoIds');
    row._order = order;
    return row;
  }

  /** A photo's new size: the longest side at most MAX_EDGE, shape kept, never enlarged. */
  function fitSize(w, h, max) {
    max = max || MAX_EDGE;
    if (!(w > 0 && h > 0)) return { w: 0, h: 0 };
    var s = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) };
  }
  /** JPEG quality steps to try until a photo is small enough. */
  var QUALITIES = [0.78, 0.65, 0.5, 0.38];
  function photoFits(dataUrl) { return String(dataUrl || '').replace(/^data:[^,]*,/, '').length <= MAX_BASE64; }

  /** A new queued report: the row plus its photos, none sent yet. */
  function newItem(row, photos, now) {
    var t = now || Date.now();
    return {
      id: row._id + '_' + t, eventKey: row.eventKey, teamNumber: row.teamNumber, row: row, rowSent: false,
      photos: (photos || []).map(function (p, i) { return { photoId: t.toString(36) + '-' + i, mime: p.mime || 'image/jpeg', data: p.data, sent: false }; }),
      createdAt: t, tries: 0, error: ''
    };
  }
  /** Photos still to confirm. */
  function unsent(item) { return item.photos.filter(function (p) { return !p.sent; }); }
  function done(item) { return item.rowSent && !unsent(item).length; }
  /**
   * After uploading `count` photos and asking the Sheet: `before` photos it had, `after` it has now.
   * They all arrived if the count went up by at least that many (or the team hit the six-photo limit).
   */
  function photosArrived(before, after, count, cap) {
    cap = cap || 6;
    return after >= Math.min(cap, before + count);
  }
  /** The status line for one queued report. */
  function statusText(item) {
    var n = item.photos.length, left = unsent(item).length;
    if (done(item)) return 'Sent' + (n ? ' with ' + n + ' photo' + (n === 1 ? '' : 's') : '') + '.';
    if (item.error) return 'Not sent: ' + item.error;
    if (!item.rowSent) return 'Waiting to send (it will go by itself when there is signal).';
    return 'Report sent; ' + left + ' photo' + (left === 1 ? '' : 's') + ' still to send.';
  }

  var PIT = { check: check, buildRow: buildRow, fitSize: fitSize, QUALITIES: QUALITIES, photoFits: photoFits, newItem: newItem,
    unsent: unsent, done: done, photosArrived: photosArrived, statusText: statusText, MAX_EDGE: MAX_EDGE, MAX_BASE64: MAX_BASE64 };
  if (typeof module !== 'undefined' && module.exports) module.exports = PIT;
  else root.PIT_CORE = PIT;
})(typeof window !== 'undefined' ? window : this);
