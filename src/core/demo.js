// Demo data for screenshots and the smoke test (CLOCKODILE_DEBUG_SEED=1). Deterministic for a given `now`.
import { apply, emptyDb } from './model.js';
import { MIN, addDays, startOfDay, startOfWeek } from './time.js';

export function demoDb(now = Date.now()) {
  let db = emptyDb();
  const op = (o, t) => { db = apply(db, o, t); };
  op({ type: 'settings.update', patch: { currency: 'EUR', rate: 80, business: { name: 'Fabian Builds', details: 'hello@example.com' } } });
  op({ type: 'client.save', client: { id: 'acme', name: 'Acme Studio', rate: 95 } });
  op({ type: 'client.save', client: { id: 'north', name: 'Northwind', rate: 110 } });
  op({ type: 'project.save', project: { id: 'web', name: 'Website Relaunch', clientId: 'acme', color: '#34c77b' } });
  op({ type: 'project.save', project: { id: 'brand', name: 'Brand Refresh', clientId: 'acme', color: '#ff9f0a' } });
  op({ type: 'project.save', project: { id: 'app', name: 'Mobile App', clientId: 'north', color: '#0a84ff' } });
  op({ type: 'project.save', project: { id: 'admin', name: 'Admin', color: '#8e8e93', billable: false } });
  for (const name of ['design', 'meeting', 'dev', 'review']) op({ type: 'tag.save', tag: { id: name, name } });

  // Two weeks of plausible workdays.
  const plan = [
    [[9, 0, 30, 'admin', 'Inbox & planning', []], [9, 30, 150, 'web', 'Homepage hero layout', ['design']], [13, 0, 45, 'app', 'Sprint planning', ['meeting']], [14, 0, 180, 'app', 'Onboarding screens', ['dev']]],
    [[9, 15, 60, 'brand', 'Logo explorations', ['design']], [10, 30, 120, 'web', 'CMS templates', ['dev']], [14, 0, 30, 'app', 'Weekly sync', ['meeting']], [14, 45, 135, 'app', 'Push notifications', ['dev']]],
    [[8, 45, 90, 'app', 'Bug fixes from QA', ['dev', 'review']], [10, 30, 60, 'web', 'Client feedback round', ['meeting']], [13, 15, 165, 'brand', 'Color system', ['design']], [16, 15, 45, 'admin', 'Invoices', []]],
    [[9, 0, 210, 'web', 'Responsive navigation', ['dev']], [13, 30, 60, 'brand', 'Typography review', ['design', 'review']], [14, 45, 120, 'app', 'Settings screen', ['dev']]],
    [[9, 30, 120, 'app', 'Release prep', ['dev']], [12, 0, 45, 'web', 'Launch checklist', ['review']], [14, 0, 90, 'brand', 'Presentation deck', ['design']]],
  ];
  const today = startOfDay(now);
  const monday = startOfWeek(now, 1);
  for (let week = -1; week <= 0; week++) {
    plan.forEach((day, i) => {
      const d = addDays(monday, week * 7 + i);
      if (d > today) return;
      for (const [h, m, len, projectId, note, tags] of day) {
        const start = d + (h * 60 + m) * MIN;
        const end = start + len * MIN;
        if (end > now) continue;
        op({ type: 'entry.add', entry: { note, projectId, tags, start, end } });
      }
    });
  }
  // Last week's Acme work has been invoiced.
  const billed = db.entries.filter((e) => e.start < monday && ['web', 'brand'].includes(e.projectId)).map((e) => e.id);
  op({ type: 'entry.status', ids: billed, status: 'billed' });
  op({ type: 'timer.start', note: 'Checkout flow', projectId: 'app', tags: ['dev'], start: now - 47 * MIN }, now);
  return db;
}
