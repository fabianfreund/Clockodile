// Track: the timer bar, a week strip, a timeline of the day, and the day's entries.
import { byId, durationOf, running } from '../../core/model.js';
import { parseQuick, quickOp } from '../../core/parse.js';
import { DAY, HOUR, addDays, fmtClock, fmtDay, fmtDuration, fmtHuman, isSameDay, startOfDay, startOfWeek } from '../../core/time.js';
import { h, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { act, state } from '../lib/state.js';
import { empty, panel, picker, projectButton, projectItems, toast } from '../lib/widgets.js';
import { openEntrySheet } from './entry-sheet.js';

let day = startOfDay(Date.now());
let els = null;
// The idle timer bar's explicit picks (they win over @project / #tag typed in the text).
let draft = { projectId: undefined, tags: [] };
let shownRunningId = null;

export const track = {
  id: 'track', title: 'Track', icon: 'clock',

  mount(view, top) {
    mount(top.title, h('h1', 'Track'));
    mount(top.actions,
      h('button.btn', { onclick: () => openEntrySheet(null, { day }), title: 'New Entry  ⌘N' }, icon('plus'), 'Add Entry'));
    els = {
      bar: timerBar(),
      week: h('div.week'),
      ribbon: h('div.ribbon'),
      list: h('div.day-list'),
    };
    mount(view, h('div.track', els.bar.el, els.week, h('div.day-card', els.ribbon, els.list)));
    shownRunningId = null;
  },

  update(db) {
    els.bar.update(db);
    renderWeek(db);
    renderRibbon(db);
    renderList(db);
  },

  command(cmd) {
    if (cmd === 'new-entry') openEntrySheet(null, { day });
    else if (cmd === 'focus-quick') els.bar.focus();
    else if (cmd === 'day:prev') setDay(addDays(day, -1));
    else if (cmd === 'day:next') setDay(addDays(day, 1));
    else if (cmd === 'day:today') setDay(Date.now());
  },
};

function setDay(t) {
  day = startOfDay(t);
  track.update(state.db);
}

// ── Timer bar ────────────────────────────────────────────────────────────────
function timerBar() {
  const input = h('input.timer-input', { placeholder: 'What are you working on?', spellcheck: false, title: 'Add @project, #tag, a duration (1h30) or a time (9-10:30)' });
  const projSlot = h('div.timer-project');
  const tagBtn = h('button.icon-btn.timer-tags', { title: 'Tags' }, icon('tag'));
  const elapsed = h('div.timer-elapsed.num', '0:00:00');
  const go = h('button.go.play', { title: 'Start  ↵' }, icon('play'));
  const hint = h('div.timer-hint');
  const el = h('div.timer-card', h('div.timer-bar', input, projSlot, tagBtn, elapsed, go), hint);

  const r = () => running(state.db);

  function preview() {
    // Only shown while typing: what Enter will do with the text.
    const text = input.value.trim();
    el.classList.toggle('hinting', !!text && !r());
    if (!text || r()) { hint.replaceChildren(); return; }
    const q = parseQuick(state.db, text);
    const pid = draft.projectId !== undefined ? draft.projectId : q.projectId;
    const p = byId(state.db.projects, pid);
    const parts = [];
    if (q.start != null) parts.push(h('span', 'Log ', h('b', fmtHuman(q.end - q.start)), ` ${isSameDay(q.start, Date.now()) ? 'today' : fmtDay(q.start)}, ${fmtClock(q.start)}–${fmtClock(q.end)}`));
    else parts.push(h('span', 'Start a timer'));
    if (p) parts.push(h('span', ' on ', h('span.dot', { style: { background: p.color } }), ' ', h('b', p.name)));
    const tags = [...q.tags.map((t) => byId(state.db.tags, t)?.name), ...q.newTags.map((n) => `${n} (new)`)];
    if (tags.length) parts.push(h('span', ' · ', tags.map((t) => `#${t}`).join(' ')));
    if (q.unknownProject) parts.push(h('span.warn', ` · no project “${q.unknownProject}”`));
    hint.replaceChildren(h('span.kbd', '↵'), ' ', ...parts);
  }

  async function submit() {
    const cur = r();
    if (cur) {
      if (input.value.trim() !== cur.note) await act({ type: 'entry.update', id: cur.id, patch: { note: input.value.trim() } });
      input.blur();
      return;
    }
    const q = parseQuick(state.db, input.value);
    if (draft.projectId !== undefined) q.projectId = draft.projectId;
    q.tags = [...new Set([...q.tags, ...draft.tags])];
    const op = quickOp(q);
    if (await act(op)) {
      if (op.type === 'entry.add') {
        toast(`Logged ${fmtHuman(q.end - q.start)}${q.note ? ` · ${q.note}` : ''}`);
        day = startOfDay(q.start);
      }
      input.value = '';
      draft = { projectId: undefined, tags: [] };
      track.update(state.db);
    }
  }

  function toggleTimer() {
    if (r()) act({ type: 'timer.stop' });
    else submit();
  }

  function pickProject(anchor) {
    const cur = r();
    picker(anchor, {
      items: projectItems(state.db, cur?.projectId ?? draft.projectId), placeholder: 'Find project',
      onPick: (it) => {
        if (cur) act({ type: 'entry.update', id: cur.id, patch: { projectId: it.id } });
        else { draft.projectId = it.id; update(state.db); preview(); }
      },
    });
  }

  function pickTags(anchor) {
    const cur = r();
    const selected = () => (r() ? r().tags : draft.tags);
    const items = () => state.db.tags.map((t) => ({ id: t.id, label: t.name, checked: selected().includes(t.id) }));
    const p = picker(anchor, {
      items: items(), multi: true, placeholder: 'Find or create tag',
      onPick: async (it) => {
        const now = selected().includes(it.id) ? selected().filter((t) => t !== it.id) : [...selected(), it.id];
        if (cur) await act({ type: 'entry.update', id: cur.id, patch: { tags: now } });
        else { draft.tags = now; update(state.db); }
        p.refresh(items());
        return true;
      },
      create: async (name) => {
        if (cur) await act({ type: 'entry.update', id: cur.id, patch: {}, newTags: [name] });
        else { await act({ type: 'tag.save', tag: { name } }); const t = state.db.tags.find((x) => x.name.toLowerCase() === name.toLowerCase()); if (t) draft.tags = [...draft.tags, t.id]; update(state.db); }
        p.refresh(items());
        return true;
      },
    });
  }

  function update(db) {
    const cur = running(db);
    el.classList.toggle('running', !!cur);
    if ((cur?.id ?? null) !== shownRunningId) {
      shownRunningId = cur?.id ?? null;
      if (document.activeElement !== input || cur) input.value = cur ? cur.note : '';
    }
    const pid = cur ? cur.projectId : draft.projectId ?? null;
    const tags = cur ? cur.tags : draft.tags;
    projSlot.replaceChildren(projectButton(db, pid, (e) => pickProject(e.currentTarget)));
    tagBtn.classList.toggle('has', tags.length > 0);
    tagBtn.title = tags.length ? tags.map((t) => `#${byId(db.tags, t)?.name}`).join(' ') : 'Tags';
    tagBtn.replaceChildren(icon('tag'), tags.length ? h('span.count', String(tags.length)) : null);
    go.className = `go ${cur ? 'stop' : 'play'}`;
    go.title = cur ? 'Stop  ⌘.' : 'Start  ↵';
    go.replaceChildren(icon(cur ? 'stop' : 'play'));
    if (cur) { elapsed.dataset.since = cur.start; elapsed.textContent = fmtDuration(Date.now() - cur.start, { seconds: true }); }
    else { delete elapsed.dataset.since; elapsed.textContent = '0:00:00'; }
    preview();
  }

  input.addEventListener('input', preview);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { input.value = r()?.note ?? ''; input.blur(); preview(); }
  });
  input.addEventListener('blur', () => { const cur = r(); if (cur && input.value.trim() !== cur.note) act({ type: 'entry.update', id: cur.id, patch: { note: input.value.trim() } }); });
  go.addEventListener('click', toggleTimer);
  tagBtn.addEventListener('click', (e) => pickTags(e.currentTarget));

  return { el, update, focus: () => { input.focus(); input.select(); } };
}

// ── Week strip ───────────────────────────────────────────────────────────────
function renderWeek(db) {
  const ws = startOfWeek(day, db.settings.weekStart);
  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const totals = days.map((d) => db.entries.filter((e) => e.start >= d && e.start < addDays(d, 1)).reduce((s, e) => s + durationOf(e), 0));
  const max = Math.max(8 * HOUR, ...totals);
  const weekTotal = totals.reduce((a, b) => a + b, 0);
  const isThisWeek = isSameDay(ws, startOfWeek(Date.now(), db.settings.weekStart));
  mount(els.week,
    h('div.week-head',
      h('div.week-title', h('b', isThisWeek ? 'This week' : `Week of ${new Date(ws).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`), h('span.num', fmtHuman(weekTotal))),
      h('div.week-nav',
        h('button.icon-btn', { title: 'Previous week', onclick: () => setDay(addDays(day, -7)) }, icon('left')),
        h('button.btn.small', { onclick: () => setDay(Date.now()), disabled: isSameDay(day, Date.now()) }, 'Today'),
        h('button.icon-btn', { title: 'Next week', onclick: () => setDay(addDays(day, 7)) }, icon('right')))),
    h('div.week-days', days.map((d, i) => h('button.week-day', {
      class: [isSameDay(d, day) && 'on', isSameDay(d, Date.now()) && 'today', d > Date.now() && 'future'].filter(Boolean).join(' '),
      onclick: () => setDay(d),
    },
    h('span.wd-name', new Date(d).toLocaleDateString(undefined, { weekday: 'short' })),
    h('span.wd-date', new Date(d).getDate()),
    h('span.wd-bar', h('span', { style: { width: `${(totals[i] / max) * 100}%` } })),
    h('span.wd-total.num', totals[i] ? fmtDuration(totals[i]) : '–')))));
}

// ── Timeline ribbon ──────────────────────────────────────────────────────────
function dayEntries(db) {
  return db.entries.filter((e) => e.start >= day && e.start < addDays(day, 1)).sort((a, b) => a.start - b.start);
}

function renderRibbon(db) {
  const list = dayEntries(db);
  const now = Date.now();
  const hours = list.flatMap((e) => [(e.start - day) / HOUR, ((e.end ?? now) - day) / HOUR]);
  const from = Math.max(0, Math.floor(Math.min(8, ...hours)));
  const to = Math.min(24, Math.ceil(Math.max(18, ...hours)));
  const pct = (t) => `${(((t - day) / HOUR - from) / (to - from)) * 100}%`;
  const ticks = [];
  for (let hh = from; hh <= to; hh += (to - from > 12 ? 2 : 1)) ticks.push(h('span.tick', { style: { left: `${((hh - from) / (to - from)) * 100}%` } }, h('span', `${hh}:00`)));
  mount(els.ribbon,
    h('div.ribbon-track',
      ticks,
      list.map((e) => {
        const p = byId(db.projects, e.projectId);
        const end = Math.min(e.end ?? now, day + DAY);
        return h('button.block', {
          class: e.end == null ? 'live' : '',
          style: { left: pct(e.start), width: `calc(${pct(end)} - ${pct(e.start)})`, background: p?.color ?? 'var(--fg3)' },
          title: `${e.note || 'No description'} · ${fmtClock(e.start)}–${e.end ? fmtClock(e.end) : 'now'}`,
          onclick: () => openEntrySheet(e),
        });
      }),
      isSameDay(day, now) && h('span.now-line', { style: { left: pct(now) } })));
}

// ── Day list ─────────────────────────────────────────────────────────────────
function renderList(db) {
  const list = dayEntries(db).reverse();
  const total = list.reduce((s, e) => s + durationOf(e), 0);
  const head = h('div.day-head',
    h('div', h('h2', fmtDay(day)), h('span.num.day-total', list.length ? fmtHuman(total) : '')),
    h('div.day-nav',
      h('button.icon-btn', { title: 'Previous day  ⌘[', onclick: () => setDay(addDays(day, -1)) }, icon('left')),
      h('button.icon-btn', { title: 'Next day  ⌘]', onclick: () => setDay(addDays(day, 1)) }, icon('right'))));
  if (!list.length) {
    mount(els.list, head, empty('clock', 'Nothing tracked', null,
      h('button.btn', { onclick: () => openEntrySheet(null, { day }) }, icon('plus'), 'Add Entry')));
    return;
  }
  mount(els.list, head, h('div.entries', list.map((e) => entryRow(db, e))));
}

export function entryRow(db, e, { showDate = false } = {}) {
  const p = byId(db.projects, e.projectId);
  const c = p && byId(db.clients, p.clientId);
  const live = e.end == null;
  return h('div.entry', { class: live ? 'live' : '', onclick: (ev) => { if (!ev.target.closest('button')) openEntrySheet(e); } },
    h('span.dot', { style: { background: p?.color ?? 'transparent' }, class: p ? '' : 'none' }),
    h('div.entry-main',
      h('div.entry-note', { class: e.note ? '' : 'muted' }, e.note || 'No description'),
      h('div.entry-meta',
        p ? h('span.entry-project', { style: { color: p.color } }, p.name) : h('span.muted', 'No project'),
        c && h('span.muted', ` · ${c.name}`),
        e.tags.map((t) => byId(db.tags, t)).filter(Boolean).map((t) => h('span.tag', t.name)))),
    !e.billable && h('span.nb', { title: 'Not billable' }, icon('coin')),
    e.status !== 'unbilled' && h('span.pill', { class: e.status }, e.status === 'paid' ? 'Paid' : 'Billed'),
    h('span.entry-range.num', showDate ? new Date(e.start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' · ' : '', `${fmtClock(e.start)} – ${live ? 'now' : fmtClock(e.end)}`),
    h('span.entry-dur.num', live ? { dataset: { since: e.start } } : {}, fmtDuration(durationOf(e), { seconds: live })),
    h('div.entry-actions',
      live
        ? h('button.icon-btn', { title: 'Stop', onclick: () => act({ type: 'timer.stop' }) }, icon('stop'))
        : h('button.icon-btn', { title: 'Continue', onclick: () => act({ type: 'entry.continue', id: e.id }) }, icon('play')),
      h('button.icon-btn', { title: 'More', onclick: (ev) => entryMenu(ev.currentTarget, e) }, icon('more'))));
}

function entryMenu(anchor, e) {
  const item = (ic, label, run, cls = '') => h('button.menu-item', { class: cls, onclick: () => { p.close(); run(); } }, icon(ic), label);
  const status = (s, label) => e.status !== s && item(s === 'unbilled' ? 'undo' : 'receipt', label, () => act({ type: 'entry.status', ids: [e.id], status: s }));
  const p = panel(anchor, [
    item('edit', 'Edit…', () => openEntrySheet(e)),
    e.end != null && item('play', 'Continue', () => act({ type: 'entry.continue', id: e.id })),
    e.end != null && item('plus', 'Duplicate', () => act({ type: 'entry.add', entry: { ...e, start: e.start, end: e.end } })),
    h('div.menu-sep'),
    status('unbilled', 'Mark as Unbilled'), status('billed', 'Mark as Billed'), status('paid', 'Mark as Paid'),
    h('div.menu-sep'),
    item('trash', 'Delete', async () => {
      const deleted = e;
      if (await act({ type: 'entry.delete', ids: [e.id] })) {
        toast('Entry deleted', { action: { label: 'Undo', run: () => deleted.end != null && act({ type: 'entry.add', entry: deleted }) } });
      }
    }, 'danger'),
  ].filter(Boolean), { width: 200, align: 'end' });
}

