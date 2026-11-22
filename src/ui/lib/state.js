// Renderer-side copy of the database. The main process is the source of truth: every change goes
// through act(), and the new database comes back through onDb for every open window.
import { toast } from './widgets.js';

export const api = window.clockodile;
export const state = { db: null };
const listeners = new Set();

export async function initState() {
  state.db = await api.getDb();
  api.onDb((db) => {
    state.db = db;
    for (const fn of listeners) fn(db);
  });
  return state.db;
}

export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** Runs an operation in the main process; shows its error as a toast. Resolves to true on success. */
export async function act(op) {
  const res = await api.apply(op);
  if (!res.ok) toast(res.error, { tone: 'error' });
  return res.ok;
}

/** Updates every `[data-since]` element once a second with the elapsed time (running timers). */
export function startClock(format) {
  const update = () => {
    for (const el of document.querySelectorAll('[data-since]')) el.textContent = format(Date.now() - Number(el.dataset.since));
  };
  update();
  return setInterval(update, 1000);
}
