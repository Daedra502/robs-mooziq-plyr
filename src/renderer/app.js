import { AudioEngine } from './audio-engine.js';
import { VizManager } from './viz/manager.js';
import { Waveform } from './viz/waveform.js';
import { Spectrograph } from './viz/spectrograph.js';
import { SpectrogramAnalyzer } from './viz/spectrogram-analyzer.js';
import { Stereograph } from './viz/stereograph.js';
import { Particles } from './viz/particles.js';
import { BlackWhite } from './viz/blackwhite.js';
import { Reaction } from './viz/reaction.js';
import { SacredGeometry } from './viz/sacred.js';
import { Esoteric } from './viz/esoteric.js';
import { ReactiveChrome } from './chrome.js';
import { MiniSpectrum } from './mini-spectrum.js';
import { Browser } from './browser.js';
import { Queue } from './queue.js';
import { harmonicShuffle, keyDistance, camelot } from './key.js';

const $ = (id) => document.getElementById(id);

// --- Persistence -------------------------------------------------------------
let settings = { lastDir: null, volume: 0.9, visualizer: null, plays: {}, history: [], skin: 'neon' };
const persist = () => window.api.saveStore(settings);

// --- Skins -------------------------------------------------------------------
// Each skin is a CSS palette selected via <body data-skin>. The switcher cycles
// through them; the mini spectrum analyzer re-reads its colours on every change.
const SKINS = [
  { id: 'neon', label: 'Neon' },
  { id: 'classic', label: 'Classic' },
  { id: 'vapor', label: 'Vaporwave' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'amber', label: 'Amber' },
  { id: 'ruby', label: 'Ruby' },
];
function applySkin(id) {
  const skin = SKINS.find((s) => s.id === id) || SKINS[0];
  document.body.dataset.skin = skin.id;
  $('skin-toggle').textContent = `🎨 ${skin.label}`;
  miniSpectrum.refreshColors();
}
$('skin-toggle').addEventListener('click', () => {
  const i = SKINS.findIndex((s) => s.id === settings.skin);
  settings.skin = SKINS[(i + 1) % SKINS.length].id;
  applySkin(settings.skin);
  persist();
});

// Auto-transition: when a track nears its end, the next queued track starts on the
// idle deck and the two overlap for a seamless crossfade (Spotify-style). Both decks
// sum into the same master graph, so the visualizers see the segue.
const LISTEN_XFADE_SECONDS = 10;
let autoXfArmed = false; // becomes true once the current track's crossfade has fired

// --- Audio + visualization ---------------------------------------------------
const engine = new AudioEngine();
const viz = new VizManager($('viz-canvas'), engine);
[Waveform, Spectrograph, SpectrogramAnalyzer, Stereograph, Particles, BlackWhite, Reaction, SacredGeometry, Esoteric].forEach((V) => viz.register(V.id, new V(), V.label));
viz.addOverlay(new ReactiveChrome($('overlay')));
const miniSpectrum = new MiniSpectrum($('mini-vis')); // Winamp-style LCD spectrum analyzer
viz.addOverlay(miniSpectrum);
buildVizButtons();
viz.startLoop();

// --- Queue -------------------------------------------------------------------
const queue = new Queue();
queue.onChange = () => { renderQueue(); updateQueueToggle(); renderSuggestions(); };

const fmtTime = (s) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};
const subtitle = (t) => [t.artist, t.album].filter(Boolean).join(' — ');

async function setNowPlaying(t) {
  const label = t ? `${t.title || t.name}${subtitle(t) ? ' · ' + subtitle(t) : ''}` : '';
  $('now-playing').textContent = label;
  $('np-banner-track').textContent = label || 'Nothing yet — pick a track';
  setLcd(t, label);
  const art = t ? await window.api.getArt(t.path) : null;
  const img = $('np-art');
  if (art) { img.src = art; img.style.display = 'block'; }
  else { img.removeAttribute('src'); img.style.display = 'none'; }
}

// --- Winamp-style LCD display ------------------------------------------------
// The marquee scrolls only when the title overflows its window (a CSS class drives
// the animation); the kbps · kHz · stereo readouts come from the file's format tags.
function setLcd(t, label) {
  const marquee = $('marquee-text');
  marquee.textContent = label || '♪ music player ♪';
  // Re-measure on the next frame, once layout has settled, to decide if it scrolls.
  requestAnimationFrame(() => {
    const track = marquee.parentElement;
    marquee.classList.toggle('scroll', marquee.scrollWidth > track.clientWidth + 2);
  });
  $('info-kbps').textContent = t && t.bitrate ? t.bitrate : '--';
  $('info-khz').textContent = t && t.sampleRate ? (t.sampleRate / 1000).toFixed(1) : '--';
  const chan = $('info-chan');
  chan.textContent = t && t.channels ? (t.channels >= 2 ? 'stereo' : 'mono') : '--';
  chan.classList.toggle('on', !!(t && t.channels));
}

// Playback-state glyph in the LCD (▶ / ❚❚ / ⏹), like the classic player corner icon.
function setLcdStatus(state) {
  $('lcd-status').textContent = state === 'play' ? '▶' : state === 'pause' ? '❚❚' : '⏹';
  $('lcd-status').dataset.state = state;
}

// Load + play a queue entry (no crossfade).
async function playTrack(t) {
  if (!t) return;
  engine.load(t.url);
  autoXfArmed = false; // a fresh track can arm its own end-of-track crossfade
  setNowPlaying(t);
  browser.setPlaying(t.path);
  bumpPlay(t);
  pushHistory(t);
  renderQueue();
  renderSuggestions();
  try { await engine.play(); } catch (err) { console.error('playback failed:', err); }
}

// Seamless transition: start the next queued track on the idle deck and crossfade
// over LISTEN_XFADE_SECONDS while the current track is still playing — a Spotify-
// style segue through the shared master graph, so the visualizers see both tracks.
async function listenCrossfadeNext() {
  const nxt = queue.peekNext();
  if (!nxt || engine.crossfading) return;
  setNowPlaying(nxt);
  browser.setPlaying(nxt.path);
  bumpPlay(nxt);
  pushHistory(nxt);
  await engine.crossfadeTo(nxt.url, { duration: LISTEN_XFADE_SECONDS });
  queue.jumpTo(queue.index + 1);
  autoXfArmed = false; // the new current track can arm its own crossfade
  renderQueue();
  renderSuggestions();
}

function advance() {
  const t = queue.next();
  if (t) playTrack(t);
  else { engine.stop(); $('play').textContent = '▶'; }
}

// --- Library callbacks -------------------------------------------------------
const browser = new Browser({
  listEl: $('entry-list'),
  crumbsEl: $('crumbs'),
  headEl: $('lib-head-row'),
  upBtn: $('up-btn'),
  statusEl: $('lib-status'),
  searchInput: $('search'),
  onNavigate: (path) => { settings.lastDir = path; persist(); renderSuggestions(); },
  onViewChange: () => { $('lib-shuffle').classList.toggle('active', browser.isShuffled()); },
  // Empty queue: the folder becomes the queue. Otherwise insert + jump (preserve queue).
  onPlayNow: (files, index) => {
    if (queue.count() === 0) playTrack(queue.setAll(files, index));
    else playTrack(queue.playNowInsert(files[index]));
  },
  onQueue: (t) => { const empty = queue.count() === 0; queue.add(t); if (empty) playTrack(queue.current()); },
  onPlayNext: (t) => { const empty = queue.count() === 0; queue.addNext(t); if (empty) playTrack(queue.current()); },
});

// --- Visualizer switching ----------------------------------------------------
function buildVizButtons() {
  const wrap = $('viz-buttons');
  wrap.innerHTML = '';
  const make = (id, label) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset.viz = id;
    b.addEventListener('click', () => { viz.setActive(id); settings.visualizer = id; persist(); refreshVizButtons(); });
    wrap.appendChild(b);
  };
  viz.list().forEach(({ id, label }) => make(id, label));
  make('', 'Off'); // stop drawing entirely to free CPU/GPU
}
const refreshVizButtons = () =>
  [...$('viz-buttons').children].forEach((b) => b.classList.toggle('active', b.dataset.viz === viz.getActiveId()));

// --- Queue panel -------------------------------------------------------------
function renderQueue() {
  const ul = $('queue-list');
  ul.innerHTML = '';
  queue.items.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = 'q-item' + (i === queue.index ? ' current' : '');
    li.innerHTML = `<span class="q-title"></span><button class="q-rm ghost" title="Remove">✕</button>`;
    li.querySelector('.q-title').textContent = `${t.title || t.name}${t.artist ? ' — ' + t.artist : ''}`;
    li.querySelector('.q-title').addEventListener('click', () => playTrack(queue.jumpTo(i)));
    li.querySelector('.q-rm').addEventListener('click', () => queue.removeAt(i));
    ul.appendChild(li);
  });
}
const updateQueueToggle = () => { $('queue-toggle').textContent = `Queue (${queue.count()})`; };
$('queue-toggle').addEventListener('click', () => $('queue-panel').classList.toggle('hidden'));
$('queue-clear').addEventListener('click', () => { queue.clear(); engine.stop(); $('play').textContent = '▶'; setNowPlaying(null); browser.setPlaying(null); });

// --- Track history -----------------------------------------------------------
// A rolling log of what has played (most recent first). Persisted with settings so
// it survives restarts. Only the fields needed to re-play and display are stored.
const HISTORY_MAX = 100;
function pushHistory(t) {
  if (!t) return;
  const top = settings.history[0];
  if (top && top.path === t.path) return; // collapse consecutive repeats
  settings.history.unshift({
    path: t.path, url: t.url, title: t.title, name: t.name, artist: t.artist,
    bpm: t.bpm, key: t.key, at: Date.now(),
  });
  if (settings.history.length > HISTORY_MAX) settings.history.length = HISTORY_MAX;
  persist();
  renderHistory();
}

function renderHistory() {
  const ul = $('history-list');
  if (!ul) return;
  ul.innerHTML = '';
  for (const t of settings.history) {
    const li = document.createElement('li');
    li.className = 'h-item';
    li.innerHTML = `<span class="h-title"></span><button class="h-add ghost" title="Add to queue">＋</button>`;
    li.querySelector('.h-title').textContent = `${t.title || t.name}${t.artist ? ' — ' + t.artist : ''}`;
    li.querySelector('.h-title').addEventListener('click', () => playTrack(queue.playNowInsert(t)));
    li.querySelector('.h-add').addEventListener('click', (e) => { e.stopPropagation(); queue.add(t); });
    ul.appendChild(li);
  }
  $('history-toggle').textContent = `History (${settings.history.length})`;
}
$('history-toggle').addEventListener('click', () => {
  const panel = $('history-panel');
  panel.classList.toggle('hidden');
  $('canvas-wrap').classList.toggle('history-open', !panel.classList.contains('hidden'));
});
$('history-clear').addEventListener('click', () => { settings.history = []; persist(); renderHistory(); });

// --- Transport ---------------------------------------------------------------
$('play').addEventListener('click', async () => {
  if (queue.count() === 0) return;
  if (!engine.getPlayback().duration && queue.current()) return playTrack(queue.current());
  engine.getPlayback().playing ? engine.pause() : await engine.play();
});
$('stop').addEventListener('click', () => { engine.stop(); $('play').textContent = '▶'; setLcdStatus('stop'); });
$('next').addEventListener('click', () => { const t = queue.next(); if (t) playTrack(t); });
$('prev').addEventListener('click', () => {
  if (engine.getPlayback().currentTime > 3) engine.seekTime(0);
  else { const t = queue.prev(); if (t) playTrack(t); }
});

$('shuffle').addEventListener('click', () => {
  const files = browser.files();
  if (!files.length) return;
  playTrack(queue.setAll(harmonicShuffle(files), 0));
});

// Shuffle just the library *view* (folders stay ordered) — for browsing inspiration,
// not playback. Press again to reshuffle; sorting a column returns to sorted order.
$('lib-shuffle').addEventListener('click', () => browser.shuffleView());

// --- Suggested next (harmonic compatibility + popularity) --------------------
function bumpPlay(t) {
  if (!t) return;
  settings.plays[t.path] = (settings.plays[t.path] || 0) + 1;
  persist();
}

// Rank the current folder's other tracks by key compatibility to what's playing,
// nudged by local play-count popularity. Lower score = better.
function suggestNext() {
  const cur = queue.current();
  const pool = browser.files().filter((t) => !cur || t.path !== cur.path);
  if (!pool.length) return [];
  const maxPlays = Math.max(1, ...pool.map((t) => settings.plays[t.path] || 0));
  const ck = cur ? camelot(cur.key) : null;
  return pool
    .map((t) => {
      const kd = ck ? keyDistance(ck, camelot(t.key)) : 3; // 0..6
      const pop = (settings.plays[t.path] || 0) / maxPlays; // 0..1
      return { t, score: kd / 6 - 0.6 * pop };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .map((x) => x.t);
}

function renderSuggestions() {
  const ul = $('suggest-list');
  ul.innerHTML = '';
  for (const t of suggestNext()) {
    const c = camelot(t.key);
    const li = document.createElement('li');
    li.className = 'sg-item';
    li.innerHTML = `<span class="sg-key"></span><span class="sg-title"></span><button class="sg-add ghost" title="Add to queue">+</button>`;
    li.querySelector('.sg-key').textContent = c ? `${c.n}${c.letter}` : '·';
    li.querySelector('.sg-title').textContent = `${t.title || t.name}${t.artist ? ' — ' + t.artist : ''}`;
    const add = () => queue.add(t);
    li.querySelector('.sg-add').addEventListener('click', (e) => { e.stopPropagation(); add(); });
    li.addEventListener('click', add);
    ul.appendChild(li);
  }
}

const volumeEl = $('volume');
volumeEl.addEventListener('input', () => { const v = +volumeEl.value; engine.setVolume(v); settings.volume = v; persist(); });

const seekBar = $('seek-bar');
let seeking = false;
// Click the LCD time to switch between elapsed and remaining (a classic-player tic).
let showRemaining = false;
const renderCurTime = (cur, dur) => {
  $('cur-time').textContent = (showRemaining && dur > 0 ? '-' + fmtTime(dur - cur) : fmtTime(cur));
};
$('cur-time').addEventListener('click', () => {
  showRemaining = !showRemaining;
  const { currentTime, duration } = engine.getPlayback();
  renderCurTime(currentTime, duration);
});
seekBar.addEventListener('pointerdown', () => { seeking = true; });
seekBar.addEventListener('input', () => {
  const dur = engine.getPlayback().duration || 0;
  renderCurTime((+seekBar.value / 1000) * dur, dur);
});
seekBar.addEventListener('change', () => { engine.seekFraction(+seekBar.value / 1000); seeking = false; });

// --- Engine events -----------------------------------------------------------
engine.on('timeupdate', () => {
  const { currentTime, duration } = engine.getPlayback();
  renderCurTime(currentTime, duration);
  $('tot-time').textContent = fmtTime(duration);
  if (!seeking && duration > 0) seekBar.value = String(Math.round((currentTime / duration) * 1000));

  // Auto-transition: arm once, when the track nears its end and a next track
  // exists. Skipped for tracks too short to overlap. The actual blend runs through
  // the shared master graph, so the visualizers see the segue.
  if (!autoXfArmed && !engine.crossfading && queue.hasNext()
      && duration > LISTEN_XFADE_SECONDS + 2) {
    const remaining = duration - currentTime;
    if (remaining > 0.3 && remaining <= LISTEN_XFADE_SECONDS) {
      autoXfArmed = true;
      listenCrossfadeNext();
    }
  }
});
engine.on('ended', advance);
engine.on('play', () => { $('play').textContent = '⏸'; setLcdStatus('play'); });
engine.on('pause', () => { $('play').textContent = '▶'; setLcdStatus('pause'); });

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !['INPUT', 'BUTTON'].includes(e.target.tagName)) {
    e.preventDefault();
    $('play').click();
  }
});

// --- Open folder + drag/drop -------------------------------------------------
$('pick-dir').addEventListener('click', async () => { const d = await window.api.pickDirectory(); if (d) browser.navigate(d); });

let dragDepth = 0;
const hint = $('drop-hint');
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; hint.classList.add('show'); });
window.addEventListener('dragover', (e) => { e.preventDefault(); });
window.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) hint.classList.remove('show'); });
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  hint.classList.remove('show');
  const paths = [...e.dataTransfer.files].map((f) => window.api.getPathForFile(f)).filter(Boolean);
  if (!paths.length) return;
  if (paths.length === 1 && (await window.api.listDir(paths[0]))) return browser.navigate(paths[0]);
  $('lib-status').textContent = 'Scanning…';
  const tracks = await window.api.scan(paths);
  if (tracks.length) playTrack(queue.setAll(tracks, 0));
});

// --- Startup -----------------------------------------------------------------
(async function init() {
  try { settings = { ...settings, ...(await window.api.loadStore()) }; } catch { /* defaults */ }
  applySkin(settings.skin);
  engine.setVolume(settings.volume);
  volumeEl.value = String(settings.volume);
  viz.setActive(viz.registry.has(settings.visualizer) ? settings.visualizer : Waveform.id);
  refreshVizButtons();
  updateQueueToggle();
  if (!Array.isArray(settings.history)) settings.history = [];
  renderHistory();
  await browser.navigate(settings.lastDir || (await window.api.defaultDir()));
})();
