'use strict';
/* global window, document, requestAnimationFrame */ // page.evaluate callbacks run in the renderer
// Launches the app on a folder and measures what the user feels:
// time to first cards, scroll frame pacing, playing-video count, long tasks,
// per-process CPU/memory, and CPU while minimized (background mode).
//
// Usage: node scripts/perf-smoke.js <folder> [--app <dir>] [--profile <dir>] [--out result.json] [--scrolls 30] [--trials 1] [--bg 10] [--set key=value]...
// The app runs on an isolated profile (--profile, default under the OS temp dir) with pinned settings;
// run it twice and read the second result so the thumbnail cache is warm.
// Requires: npm i -D playwright-core (no browser download needed; drives Electron).

const path = require('path');
const fs = require('fs');
const { _electron: electron } = require('playwright-core');

const args = process.argv.slice(2);
const folder = args[0];
if (!folder) { console.error('usage: perf-smoke <folder> [--app dir] [--out file] [--scrolls N] [--bg seconds]'); process.exit(1); }
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const appDir = path.resolve(opt('--app', path.join(__dirname, '..')));
const outFile = opt('--out', null);
const scrolls = parseInt(opt('--scrolls', '30'), 10);
const bgSeconds = parseInt(opt('--bg', '10'), 10);
const trials = parseInt(opt('--trials', '1'), 10);
const profileDir = path.resolve(opt('--profile', path.join(require('os').tmpdir(), 'thumbnail-animator-perf', path.basename(appDir))));
const appVersion = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
// Renderer settings pinned for every run so that app versions are compared on equal terms.
const PINNED_SETTINGS = {
    rememberLastFolder: 'true', zoomLevel: '100', perfProfile: 'medium', thumbnailQuality: 'medium',
    aiAutoScan: 'false', aiVisualSearchEnabled: 'false', linkedDuplicates: 'false',
    welcomeDismissedVersion: appVersion, sidebarCollapsed: 'false',
};
// --set key=value (repeatable) overrides or adds pinned settings, for A/B experiments.
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--set') { const [k, v] = String(args[i + 1]).split('='); PINNED_SETTINGS[k] = v; }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

async function metrics(app) {
    // percentCPUUsage is measured since the previous call per process.
    const m = await app.evaluate(({ app }) => app.getAppMetrics());
    const rows = m.map(p => ({ type: p.type, cpu: p.cpu.percentCPUUsage, memMB: Math.round((p.memory.workingSetSize || 0) / 1024) }));
    return {
        cpuTotal: Math.round(rows.reduce((a, r) => a + r.cpu, 0) * 10) / 10,
        memMBTotal: rows.reduce((a, r) => a + r.memMB, 0),
        rows,
    };
}

(async () => {
    const t0 = Date.now();
    fs.mkdirSync(profileDir, { recursive: true });
    // The app holds a single-instance lock; a launch right after a previous run
    // can lose to the exiting instance, so retry once.
    let app, page;
    for (let attempt = 0; ; attempt++) {
        try {
            app = await electron.launch({ args: [appDir], cwd: appDir, timeout: 60000, env: { ...process.env, THUMBNAIL_ANIMATOR_USER_DATA: profileDir } });
            page = await app.firstWindow({ timeout: 30000 });
            break;
        } catch (e) {
            try { if (app) await app.close(); } catch {}
            if (attempt >= 1) throw e;
            await sleep(3000);
        }
    }
    await page.waitForLoadState('domcontentloaded');

    // Point the app at the folder and restart the renderer.
    await page.evaluate(({ f, pinned }) => {
        localStorage.clear(); // settings from earlier runs (including --set experiments) must not leak
        localStorage.setItem('lastFolderPath', f);
        for (const [k, v] of Object.entries(pinned)) localStorage.setItem(k, v);
    }, { f: folder, pinned: PINNED_SETTINGS });
    await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        w.unmaximize(); w.setSize(1600, 1000); w.center(); w.show(); w.focus();
    });
    const tReload = Date.now();
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Long-task observer from as early as we can get it after reload.
    await page.evaluate(() => {
        window.__lt = [];
        try {
            new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); })
                .observe({ entryTypes: ['longtask'] });
        } catch {}
    });

    // Wait for the grid to populate.
    await page.waitForFunction(() => document.querySelectorAll('#grid-container .video-card').length >= 20, null, { timeout: 60000 });
    const tFirstCards = Date.now() - tReload;
    await sleep(2500); // let the initial wave of thumbnails/videos settle

    const stateAfterLoad = await page.evaluate(() => {
        const vids = [...document.querySelectorAll('#grid-container video')];
        return {
            cards: document.querySelectorAll('#grid-container .video-card').length,
            videos: vids.length,
            playing: vids.filter(v => !v.paused).length,
            images: document.querySelectorAll('#grid-container img.media-thumbnail').length,
        };
    });
    const loadLongTasks = await page.evaluate(() => { const r = window.__lt.slice(); window.__lt.length = 0; return r; });
    await metrics(app); // prime the CPU counters

    // Scroll test: page down `scrolls` times, sampling frame intervals throughout.
    // Repeated `trials` times within the same session (back to top, settle, again)
    // so run-to-run variance can be judged without paying the launch cost.
    const trialResults = [];
    let scroll, scrollLongTasks;
    for (let t = 0; t < trials; t++) {
    if (t > 0) {
        await page.evaluate(async () => { const gc = document.getElementById('grid-container'); gc.scrollTop = 0; await new Promise(r => setTimeout(r, 2000)); });
        await page.evaluate(() => { window.__lt.length = 0; });
    }
    scroll = await page.evaluate(async (n) => {
        const gc = document.getElementById('grid-container');
        const frames = [];
        let last = performance.now(), running = true;
        const tick = (t) => { frames.push(t - last); last = t; if (running) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        const step = Math.floor(gc.clientHeight * 0.8);
        for (let i = 0; i < n; i++) {
            gc.scrollTop += step;
            await new Promise(r => setTimeout(r, 120));
        }
        await new Promise(r => setTimeout(r, 800));
        running = false;
        const vids = [...document.querySelectorAll('#grid-container video')];
        return { frames, playing: vids.filter(v => !v.paused).length, videos: vids.length, scrollTop: gc.scrollTop, scrollHeight: gc.scrollHeight };
    }, scrolls);
    scrollLongTasks = await page.evaluate(() => { const r = window.__lt.slice(); window.__lt.length = 0; return r; });
    const fr = scroll.frames.slice(1);
    trialResults.push({ avgFrameMs: Math.round(fr.reduce((a, b) => a + b, 0) / Math.max(1, fr.length) * 10) / 10, p95FrameMs: Math.round(pct(fr, 0.95) * 10) / 10, p99FrameMs: Math.round(pct(fr, 0.99) * 10) / 10, framesOver33ms: fr.filter(f => f > 33).length, framesOver100ms: fr.filter(f => f > 100).length, longTaskMs: scrollLongTasks.reduce((a, b) => a + b, 0), playing: scroll.playing });
    }
    const activeMetrics = await metrics(app);

    const frames = scroll.frames.slice(1);
    const result = {
        app: appDir, profile: profileDir, folder, when: new Date().toISOString(),
        startupMs: tReload - t0,
        timeToFirstCardsMs: tFirstCards,
        afterLoad: stateAfterLoad,
        loadLongTasks: { count: loadLongTasks.length, totalMs: loadLongTasks.reduce((a, b) => a + b, 0), maxMs: Math.max(0, ...loadLongTasks) },
        scroll: {
            steps: scrolls, frames: frames.length,
            avgFrameMs: Math.round(frames.reduce((a, b) => a + b, 0) / Math.max(1, frames.length) * 10) / 10,
            p95FrameMs: Math.round(pct(frames, 0.95) * 10) / 10,
            p99FrameMs: Math.round(pct(frames, 0.99) * 10) / 10,
            framesOver33ms: frames.filter(f => f > 33).length,
            framesOver100ms: frames.filter(f => f > 100).length,
            longTasks: { count: scrollLongTasks.length, totalMs: scrollLongTasks.reduce((a, b) => a + b, 0), maxMs: Math.max(0, ...scrollLongTasks) },
            playingAfter: scroll.playing, videosAfter: scroll.videos,
            trials: trialResults,
            medianOver33: pct(trialResults.map(r => r.framesOver33ms), 0.5),
        },
        active: activeMetrics,
    };

    // Background mode: minimize, wait, measure CPU over the window.
    if (bgSeconds > 0) {
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
        await sleep(1500);
        await metrics(app); // reset counters after the transition settles
        await sleep(bgSeconds * 1000);
        result.minimized = await metrics(app);
        result.minimized.seconds = bgSeconds;
        result.minimized.playing = await page.evaluate(() => [...document.querySelectorAll('#grid-container video')].filter(v => !v.paused).length);
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
    }

    await app.close();
    const json = JSON.stringify(result, null, 2);
    if (outFile) fs.writeFileSync(outFile, json);
    console.log(json);
})().catch((e) => { console.error(e); process.exit(1); });
