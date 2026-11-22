// Main window: sidebar navigation + the current view. Views are objects with
// mount(viewEl, topbar, ctx), update(db) and optional command(cmd) / open(params).
import { byId, durationOf, recents, running } from '../core/model.js';
import { buildReport, defaultFilter } from '../core/report.js';
import { fmtDuration, fmtHuman, fmtMoney, rangeFor } from '../core/time.js';
import { $, h, mount } from './lib/dom.js';
import { icon } from './lib/icons.js';
import { act, api, initState, startClock, state, subscribe } from './lib/state.js';
import { closePanel, panel } from './lib/widgets.js';
import { playButton, toggleProject } from './lib/actions.js';
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

// ── Sidebar ──────────────────────────────────────────────────────────────────
// Customizable (right-click or the ⋯ next to Projects): stats, the project list mode, the timer card.
function renderSidebar(db) {
  const cfg = db.settings.sidebar;
  const [d0, d1] = rangeFor('today');
  const [w0, w1] = rangeFor('week', Date.now(), db.settings.weekStart);
  const sum = (a, b) => db.entries.filter((e) => e.start >= a && e.start < b).reduce((s, e) => s + durationOf(e), 0);

  mount($('#side-stats'),
    cfg.today && h('div.stat', h('span', 'Today'), h('b.num', fmtHuman(sum(d0, d1)))),
    cfg.week && h('div.stat', h('span', 'This week'), h('b.num', fmtHuman(sum(w0, w1)))),
    cfg.unbilled && h('button.stat.link-stat', { onclick: () => go('reports', { unit: 'all', filter: { status: 'unbilled' } }), title: 'Show unbilled' },
      h('span', 'Unbilled'), h('b.num', fmtMoney(buildReport(db, { ...defaultFilter(0, 8.64e15), status: 'unbilled', billable: 'billable' }).amount, db.settings.currency))));

  // Project list: every row starts or stops a timer.
  const week = new Map();
  for (const e of db.entries) if (e.start >= w0 && e.start < w1) week.set(e.projectId, (week.get(e.projectId) ?? 0) + durationOf(e));
  const live = db.projects.filter((p) => !p.archived);
  let list = [];
  if (cfg.projects === 'recent') {
    const last = new Map();
    for (const e of db.entries) if (e.projectId && (last.get(e.projectId) ?? 0) < e.start) last.set(e.projectId, e.start);
    list = live.filter((p) => last.has(p.id)).sort((a, b) => last.get(b.id) - last.get(a.id)).slice(0, 8);
  } else if (cfg.projects === 'pinned') list = live.filter((p) => p.pinned).sort((a, b) => a.name.localeCompare(b.name));
  else if (cfg.projects === 'all') list = [...live].sort((a, b) => a.name.localeCompare(b.name));
  const r = running(db);
  const label = { recent: 'Recent projects', pinned: 'Pinned', all: 'Projects', hidden: '' }[cfg.projects];

  mount($('#side-projects'),
    cfg.projects !== 'hidden' && h('div.side-label', h('span', label),
      h('button.icon-btn.side-more', { title: 'Customize sidebar', onclick: (e) => customize(e.currentTarget) }, icon('more'))),
    cfg.projects !== 'hidden' && list.map((p) => h('div.side-project', {
      class: r?.projectId === p.id ? 'on' : '', title: `${p.name}${week.get(p.id) ? ` · ${fmtHuman(week.get(p.id))} this week` : ''}`,
      onclick: () => toggleProject(p.id),
    },
    h('span.dot', { style: { background: p.color } }),
    h('span.side-project-name', p.name),
    r?.projectId === p.id
      ? h('span.num.side-live', { dataset: { since: r.start } }, fmtDuration(Date.now() - r.start, { seconds: true }))
      : h('span.num.muted.side-week', week.get(p.id) ? fmtDuration(week.get(p.id)) : ''),
    playButton(p.id, { name: p.name }))),
    cfg.projects === 'pinned' && !list.length && h('div.side-empty', 'Pin projects in Projects'),
    cfg.projects === 'recent' && !list.length && h('div.side-empty', 'No projects yet'));

  // Timer card: the running timer, or the last entry to continue, plus a new timer.
  const card = $('#side-card');
  if (!cfg.timer) { mount(card); return; }
  const last = recents(db, 1)[0];
  const e = r ?? last;
  const p = e && byId(db.projects, e.projectId);
  const title = e ? e.note || p?.name || 'No description' : 'Start tracking';
  const sub = e ? (e.note && p ? p.name : r ? 'Running' : 'Last entry') : 'No entries yet';
  mount(card, h('div.side-card', { class: r ? 'running' : '' },
    h('button.go.small', {
      class: r ? 'stop' : 'play', title: r ? 'Stop  ⌘.' : last ? 'Continue  ⌘.' : 'Start',
      onclick: () => (r ? act({ type: 'timer.stop' }) : last ? act({ type: 'entry.continue', id: last.id }) : act({ type: 'timer.start' })),
    }, icon(r ? 'stop' : 'play')),
    h('button.side-card-text', { onclick: () => go('track'), title: 'Open Track' },
      r ? h('span.side-card-time.num', { dataset: { since: r.start } }, fmtDuration(Date.now() - r.start, { seconds: true })) : null,
      h('span.side-card-title', p && h('span.dot', { style: { background: p.color } }), h('span', title)),
      h('span.side-card-sub', sub)),
    h('button.icon-btn', { title: 'New timer  ⌘L', onclick: () => go('track').then(() => track.command('focus-quick')) }, icon('plus'))));
}

function customize(anchor) {
  const cfg = state.db.settings.sidebar;
  const set = (patch) => act({ type: 'settings.update', patch: { sidebar: patch } });
  const check = (on) => h('span.picker-check', on ? icon('check') : null);
  const item = (label, on, run) => h('button.menu-item', { onclick: () => { m.close(); run(); } }, check(on), label);
  const m = panel(anchor, [
    h('div.picker-group', 'Show'),
    item('Today', cfg.today, () => set({ today: !cfg.today })),
    item('This week', cfg.week, () => set({ week: !cfg.week })),
    item('Unbilled', cfg.unbilled, () => set({ unbilled: !cfg.unbilled })),
    item('Timer card', cfg.timer, () => set({ timer: !cfg.timer })),
    h('div.picker-group', 'Projects'),
    ...[['recent', 'Recent'], ['pinned', 'Pinned'], ['all', 'All'], ['hidden', 'Hidden']].map(([v, l]) => item(l, cfg.projects === v, () => set({ projects: v }))),
  ], { width: 200 });
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

// Right-click anywhere in the sidebar to customize it.
$('#sidebar').addEventListener('contextmenu', (e) => { e.preventDefault(); customize({ getBoundingClientRect: () => new DOMRect(e.clientX, e.clientY, 0, 0), contains: () => false }); });

await initState();
subscribe((db) => { current?.update(db); renderSidebar(db); });
renderSidebar(state.db);
await go('track');
startClock((ms) => fmtDuration(ms, { seconds: true }));
// Re-render the sidebar totals every minute so "Today" keeps up with a running timer.
setInterval(() => renderSidebar(state.db), 60_000);
