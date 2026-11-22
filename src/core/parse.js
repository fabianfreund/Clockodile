// Quick entry: one line of text becomes a timer or a finished entry.
//
//   Design review @acme #meeting          → starts a timer on project "acme" with tag "meeting"
//   Design review @acme 1h30              → logs 1h 30m ending now
//   Standup 9:30-9:45 #meeting            → logs 09:30–09:45 today
//   Invoice prep 45m yesterday @admin     → logs 45 minutes yesterday
//
// Unknown #tags are created. An unknown @project stays in the note and is reported in `unknownProject`.

import { findProject, tagByName } from './model.js';
import { MIN, addDays, parseClock, parseDuration, startOfDay } from './time.js';

const DURATION = /^(\d+(?:[.,]\d+)?h(?:\d+m?)?|\d+m(?:in)?|\d+:[0-5]\d)$/i;
const RANGE = /^(\d{1,2}(?:[:.]\d{2})?(?:am|pm)?)[-–](\d{1,2}(?:[:.]\d{2})?(?:am|pm)?)$/i;

export function parseQuick(db, text, now = Date.now()) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const note = [];
  const tags = [], newTags = [];
  let projectId = null, unknownProject = null, duration = null, range = null, dayOffset = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    let m;
    if (w.startsWith('@') && w.length > 1) {
      // Greedy: "@acme website" matches a project called "Acme Website" before "Acme".
      let hit = null, used = 0;
      for (let n = Math.min(4, words.length - i); n >= 1 && !hit; n--) {
        const q = [w.slice(1), ...words.slice(i + 1, i + n)].join(' ');
        const p = findProject(db, q);
        if (p) { hit = p; used = n; }
      }
      if (hit) { projectId = hit.id; i += used - 1; } else { unknownProject = w.slice(1); note.push(w); }
    } else if (w.startsWith('#') && w.length > 1) {
      const t = tagByName(db, w.slice(1));
      if (t) tags.push(t.id); else newTags.push(w.slice(1));
    } else if (DURATION.test(w) && duration == null && !range) {
      duration = parseDuration(w);
    } else if ((m = RANGE.exec(w)) && !range && duration == null) {
      const a = parseClock(m[1]), b = parseClock(m[2]);
      if (Number.isNaN(a) || Number.isNaN(b)) note.push(w); else range = [a, b];
    } else if (/^yesterday$/i.test(w)) {
      dayOffset = -1;
    } else {
      note.push(w);
    }
  }

  const day = addDays(startOfDay(now), dayOffset);
  let start = null, end = null;
  if (range) {
    start = day + range[0] * MIN;
    end = day + range[1] * MIN;
    if (end <= start) end += 24 * 60 * MIN; // 23:00-01:00 crosses midnight
  } else if (duration) {
    end = addDays(now, dayOffset);
    start = end - duration;
  }
  return { note: note.join(' '), projectId, unknownProject, tags, newTags, start, end };
}

/** Turns a parsed quick entry into the operation to run. */
export function quickOp(parsed) {
  const { note, projectId, tags, newTags, start, end } = parsed;
  if (start != null && end != null) return { type: 'entry.add', entry: { note, projectId, tags, start, end }, newTags };
  return { type: 'timer.start', note, projectId, tags, newTags };
}
