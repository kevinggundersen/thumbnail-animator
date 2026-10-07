/**
 * Worker thread for thumbnail generation.
 * Handles both image (via sharp) and video (via ffmpeg) thumbnails.
 * Runs off the main process to keep IPC responsive during heavy thumbnail workloads.
 *
 * Piscina protocol: export a single async function that processes one item.
 */
const Piscina = require('piscina');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ffmpegPath = Piscina.workerData.ffmpegPath || null;
const ffprobePath = Piscina.workerData.ffprobePath || null;
const MAX_CONCURRENT_FFMPEG = 4;

let sharp;
try {
    sharp = require('sharp');
    // Limit sharp's own thread pool to avoid over-subscription
    sharp.concurrency(2);
} catch {
    sharp = null;
}

let activeFfmpegCount = 0;
const ffmpegQueue = [];

function runFfmpegBounded(args, timeout = 10000) {
    return new Promise((resolve) => {
        const execute = () => {
            activeFfmpegCount++;
            execFile(ffmpegPath, args, { timeout }, (err) => {
                activeFfmpegCount--;
                if (err) {
                    resolve(false);
                } else {
                    resolve(true);
                }
                // Drain queue
                if (ffmpegQueue.length > 0 && activeFfmpegCount < MAX_CONCURRENT_FFMPEG) {
                    const next = ffmpegQueue.shift();
                    next();
                }
            });
        };

        if (activeFfmpegCount < MAX_CONCURRENT_FFMPEG) {
            execute();
        } else {
            ffmpegQueue.push(execute);
        }
    });
}

function getVideoDuration(filePath) {
    if (!ffprobePath) return Promise.resolve(null);
    return new Promise((resolve) => {
        execFile(ffprobePath, [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'csv=p=0',
            filePath
        ], { timeout: 5000 }, (err, stdout) => {
            if (err || !stdout) return resolve(null);
            const dur = parseFloat(stdout.trim());
            resolve(isFinite(dur) && dur > 0 ? dur : null);
        });
    });
}

async function generateVideoThumbnail(filePath, thumbPath) {
    if (!ffmpegPath) return false;
    try {
        await fs.promises.mkdir(path.dirname(thumbPath), { recursive: true });
        const duration = await getVideoDuration(filePath);
        const seekTime = duration ? Math.min(duration * 0.25, 10) : 1;
        const success = await runFfmpegBounded([
            '-ss', String(seekTime),
            '-i', filePath,
            '-vframes', '1',
            '-q:v', '6',
            '-vf', 'scale=320:-2',
            '-y',
            thumbPath
        ]);
        if (!success) {
            fs.promises.unlink(thumbPath).catch(() => {});
        }
        return success;
    } catch {
        fs.promises.unlink(thumbPath).catch(() => {});
        return false;
    }
}

// ── Grid playback proxies ───────────────────────────────────────────────────
// A small H.264 rendition (long edge `edge` px, at most `maxFps`, no audio, the
// first `maxSeconds` seconds) that the grid plays instead of the original file.
// Decoding dozens of 1080p/4K 60 fps originals at thumbnail size saturates the
// hardware decoder long before the CPU is busy; a 480p/30 rendition costs a
// fraction of that per card.

function probeVideoStream(filePath) {
    if (!ffprobePath) return Promise.resolve(null);
    return new Promise((resolve) => {
        execFile(ffprobePath, [
            '-v', 'error',
            '-show_entries', 'stream=codec_type,width,height,r_frame_rate,avg_frame_rate:format=duration',
            '-of', 'json', filePath
        ], { timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
            if (err || !stdout) return resolve(null);
            try {
                const j = JSON.parse(stdout);
                const streams = Array.isArray(j.streams) ? j.streams : [];
                const v = streams.find(s => s.codec_type === 'video') || {};
                const fpsOf = (r) => { if (!r || typeof r !== 'string') return 0; const [n, d] = r.split('/').map(Number); return d ? n / d : (n || 0); };
                const fps = fpsOf(v.avg_frame_rate) || fpsOf(v.r_frame_rate) || 0;
                const duration = parseFloat(j.format && j.format.duration);
                resolve({
                    width: v.width | 0, height: v.height | 0, fps,
                    duration: isFinite(duration) && duration > 0 ? duration : null,
                    hasAudio: streams.some(s => s.codec_type === 'audio'),
                });
            } catch { resolve(null); }
        });
    });
}

async function generateVideoProxy(filePath, outPath, { edge = 480, maxSeconds = 120, maxFps = 30, encoder = 'libx264', animated = false } = {}) {
    if (!ffmpegPath) return false;
    // Encode to a temporary name and rename at the end so a half-written file is
    // never served as a finished proxy.
    const partPath = `${outPath}.part.mp4`;
    try {
        await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
        const info = await probeVideoStream(filePath);
        const filters = [];
        if (info && info.width > 0 && info.height > 0) {
            const longEdge = Math.max(info.width, info.height);
            if (longEdge > edge) {
                // Long edge to `edge`, aspect kept, even dimensions for yuv420p.
                const scale = edge / longEdge;
                const w = Math.max(2, Math.round(info.width * scale / 2) * 2);
                const h = Math.max(2, Math.round(info.height * scale / 2) * 2);
                filters.push(`scale=${w}:${h}:flags=bicubic`);
            }
        } else {
            // Size unknown: cap both edges without upscaling.
            filters.push(`scale='min(${edge},iw)':'min(${edge},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`);
        }
        // GIF/WebP frames carry their own delays; the mp4 gets a constant rate.
        if (animated) filters.push(`fps=${Math.min(maxFps, Math.max(5, Math.round((info && info.fps) || maxFps)))}`);
        else if (!info || !info.fps || info.fps > maxFps + 0.5) filters.push(`fps=${maxFps}`);
        filters.push('format=yuv420p');
        const codecArgs = encoder === 'libopenh264'
            ? ['-c:v', 'libopenh264', '-b:v', '1200k', '-maxrate', '1600k', '-bufsize', '2400k']
            : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-profile:v', 'main', '-tune', 'fastdecode', '-x264-params', 'threads=2'];
        const args = [
            '-hide_banner', '-loglevel', 'error', '-nostdin',
            '-threads', '2',                 // decoder threads: keep the machine usable while encoding
            '-i', filePath,
            '-map', '0:v:0', '-an', '-sn', '-dn',
            ...(maxSeconds > 0 ? ['-t', String(maxSeconds)] : []),
            '-vf', filters.join(','),
            ...codecArgs,
            '-threads', '2',
            '-g', String(maxFps * 2),
            '-movflags', '+faststart',
            '-f', 'mp4', '-y', partPath
        ];
        const coveredSeconds = maxSeconds > 0 ? maxSeconds : ((info && info.duration) || 600);
        const timeoutMs = Math.min(600000, 60000 + coveredSeconds * 1000);
        const success = await runFfmpegBounded(args, timeoutMs);
        if (!success) { fs.promises.unlink(partPath).catch(() => {}); return false; }
        await fs.promises.rename(partPath, outPath);
        return true;
    } catch {
        fs.promises.unlink(partPath).catch(() => {});
        return false;
    }
}

async function generatePreviewStripFrames(filePath, thumbPaths, positions) {
    if (!ffmpegPath) return { success: false, thumbPaths: [] };
    const results = [];
    for (let i = 0; i < positions.length; i++) {
        const outPath = thumbPaths[i];
        // Check if this frame is already cached on disk
        try {
            await fs.promises.access(outPath);
            results.push(outPath);
            continue;
        } catch { /* not cached */ }

        await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
        const success = await runFfmpegBounded([
            '-ss', String(positions[i]),
            '-i', filePath,
            '-vframes', '1',
            '-q:v', '6',
            '-vf', 'scale=120:-2',
            '-y',
            outPath
        ]);
        if (success) {
            results.push(outPath);
        }
    }
    return { success: results.length > 0, thumbPaths: results };
}

// Encoder follows the destination extension: the cache uses .webp (lossy, alpha kept,
// a fraction of PNG's bytes); PNG remains available for callers that ask for it.
function encodeThumb(pipeline, thumbPath) {
    return thumbPath.toLowerCase().endsWith('.webp') ? pipeline.webp({ quality: 82 }) : pipeline.png();
}

async function generateImageThumbnail(filePath, thumbPath, maxSize = 512) {
    if (!sharp) return { success: false, dHash: null };
    try {
        await fs.promises.mkdir(path.dirname(thumbPath), { recursive: true });
        const metadata = await sharp(filePath).metadata();
        if (!metadata.width || !metadata.height) return { success: false, dHash: null };

        const longestEdge = Math.max(metadata.width, metadata.height);
        if (longestEdge <= maxSize) {
            // Image is already small enough, just re-encode
            await encodeThumb(sharp(filePath), thumbPath).toFile(thumbPath);
        } else {
            const scale = maxSize / longestEdge;
            await encodeThumb(sharp(filePath)
                .resize(
                    Math.max(1, Math.round(metadata.width * scale)),
                    Math.max(1, Math.round(metadata.height * scale)),
                    { fit: 'inside', withoutEnlargement: true }
                ), thumbPath)
                .toFile(thumbPath);
        }
        return { success: true, dHash: null };
    } catch {
        fs.promises.unlink(thumbPath).catch(() => {});
        return { success: false, dHash: null };
    }
}

function computeDHashFromPixels(pixels) {
    const bytes = new Uint8Array(8);
    let byteIdx = 0, bitIdx = 7;
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            if (pixels[row * 9 + col] > pixels[row * 9 + col + 1]) {
                bytes[byteIdx] |= (1 << bitIdx);
            }
            if (--bitIdx < 0) { bitIdx = 7; byteIdx++; }
        }
    }
    return Buffer.from(bytes).toString('hex');
}

async function computeDHashForFile(filePath) {
    if (!sharp) return null;
    try {
        const pixels = await sharp(filePath)
            .greyscale()
            .resize(9, 8, { fit: 'fill' })
            .raw()
            .toBuffer();
        return computeDHashFromPixels(pixels);
    } catch {
        return null;
    }
}

module.exports = async function(item) {
    try {
        // Preview-strip has its own per-frame caching — handle before the single-thumb path
        if (item.type === 'preview-strip') {
            const result = await generatePreviewStripFrames(item.filePath, item.thumbPaths, item.positions);
            return { success: result.success, thumbPaths: result.thumbPaths };
        }

        if (item.type === 'video-proxy') {
            try {
                await fs.promises.access(item.thumbPath);
                return { success: true, thumbPath: item.thumbPath, dHash: null };
            } catch { /* generate */ }
            const ok = await generateVideoProxy(item.filePath, item.thumbPath, item.proxy || {});
            return { success: ok, thumbPath: ok ? item.thumbPath : null, dHash: null };
        }

        // Check if already cached
        let alreadyCached = false;
        try {
            await fs.promises.access(item.thumbPath);
            alreadyCached = true;
        } catch { /* not cached */ }

        let success = false;
        let dHash = null;

        if (alreadyCached) {
            success = true;
            // Compute dHash from the existing thumbnail if requested
            if (item.computeDHash) {
                dHash = await computeDHashForFile(item.thumbPath);
            }
        } else if (item.type === 'video') {
            success = await generateVideoThumbnail(item.filePath, item.thumbPath);
            if (success && item.computeDHash) {
                dHash = await computeDHashForFile(item.thumbPath);
            }
        } else if (item.type === 'image') {
            const result = await generateImageThumbnail(item.filePath, item.thumbPath, item.maxSize || 512);
            success = result.success;
            if (success && item.computeDHash) {
                dHash = await computeDHashForFile(item.thumbPath);
            }
        }

        return { success, thumbPath: success ? item.thumbPath : null, dHash };
    } catch {
        return { success: false, thumbPath: null, dHash: null };
    }
};
