
// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION CONSTANTS
// User-configurable values are `let` and hydrated from localStorage below.
// ═══════════════════════════════════════════════════════════════════════════

// Media Loading Configuration
let MAX_VIDEOS = 120; // Max concurrent videos
let MAX_IMAGES = 120; // Max concurrent images
let PARALLEL_LOAD_LIMIT = 10; // Load up to N items in parallel for faster initial load
let PRELOAD_BUFFER_PX = 1000; // Preload content N pixels before it enters viewport
const MIN_MEDIA_VIEWPORT_BUFFER_PX = 240; // Keep a small warm zone around the grid viewport
const MAX_MEDIA_VIEWPORT_BUFFER_RATIO = 0.5; // Cap warm zone at half a viewport to avoid over-keeping media alive

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
const CARD_RECT_CACHE_TTL = 34; // Short-lived rect cache for hot scroll/cleanup paths
let IMAGE_THUMBNAIL_MAX_EDGE = 768; // Cap cached image thumbs to a practical grid size
const BACKGROUND_DIMENSION_SCAN_CHUNK_SIZE = 2000; // Larger chunks = fewer layout recalculations

// Progressive Rendering Configuration
let PROGRESSIVE_RENDER_THRESHOLD = 1000; // Use progressive rendering for N+ items
const PROGRESSIVE_RENDER_CHUNK_SIZE = 50; // Render N items per frame
const PROGRESSIVE_RENDER_INITIAL_CHUNK = 100; // Render first N items immediately

// Scroll & Observer Configuration
let SCROLL_DEBOUNCE_MS = 150; // Debounce cleanup after scroll stops (ms)
const OBSERVER_CLEANUP_THROTTLE_MS = 300; // Throttle IntersectionObserver cleanup — safety net only, processEntries handles per-card cleanup directly

// Retry Configuration
let MAX_RETRY_ATTEMPTS = 5; // Maximum number of retry attempts per card
let RETRY_INITIAL_DELAY_MS = 500; // Initial retry delay (ms)
const RETRY_BACKOFF_MULTIPLIER = 2; // Exponential backoff multiplier
let RETRY_MAX_DELAY_MS = 5000; // Maximum delay between retries (ms)

// Cache Configuration
let FOLDER_CACHE_TTL = 30000; // Tab cache TTL (30 seconds)
const GLOBAL_CACHE_TTL = 60000; // Global folder cache TTL (60 seconds)
let INDEXEDDB_CACHE_TTL = 3600000; // IndexedDB persistent cache TTL (1 hour)

// IndexedDB Configuration
const DB_NAME = 'ThumbnailAnimatorCache';
const DB_VERSION = 5;
const STORE_NAME = 'folderCache';
const DIMENSIONS_STORE = 'dimensionCache';
const GIF_DURATION_STORE = 'gifDurationCache';
const EMBEDDING_STORE = 'embeddingCache';
const EMBEDDING_VERSION = 'v2'; // bump when embedding method changes (invalidates cached embeddings)
const COLLECTIONS_STORE = 'collections';
const COLLECTION_FILES_STORE = 'collectionFiles';

// Cache Size Limits
const PX_CACHE_MAX_SIZE = 4096;           // Max entries in the px() string cache
const LB_HISTORY_MAX_SIZE = 200;          // Max lightbox history entries
const NORMALIZE_CACHE_MAX_SIZE = 20000;   // Max entries in path-normalise cache
const FOLDER_PREVIEW_CACHE_MAX_SIZE = 200;// Max folder preview cache entries

// File Size Thresholds
const GIF_MAX_FILE_SIZE = 104857600;      // 100 MB — skip GIF duration parsing above this

// Virtual scroll tuning (configurable)
let VS_BUFFER_PX = 1200; // Buffer zone for rendering cards ahead of viewport
let VS_MAX_POOL_SIZE = 150; // Max recycled cards to keep

// Layout tuning (configurable)
let gridGapSetting = 12; // Grid gap in px (CSS --gap)
let minCardWidthSetting = 220; // Minimum card width in px
let cardAspectRatioSetting = '16:9'; // Default card aspect ratio

// Animation tuning (configurable)
let animationSpeedSetting = 'normal'; // off, fast, normal, relaxed, slow
let reduceMotionSetting = false;

// Lightbox tuning
let lightboxMaxZoomSetting = 500;
let lightboxViewportSetting = 90; // % of viewport
let blowUpDelaySetting = 250; // ms hold delay

// Slideshow default
let defaultSlideshowSpeed = 3000;

// Database / history limits
let recentFilesLimitSetting = 50;
let maxUndoHistorySetting = 30;
let tagSuggestionsLimitSetting = 10;
let searchHistoryLimitSetting = 10;

// Sidebar limits
let sidebarMinWidthSetting = 180;
let sidebarMaxWidthSetting = 500;

// Folder preview
let folderPreviewCountSetting = 4;
let folderPreviewSizeSetting = 192;

// ── Hydrate configurable constants from localStorage ──
(function hydrateSettings() {
    const _int = (key, fallback) => { const v = localStorage.getItem(key); return v !== null ? parseInt(v, 10) : fallback; };
    const _str = (key, fallback) => localStorage.getItem(key) || fallback;
    const _bool = (key, fallback) => { const v = localStorage.getItem(key); return v !== null ? v === 'true' : fallback; };

    // Performance profile
    const profile = _str('perfProfile', 'medium');
    if (profile === 'low') {
        MAX_VIDEOS = 60; MAX_IMAGES = 60; PARALLEL_LOAD_LIMIT = 5;
        VS_BUFFER_PX = 600; VS_MAX_POOL_SIZE = 75;
    } else if (profile === 'high') {
        MAX_VIDEOS = 200; MAX_IMAGES = 200; PARALLEL_LOAD_LIMIT = 20;
        VS_BUFFER_PX = 2000; VS_MAX_POOL_SIZE = 250;
    } else if (profile === 'custom') {
        const maxMedia = _int('maxMedia', 120);
        MAX_VIDEOS = maxMedia; MAX_IMAGES = maxMedia;
        PARALLEL_LOAD_LIMIT = _int('parallelLoad', 10);
        VS_BUFFER_PX = _int('vsBuffer', 1200);
        VS_MAX_POOL_SIZE = _int('vsPoolSize', 150);
        SCROLL_DEBOUNCE_MS = _int('scrollDebounce', 150);
        PROGRESSIVE_RENDER_THRESHOLD = _int('progressiveThreshold', 1000);
    }
    // Individual overrides (always apply even for presets if explicitly set)
    IMAGE_THUMBNAIL_MAX_EDGE = _int('imageThumbMaxEdge', IMAGE_THUMBNAIL_MAX_EDGE);

    // Cache TTLs
    FOLDER_CACHE_TTL = _int('folderCacheTTL', FOLDER_CACHE_TTL);
    INDEXEDDB_CACHE_TTL = _int('idbCacheTTL', INDEXEDDB_CACHE_TTL);

    // Retry
    MAX_RETRY_ATTEMPTS = _int('retryAttempts', MAX_RETRY_ATTEMPTS);
    RETRY_INITIAL_DELAY_MS = _int('retryInitialDelay', RETRY_INITIAL_DELAY_MS);
    RETRY_MAX_DELAY_MS = _int('retryMaxDelay', RETRY_MAX_DELAY_MS);

    // Layout
    gridGapSetting = _int('gridGap', 12);
    minCardWidthSetting = _int('minCardWidth', 220);
    cardAspectRatioSetting = _str('cardAspectRatio', '16:9');

    // Animation
    animationSpeedSetting = _str('animationSpeed', 'normal');
    reduceMotionSetting = _bool('reduceMotion', false);

    // Lightbox
    lightboxMaxZoomSetting = _int('lightboxMaxZoom', 500);
    lightboxViewportSetting = _int('lightboxViewport', 90);
    blowUpDelaySetting = _int('blowUpDelay', 250);

    // Slideshow
    defaultSlideshowSpeed = _int('defaultSlideshowSpeed', 3000);

    // Database / history
    recentFilesLimitSetting = _int('recentFilesLimit', 50);
    maxUndoHistorySetting = _int('maxUndoHistory', 30);
    tagSuggestionsLimitSetting = _int('tagSuggestionsLimit', 10);
    searchHistoryLimitSetting = _int('searchHistoryLimit', 10);

    // Sidebar
    sidebarMinWidthSetting = _int('sidebarMinWidth', 180);
    sidebarMaxWidthSetting = _int('sidebarMaxWidth', 500);

    // Folder preview
    folderPreviewCountSetting = _int('folderPreviewCount', 4);
    folderPreviewSizeSetting = _int('folderPreviewSize', 192);
})();

// Derived after hydration
let MAX_TOTAL_MEDIA = MAX_VIDEOS + MAX_IMAGES;




// ═══════════════════════════════════════════════════════════════════════════
// VIRTUAL SCROLLING ENGINE
// Only renders DOM cards that are visible + buffer zone.
// For 10,000 items, only ~50-100 cards exist in the DOM at any time.
// ═══════════════════════════════════════════════════════════════════════════

// Virtual scrolling state
const vsState = {
    enabled: false,             // Whether virtual scrolling is active for current render
    sortedItems: [],            // Items array (sorted/filtered) backing current virtual scroll
    positions: null,            // Float64Array: [left0, top0, width0, height0, left1, ...]
    totalHeight: 0,             // Total computed height of all content
    activeCards: new Map(),     // Map<itemIndex, HTMLElement> - currently rendered cards
    recyclePool: [],            // Pool of detached card DOM nodes for reuse
    // VS_MAX_POOL_SIZE and VS_BUFFER_PX are defined and hydrated in the config block above
    scrollRafId: null,          // RAF ID for scroll handler coalescing
    lastStartIndex: -1,         // Last rendered range start
    lastEndIndex: -1,           // Last rendered range end
    lastScrollCleanupTime: 0,   // Throttle timestamp for proactive media loading during scroll
    spacer: null,               // Spacer element that sets total scroll height
    resizeHandler: null,        // Window resize handler
    dimensionRecalcRafId: null, // RAF ID for coalescing metadata-triggered recalcs
    tagGeneration: 0,           // Incremented on each vsUpdateDOM to cancel stale tag fetches
    groupHeadersPresent: false, // True when date group headers are in vsState.sortedItems
    aspectRatioMap: null,       // Lookup from ASPECT_RATIOS name to ratio value (built lazily)
    // Masonry layout cache for incremental updates
    layoutCache: {
        itemCount: 0,
        containerWidth: 0,
        mode: null,
        zoom: 0,
        columns: 0,
        columnWidth: 0,
        gap: 0,
        positions: null,
        totalHeight: 0,
        colHeights: null,       // Float64Array of column heights (for incremental updates)
        columnAssignments: null  // Uint16Array: which column each item was placed in
    }
};

// Cache of "Npx" strings to avoid template-literal allocations in hot scroll paths.
// Positions round to integers for cache stability; cards only paint to pixel boundaries
// anyway. Cache is bounded — scrolled grids reuse a few hundred integer positions.
const _pxCache = new Map();
function px(n) {
    const k = n | 0; // truncate float to int (fast, 32-bit safe for our sizes)
    let s = _pxCache.get(k);
    if (s === undefined) {
        s = k + 'px';
        _pxCache.set(k, s);
        if (_pxCache.size > PX_CACHE_MAX_SIZE) _pxCache.clear(); // bound memory
    }
    return s;
}

// Pre-built star rating templates for fast cloning (built lazily on first use)
let _starTemplateUnrated = null; // 0-star template
let _starTemplateCache = new Map(); // rating -> cloneable container

function _buildStarContainer(rating) {
    const container = document.createElement('div');
    container.className = rating > 0 ? 'star-rating has-rating' : 'star-rating';
    container.style.pointerEvents = 'auto';
    const emptySvg = icon('star', 16);
    const filledSvg = rating > 0 ? iconFilled('star', 16, 'var(--warning)') : null;
    for (let s = 1; s <= 5; s++) {
        const filled = rating > 0 && s <= rating;
        const star = document.createElement('span');
        star.className = filled ? 'star active' : 'star';
        star.innerHTML = filled ? filledSvg : emptySvg;
        star.style.pointerEvents = 'auto';
        star.style.cursor = 'pointer';
        container.appendChild(star);
    }
    return container;
}

function getStarRatingElement(rating) {
    if (rating === 0) {
        if (!_starTemplateUnrated) _starTemplateUnrated = _buildStarContainer(0);
        return _starTemplateUnrated.cloneNode(true);
    }
    if (!_starTemplateCache.has(rating)) {
        _starTemplateCache.set(rating, _buildStarContainer(rating));
    }
    return _starTemplateCache.get(rating).cloneNode(true);
}

// Build a lookup from ASPECT_RATIOS name to ratio value for fast access
// (ASPECT_RATIOS is defined later, so we build this lazily)
function vsGetAspectRatioValue(name) {
    if (!vsState.aspectRatioMap) {
        vsState.aspectRatioMap = new Map();
        // ASPECT_RATIOS is defined at line ~1617
        if (typeof ASPECT_RATIOS !== 'undefined') {
            for (const ar of ASPECT_RATIOS) {
                vsState.aspectRatioMap.set(ar.name, ar.ratio);
            }
        }
    }
    return vsState.aspectRatioMap.get(name) || (16 / 9);
}

/**
 * Pre-calculate all card positions without touching the DOM.
 * Returns { positions: Float64Array, totalHeight: number }
 *
 * Memoization strategy:
 *  - If only zoom changed and column count is unchanged, scale positions proportionally (O(n) memcpy, no layout logic)
 *  - If container width changed but column count stayed the same, scale widths proportionally
 *  - Full recalculation only when column count, item count, mode, or items change
 */
// Cached computed style values for vsCalculatePositions — invalidated alongside masonry style cache
let cachedVsStyles = null;
function invalidateVsStyleCache() { cachedVsStyles = null; }
function getVsStyles() {
    if (cachedVsStyles) return cachedVsStyles;
    const rootStyles = getComputedStyle(document.documentElement);
    const gridStyles = getComputedStyle(gridContainer);
    cachedVsStyles = {
        gap: (() => { const v = parseInt(rootStyles.getPropertyValue('--gap')); return isNaN(v) ? 16 : v; })(),
        paddingLeft: parseInt(gridStyles.paddingLeft) || 0,
        paddingTop: parseInt(gridStyles.paddingTop) || 0,
        paddingBottom: parseInt(gridStyles.paddingBottom) || 0,
    };
    return cachedVsStyles;
}

function vsCalculatePositions(items, containerWidth, mode, zoom) {
    const perfStart = perfTest.start();

    const { gap, paddingLeft, paddingTop, paddingBottom } = getVsStyles();
    const availableWidth = containerWidth - (paddingLeft * 2);

    // Calculate what the column count would be for this zoom/width/mode
    let newColumns, newColumnWidth;
    if (mode === 'masonry') {
        const baseMinWidth = Math.max(minCardWidthSetting, 120); // Use configurable minimum
        const minColumnWidth = baseMinWidth * (zoom / 100);
        newColumns = Math.max(1, Math.floor((availableWidth + gap) / (minColumnWidth + gap)));
        newColumnWidth = (availableWidth - gap * (newColumns - 1)) / newColumns;
    } else {
        const baseMinWidth = Math.max(minCardWidthSetting, 120); // Use configurable minimum
        const gridMinWidth = baseMinWidth * (zoom / 100);
        newColumns = Math.max(1, Math.floor((availableWidth + gap) / (gridMinWidth + gap)));
        newColumnWidth = (availableWidth - gap * (newColumns - 1)) / newColumns;
    }

    // --- Fast path: scale existing positions when column count and items haven't changed ---
    // Disable fast path when group headers are present (their height is fixed, not scalable)
    const cache = vsState.layoutCache;
    if (
        cache.positions &&
        cache.itemCount === items.length &&
        cache.mode === mode &&
        cache.columns === newColumns &&
        items.length > 0 &&
        !vsState.groupHeadersPresent
    ) {
        // Column count unchanged -- scale all positions proportionally
        const scaleX = newColumnWidth / cache.columnWidth;
        const scaleY = newColumnWidth / cache.columnWidth; // heights scale with width (aspect ratio preserved)
        const scaleGap = gap / cache.gap;
        const positions = new Float64Array(items.length * 4);

        if (mode === 'masonry') {
            // For masonry, we need to rescale left, top, width, height
            // left = col * (columnWidth + gap), so it scales with (columnWidth + gap) / (oldColumnWidth + oldGap)
            const oldColStep = cache.columnWidth + cache.gap;
            const newColStep = newColumnWidth + gap;
            const stepScale = oldColStep > 0 ? newColStep / oldColStep : 1;

            for (let i = 0; i < items.length; i++) {
                const idx = i * 4;
                // Scale left by column step ratio
                positions[idx] = cache.positions[idx] * stepScale;
                // Scale top and height proportionally
                positions[idx + 1] = cache.positions[idx + 1] * scaleY;
                positions[idx + 2] = newColumnWidth;
                positions[idx + 3] = cache.positions[idx + 3] * scaleY;
            }

            const newTotalHeight = cache.totalHeight * scaleY;

            // Update cache
            cache.containerWidth = containerWidth;
            cache.zoom = zoom;
            cache.columnWidth = newColumnWidth;
            cache.gap = gap;
            cache.positions = positions;
            cache.totalHeight = newTotalHeight;

            perfTest.end('vsCalculatePositions', perfStart, { itemCount: items.length, detail: `${mode} @ ${zoom}% (scaled)` });
            return { positions, totalHeight: newTotalHeight };
        } else {
            // Grid: same logic
            const oldColStep = cache.columnWidth + cache.gap;
            const newColStep = newColumnWidth + gap;
            const stepScale = oldColStep > 0 ? newColStep / oldColStep : 1;

            for (let i = 0; i < items.length; i++) {
                const idx = i * 4;
                positions[idx] = cache.positions[idx] * stepScale;
                positions[idx + 1] = cache.positions[idx + 1] * scaleY;
                positions[idx + 2] = newColumnWidth;
                positions[idx + 3] = cache.positions[idx + 3] * scaleY;
            }

            const newTotalHeight = cache.totalHeight * scaleY;
            cache.containerWidth = containerWidth;
            cache.zoom = zoom;
            cache.columnWidth = newColumnWidth;
            cache.gap = gap;
            cache.positions = positions;
            cache.totalHeight = newTotalHeight;

            perfTest.end('vsCalculatePositions', perfStart, { itemCount: items.length, detail: `${mode} @ ${zoom}% (scaled)` });
            return { positions, totalHeight: newTotalHeight };
        }
    }

    // --- Full recalculation path ---
    const positions = new Float64Array(items.length * 4);

    if (mode === 'masonry') {
        const columns = newColumns;
        const columnWidth = newColumnWidth;
        const colHeights = new Float64Array(columns);
        const columnAssignments = new Uint16Array(items.length);

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            let cardHeight;

            if (item.type === 'group-header') {
                // Span full width; place at the max column height
                let maxColH = 0;
                for (let c = 0; c < columns; c++) {
                    if (colHeights[c] > maxColH) maxColH = colHeights[c];
                }
                const hTop = maxColH > 0 ? maxColH : 0;
                const hHeight = 42;
                const hidx = i * 4;
                positions[hidx]     = 0;
                positions[hidx + 1] = hTop;
                positions[hidx + 2] = containerWidth;
                positions[hidx + 3] = hHeight;
                columnAssignments[i] = 0;
                for (let c = 0; c < columns; c++) colHeights[c] = hTop + hHeight + gap;
                continue;
            }

            if (item.type === 'folder') {
                cardHeight = columnWidth;
            } else {
                let arName = '16:9';
                if (item.width && item.height) {
                    arName = getClosestAspectRatio(item.width, item.height);
                }
                const arValue = vsGetAspectRatioValue(arName);
                cardHeight = columnWidth / arValue;
                if (!cardHeight || cardHeight <= 0 || !isFinite(cardHeight)) {
                    cardHeight = columnWidth / (16 / 9);
                }
            }
            if (cardHeight < 50) cardHeight = 50;

            // Find shortest column
            let shortestCol = 0;
            let shortestHeight = colHeights[0];
            for (let c = 1; c < columns; c++) {
                if (colHeights[c] < shortestHeight) {
                    shortestHeight = colHeights[c];
                    shortestCol = c;
                }
            }

            const left = shortestCol * (columnWidth + gap);
            const top = colHeights[shortestCol];

            const idx = i * 4;
            positions[idx] = left;
            positions[idx + 1] = top;
            positions[idx + 2] = columnWidth;
            positions[idx + 3] = cardHeight;

            columnAssignments[i] = shortestCol;
            colHeights[shortestCol] += cardHeight + gap;
        }

        let maxHeight = 0;
        for (let c = 0; c < columns; c++) {
            if (colHeights[c] > maxHeight) maxHeight = colHeights[c];
        }
        const totalHeight = maxHeight + paddingTop + paddingBottom;

        // Update cache
        vsState.layoutCache = {
            itemCount: items.length,
            containerWidth,
            mode,
            zoom,
            columns,
            columnWidth,
            gap,
            positions,
            totalHeight,
            colHeights,
            columnAssignments
        };

        perfTest.end('vsCalculatePositions', perfStart, { itemCount: items.length, detail: `${mode} @ ${zoom}% (full)` });
        return { positions, totalHeight };

    } else {
        // Grid mode
        const columns = newColumns;
        const columnWidth = newColumnWidth;
        let currentCol = 0;
        let rowTop = 0;
        let rowMaxHeight = 0;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            let cardHeight;

            if (item.type === 'group-header') {
                // Finish current row if mid-row, then place header at full width
                if (currentCol > 0) {
                    rowTop += rowMaxHeight + gap;
                    rowMaxHeight = 0;
                    currentCol = 0;
                }
                const hHeight = 42;
                const hidx = i * 4;
                positions[hidx]     = 0;
                positions[hidx + 1] = rowTop;
                positions[hidx + 2] = containerWidth;
                positions[hidx + 3] = hHeight;
                rowTop += hHeight + gap;
                rowMaxHeight = 0;
                continue;
            }

            if (item.type === 'folder') {
                cardHeight = columnWidth;
            } else {
                let arName = '16:9';
                if (item.width && item.height) {
                    arName = getClosestAspectRatio(item.width, item.height);
                }
                const arValue = vsGetAspectRatioValue(arName);
                cardHeight = columnWidth / arValue;
                if (!cardHeight || cardHeight <= 0 || !isFinite(cardHeight)) {
                    cardHeight = columnWidth / (16 / 9);
                }
            }
            if (cardHeight < 50) cardHeight = 50;

            const left = currentCol * (columnWidth + gap);

            const idx = i * 4;
            positions[idx] = left;
            positions[idx + 1] = rowTop;
            positions[idx + 2] = columnWidth;
            positions[idx + 3] = cardHeight;

            if (cardHeight > rowMaxHeight) rowMaxHeight = cardHeight;

            currentCol++;
            if (currentCol >= columns) {
                rowTop += rowMaxHeight + gap;
                rowMaxHeight = 0;
                currentCol = 0;
            }
        }

        const totalHeight = rowTop + (currentCol > 0 ? rowMaxHeight : 0) + paddingTop + paddingBottom;

        // Update cache
        vsState.layoutCache = {
            itemCount: items.length,
            containerWidth,
            mode,
            zoom,
            columns,
            columnWidth,
            gap,
            positions,
            totalHeight,
            colHeights: null,
            columnAssignments: null
        };

        perfTest.end('vsCalculatePositions', perfStart, { itemCount: items.length, detail: `${mode} @ ${zoom}% (full)` });
        return { positions, totalHeight };
    }
}

/**
 * Binary search to find the range of items visible at current scroll position.
 * Returns { startIndex, endIndex } (endIndex is exclusive).
 */
// Module-level scratch vars set by vsGetVisibleRange. The hot RAF scroll path reads
// these directly to avoid allocating a {startIndex, endIndex} object per frame.
let _vsVisibleStartIndex = 0;
let _vsVisibleEndIndex = 0;

function vsGetVisibleRange(scrollTop, viewportHeight) {
    const positions = vsState.positions;
    const itemCount = vsState.sortedItems.length;
    if (!positions || itemCount === 0) {
        _vsVisibleStartIndex = 0;
        _vsVisibleEndIndex = 0;
        return { startIndex: 0, endIndex: 0 };
    }

    const visibleTop = scrollTop - VS_BUFFER_PX;
    const visibleBottom = scrollTop + viewportHeight + VS_BUFFER_PX;

    // Find startIndex: first item whose bottom edge (top + height) > visibleTop
    // Binary search for both start and end — O(log n) instead of O(n) per scroll frame
    let startIndex = 0;
    {
        let lo = 0, hi = itemCount - 1;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            const idx = mid * 4;
            if (positions[idx + 1] + positions[idx + 3] < visibleTop) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        startIndex = lo;
    }

    // Find endIndex: first item whose top > visibleBottom (binary search)
    let endIndex = itemCount;
    {
        let elo = startIndex, ehi = itemCount - 1;
        while (elo < ehi) {
            const mid = (elo + ehi) >>> 1;
            const idx = mid * 4;
            if (positions[idx + 1] <= visibleBottom) {
                elo = mid + 1;
            } else {
                ehi = mid;
            }
        }
        if (elo < itemCount && positions[elo * 4 + 1] > visibleBottom) {
            endIndex = elo;
        }
    }

    _vsVisibleStartIndex = startIndex;
    _vsVisibleEndIndex = endIndex;
    return { startIndex, endIndex };
}

/**
 * Create/recycle/remove card DOM nodes to match the visible range.
 */
function vsUpdateDOM(startIndex, endIndex) {
    if (!vsState.enabled) return;
    // Canvas grid owns rendering when enabled — skip DOM card recycling.
    if (window.CG && window.CG.isEnabled()) {
        window.CG.scheduleRender();
        return;
    }

    // Hoist hot-path state refs to locals for fast access
    const activeCards = vsState.activeCards;
    const recyclePool = vsState.recyclePool;
    const positions = vsState.positions;
    const sortedItems = vsState.sortedItems;

    // Remove cards outside visible range
    for (const [itemIdx, card] of activeCards) {
        if (itemIdx < startIndex || itemIdx >= endIndex) {
            // Clean up media using cached reference (avoids querySelectorAll)
            if (card._mediaEl) {
                if (card._mediaEl.tagName === 'VIDEO') {
                    destroyVideoElement(card._mediaEl);
                    activeVideoCount = Math.max(0, activeVideoCount - 1);
                } else {
                    destroyImageElement(card._mediaEl);
                    activeImageCount = Math.max(0, activeImageCount - 1);
                }
                card._mediaEl = null;
            } else if (card.dataset.hasMedia) {
                // Fallback for cards without cached ref
                const videos = card.querySelectorAll('video');
                const images = card.querySelectorAll('img.media-thumbnail');
                videos.forEach(video => {
                    destroyVideoElement(video);
                    activeVideoCount = Math.max(0, activeVideoCount - 1);
                });
                images.forEach(img => {
                    destroyImageElement(img);
                    activeImageCount = Math.max(0, activeImageCount - 1);
                });
            }
            pendingMediaCreations.delete(card);
            mediaToRetry.delete(card);

            observer.unobserve(card);
            card.remove();
            activeCards.delete(itemIdx);

            // Add to recycle pool
            if (recyclePool.length < VS_MAX_POOL_SIZE) {
                recyclePool.push(card);
            }
        }
    }

    // Add cards for newly visible items
    const fragment = document.createDocumentFragment();
    const newCards = [];

    for (let i = startIndex; i < endIndex; i++) {
        if (activeCards.has(i)) {
            // Card already exists, just update position if needed
            const card = activeCards.get(i);
            const idx = i * 4;
            const newLeft = positions[idx];
            const newTop = positions[idx + 1];
            const newWidth = positions[idx + 2];
            const newHeight = positions[idx + 3];
            // Update position (compositor-only) and size (layout) independently
            // so that pure scroll-position updates skip layout work entirely.
            if (card._vsLeft !== newLeft || card._vsTop !== newTop) {
                card.style.translate = px(newLeft) + ' ' + px(newTop);
                card._vsLeft = newLeft;
                card._vsTop = newTop;
            }
            if (card._vsWidth !== newWidth || card._vsHeight !== newHeight) {
                card.style.width = px(newWidth);
                card.style.height = px(newHeight);
                card._vsWidth = newWidth;
                card._vsHeight = newHeight;
            }
            continue;
        }

        const item = sortedItems[i];
        const idx = i * 4;
        const left = positions[idx];
        const top = positions[idx + 1];
        const width = positions[idx + 2];
        const height = positions[idx + 3];

        // Try to recycle a card
        let card = recyclePool.pop();
        if (card) {
            // Reset the recycled card
            vsResetCard(card);
        }

        // Populate card with item data
        const { card: newCard, isMedia } = card
            ? vsPopulateExistingCard(card, item)
            : createCardFromItem(item, true);

        if (!card) {
            card = newCard;
        }

        // Position absolutely; translate is compositor-only, width/height trigger layout
        card.style.position = 'absolute';
        card.style.translate = px(left) + ' ' + px(top);
        card.style.width = px(width);
        card.style.height = px(height);
        card.style.paddingBottom = '0';
        card.style.opacity = '1';
        card.style.visibility = 'visible';
        card._vsLeft = left;
        card._vsTop = top;
        card._vsWidth = width;
        card._vsHeight = height;
        card._vsItemIndex = i;

        // Restore selection state across virtual scroll recycling
        if (item.path && selectedCardPaths.has(item.path)) {
            card.classList.add('selected');
        }

        activeCards.set(i, card);
        fragment.appendChild(card);

        if (isMedia) {
            newCards.push(card);
            videoCards.add(card);
        } else if (card.classList.contains('folder-card')) {
            newCards.push(card); // observe for folder preview loading
        }
    }

    if (fragment.childNodes.length > 0) {
        gridContainer.appendChild(fragment);

        // Register new cards with IntersectionObserver for media loading
        requestAnimationFrame(() => {
            newCards.forEach(card => observer.observe(card));
        });

        // Update tag badges on newly added cards
        if (typeof updateCardTagBadges === 'function') {
            const needTagPaths = [];
            const tagCards = [];
            for (let i = startIndex; i < endIndex; i++) {
                const card = activeCards.get(i);
                if (card && card.classList.contains('video-card') && card.dataset.path) {
                    const np = normalizePath(card.dataset.path);
                    if (!fileTagsCache.has(np)) {
                        needTagPaths.push(np);
                    }
                    tagCards.push(card);
                }
            }
            if (needTagPaths.length > 0) {
                const gen = ++vsState.tagGeneration;
                warmFileTagsCache(needTagPaths).then(() => {
                    if (gen !== vsState.tagGeneration) return; // stale scroll
                    tagCards.forEach(c => {
                        if (c.dataset.path) updateCardTagBadges(c);
                    });
                }).catch(err => console.warn('warmFileTagsCache (vs):', err));
            } else {
                tagCards.forEach(c => updateCardTagBadges(c));
            }
        }
    }

    vsState.lastStartIndex = startIndex;
    vsState.lastEndIndex = endIndex;
}

/**
 * Reset a recycled card to a blank state.
 */
function vsResetCard(card) {
    // Remove hover upgrade listeners before clearing children
    if (card._hoverEnter) {
        card.removeEventListener('mouseenter', card._hoverEnter);
        card.removeEventListener('mouseleave', card._hoverLeave);
        delete card._hoverEnter;
        delete card._hoverLeave;
    }

    // Revoke any GIF overlay blob URLs before removing children
    const overlay = card.querySelector('.gif-static-overlay');
    if (overlay && overlay._blobUrl) URL.revokeObjectURL(overlay._blobUrl);

    // Remove all children
    while (card.firstChild) card.removeChild(card.firstChild);

    // Clear dataset
    const dataset = card.dataset;
    for (const key in dataset) delete dataset[key];

    // Reset classes
    card.className = '';

    // Clear custom properties
    card._mediaEl = null;
    delete card._vsLeft;
    delete card._vsTop;
    delete card._vsWidth;
    delete card._vsHeight;
    delete card._vsItemIndex;
}

/**
 * Populate an existing (recycled) card with new item data.
 * Returns { card, isMedia } matching createCardFromItem's interface.
 */
function vsPopulateExistingCard(card, item) {
    if (window.CG && window.CG.isEnabled()) return { card, isMedia: false };
    if (item.type === 'group-header') {
        card.className = 'date-group-header';
        card.dataset.groupKey = item.groupKey;
        const toggleEl = document.createElement('button');
        toggleEl.className = 'dgh-toggle';
        toggleEl.textContent = collapsedDateGroups.has(item.groupKey) ? '▶' : '▼';
        const labelEl = document.createElement('span');
        labelEl.className = 'dgh-label';
        labelEl.textContent = item.label;
        const countEl = document.createElement('span');
        countEl.className = 'dgh-count';
        countEl.textContent = String(item.count);
        card.appendChild(toggleEl);
        card.appendChild(labelEl);
        card.appendChild(countEl);
        // Click handled by gridContainer delegation (see below)
        return { card, isMedia: false };
    }
    if (item.type === 'folder') {
        card.className = 'folder-card';
        card.dataset.folderPath = item.path;
        card.dataset.searchText = item.name.toLowerCase();
        card.setAttribute('role', 'gridcell');
        card.setAttribute('aria-label', `Folder: ${item.name}`);
        card.setAttribute('tabindex', '-1');

        const folderIcon = document.createElement('div');
        folderIcon.className = 'folder-icon';
        folderIcon.innerHTML = icon('folder', 48);

        const info = document.createElement('div');
        info.className = 'folder-info';
        info.textContent = item.name;

        card.appendChild(folderIcon);
        card.appendChild(info);
        syncPinIndicator(card, item.path);

        return { card, isMedia: false };
    } else {
        card.className = 'video-card';
        card.dataset.src = item.url;
        card.dataset.path = item.path;
        card.dataset.name = item.name;
        card.dataset.searchText = item.name.toLowerCase();
        card.dataset.mediaType = item.type;
        card.setAttribute('role', 'gridcell');
        card.setAttribute('aria-label', `${item.type === 'video' ? 'Video' : 'Image'}: ${item.name}`);
        card.setAttribute('tabindex', '-1');
        card.dataset.mtime = String(item.mtime || 0);
        if (item.size > 0) card.dataset.fileSize = String(item.size);
        else delete card.dataset.fileSize;

        const lastDot = item.name.lastIndexOf('.');
        const fileExtension = lastDot !== -1 ? item.name.substring(lastDot + 1).toUpperCase() : '';

        const extensionLabel = document.createElement('div');
        extensionLabel.className = 'extension-label';
        extensionLabel.textContent = fileExtension;
        const extensionColor = getExtensionColor(fileExtension);
        extensionLabel.style.backgroundColor = hexToRgba(extensionColor, 0.87);

        // Apply aspect ratio
        if (item.width && item.height) {
            const aspectRatioName = getClosestAspectRatio(item.width, item.height);
            applyAspectRatioToCard(card, aspectRatioName, 'prescanned');
            card.dataset.width = item.width;
            card.dataset.height = item.height;
            createResolutionLabel(card, item.width, item.height);
        } else {
            applyAspectRatioToCard(card, '16:9', 'fallback');
        }

        const info = document.createElement('div');
        info.className = 'video-info';
        setCardFilenameContent(info, item.name);

        card.appendChild(extensionLabel);

        syncStarRatingOnCard(card, item.path);
        syncPinIndicator(card, item.path);
        syncCardMetaRow(card, item, null);
        card.appendChild(info);

        // Show relative path when in recursive search mode
        if (recursiveSearchEnabled && item.relativePath) {
            const dir = item.relativePath.replace(/[\\/][^\\/]*$/, '');
            if (dir && dir !== item.name) {
                const relLabel = document.createElement('div');
                relLabel.className = 'card-relative-path';
                relLabel.textContent = dir;
                relLabel.title = dir;
                card.appendChild(relLabel);
            }
        }

        applyCardInfoVisibility(card);
        applyCardInfoLayoutClasses(card);

        // Apply duplicate highlight if active
        if (typeof applyDuplicateHighlight === 'function') applyDuplicateHighlight(card);

        return { card, isMedia: true };
    }
}

// Scroll velocity tracking for media-loading gate (px/s threshold)
let _vsLastScrollTop = 0;
let _vsLastScrollTime = 0;
const VS_FAST_SCROLL_PX_PER_SEC = 2000;

// Hoisted callbacks to avoid allocating closures every scroll frame.
function _vsScrollRafCallback() {
    vsState.scrollRafId = null;
    invalidateScrollCaches();
    const scrollTop = gridContainer.scrollTop;
    const viewportHeight = gridContainer.clientHeight;
    vsGetVisibleRange(scrollTop, viewportHeight);
    const startIndex = _vsVisibleStartIndex;
    const endIndex = _vsVisibleEndIndex;

    // Only update if range changed
    if (startIndex !== vsState.lastStartIndex || endIndex !== vsState.lastEndIndex) {
        vsUpdateDOM(startIndex, endIndex);
    }

    // Compute scroll velocity; skip media-load safety net during fast scroll
    // to avoid creating thumbnails the user is scrolling past. The scroll-settle
    // debounce below will call vsEnsureVisibleMedia once scrolling stops.
    const now = performance.now();
    const dt = now - _vsLastScrollTime;
    const velocity = dt > 0 ? Math.abs(scrollTop - _vsLastScrollTop) / dt * 1000 : 0;
    _vsLastScrollTop = scrollTop;
    _vsLastScrollTime = now;
    if (velocity < VS_FAST_SCROLL_PX_PER_SEC) {
        // Guarantee every card currently in the viewport has media loading.
        // This bypasses IntersectionObserver entirely — using pre-computed
        // positions from the Float64Array to check visibility in O(active cards).
        vsEnsureVisibleMedia(scrollTop, viewportHeight);
    }
}

function _vsScrollSettleCallback() {
    invalidateScrollCaches();
    runCleanupCycle();
    // Catch up on any visible cards whose media was deferred during fast scroll
    vsEnsureVisibleMedia(gridContainer.scrollTop, gridContainer.clientHeight);
}

/**
 * Handle scroll events for virtual scrolling.
 */
function vsOnScroll() {
    if (!vsState.enabled || isWindowMinimized) return;

    // Canvas grid path: route scroll to canvas renderer, skip DOM recycling entirely
    if (window.CG && window.CG.isEnabled()) {
        window.CG.scheduleRender();
        return;
    }

    if (vsState.scrollRafId) return; // Already scheduled
    vsState.scrollRafId = requestAnimationFrame(_vsScrollRafCallback);

    // Throttle cleanup — run periodically during continuous scroll so that
    // proactiveLoadMedia picks up cards the observer hasn't reached yet
    const now = Date.now();
    if (now - vsState.lastScrollCleanupTime >= OBSERVER_CLEANUP_THROTTLE_MS) {
        vsState.lastScrollCleanupTime = now;
        scheduleCleanupCycle();
    }

    // Debounce cleanup — also run after scrolling settles, not every frame
    clearTimeout(cleanupScrollTimeout);
    cleanupScrollTimeout = setTimeout(_vsScrollSettleCallback, SCROLL_DEBOUNCE_MS);
}

/**
 * Force-load media for any card that is inside the viewport but has no
 * *working* media element (one whose src is actually set).
 * Uses pre-computed vsState.positions (no DOM measurement, no IntersectionObserver).
 */
function vsEnsureVisibleMedia(scrollTop, viewportHeight) {
    const positions = vsState.positions;
    if (!positions) return;
    const visibleTop = scrollTop;
    const visibleBottom = scrollTop + viewportHeight;

    for (const [idx, card] of vsState.activeCards) {
        const posIdx = idx * 4;
        const cardTop = positions[posIdx + 1];
        const cardBottom = cardTop + positions[posIdx + 3];

        // Skip cards outside the actual viewport (no buffer)
        if (cardBottom < visibleTop || cardTop > visibleBottom) continue;

        // Skip non-media cards
        if (!card.classList.contains('video-card')) continue;

        // Skip cards that are actively being created right now
        if (pendingMediaCreations.has(card)) continue;

        const mediaUrl = card.dataset.src;
        if (!mediaUrl) continue;

        // Check if the card has a media element with an actual src set.
        const el = card._mediaEl;
        if (el && el.src) continue; // media element exists with src — all good

        // Card is visible with no working media — tear down stale state and reload
        if (el) {
            if (el.tagName === 'VIDEO') {
                destroyVideoElement(el);
                activeVideoCount = Math.max(0, activeVideoCount - 1);
            } else {
                destroyImageElement(el);
                activeImageCount = Math.max(0, activeImageCount - 1);
            }
            card._mediaEl = null;
        }
        delete card.dataset.hasMedia;
        mediaToRetry.delete(card);
        createMediaForCard(card, mediaUrl);
    }
}

/**
 * Initialize virtual scrolling for the current items.
 */
function vsInit(items) {
    vsCleanup(); // Clean up any previous virtual scroll state

    vsState.sortedItems = items;
    vsState.enabled = true;
    vsState.activeCards = new Map();
    vsState.recyclePool = [];
    vsState.lastStartIndex = -1;
    vsState.lastEndIndex = -1;
    vsState.aspectRatioMap = null; // Rebuild on next access

    // Calculate positions
    const containerWidth = gridContainer.clientWidth;
    const result = vsCalculatePositions(items, containerWidth, layoutMode, zoomLevel);
    vsState.positions = result.positions;
    vsState.totalHeight = result.totalHeight;

    // Notify canvas grid that the items + positions changed
    if (window.CG) window.CG.invalidateData();

    // Set up container for absolute positioning
    gridContainer.classList.add('masonry'); // Always use block+absolute for virtual scroll
    gridContainer.classList.remove('grid');

    // Create spacer for total height
    vsState.spacer = document.createElement('div');
    vsState.spacer.className = 'masonry-spacer vs-spacer';
    vsState.spacer.style.width = '1px';
    vsState.spacer.style.height = `${vsState.totalHeight}px`;
    vsState.spacer.style.position = 'static';
    vsState.spacer.style.pointerEvents = 'none';
    vsState.spacer.style.visibility = 'hidden';
    vsState.spacer.style.margin = '0';
    vsState.spacer.style.padding = '0';
    gridContainer.appendChild(vsState.spacer);

    // Initial render
    const scrollTop = gridContainer.scrollTop;
    const viewportHeight = gridContainer.clientHeight;
    const { startIndex, endIndex } = vsGetVisibleRange(scrollTop, viewportHeight);
    vsUpdateDOM(startIndex, endIndex);

    // Attach scroll listener
    gridContainer.addEventListener('scroll', vsOnScroll, { passive: true });

    // Attach resize handler
    vsState.resizeHandler = () => {
        cachedViewportBounds = null;
        viewportBoundsCacheTime = 0;
        cardRectCacheGeneration++;
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            vsRecalculate();
        }, 150);
    };
    window.addEventListener('resize', vsState.resizeHandler);
}

/**
 * Recalculate positions (after resize, zoom change, or filter change).
 */
function vsRecalculate() {
    if (!vsState.enabled) return;

    // Remember which item is at the top of viewport
    const scrollTop = gridContainer.scrollTop;
    const viewportHeight = gridContainer.clientHeight;
    let anchorItemIndex = -1;
    let anchorOffset = 0;

    if (vsState.positions && vsState.sortedItems.length > 0) {
        const { startIndex } = vsGetVisibleRange(scrollTop, viewportHeight);
        if (startIndex < vsState.sortedItems.length) {
            anchorItemIndex = startIndex;
            const idx = startIndex * 4;
            anchorOffset = scrollTop - vsState.positions[idx + 1];
        }
    }

    // Recalculate positions
    const containerWidth = gridContainer.clientWidth;
    const result = vsCalculatePositions(vsState.sortedItems, containerWidth, layoutMode, zoomLevel);
    vsState.positions = result.positions;
    vsState.totalHeight = result.totalHeight;

    // Update spacer
    if (vsState.spacer) {
        vsState.spacer.style.height = `${vsState.totalHeight}px`;
    }

    // Restore scroll position relative to anchor item
    if (anchorItemIndex >= 0 && anchorItemIndex < vsState.sortedItems.length) {
        const idx = anchorItemIndex * 4;
        const newTop = vsState.positions[idx + 1];
        gridContainer.scrollTop = newTop + anchorOffset;
    }

    // Force full re-render of visible range
    vsState.lastStartIndex = -1;
    vsState.lastEndIndex = -1;
    const newScrollTop = gridContainer.scrollTop;
    const { startIndex, endIndex } = vsGetVisibleRange(newScrollTop, viewportHeight);
    vsUpdateDOM(startIndex, endIndex);
}

/**
 * Update virtual scrolling with new filtered/sorted items.
 */
function vsUpdateItems(items, options = {}) {
    if (!vsState.enabled) {
        vsInit(items);
        return;
    }

    const { preserveScroll = false } = options;
    const savedScrollTop = preserveScroll ? gridContainer.scrollTop : 0;

    if (preserveScroll) {
        // --- Optimized path for filter changes: keep cards whose item is still in the new set ---
        // Build a map from item path to new index for fast lookup
        const pathToNewIndex = new Map();
        for (let i = 0; i < items.length; i++) {
            const p = items[i].path || items[i].folderPath || '';
            if (p) pathToNewIndex.set(p, i);
        }

        // Separate cards into keep (item still exists) and remove
        const keptCards = new Map(); // newIndex -> card
        for (const [oldIdx, card] of vsState.activeCards) {
            const cardPath = card.dataset.path || card.dataset.folderPath || '';
            const newIdx = pathToNewIndex.get(cardPath);
            if (newIdx !== undefined) {
                keptCards.set(newIdx, card);
            } else {
                // This item was filtered out — destroy and recycle
                const mediaEl = card._mediaEl;
                if (mediaEl) {
                    if (mediaEl.tagName === 'VIDEO') {
                        destroyVideoElement(mediaEl);
                        activeVideoCount = Math.max(0, activeVideoCount - 1);
                    } else {
                        destroyImageElement(mediaEl);
                        activeImageCount = Math.max(0, activeImageCount - 1);
                    }
                }
                pendingMediaCreations.delete(card);
                mediaToRetry.delete(card);
                observer.unobserve(card);
                card.remove();
                if (vsState.recyclePool.length < VS_MAX_POOL_SIZE) {
                    vsState.recyclePool.push(card);
                }
            }
        }

        vsState.activeCards.clear();
        // Re-register kept cards under their new indices
        for (const [newIdx, card] of keptCards) {
            card._vsItemIndex = newIdx;
            vsState.activeCards.set(newIdx, card);
        }
    } else {
        // --- Full teardown path for folder navigation ---
        for (const [itemIdx, card] of vsState.activeCards) {
            const mediaEl = card._mediaEl;
            if (mediaEl) {
                if (mediaEl.tagName === 'VIDEO') {
                    destroyVideoElement(mediaEl);
                    activeVideoCount = Math.max(0, activeVideoCount - 1);
                } else {
                    destroyImageElement(mediaEl);
                    activeImageCount = Math.max(0, activeImageCount - 1);
                }
            }
            observer.unobserve(card);
            card.remove();
            if (vsState.recyclePool.length < VS_MAX_POOL_SIZE) {
                vsState.recyclePool.push(card);
            }
        }
        vsState.activeCards.clear();
        pendingMediaCreations.clear();
        mediaToRetry.clear();
    }

    vsState.sortedItems = items;

    // Invalidate layout cache -- items changed, force full recalculation
    vsState.layoutCache.itemCount = 0;

    // Recalculate positions
    const containerWidth = gridContainer.clientWidth;
    const result = vsCalculatePositions(items, containerWidth, layoutMode, zoomLevel);
    vsState.positions = result.positions;
    vsState.totalHeight = result.totalHeight;

    // Notify canvas grid that positions changed
    if (window.CG) window.CG.invalidateData();

    // Update spacer
    if (vsState.spacer) {
        vsState.spacer.style.height = `${vsState.totalHeight}px`;
    }

    // Scroll to top for new items, or preserve scroll for filter changes
    gridContainer.scrollTop = savedScrollTop;

    // Render visible range
    vsState.lastStartIndex = -1;
    vsState.lastEndIndex = -1;
    const viewportHeight = gridContainer.clientHeight;
    const { startIndex, endIndex } = vsGetVisibleRange(savedScrollTop, viewportHeight);
    vsUpdateDOM(startIndex, endIndex);
}

/**
 * Clean up virtual scrolling state.
 */
function vsCleanup() {
    vsState.enabled = false;
    cancelMarquee();

    if (vsState.scrollRafId) {
        cancelAnimationFrame(vsState.scrollRafId);
        vsState.scrollRafId = null;
    }

    gridContainer.removeEventListener('scroll', vsOnScroll);

    if (vsState.resizeHandler) {
        window.removeEventListener('resize', vsState.resizeHandler);
        vsState.resizeHandler = null;
    }

    // Clean up active cards
    for (const [, card] of vsState.activeCards) {
        const mediaEl = card._mediaEl;
        if (mediaEl) {
            if (mediaEl.tagName === 'VIDEO') destroyVideoElement(mediaEl);
            else destroyImageElement(mediaEl);
        }
        observer.unobserve(card);
    }
    vsState.activeCards.clear();
    vsState.recyclePool = [];
    vsState.positions = null;
    vsState.sortedItems = [];
    vsState.totalHeight = 0;
    vsState.lastStartIndex = -1;
    vsState.lastEndIndex = -1;

    if (vsState.spacer && vsState.spacer.parentNode) {
        vsState.spacer.remove();
    }
    vsState.spacer = null;
}

/**
 * Get the item index for a given card element (used by features that reference cards).
 */
function vsGetItemIndex(card) {
    return card._vsItemIndex;
}

/**
 * Get the card element for a given item index (if currently rendered).
 */
function vsGetCardForIndex(index) {
    return vsState.activeCards.get(index) || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE, NOTIFICATIONS & DIALOGS
// ═══════════════════════════════════════════════════════════════════════════

// ── Batched localStorage writes ──
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

// ── DOM Elements (navigation, search, status bar) ──
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
const searchClearBtn = document.getElementById('search-clear-btn');
const itemCountEl = document.getElementById('item-count');
const searchResultCountEl = document.getElementById('search-result-count');
const searchDebounceDotEl = document.getElementById('search-debounce-dot');
const searchBoxContainerEl = searchBox ? searchBox.parentElement : null;

// Status bar elements
const statusActivity = document.getElementById('status-activity');
const statusItemCounts = document.getElementById('status-item-counts');
const statusFilterInfo = document.getElementById('status-filter-info');
const statusSelectionInfo = document.getElementById('status-selection-info');
const statusLayoutMode = document.getElementById('status-layout-mode');
const statusZoomLevel = document.getElementById('status-zoom-level');

const statusProgress = document.getElementById('status-progress');
const statusProgressFill = document.getElementById('status-progress-fill');
const statusProgressEta = document.getElementById('status-progress-eta');

function setStatusActivity(msg, opts) {
    if (statusActivity) statusActivity.textContent = msg || '';
    if (opts && typeof opts.done === 'number' && opts.total > 0) {
        if (statusProgress) statusProgress.classList.remove('hidden');
        if (statusProgressFill) {
            const pct = Math.min(100, Math.max(0, (opts.done / opts.total) * 100));
            statusProgressFill.style.width = pct + '%';
        }
        if (statusProgressEta) statusProgressEta.textContent = opts.eta || '';
    } else {
        if (statusProgress) statusProgress.classList.add('hidden');
        if (statusProgressEta) statusProgressEta.textContent = '';
    }
}

// Rolling-average ETA tracker. Call tick(itemsCompleted) after each batch.
function createEtaTracker(total) {
    const startMs = performance.now();
    let lastMs = startMs;
    let lastDone = 0;
    let avgMsPerItem = 0;
    return {
        tick(done) {
            const now = performance.now();
            const deltaItems = done - lastDone;
            if (deltaItems > 0) {
                const msPerItem = (now - lastMs) / deltaItems;
                // Exponential moving average, weight recent samples
                avgMsPerItem = avgMsPerItem === 0 ? msPerItem : (avgMsPerItem * 0.6 + msPerItem * 0.4);
                lastMs = now;
                lastDone = done;
            }
            const remaining = Math.max(0, total - done);
            const msLeft = remaining * avgMsPerItem;
            return formatEta(msLeft);
        }
    };
}

function formatEta(ms) {
    if (!isFinite(ms) || ms <= 0) return '';
    const s = Math.ceil(ms / 1000);
    if (s < 10) return `~${s}s left`;
    if (s < 60) return `~${Math.ceil(s / 5) * 5}s left`;
    const m = Math.ceil(s / 60);
    if (m < 60) return `~${m}m left`;
    const h = Math.floor(m / 60);
    const mr = m % 60;
    return mr > 0 ? `~${h}h ${mr}m left` : `~${h}h left`;
}

// ── Toast Notification System ──
const toastContainer = document.getElementById('toast-container');
const TOAST_ICONS = {
    success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>',
    warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
};
const TOAST_CLOSE_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
let toastCount = 0;
const MAX_TOASTS = 5;

/**
 * Show a toast notification.
 * @param {string} message - Main message text
 * @param {'success'|'error'|'warning'|'info'} type - Toast type
 * @param {Object} [options]
 * @param {string} [options.details] - Secondary detail text
 * @param {number} [options.duration=4000] - Auto-dismiss ms (0 = manual only)
 * @param {string} [options.actionLabel] - Action button label (e.g. "Undo")
 * @param {Function} [options.actionCallback] - Action button click handler
 * @returns {HTMLElement} The toast element
 */
function showToast(message, type = 'info', options = {}) {
    if (!toastContainer) return null;
    const { details, duration = 4000, actionLabel, actionCallback } = options;

    // Limit visible toasts. Prefer dropping dismissible (info/success) toasts
    // before errors/warnings so critical messages aren't pushed out by noise.
    const existing = Array.from(toastContainer.querySelectorAll('.toast:not(.toast-exit)'));
    if (existing.length >= MAX_TOASTS) {
        const dismissible = existing.filter(t =>
            !t.classList.contains('toast-error') && !t.classList.contains('toast-warning')
        );
        const victim = dismissible.length > 0
            ? dismissible[dismissible.length - 1]
            : existing[existing.length - 1];
        dismissToast(victim);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.id = `toast-${++toastCount}`;

    let bodyHtml = `<div class="toast-message">${escapeHtml(message)}</div>`;
    if (details) {
        bodyHtml += `<div class="toast-details">${escapeHtml(details)}</div>`;
    }
    if (actionLabel) {
        bodyHtml += `<div class="toast-actions"><button class="toast-action-btn" data-toast-action="true">${escapeHtml(actionLabel)}</button></div>`;
    }

    toast.innerHTML = `
        <div class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</div>
        <div class="toast-body">${bodyHtml}</div>
        <button class="toast-close" title="Dismiss">${TOAST_CLOSE_SVG}</button>
    `;

    // Close button
    toast.querySelector('.toast-close').addEventListener('click', () => dismissToast(toast));

    // Action button
    if (actionLabel && actionCallback) {
        const actionBtn = toast.querySelector('[data-toast-action]');
        if (actionBtn) {
            actionBtn.addEventListener('click', () => {
                actionCallback();
                dismissToast(toast);
            });
        }
    }

    toastContainer.prepend(toast);

    // Auto-dismiss
    if (duration > 0) {
        toast._dismissTimer = setTimeout(() => dismissToast(toast), duration);
    }

    // Pause auto-dismiss on hover
    toast.addEventListener('mouseenter', () => {
        if (toast._dismissTimer) clearTimeout(toast._dismissTimer);
    });
    toast.addEventListener('mouseleave', () => {
        if (duration > 0 && !toast.classList.contains('toast-exit')) {
            toast._dismissTimer = setTimeout(() => dismissToast(toast), duration);
        }
    });

    return toast;
}

function dismissToast(toast) {
    if (!toast || toast.classList.contains('toast-exit')) return;
    if (toast._dismissTimer) clearTimeout(toast._dismissTimer);
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Show a toast for a given category only once per session
const _shownToastKeys = new Set();
function showToastOnce(key, message, type = 'info', options = {}) {
    if (_shownToastKeys.has(key)) return null;
    _shownToastKeys.add(key);
    return showToast(message, type, options);
}

// ── Auto-Update Notifications ──
(function initAutoUpdateListeners() {
    let updateToast = null;
    let downloading = false;

    window.electronAPI.onUpdateAvailable((info) => {
        if (updateToast) dismissToast(updateToast);
        updateToast = showToast(`Update v${info.version} available`, 'info', {
            details: 'A new version is ready to download.',
            duration: 0,
            actionLabel: 'Download',
            actionCallback: () => {
                downloading = true;
                window.electronAPI.downloadUpdate();
                // Don't create a new toast here — the first progress event will update it
            }
        });
    });

    window.electronAPI.onUpdateDownloadProgress((progress) => {
        if (updateToast && !updateToast.classList.contains('toast-exit')) {
            // Update text in place
            const msgEl = updateToast.querySelector('.toast-message');
            if (msgEl) msgEl.textContent = 'Downloading update...';
            let detailsEl = updateToast.querySelector('.toast-details');
            if (detailsEl) {
                detailsEl.textContent = `${progress.percent}%`;
            } else {
                // Add details element if the toast doesn't have one yet
                const body = updateToast.querySelector('.toast-body');
                if (body) {
                    detailsEl = document.createElement('div');
                    detailsEl.className = 'toast-details';
                    detailsEl.textContent = `${progress.percent}%`;
                    body.appendChild(detailsEl);
                }
            }
            // Hide the action button once downloading starts
            const actionBtn = updateToast.querySelector('[data-toast-action]');
            if (actionBtn) actionBtn.closest('.toast-actions').remove();
            return;
        }
        // Fallback: create a new toast if the existing one is gone
        updateToast = showToast('Downloading update...', 'info', {
            details: `${progress.percent}%`,
            duration: 0
        });
    });

    window.electronAPI.onUpdateDownloaded(() => {
        if (updateToast) dismissToast(updateToast);
        updateToast = showToast('Update ready to install', 'success', {
            details: 'Restart the app to apply the update.',
            duration: 0,
            actionLabel: 'Restart Now',
            actionCallback: () => window.electronAPI.installUpdate()
        });
    });

    window.electronAPI.onUpdateError((message) => {
        console.error('Auto-update error:', message);
        if (updateToast) dismissToast(updateToast);
        updateToast = showToast('Update failed', 'error', {
            details: message,
            duration: 8000
        });
    });
})();

// ── Friendly Error Messages ──
function friendlyError(err) {
    const msg = typeof err === 'string' ? err : (err && err.message) || 'Unknown error';
    if (/EPERM|EACCES/i.test(msg)) return 'Permission denied \u2014 the file may be read-only or in use';
    if (/ENOENT/i.test(msg)) return 'File not found \u2014 it may have been moved or deleted';
    if (/ENOSPC/i.test(msg)) return 'Not enough disk space';
    if (/EBUSY/i.test(msg)) return 'File is in use by another program';
    if (/EEXIST/i.test(msg)) return 'A file with that name already exists';
    if (/ENAMETOOLONG/i.test(msg)) return 'File name is too long';
    if (/EISDIR/i.test(msg)) return 'Expected a file but found a folder';
    if (/ENOTDIR/i.test(msg)) return 'Expected a folder but found a file';
    if (/ENOTEMPTY/i.test(msg)) return 'Folder is not empty';
    if (/EXDEV/i.test(msg)) return 'Cannot move between different drives';
    if (/Destination file already exists/i.test(msg)) return 'A file with that name already exists in the destination';
    return msg;
}

// ── Application Menu Command Handler ──
window.electronAPI.onMenuCommand((command) => {
    switch (command) {
        case 'open-folder': selectFolderBtn.click(); break;
        case 'export-settings': {
            const btn = document.querySelector('[data-tab="data"]');
            if (btn) { btn.click(); toggleSettingsModal(); }
            break;
        }
        case 'import-settings': {
            const btn = document.querySelector('[data-tab="data"]');
            if (btn) { btn.click(); toggleSettingsModal(); }
            break;
        }
        case 'undo': document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); break;
        case 'redo': document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', ctrlKey: true, shiftKey: true, bubbles: true })); break;
        case 'toggle-sidebar': setSidebarCollapsed(!sidebarCollapsed); break;
        case 'toggle-layout': layoutModeToggle.checked = !layoutModeToggle.checked; switchLayoutMode(); break;
        case 'zoom-in': { const z = Math.min(200, zoomLevel + 10); zoomSlider.value = z; zoomLevel = z; applyZoom(); deferLocalStorageWrite('zoomLevel', z.toString()); updateStatusBar(); break; }
        case 'zoom-out': { const z = Math.max(50, zoomLevel - 10); zoomSlider.value = z; zoomLevel = z; applyZoom(); deferLocalStorageWrite('zoomLevel', z.toString()); updateStatusBar(); break; }
        case 'zoom-reset': { zoomSlider.value = 100; zoomLevel = 100; applyZoom(); deferLocalStorageWrite('zoomLevel', '100'); updateStatusBar(); break; }
        case 'show-shortcuts': toggleShortcutsOverlay(); break;
        case 'open-settings': toggleSettingsModal(); break;
        case 'about': showToast('Thumbnail Animator v' + (document.title.match(/v[\d.]+/)?.[0] || ''), 'info'); break;
    }
});

// ── Custom Confirmation Dialog ──
const confirmDialog = document.getElementById('confirm-dialog');
const confirmDialogTitle = document.getElementById('confirm-dialog-title');
const confirmDialogMessage = document.getElementById('confirm-dialog-message');
const confirmDialogOk = document.getElementById('confirm-dialog-ok');
const confirmDialogCancel = document.getElementById('confirm-dialog-cancel');
let _confirmResolve = null;

/**
 * Show a styled confirmation dialog (replaces native confirm()).
 * @param {string} title - Dialog title
 * @param {string} message - Dialog message
 * @param {Object} [options]
 * @param {string} [options.confirmLabel='OK'] - Confirm button text
 * @param {string} [options.cancelLabel='Cancel'] - Cancel button text
 * @param {boolean} [options.danger=false] - Use red confirm button
 * @returns {Promise<boolean>} true if confirmed
 */
function showConfirm(title, message, options = {}) {
    const { confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false } = options;
    confirmDialogTitle.textContent = title;
    confirmDialogMessage.textContent = message;
    confirmDialogOk.textContent = confirmLabel;
    confirmDialogCancel.textContent = cancelLabel;
    confirmDialogOk.classList.toggle('confirm-danger', danger);
    confirmDialog.classList.remove('hidden');
    confirmDialogOk.focus();

    return new Promise(resolve => {
        // Clean up any prior listener
        if (_confirmResolve) _confirmResolve(false);
        _confirmResolve = resolve;
    });
}

function _closeConfirmDialog(result) {
    confirmDialog.classList.add('hidden');
    if (_confirmResolve) {
        const resolve = _confirmResolve;
        _confirmResolve = null;
        resolve(result);
    }
}

// Simple text-prompt dialog (Electron disables window.prompt). Returns the
// entered string, or null if the user cancelled.
function showPromptDialog(title, { defaultValue = '', placeholder = '', confirmLabel = 'OK' } = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-dialog';
        overlay.innerHTML = `
            <div class="confirm-dialog-content">
                <h3 class="confirm-dialog-title"></h3>
                <input type="text" class="prompt-dialog-input" autocomplete="off" spellcheck="false">
                <div class="confirm-dialog-buttons">
                    <button class="confirm-dialog-cancel">Cancel</button>
                    <button class="confirm-dialog-ok"></button>
                </div>
            </div>
        `;
        overlay.querySelector('.confirm-dialog-title').textContent = title;
        const input = overlay.querySelector('.prompt-dialog-input');
        input.value = defaultValue;
        input.placeholder = placeholder;
        const okBtn = overlay.querySelector('.confirm-dialog-ok');
        okBtn.textContent = confirmLabel;
        const cancelBtn = overlay.querySelector('.confirm-dialog-cancel');
        document.body.appendChild(overlay);
        setTimeout(() => { input.focus(); input.select(); }, 0);

        const cleanup = (value) => {
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            resolve(value);
        };
        const onKey = (e) => {
            if (matchesShortcut(e, 'dialogCancel')) { e.preventDefault(); e.stopPropagation(); cleanup(null); }
            else if (matchesShortcut(e, 'dialogConfirm')) { e.preventDefault(); e.stopPropagation(); cleanup(input.value); }
        };
        document.addEventListener('keydown', onKey, true);
        okBtn.addEventListener('click', () => cleanup(input.value));
        cancelBtn.addEventListener('click', () => cleanup(null));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(null); });
    });
}

confirmDialogOk.addEventListener('click', () => _closeConfirmDialog(true));
confirmDialogCancel.addEventListener('click', () => _closeConfirmDialog(false));
confirmDialog.addEventListener('click', (e) => {
    if (e.target === confirmDialog) _closeConfirmDialog(false);
});
document.addEventListener('keydown', (e) => {
    if (!confirmDialog.classList.contains('hidden')) {
        if (matchesShortcut(e, 'dialogCancel')) { e.preventDefault(); _closeConfirmDialog(false); }
        if (matchesShortcut(e, 'dialogConfirm')) { e.preventDefault(); _closeConfirmDialog(true); }
    }
});

// ── File Conflict Dialog ──
const fileConflictDialog = document.getElementById('file-conflict-dialog');
const fileConflictMessage = document.getElementById('file-conflict-message');
const fileConflictRememberLabel = document.getElementById('file-conflict-remember-label');
const fileConflictRemember = document.getElementById('file-conflict-remember');
const fileConflictSkip = document.getElementById('file-conflict-skip');
const fileConflictKeepBoth = document.getElementById('file-conflict-keep-both');
const fileConflictReplace = document.getElementById('file-conflict-replace');
const conflictSourceThumb = document.getElementById('conflict-source-thumb');
const conflictExistingThumb = document.getElementById('conflict-existing-thumb');
const conflictSourceMeta = document.getElementById('conflict-source-meta');
const conflictExistingMeta = document.getElementById('conflict-existing-meta');
let _conflictResolve = null;

/**
 * Show a file conflict resolution dialog with side-by-side comparison.
 * @param {string} fileName - Name of the conflicting file
 * @param {string} sourcePath - Full path of the source file being copied/moved
 * @param {string} destPath - Full path of the existing file at the destination
 * @param {boolean} showRemember - Show "Apply to all" checkbox (for batch ops)
 * @returns {Promise<{resolution: 'replace'|'keep-both'|'skip', applyToAll: boolean}>}
 */
function showFileConflictDialog(fileName, sourcePath, destPath, showRemember = false) {
    fileConflictMessage.textContent = `"${fileName}" already exists in this location.`;
    fileConflictRemember.checked = false;
    fileConflictRememberLabel.classList.toggle('hidden', !showRemember);

    // Clear previous comparison content (keep the label spans)
    _clearConflictPane(conflictSourceThumb);
    _clearConflictPane(conflictExistingThumb);
    conflictSourceMeta.innerHTML = '';
    conflictExistingMeta.innerHTML = '';

    fileConflictDialog.classList.remove('hidden');
    fileConflictKeepBoth.focus();

    // Populate thumbnails and metadata asynchronously
    _populateConflictComparison(sourcePath, destPath);

    return new Promise(resolve => {
        if (_conflictResolve) _conflictResolve({ resolution: 'skip', applyToAll: false });
        _conflictResolve = resolve;
    });
}

function _clearConflictPane(thumbEl) {
    // Pause and remove any media, but keep the label span
    const label = thumbEl.querySelector('.conflict-file-label');
    thumbEl.querySelectorAll('img, video').forEach(el => {
        if (el.tagName === 'VIDEO') { el.pause(); el.removeAttribute('src'); el.load(); }
        el.remove();
    });
}

async function _populateConflictComparison(sourcePath, destPath) {
    // Load thumbnails immediately from file paths
    _loadConflictThumb(conflictSourceThumb, sourcePath);
    _loadConflictThumb(conflictExistingThumb, destPath);

    // Fetch metadata for both files in parallel
    try {
        const [srcResult, dstResult] = await Promise.all([
            window.electronAPI.getFileInfo(sourcePath),
            window.electronAPI.getFileInfo(destPath)
        ]);
        // Dialog may have been closed while loading — bail out
        if (fileConflictDialog.classList.contains('hidden')) return;

        const srcInfo = srcResult.ok ? srcResult.value : null;
        const dstInfo = dstResult.ok ? dstResult.value : null;

        _renderConflictMeta(conflictSourceMeta, srcInfo, dstInfo);
        _renderConflictMeta(conflictExistingMeta, dstInfo, srcInfo);
    } catch {
        // Silently fail — dialog still works without metadata
    }
}

function _loadConflictThumb(container, filePath) {
    const fileUrl = 'file:///' + filePath.replace(/\\/g, '/');
    const type = getFileType(filePath);
    if (type === 'image') {
        const img = document.createElement('img');
        img.src = fileUrl;
        img.draggable = false;
        container.appendChild(img);
    } else {
        const vid = document.createElement('video');
        vid.src = fileUrl;
        vid.muted = true;
        vid.preload = 'metadata';
        container.appendChild(vid);
    }
}

function _renderConflictMeta(container, info, otherInfo) {
    container.innerHTML = '';
    if (!info) return;

    const rows = [
        { label: 'Name', value: info.name },
        { label: 'Size', value: info.sizeFormatted, cls: _compareSizeClass(info, otherInfo) },
        { label: 'Modified', value: new Date(info.modified).toLocaleString(), cls: _compareDateClass(info, otherInfo) },
    ];
    if (info.width && info.height) {
        rows.push({ label: 'Dimensions', value: `${info.width} × ${info.height}` });
    }

    for (const row of rows) {
        const div = document.createElement('div');
        div.className = 'conflict-meta-row';
        div.innerHTML = `<span class="conflict-meta-label">${row.label}</span><span class="conflict-meta-value${row.cls ? ' ' + row.cls : ''}">${row.value}</span>`;
        container.appendChild(div);
    }
}

function _compareSizeClass(info, other) {
    if (!other || info.size === other.size) return '';
    return info.size > other.size ? 'conflict-larger' : 'conflict-smaller';
}

function _compareDateClass(info, other) {
    if (!other) return '';
    const a = new Date(info.modified).getTime();
    const b = new Date(other.modified).getTime();
    if (a === b) return '';
    return a > b ? 'conflict-newer' : 'conflict-older';
}

function _closeConflictDialog(resolution) {
    fileConflictDialog.classList.add('hidden');
    // Clean up media elements
    _clearConflictPane(conflictSourceThumb);
    _clearConflictPane(conflictExistingThumb);
    conflictSourceMeta.innerHTML = '';
    conflictExistingMeta.innerHTML = '';
    if (_conflictResolve) {
        const resolve = _conflictResolve;
        _conflictResolve = null;
        resolve({ resolution, applyToAll: fileConflictRemember.checked });
    }
}

fileConflictSkip.addEventListener('click', () => _closeConflictDialog('skip'));
fileConflictKeepBoth.addEventListener('click', () => _closeConflictDialog('keep-both'));
fileConflictReplace.addEventListener('click', () => _closeConflictDialog('replace'));
fileConflictDialog.addEventListener('click', (e) => {
    if (e.target === fileConflictDialog) _closeConflictDialog('skip');
});
document.addEventListener('keydown', (e) => {
    if (!fileConflictDialog.classList.contains('hidden')) {
        if (matchesShortcut(e, 'dialogCancel')) { e.preventDefault(); _closeConflictDialog('skip'); }
    }
});

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

// ── DOM Elements (settings, card info, sidebar, filters) ──
const filterAllBtn = document.getElementById('filter-all');
const filterVideosBtn = document.getElementById('filter-videos');
const filterImagesBtn = document.getElementById('filter-images');

const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const layoutModeToggle = document.getElementById('layout-mode-toggle');
const layoutModeLabel = document.getElementById('layout-mode-label');
const rememberFolderToggle = document.getElementById('remember-folder-toggle');
const rememberFolderLabel = document.getElementById('remember-folder-label');
const includeMovingImagesToggle = document.getElementById('include-moving-images-toggle');
const includeMovingImagesLabel = document.getElementById('include-moving-images-label');
const sortTypeSelect = document.getElementById('sort-type-select');
const sortOrderSelect = document.getElementById('sort-order-select');
const thumbnailQualitySelect = document.getElementById('thumbnail-quality-select');
const hoverScaleSlider = document.getElementById('hover-scale-slider');
const hoverScaleValue = document.getElementById('hover-scale-value');
const hoverScaleFixedWrap = document.getElementById('hover-scale-fixed-wrap');
const hoverScaleZoomToggle = document.getElementById('hover-scale-zoom-toggle');
const hoverScaleZoomLabel = document.getElementById('hover-scale-zoom-label');
const hoverScaleZoomRow = document.getElementById('hover-scale-zoom-row');
const hoverScaleZ50 = document.getElementById('hover-scale-z50');
const hoverScaleZ50Value = document.getElementById('hover-scale-z50-value');
const hoverScaleZ100 = document.getElementById('hover-scale-z100');
const hoverScaleZ100Value = document.getElementById('hover-scale-z100-value');
const hoverScaleZ200 = document.getElementById('hover-scale-z200');
const hoverScaleZ200Value = document.getElementById('hover-scale-z200-value');
const pauseOnLightboxToggle = document.getElementById('pause-on-lightbox-toggle');
const pauseOnLightboxLabel = document.getElementById('pause-on-lightbox-label');
const pauseOnBlurToggle = document.getElementById('pause-on-blur-toggle');
const pauseOnBlurLabel = document.getElementById('pause-on-blur-label');
const autoRepeatToggle = document.getElementById('auto-repeat-toggle');
const autoRepeatLabel = document.getElementById('auto-repeat-label');
const playbackControlsToggle = document.getElementById('playback-controls-toggle');
const playbackControlsLabel = document.getElementById('playback-controls-label');
const zoomToFitToggle = document.getElementById('zoom-to-fit-toggle');
const zoomToFitLabel = document.getElementById('zoom-to-fit-label');
const hoverScrubToggle = document.getElementById('hover-scrub-toggle');
const hoverScrubLabel = document.getElementById('hover-scrub-label');
const lightboxZoomToFitToggle = document.getElementById('lightbox-zoom-to-fit-toggle');
const zoomSlider = document.getElementById('zoom-slider');
const zoomValue = document.getElementById('zoom-value');
const cardInfoResolutionToggle = document.getElementById('card-info-resolution-toggle');
const cardInfoSizeToggle = document.getElementById('card-info-size-toggle');
const cardInfoDateToggle = document.getElementById('card-info-date-toggle');
const cardInfoDurationToggle = document.getElementById('card-info-duration-toggle');
const cardInfoStarsToggle = document.getElementById('card-info-stars-toggle');
const cardInfoExtensionToggle = document.getElementById('card-info-extension-toggle');
const cardInfoAudioToggle = document.getElementById('card-info-audio-toggle');
const cardInfoFilenameToggle = document.getElementById('card-info-filename-toggle');
const cardInfoResolutionLabel = document.getElementById('card-info-resolution-label');
const cardInfoSizeLabel = document.getElementById('card-info-size-label');
const cardInfoDateLabel = document.getElementById('card-info-date-label');
const cardInfoDurationLabel = document.getElementById('card-info-duration-label');
const cardInfoStarsLabel = document.getElementById('card-info-stars-label');
const cardInfoExtensionLabel = document.getElementById('card-info-extension-label');
const cardInfoAudioLabel = document.getElementById('card-info-audio-label');
const cardInfoFilenameLabel = document.getElementById('card-info-filename-label');
const cardInfoExtensionHoverToggle = document.getElementById('card-info-extension-hover-toggle');
const cardInfoExtensionHoverLabel = document.getElementById('card-info-extension-hover-label');
const cardInfoExtensionHoverRow = document.getElementById('card-info-extension-hover-row');
const cardInfoResolutionHoverToggle = document.getElementById('card-info-resolution-hover-toggle');
const cardInfoResolutionHoverLabel = document.getElementById('card-info-resolution-hover-label');
const cardInfoResolutionHoverRow = document.getElementById('card-info-resolution-hover-row');
const cardInfoSizeHoverToggle = document.getElementById('card-info-size-hover-toggle');
const cardInfoSizeHoverLabel = document.getElementById('card-info-size-hover-label');
const cardInfoSizeHoverRow = document.getElementById('card-info-size-hover-row');
const cardInfoDateHoverToggle = document.getElementById('card-info-date-hover-toggle');
const cardInfoDateHoverLabel = document.getElementById('card-info-date-hover-label');
const cardInfoDateHoverRow = document.getElementById('card-info-date-hover-row');
const cardInfoStarsHoverToggle = document.getElementById('card-info-stars-hover-toggle');
const cardInfoStarsHoverLabel = document.getElementById('card-info-stars-hover-label');
const cardInfoStarsHoverRow = document.getElementById('card-info-stars-hover-row');
const cardInfoAudioHoverToggle = document.getElementById('card-info-audio-hover-toggle');
const cardInfoAudioHoverLabel = document.getElementById('card-info-audio-hover-label');
const cardInfoAudioHoverRow = document.getElementById('card-info-audio-hover-row');
const cardInfoFilenameHoverToggle = document.getElementById('card-info-filename-hover-toggle');
const cardInfoFilenameHoverLabel = document.getElementById('card-info-filename-hover-label');
const cardInfoFilenameHoverRow = document.getElementById('card-info-filename-hover-row');
const cardInfoTagsToggle = document.getElementById('card-info-tags-toggle');
const cardInfoTagsLabel = document.getElementById('card-info-tags-label');
const cardInfoTagsHoverToggle = document.getElementById('card-info-tags-hover-toggle');
const cardInfoTagsHoverLabel = document.getElementById('card-info-tags-hover-label');
const cardInfoTagsHoverRow = document.getElementById('card-info-tags-hover-row');
const cardInfoHoverTooltipToggle = document.getElementById('card-info-hover-tooltip-toggle');
const cardInfoHoverTooltipLabel = document.getElementById('card-info-hover-tooltip-label');
const useSystemTrashToggle = document.getElementById('use-system-trash-toggle');
const useSystemTrashLabel = document.getElementById('use-system-trash-label');
let useSystemTrash = localStorage.getItem('useSystemTrash') === 'true';
const toolsMenuBtn = document.getElementById('tools-menu-btn');
const toolsMenuDropdown = document.getElementById('tools-menu-dropdown');
const favoritesList = document.getElementById('favorites-list');
const addFavoriteBtn = document.getElementById('add-favorite-btn');
const newFavGroupBtn = document.getElementById('new-fav-group-btn');
const favContextMenu = document.getElementById('fav-context-menu');
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

// ── Inline event wiring (DOM-dependent) ──
// Make keyboard hint in status bar clickable
document.querySelectorAll('.status-keyboard-hint').forEach(el => {
    el.addEventListener('click', () => toggleShortcutsOverlay());
});
// Horizontal scroll tabs with mouse wheel
tabsContainer.addEventListener('wheel', (e) => {
    if (e.deltaY !== 0) {
        e.preventDefault();
        tabsContainer.scrollLeft += e.deltaY;
    }
}, { passive: false });
// Toggle system menu with Alt key (needed because titleBarStyle: 'hidden' disables native Alt behavior)
let altKeyOnly = false;
document.addEventListener('keydown', (e) => {
    altKeyOnly = e.key === 'Alt' && !e.ctrlKey && !e.shiftKey && !e.metaKey;
});
document.addEventListener('keyup', (e) => {
    if (e.key === 'Alt' && altKeyOnly) {
        window.electronAPI.toggleMenuBar();
    }
    altKeyOnly = false;
});

// Track current folder path for navigation
let currentFolderPath = null;
let activeDimensionHydrationToken = 0;

// Store current items for re-sorting without re-fetching
let currentItems = [];
let currentItemStatsCacheRef = null;
let currentItemStatsCacheLen = -1;
let currentItemStatsCache = { folders: 0, videos: 0, images: 0, total: 0 };
let filteredVisibleCountCacheRef = null;
let filteredVisibleCountCacheValue = null;

function getCurrentItemStats() {
    if (currentItemStatsCacheRef === currentItems && currentItemStatsCacheLen === currentItems.length) {
        return currentItemStatsCache;
    }

    const stats = { folders: 0, videos: 0, images: 0, total: currentItems.length };
    for (const item of currentItems) {
        if (!item) continue;
        if (item.type === 'folder') stats.folders++;
        else if (item.type === 'video') stats.videos++;
        else if (item.type === 'image') stats.images++;
    }

    currentItemStatsCacheRef = currentItems;
    currentItemStatsCacheLen = currentItems.length;
    currentItemStatsCache = stats;
    return stats;
}

function setFilteredVisibleCountCache(itemsRef, value) {
    filteredVisibleCountCacheRef = itemsRef || null;
    filteredVisibleCountCacheValue = typeof value === 'number' ? value : null;
}

function clearFilteredVisibleCountCache() {
    filteredVisibleCountCacheRef = null;
    filteredVisibleCountCacheValue = null;
}

// --- AI Visual Search state ---
let aiVisualSearchEnabled = localStorage.getItem('aiVisualSearchEnabled') === 'true';
let aiModelDownloadConfirmed = localStorage.getItem('aiModelDownloadConfirmed') === 'true';
let aiAutoScan = localStorage.getItem('aiAutoScan') === 'true';
// GPU acceleration mode: 'auto' (default, probe hardware) | 'on' (force) | 'off' (CPU only)
function getClipGpuMode() {
    const saved = localStorage.getItem('clipGpuMode');
    return (saved === 'on' || saved === 'off' || saved === 'auto') ? saved : 'auto';
}
let aiSimilarityThreshold = parseFloat(localStorage.getItem('aiSimilarityThreshold')) || 0.15;
let aiClusteringMode = localStorage.getItem('aiClusteringMode') || 'off';
let aiSearchActive = false;      // Whether the AI search toggle is currently on
let currentTextEmbedding = null; // Float32Array of current query embedding
const currentEmbeddings = new Map(); // path -> Float32Array, for current folder
let embeddingScanAbortController = null;

// Track current filter state
let currentFilter = 'all'; // 'all', 'video', 'image'
let starFilterActive = false;
let starSortOrder = 'desc'; // 'none' (use settings sort), 'desc' (high to low), 'asc' (low to high)
let tagFilterActive = false;
let tagFilteredPaths = null; // Set<string> when filtering, null when not
let activeTagFilters = []; // [{tagId, name, color}]
let tagFilterOperator = 'AND'; // 'AND' or 'OR'

// --- Find Similar state ---
const findSimilarState = {
    active: false,
    embedding: null,       // Float32Array - source image embedding
    sourcePath: null,      // Source file path
    threshold: 0.60,       // Similarity threshold (0-1)
    allFolders: false,     // Cross-folder toggle
    previousItems: null,   // Stashed currentItems to restore on clear
    previousFolder: null,  // Stashed currentFolderPath to restore on clear
};

// Silent reset of find-similar state + banner (no re-render).
function clearFindSimilarState() {
    if (!findSimilarState.active) return;
    findSimilarState.active = false;
    findSimilarState.embedding = null;
    findSimilarState.sourcePath = null;
    findSimilarState.previousItems = null;
    findSimilarState.previousFolder = null;
    const fsBanner = document.getElementById('find-similar-banner');
    if (fsBanner) fsBanner.classList.add('hidden');
}

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

// Per-folder sort preferences: { folderPath: { sortType, sortOrder } }
const MAX_FOLDER_SORT_PREFS = 500;
let folderSortPrefs = {};
try {
    const raw = localStorage.getItem('folderSortPrefs');
    if (raw) folderSortPrefs = JSON.parse(raw);
} catch { folderSortPrefs = {}; }

function getFolderSortPref(folderPath) {
    return folderPath ? folderSortPrefs[folderPath] : null;
}

function setFolderSortPref(folderPath, type, order) {
    if (!folderPath) return;
    folderSortPrefs[folderPath] = { sortType: type, sortOrder: order };
    // LRU eviction: drop oldest entries if over limit
    const keys = Object.keys(folderSortPrefs);
    if (keys.length > MAX_FOLDER_SORT_PREFS) {
        const toRemove = keys.length - MAX_FOLDER_SORT_PREFS;
        for (let i = 0; i < toRemove; i++) delete folderSortPrefs[keys[i]];
    }
    deferLocalStorageWrite('folderSortPrefs', JSON.stringify(folderSortPrefs));
}

// Track thumbnail quality
let thumbnailQuality = 'medium'; // 'low', 'medium', 'high'

// Track ffmpeg availability for video thumbnail generation
let hasFfmpegAvailable = false;

// Track zoom level
let zoomLevel = 100; // Percentage

// --- Card info (metadata chips on grid cards) ---
const DEFAULT_CARD_INFO = Object.freeze({
    extension: true,
    resolution: true,
    fileSize: false,
    date: false,
    duration: true,
    starRating: true,
    audioLabel: true,
    filename: true,
    tags: true,
    extensionOnlyOnHover: false,
    resolutionOnlyOnHover: true,
    fileSizeOnlyOnHover: true,
    dateOnlyOnHover: true,
    starRatingOnlyOnHover: true,
    audioLabelOnlyOnHover: false,
    filenameOnlyOnHover: true,
    tagsOnlyOnHover: false,
    hoverTooltip: true
});
let cardInfoSettings = { ...DEFAULT_CARD_INFO };

// Track favorites
let favorites = { version: 2, groups: [] }; // Grouped favorites structure

// Track recent files
let recentFiles = []; // Array of { path, name, url, type, timestamp }

// Track tabs
let tabs = []; // Array of { id, path, name, sortType, sortOrder }
let activeTabId = null;
let tabIdCounter = 1;

// Track lightbox navigation
let currentLightboxIndex = -1;
let lightboxItems = []; // Filtered items for lightbox navigation
// When set, openLightbox uses this override list instead of getFilteredMediaItems().
// Used by Inspector's "Similar Items" carousel to navigate among similar results.
let lightboxItemsOverride = null;
// Hint: if set, openLightbox uses this as currentLightboxIndex (bypasses path lookup).
// Consumed once per openLightbox call.
let _lightboxNextIndexHint = null;

// Browser-style viewing history for mouse back/forward buttons.
// Each entry: {url, path, name}. _lbHistoryIndex points at the current item.
// Navigating via arrow keys / similar-click PUSHES onto this stack (truncating forward).
// Mouse back/forward walks the stack without pushing.
let _lbHistory = [];
let _lbHistoryIndex = -1;
let _lbHistoryBlock = false; // when true, openLightbox doesn't push (during history walk)
function _lbHistoryPush(entry) {
    if (_lbHistoryBlock) return;
    // Truncate forward history
    if (_lbHistoryIndex < _lbHistory.length - 1) {
        _lbHistory.length = _lbHistoryIndex + 1;
    }
    // Don't push duplicate consecutive entries
    const top = _lbHistory[_lbHistoryIndex];
    if (top && top.path === entry.path) return;
    _lbHistory.push(entry);
    _lbHistoryIndex = _lbHistory.length - 1;
    // Cap length
    if (_lbHistory.length > LB_HISTORY_MAX_SIZE) {
        _lbHistory.splice(0, _lbHistory.length - LB_HISTORY_MAX_SIZE);
        _lbHistoryIndex = _lbHistory.length - 1;
    }
}
function _lbHistoryGoBack() {
    if (_lbHistoryIndex <= 0) return false;
    _lbHistoryIndex--;
    const e = _lbHistory[_lbHistoryIndex];
    if (!e) return false;
    _lbHistoryBlock = true;
    try { openLightbox(e.url, e.path, e.name); } finally { _lbHistoryBlock = false; }
    return true;
}
function _lbHistoryGoForward() {
    if (_lbHistoryIndex >= _lbHistory.length - 1) return false;
    _lbHistoryIndex++;
    const e = _lbHistory[_lbHistoryIndex];
    if (!e) return false;
    _lbHistoryBlock = true;
    try { openLightbox(e.url, e.path, e.name); } finally { _lbHistoryBlock = false; }
    return true;
}

// Track star ratings
let fileRatings = {}; // Map<filePath, rating (1-5)>

// App-level undo stack for metadata operations (ratings, tags, pins).
// File operations (rename/move/delete) are undone via main.js's own stack.
const metadataUndoStack = [];
const METADATA_UNDO_LIMIT = 50;
let _skipMetadataUndo = false;

function pushMetadataUndo(label, undoFn) {
    if (_skipMetadataUndo || typeof undoFn !== 'function') return;
    metadataUndoStack.push({ label, undoFn });
    if (metadataUndoStack.length > METADATA_UNDO_LIMIT) {
        metadataUndoStack.shift();
    }
}

async function undoLastMetadataOp() {
    const entry = metadataUndoStack.pop();
    if (!entry) return null;
    _skipMetadataUndo = true;
    try {
        await entry.undoFn();
        // Refresh any card tag chips after DB mutations
        if (typeof refreshVisibleCardTags === 'function') {
            try { refreshVisibleCardTags(); } catch {}
        }
    } finally {
        _skipMetadataUndo = false;
    }
    return entry.label;
}

// --- Tag mutation wrappers (with undo) -----------------------------------
// These wrap the IPC calls so every tag mutation runs through a single
// point that can track previous state and push an undo entry.
async function tagAddToFile(normalizedPath, tagId, tagName) {
    const result = await window.electronAPI.dbAddTagToFile(normalizedPath, tagId);
    pushMetadataUndo(
        `Add tag "${tagName || 'tag'}"`,
        () => window.electronAPI.dbRemoveTagFromFile(normalizedPath, tagId)
    );
    return result;
}

async function tagRemoveFromFile(normalizedPath, tagId, tagName) {
    const result = await window.electronAPI.dbRemoveTagFromFile(normalizedPath, tagId);
    pushMetadataUndo(
        `Remove tag "${tagName || 'tag'}"`,
        () => window.electronAPI.dbAddTagToFile(normalizedPath, tagId)
    );
    return result;
}

async function tagBulkAdd(normalizedPaths, tagId, tagName) {
    // Capture previous state so we can restore precisely (only add-back paths
    // that actually gained the tag as a result of this operation).
    let prevHad = [];
    try {
        const existing = await window.electronAPI.dbGetTagsForFiles(normalizedPaths);
        // existing is assumed to be { [path]: [{id, name}, ...] }
        if (existing && typeof existing === 'object') {
            for (const p of normalizedPaths) {
                const tags = existing[p] || [];
                if (tags.some(t => t.id === tagId)) prevHad.push(p);
            }
        }
    } catch { /* best-effort */ }
    const result = await window.electronAPI.dbBulkTagFiles(normalizedPaths, tagId);
    const newlyAdded = normalizedPaths.filter(p => !prevHad.includes(p));
    if (newlyAdded.length > 0) {
        pushMetadataUndo(
            `Tag ${newlyAdded.length} file${newlyAdded.length === 1 ? '' : 's'} with "${tagName || 'tag'}"`,
            () => window.electronAPI.dbBulkRemoveTagFromFiles(newlyAdded, tagId)
        );
    }
    return result;
}

async function tagBulkRemove(normalizedPaths, tagId, tagName) {
    // Capture which files actually had the tag so undo only re-adds those.
    let prevHad = [];
    try {
        const existing = await window.electronAPI.dbGetTagsForFiles(normalizedPaths);
        if (existing && typeof existing === 'object') {
            for (const p of normalizedPaths) {
                const tags = existing[p] || [];
                if (tags.some(t => t.id === tagId)) prevHad.push(p);
            }
        }
    } catch { /* best-effort */ }
    const result = await window.electronAPI.dbBulkRemoveTagFromFiles(normalizedPaths, tagId);
    if (prevHad.length > 0) {
        pushMetadataUndo(
            `Remove tag "${tagName || 'tag'}" from ${prevHad.length} file${prevHad.length === 1 ? '' : 's'}`,
            () => window.electronAPI.dbBulkTagFiles(prevHad, tagId)
        );
    }
    return result;
}

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

// Parsed operators from the search box (tag:, size:, type:, rating:, date:, dim:, ratio:).
// Separate from advancedSearchFilters so the Advanced Search modal stays authoritative
// while operators overlay on top during filtering.
let _parsedSearchQuery = {
    freeText: '',
    operators: {
        sizeOperator: null, sizeValue: null,
        dateFrom: null, dateTo: null,
        width: null, height: null,
        aspectRatio: null, starRating: null,
        typeFilter: null,
        tagNames: [], tagExcludeNames: [],
        _includedPaths: null, _excludedPaths: null
    }
};

function _parseDateOperand(v) {
    if (/^\d{4}$/.test(v)) {
        const y = parseInt(v, 10);
        return { start: new Date(y, 0, 1).getTime(), end: new Date(y + 1, 0, 1).getTime() - 1 };
    }
    if (/^\d{4}-\d{1,2}$/.test(v)) {
        const [y, m] = v.split('-').map(Number);
        return { start: new Date(y, m - 1, 1).getTime(), end: new Date(y, m, 1).getTime() - 1 };
    }
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(v)) {
        const [y, m, d] = v.split('-').map(Number);
        return { start: new Date(y, m - 1, d).getTime(), end: new Date(y, m - 1, d + 1).getTime() - 1 };
    }
    return null;
}

function parseSearchQuery(input) {
    const ops = {
        sizeOperator: null, sizeValue: null,
        dateFrom: null, dateTo: null,
        width: null, height: null,
        aspectRatio: null, starRating: null,
        typeFilter: null,
        tagNames: [], tagExcludeNames: [],
        _includedPaths: null, _excludedPaths: null
    };
    const freeTextParts = [];
    const tokens = [];
    const re = /"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(input)) !== null) {
        if (m[1] !== undefined) tokens.push({ kind: 'quoted', value: m[1] });
        else tokens.push({ kind: 'bare', value: m[2] });
    }
    for (const tok of tokens) {
        if (tok.kind === 'quoted') { freeTextParts.push(tok.value); continue; }
        const t = tok.value;
        let match;
        if ((match = t.match(/^-tag:(.+)$/i))) { ops.tagExcludeNames.push(match[1].toLowerCase()); continue; }
        if ((match = t.match(/^tag:(.+)$/i))) { ops.tagNames.push(match[1].toLowerCase()); continue; }
        if ((match = t.match(/^type:(video|image|gif|folder)$/i))) { ops.typeFilter = match[1].toLowerCase(); continue; }
        if ((match = t.match(/^size:(>=|<=|>|<|=)?\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/i))) {
            const op = match[1] || '=';
            const val = parseFloat(match[2]);
            const unit = (match[3] || 'b').toLowerCase();
            const mults = { b: 1, kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776 };
            ops.sizeOperator = op;
            ops.sizeValue = val * mults[unit];
            continue;
        }
        if ((match = t.match(/^rating:(>=|<=|>|<|=)?\s*([0-5])$/i))) {
            ops.starRating = parseInt(match[2], 10);
            continue;
        }
        if ((match = t.match(/^date:(>=|<=|>|<|=)?(\d{4}(?:-\d{1,2}(?:-\d{1,2})?)?)$/i))) {
            const op = match[1] || '=';
            const range = _parseDateOperand(match[2]);
            if (range) {
                if (op === '=' || op === '>=' || op === '>') {
                    ops.dateFrom = op === '>' ? range.end + 1 : range.start;
                }
                if (op === '=' || op === '<=' || op === '<') {
                    ops.dateTo = op === '<' ? range.start - 1 : range.end;
                }
            }
            continue;
        }
        if ((match = t.match(/^dim:(\d+)x(\d+)$/i))) {
            ops.width = parseInt(match[1], 10);
            ops.height = parseInt(match[2], 10);
            continue;
        }
        if ((match = t.match(/^ratio:(\d+:\d+)$/i))) { ops.aspectRatio = match[1]; continue; }
        // No operator matched → free text token
        freeTextParts.push(t);
    }
    return { freeText: freeTextParts.join(' '), operators: ops };
}

// Returns true if the parsed operators contain anything that needs filter enforcement
function _operatorsHaveFilters(ops) {
    return !!(ops.typeFilter || ops.sizeValue != null || ops.dateFrom != null || ops.dateTo != null
        || ops.width != null || ops.height != null || ops.aspectRatio || ops.starRating != null
        || ops.tagNames.length || ops.tagExcludeNames.length);
}

// Build a human-readable list of chips describing each active operator.
// Returns array of { label, tokenMatcher } where tokenMatcher identifies the
// source token in the search box so we can remove it on click.
function _summarizeSearchOperators(ops) {
    const chips = [];
    const bytesHuman = (b) => {
        if (b == null) return '';
        if (b >= 1073741824) return `${(b / 1073741824).toFixed(b % 1073741824 === 0 ? 0 : 1)}GB`;
        if (b >= 1048576) return `${(b / 1048576).toFixed(b % 1048576 === 0 ? 0 : 1)}MB`;
        if (b >= 1024) return `${(b / 1024).toFixed(b % 1024 === 0 ? 0 : 1)}KB`;
        return `${b}B`;
    };
    if (ops.typeFilter) chips.push({ label: `type: ${ops.typeFilter}`, re: /^type:\S+$/i });
    if (ops.starRating != null) chips.push({ label: `rating: ${ops.starRating}`, re: /^rating:\S+$/i });
    if (ops.sizeValue != null) chips.push({ label: `size ${ops.sizeOperator || '='} ${bytesHuman(ops.sizeValue)}`, re: /^size:\S+$/i });
    if (ops.dateFrom != null || ops.dateTo != null) chips.push({ label: `date`, re: /^date:\S+$/i });
    if (ops.width != null && ops.height != null) chips.push({ label: `${ops.width}\u00d7${ops.height}`, re: /^dim:\S+$/i });
    if (ops.aspectRatio) chips.push({ label: `ratio ${ops.aspectRatio}`, re: /^ratio:\S+$/i });
    const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const name of ops.tagNames) chips.push({ label: `tag: ${name}`, re: new RegExp('^tag:' + escRe(name) + '$', 'i') });
    for (const name of ops.tagExcludeNames) chips.push({ label: `-tag: ${name}`, re: new RegExp('^-tag:' + escRe(name) + '$', 'i') });
    return chips;
}

function renderSearchOperatorChips() {
    const container = document.getElementById('search-operator-chips');
    if (!container) return;
    const ops = _parsedSearchQuery.operators;
    const chips = _summarizeSearchOperators(ops);
    container.innerHTML = '';
    if (chips.length === 0) return;
    for (const chip of chips) {
        const el = document.createElement('span');
        el.className = 'search-op-chip';
        el.title = chip.label;
        const label = document.createElement('span');
        label.className = 'search-op-chip-label';
        label.textContent = chip.label;
        el.appendChild(label);
        const btn = document.createElement('button');
        btn.className = 'search-op-chip-remove';
        btn.type = 'button';
        btn.textContent = '\u00d7';
        btn.title = 'Remove filter';
        btn.addEventListener('click', () => _removeSearchOperatorToken(chip.re));
        el.appendChild(btn);
        container.appendChild(el);
    }
}

// Rebuild the search query string with the matching token removed.
function _removeSearchOperatorToken(tokenRe) {
    const input = searchBox.value || '';
    const re = /"([^"]*)"|(\S+)/g;
    const kept = [];
    let m;
    while ((m = re.exec(input)) !== null) {
        if (m[1] !== undefined) {
            kept.push(`"${m[1]}"`);
        } else if (!tokenRe.test(m[2])) {
            kept.push(m[2]);
        }
    }
    const newValue = kept.join(' ');
    searchBox.value = newValue;
    if (searchClearBtn) searchClearBtn.style.display = newValue ? '' : 'none';
    performSearch(newValue);
}

// Merge parsed operators over a base advancedSearchFilters object. Operators win when set.
function _mergeOperatorFilters(baseFilters, ops) {
    const out = { ...baseFilters };
    if (ops.sizeValue != null) { out.sizeOperator = ops.sizeOperator; out.sizeValue = ops.sizeValue; }
    if (ops.dateFrom != null) out.dateFrom = ops.dateFrom;
    if (ops.dateTo != null) out.dateTo = ops.dateTo;
    if (ops.width != null) out.width = ops.width;
    if (ops.height != null) out.height = ops.height;
    if (ops.aspectRatio) out.aspectRatio = ops.aspectRatio;
    if (ops.starRating != null) out.starRating = ops.starRating;
    return out;
}

let recursiveSearchEnabled = localStorage.getItem('recursiveSearch') === 'true';

// Track video playback state
let videoPlaybackSpeed = 1.0;
let videoLoop = false;
let videoRepeat = false;

// Custom playback controller instances
let activePlaybackController = null;
let mediaControlBarInstance = null;
let autoRepeatVideos = false;
let playbackControlsEnabled = true;
let zoomToFit = true;
let hoverScrubEnabled = true;
let lightboxFilmstripEnabled = localStorage.getItem('lightboxFilmstripEnabled') !== 'false';

// Track progress
let currentProgress = null; // { current: number, total: number, cancelled: boolean }

// Cache folder contents per tab to avoid re-scanning
const tabContentCache = new Map(); // Map<tabId, { items, timestamp }>
const tabDomCache = new Map(); // Map<tabId, { fragment, scrollTop, layoutMode, timestamp }>
const tabFolderScrollPositions = new Map(); // Map<tabId, Map<normalizedPath, scrollTop>>

function getTabScrollMap(tabId) {
    if (!tabFolderScrollPositions.has(tabId)) tabFolderScrollPositions.set(tabId, new Map());
    return tabFolderScrollPositions.get(tabId);
}

// Cache folder contents globally (for recently accessed folders)
const folderCache = new Map(); // Map<folderPath, { items, timestamp }>

// Smart collection result cache — in-memory only for speed
// Key: collectionId, Value: { items: [], timestamp: number }
const smartCollectionCache = new Map();

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
            if (!database.objectStoreNames.contains(GIF_DURATION_STORE)) {
                database.createObjectStore(GIF_DURATION_STORE, { keyPath: 'key' });
            }
            if (!database.objectStoreNames.contains(EMBEDDING_STORE)) {
                database.createObjectStore(EMBEDDING_STORE, { keyPath: 'key' });
            }
            if (!database.objectStoreNames.contains(COLLECTIONS_STORE)) {
                database.createObjectStore(COLLECTIONS_STORE, { keyPath: 'id' });
            }
            if (!database.objectStoreNames.contains(COLLECTION_FILES_STORE)) {
                const cfStore = database.createObjectStore(COLLECTION_FILES_STORE, { keyPath: 'id' });
                cfStore.createIndex('collectionId', 'collectionId', { unique: false });
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

// ═══ → collections.js (collections CRUD, smart rules, dimension/embedding cache) ═══

// ═══════════════════════════════════════════════════════════════════════════
// FIND SIMILAR (Reverse Image Search)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Activate "Find Similar" for a source image.
 * Gets the source embedding (from cache or on-the-fly), then runs the search.
 */
async function activateFindSimilar(filePath, fileName) {
    // Get source embedding from currentEmbeddings or compute on-the-fly
    let embedding = currentEmbeddings.get(filePath);

    if (!embedding) {
        showToast('Computing embedding for source image...', 'info', { duration: 2000 });
        try {
            const status = await window.electronAPI.clipStatus();
            if (!status.value?.loaded) {
                const init = await window.electronAPI.clipInit(getClipGpuMode());
                if (!init.ok) {
                    showToast('Could not load AI model', 'error');
                    return;
                }
            }
            // Find mtime for the source file
            const sourceItem = currentItems.find(i => i.path === filePath);
            const mtime = sourceItem ? (sourceItem.mtime || 0) : 0;
            const resp = await window.electronAPI.clipEmbedImages([{ path: filePath, mtime, thumbPath: null }]);
            const results = resp && resp.ok ? (resp.value || []) : [];
            if (results.length > 0 && results[0].embedding) {
                embedding = l2Normalize(new Float32Array(results[0].embedding));
                currentEmbeddings.set(filePath, embedding);
                // Also cache to IndexedDB
                await cacheEmbeddings([{ path: filePath, mtime, embedding: results[0].embedding }]);
            } else {
                showToast('Could not generate embedding for this image', 'error');
                return;
            }
        } catch (err) {
            showToast('Failed to compute embedding', 'error');
            return;
        }
    }

    findSimilarState.active = true;
    findSimilarState.embedding = embedding;
    findSimilarState.sourcePath = filePath;

    // Show banner
    const banner = document.getElementById('find-similar-banner');
    const sourceNameEl = document.getElementById('find-similar-source-name');
    const thresholdSlider = document.getElementById('find-similar-threshold');
    const thresholdValue = document.getElementById('find-similar-threshold-value');
    const allFoldersCheckbox = document.getElementById('find-similar-all-folders');

    if (sourceNameEl) sourceNameEl.textContent = fileName || filePath.split(/[/\\]/).pop();
    if (thresholdSlider) {
        thresholdSlider.value = Math.round(findSimilarState.threshold * 100);
        thresholdValue.textContent = findSimilarState.threshold.toFixed(2);
    }
    if (allFoldersCheckbox) allFoldersCheckbox.checked = findSimilarState.allFolders;
    if (banner) banner.classList.remove('hidden');

    // Highlight source card
    const sourceCard = gridContainer.querySelector(`[data-path="${CSS.escape(filePath)}"]`);
    if (sourceCard) sourceCard.classList.add('find-similar-source');

    if (findSimilarState.allFolders) {
        await executeCrossFolderFindSimilar();
    } else {
        applyFilters();
        updateFindSimilarCount();
    }
}

/**
 * Execute cross-folder "Find Similar" by scanning all embeddings in IndexedDB.
 */
async function executeCrossFolderFindSimilar() {
    if (!findSimilarState.embedding) return;

    showToast('Searching across all indexed folders...', 'info', { duration: 2000 });

    const allEmbeddings = await getAllCachedEmbeddings();

    if (allEmbeddings.size === 0) {
        showToast('No indexed folders found. Visit folders with AI search enabled to build the index.', 'info', { duration: 5000 });
        return;
    }

    // Compute similarities
    const matches = [];
    for (const [path, data] of allEmbeddings) {
        if (path === findSimilarState.sourcePath) continue; // Skip source
        const sim = cosineSimilarity(findSimilarState.embedding, data.embedding);
        if (sim >= findSimilarState.threshold) {
            matches.push({ path, mtime: data.mtime, score: sim });
        }
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);

    // Stash current state for restore
    if (!findSimilarState.previousItems) {
        findSimilarState.previousItems = currentItems.slice();
        findSimilarState.previousFolder = currentFolderPath;
    }

    // Build item objects from matches (must include url for thumbnails and lightbox)
    const resultItems = matches.map(m => {
        const name = m.path.split(/[/\\]/).pop();
        // Construct file:// URL from path (Windows: file:///C:/..., Unix: file:///...)
        const normalizedPath = m.path.replace(/\\/g, '/');
        const url = normalizedPath.startsWith('/') ? `file://${normalizedPath}` : `file:///${normalizedPath}`;
        return {
            path: m.path,
            name,
            url,
            type: getFileType(m.path),
            mtime: m.mtime,
            size: 0,
            _similarityScore: m.score
        };
    });

    // Update grid with results
    currentItems = resultItems;
    currentFolderPath = null;
    currentCollectionId = null;

    currentEmbeddings.clear(); bumpEmbeddingsVersion();
    currentTextEmbedding = null;
    cancelEmbeddingScan();

    renderItems(resultItems, null);
    updateFindSimilarCount();

    if (resultItems.length === 0) {
        showToast('No similar images found across indexed folders', 'info');
    } else {
        showToast(`Found ${resultItems.length} similar image${resultItems.length !== 1 ? 's' : ''} across all folders`, 'success');
    }
}

/**
 * Update the count display in the find-similar banner.
 */
function updateFindSimilarCount() {
    const countEl = document.getElementById('find-similar-count');
    if (!countEl) return;

    if (findSimilarState.allFolders) {
        countEl.textContent = `${currentItems.length} result${currentItems.length !== 1 ? 's' : ''}`;
    } else {
        // Count items that pass the similarity filter in current folder
        let count = 0;
        for (const item of currentItems) {
            if (item.type === 'folder') continue;
            const emb = currentEmbeddings.get(item.path);
            if (!emb) continue;
            const sim = cosineSimilarity(findSimilarState.embedding, emb);
            if (sim >= findSimilarState.threshold) count++;
        }
        countEl.textContent = `${count} result${count !== 1 ? 's' : ''}`;
    }
}

/**
 * Clear the "Find Similar" filter and restore previous view.
 */
function clearFindSimilar() {
    const wasAllFolders = findSimilarState.allFolders;

    // Remove source card highlight
    const sourceCard = gridContainer.querySelector('.find-similar-source');
    if (sourceCard) sourceCard.classList.remove('find-similar-source');

    // Reset state
    findSimilarState.active = false;
    findSimilarState.embedding = null;
    findSimilarState.sourcePath = null;

    // Hide banner
    const banner = document.getElementById('find-similar-banner');
    if (banner) banner.classList.add('hidden');
    const countEl = document.getElementById('find-similar-count');
    if (countEl) countEl.textContent = '';

    if (wasAllFolders && findSimilarState.previousItems) {
        // Restore previous view
        currentItems = findSimilarState.previousItems;
        currentFolderPath = findSimilarState.previousFolder;
        findSimilarState.previousItems = null;
        findSimilarState.previousFolder = null;

        if (currentFolderPath) {
            // Re-render the previous folder
            const st = gridContainer.scrollTop;
            loadVideos(currentFolderPath, true, st);
        } else {
            renderItems(currentItems, null);
        }
    } else {
        findSimilarState.previousItems = null;
        findSimilarState.previousFolder = null;
        applyFilters();
    }
}




async function getCachedGifDuration(filePath, mtime) {
    if (!db) return null;
    try {
        const transaction = db.transaction([GIF_DURATION_STORE], 'readonly');
        const store = transaction.objectStore(GIF_DURATION_STORE);
        return new Promise((resolve) => {
            const request = store.get(`${filePath}|${mtime || 0}`);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => resolve(null);
        });
    } catch {
        return null;
    }
}

async function cacheGifDuration(filePath, mtime, totalDuration, frameCount) {
    if (!db || !totalDuration) return;
    try {
        const transaction = db.transaction([GIF_DURATION_STORE], 'readwrite');
        const store = transaction.objectStore(GIF_DURATION_STORE);
        store.put({
            key: `${filePath}|${mtime || 0}`,
            totalDuration,
            frameCount
        });
    } catch {
        // Caching is best-effort
    }
}

function hasDimensionDependentFilters() {
    return advancedSearchFilters.width !== null ||
        advancedSearchFilters.height !== null ||
        advancedSearchFilters.aspectRatio !== '';
}

function updateInMemoryFolderCaches(folderPath, items) {
    const normalizedPath = normalizePath(folderPath);
    const timestamp = Date.now();

    if (activeTabId != null) {
        tabContentCache.set(activeTabId, {
            items,
            path: normalizedPath,
            timestamp
        });
    }

    folderCache.set(normalizedPath, {
        items,
        timestamp
    });
}

function scheduleVsRecalculateForDimensions() {
    if (!vsState.enabled || layoutMode !== 'masonry') return;
    if (vsState.dimensionRecalcRafId !== null) return;

    vsState.dimensionRecalcRafId = requestAnimationFrame(() => {
        vsState.dimensionRecalcRafId = null;
        // Force a full position rebuild so updated dimensions are reflected.
        vsState.layoutCache.itemCount = 0;
        vsRecalculate();
    });
}

function updateItemDimensionsByPath(filePath, width, height) {
    if (!filePath || !width || !height) return false;

    let updated = false;
    for (const item of currentItems) {
        if (item && item.path === filePath && item.type !== 'folder') {
            item.width = width;
            item.height = height;
            updated = true;
        }
    }
    return updated;
}

function applyUpdatedDimensionsToVisibleCards(updatedPaths) {
    let updatedVisibleCards = 0;

    for (const [itemIdx, card] of vsState.activeCards) {
        const item = vsState.sortedItems[itemIdx];
        if (!item || item.type === 'folder' || !updatedPaths.has(item.path) || !item.width || !item.height) {
            continue;
        }

        const aspectRatioName = getClosestAspectRatio(item.width, item.height);
        applyAspectRatioToCard(card, aspectRatioName, 'hydrated');
        card.dataset.width = item.width;
        card.dataset.height = item.height;
        card.dataset.mtime = String(item.mtime || 0);
        if (item.size > 0) card.dataset.fileSize = String(item.size);
        else delete card.dataset.fileSize;
        createResolutionLabel(card, item.width, item.height);
        const vEl = card.querySelector('video.media-thumbnail');
        const dur = vEl && isFinite(vEl.duration) && vEl.duration > 0 ? vEl.duration : null;
        syncCardMetaRow(card, item, dur);
        updatedVisibleCards++;
    }

    return updatedVisibleCards;
}

async function hydrateMissingDimensionsInBackground(folderPath, items) {
    if (!window.electronAPI?.scanFileDimensions || items.length === 0) return;

    const needsBackgroundScan = items.filter(item =>
        item.type !== 'folder' &&
        (!item.width || !item.height)
    );
    if (needsBackgroundScan.length === 0) return;

    const scanToken = ++activeDimensionHydrationToken;
    const perfStart = perfTest.start();
    const shouldReapplyFilters = hasDimensionDependentFilters();
    let updatedCount = 0;
    const cacheEntries = [];

    for (let i = 0; i < needsBackgroundScan.length; i += BACKGROUND_DIMENSION_SCAN_CHUNK_SIZE) {
        if (scanToken !== activeDimensionHydrationToken || currentFolderPath !== folderPath) return;

        const chunk = needsBackgroundScan.slice(i, i + BACKGROUND_DIMENSION_SCAN_CHUNK_SIZE)
            .filter(item => !item.width || !item.height);
        if (chunk.length === 0) continue;

        const r = await window.electronAPI.scanFileDimensions(
            chunk.map(item => ({ path: item.path, isImage: item.type === 'image' }))
        );
        if (scanToken !== activeDimensionHydrationToken || currentFolderPath !== folderPath) return;
        const results = r && r.ok ? r.value : [];
        const chunkByPath = new Map(chunk.map(item => [item.path, item]));

        const updatedPaths = new Set();
        for (const result of results || []) {
            if (!result || !result.path || !result.width || !result.height) continue;
            const item = chunkByPath.get(result.path);
            if (!item) continue;

            item.width = result.width;
            item.height = result.height;
            updatedPaths.add(item.path);
            updatedCount++;
            cacheEntries.push({
                path: item.path,
                mtime: item.mtime || 0,
                width: item.width,
                height: item.height
            });
        }

        if (updatedPaths.size > 0) {
            applyUpdatedDimensionsToVisibleCards(updatedPaths);
            updateInMemoryFolderCaches(folderPath, items);

            if (shouldReapplyFilters) {
                scheduleDimensionHydrationRefresh('filters');
            } else {
                scheduleDimensionHydrationRefresh('layout');
            }
        }

        await yieldToEventLoop();
    }

    if (cacheEntries.length > 0) {
        cacheDimensions(cacheEntries).catch(err => console.warn('cacheDimensions:', err));
        storeFolderInIndexedDB(folderPath, items).catch(err => console.warn('storeFolderInIndexedDB:', err));
    }

    perfTest.end('backgroundDimensions (IPC)', perfStart, {
        itemCount: needsBackgroundScan.length,
        detail: `${updatedCount}/${needsBackgroundScan.length} updated`
    });
}

// Initialize IndexedDB on page load
initIndexedDB().catch(() => {
    // IndexedDB not available, continue without persistent cache
    console.warn('IndexedDB initialization failed, using memory cache only');
    showToastOnce('indexeddb-init-fail',
        'Persistent cache unavailable',
        'warning',
        { details: 'Folder listings and thumbnails will be re-fetched each session.' }
    );
});

// --- Plugin enable/disable helper (renderer-side cache) ---
function isPluginEnabled(pluginId) {
    try {
        const states = JSON.parse(localStorage.getItem('pluginStates') || '{}');
        return states[pluginId] !== false;
    } catch {
        return true;
    }
}

function _setLocalPluginState(pluginId, enabled) {
    try {
        const states = JSON.parse(localStorage.getItem('pluginStates') || '{}');
        states[pluginId] = enabled;
        localStorage.setItem('pluginStates', JSON.stringify(states));
    } catch { /* ignore */ }
}

// Load plugin manifests for context menu contributions
let _pluginMenuItems = null; // lazily populated
async function getPluginMenuItems() {
    if (_pluginMenuItems !== null) return _pluginMenuItems;
    try {
        const _manRes = await window.electronAPI.getPluginManifests();
        const manifests = _manRes && _manRes.ok ? (_manRes.value || []) : [];
        _pluginMenuItems = [];
        for (const manifest of manifests) {
            if (!isPluginEnabled(manifest.id)) continue;
            const items = manifest.capabilities?.contextMenuItems || [];
            for (const item of items) {
                _pluginMenuItems.push({ ...item, pluginId: manifest.id });
            }
        }
    } catch (err) {
        console.warn('Could not load plugin manifests:', err);
        showToastOnce('plugin-manifests-fail',
            'Plugin menu items unavailable',
            'warning',
            { details: 'Plugins could not be loaded; right-click menu contributions will be missing.' }
        );
        _pluginMenuItems = [];
    }
    return _pluginMenuItems;
}

// Warm the plugin cache so the first context menu open doesn't flicker items in async
setTimeout(() => { getPluginMenuItems(); }, 0);

// Show first-run welcome card
(function initWelcomeCard() {
    if (localStorage.getItem('welcomeDismissed') === 'true') return;
    const card = document.getElementById('welcome-card');
    if (!card) return;
    // Delay so it doesn't compete with initial render
    setTimeout(() => { card.classList.remove('hidden'); }, 800);
    const dismiss = () => {
        card.classList.add('hidden');
        localStorage.setItem('welcomeDismissed', 'true');
    };
    const closeBtn = document.getElementById('welcome-close');
    const dismissBtn = document.getElementById('welcome-dismiss');
    if (closeBtn) closeBtn.addEventListener('click', dismiss);
    if (dismissBtn) dismissBtn.addEventListener('click', dismiss);
})();

// Normalize path for consistent cache lookups (handle Windows path variations)
const _normalizeCache = new Map();
function normalizePath(path) {
    if (!path) return path;
    let result = _normalizeCache.get(path);
    if (result !== undefined) return result;
    result = path.replace(/\\/g, '/').replace(/\/+$/, '') || path;
    _normalizeCache.set(path, result);
    if (_normalizeCache.size > NORMALIZE_CACHE_MAX_SIZE) _normalizeCache.clear();
    return result;
}

// ═══ → sidebar-tree.js (folder tree, sidebar resize, init, expand/collapse) ═══

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
        // Don't add duplicate if we're already at this path
        if (tab.historyIndex >= 0 && normalizePath(tab.historyPaths[tab.historyIndex]) === normalizePath(path)) {
            return;
        }
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

// ═══ → lightbox.js (lightbox DOM elements, state, zoom controls placement) ═══

// Context Menu Elements
const contextMenu = document.getElementById('context-menu');
let contextMenuTargetCard = null;
let contextMenuSource = 'grid'; // 'grid' or 'lightbox'

// Blow-Up Preview (right-click hold)
const BLOW_UP_HOLD_DELAY = blowUpDelaySetting;
let blowUpHoldTimer = null;
let blowUpActive = false;
let blowUpTargetCard = null;
let blowUpOverlay = null;

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

// ═══════════════════════════════════════════════════════════════════════════
// MEDIA CLEANUP & LOADING
// ═══════════════════════════════════════════════════════════════════════════
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

function invalidateScrollCaches() {
    cachedViewportBounds = null;
    viewportBoundsCacheTime = 0;
    cardRectCacheGeneration++;
    // Invalidate cached scrub rect so next mousemove re-reads once
    if (currentHoveredCard) delete currentHoveredCard._scrubRect;
}

function scheduleScrollCleanup() {
    invalidateScrollCaches();
    scheduleCleanupCycle();

    clearTimeout(cleanupScrollTimeout);
    cleanupScrollTimeout = setTimeout(() => {
        invalidateScrollCaches();
        runCleanupCycle();
    }, SCROLL_DEBOUNCE_MS);
}

function handleGridScroll() {
    if (isWindowMinimized) return;

    scheduleScrollCleanup();
}

function ensureCleanupScrollListener() {
    if (cleanupScrollListenerAttached || vsState.enabled) return;
    gridContainer.addEventListener('scroll', handleGridScroll, { passive: true });
    cleanupScrollListenerAttached = true;
}

function performCleanupCheck() {
    const perfStart = perfTest.start();

    // Use vsState.activeCards when virtual scrolling is active (avoids full DOM traversal)
    const cardSource = vsState.enabled ? Array.from(vsState.activeCards.values()) : Array.from(gridContainer.querySelectorAll('.video-card'));
    if (cardSource.length === 0) {
        perfTest.end('performCleanupCheck', perfStart, { cardCount: 0, detail: 'empty' });
        return;
    }

    let cleaned = false;

    // Calculate cleanup bounds around the grid's own viewport, not the whole
    // window. Using the window kept far too many media elements alive while the
    // user was scrolling inside the grid.
    const bounds = getViewportBounds();
    const viewportTop = bounds.top;
    const viewportBottom = bounds.bottom;
    const viewportLeft = bounds.left;
    const viewportRight = bounds.right;

    // Build card → media map and inverse media → card map (no DOM queries)
    const cardMediaMap = new Map();
    const mediaToCard = new Map(); // Inverse lookup to avoid .closest() DOM walks in passes 2 & 3
    let allVideos = [];
    let allImages = [];
    for (const card of cardSource) {
        if (!card.classList.contains('video-card')) continue;
        const mediaEl = card._mediaEl;
        if (!mediaEl) continue;
        mediaToCard.set(mediaEl, card);
        if (mediaEl.tagName === 'VIDEO') {
            cardMediaMap.set(card, { videos: [mediaEl], images: [] });
            allVideos.push(mediaEl);
        } else {
            cardMediaMap.set(card, { videos: [], images: [mediaEl] });
            allImages.push(mediaEl);
        }
    }

    if (allVideos.length === 0 && allImages.length === 0) {
        perfTest.end('performCleanupCheck', perfStart, { cardCount: cardSource.length, detail: 'no media' });
        return;
    }

    const cardsWithMedia = Array.from(cardMediaMap.keys());
    if (cardsWithMedia.length === 0) {
        perfTest.end('performCleanupCheck', perfStart, { cardCount: cardSource.length, detail: 'no active cards' });
        return;
    }

    // Batch all getBoundingClientRect calls together to minimize layout thrashing
    const rects = cardsWithMedia.map(card => getCachedCardRect(card));

    // Build card → rect lookup for reuse in passes 2 & 3 (avoids re-querying rects)
    const cardToRect = new Map();
    cardsWithMedia.forEach((card, i) => cardToRect.set(card, rects[i]));

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
        // Use mediaToCard inverse lookup instead of .closest() DOM walk
        const videoCards = allVideos.map(video => mediaToCard.get(video)).filter(Boolean);

        const viewportCenterY = bounds.centerY;
        const viewportCenterX = bounds.centerX;
        const videoDistances = allVideos.map((video, index) => {
            const card = videoCards[index];
            if (!card) return { video, distance: Infinity };
            const rect = cardToRect.get(card) || getCachedCardRect(card);
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

        // Use mediaToCard inverse lookup instead of .closest() DOM walk
        const mediaCards = allMedia.map(({ element }) => mediaToCard.get(element)).filter(Boolean);

        const viewportCenterY = bounds.centerY;
        const mediaDistances = allMedia.map(({ element, type }, index) => {
            const card = mediaCards[index];
            if (!card) return { element, distance: Infinity, type };
            const rect = cardToRect.get(card) || getCachedCardRect(card);
            const cardCenterY = rect.top + rect.height / 2;
            const distance = Math.abs(cardCenterY - viewportCenterY);
            return { element, distance, type };
        });

        mediaDistances.sort((a, b) => b.distance - a.distance);
        const toRemove = mediaDistances.slice(safetyThreshold);
        let removedVideos = 0, removedImages = 0;
        toRemove.forEach(({ element, type }) => {
            if (type === 'video') {
                destroyVideoElement(element);
                removedVideos++;
            } else {
                destroyImageElement(element);
                removedImages++;
            }
            cleaned = true;
        });

        activeVideoCount = allVideos.length - removedVideos;
        activeImageCount = allImages.length - removedImages;
    } else {
        activeVideoCount = allVideos.length;
        activeImageCount = allImages.length;
    }

    if (cleaned) {
        scheduleGC();
    }
    const removedCount = destroyedVideos.size + destroyedImages.size;
    perfTest.end('performCleanupCheck', perfStart, {
        cardCount: cardsWithMedia.length,
        detail: `${removedCount} removed, ${allVideos.length} videos, ${allImages.length} images`
    });
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
    if (cleanupScrollListenerAttached) {
        gridContainer.removeEventListener('scroll', handleGridScroll);
        cleanupScrollListenerAttached = false;
    }
}

// Track window minimized state
let isWindowMinimized = false;
let isLightboxOpen = false;
let isWindowBlurred = false;

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
            playPromise.catch(() => {}); // autoplay restrictions — intentional silent
        }
    });
    // Restore animated GIFs by hiding static overlay
    const allOverlays = gridContainer.querySelectorAll('.gif-static-overlay');
    allOverlays.forEach(overlay => overlay.classList.remove('visible'));
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
let cardRectCacheGeneration = 0; // Increment to invalidate without creating new WeakMap
const imageThumbnailUrlCache = new Map();
const imageThumbnailRequests = new Map();
const videoPosterUrlCache = new Map();
const videoPosterRequests = new Map();
const folderPreviewCache = new Map(); // folderPath → { urls: string[], ts: number }
const folderPreviewRequests = new Map(); // folderPath → Promise (in-flight dedup)
const FOLDER_PREVIEW_CACHE_TTL = 120000; // 2 minutes

// Return already-tracked incremental counters (no DOM traversal needed)
function getMediaCounts() {
    return { videos: activeVideoCount, images: activeImageCount };
}

function getGridViewportRect() {
    if (!gridContainer) {
        return {
            top: 0,
            left: 0,
            right: window.innerWidth,
            bottom: window.innerHeight,
            width: window.innerWidth,
            height: window.innerHeight
        };
    }
    return gridContainer.getBoundingClientRect();
}

function getEffectiveMediaBufferPx(viewportRect = null) {
    const rect = viewportRect || getGridViewportRect();
    const viewportHeight = Math.max(1, rect.height || gridContainer?.clientHeight || window.innerHeight || 1);
    return Math.max(
        MIN_MEDIA_VIEWPORT_BUFFER_PX,
        Math.min(PRELOAD_BUFFER_PX, Math.round(viewportHeight * MAX_MEDIA_VIEWPORT_BUFFER_RATIO))
    );
}

// Optimized function to get preload/cleanup bounds around the grid viewport
function getViewportBounds() {
    const now = Date.now();
    if (cachedViewportBounds && (now - viewportBoundsCacheTime < VIEWPORT_CACHE_TTL)) {
        return cachedViewportBounds;
    }

    const rect = getGridViewportRect();
    const buffer = getEffectiveMediaBufferPx(rect);

    // Update cache
    cachedViewportBounds = {
        top: rect.top - buffer,
        bottom: rect.bottom + buffer,
        left: rect.left - buffer,
        right: rect.right + buffer,
        centerX: rect.left + (rect.width / 2),
        centerY: rect.top + (rect.height / 2)
    };
    viewportBoundsCacheTime = now;

    return cachedViewportBounds;
}

function setCachedUrl(cache, key, value, maxEntries = 500) {
    cache.set(key, value);
    if (cache.size > maxEntries) {
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) {
            cache.delete(firstKey);
        }
    }
}

// Promote a cache entry to most-recently-used (for LRU eviction with setCachedUrl)
function getCachedUrl(cache, key) {
    const value = cache.get(key);
    if (value !== undefined) {
        cache.delete(key);
        cache.set(key, value);
    }
    return value;
}

function getImageThumbnailCacheKey(filePath, maxSize) {
    return `${filePath}|${maxSize}`;
}

// --- Thumbnail batch queue ---
// Accumulates individual thumbnail requests and flushes them as a single batch IPC call
// every animation frame, reducing IPC round-trip overhead for large folders.
const _thumbnailBatchQueue = [];
let _thumbnailBatchTimer = null;
const THUMBNAIL_BATCH_MAX = 50;

function _flushThumbnailBatch() {
    _thumbnailBatchTimer = null;
    if (_thumbnailBatchQueue.length === 0) return;

    const batch = _thumbnailBatchQueue.splice(0, THUMBNAIL_BATCH_MAX);

    // If batch API not available, fall back to individual calls
    if (!window.electronAPI?.generateThumbnailBatch) {
        for (const item of batch) {
            const fallback = item.type === 'video'
                ? window.electronAPI.generateVideoThumbnail(item.filePath)
                : window.electronAPI.generateImageThumbnail(item.filePath, item.maxSize);
            fallback
                .then(result => {
                    const url = result && result.ok && result.value && result.value.url ? result.value.url : null;
                    item.resolve(url);
                })
                .catch(() => item.resolve(null));
        }
        // Schedule next flush if items remain
        if (_thumbnailBatchQueue.length > 0) {
            _thumbnailBatchTimer = requestAnimationFrame(_flushThumbnailBatch);
        }
        return;
    }

    const batchItems = batch.map(item => ({
        filePath: item.filePath,
        type: item.type,
        maxSize: item.maxSize
    }));

    window.electronAPI.generateThumbnailBatch(batchItems)
        .then(response => {
            const results = response && response.ok ? response.value : null;
            for (let i = 0; i < batch.length; i++) {
                const r = results ? results[i] : null;
                const url = r && r.ok && r.url ? r.url : null;
                batch[i].resolve(url);
            }
        })
        .catch(() => {
            for (const item of batch) item.resolve(null);
        });

    // Schedule next flush if items remain in queue
    if (_thumbnailBatchQueue.length > 0) {
        _thumbnailBatchTimer = requestAnimationFrame(_flushThumbnailBatch);
    }
}

function _enqueueThumbnailRequest(type, filePath, maxSize) {
    return new Promise((resolve) => {
        _thumbnailBatchQueue.push({ type, filePath, maxSize, resolve });
        if (!_thumbnailBatchTimer) {
            _thumbnailBatchTimer = requestAnimationFrame(_flushThumbnailBatch);
        }
    });
}

// ── Off-thread image decoder + ImageBitmap LRU cache ──────────────────
// createImageBitmap runs in a worker, so decoding never blocks the main thread.
// Decoded bitmaps are cached; scrolling back to previously-seen cards is instant.

const BITMAP_CACHE_MAX = 300; // ~150MB at typical card sizes
const _bitmapCache = new Map(); // url -> { bitmap, w, h, lru }
let _bitmapCacheLru = 0;
let _decodeWorker = null;
let _decodeNextId = 0;
const _decodePending = new Map(); // id -> {resolve, reject}
const _decodeUrlInFlight = new Map(); // url -> Promise<ImageBitmap> (dedup concurrent requests)

function getDecodeWorker() {
    if (_decodeWorker) return _decodeWorker;
    try {
        _decodeWorker = new Worker('image-decode-worker.js');
        _decodeWorker.onmessage = (e) => {
            const msg = e.data;
            if (!msg) return;
            const entry = _decodePending.get(msg.id);
            if (!entry) return;
            _decodePending.delete(msg.id);
            if (msg.type === 'decoded') entry.resolve(msg.bitmap);
            else entry.reject(new Error(msg.error || 'decode failed'));
        };
        _decodeWorker.onerror = (err) => { console.error('image-decode-worker error:', err); };
    } catch (e) {
        console.warn('Failed to spawn image decode worker:', e);
        _decodeWorker = null;
    }
    return _decodeWorker;
}

/** Decode an image URL to ImageBitmap off-thread. Returns Promise<ImageBitmap|null>. */
function decodeImageOffThread(url, maxWidth = 0, maxHeight = 0) {
    // Dedup concurrent decodes of the same URL
    const existing = _decodeUrlInFlight.get(url);
    if (existing) return existing;

    const worker = getDecodeWorker();
    if (!worker) return Promise.resolve(null);

    const id = ++_decodeNextId;
    const promise = new Promise((resolve, reject) => {
        _decodePending.set(id, { resolve, reject });
        worker.postMessage({ type: 'decode', id, url, maxWidth, maxHeight });
    }).finally(() => { _decodeUrlInFlight.delete(url); });

    _decodeUrlInFlight.set(url, promise);
    return promise;
}

// Stats for diagnostics
let _bitmapStats = { hits: 0, misses: 0, decodes: 0, decodeMs: 0, evictions: 0, lastPrint: 0 };
function _bitmapDiag() {
    const total = _bitmapStats.hits + _bitmapStats.misses;
    if (total - _bitmapStats.lastPrint < 50) return;
    _bitmapStats.lastPrint = total;
    const avgMs = _bitmapStats.decodes ? (_bitmapStats.decodeMs / _bitmapStats.decodes).toFixed(1) : 'n/a';
    console.log(
        `[bitmap-cache] cached=${_bitmapCache.size}/${BITMAP_CACHE_MAX} ` +
        `hits=${_bitmapStats.hits} misses=${_bitmapStats.misses} ` +
        `decodes=${_bitmapStats.decodes} (avg ${avgMs}ms) evictions=${_bitmapStats.evictions}`
    );
}

function evictBitmapEntry(url) {
    const entry = _bitmapCache.get(url);
    if (!entry) return;
    try { entry.bitmap.close(); } catch {}
    _bitmapCache.delete(url);
}

function getCachedBitmap(url) {
    const entry = _bitmapCache.get(url);
    if (!entry) { _bitmapStats.misses++; _bitmapDiag(); return null; }
    _bitmapStats.hits++;
    _bitmapDiag();
    entry.lru = ++_bitmapCacheLru;
    return entry;
}

/** Clear all cached bitmaps (called on folder navigation to free GPU memory). */
function clearBitmapCache() {
    for (const entry of _bitmapCache.values()) {
        try { entry.bitmap.close(); } catch {}
    }
    _bitmapCache.clear();
}

function putCachedBitmap(url, bitmap) {
    if (!bitmap) return;
    const existing = _bitmapCache.get(url);
    if (existing) {
        // Close the old one to free GPU memory
        try { existing.bitmap.close(); } catch {}
    }
    _bitmapCache.set(url, {
        bitmap,
        w: bitmap.width,
        h: bitmap.height,
        lru: ++_bitmapCacheLru
    });
    // Evict oldest if over limit
    if (_bitmapCache.size > BITMAP_CACHE_MAX) {
        let oldestUrl = null, oldestLru = Infinity;
        for (const [k, v] of _bitmapCache) {
            if (v.lru < oldestLru) { oldestLru = v.lru; oldestUrl = k; }
        }
        if (oldestUrl) {
            const victim = _bitmapCache.get(oldestUrl);
            try { victim.bitmap.close(); } catch {}
            _bitmapCache.delete(oldestUrl);
            _bitmapStats.evictions++;
        }
    }
}

/**
 * Prefetch an image into the bitmap cache without displaying it.
 * Idempotent; safe to call multiple times. Returns a promise that resolves when cached.
 */
function prefetchImageBitmap(url, maxWidth = 0, maxHeight = 0) {
    if (!url) return Promise.resolve(null);
    // Don't touch stats here — this is prefetching, not a cache hit/miss query
    if (_bitmapCache.has(url)) return Promise.resolve(_bitmapCache.get(url).bitmap);
    const t0 = performance.now();
    return decodeImageOffThread(url, maxWidth, maxHeight).then(bitmap => {
        _bitmapStats.decodes++;
        _bitmapStats.decodeMs += performance.now() - t0;
        if (bitmap) putCachedBitmap(url, bitmap);
        return bitmap;
    }).catch(() => null);
}

/**
 * Draw a cached or freshly-decoded bitmap to a canvas context.
 * Returns true if drawn synchronously (cache hit), false if drawing async.
 */
function drawBitmapToCanvas(canvas, url, onDrawn) {
    const cached = getCachedBitmap(url);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (cached) {
        ctx.drawImage(cached.bitmap, 0, 0, canvas.width, canvas.height);
        if (onDrawn) onDrawn(true, cached.w, cached.h);
        return true;
    }
    // Async path
    decodeImageOffThread(url, canvas.width, canvas.height).then(bitmap => {
        if (!bitmap) { if (onDrawn) onDrawn(false, 0, 0); return; }
        putCachedBitmap(url, bitmap);
        // Redraw if still connected (card may have been recycled)
        if (canvas.isConnected) {
            ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            if (onDrawn) onDrawn(true, bitmap.width, bitmap.height);
        } else {
            if (onDrawn) onDrawn(false, bitmap.width, bitmap.height);
        }
    }).catch(() => { if (onDrawn) onDrawn(false, 0, 0); });
    return false;
}

function requestImageThumbnailUrl(filePath, maxSize) {
    const key = getImageThumbnailCacheKey(filePath, maxSize);
    const cachedImgUrl = getCachedUrl(imageThumbnailUrlCache, key);
    if (cachedImgUrl !== undefined) {
        return Promise.resolve(cachedImgUrl);
    }
    if (imageThumbnailRequests.has(key)) {
        return imageThumbnailRequests.get(key);
    }

    const request = _enqueueThumbnailRequest('image', filePath, maxSize)
        .then(url => {
            if (url) {
                setCachedUrl(imageThumbnailUrlCache, key, url);
            }
            return url;
        })
        .finally(() => {
            imageThumbnailRequests.delete(key);
        });

    imageThumbnailRequests.set(key, request);
    return request;
}

function requestVideoPosterUrl(filePath) {
    const cachedPosterUrl = getCachedUrl(videoPosterUrlCache, filePath);
    if (cachedPosterUrl !== undefined) {
        return Promise.resolve(cachedPosterUrl);
    }
    if (videoPosterRequests.has(filePath)) {
        return videoPosterRequests.get(filePath);
    }

    const request = _enqueueThumbnailRequest('video', filePath)
        .then(url => {
            if (url) {
                setCachedUrl(videoPosterUrlCache, filePath, url);
            }
            return url;
        })
        .finally(() => {
            videoPosterRequests.delete(filePath);
        });

    videoPosterRequests.set(filePath, request);
    return request;
}

/**
 * Request folder preview thumbnail URLs for a given folder path.
 * Uses in-memory cache with TTL and deduplicates in-flight requests.
 */
function requestFolderPreview(folderPath) {
    const cached = folderPreviewCache.get(folderPath);
    if (cached && Date.now() - cached.ts < FOLDER_PREVIEW_CACHE_TTL) {
        return Promise.resolve(cached.urls);
    }
    if (folderPreviewRequests.has(folderPath)) {
        return folderPreviewRequests.get(folderPath);
    }

    const request = window.electronAPI.getFolderPreview(folderPath, folderPreviewCountSetting)
        .then(resp => {
            const results = resp && resp.ok ? (resp.value || []) : [];
            const urls = results.filter(r => r.url).map(r => r.url);
            folderPreviewCache.set(folderPath, { urls, ts: Date.now() });
            // Cap cache size
            if (folderPreviewCache.size > FOLDER_PREVIEW_CACHE_MAX_SIZE) {
                const firstKey = folderPreviewCache.keys().next().value;
                folderPreviewCache.delete(firstKey);
            }
            return urls;
        })
        .catch(() => [])
        .finally(() => {
            folderPreviewRequests.delete(folderPath);
        });

    folderPreviewRequests.set(folderPath, request);
    return request;
}

/**
 * Load folder preview thumbnails into a folder card.
 * Creates a 2x2 CSS grid of background-image cells.
 */
async function loadFolderPreview(card) {
    const folderPath = card.dataset.folderPath;
    if (!folderPath || card.dataset.previewLoaded === '1' || card.dataset.previewLoading === '1') return;
    card.dataset.previewLoading = '1';

    try {
        const urls = await requestFolderPreview(folderPath);

        // Stale card check — virtual scroll may have recycled this card
        if (card.dataset.folderPath !== folderPath) return;

        if (!urls || urls.length === 0) {
            delete card.dataset.previewLoading;
            return;
        }

        const grid = document.createElement('div');
        grid.className = 'folder-preview-grid';
        const count = Math.min(urls.length, folderPreviewCountSetting);
        if (count <= 3) {
            grid.classList.add(`folder-preview-${count}`);
        } else {
            // Dynamic grid: compute columns/rows for 4+ images
            const cols = Math.ceil(Math.sqrt(count));
            const rows = Math.ceil(count / cols);
            grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
            grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
        }

        for (const url of urls.slice(0, count)) {
            const cell = document.createElement('div');
            cell.className = 'folder-preview-cell';
            cell.style.backgroundImage = `url("${url.replace(/"/g, '\\"')}")`;
            grid.appendChild(cell);
        }

        // Insert before folder-info so info label stays on top
        const info = card.querySelector('.folder-info');
        if (info) {
            card.insertBefore(grid, info);
        } else {
            card.appendChild(grid);
        }

        card.dataset.previewLoaded = '1';
    } catch {
        // Silently fail — folder icon remains
    } finally {
        delete card.dataset.previewLoading;
    }
}

// Optimized function to check if card is in preload zone
// Uses the grid viewport plus a small warm buffer.
function isCardInPreloadZone(card) {
    const cardRect = getCachedCardRect(card);
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
    const now = Date.now();
    const cached = cardRectCache.get(card);
    if (cached && cached.generation === cardRectCacheGeneration && (now - cached.timestamp) < CARD_RECT_CACHE_TTL) {
        return cached.rect;
    }
    const rect = card.getBoundingClientRect();
    cardRectCache.set(card, { rect, timestamp: now, generation: cardRectCacheGeneration });
    return rect;
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

// Moving-image extension check (gif/webp treated as videos when includeMovingImages is ON)
function _isMovingImageExt(name) {
    if (!name) return false;
    const n = name.toLowerCase();
    return n.endsWith('.gif') || n.endsWith('.webp');
}

// Color mapping for file extensions (user-customizable)
const DEFAULT_EXTENSION_COLORS = {
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
let extensionColors = { ...DEFAULT_EXTENSION_COLORS };
try {
    const saved = localStorage.getItem('extensionColors');
    if (saved) Object.assign(extensionColors, JSON.parse(saved));
} catch { /* use defaults */ }

// Helper function to get color for extension
function getExtensionColor(extension) {
    return extensionColors[extension] || '#888888'; // Default gray for unknown extensions
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

// ═══════════════════════════════════════════════════════════════════════════
// CARD RENDERING HELPERS
// ═══════════════════════════════════════════════════════════════════════════
function formatBytesForCardLabel(bytes) {
    if (bytes == null || bytes <= 0 || !isFinite(bytes)) return '';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}

function formatMediaDuration(seconds) {
    if (seconds == null || !isFinite(seconds) || seconds < 0) return '';
    const total = Math.floor(seconds);
    const s = total % 60;
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function formatCardDate(mtimeMs) {
    if (!mtimeMs || mtimeMs <= 0) return '';
    try {
        return new Date(mtimeMs).toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch {
        return '';
    }
}

function syncCardInfoToggleLabels() {
    if (cardInfoExtensionLabel) cardInfoExtensionLabel.textContent = cardInfoSettings.extension ? 'On' : 'Off';
    if (cardInfoResolutionLabel) cardInfoResolutionLabel.textContent = cardInfoSettings.resolution ? 'On' : 'Off';
    if (cardInfoSizeLabel) cardInfoSizeLabel.textContent = cardInfoSettings.fileSize ? 'On' : 'Off';
    if (cardInfoDateLabel) cardInfoDateLabel.textContent = cardInfoSettings.date ? 'On' : 'Off';
    if (cardInfoDurationLabel) cardInfoDurationLabel.textContent = cardInfoSettings.duration ? 'On' : 'Off';
    if (cardInfoStarsLabel) cardInfoStarsLabel.textContent = cardInfoSettings.starRating ? 'On' : 'Off';
    if (cardInfoAudioLabel) cardInfoAudioLabel.textContent = cardInfoSettings.audioLabel ? 'On' : 'Off';
    if (cardInfoFilenameLabel) cardInfoFilenameLabel.textContent = cardInfoSettings.filename ? 'On' : 'Off';
    if (cardInfoTagsLabel) cardInfoTagsLabel.textContent = cardInfoSettings.tags ? 'On' : 'Off';
    // Hover sub-toggle labels + row visibility
    if (cardInfoExtensionHoverLabel) cardInfoExtensionHoverLabel.textContent = cardInfoSettings.extensionOnlyOnHover ? 'On' : 'Off';
    if (cardInfoExtensionHoverRow) cardInfoExtensionHoverRow.classList.toggle('hidden', !cardInfoSettings.extension);
    if (cardInfoResolutionHoverLabel) cardInfoResolutionHoverLabel.textContent = cardInfoSettings.resolutionOnlyOnHover ? 'On' : 'Off';
    if (cardInfoResolutionHoverRow) cardInfoResolutionHoverRow.classList.toggle('hidden', !cardInfoSettings.resolution);
    if (cardInfoSizeHoverLabel) cardInfoSizeHoverLabel.textContent = cardInfoSettings.fileSizeOnlyOnHover ? 'On' : 'Off';
    if (cardInfoSizeHoverRow) cardInfoSizeHoverRow.classList.toggle('hidden', !cardInfoSettings.fileSize);
    if (cardInfoDateHoverLabel) cardInfoDateHoverLabel.textContent = cardInfoSettings.dateOnlyOnHover ? 'On' : 'Off';
    if (cardInfoDateHoverRow) cardInfoDateHoverRow.classList.toggle('hidden', !cardInfoSettings.date);
    if (cardInfoStarsHoverLabel) cardInfoStarsHoverLabel.textContent = cardInfoSettings.starRatingOnlyOnHover ? 'On' : 'Off';
    if (cardInfoStarsHoverRow) cardInfoStarsHoverRow.classList.toggle('hidden', !cardInfoSettings.starRating);
    if (cardInfoAudioHoverLabel) cardInfoAudioHoverLabel.textContent = cardInfoSettings.audioLabelOnlyOnHover ? 'On' : 'Off';
    if (cardInfoAudioHoverRow) cardInfoAudioHoverRow.classList.toggle('hidden', !cardInfoSettings.audioLabel);
    if (cardInfoFilenameHoverLabel) cardInfoFilenameHoverLabel.textContent = cardInfoSettings.filenameOnlyOnHover ? 'On' : 'Off';
    if (cardInfoFilenameHoverRow) cardInfoFilenameHoverRow.classList.toggle('hidden', !cardInfoSettings.filename);
    if (cardInfoTagsHoverLabel) cardInfoTagsHoverLabel.textContent = cardInfoSettings.tagsOnlyOnHover ? 'On' : 'Off';
    if (cardInfoTagsHoverRow) cardInfoTagsHoverRow.classList.toggle('hidden', !cardInfoSettings.tags);
    if (cardInfoHoverTooltipLabel) cardInfoHoverTooltipLabel.textContent = cardInfoSettings.hoverTooltip ? 'On' : 'Off';
}

function syncCardInfoTogglesFromState() {
    if (cardInfoExtensionToggle) cardInfoExtensionToggle.checked = cardInfoSettings.extension;
    if (cardInfoResolutionToggle) cardInfoResolutionToggle.checked = cardInfoSettings.resolution;
    if (cardInfoSizeToggle) cardInfoSizeToggle.checked = cardInfoSettings.fileSize;
    if (cardInfoDateToggle) cardInfoDateToggle.checked = cardInfoSettings.date;
    if (cardInfoDurationToggle) cardInfoDurationToggle.checked = cardInfoSettings.duration;
    if (cardInfoStarsToggle) cardInfoStarsToggle.checked = cardInfoSettings.starRating;
    if (cardInfoAudioToggle) cardInfoAudioToggle.checked = cardInfoSettings.audioLabel;
    if (cardInfoFilenameToggle) cardInfoFilenameToggle.checked = cardInfoSettings.filename;
    if (cardInfoTagsToggle) cardInfoTagsToggle.checked = cardInfoSettings.tags;
    if (cardInfoExtensionHoverToggle) cardInfoExtensionHoverToggle.checked = cardInfoSettings.extensionOnlyOnHover;
    if (cardInfoResolutionHoverToggle) cardInfoResolutionHoverToggle.checked = cardInfoSettings.resolutionOnlyOnHover;
    if (cardInfoSizeHoverToggle) cardInfoSizeHoverToggle.checked = cardInfoSettings.fileSizeOnlyOnHover;
    if (cardInfoDateHoverToggle) cardInfoDateHoverToggle.checked = cardInfoSettings.dateOnlyOnHover;
    if (cardInfoStarsHoverToggle) cardInfoStarsHoverToggle.checked = cardInfoSettings.starRatingOnlyOnHover;
    if (cardInfoAudioHoverToggle) cardInfoAudioHoverToggle.checked = cardInfoSettings.audioLabelOnlyOnHover;
    if (cardInfoFilenameHoverToggle) cardInfoFilenameHoverToggle.checked = cardInfoSettings.filenameOnlyOnHover;
    if (cardInfoTagsHoverToggle) cardInfoTagsHoverToggle.checked = cardInfoSettings.tagsOnlyOnHover;
    if (cardInfoHoverTooltipToggle) cardInfoHoverTooltipToggle.checked = cardInfoSettings.hoverTooltip;
    syncCardInfoToggleLabels();
}

function hydrateCardInfoSettings() {
    try {
        const raw = localStorage.getItem('cardInfoSettings');
        if (raw) {
            const parsed = JSON.parse(raw);
            for (const key of Object.keys(DEFAULT_CARD_INFO)) {
                if (typeof parsed[key] === 'boolean') {
                    cardInfoSettings[key] = parsed[key];
                }
            }
        }
    } catch {
        /* use defaults */
    }
    syncCardInfoTogglesFromState();
}

function saveCardInfoSettings() {
    deferLocalStorageWrite('cardInfoSettings', JSON.stringify(cardInfoSettings));
}

function onCardInfoSettingsChanged() {
    const previous = { ...cardInfoSettings };
    cardInfoSettings.extension = !!cardInfoExtensionToggle?.checked;
    cardInfoSettings.resolution = !!cardInfoResolutionToggle?.checked;
    cardInfoSettings.fileSize = !!cardInfoSizeToggle?.checked;
    cardInfoSettings.date = !!cardInfoDateToggle?.checked;
    cardInfoSettings.duration = !!cardInfoDurationToggle?.checked;
    cardInfoSettings.starRating = !!cardInfoStarsToggle?.checked;
    cardInfoSettings.audioLabel = !!cardInfoAudioToggle?.checked;
    cardInfoSettings.filename = !!cardInfoFilenameToggle?.checked;
    cardInfoSettings.tags = !!cardInfoTagsToggle?.checked;
    cardInfoSettings.extensionOnlyOnHover = !!cardInfoExtensionHoverToggle?.checked;
    cardInfoSettings.resolutionOnlyOnHover = !!cardInfoResolutionHoverToggle?.checked;
    cardInfoSettings.fileSizeOnlyOnHover = !!cardInfoSizeHoverToggle?.checked;
    cardInfoSettings.dateOnlyOnHover = !!cardInfoDateHoverToggle?.checked;
    cardInfoSettings.starRatingOnlyOnHover = !!cardInfoStarsHoverToggle?.checked;
    cardInfoSettings.audioLabelOnlyOnHover = !!cardInfoAudioHoverToggle?.checked;
    cardInfoSettings.filenameOnlyOnHover = !!cardInfoFilenameHoverToggle?.checked;
    cardInfoSettings.tagsOnlyOnHover = !!cardInfoTagsHoverToggle?.checked;
    cardInfoSettings.hoverTooltip = !!cardInfoHoverTooltipToggle?.checked;
    // Hide any existing tooltip immediately when setting is turned off
    if (!cardInfoSettings.hoverTooltip && typeof _hideCardTooltip === 'function') _hideCardTooltip();
    syncCardInfoToggleLabels();
    saveCardInfoSettings();
    refreshAllVisibleMediaCardInfo();

    // If size/date was just enabled but current items were loaded with skipStats,
    // refresh folder data once so metadata chips can populate.
    const needsStatsNow = cardInfoSettings.fileSize || cardInfoSettings.date;
    const neededBefore = previous.fileSize || previous.date;
    if (needsStatsNow && !neededBefore && currentFolderPath) {
        const hasMissingStats = currentItems.some(item =>
            item.type !== 'folder' && ((!item.mtime && cardInfoSettings.date) || ((item.size == null || item.size <= 0) && cardInfoSettings.fileSize))
        );
        if (hasMissingStats) {
            loadVideos(currentFolderPath, false, gridContainer.scrollTop);
        }
    }
}

function getMediaItemForCard(card) {
    const path = card.dataset.path;
    if (!path) return null;
    if (typeof card._vsItemIndex === 'number' && vsState.sortedItems[card._vsItemIndex]) {
        const it = vsState.sortedItems[card._vsItemIndex];
        if (it && it.path === path) return it;
    }
    const found = currentItems.find(i => i.path === path);
    return found || null;
}

function syncCardMetaRow(card, item, _durationSec) {
    const stub = item || {};
    const mtime = stub.mtime != null ? stub.mtime : Number(card.dataset.mtime || 0);
    const size = stub.size != null ? stub.size : (card.dataset.fileSize ? Number(card.dataset.fileSize) : 0);

    const showSize = cardInfoSettings.fileSize && size > 0;
    const showDate = cardInfoSettings.date && mtime > 0;

    let row = card.querySelector('.card-meta-row');
    const hasResChip = row?.querySelector('.resolution-chip');

    if (!showSize && !showDate && !hasResChip) {
        row?.remove();
        return;
    }

    if (!row) {
        row = document.createElement('div');
        row.className = 'card-meta-row';
        const infoEl = card.querySelector('.video-info');
        if (infoEl) card.insertBefore(row, infoEl);
        else card.appendChild(row);
    }

    // Clear non-resolution chips, preserve resolution chip managed by createResolutionLabel
    row.querySelectorAll('.card-meta-chip:not(.resolution-chip)').forEach(el => el.remove());
    if (showSize) {
        const span = document.createElement('span');
        span.className = 'card-meta-chip';
        span.textContent = formatBytesForCardLabel(size);
        row.appendChild(span);
    }
    if (showDate) {
        const span = document.createElement('span');
        span.className = 'card-meta-chip';
        span.textContent = formatCardDate(mtime);
        row.appendChild(span);
    }
}

function applyCardInfoStarRatingVisibility(card) {
    const el = card.querySelector('.star-rating');
    if (!el) return;
    el.style.display = cardInfoSettings.starRating ? '' : 'none';
}

function syncPinIndicator(card, filePath) {
    let pinEl = card.querySelector('.pin-indicator');
    if (isFilePinned(filePath)) {
        if (!pinEl) {
            pinEl = document.createElement('div');
            pinEl.className = 'pin-indicator';
            card.appendChild(pinEl);
        }
        pinEl.style.display = '';
    } else if (pinEl) {
        pinEl.style.display = 'none';
    }
}

function syncStarRatingOnCard(card, filePath) {
    let starEl = card.querySelector('.star-rating');
    if (cardInfoSettings.starRating) {
        const rating = getFileRating(filePath);
        if (!starEl) {
            starEl = getStarRatingElement(rating);
            const infoEl = card.querySelector('.video-info');
            if (infoEl) card.insertBefore(starEl, infoEl);
            else card.appendChild(starEl);
        }
        starEl.style.display = '';
    } else if (starEl) {
        starEl.remove();
    }
}

function applyCardInfoVisibility(card) {
    const ext = card.querySelector('.extension-label');
    if (ext) ext.style.display = cardInfoSettings.extension ? '' : 'none';
    const snd = card.querySelector('.sound-label');
    if (snd) snd.style.display = cardInfoSettings.audioLabel ? '' : 'none';
    const info = card.querySelector('.video-info');
    if (info) info.style.display = cardInfoSettings.filename ? '' : 'none';
    const tags = card.querySelector('.card-tags');
    if (tags) tags.style.display = cardInfoSettings.tags ? '' : 'none';
}

function applyCardInfoLayoutClasses(card) {
    card.classList.toggle('ci-no-ext', !cardInfoSettings.extension);
    card.classList.toggle('ci-no-filename', !cardInfoSettings.filename);
    card.classList.toggle('ci-no-stars', !cardInfoSettings.starRating);
    card.classList.toggle('ci-no-audio', !cardInfoSettings.audioLabel);
    card.classList.toggle('ci-no-tags', !cardInfoSettings.tags);
    // Hover-only classes for always-visible labels
    card.classList.toggle('ci-ext-hover', cardInfoSettings.extension && cardInfoSettings.extensionOnlyOnHover);
    card.classList.toggle('ci-audio-hover', cardInfoSettings.audioLabel && cardInfoSettings.audioLabelOnlyOnHover);
    // Always-show classes for hover-only labels
    card.classList.toggle('ci-filename-always', cardInfoSettings.filename && !cardInfoSettings.filenameOnlyOnHover);
    card.classList.toggle('ci-stars-always', cardInfoSettings.starRating && !cardInfoSettings.starRatingOnlyOnHover);
    card.classList.toggle('ci-tags-hover', cardInfoSettings.tags && cardInfoSettings.tagsOnlyOnHover);
    // Meta-row: always-show if any chip has always-show
    const metaAlways = (cardInfoSettings.resolution && !cardInfoSettings.resolutionOnlyOnHover)
        || (cardInfoSettings.fileSize && !cardInfoSettings.fileSizeOnlyOnHover)
        || (cardInfoSettings.date && !cardInfoSettings.dateOnlyOnHover);
    card.classList.toggle('ci-meta-always', metaAlways);
}

function refreshAllVisibleMediaCardInfo() {
    const cards = vsState.enabled && vsState.activeCards.size > 0
        ? Array.from(vsState.activeCards.values())
        : Array.from(gridContainer.querySelectorAll('.video-card'));

    for (const card of cards) {
        if (!card.classList.contains('video-card')) continue;
        delete card.dataset.tagOverlapChecked;

        const item = getMediaItemForCard(card);
        const video = card.querySelector('video.media-thumbnail, video');
        const dur = video && isFinite(video.duration) && video.duration > 0 ? video.duration : null;

        syncCardMetaRow(card, item, dur);
        syncStarRatingOnCard(card, item?.path || card.dataset.path);
        if (!cardInfoSettings.duration && typeof hideScrubber === 'function') {
            hideScrubber(card);
        }

        const w = item?.width || parseInt(card.dataset.width || '0', 10);
        const h = item?.height || parseInt(card.dataset.height || '0', 10);
        createResolutionLabel(card, w, h);

        applyCardInfoVisibility(card);

        // Apply responsive layout classes
        applyCardInfoLayoutClasses(card);
    }
}

// Create or update resolution chip inside the card-meta-row
function createResolutionLabel(card, width, height) {
    // Remove legacy standalone label if present
    card.querySelector('.resolution-label')?.remove();

    if (!cardInfoSettings.resolution) {
        const existing = card.querySelector('.resolution-chip');
        if (existing) {
            const row = existing.parentElement;
            existing.remove();
            if (row && row.classList.contains('card-meta-row') && !row.children.length) row.remove();
        }
        return;
    }
    if (!width || !height) return;

    // Find or create the meta-row
    let row = card.querySelector('.card-meta-row');
    if (!row) {
        row = document.createElement('div');
        row.className = 'card-meta-row';
        const infoEl = card.querySelector('.video-info');
        if (infoEl) card.insertBefore(row, infoEl);
        else card.appendChild(row);
    }

    // Find or create the resolution chip
    let chip = row.querySelector('.resolution-chip');
    if (!chip) {
        chip = document.createElement('span');
        chip.className = 'card-meta-chip resolution-chip';
        row.appendChild(chip);
    }

    const aspectRatio = calculateAspectRatio(width, height);
    chip.textContent = `${width}\u00d7${height} \u2022 ${aspectRatio}`;

    card.dataset.width = width;
    card.dataset.height = height;
}

// Apply aspect ratio to card.
// aspectRatioSource: 'fallback' (placeholder before dimensions), 'prescanned' (folder scan/cache),
// 'metadata' (image/video element), 'hydrated' (background dimension scan)
function applyAspectRatioToCard(card, aspectRatioName, aspectRatioSource) {
    // Remove any existing aspect ratio classes
    card.classList.remove(...ASPECT_RATIOS.map(ar => `aspect-${ar.name.replace(':', '-')}`));
    
    // Add the new aspect ratio class
    const className = `aspect-${aspectRatioName.replace(':', '-')}`;
    card.classList.add(className);
    
    // Store the aspect ratio on the card for persistence
    card.dataset.aspectRatio = aspectRatioName;
    if (aspectRatioSource !== undefined) {
        card.dataset.aspectRatioSource = aspectRatioSource;
    }
    
    // In masonry mode, if this card already has a position (was laid out), update
    // just this card's height in-place. This handles the fallback case where ffprobe
    // wasn't available and media discovers a different aspect ratio after loading.
    // No full relayout needed — cards are absolutely positioned so others aren't affected.
    if (gridContainer.classList.contains('masonry') && card.style.width) {
        const cardWidth = parseFloat(card.style.width);
        if (cardWidth > 0) {
            const aspectRatioValue = vsGetAspectRatioValue(aspectRatioName);
            const newHeight = Math.max(50, cardWidth / aspectRatioValue);
            card.style.height = `${newHeight}px`;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// MASONRY LAYOUT
// ═══════════════════════════════════════════════════════════════════════════
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
        gap: (() => { const v = parseInt(rootStyles.getPropertyValue('--gap')); return isNaN(v) ? 16 : v; })(),
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
                
                const aspectRatioValue = vsGetAspectRatioValue(aspectRatioName);
                
                cardHeight = columnWidth / aspectRatioValue;
                
                if (!cardHeight || cardHeight <= 0 || !isFinite(cardHeight)) {
                    console.warn('Invalid card height calculated:', cardHeight, 'for aspect ratio:', aspectRatioName, 'using default');
                    cardHeight = columnWidth / (16 / 9);
                }
            }
            
            if (cardHeight < 50) {
                cardHeight = 50;
            }
            
            const shortestColumnIndex = getShortestColumnIndex(columnHeights);
            const left = shortestColumnIndex * (columnWidth + gap);
            const top = columnHeights[shortestColumnIndex];

            // Batch all style writes into a single cssText assignment
            card.style.cssText = `position:absolute;width:${columnWidth}px;height:${cardHeight}px;padding-bottom:0;opacity:1;visibility:visible;left:${left}px;top:${top}px`;
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

/** Clear inline position/size styles applied by masonry or virtual scroll. */
function resetCardPositionStyles(card) {
    card.style.position = '';
    card.style.left = '';
    card.style.top = '';
    card.style.translate = '';
    card.style.width = '';
    card.style.height = '';
    card.style.opacity = '';
    card.style.visibility = '';
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
    cards.forEach(resetCardPositionStyles);

    // Initial layout after cards are rendered
    scheduleMasonryLayout();
    
    // Recalculate on window resize (debounced)
    masonryResizeHandler = () => {
        // Invalidate viewport cache on resize
        cachedViewportBounds = null;
        viewportBoundsCacheTime = 0;
        cardRectCacheGeneration++; // Invalidate rect cache on resize
        
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
        resetCardPositionStyles(card);
        card.style.paddingBottom = ''; // Reset padding-bottom to use CSS aspect ratio classes
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

    // With virtual scrolling, recalculate positions for new layout mode
    if (vsState.enabled) {
        vsRecalculate();
    } else {
        // Fallback for non-VS mode
        if (layoutMode === 'masonry') {
            initMasonry();
        } else {
            initGrid();
        }
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

function toggleUseSystemTrash() {
    useSystemTrash = useSystemTrashToggle.checked;
    useSystemTrashLabel.textContent = useSystemTrash ? 'On' : 'Off';
    deferLocalStorageWrite('useSystemTrash', useSystemTrash.toString());
    window.electronAPI.setUseSystemTrash(useSystemTrash);
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
    let filtered = items;
    if (currentFilter === 'video') {
        filtered = filtered.filter(item =>
            item.type === 'video' ||
            (includeMovingImages && item.type === 'image' && _isMovingImageExt(item.name))
        );
    } else if (currentFilter === 'image') {
        filtered = filtered.filter(item =>
            item.type === 'image' &&
            !(includeMovingImages && _isMovingImageExt(item.name))
        );
    }
    if (starFilterActive) {
        filtered = filtered.filter(item => {
            if (item.type === 'folder') return false;
            if (!item.path) return false;
            return getFileRating(item.path) > 0;
        });
    }
    return filtered;
}

// Shared collator for name comparisons — 10-50x faster than per-call localeCompare
// because Intl.Collator reuses the internal ICU engine across all .compare() calls.
const _nameCollator = new Intl.Collator(undefined, { numeric: true });

// Function to sort items based on current sorting preferences.
// Uses a single composite sort to avoid intermediate array allocations —
// pinned state and folder/file type are encoded into the primary sort key
// so no separate partition step is needed.
function sortItems(inputItems) {
    // Work on a copy so we never mutate the caller's array (e.g. currentItems)
    const items = inputItems.slice();
    // AI smart collections sort files by relevance score (highest confidence first),
    // overriding sortType. Matches the manual AI search bar behavior.
    let aiCollectionSort = false;
    if (currentCollectionId) {
        const _col = collectionsCache.find(c => c.id === currentCollectionId);
        if (_col && _col.type === 'smart' && _col.rules && _col.rules.aiQuery) {
            aiCollectionSort = true;
        }
    }

    const ratingSort = (starFilterActive && starSortOrder !== 'none') || sortType === 'rating';
    const ratingOrder = starSortOrder !== 'none' ? starSortOrder : 'desc';
    const ascending = sortOrder === 'ascending';

    // Single composite sort: primary key = group (pinned-folder=0, folder=1, pinned-file=2, file=3)
    // secondary key = existing sort criteria per type
    items.sort((a, b) => {
        const aIsFolder = a.type === 'folder';
        const bIsFolder = b.type === 'folder';
        const aPinned = isFilePinned(a.path || a.folderPath);
        const bPinned = isFilePinned(b.path || b.folderPath);

        // Group: pinned folders (0) > unpinned folders (1) > pinned files (2) > unpinned files (3)
        const aGroup = (aIsFolder ? 0 : 2) + (aPinned ? 0 : 1);
        const bGroup = (bIsFolder ? 0 : 2) + (bPinned ? 0 : 1);
        if (aGroup !== bGroup) return aGroup - bGroup;

        // Within each group, apply the appropriate sort
        let comparison = 0;

        if (aIsFolder) {
            // Folder sort
            if (sortType === 'name') {
                comparison = _nameCollator.compare(a.name, b.name);
            } else if (sortType === 'date') {
                comparison = (a.mtime || 0) - (b.mtime || 0);
                if (comparison === 0) comparison = _nameCollator.compare(a.name, b.name);
            }
            return ascending ? comparison : -comparison;
        }

        // File sort
        if (aiCollectionSort) {
            comparison = (b._aiScore || 0) - (a._aiScore || 0);
            if (comparison === 0) comparison = _nameCollator.compare(a.name, b.name);
            return comparison;
        } else if (ratingSort) {
            const aRating = a._cachedRating ?? getFileRating(a.path);
            const bRating = b._cachedRating ?? getFileRating(b.path);
            comparison = ratingOrder === 'asc' ? aRating - bRating : bRating - aRating;
            if (comparison === 0) comparison = _nameCollator.compare(a.name, b.name);
            return comparison;
        } else if (sortType === 'name') {
            comparison = _nameCollator.compare(a.name, b.name);
        } else if (sortType === 'date') {
            comparison = (a.mtime || 0) - (b.mtime || 0);
            if (comparison === 0) comparison = _nameCollator.compare(a.name, b.name);
        } else if (sortType === 'size') {
            comparison = (a.size || 0) - (b.size || 0);
            if (comparison === 0) comparison = _nameCollator.compare(a.name, b.name);
        } else if (sortType === 'dimensions') {
            comparison = ((a.width || 0) * (a.height || 0)) - ((b.width || 0) * (b.height || 0));
            if (comparison === 0) comparison = _nameCollator.compare(a.name, b.name);
        }
        return ascending ? comparison : -comparison;
    });

    // Extract files portion for date grouping (folders are already at front)
    if (groupByDate) {
        let firstFileIdx = 0;
        while (firstFileIdx < items.length && items[firstFileIdx].type === 'folder') firstFileIdx++;
        if (firstFileIdx < items.length) {
            const folderPart = items.slice(0, firstFileIdx);
            const filePart = items.slice(firstFileIdx);
            vsState.groupHeadersPresent = true;
            return folderPart.concat(injectDateGroupHeaders(filePart));
        }
    }
    vsState.groupHeadersPresent = false;
    return items;
}

// Function to apply sorting and reload current folder.
// Delegates to applyFilters() which routes through the filter-sort worker,
// keeping the main thread free. Falls back to synchronous path automatically
// if the worker is unavailable.
function applySorting() {
    if (currentFolderPath && currentItems.length > 0) {
        // If sorting by date but items lack mtime (were loaded with skipStats),
        // reload from backend to get file stats
        const needsStats = (sortType === 'date' || groupByDate) && currentItems.some(item => item.type !== 'folder' && !item.mtime);
        if (needsStats) {
            loadVideos(currentFolderPath, false, gridContainer.scrollTop);
            return;
        }
        // Delegate to the worker-backed filter/sort pipeline (handles sort + filter + group headers)
        applyFilters();
    } else if (currentFolderPath) {
        // If no items cached, reload from backend
        loadVideos(currentFolderPath, true, gridContainer.scrollTop);
    }
}

// Progressive rendering uses constants defined at top of file

// Card animation counter for stagger effect
let cardAnimIndex = 0;

// Function to create a card element from an item
function createCardFromItem(item, skipAnimation = false) {
    if (item.type === 'group-header') {
        const card = document.createElement('div');
        card.className = 'date-group-header';
        card.dataset.groupKey = item.groupKey;
        const toggleEl = document.createElement('button');
        toggleEl.className = 'dgh-toggle';
        toggleEl.textContent = collapsedDateGroups.has(item.groupKey) ? '▶' : '▼';
        const labelEl = document.createElement('span');
        labelEl.className = 'dgh-label';
        labelEl.textContent = item.label;
        const countEl = document.createElement('span');
        countEl.className = 'dgh-count';
        countEl.textContent = String(item.count);
        card.appendChild(toggleEl);
        card.appendChild(labelEl);
        card.appendChild(countEl);
        // Click handled by gridContainer delegation (see below)
        return { card, isMedia: false };
    }
    if (item.type === 'folder') {
        // Create folder card
        const card = document.createElement('div');
        card.className = 'folder-card';
        if (!skipAnimation) {
            card.style.animation = `card-enter 0.3s var(--ease-out-expo) ${Math.min(cardAnimIndex * 20, 600)}ms backwards`;
            cardAnimIndex++;
        }
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
        syncPinIndicator(card, item.path);

        return { card, isMedia: false };
    } else {
        // Create media card
        const card = document.createElement('div');
        card.className = 'video-card';
        if (!skipAnimation) {
            card.style.animation = `card-enter 0.3s var(--ease-out-expo) ${Math.min(cardAnimIndex * 20, 600)}ms backwards`;
            cardAnimIndex++;
        }
        card.dataset.src = item.url;
        card.dataset.path = item.path;
        card.dataset.name = item.name;
        card.dataset.searchText = item.name.toLowerCase();
        card.dataset.mediaType = item.type;
        card.setAttribute('role', 'gridcell');
        card.setAttribute('aria-label', `${item.type === 'video' ? 'Video' : 'Image'}: ${item.name}`);
        card.setAttribute('tabindex', '-1');
        card.dataset.mtime = String(item.mtime || 0);
        if (item.size > 0) card.dataset.fileSize = String(item.size);
        else delete card.dataset.fileSize;

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
            applyAspectRatioToCard(card, aspectRatioName, 'prescanned');
            // Store dimensions on card for later use
            card.dataset.width = item.width;
            card.dataset.height = item.height;
            // Create resolution label immediately
            createResolutionLabel(card, item.width, item.height);
        }

        // Apply pre-scanned dimensions for videos (from ffprobe during folder scan)
        if (item.width && item.height && item.type === 'video') {
            const aspectRatioName = getClosestAspectRatio(item.width, item.height);
            applyAspectRatioToCard(card, aspectRatioName, 'prescanned');
            card.dataset.width = item.width;
            card.dataset.height = item.height;
            createResolutionLabel(card, item.width, item.height);
        }

        // Fallback: if no pre-scanned dimensions available, default to 16:9
        // so masonry layout can be calculated upfront without waiting for metadata
        if (!card.dataset.aspectRatio) {
            applyAspectRatioToCard(card, '16:9', 'fallback');
        }

        const info = document.createElement('div');
        info.className = 'video-info';
        setCardFilenameContent(info, item.name);

        card.appendChild(extensionLabel);

        syncStarRatingOnCard(card, item.path);
        syncPinIndicator(card, item.path);
        syncCardMetaRow(card, item, null);

        card.appendChild(info);

        applyCardInfoVisibility(card);
        applyCardInfoLayoutClasses(card);

        // Mark missing files (dead links in collections)
        if (item.missing) {
            card.classList.add('missing-file');
        }

        // Apply duplicate highlight if active
        if (typeof applyDuplicateHighlight === 'function') applyDuplicateHighlight(card);

        return { card, isMedia: !item.missing };
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
        } else if (card.classList.contains('folder-card')) {
            cardsToObserve.push(card);
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
            } else if (card.classList.contains('folder-card')) {
                chunkCardsToObserve.push(card);
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
        
        // Use the same grid-viewport bounds as the media observer/cleanup logic.
        const bounds = getViewportBounds();
        const cardsToLoadNow = [];
        
        // Check each card's position relative to viewport
        cardsToCheck.forEach(card => {
            if (isCardInPreloadZone(card)) {
                const cardRect = getCachedCardRect(card);
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
function renderItems(items, preservedScrollTop = null) {
    cardAnimIndex = 0; // Reset card animation stagger
    const perfStart = perfTest.start();
    if (items.length > 50) setStatusActivity(`Rendering ${items.length} items...`);

    // Clean up previous virtual scrolling state
    vsCleanup();

    // Clean up all existing media before rendering
    const existingCards = gridContainer.querySelectorAll('.video-card, .folder-card');
    const cardsArray = Array.from(existingCards);

    // Batch unobserve and cleanup
    cardsArray.forEach(card => {
        observer.unobserve(card);
        const mediaEl = card._mediaEl;
        if (mediaEl) {
            if (mediaEl.tagName === 'VIDEO') destroyVideoElement(mediaEl);
            else destroyImageElement(mediaEl);
        }
    });

    // Reset counters
    activeVideoCount = 0;
    activeImageCount = 0;
    pendingMediaCreations.clear();
    mediaToRetry.clear();
    lastCleanupTime = 0;
    // Clear caches
    cachedMediaCounts = { videos: 0, images: 0, timestamp: 0 };
    cardRectCacheGeneration++;
    cachedViewportBounds = null;

    // Clean up masonry spacer if it exists
    const spacer = gridContainer.querySelector('.masonry-spacer');
    if (spacer) {
        spacer.remove();
    }

    // Clear container (preserve canvas-grid infrastructure elements)
    {
        const children = Array.from(gridContainer.children);
        for (const child of children) {
            if (child.id && child.id.startsWith('cg-')) continue;
            gridContainer.removeChild(child);
        }
    }
    currentHoveredCard = null;
    focusedCardIndex = -1;
    gridContainer.classList.remove('masonry');
    gridContainer.classList.remove('grid');

    if (items.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'grid-empty-state';
        const emptyIcon = {
            collection: '<svg class="grid-empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>',
            search: '<svg class="grid-empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
            folder: '<svg class="grid-empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>'
        };
        if (currentCollectionId) {
            const collection = collectionsCache.find(c => c.id === currentCollectionId);
            const isSmart = collection && collection.type === 'smart';
            emptyDiv.innerHTML = `
                ${emptyIcon.collection}
                <p class="grid-empty-title">This collection is empty</p>
                <p class="grid-empty-hint">${isSmart
                    ? 'Try editing the filter rules or adding more source folders.'
                    : 'Drag files here or right-click files to add them.'}</p>
            `;
        } else if (searchBox.value.trim() || currentFilter !== 'all') {
            const searchTerm = searchBox.value.trim();
            const filterLabel = currentFilter !== 'all' ? ` in "${currentFilter}" filter` : '';
            emptyDiv.innerHTML = `
                ${emptyIcon.search}
                <p class="grid-empty-title">No results found</p>
                <p class="grid-empty-hint">${searchTerm
                    ? `No files match "${searchTerm}"${filterLabel}. Try a different search term or clear filters.`
                    : `No files match the current filter. Try showing all files.`}</p>
            `;
        } else {
            emptyDiv.innerHTML = `${emptyIcon.folder}<p class="grid-empty-title">No folders or supported media found.</p>`;
        }
        gridContainer.appendChild(emptyDiv);
        updateItemCount();
        return;
    }

    // Use virtual scrolling for all lists - only render visible cards
    vsInit(items);
    restoreGridScrollPosition(preservedScrollTop);
    updateItemCount();
    perfTest.end('renderItems', perfStart, { itemCount: items.length });

    // Start periodic cleanup check
    startPeriodicCleanup();
}

// Function to update sorting preferences
function updateSorting() {
    sortType = sortTypeSelect.value;
    sortOrder = sortOrderSelect.value;
    
    // Save to active tab instead of global localStorage
    if (activeTabId != null) {
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

    // Save per-folder sort preference
    setFolderSortPref(currentFolderPath, sortType, sortOrder);

    // Apply sorting to current folder
    applySorting();
}

// ═══ → settings-ui.js (toggleSettingsModal, closeSettingsModal, shortcuts overlay) ═══

async function resolveGifDuration(card, imageUrl) {
    if (card.dataset.gifDuration) return;
    const filePath = card.dataset.path;
    const mtime = Number(card.dataset.mtime || 0);

    // Try cache first
    const cached = await getCachedGifDuration(filePath, mtime);
    if (cached) {
        card.dataset.gifDuration = String(cached.totalDuration);
        card.dataset.gifFrameCount = String(cached.frameCount);
        return;
    }

    // Skip very large files (>100MB)
    const fileSize = Number(card.dataset.fileSize || 0);
    if (fileSize > GIF_MAX_FILE_SIZE) {
        card.dataset.gifDuration = '0';
        return;
    }

    try {
        const response = await fetch(imageUrl);
        const buffer = await response.arrayBuffer();
        const urlLower = imageUrl.toLowerCase();
        let result = null;

        if (urlLower.endsWith('.gif')) {
            result = parseGifDuration(buffer);
        } else if (urlLower.endsWith('.webp')) {
            result = parseWebpDuration(buffer);
            if (!result) {
                // Static WebP – not animated
                card.dataset.isStaticWebp = 'true';
                card.dataset.gifDuration = '0';
                return;
            }
        }

        if (result && result.totalDuration > 0) {
            card.dataset.gifDuration = String(result.totalDuration);
            card.dataset.gifFrameCount = String(result.frameCount);
            cacheGifDuration(filePath, mtime, result.totalDuration, result.frameCount);
        } else {
            card.dataset.gifDuration = '0';
        }
    } catch {
        card.dataset.gifDuration = '0';
    }
}

/** Check if media capacity is exceeded; if so, queue for retry and return true. */
function isMediaAtCapacity(card, mediaUrl, fileType) {
    const { videos: currentVideoCount, images: currentImageCount } = getMediaCounts();
    const totalMediaCount = currentVideoCount + currentImageCount;
    const atLimit = (fileType === 'video' && currentVideoCount >= MAX_VIDEOS)
        || (fileType === 'image' && currentImageCount >= MAX_IMAGES)
        || (totalMediaCount >= MAX_TOTAL_MEDIA);
    if (atLimit && !mediaToRetry.has(card)) {
        mediaToRetry.set(card, { url: mediaUrl, attempts: 0, nextRetryTime: Date.now(), reason: 'capacity' });
    }
    return atLimit;
}

function createMediaForCard(card, mediaUrl) {
    if (pendingMediaCreations.has(card)) return false;

    const fileType = card.dataset.mediaType || getFileType(mediaUrl);
    if (isMediaAtCapacity(card, mediaUrl, fileType)) return false;
    
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
    const isOriginalQuality = qualityMultiplier === 0;
    const decodeWidth = isOriginalQuality ? 0 : Math.max(1, Math.floor(rect.width * qualityMultiplier));
    const decodeHeight = isOriginalQuality ? 0 : Math.max(1, Math.floor(rect.height * qualityMultiplier));
    
    const img = document.createElement('img');
    img.className = 'media-thumbnail';
    img.loading = 'eager';
    img.draggable = true;

    // Enable dragging images out of the app
    img.addEventListener('dragstart', (e) => {
        const filePath = card.dataset.path;
        if (filePath) {
            e.dataTransfer.effectAllowed = 'copyMove';
            e.dataTransfer.setData('text/plain', filePath);
            e.dataTransfer.setData('text/uri-list', imageUrl);
            e.dataTransfer.setData('application/x-thumbnail-animator-path', filePath);
        }
    });
    
    // Limit image decode resolution (skip for original quality)
    if (!isOriginalQuality) {
        img.width = decodeWidth;
        img.height = decodeHeight;
    }
    
    img.style.imageRendering = 'auto';

    const requestedThumbSize = Math.max(256, Math.ceil(Math.max(decodeWidth, decodeHeight) * 1.5));
    const thumbMaxSize = Math.min(IMAGE_THUMBNAIL_MAX_EDGE, requestedThumbSize);

    const setImageSource = (src, mode) => {
        if (!img.isConnected) return;
        img.dataset.sourceMode = mode;
        img.src = src;
        // Note: previously called `img.offsetHeight` here to force-paint after decode,
        // but reading offsetHeight triggers synchronous layout. During scroll many images
        // decode concurrently, causing hundreds of forced reflows per second (DevTools-
        // flagged at ~40ms cumulative reflow). Modern Chromium's compositor paints
        // decoded images on its own schedule without this hack.
    };
    
    // For animated GIFs/WEBPs, capture the first frame as a static snapshot
    const urlLowerForAnim = imageUrl.toLowerCase();
    const isGif = urlLowerForAnim.endsWith('.gif') || urlLowerForAnim.endsWith('.webp');
    if (isGif) {
        img.dataset.animatedSrc = imageUrl;
    }

    // Track loading state
    img.addEventListener('load', () => {
        // Detect and apply aspect ratio to card
        // Replace placeholder fallback ratios once real dimensions are known; keep prescanned/hydrated.
        const ratioSource = card.dataset.aspectRatioSource;
        const canApplyFromImage =
            img.naturalWidth &&
            img.naturalHeight &&
            (!card.dataset.aspectRatio || ratioSource === 'fallback');
        if (canApplyFromImage) {
            const aspectRatioName = getClosestAspectRatio(img.naturalWidth, img.naturalHeight);
            applyAspectRatioToCard(card, aspectRatioName, 'metadata');
            card.dataset.width = img.naturalWidth;
            card.dataset.height = img.naturalHeight;

            // Create resolution label if not already created
            if (!card.dataset.width) {
                createResolutionLabel(card, img.naturalWidth, img.naturalHeight);
            }

            if (updateItemDimensionsByPath(card.dataset.path, img.naturalWidth, img.naturalHeight)) {
                if (currentFolderPath) {
                    updateInMemoryFolderCaches(currentFolderPath, currentItems);
                }
                scheduleVsRecalculateForDimensions();
            }

            // Cache discovered dimensions for future visits
            if (card.dataset.path && !card.dataset.dimCached) {
                card.dataset.dimCached = '1';
                cacheDimensions([{
                    path: card.dataset.path,
                    mtime: Number(card.dataset.mtime || 0),
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
                overlay.className = 'gif-static-overlay';
                overlay.draggable = false;
                // Use async toBlob to avoid blocking the main thread
                canvas.toBlob((blob) => {
                    if (!blob || !card.isConnected) return;
                    const blobUrl = URL.createObjectURL(blob);
                    overlay.src = blobUrl;
                    overlay._blobUrl = blobUrl; // Track for cleanup
                    // Mark the card as having an animated image with overlay
                    img.dataset.hasOverlay = 'true';
                    const info = card.querySelector('.video-info');
                    card.insertBefore(overlay, info);
                    // If lightbox or blur pausing is active, show overlay immediately
                    if ((isLightboxOpen && pauseOnLightbox) || (isWindowBlurred && pauseOnBlur)) {
                        overlay.classList.add('visible');
                    }
                }, 'image/jpeg', 0.7);
            } catch (e) {
                // Ignore cross-origin or other canvas errors
            }
        }
        // Parse GIF/animated WebP duration for progress bar
        if (isGif) {
            card.dataset.gifLoadTime = String(performance.now());
            resolveGifDuration(card, imageUrl);
        }
        scheduleMediaLoadSettle();
    }, { once: true });

    // Add error handler - retry on error with exponential backoff
    img.addEventListener('error', () => {
        if (img.dataset.sourceMode === 'thumb') {
            setImageSource(imageUrl, 'original');
            return;
        }
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
    card._mediaEl = img;

    if (card.dataset.path && !isGif && !isOriginalQuality) {
        requestImageThumbnailUrl(card.dataset.path, thumbMaxSize)
            .then(url => {
                if (!img.isConnected) return;
                const finalUrl = url || imageUrl;
                setImageSource(finalUrl, url ? 'thumb' : 'original');
                // Fire-and-forget: decode bitmap into cache for fast redraw next scroll
                prefetchImageBitmap(finalUrl, decodeWidth, decodeHeight);
            })
            .catch(() => {
                if (!img.isConnected) return;
                setImageSource(imageUrl, 'original');
                prefetchImageBitmap(imageUrl, decodeWidth, decodeHeight);
            })
            .finally(() => {
                pendingMediaCreations.delete(card);
            });
    } else {
        setImageSource(imageUrl, 'original');
        if (!isGif) prefetchImageBitmap(imageUrl, decodeWidth, decodeHeight);
        pendingMediaCreations.delete(card);
    }

    // Upgrade to full-quality image on hover — overlay on top to avoid flash
    if (!isGif && !isOriginalQuality) {
        let fullImg = null;
        let preload = null;
        const onEnter = () => {
            if (!img.isConnected || img.dataset.sourceMode !== 'thumb') return;
            preload = new Image();
            preload.decoding = 'async';
            preload.onload = () => {
                if (!img.isConnected || img.dataset.sourceMode !== 'thumb') return;
                // Create a full-res overlay positioned on top of the thumbnail
                fullImg = document.createElement('img');
                fullImg.className = 'hover-full-res';
                fullImg.draggable = true;
                fullImg.src = imageUrl;
                fullImg.style.position = 'absolute';
                fullImg.style.inset = '0';
                fullImg.style.width = '100%';
                fullImg.style.height = '100%';
                fullImg.style.objectFit = getComputedStyle(img).objectFit || 'cover';
                fullImg.style.zIndex = '1';
                img.dataset.sourceMode = 'full';
                img.parentElement.insertBefore(fullImg, img.nextSibling);
            };
            preload.src = imageUrl;
        };
        const onLeave = () => {
            if (preload) { preload.onload = null; preload.src = ''; preload = null; }
            if (fullImg) { fullImg.remove(); fullImg = null; }
            if (img.isConnected) img.dataset.sourceMode = 'thumb';
        };
        card.addEventListener('mouseenter', onEnter);
        card.addEventListener('mouseleave', onLeave);
        card._hoverEnter = onEnter;
        card._hoverLeave = onLeave;
    }

    // NOTE: pendingMediaCreations is NOT deleted here. For the async thumbnail
    // path it is cleared in the .finally() after the src is set. For the sync
    // path (GIF / original quality) it is cleared right after setImageSource.
    return true;
}

// Helper function to create sound label for videos with audio
function createSoundLabel(card) {
    // Check if sound label already exists
    if (card.querySelector('.sound-label')) {
        return;
    }

    // Mark card as having audio in dataset
    card.dataset.hasAudio = 'true';

    // Create sound label
    const soundLabel = document.createElement('div');
    soundLabel.className = 'sound-label';
    soundLabel.textContent = 'AUDIO';
    soundLabel.style.backgroundColor = hexToRgba('#4ecdc4', 0.87); // Teal color similar to extension labels
    if (!cardInfoSettings.audioLabel) soundLabel.style.display = 'none';

    // Insert before the video-info element
    const info = card.querySelector('.video-info');
    if (info) {
        card.insertBefore(soundLabel, info);
    } else {
        card.appendChild(soundLabel);
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
    video.className = 'media-thumbnail';
    if (card.dataset.path && videoPosterUrlCache.has(card.dataset.path)) {
        video.poster = videoPosterUrlCache.get(card.dataset.path);
    }
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
    if (hasFfmpegAvailable && card.dataset.path) {
        requestVideoPosterUrl(card.dataset.path).then(url => {
            if (url && video.isConnected) {
                video.poster = url;
            }
        }).catch(() => { /* ignore thumbnail errors */ });
    }
    
    // Add dragstart handler to enable dragging videos
    video.addEventListener('dragstart', (e) => {
        const filePath = card.dataset.path;
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
            applyAspectRatioToCard(card, aspectRatioName, 'metadata');
            card.dataset.width = video.videoWidth;
            card.dataset.height = video.videoHeight;

            // Create resolution label
            createResolutionLabel(card, video.videoWidth, video.videoHeight);

            if (updateItemDimensionsByPath(card.dataset.path, video.videoWidth, video.videoHeight)) {
                if (currentFolderPath) {
                    updateInMemoryFolderCaches(currentFolderPath, currentItems);
                }
                scheduleVsRecalculateForDimensions();
            }

            // Cache discovered dimensions for future visits
            if (card.dataset.path && !card.dataset.dimCached) {
                card.dataset.dimCached = '1';
                cacheDimensions([{
                    path: card.dataset.path,
                    mtime: Number(card.dataset.mtime || 0),
                    width: video.videoWidth,
                    height: video.videoHeight
                }]).catch(() => {});
            }
        }

        // After metadata loads, ensure video dimensions are constrained
        const rect = getCachedCardRect(card);
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
            }
        };

        // Check immediately when metadata loads
        checkAudio();

        // Also check when video can play (more reliable for some browsers)
        video.addEventListener('canplay', checkAudio, { once: true });

        const itemForMeta = getMediaItemForCard(card);
        const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : null;
        if (dur) {
            card.dataset.mediaDuration = String(dur);
            if (itemForMeta && itemForMeta.type === 'video') {
                itemForMeta.duration = dur;
            }
        }
        syncCardMetaRow(card, itemForMeta, dur);

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
    card._mediaEl = video;

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
            const mediaEl = card._mediaEl;
            if (mediaEl) {
                if (mediaEl.tagName === 'VIDEO') {
                    destroyVideoElement(mediaEl);
                    activeVideoCount = Math.max(0, activeVideoCount - 1);
                } else {
                    destroyImageElement(mediaEl);
                    activeImageCount = Math.max(0, activeImageCount - 1);
                }
                pendingMediaCreations.delete(card);
                mediaToRetry.delete(card);
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

            // Handle folder preview loading
            if (card.classList.contains('folder-card')) {
                if (card.dataset.previewLoaded !== '1' && card.dataset.previewLoading !== '1') {
                    loadFolderPreview(card);
                }
                return;
            }

            // If no media exists and not pending, add to load queue
            if (!card._mediaEl && !pendingMediaCreations.has(card)) {
                // Use IntersectionObserver entry data for accurate positioning
                // and prioritize cards closest to the grid viewport center.
                const cardRect = entry.boundingClientRect;
                const viewportCenterY = getViewportBounds().centerY;
                const cardCenterY = cardRect.top + cardRect.height / 2;
                const distance = Math.abs(cardCenterY - viewportCenterY);
                cardsToLoad.push({ card, mediaUrl: card.dataset.src, distance });
            }
        }
    });
    
    // Sort by distance from viewport center (closest first)
    cardsToLoad.sort((a, b) => a.distance - b.distance);
    
    // Load media for all intersecting cards immediately.
    // createMediaForCard is lightweight (DOM element + async IPC batch), so no need
    // to defer via RAF. Deferring caused a race: if vsUpdateDOM recycled a card before
    // the RAF fired, the closure's stale mediaUrl would load the wrong thumbnail.
    let currentTotal = activeVideoCount + activeImageCount;
    cardsToLoad.forEach(({ card, mediaUrl }) => {
        if (currentTotal >= MAX_TOTAL_MEDIA) {
            if (!isCardInPreloadZone(card)) {
                if (!mediaToRetry.has(card)) {
                    mediaToRetry.set(card, { url: mediaUrl, attempts: 0, nextRetryTime: Date.now(), reason: 'capacity' });
                }
                return;
            }
        }
        createMediaForCard(card, mediaUrl);
        currentTotal++;
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
    
    // Get all cards that need media (use vsState.activeCards when available to avoid full DOM traversal)
    const allCards = vsState.enabled
        ? Array.from(vsState.activeCards.values())
        : Array.from(gridContainer.querySelectorAll('.video-card'));
        const cardsNeedingMedia = allCards.filter(card => {
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
            const cardRect = getCachedCardRect(card);
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
        
        if (card._mediaEl) {
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
        const allCards = vsState.enabled
            ? Array.from(vsState.activeCards.values())
            : Array.from(gridContainer.querySelectorAll('.video-card'));
        const cardsToLoad = allCards.filter(card => {
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

// Helper function to aggressively clean up video elements
function destroyVideoElement(video) {
    if (!video) return;

    // Store parent reference before we start cleanup
    const parent = video.parentNode;
    // Clear hasMedia flag if no other media remains in the card
    const card = parent && parent.closest ? parent.closest('.video-card') : (parent && parent.classList && parent.classList.contains('video-card') ? parent : null);
    if (card && !card.querySelector('video:nth-of-type(2)') && !card.querySelector('img.media-thumbnail')) {
        delete card.dataset.hasMedia;
        if (card._mediaEl === video) card._mediaEl = null;
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
            video.removeAttribute('src');
            video.src = '';
            video.load(); // Single load() call to release decoder
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
        if (card._mediaEl === img) card._mediaEl = null;
    }

    // Also remove the static overlay if this is an animated image
    if (parent && img.dataset.hasOverlay) {
        const overlay = parent.querySelector('.gif-static-overlay');
        if (overlay) {
            if (overlay._blobUrl) URL.revokeObjectURL(overlay._blobUrl);
            overlay.remove();
        }
    }

    // Clean up GIF progress bar animation
    if (card) {
        if (card._gifAnimId) {
            cancelAnimationFrame(card._gifAnimId);
            delete card._gifAnimId;
        }
        const gifBar = card.querySelector('.gif-progress-bar');
        if (gifBar) gifBar.remove();
        const gifTimeLabel = card.querySelector('.gif-time-label');
        if (gifTimeLabel) gifTimeLabel.remove();
        delete card.dataset.gifDuration;
        delete card.dataset.gifLoadTime;
        delete card.dataset.gifFrameCount;
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
let observerRefreshTimeout = null;
// Using OBSERVER_CLEANUP_THROTTLE_MS from configuration constants at top of file

function createMediaObserver() {
    const buffer = getEffectiveMediaBufferPx();
    return new IntersectionObserver((entries) => {
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
    }, {
        root: gridContainer,
        rootMargin: `${buffer}px ${buffer}px ${buffer}px ${buffer}px`,
        threshold: 0.0
    });
}

let observer = createMediaObserver();

function refreshMediaObserver() {
    const cardsToObserve = vsState.enabled
        ? Array.from(vsState.activeCards.values())
        : Array.from(gridContainer.querySelectorAll('.video-card, .folder-card'));

    if (observer) observer.disconnect();
    observer = createMediaObserver();
    cardsToObserve.forEach(card => observer.observe(card));
}

function scheduleObserverRefresh() {
    clearTimeout(observerRefreshTimeout);
    observerRefreshTimeout = setTimeout(() => {
        observerRefreshTimeout = null;
        invalidateScrollCaches();
        refreshMediaObserver();
    }, 150);
}

window.addEventListener('resize', scheduleObserverRefresh);


// ═══════════════════════════════════════════════════════════════════════════
// FILTER & SEARCH
// ═══════════════════════════════════════════════════════════════════════════
// Debounce timer for search input
let filterDebounceTimer = null;
// RAF coalescing for filter changes — batches rapid clicks into one pass
let pendingFilterRaf = null;
function scheduleApplyFilters() {
    if (pendingFilterRaf !== null) return; // Already scheduled
    clearFilteredVisibleCountCache();
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
        const visible = (vsState.enabled && filteredVisibleCountCacheRef === vsState.sortedItems && filteredVisibleCountCacheValue !== null)
            ? filteredVisibleCountCacheValue
            : (vsState.enabled ? vsState.sortedItems.length : (() => {
            const cards = gridContainer.querySelectorAll('.video-card, .folder-card');
            return Array.from(cards).filter(c => c.style.display !== 'none').length;
        })());
        itemCountEl.textContent = `${visible} of ${total} items`;
    } else {
        itemCountEl.textContent = `${total} items`;
    }

    // Breadcrumb chips: active filter summary + sort indicator
    const filterChip = document.getElementById('breadcrumb-filter-chip');
    const sortChip = document.getElementById('breadcrumb-sort-chip');
    if (filterChip) {
        const bits = [];
        if (currentFilter !== 'all') bits.push(currentFilter);
        if (hasAdvanced) bits.push('advanced');
        if (query) bits.push('search');
        if (bits.length > 0) {
            filterChip.textContent = 'Filtered: ' + bits.join(' + ');
        }
        filterChip.classList.toggle('hidden', bits.length === 0);
    }
    if (sortChip) {
        if (aiClusteringMode === 'similarity' && aiVisualSearchEnabled && currentEmbeddings.size > 0) {
            sortChip.textContent = 'Clustered';
        } else {
            const arrow = sortOrder === 'descending' ? '\u2193' : '\u2191';
            const label = sortType ? sortType.charAt(0).toUpperCase() + sortType.slice(1) : 'Name';
            sortChip.textContent = `${label} ${arrow}`;
        }
    }

    updateStatusBar();
    if (typeof updateSaveSearchButtonState === 'function') updateSaveSearchButtonState();
}

function updateStatusBar() {
    const { folders, videos, images, total } = getCurrentItemStats();

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
    const filterNames = { all: '', video: 'Videos', image: 'Images', audio: 'Audio' };
    const filterParts = [];
    if (currentFilter !== 'all') filterParts.push(filterNames[currentFilter] || currentFilter);
    if (starFilterActive) {
        const sortLabel = { none: 'Starred', desc: 'Starred ▼', asc: 'Starred ▲' };
        filterParts.push(sortLabel[starSortOrder] || 'Starred');
    }
    if (aiClusteringMode === 'similarity' && aiVisualSearchEnabled) filterParts.push('Clustered');
    if (recursiveSearchEnabled) filterParts.push('Subfolders');
    if (advancedSearchFilters.sizeValue !== null) filterParts.push('Size');
    if (advancedSearchFilters.dateFrom !== null || advancedSearchFilters.dateTo !== null) filterParts.push('Date');
    if (advancedSearchFilters.width !== null || advancedSearchFilters.height !== null) filterParts.push('Dimensions');
    if (advancedSearchFilters.aspectRatio !== '') filterParts.push(advancedSearchFilters.aspectRatio);
    if (advancedSearchFilters.starRating !== null && advancedSearchFilters.starRating !== '') filterParts.push(`${advancedSearchFilters.starRating}+ Stars`);
    if (query) filterParts.push(`"${query}"`);
    statusFilterInfo.textContent = filterParts.length > 0 ? `[${filterParts.join(' + ')}]` : '';

    // Layout & zoom
    statusLayoutMode.textContent = layoutMode === 'masonry' ? 'Dynamic' : 'Grid';
    if (statusZoomLevel) statusZoomLevel.textContent = `${zoomLevel}%`;
}

function updateStatusBarSelection(card) {
    if (!card || !statusSelectionInfo) {
        statusSelectionInfo.textContent = '';
        return;
    }

    const name = card.dataset.name || '';
    const w = card.dataset.width;
    const h = card.dataset.height;
    const parts = [name];
    if (w && h) parts.push(`${w}x${h}`);
    statusSelectionInfo.textContent = parts.join(' \u2014 ');
}

// L2-normalize a vector in-place (or return new Float32Array). After normalization,
// cosine similarity = dot product, saving 2 magnitude computations per comparison.
function l2Normalize(vec) {
    let mag = 0;
    for (let i = 0; i < vec.length; i++) mag += vec[i] * vec[i];
    mag = Math.sqrt(mag);
    if (mag === 0) return vec;
    const result = new Float32Array(vec.length);
    for (let i = 0; i < vec.length; i++) result[i] = vec[i] / mag;
    return result;
}

// Fast cosine similarity for pre-normalized vectors (dot product only)
function cosineSimilarity(a, b) {
    let dot = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) dot += a[i] * b[i];
    return dot;
}

/**
 * Reorder items by visual similarity using PCA-projection sorting.
 * Finds the principal axis of variation in the embedding space via power
 * iteration, projects every item onto that axis, then sorts by the scalar
 * projection.  Items that are visually similar cluster together because
 * they occupy nearby positions along the dominant axis.
 *
 * O(n · dim · iterations + n log n) ≈ O(n) for typical CLIP-512 embeddings.
 */
function applyVisualClustering(items) {
    const folders = [], withEmb = [], noEmb = [];
    for (const item of items) {
        if (item.type === 'folder') { folders.push(item); continue; }
        if (currentEmbeddings.has(item.path)) withEmb.push(item);
        else noEmb.push(item);
    }

    if (withEmb.length < 2) return items;

    const dim = currentEmbeddings.get(withEmb[0].path).length;
    const n = withEmb.length;

    // 1. Compute mean embedding
    const mean = new Float64Array(dim);
    for (let i = 0; i < n; i++) {
        const emb = currentEmbeddings.get(withEmb[i].path);
        for (let d = 0; d < dim; d++) mean[d] += emb[d];
    }
    for (let d = 0; d < dim; d++) mean[d] /= n;

    // 2. Power iteration to find first principal component (5 iterations is plenty)
    let v = new Float64Array(dim);
    // Initialise with first centered embedding (deterministic, avoids zero vector)
    const initEmb = currentEmbeddings.get(withEmb[0].path);
    for (let d = 0; d < dim; d++) v[d] = initEmb[d] - mean[d];
    // Normalize
    let vNorm = 0;
    for (let d = 0; d < dim; d++) vNorm += v[d] * v[d];
    vNorm = Math.sqrt(vNorm) || 1;
    for (let d = 0; d < dim; d++) v[d] /= vNorm;

    for (let iter = 0; iter < 5; iter++) {
        const w = new Float64Array(dim);
        for (let i = 0; i < n; i++) {
            const emb = currentEmbeddings.get(withEmb[i].path);
            // dot = (emb - mean) · v
            let dot = 0;
            for (let d = 0; d < dim; d++) dot += (emb[d] - mean[d]) * v[d];
            // w += dot * (emb - mean)   — this computes (Cov * v) incrementally
            for (let d = 0; d < dim; d++) w[d] += dot * (emb[d] - mean[d]);
        }
        // Normalize w → v
        let wNorm = 0;
        for (let d = 0; d < dim; d++) wNorm += w[d] * w[d];
        wNorm = Math.sqrt(wNorm) || 1;
        for (let d = 0; d < dim; d++) v[d] = w[d] / wNorm;
    }

    // 3. Project each item onto the principal component and sort
    const projections = new Array(n);
    for (let i = 0; i < n; i++) {
        const emb = currentEmbeddings.get(withEmb[i].path);
        let dot = 0;
        for (let d = 0; d < dim; d++) dot += (emb[d] - mean[d]) * v[d];
        projections[i] = { item: withEmb[i], val: dot };
    }
    projections.sort((a, b) => a.val - b.val);

    const ordered = new Array(n);
    for (let i = 0; i < n; i++) ordered[i] = projections[i].item;

    return folders.concat(ordered, noEmb);
}

// ── Filter/Sort Worker Bridge ─────────────────────────────────────────
// Offloads the filter/sort pipeline to a Web Worker with a trigram index.
// Main thread stays responsive during interactive search/filter changes.

let _filterWorker = null;
let _filterWorkerToken = 0;
let _filterWorkerLastToken = 0;
let _filterWorkerItemsRef = null;       // reference check: have we sent this exact array?
let _filterWorkerLastLen = -1;
let _filterWorkerRatingsVersion = 0;
let _filterWorkerRatingsSyncedVersion = -1;
let _filterWorkerPinsVersion = 0;
let _filterWorkerPinsSyncedVersion = -1;
let _filterWorkerTagFilterVersion = 0;
let _filterWorkerTagFilterSyncedVersion = -1;
let _filterWorkerEmbSyncedSize = -1;
let _filterWorkerEmbVersion = 0;        // bump when embeddings cleared/repopulated
let _filterWorkerEmbSyncedVersion = -1;

function bumpFilterWorkerRatingsVersion() {
    _filterWorkerRatingsVersion++;
}

function bumpFilterWorkerPinsVersion() {
    _filterWorkerPinsVersion++;
}

function bumpFilterWorkerTagFilterVersion() {
    _filterWorkerTagFilterVersion++;
}

function getFilterWorker() {
    if (_filterWorker) return _filterWorker;
    try {
        _filterWorker = new Worker('filter-sort-worker.js');
        _filterWorker.onmessage = (e) => {
            const msg = e.data;
            if (!msg) return;
            if (msg.type === 'error') {
                console.error('[filter-worker] pipeline error:', msg.error);
                // Hide any active clustering indicator so it doesn't get stuck
                _hideClusteringStatus();
                return;
            }
            if (msg.type !== 'result') return;
            // Stale — a newer apply has been queued, drop this result
            if (msg.token !== _filterWorkerLastToken) return;
            applyFilterWorkerResult(msg);
        };
        _filterWorker.onerror = (err) => {
            console.error('filter-sort-worker error:', err);
            _hideClusteringStatus();
        };
    } catch (e) {
        console.warn('Failed to spawn filter worker; falling back to main-thread filtering:', e);
        showToastOnce('filter-worker-fail',
            'Filtering is running on the main thread',
            'warning',
            { details: 'A worker failed to spawn; sorting large folders may feel slower.' }
        );
        _filterWorker = null;
    }
    return _filterWorker;
}

function markFilterWorkerItemsStale() {
    _filterWorkerItemsRef = null;
}

function syncFilterWorkerItems() {
    const w = getFilterWorker();
    if (!w) return false;
    if (_filterWorkerItemsRef !== currentItems || _filterWorkerLastLen !== currentItems.length) {
        // Send shallow-cloned items (only needed fields) to avoid sending non-cloneable refs
        const slim = new Array(currentItems.length);
        for (let i = 0; i < currentItems.length; i++) {
            const it = currentItems[i];
            slim[i] = {
                type: it.type,
                path: it.path,
                folderPath: it.folderPath,
                name: it.name,
                mtime: it.mtime,
                size: it.size,
                width: it.width,
                height: it.height,
                missing: it.missing,
                aspectRatio: it.aspectRatio
            };
        }
        w.postMessage({ type: 'setItems', items: slim });
        _filterWorkerItemsRef = currentItems;
        _filterWorkerLastLen = currentItems.length;
    }
    return true;
}

function syncFilterWorkerRatings() {
    const w = getFilterWorker();
    if (!w) return;
    if (_filterWorkerRatingsSyncedVersion === _filterWorkerRatingsVersion) return;
    w.postMessage({ type: 'setRatings', ratings: fileRatings });
    _filterWorkerRatingsSyncedVersion = _filterWorkerRatingsVersion;
}

function syncFilterWorkerPins() {
    const w = getFilterWorker();
    if (!w) return;
    if (_filterWorkerPinsSyncedVersion === _filterWorkerPinsVersion) return;
    const paths = (typeof pinnedFiles === 'object' && pinnedFiles) ? Object.keys(pinnedFiles) : [];
    w.postMessage({ type: 'setPins', paths });
    _filterWorkerPinsSyncedVersion = _filterWorkerPinsVersion;
}

function syncFilterWorkerTagFilter() {
    const w = getFilterWorker();
    if (!w) return;
    if (_filterWorkerTagFilterSyncedVersion === _filterWorkerTagFilterVersion) return;
    const paths = (tagFilterActive && tagFilteredPaths) ? Array.from(tagFilteredPaths) : null;
    w.postMessage({ type: 'setTagFilter', paths });
    _filterWorkerTagFilterSyncedVersion = _filterWorkerTagFilterVersion;
}

function bumpEmbeddingsVersion() {
    _filterWorkerEmbVersion++;
}

function syncFilterWorkerEmbeddingsIfNeeded() {
    const w = getFilterWorker();
    if (!w) return;
    // Re-sync only when version bumped (clear/bulk replace) OR size grew significantly
    if (_filterWorkerEmbSyncedVersion === _filterWorkerEmbVersion &&
        Math.abs(currentEmbeddings.size - _filterWorkerEmbSyncedSize) < 16) {
        return;
    }
    const obj = {};
    for (const [k, v] of currentEmbeddings) obj[k] = v;
    w.postMessage({ type: 'setEmbeddings', embeddings: obj });
    _filterWorkerEmbSyncedVersion = _filterWorkerEmbVersion;
    _filterWorkerEmbSyncedSize = currentEmbeddings.size;
}

function syncFilterWorkerTextEmbedding() {
    const w = getFilterWorker();
    if (!w) return;
    w.postMessage({ type: 'setTextEmbedding', vec: currentTextEmbedding || null });
}

function syncFilterWorkerFindSimilarEmbedding() {
    const w = getFilterWorker();
    if (!w) return;
    w.postMessage({ type: 'setFindSimilarEmbedding', vec: findSimilarState.embedding || null });
}

function applyFilterWorkerResult(msg) {
    console.log(`[renderer] received worker result: ${msg.indices?.length} items, groupHeaders=${msg.groupHeadersPresent}`);
    // Safety: if currentItems was swapped out after the worker request was sent,
    // the indices no longer map to the current array. Drop this stale result —
    // a fresh applyFilters will run for the new items.
    if (_filterWorkerItemsRef !== currentItems) {
        console.warn('[renderer] dropping stale worker result (currentItems changed)');
        _hideClusteringStatus(); // never leave indicator stuck
        return;
    }
    try { _applyFilterWorkerResultInner(msg); } finally { _hideClusteringStatus(); }
}
function _applyFilterWorkerResultInner(msg) {

    vsState.groupHeadersPresent = !!msg.groupHeadersPresent;

    // Reconstruct the items array from currentItems using the indices the worker sent.
    // Negative indices reference synthetic objects (group headers).
    const indices = msg.indices;
    const synthetics = msg.synthetics || [];
    const scores = msg.scores || {};
    const aiScores = scores.ai || null;
    const simScores = scores.sim || null;
    const ratings = scores.ratings || null;

    const items = new Array(indices.length);
    let nulled = 0;
    for (let k = 0; k < indices.length; k++) {
        const idx = indices[k];
        if (idx < 0) {
            items[k] = synthetics[-idx - 1];
        } else {
            const orig = currentItems[idx];
            if (!orig) { items[k] = null; nulled++; continue; }
            // Stamp injected scores directly onto the original item so any legacy code
            // reading item._aiScore / item._similarityScore / item._cachedRating still works.
            if (aiScores)  orig._aiScore = aiScores[idx];
            if (simScores) orig._similarityScore = simScores[idx];
            if (ratings)   orig._cachedRating = ratings[idx];
            items[k] = orig;
        }
    }
    // Compact out any null holes (shouldn't happen unless currentItems mutated)
    let finalItems = nulled > 0 ? items.filter(x => x != null) : items;
    // Main-thread post-filter for operator filters that the worker doesn't know about:
    // - tag:/-tag: name-based path include/exclude
    // - type:gif and type:folder synthetic types
    finalItems = _applyOperatorPostFilter(finalItems);
    let visibleCount = 0;
    for (const item of finalItems) {
        if (item && item.type !== 'group-header') visibleCount++;
    }

    if (vsState.enabled) {
        vsUpdateItems(finalItems, { preserveScroll: true });
    }
    setFilteredVisibleCountCache(finalItems, visibleCount);
    updateItemCount();

    // Count visible (non-header) matches for the search result badge
    updateSearchResultCount(visibleCount);
    clearSearchDebounceIndicator();
    hideLoadingIndicator();
    // Refresh filename highlights for the new query across visible cards
    if (typeof refreshVisibleFilenameHighlights === 'function') refreshVisibleFilenameHighlights();
}

let _clusteringStatusTimer = null;

function _hideClusteringStatus() {
    const el = document.getElementById('ai-clustering-status');
    if (!el || el.classList.contains('hidden')) return;
    // Clear safety timeout from settings-ui
    const sel = document.getElementById('ai-clustering-select');
    if (sel && sel._safetyTimer) { clearTimeout(sel._safetyTimer); sel._safetyTimer = null; }
    // Show brief "Done" feedback, then hide
    const dot = el.querySelector('.ai-status-dot');
    const text = document.getElementById('ai-clustering-status-text');
    if (dot) { dot.classList.remove('loading'); dot.classList.add('loaded'); }
    if (text) text.textContent = 'Clustered';
    clearTimeout(_clusteringStatusTimer);
    _clusteringStatusTimer = setTimeout(() => {
        el.classList.add('hidden');
        if (dot) { dot.classList.remove('loaded'); dot.classList.add('loading'); }
        if (text) text.textContent = 'Clustering\u2026';
    }, 1500);
}

// Applies search-operator filters that run on the main thread (size/date,
// tag include/exclude by name, plus synthetic type:gif / type:folder). These
// are handled here because the worker pipeline doesn't support them directly.
function _applyOperatorPostFilter(items) {
    const ops = _parsedSearchQuery.operators;
    const needsSize = ops.sizeValue != null && ops.sizeOperator;
    const needsDate = ops.dateFrom != null || ops.dateTo != null;
    const needsTagFilter = (ops._includedPaths && ops.tagNames.length > 0)
        || (ops._excludedPaths && ops.tagExcludeNames.length > 0);
    const needsGifFilter = ops.typeFilter === 'gif';
    const needsFolderFilter = ops.typeFilter === 'folder';
    if (!needsSize && !needsDate && !needsTagFilter && !needsGifFilter && !needsFolderFilter) return items;

    return items.filter(item => {
        if (!item || item.type === 'group-header') return true;
        if (needsFolderFilter && item.type !== 'folder') return false;
        if (needsGifFilter) {
            if (item.type === 'folder') return false;
            const lower = (item.name || '').toLowerCase();
            if (!lower.endsWith('.gif') && !lower.endsWith('.webp')) return false;
        }
        if (item.type !== 'folder' && needsSize) {
            const s = item.size;
            if (s == null) return false;
            const v = ops.sizeValue;
            switch (ops.sizeOperator) {
                case '>':  if (!(s > v)) return false; break;
                case '>=': if (!(s >= v)) return false; break;
                case '<':  if (!(s < v)) return false; break;
                case '<=': if (!(s <= v)) return false; break;
                case '=':  if (s !== v) return false; break;
            }
        }
        if (item.type !== 'folder' && needsDate) {
            const m = item.mtime || 0;
            if (ops.dateFrom != null && m < ops.dateFrom) return false;
            if (ops.dateTo != null && m > ops.dateTo) return false;
        }
        if (needsTagFilter && item.type !== 'folder' && item.path) {
            const np = normalizePath(item.path);
            if (ops.tagNames.length > 0 && ops._includedPaths && !ops._includedPaths.has(np)) return false;
            if (ops.tagExcludeNames.length > 0 && ops._excludedPaths && ops._excludedPaths.has(np)) return false;
        }
        return true;
    });
}

/**
 * Offloaded filter/sort pipeline. Sends state to worker; result comes back via onmessage.
 * Falls back to synchronous applyFilters() if worker unavailable.
 */
function applyFiltersViaWorker() {
    if (currentItems.length === 0) return false;
    const w = getFilterWorker();
    if (!w) return false;

    syncFilterWorkerItems();
    // Sync small state bags every call (cheap). Embeddings are big, sync only when needed.
    syncFilterWorkerRatings();
    syncFilterWorkerPins();
    syncFilterWorkerTagFilter();
    syncFilterWorkerTextEmbedding();
    syncFilterWorkerFindSimilarEmbedding();
    // Embeddings only matter when AI search / clustering / find-similar is active
    if (aiSearchActive || aiClusteringMode === 'similarity' || findSimilarState.active) {
        // Force a full sync when clustering is first enabled — individual embeddings
        // are never sent to the worker (setOneEmbedding exists but is unused), so
        // the worker may have zero embeddings even though the main thread has them.
        if (aiClusteringMode === 'similarity' && _filterWorkerEmbSyncedSize !== currentEmbeddings.size) {
            _filterWorkerEmbSyncedVersion = -1; // force version mismatch → full sync
        }
        syncFilterWorkerEmbeddingsIfNeeded();
    }

    const token = ++_filterWorkerToken;
    _filterWorkerLastToken = token;

    // Operator-aware state: freeText goes to worker as query; operator values
    // overlay on advancedSearchFilters and currentFilter.
    const ops = _parsedSearchQuery.operators;
    const effectiveAdvanced = _operatorsHaveFilters(ops)
        ? _mergeOperatorFilters(advancedSearchFilters, ops)
        : advancedSearchFilters;
    let effectiveFilter = currentFilter;
    if (ops.typeFilter === 'video' || ops.typeFilter === 'image') effectiveFilter = ops.typeFilter;
    // Note: 'gif' and 'folder' operator types aren't first-class in the worker
    // filter pipeline yet, so they fall through (may be filtered on main thread).

    const state = {
        query: _parsedSearchQuery.freeText,
        currentFilter: effectiveFilter,
        includeMovingImages,
        starFilterActive,
        starSortOrder,
        tagFilterActive,
        findSimilarActive: findSimilarState.active,
        findSimilarAllFolders: findSimilarState.allFolders,
        findSimilarThreshold: findSimilarState.threshold,
        aiVisualSearchEnabled,
        aiSearchActive,
        aiSimilarityThreshold,
        aiClusteringMode,
        advancedSearchFilters: effectiveAdvanced,
        sortType,
        sortOrder,
        groupByDate,
        dateGroupGranularity,
        collapsedGroups: Array.from(collapsedDateGroups || [])
    };
    w.postMessage({ type: 'applyFilters', token, state });
    return true;
}

function applyFilters() {
    const perfStart = perfTest.start();
    if (currentItems.length === 0) return;

    // Prefer worker-based pipeline when available
    if (applyFiltersViaWorker()) {
        perfTest.end('applyFilters', perfStart, { cardCount: currentItems.length, detail: 'worker' });
        return;
    }

    // Main-thread fallback: use the parsed free text for filename match.
    const query = (_parsedSearchQuery.freeText || '').toLowerCase().trim();

    // Filter items array (works with virtual scrolling - no DOM iteration needed)
    const filteredItems = currentItems.filter(item => {
        const fileName = item.name.toLowerCase();

        // Search query — use AI cosine similarity when active, else filename match
        let matchesSearch;
        if (query === '') {
            matchesSearch = true;
        } else if (aiVisualSearchEnabled && aiSearchActive && currentTextEmbedding && item.type !== 'folder') {
            const embedding = currentEmbeddings.get(item.path);
            if (embedding) {
                const sim = cosineSimilarity(currentTextEmbedding, embedding);
                item._aiScore = sim;
                matchesSearch = sim >= aiSimilarityThreshold;
            } else {
                item._aiScore = 0;
                matchesSearch = fileName.includes(query); // Fallback for unembedded items
            }
        } else {
            matchesSearch = fileName.includes(query);
        }
        if (!matchesSearch) return false;

        // Exclude pinned items from AI search results (they're irrelevant to the query)
        if (aiVisualSearchEnabled && aiSearchActive && currentTextEmbedding && query !== '' && item.type !== 'folder' && isFilePinned(item.path)) {
            return false;
        }

        // Type filter
        let matchesFilter = true;
        if (currentFilter === 'video') {
            const isGifOrWebp = fileName.endsWith('.gif') || fileName.endsWith('.webp');
            matchesFilter = item.type === 'video' ||
                (includeMovingImages && item.type === 'image' && isGifOrWebp);
        } else if (currentFilter === 'image') {
            const isImage = item.type === 'image';
            const isGifOrWebp = fileName.endsWith('.gif') || fileName.endsWith('.webp');
            matchesFilter = isImage && !(includeMovingImages && isGifOrWebp);
        }
        if (!matchesFilter) return false;

        // Cache rating once for reuse in star filter, advanced search, and sort
        const needsRating = starFilterActive || advancedSearchFilters.starRating !== null;
        if (needsRating && item.type !== 'folder' && item.path) {
            item._cachedRating = getFileRating(item.path);
        }

        // Star filter (independent toggle)
        if (starFilterActive) {
            if (item.type === 'folder') return false;
            if ((item._cachedRating || 0) <= 0) return false;
        }

        // Tag filter
        if (tagFilterActive && tagFilteredPaths) {
            if (item.type === 'folder') return false;
            if (!tagFilteredPaths.has(normalizePath(item.path))) return false;
        }

        // Find Similar filter (current folder mode only — cross-folder replaces currentItems)
        if (findSimilarState.active && findSimilarState.embedding && !findSimilarState.allFolders) {
            if (item.type === 'folder') return false;
            const emb = currentEmbeddings.get(item.path);
            if (!emb) return false;
            const sim = cosineSimilarity(findSimilarState.embedding, emb);
            item._similarityScore = sim;
            if (sim < findSimilarState.threshold) return false;
        }

        // Advanced search filters
        if (advancedSearchFilters.width || advancedSearchFilters.height) {
            if (advancedSearchFilters.width && item.width !== advancedSearchFilters.width) return false;
            if (advancedSearchFilters.height && item.height !== advancedSearchFilters.height) return false;
        }

        if (advancedSearchFilters.aspectRatio) {
            if (item.width && item.height) {
                const ratio = item.width / item.height;
                const targetRatio = parseAspectRatio(advancedSearchFilters.aspectRatio);
                if (Math.abs(ratio - targetRatio) > 0.1) return false;
            } else {
                return false;
            }
        }

        if (advancedSearchFilters.starRating !== null && item.path) {
            if ((item._cachedRating || 0) < advancedSearchFilters.starRating) return false;
        }

        return true;
    });

    // Sort by star rating if stars filter is active and sort direction is set
    let sortedFiltered = filteredItems;
    if (starFilterActive && starSortOrder !== 'none') {
        sortedFiltered = [...filteredItems].sort((a, b) => {
            if (a.type === 'folder' && b.type === 'folder') return 0;
            if (a.type === 'folder') return 1;
            if (b.type === 'folder') return -1;
            const aRating = a._cachedRating || 0;
            const bRating = b._cachedRating || 0;
            return starSortOrder === 'asc' ? aRating - bRating : bRating - aRating;
        });
    }

    // When AI search is active, sort results by relevance score (highest similarity first)
    if (aiVisualSearchEnabled && aiSearchActive && currentTextEmbedding && query !== '') {
        sortedFiltered = [...sortedFiltered].sort((a, b) => {
            if (a.type === 'folder') return 1;
            if (b.type === 'folder') return -1;
            return (b._aiScore || 0) - (a._aiScore || 0);
        });
    }

    // Sort by similarity when find-similar is active (current folder mode)
    if (findSimilarState.active && findSimilarState.embedding && !findSimilarState.allFolders) {
        sortedFiltered = [...sortedFiltered].sort((a, b) => {
            if (a.type === 'folder') return 1;
            if (b.type === 'folder') return -1;
            return (b._similarityScore || 0) - (a._similarityScore || 0);
        });
    }

    // Apply visual similarity clustering (group by nearest neighbors)
    if (aiVisualSearchEnabled && aiClusteringMode === 'similarity' && currentEmbeddings.size > 0 && query === '') {
        sortedFiltered = applyVisualClustering(sortedFiltered);
    }

    // Partition pinned items to top (single pass instead of 4x filter)
    {
        const pinnedFolders = [], unpinnedFolders = [], pinnedFiles = [], unpinnedFiles = [];
        for (const item of sortedFiltered) {
            const isFolder = item.type === 'folder';
            const pinned = isFilePinned(item.path);
            if (isFolder) (pinned ? pinnedFolders : unpinnedFolders).push(item);
            else (pinned ? pinnedFiles : unpinnedFiles).push(item);
        }
        sortedFiltered = pinnedFolders.concat(unpinnedFolders, pinnedFiles, unpinnedFiles);
    }

    // Operator post-filter (tag:/-tag:/type:gif/type:folder)
    sortedFiltered = _applyOperatorPostFilter(sortedFiltered);

    // Update virtual scrolling with filtered items
    if (vsState.enabled) {
        vsUpdateItems(sortedFiltered, { preserveScroll: true });
    }
    const visibleCount = sortedFiltered.length;
    setFilteredVisibleCountCache(sortedFiltered, visibleCount);
    updateItemCount();

    // Count visible (non-header) matches for the search result badge
    updateSearchResultCount(visibleCount);
    clearSearchDebounceIndicator();
    // Update clustering progress indicator (inside settings panel)
    _hideClusteringStatus();
    hideLoadingIndicator();
    if (typeof refreshVisibleFilenameHighlights === 'function') refreshVisibleFilenameHighlights();

    perfTest.end('applyFilters', perfStart, { cardCount: currentItems.length });
}

function performSearch(searchQuery) {
    // Debounce search to avoid excessive filtering while typing
    clearTimeout(filterDebounceTimer);
    clearFilteredVisibleCountCache();
    const delay = (aiVisualSearchEnabled && aiSearchActive) ? 300 : 150;
    // Show pulsing debounce indicator while waiting
    if (searchDebounceDotEl) {
        searchDebounceDotEl.classList.toggle('pulsing', !!searchQuery);
    }
    filterDebounceTimer = setTimeout(async () => {
        // Parse operators out of the search box. Operators overlay on
        // advancedSearchFilters at filter-apply time; freeText goes to the
        // worker as the filename-match query.
        _parsedSearchQuery = parseSearchQuery(searchQuery || '');

        // Resolve tag-name operators → file paths (async DB query)
        const ops = _parsedSearchQuery.operators;
        if (ops.tagNames.length || ops.tagExcludeNames.length) {
            try {
                if (!Array.isArray(allTagsCache) || allTagsCache.length === 0) {
                    await refreshTagsCache();
                }
                const nameToId = new Map();
                for (const t of allTagsCache) nameToId.set(String(t.name).toLowerCase(), t.id);
                const includeIds = ops.tagNames.map(n => nameToId.get(n)).filter(x => x != null);
                const excludeIds = ops.tagExcludeNames.map(n => nameToId.get(n)).filter(x => x != null);
                if (ops.tagNames.length > 0) {
                    if (includeIds.length > 0) {
                        const result = await window.electronAPI.dbQueryFilesByTags({ op: 'AND', tagIds: includeIds });
                        ops._includedPaths = result && result.ok ? new Set(result.value || []) : new Set();
                    } else {
                        // All requested tag names unknown → no matches
                        ops._includedPaths = new Set();
                    }
                }
                if (ops.tagExcludeNames.length > 0) {
                    if (excludeIds.length > 0) {
                        const result = await window.electronAPI.dbQueryFilesByTags({ op: 'OR', tagIds: excludeIds });
                        ops._excludedPaths = result && result.ok ? new Set(result.value || []) : new Set();
                    } else {
                        ops._excludedPaths = new Set();
                    }
                }
            } catch { /* swallow, tags are best-effort */ }
        }

        // AI text embedding uses the free text only, not operator tokens
        const aiQuery = _parsedSearchQuery.freeText.trim();
        if (aiVisualSearchEnabled && aiSearchActive && aiQuery) {
            try {
                const embedding = await window.electronAPI.clipEmbedText(aiQuery);
                currentTextEmbedding = embedding && embedding.ok && embedding.value ? l2Normalize(new Float32Array(embedding.value)) : null;
            } catch {
                currentTextEmbedding = null;
            }
        } else {
            currentTextEmbedding = null;
        }
        renderSearchOperatorChips();
        applyFilters();
    }, delay);
}

// Update the search result count badge ("X of Y") next to the search box.
// Hidden when search box is empty.
function updateSearchResultCount(visibleCount) {
    if (!searchResultCountEl) return;
    const query = searchBox.value.trim();
    if (!query) {
        searchResultCountEl.classList.remove('visible');
        searchResultCountEl.textContent = '';
        return;
    }
    const total = currentItems.length;
    searchResultCountEl.textContent = `${visibleCount} of ${total}`;
    searchResultCountEl.classList.add('visible');
}

// Clear debounce dot after filter results arrive
function clearSearchDebounceIndicator() {
    if (searchDebounceDotEl) searchDebounceDotEl.classList.remove('pulsing');
}

// ── Filename match highlighting ─────────────────────────────────────────────
// Wraps matched substrings in filenames with <mark class="search-hl"> when a
// text search is active. Skipped while AI visual search is on (similarity
// scoring doesn't map to substrings).
function getActiveSearchHighlightQuery() {
    if (aiVisualSearchEnabled && aiSearchActive) return '';
    // Highlight the free-text portion only, not operator tokens like "tag:cat".
    const q = (_parsedSearchQuery && _parsedSearchQuery.freeText) || '';
    return q ? q.trim().toLowerCase() : '';
}

function buildHighlightedFilenameHtml(text, queryLower) {
    if (!queryLower) return null;
    const lower = text.toLowerCase();
    let idx = lower.indexOf(queryLower);
    if (idx === -1) return null;
    const parts = [];
    let last = 0;
    const qLen = queryLower.length;
    while (idx !== -1) {
        parts.push(escapeHtml(text.slice(last, idx)));
        parts.push('<mark class="search-hl">');
        parts.push(escapeHtml(text.slice(idx, idx + qLen)));
        parts.push('</mark>');
        last = idx + qLen;
        idx = lower.indexOf(queryLower, last);
    }
    parts.push(escapeHtml(text.slice(last)));
    return parts.join('');
}

// Set a filename element's content, applying search highlighting when active.
// Safe to call from card creation + recycling paths.
function setCardFilenameContent(infoEl, name) {
    if (!infoEl) return;
    const q = getActiveSearchHighlightQuery();
    const html = q ? buildHighlightedFilenameHtml(name, q) : null;
    if (html) infoEl.innerHTML = html;
    else infoEl.textContent = name;
}

// Rebuild highlights across all currently visible cards. Called after filter
// results land so cards that weren't re-populated still reflect the new query.
function refreshVisibleFilenameHighlights() {
    const q = getActiveSearchHighlightQuery();
    const cards = gridContainer.querySelectorAll('.video-card');
    for (const card of cards) {
        const info = card.querySelector('.video-info');
        if (!info) continue;
        const name = card.dataset.name;
        if (!name) continue;
        if (q) {
            const html = buildHighlightedFilenameHtml(name, q);
            if (html) info.innerHTML = html;
            else info.textContent = name;
        } else if (info.querySelector('mark.search-hl')) {
            // Only touch DOM if highlights need removing
            info.textContent = name;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// GRID INTERACTION
// ═══════════════════════════════════════════════════════════════════════════
// Instead of attaching listeners to each card, delegate from gridContainer

let currentHoveredCard = null;

// ── Multi-select state ───────────────────────────────────────────────
const selectedCardPaths = new Set();
let lastSelectedCardIndex = -1; // index into vsState.sortedItems for shift-click range

// ── Marquee (drag-to-select) state ──────────────────────────────────
const marqueeState = {
    active: false,
    pending: false,       // mousedown recorded, waiting for dead-zone
    startClientX: 0,      // client coords at mousedown
    startClientY: 0,
    startContentX: 0,     // content coords (scroll-adjusted)
    startContentY: 0,
    element: null,        // the rectangle div
    ctrlHeld: false,
    preSelection: null,   // Set snapshot for Ctrl+drag
    rafId: null,
    justFinished: false,
    autoScrollId: null,
};

function clearCardSelection() {
    if (selectedCardPaths.size === 0) return;
    selectedCardPaths.clear();
    lastSelectedCardIndex = -1;
    document.querySelectorAll('.video-card.selected').forEach(c => c.classList.remove('selected'));
    updateSelectionStatusBar();
}

function selectAllCards() {
    selectedCardPaths.clear();
    let lastIndex = -1;
    for (let i = 0; i < vsState.sortedItems.length; i++) {
        const item = vsState.sortedItems[i];
        if (!item || item.type === 'folder' || item.type === 'group-header') continue;
        if (!item.path) continue;
        selectedCardPaths.add(item.path);
        lastIndex = i;
    }
    lastSelectedCardIndex = lastIndex;
    vsState.activeCards.forEach((card) => {
        if (card.dataset.path && selectedCardPaths.has(card.dataset.path)) {
            card.classList.add('selected');
        }
    });
    updateSelectionStatusBar();
}

function toggleCardSelection(card, itemIndex) {
    const p = card.dataset.path;
    if (!p) return;
    if (selectedCardPaths.has(p)) {
        selectedCardPaths.delete(p);
        card.classList.remove('selected');
    } else {
        selectedCardPaths.add(p);
        card.classList.add('selected');
    }
    lastSelectedCardIndex = itemIndex;
    updateSelectionStatusBar();
}

function rangeSelectCards(fromIndex, toIndex) {
    const lo = Math.min(fromIndex, toIndex);
    const hi = Math.max(fromIndex, toIndex);
    for (let i = lo; i <= hi; i++) {
        const item = vsState.sortedItems[i];
        if (!item || item.type === 'folder') continue;
        selectedCardPaths.add(item.path);
    }
    // Update visible card DOM
    vsState.activeCards.forEach((card) => {
        if (card.dataset.path && selectedCardPaths.has(card.dataset.path)) {
            card.classList.add('selected');
        }
    });
    lastSelectedCardIndex = toIndex;
    updateSelectionStatusBar();
}

function updateSelectionStatusBar() {
    const count = selectedCardPaths.size;
    const el = document.getElementById('status-selection-count');
    if (el) {
        el.textContent = count > 0 ? `${count} selected` : '';
        el.classList.toggle('hidden', count === 0);
    }
}

function getItemIndexForCard(card) {
    const path = card.dataset.path;
    if (!path) return -1;
    return vsState.sortedItems.findIndex(item => item.path === path);
}

// ── Marquee (drag-to-select) ────────────────────────────────────────

function marqueeClientToContent(clientX, clientY) {
    const rect = gridContainer.getBoundingClientRect();
    return {
        x: clientX - rect.left,
        y: clientY - rect.top + gridContainer.scrollTop
    };
}

function marqueeGetRect(cx, cy) {
    const cur = marqueeClientToContent(cx, cy);
    const x1 = Math.min(marqueeState.startContentX, cur.x);
    const y1 = Math.min(marqueeState.startContentY, cur.y);
    const x2 = Math.max(marqueeState.startContentX, cur.x);
    const y2 = Math.max(marqueeState.startContentY, cur.y);
    return { left: x1, top: y1, right: x2, bottom: y2 };
}

function marqueeUpdateRect(clientX, clientY) {
    if (!marqueeState.element) return;
    const containerRect = gridContainer.getBoundingClientRect();
    const cur = marqueeClientToContent(clientX, clientY);
    // Position the div in content space (absolute inside grid-container)
    const x1 = Math.min(marqueeState.startContentX, cur.x);
    const y1 = Math.min(marqueeState.startContentY, cur.y);
    const x2 = Math.max(marqueeState.startContentX, cur.x);
    const y2 = Math.max(marqueeState.startContentY, cur.y);
    marqueeState.element.style.left = x1 + 'px';
    marqueeState.element.style.top = y1 + 'px';
    marqueeState.element.style.width = (x2 - x1) + 'px';
    marqueeState.element.style.height = (y2 - y1) + 'px';
}

function marqueeComputeSelection(clientX, clientY) {
    if (!vsState.positions || !vsState.sortedItems.length) return;
    const sel = marqueeGetRect(clientX, clientY);
    const itemCount = vsState.sortedItems.length;

    // Rebuild selection
    selectedCardPaths.clear();
    if (marqueeState.ctrlHeld && marqueeState.preSelection) {
        for (const p of marqueeState.preSelection) selectedCardPaths.add(p);
    }

    // Binary search for first item whose bottom edge (top + height) >= sel.top
    let lo = 0, hi = itemCount - 1;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const midIdx = mid * 4;
        if (vsState.positions[midIdx + 1] + vsState.positions[midIdx + 3] < sel.top) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }

    // Iterate only items in the Y range of the marquee rectangle
    for (let i = lo; i < itemCount; i++) {
        const idx = i * 4;
        const cT = vsState.positions[idx + 1];
        if (cT > sel.bottom) break; // Past the marquee — done

        const item = vsState.sortedItems[i];
        if (!item.path || item.type === 'folder' || item.type === 'group-header') continue;
        const cL = vsState.positions[idx];
        const cR = cL + vsState.positions[idx + 2];
        const cB = cT + vsState.positions[idx + 3];
        if (!(sel.right < cL || sel.left > cR || sel.bottom < cT || sel.top > cB)) {
            selectedCardPaths.add(item.path);
        }
    }
    // Update visible card DOM
    vsState.activeCards.forEach((card) => {
        if (card.dataset.path) {
            card.classList.toggle('selected', selectedCardPaths.has(card.dataset.path));
        }
    });
    updateSelectionStatusBar();
}

function marqueeStartAutoScroll(clientY) {
    if (marqueeState.autoScrollId) return;
    const EDGE = 50, MAX_SPEED = 15;
    function step() {
        if (!marqueeState.active) { marqueeState.autoScrollId = null; return; }
        const rect = gridContainer.getBoundingClientRect();
        let speed = 0;
        if (clientY < rect.top + EDGE) {
            speed = -MAX_SPEED * (1 - Math.max(0, clientY - rect.top) / EDGE);
        } else if (clientY > rect.bottom - EDGE) {
            speed = MAX_SPEED * (1 - Math.max(0, rect.bottom - clientY) / EDGE);
        }
        if (Math.abs(speed) > 0.5) {
            gridContainer.scrollTop += speed;
        }
        marqueeState.autoScrollId = requestAnimationFrame(step);
    }
    marqueeState.autoScrollId = requestAnimationFrame(step);
}

function marqueeStopAutoScroll() {
    if (marqueeState.autoScrollId) {
        cancelAnimationFrame(marqueeState.autoScrollId);
        marqueeState.autoScrollId = null;
    }
}

function marqueeOnMouseMove(e) {
    if (!marqueeState.pending && !marqueeState.active) return;
    const dx = e.clientX - marqueeState.startClientX;
    const dy = e.clientY - marqueeState.startClientY;

    if (marqueeState.pending) {
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return; // dead zone
        // Activate marquee
        marqueeState.pending = false;
        marqueeState.active = true;
        gridContainer.classList.add('marquee-dragging');
        marqueeState.element = document.createElement('div');
        marqueeState.element.className = 'marquee-selection-rect';
        gridContainer.appendChild(marqueeState.element);
    }

    marqueeUpdateRect(e.clientX, e.clientY);

    // Auto-scroll near edges
    marqueeStopAutoScroll();
    const containerRect = gridContainer.getBoundingClientRect();
    if (e.clientY < containerRect.top + 50 || e.clientY > containerRect.bottom - 50) {
        marqueeStartAutoScroll(e.clientY);
    }

    // Throttle intersection via rAF
    if (!marqueeState.rafId) {
        const cx = e.clientX, cy = e.clientY;
        marqueeState.rafId = requestAnimationFrame(() => {
            marqueeState.rafId = null;
            if (marqueeState.active) marqueeComputeSelection(cx, cy);
        });
    }
}

function marqueeOnMouseUp(e) {
    document.removeEventListener('mousemove', marqueeOnMouseMove);
    document.removeEventListener('mouseup', marqueeOnMouseUp);
    marqueeStopAutoScroll();

    if (marqueeState.active) {
        marqueeComputeSelection(e.clientX, e.clientY);
        if (marqueeState.element && marqueeState.element.parentNode) {
            marqueeState.element.remove();
        }
        marqueeState.element = null;
        gridContainer.classList.remove('marquee-dragging');
        marqueeState.active = false;
        if (marqueeState.rafId) { cancelAnimationFrame(marqueeState.rafId); marqueeState.rafId = null; }
        // Suppress the click event that follows mouseup
        marqueeState.justFinished = true;
        requestAnimationFrame(() => { marqueeState.justFinished = false; });
    }
    marqueeState.pending = false;
    marqueeState.preSelection = null;
}

function cancelMarquee() {
    if (!marqueeState.active && !marqueeState.pending) return;
    document.removeEventListener('mousemove', marqueeOnMouseMove);
    document.removeEventListener('mouseup', marqueeOnMouseUp);
    marqueeStopAutoScroll();
    if (marqueeState.rafId) { cancelAnimationFrame(marqueeState.rafId); marqueeState.rafId = null; }
    if (marqueeState.element && marqueeState.element.parentNode) marqueeState.element.remove();
    marqueeState.element = null;
    gridContainer.classList.remove('marquee-dragging');
    // Restore pre-selection if Ctrl was held
    if (marqueeState.ctrlHeld && marqueeState.preSelection) {
        selectedCardPaths.clear();
        for (const p of marqueeState.preSelection) selectedCardPaths.add(p);
        vsState.activeCards.forEach((card) => {
            if (card.dataset.path) {
                card.classList.toggle('selected', selectedCardPaths.has(card.dataset.path));
            }
        });
        updateSelectionStatusBar();
    }
    marqueeState.active = false;
    marqueeState.pending = false;
    marqueeState.preSelection = null;
}

gridContainer.addEventListener('click', (e) => {
    // Suppress click after marquee drag
    if (marqueeState.justFinished) {
        marqueeState.justFinished = false;
        return;
    }

    // Date group header click
    const groupHeader = e.target.closest('.date-group-header');
    if (groupHeader && groupHeader.dataset.groupKey) {
        toggleDateGroup(groupHeader.dataset.groupKey);
        return;
    }

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
                const currentRating = getFileRating(card.dataset.path);
                // Toggle off if clicking the same star
                setFileRating(card.dataset.path, currentRating === starIndex ? 0 : starIndex);
            }
        }
        return;
    }

    // Media card click
    const mediaCard = e.target.closest('.video-card');
    if (mediaCard) {
        const isCtrl = e.ctrlKey || e.metaKey;
        const isShift = e.shiftKey;

        if (isCtrl) {
            // Toggle this card's selection
            const idx = getItemIndexForCard(mediaCard);
            toggleCardSelection(mediaCard, idx);
            return;
        }

        if (isShift && lastSelectedCardIndex >= 0) {
            // Range select from last selected to this card
            const idx = getItemIndexForCard(mediaCard);
            if (idx >= 0) {
                rangeSelectCards(lastSelectedCardIndex, idx);
            }
            return;
        }

        // Normal click — clear selection, open lightbox
        clearCardSelection();
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

// Prevent middle-click auto-scroll on cards + marquee drag-to-select
gridContainer.addEventListener('mousedown', (e) => {
    if (e.button === 1 && e.target.closest('.video-card, .folder-card')) {
        e.preventDefault();
        return;
    }
    // Marquee: left-click on empty grid space
    if (e.button === 0 && !e.target.closest('.video-card, .folder-card, .date-group-header, .star')) {
        marqueeState.ctrlHeld = e.ctrlKey || e.metaKey;
        if (marqueeState.ctrlHeld) {
            marqueeState.preSelection = new Set(selectedCardPaths);
        } else {
            clearCardSelection();
        }
        marqueeState.startClientX = e.clientX;
        marqueeState.startClientY = e.clientY;
        const content = marqueeClientToContent(e.clientX, e.clientY);
        marqueeState.startContentX = content.x;
        marqueeState.startContentY = content.y;
        marqueeState.pending = true;
        document.addEventListener('mousemove', marqueeOnMouseMove);
        document.addEventListener('mouseup', marqueeOnMouseUp);
        e.preventDefault();
    }
});

// Middle-click to select a card or open folder in new tab
gridContainer.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return; // Only middle mouse button
    e.preventDefault();

    // Middle-click folder card opens in new tab
    const folderCard = e.target.closest('.folder-card');
    if (folderCard) {
        const folderPath = folderCard.dataset.folderPath;
        const displayName = folderPath.split(/[/\\]/).pop();
        createTab(folderPath, displayName);
        return;
    }

    const card = e.target.closest('.video-card, .folder-card');
    if (!card) return;

    const cards = Array.from(gridContainer.querySelectorAll('.video-card, .folder-card'))
        .filter(c => c.style.display !== 'none');
    const index = cards.indexOf(card);
    if (index < 0) return;

    // Clear previous focus
    cards.forEach(c => {
        c.style.outline = '';
        c.style.outlineOffset = '';
    });

    // Set new focus
    focusedCardIndex = index;
    visibleCards = cards;
    card.style.outline = '2px solid var(--accent)';
    card.style.outlineOffset = '2px';

    updateStatusBarSelection(card);
});

gridContainer.addEventListener('mouseover', (e) => {
    if (marqueeState.active) return;
    const card = e.target.closest('.video-card');
    if (card && card !== currentHoveredCard) {
        if (card.dataset.mediaType === 'video') {
            currentHoveredCard = card;
            const video = card.querySelector('video');
            if (video) {
                showScrubber(card, video);
                // Pause video for scrub mode if hover scrub is enabled
                if (hoverScrubEnabled) {
                    video.pause();
                    card._scrubbing = true;
                    card._scrubRect = card.getBoundingClientRect(); // Cache rect for scrub mousemove
                }
            }
        } else if (card.dataset.gifDuration && Number(card.dataset.gifDuration) > 0) {
            currentHoveredCard = card;
            showGifProgress(card);
        }
    }
    // Check if filename text overlaps with right-aligned tags and shift if needed.
    // Deferred via rIC so the three gbcr reads don't force synchronous layout on the
    // mouseover critical path — was causing ~20ms cumulative reflow during fast scroll.
    if (card && !card.dataset.tagOverlapChecked) {
        card.dataset.tagOverlapChecked = '1'; // claim the slot immediately
        const runCheck = () => {
            if (!card.isConnected) return;
            const info = card.querySelector('.video-info');
            const tagsEl = card.querySelector('.card-tags');
            if (!info || !tagsEl) return;
            if (!cardInfoSettings.filename || !cardInfoSettings.tags) {
                tagsEl.classList.remove('tags-shifted');
                return;
            }
            const firstBadge = tagsEl.querySelector('.tag-badge');
            if (!firstBadge) {
                tagsEl.classList.remove('tags-shifted');
                return;
            }
            // Use scrollWidth + offsetLeft instead of 3 getBoundingClientRect calls
            // to avoid forced synchronous layout during hover
            const textWidth = info.scrollWidth;
            const badgeLeft = firstBadge.offsetLeft;
            tagsEl.classList.toggle('tags-shifted', textWidth + 16 > badgeLeft);
        };
        if ('requestIdleCallback' in window) {
            requestIdleCallback(runCheck, { timeout: 500 });
        } else {
            setTimeout(runCheck, 0);
        }
    }
});

// --- Video Scrub on Mousemove ---
let _scrubRafPending = false;

gridContainer.addEventListener('mousemove', (e) => {
    if (marqueeState.active) return;
    if (!currentHoveredCard || !currentHoveredCard._scrubbing) return;
    const card = currentHoveredCard;
    const video = card.querySelector('video');
    if (!video || video.readyState < 2 || !video.duration || isNaN(video.duration)) return;

    if (!_scrubRafPending) {
        _scrubRafPending = true;
        const clientX = e.clientX;
        requestAnimationFrame(() => {
            _scrubRafPending = false;
            if (!card._scrubbing) return;
            // Use cached rect to avoid forced synchronous layout every frame
            const rect = card._scrubRect || (card._scrubRect = card.getBoundingClientRect());
            const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            video.currentTime = pct * video.duration;
            // Update the time label and progress bar
            if (card._updateTimeDisplay) card._updateTimeDisplay();
        });
    }
});

gridContainer.addEventListener('mouseout', (e) => {
    if (!currentHoveredCard) return;
    const relatedCard = e.relatedTarget ? e.relatedTarget.closest('.video-card') : null;
    if (relatedCard !== currentHoveredCard) {
        // Resume video playback when leaving a scrubbed card
        if (currentHoveredCard._scrubbing) {
            const video = currentHoveredCard.querySelector('video');
            if (video && !(isWindowBlurred && pauseOnBlur) && !(isLightboxOpen && pauseOnLightbox)) video.play().catch(() => {});
            currentHoveredCard._scrubbing = false;
            delete currentHoveredCard._scrubRect; // Invalidate cached rect
        }
        hideScrubber(currentHoveredCard);
        hideGifProgress(currentHoveredCard);
        currentHoveredCard = null;
    }
});

// --- Card metadata hover tooltip ---
// Shows full metadata (size, date, dimensions, duration, tags, rating) after a
// short hover delay. Uses delegated listeners on gridContainer so it plays nice
// with virtual-scroll card recycling.
let _cardTooltipEl = null;
let _cardTooltipShowTimer = null;
let _cardTooltipCurrentCard = null;

function _ensureCardTooltipEl() {
    if (_cardTooltipEl) return _cardTooltipEl;
    _cardTooltipEl = document.createElement('div');
    _cardTooltipEl.className = 'card-hover-tooltip';
    document.body.appendChild(_cardTooltipEl);
    return _cardTooltipEl;
}

function _buildCardTooltipHtml(card) {
    const path = card.dataset.path;
    if (!path) return null;
    // Pull authoritative item data from vsState.sortedItems when available
    let item = null;
    if (typeof card._vsItemIndex === 'number' && typeof vsState.sortedItems !== 'undefined' && vsState.sortedItems[card._vsItemIndex]) {
        item = vsState.sortedItems[card._vsItemIndex];
    }
    const name = (item && item.name) || card.dataset.name || '';
    const width = (item && item.width) || parseInt(card.dataset.width || '0', 10) || 0;
    const height = (item && item.height) || parseInt(card.dataset.height || '0', 10) || 0;
    const mtime = (item && item.mtime) || Number(card.dataset.mtime || 0);
    const size = item && item.size;
    const duration = item && item.duration;
    const rating = typeof getFileRating === 'function' ? getFileRating(path) : 0;
    const tags = fileTagsCache.get(normalizePath(path)) || [];

    const rows = [];
    // Filename as heading
    rows.push(`<div class="cht-name">${escapeHtml(name)}</div>`);
    // Truncated path
    rows.push(`<div class="cht-path">${escapeHtml(path)}</div>`);

    const details = [];
    if (width > 0 && height > 0) details.push(`${width}\u00d7${height}`);
    if (size != null && size > 0) details.push(formatBytesForCardLabel(size));
    if (duration != null && duration > 0) details.push(formatMediaDuration(duration));
    if (mtime > 0) details.push(formatCardDate(mtime));
    if (details.length > 0) {
        rows.push(`<div class="cht-details">${details.map(d => escapeHtml(d)).join('  \u2022  ')}</div>`);
    }

    if (rating > 0) {
        rows.push(`<div class="cht-rating">${'\u2605'.repeat(rating)}${'\u2606'.repeat(5 - rating)}</div>`);
    }

    if (tags.length > 0) {
        const chips = tags.slice(0, 8).map(t => {
            const color = t.color ? ` style="background:${escapeHtml(t.color)}"` : '';
            return `<span class="cht-tag"${color}>${escapeHtml(t.name)}</span>`;
        }).join('');
        const more = tags.length > 8 ? `<span class="cht-tag cht-tag-more">+${tags.length - 8}</span>` : '';
        rows.push(`<div class="cht-tags">${chips}${more}</div>`);
    }

    return rows.join('');
}

function _positionCardTooltip(tooltip, card) {
    const rect = card.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Measure tooltip after content assigned
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    // Prefer below-right of the card; flip if not enough room
    let left = rect.left;
    let top = rect.bottom + 8;
    if (top + th > vh - 8) top = Math.max(8, rect.top - th - 8);
    if (left + tw > vw - 8) left = Math.max(8, vw - tw - 8);
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
}

function _hideCardTooltip() {
    if (_cardTooltipShowTimer) { clearTimeout(_cardTooltipShowTimer); _cardTooltipShowTimer = null; }
    if (_cardTooltipEl) _cardTooltipEl.classList.remove('visible');
    _cardTooltipCurrentCard = null;
}

function _scheduleCardTooltip(card) {
    if (!cardInfoSettings.hoverTooltip) return;
    if (_cardTooltipCurrentCard === card) return;
    _hideCardTooltip();
    _cardTooltipCurrentCard = card;
    _cardTooltipShowTimer = setTimeout(() => {
        _cardTooltipShowTimer = null;
        if (_cardTooltipCurrentCard !== card) return;
        // Don't show while scrubbing a video — the scrubber UI is more useful
        if (card._scrubbing) return;
        const html = _buildCardTooltipHtml(card);
        if (!html) return;
        const el = _ensureCardTooltipEl();
        el.innerHTML = html;
        el.classList.add('visible');
        _positionCardTooltip(el, card);
    }, 500);
}

gridContainer.addEventListener('mouseover', (e) => {
    if (marqueeState.active) return;
    const card = e.target.closest('.video-card');
    if (card) _scheduleCardTooltip(card);
    else _hideCardTooltip();
});

gridContainer.addEventListener('mouseout', (e) => {
    const from = e.target.closest('.video-card');
    const to = e.relatedTarget ? e.relatedTarget.closest('.video-card') : null;
    if (from && from !== to) _hideCardTooltip();
});

// Hide tooltip when user starts scrolling, clicks, or opens context menu
gridContainer.addEventListener('scroll', _hideCardTooltip, { passive: true });
gridContainer.addEventListener('mousedown', _hideCardTooltip, true);
document.addEventListener('contextmenu', _hideCardTooltip, true);

// ═══════════════════════════════════════════════════════════════════════════
// DRAG & DROP
// ═══════════════════════════════════════════════════════════════════════════

// Floating drag label
const dragDropLabel = document.getElementById('drag-drop-label');
let _dragLabelVisible = false;

function showDragLabel(e, operation, destName) {
    if (!dragDropLabel) return;
    dragDropLabel.innerHTML = `<span class="drag-op">${escapeHtml(operation)}</span> ${escapeHtml(destName)}`;
    dragDropLabel.style.left = `${e.clientX + 16}px`;
    dragDropLabel.style.top = `${e.clientY + 16}px`;
    if (!_dragLabelVisible) {
        dragDropLabel.classList.remove('hidden');
        _dragLabelVisible = true;
    }
}

function hideDragLabel() {
    if (!dragDropLabel) return;
    dragDropLabel.classList.add('hidden');
    _dragLabelVisible = false;
}

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
// Tracks the paths currently being dragged via a native (startDrag) session.
// Used by drop handlers to distinguish an "internal" move (drag from this
// app's own grid) from an "external" copy (drag from Explorer / another app).
let _nativeDragPaths = null;
let _nativeDragClearTimer = null;

function getDroppedFilePaths(dataTransfer) {
    // Check for internal app drag (media card) via legacy MIME (Shift+drag path)
    const internalPath = dataTransfer.getData('application/x-thumbnail-animator-path');
    if (internalPath) {
        return { paths: [internalPath], isInternal: true };
    }
    // Check for external files dropped from Explorer / native drag
    if (dataTransfer.files && dataTransfer.files.length > 0) {
        const paths = [];
        for (const file of dataTransfer.files) {
            const filePath = window.electronAPI.getPathForFile(file);
            if (filePath && isDroppedFileSupported(file.name)) {
                paths.push(filePath);
            }
        }
        // If every dropped path matches what we just native-dragged out, treat
        // this as an internal move (not an external copy).
        const isInternal = paths.length > 0 && _nativeDragPaths
            && paths.every(p => _nativeDragPaths.has(p));
        return { paths, isInternal };
    }
    return { paths: [], isInternal: false };
}

// Copy external files into a destination folder
async function copyFilesToFolder(filePaths, destFolder) {
    if (!filePaths || filePaths.length === 0) return;
    const previousScrollTop = gridContainer.scrollTop;

    showProgress(0, filePaths.length, 'Copying files...');
    let success = 0;
    let failed = 0;
    let savedResolution = null;

    for (let i = 0; i < filePaths.length; i++) {
        if (currentProgress && currentProgress.cancelled) break;

        const filePath = filePaths[i];
        const fileName = filePath.replace(/^.*[\\/]/, '');

        try {
            let result = await window.electronAPI.copyFile(filePath, destFolder, fileName);
            if (result.ok && result.value && result.value.status === 'conflict') {
                const resolution = savedResolution
                    || (await showFileConflictDialog(result.value.fileName, filePath, result.value.destPath, i < filePaths.length - 1));
                if (resolution.applyToAll) savedResolution = resolution;
                result = await window.electronAPI.copyFile(filePath, destFolder, fileName, resolution.resolution);
            }
            if (result.ok) {
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
        // Refresh current folder while preserving the user's viewport position.
        if (currentFolderPath) {
            invalidateFolderCache(currentFolderPath);
            await loadVideos(currentFolderPath, false, previousScrollTop);
        }
    }
    if (failed > 0 && success > 0) {
        showToast(`Copied ${success} file(s), ${failed} failed`, 'warning');
    } else if (failed > 0) {
        showToast(`Failed to copy ${failed} file(s)`, 'error');
    } else if (success > 0) {
        showToast(`Copied ${success} file(s)`, 'success');
    }
}

// Helper to check if a drag event carries external files
function isDragWithFiles(e) {
    return e.dataTransfer.types.includes('Files');
}

// Helper: resolve folder card under pointer for drag ops. Works for both
// DOM grid (closest) and canvas grid (hit-test via CG).
function _resolveDragFolderCard(e) {
    const dom = e.target.closest('.folder-card');
    if (dom) return dom;
    if (window.CG && window.CG.isEnabled() && typeof window.CG.targetFromEvent === 'function') {
        const vcard = window.CG.targetFromEvent(e);
        if (vcard && vcard.closest && vcard.closest('.folder-card')) return vcard;
    }
    return null;
}

// Delegated dragstart that bubbles from the <img>/<video> inside a card.
// Converts the HTML drag into a native OS drag via webContents.startDrag so
// files can be dropped into Explorer / email / external apps. The native drag
// also dispatches drop events back inside the window (with e.dataTransfer.files
// populated), so in-app drops on the collections sidebar still work.
// Shift+drag keeps the legacy HTML drag so the existing folder-move behavior
// (drop card onto a folder card in the grid) is preserved.
gridContainer.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.video-card');
    if (!card || !card.dataset.path) return;
    const path = card.dataset.path;

    // If this card is part of a larger selection, drag the whole selection
    let paths;
    if (typeof selectedCardPaths !== 'undefined' && selectedCardPaths.has(path) && selectedCardPaths.size > 1) {
        paths = Array.from(selectedCardPaths).filter(Boolean);
    } else {
        paths = [path];
    }

    // Shift+drag: keep HTML drag for legacy in-app folder-move behavior
    if (e.shiftKey) {
        try {
            e.dataTransfer.setData('application/x-tcat-files', JSON.stringify({ paths }));
        } catch { /* some MIME combos can throw — ignore */ }
        card.classList.add('dragging');
        return;
    }

    // Default: native OS drag (the only reliable way to produce a real file
    // drag on Windows). Cancel the HTML drag and hand off to Electron.
    e.preventDefault();
    // Remember which paths are being native-dragged so that in-app drops
    // (folder cards, collections) can still distinguish "internal" moves.
    _nativeDragPaths = new Set(paths);
    // Safety: clear the tag after 30s in case we never see a drop event
    // (e.g. user dragged to Explorer, never came back to this window).
    if (_nativeDragClearTimer) clearTimeout(_nativeDragClearTimer);
    _nativeDragClearTimer = setTimeout(() => { _nativeDragPaths = null; }, 30000);
    window.electronAPI.startDragFiles(paths);
});

gridContainer.addEventListener('dragend', (e) => {
    const card = e.target.closest('.video-card');
    if (card) card.classList.remove('dragging');
    // Also clear any leftover drag-over highlights on collection rows
    document.querySelectorAll('.collection-item.collection-drag-over')
        .forEach(el => el.classList.remove('collection-drag-over'));
});

// Drop on grid — copy external files into current folder
gridContainer.addEventListener('dragenter', (e) => {
    const folderCard = _resolveDragFolderCard(e);
    const isInternal = e.dataTransfer.types.includes('application/x-thumbnail-animator-path');
    if (folderCard || isInternal || (isDragWithFiles(e) && currentFolderPath)) {
        e.preventDefault();
    }
});

gridContainer.addEventListener('dragover', (e) => {
    const folderCard = _resolveDragFolderCard(e);
    const isInternal = e.dataTransfer.types.includes('application/x-thumbnail-animator-path');
    if (folderCard || isInternal || (isDragWithFiles(e) && currentFolderPath)) {
        e.preventDefault();
        const isMove = folderCard && isInternal;
        e.dataTransfer.dropEffect = isMove ? 'move' : 'copy';
        if (folderCard) {
            if (folderCard.classList && folderCard.classList.add) folderCard.classList.add('drag-over');
            const folderName = folderCard.dataset ? (folderCard.dataset.name || 'folder')
                : (folderCard.querySelector && folderCard.querySelector('.folder-name')?.textContent) || 'folder';
            showDragLabel(e, isMove ? 'Move to' : 'Copy to', folderName);
        } else if (!isInternal && currentFolderPath) {
            const currentName = currentFolderPath.split(/[/\\]/).pop();
            showDragLabel(e, 'Copy to', currentName);
        } else {
            hideDragLabel();
        }
    }
});

gridContainer.addEventListener('dragleave', (e) => {
    const folderCard = _resolveDragFolderCard(e);
    if (folderCard && folderCard.classList && folderCard.classList.remove) {
        folderCard.classList.remove('drag-over');
    }
    // Hide label when leaving grid entirely
    if (e.target === gridContainer || !gridContainer.contains(e.relatedTarget)) {
        hideDragLabel();
    }
});

gridContainer.addEventListener('drop', async (e) => {
    e.preventDefault();
    hideDragLabel();

    // Remove drag-over styling
    gridContainer.querySelectorAll('.folder-card.drag-over').forEach(c => c.classList.remove('drag-over'));

    const { paths, isInternal } = getDroppedFilePaths(e.dataTransfer);
    // Consumed — clear the native-drag tag so future external drops don't
    // accidentally look "internal".
    _nativeDragPaths = null;
    if (_nativeDragClearTimer) { clearTimeout(_nativeDragClearTimer); _nativeDragClearTimer = null; }
    if (paths.length === 0) return;

    // Check if dropped on a folder card
    const folderCard = _resolveDragFolderCard(e);
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
sidebarTree.addEventListener('dragenter', (e) => {
    const row = e.target.closest('.tree-node-row');
    if (row) {
        e.preventDefault();
    }
});

sidebarTree.addEventListener('dragover', (e) => {
    const row = e.target.closest('.tree-node-row');
    if (row) {
        e.preventDefault();
        const isInternal = e.dataTransfer.types.includes('application/x-thumbnail-animator-path');
        e.dataTransfer.dropEffect = isInternal ? 'move' : 'copy';
        row.classList.add('drag-over');
        const node = row.closest('.tree-node');
        const folderName = row.querySelector('.tree-node-label')?.textContent || 'folder';
        showDragLabel(e, isInternal ? 'Move to' : 'Copy to', folderName);
    }
});

sidebarTree.addEventListener('dragleave', (e) => {
    const row = e.target.closest('.tree-node-row');
    if (row) {
        row.classList.remove('drag-over');
    }
    if (!sidebarTree.contains(e.relatedTarget)) {
        hideDragLabel();
    }
});

sidebarTree.addEventListener('drop', async (e) => {
    e.preventDefault();
    hideDragLabel();

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
document.addEventListener('dragenter', (e) => {
    e.preventDefault();
});
document.addEventListener('dragover', (e) => {
    e.preventDefault();
    // Set copy effect for external file drags so the OS shows the correct cursor
    if (e.dataTransfer.types.includes('Files')) {
        e.dataTransfer.dropEffect = 'copy';
    }
});
document.addEventListener('drop', (e) => {
    e.preventDefault();
    hideDragLabel();
    // Clear native-drag tag after any drop (safety net for sidebar / other targets)
    _nativeDragPaths = null;
    if (_nativeDragClearTimer) { clearTimeout(_nativeDragClearTimer); _nativeDragClearTimer = null; }
});
document.addEventListener('dragend', () => {
    hideDragLabel();
});

window.addEventListener('beforeunload', () => {
    _flushStorageWrites();
    if (!currentFolderPath) return;
    try {
        sessionStorage.setItem(SESSION_SCROLL_RESTORE_KEY, JSON.stringify({
            path: currentFolderPath,
            scrollTop: gridContainer.scrollTop,
            timestamp: Date.now()
        }));
    } catch {
        // Ignore storage errors
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// EVENT WIRING
// ═══════════════════════════════════════════════════════════════════════════

selectFolderBtn.addEventListener('click', async () => {
    // Get the last folder path from localStorage if remembering is enabled
    const lastFolderPath = rememberLastFolder ? localStorage.getItem('lastFolderPath') : null;
    const _selectRes = await window.electronAPI.selectFolder(lastFolderPath);
    const folderPath = _selectRes && _selectRes.ok ? _selectRes.value : null;
    if (folderPath) {
        // Save the selected folder path to localStorage if remembering is enabled
        if (rememberLastFolder) {
            deferLocalStorageWrite('lastFolderPath', folderPath);
        }
        // Update current tab if it exists and has no path, otherwise create new tab
        if (activeTabId != null) {
            const tab = tabs.find(t => t.id === activeTabId);
            if (tab && !tab.path) {
                // Update empty tab
                tab.path = folderPath;
                tab.name = folderPath.split(/[/\\]/).filter(Boolean).pop();
                saveTabs();
                renderTabs();
            } else {
                // Create new tab
                createTab(folderPath, folderPath.split(/[/\\]/).filter(Boolean).pop());
            }
        } else {
            createTab(folderPath, folderPath.split(/[/\\]/).filter(Boolean).pop());
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
// We capture mousedown early to block any default/inner handlers, but ACT on mouseup
// (mirroring the original behavior). Use a flag to guarantee one-nav-per-press.
let _mouseNavPending = null; // 'prev' | 'next' | null

window.addEventListener('mousedown', (e) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    e.stopPropagation();
    _mouseNavPending = (e.button === 3) ? 'prev' : 'next';
}, true);

window.addEventListener('mouseup', (e) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();
    e.stopPropagation();
    const dir = _mouseNavPending;
    _mouseNavPending = null;
    if (!dir) return;
    const lb = document.getElementById('lightbox');
    if (lb && !lb.classList.contains('hidden')) {
        // Walk lightbox viewing history (like a browser)
        const moved = (dir === 'prev') ? _lbHistoryGoBack() : _lbHistoryGoForward();
        if (!moved) {
            // No more history in that direction — fall back to list navigation
            navigateLightbox(dir);
        }
        return;
    }
    if (dir === 'prev') {
        if (navigationHistory.canGoBack()) goBack();
    } else {
        if (navigationHistory.canGoForward()) goForward();
    }
}, true);

// Swallow auxclick for back/forward so nothing else reacts to it
window.addEventListener('auxclick', (e) => {
    if (e.button === 3 || e.button === 4) { e.preventDefault(); e.stopPropagation(); }
}, true);

// Function to show drives selection
async function showDrivesSelection() {
    try {
        const _drvRes = await window.electronAPI.getDrives();
        const drives = _drvRes && _drvRes.ok ? (_drvRes.value || []) : [];
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
        const escapedPath = pathForData.replace(/\\/g, '\\\\').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const escapedPart = typeof escapeHtml === 'function' ? escapeHtml(part) : part.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        breadcrumbHTML += `<span class="breadcrumb-item" data-path="${escapedPath}">${escapedPart}</span>`;
        if (index < breadcrumbParts.length - 1) {
            breadcrumbHTML += '<span class="breadcrumb-separator">/</span>';
        }
    });
    
    // Add editable path input (hidden by default, shown when clicked)
    const escapedFolderPath = folderPath.replace(/\\/g, '\\\\').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    breadcrumbHTML += `<input type="text" class="breadcrumb-input" value="${escapedFolderPath}" style="display: none;">`;

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
    
    // Add drag-drop handlers to breadcrumb items (move files to parent folders)
    breadcrumbContainer.querySelectorAll('.breadcrumb-item').forEach(item => {
        const targetPath = item.dataset.path;
        if (!targetPath || targetPath === 'computer') return;
        const normalizedTarget = targetPath.replace(/\\\\/g, '\\');

        item.addEventListener('dragenter', (e) => {
            const isInternal = e.dataTransfer.types.includes('application/x-thumbnail-animator-path');
            if (isInternal || isDragWithFiles(e)) {
                e.preventDefault();
                e.stopPropagation();
            }
        });

        item.addEventListener('dragover', (e) => {
            const isInternal = e.dataTransfer.types.includes('application/x-thumbnail-animator-path');
            if (isInternal || isDragWithFiles(e)) {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = isInternal ? 'move' : 'copy';
                item.classList.add('drag-over');
                const folderName = item.textContent;
                showDragLabel(e, isInternal ? 'Move to' : 'Copy to', folderName);
            }
        });

        item.addEventListener('dragleave', (e) => {
            item.classList.remove('drag-over');
            if (!breadcrumbContainer.contains(e.relatedTarget)) {
                hideDragLabel();
            }
        });

        item.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            item.classList.remove('drag-over');
            hideDragLabel();

            const { paths, isInternal } = getDroppedFilePaths(e.dataTransfer);
            if (paths.length === 0) return;

            if (isInternal) {
                await moveFilesToFolder(paths, normalizedTarget);
            } else {
                await copyFilesToFolder(paths, normalizedTarget);
            }
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
function showLoadingIndicator(message) {
    if (loadingIndicator) {
        const textEl = loadingIndicator.querySelector('.loading-text');
        if (textEl) textEl.textContent = message || 'Loading...';
        loadingIndicator.classList.remove('hidden');
    }
}

function hideLoadingIndicator() {
    if (loadingIndicator) {
        loadingIndicator.classList.add('hidden');
        const textEl = loadingIndicator.querySelector('.loading-text');
        if (textEl) textEl.textContent = 'Loading...';
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

const SESSION_SCROLL_RESTORE_KEY = 'thumbnailAnimator.pendingScrollRestore';

function getPendingSessionScrollRestore() {
    try {
        const raw = sessionStorage.getItem(SESSION_SCROLL_RESTORE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.path !== 'string' || typeof parsed.scrollTop !== 'number') return null;
        return parsed;
    } catch {
        return null;
    }
}

function clearPendingSessionScrollRestore() {
    try {
        sessionStorage.removeItem(SESSION_SCROLL_RESTORE_KEY);
    } catch {
        // Ignore storage errors
    }
}

function restoreGridScrollPosition(targetScrollTop) {
    if (typeof targetScrollTop !== 'number' || !Number.isFinite(targetScrollTop)) return;
    const applyRestore = () => {
        const maxScrollTop = Math.max(0, gridContainer.scrollHeight - gridContainer.clientHeight);
        const clamped = Math.max(0, Math.min(targetScrollTop, maxScrollTop));
        gridContainer.scrollTop = clamped;
        if (vsState.enabled) {
            const viewportHeight = gridContainer.clientHeight;
            const { startIndex, endIndex } = vsGetVisibleRange(gridContainer.scrollTop, viewportHeight);
            // Force the virtual list to match the restored viewport immediately.
            vsUpdateDOM(startIndex, endIndex);
        }
    };
    applyRestore();
    requestAnimationFrame(() => {
        applyRestore();
        setTimeout(() => {
            applyRestore();
            scheduleCleanupCycle();
        }, 0);
    });
}

// Function to navigate to a folder
async function navigateToFolder(folderPath, addToHistory = true, forceReload = false) {
    // Exit collection mode when navigating to a folder
    if (currentCollectionId) {
        // Hand off any in-flight foreground AI scan to the background scanner
        if (_aiForegroundScanCollectionId && _aiForegroundScanCollectionId === currentCollectionId) {
            const handoffId = _aiForegroundScanCollectionId;
            _aiForegroundScanCollectionId = null;
            backgroundScanSmartCollection(handoffId);
        }
        currentCollectionId = null;
        _collectionLoadToken++; // Cancel any in-flight smart collection scan
        highlightActiveCollection(null);
    }
    const perfStart = perfTest.start();
    const folderName = folderPath.split(/[/\\]/).filter(Boolean).pop() || folderPath;
    setStatusActivity(`Navigating to ${folderName}...`);
    const previousFolderPath = currentFolderPath;
    const previousScrollTop = gridContainer.scrollTop;
    const previousSearchValue = searchBox.value;
    const previousParsedSearchQuery = _parsedSearchQuery;
    const previousFilter = currentFilter;
    const previousSortType = sortType;
    const previousSortOrder = sortOrder;
    // Save scroll position for the folder we're leaving (only within the same tab —
    // tab switches are handled by snapshotCurrentTabDom before activeTabId changes)
    if (previousFolderPath && activeTabId != null) {
        const currentTab = tabs.find(t => t.id === activeTabId);
        if (currentTab && normalizePath(currentTab.path) === normalizePath(previousFolderPath)) {
            getTabScrollMap(activeTabId).set(normalizePath(previousFolderPath), previousScrollTop);
        }
    }
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
            if (activeTabId != null) {
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
        
        if (!hasCachedContent) {
            forceReload = true;
        }
        
        // Yield control to allow UI to update
        await yieldToEventLoop();
        
        // If scan succeeds (even with empty results), path is valid
        currentFolderPath = folderPath;
        searchBox.value = ''; // Clear search when navigating
        _parsedSearchQuery = { freeText: '', operators: parseSearchQuery('').operators };
        renderSearchOperatorChips();
        currentFilter = 'all'; // Reset filter when navigating
        filterAllBtn.classList.add('active');
        filterVideosBtn.classList.remove('active');
        filterImagesBtn.classList.remove('active');

        // Restore per-folder sort preferences (skip if advanced search has active filters/sort)
        const advSearchBtn = document.getElementById('advanced-search-btn');
        const hasActiveAdvancedSearch = advSearchBtn && advSearchBtn.classList.contains('active');
        if (!hasActiveAdvancedSearch) {
            const folderPref = getFolderSortPref(folderPath);
            if (folderPref) {
                sortType = folderPref.sortType;
                sortOrder = folderPref.sortOrder;
                if (sortTypeSelect) sortTypeSelect.value = sortType;
                if (sortOrderSelect) sortOrderSelect.value = sortOrder;
            }
        }

        const normalizedTargetPath = normalizePath(folderPath);
        const isSameFolder = previousFolderPath && normalizePath(previousFolderPath) === normalizedTargetPath;
        let preservedScrollTop = isSameFolder ? previousScrollTop : null;
        // Check per-folder scroll position map
        if (preservedScrollTop === null && activeTabId != null) {
            const saved = getTabScrollMap(activeTabId).get(normalizedTargetPath);
            if (saved !== undefined) preservedScrollTop = saved;
        }
        if (preservedScrollTop === null) {
            const pendingRestore = getPendingSessionScrollRestore();
            if (pendingRestore && normalizePath(pendingRestore.path) === normalizedTargetPath) {
                preservedScrollTop = pendingRestore.scrollTop;
            }
        }
        await loadVideos(folderPath, !forceReload, preservedScrollTop); // Use cache unless forcing reload
        clearPendingSessionScrollRestore();

        // Save the folder path to localStorage whenever we navigate to a folder (if remembering is enabled)
        if (rememberLastFolder) {
            deferLocalStorageWrite('lastFolderPath', folderPath);
        }
        if (addToHistory) {
            navigationHistory.add(folderPath);
        }

        updateCurrentTab(folderPath, folderName);
        updateBreadcrumb(folderPath);

        // Sync sidebar tree with current folder — expand tree then highlight
        sidebarExpandToPath(folderPath);

        // Reset keyboard focus
        focusedCardIndex = -1;
        perfTest.end('navigateToFolder', perfStart);
    } catch (error) {
        currentFolderPath = previousFolderPath;
        searchBox.value = previousSearchValue;
        searchClearBtn.style.display = previousSearchValue ? '' : 'none';
        _parsedSearchQuery = previousParsedSearchQuery;
        renderSearchOperatorChips();
        currentFilter = previousFilter;
        sortType = previousSortType;
        sortOrder = previousSortOrder;
        if (sortTypeSelect) sortTypeSelect.value = sortType;
        if (sortOrderSelect) sortOrderSelect.value = sortOrder;
        filterAllBtn.classList.toggle('active', currentFilter === 'all');
        filterVideosBtn.classList.toggle('active', currentFilter === 'video');
        filterImagesBtn.classList.toggle('active', currentFilter === 'image');
        updateItemCount();
        perfTest.end('navigateToFolder', perfStart);
        // Path doesn't exist or is invalid - show error and revert breadcrumb
        console.error('Invalid path:', folderPath, error);
        // Revert breadcrumb to current path
        if (previousFolderPath) {
            updateBreadcrumb(previousFolderPath);
        }
        showToast(`Path not found: ${folderPath}`, 'error');
    }
}

// Navigation functions
let _navBusy = false;
async function goBack() {
    if (_navBusy) return;
    const path = navigationHistory.goBack();
    if (path) {
        _navBusy = true;
        try {
            await navigateToFolder(path, false);
        } catch (err) {
            console.error('Error navigating back:', err);
            hideLoadingIndicator();
        } finally {
            _navBusy = false;
        }
    }
}

async function goForward() {
    if (_navBusy) return;
    const path = navigationHistory.goForward();
    if (path) {
        _navBusy = true;
        try {
            await navigateToFolder(path, false);
        } catch (err) {
            console.error('Error navigating forward:', err);
            hideLoadingIndicator();
        } finally {
            _navBusy = false;
        }
    }
}

// Live search as user types (debounced)
searchBox.addEventListener('input', (e) => {
    searchClearBtn.style.display = e.target.value ? '' : 'none';
    performSearch(e.target.value);
    // Update save-search button state immediately on input (don't wait for filter round-trip)
    if (typeof updateSaveSearchButtonState === 'function') updateSaveSearchButtonState();
});

// Clear search button
searchClearBtn.addEventListener('click', () => {
    searchBox.value = '';
    searchClearBtn.style.display = 'none';
    performSearch('');
    searchBox.focus();
});

// Filter button event listeners
filterAllBtn.addEventListener('click', () => {
    currentFilter = 'all';
    filterAllBtn.classList.add('active');
    filterVideosBtn.classList.remove('active');
    filterImagesBtn.classList.remove('active');

    scheduleApplyFilters();
});

filterVideosBtn.addEventListener('click', () => {
    currentFilter = 'video';
    filterAllBtn.classList.remove('active');
    filterVideosBtn.classList.add('active');
    filterImagesBtn.classList.remove('active');

    scheduleApplyFilters();
});

filterImagesBtn.addEventListener('click', () => {
    currentFilter = 'image';
    filterAllBtn.classList.remove('active');
    filterVideosBtn.classList.remove('active');
    filterImagesBtn.classList.add('active');

    scheduleApplyFilters();
});


// Settings button event listener
settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSettingsModal();
});

// ═══ → settings-ui.js (settings modal listeners, export/import, cache, plugins, playback, hover scale, AI settings) ═══

// --- Find Similar banner event listeners ---
(function initFindSimilarBanner() {
    const thresholdSlider = document.getElementById('find-similar-threshold');
    const thresholdValue = document.getElementById('find-similar-threshold-value');
    const allFoldersCheckbox = document.getElementById('find-similar-all-folders');
    const clearBtn = document.getElementById('find-similar-clear');
    let _fsThresholdTimer = null;

    if (thresholdSlider) {
        thresholdSlider.addEventListener('input', () => {
            findSimilarState.threshold = parseInt(thresholdSlider.value, 10) / 100;
            if (thresholdValue) thresholdValue.textContent = findSimilarState.threshold.toFixed(2);
            if (!findSimilarState.active || !findSimilarState.embedding) return;
            // Debounce the heavy re-render to avoid card flashing while dragging
            clearTimeout(_fsThresholdTimer);
            _fsThresholdTimer = setTimeout(() => {
                if (findSimilarState.allFolders) {
                    executeCrossFolderFindSimilar();
                } else {
                    applyFilters();
                    updateFindSimilarCount();
                }
            }, 200);
        });
    }

    if (allFoldersCheckbox) {
        allFoldersCheckbox.addEventListener('change', () => {
            findSimilarState.allFolders = allFoldersCheckbox.checked;
            if (!findSimilarState.active || !findSimilarState.embedding) return;
            if (findSimilarState.allFolders) {
                // Stash current state before switching to cross-folder
                if (!findSimilarState.previousItems) {
                    findSimilarState.previousItems = currentItems.slice();
                    findSimilarState.previousFolder = currentFolderPath;
                }
                executeCrossFolderFindSimilar();
            } else {
                // Restore previous view and use current-folder filter
                if (findSimilarState.previousItems) {
                    currentItems = findSimilarState.previousItems;
                    currentFolderPath = findSimilarState.previousFolder;
                    findSimilarState.previousItems = null;
                    findSimilarState.previousFolder = null;
                    if (currentFolderPath) {
                        const st = gridContainer.scrollTop;
                        loadVideos(currentFolderPath, true, st);
                    }
                } else {
                    applyFilters();
                }
                updateFindSimilarCount();
            }
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => clearFindSimilar());
    }
})();

// --- Background embedding pipeline ---

function cancelEmbeddingScan() {
    if (embeddingScanAbortController) {
        embeddingScanAbortController.abort();
        embeddingScanAbortController = null;
    }
    hideEmbedProgressUI();
}

function showEmbedProgressUI(totalFiles) {
    const el = document.getElementById('ai-embed-progress');
    if (!el) return;
    el.style.display = 'flex';
    const fill = document.getElementById('ai-embed-progress-fill');
    const text = document.getElementById('ai-embed-progress-text');
    const totalFill = document.getElementById('ai-embed-total-fill');
    const totalText = document.getElementById('ai-embed-total-text');
    if (fill) fill.style.width = '0%';
    if (text) text.textContent = `0 / 0`;
    if (totalFill) totalFill.style.width = '0%';
    if (totalText) totalText.textContent = `0 / ${totalFiles}`;
}

function updateEmbedProgressUI(current, total) {
    const fill = document.getElementById('ai-embed-progress-fill');
    const text = document.getElementById('ai-embed-progress-text');
    if (fill) fill.style.width = total > 0 ? `${Math.round((current / total) * 100)}%` : '0%';
    if (text) text.textContent = `${current} / ${total}`;
}

function updateTotalProgressUI(done, total) {
    const fill = document.getElementById('ai-embed-total-fill');
    const text = document.getElementById('ai-embed-total-text');
    if (fill) fill.style.width = total > 0 ? `${Math.round((done / total) * 100)}%` : '0%';
    if (text) text.textContent = `${done} / ${total}`;
}

function hideEmbedProgressUI() {
    const el = document.getElementById('ai-embed-progress');
    if (el) el.style.display = 'none';
}

async function scheduleBackgroundEmbedding(items) {
    cancelEmbeddingScan();
    embeddingScanAbortController = new AbortController();
    const signal = embeddingScanAbortController.signal;

    const mediaItems = (items || []).filter(i => i.type !== 'folder');
    if (mediaItems.length === 0) return;

    // Load cached embeddings from IndexedDB
    try {
        const cached = await getCachedEmbeddings(mediaItems.map(i => ({ path: i.path, mtime: i.mtime || 0 })));
        for (const [p, emb] of cached) currentEmbeddings.set(p, l2Normalize(emb));
    } catch { /* ignore cache errors */ }

    const uncached = mediaItems.filter(i => !currentEmbeddings.has(i.path));
    if (uncached.length === 0) {
        hideEmbedProgressUI();
        // All embeddings loaded from cache — re-filter if clustering is active
        if (aiClusteringMode === 'similarity') applyFilters();
        return;
    }

    // Ensure model is loaded
    try {
        const status = await window.electronAPI.clipStatus();
        if (!status.value?.loaded) {
            const init = await window.electronAPI.clipInit(getClipGpuMode());
            if (!init.ok) { hideEmbedProgressUI(); return; }
        }
    } catch { hideEmbedProgressUI(); return; }

    showEmbedProgressUI(uncached.length);

    // Wire cancel button
    const cancelBtn = document.getElementById('ai-embed-cancel-btn');
    if (cancelBtn) {
        cancelBtn._onclickAi = () => cancelEmbeddingScan();
        cancelBtn.onclick = cancelBtn._onclickAi;
    }

    // 32 = 2 full batches of 16 in main, no trailing small batch
    const BATCH_SIZE = 32;
    let done = 0;
    for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
        if (signal.aborted) { hideEmbedProgressUI(); return; }

        const batch = uncached.slice(i, i + BATCH_SIZE);
        try {
            const resp = await window.electronAPI.clipEmbedImages(
                batch.map(item => ({ path: item.path, mtime: item.mtime || 0, thumbPath: null }))
            );
            const results = resp && resp.ok ? (resp.value || []) : [];
            const toCache = [];
            for (const r of results) {
                if (r && r.embedding) {
                    const emb = l2Normalize(new Float32Array(r.embedding));
                    currentEmbeddings.set(r.path, emb);
                    const item = mediaItems.find(m => m.path === r.path);
                    toCache.push({ path: r.path, mtime: item ? (item.mtime || 0) : 0, embedding: r.embedding });
                }
            }
            if (toCache.length > 0) cacheEmbeddings(toCache).catch(() => {});
            done += batch.length;
            updateTotalProgressUI(done, uncached.length);
        } catch { /* skip failed batch */ }

        // Yield between batches to keep UI responsive
        if (i + BATCH_SIZE < uncached.length) {
            await new Promise(r => requestIdleCallback ? requestIdleCallback(r, { timeout: 200 }) : setTimeout(r, 50));
        }
    }

    if (!signal.aborted) {
        hideEmbedProgressUI();
        // Re-filter now that embeddings are ready — needed for AI search and visual clustering
        if ((aiSearchActive && currentTextEmbedding && document.getElementById('search-box').value.trim()) ||
            aiClusteringMode === 'similarity') {
            applyFilters();
        }
    }
}

// ---------------------------------------------------------------------------
// Idle pre-embedding: silently embed uncached files when the user is inactive.
// ---------------------------------------------------------------------------
let _idleTimer = null;
let _idleEmbedAbort = null;
let IDLE_DELAY_MS = parseInt(localStorage.getItem('aiIdleDelay')) || 10000;
let IDLE_BATCH_SIZE = parseInt(localStorage.getItem('aiBatchSize')) || 8;

function _resetIdleTimer() {
    if (_idleTimer) clearTimeout(_idleTimer);
    // Cancel any in-flight idle embedding
    if (_idleEmbedAbort) { _idleEmbedAbort.abort(); _idleEmbedAbort = null; }
    _idleTimer = setTimeout(_startIdlePreEmbedding, IDLE_DELAY_MS);
}

function _cancelIdlePreEmbedding() {
    if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
    if (_idleEmbedAbort) { _idleEmbedAbort.abort(); _idleEmbedAbort = null; }
}

async function _startIdlePreEmbedding() {
    // Guard conditions
    if (!aiVisualSearchEnabled || !aiAutoScan) return;
    if (embeddingScanAbortController && !embeddingScanAbortController.signal.aborted) return;
    if (_bgScanRunning) return;

    let status;
    try { status = await window.electronAPI.clipStatus(); } catch { return; }
    if (!status || !status.value?.loaded) return;

    const mediaItems = (currentItems || []).filter(i => i.type !== 'folder');
    if (mediaItems.length === 0) return;

    // Find uncached items
    try {
        const cached = await getCachedEmbeddings(mediaItems.map(i => ({ path: i.path, mtime: i.mtime || 0 })));
        for (const [p, emb] of cached) currentEmbeddings.set(p, l2Normalize(emb));
    } catch { /* ignore */ }

    const uncached = mediaItems.filter(i => !currentEmbeddings.has(i.path));
    if (uncached.length === 0) return;

    _idleEmbedAbort = new AbortController();
    const signal = _idleEmbedAbort.signal;

    for (let i = 0; i < uncached.length; i += IDLE_BATCH_SIZE) {
        if (signal.aborted) return;

        const batch = uncached.slice(i, i + IDLE_BATCH_SIZE);
        try {
            const resp = await window.electronAPI.clipEmbedImages(
                batch.map(item => ({ path: item.path, mtime: item.mtime || 0, thumbPath: null }))
            );
            const results = resp && resp.ok ? (resp.value || []) : [];
            const toCache = [];
            for (const r of results) {
                if (r && r.embedding) {
                    const emb = l2Normalize(new Float32Array(r.embedding));
                    currentEmbeddings.set(r.path, emb);
                    const item = mediaItems.find(m => m.path === r.path);
                    toCache.push({ path: r.path, mtime: item ? (item.mtime || 0) : 0, embedding: r.embedding });
                }
            }
            if (toCache.length > 0) cacheEmbeddings(toCache).catch(() => {});
        } catch { /* skip */ }

        // Generous yield between batches
        if (i + IDLE_BATCH_SIZE < uncached.length && !signal.aborted) {
            await new Promise(r => requestIdleCallback ? requestIdleCallback(r, { timeout: 500 }) : setTimeout(r, 500));
        }
    }

    if (!signal.aborted && ((aiSearchActive && currentTextEmbedding) || aiClusteringMode === 'similarity')) {
        applyFilters();
    }
    _idleEmbedAbort = null;
}

// Start listening for user activity to drive idle detection
['mousemove', 'keydown', 'scroll', 'click', 'pointerdown'].forEach(evt => {
    window.addEventListener(evt, _resetIdleTimer, { passive: true });
});

// Zoom slider event listener (throttled layout, instant visual feedback)
let zoomLayoutTimer = null;
zoomSlider.addEventListener('input', (e) => {
    zoomLevel = parseInt(e.target.value, 10);
    zoomValue.textContent = `${zoomLevel}%`;
    // Clear cached tag overlap checks since card sizes changed
    gridContainer.querySelectorAll('.video-card[data-tag-overlap-checked]').forEach(c => delete c.dataset.tagOverlapChecked);
    // Instant CSS variable update for visual feedback
    document.documentElement.style.setProperty('--zoom-level', zoomLevel);
    // Re-apply hover scale if it's zoom-dependent
    if (hoverScaleState.withZoom) applyHoverScale();
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

// Tools menu toggle
toolsMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toolsMenuDropdown.classList.toggle('hidden');
});

// Add favorite button event listener
addFavoriteBtn.addEventListener('click', () => {
    if (currentFolderPath) {
        addFavorite(currentFolderPath, currentFolderPath.split(/[/\\]/).pop());
    }
});

// New favorite group button event listener
newFavGroupBtn.addEventListener('click', () => {
    promptFavGroupName((name) => createFavoriteGroup(name));
});

// Clear recent files button event listener
clearRecentBtn.addEventListener('click', () => {
    clearRecentFiles();
});

// Close tools menu when clicking outside
document.addEventListener('click', (e) => {
    const renameDialog = document.getElementById('rename-dialog');
    if (!toolsMenuBtn.contains(e.target) && !toolsMenuDropdown.contains(e.target)
        && !(favContextMenu && favContextMenu.contains(e.target))
        && !(renameDialog && renameDialog.contains(e.target))) {
        toolsMenuDropdown.classList.add('hidden');
    }
});

// ═══ → lightbox.js (zoom, rotation, crop, open/close, pan, wheel, copy buttons) ═══

// --- Blow-Up Preview (right-click hold) ---

function getBlowUpOverlay() {
    if (!blowUpOverlay) {
        blowUpOverlay = document.createElement('div');
        blowUpOverlay.id = 'blow-up-overlay';
        blowUpOverlay.classList.add('hidden');
        document.body.appendChild(blowUpOverlay);
        // Dismiss on any click inside the overlay
        blowUpOverlay.addEventListener('mouseup', () => { hideBlowUp(); });
    }
    return blowUpOverlay;
}

function showBlowUp(card) {
    if (!card || !card.isConnected) return;
    blowUpActive = true;
    blowUpTargetCard = card;

    const overlay = getBlowUpOverlay();
    overlay.innerHTML = '';

    const container = document.createElement('div');
    container.className = 'blow-up-container';

    // Determine display dimensions (fit within 80% of viewport, preserve aspect ratio)
    const natW = parseInt(card.dataset.width) || 1920;
    const natH = parseInt(card.dataset.height) || 1080;
    const maxW = window.innerWidth * 0.8;
    const maxH = window.innerHeight * 0.8;
    const scale = Math.min(maxW / natW, maxH / natH);
    const dispW = Math.round(natW * scale);
    const dispH = Math.round(natH * scale);

    let mediaEl;
    const isVideo = card.dataset.mediaType === 'video';
    const srcUrl = card.dataset.src;
    const srcLower = (srcUrl || '').toLowerCase();
    const isAnimated = srcLower.endsWith('.gif') || srcLower.endsWith('.webp');

    if (isVideo) {
        // Play video in blow-up mode
        mediaEl = document.createElement('video');
        mediaEl.src = srcUrl;
        mediaEl.autoplay = true;
        mediaEl.loop = true;
        mediaEl.muted = true;
        mediaEl.playsInline = true;
        // Resume from the card's current playback position
        const cardVideo = card.querySelector('video');
        if (cardVideo && cardVideo.readyState >= 2 && cardVideo.currentTime > 0) {
            mediaEl.currentTime = cardVideo.currentTime;
        }
    } else if (isAnimated) {
        // Animated GIF/WebP — use <img> which browsers animate natively
        mediaEl = document.createElement('img');
        mediaEl.src = srcUrl;
    } else {
        // Static image — use original file URL for full resolution
        mediaEl = document.createElement('img');
        mediaEl.src = srcUrl;
    }

    mediaEl.className = 'blow-up-media';
    mediaEl.style.width = dispW + 'px';
    mediaEl.style.height = dispH + 'px';
    mediaEl.draggable = false;

    // Filename label
    const label = document.createElement('div');
    label.className = 'blow-up-label';
    label.textContent = card.dataset.name || '';

    container.appendChild(mediaEl);
    container.appendChild(label);
    overlay.appendChild(container);
    overlay.classList.remove('hidden');
}

function hideBlowUp() {
    if (!blowUpActive && !blowUpHoldTimer) return;
    clearTimeout(blowUpHoldTimer);
    blowUpHoldTimer = null;
    blowUpActive = false;
    blowUpTargetCard = null;
    if (blowUpOverlay) {
        // Stop any playing video before hiding
        const vid = blowUpOverlay.querySelector('video');
        if (vid) { vid.pause(); vid.removeAttribute('src'); vid.load(); }
        blowUpOverlay.classList.add('hidden');
        // Clear contents after transition
        setTimeout(() => {
            if (blowUpOverlay && !blowUpActive) blowUpOverlay.innerHTML = '';
        }, 200);
    }
}

// Right-click hold detection: mousedown starts timer
let blowUpSuppressContextMenu = false;

document.addEventListener('mousedown', (e) => {
    if (e.button !== 2) return;
    const card =
        e.target.closest('.video-card') ||
        e.target.closest('.duplicate-item') ||
        e.target.closest('.lb-insp-similar-card');
    if (!card) return;

    // Suppress ALL context menus while we're detecting hold vs quick click
    blowUpSuppressContextMenu = true;
    clearTimeout(blowUpHoldTimer);
    blowUpHoldTimer = setTimeout(() => {
        blowUpHoldTimer = null;
        showBlowUp(card);
    }, BLOW_UP_HOLD_DELAY);
});

// Right-click release: dismiss blow-up or show context menu
document.addEventListener('mouseup', (e) => {
    if (e.button !== 2) return;

    if (blowUpActive) {
        hideBlowUp();
        // Keep blowUpSuppressContextMenu true — reset after contextmenu event
    } else if (blowUpHoldTimer) {
        // Released before threshold — this was a quick click, allow context menu
        clearTimeout(blowUpHoldTimer);
        blowUpHoldTimer = null;
        blowUpSuppressContextMenu = false;
    }
});

// Edge cases: Escape key, mouse leaving window, window blur
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && blowUpActive) hideBlowUp();
});
document.addEventListener('mouseleave', () => { hideBlowUp(); });
window.addEventListener('blur', () => { hideBlowUp(); });

// ═══ → context-menu.js (context menus, action dispatch, rename dialog) ═══
// ═══════════════════════════════════════════════════════════════════════════
// BATCH OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════
// ── Batch Rename ─────────────────────────────────────────────────────
const batchRenameOverlay = document.getElementById('batch-rename-overlay');
const batchRenameType = document.getElementById('batch-rename-type');
const batchRenameOptions = document.getElementById('batch-rename-options');
const batchRenamePreview = document.getElementById('batch-rename-preview');
const batchRenameError = document.getElementById('batch-rename-error');
const batchRenameApply = document.getElementById('batch-rename-apply');
let batchRenameFilePaths = [];

function openBatchRename(filePaths) {
    batchRenameFilePaths = filePaths;
    document.getElementById('batch-rename-count').textContent = `(${filePaths.length} files)`;
    batchRenameOverlay.classList.remove('hidden');
    batchRenameType.value = 'findReplace';
    renderBatchRenameOptions();
    updateBatchRenamePreview();
}

function closeBatchRename() {
    batchRenameOverlay.classList.add('hidden');
    batchRenameFilePaths = [];
    batchRenameError.classList.add('hidden');
}

function renderBatchRenameOptions() {
    const type = batchRenameType.value;
    let html = '';
    switch (type) {
        case 'findReplace':
            html = `
                <input type="text" id="br-find" placeholder="Find..." autofocus>
                <input type="text" id="br-replace" placeholder="Replace with...">
                <div class="batch-rename-row">
                    <label><input type="checkbox" id="br-case-sensitive"> Case sensitive</label>
                    <label><input type="checkbox" id="br-use-regex"> Regex</label>
                </div>`;
            break;
        case 'prefix':
            html = `<input type="text" id="br-prefix-text" placeholder="Prefix text..." autofocus>`;
            break;
        case 'suffix':
            html = `<input type="text" id="br-suffix-text" placeholder="Suffix text (before extension)..." autofocus>`;
            break;
        case 'numbering':
            html = `
                <input type="text" id="br-num-template" placeholder="Template, e.g. {name}_{n}" value="{name}_{n}">
                <div class="batch-rename-row">
                    <input type="number" id="br-num-start" placeholder="Start" value="1" min="0" style="width:80px">
                    <input type="number" id="br-num-step" placeholder="Step" value="1" min="1" style="width:80px">
                    <input type="number" id="br-num-padding" placeholder="Pad" value="2" min="1" max="10" style="width:80px">
                </div>`;
            break;
    }
    batchRenameOptions.innerHTML = html;

    // Attach input listeners for live preview
    batchRenameOptions.querySelectorAll('input').forEach(input => {
        input.addEventListener('input', updateBatchRenamePreview);
        input.addEventListener('change', updateBatchRenamePreview);
    });

    // Focus the first input
    const first = batchRenameOptions.querySelector('input[type="text"], input[type="number"]');
    if (first) requestAnimationFrame(() => first.focus());
}

function getBatchRenamePatternOptions() {
    const type = batchRenameType.value;
    switch (type) {
        case 'findReplace':
            return {
                find: (document.getElementById('br-find')?.value) || '',
                replace: (document.getElementById('br-replace')?.value) || '',
                caseSensitive: document.getElementById('br-case-sensitive')?.checked || false,
                useRegex: document.getElementById('br-use-regex')?.checked || false
            };
        case 'prefix':
            return { text: document.getElementById('br-prefix-text')?.value || '' };
        case 'suffix':
            return { text: document.getElementById('br-suffix-text')?.value || '' };
        case 'numbering':
            return {
                template: document.getElementById('br-num-template')?.value || '{name}_{n}',
                start: parseInt(document.getElementById('br-num-start')?.value) || 1,
                step: parseInt(document.getElementById('br-num-step')?.value) || 1,
                padding: parseInt(document.getElementById('br-num-padding')?.value) || 1
            };
        default:
            return {};
    }
}

function computeNewName(fileName, index, type, opts) {
    const ext = fileName.lastIndexOf('.') !== -1 ? fileName.slice(fileName.lastIndexOf('.')) : '';
    const baseName = ext ? fileName.slice(0, fileName.lastIndexOf('.')) : fileName;

    switch (type) {
        case 'prefix':
            return (opts.text || '') + fileName;
        case 'suffix':
            return baseName + (opts.text || '') + ext;
        case 'numbering': {
            const num = (opts.start || 1) + index * (opts.step || 1);
            const padded = String(num).padStart(opts.padding || 1, '0');
            const template = opts.template || '{name}_{n}';
            return template.replace('{name}', baseName).replace('{n}', padded) + ext;
        }
        case 'findReplace': {
            if (!opts.find) return fileName;
            const flags = opts.caseSensitive ? 'g' : 'gi';
            if (opts.useRegex) {
                try {
                    return fileName.replace(new RegExp(opts.find, flags), opts.replace || '');
                } catch { return fileName; }
            }
            const escaped = opts.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return fileName.replace(new RegExp(escaped, flags), opts.replace || '');
        }
        default:
            return fileName;
    }
}

function updateBatchRenamePreview() {
    const type = batchRenameType.value;
    const opts = getBatchRenamePatternOptions();

    const rows = [];
    const newNames = new Set();
    let hasConflict = false;
    let hasChange = false;

    for (let i = 0; i < batchRenameFilePaths.length; i++) {
        const fp = batchRenameFilePaths[i];
        const oldName = fp.split(/[\\/]/).pop();
        const newName = computeNewName(oldName, i, type, opts);
        const unchanged = oldName === newName;
        const duplicate = newNames.has(newName.toLowerCase());
        const empty = !newName || !newName.trim();
        const conflict = duplicate || empty;

        if (!unchanged) hasChange = true;
        if (conflict) hasConflict = true;
        newNames.add(newName.toLowerCase());

        rows.push({ oldName, newName, unchanged, conflict });
    }

    let html = '<table><thead><tr><th>Original</th><th>New Name</th></tr></thead><tbody>';
    for (const r of rows) {
        const cls = r.conflict ? ' class="conflict"' : r.unchanged ? ' class="unchanged"' : '';
        html += `<tr${cls}><td>${r.oldName}</td><td class="new-name">${r.newName || '<em>empty</em>'}</td></tr>`;
    }
    html += '</tbody></table>';
    batchRenamePreview.innerHTML = html;

    if (hasConflict) {
        batchRenameError.textContent = 'Some names conflict (duplicates or empty). Fix before applying.';
        batchRenameError.classList.remove('hidden');
    } else {
        batchRenameError.classList.add('hidden');
    }

    batchRenameApply.disabled = hasConflict || !hasChange;
}

batchRenameType.addEventListener('change', () => {
    renderBatchRenameOptions();
    updateBatchRenamePreview();
});

document.getElementById('batch-rename-close').addEventListener('click', closeBatchRename);
document.getElementById('batch-rename-cancel').addEventListener('click', closeBatchRename);
batchRenameOverlay.addEventListener('click', (e) => { if (e.target === batchRenameOverlay) closeBatchRename(); });
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !batchRenameOverlay.classList.contains('hidden')) {
        closeBatchRename();
    }
});

batchRenameApply.addEventListener('click', async () => {
    const type = batchRenameType.value;
    const opts = getBatchRenamePatternOptions();
    const fileCount = batchRenameFilePaths.length;

    const confirmed = await showConfirm(
        'Batch Rename',
        `Rename ${fileCount} file${fileCount === 1 ? '' : 's'}? This can be undone with Ctrl+Z.`,
        { confirmLabel: 'Rename' }
    );
    if (!confirmed) return;

    batchRenameApply.disabled = true;
    batchRenameApply.textContent = 'Renaming...';

    try {
        setStatusActivity('Batch renaming...');
        const result = await window.electronAPI.batchRename(batchRenameFilePaths, type, opts);
        setStatusActivity('');

        if (result.ok) {
            closeBatchRename();
            const v = result.value || {};
            const failedResults = (v.results || []).filter(r => r.ok === false);
            if (failedResults.length > 0) {
                const errorSummary = groupBatchErrors(failedResults);
                showToast(
                    `Renamed ${v.successCount} of ${v.totalCount} files`,
                    'warning',
                    { details: `${failedResults.length} failed: ${errorSummary}`, duration: 8000 }
                );
            } else {
                showToast(`Renamed ${v.successCount} of ${v.totalCount} files`, 'success');
            }
            if (currentFolderPath) {
                invalidateFolderCache(currentFolderPath);
                const previousScrollTop = gridContainer.scrollTop;
                await loadVideos(currentFolderPath, false, previousScrollTop);
            }
        } else {
            showToast(`Batch rename failed: ${friendlyError(result.error)}`, 'error');
        }
    } catch (error) {
        showToast(`Batch rename failed: ${friendlyError(error)}`, 'error');
    } finally {
        batchRenameApply.disabled = false;
        batchRenameApply.textContent = 'Rename';
        setStatusActivity('');
    }
});

// ── Auto-Tag with AI (CLIP) ──────────────────────────────────────────
const autoTagOverlay = document.getElementById('auto-tag-overlay');
const autoTagResults = document.getElementById('auto-tag-results');
const autoTagStatus = document.getElementById('auto-tag-status');
const autoTagThreshold = document.getElementById('auto-tag-threshold');
const autoTagThresholdValue = document.getElementById('auto-tag-threshold-value');
const autoTagApply = document.getElementById('auto-tag-apply');
const autoTagViewFileEl = document.getElementById('auto-tag-view-file');
const autoTagViewTagEl = document.getElementById('auto-tag-view-tag');
const autoTagProgressEl = document.getElementById('auto-tag-progress');
const autoTagProgressFill = document.getElementById('auto-tag-progress-fill');
const autoTagProgressText = document.getElementById('auto-tag-progress-text');
const autoTagSelectionCountEl = document.getElementById('auto-tag-selection-count');
const autoTagSmartSelectEl = document.getElementById('auto-tag-smart-select');

const autoTagState = {
    filePaths: [],
    data: [], // [{ path, name, thumbType, thumbSrc, suggestions: [{ label, score }] }]
    labelEmbeddings: null, // Map<label, Float32Array>
    selection: new Map(), // Map<path, Set<label>>
    view: 'file', // 'file' | 'tag'
    byTag: new Map(), // Map<label, Array<{path, score}>> — derived from data + threshold
    collapsedTags: new Set(),
    cancelScan: false,
    io: null, // IntersectionObserver for File view cards
    tileIO: null, // IntersectionObserver for Tag view tiles
};

function closeAutoTag() {
    autoTagOverlay.classList.add('hidden');
    autoTagState.filePaths = [];
    autoTagState.data = [];
    autoTagState.selection.clear();
    autoTagState.byTag.clear();
    autoTagState.collapsedTags.clear();
    autoTagState.cancelScan = false;
    if (autoTagState.io) { try { autoTagState.io.disconnect(); } catch {} autoTagState.io = null; }
    if (autoTagState.tileIO) { try { autoTagState.tileIO.disconnect(); } catch {} autoTagState.tileIO = null; }
    autoTagShowProgress(false);
    autoTagViewFileEl.innerHTML = '';
    autoTagViewTagEl.innerHTML = '';
    autoTagStatus.textContent = '';
    autoTagUpdateCounter();
}

async function embedTagLabels() {
    // Always re-embed since tags may have changed since last call
    await refreshTagsCache();

    if (allTagsCache.length === 0) return false;

    autoTagState.labelEmbeddings = new Map();
    for (let i = 0; i < allTagsCache.length; i++) {
        const tag = allTagsCache[i];
        autoTagStatus.textContent = `Embedding tags... ${i + 1}/${allTagsCache.length}`;
        try {
            const raw = await window.electronAPI.clipEmbedText(`a photo of ${tag.name}`);
            if (raw && raw.ok && raw.value) autoTagState.labelEmbeddings.set(tag.name, new Float32Array(raw.value));
        } catch {}
    }
    return autoTagState.labelEmbeddings.size > 0;
}

async function openAutoTag(filePaths) {
    autoTagState.filePaths = filePaths;
    autoTagOverlay.classList.remove('hidden');
    autoTagState.data = [];
    autoTagState.selection.clear();
    autoTagState.byTag.clear();
    autoTagState.collapsedTags.clear();
    autoTagState.cancelScan = false;
    autoTagViewFileEl.innerHTML = '';
    autoTagViewTagEl.innerHTML = '';
    autoTagApply.disabled = true;
    autoTagUpdateCounter();

    // Restore last-used view preference
    try {
        const saved = localStorage.getItem('autoTagLastView');
        autoTagState.view = (saved === 'tag' || saved === 'file') ? saved : 'file';
    } catch { autoTagState.view = 'file'; }
    autoTagApplyViewToggle();

    autoTagStatus.textContent = 'Checking AI model...';

    // Check if user has any tags
    await refreshTagsCache();
    if (allTagsCache.length === 0) {
        autoTagStatus.textContent = 'No tags found. Create some tags first — auto-tag will match your files against them.';
        return;
    }

    // Ensure CLIP is loaded
    try {
        const status = await window.electronAPI.clipStatus();
        if (!status.value?.loaded) {
            autoTagStatus.textContent = 'Loading AI model...';
            const init = await window.electronAPI.clipInit(getClipGpuMode());
            if (!init.ok) {
                autoTagStatus.textContent = 'Could not load AI model. Enable AI search in settings first.';
                return;
            }
        }
    } catch {
        autoTagStatus.textContent = 'AI model not available.';
        return;
    }

    // Embed user's tags as CLIP labels
    autoTagStatus.textContent = `Embedding ${allTagsCache.length} tag${allTagsCache.length === 1 ? '' : 's'}...`;
    const labelsReady = await embedTagLabels();
    if (!labelsReady) {
        autoTagStatus.textContent = 'Failed to generate tag embeddings.';
        return;
    }

    // Get/generate image embeddings (show progress bar for hundreds of files)
    autoTagStatus.textContent = '';
    autoTagShowProgress(true);
    autoTagUpdateProgress(0, filePaths.length);
    const BATCH = 8;

    for (let i = 0; i < filePaths.length; i += BATCH) {
        if (autoTagState.cancelScan) break;
        const batch = filePaths.slice(i, i + BATCH);
        const items = batch.map(fp => {
            const item = vsState.sortedItems.find(it => it.path === fp);
            return { path: fp, mtime: item ? (item.mtime || 0) : 0, thumbPath: null };
        });

        // Check current in-memory embeddings first
        const needsEmbed = [];
        const embeddings = new Map();
        for (const it of items) {
            const cached = currentEmbeddings.get(it.path);
            if (cached) {
                embeddings.set(it.path, cached);
            } else {
                needsEmbed.push(it);
            }
        }

        // Generate missing embeddings
        if (needsEmbed.length > 0) {
            try {
                const resp = await window.electronAPI.clipEmbedImages(needsEmbed);
                const results = resp && resp.ok ? (resp.value || []) : [];
                for (const r of results) {
                    if (r && r.embedding) {
                        const emb = new Float32Array(r.embedding);
                        embeddings.set(r.path, emb);
                        currentEmbeddings.set(r.path, emb);
                    }
                }
            } catch {}
        }

        // Score each file against all labels (no sync poster fetch — done lazily on render)
        for (const fp of batch) {
            const emb = embeddings.get(fp);
            if (!emb) continue;
            const suggestions = [];
            for (const [label, labelEmb] of autoTagState.labelEmbeddings) {
                const score = cosineSimilarity(emb, labelEmb);
                suggestions.push({ label, score });
            }
            suggestions.sort((a, b) => b.score - a.score);

            const name = fp.split(/[\\/]/).pop();
            const item = vsState.sortedItems.find(it => it.path === fp);
            const isVideo = item && item.type === 'video';
            autoTagState.data.push({
                path: fp,
                name,
                thumbType: isVideo ? 'video' : 'image',
                thumbSrc: isVideo ? null : (item ? (item.url || '') : ''),
                suggestions,
            });
        }

        autoTagUpdateProgress(Math.min(i + BATCH, filePaths.length), filePaths.length);
        // Incremental render after each batch so users see results as they stream in
        renderAutoTagResults();
    }

    autoTagShowProgress(false);
    const cancelled = autoTagState.cancelScan;
    const analyzed = autoTagState.data.length;
    autoTagStatus.textContent = cancelled
        ? `Cancelled. ${analyzed} file${analyzed === 1 ? '' : 's'} analyzed.`
        : `Done. ${analyzed} file${analyzed === 1 ? '' : 's'} analyzed.`;
    renderAutoTagResults();
}

// Map raw CLIP cosine similarity (typically 0.15–0.40) to a 0–100% display scale
function clipScoreToDisplayPct(score) {
    return Math.round(Math.min(100, Math.max(0, (score - 0.15) / 0.25 * 100)));
}

function autoTagGetThreshold() {
    return (parseInt(autoTagThreshold.value) || 25) / 100;
}

function autoTagRebuildByTag() {
    const threshold = autoTagGetThreshold();
    autoTagState.byTag.clear();
    for (const file of autoTagState.data) {
        for (const s of file.suggestions) {
            if (s.score < threshold) continue;
            if (!autoTagState.byTag.has(s.label)) autoTagState.byTag.set(s.label, []);
            autoTagState.byTag.get(s.label).push({ path: file.path, score: s.score });
        }
    }
    for (const arr of autoTagState.byTag.values()) arr.sort((a, b) => b.score - a.score);
}

function autoTagIsSelected(path, label) {
    const set = autoTagState.selection.get(path);
    return !!(set && set.has(label));
}

function autoTagToggleSelection(path, label) {
    let set = autoTagState.selection.get(path);
    if (!set) { set = new Set(); autoTagState.selection.set(path, set); }
    if (set.has(label)) {
        set.delete(label);
        if (set.size === 0) autoTagState.selection.delete(path);
    } else {
        set.add(label);
    }
}

function autoTagSetSelection(path, label, enabled) {
    let set = autoTagState.selection.get(path);
    if (enabled) {
        if (!set) { set = new Set(); autoTagState.selection.set(path, set); }
        set.add(label);
    } else if (set) {
        set.delete(label);
        if (set.size === 0) autoTagState.selection.delete(path);
    }
}

function autoTagClearSelection() {
    autoTagState.selection.clear();
}

function autoTagSelectAllAboveThreshold() {
    const threshold = autoTagGetThreshold();
    for (const file of autoTagState.data) {
        for (const s of file.suggestions) {
            if (s.score >= threshold) autoTagSetSelection(file.path, s.label, true);
        }
    }
}

function autoTagSelectForTag(label, enable) {
    const matches = autoTagState.byTag.get(label);
    if (!matches) return;
    for (const m of matches) autoTagSetSelection(m.path, label, enable);
}

function autoTagSmartSelect(mode) {
    autoTagClearSelection();
    if (mode === 'top1') {
        const threshold = autoTagGetThreshold();
        for (const file of autoTagState.data) {
            const top = file.suggestions[0];
            if (top && top.score >= threshold) autoTagSetSelection(file.path, top.label, true);
        }
        return;
    }
    const pct = parseInt(mode, 10);
    if (!Number.isFinite(pct)) return;
    // Reverse clipScoreToDisplayPct: score = pct/100 * 0.25 + 0.15
    const scoreThreshold = (pct / 100) * 0.25 + 0.15;
    const uiThreshold = autoTagGetThreshold();
    const effective = Math.max(uiThreshold, scoreThreshold);
    for (const file of autoTagState.data) {
        for (const s of file.suggestions) {
            if (s.score >= effective) autoTagSetSelection(file.path, s.label, true);
        }
    }
}

function autoTagGetCounts() {
    let tagCount = 0;
    for (const set of autoTagState.selection.values()) tagCount += set.size;
    return { tagCount, fileCount: autoTagState.selection.size };
}

function autoTagUpdateCounter() {
    const { tagCount, fileCount } = autoTagGetCounts();
    if (tagCount === 0) {
        autoTagSelectionCountEl.textContent = '';
    } else {
        autoTagSelectionCountEl.textContent = `${tagCount} tag${tagCount === 1 ? '' : 's'} across ${fileCount} file${fileCount === 1 ? '' : 's'}`;
    }
    autoTagApply.disabled = tagCount === 0;
}

function updateAutoTagApplyBtn() { autoTagUpdateCounter(); }

function autoTagShowProgress(show) {
    autoTagProgressEl.classList.toggle('hidden', !show);
}

function autoTagUpdateProgress(done, total) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    autoTagProgressFill.style.width = `${pct}%`;
    autoTagProgressText.textContent = `${done} / ${total}`;
}

function cancelAutoTagScan() {
    autoTagState.cancelScan = true;
}

function autoTagApplyViewToggle() {
    const buttons = autoTagOverlay.querySelectorAll('.auto-tag-view-toggle button');
    buttons.forEach(b => {
        const active = b.dataset.view === autoTagState.view;
        b.classList.toggle('active', active);
        b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    autoTagViewFileEl.classList.toggle('hidden', autoTagState.view !== 'file');
    autoTagViewTagEl.classList.toggle('hidden', autoTagState.view !== 'tag');
}

function autoTagSetView(view) {
    if (view !== 'file' && view !== 'tag') return;
    if (view === autoTagState.view) return;
    autoTagState.view = view;
    try { localStorage.setItem('autoTagLastView', view); } catch {}
    autoTagApplyViewToggle();
    renderAutoTagResults();
}

function autoTagSetupObservers() {
    if (autoTagState.io) { try { autoTagState.io.disconnect(); } catch {} }
    if (autoTagState.tileIO) { try { autoTagState.tileIO.disconnect(); } catch {} }
    autoTagState.io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                autoTagLoadCardThumb(entry.target);
                autoTagState.io.unobserve(entry.target);
            }
        }
    }, { root: autoTagResults, rootMargin: '300px 0px' });
    autoTagState.tileIO = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                autoTagLoadTileThumb(entry.target);
                autoTagState.tileIO.unobserve(entry.target);
            }
        }
    }, { root: autoTagResults, rootMargin: '200px 0px 200px 200px' });
}

function autoTagSetThumbImage(thumbEl, url) {
    thumbEl.style.backgroundImage = `url(${JSON.stringify(url)})`;
    thumbEl.classList.add('has-image');
    thumbEl.classList.remove('is-video');
}

function autoTagLoadCardThumb(cardEl) {
    const idx = parseInt(cardEl.dataset.idx, 10);
    const data = autoTagState.data[idx];
    if (!data) return;
    const thumbEl = cardEl.querySelector('.auto-tag-card-thumb');
    if (!thumbEl) return;
    if (data.thumbType === 'video') {
        thumbEl.classList.add('is-video');
        requestVideoPosterUrl(data.path).then((url) => {
            if (url) autoTagSetThumbImage(thumbEl, url);
        }).catch(() => {});
    } else if (data.thumbSrc) {
        autoTagSetThumbImage(thumbEl, data.thumbSrc);
    }
}

function autoTagLoadTileThumb(tileEl) {
    const path = tileEl.dataset.path;
    const data = autoTagState.data.find(d => d.path === path);
    if (!data) return;
    const thumbEl = tileEl.querySelector('.auto-tag-tag-tile-thumb');
    if (!thumbEl) return;
    if (data.thumbType === 'video') {
        thumbEl.classList.add('is-video');
        requestVideoPosterUrl(data.path).then((url) => {
            if (url) autoTagSetThumbImage(thumbEl, url);
        }).catch(() => {});
    } else if (data.thumbSrc) {
        autoTagSetThumbImage(thumbEl, data.thumbSrc);
    }
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function renderAutoTagFileView() {
    autoTagViewFileEl.innerHTML = '';
    const threshold = autoTagGetThreshold();

    if (autoTagState.data.length === 0) {
        autoTagViewFileEl.innerHTML = '<div class="auto-tag-empty">No files analyzed yet.</div>';
        return;
    }

    const frag = document.createDocumentFragment();
    for (let idx = 0; idx < autoTagState.data.length; idx++) {
        const file = autoTagState.data[idx];
        const matching = file.suggestions.filter(s => s.score >= threshold);
        const selectedSet = autoTagState.selection.get(file.path);
        const hasSelection = !!(selectedSet && selectedSet.size > 0);

        const card = document.createElement('div');
        card.className = 'auto-tag-card' + (hasSelection ? ' has-selection' : '');
        card.dataset.idx = String(idx);
        card.dataset.path = file.path;

        const thumb = document.createElement('div');
        thumb.className = 'auto-tag-card-thumb' + (file.thumbType === 'video' ? ' is-video' : '');
        card.appendChild(thumb);

        const nameEl = document.createElement('div');
        nameEl.className = 'auto-tag-card-name';
        nameEl.title = file.name;
        nameEl.textContent = file.name;
        card.appendChild(nameEl);

        const chips = document.createElement('div');
        chips.className = 'auto-tag-card-chips';
        if (matching.length === 0) {
            const none = document.createElement('span');
            none.className = 'auto-tag-card-none';
            none.textContent = 'no matches';
            chips.appendChild(none);
        } else {
            for (const s of matching) {
                const chip = document.createElement('span');
                const isSel = autoTagIsSelected(file.path, s.label);
                chip.className = 'auto-tag-chip' + (isSel ? ' selected' : '');
                chip.dataset.path = file.path;
                chip.dataset.label = s.label;
                chip.dataset.role = 'chip';
                chip.innerHTML = `${escapeHtml(s.label)} <span class="auto-tag-conf">${clipScoreToDisplayPct(s.score)}%</span>`;
                chips.appendChild(chip);
            }
        }
        card.appendChild(chips);
        frag.appendChild(card);
    }
    autoTagViewFileEl.appendChild(frag);

    // Observe cards for lazy thumbnail loading
    if (autoTagState.io) {
        autoTagViewFileEl.querySelectorAll('.auto-tag-card').forEach(el => autoTagState.io.observe(el));
    }
}

function renderAutoTagTagView() {
    autoTagViewTagEl.innerHTML = '';

    if (autoTagState.data.length === 0) {
        autoTagViewTagEl.innerHTML = '<div class="auto-tag-empty">No files analyzed yet.</div>';
        return;
    }
    if (autoTagState.byTag.size === 0) {
        autoTagViewTagEl.innerHTML = '<div class="auto-tag-empty">No tags above threshold. Try lowering the confidence slider.</div>';
        return;
    }

    // Sort tags by match count descending
    const entries = Array.from(autoTagState.byTag.entries()).sort((a, b) => b[1].length - a[1].length);
    const frag = document.createDocumentFragment();

    const chevronSvg = '<svg class="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

    for (const [label, matches] of entries) {
        const collapsed = autoTagState.collapsedTags.has(label);
        const selectedCount = matches.reduce((n, m) => n + (autoTagIsSelected(m.path, label) ? 1 : 0), 0);

        const row = document.createElement('div');
        row.className = 'auto-tag-tag-row' + (collapsed ? ' collapsed' : '');
        row.dataset.label = label;

        const header = document.createElement('div');
        header.className = 'auto-tag-tag-row-header';
        const title = document.createElement('div');
        title.className = 'auto-tag-tag-row-title';
        title.dataset.role = 'tag-toggle';
        title.dataset.label = label;
        title.innerHTML = `${chevronSvg}<span class="auto-tag-tag-row-name" title="${escapeHtml(label)}">${escapeHtml(label)}</span><span class="auto-tag-tag-row-count">${selectedCount}/${matches.length} selected</span>`;
        header.appendChild(title);

        const actions = document.createElement('div');
        actions.className = 'auto-tag-tag-row-actions';
        actions.innerHTML = `<button type="button" data-role="tag-all" data-label="${escapeHtml(label)}">All</button><button type="button" data-role="tag-none" data-label="${escapeHtml(label)}">None</button>`;
        header.appendChild(actions);
        row.appendChild(header);

        const strip = document.createElement('div');
        strip.className = 'auto-tag-tag-row-strip';
        for (const m of matches) {
            const data = autoTagState.data.find(d => d.path === m.path);
            if (!data) continue;
            const tile = document.createElement('div');
            const isSel = autoTagIsSelected(m.path, label);
            tile.className = 'auto-tag-tag-tile' + (isSel ? ' selected' : '');
            tile.dataset.path = m.path;
            tile.dataset.label = label;
            tile.dataset.role = 'tile';
            tile.title = data.name;

            const tileThumb = document.createElement('div');
            tileThumb.className = 'auto-tag-tag-tile-thumb' + (data.thumbType === 'video' ? ' is-video' : '');
            tile.appendChild(tileThumb);

            const check = document.createElement('div');
            check.className = 'auto-tag-tag-tile-check';
            check.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
            tile.appendChild(check);

            const scoreEl = document.createElement('div');
            scoreEl.className = 'auto-tag-tag-tile-score';
            scoreEl.textContent = `${clipScoreToDisplayPct(m.score)}%`;
            tile.appendChild(scoreEl);

            const nameEl = document.createElement('div');
            nameEl.className = 'auto-tag-tag-tile-name';
            nameEl.textContent = data.name;
            tile.appendChild(nameEl);

            strip.appendChild(tile);
        }
        row.appendChild(strip);
        frag.appendChild(row);
    }

    // Note about tags with no matches
    const tagsWithNoMatches = allTagsCache.length - autoTagState.byTag.size;
    if (tagsWithNoMatches > 0) {
        const note = document.createElement('div');
        note.className = 'auto-tag-no-tags-note';
        note.textContent = `${tagsWithNoMatches} tag${tagsWithNoMatches === 1 ? '' : 's'} had no matches above threshold.`;
        frag.appendChild(note);
    }

    autoTagViewTagEl.appendChild(frag);

    if (autoTagState.tileIO) {
        autoTagViewTagEl.querySelectorAll('.auto-tag-tag-tile').forEach(el => autoTagState.tileIO.observe(el));
    }
}

function renderAutoTagResults() {
    autoTagRebuildByTag();
    if (!autoTagState.io || !autoTagState.tileIO) autoTagSetupObservers();
    if (autoTagState.view === 'file') {
        renderAutoTagFileView();
    } else {
        renderAutoTagTagView();
    }
    autoTagUpdateCounter();
}

// ── Wiring ──

autoTagThreshold.addEventListener('input', () => {
    autoTagThresholdValue.textContent = `${clipScoreToDisplayPct(parseInt(autoTagThreshold.value) / 100)}%`;
    renderAutoTagResults();
});

document.getElementById('auto-tag-close').addEventListener('click', closeAutoTag);
document.getElementById('auto-tag-cancel').addEventListener('click', closeAutoTag);
autoTagOverlay.addEventListener('click', (e) => { if (e.target === autoTagOverlay) closeAutoTag(); });
document.getElementById('auto-tag-cancel-scan').addEventListener('click', cancelAutoTagScan);

autoTagOverlay.querySelectorAll('.auto-tag-view-toggle button').forEach(btn => {
    btn.addEventListener('click', () => autoTagSetView(btn.dataset.view));
});

document.getElementById('auto-tag-select-all').addEventListener('click', () => {
    autoTagSelectAllAboveThreshold();
    renderAutoTagResults();
});

document.getElementById('auto-tag-deselect-all').addEventListener('click', () => {
    autoTagClearSelection();
    renderAutoTagResults();
});

autoTagSmartSelectEl.addEventListener('change', () => {
    const mode = autoTagSmartSelectEl.value;
    autoTagSmartSelectEl.value = '';
    if (!mode) return;
    autoTagSmartSelect(mode);
    renderAutoTagResults();
});

// Delegated click handler for chips, tiles, tag-row toggles, and tag-row bulk buttons
autoTagResults.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;

    const chip = target.closest('[data-role="chip"]');
    if (chip) {
        const path = chip.dataset.path;
        const label = chip.dataset.label;
        if (path && label) {
            autoTagToggleSelection(path, label);
            chip.classList.toggle('selected');
            const card = chip.closest('.auto-tag-card');
            if (card) {
                const set = autoTagState.selection.get(path);
                card.classList.toggle('has-selection', !!(set && set.size > 0));
            }
            autoTagUpdateCounter();
        }
        return;
    }

    const tile = target.closest('[data-role="tile"]');
    if (tile) {
        const path = tile.dataset.path;
        const label = tile.dataset.label;
        if (path && label) {
            autoTagToggleSelection(path, label);
            tile.classList.toggle('selected');
            // Update the header count for this row
            const row = tile.closest('.auto-tag-tag-row');
            if (row) {
                const matches = autoTagState.byTag.get(label) || [];
                const selectedCount = matches.reduce((n, m) => n + (autoTagIsSelected(m.path, label) ? 1 : 0), 0);
                const countEl = row.querySelector('.auto-tag-tag-row-count');
                if (countEl) countEl.textContent = `${selectedCount}/${matches.length} selected`;
            }
            autoTagUpdateCounter();
        }
        return;
    }

    const tagToggle = target.closest('[data-role="tag-toggle"]');
    if (tagToggle) {
        const label = tagToggle.dataset.label;
        if (label) {
            if (autoTagState.collapsedTags.has(label)) autoTagState.collapsedTags.delete(label);
            else autoTagState.collapsedTags.add(label);
            const row = tagToggle.closest('.auto-tag-tag-row');
            if (row) row.classList.toggle('collapsed');
        }
        return;
    }

    const tagAll = target.closest('[data-role="tag-all"]');
    if (tagAll) {
        const label = tagAll.dataset.label;
        if (label) { autoTagSelectForTag(label, true); renderAutoTagResults(); }
        return;
    }
    const tagNone = target.closest('[data-role="tag-none"]');
    if (tagNone) {
        const label = tagNone.dataset.label;
        if (label) { autoTagSelectForTag(label, false); renderAutoTagResults(); }
        return;
    }
});

autoTagApply.addEventListener('click', async () => {
    const { tagCount } = autoTagGetCounts();
    if (tagCount === 0) return;

    autoTagApply.disabled = true;
    autoTagApply.textContent = 'Applying...';

    try {
        await refreshTagsCache();

        // Group by label -> collect file paths (from selection Map)
        const labelToFiles = new Map();
        for (const [path, set] of autoTagState.selection) {
            for (const label of set) {
                if (!labelToFiles.has(label)) labelToFiles.set(label, []);
                labelToFiles.get(label).push(path);
            }
        }

        for (const [label, filePaths] of labelToFiles) {
            // Find the existing tag by name
            const tag = allTagsCache.find(t => t.name.toLowerCase() === label.toLowerCase());
            if (!tag) continue; // Should not happen since labels come from allTagsCache

            // Bulk assign
            const normalizedPaths = filePaths.map(fp => normalizePath(fp));
            if (normalizedPaths.length > 1) {
                await tagBulkAdd(normalizedPaths, tag.id, tag.name);
            } else {
                await tagAddToFile(normalizedPaths[0], tag.id, tag.name);
            }
        }

        await refreshTagsCache();
        refreshVisibleCardTags();
        const fileCount = autoTagState.selection.size;
        closeAutoTag();
        showToast(`Applied ${tagCount} tag${tagCount === 1 ? '' : 's'} across ${fileCount} file${fileCount === 1 ? '' : 's'}`, 'success');
    } catch (error) {
        showToast(`Auto-tag failed: ${friendlyError(error)}`, 'error');
    } finally {
        autoTagApply.disabled = false;
        autoTagApply.textContent = 'Apply Tags';
    }
});

// ── Streaming folder scan ────────────────────────────────────────────
// Subscribes to IPC chunks from main, dispatches to callbacks.
// Only one stream can be active at a time; calling this cancels the previous.

let _activeScanId = null;
let _streamChunkHandler = null;

function cancelActiveStream() {
    _activeScanId = null;
    if (_streamChunkHandler) {
        try { window.electronAPI.removeScanFolderChunkListener(); } catch {}
        _streamChunkHandler = null;
    }
}

/**
 * Start a streaming folder scan.
 * callbacks: { onItems(folders, items), onDimensions(dims), onComplete(ok) }
 */
function scanFolderStreaming(folderPath, options, callbacks) {
    // Cancel any previous stream
    cancelActiveStream();

    const handler = (_event, chunk) => {
        // Drop chunks from stale streams (user switched folders)
        if (chunk.scanId && _activeScanId && chunk.scanId !== _activeScanId) return;

        if (chunk.phase === 'items') {
            if (callbacks.onItems) callbacks.onItems(chunk.folders || [], chunk.items || []);
        } else if (chunk.phase === 'dimensions') {
            if (callbacks.onDimensions) callbacks.onDimensions(chunk.dims || []);
        } else if (chunk.phase === 'complete') {
            if (callbacks.onComplete) callbacks.onComplete(!chunk.error, chunk.error);
            if (_activeScanId === chunk.scanId) cancelActiveStream();
        }
    };

    _streamChunkHandler = handler;
    window.electronAPI.onScanFolderChunk(handler);

    // Fire the IPC; the returned scanId binds subsequent chunks.
    window.electronAPI.scanFolderStream(folderPath, options).then(result => {
        if (result && result.ok && result.value && result.value.scanId) _activeScanId = result.value.scanId;
    }).catch(err => {
        console.error('scanFolderStream error:', err);
        cancelActiveStream();
        if (callbacks.onComplete) callbacks.onComplete(false, err.message);
    });
}

// Debounce layout recalcs triggered by dimension updates during streaming.
let _streamingLayoutTimer = null;
function scheduleStreamingLayoutRefresh() {
    if (_streamingLayoutTimer) return;
    _streamingLayoutTimer = setTimeout(() => {
        _streamingLayoutTimer = null;
        if (vsState.enabled) {
            vsState.layoutCache.itemCount = 0;
            vsRecalculate();
        }
    }, 120);
}

async function loadVideos(folderPath, useCache = true, preservedScrollTop = null) {
    clearFindSimilarState();
    // Clear card selection on folder navigation
    clearCardSelection();
    // Stop periodic cleanup during folder switch
    stopPeriodicCleanup();
    activeDimensionHydrationToken++;
    // Cancel any in-flight streaming scan from a previous folder
    if (typeof cancelActiveStream === 'function') cancelActiveStream();
    // Free bitmap cache from the previous folder — releases GPU memory
    if (typeof clearBitmapCache === 'function') clearBitmapCache();
    // Clear duplicate highlights from previous folder
    if (typeof clearDuplicateHighlights === 'function') clearDuplicateHighlights();
    
    // Show loading indicator if we need to scan
    let needsScan = false;
    if (useCache) {
        const normalizedPath = normalizePath(folderPath);
        const now = Date.now();
        
        // Quick check if we have cached data
        let hasCache = false;
        if (activeTabId != null) {
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
        showLoadingIndicator('Scanning folder...');
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

            // Only block on dimensions when the active filters depend on them.
            // Masonry can start with fallback ratios and refine in the background.
            const needsDimensions = hasDimensionDependentFilters();
            const needsMetadataStats = cardInfoSettings.fileSize || cardInfoSettings.date;
            const needsStats = sortType !== 'name' || needsMetadataStats;
            const cacheIsValid = (cachedItems) => {
                if (!cachedItems || cachedItems.length === 0) return true;
                // When sorting by date, items need mtime data
                if (needsStats) {
                    const fileSample = cachedItems.find(item => item.type !== 'folder');
                    if (fileSample && !fileSample.mtime) return false;
                }
                // File-size chip needs size data in cache as well.
                if (needsMetadataStats && cardInfoSettings.fileSize) {
                    const fileSample = cachedItems.find(item => item.type !== 'folder');
                    if (fileSample && (fileSample.size == null || fileSample.size <= 0)) return false;
                }
                // Check both an image and a video sample — both must have dimensions
                if (needsDimensions) {
                    const imageSample = cachedItems.find(item => item.type === 'image');
                    const videoSample = cachedItems.find(item => item.type === 'video');
                    if (imageSample && (imageSample.width === undefined || imageSample.height === undefined)) return false;
                    if (videoSample && (videoSample.width === undefined || videoSample.height === undefined)) return false;
                }
                return true;
            };

            // Check tab cache first (fastest)
            if (activeTabId != null) {
                const tabCache = tabContentCache.get(activeTabId);
                if (tabCache) {
                    const cachePathNormalized = normalizePath(tabCache.path);
                    if ((cachePathNormalized === normalizedPath || tabCache.path === folderPath) &&
                        (now - tabCache.timestamp) < FOLDER_CACHE_TTL &&
                        cacheIsValid(tabCache.items)) {
                        items = tabCache.items;
                    }
                }
            }

            // Check global folder cache (try both normalized and original path)
            if (!items) {
                const globalCache = folderCache.get(normalizedPath) || folderCache.get(folderPath);
                if (globalCache && (now - globalCache.timestamp) < GLOBAL_CACHE_TTL &&
                    cacheIsValid(globalCache.items)) {
                    items = globalCache.items;
                }
            }

            // Check IndexedDB persistent cache (slower but persistent)
            if (!items) {
                // Yield control periodically during IndexedDB lookup
                await yieldToEventLoop();
                const dbItems = await getFolderFromIndexedDB(folderPath);
                if (dbItems && cacheIsValid(dbItems)) {
                    items = dbItems;
                }
            }
        }
        
        // If not cached, scan folder via STREAMING path:
        // items arrive immediately, dimensions trickle in as background chunks.
        if (!items) {
            // Yield control before starting scan to keep UI responsive
            await yieldToEventLoop();

            // Keep stats when needed for sorting or enabled card metadata chips.
            const skipStats = sortType === 'name' && !cardInfoSettings.fileSize && !cardInfoSettings.date;
            // Request dimensions when the layout or filters depend on them.
            const scanImageDimensions = hasDimensionDependentFilters() || layoutMode === 'masonry';
            const scanVideoDimensions = hasDimensionDependentFilters() || layoutMode === 'masonry';
            const scanPerfStart = perfTest.start();

            // Use streaming scan if available (falls back to invoke if the API is missing).
            if (window.electronAPI.scanFolderStream && window.electronAPI.onScanFolderChunk) {
                items = await new Promise((resolve, reject) => {
                    let initialItems = null;
                    let itemByPath = null;
                    let resolved = false;
                    const safeResolve = (val) => { if (!resolved) { resolved = true; resolve(val); } };
                    const safeReject = (error) => { if (!resolved) { resolved = true; reject(new Error(error || 'scan failed')); } };
                    scanFolderStreaming(folderPath, {
                        skipStats,
                        scanImageDimensions,
                        scanVideoDimensions,
                        recursive: recursiveSearchEnabled
                    }, {
                        onItems: (folders, files) => {
                            initialItems = [...folders, ...files];
                            itemByPath = new Map();
                            for (const it of initialItems) {
                                if (it.path) itemByPath.set(it.path, it);
                            }
                            // Resolve the outer promise immediately so the rest of loadVideos
                            // can render items while dimensions arrive in the background.
                            safeResolve(initialItems);
                        },
                        onDimensions: (dims) => {
                            if (!itemByPath) return;
                            for (const d of dims) {
                                const item = itemByPath.get(d.path);
                                if (item) { item.width = d.width; item.height = d.height; }
                            }
                            scheduleStreamingLayoutRefresh();
                        },
                        onComplete: (ok) => {
                            // Final refresh to pick up any lingering dimensions
                            scheduleStreamingLayoutRefresh();
                            if (ok && initialItems) {
                                // Re-cache with complete dimensions
                                const dimEntries = initialItems.filter(
                                    i => i.type !== 'folder' && i.width && i.height
                                ).map(i => ({
                                    path: i.path, mtime: i.mtime || 0, width: i.width, height: i.height
                                }));
                                cacheDimensions(dimEntries).catch(() => {});
                                storeFolderInIndexedDB(folderPath, initialItems).catch(() => {});
                                updateInMemoryFolderCaches(folderPath, initialItems);
                            }
                            if (!ok && !initialItems) {
                                safeReject(error || `Could not scan folder: ${folderPath}`);
                                return;
                            }
                            safeResolve(initialItems || []);
                        }
                    });
                });
            } else {
                // Fallback: non-streaming (original synchronous path)
                const _scanRes = await window.electronAPI.scanFolder(folderPath, {
                    skipStats, scanImageDimensions, scanVideoDimensions,
                    recursive: recursiveSearchEnabled
                });
                if (!_scanRes || !_scanRes.ok) {
                    throw new Error((_scanRes && _scanRes.error) || `Could not scan folder: ${folderPath}`);
                }
                items = _scanRes.value || [];
            }
            perfTest.end('scanFolder (IPC stream)', scanPerfStart, { itemCount: items ? items.length : 0 });

            // Yield control after initial chunk arrives
            await yieldToEventLoop();

            // Initial cache (dimensions may still be streaming; onComplete re-caches)
            updateInMemoryFolderCaches(folderPath, items);

            // Initial dimension cache pass (best-effort; onComplete re-runs with full data)
            const dimensionEntries = items.filter(
                item => item.type !== 'folder' && item.width && item.height
            ).map(item => ({
                path: item.path,
                mtime: item.mtime || 0,
                width: item.width,
                height: item.height
            }));
            if (dimensionEntries.length > 0) cacheDimensions(dimensionEntries).catch(() => {});
            
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

        updateInMemoryFolderCaches(folderPath, items);

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
        // Clear embeddings from previous folder so stale data doesn't affect new folder
        currentEmbeddings.clear(); bumpEmbeddingsVersion();
        currentTextEmbedding = null;
        cancelEmbeddingScan();
        _cancelIdlePreEmbedding();

        renderItems(sortedItems, preservedScrollTop);

        // Show "Loading media..." while IntersectionObserver lazy-loads images/videos into cards
        const mediaItemCount = sortedItems.filter(i => i.type !== 'folder').length;
        if (mediaItemCount > 0) {
            setStatusActivity('Loading media...');
            scheduleMediaLoadSettle();
        } else {
            setStatusActivity('');
        }

        const canHydrateDimensionsInBackground = layoutMode === 'masonry' || hasDimensionDependentFilters();
        if (canHydrateDimensionsInBackground) {
            hydrateMissingDimensionsInBackground(folderPath, items).catch(() => {});
        }

        // Trigger AI embedding scan in background if enabled
        if (aiVisualSearchEnabled && aiAutoScan) {
            scheduleBackgroundEmbedding(items);
        }

        // Reset idle pre-embedding timer so remaining files get embedded when idle
        _resetIdleTimer();

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

// ═══════════════════════════════════════════════════════════════════════════
// COLLECTIONS & SAVED SEARCHES UI
// ═══════════════════════════════════════════════════════════════════════════

const collectionsListEl = document.getElementById('collections-list');
const newCollectionBtn = document.getElementById('new-collection-btn');
const savedSearchesListEl = document.getElementById('saved-searches-list');
const saveCurrentSearchBtn = document.getElementById('save-current-search-btn');

async function renderCollectionsSidebar() {
    await getAllCollections();
    if (!collectionsListEl) return;

    if (collectionsCache.length === 0) {
        collectionsListEl.innerHTML = '<div class="collections-list-empty">No collections yet</div>';
        return;
    }

    collectionsListEl.innerHTML = '';
    for (const col of collectionsCache) {
        const item = document.createElement('div');
        item.className = 'collection-item' + (currentCollectionId === col.id ? ' active' : '');
        item.dataset.collectionId = col.id;

        const hasAiQuery = col.type === 'smart' && col.rules?.aiQuery;
        const iconSvg = hasAiQuery
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a4 4 0 0 0-4 4c0 1.1.45 2.1 1.17 2.83L12 12l2.83-3.17A4 4 0 0 0 12 2z"/><path d="M5 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/><path d="M19 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/><path d="M12 16c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/><line x1="7" y1="12" x2="12" y2="16"/><line x1="17" y1="12" x2="12" y2="16"/><line x1="12" y1="12" x2="12" y2="16"/></svg>'
            : col.type === 'smart'
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="3" x2="21" y1="9" y2="9"/><line x1="9" x2="9" y1="21" y2="9"/></svg>';

        item.innerHTML = `<span class="collection-item-icon">${iconSvg}</span>` +
            `<span class="collection-item-name">${escapeHtml(col.name)}</span>` +
            `<span class="collection-item-count" data-col-count="${col.id}"></span>`;

        item.addEventListener('click', () => loadCollectionIntoGrid(col.id));
        item.addEventListener('contextmenu', (e) => showCollectionContextMenu(e, col));

        // Drop target: dragging cards onto a static collection adds them to it.
        // Accepts both in-app HTML drag (Shift+drag sets 'application/x-tcat-files')
        // and the native OS drag that startDrag produces (dataTransfer.Files).
        if (col.type === 'static') {
            const hasDraggedFiles = (dt) => {
                if (!dt) return false;
                if (dt.types && dt.types.includes('application/x-tcat-files')) return true;
                if (dt.types && dt.types.includes('Files')) return true;
                return false;
            };
            item.addEventListener('dragover', (e) => {
                if (!hasDraggedFiles(e.dataTransfer)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                item.classList.add('collection-drag-over');
            });
            item.addEventListener('dragleave', () => {
                item.classList.remove('collection-drag-over');
            });
            item.addEventListener('drop', async (e) => {
                item.classList.remove('collection-drag-over');
                if (!hasDraggedFiles(e.dataTransfer)) return;
                e.preventDefault();
                e.stopPropagation();
                // Consumed — clear native-drag tag
                _nativeDragPaths = null;
                if (_nativeDragClearTimer) { clearTimeout(_nativeDragClearTimer); _nativeDragClearTimer = null; }
                try {
                    let paths = [];
                    // 1) Preferred: our custom in-app MIME (Shift+drag)
                    const data = e.dataTransfer.getData('application/x-tcat-files');
                    if (data) {
                        const payload = JSON.parse(data);
                        if (Array.isArray(payload.paths)) paths = payload.paths.filter(Boolean);
                    }
                    // 2) Fall back to native dragged files (startDrag path)
                    if (paths.length === 0 && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        for (const f of e.dataTransfer.files) {
                            const p = window.electronAPI.getPathForFile ? window.electronAPI.getPathForFile(f) : (f.path || '');
                            if (p) paths.push(p);
                        }
                    }
                    if (paths.length === 0) return;
                    const added = await addFilesToCollection(col.id, paths);
                    if (added > 0) {
                        const n = added;
                        showToast(`Added ${n} ${n === 1 ? 'file' : 'files'} to "${col.name}"`, 'success', { duration: 2500 });
                        // Refresh this row's count badge
                        getCollectionFiles(col.id).then(files => {
                            const badge = item.querySelector(`[data-col-count="${col.id}"]`);
                            if (badge) badge.textContent = files.length;
                        });
                    } else {
                        showToast('Already in collection', 'info', { duration: 2000 });
                    }
                } catch (err) {
                    showToast(`Could not add to collection: ${friendlyError(err)}`, 'error');
                }
            });
        }

        collectionsListEl.appendChild(item);

        // Async: update count badge
        if (col.type === 'static') {
            getCollectionFiles(col.id).then(files => {
                const badge = item.querySelector(`[data-col-count="${col.id}"]`);
                if (badge) badge.textContent = files.length;
            });
        }
    }
}

// ── Saved searches ──────────────────────────────────────────────────────

let savedSearchesCache = [];

async function refreshSavedSearches() {
    try {
        if (!window.electronAPI || typeof window.electronAPI.dbGetSavedSearches !== 'function') {
            console.warn('dbGetSavedSearches IPC not available — restart the app to pick up main-process changes');
            savedSearchesCache = [];
            renderSavedSearchesSidebar();
            return;
        }
        const result = await window.electronAPI.dbGetSavedSearches();
        if (result && result.ok) {
            savedSearchesCache = Array.isArray(result.value) ? result.value : [];
        } else {
            console.error('dbGetSavedSearches failed:', result && result.error);
            savedSearchesCache = [];
        }
    } catch (err) {
        console.error('refreshSavedSearches threw:', err);
        savedSearchesCache = [];
    }
    if (!Array.isArray(savedSearchesCache)) savedSearchesCache = [];
    renderSavedSearchesSidebar();
}

function renderSavedSearchesSidebar() {
    const listEl = document.getElementById('saved-searches-list');
    if (!listEl) return;
    if (savedSearchesCache.length === 0) {
        listEl.innerHTML = '<div class="collections-list-empty">No saved searches yet</div>';
        return;
    }
    listEl.innerHTML = '';
    for (const ss of savedSearchesCache) {
        const item = document.createElement('div');
        item.className = 'collection-item';
        item.dataset.savedSearchId = ss.id;
        const iconSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
        item.innerHTML = `<span class="collection-item-icon">${iconSvg}</span>` +
            `<span class="collection-item-name">${escapeHtml(ss.name)}</span>`;
        item.title = ss.query || ss.name;
        item.addEventListener('click', () => runSavedSearch(ss.id));
        item.addEventListener('contextmenu', (e) => showSavedSearchContextMenu(e, ss));
        listEl.appendChild(item);
    }
}

// Capture a snapshot of the currently active search filters.
function _captureCurrentSearchSnapshot() {
    // Build a fully primitive snapshot. advancedSearchFilters may have picked
    // up non-cloneable values from operators / worker stamping, so explicitly
    // coerce each field.
    const adv = advancedSearchFilters || {};
    const cleanAdv = {
        sizeOperator: adv.sizeOperator == null ? '' : String(adv.sizeOperator),
        sizeValue: adv.sizeValue == null ? null : Number(adv.sizeValue),
        dateFrom: adv.dateFrom == null ? null : Number(adv.dateFrom),
        dateTo: adv.dateTo == null ? null : Number(adv.dateTo),
        width: adv.width == null ? null : Number(adv.width),
        height: adv.height == null ? null : Number(adv.height),
        aspectRatio: adv.aspectRatio == null ? '' : String(adv.aspectRatio),
        starRating: adv.starRating == null || adv.starRating === '' ? '' : Number(adv.starRating)
    };
    return {
        query: searchBox ? String(searchBox.value || '') : '',
        filters: {
            advancedSearchFilters: cleanAdv,
            currentFilter: String(currentFilter || 'all'),
            starFilterActive: !!starFilterActive,
            starSortOrder: String(starSortOrder || 'none'),
            recursiveSearchEnabled: !!recursiveSearchEnabled,
            aiSearchActive: !!aiSearchActive
        },
        folderPath: currentFolderPath ? String(currentFolderPath) : null
    };
}

// Is there anything worth saving? Used to enable/disable the save button.
function _hasActiveSearchToSave() {
    if (!searchBox) return false;
    if (searchBox.value.trim()) return true;
    if (currentFilter !== 'all') return true;
    if (starFilterActive) return true;
    if (aiSearchActive) return true;
    const adv = advancedSearchFilters;
    if (adv.sizeValue != null || adv.dateFrom != null || adv.dateTo != null) return true;
    if (adv.width != null || adv.height != null) return true;
    if (adv.aspectRatio || (adv.starRating !== '' && adv.starRating != null)) return true;
    return false;
}

function updateSaveSearchButtonState() {
    const btn = document.getElementById('save-current-search-btn');
    if (!btn) return;
    btn.disabled = !_hasActiveSearchToSave();
}

async function promptAndSaveCurrentSearch() {
    if (!_hasActiveSearchToSave()) return;
    const snapshot = _captureCurrentSearchSnapshot();
    const defaultName = snapshot.query.trim() || 'Saved search';
    const name = await showPromptDialog('Save Search', {
        defaultValue: defaultName,
        placeholder: 'Name this saved search',
        confirmLabel: 'Save'
    });
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
        // JSON round-trip as a safety net to strip any non-cloneable props
        // before crossing the IPC boundary.
        const payload = JSON.parse(JSON.stringify({
            name: trimmed,
            query: snapshot.query,
            filters: snapshot.filters,
            folderPath: snapshot.folderPath
        }));
        const res = await window.electronAPI.dbSaveSearch(payload);
        if (res && res.ok) {
            showToast(`Saved "${trimmed}"`, 'success', { duration: 2000 });
            await refreshSavedSearches();
        } else {
            showToast(`Could not save search: ${friendlyError(res && res.error)}`, 'error');
        }
    } catch (err) {
        showToast(`Could not save search: ${friendlyError(err)}`, 'error');
    }
}

async function runSavedSearch(id) {
    const ss = savedSearchesCache.find(s => s.id === id);
    if (!ss) return;
    // If scoped to a folder, navigate there first
    if (ss.folderPath && ss.folderPath !== currentFolderPath) {
        try {
            await navigateToFolder(ss.folderPath);
        } catch (err) {
            showToast(`Could not open folder: ${friendlyError(err)}`, 'error');
            return;
        }
    }
    // Restore filters
    const f = ss.filters || {};
    if (f.advancedSearchFilters) {
        advancedSearchFilters = { ...advancedSearchFilters, ...f.advancedSearchFilters };
    }
    if (typeof f.currentFilter === 'string') {
        currentFilter = f.currentFilter;
        if (typeof filterAllBtn !== 'undefined') {
            filterAllBtn.classList.toggle('active', currentFilter === 'all');
            filterVideosBtn.classList.toggle('active', currentFilter === 'video');
            filterImagesBtn.classList.toggle('active', currentFilter === 'image');
        }
    }
    if (typeof f.starFilterActive === 'boolean') starFilterActive = f.starFilterActive;
    if (typeof f.starSortOrder === 'string') starSortOrder = f.starSortOrder;
    // Restore AI search mode (only if the model is available; otherwise silently skip)
    if (typeof f.aiSearchActive === 'boolean' && aiVisualSearchEnabled) {
        aiSearchActive = f.aiSearchActive;
        const aiToggleBtnEl = document.getElementById('ai-search-toggle-btn');
        const searchBoxEl = document.getElementById('search-box');
        if (aiToggleBtnEl) {
            aiToggleBtnEl.classList.toggle('active', aiSearchActive);
            aiToggleBtnEl.title = aiSearchActive
                ? 'AI Search: On (click to disable)'
                : 'AI Search: Off (click to enable)';
        }
        if (searchBoxEl) {
            searchBoxEl.placeholder = aiSearchActive
                ? 'Search by content (e.g. "dog", "ocean")...'
                : 'Search files...';
        }
        if (!aiSearchActive) currentTextEmbedding = null;
    }
    // Restore query text + re-parse operators
    if (searchBox) {
        searchBox.value = ss.query || '';
        if (searchClearBtn) searchClearBtn.style.display = searchBox.value ? '' : 'none';
    }
    // Fire performSearch so operators re-parse + worker filters run
    performSearch(ss.query || '');
    // Record usage
    try { await window.electronAPI.dbTouchSavedSearch(id); } catch {}
    updateSaveSearchButtonState();
}

function showSavedSearchContextMenu(e, ss) {
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('.collection-context-menu').forEach(el => el.remove());
    const menu = document.createElement('div');
    menu.className = 'collection-context-menu';
    menu.innerHTML = `
        <div class="context-menu-item" data-action="rename-ss">Rename</div>
        <div class="context-menu-divider"></div>
        <div class="context-menu-item context-menu-item-danger" data-action="delete-ss">Delete</div>
    `;
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 4) + 'px';
    const close = () => { menu.remove(); document.removeEventListener('click', close); };
    setTimeout(() => document.addEventListener('click', close), 0);
    menu.addEventListener('click', async (ev) => {
        const action = ev.target.closest('[data-action]')?.dataset.action;
        if (!action) return;
        close();
        if (action === 'rename-ss') {
            const newName = await showPromptDialog('Rename Saved Search', {
                defaultValue: ss.name,
                placeholder: 'New name',
                confirmLabel: 'Rename'
            });
            if (newName && newName.trim() && newName.trim() !== ss.name) {
                try {
                    await window.electronAPI.dbRenameSavedSearch(ss.id, newName.trim());
                    await refreshSavedSearches();
                } catch (err) { showToast(`Rename failed: ${friendlyError(err)}`, 'error'); }
            }
        } else if (action === 'delete-ss') {
            try {
                await window.electronAPI.dbDeleteSavedSearch(ss.id);
                await refreshSavedSearches();
                showToast(`Deleted "${ss.name}"`, 'success', { duration: 2000 });
            } catch (err) { showToast(`Delete failed: ${friendlyError(err)}`, 'error'); }
        }
    });
}

function showCollectionContextMenu(e, collection) {
    e.preventDefault();
    e.stopPropagation();

    // Remove any existing collection context menu
    document.querySelectorAll('.collection-context-menu').forEach(el => el.remove());

    const menu = document.createElement('div');
    menu.className = 'collection-context-menu';
    menu.innerHTML = `
        <div class="context-menu-item" data-action="rename-collection">Rename</div>
        ${collection.type === 'smart' ? '<div class="context-menu-item" data-action="edit-collection-rules">Edit Rules</div>' : ''}
        ${collection.type === 'smart' ? '<div class="context-menu-item" data-action="refresh-collection">Refresh</div>' : ''}
        <div class="context-menu-divider"></div>
        <div class="context-menu-item context-menu-item-danger" data-action="delete-collection">Delete</div>
    `;

    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    document.body.appendChild(menu);

    // Keep menu in viewport
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 4) + 'px';

    const closeMenu = () => { menu.remove(); document.removeEventListener('click', closeMenu); };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);

    menu.addEventListener('click', async (ev) => {
        const action = ev.target.closest('[data-action]')?.dataset.action;
        if (!action) return;
        closeMenu();

        switch (action) {
            case 'rename-collection': {
                const newName = prompt('Rename collection:', collection.name);
                if (newName && newName.trim() && newName.trim() !== collection.name) {
                    collection.name = newName.trim();
                    await saveCollection(collection);
                    renderCollectionsSidebar();
                    if (currentCollectionId === collection.id) updateBreadcrumbForCollection(collection);
                }
                break;
            }
            case 'edit-collection-rules':
                openCollectionDialog(collection);
                break;
            case 'refresh-collection':
                if (currentCollectionId === collection.id) loadCollectionIntoGrid(collection.id);
                else backgroundScanSmartCollection(collection.id);
                break;
            case 'delete-collection': {
                if (confirm(`Delete collection "${collection.name}"?`)) {
                    await deleteCollection(collection.id);
                    if (currentCollectionId === collection.id) {
                        currentCollectionId = null;
                        currentItems = [];
                        renderItems([], null);
                        currentPathSpan.textContent = 'No folder selected';
                        itemCountEl.textContent = '';
                    }
                    renderCollectionsSidebar();
                }
                break;
            }
        }
    });
}

// Create/Edit Collection Dialog
function openCollectionDialog(existingCollection = null, onCreated = null) {
    // Remove any existing dialog
    document.querySelectorAll('.collection-dialog-overlay').forEach(el => el.remove());

    const isEdit = !!existingCollection;
    const col = existingCollection || { type: 'static', rules: null };
    const rules = col.rules || {};

    const overlay = document.createElement('div');
    overlay.className = 'collection-dialog-overlay';
    overlay.innerHTML = `
        <div class="collection-dialog">
            <h3>${isEdit ? 'Edit Collection' : 'New Collection'}</h3>
            <div class="collection-dialog-field">
                <label>Name</label>
                <input type="text" id="col-dialog-name" value="${escapeHtml(col.name || '')}" placeholder="My Collection" autofocus>
            </div>
            <div class="collection-dialog-type-toggle">
                <button class="collection-dialog-type-btn ${col.type !== 'smart' ? 'active' : ''}" data-type="static">Standard</button>
                <button class="collection-dialog-type-btn ${col.type === 'smart' ? 'active' : ''}" data-type="smart">Smart</button>
            </div>
            <div class="collection-dialog-smart-rules ${col.type === 'smart' ? 'visible' : ''}">
                <div class="collection-dialog-field">
                    <label>Source Folders</label>
                    <div class="collection-dialog-folders-list" id="col-dialog-folders"></div>
                    <button class="collection-dialog-cancel" id="col-dialog-add-folder" style="width:100%">+ Add Folder</button>
                </div>
                <div class="collection-dialog-field">
                    <label>File Type</label>
                    <select id="col-dialog-filetype">
                        <option value="all" ${(rules.fileType || 'all') === 'all' ? 'selected' : ''}>All</option>
                        <option value="video" ${rules.fileType === 'video' ? 'selected' : ''}>Videos</option>
                        <option value="image" ${rules.fileType === 'image' ? 'selected' : ''}>Images</option>
                    </select>
                </div>
                <div class="collection-dialog-field">
                    <label>Name Contains</label>
                    <input type="text" id="col-dialog-name-contains" value="${escapeHtml(rules.nameContains || '')}" placeholder="e.g. sunset">
                </div>
                <div class="collection-dialog-field">
                    <label>Minimum Dimensions (width x height)</label>
                    <div class="collection-dialog-row">
                        <input type="text" id="col-dialog-width" value="${rules.width || ''}" placeholder="Width (e.g. 3840)">
                        <input type="text" id="col-dialog-height" value="${rules.height || ''}" placeholder="Height (e.g. 2160)">
                    </div>
                </div>
                <div class="collection-dialog-field">
                    <label>Aspect Ratio</label>
                    <select id="col-dialog-aspect">
                        <option value="">Any</option>
                        <option value="16:9" ${rules.aspectRatio === '16:9' ? 'selected' : ''}>16:9</option>
                        <option value="4:3" ${rules.aspectRatio === '4:3' ? 'selected' : ''}>4:3</option>
                        <option value="1:1" ${rules.aspectRatio === '1:1' ? 'selected' : ''}>1:1</option>
                        <option value="9:16" ${rules.aspectRatio === '9:16' ? 'selected' : ''}>9:16</option>
                        <option value="21:9" ${rules.aspectRatio === '21:9' ? 'selected' : ''}>21:9</option>
                    </select>
                </div>
                <div class="collection-dialog-field">
                    <label>Size Filter (MB)</label>
                    <div class="collection-dialog-row">
                        <select id="col-dialog-size-op" style="max-width:80px">
                            <option value="">None</option>
                            <option value=">" ${rules.sizeOperator === '>' ? 'selected' : ''}>Larger than</option>
                            <option value="<" ${rules.sizeOperator === '<' ? 'selected' : ''}>Smaller than</option>
                        </select>
                        <input type="text" id="col-dialog-size-val" value="${rules.sizeValue || ''}" placeholder="e.g. 100">
                    </div>
                </div>
                <div class="collection-dialog-field">
                    <label>Date Range</label>
                    <div class="collection-dialog-row">
                        <input type="date" id="col-dialog-date-from" value="${rules.dateFrom ? new Date(rules.dateFrom).toISOString().split('T')[0] : ''}">
                        <input type="date" id="col-dialog-date-to" value="${rules.dateTo ? new Date(rules.dateTo).toISOString().split('T')[0] : ''}">
                    </div>
                </div>
                <div class="collection-dialog-field">
                    <label>Minimum Star Rating</label>
                    <select id="col-dialog-stars">
                        <option value="">Any</option>
                        <option value="1" ${rules.minStarRating == 1 ? 'selected' : ''}>1+</option>
                        <option value="2" ${rules.minStarRating == 2 ? 'selected' : ''}>2+</option>
                        <option value="3" ${rules.minStarRating == 3 ? 'selected' : ''}>3+</option>
                        <option value="4" ${rules.minStarRating == 4 ? 'selected' : ''}>4+</option>
                        <option value="5" ${rules.minStarRating == 5 ? 'selected' : ''}>5</option>
                    </select>
                </div>
                <div class="collection-dialog-field collection-dialog-ai-section" style="${aiVisualSearchEnabled ? '' : 'display:none'}">
                    <label>AI Content Search</label>
                    <input type="text" id="col-dialog-ai-query" value="${escapeHtml(rules.aiQuery || '')}" placeholder="e.g. Blue dress with gray sneakers">
                    <div class="collection-dialog-row" style="align-items:center;margin-top:6px">
                        <label style="white-space:nowrap;margin-right:8px;font-size:12px;opacity:0.7">Threshold</label>
                        <input type="range" id="col-dialog-ai-threshold" min="15" max="40" step="1" value="${Math.round((rules.aiThreshold || 0.28) * 100)}" style="flex:1">
                        <span id="col-dialog-ai-threshold-val" style="min-width:36px;text-align:right;font-size:12px;opacity:0.7">${(rules.aiThreshold || 0.28).toFixed(2)}</span>
                    </div>
                    <div style="font-size:11px;opacity:0.5;margin-top:4px">Matches images by visual content using AI. Requires AI Visual Search enabled.</div>
                </div>
            </div>
            <div class="collection-dialog-actions">
                <button class="collection-dialog-cancel" id="col-dialog-cancel">Cancel</button>
                <button class="collection-dialog-save" id="col-dialog-save">${isEdit ? 'Save' : 'Create'}</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // AI threshold slider live update
    const aiThresholdSlider = document.getElementById('col-dialog-ai-threshold');
    const aiThresholdVal = document.getElementById('col-dialog-ai-threshold-val');
    if (aiThresholdSlider && aiThresholdVal) {
        aiThresholdSlider.addEventListener('input', () => {
            aiThresholdVal.textContent = (parseInt(aiThresholdSlider.value) / 100).toFixed(2);
        });
    }

    // Source folders state — each entry is { path, recursive }
    // Backward compat: old string entries are normalized to objects
    let sourceFolders = (rules.sourceFolders || []).map(f =>
        typeof f === 'string' ? { path: f, recursive: false } : { path: f.path, recursive: !!f.recursive }
    );

    function renderFoldersList() {
        const container = document.getElementById('col-dialog-folders');
        container.innerHTML = '';
        for (let i = 0; i < sourceFolders.length; i++) {
            const entry = sourceFolders[i];
            const div = document.createElement('div');
            div.className = 'collection-dialog-folder-item';
            const folderName = entry.path.split(/[/\\]/).pop() || entry.path;
            div.innerHTML = `<span title="${escapeHtml(entry.path)}">${escapeHtml(folderName)}</span>` +
                `<label class="collection-dialog-folder-recursive" title="Include sub-folders">` +
                `<input type="checkbox" data-idx="${i}" ${entry.recursive ? 'checked' : ''}> Sub-folders</label>` +
                `<button class="collection-dialog-folder-remove" data-idx="${i}">&times;</button>`;
            container.appendChild(div);
        }
        container.querySelectorAll('.collection-dialog-folder-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                sourceFolders.splice(parseInt(btn.dataset.idx), 1);
                renderFoldersList();
            });
        });
        container.querySelectorAll('.collection-dialog-folder-recursive input').forEach(cb => {
            cb.addEventListener('change', () => {
                sourceFolders[parseInt(cb.dataset.idx)].recursive = cb.checked;
            });
        });
    }
    renderFoldersList();

    // Type toggle
    const typeBtns = overlay.querySelectorAll('.collection-dialog-type-btn');
    const smartRulesPanel = overlay.querySelector('.collection-dialog-smart-rules');
    let selectedType = col.type || 'static';

    // Don't allow changing type when editing
    if (!isEdit) {
        typeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                typeBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedType = btn.dataset.type;
                smartRulesPanel.classList.toggle('visible', selectedType === 'smart');
            });
        });
    } else {
        typeBtns.forEach(btn => { btn.style.pointerEvents = 'none'; btn.style.opacity = '0.6'; });
    }

    // Add folder button
    document.getElementById('col-dialog-add-folder').addEventListener('click', async () => {
        const result = await window.electronAPI.selectFolder();
        const folderPath = result && result.ok ? result.value : null;
        if (folderPath && !sourceFolders.some(f => f.path === folderPath)) {
            sourceFolders.push({ path: folderPath, recursive: false });
            renderFoldersList();
        }
    });

    // Close on overlay click
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    // Cancel
    document.getElementById('col-dialog-cancel').addEventListener('click', () => overlay.remove());

    // Escape key
    const escHandler = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);

    // Save
    document.getElementById('col-dialog-save').addEventListener('click', async () => {
        const name = document.getElementById('col-dialog-name').value.trim();
        if (!name) { document.getElementById('col-dialog-name').focus(); return; }

        const collectionData = isEdit ? { ...existingCollection } : {
            id: generateCollectionId(),
            createdAt: Date.now(),
            sortOrder: collectionsCache.length
        };

        collectionData.name = name;
        collectionData.type = selectedType;

        if (selectedType === 'smart') {
            if (sourceFolders.length === 0) {
                showToast('Smart collections need at least one source folder', 'warning');
                return;
            }
            const widthVal = parseInt(document.getElementById('col-dialog-width').value) || null;
            const heightVal = parseInt(document.getElementById('col-dialog-height').value) || null;
            const sizeOp = document.getElementById('col-dialog-size-op').value || '';
            const sizeVal = parseFloat(document.getElementById('col-dialog-size-val').value) || null;
            const dateFromStr = document.getElementById('col-dialog-date-from').value;
            const dateToStr = document.getElementById('col-dialog-date-to').value;
            const starsVal = parseInt(document.getElementById('col-dialog-stars').value) || null;

            const aiQueryVal = (document.getElementById('col-dialog-ai-query')?.value || '').trim();
            const aiThresholdVal2 = parseInt(document.getElementById('col-dialog-ai-threshold')?.value || '28') / 100;

            collectionData.rules = {
                sourceFolders,
                fileType: document.getElementById('col-dialog-filetype').value,
                nameContains: document.getElementById('col-dialog-name-contains').value.trim() || '',
                width: widthVal,
                height: heightVal,
                aspectRatio: document.getElementById('col-dialog-aspect').value || '',
                sizeOperator: sizeOp,
                sizeValue: sizeVal,
                dateFrom: dateFromStr ? new Date(dateFromStr).getTime() : null,
                dateTo: dateToStr ? new Date(dateToStr + 'T23:59:59').getTime() : null,
                minStarRating: starsVal,
                aiQuery: aiQueryVal || '',
                aiThreshold: aiThresholdVal2
            };
        } else {
            collectionData.rules = null;
        }

        await saveCollection(collectionData);
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
        renderCollectionsSidebar();
        showToast(`Collection "${name}" ${isEdit ? 'updated' : 'created'}`, 'success');

        // If a callback was provided (e.g. to add files), invoke it
        if (!isEdit && onCreated) {
            await onCreated(collectionData);
        }

        // If editing the currently-viewed collection, refresh it in-place
        if (isEdit && currentCollectionId === collectionData.id) {
            loadCollectionIntoGrid(collectionData.id);
        }
        // For smart collections: scan in the background without navigating away
        else if (collectionData.type === 'smart') {
            backgroundScanSmartCollection(collectionData.id);
        }
    });

    // Focus name input
    setTimeout(() => document.getElementById('col-dialog-name').focus(), 50);
}

// "Add to Collection" submenu for file context menu
function showAddToCollectionSubmenu(filePaths, anchorX, anchorY) {
    document.querySelectorAll('.add-to-collection-submenu').forEach(el => el.remove());

    const menu = document.createElement('div');
    menu.className = 'add-to-collection-submenu';

    // "New Collection..." option
    const newItem = document.createElement('div');
    newItem.className = 'context-menu-item';
    newItem.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg> New Collection...';
    newItem.addEventListener('click', async () => {
        closeSubmenu();
        // Open the full collection dialog; after creation, add the files
        openCollectionDialog(null, async (col) => {
            const count = await addFilesToCollection(col.id, filePaths);
            renderCollectionsSidebar();
            if (count > 0) showToast(`Added ${count} file(s) to "${col.name}"`, 'success');
        });
    });
    menu.appendChild(newItem);

    // Existing static collections
    const staticCols = collectionsCache.filter(c => c.type === 'static');
    if (staticCols.length > 0) {
        const divider = document.createElement('div');
        divider.className = 'context-menu-divider';
        divider.style.cssText = 'height:1px;background:var(--border-subtle);margin:4px 0;';
        menu.appendChild(divider);

        for (const col of staticCols) {
            const item = document.createElement('div');
            item.className = 'context-menu-item';
            item.textContent = col.name;
            item.addEventListener('click', async () => {
                closeSubmenu();
                const count = await addFilesToCollection(col.id, filePaths);
                renderCollectionsSidebar();
                if (count > 0) showToast(`Added ${count} file(s) to "${col.name}"`, 'success');
                else showToast('Files already in collection', 'info');
            });
            menu.appendChild(item);
        }
    }

    menu.style.left = anchorX + 'px';
    menu.style.top = anchorY + 'px';
    document.body.appendChild(menu);

    // Keep in viewport
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 4) + 'px';

    const closeSubmenu = () => { menu.remove(); document.removeEventListener('click', closeSubmenu); };
    setTimeout(() => document.addEventListener('click', closeSubmenu), 0);
}

// Wire up the "+" button
if (newCollectionBtn) {
    newCollectionBtn.addEventListener('click', () => openCollectionDialog());
}

// Wire up saved-search save button
{
    const btn = document.getElementById('save-current-search-btn');
    if (btn) {
        btn.addEventListener('click', () => promptAndSaveCurrentSearch());
    } else {
        console.warn('save-current-search-btn not found in DOM');
    }
}

// Load collections + saved searches on startup
initIndexedDB().then(() => renderCollectionsSidebar()).catch(() => {});
refreshSavedSearches().catch(() => {});
// Ensure the save button's initial disabled state reflects current filters
if (typeof updateSaveSearchButtonState === 'function') updateSaveSearchButtonState();

// Initialize theme system (must be after all let/const declarations to avoid TDZ errors)
ThemeManager.init();

// ═══════════════════════════════════════════════════════════════════════════
// COMMAND PALETTE
// ═══════════════════════════════════════════════════════════════════════════
function openSettingsToTab(tabId) {
    settingsModal.classList.remove('hidden');
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
    const tab = document.querySelector(`.settings-tab[data-tab="${tabId}"]`);
    const content = document.querySelector(`.settings-tab-content[data-tab="${tabId}"]`);
    if (tab) tab.classList.add('active');
    if (content) content.classList.add('active');
}

if (typeof CommandPalette !== 'undefined') {
    // Navigation
    CommandPalette.registerMany([
        { id: 'nav.go-back', label: 'Go Back', category: 'Navigation', shortcut: 'Ctrl+B', keywords: ['back', 'previous', 'history'], action: () => goBack() },
        { id: 'nav.go-forward', label: 'Go Forward', category: 'Navigation', shortcut: 'Ctrl+Shift+B', keywords: ['forward', 'next', 'history'], action: () => goForward() },
        { id: 'nav.open-folder', label: 'Open Folder', category: 'Navigation', shortcut: 'Ctrl+O', keywords: ['browse', 'directory', 'folder'], action: () => selectFolderBtn.click() },
        { id: 'nav.toggle-sidebar', label: 'Toggle Sidebar', category: 'Navigation', shortcut: 'S', keywords: ['sidebar', 'panel', 'explorer'], action: () => setSidebarCollapsed(!sidebarCollapsed) },
        { id: 'nav.focus-search', label: 'Focus Search', category: 'Navigation', shortcut: 'Ctrl+F', keywords: ['search', 'find', 'filter'], action: () => { searchBox.focus(); searchBox.select(); } },
        { id: 'nav.advanced-search', label: 'Advanced Search', category: 'Navigation', keywords: ['search', 'filter', 'size', 'date', 'dimension'], action: () => document.getElementById('advanced-search-btn').click() },

        // View
        { id: 'view.toggle-layout', label: 'Toggle Grid / Masonry Layout', category: 'View', shortcut: 'G', keywords: ['grid', 'masonry', 'layout', 'rigid', 'dynamic'], action: () => { layoutModeToggle.checked = !layoutModeToggle.checked; switchLayoutMode(); } },
        { id: 'view.filter-all', label: 'Show All Files', category: 'View', shortcut: '1', keywords: ['filter', 'all', 'everything'], action: () => switchFilter('all') },
        { id: 'view.filter-videos', label: 'Show Videos Only', category: 'View', shortcut: '2', keywords: ['filter', 'video', 'mp4'], action: () => switchFilter('video') },
        { id: 'view.filter-images', label: 'Show Images Only', category: 'View', shortcut: '3', keywords: ['filter', 'image', 'png', 'jpg'], action: () => switchFilter('image') },
        { id: 'view.zoom-in', label: 'Zoom In', category: 'View', shortcut: '+', keywords: ['zoom', 'bigger', 'larger'], action: () => { const z = Math.min(200, zoomLevel + 10); zoomSlider.value = z; zoomLevel = z; applyZoom(); deferLocalStorageWrite('zoomLevel', z.toString()); updateStatusBar(); } },
        { id: 'view.zoom-out', label: 'Zoom Out', category: 'View', shortcut: '-', keywords: ['zoom', 'smaller'], action: () => { const z = Math.max(50, zoomLevel - 10); zoomSlider.value = z; zoomLevel = z; applyZoom(); deferLocalStorageWrite('zoomLevel', z.toString()); updateStatusBar(); } },
        { id: 'view.zoom-reset', label: 'Reset Zoom', category: 'View', shortcut: '0', keywords: ['zoom', 'reset', '100'], action: () => { zoomSlider.value = 100; zoomLevel = 100; applyZoom(); deferLocalStorageWrite('zoomLevel', '100'); updateStatusBar(); } },

        // File Actions (require focused card -- dispatch keyboard events to reuse existing handlers)
        { id: 'file.rename', label: 'Rename File', category: 'File', shortcut: 'F2', keywords: ['rename', 'name'], when: () => focusedCardIndex >= 0, action: () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true })) },
        { id: 'file.delete', label: 'Delete File', category: 'File', shortcut: 'Delete', keywords: ['delete', 'remove', 'trash'], when: () => focusedCardIndex >= 0, action: () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })) },
        { id: 'file.reveal', label: 'Reveal in File Explorer', category: 'File', keywords: ['reveal', 'explorer', 'show', 'finder'], when: () => focusedCardIndex >= 0, action: () => { const card = visibleCards[focusedCardIndex]; if (card) { const fp = card.dataset.path; if (fp) window.electronAPI.revealInExplorer(fp); } } },

        // Tools
        { id: 'tools.organize', label: 'Organize Files', category: 'Tools', keywords: ['organize', 'move', 'sort', 'folder'], action: () => document.getElementById('organize-btn').click() },
        { id: 'tools.duplicates', label: 'Find Duplicates', category: 'Tools', keywords: ['duplicate', 'similar', 'copy'], action: () => document.getElementById('find-duplicates-btn').click() },
        { id: 'tools.batch-rename', label: 'Batch Rename Selected', category: 'Tools', keywords: ['batch', 'rename', 'bulk'], when: () => selectedCardPaths.size >= 2, action: () => openBatchRename([...selectedCardPaths]) },
        { id: 'tools.compare', label: 'Compare Selected', category: 'Tools', shortcut: 'C', keywords: ['compare', 'side by side', 'diff'], when: () => selectedCardPaths.size >= 2 && selectedCardPaths.size <= 4, action: () => openCompareMode([...selectedCardPaths]) },
        { id: 'tools.slideshow', label: 'Start Slideshow', category: 'Tools', shortcut: 'F5', keywords: ['slideshow', 'play', 'presentation'], action: () => startSlideshow() },
        { id: 'tools.select-all', label: 'Select All', category: 'Tools', shortcut: 'Ctrl+A', keywords: ['select', 'all'], action: () => selectAllCards() },
        { id: 'tools.clear-selection', label: 'Clear Selection', category: 'Tools', keywords: ['clear', 'deselect', 'none'], when: () => selectedCardPaths.size > 0, action: () => clearCardSelection() },

        // Settings
        { id: 'settings.open', label: 'Open Settings', category: 'Settings', keywords: ['settings', 'preferences', 'options', 'config'], action: () => toggleSettingsModal() },
        { id: 'settings.general', label: 'Settings: General', category: 'Settings', keywords: ['general', 'layout', 'remember'], action: () => openSettingsToTab('general') },
        { id: 'settings.appearance', label: 'Settings: Appearance', category: 'Settings', keywords: ['appearance', 'theme', 'colors'], action: () => openSettingsToTab('appearance') },
        { id: 'settings.card-info', label: 'Settings: Card Info', category: 'Settings', keywords: ['card', 'info', 'metadata', 'display'], action: () => openSettingsToTab('card-info') },
        { id: 'settings.playback', label: 'Settings: Playback', category: 'Settings', keywords: ['playback', 'video', 'loop', 'speed'], action: () => openSettingsToTab('playback') },
        { id: 'settings.ai-search', label: 'Settings: AI Search', category: 'Settings', keywords: ['ai', 'clip', 'visual', 'search', 'embedding'], action: () => openSettingsToTab('ai-search') },
        { id: 'settings.plugins', label: 'Settings: Plugins', category: 'Settings', keywords: ['plugin', 'extension', 'addon'], action: () => openSettingsToTab('plugins') },
        { id: 'settings.data', label: 'Settings: Data', category: 'Settings', keywords: ['data', 'export', 'import', 'backup'], action: () => openSettingsToTab('data') },

        // Collections & Favorites
        { id: 'collections.new', label: 'New Collection', category: 'Collections', keywords: ['collection', 'smart', 'create'], action: () => { const btn = document.getElementById('new-collection-btn'); if (btn) btn.click(); } },
        { id: 'favorites.add', label: 'Add Favorite Folder', category: 'Collections', keywords: ['favorite', 'bookmark', 'add'], action: () => { if (addFavoriteBtn) addFavoriteBtn.click(); } },
        { id: 'favorites.new-group', label: 'New Favorite Group', category: 'Collections', keywords: ['favorite', 'group', 'create'], action: () => { if (newFavGroupBtn) newFavGroupBtn.click(); } },

        // Misc
        { id: 'misc.shortcuts', label: 'Show Keyboard Shortcuts', category: 'Misc', shortcut: '?', keywords: ['keyboard', 'shortcuts', 'hotkeys', 'keybindings'], action: () => toggleShortcutsOverlay() },
        { id: 'misc.perf', label: 'Toggle Performance Dashboard', category: 'Misc', shortcut: 'Ctrl+Shift+P', keywords: ['performance', 'perf', 'dashboard', 'debug'], action: () => { if (typeof perfTest !== 'undefined') perfTest.toggle(); } },
        { id: 'misc.command-palette', label: 'Command Palette', category: 'Misc', shortcut: 'Ctrl+P', keywords: ['command', 'palette', 'actions'], action: () => CommandPalette.open() },
    ]);

    // Dynamic theme commands
    if (typeof ThemeManager !== 'undefined') {
        const themes = ThemeManager.getAllThemes();
        themes.forEach(theme => {
            CommandPalette.register({
                id: 'theme.' + theme.id,
                label: 'Theme: ' + theme.name,
                category: 'Theme',
                keywords: ['theme', 'color', 'appearance', theme.name.toLowerCase(), theme.type],
                action: () => ThemeManager.apply(theme.id)
            });
        });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// TAGGING SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

// In-memory tag cache
let allTagsCache = [];
// tagFilterActive, tagFilteredPaths, activeTagFilters, tagFilterOperator
// are declared near other filter state globals (line ~1348)

async function refreshTagsCache() {
    try {
        const result = await window.electronAPI.dbGetAllTags();
        if (result.ok) allTagsCache = result.value || [];
    } catch {}
}

// ── File-tag cache (mirrors star-rating in-memory pattern) ──────────────────

let fileTagsCache = new Map(); // Map<normalizedPath, Tag[]>
const FILE_TAGS_CACHE_MAX = 5000;

async function warmFileTagsCache(filePaths) {
    if (!filePaths.length) return;
    try {
        const result = await window.electronAPI.dbGetTagsForFiles(filePaths);
        if (result.ok && result.value) {
            for (const [fp, tags] of Object.entries(result.value)) {
                fileTagsCache.set(fp, tags);
            }
            // Mark files with no tags so we don't refetch
            for (const fp of filePaths) {
                if (!fileTagsCache.has(fp)) fileTagsCache.set(fp, []);
            }
            // Evict oldest entries if cache exceeds limit
            if (fileTagsCache.size > FILE_TAGS_CACHE_MAX) {
                const excess = fileTagsCache.size - FILE_TAGS_CACHE_MAX;
                const iter = fileTagsCache.keys();
                for (let i = 0; i < excess; i++) {
                    const key = iter.next().value;
                    if (key !== undefined) fileTagsCache.delete(key);
                }
            }
        }
    } catch {}
}

function invalidateFileTagsCache(filePath) {
    if (filePath) fileTagsCache.delete(normalizePath(filePath));
    else fileTagsCache.clear();
}

// ── Tag badges on cards ──────────────────────────────────────────────────────

function updateCardTagBadges(card) {
    const filePath = card.dataset.path;
    if (!filePath) return;
    if (!cardInfoSettings.tags) {
        const existing = card.querySelector('.card-tags');
        if (existing) existing.remove();
        return;
    }
    const tags = fileTagsCache.get(normalizePath(filePath));

    let container = card.querySelector('.card-tags');
    if (!tags || tags.length === 0) {
        if (container) container.remove();
        return;
    }
    if (!container) {
        container = document.createElement('div');
        container.className = 'card-tags';
        const info = card.querySelector('.video-info') || card.querySelector('.card-info');
        if (info) info.after(container);
        else card.appendChild(container);
    }
    container.innerHTML = '';
    for (const tag of tags.slice(0, 5)) {
        const badge = document.createElement('span');
        badge.className = 'tag-badge';
        if (tag.color) badge.style.background = tag.color;
        badge.textContent = tag.name;
        badge.title = tag.name;
        container.appendChild(badge);
    }
    if (tags.length > 5) {
        const more = document.createElement('span');
        more.className = 'tag-badge';
        more.style.background = '#555';
        more.textContent = `+${tags.length - 5}`;
        container.appendChild(more);
    }
}

// ── Tag picker dialog ────────────────────────────────────────────────────────

let tagPickerFilePaths = [];

async function openTagPicker(filePaths) {
    tagPickerFilePaths = filePaths;
    const dialog = document.getElementById('tag-picker-dialog');
    const searchInput = document.getElementById('tag-picker-search');
    dialog.classList.remove('hidden');
    searchInput.value = '';
    searchInput.focus();

    const countEl = document.getElementById('tag-picker-file-count');
    if (countEl) countEl.textContent = filePaths.length > 1 ? ` (${filePaths.length} files)` : '';

    await refreshTagsCache();
    await renderTagPickerList();
    await renderTagPickerSuggestions();
}

function closeTagPicker() {
    document.getElementById('tag-picker-dialog').classList.add('hidden');
    tagPickerFilePaths = [];
    // Refresh inspector tags if lightbox is open
    if (inspectorPanelInstance && inspectorPanelInstance._currentPath) {
        inspectorPanelInstance._renderTags();
    }
}

async function renderTagPickerList(filter) {
    const list = document.getElementById('tag-picker-list');
    list.innerHTML = '';

    const totalFiles = tagPickerFilePaths.length;
    const isMulti = totalFiles > 1;

    // Build a map of tagId -> count of files that have it
    let tagCounts = new Map();
    if (totalFiles > 0) {
        try {
            if (isMulti) {
                const normalizedPaths = tagPickerFilePaths.map(fp => normalizePath(fp));
                const result = await window.electronAPI.dbGetTagsForFiles(normalizedPaths);
                if (result.ok && result.value) {
                    for (const tags of Object.values(result.value)) {
                        for (const t of tags) tagCounts.set(t.id, (tagCounts.get(t.id) || 0) + 1);
                    }
                }
            } else {
                const result = await window.electronAPI.dbGetTagsForFile(normalizePath(tagPickerFilePaths[0]));
                if (result.ok && result.value) {
                    for (const t of result.value) tagCounts.set(t.id, 1);
                }
            }
        } catch {}
    }

    let tags = allTagsCache;
    if (filter && filter.trim()) {
        const q = filter.trim().toLowerCase();
        tags = tags.filter(t => t.name.toLowerCase().includes(q));
    }

    if (filter && filter.trim() && !tags.some(t => t.name.toLowerCase() === filter.trim().toLowerCase())) {
        // Show "create tag" option
        const createItem = document.createElement('div');
        createItem.className = 'tag-picker-create';
        createItem.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Create "${filter.trim()}"`;
        createItem.addEventListener('click', async () => {
            try {
                const result = await window.electronAPI.dbCreateTag(filter.trim(), null, '#6366f1');
                if (result.ok && result.value) {
                    await refreshTagsCache();
                    // Auto-assign to files
                    const normalizedPaths = tagPickerFilePaths.map(fp => normalizePath(fp));
                    const newTagName = result.value.name || filter.trim();
                    if (isMulti) {
                        await tagBulkAdd(normalizedPaths, result.value.id, newTagName);
                    } else {
                        await tagAddToFile(normalizedPaths[0], result.value.id, newTagName);
                    }
                    document.getElementById('tag-picker-search').value = '';
                    await renderTagPickerList();
                    refreshVisibleCardTags();
                }
            } catch {}
        });
        list.appendChild(createItem);
    }

    const checkSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
    const dashSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><line x1="6" y1="12" x2="18" y2="12"/></svg>`;

    for (const tag of tags) {
        const count = tagCounts.get(tag.id) || 0;
        const isAll = count === totalFiles;
        const isPartial = count > 0 && count < totalFiles;
        const stateClass = isAll ? ' active' : isPartial ? ' partial' : '';
        const icon = isPartial ? dashSvg : checkSvg;

        const item = document.createElement('div');
        item.className = 'tag-picker-item' + stateClass;
        item.innerHTML = `
            <div class="tag-picker-item-check">${icon}</div>
            <span class="tag-picker-item-dot" style="background:${tag.color || '#6366f1'}"></span>
            <span class="tag-picker-item-name">${tag.name}</span>
        `;
        item.addEventListener('click', async () => {
            const wasAll = item.classList.contains('active');
            const normalizedPaths = tagPickerFilePaths.map(fp => normalizePath(fp));

            if (wasAll) {
                // Remove from all files
                if (isMulti) {
                    await tagBulkRemove(normalizedPaths, tag.id, tag.name);
                } else {
                    await tagRemoveFromFile(normalizedPaths[0], tag.id, tag.name);
                }
            } else {
                // Add to all files (covers both partial and unchecked)
                if (isMulti) {
                    await tagBulkAdd(normalizedPaths, tag.id, tag.name);
                } else {
                    await tagAddToFile(normalizedPaths[0], tag.id, tag.name);
                }
            }
            // Re-render to get accurate state
            await renderTagPickerList(filter);
            refreshVisibleCardTags();
        });
        list.appendChild(item);
    }
}

async function renderTagPickerSuggestions() {
    const container = document.getElementById('tag-picker-suggestions');
    container.innerHTML = '';
    if (tagPickerFilePaths.length === 0) return;

    try {
        const result = await window.electronAPI.dbSuggestTags(tagPickerFilePaths[0]);
        if (!result.ok || !result.value || result.value.length === 0) return;
        for (const sug of result.value.slice(0, 6)) {
            const chip = document.createElement('span');
            chip.className = 'tag-suggestion';
            chip.innerHTML = `<span class="tag-picker-item-dot" style="background:${sug.tag.color || '#6366f1'}"></span>${sug.tag.name}`;
            chip.addEventListener('click', async () => {
                const normalizedPaths = tagPickerFilePaths.map(fp => normalizePath(fp));
                if (normalizedPaths.length > 1) {
                    await tagBulkAdd(normalizedPaths, sug.tag.id, sug.tag.name);
                } else if (normalizedPaths.length === 1) {
                    await tagAddToFile(normalizedPaths[0], sug.tag.id, sug.tag.name);
                }
                chip.remove();
                await renderTagPickerList(document.getElementById('tag-picker-search').value);
                refreshVisibleCardTags();
            });
            container.appendChild(chip);
        }
    } catch {}
}

async function refreshVisibleCardTags() {
    fileTagsCache.clear();
    let cards;
    if (vsState.enabled && vsState.activeCards.size > 0) {
        cards = Array.from(vsState.activeCards.values()).filter(c => c.classList.contains('video-card'));
    } else {
        cards = Array.from(document.querySelectorAll('.video-card'));
    }
    const paths = cards
        .map(c => c.dataset.path)
        .filter(Boolean)
        .map(normalizePath);
    if (paths.length > 0) await warmFileTagsCache(paths);
    cards.forEach(c => updateCardTagBadges(c));
}

// Tag picker event listeners
document.getElementById('tag-picker-close').addEventListener('click', closeTagPicker);
document.getElementById('tag-picker-dialog').addEventListener('click', (e) => {
    if (e.target.id === 'tag-picker-dialog') closeTagPicker();
});
document.getElementById('tag-picker-search').addEventListener('input', (e) => {
    renderTagPickerList(e.target.value);
});

// ── Tag filter bar ───────────────────────────────────────────────────────────

// Tag filter handler — registered in renderer-features.js via initTagFilter()
document.getElementById('filter-tags-toggle').addEventListener('click', handleTagFilterClick);

async function handleTagFilterClick() {
    // Always show dropdown (to add, remove, or clear tags)
    await refreshTagsCache();
    if (allTagsCache.length === 0) {
        showToast('No tags created yet. Open Settings > Tags to create one, or right-click a file.', 'info', { duration: 4000 });
        const settingsModal = document.getElementById('settings-modal');
        if (settingsModal) {
            settingsModal.classList.remove('hidden');
            const tagsTab = document.querySelector('.settings-tab[data-tab="tags"]');
            if (tagsTab) tagsTab.click();
        }
        return;
    }
    showTagFilterDropdown();
}

function showTagFilterDropdown() {
    // Create a simple dropdown near the tag filter button
    let dropdown = document.getElementById('tag-filter-dropdown');
    if (dropdown) dropdown.remove();

    dropdown = document.createElement('div');
    dropdown.id = 'tag-filter-dropdown';
    dropdown.style.cssText = 'position:fixed;z-index:9999;background:var(--card-bg,#1a1a1e);border:1px solid var(--border-color,#2a2a2e);border-radius:6px;padding:6px;max-height:250px;overflow-y:auto;box-shadow:0 4px 16px rgba(0,0,0,0.3);min-width:180px;';

    const btn = document.getElementById('filter-tags-toggle');
    const rect = btn.getBoundingClientRect();
    dropdown.style.left = rect.left + 'px';

    function buildDropdownItems() {
        dropdown.innerHTML = '';
        const activeIds = new Set(activeTagFilters.map(t => t.tagId));

        // Clear all option (only if filters are active)
        if (activeIds.size > 0) {
            const clearItem = document.createElement('div');
            clearItem.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:4px;cursor:pointer;font-size:12px;color:var(--text-secondary);border-bottom:1px solid var(--border-color,#2a2a2e);margin-bottom:4px;padding-bottom:8px;';
            clearItem.textContent = 'Clear all filters';
            clearItem.addEventListener('mouseenter', () => clearItem.style.background = 'var(--bg-hover,#2a2a2e)');
            clearItem.addEventListener('mouseleave', () => clearItem.style.background = '');
            clearItem.addEventListener('click', () => {
                activeTagFilters = [];
                tagFilterActive = false;
                tagFilteredPaths = null;
                bumpFilterWorkerTagFilterVersion();
                renderActiveTagFilters();
                document.getElementById('filter-tags-toggle').classList.remove('active');
                applyFilters();
                buildDropdownItems();
            });
            dropdown.appendChild(clearItem);
        }

        for (const tag of allTagsCache) {
            const isActive = activeIds.has(tag.id);
            const item = document.createElement('div');
            item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:4px;cursor:pointer;font-size:13px;color:var(--text-primary);';
            item.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${tag.color || '#6366f1'};flex-shrink:0"></span><span style="flex:1">${tag.name}</span>${isActive ? '<span style="color:var(--accent)">&#10003;</span>' : ''}`;
            item.addEventListener('mouseenter', () => item.style.background = 'var(--bg-hover,#2a2a2e)');
            item.addEventListener('mouseleave', () => item.style.background = '');
            item.addEventListener('click', async () => {
                await toggleTagFilter(tag);
                buildDropdownItems();
                // Reposition after content change
                dropdown.style.top = (rect.top - dropdown.offsetHeight - 4) + 'px';
            });
            dropdown.appendChild(item);
        }
    }

    buildDropdownItems();
    document.body.appendChild(dropdown);
    // Position above the button since it's in the status bar at the bottom of the window
    dropdown.style.top = (rect.top - dropdown.offsetHeight - 4) + 'px';
    const closeDropdown = (e) => {
        if (!dropdown.contains(e.target) && !btn.contains(e.target)) {
            dropdown.remove();
            document.removeEventListener('mousedown', closeDropdown, true);
        }
    };
    // Use mousedown on capture phase with a frame delay to avoid the opening click closing it
    requestAnimationFrame(() => {
        document.addEventListener('mousedown', closeDropdown, true);
    });
}

async function toggleTagFilter(tag) {
    const idx = activeTagFilters.findIndex(t => t.tagId === tag.id);
    if (idx >= 0) {
        activeTagFilters.splice(idx, 1);
    } else {
        activeTagFilters.push({ tagId: tag.id, name: tag.name, color: tag.color });
    }

    if (activeTagFilters.length === 0) {
        tagFilterActive = false;
        tagFilteredPaths = null;
        document.getElementById('filter-tags-toggle').classList.remove('active');
    } else {
        tagFilterActive = true;
        document.getElementById('filter-tags-toggle').classList.add('active');
        // Query files matching the tag filter
        const expression = {
            op: tagFilterOperator,
            tagIds: activeTagFilters.map(t => t.tagId)
        };
        try {
            const result = await window.electronAPI.dbQueryFilesByTags(expression);
            if (result.ok) {
                tagFilteredPaths = new Set(result.value || []);
            }
        } catch {
            tagFilteredPaths = new Set();
        }
    }
    bumpFilterWorkerTagFilterVersion();
    renderActiveTagFilters();
    applyFilters();
}

function renderActiveTagFilters() {
    const container = document.getElementById('active-tag-filters');
    container.innerHTML = '';
    for (let i = 0; i < activeTagFilters.length; i++) {
        const tag = activeTagFilters[i];
        if (i > 0) {
            const op = document.createElement('span');
            op.className = 'tag-filter-operator';
            op.textContent = tagFilterOperator;
            op.title = 'Click to toggle AND/OR';
            op.addEventListener('click', async () => {
                tagFilterOperator = tagFilterOperator === 'AND' ? 'OR' : 'AND';
                // Re-apply filter with new operator
                if (activeTagFilters.length > 0) {
                    const expression = { op: tagFilterOperator, tagIds: activeTagFilters.map(t => t.tagId) };
                    try {
                        const result = await window.electronAPI.dbQueryFilesByTags(expression);
                        if (result.ok) tagFilteredPaths = new Set(result.value || []);
                    } catch { tagFilteredPaths = new Set(); }
                    bumpFilterWorkerTagFilterVersion();
                    applyFilters();
                }
                renderActiveTagFilters();
            });
            container.appendChild(op);
        }
        const chip = document.createElement('span');
        chip.className = 'active-tag-chip';
        if (tag.color) chip.style.background = tag.color;
        chip.innerHTML = `${tag.name}<span class="active-tag-chip-remove">&times;</span>`;
        chip.querySelector('.active-tag-chip-remove').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleTagFilter({ id: tag.tagId, name: tag.name, color: tag.color });
        });
        container.appendChild(chip);
    }
}

// ── Tags management in settings ──────────────────────────────────────────────

async function renderTagsManagement() {
    const list = document.getElementById('tags-list');
    if (!list) return;
    list.innerHTML = '';
    await refreshTagsCache();

    // Get file counts for each tag
    let topTags = [];
    try {
        const result = await window.electronAPI.dbGetTopTags(999);
        if (result.ok) topTags = result.value || [];
    } catch {}
    const countMap = {};
    for (const t of topTags) countMap[t.id] = t.file_count || 0;

    for (const tag of allTagsCache) {
        const item = document.createElement('div');
        item.className = 'tag-list-item';
        item.innerHTML = `
            <span class="tag-list-item-dot" style="background:${tag.color || '#6366f1'}"></span>
            <span class="tag-list-item-name">${tag.name}</span>
            <span class="tag-list-item-count">${countMap[tag.id] || 0} files</span>
            <div class="tag-list-item-actions">
                <button class="tag-list-item-btn edit-tag-btn" title="Edit">&#9998;</button>
                <button class="tag-list-item-btn danger delete-tag-btn" title="Delete">&times;</button>
            </div>
        `;
        item.querySelector('.edit-tag-btn').addEventListener('click', () => {
            // Already in edit mode? bail
            if (item.classList.contains('editing')) return;
            item.classList.add('editing');

            const dot = item.querySelector('.tag-list-item-dot');
            const nameSpan = item.querySelector('.tag-list-item-name');
            const countSpan = item.querySelector('.tag-list-item-count');
            const actionsDiv = item.querySelector('.tag-list-item-actions');

            // Hide display elements
            dot.style.display = 'none';
            nameSpan.style.display = 'none';
            countSpan.style.display = 'none';
            actionsDiv.style.display = 'none';

            // Build inline edit row
            const editRow = document.createElement('div');
            editRow.className = 'tag-edit-row';
            editRow.innerHTML = `
                <input type="color" class="tag-color-picker" value="${tag.color || '#6366f1'}">
                <input type="text" class="tag-create-input" value="${tag.name}">
                <button class="tag-list-item-btn tag-edit-save" title="Save">&#10003;</button>
                <button class="tag-list-item-btn tag-edit-cancel" title="Cancel">&#10005;</button>
            `;
            item.appendChild(editRow);

            const nameInput = editRow.querySelector('input[type="text"]');
            const colorInput = editRow.querySelector('input[type="color"]');
            nameInput.focus();
            nameInput.select();

            const save = async () => {
                const newName = nameInput.value.trim();
                if (!newName) return;
                const newColor = colorInput.value;
                const updates = {};
                if (newName !== tag.name) updates.name = newName;
                if (newColor !== (tag.color || '#6366f1')) updates.color = newColor;
                if (Object.keys(updates).length > 0) {
                    await window.electronAPI.dbUpdateTag(tag.id, updates);
                }
                renderTagsManagement();
            };

            const cancel = () => {
                editRow.remove();
                dot.style.display = '';
                nameSpan.style.display = '';
                countSpan.style.display = '';
                actionsDiv.style.display = '';
                item.classList.remove('editing');
            };

            editRow.querySelector('.tag-edit-save').addEventListener('click', save);
            editRow.querySelector('.tag-edit-cancel').addEventListener('click', cancel);
            nameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') cancel();
            });
        });
        item.querySelector('.delete-tag-btn').addEventListener('click', async () => {
            if (confirm(`Delete tag "${tag.name}"? This will remove it from all files.`)) {
                await window.electronAPI.dbDeleteTag(tag.id);
                renderTagsManagement();
            }
        });
        list.appendChild(item);
    }

    if (allTagsCache.length === 0) {
        list.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;padding:16px 0;text-align:center;">No tags yet. Create one above or right-click a file.</div>';
    }
}

document.getElementById('tag-create-btn').addEventListener('click', async () => {
    const nameInput = document.getElementById('tag-create-name');
    const colorInput = document.getElementById('tag-create-color');
    const name = nameInput.value.trim();
    if (!name) return;
    try {
        const result = await window.electronAPI.dbCreateTag(name, null, colorInput.value);
        if (result.ok) {
            nameInput.value = '';
            renderTagsManagement();
        } else {
            showToast('Failed to create tag: ' + friendlyError(result.error || ''), 'error');
        }
    } catch (e) {
        showToast('Failed to create tag: ' + e.message, 'error');
    }
});

document.getElementById('tag-create-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('tag-create-btn').click();
});

// Render tags management when settings tab is clicked
const tagsTabBtn = document.querySelector('.settings-tab[data-tab="tags"]');
if (tagsTabBtn) {
    tagsTabBtn.addEventListener('click', () => renderTagsManagement());
}

// Initialize tags on startup
refreshTagsCache();
console.log('[Tags] renderer.js fully loaded, end of file reached');


// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FEATURES
// ═══════════════════════════════════════════════════════════════════════════

// ── Search History ──
(function initSearchHistory() {
    const SEARCH_HISTORY_KEY = 'searchHistory';
    const MAX_SEARCH_HISTORY = searchHistoryLimitSetting;
    const dropdown = document.getElementById('search-history-dropdown');
    if (!dropdown || !searchBox) return;

    function getHistory() {
        // Prefer a pending deferred write so rapid save→read sees fresh data
        if (_pendingStorageWrites.has(SEARCH_HISTORY_KEY)) {
            try { return JSON.parse(_pendingStorageWrites.get(SEARCH_HISTORY_KEY)); } catch { /* fall through */ }
        }
        try { return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]'); } catch { return []; }
    }

    function saveToHistory(query) {
        if (!query || !query.trim()) return;
        let h = getHistory().filter(s => s !== query.trim());
        h.unshift(query.trim());
        if (h.length > MAX_SEARCH_HISTORY) h = h.slice(0, MAX_SEARCH_HISTORY);
        deferLocalStorageWrite(SEARCH_HISTORY_KEY, JSON.stringify(h));
    }

    function renderDropdown() {
        const history = getHistory();
        dropdown.innerHTML = '';
        if (history.length === 0) { dropdown.classList.add('hidden'); return; }

        history.forEach(q => {
            const el = document.createElement('div');
            el.className = 'search-history-item';
            el.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
            const span = document.createElement('span');
            span.textContent = q;
            el.appendChild(span);
            el.addEventListener('mousedown', ev => {
                // Only left-click runs the search; let contextmenu handle right-click
                if (ev.button !== 0) return;
                ev.preventDefault();
                searchBox.value = q;
                const clearBtn = document.getElementById('search-clear-btn');
                if (clearBtn) clearBtn.style.display = '';
                performSearch(q);
                dropdown.classList.add('hidden');
            });
            el.addEventListener('contextmenu', ev => {
                ev.preventDefault();
                ev.stopPropagation();
                const h = getHistory().filter(s => s !== q);
                deferLocalStorageWrite(SEARCH_HISTORY_KEY, JSON.stringify(h));
                renderDropdown();
                searchBox.focus();
            });
            el.title = 'Click to search, right-click to remove';
            dropdown.appendChild(el);
        });

        const clearEl = document.createElement('div');
        clearEl.className = 'search-history-clear';
        clearEl.textContent = 'Clear history';
        clearEl.addEventListener('mousedown', ev => {
            ev.preventDefault();
            localStorage.removeItem(SEARCH_HISTORY_KEY);
            dropdown.classList.add('hidden');
        });
        dropdown.appendChild(clearEl);
        dropdown.classList.remove('hidden');
    }

    searchBox.addEventListener('focus', () => {
        if (!searchBox.value) renderDropdown();
    });
    searchBox.addEventListener('blur', () => {
        if (searchBox.value.trim()) saveToHistory(searchBox.value.trim());
        setTimeout(() => dropdown.classList.add('hidden'), 160);
    });
    searchBox.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' && searchBox.value.trim()) {
            saveToHistory(searchBox.value.trim());
            dropdown.classList.add('hidden');
        } else if (ev.key === 'Escape') {
            dropdown.classList.add('hidden');
        }
    });
    searchBox.addEventListener('input', () => {
        if (!searchBox.value) renderDropdown();
        else dropdown.classList.add('hidden');
    });
})();


// ── Date Group Headers ──
let groupByDate = false;
let dateGroupGranularity = 'month';
const collapsedDateGroups = new Set();

function getDateGroupKey(item) {
    let date;
    if (item.mtime) {
        date = new Date(item.mtime);
    } else {
        const m = (item.name || '').match(/(\d{4})[._-](\d{2})[._-](\d{2})/);
        if (m) date = new Date(+m[1], +m[2] - 1, +m[3]);
        else return 'unknown';
    }
    if (!date || isNaN(date.getTime())) return 'unknown';
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    if (dateGroupGranularity === 'year') return String(y);
    if (dateGroupGranularity === 'month') return `${y}-${mo}`;
    return `${y}-${mo}-${d}`;
}

function getDateGroupLabel(key) {
    if (key === 'unknown') return 'Unknown Date';
    const parts = key.split('-').map(Number);
    if (dateGroupGranularity === 'year') return String(parts[0]);
    if (dateGroupGranularity === 'month') {
        const d = new Date(parts[0], parts[1] - 1, 1);
        return d.toLocaleString('default', { month: 'long', year: 'numeric' });
    }
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    return d.toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function injectDateGroupHeaders(files) {
    const groups = new Map();
    const order = [];
    for (const f of files) {
        const k = getDateGroupKey(f);
        if (!groups.has(k)) { groups.set(k, []); order.push(k); }
        groups.get(k).push(f);
    }
    const result = [];
    for (const k of order) {
        const items = groups.get(k);
        result.push({ type: 'group-header', groupKey: k, label: getDateGroupLabel(k), count: items.length });
        if (!collapsedDateGroups.has(k)) result.push(...items);
    }
    return result;
}

function toggleDateGroup(groupKey) {
    if (collapsedDateGroups.has(groupKey)) collapsedDateGroups.delete(groupKey);
    else collapsedDateGroups.add(groupKey);
    applySorting();
}

// Wire up Group by Date button
let preDateGroupSortType = null;
(function initDateGrouping() {
    const btn = document.getElementById('group-by-date-btn');
    const gran = document.getElementById('date-group-granularity-select');
    if (!btn || !gran) return;

    btn.addEventListener('click', () => {
        groupByDate = !groupByDate;
        btn.classList.toggle('active', groupByDate);
        const viewBtn = document.getElementById('view-menu-btn');
        if (viewBtn) viewBtn.classList.toggle('active', groupByDate);
        gran.classList.toggle('date-group-granularity-hidden', !groupByDate);
        gran.classList.toggle('date-group-granularity-visible', groupByDate);
        collapsedDateGroups.clear();
        deferLocalStorageWrite('groupByDate', String(groupByDate));

        if (groupByDate) {
            preDateGroupSortType = sortType;
            sortType = 'date';
            if (sortTypeSelect) sortTypeSelect.value = 'date';
            deferLocalStorageWrite('sortType', sortType);
        } else if (preDateGroupSortType !== null) {
            sortType = preDateGroupSortType;
            if (sortTypeSelect) sortTypeSelect.value = sortType;
            deferLocalStorageWrite('sortType', sortType);
            preDateGroupSortType = null;
        }

        applySorting();
    });

    gran.addEventListener('change', () => {
        dateGroupGranularity = gran.value;
        collapsedDateGroups.clear();
        deferLocalStorageWrite('dateGroupGranularity', dateGroupGranularity);
        if (groupByDate) applySorting();
    });
})();

// Wire up View menu popover
(function initViewMenu() {
    const btn = document.getElementById('view-menu-btn');
    const popover = document.getElementById('view-menu-popover');
    if (!btn || !popover) return;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasHidden = popover.classList.contains('hidden');
        popover.classList.toggle('hidden');
        btn.setAttribute('aria-expanded', wasHidden ? 'true' : 'false');
    });
    document.addEventListener('click', (e) => {
        if (!popover.classList.contains('hidden') &&
            !popover.contains(e.target) &&
            !btn.contains(e.target)) {
            popover.classList.add('hidden');
            btn.setAttribute('aria-expanded', 'false');
        }
    });
})();


// ── Compare Mode ──
let cmoZoomState = { scale: 1, panX: 0, panY: 0 };
let cmoPanelStates = []; // per-panel zoom state when not synced

function openCompareMode(paths) {
    if (!paths || paths.length < 2) { showToast('Select 2–4 files to compare', 'info'); return; }
    if (paths.length > 4) paths = paths.slice(0, 4);

    const overlay = document.getElementById('compare-mode-overlay');
    const container = document.getElementById('cmo-panels-container');
    if (!overlay || !container) return;

    cmoZoomState = { scale: 1, panX: 0, panY: 0 };
    cmoPanelStates = paths.map(() => ({ scale: 1, panX: 0, panY: 0 }));
    container.innerHTML = '';

    // Set grid layout
    const n = paths.length;
    if (n <= 3) {
        container.style.gridTemplateColumns = Array(n).fill('1fr').join(' ');
        container.style.gridTemplateRows = '1fr';
    } else {
        container.style.gridTemplateColumns = '1fr 1fr';
        container.style.gridTemplateRows = '1fr 1fr';
    }

    paths.forEach((p, i) => {
        const name = p.split(/[\\/]/).pop();
        const ext = name.split('.').pop().toLowerCase();
        const isVid = ['mp4','webm','mov','avi','mkv','m4v','ogg'].includes(ext);
        const item = vsState.sortedItems.find(it => it.path === p);
        const src = item ? item.url : 'file:///' + p.replace(/\\/g, '/');

        const panel = document.createElement('div');
        panel.className = 'cmo-panel';

        const vp = document.createElement('div');
        vp.className = 'cmo-viewport';

        let media;
        if (isVid) {
            media = document.createElement('video');
            media.autoplay = true;
            media.loop = true;
            media.muted = true;
            media.controls = false;
        } else {
            media = document.createElement('img');
        }
        media.src = src;
        media.className = 'cmo-media';
        vp.appendChild(media);

        // Zoom & pan
        let isDragging = false;
        let dragStart = { x: 0, y: 0 };

        function getState() {
            const syncZoom = document.getElementById('cmo-sync-zoom');
            return syncZoom && syncZoom.checked ? cmoZoomState : cmoPanelStates[i];
        }
        function applyTransform(state) {
            media.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
        }
        function syncAll() {
            container.querySelectorAll('.cmo-media').forEach(m => {
                m.style.transform = `translate(${cmoZoomState.panX}px, ${cmoZoomState.panY}px) scale(${cmoZoomState.scale})`;
            });
        }
        function applyOne() { applyTransform(cmoPanelStates[i]); }

        vp.addEventListener('wheel', ev => {
            ev.preventDefault();
            const delta = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
            const syncZoom = document.getElementById('cmo-sync-zoom');
            if (syncZoom && syncZoom.checked) {
                cmoZoomState.scale = Math.max(0.1, Math.min(16, cmoZoomState.scale * delta));
                syncAll();
            } else {
                cmoPanelStates[i].scale = Math.max(0.1, Math.min(16, cmoPanelStates[i].scale * delta));
                applyOne();
            }
        }, { passive: false });

        vp.addEventListener('mousedown', ev => {
            if (ev.button !== 0) return;
            isDragging = true;
            dragStart = { x: ev.clientX, y: ev.clientY };
            ev.preventDefault();
        });
        window.addEventListener('mousemove', ev => {
            if (!isDragging) return;
            const dx = ev.clientX - dragStart.x;
            const dy = ev.clientY - dragStart.y;
            dragStart = { x: ev.clientX, y: ev.clientY };
            const syncZoom = document.getElementById('cmo-sync-zoom');
            if (syncZoom && syncZoom.checked) {
                cmoZoomState.panX += dx;
                cmoZoomState.panY += dy;
                syncAll();
            } else {
                cmoPanelStates[i].panX += dx;
                cmoPanelStates[i].panY += dy;
                applyOne();
            }
        });
        window.addEventListener('mouseup', () => { isDragging = false; });

        const info = document.createElement('div');
        info.className = 'cmo-panel-info';
        info.textContent = name;
        info.title = p;

        panel.appendChild(vp);
        panel.appendChild(info);
        container.appendChild(panel);
    });

    overlay.classList.remove('hidden');
}

function closeCompareMode() {
    const overlay = document.getElementById('compare-mode-overlay');
    if (!overlay) return;
    overlay.classList.add('hidden');
    const container = document.getElementById('cmo-panels-container');
    if (container) {
        container.querySelectorAll('video').forEach(v => { v.pause(); v.src = ''; });
        container.innerHTML = '';
    }
}

(function initCompareMode() {
    const closeBtn = document.getElementById('cmo-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeCompareMode);

    const resetBtn = document.getElementById('cmo-reset-zoom-btn');
    if (resetBtn) resetBtn.addEventListener('click', () => {
        cmoZoomState = { scale: 1, panX: 0, panY: 0 };
        cmoPanelStates = cmoPanelStates.map(() => ({ scale: 1, panX: 0, panY: 0 }));
        const container = document.getElementById('cmo-panels-container');
        if (container) container.querySelectorAll('.cmo-media').forEach(m => { m.style.transform = ''; });
    });

    // Escape closes compare mode
    document.addEventListener('keydown', ev => {
        const overlay = document.getElementById('compare-mode-overlay');
        if (!overlay || overlay.classList.contains('hidden')) return;
        if (ev.key === 'Escape') { ev.stopImmediatePropagation(); closeCompareMode(); }
    });
})();


// ── Slideshow Mode ──
const slideshowState = {
    active: false,
    items: [],
    index: 0,
    timer: null,
    playing: true,
    shuffle: false,
    loop: true,
    interval: 3000,
    shuffleOrder: [],
    layerA: true, // which img layer shows current item
};

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

function startSlideshow() {
    const items = vsState.sortedItems.filter(i => i.type !== 'folder' && i.type !== 'group-header' && !i.missing);
    if (items.length === 0) { showToast('No media to show in slideshow', 'info'); return; }
    slideshowState.items = items;
    slideshowState.index = 0;
    slideshowState.playing = true;
    slideshowState.shuffleOrder = items.map((_, k) => k);
    if (slideshowState.shuffle) shuffleArray(slideshowState.shuffleOrder);

    const overlay = document.getElementById('slideshow-overlay');
    if (!overlay) return;

    // Reset images
    const imgA = document.getElementById('ss-img-a');
    const imgB = document.getElementById('ss-img-b');
    const video = document.getElementById('ss-video');
    if (imgA) { imgA.src = ''; imgA.classList.remove('ss-visible'); }
    if (imgB) { imgB.src = ''; imgB.classList.remove('ss-visible'); }
    if (video) { video.pause(); video.src = ''; video.style.display = 'none'; }
    slideshowState.layerA = true;

    overlay.classList.remove('hidden');
    slideshowState.active = true;
    ssShowItem(slideshowState.shuffleOrder[slideshowState.index]);
    ssUpdateControls();
    ssScheduleNext();
}

function stopSlideshow() {
    slideshowState.active = false;
    clearTimeout(slideshowState.timer);
    const overlay = document.getElementById('slideshow-overlay');
    if (overlay) overlay.classList.add('hidden');
    const video = document.getElementById('ss-video');
    if (video) { video.pause(); video.src = ''; video.style.display = 'none'; }
}

function ssShowItem(idx) {
    slideshowState.index = idx;
    const item = slideshowState.items[idx];
    if (!item) return;

    const pos = slideshowState.shuffleOrder.indexOf(idx) + 1;
    const counterEl = document.getElementById('ss-counter');
    const filenameEl = document.getElementById('ss-filename');
    if (counterEl) counterEl.textContent = `${pos} / ${slideshowState.items.length}`;
    if (filenameEl) filenameEl.textContent = item.name || '';

    const imgA = document.getElementById('ss-img-a');
    const imgB = document.getElementById('ss-img-b');
    const video = document.getElementById('ss-video');
    if (!imgA || !imgB || !video) return;

    const ext = (item.name || '').split('.').pop().toLowerCase();
    const isVid = ['mp4','webm','mov','avi','mkv','m4v','ogg'].includes(ext);

    if (isVid) {
        imgA.classList.remove('ss-visible');
        imgB.classList.remove('ss-visible');
        video.style.display = '';
        video.src = item.url;
        video.load();
        video.play().catch(() => {});
        video.onended = () => { if (slideshowState.playing) ssNext(); };
    } else {
        video.pause();
        video.src = '';
        video.style.display = 'none';
        video.onended = null;

        const curLayer = slideshowState.layerA ? imgA : imgB;
        const nextLayer = slideshowState.layerA ? imgB : imgA;
        nextLayer.src = item.url;
        // Show immediately with crossfade
        requestAnimationFrame(() => {
            nextLayer.classList.add('ss-visible');
            curLayer.classList.remove('ss-visible');
            slideshowState.layerA = !slideshowState.layerA;
        });
    }
}

function ssNext() {
    clearTimeout(slideshowState.timer);
    const pos = slideshowState.shuffleOrder.indexOf(slideshowState.index);
    let nextPos = pos + 1;
    if (nextPos >= slideshowState.items.length) {
        if (!slideshowState.loop) { stopSlideshow(); return; }
        nextPos = 0;
    }
    ssShowItem(slideshowState.shuffleOrder[nextPos]);
    if (slideshowState.playing) ssScheduleNext();
}

function ssPrev() {
    clearTimeout(slideshowState.timer);
    const pos = slideshowState.shuffleOrder.indexOf(slideshowState.index);
    let prevPos = pos - 1;
    if (prevPos < 0) prevPos = slideshowState.items.length - 1;
    ssShowItem(slideshowState.shuffleOrder[prevPos]);
    if (slideshowState.playing) ssScheduleNext();
}

function ssScheduleNext() {
    clearTimeout(slideshowState.timer);
    if (!slideshowState.playing) return;
    slideshowState.timer = setTimeout(ssNext, slideshowState.interval);
}

function ssUpdateControls() {
    const playBtn = document.getElementById('ss-play-btn');
    const shuffleBtn = document.getElementById('ss-shuffle-btn');
    const loopBtn = document.getElementById('ss-loop-btn');
    if (playBtn) {
        playBtn.classList.toggle('active', slideshowState.playing);
        playBtn.innerHTML = slideshowState.playing
            ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
            : '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
    }
    if (shuffleBtn) shuffleBtn.classList.toggle('active', slideshowState.shuffle);
    if (loopBtn) loopBtn.classList.toggle('active', slideshowState.loop);
}

(function initSlideshow() {
    const overlay = document.getElementById('slideshow-overlay');
    if (!overlay) return;

    const playBtn = document.getElementById('ss-play-btn');
    const prevBtn = document.getElementById('ss-prev-btn');
    const nextBtn = document.getElementById('ss-next-btn');
    const closeBtn = document.getElementById('ss-close-btn');
    const shuffleBtn = document.getElementById('ss-shuffle-btn');
    const loopBtn = document.getElementById('ss-loop-btn');
    const speedSel = document.getElementById('ss-speed-select');

    if (closeBtn) closeBtn.addEventListener('click', stopSlideshow);
    if (prevBtn) prevBtn.addEventListener('click', ssPrev);
    if (nextBtn) nextBtn.addEventListener('click', ssNext);

    if (playBtn) playBtn.addEventListener('click', () => {
        slideshowState.playing = !slideshowState.playing;
        if (slideshowState.playing) ssScheduleNext();
        else clearTimeout(slideshowState.timer);
        ssUpdateControls();
    });

    if (shuffleBtn) shuffleBtn.addEventListener('click', () => {
        slideshowState.shuffle = !slideshowState.shuffle;
        if (slideshowState.shuffle) shuffleArray(slideshowState.shuffleOrder);
        else slideshowState.shuffleOrder = slideshowState.items.map((_, k) => k);
        ssUpdateControls();
    });

    if (loopBtn) loopBtn.addEventListener('click', () => {
        slideshowState.loop = !slideshowState.loop;
        ssUpdateControls();
    });

    if (speedSel) speedSel.addEventListener('change', () => {
        slideshowState.interval = parseInt(speedSel.value, 10) || 3000;
        if (slideshowState.playing) ssScheduleNext();
    });

    // Keyboard handling (high priority - captures before renderer-features.js)
    document.addEventListener('keydown', ev => {
        if (!slideshowState.active || overlay.classList.contains('hidden')) return;
        if (ev.key === 'Escape') { ev.stopImmediatePropagation(); stopSlideshow(); return; }
        if (ev.key === 'ArrowRight') { ev.stopImmediatePropagation(); ssNext(); return; }
        if (ev.key === 'ArrowLeft') { ev.stopImmediatePropagation(); ssPrev(); return; }
        if (ev.key === ' ') {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            slideshowState.playing = !slideshowState.playing;
            if (slideshowState.playing) ssScheduleNext(); else clearTimeout(slideshowState.timer);
            ssUpdateControls();
        }
    });

    // Show HUD on mouse move, hide after 2s idle
    let hudTimeout;
    const hud = document.getElementById('ss-hud');
    overlay.addEventListener('mousemove', () => {
        if (hud) hud.classList.add('ss-hud-visible');
        clearTimeout(hudTimeout);
        hudTimeout = setTimeout(() => { if (hud) hud.classList.remove('ss-hud-visible'); }, 2000);
    });
})();

// ═══════════════════════════════════════════════════════════════════════════
// ENHANCED LIGHTBOX: Filmstrip + A-B Loop + Inspector + Save Frame
// ═══════════════════════════════════════════════════════════════════════════

// ── Shared state ──
let filmstripInstance = null;
let inspectorPanelInstance = null;
let loopPoints = { in: null, out: null }; // seconds

// Persisted inspector collapsed state
let inspectorCollapsed = localStorage.getItem('lbInspectorCollapsed') === '1';

// ── Helpers ──
function _lbFormatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const s = Math.floor(sec) % 60;
    const m = Math.floor(sec / 60) % 60;
    const h = Math.floor(sec / 3600);
    const pad = (n) => n < 10 ? '0' + n : '' + n;
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function _lbFormatDate(d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleString(); } catch { return '—'; }
}

// Palette cache keyed by path|mtime
const _lbPaletteCache = new Map();

function extractDominantColors(sourceCanvas, k = 5) {
    if (!sourceCanvas || !sourceCanvas.width || !sourceCanvas.height) return [];
    try {
        const maxEdge = 64;
        const scale = Math.min(1, maxEdge / Math.max(sourceCanvas.width, sourceCanvas.height));
        const w = Math.max(1, Math.round(sourceCanvas.width * scale));
        const h = Math.max(1, Math.round(sourceCanvas.height * scale));
        const tmp = document.createElement('canvas');
        tmp.width = w; tmp.height = h;
        const tctx = tmp.getContext('2d', { willReadFrequently: true });
        tctx.drawImage(sourceCanvas, 0, 0, w, h);
        const data = tctx.getImageData(0, 0, w, h).data;
        const buckets = new Map(); // key int -> [count, rSum, gSum, bSum]
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 128) continue;
            const r = data[i] >> 4;
            const g = data[i + 1] >> 4;
            const b = data[i + 2] >> 4;
            const key = (r << 8) | (g << 4) | b;
            let e = buckets.get(key);
            if (!e) { e = [0, 0, 0, 0]; buckets.set(key, e); }
            e[0]++; e[1] += data[i]; e[2] += data[i + 1]; e[3] += data[i + 2];
        }
        const top = [...buckets.values()].sort((a, b) => b[0] - a[0]).slice(0, k);
        return top.map(e => [e[1] / e[0] | 0, e[2] / e[0] | 0, e[3] / e[0] | 0]);
    } catch {
        return [];
    }
}

function _lbRgbToHex(r, g, b) {
    const h = (n) => n.toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b);
}

function findSimilarInLightbox(filePath, k = 6) {
    if (!filePath) return null;
    const src = currentEmbeddings.get(filePath);
    if (!src) return null;
    const scored = [];
    for (const [p, emb] of currentEmbeddings) {
        if (p === filePath) continue;
        scored.push({ path: p, score: cosineSimilarity(src, emb) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
}

// ── FilmstripScrubber — extracted to filmstrip-scrubber.js ──

// ── InspectorPanel ──
class InspectorPanel {
    constructor(rootEl) {
        this._root = rootEl;
        this._currentPath = null;
        this._currentController = null;
        this._fields = {
            name: rootEl.querySelector('#lb-insp-name'),
            path: rootEl.querySelector('#lb-insp-path'),
            size: rootEl.querySelector('#lb-insp-size'),
            type: rootEl.querySelector('#lb-insp-type'),
            dim:  rootEl.querySelector('#lb-insp-dim'),
            duration: rootEl.querySelector('#lb-insp-duration'),
            frames:   rootEl.querySelector('#lb-insp-frames'),
            modified: rootEl.querySelector('#lb-insp-modified'),
            created:  rootEl.querySelector('#lb-insp-created'),
        };
        this._durationDtDd = rootEl.querySelectorAll('.lb-insp-duration-row');
        this._framesDtDd = rootEl.querySelectorAll('.lb-insp-frames-row');
        this._rating = rootEl.querySelector('#lb-insp-rating');
        this._tags = rootEl.querySelector('#lb-insp-tags');
        this._palette = rootEl.querySelector('#lb-insp-palette');
        this._similar = rootEl.querySelector('#lb-insp-similar');
        this._copyBtn = rootEl.querySelector('#lb-insp-copy-path');
        this._addTagBtn = rootEl.querySelector('#lb-insp-addtag');
        this._toggleBtn = rootEl.querySelector('#lb-inspector-toggle');
        this._actionButtons = {
            copyPath: rootEl.querySelector('#copy-path-btn'),
            copyName: rootEl.querySelector('#copy-name-btn'),
        };
        this._pluginSection = rootEl.querySelector('#lb-insp-plugin-sec');
        this._pluginSections = rootEl.querySelector('#lb-insp-plugin-sections');
        this._bindEvents();
        this._applyCollapsedState();
    }

    _bindEvents() {
        this._copyBtn.addEventListener('click', () => {
            if (this._currentPath) {
                navigator.clipboard.writeText(this._currentPath).then(() => showToast('Path copied', 'success'));
            }
        });
        this._addTagBtn.addEventListener('click', () => {
            if (this._currentPath && typeof openTagPicker === 'function') {
                openTagPicker([this._currentPath]);
                // Inspector tags will refresh when tag picker closes (see closeTagPicker hook)
            }
        });
        this._rating.addEventListener('click', (e) => {
            const star = e.target.closest('.star');
            if (!star || !this._currentPath) return;
            const r = parseInt(star.dataset.rating, 10) || 0;
            const current = typeof getFileRating === 'function' ? getFileRating(this._currentPath) : 0;
            const newRating = (current === r) ? 0 : r; // click same rating to clear
            if (typeof setFileRating === 'function') setFileRating(this._currentPath, newRating);
            this._renderRating();
        });
        this._palette.addEventListener('click', (e) => {
            const sw = e.target.closest('.lb-palette-swatch');
            if (!sw) return;
            const hex = sw.dataset.hex;
            if (hex) navigator.clipboard.writeText(hex).then(() => showToast(`${hex} copied`, 'success'));
        });
        this._root.addEventListener('click', (e) => {
            const gpsLink = e.target.closest('.exif-gps-link');
            if (!gpsLink) return;
            e.preventDefault();
            e.stopPropagation();
            const url = gpsLink.dataset.url;
            if (url) window.electronAPI.openUrl(url);
        });
        this._similar.addEventListener('click', (e) => {
            const card = e.target.closest('.lb-insp-similar-card');
            if (!card) return;
            const path = card.dataset.path;
            if (!path) return;
            // Build a navigation list: [source, ...top-K similar] so prev/next
            // navigate among the similar set rather than the folder behind.
            if (this._lastSimilarResults && this._currentPath) {
                const navList = [
                    { url: 'file:///' + this._currentPath.replace(/\\/g, '/'), path: this._currentPath, name: this._currentPath.split(/[\\/]/).pop(), type: 'image' },
                    ...this._lastSimilarResults.map(r => ({
                        url: 'file:///' + r.path.replace(/\\/g, '/'),
                        path: r.path,
                        name: r.path.split(/[\\/]/).pop(),
                        type: 'image'
                    }))
                ];
                lightboxItemsOverride = navList;
                // Find the clicked item's index in the new list and pass as a hint
                const clickedIdx = navList.findIndex(it => it.path === path);
                _lightboxNextIndexHint = clickedIdx >= 0 ? clickedIdx : null;
                showToast(`Nav: ${clickedIdx + 1}/${navList.length} similar — use ← → to browse`, 'info');
            }
            const url = 'file:///' + path.replace(/\\/g, '/');
            const name = path.split(/[\\/]/).pop();
            if (typeof openLightbox === 'function') openLightbox(url, path, name);
        });
        this._toggleBtn.addEventListener('click', () => this.toggle());
    }

    _applyCollapsedState() {
        this._root.classList.toggle('collapsed', inspectorCollapsed);
        document.documentElement.style.setProperty('--lb-inspector-width', inspectorCollapsed ? '0px' : '340px');
        syncLightboxZoomControlsPlacement();
    }

    show() {
        this._root.hidden = false;
        this._applyCollapsedState();
    }
    hide() {
        this._root.hidden = true;
        document.documentElement.style.setProperty('--lb-inspector-width', '0px');
        syncLightboxZoomControlsPlacement();
    }

    toggle() {
        inspectorCollapsed = !inspectorCollapsed;
        localStorage.setItem('lbInspectorCollapsed', inspectorCollapsed ? '1' : '0');
        this._applyCollapsedState();
    }

    async bind(filePath, controller) {
        const isControllerUpgrade = (this._currentPath === filePath) && !this._currentController && controller;
        this._currentPath = filePath;
        this._currentController = controller;
        this._syncActionButtonData();
        this.show();

        if (isControllerUpgrade) {
            // Upgrade: just refresh the controller-dependent bits
            this._renderFileInfo();
            this._renderPaletteAfterReady();
            return;
        }

        // Render synchronous sections immediately so panel feels responsive
        this._renderRating();
        this._renderTags();
        this._renderSimilar();

        // Async: file info + palette
        this._renderFileInfo();
        // Palette extraction waits for controller to be ready
        this._renderPaletteAfterReady();
    }

    unbind() {
        this._currentPath = null;
        this._currentController = null;
        this._syncActionButtonData();
        if (this._pluginSections) this._pluginSections.innerHTML = '';
        if (this._pluginSection) this._pluginSection.hidden = true;
    }

    async _renderFileInfo() {
        const path = this._currentPath;
        if (!path) return;
        this._fields.name.textContent = path.split(/[\\/]/).pop();
        this._fields.path.textContent = path;
        this._fields.size.textContent = '…';
        this._fields.type.textContent = '…';
        this._fields.dim.textContent = '—';
        this._fields.duration.textContent = '—';
        this._fields.frames.textContent = '—';
        this._fields.modified.textContent = '—';
        this._fields.created.textContent = '—';
        try {
            const res = await window.electronAPI.getFileInfo(path);
            if (path !== this._currentPath) return; // navigated away
            if (res && res.ok && res.value) {
                const info = res.value;
                this._fields.size.textContent = info.sizeFormatted || (info.size ? info.size + ' bytes' : '—');
                this._fields.type.textContent = info.type || '—';
                this._fields.dim.textContent = (info.width && info.height) ? `${info.width} × ${info.height}` : '—';
                this._fields.modified.textContent = _lbFormatDate(info.modified);
                this._fields.created.textContent = _lbFormatDate(info.created);
                // Duration row (video)
                const hasDuration = info.duration && info.duration > 0;
                this._durationDtDd.forEach(el => el.style.display = hasDuration ? '' : 'none');
                if (hasDuration) this._fields.duration.textContent = _lbFormatTime(info.duration);
                await this._renderPluginSections(info.pluginMetadata || {});
            }
        } catch { /* ignore */ }

        // Duration fallback from controller (GIF/WebP don't use ffprobe)
        if (this._currentController && this._currentController.duration > 0 && this._fields.duration.textContent === '—') {
            this._durationDtDd.forEach(el => el.style.display = '');
            this._fields.duration.textContent = _lbFormatTime(this._currentController.duration);
        }
        // Frames (GIF/WebP only)
        const fc = this._currentController && this._currentController.frameCount;
        if (fc && fc > 1) {
            this._framesDtDd.forEach(el => el.style.display = '');
            this._fields.frames.textContent = String(fc);
        } else {
            this._framesDtDd.forEach(el => el.style.display = 'none');
        }
    }

    _syncActionButtonData() {
        const path = this._currentPath || '';
        const name = path ? path.split(/[\\/]/).pop() : '';
        if (this._actionButtons.copyPath) this._actionButtons.copyPath.dataset.filePath = path;
        if (this._actionButtons.copyName) this._actionButtons.copyName.dataset.fileName = name;
    }

    async _renderPluginSections(pluginMetadata) {
        const path = this._currentPath;
        if (!this._pluginSection || !this._pluginSections || !path) return;
        this._pluginSections.innerHTML = '';
        this._pluginSection.hidden = true;
        if (!pluginMetadata) return;
        const sections = await this._getPluginInfoSections();
        let count = 0;
        for (const section of sections) {
            const card = await this._buildPluginSection(section, path, pluginMetadata);
            if (!card || path !== this._currentPath) continue;
            this._pluginSections.appendChild(card);
            count++;
        }
        if (path !== this._currentPath) return;
        this._pluginSection.hidden = count === 0;
    }

    async _getPluginInfoSections() {
        if (Array.isArray(InspectorPanel._pluginInfoSectionsCache)) {
            return InspectorPanel._pluginInfoSectionsCache;
        }
        try {
            const res = await window.electronAPI.getPluginInfoSections();
            InspectorPanel._pluginInfoSectionsCache = res && res.ok ? (res.value || []) : [];
        } catch {
            InspectorPanel._pluginInfoSectionsCache = [];
        }
        return InspectorPanel._pluginInfoSectionsCache;
    }

    async _buildPluginSection(section, filePath, pluginMetadata) {
        try {
            const res = await window.electronAPI.renderPluginInfoSection(
                section.pluginId, section.id, filePath, pluginMetadata
            );
            if (!res || !res.ok || !res.value || !res.value.html) return null;
            const { title, html, actions, summary } = res.value;

            const wrapper = document.createElement('section');
            wrapper.className = 'lb-insp-plugin-section';
            wrapper.dataset.pluginSection = `${section.pluginId}:${section.id}`;

            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'lb-insp-plugin-toggle';
            toggleBtn.setAttribute('aria-expanded', 'false');
            toggleBtn.innerHTML = `
                <span class="lb-insp-plugin-title">${escapeHtml(title || section.title || 'Plugin Info')}</span>
                ${summary ? `<span class="lb-insp-plugin-summary">${escapeHtml(summary)}</span>` : ''}
                <span class="lb-insp-plugin-chevron">›</span>
            `;

            const contentEl = document.createElement('div');
            contentEl.className = 'lb-insp-plugin-content hidden';
            contentEl.innerHTML = html;

            if (Array.isArray(actions)) {
                const actionsEl = document.createElement('div');
                actionsEl.className = 'lb-insp-plugin-actions';
                for (const action of actions) {
                    if (!action.label || !action.copyText) continue;
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'copy-btn lb-insp-plugin-action';
                    btn.textContent = action.label;
                    btn.addEventListener('click', function() {
                        navigator.clipboard.writeText(action.copyText).then(() => {
                            const original = this.textContent;
                            this.textContent = 'Copied!';
                            setTimeout(() => { this.textContent = original; }, 2000);
                        });
                    });
                    actionsEl.appendChild(btn);
                }
                if (actionsEl.childElementCount > 0) contentEl.appendChild(actionsEl);
            }

            toggleBtn.addEventListener('click', function() {
                contentEl.classList.toggle('hidden');
                const isExpanded = !contentEl.classList.contains('hidden');
                this.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
            });

            wrapper.appendChild(toggleBtn);
            wrapper.appendChild(contentEl);
            return wrapper;
        } catch (err) {
            console.warn(`[Plugin info section] ${section.pluginId}/${section.id} failed:`, err.message);
            return null;
        }
    }

    _renderRating() {
        const path = this._currentPath;
        const rating = (typeof getFileRating === 'function' && path) ? getFileRating(path) : 0;
        this._rating.innerHTML = '';
        for (let i = 1; i <= 5; i++) {
            const s = document.createElement('span');
            s.className = 'star' + (i <= rating ? ' filled' : '');
            s.dataset.rating = String(i);
            s.textContent = '★';
            this._rating.appendChild(s);
        }
    }

    _renderTags() {
        const path = this._currentPath;
        this._tags.innerHTML = '';
        if (!path) return;
        const tags = (typeof fileTagsCache !== 'undefined' && fileTagsCache.get)
            ? fileTagsCache.get(normalizePath(path))
            : null;
        if (!tags || tags.length === 0) {
            const hint = document.createElement('span');
            hint.style.cssText = 'font-size:11px;color:var(--text-secondary);';
            hint.textContent = 'No tags';
            this._tags.appendChild(hint);
            return;
        }
        tags.forEach(t => {
            const chip = document.createElement('span');
            chip.className = 'lb-insp-tag-chip';
            chip.textContent = t.name || '';
            if (t.color) {
                chip.style.background = t.color + '33';
                chip.style.borderColor = t.color + '66';
            }
            this._tags.appendChild(chip);
        });
    }

    async _renderPaletteAfterReady() {
        this._palette.innerHTML = '';
        const path = this._currentPath;
        const controller = this._currentController;
        if (!path) return;

        // Try cache first
        let mtime = 0;
        const item = (typeof currentItems !== 'undefined') ? currentItems.find(i => i.path === path) : null;
        if (item) mtime = item.mtime || 0;
        const cacheKey = `${path}|${mtime}`;
        const cached = _lbPaletteCache.get(cacheKey);
        if (cached) { this._renderPaletteSwatches(cached); return; }

        // Determine source canvas: for image, draw lightboxImage; for video, draw lightboxVideo; for gif/webp, use first frame
        let sourceCanvas = null;
        try {
            if (controller && (controller.mediaType === 'gif' || controller.mediaType === 'webp')) {
                sourceCanvas = controller.getFrameAtIndex(0);
            } else if (controller && controller.mediaType === 'video') {
                // Wait for video to be ready enough to draw
                const vid = document.getElementById('lightbox-video');
                if (vid && vid.videoWidth > 0) {
                    const c = document.createElement('canvas');
                    c.width = vid.videoWidth; c.height = vid.videoHeight;
                    c.getContext('2d').drawImage(vid, 0, 0);
                    sourceCanvas = c;
                }
            } else {
                // Static image — draw lightboxImage into a canvas after load
                const img = document.getElementById('lightbox-image');
                if (img && img.complete && img.naturalWidth > 0) {
                    const c = document.createElement('canvas');
                    c.width = img.naturalWidth; c.height = img.naturalHeight;
                    c.getContext('2d').drawImage(img, 0, 0);
                    sourceCanvas = c;
                }
            }
        } catch { /* ignore */ }

        if (!sourceCanvas) {
            // Retry once after short delay
            setTimeout(() => {
                if (path === this._currentPath) this._renderPaletteAfterReady();
            }, 400);
            return;
        }

        const colors = extractDominantColors(sourceCanvas, 5);
        if (colors.length === 0) return;
        _lbPaletteCache.set(cacheKey, colors);
        if (path !== this._currentPath) return;
        this._renderPaletteSwatches(colors);
    }

    _renderPaletteSwatches(colors) {
        this._palette.innerHTML = '';
        colors.forEach(([r, g, b]) => {
            const sw = document.createElement('div');
            sw.className = 'lb-palette-swatch';
            const hex = _lbRgbToHex(r, g, b);
            sw.style.background = `rgb(${r},${g},${b})`;
            sw.dataset.hex = hex;
            sw.title = hex;
            this._palette.appendChild(sw);
        });
    }

    async _renderSimilar() {
        this._similar.innerHTML = '';
        const path = this._currentPath;
        if (!path) { this._lastSimilarResults = null; return; }
        const results = findSimilarInLightbox(path, 6);
        this._lastSimilarResults = results;
        if (results == null) {
            // Source has no embedding. Auto-compute if AI is enabled;
            // otherwise fall back to manual "Compute now" button.
            if (aiVisualSearchEnabled) {
                if (this._similarComputing === path) return;  // in-flight for this path
                this._similarComputing = path;
                const placeholder = document.createElement('div');
                placeholder.className = 'lb-insp-similar-empty';
                placeholder.textContent = 'Computing…';
                this._similar.appendChild(placeholder);
                try {
                    const item = currentItems.find(i => i.path === path);
                    const mtime = item ? (item.mtime || 0) : 0;
                    const embResp = await window.electronAPI.clipEmbedImages([{ path, mtime, thumbPath: null }]);
                    if (this._currentPath !== path) return;  // user navigated away
                    const embResults = embResp && embResp.ok ? (embResp.value || []) : [];
                    if (embResults[0] && embResults[0].embedding) {
                        currentEmbeddings.set(path, l2Normalize(new Float32Array(embResults[0].embedding)));
                        this._renderSimilar();
                    } else {
                        this._similar.innerHTML = '';
                        const fail = document.createElement('div');
                        fail.className = 'lb-insp-similar-empty';
                        fail.textContent = 'Failed to compute embedding.';
                        this._similar.appendChild(fail);
                    }
                } catch (err) {
                    if (this._currentPath === path) {
                        this._similar.innerHTML = '';
                        const fail = document.createElement('div');
                        fail.className = 'lb-insp-similar-empty';
                        fail.textContent = 'Failed to compute embedding.';
                        this._similar.appendChild(fail);
                    }
                } finally {
                    if (this._similarComputing === path) this._similarComputing = null;
                }
                return;
            }
            const empty = document.createElement('div');
            empty.className = 'lb-insp-similar-empty';
            empty.innerHTML = 'No embedding yet.<br><button>Compute now</button>';
            empty.querySelector('button').addEventListener('click', async () => {
                const item = currentItems.find(i => i.path === path);
                const mtime = item ? (item.mtime || 0) : 0;
                try {
                    const embResp = await window.electronAPI.clipEmbedImages([{ path, mtime, thumbPath: null }]);
                    const embResults = embResp && embResp.ok ? (embResp.value || []) : [];
                    if (embResults[0] && embResults[0].embedding) {
                        const emb = l2Normalize(new Float32Array(embResults[0].embedding));
                        currentEmbeddings.set(path, emb);
                        this._renderSimilar();
                    } else {
                        showToast('Could not generate embedding for this image', 'error');
                    }
                } catch (err) { showToast('Failed to compute embedding', 'error'); }
            });
            this._similar.appendChild(empty);
            return;
        }
        if (results.length === 0) {
            // Source embedded but no siblings are. Backfill up to N with AI on.
            if (aiVisualSearchEnabled && this._similarComputing !== `backfill:${path}`) {
                this._similarComputing = `backfill:${path}`;
                const placeholder = document.createElement('div');
                placeholder.className = 'lb-insp-similar-empty';
                placeholder.textContent = 'Computing…';
                this._similar.appendChild(placeholder);
                try {
                    const MAX_BACKFILL = 12;
                    const batch = [];
                    for (const it of currentItems) {
                        if (batch.length >= MAX_BACKFILL) break;
                        if (!it || it.type === 'folder' || it.type === 'group-header') continue;
                        if (it.path === path) continue;
                        if (currentEmbeddings.has(it.path)) continue;
                        batch.push({ path: it.path, mtime: it.mtime || 0, thumbPath: null });
                    }
                    if (batch.length > 0) {
                        const embResp = await window.electronAPI.clipEmbedImages(batch);
                        if (this._currentPath !== path) return;
                        const embResults = embResp && embResp.ok ? (embResp.value || []) : [];
                        for (let i = 0; i < embResults.length; i++) {
                            const r = embResults[i];
                            if (r && r.embedding) {
                                currentEmbeddings.set(batch[i].path, l2Normalize(new Float32Array(r.embedding)));
                            }
                        }
                        this._renderSimilar();
                        return;
                    }
                } catch (err) {
                    // fall through to empty message
                } finally {
                    if (this._similarComputing === `backfill:${path}`) this._similarComputing = null;
                }
                if (this._currentPath !== path) return;
                this._similar.innerHTML = '';
            }
            const empty = document.createElement('div');
            empty.className = 'lb-insp-similar-empty';
            empty.textContent = 'No similar items in this folder.';
            this._similar.appendChild(empty);
            return;
        }
        results.forEach(r => {
            const card = document.createElement('div');
            card.className = 'lb-insp-similar-card';
            card.dataset.path = r.path;
            card.dataset.name = r.path.split(/[\\/]/).pop();
            card.dataset.src = 'file:///' + r.path.replace(/\\/g, '/');
            card.title = card.dataset.name;
            const item = (typeof currentItems !== 'undefined')
                ? currentItems.find(i => i.path === r.path)
                : null;
            const isVideo = item && item.type === 'video';
            card.dataset.mediaType = isVideo ? 'video' : 'image';
            if (item && item.width) card.dataset.width = String(item.width);
            if (item && item.height) card.dataset.height = String(item.height);
            const img = document.createElement('img');
            img.loading = 'lazy';
            if (isVideo) {
                // Use the same poster-cache system the grid uses for video cards.
                requestVideoPosterUrl(r.path).then(url => {
                    if (url && card.isConnected) img.src = url;
                }).catch(() => { /* leave blank tile */ });
            } else {
                img.src = 'file:///' + r.path.replace(/\\/g, '/');
            }
            card.appendChild(img);
            const score = document.createElement('span');
            score.className = 'score';
            score.textContent = (r.score * 100).toFixed(0) + '%';
            card.appendChild(score);
            this._similar.appendChild(card);
        });
    }

    destroy() {
        this.unbind();
        this.hide();
    }
}

// ── A-B Loop helpers ──
// Prefer the cursor hover position on the filmstrip; fall back to playback time.
function _lbResolveMarkerTime() {
    if (filmstripInstance) {
        const hover = filmstripInstance.getHoverTime();
        if (hover != null && isFinite(hover) && hover >= 0) return hover;
    }
    return activePlaybackController ? activePlaybackController.currentTime : 0;
}

function markLoopIn() {
    if (!activePlaybackController) return;
    const t = _lbResolveMarkerTime();
    if (!isFinite(t) || t < 0) return;
    if (loopPoints.out != null && t >= loopPoints.out) {
        loopPoints.in = loopPoints.out;
        loopPoints.out = t;
    } else {
        loopPoints.in = t;
    }
    if (filmstripInstance) filmstripInstance.updateMarkers(loopPoints);
    syncAbLoop();
    showToast(`Loop in: ${_lbFormatTime(loopPoints.in)}`, 'info');
}

function markLoopOut() {
    if (!activePlaybackController) return;
    const t = _lbResolveMarkerTime();
    if (!isFinite(t) || t <= 0) return;
    if (loopPoints.in != null && t <= loopPoints.in) {
        const tmp = loopPoints.in;
        loopPoints.in = t;
        loopPoints.out = tmp;
    } else {
        loopPoints.out = t;
    }
    if (filmstripInstance) filmstripInstance.updateMarkers(loopPoints);
    syncAbLoop();
    showToast(`Loop out: ${_lbFormatTime(loopPoints.out)}`, 'info');
}

function clearLoopMarks() {
    loopPoints = { in: null, out: null };
    if (filmstripInstance) filmstripInstance.updateMarkers(loopPoints);
    if (activePlaybackController) activePlaybackController.clearAbLoop();
    showToast('Loop marks cleared', 'info');
}

function syncAbLoop() {
    if (!activePlaybackController) return;
    const { in: a, out: b } = loopPoints;
    if (a != null && b != null && b > a) {
        activePlaybackController.setAbLoop(a, b);
        // Auto-enable loop so A-B actually engages
        if (!activePlaybackController.getLoop()) {
            activePlaybackController.setLoop(true);
            if (mediaControlBarInstance) mediaControlBarInstance.syncState({ loop: true });
        }
    } else {
        activePlaybackController.clearAbLoop();
    }
}

// ── Save current frame ──
async function saveCurrentFrame(promptDialog = false) {
    if (!activePlaybackController) { showToast('No media to save', 'info'); return; }
    const mt = activePlaybackController.mediaType;
    if (mt !== 'video' && mt !== 'gif' && mt !== 'webp') {
        showToast('Cannot save frame from static image', 'info');
        return;
    }
    const srcPath = window.currentLightboxFilePath;
    if (!srcPath) { showToast('No source file path', 'error'); return; }

    // Build source canvas
    let canvas;
    try {
        if (mt === 'video') {
            const vid = document.getElementById('lightbox-video');
            if (!vid || !vid.videoWidth) { showToast('Video not ready', 'info'); return; }
            canvas = document.createElement('canvas');
            canvas.width = vid.videoWidth;
            canvas.height = vid.videoHeight;
            canvas.getContext('2d').drawImage(vid, 0, 0);
        } else {
            const gifCanvas = document.getElementById('lightbox-gif-canvas');
            if (!gifCanvas) { showToast('Canvas not ready', 'info'); return; }
            canvas = gifCanvas;
        }
        const dataUrl = canvas.toDataURL('image/png');
        const base64 = dataUrl.split(',')[1];
        // Build default path: next to source file
        const sep = srcPath.includes('\\') ? '\\' : '/';
        const lastSep = Math.max(srcPath.lastIndexOf('\\'), srcPath.lastIndexOf('/'));
        const dir = lastSep >= 0 ? srcPath.slice(0, lastSep) : '.';
        const base = (lastSep >= 0 ? srcPath.slice(lastSep + 1) : srcPath).replace(/\.[^.]+$/, '');
        const t = activePlaybackController.currentTime || 0;
        const defaultPath = `${dir}${sep}${base}_frame_${t.toFixed(3)}s.png`;
        const result = await window.electronAPI.saveFrameAs({ defaultPath, dataBase64: base64, promptDialog });
        if (result && result.ok && result.value && !result.value.canceled) {
            const name = (result.value.filePath || '').split(/[\\/]/).pop();
            showToast(`Saved ${name}`, 'success');
        } else if (result && result.ok && result.value && result.value.canceled) {
            /* silent */
        } else {
            showToast('Save failed: ' + (result && result.error || 'unknown'), 'error');
        }
    } catch (err) {
        showToast('Save failed: ' + err.message, 'error');
    }
}

function toggleInspectorPanel() {
    if (inspectorPanelInstance) inspectorPanelInstance.toggle();
}

// Expose on window so the MediaControlBar (in playback-controller.js) can invoke
window.saveCurrentFrame = saveCurrentFrame;

// ═══ → convert-dialog.js (ffmpeg trim, convert, batch convert) ═══

// ═══ → lightbox.js (enhanced lightbox instances) ═══

// ═══ → settings-ui.js (keyboard shortcuts, settings handlers, CSS hydration) ═══

// ═══════════════════════════════════════════════════════════════════════════
// CANVAS GRID BRIDGE
// ═══════════════════════════════════════════════════════════════════════════
// Exposes the renderer's layout + state + actions to canvas-grid.js.
// canvas-grid.js reads from this host to paint without owning any DOM.
window.__cgHost = {
    // State getters
    get items() { return vsState.sortedItems; },
    get positions() { return vsState.positions; },
    get totalHeight() { return vsState.totalHeight; },
    get layoutMode() { return layoutMode; },
    get zoomLevel() { return zoomLevel; },
    get cardInfoSettings() { return cardInfoSettings; },
    get selection() { return selectedCardPaths; },
    get currentFolderPath() { return currentFolderPath; },
    get recursiveEnabled() { return recursiveSearchEnabled; },
    get collapsedDateGroups() { return collapsedDateGroups; },
    get gridContainer() { return gridContainer; },
    get visibleRange() { return vsGetVisibleRange; },

    // Helpers (exposed as functions)
    isFilePinned: (p) => (typeof isFilePinned === 'function' ? isFilePinned(p) : false),
    getFileRating: (p) => (typeof getFileRating === 'function' ? getFileRating(p) : 0),
    getExtensionColor: (ext) => (typeof getExtensionColor === 'function' ? getExtensionColor(ext) : '#888'),
    hexToRgba: (h, o) => (typeof hexToRgba === 'function' ? hexToRgba(h, o) : h),
    normalizePath: (p) => (typeof normalizePath === 'function' ? normalizePath(p) : p),
    getCachedBitmap: (url) => (typeof getCachedBitmap === 'function' ? getCachedBitmap(url) : null),
    prefetchImageBitmap: (url, w, h) => (typeof prefetchImageBitmap === 'function' ? prefetchImageBitmap(url, w, h) : null),
    evictBitmap: (url) => { if (typeof evictBitmapEntry === 'function') evictBitmapEntry(url); },
    requestImageThumbnailUrl: (p, size) => (typeof requestImageThumbnailUrl === 'function' ? requestImageThumbnailUrl(p, size) : Promise.resolve(null)),
    getClosestAspectRatio: (w, h) => (typeof getClosestAspectRatio === 'function' ? getClosestAspectRatio(w, h) : '16:9'),
    formatBytesForCardLabel: (b) => (typeof formatBytesForCardLabel === 'function' ? formatBytesForCardLabel(b) : String(b)),
    formatCardDate: (t) => (typeof formatCardDate === 'function' ? formatCardDate(t) : ''),
    fileTagsGetter: (p) => {
        // fileTagsCache lives in renderer-features.js
        if (typeof fileTagsCache !== 'undefined' && fileTagsCache && fileTagsCache.get) {
            return fileTagsCache.get(normalizePath(p)) || null;
        }
        return null;
    },

    // Actions (called back by canvas-grid on user interaction)
    openLightbox: (idx) => {
        const item = vsState.sortedItems[idx];
        if (!item || item.type === 'folder' || item.type === 'group-header') return;
        openLightbox(item.url, item.path, item.name);
    },
    navigateToFolder: (path) => {
        if (typeof navigateToFolder === 'function') navigateToFolder(path);
    },
    toggleDateGroup: (key) => {
        if (typeof toggleDateGroup === 'function') toggleDateGroup(key);
    },
    setFileRating: (path, rating) => {
        if (typeof setFileRating === 'function') setFileRating(path, rating);
    },
    toggleSelection: (idx, modifier /* 'ctrl'|'shift'|'none' */) => {
        const item = vsState.sortedItems[idx];
        if (!item) return;
        if (modifier === 'ctrl') {
            if (selectedCardPaths.has(item.path)) selectedCardPaths.delete(item.path);
            else selectedCardPaths.add(item.path);
            lastSelectedCardIndex = idx;
        } else if (modifier === 'shift' && lastSelectedCardIndex >= 0) {
            const lo = Math.min(lastSelectedCardIndex, idx);
            const hi = Math.max(lastSelectedCardIndex, idx);
            for (let i = lo; i <= hi; i++) {
                const it = vsState.sortedItems[i];
                if (it && it.path && it.type !== 'folder' && it.type !== 'group-header') {
                    selectedCardPaths.add(it.path);
                }
            }
        } else {
            selectedCardPaths.clear();
            selectedCardPaths.add(item.path);
            lastSelectedCardIndex = idx;
        }
        if (typeof updateSelectionStatusBar === 'function') updateSelectionStatusBar();
        if (window.CG) window.CG.invalidateSelection();
    },
    showContextMenu: (event, virtualCard) => {
        if (typeof showContextMenu === 'function') showContextMenu(event, virtualCard);
    },
    destroyVideoElement: (v) => {
        if (typeof destroyVideoElement === 'function') destroyVideoElement(v);
    },
    destroyImageElement: (img) => {
        if (typeof destroyImageElement === 'function') destroyImageElement(img);
    }
};

// Tell canvas-grid to start listening now that the host is ready
if (window.CG && typeof window.CG.attachHost === 'function') {
    window.CG.attachHost(window.__cgHost);
}
