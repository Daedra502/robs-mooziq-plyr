# Architecture & design notes

The technical design spec for the project. For a plain-English overview and how to
run it, see the [README](README.md); for packaging, see [BUILD.md](BUILD.md).

## Why this stack

- **Electron / Chromium** decodes mp3, flac, wav, ogg, m4a/aac, opus, etc.
  natively — no codec libraries needed.
- **Web Audio `AnalyserNode`** gives real-time FFT and time-domain data for free.
  A `ChannelSplitterNode` + two analysers expose per-channel data for the
  stereograph.

## Dependencies (and why)

- **electron** (dev) — the desktop runtime.
- **music-metadata** — reads title/artist/album/duration/**bpm/key** tags and
  embedded **album art** from audio files. Everything else (folder browsing,
  queue, harmonic shuffle, persistence, the crossfading audio graph, all the
  visualizers, the reactive chrome) uses Node and browser built-ins, so the
  runtime dependency count is one.

## Source layout

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

## Seamless crossfade

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

## Performance

The manager runs one `requestAnimationFrame` loop and draws **only the active
visualizer** (so *Off*, or any non-particle viz, costs nothing for particles). It
also: caps the canvas backing store at 2× DPR, uses an opaque `desynchronized` 2D
context, and **pauses the loop when the window is hidden/minimized**. The overlay
chrome is likewise DPR-capped. Main enables GPU acceleration
(`ignore-gpu-blocklist`, `enable-gpu-rasterization`).

## The audio graph

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
