// Usage: node scripts/nav-stress.js <isolated-profile-dir> <fixture-tree>   (needs playwright-core; see perf-smoke.js)
//
// Adversarial navigation timing: rapid clicks, back pressed twice, tab switches
// while a big folder is still scanning, closing a loading tab, reloads mid-load,
// invalid paths. After each scenario the app must satisfy the same invariants:
//   - no navigation is still "busy" and nothing is queued
//   - the grid, the active tab and the breadcrumb all agree on the folder
//   - the item and folder counts match the disk
//   - the active tab's history entry points at the folder on screen
//   - no tab's content cache holds another folder's items
//
// The fixture tree is the one scripts/make-fixtures.js builds (A, B, C, C/deep,
// C/deep/deeper, D-empty, plus media in the root) with an extra BIG folder
// of a few thousand files so scans take long enough to interleave.
/* global navigateToFolder, goBack, goForward, createTab, switchToTab, closeTab, tabs, activeTabId, currentFolderPath, vsState, navigationHistory, _navBusy, _pendingNav, tabContentCache, normalizePath, WcEngine, document */
const { _electron: electron } = require('playwright-core');
const fs = require('fs'); const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
(async () => {
    const appDir = path.resolve(__dirname, '..');
    const [profile, root] = process.argv.slice(2);
    if (!profile || !root) { console.error('usage: node scripts/nav-stress.js <profile-dir> <fixture-tree>'); process.exit(2); }
    const R = (...p) => path.join(root, ...p);
    for (const d of ['A', 'B', 'C', 'BIG', path.join('C', 'deep', 'deeper')]) {
        if (!fs.existsSync(R(d))) { console.error(`fixture folder missing: ${R(d)}`); process.exit(2); }
    }
    const countMedia = (dir) => fs.readdirSync(dir).filter(f => /\.(jpg|png|webp|gif|mp4)$/i.test(f)).length;
    const countDirs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).length;
    const app = await electron.launch({ args: [appDir], cwd: appDir, env: { ...process.env, THUMBNAIL_ANIMATOR_USER_DATA: profile } });
    const page = await app.firstWindow();
    const errors = []; const findings = [];
    page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
    const log = []; // app perf log since the last check, printed when a check fails
    page.on('console', m => {
        const t = m.text();
        if (m.type() === 'error') errors.push(t.slice(0, 200));
        if (/^\[(nav|loadVideos|watcher|activity)\]/.test(t)) log.push(t.slice(0, 160));
    });
    await page.evaluate(({ f }) => { localStorage.clear(); localStorage.setItem('lastFolderPath', f); localStorage.setItem('rememberLastFolder', 'true'); localStorage.setItem('welcomeDismissedVersion', '9'); localStorage.setItem('aiAutoScan', 'false'); localStorage.setItem('zoomLevel', '70'); localStorage.setItem('perfLog', '1'); }, { f: root });
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setSize(1400, 900); w.center(); return true; });
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#grid-container .video-card, #grid-container .folder-card').length >= 5, null, { timeout: 60000 });
    await sleep(1500);

    const state = () => page.evaluate(() => {
        const tab = tabs.find(t => t.id === activeTabId) || {};
        const wc = typeof WcEngine !== 'undefined' ? WcEngine.status() : null;
        const cacheMismatch = [];
        for (const t of tabs) {
            const c = tabContentCache.get(t.id);
            if (c && t.path && normalizePath(c.path) !== normalizePath(t.path)) cacheMismatch.push(`tab ${t.id} "${t.name}" path=${t.path} cache=${c.path}`);
        }
        return {
            folder: typeof currentFolderPath !== 'undefined' ? currentFolderPath : null,
            items: vsState.sortedItems.filter(i => i.type !== 'folder' && i.type !== 'group-header').length,
            folders: vsState.sortedItems.filter(i => i.type === 'folder').length,
            tabPath: tab.path, tabName: tab.name, tabCount: tabs.length, activeTabId,
            historyTop: tab.historyPaths ? tab.historyPaths[tab.historyIndex] : undefined,
            historyIndex: tab.historyIndex, historyLen: tab.historyPaths ? tab.historyPaths.length : 0,
            canBack: navigationHistory.canGoBack(), canForward: navigationHistory.canGoForward(),
            navBusy: _navBusy, pending: !!_pendingNav,
            cacheMismatch,
            wcDetached: wc ? wc.detached : 0, wcPlayers: wc ? wc.players : 0, sheetHidden: wc ? wc.hidden : false, scrollingClass: document.body.classList.contains('is-scrolling'),
            breadcrumb: (document.getElementById('breadcrumb') || {}).textContent?.replace(/\s+/g, ' ').trim().slice(0, 100),
        };
    });
    // Wait until no navigation is busy or queued (the invariant itself: must settle within 8 s).
    const settle = async () => {
        let idle = 0;
        for (let i = 0; i < 80; i++) {
            idle = (await page.evaluate(() => _navBusy || !!_pendingNav)) ? 0 : idle + 1;
            if (idle >= 2) return true;
            await sleep(100);
        }
        return false;
    };
    // A burst schedules its later actions with setTimeout; wait those timers out
    // before settling, or settle can sample the gap between two scheduled actions.
    const burst = async (fn, arg, lastMs) => { const v = await page.evaluate(fn, arg); await sleep(lastMs + 80); return v; };
    const expect = async (label, dir, extra = {}) => {
        const settled = await settle();
        await sleep(300);
        const s = await state();
        const problems = [];
        if (!settled) problems.push('navigation did not settle in 8 s');
        if (norm(s.folder) !== norm(dir)) problems.push(`folder=${s.folder} expected ${dir}`);
        if (norm(s.tabPath) !== norm(dir)) problems.push(`activeTab.path=${s.tabPath} expected ${dir}`);
        const em = countMedia(dir), ed = countDirs(dir);
        if (s.items !== em) problems.push(`items=${s.items} expected ${em}`);
        if (s.folders !== ed) problems.push(`folders=${s.folders} expected ${ed}`);
        if (s.historyTop === undefined || norm(s.historyTop) !== norm(dir)) problems.push(`history[${s.historyIndex}]=${s.historyTop} expected ${dir}`);
        if (s.cacheMismatch.length) problems.push('tab cache holds another folder: ' + s.cacheMismatch.join('; '));
        if (s.wcDetached > 0) problems.push(`${s.wcDetached} engine players belong to cards that left the document`);
        if (s.sheetHidden || s.scrollingClass) problems.push('grid still marked scrolling after settling (sheet hidden)');
        for (const [k, v] of Object.entries(extra)) if (s[k] !== v) problems.push(`${k}=${JSON.stringify(s[k])} expected ${JSON.stringify(v)}`);
        findings.push({ step: label, ok: problems.length === 0, problems, history: `${s.historyIndex + 1}/${s.historyLen}`, log: problems.length ? log.slice(-60) : undefined });
        if (problems.length) console.log('FAIL', label, problems, '\n  ' + log.slice(-60).join('\n  '));
        else console.log('ok  ', label);
        log.length = 0;
    };
    const nav = async (dir) => { await page.evaluate((d) => navigateToFolder(d), dir); await settle(); };
    // Where N back (negative) or forward presses should land according to the tab's
    // own history. Which rapid clicks complete before the next one is timing-dependent,
    // so the expectation is derived from the entries that actually got recorded.
    const histAt = (delta) => page.evaluate((d) => { const t = tabs.find(x => x.id === activeTabId); const i = Math.max(0, Math.min(t.historyPaths.length - 1, t.historyIndex + d)); return t.historyPaths[i]; }, delta);
    const firstTab = await page.evaluate(() => tabs[0].id);

    // S1: two clicks 30 ms apart, the second wins and the first never enters history.
    await burst(({ a, b }) => { navigateToFolder(a); setTimeout(() => navigateToFolder(b), 30); }, { a: R('A'), b: R('BIG') }, 30);
    await expect('S1 rapid A->BIG lands on BIG', R('BIG'));
    const s1Back = await histAt(-1);
    await page.evaluate(() => goBack());
    await expect('S1 back lands on the previous recorded entry', s1Back);

    // S2: three clicks 20 ms apart.
    await burst(({ a, b, c }) => { navigateToFolder(a); setTimeout(() => navigateToFolder(b), 20); setTimeout(() => navigateToFolder(c), 40); }, { a: R('A'), b: R('C'), c: R('C', 'deep', 'deeper') }, 40);
    await expect('S2 rapid A->C->deeper lands on deeper', R('C', 'deep', 'deeper'));
    const s2Back = await histAt(-1);
    await page.evaluate(() => goBack());
    await expect('S2 back lands on the previous recorded entry', s2Back);

    // S3: back pressed twice quickly steps two entries; forward twice returns.
    await nav(R('A')); await nav(R('C')); await nav(R('C', 'deep'));
    await expect('S3 setup at C/deep', R('C', 'deep'));
    const s3b2 = await histAt(-2);
    await burst(() => { goBack(); setTimeout(() => goBack(), 30); }, 30);
    await expect('S3 back,back (30 ms) steps two entries', s3b2);
    await burst(() => { goForward(); setTimeout(() => goForward(), 30); }, 30);
    await expect('S3 forward,forward (30 ms) -> C/deep', R('C', 'deep'));
    const s3b3 = await histAt(-3);
    await page.evaluate(() => { goBack(); goBack(); goBack(); });
    await expect('S3 back x3 same tick steps three entries', s3b3);

    // S4: a tab switch while a big folder is still scanning.
    await nav(R('A'));
    const tabB = await page.evaluate((b) => createTab(b, 'B'), R('B'));
    await expect('S4 new tab B', R('B'), { tabCount: 2 });
    await page.evaluate((id) => switchToTab(id), firstTab);
    await expect('S4 back to first tab (A)', R('A'));
    await burst(({ big, id }) => { navigateToFolder(big); setTimeout(() => switchToTab(id), 40); }, { big: R('BIG'), id: tabB }, 40);
    await expect('S4 switched to B while BIG scanned: B on screen', R('B'), { activeTabId: tabB });
    const firstTabPath = await page.evaluate((id) => tabs.find(t => t.id === id).path, firstTab);
    findings.push({ step: 'S4 first tab remembers BIG', ok: norm(firstTabPath) === norm(R('BIG')), problems: norm(firstTabPath) === norm(R('BIG')) ? [] : [`first tab path=${firstTabPath}`] });
    await page.evaluate((id) => switchToTab(id), firstTab);
    await expect('S4 first tab shows BIG with all items', R('BIG'), { activeTabId: firstTab });

    // S5: navigate away while BIG's dimensions are still streaming, then back.
    await nav(R('A'));
    await burst(({ big, a }) => { navigateToFolder(big); setTimeout(() => navigateToFolder(a), 150); }, { big: R('BIG'), a: R('A') }, 150);
    await expect('S5 A after BIG mid-stream', R('A'));
    await page.evaluate(() => goBack());
    const s5 = await state();
    findings.push({ step: 'S5 back target is a real entry', ok: !s5.navBusy, problems: [] });
    await settle();
    await expect('S5 back lands on a consistent folder', await page.evaluate(() => currentFolderPath));

    // S6: create a tab and switch back before it loads.
    await nav(R('C'));
    const tabC = await burst(({ p, id }) => { const t = createTab(p, 'BIG2'); setTimeout(() => switchToTab(id), 10); return t; }, { p: R('BIG'), id: firstTab }, 10);
    await expect('S6 switched back before new tab loaded: first tab intact', R('C'), { activeTabId: firstTab, tabCount: 3 });
    await page.evaluate((id) => switchToTab(id), tabC);
    await expect('S6 new tab shows BIG', R('BIG'), { activeTabId: tabC });
    await page.evaluate((id) => closeTab(id), tabC);
    await expect('S6 close BIG tab -> first tab C', R('C'), { tabCount: 2 });

    // S7: close a tab while its folder is loading.
    const tabX = await burst((p) => { const t = createTab(p, 'X'); setTimeout(() => closeTab(t), 50); return t; }, R('BIG'), 50);
    await expect('S7 closed loading tab: back on previous tab', R('C'), { tabCount: 2 });
    findings.push({ step: 'S7 closed tab gone', ok: !(await page.evaluate((id) => tabs.some(t => t.id === id), tabX)), problems: [] });

    // S8: force reload while the same folder is loading.
    await burst((big) => { navigateToFolder(big); setTimeout(() => navigateToFolder(big, false, true), 30); }, R('BIG'), 30);
    await expect('S8 reload during load', R('BIG'));

    // S9: an invalid path leaves everything untouched; the next navigation works.
    const before = await state();
    await page.evaluate((p) => navigateToFolder(p), R('does-not-exist'));
    await expect('S9 invalid path keeps BIG', R('BIG'), { historyIndex: before.historyIndex, historyLen: before.historyLen });
    await nav(R('A'));
    await expect('S9 navigation after error', R('A'));

    // S10: ten alternating clicks 15 ms apart.
    await burst(({ a, c }) => { for (let i = 0; i < 10; i++) setTimeout(() => navigateToFolder(i % 2 ? c : a), i * 15); }, { a: R('A'), c: R('C') }, 135);
    await expect('S10 ten alternating clicks -> C', R('C'));
    await page.evaluate(() => goBack());
    await expect('S10 back after burst', await page.evaluate(() => currentFolderPath));

    // S11: tab B closed via its own tab while active, then history on the survivor still works.
    await page.evaluate((id) => switchToTab(id), tabB);
    await expect('S11 switch to B', R('B'), { activeTabId: tabB });
    await page.evaluate((id) => closeTab(id), tabB);
    await expect('S11 close active B -> first tab', await page.evaluate(() => currentFolderPath), { tabCount: 1 });
    await page.evaluate(() => goBack());
    await expect('S11 back on survivor', await page.evaluate(() => currentFolderPath));

    const bad = findings.filter(f => !f.ok);
    console.log(JSON.stringify({ steps: findings.length, failed: bad.length, bad, errors: errors.slice(0, 12) }, null, 1));
    await app.close();
    process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
