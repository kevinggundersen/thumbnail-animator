/**
 * Unified media playback controllers for the lightbox.
 *
 * MediaPlaybackController — abstract interface
 * VideoPlaybackController — wraps HTMLVideoElement
 * AnimatedImagePlaybackController — decodes GIF/WebP frames to canvas via gifuct-js / webpxmux.js
 */

// ==================== BASE CONTROLLER ====================

class MediaPlaybackController {
    constructor() {
        this._listeners = {};
        this._speed = 1;
        this._loop = false;
        this._repeat = false;
        this._abLoop = null; // {a, b} in seconds when set
    }

    // Override in subclasses
    play() {}
    pause() {}
    togglePlay() {
        if (this.isPlaying) this.pause();
        else this.play();
    }
    seek(time) {}
    seekPercent(pct) {
        if (this.duration > 0) this.seek(pct * this.duration);
    }
    setSpeed(rate) { this._speed = rate; }
    getSpeed() { return this._speed; }
    stepFrame(direction) {} // 'next' | 'prev'
    setLoop(val) { this._loop = val; }
    getLoop() { return this._loop; }
    setRepeat(val) { this._repeat = val; }
    getRepeat() { return this._repeat; }
    setVolume(val) {}
    getVolume() { return 1; }
    setMuted(val) {}
    getMuted() { return false; }

    // A-B loop range (both endpoints in seconds). When set AND loop is on,
    // playback cycles between [a, b] instead of the whole clip.
    setAbLoop(a, b) {
        if (a == null || b == null || b <= a) { this.clearAbLoop(); return; }
        this._abLoop = { a: Math.max(0, a), b: Math.min(this.duration || b, b) };
    }
    clearAbLoop() { this._abLoop = null; }
    getAbLoop() { return this._abLoop; }

    get currentTime() { return 0; }
    get duration() { return 0; }
    get isPlaying() { return false; }
    get isPaused() { return !this.isPlaying; }
    get progress() { return this.duration > 0 ? this.currentTime / this.duration : 0; }
    get hasAudio() { return false; }
    get mediaType() { return 'unknown'; }

    on(event, callback) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(callback);
        return this;
    }

    off(event, callback) {
        if (!this._listeners[event]) return this;
        if (callback) {
            this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
        } else {
            delete this._listeners[event];
        }
        return this;
    }

    _emit(event, data) {
        const cbs = this._listeners[event];
        if (cbs) cbs.forEach(cb => cb(data));
    }

    destroy() {
        this._listeners = {};
    }
}

// ==================== VIDEO CONTROLLER ====================

class VideoPlaybackController extends MediaPlaybackController {
    constructor(videoElement) {
        super();
        this._video = videoElement;
        this._timeupdateHandler = () => {
            // A-B loop enforcement: wrap back to 'a' when we cross 'b'.
            if (this._abLoop && this._loop) {
                const { a, b } = this._abLoop;
                const t = this._video.currentTime;
                if (t >= b) { this._video.currentTime = a; }
                else if (t < a - 0.05) { this._video.currentTime = a; }
            }
            this._emit('timeupdate', { currentTime: this.currentTime, duration: this.duration });
        };
        this._playHandler = () => this._emit('play');
        this._pauseHandler = () => this._emit('pause');
        this._endedHandler = () => {
            if (this._repeat) {
                this._video.currentTime = 0;
                this._video.play();
            }
            this._emit('ended');
        };
        this._loadedHandler = () => this._emit('loadedmetadata', { duration: this.duration });
        this._volumeHandler = () => this._emit('volumechange', { volume: this.getVolume(), muted: this.getMuted() });

        this._video.addEventListener('timeupdate', this._timeupdateHandler);
        this._video.addEventListener('play', this._playHandler);
        this._video.addEventListener('pause', this._pauseHandler);
        this._video.addEventListener('ended', this._endedHandler);
        this._video.addEventListener('loadedmetadata', this._loadedHandler);
        this._video.addEventListener('volumechange', this._volumeHandler);
    }

    play() { this._video.play().catch(() => {}); }
    pause() { this._video.pause(); }

    seek(time) {
        this._video.currentTime = Math.max(0, Math.min(time, this._video.duration || 0));
    }

    setSpeed(rate) {
        super.setSpeed(rate);
        this._video.playbackRate = rate;
    }

    stepFrame(direction) {
        if (this._video.readyState < 2) return;
        const frameTime = 1 / 30; // Assume 30fps
        if (direction === 'next') {
            this._video.currentTime = Math.min(this._video.duration, this._video.currentTime + frameTime);
        } else {
            this._video.currentTime = Math.max(0, this._video.currentTime - frameTime);
        }
    }

    setLoop(val) {
        super.setLoop(val);
        // When A-B is active, our timeupdate handler owns the boundary — disable native loop.
        this._video.loop = val && !this._abLoop;
    }

    setAbLoop(a, b) {
        super.setAbLoop(a, b);
        // A-B wins over native loop: disable video.loop while A-B is set.
        this._video.loop = this._loop && !this._abLoop;
    }

    clearAbLoop() {
        super.clearAbLoop();
        this._video.loop = this._loop;
    }

    setVolume(val) { this._video.volume = Math.max(0, Math.min(1, val)); }
    getVolume() { return this._video.volume; }
    setMuted(val) { this._video.muted = val; }
    getMuted() { return this._video.muted; }

    get currentTime() { return this._video.currentTime || 0; }
    get duration() { return this._video.duration || 0; }
    get isPlaying() { return !this._video.paused && !this._video.ended; }
    get hasAudio() { return true; }
    get mediaType() { return 'video'; }

    destroy() {
        this._video.removeEventListener('timeupdate', this._timeupdateHandler);
        this._video.removeEventListener('play', this._playHandler);
        this._video.removeEventListener('pause', this._pauseHandler);
        this._video.removeEventListener('ended', this._endedHandler);
        this._video.removeEventListener('loadedmetadata', this._loadedHandler);
        this._video.removeEventListener('volumechange', this._volumeHandler);
        super.destroy();
    }
}

// ==================== ANIMATED IMAGE CONTROLLER (GIF + WebP) ====================

// Lazy-initialize webpxmux WASM on first use (saves ~100ms+ at startup)
let _webpxmuxReady = null;
function getWebPXMux() {
    if (!_webpxmuxReady) {
        const wasmPath = 'webpxmux.wasm';
        const inst = WebPXMux(wasmPath);
        _webpxmuxReady = inst.waitRuntime().then(() => inst).catch(err => { console.warn('webpxmux wasm load:', err); _webpxmuxReady = null; throw err; });
    }
    return _webpxmuxReady;
}

class AnimatedImagePlaybackController extends MediaPlaybackController {
    /**
     * @param {HTMLCanvasElement} canvas — canvas element to render frames to
     * @param {ArrayBuffer} buffer — raw GIF or animated WebP file bytes
     */
    constructor(canvas, buffer) {
        super();
        this._canvas = canvas;
        this._ctx = canvas.getContext('2d');
        this._frames = [];
        this._composited = []; // pre-rendered offscreen canvases (sparse for large GIFs)
        this._frameTimeline = []; // cumulative time at end of each frame (ms)
        this._totalDuration = 0;
        this._currentFrame = 0;
        this._currentTime = 0; // ms
        this._playing = false;
        this._animId = null;
        this._lastTimestamp = null;
        this._lastUIUpdate = 0; // throttle timeupdate emissions
        this._tempCanvas = null;
        this._tempCtx = null;
        this._gifWidth = 0;
        this._gifHeight = 0;
        this._format = 'gif'; // 'gif' or 'webp'
        this._preRenderedUpTo = -1; // highest frame index composited into _tempCtx

        // Sliding window: for GIFs with many frames, only keep a window of canvases in memory
        this._useWindow = false;          // enabled for large GIFs (> WINDOW_THRESHOLD)
        this._windowAhead = 32;           // pre-render this many frames ahead of playhead
        this._windowBehind = 8;           // keep this many frames behind playhead
        this._keyframeInterval = 32;      // save compositing state every N frames
        this._keyframes = [];             // sparse array: index -> ImageData snapshot of _tempCtx
        this._compositedCount = 0;        // track how many canvases are alive

        // ready resolves when decode is complete (sync for GIF, async for WebP)
        this.ready = this._decode(buffer);
    }

    /** Threshold: GIFs with more frames than this use sliding window */
    static WINDOW_THRESHOLD = 64;

    /** Detect format from magic bytes and dispatch to the right decoder */
    async _decode(buffer) {
        const bytes = new Uint8Array(buffer);
        // RIFF....WEBP magic
        if (bytes.length >= 12 &&
            bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
            bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
            this._format = 'webp';
            await this._decodeWebp(bytes);
        } else {
            this._format = 'gif';
            this._decodeGif(buffer);
        }
    }

    _decodeGif(buffer) {
        try {
            const { parseGIF, decompressFrames } = gifuctJs;
            const gif = parseGIF(buffer);
            this._frames = decompressFrames(gif, true);

            if (this._frames.length === 0) return;

            this._gifWidth = gif.lsd.width;
            this._gifHeight = gif.lsd.height;
            this._canvas.width = this._gifWidth;
            this._canvas.height = this._gifHeight;

            // Create temp canvas for compositing frames with offsets
            this._tempCanvas = document.createElement('canvas');
            this._tempCanvas.width = this._gifWidth;
            this._tempCanvas.height = this._gifHeight;
            this._tempCtx = this._tempCanvas.getContext('2d');

            // Build timeline — cumulative ms at end of each frame
            let cumulative = 0;
            this._frameTimeline = this._frames.map(f => {
                const delay = f.delay || 100; // gifuct-js already returns ms, default 100ms
                cumulative += delay;
                return cumulative;
            });
            this._totalDuration = cumulative;

            // Enable sliding window for large GIFs to save memory
            this._useWindow = this._frames.length > AnimatedImagePlaybackController.WINDOW_THRESHOLD;
            this._composited = new Array(this._frames.length);
            this._keyframes = new Array(this._frames.length);
            this._compositedCount = 0;

            // Dynamic keyframe budget: cap total keyframe memory at ~256 MB.
            // Each keyframe is an ImageData = width * height * 4 bytes (RGBA).
            if (this._useWindow) {
                const KEYFRAME_BUDGET_BYTES = 256 * 1024 * 1024; // 256 MB
                const perKeyframeBytes = this._gifWidth * this._gifHeight * 4;
                if (perKeyframeBytes > 0) {
                    const maxKeyframes = Math.max(2, Math.floor(KEYFRAME_BUDGET_BYTES / perKeyframeBytes));
                    const minInterval = Math.ceil(this._frames.length / maxKeyframes);
                    this._keyframeInterval = Math.max(this._keyframeInterval, minInterval);
                }
            }

            // Show first frame immediately via putImageData, then pre-render rest async
            this._preRenderRange(0, 1); // composite frame 0
            this._showFrame(0);
            this._emit('loadedmetadata', { duration: this.duration });

            // Pre-render remaining frames in async batches so we don't block the UI
            this._preRenderAsync();
        } catch (err) {
            console.error('GIF decode error:', err);
        }
    }

    /**
     * Convert a webpxmux Uint32Array (0xRRGGBBAA packing) to Uint8ClampedArray (R,G,B,A bytes).
     * Writing each Uint32 as big-endian naturally produces R,G,B,A byte order.
     */
    _convertWebpPixels(rgba32, pixelCount) {
        const out = new Uint8ClampedArray(pixelCount * 4);
        for (let i = 0; i < pixelCount; i++) {
            const v = rgba32[i]; // 0xRRGGBBAA packing
            const o = i * 4;
            out[o]     = (v >>> 24) & 0xFF; // R
            out[o + 1] = (v >>> 16) & 0xFF; // G
            out[o + 2] = (v >>> 8)  & 0xFF; // B
            out[o + 3] =  v         & 0xFF; // A
        }
        return out;
    }

    async _decodeWebp(bytes) {
        try {
            const mux = await getWebPXMux();
            const result = await mux.decodeFrames(bytes);

            if (!result.frames || result.frames.length === 0) return;

            this._gifWidth = result.width;
            this._gifHeight = result.height;
            this._canvas.width = this._gifWidth;
            this._canvas.height = this._gifHeight;
            const pixelCount = this._gifWidth * this._gifHeight;

            // Convert webpxmux frames to internal format
            this._frames = result.frames.map(f => ({
                delay: f.duration,
                dims: { top: 0, left: 0, width: this._gifWidth, height: this._gifHeight },
                patch: this._convertWebpPixels(f.rgba, pixelCount),
                disposalType: 0
            }));

            // Build timeline
            let cumulative = 0;
            this._frameTimeline = this._frames.map(f => {
                const delay = f.delay || 100;
                cumulative += delay;
                return cumulative;
            });
            this._totalDuration = cumulative;

            // Show first frame immediately, pre-render rest async
            this._tempCanvas = document.createElement('canvas');
            this._tempCanvas.width = this._gifWidth;
            this._tempCanvas.height = this._gifHeight;
            this._tempCtx = this._tempCanvas.getContext('2d');

            // Enable sliding window for large animated WebPs
            this._useWindow = this._frames.length > AnimatedImagePlaybackController.WINDOW_THRESHOLD;
            this._composited = new Array(this._frames.length);
            this._keyframes = new Array(this._frames.length);
            this._compositedCount = 0;

            this._preRenderRange(0, 1);
            this._showFrame(0);
            this._emit('loadedmetadata', { duration: this.duration });

            this._preRenderAsync();
        } catch (err) {
            console.error('WebP decode error:', err);
        }
    }

    /**
     * Pre-composite frames [start, end) into offscreen canvases.
     * Frames must be composited in order because GIF uses delta/disposal compositing —
     * each frame builds on _tempCtx which holds the previous frame's state.
     * Updates _preRenderedUpTo so the async loop and seek stay coordinated.
     */
    _preRenderRange(start, end) {
        if (start === 0) {
            this._tempCtx.clearRect(0, 0, this._gifWidth, this._gifHeight);
        }
        for (let i = start; i < end && i < this._frames.length; i++) {
            const frame = this._frames[i];
            const { dims, patch, disposalType } = frame;

            if (disposalType === 2) {
                this._tempCtx.clearRect(0, 0, this._gifWidth, this._gifHeight);
            }

            const imageData = new ImageData(patch, dims.width, dims.height);
            this._tempCtx.putImageData(imageData, dims.left, dims.top);

            // Save keyframe snapshot for efficient seeking (only in windowed mode)
            if (this._useWindow && i % this._keyframeInterval === 0) {
                this._keyframes[i] = this._tempCtx.getImageData(0, 0, this._gifWidth, this._gifHeight);
            }

            if (!this._composited[i]) {
                const snap = document.createElement('canvas');
                snap.width = this._gifWidth;
                snap.height = this._gifHeight;
                snap.getContext('2d').drawImage(this._tempCanvas, 0, 0);
                this._composited[i] = snap;
                this._compositedCount++;
            } else {
                // Reuse existing canvas
                this._composited[i].getContext('2d').drawImage(this._tempCanvas, 0, 0);
            }
        }
        const lastDone = Math.min(end, this._frames.length) - 1;
        if (lastDone > this._preRenderedUpTo) {
            this._preRenderedUpTo = lastDone;
        }
    }

    /** Pre-render remaining frames in async batches, yielding to the event loop between batches */
    _preRenderAsync() {
        const BATCH = 8;
        if (this._useWindow) {
            // Windowed mode: only pre-render a window ahead of frame 0
            const windowEnd = Math.min(this._windowAhead, this._frames.length);
            const step = () => {
                const start = this._preRenderedUpTo + 1;
                if (start >= windowEnd) return;
                const end = Math.min(start + BATCH, windowEnd);
                this._preRenderRange(start, end);
                requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        } else {
            // Small GIF: pre-render all frames
            const step = () => {
                const start = this._preRenderedUpTo + 1;
                if (start >= this._frames.length) return;
                const end = Math.min(start + BATCH, this._frames.length);
                this._preRenderRange(start, end);
                requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        }
    }

    /**
     * Evict composited canvases outside the sliding window around the given frame.
     * Only active in windowed mode. Frees GPU/memory for large GIFs.
     */
    _evictOutsideWindow(centerFrame) {
        if (!this._useWindow) return;
        const lo = centerFrame - this._windowBehind;
        const hi = centerFrame + this._windowAhead;
        // Evict keyframes that are far outside the current window to bound memory.
        // Keep keyframes within a wider range (4× the composited window) so seeking
        // to nearby positions is still fast; only truly distant keyframes are evicted.
        const kfLo = centerFrame - this._windowBehind * 4;
        const kfHi = centerFrame + this._windowAhead * 4;
        for (let i = 0; i < this._frames.length; i++) {
            if (this._composited[i] && (i < lo || i > hi)) {
                this._composited[i] = null;
                this._compositedCount--;
            }
            if (this._keyframes[i] && (i < kfLo || i > kfHi)) {
                this._keyframes[i] = null;
            }
        }
    }

    /**
     * Ensure frames around the target are composited (windowed mode).
     * Uses keyframes to seek efficiently without re-compositing from frame 0.
     */
    _ensureWindowAround(targetFrame) {
        if (!this._useWindow) return;

        // If target is already composited, just ensure ahead window
        if (this._composited[targetFrame]) {
            // Pre-render ahead if needed
            const aheadEnd = Math.min(targetFrame + this._windowAhead, this._frames.length);
            if (this._preRenderedUpTo < aheadEnd - 1) {
                // Need to composite forward — but only if contiguous from _preRenderedUpTo
                const start = this._preRenderedUpTo + 1;
                if (start <= aheadEnd) {
                    this._preRenderRange(start, aheadEnd);
                }
            }
            return;
        }

        // Target not composited — find nearest keyframe at or before target
        let keyframeIdx = -1;
        for (let k = targetFrame; k >= 0; k -= this._keyframeInterval) {
            const aligned = k - (k % this._keyframeInterval);
            if (this._keyframes[aligned]) {
                keyframeIdx = aligned;
                break;
            }
            if (aligned === 0) break;
        }

        if (keyframeIdx >= 0) {
            // Restore _tempCtx from keyframe and composite forward
            this._tempCtx.putImageData(this._keyframes[keyframeIdx], 0, 0);
            this._preRenderedUpTo = keyframeIdx - 1;
        } else {
            // No keyframe available — must composite from frame 0
            this._preRenderedUpTo = -1;
        }

        // Composite from after keyframe to target + ahead window
        const renderEnd = Math.min(targetFrame + this._windowAhead, this._frames.length);
        this._preRenderRange(this._preRenderedUpTo + 1, renderEnd);

        // Evict old frames outside window
        this._evictOutsideWindow(targetFrame);
    }

    /**
     * Display a frame. If the frame hasn't been pre-rendered yet,
     * synchronously composite all frames from _preRenderedUpTo+1 up to it
     * (required for correct GIF delta compositing).
     */
    _showFrame(index) {
        if (index < 0 || index >= this._frames.length) return;
        if (!this._composited[index]) {
            if (this._useWindow) {
                this._ensureWindowAround(index);
            } else {
                this._preRenderRange(this._preRenderedUpTo + 1, index + 1);
            }
        }
        if (this._composited[index]) {
            this._ctx.drawImage(this._composited[index], 0, 0);
        }
        this._currentFrame = index;

        // In windowed mode, evict distant frames periodically during playback
        if (this._useWindow && this._playing) {
            this._evictOutsideWindow(index);
        }
    }

    _animate(timestamp) {
        if (!this._playing) return;

        if (this._lastTimestamp === null) {
            this._lastTimestamp = timestamp;
        }

        const delta = (timestamp - this._lastTimestamp) * this._speed;
        this._lastTimestamp = timestamp;
        this._currentTime += delta;

        // A-B loop: if set AND loop on, clamp playback to [a_ms, b_ms].
        if (this._abLoop && this._loop) {
            const aMs = this._abLoop.a * 1000;
            const bMs = this._abLoop.b * 1000;
            if (this._currentTime >= bMs) {
                this._currentTime = aMs + ((this._currentTime - aMs) % Math.max(1, bMs - aMs));
            } else if (this._currentTime < aMs) {
                this._currentTime = aMs;
            }
        }

        // Handle looping
        if (this._currentTime >= this._totalDuration) {
            if (this._loop) {
                this._currentTime = this._currentTime % this._totalDuration;
            } else if (this._repeat) {
                this._currentTime = 0;
                this._emit('ended');
            } else {
                this._currentTime = this._totalDuration;
                this._playing = false;
                this._emit('ended');
                this._emit('pause');
                return;
            }
        }

        // Find which frame we should be on
        const targetFrame = this._getFrameAtTime(this._currentTime);
        if (targetFrame !== this._currentFrame) {
            this._showFrame(targetFrame);
        }

        // Throttle UI updates to ~15fps to reduce DOM overhead
        if (timestamp - this._lastUIUpdate >= 66) {
            this._lastUIUpdate = timestamp;
            this._emit('timeupdate', { currentTime: this.currentTime, duration: this.duration });
        }
        this._animId = requestAnimationFrame(ts => this._animate(ts));
    }

    _getFrameAtTime(timeMs) {
        // Binary search — _frameTimeline is monotonically increasing.
        // 10-50x faster than linear scan for large GIFs (1000+ frames).
        const tl = this._frameTimeline;
        let lo = 0, hi = tl.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (timeMs < tl[mid]) hi = mid;
            else lo = mid + 1;
        }
        return lo < tl.length ? lo : this._frames.length - 1;
    }

    play() {
        if (this._playing) return;
        if (this._frames.length === 0) return;

        // If at end, restart
        if (this._currentTime >= this._totalDuration) {
            this._currentTime = 0;
            this._showFrame(0);
        }

        this._playing = true;
        this._lastTimestamp = null;
        this._animId = requestAnimationFrame(ts => this._animate(ts));
        this._emit('play');
    }

    pause() {
        if (!this._playing) return;
        this._playing = false;
        if (this._animId) {
            cancelAnimationFrame(this._animId);
            this._animId = null;
        }
        this._lastTimestamp = null;
        this._emit('pause');
    }

    seek(time) {
        const timeMs = Math.max(0, Math.min(time * 1000, this._totalDuration));
        this._currentTime = timeMs;

        const targetFrame = this._getFrameAtTime(timeMs);
        this._showFrame(targetFrame);

        this._emit('timeupdate', { currentTime: this.currentTime, duration: this.duration });
    }

    seekPercent(pct) {
        this.seek((pct * this._totalDuration) / 1000);
    }

    setSpeed(rate) {
        super.setSpeed(rate);
    }

    stepFrame(direction) {
        const wasPlaying = this._playing;
        if (wasPlaying) this.pause();

        let targetFrame;
        if (direction === 'next') {
            targetFrame = this._currentFrame + 1;
            if (targetFrame >= this._frames.length) {
                if (this._loop) targetFrame = 0;
                else return;
            }
        } else {
            targetFrame = this._currentFrame - 1;
            if (targetFrame < 0) {
                if (this._loop) targetFrame = this._frames.length - 1;
                else return;
            }
        }

        // Update currentTime to match the new frame position
        this._currentTime = targetFrame > 0 ? this._frameTimeline[targetFrame - 1] : 0;

        this._showFrame(targetFrame);

        this._emit('timeupdate', { currentTime: this.currentTime, duration: this.duration });
    }

    get currentTime() { return this._currentTime / 1000; } // return seconds
    get duration() { return this._totalDuration / 1000; } // return seconds
    get isPlaying() { return this._playing; }
    get hasAudio() { return false; }
    get mediaType() { return this._format; } // 'gif' or 'webp'

    get frameCount() { return this._frames.length; }
    get currentFrameIndex() { return this._currentFrame; }
    get gifWidth() { return this._gifWidth; }
    get gifHeight() { return this._gifHeight; }

    /**
     * Return the composited canvas for frame `i`, materializing it on demand.
     * Callers should NOT hold long references — in windowed mode the canvas
     * may be evicted. Copy via drawImage() if you need persistence.
     */
    getFrameAtIndex(i) {
        if (i < 0 || i >= this._frames.length) return null;
        if (!this._composited[i]) {
            if (this._useWindow) this._ensureWindowAround(i);
            else this._preRenderRange(this._preRenderedUpTo + 1, i + 1);
        }
        return this._composited[i] || null;
    }

    /** End timestamp (seconds) of frame `i`. */
    getTimestampAtFrame(i) {
        if (i < 0 || i >= this._frameTimeline.length) return 0;
        return (this._frameTimeline[i] || 0) / 1000;
    }

    /** Resolve a frame index for a given time in seconds. */
    getFrameIndexAtTime(seconds) {
        return this._getFrameAtTime(Math.max(0, seconds) * 1000);
    }

    destroy() {
        this.pause();
        this._frames = [];
        this._composited = [];
        this._keyframes = [];
        this._compositedCount = 0;
        this._frameTimeline = [];
        this._tempCanvas = null;
        this._tempCtx = null;
        super.destroy();
    }
}

// ==================== CONTROL BAR MANAGER ====================

/**
 * Manages the custom control bar UI and binds it to a MediaPlaybackController.
 */
class MediaControlBar {
    constructor(containerEl) {
        this._container = containerEl;
        this._controller = null;
        this._hideTimer = null;
        this._isDragging = false;
        this._isHoveringControls = false;
        this._isVisible = true;
        this._hideDelay = parseInt(localStorage.getItem('controlBarHideDelay')) || 3000;

        // Cache DOM references
        this._playBtn = containerEl.querySelector('.mc-play-btn');
        this._seekBar = containerEl.querySelector('.mc-seek-bar');
        this._seekFill = containerEl.querySelector('.mc-seek-fill');
        this._seekHandle = containerEl.querySelector('.mc-seek-handle');
        this._seekBuffered = containerEl.querySelector('.mc-seek-buffered');
        this._timeDisplay = containerEl.querySelector('.mc-time');
        this._speedBtn = containerEl.querySelector('.mc-speed-btn');
        this._loopBtn = containerEl.querySelector('.mc-loop-btn');
        this._repeatBtn = containerEl.querySelector('.mc-repeat-btn');
        this._framePrevBtn = containerEl.querySelector('.mc-frame-prev');
        this._frameNextBtn = containerEl.querySelector('.mc-frame-next');
        this._volumeBtn = containerEl.querySelector('.mc-volume-btn');
        this._volumeSlider = containerEl.querySelector('.mc-volume-slider');
        this._volumeGroup = containerEl.querySelector('.mc-volume-group');
        this._saveFrameBtn = containerEl.querySelector('.mc-save-frame');
        this._trimBtn = containerEl.querySelector('.mc-trim-btn');

        try {
            const customSpeeds = JSON.parse(localStorage.getItem('playbackSpeeds'));
            this._speedValues = Array.isArray(customSpeeds) && customSpeeds.length ? customSpeeds.sort((a,b) => a - b) : [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
        } catch { this._speedValues = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]; }
        this._speedIndex = 3; // 1x

        this._bindEvents();
    }

    _bindEvents() {
        // Play/pause
        this._playBtn?.addEventListener('click', () => this._controller?.togglePlay());

        // Seek bar click
        this._seekBar?.addEventListener('mousedown', (e) => this._startSeek(e));

        // Frame step buttons
        this._framePrevBtn?.addEventListener('click', () => this._controller?.stepFrame('prev'));
        this._frameNextBtn?.addEventListener('click', () => this._controller?.stepFrame('next'));

        // Speed button
        this._speedBtn?.addEventListener('click', () => this._cycleSpeed());

        // Loop button
        this._loopBtn?.addEventListener('click', () => this._toggleLoop());

        // Repeat button
        this._repeatBtn?.addEventListener('click', () => this._toggleRepeat());

        // Save frame button (E key; Shift+E for dialog)
        this._saveFrameBtn?.addEventListener('click', (e) => {
            if (typeof window.saveCurrentFrame === 'function') {
                window.saveCurrentFrame(e.shiftKey);
            }
        });

        // Trim button (Ctrl+E): export loop-marked range via ffmpeg
        this._trimBtn?.addEventListener('click', () => {
            if (typeof window.exportTrim === 'function') window.exportTrim();
        });

        // Volume button (mute toggle)
        this._volumeBtn?.addEventListener('click', () => {
            if (this._controller) {
                this._controller.setMuted(!this._controller.getMuted());
            }
        });

        // Volume slider
        this._volumeSlider?.addEventListener('input', (e) => {
            if (this._controller) {
                const val = parseFloat(e.target.value) / 100;
                this._controller.setVolume(val);
                this._controller.setMuted(val === 0);
            }
        });

        // Auto-hide: mouse move on lightbox shows controls, resets timer
        // Use dead-zone to avoid flickering on micro mouse movements
        this._lastMouseX = 0;
        this._lastMouseY = 0;
        this._mouseMoveHandler = (e) => {
            const dx = e.clientX - this._lastMouseX;
            const dy = e.clientY - this._lastMouseY;
            if (dx * dx + dy * dy > 100) { // >10px movement
                this._lastMouseX = e.clientX;
                this._lastMouseY = e.clientY;
                this._showControls();
            }
        };
        this._mouseLeaveHandler = () => this._startHideTimer();

        // Keep controls visible while cursor is over them
        this._container.addEventListener('mouseenter', () => {
            this._isHoveringControls = true;
            this._stopHideTimer();
        });
        this._container.addEventListener('mouseleave', () => {
            this._isHoveringControls = false;
            this._startHideTimer();
        });
    }

    bind(controller) {
        // Unbind previous
        this.unbind();

        this._controller = controller;

        // Set up event listeners
        controller.on('timeupdate', () => this._updateProgress());
        controller.on('play', () => this._updatePlayState());
        controller.on('pause', () => this._updatePlayState());
        controller.on('ended', () => this._updatePlayState());
        controller.on('loadedmetadata', () => this._updateProgress());
        controller.on('volumechange', () => this._updateVolumeUI());

        // Initialize UI state
        this._updatePlayState();
        this._updateProgress();
        this._updateSpeedUI();
        this._updateLoopUI();
        this._updateRepeatUI();
        this._updateVolumeUI();

        // Show/hide volume controls based on media type
        if (this._volumeGroup) {
            this._volumeGroup.style.display = controller.hasAudio ? '' : 'none';
        }

        // Show/hide trim button: only for moving media (video / animated)
        if (this._trimBtn) {
            const mt = controller.mediaType;
            this._trimBtn.style.display = (mt === 'video' || mt === 'gif' || mt === 'webp') ? '' : 'none';
        }

        // Show controls
        this._container.style.display = 'flex';
        this._showControls();
    }

    unbind() {
        if (this._controller) {
            this._controller.off('timeupdate');
            this._controller.off('play');
            this._controller.off('pause');
            this._controller.off('ended');
            this._controller.off('loadedmetadata');
            this._controller.off('volumechange');
            this._controller = null;
        }
        this._stopHideTimer();
    }

    hide() {
        this._container.style.display = 'none';
        this._stopHideTimer();
    }

    // --- Seek bar ---

    _startSeek(e) {
        e.preventDefault();
        this._isDragging = true;
        this._seekRafPending = false;
        this._performSeek(e);

        const moveHandler = (ev) => {
            // Throttle to RAF to avoid redundant seeks between screen refreshes
            this._pendingSeekEvent = ev;
            if (!this._seekRafPending) {
                this._seekRafPending = true;
                requestAnimationFrame(() => {
                    this._seekRafPending = false;
                    if (this._pendingSeekEvent) {
                        this._performSeek(this._pendingSeekEvent);
                        this._pendingSeekEvent = null;
                    }
                });
            }
        };
        const upHandler = () => {
            this._isDragging = false;
            this._pendingSeekEvent = null;
            document.removeEventListener('mousemove', moveHandler);
            document.removeEventListener('mouseup', upHandler);
        };

        document.addEventListener('mousemove', moveHandler);
        document.addEventListener('mouseup', upHandler);
    }

    _performSeek(e) {
        if (!this._controller || !this._seekBar) return;
        const rect = this._seekBar.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        this._controller.seekPercent(pct);
    }

    // --- UI updates ---

    _updateProgress() {
        if (!this._controller) return;
        const pct = this._controller.progress * 100;
        if (this._seekFill) this._seekFill.style.width = pct + '%';
        if (this._seekHandle) this._seekHandle.style.left = pct + '%';
        if (this._timeDisplay) {
            this._timeDisplay.textContent = `${formatTime(this._controller.currentTime)} / ${formatTime(this._controller.duration)}`;
        }
    }

    _updatePlayState() {
        if (!this._controller || !this._playBtn) return;
        const playing = this._controller.isPlaying;
        this._playBtn.setAttribute('data-state', playing ? 'playing' : 'paused');
        this._playBtn.title = playing ? 'Pause' : 'Play';
        // Update SVG icon
        if (playing) {
            this._playBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
        } else {
            this._playBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
        }
    }

    /** Reload speed values from localStorage (called when user changes playback speed options) */
    reloadSpeeds() {
        try {
            const customSpeeds = JSON.parse(localStorage.getItem('playbackSpeeds'));
            if (Array.isArray(customSpeeds) && customSpeeds.length) {
                this._speedValues = customSpeeds.sort((a, b) => a - b);
            }
        } catch { /* keep current */ }
        // Re-sync index to current speed
        if (this._controller) {
            const cur = this._controller.getSpeed();
            this._speedIndex = this._speedValues.indexOf(cur);
            if (this._speedIndex < 0) this._speedIndex = this._speedValues.indexOf(1) || 0;
        }
    }

    _cycleSpeed() {
        // Re-read speeds in case they changed
        this.reloadSpeeds();
        this._speedIndex = (this._speedIndex + 1) % this._speedValues.length;
        const speed = this._speedValues[this._speedIndex];
        if (this._controller) this._controller.setSpeed(speed);
        this._updateSpeedUI();
    }

    _updateSpeedUI() {
        if (!this._speedBtn) return;
        const speed = this._controller ? this._controller.getSpeed() : 1;
        this._speedBtn.textContent = speed + 'x';
        // Update speedIndex to match
        const idx = this._speedValues.indexOf(speed);
        if (idx >= 0) this._speedIndex = idx;
    }

    _toggleLoop() {
        if (!this._controller) return;
        this._controller.setLoop(!this._controller.getLoop());
        this._updateLoopUI();
    }

    _updateLoopUI() {
        if (!this._loopBtn) return;
        const active = this._controller ? this._controller.getLoop() : false;
        this._loopBtn.classList.toggle('mc-active', active);
        this._loopBtn.title = active ? 'Loop: On' : 'Loop: Off';
    }

    _toggleRepeat() {
        if (!this._controller) return;
        this._controller.setRepeat(!this._controller.getRepeat());
        this._updateRepeatUI();
    }

    _updateRepeatUI() {
        if (!this._repeatBtn) return;
        const active = this._controller ? this._controller.getRepeat() : false;
        this._repeatBtn.classList.toggle('mc-active', active);
        this._repeatBtn.title = active ? 'Repeat: On' : 'Repeat: Off';
    }

    _updateVolumeUI() {
        if (!this._controller) return;
        const muted = this._controller.getMuted();
        const volume = this._controller.getVolume();

        if (this._volumeSlider) {
            this._volumeSlider.value = muted ? 0 : Math.round(volume * 100);
        }
        if (this._volumeBtn) {
            if (muted || volume === 0) {
                this._volumeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
            } else if (volume < 0.5) {
                this._volumeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
            } else {
                this._volumeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
            }
        }
    }

    // --- Auto-hide ---

    _showControls() {
        if (!this._isVisible) {
            this._isVisible = true;
            this._container.classList.remove('mc-hidden');
        }
        this._startHideTimer();
    }

    _startHideTimer() {
        this._stopHideTimer();
        this._hideTimer = setTimeout(() => {
            // Don't hide while dragging or paused
            if (!this._isDragging && !this._isHoveringControls && this._controller?.isPlaying) {
                this._isVisible = false;
                this._container.classList.add('mc-hidden');
            }
        }, this._hideDelay);
    }

    _stopHideTimer() {
        if (this._hideTimer) {
            clearTimeout(this._hideTimer);
            this._hideTimer = null;
        }
    }

    /** Call from the lightbox to wire up mouse move/leave for auto-hide */
    attachAutoHide(lightboxEl) {
        lightboxEl.addEventListener('mousemove', this._mouseMoveHandler);
        lightboxEl.addEventListener('mouseleave', this._mouseLeaveHandler);
        this._autoHideEl = lightboxEl;
    }

    detachAutoHide() {
        if (this._autoHideEl) {
            this._autoHideEl.removeEventListener('mousemove', this._mouseMoveHandler);
            this._autoHideEl.removeEventListener('mouseleave', this._mouseLeaveHandler);
            this._autoHideEl = null;
        }
    }

    /** Sync speed/loop/repeat from external state (e.g., persisted settings) */
    syncState(opts) {
        if (opts.speed !== undefined && this._controller) {
            this._controller.setSpeed(opts.speed);
            this._updateSpeedUI();
        }
        if (opts.loop !== undefined && this._controller) {
            this._controller.setLoop(opts.loop);
            this._updateLoopUI();
        }
        if (opts.repeat !== undefined && this._controller) {
            this._controller.setRepeat(opts.repeat);
            this._updateRepeatUI();
        }
    }

    destroy() {
        this.unbind();
        this.detachAutoHide();
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MediaPlaybackController, VideoPlaybackController, AnimatedImagePlaybackController, MediaControlBar };
}
