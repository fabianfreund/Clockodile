// Settings: general behaviour, billing defaults, PDF header, data, about.
import { h, mount, debounce } from '../lib/dom.js';
import { act, api } from '../lib/state.js';
import { segmented, toast, toggle } from '../lib/widgets.js';
import { startImport } from './import-sheet.js';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'INR', 'BRL'];
const set = (patch) => act({ type: 'settings.update', patch });
const setLater = debounce(set, 350);

export const settings = {
  id: 'settings', title: 'Settings', icon: 'gear',

  async mount(view, top) {
    mount(top.title, h('h1', 'Settings'));
    mount(top.actions);
    this.el = mount(view, h('div.settings'));
    this.login = await api.getLogin();
    this.info = await api.info();
    this.built = false;
  },

  update(db) {
    // Built once per visit so typing never loses focus; values come back through the database.
    if (this.built) return;
    this.built = true;
    const s = db.settings;
    const row = (label, control, hint) => h('div.set-row', h('div.set-text', h('span', label), hint && h('span.set-hint', hint)), h('div.set-control', control));
    const card = (title, ...rows) => h('section.card.set-card', h('h3', title), rows);

    const shortcut = h('input.input.shortcut', {
      value: s.shortcut, placeholder: 'Press keys…', readOnly: true,
      onkeydown: async (e) => {
        e.preventDefault();
        if (e.key === 'Backspace' || e.key === 'Delete') { e.target.value = ''; await api.setShortcut(''); return; }
        const acc = accelerator(e);
        if (!acc) return;
        e.target.value = acc;
        const res = await api.setShortcut(acc);
        if (!res.ok) { toast(res.error, { tone: 'error' }); e.target.value = s.shortcut; }
        else toast(`Shortcut set to ${acc}`);
      },
    });

    mount(this.el,
      card('General',
        row('Open at login', toggle(this.login, (v) => { api.setLogin(v); this.login = v; })),
        row('Timer in menu bar', toggle(s.showTimerInMenuBar, (v) => set({ showTimerInMenuBar: v }))),
        row('Global shortcut', shortcut),
        row('Ask about idle time', h('select.select', { onchange: (e) => set({ idleMinutes: Number(e.target.value) }) },
          [0, 3, 5, 10, 15, 30].map((m) => h('option', { value: m, selected: s.idleMinutes === m }, m ? `After ${m} min` : 'Never')))),
        row('Week starts on', segmented([{ value: 1, label: 'Monday' }, { value: 0, label: 'Sunday' }], s.weekStart, (v) => { set({ weekStart: v }); this.rebuild(); }))),
      card('Billing',
        row('Currency', h('select.select', { onchange: (e) => set({ currency: e.target.value }) },
          [...new Set([s.currency, ...CURRENCIES])].map((c) => h('option', { value: c, selected: c === s.currency }, c)))),
        row('Default rate', h('input.input.num.short', { type: 'number', min: 0, step: 'any', value: s.rate, oninput: (e) => setLater({ rate: Number(e.target.value) || 0 }) })),
        row('Rounding', h('select.select', { onchange: (e) => set({ rounding: Number(e.target.value) }) },
          [0, 1, 5, 6, 10, 15, 30, 60].map((m) => h('option', { value: m, selected: s.rounding === m }, m ? `Up to ${m} min` : 'None'))), 'Reports and exports only')),
      card('PDF header',
        row('Name', h('input.input', { value: s.business.name, placeholder: 'Jane Doe Design', oninput: (e) => setLater({ business: { name: e.target.value } }) })),
        row('Details', h('textarea.input', { value: s.business.details, rows: 3, placeholder: 'Address, email, tax ID', oninput: (e) => setLater({ business: { details: e.target.value } }) }))),
      card('Data',
        row('Import', h('button.btn', { onclick: () => startImport(() => this.rebuild()) }, 'Choose File…'), 'Timemator, Toggl, Clockify or any CSV · Clockodile backup'),
        row('Backup', h('button.btn', { onclick: async () => { const r = await api.exportJson(); if (r.ok) toast('Backup saved'); } }, 'Export…')),
        row('Data folder', h('button.btn', { onclick: () => api.openDataFolder() }, 'Show'), 'Daily backups, last 14 days')),
      h('div.about',
        h('img', { src: '../assets/icon-128.png', alt: '' }),
        h('div', h('b', 'Clockodile'), h('span.muted', ` ${this.info?.version ?? ''}`)),
        h('span.muted', 'Free and open source · Part of Appetizer')));
  },

  rebuild() { this.built = false; },
};

/** KeyboardEvent → Electron accelerator ("Alt+Shift+T"). Needs at least one modifier. */
function accelerator(e) {
  const mods = [];
  if (e.metaKey) mods.push(api.platform === 'darwin' ? 'Cmd' : 'Super');
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const code = e.code;
  let key = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^F\d{1,2}$/.test(code)) key = code;
  else if (code === 'Space') key = 'Space';
  if (!key || !mods.length) return null;
  return [...mods, key].join('+');
}
