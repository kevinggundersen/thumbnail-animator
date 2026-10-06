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
