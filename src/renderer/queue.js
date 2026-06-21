// Explicit play queue. Holds an ordered list of tracks and the index of the one
// playing. Pure state + notifications; app.js drives the engine from it.
export class Queue {
  constructor() {
    this.items = [];
    this.index = -1;
    this.onChange = null;
  }

  _changed() { this.onChange?.(); }

  current() { return this.index >= 0 ? this.items[this.index] : null; }
  peekNext() { return this.items[this.index + 1] || null; }
  hasNext() { return this.index + 1 < this.items.length; }
  count() { return this.items.length; }

  // Replace the whole queue (e.g. play a folder, or a shuffled set).
  setAll(tracks, startIndex = 0) {
    this.items = [...tracks];
    this.index = this.items.length ? Math.max(0, Math.min(startIndex, this.items.length - 1)) : -1;
    this._changed();
    return this.current();
  }

  add(track) {
    this.items.push(track);
    if (this.index === -1) this.index = 0;
    this._changed();
  }

  // Insert right after the current track ("play next").
  addNext(track) {
    if (this.index === -1) { this.items.push(track); this.index = 0; }
    else this.items.splice(this.index + 1, 0, track);
    this._changed();
  }

  // Insert after current and jump to it (used when a queue already exists).
  playNowInsert(track) {
    if (this.index === -1) { this.items = [track]; this.index = 0; }
    else { this.items.splice(this.index + 1, 0, track); this.index += 1; }
    this._changed();
    return this.current();
  }

  removeAt(i) {
    if (i < 0 || i >= this.items.length) return;
    this.items.splice(i, 1);
    if (i < this.index) this.index -= 1;
    else if (i === this.index && this.index >= this.items.length) this.index = this.items.length - 1;
    this._changed();
  }

  jumpTo(i) {
    if (i < 0 || i >= this.items.length) return null;
    this.index = i;
    this._changed();
    return this.current();
  }

  next() {
    if (!this.hasNext()) return null;
    this.index += 1;
    this._changed();
    return this.current();
  }

  prev() {
    if (this.index <= 0) return null;
    this.index -= 1;
    this._changed();
    return this.current();
  }

  clear() { this.items = []; this.index = -1; this._changed(); }
}
