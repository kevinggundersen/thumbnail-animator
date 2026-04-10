// ============================================================================
// lightbox.js — Lightbox viewer, zoom, pan, rotation, crop, copy
// Extracted from renderer.js. All functions/variables remain in global scope.
// ============================================================================

// ── Lightbox DOM Elements & State ──
// Lightbox Elements
const lightbox = document.getElementById('lightbox');
const lightboxVideo = document.getElementById('lightbox-video');
const lightboxImage = document.getElementById('lightbox-image');
const lightboxGifCanvas = document.getElementById('lightbox-gif-canvas');
const lightboxPdfEmbed = document.getElementById('lightbox-pdf-embed');
const closeLightboxBtn = document.getElementById('close-lightbox');

// Plugin lightbox renderers — loaded once at startup
let _lightboxRenderers = null;
(async () => {
    try {
        const res = await window.electronAPI.getLightboxRenderers();
        _lightboxRenderers = res?.ok ? (res.value || {}) : {};
    } catch { _lightboxRenderers = {}; }
})();
const lightboxZoomControls = document.getElementById('lightbox-zoom-controls');
const lightboxZoomFloatingMount = document.getElementById('lightbox-zoom-floating-mount');
const lightboxZoomDockMount = document.getElementById('lb-insp-view-mount');
const lightboxZoomDockSection = document.getElementById('lb-insp-view-sec');
const lightboxInspector = document.getElementById('lb-inspector');
const lightboxZoomSlider = document.getElementById('lightbox-zoom-slider');
const lightboxZoomValue = document.getElementById('lightbox-zoom-value');
const lightboxRotateLeftBtn = document.getElementById('lightbox-rotate-left-btn');
const lightboxRotateRightBtn = document.getElementById('lightbox-rotate-right-btn');
const lightboxFlipHBtn = document.getElementById('lightbox-flip-h-btn');
const lightboxFlipVBtn = document.getElementById('lightbox-flip-v-btn');
const lightboxCropBtn = document.getElementById('lightbox-crop-btn');
const lbTransformBar = document.getElementById('lb-transform-bar');
const lbTfRotateLeftBtn = document.getElementById('lb-tf-rotate-left');
const lbTfRotateRightBtn = document.getElementById('lb-tf-rotate-right');
const lbTfFlipHBtn = document.getElementById('lb-tf-flip-h');
const lbTfFlipVBtn = document.getElementById('lb-tf-flip-v');
const lightboxCropOverlay = document.getElementById('lightbox-crop-overlay');
const lightboxCropBox = document.getElementById('lightbox-crop-box');
const lightboxCropSize = document.getElementById('lightbox-crop-size');
const lightboxCropStatus = document.getElementById('lightbox-crop-status');
const lightboxCropApplyBtn = document.getElementById('lightbox-crop-apply');
const lightboxCropCancelBtn = document.getElementById('lightbox-crop-cancel');

// Lightbox zoom state
let currentZoomLevel = 100;
let cachedZoomValue = 1.0; // Cache zoom value to avoid recalculation during panning
let cachedImgRemainingScale = null; // When non-null, <img> uses this scale instead of cachedZoomValue (hi-res zoom)
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let currentTranslateX = 0;
let currentTranslateY = 0;
let currentLightboxRotation = 0;
let currentLightboxFlipH = false;
let currentLightboxFlipV = false;

let lightboxCropMeta = { enabled: false, outputExt: '.png' };
const LIGHTBOX_CROP_MIN_DISPLAY_SIZE = 12;
const lightboxCropState = {
    active: false,
    pointerId: null,
    mode: null,
    handle: null,
    imageRect: null,
    rect: null,
    sourceRect: null,
    startPoint: null,
    startRect: null,
    saving: false,
};
const lightboxCropPanState = {
    active: false,
    pointerId: null,
    initMouseX: 0,
    initMouseY: 0,
    initTranslateX: 0,
    initTranslateY: 0,
};

function syncLightboxZoomControlsPlacement() {
    if (!lightboxZoomControls || !lightboxZoomFloatingMount || !lightboxZoomDockMount) return;

    const shouldDock = !lightbox.classList.contains('hidden')
        && !!lightboxInspector
        && !lightboxInspector.hidden
        && !inspectorCollapsed;
    const targetMount = shouldDock ? lightboxZoomDockMount : lightboxZoomFloatingMount;

    if (lightboxZoomControls.parentElement !== targetMount) {
        targetMount.appendChild(lightboxZoomControls);
    }

    lightboxZoomControls.dataset.placement = shouldDock ? 'docked' : 'floating';
    if (lightboxZoomDockSection) lightboxZoomDockSection.hidden = !shouldDock;
}

// ── Lightbox Zoom Calculation ──
function getLightboxInspectorWidth() {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lb-inspector-width')) || 0;
}

function calculateFitZoomLevel(naturalWidth, naturalHeight) {
    const vpFrac = (lightboxViewportSetting || 90) / 100;
    // Subtract inspector panel width from available space (matches CSS min() constraint)
    const inspectorW = getLightboxInspectorWidth();
    const availableW = Math.min(window.innerWidth * vpFrac, window.innerWidth - inspectorW - 80);
    const availableH = window.innerHeight * vpFrac;
    const scaleX = availableW / naturalWidth;
    const scaleY = availableH / naturalHeight;
    const fitScale = Math.min(scaleX, scaleY);

    if (fitScale <= 1) return 100; // Already fits or larger

    // Inverse of exponential zoom curve: fitScale = 1.06^((zoomLevel - 100) / 5)
    const zoomLevel = 100 + 5 * Math.log(fitScale) / Math.log(1.06);
    // Snap to nearest step of 5, cap at slider max
    return Math.min(Math.round(zoomLevel / 5) * 5, lightboxMaxZoomSetting);
}

/**
 * Compute optimal layout dimensions for zoomed <img> elements.
 * Instead of locking the element to its fitted size and using scale() to magnify
 * (which causes blurry upscaling), we increase the layout size up to the image's
 * natural dimensions so the browser rasterizes at higher fidelity.
 */
function computeZoomLayoutDimensions(baseW, baseH, natW, natH, zoomValue) {
    const desiredW = baseW * zoomValue;
    const desiredH = baseH * zoomValue;
    // Cap layout at natural dimensions and 4x viewport to limit VRAM
    const maxW = Math.min(natW, window.innerWidth * 4);
    const maxH = Math.min(natH, window.innerHeight * 4);
    // Uniform scale cap to preserve aspect ratio
    const cap = Math.min(1, maxW / desiredW, maxH / desiredH);
    return {
        layoutWidth: desiredW * cap,
        layoutHeight: desiredH * cap,
        remainingScale: 1 / cap
    };
}

function normalizeLightboxRotation(degrees) {
    const normalized = degrees % 360;
    return normalized < 0 ? normalized + 360 : normalized;
}

function getRotatedMediaDimensions(width, height, rotation = currentLightboxRotation) {
    const normalized = normalizeLightboxRotation(rotation);
    if (normalized === 90 || normalized === 270) {
        return { width: height, height: width };
    }
    return { width, height };
}

function getLightboxRotationString() {
    return `rotate(${normalizeLightboxRotation(currentLightboxRotation)}deg)`;
}

function getLightboxFlipString() {
    const sx = currentLightboxFlipH ? -1 : 1;
    const sy = currentLightboxFlipV ? -1 : 1;
    if (sx === 1 && sy === 1) return '';
    return `scale(${sx}, ${sy})`;
}

function getVisibleLightboxMediaElement() {
    const imageDisplay = lightboxImage.style.display;
    const videoDisplay = lightboxVideo.style.display;
    const canvasDisplay = lightboxGifCanvas.style.display;
    const isImageVisible = imageDisplay === 'block' ||
                          (imageDisplay === '' && window.getComputedStyle(lightboxImage).display !== 'none');
    const isVideoVisible = videoDisplay === 'block' ||
                          (videoDisplay === '' && window.getComputedStyle(lightboxVideo).display !== 'none');
    const isCanvasVisible = canvasDisplay === 'block' ||
                          (canvasDisplay === '' && window.getComputedStyle(lightboxGifCanvas).display !== 'none');
    if (isCanvasVisible) return lightboxGifCanvas;
    if (isImageVisible) return lightboxImage;
    if (isVideoVisible) return lightboxVideo;
    return null;
}

function getVisibleLightboxMediaInfo() {
    const el = getVisibleLightboxMediaElement();
    if (!el) return null;
    if (el === lightboxImage) {
        return { element: el, width: lightboxImage.naturalWidth || 0, height: lightboxImage.naturalHeight || 0 };
    }
    if (el === lightboxGifCanvas) {
        return { element: el, width: lightboxGifCanvas.width || activePlaybackController?.gifWidth || 0, height: lightboxGifCanvas.height || activePlaybackController?.gifHeight || 0 };
    }
    return { element: el, width: lightboxVideo.videoWidth || 0, height: lightboxVideo.videoHeight || 0 };
}

function getDisplayedUnrotatedMediaRect(element) {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const rotated = getRotatedMediaDimensions(rect.width, rect.height);
    return { width: rotated.width, height: rotated.height };
}

function refreshLightboxRotationControls() {
    const shouldShow = !lightbox.classList.contains('hidden') && !lightboxCropState.active;
    if (lightboxRotateLeftBtn) {
        lightboxRotateLeftBtn.classList.toggle('hidden', !shouldShow);
        lightboxRotateLeftBtn.disabled = !shouldShow;
    }
    if (lightboxRotateRightBtn) {
        lightboxRotateRightBtn.classList.toggle('hidden', !shouldShow);
        lightboxRotateRightBtn.disabled = !shouldShow;
    }
    if (lightboxFlipHBtn) {
        lightboxFlipHBtn.classList.toggle('hidden', !shouldShow);
        lightboxFlipHBtn.disabled = !shouldShow;
    }
    if (lightboxFlipVBtn) {
        lightboxFlipVBtn.classList.toggle('hidden', !shouldShow);
        lightboxFlipVBtn.disabled = !shouldShow;
    }
    // Show/hide the bottom transform bar
    if (lbTransformBar) {
        lbTransformBar.classList.toggle('hidden', !shouldShow);
        // Position above media controls if they are visible
        const mcVisible = document.getElementById('media-controls')?.style.display === 'flex';
        lbTransformBar.classList.toggle('above-mc', mcVisible);
    }
    // Sync active state on bottom bar buttons
    lbTfFlipHBtn?.classList.toggle('active', currentLightboxFlipH);
    lbTfFlipVBtn?.classList.toggle('active', currentLightboxFlipV);
}

function applyLightboxRotation(step) {
    currentLightboxRotation = normalizeLightboxRotation(currentLightboxRotation + step);
    if (zoomToFit) {
        applyZoomToFitNow();
    } else {
        applyCurrentLightboxTransform();
    }
    refreshLightboxRotationControls();
}

function toggleLightboxFlip(axis) {
    if (axis === 'horizontal') currentLightboxFlipH = !currentLightboxFlipH;
    else if (axis === 'vertical') currentLightboxFlipV = !currentLightboxFlipV;
    if (zoomToFit) {
        applyZoomToFitNow();
    } else {
        applyCurrentLightboxTransform();
    }
}

function resetLightboxFlip() {
    currentLightboxFlipH = false;
    currentLightboxFlipV = false;
    lightboxFlipHBtn?.classList.remove('active');
    lightboxFlipVBtn?.classList.remove('active');
    lbTfFlipHBtn?.classList.remove('active');
    lbTfFlipVBtn?.classList.remove('active');
}

/** Helper: display a static (non-animated) image in the lightbox */
function _showStaticImage(mediaUrl, lightboxImage, lightboxGifCanvas, lightbox, mediaControlBarInstance) {
    lightboxGifCanvas.style.display = 'none';
    lightboxImage.style.display = 'block';

    lightbox.classList.remove('hidden');
    lightboxImage.style.transform = getLightboxRotationString();
    // Clear inline overrides — let CSS var(--lightbox-max-w) handle constraints
    lightboxImage.style.maxWidth = '';
    lightboxImage.style.maxHeight = '';
    lightboxImage.style.width = 'auto';
    lightboxImage.style.height = 'auto';

    const handleImageLoad = () => {
        requestAnimationFrame(() => {
            // Guard: if src changed since this rAF was scheduled, bail out —
            // another handleImageLoad will fire for the correct image.
            if (lightboxImage.src !== mediaUrl && lightboxImage.dataset.src !== mediaUrl) return;
            const baseRect = getDisplayedUnrotatedMediaRect(lightboxImage);
            if (baseRect) {
                lightboxImage.dataset.baseWidth = baseRect.width.toString();
                lightboxImage.dataset.baseHeight = baseRect.height.toString();
            }
            const dims = getRotatedMediaDimensions(lightboxImage.naturalWidth, lightboxImage.naturalHeight);
            const fitLevel = calculateFitZoomLevel(dims.width, dims.height);
            if (zoomToFit && fitLevel > 100) {
                applyLightboxZoom(fitLevel);
            } else {
                applyCurrentLightboxTransform();
            }
        });
        lightboxImage.removeEventListener('load', handleImageLoad);
    };

    // Set src BEFORE the complete check — otherwise `complete` reflects the
    // OLD image and handleImageLoad would run with stale naturalWidth/rect,
    // producing a wrong zoom level for the new image.
    lightboxImage.src = mediaUrl;
    lightboxImage.dataset.src = mediaUrl;

    if (lightboxImage.complete && lightboxImage.naturalWidth > 0) {
        handleImageLoad();
    } else {
        lightboxImage.addEventListener('load', handleImageLoad);
    }

    // Static image: hide controls
    if (mediaControlBarInstance) mediaControlBarInstance.hide();
}

function getLightboxCropOutputMeta(filePath) {
    const ext = (filePath.match(/\.[^.]+$/)?.[0] || '').toLowerCase();
    switch (ext) {
        case '.jpg':
            return { enabled: true, outputExt: '.jpg', filters: [{ name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }] };
        case '.jpeg':
            return { enabled: true, outputExt: '.jpeg', filters: [{ name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }] };
        case '.png':
            return { enabled: true, outputExt: '.png', filters: [{ name: 'PNG Image', extensions: ['png'] }] };
        case '.webp':
            return { enabled: true, outputExt: '.webp', filters: [{ name: 'WebP Image', extensions: ['webp'] }] };
        case '.bmp':
            return { enabled: true, outputExt: '.png', filters: [{ name: 'PNG Image', extensions: ['png'] }] };
        default:
            return { enabled: false, outputExt: '.png', filters: [{ name: 'PNG Image', extensions: ['png'] }] };
    }
}

function setLightboxCropAvailability(filePath, enabled) {
    const meta = filePath ? getLightboxCropOutputMeta(filePath) : { enabled: false, outputExt: '.png', filters: [{ name: 'PNG Image', extensions: ['png'] }] };
    lightboxCropMeta = (enabled && meta.enabled) ? meta : { enabled: false, outputExt: meta.outputExt || '.png', filters: meta.filters || [{ name: 'PNG Image', extensions: ['png'] }] };
    if (!lightboxCropMeta.enabled && lightboxCropState.active) {
        exitLightboxCropMode({ silent: true });
    }
    refreshLightboxCropButton();
}

function refreshLightboxCropButton() {
    if (!lightboxCropBtn) return;
    const shouldShow = lightboxCropMeta.enabled && !lightboxCropState.active && !lightbox.classList.contains('hidden');
    lightboxCropBtn.classList.toggle('hidden', !shouldShow);
    lightboxCropBtn.disabled = !shouldShow;
}

function setLightboxCropStatus(text) {
    if (lightboxCropStatus) lightboxCropStatus.textContent = text;
}

function clearLightboxCropSelection(statusText = 'Drag on the image to start a crop.') {
    lightboxCropState.rect = null;
    lightboxCropState.sourceRect = null;
    if (lightboxCropBox) lightboxCropBox.classList.add('hidden');
    if (lightboxCropApplyBtn) lightboxCropApplyBtn.disabled = true;
    setLightboxCropStatus(statusText);
}

function pointInRect(point, rect) {
    return !!(point && rect &&
        point.x >= rect.left && point.x <= rect.left + rect.width &&
        point.y >= rect.top && point.y <= rect.top + rect.height);
}

function clampPointToRect(point, rect) {
    return {
        x: Math.min(rect.left + rect.width, Math.max(rect.left, point.x)),
        y: Math.min(rect.top + rect.height, Math.max(rect.top, point.y)),
    };
}

function getDisplayedLightboxImageRect() {
    if (!lightboxImage || lightboxImage.style.display === 'none' || !lightboxImage.naturalWidth || !lightboxImage.naturalHeight) {
        return null;
    }
    const rect = lightboxImage.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function normalizeCropRectFromPoints(startPoint, endPoint, imageRect) {
    const start = clampPointToRect(startPoint, imageRect);
    const end = clampPointToRect(endPoint, imageRect);
    const left = Math.max(imageRect.left, Math.min(start.x, end.x));
    const top = Math.max(imageRect.top, Math.min(start.y, end.y));
    const right = Math.min(imageRect.left + imageRect.width, Math.max(start.x, end.x));
    const bottom = Math.min(imageRect.top + imageRect.height, Math.max(start.y, end.y));
    return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function clampCropRectToImage(rect, imageRect) {
    const width = Math.min(rect.width, imageRect.width);
    const height = Math.min(rect.height, imageRect.height);
    const left = Math.min(imageRect.left + imageRect.width - width, Math.max(imageRect.left, rect.left));
    const top = Math.min(imageRect.top + imageRect.height - height, Math.max(imageRect.top, rect.top));
    return { left, top, width, height };
}

function resizeCropRect(startRect, handle, point, imageRect) {
    const minSize = LIGHTBOX_CROP_MIN_DISPLAY_SIZE;
    const clamped = clampPointToRect(point, imageRect);
    let left = startRect.left;
    let top = startRect.top;
    let right = startRect.left + startRect.width;
    let bottom = startRect.top + startRect.height;

    if (handle.includes('n')) top = Math.max(imageRect.top, Math.min(clamped.y, bottom - minSize));
    if (handle.includes('s')) bottom = Math.min(imageRect.top + imageRect.height, Math.max(clamped.y, top + minSize));
    if (handle.includes('w')) left = Math.max(imageRect.left, Math.min(clamped.x, right - minSize));
    if (handle.includes('e')) right = Math.min(imageRect.left + imageRect.width, Math.max(clamped.x, left + minSize));

    return { left, top, width: right - left, height: bottom - top };
}

function screenRectToSourceRect(rect, imageRect) {
    if (!rect || !imageRect || !lightboxImage?.naturalWidth || !lightboxImage?.naturalHeight) return null;
    const naturalWidth = lightboxImage.naturalWidth;
    const naturalHeight = lightboxImage.naturalHeight;
    const scaleX = naturalWidth / imageRect.width;
    const scaleY = naturalHeight / imageRect.height;

    const left = Math.max(0, Math.min(naturalWidth - 1, Math.round((rect.left - imageRect.left) * scaleX)));
    const top = Math.max(0, Math.min(naturalHeight - 1, Math.round((rect.top - imageRect.top) * scaleY)));
    const right = Math.max(left + 1, Math.min(naturalWidth, Math.round((rect.left + rect.width - imageRect.left) * scaleX)));
    const bottom = Math.max(top + 1, Math.min(naturalHeight, Math.round((rect.top + rect.height - imageRect.top) * scaleY)));
    return { left, top, width: right - left, height: bottom - top };
}

function preserveCropRectOnViewportChange(rect, imageRect) {
    if (!rect || !imageRect) return null;
    return clampCropRectToImage({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
    }, imageRect);
}

function renderLightboxCropSelection() {
    if (!lightboxCropState.active || !lightboxCropBox) return;

    const rect = lightboxCropState.rect;
    if (!rect || rect.width < LIGHTBOX_CROP_MIN_DISPLAY_SIZE || rect.height < LIGHTBOX_CROP_MIN_DISPLAY_SIZE) {
        clearLightboxCropSelection('Drag on the image to start a crop.');
        return;
    }

    lightboxCropState.sourceRect = screenRectToSourceRect(rect, lightboxCropState.imageRect);
    const sourceRect = lightboxCropState.sourceRect;
    const validSource = !!(sourceRect && sourceRect.width >= 8 && sourceRect.height >= 8);

    lightboxCropBox.classList.remove('hidden');
    lightboxCropBox.style.left = `${rect.left}px`;
    lightboxCropBox.style.top = `${rect.top}px`;
    lightboxCropBox.style.width = `${rect.width}px`;
    lightboxCropBox.style.height = `${rect.height}px`;
    if (lightboxCropSize && sourceRect) {
        lightboxCropSize.textContent = `${sourceRect.width} x ${sourceRect.height}px`;
    }
    if (lightboxCropApplyBtn) lightboxCropApplyBtn.disabled = !validSource || lightboxCropState.saving;
    setLightboxCropStatus(validSource ? 'Adjust the crop box, then apply.' : 'Crop area is too small.');
}

function syncLightboxCropToViewport() {
    if (!lightboxCropState.active) return;
    const imageRect = getDisplayedLightboxImageRect();
    if (!imageRect) {
        exitLightboxCropMode({ silent: true });
        return;
    }
    lightboxCropState.imageRect = imageRect;
    if (lightboxCropState.rect) {
        lightboxCropState.rect = preserveCropRectOnViewportChange(lightboxCropState.rect, imageRect);
    }
    if (lightboxCropState.rect) {
        renderLightboxCropSelection();
    } else {
        clearLightboxCropSelection();
    }
}

function enterLightboxCropMode() {
    if (lightboxCropState.active || !lightboxCropMeta.enabled) return;
    if (!window.currentLightboxFilePath || !lightboxImage || lightboxImage.style.display === 'none' || !lightboxImage.naturalWidth) {
        showToast('Open a still image in the lightbox first', 'info');
        return;
    }
    if (currentLightboxRotation !== 0 || currentLightboxFlipH || currentLightboxFlipV) {
        currentLightboxRotation = 0;
        resetLightboxFlip();
        showToast('Crop mode resets rotation and flip for now', 'info', { duration: 2200 });
    }

    hideContextMenu();
    resetZoom();
    const imageRect = getDisplayedLightboxImageRect();
    if (!imageRect) {
        showToast('Image is not ready to crop yet', 'info');
        return;
    }

    lightboxCropState.active = true;
    lightboxCropState.pointerId = null;
    lightboxCropState.mode = null;
    lightboxCropState.handle = null;
    lightboxCropState.imageRect = imageRect;
    lightboxCropState.saving = false;
    lightbox.classList.add('crop-mode');
    if (lightboxCropOverlay) lightboxCropOverlay.classList.remove('hidden');
    clearLightboxCropSelection();
    refreshLightboxCropButton();
    refreshLightboxRotationControls();
}

function exitLightboxCropMode({ silent = false } = {}) {
    if (!lightboxCropState.active && !lightboxCropState.saving) return;
    lightboxCropPanState.active = false;
    lightboxCropPanState.pointerId = null;
    if (lightboxCropOverlay) lightboxCropOverlay.classList.remove('panning');
    if (lightboxCropOverlay && lightboxCropState.pointerId != null && lightboxCropOverlay.hasPointerCapture(lightboxCropState.pointerId)) {
        try { lightboxCropOverlay.releasePointerCapture(lightboxCropState.pointerId); } catch {}
    }
    lightboxCropState.active = false;
    lightboxCropState.pointerId = null;
    lightboxCropState.mode = null;
    lightboxCropState.handle = null;
    lightboxCropState.startPoint = null;
    lightboxCropState.startRect = null;
    lightboxCropState.imageRect = null;
    lightboxCropState.saving = false;
    lightbox.classList.remove('crop-mode');
    if (lightboxCropOverlay) lightboxCropOverlay.classList.add('hidden');
    clearLightboxCropSelection();
    if (lightboxCropCancelBtn) lightboxCropCancelBtn.disabled = false;
    refreshLightboxCropButton();
    refreshLightboxRotationControls();
    if (!silent) setLightboxCropStatus('Drag on the image to start a crop.');
}

async function applyLightboxCrop() {
    if (!lightboxCropState.active || lightboxCropState.saving) return;
    const sourceRect = lightboxCropState.sourceRect;
    const srcPath = window.currentLightboxFilePath;
    if (!sourceRect || !srcPath) return;

    const { dir, stem, sep } = _ffGetPathParts(srcPath);
    const outputExt = lightboxCropMeta.outputExt || '.png';
    const defaultPath = _ffJoin(dir, `${stem}_crop${outputExt}`, sep);

    lightboxCropState.saving = true;
    if (lightboxCropApplyBtn) lightboxCropApplyBtn.disabled = true;
    if (lightboxCropCancelBtn) lightboxCropCancelBtn.disabled = true;
    setLightboxCropStatus('Choose where to save the cropped image...');

    try {
        const saveRes = await window.electronAPI.showSaveDialog({
            defaultPath,
            filters: lightboxCropMeta.filters,
        });
        if (!saveRes || !saveRes.ok || !saveRes.value || saveRes.value.canceled) {
            exitLightboxCropMode({ silent: true });
            return;
        }

        const cropRes = await window.electronAPI.cropImage({
            inputPath: srcPath,
            outputPath: saveRes.value.filePath,
            crop: sourceRect,
        });

        if (!cropRes || !cropRes.ok || !cropRes.value?.filePath) {
            lightboxCropState.saving = false;
            if (lightboxCropCancelBtn) lightboxCropCancelBtn.disabled = false;
            renderLightboxCropSelection();
            showToast(`Crop failed: ${friendlyError(cropRes?.error || 'unknown error')}`, 'error');
            return;
        }

        const savedPath = cropRes.value.filePath;
        exitLightboxCropMode({ silent: true });
        const outName = savedPath.split(/[\\/]/).pop();
        showToast(`Saved ${outName}`, 'success', {
            actionLabel: 'Reveal',
            actionCallback: () => window.electronAPI.revealInExplorer(savedPath),
        });

        const outputDir = savedPath.slice(0, Math.max(savedPath.lastIndexOf('\\'), savedPath.lastIndexOf('/')));
        const normalizePath = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        if (currentFolderPath && normalizePath(currentFolderPath) === normalizePath(outputDir)) {
            const previousScrollTop = gridContainer.scrollTop;
            invalidateFolderCache(currentFolderPath);
            await loadVideos(currentFolderPath, false, previousScrollTop);
        }
    } catch (error) {
        lightboxCropState.saving = false;
        if (lightboxCropCancelBtn) lightboxCropCancelBtn.disabled = false;
        renderLightboxCropSelection();
        showToast(`Crop failed: ${friendlyError(error)}`, 'error');
    }
}

function handleLightboxCropPointerDown(e) {
    if (!lightboxCropState.active || lightboxCropState.saving) return;

    if (e.button === 1) {
        if (currentZoomLevel <= 100) return;
        lightboxCropPanState.active = true;
        lightboxCropPanState.pointerId = e.pointerId;
        lightboxCropPanState.initMouseX = e.clientX;
        lightboxCropPanState.initMouseY = e.clientY;
        lightboxCropPanState.initTranslateX = currentTranslateX;
        lightboxCropPanState.initTranslateY = currentTranslateY;
        if (lightboxCropOverlay) {
            lightboxCropOverlay.classList.add('panning');
            lightboxCropOverlay.setPointerCapture(e.pointerId);
        }
        e.preventDefault();
        e.stopPropagation();
        return;
    }

    if (e.button !== 0) return;

    const imageRect = getDisplayedLightboxImageRect();
    if (!imageRect) return;
    lightboxCropState.imageRect = imageRect;

    const point = { x: e.clientX, y: e.clientY };
    const handle = e.target.closest('.lightbox-crop-handle')?.dataset.handle || null;
    if (handle && lightboxCropState.rect) {
        lightboxCropState.mode = 'resize';
        lightboxCropState.handle = handle;
        lightboxCropState.startRect = { ...lightboxCropState.rect };
        lightboxCropState.startPoint = point;
    } else if (lightboxCropState.rect && pointInRect(point, lightboxCropState.rect)) {
        lightboxCropState.mode = 'move';
        lightboxCropState.handle = null;
        lightboxCropState.startRect = { ...lightboxCropState.rect };
        lightboxCropState.startPoint = point;
    } else if (pointInRect(point, imageRect)) {
        const clamped = clampPointToRect(point, imageRect);
        lightboxCropState.mode = 'create';
        lightboxCropState.handle = null;
        lightboxCropState.startPoint = clamped;
        lightboxCropState.startRect = null;
        lightboxCropState.rect = { left: clamped.x, top: clamped.y, width: 0, height: 0 };
        renderLightboxCropSelection();
    } else {
        return;
    }

    lightboxCropState.pointerId = e.pointerId;
    if (lightboxCropOverlay) lightboxCropOverlay.setPointerCapture(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
}

function handleLightboxCropPointerMove(e) {
    if (lightboxCropPanState.active && lightboxCropPanState.pointerId === e.pointerId) {
        currentTranslateX = lightboxCropPanState.initTranslateX + (e.clientX - lightboxCropPanState.initMouseX);
        currentTranslateY = lightboxCropPanState.initTranslateY + (e.clientY - lightboxCropPanState.initMouseY);
        applyCurrentLightboxTransform();
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    if (!lightboxCropState.active || lightboxCropState.pointerId !== e.pointerId || !lightboxCropState.mode) return;
    const imageRect = lightboxCropState.imageRect || getDisplayedLightboxImageRect();
    if (!imageRect) return;
    const point = { x: e.clientX, y: e.clientY };

    if (lightboxCropState.mode === 'create') {
        lightboxCropState.rect = normalizeCropRectFromPoints(lightboxCropState.startPoint, point, imageRect);
    } else if (lightboxCropState.mode === 'move' && lightboxCropState.startRect && lightboxCropState.startPoint) {
        const deltaX = point.x - lightboxCropState.startPoint.x;
        const deltaY = point.y - lightboxCropState.startPoint.y;
        lightboxCropState.rect = clampCropRectToImage({
            left: lightboxCropState.startRect.left + deltaX,
            top: lightboxCropState.startRect.top + deltaY,
            width: lightboxCropState.startRect.width,
            height: lightboxCropState.startRect.height,
        }, imageRect);
    } else if (lightboxCropState.mode === 'resize' && lightboxCropState.startRect && lightboxCropState.handle) {
        lightboxCropState.rect = resizeCropRect(lightboxCropState.startRect, lightboxCropState.handle, point, imageRect);
    }

    renderLightboxCropSelection();
    e.preventDefault();
    e.stopPropagation();
}

function handleLightboxCropPointerEnd(e) {
    if (lightboxCropPanState.pointerId === e.pointerId) {
        if (lightboxCropOverlay && lightboxCropOverlay.hasPointerCapture(e.pointerId)) {
            try { lightboxCropOverlay.releasePointerCapture(e.pointerId); } catch {}
        }
        lightboxCropPanState.active = false;
        lightboxCropPanState.pointerId = null;
        if (lightboxCropOverlay) lightboxCropOverlay.classList.remove('panning');
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    if (lightboxCropState.pointerId !== e.pointerId) return;
    if (lightboxCropOverlay && lightboxCropOverlay.hasPointerCapture(e.pointerId)) {
        try { lightboxCropOverlay.releasePointerCapture(e.pointerId); } catch {}
    }
    lightboxCropState.pointerId = null;
    lightboxCropState.mode = null;
    lightboxCropState.handle = null;
    lightboxCropState.startPoint = null;
    lightboxCropState.startRect = null;
    renderLightboxCropSelection();
    e.preventDefault();
    e.stopPropagation();
}

function openLightbox(mediaUrl, filePath, fileName) {
    const perfStart = perfTest.start();
    const mediaType = getFileType(mediaUrl);
    setLightboxCropAvailability(filePath, false);
    exitLightboxCropMode({ silent: true });
    currentLightboxRotation = 0;
    resetLightboxFlip();

    // Track current index for navigation
    if (lightboxItemsOverride && lightboxItemsOverride.length > 0) {
        lightboxItems = lightboxItemsOverride;
        if (_lightboxNextIndexHint != null && _lightboxNextIndexHint >= 0 && _lightboxNextIndexHint < lightboxItems.length) {
            currentLightboxIndex = _lightboxNextIndexHint;
        } else {
            // Case-insensitive path comparison (Windows paths may differ in case)
            const targetNorm = String(filePath).toLowerCase().replace(/\\/g, '/');
            currentLightboxIndex = lightboxItems.findIndex(item => String(item.path).toLowerCase().replace(/\\/g, '/') === targetNorm);
        }
        if (currentLightboxIndex === -1) {
            // Target not in override — exit similar-nav mode
            lightboxItemsOverride = null;
            lightboxItems = getFilteredMediaItems();
            currentLightboxIndex = lightboxItems.findIndex(item => item.path === filePath);
            if (currentLightboxIndex === -1) currentLightboxIndex = 0;
        }
    } else {
        lightboxItems = getFilteredMediaItems();
        currentLightboxIndex = lightboxItems.findIndex(item => item.path === filePath);
        if (currentLightboxIndex === -1) currentLightboxIndex = 0;
    }
    _lightboxNextIndexHint = null; // consume hint

    // Push onto lightbox viewing history (unless we're walking the history right now)
    _lbHistoryPush({ url: mediaUrl, path: filePath, name: fileName });

    // Store current file info globally for info button
    window.currentLightboxFilePath = filePath;
    window.currentLightboxFileUrl = mediaUrl;
    
    // Add to recent files
    addRecentFile(filePath, fileName, mediaUrl, mediaType);
    
    // Store file info for inspector action buttons
    const copyPathBtn = document.getElementById('copy-path-btn');
    const copyNameBtn = document.getElementById('copy-name-btn');

    // Store file path and name in button data attributes for copying
    if (copyPathBtn && filePath) {
        copyPathBtn.dataset.filePath = filePath;
    }
    if (copyNameBtn && fileName) {
        copyNameBtn.dataset.fileName = fileName;
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
        // Hide video — pause and clear src so audio from the previous clip
        // stops even though the element is just being hidden.
        lightboxVideo.pause();
        lightboxVideo.removeAttribute('src');
        lightboxVideo.load();
        lightboxVideo.style.display = 'none';
        if (lightboxPdfEmbed) { lightboxPdfEmbed.style.display = 'none'; lightboxPdfEmbed.removeAttribute('src'); }
        stopLightboxGifProgress();

        if ((isGif || isWebp) && playbackControlsEnabled) {
            // Show <img> immediately as a preview while we fetch + decode frames
            lightboxGifCanvas.style.display = 'none';
            lightboxImage.style.display = 'block';
            lightboxImage.style.transform = getLightboxRotationString();
            lightboxImage.style.maxWidth = '';
            lightboxImage.style.maxHeight = '';
            lightboxImage.style.width = 'auto';
            lightboxImage.style.height = 'auto';
            lightboxImage.dataset.src = mediaUrl;
            lightbox.classList.remove('hidden');
            // Open inspector with null controller — will be rebound when controller is ready
            try { _enhancedLightboxOnOpen(filePath, null, mediaUrl); } catch (e) { console.warn('enhanced lightbox open failed:', e); }
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
                        setLightboxCropAvailability(filePath, true);
                        try { _enhancedLightboxOnOpen(filePath, null, mediaUrl); } catch (e) { console.warn('enhanced lightbox open failed:', e); }
                        return;
                    }
                }

                // Decode frames into canvas controller
                const controller = new AnimatedImagePlaybackController(lightboxGifCanvas, buffer);
                await controller.ready;

                // Swap from <img> preview to canvas
                lightboxImage.style.display = 'none';
                lightboxGifCanvas.style.display = 'block';
                lightboxGifCanvas.style.transform = getLightboxRotationString();
                lightboxGifCanvas.style.maxWidth = '';
                lightboxGifCanvas.style.maxHeight = '';
                activePlaybackController = controller;

                // Bind control bar
                if (mediaControlBarInstance) {
                    mediaControlBarInstance.bind(controller);
                    mediaControlBarInstance.syncState({ speed: videoPlaybackSpeed, loop: videoLoop, repeat: videoRepeat });
                }

                // Zoom to fit using decoded dimensions
                requestAnimationFrame(() => {
                    const baseRect = getDisplayedUnrotatedMediaRect(lightboxGifCanvas);
                    if (baseRect) {
                        lightboxGifCanvas.dataset.baseWidth = baseRect.width.toString();
                        lightboxGifCanvas.dataset.baseHeight = baseRect.height.toString();
                    }
                    const dims = getRotatedMediaDimensions(controller.gifWidth, controller.gifHeight);
                    const fitLevel = calculateFitZoomLevel(dims.width, dims.height);
                    if (zoomToFit && fitLevel > 100) {
                        applyLightboxZoom(fitLevel);
                    } else {
                        applyCurrentLightboxTransform();
                    }
                });

                // Seek to match where the <img> animation was to avoid a visible restart
                lightboxImage.removeEventListener('load', onImgLoad);
                if (imgAnimStart > 0 && controller.duration > 0) {
                    const elapsed = (performance.now() - imgAnimStart) / 1000;
                    controller.seek(elapsed % controller.duration);
                }
                controller.play();

                // Wire enhanced lightbox (inspector + filmstrip) now that controller is ready
                try { _enhancedLightboxOnOpen(filePath, controller, mediaUrl); } catch (e) { console.warn('enhanced lightbox open failed:', e); }
            }).catch(err => {
                console.error('Failed to load animated image for playback:', err);
                // Already showing <img> as fallback, nothing else needed
            });

            lightboxGifCanvas.dataset.src = mediaUrl;
        } else {
            // Static image (non-GIF, non-WebP)
            _showStaticImage(mediaUrl, lightboxImage, lightboxGifCanvas, lightbox, mediaControlBarInstance);
            setLightboxCropAvailability(filePath, true);
        }
    } else if (_lightboxRenderers && _lightboxRenderers[urlLower.substring(urlLower.lastIndexOf('.'))] || mediaType === 'pdf') {
        // Plugin-registered lightbox renderer (embed/iframe/image mode) or PDF fallback
        const ext = urlLower.substring(urlLower.lastIndexOf('.'));
        const renderer = _lightboxRenderers?.[ext];
        const mode = renderer?.mode || (mediaType === 'pdf' ? 'embed' : 'image');
        const mimeType = renderer?.mimeType || (mediaType === 'pdf' ? 'application/pdf' : '');

        stopLightboxGifProgress();
        lightboxVideo.pause();
        lightboxVideo.removeAttribute('src');
        lightboxVideo.load();
        lightboxVideo.style.display = 'none';
        lightboxImage.style.display = 'none';
        lightboxGifCanvas.style.display = 'none';
        if (mediaControlBarInstance) mediaControlBarInstance.hide();

        if (mode === 'embed' && lightboxPdfEmbed) {
            lightboxPdfEmbed.type = mimeType;
            lightboxPdfEmbed.style.display = 'block';
            lightboxPdfEmbed.src = mediaUrl;
            lightboxPdfEmbed.dataset.src = mediaUrl;
        } else if (mode === 'image') {
            // Show as static image (thumbnail or full-size)
            _showStaticImage(mediaUrl, lightboxImage, lightboxGifCanvas, lightbox, mediaControlBarInstance);
        }
        lightbox.classList.remove('hidden');
        setLightboxCropAvailability(filePath, false);
        try { _enhancedLightboxOnOpen(filePath, null, mediaUrl); } catch (e) { console.warn('enhanced lightbox open failed:', e); }
    } else {
        stopLightboxGifProgress();
        // Hide image and canvas, show video
        lightboxImage.style.display = 'none';
        lightboxGifCanvas.style.display = 'none';
        if (lightboxPdfEmbed) { lightboxPdfEmbed.style.display = 'none'; lightboxPdfEmbed.removeAttribute('src'); }
        lightboxVideo.style.display = 'block';
        lightboxVideo.src = mediaUrl;
        lightboxVideo.dataset.src = mediaUrl;
        lightbox.classList.remove('hidden');
        lightboxVideo.style.transform = getLightboxRotationString();
        lightboxVideo.style.maxWidth = '';
        lightboxVideo.style.maxHeight = '';

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
                const dims = getRotatedMediaDimensions(lightboxVideo.videoWidth, lightboxVideo.videoHeight);
                const fitLevel = calculateFitZoomLevel(dims.width, dims.height);
                if (zoomToFit && fitLevel > 100) {
                    const baseRect = getDisplayedUnrotatedMediaRect(lightboxVideo);
                    if (baseRect) {
                        lightboxVideo.dataset.baseWidth = baseRect.width.toString();
                        lightboxVideo.dataset.baseHeight = baseRect.height.toString();
                    }
                    applyLightboxZoom(fitLevel);
                } else {
                    applyCurrentLightboxTransform();
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

        // Wire enhanced lightbox (inspector + filmstrip) for video
        try { _enhancedLightboxOnOpen(filePath, controller, mediaUrl); } catch (e) { console.warn('enhanced lightbox open failed:', e); }
    }

    // For static images (no controller), still show the inspector without filmstrip
    if (mediaType === 'image' && !(isGif || isWebp)) {
        try { _enhancedLightboxOnOpen(filePath, null, mediaUrl); } catch (e) { console.warn('enhanced lightbox open failed:', e); }
    }
    // PDF inspector is triggered above in the pdf branch

    // Reset keyboard focus
    focusedCardIndex = -1;
    refreshLightboxCropButton();
    refreshLightboxRotationControls();
    perfTest.end('openLightbox', perfStart);
}

const LIGHTBOX_DEBUG = false;
function lightboxDebugLog(...args) {
    if (LIGHTBOX_DEBUG) {
        console.log(...args);
    }
}

function applyLightboxZoom(zoomLevel, mouseX = null, mouseY = null) {
    lightboxDebugLog('applyLightboxZoom called with:', zoomLevel);
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
        const baseRect = getDisplayedUnrotatedMediaRect(zoomableImageEl);
        if (baseRect) {
            zoomableImageEl.dataset.baseWidth = baseRect.width.toString();
            zoomableImageEl.dataset.baseHeight = baseRect.height.toString();
        }
    }

    // ── Hi-res zoom: compute layout partition for <img> elements ──
    // Instead of locking the <img> to its fitted size and using scale() to magnify
    // (which causes blurry GPU upscaling), we increase the layout dimensions up to
    // the image's natural resolution so the browser rasterizes at full fidelity.
    let imgLayoutWidth = null, imgLayoutHeight = null, imgRemainingScale = null;
    if (isImageVisible && zoomLevel > 100) {
        const bw = parseFloat(zoomableImageEl.dataset.baseWidth || '0');
        const bh = parseFloat(zoomableImageEl.dataset.baseHeight || '0');
        const nw = lightboxImage.naturalWidth;
        const nh = lightboxImage.naturalHeight;
        if (bw > 0 && bh > 0 && nw > 0 && nh > 0) {
            const result = computeZoomLayoutDimensions(bw, bh, nw, nh, zoomValue);
            imgLayoutWidth = result.layoutWidth;
            imgLayoutHeight = result.layoutHeight;
            imgRemainingScale = result.remainingScale;
        }
    }
    cachedImgRemainingScale = imgRemainingScale;

    // Build transform strings — <img> may use a reduced scale (layout handles the rest)
    const rotation = getLightboxRotationString();
    const flip = getLightboxFlipString();
    const flipPart = flip ? ` ${flip}` : '';
    let baseTransformString; // For video, canvas
    let imgTransformString;  // For <img> (may use reduced scale for hi-res rendering)

    if (zoomLevel <= 100) {
        baseTransformString = `${rotation}${flipPart} scale(${zoomValue})`;
        imgTransformString = baseTransformString;
    } else {
        baseTransformString = `translate(${currentTranslateX}px, ${currentTranslateY}px) ${rotation}${flipPart} scale(${zoomValue})`;
        if (imgRemainingScale !== null) {
            imgTransformString = `translate(${currentTranslateX}px, ${currentTranslateY}px) ${rotation}${flipPart} scale(${imgRemainingScale})`;
        } else {
            imgTransformString = baseTransformString;
        }
    }

    // Apply transforms — <img> gets its own for hi-res zoom
    lightboxImage.style.transform = imgTransformString;
    lightboxVideo.style.transform = baseTransformString;
    lightboxGifCanvas.style.transform = baseTransformString;

    if (zoomLevel > 100) {
        lightboxImage.classList.add('zoomed');
        lightboxVideo.classList.add('zoomed');
        lightboxGifCanvas.classList.add('zoomed');

        if (isImageVisible && imgLayoutWidth !== null) {
            // Hi-res zoom: set layout dimensions larger than fitted size
            lightboxImage.style.width = `${imgLayoutWidth}px`;
            lightboxImage.style.height = `${imgLayoutHeight}px`;
            lightboxImage.style.maxWidth = 'none';
            lightboxImage.style.maxHeight = 'none';
            // Manage will-change to limit VRAM for very large layouts
            if (imgLayoutWidth > window.innerWidth * 2 || imgLayoutHeight > window.innerHeight * 2) {
                lightboxImage.style.willChange = 'auto';
            } else {
                lightboxImage.style.willChange = '';
            }
        } else if ((isImageVisible || isCanvasVisible) && zoomableImageEl.dataset.baseWidth) {
            const baseWidth = parseFloat(zoomableImageEl.dataset.baseWidth);
            const baseHeight = parseFloat(zoomableImageEl.dataset.baseHeight);
            zoomableImageEl.style.width = `${baseWidth}px`;
            zoomableImageEl.style.height = `${baseHeight}px`;
            zoomableImageEl.style.maxWidth = 'none';
            zoomableImageEl.style.maxHeight = 'none';
        } else if (isImageVisible || isCanvasVisible) {
            // Fallback: compute base dimensions from natural size constrained to
            // the viewport box so we don't jump to full natural size.
            const natW = isImageVisible ? lightboxImage.naturalWidth : (activePlaybackController?.gifWidth || 0);
            const natH = isImageVisible ? lightboxImage.naturalHeight : (activePlaybackController?.gifHeight || 0);
            if (natW > 0 && natH > 0) {
                const vpFrac = (lightboxViewportSetting || 90) / 100;
                const inspW = getLightboxInspectorWidth();
                const maxW = Math.min(window.innerWidth * vpFrac, window.innerWidth - inspW - 80);
                const maxH = window.innerHeight * vpFrac;
                const fitScale = Math.min(1, maxW / natW, maxH / natH);
                const bw = natW * fitScale;
                const bh = natH * fitScale;
                zoomableImageEl.dataset.baseWidth = bw.toString();
                zoomableImageEl.dataset.baseHeight = bh.toString();
                if (isImageVisible) {
                    // Apply hi-res layout partition for <img>
                    const result = computeZoomLayoutDimensions(bw, bh, natW, natH, zoomValue);
                    lightboxImage.style.width = `${result.layoutWidth}px`;
                    lightboxImage.style.height = `${result.layoutHeight}px`;
                    cachedImgRemainingScale = result.remainingScale;
                    imgTransformString = `translate(${currentTranslateX}px, ${currentTranslateY}px) ${rotation} scale(${result.remainingScale})`;
                    lightboxImage.style.transform = imgTransformString;
                } else {
                    zoomableImageEl.style.width = `${bw}px`;
                    zoomableImageEl.style.height = `${bh}px`;
                }
            }
            zoomableImageEl.style.maxWidth = 'none';
            zoomableImageEl.style.maxHeight = 'none';
        } else {
            lightboxVideo.style.maxWidth = 'none';
            lightboxVideo.style.maxHeight = 'none';
        }
    } else {
        lightboxImage.classList.remove('zoomed');
        lightboxVideo.classList.remove('zoomed');
        lightboxGifCanvas.classList.remove('zoomed');
        cachedImgRemainingScale = null;
        lightboxImage.style.willChange = '';
        // Clear inline overrides — let CSS var(--lightbox-max-w) handle constraints
        lightboxImage.style.maxWidth = '';
        lightboxImage.style.maxHeight = '';
        lightboxImage.style.width = 'auto';
        lightboxImage.style.height = 'auto';
        delete lightboxImage.dataset.baseWidth;
        delete lightboxImage.dataset.baseHeight;
        lightboxVideo.style.maxWidth = '';
        lightboxVideo.style.maxHeight = '';
        lightboxGifCanvas.style.maxWidth = '';
        lightboxGifCanvas.style.maxHeight = '';
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
    if (lightboxCropState.active) {
        syncLightboxCropToViewport();
    }
}

function applyCurrentLightboxTransform() {
    const zoomValue = cachedZoomValue;
    const rotation = getLightboxRotationString();
    const flip = getLightboxFlipString();
    const flipPart = flip ? ` ${flip}` : '';

    const baseTransform = currentZoomLevel <= 100
        ? `${rotation}${flipPart} scale(${zoomValue})`
        : `translate(${currentTranslateX}px, ${currentTranslateY}px) ${rotation}${flipPart} scale(${zoomValue})`;

    // For <img> hi-res zoom, use the reduced scale (layout handles the rest)
    let imgTransform = baseTransform;
    if (currentZoomLevel > 100 && cachedImgRemainingScale !== null) {
        imgTransform = `translate(${currentTranslateX}px, ${currentTranslateY}px) ${rotation}${flipPart} scale(${cachedImgRemainingScale})`;
    }

    const imageDisplay = lightboxImage.style.display;
    const videoDisplay = lightboxVideo.style.display;
    const canvasDisplay = lightboxGifCanvas.style.display;
    const isImageVisible = imageDisplay === 'block' ||
                          (imageDisplay === '' && window.getComputedStyle(lightboxImage).display !== 'none');
    const isVideoVisible = videoDisplay === 'block' ||
                          (videoDisplay === '' && window.getComputedStyle(lightboxVideo).display !== 'none');
    const isCanvasVisible = canvasDisplay === 'block' ||
                          (canvasDisplay === '' && window.getComputedStyle(lightboxGifCanvas).display !== 'none');

    if (isImageVisible) lightboxImage.style.transform = imgTransform;
    if (isVideoVisible) lightboxVideo.style.transform = baseTransform;
    if (isCanvasVisible) lightboxGifCanvas.style.transform = baseTransform;

    if (lightboxCropState.active) {
        syncLightboxCropToViewport();
    }
}

function applyPan(deltaX, deltaY) {
    if (currentZoomLevel <= 100) return;
    
    currentTranslateX += deltaX;
    currentTranslateY += deltaY;
    applyCurrentLightboxTransform();
}

function resetZoom() {
    currentZoomLevel = 100;
    cachedZoomValue = 1;
    cachedImgRemainingScale = null;
    currentTranslateX = 0;
    currentTranslateY = 0;
    const baseTransform = `${getLightboxRotationString()} scale(1)`;
    lightboxImage.style.transform = baseTransform;
    lightboxVideo.style.transform = baseTransform;
    lightboxGifCanvas.style.transform = baseTransform;
    lightboxImage.classList.remove('zoomed');
    lightboxVideo.classList.remove('zoomed');
    lightboxGifCanvas.classList.remove('zoomed');
    // Clear inline overrides — let CSS var(--lightbox-max-w) handle constraints
    lightboxImage.style.willChange = '';
    lightboxImage.style.maxWidth = '';
    lightboxImage.style.maxHeight = '';
    lightboxImage.style.width = 'auto';
    lightboxImage.style.height = 'auto';
    lightboxVideo.style.maxWidth = '';
    lightboxVideo.style.maxHeight = '';
    lightboxGifCanvas.style.maxWidth = '';
    lightboxGifCanvas.style.maxHeight = '';
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
    if (lightboxCropState.active) {
        syncLightboxCropToViewport();
    }
}

function closeLightbox() {
    hideContextMenu();
    exitLightboxCropMode({ silent: true });
    setLightboxCropAvailability(window.currentLightboxFilePath, false);
    currentLightboxRotation = 0;
    resetLightboxFlip();

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

    // Clean up PDF embed
    if (lightboxPdfEmbed) {
        lightboxPdfEmbed.style.display = 'none';
        lightboxPdfEmbed.removeAttribute('src');
    }

    // Clean up GIF canvas
    lightboxGifCanvas.style.display = 'none';
    const gifCtx = lightboxGifCanvas.getContext('2d');
    if (gifCtx) gifCtx.clearRect(0, 0, lightboxGifCanvas.width, lightboxGifCanvas.height);

    // Stop lightbox GIF progress bar
    stopLightboxGifProgress();

    // Reset zoom
    resetZoom();

    lightbox.classList.add('hidden');

    // Resume thumbnail videos
    resumeThumbnailVideos();

    // Enhanced lightbox cleanup
    try { _enhancedLightboxOnClose(); } catch (e) { console.warn('enhanced lightbox close failed:', e); }

    // Trigger GC after closing lightbox too
    scheduleGC();
    refreshLightboxCropButton();
    refreshLightboxRotationControls();
}

closeLightboxBtn.addEventListener('click', closeLightbox);
lightboxRotateLeftBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    applyLightboxRotation(-90);
});
lightboxRotateRightBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    applyLightboxRotation(90);
});
lightboxFlipHBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleLightboxFlip('horizontal');
    lightboxFlipHBtn.classList.toggle('active', currentLightboxFlipH);
    lbTfFlipHBtn?.classList.toggle('active', currentLightboxFlipH);
});
lightboxFlipVBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleLightboxFlip('vertical');
    lightboxFlipVBtn.classList.toggle('active', currentLightboxFlipV);
    lbTfFlipVBtn?.classList.toggle('active', currentLightboxFlipV);
});

// Bottom transform bar button listeners
lbTfRotateLeftBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    applyLightboxRotation(-90);
});
lbTfRotateRightBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    applyLightboxRotation(90);
});
lbTfFlipHBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleLightboxFlip('horizontal');
    lightboxFlipHBtn?.classList.toggle('active', currentLightboxFlipH);
    lbTfFlipHBtn.classList.toggle('active', currentLightboxFlipH);
});
lbTfFlipVBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleLightboxFlip('vertical');
    lightboxFlipVBtn?.classList.toggle('active', currentLightboxFlipV);
    lbTfFlipVBtn.classList.toggle('active', currentLightboxFlipV);
});

lightboxCropBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    enterLightboxCropMode();
});
lightboxCropCancelBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    exitLightboxCropMode({ silent: true });
});
lightboxCropApplyBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    applyLightboxCrop();
});
lightboxCropOverlay?.addEventListener('pointerdown', handleLightboxCropPointerDown);
lightboxCropOverlay?.addEventListener('pointermove', handleLightboxCropPointerMove);
lightboxCropOverlay?.addEventListener('pointerup', handleLightboxCropPointerEnd);
lightboxCropOverlay?.addEventListener('pointercancel', handleLightboxCropPointerEnd);
lightboxCropOverlay?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
});
lightboxCropOverlay?.addEventListener('auxclick', (e) => {
    if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
    }
});
window.addEventListener('resize', () => {
    if (lightboxCropState.active) syncLightboxCropToViewport();
});
document.addEventListener('keydown', (e) => {
    if (!lightboxCropState.active) return;
    const target = e.target;
    if ((target === lightboxCropCancelBtn || target === lightboxCropApplyBtn) && (e.key === 'Enter' || e.key === ' ')) {
        return;
    }
    if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        exitLightboxCropMode({ silent: true });
    } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        applyLightboxCrop();
    } else if (matchesShortcut(e, 'zoomIn')) {
        e.preventDefault();
        e.stopPropagation();
        const newZoom = Math.max(30, Math.min(lightboxMaxZoomSetting, currentZoomLevel + 10));
        applyLightboxZoom(newZoom);
    } else if (matchesShortcut(e, 'zoomOut')) {
        e.preventDefault();
        e.stopPropagation();
        const newZoom = Math.max(30, Math.min(lightboxMaxZoomSetting, currentZoomLevel - 10));
        applyLightboxZoom(newZoom);
    } else if (matchesShortcut(e, 'zoomReset')) {
        e.preventDefault();
        e.stopPropagation();
        resetZoom();
    } else if (e.key !== 'Tab') {
        e.preventDefault();
        e.stopPropagation();
    }
}, true);

lightbox.addEventListener('click', (e) => {
    if (lightboxCropState.active) return;
    if (e.target === lightbox && contextMenu.classList.contains('hidden')) {
        closeLightbox();
    }
});

lightbox.addEventListener('contextmenu', (e) => {
    if (lightboxCropState.active) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    // Don't intercept right-clicks on controls
    if (e.target.closest('.lightbox-zoom-controls') ||
        e.target.closest('.media-controls') ||
        e.target.closest('.lightbox-action-btn') ||
        e.target.closest('.lightbox-file-info') ||
        e.target.closest('.lightbox-filmstrip') ||
        e.target.closest('.lightbox-crop-toolbar') ||
        e.target.closest('.lb-inspector') ||
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
        lightboxDebugLog('Attaching zoom slider listeners');
        slider.addEventListener('input', (e) => {
            const zoomLevel = parseInt(e.target.value);
            lightboxDebugLog('Slider input:', zoomLevel);
            applyLightboxZoom(zoomLevel);
        });
        slider.addEventListener('change', (e) => {
            const zoomLevel = parseInt(e.target.value);
            lightboxDebugLog('Slider change:', zoomLevel);
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
    lightboxDebugLog('Wheel event triggered');
    // Only zoom if lightbox is visible and not clicking on controls
    if (lightbox.classList.contains('hidden')) {
        lightboxDebugLog('Lightbox is hidden, ignoring wheel');
        return;
    }
    if (
        e.target === lightboxZoomSlider ||
        e.target.closest('.lightbox-zoom-controls') ||
        e.target.closest('.lb-inspector') ||
        e.target.closest('.lightbox-filmstrip') ||
        e.target.closest('.media-controls') ||
        e.target.closest('.lightbox-crop-toolbar') ||
        e.target.closest('.lightbox-action-btn')
    ) {
        lightboxDebugLog('Wheel on controls, ignoring');
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
    
    lightboxDebugLog('Wheel zoom:', currentZoomLevel, '->', newZoomLevel);
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
lightboxDebugLog('Attaching wheel listeners');
if (lightbox) {
    lightbox.addEventListener('wheel', handleLightboxWheel, { passive: false });
    lightboxDebugLog('Wheel listener attached to lightbox');
}
if (lightboxImage) {
    lightboxImage.addEventListener('wheel', handleLightboxWheel, { passive: false });
    lightboxDebugLog('Wheel listener attached to lightboxImage');
}
if (lightboxVideo) {
    lightboxVideo.addEventListener('wheel', handleLightboxWheel, { passive: false });
    lightboxDebugLog('Wheel listener attached to lightboxVideo');
}
if (lightboxGifCanvas) {
    lightboxGifCanvas.addEventListener('wheel', handleLightboxWheel, { passive: false });
}

// Pan/drag functionality when zoomed
// Panning functionality - optimized with requestAnimationFrame
const panState = {
    lastX: 0,
    lastY: 0,
    initMouseX: 0,
    initMouseY: 0,
    initTranslateX: 0,
    initTranslateY: 0,
    rafId: null,
    pendingUpdate: false,
    hasDragged: false, // Track if we actually dragged (vs just clicked)
};

function applyPanTransform() {
    if (!isDragging || currentZoomLevel <= 100) {
        panState.rafId = null;
        panState.pendingUpdate = false;
        return;
    }

    // Apply transform with translate first (applied last, so in screen space)
    const zoomValue = cachedZoomValue;
    const rotation = getLightboxRotationString();
    const baseTransform = `translate(${currentTranslateX}px, ${currentTranslateY}px) ${rotation} scale(${zoomValue})`;

    // For <img> hi-res zoom, use the reduced scale (layout handles the rest)
    let imgTransform = baseTransform;
    if (cachedImgRemainingScale !== null) {
        imgTransform = `translate(${currentTranslateX}px, ${currentTranslateY}px) ${rotation} scale(${cachedImgRemainingScale})`;
    }

    const imageDisplay = lightboxImage.style.display;
    const videoDisplay = lightboxVideo.style.display;
    const canvasDisplay = lightboxGifCanvas.style.display;
    const isImageVisible = imageDisplay === 'block' ||
                          (imageDisplay === '' && window.getComputedStyle(lightboxImage).display !== 'none');
    const isVideoVisible = videoDisplay === 'block' ||
                          (videoDisplay === '' && window.getComputedStyle(lightboxVideo).display !== 'none');
    const isCanvasVisible = canvasDisplay === 'block' ||
                          (canvasDisplay === '' && window.getComputedStyle(lightboxGifCanvas).display !== 'none');

    if (isImageVisible) lightboxImage.style.transform = imgTransform;
    if (isVideoVisible) lightboxVideo.style.transform = baseTransform;
    if (isCanvasVisible) lightboxGifCanvas.style.transform = baseTransform;
    
    if (lightboxCropState.active) {
        syncLightboxCropToViewport();
    }

    panState.rafId = null;
    panState.pendingUpdate = false;
}

lightboxImage.addEventListener('mousedown', (e) => {
    if (lightboxCropState.active) return;
    if (currentZoomLevel > 100 && e.button === 0) {
        isDragging = true;
        panState.hasDragged = false; // Reset drag flag
        // Store initial positions
        panState.initMouseX = e.clientX;
        panState.initMouseY = e.clientY;
        panState.initTranslateX = currentTranslateX;
        panState.initTranslateY = currentTranslateY;
        panState.lastX = e.clientX;
        panState.lastY = e.clientY;
        e.preventDefault();
        e.stopPropagation();
    }
});

lightboxVideo.addEventListener('mousedown', (e) => {
    if (lightboxCropState.active) return;
    if (currentZoomLevel > 100 && e.button === 0) {
        isDragging = true;
        panState.hasDragged = false;
        panState.initMouseX = e.clientX;
        panState.initMouseY = e.clientY;
        panState.initTranslateX = currentTranslateX;
        panState.initTranslateY = currentTranslateY;
        panState.lastX = e.clientX;
        panState.lastY = e.clientY;
        e.preventDefault();
        e.stopPropagation();
    }
});

lightboxGifCanvas.addEventListener('mousedown', (e) => {
    if (lightboxCropState.active) return;
    if (currentZoomLevel > 100 && e.button === 0) {
        isDragging = true;
        panState.hasDragged = false;
        panState.initMouseX = e.clientX;
        panState.initMouseY = e.clientY;
        panState.initTranslateX = currentTranslateX;
        panState.initTranslateY = currentTranslateY;
        panState.lastX = e.clientX;
        panState.lastY = e.clientY;
        e.preventDefault();
        e.stopPropagation();
    }
});

document.addEventListener('mousemove', (e) => {
    if (lightboxCropState.active) return;
    if (isDragging && currentZoomLevel > 100) {
        // Calculate total mouse movement from initial click
        const totalDeltaX = e.clientX - panState.initMouseX;
        const totalDeltaY = e.clientY - panState.initMouseY;
        
        // Check if we've moved enough to consider it a drag (more than 3 pixels)
        const dragDistance = Math.sqrt(totalDeltaX * totalDeltaX + totalDeltaY * totalDeltaY);
        if (dragDistance > 3) {
            panState.hasDragged = true;
        }
        
        // Update translation values immediately
        currentTranslateX = panState.initTranslateX + totalDeltaX;
        currentTranslateY = panState.initTranslateY + totalDeltaY;
        
        // Schedule transform update via requestAnimationFrame for smooth rendering
        if (!panState.pendingUpdate) {
            panState.pendingUpdate = true;
            if (!panState.rafId) {
                panState.rafId = requestAnimationFrame(applyPanTransform);
            }
        }
        
        e.preventDefault();
    }
});

document.addEventListener('mouseup', (e) => {
    if (lightboxCropState.active) return;
    if (isDragging) {
        isDragging = false;
        // Ensure final position is applied
        if (panState.rafId) {
            cancelAnimationFrame(panState.rafId);
            panState.rafId = null;
        }
        applyPanTransform();
        
        // If we dragged (not just clicked), prevent video play/pause
        if (panState.hasDragged && currentZoomLevel > 100) {
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
    if (lightboxCropState.active) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    if (panState.hasDragged && currentZoomLevel > 100) {
        e.preventDefault();
        e.stopPropagation();
        panState.hasDragged = false;
        return;
    }
    if (activePlaybackController) {
        activePlaybackController.togglePlay();
    }
}, true);

lightboxGifCanvas.addEventListener('click', (e) => {
    if (lightboxCropState.active) {
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    if (panState.hasDragged && currentZoomLevel > 100) {
        e.preventDefault();
        e.stopPropagation();
        panState.hasDragged = false;
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
                success = result.ok;
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

// ── Enhanced Lightbox Instances ──
// ── Initialize + wire into openLightbox/closeLightbox ──
function ensureEnhancedLightboxInstances() {
    if (!filmstripInstance) {
        const el = document.getElementById('lightbox-filmstrip');
        if (el) filmstripInstance = new FilmstripScrubber(el);
    }
    if (!inspectorPanelInstance) {
        const el = document.getElementById('lb-inspector');
        if (el) inspectorPanelInstance = new InspectorPanel(el);
    }
}

// Called from openLightbox after controller is bound
function _enhancedLightboxOnOpen(filePath, controller, mediaUrl) {
    ensureEnhancedLightboxInstances();
    // Clear loop points per-file
    loopPoints = { in: null, out: null };
    if (filmstripInstance) {
        if (controller && lightboxFilmstripEnabled) {
            filmstripInstance.bind(controller, mediaUrl);
            filmstripInstance.updateMarkers(loopPoints);
        } else {
            filmstripInstance.hide();
        }
    }
    if (inspectorPanelInstance) {
        inspectorPanelInstance.bind(filePath, controller);
    }
    syncLightboxZoomControlsPlacement();
}

function _enhancedLightboxOnClose() {
    loopPoints = { in: null, out: null };
    lightboxItemsOverride = null; // exit similar-nav mode
    _lbHistory = [];
    _lbHistoryIndex = -1;
    if (filmstripInstance) filmstripInstance.unbind();
    if (filmstripInstance) filmstripInstance.hide();
    if (inspectorPanelInstance) inspectorPanelInstance.unbind();
    if (inspectorPanelInstance) inspectorPanelInstance.hide();
    syncLightboxZoomControlsPlacement();
}
