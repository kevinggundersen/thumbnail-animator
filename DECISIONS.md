# Decisions log

Append-only record of choices made during work where the owner might plausibly have chosen differently. Newest at the bottom.

## Modernization (started at fc3edd6)

- **Plan file**: `MODERNIZATION.md` is the plan. Re-read at the start of each phase.
- **Primary goal restated by owner**: animate as many thumbnails on screen at once as possible without overloading the machine. Consequence: the video cap is not lowered as a fixed number. It becomes an adaptive budget driven by measured decoder load (dropped frames, long tasks), and the work prioritizes making each playing thumbnail cheaper (pause offscreen, proxies, native decoders). Phase 1 item 10 and Phase 3 item 3 updated accordingly.
- **Canvas grid**: removed entirely (owner: "failed experiment"). Deletes canvas-grid.js, the `useCanvasGrid` key, the Ctrl+Shift+Alt+G toggle, and all `window.CG` branches.
- **Bundler**: esbuild. Alternative was Vite; rejected because the renderer has no HMR-friendly component model and esbuild needs almost no config.
- **Type checking**: JSDoc + `tsc --checkJs`, not a TypeScript migration. Alternative rejected for churn on ~60k lines.
- **Perf profiles (low/medium/high)**: kept as a user setting, but they now scale the adaptive budget's ceiling rather than hardcoding media counts. Alternative was removing the setting; rejected because it removes functionality.
- **Plugin sandboxing**: Phase 6 moves plugin execution into a `vm` context with the explicit `plugin-api` surface. Built-ins are updated to match. Alternative (utility process) deferred as heavier than needed.
- **Prettier**: not adopted. Reformatting 60k lines would make every later diff unreviewable. ESLint + EditorConfig only; formatting rules stay as the codebase has them (4-space indent, single quotes).
- **Electron upgrade**: Phase 6, one major at a time, after the smoke test exists.
- **Background mode (owner, mid-task)**: the app must be safe to leave open behind a game. Consequences: remove `disable-renderer-backgrounding` and `disable-background-timer-throttling` (they exist precisely to keep the app burning CPU when hidden); pause every grid video and animated image when the window is blurred, minimized, or occluded; suspend prefetch, hashing, CLIP, and thumbnail generation while hidden; idle-tear-down worker pools. Added as a cross-cutting requirement in MODERNIZATION.md (section 3, "Background mode"). The existing "pause on window blur" setting becomes always-on for playback; the setting is kept to control whether playback *resumes* automatically on focus.
- **Phase 0 scope**: the linter found three real bugs (`error` undeclared at renderer.js:12451, `isAnimatedGif` undefined in main.js `resolve-file-paths`, both ReferenceErrors at runtime; `setImmediate` in renderer was guarded and only needed a global declaration). Fixed them in Phase 0 so the lint gate is green from the first commit, instead of waiting for Phase 1.
- **Fixtures**: `scripts/make-fixtures.js` generates a 1,500-image / 150-video / 60-animated reference folder into the session scratchpad for perf checks. Not committed as data; the script is.

### Phase 1 measurements

Harness: `node scripts/perf-smoke.js <fixtures/mixed-1700> --profile <isolated>` run twice (second, warm run reported), 1600x1000 window, pinned settings (zoom 100, medium profile, AI off). Baseline is the Phase 0 commit `dafa5f8`.

| metric | baseline | phase 1 |
|---|---|---|
| time to first cards (ms) | 588 | 327-444 |
| scroll avg frame (ms) | 13.7 | 13.2-15.0 |
| scroll frames over 33 ms (of ~620) | 0 | 0-1 |
| playing videos after scroll | 9 | 9 |
| renderer CPU during scroll (%) | 11.3 | 9.4-11.2 |
| CPU while minimized, 10 s (%) | 1.2 | 1.1 |

- **Visible-only playback rejected by measurement.** A/B with three trials each: pausing videos that sit in the preload buffer (playing only cards inside the viewport) gave 6-10 frames over 33 ms per scroll test versus 0-1 with buffered videos playing, and CPU was not lower (11.2-11.7% vs 9.4-11.2%). Cause: decoder start-up when a card enters the viewport. Buffered videos keep playing by default; `localStorage.playOnlyVisible = '1'` opts in. The visibility observer and `_visibleCards` set stay, as the prioritization input for Phase 3's adaptive budget.
- **Perf harness pulled forward from Phase 5** (`scripts/perf-smoke.js`, playwright-core dev dependency) because Phase 1 needed before/after numbers. It runs the app on an isolated profile via the new `THUMBNAIL_ANIMATOR_USER_DATA` env override so it never touches real user data.
- **Minimized CPU is already ~1%** with the anti-throttling flags removed; Phase 3's background mode still has to cover the blurred-but-visible and occluded cases and stop background scans.
- **Chromium switch A/B (Phase 1, corrected harness that clears localStorage each run).** Frames over 33 ms in the 30-page scroll test, two trials each, Phase 1 code: no switches 13-19; all five legacy raster switches 3-7; `disable-partial-raster,disable-zero-copy` 3-9; **`enable-low-res-tiling` alone 1-1** (baseline commit: 0). Kept `enable-low-res-tiling`, dropped the rest. The flags' original comment attributed them to a VRAM leak; the measurable effect is scroll smoothness, and it comes from low-res tiling only. `THUMBNAIL_ANIMATOR_EXTRA_SWITCHES` env hook added so future flag experiments need no code edits.
- **Scroll parity accepted (Phase 1 close-out).** With `--trials 6` in-session repeats, baseline medians were 0 frames over 33 ms per 30-page scroll (one 10-frame outlier) and Phase 1 medians 0-2 (one noisy series of 24/4/9/5 while other trials in the same session were 0-1). The test's resolution is roughly ±3 frames; Phase 1 is at parity. The visibility observer is now lazy (only attached when a consumer needs the visible set), which removes the one per-scroll cost Phase 1 had added.
- **Open observation for Phase 3**: time to first cards is ~1.1-1.6 s on a freshly cleared profile but ~0.3-0.6 s once localStorage has been populated by one run, for both baseline and Phase 1. Something in the first-run path (tab restore, sidebar drive listing, or cache trust) costs ~0.8 s; find it when the loading pipeline is reworked.
