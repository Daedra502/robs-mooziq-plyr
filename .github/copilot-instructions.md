# Copilot instructions — Music Player

A small **Electron + Web Audio** desktop music player with a plug-in visualizer
system and a two-deck DJ "Mix mode". Plain **ES modules, no framework, no build
step, no bundler.** Read [README.md](../README.md) first — it is the design spec.

Follow these instructions for every contribution to this repo. When something here
conflicts with a generic habit (e.g. "add a library", "introduce a build tool"),
**these instructions win.**

---

## Golden rules (read before writing code)

1. **Be additive. Do not rewrite working features.** This project is grown in small,
   reversible layers. Prefer a new function/module/CSS rule over editing the
   internals of `audio-engine.js`, `manager.js`, or the queue/browser. If a change
   seems to require reworking an existing feature, stop and explain why instead.
2. **Keep the dependency count minimal.** Runtime dependencies are **`music-metadata`
   only**; `electron` is the dev runtime. Do **not** add npm packages (no lodash,
   no audio libs, no UI frameworks, no bundlers). Use Node and browser built-ins.
   If you think a dependency is truly required, propose it in the PR description and
   let a human decide — do not run `npm install`.
3. **One audio graph, one master.** All audio (both decks, Listen and Mix) sums into
   the **master gain → analyser → destination** in [audio-engine.js](../src/renderer/audio-engine.js).
   Visualizers read that master analyser, so they always see the live mix. Never give
   a feature its own `AudioContext` or its own path to `destination`.
4. **Respect the security boundary.** `contextIsolation: true`, `nodeIntegration:
   false`, a strict CSP in [index.html](../src/renderer/index.html), and a tiny
   `contextBridge` surface (`window.api`) in [preload.js](../src/preload/preload.js).
   The renderer must reach the filesystem/main process **only** through `window.api`.
   Do not loosen the CSP, expose `ipcRenderer`/`require` to the page, or enable
   `nodeIntegration`. New main↔renderer calls = a new named IPC handler in
   [main.js](../src/main/main.js) + a matching method in `preload.js`.
5. **Keep "Listen" and "Mix" cleanly separated.** They are distinct modes the user
   toggles (`#stage.mix`). Listen-mode behavior (auto-crossfade, now-playing chip,
   visualizers, queue/history) must not run in Mix mode and vice-versa. Guard
   mode-specific logic with the `mixMode` flag.

---

## How to run / verify

- Start the app: `npm start` (which is `electron .`). There is **no** build, lint,
  or test step — do not invent one or add config for it without being asked.
- **Gotcha (VSCode/integrated terminals):** the terminal exports
  `ELECTRON_RUN_AS_NODE=1`, which makes Electron run as plain Node and crash on
  startup (`require('electron')` returns a string). Clear it first:
  PowerShell `Remove-Item Env:\ELECTRON_RUN_AS_NODE`, or bash `unset
  ELECTRON_RUN_AS_NODE`. A normal user terminal is unaffected. This is an
  environment artifact, **not** an app bug — never "fix" it in code.
- To check the renderer loads without errors, temporarily forward the renderer
  console in `main.js` (`webContents.on('console-message', …)`), launch, then
  **remove the diagnostic before committing.**
- The GPU/network-service "crashed" lines on a timed launch are benign Electron
  noise; a SIGTERM exit code (143) just means the timeout killed the run.

---

## Architecture map

```
src/
  main/                 # Node / Electron main process
    main.js             #   BrowserWindow + IPC handlers (the ONLY place new IPC lands)
    library.js          #   listDir + recursive scan + music-metadata + lazy album art
    store.js            #   JSON persistence in userData (last dir, volume, viz, plays, history)
  preload/preload.js    #   contextBridge -> window.api (the entire renderer↔main surface)
  renderer/             # sandboxed page, ES modules, no framework
    app.js              #   WIRING hub: transport, queue, mix UI, auto-crossfade, history
    audio-engine.js     #   two-deck graph: per-deck EQ+fader, equal-power crossfader, BPM estimate
    deck-monitors.js    #   per-deck CDJ scope + beatgrid + phrase meter + VU (a manager overlay)
    browser.js          #   folder nav + sortable/searchable/shuffleable track table
    queue.js            #   pure play-queue state model
    key.js              #   Camelot key parsing + harmonic shuffle
    chrome.js           #   always-on reactive neon border (a manager overlay)
    viz/
      interface.js      #   the visualizer contract + base class
      manager.js        #   single rAF loop, input capture, frame building, active-viz switching
      waveform.js spectrograph.js stereograph.js particles.js blackwhite.js reaction.js
```

Data flow is one-directional: **engine → manager → visualizer**. The audio engine
has *no knowledge* of any visualizer or UI; the manager builds a `frame` object and
hands it to the active visualizer + overlays.

---

## How to add things (the supported extension points)

### A new visualizer (the easiest, lowest-risk contribution)
1. Create `src/renderer/viz/<name>.js` exporting a class with `static id` and
   `static label` that implements the interface in
   [viz/interface.js](../src/renderer/viz/interface.js): `init(canvas, context)`,
   `update(frame)`, `resize(w, h)`, `destroy()`. Extending the `Visualizer` base
   class is the norm.
2. Register it in [app.js](../src/renderer/app.js): import it and add the class to the
   `[Waveform, Spectrograph, Stereograph, Particles, BlackWhite]` list. That's all —
   the "Off" toggle and the buttons are generated from the registry.
3. Read audio **only** from the `frame` (`freq`, `time`, `left`, `right`) and input
   from `frame.input` / `frame.windowPointer`. Do not touch the engine directly.
4. Keep per-frame work cheap (only the active visualizer draws). Use the canvas
   backing-store size (`this.w`/`this.h`, device pixels), not CSS pixels.

### A persisted setting
Add a default to the `settings` object in `app.js` **and** to `DEFAULT` in
[store.js](../src/main/store.js), then call `persist()` after changes. `store.load()`
merges over `DEFAULT`, so older saved files stay forward-compatible.

### A new main-process capability
New IPC handler in `main.js` (`ipcMain.handle('namespace:verb', …)`) + a thin
wrapper in `preload.js`. Keep handlers defensive (try/catch, return `null`/`[]` on
failure) like the existing ones.

---

## Code style (match the surrounding code)

- Vanilla ES modules. `const $ = (id) => document.getElementById(id);` is the DOM
  idiom in `app.js`. No jQuery, no virtual DOM.
- Concise, expression-style helpers and one-liners where the existing code uses them;
  small pure functions over classes unless modeling stateful objects (engine, decks,
  visualizers, browser, queue).
- **Every module opens with a short comment explaining its purpose and any non-obvious
  design choice.** New modules must do the same. Comments explain *why*, not *what*.
- Naming follows the codebase: decks are `'A'`/`'B'`, `which`/`other(which)`,
  `primary`; gains are `channel` (fader) vs `gain` (crossfader); `effectiveBpm`,
  `deckTrack`, `deckInfo`.
- Clamp and guard audio inputs (`clamp01`, `clampRate`, check `Number.isFinite` on
  `duration`/`currentTime`). Audio elements can report `NaN` durations.
- CSS lives in [style.css](../src/renderer/style.css) using the existing CSS variables
  (`--bg`, `--accent`, `--accent-2`, `--panel`, …). Theme is dark, neon, DJ-gear
  inspired (VirtualDJ/XDJ). Reuse variables; don't hard-code new palettes.

---

## Landmines (where AI changes have bitten before — be careful)

- **Canvas compositing:** do **not** re-add `desynchronized: true` to the visualizer
  canvas context. Combined with the opaque overlay it renders blank on some Windows
  GPUs. The context is created once in `manager.js` as `{ alpha: false }`.
- **Crossfader gates audio.** Each deck's crossfader gain starts at 0; the equal-power
  crossfader decides what reaches master. A deck can be playing yet silent because the
  crossfader is on the other side. Mix mode centers the crossfader on entry so both
  decks pass. Keep this in mind before concluding "a deck doesn't output."
- **Primary-deck event forwarding:** the engine only forwards `timeupdate`/`ended`/etc.
  from the **primary** deck. `crossfadeTo` switches `primary` mid-transition, which is
  what prevents a double "ended" advance. Don't "simplify" this.
- **Beatmatch vs. seamless crossfade are different features.** Mix-mode "auto" tempo-
  matches (`fromBPM`/`toBPM`, `align`). Listen-mode auto-transition is a *pure volume*
  crossfade (no BPM args) — a Spotify-style segue. Keep them distinct.
- **AudioContext starts suspended** until a user gesture; `engine.play()` resumes it.
  A "dead" visualizer with no audio is usually just that — not a bug.
- **`webUtils.getPathForFile`** is the supported way to resolve dropped-file paths
  (modern Electron removed `File.path`). Don't reintroduce `File.path`.

---

## Needs human review (flag, don't silently change)

Changes to: the audio graph / crossfade timing in `audio-engine.js`, the security
config (`webPreferences`, CSP, preload surface), BPM/beat math, or anything touching
both Listen and Mix mode. Open these as small PRs with a clear description of the
invariant you believe you're preserving.

## PRs & commits

- Small, focused, additive PRs. Describe *what stayed the same* as much as what
  changed — regression-avoidance is the priority of this project.
- Match existing commit-message style: a concise imperative subject and a short body
  explaining the why. Never commit temporary diagnostics or `console.log` spam.
- Do not commit `node_modules/`, build artifacts, or `*.log` (already gitignored).
