# Building & Distributing

This is an **Electron desktop app**, packaged with
[electron-builder](https://www.electron.build/) into native Windows executables.
(Docker is intentionally *not* used — a container can't show a window, reach the
GPU, or play audio out the speakers on Windows, so it can't run this app.)

## Build

```sh
npm install        # one time
npm run dist:win   # builds the installer + portable exe into dist/
```

Output in `dist/`:

| File | What it is |
| --- | --- |
| `Music Player-<ver>-x64.exe` | **Installer** — double-click to install. Adds a Desktop + Start-menu shortcut. |
| `Music Player-<ver>-portable.exe` | **Portable** — single file, no install, just run it. |

Other scripts: `npm start` (run from source), `npm run pack` (unpacked dir only).

## Sending to friends

Hand them **either** `.exe`. They double-click — no Node, no Docker, nothing to
install. Because the build is **unsigned**, Windows SmartScreen shows a
"Windows protected your PC" prompt the first time: *More info → Run anyway*.
(To remove that prompt you'd need a paid Authenticode code-signing certificate.)

## Troubleshooting the build

**`Cannot create symbolic link … A required privilege is not held by the client`**

electron-builder downloads a code-signing toolkit whose archive contains macOS
symlinks, and Windows blocks creating symlinks without elevation. We don't sign
on Windows, so pre-extract the cache **without** the macOS folder (run once):

```sh
C="$LOCALAPPDATA/electron-builder/Cache/winCodeSign"
7za x "$C/"*.7z -o"$C/winCodeSign-2.6.0" -snld -x!darwin -y
```

(The `7za.exe` shipped at `node_modules/7zip-bin/win/x64/7za.exe` works.)
Alternatively, enable Windows **Developer Mode**, or run the build in an
elevated terminal.
