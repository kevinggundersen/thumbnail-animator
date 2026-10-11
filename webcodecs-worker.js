/* global importScripts, Mp4Demux, VideoDecoder, EncodedVideoChunk */
/**
 * WebCodecs playback worker: decodes the grid's proxy videos with VideoDecoder
 * and paints every playing card into ONE sheet canvas that covers the grid's
 * viewport, entirely off the main thread.
 *
 * Why one sheet: a canvas per card is a compositor layer per card, and every
 * frame painted into it is a commit that crosses the renderer main thread and
 * the GPU process main thread. With 127 cards that was 13,000 GPU-process
 * tasks and 77,000 paints per 6 s, the GPU main thread at 99%, the renderer
 * main thread at 60%: the whole UI lagged. One sheet is one commit per frame.
 *
 * A paused player keeps only its last frame; its decoder is closed shortly
 * after pausing (hundreds of idle decoders starve the few that play) and
 * recreated on play, resuming from the keyframe before the paused position.
 *
 * Protocol (main -> worker): init {sheet, hw}, layout {w, h, dpr, cells:[{id,x,y,w,h,r}]},
 * create {id, buffer, playing}, play {id}, pause {id}, seek {id, time, seq},
 * destroy {id}, hover {id, rect|null}, hidden {hidden}.
 * (worker -> main): meta {id, width, height, duration, codec, hardware},
 * error {id, message}, stats {items:[{id, currentTime, decoded, dropped, playing, seq}]}.
 */
'use strict';
importScripts('mp4-demux.js');

const AHEAD_FRAMES = 6;        // decoded frames kept ready per playing player
const PAUSED_FRAMES = 1;       // ... per paused player
const DECODE_QUEUE_MAX = 4;    // chunks in flight per decoder
const STATS_MS = 500;
const IDLE_CLOSE_MS = 300;     // a paused player gives its decoder up after this long
const PRESENT_INTERVAL_MS = 1000 / 31; // the sheet commits at most ~30 times a second: each commit
                                       // costs the renderer main thread a paint and a layerize pass
let lastPresentMs = 0;

const players = new Map();
let hwPreference = 'prefer-software';
const supportCache = new Map(); // codec|hw -> Promise<boolean>
let rafId = 0;
let statsTimer = 0;

// The sheet: one canvas for every cell.
let sheet = null, ctx = null, sheetW = 0, sheetH = 0, dpr = 1;
let hidden = false;            // the grid is scrolling: cards show posters, nothing is painted
let hover = null;              // { id, rect }: the hovered card's cell, drawn last at its scaled rect
let needsFullRedraw = false;

function post(msg, transfer) { self.postMessage(msg, transfer || []); }

async function configSupported(config) {
    const key = `${config.codec}|${config.hardwareAcceleration}`;
    if (!supportCache.has(key)) {
        supportCache.set(key, VideoDecoder.isConfigSupported(config).then(r => !!(r && r.supported)).catch(() => false));
    }
    return supportCache.get(key);
}

// ── Players ─────────────────────────────────────────────────────────────────

async function createPlayer(msg) {
    const { id, buffer, playing } = msg;
    const p = {
        id, info: null, samples: null, bytes: null, decoder: null, config: null,
        cell: null,            // { x, y, w, h, r } in sheet CSS pixels
        queue: [],             // decoded VideoFrames in presentation order
        last: null,            // the frame on the sheet (kept for redraws)
        next: 0,               // next sample (decode order) to feed
        loopOffsetUs: 0,       // added to timestamps on each loop so they keep increasing
        playing: !!playing,
        baseUs: 0, clockStartMs: 0,
        mediaUs: 0,            // presentation time of the frame on the sheet
        decoded: 0, dropped: 0,
        seekUs: null,          // pending seek target (frames before it are discarded)
        seekSeq: 0, landedSeq: 0, statDirty: false,
        idleTimer: 0, destroyed: false, error: null,
    };
    players.set(id, p);
    try {
        const info = Mp4Demux.parse(buffer);
        if (!info.codec) throw new Error('unsupported codec');
        p.info = info; p.samples = info.samples; p.bytes = new Uint8Array(buffer);
        const config = { codec: info.codec, codedWidth: info.width, codedHeight: info.height, hardwareAcceleration: hwPreference, optimizeForLatency: true };
        if (info.description) config.description = info.description;
        if (!(await configSupported(config))) {
            config.hardwareAcceleration = 'no-preference';
            if (!(await configSupported(config))) throw new Error(`codec not supported: ${info.codec}`);
        }
        if (p.destroyed) return;
        p.config = config;
        p.clockStartMs = performance.now();
        const fps = info.durationUs > 0 ? Math.round(info.samples.length / (info.durationUs / 1e6) * 10) / 10 : 30;
        post({ t: 'meta', id, width: info.width, height: info.height, duration: info.durationUs / 1e6, fps, codec: info.codec, hardware: config.hardwareAcceleration });
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
}

/** Feed the decoder until enough is queued or in flight. */
function pump(p) {
    if (!p.decoder || p.decoder.state !== 'configured' || p.destroyed) return;
    const want = p.playing || p.seekUs != null ? AHEAD_FRAMES : PAUSED_FRAMES;
    while (p.queue.length < want && p.decoder.decodeQueueSize < DECODE_QUEUE_MAX) {
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
    p.statDirty = true;
    while (p.queue.length > PAUSED_FRAMES) p.queue.shift().close();
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
    if (p.last) { p.last.close(); p.last = null; }
    if (p.cell && ctx && !hidden) clearCell(p.cell);
    if (hover && hover.id === p.id) hover = null;
    p.bytes = null; p.samples = null; p.cell = null;
}

// ── Presentation ────────────────────────────────────────────────────────────

/** Take the frame that should be on the sheet now (if a new one is due) and draw it. */
function present(p, nowMs) {
    if (p.destroyed || !p.config) return;
    const q = p.queue;
    let frame = null;
    if (p.seekUs != null) {
        // Seeking: show the first frame at or after the target, drop the rest.
        let i = q.findIndex(f => f.timestamp >= p.seekUs);
        if (i < 0 && q.length && p.next >= p.samples.length) i = q.length - 1; // target past the last frame
        if (i < 0) return; // still decoding toward the target
        for (let k = 0; k < i; k++) q[k].close();
        frame = q[i];
        q.splice(0, i + 1);
        p.baseUs = frame.timestamp; p.clockStartMs = nowMs;
        p.seekUs = null;
        p.landedSeq = p.seekSeq;
        p.statDirty = true;
        if (!p.playing) scheduleIdleClose(p, IDLE_CLOSE_MS);
    } else {
        if (!p.playing || q.length === 0) return;
        const targetUs = p.baseUs + (nowMs - p.clockStartMs) * 1000;
        let i = -1;
        for (let k = 0; k < q.length; k++) { if (q[k].timestamp <= targetUs) i = k; else break; }
        if (i < 0) return; // the next frame is not due yet
        // Superseded frames: a drop only when clearly late (more than two frame
        // durations overdue). Two frames coming due inside one presentation
        // interval is normal cadence on a high-refresh display, not trouble;
        // counting it as 2% drops held the budget forever.
        for (let k = 0; k < i; k++) {
            const f = q[k];
            if (targetUs - f.timestamp > 2.5 * (f.duration || 33333)) p.dropped++;
            f.close();
        }
        frame = q[i];
        q.splice(0, i + 1);
    }
    if (p.last) p.last.close();
    p.last = frame;
    p.mediaUs = frame.timestamp;
    if (!hidden) drawCell(p);
}

function cellRect(p) {
    if (hover && hover.id === p.id && hover.rect) return hover.rect;
    return p.cell;
}

function clearCell(c) {
    ctx.clearRect(Math.floor(c.x * dpr) - 1, Math.floor(c.y * dpr) - 1, Math.ceil(c.w * dpr) + 2, Math.ceil(c.h * dpr) + 2);
}

function drawCell(p) {
    const c = cellRect(p);
    if (!c || !p.last || !ctx) return;
    const x = c.x * dpr, y = c.y * dpr, w = c.w * dpr, h = c.h * dpr, r = (c.r || 0) * dpr;
    if (w <= 0 || h <= 0 || x > sheetW * dpr || y > sheetH * dpr || x + w < 0 || y + h < 0) return;
    ctx.save();
    ctx.beginPath();
    if (r > 0 && typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
    ctx.clip();
    // object-fit: cover
    const fw = p.last.displayWidth || p.info.width, fh = p.last.displayHeight || p.info.height;
    const scale = Math.max(w / fw, h / fh);
    const dw = fw * scale, dh = fh * scale;
    try { ctx.drawImage(p.last, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); } catch (e) { /* a closed frame: nothing this tick */ }
    ctx.restore();
}

function redrawAll() {
    if (!ctx) return;
    ctx.clearRect(0, 0, sheet.width, sheet.height);
    needsFullRedraw = false;
    if (hidden) return;
    for (const p of players.values()) if (!p.destroyed && p.cell && !(hover && hover.id === p.id)) drawCell(p);
    if (hover) { const hp = players.get(hover.id); if (hp && !hp.destroyed) drawCell(hp); }
}

function tick() {
    rafId = 0;
    const now = performance.now();
    let active = false;
    // Decoders are kept fed every frame; the sheet is only touched at the
    // presentation rate (plus seeks and relayouts, which must not wait).
    const presentNow = needsFullRedraw || now - lastPresentMs >= PRESENT_INTERVAL_MS - 1;
    if (presentNow) {
        lastPresentMs = now;
        if (needsFullRedraw) redrawAll();
    }
    for (const p of players.values()) {
        if (p.destroyed || !p.config) continue;
        if (presentNow || p.seekUs != null) present(p, now);
        pump(p);
        if (p.playing || p.seekUs != null) active = true;
    }
    if (active) ensureLoop();
}

function ensureLoop() {
    if (!rafId) rafId = self.requestAnimationFrame(tick);
}

function applyLayout(m) {
    if (!sheet) return;
    dpr = m.dpr || 1;
    if (sheetW !== m.w || sheetH !== m.h || sheet.width !== Math.round(m.w * dpr) || sheet.height !== Math.round(m.h * dpr)) {
        sheetW = m.w; sheetH = m.h;
        sheet.width = Math.round(m.w * dpr);
        sheet.height = Math.round(m.h * dpr);
    }
    const seen = new Set();
    for (const c of m.cells) {
        const p = players.get(c.id);
        if (!p) continue;
        p.cell = { x: c.x, y: c.y, w: c.w, h: c.h, r: c.r || 0 };
        seen.add(c.id);
    }
    for (const p of players.values()) if (!seen.has(p.id)) p.cell = null; // off the sheet (outside the viewport)
    needsFullRedraw = true;
    ensureLoop();
}

function sendStats() {
    const items = [];
    for (const p of players.values()) {
        if (p.destroyed || (!p.playing && !p.statDirty) || p.seekUs != null) continue; // nothing to say until a pending seek lands
        p.statDirty = false;
        items.push({ id: p.id, currentTime: p.mediaUs / 1e6, decoded: p.decoded, dropped: p.dropped, playing: p.playing, seq: p.landedSeq });
    }
    if (items.length) post({ t: 'stats', items });
}

self.onmessage = (e) => {
    const m = e.data;
    switch (m.t) {
        case 'init':
            if (m.hw) hwPreference = m.hw;
            if (m.sheet) { sheet = m.sheet; ctx = sheet.getContext('2d', { alpha: true }); }
            if (!statsTimer) statsTimer = setInterval(sendStats, STATS_MS);
            break;
        case 'layout': applyLayout(m); break;
        case 'create': createPlayer(m); break;
        case 'play': { const p = players.get(m.id); if (p) play(p); break; }
        case 'pause': { const p = players.get(m.id); if (p) pause(p); break; }
        case 'seek': { const p = players.get(m.id); if (p) seek(p, m.time, m.seq); break; }
        case 'destroy': { const p = players.get(m.id); if (p) destroy(p); break; }
        case 'hover': hover = m.id != null && m.rect ? { id: m.id, rect: m.rect } : null; needsFullRedraw = true; ensureLoop(); break;
        case 'hidden': hidden = !!m.hidden; if (!hidden) { needsFullRedraw = true; ensureLoop(); } break;
        default: break;
    }
};
