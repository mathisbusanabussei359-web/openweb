const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('openweb', {
  action: (action, input) => ipcRenderer.invoke('openweb:action', action, input),
  onState: (listener) => ipcRenderer.on('openweb:changed', (_event, state) => listener(state)),
  onNotice: (listener) => ipcRenderer.on('openweb:notice', (_event, message) => listener(message)),
  onAddress: (listener) => ipcRenderer.on('openweb:address', () => listener()),
  onFind: (listener) => ipcRenderer.on('openweb:find', () => listener()),
});
