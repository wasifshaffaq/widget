const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  setIgnoreMouseEvents: (ignore, options) => ipcRenderer.send('set-ignore-mouse-events', ignore, options),
  getSystemStats: () => ipcRenderer.invoke('get-system-stats'),
  dragWindow: (movementX, movementY) => ipcRenderer.send('drag-window', movementX, movementY),
  openSettings: () => ipcRenderer.send('open-settings'),
  onStatsUpdate: (callback) => ipcRenderer.on('stats-update', (_event, value) => callback(value)),
  onConfigUpdate: (callback) => ipcRenderer.on('config-update', (_event, value) => callback(value)),
  resizeWindow: (width, height) => ipcRenderer.send('resize-window', width, height)
});
