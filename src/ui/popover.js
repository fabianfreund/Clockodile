// Menu-bar popover: start/stop with the same quick-entry syntax, and restart recent work.
import { byId, durationOf, recents, running } from '../core/model.js';
import { parseQuick, quickOp } from '../core/parse.js';
import { fmtDuration, fmtHuman, rangeFor } from '../core/time.js';
import { $, h, mount } from './lib/dom.js';
import { icon } from './lib/icons.js';
import { act, api, initState, startClock, state, subscribe } from './lib/state.js';
import { picker, projectButton, projectItems, toast } from './lib/widgets.js';

document.body.classList.add(`os-${api.platform}`);
let draftProject; // explicit project pick for the next timer
let shownId;
const input = h('input', { placeholder: 'What are you working on?', spellcheck: false });

function render(db) {
  const r = running(db);
  const [d0, d1] = rangeFor('today');
  $('#today').textContent = `Today ${fmtHuman(db.entries.filter((e) => e.start >= d0 && e.start < d1).reduce((s, e) => s + durationOf(e), 0))}`;

  const now = $('#now');
  now.classList.toggle('running', !!r);
  if ((r?.id ?? null) !== shownId) { shownId = r?.id ?? null; input.value = r ? r.note : ''; }
  const pid = r ? r.projectId : draftProject ?? null;
  const proj = projectButton(db, pid, (e) => picker(e.currentTarget, {
    items: projectItems(db, pid), placeholder: 'Find project', width: 300,
    onPick: (it) => { if (r) act({ type: 'entry.update', id: r.id, patch: { projectId: it.id } }); else { draftProject = it.id; render(state.db); } },
  }));
  mount(now,
    h('div.now-row', input, h('button.go', { class: r ? 'stop' : 'play', title: r ? 'Stop' : 'Start  ↵', onclick: () => (r ? act({ type: 'timer.stop' }) : submit()) }, icon(r ? 'stop' : 'play'))),
    r ? h('div.now-row', h('span.elapsed.num', { dataset: { since: r.start } }, fmtDuration(Date.now() - r.start, { seconds: true })), proj)
      : h('div.now-row', proj));

  const list = recents(db, 7);
  mount($('#recent'), list.length ? list.map((e) => {
    const p = byId(db.projects, e.projectId);
    return h('button.rec', { onclick: () => act({ type: 'entry.continue', id: e.id }), title: 'Continue' },
      h('span.dot', { style: { background: p?.color ?? 'transparent' }, class: p ? '' : 'none' }),
      h('span.rec-main', h('span.rec-note', e.note || 'No description'), h('span.rec-sub', p?.name ?? 'No project')),
      h('span.icon-btn.play', icon('play')));
  }) : h('div.none', 'Nothing yet'));
}

async function submit() {
  const r = running(state.db);
  if (r) { if (input.value.trim() !== r.note) act({ type: 'entry.update', id: r.id, patch: { note: input.value.trim() } }); return; }
  const q = parseQuick(state.db, input.value);
  if (draftProject !== undefined) q.projectId = draftProject;
  const op = quickOp(q);
  if (await act(op)) {
    input.value = ''; draftProject = undefined;
    if (op.type === 'entry.add') toast(`Logged ${fmtHuman(q.end - q.start)}`);
    render(state.db);
  }
}

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); submit(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.querySelector('.panel')) api.hidePopover();
});

mount($('#foot'),
  h('button.btn', { onclick: () => api.openMain('go:track') }, icon('open'), 'Open Clockodile'),
  h('button.btn', { onclick: () => api.openMain('go:reports') }, icon('chart'), 'Reports'));

api.onMenu((cmd) => { if (cmd === 'focus-quick') { input.focus(); input.select(); } });
await initState();
render(state.db);
subscribe(render);
startClock((ms) => fmtDuration(ms, { seconds: true }));
