'use strict';

// Small, dependency-free date helpers. Every date in this app is stored as a
// "naive" text timestamp ("YYYY-MM-DD HH:MM:SS", matching SQLite's
// datetime('now')) with no timezone attached — display formatting in
// lib/ui.js renders it using whatever timezone the Node process itself runs
// in. Set the TZ environment variable (e.g. TZ=America/Chicago) on your host
// so everything displays in your local time instead of UTC.

function pad(n) {
  return String(n).padStart(2, '0');
}

// Convert an HTML <input type="datetime-local"> value ("2026-09-14T10:30" or
// "...:00") into the storage format. Treated as literal wall-clock text —
// no timezone conversion happens here on purpose.
function htmlLocalToStorage(v) {
  if (!v) return null;
  const cleaned = v.trim().replace('T', ' ');
  if (!cleaned) return null;
  return cleaned.length === 16 ? cleaned + ':00' : cleaned;
}

// Convert a stored timestamp back into the value an
// <input type="datetime-local"> expects.
function storageToHtmlLocal(v) {
  if (!v) return '';
  return v.replace('T', ' ').replace(' ', 'T').slice(0, 16);
}

// Best-effort parser for whatever date/time text shows up in an imported CSV
// column. Supports "YYYY-MM-DD", "MM/DD/YYYY", and "M/D/YY", each optionally
// followed by a time ("14:30", "2:30 PM", "14:30:00"). Returns a storage
// string, or null if the text isn't recognized (defaults to "now" then).
// Pure string parsing on purpose — avoids any Date-object timezone
// ambiguity for date-only values.
function parseLeadDateString(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const parts = s.split(/[T ]+/);
  const datePart = parts[0];
  const timePart = parts.slice(1).join(' ') || null;

  let y, mo, d, m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(datePart))) {
    y = +m[1]; mo = +m[2]; d = +m[3];
  } else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(datePart))) {
    mo = +m[1]; d = +m[2]; y = +m[3];
  } else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(datePart))) {
    mo = +m[1]; d = +m[2]; y = 2000 + (+m[3]);
  } else {
    return null;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;

  let hh = 12, mi = 0, ss = 0; // default to noon when no time given, to avoid day-boundary ambiguity
  if (timePart) {
    const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?$/.exec(timePart.trim());
    if (tm) {
      hh = parseInt(tm[1], 10);
      mi = parseInt(tm[2], 10);
      ss = tm[3] ? parseInt(tm[3], 10) : 0;
      const ap = tm[4] ? tm[4].toUpperCase() : null;
      if (ap === 'PM' && hh < 12) hh += 12;
      if (ap === 'AM' && hh === 12) hh = 0;
    }
  }
  return `${y}-${pad(mo)}-${pad(d)} ${pad(hh)}:${pad(mi)}:${pad(ss)}`;
}

module.exports = { htmlLocalToStorage, storageToHtmlLocal, parseLeadDateString };
