// Tiny DOM helpers: h() builds elements, so views stay plain functions that return nodes.

/**
 * h('button.btn.primary', { onclick, title: 'Go' }, 'Label', childNode, [more], null); 'div#id.cls' sets an id
 * Props: class/className, style (object or string), dataset, on<event> handlers, anything else
 * becomes a property when the element has it (value, checked, disabled…) or an attribute.
 */
export function h(sel, props, ...children) {
  if (props == null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    children.unshift(props);
    props = {};
  }
  const [head, ...classes] = sel.split('.');
  const [tag, id] = head.split('#');
  const el = document.createElementNS(tag === 'svg' || tag === 'path' ? 'http://www.w3.org/2000/svg' : 'http://www.w3.org/1999/xhtml', tag || 'div');
  if (id) el.id = id;
  if (classes.length) el.classList.add(...classes);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') el.classList.add(...String(v).split(/\s+/).filter(Boolean));
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && !(el instanceof SVGElement)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Replaces an element's children. */
export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/** Raw SVG markup → element (icons are trusted, built-in strings). */
export function svg(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstChild;
}

export const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};
