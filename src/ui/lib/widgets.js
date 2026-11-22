// Shared UI pieces: toasts, floating pickers, modal sheets, segmented controls.
import { byId, COLORS } from '../../core/model.js';
import { h, $ } from './dom.js';
import { icon } from './icons.js';

// ── Toast ────────────────────────────────────────────────────────────────────
export function toast(message, { tone = 'info', action, timeout = 3200 } = {}) {
  let host = $('#toasts');
  if (!host) host = document.body.appendChild(h('div#toasts'));
  const el = h('div.toast', { class: tone },
    h('span', message),
    action && h('button.toast-action', { onclick: () => { action.run(); close(); } }, action.label));
  host.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  const close = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 250); };
  setTimeout(close, action ? timeout * 1.6 : timeout);
}

// ── Floating panel anchored to an element ────────────────────────────────────
let openPanel = null;
export function closePanel() {
  openPanel?.close();
}

/** Opens `content` in a floating panel under (or above) `anchor`. Returns { el, close }. */
export function panel(anchor, content, { width, align = 'start', onClose } = {}) {
  closePanel();
  const el = h('div.panel', { style: width ? { width: `${width}px` } : {} }, content);
  document.body.append(el);
  const r = anchor.getBoundingClientRect();
  const pw = el.offsetWidth, ph = el.offsetHeight;
  let x = align === 'end' ? r.right - pw : r.left;
  x = Math.max(8, Math.min(x, innerWidth - pw - 8));
  let y = r.bottom + 6;
  if (y + ph > innerHeight - 8) y = Math.max(8, r.top - ph - 6);
  Object.assign(el.style, { left: `${x}px`, top: `${y}px` });
  requestAnimationFrame(() => el.classList.add('in'));

  const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); anchor.focus?.(); } };
  setTimeout(() => document.addEventListener('mousedown', onDown), 0);
  document.addEventListener('keydown', onKey, true);
  function close() {
    if (openPanel !== api) return;
    openPanel = null;
    document.removeEventListener('mousedown', onDown);
    document.removeEventListener('keydown', onKey, true);
    el.remove();
    onClose?.();
  }
  const api = { el, close };
  openPanel = api;
  return api;
}

/**
 * Searchable list in a panel. items: [{ id, label, sub?, color?, group?, checked? }].
 * onPick(item) returns true to keep the panel open (multi-select). `create(label)` adds a
 * "Create …" row for text that matches nothing.
 */
export function picker(anchor, { items, onPick, placeholder = 'Search', create, width = 280, multi = false }) {
  const input = h('input.picker-search', { placeholder, spellcheck: false });
  const list = h('div.picker-list');
  let active = 0, rows = [];

  function render() {
    const q = input.value.trim().toLowerCase();
    rows = items.filter((it) => !q || `${it.label} ${it.sub ?? ''} ${it.group ?? ''}`.toLowerCase().includes(q));
    if (create && q && !items.some((it) => it.label.toLowerCase() === q)) rows.push({ id: '__create', label: `Create “${input.value.trim()}”`, create: true });
    active = Math.min(active, Math.max(0, rows.length - 1));
    list.replaceChildren();
    let group;
    rows.forEach((it, i) => {
      if (it.group !== undefined && it.group !== group && !q) { group = it.group; if (group) list.append(h('div.picker-group', group)); }
      list.append(h('button.picker-row', {
        class: [i === active && 'active', it.create && 'create'].filter(Boolean).join(' '),
        onmousemove: () => { if (active !== i) { active = i; highlight(); } },
        onclick: () => pick(it),
      },
      it.create ? icon('plus') : it.color ? h('span.dot', { style: { background: it.color } }) : multi ? null : h('span.dot.none'),
      h('span.picker-label', it.label),
      it.sub && h('span.picker-sub', it.sub),
      multi && !it.create && h('span.picker-check', it.checked ? icon('check') : null)));
    });
    if (!rows.length) list.append(h('div.picker-empty', 'Nothing found'));
  }
  const highlight = () => [...list.querySelectorAll('.picker-row')].forEach((r, i) => r.classList.toggle('active', i === active));

  async function pick(it) {
    const keep = it.create ? await create(input.value.trim()) : await onPick(it);
    if (keep) { render(); input.select(); } else p.close();
  }

  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { active = Math.min(rows.length - 1, active + 1); highlight(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); highlight(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (rows[active]) pick(rows[active]); e.preventDefault(); }
  });
  render();
  const p = panel(anchor, [input, list], { width });
  input.focus();
  return { ...p, refresh: (next) => { items = next; render(); } };
}

/** Project items for picker(): grouped by client, archived hidden. */
export function projectItems(db, currentId) {
  const clients = [...db.clients].sort((a, b) => a.name.localeCompare(b.name));
  const live = db.projects.filter((p) => !p.archived || p.id === currentId);
  const items = [{ id: null, label: 'No project', group: '' }];
  for (const p of live.filter((x) => !x.clientId).sort((a, b) => a.name.localeCompare(b.name))) items.push({ id: p.id, label: p.name, color: p.color, group: '' });
  for (const c of clients) {
    for (const p of live.filter((x) => x.clientId === c.id).sort((a, b) => a.name.localeCompare(b.name))) items.push({ id: p.id, label: p.name, color: p.color, group: c.name });
  }
  return items;
}

/** The project button used in the timer bar and the entry sheet. */
export function projectButton(db, projectId, onClick) {
  const p = byId(db.projects, projectId);
  const c = p && byId(db.clients, p.clientId);
  return h('button.project-btn', { class: p ? '' : 'no-project', onclick: onClick, title: 'Project' },
    h('span.dot', { style: { background: p?.color ?? 'transparent' }, class: p ? '' : 'none' }),
    h('span.project-btn-label', p ? p.name : 'Project'),
    c && h('span.project-btn-client', c.name));
}

// ── Modal sheet ──────────────────────────────────────────────────────────────
export function sheet({ title, body, actions = [], width = 460, onClose }) {
  closePanel();
  const box = h('div.sheet', { style: { width: `${width}px` }, role: 'dialog' },
    h('div.sheet-head', h('h2', title), h('button.icon-btn', { onclick: () => close(), title: 'Close' }, icon('x'))),
    h('div.sheet-body', body),
    actions.length ? h('div.sheet-foot', actions) : null);
  const back = h('div.backdrop', { onmousedown: (e) => { if (e.target === back) close(); } }, box);
  const onKey = (e) => {
    if (e.key === 'Escape' && !document.querySelector('.panel')) { e.preventDefault(); close(); }
  };
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  requestAnimationFrame(() => back.classList.add('in'));
  function close() {
    document.removeEventListener('keydown', onKey);
    back.classList.remove('in');
    setTimeout(() => back.remove(), 180);
    onClose?.();
  }
  setTimeout(() => box.querySelector('[autofocus], input, textarea')?.focus(), 30);
  return { el: box, close };
}

// ── Small controls ───────────────────────────────────────────────────────────
/** Segmented control. options: [{ value, label }]. */
export function segmented(options, value, onChange, cls = '') {
  const el = h('div.seg', { class: cls }, options.map((o) => h('button', {
    class: o.value === value ? 'on' : '', title: o.title ?? '',
    onclick: () => { if (o.value !== value) onChange(o.value); },
  }, o.icon ? icon(o.icon) : null, o.label)));
  return el;
}

export function colorPicker(value, onChange) {
  const wrap = h('div.colors');
  const render = (v) => wrap.replaceChildren(...COLORS.map((c) => h('button.color', {
    class: c === v ? 'on' : '', style: { background: c }, title: c,
    onclick: (e) => { e.preventDefault(); render(c); onChange(c); },
  })));
  render(value);
  return wrap;
}

export function field(label, control, hint) {
  return h('label.field', h('span.field-label', label), control, hint && h('span.field-hint', hint));
}

export function toggle(checked, onChange, label) {
  return h('label.toggle', h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }), h('span.toggle-track'), label && h('span', label));
}

export function empty(iconName, title, text, action) {
  return h('div.empty', h('div.empty-icon', icon(iconName)), h('h3', title), text && h('p', text), action);
}
