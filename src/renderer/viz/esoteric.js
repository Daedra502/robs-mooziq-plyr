import { Visualizer } from './interface.js';

// "Esoteric" — G Jones-inspired tessellating monochrome glyphs that flow across
// the canvas in dynamic tile grids. Geometric layers (hexagons, fractals, grids)
// shift and morph with audio energy. Large, visible glyphs build patterns that
// interact and cascade, creating ritualistic depth. Bass drives horizontal flow;
// treble modulates density; mid shapes the tile transformations.
export class Esoteric extends Visualizer {
  static id = 'esoteric';
  static label = 'Esoteric';

  init(canvas, context) {
    super.init(canvas, context);
    this.bassAvg = 0;
    this.midAvg = 0;
    this.trebleAvg = 0;
    this.beatHold = 0;
    this.beatEnergy = 0;
    this.scrollX = 0;                        // horizontal scroll offset
    this.scrollY = 0;                        // vertical scroll offset
    this.invert = 0;                         // flash inversion counter
    this.fractalDepth = 0;                   // fractal iteration depth
  }

  update(frame) {
    const g = this.g;
    const w = this.w;
    const h = this.h;
    const dt = frame.timing.delta / 16.67;
    const freq = frame.freq;

    // --- Energy bands -------------------------------------------------------
    let bass = 0, mid = 0, treble = 0;
    for (let i = 0; i < 8; i++) bass += freq[i];
    for (let i = 8; i < 64; i++) mid += freq[i];
    for (let i = 64; i < freq.length; i++) treble += freq[i];

    this.bassAvg += (bass - this.bassAvg) * 0.12;
    this.midAvg += (mid - this.midAvg) * 0.12;
    this.trebleAvg += (treble - this.trebleAvg) * 0.12;

    // --- Beat detection ----------------------------------------------------
    const beat = this.bassAvg > 0.2 && this.beatHold <= 0;
    this.beatHold = beat ? 10 : this.beatHold - dt;
    if (beat) {
      this.invert = 3;
      this.beatEnergy = 1;
    }
    this.invert = Math.max(0, this.invert - dt);
    this.beatEnergy = Math.max(0, this.beatEnergy - dt * 0.1);

    const inverted = this.invert > 0;
    const ink = inverted ? '#000' : '#fff';
    const paper = inverted ? '#fff' : '#000';

    // Clear canvas
    g.fillStyle = paper;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = ink;
    g.fillStyle = ink;

    // --- Scrolling driven by bass and mid ------------------------------------
    this.scrollX += this.bassAvg * 0.8 * dt;
    this.scrollY += this.midAvg * 0.4 * dt;

    // Tile grid parameters: base size + treble modulation
    const baseTileSize = 60;
    const tileSize = baseTileSize + this.trebleAvg * 40;
    const tilesX = Math.ceil(w / tileSize) + 2;
    const tilesY = Math.ceil(h / tileSize) + 2;

    // Draw layered patterns
    this._drawHexagons(g, w, h, ink, this.scrollX, this.scrollY);
    this._drawTileGrid(g, w, h, ink, tileSize, tilesX, tilesY, frame);
    this._drawFractalLayer(g, w, h, ink, this.beatEnergy);
    this._drawGlyphTiles(g, w, h, ink, tileSize, tilesX, tilesY, frame);
    this._drawGlitchLines(g, w, h, ink, beat);

    g.globalAlpha = 1;
  }

  _drawHexagons(g, w, h, ink, scrollX, scrollY) {
    // Hexagonal tessellation layer
    const hexSize = 40;
    const spacing = hexSize * 1.732;          // sqrt(3) for hexagon packing
    g.lineWidth = 0.8;
    g.globalAlpha = 0.25;

    const startX = -hexSize - (scrollX % spacing);
    const startY = -hexSize - (scrollY % spacing);

    for (let y = startY; y < h + hexSize; y += spacing) {
      for (let x = startX; x < w + hexSize; x += spacing * 0.5) {
        const ox = (Math.floor(y / spacing) % 2) * (spacing * 0.25);
        this._drawHexagon(g, x + ox, y, hexSize, ink);
      }
    }
  }

  _drawHexagon(g, cx, cy, size, ink) {
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = cx + Math.cos(a) * size;
      const y = cy + Math.sin(a) * size;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath();
    g.stroke();
  }

  _drawTileGrid(g, w, h, ink, tileSize, tilesX, tilesY, frame) {
    // Main grid overlay with varying opacity
    g.lineWidth = 1;
    g.globalAlpha = 0.4 + this.midAvg * 0.3;

    const offsetX = -Math.floor(this.scrollX / tileSize) * tileSize;
    const offsetY = -Math.floor(this.scrollY / tileSize) * tileSize;

    for (let i = 0; i <= tilesX; i++) {
      const x = offsetX + i * tileSize;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    for (let i = 0; i <= tilesY; i++) {
      const y = offsetY + i * tileSize;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
  }

  _drawFractalLayer(g, w, h, ink, beatEnergy) {
    // Fractal-like recursive pattern that grows on beats
    const depth = Math.floor(beatEnergy * 4);
    if (depth === 0) return;

    g.lineWidth = 0.5 + beatEnergy * 1.5;
    g.globalAlpha = 0.3 + beatEnergy * 0.4;

    const drawFractal = (x, y, size, d) => {
      if (d === 0 || size < 2) return;
      const s2 = size / 3;
      // Draw cross pattern
      g.beginPath();
      g.moveTo(x - s2, y);
      g.lineTo(x + s2, y);
      g.moveTo(x, y - s2);
      g.lineTo(x, y + s2);
      g.stroke();
      // Recurse to corners
      for (let dy = -1; dy <= 1; dy += 2) {
        for (let dx = -1; dx <= 1; dx += 2) {
          drawFractal(x + dx * size * 0.4, y + dy * size * 0.4, s2, d - 1);
        }
      }
    };

    const sz = 80 + beatEnergy * 60;
    for (let x = 0; x < w; x += w * 0.4) {
      for (let y = 0; y < h; y += h * 0.4) {
        drawFractal(x, y, sz, depth);
      }
    }
  }

  _drawGlyphTiles(g, w, h, ink, tileSize, tilesX, tilesY, frame) {
    g.lineWidth = 1.2;
    g.globalAlpha = 0.7 + this.trebleAvg * 0.3;

    const offsetX = this.scrollX % tileSize;
    const offsetY = this.scrollY % tileSize;
    const seed = Math.floor(frame.timing.elapsed * 0.001);

    for (let iy = 0; iy < tilesY; iy++) {
      for (let ix = 0; ix < tilesX; ix++) {
        const x = ix * tileSize - offsetX;
        const y = iy * tileSize - offsetY;
        const cx = x + tileSize * 0.5;
        const cy = y + tileSize * 0.5;

        // Hash-based glyph selection
        const hash = (seed + ix * 73 + iy * 97) % 6;
        const state = (hash + Math.floor(this.bassAvg * 3)) % 6;

        // Draw glyph, small enough to fit in tile
        const glyphSize = Math.min(tileSize * 0.35, 20 + this.trebleAvg * 10);
        g.save();
        g.translate(cx, cy);
        g.rotate((ix + iy) * 0.1 + this.midAvg * 0.05);
        this._drawGlyph(g, state, 0, 0, glyphSize);
        g.restore();

        // Draw tile border on high energy
        if (this.bassAvg > 0.4) {
          g.strokeStyle = ink;
          g.globalAlpha = this.bassAvg * 0.5;
          g.strokeRect(x, y, tileSize, tileSize);
        }
      }
    }
  }

  _drawGlitchLines(g, w, h, ink, beat) {
    if (!beat) return;
    g.globalAlpha = 0.5 + Math.random() * 0.5;
    g.lineWidth = 1 + Math.random() * 2;

    const lineCount = 1 + Math.floor(this.bassAvg * 3);
    for (let i = 0; i < lineCount; i++) {
      const y = Math.random() * h;
      const height = Math.random() * 20 + 5;
      const gaps = 2 + Math.floor(Math.random() * 3);

      let x = 0;
      while (x < w) {
        const segLen = Math.random() * 50 + 30;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(Math.min(w, x + segLen), y);
        g.stroke();
        x += segLen + Math.random() * 20;
      }
    }
  }

  // Draw one of 6 esoteric glyphs
  _drawGlyph(g, state, x, y, size) {
    g.save();
    g.translate(x, y);
    const s = size;

    switch (state % 6) {
      case 0: // Crosshair / target
        g.beginPath();
        g.moveTo(-s, 0);
        g.lineTo(s, 0);
        g.moveTo(0, -s);
        g.lineTo(0, s);
        for (let i = 0; i < 3; i++) {
          const r = s * (0.3 + i * 0.25);
          g.beginPath();
          g.arc(0, 0, r, 0, Math.PI * 2);
        }
        g.stroke();
        break;

      case 1: // Spiral / vortex
        g.beginPath();
        for (let i = 0; i < 4; i++) {
          const t = (i / 4) * Math.PI * 2;
          const r = s * 0.2 + i * (s * 0.2);
          const px = Math.cos(t) * r;
          const py = Math.sin(t) * r;
          i ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.stroke();
        // Draw radial spokes
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
          g.beginPath();
          g.moveTo(0, 0);
          g.lineTo(Math.cos(a) * s, Math.sin(a) * s);
          g.stroke();
        }
        break;

      case 2: // Hourglass / infinity
        g.beginPath();
        g.moveTo(-s * 0.6, -s * 0.6);
        g.lineTo(s * 0.6, s * 0.6);
        g.moveTo(s * 0.6, -s * 0.6);
        g.lineTo(-s * 0.6, s * 0.6);
        g.stroke();
        // Diamonds at ends
        for (let pos of [[-s * 0.7, -s * 0.7], [s * 0.7, s * 0.7]]) {
          g.beginPath();
          g.moveTo(pos[0], pos[1] - s * 0.15);
          g.lineTo(pos[0] + s * 0.15, pos[1]);
          g.lineTo(pos[0], pos[1] + s * 0.15);
          g.lineTo(pos[0] - s * 0.15, pos[1]);
          g.closePath();
          g.fill();
        }
        break;

      case 3: // Ripples / waves
        for (let i = 0; i < 4; i++) {
          const r = s * 0.15 + i * (s * 0.18);
          g.beginPath();
          g.arc(0, 0, r, 0, Math.PI * 2);
          g.stroke();
        }
        // Horizontal wave through center
        g.beginPath();
        for (let px = -s; px <= s; px += s * 0.2) {
          const py = Math.sin(px * 0.05) * s * 0.25;
          px === -s ? g.moveTo(px, py) : g.lineTo(px, py);
        }
        g.stroke();
        break;

      case 4: // Eye / aperture (Early Mac-inspired)
        // Outer iris
        g.beginPath();
        g.ellipse(0, 0, s * 0.7, s * 0.5, 0, 0, Math.PI * 2);
        g.stroke();
        // Inner pupil
        g.beginPath();
        g.arc(0, 0, s * 0.25, 0, Math.PI * 2);
        g.fill();
        // Lids
        g.beginPath();
        g.moveTo(-s * 0.7, 0);
        g.lineTo(-s * 0.9, -s * 0.3);
        g.lineTo(s * 0.9, -s * 0.3);
        g.lineTo(s * 0.7, 0);
        g.stroke();
        break;

      case 5: // Cubes / 3D structure
        // Isometric cube-like forms
        const c = s * 0.4;
        // Front face
        g.beginPath();
        g.moveTo(-c, -c);
        g.lineTo(c, -c);
        g.lineTo(c, c);
        g.lineTo(-c, c);
        g.closePath();
        g.stroke();
        // Back edges (isometric)
        const off = c * 0.5;
        g.beginPath();
        g.moveTo(-c + off, -c - off);
        g.lineTo(c + off, -c - off);
        g.lineTo(c + off, c - off);
        g.lineTo(-c + off, c - off);
        g.closePath();
        g.stroke();
        // Connecting edges
        g.beginPath();
        g.moveTo(-c, -c);
        g.lineTo(-c + off, -c - off);
        g.moveTo(c, -c);
        g.lineTo(c + off, -c - off);
        g.moveTo(c, c);
        g.lineTo(c + off, c - off);
        g.moveTo(-c, c);
        g.lineTo(-c + off, c - off);
        g.stroke();
        break;
    }

    g.restore();
  }

  resize(w, h) {
    super.resize(w, h);
  }

  destroy() {}
}
