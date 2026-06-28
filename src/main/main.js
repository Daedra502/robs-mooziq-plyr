const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const os = require('os');

// Lean on the GPU for the canvas-heavy visualizers/overlay. ignore-gpu-blocklist
// enables acceleration on driver setups Chromium would otherwise reject.
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
const path = require('path');
const store = require('./store');
const library = require('./library');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#0a0a0f',
    title: 'Music Player',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // sandbox off so the preload can use Node's `webUtils`/`url` helpers.
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // --- Navigation hardening --------------------------------------------------
  // This app only ever shows its own bundled page. Block any attempt to open
  // new windows or navigate elsewhere (e.g. a crafted link or media tag in
  // someone else's files), so the renderer can't be steered to remote content.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

// --- IPC ---------------------------------------------------------------------

ipcMain.handle('dialog:pickDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a music folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// One level of a directory for the folder browser.
ipcMain.handle('fs:listDir', async (_event, dirPath) => {
  try {
    return await library.listDir(dirPath);
  } catch (err) {
    console.error('fs:listDir failed:', err);
    return null;
  }
});

// Embedded album art for one track (data URL or null), loaded on demand.
ipcMain.handle('fs:getArt', (_event, filePath) => library.getArt(filePath));

// Raw bytes of a file (for decoding waveform peaks in the renderer). Returned as
// a Buffer, which arrives in the renderer as a Uint8Array. Restricted to audio
// files so this can't be used to read arbitrary paths off disk.
ipcMain.handle('fs:readFile', (_event, filePath) => {
  if (typeof filePath !== 'string' || !library.isAudioPath(filePath)) return null;
  return require('fs/promises').readFile(filePath);
});

// A sensible starting directory when nothing is persisted yet.
ipcMain.handle('fs:defaultDir', () => {
  try {
    return app.getPath('music');
  } catch {
    return os.homedir();
  }
});

// `paths` may contain files and/or directories (from the picker or drag-drop).
ipcMain.handle('library:scan', async (_event, paths) => {
  if (!Array.isArray(paths) || paths.length === 0) return [];
  try {
    return await library.scan(paths);
  } catch (err) {
    console.error('library:scan failed:', err);
    return [];
  }
});

ipcMain.handle('store:load', () => store.load());
ipcMain.handle('store:save', (_event, data) => store.save(data));

// --- App lifecycle -----------------------------------------------------------

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
