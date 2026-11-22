// Reports: pick a period and filters, see totals, a chart and breakdowns, mark entries as
// billed/paid, and export a PDF or CSV.
import { byId, STATUSES } from '../../core/model.js';
import { NO_PROJECT, buildReport, defaultFilter, toCSV } from '../../core/report.js';
import {
  HOUR, addDays, addMonths, fmtDuration, fmtHuman, fmtISODate, fmtMoney, fmtRange, parseISODate, rangeFor, startOfDay, startOfMonth, startOfWeek,
} from '../../core/time.js';
import { debounce, h, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { act, api, state } from '../lib/state.js';
import { empty, field, panel, picker, projectItems, segmented, sheet, toast, toggle } from '../lib/widgets.js';
import { openEntrySheet } from './entry-sheet.js';
import { playButton } from '../lib/actions.js';

let period = { unit: 'month', anchor: Date.now(), from: null, to: null };
let filter = { clientIds: [], projectIds: [], tagIds: [], status: 'all', billable: 'all', search: '' };
let breakdown = 'project';
let selected = new Set();
let els = null;
let current = null; // last built report

const UNITS = [{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }, { value: 'all', label: 'All' }, { value: 'custom', label: 'Custom' }];

export const reports = {
  id: 'reports', title: 'Reports', icon: 'chart',

  mount(view, top) {
    els = { top, body: h('div.reports') };
    mount(top.title, h('h1', 'Reports'));
    mount(top.actions,
      h('button.btn.primary', { onclick: () => openExport(), title: 'Export  ⌘E' }, icon('pdf'), 'Export'));
    mount(view, els.body);
    selected = new Set();
  },

  update(db) { render(db); },

  /** Opens the report pre-filtered (from the sidebar). */
  open(params = {}) {
    filter = { ...filter, clientIds: [], projectIds: [], tagIds: [], status: 'all', ...params.filter };
    if (params.unit) period = { ...period, unit: params.unit, anchor: Date.now() };
  },

  command(cmd) {
    if (cmd === 'export') openExport();
  },
};

function range(db) {
  const ws = db.settings.weekStart;
  const a = period.anchor;
  switch (period.unit) {
    case 'week': { const s = startOfWeek(a, ws); return [s, addDays(s, 7)]; }
    case 'month': { const s = startOfMonth(a); return [s, addMonths(s, 1)]; }
    case 'year': { const y = new Date(a).getFullYear(); return [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()]; }
    case 'custom': return [period.from ?? rangeFor('month')[0], period.to ?? rangeFor('month')[1]];
    default: {
      const first = db.entries.reduce((m, e) => Math.min(m, e.start), Date.now());
      return [startOfDay(first), addDays(startOfDay(Date.now()), 1)];
    }
  }
}

function shift(dir) {
  const a = new Date(period.anchor);
  if (period.unit === 'week') period.anchor = addDays(period.anchor, 7 * dir);
  else if (period.unit === 'month') period.anchor = addMonths(period.anchor, dir);
  else if (period.unit === 'year') period.anchor = new Date(a.getFullYear() + dir, 0, 1).getTime();
  selected.clear();
  render(state.db);
}

function periodLabel(from, to) {
  const a = new Date(from);
  if (period.unit === 'month') return a.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  if (period.unit === 'year') return String(a.getFullYear());
  if (period.unit === 'all') return 'All time';
  return fmtRange(from, to);
}

function currentFilter(db) {
  const [from, to] = range(db);
  return { ...defaultFilter(from, to), ...filter };
}

function render(db) {
  const f = currentFilter(db);
  const r = buildReport(db, f);
  current = r;
  const money = (n) => fmtMoney(n, db.settings.currency);
  for (const id of selected) if (!r.rows.some((x) => x.id === id)) selected.delete(id);

  const periodBar = h('div.report-period',
    segmented(UNITS, period.unit, (v) => {
      if (v === 'custom') { const [a, b] = range(db); period = { ...period, unit: v, from: a, to: b }; } else period = { ...period, unit: v, anchor: Date.now() };
      selected.clear(); render(state.db);
    }),
    period.unit === 'custom'
      ? h('div.custom-range',
        h('input.input', { type: 'date', value: fmtISODate(f.from), onchange: (e) => { const d = parseISODate(e.target.value); if (!Number.isNaN(d)) { period.from = d; render(state.db); } } }),
        h('span.muted', '–'),
        h('input.input', { type: 'date', value: fmtISODate(f.to - 1), onchange: (e) => { const d = parseISODate(e.target.value); if (!Number.isNaN(d)) { period.to = addDays(d, 1); render(state.db); } } }))
      : h('div.period-nav',
        period.unit !== 'all' && h('button.icon-btn', { onclick: () => shift(-1), title: 'Previous' }, icon('left')),
        h('span.period-label', periodLabel(f.from, f.to)),
        period.unit !== 'all' && h('button.icon-btn', { onclick: () => shift(1), title: 'Next' }, icon('right'))));

  const filters = h('div.report-filters',
    filterChip(db, 'Client', 'client', filter.clientIds, db.clients.map((c) => ({ id: c.id, label: c.name }))),
    filterChip(db, 'Project', 'folder', filter.projectIds, [{ id: NO_PROJECT, label: 'No project' }, ...projectItems(db).filter((p) => p.id).map((p) => ({ ...p, id: p.id, sub: p.group }))], 'projectIds'),
    filterChip(db, 'Tag', 'tag', filter.tagIds, db.tags.map((t) => ({ id: t.id, label: t.name })), 'tagIds'),
    choiceChip('Status', 'receipt', 'status', [{ value: 'all', label: 'Any status' }, ...STATUSES.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))]),
    choiceChip('Billable', 'coin', 'billable', [{ value: 'all', label: 'Billable and not' }, { value: 'billable', label: 'Billable' }, { value: 'nonbillable', label: 'Not billable' }]),
    h('div.search', icon('search'), h('input', { placeholder: 'Search', value: filter.search, oninput: debounce((e) => { filter.search = e.target.value; render(state.db); requestAnimationFrame(() => { const s = els.body.querySelector('.search input'); s?.focus(); s?.setSelectionRange(s.value.length, s.value.length); }); }, 200) })));

  const tiles = h('div.tiles',
    tile('Total', fmtHuman(r.total)),
    tile('Billable', fmtHuman(r.billable)),
    tile('Amount', money(r.amount)),
    h('button.tile.tile-btn', { class: r.unbilled ? 'warn' : '', title: 'Show unbilled', onclick: () => { filter.status = 'unbilled'; render(state.db); } },
      h('span.tile-label', 'Unbilled'), h('span.tile-value.num', money(r.unbilled))));

  if (!r.rows.length) {
    mount(els.body, periodBar, filters, tiles, h('div.card', empty('chart', 'No entries')));
    return;
  }

  mount(els.body, periodBar, filters, tiles,
    h('div.card.chart-card', chart(db, r, f)),
    h('div.card.breakdown-card',
      h('div.card-head', h('h3', 'Breakdown'), segmented([{ value: 'project', label: 'Project' }, { value: 'client', label: 'Client' }, { value: 'tag', label: 'Tag' }], breakdown, (v) => { breakdown = v; render(state.db); })),
      breakdownTable(db, r, money)),
    h('div.card.entries-card', entriesTable(db, r, money)));
}

function tile(label, value) {
  return h('div.tile', h('span.tile-label', label), h('span.tile-value.num', value));
}

/** Single-choice filter (status, billable) as a chip with a small menu. */
function choiceChip(label, ic, key, options) {
  const cur = options.find((o) => o.value === filter[key]);
  const on = filter[key] !== 'all';
  return h('button.chip', {
    class: on ? 'on' : '',
    onclick: (e) => {
      const m = panel(e.currentTarget, options.map((o) => h('button.menu-item', {
        onclick: () => { m.close(); filter[key] = o.value; render(state.db); },
      }, h('span.picker-check', o.value === filter[key] ? icon('check') : null), o.label)), { width: 190 });
    },
  }, icon(ic), on ? cur.label : label,
  on ? h('span.chip-x', { onclick: (e) => { e.stopPropagation(); filter[key] = 'all'; render(state.db); } }, icon('x')) : icon('down'));
}

function filterChip(db, label, ic, ids, items, key) {
  key ??= `${label.toLowerCase()}Ids`;
  const names = ids.map((id) => items.find((i) => i.id === id)?.label).filter(Boolean);
  return h('button.chip', {
    class: names.length ? 'on' : '',
    onclick: (e) => {
      const mk = () => items.map((i) => ({ ...i, checked: filter[key].includes(i.id) }));
      const p = picker(e.currentTarget, {
        items: mk(), multi: true, placeholder: `Filter by ${label.toLowerCase()}`,
        onPick: (it) => {
          filter[key] = filter[key].includes(it.id) ? filter[key].filter((x) => x !== it.id) : [...filter[key], it.id];
          render(state.db); p.refresh(mk()); return true;
        },
      });
    },
  }, icon(ic), names.length ? (names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0]) : label,
  names.length ? h('span.chip-x', { onclick: (e) => { e.stopPropagation(); filter[key] = []; render(state.db); } }, icon('x')) : icon('down'));
}

// ── Chart: one stacked bar per day (or per month for long ranges) ───────────
function chart(db, r, f) {
  const monthly = f.to - f.from > 70 * 24 * HOUR;
  const buckets = new Map();
  const keyOf = (t) => (monthly ? startOfMonth(t) : startOfDay(t));
  if (monthly) { for (let m = startOfMonth(f.from); m < f.to; m = addMonths(m, 1)) buckets.set(m, new Map()); }
  else for (const d of r.byDay) buckets.set(d.day, new Map());
  for (const row of r.rows) {
    const k = keyOf(row.start);
    if (!buckets.has(k)) buckets.set(k, new Map());
    const b = buckets.get(k);
    const pk = row.projectId ?? NO_PROJECT;
    b.set(pk, (b.get(pk) ?? 0) + row.dur);
  }
  const cols = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  const totals = cols.map(([, m]) => [...m.values()].reduce((a, b) => a + b, 0));
  const max = Math.max(HOUR, ...totals);
  const step = niceStep(max / HOUR);
  const top = Math.ceil(max / HOUR / step) * step;
  const labelEvery = cols.length > 16 ? Math.ceil(cols.length / 12) : 1;
  const today = startOfDay(Date.now());

  return h('div.chart',
    h('div.chart-y', Array.from({ length: Math.round(top / step) + 1 }, (_, i) => h('span', `${top - i * step}h`))),
    h('div.chart-plot',
      h('div.chart-grid', Array.from({ length: Math.round(top / step) + 1 }, () => h('span'))),
      h('div.chart-cols', cols.map(([k, m], i) => h('div.chart-col', {
        class: !monthly && k === today ? 'today' : '',
        title: `${monthly ? new Date(k).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : new Date(k).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${fmtHuman(totals[i])}`,
      },
      h('div.chart-stack', { style: { height: `${(totals[i] / (top * HOUR)) * 100}%` } },
        [...m.entries()].sort((a, b) => b[1] - a[1]).map(([pid, dur]) => h('span', { style: { flex: dur, background: byId(db.projects, pid)?.color ?? 'var(--fg3)' } }))),
      h('span.chart-x', i % labelEvery === 0 ? (monthly ? new Date(k).toLocaleDateString(undefined, { month: 'short' }) : cols.length > 7 ? new Date(k).getDate() : new Date(k).toLocaleDateString(undefined, { weekday: 'short' })) : ''))))));
}

function niceStep(maxH) {
  for (const s of [1, 2, 4, 5, 10, 20, 25, 50, 100, 200, 250, 500]) if (maxH / s <= 5) return s;
  return 1000;
}

// ── Breakdown ────────────────────────────────────────────────────────────────
function breakdownTable(db, r, money) {
  const groups = breakdown === 'client' ? r.byClient : breakdown === 'tag' ? r.byTag : r.byProject;
  const max = Math.max(...groups.map((g) => g.dur), 1);
  return h('div.bd', groups.map((g) => h('div.bd-row',
    h('div.bd-name',
      breakdown === 'project' ? playButton(g.key === NO_PROJECT ? null : g.key, { name: g.name }) : null,
      g.color && h('span.dot', { style: { background: g.color } }), h('span', g.name), g.client && h('span.muted', g.client)),
    h('div.bd-bar', h('span', { style: { width: `${(g.dur / max) * 100}%`, background: g.color ?? 'var(--accent)' } })),
    h('span.bd-pct.num', r.total ? `${Math.round((g.dur / r.total) * 100)}%` : ''),
    h('span.bd-dur.num', fmtDuration(g.dur)),
    h('span.bd-amt.num', g.amount ? money(g.amount) : '—'))));
}

// ── Entries with bulk status actions ─────────────────────────────────────────
function entriesTable(db, r, money) {
  const all = r.rows.length > 0 && r.rows.every((x) => selected.has(x.id));
  const toggleAll = () => { if (all) selected.clear(); else r.rows.forEach((x) => selected.add(x.id)); render(state.db); };
  const ids = [...selected];
  const setStatus = async (status) => {
    if (await act({ type: 'entry.status', ids, status })) toast(`${ids.length} ${ids.length === 1 ? 'entry' : 'entries'} marked as ${status}`);
    selected.clear(); render(state.db);
  };
  const remove = async () => {
    if (!(await api.confirm(`Delete ${ids.length} ${ids.length === 1 ? 'entry' : 'entries'}?`, 'This can’t be undone.'))) return;
    await act({ type: 'entry.delete', ids }); selected.clear();
  };

  const head = h('div.card-head',
    h('label.check', h('input', { type: 'checkbox', checked: all, onchange: toggleAll }), h('h3', 'Entries')),
    selected.size
      ? h('div.bulk',
        h('span.muted', `${selected.size} selected`),
        h('button.btn.small', { onclick: () => setStatus('billed') }, icon('receipt'), 'Mark Billed'),
        h('button.btn.small', { onclick: () => setStatus('paid') }, icon('check'), 'Mark Paid'),
        h('button.btn.small', { onclick: () => setStatus('unbilled') }, icon('undo'), 'Unbilled'),
        h('button.icon-btn', { onclick: remove, title: 'Delete' }, icon('trash')))
      : h('span.muted', `${r.rows.length} ${r.rows.length === 1 ? 'entry' : 'entries'} · ${fmtHuman(r.total)}`));

  let lastDay = null;
  const rows = [];
  for (const row of [...r.rows].reverse()) {
    const d = startOfDay(row.start);
    if (d !== lastDay) {
      lastDay = d;
      const dayTotal = r.byDay.find((x) => x.day === d)?.dur ?? 0;
      rows.push(h('div.et-day', h('span', new Date(d).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })), h('span.num', fmtDuration(dayTotal))));
    }
    rows.push(h('div.et-row', {
      class: selected.has(row.id) ? 'sel' : '',
      onclick: (e) => { if (!e.target.closest('input, button')) openEntrySheet(db.entries.find((x) => x.id === row.id)); },
    },
    h('input', { type: 'checkbox', checked: selected.has(row.id), onchange: (e) => { if (e.target.checked) selected.add(row.id); else selected.delete(row.id); render(state.db); } }),
    h('span.dot', { style: { background: row.project?.color ?? 'transparent' }, class: row.project ? '' : 'none' }),
    h('div.et-main',
      h('span.et-note', { class: row.note ? '' : 'muted' }, row.note || 'No description'),
      h('span.et-meta', row.project ? row.project.name : 'No project', row.client ? ` · ${row.client.name}` : '', row.tagNames.map((t) => h('span.tag', t)))),
    h('span.pill', { class: row.status }, row.status[0].toUpperCase() + row.status.slice(1)),
    h('span.et-dur.num', fmtDuration(row.dur)),
    h('span.et-amt.num', row.billable ? money(row.amount) : h('span.muted', 'n/b'))));
  }
  return [head, h('div.et', rows)];
}

// ── Exports ──────────────────────────────────────────────────────────────────
function baseName(db) {
  const f = current.filter;
  const clients = filter.clientIds.map((id) => byId(db.clients, id)?.name).filter(Boolean);
  const who = clients.length === 1 ? `${clients[0]} ` : '';
  return `${who}Timesheet ${fmtISODate(f.from)} to ${fmtISODate(f.to - 1)}`.replace(/[/\\:*?"<>|]/g, '-');
}

const EXPORT_PREFS = 'clockodile.export';
// Set while an export runs; the main process calls it after the save dialog closes.
let busyHandler = null;
api.onExportBusy((name) => busyHandler?.(name));
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(EXPORT_PREFS)) ?? {}; } catch { return {}; }
}

/** One sheet for every export of the current report: PDF timesheet or CSV. */
function openExport() {
  const db = state.db;
  if (!current?.rows.length) return toast('Nothing to export');
  const report = current;
  const clients = filter.clientIds.map((id) => byId(db.clients, id)?.name).filter(Boolean);
  const o = {
    format: 'pdf', groupBy: 'project', showAmounts: true, showEntries: true, showTags: true, excel: false,
    ...loadPrefs(),
    title: 'Timesheet', recipient: clients.length === 1 ? clients[0] : '', markBilled: false,
  };
  const unbilled = report.rows.filter((x) => x.status === 'unbilled').length;
  const opts = h('div.export-opts');
  const fmt = h('div');

  function renderOpts() {
    fmt.replaceChildren(segmented([{ value: 'pdf', label: 'PDF', icon: 'pdf' }, { value: 'csv', label: 'CSV', icon: 'table' }], o.format, (v) => { o.format = v; renderOpts(); }, 'wide'));
    const sub = (cb) => { const d = h('div'); cb(d); return d; };
    opts.replaceChildren(...(o.format === 'pdf'
      ? [
        h('div.row',
          field('Title', h('input.input', { value: o.title, oninput: (e) => { o.title = e.target.value; } })),
          field('For', h('input.input', { value: o.recipient, placeholder: 'Client', oninput: (e) => { o.recipient = e.target.value; } }))),
        field('Group by', sub((d) => {
          const draw = () => d.replaceChildren(segmented([{ value: 'project', label: 'Project' }, { value: 'day', label: 'Day' }, { value: 'none', label: 'None' }], o.groupBy, (v) => { o.groupBy = v; draw(); }));
          draw();
        })),
        h('div.toggles',
          toggle(o.showEntries, (v) => { o.showEntries = v; }, 'Entries'),
          toggle(o.showAmounts, (v) => { o.showAmounts = v; }, 'Rates and amounts'),
          toggle(o.showTags, (v) => { o.showTags = v; }, 'Tags')),
      ]
      : [
        field('Format', sub((d) => {
          const draw = () => d.replaceChildren(segmented([{ value: false, label: 'Standard (comma)' }, { value: true, label: 'Excel (semicolon)' }], o.excel, (v) => { o.excel = v; draw(); }));
          draw();
        })),
      ]),
    unbilled ? h('div.toggles', toggle(o.markBilled, (v) => { o.markBilled = v; }, `Mark ${unbilled} unbilled as billed`)) : null);
  }
  renderOpts();

  async function go(btn) {
    const { format, groupBy, showAmounts, showEntries, showTags, excel } = o;
    try { localStorage.setItem(EXPORT_PREFS, JSON.stringify({ format, groupBy, showAmounts, showEntries, showTags, excel })); } catch {}
    btn.disabled = true;
    // The save dialog comes first; once a file is picked the main process says "busy" and the
    // sheet shows a spinner until the PDF is written.
    busyHandler = (name) => setBusy(true, name);
    const res = format === 'pdf'
      ? await api.exportPdf({ filter: report.filter, options: o, fileName: `${baseName(db)}.pdf` })
      : await api.exportCsv(toCSV(report, { excel }), `${baseName(db)}.csv`);
    busyHandler = null;
    setBusy(false);
    btn.disabled = false;
    if (res.error) return toast(res.error, { tone: 'error' });
    if (!res.ok) return;
    s.close();
    if (o.markBilled) {
      const ids = report.rows.filter((x) => x.status === 'unbilled').map((x) => x.id);
      await act({ type: 'entry.status', ids, status: 'billed' });
      toast(`Exported · ${ids.length} marked billed`, { action: { label: 'Undo', run: () => act({ type: 'entry.status', ids, status: 'unbilled' }) } });
    } else toast('Exported');
  }

  const busy = h('div.sheet-busy', h('span.spinner'), h('b', 'Creating PDF…'), h('span.muted.busy-name'));
  function setBusy(on, name = '') {
    s.el.classList.toggle('busy', on);
    busy.querySelector('.busy-name').textContent = name;
  }

  const s = sheet({
    title: 'Export',
    body: [
      h('div.export-summary', h('b', `${report.rows.length} entries · ${fmtHuman(report.total)}`), h('span.muted', `${fmtRange(report.filter.from, report.filter.to)} · ${fmtMoney(report.amount, db.settings.currency)}`)),
      fmt, opts, busy,
    ],
    width: 460,
    actions: [h('span.spacer'), h('button.btn', { onclick: () => s.close() }, 'Cancel'), h('button.btn.primary', { onclick: (e) => go(e.currentTarget) }, 'Export')],
  });
}
