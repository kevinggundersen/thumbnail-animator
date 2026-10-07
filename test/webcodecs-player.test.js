const { installFacade } = require('../webcodecs-player');

// The facade gives a plain object the HTMLMediaElement surface the grid uses,
// backed by messages to a (fake) worker. The canvas itself is irrelevant here.
function makeCanvas() {
    const listeners = new Map();
    return {
        addEventListener(type, fn) { (listeners.get(type) || listeners.set(type, []).get(type)).push(fn); },
        dispatchEvent(ev) { for (const fn of listeners.get(ev.type) || []) fn(ev); return true; },
    };
}
function makeState(worker) {
    return { id: 7, worker, url: 'file:///p.mp4', playing: false, ready: false, destroyed: false, duration: NaN, width: 0, height: 0, currentTime: 0, statAt: 0, decoded: 0, dropped: 0, hardware: null, error: null, seekPending: null, seq: 0 };
}
global.Event = global.Event || class Event { constructor(type) { this.type = type; } };

describe('WebCodecs player facade', () => {
    let now = 1000;
    beforeEach(() => { global.performance = { now: () => now }; });

    it('plays and pauses through the worker and reports paused state', () => {
        const sent = [];
        const worker = { postMessage: (m) => sent.push(m) };
        const st = makeState(worker); const c = makeCanvas(); installFacade(c, st);
        expect(c.paused).toBe(true);
        expect(c.readyState).toBe(0);
        c.play();
        expect(c.paused).toBe(false);
        expect(sent).toEqual([{ t: 'play', id: 7 }]);
        c.play();                                            // idempotent
        expect(sent).toHaveLength(1);
        c.pause();
        expect(c.paused).toBe(true);
        expect(sent[1]).toEqual({ t: 'pause', id: 7 });
    });

    it('interpolates currentTime between worker reports while playing, capped at one interval', () => {
        const worker = { postMessage: () => {} };
        const st = makeState(worker); const c = makeCanvas(); installFacade(c, st);
        st.ready = true; st.playing = true; st.currentTime = 2; st.statAt = now;
        now += 200;
        expect(c.currentTime).toBeCloseTo(2.2, 3);
        now += 2000;                                         // the worker went quiet: reads as stalled
        expect(c.currentTime).toBeCloseTo(2.5, 3);
        c.pause();                                           // the clock freezes where it was
        now += 1000;
        expect(c.currentTime).toBeCloseTo(2.5, 3);
    });

    it('seeks through the worker once ready, and defers a seek made before metadata', () => {
        const sent = [];
        const worker = { postMessage: (m) => sent.push(m) };
        const st = makeState(worker); const c = makeCanvas(); installFacade(c, st);
        c.currentTime = 3.5;                                 // not ready yet
        expect(sent).toHaveLength(0);
        expect(st.seekPending).toBe(3.5);
        st.ready = true;
        c.currentTime = 1.25;
        expect(sent).toEqual([{ t: 'seek', id: 7, time: 1.25, seq: 2 }]);   // the deferred seek was seq 1
        expect(c.currentTime).toBe(1.25);
    });

    it('exposes decoder counters as getVideoPlaybackQuality and the proxy url as src', () => {
        const worker = { postMessage: () => {} };
        const st = makeState(worker); const c = makeCanvas(); installFacade(c, st);
        st.decoded = 300; st.dropped = 4; st.duration = 12; st.width = 480; st.height = 270; st.ready = true;
        expect(c.getVideoPlaybackQuality()).toMatchObject({ totalVideoFrames: 300, droppedVideoFrames: 4 });
        expect(c.src).toBe('file:///p.mp4');
        expect(c.duration).toBe(12);
        expect(c.videoWidth).toBe(480);
        expect(c.readyState).toBe(4);
        expect(c.muted).toBe(true);
        expect(c.ended).toBe(false);
    });

    it('rejects play() after destruction', async () => {
        const worker = { postMessage: () => {} };
        const st = makeState(worker); const c = makeCanvas(); installFacade(c, st);
        st.destroyed = true;
        await expect(c.play()).rejects.toBeTruthy();
    });
});
