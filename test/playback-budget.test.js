const { PlaybackBudget } = require('../playback-budget');

// Fake host with manually driven timers/rAF so tests are deterministic.
function makeHost(videoCount, { canPlay = true, scrolling = false } = {}) {
    const videos = [];
    for (let i = 0; i < videoCount; i++) {
        videos.push({
            paused: true,
            total: 0, dropped: 0,
            play() { this.paused = false; return Promise.resolve(); },
            pause() { this.paused = true; },
            getVideoPlaybackQuality() { return { totalVideoFrames: this.total, droppedVideoFrames: this.dropped }; },
        });
    }
    const rafQueue = [];
    const host = {
        videos,
        canPlayFlag: canPlay,
        scrollingFlag: scrolling,
        hints: [],
        getCandidates: () => videos.map((video, i) => ({ video, distance: i * 100 })),
        canPlay: () => host.canPlayFlag,
        isScrolling: () => host.scrollingFlag,
        persistHint: (n) => host.hints.push(n),
        now: () => 0,
        raf: (cb) => { rafQueue.push(cb); return rafQueue.length; },
        caf: () => {},
        setInterval: () => 1,
        clearInterval: () => {},
        flushRaf: () => { const q = rafQueue.splice(0); for (const cb of q) cb(0); },
    };
    return host;
}

// Advance decoder counters on every playing video.
function decodeFrames(host, total, droppedEach) {
    for (const v of host.videos) {
        if (!v.paused) { v.total += total; v.dropped += droppedEach; }
    }
}

describe('PlaybackBudget', () => {
    it('plays the closest `limit` videos and pauses the rest', () => {
        const host = makeHost(10);
        const b = new PlaybackBudget(host, { ceiling: 4 });
        b.start();
        host.flushRaf();
        const playing = host.videos.map(v => !v.paused);
        expect(playing).toEqual([true, true, true, true, false, false, false, false, false, false]);
        expect(b.status().playing).toBe(4);
    });

    it('pauses everything when the host disallows playback', () => {
        const host = makeHost(5);
        const b = new PlaybackBudget(host, { ceiling: 5 });
        b.start();
        host.flushRaf();
        expect(host.videos.every(v => !v.paused)).toBe(true);
        host.canPlayFlag = false;
        b.apply();
        expect(host.videos.every(v => v.paused)).toBe(true);
        expect(b.status().playing).toBe(0);
    });

    it('shrinks the limit when frames are dropped', () => {
        const host = makeHost(20);
        const b = new PlaybackBudget(host, { ceiling: 20, floor: 4, minDecoded: 10 });
        b.start();
        host.flushRaf();
        decodeFrames(host, 30, 0);
        b._sample();                     // baseline counters
        decodeFrames(host, 30, 10);      // 33% dropped
        b._sample();
        expect(b.limit).toBe(15);        // floor(20 * 0.75)
        expect(host.hints).toEqual([15]);
        host.flushRaf();
        expect(host.videos.filter(v => !v.paused).length).toBe(15);
        // Farthest were paused first
        expect(host.videos[19].paused).toBe(true);
        expect(host.videos[0].paused).toBe(false);
    });

    it('never goes below the floor', () => {
        const host = makeHost(6);
        const b = new PlaybackBudget(host, { ceiling: 6, floor: 4, minDecoded: 10 });
        b.start();
        host.flushRaf();
        for (let i = 0; i < 5; i++) {
            decodeFrames(host, 10, 9);
            b._sample();
            host.flushRaf();
        }
        expect(b.limit).toBe(4);
    });

    it('grows back toward the ceiling after a run of healthy samples', () => {
        const host = makeHost(20);
        const b = new PlaybackBudget(host, { ceiling: 20, floor: 4, growAfter: 3, minDecoded: 10 });
        b.start();
        host.flushRaf();
        decodeFrames(host, 30, 0); b._sample();
        decodeFrames(host, 30, 10); b._sample();   // shrink to 15
        host.flushRaf();
        expect(b.limit).toBe(15);
        // The first sample after the playing set changed is not evidence (fresh decoders).
        for (let i = 0; i < 4; i++) { decodeFrames(host, 30, 0); b._sample(); host.flushRaf(); }
        expect(b.limit).toBe(18);                   // 15 + max(2, ceil(15*0.15)=3)
        for (let i = 0; i < 4; i++) { decodeFrames(host, 30, 0); b._sample(); host.flushRaf(); }
        expect(b.limit).toBe(20);                   // capped at ceiling
    });

    it('probes upward from a remembered limit by doubling until the first overload', () => {
        const host = makeHost(200);
        const b = new PlaybackBudget(host, { ceiling: 200, floor: 4, growAfter: 3, minDecoded: 10, initialLimit: 13 });
        b.start();
        host.flushRaf();
        expect(b.limit).toBe(13);
        decodeFrames(host, 30, 0); b._sample(); host.flushRaf();   // first sample: counters only (and the set just changed)
        decodeFrames(host, 30, 0); b._sample(); host.flushRaf();
        expect(b.limit).toBe(26);                                   // doubled after one healthy sample
        decodeFrames(host, 30, 0); b._sample(); host.flushRaf();   // 13 videos just started: not evidence
        decodeFrames(host, 30, 0); b._sample(); host.flushRaf();
        expect(b.limit).toBe(52);
        decodeFrames(host, 30, 10); b._sample(); host.flushRaf();  // drops right after 26 more started: ignored
        expect(b.limit).toBe(52);
        decodeFrames(host, 30, 10); b._sample(); host.flushRaf();  // still dropping: overload, probing over
        expect(b.limit).toBe(39);                                   // floor(52 * 0.75)
        expect(b.status().probing).toBe(false);
        for (let i = 0; i < 4; i++) { decodeFrames(host, 30, 0); b._sample(); host.flushRaf(); }
        expect(b.limit).toBe(45);                                   // 39 + ceil(39 * 0.15) = 6: additive from here on
    });

    it('ignores main-thread stalls while scrolling but not decoder drops', () => {
        const host = makeHost(10, { scrolling: true });
        const b = new PlaybackBudget(host, { ceiling: 10, floor: 2, longFramesHigh: 2, minDecoded: 10 });
        b.start();
        host.flushRaf();
        decodeFrames(host, 20, 0); b._sample();
        b._longFrames = 5;                           // stalls during scroll
        decodeFrames(host, 20, 0); b._sample();
        expect(b.limit).toBe(10);
        host.scrollingFlag = false;
        b._longFrames = 5;                           // stalls while idle
        decodeFrames(host, 20, 0); b._sample();
        expect(b.limit).toBe(7);                     // floor(10 * 0.75)
    });

    it('setCeiling clamps the current limit and honours an initial hint', () => {
        const host = makeHost(10);
        const b = new PlaybackBudget(host, { ceiling: 10, floor: 2, initialLimit: 6 });
        expect(b.limit).toBe(6);
        b.start();
        b.setCeiling(4);
        expect(b.limit).toBe(4);
        b.setCeiling(50);
        expect(b.ceiling).toBe(50);
        expect(b.limit).toBe(4);                    // does not jump up; growth earns it
    });

    it('ignores samples with too few decoded frames (decoder start-up)', () => {
        const host = makeHost(10);
        const b = new PlaybackBudget(host, { ceiling: 10, floor: 2, minDecoded: 48 });
        b.start();
        host.flushRaf();
        decodeFrames(host, 2, 0); b._sample();
        decodeFrames(host, 2, 2); b._sample();   // 100% dropped, but only 20 frames decoded in total
        expect(b.limit).toBe(10);
        decodeFrames(host, 10, 5); b._sample();  // 100 decoded, 50% dropped
        expect(b.limit).toBe(7);
        expect(b.status().history[0].reason).toBe('drops');
    });

    it('does not learn from samples with nothing playing', () => {
        const host = makeHost(0);
        const b = new PlaybackBudget(host, { ceiling: 8 });
        b.start();
        host.flushRaf();
        b._longFrames = 10;
        b._sample();
        expect(b.limit).toBe(8);
    });
});
