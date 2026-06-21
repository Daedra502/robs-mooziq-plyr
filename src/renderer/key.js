// Musical-key utilities for harmonic mixing (Camelot wheel). Used by the shuffle
// (cohesive key ordering) and available to the crossfade framework.

// note+mode -> Camelot code. Sharps and flats both mapped.
const CAMELOT = {
  // Major (B ring)
  'Bmaj': '1B', 'F#maj': '2B', 'Gbmaj': '2B', 'Dbmaj': '3B', 'C#maj': '3B',
  'Abmaj': '4B', 'Ebmaj': '5B', 'D#maj': '5B', 'Bbmaj': '6B', 'A#maj': '6B',
  'Fmaj': '7B', 'Cmaj': '8B', 'Gmaj': '9B', 'Dmaj': '10B', 'Amaj': '11B', 'Emaj': '12B',
  // Minor (A ring)
  'Abmin': '1A', 'G#min': '1A', 'Ebmin': '2A', 'D#min': '2A', 'Bbmin': '3A', 'A#min': '3A',
  'Fmin': '4A', 'Cmin': '5A', 'Gmin': '6A', 'Dmin': '7A', 'Amin': '8A', 'Emin': '9A',
  'Bmin': '10A', 'F#min': '11A', 'Gbmin': '11A', 'Dbmin': '12A', 'C#min': '12A',
};

// Parse a tag key string into { n, letter } on the Camelot wheel, or null.
// Accepts Camelot ("8A", "12B"), and notation ("Am", "F# minor", "C", "Bbm").
export function camelot(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  let m = s.match(/^(\d{1,2})\s*([ABab])$/);
  if (m) {
    const n = +m[1];
    if (n >= 1 && n <= 12) return { n, letter: m[2].toUpperCase() };
    return null;
  }

  m = s.match(/^([A-Ga-g])([#b♯♭]?)\s*(.*)$/);
  if (!m) return null;
  const note = m[1].toUpperCase() + (m[2] ? m[2].replace('♯', '#').replace('♭', 'b') : '');
  const rest = m[3].toLowerCase();
  const minor = /^(m|min|minor|-)/.test(rest) && !/^maj/.test(rest);
  const code = CAMELOT[note + (minor ? 'min' : 'maj')];
  if (!code) return null;
  const mm = code.match(/^(\d{1,2})([AB])$/);
  return { n: +mm[1], letter: mm[2] };
}

const wheelDist = (a, b) => {
  const d = Math.abs(a - b);
  return Math.min(d, 12 - d);
};

// Lower = more harmonically compatible (0 = identical key).
export function keyDistance(a, b) {
  if (!a || !b) return 6;
  if (a.n === b.n && a.letter === b.letter) return 0; // same
  if (a.n === b.n) return 1;                           // relative major/minor
  const d = wheelDist(a.n, b.n);
  return a.letter === b.letter ? d : d + 1;            // adjacency on same ring is smoothest
}

function fisherYates(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Randomized but harmonically cohesive ordering: greedily chain tracks by key
// compatibility, with random tie-breaking; keyless tracks are sprinkled in.
export function harmonicShuffle(tracks) {
  const pool = fisherYates([...tracks]);
  const keyed = pool.filter((t) => camelot(t.key));
  const unkeyed = pool.filter((t) => !camelot(t.key));
  if (keyed.length < 2) return pool;

  const result = [keyed.shift()];
  while (keyed.length) {
    const cur = camelot(result[result.length - 1].key);
    let best = 0;
    let bestScore = Infinity;
    for (const i of fisherYates([...keyed.keys()])) {
      const s = keyDistance(cur, camelot(keyed[i].key));
      if (s < bestScore) { bestScore = s; best = i; if (s === 0) break; }
    }
    result.push(keyed.splice(best, 1)[0]);
  }

  for (const t of unkeyed) {
    result.splice(Math.floor(Math.random() * (result.length + 1)), 0, t);
  }
  return result;
}
