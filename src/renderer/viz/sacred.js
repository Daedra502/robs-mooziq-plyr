import { Visualizer } from './interface.js';

// "Sacred Geometry" — a layered, audio-reactive weave of sacred-geometry forms,
// fractals and classic mathematical curves, drawn additively over phosphor trails.
//
// Built for growth: every pattern is a self-contained entry in `this.layers`
// (`{ name, draw(audio) }`). To add a new form later (Metatron's cube, Sierpinski,
// superformula, Lissajous, Mandelbrot orbit, …) just push another layer — nothing
// else changes. Each layer reads a shared per-frame `audio` object and draws to
// `this.g`. Keep layers cheap (bounded point counts / recursion) for 60fps.
const TAU = Math.PI * 2;
const PHI = 1.61803398875;          // golden ratio
const DEG = Math.PI / 180;
const K_GOLDEN = (2 / Math.PI) * Math.log(PHI); // log-spiral growth of a golden spiral

export class SacredGeometry extends Visualizer {
  static id = 'sacred';
  static label = 'Sacred Geometry';

  init(canvas, context) {
    super.init(canvas, context);
    this.rot = 0;
    this.hue = 0;
    this.bassAvg = 0;
    this.level = 0;
    this.beatHold = 0;
    // Layer registry — append future sacred/fractal/equation forms here.
    this.layers = [
      { name: 'flower-of-life', draw: (a) => this._flowerOfLife(a) },
      { name: 'maurer-rose', draw: (a) => this._maurerRose(a) },
      { name: 'golden-spiral', draw: (a) => this._goldenSpiral(a) },
      { name: 'fractal-polygon', draw: (a) => this._fractalPolygon(a) },
    ];
  }

  _bands(freq) {
    let bass = 0, mid = 0, treble = 0;
    for (let i = 0; i < 24; i++) bass += freq[i];
    for (let i = 24; i < 180; i++) mid += freq[i];
    for (let i = 180; i < 600; i++) treble += freq[i];
    return { bass: bass / (24 * 255), mid: mid / (156 * 255), treble: treble / (420 * 255) };
  }

  update(frame) {
    const g = this.g, w = this.w, h = this.h;
    const dt = Math.min(2, frame.timing.delta / 16.67);
    const b = this._bands(frame.freq);

    this.bassAvg += (b.bass - this.bassAvg) * 0.08;
    this.level += (b.bass + b.mid + b.treble - this.level) * 0.1;
    const beat = b.bass > this.bassAvg * 1.4 && b.bass > 0.13 && this.beatHold <= 0;
    this.beatHold = beat ? 9 : this.beatHold - dt;

    this.rot += (0.001 + this.bassAvg * 0.012) * frame.timing.delta;
    this.hue = (this.hue + (0.01 + b.treble * 0.4) * frame.timing.delta) % 360;

    // Phosphor trails: fade the previous frame instead of clearing.
    g.fillStyle = 'rgba(6, 6, 12, 0.18)';
    g.fillRect(0, 0, w, h);

    const audio = {
      cx: w / 2, cy: h / 2, R: Math.min(w, h) * 0.42,
      bass: b.bass, mid: b.mid, treble: b.treble, level: this.level, beat,
      hue: this.hue, rot: this.rot,
      arms: 1 + Math.round(b.mid * 4),
      roseN: 3 + Math.round(b.treble * 6),
      roseD: 61 + Math.round(b.mid * 30),
      sides: 3 + Math.round(b.mid * 2),
    };

    g.save();
    g.globalCompositeOperation = 'lighter';
    g.lineJoin = 'round';
    for (const layer of this.layers) layer.draw(audio);
    g.restore();
  }

  // --- layers ----------------------------------------------------------------

  // Flower of Life: 19 overlapping circles on a hexagonal lattice.
  _flowerOfLife(a) {
    const g = this.g, r = a.R * 0.2 * (1 + a.bass * 0.12);
    const cos = Math.cos(a.rot * 0.5), sin = Math.sin(a.rot * 0.5);
    g.lineWidth = 1.2;
    g.strokeStyle = `hsla(${a.hue | 0}, 80%, 62%, ${0.18 + a.level * 0.12})`;
    for (let q = -2; q <= 2; q++)
      for (let p = -2; p <= 2; p++) {
        if (Math.abs(q + p) > 2) continue; // hex disk of radius 2 -> 19 cells
        const ox = (q + p * 0.5) * r, oy = (p * Math.sqrt(3) / 2) * r;
        const x = a.cx + ox * cos - oy * sin, y = a.cy + ox * sin + oy * cos;
        g.beginPath();
        g.arc(x, y, r, 0, TAU);
        g.stroke();
      }
  }

  // Maurer rose: r = sin(nθ) sampled at a constant angular step `d` and joined.
  _maurerRose(a) {
    const g = this.g;
    g.lineWidth = 1;
    g.strokeStyle = `hsla(${(a.hue + 120) % 360}, 100%, 66%, ${0.22 + a.treble * 0.4})`;
    g.beginPath();
    for (let k = 0; k <= 360; k++) {
      const th = k * a.roseD * DEG;
      const rr = Math.sin(a.roseN * th) * a.R;
      const x = a.cx + Math.cos(th + a.rot) * rr;
      const y = a.cy + Math.sin(th + a.rot) * rr;
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }

  // Golden spiral(s): logarithmic spiral r = e^(kθ), normalized to R, mirrored arms.
  _goldenSpiral(a) {
    const g = this.g, turns = 3.5, steps = 200, thMax = turns * TAU;
    const norm = Math.exp(K_GOLDEN * thMax);
    g.lineWidth = 1 + a.bass * 3;
    for (let arm = 0; arm < a.arms; arm++) {
      g.strokeStyle = `hsla(${(a.hue + arm * 50) % 360}, 90%, 60%, 0.5)`;
      const off = a.rot + (arm / a.arms) * TAU;
      g.beginPath();
      for (let i = 0; i <= steps; i++) {
        const th = (i / steps) * thMax;
        const rr = a.R * Math.exp(K_GOLDEN * th) / norm;
        const x = a.cx + Math.cos(th + off) * rr;
        const y = a.cy + Math.sin(th + off) * rr;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    }
  }

  // Recursive fractal: a polygon with smaller counter-rotating copies at its vertices.
  _fractalPolygon(a) {
    this._poly(a.cx, a.cy, a.R * 0.5, Math.min(5, a.sides), a.rot, 3, a.hue + 200, a);
  }

  _poly(x, y, r, sides, rot, depth, hue, a) {
    if (depth <= 0 || r < 7) return;
    const g = this.g;
    g.lineWidth = 1;
    g.strokeStyle = `hsla(${hue % 360}, 85%, 60%, ${0.12 + depth * 0.07})`;
    g.beginPath();
    for (let i = 0; i <= sides; i++) {
      const ang = rot + (i / sides) * TAU;
      const px = x + Math.cos(ang) * r, py = y + Math.sin(ang) * r;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.stroke();
    const nr = r * 0.46 * (1 + a.bass * 0.2);
    for (let i = 0; i < sides; i++) {
      const ang = rot + (i / sides) * TAU;
      this._poly(x + Math.cos(ang) * r, y + Math.sin(ang) * r, nr, sides, rot * -1.3, depth - 1, hue + 30, a);
    }
  }
}
