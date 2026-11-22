import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, parseDate, planImport, readCSV } from '../src/core/importer.js';
import { apply, emptyDb, rateFor } from '../src/core/model.js';
import { buildReport, defaultFilter, toCSV } from '../src/core/report.js';

// Same columns as a real Timemator export (semicolons, unix seconds, folder = client, task = project).
const TIMEMATOR = `unix_begin;unix_end;date;begin;end;folder;task;duration;duration_decimal;rounding_to;rounding_method;hourly_rate;revenue;billing_status;notes
1767694031;1767695053;2026-01-06;17:07;17:24;"ACME";"Drawing";0:17;0.28;0;nearest;25.00;7.10;paid;""
1767789219;1767794137;2026-01-07;19:33;20:55;"ACME";"Coding";1:21;1.37;0;nearest;25.00;34.15;paid;"Fix ""login"" bug; again"
1768118564;1768118564;2026-01-11;15:02;15:02;"ACME";"Drawing";0:00;0.00;0;nearest;25.00;0.00;paid;""
1794983648;1794986708;2026-11-18;13:34;14:25;"ACME";"Drawing";0:51;0.85;0;nearest;29.00;24.65;unbilled;""
`;

const TOGGL = `User,Email,Client,Project,Task,Description,Billable,Start date,Start time,End date,End time,Duration,Tags,Amount (EUR)
Jo,jo@x.io,Beta GmbH,Website,,Header design,Yes,2026-03-02,09:00:00,2026-03-02,10:30:00,01:30:00,"design, ui",120.00
Jo,jo@x.io,,Internal,,Planning,No,2026-03-02,23:30:00,2026-03-03,00:15:00,00:45:00,,0.00
`;

test('CSV parser handles quotes, escaped quotes, delimiters and BOM', () => {
  const { headers, rows, delimiter } = parseCSV('﻿a;b;c\n1;"x;y";"say ""hi"""\n\n2;3;4\n');
  assert.equal(delimiter, ';');
  assert.deepEqual(headers, ['a', 'b', 'c']);
  assert.deepEqual(rows, [['1', 'x;y', 'say "hi"'], ['2', '3', '4']]);
});

test('dates in common formats', () => {
  assert.equal(parseDate('2026-11-20'), new Date(2026, 10, 20).getTime());
  assert.equal(parseDate('20.11.2026'), new Date(2026, 10, 20).getTime());
  assert.equal(parseDate('11/20/2026'), new Date(2026, 10, 20).getTime());
  assert.equal(parseDate('20/11/2026'), new Date(2026, 10, 20).getTime());
});

test('Timemator: folders become clients, tasks become projects, rates and status kept', () => {
  const read = readCSV(TIMEMATOR);
  assert.equal(read.source, 'Timemator');
  assert.equal(read.entries.length, 3);
  assert.equal(read.empty, 1);
  assert.equal(read.entries[1].note, 'Fix "login" bug; again');

  let db = emptyDb();
  const { op, summary } = planImport(db, read);
  assert.deepEqual(summary.clients, ['ACME']);
  assert.deepEqual(summary.projects.map((p) => p.name).sort(), ['Coding', 'Drawing']);
  db = apply(db, op);
  const drawing = db.projects.find((p) => p.name === 'Drawing');
  assert.equal(drawing.rate, 29); // latest rate becomes the project rate
  const old = db.entries.find((e) => e.projectId === drawing.id && e.status === 'paid');
  assert.equal(rateFor(db, old), 25); // history keeps its own rate
  const r = buildReport(db, defaultFilter(0, 8.64e15));
  assert.ok(Math.abs(r.amount - (1022 / 3600) * 25 - (4918 / 3600) * 25 - (3060 / 3600) * 29) < 0.001);

  // Importing the same file again adds nothing.
  assert.equal(planImport(db, read).summary.entries, 0);
});

test('Toggl/Clockify: separate dates, seconds, midnight, billable, tags', () => {
  const read = readCSV(TOGGL);
  assert.equal(read.source, 'Toggl or Clockify');
  assert.equal(read.entries.length, 2);
  const [a, b] = read.entries;
  assert.equal(a.end - a.start, 90 * 60_000);
  assert.deepEqual(a.tags, ['design', 'ui']);
  assert.equal(a.billable, true);
  assert.equal(b.billable, false);
  assert.equal(b.end - b.start, 45 * 60_000);
  let db = apply(emptyDb(), planImport(emptyDb(), read).op);
  assert.equal(db.tags.length, 2);
  assert.equal(db.projects.find((p) => p.name === 'Internal').clientId, null);
});

test('Clockodile CSV round-trips through the importer', () => {
  let db = apply(emptyDb(), planImport(emptyDb(), readCSV(TOGGL)).op);
  const csv = toCSV(buildReport(db, defaultFilter(0, 8.64e15)), { excel: true });
  const read = readCSV(csv);
  assert.equal(read.source, 'Clockodile');
  assert.equal(read.entries.length, 2);
  assert.equal(planImport(db, read).summary.duplicates, 2);
  const fresh = planImport(emptyDb(), read);
  assert.deepEqual(fresh.summary.projects.map((p) => p.name).sort(), ['Internal', 'Website']);
});
