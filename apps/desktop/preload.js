const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopRuntime', {
  platform: process.platform,
  electronVersion: process.versions.electron,
  openPath: (targetPath) => ipcRenderer.invoke('desktop:openPath', targetPath)
});
