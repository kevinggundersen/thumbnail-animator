# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Thumbnail Animator is a single-service Electron desktop app for browsing and viewing media files (images/videos) with animated thumbnails. There is no backend, no database server, and no external services — everything runs in a single Electron process.

### Running the app

```bash
DISPLAY=:1 npx electron . --no-sandbox
```

- `--no-sandbox` is required in the Cloud Agent container environment.
- `DISPLAY=:1` targets the Xvfb virtual display already running in the VM.
- The dbus errors in the console (`Failed to connect to the bus`) are expected and harmless in this environment.
- The app creates an `electron-cache/` directory in the workspace root for window state and IndexedDB data.

### Scripts (from `package.json`)

| Command | Purpose |
|---|---|
| `npm start` | Launch app (alias for `electron .`) |
| `npm run build` | Build distributable via electron-builder |
| `npm run dist` | Build without publishing |

### Lint / Test

- **No ESLint or linter** is configured in this project.
- **No automated tests** exist (`npm test` just echoes an error and exits 1).
- The user has noted: **do not run .NET projects** — this is a pure JavaScript/Electron app, so this doesn't apply here.

### Gotchas

- `ffprobe` (from FFmpeg) is auto-detected at startup. If missing, video dimension detection falls back to on-load detection. Not blocking.
- The app only shows media files (images/videos) in its grid view. Non-media files (JS, CSS, etc.) are not displayed as thumbnails — only folders appear when browsing a code directory.
- IndexedDB LevelDB lock errors may appear in logs if a previous Electron instance didn't shut down cleanly. These are non-fatal and resolve on the next clean start.
