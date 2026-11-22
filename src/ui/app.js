// Main window: sidebar navigation + the current view. Views are objects with
// mount(viewEl, topbar, ctx), update(db) and optional command(cmd) / open(params).
import { byId, durationOf, running } from '../core/model.js';
import { buildReport, defaultFilter } from '../core/report.js';
import { fmtDuration, fmtHuman, fmtMoney, rangeFor } from '../core/time.js';
import { $, h, mount } from './lib/dom.js';
import { icon } from './lib/icons.js';
import { act, api, initState, startClock, state, subscribe } from './lib/state.js';
import { closePanel } from './lib/widgets.js';
import { projects } from './views/projects.js';
import { reports } from './views/reports.js';
import { settings } from './views/settings.js';
import { track } from './views/track.js';
import { startImport } from './views/import-sheet.js';

const VIEWS = { track, reports, projects, settings };
const MAIN_NAV = [track, reports, projects];
let current = null;
const top = { title: $('#top-title'), actions: $('#top-actions') };

document.body.classList.add(`os-${api.platform}`);

async function go(id, params) {
  closePanel();
  const view = VIEWS[id] ?? track;
  if (current === view && !params) return;
  current = view;
  view.open?.(params);
  const el = $('#view');
  el.scrollTop = 0;
  el.dataset.view = view.id;
  await view.mount(el, top, { go });
  view.update(state.db);
  renderNav();
}

function renderNav() {
  mount($('#nav'), MAIN_NAV.map((v) => h('button.nav-item', { class: current === v ? 'on' : '', onclick: () => go(v.id) }, icon(v.icon), v.title)));
  const s = $('#nav-settings');
  s.className = `nav-item ${current === settings ? 'on' : ''}`;
  mount(s, icon('gear'), 'Settings');
  s.onclick = () => go('settings');
}

function renderSidebar(db) {
  const [d0, d1] = rangeFor('today');
  const [w0, w1] = rangeFor('week', Date.now(), db.settings.weekStart);
  const sum = (a, b) => db.entries.filter((e) => e.start >= a && e.start < b).reduce((s, e) => s + durationOf(e), 0);
  const unbilled = buildReport(db, { ...defaultFilter(0, 8.64e15), status: 'unbilled', billable: 'billable' }).amount;
  const r = running(db);
  const rp = r && byId(db.projects, r.projectId);

  mount($('#side-stats'),
    r && h('button.side-timer', { onclick: () => go('track'), title: r.note || 'Running timer' },
      h('span.pulse', { style: { background: rp?.color ?? 'var(--accent)' } }),
      h('span.side-timer-note', r.note || rp?.name || 'Timer'),
      h('span.num', { dataset: { since: r.start } }, fmtDuration(Date.now() - r.start, { seconds: true }))),
    h('div.stat', h('span', 'Today'), h('b.num', fmtHuman(sum(d0, d1)))),
    h('div.stat', h('span', 'This week'), h('b.num', fmtHuman(sum(w0, w1)))),
    h('button.stat.link-stat', { onclick: () => go('reports', { unit: 'all', filter: { status: 'unbilled' } }), title: 'Show unbilled entries' },
      h('span', 'Unbilled'), h('b.num', fmtMoney(unbilled, db.settings.currency))));

  // Projects worked on this week, most time first.
  const week = new Map();
  for (const e of db.entries) if (e.start >= w0 && e.start < w1 && e.projectId) week.set(e.projectId, (week.get(e.projectId) ?? 0) + durationOf(e));
  const list = [...week.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, dur]) => [byId(db.projects, id), dur]).filter(([p]) => p);
  mount($('#side-projects'),
    list.length ? h('div.side-label', 'This week') : null,
    list.map(([p, dur]) => h('button.side-project', { onclick: () => go('reports', { unit: 'week', filter: { projectIds: [p.id] } }), title: `${p.name}: ${fmtHuman(dur)}` },
      h('span.dot', { style: { background: p.color } }), h('span.side-project-name', p.name), h('span.num.muted', fmtDuration(dur)))));
}

api.onMenu((cmd) => {
  if (cmd.startsWith('go:')) return go(cmd.slice(3));
  if (['new-entry', 'focus-quick', 'day:prev', 'day:next', 'day:today'].includes(cmd) && current !== track) {
    go('track').then(() => track.command(cmd));
    return;
  }
  if (cmd === 'import') return startImport();
  if (cmd === 'export' && current !== reports) {
    go('reports').then(() => reports.command(cmd));
    return;
  }
  current?.command?.(cmd);
});

// Space bar outside inputs stops the running timer, like a stopwatch.
document.addEventListener('keydown', (e) => {
  if (e.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest('input, textarea, select, button, [contenteditable]') || document.querySelector('.backdrop, .panel')) return;
  const r = running(state.db);
  if (r) { e.preventDefault(); act({ type: 'timer.stop' }); }
});

await initState();
subscribe((db) => { current?.update(db); renderSidebar(db); });
renderSidebar(state.db);
await go('track');
startClock((ms) => fmtDuration(ms, { seconds: true }));
// Re-render the sidebar totals every minute so "Today" keeps up with a running timer.
setInterval(() => renderSidebar(state.db), 60_000);
