import { Visualizer } from './interface.js';

// Spectrum analyser styled after FL Studio's Wave Candy / common MIDI meters:
//   - logarithmic frequency axis (so bass isn't crushed into a few pixels)
//   - smooth filled curve with a glowing top line
//   - falling peak-hold line that lingers on the most pronounced frequencies
//
// getByteFrequencyData is already dB-scaled (minDecibels..maxDecibels -> 0..255),
// which is why pronounced bands read clearly without extra log-magnitude math.
export class Spectrograph extends Visualizer {
  static id = 'spectrograph';
  static label = 'Spectrograph';

  init(canvas, context) {
    super.init(canvas, context);
    this.fMin = 30;
    this.fMax = 18000;
    this._allocate();
  }

  resize(w, h) {
    super.resize(w, h);
    this._allocate();
  }

  _allocate() {
    // One sample column per ~3 device px, clamped to a sane range.
    this.N = Math.max(96, Math.min(480, Math.floor((this.w || 480) / 3)));
    this.mag = new Float32Array(this.N);
    this.peaks = new Float32Array(this.N);
  }

  // Linear interpolation into the FFT bin array.
  _sample(freq, binPos) {
    const i = binPos | 0;
    const f = binPos - i;
    const a = freq[i] || 0;
    const b = freq[i + 1] !== undefined ? freq[i + 1] : a;
    return (a + (b - a) * f) / 255;
  }

  update(frame) {
    const g = this.g;
    const w = this.w;
    const h = this.h;
    const freq = frame.freq;
    const n = freq.length;
    const N = this.N;

    const nyquist = (this.context.audioContext.sampleRate || 44100) / 2;
    const fMax = Math.min(this.fMax, nyquist);
    const ratio = fMax / this.fMin;

    // Frame-rate-independent peak fall (~0.55 units / second).
    const fall = 0.00055 * frame.timing.delta;

    // Sample the spectrum onto a log-frequency grid + update peak hold.
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const f = this.fMin * Math.pow(ratio, t);
      const bin = (f / nyquist) * (n - 1);
      const v = Math.pow(this._sample(freq, bin), 0.92); // slight lift
      this.mag[i] = v;
      this.peaks[i] = v >= this.peaks[i] ? v : Math.max(v, this.peaks[i] - fall);
    }

    // Background.
    g.fillStyle = '#07070d';
    g.fillRect(0, 0, w, h);

    // Faint reference grid lines (decade-ish).
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = 1;
    for (const f of [100, 1000, 10000]) {
      if (f > fMax) continue;
      const x = (Math.log(f / this.fMin) / Math.log(ratio)) * w;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }

    const xAt = (i) => (i / (N - 1)) * w;
    const yAt = (v) => h - v * h * 0.95;

    // Smooth filled area under the curve.
    g.beginPath();
    g.moveTo(0, h);
    g.lineTo(0, yAt(this.mag[0]));
    for (let i = 1; i < N; i++) {
      const xc = (xAt(i - 1) + xAt(i)) / 2;
      const yc = (yAt(this.mag[i - 1]) + yAt(this.mag[i])) / 2;
      g.quadraticCurveTo(xAt(i - 1), yAt(this.mag[i - 1]), xc, yc);
    }
    g.lineTo(w, yAt(this.mag[N - 1]));
    g.lineTo(w, h);
    g.closePath();
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0.0, 'rgba(73,194,255,0.55)');
    grad.addColorStop(0.5, 'rgba(120,110,255,0.55)');
    grad.addColorStop(1.0, 'rgba(255,90,180,0.55)');
    g.fillStyle = grad;
    g.fill();

    // Glowing top line.
    g.save();
    g.shadowColor = 'rgba(120,200,255,0.9)';
    g.shadowBlur = 14;
    g.strokeStyle = '#bfe6ff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, yAt(this.mag[0]));
    for (let i = 1; i < N; i++) {
      const xc = (xAt(i - 1) + xAt(i)) / 2;
      const yc = (yAt(this.mag[i - 1]) + yAt(this.mag[i])) / 2;
      g.quadraticCurveTo(xAt(i - 1), yAt(this.mag[i - 1]), xc, yc);
    }
    g.stroke();
    g.restore();

    // Falling peak-hold line — lingers on the loudest frequencies.
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i < N; i++) {
      const x = xAt(i);
      const y = yAt(this.peaks[i]);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
  }
}
