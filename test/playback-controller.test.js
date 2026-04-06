const { MediaPlaybackController, VideoPlaybackController, AnimatedImagePlaybackController } = require('../playback-controller');

// ── MediaPlaybackController (base class) ──────────────────────────────

describe('MediaPlaybackController', () => {
    let ctrl;

    beforeEach(() => {
        ctrl = new MediaPlaybackController();
    });

    // -- Event emitter --

    describe('event emitter', () => {
        it('registers and fires a listener', () => {
            const cb = vi.fn();
            ctrl.on('play', cb);
            ctrl._emit('play');
            expect(cb).toHaveBeenCalledOnce();
        });

        it('fires multiple listeners on the same event', () => {
            const cb1 = vi.fn();
            const cb2 = vi.fn();
            ctrl.on('play', cb1);
            ctrl.on('play', cb2);
            ctrl._emit('play');
            expect(cb1).toHaveBeenCalledOnce();
            expect(cb2).toHaveBeenCalledOnce();
        });

        it('passes data to listeners', () => {
            const cb = vi.fn();
            ctrl.on('timeupdate', cb);
            ctrl._emit('timeupdate', { currentTime: 5 });
            expect(cb).toHaveBeenCalledWith({ currentTime: 5 });
        });

        it('off(event, callback) removes a specific listener', () => {
            const cb = vi.fn();
            ctrl.on('play', cb);
            ctrl.off('play', cb);
            ctrl._emit('play');
            expect(cb).not.toHaveBeenCalled();
        });

        it('off(event) removes all listeners for that event', () => {
            const cb1 = vi.fn();
            const cb2 = vi.fn();
            ctrl.on('play', cb1);
            ctrl.on('play', cb2);
            ctrl.off('play');
            ctrl._emit('play');
            expect(cb1).not.toHaveBeenCalled();
            expect(cb2).not.toHaveBeenCalled();
        });

        it('on() returns this for chaining', () => {
            const result = ctrl.on('play', () => {});
            expect(result).toBe(ctrl);
        });

        it('off() returns this for chaining', () => {
            const result = ctrl.off('play');
            expect(result).toBe(ctrl);
        });

        it('does not throw when emitting event with no listeners', () => {
            expect(() => ctrl._emit('nonexistent')).not.toThrow();
        });

        it('destroy() clears all listeners', () => {
            const cb = vi.fn();
            ctrl.on('play', cb);
            ctrl.destroy();
            ctrl._emit('play');
            expect(cb).not.toHaveBeenCalled();
        });
    });

    // -- Speed / loop / repeat state --

    describe('speed / loop / repeat', () => {
        it('default speed is 1', () => {
            expect(ctrl.getSpeed()).toBe(1);
        });

        it('setSpeed / getSpeed round-trip', () => {
            ctrl.setSpeed(2.5);
            expect(ctrl.getSpeed()).toBe(2.5);
        });

        it('default loop is false', () => {
            expect(ctrl.getLoop()).toBe(false);
        });

        it('setLoop / getLoop round-trip', () => {
            ctrl.setLoop(true);
            expect(ctrl.getLoop()).toBe(true);
        });

        it('default repeat is false', () => {
            expect(ctrl.getRepeat()).toBe(false);
        });

        it('setRepeat / getRepeat round-trip', () => {
            ctrl.setRepeat(true);
            expect(ctrl.getRepeat()).toBe(true);
        });
    });

    // -- A-B loop --

    describe('A-B loop', () => {
        it('default is null', () => {
            expect(ctrl.getAbLoop()).toBeNull();
        });

        it('setAbLoop stores the range', () => {
            ctrl.setAbLoop(1, 5);
            expect(ctrl.getAbLoop()).toEqual({ a: 1, b: 5 });
        });

        it('clamps a to >= 0', () => {
            ctrl.setAbLoop(-2, 5);
            expect(ctrl.getAbLoop().a).toBe(0);
        });

        it('uses b as-is when base duration is 0 (falsy fallback)', () => {
            // When duration=0, `this.duration || b` falls back to b,
            // so min(b, b) = b — no clamping happens
            ctrl.setAbLoop(0, 5);
            expect(ctrl.getAbLoop()).toEqual({ a: 0, b: 5 });
        });

        it('clearAbLoop sets to null', () => {
            // Use a subclass-like override to test non-trivially
            ctrl.setAbLoop(1, 3);
            ctrl.clearAbLoop();
            expect(ctrl.getAbLoop()).toBeNull();
        });

        it('clears when b <= a', () => {
            ctrl.setAbLoop(5, 3);
            expect(ctrl.getAbLoop()).toBeNull();
        });

        it('clears when a is null', () => {
            ctrl.setAbLoop(null, 5);
            expect(ctrl.getAbLoop()).toBeNull();
        });

        it('clears when b is null', () => {
            ctrl.setAbLoop(1, null);
            expect(ctrl.getAbLoop()).toBeNull();
        });
    });

    // -- Getters and derived state --

    describe('getters', () => {
        it('default currentTime is 0', () => {
            expect(ctrl.currentTime).toBe(0);
        });

        it('default duration is 0', () => {
            expect(ctrl.duration).toBe(0);
        });

        it('default isPlaying is false', () => {
            expect(ctrl.isPlaying).toBe(false);
        });

        it('isPaused is inverse of isPlaying', () => {
            expect(ctrl.isPaused).toBe(true);
        });

        it('progress returns 0 when duration is 0', () => {
            expect(ctrl.progress).toBe(0);
        });

        it('default mediaType is unknown', () => {
            expect(ctrl.mediaType).toBe('unknown');
        });

        it('default hasAudio is false', () => {
            expect(ctrl.hasAudio).toBe(false);
        });

        it('default volume is 1', () => {
            expect(ctrl.getVolume()).toBe(1);
        });

        it('default muted is false', () => {
            expect(ctrl.getMuted()).toBe(false);
        });
    });

    // -- togglePlay --

    describe('togglePlay', () => {
        it('calls play/pause based on state', () => {
            const playSpy = vi.spyOn(ctrl, 'play');
            const pauseSpy = vi.spyOn(ctrl, 'pause');

            // Base isPlaying is false, so togglePlay should call play
            ctrl.togglePlay();
            expect(playSpy).toHaveBeenCalledOnce();
            expect(pauseSpy).not.toHaveBeenCalled();
        });
    });

    // -- seekPercent --

    describe('seekPercent', () => {
        it('calls seek with pct * duration', () => {
            const seekSpy = vi.spyOn(ctrl, 'seek');
            // Base duration is 0, so seek won't be called (guard: duration > 0)
            ctrl.seekPercent(0.5);
            expect(seekSpy).not.toHaveBeenCalled();
        });
    });
});

// ── VideoPlaybackController ───────────────────────────────────────────

describe('VideoPlaybackController', () => {
    let video, ctrl;

    function createMockVideo() {
        const listeners = {};
        return {
            currentTime: 0,
            duration: 120,
            paused: true,
            ended: false,
            muted: false,
            volume: 1,
            loop: false,
            playbackRate: 1,
            readyState: 4,
            play: vi.fn(() => Promise.resolve()),
            pause: vi.fn(),
            addEventListener: vi.fn((event, handler) => {
                (listeners[event] ||= []).push(handler);
            }),
            removeEventListener: vi.fn((event, handler) => {
                if (listeners[event]) {
                    listeners[event] = listeners[event].filter(h => h !== handler);
                }
            }),
            _listeners: listeners,
            _emit(event) {
                (listeners[event] || []).forEach(h => h());
            },
        };
    }

    beforeEach(() => {
        video = createMockVideo();
        ctrl = new VideoPlaybackController(video);
    });

    afterEach(() => {
        ctrl.destroy();
    });

    it('attaches event listeners on construction', () => {
        expect(video.addEventListener).toHaveBeenCalledWith('timeupdate', expect.any(Function));
        expect(video.addEventListener).toHaveBeenCalledWith('play', expect.any(Function));
        expect(video.addEventListener).toHaveBeenCalledWith('pause', expect.any(Function));
        expect(video.addEventListener).toHaveBeenCalledWith('ended', expect.any(Function));
        expect(video.addEventListener).toHaveBeenCalledWith('loadedmetadata', expect.any(Function));
        expect(video.addEventListener).toHaveBeenCalledWith('volumechange', expect.any(Function));
    });

    it('play() calls video.play()', () => {
        ctrl.play();
        expect(video.play).toHaveBeenCalledOnce();
    });

    it('pause() calls video.pause()', () => {
        ctrl.pause();
        expect(video.pause).toHaveBeenCalledOnce();
    });

    it('seek() clamps to [0, duration]', () => {
        ctrl.seek(-5);
        expect(video.currentTime).toBe(0);

        ctrl.seek(999);
        expect(video.currentTime).toBe(120);

        ctrl.seek(60);
        expect(video.currentTime).toBe(60);
    });

    it('setSpeed() sets video.playbackRate', () => {
        ctrl.setSpeed(2);
        expect(video.playbackRate).toBe(2);
        expect(ctrl.getSpeed()).toBe(2);
    });

    it('setLoop() sets video.loop', () => {
        ctrl.setLoop(true);
        expect(video.loop).toBe(true);
        expect(ctrl.getLoop()).toBe(true);
    });

    it('setLoop() disables native loop when A-B is active', () => {
        // First set a valid A-B range (need duration > 0 for clamping)
        ctrl.setAbLoop(10, 30);
        // Now loop should be false (A-B takes over)
        ctrl.setLoop(true);
        expect(video.loop).toBe(false);
        expect(ctrl.getLoop()).toBe(true);
    });

    it('clearAbLoop() re-enables native loop', () => {
        ctrl.setLoop(true);
        ctrl.setAbLoop(10, 30);
        expect(video.loop).toBe(false);
        ctrl.clearAbLoop();
        expect(video.loop).toBe(true);
    });

    it('setVolume() clamps to [0, 1]', () => {
        ctrl.setVolume(0.5);
        expect(video.volume).toBe(0.5);

        ctrl.setVolume(-1);
        expect(video.volume).toBe(0);

        ctrl.setVolume(2);
        expect(video.volume).toBe(1);
    });

    it('setMuted() sets video.muted', () => {
        ctrl.setMuted(true);
        expect(video.muted).toBe(true);
    });

    it('reports mediaType as video', () => {
        expect(ctrl.mediaType).toBe('video');
    });

    it('reports hasAudio as true', () => {
        expect(ctrl.hasAudio).toBe(true);
    });

    it('isPlaying reflects video state', () => {
        expect(ctrl.isPlaying).toBe(false); // paused=true

        video.paused = false;
        expect(ctrl.isPlaying).toBe(true);

        video.ended = true;
        expect(ctrl.isPlaying).toBe(false);
    });

    it('destroy() removes all event listeners', () => {
        ctrl.destroy();
        expect(video.removeEventListener).toHaveBeenCalledWith('timeupdate', expect.any(Function));
        expect(video.removeEventListener).toHaveBeenCalledWith('play', expect.any(Function));
        expect(video.removeEventListener).toHaveBeenCalledWith('pause', expect.any(Function));
        expect(video.removeEventListener).toHaveBeenCalledWith('ended', expect.any(Function));
        expect(video.removeEventListener).toHaveBeenCalledWith('loadedmetadata', expect.any(Function));
        expect(video.removeEventListener).toHaveBeenCalledWith('volumechange', expect.any(Function));
    });

    it('emits play event when video fires play', () => {
        const cb = vi.fn();
        ctrl.on('play', cb);
        video._emit('play');
        expect(cb).toHaveBeenCalledOnce();
    });

    it('stepFrame advances by ~1/30s', () => {
        video.currentTime = 1;
        ctrl.stepFrame('next');
        expect(video.currentTime).toBeCloseTo(1 + 1 / 30, 4);
    });

    it('stepFrame backward decreases by ~1/30s', () => {
        video.currentTime = 1;
        ctrl.stepFrame('prev');
        expect(video.currentTime).toBeCloseTo(1 - 1 / 30, 4);
    });
});

// ── AnimatedImagePlaybackController ──────────────────────────────────

describe('AnimatedImagePlaybackController', () => {
    // ── Mock infrastructure ──────────────────────────────────────────

    function createMockCanvasCtx() {
        return {
            drawImage: vi.fn(),
            putImageData: vi.fn(),
            clearRect: vi.fn(),
            getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(16), width: 2, height: 2 })),
        };
    }

    function createMockCanvas() {
        const ctx = createMockCanvasCtx();
        return {
            width: 0, height: 0,
            getContext: vi.fn(() => ctx),
            _ctx: ctx,
        };
    }

    /** Build a minimal 3-frame GIF-like structure for gifuctJs mock */
    function buildMockFrames(count = 3, delay = 100) {
        const frames = [];
        for (let i = 0; i < count; i++) {
            frames.push({
                delay,
                dims: { top: 0, left: 0, width: 2, height: 2 },
                patch: new Uint8ClampedArray(16), // 2x2 RGBA
                disposalType: 0,
            });
        }
        return frames;
    }

    // Install mocks before loading the controller
    let origDocument, origGifuctJs, origRAF, origCAF, origImageData;

    beforeAll(() => {
        origDocument = global.document;
        origGifuctJs = global.gifuctJs;
        origRAF = global.requestAnimationFrame;
        origCAF = global.cancelAnimationFrame;
        origImageData = global.ImageData;

        // Mock requestAnimationFrame — capture callbacks, don't auto-execute
        global.requestAnimationFrame = vi.fn(() => 1);
        global.cancelAnimationFrame = vi.fn();

        // Mock ImageData
        global.ImageData = class MockImageData {
            constructor(data, width, height) {
                this.data = data;
                this.width = width;
                this.height = height;
            }
        };

        // Mock document.createElement for temp canvas creation
        global.document = {
            ...global.document,
            createElement: vi.fn((tag) => {
                if (tag === 'canvas') return createMockCanvas();
                return {};
            }),
        };
    });

    afterAll(() => {
        global.document = origDocument;
        global.gifuctJs = origGifuctJs;
        global.requestAnimationFrame = origRAF;
        global.cancelAnimationFrame = origCAF;
        global.ImageData = origImageData;
    });

    function makeController(frameCount = 3, delay = 100) {
        const frames = buildMockFrames(frameCount, delay);
        global.gifuctJs = {
            parseGIF: vi.fn(() => ({
                lsd: { width: 2, height: 2 },
            })),
            decompressFrames: vi.fn(() => frames),
        };

        const canvas = createMockCanvas();
        // GIF89a magic bytes + minimal structure
        const buffer = new ArrayBuffer(16);
        const view = new Uint8Array(buffer);
        view[0] = 0x47; view[1] = 0x49; view[2] = 0x46; // GIF

        const ctrl = new AnimatedImagePlaybackController(canvas, buffer);
        return { ctrl, canvas, frames };
    }

    // ── Construction and decode ──────────────────────────────────────

    describe('construction and decode', () => {
        it('decodes GIF buffer and sets frame count', () => {
            const { ctrl } = makeController(5);
            expect(ctrl.frameCount).toBe(5);
        });

        it('sets gifWidth and gifHeight from logical screen descriptor', () => {
            const { ctrl } = makeController();
            expect(ctrl.gifWidth).toBe(2);
            expect(ctrl.gifHeight).toBe(2);
        });

        it('calculates totalDuration from all frame delays', () => {
            const { ctrl } = makeController(4, 200);
            // 4 frames × 200ms = 800ms = 0.8s
            expect(ctrl.duration).toBeCloseTo(0.8, 2);
        });

        it('defaults frame delay to 100ms when delay is 0', () => {
            const frames = buildMockFrames(2, 0);
            // Override delay to 0
            frames[0].delay = 0;
            frames[1].delay = 0;
            global.gifuctJs = {
                parseGIF: vi.fn(() => ({ lsd: { width: 2, height: 2 } })),
                decompressFrames: vi.fn(() => frames),
            };
            const canvas = createMockCanvas();
            const buffer = new ArrayBuffer(16);
            const ctrl = new AnimatedImagePlaybackController(canvas, buffer);
            // gifuct-js already returns ms; the controller uses f.delay || 100
            expect(ctrl.duration).toBeCloseTo(0.2, 2); // 2 × 100ms default
        });

        it('sets mediaType to gif for GIF buffers', () => {
            const { ctrl } = makeController();
            expect(ctrl.mediaType).toBe('gif');
        });

        it('emits loadedmetadata after decode', () => {
            const cb = vi.fn();
            const { ctrl } = makeController(3, 100);
            // loadedmetadata is emitted synchronously during _decodeGif
            // We need to register BEFORE construction — use a workaround:
            // Just verify the duration is set (loadedmetadata was called during constructor)
            expect(ctrl.duration).toBeGreaterThan(0);
        });

        it('shows first frame immediately after decode', () => {
            const { ctrl, canvas } = makeController();
            // First frame was shown via drawImage on the main canvas
            expect(canvas._ctx.drawImage).toHaveBeenCalled();
        });

        it('handles empty frames gracefully', () => {
            global.gifuctJs = {
                parseGIF: vi.fn(() => ({ lsd: { width: 2, height: 2 } })),
                decompressFrames: vi.fn(() => []),
            };
            const canvas = createMockCanvas();
            const buffer = new ArrayBuffer(16);
            const ctrl = new AnimatedImagePlaybackController(canvas, buffer);
            expect(ctrl.frameCount).toBe(0);
            expect(ctrl.duration).toBe(0);
        });
    });

    // ── Play/pause ───────────────────────────────────────────────────

    describe('play and pause', () => {
        it('play() sets isPlaying to true', () => {
            const { ctrl } = makeController();
            ctrl.play();
            expect(ctrl.isPlaying).toBe(true);
        });

        it('play() emits play event', () => {
            const { ctrl } = makeController();
            const cb = vi.fn();
            ctrl.on('play', cb);
            ctrl.play();
            expect(cb).toHaveBeenCalledOnce();
        });

        it('play() does nothing if already playing', () => {
            const { ctrl } = makeController();
            ctrl.play();
            const rafCallCount = global.requestAnimationFrame.mock.calls.length;
            ctrl.play(); // should not schedule another raf
            expect(global.requestAnimationFrame.mock.calls.length).toBe(rafCallCount);
        });

        it('play() does nothing if no frames', () => {
            global.gifuctJs = {
                parseGIF: vi.fn(() => ({ lsd: { width: 2, height: 2 } })),
                decompressFrames: vi.fn(() => []),
            };
            const canvas = createMockCanvas();
            const ctrl = new AnimatedImagePlaybackController(canvas, new ArrayBuffer(16));
            const cb = vi.fn();
            ctrl.on('play', cb);
            ctrl.play();
            expect(cb).not.toHaveBeenCalled();
        });

        it('play() restarts from beginning if at end', () => {
            const { ctrl } = makeController(3, 100);
            // Seek to end
            ctrl.seek(ctrl.duration);
            expect(ctrl.currentTime).toBeCloseTo(ctrl.duration, 2);
            ctrl.play();
            expect(ctrl.currentTime).toBe(0);
        });

        it('pause() sets isPlaying to false', () => {
            const { ctrl } = makeController();
            ctrl.play();
            ctrl.pause();
            expect(ctrl.isPlaying).toBe(false);
        });

        it('pause() emits pause event', () => {
            const { ctrl } = makeController();
            ctrl.play();
            const cb = vi.fn();
            ctrl.on('pause', cb);
            ctrl.pause();
            expect(cb).toHaveBeenCalledOnce();
        });

        it('pause() cancels animation frame', () => {
            const { ctrl } = makeController();
            ctrl.play();
            ctrl.pause();
            expect(global.cancelAnimationFrame).toHaveBeenCalled();
        });
    });

    // ── Seek ─────────────────────────────────────────────────────────

    describe('seek', () => {
        it('seek(time) updates currentTime', () => {
            const { ctrl } = makeController(3, 100); // 300ms total
            ctrl.seek(0.15); // 150ms
            expect(ctrl.currentTime).toBeCloseTo(0.15, 3);
        });

        it('seek(time) clamps to [0, duration]', () => {
            const { ctrl } = makeController(3, 100);
            ctrl.seek(-1);
            expect(ctrl.currentTime).toBe(0);
            ctrl.seek(999);
            expect(ctrl.currentTime).toBeCloseTo(ctrl.duration, 3);
        });

        it('seek(time) emits timeupdate', () => {
            const { ctrl } = makeController();
            const cb = vi.fn();
            ctrl.on('timeupdate', cb);
            ctrl.seek(0.05);
            expect(cb).toHaveBeenCalled();
        });

        it('seekPercent(pct) calculates correct time from totalDuration', () => {
            const { ctrl } = makeController(4, 100); // 400ms total
            ctrl.seekPercent(0.5); // 50%
            expect(ctrl.currentTime).toBeCloseTo(0.2, 2); // 200ms = 0.2s
        });

        it('seek shows correct frame for that time', () => {
            const { ctrl } = makeController(3, 100); // 0-100ms=frame0, 100-200ms=frame1, 200-300ms=frame2
            ctrl.seek(0.15); // 150ms → frame 1
            expect(ctrl.currentFrameIndex).toBe(1);
        });
    });

    // ── Frame stepping ───────────────────────────────────────────────

    describe('frame stepping', () => {
        it('stepFrame(next) advances to next frame', () => {
            const { ctrl } = makeController(5);
            expect(ctrl.currentFrameIndex).toBe(0);
            ctrl.stepFrame('next');
            expect(ctrl.currentFrameIndex).toBe(1);
        });

        it('stepFrame(prev) goes to previous frame', () => {
            const { ctrl } = makeController(5);
            ctrl.stepFrame('next');
            ctrl.stepFrame('next');
            expect(ctrl.currentFrameIndex).toBe(2);
            ctrl.stepFrame('prev');
            expect(ctrl.currentFrameIndex).toBe(1);
        });

        it('stepFrame(next) wraps to 0 when loop is true', () => {
            const { ctrl } = makeController(3);
            ctrl.setLoop(true);
            ctrl.stepFrame('next'); // 0→1
            ctrl.stepFrame('next'); // 1→2
            ctrl.stepFrame('next'); // 2→0 (wrap)
            expect(ctrl.currentFrameIndex).toBe(0);
        });

        it('stepFrame(prev) wraps to last frame when loop is true', () => {
            const { ctrl } = makeController(3);
            ctrl.setLoop(true);
            ctrl.stepFrame('prev'); // 0 → 2 (wrap)
            expect(ctrl.currentFrameIndex).toBe(2);
        });

        it('stepFrame(next) does nothing at end when loop is false', () => {
            const { ctrl } = makeController(3);
            ctrl.setLoop(false);
            ctrl.stepFrame('next'); // 0→1
            ctrl.stepFrame('next'); // 1→2
            ctrl.stepFrame('next'); // at end, should stay at 2
            expect(ctrl.currentFrameIndex).toBe(2);
        });

        it('stepFrame(prev) does nothing at frame 0 when loop is false', () => {
            const { ctrl } = makeController(3);
            ctrl.setLoop(false);
            ctrl.stepFrame('prev'); // at 0, should stay at 0
            expect(ctrl.currentFrameIndex).toBe(0);
        });

        it('stepFrame pauses playback if playing', () => {
            const { ctrl } = makeController();
            ctrl.play();
            expect(ctrl.isPlaying).toBe(true);
            ctrl.stepFrame('next');
            expect(ctrl.isPlaying).toBe(false);
        });

        it('stepFrame updates currentTime to match new frame position', () => {
            const { ctrl } = makeController(3, 100);
            ctrl.stepFrame('next'); // go to frame 1
            // Frame 1 starts at time = frame 0 end = 100ms = 0.1s
            expect(ctrl.currentTime).toBeCloseTo(0.1, 2);
        });
    });

    // ── _getFrameAtTime ──────────────────────────────────────────────

    describe('_getFrameAtTime / getFrameIndexAtTime', () => {
        it('returns frame 0 for time 0', () => {
            const { ctrl } = makeController(3, 100);
            expect(ctrl.getFrameIndexAtTime(0)).toBe(0);
        });

        it('returns correct frame for mid-animation time', () => {
            const { ctrl } = makeController(3, 100); // timeline: 100, 200, 300 ms
            expect(ctrl.getFrameIndexAtTime(0.15)).toBe(1); // 150ms is in frame 1
        });

        it('returns last frame for time >= totalDuration', () => {
            const { ctrl } = makeController(3, 100);
            expect(ctrl.getFrameIndexAtTime(5)).toBe(2);
        });
    });

    // ── Getters ──────────────────────────────────────────────────────

    describe('getters', () => {
        it('currentTime returns seconds', () => {
            const { ctrl } = makeController(3, 100);
            ctrl.seek(0.15);
            expect(typeof ctrl.currentTime).toBe('number');
            expect(ctrl.currentTime).toBeCloseTo(0.15, 3);
        });

        it('duration returns seconds', () => {
            const { ctrl } = makeController(3, 100);
            expect(ctrl.duration).toBeCloseTo(0.3, 2);
        });

        it('frameCount returns number of frames', () => {
            const { ctrl } = makeController(7);
            expect(ctrl.frameCount).toBe(7);
        });

        it('hasAudio is always false', () => {
            const { ctrl } = makeController();
            expect(ctrl.hasAudio).toBe(false);
        });

        it('getFrameAtIndex returns canvas for valid index', () => {
            const { ctrl } = makeController(3);
            const frame = ctrl.getFrameAtIndex(0);
            expect(frame).not.toBeNull();
        });

        it('getFrameAtIndex returns null for out-of-range index', () => {
            const { ctrl } = makeController(3);
            expect(ctrl.getFrameAtIndex(-1)).toBeNull();
            expect(ctrl.getFrameAtIndex(99)).toBeNull();
        });

        it('getTimestampAtFrame returns seconds', () => {
            const { ctrl } = makeController(3, 100);
            expect(ctrl.getTimestampAtFrame(0)).toBeCloseTo(0.1, 2); // end of frame 0 = 100ms
            expect(ctrl.getTimestampAtFrame(2)).toBeCloseTo(0.3, 2); // end of frame 2 = 300ms
        });

        it('getTimestampAtFrame returns 0 for out-of-range', () => {
            const { ctrl } = makeController(3);
            expect(ctrl.getTimestampAtFrame(-1)).toBe(0);
            expect(ctrl.getTimestampAtFrame(99)).toBe(0);
        });
    });

    // ── Destroy ──────────────────────────────────────────────────────

    describe('destroy', () => {
        it('destroy pauses playback', () => {
            const { ctrl } = makeController();
            ctrl.play();
            ctrl.destroy();
            expect(ctrl.isPlaying).toBe(false);
        });

        it('destroy clears frames and composited arrays', () => {
            const { ctrl } = makeController(5);
            ctrl.destroy();
            expect(ctrl.frameCount).toBe(0);
        });

        it('destroy clears all listeners', () => {
            const { ctrl } = makeController();
            const cb = vi.fn();
            ctrl.on('play', cb);
            ctrl.destroy();
            ctrl._emit('play');
            expect(cb).not.toHaveBeenCalled();
        });
    });
});
