# Modernization proposal

> **Status (end of the modernization pass):** Phases 0-4 and 6 are done; Phase 5 is partial (dead code, settings schema, esbuild bundle and type-check baseline done; the ES-module split of the big files, the renderer.js domain split, the event bus, and the Phase 4 deferrals, namely `@layer`, `<dialog>`, the schema-driven settings UI and `light-dark()`, remain). Every decision, measurement and deferral is in `DECISIONS.md`. A later round fixed navigation state stability (tab-keyed cache/history writes, loads that outlive their tab, back/forward index moved on success, cancelled scans no longer rendered as empty folders) with an adversarial timing test, and made video-heavy folders smooth: H.264 grid proxies for large videos and GIFs, videos attached only once the grid is at rest, deferred media-pipeline release, and parkable images kept off disk (see "Many videos on screen" in DECISIONS.md). A WebCodecs playback engine (mp4-demux.js, webcodecs-worker.js, webcodecs-player.js) then replaced `<video>` elements for proxied cards, decoding in worker threads onto canvases: a whole 2560×1440 screen of 200 cards animates where Chromium's media pipeline capped at ~110; the engine paints every cell into one sheet canvas and the budget caps decoded frames per second, which is what keeps the GPU process and the renderer main thread free (see "WebCodecs playback engine" in DECISIONS.md). Verification tools: `npm run lint`, `npm test`, `npm run typecheck` (advisory), `node scripts/perf-smoke.js <folder>`, `node scripts/nav-smoke.js` and `node scripts/nav-stress.js <profile> <tree>`.

Deep-dive review of the codebase as of commit `fc3edd6` (v1.11.3). Four parallel reviews covered the renderer core, the main process and backend, the CSS/HTML, and the feature modules. Every finding marked **verified** was confirmed by reading the code directly or by running the app; the rest came from the reviews and were spot-checked.

## 1. Verdict

The app is not naive code. The virtual-scroll engine, the worker-backed SQLite layer, the Piscina pools, the Rust scanner, and the IPC envelope are all sound. The "sluggish, janky, buggy" feel comes from a short list of specific, fixable causes layered on top of a structure that has outgrown itself:

- **Main process freezes.** All 30 native Rust exports are synchronous. Thumbnail batches, hashing, and dimension passes block the main process, and every other IPC call queues behind them.
- **Chromium raster flags that fight the compositor.** `disable-partial-raster`, `disable-zero-copy`, `enable-low-res-tiling`, `disable-accelerated-2d-canvas`, `disable-software-rasterizer` are all live.
- **A full grid re-layout every 120 ms while a folder loads.** Cards visibly jump until dimensions finish streaming.
- **Up to 120 muted videos autoplaying in the grid** (200 on the "high" profile), plus fully synchronous GIF/WebP decoding in the lightbox.
- **Real bugs**: a `ReferenceError` that can wedge navigation, a CLIP init race that loads the model and spins up a 4-worker pool twice, a duplicate `escapeHtml` whose deferred copy silently replaces the safe one, three unescaped filename interpolations into `innerHTML`, stale main-process caches after renames.
- **Structure**: 16k-line `renderer.js` with ~500 top-level globals and ~400 top-level functions, 25 classic `<script>` tags in one global scope, circular dependencies between every feature file, three overlapping grid renderers (one live, one dead, one hidden behind a secret shortcut), and two settings layers (one dead). 15 of 781 tests currently fail.

I recommend an incremental modernization in six phases, not a rewrite and not a framework migration. The hot core is good enough to keep. Rough total is on the order of several weeks of focused work; phases 1 and 2 alone should change how the app feels.

## 2. Findings

### 2.1 Main process (main.js, native-scanner, workers)

| # | Finding | Where | Status |
|---|---------|-------|--------|
| M1 | Every native export is a sync `#[napi] pub fn`; called on the main thread for thumbnails (batches of 50), BLAKE3 hashing, perceptual hashes, dimensions, directory scans. IPC bus stalls for the duration. | `native-scanner/src/lib.rs` (30 exports, no `AsyncTask`); `main.js:3313, 3453, 3689, 3806, 6052, 1575, 1639, 2207` | verified |
| M2 | Raster-crippling Chromium switches added for a VRAM leak. They force full re-raster per frame and disable zero-copy uploads. | `main.js:829-845` | verified |
| M3 | No scan cancellation. `scanId` only filters client-side; preload exposes only `ffmpeg-cancel`. Rapid folder clicks stack scans, dimension passes, and thumbnail batches. | `main.js:1961-2063`, `preload.js:52` | reviewed |
| M4 | `auto-hash-folder` BLAKE3-hashes every file synchronously on every folder load when linked duplicates is on. | `main.js:6013-6100`, `renderer-features.js:4033-4041` | reviewed |
| M5 | `HashWorkerPool` spawns up to 8 Piscina threads, each requiring `sharp`, at boot, for a rarely used feature. | `main.js:190`, `hash-pool.js:12-18` | reviewed |
| M6 | `clip-init` has no in-flight guard. Renderer does status-check-then-init at four sites; concurrent calls each load the model and create a `ClipPreprocessPool`. Startup log shows the pool initializing twice. | `main.js:4480-4530`, `renderer.js:3524, 3694, 10810, 11517` | verified |
| M7 | Thumbnails are PNG-encoded (slowest encoder, 5-10x the bytes of WebP). Cache was 2 GB at last startup; eviction runs only at startup + 3 s. | `lib.rs:792`, `main.js:439, 757-771` | verified (log) |
| M8 | chokidar `depth: 10` on whatever folder is open walks the whole subtree; one `folder-changed` IPC per event after batching. | `main.js:3133-3190` | reviewed |
| M9 | `_ipcCache` (ratings/pins/tags by path) is not invalidated on rename/batch-rename, `db-import-tags`, or `db-run-migration`. | `main.js:5829, 2449, 2560, 5964, 5820` | reviewed |
| M10 | `DatabaseProxy` watchdog is a no-op; if the worker never posts `ready`, every DB call hangs forever. No corruption recovery. | `database-proxy.js:68-82`, `database-worker.js:40` | reviewed |
| M11 | `getTagsForFiles` builds a dynamic `IN (?,?,...)` per call (re-prepared, breaks past 32,766 params); `siblingTags` uses `LIKE` that defeats its index. | `database.js:686-692, 334-342` | reviewed |
| M12 | Security: `shell.openExternal` with no scheme allowlist; `shell.openPath` unvalidated; most preload `on*` listeners hand the raw `IpcRendererEvent` to page code; plugins run with full Node via `require`; `disable-gpu-sandbox`. | `main.js:2618, 2620-2628, 833`, `preload.js:9-55`, `plugin-registry.js:280` | reviewed |
| M13 | Two ONNX runtimes shipped (transformers.js bundles one, native-scanner statically links `ort`). `fuse.js`, `gifuct-js`, `webpxmux` are both npm deps and vendored files; the npm copies are packaged for nothing. | `package.json`, `index.html:2543-2547` | reviewed |
| M14 | ~75 empty catches in main.js. Duplicate helpers: `getVideoDuration`, `getVideoDimensions`, `readImageHeader`, dHash, file-URL building x6. | various | reviewed |

### 2.2 Renderer core (renderer.js)

| # | Finding | Where | Status |
|---|---------|-------|--------|
| R1 | `scheduleStreamingLayoutRefresh` zeroes the layout cache and calls `vsRecalculate()` every 120 ms while dimension chunks arrive: full O(n) masonry re-layout per tick. | `renderer.js:12197-12206` | verified |
| R2 | `safeReject(error || ...)`: `error` is undeclared anywhere in scope. On a failed scan with no items this throws inside the callback, the promise never settles, `_navBusy` can stick. | `renderer.js:12451` | verified |
| R3 | `destroyImageElement` sets `img.src = ''` while the non-`once` `error` listener is still attached. Chromium fires `error` on an empty-string src, so each recycle can re-enter destroy, double-decrement `activeImageCount`, and push the card into `mediaToRetry`. Same shape for `<video>`. Needs a DevTools confirmation but the path is unguarded. | `renderer.js:8302, 7547, 8216, 7846` | verified (code path) |
| R4 | Cleanup/retry (`performCleanupCheck`, 212 lines, allocates Maps per run, `getBoundingClientRect` per retried card) is scheduled from four independent sources: scroll throttle, scroll settle, every IntersectionObserver callback, and an idle loop. | `renderer.js:4800, 8357, 5018, 1296` | reviewed |
| R5 | Three `scroll` listeners and three `resize` listeners on the same elements; one resize handler tears down and recreates the IntersectionObserver and re-observes every card. | `renderer.js:1296, 4796, 9531, 1308, 6503, 8394` | reviewed |
| R6 | `MAX_VIDEOS = 120` muted `<video>` elements autoplay when in view (60/200 by profile); `resumeThumbnailVideos` calls `play()` on every video in the container. | `renderer.js:61, 166-169, 5188-5195, 7716` | verified |
| R7 | Three grid renderers: `renderItems → vsInit` (live), `renderItemsProgressive` (183 lines, zero callers), canvas-grid.js (1,954 lines, off by default, toggled only by Ctrl+Shift+Alt+G, 25+ `window.CG.isEnabled()` branches in renderer.js). The pre-VS masonry engine with its ResizeObserver/MutationObserver still exists and is still called. | `renderer.js:6983, 7168, 6262, 6506, 6518`; `canvas-grid.js:34, 179` | verified |
| R8 | State: 506 top-level `let/const/var`, 397 top-level functions, 185 `getElementById` at load, 33 boolean flags, 63 `typeof X === 'function'` guards because load order decides what exists. 16 `let *Setting` mirrors of `appSettings` with 17 sync hooks: two sources of truth per setting. | `renderer.js:160-220` and throughout | reviewed |
| R9 | Blob URL leak in More-Like-This overlays (`_blobUrl` never set, revoke never fires). Unbounded: `_lbPaletteCache`, `_shownToastKeys`, `tabFolderScrollPositions`, `_normalizeCache`, `currentEmbeddings`. Dead: `tabDomCache`, `_previewStripCache`. | `renderer.js:3906, 15311, 1725, 3333, 4597, 2482, 3332, 3323` | reviewed |
| R10 | Unescaped `innerHTML` interpolation: `${searchTerm}`/`${currentFilter}`, `value="${tag.name}"`, `style="background:${tag.color}"`. 51 `.style.display` toggles instead of `.hidden`. | `renderer.js:7246-7247, 14168-14169, 13799, 14134` | reviewed |
| R11 | 23 fully empty catches, 22 `.catch(() => {})`, 26 `.then` without `.catch`, 31 of 55 `setTimeout` calls with no stored handle. 10 dead top-level functions. Longest functions: `loadVideos` 329 lines, `renderTagsManagement` 312, `vsCalculatePositions` 285, `createImageForCard` 274. | various | reviewed |
| R12 | ~33 distinct localStorage keys, versus 11 documented in CLAUDE.local.md. | throughout | reviewed |

### 2.3 Feature modules

| # | Finding | Where | Status |
|---|---------|-------|--------|
| F1 | `escapeHtml` is defined twice. The deferred `renderer-features.js` copy (DOM `textContent` trick, does not escape quotes, allocates a div per call) silently replaces the regex version used at 44 sites, several of which are inside `title="..."` attributes. | `renderer.js:11818`, `renderer-features.js:3475` | verified |
| F2 | Unescaped filename interpolation into `innerHTML` in favorites, recent files, and tab groups. A filename containing markup executes. | `renderer-features.js:862, 1232, 798` | reviewed |
| F3 | GIF decode: `decompressFrames(gif, true)` inflates every frame to RGBA synchronously on the main thread and keeps all patches alive. WebP: per-pixel JS loop per frame, synchronous. | `playback-controller.js:252-256, 314-346` | verified |
| F4 | Lightbox: no neighbour preloading; `navigateLightbox` rebuilds a filtered copy of all items per keypress; GIF fetch/decode has no stale-request guard so an older decode can overwrite a newer one; `_enhancedLightboxOnOpen` called twice for static images; `play()` without `.catch`. 22 document-level `keydown` listeners app-wide. | `lightbox.js:718-917, 985`, `renderer-features.js:3370, 3400` | reviewed |
| F5 | `settings.js` defines a proper `Settings` class (schema, batched writes, listeners, import/export) that is almost unused. `settings-ui.js` writes 33 raw localStorage keys and reaches into the class's private `_pendingWrites`. Thumbnail-quality change triggers a full folder reload; import/reset call `location.reload()`. | `settings.js`, `settings-ui.js:1003, 283, 2048`, `renderer.js:1532-1535` | reviewed |
| F6 | `renderer-features.js` is a dumping ground: 182 top-level functions, one 571-line async keydown handler with ~48 branches and `preventDefault` after `await`, a 410-line `initNewFeatures`, a 312-line ComfyUI parser, lightbox navigation living outside lightbox.js. Every feature file reads and writes renderer.js globals (renderer-features: 177 distinct globals, 1,072 refs). Circular: renderer ↔ features, renderer ↔ collections, lightbox ↔ features, lightbox ↔ context-menu, lightbox ↔ settings-ui. | `renderer-features.js:42-726, 4835-5251` | reviewed |
| F7 | `MutationObserver` with `subtree: true` on the whole settings modal reads `offsetParent` (layout) on every class flip and never disconnects. Permanent document `mousemove` listeners for sidebar resize, lightbox pan, perf dashboard. | `settings-ui.js:345-351`, `sidebar-tree.js:410`, `lightbox.js:1731` | reviewed |
| F8 | Unconditional timing `console.log` on every sidebar expand/toggle and in navigation; `new Error().stack` built per queued nav. | `sidebar-tree.js:161, 178, 380, 395`, `renderer.js:10388` | reviewed |
| F9 | Tests: 16 files cover only the modules with `module.exports` shims. Eight renderer modules are untestable because they execute `getElementById` at top level and bind to ~180 globals. 15 tests currently fail (schema version assertion 3 vs 5; `MediaControlBar` tests lack a `document`). | `test/`, `vitest.config.js` | verified (ran) |

### 2.4 CSS and HTML

| # | Finding | Where | Status |
|---|---------|-------|--------|
| C1 | `backdrop-filter: blur(4px)` on three full-viewport overlays (settings, lightbox, duplicate compare). Every frame of any video behind them re-blurs the viewport. | `styles.css:2286, 3758, 6580` | reviewed |
| C2 | `will-change: transform` unconditionally on every `.video-card`/`.folder-card`: one compositor layer per visible card. Hover swaps `box-shadow` and `z-index`, a full card repaint. | `styles.css:3059, 3095, 3240-3245, 3098-3103` | reviewed |
| C3 | Zoom tiers and hover variants keyed on `:root.zoom-*` classes. Toggling a class on `<html>` invalidates style for the whole document. | `styles.css:3473-3595`, `renderer-features.js:3314` | reviewed |
| C4 | 17 layout-affecting transitions (sidebar `width`, lightbox `margin-right`, panel `right`, progress `width`). `will-change: width` on progress fills is meaningless. | `styles.css:483, 3778, 3884, 5232, 1890, 1915, 3806` | reviewed |
| C5 | 970 KB of synchronous classic scripts before `DOMContentLoaded` (709 KB is renderer.js). No `type="module"`, no bundling. | `index.html:2536-2552` | verified |
| C6 | Settings modal is 1,390 lines of hand-written markup (54% of index.html): 45 copy-pasted toggle blocks, 41 range inputs with hand-written labels, 103 inline SVGs (icons.js exists), 31 inline `style=` attributes, 10 of them `display:none`. | `index.html:915-2305` | reviewed |
| C7 | 20 full-screen overlays with no `<dialog>`, no focus trap, `role="dialog"` on one. 52 icon-only buttons without `aria-label`. | `index.html` | reviewed |
| C8 | 38 literal hex colors outside `:root` (lightbox/slideshow `#000` backgrounds, etc.) break on light/custom themes. Dark theme palette duplicated between `themes.js:51-61` and `:root`. No `prefers-color-scheme` in CSS. | `styles.css:3714, 10576, 10744, 11174` | reviewed |
| C9 | Not used: `@container` (the zoom tiers and sidebar are exactly this case), `@layer` (would remove most of the 56 `!important`), CSS nesting, `light-dark()`, `<dialog>`, `popover`. Cards still use the `padding-bottom` aspect hack with 8 dead `.aspect-*` classes. | `styles.css:3030-3236` | reviewed |
| C10 | Positives to keep: tokens used ~2,400 times, duplication ~2%, dead CSS ~4%, no `transition: all`, `content-visibility`/`contain` already on cards and overlays. | | reviewed |

### 2.5 Tooling and project health

- No ESLint, Prettier, or EditorConfig. No type checking of any kind.
- CI only builds on tag push. Tests never run in CI.
- 15 of 781 tests fail on `main` today.
- Electron 39.2.5 installed; 44.5.1 is current. electron-builder 25 vs 26. chokidar 3 vs 5.
- `node_modules` is 1.1 GB (354 MB is `@huggingface/transformers`). `dist/` holds 2.7 GB of old builds.
- README still says Node 14, lists "Audio" as a filter type (removed in cd0c30e), and `AGENTS.md` says there are no tests.
- `CLAUDE.local.md` points `DEFAULT_SHORTCUTS` at renderer.js:16618; it is at settings-ui.js:1461.

## 3. Proposed plan

### Goals set by the owner

1. **Maximum animated thumbnails on screen** without overloading the machine. The media cap is therefore an adaptive budget, never a fixed low number, and the work makes each playing thumbnail cheaper rather than showing fewer of them.
2. **Safe to leave open in the background** while playing a game. When the window is blurred, minimized, or occluded the app must drop to near-zero CPU and GPU: all grid playback paused, no prefetch, hashing, CLIP, or thumbnail generation, worker pools idle-torn-down, timers throttled by Chromium as normal. Called "background mode" below.

Ordered so each phase is independently shippable and the user-visible improvement front-loads. Each phase ends with a commit, the test suite green, and a manual run on a large folder (10k+ items) and a video-heavy folder.

### Phase 0: Baseline (small)

1. Add ESLint (flat config, `eslint:recommended` + `no-undef` with the shared-globals list declared explicitly so cross-file implicit globals become visible), Prettier, EditorConfig.
2. Fix the 15 failing tests (schema version assertion; give `MediaControlBar` tests a minimal `document` via `happy-dom` for that file only).
3. Add a `test` job to CI on push and PR.
4. Record baseline measurements with the existing perf dashboard and a DevTools performance trace on a reference folder, so later phases can be compared. Store the numbers in `DECISIONS.md`.
5. Delete `dist/` from the working tree (it is gitignored) and prune the `electron-cache` thumbnail dir.

### Phase 1: Stop the bleeding (small, highest value per hour)

Pure bug fixes and flag removals. No structural change.

1. **Remove the raster and anti-throttling switches** (M2): `disable-zero-copy`, `enable-low-res-tiling`, `disable-partial-raster`, `disable-accelerated-2d-canvas`, `disable-software-rasterizer`, `disable-gpu-sandbox`, and, for background mode, `disable-renderer-backgrounding`, `disable-background-timer-throttling`, `disable-background-networking`. The original VRAM leak should be re-tested after Phase 3's playback budget; if it comes back, address it there, not with global flags.
2. **Fix R2** (undeclared `error`): capture the error from the stream callback and settle the promise; add a `finally` that clears `_navBusy`.
3. **Fix M6** (CLIP double init): memoize an in-flight promise in main (`_clipInitPromise`), and in the renderer route all four call sites through one `ensureClipReady()`.
4. **Fix F1 and F2, R10** (escapeHtml and XSS): keep one regex `escapeHtml` in a shared module, delete the DOM-based copy, escape the three favorites/recent/tab-group interpolations and the tag name/color/search interpolations. Add a small test.
5. **Fix R3** (empty-src error loop): remove the `error`/`load` listeners before clearing `src` (store the handlers on the element), or set a `dataset.destroyed` guard checked at the top of both listeners. Confirm in DevTools that `mediaToRetry` stops growing during scroll.
6. **Fix M9** (stale `_ipcCache`): invalidate on `updateFilePaths`, `db-import-tags`, `db-run-migration`.
7. **Fix M10** (DB proxy hang): make the watchdog real (reject `_readyPromise` after a timeout, surface a toast, fall back to in-process DB; on open failure rename the corrupt file and recreate).
8. **R1 quick mitigation**: raise the streaming refresh interval and only recalculate when the number of items whose dimensions changed since the last tick exceeds a threshold, or when the dimension stream completes. Full fix lands in Phase 3.
9. Remove the per-event timing `console.log`s and the `new Error().stack` in navigation (F8). Gate remaining diagnostics behind the perf dashboard flag.
10. Do **not** lower `MAX_VIDEOS` (the project goal is maximum animated thumbnails on screen). Add a zero-margin visibility observer so the renderer knows which cards are truly on screen, and let `resumeThumbnailVideos` go through one `playCardVideoIfVisible` policy function. Done; measured: pausing buffered videos hurt scroll smoothness, so it is opt-in only (see DECISIONS.md). The adaptive budget lands in Phase 3.

### Phase 2: Main process never blocks (medium) — DONE (see DECISIONS.md)

1. **Make the native scanner async** (M1). In napi-rs, wrap each heavy export in `AsyncTask` (implement the `Task` trait: `compute` runs on the libuv threadpool, `resolve` marshals the result) or mark them `#[napi] async fn` with the tokio feature. Keep the sync versions exported under a `*Sync` name for the few call sites that are genuinely tiny (single-file header reads). Rayon parallelism inside stays as is. Update every call site in main.js to `await`.
2. **Scan cancellation** (M3): give every streaming handler an `AbortController` keyed by `scanId`, expose `cancel-scan(scanId)` in preload, and have the renderer cancel the previous scan on navigation. Same for smart-collection scans and `auto-hash-folder`.
3. **Make `auto-hash-folder` opportunistic** (M4): run it on idle after the folder is rendered, in chunks, cancellable, and skip files whose hash is already cached by path+mtime+size.
4. **Lazy pools** (M5): create `HashWorkerPool` and `ClipPreprocessPool` on first use with an idle timeout that tears them down.
5. **Thumbnails to WebP** (M7): change the Rust encoder and the sharp fallback to WebP (quality ~80). Add a one-time migration that treats existing `.png` entries as valid until evicted. Run eviction on an idle timer during the session, not only at startup.
6. **File watching** (M8): default `depth` to 0 or 1 for the open folder, ignore `$RECYCLE.BIN`/`System Volume Information`/`node_modules`, and send one `folder-changed` message per batch with the array of events. Send `watcher-ready` to the requesting sender.
7. **DB** (M11): use `json_each` for `getTagsForFiles`; replace `LIKE` prefix matching with a range query (`file_path >= ? AND file_path < ?`) so the index is used. Fix the stale `SCHEMA_VERSION` constant.
8. **IPC hygiene**: move the `ipcMain.on` registrations out of `createWindow`; wrap `get-cache-info`/`evict-cache` in `wrapIpc`; use `pathToFileUrl` at the six inline sites.

### Phase 3: Renderer loading and playback (medium) — DONE (3a canvas-grid removal, 3b budget/background/hot spots, 3c lightbox/ImageDecoder, 3d memory/first-load; see DECISIONS.md)

0. **First-load path** — DONE: the pathless initial tab wiped the first render and tab restoration re-scanned and re-navigated; fixed, 319 ms to first cards.
1. **Streaming layout** (R1): accumulate dimension updates and apply them in one `vsRecalculate` per animation frame at most, with positions scaled proportionally for cards already on screen so they do not jump. Prefer reserving aspect-ratio slots from the dimension cache before the stream starts so most cards never move.
2. **One scheduler for cleanup/retry** (R4, R5) — PARTIAL: idle loop gated on a dirty flag, forced GC removed, layout reads replaced by layout-array lookups in media creation and preload checks; the remaining three scroll/resize listeners and the single scheduler object are deferred to Phase 5 when renderer.js is split. a single `MediaScheduler` that owns the IntersectionObserver, the retry queue, the eviction pass, and the scroll-settle timer. One scroll listener, one resize listener (use `ResizeObserver` on the grid container instead of window resize). No `getBoundingClientRect` per card; use the `vsPositions` array plus the scroll offset, which is already known.
3. **Adaptive playback budget** (R6, F3) — DONE for video (playback-budget.js); GIF/WebP via ImageDecoder is part of 3c. the goal is the *maximum* number of simultaneously animating thumbnails the machine can sustain. A `PlaybackBudget` starts at the profile ceiling, measures dropped frames (`getVideoPlaybackQuality`), long tasks (`PerformanceObserver`), and frame pacing, and lowers the number of *playing* videos only when the machine is actually falling behind, raising it again when headroom returns. Videos outside the viewport plus buffer are paused, not just evicted past the cap, so the budget is spent on what is visible. Prioritize by distance to viewport center. Move GIF and animated WebP decoding to the WebCodecs `ImageDecoder` API, which Chromium 142 (Electron 39) supports natively for both formats: it decodes off the main thread, yields frames on demand, and removes the need for gifuct-js and the 2.5 MB webpxmux bundle. Keep webpxmux only as a fallback if `ImageDecoder.isTypeSupported('image/webp')` is false.
4. **Lightbox** (F4): preload the next and previous items (image: `new Image()`; video: `preload="metadata"` on a hidden element), cache the filtered item list and invalidate it on filter/sort change instead of rebuilding per keypress, add a request token to the GIF path, dedupe `_enhancedLightboxOnOpen`, add `.catch` to `play()`. Collapse the 22 document `keydown` listeners into one dispatcher that routes by active surface (grid, lightbox, modal).
5. **Memory** (R9): fix the blob URL leak, bound the five unbounded caches with the existing LRU helper, delete the two dead caches.
6. **Background mode** — DONE for playback and timers (blur pauses, hidden/occluded pauses and stops the cleanup loop, pools idle to zero threads, measured ~0.6-1% CPU blurred and ~1% minimized); the main-process mirror for pausing CLIP/hash queues is deferred until those features get a queue (Phase 5): one `AppActivity` state machine in the renderer fed by `document.visibilityState`, window `focus`/`blur`, and main-process `minimize`/`restore`/`hide`/`show` events, with a main-process mirror. States: `active`, `blurred` (visible but not focused), `hidden` (minimized, occluded, or on another desktop). In `blurred`: pause grid playback after a short grace period, keep thumbnails loading. In `hidden`: pause everything, stop the IntersectionObserver work, cancel prefetch and idle scans, ask main to pause CLIP/hash/thumbnail queues and idle-tear-down pools, and skip `vsRecalculate` until visible again. Resume is gated by the existing "pause on window blur" setting (kept as "resume playback on focus"). Verified by measuring process CPU with the window minimized over 60 s on the fixture folder: target is under 1% for all app processes combined.

### Phase 4: CSS and markup (medium) — DONE for items 1-4, 6, 9 (colours) and the aria-label half of 7; items 5, 7 (dialog), 8 and 10 moved to Phase 5 (see DECISIONS.md)

1. Replace `backdrop-filter` on the three full-viewport overlays with a solid or semi-transparent scrim (C1).
2. Scope `will-change: transform` to cards that are actually animating (hover or drag) and move hover elevation to a pseudo-element with `opacity` instead of `box-shadow` changes (C2).
3. Convert zoom tiers to `@container` queries on `#grid-container` (or a `data-zoom` attribute on the grid, not `<html>`) (C3).
4. Replace layout-affecting transitions with `transform`/`opacity` where possible; drop `will-change: width` (C4).
5. Introduce `@layer tokens, base, components, overlays, utilities` and remove the `!important` fights, in particular the `#grid-container.grid .video-card` block (C9).
6. Replace the `padding-bottom` aspect hack with `aspect-ratio` and delete the dead `.aspect-*` classes.
7. Convert overlays to `<dialog>` with native focus trapping and `Escape` handling; add `aria-label` to the 52 icon-only buttons (C7).
8. Generate the settings modal from a schema (C6): one JSON description of sections, items, types, defaults, and storage keys; a renderer that produces the rows from `<template>`s; icons routed through icons.js as a `<symbol>` sprite. This also feeds Phase 5's single settings store and removes the 31 inline styles.
9. Theme: derive the `dark` theme from `:root` instead of duplicating, use `light-dark()` for the default without JS, move the 38 literal colors to tokens (C8).
10. Split `styles.css` into per-area files concatenated at build time (Phase 5 adds the build).

### Phase 5: Modules and state (large, the actual modernization) — PARTIAL: dead code (5a/5b), settings schema (5c), esbuild bundle + manifest (5d) done; ES-module split, renderer.js domain split, event bus and the Phase 4 deferrals remain (see DECISIONS.md)

This is where the maintainability problem gets solved. Done incrementally, one module at a time, with the app runnable at every step.

1. **Adopt ES modules without a bundler first.** Change the scripts to `type="module"`, add explicit `import`/`export` between files, and keep the few globals that plugins or inline code need on a single `window.app` namespace. ESLint `no-undef` from Phase 0 turns every implicit global into an error, which is the to-do list. Do this file by file starting from the leaves (`icons.js`, `settings.js`, `selection-manager.js`, `playback-controller.js`) and ending with renderer.js.
2. **Delete dead renderers** (R7): `renderItemsProgressive`, the pre-VS masonry engine and its observers, the 10 unreferenced functions. Decide on canvas-grid.js (see Open decisions); either promote it to a documented setting with parity tests or remove it and the 25+ branches.
3. **Single settings store** (F5, R8): make `settings.js`'s `Settings` class the only persistence layer. Migrate the ~33 raw keys into its schema with a one-time import of existing localStorage values. Remove the 16 `let *Setting` mirrors; consumers subscribe via `settings.on(key, fn)`. The schema-driven settings UI from Phase 4 binds to it directly.
4. **Split renderer.js by domain** into roughly: `grid/virtual-scroll.js`, `grid/cards.js`, `grid/media-loader.js`, `navigation.js`, `tabs.js`, `search.js`, `tags.js`, `ai/clip.js`, `ui/toast.js`, `ui/modals.js`. Move lightbox navigation from renderer-features.js into lightbox.js. Break the 571-line keydown handler into a shortcut table that maps `actionId` to a function (the `DEFAULT_SHORTCUTS` table already exists; it just needs the handlers next to it).
5. **A small typed event bus** for cross-module events (`folder:loaded`, `selection:changed`, `item:updated`) so collections, sidebar, context menu, and lightbox stop reaching into each other's globals.
6. **Add a build step** (esbuild or Vite, both trivial for Electron renderer code): one bundle per entry (main, preload, renderer, each worker), source maps, minification for release. This removes the 970 KB of synchronous script parsing on startup and makes tree-shaking of the vendored libraries possible.
7. **Type checking via JSDoc + `tsc --checkJs`** (no TypeScript migration): add `jsconfig.json` with `checkJs: true` and fix errors module by module. This catches undeclared variables like R2 at build time without changing the language.
8. **Tests**: with modules, the eight untestable files become testable. Add tests for `virtual-scroll`, `media-loader`, the settings store, and the shortcut dispatcher. Add one Playwright-for-Electron smoke test that opens a fixture folder, scrolls, opens the lightbox, and navigates.

### Phase 6: Platform and security (small to medium) — DONE except plugin vm isolation (see DECISIONS.md)

1. Upgrade Electron 39 → 44 (one major at a time, running the smoke test at each step), electron-builder 25 → 26, chokidar 3 → 5. Rebuild `sharp`, `better-sqlite3`, and the native scanner against each.
2. Security hardening (M12): allowlist `http`/`https`/`mailto` in `open-url`; validate `open-with-default` paths against the current folder set; strip the `event` argument from every preload `on*` listener; run plugins in a `vm` context or utility process with an explicit API surface; fix the `startsWith` directory check with a trailing separator.
3. Drop the duplicate npm copies of `fuse.js`, `gifuct-js`, `webpxmux` (or drop the vendored files and import from `node_modules` through the bundler). Decide whether both ONNX runtimes are needed (M13).
4. Update README, AGENTS.md, CLAUDE.local.md to match reality (Node 22, tests exist, shortcuts location, actual localStorage keys).

## 4. What I would not do

- **No rewrite and no framework migration** (React, Svelte, etc.). The virtual-scroll engine and the backend are the parts that work. A framework would add a reconciliation layer between the grid and the DOM that the current engine deliberately avoids. The problems are modularity and a dozen specific defects, and those are fixable in place.
- **No TypeScript conversion** of 60k lines. JSDoc + `checkJs` gets most of the safety at a fraction of the churn, and can be upgraded later file by file.
- **No new state library.** The existing `Settings` class plus a 50-line event bus is enough for an app with one window.

## 5. Decisions (resolved)

Owner's instruction was to proceed on all phases ("go ham"). Choices made and the reasoning are in `DECISIONS.md`. Summary:

1. **Canvas grid**: removed (owner: failed experiment).
2. **Bundler**: esbuild.
3. **Type checking**: JSDoc + `checkJs`.
4. **Electron upgrade**: Phase 6.
5. **Perf profiles**: kept as a setting that scales the adaptive budget ceiling.
6. **Plugin sandboxing**: `vm` context with the explicit plugin-api surface, Phase 6.

## 6. How this was produced

Four parallel code reviews (renderer core, main process and backend, CSS/HTML/themes, feature modules), each with file:line evidence; the test suite run (15 failures); the app launched once with the startup timeline captured (771 ms to renderer load, CLIP pool initialized twice, 2 GB thumbnail cache evicted at boot); and the highest-impact claims re-read in source by hand before being listed as verified.
