// The "New entry" / "Edit entry" sheet. Times are typed freely ("930", "2:15pm") and the duration
// field stays in sync with start/end in both directions.
import { byId, STATUSES } from '../../core/model.js';
import { DAY, MIN, fmtClock, fmtHuman, fmtISODate, parseClock, parseDuration, parseISODate, startOfDay } from '../../core/time.js';
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { act, api, state } from '../lib/state.js';
import { field, picker, projectButton, projectItems, segmented, sheet, toast, toggle } from '../lib/widgets.js';

const minutesOf = (t) => Math.round((t - startOfDay(t)) / MIN);

/** Opens the sheet. `entry` null = new entry on `day` (defaults to today). */
export function openEntrySheet(entry, { day = Date.now() } = {}) {
  const db = state.db;
  const isNew = !entry;
  const isRunning = entry && entry.end == null;
  const lastEnd = isNew ? latestEndOn(db, day) : null;
  const now = Date.now();
  const defStart = lastEnd ?? (startOfDay(day) === startOfDay(now) ? now - 60 * MIN : startOfDay(day) + 9 * 60 * MIN);
  const draft = {
    note: entry?.note ?? '',
    projectId: entry?.projectId ?? null,
    tags: [...(entry?.tags ?? [])],
    newTags: [],
    day: startOfDay(entry?.start ?? day),
    startMin: minutesOf(entry?.start ?? defStart),
    durMin: Math.round(((entry ? (entry.end ?? now) : defStart + 60 * MIN) - (entry?.start ?? defStart)) / MIN),
    billable: entry?.billable ?? true,
    status: entry?.status ?? 'unbilled',
  };
  let billableTouched = !isNew;

  const note = h('input.input', { value: draft.note, placeholder: 'What did you work on?', autofocus: true, oninput: (e) => { draft.note = e.target.value; } });
  const projWrap = h('div.sheet-project');
  const tagWrap = h('div.tag-edit');
  const date = h('input.input', { type: 'date', value: fmtISODate(draft.day), onchange: (e) => { const d = parseISODate(e.target.value); if (!Number.isNaN(d)) draft.day = d; } });
  const start = h('input.input.num', { value: fmtMin(draft.startMin), onchange: () => syncFrom('start') });
  const end = h('input.input.num', { value: isRunning ? 'running' : fmtMin(draft.startMin + draft.durMin), disabled: isRunning, onchange: () => syncFrom('end') });
  const dur = h('input.input.num', { value: fmtHuman(draft.durMin * MIN), disabled: isRunning, onchange: () => syncFrom('dur') });
  const billWrap = h('div');
  const statusWrap = h('div');

  function syncFrom(which) {
    if (which === 'start') {
      const m = parseClock(start.value);
      if (!Number.isNaN(m)) draft.startMin = m;
    } else if (which === 'end') {
      let m = parseClock(end.value);
      if (!Number.isNaN(m)) { if (m <= draft.startMin) m += 24 * 60; draft.durMin = m - draft.startMin; }
    } else {
      const ms = parseDuration(dur.value);
      if (!Number.isNaN(ms) && ms > 0) draft.durMin = Math.round(ms / MIN);
    }
    start.value = fmtMin(draft.startMin);
    if (!isRunning) { end.value = fmtMin(draft.startMin + draft.durMin); dur.value = fmtHuman(draft.durMin * MIN); }
  }

  function renderProject() {
    projWrap.replaceChildren(projectButton(state.db, draft.projectId, (e) => {
      picker(e.currentTarget, {
        items: projectItems(state.db, draft.projectId), placeholder: 'Find project',
        onPick: (it) => {
          draft.projectId = it.id;
          // A non-billable project (e.g. "Admin") makes new entries non-billable unless the user chose.
          if (!billableTouched) { draft.billable = byId(state.db.projects, it.id)?.billable ?? true; renderBillable(); }
          renderProject();
        },
      });
    }));
  }

  function renderTags() {
    const names = [...draft.tags.map((t) => byId(state.db.tags, t)?.name).filter(Boolean), ...draft.newTags];
    tagWrap.replaceChildren(
      ...names.map((n) => h('span.tag', n)),
      h('button.btn.small.ghost', { onclick: (e) => openTags(e.currentTarget) }, icon('tag'), names.length ? 'Edit' : 'Add tags'));
  }
  function openTags(anchor) {
    const items = () => [
      ...state.db.tags.map((t) => ({ id: t.id, label: t.name, checked: draft.tags.includes(t.id) })),
      ...draft.newTags.map((n) => ({ id: `new:${n}`, label: n, checked: true })),
    ];
    const p = picker(anchor, {
      items: items(), multi: true, placeholder: 'Find or create tag',
      onPick: (it) => {
        if (it.id.startsWith('new:')) draft.newTags = draft.newTags.filter((n) => `new:${n}` !== it.id);
        else draft.tags = draft.tags.includes(it.id) ? draft.tags.filter((t) => t !== it.id) : [...draft.tags, it.id];
        renderTags(); p.refresh(items()); return true;
      },
      create: (name) => { draft.newTags.push(name.replace(/^#/, '')); renderTags(); p.refresh(items()); return true; },
    });
  }

  function renderBillable() {
    billWrap.replaceChildren(toggle(draft.billable, (v) => { draft.billable = v; billableTouched = true; }, 'Billable'));
  }
  function renderStatus() {
    statusWrap.replaceChildren(segmented(STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })), draft.status, (v) => { draft.status = v; renderStatus(); }));
  }

  async function save() {
    syncFrom('start');
    const startT = draft.day + draft.startMin * MIN;
    const patch = { note: draft.note, projectId: draft.projectId, tags: draft.tags, billable: draft.billable, status: draft.status, start: startT };
    if (!isRunning) patch.end = startT + draft.durMin * MIN;
    if (!isRunning && draft.durMin <= 0) return toast('The duration must be longer than zero.', { tone: 'error' });
    if (isRunning && startT > Date.now()) return toast('A running timer can’t start in the future.', { tone: 'error' });
    const ok = isNew
      ? await act({ type: 'entry.add', entry: patch, newTags: draft.newTags })
      : await act({ type: 'entry.update', id: entry.id, patch, newTags: draft.newTags });
    if (ok) s.close();
  }

  async function remove() {
    if (!(await api.confirm('Delete this entry?', entry.note || 'This can’t be undone.'))) return;
    if (await act({ type: 'entry.delete', ids: [entry.id] })) s.close();
  }

  renderProject(); renderTags(); renderBillable(); renderStatus();
  const body = h('form.entry-form', { onsubmit: (e) => { e.preventDefault(); save(); } },
    field('Description', note),
    h('div.row.project-row', field('Project', projWrap), field('Tags', tagWrap)),
    h('div.row', field('Date', date), field('Start', start), field('End', end), field('Duration', dur)),
    h('div.row.center', billWrap, h('div.status-field', statusWrap)),
    h('button', { type: 'submit', hidden: true }));
  body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } });

  const s = sheet({
    title: isNew ? 'New Entry' : isRunning ? 'Running Timer' : 'Edit Entry',
    body, width: 520,
    actions: [
      !isNew && h('button.btn.ghost.danger', { onclick: remove }, icon('trash'), 'Delete'),
      isRunning && h('button.btn', { onclick: async () => { await save(); act({ type: 'timer.stop' }); } }, icon('stop'), 'Stop Timer'),
      h('span.spacer'),
      h('button.btn', { onclick: () => s.close() }, 'Cancel'),
      h('button.btn.primary', { onclick: save }, isNew ? 'Add Entry' : 'Save'),
    ],
  });
}

const fmtMin = (m) => fmtClock(startOfDay(Date.now()) + (((m % 1440) + 1440) % 1440) * MIN);

function latestEndOn(db, day) {
  const d0 = startOfDay(day);
  const ends = db.entries.filter((e) => e.end && e.end > d0 && e.end < d0 + DAY).map((e) => e.end);
  return ends.length ? Math.max(...ends) : null;
}
