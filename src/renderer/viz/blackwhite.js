import { Visualizer } from './interface.js';

// "Black & White" — high-contrast monochrome mandala (G Jones / Tipper inspired).
//
// Reworked for legibility. The previous version stacked six faint layers (hex
// grid + spokes + two rings + squares + glitch) that muddied into grey noise; this
// keeps a few BOLD elements instead:
//   - a kaleidoscopic spectrum mandala (the centrepiece, solid fill = max contrast)
//   - a crisp time-domain ring orbiting it
//   - a pulsing bass core at the middle
//   - beat-spawned rings that expand outward, giving a clear sense of progression
//
// Every audio reaction is run through an envelope follower (fast attack, slow
// release) so motion reads as deliberate swells rather than per-frame jitter. The
// design stays pure black/white with a brief invert flash on strong beats.
export class BlackWhite extends Visualizer {
  static id = 'blackwhite';
  static label = 'Black & White';

  init(canvas, context) {
    super.init(canvas, context);
    this.SYMMETRY = 6;                  // kaleidoscope mirror count
    this.spec = new Float32Array(64);   // smoothed half-sector spectrum profile
    this.bassEnv = 0;                   // smoothed band energies (0..1)
    this.midEnv = 0;
    this.trebleEnv = 0;
    this.bassSlow = 0;                  // slow bass baseline for beat detection
    this.beatHold = 0;                  // debounce so one hit = one beat
    this.flash = 0;                     // frames of inverted colour remaining
    this.rot = 0;                       // mandala rotation
    this.ringRot = 0;                   // counter-rotation for the time ring
    this.rings = [];                    // expanding beat rings: { r, life }
  }

  update(frame) {
    const g = this.g;
    const w = this.w;
    const h = this.h;
    const cx = w / 2;
    const cy = h / 2;
    const S = Math.min(w, h);
    const dt = Math.min(2.5, frame.timing.delta / 16.67); // frames elapsed (~1 @60fps)
    const freq = frame.freq;
    const time = frame.time;
    const n = freq.length;

    // --- Band energy (bass / mid / treble), normalised 0..1 -------------------
    const band = (lo, hi) => {
      let sum = 0;
      const a = Math.floor(n * lo);
      const b = Math.floor(n * hi);
      for (let i = a; i < b; i++) sum += freq[i];
      return sum / ((b - a) * 255) || 0;
    };
    const bass = band(0.0, 0.08);
    const mid = band(0.08, 0.40);
    const treble = band(0.40, 1.0);

    // Envelope followers: snap up quickly, ease down slowly -> clean swells.
    const follow = (env, target, atk, rel) =>
      target > env ? env + (target - env) * atk : env + (target - env) * rel;
    this.bassEnv = follow(this.bassEnv, bass, 0.35, 0.06);
    this.midEnv = follow(this.midEnv, mid, 0.30, 0.07);
    this.trebleEnv = follow(this.trebleEnv, treble, 0.45, 0.10);
    this.bassSlow += (bass - this.bassSlow) * 0.03;

    const level = Math.min(1, this.bassEnv * 0.6 + this.midEnv * 0.5 + this.trebleEnv * 0.3);

    // --- Beat detection (bass transient over its slow baseline) ----------------
    this.beatHold -= dt;
    const beat = bass > this.bassSlow * 1.4 && bass > 0.12 && this.beatHold <= 0;
    if (beat) {
      this.beatHold = 8;
      this.rings.push({ r: S * 0.16, life: 1 });
      if (bass > this.bassSlow * 1.9) this.flash = 3; // invert only on the big ones
    }
    this.flash = Math.max(0, this.flash - dt);

    // --- Colours (high contrast; swap on flash) --------------------------------
    const inverted = this.flash > 0;
    const ink = inverted ? '#000' : '#fff';
    const paper = inverted ? '#fff' : '#000';
    g.fillStyle = paper;
    g.fillRect(0, 0, w, h);

    // --- Rotation (driven by energy so faster passages spin faster) -----------
    this.rot += (0.25 + this.bassEnv * 1.4) * 0.0006 * frame.timing.delta;
    this.ringRot -= (0.20 + this.midEnv * 1.0) * 0.0006 * frame.timing.delta;

    // --- Smoothed mandala profile: sample the low-mid spectrum into this.spec ---
    const M = this.spec.length;
    for (let j = 0; j < M; j++) {
      // weight the lower half of the spectrum where the shape-defining energy lives
      const idx = Math.floor(Math.pow(j / M, 1.3) * n * 0.55);
      const target = (freq[idx] || 0) / 255;
      this.spec[j] += (target - this.spec[j]) * 0.25;
    }

    g.save();
    g.translate(cx, cy);

    // --- Expanding beat rings (progression) ------------------------------------
    g.strokeStyle = ink;
    for (let k = this.rings.length - 1; k >= 0; k--) {
      const ring = this.rings[k];
      ring.r += (S * 0.012 + S * 0.004) * dt;
      ring.life -= 0.025 * dt;
      if (ring.life <= 0) { this.rings.splice(k, 1); continue; }
      g.globalAlpha = ring.life * 0.8;
      g.lineWidth = 1 + ring.life * (S * 0.006);
      g.beginPath();
      g.arc(0, 0, ring.r, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;

    // --- Mandala (the centrepiece) --------------------------------------------
    this._drawMandala(g, ink, paper, S, level);

    // --- Time-domain ring orbiting the mandala ---------------------------------
    this._drawTimeRing(g, time, ink, S * (0.40 + this.midEnv * 0.06), this.ringRot);

    // --- Pulsing bass core -----------------------------------------------------
    const coreR = S * 0.045 * (1 + this.bassEnv * 1.6);
    g.fillStyle = ink;
    g.globalAlpha = 0.85;
    g.beginPath();
    g.arc(0, 0, coreR, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;

    g.restore();
  }

  // Solid, mirror-symmetric kaleidoscope built from the smoothed spectrum profile.
  // A triangle-wave lookup mirrors each sector, so the shape is always seamless.
  _drawMandala(g, ink, paper, S, level) {
    const M = this.spec.length;
    const sym = this.SYMMETRY;
    const pts = sym * 48;
    const base = S * 0.14;
    const amp = S * 0.20 * (0.45 + level * 0.55);

    g.save();
    g.rotate(this.rot);

    g.beginPath();
    for (let k = 0; k <= pts; k++) {
      const ang = (k / pts) * Math.PI * 2;
      // position within the current sector (0..1), mirrored to a triangle wave
      const f = ((ang * sym) / (Math.PI * 2)) % 1;
      const tri = f < 0.5 ? f * 2 : (1 - f) * 2;
      const e = this.spec[Math.min(M - 1, Math.floor(tri * (M - 1)))];
      const r = base + Math.pow(e, 0.85) * amp;
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();

    // Solid ink fill for maximum contrast, then a crisp edge.
    g.fillStyle = ink;
    g.globalAlpha = 0.92;
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = ink;
    g.lineWidth = Math.max(1.5, S * 0.004);
    g.stroke();

    // Negative-space inner cut so the mandala reads as a ring, not a blob.
    g.beginPath();
    for (let k = 0; k <= pts; k++) {
      const ang = (k / pts) * Math.PI * 2;
      const f = ((ang * sym) / (Math.PI * 2)) % 1;
      const tri = f < 0.5 ? f * 2 : (1 - f) * 2;
      const e = this.spec[Math.min(M - 1, Math.floor(tri * (M - 1)))];
      const r = base * 0.55 + Math.pow(e, 0.85) * amp * 0.35;
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      k ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
    g.fillStyle = paper;
    g.fill();

    g.restore();
  }

  // Crisp circular waveform (audio time-domain) at a fixed orbit radius.
  _drawTimeRing(g, time, ink, radius, rotation) {
    const m = time.length;
    g.save();
    g.rotate(rotation);
    g.strokeStyle = ink;
    g.lineWidth = Math.max(1.2, Math.min(this.w, this.h) * 0.003);
    g.globalAlpha = 0.9;
    g.beginPath();
    for (let i = 0; i <= m; i++) {
      const v = (time[i % m] - 128) / 128; // -1..1
      const a = (i / m) * Math.PI * 2;
      const r = radius + v * radius * 0.12;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
    g.stroke();
    g.globalAlpha = 1;
    g.restore();
  }
}
