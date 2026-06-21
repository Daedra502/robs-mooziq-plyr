# Music Player

A small, scalable desktop music player built on **Electron + the Web Audio API**,
with a plug-in visualization system. It browses your folders like a file explorer
(sortable, searchable columns with album art, BPM and key), plays audio with
DJ-style transport, an explicit queue, and a harmonic shuffle, and renders four
real-time visualizers (waveform, spectrograph, stereograph, particles) that all
tap a single shared audio graph — plus an always-on audio-reactive neon window
border. A two-deck **Mix mode** adds a miniature DJ console: per-deck EQ/faders,
scrolling waveforms with a beatgrid + phrase meter, bar jumps, drag-to-nudge, and
a harmonic+popularity "suggested next".

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
  queue, harmonic shuffle, persistence, the two-deck audio graph, all four
  visualizers, the reactive chrome) uses Node and browser built-ins, so the
  runtime dependency count is one.

## Using it

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
- **🔀 Shuffle** builds a queue from the current folder, ordered by **harmonic key
  compatibility** (Camelot wheel) with random tie-breaking, so the mix stays
  cohesive. Tracks without key tags are sprinkled in.
- **🔀 (library toolbar)** shuffles just the **track view** — folders keep their order;
  only the displayed tracks are randomized, to spark ideas for what to play next.
  Press again to reshuffle; clicking any column header returns to the sorted view.
- A **Currently playing:** chip in the Listen view always shows the active track over
  the visualizer.
- **⇄ mix** crossfades into the next queued track, tempo-matching by BPM (see
  *DJ framework* below).
- **🎧 Mix** toggles between **Listen mode** (visualizer + queue) and **Mix mode**:
  two **XDJ-style players** flanking a central **2-channel mixer**. Each deck has:
  - a **scrolling waveform** with a **beatgrid** (beats / bars / 16-beat phrases),
    a **bar·beat readout**, a **phrase circle** (CDJ-style 16-step meter) and a big
    **BPM readout**;
  - **drag the waveform** left/right to nudge/scrub for lining up a mix;
  - **beat-jump performance pads** — `◀16 ◀8 ◀4 ◀1 | 1▶ 4▶ 8▶ 16▶` — that jump by a
    number of beats, exactly like the pads on a DJ controller. They use the track's
    **BPM tag, or an estimate** computed from the waveform when no tag exists (so the
    pads and beatgrid work on untagged files);
  - **CUE / play / SYNC / LOAD** transport and a **tempo/pitch** fader.
  The **central mixer** is the main mixing area: per-channel **3-band EQ (HI/MID/LOW)**
  trims and a **vertical channel volume fader** (styled like real DJ gear) with a live
  **VU meter** for **Track A** and **Track B**, an **A↔B crossfader**, **Next → cue**,
  and **⇄ auto** (beatmatch+crossfade). **Load** (or **drag a track from the library
  onto a deck**) loads it; **Sync** both **tempo-matches** and **beat-phase-aligns** a
  deck to the other (its beats snap to the other deck's grid). Entering Mix mode centers
  the crossfader so **both decks pass to the master and can be played/mixed at once** —
  the per-channel faders then set each deck's level. Both decks sum into the master, so
  the visualizers always read the live A+B mix. Leaving Mix mode restores clean playback.
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
    audio-engine.js     #   two-deck graph: per-deck EQ + fader + crossfade/beatmatch
    deck-monitors.js    #   per-deck waveform + beatgrid + phrase meter + drag-nudge
    chrome.js           #   always-on reactive overlay (neon border + cursor trail)
    viz/
      interface.js      #   the visualizer interface (+ base class)
      manager.js        #   render loop, input capture, frame, switching, overlays
      waveform.js
      spectrograph.js   #   log-freq, smooth fill, falling peak-hold (Wave Candy-ish)
      stereograph.js
      particles.js      #   audio-reactive swarm (per-band colour, emitters, forces)
```

### Mix mode (mini DJ console) + beatmatch framework

[audio-engine.js](src/renderer/audio-engine.js) is a **two-deck** engine (fixed
decks A/B), each with a full channel strip — `source → 3-band EQ → channel fader →
crossfader gain → master` plus a per-deck monitor analyser — all summed before the
shared analyser, so visualizers and the live scopes see the real mix:

```
Deck A -> EQ -> fader -> xfA \                         /-> Analyser -> out
                              +-> master(volume) -----+
Deck B -> EQ -> fader -> xfB /                         \-> Splitter -> L/R
```

An **equal-power crossfader** blends the decks. The Mix-mode UI drives it directly
(`setCrossfader`, `setDeckEq`, `setDeckVolume`, `setDeckRate`, `loadDeck`,
`toggleDeck`, `seekDeck`); **Sync** computes a rate from BPM tags. **⇄ auto** uses
`crossfadeTo(...)`, which loads the next track onto the idle deck, **tempo-matches**
via `playbackRate`, animates the crossfader across, and hands transport to the
incoming deck. Leaving Mix mode calls `normalize()` for clean single-deck listening.

BPM comes from the file's tag when present, otherwise from
[`estimateBpm`](src/renderer/audio-engine.js) — an autocorrelation of the decoded
waveform's onset envelope — so the beatgrid and beat-jump pads work on untagged
tracks. Left as **hooks** for the next layer: the beatgrid still assumes beat 0 at
track start (the **phase**/downbeat offset is the missing piece — `beatOffset` is a
ready field), and `playbackRate` shifts pitch (no time-stretch). Waveform peaks are
decoded once per deck load ([engine `decodePeaks`](src/renderer/audio-engine.js),
via the `fs:readFile` IPC). Harmonic data from [key.js](src/renderer/key.js) drives
both the shuffle and the "suggested next".

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
   the `[Waveform, Spectrograph, Stereograph, Particles]` list.

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

Playlists, tagging, equalizer, streaming, crossfade/beatmatching, and theming
beyond folder browsing + visualizer switching.
