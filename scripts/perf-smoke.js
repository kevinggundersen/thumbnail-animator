'use strict';
/* global window, document, requestAnimationFrame, vsState, MouseEvent, PerformanceObserver */ // page.evaluate callbacks run in the renderer
// Launches the app on a folder and measures what the user feels:
// time to first cards, scroll frame pacing, playing-video count, long tasks,
// per-process CPU/memory, and CPU while minimized (background mode).
//
// Usage: node scripts/perf-smoke.js <folder> [--app <dir>] [--profile <dir>] [--out result.json] [--scrolls 30] [--trials 1] [--steady 6] [--bg 10] [--set key=value]... [--cpuprofile out.cpuprofile]
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
// --keep-settings: measure the profile exactly as the user has it (no clear, no pinned
// settings); pass '-' as the folder to use the profile's remembered folder.
const keepSettings = args.includes('--keep-settings');
const steadySeconds = parseInt(opt('--steady', '6'), 10);
const cpuProfileFile = opt('--cpuprofile', null); // write a .cpuprofile of the first scroll trial
const cpuProfileLoadFile = opt('--cpuprofile-load', null); // write a .cpuprofile of the folder load (reload -> cards + settle)
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

// Grid video state: how many exist/play and what the decoders report.
async function videoStats(page) {
    return page.evaluate(() => {
        const vids = [...document.querySelectorAll('#grid-container video')];
        let total = 0, dropped = 0;
        for (const v of vids) {
            try { const q = v.getVideoPlaybackQuality(); total += q.totalVideoFrames; dropped += q.droppedVideoFrames; } catch {}
        }
        const budget = window.__playbackBudget ? window.__playbackBudget.status() : null;
        return { videos: vids.length, playing: vids.filter(v => !v.paused).length, decodedFrames: total, droppedFrames: dropped, budget };
    });
}

// electronApplication.evaluate occasionally fails with "Resulting promise was
// garbage collected" when the app forces a GC in the main process; retry.
async function mainEval(app, fn, arg) {
    let last;
    for (let i = 0; i < 3; i++) {
        try { return await app.evaluate(fn, arg); } catch (e) { last = e; await sleep(300); }
    }
    throw last;
}

async function metrics(app) {
    // percentCPUUsage is measured since the previous call per process.
    const m = await mainEval(app, ({ app }) => app.getAppMetrics());
    const rows = m.map(p => ({ type: p.type, cpu: p.cpu.percentCPUUsage, memMB: Math.round((p.memory.workingSetSize || 0) / 1024) }));
    return {
        cpuTotal: Math.round(rows.reduce((a, r) => a + r.cpu, 0) * 10) / 10,
        memMBTotal: rows.reduce((a, r) => a + r.memMB, 0),
        rows,
    };
}

(async () => {
    // Renderer bundles must be current for the app under test.
    if (fs.existsSync(path.join(appDir, "scripts", "build-renderer.js"))) {
        require("child_process").execFileSync(process.execPath, [path.join(appDir, "scripts", "build-renderer.js")], { cwd: appDir, stdio: "inherit" });
    }
    const t0 = Date.now();
    fs.mkdirSync(profileDir, { recursive: true });
    // The app holds a single-instance lock; a launch right after a previous run
    // can lose to the exiting instance, so retry once.
    let app, page;
    for (let attempt = 0; ; attempt++) {
        try {
            app = await electron.launch({ args: [appDir], cwd: appDir, timeout: 60000, env: { ...process.env, THUMBNAIL_ANIMATOR_USER_DATA: profileDir } });
            page = await app.firstWindow({ timeout: 30000 });
            global.__perfApp = app;
            break;
        } catch (e) {
            try { if (app) await app.close(); } catch {}
            if (attempt >= 3) throw e;
            await sleep(4000);
        }
    }
    await page.waitForLoadState('domcontentloaded');

    // Point the app at the folder and restart the renderer.
    if (keepSettings) {
        if (folder !== '-') await page.evaluate((f) => localStorage.setItem('lastFolderPath', f), folder);
        const explicit = {};
        for (let i = 0; i < args.length; i++) if (args[i] === '--set') { const [k, v] = String(args[i + 1]).split('='); explicit[k] = v; }
        if (Object.keys(explicit).length) await page.evaluate((o) => { for (const [k, v] of Object.entries(o)) localStorage.setItem(k, v); }, explicit);
    } else {
        await page.evaluate(({ f, pinned }) => {
            localStorage.clear(); // settings from earlier runs (including --set experiments) must not leak
            localStorage.setItem('lastFolderPath', f);
            for (const [k, v] of Object.entries(pinned)) localStorage.setItem(k, v);
        }, { f: folder, pinned: PINNED_SETTINGS });
    }
    const settingsSnapshot = await page.evaluate(() => { const o = {}; for (const k of ['lastFolderPath','zoomLevel','perfProfile','thumbnailQuality','layoutMode','aiAutoScan','aiVisualSearchEnabled','linkedDuplicates','hoverScale','hoverScaleWithZoom','hoverScrub','gifHoverScrub','hoverPreviewStrip','groupByDate','includeMovingImages','recursiveSearch','imageCacheLimitMB','videoCacheLimitMB','playbackBudgetHint']) o[k] = localStorage.getItem(k); return o; });
    await mainEval(app, ({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        w.unmaximize(); w.setSize(1600, 1000); w.center(); w.show(); w.focus();
        return true; // a primitive result avoids Playwright's "promise was garbage collected" flake
    });
    // Renderer console lines that look like diagnostics ("[nav] ...", "[loadVideos] ...").
    const consoleLines = [];
    page.on('console', (m) => {
        const t = m.text();
        if (t.startsWith('[') && consoleLines.length < 400) consoleLines.push({ t: Date.now() - t0, text: t.slice(0, 200) });
    });
    let loadCdp = null;
    if (cpuProfileLoadFile) {
        loadCdp = await page.context().newCDPSession(page);
        await loadCdp.send('Profiler.enable');
        await loadCdp.send('Profiler.setSamplingInterval', { interval: 500 });
        await loadCdp.send('Profiler.start');
    }
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
    // Measured by the page itself (navigation start → the poll that saw the cards), so
    // harness round trips do not inflate it; the Date.now() figure is kept for reference.
    const tFirstCards = await page.evaluate(() => Math.round(performance.now()));
    const tFirstCardsHarness = Date.now() - tReload;
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
    stateAfterLoad.video = await videoStats(page);
    if (loadCdp) {
        const { profile } = await loadCdp.send('Profiler.stop');
        fs.writeFileSync(cpuProfileLoadFile, JSON.stringify(profile));
        await loadCdp.detach();
    }
    const loadLongTasks = await page.evaluate(() => { const r = window.__lt.slice(); window.__lt.length = 0; return r; });
    await metrics(app); // prime the CPU counters

    // Scroll test: page down `scrolls` times, sampling frame intervals throughout.
    // Repeated `trials` times within the same session (back to top, settle, again)
    // so run-to-run variance can be judged without paying the launch cost.
    const trialResults = [];
    let scroll, scrollLongTasks;
    let cdp = null;
    for (let t = 0; t < trials; t++) {
    if (t === 0 && cpuProfileFile) {
        cdp = await page.context().newCDPSession(page);
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
        await cdp.send('Profiler.start');
    }
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
    if (t === 0 && cdp) {
        const { profile } = await cdp.send('Profiler.stop');
        fs.writeFileSync(cpuProfileFile, JSON.stringify(profile));
        await cdp.detach();
        cdp = null;
    }
    const fr = scroll.frames.slice(1);
    trialResults.push({ avgFrameMs: Math.round(fr.reduce((a, b) => a + b, 0) / Math.max(1, fr.length) * 10) / 10, p95FrameMs: Math.round(pct(fr, 0.95) * 10) / 10, p99FrameMs: Math.round(pct(fr, 0.99) * 10) / 10, framesOver33ms: fr.filter(f => f > 33).length, framesOver100ms: fr.filter(f => f > 100).length, longTaskMs: scrollLongTasks.reduce((a, b) => a + b, 0), playing: scroll.playing });
    }
    const activeMetrics = await metrics(app);
    const videoAfterScroll = await videoStats(page);

    // Hover test: move the pointer across the visible cards (dwelling on each),
    // sampling frame intervals. Hover work must not stall the frame.
    await page.evaluate(() => { const gc = document.getElementById('grid-container'); gc.scrollTop = 0; });
    await sleep(1500);
    const hover = await page.evaluate(async () => {
        const cards = [...document.querySelectorAll('#grid-container .video-card')].slice(0, 16);
        const frames = []; let last = performance.now(), running = true;
        const tick = (t) => { frames.push(t - last); last = t; if (running) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
        const lt = []; let po = null;
        try { po = new PerformanceObserver((l) => { for (const e of l.getEntries()) lt.push(Math.round(e.duration)); }); po.observe({ entryTypes: ['longtask'] }); } catch {}
        for (const c of cards) {
            const r = c.getBoundingClientRect();
            const init = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
            c.dispatchEvent(new MouseEvent('mouseenter', init));
            c.dispatchEvent(new MouseEvent('mouseover', init));
            c.dispatchEvent(new MouseEvent('mousemove', init));
            await new Promise(r2 => setTimeout(r2, 350));
            c.dispatchEvent(new MouseEvent('mouseout', { ...init, relatedTarget: document.body }));
            c.dispatchEvent(new MouseEvent('mouseleave', init));
        }
        await new Promise(r2 => setTimeout(r2, 500));
        running = false; if (po) po.disconnect();
        const f = frames.slice(1);
        const s = [...f].sort((a, b) => a - b);
        return { cards: cards.length, frames: f.length, p95FrameMs: Math.round(s[Math.floor(s.length * 0.95)] * 10) / 10, maxFrameMs: Math.round(s[s.length - 1]), framesOver33ms: f.filter(x => x > 33).length, longTasks: lt.length, longTaskMs: lt.reduce((a, b) => a + b, 0) };
    });

    // Steady state: sit still for a few seconds with everything playing and see
    // what the budget settles on and how many frames the decoders drop.
    await metrics(app);
    const steadyBefore = await videoStats(page);
    await sleep(steadySeconds * 1000);
    const steadyAfter = await videoStats(page);
    const steadyMetrics = await metrics(app);
    const steady = {
        seconds: steadySeconds,
        playing: steadyAfter.playing,
        videos: steadyAfter.videos,
        decodedFrames: steadyAfter.decodedFrames - steadyBefore.decodedFrames,
        droppedFrames: steadyAfter.droppedFrames - steadyBefore.droppedFrames,
        budget: steadyAfter.budget,
        cpuTotal: steadyMetrics.cpuTotal,
    };

    const frames = scroll.frames.slice(1);
    const result = {
        app: appDir, profile: profileDir, folder, when: new Date().toISOString(),
        settings: settingsSnapshot,
        itemCount: await page.evaluate(() => (typeof vsState !== 'undefined' && vsState.sortedItems) ? vsState.sortedItems.length : null),
        startupMs: tReload - t0,
        timeToFirstCardsMs: tFirstCards,
        timeToFirstCardsHarnessMs: tFirstCardsHarness,
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
            video: videoAfterScroll,
            trials: trialResults,
            medianOver33: pct(trialResults.map(r => r.framesOver33ms), 0.5),
        },
        active: activeMetrics,
        steady,
        hover,
    };

    // Blurred: the window stays visible but another window has focus (alt-tab
    // to a game on another monitor). Playwright emulates page focus, so OS-level
    // focus changes never reach the page; dispatch the DOM events the app
    // listens to instead and measure CPU and whether playback paused.
    if (bgSeconds > 0) {
        await page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await sleep(2000);
        await metrics(app);
        await sleep(bgSeconds * 1000);
        result.blurred = await metrics(app);
        result.blurred.seconds = bgSeconds;
        result.blurred.simulated = true;
        result.blurred.video = await videoStats(page);
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await sleep(1500);
        result.blurred.videoAfterFocus = await videoStats(page);
    }

    // Background mode: minimize, wait, measure CPU over the window.
    if (bgSeconds > 0) {
        await mainEval(app, ({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].minimize(); return true; });
        await sleep(1500);
        await metrics(app); // reset counters after the transition settles
        await sleep(bgSeconds * 1000);
        result.minimized = await metrics(app);
        result.minimized.seconds = bgSeconds;
        result.minimized.video = await videoStats(page);
        result.minimized.playing = result.minimized.video.playing;
        await mainEval(app, ({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].restore(); return true; });
    }

    result.console = consoleLines;
    await app.close();
    const json = JSON.stringify(result, null, 2);
    if (outFile) fs.writeFileSync(outFile, json);
    console.log(json);
})().catch(async (e) => {
    console.error(e);
    try { if (global.__perfApp) await global.__perfApp.close(); } catch {}
    process.exit(1);
});
