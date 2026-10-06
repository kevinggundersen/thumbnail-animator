// Usage: node scripts/nav-smoke.js <isolated-profile-dir> <folder-with-subfolders>   (needs playwright-core; see perf-smoke.js)
/* global navigateToFolder, goBack, goForward, createTab, switchToTab, closeTab, tabs, activeTabId, currentFolderPath, vsState, navigationHistory, _navBusy, document, MouseEvent */
// Navigation correctness hunt: folder navigation, history, tabs, double-click,
// rapid changes, scroll restore. Reports mismatches and console/page errors.
const { _electron: electron } = require('playwright-core');
const fs = require('fs'); const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
(async () => {
    const appDir = 'F:/Github-repos/Personal/thumbnail-animator';
    const [profile, root] = process.argv.slice(2);
    const R = (...p) => path.join(root, ...p);
    const countMedia = (dir) => fs.readdirSync(dir).filter(f => /\.(jpg|png|webp|gif|mp4)$/i.test(f)).length;
    const countDirs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).length;
    const app = await electron.launch({ args: [appDir], cwd: appDir, env: { ...process.env, THUMBNAIL_ANIMATOR_USER_DATA: profile } });
    const page = await app.firstWindow();
    const errors = []; const findings = [];
    page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    await page.evaluate(({ f }) => { localStorage.clear(); localStorage.setItem('lastFolderPath', f); localStorage.setItem('rememberLastFolder', 'true'); localStorage.setItem('welcomeDismissedVersion', '9'); localStorage.setItem('aiAutoScan', 'false'); localStorage.setItem('zoomLevel', '70'); }, { f: root });
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.unmaximize(); w.setSize(1400, 900); w.center(); return true; });
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#grid-container .video-card, #grid-container .folder-card').length >= 5, null, { timeout: 60000 });
    await sleep(1500);

    const state = () => page.evaluate(() => ({
        folder: typeof currentFolderPath !== 'undefined' ? currentFolderPath : null,
        items: vsState.sortedItems.filter(i => i.type !== 'folder' && i.type !== 'group-header').length,
        folders: vsState.sortedItems.filter(i => i.type === 'folder').length,
        cards: document.querySelectorAll('#grid-container .video-card, #grid-container .folder-card').length,
        breadcrumb: (document.getElementById('breadcrumb') || document.querySelector('.breadcrumb, #breadcrumb-container') || {}).textContent?.replace(/\s+/g, ' ').trim().slice(0, 120),
        tabName: (tabs.find(t => t.id === activeTabId) || {}).name,
        tabPath: (tabs.find(t => t.id === activeTabId) || {}).path,
        tabCount: tabs.length,
        canBack: navigationHistory.canGoBack(),
        scrollTop: document.getElementById('grid-container').scrollTop,
        navBusy: typeof _navBusy !== 'undefined' ? _navBusy : null,
        activity: (document.getElementById('status-activity') || {}).textContent,
    }));
    const expect = async (label, dir, extra = {}) => {
        const s = await state();
        const problems = [];
        if (norm(s.folder) !== norm(dir)) problems.push(`folder=${s.folder} expected ${dir}`);
        const em = countMedia(dir), ed = countDirs(dir);
        if (s.items !== em) problems.push(`items=${s.items} expected ${em}`);
        if (s.folders !== ed) problems.push(`folders=${s.folders} expected ${ed}`);
        if (norm(s.tabPath) !== norm(dir)) problems.push(`activeTab.path=${s.tabPath} expected ${dir}`);
        if (s.navBusy) problems.push('navBusy still true');
        for (const [k, v] of Object.entries(extra)) if (s[k] !== v) problems.push(`${k}=${JSON.stringify(s[k])} expected ${JSON.stringify(v)}`);
        findings.push({ step: label, ok: problems.length === 0, problems, breadcrumb: s.breadcrumb, cards: s.cards });
    };
    const nav = async (dir, wait = 1200) => { await page.evaluate((d) => navigateToFolder(d), dir); await sleep(wait); };
    const settle = async () => { for (let i = 0; i < 40; i++) { if (!(await page.evaluate(() => typeof _navBusy !== 'undefined' && _navBusy))) break; await sleep(100); } };

    // 1. plain navigation + history
    await expect('start at root', root, { tabCount: 1 });
    await nav(R('A')); await expect('navigate A', R('A'));
    await nav(R('C')); await expect('navigate C', R('C'));
    await nav(R('C', 'deep')); await expect('navigate C/deep', R('C', 'deep'));
    await page.evaluate(() => goBack()); await sleep(1200); await expect('back -> C', R('C'));
    await page.evaluate(() => goBack()); await sleep(1200); await expect('back -> A', R('A'));
    await page.evaluate(() => goForward()); await sleep(1200); await expect('forward -> C', R('C'));
    await page.evaluate(() => goForward()); await sleep(1200); await expect('forward -> C/deep', R('C', 'deep'));

    // 2. double-click a folder card from root
    await nav(root);
    const dbl = await page.evaluate((target) => {
        const fc = [...document.querySelectorAll('#grid-container .folder-card')].find(c => String(c.dataset.folderPath).replace(/\\/g, '/').toLowerCase().endsWith(target));
        if (!fc) return false;
        fc.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
    }, '/tree/b');
    await sleep(1200);
    if (!dbl) findings.push({ step: 'click folder card B', ok: false, problems: ['folder card for B not found in root grid'] });
    else await expect('click folder card B', R('B'));

    // 2b. breadcrumb: click the parent segment to go up
    const crumb = await page.evaluate(() => { const items = [...document.querySelectorAll('.breadcrumb-item[data-path]')].filter(i => i.dataset.path !== 'computer'); const parent = items[items.length - 2]; if (!parent) return null; parent.click(); return parent.dataset.path; });
    await sleep(1200);
    if (!crumb) findings.push({ step: 'breadcrumb parent click', ok: false, problems: ['no parent breadcrumb segment found'] });
    else await expect('breadcrumb parent click', root);

    // 2c. sidebar: click the tree row for folder A
    const sidebarHit = await page.evaluate((target) => { const node = [...document.querySelectorAll('.tree-node[data-path]')].find(n => String(n.dataset.path).replace(/\\/g, '/').toLowerCase().endsWith(target)); if (!node) return false; const row = node.querySelector(':scope > .tree-node-row'); (row || node).click(); return true; }, '/tree/a');
    await sleep(1500);
    if (!sidebarHit) findings.push({ step: 'sidebar click A', ok: false, problems: ['tree node for A not visible in sidebar'] });
    else await expect('sidebar click A', R('A'));

    // 3. rapid navigation: three targets 60 ms apart; the last must win
    await page.evaluate(({ a, b, c }) => { navigateToFolder(a); setTimeout(() => navigateToFolder(b), 60); setTimeout(() => navigateToFolder(c), 120); }, { a: R('A'), b: R('C'), c: R('C', 'deep', 'deeper') });
    await sleep(2500); await settle();
    await expect('rapid A->C->deeper', R('C', 'deep', 'deeper'));
    await page.evaluate(() => goBack()); await sleep(1200);
    const afterRapidBack = await state();
    findings.push({ step: 'back after rapid (where does it land?)', ok: true, problems: [], info: afterRapidBack.folder });

    // 4. empty folder
    await nav(R('D-empty')); await expect('empty folder', R('D-empty'));
    await page.evaluate(() => goBack()); await sleep(1200);

    // 5. scroll position restore on back
    await nav(R('C'));
    await page.evaluate(() => { document.getElementById('grid-container').scrollTop = 600; });
    await sleep(400);
    const scrolledTop = await page.evaluate(() => document.getElementById('grid-container').scrollTop);
    await nav(R('A'));
    await page.evaluate(() => goBack()); await sleep(1500);
    const restored = await state();
    findings.push({ step: 'scroll restore on back to C', ok: Math.abs(restored.scrollTop - scrolledTop) < 50, problems: Math.abs(restored.scrollTop - scrolledTop) < 50 ? [] : [`scrollTop=${restored.scrollTop} expected ~${scrolledTop}`] });

    // 6. tabs: new tab to B, switch back, switch again, close
    await page.evaluate((b) => createTab(b, 'B'), R('B')); await sleep(1500);
    await expect('new tab B', R('B'), { tabCount: 2 });
    await page.evaluate(() => switchToTab(tabs[0].id)); await sleep(1500);
    await expect('switch to first tab (C after back)', R('C'));
    await page.evaluate(() => switchToTab(tabs[1].id)); await sleep(1500);
    await expect('switch to tab B again', R('B'));
    await page.evaluate(() => closeTab(tabs[1].id)); await sleep(1500);
    await expect('close tab B -> first tab', R('C'), { tabCount: 1 });

    // 7. forceReload of the current folder keeps the folder
    await page.evaluate(() => navigateToFolder(currentFolderPath, false, true)); await sleep(1500);
    await expect('forceReload current', R('C'));

    const bad = findings.filter(f => !f.ok);
    console.log(JSON.stringify({ steps: findings.length, failed: bad.length, bad, info: findings.filter(f => f.info).map(f => f.step + ': ' + f.info), errors: errors.slice(0, 12) }, null, 1));
    await app.close();
})().catch(e => { console.error(e); process.exit(1); });
