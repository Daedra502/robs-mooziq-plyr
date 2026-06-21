// Owns the single requestAnimationFrame loop, captures pointer/keyboard input,
// builds the per-frame data object, switches the active visualizer, and drives
// any always-on "overlays" (global audio-reactive chrome).
//
// requestAnimationFrame already runs at the display's native refresh rate
// (60 / 120 / 144 Hz), so the loop is as smooth as the monitor allows; we keep
// per-frame work cheap (only the active visualizer draws) to actually hit it.
//
// Visualizers are registered by id; only the active one receives update().
// Each is init()'d lazily the first time it becomes active and kept alive after.
export class VizManager {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.engine = engine;

    // Create the 2D context once. We deliberately do NOT pass
    // `desynchronized: true`: that low-latency hint promotes the canvas to its own
    // compositing layer and, combined with an opaque overlay above it, renders
    // blank on some Windows/GPU setups (the visualizer appeared "dead"). A normal
    // opaque context composites reliably. Visualizers call canvas.getContext('2d')
    // and get this same context back.
    this.g = canvas.getContext('2d', { alpha: false });
    // Cap backing-store resolution: a 4K canvas at full DPR is a lot of pixels
    // to push every frame for little visible gain.
    this.maxDpr = 2;

    this.registry = new Map(); // id -> { instance, label, initialized }
    this.overlays = []; // always-on effects: { update(frame), resize(w,h)? }
    this.activeId = null;

    this.input = {
      pointer: { x: 0, y: 0, nx: 0, ny: 0, down: false },
      keys: new Set(),
      drag: false,
    };
    // Window-level pointer (CSS px) for full-window effects like the cursor trail.
    this.windowPointer = { x: 0, y: 0, down: false, moved: false };

    this.start = performance.now();
    this.last = this.start;
    this.running = false;
    this._raf = null;

    // Reusable analysis buffers (sized to the engine's analysers).
    this.freq = new Uint8Array(engine.analyser.frequencyBinCount);
    this.time = new Uint8Array(engine.analyser.fftSize);
    this.left = new Uint8Array(engine.leftAnalyser.fftSize);
    this.right = new Uint8Array(engine.rightAnalyser.fftSize);

    // Shared, long-lived refs handed to every visualizer at init().
    this.sharedContext = {
      audioContext: engine.ctx,
      analyser: engine.analyser,
      leftAnalyser: engine.leftAnalyser,
      rightAnalyser: engine.rightAnalyser,
      seek: (fraction) => engine.seekFraction(fraction),
      getPlayback: () => engine.getPlayback(),
    };

    this._bindInput();
    this._bindResize();
    this._resize();
  }

  register(id, instance, label) {
    this.registry.set(id, { instance, label: label || id, initialized: false });
  }

  // Always-on effect that receives the frame every tick (e.g. reactive chrome).
  addOverlay(overlay) {
    if (overlay.resize) overlay.resize(window.innerWidth, window.innerHeight);
    this.overlays.push(overlay);
  }

  list() {
    return [...this.registry.entries()].map(([id, v]) => ({ id, label: v.label }));
  }

  setActive(id) {
    // Falsy / unknown id => "Off": no visualizer draws (saves CPU/GPU). The
    // particle system in particular only runs while it is the active visualizer.
    if (!this.registry.has(id)) {
      this.activeId = '';
      this._clearCanvas();
      return;
    }
    this.activeId = id;
    const entry = this.registry.get(id);
    if (!entry.initialized) {
      entry.instance.init(this.canvas, this.sharedContext);
      entry.initialized = true;
    }
    entry.instance.resize(this.canvas.width, this.canvas.height);
  }

  _clearCanvas() {
    const g = this.canvas.getContext('2d');
    g.fillStyle = '#0a0a0f';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  getActiveId() {
    return this.activeId;
  }

  startLoop() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = () => {
      if (!this.running) return;
      this._frame();
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  stopLoop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _frame() {
    const now = performance.now();
    const delta = now - this.last;
    this.last = now;

    const a = this.engine;
    a.analyser.getByteFrequencyData(this.freq);
    a.analyser.getByteTimeDomainData(this.time);
    a.leftAnalyser.getByteTimeDomainData(this.left);
    a.rightAnalyser.getByteTimeDomainData(this.right);

    const frame = {
      freq: this.freq,
      time: this.time,
      left: this.left,
      right: this.right,
      input: this.input,
      windowPointer: this.windowPointer,
      timing: { elapsed: now - this.start, delta },
      playback: a.getPlayback(),
    };

    const entry = this.activeId && this.registry.get(this.activeId);
    if (entry) entry.instance.update(frame);
    for (const o of this.overlays) o.update(frame);

    // Per-frame edge reset.
    if (!this.input.pointer.down) this.input.drag = false;
    this.windowPointer.moved = false;
  }

  // --- input -----------------------------------------------------------------

  _bindInput() {
    const c = this.canvas;
    const setPointer = (e) => {
      const rect = c.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      this.input.pointer.nx = nx;
      this.input.pointer.ny = ny;
      this.input.pointer.x = nx * c.width;
      this.input.pointer.y = ny * c.height;
    };

    c.addEventListener('pointerdown', (e) => {
      setPointer(e);
      this.input.pointer.down = true;
      this.input.drag = false;
      c.setPointerCapture?.(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (this.input.pointer.down) this.input.drag = true;
      setPointer(e);
    });
    const release = () => { this.input.pointer.down = false; };
    c.addEventListener('pointerup', release);
    c.addEventListener('pointercancel', release);

    // Keyboard captured window-wide so visualizers can react regardless of focus.
    window.addEventListener('keydown', (e) => this.input.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.input.keys.delete(e.code));

    // Window-level pointer for full-window overlays (cursor trail, etc.).
    window.addEventListener('pointermove', (e) => {
      this.windowPointer.x = e.clientX;
      this.windowPointer.y = e.clientY;
      this.windowPointer.moved = true;
    });
    window.addEventListener('pointerdown', () => { this.windowPointer.down = true; });
    window.addEventListener('pointerup', () => { this.windowPointer.down = false; });
  }

  // --- sizing ----------------------------------------------------------------

  _bindResize() {
    window.addEventListener('resize', () => this._resize());
    // Stop animating when the window is hidden/minimized — no point burning the
    // CPU/GPU on frames nobody sees.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stopLoop();
      else this.startLoop();
    });
  }

  _resize() {
    const dpr = Math.min(this.maxDpr, window.devicePixelRatio || 1);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      const entry = this.activeId && this.registry.get(this.activeId);
      if (entry && entry.initialized) entry.instance.resize(w, h);
    }
    for (const o of this.overlays) o.resize?.(window.innerWidth, window.innerHeight);
  }
}
