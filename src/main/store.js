// Tiny JSON-file store kept in the OS user-data dir. Deliberately not SQLite or
// electron-store: a single small JSON blob (last directory + track list) is all
// the prototype needs, and a few lines of fs keep the dependency count at zero.
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULT = { lastDir: null, volume: 0.9, visualizer: null, plays: {}, history: [], skin: 'neon' };

// Resolved lazily: app.getPath() is only valid once the app module is ready, and
// load/save are always called from IPC handlers (well after that point).
const file = () => path.join(app.getPath('userData'), 'library.json');

function load() {
  try {
    return { ...DEFAULT, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    return { ...DEFAULT };
  }
}

function save(data) {
  try {
    fs.writeFileSync(file(), JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error('store.save failed:', err);
    return false;
  }
}

module.exports = { load, save };
