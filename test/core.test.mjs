import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOUR, MIN, addDays, fmtDuration, fmtHuman, parseClock, parseDuration, rangeFor, roundUp, startOfDay, startOfWeek,
} from '../src/core/time.js';
import { apply, emptyDb, migrate, rateFor, recents, running } from '../src/core/model.js';
import { parseQuick, quickOp } from '../src/core/parse.js';
import { buildReport, defaultFilter, toCSV } from '../src/core/report.js';

const NOW = new Date(2026, 10, 18, 15, 0).getTime(); // Wed 18 Nov 2026, 15:00

function seed() {
  let db = emptyDb();
  db = apply(db, { type: 'client.save', client: { id: 'c1', name: 'Acme', rate: 100 } });
  db = apply(db, { type: 'project.save', project: { id: 'p1', name: 'Website', clientId: 'c1' } });
  db = apply(db, { type: 'project.save', project: { id: 'p2', name: 'Internal', rate: 0, billable: false } });
  db = apply(db, { type: 'tag.save', tag: { id: 't1', name: 'design' } });
  return db;
}

test('durations parse in the formats people type', () => {
  assert.equal(parseDuration('1:30'), 90 * MIN);
  assert.equal(parseDuration('1h30'), 90 * MIN);
  assert.equal(parseDuration('1h 30m'), 90 * MIN);
  assert.equal(parseDuration('90m'), 90 * MIN);
  assert.equal(parseDuration('90'), 90 * MIN);
  assert.equal(parseDuration('1.5h'), 90 * MIN);
  assert.equal(parseDuration('1,5'), 90 * MIN);
  assert.equal(parseDuration('2'), 2 * HOUR);
  assert.ok(Number.isNaN(parseDuration('soon')));
  assert.ok(Number.isNaN(parseDuration('')));
});

test('clock times parse in 24h and am/pm', () => {
  assert.equal(parseClock('9'), 9 * 60);
  assert.equal(parseClock('9:30'), 570);
  assert.equal(parseClock('0930'), 570);
  assert.equal(parseClock('2:15pm'), 14 * 60 + 15);
  assert.equal(parseClock('12am'), 0);
  assert.ok(Number.isNaN(parseClock('25:00')));
});

test('formatting and rounding', () => {
  assert.equal(fmtDuration(90 * MIN), '1:30');
  assert.equal(fmtDuration(90 * MIN + 5000, { seconds: true }), '1:30:05');
  assert.equal(fmtHuman(90 * MIN), '1h 30m');
  assert.equal(fmtHuman(15 * MIN), '15m');
  assert.equal(roundUp(16 * MIN, 15), 30 * MIN);
  assert.equal(roundUp(15 * MIN, 15), 15 * MIN);
  assert.equal(roundUp(16 * MIN, 0), 16 * MIN);
});

test('week and month ranges', () => {
  const [ws, we] = rangeFor('week', NOW, 1);
  assert.equal(new Date(ws).getDay(), 1);
  assert.equal(we, addDays(ws, 7));
  assert.equal(startOfWeek(NOW, 0), addDays(ws, -1));
  const [ms] = rangeFor('last-month', NOW);
  assert.equal(new Date(ms).getMonth(), 9);
});

test('one timer at a time; starting another stops the first', () => {
  let db = seed();
  db = apply(db, { type: 'timer.start', note: 'A', projectId: 'p1' }, NOW);
  db = apply(db, { type: 'timer.start', note: 'B' }, NOW + 30 * MIN);
  assert.equal(db.entries.length, 2);
  assert.equal(db.entries[0].end, NOW + 30 * MIN);
  assert.equal(running(db).note, 'B');
  db = apply(db, { type: 'timer.stop' }, NOW + 45 * MIN);
  assert.equal(running(db), undefined);
});

test('accidental timers under a minute are dropped', () => {
  let db = apply(seed(), { type: 'timer.start', note: 'oops' }, NOW);
  db = apply(db, { type: 'timer.stop' }, NOW + 20_000);
  assert.equal(db.entries.length, 0);
});

test('entries inherit billable from the project, and validate times', () => {
  let db = seed();
  db = apply(db, { type: 'entry.add', entry: { note: 'x', projectId: 'p2', start: NOW, end: NOW + HOUR } });
  assert.equal(db.entries[0].billable, false);
  assert.throws(() => apply(db, { type: 'entry.add', entry: { start: NOW, end: NOW - 1 } }), /after start/);
  assert.throws(() => apply(db, { type: 'entry.update', id: db.entries[0].id, patch: { end: null } }), /reopen/);
});

test('rate falls back project → client → default', () => {
  const db = seed();
  db.settings.rate = 50;
  assert.equal(rateFor(db, { projectId: 'p1' }), 100);
  assert.equal(rateFor(db, { projectId: 'p2' }), 0);
  assert.equal(rateFor(db, { projectId: null }), 50);
});

test('deleting a project keeps its entries', () => {
  let db = apply(seed(), { type: 'entry.add', entry: { projectId: 'p1', start: NOW, end: NOW + HOUR } });
  db = apply(db, { type: 'project.delete', id: 'p1' });
  assert.equal(db.entries.length, 1);
  assert.equal(db.entries[0].projectId, null);
});

test('migrate repairs broken data', () => {
  const db = migrate({
    projects: [{ id: 'p', name: 'P', clientId: 'missing' }],
    entries: [
      { id: 'a', start: 1, end: null, projectId: 'p', tags: ['nope'], status: 'weird' },
      { id: 'b', start: 2, end: null },
      { id: 'c' },
    ],
  });
  assert.equal(db.projects[0].clientId, null);
  assert.equal(db.entries.length, 2);
  assert.equal(db.entries.filter((e) => e.end == null).length, 1);
  assert.deepEqual(db.entries[0].tags, []);
  assert.equal(db.entries[0].status, 'unbilled');
  assert.equal(db.settings.currency, 'EUR');
});

test('quick entry: timer with project and tags', () => {
  const db = seed();
  const q = parseQuick(db, 'Homepage hero @website #design #new', NOW);
  assert.equal(q.note, 'Homepage hero');
  assert.equal(q.projectId, 'p1');
  assert.deepEqual(q.tags, ['t1']);
  assert.deepEqual(q.newTags, ['new']);
  assert.equal(quickOp(q).type, 'timer.start');
  const next = apply(db, quickOp(q), NOW);
  assert.equal(next.tags.length, 2);
  assert.equal(running(next).tags.length, 2);
});

test('quick entry: durations, ranges and yesterday', () => {
  const db = seed();
  const a = parseQuick(db, 'Calls 1h30 @acme', NOW);
  assert.equal(a.projectId, 'p1'); // matched by client name
  assert.equal(a.end - a.start, 90 * MIN);
  assert.equal(a.end, NOW);
  const b = parseQuick(db, 'Standup 9:30-9:45', NOW);
  assert.equal(b.start, startOfDay(NOW) + 570 * MIN);
  assert.equal(b.end - b.start, 15 * MIN);
  const c = parseQuick(db, 'Prep 45m yesterday', NOW);
  assert.equal(c.end, addDays(NOW, -1));
  assert.equal(quickOp(c).type, 'entry.add');
  const d = parseQuick(db, 'Fix 2 bugs @unknown', NOW);
  assert.equal(d.note, 'Fix 2 bugs @unknown');
  assert.equal(d.unknownProject, 'unknown');
  assert.equal(d.start, null);
});

test('report totals, rounding, amounts and status filter', () => {
  let db = seed();
  db = apply(db, { type: 'settings.update', patch: { rounding: 15 } });
  db = apply(db, { type: 'entry.add', entry: { note: 'a', projectId: 'p1', tags: ['t1'], start: NOW, end: NOW + 50 * MIN } });
  db = apply(db, { type: 'entry.add', entry: { note: 'b', projectId: 'p2', start: NOW + HOUR, end: NOW + 2 * HOUR } });
  db = apply(db, { type: 'entry.add', entry: { note: 'old', projectId: 'p1', start: addDays(NOW, -30), end: addDays(NOW, -30) + HOUR } });
  const [from, to] = rangeFor('week', NOW);
  const r = buildReport(db, defaultFilter(from, to), NOW);
  assert.equal(r.rows.length, 2);
  assert.equal(r.total, 2 * HOUR);          // 50m → 1h, plus 1h
  assert.equal(r.billable, HOUR);
  assert.equal(r.amount, 100);
  assert.equal(r.byProject[0].count, 1);
  assert.equal(r.byDay.length, 7);
  assert.equal(r.byTag.find((t) => t.name === 'design').dur, HOUR);

  db = apply(db, { type: 'entry.status', ids: [r.rows[0].id], status: 'billed' });
  const unbilled = buildReport(db, { ...defaultFilter(from, to), status: 'unbilled' }, NOW);
  assert.equal(unbilled.rows.length, 1);
  assert.equal(unbilled.rows[0].note, 'b');

  const csv = toCSV(r).trim().split('\n');
  assert.equal(csv.length, 3);
  assert.match(csv[1], /,1\.00,Acme,Website,design,a,yes,100\.00,100\.00,unbilled$/);
});

test('recents dedupes repeated work', () => {
  let db = seed();
  for (let i = 0; i < 3; i++) db = apply(db, { type: 'entry.add', entry: { note: 'same', projectId: 'p1', start: NOW + i * HOUR, end: NOW + i * HOUR + MIN * 10 } });
  db = apply(db, { type: 'entry.add', entry: { note: 'other', start: NOW - HOUR, end: NOW - HOUR + MIN * 10 } });
  assert.deepEqual(recents(db).map((e) => e.note), ['same', 'other']);
});
