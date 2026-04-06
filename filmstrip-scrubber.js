// ── Filmstrip Scrubber ────────────────────────────────────────────────────────
// Extracted from renderer.js — a scrubber strip for lightbox video/animated-image playback.
// Depends on globals: _lbFormatTime(), loopPoints, syncAbLoop() (from renderer.js / lightbox area).

const SCRUBBER_TILE_WIDTH = 160;
const SCRUBBER_TILE_HEIGHT = 90;
const SCRUBBER_TILE_COUNT = 18;

class FilmstripScrubber {
    constructor(rootEl) {
        this._root = rootEl;
        this._track = rootEl.querySelector('#lb-filmstrip-track');
        this._playhead = rootEl.querySelector('#lb-filmstrip-playhead');
        this._markerIn = rootEl.querySelector('#lb-filmstrip-marker-in');
        this._markerOut = rootEl.querySelector('#lb-filmstrip-marker-out');
        this._loopRange = rootEl.querySelector('#lb-filmstrip-loop-range');
        this._tooltip = rootEl.querySelector('#lb-filmstrip-tooltip');
        this._tooltipCanvas = rootEl.querySelector('#lb-filmstrip-tooltip-canvas');
        this._tooltipTime = rootEl.querySelector('#lb-filmstrip-tooltip-time');
        this._tooltipCtx = this._tooltipCanvas.getContext('2d');
        this._controller = null;
        this._mediaUrl = null;
        this._tileCount = SCRUBBER_TILE_COUNT;
        this._tiles = [];           // canvases
        this._isDragging = false;
        this._timeupdateHandler = null;
        this._offscreenVideo = null;
        this._pendingSeek = null;
        this._seekBusy = false;
        this._scrubRafPending = false;
        this._lastClickTime = 0;
        this._tooltipRaf = null;
        this._pendingTooltipTime = null;
        this._tooltipSeekBusy = false;
        this._bindEvents();
    }

    _bindEvents() {
        this._track.addEventListener('mousedown', (e) => this._onMouseDown(e));
        this._track.addEventListener('mousemove', (e) => this._onMouseMove(e));
        this._track.addEventListener('mouseenter', () => { this._tooltip.hidden = false; });
        this._track.addEventListener('mouseleave', () => { this._tooltip.hidden = true; this._hoverTime = null; });
        // Draggable markers
        this._markerIn.addEventListener('mousedown', (e) => this._onMarkerMouseDown(e, 'in'));
        this._markerOut.addEventListener('mousedown', (e) => this._onMarkerMouseDown(e, 'out'));
        // Make markers pointer-interactive even though they're absolute overlay
        this._markerIn.style.pointerEvents = 'auto';
        this._markerOut.style.pointerEvents = 'auto';
        this._markerIn.style.cursor = 'ew-resize';
        this._markerOut.style.cursor = 'ew-resize';
    }

    /** Current hover time in seconds over the track, or null if cursor is not over the strip. */
    getHoverTime() { return this._hoverTime; }

    show() { this._root.classList.remove('hidden'); }
    hide() { this._root.classList.add('hidden'); this._tooltip.hidden = true; }

    async bind(controller, mediaUrl) {
        this.unbind();
        if (!controller) { this.hide(); return; }
        this._controller = controller;
        this._mediaUrl = mediaUrl;

        // Decide visibility: videos always (if duration); animated images if frameCount > 2
        const type = controller.mediaType;
        const isAnimated = (type === 'gif' || type === 'webp') && controller.frameCount > 2;
        const isVideo = type === 'video';
        if (!isVideo && !isAnimated) { this.hide(); return; }

        this.show();
        this._buildTiles();
        this._updatePlayhead();

        this._timeupdateHandler = () => this._updatePlayhead();
        controller.on('timeupdate', this._timeupdateHandler);

        // Render frame thumbnails
        if (isAnimated) {
            this._renderAnimatedTiles(controller);
        } else if (isVideo) {
            this._renderVideoTiles(mediaUrl);
        }
    }

    unbind() {
        if (this._controller && this._timeupdateHandler) {
            this._controller.off('timeupdate', this._timeupdateHandler);
        }
        this._timeupdateHandler = null;
        this._controller = null;
        if (this._offscreenVideo) {
            try { this._offscreenVideo.pause(); this._offscreenVideo.src = ''; } catch {}
            this._offscreenVideo = null;
        }
        this._pendingSeek = null;
        this._seekBusy = false;
        this._pendingTooltipTime = null;
        this._tooltipSeekBusy = false;
    }

    _buildTiles() {
        this._track.innerHTML = '';
        this._tiles = [];
        for (let i = 0; i < this._tileCount; i++) {
            const c = document.createElement('canvas');
            c.width = SCRUBBER_TILE_WIDTH; c.height = SCRUBBER_TILE_HEIGHT;
            this._track.appendChild(c);
            this._tiles.push(c);
        }
    }

    _renderAnimatedTiles(controller) {
        const frameCount = controller.frameCount;
        const count = Math.min(this._tileCount, frameCount);
        if (count < this._tileCount) {
            // Rebuild with exact count so flex layout looks right
            this._track.innerHTML = '';
            this._tiles = [];
            for (let i = 0; i < count; i++) {
                const c = document.createElement('canvas');
                c.width = SCRUBBER_TILE_WIDTH; c.height = SCRUBBER_TILE_HEIGHT;
                this._track.appendChild(c);
                this._tiles.push(c);
            }
        }
        for (let i = 0; i < count; i++) {
            const idx = Math.min(frameCount - 1, Math.floor(i * frameCount / count));
            const src = controller.getFrameAtIndex(idx);
            if (src) {
                const ctx = this._tiles[i].getContext('2d');
                ctx.drawImage(src, 0, 0, SCRUBBER_TILE_WIDTH, SCRUBBER_TILE_HEIGHT);
            }
        }
    }

    async _renderVideoTiles(mediaUrl) {
        // Use a separate offscreen video to avoid fighting user playback
        const v = document.createElement('video');
        v.muted = true;
        v.preload = 'auto';
        v.src = mediaUrl;
        this._offscreenVideo = v;
        try {
            await new Promise((resolve, reject) => {
                const onMeta = () => { v.removeEventListener('loadedmetadata', onMeta); resolve(); };
                const onErr = (e) => { v.removeEventListener('error', onErr); reject(e); };
                v.addEventListener('loadedmetadata', onMeta);
                v.addEventListener('error', onErr);
            });
        } catch { return; }
        const duration = v.duration || 0;
        if (!isFinite(duration) || duration <= 0) return;

        const count = this._tileCount;
        for (let i = 0; i < count; i++) {
            if (this._offscreenVideo !== v) return; // unbound
            const t = ((i + 0.5) / count) * duration;
            try {
                await new Promise((resolve) => {
                    const onSeeked = () => { v.removeEventListener('seeked', onSeeked); resolve(); };
                    v.addEventListener('seeked', onSeeked);
                    v.currentTime = Math.min(duration - 0.01, t);
                    // Safety timeout in case 'seeked' never fires
                    setTimeout(() => { v.removeEventListener('seeked', onSeeked); resolve(); }, 1500);
                });
                if (this._offscreenVideo !== v) return;
                const ctx = this._tiles[i]?.getContext('2d');
                if (ctx && v.videoWidth) ctx.drawImage(v, 0, 0, SCRUBBER_TILE_WIDTH, SCRUBBER_TILE_HEIGHT);
            } catch { /* keep going */ }
        }
    }

    _updatePlayhead() {
        if (!this._controller) return;
        const dur = this._controller.duration;
        if (dur <= 0) return;
        const pct = Math.max(0, Math.min(100, (this._controller.currentTime / dur) * 100));
        this._playhead.style.left = pct + '%';
    }

    updateMarkers(points) {
        if (!this._controller) return;
        const dur = this._controller.duration;
        if (dur <= 0) { this._markerIn.hidden = true; this._markerOut.hidden = true; this._loopRange.hidden = true; return; }
        const { in: a, out: b } = points;
        if (a != null) {
            this._markerIn.hidden = false;
            this._markerIn.style.left = Math.max(0, Math.min(100, (a / dur) * 100)) + '%';
        } else this._markerIn.hidden = true;
        if (b != null) {
            this._markerOut.hidden = false;
            this._markerOut.style.left = Math.max(0, Math.min(100, (b / dur) * 100)) + '%';
        } else this._markerOut.hidden = true;
        if (a != null && b != null && b > a) {
            this._loopRange.hidden = false;
            const left = (a / dur) * 100;
            const width = ((b - a) / dur) * 100;
            this._loopRange.style.left = left + '%';
            this._loopRange.style.width = width + '%';
        } else {
            this._loopRange.hidden = true;
        }
    }

    _eventToTime(e) {
        if (!this._controller) return 0;
        const rect = this._track.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        return pct * this._controller.duration;
    }

    _onMouseDown(e) {
        if (!this._controller) return;
        e.preventDefault();
        this._isDragging = true;
        this._scrubTo(this._eventToTime(e));

        const moveHandler = (ev) => {
            this._pendingScrubTime = this._eventToTime(ev);
            if (!this._scrubRafPending) {
                this._scrubRafPending = true;
                requestAnimationFrame(() => {
                    this._scrubRafPending = false;
                    if (this._pendingScrubTime != null) {
                        this._scrubTo(this._pendingScrubTime);
                        this._pendingScrubTime = null;
                    }
                });
            }
        };
        const upHandler = () => {
            this._isDragging = false;
            this._pendingScrubTime = null;
            document.removeEventListener('mousemove', moveHandler);
            document.removeEventListener('mouseup', upHandler);
        };
        document.addEventListener('mousemove', moveHandler);
        document.addEventListener('mouseup', upHandler);
    }

    _scrubTo(t) {
        if (this._controller) this._controller.seek(t);
    }

    _onMouseMove(e) {
        if (!this._controller) return;
        const t = this._eventToTime(e);
        this._hoverTime = t;
        // Position tooltip
        const rect = this._track.getBoundingClientRect();
        const relX = e.clientX - rect.left;
        this._tooltip.style.left = relX + 'px';
        this._tooltipTime.textContent = _lbFormatTime(t);
        this._tooltip.hidden = false;

        // Render preview into tooltip canvas
        this._pendingTooltipTime = t;
        if (this._tooltipRaf) return;
        this._tooltipRaf = requestAnimationFrame(() => {
            this._tooltipRaf = null;
            const pt = this._pendingTooltipTime;
            if (pt == null) return;
            this._renderTooltipPreview(pt);
        });
    }

    _onMarkerMouseDown(e, which) {
        if (!this._controller) return;
        e.preventDefault();
        e.stopPropagation();
        const trackRect = this._track.getBoundingClientRect();
        const dur = this._controller.duration;
        if (dur <= 0) return;
        const eventToTime = (ev) => {
            const pct = Math.max(0, Math.min(1, (ev.clientX - trackRect.left) / trackRect.width));
            return pct * dur;
        };
        const move = (ev) => {
            const t = eventToTime(ev);
            if (which === 'in') {
                if (loopPoints.out != null && t >= loopPoints.out) return;
                loopPoints.in = t;
            } else {
                if (loopPoints.in != null && t <= loopPoints.in) return;
                loopPoints.out = t;
            }
            this.updateMarkers(loopPoints);
            // Live tooltip update
            this._tooltip.hidden = false;
            this._tooltip.style.left = (ev.clientX - trackRect.left) + 'px';
            this._tooltipTime.textContent = _lbFormatTime(t);
            this._renderTooltipPreview(t);
        };
        const up = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
            this._tooltip.hidden = true;
            syncAbLoop();
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    }

    _renderTooltipPreview(t) {
        if (!this._controller) return;
        const type = this._controller.mediaType;
        this._tooltipCtx.clearRect(0, 0, SCRUBBER_TILE_WIDTH, SCRUBBER_TILE_HEIGHT);
        if (type === 'gif' || type === 'webp') {
            const idx = this._controller.getFrameIndexAtTime(t);
            const src = this._controller.getFrameAtIndex(idx);
            if (src) this._tooltipCtx.drawImage(src, 0, 0, SCRUBBER_TILE_WIDTH, SCRUBBER_TILE_HEIGHT);
        } else if (type === 'video') {
            // Approximate: upscale nearest filmstrip tile — seeking the offscreen video mid-hover is too slow.
            if (this._tiles.length > 0 && this._controller.duration > 0) {
                const idx = Math.max(0, Math.min(this._tiles.length - 1, Math.floor((t / this._controller.duration) * this._tiles.length)));
                const tile = this._tiles[idx];
                if (tile) this._tooltipCtx.drawImage(tile, 0, 0, SCRUBBER_TILE_WIDTH, SCRUBBER_TILE_HEIGHT);
            }
        }
    }

    destroy() {
        this.unbind();
        this.hide();
    }
}
