// Reports: filter entries, total them up, group them, and export CSV. Shared by the Reports
// view, the PDF export and the tests.

import { byId, durationOf, rateFor } from './model.js';
import { HOUR, daysIn, fmtClock, fmtDecimal, fmtISODate, roundUp, startOfDay } from './time.js';

export const NO_PROJECT = '__none__';

export const defaultFilter = (from, to) => ({
  from, to, clientIds: [], projectIds: [], tagIds: [], status: 'all', billable: 'all', search: '',
});

export function matches(db, e, f) {
  if (e.start < f.from || e.start >= f.to) return false;
  if (f.status !== 'all' && e.status !== f.status) return false;
  if (f.billable === 'billable' && !e.billable) return false;
  if (f.billable === 'nonbillable' && e.billable) return false;
  if (f.projectIds.length && !f.projectIds.includes(e.projectId ?? NO_PROJECT)) return false;
  if (f.clientIds.length && !f.clientIds.includes(byId(db.projects, e.projectId)?.clientId)) return false;
  if (f.tagIds.length && !f.tagIds.some((t) => e.tags.includes(t))) return false;
  if (f.search) {
    const q = f.search.toLowerCase();
    const p = byId(db.projects, e.projectId);
    const hay = [e.note, p?.name, byId(db.clients, p?.clientId)?.name, ...e.tags.map((t) => byId(db.tags, t)?.name)].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function group(rows, keyOf, init) {
  const map = new Map();
  for (const r of rows) {
    for (const key of [].concat(keyOf(r))) {
      if (!map.has(key)) map.set(key, { key, ...init(key, r), dur: 0, billableDur: 0, amount: 0, count: 0 });
      const g = map.get(key);
      g.dur += r.dur; g.amount += r.amount; g.count++;
      if (r.billable) g.billableDur += r.dur;
    }
  }
  return [...map.values()].sort((a, b) => b.dur - a.dur);
}

/**
 * Builds a report. Each entry is rounded up to `settings.rounding` minutes (per entry, like most
 * invoicing tools) and priced at its project/client/default rate when billable.
 */
export function buildReport(db, filter, now = Date.now()) {
  const rounding = db.settings.rounding || 0;
  const rows = db.entries
    .filter((e) => matches(db, e, filter))
    .sort((a, b) => a.start - b.start)
    .map((e) => {
      const dur = roundUp(durationOf(e, now), rounding);
      const rate = rateFor(db, e);
      const project = byId(db.projects, e.projectId);
      const client = byId(db.clients, project?.clientId);
      return {
        ...e, dur, rate, amount: e.billable ? (dur / HOUR) * rate : 0, project, client,
        tagNames: e.tags.map((t) => byId(db.tags, t)?.name).filter(Boolean),
      };
    });

  const sum = (list, f) => list.reduce((s, r) => s + f(r), 0);
  // Every day of a bounded range gets a bar (empty days included); "All time" only lists days with entries.
  const days = filter.to - filter.from <= 400 * 24 * HOUR ? daysIn(filter.from, filter.to) : [];
  const byDayMap = new Map(days.map((d) => [d, { day: d, dur: 0, amount: 0 }]));
  for (const r of rows) {
    const d = startOfDay(r.start);
    if (!byDayMap.has(d)) byDayMap.set(d, { day: d, dur: 0, amount: 0 });
    const g = byDayMap.get(d);
    g.dur += r.dur; g.amount += r.amount;
  }

  return {
    filter,
    rows,
    total: sum(rows, (r) => r.dur),
    billable: sum(rows, (r) => (r.billable ? r.dur : 0)),
    amount: sum(rows, (r) => r.amount),
    unbilled: sum(rows, (r) => (r.status === 'unbilled' ? r.amount : 0)),
    byProject: group(rows, (r) => r.projectId ?? NO_PROJECT, (_k, r) => ({
      name: r.project?.name ?? 'No project', client: r.client?.name ?? '', color: r.project?.color ?? '#8e8e93',
    })),
    byClient: group(rows, (r) => r.client?.id ?? NO_PROJECT, (_k, r) => ({ name: r.client?.name ?? 'No client' })),
    byTag: group(rows, (r) => (r.tagNames.length ? r.tagNames : ['Untagged']), (k) => ({ name: k })),
    byDay: [...byDayMap.values()].sort((a, b) => a.day - b.day),
  };
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n;\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * CSV of the report's entries. `excel: true` uses semicolons and decimal commas, which is what
 * Excel and Numbers expect in most European locales.
 */
export function toCSV(report, { excel = false } = {}) {
  const d = excel ? ';' : ',';
  const n = (x) => (excel ? x.replace('.', ',') : x);
  const head = ['Date', 'Start', 'End', 'Hours', 'Client', 'Project', 'Tags', 'Note', 'Billable', 'Rate', 'Amount', 'Status'];
  const lines = report.rows.map((r) => [
    fmtISODate(r.start), fmtClock(r.start), r.end ? fmtClock(r.end) : '', n(fmtDecimal(r.dur)),
    r.client?.name ?? '', r.project?.name ?? '', r.tagNames.join(', '), r.note,
    r.billable ? 'yes' : 'no', n(r.rate.toFixed(2)), n(r.amount.toFixed(2)), r.status,
  ].map(csvCell).join(d));
  return [head.join(d), ...lines].join('\n') + '\n';
}
