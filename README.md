# Music Player

A desktop music player for your own files, with a rack of real-time visualizers —
in the spirit of the old skinnable players like Winamp and foobar2000.

You point it at the folders where your music lives, browse them like a file
explorer, and play your tracks. While the music plays, the screen fills with
visuals that react to the sound, and you can re-theme the whole thing with a click.

No accounts, no streaming, no internet — it just plays the audio files already on
your computer.

## What it does

- **Plays your local music** — mp3, flac, wav, ogg, m4a/aac, opus, and more.
- **Browses your folders** like a file explorer, with sortable, searchable columns
  showing album art, title, artist, album, length, BPM, and musical key.
- **A familiar player console** at the bottom: play / stop / next / previous,
  seek, volume, a scrolling title, and a little bouncing spectrum display.
- **A play queue** — add tracks, reorder what plays next, jump around, or clear it.
- **Track history** — a running log of what you've played, so you can replay or
  re-queue anything.
- **Smooth auto-transitions** — tracks blend into each other with a 10-second
  crossfade, like a radio segue.
- **Smart shuffle** — builds a set ordered by which keys sound good together, so a
  shuffled playlist still flows nicely. There's also a "suggested next" pick.
- **Real-time visualizers** — waveform, spectrum, spectrogram, stereo field,
  particles, and several artistic modes (Black & White, BZ Reaction, Sacred
  Geometry, Esoteric). Plus an always-on glowing window border that pulses to the
  music.
- **Six skins** — Neon, Classic, Vaporwave, Terminal, Amber, and Ruby. Pick one
  and it sticks.
- Your last folder, volume, and chosen visualizer are remembered between sessions.

## Try it on your own machine

You'll need [Node.js](https://nodejs.org/) 18 or newer installed.

```sh
# 1. Get the code
git clone https://github.com/Daedra502/music-player.git
cd music-player

# 2. Install and launch
npm install
npm start
```

That opens the player. Click **Open…** (or drag a folder onto the window) to point
it at your music, and press play.

> Prefer a double-click app instead of running it from a terminal? You can build a
> standalone Windows `.exe` (installer or portable) — see [BUILD.md](BUILD.md).

## Using it

- **Find your music** — click **Open…** or drag a folder onto the window. Click
  folders to go in; use **Up** or the breadcrumbs to go back.
- **Play a track** — double-click it, or hover a row and use **▶** (play now),
  **⤴** (play next), or **＋** (add to queue).
- **Sort & search** — click a column header to sort (click again to reverse); the
  search box filters the current folder.
- **Queue & History** — the buttons at the top-right open the play queue and the
  history of what you've played.
- **Shuffle** — **🔀 Shuffle** builds a key-matched set from the current folder.
- **Visualizers & skins** — pick a visualizer from the buttons (including **Off** to
  save battery), and cycle skins with **🎨 Skin** in the top bar.
- **Keyboard** — **Spacebar** plays/pauses.

## Under the hood

This is an [Electron](https://www.electronjs.org/) app using the browser's Web Audio
API, with a deliberately tiny dependency footprint. If you want the technical design
— the audio graph, the crossfade engine, and how to add your own visualizer — see
[ARCHITECTURE.md](ARCHITECTURE.md).

## License

[MIT](#) — free to use, change, and share.
