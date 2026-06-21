import { camelot } from './key.js';

// File-explorer-style library view: folder navigation + a sortable, searchable
// column table (art / title / artist / album / length / bpm / key). It owns no
// playback state; row actions report up to app.js via callbacks.
//
// Columns are defined once and shared by the header and the rows so they stay
// aligned (see --cols in style.css).
const COLUMNS = [
  { key: 'title', label: 'Title' },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'duration', label: 'Len' },
  { key: 'bpm', label: 'BPM' },
  { key: 'key', label: 'Key' },
];

export class Browser {
  constructor(opts) {
    Object.assign(this, opts); // listEl, crumbsEl, headEl, upBtn, statusEl, searchInput, callbacks
    this.listing = null;
    this.selected = -1;
    this.playingPath = null;
    this.query = '';
    this.sort = { key: 'title', dir: 1 };

    this.upBtn.addEventListener('click', () => this.up());
    this.searchInput.addEventListener('input', () => {
      this.query = this.searchInput.value.trim().toLowerCase();
      this._renderEntries();
    });
    this._buildHeader();

    // Lazy album-art loading for visible rows only.
    this._artObserver = new IntersectionObserver((entries, obs) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const img = e.target;
        obs.unobserve(img);
        window.api.getArt(img.dataset.path).then((url) => {
          if (url) img.src = url; else img.classList.add('noart');
        });
      }
    }, { root: this.listEl });
  }

  async navigate(dirPath) {
    if (!dirPath) return;
    this.statusEl.textContent = 'Opening…';
    const listing = await window.api.listDir(dirPath);
    if (!listing) { this.statusEl.textContent = "Can't open that folder."; return; }
    this.listing = listing;
    this.selected = -1;
    this.searchInput.value = '';
    this.query = '';
    this._renderCrumbs();
    this._renderEntries();
    this.onNavigate?.(listing.path);
  }

  up() { if (this.listing?.parent) this.navigate(this.listing.parent); }

  setPlaying(path) { this.playingPath = path; this._refreshStates(); }

  // The currently displayed (filtered + sorted) files — the play context.
  files() { return this._displayed(); }

  // The single-clicked (highlighted) track, for loading onto a DJ deck.
  selectedTrack() {
    const files = this._displayed();
    return this.selected >= 0 && this.selected < files.length ? files[this.selected] : null;
  }

  // --- internals -------------------------------------------------------------

  _buildHeader() {
    this.headEl.innerHTML = '<span class="th art"></span>';
    for (const c of COLUMNS) {
      const th = document.createElement('span');
      th.className = 'th ' + c.key;
      th.dataset.sort = c.key;
      th.textContent = c.label;
      th.addEventListener('click', () => this._setSort(c.key));
      this.headEl.appendChild(th);
    }
    this._markSort();
  }

  _setSort(key) {
    if (this.sort.key === key) this.sort.dir *= -1;
    else this.sort = { key, dir: 1 };
    this._markSort();
    this._renderEntries();
  }

  _markSort() {
    for (const th of this.headEl.querySelectorAll('.th[data-sort]')) {
      const active = th.dataset.sort === this.sort.key;
      th.classList.toggle('sorted', active);
      th.dataset.arrow = active ? (this.sort.dir > 0 ? '▲' : '▼') : '';
    }
  }

  _displayed() {
    let files = this.listing?.files ?? [];
    if (this.query) {
      const q = this.query;
      files = files.filter((t) =>
        (t.title || t.name).toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q));
    }
    const { key, dir } = this.sort;
    return [...files].sort((a, b) => dir * this._cmp(a, b, key));
  }

  _cmp(a, b, key) {
    if (key === 'duration' || key === 'bpm') return (a[key] || 0) - (b[key] || 0);
    if (key === 'key') {
      const ca = camelot(a.key);
      const cb = camelot(b.key);
      if (ca && cb) return ca.n - cb.n || ca.letter.localeCompare(cb.letter);
      if (ca) return -1;
      if (cb) return 1;
      return 0;
    }
    const va = (key === 'title' ? a.title || a.name : a[key]) || '';
    const vb = (key === 'title' ? b.title || b.name : b[key]) || '';
    return va.localeCompare(vb, undefined, { sensitivity: 'base' });
  }

  _renderCrumbs() {
    const l = this.listing;
    this.crumbsEl.innerHTML = '';
    l.crumbs.forEach((c, i) => {
      if (i) {
        const sep = document.createElement('span');
        sep.className = 'crumb-sep';
        sep.textContent = '›';
        this.crumbsEl.appendChild(sep);
      }
      const b = document.createElement('button');
      b.className = 'crumb';
      b.textContent = c.name;
      b.title = c.path;
      b.addEventListener('click', () => this.navigate(c.path));
      this.crumbsEl.appendChild(b);
    });
    this.upBtn.disabled = !l.parent;
  }

  _renderEntries() {
    const l = this.listing;
    this.listEl.innerHTML = '';
    if (!l) return;

    const folders = this.query
      ? l.dirs.filter((d) => d.name.toLowerCase().includes(this.query))
      : l.dirs;
    for (const d of folders) {
      const li = document.createElement('li');
      li.className = 'entry folder';
      li.innerHTML = `<span class="icon">📁</span><span class="fname"></span>`;
      li.querySelector('.fname').textContent = d.name;
      li.addEventListener('click', () => this.navigate(d.path));
      this.listEl.appendChild(li);
    }

    const files = this._displayed();
    files.forEach((t, i) => this.listEl.appendChild(this._fileRow(t, files, i)));

    this._refreshStates();
    this.statusEl.textContent = `${folders.length} folder${folders.length === 1 ? '' : 's'}, ${files.length} track${files.length === 1 ? '' : 's'}`;
  }

  _fileRow(t, files, i) {
    const li = document.createElement('li');
    li.className = 'entry file';
    li.dataset.path = t.path;

    const art = document.createElement('img');
    art.className = 'art';
    art.dataset.path = t.path;
    art.alt = '';
    li.appendChild(art);
    this._artObserver.observe(art);

    li.appendChild(cell('c-title', t.title || t.name));
    li.appendChild(cell('c-artist', t.artist));
    li.appendChild(cell('c-album', t.album));
    li.appendChild(cell('c-len', t.duration ? fmtDur(t.duration) : ''));
    li.appendChild(cell('c-bpm', t.bpm ? String(t.bpm) : ''));
    li.appendChild(cell('c-key', t.key ? camelotLabel(t.key) : ''));

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.appendChild(actionBtn('▶', 'Play now', (e) => { e.stopPropagation(); this.onPlayNow?.(files, i); }));
    actions.appendChild(actionBtn('⤴', 'Play next', (e) => { e.stopPropagation(); this.onPlayNext?.(t); }));
    actions.appendChild(actionBtn('＋', 'Add to queue', (e) => { e.stopPropagation(); this.onQueue?.(t); }));
    li.appendChild(actions);

    li.addEventListener('click', () => { this.selected = i; this._refreshStates(); });
    li.addEventListener('dblclick', () => this.onPlayNow?.(files, i));

    // Draggable onto a DJ deck (Mix mode).
    li.draggable = true;
    li.addEventListener('dragstart', (e) => { e.dataTransfer.effectAllowed = 'copy'; this.onDragTrack?.(t); });
    li.addEventListener('dragend', () => this.onDragEnd?.());
    return li;
  }

  _refreshStates() {
    const fileEls = [...this.listEl.querySelectorAll('.entry.file')];
    fileEls.forEach((el, i) => {
      el.classList.toggle('selected', i === this.selected);
      el.classList.toggle('playing', el.dataset.path === this.playingPath);
    });
  }
}

function cell(cls, text) {
  const s = document.createElement('span');
  s.className = 'cell ' + cls;
  s.textContent = text;
  s.title = text;
  return s;
}

function actionBtn(label, title, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function fmtDur(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

// Show "Am · 8A" style — original tag plus Camelot when parseable.
function camelotLabel(raw) {
  const c = camelot(raw);
  return c ? `${c.n}${c.letter}` : raw;
}
