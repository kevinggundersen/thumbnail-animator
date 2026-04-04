
// ============================================================================
// CONFIGURATION CONSTANTS - Adjust these values to fine-tune performance
// User-configurable values are `let` and hydrated from localStorage below.
// ============================================================================

// Media Loading Configuration
let MAX_VIDEOS = 120; // Max concurrent videos
let MAX_IMAGES = 120; // Max concurrent images
let PARALLEL_LOAD_LIMIT = 10; // Load up to N items in parallel for faster initial load
let PRELOAD_BUFFER_PX = 1000; // Preload content N pixels before it enters viewport

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

// ============================================================================
// Hydrate configurable constants from localStorage
// ============================================================================
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

// ============================================================================
// END CONFIGURATION CONSTANTS
// ============================================================================

// ============================================================================
// VIRTUAL SCROLLING ENGINE
// Only renders DOM cards that are visible + buffer zone.
// For 10,000 items, only ~50-100 cards exist in the DOM at any time.
// ============================================================================

// Virtual scrolling state
let vsEnabled = false;             // Whether virtual scrolling is active for current render
let vsSortedItems = [];            // Items array (sorted/filtered) backing current virtual scroll
let vsPositions = null;            // Float64Array: [left0, top0, width0, height0, left1, ...]
let vsTotalHeight = 0;             // Total computed height of all content
let vsActiveCards = new Map();     // Map<itemIndex, HTMLElement> - currently rendered cards
let vsRecyclePool = [];            // Pool of detached card DOM nodes for reuse
// VS_MAX_POOL_SIZE and VS_BUFFER_PX are defined and hydrated in the config block above
let vsScrollRafId = null;          // RAF ID for scroll handler coalescing
let vsLastStartIndex = -1;         // Last rendered range start
let vsLastEndIndex = -1;           // Last rendered range end
let vsLastScrollCleanupTime = 0;   // Throttle timestamp for proactive media loading during scroll
let vsSpacer = null;               // Spacer element that sets total scroll height
let vsResizeHandler = null;        // Window resize handler
let vsDimensionRecalcRafId = null; // RAF ID for coalescing metadata-triggered recalcs
let vsTagGeneration = 0;           // Incremented on each vsUpdateDOM to cancel stale tag fetches
let vsGroupHeadersPresent = false; // True when date group headers are in vsSortedItems

// Masonry layout cache for incremental updates
let vsLayoutCache = {
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
};

// Pre-built star rating templates for fast cloning (built lazily on first use)
let _starTemplateUnrated = null; // 0-star template
let _starTemplateCache = new Map(); // rating -> cloneable container

function getStarRatingElement(rating) {
    // Build the unrated template once (all empty stars)
    if (!_starTemplateUnrated) {
        const container = document.createElement('div');
        container.className = 'star-rating';
        container.style.pointerEvents = 'auto';
        const emptySvg = icon('star', 16);
        for (let s = 1; s <= 5; s++) {
            const star = document.createElement('span');
            star.className = 'star';
            star.innerHTML = emptySvg;
            star.style.pointerEvents = 'auto';
            star.style.cursor = 'pointer';
            container.appendChild(star);
        }
        _starTemplateUnrated = container;
    }

    if (rating === 0) {
        return _starTemplateUnrated.cloneNode(true);
    }

    // Build and cache rated templates (1-5) on first use
    if (!_starTemplateCache.has(rating)) {
        const container = document.createElement('div');
        container.className = 'star-rating has-rating';
        container.style.pointerEvents = 'auto';
        const emptySvg = icon('star', 16);
        const filledSvg = iconFilled('star', 16, 'var(--warning)');
        for (let s = 1; s <= 5; s++) {
            const star = document.createElement('span');
            star.className = s <= rating ? 'star active' : 'star';
            star.innerHTML = s <= rating ? filledSvg : emptySvg;
            star.style.pointerEvents = 'auto';
            star.style.cursor = 'pointer';
            container.appendChild(star);
        }
        _starTemplateCache.set(rating, container);
    }

    return _starTemplateCache.get(rating).cloneNode(true);
}

// Build a lookup from ASPECT_RATIOS name to ratio value for fast access
// (ASPECT_RATIOS is defined later, so we build this lazily)
let vsAspectRatioMap = null;
function vsGetAspectRatioValue(name) {
    if (!vsAspectRatioMap) {
        vsAspectRatioMap = new Map();
        // ASPECT_RATIOS is defined at line ~1617
        if (typeof ASPECT_RATIOS !== 'undefined') {
            for (const ar of ASPECT_RATIOS) {
                vsAspectRatioMap.set(ar.name, ar.ratio);
            }
        }
    }
    return vsAspectRatioMap.get(name) || (16 / 9);
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
    const cache = vsLayoutCache;
    if (
        cache.positions &&
        cache.itemCount === items.length &&
        cache.mode === mode &&
        cache.columns === newColumns &&
        items.length > 0 &&
        !vsGroupHeadersPresent
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
        vsLayoutCache = {
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
        vsLayoutCache = {
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
function vsGetVisibleRange(scrollTop, viewportHeight) {
    if (!vsPositions || vsSortedItems.length === 0) return { startIndex: 0, endIndex: 0 };

    const itemCount = vsSortedItems.length;
    const visibleTop = scrollTop - VS_BUFFER_PX;
    const visibleBottom = scrollTop + viewportHeight + VS_BUFFER_PX;

    // Find startIndex: first item whose bottom edge (top + height) > visibleTop
    let startIndex = 0;
    // Binary search for efficient lookup; linear scan only for tiny lists
    if (itemCount > 500) {
        // Binary search for start
        let lo = 0, hi = itemCount - 1;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            const idx = mid * 4;
            if (vsPositions[idx + 1] + vsPositions[idx + 3] < visibleTop) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        startIndex = lo;
    } else {
        for (let i = 0; i < itemCount; i++) {
            const idx = i * 4;
            if (vsPositions[idx + 1] + vsPositions[idx + 3] >= visibleTop) {
                startIndex = i;
                break;
            }
            if (i === itemCount - 1) startIndex = itemCount;
        }
    }

    // Find endIndex: first item whose top > visibleBottom
    let endIndex = itemCount;
    for (let i = startIndex; i < itemCount; i++) {
        const idx = i * 4;
        if (vsPositions[idx + 1] > visibleBottom) {
            endIndex = i;
            break;
        }
    }

    return { startIndex, endIndex };
}

/**
 * Create/recycle/remove card DOM nodes to match the visible range.
 */
function vsUpdateDOM(startIndex, endIndex) {
    if (!vsEnabled) return;

    // Remove cards outside visible range
    for (const [itemIdx, card] of vsActiveCards) {
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
            vsActiveCards.delete(itemIdx);

            // Add to recycle pool
            if (vsRecyclePool.length < VS_MAX_POOL_SIZE) {
                vsRecyclePool.push(card);
            }
        }
    }

    // Add cards for newly visible items
    const fragment = document.createDocumentFragment();
    const newCards = [];

    for (let i = startIndex; i < endIndex; i++) {
        if (vsActiveCards.has(i)) {
            // Card already exists, just update position if needed
            const card = vsActiveCards.get(i);
            const idx = i * 4;
            const newLeft = vsPositions[idx];
            const newTop = vsPositions[idx + 1];
            const newWidth = vsPositions[idx + 2];
            const newHeight = vsPositions[idx + 3];
            // Only update if position changed (avoids style recalc)
            if (card._vsLeft !== newLeft || card._vsTop !== newTop ||
                card._vsWidth !== newWidth || card._vsHeight !== newHeight) {
                card.style.left = `${newLeft}px`;
                card.style.top = `${newTop}px`;
                card.style.width = `${newWidth}px`;
                card.style.height = `${newHeight}px`;
                card._vsLeft = newLeft;
                card._vsTop = newTop;
                card._vsWidth = newWidth;
                card._vsHeight = newHeight;
            }
            continue;
        }

        const item = vsSortedItems[i];
        const idx = i * 4;
        const left = vsPositions[idx];
        const top = vsPositions[idx + 1];
        const width = vsPositions[idx + 2];
        const height = vsPositions[idx + 3];

        // Try to recycle a card
        let card = vsRecyclePool.pop();
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

        // Position absolutely
        card.style.position = 'absolute';
        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
        card.style.width = `${width}px`;
        card.style.height = `${height}px`;
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

        vsActiveCards.set(i, card);
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
                const card = vsActiveCards.get(i);
                if (card && card.classList.contains('video-card') && card.dataset.path) {
                    const np = normalizePath(card.dataset.path);
                    if (!fileTagsCache.has(np)) {
                        needTagPaths.push(np);
                    }
                    tagCards.push(card);
                }
            }
            if (needTagPaths.length > 0) {
                const gen = ++vsTagGeneration;
                warmFileTagsCache(needTagPaths).then(() => {
                    if (gen !== vsTagGeneration) return; // stale scroll
                    tagCards.forEach(c => {
                        if (c.dataset.path) updateCardTagBadges(c);
                    });
                });
            } else {
                tagCards.forEach(c => updateCardTagBadges(c));
            }
        }
    }

    vsLastStartIndex = startIndex;
    vsLastEndIndex = endIndex;
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
        info.textContent = item.name;

        if (!cardInfoSettings.extension) extensionLabel.style.display = 'none';
        card.appendChild(extensionLabel);

        syncStarRatingOnCard(card, item.path);
        syncPinIndicator(card, item.path);
        syncCardMetaRow(card, item, null);
        if (!cardInfoSettings.filename) info.style.display = 'none';
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

        applyCardInfoLayoutClasses(card);

        // Apply duplicate highlight if active
        if (typeof applyDuplicateHighlight === 'function') applyDuplicateHighlight(card);

        return { card, isMedia: true };
    }
}

/**
 * Handle scroll events for virtual scrolling.
 */
function vsOnScroll() {
    if (!vsEnabled || isWindowMinimized) return;

    if (vsScrollRafId) return; // Already scheduled
    vsScrollRafId = requestAnimationFrame(() => {
        vsScrollRafId = null;
        invalidateScrollCaches();
        const scrollTop = gridContainer.scrollTop;
        const viewportHeight = gridContainer.clientHeight;
        const { startIndex, endIndex } = vsGetVisibleRange(scrollTop, viewportHeight);

        // Only update if range changed
        if (startIndex !== vsLastStartIndex || endIndex !== vsLastEndIndex) {
            vsUpdateDOM(startIndex, endIndex);
        }

        // Guarantee every card currently in the viewport has media loading.
        // This bypasses IntersectionObserver entirely — using pre-computed
        // positions from the Float64Array to check visibility in O(active cards).
        vsEnsureVisibleMedia(scrollTop, viewportHeight);
    });

    // Throttle cleanup — run periodically during continuous scroll so that
    // proactiveLoadMedia picks up cards the observer hasn't reached yet
    const now = Date.now();
    if (now - vsLastScrollCleanupTime >= OBSERVER_CLEANUP_THROTTLE_MS) {
        vsLastScrollCleanupTime = now;
        scheduleCleanupCycle();
    }

    // Debounce cleanup — also run after scrolling settles, not every frame
    clearTimeout(cleanupScrollTimeout);
    cleanupScrollTimeout = setTimeout(() => {
        invalidateScrollCaches();
        runCleanupCycle();
    }, SCROLL_DEBOUNCE_MS);
}

/**
 * Force-load media for any card that is inside the viewport but has no
 * *working* media element (one whose src is actually set).
 * Uses pre-computed vsPositions (no DOM measurement, no IntersectionObserver).
 */
function vsEnsureVisibleMedia(scrollTop, viewportHeight) {
    if (!vsPositions) return;
    const visibleTop = scrollTop;
    const visibleBottom = scrollTop + viewportHeight;

    for (const [idx, card] of vsActiveCards) {
        const posIdx = idx * 4;
        const cardTop = vsPositions[posIdx + 1];
        const cardBottom = cardTop + vsPositions[posIdx + 3];

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

    vsSortedItems = items;
    vsEnabled = true;
    vsActiveCards = new Map();
    vsRecyclePool = [];
    vsLastStartIndex = -1;
    vsLastEndIndex = -1;
    vsAspectRatioMap = null; // Rebuild on next access

    // Calculate positions
    const containerWidth = gridContainer.clientWidth;
    const result = vsCalculatePositions(items, containerWidth, layoutMode, zoomLevel);
    vsPositions = result.positions;
    vsTotalHeight = result.totalHeight;

    // Set up container for absolute positioning
    gridContainer.classList.add('masonry'); // Always use block+absolute for virtual scroll
    gridContainer.classList.remove('grid');

    // Create spacer for total height
    vsSpacer = document.createElement('div');
    vsSpacer.className = 'masonry-spacer vs-spacer';
    vsSpacer.style.width = '1px';
    vsSpacer.style.height = `${vsTotalHeight}px`;
    vsSpacer.style.position = 'static';
    vsSpacer.style.pointerEvents = 'none';
    vsSpacer.style.visibility = 'hidden';
    vsSpacer.style.margin = '0';
    vsSpacer.style.padding = '0';
    gridContainer.appendChild(vsSpacer);

    // Initial render
    const scrollTop = gridContainer.scrollTop;
    const viewportHeight = gridContainer.clientHeight;
    const { startIndex, endIndex } = vsGetVisibleRange(scrollTop, viewportHeight);
    vsUpdateDOM(startIndex, endIndex);

    // Attach scroll listener
    gridContainer.addEventListener('scroll', vsOnScroll, { passive: true });

    // Attach resize handler
    vsResizeHandler = () => {
        cachedViewportBounds = null;
        viewportBoundsCacheTime = 0;
        cardRectCacheGeneration++;
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            vsRecalculate();
        }, 150);
    };
    window.addEventListener('resize', vsResizeHandler);
}

/**
 * Recalculate positions (after resize, zoom change, or filter change).
 */
function vsRecalculate() {
    if (!vsEnabled) return;

    // Remember which item is at the top of viewport
    const scrollTop = gridContainer.scrollTop;
    const viewportHeight = gridContainer.clientHeight;
    let anchorItemIndex = -1;
    let anchorOffset = 0;

    if (vsPositions && vsSortedItems.length > 0) {
        const { startIndex } = vsGetVisibleRange(scrollTop, viewportHeight);
        if (startIndex < vsSortedItems.length) {
            anchorItemIndex = startIndex;
            const idx = startIndex * 4;
            anchorOffset = scrollTop - vsPositions[idx + 1];
        }
    }

    // Recalculate positions
    const containerWidth = gridContainer.clientWidth;
    const result = vsCalculatePositions(vsSortedItems, containerWidth, layoutMode, zoomLevel);
    vsPositions = result.positions;
    vsTotalHeight = result.totalHeight;

    // Update spacer
    if (vsSpacer) {
        vsSpacer.style.height = `${vsTotalHeight}px`;
    }

    // Restore scroll position relative to anchor item
    if (anchorItemIndex >= 0 && anchorItemIndex < vsSortedItems.length) {
        const idx = anchorItemIndex * 4;
        const newTop = vsPositions[idx + 1];
        gridContainer.scrollTop = newTop + anchorOffset;
    }

    // Force full re-render of visible range
    vsLastStartIndex = -1;
    vsLastEndIndex = -1;
    const newScrollTop = gridContainer.scrollTop;
    const { startIndex, endIndex } = vsGetVisibleRange(newScrollTop, viewportHeight);
    vsUpdateDOM(startIndex, endIndex);
}

/**
 * Update virtual scrolling with new filtered/sorted items.
 */
function vsUpdateItems(items, options = {}) {
    if (!vsEnabled) {
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
        for (const [oldIdx, card] of vsActiveCards) {
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
                if (vsRecyclePool.length < VS_MAX_POOL_SIZE) {
                    vsRecyclePool.push(card);
                }
            }
        }

        vsActiveCards.clear();
        // Re-register kept cards under their new indices
        for (const [newIdx, card] of keptCards) {
            card._vsItemIndex = newIdx;
            vsActiveCards.set(newIdx, card);
        }
    } else {
        // --- Full teardown path for folder navigation ---
        for (const [itemIdx, card] of vsActiveCards) {
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
            if (vsRecyclePool.length < VS_MAX_POOL_SIZE) {
                vsRecyclePool.push(card);
            }
        }
        vsActiveCards.clear();
        pendingMediaCreations.clear();
        mediaToRetry.clear();
    }

    vsSortedItems = items;

    // Invalidate layout cache -- items changed, force full recalculation
    vsLayoutCache.itemCount = 0;

    // Recalculate positions
    const containerWidth = gridContainer.clientWidth;
    const result = vsCalculatePositions(items, containerWidth, layoutMode, zoomLevel);
    vsPositions = result.positions;
    vsTotalHeight = result.totalHeight;

    // Update spacer
    if (vsSpacer) {
        vsSpacer.style.height = `${vsTotalHeight}px`;
    }

    // Scroll to top for new items, or preserve scroll for filter changes
    gridContainer.scrollTop = savedScrollTop;

    // Render visible range
    vsLastStartIndex = -1;
    vsLastEndIndex = -1;
    const viewportHeight = gridContainer.clientHeight;
    const { startIndex, endIndex } = vsGetVisibleRange(savedScrollTop, viewportHeight);
    vsUpdateDOM(startIndex, endIndex);
}

/**
 * Clean up virtual scrolling state.
 */
function vsCleanup() {
    vsEnabled = false;
    cancelMarquee();

    if (vsScrollRafId) {
        cancelAnimationFrame(vsScrollRafId);
        vsScrollRafId = null;
    }

    gridContainer.removeEventListener('scroll', vsOnScroll);

    if (vsResizeHandler) {
        window.removeEventListener('resize', vsResizeHandler);
        vsResizeHandler = null;
    }

    // Clean up active cards
    for (const [, card] of vsActiveCards) {
        const mediaEl = card._mediaEl;
        if (mediaEl) {
            if (mediaEl.tagName === 'VIDEO') destroyVideoElement(mediaEl);
            else destroyImageElement(mediaEl);
        }
        observer.unobserve(card);
    }
    vsActiveCards.clear();
    vsRecyclePool = [];
    vsPositions = null;
    vsSortedItems = [];
    vsTotalHeight = 0;
    vsLastStartIndex = -1;
    vsLastEndIndex = -1;

    if (vsSpacer && vsSpacer.parentNode) {
        vsSpacer.remove();
    }
    vsSpacer = null;
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
    return vsActiveCards.get(index) || null;
}

// ============================================================================
// END VIRTUAL SCROLLING ENGINE
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
const searchClearBtn = document.getElementById('search-clear-btn');
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

// ===== Toast Notification System =====
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

    // Limit visible toasts
    const existing = toastContainer.querySelectorAll('.toast:not(.toast-exit)');
    if (existing.length >= MAX_TOASTS) {
        dismissToast(existing[existing.length - 1]);
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

// ===== Auto-Update Notifications =====
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

// ===== Friendly Error Messages =====
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

// ===== Application Menu Command Handler =====
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

// ===== Custom Confirmation Dialog =====
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

confirmDialogOk.addEventListener('click', () => _closeConfirmDialog(true));
confirmDialogCancel.addEventListener('click', () => _closeConfirmDialog(false));
confirmDialog.addEventListener('click', (e) => {
    if (e.target === confirmDialog) _closeConfirmDialog(false);
});
document.addEventListener('keydown', (e) => {
    if (!confirmDialog.classList.contains('hidden')) {
        if (e.key === 'Escape') { e.preventDefault(); _closeConfirmDialog(false); }
        if (e.key === 'Enter') { e.preventDefault(); _closeConfirmDialog(true); }
    }
});

// ===== File Conflict Dialog =====
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

        const srcInfo = srcResult.success ? srcResult.info : null;
        const dstInfo = dstResult.success ? dstResult.info : null;

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
        if (e.key === 'Escape') { e.preventDefault(); _closeConflictDialog('skip'); }
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

// Make keyboard hint in status bar clickable
document.querySelectorAll('.status-keyboard-hint').forEach(el => {
    el.addEventListener('click', () => toggleShortcutsOverlay());
});
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
let activeDimensionHydrationToken = 0;

// Store current items for re-sorting without re-fetching
let currentItems = [];

// --- AI Visual Search state ---
let aiVisualSearchEnabled = localStorage.getItem('aiVisualSearchEnabled') === 'true';
let aiModelDownloadConfirmed = localStorage.getItem('aiModelDownloadConfirmed') === 'true';
let aiAutoScan = localStorage.getItem('aiAutoScan') === 'true';
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
let findSimilarActive = false;
let findSimilarEmbedding = null;       // Float32Array - source image embedding
let findSimilarSourcePath = null;      // Source file path
let findSimilarThreshold = 0.60;       // Similarity threshold (0-1)
let findSimilarAllFolders = false;     // Cross-folder toggle
let findSimilarPreviousItems = null;   // Stashed currentItems to restore on clear
let findSimilarPreviousFolder = null;  // Stashed currentFolderPath to restore on clear

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
    tagsOnlyOnHover: false
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

// ============================================================================
// COLLECTIONS / ALBUMS
// Virtual file-level groupings stored in IndexedDB.
// ============================================================================

let currentCollectionId = null;   // When set, grid shows collection contents
let collectionsCache = [];        // In-memory array of all collection metadata

function generateCollectionId() {
    return 'col_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
}

function generateCollectionFileId() {
    return 'cf_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
}

async function getAllCollections() {
    try {
        const result = await window.electronAPI.dbGetAllCollections();
        if (result.success) {
            collectionsCache = result.data || [];
            return collectionsCache;
        }
    } catch {}
    return [];
}

async function getCollection(id) {
    try {
        const result = await window.electronAPI.dbGetCollection(id);
        if (result.success) return result.data;
    } catch {}
    return null;
}

async function saveCollection(collection) {
    collection.updatedAt = Date.now();
    try {
        await window.electronAPI.dbSaveCollection(collection);
        // Update in-memory cache
        const idx = collectionsCache.findIndex(c => c.id === collection.id);
        if (idx >= 0) collectionsCache[idx] = collection;
        else collectionsCache.push(collection);
        // Invalidate smart collection result cache (rules may have changed)
        smartCollectionCache.delete(collection.id);
    } catch (e) {
        console.error('Error saving collection:', e);
        showToast('Failed to save collection', 'error');
    }
}

async function deleteCollection(id) {
    try {
        await window.electronAPI.dbDeleteCollection(id);
        collectionsCache = collectionsCache.filter(c => c.id !== id);
        smartCollectionCache.delete(id);
    } catch (e) {
        console.error('Error deleting collection:', e);
        showToast('Failed to delete collection', 'error');
    }
}

async function getCollectionFiles(collectionId) {
    try {
        const result = await window.electronAPI.dbGetCollectionFiles(collectionId);
        if (result.success) return result.data || [];
    } catch (e) {
        console.error('Error loading collection files:', e);
    }
    return [];
}

async function addFilesToCollection(collectionId, filePaths) {
    if (filePaths.length === 0) return 0;
    try {
        const result = await window.electronAPI.dbAddFilesToCollection(collectionId, filePaths);
        if (result.success) return result.data || 0;
    } catch (e) {
        console.error('Error adding files to collection:', e);
        showToast('Failed to add files to collection', 'error');
    }
    return 0;
}

async function removeFileFromCollection(collectionId, filePath) {
    try {
        // Try both original and normalized path since storage format may vary
        await window.electronAPI.dbRemoveFileFromCollection(collectionId, filePath);
        const normalized = normalizePath(filePath);
        if (normalized !== filePath) {
            await window.electronAPI.dbRemoveFileFromCollection(collectionId, normalized);
        }
    } catch (e) {
        console.error('Error removing file from collection:', e);
        showToast('Failed to remove file from collection', 'error');
    }
}

async function removeAllMissingFromCollection(collectionId, missingPaths) {
    if (missingPaths.length === 0) return;
    try {
        const normalizedMissing = missingPaths.map(p => normalizePath(p));
        await window.electronAPI.dbRemoveFilesFromCollection(collectionId, normalizedMissing);
    } catch (e) {
        console.error('Error cleaning missing files from collection:', e);
    }
}

// Match an item against smart collection filter rules
function matchesSmartRules(item, rules) {
    if (!rules) return true;

    // File type filter
    if (rules.fileType && rules.fileType !== 'all') {
        if (item.type !== rules.fileType) return false;
    }

    // Size filter
    if (rules.sizeValue != null && rules.sizeOperator) {
        const sizeBytes = item.size || 0;
        const targetBytes = rules.sizeValue * 1024 * 1024; // rules.sizeValue is in MB
        switch (rules.sizeOperator) {
            case '>': if (sizeBytes <= targetBytes) return false; break;
            case '<': if (sizeBytes >= targetBytes) return false; break;
            case '=': if (Math.abs(sizeBytes - targetBytes) > targetBytes * 0.1) return false; break;
        }
    }

    // Date range filter
    if (rules.dateFrom != null) {
        if ((item.mtime || 0) < rules.dateFrom) return false;
    }
    if (rules.dateTo != null) {
        if ((item.mtime || 0) > rules.dateTo) return false;
    }

    // Dimension filters
    if (rules.width != null) {
        if (item.width !== rules.width) return false;
    }
    if (rules.height != null) {
        if (item.height !== rules.height) return false;
    }

    // Aspect ratio
    if (rules.aspectRatio) {
        const w = item.width, h = item.height;
        if (w && h) {
            const ratio = w / h;
            const targetRatio = parseAspectRatio(rules.aspectRatio);
            if (Math.abs(ratio - targetRatio) > 0.1) return false;
        } else {
            return false;
        }
    }

    // Star rating
    if (rules.minStarRating != null && rules.minStarRating > 0) {
        const rating = getFileRating(item.path);
        if (rating < rules.minStarRating) return false;
    }

    // Name contains
    if (rules.nameContains) {
        if (!item.name.toLowerCase().includes(rules.nameContains.toLowerCase())) return false;
    }

    return true;
}

// Load a collection's contents into the grid (parallel to loadVideos for folders)
// Track loading state per collection to show sidebar spinners
const _collectionLoadingSet = new Set();

function setCollectionLoading(collectionId, loading) {
    if (loading) _collectionLoadingSet.add(collectionId);
    else _collectionLoadingSet.delete(collectionId);
    // Update the sidebar badge for this collection
    const badge = document.querySelector(`[data-col-count="${collectionId}"]`);
    if (badge) {
        if (loading) {
            badge.textContent = '';
            badge.classList.add('loading');
        } else {
            badge.classList.remove('loading');
        }
    }
}

// Monotonic token so stale loads don't clobber the grid
let _collectionLoadToken = 0;

async function loadCollectionIntoGrid(collectionId) {
    // Clear find-similar state (silent reset)
    if (findSimilarActive) {
        findSimilarActive = false;
        findSimilarEmbedding = null;
        findSimilarSourcePath = null;
        findSimilarPreviousItems = null;
        findSimilarPreviousFolder = null;
        const fsBanner = document.getElementById('find-similar-banner');
        if (fsBanner) fsBanner.classList.add('hidden');
    }
    const loadToken = ++_collectionLoadToken;
    stopPeriodicCleanup();
    activeDimensionHydrationToken++;

    // Cancel any background scan for this collection — foreground takes over
    cancelBackgroundScan(collectionId);

    setCollectionLoading(collectionId, true);
    const fgScanId = 'fgscan_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

    // Immediately update UI state so sidebar highlight and breadcrumb respond
    currentCollectionId = collectionId;
    currentFolderPath = null;
    highlightActiveCollection(collectionId);

    try {
        await yieldToEventLoop();
        window.electronAPI.triggerGC();

        const collection = await getCollection(collectionId);
        if (!collection) {
            showToast('Collection not found', 'error');
            return;
        }

        // Show collection name in breadcrumb right away (before data loads)
        updateBreadcrumbForCollection(collection);
        updateCurrentTab(null, collection.name);

        let items = [];
        let missingPaths = [];

        if (collection.type === 'smart') {
            const sourceFolders = collection.rules?.sourceFolders || [];
            if (sourceFolders.length === 0) {
                showToast('Smart collection has no source folders', 'warning');
                return;
            }

            // --- Cache-first: show cached results instantly, then background-refresh ---
            const cached = smartCollectionCache.get(collectionId);

            if (cached && cached.items && cached.items.length > 0) {
                // Render cached results immediately — near-instant load
                items = cached.items;
                currentItems = items;
                const filteredCached = filterItems(items);
                const sortedCached = sortItems(filteredCached);

                currentEmbeddings.clear();
                currentTextEmbedding = null;
                cancelEmbeddingScan();

                renderItems(sortedCached, null);
                updateBreadcrumbForCollection(collection);

                const badge = document.querySelector(`[data-col-count="${collectionId}"]`);
                if (badge) badge.textContent = items.filter(i => !i.missing).length;

                // Clear loading spinner — the grid is usable now
                setCollectionLoading(collectionId, false);

                const mediaItemCount = sortedCached.filter(i => i.type !== 'folder' && !i.missing).length;
                if (mediaItemCount > 0) {
                    setStatusActivity('Loading media...');
                    scheduleMediaLoadSettle();
                }
            }

            const hadCache = !!(cached && cached.items && cached.items.length > 0);

            // Check if rules need dimensions (aspect ratio, width, height)
            const needsDimensionFilter = !!(collection.rules?.aspectRatio || collection.rules?.width != null || collection.rules?.height != null);

            // Accumulate items progressively and render as they arrive (only if no cache shown)
            const progressiveItems = [];
            let progressRenderTimer = null;

            const scheduleProgressiveRender = () => {
                if (progressRenderTimer) return;
                progressRenderTimer = setTimeout(() => {
                    progressRenderTimer = null;
                    if (loadToken !== _collectionLoadToken) return;
                    currentItems = progressiveItems.slice();
                    const filtered = filterItems(currentItems);
                    const sorted = sortItems(filtered);
                    renderItems(sorted, null);
                }, 200);
            };

            let progressFileCount = 0;
            const progressHandler = (_event, progress) => {
                if (progress.scanId && progress.scanId !== fgScanId) return;
                if (loadToken !== _collectionLoadToken) return;
                if (progress.items) progressFileCount += progress.items.length;
                const itemLabel = collection.rules?.fileType === 'video' ? 'videos' : collection.rules?.fileType === 'image' ? 'images' : 'items';
                if (hadCache) {
                    setStatusActivity(`Refreshing... ${progress.foldersScanned}/${progress.totalFolders}`);
                } else {
                    setStatusActivity(`Scanning folders... ${progress.foldersScanned}/${progress.totalFolders} | ${progressFileCount} ${itemLabel}`);
                }

                // Progressive rendering only when no cache was shown and no AI query
                // (AI query requires embeddings which aren't available during streaming)
                if (!hadCache && !collection.rules?.aiQuery && progress.items && progress.items.length > 0) {
                    for (const item of progress.items) {
                        if (matchesSmartRules(item, collection.rules)) {
                            progressiveItems.push(item);
                        }
                    }
                    scheduleProgressiveRender();
                }
            };
            window.electronAPI.onSmartCollectionProgress(progressHandler);

            // Only request dimension scanning if rules actually filter by dimensions
            const result = await window.electronAPI.scanFoldersForSmartCollection(sourceFolders, {
                scanImageDimensions: needsDimensionFilter,
                scanVideoDimensions: needsDimensionFilter
            }, collection.rules, fgScanId);

            window.electronAPI.removeSmartCollectionProgressListener();
            if (progressRenderTimer) {
                clearTimeout(progressRenderTimer);
                progressRenderTimer = null;
            }

            // Bail if user navigated away during the async scan
            if (loadToken !== _collectionLoadToken) return;

            // Final render with full results (including dimension data)
            items = (result.items || []).filter(item => matchesSmartRules(item, collection.rules));

            // Update in-memory cache for instant re-opens
            smartCollectionCache.set(collectionId, { items, timestamp: Date.now() });
        } else {
            const collectionFiles = await getCollectionFiles(collectionId);
            const filePaths = collectionFiles.map(cf => cf.filePath);

            if (filePaths.length === 0) {
                if (loadToken !== _collectionLoadToken) return;
                currentItems = [];
                renderItems([], null);
                updateBreadcrumbForCollection(collection);
                return;
            }

            const result = await window.electronAPI.resolveFilePaths(filePaths, {
                scanImageDimensions: true,
                scanVideoDimensions: true
            });

            if (loadToken !== _collectionLoadToken) return;

            items = result.items || [];
            missingPaths = result.missing || [];

            for (const mp of missingPaths) {
                const name = mp.split(/[/\\]/).pop() || mp;
                items.push({
                    name, path: mp, url: '', type: 'image',
                    mtime: 0, size: 0, width: undefined, height: undefined, missing: true
                });
            }
        }

        // --- AI Content Search filtering ---
        const aiQuery = collection.rules?.aiQuery;
        if (aiQuery && collection.type === 'smart') {
            const aiThreshold = collection.rules.aiThreshold || 0.28;
            const mediaItems = items.filter(i => i.type !== 'folder' && !i.missing);
            // Keep a reference to all metadata-filtered items for background processing
            const allMetadataItems = items;

            if (mediaItems.length > 0) {
                // Ensure CLIP model is loaded
                let modelReady = false;
                try {
                    const status = await window.electronAPI.clipStatus();
                    if (status.loaded) {
                        modelReady = true;
                    } else if (aiVisualSearchEnabled && aiModelDownloadConfirmed) {
                        setStatusActivity('Loading AI model...');
                        const init = await window.electronAPI.clipInit();
                        modelReady = init.success;
                    }
                } catch { /* model unavailable */ }

                if (loadToken !== _collectionLoadToken) return;

                if (modelReady) {
                    // Generate text embedding for the AI query
                    setStatusActivity('AI search: loading cached results...');
                    let textEmb = null;
                    try {
                        const raw = await window.electronAPI.clipEmbedText(aiQuery);
                        textEmb = raw ? new Float32Array(raw) : null;
                    } catch { /* skip */ }

                    if (loadToken !== _collectionLoadToken) return;

                    if (textEmb) {
                        // --- Phase 1: Show results from cached embeddings immediately ---
                        const embeddingMap = new Map();
                        try {
                            const cached = await getCachedEmbeddings(mediaItems.map(i => ({ path: i.path, mtime: i.mtime || 0 })));
                            for (const [p, emb] of cached) embeddingMap.set(p, emb);
                        } catch { /* ignore */ }

                        if (loadToken !== _collectionLoadToken) return;

                        // Score cached items and show matches immediately
                        const uncached = mediaItems.filter(i => !embeddingMap.has(i.path));

                        if (embeddingMap.size > 0) {
                            const cachedScored = [];
                            for (const item of mediaItems) {
                                const emb = embeddingMap.get(item.path);
                                if (emb) {
                                    const sim = cosineSimilarity(textEmb, emb);
                                    if (sim >= aiThreshold) {
                                        item._aiScore = sim;
                                        cachedScored.push(item);
                                    }
                                }
                            }
                            cachedScored.sort((a, b) => (b._aiScore || 0) - (a._aiScore || 0));

                            // Render cached results right away
                            items = cachedScored;
                            currentItems = items;
                            renderItems(sortItems(filterItems(items)), null);
                            updateBreadcrumbForCollection(collection);
                            const badge = document.querySelector(`[data-col-count="${collectionId}"]`);
                            if (badge) badge.textContent = items.length;
                            setCollectionLoading(collectionId, false);

                            if (uncached.length > 0) {
                                setStatusActivity(`AI search: ${embeddingMap.size} cached | scanning ${uncached.length} new...`);
                            }
                        }

                        // --- Phase 2: Process uncached images in background ---
                        if (uncached.length > 0) {
                            const BATCH_SIZE = 20;
                            let done = 0;
                            let newMatchCount = 0;
                            let updateTimer = null;

                            const scheduleResultUpdate = () => {
                                if (updateTimer) return;
                                updateTimer = setTimeout(() => {
                                    updateTimer = null;
                                    if (loadToken !== _collectionLoadToken) return;
                                    // Re-score all items with updated embeddings
                                    const allScored = [];
                                    for (const item of allMetadataItems) {
                                        if (item.type === 'folder' || item.missing) continue;
                                        const emb = embeddingMap.get(item.path);
                                        if (emb) {
                                            const sim = cosineSimilarity(textEmb, emb);
                                            if (sim >= aiThreshold) {
                                                item._aiScore = sim;
                                                allScored.push(item);
                                            }
                                        }
                                    }
                                    allScored.sort((a, b) => (b._aiScore || 0) - (a._aiScore || 0));
                                    items = allScored;
                                    currentItems = items;
                                    renderItems(sortItems(filterItems(items)), null);
                                    const badge2 = document.querySelector(`[data-col-count="${collectionId}"]`);
                                    if (badge2) badge2.textContent = items.length;
                                }, 500);
                            };

                            for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
                                if (loadToken !== _collectionLoadToken) {
                                    if (updateTimer) clearTimeout(updateTimer);
                                    return;
                                }
                                setStatusActivity(`AI search: scanning ${done}/${uncached.length} new images...`);
                                const batch = uncached.slice(i, i + BATCH_SIZE);
                                try {
                                    const results = await window.electronAPI.clipEmbedImages(
                                        batch.map(item => ({ path: item.path, mtime: item.mtime || 0, thumbPath: null }))
                                    );
                                    const toCache = [];
                                    for (const r of results) {
                                        if (r && r.embedding) {
                                            const emb = new Float32Array(r.embedding);
                                            embeddingMap.set(r.path, emb);
                                            const item = mediaItems.find(m => m.path === r.path);
                                            toCache.push({ path: r.path, mtime: item ? (item.mtime || 0) : 0, embedding: r.embedding });
                                            // Check if this new embedding is a match
                                            const sim = cosineSimilarity(textEmb, emb);
                                            if (sim >= aiThreshold) newMatchCount++;
                                        }
                                    }
                                    if (toCache.length > 0) cacheEmbeddings(toCache).catch(() => {});
                                    done += batch.length;
                                } catch { done += batch.length; }

                                // Periodically update the grid with new matches
                                if (newMatchCount > 0) {
                                    scheduleResultUpdate();
                                    newMatchCount = 0;
                                }

                                if (i + BATCH_SIZE < uncached.length) {
                                    await new Promise(r => requestIdleCallback ? requestIdleCallback(r, { timeout: 200 }) : setTimeout(r, 50));
                                }
                            }

                            if (updateTimer) clearTimeout(updateTimer);
                            if (loadToken !== _collectionLoadToken) return;

                            // Final render with all embeddings
                            const finalScored = [];
                            for (const item of allMetadataItems) {
                                if (item.type === 'folder' || item.missing) continue;
                                const emb = embeddingMap.get(item.path);
                                if (emb) {
                                    const sim = cosineSimilarity(textEmb, emb);
                                    if (sim >= aiThreshold) {
                                        item._aiScore = sim;
                                        finalScored.push(item);
                                    }
                                }
                            }
                            finalScored.sort((a, b) => (b._aiScore || 0) - (a._aiScore || 0));
                            items = finalScored;
                        }

                        setStatusActivity('');
                    }
                } else if (aiQuery) {
                    showToast('AI Visual Search is not enabled — showing metadata-filtered results only', 'warning');
                }
            }
        }

        await yieldToEventLoop();
        if (loadToken !== _collectionLoadToken) return;

        currentItems = items;
        const filteredItems = filterItems(items);
        const sortedItems = sortItems(filteredItems);

        await yieldToEventLoop();
        if (loadToken !== _collectionLoadToken) return;

        currentEmbeddings.clear();
        currentTextEmbedding = null;
        cancelEmbeddingScan();
        _cancelIdlePreEmbedding();

        renderItems(sortedItems, null);
        updateBreadcrumbForCollection(collection);

        if (missingPaths.length > 0) {
            showToast(`${missingPaths.length} file(s) no longer exist`, 'warning');
        }

        const mediaItemCount = sortedItems.filter(i => i.type !== 'folder' && !i.missing).length;
        if (mediaItemCount > 0) {
            setStatusActivity('Loading media...');
            scheduleMediaLoadSettle();
        } else {
            setStatusActivity('');
        }

        // Update sidebar count badge now that we know the total
        const badge = document.querySelector(`[data-col-count="${collectionId}"]`);
        if (badge) badge.textContent = items.filter(i => !i.missing).length;

    } finally {
        setCollectionLoading(collectionId, false);
    }
}

// --- Background smart collection scanning ---
// Allows scanning/populating a smart collection without navigating to it.
// Results go into smartCollectionCache so the next navigation is instant.
const _bgScans = new Map(); // collectionId -> { scanId, abort: boolean }
let _bgScanRunning = false;
const _bgScanPending = []; // queued collectionId list

function cancelBackgroundScan(collectionId) {
    const entry = _bgScans.get(collectionId);
    if (entry) {
        entry.abort = true;
        _bgScans.delete(collectionId);
    }
}

async function backgroundScanSmartCollection(collectionId) {
    // Cancel any existing background scan for this collection
    cancelBackgroundScan(collectionId);

    // Queue if another background scan is already running
    if (_bgScanRunning) {
        // Remove any prior queue entry for this collection
        const idx = _bgScanPending.indexOf(collectionId);
        if (idx >= 0) _bgScanPending.splice(idx, 1);
        _bgScanPending.push(collectionId);
        return;
    }

    _bgScanRunning = true;
    const scanId = 'bgscan_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const scanState = { scanId, abort: false };
    _bgScans.set(collectionId, scanState);

    setCollectionLoading(collectionId, true);

    try {
        const collection = await getCollection(collectionId);
        if (!collection || collection.type !== 'smart' || scanState.abort) return;

        const sourceFolders = collection.rules?.sourceFolders || [];
        if (sourceFolders.length === 0) return;

        const needsDimensionFilter = !!(collection.rules?.aspectRatio || collection.rules?.width != null || collection.rules?.height != null);

        // Listen for progress events scoped to this scanId
        let progressCount = 0;
        const progressHandler = (_event, progress) => {
            if (progress.scanId !== scanId || scanState.abort) return;
            if (progress.items) progressCount += progress.items.length;
            // Update sidebar badge with running count
            const badge = document.querySelector(`[data-col-count="${collectionId}"]`);
            if (badge && progressCount > 0) {
                badge.textContent = progressCount;
            }
        };
        window.electronAPI.onSmartCollectionProgress(progressHandler);

        const result = await window.electronAPI.scanFoldersForSmartCollection(sourceFolders, {
            scanImageDimensions: needsDimensionFilter,
            scanVideoDimensions: needsDimensionFilter
        }, collection.rules, scanId);

        window.electronAPI.removeSmartCollectionProgressListener();

        if (scanState.abort) return;

        let items = (result.items || []).filter(item => matchesSmartRules(item, collection.rules));

        // --- Background AI Content Search ---
        const aiQuery = collection.rules?.aiQuery;
        if (aiQuery && items.length > 0) {
            const aiThreshold = collection.rules.aiThreshold || 0.28;
            const mediaItems = items.filter(i => i.type !== 'folder' && !i.missing);

            let modelReady = false;
            try {
                const status = await window.electronAPI.clipStatus();
                if (status.loaded) {
                    modelReady = true;
                } else if (aiVisualSearchEnabled && aiModelDownloadConfirmed) {
                    const init = await window.electronAPI.clipInit();
                    modelReady = init.success;
                }
            } catch { /* model unavailable */ }

            if (scanState.abort) return;

            if (modelReady && mediaItems.length > 0) {
                let textEmb = null;
                try {
                    const raw = await window.electronAPI.clipEmbedText(aiQuery);
                    textEmb = raw ? new Float32Array(raw) : null;
                } catch { /* skip */ }

                if (scanState.abort) return;

                if (textEmb) {
                    const embeddingMap = new Map();
                    try {
                        const cached = await getCachedEmbeddings(mediaItems.map(i => ({ path: i.path, mtime: i.mtime || 0 })));
                        for (const [p, emb] of cached) embeddingMap.set(p, emb);
                    } catch { /* ignore */ }

                    if (scanState.abort) return;

                    // Score cached items immediately
                    const scoredItems = [];
                    for (const item of mediaItems) {
                        const emb = embeddingMap.get(item.path);
                        if (emb) {
                            const sim = cosineSimilarity(textEmb, emb);
                            if (sim >= aiThreshold) {
                                item._aiScore = sim;
                                scoredItems.push(item);
                            }
                        }
                    }
                    scoredItems.sort((a, b) => (b._aiScore || 0) - (a._aiScore || 0));

                    // Cache partial AI results so navigation shows something fast
                    items = scoredItems;
                    smartCollectionCache.set(collectionId, { items, timestamp: Date.now() });

                    const badge = document.querySelector(`[data-col-count="${collectionId}"]`);
                    if (badge) badge.textContent = items.length;

                    if (currentCollectionId === collectionId) {
                        currentItems = items;
                        renderItems(sortItems(filterItems(items)), null);
                        updateBreadcrumbForCollection(collection);
                    }

                    // Process uncached images with smaller batches + generous yielding
                    const uncached = mediaItems.filter(i => !embeddingMap.has(i.path));
                    if (uncached.length > 0) {
                        const BG_BATCH_SIZE = 8;
                        let done = 0;
                        let newMatches = false;

                        for (let i = 0; i < uncached.length; i += BG_BATCH_SIZE) {
                            if (scanState.abort) return;

                            const batch = uncached.slice(i, i + BG_BATCH_SIZE);
                            try {
                                const results = await window.electronAPI.clipEmbedImages(
                                    batch.map(item => ({ path: item.path, mtime: item.mtime || 0, thumbPath: null }))
                                );
                                const toCache = [];
                                for (const r of results) {
                                    if (r && r.embedding) {
                                        const emb = new Float32Array(r.embedding);
                                        embeddingMap.set(r.path, emb);
                                        const item = mediaItems.find(m => m.path === r.path);
                                        toCache.push({ path: r.path, mtime: item ? (item.mtime || 0) : 0, embedding: r.embedding });
                                        const sim = cosineSimilarity(textEmb, emb);
                                        if (sim >= aiThreshold) newMatches = true;
                                    }
                                }
                                if (toCache.length > 0) cacheEmbeddings(toCache).catch(() => {});
                                done += batch.length;
                            } catch { done += batch.length; }

                            // Update sidebar badge periodically
                            if (newMatches) {
                                const allScored = [];
                                for (const item of mediaItems) {
                                    const emb = embeddingMap.get(item.path);
                                    if (emb) {
                                        const sim = cosineSimilarity(textEmb, emb);
                                        if (sim >= aiThreshold) { item._aiScore = sim; allScored.push(item); }
                                    }
                                }
                                allScored.sort((a, b) => (b._aiScore || 0) - (a._aiScore || 0));
                                items = allScored;
                                smartCollectionCache.set(collectionId, { items, timestamp: Date.now() });

                                const badge2 = document.querySelector(`[data-col-count="${collectionId}"]`);
                                if (badge2) badge2.textContent = items.length;

                                if (currentCollectionId === collectionId) {
                                    currentItems = items;
                                    renderItems(sortItems(filterItems(items)), null);
                                }
                                newMatches = false;
                            }

                            // Yield generously to keep the app responsive
                            if (i + BG_BATCH_SIZE < uncached.length) {
                                await new Promise(r => setTimeout(r, 150));
                            }
                        }

                        if (scanState.abort) return;

                        // Final scoring pass
                        const finalScored = [];
                        for (const item of mediaItems) {
                            const emb = embeddingMap.get(item.path);
                            if (emb) {
                                const sim = cosineSimilarity(textEmb, emb);
                                if (sim >= aiThreshold) { item._aiScore = sim; finalScored.push(item); }
                            }
                        }
                        finalScored.sort((a, b) => (b._aiScore || 0) - (a._aiScore || 0));
                        items = finalScored;
                    }
                }
            }
        }

        smartCollectionCache.set(collectionId, { items, timestamp: Date.now() });

        // Update sidebar badge with final count
        const badge = document.querySelector(`[data-col-count="${collectionId}"]`);
        if (badge) badge.textContent = items.filter(i => !i.missing).length;

        // If user navigated to this collection during the scan, render results
        if (currentCollectionId === collectionId) {
            currentItems = items;
            const filtered = filterItems(items);
            const sorted = sortItems(filtered);
            renderItems(sorted, null);
            updateBreadcrumbForCollection(collection);
        }
    } finally {
        _bgScans.delete(collectionId);
        setCollectionLoading(collectionId, false);
        _bgScanRunning = false;

        // Process next queued scan
        if (_bgScanPending.length > 0) {
            const nextId = _bgScanPending.shift();
            backgroundScanSmartCollection(nextId);
        }
    }
}

function updateBreadcrumbForCollection(collection) {
    const hasAi = collection.type === 'smart' && collection.rules?.aiQuery;
    const icon = hasAi ? '\u2726' : collection.type === 'smart' ? '\u2606' : '\u25A6'; // sparkle, star, or square
    const breadcrumbContainer = document.getElementById('breadcrumb-container');
    breadcrumbContainer.innerHTML = '';
    const pathSpan = document.createElement('span');
    pathSpan.id = 'current-path';
    pathSpan.className = 'breadcrumb-editable';
    pathSpan.textContent = icon + ' ' + collection.name;
    breadcrumbContainer.appendChild(pathSpan);
    currentPathSpan = pathSpan;

    // Show rule chips for smart collections
    if (collection.type === 'smart' && collection.rules) {
        const rules = collection.rules;
        const chips = [];
        if (rules.fileType && rules.fileType !== 'all') chips.push(rules.fileType === 'video' ? 'Video' : 'Image');
        if (rules.nameContains) chips.push(`"${rules.nameContains}"`);
        if (rules.aspectRatio) chips.push(rules.aspectRatio);
        if (rules.width != null) chips.push(`W: ${rules.width}px`);
        if (rules.height != null) chips.push(`H: ${rules.height}px`);
        if (rules.sizeValue != null && rules.sizeOperator) chips.push(`${rules.sizeOperator} ${rules.sizeValue} MB`);
        if (rules.minStarRating != null && rules.minStarRating > 0) chips.push('\u2605'.repeat(rules.minStarRating) + '+');
        if (rules.dateFrom != null || rules.dateTo != null) {
            const fmt = ts => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
            if (rules.dateFrom && rules.dateTo) chips.push(fmt(rules.dateFrom) + ' \u2013 ' + fmt(rules.dateTo));
            else if (rules.dateFrom) chips.push('After ' + fmt(rules.dateFrom));
            else chips.push('Before ' + fmt(rules.dateTo));
        }
        if (rules.sourceFolders?.length) {
            const names = rules.sourceFolders.map(f => typeof f === 'string' ? f.split(/[\\/]/).pop() : (f.name || f.path?.split(/[\\/]/).pop() || ''));
            chips.push(names.length === 1 ? names[0] : `${names.length} folders`);
        }
        if (rules.aiQuery) chips.push('\u2726 ' + rules.aiQuery);

        if (chips.length) {
            const rulesWrap = document.createElement('span');
            rulesWrap.className = 'collection-rule-chips';
            for (const text of chips) {
                const chip = document.createElement('span');
                chip.className = 'collection-rule-chip';
                chip.textContent = text;
                rulesWrap.appendChild(chip);
            }
            breadcrumbContainer.appendChild(rulesWrap);
        }
    }

    breadcrumbContainer.appendChild(itemCountEl);
    const validCount = currentItems.filter(i => !i.missing).length;
    const missingCount = currentItems.filter(i => i.missing).length;
    itemCountEl.textContent = `${validCount} items` + (missingCount > 0 ? ` (${missingCount} missing)` : '');
}

function highlightActiveCollection(collectionId) {
    // Remove active class from all collection items and sidebar tree items
    document.querySelectorAll('.collection-item.active').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.sidebar-tree .tree-item.active').forEach(el => el.classList.remove('active'));
    if (collectionId) {
        const el = document.querySelector(`.collection-item[data-collection-id="${collectionId}"]`);
        if (el) el.classList.add('active');
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

/**
 * Look up cached embeddings for a batch of files.
 * @param {Array<{path: string, mtime: number}>} files
 * @returns {Promise<Map<string, Float32Array>>}
 */
async function getCachedEmbeddings(files) {
    const result = new Map();
    if (!db || files.length === 0) return result;
    try {
        // For large sets, use cursor scan (one pass) instead of N individual gets
        if (files.length > 500) {
            const keyToPath = new Map();
            for (const f of files) {
                keyToPath.set(`${f.path}|${f.mtime || 0}|${EMBEDDING_VERSION}`, f.path);
            }
            const transaction = db.transaction([EMBEDDING_STORE], 'readonly');
            const store = transaction.objectStore(EMBEDDING_STORE);
            await new Promise((resolve, reject) => {
                const req = store.openCursor();
                req.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (!cursor) { resolve(); return; }
                    const record = cursor.value;
                    if (record && record.embedding && keyToPath.has(record.key)) {
                        result.set(keyToPath.get(record.key), new Float32Array(record.embedding));
                    }
                    cursor.continue();
                };
                req.onerror = () => resolve();
            });
        } else {
            const transaction = db.transaction([EMBEDDING_STORE], 'readonly');
            const store = transaction.objectStore(EMBEDDING_STORE);
            const promises = files.map(f => {
                const key = `${f.path}|${f.mtime || 0}|${EMBEDDING_VERSION}`;
                return new Promise(resolve => {
                    const req = store.get(key);
                    req.onsuccess = () => {
                        if (req.result && req.result.embedding) {
                            result.set(f.path, new Float32Array(req.result.embedding));
                        }
                        resolve();
                    };
                    req.onerror = () => resolve();
                });
            });
            await Promise.all(promises);
        }
    } catch {
        // Ignore — embeddings will just be re-computed
    }
    return result;
}

/**
 * Store embeddings for a batch of files.
 * @param {Array<{path: string, mtime: number, embedding: number[]}>} entries
 */
async function cacheEmbeddings(entries) {
    if (!db || entries.length === 0) return;
    try {
        const transaction = db.transaction([EMBEDDING_STORE], 'readwrite');
        const store = transaction.objectStore(EMBEDDING_STORE);
        for (const e of entries) {
            if (e.embedding) {
                store.put({
                    key: `${e.path}|${e.mtime || 0}|${EMBEDDING_VERSION}`,
                    embedding: Array.from(e.embedding)
                });
            }
        }
    } catch {
        // Ignore — caching is best-effort
    }
}

/**
 * Retrieve ALL cached embeddings from IndexedDB (across all folders).
 * Used by "Find Similar - All Folders" to search the full embedding index.
 * @returns {Promise<Map<string, {embedding: Float32Array, mtime: number}>>}
 */
async function getAllCachedEmbeddings() {
    const result = new Map();
    if (!db) return result;
    try {
        const transaction = db.transaction([EMBEDDING_STORE], 'readonly');
        const store = transaction.objectStore(EMBEDDING_STORE);
        await new Promise((resolve) => {
            const req = store.openCursor();
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (!cursor) { resolve(); return; }
                const record = cursor.value;
                if (record && record.embedding && record.key) {
                    const lastPipe = record.key.lastIndexOf('|');
                    const version = record.key.substring(lastPipe + 1);
                    if (version === EMBEDDING_VERSION) {
                        const rest = record.key.substring(0, lastPipe);
                        const mtimePipe = rest.lastIndexOf('|');
                        const path = rest.substring(0, mtimePipe);
                        const mtime = parseInt(rest.substring(mtimePipe + 1), 10);
                        result.set(path, {
                            embedding: l2Normalize(new Float32Array(record.embedding)),
                            mtime
                        });
                    }
                }
                cursor.continue();
            };
            req.onerror = () => resolve();
        });
    } catch { /* best-effort */ }
    return result;
}

/**
 * Clear all stored embeddings (e.g. when user changes settings or clears cache).
 */
async function clearEmbeddingCache() {
    if (!db) return;
    try {
        const transaction = db.transaction([EMBEDDING_STORE], 'readwrite');
        transaction.objectStore(EMBEDDING_STORE).clear();
    } catch {
        // Ignore
    }
}

// ============================================================================
// FIND SIMILAR (Reverse Image Search)
// ============================================================================

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
            if (!status.loaded) {
                const init = await window.electronAPI.clipInit();
                if (!init.success) {
                    showToast('Could not load AI model', 'error');
                    return;
                }
            }
            // Find mtime for the source file
            const sourceItem = currentItems.find(i => i.path === filePath);
            const mtime = sourceItem ? (sourceItem.mtime || 0) : 0;
            const results = await window.electronAPI.clipEmbedImages([{ path: filePath, mtime, thumbPath: null }]);
            if (results && results.length > 0 && results[0].embedding) {
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

    findSimilarActive = true;
    findSimilarEmbedding = embedding;
    findSimilarSourcePath = filePath;

    // Show banner
    const banner = document.getElementById('find-similar-banner');
    const sourceNameEl = document.getElementById('find-similar-source-name');
    const thresholdSlider = document.getElementById('find-similar-threshold');
    const thresholdValue = document.getElementById('find-similar-threshold-value');
    const allFoldersCheckbox = document.getElementById('find-similar-all-folders');

    if (sourceNameEl) sourceNameEl.textContent = fileName || filePath.split(/[/\\]/).pop();
    if (thresholdSlider) {
        thresholdSlider.value = Math.round(findSimilarThreshold * 100);
        thresholdValue.textContent = findSimilarThreshold.toFixed(2);
    }
    if (allFoldersCheckbox) allFoldersCheckbox.checked = findSimilarAllFolders;
    if (banner) banner.classList.remove('hidden');

    // Highlight source card
    const sourceCard = gridContainer.querySelector(`[data-path="${CSS.escape(filePath)}"]`);
    if (sourceCard) sourceCard.classList.add('find-similar-source');

    if (findSimilarAllFolders) {
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
    if (!findSimilarEmbedding) return;

    showToast('Searching across all indexed folders...', 'info', { duration: 2000 });

    const allEmbeddings = await getAllCachedEmbeddings();

    if (allEmbeddings.size === 0) {
        showToast('No indexed folders found. Visit folders with AI search enabled to build the index.', 'info', { duration: 5000 });
        return;
    }

    // Compute similarities
    const matches = [];
    for (const [path, data] of allEmbeddings) {
        if (path === findSimilarSourcePath) continue; // Skip source
        const sim = cosineSimilarity(findSimilarEmbedding, data.embedding);
        if (sim >= findSimilarThreshold) {
            matches.push({ path, mtime: data.mtime, score: sim });
        }
    }

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);

    // Stash current state for restore
    if (!findSimilarPreviousItems) {
        findSimilarPreviousItems = currentItems.slice();
        findSimilarPreviousFolder = currentFolderPath;
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

    currentEmbeddings.clear();
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

    if (findSimilarAllFolders) {
        countEl.textContent = `${currentItems.length} result${currentItems.length !== 1 ? 's' : ''}`;
    } else {
        // Count items that pass the similarity filter in current folder
        let count = 0;
        for (const item of currentItems) {
            if (item.type === 'folder') continue;
            const emb = currentEmbeddings.get(item.path);
            if (!emb) continue;
            const sim = cosineSimilarity(findSimilarEmbedding, emb);
            if (sim >= findSimilarThreshold) count++;
        }
        countEl.textContent = `${count} result${count !== 1 ? 's' : ''}`;
    }
}

/**
 * Clear the "Find Similar" filter and restore previous view.
 */
function clearFindSimilar() {
    const wasAllFolders = findSimilarAllFolders;

    // Remove source card highlight
    const sourceCard = gridContainer.querySelector('.find-similar-source');
    if (sourceCard) sourceCard.classList.remove('find-similar-source');

    // Reset state
    findSimilarActive = false;
    findSimilarEmbedding = null;
    findSimilarSourcePath = null;

    // Hide banner
    const banner = document.getElementById('find-similar-banner');
    if (banner) banner.classList.add('hidden');
    const countEl = document.getElementById('find-similar-count');
    if (countEl) countEl.textContent = '';

    if (wasAllFolders && findSimilarPreviousItems) {
        // Restore previous view
        currentItems = findSimilarPreviousItems;
        currentFolderPath = findSimilarPreviousFolder;
        findSimilarPreviousItems = null;
        findSimilarPreviousFolder = null;

        if (currentFolderPath) {
            // Re-render the previous folder
            const st = gridContainer.scrollTop;
            loadVideos(currentFolderPath, true, st);
        } else {
            renderItems(currentItems, null);
        }
    } else {
        findSimilarPreviousItems = null;
        findSimilarPreviousFolder = null;
        applyFilters();
    }
}

// ============================================================================
// END FIND SIMILAR
// ============================================================================

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
    if (!vsEnabled || layoutMode !== 'masonry') return;
    if (vsDimensionRecalcRafId !== null) return;

    vsDimensionRecalcRafId = requestAnimationFrame(() => {
        vsDimensionRecalcRafId = null;
        // Force a full position rebuild so updated dimensions are reflected.
        vsLayoutCache.itemCount = 0;
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

    for (const [itemIdx, card] of vsActiveCards) {
        const item = vsSortedItems[itemIdx];
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

        const results = await window.electronAPI.scanFileDimensions(
            chunk.map(item => ({ path: item.path, isImage: item.type === 'image' }))
        );
        if (scanToken !== activeDimensionHydrationToken || currentFolderPath !== folderPath) return;

        const updatedPaths = new Set();
        for (const result of results || []) {
            if (!result || !result.path || !result.width || !result.height) continue;
            const item = chunk.find(entry => entry.path === result.path);
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
                applyFilters();
            } else {
                vsLayoutCache.itemCount = 0; // Invalidate cache so new dimensions are used
                vsRecalculate();
            }
        }

        await yieldToEventLoop();
    }

    if (cacheEntries.length > 0) {
        cacheDimensions(cacheEntries).catch(() => {});
        storeFolderInIndexedDB(folderPath, items).catch(() => {});
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
});

// Load plugin manifests for context menu contributions
let _pluginMenuItems = null; // lazily populated
async function getPluginMenuItems() {
    if (_pluginMenuItems !== null) return _pluginMenuItems;
    try {
        const manifests = await window.electronAPI.getPluginManifests();
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
        _pluginMenuItems = [];
    }
    return _pluginMenuItems;
}

// Normalize path for consistent cache lookups (handle Windows path variations)
const _normalizeCache = new Map();
function normalizePath(path) {
    if (!path) return path;
    let result = _normalizeCache.get(path);
    if (result !== undefined) return result;
    result = path.replace(/\\/g, '/').replace(/\/+$/, '') || path;
    _normalizeCache.set(path, result);
    if (_normalizeCache.size > 20000) _normalizeCache.clear();
    return result;
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
    node.dataset.depth = depth;
    if (isDrive) node.dataset.drive = '1';

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
        hideContextMenu();
        if (e.target.closest('.tree-toggle') && (item.hasChildren !== false || isDrive)) {
            toggleTreeNode(node, depth, isDrive);
        } else {
            navigateToFolder(item.path);
        }
    });

    // Middle-click opens folder in new tab
    row.addEventListener('mousedown', (e) => {
        if (e.button === 1) {
            e.preventDefault();
        }
    });
    row.addEventListener('auxclick', (e) => {
        if (e.button === 1) {
            e.preventDefault();
            e.stopPropagation();
            const displayName = item.path.split(/[/\\]/).pop();
            createTab(item.path, displayName);
        }
    });

    // Right-click context menu (reuse folder context menu)
    if (!isDrive) {
        row.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Create a lightweight proxy element so the existing folder context menu handler works
            const proxy = document.createElement('div');
            proxy.classList.add('folder-card');
            proxy.dataset.folderPath = item.path;
            showContextMenu(e, proxy);
        });
    }

    // Double-click toggle to expand
    toggle.addEventListener('dblclick', (e) => e.stopPropagation());

    return node;
}

/** Load or reload subdirectory rows under a tree node (used by expand and by FS watch refresh). */
async function loadTreeNodeChildren(node, depth, isDrive = false, { forceReload = false } = {}) {
    const children = node.querySelector('.tree-children');
    const toggle = node.querySelector('.tree-toggle');
    const nodePath = node.dataset.path;

    if (forceReload) {
        delete children.dataset.loaded;
        children.innerHTML = '';
        toggle.classList.remove('no-children');
    }

    if (children.dataset.loaded === '1') return;

    const loading = document.createElement('div');
    loading.className = 'tree-loading';
    loading.textContent = 'Loading...';
    children.appendChild(loading);

    try {
        const subdirs = await window.electronAPI.listSubdirectories(nodePath);
        children.innerHTML = '';
        children.dataset.loaded = '1';

        for (const subdir of subdirs) {
            const childNode = createTreeNode(subdir, depth + 1);
            children.appendChild(childNode);
            if (sidebarExpandedNodes.has(subdir.path)) {
                toggleTreeNode(childNode, depth + 1);
            }
        }
        if (subdirs.length === 0) {
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

    if (children.dataset.loaded === '1') return;

    await loadTreeNodeChildren(node, depth, isDrive);
}

/** Parent directory of a file system path (handles / and Windows roots). */
function sidebarParentDirPath(filePath) {
    if (!filePath) return null;
    const norm = filePath.replace(/\\/g, '/');
    const trimmed = norm.replace(/\/+$/, '');
    if (!trimmed) return null;
    const lastSlash = trimmed.lastIndexOf('/');
    if (lastSlash <= 0) {
        if (trimmed.startsWith('/') && trimmed.length > 1) return '/';
        if (/^[a-zA-Z]:$/.test(trimmed)) return null;
        if (/^[a-zA-Z]:\//.test(trimmed)) return trimmed.slice(0, 2) + '/';
        return null;
    }
    const parent = trimmed.slice(0, lastSlash) || '/';
    if (/^[a-zA-Z]:$/.test(parent)) return parent + '/';
    return parent;
}

window.sidebarParentDirPath = sidebarParentDirPath;

/**
 * When subfolders are added/removed on disk, reload the expanded tree node that lists them.
 * Called from folder-changed (addDir/unlinkDir) for paths under the watched folder.
 */
async function refreshSidebarTreeBranchForParentPath(parentPath) {
    if (!parentPath || !sidebarTree) return;
    const target = sidebarNormalize(parentPath);

    for (const node of sidebarTree.querySelectorAll('.tree-node')) {
        if (sidebarNormalize(node.dataset.path) !== target) continue;
        const children = node.querySelector('.tree-children');
        if (!children.classList.contains('expanded')) return;

        const depth = parseInt(node.dataset.depth, 10) || 0;
        const isDrive = node.dataset.drive === '1';
        await loadTreeNodeChildren(node, depth, isDrive, { forceReload: true });
        return;
    }
}

window.refreshSidebarTreeBranchForParentPath = refreshSidebarTreeBranchForParentPath;

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

    let _resizeRafPending = false;
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        if (_resizeRafPending) return;
        _resizeRafPending = true;
        const clientX = e.clientX;
        requestAnimationFrame(() => {
            _resizeRafPending = false;
            const newWidth = Math.min(sidebarMaxWidthSetting, Math.max(sidebarMinWidthSetting, clientX));
            folderSidebar.style.width = newWidth + 'px';
            sidebarWidth = newWidth;
        });
    });

    document.addEventListener('mouseup', () => {
        if (!isResizing) return;
        isResizing = false;
        sidebarResizeHandle.classList.remove('active');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        deferLocalStorageWrite('sidebarWidth', sidebarWidth.toString());
        // Recalculate grid layout after resize
        if (layoutMode === 'masonry') {
            scheduleMasonryLayout();
        } else {
            vsRecalculate();
        }
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

    // Recalculate grid layout after sidebar transition completes
    folderSidebar.addEventListener('transitionend', function onEnd(e) {
        if (e.propertyName === 'width') {
            folderSidebar.removeEventListener('transitionend', onEnd);
            if (layoutMode === 'masonry') {
                scheduleMasonryLayout();
            } else {
                vsRecalculate();
            }
        }
    });
}

async function initSidebar() {
    if (!folderSidebar || !sidebarTree) return;

    // Don't restore previous expanded state — start fresh, only the active folder will be expanded
    sidebarExpandedNodes.clear();
    saveSidebarExpandedNodes();

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

// Lightbox Elements
const lightbox = document.getElementById('lightbox');
const lightboxVideo = document.getElementById('lightbox-video');
const lightboxImage = document.getElementById('lightbox-image');
const lightboxGifCanvas = document.getElementById('lightbox-gif-canvas');
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

function invalidateScrollCaches() {
    cachedViewportBounds = null;
    viewportBoundsCacheTime = 0;
    cardRectCacheGeneration++;
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
    if (cleanupScrollListenerAttached || vsEnabled) return;
    gridContainer.addEventListener('scroll', handleGridScroll, { passive: true });
    cleanupScrollListenerAttached = true;
}

function performCleanupCheck() {
    const perfStart = perfTest.start();

    // Use vsActiveCards when virtual scrolling is active (avoids full DOM traversal)
    const cardSource = vsEnabled ? Array.from(vsActiveCards.values()) : Array.from(gridContainer.querySelectorAll('.video-card'));
    if (cardSource.length === 0) {
        perfTest.end('performCleanupCheck', perfStart, { cardCount: 0, detail: 'empty' });
        return;
    }

    let cleaned = false;

    // Calculate viewport bounds with a buffer zone for cleanup
    // Media outside this buffer zone will be cleaned up aggressively
    // Use same buffer as PRELOAD_BUFFER_PX for consistency
    const viewportTop = -PRELOAD_BUFFER_PX;
    const viewportBottom = window.innerHeight + PRELOAD_BUFFER_PX;
    const viewportLeft = -PRELOAD_BUFFER_PX;
    const viewportRight = window.innerWidth + PRELOAD_BUFFER_PX

    // Build card → media map using cached _mediaEl reference (no DOM queries)
    const cardMediaMap = new Map();
    let allVideos = [];
    let allImages = [];
    for (const card of cardSource) {
        if (!card.classList.contains('video-card')) continue;
        const mediaEl = card._mediaEl;
        if (!mediaEl) continue;
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
        const videoRects = videoCards.map(card => getCachedCardRect(card));

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
        const mediaRects = mediaCards.map(card => getCachedCardRect(card));

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
            playPromise.catch(() => {});
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
                    const url = result && result.success && result.url ? result.url : null;
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
        .then(results => {
            for (let i = 0; i < batch.length; i++) {
                const r = results[i];
                const url = r && r.success && r.url ? r.url : null;
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
        .then(results => {
            const urls = results.filter(r => r.url).map(r => r.url);
            folderPreviewCache.set(folderPath, { urls, ts: Date.now() });
            // Cap cache size
            if (folderPreviewCache.size > 200) {
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
// Uses viewport coordinates since IntersectionObserver uses viewport as root
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

// --- Card metadata helpers (grid cards) ---
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
    if (cardInfoExtensionHoverRow) cardInfoExtensionHoverRow.style.display = cardInfoSettings.extension ? '' : 'none';
    if (cardInfoResolutionHoverLabel) cardInfoResolutionHoverLabel.textContent = cardInfoSettings.resolutionOnlyOnHover ? 'On' : 'Off';
    if (cardInfoResolutionHoverRow) cardInfoResolutionHoverRow.style.display = cardInfoSettings.resolution ? '' : 'none';
    if (cardInfoSizeHoverLabel) cardInfoSizeHoverLabel.textContent = cardInfoSettings.fileSizeOnlyOnHover ? 'On' : 'Off';
    if (cardInfoSizeHoverRow) cardInfoSizeHoverRow.style.display = cardInfoSettings.fileSize ? '' : 'none';
    if (cardInfoDateHoverLabel) cardInfoDateHoverLabel.textContent = cardInfoSettings.dateOnlyOnHover ? 'On' : 'Off';
    if (cardInfoDateHoverRow) cardInfoDateHoverRow.style.display = cardInfoSettings.date ? '' : 'none';
    if (cardInfoStarsHoverLabel) cardInfoStarsHoverLabel.textContent = cardInfoSettings.starRatingOnlyOnHover ? 'On' : 'Off';
    if (cardInfoStarsHoverRow) cardInfoStarsHoverRow.style.display = cardInfoSettings.starRating ? '' : 'none';
    if (cardInfoAudioHoverLabel) cardInfoAudioHoverLabel.textContent = cardInfoSettings.audioLabelOnlyOnHover ? 'On' : 'Off';
    if (cardInfoAudioHoverRow) cardInfoAudioHoverRow.style.display = cardInfoSettings.audioLabel ? '' : 'none';
    if (cardInfoFilenameHoverLabel) cardInfoFilenameHoverLabel.textContent = cardInfoSettings.filenameOnlyOnHover ? 'On' : 'Off';
    if (cardInfoFilenameHoverRow) cardInfoFilenameHoverRow.style.display = cardInfoSettings.filename ? '' : 'none';
    if (cardInfoTagsHoverLabel) cardInfoTagsHoverLabel.textContent = cardInfoSettings.tagsOnlyOnHover ? 'On' : 'Off';
    if (cardInfoTagsHoverRow) cardInfoTagsHoverRow.style.display = cardInfoSettings.tags ? '' : 'none';
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
    if (typeof card._vsItemIndex === 'number' && vsSortedItems[card._vsItemIndex]) {
        const it = vsSortedItems[card._vsItemIndex];
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
    const cards = vsEnabled && vsActiveCards.size > 0
        ? Array.from(vsActiveCards.values())
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

        // Toggle extension label visibility
        const extLabel = card.querySelector('.extension-label');
        if (extLabel) extLabel.style.display = cardInfoSettings.extension ? '' : 'none';

        // Toggle audio/sound label visibility
        const sndLabel = card.querySelector('.sound-label');
        if (sndLabel) sndLabel.style.display = cardInfoSettings.audioLabel ? '' : 'none';

        // Toggle filename visibility
        const infoEl = card.querySelector('.video-info');
        if (infoEl) infoEl.style.display = cardInfoSettings.filename ? '' : 'none';

        // Toggle tag badges visibility
        const tagContainer = card.querySelector('.card-tags');
        if (tagContainer) tagContainer.style.display = cardInfoSettings.tags ? '' : 'none';

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

    // With virtual scrolling, recalculate positions for new layout mode
    if (vsEnabled) {
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
        filtered = filtered.filter(item => item.type === 'video');
    } else if (currentFilter === 'image') {
        filtered = filtered.filter(item => item.type === 'image');
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

// Function to sort items based on current sorting preferences
function sortItems(items) {
    // Separate folders and files (single pass)
    const folders = [], files = [];
    for (const item of items) (item.type === 'folder' ? folders : files).push(item);
    
    // Sort folders
    folders.sort((a, b) => {
        let comparison = 0;
        if (sortType === 'name') {
            comparison = a.name.localeCompare(b.name, undefined, { numeric: true });
        } else if (sortType === 'date') {
            // Use mtime if available, otherwise fall back to name
            const aTime = a.mtime || 0;
            const bTime = b.mtime || 0;
            comparison = aTime - bTime;
            // If times are equal or missing, fall back to name
            if (comparison === 0) {
                comparison = a.name.localeCompare(b.name, undefined, { numeric: true });
            }
        }
        return sortOrder === 'ascending' ? comparison : -comparison;
    });
    
    // Sort files
    files.sort((a, b) => {
        let comparison = 0;
        if ((starFilterActive && starSortOrder !== 'none') || sortType === 'rating') {
            // Sort by rating using starSortOrder (or desc for sortType=rating)
            const aRating = getFileRating(a.path);
            const bRating = getFileRating(b.path);
            const order = starSortOrder !== 'none' ? starSortOrder : 'desc';
            comparison = order === 'asc' ? aRating - bRating : bRating - aRating;
            if (comparison === 0) {
                comparison = a.name.localeCompare(b.name, undefined, { numeric: true });
            }
            return comparison;
        } else if (sortType === 'name') {
            comparison = a.name.localeCompare(b.name, undefined, { numeric: true });
        } else if (sortType === 'date') {
            const aTime = a.mtime || 0;
            const bTime = b.mtime || 0;
            comparison = aTime - bTime;
            if (comparison === 0) {
                comparison = a.name.localeCompare(b.name, undefined, { numeric: true });
            }
        } else if (sortType === 'size') {
            const aSize = a.size || 0;
            const bSize = b.size || 0;
            comparison = aSize - bSize;
            if (comparison === 0) comparison = a.name.localeCompare(b.name, undefined, { numeric: true });
        } else if (sortType === 'dimensions') {
            const aPixels = (a.width || 0) * (a.height || 0);
            const bPixels = (b.width || 0) * (b.height || 0);
            comparison = aPixels - bPixels;
            if (comparison === 0) comparison = a.name.localeCompare(b.name, undefined, { numeric: true });
        }
        return sortOrder === 'ascending' ? comparison : -comparison;
    });

    // Partition pinned items to top of each group (single pass)
    const pinnedFolders = [], unpinnedFolders = [];
    for (const f of folders) (isFilePinned(f.path) ? pinnedFolders : unpinnedFolders).push(f);
    const pinnedFiles = [], unpinnedFiles = [];
    for (const f of files) (isFilePinned(f.path) ? pinnedFiles : unpinnedFiles).push(f);

    const allFiles = pinnedFiles.concat(unpinnedFiles);

    if (groupByDate && allFiles.length > 0) {
        vsGroupHeadersPresent = true;
        return [...pinnedFolders, ...unpinnedFolders, ...injectDateGroupHeaders(allFiles)];
    }
    vsGroupHeadersPresent = false;
    return pinnedFolders.concat(unpinnedFolders, allFiles);
}

// Function to apply sorting and reload current folder
function applySorting() {
    if (currentFolderPath && currentItems.length > 0) {
        const previousScrollTop = gridContainer.scrollTop;
        // If sorting by date but items lack mtime (were loaded with skipStats),
        // reload from backend to get file stats
        const needsStats = (sortType === 'date' || groupByDate) && currentItems.some(item => item.type !== 'folder' && !item.mtime);
        if (needsStats) {
            loadVideos(currentFolderPath, false, previousScrollTop);
            return;
        }
        // Filter items based on current filter, then sort and render
        const filteredItems = filterItems(currentItems);
        const sortedItems = sortItems(filteredItems);
        renderItems(sortedItems, previousScrollTop);
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
        info.textContent = item.name;

        if (!cardInfoSettings.extension) extensionLabel.style.display = 'none';
        card.appendChild(extensionLabel);

        syncStarRatingOnCard(card, item.path);
        syncPinIndicator(card, item.path);
        syncCardMetaRow(card, item, null);

        if (!cardInfoSettings.filename) info.style.display = 'none';
        card.appendChild(info);

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
        
        // Use viewport bounds (consistent with IntersectionObserver root: null)
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

    // Clear container
    while (gridContainer.firstChild) {
        gridContainer.removeChild(gridContainer.firstChild);
    }
    currentHoveredCard = null;
    focusedCardIndex = -1;
    gridContainer.classList.remove('masonry');
    gridContainer.classList.remove('grid');

    if (items.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'grid-empty-state';
        if (currentCollectionId) {
            const collection = collectionsCache.find(c => c.id === currentCollectionId);
            const isSmart = collection && collection.type === 'smart';
            emptyDiv.innerHTML = `
                <p class="grid-empty-title">This collection is empty</p>
                <p class="grid-empty-hint">${isSmart
                    ? 'Try editing the filter rules or adding more source folders.'
                    : 'Drag files here or right-click files to add them.'}</p>
            `;
        } else if (searchBox.value.trim() || currentFilter !== 'all') {
            const searchTerm = searchBox.value.trim();
            const filterLabel = currentFilter !== 'all' ? ` in "${currentFilter}" filter` : '';
            emptyDiv.innerHTML = `
                <p class="grid-empty-title">No results found</p>
                <p class="grid-empty-hint">${searchTerm
                    ? `No files match "${searchTerm}"${filterLabel}. Try a different search term or clear filters.`
                    : `No files match the current filter. Try showing all files.`}</p>
            `;
        } else {
            emptyDiv.innerHTML = '<p class="grid-empty-title">No folders or supported media found.</p>';
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

function toggleSettingsModal() {
    settingsModal.classList.toggle('hidden');
}

function closeSettingsModal() {
    settingsModal.classList.add('hidden');
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
    if (fileSize > 104857600) {
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
        // After decoding, force Chrome to paint the image. Without this,
        // the compositor can defer painting indefinitely during scroll.
        img.decode().then(() => {
            if (img.isConnected) img.offsetHeight;
        }).catch(() => {});
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
                setImageSource(url || imageUrl, url ? 'thumb' : 'original');
            })
            .catch(() => {
                if (!img.isConnected) return;
                setImageSource(imageUrl, 'original');
            })
            .finally(() => {
                pendingMediaCreations.delete(card);
            });
    } else {
        setImageSource(imageUrl, 'original');
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
// Using viewport (null) as root. gridContainer is the scroll container but
// root:null works because absolutely-positioned cards' viewport rects naturally
// reflect their scroll position. rootMargin expands the viewport detection zone.
const observerOptions = {
    root: null,
    rootMargin: `${PRELOAD_BUFFER_PX}px ${PRELOAD_BUFFER_PX}px ${PRELOAD_BUFFER_PX}px ${PRELOAD_BUFFER_PX}px`,
    threshold: 0.0
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
        // With virtual scrolling, vsSortedItems contains the filtered set
        const visible = vsEnabled ? vsSortedItems.length : (() => {
            const cards = gridContainer.querySelectorAll('.video-card, .folder-card');
            return Array.from(cards).filter(c => c.style.display !== 'none').length;
        })();
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
    const filterNames = { all: '', video: 'Videos', image: 'Images', audio: 'Audio' };
    const filterParts = [];
    if (currentFilter !== 'all') filterParts.push(filterNames[currentFilter] || currentFilter);
    if (starFilterActive) {
        const sortLabel = { none: 'Starred', desc: 'Starred ▼', asc: 'Starred ▲' };
        filterParts.push(sortLabel[starSortOrder] || 'Starred');
    }
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
 * Reorder items by visual similarity using a greedy nearest-neighbor traversal.
 * Folders are kept at the top; media is reordered so visually similar items are adjacent.
 */
function applyVisualClustering(items) {
    const folders = items.filter(i => i.type === 'folder');
    const media   = items.filter(i => i.type !== 'folder');
    const withEmb = media.filter(i => currentEmbeddings.has(i.path));
    const noEmb   = media.filter(i => !currentEmbeddings.has(i.path));

    if (withEmb.length < 2) return items;

    // Greedy nearest-neighbor: start from first item, repeatedly pick closest unvisited
    const visited = new Set();
    const ordered = [];
    let current = withEmb[0];
    visited.add(current.path);
    ordered.push(current);

    while (ordered.length < withEmb.length) {
        const curEmb = currentEmbeddings.get(current.path);
        let bestSim = -Infinity;
        let bestItem = null;
        for (const item of withEmb) {
            if (visited.has(item.path)) continue;
            const emb = currentEmbeddings.get(item.path);
            if (!emb) continue;
            const sim = cosineSimilarity(curEmb, emb);
            if (sim > bestSim) { bestSim = sim; bestItem = item; }
        }
        if (!bestItem) break;
        visited.add(bestItem.path);
        ordered.push(bestItem);
        current = bestItem;
    }

    return [...folders, ...ordered, ...noEmb];
}

function applyFilters() {
    const perfStart = perfTest.start();
    if (currentItems.length === 0) return;

    const query = searchBox.value.toLowerCase().trim();

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
            matchesFilter = item.type === 'video';
        } else if (currentFilter === 'image') {
            const isImage = item.type === 'image';
            if (isImage && !includeMovingImages) {
                const isMovingImage = fileName.endsWith('.gif') || fileName.endsWith('.webp');
                matchesFilter = !isMovingImage;
            } else {
                matchesFilter = isImage;
            }
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
        if (findSimilarActive && findSimilarEmbedding && !findSimilarAllFolders) {
            if (item.type === 'folder') return false;
            const emb = currentEmbeddings.get(item.path);
            if (!emb) return false;
            const sim = cosineSimilarity(findSimilarEmbedding, emb);
            item._similarityScore = sim;
            if (sim < findSimilarThreshold) return false;
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
    if (findSimilarActive && findSimilarEmbedding && !findSimilarAllFolders) {
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

    // Update virtual scrolling with filtered items
    if (vsEnabled) {
        vsUpdateItems(sortedFiltered, { preserveScroll: true });
    }
    updateItemCount();
    perfTest.end('applyFilters', perfStart, { cardCount: currentItems.length });
}

function performSearch(searchQuery) {
    // Debounce search to avoid excessive filtering while typing
    clearTimeout(filterDebounceTimer);
    const delay = (aiVisualSearchEnabled && aiSearchActive) ? 300 : 150;
    filterDebounceTimer = setTimeout(async () => {
        if (aiVisualSearchEnabled && aiSearchActive && searchQuery.trim()) {
            try {
                const embedding = await window.electronAPI.clipEmbedText(searchQuery.trim());
                currentTextEmbedding = embedding ? l2Normalize(new Float32Array(embedding)) : null;
            } catch {
                currentTextEmbedding = null;
            }
        } else {
            currentTextEmbedding = null;
        }
        applyFilters();
    }, delay);
}

// --- Delegated Event Handlers for Grid Cards ---
// Instead of attaching listeners to each card, delegate from gridContainer

let currentHoveredCard = null;

// ── Multi-select state ───────────────────────────────────────────────
const selectedCardPaths = new Set();
let lastSelectedCardIndex = -1; // index into vsSortedItems for shift-click range

// ── Marquee (drag-to-select) state ──────────────────────────────────
let marqueeActive = false;
let marqueePending = false;       // mousedown recorded, waiting for dead-zone
let marqueeStartClientX = 0;     // client coords at mousedown
let marqueeStartClientY = 0;
let marqueeStartContentX = 0;    // content coords (scroll-adjusted)
let marqueeStartContentY = 0;
let marqueeElement = null;        // the rectangle div
let marqueeCtrlHeld = false;
let marqueePreSelection = null;   // Set snapshot for Ctrl+drag
let marqueeRafId = null;
let marqueeJustFinished = false;
let marqueeAutoScrollId = null;

function clearCardSelection() {
    if (selectedCardPaths.size === 0) return;
    selectedCardPaths.clear();
    lastSelectedCardIndex = -1;
    document.querySelectorAll('.video-card.selected').forEach(c => c.classList.remove('selected'));
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
        const item = vsSortedItems[i];
        if (!item || item.type === 'folder') continue;
        selectedCardPaths.add(item.path);
    }
    // Update visible card DOM
    vsActiveCards.forEach((card) => {
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
        el.style.display = count > 0 ? '' : 'none';
    }
}

function getItemIndexForCard(card) {
    const path = card.dataset.path;
    if (!path) return -1;
    return vsSortedItems.findIndex(item => item.path === path);
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
    const x1 = Math.min(marqueeStartContentX, cur.x);
    const y1 = Math.min(marqueeStartContentY, cur.y);
    const x2 = Math.max(marqueeStartContentX, cur.x);
    const y2 = Math.max(marqueeStartContentY, cur.y);
    return { left: x1, top: y1, right: x2, bottom: y2 };
}

function marqueeUpdateRect(clientX, clientY) {
    if (!marqueeElement) return;
    const containerRect = gridContainer.getBoundingClientRect();
    const cur = marqueeClientToContent(clientX, clientY);
    // Position the div in content space (absolute inside grid-container)
    const x1 = Math.min(marqueeStartContentX, cur.x);
    const y1 = Math.min(marqueeStartContentY, cur.y);
    const x2 = Math.max(marqueeStartContentX, cur.x);
    const y2 = Math.max(marqueeStartContentY, cur.y);
    marqueeElement.style.left = x1 + 'px';
    marqueeElement.style.top = y1 + 'px';
    marqueeElement.style.width = (x2 - x1) + 'px';
    marqueeElement.style.height = (y2 - y1) + 'px';
}

function marqueeComputeSelection(clientX, clientY) {
    if (!vsPositions || !vsSortedItems.length) return;
    const sel = marqueeGetRect(clientX, clientY);
    const itemCount = vsSortedItems.length;

    // Rebuild selection
    selectedCardPaths.clear();
    if (marqueeCtrlHeld && marqueePreSelection) {
        for (const p of marqueePreSelection) selectedCardPaths.add(p);
    }

    // Binary search for first item whose bottom edge (top + height) >= sel.top
    let lo = 0, hi = itemCount - 1;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const midIdx = mid * 4;
        if (vsPositions[midIdx + 1] + vsPositions[midIdx + 3] < sel.top) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }

    // Iterate only items in the Y range of the marquee rectangle
    for (let i = lo; i < itemCount; i++) {
        const idx = i * 4;
        const cT = vsPositions[idx + 1];
        if (cT > sel.bottom) break; // Past the marquee — done

        const item = vsSortedItems[i];
        if (!item.path || item.type === 'folder' || item.type === 'group-header') continue;
        const cL = vsPositions[idx];
        const cR = cL + vsPositions[idx + 2];
        const cB = cT + vsPositions[idx + 3];
        if (!(sel.right < cL || sel.left > cR || sel.bottom < cT || sel.top > cB)) {
            selectedCardPaths.add(item.path);
        }
    }
    // Update visible card DOM
    vsActiveCards.forEach((card) => {
        if (card.dataset.path) {
            card.classList.toggle('selected', selectedCardPaths.has(card.dataset.path));
        }
    });
    updateSelectionStatusBar();
}

function marqueeStartAutoScroll(clientY) {
    if (marqueeAutoScrollId) return;
    const EDGE = 50, MAX_SPEED = 15;
    function step() {
        if (!marqueeActive) { marqueeAutoScrollId = null; return; }
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
        marqueeAutoScrollId = requestAnimationFrame(step);
    }
    marqueeAutoScrollId = requestAnimationFrame(step);
}

function marqueeStopAutoScroll() {
    if (marqueeAutoScrollId) {
        cancelAnimationFrame(marqueeAutoScrollId);
        marqueeAutoScrollId = null;
    }
}

function marqueeOnMouseMove(e) {
    if (!marqueePending && !marqueeActive) return;
    const dx = e.clientX - marqueeStartClientX;
    const dy = e.clientY - marqueeStartClientY;

    if (marqueePending) {
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return; // dead zone
        // Activate marquee
        marqueePending = false;
        marqueeActive = true;
        gridContainer.classList.add('marquee-dragging');
        marqueeElement = document.createElement('div');
        marqueeElement.className = 'marquee-selection-rect';
        gridContainer.appendChild(marqueeElement);
    }

    marqueeUpdateRect(e.clientX, e.clientY);

    // Auto-scroll near edges
    marqueeStopAutoScroll();
    const containerRect = gridContainer.getBoundingClientRect();
    if (e.clientY < containerRect.top + 50 || e.clientY > containerRect.bottom - 50) {
        marqueeStartAutoScroll(e.clientY);
    }

    // Throttle intersection via rAF
    if (!marqueeRafId) {
        const cx = e.clientX, cy = e.clientY;
        marqueeRafId = requestAnimationFrame(() => {
            marqueeRafId = null;
            if (marqueeActive) marqueeComputeSelection(cx, cy);
        });
    }
}

function marqueeOnMouseUp(e) {
    document.removeEventListener('mousemove', marqueeOnMouseMove);
    document.removeEventListener('mouseup', marqueeOnMouseUp);
    marqueeStopAutoScroll();

    if (marqueeActive) {
        marqueeComputeSelection(e.clientX, e.clientY);
        if (marqueeElement && marqueeElement.parentNode) {
            marqueeElement.remove();
        }
        marqueeElement = null;
        gridContainer.classList.remove('marquee-dragging');
        marqueeActive = false;
        if (marqueeRafId) { cancelAnimationFrame(marqueeRafId); marqueeRafId = null; }
        // Suppress the click event that follows mouseup
        marqueeJustFinished = true;
        requestAnimationFrame(() => { marqueeJustFinished = false; });
    }
    marqueePending = false;
    marqueePreSelection = null;
}

function cancelMarquee() {
    if (!marqueeActive && !marqueePending) return;
    document.removeEventListener('mousemove', marqueeOnMouseMove);
    document.removeEventListener('mouseup', marqueeOnMouseUp);
    marqueeStopAutoScroll();
    if (marqueeRafId) { cancelAnimationFrame(marqueeRafId); marqueeRafId = null; }
    if (marqueeElement && marqueeElement.parentNode) marqueeElement.remove();
    marqueeElement = null;
    gridContainer.classList.remove('marquee-dragging');
    // Restore pre-selection if Ctrl was held
    if (marqueeCtrlHeld && marqueePreSelection) {
        selectedCardPaths.clear();
        for (const p of marqueePreSelection) selectedCardPaths.add(p);
        vsActiveCards.forEach((card) => {
            if (card.dataset.path) {
                card.classList.toggle('selected', selectedCardPaths.has(card.dataset.path));
            }
        });
        updateSelectionStatusBar();
    }
    marqueeActive = false;
    marqueePending = false;
    marqueePreSelection = null;
}

gridContainer.addEventListener('click', (e) => {
    // Suppress click after marquee drag
    if (marqueeJustFinished) {
        marqueeJustFinished = false;
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
        marqueeCtrlHeld = e.ctrlKey || e.metaKey;
        if (marqueeCtrlHeld) {
            marqueePreSelection = new Set(selectedCardPaths);
        } else {
            clearCardSelection();
        }
        marqueeStartClientX = e.clientX;
        marqueeStartClientY = e.clientY;
        const content = marqueeClientToContent(e.clientX, e.clientY);
        marqueeStartContentX = content.x;
        marqueeStartContentY = content.y;
        marqueePending = true;
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
    card.style.outline = '2px solid var(--accent-color)';
    card.style.outlineOffset = '2px';

    updateStatusBarSelection(card);
});

gridContainer.addEventListener('mouseover', (e) => {
    if (marqueeActive) return;
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
                }
            }
        } else if (card.dataset.gifDuration && Number(card.dataset.gifDuration) > 0) {
            currentHoveredCard = card;
            showGifProgress(card);
        }
    }
    // Check if filename text overlaps with right-aligned tags and shift if needed
    if (card && !card.dataset.tagOverlapChecked) {
        const info = card.querySelector('.video-info');
        const tagsEl = card.querySelector('.card-tags');
        if (info && tagsEl) {
            if (!cardInfoSettings.filename || !cardInfoSettings.tags) {
                tagsEl.classList.remove('tags-shifted');
            } else {
                const firstBadge = tagsEl.querySelector('.tag-badge');
                if (firstBadge) {
                    const range = document.createRange();
                    range.selectNodeContents(info);
                    const textWidth = range.getBoundingClientRect().width;
                    const cardLeft = card.getBoundingClientRect().left;
                    const badgeLeft = firstBadge.getBoundingClientRect().left - cardLeft;
                    tagsEl.classList.toggle('tags-shifted', textWidth + 16 > badgeLeft);
                } else {
                    tagsEl.classList.remove('tags-shifted');
                }
            }
            card.dataset.tagOverlapChecked = '1';
        }
    }
});

// --- Video Scrub on Mousemove ---
let _scrubRafPending = false;

gridContainer.addEventListener('mousemove', (e) => {
    if (marqueeActive) return;
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
            const rect = card.getBoundingClientRect();
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
        }
        hideScrubber(currentHoveredCard);
        hideGifProgress(currentHoveredCard);
        currentHoveredCard = null;
    }
});

// --- Drag & Drop Support ---

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
            const filePath = window.electronAPI.getPathForFile(file);
            if (filePath && isDroppedFileSupported(file.name)) {
                paths.push(filePath);
            }
        }
        return { paths, isInternal: false };
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
            if (result.conflict) {
                const resolution = savedResolution
                    || (await showFileConflictDialog(result.fileName, filePath, result.destPath, i < filePaths.length - 1));
                if (resolution.applyToAll) savedResolution = resolution;
                result = await window.electronAPI.copyFile(filePath, destFolder, fileName, resolution.resolution);
            }
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

// Drop on grid — copy external files into current folder
gridContainer.addEventListener('dragenter', (e) => {
    const folderCard = e.target.closest('.folder-card');
    const isInternal = e.dataTransfer.types.includes('application/x-thumbnail-animator-path');
    if (folderCard || isInternal || (isDragWithFiles(e) && currentFolderPath)) {
        e.preventDefault();
    }
});

gridContainer.addEventListener('dragover', (e) => {
    const folderCard = e.target.closest('.folder-card');
    const isInternal = e.dataTransfer.types.includes('application/x-thumbnail-animator-path');
    if (folderCard || isInternal || (isDragWithFiles(e) && currentFolderPath)) {
        e.preventDefault();
        const isMove = folderCard && isInternal;
        e.dataTransfer.dropEffect = isMove ? 'move' : 'copy';
        if (folderCard) {
            folderCard.classList.add('drag-over');
            const folderName = folderCard.querySelector('.folder-name')?.textContent || 'folder';
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
    const folderCard = e.target.closest('.folder-card');
    if (folderCard) {
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
document.addEventListener('mouseup', (e) => {
    if (e.button === 3) {
        e.preventDefault();
        e.stopPropagation();
        if (navigationHistory.canGoBack()) {
            goBack();
        }
    } else if (e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
        if (navigationHistory.canGoForward()) {
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
        if (vsEnabled) {
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
        currentCollectionId = null;
        _collectionLoadToken++; // Cancel any in-flight smart collection scan
        highlightActiveCollection(null);
    }
    const perfStart = perfTest.start();
    const folderName = folderPath.split(/[/\\]/).filter(Boolean).pop() || folderPath;
    setStatusActivity(`Navigating to ${folderName}...`);
    const previousFolderPath = currentFolderPath;
    const previousScrollTop = gridContainer.scrollTop;
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
        
        // Only validate path if we don't have cached content (faster)
        if (!hasCachedContent) {
            // No in-memory cache — force a fresh scan in loadVideos so we don't
            // serve stale IndexedDB data that may be missing newly added files.
            forceReload = true;
            // Show loading indicator
            showLoadingIndicator(`Loading ${folderName}...`);
            try {
                // Validate path exists by trying to scan it
                // Skip stats only when neither sorting nor card metadata needs them.
                const skipStats = sortType === 'name' && !cardInfoSettings.fileSize && !cardInfoSettings.date;
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
        updateCurrentTab(folderPath, folderPath.split(/[/\\]/).filter(Boolean).pop());
        
        updateBreadcrumb(folderPath);
        searchBox.value = ''; // Clear search when navigating
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

// Close settings modal when clicking backdrop
settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        closeSettingsModal();
    }
});

// Settings modal close button
document.getElementById('settings-modal-close').addEventListener('click', () => {
    closeSettingsModal();
});

// Settings tab switching
function bindSettingsTabListeners() {
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const content = document.querySelector(`.settings-tab-content[data-tab="${tab.dataset.tab}"]`);
            if (content) content.classList.add('active');
        });
    });
}
bindSettingsTabListeners();

// --- Settings Export / Import ---
const SETTINGS_EXPORT_KEYS_STRING = [
    'selectedTheme', 'sidebarWidth', 'sidebarCollapsed', 'layoutMode',
    'zoomLevel', 'zoomToFit', 'thumbnailQuality', 'sortType', 'sortOrder',
    'rememberLastFolder', 'lastFolderPath', 'includeMovingImages',
    'autoRepeatVideos', 'pauseOnBlur', 'pauseOnLightbox', 'hoverScrub',
    'playbackControls', 'activeTabId',
    'aiVisualSearchEnabled', 'aiModelDownloadConfirmed', 'aiAutoScan',
    'aiSimilarityThreshold', 'aiClusteringMode',
    'videoCacheLimitMB', 'imageCacheLimitMB',
    'useSystemTrash', 'hoverScale', 'hoverScaleWithZoom',
    'hoverScaleAt50', 'hoverScaleAt100', 'hoverScaleAt200',
    'groupByDate', 'dateGroupGranularity', 'recursiveSearch',
    // Phase 2: Grid layout
    'gridGap', 'minCardWidth', 'cardAspectRatio',
    // Phase 3: Animation
    'animationSpeed', 'reduceMotion',
    // Phase 5: Playback
    'controlBarHideDelay', 'defaultSlideshowSpeed', 'videoThumbSeekPct',
    // Phase 6: AI
    'aiIdleDelay', 'aiBatchSize', 'aiVideoFrameCount',
    // Phase 7: Performance
    'perfProfile', 'maxMedia', 'parallelLoad', 'vsBuffer', 'vsPoolSize',
    'scrollDebounce', 'progressiveThreshold',
    'folderCacheTTL', 'idbCacheTTL',
    'imageThumbMaxEdge', 'videoThumbWidth',
    'lightboxMaxZoom', 'lightboxViewport', 'blowUpDelay',
    'recentFilesLimit', 'maxUndoHistory', 'tagSuggestionsLimit', 'searchHistoryLimit',
    // Phase 8: Niche
    'ioConcurrency', 'clipWorkerCount',
    'retryAttempts', 'retryInitialDelay', 'retryMaxDelay',
    'sidebarMinWidth', 'sidebarMaxWidth',
    'folderPreviewCount', 'folderPreviewSize',
];
const SETTINGS_EXPORT_KEYS_JSON = [
    'cardInfoSettings', 'customThemes',
    'tabs', 'sidebarExpandedNodes', 'pluginStates',
    'folderSortPrefs',
    'extensionColors', 'keyboardShortcuts', 'playbackSpeeds',
];

function showSettingsDataStatus(message, type) {
    const el = document.getElementById('settings-data-status');
    if (!el) return;
    el.textContent = message;
    el.className = 'settings-data-status ' + type;
}

async function exportCollectionsData() {
    try {
        const collections = await getAllCollections();
        const collectionsWithFiles = [];
        for (const col of collections) {
            const files = await getCollectionFiles(col.id);
            collectionsWithFiles.push({ ...col, files });
        }
        return collectionsWithFiles;
    } catch {
        return [];
    }
}

async function importCollectionsData(collectionsData) {
    if (!collectionsData || !Array.isArray(collectionsData) || collectionsData.length === 0) return;
    // Delete existing collections first
    const existing = await getAllCollections();
    for (const col of existing) {
        await deleteCollection(col.id);
    }
    // Write imported collections and their files
    for (const col of collectionsData) {
        const files = col.files || [];
        const colCopy = { ...col };
        delete colCopy.files;
        await saveCollection(colCopy);
        if (files.length > 0) {
            const filePaths = files.map(f => f.filePath || f.file_path);
            await addFilesToCollection(col.id, filePaths);
        }
    }
}

async function exportSettings() {
    _flushStorageWrites();
    const data = {
        meta: {
            app: 'thumbnail-animator',
            version: '1.4.5',
            exportedAt: new Date().toISOString(),
            schemaVersion: 1
        },
        settings: {},
        json: {},
        collections: []
    };
    for (const key of SETTINGS_EXPORT_KEYS_STRING) {
        const val = localStorage.getItem(key);
        if (val !== null) data.settings[key] = val;
    }
    for (const key of SETTINGS_EXPORT_KEYS_JSON) {
        const raw = localStorage.getItem(key);
        if (raw !== null) {
            try { data.json[key] = JSON.parse(raw); }
            catch { data.json[key] = raw; }
        }
    }
    data.collections = await exportCollectionsData();
    // Export SQLite-stored metadata
    try {
        const [ratingsResult, pinnedResult, favoritesResult, recentResult, tagsResult] = await Promise.all([
            window.electronAPI.dbGetAllRatings(),
            window.electronAPI.dbGetAllPinned(),
            window.electronAPI.dbGetFavorites(),
            window.electronAPI.dbGetRecentFiles(recentFilesLimitSetting),
            window.electronAPI.dbExportTags()
        ]);
        if (ratingsResult.success) data.json.fileRatings = ratingsResult.data;
        if (pinnedResult.success) data.json.pinnedFiles = pinnedResult.data;
        if (favoritesResult.success) data.json.favorites = favoritesResult.data;
        if (recentResult.success) data.json.recentFiles = recentResult.data;
        if (tagsResult.success) data.json.tags = tagsResult.data;
    } catch {}
    try {
        const result = await window.electronAPI.exportSettingsDialog(JSON.stringify(data, null, 2));
        if (result.canceled) return;
        if (result.success) {
            showSettingsDataStatus('Settings exported successfully.', 'success');
        } else {
            showSettingsDataStatus('Export failed: ' + friendlyError(result.error), 'error');
        }
    } catch (err) {
        showSettingsDataStatus('Export failed: ' + err.message, 'error');
    }
}

async function importSettings() {
    let result;
    try {
        result = await window.electronAPI.importSettingsDialog();
    } catch (err) {
        showSettingsDataStatus('Import failed: ' + err.message, 'error');
        return;
    }
    if (!result.success) {
        if (result.canceled) return;
        showSettingsDataStatus('Import failed: ' + friendlyError(result.error || 'Unknown error'), 'error');
        return;
    }
    const data = result.data;
    if (!data || !data.meta || data.meta.app !== 'thumbnail-animator') {
        showSettingsDataStatus('This file was not exported from Thumbnail Animator.', 'error');
        return;
    }
    if (data.meta.schemaVersion !== 1) {
        showSettingsDataStatus('Unsupported settings format. Please update the app.', 'error');
        return;
    }
    if (!confirm('This will replace ALL current settings and reload the app. Continue?')) return;

    localStorage.clear();
    if (data.settings) {
        for (const [key, val] of Object.entries(data.settings)) {
            localStorage.setItem(key, val);
        }
    }
    if (data.json) {
        for (const [key, val] of Object.entries(data.json)) {
            localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
        }
    }
    const importErrors = [];
    if (data.json && data.json.pluginStates) {
        try { await window.electronAPI.syncPluginStatesFromImport(data.json.pluginStates); }
        catch (e) { importErrors.push('plugin states'); console.error('Import plugin states failed:', e); }
    }
    if (data.collections) {
        try { await importCollectionsData(data.collections); }
        catch (e) { importErrors.push('collections'); console.error('Import collections failed:', e); }
    }
    // Import SQLite-stored metadata from exported settings
    try {
        if (data.json && data.json.fileRatings) {
            await window.electronAPI.dbRunMigration({ fileRatings: data.json.fileRatings });
        }
        if (data.json && data.json.pinnedFiles) {
            await window.electronAPI.dbRunMigration({ pinnedFiles: data.json.pinnedFiles });
        }
        if (data.json && data.json.favorites) {
            await window.electronAPI.dbSaveFavorites(data.json.favorites);
        }
        if (data.json && data.json.recentFiles) {
            await window.electronAPI.dbClearRecentFiles();
            for (const entry of data.json.recentFiles) {
                await window.electronAPI.dbAddRecentFile(entry, recentFilesLimitSetting);
            }
        }
        if (data.json && data.json.tags) {
            await window.electronAPI.dbImportTags(data.json.tags);
        }
    } catch (e) {
        importErrors.push('database metadata');
        console.error('Import database metadata failed:', e);
    }
    if (importErrors.length > 0) {
        showToast('Some data could not be imported', 'warning', {
            details: `Failed: ${importErrors.join(', ')}`,
            duration: 8000
        });
    }
    location.reload();
}

document.getElementById('export-settings-btn').addEventListener('click', exportSettings);
document.getElementById('import-settings-btn').addEventListener('click', importSettings);

// ── Cache limit settings ──
{
    const videoCacheSelect = document.getElementById('video-cache-limit');
    const imageCacheSelect = document.getElementById('image-cache-limit');
    const clearCacheBtn = document.getElementById('clear-cache-btn');

    // Restore saved values
    const savedVideoLimit = localStorage.getItem('videoCacheLimitMB');
    if (savedVideoLimit && videoCacheSelect) {
        const opt = videoCacheSelect.querySelector(`option[value="${savedVideoLimit}"]`);
        if (opt) videoCacheSelect.value = savedVideoLimit;
    }
    const savedImageLimit = localStorage.getItem('imageCacheLimitMB');
    if (savedImageLimit && imageCacheSelect) {
        const opt = imageCacheSelect.querySelector(`option[value="${savedImageLimit}"]`);
        if (opt) imageCacheSelect.value = savedImageLimit;
    }

    // Save on change and sync to main process
    function syncCacheLimits() {
        const videoMB = parseInt(videoCacheSelect?.value || '500', 10);
        const imageMB = parseInt(imageCacheSelect?.value || '1000', 10);
        if (window.electronAPI?.setCacheLimits) {
            window.electronAPI.setCacheLimits(videoMB, imageMB);
        }
    }
    if (videoCacheSelect) {
        videoCacheSelect.addEventListener('change', () => {
            deferLocalStorageWrite('videoCacheLimitMB', videoCacheSelect.value);
            syncCacheLimits();
        });
    }
    if (imageCacheSelect) {
        imageCacheSelect.addEventListener('change', () => {
            deferLocalStorageWrite('imageCacheLimitMB', imageCacheSelect.value);
            syncCacheLimits();
        });
    }

    // Show cache usage when Data tab is opened
    async function updateCacheUsage() {
        if (!window.electronAPI?.getCacheInfo) return;
        try {
            const info = await window.electronAPI.getCacheInfo();
            if (!info) return;
            const fmt = (b) => b < 1024 * 1024 ? (b / 1024).toFixed(0) + ' KB' : (b / 1024 / 1024).toFixed(1) + ' MB';
            const videoEl = document.getElementById('video-cache-usage');
            const imageEl = document.getElementById('image-cache-usage');
            if (videoEl) videoEl.textContent = `Currently using ${fmt(info.video.size)} (${info.video.files} files)`;
            if (imageEl) imageEl.textContent = `Currently using ${fmt(info.image.size)} (${info.image.files} files)`;
        } catch {}
    }

    // Update usage when settings modal opens to Data tab
    const observer = new MutationObserver(() => {
        const dataTab = document.querySelector('.settings-tab-content[data-tab="data"]');
        if (dataTab && !dataTab.classList.contains('hidden') && dataTab.offsetParent !== null) {
            updateCacheUsage();
        }
    });
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) observer.observe(settingsModal, { attributes: true, subtree: true, attributeFilter: ['class'] });

    // Clear cache button
    if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', async () => {
            clearCacheBtn.disabled = true;
            clearCacheBtn.textContent = 'Clearing...';
            try {
                const videoResult = await window.electronAPI.evictCache('video');
                const imageResult = await window.electronAPI.evictCache('image');
                const totalDeleted = (videoResult?.deleted || 0) + (imageResult?.deleted || 0);
                const totalFreed = ((videoResult?.freed || 0) + (imageResult?.freed || 0)) / 1024 / 1024;
                showSettingsDataStatus(
                    totalDeleted > 0
                        ? `Cleared ${totalDeleted} thumbnails (freed ${totalFreed.toFixed(1)} MB)`
                        : 'Cache is already within limits',
                    'success'
                );
                updateCacheUsage();
            } catch (err) {
                showSettingsDataStatus('Clear failed: ' + err.message, 'error');
            } finally {
                clearCacheBtn.disabled = false;
                clearCacheBtn.textContent = 'Clear';
            }
        });
    }
}

// Inject plugin settings panels into the settings modal
async function injectPluginSettingsPanels() {
    let panels;
    try {
        panels = await window.electronAPI.getPluginSettingsPanels();
    } catch {
        return;
    }
    if (!panels || panels.length === 0) return;

    const tabsEl = document.querySelector('.settings-tabs');
    const panelEl = document.querySelector('.settings-panel');
    if (!tabsEl || !panelEl) return;

    for (const panel of panels) {
        const tabId = `plugin-${panel.pluginId}`;
        if (document.querySelector(`.settings-tab[data-tab="${tabId}"]`)) continue; // already injected

        // Add tab button
        const tabBtn = document.createElement('button');
        tabBtn.className = 'settings-tab';
        tabBtn.dataset.tab = tabId;
        tabBtn.textContent = panel.label || panel.pluginId;
        tabsEl.appendChild(tabBtn);

        // Add tab content
        const contentEl = document.createElement('div');
        contentEl.className = 'settings-tab-content';
        contentEl.dataset.tab = tabId;
        contentEl.innerHTML = panel.html || `<p class="settings-label">No settings available for ${panel.pluginId}.</p>`;
        panelEl.appendChild(contentEl);

        // Wire save button if present
        contentEl.querySelectorAll('[data-plugin-settings-save]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const formData = {};
                contentEl.querySelectorAll('[data-plugin-setting-key]').forEach(input => {
                    formData[input.dataset.pluginSettingKey] = input.type === 'checkbox' ? input.checked : input.value;
                });
                try {
                    await window.electronAPI.executePluginSettingsAction(panel.pluginId, 'save', formData);
                    showToast('Settings saved', 'success');
                } catch (err) {
                    showToast(`Settings error: ${err.message}`, 'error');
                }
            });
        });

        // Load existing settings into inputs
        try {
            const loaded = await window.electronAPI.executePluginSettingsAction(panel.pluginId, 'load', null);
            if (loaded && loaded.success && loaded.result) {
                Object.entries(loaded.result).forEach(([key, val]) => {
                    const input = contentEl.querySelector(`[data-plugin-setting-key="${key}"]`);
                    if (!input) return;
                    if (input.type === 'checkbox') input.checked = Boolean(val);
                    else input.value = String(val);
                });
            }
        } catch { /* settings load is optional */ }
    }

    // Re-bind tab listeners to include new plugin tabs
    bindSettingsTabListeners();
}

// --- Plugin enable/disable helper (renderer-side cache) ---
function isPluginEnabled(pluginId) {
    try {
        const states = JSON.parse(localStorage.getItem('pluginStates') || '{}');
        // Default is enabled (true) if not explicitly set to false
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

// --- Plugins settings tab ---
async function initPluginsTab() {
    const container = document.getElementById('plugins-tab-content');
    if (!container) return;

    let manifests, states;
    try {
        [manifests, states] = await Promise.all([
            window.electronAPI.getPluginManifests(),
            window.electronAPI.getPluginStates(),
        ]);
    } catch (err) {
        container.innerHTML = `<div class="settings-item"><span class="settings-label" style="color:var(--color-danger)">Failed to load plugins: ${err.message}</span></div>`;
        return;
    }

    if (!manifests || manifests.length === 0) {
        container.innerHTML = `<div class="settings-item"><span class="settings-label" style="opacity:0.6">No plugins installed.</span></div>`;
        return;
    }

    // Sync localStorage with authoritative state from main process
    manifests.forEach(m => _setLocalPluginState(m.id, states[m.id] !== false));

    container.innerHTML = manifests.map(m => {
        const enabled = states[m.id] !== false;
        const caps = m.capabilities || {};
        const capLabels = [
            caps.metadataExtractors?.length ? `${caps.metadataExtractors.length} extractor${caps.metadataExtractors.length > 1 ? 's' : ''}` : null,
            caps.infoSections?.length ? `${caps.infoSections.length} info section${caps.infoSections.length > 1 ? 's' : ''}` : null,
            caps.contextMenuItems?.length ? `${caps.contextMenuItems.length} menu item${caps.contextMenuItems.length > 1 ? 's' : ''}` : null,
            caps.batchOperations?.length ? `${caps.batchOperations.length} batch op${caps.batchOperations.length > 1 ? 's' : ''}` : null,
            caps.thumbnailGenerators?.length ? `${caps.thumbnailGenerators.length} thumbnail generator${caps.thumbnailGenerators.length > 1 ? 's' : ''}` : null,
        ].filter(Boolean);

        return `
        <div class="settings-item plugin-settings-row" data-plugin-id="${m.id}">
            <div class="plugin-settings-info">
                <div class="plugin-settings-name">${m.name || m.id}</div>
                ${m.description ? `<div class="plugin-settings-desc">${m.description}</div>` : ''}
                <div class="plugin-settings-meta">
                    <span class="plugin-settings-version">v${m.version || '?'}</span>
                    ${capLabels.length ? `<span class="plugin-settings-caps">${capLabels.join(' · ')}</span>` : ''}
                </div>
            </div>
            <label class="settings-label plugin-settings-toggle-label">
                <div class="toggle-switch">
                    <input type="checkbox" class="plugin-enable-toggle" data-plugin-id="${m.id}" ${enabled ? 'checked' : ''}>
                    <span class="toggle-slider"></span>
                </div>
                <span class="toggle-label plugin-toggle-state-label">${enabled ? 'On' : 'Off'}</span>
            </label>
        </div>`;
    }).join('');

    // Wire toggle handlers
    container.querySelectorAll('.plugin-enable-toggle').forEach(checkbox => {
        checkbox.addEventListener('change', async function() {
            const pluginId = this.dataset.pluginId;
            const enabled = this.checked;
            const label = this.closest('.settings-label').querySelector('.plugin-toggle-state-label');
            if (label) label.textContent = enabled ? 'On' : 'Off';

            _setLocalPluginState(pluginId, enabled);
            try {
                await window.electronAPI.setPluginEnabled(pluginId, enabled);
                // Invalidate lazy-loaded plugin menu items cache so it refreshes
                _pluginMenuItems = null;
                // Invalidate info sections cache
                if (typeof _pluginInfoSections !== 'undefined') _pluginInfoSections = null;
                showToast(`Plugin "${pluginId}" ${enabled ? 'enabled' : 'disabled'}`, 'info');
            } catch (err) {
                showToast(`Failed to toggle plugin: ${err.message}`, 'error');
            }
        });
    });
}

// Inject plugin panels + plugins tab when the settings modal is first opened
settingsModal.addEventListener('click', () => {}, { once: false }); // ensure settingsModal is referenced
(function() {
    let settingsOnceInit = false;
    const _onFirstOpen = () => {
        if (settingsOnceInit) return;
        settingsOnceInit = true;
        injectPluginSettingsPanels();
        initPluginsTab();
    };
    // Listen for the modal becoming visible
    const observer = new MutationObserver(() => {
        if (!settingsModal.classList.contains('hidden')) {
            _onFirstOpen();
            observer.disconnect();
        }
    });
    observer.observe(settingsModal, { attributes: true, attributeFilter: ['class'] });
})();

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

// Use system trash toggle event listener
useSystemTrashToggle.addEventListener('change', () => {
    toggleUseSystemTrash();
});
// Restore system trash setting on startup
useSystemTrashToggle.checked = useSystemTrash;
useSystemTrashLabel.textContent = useSystemTrash ? 'On' : 'Off';
if (useSystemTrash) window.electronAPI.setUseSystemTrash(true);

// Card info toggles
[cardInfoExtensionToggle, cardInfoResolutionToggle, cardInfoSizeToggle, cardInfoDateToggle, cardInfoDurationToggle, cardInfoStarsToggle, cardInfoAudioToggle, cardInfoFilenameToggle, cardInfoTagsToggle, cardInfoExtensionHoverToggle, cardInfoResolutionHoverToggle, cardInfoSizeHoverToggle, cardInfoDateHoverToggle, cardInfoStarsHoverToggle, cardInfoAudioHoverToggle, cardInfoFilenameHoverToggle, cardInfoTagsHoverToggle]
    .filter(Boolean)
    .forEach(el => el.addEventListener('change', () => onCardInfoSettingsChanged()));

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
    // Sync to current controller
    videoLoop = autoRepeatVideos;
    if (activePlaybackController) {
        activePlaybackController.setLoop(videoLoop);
    }
    if (mediaControlBarInstance) {
        mediaControlBarInstance.syncState({ loop: videoLoop });
    }
});

playbackControlsToggle.addEventListener('change', () => {
    playbackControlsEnabled = playbackControlsToggle.checked;
    playbackControlsLabel.textContent = playbackControlsEnabled ? 'On' : 'Off';
    deferLocalStorageWrite('playbackControls', playbackControlsEnabled.toString());
});

function applyZoomToFitNow() {
    if (lightbox.classList.contains('hidden')) return;
    const isImageVisible = lightboxImage.style.display === 'block';
    const isVideoVisible = lightboxVideo.style.display === 'block';
    const isCanvasVisible = lightboxGifCanvas.style.display === 'block';
    if (zoomToFit) {
        let fitLevel = 100;
        if (isCanvasVisible && activePlaybackController && activePlaybackController.gifWidth > 0) {
            fitLevel = calculateFitZoomLevel(activePlaybackController.gifWidth, activePlaybackController.gifHeight);
        } else if (isImageVisible && lightboxImage.naturalWidth > 0) {
            fitLevel = calculateFitZoomLevel(lightboxImage.naturalWidth, lightboxImage.naturalHeight);
        } else if (isVideoVisible && lightboxVideo.videoWidth > 0) {
            fitLevel = calculateFitZoomLevel(lightboxVideo.videoWidth, lightboxVideo.videoHeight);
        }
        if (fitLevel > 100) {
            applyLightboxZoom(fitLevel);
        }
    } else {
        resetZoom();
    }
}

zoomToFitToggle.addEventListener('change', () => {
    zoomToFit = zoomToFitToggle.checked;
    zoomToFitLabel.textContent = zoomToFit ? 'On' : 'Off';
    if (lightboxZoomToFitToggle) lightboxZoomToFitToggle.checked = zoomToFit;
    deferLocalStorageWrite('zoomToFit', zoomToFit.toString());
    applyZoomToFitNow();
});

hoverScrubToggle.addEventListener('change', () => {
    hoverScrubEnabled = hoverScrubToggle.checked;
    hoverScrubLabel.textContent = hoverScrubEnabled ? 'On' : 'Off';
    deferLocalStorageWrite('hoverScrub', hoverScrubEnabled.toString());
});

lightboxZoomToFitToggle.addEventListener('change', () => {
    zoomToFit = lightboxZoomToFitToggle.checked;
    if (zoomToFitToggle) zoomToFitToggle.checked = zoomToFit;
    if (zoomToFitLabel) zoomToFitLabel.textContent = zoomToFit ? 'On' : 'Off';
    deferLocalStorageWrite('zoomToFit', zoomToFit.toString());
    applyZoomToFitNow();
});

// Sorting dropdown event listeners
sortTypeSelect.addEventListener('change', () => {
    updateSorting();
});

sortOrderSelect.addEventListener('change', () => {
    updateSorting();
});

// Thumbnail quality select event listener
thumbnailQualitySelect.addEventListener('change', () => {
    thumbnailQuality = thumbnailQualitySelect.value;
    deferLocalStorageWrite('thumbnailQuality', thumbnailQuality);
    // Reload current folder to apply new quality
    if (currentFolderPath) {
        loadVideos(currentFolderPath, true, gridContainer.scrollTop);
    }
});

// Hover expand setting (slider: 100 = no scale, 150 = 1.5x)
let hoverScalePct = 102;
let hoverScaleWithZoom = false;
let hoverScaleAt50 = 120;
let hoverScaleAt100 = 102;
let hoverScaleAt200 = 100;

function applyHoverScale() {
    let pct;
    if (hoverScaleWithZoom) {
        // Lerp between the 3 user-defined breakpoints based on current zoom
        const z = Math.max(50, Math.min(200, zoomLevel));
        if (z <= 100) {
            const t = (z - 50) / 50;
            pct = hoverScaleAt50 + (hoverScaleAt100 - hoverScaleAt50) * t;
        } else {
            const t = (z - 100) / 100;
            pct = hoverScaleAt100 + (hoverScaleAt200 - hoverScaleAt100) * t;
        }
    } else {
        pct = hoverScalePct;
    }
    const scale = pct / 100;
    const lift = pct <= 100 ? 0 : Math.round((pct - 100) * 0.16);
    document.documentElement.style.setProperty('--hover-scale', String(scale));
    document.documentElement.style.setProperty('--hover-lift', `-${lift}px`);
    if (!hoverScaleWithZoom && hoverScaleValue) {
        hoverScaleValue.textContent = (hoverScalePct / 100).toFixed(2) + 'x';
    }
}

function updateHoverScaleUI() {
    if (hoverScaleFixedWrap) hoverScaleFixedWrap.style.display = hoverScaleWithZoom ? 'none' : '';
    if (hoverScaleZoomRow) hoverScaleZoomRow.style.display = hoverScaleWithZoom ? '' : 'none';
    if (hoverScaleZoomLabel) hoverScaleZoomLabel.textContent = hoverScaleWithZoom ? 'Per-Zoom' : 'Fixed';
}

function formatZoomSliderValue(el, pct) {
    if (el) el.textContent = (pct / 100).toFixed(2) + 'x';
}

(function initHoverScale() {
    hoverScalePct = parseInt(localStorage.getItem('hoverScale')) || 102;
    hoverScaleWithZoom = localStorage.getItem('hoverScaleWithZoom') === 'true';
    hoverScaleAt50 = parseInt(localStorage.getItem('hoverScaleAt50')) || 120;
    hoverScaleAt100 = parseInt(localStorage.getItem('hoverScaleAt100')) || 102;
    hoverScaleAt200 = parseInt(localStorage.getItem('hoverScaleAt200')) || 100;
    if (hoverScaleSlider) hoverScaleSlider.value = hoverScalePct;
    if (hoverScaleZoomToggle) hoverScaleZoomToggle.checked = hoverScaleWithZoom;
    if (hoverScaleZ50) hoverScaleZ50.value = hoverScaleAt50;
    if (hoverScaleZ100) hoverScaleZ100.value = hoverScaleAt100;
    if (hoverScaleZ200) hoverScaleZ200.value = hoverScaleAt200;
    formatZoomSliderValue(hoverScaleValue, hoverScalePct);
    formatZoomSliderValue(hoverScaleZ50Value, hoverScaleAt50);
    formatZoomSliderValue(hoverScaleZ100Value, hoverScaleAt100);
    formatZoomSliderValue(hoverScaleZ200Value, hoverScaleAt200);
    updateHoverScaleUI();
    applyHoverScale();
})();

hoverScaleSlider.addEventListener('input', () => {
    hoverScalePct = parseInt(hoverScaleSlider.value);
    applyHoverScale();
    deferLocalStorageWrite('hoverScale', String(hoverScalePct));
});

hoverScaleZoomToggle.addEventListener('change', () => {
    hoverScaleWithZoom = hoverScaleZoomToggle.checked;
    updateHoverScaleUI();
    applyHoverScale();
    deferLocalStorageWrite('hoverScaleWithZoom', String(hoverScaleWithZoom));
});

hoverScaleZ50.addEventListener('input', () => {
    hoverScaleAt50 = parseInt(hoverScaleZ50.value);
    formatZoomSliderValue(hoverScaleZ50Value, hoverScaleAt50);
    applyHoverScale();
    deferLocalStorageWrite('hoverScaleAt50', String(hoverScaleAt50));
});

hoverScaleZ100.addEventListener('input', () => {
    hoverScaleAt100 = parseInt(hoverScaleZ100.value);
    formatZoomSliderValue(hoverScaleZ100Value, hoverScaleAt100);
    applyHoverScale();
    deferLocalStorageWrite('hoverScaleAt100', String(hoverScaleAt100));
});

hoverScaleZ200.addEventListener('input', () => {
    hoverScaleAt200 = parseInt(hoverScaleZ200.value);
    formatZoomSliderValue(hoverScaleZ200Value, hoverScaleAt200);
    applyHoverScale();
    deferLocalStorageWrite('hoverScaleAt200', String(hoverScaleAt200));
});

// --- AI Visual Search settings event handlers ---

(function initAiSearchSettings() {
    const enabledToggle = document.getElementById('ai-search-enabled-toggle');
    const enabledLabel  = document.getElementById('ai-search-enabled-label');
    const autoScanToggle = document.getElementById('ai-auto-scan-toggle');
    const autoScanLabel  = document.getElementById('ai-auto-scan-label');
    const thresholdSlider = document.getElementById('ai-threshold-slider');
    const thresholdValue  = document.getElementById('ai-threshold-value');
    const clusteringSelect = document.getElementById('ai-clustering-select');
    const scanNowBtn   = document.getElementById('ai-scan-now-btn');
    const clearCacheBtn = document.getElementById('ai-clear-cache-btn');
    const aiToggleBtn  = document.getElementById('ai-search-toggle-btn');
    const searchBoxContainer = document.querySelector('.search-box-container');
    const searchBoxInput = document.getElementById('search-box');
    const statusDot  = document.getElementById('ai-status-dot');
    const statusText = document.getElementById('ai-status-text');

    // Apply persisted state to controls
    if (enabledToggle) enabledToggle.checked = aiVisualSearchEnabled;
    if (enabledLabel)  enabledLabel.textContent = aiVisualSearchEnabled ? 'On' : 'Off';
    if (autoScanToggle) autoScanToggle.checked = aiAutoScan;
    if (autoScanLabel)  autoScanLabel.textContent = aiAutoScan ? 'On' : 'Off';
    if (thresholdSlider) thresholdSlider.value = Math.round(aiSimilarityThreshold * 100);
    if (thresholdValue)  thresholdValue.textContent = `${clipScoreToDisplayPct(aiSimilarityThreshold)}%`;
    if (clusteringSelect) clusteringSelect.value = aiClusteringMode;

    function setAiStatusDot(state) {
        if (!statusDot) return;
        statusDot.classList.remove('loaded', 'loading', 'error');
        if (state) statusDot.classList.add(state);
    }

    function setAiStatus(state, text) {
        setAiStatusDot(state);
        if (statusText) statusText.textContent = text;
    }

    function showAiToggleBtn(visible) {
        if (!aiToggleBtn) return;
        aiToggleBtn.style.display = visible ? '' : 'none';
        if (searchBoxContainer) {
            searchBoxContainer.classList.toggle('has-ai-toggle', visible);
        }
    }

    function updateAiToggleBtnState() {
        if (!aiToggleBtn) return;
        aiToggleBtn.classList.toggle('active', aiSearchActive);
        aiToggleBtn.title = aiSearchActive ? 'AI Search: On (click to disable)' : 'AI Search: Off (click to enable)';
        if (searchBoxInput) {
            searchBoxInput.placeholder = aiSearchActive ? 'Search by content (e.g. "dog", "ocean")...' : 'Search files...';
        }
    }

    // --- Confirmation dialog elements ---
    const confirmOverlay   = document.getElementById('ai-model-confirm-overlay');
    const confirmCancelBtn = document.getElementById('ai-confirm-cancel-btn');
    const confirmDlBtn     = document.getElementById('ai-confirm-download-btn');
    const confirmDlProgress = document.getElementById('ai-confirm-download-progress');
    const confirmProgressFill = document.getElementById('ai-confirm-progress-fill');
    const confirmProgressFile = document.getElementById('ai-confirm-progress-file');
    const confirmProgressPct  = document.getElementById('ai-confirm-progress-pct');
    const confirmLink = document.getElementById('ai-confirm-link');

    // Open HuggingFace link in the system browser when clicked
    if (confirmLink) {
        confirmLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.electronAPI.openUrl('https://huggingface.co/Xenova/clip-vit-base-patch32').catch(() => {});
        });
    }

    function showConfirmDialog() {
        if (!confirmOverlay) return;
        if (confirmDlProgress) confirmDlProgress.style.display = 'none';
        if (confirmDlBtn) { confirmDlBtn.disabled = false; confirmDlBtn.textContent = 'Download & Enable'; }
        if (confirmCancelBtn) confirmCancelBtn.disabled = false;
        confirmOverlay.style.display = 'flex';
    }

    function hideConfirmDialog() {
        if (confirmOverlay) confirmOverlay.style.display = 'none';
    }

    function revertToggleOff() {
        aiVisualSearchEnabled = false;
        if (enabledToggle) enabledToggle.checked = false;
        if (enabledLabel) enabledLabel.textContent = 'Off';
        showAiToggleBtn(false);
        if (scanNowBtn) scanNowBtn.disabled = true;
    }

    async function doLoadModel() {
        setAiStatus('loading', 'Loading model...');
        try {
            const result = await window.electronAPI.clipInit();
            if (result.success) {
                setAiStatus('loaded', 'Model loaded');
                if (aiAutoScan && currentFolderPath) {
                    scheduleBackgroundEmbedding(currentItems);
                }
            } else {
                setAiStatus('error', 'Failed: ' + friendlyError(result.error || 'unknown error'));
                revertToggleOff();
            }
        } catch (err) {
            setAiStatus('error', 'Error: ' + err.message);
            revertToggleOff();
        }
    }

    // Download progress from main process → update dialog bar
    window.electronAPI.onClipDownloadProgress((event, progress) => {
        if (!confirmDlProgress || confirmDlProgress.style.display === 'none') return;
        if (progress.status === 'downloading' && progress.total > 0) {
            const pct = Math.round((progress.loaded / progress.total) * 100);
            if (confirmProgressFill) confirmProgressFill.style.width = pct + '%';
            if (confirmProgressFile) confirmProgressFile.textContent = progress.file || '';
            if (confirmProgressPct)  confirmProgressPct.textContent  = pct + '%';
        } else if (progress.status === 'done') {
            if (confirmProgressFill) confirmProgressFill.style.width = '100%';
            if (confirmProgressPct)  confirmProgressPct.textContent  = '100%';
        }
    });

    // Confirm: Download & Enable
    if (confirmDlBtn) {
        confirmDlBtn.addEventListener('click', async () => {
            confirmDlBtn.disabled = true;
            confirmDlBtn.textContent = 'Downloading...';
            if (confirmCancelBtn) confirmCancelBtn.disabled = true;
            if (confirmDlProgress) confirmDlProgress.style.display = 'block';
            if (confirmProgressFill) confirmProgressFill.style.width = '0%';
            if (confirmProgressFile) confirmProgressFile.textContent = 'Preparing...';
            if (confirmProgressPct)  confirmProgressPct.textContent  = '';

            await doLoadModel();
            if (aiVisualSearchEnabled) {
                // Only mark confirmed if the load actually succeeded
                aiModelDownloadConfirmed = true;
                localStorage.setItem('aiModelDownloadConfirmed', 'true');
            }
            hideConfirmDialog();
        });
    }

    // Confirm: Cancel
    if (confirmCancelBtn) {
        confirmCancelBtn.addEventListener('click', () => {
            hideConfirmDialog();
            revertToggleOff();
        });
    }

    // Restore state from previous session
    if (aiVisualSearchEnabled) {
        if (!aiModelDownloadConfirmed) {
            // Toggle was saved as enabled but user never confirmed the download dialog
            // (e.g. a previous bug prevented the dialog from showing). Reset to off.
            aiVisualSearchEnabled = false;
            localStorage.removeItem('aiVisualSearchEnabled');
            if (enabledToggle) enabledToggle.checked = false;
            if (enabledLabel) enabledLabel.textContent = 'Off';
        } else {
            // User previously confirmed — restore the enabled state and reload model silently
            showAiToggleBtn(true);
            updateAiToggleBtnState();
            if (scanNowBtn) scanNowBtn.disabled = false;
            window.electronAPI.clipStatus().then(s => {
                if (s.loaded) {
                    setAiStatus('loaded', 'Model loaded');
                } else {
                    doLoadModel(); // Safe: user already confirmed the download
                }
            }).catch(() => {});
        }
    }

    // Enable/disable toggle
    if (enabledToggle) {
        enabledToggle.addEventListener('change', async () => {
            aiVisualSearchEnabled = enabledToggle.checked;
            enabledLabel.textContent = aiVisualSearchEnabled ? 'On' : 'Off';
            deferLocalStorageWrite('aiVisualSearchEnabled', aiVisualSearchEnabled.toString());

            if (aiVisualSearchEnabled) {
                showAiToggleBtn(true);
                updateAiToggleBtnState();
                if (scanNowBtn) scanNowBtn.disabled = false;

                // Always show confirmation dialog if user hasn't accepted it before
                if (!aiModelDownloadConfirmed) {
                    showConfirmDialog();
                } else {
                    await doLoadModel();
                }
            } else {
                // Turn off
                aiSearchActive = false;
                currentTextEmbedding = null;
                currentEmbeddings.clear();
                cancelEmbeddingScan();
                showAiToggleBtn(false);
                updateAiToggleBtnState();
                if (scanNowBtn) scanNowBtn.disabled = true;
                setAiStatus(null, 'Model not loaded');
                applyFilters();
                window.electronAPI.clipTerminate().catch(() => {});
            }
        });
    }

    // Auto-scan toggle
    if (autoScanToggle) {
        autoScanToggle.addEventListener('change', () => {
            aiAutoScan = autoScanToggle.checked;
            autoScanLabel.textContent = aiAutoScan ? 'On' : 'Off';
            deferLocalStorageWrite('aiAutoScan', aiAutoScan.toString());
            if (aiAutoScan) _resetIdleTimer(); else _cancelIdlePreEmbedding();
        });
    }

    // Threshold slider
    if (thresholdSlider) {
        thresholdSlider.addEventListener('input', () => {
            aiSimilarityThreshold = parseInt(thresholdSlider.value, 10) / 100;
            thresholdValue.textContent = `${clipScoreToDisplayPct(aiSimilarityThreshold)}%`;
            deferLocalStorageWrite('aiSimilarityThreshold', aiSimilarityThreshold.toString());
            if (aiSearchActive && currentTextEmbedding) applyFilters();
        });
    }

    // Clustering select
    if (clusteringSelect) {
        clusteringSelect.addEventListener('change', () => {
            aiClusteringMode = clusteringSelect.value;
            deferLocalStorageWrite('aiClusteringMode', aiClusteringMode);
            if (currentItems.length > 0) applyFilters();
        });
    }

    // Scan now button
    if (scanNowBtn) {
        scanNowBtn.addEventListener('click', () => {
            if (!aiVisualSearchEnabled || !currentFolderPath) return;
            scheduleBackgroundEmbedding(currentItems);
        });
    }

    // Clear cache button
    if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', async () => {
            cancelEmbeddingScan();
            currentEmbeddings.clear();
            await clearEmbeddingCache();
            setAiStatus(aiVisualSearchEnabled ? 'loaded' : null, aiVisualSearchEnabled ? 'Cache cleared — rescan to rebuild' : 'Model not loaded');
        });
    }

    // AI search toggle button in toolbar
    if (aiToggleBtn) {
        aiToggleBtn.addEventListener('click', () => {
            if (!aiVisualSearchEnabled) return;
            aiSearchActive = !aiSearchActive;
            if (!aiSearchActive) {
                currentTextEmbedding = null;
            }
            updateAiToggleBtnState();
            applyFilters();
        });
    }

    // Progress listener from main process
    window.electronAPI.onClipProgress((event, { current, total, phase }) => {
        updateEmbedProgressUI(current, total);
    });
})();

// --- Find Similar banner event listeners ---
(function initFindSimilarBanner() {
    const thresholdSlider = document.getElementById('find-similar-threshold');
    const thresholdValue = document.getElementById('find-similar-threshold-value');
    const allFoldersCheckbox = document.getElementById('find-similar-all-folders');
    const clearBtn = document.getElementById('find-similar-clear');
    let _fsThresholdTimer = null;

    if (thresholdSlider) {
        thresholdSlider.addEventListener('input', () => {
            findSimilarThreshold = parseInt(thresholdSlider.value, 10) / 100;
            if (thresholdValue) thresholdValue.textContent = findSimilarThreshold.toFixed(2);
            if (!findSimilarActive || !findSimilarEmbedding) return;
            // Debounce the heavy re-render to avoid card flashing while dragging
            clearTimeout(_fsThresholdTimer);
            _fsThresholdTimer = setTimeout(() => {
                if (findSimilarAllFolders) {
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
            findSimilarAllFolders = allFoldersCheckbox.checked;
            if (!findSimilarActive || !findSimilarEmbedding) return;
            if (findSimilarAllFolders) {
                // Stash current state before switching to cross-folder
                if (!findSimilarPreviousItems) {
                    findSimilarPreviousItems = currentItems.slice();
                    findSimilarPreviousFolder = currentFolderPath;
                }
                executeCrossFolderFindSimilar();
            } else {
                // Restore previous view and use current-folder filter
                if (findSimilarPreviousItems) {
                    currentItems = findSimilarPreviousItems;
                    currentFolderPath = findSimilarPreviousFolder;
                    findSimilarPreviousItems = null;
                    findSimilarPreviousFolder = null;
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
        return;
    }

    // Ensure model is loaded
    try {
        const status = await window.electronAPI.clipStatus();
        if (!status.loaded) {
            const init = await window.electronAPI.clipInit();
            if (!init.success) { hideEmbedProgressUI(); return; }
        }
    } catch { hideEmbedProgressUI(); return; }

    showEmbedProgressUI(uncached.length);

    // Wire cancel button
    const cancelBtn = document.getElementById('ai-embed-cancel-btn');
    if (cancelBtn) {
        cancelBtn._onclickAi = () => cancelEmbeddingScan();
        cancelBtn.onclick = cancelBtn._onclickAi;
    }

    const BATCH_SIZE = 20;
    let done = 0;
    for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
        if (signal.aborted) { hideEmbedProgressUI(); return; }

        const batch = uncached.slice(i, i + BATCH_SIZE);
        try {
            const results = await window.electronAPI.clipEmbedImages(
                batch.map(item => ({ path: item.path, mtime: item.mtime || 0, thumbPath: null }))
            );
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
        // If AI search is active with a query, re-filter now that embeddings are ready
        if (aiSearchActive && currentTextEmbedding && document.getElementById('search-box').value.trim()) {
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
    if (!status || !status.loaded) return;

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
            const results = await window.electronAPI.clipEmbedImages(
                batch.map(item => ({ path: item.path, mtime: item.mtime || 0, thumbPath: null }))
            );
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

    if (!signal.aborted && aiSearchActive && currentTextEmbedding) {
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
    if (hoverScaleWithZoom) applyHoverScale();
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

function calculateFitZoomLevel(naturalWidth, naturalHeight) {
    const availableW = window.innerWidth * 0.9;
    const availableH = window.innerHeight * 0.9;
    const scaleX = availableW / naturalWidth;
    const scaleY = availableH / naturalHeight;
    const fitScale = Math.min(scaleX, scaleY);

    if (fitScale <= 1) return 100; // Already fits or larger

    // Inverse of exponential zoom curve: fitScale = 1.06^((zoomLevel - 100) / 5)
    const zoomLevel = 100 + 5 * Math.log(fitScale) / Math.log(1.06);
    // Snap to nearest step of 5, cap at slider max
    return Math.min(Math.round(zoomLevel / 5) * 5, lightboxMaxZoomSetting);
}

/** Helper: display a static (non-animated) image in the lightbox */
function _showStaticImage(mediaUrl, lightboxImage, lightboxGifCanvas, lightbox, mediaControlBarInstance) {
    lightboxGifCanvas.style.display = 'none';
    lightboxImage.style.display = 'block';

    lightbox.classList.remove('hidden');
    lightboxImage.style.transform = 'scale(1)';
    lightboxImage.style.maxWidth = '90vw';
    lightboxImage.style.maxHeight = '90vh';
    lightboxImage.style.width = 'auto';
    lightboxImage.style.height = 'auto';

    const handleImageLoad = () => {
        requestAnimationFrame(() => {
            const rect = lightboxImage.getBoundingClientRect();
            lightboxImage.dataset.baseWidth = rect.width.toString();
            lightboxImage.dataset.baseHeight = rect.height.toString();
            const fitLevel = calculateFitZoomLevel(lightboxImage.naturalWidth, lightboxImage.naturalHeight);
            if (zoomToFit && fitLevel > 100) {
                applyLightboxZoom(fitLevel);
            }
        });
        lightboxImage.removeEventListener('load', handleImageLoad);
    };

    if (lightboxImage.complete && lightboxImage.naturalWidth > 0) {
        handleImageLoad();
    } else {
        lightboxImage.addEventListener('load', handleImageLoad);
    }

    lightboxImage.src = mediaUrl;
    lightboxImage.dataset.src = mediaUrl;

    // Static image: hide controls
    if (mediaControlBarInstance) mediaControlBarInstance.hide();
}

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
    
    // Destroy any previous playback controller
    if (activePlaybackController) {
        activePlaybackController.destroy();
        activePlaybackController = null;
    }

    // Initialize the control bar if not yet created
    if (!mediaControlBarInstance) {
        const controlsEl = document.getElementById('media-controls');
        if (controlsEl) {
            mediaControlBarInstance = new MediaControlBar(controlsEl);
            mediaControlBarInstance.attachAutoHide(lightbox);
        }
    }

    const urlLower = mediaUrl.toLowerCase();
    const isGif = urlLower.endsWith('.gif');
    const isWebp = urlLower.endsWith('.webp');

    if (mediaType === 'image') {
        // Hide video
        lightboxVideo.style.display = 'none';
        stopLightboxGifProgress();

        if ((isGif || isWebp) && playbackControlsEnabled) {
            // Show <img> immediately as a preview while we fetch + decode frames
            lightboxGifCanvas.style.display = 'none';
            lightboxImage.style.display = 'block';
            lightboxImage.style.transform = 'scale(1)';
            lightboxImage.style.maxWidth = '90vw';
            lightboxImage.style.maxHeight = '90vh';
            lightboxImage.style.width = 'auto';
            lightboxImage.style.height = 'auto';
            lightboxImage.dataset.src = mediaUrl;
            lightbox.classList.remove('hidden');
            // Track when the <img> actually starts animating (on load, not on src set)
            let imgAnimStart = 0;
            const onImgLoad = () => { imgAnimStart = performance.now(); };
            lightboxImage.addEventListener('load', onImgLoad, { once: true });
            lightboxImage.src = mediaUrl;

            // Fetch binary and swap to canvas controller once decoded
            fetch(mediaUrl).then(r => r.arrayBuffer()).then(async buffer => {
                // For WebP, check if it's actually animated before using canvas controller
                if (isWebp) {
                    const parsed = parseWebpDuration(buffer);
                    if (!parsed || parsed.frameCount <= 1) {
                        // Static WebP — already showing as <img>, just hide controls
                        if (mediaControlBarInstance) mediaControlBarInstance.hide();
                        return;
                    }
                }

                // Decode frames into canvas controller
                const controller = new AnimatedImagePlaybackController(lightboxGifCanvas, buffer);
                await controller.ready;

                // Swap from <img> preview to canvas
                lightboxImage.style.display = 'none';
                lightboxGifCanvas.style.display = 'block';
                lightboxGifCanvas.style.transform = 'scale(1)';
                lightboxGifCanvas.style.maxWidth = '90vw';
                lightboxGifCanvas.style.maxHeight = '90vh';
                activePlaybackController = controller;

                // Bind control bar
                if (mediaControlBarInstance) {
                    mediaControlBarInstance.bind(controller);
                    mediaControlBarInstance.syncState({ speed: videoPlaybackSpeed, loop: videoLoop, repeat: videoRepeat });
                }

                // Zoom to fit using decoded dimensions
                requestAnimationFrame(() => {
                    const rect = lightboxGifCanvas.getBoundingClientRect();
                    lightboxGifCanvas.dataset.baseWidth = rect.width.toString();
                    lightboxGifCanvas.dataset.baseHeight = rect.height.toString();
                    const fitLevel = calculateFitZoomLevel(controller.gifWidth, controller.gifHeight);
                    if (zoomToFit && fitLevel > 100) {
                        applyLightboxZoom(fitLevel);
                    }
                });

                // Seek to match where the <img> animation was to avoid a visible restart
                lightboxImage.removeEventListener('load', onImgLoad);
                if (imgAnimStart > 0 && controller.duration > 0) {
                    const elapsed = (performance.now() - imgAnimStart) / 1000;
                    controller.seek(elapsed % controller.duration);
                }
                controller.play();
            }).catch(err => {
                console.error('Failed to load animated image for playback:', err);
                // Already showing <img> as fallback, nothing else needed
            });

            lightboxGifCanvas.dataset.src = mediaUrl;
        } else {
            // Static image (non-GIF, non-WebP)
            _showStaticImage(mediaUrl, lightboxImage, lightboxGifCanvas, lightbox, mediaControlBarInstance);
        }
    } else {
        stopLightboxGifProgress();
        // Hide image and canvas, show video
        lightboxImage.style.display = 'none';
        lightboxGifCanvas.style.display = 'none';
        lightboxVideo.style.display = 'block';
        lightboxVideo.src = mediaUrl;
        lightboxVideo.dataset.src = mediaUrl;
        lightbox.classList.remove('hidden');
        lightboxVideo.style.transform = 'scale(1)';
        lightboxVideo.style.maxWidth = '90vw';
        lightboxVideo.style.maxHeight = '90vh';

        // Create video playback controller
        const controller = new VideoPlaybackController(lightboxVideo);
        activePlaybackController = controller;

        // Apply persisted settings
        controller.setSpeed(videoPlaybackSpeed);
        controller.setLoop(videoLoop);
        controller.setRepeat(videoRepeat);

        // Bind control bar
        if (mediaControlBarInstance) {
            mediaControlBarInstance.bind(controller);
        }

        // Zoom to fit
        const handleVideoMeta = () => {
            requestAnimationFrame(() => {
                const fitLevel = calculateFitZoomLevel(lightboxVideo.videoWidth, lightboxVideo.videoHeight);
                if (zoomToFit && fitLevel > 100) {
                    const rect = lightboxVideo.getBoundingClientRect();
                    lightboxVideo.dataset.baseWidth = rect.width.toString();
                    lightboxVideo.dataset.baseHeight = rect.height.toString();
                    applyLightboxZoom(fitLevel);
                }
            });
            lightboxVideo.removeEventListener('loadedmetadata', handleVideoMeta);
        };
        if (lightboxVideo.videoWidth > 0) {
            handleVideoMeta();
        } else {
            lightboxVideo.addEventListener('loadedmetadata', handleVideoMeta);
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
    const canvasInlineDisplay = lightboxGifCanvas.style.display;
    const isImageVisible = imageInlineDisplay === 'block' ||
                          (imageInlineDisplay === '' && window.getComputedStyle(lightboxImage).display !== 'none');
    const isVideoVisible = videoInlineDisplay === 'block' ||
                          (videoInlineDisplay === '' && window.getComputedStyle(lightboxVideo).display !== 'none');
    const isCanvasVisible = canvasInlineDisplay === 'block' ||
                          (canvasInlineDisplay === '' && window.getComputedStyle(lightboxGifCanvas).display !== 'none');

    // Reset translation when zooming back to 100% or below
    if (zoomLevel <= 100) {
        currentTranslateX = 0;
        currentTranslateY = 0;
    } else if (mouseX !== null && mouseY !== null && zoomLevel > 100) {
        // Zoom at pointer position: adjust translate to keep the point under cursor fixed
        // Get the visible element
        const visibleElement = isCanvasVisible ? lightboxGifCanvas : (isImageVisible ? lightboxImage : (isVideoVisible ? lightboxVideo : null));
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
    
    // Special handling for the transition from 100% to >100% on images/canvas
    // Capture the current displayed size before removing constraints
    const zoomableImageEl = isCanvasVisible ? lightboxGifCanvas : lightboxImage;
    if ((isImageVisible || isCanvasVisible) && previousZoomLevel === 100 && zoomLevel > 100) {
        const rect = zoomableImageEl.getBoundingClientRect();
        zoomableImageEl.dataset.baseWidth = rect.width.toString();
        zoomableImageEl.dataset.baseHeight = rect.height.toString();
    }

    // Build transform string
    let transformString;
    if (zoomLevel <= 100) {
        transformString = `scale(${zoomValue})`;
    } else {
        transformString = `translate(${currentTranslateX}px, ${currentTranslateY}px) scale(${zoomValue})`;
    }

    // Apply to all media elements
    lightboxImage.style.transform = transformString;
    lightboxVideo.style.transform = transformString;
    lightboxGifCanvas.style.transform = transformString;

    if (zoomLevel > 100) {
        lightboxImage.classList.add('zoomed');
        lightboxVideo.classList.add('zoomed');
        lightboxGifCanvas.classList.add('zoomed');

        if ((isImageVisible || isCanvasVisible) && zoomableImageEl.dataset.baseWidth) {
            const baseWidth = parseFloat(zoomableImageEl.dataset.baseWidth);
            const baseHeight = parseFloat(zoomableImageEl.dataset.baseHeight);
            zoomableImageEl.style.width = `${baseWidth}px`;
            zoomableImageEl.style.height = `${baseHeight}px`;
            zoomableImageEl.style.maxWidth = 'none';
            zoomableImageEl.style.maxHeight = 'none';
        } else {
            lightboxImage.style.maxWidth = 'none';
            lightboxImage.style.maxHeight = 'none';
            lightboxVideo.style.maxWidth = 'none';
            lightboxVideo.style.maxHeight = 'none';
            lightboxGifCanvas.style.maxWidth = 'none';
            lightboxGifCanvas.style.maxHeight = 'none';
        }
    } else {
        lightboxImage.classList.remove('zoomed');
        lightboxVideo.classList.remove('zoomed');
        lightboxGifCanvas.classList.remove('zoomed');
        lightboxImage.style.maxWidth = '90vw';
        lightboxImage.style.maxHeight = '90vh';
        lightboxImage.style.width = 'auto';
        lightboxImage.style.height = 'auto';
        delete lightboxImage.dataset.baseWidth;
        delete lightboxImage.dataset.baseHeight;
        lightboxVideo.style.maxWidth = '90vw';
        lightboxVideo.style.maxHeight = '90vh';
        lightboxGifCanvas.style.maxWidth = '90vw';
        lightboxGifCanvas.style.maxHeight = '90vh';
        lightboxGifCanvas.style.width = '';
        lightboxGifCanvas.style.height = '';
        delete lightboxGifCanvas.dataset.baseWidth;
        delete lightboxGifCanvas.dataset.baseHeight;
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
    const canvasDisplay = lightboxGifCanvas.style.display;
    const isImageVisible = imageDisplay === 'block' ||
                          (imageDisplay === '' && window.getComputedStyle(lightboxImage).display !== 'none');
    const isVideoVisible = videoDisplay === 'block' ||
                          (videoDisplay === '' && window.getComputedStyle(lightboxVideo).display !== 'none');
    const isCanvasVisible = canvasDisplay === 'block' ||
                          (canvasDisplay === '' && window.getComputedStyle(lightboxGifCanvas).display !== 'none');

    if (isImageVisible) lightboxImage.style.transform = transformString;
    if (isVideoVisible) lightboxVideo.style.transform = transformString;
    if (isCanvasVisible) lightboxGifCanvas.style.transform = transformString;
}

function resetZoom() {
    currentZoomLevel = 100;
    currentTranslateX = 0;
    currentTranslateY = 0;
    lightboxImage.style.transform = 'scale(1)';
    lightboxVideo.style.transform = 'scale(1)';
    lightboxGifCanvas.style.transform = 'scale(1)';
    lightboxImage.classList.remove('zoomed');
    lightboxVideo.classList.remove('zoomed');
    lightboxGifCanvas.classList.remove('zoomed');
    // Reset max constraints and explicit dimensions
    lightboxImage.style.maxWidth = '90vw';
    lightboxImage.style.maxHeight = '90vh';
    lightboxImage.style.width = 'auto';
    lightboxImage.style.height = 'auto';
    lightboxVideo.style.maxWidth = '90vw';
    lightboxVideo.style.maxHeight = '90vh';
    lightboxGifCanvas.style.maxWidth = '90vw';
    lightboxGifCanvas.style.maxHeight = '90vh';
    lightboxGifCanvas.style.width = '';
    lightboxGifCanvas.style.height = '';
    // Clear stored base dimensions
    delete lightboxImage.dataset.baseWidth;
    delete lightboxImage.dataset.baseHeight;
    delete lightboxGifCanvas.dataset.baseWidth;
    delete lightboxGifCanvas.dataset.baseHeight;
    if (lightboxZoomSlider) {
        lightboxZoomSlider.value = 100;
    }
    if (lightboxZoomValue) {
        lightboxZoomValue.textContent = '100%';
    }
}

function closeLightbox() {
    hideContextMenu();

    // Persist playback settings from controller before destroying
    if (activePlaybackController) {
        videoPlaybackSpeed = activePlaybackController.getSpeed();
        videoLoop = activePlaybackController.getLoop();
        videoRepeat = activePlaybackController.getRepeat();
        activePlaybackController.destroy();
        activePlaybackController = null;
    }

    // Hide control bar
    if (mediaControlBarInstance) {
        mediaControlBarInstance.unbind();
        mediaControlBarInstance.hide();
    }

    // Clean up video
    lightboxVideo.removeEventListener('ended', handleVideoRepeat);
    lightboxVideo.pause();
    lightboxVideo.src = "";
    lightboxVideo.removeAttribute('src');

    // Clean up image
    lightboxImage.src = "";
    lightboxImage.removeAttribute('src');

    // Clean up GIF canvas
    lightboxGifCanvas.style.display = 'none';
    const gifCtx = lightboxGifCanvas.getContext('2d');
    if (gifCtx) gifCtx.clearRect(0, 0, lightboxGifCanvas.width, lightboxGifCanvas.height);

    // Stop lightbox GIF progress bar
    stopLightboxGifProgress();

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
    if (e.target === lightbox && contextMenu.classList.contains('hidden')) {
        closeLightbox();
    }
});

lightbox.addEventListener('contextmenu', (e) => {
    // Don't intercept right-clicks on controls
    if (e.target.closest('.lightbox-zoom-controls') ||
        e.target.closest('.media-controls') ||
        e.target.closest('.lightbox-file-info') ||
        e.target.closest('#close-lightbox') ||
        e.target.closest('.lightbox-nav-btn')) {
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    showLightboxContextMenu(e);
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
    const newZoomLevel = Math.max(30, Math.min(lightboxMaxZoomSetting, currentZoomLevel + zoomDelta));
    
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
if (lightboxGifCanvas) {
    lightboxGifCanvas.addEventListener('wheel', handleLightboxWheel, { passive: false });
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
    const canvasDisplay = lightboxGifCanvas.style.display;
    const isImageVisible = imageDisplay === 'block' ||
                          (imageDisplay === '' && window.getComputedStyle(lightboxImage).display !== 'none');
    const isVideoVisible = videoDisplay === 'block' ||
                          (videoDisplay === '' && window.getComputedStyle(lightboxVideo).display !== 'none');
    const isCanvasVisible = canvasDisplay === 'block' ||
                          (canvasDisplay === '' && window.getComputedStyle(lightboxGifCanvas).display !== 'none');

    if (isImageVisible) lightboxImage.style.transform = transformString;
    if (isVideoVisible) lightboxVideo.style.transform = transformString;
    if (isCanvasVisible) lightboxGifCanvas.style.transform = transformString;
    
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
        hasDragged = false;
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

lightboxGifCanvas.addEventListener('mousedown', (e) => {
    if (currentZoomLevel > 100 && e.button === 0) {
        isDragging = true;
        hasDragged = false;
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

// Click on video or canvas to toggle play/pause (but not after dragging)
lightboxVideo.addEventListener('click', (e) => {
    if (hasDragged && currentZoomLevel > 100) {
        e.preventDefault();
        e.stopPropagation();
        hasDragged = false;
        return;
    }
    if (activePlaybackController) {
        activePlaybackController.togglePlay();
    }
}, true);

lightboxGifCanvas.addEventListener('click', (e) => {
    if (hasDragged && currentZoomLevel > 100) {
        e.preventDefault();
        e.stopPropagation();
        hasDragged = false;
        return;
    }
    if (activePlaybackController) {
        activePlaybackController.togglePlay();
    }
});

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

// --- Copy Image to Clipboard ---

async function copyImageToClipboardFromElement(element) {
    try {
        let canvas;
        if (element instanceof HTMLCanvasElement) {
            canvas = element;
        } else if (element instanceof HTMLVideoElement) {
            const w = element.videoWidth, h = element.videoHeight;
            if (!w || !h) { showToast('Video not ready', 'error'); return false; }
            canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(element, 0, 0, w, h);
        } else if (element instanceof HTMLImageElement) {
            const w = element.naturalWidth, h = element.naturalHeight;
            if (!w || !h) { showToast('Image not loaded', 'error'); return false; }
            canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(element, 0, 0, w, h);
        } else {
            showToast('Cannot copy this media type', 'error');
            return false;
        }
        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('Failed to create blob')), 'image/png');
        });
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return true;
    } catch (error) {
        console.error('Failed to copy image:', error);
        showToast('Failed to copy image', 'error');
        return false;
    }
}

const copyImageBtn = document.getElementById('copy-image-btn');
if (copyImageBtn) {
    copyImageBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const filePath = copyPathBtn.dataset.filePath;
        let success = false;
        // For video frames, capture from canvas since there's no image file
        if (lightboxVideo.style.display !== 'none' && lightboxVideo.src) {
            success = await copyImageToClipboardFromElement(lightboxVideo);
        } else if (filePath) {
            // For images and GIFs, copy the actual file for paste in file explorers
            try {
                const result = await window.electronAPI.copyImageToClipboard(filePath);
                success = result.success;
                if (!success) showToast(`Could not copy image: ${friendlyError(result.error)}`, 'error');
            } catch (error) {
                showToast(`Could not copy image: ${friendlyError(error)}`, 'error');
            }
        } else {
            showToast('No image to copy', 'error');
            return;
        }
        if (success) {
            const originalText = copyImageBtn.textContent;
            copyImageBtn.textContent = 'Copied!';
            setTimeout(() => { copyImageBtn.textContent = originalText; }, 1000);
        }
    });
}

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
    const card = e.target.closest('.video-card') || e.target.closest('.duplicate-item');
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

// --- Context Menu Functionality ---
const folderContextMenu = document.getElementById('folder-context-menu');

function showLightboxContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();

    contextMenuSource = 'lightbox';

    const filePath = window.currentLightboxFilePath;
    if (!filePath) return;
    const fileName = filePath.split(/[\\/]/).pop();

    // Virtual card object so the existing action handler works unchanged
    contextMenuTargetCard = {
        dataset: { path: filePath },
        querySelector: (sel) => sel === '.video-info' ? { textContent: fileName } : null,
        classList: { contains: () => false }
    };

    // Hide folder menu
    folderContextMenu.classList.add('hidden');

    // Update pin/unpin label
    const pinned = isFilePinned(filePath);
    const pinLabel = contextMenu.querySelector('.pin-label');
    if (pinLabel) pinLabel.textContent = pinned ? 'Unpin' : 'Pin to Top';

    // Show/hide items appropriate for lightbox (single file, no multi-select)
    const batchRenameItem = contextMenu.querySelector('[data-action="batch-rename"]');
    if (batchRenameItem) batchRenameItem.style.display = 'none';
    const compareItem = contextMenu.querySelector('[data-action="compare"]');
    if (compareItem) compareItem.style.display = 'none';
    const slideshowItem = contextMenu.querySelector('[data-action="slideshow"]');
    if (slideshowItem) slideshowItem.style.display = 'none';

    // Show single-file actions
    const openItem = contextMenu.querySelector('[data-action="open"]');
    if (openItem) openItem.style.display = '';
    const openWithItem = contextMenu.querySelector('[data-action="open-with"]');
    if (openWithItem) openWithItem.style.display = '';
    const renameItem = contextMenu.querySelector('[data-action="rename"]');
    if (renameItem) renameItem.style.display = '';
    const revealItem = contextMenu.querySelector('[data-action="reveal"]');
    if (revealItem) revealItem.style.display = '';
    const copyFileItem = contextMenu.querySelector('[data-action="copy-file"]');
    if (copyFileItem) copyFileItem.style.display = '';
    const pinItem = contextMenu.querySelector('[data-action="pin"]');
    if (pinItem) pinItem.style.display = '';
    const addToColItem = contextMenu.querySelector('[data-action="add-to-collection"]');
    if (addToColItem) addToColItem.style.display = '';
    const tagItem = contextMenu.querySelector('[data-action="tag-file"]');
    if (tagItem) tagItem.style.display = '';
    const autoTagItem = contextMenu.querySelector('[data-action="auto-tag"]');
    if (autoTagItem) autoTagItem.style.display = '';
    const deleteItem = contextMenu.querySelector('[data-action="delete"]');
    if (deleteItem) deleteItem.style.display = '';

    // Show/hide Remove from Collection
    const removeFromColItem = contextMenu.querySelector('[data-action="remove-from-collection"]');
    if (removeFromColItem) {
        if (currentCollectionId) {
            const col = collectionsCache.find(c => c.id === currentCollectionId);
            removeFromColItem.style.display = (col && col.type === 'static') ? '' : 'none';
        } else {
            removeFromColItem.style.display = 'none';
        }
    }

    // Find Similar — only when AI visual search enabled
    const findSimilarItem = contextMenu.querySelector('[data-action="find-similar"]');
    if (findSimilarItem) findSimilarItem.style.display = aiVisualSearchEnabled ? '' : 'none';

    // Inject plugin items
    contextMenu.querySelectorAll('.context-menu-item[data-plugin], .context-menu-plugin-separator').forEach(el => el.remove());
    getPluginMenuItems().then(items => {
        if (!items.length) return;
        const separator = document.createElement('div');
        separator.className = 'context-menu-separator context-menu-plugin-separator';
        contextMenu.appendChild(separator);
        for (const item of items) {
            const el = document.createElement('div');
            el.className = 'context-menu-item';
            el.dataset.action = `plugin:${item.pluginId}:${item.id}`;
            el.dataset.plugin = item.pluginId;
            el.textContent = item.label;
            contextMenu.appendChild(el);
        }
    });

    // Position at mouse
    const x = event.clientX;
    const y = event.clientY;
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.remove('hidden');

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

function showContextMenu(event, card) {
    event.preventDefault();
    event.stopPropagation();

    contextMenuSource = 'grid';
    contextMenuTargetCard = card;
    const isFolder = card.classList.contains('folder-card');

    // Multi-select context menu behavior:
    // If right-clicking an unselected card while others are selected, select only this card.
    // If right-clicking a selected card, keep the entire selection.
    if (!isFolder && card.dataset.path) {
        if (!selectedCardPaths.has(card.dataset.path)) {
            clearCardSelection();
            selectedCardPaths.add(card.dataset.path);
            card.classList.add('selected');
            lastSelectedCardIndex = getItemIndexForCard(card);
            updateSelectionStatusBar();
        }
    }

    const menu = isFolder ? folderContextMenu : contextMenu;
    // Hide the other menu
    const otherMenu = isFolder ? contextMenu : folderContextMenu;
    otherMenu.classList.add('hidden');

    // Update pin/unpin label dynamically
    const itemPath = isFolder ? card.dataset.folderPath : card.dataset.path;
    const pinned = isFilePinned(itemPath);
    const pinLabel = menu.querySelector('.pin-label');
    if (pinLabel) pinLabel.textContent = pinned ? 'Unpin' : 'Pin to Top';

    // Show/hide collection-specific context menu items
    if (!isFolder) {
        const addToColItem = menu.querySelector('[data-action="add-to-collection"]');
        let removeFromColItem = menu.querySelector('[data-action="remove-from-collection"]');

        // Always show "Add to Collection"
        if (addToColItem) addToColItem.style.display = '';

        // Show/create "Remove from Collection" only when viewing a static collection
        if (currentCollectionId) {
            const col = collectionsCache.find(c => c.id === currentCollectionId);
            if (col && col.type === 'static') {
                if (!removeFromColItem) {
                    removeFromColItem = document.createElement('div');
                    removeFromColItem.className = 'context-menu-item';
                    removeFromColItem.dataset.action = 'remove-from-collection';
                    removeFromColItem.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="8" x2="16" y1="12" y2="12"/></svg> Remove from Collection';
                    addToColItem.insertAdjacentElement('afterend', removeFromColItem);
                }
                removeFromColItem.style.display = '';
            } else if (removeFromColItem) {
                removeFromColItem.style.display = 'none';
            }
        } else if (removeFromColItem) {
            removeFromColItem.style.display = 'none';
        }
    }

    // Show/hide batch rename + compare based on multi-select
    if (!isFolder) {
        const selectedCards = document.querySelectorAll('.video-card.selected');
        const selCount = selectedCards.length;
        const batchRenameItem = menu.querySelector('[data-action="batch-rename"]');
        if (batchRenameItem) batchRenameItem.style.display = selCount > 1 ? '' : 'none';
        const compareItem = menu.querySelector('[data-action="compare"]');
        if (compareItem) compareItem.style.display = (selCount >= 2 && selCount <= 4) ? '' : 'none';
    }

    // Show/hide "Find Similar" — only for images when AI visual search is enabled
    if (!isFolder) {
        const findSimilarItem = menu.querySelector('[data-action="find-similar"]');
        if (findSimilarItem) {
            findSimilarItem.style.display = aiVisualSearchEnabled ? '' : 'none';
        }
    }

    // Inject / refresh plugin menu items (file menus only)
    if (!isFolder) {
        // Remove any previously injected plugin items and their separator
        menu.querySelectorAll('.context-menu-item[data-plugin], .context-menu-plugin-separator').forEach(el => el.remove());
        // Load and inject asynchronously — menu is already visible so items appear shortly after
        getPluginMenuItems().then(items => {
            if (!items.length) return;
            const separator = document.createElement('div');
            separator.className = 'context-menu-separator context-menu-plugin-separator';
            menu.appendChild(separator);
            for (const item of items) {
                const el = document.createElement('div');
                el.className = 'context-menu-item';
                el.dataset.action = `plugin:${item.pluginId}:${item.id}`;
                el.dataset.plugin = item.pluginId;
                el.textContent = item.label;
                menu.appendChild(el);
            }
        });
    }

    const x = event.clientX;
    const y = event.clientY;

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.classList.remove('hidden');

    requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = `${window.innerWidth - rect.width - 10}px`;
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = `${window.innerHeight - rect.height - 10}px`;
        }
    });
}

function hideContextMenu() {
    contextMenu.classList.add('hidden');
    folderContextMenu.classList.add('hidden');
    contextMenuTargetCard = null;
}

// Hide context menus on Escape (stopImmediatePropagation prevents lightbox from also closing)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const wasMenuVisible = !contextMenu.classList.contains('hidden') || !folderContextMenu.classList.contains('hidden');
        hideContextMenu();
        if (favContextMenu) hideFavContextMenu();
        if (findSimilarActive) { clearFindSimilar(); return; }
        if (wasMenuVisible) {
            e.stopImmediatePropagation();
            return;
        }
    }
});

// Hide context menus when clicking elsewhere
document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target) && !folderContextMenu.contains(e.target)) {
        hideContextMenu();
    }
    if (favContextMenu && !favContextMenu.contains(e.target)) {
        hideFavContextMenu();
    }
});

// Handle context menu item clicks
contextMenu.addEventListener('click', async (e) => {
    const action = e.target.closest('.context-menu-item')?.dataset.action || e.target.dataset.action;
    if (!action || !contextMenuTargetCard) return;

    const filePath = contextMenuTargetCard.dataset.path;
    if (!filePath) return;

    // Store the file name before hiding the menu (since we clear contextMenuTargetCard)
    const fileNameElement = contextMenuTargetCard.querySelector('.video-info');
    const fileName = fileNameElement ? fileNameElement.textContent : '';

    hideContextMenu();

    switch (action) {
        case 'pin': {
            const pinned = isFilePinned(filePath);
            setFilePinned(filePath, !pinned);
            applySorting();
            showToast(pinned ? `Unpinned "${fileName}"` : `Pinned "${fileName}" to top`, 'success');
            break;
        }
        case 'reveal':
            try {
                await window.electronAPI.revealInExplorer(filePath);
            } catch (error) {
                showToast(`Could not reveal file: ${friendlyError(error)}`, 'error');
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

        case 'batch-rename': {
            const selectedCards = document.querySelectorAll('.video-card.selected');
            const renamePaths = selectedCards.length > 1
                ? Array.from(selectedCards).map(c => c.dataset.path).filter(Boolean)
                : [filePath];
            if (renamePaths.length < 2) {
                showToast('Select 2 or more files for batch rename', 'info');
            } else {
                openBatchRename(renamePaths);
            }
            break;
        }

        case 'delete':
            try {
                const deleteLabel = useSystemTrash ? 'Move to Recycle Bin' : 'Delete';
                if (await showConfirm(deleteLabel, `${deleteLabel} "${fileName}"?`, { confirmLabel: deleteLabel, danger: true })) {
                    setStatusActivity(`Deleting ${fileName}...`);
                    const result = await window.electronAPI.deleteFile(filePath);
                    setStatusActivity('');
                    if (result.success) {
                        const toastOpts = result.trashed
                            ? { duration: 4000 }
                            : {
                                duration: 8000,
                                actionLabel: 'Undo',
                                actionCallback: () => {
                                    window.electronAPI.undoFileOperation().then(undoResult => {
                                        if (undoResult.success) {
                                            showToast(`Restored "${fileName}"`, 'success');
                                            if (currentFolderPath) {
                                                invalidateFolderCache(currentFolderPath);
                                                const st = gridContainer.scrollTop;
                                                loadVideos(currentFolderPath, false, st);
                                            }
                                        } else {
                                            showToast(`Undo failed: ${undoResult.error}`, 'error');
                                        }
                                    });
                                }
                            };
                        const toastMsg = result.trashed ? `Moved "${fileName}" to Recycle Bin` : `Deleted "${fileName}"`;
                        showToast(toastMsg, 'success', toastOpts);
                        if (currentFolderPath) {
                            invalidateFolderCache(currentFolderPath);
                            const previousScrollTop = gridContainer.scrollTop;
                            await loadVideos(currentFolderPath, false, previousScrollTop);
                        }
                        // Navigate lightbox after delete
                        if (isLightboxOpen && contextMenuSource === 'lightbox') {
                            const delIdx = lightboxItems.findIndex(it => it.path === filePath);
                            if (delIdx !== -1) lightboxItems.splice(delIdx, 1);
                            if (lightboxItems.length === 0) {
                                closeLightbox();
                            } else {
                                currentLightboxIndex = Math.min(delIdx, lightboxItems.length - 1);
                                const next = lightboxItems[currentLightboxIndex];
                                openLightbox(next.url, next.path, next.name);
                            }
                        }
                    } else {
                        showToast(`Could not delete file: ${friendlyError(result.error)}`, 'error');
                    }
                }
            } catch (error) {
                showToast(`Could not delete file: ${friendlyError(error)}`, 'error');
            }
            break;

        case 'open':
            try {
                await window.electronAPI.openWithDefault(filePath);
            } catch (error) {
                showToast(`Could not open file: ${friendlyError(error)}`, 'error');
            }
            break;

        case 'open-with':
            try {
                await window.electronAPI.openWith(filePath);
            } catch (error) {
                showToast(`Could not open file: ${friendlyError(error)}`, 'error');
            }
            break;

        case 'copy-file': {
            try {
                const result = await window.electronAPI.copyImageToClipboard(filePath);
                if (result.success) {
                    showToast('Copied to clipboard', 'success');
                } else {
                    showToast(`Could not copy: ${friendlyError(result.error)}`, 'error');
                }
            } catch (error) {
                showToast(`Could not copy: ${friendlyError(error)}`, 'error');
            }
            break;
        }

        case 'add-to-collection': {
            // Gather selected files (multi-select support)
            const selectedCards = document.querySelectorAll('.video-card.selected');
            const paths = selectedCards.length > 1
                ? Array.from(selectedCards).map(c => c.dataset.path).filter(Boolean)
                : [filePath];
            showAddToCollectionSubmenu(paths, e.clientX || e.pageX || 200, e.clientY || e.pageY || 200);
            break;
        }

        case 'tag-file': {
            const selectedCards = document.querySelectorAll('.video-card.selected');
            const tagPaths = selectedCards.length > 1
                ? Array.from(selectedCards).map(c => c.dataset.path).filter(Boolean)
                : [filePath];
            openTagPicker(tagPaths);
            break;
        }

        case 'auto-tag': {
            const selectedCards = document.querySelectorAll('.video-card.selected');
            const autoTagPaths = selectedCards.length > 1
                ? Array.from(selectedCards).map(c => c.dataset.path).filter(Boolean)
                : [filePath];
            const supportedPaths = autoTagPaths.filter(p => {
                const ext = p.split('.').pop().toLowerCase();
                return ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'ogg'].includes(ext);
            });
            if (supportedPaths.length === 0) {
                showToast('Auto-tag only works with image or video files', 'info');
            } else {
                openAutoTag(supportedPaths);
            }
            break;
        }

        case 'remove-from-collection': {
            if (currentCollectionId) {
                await removeFileFromCollection(currentCollectionId, filePath);
                showToast(`Removed "${fileName}" from collection`, 'success');
                loadCollectionIntoGrid(currentCollectionId);
                renderCollectionsSidebar();
            }
            break;
        }

        case 'find-similar': {
            const ext = filePath.split('.').pop().toLowerCase();
            const imgExts = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'];
            if (!imgExts.includes(ext)) {
                showToast('Find Similar works with image files', 'info');
                break;
            }
            if (!aiVisualSearchEnabled) {
                showToast('Enable AI Visual Search in Settings first', 'info');
                break;
            }
            activateFindSimilar(filePath, fileName);
            break;
        }

        case 'compare': {
            const selCards = document.querySelectorAll('.video-card.selected');
            const paths = selCards.length >= 2
                ? Array.from(selCards).map(c => c.dataset.path).filter(Boolean)
                : [filePath];
            openCompareMode(paths);
            break;
        }

        case 'slideshow': {
            startSlideshow();
            break;
        }

        default:
            if (action.startsWith('plugin:')) {
                const [, pluginId, actionId] = action.split(':');
                try {
                    const result = await window.electronAPI.executePluginAction(pluginId, actionId, filePath, null);
                    if (!result.success) {
                        showToast(`Plugin action failed: ${friendlyError(result.error)}`, 'error');
                    } else if (result.result?.json) {
                        // If the plugin returned JSON text, copy it to clipboard
                        navigator.clipboard.writeText(result.result.json).then(() => {
                            showToast('Copied to clipboard', 'success');
                        });
                    }
                } catch (error) {
                    showToast(`Plugin error: ${friendlyError(error)}`, 'error');
                }
            }
            break;
    }
});

// Prevent default context menu on cards and show custom menu
document.addEventListener('contextmenu', (e) => {
    // Suppress context menu when blow-up hold is active
    if (blowUpSuppressContextMenu) {
        e.preventDefault();
        e.stopPropagation();
        // Reset the flag now that the contextmenu event has been consumed
        blowUpSuppressContextMenu = false;
        return;
    }

    const card = e.target.closest('.video-card') || e.target.closest('.folder-card');
    if (card) {
        showContextMenu(e, card);
    }
});

// Folder context menu actions
folderContextMenu.addEventListener('click', async (e) => {
    const action = e.target.closest('.context-menu-item')?.dataset.action;
    if (!action || !contextMenuTargetCard) return;

    const folderPath = contextMenuTargetCard.dataset.folderPath;
    if (!folderPath) return;

    const folderName = folderPath.split(/[/\\]/).pop();
    hideContextMenu();

    switch (action) {
        case 'pin-folder': {
            const pinned = isFilePinned(folderPath);
            setFilePinned(folderPath, !pinned);
            applySorting();
            showToast(pinned ? `Unpinned "${folderName}"` : `Pinned "${folderName}" to top`, 'success');
            break;
        }
        case 'open-folder':
            await navigateToFolder(folderPath);
            break;

        case 'open-folder-new-tab':
            createTab(folderPath, folderName);
            break;

        case 'rename-folder':
            renamePendingFile = { filePath: folderPath, fileName: folderName };
            renameInput.value = folderName;
            renameDialog.classList.remove('hidden');
            renameInput.focus();
            renameInput.select();
            break;

        case 'reveal-folder':
            try {
                await window.electronAPI.revealInExplorer(folderPath);
            } catch (error) {
                showToast(`Could not reveal folder: ${friendlyError(error)}`, 'error');
            }
            break;

        case 'delete-folder':
            try {
                if (await showConfirm('Delete Folder', `Delete "${folderName}"?`, { confirmLabel: 'Delete', danger: true })) {
                    setStatusActivity(`Deleting ${folderName}...`);
                    const result = await window.electronAPI.deleteFile(folderPath);
                    setStatusActivity('');
                    if (result.success) {
                        showToast(`Deleted "${folderName}"`, 'success', {
                            duration: 8000,
                            actionLabel: 'Undo',
                            actionCallback: () => {
                                window.electronAPI.undoFileOperation().then(undoResult => {
                                    if (undoResult.success) {
                                        showToast(`Restored "${folderName}"`, 'success');
                                        if (currentFolderPath) {
                                            invalidateFolderCache(currentFolderPath);
                                            const st = gridContainer.scrollTop;
                                            loadVideos(currentFolderPath, false, st);
                                        }
                                    } else {
                                        showToast(`Undo failed: ${undoResult.error}`, 'error');
                                    }
                                });
                            }
                        });
                        if (currentFolderPath) {
                            invalidateFolderCache(currentFolderPath);
                            const previousScrollTop = gridContainer.scrollTop;
                            await loadVideos(currentFolderPath, false, previousScrollTop);
                        }
                    } else {
                        showToast(`Could not delete folder: ${friendlyError(result.error)}`, 'error');
                    }
                }
            } catch (error) {
                showToast(`Could not delete folder: ${friendlyError(error)}`, 'error');
            }
            break;
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
            const oldPath = renamePendingFile.filePath;
            renamePendingFile = null;
            showToast(`Renamed to "${newName}"`, 'success');
            // Refresh in-memory ratings/pins so the new path inherits metadata
            await Promise.all([loadRatings(), loadPins()]);
            if (currentFolderPath) {
                invalidateFolderCache(currentFolderPath);
                const previousScrollTop = gridContainer.scrollTop;
                await loadVideos(currentFolderPath, false, previousScrollTop);
            }
            // Update lightbox state after rename
            if (isLightboxOpen && contextMenuSource === 'lightbox') {
                const dir = oldPath.substring(0, oldPath.lastIndexOf(oldPath.includes('/') ? '/' : '\\') + 1);
                const newPath = dir + newName;
                const newUrl = 'file:///' + newPath.replace(/\\/g, '/');
                window.currentLightboxFilePath = newPath;
                window.currentLightboxFileUrl = newUrl;
                const filenameEl = document.getElementById('lightbox-filename');
                if (filenameEl) filenameEl.textContent = newName;
                // Update lightboxItems entry
                const idx = lightboxItems.findIndex(it => it.path === oldPath);
                if (idx !== -1) {
                    lightboxItems[idx].path = newPath;
                    lightboxItems[idx].name = newName;
                    lightboxItems[idx].url = newUrl;
                }
            }
        } else {
            showToast(`Could not rename: ${friendlyError(result.error)}`, 'error');
        }
    } catch (error) {
        showToast(`Could not rename: ${friendlyError(error)}`, 'error');
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

        if (result.success) {
            closeBatchRename();
            const failedResults = (result.results || []).filter(r => r.success === false);
            if (failedResults.length > 0) {
                const errorSummary = groupBatchErrors(failedResults);
                showToast(
                    `Renamed ${result.successCount} of ${result.totalCount} files`,
                    'warning',
                    { details: `${failedResults.length} failed: ${errorSummary}`, duration: 8000 }
                );
            } else {
                showToast(`Renamed ${result.successCount} of ${result.totalCount} files`, 'success');
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

let autoTagFilePaths = [];
let autoTagData = []; // [{ path, name, thumbUrl, suggestions: [{ label, score }] }]
let autoTagLabelEmbeddings = null; // Map<label, Float32Array>

function closeAutoTag() {
    autoTagOverlay.classList.add('hidden');
    autoTagFilePaths = [];
    autoTagData = [];
}

async function embedTagLabels() {
    // Always re-embed since tags may have changed since last call
    await refreshTagsCache();

    if (allTagsCache.length === 0) return false;

    autoTagLabelEmbeddings = new Map();
    for (let i = 0; i < allTagsCache.length; i++) {
        const tag = allTagsCache[i];
        autoTagStatus.textContent = `Embedding tags... ${i + 1}/${allTagsCache.length}`;
        try {
            const raw = await window.electronAPI.clipEmbedText(`a photo of ${tag.name}`);
            if (raw) autoTagLabelEmbeddings.set(tag.name, new Float32Array(raw));
        } catch {}
    }
    return autoTagLabelEmbeddings.size > 0;
}

async function openAutoTag(filePaths) {
    autoTagFilePaths = filePaths;
    autoTagOverlay.classList.remove('hidden');
    autoTagResults.innerHTML = '';
    autoTagApply.disabled = true;
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
        if (!status.loaded) {
            autoTagStatus.textContent = 'Loading AI model...';
            const init = await window.electronAPI.clipInit();
            if (!init.success) {
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

    // Get/generate image embeddings
    autoTagStatus.textContent = `Analyzing ${filePaths.length} file${filePaths.length === 1 ? '' : 's'}...`;
    autoTagData = [];
    const BATCH = 8;

    for (let i = 0; i < filePaths.length; i += BATCH) {
        const batch = filePaths.slice(i, i + BATCH);
        const items = batch.map(fp => {
            const item = vsSortedItems.find(it => it.path === fp);
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
                const results = await window.electronAPI.clipEmbedImages(needsEmbed);
                for (const r of results) {
                    if (r && r.embedding) {
                        const emb = new Float32Array(r.embedding);
                        embeddings.set(r.path, emb);
                        currentEmbeddings.set(r.path, emb);
                    }
                }
            } catch {}
        }

        // Score each file against all labels
        for (const fp of batch) {
            const emb = embeddings.get(fp);
            if (!emb) continue;
            const suggestions = [];
            for (const [label, labelEmb] of autoTagLabelEmbeddings) {
                const score = cosineSimilarity(emb, labelEmb);
                suggestions.push({ label, score });
            }
            suggestions.sort((a, b) => b.score - a.score);

            const name = fp.split(/[\\/]/).pop();
            const item = vsSortedItems.find(it => it.path === fp);
            let thumbUrl = '';
            if (item) {
                thumbUrl = item.type === 'video'
                    ? ((await requestVideoPosterUrl(fp)) || '')
                    : (item.url || '');
            }
            autoTagData.push({ path: fp, name, thumbUrl, suggestions });
        }

        autoTagStatus.textContent = `Analyzing... ${Math.min(i + BATCH, filePaths.length)}/${filePaths.length}`;
    }

    autoTagStatus.textContent = `Done. ${autoTagData.length} file${autoTagData.length === 1 ? '' : 's'} analyzed.`;
    renderAutoTagResults();
}

// Map raw CLIP cosine similarity (typically 0.15–0.40) to a 0–100% display scale
function clipScoreToDisplayPct(score) {
    return Math.round(Math.min(100, Math.max(0, (score - 0.15) / 0.25 * 100)));
}

function renderAutoTagResults() {
    const threshold = (parseInt(autoTagThreshold.value) || 25) / 100;
    autoTagResults.innerHTML = '';
    let totalChecked = 0;

    if (autoTagData.length === 0) {
        autoTagResults.innerHTML = '<div class="auto-tag-empty">No files could be analyzed.</div>';
        autoTagApply.disabled = true;
        return;
    }

    for (const file of autoTagData) {
        const matching = file.suggestions.filter(s => s.score >= threshold);
        if (matching.length === 0) continue;

        const group = document.createElement('div');
        group.className = 'auto-tag-file-group';

        const header = document.createElement('div');
        header.className = 'auto-tag-file-header';
        header.innerHTML = `
            ${file.thumbUrl ? `<img src="${file.thumbUrl}" alt="">` : ''}
            <span class="auto-tag-filename" title="${file.name}">${file.name}</span>
        `;
        group.appendChild(header);

        const chips = document.createElement('div');
        chips.className = 'auto-tag-suggestions';

        for (const s of matching) {
            const pct = clipScoreToDisplayPct(s.score);
            const chip = document.createElement('span');
            chip.className = 'auto-tag-chip selected';
            chip.dataset.path = file.path;
            chip.dataset.label = s.label;
            chip.innerHTML = `${s.label} <span class="auto-tag-conf">${pct}%</span>`;
            chip.addEventListener('click', () => {
                chip.classList.toggle('selected');
                updateAutoTagApplyBtn();
            });
            chips.appendChild(chip);
            totalChecked++;
        }
        group.appendChild(chips);
        autoTagResults.appendChild(group);
    }

    if (autoTagResults.children.length === 0) {
        autoTagResults.innerHTML = '<div class="auto-tag-empty">No tags above threshold. Try lowering the confidence slider.</div>';
    }

    autoTagApply.disabled = totalChecked === 0;
}

function updateAutoTagApplyBtn() {
    const selected = autoTagResults.querySelectorAll('.auto-tag-chip.selected');
    autoTagApply.disabled = selected.length === 0;
}

autoTagThreshold.addEventListener('input', () => {
    autoTagThresholdValue.textContent = `${clipScoreToDisplayPct(parseInt(autoTagThreshold.value) / 100)}%`;
    renderAutoTagResults();
});

document.getElementById('auto-tag-close').addEventListener('click', closeAutoTag);
document.getElementById('auto-tag-cancel').addEventListener('click', closeAutoTag);
autoTagOverlay.addEventListener('click', (e) => { if (e.target === autoTagOverlay) closeAutoTag(); });

document.getElementById('auto-tag-select-all').addEventListener('click', () => {
    const chips = autoTagResults.querySelectorAll('.auto-tag-chip');
    const allSelected = Array.from(chips).every(c => c.classList.contains('selected'));
    chips.forEach(c => c.classList.toggle('selected', !allSelected));
    updateAutoTagApplyBtn();
});

autoTagApply.addEventListener('click', async () => {
    const selected = autoTagResults.querySelectorAll('.auto-tag-chip.selected');
    if (selected.length === 0) return;

    autoTagApply.disabled = true;
    autoTagApply.textContent = 'Applying...';

    try {
        await refreshTagsCache();

        // Group by label -> collect file paths
        const labelToFiles = new Map();
        for (const chip of selected) {
            const label = chip.dataset.label;
            const fp = chip.dataset.path;
            if (!labelToFiles.has(label)) labelToFiles.set(label, []);
            labelToFiles.get(label).push(fp);
        }

        for (const [label, filePaths] of labelToFiles) {
            // Find the existing tag by name
            const tag = allTagsCache.find(t => t.name.toLowerCase() === label.toLowerCase());
            if (!tag) continue; // Should not happen since labels come from allTagsCache

            // Bulk assign
            const normalizedPaths = filePaths.map(fp => normalizePath(fp));
            if (normalizedPaths.length > 1) {
                await window.electronAPI.dbBulkTagFiles(normalizedPaths, tag.id);
            } else {
                await window.electronAPI.dbAddTagToFile(normalizedPaths[0], tag.id);
            }
        }

        await refreshTagsCache();
        refreshVisibleCardTags();
        closeAutoTag();
        showToast(`Applied ${selected.length} tag${selected.length === 1 ? '' : 's'} across ${autoTagFilePaths.length} file${autoTagFilePaths.length === 1 ? '' : 's'}`, 'success');
    } catch (error) {
        showToast(`Auto-tag failed: ${friendlyError(error)}`, 'error');
    } finally {
        autoTagApply.disabled = false;
        autoTagApply.textContent = 'Apply Tags';
    }
});

async function loadVideos(folderPath, useCache = true, preservedScrollTop = null) {
    // Clear find-similar state on folder navigation (silent reset, no re-render)
    if (findSimilarActive) {
        findSimilarActive = false;
        findSimilarEmbedding = null;
        findSimilarSourcePath = null;
        findSimilarPreviousItems = null;
        findSimilarPreviousFolder = null;
        const fsBanner = document.getElementById('find-similar-banner');
        if (fsBanner) fsBanner.classList.add('hidden');
    }
    // Clear card selection on folder navigation
    clearCardSelection();
    // Stop periodic cleanup during folder switch
    stopPeriodicCleanup();
    activeDimensionHydrationToken++;
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
        
        // If not cached, scan folder
        if (!items) {
            // Yield control before starting scan to keep UI responsive
            await yieldToEventLoop();
            
            // Keep stats when needed for sorting or enabled card metadata chips.
            const skipStats = sortType === 'name' && !cardInfoSettings.fileSize && !cardInfoSettings.date;
            // Only block on dimension scans when the active filters require them.
            const scanImageDimensions = hasDimensionDependentFilters();
            const scanVideoDimensions = hasDimensionDependentFilters();
            const scanPerfStart = perfTest.start();
            items = await window.electronAPI.scanFolder(folderPath, { skipStats, scanImageDimensions, scanVideoDimensions, recursive: recursiveSearchEnabled });
            perfTest.end('scanFolder (IPC)', scanPerfStart, { itemCount: items ? items.length : 0 });

            // Yield control after scan completes
            await yieldToEventLoop();
            
            // Cache the results (use normalized path for consistency)
            updateInMemoryFolderCaches(folderPath, items);
            
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
        currentEmbeddings.clear();
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

// ============================================================================
// COLLECTIONS UI
// ============================================================================

const collectionsListEl = document.getElementById('collections-list');
const newCollectionBtn = document.getElementById('new-collection-btn');

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
        if (result && !sourceFolders.some(f => f.path === result)) {
            sourceFolders.push({ path: result, recursive: false });
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

// Load collections on startup
initIndexedDB().then(() => renderCollectionsSidebar()).catch(() => {});

// Initialize theme system (must be after all let/const declarations to avoid TDZ errors)
ThemeManager.init();

// ==================== COMMAND PALETTE REGISTRATIONS ====================
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

// ── Tagging System ───────────────────────────────────────────────────────────

// In-memory tag cache
let allTagsCache = [];
// tagFilterActive, tagFilteredPaths, activeTagFilters, tagFilterOperator
// are declared near other filter state globals (line ~1348)

async function refreshTagsCache() {
    try {
        const result = await window.electronAPI.dbGetAllTags();
        if (result.success) allTagsCache = result.data || [];
    } catch {}
}

// ── File-tag cache (mirrors star-rating in-memory pattern) ──────────────────

let fileTagsCache = new Map(); // Map<normalizedPath, Tag[]>
const FILE_TAGS_CACHE_MAX = 5000;

async function warmFileTagsCache(filePaths) {
    if (!filePaths.length) return;
    try {
        const result = await window.electronAPI.dbGetTagsForFiles(filePaths);
        if (result.success && result.data) {
            for (const [fp, tags] of Object.entries(result.data)) {
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
                if (result.success && result.data) {
                    for (const tags of Object.values(result.data)) {
                        for (const t of tags) tagCounts.set(t.id, (tagCounts.get(t.id) || 0) + 1);
                    }
                }
            } else {
                const result = await window.electronAPI.dbGetTagsForFile(normalizePath(tagPickerFilePaths[0]));
                if (result.success && result.data) {
                    for (const t of result.data) tagCounts.set(t.id, 1);
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
                if (result.success && result.data) {
                    await refreshTagsCache();
                    // Auto-assign to files
                    const normalizedPaths = tagPickerFilePaths.map(fp => normalizePath(fp));
                    if (isMulti) {
                        await window.electronAPI.dbBulkTagFiles(normalizedPaths, result.data.id);
                    } else {
                        await window.electronAPI.dbAddTagToFile(normalizedPaths[0], result.data.id);
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
                    await window.electronAPI.dbBulkRemoveTagFromFiles(normalizedPaths, tag.id);
                } else {
                    await window.electronAPI.dbRemoveTagFromFile(normalizedPaths[0], tag.id);
                }
            } else {
                // Add to all files (covers both partial and unchecked)
                if (isMulti) {
                    await window.electronAPI.dbBulkTagFiles(normalizedPaths, tag.id);
                } else {
                    await window.electronAPI.dbAddTagToFile(normalizedPaths[0], tag.id);
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
        if (!result.success || !result.data || result.data.length === 0) return;
        for (const sug of result.data.slice(0, 6)) {
            const chip = document.createElement('span');
            chip.className = 'tag-suggestion';
            chip.innerHTML = `<span class="tag-picker-item-dot" style="background:${sug.tag.color || '#6366f1'}"></span>${sug.tag.name}`;
            chip.addEventListener('click', async () => {
                for (const fp of tagPickerFilePaths) {
                    await window.electronAPI.dbAddTagToFile(normalizePath(fp), sug.tag.id);
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
    if (vsEnabled && vsActiveCards.size > 0) {
        cards = Array.from(vsActiveCards.values()).filter(c => c.classList.contains('video-card'));
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
            item.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:4px;cursor:pointer;font-size:13px;color:var(--text-color);';
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
            if (result.success) {
                tagFilteredPaths = new Set(result.data || []);
            }
        } catch {
            tagFilteredPaths = new Set();
        }
    }
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
                        if (result.success) tagFilteredPaths = new Set(result.data || []);
                    } catch { tagFilteredPaths = new Set(); }
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
        if (result.success) topTags = result.data || [];
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
        if (result.success) {
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


// ==================== SEARCH HISTORY ====================
(function initSearchHistory() {
    const SEARCH_HISTORY_KEY = 'searchHistory';
    const MAX_SEARCH_HISTORY = searchHistoryLimitSetting;
    const dropdown = document.getElementById('search-history-dropdown');
    if (!dropdown || !searchBox) return;

    function getHistory() {
        try { return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]'); } catch { return []; }
    }

    function saveToHistory(query) {
        if (!query || !query.trim()) return;
        let h = getHistory().filter(s => s !== query.trim());
        h.unshift(query.trim());
        if (h.length > MAX_SEARCH_HISTORY) h = h.slice(0, MAX_SEARCH_HISTORY);
        localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(h));
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
                ev.preventDefault();
                searchBox.value = q;
                const clearBtn = document.getElementById('search-clear-btn');
                if (clearBtn) clearBtn.style.display = '';
                performSearch(q);
                dropdown.classList.add('hidden');
            });
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


// ==================== DATE GROUP HEADERS ====================
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


// ==================== COMPARE MODE ====================
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
        const item = vsSortedItems.find(it => it.path === p);
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


// ==================== SLIDESHOW MODE ====================
let ssActive = false;
let ssItems = [];
let ssIndex = 0;
let ssTimer = null;
let ssPlaying = true;
let ssShuffle = false;
let ssLoop = true;
let ssInterval = 3000;
let ssShuffleOrder = [];
let ssLayerA = true; // which img layer shows current item

function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

function startSlideshow() {
    const items = vsSortedItems.filter(i => i.type !== 'folder' && i.type !== 'group-header' && !i.missing);
    if (items.length === 0) { showToast('No media to show in slideshow', 'info'); return; }
    ssItems = items;
    ssIndex = 0;
    ssPlaying = true;
    ssShuffleOrder = items.map((_, k) => k);
    if (ssShuffle) shuffleArray(ssShuffleOrder);

    const overlay = document.getElementById('slideshow-overlay');
    if (!overlay) return;

    // Reset images
    const imgA = document.getElementById('ss-img-a');
    const imgB = document.getElementById('ss-img-b');
    const video = document.getElementById('ss-video');
    if (imgA) { imgA.src = ''; imgA.classList.remove('ss-visible'); }
    if (imgB) { imgB.src = ''; imgB.classList.remove('ss-visible'); }
    if (video) { video.pause(); video.src = ''; video.style.display = 'none'; }
    ssLayerA = true;

    overlay.classList.remove('hidden');
    ssActive = true;
    ssShowItem(ssShuffleOrder[ssIndex]);
    ssUpdateControls();
    ssScheduleNext();
}

function stopSlideshow() {
    ssActive = false;
    clearTimeout(ssTimer);
    const overlay = document.getElementById('slideshow-overlay');
    if (overlay) overlay.classList.add('hidden');
    const video = document.getElementById('ss-video');
    if (video) { video.pause(); video.src = ''; video.style.display = 'none'; }
}

function ssShowItem(idx) {
    ssIndex = idx;
    const item = ssItems[idx];
    if (!item) return;

    const pos = ssShuffleOrder.indexOf(idx) + 1;
    const counterEl = document.getElementById('ss-counter');
    const filenameEl = document.getElementById('ss-filename');
    if (counterEl) counterEl.textContent = `${pos} / ${ssItems.length}`;
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
        video.onended = () => { if (ssPlaying) ssNext(); };
    } else {
        video.pause();
        video.src = '';
        video.style.display = 'none';
        video.onended = null;

        const curLayer = ssLayerA ? imgA : imgB;
        const nextLayer = ssLayerA ? imgB : imgA;
        nextLayer.src = item.url;
        // Show immediately with crossfade
        requestAnimationFrame(() => {
            nextLayer.classList.add('ss-visible');
            curLayer.classList.remove('ss-visible');
            ssLayerA = !ssLayerA;
        });
    }
}

function ssNext() {
    clearTimeout(ssTimer);
    const pos = ssShuffleOrder.indexOf(ssIndex);
    let nextPos = pos + 1;
    if (nextPos >= ssItems.length) {
        if (!ssLoop) { stopSlideshow(); return; }
        nextPos = 0;
    }
    ssShowItem(ssShuffleOrder[nextPos]);
    if (ssPlaying) ssScheduleNext();
}

function ssPrev() {
    clearTimeout(ssTimer);
    const pos = ssShuffleOrder.indexOf(ssIndex);
    let prevPos = pos - 1;
    if (prevPos < 0) prevPos = ssItems.length - 1;
    ssShowItem(ssShuffleOrder[prevPos]);
    if (ssPlaying) ssScheduleNext();
}

function ssScheduleNext() {
    clearTimeout(ssTimer);
    if (!ssPlaying) return;
    ssTimer = setTimeout(ssNext, ssInterval);
}

function ssUpdateControls() {
    const playBtn = document.getElementById('ss-play-btn');
    const shuffleBtn = document.getElementById('ss-shuffle-btn');
    const loopBtn = document.getElementById('ss-loop-btn');
    if (playBtn) {
        playBtn.classList.toggle('active', ssPlaying);
        playBtn.innerHTML = ssPlaying
            ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
            : '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
    }
    if (shuffleBtn) shuffleBtn.classList.toggle('active', ssShuffle);
    if (loopBtn) loopBtn.classList.toggle('active', ssLoop);
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
        ssPlaying = !ssPlaying;
        if (ssPlaying) ssScheduleNext();
        else clearTimeout(ssTimer);
        ssUpdateControls();
    });

    if (shuffleBtn) shuffleBtn.addEventListener('click', () => {
        ssShuffle = !ssShuffle;
        if (ssShuffle) shuffleArray(ssShuffleOrder);
        else ssShuffleOrder = ssItems.map((_, k) => k);
        ssUpdateControls();
    });

    if (loopBtn) loopBtn.addEventListener('click', () => {
        ssLoop = !ssLoop;
        ssUpdateControls();
    });

    if (speedSel) speedSel.addEventListener('change', () => {
        ssInterval = parseInt(speedSel.value, 10) || 3000;
        if (ssPlaying) ssScheduleNext();
    });

    // Keyboard handling (high priority - captures before renderer-features.js)
    document.addEventListener('keydown', ev => {
        if (!ssActive || overlay.classList.contains('hidden')) return;
        if (ev.key === 'Escape') { ev.stopImmediatePropagation(); stopSlideshow(); return; }
        if (ev.key === 'ArrowRight') { ev.stopImmediatePropagation(); ssNext(); return; }
        if (ev.key === 'ArrowLeft') { ev.stopImmediatePropagation(); ssPrev(); return; }
        if (ev.key === ' ') {
            ev.preventDefault();
            ev.stopImmediatePropagation();
            ssPlaying = !ssPlaying;
            if (ssPlaying) ssScheduleNext(); else clearTimeout(ssTimer);
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

// ============================================================================
// KEYBOARD SHORTCUT REMAPPING SYSTEM
// ============================================================================
const DEFAULT_SHORTCUTS = {
    undo:           { key: 'z', ctrl: true, label: 'Undo', category: 'File Actions' },
    redo:           { key: 'z', ctrl: true, shift: true, label: 'Redo', category: 'File Actions' },
    search:         { key: 'f', ctrl: true, label: 'Search', category: 'Navigation' },
    openFolder:     { key: 'o', ctrl: true, label: 'Open folder', category: 'Navigation' },
    openCard:       { key: 'Enter', label: 'Open selected card', category: 'Navigation' },
    deleteCard:     { key: 'Delete', label: 'Delete file', category: 'File Actions' },
    rename:         { key: 'F2', label: 'Rename file', category: 'File Actions' },
    goBack:         { key: 'Backspace', label: 'Go back', category: 'Navigation' },
    goBackAlt:      { key: 'b', ctrl: true, label: 'Go back (alt)', category: 'Navigation' },
    goForward:      { key: 'b', ctrl: true, shift: true, label: 'Go forward', category: 'Navigation' },
    filterAll:      { key: '1', label: 'Show all', category: 'Filters' },
    filterVideo:    { key: '2', label: 'Videos only', category: 'Filters' },
    filterImage:    { key: '3', label: 'Images only', category: 'Filters' },
    showShortcuts:  { key: '?', label: 'Show shortcuts', category: 'View' },
    toggleLayout:   { key: 'g', label: 'Toggle grid/masonry', category: 'View' },
    collapseSidebar:{ key: 's', label: 'Toggle sidebar', category: 'View' },
    lightboxOpen:   { key: ' ', label: 'Open lightbox', category: 'File Actions' },
    zoomIn:         { key: '+', label: 'Zoom in', category: 'View' },
    zoomOut:        { key: '-', label: 'Zoom out', category: 'View' },
    zoomReset:      { key: '0', label: 'Reset zoom', category: 'View' },
    slideshow:      { key: 'F5', label: 'Start slideshow', category: 'View' },
    compare:        { key: 'c', label: 'Compare selected', category: 'View' },
    commandPalette: { key: 'p', ctrl: true, label: 'Command palette', category: 'Navigation' },
    lb_prev:        { key: 'ArrowLeft', label: 'Previous', category: 'Lightbox' },
    lb_next:        { key: 'ArrowRight', label: 'Next', category: 'Lightbox' },
    lb_prevFrame:   { key: ',', label: 'Previous frame', category: 'Lightbox' },
    lb_nextFrame:   { key: '.', label: 'Next frame', category: 'Lightbox' },
    lb_playPause:   { key: ' ', label: 'Play / Pause', category: 'Lightbox' },
    lb_speedDown:   { key: '[', label: 'Speed down', category: 'Lightbox' },
    lb_speedUp:     { key: ']', label: 'Speed up', category: 'Lightbox' },
};

// Merge user overrides over defaults
let userShortcutOverrides = {};
try {
    const saved = localStorage.getItem('keyboardShortcuts');
    if (saved) userShortcutOverrides = JSON.parse(saved);
} catch { /* use defaults */ }

function getShortcut(actionId) {
    const def = DEFAULT_SHORTCUTS[actionId];
    if (!def) return null;
    const override = userShortcutOverrides[actionId];
    if (override) return { ...def, ...override };
    return def;
}

function matchesShortcut(e, actionId) {
    const sc = getShortcut(actionId);
    if (!sc) return false;
    const wantCtrl = !!sc.ctrl;
    const wantAlt = !!sc.alt;
    const hasCtrl = e.ctrlKey || e.metaKey;
    if (wantCtrl !== hasCtrl) return false;
    if (wantAlt !== e.altKey) return false;

    const eKey = e.key;
    const scKey = sc.key;
    const wantShift = !!sc.shift;

    // Characters that inherently require Shift to produce — skip strict shift check for these
    const shiftProducedChars = new Set(['?', '+', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '{', '}', '|', ':', '"', '<', '>', '~']);

    // For shortcuts that use modifier keys (ctrl/alt), enforce shift strictly
    // For plain key shortcuts, be lenient about shift — allow e.g. Shift+C when shortcut is 'c'
    if (wantCtrl || wantAlt) {
        // With modifiers: shift must match exactly
        if (wantShift !== e.shiftKey) return false;
    } else if (wantShift) {
        // Shortcut explicitly wants shift but user didn't press it
        if (!e.shiftKey) return false;
    }
    // If shortcut doesn't want shift: allow shift for shift-produced chars and case-insensitive letters

    // Special key aliases
    if (scKey === ' ' && eKey === ' ') return true;
    if (scKey === '?' && (eKey === '?' || eKey === '/')) return true;
    if (scKey === '+' && (eKey === '+' || eKey === '=')) return true;
    if (scKey === '-' && eKey === '-') return true;

    // Case-insensitive match for letters, exact match for everything else
    if (eKey.toLowerCase() === scKey.toLowerCase()) return true;
    return false;
}

function shortcutToString(actionId) {
    const sc = getShortcut(actionId);
    if (!sc) return '';
    const parts = [];
    if (sc.ctrl) parts.push('Ctrl');
    if (sc.shift) parts.push('Shift');
    if (sc.alt) parts.push('Alt');
    const keyDisplay = {
        ' ': 'Space', 'ArrowLeft': 'Left', 'ArrowRight': 'Right',
        'ArrowUp': 'Up', 'ArrowDown': 'Down', 'Enter': 'Enter',
        'Backspace': 'Backspace', 'Delete': 'Delete', 'Escape': 'Esc',
        '?': '?', '+': '+', '-': '-', '0': '0',
        ',': ',', '.': '.', '[': '[', ']': ']',
    };
    const display = keyDisplay[sc.key] || sc.key.toUpperCase();
    parts.push(display);
    return parts.join('+');
}

function saveShortcuts() {
    deferLocalStorageWrite('keyboardShortcuts', JSON.stringify(userShortcutOverrides));
    rebuildShortcutsOverlay();
    renderShortcutSettings();
}

// ── Shortcut Settings UI ──
let recordingActionId = null;
let recordingHandler = null;

function renderShortcutSettings() {
    const container = document.getElementById('shortcut-categories');
    if (!container) return;
    container.innerHTML = '';

    // Group by category
    const categories = {};
    for (const [id, def] of Object.entries(DEFAULT_SHORTCUTS)) {
        const cat = def.category || 'Other';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(id);
    }

    for (const [catName, actionIds] of Object.entries(categories)) {
        const catDiv = document.createElement('div');
        catDiv.className = 'shortcut-category';
        const h4 = document.createElement('h4');
        h4.textContent = catName;
        catDiv.appendChild(h4);

        for (const actionId of actionIds) {
            const sc = getShortcut(actionId);
            const row = document.createElement('div');
            row.className = 'shortcut-row-editable';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'shortcut-action-name';
            nameSpan.textContent = sc.label;

            const keyDisplay = document.createElement('div');
            keyDisplay.className = 'shortcut-key-display';
            keyDisplay.dataset.action = actionId;
            const kbd = document.createElement('kbd');
            kbd.textContent = shortcutToString(actionId);
            keyDisplay.appendChild(kbd);
            keyDisplay.addEventListener('click', () => startShortcutRecording(actionId, keyDisplay));

            const resetBtn = document.createElement('button');
            resetBtn.className = 'shortcut-reset-btn';
            resetBtn.textContent = 'Reset';
            resetBtn.addEventListener('click', () => {
                delete userShortcutOverrides[actionId];
                saveShortcuts();
            });

            row.appendChild(nameSpan);
            row.appendChild(keyDisplay);
            // Only show reset if overridden
            if (userShortcutOverrides[actionId]) row.appendChild(resetBtn);

            catDiv.appendChild(row);
        }
        container.appendChild(catDiv);
    }
}

function startShortcutRecording(actionId, displayEl) {
    // Cancel previous recording
    stopShortcutRecording();

    recordingActionId = actionId;
    displayEl.classList.add('recording');
    displayEl.querySelector('kbd').textContent = 'Press a key...';

    recordingHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') { stopShortcutRecording(); renderShortcutSettings(); return; }
        // Ignore bare modifier keys
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

        const newBinding = { key: e.key };
        if (e.ctrlKey || e.metaKey) newBinding.ctrl = true;
        if (e.shiftKey) newBinding.shift = true;
        if (e.altKey) newBinding.alt = true;

        // Conflict detection
        const conflictId = findShortcutConflict(actionId, newBinding);
        if (conflictId) {
            // Swap: give the conflicting action our old binding
            const oldBinding = getShortcut(actionId);
            userShortcutOverrides[conflictId] = { key: oldBinding.key };
            if (oldBinding.ctrl) userShortcutOverrides[conflictId].ctrl = true;
            if (oldBinding.shift) userShortcutOverrides[conflictId].shift = true;
            if (oldBinding.alt) userShortcutOverrides[conflictId].alt = true;
        }

        userShortcutOverrides[actionId] = newBinding;
        stopShortcutRecording();
        saveShortcuts();
    };

    document.addEventListener('keydown', recordingHandler, true);
}

function stopShortcutRecording() {
    if (recordingHandler) {
        document.removeEventListener('keydown', recordingHandler, true);
        recordingHandler = null;
    }
    recordingActionId = null;
    document.querySelectorAll('.shortcut-key-display.recording').forEach(el => el.classList.remove('recording'));
}

function findShortcutConflict(excludeId, binding) {
    for (const [id, def] of Object.entries(DEFAULT_SHORTCUTS)) {
        if (id === excludeId) continue;
        // Same category context check: lightbox shortcuts don't conflict with grid shortcuts
        if (def.category !== DEFAULT_SHORTCUTS[excludeId]?.category) continue;
        const sc = getShortcut(id);
        if (sc.key.toLowerCase() === binding.key.toLowerCase() &&
            !!sc.ctrl === !!binding.ctrl &&
            !!sc.shift === !!binding.shift &&
            !!sc.alt === !!binding.alt) {
            return id;
        }
    }
    return null;
}

// Reset all shortcuts
document.getElementById('reset-all-shortcuts-btn')?.addEventListener('click', () => {
    userShortcutOverrides = {};
    saveShortcuts();
});

// ── Dynamic Shortcuts Help Overlay ──
function rebuildShortcutsOverlay() {
    const body = document.getElementById('shortcuts-body-dynamic');
    if (!body) return;
    body.innerHTML = '';

    const categories = {};
    for (const [id, def] of Object.entries(DEFAULT_SHORTCUTS)) {
        const cat = def.category || 'Other';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(id);
    }

    // Split into two columns
    const catEntries = Object.entries(categories);
    const mid = Math.ceil(catEntries.length / 2);
    for (let col = 0; col < 2; col++) {
        const colDiv = document.createElement('div');
        colDiv.className = 'shortcuts-column';
        const start = col === 0 ? 0 : mid;
        const end = col === 0 ? mid : catEntries.length;
        for (let i = start; i < end; i++) {
            const [catName, actionIds] = catEntries[i];
            const h3 = document.createElement('h3');
            h3.textContent = catName;
            colDiv.appendChild(h3);
            for (const actionId of actionIds) {
                const sc = getShortcut(actionId);
                const row = document.createElement('div');
                row.className = 'shortcut-row';
                const kbd = document.createElement('kbd');
                kbd.textContent = shortcutToString(actionId);
                const span = document.createElement('span');
                span.textContent = sc.label;
                row.appendChild(kbd);
                row.appendChild(span);
                colDiv.appendChild(row);
            }
        }
        body.appendChild(colDiv);
    }
}
rebuildShortcutsOverlay();

// ============================================================================
// NEW SETTINGS HANDLERS
// ============================================================================

// ── Utility: simple range-value wiring ──
function wireRangeDisplay(inputId, displayId, suffix, storageKey, onChangeCb) {
    const input = document.getElementById(inputId);
    const display = document.getElementById(displayId);
    if (!input || !display) return;
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) input.value = saved;
    display.textContent = input.value + suffix;
    input.addEventListener('input', () => {
        display.textContent = input.value + suffix;
        deferLocalStorageWrite(storageKey, input.value);
        if (onChangeCb) onChangeCb(parseInt(input.value, 10));
    });
}

function wireSelectStorage(selectId, storageKey, onChangeCb) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) sel.value = saved;
    sel.addEventListener('change', () => {
        deferLocalStorageWrite(storageKey, sel.value);
        if (onChangeCb) onChangeCb(sel.value);
    });
}

// ── Phase 2: Grid Layout ──
wireRangeDisplay('grid-gap-slider', 'grid-gap-value', 'px', 'gridGap', (val) => {
    gridGapSetting = val;
    document.documentElement.style.setProperty('--gap', val + 'px');
    invalidateVsStyleCache();
    if (typeof applySorting === 'function') applySorting();
});

wireRangeDisplay('min-card-width-slider', 'min-card-width-value', 'px', 'minCardWidth', (val) => {
    minCardWidthSetting = val;
    if (typeof applySorting === 'function') applySorting();
});

wireSelectStorage('card-aspect-select', 'cardAspectRatio', (val) => {
    cardAspectRatioSetting = val;
    if (typeof applySorting === 'function') applySorting();
});

// ── Phase 3: Animation & Reduce Motion ──
function applyAnimationSpeed(speed) {
    const root = document.documentElement.style;
    const multipliers = { off: 0, fast: 0.5, normal: 1, relaxed: 1.67, slow: 2.67 };
    const m = multipliers[speed] ?? 1;
    root.setProperty('--duration-fast', (0.1 * m) + 's');
    root.setProperty('--duration-normal', (0.15 * m) + 's');
    root.setProperty('--duration-slow', (0.25 * m) + 's');
}
wireSelectStorage('animation-speed-select', 'animationSpeed', (val) => {
    animationSpeedSetting = val;
    applyAnimationSpeed(val);
});
applyAnimationSpeed(animationSpeedSetting);

(function initReduceMotion() {
    const toggle = document.getElementById('reduce-motion-toggle');
    const label = document.getElementById('reduce-motion-label');
    if (!toggle) return;
    toggle.checked = reduceMotionSetting;
    if (label) label.textContent = reduceMotionSetting ? 'On' : 'Off';
    if (reduceMotionSetting) document.body.classList.add('reduce-motion');
    toggle.addEventListener('change', () => {
        reduceMotionSetting = toggle.checked;
        if (label) label.textContent = toggle.checked ? 'On' : 'Off';
        document.body.classList.toggle('reduce-motion', toggle.checked);
        deferLocalStorageWrite('reduceMotion', String(toggle.checked));
    });
})();

// ── Phase 4: Extension Colors Editor ──
(function initExtensionColorEditor() {
    const container = document.getElementById('extension-colors-editor');
    if (!container) return;
    const exts = Object.keys(DEFAULT_EXTENSION_COLORS);
    for (const ext of exts) {
        const item = document.createElement('div');
        item.className = 'ext-color-item';
        const lbl = document.createElement('label');
        lbl.textContent = ext;
        const input = document.createElement('input');
        input.type = 'color';
        input.value = extensionColors[ext] || DEFAULT_EXTENSION_COLORS[ext];
        input.dataset.ext = ext;
        input.addEventListener('input', () => {
            extensionColors[ext] = input.value;
            deferLocalStorageWrite('extensionColors', JSON.stringify(extensionColors));
            // Re-render visible extension labels
            document.querySelectorAll('.card-extension').forEach(el => {
                if (el.textContent.trim().toUpperCase() === ext) {
                    el.style.backgroundColor = hexToRgba(input.value, 0.87);
                }
            });
        });
        item.appendChild(lbl);
        item.appendChild(input);
        container.appendChild(item);
    }
    document.getElementById('reset-extension-colors-btn')?.addEventListener('click', () => {
        extensionColors = { ...DEFAULT_EXTENSION_COLORS };
        localStorage.removeItem('extensionColors');
        container.querySelectorAll('input[type="color"]').forEach(inp => {
            inp.value = DEFAULT_EXTENSION_COLORS[inp.dataset.ext] || '#888888';
        });
        // Refresh all visible extension labels
        if (typeof applySorting === 'function') applySorting();
    });
})();

// ── Phase 5: Playback ──
(function initControlBarDelay() {
    const input = document.getElementById('control-bar-hide-delay');
    const display = document.getElementById('control-bar-hide-delay-value');
    if (!input || !display) return;
    const saved = localStorage.getItem('controlBarHideDelay');
    if (saved !== null) input.value = saved;
    const update = () => { display.textContent = (parseInt(input.value) / 1000) + 's'; };
    input.addEventListener('input', () => {
        update();
        deferLocalStorageWrite('controlBarHideDelay', input.value);
    });
    update();
})();

wireSelectStorage('default-slideshow-speed', 'defaultSlideshowSpeed', (val) => {
    defaultSlideshowSpeed = parseInt(val, 10);
});

wireRangeDisplay('video-thumb-seek', 'video-thumb-seek-value', '%', 'videoThumbSeekPct', (val) => {
    if (window.electronAPI?.updateMainSetting) window.electronAPI.updateMainSetting('videoThumbSeekPct', val);
});

// Playback speed options
(function initPlaybackSpeeds() {
    const input = document.getElementById('playback-speeds-input');
    if (!input) return;
    const saved = localStorage.getItem('playbackSpeeds');
    if (saved) {
        try { input.value = JSON.parse(saved).join(','); } catch {}
    }
    input.addEventListener('change', () => {
        const speeds = input.value.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n > 0);
        if (speeds.length > 0) {
            deferLocalStorageWrite('playbackSpeeds', JSON.stringify(speeds));
        }
    });
})();

// ── Phase 6: AI Settings ──
(function initAiIdleDelay() {
    const input = document.getElementById('ai-idle-delay');
    const display = document.getElementById('ai-idle-delay-value');
    if (!input || !display) return;
    const saved = localStorage.getItem('aiIdleDelay');
    if (saved !== null) input.value = saved;
    const update = () => { display.textContent = (parseInt(input.value) / 1000) + 's'; };
    input.addEventListener('input', () => {
        update();
        IDLE_DELAY_MS = parseInt(input.value, 10);
        deferLocalStorageWrite('aiIdleDelay', input.value);
    });
    update();
})();

wireSelectStorage('ai-batch-size', 'aiBatchSize', (val) => { IDLE_BATCH_SIZE = parseInt(val, 10); });
wireSelectStorage('ai-video-frames', 'aiVideoFrameCount');

// ── Phase 7: Performance ──
(function initPerfProfile() {
    const profileSel = document.getElementById('perf-profile');
    const customPanel = document.getElementById('perf-custom-sliders');
    if (!profileSel) return;

    const saved = localStorage.getItem('perfProfile');
    if (saved) profileSel.value = saved;
    if (customPanel) customPanel.classList.toggle('hidden', profileSel.value !== 'custom');

    profileSel.addEventListener('change', () => {
        deferLocalStorageWrite('perfProfile', profileSel.value);
        if (customPanel) customPanel.classList.toggle('hidden', profileSel.value !== 'custom');
    });
})();

wireRangeDisplay('perf-max-media', 'perf-max-media-value', '', 'maxMedia', (val) => { MAX_VIDEOS = val; MAX_IMAGES = val; MAX_TOTAL_MEDIA = val * 2; });
wireRangeDisplay('perf-parallel-load', 'perf-parallel-load-value', '', 'parallelLoad', (val) => { PARALLEL_LOAD_LIMIT = val; });
wireRangeDisplay('perf-vs-buffer', 'perf-vs-buffer-value', 'px', 'vsBuffer', (val) => { VS_BUFFER_PX = val; });
wireRangeDisplay('perf-pool-size', 'perf-pool-size-value', '', 'vsPoolSize', (val) => { VS_MAX_POOL_SIZE = val; });
wireRangeDisplay('perf-scroll-debounce', 'perf-scroll-debounce-value', 'ms', 'scrollDebounce', (val) => { SCROLL_DEBOUNCE_MS = val; });
wireRangeDisplay('perf-progressive-threshold', 'perf-progressive-threshold-value', '', 'progressiveThreshold', (val) => { PROGRESSIVE_RENDER_THRESHOLD = val; });

wireSelectStorage('folder-cache-ttl', 'folderCacheTTL', (val) => { FOLDER_CACHE_TTL = parseInt(val, 10); });
wireSelectStorage('idb-cache-ttl', 'idbCacheTTL', (val) => { INDEXEDDB_CACHE_TTL = parseInt(val, 10); });
wireSelectStorage('image-thumb-max-edge', 'imageThumbMaxEdge', (val) => { IMAGE_THUMBNAIL_MAX_EDGE = parseInt(val, 10); });
wireSelectStorage('video-thumb-width', 'videoThumbWidth', (val) => {
    if (window.electronAPI?.updateMainSetting) window.electronAPI.updateMainSetting('videoThumbWidth', val);
});

// Lightbox
wireRangeDisplay('lightbox-max-zoom', 'lightbox-max-zoom-value', '%', 'lightboxMaxZoom', (val) => {
    lightboxMaxZoomSetting = val;
    const lbSlider = document.getElementById('lightbox-zoom-slider');
    if (lbSlider) lbSlider.max = val;
});
wireRangeDisplay('lightbox-viewport', 'lightbox-viewport-value', '%', 'lightboxViewport', (val) => {
    lightboxViewportSetting = val;
    // Apply viewport usage via CSS variables
    document.documentElement.style.setProperty('--lightbox-max-w', val + 'vw');
    document.documentElement.style.setProperty('--lightbox-max-h', val + 'vh');
});
wireRangeDisplay('blow-up-delay', 'blow-up-delay-value', 'ms', 'blowUpDelay', (val) => { blowUpDelaySetting = val; });

// Limits
wireRangeDisplay('recent-files-limit', 'recent-files-limit-value', '', 'recentFilesLimit', (val) => { recentFilesLimitSetting = val; });
wireRangeDisplay('max-undo-history', 'max-undo-history-value', '', 'maxUndoHistory', (val) => { maxUndoHistorySetting = val; });
wireRangeDisplay('tag-suggestions-limit', 'tag-suggestions-limit-value', '', 'tagSuggestionsLimit', (val) => { tagSuggestionsLimitSetting = val; });
wireRangeDisplay('search-history-limit', 'search-history-limit-value', '', 'searchHistoryLimit', (val) => { searchHistoryLimitSetting = val; });

// ── Phase 8: Niche settings ──
wireRangeDisplay('io-concurrency', 'io-concurrency-value', '', 'ioConcurrency', (val) => {
    if (window.electronAPI?.updateMainSetting) window.electronAPI.updateMainSetting('ioConcurrency', val);
});
wireSelectStorage('clip-worker-count', 'clipWorkerCount');
wireRangeDisplay('retry-attempts', 'retry-attempts-value', '', 'retryAttempts', (val) => { MAX_RETRY_ATTEMPTS = val; });
wireRangeDisplay('retry-initial-delay', 'retry-initial-delay-value', 'ms', 'retryInitialDelay', (val) => { RETRY_INITIAL_DELAY_MS = val; });
wireRangeDisplay('retry-max-delay', 'retry-max-delay-value', 'ms', 'retryMaxDelay', (val) => { RETRY_MAX_DELAY_MS = val; });
wireRangeDisplay('sidebar-min-width', 'sidebar-min-width-value', 'px', 'sidebarMinWidth', (val) => {
    sidebarMinWidthSetting = val;
    document.documentElement.style.setProperty('--sidebar-min-width', val + 'px');
    // Clamp current sidebar width to new limits
    const cur = parseInt(folderSidebar.style.width) || sidebarWidth;
    if (cur < val) {
        folderSidebar.style.width = val + 'px';
        sidebarWidth = val;
        deferLocalStorageWrite('sidebarWidth', String(val));
    }
});
wireRangeDisplay('sidebar-max-width', 'sidebar-max-width-value', 'px', 'sidebarMaxWidth', (val) => {
    sidebarMaxWidthSetting = val;
    document.documentElement.style.setProperty('--sidebar-max-width', val + 'px');
    // Clamp current sidebar width to new limits
    const cur = parseInt(folderSidebar.style.width) || sidebarWidth;
    if (cur > val) {
        folderSidebar.style.width = val + 'px';
        sidebarWidth = val;
        deferLocalStorageWrite('sidebarWidth', String(val));
    }
});
wireSelectStorage('folder-preview-count', 'folderPreviewCount', (val) => {
    folderPreviewCountSetting = parseInt(val, 10);
    // Clear cached previews so folders re-fetch with new count
    folderPreviewCache.clear();
    // Remove existing preview grids so they re-render on next scroll
    document.querySelectorAll('.folder-card[data-preview-loaded="1"]').forEach(card => {
        const grid = card.querySelector('.folder-preview-grid');
        if (grid) grid.remove();
        delete card.dataset.previewLoaded;
    });
});
wireSelectStorage('folder-preview-size', 'folderPreviewSize', (val) => { folderPreviewSizeSetting = parseInt(val, 10); });

// ── Reset All Settings ──
document.getElementById('reset-all-settings-btn')?.addEventListener('click', async () => {
    const confirmed = await showConfirm('Reset All Settings', 'This will restore every setting to its default value and reload the app.', { confirmLabel: 'Reset', danger: true });
    if (confirmed) {
        localStorage.clear();
        location.reload();
    }
});

// ── CSS Variable Hydration on startup ──
(function hydrateCSSVariables() {
    const root = document.documentElement.style;
    root.setProperty('--gap', gridGapSetting + 'px');
    root.setProperty('--sidebar-min-width', sidebarMinWidthSetting + 'px');
    root.setProperty('--sidebar-max-width', sidebarMaxWidthSetting + 'px');
    root.setProperty('--lightbox-max-w', lightboxViewportSetting + 'vw');
    root.setProperty('--lightbox-max-h', lightboxViewportSetting + 'vh');
    // Sync lightbox zoom slider max
    const lbSlider = document.getElementById('lightbox-zoom-slider');
    if (lbSlider) lbSlider.max = lightboxMaxZoomSetting;
})();

// Initialize shortcut settings tab
renderShortcutSettings();
