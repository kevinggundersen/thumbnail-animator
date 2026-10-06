const { ImageDecoderPlaybackController, createAnimatedImageController, sniffAnimatedImageType } = require('../playback-controller');

// Mock of the WebCodecs ImageDecoder: N frames of w x h, each `delayMs` long.
function makeDecoderFactory({ frameCount = 5, width = 16, height = 8, delayMs = 100, log = [] } = {}) {
    return class MockImageDecoder {
        constructor({ data, type }) {
            this.type = type;
            this.data = data;
            this.closed = false;
            this.tracks = { ready: Promise.resolve(), selectedTrack: { frameCount } };
            this.completed = Promise.resolve();
            log.push('construct');
        }
        async decode({ frameIndex }) {
            if (this.closed) throw new Error('closed');
            log.push(`decode:${frameIndex}`);
            return { image: { displayWidth: width, displayHeight: height, duration: delayMs * 1000, close() { log.push(`close:${frameIndex}`); } }, complete: true };
        }
        close() { this.closed = true; log.push('close'); }
    };
}

function makeCanvas() {
    const ctx = { drawImage: vi.fn(), clearRect: vi.fn() };
    return { width: 0, height: 0, getContext: () => ctx, _ctx: ctx };
}

function makeController(opts = {}) {
    const log = [];
    const canvas = makeCanvas();
    const rafQueue = [];
    const ctrl = new ImageDecoderPlaybackController(canvas, new ArrayBuffer(16), {
        type: 'image/gif',
        delays: opts.delays,
        decoderFactory: makeDecoderFactory({ ...opts, log }),
        createCanvas: makeCanvas,
        raf: (cb) => { rafQueue.push(cb); return rafQueue.length; },
        caf: () => {},
    });
    return { ctrl, canvas, log, rafQueue, flushRaf: (ts) => { const q = rafQueue.splice(0); for (const cb of q) cb(ts); } };
}

describe('ImageDecoderPlaybackController', () => {
    it('builds the timeline from parser delays and sizes the canvas from the first frame', async () => {
        const { ctrl, canvas, log } = makeController({ frameCount: 3, delays: [100, 200, 300] });
        await ctrl.ready;
        expect(ctrl.frameCount).toBe(3);
        expect(ctrl.duration).toBeCloseTo(0.6);
        expect(ctrl.gifWidth).toBe(16);
        expect(ctrl.gifHeight).toBe(8);
        expect(canvas.width).toBe(16);
        expect(log[0]).toBe('construct');
        expect(log).toContain('decode:0');
        expect(log).toContain('close:0'); // VideoFrames are released after the copy
        expect(ctrl.mediaType).toBe('gif');
    });

    it('reads durations from decoded frames when no delays are supplied', async () => {
        const { ctrl } = makeController({ frameCount: 4, delayMs: 50 });
        await ctrl.ready;
        expect(ctrl.duration).toBeCloseTo(0.2);
        expect(ctrl.getTimestampAtFrame(1)).toBeCloseTo(0.1);
    });

    it('decodes all frames of a small animation in the background and reports framesready', async () => {
        const { ctrl, log } = makeController({ frameCount: 6, delays: [100, 100, 100, 100, 100, 100] });
        const ready = vi.fn();
        ctrl.on('framesready', ready);
        await ctrl.ready;
        await ctrl.whenFramesReady();
        for (let i = 0; i < 6; i++) expect(log).toContain(`decode:${i}`);
        expect(ready).toHaveBeenCalledOnce();
        expect(ctrl.getFrameAtIndex(5)).not.toBeNull();
    });

    it('getFrameAtIndex returns null for an undecoded frame and starts its decode', async () => {
        const { ctrl, log } = makeController({ frameCount: 300, delays: new Array(300).fill(40) });
        await ctrl.ready;
        // Frame 150 is neither in the leading window nor a sample frame.
        const before = log.filter(l => l === 'decode:150').length;
        expect(ctrl.getFrameAtIndex(150)).toBeNull();
        await new Promise(r => setTimeout(r, 0));
        expect(log.filter(l => l === 'decode:150').length).toBe(before + 1);
        expect(ctrl.getFrameAtIndex(150)).not.toBeNull();
    });

    it('maps time to frames and seeks', async () => {
        const { ctrl, canvas } = makeController({ frameCount: 4, delays: [100, 100, 100, 100] });
        await ctrl.ready;
        await ctrl.whenFramesReady();
        expect(ctrl.getFrameIndexAtTime(0.05)).toBe(0);
        expect(ctrl.getFrameIndexAtTime(0.25)).toBe(2);
        ctrl.seek(0.35);
        expect(ctrl.currentFrameIndex).toBe(3);
        expect(ctrl.currentTime).toBeCloseTo(0.35);
        expect(canvas._ctx.drawImage).toHaveBeenCalled();
    });

    it('advances frames while playing and loops', async () => {
        const { ctrl, flushRaf } = makeController({ frameCount: 2, delays: [100, 100] });
        await ctrl.ready;
        await ctrl.whenFramesReady();
        ctrl.setLoop(true);
        ctrl.play();
        expect(ctrl.isPlaying).toBe(true);
        flushRaf(0);      // baseline timestamp
        flushRaf(150);    // 150 ms in: frame 1
        expect(ctrl.currentFrameIndex).toBe(1);
        flushRaf(250);    // wrapped: 50 ms -> frame 0
        expect(ctrl.currentFrameIndex).toBe(0);
        ctrl.pause();
        expect(ctrl.isPlaying).toBe(false);
    });

    it('stepFrame moves one frame and pauses', async () => {
        const { ctrl } = makeController({ frameCount: 3, delays: [100, 100, 100] });
        await ctrl.ready;
        await ctrl.whenFramesReady();
        ctrl.play();
        ctrl.stepFrame('next');
        expect(ctrl.isPlaying).toBe(false);
        expect(ctrl.currentFrameIndex).toBe(1);
        ctrl.stepFrame('prev');
        expect(ctrl.currentFrameIndex).toBe(0);
    });

    it('destroy closes the decoder and drops cached frames', async () => {
        const { ctrl, log } = makeController({ frameCount: 3, delays: [100, 100, 100] });
        await ctrl.ready;
        ctrl.destroy();
        expect(log).toContain('close');
        expect(ctrl.getFrameAtIndex(0)).toBeNull();
    });

    it('rejects ready when no decoder is available', async () => {
        const canvas = makeCanvas();
        const ctrl = new ImageDecoderPlaybackController(canvas, new ArrayBuffer(4), { type: 'image/gif', decoderFactory: null, createCanvas: makeCanvas });
        const orig = console.error; console.error = () => {};
        await expect(ctrl.ready).rejects.toThrow();
        console.error = orig;
    });
});

describe('createAnimatedImageController / sniffAnimatedImageType', () => {
    it('sniffs RIFF/WEBP as webp and anything else as gif', () => {
        const webp = new Uint8Array(16); webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
        expect(sniffAnimatedImageType(webp.buffer)).toBe('image/webp');
        expect(sniffAnimatedImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]).buffer)).toBe('image/gif');
    });

    it('falls back to the legacy controller when ImageDecoder is missing', () => {
        const origGifuct = global.gifuctJs;
        const origDoc = global.document;
        global.gifuctJs = { parseGIF: () => ({ lsd: { width: 1, height: 1 } }), decompressFrames: () => [] };
        global.document = { createElement: () => makeCanvas() };
        try {
            const ctrl = createAnimatedImageController(makeCanvas(), new ArrayBuffer(16));
            expect(ctrl.constructor.name).toBe('AnimatedImagePlaybackController');
        } finally {
            global.gifuctJs = origGifuct;
            global.document = origDoc;
        }
    });
});
