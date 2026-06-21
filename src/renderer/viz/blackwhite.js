import { Visualizer } from './interface.js';

// "Black & White" — a placeholder visualizer inspired by G Jones' high-contrast,
// glitchy, monochrome aesthetic. Everything here is greyscale on black: a kaleido-
// scopic set of mirrored frequency spokes, a pulsing time-domain ring, and hard
// contrast inversions + horizontal slice glitches that snap on detected bass hits.
//
// It's intentionally self-contained and modest — a seed to grow a richer G Jones
// style engine later — but already audio-reactive through the shared `frame` data.
export class BlackWhite extends Visualizer {
  static id = 'blackwhite';
  static label = 'Black & White';

  init(canvas, context) {
    super.init(canvas, context);
    this.sectors = 24;     // mirrored spokes around the circle
    this.bassAvg = 0;
    this.beatHold = 0;
    this.invert = 0;       // frames remaining of inverted (white-on-black -> black-on-white)
    this.rot = 0;          // slow base rotation
  }

  update(frame) {
    const g = this.g;
    const w = this.w;
    const h = this.h;
    const cx = w / 2;
    const cy = h / 2;
    const dt = Math.min(2, frame.timing.delta / 16.67);
    const freq = frame.freq;
    const time = frame.time;

    // --- bass / beat detection (rising edge over a moving average) -------------
    let bass = 0;
    for (let i = 0; i < 24; i++) bass += freq[i];
    bass = bass / (24 * 255);
    this.bassAvg += (bass - this.bassAvg) * 0.08;
    const beat = bass > this.bassAvg * 1.4 && bass > 0.14 && this.beatHold <= 0;
    this.beatHold = beat ? 10 : this.beatHold - dt;
    if (beat) this.invert = 4; // brief high-contrast flash on the kick
    this.invert = Math.max(0, this.invert - dt);

    const inverted = this.invert > 0;
    const ink = inverted ? '#000' : '#fff';
    const paper = inverted ? '#fff' : '#000';

    g.fillStyle = paper;
    g.fillRect(0, 0, w, h);

    this.rot += 0.0009 * frame.timing.delta * (0.4 + this.bassAvg);

    // --- mirrored frequency spokes (kaleidoscope) -----------------------------
    const N = this.sectors;
    const maxR = Math.min(w, h) * (0.46 + this.bassAvg * 0.08);
    const n = freq.length;
    g.save();
    g.translate(cx, cy);
    g.rotate(this.rot);
    g.strokeStyle = ink;
    for (let s = 0; s < N; s++) {
      const a = (s / N) * Math.PI * 2;
      // Sample a band that walks outward; mirror every other sector for symmetry.
      const band = s % (N / 2);
      const lo = Math.floor((band / (N / 2)) * n * 0.6);
      const hi = Math.min(n, Math.floor(((band + 1) / (N / 2)) * n * 0.6) + 1);
      let e = 0;
      for (let i = lo; i < hi; i++) e += freq[i];
      e = e / ((hi - lo) * 255) || 0;
      const len = (0.12 + Math.pow(e, 0.8) * 0.88) * maxR;
      g.lineWidth = 1 + e * 5;
      g.globalAlpha = 0.35 + e * 0.65;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      g.stroke();
    }
    g.globalAlpha = 1;
    g.restore();

    // --- pulsing time-domain ring ---------------------------------------------
    const baseR = Math.min(w, h) * 0.22;
    const m = time.length;
    g.strokeStyle = ink;
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= m; i++) {
      const v = (time[i % m] - 128) / 128; // -1..1
      const a = (i / m) * Math.PI * 2 + this.rot * 0.5;
      const r = baseR + v * baseR * 0.6;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
    g.stroke();

    // --- glitch: horizontal slice offsets on strong bass ----------------------
    if (this.bassAvg > 0.22 && Math.random() < 0.5) {
      const slices = 3;
      for (let i = 0; i < slices; i++) {
        const sy = Math.floor(Math.random() * h);
        const sh = 2 + Math.floor(Math.random() * (h * 0.05));
        const dx = Math.round((Math.random() - 0.5) * 40 * this.bassAvg);
        try { g.drawImage(this.canvas, 0, sy, w, sh, dx, sy, w, sh); } catch { /* size race */ }
      }
    }
  }
}
