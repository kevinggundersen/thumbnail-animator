/**
 * Unified media playback controllers for the lightbox.
 *
 * MediaPlaybackController — abstract interface
 * VideoPlaybackController — wraps HTMLVideoElement
 * GifPlaybackController  — decodes GIF frames to canvas via gifuct-js
 */

// ==================== BASE CONTROLLER ====================

class MediaPlaybackController {
    constructor() {
        this._listeners = {};
        this._speed = 1;
        this._loop = false;
        this._repeat = false;
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
        this._timeupdateHandler = () => this._emit('timeupdate', { currentTime: this.currentTime, duration: this.duration });
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
        this._video.loop = val;
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

// ==================== GIF CONTROLLER ====================

class GifPlaybackController extends MediaPlaybackController {
    /**
     * @param {HTMLCanvasElement} canvas — canvas element to render frames to
     * @param {ArrayBuffer} gifBuffer — raw GIF file bytes
     */
    constructor(canvas, gifBuffer) {
        super();
        this._canvas = canvas;
        this._ctx = canvas.getContext('2d');
        this._frames = [];
        this._composited = []; // pre-rendered offscreen canvases for GPU-accelerated draw
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

        this._decode(gifBuffer);
    }

    _decode(buffer) {
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

            // Pre-render all frames into composited snapshots for instant seeking
            this._preRenderFrames();

            // Show first frame
            this._showFrame(0);
            this._emit('loadedmetadata', { duration: this.duration });
        } catch (err) {
            console.error('GIF decode error:', err);
        }
    }

    /** Pre-composite every frame into offscreen canvases for GPU-accelerated drawing */
    _preRenderFrames() {
        this._tempCtx.clearRect(0, 0, this._gifWidth, this._gifHeight);
        this._composited = new Array(this._frames.length);
        for (let i = 0; i < this._frames.length; i++) {
            const frame = this._frames[i];
            const { dims, patch, disposalType } = frame;

            if (disposalType === 2) {
                this._tempCtx.clearRect(0, 0, this._gifWidth, this._gifHeight);
            }

            const imageData = new ImageData(patch, dims.width, dims.height);
            this._tempCtx.putImageData(imageData, dims.left, dims.top);

            // Snapshot into an offscreen canvas (drawImage is GPU-accelerated, putImageData is not)
            const snap = document.createElement('canvas');
            snap.width = this._gifWidth;
            snap.height = this._gifHeight;
            snap.getContext('2d').drawImage(this._tempCanvas, 0, 0);
            this._composited[i] = snap;
        }
    }

    /** Display a pre-composited frame instantly via GPU-accelerated drawImage */
    _showFrame(index) {
        if (index < 0 || index >= this._composited.length) return;
        this._ctx.drawImage(this._composited[index], 0, 0);
        this._currentFrame = index;
    }

    _animate(timestamp) {
        if (!this._playing) return;

        if (this._lastTimestamp === null) {
            this._lastTimestamp = timestamp;
        }

        const delta = (timestamp - this._lastTimestamp) * this._speed;
        this._lastTimestamp = timestamp;
        this._currentTime += delta;

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
        for (let i = 0; i < this._frameTimeline.length; i++) {
            if (timeMs < this._frameTimeline[i]) return i;
        }
        return this._frames.length - 1;
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
    get mediaType() { return 'gif'; }

    get frameCount() { return this._frames.length; }
    get currentFrameIndex() { return this._currentFrame; }
    get gifWidth() { return this._gifWidth; }
    get gifHeight() { return this._gifHeight; }

    destroy() {
        this.pause();
        this._frames = [];
        this._composited = [];
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
        this._isVisible = true;
        this._hideDelay = 3000;

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

        this._speedValues = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
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
        this._mouseMoveHandler = () => this._showControls();
        this._mouseLeaveHandler = () => this._startHideTimer();
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

    _cycleSpeed() {
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
            if (!this._isDragging && this._controller?.isPlaying) {
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
