/* global importScripts, Mp4Demux, VideoDecoder, EncodedVideoChunk, OffscreenCanvas */
/**
 * WebCodecs playback worker: decodes the grid's proxy videos with VideoDecoder
 * and paints them onto OffscreenCanvases, entirely off the main thread.
 *
 * Why not <video>: Chromium's media pipeline is a demuxer, a renderer and a
 * compositor callback per element on single threads, which on a fast GPU caps
 * at ~110 playing elements before every clock crawls. Here one worker drives
 * dozens of players from one requestAnimationFrame loop; the only per-frame
 * work outside this thread is the decode itself.
 *
 * A paused player keeps only its canvas: its decoder is closed shortly after
 * pausing (hundreds of idle hardware decoders starve the few that play and
 * pin a gigabyte of picture buffers) and recreated on play, resuming from the
 * keyframe before the paused position.
 *
 * Protocol (main -> worker): init {hw}, create {id, canvas, buffer, playing},
 * play {id}, pause {id}, seek {id, time}, destroy {id}.
 * (worker -> main): meta {id, width, height, duration, codec}, error {id, message},
 * stats {items: [{id, currentTime, decoded, dropped}]} every STATS_MS.
 */
'use strict';
importScripts('mp4-demux.js');

const AHEAD_FRAMES = 6;        // decoded frames kept ready per playing player
const PAUSED_FRAMES = 2;       // ... per paused player (the shown frame and one more)
const DECODE_QUEUE_MAX = 4;    // chunks in flight per decoder
const STATS_MS = 500;
const IDLE_CLOSE_MS = 300;     // a paused player gives its decoder up after this long

const players = new Map();
let hwPreference = 'prefer-hardware';
const supportCache = new Map(); // codec -> Promise<boolean>
let rafId = 0;
let statsTimer = 0;

function post(msg, transfer) { self.postMessage(msg, transfer || []); }

async function configSupported(config) {
    const key = `${config.codec}|${config.hardwareAcceleration}`;
    if (!supportCache.has(key)) {
        supportCache.set(key, VideoDecoder.isConfigSupported(config).then(r => !!(r && r.supported)).catch(() => false));
    }
    return supportCache.get(key);
}

async function createPlayer(msg) {
    const { id, canvas, buffer, playing } = msg;
    const p = {
        id, canvas, ctx: null, info: null, samples: null, decoder: null,
        queue: [],             // decoded VideoFrames in presentation order
        next: 0,               // next sample (decode order) to feed
        loopOffsetUs: 0,       // added to timestamps on each loop so they keep increasing
        playing: !!playing,
        baseUs: 0,             // media position when the clock last (re)started
        clockStartMs: 0,
        mediaUs: 0,            // presentation time of the frame on the canvas
        decoded: 0, dropped: 0,
        seekUs: null,          // pending seek target (frames before it are discarded)
        ended: false, destroyed: false, error: null,
        config: null, idleTimer: 0,
        seekSeq: 0,            // sequence number of the latest seek request
        landedSeq: 0,          // ... and of the latest one whose frame was presented
        statDirty: false,
    };
    players.set(id, p);
    try {
        const info = Mp4Demux.parse(buffer);
        if (!info.codec) throw new Error('unsupported codec');
        p.info = info; p.samples = info.samples; p.bytes = new Uint8Array(buffer);
        const config = { codec: info.codec, codedWidth: info.width, codedHeight: info.height, hardwareAcceleration: hwPreference, optimizeForLatency: true };
        if (info.description) config.description = info.description;
        if (!(await configSupported(config))) {
            // Fall back to whatever the browser has for this codec.
            config.hardwareAcceleration = 'no-preference';
            if (!(await configSupported(config))) throw new Error(`codec not supported: ${info.codec}`);
        }
        if (p.destroyed) return;
        canvas.width = info.width; canvas.height = info.height;
        p.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
        p.config = config;
        p.clockStartMs = performance.now();
        post({ t: 'meta', id, width: info.width, height: info.height, duration: info.durationUs / 1e6, codec: info.codec, hardware: config.hardwareAcceleration });
        // Decode the first frame so the card shows something, then idle unless playing.
        openDecoder(p);
        p.seekUs = 0;
        pump(p);
        ensureLoop();
    } catch (e) {
        p.error = e.message || String(e);
        post({ t: 'error', id, message: p.error });
    }
}

function openDecoder(p) {
    if (p.decoder && p.decoder.state !== 'closed') return;
    p.decoder = new VideoDecoder({
        output: (frame) => onFrame(p, frame),
        error: (e) => { p.error = e.message || String(e); post({ t: 'error', id: p.id, message: p.error }); },
    });
    p.decoder.configure(p.config);
}

function closeDecoder(p) {
    if (p.idleTimer) { clearTimeout(p.idleTimer); p.idleTimer = 0; }
    for (const f of p.queue) f.close();
    p.queue.length = 0;
    try { if (p.decoder && p.decoder.state !== 'closed') p.decoder.close(); } catch (e) { /* already closed */ }
    p.decoder = null;
}

function scheduleIdleClose(p, ms) {
    if (p.idleTimer) return;
    p.idleTimer = setTimeout(() => { p.idleTimer = 0; if (!p.playing && !p.destroyed && p.seekUs == null) closeDecoder(p); }, ms);
}

/** Restart decoding at the keyframe at or before tUs and present from tUs on. */
function startFrom(p, tUs) {
    let keyIndex = 0;
    for (let k = 0; k < p.samples.length; k++) { const s = p.samples[k]; if (s.key && s.timestamp <= tUs) keyIndex = k; if (s.timestamp > tUs && s.key) break; }
    p.next = keyIndex;
    p.loopOffsetUs = 0;
    p.seekUs = tUs;
}

function onFrame(p, frame) {
    if (p.destroyed) { frame.close(); return; }
    p.decoded++;
    // Frames before a seek target are discarded on arrival (the seek started at
    // the previous keyframe) except the last one before it, which fills the gap.
    if (p.seekUs != null && frame.timestamp < p.seekUs) {
        const q = p.queue;
        if (q.length && q[q.length - 1].timestamp < p.seekUs) q.pop().close();
        q.push(frame);
        return;
    }
    p.queue.push(frame);
    if (p.queue.length > 1 && p.queue[p.queue.length - 2].timestamp > frame.timestamp) {
        p.queue.sort((a, b) => a.timestamp - b.timestamp); // decoders output in order; belt and braces
    }
    if (!p.playing && p.seekUs == null) trimPaused(p);
}

function trimPaused(p) {
    // A paused player keeps only what it shows (plus one): hundreds of paused
    // cards must not pin hundreds of decoded frames each.
    while (p.queue.length > PAUSED_FRAMES) p.queue.shift().close();
}

/** Feed the decoder until enough is queued or in flight. */
function pump(p) {
    if (!p.decoder || p.decoder.state !== 'configured' || p.destroyed) return;
    const want = p.playing || p.seekUs != null ? AHEAD_FRAMES : PAUSED_FRAMES;
    while (p.queue.length + p.decoder.decodeQueueSize < want + DECODE_QUEUE_MAX && p.decoder.decodeQueueSize < DECODE_QUEUE_MAX) {
        if (p.next >= p.samples.length) {
            // Loop: continue with the first sample (a keyframe) and keep timestamps monotonic.
            p.next = 0;
            p.loopOffsetUs += p.info.durationUs;
        }
        const s = p.samples[p.next++];
        const data = p.bytes.subarray(s.offset, s.offset + s.size);
        try {
            p.decoder.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: s.timestamp + p.loopOffsetUs, duration: s.duration, data }));
        } catch (e) {
            p.error = e.message || String(e);
            post({ t: 'error', id: p.id, message: p.error });
            return;
        }
    }
}

/** Present: draw the newest frame whose time has come; skipped ones count as dropped. */
function present(p, nowMs) {
    if (!p.ctx || p.destroyed) return;
    const q = p.queue;
    if (p.seekUs != null) {
        // Seeking: show the first frame at or after the target, drop the rest.
        let i = q.findIndex(f => f.timestamp >= p.seekUs);
        if (i < 0 && q.length && p.next >= p.samples.length) i = q.length - 1; // target past the last frame
        if (i < 0) return; // still decoding toward the target
        for (let k = 0; k < i; k++) q[k].close();
        const f = q[i];
        q.splice(0, i + 1);
        draw(p, f);
        p.mediaUs = f.timestamp;
        p.baseUs = f.timestamp; p.clockStartMs = nowMs;
        p.seekUs = null;
        p.landedSeq = p.seekSeq;
        p.statDirty = true;
        if (!p.playing) { trimPaused(p); scheduleIdleClose(p, IDLE_CLOSE_MS); }
        return;
    }
    if (!p.playing || q.length === 0) return;
    const targetUs = p.baseUs + (nowMs - p.clockStartMs) * 1000;
    // Newest frame that is due.
    let i = -1;
    for (let k = 0; k < q.length; k++) { if (q[k].timestamp <= targetUs) i = k; else break; }
    if (i < 0) return; // the next frame is not due yet
    for (let k = 0; k < i; k++) { q[k].close(); p.dropped++; } // due but superseded: dropped
    const f = q[i];
    q.splice(0, i + 1);
    draw(p, f);
    p.mediaUs = f.timestamp;
}

function draw(p, frame) {
    try {
        p.ctx.drawImage(frame, 0, 0, p.canvas.width, p.canvas.height);
    } catch (e) {
        // A closed or detached frame: nothing to show this tick.
    } finally {
        frame.close();
    }
}

function tick() {
    rafId = 0;
    const now = performance.now();
    let active = false;
    for (const p of players.values()) {
        if (p.destroyed || !p.ctx) continue;
        present(p, now);
        pump(p);
        if (p.playing || p.seekUs != null) active = true;
    }
    if (active) ensureLoop();
}

function ensureLoop() {
    if (!rafId) rafId = self.requestAnimationFrame(tick);
}

function play(p) {
    if (p.playing || p.destroyed || !p.config) return;
    if (p.idleTimer) { clearTimeout(p.idleTimer); p.idleTimer = 0; }
    p.playing = true;
    if (!p.decoder) {
        // Resume where it paused: the decoder was given up while idle.
        openDecoder(p);
        startFrom(p, p.mediaUs % Math.max(1, p.info.durationUs));
    }
    p.baseUs = p.mediaUs;
    p.clockStartMs = performance.now();
    pump(p);
    ensureLoop();
}

function pause(p) {
    if (!p.playing) return;
    p.playing = false;
    trimPaused(p);
    scheduleIdleClose(p, IDLE_CLOSE_MS);
}

function seek(p, timeS, seq) {
    if (!p.config || !p.samples || p.destroyed) return;
    if (seq != null) p.seekSeq = seq;
    const durUs = p.info.durationUs || 1;
    const tUs = Math.max(0, Math.min(durUs - 1, Math.round(timeS * 1e6)));
    if (p.idleTimer) { clearTimeout(p.idleTimer); p.idleTimer = 0; }
    // A fresh decoder is the reliable way to restart from a keyframe.
    closeDecoder(p);
    openDecoder(p);
    startFrom(p, tUs);
    pump(p);
    ensureLoop();
}

function destroy(p) {
    p.destroyed = true;
    players.delete(p.id);
    closeDecoder(p);
    p.bytes = null; p.samples = null; p.ctx = null; p.canvas = null;
}

function sendStats() {
    const items = [];
    for (const p of players.values()) {
        if (p.destroyed || (!p.playing && !p.statDirty) || p.seekUs != null) continue; // nothing to say until a pending seek lands
        p.statDirty = p.playing; // a player that just paused reports once more (its final position)
        items.push({ id: p.id, currentTime: p.mediaUs / 1e6, decoded: p.decoded, dropped: p.dropped, playing: p.playing, seq: p.landedSeq });
    }
    if (items.length) post({ t: 'stats', items });
}

self.onmessage = (e) => {
    const m = e.data;
    switch (m.t) {
        case 'init':
            hwPreference = m.hw || hwPreference;
            if (!statsTimer) statsTimer = setInterval(sendStats, STATS_MS);
            break;
        case 'create': createPlayer(m); break;
        case 'play': { const p = players.get(m.id); if (p) play(p); break; }
        case 'pause': { const p = players.get(m.id); if (p) pause(p); break; }
        case 'seek': { const p = players.get(m.id); if (p) seek(p, m.time, m.seq); break; }
        case 'destroy': { const p = players.get(m.id); if (p) destroy(p); break; }
        default: break;
    }
};
