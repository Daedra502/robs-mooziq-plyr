// Per-deck CDJ-style display (one canvas per deck), drawn from the shared render
// loop as a manager overlay (so it costs nothing in Listen mode). Each deck shows:
//   - a scrolling track waveform centered on the playhead
//   - a beatgrid (beats / bars / 16-beat phrases) derived from the deck BPM
//   - a bar/beat readout and a 16-step phrase circle (rotating needle)
// The waveform is also draggable left/right to nudge/scrub the track for lining up
// a mix. Beatgrid assumes beat 0 at track start (no downbeat detection yet).
const WINDOW = 8; // seconds of track visible across the canvas
const COL = { A: '#49c2ff', B: '#ff5ab4' };
const DIM = { A: '#2a5f86', B: '#7a3358' };

export class DeckMonitors {
  constructor(engine, canvases, vu = {}) {
    this.engine = engine;
    this.canvases = canvases; // { A, B }
    this.vu = vu;             // { A, B } VU-meter fill elements (optional)
    this.vuLevel = { A: 0, B: 0 };
    this.g = { A: canvases.A.getContext('2d'), B: canvases.B.getContext('2d') };
    this.info = { A: null, B: null }; // { peaks, secondsPerBucket, duration, bpm, beatOffset }
    this.scrub = { A: null, B: null };
    this.enabled = false;
    for (const which of ['A', 'B']) this._bindScrub(which);
  }

  setDeck(which, info) { this.info[which] = info; }
  clearDeck(which) { this.info[which] = null; }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const w of ['A', 'B']) {
      const c = this.canvases[w];
      c.width = Math.max(1, Math.round(c.clientWidth * dpr));
      c.height = Math.max(1, Math.round(c.clientHeight * dpr));
    }
  }

  update() {
    if (!this.enabled) return;
    this._draw('A');
    this._draw('B');
    this._updateVu('A');
    this._updateVu('B');
  }

  // Post-fader channel level (RMS) -> VU bar height, smoothed for a meter feel.
  _updateVu(which) {
    const el = this.vu[which];
    if (!el) return;
    const an = this.engine.getDeckAnalyser(which);
    const buf = this._vuBuf || (this._vuBuf = new Uint8Array(an.fftSize));
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    const rms = Math.min(1, Math.sqrt(sum / buf.length) * 2.4);
    // Fast attack, slow release.
    this.vuLevel[which] += (rms - this.vuLevel[which]) * (rms > this.vuLevel[which] ? 0.6 : 0.12);
    el.style.height = (this.vuLevel[which] * 100).toFixed(1) + '%';
  }

  // Drag the waveform to scrub/nudge (full-width drag == WINDOW seconds).
  _bindScrub(which) {
    const c = this.canvases[which];
    c.addEventListener('pointerdown', (e) => {
      const st = this.engine.getDeckState(which);
      if (!st.duration) return;
      this.scrub[which] = { x: e.clientX, t: st.currentTime, w: c.getBoundingClientRect().width };
      c.setPointerCapture?.(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      const s = this.scrub[which];
      if (!s) return;
      const dur = this.engine.getDeckState(which).duration;
      const dt = -(e.clientX - s.x) * WINDOW / s.w;
      this.engine.seekDeck(which, (s.t + dt) / dur);
    });
    const end = () => { this.scrub[which] = null; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  _draw(which) {
    const g = this.g[which];
    const c = this.canvases[which];
    const w = c.width;
    const h = c.height;
    const mid = h / 2;
    const info = this.info[which];
    const st = this.engine.getDeckState(which);
    const cur = st.currentTime || 0;
    const dur = st.duration || 0;
    const pxPerSec = w / WINDOW;

    g.fillStyle = '#07070d';
    g.fillRect(0, 0, w, h);

    // Waveform: played side bright, upcoming side dim.
    if (info?.peaks && dur > 0) {
      const spb = info.secondsPerBucket;
      for (let x = 0; x < w; x++) {
        const t = cur + (x - w / 2) / pxPerSec;
        if (t < 0 || t > dur) continue;
        const peak = info.peaks[Math.floor(t / spb)] || 0;
        const amp = Math.min(1, peak) * mid * 0.92;
        g.fillStyle = x < w / 2 ? COL[which] : DIM[which];
        g.fillRect(x, mid - amp, 1, amp * 2);
      }
    }

    // Beatgrid.
    const bpm = info?.bpm || 0;
    const off = info?.beatOffset || 0;
    if (bpm > 0) {
      const beat = 60 / bpm;
      const lastT = cur + WINDOW / 2;
      for (let n = Math.ceil((cur - WINDOW / 2 - off) / beat); ; n++) {
        const t = off + n * beat;
        if (t > lastT) break;
        if (t < 0) continue;
        const x = w / 2 + (t - cur) * pxPerSec;
        const phrase = ((n % 16) + 16) % 16 === 0;
        const bar = ((n % 4) + 4) % 4 === 0;
        g.strokeStyle = phrase ? 'rgba(255,210,90,0.9)' : bar ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.16)';
        g.lineWidth = phrase ? 2 : bar ? 1.5 : 1;
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      }
    }

    // Center playhead.
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();

    if (bpm > 0) this._drawHud(g, w, h, which, cur, bpm, off);
  }

  _drawHud(g, w, h, which, cur, bpm, off) {
    const beat = 60 / bpm;
    const b = Math.floor((cur - off) / beat);
    const bar = Math.floor(b / 4);
    const beatInBar = ((b % 4) + 4) % 4 + 1;
    const phraseBeat = ((b % 16) + 16) % 16; // 0..15

    // Readout (top-left).
    const fs = Math.max(11, Math.round(h * 0.13));
    g.font = `600 ${fs}px system-ui, sans-serif`;
    g.textBaseline = 'top';
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(0, 0, fs * 9, fs * 1.5);
    g.fillStyle = '#fff';
    g.fillText(`${bpm} BPM  ·  Bar ${bar + 1}  ·  ${beatInBar}/4`, 6, 5);

    // Phrase circle (top-right): 16 ticks + rotating needle.
    const R = Math.min(h * 0.32, w * 0.12);
    const cx = w - R - 8;
    const cy = R + 8;
    g.strokeStyle = 'rgba(255,255,255,0.15)';
    g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI / 2 + (i / 16) * Math.PI * 2;
      const on = i === phraseBeat;
      const down = i % 4 === 0;
      g.fillStyle = on ? COL[which] : down ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.25)';
      g.beginPath();
      g.arc(cx + Math.cos(a) * R, cy + Math.sin(a) * R, on ? R * 0.16 : R * 0.1, 0, Math.PI * 2);
      g.fill();
    }
    const prog = (cur - off) / (16 * beat);
    const na = -Math.PI / 2 + (prog - Math.floor(prog)) * Math.PI * 2;
    g.strokeStyle = COL[which];
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(na) * R * 0.8, cy + Math.sin(na) * R * 0.8); g.stroke();
  }
}
