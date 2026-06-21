import { Visualizer } from './interface.js';

// Audio-reactive particle system.
//
// Swarm particles: each is assigned a frequency band. Its colour is the band's
// hue and its size/brightness track that band's live energy, so different dots
// "listen" to different parts of the music. Forces acting on them:
//   - mouse attraction (spring toward the pointer)
//   - per-band radial drive (its frequency pushes it outward from center)
//   - bass radial pulse (whole swarm breathes on kicks)
//   - swirl + turbulence for organic motion, plus damping
//
// Emitters (transient sparks): a center burst fired on detected bass beats, and
// a steady ambient drift in from the edges.
export class Particles extends Visualizer {
  static id = 'particles';
  static label = 'Particles';

  init(canvas, context) {
    super.init(canvas, context);
    this.bands = 16;
    this.count = 150;
    this.swarm = [];
    this.sparks = [];
    this.energy = new Float32Array(this.bands);
    this.bassAvg = 0;
    this.beatHold = 0;
    this._seed();
  }

  resize(w, h) {
    const ow = this.w || w;
    const oh = this.h || h;
    super.resize(w, h);
    const sx = w / ow;
    const sy = h / oh;
    for (const p of this.swarm) { p.x *= sx; p.y *= sy; }
  }

  _seed() {
    this.swarm = [];
    for (let i = 0; i < this.count; i++) {
      const band = i % this.bands;
      this.swarm.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        vx: 0, vy: 0,
        band,
        hue: (band / this.bands) * 320,           // low = red, high = violet
        k: 0.004 + Math.random() * 0.01,           // mouse spring stiffness
        size: 1.5 + Math.random() * 2,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  // Average energy per frequency band (0..1).
  _readBands(freq) {
    const n = freq.length;
    for (let b = 0; b < this.bands; b++) {
      const lo = Math.floor(Math.pow(n, b / this.bands));
      const hi = Math.max(lo + 1, Math.floor(Math.pow(n, (b + 1) / this.bands)));
      let sum = 0, c = 0;
      for (let i = lo; i < hi && i < n; i++) { sum += freq[i]; c++; }
      const v = c ? sum / c / 255 : 0;
      this.energy[b] += (v - this.energy[b]) * 0.4; // smooth
    }
  }

  update(frame) {
    const g = this.g;
    const w = this.w;
    const h = this.h;
    const cx = w / 2;
    const cy = h / 2;
    const t = frame.timing.elapsed * 0.001;
    const dt = Math.min(2, frame.timing.delta / 16.67);

    this._readBands(frame.freq);

    // Bass + beat detection (rising edge over a moving average).
    let bass = (this.energy[0] + this.energy[1] + this.energy[2]) / 3;
    this.bassAvg += (bass - this.bassAvg) * 0.08;
    const beat = bass > this.bassAvg * 1.35 && bass > 0.12 && this.beatHold <= 0;
    this.beatHold = beat ? 8 : this.beatHold - dt;

    // Pointer target (over canvas, else center).
    const p = frame.input.pointer;
    const overCanvas = p.nx >= 0 && p.nx <= 1 && p.ny >= 0 && p.ny <= 1;
    const tx = overCanvas ? p.x : cx;
    const ty = overCanvas ? p.y : cy;
    this._everMoved = this._everMoved || frame.input.drag || p.down;

    // Emitters.
    if (beat) this._burst(cx, cy);
    if (Math.random() < 0.25 * dt) this._edgeSpark();

    // Trails.
    g.fillStyle = 'rgba(8, 8, 14, 0.20)';
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';

    // --- swarm ---------------------------------------------------------------
    for (const d of this.swarm) {
      const e = this.energy[d.band];

      // Mouse attraction (stronger once the user has interacted).
      const mk = d.k * (this._everMoved ? 1 : 0.4);
      d.vx += (tx - d.x) * mk * dt;
      d.vy += (ty - d.y) * mk * dt;

      // Per-band radial drive + bass pulse, away from center.
      const dx = d.x - cx;
      const dy = d.y - cy;
      const dist = Math.hypot(dx, dy) || 1;
      const push = (e * 0.9 + this.bassAvg * 0.6) * dt;
      d.vx += (dx / dist) * push;
      d.vy += (dy / dist) * push;

      // Gentle swirl + turbulence.
      d.vx += Math.cos(t + d.phase) * 0.05 * dt;
      d.vy += Math.sin(t * 1.3 + d.phase) * 0.05 * dt;
      d.vx += (-dy / dist) * e * 0.3 * dt; // tangential

      d.vx *= 0.92;
      d.vy *= 0.92;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      wrap(d, w, h);

      const r = d.size * (1 + e * 3);
      const light = 50 + e * 40;
      g.beginPath();
      g.fillStyle = `hsla(${d.hue + e * 40}, 95%, ${light}%, ${0.5 + e * 0.5})`;
      g.arc(d.x, d.y, r, 0, Math.PI * 2);
      g.fill();
    }

    // --- sparks (transient) --------------------------------------------------
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= 0.02 * dt;
      if (s.life <= 0) { this.sparks.splice(i, 1); continue; }
      s.vy += 0.02 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      g.beginPath();
      g.fillStyle = `hsla(${s.hue}, 100%, 70%, ${s.life})`;
      g.arc(s.x, s.y, s.size * s.life + 0.5, 0, Math.PI * 2);
      g.fill();
    }

    g.globalCompositeOperation = 'source-over';
  }

  _burst(x, y) {
    const n = 24;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const sp = 2 + Math.random() * 4;
      this.sparks.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        hue: 20 + Math.random() * 40, size: 2.5, life: 1,
      });
    }
    if (this.sparks.length > 400) this.sparks.splice(0, this.sparks.length - 400);
  }

  _edgeSpark() {
    const edge = Math.floor(Math.random() * 4);
    const w = this.w, h = this.h;
    const pos = [[Math.random() * w, 0, 0, 1], [Math.random() * w, h, 0, -1],
                 [0, Math.random() * h, 1, 0], [w, Math.random() * h, -1, 0]][edge];
    this.sparks.push({
      x: pos[0], y: pos[1], vx: pos[2] * (0.5 + Math.random()), vy: pos[3] * (0.5 + Math.random()),
      hue: 180 + Math.random() * 140, size: 1.5, life: 1,
    });
  }

  destroy() { this.swarm = []; this.sparks = []; }
}

function wrap(d, w, h) {
  if (d.x < -20) d.x = w + 20; else if (d.x > w + 20) d.x = -20;
  if (d.y < -20) d.y = h + 20; else if (d.y > h + 20) d.y = -20;
}
