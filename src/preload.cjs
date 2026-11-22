// Safe bridge between the pages and the main process (window.clockodile).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clockodile', {
  platform: process.platform,
  getDb: () => ipcRenderer.invoke('db:get'),
  apply: (op) => ipcRenderer.invoke('db:apply', op),
  onDb: (cb) => ipcRenderer.on('db', (_e, db) => cb(db)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, cmd) => cb(cmd)),
  exportPdf: (job) => ipcRenderer.invoke('export:pdf', job),
  exportCsv: (csv, fileName) => ipcRenderer.invoke('export:csv', csv, fileName),
  exportJson: () => ipcRenderer.invoke('export:json'),
  importFile: () => ipcRenderer.invoke('data:import'),
  openDataFolder: () => ipcRenderer.send('data:folder'),
  getLogin: () => ipcRenderer.invoke('login:get'),
  setLogin: (on) => ipcRenderer.send('login:set', on),
  setShortcut: (acc) => ipcRenderer.invoke('shortcut:set', acc),
  info: () => ipcRenderer.invoke('app:info'),
  confirm: (message, detail, okLabel) => ipcRenderer.invoke('confirm', message, detail, okLabel),
  openMain: (cmd) => ipcRenderer.send('open-main', cmd),
  hidePopover: () => ipcRenderer.send('popover:hide'),
  pdfJob: () => ipcRenderer.invoke('pdf:job'),
  pdfReady: () => ipcRenderer.send('pdf:ready'),
});
