// ============================================================================
// PERFORMANCE DASHBOARD - Toggle with Ctrl+Shift+P
// Live panel showing real-time metrics. Zero overhead when hidden.
// ============================================================================

const perfTest = (() => {
    let visible = false;
    const history = {};  // { operationName: [{ duration, cardCount, itemCount, timestamp }] }
    const MAX_HISTORY = 30;
    let renderScheduled = false;
    let startupData = null;   // cached after first fetch
    let memoryData = null;    // refreshed on each show()
    let cacheData = null;     // refreshed on each show()

    // Thresholds for color coding (ms)
    const thresholds = {
        'applyFilters':       { fast: 5,   medium: 16  },
        'renderItems':        { fast: 30,  medium: 100 },
        'scanFolder (IPC)':   { fast: 100, medium: 500 },
        'navigateToFolder':   { fast: 150, medium: 600 },
        'processEntries':     { fast: 1,   medium: 8   },
        'vsCalculatePositions': { fast: 8, medium: 24  },
        'performCleanupCheck': { fast: 4, medium: 16  },
        'backgroundDimensions (IPC)': { fast: 50, medium: 200 },
        'openLightbox':       { fast: 10,  medium: 50  },
    };
    const defaultThreshold = { fast: 10, medium: 50 };

    function getSpeedClass(operation, duration) {
        const t = thresholds[operation] || defaultThreshold;
        if (duration <= t.fast) return 'fast';
        if (duration <= t.medium) return 'medium';
        return 'slow';
    }

    function getBarPercent(operation, duration) {
        const t = thresholds[operation] || defaultThreshold;
        // Bar fills to 100% at 2x the "slow" threshold
        return Math.min(100, (duration / (t.medium * 2)) * 100);
    }

    // Always measure, regardless of visibility — so metrics are ready when panel opens
    function start() {
        return performance.now();
    }

    function end(operation, startTime, details = {}) {
        if (startTime === 0) return;
        const duration = Math.round((performance.now() - startTime) * 100) / 100;
        if (!history[operation]) history[operation] = [];
        history[operation].push({ duration, timestamp: Date.now(), ...details });
        if (history[operation].length > MAX_HISTORY) history[operation].shift();
        if (visible) scheduleRender();
    }

    function scheduleRender() {
        if (renderScheduled) return;
        renderScheduled = true;
        requestAnimationFrame(() => {
            renderScheduled = false;
            renderDashboard();
        });
    }

    function renderDashboard() {
        const body = document.getElementById('perf-dashboard-body');
        if (!body) return;

        let html = '';

        // ── Startup Timeline ──
        if (startupData && startupData.length > 0) {
            const total = startupData[startupData.length - 1].time;
            html += '<div class="perf-section-label">Startup Timeline</div>';
            let prev = 0;
            for (const { phase, time } of startupData) {
                const delta = Math.round((time - prev) * 100) / 100;
                const pct = total > 0 ? Math.min(100, (delta / total) * 100) : 0;
                const cls = delta < 20 ? 'fast' : delta < 100 ? 'medium' : 'slow';
                html += `<div class="perf-metric perf-startup-row">
                    <div class="perf-metric-header">
                        <span class="perf-metric-name">${phase}</span>
                        <span class="perf-metric-last ${cls}">+${delta}ms</span>
                    </div>
                    <div class="perf-metric-bar-track">
                        <div class="perf-metric-bar ${cls}" style="width:${pct}%"></div>
                    </div>
                    <div class="perf-metric-detail">total: ${time}ms</div>
                </div>`;
                prev = time;
            }
            html += `<div class="perf-metric"><div class="perf-metric-stats"><span>Total startup: ${total}ms</span></div></div>`;
        }

        // ── Memory ──
        if (memoryData) {
            const fmt = (bytes) => (bytes / 1024 / 1024).toFixed(1) + 'MB';
            const rssMB = memoryData.rss / 1024 / 1024;
            const cls = rssMB < 300 ? 'fast' : rssMB < 600 ? 'medium' : 'slow';
            html += '<div class="perf-section-label">Memory (Main Process)</div>';
            html += `<div class="perf-metric">
                <div class="perf-metric-header">
                    <span class="perf-metric-name">RSS</span>
                    <span class="perf-metric-last ${cls}">${fmt(memoryData.rss)}</span>
                </div>
                <div class="perf-metric-bar-track">
                    <div class="perf-metric-bar ${cls}" style="width:${Math.min(100, rssMB / 10)}%"></div>
                </div>
                <div class="perf-metric-stats">
                    <span>Heap: ${fmt(memoryData.heapUsed)} / ${fmt(memoryData.heapTotal)}</span>
                    <span>External: ${fmt(memoryData.external)}</span>
                </div>
            </div>`;
        }

        // ── Disk Cache ──
        if (cacheData) {
            const fmt = (bytes) => bytes < 1024 * 1024 ? (bytes / 1024).toFixed(0) + 'KB' : (bytes / 1024 / 1024).toFixed(1) + 'MB';
            html += '<div class="perf-section-label">Disk Cache</div>';
            for (const [label, info] of [['Video thumbs', cacheData.video], ['Image thumbs', cacheData.image], ['Folder previews', cacheData.folder]]) {
                if (!info) continue;
                const pct = info.maxSize ? Math.min(100, (info.size / info.maxSize) * 100) : 0;
                const cls = pct < 60 ? 'fast' : pct < 90 ? 'medium' : 'slow';
                html += `<div class="perf-metric">
                    <div class="perf-metric-header">
                        <span class="perf-metric-name">${label}</span>
                        <span class="perf-metric-last ${cls}">${fmt(info.size)}</span>
                    </div>
                    ${info.maxSize ? `<div class="perf-metric-bar-track"><div class="perf-metric-bar ${cls}" style="width:${pct}%"></div></div>` : ''}
                    <div class="perf-metric-stats"><span>${info.files} files</span>${info.maxSize ? `<span>limit: ${fmt(info.maxSize)}</span>` : ''}</div>
                </div>`;
            }
        }

        // ── Live Metrics ──
        const ops = Object.keys(history);
        if (ops.length === 0 && !startupData && !memoryData && !cacheData) {
            body.innerHTML = '<div class="perf-empty">Use the app to see live metrics</div>';
            return;
        }

        if (ops.length > 0) {
            html += '<div class="perf-section-label">Live Metrics</div>';
        }

        // Build HTML in one pass
        for (const op of ops) {
            const entries = history[op];
            const durations = entries.map(e => e.duration);
            const last = durations[durations.length - 1];
            const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
            const min = Math.min(...durations);
            const max = Math.max(...durations);
            const lastEntry = entries[entries.length - 1];
            const speedClass = getSpeedClass(op, last);
            const barPercent = getBarPercent(op, last);

            const detail = lastEntry.detail ||
                (lastEntry.cardCount != null ? `${lastEntry.cardCount} cards`
                    : (lastEntry.itemCount != null ? `${lastEntry.itemCount} items` : ''));

            html += `<div class="perf-metric">
                <div class="perf-metric-header">
                    <span class="perf-metric-name">${op}</span>
                    <span class="perf-metric-last ${speedClass}">${last}ms</span>
                </div>
                <div class="perf-metric-bar-track">
                    <div class="perf-metric-bar ${speedClass}" style="width:${barPercent}%"></div>
                </div>
                <div class="perf-metric-stats">
                    <span>avg ${avg.toFixed(1)}ms</span>
                    <span>min ${min}ms</span>
                    <span>max ${max}ms</span>
                    <span>${entries.length} samples</span>
                </div>
                ${detail ? `<div class="perf-metric-detail">${detail}</div>` : ''}
            </div>`;
        }
        body.innerHTML = html;
    }

    async function show() {
        visible = true;
        const el = document.getElementById('perf-dashboard');
        if (el) el.classList.remove('hidden');

        // Fetch startup timeline (once), memory and cache info (every open)
        try {
            if (!startupData && window.electronAPI?.getStartupTimeline) {
                const startResult = await window.electronAPI.getStartupTimeline();
                startupData = startResult?.ok ? startResult.value : startResult;
            }
            if (window.electronAPI?.getMemoryInfo) {
                const memResult = await window.electronAPI.getMemoryInfo();
                memoryData = memResult?.ok ? memResult.value : memResult;
            }
            if (window.electronAPI?.getCacheInfo) {
                const cacheResult = await window.electronAPI.getCacheInfo();
                cacheData = cacheResult?.ok ? cacheResult.value : cacheResult;
            }
        } catch { /* IPC not available */ }

        renderDashboard();
    }

    function hide() {
        visible = false;
        const el = document.getElementById('perf-dashboard');
        if (el) el.classList.add('hidden');
    }

    function toggle() {
        if (visible) hide(); else show();
    }

    function clear() {
        for (const key of Object.keys(history)) delete history[key];
        renderDashboard();
    }

    function isVisible() { return visible; }

    // Wire up controls once DOM is ready
    function init() {
        const closeBtn = document.getElementById('perf-close-btn');
        const clearBtn = document.getElementById('perf-clear-btn');
        if (closeBtn) closeBtn.addEventListener('click', hide);
        if (clearBtn) clearBtn.addEventListener('click', clear);

        // Make panel draggable via header
        const panel = document.getElementById('perf-dashboard');
        const header = panel?.querySelector('.perf-dashboard-header');
        if (panel && header) {
            let dragging = false, offsetX = 0, offsetY = 0;
            header.addEventListener('mousedown', (e) => {
                if (e.target.closest('.perf-btn')) return;
                dragging = true;
                const rect = panel.getBoundingClientRect();
                offsetX = e.clientX - rect.left;
                offsetY = e.clientY - rect.top;
                panel.style.transition = 'none';
            });
            document.addEventListener('mousemove', (e) => {
                if (!dragging) return;
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
                panel.style.left = Math.max(0, e.clientX - offsetX) + 'px';
                panel.style.top = Math.max(0, e.clientY - offsetY) + 'px';
            });
            document.addEventListener('mouseup', () => {
                if (dragging) {
                    dragging = false;
                    panel.style.transition = '';
                }
            });
        }
    }

    init();

    return { start, end, toggle, show, hide, clear, isVisible };
})();

// Keyboard shortcut: Ctrl+Shift+P to toggle perf dashboard
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        e.preventDefault();
        perfTest.toggle();
    }
});
