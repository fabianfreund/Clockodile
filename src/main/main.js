// Clockodile main process: owns the database, the menu-bar timer, windows, idle detection and exports.
import {
  app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, nativeImage, powerMonitor, screen, shell,
} from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, migrate, recents, running } from '../core/model.js';
import { demoDb } from '../core/demo.js';
import { fmtClock, fmtDuration, fmtHuman } from '../core/time.js';
import { createStore } from './store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UI = (f) => path.join(HERE, '..', 'ui', f);
const ASSET = (f) => path.join(HERE, '..', 'assets', f);
const PRELOAD = path.join(HERE, '..', 'preload.cjs');
const IS_MAC = process.platform === 'darwin';
const DEBUG = !app.isPackaged && !!process.env.CLOCKODILE_DEBUG_SHOT;
const DEMO = !app.isPackaged && !!process.env.CLOCKODILE_DEMO; // npm run demo: sample data, nothing saved
const SANDBOX = DEBUG || DEMO;

// ── Single instance + profile ────────────────────────────────────────────────
// Debug and demo runs get a throwaway profile so they never touch real data or a running Clockodile.
if (SANDBOX) app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'clockodile-debug-')));
else if (!app.requestSingleInstanceLock()) app.quit();
app.setName('Clockodile');

let store, db;
let tray = null, mainWin = null, popover = null;
const pdfReady = new Map(); // webContents id → resolve

app.on('second-instance', () => openMain());

app.whenReady().then(() => {
  store = createStore(app.getPath('userData'));
  db = DEMO || (DEBUG && process.env.CLOCKODILE_DEBUG_SEED) ? demoDb() : store.load();
  buildMenu();
  createTray();
  registerShortcut();
  watchIdle();
  setInterval(tick, 1000);
  const hidden = IS_MAC && app.getLoginItemSettings().wasOpenedAtLogin;
  if (DEBUG && process.env.CLOCKODILE_DEBUG_WINDOW === 'popover') togglePopover(true);
  else if (!hidden) openMain();
  syncDock();
});

app.on('activate', () => openMain());
app.on('window-all-closed', () => { /* keep running in the menu bar */ });
app.on('before-quit', () => store?.flush());
app.on('will-quit', () => globalShortcut.unregisterAll());

// ── Database ─────────────────────────────────────────────────────────────────
function commit(next) {
  const wasRunning = running(db)?.id;
  db = next;
  if (!SANDBOX) store.save(db);
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('db', db);
  if (running(db)?.id !== wasRunning) buildMenu();
  tick();
}

function run(op) {
  try {
    commit(apply(db, op));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

ipcMain.handle('db:get', () => db);
ipcMain.handle('db:apply', (_e, op) => run(op));

// ── Tray (menu bar) ──────────────────────────────────────────────────────────
function trayImage() {
  const img = nativeImage.createFromPath(ASSET(IS_MAC ? 'trayTemplate.png' : 'tray.png'));
  if (IS_MAC) img.setTemplateImage(true);
  return img;
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip('Clockodile');
  tray.on('click', () => togglePopover());
  tray.on('right-click', () => tray.popUpContextMenu(trayMenu()));
}

function trayMenu() {
  const r = running(db);
  return Menu.buildFromTemplate([
    r ? { label: `Stop “${r.note || 'Timer'}”`, click: () => run({ type: 'timer.stop' }) } : { label: 'No timer running', enabled: false },
    { type: 'separator' },
    { label: 'Open Clockodile', click: openMain },
    { label: 'Reports', click: () => openMain('go:reports') },
    { type: 'separator' },
    { label: 'Quit Clockodile', role: 'quit' },
  ]);
}

let lastTitle = null;
function tick() {
  if (!tray) return;
  const r = running(db);
  const title = r && db.settings.showTimerInMenuBar ? fmtDuration(Date.now() - r.start) : '';
  if (title !== lastTitle) {
    lastTitle = title;
    if (IS_MAC) tray.setTitle(title ? ` ${title}` : '', { fontType: 'monospacedDigit' });
    tray.setToolTip(r ? `${r.note || 'Timer'} · ${fmtHuman(Date.now() - r.start)}` : 'Clockodile');
  }
}

// ── Windows ──────────────────────────────────────────────────────────────────
function syncDock() {
  if (!IS_MAC || !app.dock) return;
  if (mainWin && !mainWin.isDestroyed()) app.dock.show(); else app.dock.hide();
}

function openMain(cmd) {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.show(); mainWin.focus();
    if (typeof cmd === 'string') mainWin.webContents.send('menu', cmd);
    return mainWin;
  }
  mainWin = new BrowserWindow({
    width: 1120, height: 760, minWidth: 820, minHeight: 540, show: false,
    title: 'Clockodile',
    ...(IS_MAC
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 20 }, vibrancy: 'sidebar', visualEffectState: 'followWindow', backgroundColor: '#00000000' }
      : { backgroundColor: '#f6f6f8', autoHideMenuBar: true }),
    webPreferences: { preload: PRELOAD },
  });
  mainWin.loadFile(UI('app.html'), { query: { platform: process.platform } });
  mainWin.once('ready-to-show', () => {
    mainWin.show();
    if (typeof cmd === 'string') mainWin.webContents.send('menu', cmd);
  });
  mainWin.on('closed', () => { mainWin = null; setImmediate(syncDock); });
  syncDock();
  devHooks(mainWin);
  return mainWin;
}

function togglePopover(forceShow) {
  if (popover && !popover.isDestroyed() && popover.isVisible() && !forceShow) { popover.hide(); return; }
  if (!popover || popover.isDestroyed()) {
    popover = new BrowserWindow({
      width: 360, height: 480, show: false, frame: false, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true,
      ...(IS_MAC ? { vibrancy: 'popover', visualEffectState: 'active', backgroundColor: '#00000000', roundedCorners: true } : { backgroundColor: '#f6f6f8' }),
      webPreferences: { preload: PRELOAD },
    });
    popover.loadFile(UI('popover.html'), { query: { platform: process.platform } });
    popover.on('blur', () => { if (!DEBUG && !popover.webContents.isDevToolsOpened()) popover.hide(); });
    devHooks(popover);
  }
  positionPopover();
  const show = () => { popover.show(); popover.focus(); popover.webContents.send('menu', 'focus-quick'); };
  if (popover.webContents.isLoading()) popover.once('ready-to-show', show); else show();
}

function positionPopover() {
  const [w, h] = popover.getSize();
  const b = tray.getBounds();
  const anchor = b.width ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(anchor).workArea;
  const below = anchor.y < area.y + area.height / 2; // menu bar on top (macOS) vs taskbar at the bottom
  const x = Math.round(Math.min(Math.max(anchor.x - w / 2, area.x + 8), area.x + area.width - w - 8));
  const y = below ? area.y + 6 : area.y + area.height - h - 6;
  popover.setPosition(x, y, false);
}

ipcMain.on('popover:hide', () => popover?.hide());
ipcMain.on('open-main', (_e, cmd) => { popover?.hide(); openMain(cmd); });

// ── Menu + shortcut ──────────────────────────────────────────────────────────
const send = (cmd) => () => openMain(cmd);

function buildMenu() {
  const r = running(db);
  const last = recents(db, 1)[0];
  const timerItem = r
    ? { label: `Stop “${r.note || 'Timer'}”`, accelerator: 'CmdOrCtrl+.', click: () => run({ type: 'timer.stop' }) }
    : { label: last ? `Continue “${last.note || 'last entry'}”` : 'Continue Last Entry', accelerator: 'CmdOrCtrl+.', enabled: !!last, click: () => last && run({ type: 'entry.continue', id: last.id }) };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(IS_MAC ? [{ role: 'appMenu', submenu: [
      { role: 'about' }, { type: 'separator' },
      { label: 'Settings…', accelerator: 'Cmd+,', click: send('go:settings') },
      { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] }] : []),
    { label: 'File', submenu: [
      { label: 'New Entry…', accelerator: 'CmdOrCtrl+N', click: send('new-entry') },
      { label: 'Quick Entry', accelerator: 'CmdOrCtrl+L', click: send('focus-quick') },
      { type: 'separator' },
      { label: 'Import…', accelerator: 'CmdOrCtrl+Shift+I', click: send('import') },
      { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: send('export') },
      { type: 'separator' },
      IS_MAC ? { role: 'close' } : { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'Timer', submenu: [timerItem, { label: 'Show Menu Bar Timer', accelerator: db.settings.shortcut || undefined, click: () => togglePopover(true) }] },
    { label: 'View', submenu: [
      { label: 'Track', accelerator: 'CmdOrCtrl+1', click: send('go:track') },
      { label: 'Reports', accelerator: 'CmdOrCtrl+2', click: send('go:reports') },
      { label: 'Projects', accelerator: 'CmdOrCtrl+3', click: send('go:projects') },
      { type: 'separator' },
      { label: 'Previous Day', accelerator: 'CmdOrCtrl+[', click: send('day:prev') },
      { label: 'Next Day', accelerator: 'CmdOrCtrl+]', click: send('day:next') },
      { label: 'Today', accelerator: 'CmdOrCtrl+0', click: send('day:today') },
      { type: 'separator' },
      { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Clockodile on GitHub', click: () => shell.openExternal('https://github.com/fabianfreund/Clockodile') }] },
  ]));
}

let registered = null;
function registerShortcut() {
  if (registered) globalShortcut.unregister(registered);
  registered = null;
  const acc = db.settings.shortcut;
  if (!acc) return true;
  try {
    if (globalShortcut.register(acc, () => togglePopover())) { registered = acc; return true; }
  } catch {}
  return false;
}
ipcMain.handle('shortcut:set', (_e, acc) => {
  const prev = db.settings.shortcut;
  commit(apply(db, { type: 'settings.update', patch: { shortcut: acc } }));
  if (registerShortcut()) { buildMenu(); return { ok: true }; }
  commit(apply(db, { type: 'settings.update', patch: { shortcut: prev } }));
  registerShortcut();
  return { ok: false, error: `${acc} is taken by another app.` };
});

// ── Idle detection ───────────────────────────────────────────────────────────
// While a timer runs, notice when the user has been away for `idleMinutes` (no input, screen
// locked or Mac asleep) and ask on return whether to keep that time.
function watchIdle() {
  let awaySince = null, asking = false;
  const limit = () => (db.settings.idleMinutes || 0) * 60_000;
  const markAway = () => { if (running(db) && limit() && !awaySince) awaySince = Date.now(); };
  powerMonitor.on('suspend', markAway);
  powerMonitor.on('lock-screen', markAway);
  setInterval(async () => {
    const r = running(db);
    if (!r || !limit() || asking) { if (!r) awaySince = null; return; }
    const idleMs = powerMonitor.getSystemIdleTime() * 1000;
    if (idleMs >= limit()) { awaySince ??= Date.now() - idleMs; return; }
    if (awaySince == null) return;
    const since = Math.max(awaySince, r.start);
    awaySince = null;
    if (Date.now() - since < limit()) return;
    asking = true;
    try { await askAboutIdle(r, since); } finally { asking = false; }
  }, 5000);
}

async function askAboutIdle(entry, since) {
  const away = fmtHuman(Date.now() - since);
  const { response } = await dialog.showMessageBox({
    type: 'question',
    message: `You were away for ${away}`,
    detail: `Since ${fmtClock(since)}, while tracking “${entry.note || 'Timer'}”. What should happen with that time?`,
    buttons: ['Keep the Time', 'Remove and Continue', 'Remove and Stop'],
    defaultId: 1, cancelId: 0,
  });
  const r = running(db);
  if (!r || r.id !== entry.id || response === 0) return;
  run({ type: 'timer.stop', end: since });
  if (response === 1) run({ type: 'timer.start', note: r.note, projectId: r.projectId, tags: r.tags, billable: r.billable });
}

// ── Exports ──────────────────────────────────────────────────────────────────
async function saveDialog(name, filters) {
  const win = BrowserWindow.getFocusedWindow() ?? mainWin;
  const res = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), name), filters });
  return res.canceled ? null : res.filePath;
}

/** Renders report.html in a hidden window and prints it to an A4 PDF buffer. */
async function renderPdf(job) {
  const win = new BrowserWindow({ show: false, width: 820, height: 1160, webPreferences: { preload: PRELOAD } });
  try {
    const ready = new Promise((resolve, reject) => {
      pdfReady.set(win.webContents.id, { resolve, job });
      setTimeout(() => reject(new Error('PDF render timed out')), 15000);
    });
    await win.loadFile(UI('report.html'));
    await ready;
    return await win.webContents.printToPDF({
      pageSize: 'A4', printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;padding:0 16mm;font:7px -apple-system,system-ui,sans-serif;color:#8e8e93;text-align:right"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
  } finally {
    pdfReady.delete(win.webContents.id);
    win.destroy();
  }
}
ipcMain.handle('pdf:job', (e) => ({ db, ...pdfReady.get(e.sender.id)?.job }));
ipcMain.on('pdf:ready', (e) => pdfReady.get(e.sender.id)?.resolve());

ipcMain.handle('export:pdf', async (_e, job) => {
  try {
    const target = DEBUG ? process.env.CLOCKODILE_DEBUG_PDF : await saveDialog(job.fileName, [{ name: 'PDF', extensions: ['pdf'] }]);
    if (!target) return { ok: false };
    fs.writeFileSync(target, await renderPdf(job));
    if (!DEBUG) shell.openPath(target);
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('export:json', async () => {
  const target = await saveDialog(`Clockodile Backup ${new Date().toISOString().slice(0, 10)}.json`, [{ name: 'JSON', extensions: ['json'] }]);
  if (!target) return { ok: false };
  fs.writeFileSync(target, JSON.stringify(db, null, 1));
  shell.showItemInFolder(target);
  return { ok: true, path: target };
});

ipcMain.handle('export:csv', async (_e, csv, fileName) => {
  const target = await saveDialog(fileName, [{ name: 'CSV', extensions: ['csv'] }]);
  if (!target) return { ok: false };
  fs.writeFileSync(target, `\ufeff${csv}`); // BOM so Excel reads UTF-8
  shell.showItemInFolder(target);
  return { ok: true, path: target };
});

// Import: a CSV comes back to the page for preview (core/importer.js); a .json backup replaces all data.
ipcMain.handle('data:import', async () => {
  const win = BrowserWindow.getFocusedWindow() ?? mainWin;
  const res = DEBUG && process.env.CLOCKODILE_DEBUG_IMPORT
    ? { filePaths: [process.env.CLOCKODILE_DEBUG_IMPORT] }
    : await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Time data', extensions: ['csv', 'tsv', 'txt', 'json'] }] });
  const file = res.filePaths?.[0];
  if (res.canceled || !file) return { ok: false };
  try {
    const text = fs.readFileSync(file, 'utf8');
    if (!file.toLowerCase().endsWith('.json')) return { ok: true, kind: 'csv', name: path.basename(file), text };
    const incoming = migrate(JSON.parse(text));
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning', message: 'Replace all data with this backup?',
      detail: `${incoming.entries.length} entries, ${incoming.projects.length} projects. Today's data stays in the backups folder.`,
      buttons: ['Replace', 'Cancel'], defaultId: 1, cancelId: 1,
    });
    if (response !== 0) return { ok: false };
    store.flush();
    const r = run({ type: 'db.import', db: incoming });
    return r.ok ? { ok: true, kind: 'backup' } : r;
  } catch (err) {
    return { ok: false, error: `Couldn't read this file: ${err.message}` };
  }
});

ipcMain.on('data:folder', () => shell.openPath(app.getPath('userData')));
ipcMain.handle('login:get', () => app.getLoginItemSettings().openAtLogin);
ipcMain.on('login:set', (_e, on) => app.setLoginItemSettings({ openAtLogin: !!on, openAsHidden: true }));
ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }));
ipcMain.handle('confirm', async (e, message, detail, okLabel = 'Delete') => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const { response } = await dialog.showMessageBox(win, { type: 'warning', message, detail, buttons: [okLabel, 'Cancel'], defaultId: 0, cancelId: 1 });
  return response === 0;
});

// ── Debug hooks (dev only, see docs/DEVELOPMENT.md) ──────────────────────────
function devHooks(win) {
  if (!DEBUG) return;
  win.webContents.on('console-message', (e) => {
    if (e.level === 'error') console.log(`[renderer:error] ${e.message}`);
  });
  win.webContents.once('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 600));
    try {
      if (process.env.CLOCKODILE_DEBUG_JS) await win.webContents.executeJavaScript(process.env.CLOCKODILE_DEBUG_JS);
    } catch (err) {
      console.log(`[smoke] debug js error: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 400));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(process.env.CLOCKODILE_DEBUG_SHOT, img.toPNG());
    console.log(`[smoke] wrote ${process.env.CLOCKODILE_DEBUG_SHOT}`);
    if (process.env.CLOCKODILE_DEBUG_QUIT) app.quit();
  });
}

