// File-system access for the renderer. Two jobs:
//   - listDir():  one level of a directory (sub-folders + audio files) for the
//                 file-explorer-style browser. NOT recursive.
//   - scan():     recursive collect (used by drag-and-drop of files/folders).
// Both run in the main process because they need Node fs and `music-metadata`.
const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');

// Containers Chromium can decode natively (plus a few via system codecs).
const AUDIO_EXTS = new Set([
  '.mp3', '.flac', '.wav', '.ogg', '.oga', '.opus',
  '.m4a', '.aac', '.mp4', '.weba', '.webm',
  '.aiff', '.aif', '.wma',
]);

const isAudio = (p) => AUDIO_EXTS.has(path.extname(p).toLowerCase());
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

// Lazily loaded ESM module (music-metadata v10 is ESM-only).
let _mm = null;
const mm = async () => (_mm ||= await import('music-metadata'));

// Read tags for one file, falling back to the filename for the title. Covers are
// skipped here for speed and fetched lazily per-row via getArt().
async function readMeta(file) {
  const track = {
    path: file,
    url: pathToFileURL(file).href,
    name: path.basename(file),
    title: path.parse(file).name,
    artist: '',
    album: '',
    duration: 0,
    bpm: 0,
    key: '',
    // Classic-player LCD readouts (kbps · kHz · stereo), filled from format below.
    bitrate: 0,
    sampleRate: 0,
    channels: 0,
    codec: '',
  };
  try {
    const meta = await (await mm()).parseFile(file, { duration: true, skipCovers: true });
    const c = meta.common || {};
    const f = meta.format || {};
    if (c.title) track.title = c.title;
    if (c.artist) track.artist = c.artist;
    if (c.album) track.album = c.album;
    if (c.bpm) track.bpm = Math.round(c.bpm);
    if (c.key) track.key = String(c.key);
    if (f.duration) track.duration = f.duration;
    if (f.bitrate) track.bitrate = Math.round(f.bitrate / 1000); // kbps
    if (f.sampleRate) track.sampleRate = f.sampleRate;            // Hz
    if (f.numberOfChannels) track.channels = f.numberOfChannels;
    if (f.codec) track.codec = String(f.codec);
  } catch {
    // Unreadable tags — keep the filename fallback.
  }
  return track;
}

// Lazily extract embedded album art as a data URL (cached, bounded LRU).
const artCache = new Map();
const ART_CACHE_MAX = 200;
async function getArt(file) {
  if (artCache.has(file)) return artCache.get(file);
  let url = null;
  try {
    const meta = await (await mm()).parseFile(file, { duration: false });
    const pic = meta.common?.picture?.[0];
    if (pic?.data) {
      const fmt = pic.format || 'image/jpeg';
      url = `data:${fmt};base64,${Buffer.from(pic.data).toString('base64')}`;
    }
  } catch {
    url = null;
  }
  if (artCache.size >= ART_CACHE_MAX) artCache.delete(artCache.keys().next().value);
  artCache.set(file, url);
  return url;
}

// Build clickable breadcrumb segments, e.g. C:\Users\me\Music ->
//   [{name:'C:', path:'C:\\'}, {name:'Users', path:'C:\\Users'}, ...]
function buildCrumbs(p) {
  const crumbs = [];
  let cur = path.resolve(p);
  // Guard against infinite loops on malformed paths.
  for (let i = 0; i < 64; i++) {
    const base = path.basename(cur);
    if (base) {
      crumbs.unshift({ name: base, path: cur });
      cur = path.dirname(cur);
    } else {
      crumbs.unshift({ name: cur.replace(/[\\/]+$/, '') || cur, path: cur });
      break;
    }
  }
  return crumbs;
}

// One level of a directory: sub-folders + audio files (with metadata).
async function listDir(dirPath) {
  const dir = path.resolve(dirPath);
  const dirents = await fs.readdir(dir, { withFileTypes: true });

  const dirs = [];
  const audioFiles = [];
  for (const ent of dirents) {
    if (ent.name.startsWith('.')) continue; // skip hidden
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      dirs.push({ name: ent.name, path: full });
    } else if (ent.isFile() && isAudio(full)) {
      audioFiles.push(full);
    }
  }

  const files = await Promise.all(audioFiles.map(readMeta));
  dirs.sort(byName);
  files.sort(byName);

  const parent = path.dirname(dir);
  return {
    path: dir,
    name: path.basename(dir) || dir,
    parent: parent === dir ? null : parent, // null at a drive/filesystem root
    crumbs: buildCrumbs(dir),
    dirs,
    files,
  };
}

// Recursively collect audio file paths from a file or directory path.
async function walk(target, out) {
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    return;
  }
  if (stat.isDirectory()) {
    let entries;
    try {
      entries = await fs.readdir(target);
    } catch {
      return;
    }
    for (const e of entries) await walk(path.join(target, e), out);
  } else if (stat.isFile() && isAudio(target)) {
    out.push(target);
  }
}

// Accepts file and/or directory paths; returns flat track objects (drag-drop).
async function scan(paths) {
  const files = [];
  for (const p of paths) await walk(p, files);
  return Promise.all(files.map(readMeta));
}

module.exports = { listDir, scan, getArt, isAudioPath: isAudio };
