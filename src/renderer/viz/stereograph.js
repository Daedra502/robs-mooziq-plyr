import { Visualizer } from './interface.js';

// Goniometer / Lissajous plot of the stereo field, fed by the split L/R analyser
// nodes. Samples are rotated 45° (the audio-engineering convention) so a mono
// signal traces a vertical line and width spreads horizontally.
//   x = (L - R)  -> "side"  (horizontal)
//   y = (L + R)  -> "mid"   (vertical)
export class Stereograph extends Visualizer {
  static id = 'stereograph';
  static label = 'Stereograph';

  update(frame) {
    const g = this.g;
    const w = this.w;
    const h = this.h;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.45;

    // Fade previous frame instead of clearing, for phosphor-like trails.
    g.fillStyle = 'rgba(10, 10, 15, 0.18)';
    g.fillRect(0, 0, w, h);

    // Axes (L and R diagonals).
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx - radius, cy + radius); g.lineTo(cx + radius, cy - radius); // R
    g.moveTo(cx - radius, cy - radius); g.lineTo(cx + radius, cy + radius); // L
    g.stroke();

    const L = frame.left;
    const R = frame.right;
    const n = Math.min(L.length, R.length);
    const inv = 1 / 128;
    const k = 0.7071; // 1/sqrt(2), keeps the rotated point in range

    g.strokeStyle = 'rgba(80, 230, 160, 0.9)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const l = (L[i] - 128) * inv; // -1..1
      const r = (R[i] - 128) * inv;
      const side = (l - r) * k;
      const mid = (l + r) * k;
      const x = cx + side * radius;
      const y = cy - mid * radius;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
}
