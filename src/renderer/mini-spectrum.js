// The little spectrum analyzer that lives in the player's LCD display — a nod to
// Winamp's tiny built-in visualizer. It implements the manager's overlay shape
// { update(frame), resize() } and owns its own small canvas, so it rides the shared
// render loop (and pauses with it) at no extra cost.
//
// Classic look: a handful of log-spaced bars in a green→amber gradient, each topped
// by a white peak cap that falls back slowly — the signature "bouncing bars".
const BARS = 20;
const PEAK_FALL = 0.012;  // peak-cap descent per frame (fraction of height)
const BAR_FALL = 0.18;    // how fast a bar relaxes toward the current level

export class MiniSpectrum {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.bars = new Float32Array(BARS);  // 0..1 smoothed bar heights
    this.peaks = new Float32Array(BARS); // 0..1 falling peak caps
    this.dpr = 1;
    this.grad = null;
    // Skin colours, read from the canvas's CSS variables (refreshed on skin change).
    this.colors = { bg: '#05140a', peak: 'rgba(220,255,220,0.9)', stops: ['#0a6b2a', '#2bd24f', '#9be84b', '#ffd23f'] };
    this.refreshColors();
    this.resize();
  }

  // Pull the active skin's --vis-* palette from computed style and rebuild the
  // cached bar gradient. Called on construction and whenever the skin changes.
  refreshColors() {
    const cs = getComputedStyle(this.canvas);
    const v = (name, fallback) => (cs.getPropertyValue(name).trim() || fallback);
    this.colors = {
      bg: v('--vis-bg', '#05140a'),
      peak: v('--vis-peak', 'rgba(220,255,220,0.9)'),
      stops: [v('--vis-1', '#0a6b2a'), v('--vis-2', '#2bd24f'), v('--vis-3', '#9be84b'), v('--vis-4', '#ffd23f')],
    };
    this._buildGradient();
  }

  _buildGradient() {
    const h = this.canvas.height || 34;
    const grad = this.g.createLinearGradient(0, h, 0, 0);
    const s = this.colors.stops;
    grad.addColorStop(0.0, s[0]);
    grad.addColorStop(0.45, s[1]);
    grad.addColorStop(0.75, s[2]);
    grad.addColorStop(1.0, s[3]);
    this.grad = grad;
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = this.canvas;
    c.width = Math.max(1, Math.round(c.clientWidth * this.dpr));
    c.height = Math.max(1, Math.round(c.clientHeight * this.dpr));
    this._buildGradient(); // gradient depends on canvas height
  }

  update(frame) {
    const g = this.g;
    const w = this.canvas.width;
    const h = this.canvas.height;
    g.fillStyle = this.colors.bg;
    g.fillRect(0, 0, w, h);

    const freq = frame.freq;
    // Log-spaced grouping across the lower ~3/4 of the spectrum (the top bins are
    // mostly empty for music); each bar takes the max of its bin span.
    const usable = Math.floor(freq.length * 0.72);
    const gap = Math.max(1, Math.round(w * 0.06 / BARS));
    const bw = (w - gap * (BARS - 1)) / BARS;

    for (let i = 0; i < BARS; i++) {
      const lo = Math.floor(Math.pow(i / BARS, 1.7) * usable);
      const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / BARS, 1.7) * usable));
      let max = 0;
      for (let j = lo; j < hi; j++) if (freq[j] > max) max = freq[j];
      const target = max / 255;

      // Fast rise, eased fall for the bars; slow constant fall for the peak caps.
      const b = this.bars[i];
      this.bars[i] = target > b ? target : b + (target - b) * BAR_FALL;
      if (this.bars[i] >= this.peaks[i]) this.peaks[i] = this.bars[i];
      else this.peaks[i] = Math.max(this.bars[i], this.peaks[i] - PEAK_FALL);

      const x = Math.round(i * (bw + gap));
      const bh = this.bars[i] * h;
      g.fillStyle = this.grad;
      g.fillRect(x, h - bh, Math.ceil(bw), bh);

      // Peak cap.
      const py = Math.round(h - this.peaks[i] * h);
      g.fillStyle = this.colors.peak;
      g.fillRect(x, Math.min(h - 2, py), Math.ceil(bw), 2 * this.dpr);
    }
  }
}
