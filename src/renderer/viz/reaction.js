import { Visualizer } from './interface.js';

// "BZ Reaction" — a digital Belousov-Zhabotinsky reaction-diffusion field, rendered
// through an ASCII-art filter with kaleidoscopic folding, a wavetable scope overlay
// and beat-driven glitch. Everything is audio-reactive:
//   - kicks nucleate new excitation, spawning expanding chemical waves;
//   - overall energy drives reaction speed + kaleidoscope rotation;
//   - a mid band sets the kaleidoscope fold count;
//   - the time-domain waveform draws as a glowing wavetable line on top.
//
// The simulation runs on a coarse cell grid (cheap), and that same grid is the ASCII
// character grid, so one buffer drives both the physics and the glyphs.
const RAMP = ' .,:;irsXA253hMHGS#9B&@'; // dark -> bright glyph ramp
const WAVE = '~=≈+*x><)(';             // glyphs for the tiled wavetable strands
const A = 1.0, B = 1.0, G = 1.0;        // BZ reaction constants (audio nudges G)

export class Reaction extends Visualizer {
  static id = 'reaction';
  static label = 'BZ Reaction';

  init(canvas, context) {
    super.init(canvas, context);
    this.bassAvg = 0;
    this.beatHold = 0;
    this.rot = 0;
    this.hueShift = 0; // music-driven colour rotation
    this.flash = 0;    // strobe envelope (1 -> 0)
    this._allocate();
  }

  resize(w, h) {
    super.resize(w, h);
    this._allocate();
  }

  // Grid sized for ~72 columns; monospace cells are ~1.7x taller than wide.
  _allocate() {
    this.cell = Math.max(9, Math.round((this.w || 800) / 72));
    this.cols = Math.max(24, Math.round((this.w || 800) / this.cell));
    this.charH = this.cell * 1.7;
    this.rows = Math.max(16, Math.round((this.h || 600) / this.charH));
    const n = this.cols * this.rows;
    // Double-buffered chemical concentrations a/b/c in [0,1].
    this.a = new Float32Array(n); this.b = new Float32Array(n); this.c = new Float32Array(n);
    this.a2 = new Float32Array(n); this.b2 = new Float32Array(n); this.c2 = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.a[i] = Math.random(); this.b[i] = Math.random(); this.c[i] = Math.random(); }
  }

  // One reaction step with 3x3 toroidal neighbour averaging (the classic BZ CA).
  _step(gamma) {
    const { cols, rows, a, b, c, a2, b2, c2 } = this;
    for (let y = 0; y < rows; y++) {
      const yu = ((y - 1 + rows) % rows) * cols, yd = ((y + 1) % rows) * cols, yc = y * cols;
      for (let x = 0; x < cols; x++) {
        const xl = (x - 1 + cols) % cols, xr = (x + 1) % cols;
        let sa = 0, sb = 0, sc = 0;
        for (const row of [yu, yc, yd]) {
          sa += a[row + xl] + a[row + x] + a[row + xr];
          sb += b[row + xl] + b[row + x] + b[row + xr];
          sc += c[row + xl] + c[row + x] + c[row + xr];
        }
        const aa = sa / 9, ab = sb / 9, ac = sc / 9;
        const i = yc + x;
        a2[i] = clamp(aa + aa * (A * ab - gamma * ac));
        b2[i] = clamp(ab + ab * (B * ac - A * aa));
        c2[i] = clamp(ac + ac * (gamma * aa - B * ab));
      }
    }
    this.a = a2; this.b = b2; this.c = c2; this.a2 = a; this.b2 = b; this.c2 = c;
  }

  // Drop a blob of excitation to nucleate a fresh expanding wave (on a beat).
  _nucleate() {
    const { cols, rows } = this;
    const cx = (Math.random() * cols) | 0, cy = (Math.random() * rows) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const i = ((cy + dy + rows) % rows) * cols + ((cx + dx + cols) % cols);
        this.a[i] = 1; this.b[i] = 0; this.c[i] = 1;
      }
  }

  update(frame) {
    const g = this.g, w = this.w, h = this.h, freq = frame.freq;
    const dt = Math.min(2, frame.timing.delta / 16.67);

    // --- audio bands + beat detection ---------------------------------------
    let bass = 0, mid = 0;
    for (let i = 0; i < 24; i++) bass += freq[i];
    for (let i = 24; i < 180; i++) mid += freq[i];
    bass /= 24 * 255; mid /= 156 * 255;
    this.bassAvg += (bass - this.bassAvg) * 0.08;
    const beat = bass > this.bassAvg * 1.4 && bass > 0.13 && this.beatHold <= 0;
    this.beatHold = beat ? 9 : this.beatHold - dt;
    if (beat) this._nucleate();

    // treble band, for colour saturation + faster hue spin on bright material
    let treble = 0;
    for (let i = 180; i < 600; i++) treble += freq[i];
    treble /= 420 * 255;
    const energy = bass + mid + treble;

    // --- advance the reaction (faster when louder) --------------------------
    this._step(G + bass * 0.9);
    if (bass > 0.4) this._step(G + bass * 0.9);

    // --- music-reactive colour + strobe envelope ----------------------------
    this.hueShift = (this.hueShift + (0.01 + energy * 0.6) * frame.timing.delta) % 360;
    if (beat && Math.random() < 0.55) this.flash = 1;          // strobe on some beats
    this.flash = Math.max(0, this.flash - 0.16 * dt);
    const baseHue = this.hueShift;
    const sat = 70 + Math.min(28, treble * 90);               // brighter highs -> punchier colour
    const lift = this.flash * 38;                              // strobe whitens the field

    // --- kaleidoscope params -------------------------------------------------
    this.rot += (0.002 + this.bassAvg * 0.02) * frame.timing.delta;
    const folds = 2 * (2 + Math.round(mid * 6));               // even fold count, audio-driven
    const seg = (Math.PI * 2) / folds;
    const tiles = 2 + Math.round(mid * 4);                     // wavetable tiling, audio-driven

    g.fillStyle = '#05050a';
    g.fillRect(0, 0, w, h);

    // --- ASCII render: folded BZ field with the tiled wavetable woven in -----
    const { cols, rows, cell, charH, a, c } = this;
    const time = frame.time, m = time.length;
    const waveHue = (baseHue + 160) % 360;
    g.font = `${Math.round(charH * 0.9)}px monospace`;
    g.textBaseline = 'top';
    for (let gy = 0; gy < rows; gy++) {
      const ny = (gy + 0.5) / rows - 0.5;
      for (let gx = 0; gx < cols; gx++) {
        const nx = (gx + 0.5) / cols - 0.5;
        // Fold into an n-fold mirrored wedge (kaleidoscope).
        const rad = Math.hypot(nx, ny);
        let ang = Math.atan2(ny, nx) + this.rot;
        ang = Math.abs((((ang % seg) + seg) % seg) - seg / 2);
        const sx = (((Math.cos(ang) * rad + 0.5) % 1) + 1) % 1;
        const sy = (((Math.sin(ang) * rad + 0.5) % 1) + 1) % 1;

        // Tiled, kaleidoscoped wavetable: the waveform repeats `tiles` times across
        // the folded x; cells near its amplitude curve become bright wave strands.
        const wv = (time[((sx * tiles) % 1 * m) | 0] - 128) / 128; // -1..1
        const d = Math.abs(sy - (0.5 + wv * 0.42));
        if (d < 0.05) {
          const wch = WAVE[Math.min(WAVE.length - 1, ((1 - d / 0.05) * WAVE.length) | 0)];
          g.fillStyle = `hsl(${waveHue | 0}, 100%, ${Math.min(95, 60 + lift) | 0}%)`;
          g.fillText(wch, gx * cell, gy * charH);
          continue;
        }

        const si = ((sy * rows) | 0) * cols + ((sx * cols) | 0);
        const v = a[si] * (1 - c[si] * 0.5);  // intensity from chemical state
        if (v < 0.12) continue;               // leave dark cells blank (cheap + contrasty)
        const ch = RAMP[Math.min(RAMP.length - 1, (v * RAMP.length) | 0)];
        const hue = (baseHue + c[si] * 140) % 360;
        g.fillStyle = `hsl(${hue | 0}, ${sat | 0}%, ${Math.min(95, 35 + v * 45 + lift) | 0}%)`;
        g.fillText(ch, gx * cell, gy * charH);
      }
    }

    // --- strobe wash --------------------------------------------------------
    if (this.flash > 0.01) {
      g.fillStyle = `hsla(${waveHue | 0}, 100%, 85%, ${this.flash * 0.4})`;
      g.fillRect(0, 0, w, h);
    }

    // --- glitch: shift random horizontal slices on strong bass --------------
    if (this.bassAvg > 0.22 && Math.random() < 0.5) {
      for (let i = 0; i < 3; i++) {
        const sy = (Math.random() * h) | 0;
        const sh = 2 + ((Math.random() * h * 0.05) | 0);
        const dx = Math.round((Math.random() - 0.5) * 50 * this.bassAvg);
        try { g.drawImage(this.canvas, 0, sy, w, sh, dx, sy, w, sh); } catch { /* size race */ }
      }
    }
  }

  destroy() { this.a = this.b = this.c = null; }
}

function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
