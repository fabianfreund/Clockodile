// Persistence: one JSON file in userData, written atomically, plus a daily backup (last 14 kept).
import fs from 'node:fs';
import path from 'node:path';
import { emptyDb, migrate } from '../core/model.js';
import { fmtISODate } from '../core/time.js';

const KEEP_BACKUPS = 14;

export function createStore(dir) {
  const file = path.join(dir, 'clockodile.json');
  const backups = path.join(dir, 'backups');
  let timer = null;
  let pending = null;

  function load() {
    try {
      return migrate(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Unreadable file: keep it aside instead of overwriting it with an empty database.
        const aside = `${file}.broken-${Date.now()}`;
        try { fs.renameSync(file, aside); } catch {}
        console.error(`clockodile.json could not be read (${err.message}); moved to ${aside}`);
      }
      return emptyDb();
    }
  }

  function writeNow(db) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, file);
    backup();
  }

  function backup() {
    try {
      fs.mkdirSync(backups, { recursive: true });
      const today = path.join(backups, `clockodile-${fmtISODate(Date.now())}.json`);
      if (!fs.existsSync(today)) fs.copyFileSync(file, today);
      const old = fs.readdirSync(backups).filter((f) => /^clockodile-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -KEEP_BACKUPS);
      for (const f of old) fs.rmSync(path.join(backups, f));
    } catch (err) { console.error('backup', err); }
  }

  /** Debounced save; flush() writes immediately (on quit). */
  function save(db) {
    pending = db;
    clearTimeout(timer);
    timer = setTimeout(flush, 250);
  }
  function flush() {
    clearTimeout(timer);
    if (!pending) return;
    const db = pending;
    pending = null;
    try { writeNow(db); } catch (err) { console.error('save', err); }
  }

  return { file, dir, load, save, flush };
}
