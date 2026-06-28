# Music Player

A small, scalable desktop music player built on **Electron + the Web Audio API**,
in the spirit of the early-2000s skinnable players (Winamp / foobar2000) and their
real-time visualizations. It browses your folders like a file explorer (sortable,
searchable columns with album art, BPM and key), plays audio with a familiar
transport, an explicit queue, and a harmonic shuffle, and renders a rack of
real-time visualizers (waveform, spectrograph, spectrogram, stereograph, particles,
a high-contrast "Black & White", a "BZ Reaction" reaction-diffusion field, a layered
"Sacred Geometry" form, and an "Esoteric" mode) that all tap a single shared audio
graph — plus an always-on audio-reactive neon window border and quiet CRT scanlines.
Tracks auto-transition with a 10-second Spotify-style crossfade, a Track History
panel logs what played, and a harmonic+popularity "suggested next" proposes where to
go.

## Why this stack

- **Electron / Chromium** decodes mp3, flac, wav, ogg, m4a/aac, opus, etc.
  natively — no codec libraries needed.
- **Web Audio `AnalyserNode`** gives real-time FFT and time-domain data for free.
  A `ChannelSplitterNode` + two analysers expose per-channel data for the
  stereograph.

## Setup

Requires Node.js 18+.

```bash
npm install
npm start
```

## Dependencies (and why)

- **electron** (dev) — the desktop runtime.
- **music-metadata** — reads title/artist/album/duration/**bpm/key** tags and
  embedded **album art** from audio files. Everything else (folder browsing,
  queue, harmonic shuffle, persistence, the crossfading audio graph, all the
  visualizers, the reactive chrome) uses Node and browser built-ins, so the
  runtime dependency count is one.

## Using it

- The bottom strip is a **Winamp-style player console**: a green **LCD display** with
  a segmented **time readout** (click it to toggle elapsed / remaining), a little
  **spectrum analyzer** with bouncing bars + falling peak caps, a **scrolling title
  marquee**, and **kbps · kHz · stereo** readouts pulled from the file's tags — over
  chunky beveled **prev / play / stop / next** transport.
- **🎨 Skin** (top bar) cycles six **skins** — *Neon* (default), *Classic* (brushed
  titanium + green phosphor LCD), *Vaporwave* (purple / pink / cyan), *Terminal*
  (matrix-green monochrome), *Amber* (amber-CRT monochrome), and *Ruby* (crimson neon +
  gold). Each is a CSS-variable palette; the choice persists. The whole UI re-themes
  together, including the LCD spectrum analyzer.
- The left pane is a **folder browser** with file-explorer **columns** (art,
  title, artist, album, length, BPM, key). Click a folder to enter; use **Up** or
  the **breadcrumbs** to go back. **Open…** picks any directory.
- **Sort** by clicking a column header (click again to reverse). **Search** filters
  the current folder by title/artist/album.
- Row actions (hover): **▶** play now, **⤴** play next, **＋** add to queue.
  Double-click also plays. With an empty queue, the folder becomes the queue;
  otherwise *play now* / *play next* insert without disturbing the rest.
- **Queue** button (top-right) opens the queue panel — click an item to jump,
  **✕** to remove, **Clear** to empty.
- **History** button (right of Queue) opens the **Track History** panel — a rolling
  log of what has played (most recent first), persisted across restarts. Click a row
  to play it now, **＋** to re-queue it, **Clear** to empty. With both panels open,
  History docks to the right of the Queue.
- **Auto-transition:** when the playing track nears its end and the queue has a next
  track, the next track starts on the idle deck and the two **overlap for a 10-second
  crossfade** through the shared master graph — a seamless, Spotify-style segue. Short
  tracks fall back to a clean cut.
- **🔀 Shuffle** builds a queue from the current folder, ordered by **harmonic key
  compatibility** (Camelot wheel) with random tie-breaking, so the set stays
  cohesive. Tracks without key tags are sprinkled in.
- **🔀 (library toolbar)** shuffles just the **track view** — folders keep their order;
  only the displayed tracks are randomized, to spark ideas for what to play next.
  Press again to reshuffle; clicking any column header returns to the sorted view.
- A **Currently playing:** chip always shows the active track over the visualizer.
- **💡 Suggested next** (in the Queue panel) ranks the current folder's other
  tracks by **harmonic key compatibility** (Camelot distance) nudged by local
  **play-count popularity**; click to queue.
- Visualizer buttons include **Off** — stops all visualizer drawing to free the
  CPU/GPU. The particle system only runs while it is the selected visualizer.
- Transport: play/pause (**Spacebar**), stop, next, previous, seek, volume. The
  **Waveform** visualizer is also click/drag-to-seek; **Particles** reacts to the
  mouse and the music.
- **Drag and drop**: a folder to browse into it, or files to play them as a queue.
- Last folder, volume, and chosen visualizer persist across restarts.

## Architecture

```
src/
  main/                 # Node / Electron main process
    main.js             #   window + IPC handlers
    library.js          #   listDir + scan + metadata (bpm/key) + lazy album art
    store.js            #   JSON persistence (last dir, volume, visualizer)
  preload/
    preload.js          #   contextBridge: listDir, getArt, scan, picker, store, …
  renderer/             # the UI (sandboxed page, ES modules)
    app.js              #   wiring: browser, queue, transport, shuffle, crossfade
    browser.js          #   folder nav + sortable/searchable column table + art
    queue.js            #   explicit play-queue model
    key.js              #   Camelot key parsing + harmonic shuffle
    audio-engine.js     #   two-deck graph for seamless gapless crossfades
    chrome.js           #   always-on reactive overlay (neon border + cursor trail)
    mini-spectrum.js    #   the LCD's little Winamp-style spectrum analyzer (an overlay)
    viz/
      interface.js      #   the visualizer interface (+ base class)
      manager.js        #   render loop, input capture, frame, switching, overlays
      waveform.js
      spectrograph.js   #   log-freq, smooth fill, falling peak-hold (Wave Candy-ish)
      spectrogram-analyzer.js #  scrolling FFT spectrogram
      stereograph.js
      particles.js      #   audio-reactive swarm (per-band colour, emitters, forces)
      blackwhite.js     #   G Jones-inspired monochrome placeholder (kaleido + glitch)
      reaction.js       #   digital Belousov-Zhabotinsky field: ASCII filter + kaleido + glitch
      sacred.js         #   layered sacred geometry / fractals / math curves (extensible layers)
      esoteric.js       #   esoteric/occult-themed reactive form
```

### Seamless crossfade

[audio-engine.js](src/renderer/audio-engine.js) is a **two-deck** engine (fixed
decks A/B). Each deck is just `source → crossfader gain → master`; both sum before
the shared analyser, so the visualizers always read the live signal — including the
brief overlap during a segue:

```
Deck A -> gainA \                         /-> Analyser -> out
                 +-> master(volume) -----+
Deck B -> gainB /                         \-> Splitter -> L/R
```

While the current deck plays out, `crossfadeTo(url, { duration })` loads the next
track onto the idle deck, starts it, and sweeps an **equal-power crossfader** across,
handing transport to the incoming deck. Normal playback (`load`) brings the primary
deck fully up and leaves the other silent, so single-track listening is unaffected.
Harmonic data from [key.js](src/renderer/key.js) drives both the shuffle and the
"suggested next".

### Performance

The manager runs one `requestAnimationFrame` loop and draws **only the active
visualizer** (so *Off*, or any non-particle viz, costs nothing for particles). It
also: caps the canvas backing store at 2× DPR, uses an opaque `desynchronized` 2D
context, and **pauses the loop when the window is hidden/minimized**. The overlay
chrome is likewise DPR-capped. Main enables GPU acceleration
(`ignore-gpu-blocklist`, `enable-gpu-rasterization`).

### The audio graph

All playback runs through one graph so every visualizer reads the same signal
([src/renderer/audio-engine.js](src/renderer/audio-engine.js)):

```
<audio> -> MediaElementSource -+-> Analyser (mono) -> destination
                               +-> ChannelSplitter -> Analyser L
                                                  \-> Analyser R
```

The engine exposes only the analyser nodes and playback controls — **it has no
knowledge of any visualizer.**

## Adding a new visualizer

This is the extension point. A visualizer is a self-contained module implementing
the interface in [src/renderer/viz/interface.js](src/renderer/viz/interface.js):

```js
init(canvas, context)  // canvas + shared refs { analyser, leftAnalyser,
                       //   rightAnalyser, audioContext, seek, getPlayback }
update(frame)          // per frame: { freq, time, left, right, input,
                       //   timing, playback }
resize(w, h)
destroy()
```

The [VizManager](src/renderer/viz/manager.js) owns the single
`requestAnimationFrame` loop, captures pointer/keyboard input, builds the `frame`
object, and switches the active visualizer. To add one:

1. Create `src/renderer/viz/my-viz.js` exporting a class with `static id` /
   `static label` that implements the interface.
2. Register it in [src/renderer/app.js](src/renderer/app.js) — add your class to
   the `[Waveform, Spectrograph, SpectrogramAnalyzer, Stereograph, Particles,
   BlackWhite, Reaction, SacredGeometry, Esoteric]` list.

That's all. Nothing in the audio engine changes. [particles.js](src/renderer/viz/particles.js)
is the worked example: it reads `frame.input.pointer` and needs nothing from the
audio engine, proving the input path. It's the seed of a larger particle layer.

### Always-on overlays (global reactive chrome)

For effects that should run regardless of the active visualizer (the neon border
and cursor trail in [chrome.js](src/renderer/chrome.js)), the manager exposes
`addOverlay(effect)`. An overlay implements `update(frame)` (and optional
`resize(w, h)`) and draws to its own canvas; the manager feeds it the same
`frame` every tick. `frame.windowPointer` carries the cursor in window space for
full-window effects.

> **Designed-for future:** because `frame.input` / `frame.timing` reach every
> `update()`, the particle layer can grow (audio-reactive forces, emitters,
> input modes) entirely inside `particles.js` and siblings, with no engine or
> manager changes.

## Out of scope (by design)

DJ/mixing (beatmatching, EQ, decks — that lives in a separate project), playlists,
tagging, equalizer, and streaming. The focus here is a clean player + a growing rack
of visualizers in the early-2000s skinnable-player tradition.
