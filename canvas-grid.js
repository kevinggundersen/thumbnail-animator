/**
 * Canvas Grid Renderer
 *
 * Replaces the DOM-per-card virtual scroll view with a single <canvas>
 * rendered from vsPositions. Zero DOM per card during scroll.
 *
 * Architecture:
 *   #grid-container (existing scroll container, unchanged)
 *   ├── #cg-sizer            absolute div, height=vsTotalHeight — drives scrollbar
 *   ├── #cg-canvas           canvas, position:sticky top:0, viewport-sized
 *   ├── #cg-overlay-layer    absolute inset:0 — holds DOM media overlays
 *   └── #cg-a11y-live        visually hidden ARIA live region
 *
 * Integrates with:
 *   - window.__cgHost (published by renderer.js with state + action callbacks)
 *   - vsCalculatePositions / vsGetVisibleRange (via __cgHost.visibleRange)
 *   - _bitmapCache (via __cgHost.getCachedBitmap / prefetchImageBitmap)
 *
 * Public API on window.CG: see bottom.
 */

(() => {
'use strict';

// ── State ─────────────────────────────────────────────────────────────

let cgEnabled = false;
let cgInitialized = false;
let host = null;                       // window.__cgHost reference
let gridContainer = null;
let cgCanvas = null;
let cgCtx = null;
let cgSizer = null;
let cgOverlayLayer = null;
let cgA11yLive = null;

let cgDpr = 1;
let cgViewportW = 0;
let cgViewportH = 0;

let cgDirty = false;
let cgRafId = null;

let cgDataEpoch = 0;
let cgSelectionEpoch = 0;
let cgSettingsEpoch = 0;
let cgLastSig = null;

let cgHoveredIndex = -1;
let cgFocusedIndex = -1;
let cgDragOverIndex = -1;

// URLs that we've already nudged the bitmap cache to decode (avoid spam)
const cgPrefetchSeen = new Set();

// Hover media overlay: a single DOM element pooled in #cg-overlay-layer
// that plays the currently hovered video/gif/webp.
let cgHoverMediaHost = null;  // wrapper div positioned over the hovered card
let cgHoverMediaEl = null;    // the actual <video> or <img> inside the host
let cgHoverMediaItemPath = null; // what path the current media represents

// Drag proxy: a single invisible draggable div that follows the hovered card
let cgDragProxy = null;       // draggable=true, positioned over hovered card
let cgDragProxyItemIndex = -1;

let cgResizeObserver = null;
let cgScrollListenerAttached = false;
let cgInteractionListenersAttached = false;

// Style constants (match current DOM card look & feel)
const CG_STYLE = {
    cardBg: 'rgba(28,28,30,1)',
    cardBorder: 'rgba(255,255,255,0.08)',
    thumbBg: 'rgba(12,12,14,1)',
    textFg: 'rgba(235,235,240,0.92)',
    textMuted: 'rgba(180,180,190,0.7)',
    selectionBorder: 'rgba(100,180,255,1)',
    selectionOverlay: 'rgba(100,180,255,0.15)',
    hoverShadow: 'rgba(0,0,0,0.5)',
    hoverBorder: 'rgba(255,255,255,0.2)',
    missingOverlay: 'rgba(0,0,0,0.5)',
    groupHeaderBg: 'rgba(40,40,45,0.8)',
    groupHeaderFg: 'rgba(210,210,220,0.95)',
    groupHeaderCount: 'rgba(160,160,170,0.8)',
    folderTint: 'rgba(80,130,200,0.15)',
    folderIconStroke: 'rgba(120,170,230,0.9)',
    folderIconFill: 'rgba(100,150,220,0.4)',
    pinBar: 'rgba(255,200,0,0.95)',
    starActive: 'rgba(255,210,60,1)',
    starInactive: 'rgba(200,200,210,0.3)',
    chipBg: 'rgba(0,0,0,0.55)',
    chipFg: 'rgba(230,230,235,0.95)',
    audioBg: 'rgba(78,205,196,0.87)',
    audioFg: 'rgba(0,0,0,0.85)',
    cardRadius: 6,
    paintFont: '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    smallFont: '10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    tinyFont: '9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    headerFont: '13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    starSize: 12,
    starSpacing: 2,
    starRowPadding: 4,
    extLabelH: 16,
    chipH: 16
};

// ── Initialization ─────────────────────────────────────────────────────

function cgInit(container) {
    if (cgInitialized) return;
    gridContainer = container;

    cgSizer = document.createElement('div');
    cgSizer.id = 'cg-sizer';
    cgSizer.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:0;pointer-events:none;visibility:hidden;';

    cgCanvas = document.createElement('canvas');
    cgCanvas.id = 'cg-canvas';
    // position:absolute + JS-tracked top via transform on scroll.
    // (sticky can fail under contain:layout on the parent.)
    cgCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;display:none;z-index:1;will-change:transform;';

    cgOverlayLayer = document.createElement('div');
    cgOverlayLayer.id = 'cg-overlay-layer';
    cgOverlayLayer.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;display:none;';

    cgA11yLive = document.createElement('div');
    cgA11yLive.id = 'cg-a11y-live';
    cgA11yLive.setAttribute('aria-live', 'polite');
    cgA11yLive.setAttribute('aria-atomic', 'true');
    cgA11yLive.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;';

    gridContainer.appendChild(cgSizer);
    gridContainer.appendChild(cgCanvas);
    gridContainer.appendChild(cgOverlayLayer);
    gridContainer.appendChild(cgA11yLive);

    cgCtx = cgCanvas.getContext('2d', { alpha: true });

    cgResizeObserver = new ResizeObserver(() => { if (cgEnabled) cgOnResize(); });
    cgResizeObserver.observe(gridContainer);

    cgInitialized = true;
    cgOnResize();

    const saved = localStorage.getItem('useCanvasGrid');
    if (saved !== null) cgSetEnabled(saved === 'true' || saved === '1');
}

function cgAttachHost(h) {
    host = h;
    if (cgEnabled) {
        cgAttachScrollListener();
        cgAttachInteractionListeners();
        cgSyncSizerHeight();
        cgScheduleRender();
    }
}

function cgSetEnabled(enabled) {
    if (!cgInitialized) return;
    const prev = cgEnabled;
    cgEnabled = !!enabled;
    cgCanvas.style.display = cgEnabled ? '' : 'none';
    cgOverlayLayer.style.display = cgEnabled ? '' : 'none';
    cgSizer.style.display = cgEnabled ? '' : 'none';
    localStorage.setItem('useCanvasGrid', cgEnabled ? '1' : '0');
    if (cgEnabled && !prev) {
        cgOnResize();
        cgAttachScrollListener();
        cgAttachInteractionListeners();
        cgSyncSizerHeight();
        cgScheduleRender();
    } else if (!cgEnabled && prev) {
        cgTeardownHoverMedia();
        cgHoveredIndex = -1;
    }
}

function cgIsEnabled() { return cgEnabled; }

function cgSyncSizerHeight() {
    if (!host) return;
    const h = host.totalHeight || 0;
    cgSizer.style.height = h + 'px';
}

function cgOnResize() {
    if (!cgInitialized) return;
    cgDpr = window.devicePixelRatio || 1;
    cgViewportW = gridContainer.clientWidth;
    cgViewportH = gridContainer.clientHeight;
    cgCanvas.width = Math.max(1, Math.round(cgViewportW * cgDpr));
    cgCanvas.height = Math.max(1, Math.round(cgViewportH * cgDpr));
    cgCanvas.style.width = cgViewportW + 'px';
    cgCanvas.style.height = cgViewportH + 'px';
    // Re-anchor the canvas to the current scroll offset
    cgCanvas.style.transform = `translate(0, ${gridContainer.scrollTop}px)`;
    cgCtx.setTransform(cgDpr, 0, 0, cgDpr, 0, 0);
    cgLastSig = null;
    if (cgEnabled) cgScheduleRender();
}

// ── Scroll + interaction listeners ─────────────────────────────────────

function cgAttachScrollListener() {
    if (cgScrollListenerAttached || !gridContainer) return;
    gridContainer.addEventListener('scroll', () => {
        if (!cgEnabled) return;
        // Keep the canvas anchored to the scroll viewport (it's position:absolute
        // so scrolling moves it away — we counter-translate to keep it pinned).
        cgCanvas.style.transform = `translate(0, ${gridContainer.scrollTop}px)`;
        cgScheduleRender();
    }, { passive: true });
    cgScrollListenerAttached = true;
}

function cgAttachInteractionListeners() {
    if (cgInteractionListenersAttached || !gridContainer) return;
    cgInteractionListenersAttached = true;

    gridContainer.addEventListener('mousemove', (e) => {
        if (!cgEnabled) return;
        const hit = cgHitTest(e.clientX, e.clientY);
        const newIdx = hit.itemIndex;
        if (newIdx !== cgHoveredIndex) {
            cgHoveredIndex = newIdx;
            cgUpdateHoverOverlay(newIdx);
            cgUpdateDragProxy(newIdx);
            cgScheduleRender();
        }
    }, { passive: true });

    gridContainer.addEventListener('mouseleave', () => {
        if (!cgEnabled) return;
        if (cgHoveredIndex !== -1) {
            cgHoveredIndex = -1;
            cgUpdateHoverOverlay(-1);
            cgUpdateDragProxy(-1);
            cgScheduleRender();
        }
    });

    gridContainer.addEventListener('click', (e) => {
        if (!cgEnabled || !host) return;
        const hit = cgHitTest(e.clientX, e.clientY);
        if (hit.itemIndex < 0) return;
        const item = host.items[hit.itemIndex];
        if (!item) return;

        if (hit.zone === 'group-toggle' || hit.zone === 'group-header') {
            if (item.groupKey) host.toggleDateGroup(item.groupKey);
            return;
        }
        if (hit.zone === 'folder') {
            host.navigateToFolder(item.path || item.folderPath);
            return;
        }
        if (hit.zone === 'star') {
            // Toggle: clicking current rating clears it, else sets to sub-index
            const current = item.path ? host.getFileRating(item.path) : 0;
            const newRating = (current === hit.subIndex) ? 0 : hit.subIndex;
            host.setFileRating(item.path, newRating);
            cgScheduleRender();
            e.stopPropagation();
            return;
        }
        if (hit.zone === 'card') {
            if (e.ctrlKey || e.metaKey) {
                host.toggleSelection(hit.itemIndex, 'ctrl');
            } else if (e.shiftKey) {
                host.toggleSelection(hit.itemIndex, 'shift');
            } else {
                host.openLightbox(hit.itemIndex);
            }
        }
    });

    gridContainer.addEventListener('contextmenu', (e) => {
        if (!cgEnabled || !host) return;
        const hit = cgHitTest(e.clientX, e.clientY);
        if (hit.itemIndex < 0) return;
        const vcard = cgResolveCardDescriptor(hit.itemIndex, hit.zone);
        if (vcard) host.showContextMenu(e, vcard);
    });

    // Keyboard navigation: arrow keys move focus, Enter activates
    document.addEventListener('keydown', (e) => {
        if (!cgEnabled || !host) return;
        // Ignore when typing in inputs
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        // Skip if a modal/lightbox is likely open
        if (document.body.classList.contains('modal-open') || document.getElementById('lightbox')?.classList.contains('visible')) return;

        const items = host.items;
        if (!items || items.length === 0) return;
        let newIdx = cgFocusedIndex;
        const cols = cgEstimateColumnCount();

        if (e.key === 'ArrowRight') newIdx = (cgFocusedIndex < 0) ? 0 : Math.min(items.length - 1, cgFocusedIndex + 1);
        else if (e.key === 'ArrowLeft') newIdx = (cgFocusedIndex < 0) ? 0 : Math.max(0, cgFocusedIndex - 1);
        else if (e.key === 'ArrowDown') newIdx = (cgFocusedIndex < 0) ? 0 : Math.min(items.length - 1, cgFocusedIndex + cols);
        else if (e.key === 'ArrowUp') newIdx = (cgFocusedIndex < 0) ? 0 : Math.max(0, cgFocusedIndex - cols);
        else if (e.key === 'Enter' && cgFocusedIndex >= 0) {
            const item = items[cgFocusedIndex];
            if (item && item.type === 'folder') host.navigateToFolder(item.path || item.folderPath);
            else if (item && item.type !== 'group-header') host.openLightbox(cgFocusedIndex);
            e.preventDefault();
            return;
        } else {
            return;
        }
        e.preventDefault();
        if (newIdx !== cgFocusedIndex) {
            cgFocusedIndex = newIdx;
            cgScrollFocusedIntoView();
            cgAnnounceFocusedCard();
            cgScheduleRender();
        }
    });
}

function cgEstimateColumnCount() {
    // Derive from position data: count how many items in the first "row"
    const positions = host.positions;
    const items = host.items;
    if (!positions || !items || items.length === 0) return 1;
    const firstTop = positions[1];
    let count = 0;
    for (let i = 0; i < items.length; i++) {
        if (items[i].type === 'group-header') continue;
        if (positions[i * 4 + 1] === firstTop || positions[i * 4 + 1] < firstTop + 4) count++;
        else break;
    }
    return Math.max(1, count);
}

function cgScrollFocusedIntoView() {
    if (cgFocusedIndex < 0 || !host) return;
    const positions = host.positions;
    const idx = cgFocusedIndex * 4;
    const y = positions[idx + 1];
    const h = positions[idx + 3];
    const scrollTop = gridContainer.scrollTop;
    if (y < scrollTop + 20) {
        gridContainer.scrollTop = Math.max(0, y - 20);
    } else if (y + h > scrollTop + cgViewportH - 20) {
        gridContainer.scrollTop = y + h - cgViewportH + 20;
    }
}

function cgAnnounceFocusedCard() {
    if (!cgA11yLive || cgFocusedIndex < 0 || !host) return;
    const item = host.items[cgFocusedIndex];
    if (!item) return;
    let msg;
    if (item.type === 'folder') msg = `Folder: ${item.name}`;
    else if (item.type === 'group-header') msg = `Group: ${item.label || ''}`;
    else msg = `${item.type === 'video' ? 'Video' : 'Image'}: ${item.name || ''}`;
    cgA11yLive.textContent = msg;
}

function cgAnnounceSelection() {
    if (!cgA11yLive || !host) return;
    const count = (host.selection && host.selection.size) || 0;
    if (count > 0) cgA11yLive.textContent = `${count} item${count === 1 ? '' : 's'} selected`;
}

// ── Invalidation ───────────────────────────────────────────────────────

function cgInvalidateData() {
    if (!cgEnabled) return;
    cgDataEpoch++;
    cgSyncSizerHeight();
    cgPrefetchSeen.clear();
    // Items may have been reordered/filtered — hovered index is stale
    cgHoveredIndex = -1;
    cgTeardownHoverMedia();
    cgScheduleRender();
}
function cgInvalidateSelection() {
    if (!cgEnabled) return;
    cgSelectionEpoch++; cgAnnounceSelection(); cgScheduleRender();
}
function cgInvalidateSettings() {
    if (!cgEnabled) return;
    cgSettingsEpoch++; cgLastSig = null; cgScheduleRender();
}
function cgInvalidateHover(newIndex) {
    if (!cgEnabled) return;
    if (newIndex === cgHoveredIndex) return;
    cgHoveredIndex = newIndex;
    cgScheduleRender();
}

// ── Render loop ────────────────────────────────────────────────────────

function cgScheduleRender() {
    if (!cgEnabled || !cgInitialized) return;
    cgDirty = true;
    if (cgRafId != null) return;
    cgRafId = requestAnimationFrame(cgRender);
}

function cgRender() {
    cgRafId = null;
    if (!cgEnabled || !cgDirty || !host) return;
    cgDirty = false;

    const scrollTop = gridContainer.scrollTop;
    const items = host.items;
    const positions = host.positions;
    const visibleRangeFn = host.visibleRange;
    if (!items || !positions || !visibleRangeFn) {
        cgCtx.clearRect(0, 0, cgViewportW, cgViewportH);
        if (!window._cgLoggedNoData) {
            console.log('[cg-render] no data:', { items: !!items, positions: !!positions, visibleRangeFn: !!visibleRangeFn });
            window._cgLoggedNoData = true;
        }
        return;
    }

    const sig = `${scrollTop}|${cgViewportW}|${cgViewportH}|${cgHoveredIndex}|${cgFocusedIndex}|${cgSelectionEpoch}|${cgDataEpoch}|${cgSettingsEpoch}|${cgDragOverIndex}|${items.length}`;
    if (sig === cgLastSig) return;
    cgLastSig = sig;

    cgCtx.clearRect(0, 0, cgViewportW, cgViewportH);

    const { startIndex, endIndex } = visibleRangeFn(scrollTop, cgViewportH);
    if (!window._cgLoggedFirst) {
        const rect = cgCanvas.getBoundingClientRect();
        const gcRect = gridContainer.getBoundingClientRect();
        const computed = getComputedStyle(cgCanvas);
        console.log(`[cg-render] first render | items=${items.length} range=${startIndex}..${endIndex} viewport=${cgViewportW}x${cgViewportH} scroll=${scrollTop} display=${cgCanvas.style.display} transform=${cgCanvas.style.transform}`);
        console.log(`[cg-render] canvas rect: top=${rect.top} left=${rect.left} w=${rect.width} h=${rect.height} visibility=${computed.visibility} opacity=${computed.opacity} zIndex=${computed.zIndex}`);
        console.log(`[cg-render] gridContainer rect: top=${gcRect.top} left=${gcRect.left} w=${gcRect.width} h=${gcRect.height}`);
        if (items.length > 0 && positions) {
            console.log(`[cg-render] first item pos: left=${positions[0]} top=${positions[1]} w=${positions[2]} h=${positions[3]}`);
        }
        window._cgLoggedFirst = true;
    }

    const selection = host.selection;

    for (let i = startIndex; i < endIndex; i++) {
        const item = items[i];
        if (!item) continue;
        const idx = i * 4;
        const x = positions[idx];
        const y = positions[idx + 1] - scrollTop;
        const w = positions[idx + 2];
        const h = positions[idx + 3];

        // Skip items entirely offscreen (binary-search is approximate for masonry)
        if (y + h < -8 || y > cgViewportH + 8) continue;

        const isHovered = (i === cgHoveredIndex);
        const isSelected = item.path && selection && selection.has(item.path);
        const isDragOver = (i === cgDragOverIndex);

        if (item.type === 'group-header') {
            cgPaintGroupHeader(item, x, y, w, h);
        } else if (item.type === 'folder') {
            cgPaintFolderCard(item, x, y, w, h, isHovered, isSelected, isDragOver);
        } else {
            cgPaintMediaCard(item, x, y, w, h, i, isHovered, isSelected);
        }

        // Keyboard focus ring (dotted outline)
        if (i === cgFocusedIndex) {
            cgCtx.save();
            cgCtx.strokeStyle = 'rgba(100,180,255,0.95)';
            cgCtx.lineWidth = 2;
            cgCtx.setLineDash([4, 3]);
            cgRoundRectPath(cgCtx, x + 1, y + 1, w - 2, h - 2, CG_STYLE.cardRadius);
            cgCtx.stroke();
            cgCtx.restore();
        }
    }
}

// ── Painters ───────────────────────────────────────────────────────────

function cgRoundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
}

function cgShouldShow(settings, key, isHovered) {
    if (!settings[key]) return false;
    const hoverOnly = settings[key + 'OnlyOnHover'];
    return !hoverOnly || isHovered;
}

function cgPaintMediaCard(item, x, y, w, h, itemIndex, isHovered, isSelected) {
    const ctx = cgCtx;
    const r = CG_STYLE.cardRadius;
    const settings = host.cardInfoSettings || {};
    const isPinned = item.path && host.isFilePinned(item.path);
    const rating = item.path ? host.getFileRating(item.path) : 0;

    // Background rect (with optional hover shadow)
    if (isHovered) {
        ctx.save();
        ctx.shadowColor = CG_STYLE.hoverShadow;
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = CG_STYLE.thumbBg;
        cgRoundRectPath(ctx, x, y, w, h, r);
        ctx.fill();
        ctx.restore();
    } else {
        ctx.fillStyle = CG_STYLE.thumbBg;
        cgRoundRectPath(ctx, x, y, w, h, r);
        ctx.fill();
    }

    // Thumbnail bitmap, clipped to card rect
    if (item.path) {
        const thumbUrl = cgResolveThumbUrl(item, Math.round(w * 2));
        if (thumbUrl) {
            const cached = host.getCachedBitmap(thumbUrl);
            if (cached && cached.bitmap) {
                ctx.save();
                cgRoundRectPath(ctx, x, y, w, h, r);
                ctx.clip();
                try {
                    cgDrawBitmapCover(ctx, cached.bitmap, cached.w, cached.h, x, y, w, h);
                } catch (err) {
                    // Bitmap was closed/detached by another code path. Evict
                    // the stale cache entry and schedule a redraw; the next
                    // frame will trigger a fresh decode via prefetch.
                    ctx.restore();
                    window._cgDetachCount = (window._cgDetachCount || 0) + 1;
                    if (window._cgDetachCount < 5) {
                        console.warn('[cg] detached bitmap for', thumbUrl, 'count:', window._cgDetachCount);
                    }
                    if (host.evictBitmap) host.evictBitmap(thumbUrl);
                    cgPrefetchSeen.delete(thumbUrl);
                    cgScheduleRender();
                    return; // skip the rest of this card's chrome this frame
                }
                ctx.restore();
            } else if (!cgPrefetchSeen.has(thumbUrl)) {
                cgPrefetchSeen.add(thumbUrl);
                const p = host.prefetchImageBitmap(thumbUrl, Math.round(w), Math.round(h));
                if (p && p.then) {
                    p.then((bitmap) => {
                        // If decode failed (returned null), allow a future retry
                        if (!bitmap) cgPrefetchSeen.delete(thumbUrl);
                        cgScheduleRender();
                    }).catch(() => {
                        cgPrefetchSeen.delete(thumbUrl);
                        cgScheduleRender();
                    });
                }
            }
        }
    }

    // Missing-file dim
    if (item.missing) {
        ctx.save();
        ctx.fillStyle = CG_STYLE.missingOverlay;
        cgRoundRectPath(ctx, x, y, w, h, r);
        ctx.fill();
        ctx.restore();
    }

    // Clip subsequent chrome to card shape
    ctx.save();
    cgRoundRectPath(ctx, x, y, w, h, r);
    ctx.clip();

    // Bottom gradient for text legibility
    const gradH = Math.min(56, h * 0.45);
    const grad = ctx.createLinearGradient(0, y + h - gradH, 0, y + h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y + h - gradH, w, gradH);

    // Extension label (top-left)
    if (cgShouldShow(settings, 'extension', isHovered) && item.name) {
        const ext = cgExtOf(item.name);
        if (ext) cgDrawExtLabel(ctx, ext, x + 6, y + 6);
    }

    // Audio label (top-right, only for videos with audio)
    if (cgShouldShow(settings, 'audioLabel', isHovered) && item.hasAudio) {
        cgDrawAudioLabel(ctx, x + w - 6, y + 6);
    }

    // Star rating (above filename area, right-aligned)
    if (cgShouldShow(settings, 'starRating', isHovered)) {
        cgDrawStars(ctx, rating, x, y, w, h, isHovered);
    }

    // Meta chips row (resolution + size + date) above filename
    const chips = [];
    if (cgShouldShow(settings, 'resolution', isHovered) && item.width && item.height) {
        const ar = host.getClosestAspectRatio(item.width, item.height);
        chips.push(`${item.width}\u00d7${item.height}${ar ? ' \u2022 ' + ar : ''}`);
    }
    if (cgShouldShow(settings, 'fileSize', isHovered) && item.size) {
        chips.push(host.formatBytesForCardLabel(item.size));
    }
    if (cgShouldShow(settings, 'date', isHovered) && item.mtime) {
        chips.push(host.formatCardDate(item.mtime));
    }
    let chipsY = y + h - 6;
    if (cgShouldShow(settings, 'filename', isHovered) && item.name) {
        chipsY -= 16; // reserve row above for filename
    }
    if (chips.length > 0) {
        cgDrawChipsRow(ctx, chips, x + 6, chipsY - 14, w - 12);
    }

    // Tag badges (bottom-right, above filename / chips)
    if (cgShouldShow(settings, 'tags', isHovered) && item.path) {
        const tags = host.fileTagsGetter(item.path);
        if (tags && tags.length > 0) {
            let tagsY = y + h - 6;
            if (cgShouldShow(settings, 'filename', isHovered) && item.name) tagsY -= 16;
            if (chips.length > 0) tagsY -= 18;
            cgDrawTagBadges(ctx, tags, x + 6, tagsY - 14, w - 12);
        }
    }

    // Filename (bottom, ellipsized)
    if (cgShouldShow(settings, 'filename', isHovered) && item.name) {
        ctx.fillStyle = CG_STYLE.textFg;
        ctx.font = CG_STYLE.paintFont;
        ctx.textBaseline = 'bottom';
        const maxW = w - 12;
        const label = cgEllipsize(ctx, item.name, maxW);
        ctx.fillText(label, x + 6, y + h - 6);
    }

    ctx.restore(); // unclip

    // Pin bar (top edge, full width)
    if (isPinned) {
        ctx.save();
        ctx.fillStyle = CG_STYLE.pinBar;
        cgRoundRectPath(ctx, x, y, w, 3, r);
        ctx.fill();
        ctx.restore();
    }

    // Selection / hover border
    if (isSelected) {
        ctx.save();
        ctx.fillStyle = CG_STYLE.selectionOverlay;
        cgRoundRectPath(ctx, x, y, w, h, r);
        ctx.fill();
        ctx.strokeStyle = CG_STYLE.selectionBorder;
        ctx.lineWidth = 2;
        cgRoundRectPath(ctx, x + 1, y + 1, w - 2, h - 2, r);
        ctx.stroke();
        ctx.restore();
    } else if (isHovered) {
        ctx.save();
        ctx.strokeStyle = CG_STYLE.hoverBorder;
        ctx.lineWidth = 1;
        cgRoundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
        ctx.stroke();
        ctx.restore();
    }
}

// ── Chrome painters ────────────────────────────────────────────────────

function cgExtOf(name) {
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot + 1).toUpperCase() : '';
}

function cgDrawExtLabel(ctx, ext, x, y) {
    ctx.save();
    ctx.font = 'bold 9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const textW = ctx.measureText(ext).width;
    const padX = 5;
    const w = textW + padX * 2;
    const h = CG_STYLE.extLabelH;
    const color = host.getExtensionColor(ext);
    ctx.fillStyle = host.hexToRgba(color, 0.87);
    cgRoundRectPath(ctx, x, y, w, h, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.textBaseline = 'middle';
    ctx.fillText(ext, x + padX, y + h / 2 + 0.5);
    ctx.restore();
}

function cgDrawAudioLabel(ctx, xRight, y) {
    ctx.save();
    ctx.font = 'bold 9px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const textW = ctx.measureText('AUDIO').width;
    const padX = 5;
    const w = textW + padX * 2;
    const h = CG_STYLE.extLabelH;
    const x = xRight - w;
    ctx.fillStyle = CG_STYLE.audioBg;
    cgRoundRectPath(ctx, x, y, w, h, 3);
    ctx.fill();
    ctx.fillStyle = CG_STYLE.audioFg;
    ctx.textBaseline = 'middle';
    ctx.fillText('AUDIO', x + padX, y + h / 2 + 0.5);
    ctx.restore();
}

function cgDrawStars(ctx, rating, cardX, cardY, cardW, cardH, isHovered) {
    const rect = cgComputeStarRect(cardX, cardY, cardW, cardH);
    ctx.save();
    for (let i = 0; i < 5; i++) {
        const sx = rect.x + i * (rect.starSize + CG_STYLE.starSpacing);
        const sy = rect.y;
        const filled = (i < rating);
        cgDrawStarShape(ctx, sx, sy, rect.starSize,
            filled ? CG_STYLE.starActive : CG_STYLE.starInactive, filled);
    }
    ctx.restore();
}

function cgComputeStarRect(cardX, cardY, cardW /*, cardH*/) {
    const starSize = CG_STYLE.starSize;
    const totalW = starSize * 5 + CG_STYLE.starSpacing * 4;
    const x = cardX + cardW - totalW - CG_STYLE.starRowPadding - 6;
    const y = cardY + CG_STYLE.starRowPadding + 3;
    return { x, y, starSize, totalW };
}

function cgDrawStarShape(ctx, x, y, size, color, filled) {
    // 5-point star path
    const cx = x + size / 2;
    const cy = y + size / 2;
    const outer = size / 2;
    const inner = outer * 0.4;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
        const r = (i % 2 === 0) ? outer : inner;
        const angle = -Math.PI / 2 + (Math.PI / 5) * i;
        const px = cx + Math.cos(angle) * r;
        const py = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    if (filled) {
        ctx.fillStyle = color;
        ctx.fill();
    } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

function cgDrawChipsRow(ctx, chips, x, y, maxW) {
    ctx.save();
    ctx.font = CG_STYLE.smallFont;
    ctx.textBaseline = 'middle';
    let cx = x;
    const h = CG_STYLE.chipH;
    for (const text of chips) {
        const tw = ctx.measureText(text).width;
        const padX = 5;
        const cw = tw + padX * 2;
        if (cx + cw - x > maxW) break;
        ctx.fillStyle = CG_STYLE.chipBg;
        cgRoundRectPath(ctx, cx, y, cw, h, 3);
        ctx.fill();
        ctx.fillStyle = CG_STYLE.chipFg;
        ctx.fillText(text, cx + padX, y + h / 2 + 0.5);
        cx += cw + 4;
    }
    ctx.restore();
}

function cgPaintFolderCard(item, x, y, w, h, isHovered, isSelected, isDragOver) {
    const ctx = cgCtx;
    const r = CG_STYLE.cardRadius;

    ctx.fillStyle = CG_STYLE.cardBg;
    cgRoundRectPath(ctx, x, y, w, h, r);
    ctx.fill();

    // Folder tint background
    ctx.save();
    cgRoundRectPath(ctx, x, y, w, h, r);
    ctx.clip();
    ctx.fillStyle = CG_STYLE.folderTint;
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    // Folder icon (stylized rectangle with tab)
    const iconSize = Math.min(48, w * 0.4, h * 0.5);
    const ix = x + (w - iconSize) / 2;
    const iy = y + h * 0.3 - iconSize / 2;
    cgDrawFolderIcon(ctx, ix, iy, iconSize);

    // Folder name
    ctx.fillStyle = CG_STYLE.textFg;
    ctx.font = CG_STYLE.paintFont;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const label = cgEllipsize(ctx, item.name || '', w - 16);
    ctx.fillText(label, x + w / 2, y + h * 0.75);
    ctx.textAlign = 'left';

    // Selection / hover / drag-over border
    if (isDragOver) {
        ctx.save();
        ctx.strokeStyle = 'rgba(100,220,150,0.9)';
        ctx.lineWidth = 3;
        cgRoundRectPath(ctx, x + 1.5, y + 1.5, w - 3, h - 3, r);
        ctx.stroke();
        ctx.restore();
    } else if (isSelected) {
        ctx.save();
        ctx.fillStyle = CG_STYLE.selectionOverlay;
        cgRoundRectPath(ctx, x, y, w, h, r);
        ctx.fill();
        ctx.strokeStyle = CG_STYLE.selectionBorder;
        ctx.lineWidth = 2;
        cgRoundRectPath(ctx, x + 1, y + 1, w - 2, h - 2, r);
        ctx.stroke();
        ctx.restore();
    } else if (isHovered) {
        ctx.save();
        ctx.strokeStyle = CG_STYLE.hoverBorder;
        ctx.lineWidth = 1;
        cgRoundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
        ctx.stroke();
        ctx.restore();
    }
}

function cgPaintGroupHeader(item, x, y, w, h) {
    const ctx = cgCtx;
    const collapsed = host.collapsedDateGroups && host.collapsedDateGroups.has(item.groupKey);

    // Background pill
    ctx.fillStyle = CG_STYLE.groupHeaderBg;
    ctx.fillRect(x, y, w, h);

    // Toggle triangle + label + count
    ctx.font = CG_STYLE.headerFont;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = CG_STYLE.groupHeaderFg;
    const arrow = collapsed ? '▶' : '▼';
    ctx.fillText(arrow, x + 12, y + h / 2);

    if (item.label) {
        ctx.fillText(item.label, x + 34, y + h / 2);
    }

    if (item.count != null) {
        const countStr = String(item.count);
        ctx.fillStyle = CG_STYLE.groupHeaderCount;
        ctx.textAlign = 'right';
        ctx.fillText(countStr, x + w - 16, y + h / 2);
        ctx.textAlign = 'left';
    }
}

function cgDrawFolderIcon(ctx, x, y, size) {
    // Simple folder shape: tab on top-left, body below
    ctx.save();
    ctx.fillStyle = CG_STYLE.folderIconFill;
    ctx.strokeStyle = CG_STYLE.folderIconStroke;
    ctx.lineWidth = 1.5;
    const tabW = size * 0.4;
    const tabH = size * 0.15;
    const bodyY = y + tabH;
    const bodyH = size - tabH;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + tabW, y);
    ctx.lineTo(x + tabW + size * 0.1, bodyY);
    ctx.lineTo(x + size, bodyY);
    ctx.lineTo(x + size, y + size);
    ctx.lineTo(x, y + size);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

function cgDrawBitmapCover(ctx, bitmap, bw, bh, x, y, w, h) {
    // Object-fit: cover semantics
    const scale = Math.max(w / bw, h / bh);
    const drawW = bw * scale;
    const drawH = bh * scale;
    const drawX = x + (w - drawW) / 2;
    const drawY = y + (h - drawH) / 2;
    ctx.drawImage(bitmap, drawX, drawY, drawW, drawH);
}

function cgDrawCenteredText(ctx, text, x, y, maxW, color, font, align) {
    ctx.fillStyle = color;
    ctx.font = font;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    const label = cgEllipsize(ctx, text, maxW);
    ctx.fillText(label, align === 'center' ? x + maxW / 2 : x, y);
    ctx.textAlign = 'left';
}

// ── Hover media overlay (Phase 3) ──────────────────────────────────────
// Single DOM video/img pooled in #cg-overlay-layer that plays the hovered
// card's media. Overlay is inside the scroll container, so it moves with
// scroll natively — no per-frame sync needed.

function cgEnsureHoverMediaHost() {
    if (cgHoverMediaHost) return cgHoverMediaHost;
    cgHoverMediaHost = document.createElement('div');
    cgHoverMediaHost.id = 'cg-hover-media';
    cgHoverMediaHost.style.cssText = 'position:absolute;top:0;left:0;border-radius:6px;overflow:hidden;pointer-events:none;will-change:transform;';
    cgOverlayLayer.appendChild(cgHoverMediaHost);
    return cgHoverMediaHost;
}

function cgTeardownHoverMedia() {
    if (cgHoverMediaEl) {
        try {
            if (cgHoverMediaEl.tagName === 'VIDEO' && host.destroyVideoElement) {
                host.destroyVideoElement(cgHoverMediaEl);
            } else if (cgHoverMediaEl.tagName === 'IMG' && host.destroyImageElement) {
                host.destroyImageElement(cgHoverMediaEl);
            } else {
                // Fallback: just detach
                if (cgHoverMediaEl.tagName === 'VIDEO') {
                    try { cgHoverMediaEl.pause(); cgHoverMediaEl.src = ''; cgHoverMediaEl.load(); } catch {}
                }
                if (cgHoverMediaEl.parentNode) cgHoverMediaEl.parentNode.removeChild(cgHoverMediaEl);
            }
        } catch {}
        cgHoverMediaEl = null;
        cgHoverMediaItemPath = null;
    }
    if (cgHoverMediaHost) cgHoverMediaHost.style.display = 'none';
}

function cgUpdateHoverOverlay(itemIndex) {
    if (!cgEnabled || !host) { cgTeardownHoverMedia(); return; }

    if (itemIndex < 0) {
        cgTeardownHoverMedia();
        return;
    }
    const item = host.items[itemIndex];
    if (!item || item.type === 'folder' || item.type === 'group-header' || item.missing) {
        cgTeardownHoverMedia();
        return;
    }

    // If already showing the right media, just reposition
    if (cgHoverMediaItemPath === item.path && cgHoverMediaEl) {
        cgPositionHoverMediaHost(itemIndex);
        return;
    }

    // Different item or nothing loaded — rebuild
    cgTeardownHoverMedia();

    const host_el = cgEnsureHoverMediaHost();
    cgPositionHoverMediaHost(itemIndex);
    host_el.style.display = '';

    // Create video or img based on item type
    const url = item.url;
    if (!url) return;

    if (item.type === 'video') {
        const v = document.createElement('video');
        v.className = 'media-thumbnail cg-overlay-video';
        v.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;';
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        v.preload = 'auto';
        v.src = url;
        host_el.appendChild(v);
        cgHoverMediaEl = v;
        cgHoverMediaItemPath = item.path;
        const p = v.play();
        if (p && p.catch) p.catch(() => { /* ignore autoplay errors */ });
    } else if (item.type === 'image') {
        const img = document.createElement('img');
        img.className = 'media-thumbnail cg-overlay-img';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;';
        img.src = url;
        host_el.appendChild(img);
        cgHoverMediaEl = img;
        cgHoverMediaItemPath = item.path;
    }
}

function cgPositionHoverMediaHost(itemIndex) {
    if (!cgHoverMediaHost || !host) return;
    const positions = host.positions;
    if (!positions) return;
    const idx = itemIndex * 4;
    const x = positions[idx];
    const y = positions[idx + 1];
    const w = positions[idx + 2];
    const h = positions[idx + 3];
    cgHoverMediaHost.style.width = w + 'px';
    cgHoverMediaHost.style.height = h + 'px';
    cgHoverMediaHost.style.transform = `translate(${x}px, ${y}px)`;
}

// ── Drag proxy (Phase 4) ───────────────────────────────────────────────

function cgEnsureDragProxy() {
    if (cgDragProxy) return cgDragProxy;
    cgDragProxy = document.createElement('div');
    cgDragProxy.id = 'cg-drag-proxy';
    cgDragProxy.draggable = true;
    cgDragProxy.style.cssText = 'position:absolute;top:0;left:0;pointer-events:auto;background:transparent;z-index:2;will-change:transform;display:none;';

    cgDragProxy.addEventListener('dragstart', (e) => {
        const idx = cgDragProxyItemIndex;
        if (idx < 0 || !host) { e.preventDefault(); return; }
        const item = host.items[idx];
        if (!item || !item.path) { e.preventDefault(); return; }

        e.dataTransfer.effectAllowed = 'copyMove';
        e.dataTransfer.setData('text/plain', item.path);
        if (item.url) e.dataTransfer.setData('text/uri-list', item.url);
        e.dataTransfer.setData('application/x-thumbnail-animator-path', item.path);

        // Use the cached bitmap as drag image if available
        const thumbUrl = cgResolveThumbUrl(item, 256);
        if (thumbUrl) {
            const cached = host.getCachedBitmap(thumbUrl);
            if (cached && cached.bitmap) {
                try {
                    const off = document.createElement('canvas');
                    const maxEdge = 128;
                    const scale = Math.min(maxEdge / cached.w, maxEdge / cached.h, 1);
                    off.width = Math.max(1, Math.round(cached.w * scale));
                    off.height = Math.max(1, Math.round(cached.h * scale));
                    off.getContext('2d').drawImage(cached.bitmap, 0, 0, off.width, off.height);
                    e.dataTransfer.setDragImage(off, off.width / 2, off.height / 2);
                } catch {}
            }
        }
    });

    cgDragProxy.addEventListener('click', (e) => {
        // Let clicks fall through to gridContainer via bubble, but we need to
        // re-dispatch because the event.target is the proxy not the canvas.
        // The grid's click handler reads e.clientX/Y, so bubbling works fine.
    });

    cgOverlayLayer.appendChild(cgDragProxy);
    return cgDragProxy;
}

function cgUpdateDragProxy(itemIndex) {
    const proxy = cgEnsureDragProxy();
    if (itemIndex < 0 || !host) {
        proxy.style.display = 'none';
        cgDragProxyItemIndex = -1;
        return;
    }
    const item = host.items[itemIndex];
    // Skip group-headers (not draggable)
    if (!item || item.type === 'group-header') {
        proxy.style.display = 'none';
        cgDragProxyItemIndex = -1;
        return;
    }
    const positions = host.positions;
    const idx = itemIndex * 4;
    const x = positions[idx];
    const y = positions[idx + 1];
    const w = positions[idx + 2];
    const h = positions[idx + 3];
    proxy.style.width = w + 'px';
    proxy.style.height = h + 'px';
    proxy.style.transform = `translate(${x}px, ${y}px)`;
    proxy.style.display = '';
    // Store item info on the proxy for dragstart handler
    proxy.dataset.path = item.path || '';
    proxy.dataset.url = item.url || '';
    cgDragProxyItemIndex = itemIndex;
}

// ── Text helpers ───────────────────────────────────────────────────────

// Text metrics cache: keyed by `${font}|${text}|${maxWidth}` -> ellipsized string
// Bounded to 2000 entries via simple FIFO rotation.
const cgTextCache = new Map();
const CG_TEXT_CACHE_MAX = 2000;

function cgEllipsize(ctx, text, maxWidth) {
    if (!text) return '';
    const font = ctx.font;
    const key = `${font}|${text}|${Math.round(maxWidth)}`;
    const cached = cgTextCache.get(key);
    if (cached !== undefined) return cached;

    let result;
    const w = ctx.measureText(text).width;
    if (w <= maxWidth) {
        result = text;
    } else {
        const ell = '…';
        let lo = 0, hi = text.length;
        while (lo < hi) {
            const mid = (lo + hi + 1) >>> 1;
            const candidate = text.slice(0, mid) + ell;
            if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
            else hi = mid - 1;
        }
        result = text.slice(0, lo) + ell;
    }
    if (cgTextCache.size >= CG_TEXT_CACHE_MAX) {
        // Evict oldest entry (Map iteration is insertion order)
        const firstKey = cgTextCache.keys().next().value;
        cgTextCache.delete(firstKey);
    }
    cgTextCache.set(key, result);
    return result;
}

// ── Tag badges ─────────────────────────────────────────────────────────

function cgDrawTagBadges(ctx, tags, x, y, maxW) {
    if (!tags || tags.length === 0) return;
    ctx.save();
    ctx.font = CG_STYLE.smallFont;
    ctx.textBaseline = 'middle';
    const h = 16;
    const gap = 4;
    const maxBadges = 5;
    const visible = tags.slice(0, maxBadges);
    const overflow = tags.length - visible.length;

    // Layout right-aligned
    const items = [];
    let totalW = 0;
    for (const tag of visible) {
        const text = tag.name || '';
        const tw = ctx.measureText(text).width;
        const w = tw + 10;
        items.push({ text, w, color: tag.color || '#555' });
        totalW += w + gap;
    }
    if (overflow > 0) {
        const text = '+' + overflow;
        const tw = ctx.measureText(text).width;
        const w = tw + 10;
        items.push({ text, w, color: '#555', overflow: true });
        totalW += w + gap;
    }
    totalW -= gap;

    // If too wide, drop badges from the end until it fits
    while (items.length > 0 && totalW > maxW) {
        const removed = items.pop();
        totalW -= removed.w + gap;
    }

    let cx = x + maxW - totalW;
    for (const it of items) {
        ctx.fillStyle = it.color;
        cgRoundRectPath(ctx, cx, y, it.w, h, 8);
        ctx.fill();
        ctx.fillStyle = cgContrastColor(it.color);
        ctx.fillText(it.text, cx + 5, y + h / 2 + 0.5);
        cx += it.w + gap;
    }
    ctx.restore();
}

function cgContrastColor(bg) {
    // Parse color — handle #rrggbb, rgb(), rgba()
    let r = 128, g = 128, b = 128;
    if (typeof bg === 'string') {
        if (bg.startsWith('#') && bg.length >= 7) {
            r = parseInt(bg.slice(1, 3), 16);
            g = parseInt(bg.slice(3, 5), 16);
            b = parseInt(bg.slice(5, 7), 16);
        } else {
            const m = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
            if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
        }
    }
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    return luma > 140 ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.95)';
}

// ── Thumbnail URL resolution ───────────────────────────────────────────
// Uses the renderer's existing thumbnail pipeline (requestImageThumbnailUrl)
// which returns a blob: URL to a pre-generated 512px PNG. For videos, uses
// the video poster (requested async; cached once received).

const cgThumbUrlCache = new Map(); // item.path -> blob URL (or null if pending)
const cgThumbRequested = new Set();

function cgResolveThumbUrl(item /*, targetSize */) {
    if (!item || !item.path) return null;
    if (cgThumbUrlCache.has(item.path)) return cgThumbUrlCache.get(item.path);
    if (cgThumbRequested.has(item.path)) return null; // already pending

    // For static images: use requestImageThumbnailUrl to get a pre-decoded blob URL
    if (item.type === 'image' && host.requestImageThumbnailUrl) {
        cgThumbRequested.add(item.path);
        const p = host.requestImageThumbnailUrl(item.path, 512);
        if (p && p.then) {
            p.then((blobUrl) => {
                const finalUrl = blobUrl || item.url || null;
                cgThumbUrlCache.set(item.path, finalUrl);
                cgScheduleRender();
            }).catch(() => {
                // Fall back to original URL for non-standard formats
                cgThumbUrlCache.set(item.path, item.url || null);
                cgScheduleRender();
            });
        } else {
            cgThumbUrlCache.set(item.path, item.url || null);
        }
        return null; // while pending
    }

    // Videos: can't decode video file via createImageBitmap. Skip thumbnail
    // rendering and show placeholder; the hover overlay will play the video.
    if (item.type === 'video') {
        cgThumbUrlCache.set(item.path, null);
        return null;
    }

    // Unknown type: fall back to item.url (best effort)
    const url = item.url || null;
    cgThumbUrlCache.set(item.path, url);
    return url;
}

function cgClearThumbUrlCache() {
    cgThumbUrlCache.clear();
    cgThumbRequested.clear();
}

// ── Hit testing ────────────────────────────────────────────────────────

function cgHitTest(clientX, clientY) {
    if (!host) return { itemIndex: -1, zone: 'none' };
    const items = host.items;
    const positions = host.positions;
    if (!items || !positions || items.length === 0) return { itemIndex: -1, zone: 'none' };

    const rect = gridContainer.getBoundingClientRect();
    const contentX = clientX - rect.left;
    const contentY = clientY - rect.top + gridContainer.scrollTop;
    const n = items.length;

    // Binary search for first item whose bottom edge >= contentY
    let lo = 0, hi = n - 1;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const idx = mid * 4;
        if (positions[idx + 1] + positions[idx + 3] < contentY) lo = mid + 1;
        else hi = mid;
    }

    // Linear scan forward through items that could contain (contentX, contentY).
    // For masonry we may need to scan ahead a bit since items in the same Y band
    // aren't guaranteed to be adjacent by index.
    for (let i = lo; i < n; i++) {
        const idx = i * 4;
        const cx = positions[idx];
        const cy = positions[idx + 1];
        const cw = positions[idx + 2];
        const ch = positions[idx + 3];
        // Bail only when we're well past the hit point vertically
        if (cy > contentY + 200) break;
        if (contentX >= cx && contentX <= cx + cw && contentY >= cy && contentY <= cy + ch) {
            return cgClassifyZone(i, contentX - cx, contentY - cy, cw, ch);
        }
    }
    return { itemIndex: -1, zone: 'none' };
}

function cgClassifyZone(itemIndex, localX, localY, cw, ch) {
    const item = host.items[itemIndex];
    if (!item) return { itemIndex, zone: 'none' };
    if (item.type === 'group-header') {
        if (localX < 32) return { itemIndex, zone: 'group-toggle' };
        return { itemIndex, zone: 'group-header' };
    }
    if (item.type === 'folder') return { itemIndex, zone: 'folder' };

    // Star rating hit-test (top-right). Only clickable when stars are shown.
    const settings = host.cardInfoSettings || {};
    const isHovered = (itemIndex === cgHoveredIndex);
    if (cgShouldShow(settings, 'starRating', isHovered)) {
        const rect = cgComputeStarRect(0, 0, cw, ch);
        if (localY >= rect.y - 2 && localY <= rect.y + rect.starSize + 6) {
            for (let i = 0; i < 5; i++) {
                const sx = rect.x + i * (rect.starSize + CG_STYLE.starSpacing);
                if (localX >= sx - 1 && localX <= sx + rect.starSize + 1) {
                    return { itemIndex, zone: 'star', subIndex: i + 1 };
                }
            }
        }
    }

    return { itemIndex, zone: 'card' };
}

// ── Virtual card descriptor (for existing event handlers) ─────────────

function cgResolveCardDescriptor(itemIndex, zone) {
    if (!host) return null;
    const item = host.items[itemIndex];
    if (!item) return null;
    const isFolder = item.type === 'folder';
    const vcard = {
        _vsItemIndex: itemIndex,
        _canvasZone: zone,
        _isVirtual: true,
        dataset: {
            path: item.path,
            folderPath: isFolder ? item.path : undefined,
            name: item.name,
            mediaType: item.type,
            src: item.url,
            width: item.width ? String(item.width) : undefined,
            height: item.height ? String(item.height) : undefined,
            mtime: item.mtime ? String(item.mtime) : undefined,
            fileSize: item.size ? String(item.size) : undefined
        },
        classList: {
            contains: (c) => {
                if (c === 'video-card') return !isFolder && item.type !== 'group-header';
                if (c === 'folder-card') return isFolder;
                if (c === 'date-group-header') return item.type === 'group-header';
                if (c === 'selected') return !!(item.path && host.selection && host.selection.has(item.path));
                return false;
            },
            add: () => { /* no-op: state lives in selection set */ },
            remove: () => { /* no-op */ },
            toggle: () => { /* no-op */ }
        },
        closest: (sel) => {
            // Behave like element.closest — if the selector matches this card, return self
            if (sel === '.video-card' && !isFolder && item.type !== 'group-header') return vcard;
            if (sel === '.folder-card' && isFolder) return vcard;
            if (sel === '.date-group-header' && item.type === 'group-header') return vcard;
            return null;
        },
        querySelector: () => null,
        getBoundingClientRect: () => {
            const idx = itemIndex * 4;
            const positions = host.positions;
            const rect = gridContainer.getBoundingClientRect();
            return {
                left: rect.left + positions[idx],
                top: rect.top + positions[idx + 1] - gridContainer.scrollTop,
                width: positions[idx + 2],
                height: positions[idx + 3],
                right: rect.left + positions[idx] + positions[idx + 2],
                bottom: rect.top + positions[idx + 1] - gridContainer.scrollTop + positions[idx + 3]
            };
        }
    };
    return vcard;
}

function cgTargetFromEvent(e) {
    if (!cgEnabled || !host) return null;
    const hit = cgHitTest(e.clientX, e.clientY);
    if (hit.itemIndex < 0) return null;
    return cgResolveCardDescriptor(hit.itemIndex, hit.zone);
}

// ── Keyboard toggle ─────────────────────────────────────────────────────

function cgInstallKeyboardToggle() {
    document.addEventListener('keydown', (e) => {
        if (!cgInitialized) return;
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'G' || e.key === 'g')) {
            e.preventDefault();
            cgSetEnabled(!cgEnabled);
            console.log('[canvas-grid] toggled:', cgEnabled ? 'ON' : 'OFF');
        }
    });
}

// ── Bootstrap ──────────────────────────────────────────────────────────

function cgBootstrap() {
    const container = document.getElementById('grid-container');
    if (!container) return false;
    cgInit(container);
    cgInstallKeyboardToggle();
    // If renderer has already attached its host, pick it up
    if (window.__cgHost) cgAttachHost(window.__cgHost);
    return true;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cgBootstrap);
} else {
    if (!cgBootstrap()) {
        document.addEventListener('DOMContentLoaded', cgBootstrap);
    }
}

// ── Export ─────────────────────────────────────────────────────────────

// Adapter for legacy callers that iterate DOM cards. Returns virtual-card
// descriptors for every item currently in the visible range (approx).
function cgQueryVisibleCards() {
    if (!cgEnabled || !host) return [];
    const items = host.items;
    const visibleRangeFn = host.visibleRange;
    if (!items || !visibleRangeFn) return [];
    const { startIndex, endIndex } = visibleRangeFn(gridContainer.scrollTop, cgViewportH);
    const out = [];
    for (let i = startIndex; i < endIndex; i++) {
        const d = cgResolveCardDescriptor(i, 'card');
        if (d) out.push(d);
    }
    return out;
}

window.CG = {
    init: cgInit,
    attachHost: cgAttachHost,
    setEnabled: cgSetEnabled,
    isEnabled: cgIsEnabled,
    scheduleRender: cgScheduleRender,
    invalidateData: cgInvalidateData,
    invalidateSelection: cgInvalidateSelection,
    invalidateSettings: cgInvalidateSettings,
    invalidateHover: cgInvalidateHover,
    hitTest: cgHitTest,
    targetFromEvent: cgTargetFromEvent,
    queryVisibleCards: cgQueryVisibleCards,
    syncSizerHeight: cgSyncSizerHeight,
    onResize: cgOnResize,
    _getHoveredIndex: () => cgHoveredIndex,
    _getFocusedIndex: () => cgFocusedIndex,
    _getDragOverIndex: () => cgDragOverIndex
};
})();
