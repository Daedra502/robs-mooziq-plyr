// Minimal, explicit bridge between the sandboxed renderer and the main process.
// Nothing here exposes raw Node or ipcRenderer to the page.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listDir: (dirPath) => ipcRenderer.invoke('fs:listDir', dirPath),
  getArt: (filePath) => ipcRenderer.invoke('fs:getArt', filePath),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  defaultDir: () => ipcRenderer.invoke('fs:defaultDir'),
  pickDirectory: () => ipcRenderer.invoke('dialog:pickDirectory'),
  scan: (paths) => ipcRenderer.invoke('library:scan', paths),
  loadStore: () => ipcRenderer.invoke('store:load'),
  saveStore: (data) => ipcRenderer.invoke('store:save', data),
  // Modern Electron removed File.path; this is the supported replacement for
  // resolving the on-disk path of a drag-and-dropped File/folder.
  getPathForFile: (file) => webUtils.getPathForFile(file),
});
