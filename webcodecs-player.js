/**
 * WebCodecs grid playback engine (main-thread side).
 *
 * One worker (webcodecs-worker.js) decodes every proxied card and paints all
 * of them into a single "sheet" canvas that covers the grid viewport. The
 * sheet sits under the cards; a card whose cell is live gets the `wc-sheet`
 * class (transparent background, poster hidden) so its chrome (border, labels,
 * badges, hover gradient) stays on top of the moving picture. While the grid
 * scrolls the sheet is hidden and the posters show; when it settles the cells
 * are laid out again at the cards' new positions.
 *
 * Each card's poster <img> doubles as the player's host: it carries a
 * <video>-like facade (play/pause/paused, currentTime with sequenced seeks,
 * duration, readyState, videoWidth/Height, getVideoPlaybackQuality,
 * loadedmetadata/timeupdate events) so the playback budget, the hover
 * scrubber and teardown treat it exactly like a video element.
 *
 * Settings: `playbackEngine` ('webcodecs' | 'video'), `webcodecsDecoder`
 * ('prefer-software' | 'prefer-hardware' | 'no-preference').
 */
(function (root) {
    'use strict';

    const WcEngine = {
        supported: typeof VideoDecoder !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && 'transferControlToOffscreen' in HTMLCanvasElement.prototype,
        enabled: false,
        hw: 'prefer-software',
        workerUrl: 'webcodecs-worker.js',
        worker: null,
        sheet: null,            // the <canvas class="wc-sheet-canvas"> in the grid
        container: null,        // #grid-container
        players: new Map(),     // id -> host element
        cards: new Map(),       // id -> card
        nextId: 1,
        hidden: false,
        hoverCard: null,
        _layoutRaf: 0,
        _radius: null,
        stats: { created: 0, destroyed: 0, errors: 0, lastError: null, layouts: 0 },

        /** Create the worker and the sheet (idempotent). */
        start() {
            if (!this.supported) return false;
            if (this.worker) return true;
            this.container = document.getElementById('grid-container');
            if (!this.container) return false;
            const sheet = document.createElement('canvas');
            sheet.className = 'wc-sheet-canvas';
            sheet.width = 1; sheet.height = 1;
            this.container.insertBefore(sheet, this.container.firstChild);
            this.sheet = sheet;
            const offscreen = sheet.transferControlToOffscreen();
            const w = new Worker(this.workerUrl);
            w.onmessage = (e) => this._onMessage(e.data);
            w.onerror = (e) => { this.stats.errors++; this.stats.lastError = e.message || 'worker error'; };
            w.postMessage({ t: 'init', hw: this.hw, sheet: offscreen }, [offscreen]);
            this.worker = w;
            return true;
        },

        /** Change the decoder preference: applies to players created from now on. */
        setHardwarePreference(hw) {
            this.hw = hw;
            if (this.worker) this.worker.postMessage({ t: 'init', hw });
        },

        /**
         * Make `host` (the card's poster <img>, or any element in the card) a player for the proxy at `url`.
         * @returns {HTMLElement} host, now carrying the video facade
         */
        createPlayer(host, url, card, { playing = false } = {}) {
            if (!this.start()) return null;
            const id = this.nextId++;
            const st = {
                id, worker: this.worker, url, playing, ready: false, destroyed: false,
                duration: NaN, width: 0, height: 0, fps: 30, currentTime: 0, statAt: 0, decoded: 0, dropped: 0, hardware: null, error: null,
                seekPending: null, seq: 0,
            };
            installFacade(host, st);
            if (host.classList) host.classList.add('wc-video');
            this.players.set(id, host);
            this.cards.set(id, card);
            this.stats.created++;
            fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }).then(buffer => {
                if (st.destroyed) return;
                this.worker.postMessage({ t: 'create', id, buffer, playing: st.playing }, [buffer]);
            }).catch(err => {
                st.error = err.message || String(err);
                this.stats.errors++; this.stats.lastError = st.error;
                host.dispatchEvent(new Event('error'));
            });
            return host;
        },

        _onMessage(m) {
            if (m.t === 'stats') {
                for (const it of m.items) {
                    const h = this.players.get(it.id);
                    if (!h) continue;
                    const st = h._wc;
                    if (it.seq != null && it.seq < st.seq) continue; // from before the latest seek landed
                    st.currentTime = it.currentTime; st.statAt = performance.now(); st.decoded = it.decoded; st.dropped = it.dropped;
                    if (st.ready && it.playing) h.dispatchEvent(new Event('timeupdate'));
                }
                return;
            }
            const h = this.players.get(m.id);
            if (!h) return;
            const st = h._wc;
            if (m.t === 'meta') {
                st.ready = true; st.duration = m.duration; st.width = m.width; st.height = m.height; st.hardware = m.hardware; if (m.fps > 0) st.fps = m.fps;
                if (st.seekPending != null) { st.worker.postMessage({ t: 'seek', id: st.id, time: st.seekPending, seq: st.seq }); st.seekPending = null; }
                const card = this.cards.get(m.id);
                if (card && card.classList) card.classList.add('wc-sheet');
                this.requestLayout();
                h.dispatchEvent(new Event('loadedmetadata'));
                h.dispatchEvent(new Event('canplay'));
            } else if (m.t === 'error') {
                st.error = m.message;
                this.stats.errors++; this.stats.lastError = m.message;
                h.dispatchEvent(new Event('error'));
            }
        },

        /** Destroy a player (idempotent). */
        destroyPlayer(host) {
            const st = host && host._wc;
            if (!st || st.destroyed) return;
            st.destroyed = true;
            st.playing = false;
            this.players.delete(st.id);
            const card = this.cards.get(st.id);
            if (card && card.classList) card.classList.remove('wc-sheet');
            this.cards.delete(st.id);
            if (this.hoverCard === card) this.hoverCard = null;
            this.stats.destroyed++;
            st.worker.postMessage({ t: 'destroy', id: st.id });
            this.requestLayout();
        },

        /** The grid started or stopped scrolling: nothing is painted while it moves. */
        setHidden(hidden) {
            hidden = !!hidden;
            if (this.hidden === hidden) return;
            this.hidden = hidden;
            if (this.worker) this.worker.postMessage({ t: 'hidden', hidden });
            if (!hidden) this.requestLayout();
        },

        /** The hovered card's cell is drawn last, at its (scaled) rect. */
        setHover(card) {
            if (this.hoverCard === card) return;
            this.hoverCard = card || null;
            this.requestLayout();
            // The hover transform transitions; lay out again once it has settled.
            setTimeout(() => { if (this.hoverCard === card) this.requestLayout(); }, 260);
        },

        /** Lay the cells out again on the next frame (coalesced). */
        requestLayout() {
            if (this._layoutRaf || !this.worker) return;
            this._layoutRaf = requestAnimationFrame(() => { this._layoutRaf = 0; this.layout(); });
        },

        layout() {
            const c = this.container, sheet = this.sheet;
            if (!c || !sheet || !this.worker) return;
            if (!sheet.isConnected) c.insertBefore(sheet, c.firstChild); // the grid was emptied (folder change)
            const w = c.clientWidth, h = c.clientHeight;
            sheet.style.left = `${c.scrollLeft || 0}px`;
            sheet.style.top = `${c.scrollTop}px`;
            sheet.style.width = `${w}px`;
            sheet.style.height = `${h}px`;
            const dpr = Math.min(3, window.devicePixelRatio || 1);
            const sr = sheet.getBoundingClientRect();
            if (this._radius == null) {
                const first = this.cards.values().next().value;
                this._radius = first ? parseFloat(getComputedStyle(first).borderRadius) || 0 : 0;
            }
            const cells = [];
            let hoverId = null, hoverRect = null;
            for (const [id, card] of this.cards) {
                if (!card.isConnected) continue;
                const r = card.getBoundingClientRect();
                if (r.right <= sr.left || r.left >= sr.right || r.bottom <= sr.top || r.top >= sr.bottom) continue;
                const cell = { id, x: r.left - sr.left + 1, y: r.top - sr.top + 1, w: r.width - 2, h: r.height - 2, r: this._radius };
                cells.push(cell);
                if (card === this.hoverCard) { hoverId = id; hoverRect = { x: cell.x, y: cell.y, w: cell.w, h: cell.h, r: cell.r }; }
            }
            this.stats.layouts++;
            this.worker.postMessage({ t: 'layout', w, h, dpr, cells });
            this.worker.postMessage({ t: 'hover', id: hoverId, rect: hoverRect });
        },

        status() {
            let playing = 0;
            for (const h of this.players.values()) if (h._wc.playing) playing++;
            return { supported: this.supported, enabled: this.enabled, worker: !!this.worker, players: this.players.size, playing, hw: this.hw, hidden: this.hidden, ...this.stats };
        },
    };

    /** Give the host the subset of HTMLMediaElement the grid relies on. */
    function installFacade(host, st) {
        host._wc = st;
        host._destroyed = false;
        const props = {
            paused: { get: () => !st.playing },
            ended: { get: () => false },
            muted: { get: () => true, set: () => {} },
            loop: { get: () => true, set: () => {} },
            playbackRate: { get: () => 1, set: () => {} },
            duration: { get: () => st.duration },
            frameRate: { get: () => st.fps },
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
        };
        // An <img> host keeps its own src (the poster); other hosts report the proxy url.
        if (host.tagName !== 'IMG') {
            props.src = { get: () => st.url, set: () => {} };
            props.currentSrc = { get: () => st.url };
        }
        Object.defineProperties(host, props);
        host.play = function () {
            if (st.destroyed) return Promise.reject(new DOMException('player destroyed', 'AbortError'));
            if (!st.playing) { st.playing = true; st.worker.postMessage({ t: 'play', id: st.id }); host.dispatchEvent(new Event('play')); }
            return Promise.resolve();
        };
        host.pause = function () {
            if (st.destroyed || !st.playing) return;
            st.currentTime = host.currentTime; // freeze the interpolated clock
            st.playing = false;
            st.worker.postMessage({ t: 'pause', id: st.id });
            host.dispatchEvent(new Event('pause'));
        };
        host.load = function () {};
        host.getVideoPlaybackQuality = function () {
            return { totalVideoFrames: st.decoded, droppedVideoFrames: st.dropped, corruptedVideoFrames: 0, creationTime: 0 };
        };
    }

    root.WcEngine = WcEngine;
    if (typeof module !== 'undefined' && module.exports) module.exports = { WcEngine, installFacade };
})(typeof window !== 'undefined' ? window : globalThis);
