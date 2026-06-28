// Music-player audio engine. Two fixed decks (A/B) feed a shared master so a track
// can crossfade into the next one without a gap: while the current deck plays out,
// the next track starts on the idle deck and an equal-power crossfade sweeps between
// them. Both decks sum into the master before the analyser graph, so the visualizers
// always read the live mix (including the brief overlap during a segue):
//
//   Deck A -> gainA \                                   /-> Analyser (mono) -> out
//                    +-> master(volume) -> (analyser) -+
//   Deck B -> gainB /                                   \-> Splitter -> L/R analyser
//
// The "primary" deck is the one the transport (play/seek/now-playing/events)
// follows; it switches to the incoming deck when a crossfade completes.

class Deck {
  constructor(ctx, dest, id) {
    this.id = id;
    this.el = new Audio();
    this.el.preload = 'auto';
    this.node = ctx.createMediaElementSource(this.el);
    this.gain = ctx.createGain();   // crossfader gain (0 = silent, 1 = full)
    this.gain.gain.value = 0;
    this.node.connect(this.gain).connect(dest);
    this.hasTrack = false;
  }
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Equal-power crossfade (sum of squares == 1) so a swept segue never dips in the
// middle. Endpoints are [1,0] and [0,1], so single-deck playback is unaffected.
const eqPower = (x) => [Math.cos(x * Math.PI / 2), Math.sin(x * Math.PI / 2)]; // [gA, gB]

export class AudioEngine {
  constructor() {
    this.ctx = new AudioContext();

    this.master = this.ctx.createGain();
    this._volume = 0.9;
    this.master.gain.value = this._volume;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.82;

    this.splitter = this.ctx.createChannelSplitter(2);
    this.leftAnalyser = this.ctx.createAnalyser();
    this.rightAnalyser = this.ctx.createAnalyser();
    this.leftAnalyser.fftSize = 2048;
    this.rightAnalyser.fftSize = 2048;

    this.master.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.master.connect(this.splitter);
    this.splitter.connect(this.leftAnalyser, 0);
    this.splitter.connect(this.rightAnalyser, 1);

    this.A = new Deck(this.ctx, this.master, 'A');
    this.B = new Deck(this.ctx, this.master, 'B');
    this.primary = 'A';
    this.xf = 0; // 0 = full A, 1 = full B
    this._applyXf();
    this.crossfading = false;

    this._handlers = { timeupdate: new Set(), ended: new Set(), play: new Set(), pause: new Set() };
    this._bind(this.A);
    this._bind(this.B);
  }

  deck(which) { return which === 'A' ? this.A : this.B; }
  other(which) { return which === 'A' ? 'B' : 'A'; }

  on(type, cb) { this._handlers[type]?.add(cb); return this; }

  // Decks forward events, but only the primary deck's reach the app.
  _bind(deck) {
    for (const type of Object.keys(this._handlers)) {
      deck.el['on' + type] = (e) => {
        if (deck.id !== this.primary) return;
        for (const cb of this._handlers[type]) cb(e);
      };
    }
  }

  // Hard-set the crossfader gains (no ramp) — used for a fresh load.
  _applyXf() {
    const [gA, gB] = [1 - this.xf, this.xf];
    const t = this.ctx.currentTime;
    this.A.gain.gain.cancelScheduledValues(t);
    this.B.gain.gain.cancelScheduledValues(t);
    this.A.gain.gain.setValueAtTime(gA, t);
    this.B.gain.gain.setValueAtTime(gB, t);
  }

  // --- Transport (operates on the primary deck) ------------------------------
  load(url) {
    this.crossfading = false;
    const p = this.deck(this.primary);
    const o = this.deck(this.other(this.primary));
    o.el.pause();
    p.el.src = url;
    p.el.load();
    p.hasTrack = true;
    this.xf = this.primary === 'A' ? 0 : 1; // bring the primary deck fully up
    this._applyXf();
  }

  async play() {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.deck(this.primary).el.play();
  }
  pause() { this.deck(this.primary).el.pause(); }
  stop() { const el = this.deck(this.primary).el; el.pause(); el.currentTime = 0; }
  seekFraction(f) {
    const el = this.deck(this.primary).el;
    if (Number.isFinite(el.duration) && el.duration > 0) el.currentTime = clamp01(f) * el.duration;
  }
  seekTime(t) { if (Number.isFinite(t)) this.deck(this.primary).el.currentTime = t; }
  setVolume(v) { this._volume = clamp01(v); this.master.gain.value = this._volume; }
  getVolume() { return this._volume; }
  getPlayback() { return this._state(this.deck(this.primary).el); }

  _state(el) {
    return {
      currentTime: el.currentTime || 0,
      duration: Number.isFinite(el.duration) ? el.duration : 0,
      playing: !el.paused && !el.ended,
    };
  }

  // --- Seamless auto-crossfade -----------------------------------------------
  // Loads `url` onto the idle deck, starts it, and animates the crossfader across
  // with an equal-power curve. Primary switches to the incoming deck, so the
  // transport (and now-playing) follow the new track once the segue begins.
  async crossfadeTo(url, { duration = 8 } = {}) {
    if (this.crossfading) return;
    this.crossfading = true;
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    const fromWhich = this.primary;
    const toWhich = this.other(fromWhich);
    const inc = this.deck(toWhich);
    const out = this.deck(fromWhich);

    inc.el.src = url;
    inc.el.load();
    inc.el.currentTime = 0;
    inc.hasTrack = true;
    try { await inc.el.play(); } catch { /* race */ }

    this._animateXf(toWhich === 'B' ? 1 : 0, duration);
    this.primary = toWhich; // transport now follows the incoming track

    return new Promise((resolve) => {
      setTimeout(() => {
        out.el.pause();
        this.crossfading = false;
        resolve();
      }, duration * 1000);
    });
  }

  _animateXf(target, duration) {
    const steps = 64;
    const start = this.xf;
    const ca = new Float32Array(steps);
    const cb = new Float32Array(steps);
    for (let i = 0; i < steps; i++) {
      const x = start + (target - start) * (i / (steps - 1));
      const [gA, gB] = eqPower(x);
      ca[i] = Math.max(0.0001, gA);
      cb[i] = Math.max(0.0001, gB);
    }
    const t = this.ctx.currentTime;
    this.A.gain.gain.cancelScheduledValues(t);
    this.B.gain.gain.cancelScheduledValues(t);
    this.A.gain.gain.setValueCurveAtTime(ca, t, duration);
    this.B.gain.gain.setValueCurveAtTime(cb, t, duration);
    this.xf = target;
  }
}
