const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  loadOBJ: (filePath) => ipcRenderer.invoke('load-obj', filePath),
  exportClippedOBJ: (data) => ipcRenderer.invoke('export-clipped-obj', data),
  onLoadProgress: (cb) => ipcRenderer.on('load-progress', (_e, p) => cb(p)),
  onExportProgress: (cb) => ipcRenderer.on('export-progress', (_e, p) => cb(p)),
});
