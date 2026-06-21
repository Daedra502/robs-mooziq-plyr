// Always-on "reactive chrome" drawn on a full-window overlay canvas that sits
// above the UI but ignores pointer events: a neon border that pulses with the
// music and slowly cycles hue.
//
// It implements the manager's overlay shape { update(frame), resize(w,h) } and
// owns its own canvas, so it's a drop-in global effect with no engine changes.
export class ReactiveChrome {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
    this.level = 0;
    this.bass = 0;
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1); // cap for fill-rate
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
  }

  update(frame) {
    const g = this.g;
    const dpr = this.dpr;
    const w = this.canvas.width;
    const h = this.canvas.height;
    g.clearRect(0, 0, w, h);

    // --- audio levels (smoothed) --------------------------------------------
    const freq = frame.freq;
    let all = 0;
    for (let i = 0; i < freq.length; i++) all += freq[i];
    all /= freq.length * 255;
    let bass = 0;
    for (let i = 0; i < 32; i++) bass += freq[i];
    bass /= 32 * 255;
    this.level += (all - this.level) * 0.25;
    this.bass += (bass - this.bass) * 0.35;

    this._drawBorder(g, w, h, frame.timing.elapsed);
  }

  _drawBorder(g, w, h, elapsed) {
    const hue = (elapsed * 0.03) % 360;
    const pulse = this.bass; // 0..1
    const inset = (6 + this.level * 4) * this.dpr;
    const lineW = (2 + pulse * 6) * this.dpr;
    const radius = 14 * this.dpr;

    g.save();
    g.globalCompositeOperation = 'lighter';
    // Two passes: a wide soft glow, then a brighter core line.
    for (let pass = 0; pass < 2; pass++) {
      const core = pass === 1;
      g.lineWidth = core ? lineW : lineW * 2.4;
      g.shadowBlur = (core ? 12 : 28) * this.dpr * (0.6 + pulse);
      g.shadowColor = `hsla(${hue}, 100%, 60%, 1)`;
      g.strokeStyle = core
        ? `hsla(${hue}, 100%, ${70 + pulse * 20}%, ${0.85})`
        : `hsla(${(hue + 40) % 360}, 100%, 55%, ${0.25 + pulse * 0.3})`;
      this._roundRect(g, inset, inset, w - inset * 2, h - inset * 2, radius);
      g.stroke();
    }
    g.restore();
  }

  _roundRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
}
