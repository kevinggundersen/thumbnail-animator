/**
 * WebCodecs grid playback engine (main-thread side).
 *
 * A player is a <canvas class="media-thumbnail wc-video"> whose control is
 * transferred to one of a few workers (webcodecs-worker.js) that demux, decode
 * and paint it. The canvas carries a <video>-like facade (play/pause/paused,
 * currentTime, duration, readyState, videoWidth/Height, getVideoPlaybackQuality,
 * 'loadedmetadata'/'timeupdate' events) so the grid's playback budget, scrubber
 * and teardown treat it exactly like a video element.
 *
 * Settings: `playbackEngine` ('webcodecs' | 'video'), hardware preference
 * follows `webcodecsDecoder` ('prefer-hardware' | 'prefer-software' | 'no-preference').
 */
(function (root) {
    'use strict';

    const WcEngine = {
        supported: typeof VideoDecoder !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype,
        enabled: false,
        hw: 'prefer-software',
        workerUrl: 'webcodecs-worker.js',
        workerCount: Math.min(4, Math.max(2, Math.floor(((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4) / 4))),
        workers: [],
        players: new Map(), // id -> canvas
        nextId: 1,
        _rr: 0,
        stats: { created: 0, destroyed: 0, errors: 0, lastError: null },

        /** Create the workers (idempotent). */
        start() {
            if (!this.supported || this.workers.length) return this.supported;
            for (let i = 0; i < this.workerCount; i++) {
                const w = new Worker(this.workerUrl);
                w.onmessage = (e) => this._onMessage(e.data);
                w.onerror = (e) => { this.stats.errors++; this.stats.lastError = e.message || 'worker error'; };
                w.postMessage({ t: 'init', hw: this.hw });
                this.workers.push(w);
            }
            return true;
        },

        /** Change the decoder preference: applies to players created from now on. */
        setHardwarePreference(hw) {
            this.hw = hw;
            for (const w of this.workers) w.postMessage({ t: 'init', hw });
        },

        /**
         * Create a player for `url` (a proxy MP4) on a fresh canvas.
         * @returns {HTMLCanvasElement} the canvas with its video facade
         */
        createPlayer(url, { playing = false } = {}) {
            this.start();
            const canvas = document.createElement('canvas');
            canvas.className = 'media-thumbnail wc-video';
            const id = this.nextId++;
            const worker = this.workers[this._rr++ % this.workers.length];
            const st = {
                id, worker, url, playing, ready: false, destroyed: false,
                duration: NaN, width: 0, height: 0, currentTime: 0, statAt: 0, decoded: 0, dropped: 0, hardware: null, error: null,
                seekPending: null, seq: 0,
            };
            installFacade(canvas, st);
            this.players.set(id, canvas);
            this.stats.created++;
            const offscreen = canvas.transferControlToOffscreen();
            fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }).then(buffer => {
                if (st.destroyed) return;
                worker.postMessage({ t: 'create', id, canvas: offscreen, buffer, playing: st.playing }, [offscreen, buffer]);
            }).catch(err => {
                st.error = err.message || String(err);
                this.stats.errors++; this.stats.lastError = st.error;
                canvas.dispatchEvent(new Event('error'));
            });
            return canvas;
        },

        _onMessage(m) {
            if (m.t === 'stats') {
                for (const it of m.items) {
                    const c = this.players.get(it.id);
                    if (!c) continue;
                    const st = c._wc;
                    if (it.seq != null && it.seq < st.seq) continue; // from before the latest seek landed
                    st.currentTime = it.currentTime; st.statAt = performance.now(); st.decoded = it.decoded; st.dropped = it.dropped;
                    if (st.ready && it.playing) c.dispatchEvent(new Event('timeupdate'));
                }
                return;
            }
            const c = this.players.get(m.id);
            if (!c) return;
            const st = c._wc;
            if (m.t === 'meta') {
                st.ready = true; st.duration = m.duration; st.width = m.width; st.height = m.height; st.hardware = m.hardware;
                if (st.seekPending != null) { st.worker.postMessage({ t: 'seek', id: st.id, time: st.seekPending, seq: st.seq }); st.seekPending = null; }
                c.dispatchEvent(new Event('loadedmetadata'));
                c.dispatchEvent(new Event('canplay'));
            } else if (m.t === 'error') {
                st.error = m.message;
                this.stats.errors++; this.stats.lastError = m.message;
                c.dispatchEvent(new Event('error'));
            }
        },

        /** Destroy a player (idempotent). */
        destroyPlayer(canvas) {
            const st = canvas && canvas._wc;
            if (!st || st.destroyed) return;
            st.destroyed = true;
            st.playing = false;
            this.players.delete(st.id);
            this.stats.destroyed++;
            st.worker.postMessage({ t: 'destroy', id: st.id });
        },

        status() {
            let playing = 0;
            for (const c of this.players.values()) if (c._wc.playing) playing++;
            return { supported: this.supported, enabled: this.enabled, workers: this.workers.length, players: this.players.size, playing, hw: this.hw, ...this.stats };
        },
    };

    /** Give the canvas the subset of HTMLMediaElement the grid relies on. */
    function installFacade(canvas, st) {
        canvas._wc = st;
        canvas._destroyed = false;
        Object.defineProperties(canvas, {
            paused: { get: () => !st.playing },
            ended: { get: () => false },
            muted: { get: () => true, set: () => {} },
            loop: { get: () => true, set: () => {} },
            playbackRate: { get: () => 1, set: () => {} },
            src: { get: () => st.url, set: () => {} },
            currentSrc: { get: () => st.url },
            duration: { get: () => st.duration },
            videoWidth: { get: () => st.width },
            videoHeight: { get: () => st.height },
            readyState: { get: () => (st.ready ? 4 : 0) },
            networkState: { get: () => (st.ready ? 1 : 2) },
            currentTime: {
                // Interpolated from the last worker report while playing, capped at
                // one report interval: a worker that stopped reporting reads as stalled.
                get: () => (st.playing && st.ready ? st.currentTime + Math.min(0.5, (performance.now() - st.statAt) / 1000) : st.currentTime),
                set: (t) => {
                    const time = Math.max(0, Number(t) || 0);
                    st.currentTime = time;
                    st.statAt = performance.now();
                    st.seq++;
                    if (st.destroyed) return;
                    if (st.ready) st.worker.postMessage({ t: 'seek', id: st.id, time, seq: st.seq });
                    else st.seekPending = time;
                },
            },
        });
        canvas.play = function () {
            if (st.destroyed) return Promise.reject(new DOMException('player destroyed', 'AbortError'));
            if (!st.playing) { st.playing = true; st.worker.postMessage({ t: 'play', id: st.id }); canvas.dispatchEvent(new Event('play')); }
            return Promise.resolve();
        };
        canvas.pause = function () {
            if (st.destroyed || !st.playing) return;
            st.currentTime = canvas.currentTime; // freeze the interpolated clock
            st.playing = false;
            st.worker.postMessage({ t: 'pause', id: st.id });
            canvas.dispatchEvent(new Event('pause'));
        };
        canvas.load = function () {};
        canvas.getVideoPlaybackQuality = function () {
            return { totalVideoFrames: st.decoded, droppedVideoFrames: st.dropped, corruptedVideoFrames: 0, creationTime: 0 };
        };
    }

    root.WcEngine = WcEngine;
    if (typeof module !== 'undefined' && module.exports) module.exports = { WcEngine, installFacade };
})(typeof window !== 'undefined' ? window : globalThis);
