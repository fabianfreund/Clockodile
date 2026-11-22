// Import: pick a CSV (Timemator, Toggl, Clockify, Clockodile…) or a Clockodile backup, preview
// what will be created, then merge it in one step.
import { planImport, readCSV } from '../../core/importer.js';
import { fmtRange } from '../../core/time.js';
import { h } from '../lib/dom.js';
import { icon } from '../lib/icons.js';
import { act, api, state } from '../lib/state.js';
import { sheet, toast } from '../lib/widgets.js';

export async function startImport(onDone) {
  const file = await api.importFile();
  if (!file.ok) { if (file.error) toast(file.error, { tone: 'error' }); return; }
  if (file.kind === 'backup') { toast('Backup restored'); onDone?.(); return; }

  const read = readCSV(file.text);
  if (!read.entries.length) {
    toast(read.total ? 'No usable rows. Clockodile needs a date and start/end times or a duration.' : 'This file is empty.', { tone: 'error' });
    return;
  }
  const { op, summary: s } = planImport(state.db, read);
  const n = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`; // regular plurals only

  const skipped = [s.duplicates && `${n(s.duplicates, 'duplicate')}`, s.empty && `${s.empty} empty`, s.invalid && `${s.invalid} unreadable`].filter(Boolean);
  const body = [
    h('div.import-head', icon('table'),
      h('div', h('b', file.name), h('span.muted', [s.source, fileRange(read)].filter(Boolean).join(' · ')))),
    h('div.import-stats',
      stat(s.entries, 'entries'),
      stat(s.projects.length, 'new projects'),
      stat(s.clients.length, 'new clients'),
      stat(s.tags.length, 'new tags')),
    s.projects.length ? h('div.import-list', s.projects.map((p) => h('span.import-chip', h('span.dot', { style: { background: p.color } }), p.name, p.client && h('span.muted', p.client)))) : null,
    h('div.import-foot.muted', [
      Object.entries(s.statuses).map(([k, v]) => `${v} ${k}`).join(' · '),
      skipped.length && `Skipped ${skipped.join(', ')}`,
    ].filter(Boolean).join(' · ')),
  ];

  const sh = sheet({
    title: 'Import', body, width: 480,
    actions: [
      h('span.spacer'),
      h('button.btn', { onclick: () => sh.close() }, 'Cancel'),
      h('button.btn.primary', {
        disabled: !s.entries,
        onclick: async () => {
          if (await act(op)) { sh.close(); toast(`Imported ${s.entries} ${s.entries === 1 ? 'entry' : 'entries'}`); onDone?.(); }
        },
      }, s.entries ? `Import ${s.entries}` : 'Nothing new'),
    ],
  });
}

function fileRange(read) {
  if (!read.entries.length) return '';
  const from = read.entries.reduce((m, e) => Math.min(m, e.start), Infinity);
  const to = read.entries.reduce((m, e) => Math.max(m, e.end), 0);
  return fmtRange(from, to);
}

const stat = (value, label) => h('div.import-stat', h('b.num', String(value)), h('span', label));
