import { Visualizer } from './interface.js';

// Real-time scrolling spectrogram (waterfall) for spotting hidden images and
// messages baked into a track's frequency content — à la FL Studio's Wave Candy.
//
//   - Time runs along the horizontal axis (history scrolls right -> left)
//   - Frequency runs up the vertical axis on a log scale (low at the BOTTOM,
//     the conventional spectrogram orientation)
//   - One offscreen buffer holds the waterfall; each frame we shift it left by one
//     column and paint only the newest column, so cost is O(bins) per frame rather
//     than O(history x bins). Axis/time overlays are drawn fresh on the visible
//     canvas every frame so they never smear into the history.
export class SpectrogramAnalyzer extends Visualizer {
  static id = 'spectrogram-analyzer';
  static label = 'Spectrogram';

  init(canvas, context) {
    super.init(canvas, context);

    // Configuration
    this.fMin = 20;
    this.fMax = 20000;
    this.columnWidth = 2;     // pixels the waterfall advances per frame
    this.fftResolution = 256; // vertical frequency cells (interpolated from the FFT)
    this.bg = '#0a0a0f';

    this._buildColorLUT();

    // Offscreen waterfall buffer (display-sized; holds only the spectrogram).
    this.scrollBuffer = document.createElement('canvas');
    this.scrollG = this.scrollBuffer.getContext('2d', { alpha: false });
    this._allocate();
  }

  resize(w, h) {
    super.resize(w, h);
    this._allocate();
  }

  // (Re)size the waterfall buffer to the display and clear it.
  _allocate() {
    this.scrollBuffer.width = Math.max(1, this.w);
    this.scrollBuffer.height = Math.max(1, this.h);
    this.scrollG.fillStyle = this.bg;
    this.scrollG.fillRect(0, 0, this.scrollBuffer.width, this.scrollBuffer.height);
  }

  // Precompute a 256-entry magnitude -> 'rgb()' lookup so the hot loop never
  // interpolates colours or builds strings per cell.
  _buildColorLUT() {
    const stops = [
      { mag: 0.0, r: 15, g: 20, b: 50 },    // deep blue-black
      { mag: 0.15, r: 30, g: 40, b: 100 },  // dark blue
      { mag: 0.35, r: 80, g: 40, b: 120 },  // indigo/purple
      { mag: 0.6, r: 200, g: 80, b: 40 },   // orange
      { mag: 0.85, r: 255, g: 180, b: 0 },  // amber
      { mag: 1.0, r: 255, g: 255, b: 80 },  // bright yellow
    ];
    this.colorLUT = new Array(256);
    for (let i = 0; i < 256; i++) {
      const mag = i / 255;
      let lo = stops[0];
      let hi = stops[stops.length - 1];
      for (let s = 0; s < stops.length - 1; s++) {
        if (mag >= stops[s].mag && mag <= stops[s + 1].mag) {
          lo = stops[s];
          hi = stops[s + 1];
          break;
        }
      }
      const range = hi.mag - lo.mag;
      const t = range > 0 ? (mag - lo.mag) / range : 0;
      const r = Math.round(lo.r + (hi.r - lo.r) * t);
      const g = Math.round(lo.g + (hi.g - lo.g) * t);
      const b = Math.round(lo.b + (hi.b - lo.b) * t);
      this.colorLUT[i] = `rgb(${r},${g},${b})`;
    }
  }

  // Linear-interpolate the FFT array at an arbitrary frequency; returns 0..1.
  _sampleFreq(freq, targetFreq, nyquist) {
    const len = freq.length;
    const binPos = (targetFreq / nyquist) * (len - 1);
    const i = binPos | 0;
    const frac = binPos - i;
    const a = freq[i] || 0;
    const b = i + 1 < len ? freq[i + 1] : a;
    return (a + (b - a) * frac) / 255;
  }

  update(frame) {
    const g = this.g;
    const w = this.w;
    const h = this.h;
    const sg = this.scrollG;
    const freq = frame.freq;
    const nyquist = (this.context.audioContext.sampleRate || 44100) / 2;
    const ratio = this.fMax / this.fMin;
    const res = this.fftResolution;
    const cw = this.columnWidth;

    // 1) Scroll the existing waterfall one column to the left.
    sg.drawImage(this.scrollBuffer, -cw, 0);

    // 2) Paint the newest column at the right edge. Low frequency sits at the
    //    bottom, so cell i (lowest = 0) maps to y = h - (i+1)/res * h.
    const x = w - cw;
    sg.fillStyle = this.bg;
    sg.fillRect(x, 0, cw, h);
    for (let i = 0; i < res; i++) {
      const t = i / (res - 1);
      const f = this.fMin * Math.pow(ratio, t);
      const mag = Math.pow(this._sampleFreq(freq, f, nyquist), 0.85); // gamma for visibility
      const yTop = h * (1 - (i + 1) / res);
      const yBot = h * (1 - i / res);
      sg.fillStyle = this.colorLUT[Math.min(255, (mag * 255) | 0)];
      sg.fillRect(x, yTop, cw, yBot - yTop + 1);
    }

    // 3) Blit the waterfall to the visible canvas, then overlays on top.
    g.drawImage(this.scrollBuffer, 0, 0);
    this._drawFrequencyAxis(g, w, h, ratio);
    this._drawTimeIndicator(g, w, h, frame);
  }

  _drawFrequencyAxis(g, w, h, ratio) {
    const freqs = [20, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 20000];
    g.font = '11px monospace';
    g.fillStyle = 'rgba(200, 150, 255, 0.6)';
    g.strokeStyle = 'rgba(200, 150, 255, 0.13)';
    g.lineWidth = 1;

    for (const f of freqs) {
      if (f < this.fMin || f > this.fMax) continue;
      const t = Math.log(f / this.fMin) / Math.log(ratio);
      const y = h * (1 - t); // low freq at the bottom
      if (y <= 0 || y >= h) continue;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
      const label = f < 1000 ? `${f}Hz` : `${(f / 1000).toFixed(0)}k`;
      g.fillText(label, 5, y - 3);
    }
  }

  _drawTimeIndicator(g, w, h, frame) {
    // "Now" marker on the right edge.
    g.strokeStyle = 'rgba(255, 255, 255, 0.45)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(w - 1, 0);
    g.lineTo(w - 1, h);
    g.stroke();

    if (frame.playback.duration > 0) {
      const timeStr = this._formatTime(frame.playback.currentTime);
      g.font = 'bold 12px monospace';
      const pad = 4;
      const tw = g.measureText(timeStr).width;
      const bgX = w - tw - pad * 2 - 4;
      g.fillStyle = 'rgba(0, 0, 0, 0.6)';
      g.fillRect(bgX, 4, tw + pad * 2, 16);
      g.fillStyle = 'rgba(255, 255, 100, 0.9)';
      g.fillText(timeStr, bgX + pad, 16);
    }
  }

  _formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  destroy() {
    this.scrollBuffer = null;
    this.scrollG = null;
    this.colorLUT = null;
  }
}
