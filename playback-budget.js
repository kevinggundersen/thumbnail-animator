/**
 * Adaptive playback budget for grid thumbnails.
 *
 * Goal: play as many thumbnail videos at once as the machine can sustain, and
 * no more. The budget starts at a ceiling (the perf-profile MAX_VIDEOS), then
 * every sample interval reads the decoder's own dropped-frame counters and the
 * main thread's frame pacing. When frames are being dropped it lowers the
 * number of *playing* videos; after a run of healthy samples it raises it again
 * toward the ceiling. Videos beyond the limit stay loaded (poster visible) but
 * paused, farthest from the viewport centre first.
 *
 * A remembered limit (initialLimit) was learned under earlier conditions, so it
 * is only a starting point: while every sample stays healthy the limit doubles
 * each sample (slow start) until the first overload, after which growth is the
 * conservative additive step. Without that, a limit learned on a bad day took
 * half a minute to let a screen full of videos play.
 *
 * The class is host-agnostic: the renderer hands it a host object that knows
 * how to enumerate candidate videos and whether playback is allowed at all
 * (lightbox open, window blurred, hidden). That keeps it unit-testable.
 *
 * host = {
 *   getCandidates(): Array<{ video: HTMLVideoElement, distance: number }>,
 *   canPlay(): boolean,
 *   isScrolling(): boolean,           // frame drops during scroll are not the decoder's fault
 *   isBusy(): boolean,                // optional: grid still loading/attaching media; samples are not evidence
 *   stallsAttributable(): boolean,    // optional: false when playback does not run on the main thread (WebCodecs engine)
 *
 * Three overload signals: decoder dropped-frame ratio, main-thread stalls, and
 * media-clock underrun (a video's currentTime advancing slower than wall time:
 * a decoder that cannot keep up stalls the clock instead of dropping frames,
 * which is the stutter the eye sees while CPU and GPU look idle). Growth needs
 * a stricter bar than "not overloaded" (drops under dropRatioLow and the clock
 * at full speed), otherwise the limit oscillates around the edge of stutter.
 * The level that overloaded is remembered as a soft ceiling (a little below
 * it) for a while, doubling that while each time it is confirmed, so the
 * budget does not probe back into stutter every few seconds.
 *   persistHint(limit): void,         // optional: remember the learned limit
 *   now(): number,                    // optional, for tests
 *   raf(cb): number, caf(id): void,   // optional, for tests
 *   setInterval/clearInterval,        // optional, for tests
 * }
 */
(function (root) {
    'use strict';

    const DEFAULTS = {
        ceiling: 120,
        floor: 4,
        sampleMs: 1000,
        dropRatioHigh: 0.06,    // >6% of decoded frames dropped in a sample = overloaded
        dropRatioLow: 0.02,     // growth only while drops stay under 2%
        clockRatioLow: 0.9,     // media clocks advancing under 90% of wall time = overloaded (underrun)
        clockRatioHealthy: 0.97, // growth only while clocks run at (nearly) full speed
        softCeilingFactor: 0.85, // after an overload at N playing, stay at the last healthy level, or under 0.85 * N ...
        softCeilingMs: 30000,    // ... for this long (doubling on every repeat, up to softCeilingMaxMs)
        softCeilingMaxMs: 600000,
        overloadSamples: 2,      // consecutive overloaded samples before shrinking (start-up drops outlast one sample)
        frameBudget: 0,          // total decoded frames per second allowed across the playing set (0 = no cap)
        longFrameMs: 50,        // a main-thread frame slower than this counts as a stall
        longFramesHigh: 3,      // stalls per sample that count as overloaded
        growAfter: 5,           // healthy samples in a row before raising the limit
        probeGrowAfter: 1,      // ...while probing upward from a remembered limit (doubling)
        shrinkFactor: 0.75,
        growFactor: 0.15,
        minDecoded: 48,         // a sample with fewer decoded frames (start-up, tiny set) is not evidence
        historySize: 32,
    };

    class PlaybackBudget {
        constructor(host, opts = {}) {
            this.host = host;
            this.opts = { ...DEFAULTS, ...opts };
            this.ceiling = Math.max(this.opts.floor, this.opts.ceiling);
            this.limit = this.ceiling;
            if (Number.isFinite(opts.initialLimit)) {
                this.limit = Math.min(this.ceiling, Math.max(this.opts.floor, Math.floor(opts.initialLimit)));
            }
            // Probing: doubling growth until the first overload of this session.
            this.probing = Number.isFinite(opts.initialLimit) && this.limit < this.ceiling;
            this.playing = new Set();
            this.healthyStreak = 0;
            this.lastSample = { dropRatio: 0, longFrames: 0, playing: 0, decoded: 0, dropped: 0 };
            this._quality = new Map(); // video -> { dropped, total, time, wall }
            this._candidateCount = 0;
            this._softCeiling = Infinity;  // see softCeilingFactor
            this._softCeilingUntil = 0;
            this._softCeilingHold = this.opts.softCeilingMs;
            this._overloadStreak = 0;
            this._lastHealthyLimit = 0; // the highest limit at which a healthy sample was taken
            this._applyRaf = null;
            this._timer = null;
            this._frameLoop = null;
            this._longFrames = 0;
            this._lastFrameTs = 0;
            this._playingChanged = false; // the playing set changed since the last sample
            this._running = false;
            this.changes = 0; // how many times the limit moved (diagnostics)
            this.history = []; // last limit changes: { t, from, to, reason, playing, dropRatio, longFrames }
        }

        // ── Lifecycle ────────────────────────────────────────────────────────
        start() {
            if (this._running) return;
            this._running = true;
            const si = this.host.setInterval || ((fn, ms) => setInterval(fn, ms));
            this._timer = si(() => this._sample(), this.opts.sampleMs);
            this.schedule();
        }

        stop() {
            this._running = false;
            const ci = this.host.clearInterval || ((id) => clearInterval(id));
            if (this._timer) { ci(this._timer); this._timer = null; }
            this._stopFrameLoop();
            if (this._applyRaf != null) { (this.host.caf || cancelAnimationFrame)(this._applyRaf); this._applyRaf = null; }
        }

        setFrameBudget(n) {
            this.opts.frameBudget = Math.max(0, Math.floor(n) || 0);
            this.schedule();
        }

        setCeiling(n) {
            this.ceiling = Math.max(this.opts.floor, Math.floor(n) || this.opts.floor);
            if (this.limit > this.ceiling) this.limit = this.ceiling;
            this.schedule();
        }

        status() {
            return {
                limit: this.limit,
                ceiling: this.ceiling,
                softCeiling: this._softCeiling === Infinity ? null : this._softCeiling,
                frameBudget: this.opts.frameBudget,
                playing: this.playing.size,
                probing: this.probing,
                dropRatio: this.lastSample.dropRatio,
                clockRatio: this.lastSample.clockRatio,
                longFrames: this.lastSample.longFrames,
                changes: this.changes,
                history: this.history.slice(-8),
            };
        }

        // ── Enforcement ──────────────────────────────────────────────────────
        /** Coalesce apply() to the next frame. Cheap to call from anywhere. */
        schedule() {
            if (!this._running || this._applyRaf != null) return;
            const raf = this.host.raf || ((cb) => requestAnimationFrame(cb));
            this._applyRaf = raf(() => { this._applyRaf = null; this.apply(); });
        }

        /** Play the `limit` closest candidates, pause the rest. */
        apply() {
            const allowed = this.host.canPlay();
            const candidates = allowed ? this.host.getCandidates() : [];
            this._candidateCount = candidates.length;
            const stillPlaying = new Set();
            if (allowed) {
                candidates.sort((a, b) => a.distance - b.distance);
                // Every decoded frame costs the same on the GPU process main thread
                // whatever the stream: the frame budget caps their sum, nearest first.
                let framesUsed = 0;
                const frameBudget = this.opts.frameBudget > 0 ? this.opts.frameBudget : Infinity;
                for (let i = 0; i < candidates.length; i++) {
                    const v = candidates[i].video;
                    const fps = candidates[i].fps || v.frameRate || 30;
                    if (i < this.limit && framesUsed + fps <= frameBudget) {
                        framesUsed += fps;
                        stillPlaying.add(v);
                        if (v.paused) {
                            const p = v.play();
                            if (p && typeof p.catch === 'function') p.catch(() => {});
                        }
                    } else if (!v.paused) {
                        v.pause();
                    }
                }
            } else {
                // Playback disallowed: pause everything we know about, plus any candidate
                // the host still reports (the lightbox may have been opened mid-load).
                for (const v of this.playing) { if (!v.paused) v.pause(); }
                for (const c of this.host.getCandidates()) { if (!c.video.paused) c.video.pause(); }
            }
            // Forget quality counters of videos that stopped playing or were destroyed.
            for (const v of this._quality.keys()) if (!stillPlaying.has(v)) this._quality.delete(v);
            let changed = stillPlaying.size !== this.playing.size;
            if (!changed) for (const v of stillPlaying) { if (!this.playing.has(v)) { changed = true; break; } }
            if (changed) this._playingChanged = true;
            this.playing = stillPlaying;
            if (this.playing.size > 0) this._startFrameLoop(); else this._stopFrameLoop();
        }

        // ── Measurement ──────────────────────────────────────────────────────
        _startFrameLoop() {
            if (this._frameLoop != null) return;
            const raf = this.host.raf || ((cb) => requestAnimationFrame(cb));
            const now = this.host.now || (() => performance.now());
            this._lastFrameTs = now();
            const tick = () => {
                const t = now();
                if (t - this._lastFrameTs > this.opts.longFrameMs) this._longFrames++;
                this._lastFrameTs = t;
                this._frameLoop = raf(tick);
            };
            this._frameLoop = raf(tick);
        }

        _stopFrameLoop() {
            if (this._frameLoop != null) { (this.host.caf || cancelAnimationFrame)(this._frameLoop); this._frameLoop = null; }
            this._longFrames = 0;
        }

        /** Read decoder counters for the playing set and adjust the limit. */
        _sample() {
            let decoded = 0, dropped = 0, mediaAdvance = 0, wallAdvance = 0;
            const now = (this.host.now || (() => performance.now()))();
            for (const v of this.playing) {
                let q = null;
                try { q = typeof v.getVideoPlaybackQuality === 'function' ? v.getVideoPlaybackQuality() : null; } catch {}
                if (!q) continue;
                const time = typeof v.currentTime === 'number' ? v.currentTime : null;
                const prev = this._quality.get(v);
                if (prev) {
                    decoded += Math.max(0, q.totalVideoFrames - prev.total);
                    dropped += Math.max(0, q.droppedVideoFrames - prev.dropped);
                    if (time != null && prev.time != null) {
                        const dt = time - prev.time, dw = (now - prev.wall) / 1000;
                        // A loop wrap (dt < 0) or a seek says nothing about decode speed.
                        if (dw > 0 && dt >= 0 && dt <= dw * 1.5) { mediaAdvance += dt; wallAdvance += dw; }
                    }
                }
                this._quality.set(v, { total: q.totalVideoFrames, dropped: q.droppedVideoFrames, time, wall: now });
            }
            const clockRatio = wallAdvance >= 1 ? mediaAdvance / wallAdvance : null;
            const longFrames = this._longFrames;
            this._longFrames = 0;
            const dropRatio = decoded > 0 ? dropped / decoded : 0;
            const playing = this.playing.size;
            this.lastSample = { dropRatio, longFrames, playing, decoded, dropped, clockRatio };
            const changed = this._playingChanged;
            this._playingChanged = false;

            if (playing === 0) return; // nothing to learn from
            if (decoded < this.opts.minDecoded) return; // decoders still spinning up: not evidence either way
            // Videos that just started drop their first frames, and a grid still
            // loading or attaching media stalls for reasons pausing would not fix:
            // neither sample is evidence about the decoders.
            if (changed || (typeof this.host.isBusy === 'function' && this.host.isBusy())) return;
            const scrolling = typeof this.host.isScrolling === 'function' && this.host.isScrolling();
            // Main-thread stalls are only playback's fault when playback runs there
            // (<video> elements). With the engine, pausing players cannot fix a stall.
            const stallsMatter = typeof this.host.stallsAttributable !== 'function' || this.host.stallsAttributable();
            // Decoder drops are always evidence. Main-thread stalls only count when
            // the playing set is at the limit: below it, stalls come from loading or
            // layout, and pausing videos would not fix them.
            const atLimit = playing >= Math.min(this.limit, this._candidateCount || this.limit);
            const underrun = clockRatio != null && clockRatio < this.opts.clockRatioLow;
            const stalled = stallsMatter && !scrolling && atLimit && longFrames >= this.opts.longFramesHigh;
            const overloaded = dropRatio > this.opts.dropRatioHigh || underrun || stalled;
            const healthy = dropRatio <= this.opts.dropRatioLow && (clockRatio == null || clockRatio >= this.opts.clockRatioHealthy) && !stalled;

            if (overloaded) {
                this.healthyStreak = 0;
                this._overloadStreak++;
                if (this._overloadStreak < this.opts.overloadSamples) return; // one bad sample is not yet a verdict
                this._overloadStreak = 0;
                this.probing = false;
                // Remember where it broke: a soft ceiling a little under this level,
                // held longer each time the same level overloads again.
                const soft = Math.max(this.opts.floor, Math.min(playing - 1, Math.max(this._lastHealthyLimit, Math.floor(playing * this.opts.softCeilingFactor))));
                if (this._softCeiling !== Infinity && soft >= this._softCeiling * 0.9) this._softCeilingHold = Math.min(this.opts.softCeilingMaxMs, this._softCeilingHold * 2);
                else this._softCeilingHold = this.opts.softCeilingMs;
                this._softCeiling = Math.min(this._softCeiling, soft);
                this._softCeilingUntil = now + this._softCeilingHold;
                const next = Math.max(this.opts.floor, Math.floor(playing * this.opts.shrinkFactor));
                if (next < this.limit) this._setLimit(next, dropRatio > this.opts.dropRatioHigh ? 'drops' : underrun ? 'underrun' : 'stalls');
            } else if (!healthy) {
                this._overloadStreak = 0;
                this.healthyStreak = 0; // between the two bars: hold
            } else if (this.limit < this.ceiling && playing >= this.limit) {
                this._overloadStreak = 0;
                if (this.limit > this._lastHealthyLimit && this.limit < this._softCeiling) this._lastHealthyLimit = this.limit;
                // Only count a sample as evidence for growth when we are actually at the limit.
                this.healthyStreak++;
                if (this.healthyStreak >= (this.probing ? this.opts.probeGrowAfter : this.opts.growAfter)) {
                    this.healthyStreak = 0;
                    if (now >= this._softCeilingUntil) this._softCeiling = Infinity; // the hold expired: may probe above again
                    const step = this.probing ? this.limit : Math.max(2, Math.ceil(this.limit * this.opts.growFactor));
                    const target = Math.min(this.ceiling, this._softCeiling, this.limit + step);
                    if (target > this.limit) this._setLimit(target, this.probing ? 'probe' : 'healthy');
                }
            }
        }

        _setLimit(n, reason) {
            if (n === this.limit) return;
            const now = this.host.now || (() => performance.now());
            this.history.push({ t: Math.round(now()), from: this.limit, to: n, reason, playing: this.lastSample.playing, dropRatio: Math.round(this.lastSample.dropRatio * 1000) / 1000, clockRatio: this.lastSample.clockRatio == null ? null : Math.round(this.lastSample.clockRatio * 100) / 100, longFrames: this.lastSample.longFrames });
            if (this.history.length > this.opts.historySize) this.history.shift();
            this.limit = n;
            this.changes++;
            if (typeof this.host.persistHint === 'function') { try { this.host.persistHint(n); } catch {} }
            this.schedule();
        }
    }

    root.PlaybackBudget = PlaybackBudget;
    if (typeof module !== 'undefined' && module.exports) module.exports = { PlaybackBudget };
})(typeof window !== 'undefined' ? window : globalThis);
