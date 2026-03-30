
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
const CARD_RECT_CACHE_TTL = 34; // Short-lived rect cache for hot scroll/cleanup paths
const IMAGE_THUMBNAIL_MAX_EDGE = 768; // Cap cached image thumbs to a practical grid size
const BACKGROUND_DIMENSION_SCAN_CHUNK_SIZE = 400; // Keep background scans incremental

// Progressive Rendering Configuration
const PROGRESSIVE_RENDER_THRESHOLD = 1000; // Use progressive rendering for N+ items
const PROGRESSIVE_RENDER_CHUNK_SIZE = 50; // Render N items per frame
const PROGRESSIVE_RENDER_INITIAL_CHUNK = 100; // Render first N items immediately

// Scroll & Observer Configuration
const SCROLL_DEBOUNCE_MS = 150; // Debounce cleanup after scroll stops (ms)
const OBSERVER_CLEANUP_THROTTLE_MS = 300; // Throttle IntersectionObserver cleanup — safety net only, processEntries handles per-card cleanup directly

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
const VS_MAX_POOL_SIZE = 150;      // Max recycled cards to keep
const VS_BUFFER_PX = 1200;         // Buffer zone for rendering cards ahead of viewport
let vsScrollRafId = null;          // RAF ID for scroll handler coalescing
let vsLastStartIndex = -1;         // Last rendered range start
let vsLastEndIndex = -1;           // Last rendered range end
let vsSpacer = null;               // Spacer element that sets total scroll height
let vsResizeHandler = null;        // Window resize handler
let vsDimensionRecalcRafId = null; // RAF ID for coalescing metadata-triggered recalcs

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
function vsCalculatePositions(items, containerWidth, mode, zoom) {
    const perfStart = perfTest.start();

    // Get gap from CSS variable
    const rootStyles = getComputedStyle(document.documentElement);
    const gap = parseInt(rootStyles.getPropertyValue('--gap')) || 16;
    const gridStyles = getComputedStyle(gridContainer);
    const paddingLeft = parseInt(gridStyles.paddingLeft) || 0;
    const paddingTop = parseInt(gridStyles.paddingTop) || 0;
    const paddingBottom = parseInt(gridStyles.paddingBottom) || 0;
    const availableWidth = containerWidth - (paddingLeft * 2);

    // Calculate what the column count would be for this zoom/width/mode
    let newColumns, newColumnWidth;
    if (mode === 'masonry') {
        const minColumnWidth = 250 * (zoom / 100);
        newColumns = Math.max(1, Math.floor((availableWidth + gap) / (minColumnWidth + gap)));
        newColumnWidth = (availableWidth - gap * (newColumns - 1)) / newColumns;
    } else {
        const gridMinWidth = 220 * (zoom / 100);
        newColumns = Math.max(1, Math.floor((availableWidth + gap) / (gridMinWidth + gap)));
        newColumnWidth = (availableWidth - gap * (newColumns - 1)) / newColumns;
    }

    // --- Fast path: scale existing positions when column count and items haven't changed ---
    const cache = vsLayoutCache;
    if (
        cache.positions &&
        cache.itemCount === items.length &&
        cache.mode === mode &&
        cache.columns === newColumns &&
        items.length > 0
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
            // Only query for media if card actually has media loaded
            if (card.dataset.hasMedia) {
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
            : createCardFromItem(item);

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
        card.style.animation = 'none'; // Disable enter animation for recycled cards
        card._vsLeft = left;
        card._vsTop = top;
        card._vsWidth = width;
        card._vsHeight = height;
        card._vsItemIndex = i;

        vsActiveCards.set(i, card);
        fragment.appendChild(card);

        if (isMedia) {
            newCards.push(card);
            videoCards.add(card);
        }
    }

    if (fragment.childNodes.length > 0) {
        gridContainer.appendChild(fragment);

        // Register new cards with IntersectionObserver for media loading
        requestAnimationFrame(() => {
            newCards.forEach(card => observer.observe(card));
        });
    }

    vsLastStartIndex = startIndex;
    vsLastEndIndex = endIndex;
}

/**
 * Reset a recycled card to a blank state.
 */
function vsResetCard(card) {
    // Remove all children
    while (card.firstChild) card.removeChild(card.firstChild);

    // Clear dataset
    const dataset = card.dataset;
    for (const key of Object.keys(dataset)) {
        delete dataset[key];
    }

    // Reset classes
    card.className = '';

    // Clear custom properties
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

        return { card, isMedia: false };
    } else {
        card.className = 'video-card';
        card.dataset.src = item.url;
        card.dataset.path = item.path;
        card.dataset.filePath = item.path;
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
            card.dataset.mediaWidth = item.width;
            card.dataset.mediaHeight = item.height;
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
        syncCardMetaRow(card, item, null);
        if (!cardInfoSettings.filename) info.style.display = 'none';
        card.appendChild(info);

        applyCardInfoLayoutClasses(card);

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
    });

    // Debounce cleanup — only run after scrolling settles, not every frame
    clearTimeout(cleanupScrollTimeout);
    cleanupScrollTimeout = setTimeout(() => {
        invalidateScrollCaches();
        runCleanupCycle();
    }, SCROLL_DEBOUNCE_MS);
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
function vsUpdateItems(items) {
    if (!vsEnabled) {
        vsInit(items);
        return;
    }

    // Remove all existing cards
    for (const [itemIdx, card] of vsActiveCards) {
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
        observer.unobserve(card);
        card.remove();
        if (vsRecyclePool.length < VS_MAX_POOL_SIZE) {
            vsRecyclePool.push(card);
        }
    }
    vsActiveCards.clear();
    pendingMediaCreations.clear();
    mediaToRetry.clear();

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

    // Scroll to top for new items
    gridContainer.scrollTop = 0;

    // Render visible range
    vsLastStartIndex = -1;
    vsLastEndIndex = -1;
    const viewportHeight = gridContainer.clientHeight;
    const { startIndex, endIndex } = vsGetVisibleRange(0, viewportHeight);
    vsUpdateDOM(startIndex, endIndex);
}

/**
 * Clean up virtual scrolling state.
 */
function vsCleanup() {
    vsEnabled = false;

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
        const videos = card.querySelectorAll('video');
        const images = card.querySelectorAll('img.media-thumbnail');
        videos.forEach(video => destroyVideoElement(video));
        images.forEach(img => destroyImageElement(img));
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
const toolsMenuBtn = document.getElementById('tools-menu-btn');
const toolsMenuDropdown = document.getElementById('tools-menu-dropdown');
const favoritesList = document.getElementById('favorites-list');
const addFavoriteBtn = document.getElementById('add-favorite-btn');
const recentFilesList = document.getElementById('recent-files-list');
const clearRecentBtn = document.getElementById('clear-recent-btn');
const tabsContainer = document.getElementById('tabs-container');
tabsContainer.addEventListener('wheel', (e) => {
    if (e.deltaY !== 0) {
        e.preventDefault();
        tabsContainer.scrollLeft += e.deltaY;
    }
}, { passive: false });
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

// Track current filter state
let currentFilter = 'all'; // 'all', 'video', 'image'
let starFilterActive = false;
let starSortOrder = 'none'; // 'none' (use settings sort), 'desc' (high to low), 'asc' (low to high)

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

// --- Card info (metadata chips on grid cards) ---
const DEFAULT_CARD_INFO = Object.freeze({
    extension: true,
    resolution: true,
    fileSize: false,
    date: false,
    duration: true,
    starRating: true,
    audioLabel: true,
    filename: true
});
let cardInfoSettings = { ...DEFAULT_CARD_INFO };

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
const tabFolderScrollPositions = new Map(); // Map<tabId, Map<normalizedPath, scrollTop>>

function getTabScrollMap(tabId) {
    if (!tabFolderScrollPositions.has(tabId)) tabFolderScrollPositions.set(tabId, new Map());
    return tabFolderScrollPositions.get(tabId);
}

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

function hasDimensionDependentFilters() {
    return advancedSearchFilters.width !== null ||
        advancedSearchFilters.height !== null ||
        advancedSearchFilters.aspectRatio !== '';
}

function updateInMemoryFolderCaches(folderPath, items) {
    const normalizedPath = normalizePath(folderPath);
    const timestamp = Date.now();

    if (activeTabId) {
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
        card.dataset.mediaWidth = item.width;
        card.dataset.mediaHeight = item.height;
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
            } else if (layoutMode === 'masonry') {
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
    // Check all media cards and clean up media that aren't intersecting
    const allCards = gridContainer.querySelectorAll('.video-card');
    if (allCards.length === 0) {
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
    
    // Query all media elements once - maintain local arrays to avoid redundant DOM queries
    let allVideos = Array.from(gridContainer.querySelectorAll('video'));
    let allImages = Array.from(gridContainer.querySelectorAll('img.media-thumbnail'));

    if (allVideos.length === 0 && allImages.length === 0) {
        perfTest.end('performCleanupCheck', perfStart, { cardCount: allCards.length, detail: 'no media' });
        return;
    }

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
    if (cardsWithMedia.length === 0) {
        perfTest.end('performCleanupCheck', perfStart, { cardCount: allCards.length, detail: 'no active cards' });
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

function setCachedUrl(cache, key, value, maxEntries = 500) {
    cache.set(key, value);
    if (cache.size > maxEntries) {
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) {
            cache.delete(firstKey);
        }
    }
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
    if (imageThumbnailUrlCache.has(key)) {
        return Promise.resolve(imageThumbnailUrlCache.get(key));
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
    if (videoPosterUrlCache.has(filePath)) {
        return Promise.resolve(videoPosterUrlCache.get(filePath));
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
    const path = card.dataset.filePath || card.dataset.path;
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
    // Duration display is handled by the existing video-time overlay (showScrubber),
    // not by the metadata chip row.
    const showDur = false;

    if (!showSize && !showDate && !showDur) {
        card.querySelector('.card-meta-row')?.remove();
        return;
    }

    let row = card.querySelector('.card-meta-row');
    if (!row) {
        row = document.createElement('div');
        row.className = 'card-meta-row';
        const infoEl = card.querySelector('.video-info');
        if (infoEl) card.insertBefore(row, infoEl);
        else card.appendChild(row);
    }

    row.textContent = '';
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
    // No duration chip here by design.
}

function applyCardInfoStarRatingVisibility(card) {
    const el = card.querySelector('.star-rating');
    if (!el) return;
    el.style.display = cardInfoSettings.starRating ? '' : 'none';
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
}

function refreshAllVisibleMediaCardInfo() {
    const cards = vsEnabled && vsActiveCards.size > 0
        ? Array.from(vsActiveCards.values())
        : Array.from(gridContainer.querySelectorAll('.video-card'));

    for (const card of cards) {
        if (!card.classList.contains('video-card')) continue;
        delete card.dataset.overlapChecked;

        const item = getMediaItemForCard(card);
        const video = card.querySelector('video.media-thumbnail, video');
        const dur = video && isFinite(video.duration) && video.duration > 0 ? video.duration : null;

        syncCardMetaRow(card, item, dur);
        syncStarRatingOnCard(card, item?.path || card.dataset.path || card.dataset.filePath);
        if (!cardInfoSettings.duration && typeof hideScrubber === 'function') {
            hideScrubber(card);
        }

        const w = item?.width || parseInt(card.dataset.mediaWidth || card.dataset.width || '0', 10);
        const h = item?.height || parseInt(card.dataset.mediaHeight || card.dataset.height || '0', 10);
        if (cardInfoSettings.resolution && w > 0 && h > 0) {
            createResolutionLabel(card, w, h);
        } else {
            card.querySelector('.resolution-label')?.remove();
        }

        // Toggle extension label visibility
        const extLabel = card.querySelector('.extension-label');
        if (extLabel) extLabel.style.display = cardInfoSettings.extension ? '' : 'none';

        // Toggle audio/sound label visibility
        const sndLabel = card.querySelector('.sound-label');
        if (sndLabel) sndLabel.style.display = cardInfoSettings.audioLabel ? '' : 'none';

        // Toggle filename visibility
        const infoEl = card.querySelector('.video-info');
        if (infoEl) infoEl.style.display = cardInfoSettings.filename ? '' : 'none';

        // Apply responsive layout classes
        applyCardInfoLayoutClasses(card);
    }
}

// Create or update resolution label for a card
function createResolutionLabel(card, width, height) {
    if (!cardInfoSettings.resolution) {
        card.querySelector('.resolution-label')?.remove();
        return;
    }
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
    // Separate folders and files
    const folders = items.filter(item => item.type === 'folder');
    const files = items.filter(item => item.type !== 'folder');
    
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

    // Return folders first, then files
    return [...folders, ...files];
}

// Function to apply sorting and reload current folder
function applySorting() {
    if (currentFolderPath && currentItems.length > 0) {
        const previousScrollTop = gridContainer.scrollTop;
        // If sorting by date but items lack mtime (were loaded with skipStats),
        // reload from backend to get file stats
        const needsStats = sortType === 'date' && currentItems.some(item => item.type !== 'folder' && !item.mtime);
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
            card.dataset.mediaWidth = item.width; // Keep for backward compatibility
            card.dataset.mediaHeight = item.height; // Keep for backward compatibility
            // Create resolution label immediately
            createResolutionLabel(card, item.width, item.height);
        }

        // Apply pre-scanned dimensions for videos (from ffprobe during folder scan)
        if (item.width && item.height && item.type === 'video') {
            const aspectRatioName = getClosestAspectRatio(item.width, item.height);
            applyAspectRatioToCard(card, aspectRatioName, 'prescanned');
            card.dataset.width = item.width;
            card.dataset.height = item.height;
            card.dataset.mediaWidth = item.width;
            card.dataset.mediaHeight = item.height;
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
        syncCardMetaRow(card, item, null);

        if (!cardInfoSettings.filename) info.style.display = 'none';
        card.appendChild(info);

        applyCardInfoLayoutClasses(card);

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
        const emptyMsg = document.createElement('p');
        emptyMsg.style.cssText = 'grid-column: 1/-1; text-align: center;';
        emptyMsg.textContent = 'No folders or supported media found.';
        gridContainer.appendChild(emptyMsg);
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
    img.loading = 'lazy';
    img.decoding = 'async'; // Decode asynchronously for better performance
    if ('fetchPriority' in img) {
        img.fetchPriority = 'low';
    }
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
    
    // Limit image decode resolution (skip for original quality)
    if (!isOriginalQuality) {
        img.width = decodeWidth;
        img.height = decodeHeight;
    }
    
    // Optimize rendering
    img.style.imageRendering = 'auto';
    img.style.willChange = 'contents';

    const requestedThumbSize = Math.max(256, Math.ceil(Math.max(decodeWidth, decodeHeight) * 1.5));
    const thumbMaxSize = Math.min(IMAGE_THUMBNAIL_MAX_EDGE, requestedThumbSize);

    const setImageSource = (src, mode) => {
        if (!img.isConnected) return;
        img.dataset.sourceMode = mode;
        img.src = src;
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
            if (!card.dataset.mediaWidth) {
                createResolutionLabel(card, img.naturalWidth, img.naturalHeight);
            }

            if (updateItemDimensionsByPath(card.dataset.filePath, img.naturalWidth, img.naturalHeight)) {
                if (currentFolderPath) {
                    updateInMemoryFolderCaches(currentFolderPath, currentItems);
                }
                scheduleVsRecalculateForDimensions();
            }

            // Cache discovered dimensions for future visits
            if (card.dataset.filePath && !card.dataset.dimCached) {
                card.dataset.dimCached = '1';
                cacheDimensions([{
                    path: card.dataset.filePath,
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

    if (card.dataset.filePath && !isGif && !isOriginalQuality) {
        requestImageThumbnailUrl(card.dataset.filePath, thumbMaxSize)
            .then(url => {
                if (!img.isConnected) return;
                setImageSource(url || imageUrl, url ? 'thumb' : 'original');
            })
            .catch(() => {
                if (!img.isConnected) return;
                setImageSource(imageUrl, 'original');
            });
    } else {
        setImageSource(imageUrl, 'original');
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
    }

    pendingMediaCreations.delete(card);
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
    if (card.dataset.filePath && videoPosterUrlCache.has(card.dataset.filePath)) {
        video.poster = videoPosterUrlCache.get(card.dataset.filePath);
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
    if (hasFfmpegAvailable && card.dataset.filePath) {
        requestVideoPosterUrl(card.dataset.filePath).then(url => {
            if (url && video.isConnected) {
                video.poster = url;
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
            applyAspectRatioToCard(card, aspectRatioName, 'metadata');
            card.dataset.width = video.videoWidth;
            card.dataset.height = video.videoHeight;

            // Create resolution label
            createResolutionLabel(card, video.videoWidth, video.videoHeight);

            if (updateItemDimensionsByPath(card.dataset.filePath, video.videoWidth, video.videoHeight)) {
                if (currentFolderPath) {
                    updateInMemoryFolderCaches(currentFolderPath, currentItems);
                }
                scheduleVsRecalculateForDimensions();
            }

            // Cache discovered dimensions for future visits
            if (card.dataset.filePath && !card.dataset.dimCached) {
                card.dataset.dimCached = '1';
                cacheDimensions([{
                    path: card.dataset.filePath,
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
    const w = card.dataset.width || card.dataset.mediaWidth;
    const h = card.dataset.height || card.dataset.mediaHeight;
    const parts = [name];
    if (w && h) parts.push(`${w}x${h}`);
    statusSelectionInfo.textContent = parts.join(' \u2014 ');
}

function applyFilters() {
    const perfStart = perfTest.start();
    if (currentItems.length === 0) return;

    const query = searchBox.value.toLowerCase().trim();

    // Filter items array (works with virtual scrolling - no DOM iteration needed)
    const filteredItems = currentItems.filter(item => {
        const fileName = item.name.toLowerCase();

        // Search query
        const matchesSearch = query === '' || fileName.includes(query);
        if (!matchesSearch) return false;

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

        // Star filter (independent toggle)
        if (starFilterActive) {
            if (item.type === 'folder') return false;
            const rating = getFileRating(item.path);
            if (rating <= 0) return false;
        }

        // Advanced search filters
        if (advancedSearchFilters.width || advancedSearchFilters.height) {
            const width = item.width;
            const height = item.height;
            if (advancedSearchFilters.width && width !== advancedSearchFilters.width) return false;
            if (advancedSearchFilters.height && height !== advancedSearchFilters.height) return false;
        }

        if (advancedSearchFilters.aspectRatio) {
            const width = item.width;
            const height = item.height;
            if (width && height) {
                const ratio = width / height;
                const targetRatio = parseAspectRatio(advancedSearchFilters.aspectRatio);
                if (Math.abs(ratio - targetRatio) > 0.1) return false;
            } else {
                return false;
            }
        }

        if (advancedSearchFilters.starRating !== null && item.path) {
            const rating = getFileRating(item.path);
            if (rating < advancedSearchFilters.starRating) return false;
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
            const aRating = getFileRating(a.path);
            const bRating = getFileRating(b.path);
            return starSortOrder === 'asc' ? aRating - bRating : bRating - aRating;
        });
    }

    // Update virtual scrolling with filtered items
    if (vsEnabled) {
        vsUpdateItems(sortedFiltered);
    }
    updateItemCount();
    perfTest.end('applyFilters', perfStart, { cardCount: currentItems.length });
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

// Prevent middle-click auto-scroll on cards
gridContainer.addEventListener('mousedown', (e) => {
    if (e.button === 1 && e.target.closest('.video-card, .folder-card')) {
        e.preventDefault();
    }
});

// Middle-click to select a card for keyboard shortcuts
gridContainer.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return; // Only middle mouse button
    e.preventDefault();

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
    // Skip when filename is hidden — no overlap possible
    if (card && !card.dataset.overlapChecked) {
        const info = card.querySelector('.video-info');
        const resLabel = card.querySelector('.resolution-label');
        if (info && resLabel) {
            if (!cardInfoSettings.filename) {
                resLabel.classList.remove('shifted-up');
            } else {
                const range = document.createRange();
                range.selectNodeContents(info);
                const textWidth = range.getBoundingClientRect().width;
                const cardWidth = card.offsetWidth;
                const labelLeft = cardWidth - resLabel.offsetWidth - 16;
                resLabel.classList.toggle('shifted-up', textWidth + 10 > labelLeft);
            }
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

    for (let i = 0; i < filePaths.length; i++) {
        if (currentProgress && currentProgress.cancelled) break;

        const filePath = filePaths[i];
        const fileName = filePath.replace(/^.*[\\/]/, '');

        try {
            const result = await window.electronAPI.copyFile(filePath, destFolder, fileName);
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
    if (failed > 0) {
        alert(`Failed to copy ${failed} file(s)`);
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
        e.dataTransfer.dropEffect = (folderCard && isInternal) ? 'move' : 'copy';
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
});

window.addEventListener('beforeunload', () => {
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
        updateCurrentTab(folderPath, folderPath.split(/[/\\]/).pop());
        
        updateBreadcrumb(folderPath);
        searchBox.value = ''; // Clear search when navigating
        currentFilter = 'all'; // Reset filter when navigating
        filterAllBtn.classList.add('active');
        filterVideosBtn.classList.remove('active');
        filterImagesBtn.classList.remove('active');
    
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
document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.querySelector(`.settings-tab-content[data-tab="${tab.dataset.tab}"]`).classList.add('active');
    });
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

// Card info toggles
[cardInfoExtensionToggle, cardInfoResolutionToggle, cardInfoSizeToggle, cardInfoDateToggle, cardInfoDurationToggle, cardInfoStarsToggle, cardInfoAudioToggle, cardInfoFilenameToggle]
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
        loadVideos(currentFolderPath, true, gridContainer.scrollTop);
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

// Clear recent files button event listener
clearRecentBtn.addEventListener('click', () => {
    clearRecentFiles();
});

// Close tools menu when clicking outside
document.addEventListener('click', (e) => {
    if (!toolsMenuBtn.contains(e.target) && !toolsMenuDropdown.contains(e.target)) {
        toolsMenuDropdown.classList.add('hidden');
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
                if (confirm(`Are you sure you want to delete "${fileName}"?`)) {
                    setStatusActivity(`Deleting ${fileName}...`);
                    const result = await window.electronAPI.deleteFile(filePath);
                    setStatusActivity('');
                    if (result.success) {
                        // Invalidate cache and reload the current folder to reflect the change
                        if (currentFolderPath) {
                            invalidateFolderCache(currentFolderPath);
                            const previousScrollTop = gridContainer.scrollTop;
                            await loadVideos(currentFolderPath, false, previousScrollTop); // Force reload, don't use cache
                        }
                    } else {
                        alert(`Error deleting file: ${result.error}`);
                    }
                }
            } catch (error) {
                alert(`Error: ${error.message}`);
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
                const previousScrollTop = gridContainer.scrollTop;
                await loadVideos(currentFolderPath, false, previousScrollTop); // Force reload, don't use cache
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

async function loadVideos(folderPath, useCache = true, preservedScrollTop = null) {
    // Stop periodic cleanup during folder switch
    stopPeriodicCleanup();
    activeDimensionHydrationToken++;
    
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
            if (activeTabId) {
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
            items = await window.electronAPI.scanFolder(folderPath, { skipStats, scanImageDimensions, scanVideoDimensions });
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

