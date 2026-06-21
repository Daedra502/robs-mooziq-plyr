import { Visualizer } from './interface.js';

// Time-domain waveform of the current track with a playback-position marker.
// Click or drag anywhere on it to seek (via context.seek).
export class Waveform extends Visualizer {
  static id = 'waveform';
  static label = 'Waveform';

  update(frame) {
    const g = this.g;
    const w = this.w;
    const h = this.h;
    const mid = h / 2;

    g.fillStyle = '#0a0a0f';
    g.fillRect(0, 0, w, h);

    // Seek while the pointer is held down (click = single seek, drag = scrub).
    if (frame.input.pointer.down) {
      this.context.seek(frame.input.pointer.nx);
    }

    // Center line.
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, mid);
    g.lineTo(w, mid);
    g.stroke();

    // Waveform trace.
    const data = frame.time;
    const n = data.length;
    g.lineWidth = Math.max(1, h / 300);
    g.strokeStyle = '#49c2ff';
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w;
      const y = (data[i] / 255) * h;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();

    // Playback position marker.
    const pb = frame.playback;
    if (pb.duration > 0) {
      const px = (pb.currentTime / pb.duration) * w;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(px, 0);
      g.lineTo(px, h);
      g.stroke();
    }
  }
}
