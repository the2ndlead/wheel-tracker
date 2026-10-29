// Exposes a narrow API to the renderer as window.wheelDesktop (see src/lib/platform.ts).
const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel) => (callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('wheelDesktop', {
  platform: process.platform,
  listReports: (folder) => ipcRenderer.invoke('reports:list', folder),
  listFolders: () => ipcRenderer.invoke('reports:folders'),
  readReport: (folder, name) => ipcRenderer.invoke('reports:read', folder, name),
  openReportsFolder: (folder) => ipcRenderer.invoke('reports:open-folder', folder),
  reportsDir: (folder) => ipcRenderer.invoke('reports:dir', folder),
  onReportsChanged: subscribe('reports:changed'),
  fetchChart: (symbol) => ipcRenderer.invoke('quotes:chart', symbol),
  fetchOptionChain: (symbol, expiry) => ipcRenderer.invoke('quotes:options', symbol, expiry),
  version: () => ipcRenderer.invoke('app:version'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: subscribe('update:status'),
});
