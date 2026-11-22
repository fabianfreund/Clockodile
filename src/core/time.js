// Date, duration and money helpers. Pure (no DOM, no Electron) so main, renderer and tests share them.
// Times are epoch milliseconds in local time; days are identified by their local midnight.

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Adds calendar days (DST-safe: keeps the local time of day). */
export function addDays(t, n) {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** Local midnight of the first day of t's week. weekStart: 0 = Sunday, 1 = Monday. */
export function startOfWeek(t, weekStart = 1) {
  const d = new Date(startOfDay(t));
  const back = (d.getDay() - weekStart + 7) % 7;
  return addDays(d.getTime(), -back);
}

export function startOfMonth(t) {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function addMonths(t, n) {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
}

export const isSameDay = (a, b) => startOfDay(a) === startOfDay(b);

/** Named ranges used by the report filters. Returns [from, to) in ms. */
export function rangeFor(preset, now = Date.now(), weekStart = 1) {
  const today = startOfDay(now);
  switch (preset) {
    case 'today': return [today, addDays(today, 1)];
    case 'yesterday': return [addDays(today, -1), today];
    case 'week': { const s = startOfWeek(now, weekStart); return [s, addDays(s, 7)]; }
    case 'last-week': { const s = addDays(startOfWeek(now, weekStart), -7); return [s, addDays(s, 7)]; }
    case 'month': { const s = startOfMonth(now); return [s, addMonths(s, 1)]; }
    case 'last-month': { const s = addMonths(startOfMonth(now), -1); return [s, addMonths(s, 1)]; }
    case 'year': { const y = new Date(now).getFullYear(); return [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()]; }
    case 'all': return [0, 8.64e15];
    default: throw new Error(`unknown range ${preset}`);
  }
}

/** Days [from, to) as local midnights. */
export function daysIn(from, to) {
  const out = [];
  for (let d = startOfDay(from); d < to; d = addDays(d, 1)) out.push(d);
  return out;
}

// ── Formatting ───────────────────────────────────────────────────────────────

/** 5400000 → "1:30". With seconds: "1:30:05". Negative input is clamped to 0. */
export function fmtDuration(ms, { seconds = false } = {}) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const mm = String(m).padStart(2, '0');
  return seconds ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${h}:${mm}`;
}

/** 5400000 → "1h 30m", 900000 → "15m", 0 → "0m". */
export function fmtHuman(ms) {
  const m = Math.round(Math.max(0, ms) / MIN), h = Math.floor(m / 60), r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** 5400000 → "1.50" (decimal hours, for invoices). */
export const fmtDecimal = (ms) => (Math.max(0, ms) / HOUR).toFixed(2);

const moneyFormats = new Map();
export function fmtMoney(amount, currency = 'EUR', locale) {
  const key = `${currency}|${locale ?? ''}`;
  if (!moneyFormats.has(key)) {
    let f;
    try { f = new Intl.NumberFormat(locale, { style: 'currency', currency }); }
    catch { f = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    moneyFormats.set(key, f);
  }
  return moneyFormats.get(key).format(amount);
}

const pad = (n) => String(n).padStart(2, '0');
/** "09:05" in 24h. */
export const fmtClock = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
/** "2026-11-22" (for <input type=date> and file names). */
export const fmtISODate = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** Parses "2026-11-22" as local midnight. */
export function parseISODate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : NaN;
}

export function fmtDay(t, locale, now = Date.now()) {
  if (isSameDay(t, now)) return 'Today';
  if (isSameDay(t, addDays(now, -1))) return 'Yesterday';
  if (isSameDay(t, addDays(now, 1))) return 'Tomorrow';
  const sameYear = new Date(t).getFullYear() === new Date(now).getFullYear();
  return new Date(t).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
}

export const fmtDate = (t, locale) => new Date(t).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });

export function fmtRange(from, to, locale) {
  const last = to - 1;
  if (isSameDay(from, last)) return fmtDate(from, locale);
  return `${fmtDate(from, locale)} – ${fmtDate(last, locale)}`;
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/**
 * Parses a typed duration. Accepts "1:30", "1h30", "1h 30m", "90m", "90", "1.5h", "1,5", "2h".
 * Bare numbers: whole numbers from 10 up are minutes ("90" → 90m), smaller or decimal ones are hours ("2" → 2h, "1.5" → 1h 30m).
 * Returns ms, or NaN when it isn't a duration.
 */
export function parseDuration(input) {
  const s = String(input ?? '').trim().toLowerCase().replace(',', '.');
  if (!s) return NaN;
  let m;
  if ((m = /^(\d+):([0-5]?\d)$/.exec(s))) return (+m[1] * 60 + +m[2]) * MIN;
  if ((m = /^(\d+)\s*h\s*(\d+)$/.exec(s))) return (+m[1] * 60 + +m[2]) * MIN; // "1h30"
  if ((m = /^(?:(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?)?\s*(?:(\d+)\s*m(?:in(?:s|utes?)?)?)?$/.exec(s)) && (m[1] || m[2])) {
    return Math.round(((+m[1] || 0) * 60 + (+m[2] || 0)) * MIN);
  }
  if ((m = /^(\d+(?:\.\d+)?)$/.exec(s))) {
    const n = +m[1];
    return Math.round((Number.isInteger(n) && n >= 10 ? n : n * 60) * MIN);
  }
  return NaN;
}

/** Parses "9", "9:30", "930", "0930", "9.30", "9am", "2:15pm" into minutes after midnight, or NaN. */
export function parseClock(input) {
  const s = String(input ?? '').trim().toLowerCase();
  const m = /^(\d{1,2})(?:[:.]?(\d{2}))?\s*(am|pm|a|p)?$/.exec(s);
  if (!m) return NaN;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (m[3]) {
    if (h < 1 || h > 12) return NaN;
    h = (h % 12) + (m[3].startsWith('p') ? 12 : 0);
  }
  if (h > 24 || min > 59 || (h === 24 && min)) return NaN;
  return h * 60 + min;
}

/** Rounds a duration up to the next `minutes` step (0 = no rounding). */
export function roundUp(ms, minutes) {
  if (!minutes) return ms;
  const step = minutes * MIN;
  return Math.ceil(ms / step) * step;
}
