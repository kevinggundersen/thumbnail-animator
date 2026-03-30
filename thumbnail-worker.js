/**
 * Worker thread for thumbnail generation.
 * Handles both image (via sharp) and video (via ffmpeg) thumbnails.
 * Runs off the main process to keep IPC responsive during heavy thumbnail workloads.
 *
 * Message protocol:
 *   Request:  { id, type: 'image'|'video', filePath, thumbPath, maxSize?, ffmpegPath?, ffprobePath? }
 *   Response: { id, type: 'result', success, thumbPath? }
 *   Batch:    { id, type: 'batch', items: Array<Request> }
 *   Response: { id, type: 'batch-result', results: Array<Response> }
 */
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ffmpegPath = workerData.ffmpegPath || null;
const ffprobePath = workerData.ffprobePath || null;
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

async function generateImageThumbnail(filePath, thumbPath, maxSize = 512) {
    if (!sharp) return false;
    try {
        await fs.promises.mkdir(path.dirname(thumbPath), { recursive: true });
        const metadata = await sharp(filePath).metadata();
        if (!metadata.width || !metadata.height) return false;

        const longestEdge = Math.max(metadata.width, metadata.height);
        if (longestEdge <= maxSize) {
            // Image is already small enough, just copy as PNG
            await sharp(filePath).png().toFile(thumbPath);
        } else {
            const scale = maxSize / longestEdge;
            await sharp(filePath)
                .resize(
                    Math.max(1, Math.round(metadata.width * scale)),
                    Math.max(1, Math.round(metadata.height * scale)),
                    { fit: 'inside', withoutEnlargement: true }
                )
                .png()
                .toFile(thumbPath);
        }
        return true;
    } catch {
        fs.promises.unlink(thumbPath).catch(() => {});
        return false;
    }
}

async function processItem(item) {
    try {
        // Check if already cached
        try {
            await fs.promises.access(item.thumbPath);
            return { id: item.id, type: 'result', success: true, thumbPath: item.thumbPath };
        } catch { /* not cached */ }

        let success = false;
        if (item.type === 'video') {
            success = await generateVideoThumbnail(item.filePath, item.thumbPath);
        } else if (item.type === 'image') {
            success = await generateImageThumbnail(item.filePath, item.thumbPath, item.maxSize || 512);
        }

        return { id: item.id, type: 'result', success, thumbPath: success ? item.thumbPath : null };
    } catch {
        return { id: item.id, type: 'result', success: false, thumbPath: null };
    }
}

parentPort.on('message', async (msg) => {
    if (msg.type === 'image' || msg.type === 'video') {
        const result = await processItem(msg);
        parentPort.postMessage(result);
    } else if (msg.type === 'batch') {
        // Process batch items with bounded concurrency
        const BATCH_CONCURRENCY = 6;
        const results = [];
        const items = msg.items || [];

        // Process in chunks for bounded concurrency
        for (let i = 0; i < items.length; i += BATCH_CONCURRENCY) {
            const chunk = items.slice(i, i + BATCH_CONCURRENCY);
            const chunkResults = await Promise.all(chunk.map(processItem));
            results.push(...chunkResults);

            // Stream intermediate results back so renderer gets thumbnails ASAP
            for (const r of chunkResults) {
                parentPort.postMessage(r);
            }
        }

        parentPort.postMessage({ id: msg.id, type: 'batch-complete', count: results.length });
    }
});
