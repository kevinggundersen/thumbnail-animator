/**
 * Tests for filmstrip-scrubber.js
 *
 * Strategy: mock DOM elements and globals (_lbFormatTime, loopPoints, syncAbLoop,
 * requestAnimationFrame), then test the math-heavy methods.
 */

// ── Mock globals needed by FilmstripScrubber ─────────────────────────────────

global._lbFormatTime = vi.fn((t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`);
global.loopPoints = { in: null, out: null };
global.syncAbLoop = vi.fn();
global.requestAnimationFrame = vi.fn(() => 1);
global.cancelAnimationFrame = vi.fn();

// ── DOM mock factory ─────────────────────────────────────────────────────────

function createMockElement(overrides = {}) {
    const listeners = {};
    return {
        style: {},
        hidden: false,
        innerHTML: '',
        textContent: '',
        classList: {
            add: vi.fn((cls) => {}),
            remove: vi.fn((cls) => {}),
        },
        addEventListener: vi.fn((event, handler) => {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(handler);
        }),
        removeEventListener: vi.fn(),
        querySelector: vi.fn(() => createMockElement()),
        appendChild: vi.fn(),
        getBoundingClientRect: vi.fn(() => ({ left: 0, top: 0, width: 1000, height: 40 })),
        getContext: vi.fn(() => ({
            drawImage: vi.fn(),
            clearRect: vi.fn(),
        })),
        _listeners: listeners,
        ...overrides,
    };
}

function createMockRoot() {
    const elements = {
        '#lb-filmstrip-track': createMockElement(),
        '#lb-filmstrip-playhead': createMockElement(),
        '#lb-filmstrip-marker-in': createMockElement(),
        '#lb-filmstrip-marker-out': createMockElement(),
        '#lb-filmstrip-loop-range': createMockElement(),
        '#lb-filmstrip-tooltip': createMockElement(),
        '#lb-filmstrip-tooltip-canvas': createMockElement(),
        '#lb-filmstrip-tooltip-time': createMockElement(),
    };
    const root = createMockElement({
        querySelector: vi.fn((sel) => elements[sel] || createMockElement()),
    });
    return { root, elements };
}

// Mock document.createElement for _buildTiles
global.document = {
    createElement: vi.fn(() => createMockElement()),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
};

const { FilmstripScrubber, SCRUBBER_TILE_WIDTH, SCRUBBER_TILE_HEIGHT, SCRUBBER_TILE_COUNT } = require('../filmstrip-scrubber');

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockController(duration = 10, currentTime = 0) {
    const listeners = {};
    return {
        duration,
        currentTime,
        mediaType: 'video',
        frameCount: 0,
        seek: vi.fn(),
        on: vi.fn((event, cb) => { listeners[event] = cb; }),
        off: vi.fn((event, cb) => { delete listeners[event]; }),
        _listeners: listeners,
        getFrameAtIndex: vi.fn(() => null),
        getFrameIndexAtTime: vi.fn(() => 0),
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

describe('constants', () => {
    it('SCRUBBER_TILE_WIDTH is 160', () => {
        expect(SCRUBBER_TILE_WIDTH).toBe(160);
    });

    it('SCRUBBER_TILE_HEIGHT is 90', () => {
        expect(SCRUBBER_TILE_HEIGHT).toBe(90);
    });

    it('SCRUBBER_TILE_COUNT is 18', () => {
        expect(SCRUBBER_TILE_COUNT).toBe(18);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// CONSTRUCTION
// ═══════════════════════════════════════════════════════════════════════════

describe('FilmstripScrubber — construction', () => {
    it('queries DOM elements from root', () => {
        const { root } = createMockRoot();
        const scrubber = new FilmstripScrubber(root);
        expect(root.querySelector).toHaveBeenCalledWith('#lb-filmstrip-track');
        expect(root.querySelector).toHaveBeenCalledWith('#lb-filmstrip-playhead');
        expect(root.querySelector).toHaveBeenCalledWith('#lb-filmstrip-tooltip');
    });

    it('binds mouse events to track', () => {
        const { root, elements } = createMockRoot();
        const scrubber = new FilmstripScrubber(root);
        const track = elements['#lb-filmstrip-track'];
        expect(track.addEventListener).toHaveBeenCalledWith('mousedown', expect.any(Function));
        expect(track.addEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
        expect(track.addEventListener).toHaveBeenCalledWith('mouseenter', expect.any(Function));
        expect(track.addEventListener).toHaveBeenCalledWith('mouseleave', expect.any(Function));
    });

    it('sets marker cursors to ew-resize', () => {
        const { root, elements } = createMockRoot();
        const scrubber = new FilmstripScrubber(root);
        expect(elements['#lb-filmstrip-marker-in'].style.cursor).toBe('ew-resize');
        expect(elements['#lb-filmstrip-marker-out'].style.cursor).toBe('ew-resize');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// _updatePlayhead
// ═══════════════════════════════════════════════════════════════════════════

describe('FilmstripScrubber — _updatePlayhead', () => {
    it('sets playhead left% from controller currentTime/duration', () => {
        const { root, elements } = createMockRoot();
        const scrubber = new FilmstripScrubber(root);
        const controller = createMockController(10, 5);
        scrubber._controller = controller;
        scrubber._updatePlayhead();
        expect(elements['#lb-filmstrip-playhead'].style.left).toBe('50%');
    });

    it('clamps playhead to 0-100%', () => {
        const { root, elements } = createMockRoot();
        const scrubber = new FilmstripScrubber(root);
        const controller = createMockController(10, 15); // beyond duration
        scrubber._controller = controller;
        scrubber._updatePlayhead();
        expect(elements['#lb-filmstrip-playhead'].style.left).toBe('100%');
    });

    it('does nothing when duration is 0', () => {
        const { root, elements } = createMockRoot();
        const scrubber = new FilmstripScrubber(root);
        const controller = createMockController(0, 0);
        scrubber._controller = controller;
        scrubber._updatePlayhead();
        // playhead style.left should not be set
        expect(elements['#lb-filmstrip-playhead'].style.left).toBeUndefined();
    });

    it('does nothing when no controller is bound', () => {
        const { root, elements } = createMockRoot();
        const scrubber = new FilmstripScrubber(root);
        scrubber._updatePlayhead(); // should not throw
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// updateMarkers
// ═══════════════════════════════════════════════════════════════════════════

describe('FilmstripScrubber — updateMarkers', () => {
    let scrubber, elements;

    beforeEach(() => {
        const mock = createMockRoot();
        scrubber = new FilmstripScrubber(mock.root);
        elements = mock.elements;
        scrubber._controller = createMockController(10, 0);
    });

    it('positions in-marker at correct percentage', () => {
        scrubber.updateMarkers({ in: 2, out: 8 });
        expect(elements['#lb-filmstrip-marker-in'].style.left).toBe('20%');
        expect(elements['#lb-filmstrip-marker-in'].hidden).toBe(false);
    });

    it('positions out-marker at correct percentage', () => {
        scrubber.updateMarkers({ in: 2, out: 8 });
        expect(elements['#lb-filmstrip-marker-out'].style.left).toBe('80%');
        expect(elements['#lb-filmstrip-marker-out'].hidden).toBe(false);
    });

    it('shows loop range between in and out', () => {
        scrubber.updateMarkers({ in: 2, out: 8 });
        expect(elements['#lb-filmstrip-loop-range'].hidden).toBe(false);
        expect(elements['#lb-filmstrip-loop-range'].style.left).toBe('20%');
        expect(elements['#lb-filmstrip-loop-range'].style.width).toBe('60%');
    });

    it('hides markers when points are null', () => {
        scrubber.updateMarkers({ in: null, out: null });
        expect(elements['#lb-filmstrip-marker-in'].hidden).toBe(true);
        expect(elements['#lb-filmstrip-marker-out'].hidden).toBe(true);
        expect(elements['#lb-filmstrip-loop-range'].hidden).toBe(true);
    });

    it('hides loop range when in >= out', () => {
        scrubber.updateMarkers({ in: 5, out: 3 });
        expect(elements['#lb-filmstrip-loop-range'].hidden).toBe(true);
    });

    it('hides all markers when duration is 0', () => {
        scrubber._controller = createMockController(0, 0);
        scrubber.updateMarkers({ in: 2, out: 8 });
        expect(elements['#lb-filmstrip-marker-in'].hidden).toBe(true);
        expect(elements['#lb-filmstrip-marker-out'].hidden).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// bind/unbind
// ═══════════════════════════════════════════════════════════════════════════

describe('FilmstripScrubber — bind and unbind', () => {
    it('bind stores controller and shows scrubber', async () => {
        const { root } = createMockRoot();
        const scrubber = new FilmstripScrubber(root);
        const controller = createMockController(10);
        controller.mediaType = 'video';

        await scrubber.bind(controller, 'test.mp4');
        expect(root.classList.remove).toHaveBeenCalledWith('hidden');
    });

    it('bind registers timeupdate listener on controller', async () => {
        const { root } = createMockRoot();
        const scrubber = new FilmstripScrubber(root);
        const controller = createMockController(10);
        controller.mediaType = 'video';

        await scrubber.bind(controller, 'test.mp4');
        expect(controller.on).toHaveBeenCalledWith('timeupdate', expect.any(Function));
    });

    it('unbind removes timeupdate listener', async () => {
        const { root } = createMockRoot();
        const scrubber = new FilmstripScrubber(root);
        const controller = createMockController(10);
        controller.mediaType = 'video';

        await scrubber.bind(controller, 'test.mp4');
        scrubber.unbind();
        expect(controller.off).toHaveBeenCalledWith('timeupdate', expect.any(Function));
    });

    it('unbind clears controller reference', async () => {
        const { root } = createMockRoot();
        const scrubber = new FilmstripScrubber(root);
        const controller = createMockController(10);
        controller.mediaType = 'video';

        await scrubber.bind(controller, 'test.mp4');
        scrubber.unbind();
        expect(scrubber._controller).toBeNull();
    });

    it('bind hides scrubber for non-animated images', async () => {
        const { root } = createMockRoot();
        const scrubber = new FilmstripScrubber(root);
        const controller = createMockController(10);
        controller.mediaType = 'image'; // not video or animated
        controller.frameCount = 1; // not animated

        await scrubber.bind(controller, 'test.png');
        expect(root.classList.add).toHaveBeenCalledWith('hidden');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// show/hide and getHoverTime
// ═══════════════════════════════════════════════════════════════════════════

describe('FilmstripScrubber — show/hide/getHoverTime', () => {
    it('show removes hidden class', () => {
        const { root } = createMockRoot();
        const scrubber = new FilmstripScrubber(root);
        scrubber.show();
        expect(root.classList.remove).toHaveBeenCalledWith('hidden');
    });

    it('hide adds hidden class', () => {
        const { root } = createMockRoot();
        const scrubber = new FilmstripScrubber(root);
        scrubber.hide();
        expect(root.classList.add).toHaveBeenCalledWith('hidden');
    });

    it('getHoverTime returns null initially', () => {
        const { root } = createMockRoot();
        const scrubber = new FilmstripScrubber(root);
        expect(scrubber.getHoverTime()).toBeUndefined();
    });
});
