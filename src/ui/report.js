// PDF report page. Rendered in a hidden window; the main process prints it to A4.
import { buildReport } from '../core/report.js';
import { fmtClock, fmtDate, fmtDecimal, fmtDuration, fmtMoney, fmtRange, startOfDay } from '../core/time.js';
import { h, mount } from './lib/dom.js';

const api = window.clockodile;
const { db, filter, options: o } = await api.pdfJob();
const r = buildReport(db, filter);
const money = (n) => fmtMoney(n, db.settings.currency);
const hours = (ms) => fmtDecimal(ms);
const biz = db.settings.business;
const showAmt = o.showAmounts;

const header = h('header',
  h('div',
    h('div.brand', h('i'), 'Time report'),
    h('h1', o.title || 'Timesheet'),
    h('div.period', fmtRange(filter.from, filter.to))),
  biz.name || biz.details ? h('div.from', biz.name && h('b', biz.name), biz.details && h('div', biz.details)) : null);

const meta = h('div.meta',
  o.recipient && h('div', h('span', 'Prepared for'), h('b', o.recipient)),
  h('div', h('span', 'Entries'), h('b', String(r.rows.length))),
  h('div', h('span', 'Date'), h('b', fmtDate(Date.now()))));

const totals = h('div.totals',
  h('div.total', h('span', 'Total hours'), h('b.num', hours(r.total))),
  h('div.total', h('span', 'Billable hours'), h('b.num', hours(r.billable))),
  showAmt && h('div.total.accent', h('span', 'Amount'), h('b.num', money(r.amount))));

// Summary by project.
const summary = [
  h('h2', 'Summary'),
  h('table',
    h('thead', h('tr', h('th', 'Project'), h('th', 'Client'), h('th.r', 'Hours'), showAmt && h('th.r', 'Rate'), showAmt && h('th.r', 'Amount'))),
    h('tbody',
      r.byProject.map((g) => {
        const rates = [...new Set(r.rows.filter((x) => (x.projectId ?? '__none__') === g.key && x.billable).map((x) => x.rate))];
        return h('tr',
          h('td', h('span.dot', { style: { background: g.color } }), g.name),
          h('td.muted', g.client),
          h('td.r.num', hours(g.dur)),
          showAmt && h('td.r.num', rates.length === 1 ? money(rates[0]) : rates.length ? 'mixed' : h('span.nb', 'n/b')),
          showAmt && h('td.r.num', money(g.amount)));
      }),
      h('tr.grand', h('td', 'Total'), h('td'), h('td.r.num', hours(r.total)), showAmt && h('td'), showAmt && h('td.r.num', money(r.amount))))),
];

// Detailed entries.
function entryRow(x) {
  return h('tr',
    h('td.nowrap.num', new Date(x.start).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })),
    h('td', x.note || h('span.muted', '—'), o.showTags && x.tagNames.map((t) => h('span.tag', `#${t}`)),
      o.groupBy !== 'project' && x.project ? h('div.muted', x.project.name, x.client ? ` · ${x.client.name}` : '') : null),
    h('td.nowrap.num.muted', `${fmtClock(x.start)}–${x.end ? fmtClock(x.end) : ''}`),
    h('td.r.num', fmtDuration(x.dur)),
    showAmt && h('td.r.num', x.billable ? money(x.amount) : h('span.nb', 'n/b')));
}
const cols = showAmt ? 5 : 4;
function details() {
  if (!o.showEntries) return null;
  const body = [];
  if (o.groupBy === 'none') body.push(...r.rows.map(entryRow));
  else {
    const groups = new Map();
    for (const x of r.rows) {
      const key = o.groupBy === 'day' ? startOfDay(x.start) : x.projectId ?? '__none__';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(x);
    }
    for (const [key, list] of groups) {
      const first = list[0];
      const title = o.groupBy === 'day'
        ? new Date(key).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        : [h('span.dot', { style: { background: first.project?.color ?? '#8e8e93' } }), first.project?.name ?? 'No project', first.client ? h('span.muted', ` · ${first.client.name}`) : ''];
      const dur = list.reduce((s, x) => s + x.dur, 0), amt = list.reduce((s, x) => s + x.amount, 0);
      body.push(h('tr.group', h('td', { colSpan: cols }, title)));
      body.push(...list.map(entryRow));
      body.push(h('tr.subtotal', h('td'), h('td'), h('td.muted', 'Subtotal'), h('td.r.num', fmtDuration(dur)), showAmt && h('td.r.num', money(amt))));
    }
  }
  return [
    h('h2', 'Entries'),
    h('table',
      h('thead', h('tr', h('th', 'Date'), h('th', 'Description'), h('th', 'Time'), h('th.r', 'Duration'), showAmt && h('th.r', 'Amount'))),
      h('tbody', body,
        h('tr.grand', h('td'), h('td', 'Total'), h('td'), h('td.r.num', fmtDuration(r.total)), showAmt && h('td.r.num', money(r.amount))))),
  ];
}

const notes = [];
if (db.settings.rounding) notes.push(`Each entry rounded up to ${db.settings.rounding} minutes.`);
if (showAmt) notes.push('Amounts are for billable time only.');

mount(document.getElementById('doc'),
  header, meta, totals, summary, details(),
  h('footer', h('span', notes.join(' ')), h('span', 'Made with Clockodile')));

await document.fonts.ready;
api.pdfReady();
