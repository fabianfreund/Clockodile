// Projects: clients, their projects (color, rate, billable), and tags.
import { COLORS, byId, durationOf, rateFor } from '../../core/model.js';
import { fmtHuman, fmtMoney } from '../../core/time.js';
import { h, mount } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { act, api, state } from '../lib/state.js';
import { colorPicker, empty, field, panel, sheet, toggle } from '../lib/widgets.js';

let showArchived = false;
let navigate = () => {};

export const projects = {
  id: 'projects', title: 'Projects', icon: 'folder',

  mount(view, top, ctx) {
    navigate = ctx.go;
    mount(top.title, h('h1', 'Projects'));
    mount(top.actions,
      h('button.btn', { onclick: () => clientSheet() }, icon('client'), 'New Client'),
      h('button.btn.primary', { onclick: () => projectSheet() }, icon('plus'), 'New Project'));
    this.el = mount(view, h('div.projects'));
  },

  update(db) {
    const totals = new Map();
    for (const e of db.entries) totals.set(e.projectId, (totals.get(e.projectId) ?? 0) + durationOf(e));
    const visible = db.projects.filter((p) => showArchived || !p.archived);
    const archivedCount = db.projects.filter((p) => p.archived).length;
    const money = (n) => fmtMoney(n, db.settings.currency);

    const section = (title, client, list) => h('section.card.proj-group',
      h('div.card-head',
        h('div.group-title', client ? icon('client') : icon('folder'), h('h3', title),
          client?.rate != null && h('span.muted.num', `${money(client.rate)}/h`)),
        client && h('div.group-actions',
          h('button.icon-btn', { title: 'New project for this client', onclick: () => projectSheet(null, client.id) }, icon('plus')),
          h('button.icon-btn', { title: 'Edit client', onclick: () => clientSheet(client) }, icon('edit')))),
      list.length
        ? list.sort((a, b) => a.name.localeCompare(b.name)).map((p) => h('div.proj-row', { class: p.archived ? 'archived' : '', onclick: (e) => { if (!e.target.closest('button')) projectSheet(p); } },
          h('span.dot.big', { style: { background: p.color } }),
          h('span.proj-name', p.name),
          p.archived && h('span.pill.unbilled', 'Archived'),
          !p.billable && h('span.muted', 'Not billable'),
          h('span.proj-rate.num.muted', p.billable ? `${money(rateFor(db, { projectId: p.id }))}/h` : ''),
          h('span.proj-total.num', fmtHuman(totals.get(p.id) ?? 0)),
          h('button.icon-btn', { title: 'Show in reports', onclick: () => navigate('reports', { unit: 'all', filter: { projectIds: [p.id] } }) }, icon('chart')),
          h('button.icon-btn', { title: 'More', onclick: (e) => projectMenu(e.currentTarget, p) }, icon('more'))))
        : h('div.proj-empty.muted', 'No projects'));

    const groups = [];
    const loose = visible.filter((p) => !p.clientId);
    if (loose.length || !db.clients.length) groups.push(section('No client', null, loose));
    for (const c of [...db.clients].sort((a, b) => a.name.localeCompare(b.name))) groups.push(section(c.name, c, visible.filter((p) => p.clientId === c.id)));

    mount(this.el,
      !db.projects.length && !db.clients.length
        ? h('div.card', empty('folder', 'No projects yet', null,
          h('button.btn.primary', { onclick: () => projectSheet() }, icon('plus'), 'New Project')))
        : groups,
      archivedCount ? h('button.link.archived-toggle', { onclick: () => { showArchived = !showArchived; projects.update(state.db); } }, showArchived ? 'Hide archived projects' : `Show ${archivedCount} archived`) : null,
      tagsCard(db));
  },
};

function projectMenu(anchor, p) {
  const item = (ic, label, run, cls = '') => h('button.menu-item', { class: cls, onclick: () => { m.close(); run(); } }, icon(ic), label);
  const m = panel(anchor, [
    item('edit', 'Edit…', () => projectSheet(p)),
    item('archive', p.archived ? 'Unarchive' : 'Archive', () => act({ type: 'project.save', project: { ...p, archived: !p.archived } })),
    h('div.menu-sep'),
    item('trash', 'Delete…', () => deleteProject(p), 'danger'),
  ], { width: 190, align: 'end' });
}

async function deleteProject(p) {
  const n = state.db.entries.filter((e) => e.projectId === p.id).length;
  const ok = await api.confirm(`Delete “${p.name}”?`, n ? `Its ${n} entries are kept, without a project. To hide the project but keep its entries assigned, archive it instead.` : 'This project has no entries.');
  if (ok) act({ type: 'project.delete', id: p.id });
}

function projectSheet(p = null, clientId = null) {
  const db = state.db;
  const d = { id: p?.id, name: p?.name ?? '', clientId: p?.clientId ?? clientId, color: p?.color ?? COLORS[db.projects.length % COLORS.length], rate: p?.rate ?? null, billable: p?.billable ?? true, archived: p?.archived ?? false };
  const fallback = () => byId(db.clients, d.clientId)?.rate ?? db.settings.rate ?? 0;
  const rate = h('input.input.num', { type: 'number', min: 0, step: 'any', value: d.rate ?? '', placeholder: `${fallback()} (default)`, oninput: (e) => { d.rate = e.target.value === '' ? null : Number(e.target.value); } });
  const client = h('select.select', { onchange: (e) => { d.clientId = e.target.value || null; rate.placeholder = `${fallback()} (default)`; } },
    h('option', { value: '' }, 'No client'),
    db.clients.map((c) => h('option', { value: c.id, selected: c.id === d.clientId }, c.name)));
  const save = async () => { if (await act({ type: 'project.save', project: d })) s.close(); };
  const s = sheet({
    title: p ? 'Edit Project' : 'New Project', width: 440,
    body: h('form', { class: 'sheet-form', onsubmit: (e) => { e.preventDefault(); save(); } },
      field('Name', h('input.input', { value: d.name, autofocus: true, placeholder: 'Website Relaunch', oninput: (e) => { d.name = e.target.value; } })),
      field('Client', client),
      field('Color', colorPicker(d.color, (c) => { d.color = c; })),
      h('div.row',
        field(`Hourly rate (${db.settings.currency})`, rate),
        h('div.field.toggle-field', toggle(d.billable, (v) => { d.billable = v; }, 'Billable'))),
      h('button', { type: 'submit', hidden: true })),
    actions: [h('span.spacer'), h('button.btn', { onclick: () => s.close() }, 'Cancel'), h('button.btn.primary', { onclick: save }, p ? 'Save' : 'Create Project')],
  });
}

function clientSheet(c = null) {
  const db = state.db;
  const d = { id: c?.id, name: c?.name ?? '', rate: c?.rate ?? null };
  const save = async () => { if (await act({ type: 'client.save', client: d })) s.close(); };
  const remove = async () => {
    const n = db.projects.filter((p) => p.clientId === c.id).length;
    if (await api.confirm(`Delete client “${c.name}”?`, n ? `Its ${n} projects and their entries are kept, without a client.` : '')) {
      await act({ type: 'client.delete', id: c.id }); s.close();
    }
  };
  const s = sheet({
    title: c ? 'Edit Client' : 'New Client', width: 400,
    body: h('form', { class: 'sheet-form', onsubmit: (e) => { e.preventDefault(); save(); } },
      field('Name', h('input.input', { value: d.name, autofocus: true, placeholder: 'Acme Inc.', oninput: (e) => { d.name = e.target.value; } })),
      field(`Hourly rate (${db.settings.currency})`, h('input.input.num', { type: 'number', min: 0, step: 'any', value: d.rate ?? '', placeholder: `${db.settings.rate} (default)`, oninput: (e) => { d.rate = e.target.value === '' ? null : Number(e.target.value); } })),
      h('button', { type: 'submit', hidden: true })),
    actions: [c && h('button.btn.ghost.danger', { onclick: remove }, icon('trash'), 'Delete'), h('span.spacer'), h('button.btn', { onclick: () => s.close() }, 'Cancel'), h('button.btn.primary', { onclick: save }, c ? 'Save' : 'Create Client')],
  });
}

function tagsCard(db) {
  const counts = new Map();
  for (const e of db.entries) for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const add = h('input.input.tag-add', {
    placeholder: 'New tag…',
    onkeydown: async (e) => { if (e.key === 'Enter' && e.target.value.trim()) { if (await act({ type: 'tag.save', tag: { name: e.target.value } })) e.target.value = ''; } },
  });
  return h('section.card.tags-card',
    h('div.card-head', h('div.group-title', icon('tag'), h('h3', 'Tags')), add),
    db.tags.length
      ? h('div.tag-cloud', [...db.tags].sort((a, b) => a.name.localeCompare(b.name)).map((t) => h('span.tag.tag-edit-chip', { title: `${counts.get(t.id) ?? 0} entries`, onclick: (e) => tagMenu(e.currentTarget, t) }, t.name, h('span.tag-count.num', String(counts.get(t.id) ?? 0)))))
      : h('div.proj-empty.muted', 'Type #tag in the timer to create one.'));
}

function tagMenu(anchor, t) {
  const input = h('input.input', { value: t.name });
  const rename = async () => { if (input.value.trim() && input.value.trim() !== t.name && await act({ type: 'tag.save', tag: { id: t.id, name: input.value } })) m.close(); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') rename(); });
  const m = panel(anchor, [
    input,
    h('div.row', h('button.btn.small.danger', { onclick: async () => { m.close(); if (await api.confirm(`Delete #${t.name}?`, 'It is removed from all entries.')) act({ type: 'tag.delete', id: t.id }); } }, 'Delete'), h('button.btn.small.primary', { onclick: rename }, 'Rename')),
    h('button.btn.small.ghost', { onclick: () => { m.close(); navigate('reports', { unit: 'all', filter: { tagIds: [t.id] } }); } }, icon('chart'), 'Show in reports'),
  ], { width: 230 });
  input.focus(); input.select();
}
