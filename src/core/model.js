// Clockodile data model: the database shape, a pure reducer for every change, and selectors.
//
// The main process owns the database. Windows send operations ({ type, ...payload }), the main
// process runs them through apply(), saves, and broadcasts the new database to every window.
// The running timer is simply the one entry whose `end` is null.

import { MIN } from './time.js';

export const SCHEMA = 1;
export const STATUSES = ['unbilled', 'billed', 'paid'];
/** Entries shorter than this are dropped when a timer stops (accidental start/stop). */
export const MIN_ENTRY = MIN;

/** Project / tag colors, picked to read well on light and dark backgrounds. */
export const COLORS = [
  '#34c77b', '#0a84ff', '#ff9f0a', '#ff453a', '#bf5af2',
  '#ff375f', '#64d2ff', '#ffd60a', '#30b0a7', '#8e8e93',
];

export const DEFAULT_SETTINGS = {
  currency: 'EUR',
  rate: 0,                 // default hourly rate when neither project nor client has one
  rounding: 0,             // minutes; reports and PDFs round each entry up to this step (0 = exact)
  weekStart: 1,            // 0 = Sunday, 1 = Monday
  idleMinutes: 5,          // ask what to do with idle time after this long away (0 = off)
  showTimerInMenuBar: true,
  shortcut: 'Alt+Shift+T',
  business: { name: '', details: '' }, // shown in the PDF header
  // What the main window's sidebar shows. projects: 'recent' | 'pinned' | 'all' | 'hidden'.
  sidebar: { today: true, week: true, unbilled: true, timer: true, projects: 'recent' },
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function emptyDb() {
  return { schema: SCHEMA, clients: [], projects: [], tags: [], entries: [], settings: structuredClone(DEFAULT_SETTINGS) };
}

const num = (v, d = null) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v, d = '') => (typeof v === 'string' ? v : d);

/** Normalizes anything read from disk or imported into a valid database. Unknown fields are dropped. */
export function migrate(raw) {
  const db = emptyDb();
  if (!raw || typeof raw !== 'object') return db;
  db.settings = { ...db.settings, ...(raw.settings ?? {}) };
  db.settings.business = { ...DEFAULT_SETTINGS.business, ...(raw.settings?.business ?? {}) };
  db.settings.sidebar = { ...DEFAULT_SETTINGS.sidebar, ...(raw.settings?.sidebar ?? {}) };
  db.clients = (raw.clients ?? []).filter((c) => c?.id).map((c) => ({
    id: str(c.id), name: str(c.name, 'Client'), rate: num(c.rate), archived: !!c.archived,
  }));
  const clientIds = new Set(db.clients.map((c) => c.id));
  db.projects = (raw.projects ?? []).filter((p) => p?.id).map((p, i) => ({
    id: str(p.id), name: str(p.name, 'Project'), clientId: clientIds.has(p.clientId) ? p.clientId : null,
    color: str(p.color, COLORS[i % COLORS.length]), rate: num(p.rate), billable: p.billable !== false, archived: !!p.archived,
    pinned: !!p.pinned,
  }));
  db.tags = (raw.tags ?? []).filter((t) => t?.id).map((t) => ({ id: str(t.id), name: str(t.name, 'tag') }));
  const projectIds = new Set(db.projects.map((p) => p.id));
  const tagIds = new Set(db.tags.map((t) => t.id));
  let running = false;
  db.entries = (raw.entries ?? []).filter((e) => e?.id && num(e.start) != null).map((e) => {
    let end = num(e.end);
    if (end == null) { if (running) end = e.start; running = true; } // at most one running timer
    return {
      id: str(e.id), note: str(e.note), projectId: projectIds.has(e.projectId) ? e.projectId : null,
      tags: (Array.isArray(e.tags) ? e.tags : []).filter((t) => tagIds.has(t)),
      start: e.start, end, billable: e.billable !== false,
      status: STATUSES.includes(e.status) ? e.status : 'unbilled',
      ...(num(e.rate) != null ? { rate: e.rate } : {}),
    };
  });
  return db;
}

// ── Selectors ────────────────────────────────────────────────────────────────

export const byId = (list, id) => (id == null ? undefined : list.find((x) => x.id === id));
export const running = (db) => db.entries.find((e) => e.end == null);
export const durationOf = (e, now = Date.now()) => Math.max(0, (e.end ?? now) - e.start);

/** Hourly rate for an entry: its own (imported history) → project → client → default. */
export function rateFor(db, entry) {
  if (num(entry.rate) != null) return entry.rate;
  const p = byId(db.projects, entry.projectId);
  const c = p && byId(db.clients, p.clientId);
  return p?.rate ?? c?.rate ?? db.settings.rate ?? 0;
}

export function projectLabel(db, projectId) {
  const p = byId(db.projects, projectId);
  if (!p) return 'No project';
  const c = byId(db.clients, p.clientId);
  return c ? `${p.name} · ${c.name}` : p.name;
}

/** Finds a tag by name (case-insensitive). */
export const tagByName = (db, name) => db.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
/** Finds a project by name or "client/project" prefix (case-insensitive, prefers exact, skips archived). */
export function findProject(db, query) {
  const q = query.toLowerCase().replace(/[-_]/g, ' ');
  const live = db.projects.filter((p) => !p.archived);
  const norm = (s) => s.toLowerCase().replace(/[-_]/g, ' ');
  return live.find((p) => norm(p.name) === q)
    ?? live.find((p) => norm(byId(db.clients, p.clientId)?.name ?? '') === q)
    ?? live.find((p) => norm(p.name).startsWith(q))
    ?? live.find((p) => norm(p.name).replace(/\s/g, '') === q.replace(/\s/g, ''));
}

/** Most recently used distinct (note, project, tags) combinations, for quick restarts. */
export function recents(db, limit = 6) {
  const seen = new Set(), out = [];
  for (const e of [...db.entries].sort((a, b) => b.start - a.start)) {
    if (e.end == null) continue;
    const key = `${e.note}|${e.projectId}|${e.tags.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

// ── Reducer ──────────────────────────────────────────────────────────────────

function check(cond, msg) { if (!cond) throw new Error(msg); }

function cleanEntry(db, e) {
  const tagIds = new Set(db.tags.map((t) => t.id));
  const out = {
    id: e.id ?? uid(), note: str(e.note).trim(), projectId: byId(db.projects, e.projectId) ? e.projectId : null,
    tags: [...new Set((e.tags ?? []).filter((t) => tagIds.has(t)))], start: e.start, end: e.end ?? null,
    billable: e.billable ?? byId(db.projects, e.projectId)?.billable ?? true,
    status: STATUSES.includes(e.status) ? e.status : 'unbilled',
  };
  if (num(e.rate) != null) out.rate = e.rate;
  check(num(out.start) != null, 'Entry needs a start time');
  check(out.end == null || out.end > out.start, 'End must be after start');
  return out;
}

/** Ends the running timer at `end`. Entries under MIN_ENTRY are dropped. */
function stopRunning(db, end) {
  const r = running(db);
  if (!r) return db;
  const stop = Math.max(end, r.start);
  if (stop - r.start < MIN_ENTRY) return { ...db, entries: db.entries.filter((e) => e !== r) };
  return { ...db, entries: db.entries.map((e) => (e === r ? { ...e, end: stop } : e)) };
}

function upsert(list, item) {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? { ...x, ...item } : x)) : [...list, item];
}

/** Ensures tags named in op.newTags exist and returns [db, ids]. Lets the quick entry create tags inline. */
function withTags(db, ids = [], names = []) {
  let tags = db.tags;
  const out = [...ids];
  for (const raw of names) {
    const name = raw.trim().replace(/^#/, '');
    if (!name) continue;
    let t = tags.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!t) { t = { id: uid(), name }; tags = [...tags, t]; }
    out.push(t.id);
  }
  return [{ ...db, tags }, out];
}

/**
 * Applies one operation and returns the new database (the input is never mutated).
 * Throws on invalid input; the caller reports the message.
 */
export function apply(db, op, now = Date.now()) {
  switch (op.type) {
    case 'timer.start': {
      // Starting a timer stops the running one first (one timer at a time).
      let next = stopRunning(db, now);
      let tags;
      [next, tags] = withTags(next, op.tags, op.newTags);
      const entry = cleanEntry(next, { note: op.note, projectId: op.projectId, tags, start: op.start ?? now, end: null, billable: op.billable });
      return { ...next, entries: [...next.entries, entry] };
    }
    case 'timer.stop':
      return stopRunning(db, op.end ?? now);
    case 'timer.discard':
      return { ...db, entries: db.entries.filter((e) => e.end != null) };
    case 'entry.add': {
      let [next, tags] = withTags(db, op.entry.tags, op.newTags);
      const entry = cleanEntry(next, { ...op.entry, id: undefined, tags });
      check(entry.end != null, 'A new entry needs an end time; use timer.start for a running one');
      return { ...next, entries: [...next.entries, entry] };
    }
    case 'entry.update': {
      const old = byId(db.entries, op.id);
      check(old, 'Entry not found');
      let [next, tags] = withTags(db, op.patch.tags ?? old.tags, op.newTags);
      const entry = cleanEntry(next, { ...old, ...op.patch, id: old.id, tags });
      if (old.end != null) check(entry.end != null, 'Cannot reopen a finished entry');
      return { ...next, entries: next.entries.map((e) => (e.id === old.id ? entry : e)) };
    }
    case 'entry.delete': {
      const ids = new Set(op.ids);
      return { ...db, entries: db.entries.filter((e) => !ids.has(e.id)) };
    }
    case 'entry.status': {
      check(STATUSES.includes(op.status), 'Unknown status');
      const ids = new Set(op.ids);
      return { ...db, entries: db.entries.map((e) => (ids.has(e.id) ? { ...e, status: op.status } : e)) };
    }
    case 'entry.continue': {
      const e = byId(db.entries, op.id);
      check(e, 'Entry not found');
      return apply(db, { type: 'timer.start', note: e.note, projectId: e.projectId, tags: e.tags, billable: e.billable }, now);
    }
    case 'client.save': {
      check(str(op.client.name).trim(), 'Client needs a name');
      const c = { id: op.client.id ?? uid(), name: op.client.name.trim(), rate: num(op.client.rate), archived: !!op.client.archived };
      return { ...db, clients: upsert(db.clients, c) };
    }
    case 'client.delete': {
      // Projects of a deleted client stay, without a client.
      return {
        ...db,
        clients: db.clients.filter((c) => c.id !== op.id),
        projects: db.projects.map((p) => (p.clientId === op.id ? { ...p, clientId: null } : p)),
      };
    }
    case 'project.save': {
      const p = op.project;
      check(str(p.name).trim(), 'Project needs a name');
      const old = byId(db.projects, p.id);
      const project = {
        id: p.id ?? uid(), name: p.name.trim(), clientId: byId(db.clients, p.clientId) ? p.clientId : null,
        color: str(p.color, old?.color ?? COLORS[db.projects.length % COLORS.length]),
        rate: num(p.rate), billable: p.billable ?? old?.billable ?? true, archived: !!p.archived,
        pinned: p.pinned ?? old?.pinned ?? false,
      };
      return { ...db, projects: upsert(db.projects, project) };
    }
    case 'project.delete': {
      // Entries stay, without a project.
      return {
        ...db,
        projects: db.projects.filter((p) => p.id !== op.id),
        entries: db.entries.map((e) => (e.projectId === op.id ? { ...e, projectId: null } : e)),
      };
    }
    case 'tag.save': {
      const name = str(op.tag.name).trim().replace(/^#/, '');
      check(name, 'Tag needs a name');
      const clash = tagByName(db, name);
      check(!clash || clash.id === op.tag.id, `Tag "${name}" already exists`);
      return { ...db, tags: upsert(db.tags, { id: op.tag.id ?? uid(), name }) };
    }
    case 'tag.delete':
      return {
        ...db,
        tags: db.tags.filter((t) => t.id !== op.id),
        entries: db.entries.map((e) => (e.tags.includes(op.id) ? { ...e, tags: e.tags.filter((t) => t !== op.id) } : e)),
      };
    case 'settings.update': {
      const patch = { ...op.patch };
      if (patch.business) patch.business = { ...db.settings.business, ...patch.business };
      if (patch.sidebar) patch.sidebar = { ...db.settings.sidebar, ...patch.sidebar };
      return { ...db, settings: { ...db.settings, ...patch } };
    }
    case 'db.import':
      return migrate(op.db);
    case 'db.merge': {
      // Adds imported clients, projects, tags and entries in one step (see core/importer.js).
      const has = (list, id) => list.some((x) => x.id === id);
      let next = {
        ...db,
        clients: [...db.clients, ...(op.clients ?? []).filter((c) => c.name && !has(db.clients, c.id)).map((c) => ({ id: c.id, name: c.name, rate: num(c.rate), archived: false }))],
        tags: [...db.tags, ...(op.tags ?? []).filter((t) => t.name && !has(db.tags, t.id)).map((t) => ({ id: t.id, name: t.name }))],
      };
      next = {
        ...next,
        projects: [...next.projects, ...(op.projects ?? []).filter((p) => p.name && !has(db.projects, p.id)).map((p, i) => ({
          id: p.id, name: p.name, clientId: has(next.clients, p.clientId) ? p.clientId : null,
          color: str(p.color, COLORS[(db.projects.length + i) % COLORS.length]), rate: num(p.rate), billable: p.billable !== false, archived: false,
        }))],
      };
      const entries = (op.entries ?? []).filter((e) => e.end != null).map((e) => cleanEntry(next, e));
      return { ...next, entries: [...next.entries, ...entries] };
    }
    default:
      throw new Error(`Unknown operation ${op.type}`);
  }
}
