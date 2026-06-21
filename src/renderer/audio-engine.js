// Two-deck DJ-style audio engine. Decks A and B are fixed slots, each with its
// own <audio>, gain and playbackRate (pitch/tempo). A crossfader blends them with
// an equal-power curve. Both decks sum into the master before the analyser graph,
// so visualizers always see the live mix:
//
//   Deck A -> gainA \                                   /-> Analyser (mono) -> out
//                    +-> master(volume) -> (analyser) -+
//   Deck B -> gainB /                                   \-> Splitter -> L/R analyser
//
// The "primary" deck is the one the main transport (play/seek/now-playing/events)
// follows; it switches when an auto-crossfade completes. Manual mixing controls
// (loadDeck/playDeck/setDeckRate/setCrossfader) act on either deck directly.

// Per-deck signal chain (Virtual-DJ style channel strip):
//   source -> EQ low -> EQ mid -> EQ high -> channel fader -> crossfader gain -> master
//                                          \-> monitor analyser (this deck only)
class Deck {
  constructor(ctx, dest, id) {
    this.id = id;
    this.el = new Audio();
    this.el.preload = 'auto';
    this.node = ctx.createMediaElementSource(this.el);

    this.eqLow = ctx.createBiquadFilter();
    this.eqLow.type = 'lowshelf';
    this.eqLow.frequency.value = 120;
    this.eqMid = ctx.createBiquadFilter();
    this.eqMid.type = 'peaking';
    this.eqMid.frequency.value = 1000;
    this.eqMid.Q.value = 0.8;
    this.eqHigh = ctx.createBiquadFilter();
    this.eqHigh.type = 'highshelf';
    this.eqHigh.frequency.value = 3500;

    this.channel = ctx.createGain();   // channel volume fader
    this.channel.gain.value = 1;
    this.gain = ctx.createGain();       // crossfader gain
    this.gain.gain.value = 0;
    this.monitor = ctx.createAnalyser();
    this.monitor.fftSize = 1024;

    this.node.connect(this.eqLow).connect(this.eqMid).connect(this.eqHigh).connect(this.channel);
    this.channel.connect(this.gain).connect(dest);
    this.channel.connect(this.monitor);
    this.hasTrack = false;
  }
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const clampRate = (r) => Math.max(0.5, Math.min(2, r));
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

  _applyXf() {
    const [gA, gB] = eqPower(this.xf);
    const t = this.ctx.currentTime;
    this.A.gain.gain.cancelScheduledValues(t);
    this.B.gain.gain.cancelScheduledValues(t);
    this.A.gain.gain.setValueAtTime(gA, t);
    this.B.gain.gain.setValueAtTime(gB, t);
  }

  // --- Main transport (operates on the primary deck) -------------------------
  load(url) {
    this.crossfading = false;
    const p = this.deck(this.primary);
    const o = this.deck(this.other(this.primary));
    o.el.pause();
    p.el.playbackRate = 1;
    p.el.src = url;
    p.el.load();
    p.hasTrack = true;
    this.xf = this.primary === 'A' ? 0 : 1;
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

  // --- Manual mixing ---------------------------------------------------------
  loadDeck(which, url) {
    const d = this.deck(which);
    d.el.src = url;
    d.el.load();
    d.hasTrack = true;
  }
  async playDeck(which) {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    return this.deck(which).el.play();
  }
  pauseDeck(which) { this.deck(which).el.pause(); }
  toggleDeck(which) {
    const el = this.deck(which).el;
    if (el.paused) this.playDeck(which); else this.pauseDeck(which);
  }
  setDeckRate(which, rate) { this.deck(which).el.playbackRate = clampRate(rate); }
  getDeckRate(which) { return this.deck(which).el.playbackRate; }
  getDeckState(which) {
    const d = this.deck(which);
    return { ...this._state(d.el), hasTrack: d.hasTrack, rate: d.el.playbackRate };
  }

  setCrossfader(x) { this.xf = clamp01(x); this._applyXf(); }
  getCrossfader() { return this.xf; }

  // band: 'low' | 'mid' | 'high'; db roughly -26 (kill) .. +6
  setDeckEq(which, band, db) {
    const d = this.deck(which);
    (band === 'low' ? d.eqLow : band === 'mid' ? d.eqMid : d.eqHigh).gain.value = db;
  }
  setDeckVolume(which, v) { this.deck(which).channel.gain.value = clamp01(v); }
  getDeckVolume(which) { return this.deck(which).channel.gain.value; }
  seekDeck(which, frac) {
    const el = this.deck(which).el;
    if (Number.isFinite(el.duration) && el.duration > 0) el.currentTime = clamp01(frac) * el.duration;
  }
  getDeckAnalyser(which) { return this.deck(which).monitor; }

  // Decode raw file bytes into a downsampled abs-peak array for waveform drawing.
  // The AudioBuffer is discarded after peaks are computed (memory stays small).
  async decodePeaks(bytes, samplesPerBucket = 1024) {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const audio = await this.ctx.decodeAudioData(buf);
    const ch = audio.getChannelData(0);
    const n = Math.ceil(ch.length / samplesPerBucket);
    const peaks = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = i * samplesPerBucket;
      const e = Math.min(s + samplesPerBucket, ch.length);
      let max = 0;
      for (let j = s; j < e; j++) { const v = Math.abs(ch[j]); if (v > max) max = v; }
      peaks[i] = max;
    }
    return { peaks, duration: audio.duration, secondsPerBucket: samplesPerBucket / audio.sampleRate };
  }

  // Estimate tempo (BPM) from a decoded peak envelope when a track has no BPM tag.
  // Method: build an onset-strength (half-wave-rectified flux) signal from the
  // peaks, autocorrelate it across the lag range for `min`..`max` BPM, pick the
  // strongest lag, refine with parabolic interpolation, and fold into the range.
  estimateBpm(peaks, secondsPerBucket, min = 82, max = 165) {
    if (!peaks || peaks.length < 32 || !secondsPerBucket) return 0;
    const n = peaks.length;
    const nov = new Float32Array(n);
    let mean = 0;
    for (let i = 1; i < n; i++) { const d = peaks[i] - peaks[i - 1]; nov[i] = d > 0 ? d : 0; mean += nov[i]; }
    mean /= n;
    for (let i = 0; i < n; i++) nov[i] -= mean; // zero-mean so silence doesn't bias

    const lagMin = Math.max(2, Math.round((60 / max) / secondsPerBucket));
    const lagMax = Math.min(n - 2, Math.round((60 / min) / secondsPerBucket));
    if (lagMax <= lagMin) return 0;

    const ac = new Float32Array(lagMax + 2);
    let bestLag = -1, best = -Infinity;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let s = 0;
      for (let i = lag; i < n; i++) s += nov[i] * nov[i - lag];
      ac[lag] = s;
      if (s > best) { best = s; bestLag = lag; }
    }
    if (bestLag < 0 || best <= 0) return 0;

    // Parabolic interpolation around the peak for sub-bucket precision.
    const a = ac[bestLag - 1] || 0, b = ac[bestLag], c = ac[bestLag + 1] || 0;
    const denom = a - 2 * b + c;
    const shift = denom ? 0.5 * (a - c) / denom : 0;
    const lag = bestLag + Math.max(-1, Math.min(1, shift));

    let bpm = 60 / (lag * secondsPerBucket);
    while (bpm < min) bpm *= 2;   // fold octave errors into a sensible range
    while (bpm > max) bpm /= 2;
    return Math.round(bpm * 10) / 10;
  }

  // Reset to a clean single-deck "listen" state (called when leaving mix mode).
  normalize() {
    for (const w of ['A', 'B']) {
      const d = this.deck(w);
      d.channel.gain.value = 1;
      d.eqLow.gain.value = 0;
      d.eqMid.gain.value = 0;
      d.eqHigh.gain.value = 0;
      d.el.playbackRate = 1;
    }
    this.setCrossfader(this.primary === 'A' ? 0 : 1);
  }

  // --- Auto crossfade / beatmatch framework ----------------------------------
  // Loads `url` onto the non-primary deck, tempo-matches it via playbackRate, and
  // animates the crossfader across with an equal-power curve. Primary switches to
  // the incoming deck. (Beat-*phase* alignment remains a hook — see _beatOffset.)
  async crossfadeTo(url, { duration = 8, fromBPM = 0, toBPM = 0, align = false } = {}) {
    if (this.crossfading) return;
    this.crossfading = true;
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    const fromWhich = this.primary;
    const toWhich = this.other(fromWhich);
    const inc = this.deck(toWhich);
    const out = this.deck(fromWhich);

    inc.el.src = url;
    inc.el.load();
    inc.el.playbackRate = fromBPM > 0 && toBPM > 0 ? clampRate(fromBPM / toBPM) : 1;
    inc.el.currentTime = align ? this._beatOffset(out, fromBPM) : 0;
    inc.hasTrack = true;
    try { await inc.el.play(); } catch { /* race */ }

    this._animateXf(toWhich === 'B' ? 1 : 0, duration);
    this.primary = toWhich; // transport now follows the incoming track

    return new Promise((resolve) => {
      setTimeout(() => {
        out.el.pause();
        out.el.playbackRate = 1;
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

  // Approximate phase alignment (assumes beat 0 at track start; no beat grid yet).
  _beatOffset(deck, bpm) {
    if (!bpm) return 0;
    const beat = 60 / bpm;
    const phase = (deck.el.currentTime || 0) % beat;
    return beat - phase < 0.001 ? 0 : beat - phase;
  }
}
