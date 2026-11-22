// End-to-end smoke test: launches the real app with demo data in a throwaway profile, drives each
// view, exports a PDF, and fails on renderer errors. Screenshots land in a temp folder.
// Run: npm run smoke   (SMOKE_OUT=docs/assets to keep the screenshots)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = createRequire(import.meta.url)('electron');
const dir = process.env.SMOKE_OUT ? path.resolve(process.env.SMOKE_OUT) : fs.mkdtempSync(path.join(os.tmpdir(), 'clockodile-smoke-'));
fs.mkdirSync(dir, { recursive: true });

// Timemator-style CSV for the import case.
const importFile = path.join(dir, 'timemator.csv');
fs.writeFileSync(importFile, `unix_begin;unix_end;date;begin;end;folder;task;duration;duration_decimal;rounding_to;rounding_method;hourly_rate;revenue;billing_status;notes
1767694031;1767695053;2026-01-06;17:07;17:24;"Studio Nord";"Drawing";0:17;0.28;0;nearest;25.00;7.10;paid;""
1767789219;1767794137;2026-01-07;19:33;20:55;"Studio Nord";"Coding";1:21;1.37;0;nearest;25.00;34.15;paid;"Login bug"
1794983648;1794986708;2026-11-18;13:34;14:25;"Studio Nord";"Drawing";0:51;0.85;0;nearest;29.00;24.65;unbilled;""
`);

const wait = 'await new Promise((r) => setTimeout(r, 350));';
const q = 'const q = (s) => document.querySelector(s), qa = (s) => [...document.querySelectorAll(s)];';
const nav = (label) => `qa('.nav-item').find((b) => b.textContent.includes('${label}')).click(); ${wait}`;

const CASES = {
  track: `(async () => { ${q}
    if (!q('.timer-card.running')) throw new Error('demo timer not running');
    if (qa('.entry').length < 1) throw new Error('no entries on today');
    if (qa('.week-day').length !== 7) throw new Error('week strip missing');
  })()`,
  quick: `(async () => { ${q}
    const input = q('.timer-input');
    q('.go').click(); ${wait}                       // stop the demo timer
    if (q('.timer-card.running')) throw new Error('timer did not stop');
    input.value = 'Smoke test @website #dev 25m';
    input.dispatchEvent(new Event('input'));
    if (!q('.timer-hint').textContent.includes('Website Relaunch')) throw new Error('hint did not resolve project: ' + q('.timer-hint').textContent);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); ${wait}
    if (!qa('.entry-note').some((n) => n.textContent === 'Smoke test')) throw new Error('quick entry not logged');
    input.value = 'Writing tests'; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); ${wait}
    if (!q('.timer-card.running')) throw new Error('timer did not start');
    q('.timer-input').blur();
  })()`,
  reports: `(async () => { ${q}
    ${nav('Reports')}
    if (qa('.tile').length !== 4) throw new Error('tiles missing');
    if (!qa('.chart-col').length) throw new Error('chart empty');
    if (!qa('.et-row').length) throw new Error('entries table empty');
    qa('.et-row input')[0].click(); ${wait}
    if (!q('.bulk')) throw new Error('bulk actions not shown');
    q('.bulk .btn').click(); ${wait}
    q('#top-actions .btn.primary').click(); ${wait} // Export sheet (PDF is the default format)
    if (!q('.sheet')) throw new Error('export sheet not open');
    q('.sheet-foot .btn.primary').click();
    await new Promise((r) => setTimeout(r, 2500));
    if (q('.sheet')) throw new Error('pdf export did not finish');
  })()`,
  sidebar: `(async () => { ${q}
    if (!q('.side-card.running')) throw new Error('timer card missing');
    q('.side-card .go').click(); ${wait}
    if (q('.side-card.running')) throw new Error('card did not stop the timer');
    const row = qa('.side-project')[1];
    if (!row) throw new Error('no sidebar projects');
    row.click(); ${wait}
    if (!q('.side-project.on') || !q('.timer-card.running')) throw new Error('project click did not start tracking');
    q('#sidebar').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 60, clientY: 400 })); ${wait}
    if (!q('.panel')) throw new Error('customize menu missing');
    qa('.panel .menu-item').find((b) => b.textContent === 'Unbilled').click(); ${wait}
    if (qa('.stat').some((s) => s.textContent.startsWith('Unbilled'))) throw new Error('could not hide Unbilled');
  })()`,
  projects: `(async () => { ${q}
    ${nav('Projects')}
    if (qa('.proj-row').length < 4) throw new Error('projects missing');
    qa('.proj-row .play-btn')[0].click(); ${wait}
    if (!q('.proj-row .play-btn.on')) throw new Error('project play did not start');
    q('#top-actions .btn.primary').click(); ${wait}
    if (!q('.sheet')) throw new Error('project sheet not open');
  })()`,
  settings: `(async () => { ${q}
    ${nav('Settings')}
    if (qa('.set-row').length < 8) throw new Error('settings rows missing');
  })()`,
  import: `(async () => { ${q}
    ${nav('Settings')}
    qa('.set-row').find((r) => r.textContent.startsWith('Import')).querySelector('button').click(); ${wait}
    if (!q('.import-stats')) throw new Error('import preview not shown');
    if (!q('.import-head').textContent.includes('Timemator')) throw new Error('source not detected');
    q('.sheet-foot .btn.primary').click(); ${wait}
    ${nav('Projects')}
    if (!qa('.proj-name').some((n) => n.textContent === 'Drawing')) throw new Error('imported project missing');
    q('.nav-item').click(); ${wait}
    ${nav('Settings')}
    qa('.set-row').find((r) => r.textContent.startsWith('Import')).querySelector('button').click(); ${wait}
  })()`,
  entry: `(async () => { ${q}
    qa('.entry')[0].click(); ${wait}
    if (!q('.sheet .entry-form')) throw new Error('entry sheet not open');
  })()`,
};

function run(name, env = {}) {
  return new Promise((resolve) => {
    const shot = path.join(dir, `${name}.png`);
    const pdf = path.join(dir, `${name}.pdf`);
    const child = spawn(electron, [root], {
      env: { ...process.env, CLOCKODILE_DEBUG_SHOT: shot, CLOCKODILE_DEBUG_QUIT: '1', CLOCKODILE_DEBUG_SEED: '1', CLOCKODILE_DEBUG_PDF: pdf, CLOCKODILE_DEBUG_IMPORT: importFile, ...env },
    });
    let log = '';
    child.stdout.on('data', (d) => { log += d; });
    child.stderr.on('data', (d) => { log += d; });
    const timer = setTimeout(() => { log += '\n[smoke] timed out'; child.kill(); }, 40000);
    child.on('exit', () => {
      clearTimeout(timer);
      const problems = log.split('\n').filter((l) => /\[renderer:error\]|debug js error|timed out/.test(l));
      if (!fs.existsSync(shot)) problems.push('no screenshot written');
      if (name === 'reports' && !fs.existsSync(pdf)) problems.push('no PDF written');
      resolve({ name, ok: problems.length === 0, problems, shot });
    });
  });
}

const results = [];
for (const [name, js] of Object.entries(CASES)) results.push(await run(name, { CLOCKODILE_DEBUG_JS: js }));
results.push(await run('popover', { CLOCKODILE_DEBUG_WINDOW: 'popover' }));
for (const r of results) {
  console.log(`${r.ok ? '✔' : '✖'} ${r.name}${r.ok ? `  (${r.shot})` : ''}`);
  r.problems.forEach((p) => console.log(`    ${p}`));
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
