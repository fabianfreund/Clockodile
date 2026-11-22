// CSV import. Reads exports from Timemator, Toggl, Clockify, Harvest-like tools and Clockodile
// itself by recognizing column names, then plans what to create (clients, projects, tags) and
// which rows to skip (empty, invalid, already imported). Pure, so it is unit tested.

import { COLORS, uid } from './model.js';
import { MIN, parseClock, parseDuration } from './time.js';

// ── CSV parsing ──────────────────────────────────────────────────────────────

/** RFC 4180-ish parser. Detects , ; or tab from the header line. Returns { headers, rows }. */
export function parseCSV(text) {
  const src = String(text ?? '').replace(/^\ufeff/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const count = (ch) => firstLine.split(ch).length;
  const delim = [';', '\t', ','].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',');
  const out = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) out.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) out.push(row);
  const [headers = [], ...rows] = out;
  return { headers: headers.map((h) => h.trim()), rows, delimiter: delim };
}

// ── Column recognition ───────────────────────────────────────────────────────

const norm = (s) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');

/** Field → accepted (normalized) header names, most specific first. */
const ALIASES = {
  unixStart: ['unixbegin', 'unixstart', 'starttimestamp'],
  unixEnd: ['unixend', 'endtimestamp'],
  date: ['date', 'startdate', 'day', 'datum'],
  start: ['begin', 'start', 'starttime', 'from', 'beginn', 'von'],
  endDate: ['enddate'],
  end: ['end', 'endtime', 'to', 'until', 'ende', 'bis'],
  hours: ['durationdecimal', 'hours', 'decimalduration', 'durationh', 'stunden'],
  duration: ['duration', 'time', 'dauer'],
  client: ['client', 'customer', 'company', 'kunde', 'folder'],
  project: ['project', 'projekt', 'task', 'job'],
  note: ['note', 'notes', 'description', 'comment', 'beschreibung', 'notiz'],
  tags: ['tags', 'tag', 'labels'],
  billable: ['billable', 'abrechenbar'],
  rate: ['hourlyrate', 'rate', 'billablerate', 'stundensatz'],
  status: ['billingstatus', 'status', 'invoiced', 'billed'],
};

function mapColumns(headers) {
  const n = headers.map(norm);
  const map = {};
  const used = new Set();
  for (const [field, names] of Object.entries(ALIASES)) {
    for (const name of names) {
      const i = n.findIndex((h, j) => !used.has(j) && h === name);
      if (i >= 0) { map[field] = i; used.add(i); break; }
    }
  }
  return map;
}

function detectSource(headers) {
  const n = new Set(headers.map(norm));
  if (n.has('unixbegin') && n.has('folder')) return 'Timemator';
  if (n.has('hours') && n.has('status') && n.has('note') && n.has('project')) return 'Clockodile';
  if (n.has('description') && n.has('startdate')) return 'Toggl or Clockify';
  return 'CSV';
}

// ── Value parsing ────────────────────────────────────────────────────────────

/** "2026-11-20", "20.11.2026", "11/20/2026", "20/11/2026" → local midnight, or NaN. */
export function parseDate(s) {
  const t = String(s ?? '').trim();
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t))) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(t))) return new Date(year(m[3]), +m[2] - 1, +m[1]).getTime();
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t))) {
    // Slashes are US order unless the first number can't be a month.
    const [a, b] = [+m[1], +m[2]];
    return a > 12 ? new Date(year(m[3]), b - 1, a).getTime() : new Date(year(m[3]), a - 1, b).getTime();
  }
  return NaN;
}
const year = (y) => (y.length === 2 ? 2000 + +y : +y);

/** Clock time with optional seconds → minutes after midnight (fractional), or NaN. */
function parseTime(s) {
  const t = String(s ?? '').trim();
  const m = /^(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)?$/i.exec(t);
  if (m) return parseClock(`${m[1]}:${m[2]}${m[4] ?? ''}`) + +m[3] / 60;
  return parseClock(t);
}

function parseDur(s) {
  const t = String(s ?? '').trim();
  const m = /^(\d+):(\d{2}):(\d{2})$/.exec(t);
  if (m) return (+m[1] * 3600 + +m[2] * 60 + +m[3]) * 1000;
  return parseDuration(t);
}

const parseNum = (s) => {
  const t = String(s ?? '').trim().replace(/[^\d.,-]/g, '');
  if (!t) return NaN;
  // "1.234,50" → 1234.50; "1,234.50" → 1234.50; "29,00" → 29
  const lastSep = Math.max(t.lastIndexOf(','), t.lastIndexOf('.'));
  if (lastSep < 0) return Number(t);
  return Number(`${t.slice(0, lastSep).replace(/[.,]/g, '')}.${t.slice(lastSep + 1)}`);
};

const truthy = (s) => /^(yes|y|true|1|ja|x)$/i.test(String(s ?? '').trim());
const falsy = (s) => /^(no|n|false|0|nein)$/i.test(String(s ?? '').trim());

function parseStatus(s) {
  const t = String(s ?? '').trim().toLowerCase();
  if (/paid|bezahlt/.test(t)) return 'paid';
  if (/^(billed|invoiced|abgerechnet|yes|true|1)$/.test(t)) return 'billed';
  return 'unbilled';
}

// ── Rows → entries ───────────────────────────────────────────────────────────

/**
 * Parses a CSV export into neutral rows:
 * { start, end, note, client, project, tags: [names], billable, rate|null, status }.
 */
export function readCSV(text) {
  const { headers, rows } = parseCSV(text);
  const col = mapColumns(headers);
  const source = detectSource(headers);
  const get = (r, f) => (col[f] == null ? '' : (r[col[f]] ?? '').trim());
  const entries = [];
  let invalid = 0, empty = 0;

  for (const r of rows) {
    let start = NaN, end = NaN;
    if (col.unixStart != null && col.unixEnd != null) {
      const a = Number(get(r, 'unixStart')), b = Number(get(r, 'unixEnd'));
      // Seconds or milliseconds.
      start = a < 1e11 ? a * 1000 : a;
      end = b < 1e11 ? b * 1000 : b;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      const day = parseDate(get(r, 'date'));
      const s = parseTime(get(r, 'start'));
      if (!Number.isNaN(day) && !Number.isNaN(s)) {
        start = day + s * MIN;
        const endDay = parseDate(get(r, 'endDate'));
        const e = parseTime(get(r, 'end'));
        if (!Number.isNaN(e)) {
          end = (Number.isNaN(endDay) ? day : endDay) + e * MIN;
          if (end < start && Number.isNaN(endDay)) end += 24 * 60 * MIN; // crosses midnight
        } else {
          const hours = parseNum(get(r, 'hours'));
          const dur = !Number.isNaN(hours) ? hours * 60 * MIN : parseDur(get(r, 'duration'));
          if (!Number.isNaN(dur)) end = start + dur;
        }
      } else if (!Number.isNaN(day)) {
        // Date + duration only: placed at 09:00, one after another.
        const hours = parseNum(get(r, 'hours'));
        const dur = !Number.isNaN(hours) ? hours * 60 * MIN : parseDur(get(r, 'duration'));
        if (!Number.isNaN(dur)) { start = day + 9 * 60 * MIN; end = start + dur; }
      }
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) { invalid++; continue; }
    if (end - start <= 0) { empty++; continue; } // keep short entries: they were billed in the source

    const billableRaw = get(r, 'billable');
    const rate = parseNum(get(r, 'rate'));
    entries.push({
      start: Math.round(start), end: Math.round(end),
      note: get(r, 'note'),
      client: get(r, 'client'),
      project: get(r, 'project'),
      tags: get(r, 'tags').split(/[,;|]/).map((t) => t.trim().replace(/^#/, '')).filter(Boolean),
      billable: falsy(billableRaw) ? false : truthy(billableRaw) || !billableRaw,
      rate: Number.isNaN(rate) ? null : rate,
      status: parseStatus(get(r, 'status')),
    });
  }
  return { source, columns: Object.keys(col), entries, invalid, empty, total: rows.length };
}

// ── Plan against the current database ────────────────────────────────────────

const key = (s) => s.trim().toLowerCase();

/**
 * Works out what an import adds: new clients, projects and tags (matched by name), and the
 * entries that aren't already in the database. Returns the `db.merge` operation plus a summary.
 */
export function planImport(db, read) {
  const clients = new Map(db.clients.map((c) => [key(c.name), c]));
  const projects = new Map(db.projects.map((p) => [`${p.clientId ?? ''}|${key(p.name)}`, p]));
  const tags = new Map(db.tags.map((t) => [key(t.name), t]));
  const add = { clients: [], projects: [], tags: [] };
  let color = db.projects.length;

  const clientFor = (name) => {
    if (!name) return null;
    let c = clients.get(key(name));
    if (!c) { c = { id: uid(), name: name.trim(), rate: null }; clients.set(key(name), c); add.clients.push(c); }
    return c;
  };
  const projectFor = (name, client) => {
    if (!name) return null;
    const k = `${client?.id ?? ''}|${key(name)}`;
    let p = projects.get(k);
    if (!p) {
      p = { id: uid(), name: name.trim(), clientId: client?.id ?? null, color: COLORS[color++ % COLORS.length], rate: null, billable: true };
      projects.set(k, p); add.projects.push(p);
    }
    return p;
  };
  const tagFor = (name) => {
    let t = tags.get(key(name));
    if (!t) { t = { id: uid(), name: name.trim() }; tags.set(key(name), t); add.tags.push(t); }
    return t.id;
  };

  // Already imported? Same start, end (to the second) and project means duplicate.
  // Only compared with what's already in Clockodile, never within the file itself.
  const sigOf = (start, end, pid) => `${Math.round(start / 1000)}|${Math.round(end / 1000)}|${pid ?? ''}`;
  const seen = new Set(db.entries.map((e) => sigOf(e.start, e.end ?? 0, e.projectId)));
  const entries = [];
  let duplicates = 0;
  // New projects take the rate of their most recent entry; older entries keep theirs as an override.
  const sorted = [...read.entries].sort((a, b) => a.start - b.start);
  for (const r of sorted) {
    const client = clientFor(r.client);
    // A row with a client but no project gets a project named after the client.
    const project = projectFor(r.project || (client ? client.name : ''), client);
    if (seen.has(sigOf(r.start, r.end, project?.id))) { duplicates++; continue; }
    if (project && add.projects.includes(project) && r.rate != null) project.rate = r.rate;
    entries.push({
      id: uid(), note: r.note, projectId: project?.id ?? null, tags: r.tags.map(tagFor),
      start: r.start, end: r.end, billable: r.billable, status: r.status, rate: r.rate,
    });
  }
  // Keep a per-entry rate only where it differs from what the project would charge.
  const projectById = new Map([...projects.values()].map((p) => [p.id, p]));
  const clientById = new Map([...clients.values()].map((c) => [c.id, c]));
  const projectRate = (pid) => {
    const p = projectById.get(pid);
    return p?.rate ?? clientById.get(p?.clientId)?.rate ?? db.settings.rate ?? 0;
  };
  for (const e of entries) if (e.rate == null || e.rate === projectRate(e.projectId)) delete e.rate;

  const range = entries.length ? [entries[0].start, entries[entries.length - 1].end] : null;
  return {
    op: { type: 'db.merge', ...add, entries },
    summary: {
      source: read.source, total: read.total, entries: entries.length, duplicates, invalid: read.invalid, empty: read.empty, range,
      clients: add.clients.map((c) => c.name), projects: add.projects.map((p) => ({ name: p.name, color: p.color, client: clientById.get(p.clientId)?.name ?? '' })),
      tags: add.tags.map((t) => t.name),
      statuses: entries.reduce((m, e) => ({ ...m, [e.status]: (m[e.status] ?? 0) + 1 }), {}),
    },
  };
}
