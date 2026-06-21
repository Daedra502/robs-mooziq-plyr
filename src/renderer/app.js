import { AudioEngine } from './audio-engine.js';
import { VizManager } from './viz/manager.js';
import { Waveform } from './viz/waveform.js';
import { Spectrograph } from './viz/spectrograph.js';
import { Stereograph } from './viz/stereograph.js';
import { Particles } from './viz/particles.js';
import { BlackWhite } from './viz/blackwhite.js';
import { ReactiveChrome } from './chrome.js';
import { Browser } from './browser.js';
import { Queue } from './queue.js';
import { DeckMonitors } from './deck-monitors.js';
import { harmonicShuffle, keyDistance, camelot } from './key.js';

const $ = (id) => document.getElementById(id);

// --- Persistence -------------------------------------------------------------
let settings = { lastDir: null, volume: 0.9, visualizer: null, plays: {}, history: [] };
const persist = () => window.api.saveStore(settings);
let draggedTrack = null; // library track currently being dragged onto a deck

// Listen-mode auto-transition: when a track nears its end, the next queued track
// starts on the idle deck and the two overlap for a seamless crossfade (Spotify-
// style). The same master graph is used as in Mix mode, so visualizers see both.
const LISTEN_XFADE_SECONDS = 10;
let autoXfArmed = false; // becomes true once the current track's crossfade has fired

// --- Audio + visualization ---------------------------------------------------
const engine = new AudioEngine();
const viz = new VizManager($('viz-canvas'), engine);
[Waveform, Spectrograph, Stereograph, Particles, BlackWhite].forEach((V) => viz.register(V.id, new V(), V.label));
viz.addOverlay(new ReactiveChrome($('overlay')));
const monitors = new DeckMonitors(engine, { A: $('wave-A'), B: $('wave-B') }, { A: $('vu-A'), B: $('vu-B') });
viz.addOverlay(monitors);
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
  const art = t ? await window.api.getArt(t.path) : null;
  const img = $('np-art');
  if (art) { img.src = art; img.style.display = 'block'; }
  else { img.removeAttribute('src'); img.style.display = 'none'; }
}

// Which track sits on each deck (for the DJ mixer display).
const deckTrack = { A: null, B: null };

// Load + play a queue entry (no crossfade).
async function playTrack(t) {
  if (!t) return;
  engine.load(t.url);
  deckTrack[engine.primary] = t;
  autoXfArmed = false; // a fresh track can arm its own end-of-track crossfade
  setNowPlaying(t);
  browser.setPlaying(t.path);
  bumpPlay(t);
  pushHistory(t);
  renderQueue();
  renderSuggestions();
  try { await engine.play(); } catch (err) { console.error('playback failed:', err); }
  updateDeckUI();
}

// Listen-mode seamless transition: start the next queued track on the idle deck and
// crossfade over LISTEN_XFADE_SECONDS while the current track is still playing. Pure
// volume crossfade (no tempo match) — that's the Mix-mode "auto" job, not this one.
async function listenCrossfadeNext() {
  const nxt = queue.peekNext();
  if (!nxt || engine.crossfading) return;
  const incoming = engine.other(engine.primary);
  deckTrack[incoming] = nxt;
  monitors.clearDeck(incoming);
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
  if (mixMode) return; // in Mix mode the DJ drives the decks manually
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
  onDragTrack: (t) => { draggedTrack = t; },
  onDragEnd: () => { draggedTrack = null; },
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
$('stop').addEventListener('click', () => { engine.stop(); $('play').textContent = '▶'; });
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

// ============================================================================
// DJ Mix mode: a miniature two-deck Virtual-DJ console.
// ============================================================================
const fmtPct = (r) => `${(r * 100).toFixed(1)}%`;
let mixMode = false;
let savedViz = null;
let deckTimer = null;
const dragging = {}; // per-control drag guards: xf, seek-A, seek-B

const deckInfo = { A: null, B: null }; // decoded waveform peaks + beatgrid per deck

// The BPM actually used for beatgrid + beat-jump: the tag if present, otherwise an
// estimate from the decoded waveform, otherwise a 120 fallback so the pads always work.
const effectiveBpm = (which) => deckInfo[which]?.bpm || deckTrack[which]?.bpm || 0;

// Decode waveform peaks for whatever track sits on a deck (once per track). If the
// file has no BPM tag, estimate one so the beatgrid and beat-jump pads still work.
async function ensurePeaks(which) {
  const t = deckTrack[which];
  if (!t || deckInfo[which]?.path === t.path) return;
  try {
    const bytes = await window.api.readFile(t.path);
    const pk = await engine.decodePeaks(bytes);
    const tagged = !!t.bpm;
    const bpm = t.bpm || engine.estimateBpm(pk.peaks, pk.secondsPerBucket);
    deckInfo[which] = { path: t.path, beatOffset: 0, ...pk, bpm, estimated: !tagged && bpm > 0 };
    monitors.setDeck(which, deckInfo[which]);
    showDeckBpm(which);
    updateDeckUI();
  } catch (err) {
    console.error('peak decode failed:', err);
  }
}

// Reflect the effective BPM (and whether it was estimated) into the deck readouts.
function showDeckBpm(which) {
  const bpm = effectiveBpm(which);
  const est = deckInfo[which]?.estimated;
  $('bpm-' + which).textContent = bpm ? bpm.toFixed(1) : '--.-';
  const t = deckTrack[which];
  if (t) {
    $('meta-' + which).textContent =
      [bpm ? (est ? '~' : '') + bpm.toFixed(1) + ' BPM' : '', t.key || ''].filter(Boolean).join('  ·  ') || '—';
  }
}

// Beat-sync: match this deck's tempo to the other deck AND align the beat phase so
// their beats actually line up (a true beatmatch, not just a tempo match). The
// beatgrid origin is the track start, matching the deck monitors / beatgrid draw.
function syncDeck(which) {
  const other = engine.other(which);
  const bpm = effectiveBpm(which);
  const masterBpm = effectiveBpm(other);
  if (!bpm || !masterBpm) return;

  // 1) Tempo match: heard BPM (= track BPM × playbackRate) equals the other deck's.
  const rate = (masterBpm * engine.getDeckRate(other)) / bpm;
  engine.setDeckRate(which, rate); // engine clamps to a safe playbackRate range
  const applied = engine.getDeckRate(which);
  const slider = $('rate-' + which);
  slider.value = String(Math.max(+slider.min, Math.min(+slider.max, applied)));
  $('rateval-' + which).textContent = fmtPct(applied);

  // 2) Phase align: nudge this deck to the nearest beat of the other deck.
  alignDeckPhase(which, other);
  updateDeckUI();
}

// Shift `which` so its current beat lines up with `master`'s current beat. Each
// deck's effective BPM defines its beat length (in source seconds); we move by the
// smallest offset (±half a beat) to the nearest grid line.
function alignDeckPhase(which, master) {
  const w = engine.getDeckState(which);
  const m = engine.getDeckState(master);
  const wb = effectiveBpm(which);
  const mb = effectiveBpm(master);
  if (!w.duration || !m.duration || !wb || !mb) return;
  const wBeat = 60 / wb;
  const mPhase = ((m.currentTime / (60 / mb)) % 1 + 1) % 1; // 0..1 of a beat
  const wPhase = ((w.currentTime / wBeat) % 1 + 1) % 1;
  let d = mPhase - wPhase;
  d = ((d + 0.5) % 1 + 1) % 1 - 0.5;                        // nearest beat, -0.5..0.5
  const newT = Math.max(0, Math.min(w.duration, w.currentTime + d * wBeat));
  engine.seekDeck(which, newT / w.duration);
}

// Load a library/queue track onto a specific deck (does not auto-play).
async function loadDeck(which, t) {
  if (!t) return;
  engine.loadDeck(which, t.url);
  deckTrack[which] = t;
  deckInfo[which] = null; // force a fresh decode/estimate for the new track
  $('name-' + which).textContent = t.title || t.name;
  $('meta-' + which).textContent = [t.bpm ? t.bpm + ' BPM' : 'analysing…', t.key || ''].filter(Boolean).join('  ·  ');
  $('bpm-' + which).textContent = t.bpm ? Number(t.bpm).toFixed(1) : '--.-';
  const art = await window.api.getArt(t.path);
  const img = $('art-' + which);
  if (art) { img.src = art; } else { img.removeAttribute('src'); }
  monitors.clearDeck(which);
  updateDeckUI();
  ensurePeaks(which);
}

// Periodic DOM refresh while the console is visible (the canvases animate via the
// render loop; this is just text/sliders, so a few times a second is plenty).
function updateDeckUI() {
  for (const which of ['A', 'B']) {
    const st = engine.getDeckState(which);
    $('deck-' + which).classList.toggle('live', engine.primary === which);
    $('time-' + which).textContent = fmtTime(st.currentTime) + (st.duration ? ' / ' + fmtTime(st.duration) : '');
    $('play-' + which).textContent = st.playing ? '⏸' : '▶';
    if (!dragging['seek-' + which] && st.duration > 0) {
      $('seek-' + which).value = String(Math.round((st.currentTime / st.duration) * 1000));
    }
  }
  if (!dragging.xf) $('crossfader').value = String(engine.getCrossfader());
}

function setMode(mix) {
  mixMode = mix;
  $('stage').classList.toggle('mix', mix);
  $('mode-toggle').classList.toggle('active', mix);
  $('mode-toggle').textContent = mix ? '← Listen' : '🎧 Mix';
  if (mix) {
    savedViz = viz.getActiveId();
    viz.setActive('');           // free the GPU; the deck scopes take over
    monitors.enabled = true;
    monitors.resize();
    // Center the crossfader so BOTH decks pass to the master and can be mixed
    // simultaneously; the per-channel faders then control each deck's level.
    // (At the listen-mode default the crossfader sits full-A, which gates B to
    // silence — the reason deck B appeared to send nothing to the master.)
    engine.setCrossfader(0.5);
    ensurePeaks('A');
    ensurePeaks('B');
    updateDeckUI();
    deckTimer = setInterval(updateDeckUI, 200);
  } else {
    monitors.enabled = false;
    engine.normalize();          // back to clean single-deck listening
    resetMixSliders();
    viz.setActive(savedViz || Waveform.id);
    refreshVizButtons();
    clearInterval(deckTimer);
    deckTimer = null;
  }
}
$('mode-toggle').addEventListener('click', () => setMode(!mixMode));

function resetMixSliders() {
  $('crossfader').value = String(engine.getCrossfader());
  for (const which of ['A', 'B']) {
    $('rate-' + which).value = '1';
    $('rateval-' + which).textContent = '100.0%';
    $('vol-' + which).value = '1';
    for (const b of ['hi', 'mid', 'lo']) $(`eq${b}-${which}`).value = '0';
  }
}

// Auto beatmatch + crossfade (used by both the console's "auto" and end-of-queue).
async function autoMix() {
  const cur = queue.current();
  const nxt = queue.peekNext();
  if (!cur || !nxt || engine.crossfading) return;
  const incoming = engine.other(engine.primary);
  deckTrack[incoming] = nxt;
  monitors.clearDeck(incoming);
  setNowPlaying(nxt);
  browser.setPlaying(nxt.path);
  bumpPlay(nxt);
  pushHistory(nxt);
  await engine.crossfadeTo(nxt.url, { duration: 8, fromBPM: cur.bpm, toBPM: nxt.bpm, align: true });
  queue.jumpTo(queue.index + 1);
  ensurePeaks(incoming);
  updateDeckUI();
}
$('auto-mix').addEventListener('click', autoMix);

// Crossfader.
const crossfader = $('crossfader');
crossfader.addEventListener('pointerdown', () => { dragging.xf = true; });
crossfader.addEventListener('pointerup', () => { dragging.xf = false; });
crossfader.addEventListener('input', () => engine.setCrossfader(+crossfader.value));

// Per-deck controls.
for (const which of ['A', 'B']) {
  $('play-' + which).addEventListener('click', () => { engine.toggleDeck(which); updateDeckUI(); });
  $('cue-' + which).addEventListener('click', () => { engine.seekDeck(which, 0); updateDeckUI(); });
  $('load-' + which).addEventListener('click', () => loadDeck(which, browser.selectedTrack()));

  const seek = $('seek-' + which);
  seek.addEventListener('pointerdown', () => { dragging['seek-' + which] = true; });
  seek.addEventListener('change', () => { engine.seekDeck(which, +seek.value / 1000); dragging['seek-' + which] = false; });

  $('rate-' + which).addEventListener('input', (e) => {
    engine.setDeckRate(which, +e.target.value);
    $('rateval-' + which).textContent = fmtPct(+e.target.value);
  });
  $('vol-' + which).addEventListener('input', (e) => engine.setDeckVolume(which, +e.target.value));
  $('eqhi-' + which).addEventListener('input', (e) => engine.setDeckEq(which, 'high', +e.target.value));
  $('eqmid-' + which).addEventListener('input', (e) => engine.setDeckEq(which, 'mid', +e.target.value));
  $('eqlo-' + which).addEventListener('input', (e) => engine.setDeckEq(which, 'low', +e.target.value));

  // Sync this deck's tempo + beat phase to the other deck.
  $('sync-' + which).addEventListener('click', () => syncDeck(which));
}

// Load the next queued track onto whichever deck is idle (the "cue" deck).
$('load-cue').addEventListener('click', () => {
  const nxt = queue.peekNext();
  if (nxt) loadDeck(engine.other(engine.primary), nxt);
});

// Beat-jump performance pads (like the pads on an XDJ / DJ controller): each pad
// jumps the deck by a fixed number of beats, derived from the effective BPM.
function jumpBeats(which, beats) {
  const st = engine.getDeckState(which);
  const bpm = effectiveBpm(which) || 120; // fallback so pads always do something
  if (!st.duration) return;
  const dt = beats * (60 / bpm);
  const target = Math.max(0, Math.min(st.duration, st.currentTime + dt));
  engine.seekDeck(which, target / st.duration);
  updateDeckUI();
}
for (const which of ['A', 'B']) {
  $('pads-' + which).addEventListener('click', (e) => {
    const pad = e.target.closest('.pad[data-beats]');
    if (!pad) return;
    jumpBeats(which, +pad.dataset.beats);
    pad.classList.add('lit');
    setTimeout(() => pad.classList.remove('lit'), 120);
  });

  const deckEl = $('deck-' + which);
  deckEl.addEventListener('dragover', (e) => {
    if (!draggedTrack) return;
    e.preventDefault();
    e.stopPropagation();
    deckEl.classList.add('drag-over');
  });
  deckEl.addEventListener('dragleave', () => deckEl.classList.remove('drag-over'));
  deckEl.addEventListener('drop', (e) => {
    if (!draggedTrack) return;
    e.preventDefault();
    e.stopPropagation();
    deckEl.classList.remove('drag-over');
    loadDeck(which, draggedTrack);
  });
}

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
seekBar.addEventListener('pointerdown', () => { seeking = true; });
seekBar.addEventListener('input', () => { $('cur-time').textContent = fmtTime((+seekBar.value / 1000) * (engine.getPlayback().duration || 0)); });
seekBar.addEventListener('change', () => { engine.seekFraction(+seekBar.value / 1000); seeking = false; });

// --- Engine events -----------------------------------------------------------
engine.on('timeupdate', () => {
  const { currentTime, duration } = engine.getPlayback();
  $('cur-time').textContent = fmtTime(currentTime);
  $('tot-time').textContent = fmtTime(duration);
  if (!seeking && duration > 0) seekBar.value = String(Math.round((currentTime / duration) * 1000));

  // Listen-mode auto-transition: arm once, when the track nears its end and a next
  // track exists. Skipped in Mix mode (the DJ drives the decks) and for tracks too
  // short to overlap. The actual blend runs through the shared master graph.
  if (!mixMode && !autoXfArmed && !engine.crossfading && queue.hasNext()
      && duration > LISTEN_XFADE_SECONDS + 2) {
    const remaining = duration - currentTime;
    if (remaining > 0.3 && remaining <= LISTEN_XFADE_SECONDS) {
      autoXfArmed = true;
      listenCrossfadeNext();
    }
  }
});
engine.on('ended', advance);
engine.on('play', () => { $('play').textContent = '⏸'; });
engine.on('pause', () => { $('play').textContent = '▶'; });

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
window.addEventListener('dragenter', (e) => { if (draggedTrack) return; e.preventDefault(); dragDepth++; hint.classList.add('show'); });
window.addEventListener('dragover', (e) => { if (!draggedTrack) e.preventDefault(); });
window.addEventListener('dragleave', (e) => { if (draggedTrack) return; e.preventDefault(); if (--dragDepth <= 0) hint.classList.remove('show'); });
window.addEventListener('drop', async (e) => {
  if (draggedTrack) return; // internal track drag handled by the deck drop zones
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
  engine.setVolume(settings.volume);
  volumeEl.value = String(settings.volume);
  viz.setActive(viz.registry.has(settings.visualizer) ? settings.visualizer : Waveform.id);
  refreshVizButtons();
  updateQueueToggle();
  if (!Array.isArray(settings.history)) settings.history = [];
  renderHistory();
  await browser.navigate(settings.lastDir || (await window.api.defaultDir()));
})();
