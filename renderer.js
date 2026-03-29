// ============================================================================
// PERFORMANCE DASHBOARD - Toggle with Ctrl+Shift+P
// Live panel showing real-time metrics. Zero overhead when hidden.
// ============================================================================

const perfTest = (() => {
    let visible = false;
    const history = {};  // { operationName: [{ duration, cardCount, itemCount, timestamp }] }
    const MAX_HISTORY = 30;
    let renderScheduled = false;

    // Thresholds for color coding (ms)
    const thresholds = {
        'applyFilters':       { fast: 5,   medium: 16  },
        'renderItems':        { fast: 30,  medium: 100 },
        'scanFolder (IPC)':   { fast: 100, medium: 500 },
        'navigateToFolder':   { fast: 150, medium: 600 },
        'processEntries':     { fast: 1,   medium: 8   },
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

        const ops = Object.keys(history);
        if (ops.length === 0) {
            body.innerHTML = '<div class="perf-empty">Use the app to see live metrics</div>';
            return;
        }

        // Build HTML in one pass
        let html = '';
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

            // Detail line (card/item count from last measurement)
            let detail = '';
            if (lastEntry.cardCount != null) detail = `${lastEntry.cardCount} cards`;
            else if (lastEntry.itemCount != null) detail = `${lastEntry.itemCount} items`;

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

    function show() {
        visible = true;
        const el = document.getElementById('perf-dashboard');
        if (el) el.classList.remove('hidden');
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

// ============================================================================
// CONFIGURATION CONSTANTS - Adjust these values to fine-tune performance
// ============================================================================

// Media Loading Configuration
const MAX_VIDEOS = 120; // Max concurrent videos
const MAX_IMAGES = 120; // Max concurrent images
const MAX_TOTAL_MEDIA = MAX_VIDEOS + MAX_IMAGES; // Total media limit
const PARALLEL_LOAD_LIMIT = 10; // Load up to N items in parallel for faster initial load
const PRELOAD_BUFFER_PX = 1000; // Preload content N pixels before it enters viewport

// Scale parallel load limit based on zoom level - at lower zoom, more cards are visible
function getEffectiveLoadLimit() {
    const scaleFactor = Math.max(1, Math.pow(100 / zoomLevel, 1.5));
    return Math.min(Math.round(PARALLEL_LOAD_LIMIT * scaleFactor), 60);
}

// Cleanup & Performance Configuration
const CLEANUP_COOLDOWN_MS = 5; // Cooldown between cleanup operations (ms)
const CLEANUP_IDLE_INTERVAL_MS = 200; // Low-frequency safety cleanup while idle (ms)
const VIEWPORT_CACHE_TTL = 100; // Cache viewport bounds for N ms
const MEDIA_COUNT_CACHE_TTL = 50; // Cache media counts for N ms

// Progressive Rendering Configuration
const PROGRESSIVE_RENDER_THRESHOLD = 1000; // Use progressive rendering for N+ items
const PROGRESSIVE_RENDER_CHUNK_SIZE = 50; // Render N items per frame
const PROGRESSIVE_RENDER_INITIAL_CHUNK = 100; // Render first N items immediately

// Scroll & Observer Configuration
const SCROLL_DEBOUNCE_MS = 150; // Debounce cleanup after scroll stops (ms)
const OBSERVER_CLEANUP_THROTTLE_MS = 16; // Throttle IntersectionObserver cleanup to ~60fps (ms)

// Retry Configuration
const MAX_RETRY_ATTEMPTS = 5; // Maximum number of retry attempts per card
const RETRY_INITIAL_DELAY_MS = 500; // Initial retry delay (ms)
const RETRY_BACKOFF_MULTIPLIER = 2; // Exponential backoff multiplier
const RETRY_MAX_DELAY_MS = 5000; // Maximum delay between retries (ms)

// Cache Configuration
const FOLDER_CACHE_TTL = 30000; // Tab cache TTL (30 seconds)
const GLOBAL_CACHE_TTL = 60000; // Global folder cache TTL (60 seconds)
const INDEXEDDB_CACHE_TTL = 3600000; // IndexedDB persistent cache TTL (1 hour)

// IndexedDB Configuration
const DB_NAME = 'ThumbnailAnimatorCache';
const DB_VERSION = 2;
const STORE_NAME = 'folderCache';
const DIMENSIONS_STORE = 'dimensionCache';

// ============================================================================
// END CONFIGURATION CONSTANTS
// ============================================================================

// --- Batched localStorage writes ---
// Collects pending writes and flushes them together in the next idle frame
const _pendingStorageWrites = new Map();
let _storageFlushScheduled = false;
function deferLocalStorageWrite(key, value) {
    _pendingStorageWrites.set(key, value);
    if (!_storageFlushScheduled) {
        _storageFlushScheduled = true;
        if ('requestIdleCallback' in window) {
            requestIdleCallback(_flushStorageWrites, { timeout: 200 });
        } else {
            setTimeout(_flushStorageWrites, 50);
        }
    }
}
function _flushStorageWrites() {
    _storageFlushScheduled = false;
    for (const [key, value] of _pendingStorageWrites) {
        localStorage.setItem(key, value);
    }
    _pendingStorageWrites.clear();
}

// Get DOM elements - these are safe to get at script load time since script is at end of body
const selectFolderBtn = document.getElementById('select-folder-btn');
const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
let currentPathSpan = document.getElementById('current-path');
const breadcrumbContainer = document.getElementById('breadcrumb-container');
const gridContainer = document.getElementById('grid-container');

// Safety check
if (!breadcrumbContainer) {
    console.error('breadcrumbContainer not found!');
}
if (!gridContainer) {
    console.error('gridContainer not found!');
}
const searchBox = document.getElementById('search-box');
const itemCountEl = document.getElementById('item-count');

// Status bar elements
const statusActivity = document.getElementById('status-activity');
const statusItemCounts = document.getElementById('status-item-counts');
const statusFilterInfo = document.getElementById('status-filter-info');
const statusSelectionInfo = document.getElementById('status-selection-info');
const statusLayoutMode = document.getElementById('status-layout-mode');
const statusZoomLevel = document.getElementById('status-zoom-level');

function setStatusActivity(msg) {
    if (statusActivity) statusActivity.textContent = msg || '';
}

// Debounced clear for "Loading media..." — fires after media load burst settles
let _mediaSettleTimer = null;
function scheduleMediaLoadSettle() {
    clearTimeout(_mediaSettleTimer);
    _mediaSettleTimer = setTimeout(() => {
        if (statusActivity && statusActivity.textContent === 'Loading media...') {
            setStatusActivity('');
        }
    }, 1500);
}

// Make keyboard hint in status bar clickable
document.querySelectorAll('.status-keyboard-hint').forEach(el => {
    el.addEventListener('click', () => toggleShortcutsOverlay());
});
const filterAllBtn = document.getElementById('filter-all');
const filterVideosBtn = document.getElementById('filter-videos');
const filterImagesBtn = document.getElementById('filter-images');
const filterAudioBtn = document.getElementById('filter-audio');
const settingsBtn = document.getElementById('settings-btn');
const settingsDropdown = document.getElementById('settings-dropdown');
const layoutModeToggle = document.getElementById('layout-mode-toggle');
const layoutModeLabel = document.getElementById('layout-mode-label');
const rememberFolderToggle = document.getElementById('remember-folder-toggle');
const rememberFolderLabel = document.getElementById('remember-folder-label');
const includeMovingImagesToggle = document.getElementById('include-moving-images-toggle');
const includeMovingImagesLabel = document.getElementById('include-moving-images-label');
const sortTypeSelect = document.getElementById('sort-type-select');
const sortOrderSelect = document.getElementById('sort-order-select');
const themeSelect = document.getElementById('theme-select');
const thumbnailQualitySelect = document.getElementById('thumbnail-quality-select');
const pauseOnLightboxToggle = document.getElementById('pause-on-lightbox-toggle');
const pauseOnLightboxLabel = document.getElementById('pause-on-lightbox-label');
const pauseOnBlurToggle = document.getElementById('pause-on-blur-toggle');
const pauseOnBlurLabel = document.getElementById('pause-on-blur-label');
const autoRepeatToggle = document.getElementById('auto-repeat-toggle');
const autoRepeatLabel = document.getElementById('auto-repeat-label');
const zoomSlider = document.getElementById('zoom-slider');
const zoomValue = document.getElementById('zoom-value');
const favoritesBtn = document.getElementById('favorites-btn');
const favoritesDropdown = document.getElementById('favorites-dropdown');
const favoritesList = document.getElementById('favorites-list');
const addFavoriteBtn = document.getElementById('add-favorite-btn');
const recentFilesBtn = document.getElementById('recent-files-btn');
const recentFilesDropdown = document.getElementById('recent-files-dropdown');
const recentFilesList = document.getElementById('recent-files-list');
const clearRecentBtn = document.getElementById('clear-recent-btn');
const tabsContainer = document.getElementById('tabs-container');
const videoScrubber = document.getElementById('video-scrubber');
const scrubberCanvas = document.getElementById('scrubber-canvas');
const scrubberTime = document.getElementById('scrubber-time');
const loadingIndicator = document.getElementById('loading-indicator');
const folderSidebar = document.getElementById('folder-sidebar');
const sidebarTree = document.getElementById('sidebar-tree');
const sidebarResizeHandle = document.getElementById('sidebar-resize-handle');
const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
const sidebarCollapseBtn = document.getElementById('sidebar-collapse-btn');

// Track current folder path for navigation
let currentFolderPath = null;

// Store current items for re-sorting without re-fetching
let currentItems = [];

// Track current filter state
let currentFilter = 'all'; // 'all', 'video', 'image', 'audio'

// Track layout mode: 'masonry' (dynamic) or 'grid' (rigid row-based)
let layoutMode = 'masonry'; // Default to masonry

// Track whether to remember last folder
let rememberLastFolder = true; // Default to true

// Track whether to include moving images (gif, webp) in image filter
let includeMovingImages = true; // Default to true

// Track whether to pause thumbnails on lightbox open and window blur
let pauseOnLightbox = true;
let pauseOnBlur = true;

// Track sorting preferences
let sortType = 'name'; // 'name' or 'date'
let sortOrder = 'ascending'; // 'ascending' or 'descending'

// Track theme
let currentTheme = 'dark'; // 'dark' or 'light'

// Track thumbnail quality
let thumbnailQuality = 'medium'; // 'low', 'medium', 'high'

// Track ffmpeg availability for video thumbnail generation
let hasFfmpegAvailable = false;

// Track zoom level
let zoomLevel = 100; // Percentage

// Track favorites
let favorites = []; // Array of { path, name }

// Track recent files
let recentFiles = []; // Array of { path, name, url, type, timestamp }

// Track tabs
let tabs = []; // Array of { id, path, name, sortType, sortOrder }
let activeTabId = null;
let tabIdCounter = 0;

// Track lightbox navigation
let currentLightboxIndex = -1;
let lightboxItems = []; // Filtered items for lightbox navigation

// Track star ratings
let fileRatings = {}; // Map<filePath, rating (1-5)>

// Track advanced search filters
let advancedSearchFilters = {
    sizeOperator: '',
    sizeValue: null,
    dateFrom: null,
    dateTo: null,
    width: null,
    height: null,
    aspectRatio: '',
    starRating: ''
};

// Track video playback state
let videoPlaybackSpeed = 1.0;
let videoLoop = false;
let videoRepeat = false;
let autoRepeatVideos = false;

// Track progress
let currentProgress = null; // { current: number, total: number, cancelled: boolean }

// Cache folder contents per tab to avoid re-scanning
const tabContentCache = new Map(); // Map<tabId, { items, timestamp }>
const tabDomCache = new Map(); // Map<tabId, { fragment, scrollTop, layoutMode, timestamp }>

// Cache folder contents globally (for recently accessed folders)
const folderCache = new Map(); // Map<folderPath, { items, timestamp }>

// IndexedDB persistent cache
let db = null;

// Initialize IndexedDB
async function initIndexedDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                const objectStore = database.createObjectStore(STORE_NAME, { keyPath: 'path' });
                objectStore.createIndex('timestamp', 'timestamp', { unique: false });
            }
            if (!database.objectStoreNames.contains(DIMENSIONS_STORE)) {
                database.createObjectStore(DIMENSIONS_STORE, { keyPath: 'key' });
            }
        };
    });
}

// Store folder contents in IndexedDB
async function storeFolderInIndexedDB(folderPath, items) {
    if (!db) {
        try {
            await initIndexedDB();
        } catch (error) {
            console.warn('IndexedDB not available:', error);
            return;
        }
    }
    
    try {
        const normalizedPath = normalizePath(folderPath);
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        await store.put({
            path: normalizedPath,
            items: items,
            timestamp: Date.now()
        });
    } catch (error) {
        console.warn('Failed to store folder in IndexedDB:', error);
    }
}

// Retrieve folder contents from IndexedDB
async function getFolderFromIndexedDB(folderPath) {
    if (!db) {
        try {
            await initIndexedDB();
        } catch (error) {
            console.warn('IndexedDB not available:', error);
            return null;
        }
    }
    
    try {
        const normalizedPath = normalizePath(folderPath);
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(normalizedPath);
        
        return new Promise((resolve) => {
            request.onsuccess = () => {
                const result = request.result;
                if (result) {
                    const age = Date.now() - result.timestamp;
                    if (age < INDEXEDDB_CACHE_TTL) {
                        resolve(result.items);
                    } else {
                        // Cache expired, remove it
                        const deleteTransaction = db.transaction([STORE_NAME], 'readwrite');
                        deleteTransaction.objectStore(STORE_NAME).delete(normalizedPath);
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => resolve(null);
        });
    } catch (error) {
        console.warn('Failed to retrieve folder from IndexedDB:', error);
        return null;
    }
}

// Remove folder from IndexedDB cache
async function removeFolderFromIndexedDB(folderPath) {
    if (!db) return;
    
    try {
        const normalizedPath = normalizePath(folderPath);
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        await store.delete(normalizedPath);
    } catch (error) {
        console.warn('Failed to remove folder from IndexedDB:', error);
    }
}

// Clean up old IndexedDB entries
async function cleanupIndexedDBCache() {
    if (!db) {
        try {
            await initIndexedDB();
        } catch (error) {
            return;
        }
    }
    
    try {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('timestamp');
        const now = Date.now();
        
        const request = index.openCursor();
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                const age = now - cursor.value.timestamp;
                if (age >= INDEXEDDB_CACHE_TTL) {
                    cursor.delete();
                }
                cursor.continue();
            }
        };
    } catch (error) {
        console.warn('Failed to cleanup IndexedDB cache:', error);
    }
}

// --- Dimension Cache ---
// Persists image/video dimensions across sessions so repeat folder visits
// don't need to re-scan file headers. Key = "filePath|mtimeMs".

/**
 * Look up cached dimensions for a batch of files.
 * @param {Array<{path: string, mtime: number}>} files
 * @returns {Promise<Map<string, {width: number, height: number}>>} map of filePath -> dimensions
 */
async function getCachedDimensions(files) {
    const result = new Map();
    if (!db || files.length === 0) return result;

    try {
        const transaction = db.transaction([DIMENSIONS_STORE], 'readonly');
        const store = transaction.objectStore(DIMENSIONS_STORE);

        const promises = files.map(f => {
            const key = `${f.path}|${f.mtime || 0}`;
            return new Promise(resolve => {
                const req = store.get(key);
                req.onsuccess = () => {
                    if (req.result && req.result.width && req.result.height) {
                        result.set(f.path, { width: req.result.width, height: req.result.height });
                    }
                    resolve();
                };
                req.onerror = () => resolve();
            });
        });

        await Promise.all(promises);
    } catch {
        // Ignore errors — dimensions will just be re-scanned
    }

    return result;
}

/**
 * Store dimensions for a batch of files.
 * @param {Array<{path: string, mtime: number, width: number, height: number}>} entries
 */
async function cacheDimensions(entries) {
    if (!db || entries.length === 0) return;

    try {
        const transaction = db.transaction([DIMENSIONS_STORE], 'readwrite');
        const store = transaction.objectStore(DIMENSIONS_STORE);

        for (const e of entries) {
            if (e.width && e.height) {
                store.put({
                    key: `${e.path}|${e.mtime || 0}`,
                    width: e.width,
                    height: e.height
                });
            }
        }
    } catch {
        // Ignore errors — caching is best-effort
    }
}

// Initialize IndexedDB on page load
initIndexedDB().catch(() => {
    // IndexedDB not available, continue without persistent cache
    console.warn('IndexedDB initialization failed, using memory cache only');
});

// Normalize path for consistent cache lookups (handle Windows path variations)
function normalizePath(path) {
    if (!path) return path;
    // Normalize separators and remove trailing separators
    return path.replace(/\\/g, '/').replace(/\/+$/, '') || path;
}

// ============================================================================
// FOLDER TREE SIDEBAR
// ============================================================================

let sidebarWidth = parseInt(localStorage.getItem('sidebarWidth')) || 260;
let sidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
let sidebarExpandedNodes;
try {
    sidebarExpandedNodes = new Set(JSON.parse(localStorage.getItem('sidebarExpandedNodes') || '[]'));
} catch (e) {
    console.warn('Failed to parse sidebarExpandedNodes from localStorage, resetting:', e);
    localStorage.removeItem('sidebarExpandedNodes');
    sidebarExpandedNodes = new Set();
}

function saveSidebarExpandedNodes() {
    deferLocalStorageWrite('sidebarExpandedNodes', JSON.stringify([...sidebarExpandedNodes]));
}

function createTreeNode(item, depth, isDrive = false) {
    const node = document.createElement('div');
    node.className = 'tree-node';
    node.dataset.path = item.path;

    const row = document.createElement('div');
    row.className = 'tree-node-row';
    row.style.paddingLeft = `${depth * 16 + 8}px`;

    // Toggle arrow
    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle' + (item.hasChildren === false && !isDrive ? ' no-children' : '');
    toggle.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';

    // Folder icon
    const icon = document.createElement('span');
    icon.className = 'tree-node-icon';
    if (isDrive) {
        icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>';
    } else {
        icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>';
    }

    // Label
    const label = document.createElement('span');
    label.className = 'tree-node-label';
    label.textContent = item.name;
    label.title = item.path;

    row.appendChild(toggle);
    row.appendChild(icon);
    row.appendChild(label);

    // Children container
    const children = document.createElement('div');
    children.className = 'tree-children';

    node.appendChild(row);
    node.appendChild(children);

    // Click on row navigates to folder
    row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target.closest('.tree-toggle') && (item.hasChildren !== false || isDrive)) {
            toggleTreeNode(node, depth, isDrive);
        } else {
            navigateToFolder(item.path);
        }
    });

    // Double-click toggle to expand
    toggle.addEventListener('dblclick', (e) => e.stopPropagation());

    return node;
}

async function toggleTreeNode(node, depth, isDrive = false) {
    const children = node.querySelector('.tree-children');
    const toggle = node.querySelector('.tree-toggle');
    const nodePath = node.dataset.path;

    if (children.classList.contains('expanded')) {
        // Collapse
        children.classList.remove('expanded');
        toggle.classList.remove('expanded');
        sidebarExpandedNodes.delete(nodePath);
        saveSidebarExpandedNodes();
        return;
    }

    // Expand
    toggle.classList.add('expanded');
    children.classList.add('expanded');
    sidebarExpandedNodes.add(nodePath);
    saveSidebarExpandedNodes();

    // If children already loaded, don't reload
    if (children.dataset.loaded === '1') return;

    // Show loading indicator
    const loading = document.createElement('div');
    loading.className = 'tree-loading';
    loading.textContent = 'Loading...';
    children.appendChild(loading);

    try {
        const subdirs = await window.electronAPI.listSubdirectories(nodePath);
        children.innerHTML = ''; // remove loading indicator
        children.dataset.loaded = '1';

        for (const subdir of subdirs) {
            const childNode = createTreeNode(subdir, depth + 1);
            children.appendChild(childNode);
            // If this child was previously expanded, restore it
            if (sidebarExpandedNodes.has(subdir.path)) {
                toggleTreeNode(childNode, depth + 1);
            }
        }
        if (subdirs.length === 0) {
            // No subfolders — collapse immediately and hide the arrow
            toggle.classList.remove('expanded');
            toggle.classList.add('no-children');
            children.classList.remove('expanded');
            sidebarExpandedNodes.delete(nodePath);
            saveSidebarExpandedNodes();
        }
    } catch (err) {
        children.innerHTML = '';
        toggle.classList.remove('expanded');
        toggle.classList.add('no-children');
        children.classList.remove('expanded');
        sidebarExpandedNodes.delete(nodePath);
        saveSidebarExpandedNodes();
    }
}

// Normalize a path for sidebar comparisons — lowercase, forward slashes, no trailing slash
function sidebarNormalize(p) {
    if (!p) return '';
    return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function sidebarHighlightActive(folderPath) {
    if (!folderPath || !sidebarTree) return;
    const target = sidebarNormalize(folderPath);

    // Clear previous highlight
    const prev = sidebarTree.querySelector('.tree-node-row.active');
    if (prev) prev.classList.remove('active');

    // First try to find the node already in the DOM
    const allNodes = sidebarTree.querySelectorAll('.tree-node');
    for (const node of allNodes) {
        if (sidebarNormalize(node.dataset.path) === target) {
            const row = node.querySelector(':scope > .tree-node-row');
            if (row) {
                row.classList.add('active');
                row.scrollIntoView({ block: 'nearest' });
            }
            return;
        }
    }

    // Node not in DOM yet — expand the tree to it, then highlight
    sidebarExpandToPath(folderPath);
}

async function sidebarExpandToPath(folderPath) {
    if (!folderPath || !sidebarTree) return;

    // Parse the path into segments  (e.g. "C:\Users\foo" → ["C:", "Users", "foo"])
    const normalized = folderPath.replace(/\//g, '\\');
    const parts = normalized.split('\\').filter(Boolean);
    if (parts.length === 0) return;

    // Build the drive path (e.g. "C:\")
    const drivePart = parts[0].endsWith(':') ? parts[0] + '\\' : parts[0];

    // Find the drive node
    let driveNode = null;
    for (const node of sidebarTree.querySelectorAll(':scope > .tree-node')) {
        if (sidebarNormalize(node.dataset.path) === sidebarNormalize(drivePart)) {
            driveNode = node;
            break;
        }
    }
    if (!driveNode) return;

    // Expand drive if needed
    const driveChildren = driveNode.querySelector('.tree-children');
    if (!driveChildren.classList.contains('expanded')) {
        await toggleTreeNode(driveNode, 0, true);
    }

    // Walk down the remaining path segments
    let parentContainer = driveChildren;
    let currentPath = drivePart;

    for (let i = 1; i < parts.length; i++) {
        currentPath = currentPath.replace(/\\$/, '') + '\\' + parts[i];
        const targetNorm = sidebarNormalize(currentPath);

        // Wait a tick so freshly-appended children are queryable
        await new Promise(r => setTimeout(r, 10));

        let found = null;
        for (const node of parentContainer.querySelectorAll(':scope > .tree-node')) {
            if (sidebarNormalize(node.dataset.path) === targetNorm) {
                found = node;
                break;
            }
        }
        if (!found) break;

        // Expand intermediate segments, and also the last segment so its children show
        const childContainer = found.querySelector('.tree-children');
        if (!childContainer.classList.contains('expanded')) {
            await toggleTreeNode(found, i);
        }
        parentContainer = childContainer;

        // On the final segment, highlight it
        if (i === parts.length - 1) {
            const prev = sidebarTree.querySelector('.tree-node-row.active');
            if (prev) prev.classList.remove('active');
            const row = found.querySelector(':scope > .tree-node-row');
            if (row) {
                row.classList.add('active');
                row.scrollIntoView({ block: 'nearest' });
            }
        }
    }
}

function initSidebarResize() {
    let isResizing = false;

    sidebarResizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        sidebarResizeHandle.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const newWidth = Math.min(500, Math.max(180, e.clientX));
        folderSidebar.style.width = newWidth + 'px';
        sidebarWidth = newWidth;
    });

    document.addEventListener('mouseup', () => {
        if (!isResizing) return;
        isResizing = false;
        sidebarResizeHandle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        deferLocalStorageWrite('sidebarWidth', sidebarWidth.toString());
    });
}

function setSidebarCollapsed(collapsed) {
    sidebarCollapsed = collapsed;
    if (collapsed) {
        folderSidebar.classList.add('collapsed');
    } else {
        folderSidebar.classList.remove('collapsed');
    }
    deferLocalStorageWrite('sidebarCollapsed', collapsed.toString());
}

async function initSidebar() {
    if (!folderSidebar || !sidebarTree) return;

    // Restore width and collapsed state
    folderSidebar.style.width = sidebarWidth + 'px';
    if (sidebarCollapsed) {
        folderSidebar.classList.add('collapsed');
    }

    // Toggle buttons
    if (sidebarToggleBtn) {
        sidebarToggleBtn.addEventListener('click', () => setSidebarCollapsed(!sidebarCollapsed));
    }
    if (sidebarCollapseBtn) {
        sidebarCollapseBtn.addEventListener('click', () => setSidebarCollapsed(true));
    }

    // Resize handle
    initSidebarResize();

    // Load drive nodes
    try {
        const drives = await window.electronAPI.getDrives();
        if (drives && drives.length > 0) {
            for (const drive of drives) {
                const node = createTreeNode(
                    { name: drive.name, path: drive.path, hasChildren: true },
                    0,
                    true
                );
                sidebarTree.appendChild(node);
                // Restore expanded state
                if (sidebarExpandedNodes.has(drive.path)) {
                    toggleTreeNode(node, 0, true);
                }
            }
        } else {
            // Non-Windows: show root
            const node = createTreeNode(
                { name: '/', path: '/', hasChildren: true },
                0,
                true
            );
            sidebarTree.appendChild(node);
            if (sidebarExpandedNodes.has('/')) {
                toggleTreeNode(node, 0, true);
            }
        }
    } catch (err) {
        console.error('Failed to load drives for sidebar:', err);
    }
}

// Function to invalidate cache for a folder and its parent
async function invalidateFolderCache(folderPath) {
    const normalizedPath = normalizePath(folderPath);
    
    // Remove from IndexedDB cache
    await removeFolderFromIndexedDB(folderPath);
    
    // Invalidate the folder itself (try both normalized and original)
    folderCache.delete(normalizedPath);
    folderCache.delete(folderPath);
    
    // Invalidate parent folder cache (since file list changed)
    const pathParts = normalizedPath.split('/');
    if (pathParts.length > 1) {
        const parentPath = pathParts.slice(0, -1).join('/');
        folderCache.delete(parentPath);
    }
    
    // Invalidate all tab caches that reference this folder
    tabContentCache.forEach((cache, tabId) => {
        const cachePathNormalized = normalizePath(cache.path);
        if (cachePathNormalized === normalizedPath || cache.path === folderPath) {
            tabContentCache.delete(tabId);
        }
    });
}

// Track currently focused card for keyboard navigation
let focusedCardIndex = -1;
let visibleCards = [];

// Video scrubber state
let scrubberCard = null;

// Navigation history for back/forward functionality (per-tab)
const navigationHistory = {
    _getTab() {
        return tabs.find(t => t.id === activeTabId);
    },

    add(path) {
        const tab = this._getTab();
        if (!tab) return;
        // Remove any paths after current index (when navigating forward then going back)
        tab.historyPaths = tab.historyPaths.slice(0, tab.historyIndex + 1);
        // Add new path
        tab.historyPaths.push(path);
        tab.historyIndex = tab.historyPaths.length - 1;
        this.updateButtons();
    },

    canGoBack() {
        const tab = this._getTab();
        return tab ? tab.historyIndex > 0 : false;
    },

    canGoForward() {
        const tab = this._getTab();
        return tab ? tab.historyIndex < tab.historyPaths.length - 1 : false;
    },

    goBack() {
        const tab = this._getTab();
        if (tab && tab.historyIndex > 0) {
            tab.historyIndex--;
            this.updateButtons();
            return tab.historyPaths[tab.historyIndex];
        }
        return null;
    },

    goForward() {
        const tab = this._getTab();
        if (tab && tab.historyIndex < tab.historyPaths.length - 1) {
            tab.historyIndex++;
            this.updateButtons();
            return tab.historyPaths[tab.historyIndex];
        }
        return null;
    },

    updateButtons() {
        backBtn.disabled = !this.canGoBack();
        forwardBtn.disabled = !this.canGoForward();
    }
};

// Lightbox Elements
const lightbox = document.getElementById('lightbox');
const lightboxVideo = document.getElementById('lightbox-video');
const lightboxImage = document.getElementById('lightbox-image');
const closeLightboxBtn = document.getElementById('close-lightbox');
const lightboxZoomSlider = document.getElementById('lightbox-zoom-slider');
const lightboxZoomValue = document.getElementById('lightbox-zoom-value');

// Lightbox zoom state
let currentZoomLevel = 100;
let cachedZoomValue = 1.0; // Cache zoom value to avoid recalculation during panning
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let currentTranslateX = 0;
let currentTranslateY = 0;

// Context Menu Elements
const contextMenu = document.getElementById('context-menu');
let contextMenuTargetCard = null;

// Rename Dialog Elements
const renameDialog = document.getElementById('rename-dialog');
const renameInput = document.getElementById('rename-input');
const renameCancelBtn = document.getElementById('rename-cancel-btn');
const renameConfirmBtn = document.getElementById('rename-confirm-btn');
let renamePendingFile = null;

// Tiny 1x1 WebM to flush the decoder - converted to Blob URL once to avoid repeated base64 decoding
const BLANK_VIDEO = (() => {
    const b64 = 'GkXfo0AgQoaBAUL3gQFC8oEEQvOBCEKCQAR3ZWJtQoeBAkKFgQIYU4BnQI0VSalmQCgq17FAAw9CQE2AQAZ3aGFtbXlXQUAGd2hhbW15RIlACECPQAAAAAAAFlSua0AxrkAu14EBY8WBAZyBACK1nEADdW5khkAFVl9WUDglhohAA1ZQOIOBAeWBAOGHgQfBQAAAAAAAAEe4gQKGhkACLMhkAGw=';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }));
})();

// --- Manual GC Helper ---
let gcTimeout;
function scheduleGC() {
    clearTimeout(gcTimeout);
    gcTimeout = setTimeout(() => {
        // console.log('Triggering Manual GC');
        window.electronAPI.triggerGC();
    }, 1000); // Wait 1s after last action to trigger GC
}

// --- Track all video cards for periodic cleanup check ---
const videoCards = new WeakSet();

// --- Periodic cleanup check to catch videos that IntersectionObserver might miss ---
let cleanupCheckInterval;
let cleanupScrollTimeout = null;
let cleanupAnimationFrame = null;
let cleanupScrollListenerAttached = false;

function runCleanupCycle() {
    if (isWindowMinimized) return;
    performCleanupCheck();
    retryPendingVideos();
    proactiveLoadMedia();
}

function scheduleCleanupCycle() {
    if (cleanupAnimationFrame !== null) return;
    
    cleanupAnimationFrame = requestAnimationFrame(() => {
        cleanupAnimationFrame = null;
        runCleanupCycle();
    });
}

function handleGridScroll() {
    if (isWindowMinimized) return;
    
    cachedViewportBounds = null;
    viewportBoundsCacheTime = 0;
    scheduleCleanupCycle();
    
    clearTimeout(cleanupScrollTimeout);
    cleanupScrollTimeout = setTimeout(() => {
        cachedViewportBounds = null;
        viewportBoundsCacheTime = 0;
        runCleanupCycle();
    }, SCROLL_DEBOUNCE_MS);
}

function ensureCleanupScrollListener() {
    if (cleanupScrollListenerAttached) return;
    gridContainer.addEventListener('scroll', handleGridScroll, { passive: true });
    cleanupScrollListenerAttached = true;
}

function performCleanupCheck() {
    // Check all media cards and clean up media that aren't intersecting
    const allCards = gridContainer.querySelectorAll('.video-card');
    if (allCards.length === 0) return;
    
    let cleaned = false;
    
    // Calculate viewport bounds with a buffer zone for cleanup
    // Media outside this buffer zone will be cleaned up aggressively
    // Use same buffer as PRELOAD_BUFFER_PX for consistency
    const viewportTop = -PRELOAD_BUFFER_PX;
    const viewportBottom = window.innerHeight + PRELOAD_BUFFER_PX;
    const viewportLeft = -PRELOAD_BUFFER_PX;
    const viewportRight = window.innerWidth + PRELOAD_BUFFER_PX
    
    // Query all media elements once - maintain local arrays to avoid redundant DOM queries
    let allVideos = Array.from(gridContainer.querySelectorAll('video'));
    let allImages = Array.from(gridContainer.querySelectorAll('img.media-thumbnail'));

    if (allVideos.length === 0 && allImages.length === 0) return;

    // Build a map of card -> { videos, images } for fast lookup
    const cardMediaMap = new Map();
    for (const video of allVideos) {
        const card = video.closest('.video-card');
        if (!card) continue;
        if (!cardMediaMap.has(card)) cardMediaMap.set(card, { videos: [], images: [] });
        cardMediaMap.get(card).videos.push(video);
    }
    for (const img of allImages) {
        const card = img.closest('.video-card');
        if (!card) continue;
        if (!cardMediaMap.has(card)) cardMediaMap.set(card, { videos: [], images: [] });
        cardMediaMap.get(card).images.push(img);
    }

    const cardsWithMedia = Array.from(cardMediaMap.keys());
    if (cardsWithMedia.length === 0) return;

    // Batch all getBoundingClientRect calls together to minimize layout thrashing
    const rects = cardsWithMedia.map(card => card.getBoundingClientRect());

    // Track destroyed elements to remove from local arrays
    const destroyedVideos = new Set();
    const destroyedImages = new Set();

    // First pass: Remove media from cards outside the buffer zone
    cardsWithMedia.forEach((card, index) => {
        const rect = rects[index];
        const { videos, images } = cardMediaMap.get(card);

        const isInBufferZone = (
            rect.top < viewportBottom &&
            rect.bottom > viewportTop &&
            rect.left < viewportRight &&
            rect.right > viewportLeft
        );

        if (!isInBufferZone) {
            videos.forEach(video => {
                destroyVideoElement(video);
                destroyedVideos.add(video);
                cleaned = true;
            });
            images.forEach(img => {
                destroyImageElement(img);
                destroyedImages.add(img);
                cleaned = true;
            });
        } else {
            if (videos.length > 1) {
                for (let i = 1; i < videos.length; i++) {
                    destroyVideoElement(videos[i]);
                    destroyedVideos.add(videos[i]);
                    cleaned = true;
                }
            }
            if (images.length > 1) {
                for (let i = 1; i < images.length; i++) {
                    destroyImageElement(images[i]);
                    destroyedImages.add(images[i]);
                    cleaned = true;
                }
            }
        }
    });

    // Update local arrays by removing destroyed elements
    allVideos = allVideos.filter(v => !destroyedVideos.has(v));
    allImages = allImages.filter(i => !destroyedImages.has(i));
    activeVideoCount = allVideos.length;
    activeImageCount = allImages.length;

    // Second pass: If we still have too many videos, aggressively remove furthest ones
    if (allVideos.length > MAX_VIDEOS) {
        const videoCards = allVideos.map(video => video.closest('.video-card')).filter(Boolean);
        const videoRects = videoCards.map(card => card.getBoundingClientRect());

        const viewportCenterY = window.innerHeight / 2;
        const viewportCenterX = window.innerWidth / 2;
        const videoDistances = allVideos.map((video, index) => {
            const card = videoCards[index];
            if (!card) return { video, distance: Infinity };
            const rect = videoRects[index];
            const cardCenterY = rect.top + rect.height / 2;
            const cardCenterX = rect.left + rect.width / 2;
            const verticalDistance = Math.abs(cardCenterY - viewportCenterY);
            const horizontalDistance = Math.abs(cardCenterX - viewportCenterX);
            const distance = verticalDistance * 2 + horizontalDistance;
            return { video, distance, cardCenterY };
        });

        videoDistances.sort((a, b) => b.distance - a.distance);
        const toRemove = videoDistances.slice(MAX_VIDEOS);
        toRemove.forEach(({ video }) => {
            destroyVideoElement(video);
            destroyedVideos.add(video);
            cleaned = true;
        });
        allVideos = allVideos.filter(v => !destroyedVideos.has(v));
    }

    // Third pass: If we're still over a safety threshold (90% of max), be even more aggressive
    const totalMediaCount = allVideos.length + allImages.length;
    const safetyThreshold = Math.floor(MAX_TOTAL_MEDIA * 0.9);
    if (totalMediaCount > safetyThreshold) {
        const allMedia = [
            ...allVideos.map(v => ({ element: v, type: 'video' })),
            ...allImages.map(i => ({ element: i, type: 'image' }))
        ];

        const mediaCards = allMedia.map(({ element }) => element.closest('.video-card')).filter(Boolean);
        const mediaRects = mediaCards.map(card => card.getBoundingClientRect());

        const viewportCenterY = window.innerHeight / 2;
        const mediaDistances = allMedia.map(({ element, type }, index) => {
            const card = mediaCards[index];
            if (!card) return { element, distance: Infinity, type };
            const rect = mediaRects[index];
            const cardCenterY = rect.top + rect.height / 2;
            const distance = Math.abs(cardCenterY - viewportCenterY);
            return { element, distance, type };
        });

        mediaDistances.sort((a, b) => b.distance - a.distance);
        const toRemove = mediaDistances.slice(safetyThreshold);
        toRemove.forEach(({ element, type }) => {
            if (type === 'video') {
                destroyVideoElement(element);
            } else {
                destroyImageElement(element);
            }
            cleaned = true;
        });

        // Final count from DOM only once at the very end
        activeVideoCount = gridContainer.querySelectorAll('video').length;
        activeImageCount = gridContainer.querySelectorAll('img.media-thumbnail').length;
    } else {
        activeVideoCount = allVideos.length;
        activeImageCount = allImages.length;
    }

    if (cleaned) {
        scheduleGC();
    }
}

function startPeriodicCleanup() {
    ensureCleanupScrollListener();
    
    if (!cleanupCheckInterval) {
        const scheduleIdleCleanup = () => {
            cleanupCheckInterval = requestIdleCallback(() => {
                runCleanupCycle();
                if (cleanupCheckInterval) {
                    scheduleIdleCleanup();
                }
            }, { timeout: CLEANUP_IDLE_INTERVAL_MS });
        };
        scheduleIdleCleanup();
    }
    
    scheduleCleanupCycle();
}

function stopPeriodicCleanup() {
    if (cleanupCheckInterval) {
        cancelIdleCallback(cleanupCheckInterval);
        cleanupCheckInterval = null;
    }
    if (cleanupScrollTimeout) {
        clearTimeout(cleanupScrollTimeout);
        cleanupScrollTimeout = null;
    }
    if (cleanupAnimationFrame !== null) {
        cancelAnimationFrame(cleanupAnimationFrame);
        cleanupAnimationFrame = null;
    }
}

// Track window minimized state
let isWindowMinimized = false;
let isLightboxOpen = false;
let isWindowBlurred = false;
let isNativeDialogOpen = false;

// Pause all resource-intensive operations when window is minimized
function pauseWhenMinimized() {
    if (isWindowMinimized) return; // Already paused
    isWindowMinimized = true;
    
    // Destroy all videos in the grid to release VRAM
    // Simply pausing videos doesn't release GPU memory - we need to destroy them
    const allVideos = gridContainer.querySelectorAll('video');
    allVideos.forEach(video => {
        destroyVideoElement(video);
        activeVideoCount = Math.max(0, activeVideoCount - 1);
    });
    
    // Clear lightbox video src to release VRAM (but keep element for restoration)
    if (lightboxVideo && lightboxVideo.src) {
        // Store the URL in dataset before clearing so we can restore it
        lightboxVideo.dataset.src = lightboxVideo.src;
        lightboxVideo.pause();
        lightboxVideo.src = '';
        lightboxVideo.removeAttribute('src');
        if (lightboxVideo.srcObject) {
            lightboxVideo.srcObject = null;
        }
        lightboxVideo.load(); // Flush decoder
    }
    
    // Also clear lightbox image src if it exists
    const lightboxImage = document.getElementById('lightbox-image');
    if (lightboxImage && lightboxImage.src) {
        // Store the URL in dataset before clearing
        lightboxImage.dataset.src = lightboxImage.src;
        lightboxImage.src = '';
        lightboxImage.removeAttribute('src');
    }
    
    // Clear scrubber canvas if it exists (release any GPU resources)
    if (scrubberCanvas) {
        const ctx = scrubberCanvas.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, scrubberCanvas.width, scrubberCanvas.height);
        }
    }
    
    // Stop the background cleanup timer while the window is minimized
    stopPeriodicCleanup();
    
    // Disconnect IntersectionObserver to stop watching for visibility changes
    const allCards = gridContainer.querySelectorAll('.video-card, .folder-card');
    allCards.forEach(card => {
        observer.unobserve(card);
    });
    
    // Trigger GC to free up memory
    scheduleGC();
    
    // Force garbage collection after a short delay to ensure VRAM is released
    setTimeout(() => {
        if (window.electronAPI && window.electronAPI.triggerGC) {
            window.electronAPI.triggerGC();
        }
    }, 100);
}

// Resume all operations when window is restored
function resumeWhenRestored() {
    if (!isWindowMinimized) return; // Already resumed
    isWindowMinimized = false;
    
    // Reconnect IntersectionObserver for all cards
    // This will automatically recreate videos for visible cards
    const allCards = gridContainer.querySelectorAll('.video-card, .folder-card');
    allCards.forEach(card => {
        observer.observe(card);
    });
    
    // Trigger IntersectionObserver to check visibility immediately
    // This will recreate videos for cards currently in viewport
    performCleanupCheck();
    
    // Restore lightbox media if lightbox is open
    if (!lightbox.classList.contains('hidden')) {
        const lightboxImage = document.getElementById('lightbox-image');
        
        // Restore video if it was cleared
        if (lightboxVideo && lightboxVideo.dataset.src && !lightboxVideo.src) {
            const mediaUrl = lightboxVideo.dataset.src;
            lightboxVideo.src = mediaUrl;
            const playPromise = lightboxVideo.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {
                    // Ignore play errors
                });
            }
        } else if (lightboxVideo && lightboxVideo.src && lightboxVideo.paused) {
            // Video source is still there, just resume playback
            const playPromise = lightboxVideo.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {
                    // Ignore play errors
                });
            }
        }
        
        // Restore image if it was cleared
        if (lightboxImage && lightboxImage.dataset.src && !lightboxImage.src) {
            lightboxImage.src = lightboxImage.dataset.src;
        }
    }
    
    // Restart periodic cleanup
    startPeriodicCleanup();
    
    // Trigger immediate cleanup check to recreate visible videos
    performCleanupCheck();
    retryPendingVideos();
}

// Pause all grid thumbnail videos and freeze GIFs when lightbox is open
function pauseThumbnailVideos() {
    isLightboxOpen = true;
    if (!pauseOnLightbox) return;
    const allVideos = gridContainer.querySelectorAll('video');
    allVideos.forEach(video => {
        video.pause();
    });
    // Freeze animated GIFs by showing static overlay
    const allOverlays = gridContainer.querySelectorAll('.gif-static-overlay');
    allOverlays.forEach(overlay => overlay.classList.add('visible'));
}

// Resume all grid thumbnail videos and unfreeze GIFs when lightbox is closed
function resumeThumbnailVideos() {
    isLightboxOpen = false;
    if (isWindowMinimized || isWindowBlurred) return;
    const allVideos = gridContainer.querySelectorAll('video');
    allVideos.forEach(video => {
        const playPromise = video.play();
        if (playPromise !== undefined) {
            playPromise.catch(() => {});
        }
    });
    // Restore animated GIFs by hiding static overlay
    const allOverlays = gridContainer.querySelectorAll('.gif-static-overlay');
    allOverlays.forEach(overlay => overlay.classList.remove('visible'));
}

// Restore media playback state after a native dialog (confirm/alert) steals focus.
// Native dialogs block the JS thread, so blur/focus events are queued and fire AFTER
// confirm() returns. We must delay our cleanup until those queued events have settled.
function restorePlaybackAfterDialog() {
    // Request the main process to re-focus the window, then restore playback.
    // Native dialogs can cause the OS window to lose focus permanently.
    window.electronAPI.focusWindow().then(() => {
        setTimeout(() => {
            isNativeDialogOpen = false;
            if (!isWindowBlurred) return;
            isWindowBlurred = false;
            if (!pauseOnBlur) return;
            if (isLightboxOpen && pauseOnLightbox) return;
            const allVideos = gridContainer.querySelectorAll('video');
            allVideos.forEach(video => {
                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.catch(() => {});
                }
            });
            const allOverlays = gridContainer.querySelectorAll('.gif-static-overlay');
            allOverlays.forEach(overlay => overlay.classList.remove('visible'));
        }, 100);
    }).catch(() => {
        isNativeDialogOpen = false;
    });
}

// Track active media elements and pending creations
let activeVideoCount = 0;
let activeImageCount = 0;
let pendingMediaCreations = new Set();
// Track cards that need media retry: Map<card, { url, attempts, nextRetryTime }>
let mediaToRetry = new Map();
let lastCleanupTime = 0;

// Performance optimization: Cache viewport bounds and media counts
let cachedViewportBounds = null;
let viewportBoundsCacheTime = 0;
let cachedMediaCounts = { videos: 0, images: 0, timestamp: 0 };
let cardRectCache = new WeakMap(); // Cache getBoundingClientRect results

// Optimized function to get media counts with caching
function getMediaCounts() {
    const now = Date.now();
    if (now - cachedMediaCounts.timestamp < MEDIA_COUNT_CACHE_TTL) {
        return { videos: cachedMediaCounts.videos, images: cachedMediaCounts.images };
    }
    
    // Update cache
    cachedMediaCounts.videos = gridContainer.querySelectorAll('video').length;
    cachedMediaCounts.images = gridContainer.querySelectorAll('img.media-thumbnail').length;
    cachedMediaCounts.timestamp = now;
    
    return { videos: cachedMediaCounts.videos, images: cachedMediaCounts.images };
}

// Optimized function to get viewport bounds with caching
function getViewportBounds() {
    const now = Date.now();
    if (cachedViewportBounds && (now - viewportBoundsCacheTime < VIEWPORT_CACHE_TTL)) {
        return cachedViewportBounds;
    }
    
    // Update cache
    cachedViewportBounds = {
        top: -PRELOAD_BUFFER_PX,
        bottom: window.innerHeight + PRELOAD_BUFFER_PX,
        left: -PRELOAD_BUFFER_PX,
        right: window.innerWidth + PRELOAD_BUFFER_PX,
        centerY: window.innerHeight / 2
    };
    viewportBoundsCacheTime = now;
    
    return cachedViewportBounds;
}

// Optimized function to check if card is in preload zone
// Uses viewport coordinates since IntersectionObserver uses viewport as root
function isCardInPreloadZone(card) {
    const cardRect = card.getBoundingClientRect();
    const bounds = getViewportBounds();
    
    return (
        cardRect.top < bounds.bottom &&
        cardRect.bottom > bounds.top &&
        cardRect.left < bounds.right &&
        cardRect.right > bounds.left
    );
}

// Cache getBoundingClientRect results (with very short TTL to avoid stale positions)
function getCachedCardRect(card) {
    // For now, always get fresh rect to avoid issues with masonry layout changes
    // The caching can be re-enabled later if needed, but it's safer to always get fresh values
    return card.getBoundingClientRect();
}

// Helper function to detect file type from URL
function getFileType(url) {
    const urlLower = url.toLowerCase();
    // Image formats
    if (urlLower.endsWith('.gif') || urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg') ||
        urlLower.endsWith('.png') || urlLower.endsWith('.webp') || urlLower.endsWith('.bmp') ||
        urlLower.endsWith('.svg')) return 'image';
    // Video formats
    if (urlLower.endsWith('.mp4') || urlLower.endsWith('.webm') || 
        urlLower.endsWith('.ogg') || urlLower.endsWith('.mov')) return 'video';
    return 'video'; // Default to video for unknown types
}

// Color mapping for file extensions
const EXTENSION_COLORS = {
    // Video formats
    'MP4': '#ff6b6b',   // Red
    'WEBM': '#4ecdc4',  // Teal
    'OGG': '#95e1d3',   // Light teal
    'MOV': '#f38181',   // Light red
    
    // Image formats
    'GIF': '#a8e6cf',   // Light green
    'JPG': '#ffd93d',   // Yellow
    'JPEG': '#ffd93d',  // Yellow
    'PNG': '#6bcf7f',   // Green
    'WEBP': '#4d96ff',  // Blue
    'BMP': '#9b59b6',   // Purple
    'SVG': '#ff9ff3',   // Pink
};

// Helper function to get color for extension
function getExtensionColor(extension) {
    return EXTENSION_COLORS[extension] || '#888888'; // Default gray for unknown extensions
}

// Helper function to convert hex to rgba with opacity
function hexToRgba(hex, opacity = 0.87) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// Predefined aspect ratios (width:height)
const ASPECT_RATIOS = [
    { name: '1:2', ratio: 0.5 },      // Portrait (vertical)
    { name: '9:16', ratio: 9/16 },    // Vertical video (common)
    { name: '1:1', ratio: 1.0 },      // Square
    { name: '4:3', ratio: 4/3 },      // Classic
    { name: '3:2', ratio: 3/2 },      // Photo
    { name: '16:9', ratio: 16/9 },    // Widescreen (common)
    { name: '21:9', ratio: 21/9 },    // Ultrawide
    { name: '2:1', ratio: 2.0 },      // Panoramic
];

// Calculate exact aspect ratio as a simplified fraction
function calculateAspectRatio(width, height) {
    if (!width || !height) return 'N/A';
    
    // Find GCD to simplify the ratio
    const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
    const divisor = gcd(width, height);
    const simplifiedWidth = width / divisor;
    const simplifiedHeight = height / divisor;
    
    // If numbers are too large, round to common ratios
    if (simplifiedWidth > 100 || simplifiedHeight > 100) {
        const ratio = width / height;
        // Round to 2 decimal places for display
        return ratio.toFixed(2) + ':1';
    }
    
    return `${simplifiedWidth}:${simplifiedHeight}`;
}

// Map video aspect ratio to closest predefined ratio
function getClosestAspectRatio(videoWidth, videoHeight) {
    if (!videoWidth || !videoHeight) return '16:9'; // Default fallback
    
    const videoRatio = videoWidth / videoHeight;
    
    // Find the closest predefined ratio
    let closest = ASPECT_RATIOS[0];
    let minDifference = Math.abs(videoRatio - closest.ratio);
    
    for (const aspectRatio of ASPECT_RATIOS) {
        const difference = Math.abs(videoRatio - aspectRatio.ratio);
        if (difference < minDifference) {
            minDifference = difference;
            closest = aspectRatio;
        }
    }
    
    return closest.name;
}

// Create or update resolution label for a card
function createResolutionLabel(card, width, height) {
    if (!width || !height) return;
    
    // Check if label already exists
    let resolutionLabel = card.querySelector('.resolution-label');
    
    if (!resolutionLabel) {
        resolutionLabel = document.createElement('div');
        resolutionLabel.className = 'resolution-label';
        card.appendChild(resolutionLabel);
    }
    
    // Calculate aspect ratio
    const aspectRatio = calculateAspectRatio(width, height);
    
    // Update label text
    resolutionLabel.textContent = `${width}×${height} • ${aspectRatio}`;
    
    // Store dimensions on card for later use
    card.dataset.mediaWidth = width;
    card.dataset.mediaHeight = height;
}

// Apply aspect ratio to card
function applyAspectRatioToCard(card, aspectRatioName) {
    // Remove any existing aspect ratio classes
    card.classList.remove(...ASPECT_RATIOS.map(ar => `aspect-${ar.name.replace(':', '-')}`));
    
    // Add the new aspect ratio class
    const className = `aspect-${aspectRatioName.replace(':', '-')}`;
    card.classList.add(className);
    
    // Store the aspect ratio on the card for persistence
    card.dataset.aspectRatio = aspectRatioName;
    
    // In masonry mode, if this card already has a position (was laid out), update
    // just this card's height in-place. This handles the fallback case where ffprobe
    // wasn't available and media discovers a different aspect ratio after loading.
    // No full relayout needed — cards are absolutely positioned so others aren't affected.
    if (gridContainer.classList.contains('masonry') && card.style.width) {
        const cardWidth = parseFloat(card.style.width);
        if (cardWidth > 0) {
            const aspectRatio = ASPECT_RATIOS.find(ar => ar.name === aspectRatioName);
            const aspectRatioValue = aspectRatio ? aspectRatio.ratio : (16 / 9);
            const newHeight = Math.max(50, cardWidth / aspectRatioValue);
            card.style.height = `${newHeight}px`;
        }
    }
}

// --- Masonry Layout System ---
let masonryColumns = 0;
let columnHeights = [];
let resizeTimeout;
let masonryResizeObserver = null;
let masonryMutationObserver = null;
let masonryResizeHandler = null;
let masonryLayoutAnimationFrame = null;
let isApplyingMasonryLayout = false;

// Cached computed style values for masonry — invalidated on zoom/theme change
let cachedMasonryStyles = null;
function invalidateMasonryStyleCache() { cachedMasonryStyles = null; }
function getMasonryStyles() {
    if (cachedMasonryStyles) return cachedMasonryStyles;
    const rootStyles = getComputedStyle(document.documentElement);
    const gridStyles = getComputedStyle(gridContainer);
    cachedMasonryStyles = {
        gap: parseInt(rootStyles.getPropertyValue('--gap')) || 16,
        paddingLeft: parseInt(gridStyles.paddingLeft) || 0,
        paddingTop: parseInt(gridStyles.paddingTop) || 0,
        paddingBottom: parseInt(gridStyles.paddingBottom) || 0,
    };
    return cachedMasonryStyles;
}

function scheduleMasonryLayout() {
    if (masonryLayoutAnimationFrame !== null) return;
    
    masonryLayoutAnimationFrame = requestAnimationFrame(() => {
        masonryLayoutAnimationFrame = null;
        if (layoutMode === 'masonry' && gridContainer.classList.contains('masonry') && !isApplyingMasonryLayout) {
            layoutMasonry();
        }
    });
}

function getShortestColumnIndex(heights) {
    let shortestIndex = 0;
    let shortestHeight = heights[0] ?? 0;
    
    for (let i = 1; i < heights.length; i++) {
        if (heights[i] < shortestHeight) {
            shortestHeight = heights[i];
            shortestIndex = i;
        }
    }
    
    return shortestIndex;
}

function calculateMasonryColumns() {
    const styles = getMasonryStyles();
    const containerWidth = gridContainer.clientWidth - (styles.paddingLeft * 2);
    const gap = styles.gap;
    const baseMinColumnWidth = 250;
    const minColumnWidth = baseMinColumnWidth * (zoomLevel / 100);
    const columns = Math.max(1, Math.floor((containerWidth + gap) / (minColumnWidth + gap)));
    return columns;
}

function layoutMasonry() {
    if (!gridContainer.classList.contains('masonry') || layoutMode !== 'masonry' || isApplyingMasonryLayout) return;

    isApplyingMasonryLayout = true;
    // Disconnect MutationObserver to avoid redundant re-triggers from our own style/DOM changes
    if (masonryMutationObserver) masonryMutationObserver.disconnect();

    try {
        const cards = Array.from(gridContainer.querySelectorAll('.video-card, .folder-card'));
        
        const existingSpacer = gridContainer.querySelector('.masonry-spacer');
        if (existingSpacer) {
            existingSpacer.remove();
        }
        
        if (cards.length === 0) {
            gridContainer.style.height = 'auto';
            gridContainer.style.minHeight = '0px';
            return;
        }
        
        const styles = getMasonryStyles();
        const gap = styles.gap;
        const containerPaddingLeft = styles.paddingLeft;
        const containerPaddingTop = styles.paddingTop;
        const containerPaddingBottom = styles.paddingBottom;
        const containerWidth = gridContainer.clientWidth - (containerPaddingLeft * 2);
        const columns = calculateMasonryColumns();
        
        if (columns === 0) return;
        
        gridContainer.style.setProperty('--columns', columns);
        columnHeights = new Array(columns).fill(0);
        
        const columnWidth = (containerWidth - gap * (columns - 1)) / columns;
        
        cards.forEach((card) => {
            if (card.style.display === 'none') {
                return;
            }
            
            card.style.position = 'absolute';
            card.style.width = `${columnWidth}px`;
            
            let cardHeight;
            if (card.classList.contains('folder-card')) {
                cardHeight = columnWidth;
            } else {
                let aspectRatioName = card.dataset.aspectRatio;
                
                if (!aspectRatioName) {
                    for (const ar of ASPECT_RATIOS) {
                        if (card.classList.contains(`aspect-${ar.name.replace(':', '-')}`)) {
                            aspectRatioName = ar.name;
                            break;
                        }
                    }
                }
                
                if (!aspectRatioName) {
                    aspectRatioName = '16:9';
                }
                
                const aspectRatio = ASPECT_RATIOS.find(ar => ar.name === aspectRatioName);
                if (!aspectRatio) {
                    console.warn('Aspect ratio not found for:', aspectRatioName, 'defaulting to 16:9');
                    aspectRatioName = '16:9';
                }
                const aspectRatioValue = aspectRatio ? aspectRatio.ratio : (16 / 9);
                
                cardHeight = columnWidth / aspectRatioValue;
                
                if (!cardHeight || cardHeight <= 0 || !isFinite(cardHeight)) {
                    console.warn('Invalid card height calculated:', cardHeight, 'for aspect ratio:', aspectRatioName, 'using default');
                    cardHeight = columnWidth / (16 / 9);
                }
            }
            
            if (cardHeight < 50) {
                cardHeight = 50;
            }
            
            card.style.height = `${cardHeight}px`;
            card.style.paddingBottom = '0';
            card.style.opacity = '1';
            card.style.visibility = 'visible';
            
            const shortestColumnIndex = getShortestColumnIndex(columnHeights);
            const left = shortestColumnIndex * (columnWidth + gap);
            const top = columnHeights[shortestColumnIndex];
            
            card.style.left = `${left}px`;
            card.style.top = `${top}px`;
            columnHeights[shortestColumnIndex] += cardHeight + gap;
        });
        
        const maxHeight = Math.max(...columnHeights, 0);
        if (maxHeight > 0) {
            const contentHeight = maxHeight + containerPaddingTop + containerPaddingBottom;
            
            const spacer = document.createElement('div');
            spacer.className = 'masonry-spacer';
            spacer.style.width = '1px';
            spacer.style.height = `${contentHeight}px`;
            spacer.style.position = 'static';
            spacer.style.pointerEvents = 'none';
            spacer.style.visibility = 'hidden';
            spacer.style.margin = '0';
            spacer.style.padding = '0';
            gridContainer.appendChild(spacer);
        } else {
            gridContainer.style.minHeight = '0px';
        }
    } finally {
        isApplyingMasonryLayout = false;
        // Reconnect MutationObserver after layout is done
        if (masonryMutationObserver) {
            masonryMutationObserver.observe(gridContainer, {
                childList: true,
                subtree: false
            });
        }
    }
}

function cleanupMasonry() {
    if (masonryLayoutAnimationFrame !== null) {
        cancelAnimationFrame(masonryLayoutAnimationFrame);
        masonryLayoutAnimationFrame = null;
    }
    
    // Clean up resize observer
    if (masonryResizeObserver) {
        masonryResizeObserver.disconnect();
        masonryResizeObserver = null;
    }
    
    // Clean up mutation observer
    if (masonryMutationObserver) {
        masonryMutationObserver.disconnect();
        masonryMutationObserver = null;
    }
    
    // Clean up resize event listener
    if (masonryResizeHandler) {
        window.removeEventListener('resize', masonryResizeHandler);
        masonryResizeHandler = null;
    }
}

function initMasonry() {
    if (layoutMode !== 'masonry') return; // Don't initialize if not in masonry mode
    
    if (gridContainer.classList.contains('masonry')) return; // Already initialized
    
    // Clean up any existing observers first
    cleanupMasonry();
    
    gridContainer.classList.add('masonry');
    gridContainer.classList.remove('grid');
    
    // Reset card positioning styles
    const cards = gridContainer.querySelectorAll('.video-card, .folder-card');
    cards.forEach(card => {
        card.style.position = '';
        card.style.left = '';
        card.style.top = '';
        card.style.width = '';
        card.style.height = '';
        card.style.opacity = '';
        card.style.visibility = '';
    });
    
    // Initial layout after cards are rendered
    scheduleMasonryLayout();
    
    // Recalculate on window resize (debounced)
    masonryResizeHandler = () => {
        // Invalidate viewport cache on resize
        cachedViewportBounds = null;
        viewportBoundsCacheTime = 0;
        cardRectCache = new WeakMap(); // Clear rect cache on resize
        
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (layoutMode === 'masonry') {
                scheduleMasonryLayout();
            }
        }, 150);
    };
    
    window.addEventListener('resize', masonryResizeHandler);
    
    // Use ResizeObserver to detect when card sizes change (e.g., aspect ratio updates)
    masonryResizeObserver = new ResizeObserver(() => {
        if (!isApplyingMasonryLayout) {
            scheduleMasonryLayout();
        }
    });
    
    // Observe container for size changes
    masonryResizeObserver.observe(gridContainer);
    
    // Recalculate when cards are added/removed (e.g. by filters)
    // Only watch childList — aspect ratio class changes no longer trigger relayout
    // since card dimensions are set upfront and media uses object-fit: cover
    masonryMutationObserver = new MutationObserver((mutations) => {
        let shouldRelayout = false;
        for (const mutation of mutations) {
            if (mutation.type === 'childList') {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === 1 && (node.classList.contains('video-card') || node.classList.contains('folder-card'))) {
                        shouldRelayout = true;
                        break;
                    }
                }
                if (shouldRelayout) break;
                for (const node of mutation.removedNodes) {
                    if (node.nodeType === 1 && (node.classList.contains('video-card') || node.classList.contains('folder-card'))) {
                        shouldRelayout = true;
                        break;
                    }
                }
                if (shouldRelayout) break;
            }
        }

        if (shouldRelayout && layoutMode === 'masonry') {
            scheduleMasonryLayout();
        }
    });

    masonryMutationObserver.observe(gridContainer, {
        childList: true,
        subtree: false
    });
}

function initGrid() {
    if (layoutMode !== 'grid') return; // Don't initialize if not in grid mode
    
    // Clean up masonry observers
    cleanupMasonry();
    
    gridContainer.classList.add('grid');
    gridContainer.classList.remove('masonry');
    
    // Reset container height/style
    gridContainer.style.height = '';
    gridContainer.style.minHeight = '';
    
    // Remove masonry spacer if it exists
    const spacer = gridContainer.querySelector('.masonry-spacer');
    if (spacer) {
        spacer.remove();
    }
    
    // Reset card positioning styles for grid layout
    const cards = gridContainer.querySelectorAll('.video-card, .folder-card');
    cards.forEach(card => {
        card.style.position = '';
        card.style.left = '';
        card.style.top = '';
        card.style.width = '';
        card.style.height = '';
        card.style.paddingBottom = ''; // Reset padding-bottom to use CSS aspect ratio classes
        card.style.opacity = '';
        card.style.visibility = '';
        // Ensure card is visible (display is controlled by filters)
        if (card.style.display !== 'none') {
            card.style.display = '';
        }
    });
}

function switchLayoutMode() {
    // Toggle layout mode based on checkbox state
    layoutMode = layoutModeToggle.checked ? 'grid' : 'masonry';
    
    // Update label text
    layoutModeLabel.textContent = layoutMode === 'grid' ? 'Rigid' : 'Dynamic';
    
    // Save preference to localStorage
    deferLocalStorageWrite('layoutMode', layoutMode);
    
    // Apply the new layout
    if (layoutMode === 'masonry') {
        initMasonry();
    } else {
        initGrid();
    }
    
    // Apply zoom after layout change
    applyZoom();

    // Re-apply filters to trigger layout update and ensure cards are visible
    requestAnimationFrame(() => {
        applyFilters();
    });

    updateStatusBar();
}

function toggleRememberFolder() {
    rememberLastFolder = rememberFolderToggle.checked;
    
    // Update label
    rememberFolderLabel.textContent = rememberLastFolder ? 'On' : 'Off';
    
    // Save preference to localStorage
    deferLocalStorageWrite('rememberLastFolder', rememberLastFolder.toString());

    // If disabling, clear the stored folder path
    if (!rememberLastFolder) {
        localStorage.removeItem('lastFolderPath');
    }
}

function toggleIncludeMovingImages() {
    includeMovingImages = includeMovingImagesToggle.checked;

    // Update label
    includeMovingImagesLabel.textContent = includeMovingImages ? 'On' : 'Off';

    // Save preference to localStorage
    deferLocalStorageWrite('includeMovingImages', includeMovingImages.toString());
    
    // Re-apply filters if image filter is active
    if (currentFilter === 'image') {
        applyFilters();
    }
}

// Function to filter items based on current filter (before rendering)
function filterItems(items) {
    if (currentFilter === 'stars') {
        // Filter to only show items with star ratings (exclude folders)
        return items.filter(item => {
            // Exclude folders - they don't have star ratings
            if (item.type === 'folder') return false;
            // Must have a valid path
            if (!item.path) return false;
            // Check rating - must be > 0
            const rating = getFileRating(item.path);
            return rating > 0; // Only show items with rating > 0
        });
    } else if (currentFilter === 'video') {
        // Filter to only show video files
        return items.filter(item => item.type === 'video');
    } else if (currentFilter === 'image') {
        // Filter to only show image files
        return items.filter(item => item.type === 'image');
    } else if (currentFilter === 'audio') {
        // Filter to only show video files (audio filter is handled at card level)
        return items.filter(item => item.type === 'video');
    }
    // 'all' - return all items
    return items;
}

// Function to sort items based on current sorting preferences
function sortItems(items) {
    // Separate folders and files
    const folders = items.filter(item => item.type === 'folder');
    const files = items.filter(item => item.type !== 'folder');
    
    // Sort folders
    folders.sort((a, b) => {
        let comparison = 0;
        if (sortType === 'name') {
            comparison = a.name.localeCompare(b.name);
        } else if (sortType === 'date') {
            // Use mtime if available, otherwise fall back to name
            const aTime = a.mtime || 0;
            const bTime = b.mtime || 0;
            comparison = aTime - bTime;
            // If times are equal or missing, fall back to name
            if (comparison === 0) {
                comparison = a.name.localeCompare(b.name);
            }
        }
        return sortOrder === 'ascending' ? comparison : -comparison;
    });
    
    // Sort files
    files.sort((a, b) => {
        let comparison = 0;
        if (sortType === 'name') {
            comparison = a.name.localeCompare(b.name);
        } else if (sortType === 'date') {
            // Use mtime if available, otherwise fall back to name
            const aTime = a.mtime || 0;
            const bTime = b.mtime || 0;
            comparison = aTime - bTime;
            // If times are equal or missing, fall back to name
            if (comparison === 0) {
                comparison = a.name.localeCompare(b.name);
            }
        } else if (sortType === 'rating' || currentFilter === 'stars') {
            // Sort by star rating (highest to lowest: 5 to 1)
            const aRating = getFileRating(a.path);
            const bRating = getFileRating(b.path);
            comparison = bRating - aRating; // Descending order (5 stars first)
            // If ratings are equal, fall back to name
            if (comparison === 0) {
                comparison = a.name.localeCompare(b.name);
            }
        }
        return sortOrder === 'ascending' ? comparison : -comparison;
    });
    
    // Return folders first, then files
    return [...folders, ...files];
}

// Function to apply sorting and reload current folder
function applySorting() {
    if (currentFolderPath && currentItems.length > 0) {
        // Filter items based on current filter, then sort and render
        const filteredItems = filterItems(currentItems);
        const sortedItems = sortItems(filteredItems);
        renderItems(sortedItems);
    } else if (currentFolderPath) {
        // If no items cached, reload from backend
        loadVideos(currentFolderPath);
    }
}

// Progressive rendering uses constants defined at top of file

// Card animation counter for stagger effect
let cardAnimIndex = 0;

// Function to create a card element from an item
function createCardFromItem(item) {
    if (item.type === 'folder') {
        // Create folder card
        const card = document.createElement('div');
        card.className = 'folder-card';
        card.style.animation = `card-enter 0.3s var(--ease-out-expo) ${Math.min(cardAnimIndex * 20, 600)}ms backwards`;
        cardAnimIndex++;
        card.dataset.folderPath = item.path;
        card.dataset.searchText = item.name.toLowerCase();

        // Create folder icon (use textContent instead of innerHTML for better performance)
        const folderIcon = document.createElement('div');
        folderIcon.className = 'folder-icon';
        folderIcon.innerHTML = icon('folder', 48);
        
        const info = document.createElement('div');
        info.className = 'folder-info';
        info.textContent = item.name;

        card.appendChild(folderIcon);
        card.appendChild(info);

        return { card, isMedia: false };
    } else {
        // Create media card
        const card = document.createElement('div');
        card.className = 'video-card';
        card.style.animation = `card-enter 0.3s var(--ease-out-expo) ${Math.min(cardAnimIndex * 20, 600)}ms backwards`;
        cardAnimIndex++;
        card.dataset.src = item.url;
        card.dataset.path = item.path; // Store file path for context menu actions and star ratings
        card.dataset.filePath = item.path; // Keep for backward compatibility
        card.dataset.name = item.name;
        card.dataset.searchText = item.name.toLowerCase();
        card.dataset.mediaType = item.type;
        
        // Extract file extension for label (optimized - use lastIndexOf instead of split)
        const lastDot = item.name.lastIndexOf('.');
        const fileExtension = lastDot !== -1 ? item.name.substring(lastDot + 1).toUpperCase() : '';
        
        // Create extension label with color
        const extensionLabel = document.createElement('div');
        extensionLabel.className = 'extension-label';
        extensionLabel.textContent = fileExtension;
        const extensionColor = getExtensionColor(fileExtension);
        extensionLabel.style.backgroundColor = hexToRgba(extensionColor, 0.87);
        
        // Apply aspect ratio immediately if dimensions are available (pre-scanned)
        // This prevents card shifting in masonry mode
        if (item.width && item.height && item.type === 'image') {
            const aspectRatioName = getClosestAspectRatio(item.width, item.height);
            applyAspectRatioToCard(card, aspectRatioName);
            // Store dimensions on card for later use
            card.dataset.width = item.width;
            card.dataset.height = item.height;
            card.dataset.mediaWidth = item.width; // Keep for backward compatibility
            card.dataset.mediaHeight = item.height; // Keep for backward compatibility
            // Create resolution label immediately
            createResolutionLabel(card, item.width, item.height);
        }

        // Apply pre-scanned dimensions for videos (from ffprobe during folder scan)
        if (item.width && item.height && item.type === 'video') {
            const aspectRatioName = getClosestAspectRatio(item.width, item.height);
            applyAspectRatioToCard(card, aspectRatioName);
            card.dataset.width = item.width;
            card.dataset.height = item.height;
            card.dataset.mediaWidth = item.width;
            card.dataset.mediaHeight = item.height;
            createResolutionLabel(card, item.width, item.height);
        }

        // Fallback: if no pre-scanned dimensions available, default to 16:9
        // so masonry layout can be calculated upfront without waiting for metadata
        if (!card.dataset.aspectRatio) {
            applyAspectRatioToCard(card, '16:9');
        }

        const info = document.createElement('div');
        info.className = 'video-info';
        info.textContent = item.name;

        card.appendChild(extensionLabel);
        
        // Always add star rating (even if 0, so user can rate)
        const rating = getFileRating(item.path);
        const starContainer = document.createElement('div');
        starContainer.className = rating > 0 ? 'star-rating has-rating' : 'star-rating';
        starContainer.style.pointerEvents = 'auto'; // Ensure stars are clickable
        for (let i = 1; i <= 5; i++) {
            const star = document.createElement('span');
            star.className = `star ${i <= rating ? 'active' : ''}`;
            star.innerHTML = i <= rating ? iconFilled('star', 16, 'var(--warning)') : icon('star', 16);
            star.style.pointerEvents = 'auto';
            star.style.cursor = 'pointer';
            starContainer.appendChild(star);
        }
        card.appendChild(starContainer);
        
        card.appendChild(info);

        return { card, isMedia: true };
    }
}

// Progressive rendering function for large lists
function renderItemsProgressive(items) {
    cardAnimIndex = 0; // Reset card animation stagger
    setStatusActivity(`Rendering ${items.length} items...`);
    const cardsToObserve = [];
    let currentIndex = 0;
    
    // Render initial chunk immediately for perceived performance
    const initialFragment = document.createDocumentFragment();
    const initialEnd = Math.min(PROGRESSIVE_RENDER_INITIAL_CHUNK, items.length);
    
    for (let i = 0; i < initialEnd; i++) {
        const { card, isMedia } = createCardFromItem(items[i]);
        initialFragment.appendChild(card);
        if (isMedia) {
            cardsToObserve.push(card);
            videoCards.add(card);
        }
    }
    
    gridContainer.appendChild(initialFragment);
    updateItemCount();
    currentIndex = initialEnd;
    
    // Initialize layout mode class (but don't calculate layout yet for better performance)
    if (layoutMode === 'masonry') {
        gridContainer.classList.add('masonry');
        gridContainer.classList.remove('grid');
    } else {
        gridContainer.classList.add('grid');
        gridContainer.classList.remove('masonry');
    }
    
    // Batch observer registration for initial chunk AFTER layout is ready
    // In masonry mode, defer layout until ALL cards are in the DOM (single pass)
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            cardsToObserve.forEach(card => {
                observer.observe(card);
            });

            // Only trigger masonry layout here for small lists that won't have more chunks
            if (layoutMode === 'masonry' && currentIndex >= items.length) {
                scheduleMasonryLayout();
            }

            // Start proactive loading for initial chunk
            scheduleProactiveLoadForChunk();
        });
    });
    
    // Continue rendering remaining items in chunks
    function renderNextChunk() {
        if (currentIndex >= items.length) {
            // All items rendered, trigger final layout update
            requestAnimationFrame(() => {
                if (layoutMode === 'masonry') {
                    scheduleMasonryLayout();
                }
                // Final proactive load after all rendered
                scheduleProactiveLoadForChunk();
            });
            return;
        }
        
        const chunkEnd = Math.min(currentIndex + PROGRESSIVE_RENDER_CHUNK_SIZE, items.length);
        const fragment = document.createDocumentFragment();
        const chunkCardsToObserve = [];
        
        for (let i = currentIndex; i < chunkEnd; i++) {
            const { card, isMedia } = createCardFromItem(items[i]);
            fragment.appendChild(card);
            if (isMedia) {
                chunkCardsToObserve.push(card);
                videoCards.add(card);
            }
        }
        
        gridContainer.appendChild(fragment);
        currentIndex = chunkEnd;
        
        // Wait for layout before observing and loading
        requestAnimationFrame(() => {
            // Batch observer registration for this chunk
            chunkCardsToObserve.forEach(card => {
                observer.observe(card);
                cardsToObserve.push(card);
            });

            // No per-chunk masonry relayout — single pass after all cards are in DOM
            // Trigger proactive loading for this chunk
            scheduleProactiveLoadForChunk();
        });
        
        // Continue rendering next chunk after allowing UI to breathe
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => {
                requestAnimationFrame(renderNextChunk);
            }, { timeout: 50 });
        } else {
            setTimeout(() => {
                requestAnimationFrame(renderNextChunk);
            }, 16); // ~60fps fallback
        }
    }
    
    // Start rendering remaining chunks after initial render settles
    if ('requestIdleCallback' in window) {
        requestIdleCallback(() => {
            requestAnimationFrame(renderNextChunk);
        }, { timeout: 100 });
    } else {
        setTimeout(() => {
            requestAnimationFrame(renderNextChunk);
        }, 50); // Fallback delay
    }
    
    // Helper function to schedule proactive loading for current chunk
    function scheduleProactiveLoadForChunk() {
        // Use requestIdleCallback to avoid blocking UI
        if ('requestIdleCallback' in window) {
            requestIdleCallback(() => {
                loadVisibleMedia();
            }, { timeout: 50 });
        } else {
            setTimeout(() => {
                loadVisibleMedia();
            }, 0);
        }
    }
    
    // Function to load media for cards currently visible/in preload zone
    function loadVisibleMedia() {
        const allCards = gridContainer.querySelectorAll('.video-card');
        if (allCards.length === 0) return;

        const cardsToCheck = Array.from(allCards).filter(card => {
            if (card.classList.contains('folder-card')) return false;
            return !card.dataset.hasMedia && !pendingMediaCreations.has(card);
        });

        if (cardsToCheck.length === 0) return;
        
        // Use viewport bounds (consistent with IntersectionObserver root: null)
        const bounds = getViewportBounds();
        const cardsToLoadNow = [];
        
        // Check each card's position relative to viewport
        cardsToCheck.forEach(card => {
            if (isCardInPreloadZone(card)) {
                const cardRect = card.getBoundingClientRect();
                const cardCenterY = cardRect.top + (cardRect.height / 2);
                const distance = Math.abs(cardCenterY - bounds.centerY);
                cardsToLoadNow.push({ card, mediaUrl: card.dataset.src, distance });
            }
        });
        
        // Sort by distance and load closest items first
        cardsToLoadNow.sort((a, b) => a.distance - b.distance);
        cardsToLoadNow.slice(0, PARALLEL_LOAD_LIMIT * 2).forEach(({ card, mediaUrl }) => {
            createMediaForCard(card, mediaUrl);
        });
    }
    
    // Apply filters after initial render
    requestAnimationFrame(() => {
        applyFilters();
    });
    
    // Start periodic cleanup check
    startPeriodicCleanup();
}

// Function to render items (extracted from loadVideos for re-use)
function renderItems(items) {
    cardAnimIndex = 0; // Reset card animation stagger
    const perfStart = perfTest.start();
    if (items.length > 50) setStatusActivity(`Rendering ${items.length} items...`);
    // Clean up all existing media before rendering
    // Use a single querySelectorAll and batch operations
    const existingCards = gridContainer.querySelectorAll('.video-card, .folder-card');
    const cardsArray = Array.from(existingCards);
    
    // Batch unobserve and cleanup
    cardsArray.forEach(card => {
        observer.unobserve(card);
        const videos = card.querySelectorAll('video');
        const images = card.querySelectorAll('img.media-thumbnail');
        videos.forEach(video => destroyVideoElement(video));
        images.forEach(img => destroyImageElement(img));
    });
    
    // Reset counters
    activeVideoCount = 0;
    activeImageCount = 0;
    pendingMediaCreations.clear();
    mediaToRetry.clear();
    lastCleanupTime = 0;
    // Clear caches
    cachedMediaCounts = { videos: 0, images: 0, timestamp: 0 };
    cardRectCache = new WeakMap();
    cachedViewportBounds = null;
    
    // Clean up masonry spacer if it exists
    const spacer = gridContainer.querySelector('.masonry-spacer');
    if (spacer) {
        spacer.remove();
    }
    
    // Use textContent for faster clearing (more efficient than innerHTML)
    while (gridContainer.firstChild) {
        gridContainer.removeChild(gridContainer.firstChild);
    }
    currentHoveredCard = null;
    focusedCardIndex = -1;
    gridContainer.classList.remove('masonry'); // Reset masonry state
    gridContainer.classList.remove('grid'); // Reset grid state

    if (items.length === 0) {
        const emptyMsg = document.createElement('p');
        emptyMsg.style.cssText = 'grid-column: 1/-1; text-align: center;';
        emptyMsg.textContent = 'No folders or supported media found.';
        gridContainer.appendChild(emptyMsg);
        updateItemCount();
        return;
    }

    // Use progressive rendering for large lists
    if (items.length >= PROGRESSIVE_RENDER_THRESHOLD) {
        renderItemsProgressive(items);
        return;
    }

    // For smaller lists, render all at once (existing behavior)
    const fragment = document.createDocumentFragment();
    const cardsToObserve = []; // Batch observer registration

    items.forEach(item => {
        const { card, isMedia } = createCardFromItem(item);
        fragment.appendChild(card);
        if (isMedia) {
            cardsToObserve.push(card);
            videoCards.add(card);
        }
    });

    gridContainer.appendChild(fragment);
    updateItemCount();
    perfTest.end('renderItems', perfStart, { itemCount: items.length });

    // Defer layout initialization and observer registration to allow DOM to render first
    // This improves perceived performance
    requestAnimationFrame(() => {
        // Wait for layout to calculate before observing
        requestAnimationFrame(() => {
            // Batch observer registration after layout is ready
            cardsToObserve.forEach(card => {
                observer.observe(card);
            });
        });
        
        if (layoutMode === 'masonry') {
            initMasonry();
        } else {
            initGrid();
        }
    });
    
    // Proactively load cards that are in the preload zone using idle callback
    // This batches DOM reads to avoid layout thrashing with large folders
    const scheduleProactiveLoad = (callback) => {
        if ('requestIdleCallback' in window) {
            requestIdleCallback(callback, { timeout: 100 });
        } else {
            // Fallback for browsers without requestIdleCallback
            setTimeout(callback, 0);
        }
    };
    
    scheduleProactiveLoad(() => {
        loadVisibleMediaRegular();
    });
    
    // Helper function for regular (non-progressive) rendering
    function loadVisibleMediaRegular() {
        const allCards = gridContainer.querySelectorAll('.video-card');
        if (allCards.length === 0) return;

        const cardsToCheck = Array.from(allCards).filter(card => {
            if (card.classList.contains('folder-card')) return false;
            return !card.dataset.hasMedia && !pendingMediaCreations.has(card);
        });
        
        if (cardsToCheck.length === 0) return;
        
        // Use viewport bounds (consistent with IntersectionObserver root: null)
        const bounds = getViewportBounds();
        const cardsToLoadNow = [];
        
        // Check each card's position relative to viewport
        cardsToCheck.forEach(card => {
            if (isCardInPreloadZone(card)) {
                const cardRect = card.getBoundingClientRect();
                const cardCenterY = cardRect.top + (cardRect.height / 2);
                const distance = Math.abs(cardCenterY - bounds.centerY);
                cardsToLoadNow.push({ card, mediaUrl: card.dataset.src, distance });
            }
        });
        
        // Sort by distance and load closest items first
        cardsToLoadNow.sort((a, b) => a.distance - b.distance);
        cardsToLoadNow.slice(0, PARALLEL_LOAD_LIMIT * 2).forEach(({ card, mediaUrl }) => {
            createMediaForCard(card, mediaUrl);
        });
    }
    
    // Apply filters after loading (in case a filter is active)
    requestAnimationFrame(() => {
        applyFilters();
    });
    
    // Start periodic cleanup check
    startPeriodicCleanup();
}

// Function to update sorting preferences
function updateSorting() {
    sortType = sortTypeSelect.value;
    sortOrder = sortOrderSelect.value;
    
    // Save to active tab instead of global localStorage
    if (activeTabId) {
        const tab = tabs.find(t => t.id === activeTabId);
        if (tab) {
            tab.sortType = sortType;
            tab.sortOrder = sortOrder;
            saveTabs();
        }
    }
    
    // Also save to localStorage as fallback/default for new tabs
    deferLocalStorageWrite('sortType', sortType);
    deferLocalStorageWrite('sortOrder', sortOrder);
    
    // Apply sorting to current folder
    applySorting();
}

function toggleSettingsDropdown() {
    settingsDropdown.classList.toggle('hidden');
}

function closeSettingsDropdown() {
    settingsDropdown.classList.add('hidden');
}

// Keyboard Shortcuts Cheat Sheet
const shortcutsOverlay = document.getElementById('shortcuts-overlay');
const shortcutsCloseBtn = document.getElementById('shortcuts-close-btn');

function toggleShortcutsOverlay() {
    shortcutsOverlay.classList.toggle('hidden');
}

shortcutsCloseBtn.addEventListener('click', () => {
    shortcutsOverlay.classList.add('hidden');
});

shortcutsOverlay.addEventListener('click', (e) => {
    if (e.target === shortcutsOverlay) {
        shortcutsOverlay.classList.add('hidden');
    }
});

function createMediaForCard(card, mediaUrl) {
    if (pendingMediaCreations.has(card)) return false;
    
    const fileType = card.dataset.mediaType || getFileType(mediaUrl);
    const { videos: currentVideoCount, images: currentImageCount } = getMediaCounts();
    const totalMediaCount = currentVideoCount + currentImageCount;
    
    // Check limits based on file type
    if (fileType === 'video' && currentVideoCount >= MAX_VIDEOS) {
        // Add to retry queue - capacity limited, not an error
        if (!mediaToRetry.has(card)) {
            mediaToRetry.set(card, { url: mediaUrl, attempts: 0, nextRetryTime: Date.now(), reason: 'capacity' });
        }
        return false;
    }
    if (fileType === 'image' && currentImageCount >= MAX_IMAGES) {
        // Add to retry queue - capacity limited, not an error
        if (!mediaToRetry.has(card)) {
            mediaToRetry.set(card, { url: mediaUrl, attempts: 0, nextRetryTime: Date.now(), reason: 'capacity' });
        }
        return false;
    }
    if (totalMediaCount >= MAX_TOTAL_MEDIA) {
        // Add to retry queue - capacity limited, not an error
        if (!mediaToRetry.has(card)) {
            mediaToRetry.set(card, { url: mediaUrl, attempts: 0, nextRetryTime: Date.now(), reason: 'capacity' });
        }
        return false;
    }
    
    pendingMediaCreations.add(card);
    
    if (fileType === 'image') {
        return createImageForCard(card, mediaUrl);
    } else {
        return createVideoForCard(card, mediaUrl);
    }
}

function createImageForCard(card, imageUrl) {
    activeImageCount++;
    // Invalidate media count cache since we're adding an image
    cachedMediaCounts.timestamp = 0;
    
    // Calculate card size to limit image resolution based on quality setting
    const rect = getCachedCardRect(card);
    const qualityMultiplier = getThumbnailQualityMultiplier();
    const decodeWidth = Math.max(1, Math.floor(rect.width * qualityMultiplier));
    const decodeHeight = Math.max(1, Math.floor(rect.height * qualityMultiplier));
    
    const img = document.createElement('img');
    img.src = imageUrl;
    img.className = 'media-thumbnail';
    // Use 'eager' for images in viewport/preload zone for faster loading
    // The IntersectionObserver rootMargin handles preloading, so we can be eager here
    img.loading = 'eager';
    img.decoding = 'async'; // Decode asynchronously for better performance
    img.draggable = true;

    // Enable dragging images out of the app
    img.addEventListener('dragstart', (e) => {
        const filePath = card.dataset.filePath;
        if (filePath) {
            e.dataTransfer.effectAllowed = 'copyMove';
            e.dataTransfer.setData('text/plain', filePath);
            e.dataTransfer.setData('text/uri-list', imageUrl);
            e.dataTransfer.setData('application/x-thumbnail-animator-path', filePath);
        }
    });
    
    // Limit image decode resolution
    img.width = decodeWidth;
    img.height = decodeHeight;
    
    // Optimize rendering
    img.style.imageRendering = 'auto';
    img.style.willChange = 'contents';
    
    // For animated GIFs/WEBPs, capture the first frame as a static snapshot
    const urlLowerForAnim = imageUrl.toLowerCase();
    const isGif = urlLowerForAnim.endsWith('.gif') || urlLowerForAnim.endsWith('.webp');
    if (isGif) {
        img.dataset.animatedSrc = imageUrl;
    }

    // Track loading state
    img.addEventListener('load', () => {
        // Detect and apply aspect ratio to card
        // Only update if aspect ratio wasn't already set from pre-scanned dimensions
        if (img.naturalWidth && img.naturalHeight && !card.dataset.aspectRatio) {
            const aspectRatioName = getClosestAspectRatio(img.naturalWidth, img.naturalHeight);
            applyAspectRatioToCard(card, aspectRatioName);

            // Create resolution label if not already created
            if (!card.dataset.mediaWidth) {
                createResolutionLabel(card, img.naturalWidth, img.naturalHeight);
            }

            // Cache discovered dimensions for future visits
            if (card.dataset.filePath && !card.dataset.dimCached) {
                card.dataset.dimCached = '1';
                cacheDimensions([{
                    path: card.dataset.filePath,
                    mtime: 0,
                    width: img.naturalWidth,
                    height: img.naturalHeight
                }]).catch(() => {});
            }
        }
        // Capture first frame for GIF freezing (only once)
        if (isGif && !card.querySelector('.gif-static-overlay')) {
            try {
                const canvas = document.createElement('canvas');
                // Cap overlay to thumbnail size - no need for full resolution
                const MAX_OVERLAY_DIM = 400;
                const scale = Math.min(1, MAX_OVERLAY_DIM / Math.max(img.naturalWidth, img.naturalHeight));
                canvas.width = Math.round(img.naturalWidth * scale);
                canvas.height = Math.round(img.naturalHeight * scale);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const overlay = document.createElement('img');
                overlay.src = canvas.toDataURL('image/jpeg', 0.7);
                overlay.className = 'gif-static-overlay';
                overlay.draggable = false;
                // Mark the card as having an animated image with overlay
                img.dataset.hasOverlay = 'true';
                const info = card.querySelector('.video-info');
                card.insertBefore(overlay, info);
                // If lightbox or blur pausing is active, show overlay immediately
                if ((isLightboxOpen && pauseOnLightbox) || (isWindowBlurred && pauseOnBlur)) {
                    overlay.classList.add('visible');
                }
            } catch (e) {
                // Ignore cross-origin or other canvas errors
            }
        }
        scheduleMediaLoadSettle();
    }, { once: true });

    // Add error handler - retry on error with exponential backoff
    img.addEventListener('error', () => {
        scheduleMediaLoadSettle();
        destroyImageElement(img);
        activeImageCount = Math.max(0, activeImageCount - 1);
        pendingMediaCreations.delete(card);
        // Invalidate media count cache
        cachedMediaCounts.timestamp = 0;
        
        // Get existing retry info or create new
        const retryInfo = mediaToRetry.get(card) || { url: imageUrl, attempts: 0, nextRetryTime: Date.now() };
        retryInfo.attempts++;
        retryInfo.url = imageUrl; // Update URL in case it changed
        
        // Calculate exponential backoff delay
        const delay = Math.min(
            RETRY_INITIAL_DELAY_MS * Math.pow(RETRY_BACKOFF_MULTIPLIER, retryInfo.attempts - 1),
            RETRY_MAX_DELAY_MS
        );
        retryInfo.nextRetryTime = Date.now() + delay;
        
        // Only retry if we haven't exceeded max attempts
        if (retryInfo.attempts <= MAX_RETRY_ATTEMPTS) {
            mediaToRetry.set(card, retryInfo);
        } else {
            // Remove from retry queue if max attempts exceeded
            mediaToRetry.delete(card);
            console.warn(`Image failed to load after ${MAX_RETRY_ATTEMPTS} attempts:`, imageUrl);
        }
    });
    
    const info = card.querySelector('.video-info');
    card.insertBefore(img, info);
    card.dataset.hasMedia = '1';

    pendingMediaCreations.delete(card);
    return true;
}

// Helper function to create sound label for videos with audio
function createSoundLabel(card) {
    // Check if sound label already exists
    if (card.querySelector('.sound-label')) {
        return;
    }
    
    // Mark card as having audio in dataset (for instant filtering)
    card.dataset.hasAudio = 'true';
    
    // Create sound label
    const soundLabel = document.createElement('div');
    soundLabel.className = 'sound-label';
    soundLabel.textContent = 'AUDIO';
    soundLabel.style.backgroundColor = hexToRgba('#4ecdc4', 0.87); // Teal color similar to extension labels
    
    // Insert before the video-info element
    const info = card.querySelector('.video-info');
    if (info) {
        card.insertBefore(soundLabel, info);
    } else {
        card.appendChild(soundLabel);
    }
    
    // If audio filter is active, re-apply filters to show this video immediately
    if (currentFilter === 'audio') {
        // Re-apply filters synchronously since we're checking dataset attribute, not DOM element
        applyFilters();
    }
}

function createVideoForCard(card, videoUrl) {
    activeVideoCount++;
    // Invalidate media count cache since we're adding a video
    cachedMediaCounts.timestamp = 0;
    
    // Calculate card size to limit video resolution based on quality setting
    const rect = getCachedCardRect(card);
    const qualityMultiplier = getThumbnailQualityMultiplier();
    const decodeWidth = Math.max(1, Math.floor(rect.width * qualityMultiplier));
    const decodeHeight = Math.max(1, Math.floor(rect.height * qualityMultiplier));
    
    const video = document.createElement('video');
    video.src = videoUrl;
    video.muted = true;
    video.loop = true;
    // Use 'metadata' for balance - loads quickly without downloading entire video
    // Combined with rootMargin preloading, this provides fast loading
    video.preload = 'metadata';
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    // Make video draggable like images
    video.draggable = true;

    // Request a thumbnail poster from ffmpeg (non-blocking)
    if (hasFfmpegAvailable && card.dataset.filePath) {
        window.electronAPI.generateVideoThumbnail(card.dataset.filePath).then(result => {
            if (result && result.success && result.url && video.isConnected) {
                video.poster = result.url;
            }
        }).catch(() => { /* ignore thumbnail errors */ });
    }
    
    // Add dragstart handler to enable dragging videos
    video.addEventListener('dragstart', (e) => {
        const filePath = card.dataset.filePath;
        if (filePath) {
            e.dataTransfer.effectAllowed = 'copyMove';
            e.dataTransfer.setData('text/plain', filePath);
            e.dataTransfer.setData('text/uri-list', videoUrl);
            e.dataTransfer.setData('application/x-thumbnail-animator-path', filePath);
        }
    });
    
    // Limit video decode resolution to reduce VRAM usage
    // Setting width/height attributes tells the browser to decode at this resolution
    // CSS will still scale it to fill the card, but VRAM usage is reduced
    video.width = decodeWidth;
    video.height = decodeHeight;
    
    // Optimize rendering for lower VRAM usage
    video.style.imageRendering = 'auto';
    video.style.willChange = 'contents';
    
    // Track loading state
    let hasLoaded = false;
    video.addEventListener('loadedmetadata', () => {
        hasLoaded = true;
        
        // Detect and apply aspect ratio to card
        if (video.videoWidth && video.videoHeight) {
            const aspectRatioName = getClosestAspectRatio(video.videoWidth, video.videoHeight);
            applyAspectRatioToCard(card, aspectRatioName);

            // Create resolution label
            createResolutionLabel(card, video.videoWidth, video.videoHeight);

            // Cache discovered dimensions for future visits
            if (card.dataset.filePath && !card.dataset.dimCached) {
                card.dataset.dimCached = '1';
                cacheDimensions([{
                    path: card.dataset.filePath,
                    mtime: 0,
                    width: video.videoWidth,
                    height: video.videoHeight
                }]).catch(() => {});
            }
        }

        // After metadata loads, ensure video dimensions are constrained
        const rect = card.getBoundingClientRect();
        const maxWidth = rect.width;
        const maxHeight = rect.height;
        if (video.videoWidth > maxWidth || video.videoHeight > maxHeight) {
            // Video is larger than card - browser will scale, but we've limited decode size
            video.width = Math.min(video.videoWidth, maxWidth);
            video.height = Math.min(video.videoHeight, maxHeight);
        }
        
        // Check if video has audio tracks (cross-browser compatible)
        const checkAudio = () => {
            let hasAudio = false;
            
            // Method 1: Check audioTracks API (Chrome, Edge, Safari)
            if (video.audioTracks && video.audioTracks.length > 0) {
                hasAudio = true;
            }
            // Method 2: Firefox-specific method
            else if (video.mozHasAudio !== undefined && video.mozHasAudio) {
                hasAudio = true;
            }
            // Method 3: WebKit-specific method (older Safari)
            else if (video.webkitAudioDecodedByteCount !== undefined && video.webkitAudioDecodedByteCount > 0) {
                hasAudio = true;
            }
            
            if (hasAudio) {
                createSoundLabel(card);
            } else {
                // Explicitly mark as no audio - this will hide the card if audio filter is active
                card.dataset.hasAudio = 'false';
                // If audio filter is active, re-apply filters to hide videos without audio
                if (currentFilter === 'audio') {
                    applyFilters();
                }
            }
        };
        
        // Check immediately when metadata loads
        checkAudio();
        
        // Also check when video can play (more reliable for some browsers)
        video.addEventListener('canplay', checkAudio, { once: true });
        scheduleMediaLoadSettle();
    });

    // Add error handler - retry on error with exponential backoff
    video.addEventListener('error', () => {
        scheduleMediaLoadSettle();
        destroyVideoElement(video);
        activeVideoCount = Math.max(0, activeVideoCount - 1);
        pendingMediaCreations.delete(card);
        
        // Get existing retry info or create new
        const retryInfo = mediaToRetry.get(card) || { url: videoUrl, attempts: 0, nextRetryTime: Date.now() };
        retryInfo.attempts++;
        retryInfo.url = videoUrl; // Update URL in case it changed
        
        // Calculate exponential backoff delay
        const delay = Math.min(
            RETRY_INITIAL_DELAY_MS * Math.pow(RETRY_BACKOFF_MULTIPLIER, retryInfo.attempts - 1),
            RETRY_MAX_DELAY_MS
        );
        retryInfo.nextRetryTime = Date.now() + delay;
        
        // Only retry if we haven't exceeded max attempts
        if (retryInfo.attempts <= MAX_RETRY_ATTEMPTS) {
            mediaToRetry.set(card, retryInfo);
        } else {
            // Remove from retry queue if max attempts exceeded
            mediaToRetry.delete(card);
            console.warn(`Video failed to load after ${MAX_RETRY_ATTEMPTS} attempts:`, videoUrl);
        }
    });

    const info = card.querySelector('.video-info');
    card.insertBefore(video, info);
    card.dataset.hasMedia = '1';

    // Don't auto-play if lightbox/blur pausing is active
    if (!(isLightboxOpen && pauseOnLightbox) && !(isWindowBlurred && pauseOnBlur)) {
        const playPromise = video.play();
        if (playPromise !== undefined) {
            playPromise.catch(() => {
                // Ignore play errors
            });
        }
    }

    pendingMediaCreations.delete(card);
    return true;
}

function processEntries(entries) {
    const perfStart = perfTest.start();
    let changed = false;
    const now = Date.now();
    
    // FIRST: Clean up all media that are going out of view (SYNCHRONOUSLY)
    entries.forEach(entry => {
        if (!entry.isIntersecting) {
            const card = entry.target;
            const videos = card.querySelectorAll('video');
            const images = card.querySelectorAll('img.media-thumbnail');
            
            if (videos.length > 0) {
                videos.forEach(video => {
                    destroyVideoElement(video);
                    activeVideoCount = Math.max(0, activeVideoCount - 1);
                    pendingMediaCreations.delete(card);
                    mediaToRetry.delete(card);
                });
                changed = true;
                lastCleanupTime = now;
            }
            
            if (images.length > 0) {
                images.forEach(img => {
                    destroyImageElement(img);
                    activeImageCount = Math.max(0, activeImageCount - 1);
                    pendingMediaCreations.delete(card);
                    mediaToRetry.delete(card);
                });
                changed = true;
                lastCleanupTime = now;
            }
        }
    });
    
    // Update count after cleanup
    const counts = getMediaCounts();
    activeVideoCount = counts.videos;
    activeImageCount = counts.images;
    
    // Check if cooldown has passed
    const timeSinceCleanup = now - lastCleanupTime;
    const canCreateNow = timeSinceCleanup >= CLEANUP_COOLDOWN_MS;
    
    // THEN: Create media for cards coming into view
    // First, collect all cards that need media and prioritize by distance from viewport center
    const cardsToLoad = [];
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const card = entry.target;
            const videos = card.querySelectorAll('video');
            const images = card.querySelectorAll('img.media-thumbnail');
            
            // Remove any duplicate videos first
            if (videos.length > 1) {
                for (let i = 1; i < videos.length; i++) {
                    destroyVideoElement(videos[i]);
                    activeVideoCount = Math.max(0, activeVideoCount - 1);
                    changed = true;
                }
            }
            
            // Remove any duplicate images first
            if (images.length > 1) {
                for (let i = 1; i < images.length; i++) {
                    destroyImageElement(images[i]);
                    activeImageCount = Math.max(0, activeImageCount - 1);
                    changed = true;
                }
            }
            
            // If no media exists and not pending, add to load queue
            if (videos.length === 0 && images.length === 0 && !pendingMediaCreations.has(card)) {
                // Use IntersectionObserver entry data for accurate positioning
                // entry.boundingClientRect is relative to viewport
                // Calculate distance from viewport center for prioritization
                const cardRect = entry.boundingClientRect;
                const viewportCenterY = window.innerHeight / 2;
                const cardCenterY = cardRect.top + cardRect.height / 2;
                const distance = Math.abs(cardCenterY - viewportCenterY);
                cardsToLoad.push({ card, mediaUrl: card.dataset.src, distance });
            }
        }
    });
    
    // Sort by distance from viewport center (closest first)
    cardsToLoad.sort((a, b) => a.distance - b.distance);
    
    // Load media in parallel batches for faster initial loading
    let loadedInBatch = 0;
    cardsToLoad.forEach(({ card, mediaUrl }) => {
        const { videos: currentVideoCount, images: currentImageCount } = getMediaCounts();
        const totalMediaCount = currentVideoCount + currentImageCount;
        
        if (totalMediaCount >= MAX_TOTAL_MEDIA) {
            // If at limit, only load if this card is in the preload zone
            // Only load if in preload zone when at limit
            if (!isCardInPreloadZone(card)) {
                // Add to retry queue - capacity limited, not an error
                if (!mediaToRetry.has(card)) {
                    mediaToRetry.set(card, { url: mediaUrl, attempts: 0, nextRetryTime: Date.now(), reason: 'capacity' });
                }
                return;
            }
        }
        
        // Load multiple items in parallel for faster initial loading
        // Trust IntersectionObserver - if entry.isIntersecting is true, load immediately
        // No cooldown check for parallel loading to maximize speed
        if (loadedInBatch < getEffectiveLoadLimit()) {
            // Create immediately for parallel batch (no cooldown restriction)
            createMediaForCard(card, mediaUrl);
            loadedInBatch++;
        } else {
            // For items beyond parallel limit, still load immediately but use requestAnimationFrame
            // This ensures smooth loading without blocking
            requestAnimationFrame(() => {
                if (card.querySelectorAll('video').length === 0 && 
                    card.querySelectorAll('img.media-thumbnail').length === 0) {
                    createMediaForCard(card, mediaUrl);
                }
            });
        }
    });

    if (changed) {
        scheduleGC();
    }
    perfTest.end('processEntries', perfStart, { cardCount: entries.length });
}

// Proactive media loading - checks all cards and loads media for those in preload zone
// This ensures preloading works even if IntersectionObserver doesn't fire immediately
function proactiveLoadMedia() {
    const { videos: currentVideoCount, images: currentImageCount } = getMediaCounts();
    const totalMediaCount = currentVideoCount + currentImageCount;
    
    // Don't load if we're at capacity
    if (totalMediaCount >= MAX_TOTAL_MEDIA) return;
    
    // Get all cards that need media
    const allCards = gridContainer.querySelectorAll('.video-card');
        const cardsNeedingMedia = Array.from(allCards).filter(card => {
            if (card.classList.contains('folder-card')) return false;
            // Check if card is in retry queue but ready to retry
            const retryInfo = mediaToRetry.get(card);
            const isReadyToRetry = retryInfo && Date.now() >= retryInfo.nextRetryTime;
            return !card.dataset.hasMedia &&
                   !pendingMediaCreations.has(card) &&
                   (!mediaToRetry.has(card) || isReadyToRetry) &&
                   card.dataset.src; // Must have a source
        });
    
    if (cardsNeedingMedia.length === 0) return;
    
    // Check which cards are in the preload zone
    const bounds = getViewportBounds();
    const cardsToLoad = [];
    
    cardsNeedingMedia.forEach(card => {
        if (isCardInPreloadZone(card)) {
            const cardRect = card.getBoundingClientRect();
            const cardCenterY = cardRect.top + (cardRect.height / 2);
            const distance = Math.abs(cardCenterY - bounds.centerY);
            cardsToLoad.push({ card, mediaUrl: card.dataset.src, distance });
        }
    });
    
    if (cardsToLoad.length === 0) return;
    
    // Sort by distance and load closest items first
    cardsToLoad.sort((a, b) => a.distance - b.distance);
    
    // Calculate how many we can load
    const remainingCapacity = MAX_TOTAL_MEDIA - totalMediaCount;
    const maxToLoad = Math.min(remainingCapacity, getEffectiveLoadLimit() * 2, cardsToLoad.length);
    
    // Load the closest cards
    for (let i = 0; i < maxToLoad; i++) {
        const { card, mediaUrl } = cardsToLoad[i];
        if (createMediaForCard(card, mediaUrl)) {
            // Successfully started loading
        }
    }
}

// Retry mechanism for media that couldn't load due to limit or errors
function retryPendingVideos() {
    if (mediaToRetry.size === 0) return;
    
    const { videos: currentVideoCount, images: currentImageCount } = getMediaCounts();
    const totalMediaCount = currentVideoCount + currentImageCount;
    
    if (totalMediaCount >= MAX_TOTAL_MEDIA) return;
    
    const now = Date.now();
    let retriedCount = 0;
    const cardsToRemove = [];
    
    // Try to create multiple media from retry queue in parallel
    for (const [card, retryInfo] of mediaToRetry.entries()) {
        if (retriedCount >= getEffectiveLoadLimit() * 2) break;
        
        // Check if it's time to retry (respect exponential backoff)
        if (now < retryInfo.nextRetryTime) continue;
        
        // Check if card still exists and needs media
        if (!card.parentNode) {
            // Card was removed from DOM
            cardsToRemove.push(card);
            continue;
        }
        
        const videos = card.querySelectorAll('video');
        const images = card.querySelectorAll('img.media-thumbnail');
        const hasMedia = videos.length > 0 || images.length > 0;
        
        if (hasMedia) {
            // Media already loaded, remove from retry queue
            cardsToRemove.push(card);
            continue;
        }
        
        // Check if card is in preload zone (but don't remove if it's not - keep retrying)
        const isInPreloadZone = isCardInPreloadZone(card);
        
        // Only retry if in preload zone or if we've exhausted attempts (final attempt)
        if (isInPreloadZone && !pendingMediaCreations.has(card)) {
            if (createMediaForCard(card, retryInfo.url)) {
                // Successfully started loading - remove from retry queue
                cardsToRemove.push(card);
                retriedCount++;
            } else {
                // Failed to create - update retry time for next attempt
                retryInfo.attempts++;
                if (retryInfo.reason === 'capacity') {
                    // Capacity-limited: retry quickly, no exponential backoff
                    retryInfo.nextRetryTime = now + 50;
                } else {
                    // Actual load error: use exponential backoff
                    const delay = Math.min(
                        RETRY_INITIAL_DELAY_MS * Math.pow(RETRY_BACKOFF_MULTIPLIER, retryInfo.attempts),
                        RETRY_MAX_DELAY_MS
                    );
                    retryInfo.nextRetryTime = now + delay;
                }
            }
        } else if (retryInfo.attempts >= MAX_RETRY_ATTEMPTS) {
            // Max attempts exceeded, remove from queue
            cardsToRemove.push(card);
            console.warn(`Removing card from retry queue after ${MAX_RETRY_ATTEMPTS} attempts:`, retryInfo.url);
        }
        // If card is outside preload zone but hasn't exceeded max attempts, keep it in queue
    }
    
    // Remove cards that succeeded or exceeded max attempts
    cardsToRemove.forEach(card => mediaToRetry.delete(card));
    
    // Also proactively load media for cards in preload zone that aren't in retry queue
    // This catches cards that IntersectionObserver might have missed
    if (retriedCount < getEffectiveLoadLimit() * 2) {
        const allCards = gridContainer.querySelectorAll('.video-card');
        const cardsToLoad = Array.from(allCards).filter(card => {
            if (card.classList.contains('folder-card')) return false;
            return !card.dataset.hasMedia &&
                   !pendingMediaCreations.has(card) &&
                   !mediaToRetry.has(card) &&
                   isCardInPreloadZone(card);
        });
        
        // Load up to remaining capacity
        const remainingCapacity = getEffectiveLoadLimit() * 2 - retriedCount;
        cardsToLoad.slice(0, remainingCapacity).forEach(card => {
            const mediaUrl = card.dataset.src;
            if (mediaUrl && createMediaForCard(card, mediaUrl)) {
                retriedCount++;
            }
        });
    }
}

// --- Intersection Observer ---
// IMPORTANT: Using viewport (null) as root is actually correct here!
// Even though gridContainer scrolls, IntersectionObserver with viewport root
// will correctly detect when cards enter/exit the visible viewport area.
// The rootMargin expands the detection zone for preloading.
// Using gridContainer as root causes issues because entry.boundingClientRect
// is always relative to viewport, not the root element.
const observerOptions = {
    root: null, // Use viewport as root - this works correctly with scrolling containers
    // rootMargin format: "top right bottom left" - expands viewport for preloading
    rootMargin: `${PRELOAD_BUFFER_PX}px ${PRELOAD_BUFFER_PX}px ${PRELOAD_BUFFER_PX}px ${PRELOAD_BUFFER_PX}px`,
    threshold: 0.0 // Trigger as soon as any part intersects
};

// Helper function to aggressively clean up video elements
function destroyVideoElement(video) {
    if (!video) return;

    // Store parent reference before we start cleanup
    const parent = video.parentNode;
    // Clear hasMedia flag if no other media remains in the card
    const card = parent && parent.closest ? parent.closest('.video-card') : (parent && parent.classList && parent.classList.contains('video-card') ? parent : null);
    if (card && !card.querySelector('video:nth-of-type(2)') && !card.querySelector('img.media-thumbnail')) {
        delete card.dataset.hasMedia;
    }

    try {
        // 1. Stop playback FIRST before removing from DOM
        try {
            video.pause();
            video.currentTime = 0;
            // Cancel any pending operations
            if (video.requestVideoFrameCallback) {
                // Cancel any frame callbacks if supported
            }
        } catch (e) {
            // Ignore if already paused/stopped
        }
        
        // 2. Stop all tracks (releases decoder resources) BEFORE removing from DOM
        try {
            if (video.srcObject) {
                const tracks = video.srcObject.getTracks();
                tracks.forEach(track => {
                    try {
                        track.stop();
                    } catch (e) {
                        // Ignore track stop errors
                    }
                });
                video.srcObject = null;
            }
        } catch (e) {
            // Ignore srcObject errors
        }
        
        // 3. Clear src BEFORE removing from DOM to release decoder
        try {
            // Set to blank video first to flush decoder
            video.src = BLANK_VIDEO;
            video.load();
            // Then clear completely
            video.removeAttribute('src');
            video.src = '';
            video.load();
        } catch (e) {
            // Ignore src errors
        }
        
        // 4. Remove from DOM to stop rendering
        if (parent) {
            try {
                parent.removeChild(video);
            } catch (e) {
                // Video might already be removed
            }
        } else {
            try {
                video.remove();
            } catch (e) {
                // Ignore
            }
        }
        
        // 5. Clear all attributes and properties
        try {
            video.removeAttribute('src');
            video.removeAttribute('playsinline');
            if (video.srcObject) video.srcObject = null;
            if (video.src) video.src = '';
        } catch (e) {
            // Ignore
        }
        
        // 6. Explicitly nullify
        video = null;
    } catch (e) {
        // Final fallback - just try to remove from DOM
        try {
            if (video && video.parentNode) {
                video.parentNode.removeChild(video);
            } else if (video) {
                video.remove();
            }
        } catch (e2) {
            // Ignore all errors - video might already be gone
        }
    }
}

// Helper function to clean up image elements
function destroyImageElement(img) {
    if (!img) return;

    const parent = img.parentNode;
    // Clear hasMedia flag if no other media remains in the card
    const card = parent && parent.closest ? parent.closest('.video-card') : (parent && parent.classList && parent.classList.contains('video-card') ? parent : null);
    if (card && !card.querySelector('video') && !card.querySelector('img.media-thumbnail:nth-of-type(2)')) {
        delete card.dataset.hasMedia;
    }

    // Also remove the static overlay if this is an animated image
    if (parent && img.dataset.hasOverlay) {
        const overlay = parent.querySelector('.gif-static-overlay');
        if (overlay) overlay.remove();
    }

    try {
        // Clear src to stop loading/rendering
        img.src = '';
        img.removeAttribute('src');
        
        // Remove from DOM
        if (parent) {
            try {
                parent.removeChild(img);
            } catch (e) {
                // Image might already be removed
            }
        } else {
            try {
                img.remove();
            } catch (e) {
                // Ignore
            }
        }
        
        // Clear all attributes
        try {
            img.removeAttribute('src');
            img.removeAttribute('width');
            img.removeAttribute('height');
        } catch (e) {
            // Ignore
        }
        
        // Explicitly nullify
        img = null;
    } catch (e) {
        // Final fallback - just try to remove from DOM
        try {
            if (img && img.parentNode) {
                img.parentNode.removeChild(img);
            } else if (img) {
                img.remove();
            }
        } catch (e2) {
            // Ignore all errors - image might already be gone
        }
    }
}

// Throttle cleanup check in IntersectionObserver callback
let observerCleanupThrottle = null;
// Using OBSERVER_CLEANUP_THROTTLE_MS from configuration constants at top of file

const observer = new IntersectionObserver((entries) => {
    // Process entries immediately - no throttling that could cause missed cleanups
    processEntries(entries);
    
    // Throttle cleanup check to avoid excessive calls when many entries change at once
    if (!observerCleanupThrottle) {
        observerCleanupThrottle = setTimeout(() => {
            performCleanupCheck();
            retryPendingVideos();
            proactiveLoadMedia(); // Also proactively load media when observer fires
            observerCleanupThrottle = null;
        }, OBSERVER_CLEANUP_THROTTLE_MS);
    }
}, observerOptions);


// --- Filter and Search Functionality ---
// Debounce timer for search input
let filterDebounceTimer = null;
// RAF coalescing for filter changes — batches rapid clicks into one pass
let pendingFilterRaf = null;
function scheduleApplyFilters() {
    if (pendingFilterRaf !== null) return; // Already scheduled
    pendingFilterRaf = requestAnimationFrame(() => {
        pendingFilterRaf = null;
        applyFilters();
    });
}

function updateItemCount() {
    const total = currentItems.length;
    const query = searchBox.value.trim();
    const hasAdvanced = advancedSearchFilters.sizeValue !== null ||
        advancedSearchFilters.dateFrom !== null || advancedSearchFilters.dateTo !== null ||
        advancedSearchFilters.width !== null || advancedSearchFilters.height !== null ||
        advancedSearchFilters.aspectRatio !== '' || advancedSearchFilters.starRating !== '';
    const hasFilter = currentFilter !== 'all' || query !== '' || hasAdvanced;

    if (total === 0) {
        itemCountEl.textContent = '';
    } else if (hasFilter) {
        const cards = gridContainer.querySelectorAll('.video-card, .folder-card');
        const visible = Array.from(cards).filter(c => c.style.display !== 'none').length;
        itemCountEl.textContent = `${visible} of ${total} items`;
    } else {
        itemCountEl.textContent = `${total} items`;
    }

    updateStatusBar();
}

function updateStatusBar() {
    // Item counts by type
    const folders = currentItems.filter(i => i.type === 'folder').length;
    const videos = currentItems.filter(i => i.type === 'video').length;
    const images = currentItems.filter(i => i.type === 'image').length;
    const total = currentItems.length;

    if (total === 0) {
        statusItemCounts.textContent = 'No items';
    } else {
        const parts = [];
        if (folders > 0) parts.push(`${folders} folder${folders !== 1 ? 's' : ''}`);
        if (images > 0) parts.push(`${images} image${images !== 1 ? 's' : ''}`);
        if (videos > 0) parts.push(`${videos} video${videos !== 1 ? 's' : ''}`);
        statusItemCounts.textContent = parts.join(', ');
    }

    // Filter info
    const query = searchBox.value.trim();
    const filterNames = { all: '', video: 'Videos', image: 'Images', audio: 'Audio', stars: 'Starred' };
    const filterParts = [];
    if (currentFilter !== 'all') filterParts.push(filterNames[currentFilter] || currentFilter);
    if (query) filterParts.push(`"${query}"`);
    statusFilterInfo.textContent = filterParts.length > 0 ? `[${filterParts.join(' + ')}]` : '';

    // Layout & zoom
    statusLayoutMode.textContent = layoutMode === 'masonry' ? 'Dynamic' : 'Grid';
    statusZoomLevel.textContent = `${zoomLevel}%`;
}

function updateStatusBarSelection(card) {
    if (!card || !statusSelectionInfo) {
        statusSelectionInfo.textContent = '';
        return;
    }

    const name = card.dataset.name || '';
    const w = card.dataset.width || card.dataset.mediaWidth;
    const h = card.dataset.height || card.dataset.mediaHeight;
    const parts = [name];
    if (w && h) parts.push(`${w}x${h}`);
    statusSelectionInfo.textContent = parts.join(' \u2014 ');
}

function applyFilters() {
    const perfStart = perfTest.start();
    const cards = gridContainer.querySelectorAll('.video-card, .folder-card');
    if (cards.length === 0) return;

    const query = searchBox.value.toLowerCase().trim();
    
    // Read cached search text from dataset (set at card creation time, avoids DOM traversal)
    const cardData = Array.from(cards).map(card => {
        const fileName = card.dataset.searchText || '';
        return { card, fileName };
    });
    
    // Process all cards in a single pass
    cardData.forEach(({ card, fileName }) => {
        // Check if card matches search query
        const matchesSearch = query === '' || fileName.includes(query);
        
        // Check if card matches filter
        let matchesFilter = true;
        if (currentFilter === 'video') {
            // Show only video files (not folders or images)
            matchesFilter = card.classList.contains('video-card') && card.dataset.mediaType === 'video';
        } else if (currentFilter === 'image') {
            // Show only image files (not folders or videos)
            const isImage = card.classList.contains('video-card') && card.dataset.mediaType === 'image';
            if (isImage && !includeMovingImages) {
                // Check if it's a moving image type (gif, webp)
                const isMovingImage = fileName.endsWith('.gif') || fileName.endsWith('.webp');
                matchesFilter = !isMovingImage; // Exclude moving images if toggle is off
            } else {
                matchesFilter = isImage; // Include all images if toggle is on
            }
        } else if (currentFilter === 'audio') {
            // Show videos that have audio OR are still loading (hasAudio not set yet)
            // This ensures videos show up immediately, then get filtered out if no audio once metadata loads
            const isVideo = card.classList.contains('video-card') && card.dataset.mediaType === 'video';
            const hasAudio = card.dataset.hasAudio === 'true';
            const audioNotChecked = card.dataset.hasAudio === undefined || card.dataset.hasAudio === '';
            matchesFilter = isVideo && (hasAudio || audioNotChecked);
        } else if (currentFilter === 'stars') {
            // Show only files with star ratings (exclude folders)
            // Match the pattern of video/image filters: check card type first
            const isVideoCard = card.classList.contains('video-card');
            if (!isVideoCard) {
                matchesFilter = false; // Folders don't have star ratings
            } else {
                const filePath = card.dataset.path;
                if (filePath) {
                    const rating = getFileRating(filePath);
                    matchesFilter = rating > 0; // Only show files with rating > 0
                } else {
                    matchesFilter = false; // No file path means no rating
                }
            }
        } else {
            // 'all' - show everything
            matchesFilter = true;
        }
        
        // Apply advanced search filters
        let matchesAdvancedSearch = true;
        if (matchesSearch && matchesFilter) {
            const filePath = card.dataset.path;
            
            // Dimension filter
            if (advancedSearchFilters.width || advancedSearchFilters.height) {
                const width = parseInt(card.dataset.width);
                const height = parseInt(card.dataset.height);
                if (advancedSearchFilters.width && width !== advancedSearchFilters.width) matchesAdvancedSearch = false;
                if (advancedSearchFilters.height && height !== advancedSearchFilters.height) matchesAdvancedSearch = false;
            }
            
            // Aspect ratio filter
            if (advancedSearchFilters.aspectRatio && matchesAdvancedSearch) {
                const width = parseInt(card.dataset.width);
                const height = parseInt(card.dataset.height);
                if (width && height) {
                    const ratio = width / height;
                    const targetRatio = parseAspectRatio(advancedSearchFilters.aspectRatio);
                    if (Math.abs(ratio - targetRatio) > 0.1) matchesAdvancedSearch = false;
                } else {
                    matchesAdvancedSearch = false; // No dimensions available
                }
            }
            
            // Star rating filter
            if (advancedSearchFilters.starRating !== null && filePath && matchesAdvancedSearch) {
                const rating = getFileRating(filePath);
                if (rating < advancedSearchFilters.starRating) matchesAdvancedSearch = false;
            }
        }
        
        // Show card only if it matches search, filter, and advanced search
        if (matchesSearch && matchesFilter && matchesAdvancedSearch) {
            card.style.display = '';
        } else {
            card.style.display = 'none';
        }
    });
    
    // Sort by star rating if stars filter is active (highest to lowest: 5 to 1)
    if (currentFilter === 'stars') {
        const visibleCards = Array.from(cards).filter(card => card.style.display !== 'none');
        visibleCards.sort((a, b) => {
            // Exclude folders from sorting
            const aIsFolder = a.classList.contains('folder-card');
            const bIsFolder = b.classList.contains('folder-card');
            
            if (aIsFolder && bIsFolder) return 0;
            if (aIsFolder) return 1; // Folders go to end
            if (bIsFolder) return -1; // Folders go to end
            
            const aPath = a.dataset.path;
            const bPath = b.dataset.path;
            
            if (!aPath && !bPath) return 0;
            if (!aPath) return 1; // No path goes to end
            if (!bPath) return -1; // No path goes to end
            
            const aRating = getFileRating(aPath);
            const bRating = getFileRating(bPath);
            
            // Sort from highest to lowest (5 stars to 1 star)
            return bRating - aRating;
        });
        
        // Reorder cards in DOM
        visibleCards.forEach(card => {
            gridContainer.appendChild(card);
        });
    }
    
    // Recalculate layout after filtering
    if (layoutMode === 'masonry' && gridContainer.classList.contains('masonry')) {
        scheduleMasonryLayout();
    }
    updateItemCount();
    perfTest.end('applyFilters', perfStart, { cardCount: cards.length });
}

function performSearch(searchQuery) {
    // Debounce search to avoid excessive filtering while typing
    clearTimeout(filterDebounceTimer);
    filterDebounceTimer = setTimeout(() => {
        applyFilters();
    }, 150); // Wait 150ms after user stops typing
}

// --- Delegated Event Handlers for Grid Cards ---
// Instead of attaching listeners to each card, delegate from gridContainer

let currentHoveredCard = null;

gridContainer.addEventListener('click', (e) => {
    // Star click (check first so stopPropagation prevents card click)
    const star = e.target.closest('.star');
    if (star) {
        e.stopPropagation();
        e.preventDefault();
        const card = star.closest('.video-card');
        if (card && card.dataset.path) {
            const stars = Array.from(star.parentElement.children);
            const starIndex = stars.indexOf(star) + 1;
            if (starIndex > 0) {
                setFileRating(card.dataset.path, starIndex);
            }
        }
        return;
    }

    // Media card click
    const mediaCard = e.target.closest('.video-card');
    if (mediaCard) {
        openLightbox(mediaCard.dataset.src, mediaCard.dataset.path, mediaCard.dataset.name);
        return;
    }

    // Folder card click
    const folderCard = e.target.closest('.folder-card');
    if (folderCard) {
        setTimeout(() => {
            navigateToFolder(folderCard.dataset.folderPath).catch(err => {
                console.error('Error navigating to folder:', err);
                hideLoadingIndicator();
            });
        }, 0);
    }
});

gridContainer.addEventListener('mouseover', (e) => {
    const card = e.target.closest('.video-card');
    if (card && card !== currentHoveredCard && card.dataset.mediaType === 'video') {
        currentHoveredCard = card;
        const video = card.querySelector('video');
        if (video) {
            showScrubber(card, video);
        }
    }
    // Check if filename overlaps with resolution label and shift it up if needed
    // Cache the result per card to avoid layout thrashing on every hover
    if (card && !card.dataset.overlapChecked) {
        const info = card.querySelector('.video-info');
        const resLabel = card.querySelector('.resolution-label');
        if (info && resLabel) {
            const range = document.createRange();
            range.selectNodeContents(info);
            const textWidth = range.getBoundingClientRect().width;
            const cardWidth = card.offsetWidth;
            const labelLeft = cardWidth - resLabel.offsetWidth - 16;
            resLabel.classList.toggle('shifted-up', textWidth + 10 > labelLeft);
            card.dataset.overlapChecked = '1';
        }
    }
});

gridContainer.addEventListener('mouseout', (e) => {
    if (!currentHoveredCard) return;
    const relatedCard = e.relatedTarget ? e.relatedTarget.closest('.video-card') : null;
    if (relatedCard !== currentHoveredCard) {
        hideScrubber(currentHoveredCard);
        currentHoveredCard = null;
    }
});

// --- Drag & Drop Support ---

// Supported media extensions for filtering dropped files
const SUPPORTED_DROP_EXTENSIONS = new Set([
    '.mp4', '.webm', '.ogg', '.mov',
    '.gif', '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.svg'
]);

function isDroppedFileSupported(fileName) {
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot === -1) return false;
    return SUPPORTED_DROP_EXTENSIONS.has(fileName.substring(lastDot).toLowerCase());
}

// Helper to get file paths from internal drag or external file drop
function getDroppedFilePaths(dataTransfer) {
    // Check for internal app drag (media card)
    const internalPath = dataTransfer.getData('application/x-thumbnail-animator-path');
    if (internalPath) {
        return { paths: [internalPath], isInternal: true };
    }
    // Check for external files dropped from Explorer
    if (dataTransfer.files && dataTransfer.files.length > 0) {
        const paths = [];
        for (const file of dataTransfer.files) {
            if (file.path && isDroppedFileSupported(file.name)) {
                paths.push(file.path);
            }
        }
        return { paths, isInternal: false };
    }
    return { paths: [], isInternal: false };
}

// Copy external files into a destination folder
async function copyFilesToFolder(filePaths, destFolder) {
    if (!filePaths || filePaths.length === 0) return;

    showProgress(0, filePaths.length, 'Copying files...');
    let success = 0;
    let failed = 0;

    for (let i = 0; i < filePaths.length; i++) {
        if (currentProgress && currentProgress.cancelled) break;

        const filePath = filePaths[i];
        const fileName = filePath.substring(Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/')) + 1);
        const separator = destFolder.includes('\\') ? '\\' : '/';
        const destPath = destFolder + (destFolder.endsWith('\\') || destFolder.endsWith('/') ? '' : separator) + fileName;

        try {
            const result = await window.electronAPI.copyFile(filePath, destPath);
            if (result.success) {
                success++;
            } else {
                failed++;
            }
        } catch {
            failed++;
        }

        updateProgress(i + 1, filePaths.length);
    }

    hideProgress();
    if (success > 0) {
        await navigateToFolder(currentFolderPath); // Refresh
    }
    if (failed > 0) {
        alert(`Failed to copy ${failed} file(s)`);
    }
}

// Drop on grid — copy external files into current folder
gridContainer.addEventListener('dragover', (e) => {
    // Only show drop effect for external files or when hovering a folder card
    const folderCard = e.target.closest('.folder-card');
    if (folderCard || (e.dataTransfer.types.includes('Files') && currentFolderPath)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = folderCard ? 'move' : 'copy';
        if (folderCard) {
            folderCard.classList.add('drag-over');
        }
    }
});

gridContainer.addEventListener('dragleave', (e) => {
    const folderCard = e.target.closest('.folder-card');
    if (folderCard) {
        folderCard.classList.remove('drag-over');
    }
});

gridContainer.addEventListener('drop', async (e) => {
    e.preventDefault();

    // Remove drag-over styling
    gridContainer.querySelectorAll('.folder-card.drag-over').forEach(c => c.classList.remove('drag-over'));

    const { paths, isInternal } = getDroppedFilePaths(e.dataTransfer);
    if (paths.length === 0) return;

    // Check if dropped on a folder card
    const folderCard = e.target.closest('.folder-card');
    if (folderCard) {
        const destFolder = folderCard.dataset.folderPath;
        if (destFolder) {
            if (isInternal) {
                await moveFilesToFolder(paths, destFolder);
            } else {
                await copyFilesToFolder(paths, destFolder);
            }
        }
        return;
    }

    // Dropped on grid background — copy external files into current folder
    if (!isInternal && currentFolderPath) {
        await copyFilesToFolder(paths, currentFolderPath);
    }
});

// Drop on sidebar folder — move internal files or copy external files
sidebarTree.addEventListener('dragover', (e) => {
    const row = e.target.closest('.tree-node-row');
    if (row) {
        e.preventDefault();
        e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/x-thumbnail-animator-path') ? 'move' : 'copy';
        row.classList.add('drag-over');
    }
});

sidebarTree.addEventListener('dragleave', (e) => {
    const row = e.target.closest('.tree-node-row');
    if (row) {
        row.classList.remove('drag-over');
    }
});

sidebarTree.addEventListener('drop', async (e) => {
    e.preventDefault();

    // Remove drag-over styling
    sidebarTree.querySelectorAll('.tree-node-row.drag-over').forEach(r => r.classList.remove('drag-over'));

    const row = e.target.closest('.tree-node-row');
    if (!row) return;

    const node = row.closest('.tree-node');
    const destFolder = node ? node.dataset.path : null;
    if (!destFolder) return;

    const { paths, isInternal } = getDroppedFilePaths(e.dataTransfer);
    if (paths.length === 0) return;

    if (isInternal) {
        await moveFilesToFolder(paths, destFolder);
    } else {
        await copyFilesToFolder(paths, destFolder);
    }
});

// Prevent default browser behavior for drag events on the whole window
// This prevents the browser from opening dropped files
document.addEventListener('dragover', (e) => {
    e.preventDefault();
});
document.addEventListener('drop', (e) => {
    e.preventDefault();
});

// --- Event Listeners ---

selectFolderBtn.addEventListener('click', async () => {
    // Get the last folder path from localStorage if remembering is enabled
    const lastFolderPath = rememberLastFolder ? localStorage.getItem('lastFolderPath') : null;
    const folderPath = await window.electronAPI.selectFolder(lastFolderPath);
    if (folderPath) {
        // Save the selected folder path to localStorage if remembering is enabled
        if (rememberLastFolder) {
            deferLocalStorageWrite('lastFolderPath', folderPath);
        }
        // Update current tab if it exists and has no path, otherwise create new tab
        if (activeTabId) {
            const tab = tabs.find(t => t.id === activeTabId);
            if (tab && !tab.path) {
                // Update empty tab
                tab.path = folderPath;
                tab.name = folderPath.split(/[/\\]/).pop();
                saveTabs();
                renderTabs();
            } else {
                // Create new tab
                createTab(folderPath, folderPath.split(/[/\\]/).pop());
            }
        } else {
            createTab(folderPath, folderPath.split(/[/\\]/).pop());
        }
        // Use setTimeout to yield control back to event loop, making button responsive
        setTimeout(() => {
            navigateToFolder(folderPath).catch(err => {
                console.error('Error navigating to folder:', err);
                hideLoadingIndicator();
            });
        }, 0);
    }
});

// Back/Forward button handlers
backBtn.addEventListener('click', goBack);
forwardBtn.addEventListener('click', goForward);

// Handle mouse back/forward buttons (browser navigation)
window.addEventListener('popstate', (event) => {
    // This handles browser back/forward buttons
    // We'll use our own history system instead
});

// Handle mouse back/forward buttons directly
// Use auxclick event which is specifically for non-primary mouse buttons
document.addEventListener('auxclick', (e) => {
    // Check for mouse back button (button 3) or forward button (button 4)
    if (e.button === 3) {
        // Back button
        e.preventDefault();
        e.stopPropagation();
        if (navigationHistory.canGoBack()) {
            goBack();
        }
    } else if (e.button === 4) {
        // Forward button
        e.preventDefault();
        e.stopPropagation();
        if (navigationHistory.canGoForward()) {
            goForward();
        }
    }
});

// Also handle mouseup as fallback for older browsers
document.addEventListener('mouseup', (e) => {
    // Only handle if auxclick didn't fire (button 3 or 4)
    if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
        if (e.button === 3 && navigationHistory.canGoBack()) {
            goBack();
        } else if (e.button === 4 && navigationHistory.canGoForward()) {
            goForward();
        }
    }
});

// Function to show drives selection
async function showDrivesSelection() {
    try {
        const drives = await window.electronAPI.getDrives();
        if (drives.length === 0) {
            return; // No drives available or not on Windows
        }
        
        // Create a dropdown/popup to show drives
        const existingDropdown = document.getElementById('drives-dropdown');
        if (existingDropdown) {
            existingDropdown.remove();
        }
        
        const dropdown = document.createElement('div');
        dropdown.id = 'drives-dropdown';
        dropdown.className = 'drives-dropdown';
        
        drives.forEach(drive => {
            const driveItem = document.createElement('div');
            driveItem.className = 'drive-item';
            driveItem.textContent = drive.name;
            driveItem.addEventListener('click', (e) => {
                e.stopPropagation();
                dropdown.remove();
                // Use setTimeout to yield control back to event loop, making button responsive
                setTimeout(() => {
                    navigateToFolder(drive.path).catch(err => {
                        console.error('Error navigating to drive:', err);
                        hideLoadingIndicator();
                    });
                }, 0);
            });
            dropdown.appendChild(driveItem);
        });
        
        // Position dropdown near the Computer breadcrumb item
        const computerItem = breadcrumbContainer.querySelector('.breadcrumb-item[data-path="computer"]');
        let rect;
        if (computerItem) {
            rect = computerItem.getBoundingClientRect();
        } else {
            // Fallback positioning - use breadcrumb container
            rect = breadcrumbContainer.getBoundingClientRect();
        }
        
        dropdown.style.position = 'fixed';
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.top = `${rect.bottom + 5}px`;
        dropdown.style.zIndex = '1000';
        
        // Ensure dropdown doesn't go off screen
        requestAnimationFrame(() => {
            const dropdownRect = dropdown.getBoundingClientRect();
            if (dropdownRect.right > window.innerWidth) {
                dropdown.style.left = `${window.innerWidth - dropdownRect.width - 10}px`;
            }
            if (dropdownRect.bottom > window.innerHeight) {
                dropdown.style.top = `${rect.top - dropdownRect.height - 5}px`;
            }
        });
        
        document.body.appendChild(dropdown);
        
        // Close dropdown when clicking outside
        const closeDropdown = (e) => {
            if (!dropdown.contains(e.target) && !computerItem?.contains(e.target)) {
                dropdown.remove();
                document.removeEventListener('click', closeDropdown);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeDropdown);
        }, 0);
    } catch (error) {
        console.error('Error showing drives:', error);
    }
}

// Function to update breadcrumb navigation
function updateBreadcrumb(folderPath) {
    if (!folderPath) {
        if (currentPathSpan) {
            currentPathSpan.textContent = 'No folder selected';
        }
        breadcrumbContainer.innerHTML = '<span id="current-path" class="breadcrumb-editable">No folder selected</span>';
        currentPathSpan = document.getElementById('current-path');
        breadcrumbContainer.appendChild(itemCountEl);
        return;
    }

    // Normalize path separators
    const normalizedPath = folderPath.replace(/\\/g, '/');
    const isWindowsPath = folderPath.includes('\\') || (folderPath.length > 1 && folderPath[1] === ':');
    const separator = isWindowsPath ? '\\' : '/';
    
    // Split path into parts
    const pathParts = normalizedPath.split('/').filter(part => part.length > 0);
    
    // Handle Windows drive letters (e.g., "C:")
    let breadcrumbParts = [];
    if (pathParts.length > 0 && pathParts[0].endsWith(':')) {
        // Windows path - keep drive letter as first part
        breadcrumbParts.push(pathParts[0]);
        for (let i = 1; i < pathParts.length; i++) {
            breadcrumbParts.push(pathParts[i]);
        }
    } else {
        // Unix/Mac path
        breadcrumbParts = pathParts;
    }

    // Build breadcrumb HTML with editable path display
    let breadcrumbHTML = '';
    let currentPath = '';
    
    // Add "Computer" item before drive on Windows (always show it for Windows paths)
    if (isWindowsPath && breadcrumbParts.length > 0 && breadcrumbParts[0].endsWith(':')) {
        breadcrumbHTML += `<span class="breadcrumb-item" data-path="computer">Computer</span>`;
        breadcrumbHTML += '<span class="breadcrumb-separator">/</span>';
    }
    
    breadcrumbParts.forEach((part, index) => {
        // Build path up to this part
        if (index === 0) {
            if (part.endsWith(':')) {
                // Windows drive letter
                currentPath = part + separator;
            } else {
                // Unix root
                currentPath = separator + part + separator;
            }
        } else {
            currentPath = currentPath + (currentPath.endsWith(separator) ? '' : separator) + part + separator;
        }
        
        // Remove trailing separator for data-path
        const pathForData = currentPath.replace(/[/\\]$/, '');
        breadcrumbHTML += `<span class="breadcrumb-item" data-path="${pathForData.replace(/\\/g, '\\\\')}">${part}</span>`;
        if (index < breadcrumbParts.length - 1) {
            breadcrumbHTML += '<span class="breadcrumb-separator">/</span>';
        }
    });
    
    // Add editable path input (hidden by default, shown when clicked)
    breadcrumbHTML += `<input type="text" class="breadcrumb-input" value="${folderPath.replace(/\\/g, '\\\\')}" style="display: none;">`;

    breadcrumbContainer.innerHTML = breadcrumbHTML;
    breadcrumbContainer.appendChild(itemCountEl);

    const breadcrumbInput = breadcrumbContainer.querySelector('.breadcrumb-input');
    const breadcrumbItems = breadcrumbContainer.querySelectorAll('.breadcrumb-item, .breadcrumb-separator');
    
    // Add click handlers to breadcrumb items (for navigation)
    breadcrumbContainer.querySelectorAll('.breadcrumb-item').forEach(item => {
        item.addEventListener('click', async (e) => {
            e.stopPropagation();
            const targetPath = item.dataset.path;
            
            // Special handling for "Computer" item
            if (targetPath === 'computer') {
                // Use setTimeout to yield control back to event loop
                setTimeout(() => {
                    showDrivesSelection().catch(err => {
                        console.error('Error showing drives:', err);
                    });
                }, 0);
                return;
            }
            
            const normalizedTargetPath = targetPath.replace(/\\\\/g, '\\');
            // Use setTimeout to yield control back to event loop, making button responsive
            setTimeout(() => {
                navigateToFolder(normalizedTargetPath).catch(err => {
                    console.error('Error navigating to folder:', err);
                    hideLoadingIndicator();
                });
            }, 0);
        });
    });
    
    // Make breadcrumb editable when clicking on empty space or separators
    breadcrumbContainer.addEventListener('click', (e) => {
        // Don't trigger if clicking on an individual breadcrumb item (they navigate)
        if (e.target.classList.contains('breadcrumb-item')) {
            return;
        }
        
        // Show input, hide breadcrumb items
        breadcrumbItems.forEach(item => item.style.display = 'none');
        if (breadcrumbInput) {
            breadcrumbInput.style.display = 'block';
            breadcrumbInput.focus();
            breadcrumbInput.select();
        }
    });
    
    // Handle input events
    if (breadcrumbInput) {
        breadcrumbInput.addEventListener('blur', () => {
            // Hide input, show breadcrumb items
            breadcrumbItems.forEach(item => item.style.display = '');
            breadcrumbInput.style.display = 'none';
        });
        
        breadcrumbInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const newPath = breadcrumbInput.value.trim();
                if (newPath) {
                    // Validate and navigate to the path
                    // Use setTimeout to yield control back to event loop, making button responsive
                    setTimeout(() => {
                        navigateToFolder(newPath).catch(err => {
                            console.error('Error navigating to folder:', err);
                            hideLoadingIndicator();
                        });
                    }, 0);
                } else {
                    // Reset to current path if empty
                    breadcrumbInput.value = folderPath;
                    breadcrumbInput.blur();
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                // Reset to current path
                breadcrumbInput.value = folderPath;
                breadcrumbInput.blur();
            }
        });
    }
}

// Loading indicator helpers
function showLoadingIndicator() {
    if (loadingIndicator) {
        loadingIndicator.classList.remove('hidden');
    }
}

function hideLoadingIndicator() {
    if (loadingIndicator) {
        loadingIndicator.classList.add('hidden');
    }
}

// Helper function to yield control back to the event loop
function yieldToEventLoop() {
    return new Promise(resolve => {
        // Use setImmediate if available (Node.js), otherwise setTimeout
        if (typeof setImmediate !== 'undefined') {
            setImmediate(resolve);
        } else {
            setTimeout(resolve, 0);
        }
    });
}

// Function to navigate to a folder
async function navigateToFolder(folderPath, addToHistory = true, forceReload = false) {
    const perfStart = perfTest.start();
    const folderName = folderPath.split(/[/\\]/).filter(Boolean).pop() || folderPath;
    setStatusActivity(`Navigating to ${folderName}...`);
    try {
        // If forcing reload, invalidate cache first
        if (forceReload) {
            invalidateFolderCache(folderPath);
        }
        
        // Check cache first - if we have cached content, skip validation scan
        const now = Date.now();
        let hasCachedContent = false;
        let cacheAge = Infinity;
        const CACHE_STALE_THRESHOLD = 5000; // 5 seconds - if cache is older, refresh to show new files
        
        if (!forceReload) {
            const normalizedPath = normalizePath(folderPath);
            
            // Check tab cache
            if (activeTabId) {
                const tabCache = tabContentCache.get(activeTabId);
                if (tabCache) {
                    const cachePathNormalized = normalizePath(tabCache.path);
                    if ((cachePathNormalized === normalizedPath || tabCache.path === folderPath) && 
                        (now - tabCache.timestamp) < FOLDER_CACHE_TTL) {
                        hasCachedContent = true;
                        cacheAge = now - tabCache.timestamp;
                    }
                }
            }
            
            // Check global folder cache
            if (!hasCachedContent) {
                const globalCache = folderCache.get(normalizedPath) || folderCache.get(folderPath);
                if (globalCache && (now - globalCache.timestamp) < GLOBAL_CACHE_TTL) {
                    hasCachedContent = true;
                    cacheAge = now - globalCache.timestamp;
                }
            }
            
            // If cache exists but is stale (older than threshold), force reload to show new files
            // This ensures that when navigating back to a folder, new files are visible
            if (hasCachedContent && cacheAge > CACHE_STALE_THRESHOLD) {
                forceReload = true;
                invalidateFolderCache(folderPath);
                hasCachedContent = false;
            }
        }
        
        // Only validate path if we don't have cached content (faster)
        if (!hasCachedContent) {
            // Show loading indicator
            showLoadingIndicator();
            try {
                // Validate path exists by trying to scan it
                // Skip stats if sorting by name for faster validation
                const skipStats = sortType === 'name';
                await window.electronAPI.scanFolder(folderPath, { skipStats });
            } finally {
                // Hide loading indicator after a short delay to prevent flicker
                setTimeout(() => hideLoadingIndicator(), 100);
            }
        }
        
        // Yield control to allow UI to update
        await yieldToEventLoop();
        
        // If scan succeeds (even with empty results), path is valid
        currentFolderPath = folderPath;
        // Save the folder path to localStorage whenever we navigate to a folder (if remembering is enabled)
        if (rememberLastFolder) {
            deferLocalStorageWrite('lastFolderPath', folderPath);
        }
        if (addToHistory) {
            navigationHistory.add(folderPath);
        }
        
        // Update current tab
        updateCurrentTab(folderPath, folderPath.split(/[/\\]/).pop());
        
        updateBreadcrumb(folderPath);
        searchBox.value = ''; // Clear search when navigating
        currentFilter = 'all'; // Reset filter when navigating
        filterAllBtn.classList.add('active');
        filterVideosBtn.classList.remove('active');
        filterImagesBtn.classList.remove('active');
        filterAudioBtn.classList.remove('active');
        loadVideos(folderPath, !forceReload); // Use cache unless forcing reload

        // Sync sidebar tree with current folder — expand tree then highlight
        sidebarExpandToPath(folderPath);

        // Reset keyboard focus
        focusedCardIndex = -1;
        perfTest.end('navigateToFolder', perfStart);
    } catch (error) {
        perfTest.end('navigateToFolder', perfStart);
        // Path doesn't exist or is invalid - show error and revert breadcrumb
        console.error('Invalid path:', folderPath, error);
        // Revert breadcrumb to current path
        if (currentFolderPath) {
            updateBreadcrumb(currentFolderPath);
        }
        // Could show a toast/notification here if desired
        alert(`Path not found: ${folderPath}`);
    }
}

// Navigation functions
async function goBack() {
    const path = navigationHistory.goBack();
    if (path) {
        // Use setTimeout to yield control back to event loop, making button responsive
        setTimeout(() => {
            navigateToFolder(path, false).catch(err => {
                console.error('Error navigating back:', err);
                hideLoadingIndicator();
            });
        }, 0);
    }
}

async function goForward() {
    const path = navigationHistory.goForward();
    if (path) {
        // Use setTimeout to yield control back to event loop, making button responsive
        setTimeout(() => {
            navigateToFolder(path, false).catch(err => {
                console.error('Error navigating forward:', err);
                hideLoadingIndicator();
            });
        }, 0);
    }
}

// Live search as user types (debounced)
searchBox.addEventListener('input', (e) => {
    performSearch(e.target.value);
});

// Filter button event listeners
filterAllBtn.addEventListener('click', () => {
    currentFilter = 'all';
    filterAllBtn.classList.add('active');
    filterVideosBtn.classList.remove('active');
    filterImagesBtn.classList.remove('active');
    filterAudioBtn.classList.remove('active');
    const filterStarsBtn = document.getElementById('filter-stars');
    if (filterStarsBtn) filterStarsBtn.classList.remove('active');
    scheduleApplyFilters();
});

filterVideosBtn.addEventListener('click', () => {
    currentFilter = 'video';
    filterAllBtn.classList.remove('active');
    filterVideosBtn.classList.add('active');
    filterImagesBtn.classList.remove('active');
    filterAudioBtn.classList.remove('active');
    const filterStarsBtn = document.getElementById('filter-stars');
    if (filterStarsBtn) filterStarsBtn.classList.remove('active');
    scheduleApplyFilters();
});

filterImagesBtn.addEventListener('click', () => {
    currentFilter = 'image';
    filterAllBtn.classList.remove('active');
    filterVideosBtn.classList.remove('active');
    filterImagesBtn.classList.add('active');
    filterAudioBtn.classList.remove('active');
    const filterStarsBtn = document.getElementById('filter-stars');
    if (filterStarsBtn) filterStarsBtn.classList.remove('active');
    scheduleApplyFilters();
});

filterAudioBtn.addEventListener('click', () => {
    currentFilter = 'audio';
    filterAllBtn.classList.remove('active');
    filterVideosBtn.classList.remove('active');
    filterImagesBtn.classList.remove('active');
    filterAudioBtn.classList.add('active');
    const filterStarsBtn = document.getElementById('filter-stars');
    if (filterStarsBtn) filterStarsBtn.classList.remove('active');
    scheduleApplyFilters();
});

// Settings button event listener
settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSettingsDropdown();
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (!settingsBtn.contains(e.target) && !settingsDropdown.contains(e.target)) {
        closeSettingsDropdown();
    }
});

// Layout mode toggle event listener
layoutModeToggle.addEventListener('change', () => {
    switchLayoutMode();
});

// Remember folder toggle event listener
rememberFolderToggle.addEventListener('change', () => {
    toggleRememberFolder();
});

// Include moving images toggle event listener
includeMovingImagesToggle.addEventListener('change', () => {
    toggleIncludeMovingImages();
});

// Pause on lightbox toggle
pauseOnLightboxToggle.addEventListener('change', () => {
    pauseOnLightbox = pauseOnLightboxToggle.checked;
    pauseOnLightboxLabel.textContent = pauseOnLightbox ? 'On' : 'Off';
    deferLocalStorageWrite('pauseOnLightbox', pauseOnLightbox.toString());
});

// Pause on blur toggle
pauseOnBlurToggle.addEventListener('change', () => {
    pauseOnBlur = pauseOnBlurToggle.checked;
    pauseOnBlurLabel.textContent = pauseOnBlur ? 'On' : 'Off';
    deferLocalStorageWrite('pauseOnBlur', pauseOnBlur.toString());
});

// Auto-repeat videos toggle
autoRepeatToggle.addEventListener('change', () => {
    autoRepeatVideos = autoRepeatToggle.checked;
    autoRepeatLabel.textContent = autoRepeatVideos ? 'On' : 'Off';
    deferLocalStorageWrite('autoRepeatVideos', autoRepeatVideos.toString());
    // Sync to current video - use native loop for seamless playback
    if (autoRepeatVideos) {
        videoLoop = true;
        if (lightboxVideo) {
            lightboxVideo.loop = true;
        }
    } else {
        videoLoop = false;
        if (lightboxVideo) {
            lightboxVideo.loop = false;
        }
    }
    const loopBtn = document.getElementById('lightbox-loop-btn');
    if (loopBtn) {
        loopBtn.textContent = videoLoop ? 'On' : 'Off';
        loopBtn.classList.toggle('active', videoLoop);
    }
});

// Sorting dropdown event listeners
sortTypeSelect.addEventListener('change', () => {
    updateSorting();
});

sortOrderSelect.addEventListener('change', () => {
    updateSorting();
});

// Theme select event listener
themeSelect.addEventListener('change', () => {
    currentTheme = themeSelect.value;
    applyTheme();
});

// Thumbnail quality select event listener
thumbnailQualitySelect.addEventListener('change', () => {
    thumbnailQuality = thumbnailQualitySelect.value;
    deferLocalStorageWrite('thumbnailQuality', thumbnailQuality);
    // Reload current folder to apply new quality
    if (currentFolderPath) {
        loadVideos(currentFolderPath);
    }
});

// Zoom slider event listener (throttled layout, instant visual feedback)
let zoomLayoutTimer = null;
zoomSlider.addEventListener('input', (e) => {
    zoomLevel = parseInt(e.target.value, 10);
    zoomValue.textContent = `${zoomLevel}%`;
    // Clear cached overlap checks since card sizes changed
    gridContainer.querySelectorAll('.video-card[data-overlap-checked]').forEach(c => delete c.dataset.overlapChecked);
    // Instant CSS variable update for visual feedback
    document.documentElement.style.setProperty('--zoom-level', zoomLevel);
    // Throttle the expensive layout recalculation + localStorage write
    if (zoomLayoutTimer === null) {
        zoomLayoutTimer = requestAnimationFrame(() => {
            zoomLayoutTimer = null;
            applyZoom();
            deferLocalStorageWrite('zoomLevel', zoomLevel.toString());
            updateStatusBar();
        });
    }
});

// Favorites button event listener
favoritesBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    favoritesDropdown.classList.toggle('hidden');
    recentFilesDropdown.classList.add('hidden');
});

// Add favorite button event listener
addFavoriteBtn.addEventListener('click', () => {
    if (currentFolderPath) {
        addFavorite(currentFolderPath, currentFolderPath.split(/[/\\]/).pop());
    }
    favoritesDropdown.classList.add('hidden');
});

// Recent files button event listener
recentFilesBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    recentFilesDropdown.classList.toggle('hidden');
    favoritesDropdown.classList.add('hidden');
});

// Clear recent files button event listener
clearRecentBtn.addEventListener('click', () => {
    clearRecentFiles();
});

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
    if (!favoritesBtn.contains(e.target) && !favoritesDropdown.contains(e.target)) {
        favoritesDropdown.classList.add('hidden');
    }
    if (!recentFilesBtn.contains(e.target) && !recentFilesDropdown.contains(e.target)) {
        recentFilesDropdown.classList.add('hidden');
    }
});

function openLightbox(mediaUrl, filePath, fileName) {
    const perfStart = perfTest.start();
    const mediaType = getFileType(mediaUrl);

    // Track current index for navigation
    lightboxItems = getFilteredMediaItems();
    currentLightboxIndex = lightboxItems.findIndex(item => item.path === filePath);
    if (currentLightboxIndex === -1) {
        currentLightboxIndex = 0;
    }
    
    // Store current file info globally for info button
    window.currentLightboxFilePath = filePath;
    window.currentLightboxFileUrl = mediaUrl;
    
    // Add to recent files
    addRecentFile(filePath, fileName, mediaUrl, mediaType);
    
    // Store file info for copy buttons
    const lightboxFilename = document.getElementById('lightbox-filename');
    const copyPathBtn = document.getElementById('copy-path-btn');
    const copyNameBtn = document.getElementById('copy-name-btn');
    
    // Display filename
    if (lightboxFilename && fileName) {
        lightboxFilename.textContent = fileName;
    }
    
    // Store file path and name in button data attributes for copying
    if (copyPathBtn && filePath) {
        copyPathBtn.dataset.filePath = filePath;
    }
    if (copyNameBtn && fileName) {
        copyNameBtn.dataset.fileName = fileName;
    }
    
    // If file info panel is open, update it with new file info instead of closing
    const fileInfoPanel = document.getElementById('file-info-panel');
    if (fileInfoPanel && !fileInfoPanel.classList.contains('hidden')) {
        // Panel is open, update it with the new file's info
        showFileInfo(filePath);
    }
    
    // Pause thumbnail videos while lightbox is open
    pauseThumbnailVideos();

    // Reset zoom when opening new media
    resetZoom();

    // Attach zoom slider listeners if not already attached
    attachZoomSliderListeners();
    
    // Verify zoom controls exist
    const slider = document.getElementById('lightbox-zoom-slider');
    const zoomValueDisplay = document.getElementById('lightbox-zoom-value');
    if (!slider) {
        console.error('lightboxZoomSlider not found when opening lightbox!');
    }
    if (!zoomValueDisplay) {
        console.error('lightboxZoomValue not found when opening lightbox!');
    }
    
    if (mediaType === 'image') {
        // Hide video, show image
        lightboxVideo.style.display = 'none';
        lightboxImage.style.display = 'block';
        
        // Hide video menu button for images
        const videoMenuContainer = document.getElementById('lightbox-video-menu-container');
        if (videoMenuContainer) videoMenuContainer.style.display = 'none';
        
        lightbox.classList.remove('hidden');
        // Ensure initial transform is set and constraints are consistent
        lightboxImage.style.transform = 'scale(1)';
        lightboxImage.style.maxWidth = '90vw';
        lightboxImage.style.maxHeight = '90vh';
        lightboxImage.style.width = 'auto';
        lightboxImage.style.height = 'auto';
        
        // Wait for image to load, then capture its displayed size for zoom calculations
        const handleImageLoad = () => {
            // Use requestAnimationFrame to ensure layout is complete
            requestAnimationFrame(() => {
                const rect = lightboxImage.getBoundingClientRect();
                lightboxImage.dataset.baseWidth = rect.width.toString();
                lightboxImage.dataset.baseHeight = rect.height.toString();
                console.log('Image loaded, captured base size:', rect.width, 'x', rect.height);
            });
            lightboxImage.removeEventListener('load', handleImageLoad);
        };
        
        // If image is already loaded, capture size immediately
        if (lightboxImage.complete && lightboxImage.naturalWidth > 0) {
            handleImageLoad();
        } else {
            lightboxImage.addEventListener('load', handleImageLoad);
        }
        
        lightboxImage.src = mediaUrl;
        lightboxImage.dataset.src = mediaUrl; // Store for restoration after minimize
    } else {
        // Hide image, show video
        lightboxImage.style.display = 'none';
        lightboxVideo.style.display = 'block';
        lightboxVideo.src = mediaUrl;
        lightboxVideo.dataset.src = mediaUrl; // Store for restoration after minimize
        lightbox.classList.remove('hidden');
        // Ensure initial transform is set and constraints are consistent
        lightboxVideo.style.transform = 'scale(1)';
        lightboxVideo.style.maxWidth = '90vw';
        lightboxVideo.style.maxHeight = '90vh';
        
        // Set video playback controls
        lightboxVideo.playbackRate = videoPlaybackSpeed;
        lightboxVideo.loop = videoLoop;
        
        // Show video menu button
        const videoMenuContainer = document.getElementById('lightbox-video-menu-container');
        if (videoMenuContainer) videoMenuContainer.style.display = 'block';
        
        // Update UI buttons
        const speedBtn = document.getElementById('lightbox-speed-btn');
        if (speedBtn) speedBtn.textContent = `${videoPlaybackSpeed}x`;
        const loopBtn = document.getElementById('lightbox-loop-btn');
        if (loopBtn) {
            loopBtn.textContent = videoLoop ? 'On' : 'Off';
            loopBtn.classList.toggle('active', videoLoop);
        }
        const repeatBtn = document.getElementById('lightbox-repeat-btn');
        if (repeatBtn) {
            repeatBtn.textContent = videoRepeat ? 'On' : 'Off';
            repeatBtn.classList.toggle('active', videoRepeat);
        }
        
        // Set up repeat handler (remove first to prevent duplicates from previous lightbox opens)
        lightboxVideo.removeEventListener('ended', handleVideoRepeat);
        if (videoRepeat) {
            lightboxVideo.addEventListener('ended', handleVideoRepeat);
        }
        
        lightboxVideo.play();
    }
    
    // Reset keyboard focus
    focusedCardIndex = -1;
    perfTest.end('openLightbox', perfStart);
}

function applyLightboxZoom(zoomLevel, mouseX = null, mouseY = null) {
    console.log('applyLightboxZoom called with:', zoomLevel);
    const previousZoomLevel = currentZoomLevel;
    // Calculate previous zoom value accurately
    let previousZoomValue;
    if (previousZoomLevel <= 100) {
        previousZoomValue = previousZoomLevel / 100;
    } else {
        previousZoomValue = Math.pow(1.06, (previousZoomLevel - 100) / 5);
    }
    currentZoomLevel = zoomLevel;
    
    // Use exponential scaling for consistent visual zoom steps
    // Each step multiplies the visual size by the same factor
    // This makes 100%→110% feel the same as 400%→410%
    let zoomValue;
    
    if (zoomLevel <= 100) {
        // Linear scaling for zoom out (0-100%)
        zoomValue = zoomLevel / 100;
    } else {
        // Exponential scaling: scale = base^((zoomLevel - 100) / stepSize)
        // Each slider step (5%) multiplies size by the base factor
        // This ensures consistent visual zoom increments at all levels
        const base = 1.06; // Each 5% step multiplies by ~6% visually (more noticeable)
        const stepSize = 5; // Slider step size (matches HTML step="5")
        const steps = (zoomLevel - 100) / stepSize;
        zoomValue = Math.pow(base, steps);
        
        // At 500%: 1.06^80 ≈ 108x zoom (very high zoom capability)
        // Each 5% step always feels like the same visual increase (~6%)
    }
    
    // Cache the zoom value for efficient panning
    cachedZoomValue = zoomValue;
    
    // Check which media is currently visible
    const imageInlineDisplay = lightboxImage.style.display;
    const videoInlineDisplay = lightboxVideo.style.display;
    const isImageVisible = imageInlineDisplay === 'block' || 
                          (imageInlineDisplay === '' && window.getComputedStyle(lightboxImage).display !== 'none');
    const isVideoVisible = videoInlineDisplay === 'block' || 
                          (videoInlineDisplay === '' && window.getComputedStyle(lightboxVideo).display !== 'none');
    
    // Reset translation when zooming back to 100% or below
    if (zoomLevel <= 100) {
        currentTranslateX = 0;
        currentTranslateY = 0;
    } else if (mouseX !== null && mouseY !== null && zoomLevel > 100) {
        // Zoom at pointer position: adjust translate to keep the point under cursor fixed
        // Get the visible element
        const visibleElement = isImageVisible ? lightboxImage : (isVideoVisible ? lightboxVideo : null);
        if (visibleElement) {
            // Get the viewport center (where the element is naturally centered)
            const viewportCenterX = window.innerWidth / 2;
            const viewportCenterY = window.innerHeight / 2;
            
            // Calculate mouse position relative to viewport center
            const mouseOffsetX = mouseX - viewportCenterX;
            const mouseOffsetY = mouseY - viewportCenterY;
            
            // Calculate zoom ratio (new zoom / old zoom)
            const zoomRatio = zoomValue / previousZoomValue;
            
            // Adjust translate to keep the point under cursor fixed
            // Formula derived: tx_new = (1 - zoomRatio) * mouseOffset + zoomRatio * tx_old
            // This keeps the point under the cursor stationary during zoom
            currentTranslateX = (1 - zoomRatio) * mouseOffsetX + zoomRatio * currentTranslateX;
            currentTranslateY = (1 - zoomRatio) * mouseOffsetY + zoomRatio * currentTranslateY;
        }
    }
    
    // Special handling for the transition from 100% to >100% on images
    // Capture the current displayed size before removing constraints
    if (isImageVisible && previousZoomLevel === 100 && zoomLevel > 100) {
        const rect = lightboxImage.getBoundingClientRect();
        // Store the current displayed dimensions
        lightboxImage.dataset.baseWidth = rect.width.toString();
        lightboxImage.dataset.baseHeight = rect.height.toString();
        console.log('Captured base size at 100%:', rect.width, 'x', rect.height);
    }
    
    // Build transform string
    // Use translate() scale() order so translate happens in screen space
    // CSS applies right-to-left: translate() scale() means scale first, then translate
    let transformString;
    if (zoomLevel <= 100) {
        transformString = `scale(${zoomValue})`;
    } else {
        // Order: translate first (applied last), scale second (applied first)
        // This makes translate happen in screen space (1:1 with mouse)
        transformString = `translate(${currentTranslateX}px, ${currentTranslateY}px) scale(${zoomValue})`;
    }
    
    // Always apply to both - let CSS handle visibility
    lightboxImage.style.transform = transformString;
    lightboxVideo.style.transform = transformString;
    
    if (zoomLevel > 100) {
        lightboxImage.classList.add('zoomed');
        lightboxVideo.classList.add('zoomed');
        
        // For images, set explicit dimensions to prevent size jump when removing constraints
        if (isImageVisible && lightboxImage.dataset.baseWidth) {
            const baseWidth = parseFloat(lightboxImage.dataset.baseWidth);
            const baseHeight = parseFloat(lightboxImage.dataset.baseHeight);
            // Set explicit dimensions to maintain the base size
            lightboxImage.style.width = `${baseWidth}px`;
            lightboxImage.style.height = `${baseHeight}px`;
            lightboxImage.style.maxWidth = 'none';
            lightboxImage.style.maxHeight = 'none';
        } else {
            // For videos or if base size not captured, just remove constraints
            lightboxImage.style.maxWidth = 'none';
            lightboxImage.style.maxHeight = 'none';
            lightboxVideo.style.maxWidth = 'none';
            lightboxVideo.style.maxHeight = 'none';
        }
    } else {
        lightboxImage.classList.remove('zoomed');
        lightboxVideo.classList.remove('zoomed');
        // Restore max constraints when at or below 100%
        lightboxImage.style.maxWidth = '90vw';
        lightboxImage.style.maxHeight = '90vh';
        lightboxImage.style.width = 'auto';
        lightboxImage.style.height = 'auto';
        delete lightboxImage.dataset.baseWidth;
        delete lightboxImage.dataset.baseHeight;
        lightboxVideo.style.maxWidth = '90vw';
        lightboxVideo.style.maxHeight = '90vh';
    }
    
    // Update slider and value display
    const slider = document.getElementById('lightbox-zoom-slider');
    const zoomValueDisplay = document.getElementById('lightbox-zoom-value');
    if (slider) {
        slider.value = zoomLevel;
    }
    if (zoomValueDisplay) {
        zoomValueDisplay.textContent = `${zoomLevel}%`;
    }
}

function applyPan(deltaX, deltaY) {
    if (currentZoomLevel <= 100) return;
    
    currentTranslateX += deltaX;
    currentTranslateY += deltaY;
    
    // Use cached zoom value for performance
    const zoomValue = cachedZoomValue;
    
    // Build transform string once
    const transformString = `translate(${currentTranslateX}px, ${currentTranslateY}px) scale(${zoomValue})`;
    
    // Apply to visible element only
    const imageDisplay = lightboxImage.style.display;
    const videoDisplay = lightboxVideo.style.display;
    const isImageVisible = imageDisplay === 'block' || 
                          (imageDisplay === '' && window.getComputedStyle(lightboxImage).display !== 'none');
    const isVideoVisible = videoDisplay === 'block' || 
                          (videoDisplay === '' && window.getComputedStyle(lightboxVideo).display !== 'none');
    
    if (isImageVisible) {
        lightboxImage.style.transform = transformString;
    }
    
    if (isVideoVisible) {
        lightboxVideo.style.transform = transformString;
    }
}

function resetZoom() {
    currentZoomLevel = 100;
    currentTranslateX = 0;
    currentTranslateY = 0;
    lightboxImage.style.transform = 'scale(1)';
    lightboxVideo.style.transform = 'scale(1)';
    lightboxImage.classList.remove('zoomed');
    lightboxVideo.classList.remove('zoomed');
    // Reset max constraints and explicit dimensions
    lightboxImage.style.maxWidth = '90vw';
    lightboxImage.style.maxHeight = '90vh';
    lightboxImage.style.width = 'auto';
    lightboxImage.style.height = 'auto';
    lightboxVideo.style.maxWidth = '90vw';
    lightboxVideo.style.maxHeight = '90vh';
    // Clear stored base dimensions
    delete lightboxImage.dataset.baseWidth;
    delete lightboxImage.dataset.baseHeight;
    if (lightboxZoomSlider) {
        lightboxZoomSlider.value = 100;
    }
    if (lightboxZoomValue) {
        lightboxZoomValue.textContent = '100%';
    }
}

function closeLightbox() {
    // Clean up video event listeners
    lightboxVideo.removeEventListener('ended', handleVideoRepeat);

    // Clean up video
    lightboxVideo.pause();
    lightboxVideo.src = "";
    lightboxVideo.removeAttribute('src');
    
    // Clean up image
    lightboxImage.src = "";
    lightboxImage.removeAttribute('src');
    
    // Reset zoom
    resetZoom();
    
    // Close file info panel if open
    const fileInfoPanel = document.getElementById('file-info-panel');
    if (fileInfoPanel && !fileInfoPanel.classList.contains('hidden')) {
        fileInfoPanel.classList.add('hidden');
    }
    
    lightbox.classList.add('hidden');

    // Resume thumbnail videos
    resumeThumbnailVideos();

    // Trigger GC after closing lightbox too
    scheduleGC();
}

closeLightboxBtn.addEventListener('click', closeLightbox);

lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) {
        closeLightbox();
    }
});

// Function to attach zoom slider listeners
function attachZoomSliderListeners() {
    const slider = document.getElementById('lightbox-zoom-slider');
    if (slider && !slider.dataset.listenersAttached) {
        console.log('Attaching zoom slider listeners');
        slider.addEventListener('input', (e) => {
            const zoomLevel = parseInt(e.target.value);
            console.log('Slider input:', zoomLevel);
            applyLightboxZoom(zoomLevel);
        });
        slider.addEventListener('change', (e) => {
            const zoomLevel = parseInt(e.target.value);
            console.log('Slider change:', zoomLevel);
            applyLightboxZoom(zoomLevel);
        });
        slider.dataset.listenersAttached = 'true';
    }
}

// Try to attach immediately
if (lightboxZoomSlider) {
    attachZoomSliderListeners();
} else {
    console.warn('lightboxZoomSlider not found at script load time');
}

// Scrollwheel zoom functionality
let zoomTimeout;
function handleLightboxWheel(e) {
    console.log('Wheel event triggered');
    // Only zoom if lightbox is visible and not clicking on controls
    if (lightbox.classList.contains('hidden')) {
        console.log('Lightbox is hidden, ignoring wheel');
        return;
    }
    if (e.target === lightboxZoomSlider || e.target.closest('.lightbox-zoom-controls')) {
        console.log('Wheel on controls, ignoring');
        return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    // Determine zoom direction
    const zoomDelta = e.deltaY > 0 ? -10 : 10;
    const newZoomLevel = Math.max(30, Math.min(500, currentZoomLevel + zoomDelta));
    
    // Get mouse position for zooming at pointer
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    
    console.log('Wheel zoom:', currentZoomLevel, '->', newZoomLevel);
    applyLightboxZoom(newZoomLevel, mouseX, mouseY);
    
    // Clear existing timeout
    clearTimeout(zoomTimeout);
    
    // Show zoom value briefly
    if (lightboxZoomValue) {
        lightboxZoomValue.style.opacity = '1';
        zoomTimeout = setTimeout(() => {
            if (lightboxZoomValue) {
                lightboxZoomValue.style.opacity = '0.7';
            }
        }, 1000);
    }
}

// Attach wheel event to lightbox and media elements
console.log('Attaching wheel listeners');
if (lightbox) {
    lightbox.addEventListener('wheel', handleLightboxWheel, { passive: false });
    console.log('Wheel listener attached to lightbox');
}
if (lightboxImage) {
    lightboxImage.addEventListener('wheel', handleLightboxWheel, { passive: false });
    console.log('Wheel listener attached to lightboxImage');
}
if (lightboxVideo) {
    lightboxVideo.addEventListener('wheel', handleLightboxWheel, { passive: false });
    console.log('Wheel listener attached to lightboxVideo');
}

// Pan/drag functionality when zoomed
// Panning functionality - optimized with requestAnimationFrame
let lastPanX = 0;
let lastPanY = 0;
let initialMouseX = 0;
let initialMouseY = 0;
let initialTranslateX = 0;
let initialTranslateY = 0;
let panRAF = null;
let pendingPanUpdate = false;
let hasDragged = false; // Track if we actually dragged (vs just clicked)

function applyPanTransform() {
    if (!isDragging || currentZoomLevel <= 100) {
        panRAF = null;
        pendingPanUpdate = false;
        return;
    }
    
    // Apply transform with translate first (applied last, so in screen space)
    const zoomValue = cachedZoomValue;
    const transformString = `translate(${currentTranslateX}px, ${currentTranslateY}px) scale(${zoomValue})`;
    
    const imageDisplay = lightboxImage.style.display;
    const videoDisplay = lightboxVideo.style.display;
    const isImageVisible = imageDisplay === 'block' || 
                          (imageDisplay === '' && window.getComputedStyle(lightboxImage).display !== 'none');
    const isVideoVisible = videoDisplay === 'block' || 
                          (videoDisplay === '' && window.getComputedStyle(lightboxVideo).display !== 'none');
    
    if (isImageVisible) {
        lightboxImage.style.transform = transformString;
    }
    
    if (isVideoVisible) {
        lightboxVideo.style.transform = transformString;
    }
    
    panRAF = null;
    pendingPanUpdate = false;
}

lightboxImage.addEventListener('mousedown', (e) => {
    if (currentZoomLevel > 100 && e.button === 0) {
        isDragging = true;
        hasDragged = false; // Reset drag flag
        // Store initial positions
        initialMouseX = e.clientX;
        initialMouseY = e.clientY;
        initialTranslateX = currentTranslateX;
        initialTranslateY = currentTranslateY;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
        e.preventDefault();
        e.stopPropagation();
    }
});

lightboxVideo.addEventListener('mousedown', (e) => {
    if (currentZoomLevel > 100 && e.button === 0) {
        isDragging = true;
        hasDragged = false; // Reset drag flag
        // Store initial positions
        initialMouseX = e.clientX;
        initialMouseY = e.clientY;
        initialTranslateX = currentTranslateX;
        initialTranslateY = currentTranslateY;
        lastPanX = e.clientX;
        lastPanY = e.clientY;
        e.preventDefault();
        e.stopPropagation();
    }
});

document.addEventListener('mousemove', (e) => {
    if (isDragging && currentZoomLevel > 100) {
        // Calculate total mouse movement from initial click
        const totalDeltaX = e.clientX - initialMouseX;
        const totalDeltaY = e.clientY - initialMouseY;
        
        // Check if we've moved enough to consider it a drag (more than 3 pixels)
        const dragDistance = Math.sqrt(totalDeltaX * totalDeltaX + totalDeltaY * totalDeltaY);
        if (dragDistance > 3) {
            hasDragged = true;
        }
        
        // Update translation values immediately
        currentTranslateX = initialTranslateX + totalDeltaX;
        currentTranslateY = initialTranslateY + totalDeltaY;
        
        // Schedule transform update via requestAnimationFrame for smooth rendering
        if (!pendingPanUpdate) {
            pendingPanUpdate = true;
            if (!panRAF) {
                panRAF = requestAnimationFrame(applyPanTransform);
            }
        }
        
        e.preventDefault();
    }
});

document.addEventListener('mouseup', (e) => {
    if (isDragging) {
        isDragging = false;
        // Ensure final position is applied
        if (panRAF) {
            cancelAnimationFrame(panRAF);
            panRAF = null;
        }
        applyPanTransform();
        
        // If we dragged (not just clicked), prevent video play/pause
        if (hasDragged && currentZoomLevel > 100) {
            e.preventDefault();
            e.stopPropagation();
            // Also prevent the click event that might fire after mouseup
            setTimeout(() => {
                if (lightboxVideo && !lightboxVideo.paused) {
                    // Video was playing, keep it playing
                } else if (lightboxVideo && lightboxVideo.paused) {
                    // Video was paused, keep it paused
                }
            }, 0);
        }
    }
});

// Prevent click events on video when we've just finished dragging
lightboxVideo.addEventListener('click', (e) => {
    if (hasDragged && currentZoomLevel > 100) {
        e.preventDefault();
        e.stopPropagation();
        hasDragged = false; // Reset after handling
    }
}, true); // Use capture phase to catch it early

// Copy button functionality
const copyPathBtn = document.getElementById('copy-path-btn');
const copyNameBtn = document.getElementById('copy-name-btn');

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        // Visual feedback - could add a toast notification here if desired
        return true;
    } catch (error) {
        console.error('Failed to copy to clipboard:', error);
        // Fallback for older browsers
        try {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            return true;
        } catch (fallbackError) {
            console.error('Fallback copy failed:', fallbackError);
            return false;
        }
    }
}

if (copyPathBtn) {
    copyPathBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); // Prevent closing lightbox
        const filePath = copyPathBtn.dataset.filePath;
        if (filePath) {
            const success = await copyToClipboard(filePath);
            if (success) {
                // Visual feedback
                const originalText = copyPathBtn.textContent;
                copyPathBtn.textContent = 'Copied!';
                setTimeout(() => {
                    copyPathBtn.textContent = originalText;
                }, 1000);
            }
        }
    });
}

if (copyNameBtn) {
    copyNameBtn.addEventListener('click', async (e) => {
        e.stopPropagation(); // Prevent closing lightbox
        const fileName = copyNameBtn.dataset.fileName;
        if (fileName) {
            const success = await copyToClipboard(fileName);
            if (success) {
                // Visual feedback
                const originalText = copyNameBtn.textContent;
                copyNameBtn.textContent = 'Copied!';
                setTimeout(() => {
                    copyNameBtn.textContent = originalText;
                }, 1000);
            }
        }
    });
}

// --- Context Menu Functionality ---
function showContextMenu(event, card) {
    event.preventDefault();
    event.stopPropagation();
    
    // Only show context menu for media cards (not folders)
    if (card.classList.contains('folder-card')) {
        return;
    }
    
    contextMenuTargetCard = card;
    
    // Position the context menu at the cursor position
    const x = event.clientX;
    const y = event.clientY;
    
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.remove('hidden');
    
    // Adjust position if menu goes off screen
    requestAnimationFrame(() => {
        const rect = contextMenu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            contextMenu.style.left = `${window.innerWidth - rect.width - 10}px`;
        }
        if (rect.bottom > window.innerHeight) {
            contextMenu.style.top = `${window.innerHeight - rect.height - 10}px`;
        }
    });
}

function hideContextMenu() {
    contextMenu.classList.add('hidden');
    contextMenuTargetCard = null;
}

// Hide context menu when clicking elsewhere
document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) {
        hideContextMenu();
    }
});

// Handle context menu item clicks
contextMenu.addEventListener('click', async (e) => {
    const action = e.target.dataset.action;
    if (!action || !contextMenuTargetCard) return;
    
    const filePath = contextMenuTargetCard.dataset.filePath;
    if (!filePath) return;
    
    // Store the file name before hiding the menu (since we clear contextMenuTargetCard)
    const fileNameElement = contextMenuTargetCard.querySelector('.video-info');
    const fileName = fileNameElement ? fileNameElement.textContent : '';
    
    hideContextMenu();
    
    switch (action) {
        case 'reveal':
            try {
                await window.electronAPI.revealInExplorer(filePath);
            } catch (error) {
                alert(`Error: ${error.message}`);
            }
            break;
            
        case 'rename':
            // Show rename dialog
            renamePendingFile = { filePath, fileName };
            renameInput.value = fileName;
            renameDialog.classList.remove('hidden');
            renameInput.focus();
            renameInput.select();
            break;
            
        case 'delete':
            try {
                isNativeDialogOpen = true;
                const confirmed = confirm(`Are you sure you want to delete "${fileName}"?`);
                restorePlaybackAfterDialog();
                if (confirmed) {
                    setStatusActivity(`Deleting ${fileName}...`);
                    const result = await window.electronAPI.deleteFile(filePath);
                    setStatusActivity('');
                    if (result.success) {
                        // Invalidate cache and reload the current folder to reflect the change
                        if (currentFolderPath) {
                            invalidateFolderCache(currentFolderPath);
                            await loadVideos(currentFolderPath, false); // Force reload, don't use cache
                        }
                    } else {
                        alert(`Error deleting file: ${result.error}`);
                        restorePlaybackAfterDialog();
                    }
                }
            } catch (error) {
                alert(`Error: ${error.message}`);
                restorePlaybackAfterDialog();
            }
            break;
            
        case 'open':
            try {
                await window.electronAPI.openWithDefault(filePath);
            } catch (error) {
                alert(`Error: ${error.message}`);
            }
            break;
            
        case 'open-with':
            try {
                await window.electronAPI.openWith(filePath);
            } catch (error) {
                alert(`Error: ${error.message}`);
            }
            break;
    }
});

// Prevent default context menu on cards and show custom menu
document.addEventListener('contextmenu', (e) => {
    const card = e.target.closest('.video-card');
    if (card) {
        showContextMenu(e, card);
    }
});

// Rename Dialog Handlers
async function handleRenameConfirm() {
    if (!renamePendingFile) return;
    
    const newName = renameInput.value.trim();
    if (!newName || newName === renamePendingFile.fileName) {
        renameDialog.classList.add('hidden');
        renamePendingFile = null;
        return;
    }
    
    try {
        setStatusActivity(`Renaming to ${newName}...`);
        const result = await window.electronAPI.renameFile(renamePendingFile.filePath, newName);
        setStatusActivity('');
        if (result.success) {
            renameDialog.classList.add('hidden');
            renamePendingFile = null;
            // Invalidate cache and reload the current folder to reflect the change
            if (currentFolderPath) {
                invalidateFolderCache(currentFolderPath);
                await loadVideos(currentFolderPath, false); // Force reload, don't use cache
            }
        } else {
            alert(`Error renaming file: ${result.error}`);
        }
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
}

function handleRenameCancel() {
    renameDialog.classList.add('hidden');
    renamePendingFile = null;
}

renameConfirmBtn.addEventListener('click', handleRenameConfirm);
renameCancelBtn.addEventListener('click', handleRenameCancel);

// Handle Enter key in rename input
renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        handleRenameConfirm();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        handleRenameCancel();
    }
});

// Close rename dialog when clicking outside
renameDialog.addEventListener('click', (e) => {
    if (e.target === renameDialog) {
        handleRenameCancel();
    }
});

async function loadVideos(folderPath, useCache = true) {
    // Stop periodic cleanup during folder switch
    stopPeriodicCleanup();
    
    // Show loading indicator if we need to scan
    let needsScan = false;
    if (useCache) {
        const normalizedPath = normalizePath(folderPath);
        const now = Date.now();
        
        // Quick check if we have cached data
        let hasCache = false;
        if (activeTabId) {
            const tabCache = tabContentCache.get(activeTabId);
            if (tabCache) {
                const cachePathNormalized = normalizePath(tabCache.path);
                if ((cachePathNormalized === normalizedPath || tabCache.path === folderPath) && 
                    (now - tabCache.timestamp) < FOLDER_CACHE_TTL) {
                    hasCache = true;
                }
            }
        }
        if (!hasCache) {
            const globalCache = folderCache.get(normalizedPath) || folderCache.get(folderPath);
            if (globalCache && (now - globalCache.timestamp) < GLOBAL_CACHE_TTL) {
                hasCache = true;
            }
        }
        needsScan = !hasCache;
    } else {
        needsScan = true;
    }
    
    if (needsScan) {
        showLoadingIndicator();
        setStatusActivity('Scanning folder...');
    }

    try {
        // Yield control to allow UI to update and show loading indicator
        await yieldToEventLoop();
        
        window.electronAPI.triggerGC(); // GC before loading new folder

        // Check cache first
        let items = null;
        const now = Date.now();
        
        if (useCache) {
            const normalizedPath = normalizePath(folderPath);

            // In masonry mode, we need items with dimensions. If cached items
            // lack dimensions (from a previous non-masonry scan), skip the cache
            // so a fresh scan with dimension scanning is performed.
            const needsDimensions = layoutMode === 'masonry';
            const cacheHasDimensions = (cachedItems) => {
                if (!needsDimensions || !cachedItems || cachedItems.length === 0) return true;
                // Check both an image and a video sample — both must have dimensions
                const imageSample = cachedItems.find(item => item.type === 'image');
                const videoSample = cachedItems.find(item => item.type === 'video');
                if (imageSample && (imageSample.width === undefined || imageSample.height === undefined)) return false;
                if (videoSample && (videoSample.width === undefined || videoSample.height === undefined)) return false;
                return true;
            };

            // Check tab cache first (fastest)
            if (activeTabId) {
                const tabCache = tabContentCache.get(activeTabId);
                if (tabCache) {
                    const cachePathNormalized = normalizePath(tabCache.path);
                    if ((cachePathNormalized === normalizedPath || tabCache.path === folderPath) &&
                        (now - tabCache.timestamp) < FOLDER_CACHE_TTL &&
                        cacheHasDimensions(tabCache.items)) {
                        items = tabCache.items;
                    }
                }
            }

            // Check global folder cache (try both normalized and original path)
            if (!items) {
                const globalCache = folderCache.get(normalizedPath) || folderCache.get(folderPath);
                if (globalCache && (now - globalCache.timestamp) < GLOBAL_CACHE_TTL &&
                    cacheHasDimensions(globalCache.items)) {
                    items = globalCache.items;
                }
            }

            // Check IndexedDB persistent cache (slower but persistent)
            if (!items) {
                // Yield control periodically during IndexedDB lookup
                await yieldToEventLoop();
                const dbItems = await getFolderFromIndexedDB(folderPath);
                if (dbItems && cacheHasDimensions(dbItems)) {
                    items = dbItems;
                }
            }
        }
        
        // If not cached, scan folder
        if (!items) {
            // Yield control before starting scan to keep UI responsive
            await yieldToEventLoop();
            
            // Skip stats if sorting by name (faster loading)
            const skipStats = sortType === 'name';
            // Scan media dimensions when in masonry mode to build layout upfront
            const scanImageDimensions = layoutMode === 'masonry';
            const scanVideoDimensions = layoutMode === 'masonry';
            const scanPerfStart = perfTest.start();
            items = await window.electronAPI.scanFolder(folderPath, { skipStats, scanImageDimensions, scanVideoDimensions });
            perfTest.end('scanFolder (IPC)', scanPerfStart, { itemCount: items ? items.length : 0 });

            // Yield control after scan completes
            await yieldToEventLoop();
            
            // Cache the results (use normalized path for consistency)
            const normalizedPath = normalizePath(folderPath);
            if (activeTabId) {
                tabContentCache.set(activeTabId, {
                    items: items,
                    path: normalizedPath, // Store normalized path
                    timestamp: now
                });
            }
            folderCache.set(normalizedPath, {
                items: items,
                timestamp: now
            });
            
            // Store in IndexedDB for persistence (async, don't wait)
            storeFolderInIndexedDB(folderPath, items).catch(() => {
                // Ignore errors, IndexedDB is optional
            });

            // Cache any newly scanned dimensions for future visits
            const dimensionEntries = items.filter(
                item => item.type !== 'folder' && item.width && item.height
            ).map(item => ({
                path: item.path,
                mtime: item.mtime || 0,
                width: item.width,
                height: item.height
            }));
            cacheDimensions(dimensionEntries).catch(() => {});
            
            // Clean up old cache entries (keep cache size reasonable)
            if (folderCache.size > 50) {
                const entries = Array.from(folderCache.entries());
                entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
                folderCache.clear();
                entries.slice(0, 25).forEach(([path, data]) => folderCache.set(path, data));
            }
            
            // Periodically clean up IndexedDB cache (every 10 folder loads)
            if (Math.random() < 0.1) {
                cleanupIndexedDBCache().catch(() => {
                    // Ignore cleanup errors
                });
            }
        }
        
        // Apply cached dimensions to items that lack them
        const itemsNeedingDimensions = items.filter(
            item => item.type !== 'folder' && (!item.width || !item.height)
        );
        if (itemsNeedingDimensions.length > 0) {
            const cached = await getCachedDimensions(
                itemsNeedingDimensions.map(i => ({ path: i.path, mtime: i.mtime || 0 }))
            );
            if (cached.size > 0) {
                for (const item of itemsNeedingDimensions) {
                    const dims = cached.get(item.path);
                    if (dims) {
                        item.width = dims.width;
                        item.height = dims.height;
                    }
                }
            }
        }

        // Yield control before sorting/rendering
        await yieldToEventLoop();

        // Store items for re-sorting without re-fetching
        currentItems = items;

        // Filter items based on current filter, then sort
        const filteredItems = filterItems(items);
        const sortedItems = sortItems(filteredItems);
        
        // Yield control before rendering
        await yieldToEventLoop();
        
        // Render the filtered and sorted items
        renderItems(sortedItems);

        // Show "Loading media..." while IntersectionObserver lazy-loads images/videos into cards
        const mediaItemCount = sortedItems.filter(i => i.type !== 'folder').length;
        if (mediaItemCount > 0) {
            setStatusActivity('Loading media...');
            scheduleMediaLoadSettle();
        } else {
            setStatusActivity('');
        }

        // Start watching folder for changes
        await startWatchingFolder(folderPath);
    } finally {
        // Hide loading indicator
        hideLoadingIndicator();
        // Clear any stuck non-self-settling activity messages
        const act = statusActivity ? statusActivity.textContent : '';
        if (act === 'Scanning folder...' || act.startsWith('Navigating to')) {
            setStatusActivity('');
        }
    }
}

// ==================== KEYBOARD SHORTCUTS ====================
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Don't trigger shortcuts when typing in inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
            // Allow Escape to close dialogs even when in inputs
            if (e.key === 'Escape') {
                if (!renameDialog.classList.contains('hidden')) {
                    handleRenameCancel();
                } else if (!lightbox.classList.contains('hidden')) {
                    closeLightbox();
                } else if (!settingsDropdown.classList.contains('hidden')) {
                    closeSettingsDropdown();
                } else if (!favoritesDropdown.classList.contains('hidden')) {
                    favoritesDropdown.classList.add('hidden');
                } else if (!recentFilesDropdown.classList.contains('hidden')) {
                    recentFilesDropdown.classList.add('hidden');
                }
            }
            return;
        }

        // Ctrl/Cmd + F: Focus search
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            searchBox.focus();
            searchBox.select();
            return;
        }

        // Ctrl/Cmd + O: Open folder
        if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
            e.preventDefault();
            selectFolderBtn.click();
            return;
        }

        // Escape: Close dialogs/lightbox/shortcuts
        if (e.key === 'Escape') {
            if (!shortcutsOverlay.classList.contains('hidden')) {
                shortcutsOverlay.classList.add('hidden');
            } else if (!lightbox.classList.contains('hidden')) {
                closeLightbox();
            } else if (!renameDialog.classList.contains('hidden')) {
                handleRenameCancel();
            } else if (!settingsDropdown.classList.contains('hidden')) {
                closeSettingsDropdown();
            } else if (!favoritesDropdown.classList.contains('hidden')) {
                favoritesDropdown.classList.add('hidden');
            } else if (!recentFilesDropdown.classList.contains('hidden')) {
                recentFilesDropdown.classList.add('hidden');
            }
            return;
        }

        // Arrow keys: Navigate thumbnails
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            navigateCards(e.key);
            return;
        }

        // Enter: Open focused card
        if (e.key === 'Enter' && focusedCardIndex >= 0) {
            e.preventDefault();
            const card = visibleCards[focusedCardIndex];
            if (card) {
                if (card.classList.contains('folder-card')) {
                    const path = card.dataset.folderPath;
                    if (path) {
                        // Use setTimeout to yield control back to event loop, making button responsive
                        setTimeout(() => {
                            navigateToFolder(path).catch(err => {
                                console.error('Error navigating to folder:', err);
                                hideLoadingIndicator();
                            });
                        }, 0);
                    }
                } else {
                    const url = card.dataset.src;
                    const path = card.dataset.filePath;
                    const name = card.querySelector('.video-info')?.textContent || '';
                    if (url) openLightbox(url, path, name);
                }
            }
            return;
        }

        // Delete: Delete focused file
        if (e.key === 'Delete' && focusedCardIndex >= 0) {
            e.preventDefault();
            const card = visibleCards[focusedCardIndex];
            if (card && !card.classList.contains('folder-card')) {
                const path = card.dataset.filePath;
                const name = card.querySelector('.video-info')?.textContent || '';
                isNativeDialogOpen = true;
                const confirmed = path && confirm(`Are you sure you want to delete "${name}"?`);
                restorePlaybackAfterDialog();
                if (confirmed) {
                    setStatusActivity(`Deleting ${name}...`);
                    window.electronAPI.deleteFile(path).then(result => {
                        setStatusActivity('');
                        if (result.success && currentFolderPath) {
                            invalidateFolderCache(currentFolderPath);
                            loadVideos(currentFolderPath, false);
                        }
                    }).catch(err => {
                        setStatusActivity('');
                        console.error('Error deleting file:', err);
                    });
                }
            }
            return;
        }

        // F2: Rename focused file
        if (e.key === 'F2' && focusedCardIndex >= 0) {
            e.preventDefault();
            const card = visibleCards[focusedCardIndex];
            if (card && !card.classList.contains('folder-card')) {
                const path = card.dataset.filePath;
                const name = card.querySelector('.video-info')?.textContent || '';
                if (path) {
                    renamePendingFile = { filePath: path, fileName: name };
                    renameInput.value = name;
                    renameDialog.classList.remove('hidden');
                    renameInput.focus();
                    renameInput.select();
                }
            }
            return;
        }

        // Backspace: Go back (when not in input)
        if (e.key === 'Backspace' && !e.target.tagName === 'INPUT') {
            if (navigationHistory.canGoBack()) {
                e.preventDefault();
                goBack();
            }
            return;
        }

        // Ctrl/Cmd + B: Go back
        if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
            e.preventDefault();
            if (navigationHistory.canGoBack()) {
                goBack();
            }
            return;
        }

        // Ctrl/Cmd + Shift + B: Go forward
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'B') {
            e.preventDefault();
            if (navigationHistory.canGoForward()) {
                goForward();
            }
            return;
        }

        // Number keys: Switch filters
        if (e.key >= '1' && e.key <= '4') {
            const filterMap = { '1': 'all', '2': 'video', '3': 'image', '4': 'audio' };
            const filter = filterMap[e.key];
            if (filter) {
                e.preventDefault();
                switchFilter(filter);
            }
            return;
        }

        // ?: Toggle keyboard shortcuts cheat sheet
        if (e.key === '?' || (e.shiftKey && e.key === '/')) {
            e.preventDefault();
            toggleShortcutsOverlay();
            return;
        }

        // G: Toggle grid/masonry layout
        if (e.key === 'g' || e.key === 'G') {
            e.preventDefault();
            layoutModeToggle.checked = !layoutModeToggle.checked;
            switchLayoutMode();
            return;
        }

        // S: Toggle sidebar
        if (e.key === 's' || e.key === 'S') {
            e.preventDefault();
            setSidebarCollapsed(!sidebarCollapsed);
            return;
        }

        // Space: Open lightbox for focused card
        if (e.key === ' ' && focusedCardIndex >= 0) {
            e.preventDefault();
            const card = visibleCards[focusedCardIndex];
            if (card && !card.classList.contains('folder-card')) {
                const url = card.dataset.src;
                const filePath = card.dataset.filePath;
                const name = card.querySelector('.video-info')?.textContent || '';
                if (url) openLightbox(url, filePath, name);
            }
            return;
        }

        // + / =: Zoom in
        if (e.key === '+' || e.key === '=') {
            e.preventDefault();
            const newZoom = Math.min(200, zoomLevel + 10);
            zoomSlider.value = newZoom;
            zoomLevel = newZoom;
            applyZoom();
            deferLocalStorageWrite('zoomLevel', zoomLevel.toString());
            updateStatusBar();
            return;
        }

        // -: Zoom out
        if (e.key === '-') {
            e.preventDefault();
            const newZoom = Math.max(50, zoomLevel - 10);
            zoomSlider.value = newZoom;
            zoomLevel = newZoom;
            applyZoom();
            deferLocalStorageWrite('zoomLevel', zoomLevel.toString());
            updateStatusBar();
            return;
        }

        // 0: Reset zoom
        if (e.key === '0' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            zoomSlider.value = 100;
            zoomLevel = 100;
            applyZoom();
            deferLocalStorageWrite('zoomLevel', '100');
            updateStatusBar();
            return;
        }
    });
}

function navigateCards(direction) {
    const cards = Array.from(gridContainer.querySelectorAll('.video-card, .folder-card'))
        .filter(card => card.style.display !== 'none');
    
    if (cards.length === 0) return;

    visibleCards = cards;

    if (focusedCardIndex < 0) {
        // Find first visible card
        const firstVisible = cards.find(card => {
            const rect = card.getBoundingClientRect();
            return rect.top >= 0 && rect.top < window.innerHeight;
        });
        focusedCardIndex = firstVisible ? cards.indexOf(firstVisible) : 0;
    } else {
        // Navigate based on direction
        const currentCard = cards[focusedCardIndex];
        if (!currentCard) {
            focusedCardIndex = 0;
        } else {
            const rect = currentCard.getBoundingClientRect();
            const cardCenterX = rect.left + rect.width / 2;
            const cardCenterY = rect.top + rect.height / 2;

            let nextIndex = focusedCardIndex;
            if (direction === 'ArrowRight' || direction === 'ArrowDown') {
                // Find next visible card
                for (let i = focusedCardIndex + 1; i < cards.length; i++) {
                    if (cards[i].style.display !== 'none') {
                        nextIndex = i;
                        break;
                    }
                }
            } else if (direction === 'ArrowLeft' || direction === 'ArrowUp') {
                // Find previous visible card
                for (let i = focusedCardIndex - 1; i >= 0; i--) {
                    if (cards[i].style.display !== 'none') {
                        nextIndex = i;
                        break;
                    }
                }
            }

            focusedCardIndex = Math.max(0, Math.min(cards.length - 1, nextIndex));
        }
    }

    // Update focus visual
    cards.forEach((card, index) => {
        if (index === focusedCardIndex) {
            card.style.outline = '2px solid var(--accent-color)';
            card.style.outlineOffset = '2px';
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            card.style.outline = '';
            card.style.outlineOffset = '';
        }
    });

    // Update status bar with focused card info
    updateStatusBarSelection(cards[focusedCardIndex] || null);
}

function switchFilter(filter) {
    currentFilter = filter;
    filterAllBtn.classList.remove('active');
    filterVideosBtn.classList.remove('active');
    filterImagesBtn.classList.remove('active');
    filterAudioBtn.classList.remove('active');
    
    if (filter === 'all') filterAllBtn.classList.add('active');
    else if (filter === 'video') filterVideosBtn.classList.add('active');
    else if (filter === 'image') filterImagesBtn.classList.add('active');
    else if (filter === 'audio') filterAudioBtn.classList.add('active');
    
    applyFilters();
    focusedCardIndex = -1; // Reset focus
}

// ==================== FAVORITES ====================
function loadFavorites() {
    const saved = localStorage.getItem('favorites');
    if (saved) {
        try {
            favorites = JSON.parse(saved);
        } catch (e) {
            favorites = [];
        }
    }
    renderFavorites();
}

function saveFavorites() {
    deferLocalStorageWrite('favorites', JSON.stringify(favorites));
}

function renderFavorites() {
    favoritesList.innerHTML = '';
    if (favorites.length === 0) {
        favoritesList.innerHTML = '<div style="padding: 16px; text-align: center; color: rgba(224, 224, 224, 0.5); font-size: 12px;">No favorites yet</div>';
        return;
    }
    favorites.forEach((fav, index) => {
        const item = document.createElement('div');
        item.className = 'quick-access-item';
        item.innerHTML = `
            <span class="quick-access-item-name" title="${fav.path}">${fav.name}</span>
            <span class="quick-access-item-remove" data-index="${index}">${icon('x', 14)}</span>
        `;
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('quick-access-item-remove')) {
                e.stopPropagation();
                removeFavorite(index);
            } else {
                favoritesDropdown.classList.add('hidden');
                // Use setTimeout to yield control back to event loop, making button responsive
                setTimeout(() => {
                    navigateToFolder(fav.path).catch(err => {
                        console.error('Error navigating to favorite:', err);
                        hideLoadingIndicator();
                    });
                }, 0);
            }
        });
        favoritesList.appendChild(item);
    });
}

function addFavorite(path, name) {
    if (!path || favorites.some(f => f.path === path)) return;
    favorites.push({ path, name: name || path.split(/[/\\]/).pop() });
    saveFavorites();
    renderFavorites();
}

function removeFavorite(index) {
    favorites.splice(index, 1);
    saveFavorites();
    renderFavorites();
}

// ==================== RECENT FILES ====================
function loadRecentFiles() {
    const saved = localStorage.getItem('recentFiles');
    if (saved) {
        try {
            recentFiles = JSON.parse(saved);
            // Keep only last 50
            recentFiles = recentFiles.slice(0, 50);
        } catch (e) {
            recentFiles = [];
        }
    }
    renderRecentFiles();
}

function saveRecentFiles() {
    deferLocalStorageWrite('recentFiles', JSON.stringify(recentFiles));
}

function addRecentFile(path, name, url, type) {
    // Remove if already exists
    recentFiles = recentFiles.filter(f => f.path !== path);
    // Add to beginning
    recentFiles.unshift({
        path,
        name: name || path.split(/[/\\]/).pop(),
        url,
        type,
        timestamp: Date.now()
    });
    // Keep only last 50
    recentFiles = recentFiles.slice(0, 50);
    saveRecentFiles();
    renderRecentFiles();
}

function renderRecentFiles() {
    recentFilesList.innerHTML = '';
    if (recentFiles.length === 0) {
        recentFilesList.innerHTML = '<div style="padding: 16px; text-align: center; color: rgba(224, 224, 224, 0.5); font-size: 12px;">No recent files</div>';
        return;
    }
    recentFiles.forEach((file) => {
        const item = document.createElement('div');
        item.className = 'recent-file-item quick-access-item';
        const timeAgo = getTimeAgo(file.timestamp);
        item.innerHTML = `
            <span class="quick-access-item-name" title="${file.path}">${file.name}</span>
            <span style="font-size: 11px; opacity: 0.6;">${timeAgo}</span>
        `;
        
        // Add preview on hover
        if (file.type === 'image' || file.type === 'video') {
            item.addEventListener('mouseenter', (e) => {
                const preview = document.createElement('div');
                preview.className = 'recent-file-preview';
                
                if (file.type === 'image') {
                    const img = document.createElement('img');
                    img.src = file.url;
                    preview.appendChild(img);
                } else if (file.type === 'video') {
                    const video = document.createElement('video');
                    video.src = file.url;
                    video.muted = true;
                    video.loop = true;
                    video.play().catch(() => {});
                    preview.appendChild(video);
                }
                
                document.body.appendChild(preview);
                
                // Position preview
                const itemRect = item.getBoundingClientRect();
                let left = itemRect.right + 10;
                let top = itemRect.top;
                
                preview.style.top = `${top}px`;
                preview.style.left = `${left}px`;
                preview.style.display = 'block';
                
                // Adjust if preview goes off screen (after it renders)
                setTimeout(() => {
                    const previewRect = preview.getBoundingClientRect();
                    if (left + previewRect.width > window.innerWidth) {
                        left = itemRect.left - previewRect.width - 10;
                        preview.style.left = `${left}px`;
                    }
                    if (top + previewRect.height > window.innerHeight) {
                        top = window.innerHeight - previewRect.height - 10;
                        preview.style.top = `${top}px`;
                    }
                }, 10);
                
                item.dataset.previewId = 'preview-' + Date.now();
                preview.id = item.dataset.previewId;
            });
            
            item.addEventListener('mouseleave', () => {
                const previewId = item.dataset.previewId;
                if (previewId) {
                    const preview = document.getElementById(previewId);
                    if (preview) {
                        preview.remove();
                        delete item.dataset.previewId;
                    }
                }
            });
        }
        
        item.addEventListener('click', () => {
            // Remove hover preview before opening lightbox
            const previewId = item.dataset.previewId;
            if (previewId) {
                const preview = document.getElementById(previewId);
                if (preview) preview.remove();
                delete item.dataset.previewId;
            }
            openLightbox(file.url, file.path, file.name);
            recentFilesDropdown.classList.add('hidden');
        });
        recentFilesList.appendChild(item);
    });
}

function getTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function clearRecentFiles() {
    recentFiles = [];
    saveRecentFiles();
    renderRecentFiles();
}

// ==================== TABS ====================
function loadTabs() {
    const saved = localStorage.getItem('tabs');
    if (saved) {
        try {
            tabs = JSON.parse(saved);
            tabIdCounter = Math.max(...tabs.map(t => t.id), 0) + 1;
            // Initialize per-tab history fields for tabs saved before this feature
            for (const tab of tabs) {
                if (!tab.historyPaths) {
                    tab.historyPaths = tab.path ? [tab.path] : [];
                    tab.historyIndex = tab.historyPaths.length - 1;
                }
            }
        } catch (e) {
            tabs = [];
        }
    }
    if (tabs.length === 0) {
        // Create initial tab if none exist
        createTab(null, 'Home');
    }
    renderTabs();
    if (activeTabId && tabs.find(t => t.id === activeTabId)) {
        switchToTab(activeTabId);
    } else if (tabs.length > 0) {
        switchToTab(tabs[0].id);
    }
}

function saveTabs() {
    deferLocalStorageWrite('tabs', JSON.stringify(tabs));
    deferLocalStorageWrite('activeTabId', activeTabId);
}

// Snapshot the current tab's DOM into a DocumentFragment for instant restore
function snapshotCurrentTabDom() {
    if (!activeTabId || gridContainer.children.length === 0) return;
    const fragment = document.createDocumentFragment();
    // Move children to fragment (detaches from DOM without destroying)
    while (gridContainer.firstChild) {
        fragment.appendChild(gridContainer.firstChild);
    }
    tabDomCache.set(activeTabId, {
        fragment,
        scrollTop: gridContainer.scrollTop || window.scrollY || 0,
        layoutMode: layoutMode,
        timestamp: Date.now()
    });
}

// Restore a tab's DOM snapshot if available. Returns true if restored.
function restoreTabDomSnapshot(tabId) {
    const snapshot = tabDomCache.get(tabId);
    if (!snapshot) return false;
    // Check if snapshot is still fresh (use same TTL as tab content cache)
    if ((Date.now() - snapshot.timestamp) > FOLDER_CACHE_TTL) {
        tabDomCache.delete(tabId);
        return false;
    }
    // Clear current grid without destroying media (it belongs to old tab snapshot)
    while (gridContainer.firstChild) {
        gridContainer.removeChild(gridContainer.firstChild);
    }
    // Re-attach the cached fragment
    gridContainer.appendChild(snapshot.fragment);
    // Restore layout mode
    if (snapshot.layoutMode === 'masonry') {
        gridContainer.classList.add('masonry');
        gridContainer.classList.remove('grid');
    } else {
        gridContainer.classList.add('grid');
        gridContainer.classList.remove('masonry');
    }
    // Restore scroll position after DOM is attached
    requestAnimationFrame(() => {
        gridContainer.scrollTop = snapshot.scrollTop;
        window.scrollTo(0, snapshot.scrollTop);
        // Re-run cleanup cycle to manage media visibility
        scheduleCleanupCycle();
    });
    tabDomCache.delete(tabId); // Consumed
    return true;
}

function createTab(path, name) {
    const tab = {
        id: tabIdCounter++,
        path: path || null,
        name: name || (path ? path.split(/[/\\]/).pop() : 'Home'),
        sortType: sortType || 'name', // Use current sorting or default
        sortOrder: sortOrder || 'ascending', // Use current order or default
        historyPaths: [],
        historyIndex: -1
    };
    tabs.push(tab);
    saveTabs();
    renderTabs();
    switchToTab(tab.id);
    if (path) {
        // Use setTimeout to yield control back to event loop, making button responsive
        setTimeout(() => {
            navigateToFolder(path).catch(err => {
                console.error('Error navigating to tab folder:', err);
                hideLoadingIndicator();
            });
        }, 0);
    }
    return tab.id;
}

function closeTab(tabId) {
    if (tabs.length <= 1) return; // Don't close last tab
    // Clean up DOM cache for the closed tab
    tabDomCache.delete(tabId);
    tabContentCache.delete(tabId);
    tabs = tabs.filter(t => t.id !== tabId);
    if (activeTabId === tabId) {
        activeTabId = tabs[0]?.id || null;
    }
    // switchToTab already calls saveTabs() + renderTabs(), so skip them here
    if (activeTabId) {
        switchToTab(activeTabId);
    } else {
        saveTabs();
        renderTabs();
    }
}

function switchToTab(tabId) {
    const previousTabId = activeTabId;

    // Snapshot current tab's DOM before switching away (for instant restore later)
    if (previousTabId && previousTabId !== tabId) {
        snapshotCurrentTabDom();
    }

    activeTabId = tabId;
    // Update back/forward buttons for this tab's history
    navigationHistory.updateButtons();
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
        // Restore tab's sorting preferences
        sortType = tab.sortType || 'name';
        sortOrder = tab.sortOrder || 'ascending';

        // Update UI to reflect tab's sorting preferences
        if (sortTypeSelect) sortTypeSelect.value = sortType;
        if (sortOrderSelect) sortOrderSelect.value = sortOrder;

        if (tab.path) {
            // Try to restore DOM snapshot first (near-instant tab switch)
            if (restoreTabDomSnapshot(tabId)) {
                currentFolderPath = tab.path;
                const tabCache = tabContentCache.get(tabId);
                if (tabCache) currentItems = tabCache.items;
                updateBreadcrumb(tab.path);
                searchBox.value = '';
                currentFilter = 'all';
                filterAllBtn.classList.add('active');
                filterVideosBtn.classList.remove('active');
                filterImagesBtn.classList.remove('active');
                filterAudioBtn.classList.remove('active');
                sidebarExpandToPath(tab.path);
            } else {
                // No DOM snapshot - fall back to content cache or full navigation
                const tabCache = tabContentCache.get(tabId);
                const now = Date.now();
                const normalizedTabPath = normalizePath(tab.path);

                if (tabCache) {
                    const cachePathNormalized = normalizePath(tabCache.path);
                    if ((cachePathNormalized === normalizedTabPath || tabCache.path === tab.path) &&
                        (now - tabCache.timestamp) < FOLDER_CACHE_TTL) {
                        // Use cached content
                        currentFolderPath = tab.path;
                        currentItems = tabCache.items;
                        updateBreadcrumb(tab.path);
                        searchBox.value = '';
                        currentFilter = 'all';
                        filterAllBtn.classList.add('active');
                        filterVideosBtn.classList.remove('active');
                        filterImagesBtn.classList.remove('active');
                        filterAudioBtn.classList.remove('active');

                        const filteredItems = filterItems(tabCache.items);
                        const sortedItems = sortItems(filteredItems);
                        renderItems(sortedItems);
                        sidebarExpandToPath(tab.path);
                    } else {
                        setTimeout(() => {
                            navigateToFolder(tab.path, false).catch(err => {
                                console.error('Error navigating to tab folder:', err);
                                hideLoadingIndicator();
                            });
                        }, 0);
                    }
                } else {
                    setTimeout(() => {
                        navigateToFolder(tab.path, false).catch(err => {
                            console.error('Error navigating to tab folder:', err);
                            hideLoadingIndicator();
                        });
                    }, 0);
                }
            }
        } else {
            // If tab has no path, clear the grid
            gridContainer.innerHTML = '';
            currentHoveredCard = null;
            currentFolderPath = null;
            currentItems = [];
            updateBreadcrumb(null);
        }
    }
    saveTabs();
    renderTabs();
}

function updateCurrentTab(path, name) {
    if (!activeTabId) return;
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) {
        tab.path = path;
        tab.name = name || (path ? path.split(/[/\\]/).pop() : 'Home');
        // Preserve sorting preferences when updating tab
        tab.sortType = tab.sortType || sortType;
        tab.sortOrder = tab.sortOrder || sortOrder;
        saveTabs();
        renderTabs();
    }
}

function renderTabs() {
    tabsContainer.innerHTML = '';
    tabs.forEach(tab => {
        const tabEl = document.createElement('div');
        tabEl.className = `tab ${tab.id === activeTabId ? 'active' : ''}`;
        tabEl.innerHTML = `
            <span class="tab-name" title="${tab.path || 'Home'}">${tab.name}</span>
            <span class="tab-close" data-tab-id="${tab.id}">${icon('x', 14)}</span>
        `;
        tabEl.addEventListener('click', (e) => {
            if (e.target.closest('.tab-close')) {
                e.stopPropagation();
                closeTab(tab.id);
            } else {
                switchToTab(tab.id);
            }
        });
        tabsContainer.appendChild(tabEl);
    });
    
    // Add "+" button
    const addBtn = document.createElement('div');
    addBtn.className = 'tab-add';
    addBtn.innerHTML = icon('plus', 16);
    addBtn.title = 'New Tab';
    addBtn.addEventListener('click', () => {
        selectFolderBtn.click();
    });
    tabsContainer.appendChild(addBtn);
}

// ==================== VIDEO SCRUBBER ====================
function initVideoScrubber() {
    // Event listeners are now attached directly to cards in renderItems
    // This function is kept for compatibility but does nothing
}

function showScrubber(card, video) {
    if (!video || !card) return;
    
    // Get or create the time label element
    let timeLabel = card.querySelector('.video-time-label');
    if (!timeLabel) {
        timeLabel = document.createElement('div');
        timeLabel.className = 'video-time-label';
        card.appendChild(timeLabel);
    }
    
    // Update the label with current time vs total duration
    const updateTimeDisplay = () => {
        if (!timeLabel || !card.contains(timeLabel)) return;
        
        const currentTime = video.currentTime || 0;
        const duration = (video.duration && !isNaN(video.duration) && video.duration > 0) ? video.duration : 0;
        const currentTimeFormatted = formatTime(currentTime);
        const durationFormatted = duration > 0 ? formatTime(duration) : '--:--';
        timeLabel.textContent = `${currentTimeFormatted} / ${durationFormatted}`;
    };
    
    // Initial update
    updateTimeDisplay();
    
    // Update when video time changes (if video is playing)
    const timeUpdateHandler = updateTimeDisplay;
    video.addEventListener('timeupdate', timeUpdateHandler);
    
    // Also update when metadata loads (duration becomes available)
    const metadataHandler = () => {
        updateTimeDisplay();
    };
    video.addEventListener('loadedmetadata', metadataHandler);
    
    // Store the handlers so we can remove them later
    card._timeUpdateHandler = timeUpdateHandler;
    card._metadataHandler = metadataHandler;
    
    // Show the label
    timeLabel.classList.add('show');
}

function hideScrubber(card) {
    if (!card) return;
    
    const timeLabel = card.querySelector('.video-time-label');
    if (timeLabel) {
        timeLabel.classList.remove('show');
    }
    
    // Remove listeners if they exist
    const video = card.querySelector('video');
    if (video) {
        if (card._timeUpdateHandler) {
            video.removeEventListener('timeupdate', card._timeUpdateHandler);
            delete card._timeUpdateHandler;
        }
        if (card._metadataHandler) {
            video.removeEventListener('loadedmetadata', card._metadataHandler);
            delete card._metadataHandler;
        }
    }
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ==================== ZOOM CONTROLS ====================
function initZoom() {
    const savedZoom = localStorage.getItem('zoomLevel');
    if (savedZoom) {
        zoomLevel = parseInt(savedZoom, 10);
        zoomSlider.value = zoomLevel;
        zoomValue.textContent = `${zoomLevel}%`;
    }
    applyZoom();
}

function applyZoom() {
    invalidateMasonryStyleCache();
    const scale = zoomLevel / 100;
    // Update CSS variable for zoom
    document.documentElement.style.setProperty('--zoom-level', zoomLevel);
    
    // Adjust grid container gap and card sizes
    const baseGap = 16;
    const scaledGap = baseGap * scale;
    gridContainer.style.setProperty('--gap', `${scaledGap}px`);
    
    // For grid layout, adjust column width — CSS grid auto-recalculates on variable change
    if (layoutMode === 'grid') {
        const baseMinWidth = 250;
        const scaledMinWidth = baseMinWidth * scale;
        gridContainer.style.setProperty('--grid-min-width', `${scaledMinWidth}px`);
    }
    
    // Recalculate masonry layout if needed
    if (layoutMode === 'masonry') {
        scheduleMasonryLayout();
    }
}

// ==================== THEME ====================
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
        currentTheme = savedTheme;
        themeSelect.value = currentTheme;
    }
    applyTheme();
}

function applyTheme() {
    invalidateMasonryStyleCache();
    if (currentTheme === 'light') {
        document.documentElement.classList.add('light-theme');
    } else {
        document.documentElement.classList.remove('light-theme');
    }
    deferLocalStorageWrite('theme', currentTheme);
}

// ==================== THUMBNAIL QUALITY ====================
function initThumbnailQuality() {
    const savedQuality = localStorage.getItem('thumbnailQuality');
    if (savedQuality && ['low', 'medium', 'high'].includes(savedQuality)) {
        thumbnailQuality = savedQuality;
        thumbnailQualitySelect.value = thumbnailQuality;
    }
}

function getThumbnailQualityMultiplier() {
    switch (thumbnailQuality) {
        case 'low': return 0.2;
        case 'high': return 0.5;
        default: return 0.3; // medium
    }
}

// ==================== NEW FEATURES IMPLEMENTATION ====================

// Get current filtered items for lightbox navigation
function getFilteredMediaItems() {
    const cards = gridContainer.querySelectorAll('.video-card:not(.folder-card)');
    const items = [];
    cards.forEach(card => {
        if (card.style.display !== 'none') {
            const url = card.dataset.src;
            const path = card.dataset.path;
            const name = card.dataset.name || card.querySelector('.video-info')?.textContent || '';
            const type = card.dataset.mediaType || 'video';
            if (url && path) {
                items.push({ url, path, name, type });
            }
        }
    });
    return items;
}

// Lightbox navigation
function navigateLightbox(direction) {
    if (lightboxItems.length === 0) {
        lightboxItems = getFilteredMediaItems();
    }
    if (lightboxItems.length === 0) return;
    
    if (direction === 'next') {
        currentLightboxIndex = (currentLightboxIndex + 1) % lightboxItems.length;
    } else {
        currentLightboxIndex = (currentLightboxIndex - 1 + lightboxItems.length) % lightboxItems.length;
    }
    
    const item = lightboxItems[currentLightboxIndex];
    if (item) {
        openLightbox(item.url, item.path, item.name);
    }
}

// Video playback controls
function setVideoPlaybackSpeed(speed) {
    videoPlaybackSpeed = speed;
    if (lightboxVideo) {
        lightboxVideo.playbackRate = speed;
    }
    const speedBtn = document.getElementById('lightbox-speed-btn');
    if (speedBtn) {
        speedBtn.textContent = `${speed}x`;
    }
}

function toggleVideoLoop() {
    videoLoop = !videoLoop;
    if (lightboxVideo) {
        lightboxVideo.loop = videoLoop;
    }
    const loopBtn = document.getElementById('lightbox-loop-btn');
    if (loopBtn) {
        loopBtn.textContent = videoLoop ? 'On' : 'Off';
        loopBtn.classList.toggle('active', videoLoop);
    }
}

function toggleVideoRepeat() {
    videoRepeat = !videoRepeat;
    const repeatBtn = document.getElementById('lightbox-repeat-btn');
    if (repeatBtn) {
        repeatBtn.textContent = videoRepeat ? 'On' : 'Off';
        repeatBtn.classList.toggle('active', videoRepeat);
    }
    if (videoRepeat && lightboxVideo) {
        lightboxVideo.addEventListener('ended', handleVideoRepeat);
    } else if (lightboxVideo) {
        lightboxVideo.removeEventListener('ended', handleVideoRepeat);
    }
}

function handleVideoRepeat() {
    if (videoRepeat && lightboxVideo) {
        lightboxVideo.currentTime = 0;
        lightboxVideo.play();
    }
}

function stepVideoFrame(direction) {
    if (!lightboxVideo || lightboxVideo.readyState < 2) return;
    
    const frameTime = 1 / 30; // Assume 30fps, could be improved with actual fps detection
    if (direction === 'next') {
        lightboxVideo.currentTime = Math.min(lightboxVideo.duration, lightboxVideo.currentTime + frameTime);
    } else {
        lightboxVideo.currentTime = Math.max(0, lightboxVideo.currentTime - frameTime);
    }
}

// Helper function to escape HTML
function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Extract common ComfyUI parameters from workflow
function extractComfyUIParameters(workflow) {
    if (!workflow || typeof workflow !== 'object') return null;
    
    const params = {
        prompt: null,
        negativePrompt: null,
        cfgScale: null,
        steps: null,
        sampler: null,
        seed: null,
        model: null,
        width: null,
        height: null
    };
    
    // ComfyUI workflow structure: workflow.prompt contains node data
    // Each node has class_type and inputs
    const promptData = workflow.prompt || workflow;
    
    if (typeof promptData === 'object') {
        const clipTextNodes = [];
        
        // First pass: collect all CLIPTextEncode nodes
        for (const nodeId in promptData) {
            const node = promptData[nodeId];
            if (!node || typeof node !== 'object') continue;
            
            const classType = node.class_type || '';
            const inputs = node.inputs || {};
            
            // Collect CLIPTextEncode nodes
            if (classType.includes('CLIPTextEncode') && inputs.text) {
                const nodeTitle = (node.title || nodeId || '').toLowerCase();
                const isNegative = nodeTitle.includes('negative') || 
                                  nodeTitle.includes('neg') ||
                                  nodeTitle.includes('n_prompt');
                clipTextNodes.push({
                    text: inputs.text,
                    isNegative: isNegative,
                    nodeId: nodeId
                });
            }
            
            // Find KSampler or Sampler nodes - these contain the actual generation parameters
            // Only take the first instance of each parameter
            if (classType === 'KSampler' || classType === 'KSamplerAdvanced' || classType.includes('KSampler')) {
                // Only set CFG scale if not already set (first instance)
                if (params.cfgScale === null && inputs.cfg !== undefined && inputs.cfg !== null) {
                    params.cfgScale = inputs.cfg;
                }
                // Only set steps if not already set (first instance)
                if (params.steps === null && inputs.steps !== undefined && inputs.steps !== null) {
                    params.steps = inputs.steps;
                }
                // Seed in KSampler should be a large integer (typically 10+ digits), not a small float
                // Only set seed if not already set (first instance)
                if (params.seed === null && inputs.seed !== undefined && inputs.seed !== null) {
                    const seedValue = inputs.seed;
                    // Only accept if it's a very large integer (seeds are typically 10+ digits)
                    if (typeof seedValue === 'number') {
                        // Reject small numbers or floats (like 82.9)
                        if (seedValue > 1000000 && Number.isInteger(seedValue)) {
                            params.seed = seedValue;
                        } else if (seedValue > 1000000) {
                            // Large number but not integer - might be seed as float, floor it
                            params.seed = Math.floor(seedValue);
                        }
                    } else if (typeof seedValue === 'string') {
                        const parsed = parseInt(seedValue);
                        // Only accept if it's a very large number
                        if (!isNaN(parsed) && parsed > 1000000) {
                            params.seed = parsed;
                        }
                    }
                }
                // Only set sampler name if not already set (first instance)
                if (!params.sampler && inputs.sampler_name) {
                    params.sampler = inputs.sampler_name;
                }
            }
            
            // Check for seed in CR Module Pipe Loader or other pipe loader nodes
            // Only take the first instance
            if (params.seed === null && (classType.includes('Pipe') || classType.includes('Module')) && inputs.seed !== undefined && inputs.seed !== null) {
                const seedValue = inputs.seed;
                // Only accept very large integers
                if (typeof seedValue === 'number' && seedValue > 1000000) {
                    params.seed = Math.floor(seedValue);
                } else if (typeof seedValue === 'string') {
                    const parsed = parseInt(seedValue);
                    if (!isNaN(parsed) && parsed > 1000000) {
                        params.seed = parsed;
                    }
                }
            }
            
            // Find seed in RandomSeed node (often used for seed control) - prioritize this
            // Only take the first instance
            if (params.seed === null && (classType === 'RandomSeed' || classType === 'Seed')) {
                if (inputs.seed !== undefined && inputs.seed !== null) {
                    const seedValue = inputs.seed;
                    // Only accept very large numbers (seeds are typically 10+ digits)
                    if (typeof seedValue === 'number' && seedValue > 1000000) {
                        params.seed = Math.floor(seedValue);
                    } else if (typeof seedValue === 'string') {
                        const parsed = parseInt(seedValue);
                        if (!isNaN(parsed) && parsed > 1000000) {
                            params.seed = parsed;
                        }
                    }
                }
                // Sometimes seed is in 'value' field
                if (params.seed === null && inputs.value !== undefined && inputs.value !== null) {
                    const seedValue = inputs.value;
                    if (typeof seedValue === 'number' && seedValue > 1000000) {
                        params.seed = Math.floor(seedValue);
                    } else if (typeof seedValue === 'string') {
                        const parsed = parseInt(seedValue);
                        if (!isNaN(parsed) && parsed > 1000000) {
                            params.seed = parsed;
                        }
                    }
                }
            }
            
            // Find model (CheckpointLoaderSimple, CheckpointLoader, etc.)
            if (classType.includes('Checkpoint') || classType.includes('Model')) {
                if (inputs.ckpt_name) params.model = inputs.ckpt_name;
                if (inputs.model_name) params.model = inputs.model_name;
            }
            
            // Find resolution from Resolution node (has longer_side and aspect_ratio)
            if (classType === 'Resolution' || classType.includes('Resolution')) {
                if (inputs.longer_side !== undefined && inputs.longer_side !== null) {
                    const longerSide = typeof inputs.longer_side === 'string' ? parseInt(inputs.longer_side) : inputs.longer_side;
                    if (longerSide && longerSide >= 100) {
                        // Calculate dimensions from aspect ratio
                        if (inputs.aspect_ratio) {
                            const aspectRatio = inputs.aspect_ratio;
                            // Parse aspect ratio like "2:3 (Portrait)" or "16:9"
                            const ratioMatch = aspectRatio.match(/(\d+):(\d+)/);
                            if (ratioMatch) {
                                const ratioW = parseFloat(ratioMatch[1]);
                                const ratioH = parseFloat(ratioMatch[2]);
                                const ratio = ratioW / ratioH;
                                
                                // Check if portrait is mentioned
                                const isPortrait = aspectRatio.toLowerCase().includes('portrait') || ratio < 1;
                                
                                if (isPortrait) {
                                    // Portrait: height is longer, width is shorter
                                    params.height = longerSide;
                                    params.width = Math.round(longerSide * ratio);
                                } else {
                                    // Landscape: width is longer, height is shorter
                                    params.width = longerSide;
                                    params.height = Math.round(longerSide / ratio);
                                }
                            }
                        }
                    }
                }
            }
            
            // Find resolution from ImageScaleToMaxDimension node
            if (classType === 'ImageScaleToMaxDimension' || classType.includes('ImageScale')) {
                if (inputs.largest_size !== undefined && inputs.largest_size !== null) {
                    const largestSize = typeof inputs.largest_size === 'string' ? parseInt(inputs.largest_size) : inputs.largest_size;
                    if (largestSize && largestSize >= 100) {
                        // This gives us the longer side, but we need aspect ratio to calculate both dimensions
                        // Store it for later if we don't have dimensions yet
                        if (!params.width || !params.height) {
                            // We'll need to calculate from aspect ratio if available
                        }
                    }
                }
            }
            
            // Find image dimensions (EmptyLatentImage is most common)
            // Only accept reasonable dimensions (typically 64+ pixels, and usually multiples of 8 or 64)
            // But be careful - these might be latent dimensions, not final image dimensions
            if (classType === 'EmptyLatentImage' || classType.includes('EmptyLatentImage')) {
                // Only use if we don't already have dimensions from Resolution node
                if (!params.width || !params.height) {
                    if (inputs.width !== undefined && inputs.width !== null) {
                        const width = typeof inputs.width === 'string' ? parseInt(inputs.width) : inputs.width;
                        // Only accept if it's a reasonable dimension (not tiny like 80)
                        if (width && width >= 100 && Number.isInteger(width)) {
                            params.width = width;
                        }
                    }
                    if (inputs.height !== undefined && inputs.height !== null) {
                        const height = typeof inputs.height === 'string' ? parseInt(inputs.height) : inputs.height;
                        if (height && height >= 100 && Number.isInteger(height)) {
                            params.height = height;
                        }
                    }
                }
            }
            
            // Check for dimensions in other node types, but be more selective
            if ((!params.width || params.width < 100) || (!params.height || params.height < 100)) {
                // Look for width/height in other nodes, but filter out small values
                if (inputs.width !== undefined && inputs.height !== undefined) {
                    const width = typeof inputs.width === 'string' ? parseInt(inputs.width) : inputs.width;
                    const height = typeof inputs.height === 'string' ? parseInt(inputs.height) : inputs.height;
                    // Only accept reasonable dimensions (reject tiny values like 80)
                    if (width && height && width >= 100 && height >= 100 && Number.isInteger(width) && Number.isInteger(height)) {
                        if (!params.width || params.width < 100) params.width = width;
                        if (!params.height || params.height < 100) params.height = height;
                    }
                }
            }
        }
        
        // Determine positive and negative prompts from collected nodes
        if (clipTextNodes.length > 0) {
            // Sort by nodeId to get consistent order (but note: nodeId order may not match workflow order)
            clipTextNodes.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
            
            // If we have explicit negative markers, use those
            const negativeNode = clipTextNodes.find(n => n.isNegative);
            const positiveNodes = clipTextNodes.filter(n => !n.isNegative);
            
            if (negativeNode) {
                params.negativePrompt = negativeNode.text;
            }
            
            // First non-negative node is positive prompt
            if (positiveNodes.length > 0) {
                params.prompt = positiveNodes[0].text;
            }
            
            // If we have 2 nodes and one is marked negative, the other is positive
            if (clipTextNodes.length === 2) {
                if (negativeNode && positiveNodes.length === 1) {
                    params.prompt = positiveNodes[0].text;
                } else if (!negativeNode) {
                    // If neither is marked, swap the order (user reported they were swapped)
                    // Second node is positive, first is negative
                    params.prompt = clipTextNodes[1].text;
                    params.negativePrompt = clipTextNodes[0].text;
                }
            }
            
            // If no explicit negative but we have 2+ unmarked nodes, swap order
            if (!params.negativePrompt && clipTextNodes.length >= 2 && positiveNodes.length >= 2) {
                // User says they're swapped, so reverse: last is positive, first is negative
                params.prompt = positiveNodes[positiveNodes.length - 1].text;
                params.negativePrompt = positiveNodes[0].text;
            }
            
            // Fallback: if only one node found and no negative marker, assume it's positive
            if (!params.prompt && clipTextNodes.length === 1) {
                params.prompt = clipTextNodes[0].text;
            }
        }
        
        // Try to get dimensions from workflow metadata or extra data
        if ((!params.width || params.width < 100) || (!params.height || params.height < 100)) {
            // Check workflow.extra for dimensions
            if (workflow.extra) {
                if (workflow.extra.dworkflow) {
                    const dworkflow = workflow.extra.dworkflow;
                    if (dworkflow.width && dworkflow.width >= 100) params.width = dworkflow.width;
                    if (dworkflow.height && dworkflow.height >= 100) params.height = dworkflow.height;
                }
                // Sometimes dimensions are directly in extra
                if (workflow.extra.width && workflow.extra.width >= 100) params.width = workflow.extra.width;
                if (workflow.extra.height && workflow.extra.height >= 100) params.height = workflow.extra.height;
            }
            
            // Check workflow output or other metadata
            if (workflow.output) {
                if (workflow.output.width && workflow.output.width >= 100) params.width = workflow.output.width;
                if (workflow.output.height && workflow.output.height >= 100) params.height = workflow.output.height;
            }
        }
        
        // Final check: look for seed in workflow.extra or other metadata (seeds are large integers, 10+ digits)
        if (!params.seed || params.seed < 1000000) {
            if (workflow.extra) {
                if (workflow.extra.seed !== undefined && workflow.extra.seed !== null) {
                    const seedValue = workflow.extra.seed;
                    if (typeof seedValue === 'number' && seedValue > 1000000) {
                        params.seed = Math.floor(seedValue);
                    } else if (typeof seedValue === 'string') {
                        const parsed = parseInt(seedValue);
                        if (!isNaN(parsed) && parsed > 1000000) {
                            params.seed = parsed;
                        }
                    }
                }
            }
            // Also check workflow directly for seed
            if ((!params.seed || params.seed < 1000000) && workflow.seed !== undefined && workflow.seed !== null) {
                const seedValue = workflow.seed;
                if (typeof seedValue === 'number' && seedValue > 1000000) {
                    params.seed = Math.floor(seedValue);
                } else if (typeof seedValue === 'string') {
                    const parsed = parseInt(seedValue);
                    if (!isNaN(parsed) && parsed > 1000000) {
                        params.seed = parsed;
                    }
                }
            }
        }
    }
    
    return params;
}

// File info panel (popover)
async function showFileInfo(filePath) {
    console.log('showFileInfo called with filePath:', filePath);
    const panel = document.getElementById('file-info-panel');
    const details = document.getElementById('file-info-details');
    if (!panel || !details) {
        console.error('File info panel elements not found', { panel: !!panel, details: !!details });
        return;
    }
    
    // Position panel using CSS bottom and right properties relative to button
    const infoBtn = document.getElementById('lightbox-info-btn');
    if (infoBtn) {
        const btnRect = infoBtn.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        
        // Calculate bottom offset (distance from bottom of viewport to top of button + gap)
        const bottomOffset = viewportHeight - btnRect.top + 10;
        
        // Calculate right offset (distance from right of viewport to right of button)
        const rightOffset = viewportWidth - btnRect.right;
        
        // Use CSS bottom and right properties for positioning
        panel.style.top = 'auto';
        panel.style.left = 'auto';
        panel.style.bottom = `${bottomOffset}px`;
        panel.style.right = `${rightOffset}px`;
        panel.style.transform = 'none';
        
        console.log('Positioned panel using CSS bottom/right:', { 
            bottom: panel.style.bottom,
            right: panel.style.right,
            buttonTop: btnRect.top,
            buttonRight: btnRect.right
        });
    } else {
        // Center the panel if button not found
        panel.style.top = '50%';
        panel.style.left = '50%';
        panel.style.bottom = 'auto';
        panel.style.right = 'auto';
        panel.style.transform = 'translate(-50%, -50%)';
        console.log('Centered panel (button not found)');
    }
    
    // Show panel
    panel.classList.remove('hidden');
    panel.style.display = 'block';
    panel.style.pointerEvents = 'auto';
    panel.style.visibility = 'visible';
    panel.style.opacity = '1';
    
    // Verify panel is actually visible
    const computedStyle = window.getComputedStyle(panel);
    console.log('Panel hidden class removed, panel should be visible now', {
        hasHidden: panel.classList.contains('hidden'),
        display: panel.style.display,
        computedDisplay: computedStyle.display,
        computedVisibility: computedStyle.visibility,
        computedOpacity: computedStyle.opacity,
        computedZIndex: computedStyle.zIndex,
        computedPointerEvents: computedStyle.pointerEvents,
        panelRect: panel.getBoundingClientRect()
    });
    
    try {
        const result = await window.electronAPI.getFileInfo(filePath);
        if (result && result.success && result.info) {
            const info = result.info;
            console.log('File info received:', {
                hasComfyUIWorkflow: !!info.comfyUIWorkflow,
                workflowData: info.comfyUIWorkflow
            });
            details.innerHTML = `
                <div class="file-info-detail-row">
                    <span class="file-info-detail-label">Name:</span>
                    <span class="file-info-detail-value">${info.name}</span>
                </div>
                <div class="file-info-detail-row file-info-path-row">
                    <span class="file-info-detail-label">Path:</span>
                    <span class="file-info-detail-value">${info.path}</span>
                </div>
                <div class="file-info-detail-row">
                    <span class="file-info-detail-label">Size:</span>
                    <span class="file-info-detail-value">${info.sizeFormatted}</span>
                </div>
                <div class="file-info-detail-row">
                    <span class="file-info-detail-label">Created:</span>
                    <span class="file-info-detail-value">${new Date(info.created).toLocaleString()}</span>
                </div>
                <div class="file-info-detail-row">
                    <span class="file-info-detail-label">Modified:</span>
                    <span class="file-info-detail-value">${new Date(info.modified).toLocaleString()}</span>
                </div>
                ${info.width && info.height ? `
                <div class="file-info-detail-row">
                    <span class="file-info-detail-label">Dimensions:</span>
                    <span class="file-info-detail-value">${info.width} x ${info.height}</span>
                </div>
                ` : ''}
                ${info.type === 'video' ? `
                <div class="file-info-detail-row">
                    <span class="file-info-detail-label">Type:</span>
                    <span class="file-info-detail-value">Video</span>
                </div>
                ` : info.type === 'image' ? `
                <div class="file-info-detail-row">
                    <span class="file-info-detail-label">Type:</span>
                    <span class="file-info-detail-value">Image</span>
                </div>
                ` : ''}
                ${info.comfyUIWorkflow ? (() => {
                    let workflow = info.comfyUIWorkflow.workflow;
                    if (!workflow && info.comfyUIWorkflow.raw) {
                        try {
                            workflow = typeof info.comfyUIWorkflow.raw === 'string' 
                                ? JSON.parse(info.comfyUIWorkflow.raw) 
                                : info.comfyUIWorkflow.raw;
                        } catch (e) {
                            console.warn('Failed to parse workflow raw data:', e);
                            workflow = null;
                        }
                    }
                    const params = workflow ? extractComfyUIParameters(workflow) : null;
                    return `
                <div class="file-info-detail-row file-info-comfyui-section">
                    <div class="file-info-comfyui-header">
                        <span class="file-info-detail-label">ComfyUI Workflow:</span>
                        <button class="file-info-toggle-btn" data-toggle-workflow>▼</button>
                    </div>
                    <div class="file-info-comfyui-content">
                        ${params && (params.prompt || params.cfgScale !== null || params.steps !== null || params.seed !== null) ? `
                        <div class="file-info-comfyui-params">
                            <div class="file-info-comfyui-params-header">Generation Parameters</div>
                            ${params.prompt ? `
                            <div class="file-info-detail-row file-info-prompt-row">
                                <span class="file-info-detail-label">Prompt:</span>
                                <div class="file-info-prompt-value">${escapeHtml(params.prompt)}</div>
                            </div>
                            ` : ''}
                            ${params.negativePrompt ? `
                            <div class="file-info-detail-row file-info-prompt-row">
                                <span class="file-info-detail-label">Negative Prompt:</span>
                                <div class="file-info-prompt-value">${escapeHtml(params.negativePrompt)}</div>
                            </div>
                            ` : ''}
                            <div class="file-info-comfyui-params-grid">
                                ${params.cfgScale !== null ? `
                                <div class="file-info-detail-row">
                                    <span class="file-info-detail-label">CFG Scale:</span>
                                    <span class="file-info-detail-value">${params.cfgScale}</span>
                                </div>
                                ` : ''}
                                ${params.steps !== null ? `
                                <div class="file-info-detail-row">
                                    <span class="file-info-detail-label">Steps:</span>
                                    <span class="file-info-detail-value">${params.steps}</span>
                                </div>
                                ` : ''}
                                ${params.sampler ? `
                                <div class="file-info-detail-row">
                                    <span class="file-info-detail-label">Sampler:</span>
                                    <span class="file-info-detail-value">${escapeHtml(params.sampler)}</span>
                                </div>
                                ` : ''}
                                ${params.seed !== null ? `
                                <div class="file-info-detail-row">
                                    <span class="file-info-detail-label">Seed:</span>
                                    <span class="file-info-detail-value">${params.seed}</span>
                                </div>
                                ` : ''}
                                ${params.model ? `
                                <div class="file-info-detail-row">
                                    <span class="file-info-detail-label">Model:</span>
                                    <span class="file-info-detail-value">${escapeHtml(params.model)}</span>
                                </div>
                                ` : ''}
                                ${params.width && params.height ? `
                                <div class="file-info-detail-row">
                                    <span class="file-info-detail-label">Resolution:</span>
                                    <span class="file-info-detail-value">${params.width} x ${params.height}</span>
                                </div>
                                ` : ''}
                            </div>
                        </div>
                        ` : ''}
                        <div class="file-info-detail-row">
                            <span class="file-info-detail-label">Metadata Key:</span>
                            <span class="file-info-detail-value">${escapeHtml(info.comfyUIWorkflow.key)}</span>
                        </div>
                        ${info.comfyUIWorkflow.workflow ? `
                        <div class="file-info-detail-row">
                            <span class="file-info-detail-label">Workflow Data:</span>
                            <div class="file-info-workflow-json">
                                <pre class="file-info-json-pre">${escapeHtml(JSON.stringify(info.comfyUIWorkflow.workflow, null, 2))}</pre>
                                <button class="file-info-copy-json-btn" data-copy-workflow-json>Copy JSON</button>
                            </div>
                        </div>
                        ` : `
                        <div class="file-info-detail-row">
                            <span class="file-info-detail-label">Raw Data:</span>
                            <div class="file-info-workflow-json">
                                <pre class="file-info-json-pre">${escapeHtml(info.comfyUIWorkflow.raw.substring(0, 500))}${info.comfyUIWorkflow.raw.length > 500 ? '...' : ''}</pre>
                                <button class="file-info-copy-json-btn" data-copy-workflow-raw>Copy Raw</button>
                            </div>
                        </div>
                        `}
                    </div>
                </div>
                `;
                })() : ''}
            `;
            
            // Set up event listeners for ComfyUI workflow buttons (inside the success block where info is in scope)
            const toggleBtn = details.querySelector('[data-toggle-workflow]');
            if (toggleBtn) {
                toggleBtn.addEventListener('click', function() {
                    const content = this.parentElement.nextElementSibling;
                    content.classList.toggle('hidden');
                    this.textContent = this.textContent === '▼' ? '▶' : '▼';
                });
            }

            const copyJsonBtn = details.querySelector('[data-copy-workflow-json]');
            if (copyJsonBtn && info.comfyUIWorkflow && info.comfyUIWorkflow.workflow) {
                const workflowJson = JSON.stringify(info.comfyUIWorkflow.workflow, null, 2);
                copyJsonBtn.addEventListener('click', function() {
                    navigator.clipboard.writeText(workflowJson).then(() => {
                        const originalText = this.textContent;
                        this.textContent = 'Copied!';
                        setTimeout(() => {
                            this.textContent = originalText;
                        }, 2000);
                    });
                });
            }

            const copyRawBtn = details.querySelector('[data-copy-workflow-raw]');
            if (copyRawBtn && info.comfyUIWorkflow && info.comfyUIWorkflow.raw) {
                const rawData = info.comfyUIWorkflow.raw;
                copyRawBtn.addEventListener('click', function() {
                    navigator.clipboard.writeText(rawData).then(() => {
                        const originalText = this.textContent;
                        this.textContent = 'Copied!';
                        setTimeout(() => {
                            this.textContent = originalText;
                        }, 2000);
                    });
                });
            }
        } else {
            details.innerHTML = `<div class="file-info-detail-row">Error: ${result.error || 'Unknown error'}</div>`;
        }
        
        // No need to reposition - CSS bottom/right positioning handles it automatically
    } catch (error) {
        console.error('Error in showFileInfo:', error);
        details.innerHTML = `<div class="file-info-detail-row">Error: ${error.message || 'Unknown error occurred'}</div>`;
    }
}

// Star ratings
function getFileRating(filePath) {
    if (!filePath) return 0;
    // Check both original path and normalized path to handle Windows path variations
    const normalizedPath = normalizePath(filePath);
    return fileRatings[filePath] || fileRatings[normalizedPath] || 0;
}

function setFileRating(filePath, rating) {
    if (!filePath) return;
    // Store with both original and normalized path for consistent lookups
    fileRatings[filePath] = rating;
    const normalizedPath = normalizePath(filePath);
    if (normalizedPath !== filePath) {
        fileRatings[normalizedPath] = rating;
    }
    saveRatings();
    
    // Update all cards with the same path immediately - use updateCardRating which calls updateCardStars
    updateCardRating(filePath, rating);
}

function updateCardStars(card, rating, filePath) {
    let starContainer = card.querySelector('.star-rating');
    if (!starContainer) {
        // Create star container if it doesn't exist
        starContainer = document.createElement('div');
        starContainer.className = 'star-rating';
        starContainer.style.pointerEvents = 'auto';
        // Insert before the info element
        const info = card.querySelector('.video-info');
        if (info) {
            card.insertBefore(starContainer, info);
        } else {
            card.appendChild(starContainer);
        }
    }
    
    // Update visibility class based on rating
    starContainer.classList.toggle('has-rating', rating > 0);

    // Clear and rebuild stars
    starContainer.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
        const star = document.createElement('span');
        star.className = `star ${i <= rating ? 'active' : ''}`;
        star.innerHTML = i <= rating ? iconFilled('star', 16, 'var(--warning)') : icon('star', 16);
        star.style.pointerEvents = 'auto';
        star.style.cursor = 'pointer';
        star.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            setFileRating(filePath, i);
        });
        starContainer.appendChild(star);
    }
}

function saveRatings() {
    deferLocalStorageWrite('fileRatings', JSON.stringify(fileRatings));
}

function loadRatings() {
    try {
        const saved = localStorage.getItem('fileRatings');
        if (saved) {
            fileRatings = JSON.parse(saved);
        }
    } catch (error) {
        console.error('Error loading ratings:', error);
        fileRatings = {};
    }
}

function updateCardRating(filePath, rating) {
    // Normalize path for matching
    const normalizedPath = filePath.replace(/\\/g, '/');
    
    // Find all cards - try multiple selectors and path formats
    const allCards = gridContainer.querySelectorAll('.video-card:not(.folder-card)');
    allCards.forEach(card => {
        const cardPath = card.dataset.path || card.dataset.filePath;
        if (cardPath) {
            const normalizedCardPath = cardPath.replace(/\\/g, '/');
            // Match exact path or normalized path (case-insensitive)
            if (normalizedCardPath === normalizedPath || cardPath === filePath || 
                normalizedCardPath.toLowerCase() === normalizedPath.toLowerCase() ||
                cardPath.toLowerCase() === filePath.toLowerCase()) {
                updateCardStars(card, rating, filePath);
            }
        }
    });
}

// Advanced search
function applyAdvancedSearch() {
    const sizeOp = document.getElementById('search-size-operator')?.value || '';
    const sizeVal = parseFloat(document.getElementById('search-size-value')?.value);
    const dateFrom = document.getElementById('search-date-from')?.value;
    const dateTo = document.getElementById('search-date-to')?.value;
    const width = parseInt(document.getElementById('search-width')?.value);
    const height = parseInt(document.getElementById('search-height')?.value);
    const aspectRatio = document.getElementById('search-aspect-ratio')?.value || '';
    const starRating = parseInt(document.getElementById('search-star-rating')?.value);
    
    advancedSearchFilters = {
        sizeOperator: sizeOp,
        sizeValue: isNaN(sizeVal) ? null : sizeVal * 1024 * 1024, // Convert MB to bytes
        dateFrom: dateFrom ? new Date(dateFrom).getTime() : null,
        dateTo: dateTo ? new Date(dateTo).getTime() + 86400000 : null, // Add 1 day to include the full day
        width: isNaN(width) ? null : width,
        height: isNaN(height) ? null : height,
        aspectRatio: aspectRatio,
        starRating: isNaN(starRating) ? null : starRating
    };
    
    applyFilters();
    const panel = document.getElementById('advanced-search-panel');
    if (panel) panel.classList.add('hidden');
}

function clearAdvancedSearch() {
    advancedSearchFilters = {
        sizeOperator: '',
        sizeValue: null,
        dateFrom: null,
        dateTo: null,
        width: null,
        height: null,
        aspectRatio: '',
        starRating: null
    };
    
    document.getElementById('search-size-operator').value = '';
    document.getElementById('search-size-value').value = '';
    document.getElementById('search-date-from').value = '';
    document.getElementById('search-date-to').value = '';
    document.getElementById('search-width').value = '';
    document.getElementById('search-height').value = '';
    document.getElementById('search-aspect-ratio').value = '';
    document.getElementById('search-star-rating').value = '';
    
    applyFilters();
}

// File organization
async function createFolder(folderName) {
    if (!currentFolderPath || !folderName) return;
    try {
        const result = await window.electronAPI.createFolder(currentFolderPath, folderName);
        if (result.success) {
            await navigateToFolder(currentFolderPath); // Refresh
        } else {
            alert('Error creating folder: ' + result.error);
        }
    } catch (error) {
        alert('Error creating folder: ' + error.message);
    }
}

async function moveFilesToFolder(filePaths, destFolder) {
    if (!filePaths || filePaths.length === 0) return;
    
    showProgress(0, filePaths.length, 'Moving files...');
    let success = 0;
    let failed = 0;
    
    for (let i = 0; i < filePaths.length; i++) {
        if (currentProgress && currentProgress.cancelled) break;
        
        const filePath = filePaths[i];
        const fileName = filePath.substring(Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/')) + 1);
        const separator = destFolder.includes('\\') ? '\\' : '/';
        const destPath = destFolder + (destFolder.endsWith('\\') || destFolder.endsWith('/') ? '' : separator) + fileName;
        
        try {
            const result = await window.electronAPI.moveFile(filePath, destPath);
            if (result.success) {
                success++;
            } else {
                failed++;
            }
        } catch (error) {
            failed++;
        }
        
        updateProgress(i + 1, filePaths.length);
    }
    
    hideProgress();
    if (success > 0) {
        await navigateToFolder(currentFolderPath); // Refresh
    }
    if (failed > 0) {
        alert(`Failed to move ${failed} file(s)`);
    }
}

async function organizeByDate() {
    if (!currentFolderPath) return;
    
    const items = currentItems.filter(item => item.type !== 'folder');
    if (items.length === 0) return;
    
    showProgress(0, items.length, 'Organizing by date...');
    
    const dateFolders = {};
    
    for (let i = 0; i < items.length; i++) {
        if (currentProgress && currentProgress.cancelled) break;
        
        const item = items[i];
        try {
            // Get file stats via IPC
            const result = await window.electronAPI.getFileInfo(item.path);
            if (result.success && result.info) {
                const date = new Date(result.info.modified);
                const folderName = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                
                if (!dateFolders[folderName]) {
                    dateFolders[folderName] = [];
                }
                dateFolders[folderName].push(item.path);
            }
        } catch (error) {
            console.error('Error getting file stats:', error);
        }
        
        updateProgress(i + 1, items.length);
    }
    
    // Create folders and move files
    for (const [folderName, filePaths] of Object.entries(dateFolders)) {
        const separator = currentFolderPath.includes('\\') ? '\\' : '/';
        const folderPath = currentFolderPath + (currentFolderPath.endsWith('\\') || currentFolderPath.endsWith('/') ? '' : separator) + folderName;
        await window.electronAPI.createFolder(currentFolderPath, folderName);
        await moveFilesToFolder(filePaths, folderPath);
    }
    
    hideProgress();
    await navigateToFolder(currentFolderPath);
}

async function organizeByType() {
    if (!currentFolderPath) return;
    
    const items = currentItems.filter(item => item.type !== 'folder');
    if (items.length === 0) return;
    
    showProgress(0, items.length, 'Organizing by type...');
    
    const typeFolders = {};
    
    for (let i = 0; i < items.length; i++) {
        if (currentProgress && currentProgress.cancelled) break;
        
        const item = items[i];
        const ext = item.name.substring(item.name.lastIndexOf('.') + 1).toLowerCase();
        const folderName = ext.toUpperCase() || 'Other';
        
        if (!typeFolders[folderName]) {
            typeFolders[folderName] = [];
        }
        typeFolders[folderName].push(item.path);
        
        updateProgress(i + 1, items.length);
    }
    
    // Create folders and move files
    for (const [folderName, filePaths] of Object.entries(typeFolders)) {
        const folderPath = currentFolderPath + (currentFolderPath.endsWith('\\') || currentFolderPath.endsWith('/') ? '' : '\\') + folderName;
        await window.electronAPI.createFolder(currentFolderPath, folderName);
        await moveFilesToFolder(filePaths, folderPath);
    }
    
    hideProgress();
    await navigateToFolder(currentFolderPath);
}

// Progress indicators
function showProgress(current, total, text) {
    currentProgress = { current, total, cancelled: false };
    const indicator = document.getElementById('progress-indicator');
    const progressText = document.getElementById('progress-text');
    const progressFill = document.getElementById('progress-bar-fill');

    if (indicator) indicator.classList.remove('hidden');
    if (progressText) progressText.textContent = text || 'Processing...';
    setStatusActivity(text || 'Processing...');
    updateProgress(current, total);
}

function updateProgress(current, total) {
    if (!currentProgress) return;
    currentProgress.current = current;
    currentProgress.total = total;
    
    const progressFill = document.getElementById('progress-bar-fill');
    if (progressFill && total > 0) {
        const percent = (current / total) * 100;
        progressFill.style.width = `${percent}%`;
    }
    
    const progressText = document.getElementById('progress-text');
    if (progressText && total > 0) {
        progressText.textContent = `Processing... ${current} of ${total}`;
    }
}

function hideProgress() {
    currentProgress = null;
    const indicator = document.getElementById('progress-indicator');
    if (indicator) indicator.classList.add('hidden');
    setStatusActivity('');
}

function cancelProgress() {
    if (currentProgress) {
        currentProgress.cancelled = true;
    }
    hideProgress();
}

// File watching
let currentWatchedFolder = null;

async function startWatchingFolder(folderPath) {
    // Normalize path for consistent comparison
    const normalizedPath = normalizePath(folderPath);
    if (currentWatchedFolder && normalizePath(currentWatchedFolder) === normalizedPath) return;
    
    // Stop watching previous folder
    if (currentWatchedFolder) {
        await window.electronAPI.unwatchFolder(currentWatchedFolder);
    }
    
    // Start watching new folder
    try {
        const result = await window.electronAPI.watchFolder(folderPath);
        if (result.success) {
            currentWatchedFolder = folderPath;
        }
    } catch (error) {
        console.error('Error watching folder:', error);
    }
}

// Recent files preview is now handled inline in renderRecentFiles

// Update applyFilters to include advanced search
const originalApplyFilters = applyFilters;
applyFilters = function() {
    originalApplyFilters();
    
    // Apply advanced search filters
    const cards = gridContainer.querySelectorAll('.video-card:not(.folder-card)');
    cards.forEach(card => {
        if (card.style.display === 'none') return;
        
        const filePath = card.dataset.path;
        
        // If stars filter is active, hide cards without filePath or without ratings
        if (currentFilter === 'stars') {
            if (!filePath) {
                card.style.display = 'none';
                return;
            }
            const rating = getFileRating(filePath);
            if (rating === 0) {
                card.style.display = 'none';
                return;
            }
        }
        
        if (!filePath) return;
        
        let matches = true;
        
        // Size filter
        if (advancedSearchFilters.sizeOperator && advancedSearchFilters.sizeValue !== null) {
            // We'd need file size in card data - for now skip
        }
        
        // Date filter
        if (advancedSearchFilters.dateFrom || advancedSearchFilters.dateTo) {
            // We'd need file date in card data - for now skip
        }
        
        // Dimension filter
        if (advancedSearchFilters.width || advancedSearchFilters.height) {
            const width = parseInt(card.dataset.width);
            const height = parseInt(card.dataset.height);
            if (advancedSearchFilters.width && width !== advancedSearchFilters.width) matches = false;
            if (advancedSearchFilters.height && height !== advancedSearchFilters.height) matches = false;
        }
        
        // Aspect ratio filter
        if (advancedSearchFilters.aspectRatio) {
            const width = parseInt(card.dataset.width);
            const height = parseInt(card.dataset.height);
            if (width && height) {
                const ratio = width / height;
                const targetRatio = parseAspectRatio(advancedSearchFilters.aspectRatio);
                if (Math.abs(ratio - targetRatio) > 0.1) matches = false;
            }
        }
        
        // Star rating filter
        if (advancedSearchFilters.starRating !== null) {
            const rating = getFileRating(filePath);
            if (rating < advancedSearchFilters.starRating) matches = false;
        }
        
        if (!matches) {
            card.style.display = 'none';
        }
    });
    
    // Recalculate layout
    if (layoutMode === 'masonry' && gridContainer.classList.contains('masonry')) {
        scheduleMasonryLayout();
    }
};

function parseAspectRatio(ratioStr) {
    if (!ratioStr || ratioStr.trim() === '') return NaN;
    const [w, h] = ratioStr.split(':').map(Number);
    if (isNaN(w) || isNaN(h) || h === 0) return NaN;
    return w / h;
}

// Initialize new features
let newFeaturesInitialized = false;
function initNewFeatures() {
    if (newFeaturesInitialized) return;
    newFeaturesInitialized = true;
    // Lightbox navigation buttons
    const prevBtn = document.getElementById('lightbox-prev');
    const nextBtn = document.getElementById('lightbox-next');
    if (prevBtn) prevBtn.addEventListener('click', () => navigateLightbox('prev'));
    if (nextBtn) nextBtn.addEventListener('click', () => navigateLightbox('next'));
    
    // Video menu
    const videoMenuBtn = document.getElementById('lightbox-video-menu-btn');
    const videoMenu = document.getElementById('lightbox-video-menu');
    if (videoMenuBtn && videoMenu) {
        videoMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            videoMenu.classList.toggle('hidden');
        });
        
        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!videoMenuBtn.contains(e.target) && !videoMenu.contains(e.target)) {
                videoMenu.classList.add('hidden');
            }
        });
    }
    
    const speedBtn = document.getElementById('lightbox-speed-btn');
    if (speedBtn) {
        speedBtn.addEventListener('click', () => {
            const speeds = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
            const currentIndex = speeds.indexOf(videoPlaybackSpeed);
            const nextIndex = (currentIndex + 1) % speeds.length;
            setVideoPlaybackSpeed(speeds[nextIndex]);
        });
    }
    
    const loopBtn = document.getElementById('lightbox-loop-btn');
    const repeatBtn = document.getElementById('lightbox-repeat-btn');
    if (loopBtn) loopBtn.addEventListener('click', toggleVideoLoop);
    if (repeatBtn) repeatBtn.addEventListener('click', toggleVideoRepeat);
    
    // File info button - attach listener directly to button
    const infoBtn = document.getElementById('lightbox-info-btn');
    console.log('Initializing file info button:', infoBtn);
    if (infoBtn) {
        // Remove any existing listeners by cloning and replacing
        const newInfoBtn = infoBtn.cloneNode(true);
        infoBtn.parentNode.replaceChild(newInfoBtn, infoBtn);
        
        // Use event delegation or direct attachment
        newInfoBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();
            console.log('File info button clicked!');
            
            const panel = document.getElementById('file-info-panel');
            
            // Toggle panel: if it's open, close it; if it's closed, open it
            if (panel && !panel.classList.contains('hidden')) {
                // Panel is open, close it
                panel.classList.add('hidden');
                console.log('File info panel closed');
                return;
            }
            
            // Panel is closed, open it with file info
            // Try multiple ways to get the file path
            let filePath = window.currentLightboxFilePath;
            console.log('Trying to get file path:', { 
                currentLightboxFilePath: window.currentLightboxFilePath,
                lightboxItemsLength: lightboxItems.length,
                currentLightboxIndex: currentLightboxIndex
            });
            
            if (!filePath) {
                const copyPathBtn = document.getElementById('copy-path-btn');
                filePath = copyPathBtn?.dataset.filePath;
                console.log('Got filePath from copyPathBtn:', filePath);
            }
            if (!filePath && lightboxItems.length > 0 && currentLightboxIndex >= 0) {
                filePath = lightboxItems[currentLightboxIndex]?.path;
                console.log('Got filePath from lightboxItems:', filePath);
            }
            if (!filePath && lightboxVideo && lightboxVideo.src) {
                // Try to extract path from video src
                const src = lightboxVideo.src;
                if (src.startsWith('file://')) {
                    filePath = src.replace('file:///', '').replace(/\//g, '\\');
                    console.log('Got filePath from video src:', filePath);
                }
            }
            if (!filePath && lightboxImage && lightboxImage.src) {
                // Try to extract path from image src
                const src = lightboxImage.src;
                if (src.startsWith('file://')) {
                    filePath = src.replace('file:///', '').replace(/\//g, '\\');
                    console.log('Got filePath from image src:', filePath);
                }
            }
            
            console.log('Final filePath for info panel:', filePath);
            if (filePath) {
                try {
                    await showFileInfo(filePath);
                } catch (error) {
                    console.error('Error showing file info:', error);
                    const details = document.getElementById('file-info-details');
                    if (panel && details) {
                        panel.classList.remove('hidden');
                        panel.style.display = 'block';
                        details.innerHTML = `<div class="file-info-detail-row">Error: ${error.message}</div>`;
                    }
                }
            } else {
                console.warn('Could not determine file path for info panel');
                // Show error in panel instead of alert
                const details = document.getElementById('file-info-details');
                if (panel && details) {
                    panel.classList.remove('hidden');
                    panel.style.display = 'block';
                    details.innerHTML = '<div class="file-info-detail-row">Error: Could not determine file path</div>';
                }
            }
        });
        console.log('File info button listener attached');
    } else {
        console.error('File info button not found!');
    }
    
    const fileInfoCloseBtn = document.getElementById('file-info-close');
    const fileInfoPanel = document.getElementById('file-info-panel');
    if (fileInfoCloseBtn) {
        fileInfoCloseBtn.addEventListener('click', () => {
            if (fileInfoPanel) fileInfoPanel.classList.add('hidden');
        });
    }
    
    // Prevent clicks inside panel from closing it
    if (fileInfoPanel) {
        fileInfoPanel.addEventListener('click', (e) => {
            e.stopPropagation();
        });
        
        // Close when clicking outside the lightbox (but keep open when clicking inside lightbox)
        document.addEventListener('click', (e) => {
            const infoBtn = document.getElementById('lightbox-info-btn');
            const lightbox = document.getElementById('lightbox');
            
            // Don't close if:
            // - Panel is hidden (no need to check)
            // - Clicking on the panel itself
            // - Clicking on the info button (toggles the panel)
            // - Clicking anywhere inside the lightbox (navigation, controls, content, etc.)
            const isClickOnPanel = fileInfoPanel.contains(e.target);
            const isClickOnInfoBtn = infoBtn && infoBtn.contains(e.target);
            const isClickInsideLightbox = lightbox && !lightbox.classList.contains('hidden') && 
                                         (lightbox.contains(e.target) || e.target.closest('#lightbox'));
            
            if (!fileInfoPanel.classList.contains('hidden') && 
                !isClickOnPanel && 
                !isClickOnInfoBtn &&
                !isClickInsideLightbox) {
                // Only close if clicking outside the lightbox entirely
                fileInfoPanel.classList.add('hidden');
            }
        });
    }
    
    // Advanced search
    const advancedSearchBtn = document.getElementById('advanced-search-btn');
    const advancedSearchPanel = document.getElementById('advanced-search-panel');
    const applyAdvancedSearchBtn = document.getElementById('apply-advanced-search');
    const clearAdvancedSearchBtn = document.getElementById('clear-advanced-search');
    const closeAdvancedSearchBtn = document.getElementById('close-advanced-search');
    
    if (advancedSearchBtn) {
        advancedSearchBtn.addEventListener('click', () => {
            if (advancedSearchPanel) advancedSearchPanel.classList.toggle('hidden');
        });
    }
    
    if (applyAdvancedSearchBtn) {
        applyAdvancedSearchBtn.addEventListener('click', applyAdvancedSearch);
    }
    
    if (clearAdvancedSearchBtn) {
        clearAdvancedSearchBtn.addEventListener('click', clearAdvancedSearch);
    }
    
    if (closeAdvancedSearchBtn) {
        closeAdvancedSearchBtn.addEventListener('click', () => {
            if (advancedSearchPanel) advancedSearchPanel.classList.add('hidden');
        });
    }
    
    // Organize dialog
    const organizeBtn = document.getElementById('organize-btn');
    const organizeDialog = document.getElementById('organize-dialog');
    const createFolderBtn = document.getElementById('create-folder-btn');
    const moveToFolderBtn = document.getElementById('move-to-folder-btn');
    const organizeByDateBtn = document.getElementById('organize-by-date-btn');
    const organizeByTypeBtn = document.getElementById('organize-by-type-btn');
    const organizeInputContainer = document.getElementById('organize-folder-input-container');
    const organizeFolderName = document.getElementById('organize-folder-name');
    const organizeConfirmBtn = document.getElementById('organize-confirm-btn');
    const organizeCancelBtn = document.getElementById('organize-cancel-btn');
    const closeOrganizeDialogBtn = document.getElementById('close-organize-dialog');
    let organizeMode = null;
    
    if (organizeBtn) {
        organizeBtn.addEventListener('click', () => {
            if (organizeDialog) organizeDialog.classList.remove('hidden');
        });
    }
    
    if (createFolderBtn) {
        createFolderBtn.addEventListener('click', () => {
            organizeMode = 'create';
            if (organizeInputContainer) organizeInputContainer.classList.remove('hidden');
            if (organizeFolderName) organizeFolderName.value = '';
        });
    }
    
    if (moveToFolderBtn) {
        moveToFolderBtn.addEventListener('click', () => {
            organizeMode = 'move';
            if (organizeInputContainer) organizeInputContainer.classList.remove('hidden');
            if (organizeFolderName) organizeFolderName.value = '';
        });
    }
    
    if (organizeByDateBtn) {
        organizeByDateBtn.addEventListener('click', () => {
            organizeByDate();
            if (organizeDialog) organizeDialog.classList.add('hidden');
        });
    }
    
    if (organizeByTypeBtn) {
        organizeByTypeBtn.addEventListener('click', () => {
            organizeByType();
            if (organizeDialog) organizeDialog.classList.add('hidden');
        });
    }
    
    if (organizeConfirmBtn) {
        organizeConfirmBtn.addEventListener('click', async () => {
            const folderName = organizeFolderName?.value.trim();
            if (!folderName) return;
            
            if (organizeMode === 'create') {
                await createFolder(folderName);
            } else if (organizeMode === 'move') {
                // Get selected files - for now, move all files
                const selectedFiles = currentItems.filter(item => item.type !== 'folder').map(item => item.path);
                if (selectedFiles.length > 0) {
                    const separator = currentFolderPath.includes('\\') ? '\\' : '/';
                    const destFolder = currentFolderPath + (currentFolderPath.endsWith('\\') || currentFolderPath.endsWith('/') ? '' : separator) + folderName;
                    await window.electronAPI.createFolder(currentFolderPath, folderName);
                    await moveFilesToFolder(selectedFiles, destFolder);
                }
            }
            
            if (organizeInputContainer) organizeInputContainer.classList.add('hidden');
            if (organizeDialog) organizeDialog.classList.add('hidden');
        });
    }
    
    if (organizeCancelBtn) {
        organizeCancelBtn.addEventListener('click', () => {
            if (organizeInputContainer) organizeInputContainer.classList.add('hidden');
            organizeMode = null;
        });
    }
    
    if (closeOrganizeDialogBtn) {
        closeOrganizeDialogBtn.addEventListener('click', () => {
            if (organizeDialog) organizeDialog.classList.add('hidden');
            if (organizeInputContainer) organizeInputContainer.classList.add('hidden');
            organizeMode = null;
        });
    }
    
    // Progress cancel button
    const cancelProgressBtn = document.getElementById('cancel-progress');
    if (cancelProgressBtn) {
        cancelProgressBtn.addEventListener('click', cancelProgress);
    }
    
    // Star rating filter - filter to show only rated files
    const filterStarsBtn = document.getElementById('filter-stars');
    if (filterStarsBtn) {
        filterStarsBtn.addEventListener('click', () => {
            if (currentFilter === 'stars') {
                // Toggle off - go back to 'all'
                currentFilter = 'all';
                filterStarsBtn.classList.remove('active');
                filterAllBtn.classList.add('active');
            } else {
                // Toggle on - filter to stars
                currentFilter = 'stars';
                filterStarsBtn.classList.add('active');
                filterAllBtn.classList.remove('active');
                filterVideosBtn.classList.remove('active');
                filterImagesBtn.classList.remove('active');
                filterAudioBtn.classList.remove('active');
            }
            // Re-render with filtered items (like video/image filters)
            if (currentFolderPath && currentItems.length > 0) {
                const filteredItems = filterItems(currentItems);
                const sortedItems = sortItems(filteredItems);
                renderItems(sortedItems);
            } else {
                scheduleApplyFilters();
            }
        });
    }
    
    // File watching
    window.electronAPI.onFolderChanged((event, data) => {
        if (!currentFolderPath) return;
        
        // Normalize paths for consistent comparison (case-insensitive on Windows)
        const normalizedWatchedPath = normalizePath(data.folderPath).toLowerCase();
        const normalizedCurrentPath = normalizePath(currentFolderPath).toLowerCase();
        
        // Check if the change is in the currently viewed folder or any of its subfolders
        // The watched folder should match the current folder, OR
        // the changed file should be within the current folder tree
        const isInCurrentFolder = normalizedWatchedPath === normalizedCurrentPath;
        let isInSubfolder = false;
        let subfolderPath = null;
        
        if (data.filePath) {
            const normalizedFilePath = normalizePath(data.filePath).toLowerCase();
            // Check if file is in current folder or any subfolder
            // Add '/' to ensure we match folders, not just prefix matches
            const currentPathWithSlash = normalizedCurrentPath + '/';
            isInSubfolder = normalizedFilePath.startsWith(currentPathWithSlash) || 
                           normalizedFilePath === normalizedCurrentPath;
            
            // Extract the subfolder path from the file path
            // This is the folder containing the changed file
            if (isInSubfolder && normalizedFilePath !== normalizedCurrentPath) {
                // Get the directory containing the file (this is the subfolder)
                // Use the original filePath and normalize it
                const lastSlashIndex = Math.max(
                    data.filePath.lastIndexOf('/'),
                    data.filePath.lastIndexOf('\\')
                );
                if (lastSlashIndex !== -1) {
                    subfolderPath = data.filePath.substring(0, lastSlashIndex);
                }
            }
        }
        
        if (isInCurrentFolder || isInSubfolder) {
            // If change is in a subfolder, invalidate that subfolder's cache
            // This ensures that when navigating into the subfolder, fresh data is loaded
            if (subfolderPath) {
                invalidateFolderCache(subfolderPath);
                
                // If we're currently viewing that subfolder, refresh it immediately
                const normalizedSubfolderPath = normalizePath(subfolderPath).toLowerCase();
                if (normalizedSubfolderPath === normalizedCurrentPath) {
                    setTimeout(() => {
                        navigateToFolder(currentFolderPath, false, true); // forceReload = true to ensure fresh data
                    }, 100);
                    return; // Don't refresh parent if we're already refreshing the subfolder
                }
            }
            
            // Refresh current folder (parent) to show newly created/modified/deleted files
            // Use a small delay to ensure file system operations are complete
            setTimeout(() => {
                navigateToFolder(currentFolderPath, false, true); // forceReload = true to ensure fresh data
            }, 100);
        }
    });
    
    // Update keyboard shortcuts to include arrow keys and frame controls for lightbox
    document.addEventListener('keydown', (e) => {
        if (!lightbox.classList.contains('hidden')) {
            // Don't trigger if typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                return;
            }
            
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                navigateLightbox('prev');
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                navigateLightbox('next');
            } else if (e.key === ',' || e.key === '<') {
                // Previous frame (comma key)
                e.preventDefault();
                if (lightboxVideo && lightboxVideo.style.display !== 'none') {
                    stepVideoFrame('prev');
                }
            } else if (e.key === '.' || e.key === '>') {
                // Next frame (period key)
                e.preventDefault();
                if (lightboxVideo && lightboxVideo.style.display !== 'none') {
                    stepVideoFrame('next');
                }
            }
        }
    });
}

// openLightbox already updated above to track current index

// Hook into navigateToFolder to start watching (will be called after navigation completes)
// This is handled in the navigateToFolder function itself

// Restore last folder and layout mode on app startup
window.addEventListener('DOMContentLoaded', async () => {
    // Check ffmpeg availability for video thumbnail generation
    try {
        const ffStatus = await window.electronAPI.hasFfmpeg();
        hasFfmpegAvailable = ffStatus && ffStatus.ffmpeg;
    } catch { /* ffmpeg not available */ }

    // Restore remember folder preference
    const savedRememberFolder = localStorage.getItem('rememberLastFolder');
    if (savedRememberFolder !== null) {
        rememberLastFolder = savedRememberFolder === 'true';
        rememberFolderToggle.checked = rememberLastFolder;
        rememberFolderLabel.textContent = rememberLastFolder ? 'On' : 'Off';
    }
    
    // Restore include moving images preference
    const savedIncludeMovingImages = localStorage.getItem('includeMovingImages');
    if (savedIncludeMovingImages !== null) {
        includeMovingImages = savedIncludeMovingImages === 'true';
        includeMovingImagesToggle.checked = includeMovingImages;
        includeMovingImagesLabel.textContent = includeMovingImages ? 'On' : 'Off';
    }
    
    // Restore pause on lightbox preference
    const savedPauseOnLightbox = localStorage.getItem('pauseOnLightbox');
    if (savedPauseOnLightbox !== null) {
        pauseOnLightbox = savedPauseOnLightbox === 'true';
        pauseOnLightboxToggle.checked = pauseOnLightbox;
        pauseOnLightboxLabel.textContent = pauseOnLightbox ? 'On' : 'Off';
    }

    // Restore auto-repeat videos preference
    const savedAutoRepeat = localStorage.getItem('autoRepeatVideos');
    if (savedAutoRepeat !== null) {
        autoRepeatVideos = savedAutoRepeat === 'true';
        autoRepeatToggle.checked = autoRepeatVideos;
        autoRepeatLabel.textContent = autoRepeatVideos ? 'On' : 'Off';
        if (autoRepeatVideos) {
            videoLoop = true;
        }
    }

    // Restore pause on blur preference
    const savedPauseOnBlur = localStorage.getItem('pauseOnBlur');
    if (savedPauseOnBlur !== null) {
        pauseOnBlur = savedPauseOnBlur === 'true';
        pauseOnBlurToggle.checked = pauseOnBlur;
        pauseOnBlurLabel.textContent = pauseOnBlur ? 'On' : 'Off';
    }

    // Restore layout mode preference
    const savedLayoutMode = localStorage.getItem('layoutMode');
    if (savedLayoutMode === 'grid' || savedLayoutMode === 'masonry') {
        layoutMode = savedLayoutMode;
        // Update toggle checkbox state
        layoutModeToggle.checked = layoutMode === 'grid';
        layoutModeLabel.textContent = layoutMode === 'grid' ? 'Rigid' : 'Dynamic';
    }
    
    // Restore sorting preferences (will be overridden by tab's preferences in loadTabs)
    const savedSortType = localStorage.getItem('sortType');
    if (savedSortType === 'name' || savedSortType === 'date') {
        sortType = savedSortType;
    } else {
        sortType = 'name'; // Default
    }
    
    const savedSortOrder = localStorage.getItem('sortOrder');
    if (savedSortOrder === 'ascending' || savedSortOrder === 'descending') {
        sortOrder = savedSortOrder;
    } else {
        sortOrder = 'ascending'; // Default
    }
    
    // Note: UI will be updated by switchToTab when tabs are loaded
    
    // Only restore last folder if remembering is enabled
    if (rememberLastFolder) {
        const lastFolderPath = localStorage.getItem('lastFolderPath');
        if (lastFolderPath) {
            showLoadingIndicator();
            try {
                await navigateToFolder(lastFolderPath);
            } catch (error) {
                // Silently fail if the folder no longer exists (don't show alert on startup)
                console.log('Last folder no longer exists:', lastFolderPath);
                localStorage.removeItem('lastFolderPath');
            } finally {
                hideLoadingIndicator();
            }
        }
    }
    
    // Listen for window minimize/restore events to reduce resource usage
    window.electronAPI.onWindowMinimized(() => {
        pauseWhenMinimized();
    });
    
    window.electronAPI.onWindowRestored(() => {
        resumeWhenRestored();
    });
    
    // Also use Page Visibility API as a backup (handles tab switching, etc.)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            pauseWhenMinimized();
        } else {
            resumeWhenRestored();
        }
    });
    
    // Pause thumbnails and freeze GIFs when window loses focus
    window.addEventListener('blur', () => {
        if (isWindowBlurred || isWindowMinimized) return;
        isWindowBlurred = true;
        if (!pauseOnBlur) return;
        if (isNativeDialogOpen) return;
        // Pause all grid videos
        const allVideos = gridContainer.querySelectorAll('video');
        allVideos.forEach(video => {
            video.pause();
        });
        // Freeze animated GIFs by showing static overlay
        const allOverlays = gridContainer.querySelectorAll('.gif-static-overlay');
        allOverlays.forEach(overlay => overlay.classList.add('visible'));
    });

    // Resume thumbnails and unfreeze GIFs when window regains focus
    window.addEventListener('focus', () => {
        if (!isWindowBlurred || isWindowMinimized) return;
        isWindowBlurred = false;
        if (!pauseOnBlur) return;
        // Don't resume grid media if lightbox is open and that pause is active
        if (isLightboxOpen && pauseOnLightbox) return;
        // Resume all grid videos
        const allVideos = gridContainer.querySelectorAll('video');
        allVideos.forEach(video => {
            const playPromise = video.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {});
            }
        });
        // Restore animated GIFs by hiding static overlay
        const allOverlays = gridContainer.querySelectorAll('.gif-static-overlay');
        allOverlays.forEach(overlay => overlay.classList.remove('visible'));
    });

    // Initialize new features
    initKeyboardShortcuts();
    initTheme();
    initThumbnailQuality();
    initZoom();
    loadFavorites();
    loadRecentFiles();
    loadRatings();
    await initSidebar(); // Must be before loadTabs so sidebar is ready for highlight/expand
    loadTabs(); // This will handle tab restoration and navigation
    initVideoScrubber();
    initNewFeatures();
    
    // If no tab has a path and we have a last folder, navigate to it
    const activeTab = tabs.find(t => t.id === activeTabId);

    // Expand sidebar to match whichever folder is now active after tab restore
    if (currentFolderPath) {
        sidebarExpandToPath(currentFolderPath);
    }

    if ((!activeTab || !activeTab.path) && rememberLastFolder) {
        const lastFolderPath = localStorage.getItem('lastFolderPath');
        if (lastFolderPath) {
            try {
                const skipStats = sortType === 'name';
                const items = await window.electronAPI.scanFolder(lastFolderPath, { skipStats });
                if (activeTab) {
                    activeTab.path = lastFolderPath;
                    activeTab.name = lastFolderPath.split(/[/\\]/).pop();
                    saveTabs();
                    renderTabs();
                }
                await navigateToFolder(lastFolderPath);
                // Expand sidebar tree to match restored folder
                sidebarExpandToPath(lastFolderPath);
            } catch (error) {
                console.log('Last folder no longer exists:', lastFolderPath);
                localStorage.removeItem('lastFolderPath');
            }
        }
    }

    // Initialize status bar with current state
    updateStatusBar();
});
