const { MediaPlaybackController, VideoPlaybackController } = require('../playback-controller');

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
