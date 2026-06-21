---
name: electron-run-as-node-gotcha
description: Launching this Electron app from the Claude/VSCode terminal needs ELECTRON_RUN_AS_NODE cleared
metadata:
  type: project
---

The Claude Code / VSCode integrated terminal exports `ELECTRON_RUN_AS_NODE=1`
(VSCode is itself Electron). This makes `npm start` / `electron .` run the app's
Electron binary as **plain Node**, so `require('electron')` returns a path string
and `app`, `ipcMain`, `BrowserWindow`, etc. are all `undefined` — the main process
crashes immediately (e.g. `Cannot read properties of undefined (reading 'handle')`).

**Fix when launching from this terminal:** clear the var first, e.g. in PowerShell
`Remove-Item Env:\ELECTRON_RUN_AS_NODE` before `npm start`. A normal user terminal
does not have this set, so `npm start` works there as-is. This is an environment
artifact, not an app bug.
