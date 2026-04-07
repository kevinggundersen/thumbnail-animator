// Increase libuv threadpool for parallel stat() calls (must be before any async I/O)
process.env.UV_THREADPOOL_SIZE = '16';

// ── Startup Timeline (always-on, runs once) ──────────────────────────────────
const { performance } = require('perf_hooks');
const startupT0 = performance.now();
const startupTimeline = [];
function markStartup(phase) {
    startupTimeline.push({ phase, time: Math.round((performance.now() - startupT0) * 100) / 100 });
}
markStartup('process-start');

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION:', err);
});

const { app, BrowserWindow, Menu, ipcMain, dialog, shell, screen, nativeImage, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const DimensionWorkerPool = require('./worker-pool');
const ThumbnailWorkerPool = require('./thumbnail-pool');
const HashWorkerPool = require('./hash-pool');
const ClipPreprocessPool = require('./clip-preprocess-pool');
const PluginRegistry = require('./plugins/plugin-registry');
const DatabaseProxy = require('./database-proxy');
const {
    validateUserPath, pathToFileUrl, fileUrlToPath, createThumbCacheKey,
    formatFileSize, safeMove, moveToStaging, restoreFromStaging, writeCrashLog,
    asyncPool, matchesCheapRules, POPCOUNT_TABLE, hammingDistance,
    _qualityToParams, buildFfmpegArgs, _parseFfmpegProgressChunk,
} = require('./main-utils');
// CLIP inference runs directly in the main process to avoid native module ABI
// issues in Electron worker threads.  Preprocessing (sharp resize/crop/normalise)
// is offloaded to a worker pool (ClipPreprocessPool) so it overlaps with inference.
// image-size: lazy-loaded on first use (saves ~15ms at startup)
let sizeOf = undefined; // undefined = not yet loaded, null = failed to load
function getSizeOf() {
    if (sizeOf !== undefined) return sizeOf;
    try {
        const imageSizeModule = require('image-size');
        if (typeof imageSizeModule === 'function') {
            sizeOf = imageSizeModule;
        } else if (imageSizeModule && typeof imageSizeModule.imageSize === 'function') {
            sizeOf = imageSizeModule.imageSize;
        } else if (imageSizeModule && typeof imageSizeModule.default === 'function') {
            sizeOf = imageSizeModule.default;
        } else {
            sizeOf = imageSizeModule;
        }
    } catch (error) {
        console.warn('image-size module not available:', error);
        sizeOf = null;
    }
    return sizeOf;
}
let nativeScanner;
try {
    nativeScanner = require('./native-scanner');
    console.log('[scanner] Native Rust scanner loaded (FindFirstFileExW)');
    if (nativeScanner.generateImageThumbnails) {
        console.log('[thumbnails] Native Rust image pipeline available (rayon-parallel)');
    } else {
        console.warn('[thumbnails] Native scanner loaded but generateImageThumbnails missing — rebuild native-scanner');
    }
} catch (e) {
    console.warn('[scanner] Native scanner NOT available — using JS fallback. Reason:', e.message);
    nativeScanner = null;
}
const { execFile } = require('child_process');
// electron-updater: lazy-loaded in app.whenReady() (saves ~20ms at startup)
let autoUpdater = null;
markStartup('modules-loaded');

const PERF_TEST_ENABLED = process.env.PERF_TEST === '1';

function logPerf(operation, startTime, details = {}) {
    if (!PERF_TEST_ENABLED || !startTime) return;
    const duration = Math.round((performance.now() - startTime) * 100) / 100;
    const suffix = Object.entries(details)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ');
    console.log(`[Perf] ${operation}: ${duration}ms${suffix ? ` ${suffix}` : ''}`);
}

async function readImageHeader(filePath, maxBytes = 16 * 1024) {
    const fd = await fs.promises.open(filePath, 'r');
    try {
        const buffer = Buffer.alloc(maxBytes);
        const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytesRead);
    } finally {
        await fd.close();
    }
}

// Detect ffprobe/ffmpeg availability — async to avoid blocking startup.
// Worker pools are created after detection completes; call sites already
// guard with `if (dimensionPool)` / `if (thumbnailPool)` so null is safe.
let ffprobePath = null;
let ffmpegPath = null;
let ffToolsReady = false;

// Worker pool for parallel dimension scanning (created after fftools detected)
let dimensionPool = null;

// Worker pool for thumbnail generation (created after fftools detected)
let thumbnailPool = null;

(async function detectFfTools() {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const cacheDir = app.isPackaged ? app.getPath('userData') : path.join(__dirname, 'electron-cache');
    const cachePath = path.join(cacheDir, 'fftools-cache.json');

    /** Test a binary path asynchronously, return true if it works */
    async function testBinary(bin, timeout = 2000) {
        try {
            await execFileAsync(bin, ['-version'], { stdio: 'ignore', timeout });
            return true;
        } catch { return false; }
    }

    // Try loading from cache — validate with fs.existsSync for absolute paths,
    // async exec only for bare names (on PATH)
    try {
        const cached = JSON.parse(await fs.promises.readFile(cachePath, 'utf8'));
        const probeOk = cached.ffprobe && (
            path.isAbsolute(cached.ffprobe)
                ? fs.existsSync(cached.ffprobe)
                : await testBinary(cached.ffprobe, 1000)
        );
        const mpegOk = cached.ffmpeg && (
            path.isAbsolute(cached.ffmpeg)
                ? fs.existsSync(cached.ffmpeg)
                : await testBinary(cached.ffmpeg, 1000)
        );
        if (probeOk) ffprobePath = cached.ffprobe;
        if (mpegOk) ffmpegPath = cached.ffmpeg;
        if (ffprobePath && ffmpegPath) {
            console.log('ffprobe found (cached):', ffprobePath);
            console.log('ffmpeg found (cached):', ffmpegPath);
        }
    } catch { /* no cache or invalid */ }

    // Full detection for any tools not found in cache — test candidates in parallel
    if (!ffprobePath) {
        const probeCandidates = process.platform === 'win32' ? ['ffprobe', 'ffprobe.exe'] : ['ffprobe'];
        for (const candidate of probeCandidates) {
            if (await testBinary(candidate, 3000)) {
                ffprobePath = candidate;
                console.log('ffprobe found:', candidate);
                break;
            }
        }
        if (!ffprobePath) console.log('ffprobe not found — video dimensions will be detected on load');
    }

    if (!ffmpegPath) {
        const mpegCandidates = process.platform === 'win32' ? ['ffmpeg', 'ffmpeg.exe'] : ['ffmpeg'];
        for (const candidate of mpegCandidates) {
            if (await testBinary(candidate, 3000)) {
                ffmpegPath = candidate;
                console.log('ffmpeg found:', candidate);
                break;
            }
        }
        if (!ffmpegPath) console.log('ffmpeg not found — video thumbnails will not be generated');
    }

    // Cache results for next launch
    try {
        await fs.promises.mkdir(cacheDir, { recursive: true });
        await fs.promises.writeFile(cachePath, JSON.stringify({ ffprobe: ffprobePath, ffmpeg: ffmpegPath }));
    } catch { /* cache write failed, not critical */ }

    // Create worker pools now that paths are known
    dimensionPool = new DimensionWorkerPool(ffprobePath);
    thumbnailPool = new ThumbnailWorkerPool({ ffmpegPath, ffprobePath });
    ffToolsReady = true;
    markStartup('fftools-detected');
    console.log(`[startup] fftools detection complete (async) — ffprobe: ${!!ffprobePath}, ffmpeg: ${!!ffmpegPath}`);
})();
let hashPool = new HashWorkerPool();
markStartup('worker-pools-created');
// CLIP model state — loaded directly in main process (no worker threads)
let clipModel = null; // { visionModel, textModel, processor, tokenizer, RawImage, ort }
let clipPreprocessPool = null;

// Native-ONNX CLIP inference worker POOL (wraps the native-scanner NAPI addon
// in N Node worker_threads). Rust NAPI addons are ABI-safe across worker
// threads, unlike onnxruntime-node, so inference happens off the main process.
// Pool size is fixed (default 4) so multiple CLIP batches run concurrently on
// the GPU. Dispatch is least-loaded (ties: lowest index). On worker crash,
// inflight requests are transparently re-dispatched to surviving workers.
const CLIP_WORKER_POOL_SIZE = Math.max(1, parseInt(process.env.CLIP_WORKERS, 10) || 4);
const clipInferenceWorkers = new Array(CLIP_WORKER_POOL_SIZE).fill(null); // {worker, ready, inflight, index}
let clipNativeReady = false;
let _clipInferenceReqId = 0;
const _clipInferenceReqs = new Map(); // id -> {resolve, reject, workerIndex, type, payload, transferList}
let _clipInitParams = null; // {visionPath, textPath, threads} for reinit-on-crash

function _refreshReady() {
    clipNativeReady = clipInferenceWorkers.some(w => w && w.ready);
}

function _pickWorker() {
    let best = null;
    for (let i = 0; i < clipInferenceWorkers.length; i++) {
        const w = clipInferenceWorkers[i];
        if (!w || !w.ready) continue;
        if (best === null || w.inflight < best.inflight) best = w;
    }
    return best;
}

function _sendToWorker(slot, type, id, payload, transferList) {
    slot.inflight++;
    slot.worker.postMessage({ type, id, ...payload }, transferList || []);
}

function _dispatchRequest(type, payload, transferList) {
    const slot = _pickWorker();
    if (!slot) return Promise.reject(new Error('clip worker not ready'));
    const id = ++_clipInferenceReqId;
    return new Promise((resolve, reject) => {
        _clipInferenceReqs.set(id, {
            resolve, reject,
            workerIndex: slot.index,
            type, payload, transferList: null, // transferList is consumed on first send
            _createdAt: Date.now()
        });
        _sendToWorker(slot, type, id, payload, transferList);
    });
}

function _createWorkerSlot(index) {
    const { Worker } = require('worker_threads');
    let worker;
    try {
        worker = new Worker(path.join(__dirname, 'clip-inference-worker.js'));
    } catch (err) {
        console.warn(`[clip-pool] worker ${index} spawn failed:`, err.message);
        return null;
    }
    const slot = { worker, ready: false, inflight: 0, index };
    worker.on('message', (msg) => {
        if (!msg || !msg.type) return;
        if (msg.type === 'embed-batch-result') {
            const entry = _clipInferenceReqs.get(msg.id);
            if (entry) {
                _clipInferenceReqs.delete(msg.id);
                slot.inflight = Math.max(0, slot.inflight - 1);
                entry.resolve(msg.embeddings);
            }
        } else if (msg.type === 'embed-error') {
            const entry = _clipInferenceReqs.get(msg.id);
            if (entry) {
                _clipInferenceReqs.delete(msg.id);
                slot.inflight = Math.max(0, slot.inflight - 1);
                entry.reject(new Error(msg.error));
            }
        }
    });
    worker.on('error', (err) => { console.error(`[clip-pool] worker ${index} error:`, err); });
    worker.on('exit', (code) => { _handleWorkerDeath(index, code); });
    return slot;
}

function _handleWorkerDeath(index, code) {
    const dead = clipInferenceWorkers[index];
    if (!dead) return;
    clipInferenceWorkers[index] = null;
    _refreshReady();
    if (code !== 0) console.warn(`[clip-pool] worker ${index} exited code=${code}`);

    // Find all inflight requests on this worker; re-dispatch or reject.
    const orphaned = [];
    for (const [id, entry] of _clipInferenceReqs) {
        if (entry.workerIndex === index) orphaned.push([id, entry]);
    }
    let rescued = 0, failed = 0;
    for (const [id, entry] of orphaned) {
        const alt = _pickWorker();
        if (!alt) {
            _clipInferenceReqs.delete(id);
            entry.reject(new Error('clip worker died, no survivors'));
            failed++;
            continue;
        }
        // Retry on surviving worker. transferList buffers were already consumed
        // on first send, so retries cannot re-transfer (embed-batch relies on
        // batchData buffer which is detached after first post). For those, we
        // must reject — but preprocess-and-embed uses plain paths so it retries.
        if (entry.type === 'embed-batch') {
            _clipInferenceReqs.delete(id);
            entry.reject(new Error('clip worker died mid-embed-batch'));
            failed++;
            continue;
        }
        entry.workerIndex = alt.index;
        _sendToWorker(alt, entry.type, id, entry.payload, null);
        rescued++;
    }
    if (orphaned.length > 0) {
        console.warn(`[clip-pool] worker ${index} died, re-dispatched ${rescued}/${orphaned.length} inflight requests (${failed} rejected)`);
    }

    // Respawn + reinit in background so we're back to full capacity.
    if (_clipInitParams) {
        const slot = _createWorkerSlot(index);
        if (slot) {
            clipInferenceWorkers[index] = slot;
            _initWorkerSlot(slot, _clipInitParams).then((ok) => {
                if (ok) console.log(`[clip-pool] worker ${index} respawned and reinitialized`);
                _refreshReady();
            }).catch((err) => {
                console.warn(`[clip-pool] worker ${index} reinit failed:`, err.message);
            });
        }
    }
}

function _initWorkerSlot(slot, params) {
    return new Promise((resolve) => {
        const onMsg = (msg) => {
            if (msg && msg.type === 'init-result') {
                slot.worker.off('message', onMsg);
                slot.ready = !!msg.ok;
                if (!msg.ok) console.warn(`[clip-pool] worker ${slot.index} init failed:`, msg.error);
                resolve(!!msg.ok);
            }
        };
        slot.worker.on('message', onMsg);
        slot.worker.postMessage({
            type: 'init',
            visionPath: params.visionPath,
            textPath: params.textPath,
            threads: params.threads || 4,
            gpuMode: params.gpuMode === true
        });
    });
}

function ensureClipInferencePool() {
    let anyAlive = false;
    for (let i = 0; i < CLIP_WORKER_POOL_SIZE; i++) {
        if (!clipInferenceWorkers[i]) {
            const slot = _createWorkerSlot(i);
            if (slot) clipInferenceWorkers[i] = slot;
        }
        if (clipInferenceWorkers[i]) anyAlive = true;
    }
    return anyAlive;
}

function clipWorkerInit(visionPath, textPath, threads, gpuMode) {
    _clipInitParams = { visionPath, textPath, threads, gpuMode: gpuMode === true };
    if (!ensureClipInferencePool()) return Promise.resolve(false);
    const initPromises = clipInferenceWorkers.map((slot) =>
        slot ? _initWorkerSlot(slot, _clipInitParams) : Promise.resolve(false)
    );
    return Promise.all(initPromises).then((results) => {
        const ready = results.filter(Boolean).length;
        _refreshReady();
        console.log(`[clip-pool] initialized ${ready}/${CLIP_WORKER_POOL_SIZE} workers`);
        return ready > 0;
    });
}

function clipWorkerEmbedBatch(batchData, n) {
    if (!_pickWorker() || !clipNativeReady) return Promise.reject(new Error('clip worker not ready'));
    return _dispatchRequest('embed-batch', { batchData, n }, [batchData.buffer]);
}

function clipWorkerEmbedTextTokens(inputIds, attentionMask, batchSize) {
    if (!_pickWorker() || !clipNativeReady) return Promise.reject(new Error('clip worker not ready'));
    return _dispatchRequest('embed-text-tokens', { inputIds, attentionMask, batchSize }, null);
}

// Combined native preprocess + inference. Single worker round-trip, zero
// intermediate data copies between preprocessing and inference.
function clipWorkerPreprocessAndEmbed(paths) {
    if (!_pickWorker() || !clipNativeReady) return Promise.reject(new Error('clip worker not ready'));
    return _dispatchRequest('preprocess-and-embed', { paths }, null);
}

// Thumbnail cache directories (initialized after userDataPath is set)
const crypto = require('crypto');
let videoThumbDir = null;
let imageThumbDir = null;
const pendingVideoThumbnailJobs = new Map();
const pendingImageThumbnailJobs = new Map();

// Periodic stale-request reaper for long-lived Maps that track in-flight async work.
// Prevents slow memory leaks from orphaned entries when workers crash or IPC hangs.
// Note: pendingVideoThumbnailJobs and pendingImageThumbnailJobs are self-cleaning
// (try/finally deletes), so they are not reaped here.
const _STALE_REQUEST_TIMEOUT_MS = 120000; // 2 minutes
setInterval(() => {
    const now = Date.now();

    // Reap stale CLIP inference requests
    for (const [id, req] of _clipInferenceReqs) {
        if (req._createdAt && now - req._createdAt > _STALE_REQUEST_TIMEOUT_MS) {
            req.reject(new Error('clip inference request timed out (stale reaper)'));
            _clipInferenceReqs.delete(id);
        }
    }

    // Reap stale WebGPU hamming requests
    for (const [id, req] of _webgpuPending) {
        if (req._createdAt && now - req._createdAt > _STALE_REQUEST_TIMEOUT_MS) {
            if (req.timeoutId) clearTimeout(req.timeoutId);
            req.reject(new Error('webgpu hamming request timed out (stale reaper)'));
            _webgpuPending.delete(id);
        }
    }
}, 60000); // Run every 60 seconds

// createThumbCacheKey — imported from main-utils.js

/**
 * Get the cached thumbnail path for a video file.
 * Uses a hash of the file path + mtime for cache invalidation.
 */
function getThumbCachePath(filePath, mtimeMs) {
    return path.join(videoThumbDir, `${createThumbCacheKey(filePath, mtimeMs)}.jpg`);
}

function getImageThumbCachePath(filePath, mtimeMs, maxSize) {
    return path.join(imageThumbDir, `${createThumbCacheKey(filePath, mtimeMs, `img:${maxSize}`)}.png`);
}

// pathToFileUrl, fileUrlToPath — imported from main-utils.js

/**
 * Get video duration using ffprobe. Returns duration in seconds or null.
 */
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

/**
 * Generate a thumbnail for a video file using ffmpeg.
 * Extracts a frame at ~25% of the video duration.
 * Returns the path to the cached thumbnail or null on failure.
 */
async function generateVideoThumbnail(filePath) {
    if (!ffmpegPath) return null;

    try {
        const stats = await fs.promises.stat(filePath);
        const thumbPath = getThumbCachePath(filePath, stats.mtimeMs);
        const pendingJob = pendingVideoThumbnailJobs.get(thumbPath);
        if (pendingJob) {
            return pendingJob;
        }

        // Return cached thumbnail if it exists
        try {
            await fs.promises.access(thumbPath);
            return thumbPath;
        } catch { /* not cached yet */ }

        const generationPromise = (async () => {
            const perfStart = performance.now();

            // Ensure cache directory exists
            await fs.promises.mkdir(videoThumbDir, { recursive: true });

            // Get video duration to pick a good frame
            const duration = await getVideoDuration(filePath);
            const seekTime = duration ? Math.min(duration * mainVideoThumbSeekPct, 10) : 1;

            const result = await new Promise((resolve) => {
                execFile(ffmpegPath, [
                    '-ss', String(seekTime),
                    '-i', filePath,
                    '-vframes', '1',
                    '-q:v', '6',
                    '-vf', `scale=${mainVideoThumbWidth}:-2`,
                    '-y',
                    thumbPath
                ], { timeout: 10000 }, (err) => {
                    if (err) {
                        // Clean up partial file
                        fs.promises.unlink(thumbPath).catch(() => {});
                        return resolve(null);
                    }
                    resolve(thumbPath);
                });
            });
            logPerf('generate-video-thumbnail', perfStart, { cached: 0, success: result ? 1 : 0 });
            return result;
        })();

        pendingVideoThumbnailJobs.set(thumbPath, generationPromise);
        try {
            return await generationPromise;
        } finally {
            pendingVideoThumbnailJobs.delete(thumbPath);
        }
    } catch (err) {
        console.warn('[generateVideoThumbnail]', err.message);
        return null;
    }
}

async function generateImageThumbnail(filePath, maxSize = 512) {
    try {
        const stats = await fs.promises.stat(filePath);
        const thumbPath = getImageThumbCachePath(filePath, stats.mtimeMs, maxSize);
        const pendingJob = pendingImageThumbnailJobs.get(thumbPath);
        if (pendingJob) {
            return pendingJob;
        }

        try {
            await fs.promises.access(thumbPath);
            return thumbPath;
        } catch { /* not cached yet */ }

        const generationPromise = (async () => {
            const perfStart = performance.now();
            await fs.promises.mkdir(imageThumbDir, { recursive: true });

            if (nativeScanner && nativeScanner.generateImageThumbnails) {
                try {
                    const results = nativeScanner.generateImageThumbnails([{ filePath, thumbPath, maxSize }]);
                    if (results && results[0] && results[0].success) {
                        logPerf('generate-image-thumbnail', perfStart, { cached: 0, success: 1, native: 1 });
                        return thumbPath;
                    }
                } catch {}
            }

            if (thumbnailPool) {
                try {
                    const result = await thumbnailPool.generate({ type: 'image', filePath, thumbPath, maxSize });
                    if (result && result.success && result.thumbPath) {
                        logPerf('generate-image-thumbnail', perfStart, { cached: 0, success: 1, worker: 1 });
                        return result.thumbPath;
                    }
                } catch {}
            }

            const image = nativeImage.createFromPath(filePath);
            if (image.isEmpty()) {
                logPerf('generate-image-thumbnail', perfStart, { cached: 0, success: 0, reason: 'empty' });
                return null;
            }

            const size = image.getSize();
            const longestEdge = Math.max(size.width || 0, size.height || 0);
            if (!longestEdge) {
                logPerf('generate-image-thumbnail', perfStart, { cached: 0, success: 0, reason: 'invalid-size' });
                return null;
            }

            const scale = Math.min(1, maxSize / longestEdge);
            const resized = scale < 1
                ? image.resize({
                    width: Math.max(1, Math.round((size.width || 1) * scale)),
                    height: Math.max(1, Math.round((size.height || 1) * scale)),
                    quality: 'good'
                })
                : image;

            await fs.promises.writeFile(thumbPath, resized.toPNG());
            logPerf('generate-image-thumbnail', perfStart, {
                cached: 0,
                success: 1,
                width: resized.getSize().width,
                height: resized.getSize().height
            });
            return thumbPath;
        })();

        pendingImageThumbnailJobs.set(thumbPath, generationPromise);
        try {
            return await generationPromise;
        } finally {
            pendingImageThumbnailJobs.delete(thumbPath);
        }
    } catch (err) {
        console.warn('[generateImageThumbnail]', err.message);
        return null;
    }
}

/**
 * Read video dimensions using ffprobe (reads only file headers, very fast).
 * Returns { width, height } or null if ffprobe fails or isn't available.
 */
function getVideoDimensions(filePath) {
    if (!ffprobePath) return Promise.resolve(null);
    return new Promise((resolve) => {
        execFile(ffprobePath, [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height',
            '-of', 'csv=p=0:s=x',
            filePath
        ], { timeout: 5000 }, (err, stdout) => {
            if (err || !stdout) return resolve(null);
            const parts = stdout.trim().split('x');
            if (parts.length >= 2) {
                const width = parseInt(parts[0], 10);
                const height = parseInt(parts[1], 10);
                if (width > 0 && height > 0) return resolve({ width, height });
            }
            resolve(null);
        });
    });
}

// Fix cache access denied errors by setting a custom cache directory
// This ensures Electron uses a location with proper write permissions
// When packaged, __dirname points to app.asar which is read-only, so we need a different path
let userDataPath;
if (app.isPackaged) {
    // When packaged, use Electron's default userData directory
    userDataPath = app.getPath('userData');
} else {
    // In development, use a folder relative to the project
    userDataPath = path.join(__dirname, 'electron-cache');
}
if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
}
app.setPath('userData', userDataPath);

// ── Crash log persistence ────────────────────────────────────────────────────
// Write crash/rejection details to {userData}/crash-log.txt so users can report
// production errors even when the DevTools console is unavailable.
const crashLogPath = path.join(userDataPath, 'crash-log.txt');
// writeCrashLog — imported from main-utils.js (accepts logPath as 3rd arg)
// Re-register handlers to also persist to disk
process.removeAllListeners('uncaughtException');
process.removeAllListeners('unhandledRejection');
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
    writeCrashLog('UNCAUGHT EXCEPTION', err, crashLogPath);
});
process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION:', err);
    writeCrashLog('UNHANDLED REJECTION', err, crashLogPath);
});

// ── Single-instance lock ─────────────────────────────────────────────────────
// Prevent multiple app windows from opening and risking database corruption.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

// ── Persistent file logger ────────────────────────────────────────────────────
// Date-stamped log files in {userData}/logs/ with automatic rotation (keep 5).
const util = require('util');
const logsDir = path.join(userDataPath, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const _logDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const _logFilePath = path.join(logsDir, `app-${_logDate}.log`);
let _logBuffer = [];
let _logFlushTimer = null;

function _flushLogBuffer() {
    if (_logBuffer.length === 0) return;
    try {
        fs.appendFileSync(_logFilePath, _logBuffer.join(''));
    } catch { /* best-effort */ }
    _logBuffer = [];
}

function logToFile(level, args) {
    const msg = args.map(a => (typeof a === 'string' ? a : util.inspect(a, { depth: 4 }))).join(' ');
    _logBuffer.push(`[${new Date().toISOString()}] [${level}] ${msg}\n`);
    if (_logBuffer.length >= 100) {
        _flushLogBuffer();
    } else if (!_logFlushTimer) {
        _logFlushTimer = setTimeout(() => { _logFlushTimer = null; _flushLogBuffer(); }, 1000);
    }
}

// Intercept console.error and console.warn to also write to log file
const _origConsoleError = console.error;
const _origConsoleWarn = console.warn;
console.error = (...args) => { _origConsoleError(...args); logToFile('ERROR', args); };
console.warn = (...args) => { _origConsoleWarn(...args); logToFile('WARN', args); };

// Perf: rotate old log files asynchronously (keep newest 5) — avoid blocking startup
(async () => {
    try {
        const logFiles = (await fs.promises.readdir(logsDir))
            .filter(f => f.startsWith('app-') && f.endsWith('.log'))
            .sort();
        while (logFiles.length > 5) {
            const oldest = logFiles.shift();
            await fs.promises.unlink(path.join(logsDir, oldest)).catch(() => {});
        }
    } catch { /* ignore */ }
})();

// Initialize SQLite database
const appDb = new DatabaseProxy(path.join(userDataPath, 'thumbnail-animator.db'));
markStartup('db-initialized');

// Initialize video thumbnail cache directory now that userDataPath is set
videoThumbDir = path.join(userDataPath, 'video-thumbnails');
imageThumbDir = path.join(userDataPath, 'image-thumbnails');
let folderPreviewDir = path.join(userDataPath, 'folder-previews');

// Cache size limits (bytes). 0 = unlimited. User-configurable via settings.
let VIDEO_CACHE_MAX_BYTES = 500 * 1024 * 1024;  // default 500 MB
let IMAGE_CACHE_MAX_BYTES = 1000 * 1024 * 1024;  // default 1 GB

// Load saved cache limits from config file (async to avoid blocking startup)
const cacheLimitsFile = path.join(userDataPath, 'cache-limits.json');
const _cacheLimitsReady = fs.promises.readFile(cacheLimitsFile, 'utf8').then(data => {
    const saved = JSON.parse(data);
    if (typeof saved.videoCacheMB === 'number') VIDEO_CACHE_MAX_BYTES = saved.videoCacheMB * 1024 * 1024;
    if (typeof saved.imageCacheMB === 'number') IMAGE_CACHE_MAX_BYTES = saved.imageCacheMB * 1024 * 1024;
}).catch(() => { /* no saved limits, use defaults */ });

// Run cache eviction on startup (non-blocking, waits for async cache limits)
if (nativeScanner && nativeScanner.planCacheEviction) {
    setTimeout(async () => {
        await _cacheLimitsReady; // Ensure user-configured limits are loaded before evicting
        for (const [dir, maxBytes, label] of [
            [videoThumbDir, VIDEO_CACHE_MAX_BYTES, 'video'],
            [imageThumbDir, IMAGE_CACHE_MAX_BYTES, 'image'],
        ]) {
            if (maxBytes === 0) continue; // 0 = unlimited
            try {
                const plan = nativeScanner.planCacheEviction(dir, maxBytes);
                if (plan.filesToDelete.length > 0) {
                    const deleted = nativeScanner.deleteFiles(plan.filesToDelete);
                    console.log(`[cache] Evicted ${deleted} ${label} thumbnails (freed ${(plan.bytesToFree / 1024 / 1024).toFixed(1)}MB, was ${(plan.currentSize / 1024 / 1024).toFixed(1)}MB)`);
                }
            } catch (e) {
                console.warn(`[cache] ${label} eviction failed:`, e.message);
            }
        }
    }, 3000); // Delay 3s after startup to not compete with initial folder load
}

// Undo/Redo: app-managed staging folder for deleted files
const undoTrashDir = path.join(userDataPath, 'undo-trash');
// Perf: clean leftovers asynchronously to avoid blocking startup (50-200ms for populated dirs)
let undoTrashReady = false;
(async () => {
    try {
        await fs.promises.rm(undoTrashDir, { recursive: true, force: true });
    } catch { /* didn't exist */ }
    await fs.promises.mkdir(undoTrashDir, { recursive: true });
    undoTrashReady = true;
})();

let useSystemTrash = false;

// Undo/Redo operation history
const undoStack = [];
const redoStack = [];
const MAX_UNDO_HISTORY = 30;

function pushUndoEntry(entry) {
    entry.timestamp = Date.now();
    undoStack.push(entry);
    if (undoStack.length > MAX_UNDO_HISTORY) {
        const removed = undoStack.shift();
        // Clean up staging files for evicted delete entries
        if (removed.operations) {
            for (const op of removed.operations) {
                if (op.stagingPath && fs.existsSync(op.stagingPath)) {
                    fs.promises.rm(op.stagingPath, { recursive: true, force: true }).catch(() => {});
                }
            }
        }
    }
    // Any new action invalidates the redo chain
    for (const entry of redoStack) {
        if (entry.operations) {
            for (const op of entry.operations) {
                if (op.stagingPath && fs.existsSync(op.stagingPath)) {
                    fs.promises.rm(op.stagingPath, { recursive: true, force: true }).catch(() => {});
                }
            }
        }
    }
    redoStack.length = 0;
}

// safeMove, moveToStaging, restoreFromStaging — imported from main-utils.js

// Fix for VRAM leak: Disable Hardware Acceleration
// This forces software decoding which is often more stable for many simultaneous videos
// app.disableHardwareAcceleration(); // Re-enabled per user request

// Expose GC for manual memory management
app.commandLine.appendSwitch('js-flags', '--expose-gc');

// Additional cache-related command line switches to prevent cache errors
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-software-rasterizer');

// VRAM management flags - help prevent video decoder leaks
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// Reduce VRAM usage per video
app.commandLine.appendSwitch('disable-zero-copy'); // Prevent zero-copy which can hold VRAM
app.commandLine.appendSwitch('enable-low-res-tiling'); // Use lower resolution tiling
app.commandLine.appendSwitch('disable-partial-raster'); // Disable partial rasterization that can use VRAM
app.commandLine.appendSwitch('disable-accelerated-2d-canvas'); // Reduce GPU memory for canvas operations

let mainWindow = null;

// Window position persistence
const windowStateFile = path.join(userDataPath, 'window-state.json');
console.log('Window state file path:', windowStateFile);

// Pre-read window state asynchronously at module load to avoid blocking createWindow
const _windowStateReadPromise = fs.promises.readFile(windowStateFile, 'utf8').catch(() => null);

const _defaultWindowState = { width: 1200, height: 800, x: undefined, y: undefined, isMaximized: false };

async function loadWindowState() {
    try {
        const data = await _windowStateReadPromise;
        if (!data) {
            console.log('No saved window state file found');
            return _defaultWindowState;
        }
        const state = JSON.parse(data);
        console.log('Loaded window state:', state);

        // Validate that the saved position is still valid (within screen bounds)
        if (state.x !== undefined && state.y !== undefined &&
            state.width !== undefined && state.height !== undefined &&
            typeof state.x === 'number' && typeof state.y === 'number' &&
            typeof state.width === 'number' && typeof state.height === 'number') {

            // Check if window center is within any display bounds
            const displays = screen.getAllDisplays();
            let isValidPosition = false;
            const centerX = state.x + state.width / 2;
            const centerY = state.y + state.height / 2;

            for (const display of displays) {
                const { x, y, width: dWidth, height: dHeight } = display.bounds;
                if (centerX >= x && centerX < x + dWidth &&
                    centerY >= y && centerY < y + dHeight) {
                    isValidPosition = true;
                    break;
                }
            }

            if (isValidPosition) {
                console.log('Using saved window state');
                return state;
            } else {
                console.log('Saved window state is not valid for current displays');
            }
        }
    } catch (error) {
        console.error('Error loading window state:', error);
    }

    // Return default values if loading fails
    console.log('Using default window state');
    return _defaultWindowState;
}

function saveWindowState(win, { sync = false } = {}) {
    try {
        // Don't save if window is being destroyed
        if (win.isDestroyed()) {
            return;
        }

        const bounds = win.getBounds();
        const isMaximized = win.isMaximized();

        const state = {
            width: bounds.width,
            height: bounds.height,
            x: bounds.x,
            y: bounds.y,
            isMaximized: isMaximized
        };

        // Ensure directory exists
        const dir = path.dirname(windowStateFile);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const json = JSON.stringify(state, null, 2);
        if (sync) {
            fs.writeFileSync(windowStateFile, json, 'utf8');
        } else {
            fs.promises.writeFile(windowStateFile, json, 'utf8').catch(err => {
                console.error('Error writing window state:', err);
            });
        }
        console.log('Window state saved:', state);
    } catch (error) {
        console.error('Error saving window state:', error);
    }
}

async function createWindow() {
    const windowState = await loadWindowState();
    
    // Build window options object
    const windowOptions = {
        width: windowState.width || 1200,
        height: windowState.height || 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        },
        backgroundColor: '#1a1a1a', // Dark mode base
        autoHideMenuBar: true, // Hide menu bar by default, show with Alt key
        titleBarStyle: 'hidden',
        ...(process.platform === 'win32' ? {
            titleBarOverlay: {
                color: '#161618',
                symbolColor: '#9d9da6',
                height: 38
            }
        } : process.platform === 'darwin' ? {
            trafficLightPosition: { x: 12, y: 12 }
        } : {})
    };
    
    // Only set x/y if they are valid numbers
    if (typeof windowState.x === 'number' && typeof windowState.y === 'number') {
        windowOptions.x = windowState.x;
        windowOptions.y = windowState.y;
    }
    
    const win = new BrowserWindow(windowOptions);

    win.loadFile('index.html');

    win.webContents.once('did-finish-load', () => {
        markStartup('renderer-loaded');
        const mem = process.memoryUsage();
        console.log('\n[Startup Timeline]');
        let prev = 0;
        for (const { phase, time } of startupTimeline) {
            const delta = Math.round((time - prev) * 100) / 100;
            console.log(`  ${phase.padEnd(24)} +${String(delta).padStart(7)}ms  (total: ${time}ms)`);
            prev = time;
        }
        console.log(`[Startup Memory] RSS: ${(mem.rss / 1024 / 1024).toFixed(1)}MB | Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(1)}/${(mem.heapTotal / 1024 / 1024).toFixed(1)}MB | External: ${(mem.external / 1024 / 1024).toFixed(1)}MB\n`);
    });

    // Restore maximized state after window is ready
    if (windowState.isMaximized) {
        win.once('ready-to-show', () => {
            win.maximize();
        });
    }
    // win.webContents.openDevTools(); // Open DevTools for debugging
    
    // Hide menu bar when window loses focus
    win.on('blur', () => {
        win.setMenuBarVisibility(false);
    });

    // Show application menu as popup (native menu bar is suppressed by titleBarOverlay)
    ipcMain.on('toggle-menu-bar', (event) => {
        const sender = BrowserWindow.fromWebContents(event.sender);
        if (sender) {
            const menu = Menu.getApplicationMenu();
            if (menu) {
                menu.popup({ window: sender, x: 0, y: 38 });
            }
        }
    });
    
    // Update title bar overlay colors when theme changes (Windows only)
    ipcMain.on('update-titlebar-overlay', (event, overlay) => {
        if (process.platform !== 'win32') return;
        const sender = BrowserWindow.fromWebContents(event.sender);
        if (sender) {
            try { sender.setTitleBarOverlay(overlay); } catch {}
        }
    });

    // Track window minimize/maximize events to reduce resource usage
    win.on('minimize', () => {
        win.webContents.send('window-minimized');
    });
    
    win.on('restore', () => {
        win.webContents.send('window-restored');
    });
    
    win.on('show', () => {
        win.webContents.send('window-restored');
    });
    
    // Save window state when window is moved or resized
    let saveTimeout;
    const debouncedSave = () => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            saveWindowState(win);
        }, 500); // Save after 500ms of no changes
    };
    
    win.on('move', debouncedSave);
    win.on('resize', debouncedSave);
    win.on('maximize', () => {
        clearTimeout(saveTimeout);
        saveWindowState(win);
    });
    win.on('unmaximize', () => {
        clearTimeout(saveTimeout);
        saveWindowState(win);
    });
    
    // Save state when window is closed (sync to guarantee persistence before exit)
    win.on('close', () => {
        clearTimeout(saveTimeout);
        saveWindowState(win, { sync: true });
    });
    
    mainWindow = win;
    return win;
}

// Initialize plugin registry
const pluginCacheDir = path.join(app.getPath('userData'), 'plugin-cache');
const pluginStatesFile = path.join(pluginCacheDir, 'plugin-states.json');
const pluginRegistry = new PluginRegistry(pluginCacheDir, pluginStatesFile);
pluginRegistry.discover(path.join(__dirname, 'plugins', 'builtin'), { builtin: true });
pluginRegistry.discover(path.join(app.getPath('userData'), 'plugins'));
markStartup('plugins-loaded');

app.whenReady().then(async () => {
    markStartup('app-ready');
    const win = await createWindow();
    markStartup('window-created');

    // --- Application Menu ---
    const isMac = process.platform === 'darwin';
    const sendMenuCommand = (command) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('menu-command', command);
        }
    };
    const menuTemplate = [
        ...(isMac ? [{ role: 'appMenu' }] : []),
        {
            label: 'File',
            submenu: [
                { label: 'Open Folder', accelerator: 'CmdOrCtrl+O', click: () => sendMenuCommand('open-folder') },
                { type: 'separator' },
                { label: 'Export Settings...', click: () => sendMenuCommand('export-settings') },
                { label: 'Import Settings...', click: () => sendMenuCommand('import-settings') },
                { type: 'separator' },
                isMac ? { role: 'close' } : { role: 'quit' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { label: 'Undo File Operation', accelerator: 'CmdOrCtrl+Z', click: () => sendMenuCommand('undo') },
                { label: 'Redo File Operation', accelerator: 'CmdOrCtrl+Shift+Z', click: () => sendMenuCommand('redo') },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { label: 'Toggle Sidebar', accelerator: 'S', click: () => sendMenuCommand('toggle-sidebar'), registerAccelerator: false },
                { label: 'Toggle Layout', accelerator: 'G', click: () => sendMenuCommand('toggle-layout'), registerAccelerator: false },
                { type: 'separator' },
                { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => sendMenuCommand('zoom-in'), registerAccelerator: false },
                { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => sendMenuCommand('zoom-out'), registerAccelerator: false },
                { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => sendMenuCommand('zoom-reset'), registerAccelerator: false },
                { type: 'separator' },
                { role: 'togglefullscreen' },
                { role: 'toggleDevTools' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                { label: 'Keyboard Shortcuts', accelerator: '?', click: () => sendMenuCommand('show-shortcuts'), registerAccelerator: false },
                { label: 'Settings', click: () => sendMenuCommand('open-settings') },
                { type: 'separator' },
                { label: 'About', click: () => sendMenuCommand('about') }
            ]
        }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

    // --- Auto-updater (deferred to avoid blocking startup with ~20ms require) ---
    setTimeout(() => {
        try {
            autoUpdater = require('electron-updater').autoUpdater;
            autoUpdater.autoDownload = false;
            autoUpdater.autoInstallOnAppQuit = false;

            autoUpdater.on('update-available', (info) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('update-available', {
                        version: info.version,
                        releaseNotes: info.releaseNotes || ''
                    });
                }
            });

            autoUpdater.on('download-progress', (progress) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('update-download-progress', {
                        percent: Math.round(progress.percent)
                    });
                }
            });

            autoUpdater.on('update-downloaded', () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('update-downloaded');
                }
            });

            autoUpdater.on('error', (err) => {
                console.error('Auto-updater error:', err.message);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('update-error', err.message);
                }
            });

            // Check for updates once loaded
            autoUpdater.checkForUpdates().catch((err) => {
                console.error('Update check failed:', err.message);
            });
        } catch (err) {
            console.error('Auto-updater init failed:', err.message);
        }
    }, 3000);

    ipcMain.handle('download-update', async () => {
        try {
            const value = await autoUpdater.downloadUpdate();
            return { ok: true, value };
        } catch (err) {
            console.error('Download update failed:', err.message);
            return { ok: false, error: err.message };
        }
    });

    ipcMain.handle('install-update', () => {
        try {
            autoUpdater.quitAndInstall(true, true);
            return { ok: true, value: null };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// ── IPC Utility ──────────────────────────────────────────────────────────────
/** Register an ipcMain handler with automatic { ok, value } / { ok, error } wrapping. */
function wrapIpc(channel, fn) {
    ipcMain.handle(channel, async (_event, ...args) => {
        try {
            const value = await fn(...args);
            return { ok: true, value: value !== undefined ? value : null };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    });
}

// ── Path validation helper ────────────────────────────────────────────────────
/**
 * Validate and resolve a user-supplied file path.
 * @param {*} p - The path to validate
 * @param {{ mustExist?: boolean }} [opts] - Options
 * @returns {string} Resolved absolute path
 * @throws {Error} If validation fails
 */
// validateUserPath — imported from main-utils.js

// ── App info & logs IPC ──────────────────────────────────────────────────────
wrapIpc('get-app-info', () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch
}));

wrapIpc('get-logs', async () => {
    const files = await fs.promises.readdir(logsDir);
    const logFiles = files.filter(f => f.startsWith('app-') && f.endsWith('.log')).sort().reverse();
    const currentLog = logFiles[0];
    if (!currentLog) return { files: [], content: '' };
    const content = await fs.promises.readFile(path.join(logsDir, currentLog), 'utf8');
    return { files: logFiles, content };
});

// Fetch release notes from GitHub for a given version (or latest).
// Caches the result so repeated About-dialog opens don't re-fetch.
let _releaseNotesCache = {};
function _fetchGitHubRelease(tag) {
    const https = require('https');
    const url = `https://api.github.com/repos/kevinggundersen/thumnail-animator/releases/${tag}`;
    const headers = { 'User-Agent': 'ThumbnailAnimator', Accept: 'application/vnd.github.v3+json' };
    return new Promise((resolve, reject) => {
        const doGet = (fetchUrl, redirectsLeft) => {
            const req = https.get(fetchUrl, { headers }, (res) => {
                // Follow 3xx redirects (GitHub redirects repo-based URLs)
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
                    res.resume(); // drain response
                    doGet(res.headers.location, redirectsLeft - 1);
                    return;
                }
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    if (res.statusCode === 200) resolve(JSON.parse(data));
                    else reject(new Error(`GitHub API ${res.statusCode}`));
                });
            });
            req.on('error', reject);
            req.setTimeout(8000, () => { req.destroy(); reject(new Error('Request timed out')); });
        };
        doGet(url, 3);
    });
}
wrapIpc('get-release-notes', async (version) => {
    if (_releaseNotesCache[version]) return _releaseNotesCache[version];
    let release;
    // Try exact version tag, then with dot prefix (v.X.Y.Z), then fall back to latest
    const tagVariants = [`tags/v${version}`, `tags/v.${version}`];
    for (const tag of tagVariants) {
        try {
            release = await _fetchGitHubRelease(tag);
            break;
        } catch { /* try next variant */ }
    }
    if (!release) {
        release = await _fetchGitHubRelease('latest');
    }
    const result = { version: release.tag_name, notes: release.body || '', url: release.html_url };
    _releaseNotesCache[version] = result;
    return result;
});

// IPC Handlers
ipcMain.handle('select-folder', async (event, defaultPath) => {
    try {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory'],
            defaultPath: defaultPath || undefined
        });
        return { ok: true, value: result.filePaths[0] || null };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('save-frame-as', async (event, opts) => {
    try {
        const { defaultPath, dataBase64, promptDialog } = opts || {};
        if (!dataBase64) return { ok: false, error:'No image data' };
        let targetPath = defaultPath;
        if (promptDialog) {
            const result = await dialog.showSaveDialog({
                title: 'Save Frame',
                defaultPath: defaultPath || 'frame.png',
                filters: [{ name: 'PNG Image', extensions: ['png'] }]
            });
            if (result.canceled || !result.filePath) return { ok: true, value: { canceled: true } };
            targetPath = result.filePath;
        }
        if (!targetPath) return { ok: false, error:'No target path' };
        // If file exists and we didn't prompt, append a counter rather than overwrite
        if (!promptDialog) {
            let counter = 1;
            const ext = path.extname(targetPath);
            const base = targetPath.slice(0, targetPath.length - ext.length);
            while (fs.existsSync(targetPath)) {
                targetPath = `${base}_${counter}${ext}`;
                counter++;
                if (counter > 9999) break;
            }
        }
        const buf = Buffer.from(dataBase64, 'base64');
        await fs.promises.writeFile(targetPath, buf);
        return { ok: true, value: { filePath: targetPath } };
    } catch (err) {
        return { ok: false, error:err.message };
    }
});

ipcMain.handle('crop-image', async (_event, opts) => {
    try {
        const { inputPath, outputPath, crop } = opts || {};
        if (!inputPath || !outputPath) return { ok: false, error:'Missing input or output path' };
        if (!crop || !Number.isFinite(crop.left) || !Number.isFinite(crop.top) ||
            !Number.isFinite(crop.width) || !Number.isFinite(crop.height)) {
            return { ok: false, error:'Invalid crop area' };
        }

        const normalizedInput = path.resolve(inputPath);
        const normalizedOutput = path.resolve(outputPath);
        if (normalizedInput === normalizedOutput) {
            return { ok: false, error:'Crop output must be a new file' };
        }
        if (!fs.existsSync(normalizedInput)) {
            return { ok: false, error:'Source image not found' };
        }

        const left = Math.max(0, Math.floor(crop.left));
        const top = Math.max(0, Math.floor(crop.top));
        const width = Math.max(1, Math.floor(crop.width));
        const height = Math.max(1, Math.floor(crop.height));

        await fs.promises.mkdir(path.dirname(normalizedOutput), { recursive: true });

        const sharp = require('sharp');
        let pipeline = sharp(normalizedInput, { animated: false })
            .rotate()
            .extract({ left, top, width, height });

        const outExt = path.extname(normalizedOutput).toLowerCase();
        if (outExt === '.jpg' || outExt === '.jpeg') {
            pipeline = pipeline.jpeg({ quality: 92 });
        } else if (outExt === '.png') {
            pipeline = pipeline.png();
        } else if (outExt === '.webp') {
            pipeline = pipeline.webp({ quality: 90 });
        } else if (outExt === '.gif') {
            pipeline = pipeline.gif();
        } else if (outExt === '.tif' || outExt === '.tiff') {
            pipeline = pipeline.tiff();
        }

        await pipeline.toFile(normalizedOutput);
        return { ok: true, value: { filePath: normalizedOutput } };
    } catch (err) {
        console.error('Error cropping image:', err);
        return { ok: false, error:err.message };
    }
});

ipcMain.handle('export-settings-dialog', async (event, jsonString) => {
    try {
        const result = await dialog.showSaveDialog({
            title: 'Export Settings',
            defaultPath: 'thumbnail-animator-settings.json',
            filters: [{ name: 'JSON Files', extensions: ['json'] }]
        });
        if (result.canceled || !result.filePath) return { ok: true, value: { canceled: true } };
        fs.writeFileSync(result.filePath, jsonString, 'utf-8');
        return { ok: true, value: { filePath: result.filePath } };
    } catch (err) {
        return { ok: false, error:err.message };
    }
});

ipcMain.handle('import-settings-dialog', async () => {
    try {
        const result = await dialog.showOpenDialog({
            title: 'Import Settings',
            filters: [{ name: 'JSON Files', extensions: ['json'] }],
            properties: ['openFile']
        });
        if (result.canceled || !result.filePaths[0]) return { ok: true, value: { canceled: true } };
        const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
        const data = JSON.parse(raw);
        return { ok: true, value: data };
    } catch (err) {
        return { ok: false, error:err.message };
    }
});

ipcMain.handle('sync-plugin-states-from-import', async (event, states) => {
    try {
        if (states && typeof states === 'object') {
            for (const [pluginId, enabled] of Object.entries(states)) {
                pluginRegistry.setPluginEnabled(pluginId, !!enabled);
            }
        }
        return { ok: true, value: null };
    } catch (err) {
        return { ok: false, error:err.message };
    }
});

ipcMain.handle('trigger-gc', () => {
    if (global.gc) {
        global.gc();
        // console.log('GC Triggered');
    }
    return { ok: true, value: null };
});

ipcMain.handle('get-startup-timeline', () => ({ ok: true, value: startupTimeline }));

ipcMain.handle('get-memory-info', () => {
    const mem = process.memoryUsage();
    return { ok: true, value: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
    } };
});

ipcMain.handle('get-cache-info', () => {
    if (!nativeScanner || !nativeScanner.getCacheInfo) return { ok: true, value: null };
    const video = nativeScanner.getCacheInfo(videoThumbDir || '');
    const image = nativeScanner.getCacheInfo(imageThumbDir || '');
    const folder = nativeScanner.getCacheInfo(folderPreviewDir || '');
    return { ok: true, value: {
        video: { size: video.totalSize, files: video.fileCount, maxSize: VIDEO_CACHE_MAX_BYTES },
        image: { size: image.totalSize, files: image.fileCount, maxSize: IMAGE_CACHE_MAX_BYTES },
        folder: { size: folder.totalSize, files: folder.fileCount },
    } };
});

ipcMain.handle('evict-cache', (event, cacheType) => {
    if (!nativeScanner || !nativeScanner.planCacheEviction) return { ok: true, value: { deleted: 0, freed: 0 } };
    const dir = cacheType === 'video' ? videoThumbDir : imageThumbDir;
    const maxBytes = cacheType === 'video' ? VIDEO_CACHE_MAX_BYTES : IMAGE_CACHE_MAX_BYTES;
    if (maxBytes === 0) return { ok: true, value: { deleted: 0, freed: 0 } }; // unlimited
    // Force evict to 80% of max to avoid re-evicting on every call
    const plan = nativeScanner.planCacheEviction(dir, Math.floor(maxBytes * 0.8));
    if (plan.filesToDelete.length === 0) return { ok: true, value: { deleted: 0, freed: 0 } };
    const deleted = nativeScanner.deleteFiles(plan.filesToDelete);
    return { ok: true, value: { deleted, freed: plan.bytesToFree } };
});

ipcMain.handle('set-cache-limits', (event, videoCacheMB, imageCacheMB) => {
    VIDEO_CACHE_MAX_BYTES = videoCacheMB * 1024 * 1024;
    IMAGE_CACHE_MAX_BYTES = imageCacheMB * 1024 * 1024;
    try {
        fs.writeFileSync(cacheLimitsFile, JSON.stringify({ videoCacheMB, imageCacheMB }));
    } catch { /* non-critical */ }
    return { ok: true, value: null };
});

ipcMain.handle('set-use-system-trash', (event, enabled) => {
    useSystemTrash = !!enabled;
    return { ok: true, value: null };
});

// Concurrency-limited async pool: runs at most `limit` tasks at a time, preserves result order
// asyncPool — imported from main-utils.js

let IO_CONCURRENCY_LIMIT = 20;

// ── Runtime settings from renderer ──
let mainVideoThumbWidth = 320;
let mainVideoThumbSeekPct = 0.25;

ipcMain.handle('update-main-setting', (event, key, value) => {
    switch (key) {
        case 'ioConcurrency': IO_CONCURRENCY_LIMIT = parseInt(value) || 20; break;
        case 'videoThumbWidth': mainVideoThumbWidth = parseInt(value) || 320; break;
        case 'videoThumbSeekPct': mainVideoThumbSeekPct = parseFloat(value) / 100 || 0.25; break;
    }
    return { ok: true, value: null };
});

// Core folder scan logic extracted for reuse by collections
async function scanFolderInternal(folderPath, options = {}) {
    const scanStart = performance.now();
    const { skipStats = false, scanImageDimensions = false, scanVideoDimensions = false,
            smartCollectionMode = false, skipDimensions = false, recursive = false } = options;

    const videoExtensions = pluginRegistry.getVideoExtensions();
    const imageExtensions = pluginRegistry.getImageExtensions();
    const isWindows = process.platform === 'win32';

    let folders, fileObjs;

    // === Recursive mode: scan all subdirectories ===
    if (recursive) {
        folders = [];
        fileObjs = [];
        if (nativeScanner && nativeScanner.scanDirectoryRecursive) {
            const nativeStart = performance.now();
            const imageExts = [...imageExtensions];
            const videoExts = [...videoExtensions];
            const nativeFiles = nativeScanner.scanDirectoryRecursive([folderPath], imageExts, videoExts);
            logPerf('scan-folder.native-recursive', nativeStart, { files: nativeFiles.length });
            for (const f of nativeFiles) {
                const isImage = f.fileType === 'image';
                const relativePath = path.relative(folderPath, f.path);
                fileObjs.push({
                    name: f.name, path: f.path,
                    url: isWindows ? `file:///${f.path.replace(/\\/g, '/')}` : `file://${f.path}`,
                    type: f.fileType, isImage,
                    mtime: f.mtime, size: f.size,
                    width: undefined, height: undefined,
                    relativePath,
                });
            }
        } else {
            // JS recursive walk fallback
            const supportedExtensions = pluginRegistry.getSupportedExtensions();
            async function walkDir(dir) {
                let entries;
                try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        await walkDir(fullPath);
                    } else if (entry.isFile()) {
                        const lastDot = entry.name.lastIndexOf('.');
                        if (lastDot === -1) continue;
                        const ext = entry.name.substring(lastDot).toLowerCase();
                        if (!supportedExtensions.has(ext)) continue;
                        const isImage = imageExtensions.has(ext);
                        const relativePath = path.relative(folderPath, fullPath);
                        let mtime = 0, size = 0;
                        if (!skipStats) {
                            try {
                                const stats = await fs.promises.stat(fullPath);
                                mtime = stats.mtimeMs; size = stats.size;
                            } catch {}
                        }
                        fileObjs.push({
                            name: entry.name, path: fullPath,
                            url: isWindows ? `file:///${fullPath.replace(/\\/g, '/')}` : `file://${fullPath}`,
                            type: isImage ? 'image' : 'video', isImage,
                            mtime, size,
                            width: undefined, height: undefined,
                            relativePath,
                        });
                    }
                }
            }
            await walkDir(folderPath);
        }

        // Immediate child folders (navigation) — recursive walk only collects files
        if (!smartCollectionMode) {
            let folderItems = [];
            try {
                const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) folderItems.push(entry);
                }
            } catch { /* leave folders empty */ }

            if (skipStats) {
                folders = folderItems.map(item => ({
                    name: item.name,
                    path: path.join(folderPath, item.name),
                    type: 'folder',
                    mtime: 0
                }));
            } else {
                const folderStatStart = performance.now();
                const folderResults = await asyncPool(IO_CONCURRENCY_LIMIT, folderItems, async (item) => {
                    const itemPath = path.join(folderPath, item.name);
                    try {
                        const stats = await fs.promises.stat(itemPath);
                        return { name: item.name, path: itemPath, type: 'folder', mtime: stats.mtime.getTime() };
                    } catch { return { name: item.name, path: itemPath, type: 'folder', mtime: 0 }; }
                });
                folders = folderResults;
                logPerf('scan-folder.recursive-immediate-folders', folderStatStart, { count: folderItems.length, limit: IO_CONCURRENCY_LIMIT });
            }
            if (folders.length > 1) {
                folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
            }
        }
    }
    // === Normal (non-recursive) mode ===
    else if (nativeScanner) {
        const nativeStart = performance.now();
        const imageExts = [...imageExtensions];
        const videoExts = [...videoExtensions];
        const result = nativeScanner.scanDirectory(folderPath, imageExts, videoExts, skipStats, smartCollectionMode);
        logPerf('scan-folder.native', nativeStart, { folders: result.folders.length, files: result.mediaFiles.length });

        // Add url + type:'folder' + isImage fields to match expected shape
        folders = result.folders.map(f => ({ name: f.name, path: f.path, type: 'folder', mtime: f.mtime }));
        fileObjs = result.mediaFiles.map(f => {
            const isImage = f.fileType === 'image';
            return {
                name: f.name,
                path: f.path,
                url: isWindows ? `file:///${f.path.replace(/\\/g, '/')}` : `file://${f.path}`,
                type: f.fileType,
                isImage,
                mtime: f.mtime,
                size: f.size,
                width: undefined,
                height: undefined,
            };
        });
    } else {
        // JS fallback: Phase A (readdir + classify) then Phase C (stat)
        const readdirStart = performance.now();
        const items = await fs.promises.readdir(folderPath, { withFileTypes: true });
        logPerf('scan-folder.readdir', readdirStart, { entries: items.length });

        const supportedExtensions = pluginRegistry.getSupportedExtensions();
        const folderItems = [];
        fileObjs = [];

        for (const item of items) {
            if (item.isDirectory()) {
                if (!smartCollectionMode) folderItems.push(item);
            } else if (item.isFile()) {
                const name = item.name;
                const lastDot = name.lastIndexOf('.');
                if (lastDot === -1) continue;
                const ext = name.substring(lastDot).toLowerCase();
                if (!supportedExtensions.has(ext)) continue;
                const itemPath = path.join(folderPath, name);
                const isImage = imageExtensions.has(ext);
                fileObjs.push({
                    name, path: itemPath,
                    url: isWindows ? `file:///${itemPath.replace(/\\/g, '/')}` : `file://${itemPath}`,
                    type: isImage ? 'image' : 'video', isImage,
                    mtime: 0, size: 0, width: undefined, height: undefined,
                });
            }
        }

        folders = [];
        if (skipStats) {
            for (const item of folderItems) {
                folders.push({ name: item.name, path: path.join(folderPath, item.name), type: 'folder', mtime: 0 });
            }
        } else {
            if (!smartCollectionMode) {
                const folderStatStart = performance.now();
                const folderResults = await asyncPool(IO_CONCURRENCY_LIMIT, folderItems, async (item) => {
                    const itemPath = path.join(folderPath, item.name);
                    try {
                        const stats = await fs.promises.stat(itemPath);
                        return { name: item.name, path: itemPath, type: 'folder', mtime: stats.mtime.getTime() };
                    } catch { return { name: item.name, path: itemPath, type: 'folder', mtime: 0 }; }
                });
                folders.push(...folderResults);
                logPerf('scan-folder.folder-stats', folderStatStart, { count: folderItems.length, limit: IO_CONCURRENCY_LIMIT });
            }
            const fileStatStart = performance.now();
            await asyncPool(IO_CONCURRENCY_LIMIT, fileObjs, async (fileObj) => {
                try {
                    const stats = await fs.promises.stat(fileObj.path);
                    fileObj.mtime = stats.mtime.getTime();
                    fileObj.size = stats.size;
                } catch { /* mtime stays 0 */ }
            });
            logPerf('scan-folder.file-stats', fileStatStart, { count: fileObjs.length, limit: IO_CONCURRENCY_LIMIT });
        }

        if (!smartCollectionMode) {
            if (folders.length > 1) folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
            if (fileObjs.length > 1) fileObjs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        }
    }

    // === Phase B: Dimension scanning ===
    if (!skipDimensions) {
        // Native path: use Rust for images (non-SVG), worker pool for videos + SVG
        if (scanImageDimensions && nativeScanner && nativeScanner.readImageDimensions) {
            const nativeImagePaths = fileObjs
                .filter(f => f.isImage && !f.path.toLowerCase().endsWith('.svg'))
                .map(f => f.path);
            if (nativeImagePaths.length > 0) {
                const dimStart = performance.now();
                const nativeResults = nativeScanner.readImageDimensions(nativeImagePaths);
                const dimMap = new Map();
                for (const r of nativeResults) {
                    if (r.width && r.height) dimMap.set(r.path, { width: r.width, height: r.height });
                }
                for (const fileObj of fileObjs) {
                    const dims = dimMap.get(fileObj.path);
                    if (dims) { fileObj.width = dims.width; fileObj.height = dims.height; }
                }
                logPerf('scan-folder.dimensions-native', dimStart, { files: nativeImagePaths.length, hits: dimMap.size });
            }
        }

        // Worker pool: videos, SVGs, and images if native not available
        const needsWorkerScan = (scanImageDimensions && (!nativeScanner || !nativeScanner.readImageDimensions) && getSizeOf())
            || (scanImageDimensions && fileObjs.some(f => f.isImage && f.path.toLowerCase().endsWith('.svg')))
            || (scanVideoDimensions && ffprobePath);
        if (needsWorkerScan && dimensionPool) {
            const filesToScan = fileObjs.filter(f => {
                if (f.width) return false; // Already resolved by native
                if (f.isImage && scanImageDimensions) return true; // SVGs and fallback
                if (!f.isImage && scanVideoDimensions && ffprobePath) return true;
                return false;
            }).map(f => ({ path: f.path, isImage: f.isImage }));

            if (filesToScan.length > 0) {
                const dimensionStart = performance.now();
                const dimensionMap = await dimensionPool.scanDimensions(filesToScan);
                logPerf('scan-folder.dimensions-worker', dimensionStart, { files: filesToScan.length, hits: dimensionMap.size });
                for (const fileObj of fileObjs) {
                    const dims = dimensionMap.get(fileObj.path);
                    if (dims) { fileObj.width = dims.width; fileObj.height = dims.height; }
                }
            }
        }
    }

    // Clean up internal field before sending to renderer
    const mediaFiles = fileObjs.map(({ isImage, ...rest }) => rest);

    logPerf('scan-folder.total', scanStart, { folders: folders.length, files: mediaFiles.length, skipStats: skipStats ? 1 : 0, native: nativeScanner ? 1 : 0 });
    return { folders, mediaFiles };
}

/**
 * Lightweight peek into a folder to find up to `limit` media files for folder thumbnail previews.
 * Prioritizes images over videos (faster thumbnail generation via sharp vs ffmpeg).
 * Stops early once limit is reached — does NOT scan the entire directory.
 */
async function peekFolderMedia(folderPath, limit = 4) {
    try {
        const items = await fs.promises.readdir(folderPath, { withFileTypes: true });
        const imageExts = pluginRegistry.getImageExtensions();
        const videoExts = pluginRegistry.getVideoExtensions();

        const images = [];
        const videos = [];

        for (const item of items) {
            if (!item.isFile()) continue;
            const lastDot = item.name.lastIndexOf('.');
            if (lastDot === -1) continue;
            const ext = item.name.substring(lastDot).toLowerCase();

            if (images.length < limit && imageExts.has(ext)) {
                images.push({ name: item.name, type: 'image' });
            } else if (videoExts.has(ext)) {
                videos.push({ name: item.name, type: 'video' });
            }
            if (images.length >= limit) break;
        }

        // Fill remaining slots with videos
        const combined = images.concat(videos.slice(0, limit - images.length));
        if (combined.length === 0) return [];

        // Stat files in parallel for mtime
        const results = await Promise.all(combined.map(async (f) => {
            const fullPath = path.join(folderPath, f.name);
            try {
                const stats = await fs.promises.stat(fullPath);
                return { path: fullPath, type: f.type, mtime: stats.mtimeMs };
            } catch {
                return null;
            }
        }));

        return results.filter(Boolean);
    } catch {
        return [];
    }
}

function getFolderPreviewCachePath(folderPath) {
    return path.join(folderPreviewDir, createThumbCacheKey(folderPath, 0, 'folder-preview') + '.json');
}

ipcMain.handle('get-folder-preview', async (event, folderPath, previewCount) => {
    const startTime = performance.now();
    try {
        validateUserPath(folderPath);
        // Check folder mtime for cache invalidation
        let folderMtime;
        try {
            const folderStats = await fs.promises.stat(folderPath);
            folderMtime = folderStats.mtimeMs;
        } catch {
            return { ok: true, value: [] };
        }

        // Check disk cache
        const cachePath = getFolderPreviewCachePath(folderPath);
        const effectiveCount = previewCount || 4;
        try {
            const cacheData = JSON.parse(await fs.promises.readFile(cachePath, 'utf8'));
            if (cacheData.folderMtime === folderMtime && Array.isArray(cacheData.results) && (cacheData.count || 4) >= effectiveCount) {
                // Verify the referenced thumbnail files still exist on disk.
                // Cache eviction may have deleted them; stale URLs yield 404s in the
                // renderer's <img> tags. If any are missing, regenerate from scratch.
                // Perf: parallel async access() instead of sequential existsSync()
                const existChecks = await Promise.all(
                    cacheData.results.map(async r => {
                        if (!r || !r.url) return false;
                        const p = fileUrlToPath(r.url);
                        if (!p) return false;
                        try { await fs.promises.access(p); return true; } catch { return false; }
                    })
                );
                const allExist = existChecks.every(Boolean);
                if (allExist) {
                    logPerf('get-folder-preview', startTime, { cached: 1, count: cacheData.results.length });
                    return { ok: true, value: cacheData.results.slice(0, effectiveCount) };
                }
            }
        } catch { /* cache miss */ }

        // Peek for media files
        const files = await peekFolderMedia(folderPath, effectiveCount);
        if (files.length === 0) {
            // Cache the empty result too
            fs.promises.mkdir(folderPreviewDir, { recursive: true }).then(() =>
                fs.promises.writeFile(cachePath, JSON.stringify({ folderMtime, results: [] }))
            ).catch(() => {});
            logPerf('get-folder-preview', startTime, { cached: 0, count: 0 });
            return { ok: true, value: [] };
        }

        // Generate thumbnails at 192px using existing pipeline
        if (!thumbnailPool) return { ok: true, value: [] };

        const thumbItems = files.map(f => ({
            type: f.type,
            filePath: f.path,
            thumbPath: f.type === 'video'
                ? getThumbCachePath(f.path, f.mtime)
                : getImageThumbCachePath(f.path, f.mtime, 192),
            maxSize: 192
        }));

        const thumbResults = await thumbnailPool.generateBatch(thumbItems);
        const results = thumbItems.map((item, i) => {
            const r = thumbResults[i];
            return {
                filePath: item.filePath,
                url: r && r.success && r.thumbPath ? pathToFileUrl(r.thumbPath) : null
            };
        }).filter(r => r.url);

        // Write cache in the background
        fs.promises.mkdir(folderPreviewDir, { recursive: true }).then(() =>
            fs.promises.writeFile(cachePath, JSON.stringify({ folderMtime, results, count: effectiveCount }))
        ).catch(() => {});

        logPerf('get-folder-preview', startTime, { cached: 0, count: results.length });
        return { ok: true, value: results };
    } catch (error) {
        logPerf('get-folder-preview', startTime, { error: 1 });
        return { ok: false, error: error.message };
    }
});

ipcMain.handle('scan-folder', async (event, folderPath, options = {}) => {
    try {
        folderPath = validateUserPath(folderPath, { mustExist: true });
        const { folders, mediaFiles } = await scanFolderInternal(folderPath, options);
        return { ok: true, value: folders.length + mediaFiles.length > 0 ? [...folders, ...mediaFiles] : [] };
    } catch (error) {
        console.error('Error scanning folder:', error);
        return { ok: false, error: error.message };
    }
});

/**
 * Streaming folder scan.
 * Emits `scan-folder-chunk` events to the renderer as data becomes available:
 *   { scanId, phase: 'items',      items: [...] }            — folders + media files (no dimensions)
 *   { scanId, phase: 'dimensions', dims: [{path,width,height}] }  — dimension updates in chunks
 *   { scanId, phase: 'complete' }                             — scan finished
 *
 * Benefits:
 *   - User sees the grid in ~50ms (folders + filenames + default aspect ratio)
 *   - Dimensions arrive progressively; layout updates over the next 200-2000ms
 *   - Dimension scan is pipelined in chunks so renderer can update incrementally
 *
 * Returns the scanId synchronously so the renderer can match events to calls.
 */
ipcMain.handle('scan-folder-stream', async (event, folderPath, options = {}) => {
    const sender = event.sender;
    const scanId = `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const DIM_CHUNK_SIZE = 500;

    const send = (payload) => {
        if (!sender.isDestroyed()) sender.send('scan-folder-chunk', payload);
    };

    try {
        folderPath = validateUserPath(folderPath, { mustExist: true });
        // Phase A: fast enumeration (no dimensions)
        const phaseAStart = performance.now();
        const { folders, mediaFiles } = await scanFolderInternal(folderPath, {
            ...options,
            scanImageDimensions: false,
            scanVideoDimensions: false,
            skipDimensions: true
        });
        logPerf('scan-folder-stream.phase-a', phaseAStart, {
            folders: folders.length, files: mediaFiles.length
        });

        // Emit items immediately — renderer can show grid now
        send({ scanId, phase: 'items', folders, items: mediaFiles });

        // Phase B: dimensions in background, in chunks
        if (options.scanImageDimensions || options.scanVideoDimensions) {
            // Native pass for non-SVG images (fast, batched)
            const imageFiles = mediaFiles.filter(f =>
                f.type === 'image' && !f.path.toLowerCase().endsWith('.svg'));
            if (imageFiles.length > 0 && options.scanImageDimensions
                && nativeScanner && nativeScanner.readImageDimensions) {
                const phaseBStart = performance.now();
                // Stream in chunks so renderer updates progressively
                for (let i = 0; i < imageFiles.length; i += DIM_CHUNK_SIZE) {
                    const chunk = imageFiles.slice(i, i + DIM_CHUNK_SIZE);
                    const paths = chunk.map(f => f.path);
                    const results = nativeScanner.readImageDimensions(paths);
                    const dims = [];
                    for (const r of results) {
                        if (r.width && r.height) {
                            dims.push({ path: r.path, width: r.width, height: r.height });
                        }
                    }
                    if (dims.length > 0) send({ scanId, phase: 'dimensions', dims });
                    // yield to the event loop between chunks so IPC can drain
                    await new Promise(resolve => setImmediate(resolve));
                }
                logPerf('scan-folder-stream.phase-b-native', phaseBStart, {
                    files: imageFiles.length
                });
            }

            // Worker pool pass for videos + SVGs (slower, already chunked internally)
            const workerScan = [];
            if (options.scanImageDimensions) {
                for (const f of mediaFiles) {
                    if (f.type === 'image' && f.path.toLowerCase().endsWith('.svg')) {
                        workerScan.push({ path: f.path, isImage: true });
                    }
                }
            }
            if (options.scanVideoDimensions && ffprobePath) {
                for (const f of mediaFiles) {
                    if (f.type === 'video') workerScan.push({ path: f.path, isImage: false });
                }
            }
            if (workerScan.length > 0 && dimensionPool) {
                // Process in chunks through the pool
                for (let i = 0; i < workerScan.length; i += DIM_CHUNK_SIZE) {
                    const chunk = workerScan.slice(i, i + DIM_CHUNK_SIZE);
                    const dimMap = await dimensionPool.scanDimensions(chunk);
                    const dims = [];
                    for (const [p, d] of dimMap) {
                        if (d && d.width && d.height) {
                            dims.push({ path: p, width: d.width, height: d.height });
                        }
                    }
                    if (dims.length > 0) send({ scanId, phase: 'dimensions', dims });
                }
            }
        }

        send({ scanId, phase: 'complete' });
        return { ok: true, value: { scanId, totalFolders: folders.length, totalFiles: mediaFiles.length } };
    } catch (error) {
        console.error('Error streaming folder scan:', error);
        send({ scanId, phase: 'complete', error: error.message });
        return { ok: false, error: error.message };
    }
});

// Resolve an array of absolute file paths into item objects (same shape as scan-folder results).
// Returns { items: [...], missing: string[] } where missing contains paths that no longer exist.
ipcMain.handle('resolve-file-paths', async (event, filePaths, options = {}) => {
    const { scanImageDimensions = false, scanVideoDimensions = false } = options;
    const videoExtensions = pluginRegistry.getVideoExtensions();
    const imageExtensions = pluginRegistry.getImageExtensions();
    const supportedExtensions = pluginRegistry.getSupportedExtensions();
    const isWindows = process.platform === 'win32';

    const items = [];
    const missing = [];
    const fileObjs = [];

    await asyncPool(IO_CONCURRENCY_LIMIT, filePaths, async (filePath) => {
        try {
            const stats = await fs.promises.stat(filePath);
            const name = path.basename(filePath);
            const lastDot = name.lastIndexOf('.');
            if (lastDot === -1) { missing.push(filePath); return; }

            const ext = name.substring(lastDot).toLowerCase();
            if (!supportedExtensions.has(ext)) { missing.push(filePath); return; }

            const isImage = imageExtensions.has(ext);
            const fileObj = {
                name,
                path: filePath,
                url: isWindows ? `file:///${filePath.replace(/\\/g, '/')}` : `file://${filePath}`,
                type: isImage ? 'image' : 'video',
                isImage,
                mtime: stats.mtime.getTime(),
                size: stats.size,
                width: undefined,
                height: undefined
            };
            fileObjs.push(fileObj);
        } catch {
            missing.push(filePath);
        }
    });

    // Dimension scanning
    const needsDimensionScan = (scanImageDimensions && getSizeOf()) || (scanVideoDimensions && ffprobePath);
    if (needsDimensionScan && dimensionPool) {
        const filesToScan = fileObjs.filter(f =>
            (f.isImage && scanImageDimensions) || (!f.isImage && scanVideoDimensions && ffprobePath)
        ).map(f => ({ path: f.path, isImage: f.isImage }));

        if (filesToScan.length > 0) {
            const dimensionMap = await dimensionPool.scanDimensions(filesToScan);
            for (const fileObj of fileObjs) {
                const dims = dimensionMap.get(fileObj.path);
                if (dims) {
                    fileObj.width = dims.width;
                    fileObj.height = dims.height;
                }
            }
        }
    }

    // Clean up internal field
    for (const obj of fileObjs) {
        delete obj.isImage;
        items.push(obj);
    }

    return { ok: true, value: { items, missing } };
});

// Scan multiple folders and return combined file items (no folders) for smart collections
// Recursively collect all subdirectory paths under a root folder
async function getSubdirectoriesRecursive(rootPath) {
    const dirs = [rootPath];
    const queue = [rootPath];
    while (queue.length > 0) {
        const current = queue.shift();
        try {
            const entries = await fs.promises.readdir(current, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    const subPath = path.join(current, entry.name);
                    dirs.push(subPath);
                    queue.push(subPath);
                }
            }
        } catch { /* skip inaccessible dirs */ }
    }
    return dirs;
}

// folderEntries: array of { path, recursive } or plain string paths (backward compat)
// rules: optional smart collection rules for pre-filtering before dimension scanning
const FOLDER_SCAN_CONCURRENCY = 8;

ipcMain.handle('scan-folders-for-smart-collection', async (event, folderEntries, options = {}, rules = null, scanId = null) => {
    const scanStart = performance.now();
    const errors = [];
    const sender = event.sender;
    const isWindows = process.platform === 'win32';
    const imageExtensions = pluginRegistry.getImageExtensions();
    const videoExtensions = pluginRegistry.getVideoExtensions();

    // Validate all folder entry paths
    for (const entry of folderEntries) {
        const p = typeof entry === 'string' ? entry : entry.path;
        try { validateUserPath(p, { mustExist: true }); } catch (e) {
            errors.push({ path: p, error: e.message });
        }
    }

    let allFiles = [];

    // === Native fast path: single Rust call for recursive scan + filter + dedup ===
    if (nativeScanner) {
        const nativeStart = performance.now();
        // Separate recursive and non-recursive entries
        const recursiveRoots = [];
        const flatRoots = [];
        for (const entry of folderEntries) {
            const folderPath = typeof entry === 'string' ? entry : entry.path;
            const recursive = typeof entry === 'object' && entry.recursive;
            if (recursive) {
                recursiveRoots.push(folderPath);
            } else {
                flatRoots.push(folderPath);
            }
        }

        // Recursive entries: single native call walks entire trees
        if (recursiveRoots.length > 0) {
            try {
                const imageExts = [...imageExtensions];
                const videoExts = [...videoExtensions];
                const nativeFiles = nativeScanner.scanDirectoryRecursive(recursiveRoots, imageExts, videoExts);
                for (const f of nativeFiles) {
                    const file = {
                        name: f.name,
                        path: f.path,
                        url: isWindows ? `file:///${f.path.replace(/\\/g, '/')}` : `file://${f.path}`,
                        type: f.fileType,
                        mtime: f.mtime,
                        size: f.size,
                        width: undefined,
                        height: undefined,
                    };
                    if (!rules || matchesCheapRules(file, rules)) {
                        allFiles.push(file);
                    }
                }
            } catch (error) {
                for (const root of recursiveRoots) errors.push({ folder: root, error: error.message });
            }
        }

        // Non-recursive entries: single-level native scan per folder
        for (const fp of flatRoots) {
            try {
                const imageExts = [...imageExtensions];
                const videoExts = [...videoExtensions];
                const result = nativeScanner.scanDirectory(fp, imageExts, videoExts, false, true);
                for (const f of result.mediaFiles) {
                    const file = {
                        name: f.name,
                        path: f.path,
                        url: isWindows ? `file:///${f.path.replace(/\\/g, '/')}` : `file://${f.path}`,
                        type: f.fileType,
                        mtime: f.mtime,
                        size: f.size,
                        width: undefined,
                        height: undefined,
                    };
                    if (!rules || matchesCheapRules(file, rules)) {
                        allFiles.push(file);
                    }
                }
            } catch (error) {
                errors.push({ folder: fp, error: error.message });
            }
        }

        // Dedup (native recursive already deduplicates, but flat entries might overlap)
        if (flatRoots.length > 0 && recursiveRoots.length > 0) {
            const seen = new Set();
            allFiles = allFiles.filter(f => {
                const key = f.path.toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }

        logPerf('smart-collection.native-scan', nativeStart, { files: allFiles.length });

        // Send single progress update (native scan is too fast for streaming)
        if (!sender.isDestroyed()) {
            sender.send('smart-collection-scan-progress', {
                scanId,
                foldersScanned: 1, totalFolders: 1,
                items: allFiles
            });
        }
    } else {
        // === JS fallback: original per-folder scan ===
        const folderSet = new Set();
        const allFoldersToScan = [];
        for (const entry of folderEntries) {
            const folderPath = typeof entry === 'string' ? entry : entry.path;
            const recursive = typeof entry === 'object' && entry.recursive;
            try {
                const foldersToScan = recursive
                    ? await getSubdirectoriesRecursive(folderPath)
                    : [folderPath];
                for (const fp of foldersToScan) {
                    const normalized = path.normalize(fp).toLowerCase();
                    if (!folderSet.has(normalized)) {
                        folderSet.add(normalized);
                        allFoldersToScan.push(fp);
                    }
                }
            } catch (error) {
                errors.push({ folder: folderPath, error: error.message });
            }
        }

        const smartOptions = { ...options, smartCollectionMode: true, skipDimensions: true };
        let foldersScanned = 0;
        const totalFolders = allFoldersToScan.length;

        const folderResults = await asyncPool(FOLDER_SCAN_CONCURRENCY, allFoldersToScan, async (fp) => {
            try {
                const { mediaFiles } = await scanFolderInternal(fp, smartOptions);
                foldersScanned++;
                const filtered = rules ? mediaFiles.filter(f => matchesCheapRules(f, rules)) : mediaFiles;
                if (!sender.isDestroyed() && filtered.length > 0) {
                    sender.send('smart-collection-scan-progress', { scanId, foldersScanned, totalFolders, items: filtered });
                } else if (!sender.isDestroyed()) {
                    sender.send('smart-collection-scan-progress', { scanId, foldersScanned, totalFolders });
                }
                return filtered;
            } catch (error) {
                foldersScanned++;
                errors.push({ folder: fp, error: error.message });
                return [];
            }
        });

        const seenPaths = new Set();
        for (const files of folderResults) {
            for (const f of files) {
                const key = f.path.toLowerCase();
                if (!seenPaths.has(key)) {
                    seenPaths.add(key);
                    allFiles.push(f);
                }
            }
        }
    }

    // Phase 3: Dimension scan only the surviving files
    const needsDimensionScan = (options.scanImageDimensions || options.scanVideoDimensions);
    if (needsDimensionScan && allFiles.length > 0) {
        // Apply cache first
        const uncachedFiles = allFiles.filter(f => {
            const cacheKey = `${f.path}|${f.mtime}`;
            const cached = dimensionCacheMain.get(cacheKey);
            if (cached) { f.width = cached.width; f.height = cached.height; return false; }
            return true;
        });

        // Native path for images (non-SVG)
        if (options.scanImageDimensions && nativeScanner && nativeScanner.readImageDimensions) {
            const nativeImagePaths = uncachedFiles
                .filter(f => f.type === 'image' && !f.path.toLowerCase().endsWith('.svg'))
                .map(f => f.path);
            if (nativeImagePaths.length > 0) {
                const dimStart = performance.now();
                const nativeResults = nativeScanner.readImageDimensions(nativeImagePaths);
                for (const r of nativeResults) {
                    if (r.width && r.height) {
                        const fileObj = uncachedFiles.find(f => f.path === r.path);
                        if (fileObj) {
                            fileObj.width = r.width; fileObj.height = r.height;
                            const cacheKey = `${fileObj.path}|${fileObj.mtime}`;
                            dimensionCacheMain.set(cacheKey, { width: r.width, height: r.height });
                        }
                    }
                }
                logPerf('smart-collection.dimensions-native', dimStart, { files: nativeImagePaths.length });
            }
        }

        // Worker pool for remaining (videos, SVGs, fallback images)
        const workerFiles = uncachedFiles.filter(f => {
            if (f.width) return false; // Already resolved
            if (f.type === 'image' && options.scanImageDimensions) return true;
            if (f.type === 'video' && options.scanVideoDimensions && ffprobePath) return true;
            return false;
        }).map(f => ({ path: f.path, isImage: f.type === 'image' }));

        if (workerFiles.length > 0 && dimensionPool) {
            const dimensionStart = performance.now();
            const dimensionMap = await dimensionPool.scanDimensions(workerFiles);
            logPerf('smart-collection.dimensions-worker', dimensionStart, { scanned: workerFiles.length, hits: dimensionMap.size });

            for (const fileObj of allFiles) {
                const dims = dimensionMap.get(fileObj.path);
                if (dims) {
                    fileObj.width = dims.width;
                    fileObj.height = dims.height;
                    const cacheKey = `${fileObj.path}|${fileObj.mtime}`;
                    dimensionCacheMain.set(cacheKey, { width: dims.width, height: dims.height });
                }
            }

            // Evict oldest entries if cache is too large
            if (dimensionCacheMain.size > DIMENSION_CACHE_MAX) {
                const excess = dimensionCacheMain.size - DIMENSION_CACHE_MAX;
                const iter = dimensionCacheMain.keys();
                for (let i = 0; i < excess; i++) {
                    dimensionCacheMain.delete(iter.next().value);
                }
            }
        }
    }

    logPerf('smart-collection.total', scanStart, { folders: folderEntries.length, files: allFiles.length });
    return { ok: true, value: { items: allFiles, errors } };
});

// Cheap rule matching for pre-filtering (no dimension/aspect/rating checks)
// matchesCheapRules — imported from main-utils.js

// Main-process dimension cache (LRU by insertion order)
const dimensionCacheMain = new Map();
const DIMENSION_CACHE_MAX = 10000;

// Context menu IPC handlers
ipcMain.handle('reveal-in-explorer', async (event, filePath) => {
    try {
        filePath = validateUserPath(filePath, { mustExist: true });
        // shell.showItemInFolder opens the file's parent folder and selects the file
        shell.showItemInFolder(filePath);
        return { ok: true, value: null };
    } catch (error) {
        console.error('Error revealing file in explorer:', error);
        return { ok: false, error:error.message };
    }
});

ipcMain.handle('rename-file', async (event, filePath, newName) => {
    try {
        // Validate newName doesn't contain path traversal
        if (newName !== path.basename(newName)) {
            return { ok: false, error:'Invalid file name' };
        }
        const dir = path.dirname(filePath);
        const newPath = path.join(dir, newName);
        
        // Check if new name already exists
        if (fs.existsSync(newPath)) {
            return { ok: false, error:'A file with this name already exists' };
        }
        
        await fs.promises.rename(filePath, newPath);
        try { await appDb.updateFilePaths([{ oldPath: filePath, newPath }]); } catch (e) {
            console.error('Failed to update DB paths after rename:', e);
        }
        pushUndoEntry({
            type: 'rename',
            description: `Rename "${path.basename(filePath)}" → "${newName}"`,
            operations: [{ type: 'rename', oldPath: filePath, newPath }]
        });
        return { ok: true, value: { newPath } };
    } catch (error) {
        console.error('Error renaming file:', error);
        return { ok: false, error:error.message };
    }
});

ipcMain.handle('batch-rename', async (event, filePaths, patternType, patternOptions) => {
    try {
        const results = [];
        const operations = [];
        const renamedPairs = [];

        // Compute all new names first for validation
        const planned = [];
        for (let i = 0; i < filePaths.length; i++) {
            const fp = filePaths[i];
            const dir = path.dirname(fp);
            const ext = path.extname(fp);
            const baseName = path.basename(fp, ext);
            let newName;

            switch (patternType) {
                case 'prefix':
                    newName = patternOptions.text + path.basename(fp);
                    break;
                case 'suffix':
                    newName = baseName + patternOptions.text + ext;
                    break;
                case 'numbering': {
                    const num = (patternOptions.start || 1) + i * (patternOptions.step || 1);
                    const padded = String(num).padStart(patternOptions.padding || 1, '0');
                    const template = patternOptions.template || '{name}_{n}';
                    newName = template.replace('{name}', baseName).replace('{n}', padded) + ext;
                    break;
                }
                case 'findReplace': {
                    const flags = patternOptions.caseSensitive ? 'g' : 'gi';
                    const useRegex = patternOptions.useRegex;
                    const fullName = path.basename(fp);
                    if (useRegex) {
                        try {
                            const regex = new RegExp(patternOptions.find, flags);
                            newName = fullName.replace(regex, patternOptions.replace || '');
                        } catch (e) {
                            return { ok: false, error:`Invalid regex: ${e.message}` };
                        }
                    } else {
                        // Escape special regex chars for literal search
                        const escaped = patternOptions.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const regex = new RegExp(escaped, flags);
                        newName = fullName.replace(regex, patternOptions.replace || '');
                    }
                    break;
                }
                default:
                    return { ok: false, error:`Unknown pattern type: ${patternType}` };
            }

            // Validate
            if (newName !== path.basename(newName)) {
                return { ok: false, error:`Invalid name "${newName}" contains path separators` };
            }
            if (!newName || newName.trim() === '') {
                return { ok: false, error:`Pattern produces empty name for "${path.basename(fp)}"` };
            }

            const newPath = path.join(dir, newName);
            planned.push({ oldPath: fp, newPath, newName });
        }

        // Check for duplicates within the batch
        const newPaths = new Set();
        for (const p of planned) {
            if (newPaths.has(p.newPath.toLowerCase())) {
                return { ok: false, error:`Duplicate name in batch: "${p.newName}"` };
            }
            newPaths.add(p.newPath.toLowerCase());
        }

        // Check for conflicts with existing files (excluding files being renamed) — async parallel
        const oldPathSet = new Set(filePaths.map(fp => fp.toLowerCase()));
        const toCheck = planned.filter(p => p.oldPath !== p.newPath && !oldPathSet.has(p.newPath.toLowerCase()));
        if (toCheck.length > 0) {
            const checks = await Promise.allSettled(
                toCheck.map(p => fs.promises.access(p.newPath).then(() => p.newName))
            );
            const conflict = checks.find(c => c.status === 'fulfilled');
            if (conflict) {
                return { ok: false, error: `"${conflict.value}" already exists on disk` };
            }
        }

        // Execute renames
        const shouldReport = planned.length > 5;
        for (let i = 0; i < planned.length; i++) {
            const p = planned[i];
            if (p.oldPath === p.newPath) {
                results.push({ oldPath: p.oldPath, newPath: p.newPath, skipped: true });
                if (shouldReport) event.sender.send('batch-rename-progress', { current: i + 1, total: planned.length });
                continue;
            }
            try {
                await fs.promises.rename(p.oldPath, p.newPath);
                operations.push({ type: 'rename', oldPath: p.oldPath, newPath: p.newPath });
                renamedPairs.push({ oldPath: p.oldPath, newPath: p.newPath });
                results.push({ oldPath: p.oldPath, newPath: p.newPath, ok: true });
            } catch (err) {
                results.push({ oldPath: p.oldPath, newPath: p.newPath, ok: false, error: err.message });
            }
            if (shouldReport && (i % 3 === 0 || i === planned.length - 1)) {
                event.sender.send('batch-rename-progress', { current: i + 1, total: planned.length });
            }
        }

        // Update database references for successfully renamed files
        if (renamedPairs.length > 0) {
            try { await appDb.updateFilePaths(renamedPairs); } catch (e) {
                console.error('Failed to update DB paths after batch rename:', e);
            }
            pushUndoEntry({
                type: 'rename',
                description: `Batch rename ${renamedPairs.length} file${renamedPairs.length === 1 ? '' : 's'}`,
                operations
            });
        }

        const successCount = results.filter(r => r.ok).length;
        return { ok: true, value: { results, successCount, totalCount: filePaths.length } };
    } catch (error) {
        console.error('Error in batch rename:', error);
        return { ok: false, error:error.message };
    }
});

ipcMain.handle('delete-file', async (event, filePath) => {
    try {
        filePath = validateUserPath(filePath, { mustExist: true });
        const basename = path.basename(filePath);
        if (useSystemTrash) {
            await shell.trashItem(filePath);
            return { ok: true, value: { trashed: true } };
        }
        const stagingPath = await moveToStaging(filePath, undoTrashDir);
        pushUndoEntry({
            type: 'delete',
            description: `Delete "${basename}"`,
            operations: [{ type: 'delete', originalPath: filePath, stagingPath }]
        });
        return { ok: true, value: { trashed: false } };
    } catch (error) {
        console.error('Error deleting file:', error);
        return { ok: false, error:error.message };
    }
});

wrapIpc('open-url', (url) => shell.openExternal(url));

ipcMain.handle('open-with-default', async (event, filePath) => {
    try {
        // shell.openPath opens the file with the system's default application
        await shell.openPath(filePath);
        return { ok: true, value: null };
    } catch (error) {
        console.error('Error opening file with default app:', error);
        return { ok: false, error:error.message };
    }
});

// Start native OS drag of one or more files. Called when renderer wants the
// user to drag files OUT of the Electron window into another app (Explorer,
// email, chat). Using `ipcMain.on` (not handle) because startDrag is fire-and-
// forget from the renderer's perspective.
ipcMain.on('start-drag-files', (event, filePaths) => {
    if (!Array.isArray(filePaths) || filePaths.length === 0) return;
    try {
        let icon = null;
        // Try the first image file as the drag icon.
        const firstPath = filePaths[0];
        const ext = path.extname(firstPath).toLowerCase();
        const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.bmp'];
        if (imageExts.includes(ext)) {
            const img = nativeImage.createFromPath(firstPath);
            if (img && !img.isEmpty()) {
                icon = img.resize({ width: 64, quality: 'good' });
            }
        }
        // Fallback: a 1x1 transparent PNG. startDrag requires a non-empty icon.
        if (!icon || icon.isEmpty()) {
            icon = nativeImage.createFromDataURL(
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
            );
        }
        event.sender.startDrag({
            files: filePaths,
            icon
        });
    } catch (err) {
        console.error('start-drag-files failed:', err);
    }
});

ipcMain.handle('copy-image-to-clipboard', async (event, filePath) => {
    try {
        // Copy file to clipboard so it can be pasted in file explorers
        if (process.platform === 'win32') {
            const { execFile } = require('child_process');
            const escaped = filePath.replace(/'/g, "''");
            await new Promise((resolve, reject) => {
                execFile('powershell.exe', [
                    '-NoProfile', '-NonInteractive', '-Command',
                    `Set-Clipboard -LiteralPath '${escaped}'`
                ], { windowsHide: true }, (err) => err ? reject(err) : resolve());
            });
        } else if (process.platform === 'darwin') {
            // macOS: use osascript to put a file reference on the clipboard
            const { execFile } = require('child_process');
            const escaped = filePath.replace(/"/g, '\\"');
            await new Promise((resolve, reject) => {
                execFile('osascript', [
                    '-e', `set the clipboard to (POSIX file "${escaped}")`
                ], (err) => err ? reject(err) : resolve());
            });
        } else {
            // Linux: try xclip for a file URI (paste-in-file-manager), fall back to image data
            let copied = false;
            try {
                const { spawn } = require('child_process');
                const fileUri = `file://${filePath}`;
                await new Promise((resolve, reject) => {
                    const child = spawn('xclip', [
                        '-selection', 'clipboard', '-t', 'text/uri-list', '-i'
                    ], { stdio: ['pipe', 'ignore', 'ignore'] });
                    child.on('error', reject);
                    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`xclip exit ${code}`)));
                    child.stdin.write(fileUri + '\n');
                    child.stdin.end();
                });
                copied = true;
            } catch { /* xclip not available — fall back to image pixel copy */ }

            if (!copied) {
                const ext = path.extname(filePath).toLowerCase();
                let image;
                if (['.gif', '.webp', '.avif', '.tiff', '.tif'].includes(ext)) {
                    const sharp = require('sharp');
                    const pngBuffer = await sharp(filePath, { animated: false }).png().toBuffer();
                    image = nativeImage.createFromBuffer(pngBuffer);
                } else {
                    image = nativeImage.createFromPath(filePath);
                }
                if (image.isEmpty()) {
                    return { ok: false, error: 'Could not load image' };
                }
                clipboard.writeImage(image);
            }
        }
        return { ok: true, value: null };
    } catch (error) {
        return { ok: false, error:error.message };
    }
});

ipcMain.handle('open-with', async (event, filePath) => {
    try {
        if (process.platform === 'win32') {
            const { spawn } = require('child_process');

            // Ensure we have an absolute path
            const absolutePath = path.resolve(filePath);

            // Verify the file exists
            if (!fs.existsSync(absolutePath)) {
                console.error('[open-with] File does not exist:', absolutePath);
                return { ok: false, error: 'File does not exist' };
            }

            // rundll32 doesn't use standard argv parsing — it reads the raw command
            // line and passes everything after the function name verbatim to the DLL
            // entry point.  Node's default quoting wraps paths-with-spaces in double
            // quotes, but OpenAs_RunDLL receives those literal quote chars, can't find
            // the file, and silently exits.  windowsVerbatimArguments:true prevents
            // Node from adding quotes so the raw path reaches the function correctly.
            const win = BrowserWindow.fromWebContents(event.sender);
            return new Promise((resolve) => {
                let resolved = false;
                const child = spawn('rundll32.exe',
                    ['shell32.dll,OpenAs_RunDLL ' + absolutePath], {
                    windowsVerbatimArguments: true,
                    cwd: path.dirname(absolutePath)
                });

                child.on('error', (error) => {
                    if (!resolved) {
                        resolved = true;
                        console.error('[open-with] spawn error:', error);
                        resolve({ ok: false, error: error.message });
                    }
                });

                child.on('exit', (code) => {
                    if (!resolved) {
                        resolved = true;
                        if (code !== 0 && code !== null) {
                            resolve({ ok: false, error: `Open With dialog failed (code ${code})` });
                        } else {
                            resolve({ ok: true, value: null });
                        }
                    }
                });

                // Blur the Electron window so the dialog gets foreground focus
                setTimeout(() => {
                    if (win && !win.isDestroyed()) win.blur();
                }, 200);
            });
        } else {
            // For non-Windows, fall back to default app
            await shell.openPath(filePath);
            return { ok: true, value: null };
        }
    } catch (error) {
        console.error('[open-with] Error:', error);
        return { ok: false, error: error.message };
    }
});

// Get available drives (Windows only)
ipcMain.handle('get-drives', async () => {
    try {
        if (process.platform === 'darwin') {
            // macOS: root + mounted volumes
            const drives = [{ letter: '', path: '/', name: 'Macintosh HD' }];
            try {
                const entries = await fs.promises.readdir('/Volumes', { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory() || entry.isSymbolicLink()) {
                        const volPath = `/Volumes/${entry.name}`;
                        // Skip the root volume symlink (usually "Macintosh HD")
                        try {
                            const real = await fs.promises.realpath(volPath);
                            if (real === '/') continue;
                        } catch {}
                        drives.push({ letter: '', path: volPath, name: entry.name });
                    }
                }
            } catch {}
            return { ok: true, value: drives };
        }
        if (process.platform !== 'win32') {
            // Linux / other Unix: root filesystem
            const drives = [{ letter: '', path: '/', name: '/' }];
            try {
                // Include common mount points
                for (const mountRoot of ['/media', '/mnt']) {
                    const entries = await fs.promises.readdir(mountRoot, { withFileTypes: true }).catch(() => []);
                    for (const entry of entries) {
                        if (entry.isDirectory()) {
                            drives.push({ letter: '', path: `${mountRoot}/${entry.name}`, name: entry.name });
                        }
                    }
                }
            } catch {}
            return { ok: true, value: drives };
        }
        
        const drives = [];
        // Check drives A: through Z:
        for (let i = 65; i <= 90; i++) {
            const driveLetter = String.fromCharCode(i);
            const drivePath = `${driveLetter}:\\`;
            
            try {
                // Try to stat the drive root to check if it exists
                // This works even for empty drives (like CD drives without discs)
                const stats = await fs.promises.stat(drivePath);
                if (stats.isDirectory()) {
                    drives.push({
                        letter: driveLetter,
                        path: drivePath,
                        name: `${driveLetter}:`
                    });
                }
            } catch (error) {
                // Drive doesn't exist or isn't accessible, skip it
            }
        }
        
        return { ok: true, value: drives };
    } catch (error) {
        console.error('Error getting drives:', error);
        return { ok: false, error: error.message };
    }
});

// List subdirectories of a given path (for folder tree sidebar)
// Performance: hasChildren checks run in parallel so expanding a folder with
// many subfolders is almost as fast as a single readdir.
ipcMain.handle('list-subdirectories', async (event, folderPath) => {
    const listStart = performance.now();
    try {
        if (nativeScanner) {
            const results = nativeScanner.listSubdirectories(folderPath);
            logPerf('list-subdirectories', listStart, { count: results.length, native: 1 });
            return { ok: true, value: results };
        }

        // JS fallback
        const items = await fs.promises.readdir(folderPath, { withFileTypes: true });
        const SKIP_NAMES = new Set([
            'System Volume Information', '$Recycle.Bin', '$RECYCLE.BIN',
            'Recovery', 'Config.Msi', 'Documents and Settings',
        ]);
        const dirItems = [];
        for (const item of items) {
            if (!item.isDirectory()) continue;
            if (item.name.startsWith('.') || item.name.startsWith('$')) continue;
            if (SKIP_NAMES.has(item.name)) continue;
            dirItems.push({ name: item.name, path: path.join(folderPath, item.name) });
        }

        // Check hasChildren with bounded parallelism
        const results = await asyncPool(IO_CONCURRENCY_LIMIT, dirItems, async (dir) => {
            let hasChildren = false;
            try {
                const children = await fs.promises.readdir(dir.path, { withFileTypes: true });
                hasChildren = children.some(c => c.isDirectory() && !c.name.startsWith('.') && !c.name.startsWith('$'));
            } catch (e) {
                // Permission denied — show as leaf
            }
            return { name: dir.name, path: dir.path, hasChildren };
        });

        results.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
        logPerf('list-subdirectories', listStart, { count: results.length, limit: IO_CONCURRENCY_LIMIT });
        return { ok: true, value: results };
    } catch (error) {
        logPerf('list-subdirectories', listStart, { error: 1 });
        console.error('Error listing subdirectories:', error);
        return { ok: false, error: error.message };
    }
});

// File watching
let chokidar = null;
try {
    chokidar = require('chokidar');
} catch (error) {
    console.warn('chokidar not available, file watching disabled');
}
const watchedFolders = new Map(); // Map<folderPath, watcher>

// Get file information
ipcMain.handle('get-file-info', async (event, filePath) => {
    const infoStart = performance.now();
    try {
        const stats = await fs.promises.stat(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const isVideo = pluginRegistry.getVideoExtensions().has(ext);
        const isImage = pluginRegistry.getImageExtensions().has(ext);
        
        let info = {
            path: filePath,
            name: path.basename(filePath),
            size: stats.size,
            sizeFormatted: formatFileSize(stats.size),
            created: stats.birthtime,
            modified: stats.mtime,
            type: isVideo ? 'video' : (isImage ? 'image' : 'unknown'),
            width: undefined,
            height: undefined,
            duration: undefined,
            codec: undefined,
            comfyUIWorkflow: undefined
        };
        
        // Get dimensions for images (image-size v2 requires a Buffer)
        if (isImage && getSizeOf()) {
            try {
                const fileBuffer = await readImageHeader(filePath);
                if (fileBuffer.length > 0) {
                    const dimensions = getSizeOf()(fileBuffer);
                    if (dimensions && dimensions.width && dimensions.height) {
                        info.width = dimensions.width;
                        info.height = dimensions.height;
                    }
                }
            } catch (error) {
                // Silently fail - dimensions are optional
            }
        }

        // Get duration for videos via ffprobe (optional — don't fail the whole request)
        if (isVideo) {
            try {
                const dur = await getVideoDuration(filePath);
                if (dur) info.duration = dur;
            } catch { /* optional */ }
        }
        
        // Run plugin metadata extractors for this file type
        try {
            const pluginMetadata = await pluginRegistry.extractMetadata(filePath, ext);
            if (Object.keys(pluginMetadata).length > 0) {
                info.pluginMetadata = pluginMetadata;
                // Backward compatibility: surface comfyUIWorkflow at top level
                if (pluginMetadata['comfyui-workflow']) {
                    info.comfyUIWorkflow = pluginMetadata['comfyui-workflow'];
                    console.log(`ComfyUI workflow found in ${path.basename(filePath)}: key="${info.comfyUIWorkflow.key}"`);
                }
            } else if (ext === '.png') {
                console.log(`No ComfyUI workflow found in ${path.basename(filePath)}`);
            }
        } catch (error) {
            console.warn('Plugin metadata extraction error:', error.message);
        }

        logPerf('get-file-info', infoStart, { type: info.type });
        return { ok: true, value: info };
    } catch (error) {
        logPerf('get-file-info', infoStart, { error: 1 });
        console.error('Error getting file info:', error);
        return { ok: false, error:error.message };
    }
});

// formatFileSize — imported from main-utils.js

// Create folder
ipcMain.handle('create-folder', async (event, folderPath, folderName) => {
    try {
        // Validate folderName doesn't contain path traversal
        if (folderName !== path.basename(folderName)) {
            return { ok: false, error:'Invalid folder name' };
        }
        const newFolderPath = path.join(folderPath, folderName);
        if (fs.existsSync(newFolderPath)) {
            return { ok: false, error:'Folder already exists' };
        }
        await fs.promises.mkdir(newFolderPath, { recursive: true });
        return { ok: true, value: { path: newFolderPath } };
    } catch (error) {
        console.error('Error creating folder:', error);
        return { ok: false, error:error.message };
    }
});

// Copy file (used when dropping external files into the app)
// Accepts either (sourcePath, destPath) or (sourcePath, destFolder, fileName)
// Optional conflictResolution: 'replace' | 'keep-both' | 'skip' — if omitted and conflict exists, returns { conflict: true }
ipcMain.handle('copy-file', async (event, sourcePath, destFolderOrPath, fileName, conflictResolution) => {
    try {
        sourcePath = validateUserPath(sourcePath, { mustExist: true });
        const destPath = fileName
            ? path.join(destFolderOrPath, fileName)
            : destFolderOrPath;
        const destDir = path.dirname(destPath);
        try { await fs.promises.access(destDir); } catch { await fs.promises.mkdir(destDir, { recursive: true }); }
        let finalPath = destPath;
        let destExists = false;
        try { await fs.promises.access(finalPath); destExists = true; } catch {}
        if (destExists) {
            if (!conflictResolution) {
                return { ok: true, value: { status: 'conflict', fileName: path.basename(destPath), destPath } };
            }
            if (conflictResolution === 'skip') {
                return { ok: true, value: { status: 'skipped' } };
            } else if (conflictResolution === 'keep-both') {
                const ext = path.extname(destPath);
                const base = path.basename(destPath, ext);
                const dir = path.dirname(destPath);
                // Generate candidates in bulk and check async instead of sync while-loop
                const MAX_CANDIDATES = 100;
                const candidates = [];
                for (let c = 2; c <= MAX_CANDIDATES + 1; c++) {
                    candidates.push(path.join(dir, `${base} (${c})${ext}`));
                }
                const checks = await Promise.allSettled(candidates.map(p => fs.promises.access(p)));
                const firstFree = checks.findIndex(c => c.status === 'rejected');
                finalPath = firstFree >= 0 ? candidates[firstFree] : path.join(dir, `${base} (${MAX_CANDIDATES + 2})${ext}`);
            }
            // 'replace' — use original finalPath (overwrite)
        }
        await fs.promises.copyFile(sourcePath, finalPath);
        return { ok: true, value: { status: 'copied', destPath: finalPath } };
    } catch (error) {
        console.error('Error copying file:', error);
        return { ok: false, error:error.message };
    }
});

// Move file
// Accepts either (sourcePath, destPath) or (sourcePath, destFolder, fileName)
// Optional conflictResolution: 'replace' | 'keep-both' | 'skip' — if omitted and conflict exists, returns { conflict: true }
ipcMain.handle('move-file', async (event, sourcePath, destFolderOrPath, fileName, conflictResolution) => {
    try {
        sourcePath = validateUserPath(sourcePath, { mustExist: true });
        const destPath = fileName
            ? path.join(destFolderOrPath, fileName)
            : destFolderOrPath;
        const destDir = path.dirname(destPath);
        try { await fs.promises.access(destDir); } catch { await fs.promises.mkdir(destDir, { recursive: true }); }

        let finalPath = destPath;
        let destExists = false;
        try { await fs.promises.access(destPath); destExists = true; } catch {}
        if (destExists && path.normalize(sourcePath) !== path.normalize(destPath)) {
            if (!conflictResolution) {
                return { ok: true, value: { status: 'conflict', fileName: path.basename(destPath), destPath } };
            }
            if (conflictResolution === 'skip') {
                return { ok: true, value: { status: 'skipped' } };
            } else if (conflictResolution === 'keep-both') {
                const ext = path.extname(destPath);
                const base = path.basename(destPath, ext);
                const dir = path.dirname(destPath);
                // Generate candidates in bulk and check async instead of sync while-loop
                const MAX_CANDIDATES = 100;
                const candidates = [];
                for (let c = 2; c <= MAX_CANDIDATES + 1; c++) {
                    candidates.push(path.join(dir, `${base} (${c})${ext}`));
                }
                const checks = await Promise.allSettled(candidates.map(p => fs.promises.access(p)));
                const firstFree = checks.findIndex(c => c.status === 'rejected');
                finalPath = firstFree >= 0 ? candidates[firstFree] : path.join(dir, `${base} (${MAX_CANDIDATES + 2})${ext}`);
            } else if (conflictResolution === 'replace') {
                await fs.promises.unlink(destPath);
            }
        }

        await safeMove(sourcePath, finalPath);
        if (path.normalize(sourcePath) !== path.normalize(finalPath)) {
            try { await appDb.updateFilePaths([{ oldPath: sourcePath, newPath: finalPath }]); } catch (e) {
                console.error('Failed to update DB paths after move:', e);
            }
        }
        pushUndoEntry({
            type: 'move',
            description: `Move "${path.basename(sourcePath)}"`,
            operations: [{ type: 'move', sourcePath, destPath: finalPath }]
        });
        return { ok: true, value: { status: 'moved', destPath: finalPath } };
    } catch (error) {
        console.error('Error moving file:', error);
        return { ok: false, error:error.message };
    }
});

// Watch folder for changes
ipcMain.handle('watch-folder', async (event, folderPath) => {
    try {
        if (!chokidar) {
            return { ok: false, error:'File watching not available' };
        }
        
        // Normalize path for consistent comparison
        const normalizedPath = path.normalize(folderPath);

        // Stop existing watcher if any
        if (watchedFolders.has(normalizedPath)) {
            const existingWatcher = watchedFolders.get(normalizedPath);
            if (existingWatcher._debounceMap) {
                existingWatcher._debounceMap.clear();
            }
            if (existingWatcher._batchTimer) {
                clearTimeout(existingWatcher._batchTimer);
                existingWatcher._batchTimer = null;
            }
            await existingWatcher.close();
        }

        const watcher = chokidar.watch(normalizedPath, {
            ignored: /(^|[\/\\])\../, // ignore dotfiles
            persistent: true,
            ignoreInitial: true,
            depth: 10, // Watch recursively (10 levels covers virtually all real folder structures)
            awaitWriteFinish: {
                stabilityThreshold: 100, // Wait 100ms after file stops changing
                pollInterval: 100 // Check every 100ms
            },
            // Use event-driven ReadDirectoryChangesW on Windows (no polling)
            // Falls back gracefully; polling only needed for network drives
            usePolling: false,
            // Atomic writes: treat rename pairs as a single change
            atomic: 200
        });

        // Don't block IPC waiting for watcher init — start watching in background.
        // Watcher events will fire once ready; errors are logged.
        watcher.on('error', (error) => {
            console.error('Watcher error for', normalizedPath, error);
        });
        watcher.on('ready', () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('watcher-ready', normalizedPath);
            }
        });

        // Batch debounce: collect all watcher events into a single Map, fire one
        // timer to flush them all. This replaces the old per-event setTimeout approach
        // which created N timer objects for N simultaneous file changes (e.g. git checkout).
        const pendingEvents = new Map(); // dedupeKey → {event, filePath}
        let batchTimer = null;
        const WATCHER_DEBOUNCE_MS = 500;
        watcher._debounceMap = pendingEvents; // for cleanup on close

        watcher.on('all', (event, filePath) => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            const normalizedFilePath = path.normalize(filePath);
            const dedupeKey = `${event}:${normalizedFilePath}`;

            // Overwrite duplicate event+path entries (latest wins)
            pendingEvents.set(dedupeKey, { event, filePath: normalizedFilePath });

            // Single batch timer — if already running, the new event is just queued
            if (batchTimer === null) {
                batchTimer = setTimeout(() => {
                    batchTimer = null;
                    watcher._batchTimer = null;
                    if (!mainWindow || mainWindow.isDestroyed()) { pendingEvents.clear(); return; }
                    const sender = mainWindow.webContents;
                    for (const entry of pendingEvents.values()) {
                        sender.send('folder-changed', { folderPath: normalizedPath, event: entry.event, filePath: entry.filePath });
                    }
                    pendingEvents.clear();
                }, WATCHER_DEBOUNCE_MS);
                watcher._batchTimer = batchTimer;
            }
        });

        watchedFolders.set(normalizedPath, watcher);
        return { ok: true, value: null };
    } catch (error) {
        console.error('Error watching folder:', error);
        return { ok: false, error:error.message };
    }
});

// Unwatch folder
ipcMain.handle('unwatch-folder', async (event, folderPath) => {
    try {
        // Normalize path for consistent lookup
        const normalizedPath = path.normalize(folderPath);
        if (watchedFolders.has(normalizedPath)) {
            const watcher = watchedFolders.get(normalizedPath);
            // Clear pending batch timer and events before closing
            if (watcher._debounceMap) {
                watcher._debounceMap.clear();
            }
            if (watcher._batchTimer) {
                clearTimeout(watcher._batchTimer);
                watcher._batchTimer = null;
            }
            await watcher.close();
            watchedFolders.delete(normalizedPath);
        }
        return { ok: true, value: null };
    } catch (error) {
        console.error('Error unwatching folder:', error);
        return { ok: false, error:error.message };
    }
});

// Generate a video thumbnail via worker pool (returns file:// URL to cached JPEG or null)
ipcMain.handle('generate-video-thumbnail', async (event, filePath) => {
    const startTime = performance.now();
    try {
        if (!thumbnailPool) return { ok: false, error: 'thumbnail pool unavailable' };
        const stats = await fs.promises.stat(filePath);
        const thumbPath = getThumbCachePath(filePath, stats.mtimeMs);
        const workerT0 = performance.now();
        const result = await thumbnailPool.generate({ type: 'video', filePath, thumbPath });
        const workerMs = performance.now() - workerT0;
        _bumpThumbStats(0, 0, 0, 0, 1, workerMs);
        if (result.success && result.thumbPath) {
            logPerf('generate-video-thumbnail.ipc', startTime, { success: 1, worker: 1 });
            return { ok: true, value: { url: pathToFileUrl(result.thumbPath) } };
        }
        logPerf('generate-video-thumbnail.ipc', startTime, { success: 0, worker: 1 });
        return { ok: false, error: 'thumbnail generation failed' };
    } catch (error) {
        logPerf('generate-video-thumbnail.ipc', startTime, { error: 1 });
        return { ok: false, error:error.message };
    }
});

// Generate an image thumbnail. Prefers native Rust (rayon-parallel `image` crate) when
// available; falls back to the worker-pool + sharp path. Returns file:// URL to cached PNG.
ipcMain.handle('generate-image-thumbnail', async (event, filePath, maxSize = 512) => {
    const startTime = performance.now();
    try {
        const stats = await fs.promises.stat(filePath);
        const thumbPath = getImageThumbCachePath(filePath, stats.mtimeMs, maxSize);

        // Fast path: native Rust pipeline. Single-item batch still benefits from rayon
        // for future batches; overhead per call is negligible.
        if (nativeScanner && nativeScanner.generateImageThumbnails) {
            const nativeT0 = performance.now();
            const results = nativeScanner.generateImageThumbnails([{ filePath, thumbPath, maxSize }]);
            const nativeMs = performance.now() - nativeT0;
            if (results && results[0] && results[0].success) {
                _bumpThumbStats(1, nativeMs, 0, 0, 0, 0);
                logPerf('generate-image-thumbnail.ipc', startTime, { success: 1, maxSize, native: 1 });
                return { ok: true, value: { url: pathToFileUrl(thumbPath) } };
            }
            // If native failed, fall through to sharp (covers formats native can't handle, e.g. SVG)
        }

        if (!thumbnailPool) return { ok: false, error: 'thumbnail pool unavailable' };
        const workerT0 = performance.now();
        const result = await thumbnailPool.generate({ type: 'image', filePath, thumbPath, maxSize });
        const workerMs = performance.now() - workerT0;
        _bumpThumbStats(0, 0, 1, workerMs, 0, 0);
        if (result.success && result.thumbPath) {
            logPerf('generate-image-thumbnail.ipc', startTime, { success: 1, maxSize, worker: 1 });
            return { ok: true, value: { url: pathToFileUrl(result.thumbPath) } };
        }
        logPerf('generate-image-thumbnail.ipc', startTime, { success: 0, maxSize, worker: 1 });
        return { ok: false, error: 'thumbnail generation failed' };
    } catch (error) {
        logPerf('generate-image-thumbnail.ipc', startTime, { error: 1, maxSize });
        return { ok: false, error:error.message };
    }
});

// Running counters that clearly distinguish the three thumbnail paths:
//   native — images via Rust (image crate + rayon)
//   sharp  — images that fell back to sharp (SVG, unsupported formats)
//   ffmpeg — videos (unavoidable; only ffmpeg can decode them)
let _thumbStats = {
    native: 0, nativeMs: 0,
    sharp: 0, sharpMs: 0,
    ffmpeg: 0, ffmpegMs: 0,
    lastPrint: 0
};
function _bumpThumbStats(nativeCount, nativeMs, sharpCount, sharpMs, ffmpegCount, ffmpegMs) {
    _thumbStats.native += nativeCount;  _thumbStats.nativeMs += nativeMs;
    _thumbStats.sharp  += sharpCount;   _thumbStats.sharpMs  += sharpMs;
    _thumbStats.ffmpeg += ffmpegCount;  _thumbStats.ffmpegMs += ffmpegMs;
    const total = _thumbStats.native + _thumbStats.sharp + _thumbStats.ffmpeg;
    if (total - _thumbStats.lastPrint >= 50) {
        _thumbStats.lastPrint = total;
        const fmt = (count, ms) => count ? `${count} (avg ${(ms / count).toFixed(1)}ms)` : '0';
        console.log(
            `[thumbnails] total=${total} ` +
            `images→native=${fmt(_thumbStats.native, _thumbStats.nativeMs)} ` +
            `images→sharp=${fmt(_thumbStats.sharp, _thumbStats.sharpMs)} ` +
            `videos→ffmpeg=${fmt(_thumbStats.ffmpeg, _thumbStats.ffmpegMs)}`
        );
    }
}

// Batch thumbnail generation -- reduces IPC round-trips for large folders
// items: Array<{ filePath, type: 'image'|'video', maxSize? }>
// Returns: Array<{ filePath, success, url? }>
//
// Images go through the native Rust pipeline (rayon-parallel) when available.
// Videos go through the worker pool + ffmpeg. Any native-failed images fall back to sharp.
ipcMain.handle('generate-thumbnails-batch', async (event, items) => {
    const startTime = performance.now();
    try {
        if (!Array.isArray(items) || items.length === 0) return { ok: true, value: [] };

        // Build thumb paths and stat files in parallel
        const prepared = await Promise.all(items.map(async (item) => {
            try {
                const stats = await fs.promises.stat(item.filePath);
                const thumbPath = item.type === 'video'
                    ? getThumbCachePath(item.filePath, stats.mtimeMs)
                    : getImageThumbCachePath(item.filePath, stats.mtimeMs, item.maxSize || 512);
                return { ...item, thumbPath };
            } catch {
                return { ...item, thumbPath: null };
            }
        }));

        const validItems = prepared.filter(i => i.thumbPath);
        const invalidItems = prepared.filter(i => !i.thumbPath);
        const resultMap = new Map();

        // Partition images vs. videos (videos must go through ffmpeg worker pool)
        const imageBatch = [];
        const videoBatch = [];
        for (const item of validItems) {
            if (item.type === 'image') imageBatch.push(item);
            else videoBatch.push(item);
        }

        // Extract plugin-handled extensions BEFORE sending to native/sharp pipeline.
        // These formats (e.g. .psd, .pdf) cannot be decoded by native/sharp,
        // so routing them to plugin generators first avoids wasted work.
        const pluginBatch = [];
        const nativeImageBatch = [];
        for (const item of imageBatch) {
            const ext = path.extname(item.filePath).toLowerCase();
            if (pluginRegistry.hasCustomThumbnailGenerator(ext)) {
                pluginBatch.push(item);
            } else {
                nativeImageBatch.push(item);
            }
        }

        // Process plugin-handled thumbnails with concurrency limit (avoids spawning unbounded processes)
        if (pluginBatch.length > 0) {
            await asyncPool(4, pluginBatch, async (item) => {
                try {
                    const ext = path.extname(item.filePath).toLowerCase();
                    const dataUrl = await pluginRegistry.generateThumbnail(item.filePath, ext);
                    if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
                        const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
                        if (item.thumbPath) {
                            await fs.promises.mkdir(path.dirname(item.thumbPath), { recursive: true });
                            await fs.promises.writeFile(item.thumbPath, Buffer.from(base64, 'base64'));
                            resultMap.set(item.filePath, { filePath: item.filePath, ok: true, url: pathToFileUrl(item.thumbPath) });
                        } else {
                            resultMap.set(item.filePath, { filePath: item.filePath, ok: true, url: dataUrl });
                        }
                    }
                } catch (err) {
                    console.warn(`[Plugin thumbnail] ${path.basename(item.filePath)} failed:`, err.message);
                }
            });
        }

        let nativeFailures = [];
        let nativeMs = 0;
        let nativeSuccesses = 0;
        // Native Rust batch for images (excluding plugin-handled formats)
        if (nativeImageBatch.length > 0 && nativeScanner && nativeScanner.generateImageThumbnails) {
            const nativeRequests = nativeImageBatch.map(item => ({
                filePath: item.filePath,
                thumbPath: item.thumbPath,
                maxSize: item.maxSize || 512
            }));
            const nativeT0 = performance.now();
            const nativeResults = nativeScanner.generateImageThumbnails(nativeRequests);
            nativeMs = performance.now() - nativeT0;
            for (let i = 0; i < nativeResults.length; i++) {
                const r = nativeResults[i];
                if (r.success) {
                    nativeSuccesses++;
                    resultMap.set(r.filePath, {
                        filePath: r.filePath,
                        ok: true,
                        url: pathToFileUrl(r.thumbPath)
                    });
                } else {
                    // Native couldn't handle this image (e.g. SVG) — fall back to sharp
                    nativeFailures.push(nativeImageBatch[i]);
                }
            }
        } else {
            // No native addon — everything goes through sharp
            nativeFailures = nativeImageBatch;
        }

        // Worker-pool path for videos + native-failed images
        const workerItems = videoBatch.concat(nativeFailures);
        let workerMs = 0;
        if (workerItems.length > 0 && thumbnailPool) {
            const workerT0 = performance.now();
            const results = await thumbnailPool.generateBatch(workerItems);
            workerMs = performance.now() - workerT0;
            workerItems.forEach((item, i) => {
                const r = results[i];
                resultMap.set(item.filePath, {
                    filePath: item.filePath,
                    ok: !!(r && r.success),
                    url: r && r.success && r.thumbPath ? pathToFileUrl(r.thumbPath) : null
                });
            });
        } else if (workerItems.length > 0) {
            for (const item of workerItems) {
                resultMap.set(item.filePath, { filePath: item.filePath, ok: false, url: null });
            }
        }
        // Distribute the worker-path time across sharp (images) and ffmpeg (videos)
        // weighted by item count (rough but gives a clear per-path breakdown).
        const totalWorker = workerItems.length || 1;
        const sharpMs = workerMs * (nativeFailures.length / totalWorker);
        const ffmpegMs = workerMs * (videoBatch.length / totalWorker);
        _bumpThumbStats(nativeSuccesses, nativeMs, nativeFailures.length, sharpMs, videoBatch.length, ffmpegMs);

        for (const item of invalidItems) {
            resultMap.set(item.filePath, { filePath: item.filePath, ok: false, url: null });
        }

        const output = items.map(item => resultMap.get(item.filePath) || { filePath: item.filePath, ok: false, url: null });
        const nativeCount = nativeImageBatch.length - nativeFailures.length;
        logPerf('generate-thumbnails-batch', startTime, {
            count: items.length,
            success: output.filter(r => r.ok).length,
            native: nativeCount,
            worker: workerItems.length
        });
        return { ok: true, value: output };
    } catch (error) {
        logPerf('generate-thumbnails-batch', startTime, { error: 1 });
        return { ok: false, error: error.message };
    }
});

ipcMain.handle('scan-file-dimensions', async (event, files) => {
    const startTime = performance.now();
    try {
        if (!Array.isArray(files) || files.length === 0) {
            logPerf('scan-file-dimensions', startTime, { files: 0, hits: 0 });
            return { ok: true, value: [] };
        }

        const sanitizedFiles = files.filter(file =>
            file && typeof file.path === 'string' && typeof file.isImage === 'boolean'
        );
        if (sanitizedFiles.length === 0) {
            logPerf('scan-file-dimensions', startTime, { files: 0, hits: 0 });
            return { ok: true, value: [] };
        }

        const results = sanitizedFiles.map(f => ({ path: f.path, width: undefined, height: undefined }));

        // Native path for images (non-SVG)
        if (nativeScanner && nativeScanner.readImageDimensions) {
            const nativeImages = sanitizedFiles
                .filter(f => f.isImage && !f.path.toLowerCase().endsWith('.svg'));
            if (nativeImages.length > 0) {
                const nativeResults = nativeScanner.readImageDimensions(nativeImages.map(f => f.path));
                const nativeMap = new Map();
                for (const r of nativeResults) {
                    if (r.width && r.height) nativeMap.set(r.path, { width: r.width, height: r.height });
                }
                for (const r of results) {
                    const dims = nativeMap.get(r.path);
                    if (dims) { r.width = dims.width; r.height = dims.height; }
                }
            }
        }

        // Worker pool for remaining (videos, SVGs, fallback)
        const workerFiles = sanitizedFiles.filter((f, i) => !results[i].width);
        if (workerFiles.length > 0 && dimensionPool) {
            const dimensionMap = await dimensionPool.scanDimensions(
                workerFiles.map(f => ({ path: f.path, isImage: f.isImage }))
            );
            for (const r of results) {
                if (!r.width) {
                    const dims = dimensionMap.get(r.path);
                    if (dims) { r.width = dims.width; r.height = dims.height; }
                }
            }
        }

        logPerf('scan-file-dimensions', startTime, { files: sanitizedFiles.length, hits: results.filter(r => r.width).length });
        return { ok: true, value: results };
    } catch (error) {
        logPerf('scan-file-dimensions', startTime, { error: 1 });
        return { ok: false, error: error.message };
    }
});

// ==================== DUPLICATE DETECTION ====================

// POPCOUNT_TABLE — imported from main-utils.js

// ── WebGPU hamming distance offload ─────────────────────────────────────────
// Main collects perceptual hashes and asks the renderer to run a compute
// shader that emits all pairs ≤ threshold. On a modern GPU this is ~50× faster
// than the CPU popcount path for large collections (10K+ hashes).
let _webgpuReqId = 0;
const _webgpuPending = new Map(); // id -> {resolve, reject, timeoutId}

function setupWebgpuHammingListener() {
    ipcMain.removeAllListeners('webgpu-hamming-response');
    ipcMain.on('webgpu-hamming-response', (_event, msg) => {
        if (!msg || msg.id == null) return;
        const entry = _webgpuPending.get(msg.id);
        if (!entry) return;
        _webgpuPending.delete(msg.id);
        if (entry.timeoutId) clearTimeout(entry.timeoutId);
        if (msg.error) entry.reject(new Error(msg.error));
        else entry.resolve(msg);
    });
}
setupWebgpuHammingListener();

function computeHammingPairsViaRenderer(hashBytes, threshold, timeoutMs = 30000) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return Promise.reject(new Error('no main window'));
    }
    return new Promise((resolve, reject) => {
        const id = ++_webgpuReqId;
        const timeoutId = setTimeout(() => {
            _webgpuPending.delete(id);
            reject(new Error('webgpu request timed out'));
        }, timeoutMs);
        _webgpuPending.set(id, { resolve, reject, timeoutId, _createdAt: Date.now() });
        mainWindow.webContents.send('webgpu-hamming-request', { id, hashBytes, threshold });
    });
}

// hammingDistance — imported from main-utils.js

ipcMain.handle('scan-duplicates', async (event, folderPath, options = {}) => {
    const threshold = options.threshold != null ? options.threshold : 10;
    try {
        const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
        const videoExtensions = new Set(['.mp4', '.webm', '.ogg', '.mov']);
        const imageExtensions = new Set(['.gif', '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.svg']);

        const files = [];
        const statPromises = [];

        for (const entry of entries) {
            if (!entry.isFile()) continue;
            const ext = path.extname(entry.name).toLowerCase();
            const isVideo = videoExtensions.has(ext);
            const isImage = imageExtensions.has(ext);
            if (!isVideo && !isImage) continue;

            const filePath = path.join(folderPath, entry.name);
            statPromises.push(
                fs.promises.stat(filePath).then(stat => {
                    let thumbPath = null;
                    if (isVideo && videoThumbDir) {
                        thumbPath = getThumbCachePath(filePath, stat.mtimeMs);
                    }
                    files.push({
                        path: filePath,
                        name: entry.name,
                        size: stat.size,
                        mtime: stat.mtimeMs,
                        isImage,
                        isVideo,
                        thumbPath
                    });
                }).catch(() => {})
            );
        }
        await Promise.all(statPromises);

        if (files.length === 0) return { ok: true, value: { exactGroups: [], similarGroups: [] } };

        event.sender.send('duplicate-scan-progress', { current: 0, total: files.length, phase: 'hashing' });

        // ── DB hash cache: skip files whose mtime hasn't changed ─────
        const normPath = (p) => p.replace(/\\/g, '/');
        let dbCache = {};
        try {
            dbCache = await appDb.getHashesForPaths(files.map(f => normPath(f.path)));
        } catch (e) {
            console.warn('[scan-duplicates] hash cache lookup failed:', e.message);
        }

        const staleFiles = [];
        const cachedHashMap = new Map(); // path → {exactHash, perceptualHash}
        for (const f of files) {
            const key = normPath(f.path);
            const cached = dbCache[key];
            if (cached && cached.file_mtime === f.mtime) {
                cachedHashMap.set(f.path, {
                    exactHash: cached.exact_hash,
                    perceptualHash: cached.perceptual_hash
                });
            } else {
                staleFiles.push(f);
            }
        }
        if (cachedHashMap.size > 0) {
            console.log(`[scan-duplicates] hash cache: ${cachedHashMap.size} cached, ${staleFiles.length} to hash`);
        }

        // Exact hashes: use native BLAKE3 if available (parallel, ~3x faster)
        let exactHashMap;
        if (staleFiles.length > 0 && nativeScanner && nativeScanner.hashFiles) {
            const hashStart = performance.now();
            const results = nativeScanner.hashFiles(staleFiles.map(f => f.path));
            exactHashMap = new Map();
            for (const r of results) {
                exactHashMap.set(r.path, r.hash || null);
            }
            logPerf('scan-duplicates.exact-hash-native', hashStart, { files: staleFiles.length });
        }
        event.sender.send('duplicate-scan-progress', { current: cachedHashMap.size, total: files.length, phase: 'hashing' });

        // ── Gate: identify stale files that can skip perceptual hashing ──
        // 1) Files < 10KB — dHash at 9×8 is meaningless for tiny icons/sprites
        // 2) Files with exact duplicates — already grouped, no perceptual needed
        const PERCEPTUAL_MIN_SIZE = 10240; // 10 KB
        const skipPerceptualPaths = new Set();
        for (const f of staleFiles) {
            if (f.size < PERCEPTUAL_MIN_SIZE) skipPerceptualPaths.add(f.path);
        }
        // If we have exact hashes (native path), find stale files in exact-dup groups
        // (include cached hashes so cross-cache duplicates are caught)
        if (exactHashMap) {
            const allExactHashes = new Map(); // hash → [path, ...]
            for (const [fp, h] of cachedHashMap) {
                if (h.exactHash) {
                    if (!allExactHashes.has(h.exactHash)) allExactHashes.set(h.exactHash, []);
                    allExactHashes.get(h.exactHash).push(fp);
                }
            }
            for (const [fp, hash] of exactHashMap) {
                if (hash) {
                    if (!allExactHashes.has(hash)) allExactHashes.set(hash, []);
                    allExactHashes.get(hash).push(fp);
                }
            }
            for (const group of allExactHashes.values()) {
                if (group.length >= 2) {
                    for (const fp of group) skipPerceptualPaths.add(fp);
                }
            }
        }
        if (skipPerceptualPaths.size > 0) {
            console.log(`[scan-duplicates] skipping perceptual hash for ${skipPerceptualPaths.size} files (small/exact-dup)`);
        }

        // Perceptual hashes: prefer native Rust (rayon-parallel, faster decode
        // than sharp). Falls back to the JS worker pool if native isn't available.
        let freshHashMap = new Map();
        if (staleFiles.length > 0 && nativeScanner && nativeScanner.computePerceptualHashes) {
            // Prefer cached 512px thumbnails over original files — decoding a
            // 5MB JPEG is ~30-80ms vs. ~2-5ms for a 512px PNG thumbnail.
            // Pre-generate missing image thumbnails first (same pattern as CLIP).
            const perceptualStaleFiles = staleFiles.filter(f => !skipPerceptualPaths.has(f.path));

            // Batch-check all candidate thumbnail paths asynchronously instead of
            // calling fs.existsSync() per file (was 3,000-6,000 blocking stat calls).
            const allCandidatePaths = new Map(); // path → true (dedup)
            const thumbPathForFile = new Map(); // f.path → computed thumb path
            for (const f of perceptualStaleFiles) {
                if (!f.isImage || f.path.toLowerCase().endsWith('.svg') || !f.mtime) continue;
                const tp = getImageThumbCachePath(f.path, f.mtime, 512);
                thumbPathForFile.set(f.path, tp);
                allCandidatePaths.set(tp, false);
                if (f.thumbPath) allCandidatePaths.set(f.thumbPath, false);
            }
            for (const f of perceptualStaleFiles) {
                if (f.thumbPath) allCandidatePaths.set(f.thumbPath, false);
            }

            // Parallel async stat for all candidate paths
            const pathsToCheck = [...allCandidatePaths.keys()];
            const existsResults = await Promise.allSettled(
                pathsToCheck.map(p => fs.promises.access(p).then(() => true, () => false))
            );
            const existingPaths = new Set();
            for (let i = 0; i < pathsToCheck.length; i++) {
                if (existsResults[i].status === 'fulfilled' && existsResults[i].value) {
                    existingPaths.add(pathsToCheck[i]);
                }
            }

            if (nativeScanner.generateImageThumbnails && imageThumbDir) {
                const missing = [];
                for (const f of perceptualStaleFiles) {
                    if (!f.isImage || f.path.toLowerCase().endsWith('.svg') || !f.mtime) continue;
                    const tp = thumbPathForFile.get(f.path);
                    if (!existingPaths.has(tp)) {
                        missing.push({ filePath: f.path, thumbPath: tp, maxSize: 512 });
                    }
                }
                if (missing.length > 0) {
                    const t = performance.now();
                    try {
                        nativeScanner.generateImageThumbnails(missing);
                        // Mark newly generated thumbnails as existing
                        for (const m of missing) existingPaths.add(m.thumbPath);
                        console.log(`[scan-duplicates] pre-generated ${missing.length} thumbnails in ${(performance.now() - t).toFixed(0)}ms`);
                    } catch (e) {
                        console.warn('[scan-duplicates] thumbnail pre-gen failed:', e.message);
                    }
                }
            }

            // Resolve each file to its best source using the pre-built existingPaths set
            const resolveHashSource = (f) => {
                if (f.path.toLowerCase().endsWith('.svg')) return null;
                if (f.thumbPath && existingPaths.has(f.thumbPath)) return f.thumbPath;
                if (f.isImage && imageThumbDir && f.mtime) {
                    const tp = thumbPathForFile.get(f.path);
                    if (tp && existingPaths.has(tp)) return tp;
                }
                return f.isImage ? f.path : null;
            };

            const inputs = [];
            const inputIndices = [];
            for (let i = 0; i < perceptualStaleFiles.length; i++) {
                const src = resolveHashSource(perceptualStaleFiles[i]);
                if (src) { inputs.push(src); inputIndices.push(i); }
            }
            if (inputs.length > 0) {
                const phStart = performance.now();
                const results = nativeScanner.computePerceptualHashes(inputs);
                console.log(`[scan-duplicates] native perceptual hashes: ${inputs.length} files in ${(performance.now() - phStart).toFixed(0)}ms`);

                for (let k = 0; k < results.length; k++) {
                    const file = perceptualStaleFiles[inputIndices[k]];
                    freshHashMap.set(file.path, {
                        exactHash: exactHashMap ? exactHashMap.get(file.path) : null,
                        perceptualHash: results[k].hash || null
                    });
                }
            }
            // All stale files need an entry — skipped ones get null perceptualHash
            for (const file of staleFiles) {
                if (!freshHashMap.has(file.path)) {
                    freshHashMap.set(file.path, {
                        exactHash: exactHashMap ? exactHashMap.get(file.path) : null,
                        perceptualHash: null
                    });
                }
            }
        } else if (staleFiles.length > 0) {
            // JS fallback: generate missing image thumbnails with fused dHash
            // to avoid a second decode in the hash worker.
            const precomputedDHash = new Map(); // filePath → dHash hex
            if (thumbnailPool && imageThumbDir) {
                const thumbItems = [];
                const thumbFileMap = new Map(); // index in thumbItems → file
                for (const f of staleFiles) {
                    if (skipPerceptualPaths.has(f.path)) continue;
                    if (!f.isImage || !f.mtime) continue;
                    if (f.path.toLowerCase().endsWith('.svg')) continue;
                    const tp = getImageThumbCachePath(f.path, f.mtime, 512);
                    thumbItems.push({
                        type: 'image', filePath: f.path, thumbPath: tp,
                        maxSize: 512, computeDHash: true
                    });
                    thumbFileMap.set(thumbItems.length - 1, f);
                }
                if (thumbItems.length > 0) {
                    const thumbResults = await thumbnailPool.generateBatch(thumbItems);
                    for (let i = 0; i < thumbResults.length; i++) {
                        const r = thumbResults[i];
                        const f = thumbFileMap.get(i);
                        if (r && r.dHash && f) {
                            precomputedDHash.set(f.path, r.dHash);
                            // Also set thumbPath on file so hash-worker uses it for any fallback
                            if (r.thumbPath) f.thumbPath = r.thumbPath;
                        }
                    }
                    if (precomputedDHash.size > 0) {
                        console.log(`[scan-duplicates] fused dHash from thumbnails: ${precomputedDHash.size} files`);
                    }
                }
            }

            // Pass pre-computed dHashes so hash-worker skips perceptual for those files.
            // Also skip perceptual for gated files (small / exact-dup).
            const hashFiles = staleFiles.map(f => {
                if (skipPerceptualPaths.has(f.path)) return { ...f, skipPerceptual: true };
                const dHash = precomputedDHash.get(f.path);
                return dHash ? { ...f, perceptualHash: dHash } : f;
            });

            freshHashMap = await hashPool.scanHashes(hashFiles, (completed, total) => {
                if (!exactHashMap) {
                    event.sender.send('duplicate-scan-progress', {
                        current: cachedHashMap.size + completed, total: files.length, phase: 'hashing'
                    });
                }
            });
        }

        // Merge native BLAKE3 exact hashes into fresh results
        if (exactHashMap) {
            for (const [filePath, hashes] of freshHashMap) {
                hashes.exactHash = exactHashMap.get(filePath) || hashes.exactHash;
            }
        }

        // Combine cached + fresh into unified hashMap
        const hashMap = new Map(cachedHashMap);
        for (const [fp, h] of freshHashMap) {
            hashMap.set(fp, h);
        }

        // Persist newly computed hashes to DB
        if (freshHashMap.size > 0) {
            try {
                const staleByPath = new Map(staleFiles.map(f => [f.path, f]));
                const entries = [];
                for (const [fp, h] of freshHashMap) {
                    const f = staleByPath.get(fp);
                    if (f) {
                        entries.push({
                            file_path: normPath(fp),
                            file_size: f.size,
                            file_mtime: f.mtime,
                            exact_hash: h.exactHash,
                            perceptual_hash: h.perceptualHash
                        });
                    }
                }
                if (entries.length > 0) {
                    await appDb.saveHashes(entries);
                    console.log(`[scan-duplicates] persisted ${entries.length} hashes to DB`);
                }
            } catch (e) {
                console.warn('[scan-duplicates] hash persist failed:', e.message);
            }
        }

        event.sender.send('duplicate-scan-progress', { current: files.length, total: files.length, phase: 'hashing' });

        event.sender.send('duplicate-scan-progress', { current: 0, total: 0, phase: 'comparing' });

        // Group by exact hash
        const exactMap = new Map();
        for (const file of files) {
            const h = hashMap.get(file.path);
            if (!h || !h.exactHash) continue;
            if (!exactMap.has(h.exactHash)) exactMap.set(h.exactHash, []);
            exactMap.get(h.exactHash).push({
                path: file.path,
                name: file.name,
                size: file.size,
                mtime: file.mtime
            });
        }
        const exactGroups = [];
        for (const group of exactMap.values()) {
            if (group.length >= 2) exactGroups.push(group);
        }

        // Collect files with perceptual hashes (exclude those already in exact groups)
        const exactPaths = new Set();
        for (const group of exactGroups) {
            for (const f of group) exactPaths.add(f.path);
        }

        const perceptualFiles = [];
        for (const file of files) {
            if (exactPaths.has(file.path)) continue;
            const h = hashMap.get(file.path);
            if (!h || !h.perceptualHash) continue;
            perceptualFiles.push({ ...file, perceptualHash: h.perceptualHash });
        }

        // Union-find with path compression + union-by-rank
        const parent = new Map();
        const rank = new Map();
        const find = (x) => {
            if (!parent.has(x)) { parent.set(x, x); rank.set(x, 0); }
            let root = x;
            while (parent.get(root) !== root) root = parent.get(root);
            // Path compression (iterative)
            while (parent.get(x) !== root) {
                const next = parent.get(x);
                parent.set(x, root);
                x = next;
            }
            return root;
        };
        const union = (a, b) => {
            const ra = find(a);
            const rb = find(b);
            if (ra === rb) return;
            const rankA = rank.get(ra) || 0;
            const rankB = rank.get(rb) || 0;
            if (rankA < rankB) { parent.set(ra, rb); }
            else if (rankA > rankB) { parent.set(rb, ra); }
            else { parent.set(rb, ra); rank.set(ra, rankA + 1); }
        };

        // Pre-convert all hashes to Buffers once to avoid repeated hex parsing
        const hashBuffers = perceptualFiles.map(f => Buffer.from(f.perceptualHash, 'hex'));

        // Try the WebGPU path for large sets — it's ~50× faster than CPU for 10K+ hashes.
        // Falls through to the CPU popcount loop below if the GPU call fails.
        let usedGpu = false;
        if (perceptualFiles.length >= 500 && mainWindow && !mainWindow.isDestroyed()) {
            try {
                const WIDTH = hashBuffers[0].length;
                // All hashes must be the same width for the GPU kernel
                const allSameWidth = hashBuffers.every(b => b.length === WIDTH);
                // Current kernel assumes 16-byte (128-bit) hashes
                if (allSameWidth && WIDTH === 16) {
                    const flat = Buffer.concat(hashBuffers);
                    const gpuStart = performance.now();
                    const result = await computeHammingPairsViaRenderer(flat, threshold);
                    const gpuMs = performance.now() - gpuStart;
                    if (result.overflowed) {
                        console.warn(`[scan-duplicates] WebGPU output overflowed (${result.count} pairs found, cap is 500K) — falling back to CPU`);
                    } else {
                        // result.pairs = [i0, j0, d0, i1, j1, d1, ...]
                        const pairs = result.pairs;
                        for (let p = 0; p < pairs.length; p += 3) {
                            const i = pairs[p];
                            const j = pairs[p + 1];
                            union(perceptualFiles[i].path, perceptualFiles[j].path);
                        }
                        console.log(`[scan-duplicates] WebGPU compared ${perceptualFiles.length} hashes in ${gpuMs.toFixed(0)}ms, found ${result.count} pairs`);
                        usedGpu = true;
                    }
                }
            } catch (err) {
                console.warn('[scan-duplicates] WebGPU path failed, falling back to CPU:', err.message);
            }
        }

        // CPU fallback: pairwise comparison with popcount LUT + early exit
        if (!usedGpu) {
            const cpuStart = performance.now();
            let compCount = 0;
            for (let i = 0; i < perceptualFiles.length; i++) {
                const buf1 = hashBuffers[i];
                for (let j = i + 1; j < perceptualFiles.length; j++) {
                    const buf2 = hashBuffers[j];
                    const len = Math.min(buf1.length, buf2.length);
                    let dist = 0;
                    for (let k = 0; k < len; k++) {
                        dist += POPCOUNT_TABLE[buf1[k] ^ buf2[k]];
                        if (dist > threshold) break;
                    }
                    if (dist <= threshold) {
                        union(perceptualFiles[i].path, perceptualFiles[j].path);
                    }
                    compCount++;
                }
                if (compCount > 50000) {
                    compCount = 0;
                    await new Promise(resolve => setImmediate(resolve));
                }
            }
            console.log(`[scan-duplicates] CPU compared ${perceptualFiles.length} hashes in ${(performance.now() - cpuStart).toFixed(0)}ms`);
        }

        const similarMap = new Map();
        for (const file of perceptualFiles) {
            const root = find(file.path);
            if (!similarMap.has(root)) similarMap.set(root, []);
            similarMap.get(root).push({
                path: file.path,
                name: file.name,
                size: file.size,
                mtime: file.mtime
            });
        }
        const similarGroups = [];
        for (const group of similarMap.values()) {
            if (group.length >= 2) similarGroups.push(group);
        }

        event.sender.send('duplicate-scan-progress', { current: 0, total: 0, phase: 'done' });

        // Build hashData for client-side caching (enables instant re-grouping)
        const hashData = files.map(file => {
            const h = hashMap.get(file.path);
            return {
                path: file.path,
                name: file.name,
                size: file.size,
                mtime: file.mtime,
                exactHash: h ? h.exactHash : null,
                perceptualHash: h ? h.perceptualHash : null
            };
        });

        return { ok: true, value: { exactGroups, similarGroups, hashData } };
    } catch (error) {
        console.error('Error scanning duplicates:', error);
        return { ok: false, error: error.message };
    }
});

ipcMain.handle('regroup-duplicates', async (event, hashData, newThreshold) => {
    try {
        // Group by exact hash
        const exactMap = new Map();
        for (const file of hashData) {
            if (!file.exactHash) continue;
            if (!exactMap.has(file.exactHash)) exactMap.set(file.exactHash, []);
            exactMap.get(file.exactHash).push({
                path: file.path,
                name: file.name,
                size: file.size,
                mtime: file.mtime
            });
        }
        const exactGroups = [];
        for (const group of exactMap.values()) {
            if (group.length >= 2) exactGroups.push(group);
        }

        // Collect files with perceptual hashes (exclude those in exact groups)
        const exactPaths = new Set();
        for (const group of exactGroups) {
            for (const f of group) exactPaths.add(f.path);
        }

        const perceptualFiles = [];
        for (const file of hashData) {
            if (exactPaths.has(file.path)) continue;
            if (!file.perceptualHash) continue;
            perceptualFiles.push(file);
        }

        // Union-find with path compression + union-by-rank
        const parent = new Map();
        const rank = new Map();
        const find = (x) => {
            if (!parent.has(x)) { parent.set(x, x); rank.set(x, 0); }
            let root = x;
            while (parent.get(root) !== root) root = parent.get(root);
            while (parent.get(x) !== root) {
                const next = parent.get(x);
                parent.set(x, root);
                x = next;
            }
            return root;
        };
        const union = (a, b) => {
            const ra = find(a);
            const rb = find(b);
            if (ra === rb) return;
            const rankA = rank.get(ra) || 0;
            const rankB = rank.get(rb) || 0;
            if (rankA < rankB) { parent.set(ra, rb); }
            else if (rankA > rankB) { parent.set(rb, ra); }
            else { parent.set(rb, ra); rank.set(ra, rankA + 1); }
        };

        // Pre-convert hashes to Buffers + inline comparison with early exit
        const hashBuffers = perceptualFiles.map(f => Buffer.from(f.perceptualHash, 'hex'));
        for (let i = 0; i < perceptualFiles.length; i++) {
            const buf1 = hashBuffers[i];
            for (let j = i + 1; j < perceptualFiles.length; j++) {
                const buf2 = hashBuffers[j];
                const len = Math.min(buf1.length, buf2.length);
                let dist = 0;
                for (let k = 0; k < len; k++) {
                    dist += POPCOUNT_TABLE[buf1[k] ^ buf2[k]];
                    if (dist > newThreshold) break;
                }
                if (dist <= newThreshold) {
                    union(perceptualFiles[i].path, perceptualFiles[j].path);
                }
            }
        }

        const similarMap = new Map();
        for (const file of perceptualFiles) {
            const root = find(file.path);
            if (!similarMap.has(root)) similarMap.set(root, []);
            similarMap.get(root).push({
                path: file.path,
                name: file.name,
                size: file.size,
                mtime: file.mtime
            });
        }
        const similarGroups = [];
        for (const group of similarMap.values()) {
            if (group.length >= 2) similarGroups.push(group);
        }

        return { ok: true, value: { exactGroups, similarGroups } };
    } catch (error) {
        console.error('Error regrouping duplicates:', error);
        return { ok: false, error: error.message };
    }
});

ipcMain.handle('delete-files-batch', async (event, filePaths) => {
    const deleted = [];
    const failed = [];
    const operations = [];
    const total = filePaths.length;
    const shouldReport = total > 10;
    for (let i = 0; i < total; i++) {
        const filePath = filePaths[i];
        try {
            validateUserPath(filePath, { mustExist: true });
            if (useSystemTrash) {
                await shell.trashItem(filePath);
            } else {
                const stagingPath = await moveToStaging(filePath, undoTrashDir);
                operations.push({ type: 'delete', originalPath: filePath, stagingPath });
            }
            deleted.push(filePath);
        } catch (error) {
            failed.push({ path: filePath, error: error.message });
        }
        if (shouldReport && (i % 5 === 4 || i === total - 1)) {
            event.sender.send('batch-delete-progress', { current: i + 1, total });
        }
    }
    if (!useSystemTrash && operations.length > 0) {
        pushUndoEntry({
            type: 'batch-delete',
            description: `Delete ${operations.length} file${operations.length > 1 ? 's' : ''}`,
            operations
        });
    }
    return { ok: true, value: { deleted, failed, trashed: useSystemTrash } };
});

// Check if ffmpeg is available (renderer can adapt UI accordingly)
ipcMain.handle('has-ffmpeg', async () => {
    return { ok: true, value: { ffmpeg: !!ffmpegPath, ffprobe: !!ffprobePath } };
});

// ─── Video Trimming & File Conversion (ffmpeg-backed) ──────────────────
// A generic ffmpeg runner exposed over IPC. Supports two operations:
//   'trim'    — cut a video/animated file between startSec and endSec
//   'convert' — re-encode into a different container/format
//
// Jobs are tracked by jobId in _ffmpegJobs so the renderer can cancel them.
// Progress is streamed back via 'ffmpeg-progress' events, parsed from ffmpeg's
// `-progress pipe:1` output (machine-readable key=value lines).

const _ffmpegJobs = new Map(); // jobId -> { child, outputPath, canceled }

function _pickSaveAsDialog(defaultPath, filters) {
    return dialog.showSaveDialog({
        title: 'Save As',
        defaultPath: defaultPath || undefined,
        filters: filters || [],
    });
}

ipcMain.handle('show-save-dialog', async (_event, opts) => {
    try {
        const result = await _pickSaveAsDialog(opts?.defaultPath, opts?.filters);
        if (result.canceled || !result.filePath) return { ok: true, value: { canceled: true } };
        return { ok: true, value: { canceled: false, filePath: result.filePath } };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('show-folder-picker', async (_event, opts) => {
    try {
        const result = await dialog.showOpenDialog({
            title: opts?.title || 'Choose folder',
            defaultPath: opts?.defaultPath || undefined,
            properties: ['openDirectory', 'createDirectory'],
        });
        if (result.canceled || !result.filePaths[0]) return { ok: true, value: { canceled: true } };
        return { ok: true, value: { canceled: false, folderPath: result.filePaths[0] } };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

// _qualityToParams, buildFfmpegArgs, _parseFfmpegProgressChunk — imported from main-utils.js

ipcMain.handle('ffmpeg-run', async (event, job) => {
    if (!ffmpegPath) {
        return { ok: false, error:'ffmpeg not found' };
    }
    if (!job || !job.jobId || !job.inputPath || !job.outputPath || !job.operation) {
        return { ok: false, error:'Invalid job descriptor' };
    }

    // Ensure parent dir exists
    try {
        const parent = path.dirname(path.resolve(job.outputPath));
        if (!fs.existsSync(parent)) {
            fs.mkdirSync(parent, { recursive: true });
        }
    } catch (err) {
        return { ok: false, error:`Cannot create output folder: ${err.message}` };
    }

    // Prevent overwriting the input file
    try {
        if (path.resolve(job.inputPath).toLowerCase() === path.resolve(job.outputPath).toLowerCase()) {
            return { ok: false, error:'Output cannot be the same as input' };
        }
    } catch { /* path resolve failed, continue */ }

    let args;
    try {
        args = buildFfmpegArgs(job);
    } catch (err) {
        return { ok: false, error:err.message };
    }

    const { spawn } = require('child_process');
    const totalSec = job.totalSec || null; // renderer passes expected output duration for progress calc

    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(ffmpegPath, args, { windowsHide: true });
        } catch (err) {
            resolve({ ok: false, error:`Failed to spawn ffmpeg: ${err.message}` });
            return;
        }

        const jobState = { child, outputPath: job.outputPath, canceled: false };
        _ffmpegJobs.set(job.jobId, jobState);

        let stderrBuf = '';
        let lastReport = 0;

        child.stdout.on('data', (chunk) => {
            try {
                const { percent, isEnd } = _parseFfmpegProgressChunk(chunk, totalSec);
                const now = Date.now();
                if (percent != null && (now - lastReport > 250 || isEnd)) {
                    lastReport = now;
                    try { event.sender.send('ffmpeg-progress', { jobId: job.jobId, percent }); } catch {}
                }
            } catch { /* ignore */ }
        });

        child.stderr.on('data', (chunk) => {
            const s = chunk.toString();
            // Cap stderr buffer at ~16KB to avoid memory growth on long runs
            if (stderrBuf.length < 16_000) stderrBuf += s;
        });

        child.on('error', (err) => {
            _ffmpegJobs.delete(job.jobId);
            try { fs.unlinkSync(job.outputPath); } catch {}
            resolve({ ok: false, error:`ffmpeg failed to start: ${err.message}` });
        });

        child.on('close', (code, signal) => {
            _ffmpegJobs.delete(job.jobId);
            if (jobState.canceled || signal === 'SIGKILL' || signal === 'SIGTERM') {
                try { fs.unlinkSync(job.outputPath); } catch {}
                resolve({ ok: true, value: { canceled: true } });
                return;
            }
            if (code === 0) {
                // Final progress tick so the UI can show 100%
                try { event.sender.send('ffmpeg-progress', { jobId: job.jobId, percent: 100 }); } catch {}
                resolve({ ok: true, value: { outputPath: job.outputPath } });
            } else {
                try { fs.unlinkSync(job.outputPath); } catch {}
                const tail = stderrBuf.trim().split(/\r?\n/).slice(-4).join(' | ');
                resolve({ ok: false, error:`ffmpeg exited with code ${code}: ${tail || 'unknown error'}` });
            }
        });
    });
});

ipcMain.handle('ffmpeg-cancel', async (_event, jobId) => {
    const j = _ffmpegJobs.get(jobId);
    if (!j) return { ok: false, error:'Job not running' };
    j.canceled = true;
    try {
        j.child.kill('SIGKILL');
        return { ok: true, value: null };
    } catch (err) {
        return { ok: false, error:err.message };
    }
});

// --- AI Visual Search (CLIP) IPC handlers ---
// Inference runs directly in the main process (no worker threads)
// to avoid Electron ABI incompatibility with onnxruntime-node in workers.

const MODEL_NAME = 'Xenova/clip-vit-base-patch32';

function getClipCacheDir() {
    return path.join(app.getPath('userData'), 'clip-models');
}

// --- GPU acceleration state ---
// Sentinel = "GPU session creation in progress". If it's still here on startup,
// the previous GPU attempt crashed (likely DirectML segfault bypassing error handling).
// Known-bad = persistent flag set after a sentinel-detected crash. User resets via Settings.
function getGpuSentinelPath() {
    return path.join(app.getPath('userData'), 'clip-gpu-attempted.lock');
}
function getGpuKnownBadPath() {
    return path.join(app.getPath('userData'), 'clip-gpu-known-bad.flag');
}
let _clipLastGpuProvider = null; // 'directml' | 'cuda' | 'coreml' | 'cpu' | null
let _clipLastGpuFallbackReason = null; // human-readable string when we forced CPU in 'auto' mode

// Resolve the effective GPU mode for a clip-init call.
// Returns { useGpu: bool, source: string, provider: string|null, note: string|null }
// Precedence: CLIP_GPU env var > explicit 'on'/'off' from renderer > 'auto' (probe + sentinel)
async function resolveClipGpuMode(requestedMode) {
    // Env var override (debug hatch) wins over everything.
    const envRaw = process.env.CLIP_GPU;
    if (envRaw === '0' || envRaw === '') {
        return { useGpu: false, source: 'env CLIP_GPU=0', provider: null, note: null };
    }
    if (envRaw && envRaw !== '0') {
        return { useGpu: true, source: 'env CLIP_GPU=1', provider: null, note: null };
    }

    const mode = (requestedMode === 'on' || requestedMode === 'off' || requestedMode === 'auto')
        ? requestedMode : 'auto';

    if (mode === 'off') {
        return { useGpu: false, source: 'user setting: off', provider: null, note: null };
    }
    if (mode === 'on') {
        return { useGpu: true, source: 'user setting: on', provider: null, note: null };
    }

    // 'auto': sentinel crash guard, then persistent known-bad flag, then probe.
    const sentinel = getGpuSentinelPath();
    const knownBad = getGpuKnownBadPath();

    if (fs.existsSync(sentinel)) {
        // Last attempt crashed mid-init. Promote to persistent known-bad.
        try { fs.writeFileSync(knownBad, `set after sentinel detected on ${new Date().toISOString()}\n`); } catch {}
        try { fs.unlinkSync(sentinel); } catch {}
        const note = 'GPU init crashed on previous run — disabled until you reset it in Settings → AI Search.';
        return { useGpu: false, source: 'crash guard', provider: null, note };
    }

    if (fs.existsSync(knownBad)) {
        return { useGpu: false, source: 'known-bad', provider: null, note: 'GPU previously marked bad. Reset in Settings → AI Search to retry.' };
    }

    // Safe to probe. The probe itself could crash DirectML in theory, but in
    // practice DirectML init with a 103-byte model is a much lighter path than
    // loading fp32 CLIP. The sentinel protects the big load either way.
    try {
        if (nativeScanner && nativeScanner.probeGpu) {
            const provider = nativeScanner.probeGpu();
            if (provider && provider !== 'cpu' && provider !== 'none') {
                return { useGpu: true, source: 'auto (probe)', provider, note: null };
            }
            return { useGpu: false, source: 'auto (probe)', provider: 'cpu', note: null };
        }
    } catch (e) {
        console.warn('[clip] GPU probe failed:', e.message);
        return { useGpu: false, source: 'auto (probe failed)', provider: null, note: null };
    }
    return { useGpu: false, source: 'auto (no probe)', provider: null, note: null };
}

ipcMain.handle('clip-gpu-reset', async () => {
    let removed = 0;
    for (const p of [getGpuSentinelPath(), getGpuKnownBadPath()]) {
        try { fs.unlinkSync(p); removed++; } catch { /* not present */ }
    }
    _clipLastGpuFallbackReason = null;
    return { ok: true, value: { removed } };
});

ipcMain.handle('clip-gpu-status', async () => {
    return { ok: true, value: {
        lastProvider: _clipLastGpuProvider,
        fallbackReason: _clipLastGpuFallbackReason,
        knownBad: fs.existsSync(getGpuKnownBadPath()),
        sentinelPresent: fs.existsSync(getGpuSentinelPath()),
        envOverride: process.env.CLIP_GPU || null,
    } };
});

ipcMain.handle('clip-check-cache', async () => {
    try {
        const cacheDir = getClipCacheDir();
        // Check for an actual model file, not just the directory (which may be empty)
        const onnxFile = path.join(cacheDir, 'Xenova', 'clip-vit-base-patch32', 'onnx', 'model.onnx');
        const onnxQuantized = path.join(cacheDir, 'Xenova', 'clip-vit-base-patch32', 'onnx', 'model_quantized.onnx');
        const cached = fs.existsSync(onnxFile) || fs.existsSync(onnxQuantized);
        return { ok: true, value: { cached } };
    } catch {
        return { ok: true, value: { cached: false } };
    }
});

ipcMain.handle('clip-init', async (event, payload = {}) => {
    try {
        if (clipModel) return { ok: true, value: { gpuMode: _clipLastGpuProvider } };

        // Resolve GPU mode first so we know which dtype to download.
        const requestedMode = payload && typeof payload.gpuMode === 'string' ? payload.gpuMode : 'auto';
        const resolved = await resolveClipGpuMode(requestedMode);
        const useGpu = resolved.useGpu;
        console.log(`[clip] GPU mode: ${useGpu ? 'on' : 'off'} (${resolved.source}${resolved.provider ? ', provider=' + resolved.provider : ''})`);
        if (resolved.note) {
            _clipLastGpuFallbackReason = resolved.note;
            try { event.sender.send('clip-gpu-fallback', { reason: resolved.note, source: resolved.source }); } catch {}
        } else {
            _clipLastGpuFallbackReason = null;
        }

        const transformers = require('@huggingface/transformers');

        const { env, CLIPVisionModelWithProjection, CLIPTextModelWithProjection,
                AutoProcessor, AutoTokenizer, RawImage, Tensor: HfTensor } = transformers;

        env.cacheDir = getClipCacheDir();
        env.allowLocalModels = true;
        env.allowRemoteModels = true;

        const progressCb = (progress) => {
            try { event.sender.send('clip-download-progress', progress); } catch { /* window closed */ }
        };
        const opts = { progress_callback: progressCb };

        // Explicitly specify which ONNX file to use for each model.
        // Without this, the library caches by repo name and both models
        // end up sharing the same (vision) ONNX session.
        // GPU mode needs full-precision models for DirectML/CUDA/CoreML (int8
        // quantized graphs are not reliable on GPU). CPU uses q8 (smaller, faster).
        const visionOpts = { ...opts, model_file_name: 'vision_model', dtype: useGpu ? 'fp32' : 'q8' };
        const textOpts   = { ...opts, model_file_name: 'text_model',   dtype: useGpu ? 'fp32' : 'q8' };

        const [processor, visionModel] = await Promise.all([
            AutoProcessor.from_pretrained(MODEL_NAME, opts),
            CLIPVisionModelWithProjection.from_pretrained(MODEL_NAME, visionOpts),
        ]);
        const [tokenizer, textModel] = await Promise.all([
            AutoTokenizer.from_pretrained(MODEL_NAME, opts),
            CLIPTextModelWithProjection.from_pretrained(MODEL_NAME, textOpts),
        ]);

        clipModel = { visionModel, textModel, processor, tokenizer, RawImage, HfTensor };

        // Spin up worker pool for off-main-thread image preprocessing
        if (!clipPreprocessPool) clipPreprocessPool = new ClipPreprocessPool();

        // Native Rust CLIP: load ONNX sessions inside a Node worker_thread.
        // GPU acceleration uses DirectML / CUDA / CoreML (chosen by ORT based on
        // EP priority). Sentinel file protects against DirectML crashes.
        if (nativeScanner && nativeScanner.clipInit) {
            try {
                const cacheDir = getClipCacheDir();
                const modelRoot = path.join(cacheDir, 'Xenova', 'clip-vit-base-patch32', 'onnx');

                // GPU prefers full fp32 models; CPU prefers quantized
                const pick = (base) => {
                    const full = path.join(modelRoot, `${base}.onnx`);
                    const quant = path.join(modelRoot, `${base}_quantized.onnx`);
                    if (useGpu) {
                        if (fs.existsSync(full)) return full;
                        console.warn(`[clip] GPU mode but ${base}.onnx not found; falling back to CPU with quantized`);
                        return fs.existsSync(quant) ? quant : null;
                    }
                    return fs.existsSync(quant) ? quant : (fs.existsSync(full) ? full : null);
                };
                const visionPath = pick('vision_model');
                const textPath = pick('text_model');
                // If we wanted GPU but had to fall back to quantized models, force CPU.
                const effectiveGpu = useGpu && visionPath && visionPath.endsWith('.onnx') && !visionPath.includes('_quantized');

                if (visionPath && textPath) {
                    const sentinel = getGpuSentinelPath();
                    if (effectiveGpu) {
                        try { fs.writeFileSync(sentinel, `clip-init started ${new Date().toISOString()}\n`); } catch {}
                    }
                    const t0 = Date.now();
                    let ok = false;
                    try {
                        ok = await clipWorkerInit(visionPath, textPath, 4, effectiveGpu);
                    } catch (initErr) {
                        console.warn('[clip] GPU worker init threw:', initErr.message);
                        ok = false;
                    }
                    // Clean sentinel — if we got here, no crash happened.
                    if (effectiveGpu) { try { fs.unlinkSync(sentinel); } catch {} }

                    if (!ok && effectiveGpu) {
                        // Recoverable failure (ORT error, not a crash). Retry on CPU.
                        console.warn('[clip] GPU init failed, retrying with CPU');
                        _clipLastGpuFallbackReason = 'GPU init failed — using CPU for this session.';
                        try { event.sender.send('clip-gpu-fallback', { reason: _clipLastGpuFallbackReason, source: 'runtime fallback' }); } catch {}
                        ok = await clipWorkerInit(visionPath, textPath, 4, false);
                        _clipLastGpuProvider = ok ? 'cpu' : null;
                    } else if (ok) {
                        _clipLastGpuProvider = effectiveGpu ? (resolved.provider || 'gpu') : 'cpu';
                    }
                    if (ok) {
                        console.log(`[clip] native ONNX sessions loaded in worker in ${Date.now() - t0}ms (gpu=${_clipLastGpuProvider})`);
                    }
                } else {
                    console.warn('[clip] native load skipped: model files not found on disk');
                }
            } catch (e) {
                // Safety net: scrub sentinel if we bailed out early.
                try { fs.unlinkSync(getGpuSentinelPath()); } catch {}
                console.warn('[clip] native load failed, falling back to onnxruntime-node:', e.message);
            }
        }

        return { ok: true, value: { gpuMode: _clipLastGpuProvider } };
    } catch (err) {
        clipModel = null;
        console.error('clip-init error:', err);
        return { ok: false, error:err.message };
    }
});

// Helper: embed a single image file
// Uses nativeImage as fallback; prefer clipPreprocessPool for batched work.
// CLIP ViT-B/32 normalization constants (ImageNet)
const CLIP_MEAN = [0.48145466, 0.4578275, 0.40821073];
const CLIP_STD  = [0.26862954, 0.26130258, 0.27577711];
const CLIP_SIZE = 224;
const CLIP_VIDEO_EXTS = new Set(['.mp4', '.webm', '.ogg', '.mov']);
const CLIP_ANIM_EXTS  = new Set(['.gif']);

async function isAnimatedWebp(filePath) {
    try {
        const header = await readImageHeader(filePath, 64 * 1024);
        if (!header || header.length < 20) return false;
        if (header.toString('ascii', 0, 4) !== 'RIFF') return false;
        if (header.toString('ascii', 8, 12) !== 'WEBP') return false;

        let offset = 12;
        while (offset + 8 <= header.length) {
            const fourcc = header.toString('ascii', offset, offset + 4);
            const chunkSize = header.readUInt32LE(offset + 4);
            const chunkDataStart = offset + 8;

            if (fourcc === 'VP8X') {
                if (chunkDataStart >= header.length) return false;
                return !!(header[chunkDataStart] & 0x02);
            }
            if (fourcc === 'ANMF') return true;

            offset = chunkDataStart + chunkSize + (chunkSize & 1);
        }
    } catch {}
    return false;
}

async function classifyClipMediaKind(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (CLIP_VIDEO_EXTS.has(ext)) return 'video';
    if (CLIP_ANIM_EXTS.has(ext)) return 'animated';
    if (ext === '.webp') {
        return (await isAnimatedWebp(filePath)) ? 'animated' : 'image';
    }
    return 'image';
}

// Preprocess an image file into a normalised float32 CHW tensor ready for CLIP.
// Returns Float32Array(3 * 224 * 224) or null on failure.
function clipPreprocessImage(filePath) {
    let img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return null;

    const { width, height } = img.getSize();

    // Resize (cover) + centre-crop to 224x224
    const scale = Math.max(CLIP_SIZE / width, CLIP_SIZE / height);
    const scaledW = Math.ceil(width * scale);
    const scaledH = Math.ceil(height * scale);
    img = img.resize({ width: scaledW, height: scaledH, quality: 'good' });

    const cropX = Math.max(0, Math.floor((scaledW - CLIP_SIZE) / 2));
    const cropY = Math.max(0, Math.floor((scaledH - CLIP_SIZE) / 2));
    img = img.crop({ x: cropX, y: cropY, width: CLIP_SIZE, height: CLIP_SIZE });

    // BGRA bitmap → normalised float32 CHW tensor
    const bitmap = img.toBitmap();
    const pixels = CLIP_SIZE * CLIP_SIZE;
    const tensor = new Float32Array(3 * pixels);

    for (let i = 0; i < pixels; i++) {
        const r = bitmap[i * 4 + 2] / 255;
        const g = bitmap[i * 4 + 1] / 255;
        const b = bitmap[i * 4]     / 255;
        tensor[i]               = (r - CLIP_MEAN[0]) / CLIP_STD[0];
        tensor[pixels + i]      = (g - CLIP_MEAN[1]) / CLIP_STD[1];
        tensor[2 * pixels + i]  = (b - CLIP_MEAN[2]) / CLIP_STD[2];
    }

    return tensor;
}

// Run CLIP vision model on a batch of preprocessed pixel tensors in a single session.run().
// Returns array of L2-normalised embeddings (Array[]), one per input. Null entries for failures.
const CLIP_PIXELS = CLIP_SIZE * CLIP_SIZE * 3;

async function clipEmbedBatch(pixelDataArray) {
    const n = pixelDataArray.length;
    if (n === 0) return [];

    // Concatenate into a single flat Float32Array.
    const batchData = new Float32Array(n * CLIP_PIXELS);
    for (let i = 0; i < n; i++) {
        batchData.set(pixelDataArray[i], i * CLIP_PIXELS);
    }

    // Fast path: native Rust ONNX runtime inside a Node worker_thread.
    // Inference runs fully off the main process — Node event loop stays responsive.
    if (clipNativeReady && _pickWorker()) {
        try {
            const flat = await clipWorkerEmbedBatch(batchData, n);
            const embDim = flat.length / n;
            const results = new Array(n);
            for (let i = 0; i < n; i++) {
                const offset = i * embDim;
                const emb = new Array(embDim);
                for (let j = 0; j < embDim; j++) emb[j] = flat[offset + j];
                results[i] = emb;
            }
            return results;
        } catch (e) {
            console.warn('[clip] native worker inference failed, falling back to onnxruntime-node:', e.message);
        }
    }

    // Fallback: onnxruntime-node via @huggingface/transformers
    const { visionModel, HfTensor } = clipModel;
    const inputTensor = new HfTensor('float32', batchData, [n, 3, CLIP_SIZE, CLIP_SIZE]);
    const output = await visionModel({ pixel_values: inputTensor });
    const raw = output.image_embeds.data;

    const embDim = raw.length / n;
    const results = [];
    for (let i = 0; i < n; i++) {
        const offset = i * embDim;
        let mag = 0;
        for (let j = 0; j < embDim; j++) mag += raw[offset + j] * raw[offset + j];
        mag = Math.sqrt(mag) || 1;
        const emb = new Array(embDim);
        for (let j = 0; j < embDim; j++) emb[j] = raw[offset + j] / mag;
        results.push(emb);
    }

    return results;
}

// Convenience: embed a single image file (preprocess + batch of 1).
async function clipEmbedOneImage(filePath) {
    const pixels = clipPreprocessImage(filePath);
    if (!pixels) return null;
    const [emb] = await clipEmbedBatch([pixels]);
    return emb;
}

// Extract N representative frames from a video or animated image using FFmpeg.
// Samples evenly across the duration. All frames are extracted in parallel.
// Returns array of temp file paths, or null on failure.
async function extractMediaKeyframes(filePath, n = 4) {
    if (!ffmpegPath || !videoThumbDir) return null;
    const duration = await getVideoDuration(filePath);
    if (!duration || duration <= 0) return null;

    const framesDir = path.join(videoThumbDir, 'clip-frames');
    await fs.promises.mkdir(framesDir, { recursive: true });

    const hash = crypto.createHash('md5').update(filePath).digest('hex').slice(0, 12);
    const positions = Array.from({ length: n }, (_, i) => duration * (i + 1) / (n + 1));

    // Extract all frames in parallel — FFmpeg is I/O-bound so this is safe
    const framePaths = (await Promise.all(positions.map((pos, i) => {
        const outPath = path.join(framesDir, `${hash}-${i}.jpg`);
        return new Promise((resolve) => {
            execFile(ffmpegPath, [
                '-ss', String(pos),
                '-i', filePath,
                '-vframes', '1',
                '-q:v', '4',
                '-vf', `scale=${CLIP_SIZE}:-2`,
                '-y',
                outPath
            ], { timeout: 10000 }, (err) => resolve(err ? null : outPath));
        });
    }))).filter(Boolean);

    return framePaths.length > 0 ? framePaths : null;
}

// Average multiple frame embeddings into a single L2-normalised vector.
// Preprocesses all frames, then runs a single batched inference call.
async function clipEmbedMultiFrame(framePaths) {
    // Preprocess frames in worker pool (off main thread)
    let pixelData;
    if (clipPreprocessPool) {
        const results = await clipPreprocessPool.preprocessBatch(framePaths);
        pixelData = results.filter(Boolean);
    } else {
        pixelData = [];
        for (const fp of framePaths) {
            const px = clipPreprocessImage(fp);
            if (px) pixelData.push(px);
        }
    }
    if (pixelData.length === 0) return null;

    // Single batched inference for all frames
    const embeddings = await clipEmbedBatch(pixelData);
    const valid = embeddings.filter(Boolean);
    if (valid.length === 0) return null;
    if (valid.length === 1) return valid[0];

    const len = valid[0].length;
    const avg = new Array(len).fill(0);
    for (const emb of valid) {
        for (let i = 0; i < len; i++) avg[i] += emb[i];
    }
    for (let i = 0; i < len; i++) avg[i] /= valid.length;

    // L2-normalise the averaged vector
    let mag = 0;
    for (let i = 0; i < len; i++) mag += avg[i] * avg[i];
    mag = Math.sqrt(mag) || 1;
    for (let i = 0; i < len; i++) avg[i] /= mag;

    return avg;
}

ipcMain.handle('clip-embed-images', async (event, files) => {
    if (!clipModel) return { ok: true, value: [] };

    const clipKinds = new Map(await Promise.all(files.map(async (file) => {
        return [file.path, await classifyClipMediaKind(file.path)];
    })));

    // Phase 1: Pre-extract frames for all video/animated files in parallel.
    // FFmpeg is I/O-bound so we can safely run multiple files concurrently.
    // We process files in chunks to avoid spawning too many FFmpeg processes at once.
    const FRAME_EXTRACT_CONCURRENCY = 4;
    const frameMap = new Map(); // filePath -> framePaths[]

    const mediaFiles = files.filter(f => {
        const kind = clipKinds.get(f.path);
        return kind === 'video' || kind === 'animated';
    });

    for (let i = 0; i < mediaFiles.length; i += FRAME_EXTRACT_CONCURRENCY) {
        const chunk = mediaFiles.slice(i, i + FRAME_EXTRACT_CONCURRENCY);
        await Promise.all(chunk.map(async (file) => {
            const kind = clipKinds.get(file.path);
            const n = kind === 'video' ? 4 : 3;
            const frames = await extractMediaKeyframes(file.path, n);
            if (frames) frameMap.set(file.path, frames);
        }));
    }

    // Phase 2: Batched CLIP inference with I/O pipelining.
    // Video/animated files use clipEmbedMultiFrame (already batched internally).
    // Static images are batched in groups of CLIP_BATCH_SIZE with look-ahead preprocessing.
    // Larger batches when native GPU is active: RTX/etc. perform best at ≥16, and
    // the pipelined overlap means a bigger preprocessing batch keeps the GPU fed.
    const CLIP_BATCH_SIZE = clipNativeReady ? 32 : 4;
    const resultMap = new Map(); // filePath -> embedding
    let completed = 0;
    const sender = event.sender;

    // Pre-resolved source paths for static files (populated after thumbnail pre-gen).
    // Avoids per-file blocking fs.existsSync() calls during batch embedding.
    const _sourceCache = new Map();

    // Helper: resolve the best source path for an image.
    // Uses pre-resolved cache for static files; falls back to sync check for
    // video/animated files (processed sequentially, negligible overhead).
    function resolveImageSource(file) {
        if (_sourceCache.has(file.path)) return _sourceCache.get(file.path);
        if (file.thumbPath && fs.existsSync(file.thumbPath)) return file.thumbPath;
        if (imageThumbDir && file.mtime != null) {
            const imgThumb = getImageThumbCachePath(file.path, file.mtime, 512);
            if (fs.existsSync(imgThumb)) return imgThumb;
            if (videoThumbDir) {
                const vidThumb = getThumbCachePath(file.path, file.mtime);
                if (fs.existsSync(vidThumb)) return vidThumb;
            }
        }
        return file.path;
    }

    // Separate files into video/animated and static images
    const videoFiles = [];
    const staticFiles = [];
    for (const file of files) {
        const kind = clipKinds.get(file.path);
        if (kind === 'video' || kind === 'animated') {
            videoFiles.push(file);
        } else {
            staticFiles.push(file);
        }
    }

    let lastProgressTime = 0;
    const PROGRESS_THROTTLE_MS = 100;
    function sendProgress() {
        const now = Date.now();
        if (now - lastProgressTime >= PROGRESS_THROTTLE_MS || completed === files.length) {
            lastProgressTime = now;
            try { sender.send('clip-progress', { current: completed, total: files.length, phase: 'embedding' }); } catch { /* window closed */ }
        }
    }

    // Process video/animated files (multi-frame batching already handled internally)
    for (const file of videoFiles) {
        try {
            const kind = clipKinds.get(file.path);
            const isVideo = kind === 'video';
            let embedding = null;

            const framePaths = frameMap.get(file.path);
            if (framePaths) {
                embedding = await clipEmbedMultiFrame(framePaths);
            }

            // Fallback to single-frame
            if (!embedding) {
                let source = resolveImageSource(file);
                if (kind === 'animated' && source === file.path) {
                    const imgThumb = await generateImageThumbnail(file.path, 512);
                    if (imgThumb) source = imgThumb;
                }
                if (isVideo && source === file.path) {
                    const vidThumb = await generateVideoThumbnail(file.path);
                    if (vidThumb) source = vidThumb;
                }
                if (source !== file.path || kind === 'animated') {
                    embedding = await clipEmbedOneImage(source);
                }
            }

            resultMap.set(file.path, embedding);
        } catch (err) {
            console.error('clip-embed video error:', file.path, err.message);
            resultMap.set(file.path, null);
        }
        completed++;
        sendProgress();
    }

    // Process static images in batches with true I/O pipelining:
    // Preprocess batch N+1 in worker threads while batch N runs ONNX inference on main thread.
    async function preprocessBatchAsync(batch) {
        const sources = batch.map(file => resolveImageSource(file));
        if (clipPreprocessPool) {
            const pixels = await clipPreprocessPool.preprocessBatch(sources);
            return batch.map((file, j) => ({ file, pixels: pixels[j] }));
        }
        // Fallback to synchronous main-thread preprocessing
        return batch.map((file, j) => {
            try { return { file, pixels: clipPreprocessImage(sources[j]) }; }
            catch { return { file, pixels: null }; }
        });
    }

    // When native GPU path is available, use the combined preprocess+embed
    // function: one worker round-trip, no intermediate pixel tensor transferred
    // back to JS. Much faster than the two-stage pipelined path for large batches.
    async function nativeEmbedBatchFromFiles(batch) {
        const sources = batch.map(file => resolveImageSource(file));
        const flat = await clipWorkerPreprocessAndEmbed(sources);
        const n = batch.length;
        const embDim = flat.length / n;
        const out = new Array(n);
        for (let i = 0; i < n; i++) {
            const offset = i * embDim;
            const emb = new Array(embDim);
            for (let j = 0; j < embDim; j++) emb[j] = flat[offset + j];
            out[i] = emb;
        }
        return { sources, embeddings: out };
    }

    // Pre-generate thumbnails for any static images that don't have them yet.
    // Decoding a 4K original JPEG takes ~80ms; a 512px cached PNG takes ~5ms.
    // This is a one-time cost per image and also primes the cache for card browsing.
    // resolveImageSource() only picks a cached thumb if file.mtime != null, so we
    // stat files that lack an mtime to keep the cache keys consistent with browsing.
    if (clipNativeReady && nativeScanner && nativeScanner.generateImageThumbnails && imageThumbDir && staticFiles.length > 0) {
        // Backfill mtime for any file missing it (so thumbnail cache keys match browsing)
        await Promise.all(staticFiles.map(async (f) => {
            if (f.mtime == null) {
                try { const s = await fs.promises.stat(f.path); f.mtime = s.mtimeMs; } catch {}
            }
        }));

        // Build candidate thumb paths and check existence in parallel (async)
        const thumbCandidates = [];
        for (const f of staticFiles) {
            if (f.mtime == null) continue;
            thumbCandidates.push({ file: f, thumbPath: getImageThumbCachePath(f.path, f.mtime, 512) });
        }
        const thumbExistsResults = await Promise.allSettled(
            thumbCandidates.map(c => fs.promises.access(c.thumbPath).then(() => true, () => false))
        );
        const missing = [];
        for (let i = 0; i < thumbCandidates.length; i++) {
            if (!(thumbExistsResults[i].status === 'fulfilled' && thumbExistsResults[i].value)) {
                const c = thumbCandidates[i];
                missing.push({ filePath: c.file.path, thumbPath: c.thumbPath, maxSize: 512 });
            }
        }
        if (missing.length > 0) {
            const t = performance.now();
            try {
                nativeScanner.generateImageThumbnails(missing);
                console.log(`[clip-scan] pre-generated ${missing.length}/${staticFiles.length} thumbnails in ${(performance.now() - t).toFixed(0)}ms`);
            } catch (e) {
                console.warn('[clip-scan] thumbnail pre-gen failed:', e.message);
            }
        }
    }

    // Pre-resolve source paths for all static files in a single parallel batch.
    // This replaces per-file blocking fs.existsSync() calls in resolveImageSource()
    // during batch embedding (up to 3 stat calls × N files → 0 blocking calls).
    if (staticFiles.length > 0) {
        const allCheckPaths = new Set();
        const perFile = new Map(); // filePath -> [candidatePath, ...]
        for (const file of staticFiles) {
            const paths = [];
            if (file.thumbPath) { paths.push(file.thumbPath); allCheckPaths.add(file.thumbPath); }
            if (imageThumbDir && file.mtime != null) {
                const imgThumb = getImageThumbCachePath(file.path, file.mtime, 512);
                paths.push(imgThumb); allCheckPaths.add(imgThumb);
                if (videoThumbDir) {
                    const vidThumb = getThumbCachePath(file.path, file.mtime);
                    paths.push(vidThumb); allCheckPaths.add(vidThumb);
                }
            }
            perFile.set(file.path, paths);
        }
        const pathArr = [...allCheckPaths];
        const accessResults = await Promise.allSettled(
            pathArr.map(p => fs.promises.access(p).then(() => true, () => false))
        );
        const existsSet = new Set();
        for (let i = 0; i < pathArr.length; i++) {
            if (accessResults[i].status === 'fulfilled' && accessResults[i].value) existsSet.add(pathArr[i]);
        }
        for (const file of staticFiles) {
            const candidates = perFile.get(file.path) || [];
            let resolved = file.path;
            for (const p of candidates) {
                if (existsSet.has(p)) { resolved = p; break; }
            }
            _sourceCache.set(file.path, resolved);
        }
    }

    // Accumulated timing for diagnostic output at end of scan
    let _totalPreprocessMs = 0;
    let _totalInferenceMs = 0;
    let _totalWaitMs = 0;
    let _batchCount = 0;

    // Fast path: native combined preprocess+infer. With a worker pool of N,
    // keep N+1 batches inflight so every worker stays fed (one draining, N
    // queued). Drains from the head; pushes fresh batches to the tail.
    let nextBatchIdx = 0;
    let pendingPreprocess = null;
    if (clipNativeReady && staticFiles.length > 0) {
        const totalBatches = Math.ceil(staticFiles.length / CLIP_BATCH_SIZE);
        const pipelineDepth = Math.min(CLIP_WORKER_POOL_SIZE + 1, totalBatches);
        const pending = []; // [{promise, batchFiles}]
        for (let p = 0; p < pipelineDepth; p++) {
            const batchFiles = staticFiles.slice(nextBatchIdx, nextBatchIdx + CLIP_BATCH_SIZE);
            pending.push({ promise: nativeEmbedBatchFromFiles(batchFiles), batchFiles });
            nextBatchIdx += CLIP_BATCH_SIZE;
        }
        while (pending.length > 0) {
            const head = pending.shift();
            // Top up the queue so surviving workers stay busy
            if (nextBatchIdx < staticFiles.length) {
                const next = staticFiles.slice(nextBatchIdx, nextBatchIdx + CLIP_BATCH_SIZE);
                pending.push({ promise: nativeEmbedBatchFromFiles(next), batchFiles: next });
                nextBatchIdx += CLIP_BATCH_SIZE;
            }
            const _t = performance.now();
            let result;
            try {
                result = await head.promise;
            } catch (err) {
                console.error('clip native embed error:', err.message);
                result = { sources: [], embeddings: head.batchFiles.map(() => null) };
            }
            _totalInferenceMs += performance.now() - _t;
            _batchCount++;
            for (let j = 0; j < head.batchFiles.length; j++) {
                resultMap.set(head.batchFiles[j].path, result.embeddings[j] || null);
            }
            completed += head.batchFiles.length;
            sendProgress();
        }
    } else if (staticFiles.length > 0) {
        // JS pipelined fallback: kick off first preprocess batch
        const firstBatch = staticFiles.slice(0, CLIP_BATCH_SIZE);
        pendingPreprocess = preprocessBatchAsync(firstBatch);
        nextBatchIdx = CLIP_BATCH_SIZE;
    }

    while (pendingPreprocess) {
        // Start preprocessing the NEXT batch in parallel with current inference
        let nextPreprocess = null;
        let currentBatch;
        if (nextBatchIdx < staticFiles.length) {
            const nextBatch = staticFiles.slice(nextBatchIdx, nextBatchIdx + CLIP_BATCH_SIZE);
            nextPreprocess = preprocessBatchAsync(nextBatch);
            nextBatchIdx += CLIP_BATCH_SIZE;
        }

        // Await current batch's preprocessing
        const _tWait = performance.now();
        const preprocessed = await pendingPreprocess;
        _totalWaitMs += performance.now() - _tWait;
        currentBatch = preprocessed;

        const validPixels = [];
        const validIndices = [];
        for (let j = 0; j < preprocessed.length; j++) {
            if (preprocessed[j].pixels) {
                validPixels.push(preprocessed[j].pixels);
                validIndices.push(j);
            }
        }

        // Single batched inference for all valid images in this batch
        let embeddings = [];
        if (validPixels.length > 0) {
            const _tInf = performance.now();
            try {
                embeddings = await clipEmbedBatch(validPixels);
            } catch (err) {
                console.error('clip-embed batch error:', err.message);
                embeddings = new Array(validPixels.length).fill(null);
            }
            _totalInferenceMs += performance.now() - _tInf;
            _batchCount++;
        }

        // Map results back to files
        let embIdx = 0;
        for (let j = 0; j < preprocessed.length; j++) {
            const file = preprocessed[j].file;
            if (validIndices.includes(j)) {
                resultMap.set(file.path, embeddings[embIdx++] || null);
            } else {
                resultMap.set(file.path, null);
            }
        }

        completed += preprocessed.length;
        sendProgress();

        pendingPreprocess = nextPreprocess;
    }

    // Build results array in original file order
    const results = files.map(f => ({ path: f.path, embedding: resultMap.get(f.path) || null }));

    // Diagnostic: log what dominated the scan time
    if (_batchCount > 0 && staticFiles.length >= 8) {
        const avgInf = (_totalInferenceMs / _batchCount).toFixed(1);
        if (clipNativeReady) {
            // Native path: _totalInferenceMs includes preprocessing + inference
            const perImg = (_totalInferenceMs / staticFiles.length).toFixed(1);
            console.log(
                `[clip-scan] ${staticFiles.length} static images, ` +
                `${_batchCount} batches of ${CLIP_BATCH_SIZE}, path=native-fused | ` +
                `avg=${avgInf}ms/batch  ${perImg}ms/img  total=${_totalInferenceMs.toFixed(0)}ms`
            );
        } else {
            const avgWait = (_totalWaitMs / _batchCount).toFixed(1);
            console.log(
                `[clip-scan] ${staticFiles.length} static images, ` +
                `${_batchCount} batches of ${CLIP_BATCH_SIZE}, path=js-pipelined | ` +
                `avg inference=${avgInf}ms/batch  avg preprocess-wait=${avgWait}ms/batch  ` +
                `totals: inf=${_totalInferenceMs.toFixed(0)}ms wait=${_totalWaitMs.toFixed(0)}ms`
            );
        }
    }

    // Phase 3: Clean up all temp frames now that inference is complete.
    for (const framePaths of frameMap.values()) {
        for (const fp of framePaths) fs.promises.unlink(fp).catch(() => {});
    }

    return { ok: true, value: results };
});

ipcMain.handle('clip-embed-text', async (event, text) => {
    if (!clipModel) return { ok: false, error: 'CLIP model not loaded' };
    try {
        const { tokenizer, textModel } = clipModel;

        // Tokenize (fast, JS-side). Native addon handles inference below.
        const inputs = tokenizer(text, { padding: true, truncation: true });

        // Native path: pass tokenized tensors to the Rust worker for inference
        if (clipNativeReady && _pickWorker()) {
            try {
                const ids = inputs.input_ids;
                const mask = inputs.attention_mask;
                const dims = ids.dims; // [batch, seq_len]
                const batchSize = dims[0];
                const idsArr = Array.from(ids.data, v => Number(v));
                const maskArr = Array.from(mask.data, v => Number(v));
                const flat = await clipWorkerEmbedTextTokens(idsArr, maskArr, batchSize);
                const embDim = flat.length / batchSize;
                const out = new Array(embDim);
                for (let j = 0; j < embDim; j++) out[j] = flat[j];
                return { ok: true, value: out };
            } catch (e) {
                console.warn('[clip] native text inference failed, falling back to onnxruntime-node:', e.message);
            }
        }

        // Fallback: onnxruntime-node
        const output = await textModel(inputs);
        const raw = output.text_embeds.data;

        let mag = 0;
        for (let i = 0; i < raw.length; i++) mag += raw[i] * raw[i];
        mag = Math.sqrt(mag) || 1;
        const out = new Array(raw.length);
        for (let i = 0; i < raw.length; i++) out[i] = raw[i] / mag;

        return { ok: true, value: out };
    } catch (err) {
        console.error('clip-embed-text error:', err);
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('clip-status', async () => {
    return { ok: true, value: { loaded: !!clipModel, native: clipNativeReady } };
});

ipcMain.handle('clip-terminate', async () => {
    clipModel = null;
    if (clipPreprocessPool) { clipPreprocessPool.terminate(); clipPreprocessPool = null; }
    _clipInitParams = null; // prevent respawn on exit
    for (let i = 0; i < clipInferenceWorkers.length; i++) {
        const slot = clipInferenceWorkers[i];
        if (!slot) continue;
        try { slot.worker.postMessage({ type: 'shutdown' }); } catch {}
        try { slot.worker.terminate(); } catch {}
        clipInferenceWorkers[i] = null;
    }
    clipNativeReady = false;
    return { ok: true, value: null };
});

// Plugin system IPC handlers
wrapIpc('get-plugin-manifests', () => pluginRegistry.getManifests());

ipcMain.handle('execute-plugin-action', async (event, pluginId, actionId, filePath, metadata) => {
    try {
        // Auto-resolve metadata when the caller passes null and the action declares appliesTo.hasMetadata
        let resolvedMetadata = metadata;
        if (!resolvedMetadata) {
            const manifest = pluginRegistry._manifests.get(pluginId);
            const actionDef = (manifest?.capabilities?.contextMenuItems || []).find(i => i.id === actionId);
            if (actionDef?.appliesTo?.hasMetadata) {
                const ext = path.extname(filePath).toLowerCase();
                resolvedMetadata = await pluginRegistry.extractMetadata(filePath, ext);
            }
        }
        const result = await pluginRegistry.executeAction(pluginId, actionId, filePath, resolvedMetadata);
        return { ok: true, value: result };
    } catch (err) {
        console.warn(`[Plugin action] ${pluginId}/${actionId} failed:`, err.message);
        return { ok: false, error:err.message };
    }
});

wrapIpc('get-plugin-info-sections', () => pluginRegistry.getAllInfoSections());

wrapIpc('get-plugin-tooltip-sections', () => pluginRegistry.getAllTooltipSections());

ipcMain.handle('render-plugin-tooltip-section', async (event, pluginId, sectionId, filePath, pluginMetadata) => {
    try {
        // Auto-resolve metadata when caller passes null and section declares appliesTo.hasMetadata
        let resolvedMetadata = pluginMetadata;
        if (!resolvedMetadata) {
            const manifest = pluginRegistry._manifests.get(pluginId);
            const sectionDef = (manifest?.capabilities?.tooltipSections || []).find(s => s.id === sectionId);
            if (sectionDef?.appliesTo?.hasMetadata) {
                const ext = path.extname(filePath).toLowerCase();
                resolvedMetadata = await pluginRegistry.extractMetadata(filePath, ext);
            }
        }
        const result = await pluginRegistry.renderTooltipSection(pluginId, sectionId, filePath, resolvedMetadata);
        return { ok: true, value: result };
    } catch (err) {
        console.warn(`[Plugin tooltip section] ${pluginId}\\${sectionId} failed:`, err.message);
        return { ok: false, error: err.message };
    }
});

wrapIpc('get-lightbox-renderers', () => pluginRegistry.getAllLightboxRenderers());

wrapIpc('get-plugin-file-type-map', () => {
    const map = {};
    for (const manifest of pluginRegistry.getManifests()) {
        const ft = manifest.capabilities?.fileTypes;
        if (!ft) continue;
        const entries = Array.isArray(ft) ? ft : [ft];
        for (const entry of entries) {
            for (const ext of (entry.extensions || [])) {
                map[ext.toLowerCase()] = entry.category || 'image';
            }
        }
    }
    return map;
});

ipcMain.handle('render-plugin-info-section', async (event, pluginId, sectionId, filePath, pluginMetadata) => {
    try {
        const result = await pluginRegistry.renderInfoSection(pluginId, sectionId, filePath, pluginMetadata);
        return { ok: true, value: result };
    } catch (err) {
        console.warn(`[Plugin info section] ${pluginId}/${sectionId} failed:`, err.message);
        return { ok: false, error:err.message };
    }
});

wrapIpc('get-plugin-batch-operations', () => pluginRegistry.getAllBatchOperations());

ipcMain.handle('execute-plugin-batch-operation', async (event, pluginId, operationId, filePaths, options) => {
    try {
        const result = await pluginRegistry.executeBatchOperation(pluginId, operationId, filePaths, options || {});
        return { ok: true, value: result };
    } catch (err) {
        console.warn(`[Plugin batch op] ${pluginId}/${operationId} failed:`, err.message);
        return { ok: false, error:err.message };
    }
});

wrapIpc('get-plugin-settings-panels', () => pluginRegistry.getAllSettingsPanels());

ipcMain.handle('execute-plugin-settings-action', async (event, pluginId, action, data) => {
    try {
        const result = await pluginRegistry.executeSettingsAction(pluginId, action, data);
        return { ok: true, value: result };
    } catch (err) {
        console.warn(`[Plugin settings] ${pluginId}/${action} failed:`, err.message);
        return { ok: false, error:err.message };
    }
});

ipcMain.handle('plugin-generate-thumbnail', async (event, filePath, ext) => {
    try {
        const result = await pluginRegistry.generateThumbnail(filePath, ext);
        return { ok: true, value: result };
    } catch (err) {
        console.warn(`[Plugin thumbnail] ${filePath} failed:`, err.message);
        return { ok: false, error:err.message };
    }
});

wrapIpc('get-plugin-states', () => pluginRegistry.getPluginStates());

ipcMain.handle('set-plugin-enabled', (event, pluginId, enabled) => {
    try {
        pluginRegistry.setPluginEnabled(pluginId, enabled);
        return { ok: true, value: null };
    } catch (err) {
        console.warn(`[Plugin toggle] ${pluginId} failed:`, err.message);
        return { ok: false, error:err.message };
    }
});

ipcMain.handle('install-plugin-from-folder', async () => {
    try {
        const result = await dialog.showOpenDialog({
            title: 'Select Plugin Folder',
            properties: ['openDirectory'],
        });
        if (result.canceled || !result.filePaths[0]) {
            return { ok: true, value: { canceled: true } };
        }
        const sourceDir = result.filePaths[0];

        const validation = PluginRegistry.validateManifest(sourceDir);
        if (!validation.valid) {
            return { ok: false, error: validation.error };
        }
        const { manifest } = validation;

        if (pluginRegistry._manifests.has(manifest.id)) {
            const existing = pluginRegistry.getManifests().find(m => m.id === manifest.id);
            return { ok: true, value: {
                duplicate: true,
                pluginId: manifest.id,
                existingVersion: existing?.version || '?',
                newVersion: manifest.version || '?',
                existingName: existing?.name || manifest.id,
                sourceDir,
            }};
        }

        const userPluginsDir = path.join(app.getPath('userData'), 'plugins');
        await fs.promises.mkdir(userPluginsDir, { recursive: true });
        const destDir = path.join(userPluginsDir, manifest.id);
        if (fs.existsSync(destDir)) {
            return { ok: false, error: `Plugin directory already exists for "${manifest.id}"` };
        }
        await fs.promises.cp(sourceDir, destDir, { recursive: true });

        try {
            pluginRegistry.registerFromDirectory(destDir);
        } catch (regErr) {
            await fs.promises.rm(destDir, { recursive: true, force: true }).catch(() => {});
            return { ok: false, error: regErr.message };
        }

        return { ok: true, value: { pluginId: manifest.id, name: manifest.name || manifest.id } };
    } catch (err) {
        console.warn('[Plugin install] failed:', err.message);
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('update-plugin-from-folder', async (event, { pluginId, sourceDir }) => {
    try {
        // Re-validate source
        const validation = PluginRegistry.validateManifest(sourceDir);
        if (!validation.valid) {
            return { ok: false, error: validation.error };
        }
        if (validation.manifest.id !== pluginId) {
            return { ok: false, error: `Manifest ID "${validation.manifest.id}" does not match expected "${pluginId}"` };
        }
        if (pluginRegistry.isBuiltin(pluginId)) {
            return { ok: false, error: 'Cannot update a built-in plugin' };
        }

        // Snapshot current state
        const wasEnabled = !pluginRegistry._disabledPlugins.has(pluginId);
        const savedOrder = pluginRegistry.getPluginOrder();

        // Unregister old
        await pluginRegistry.unregisterPlugin(pluginId);

        // Replace files
        const userPluginsDir = path.join(app.getPath('userData'), 'plugins');
        const destDir = path.join(userPluginsDir, pluginId);
        await fs.promises.rm(destDir, { recursive: true, force: true });
        await fs.promises.cp(sourceDir, destDir, { recursive: true });

        // Register new
        pluginRegistry.registerFromDirectory(destDir);

        // Restore state and order
        pluginRegistry.setPluginEnabled(pluginId, wasEnabled);
        pluginRegistry.setPluginOrder(savedOrder);

        // Clear plugin cache
        const pluginCachePath = path.join(pluginCacheDir, pluginId);
        if (fs.existsSync(pluginCachePath)) {
            await fs.promises.rm(pluginCachePath, { recursive: true, force: true }).catch(() => {});
        }

        return { ok: true, value: { pluginId, name: validation.manifest.name || pluginId } };
    } catch (err) {
        console.warn(`[Plugin update] ${pluginId} failed:`, err.message);
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('remove-plugin', async (event, pluginId) => {
    try {
        if (pluginRegistry.isBuiltin(pluginId)) {
            return { ok: false, error: 'Cannot remove a built-in plugin' };
        }
        const pluginDir = pluginRegistry.getPluginDir(pluginId);
        if (!pluginDir) {
            return { ok: false, error: `Plugin "${pluginId}" not found` };
        }

        await pluginRegistry.unregisterPlugin(pluginId);

        await fs.promises.rm(pluginDir, { recursive: true, force: true });

        const pluginCachePath = path.join(pluginCacheDir, pluginId);
        if (fs.existsSync(pluginCachePath)) {
            await fs.promises.rm(pluginCachePath, { recursive: true, force: true });
        }

        return { ok: true, value: { pluginId } };
    } catch (err) {
        console.warn(`[Plugin remove] ${pluginId} failed:`, err.message);
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('reload-plugins', async () => {
    try {
        const pluginDirs = [
            { dir: path.join(__dirname, 'plugins', 'builtin'), builtin: true },
            { dir: path.join(app.getPath('userData'), 'plugins') },
        ];
        const count = await pluginRegistry.reload(pluginDirs);
        return { ok: true, value: { count } };
    } catch (err) {
        console.warn('[Plugin reload] failed:', err.message);
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('scaffold-plugin', async (event, { id, name }) => {
    try {
        if (!id || typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) {
            return { ok: false, error: 'Plugin ID must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens' };
        }
        if (id.length > 64) {
            return { ok: false, error: 'Plugin ID must be 64 characters or fewer' };
        }
        if (pluginRegistry._manifests.has(id)) {
            return { ok: false, error: `Plugin "${id}" already exists` };
        }

        const userPluginsDir = path.join(app.getPath('userData'), 'plugins');
        const destDir = path.join(userPluginsDir, id);
        if (fs.existsSync(destDir)) {
            return { ok: false, error: `A folder with ID "${id}" already exists in the plugins directory` };
        }

        await fs.promises.mkdir(destDir, { recursive: true });

        const pluginName = name || id;

        // Write plugin.json
        const manifest = {
            id,
            name: pluginName,
            version: '1.0.0',
            description: 'A custom plugin.',
            main: 'index.js',
            capabilities: {
                metadataExtractors: [
                    {
                        id: `${id}-metadata`,
                        name: `${pluginName} Metadata`,
                        extensions: ['.png', '.jpg', '.jpeg'],
                        method: 'extractMetadata',
                    },
                ],
            },
        };
        await fs.promises.writeFile(
            path.join(destDir, 'plugin.json'),
            JSON.stringify(manifest, null, 4)
        );

        // Write index.js
        const indexJs = `'use strict';

/**
 * Plugin: ${pluginName}
 *
 * Available API surface (passed to activate):
 *   api.fs.readFile(path, opts)    - Read a file (async)
 *   api.fs.stat(path)              - Stat a file (async)
 *   api.fs.readdir(dir)            - List directory contents (async)
 *   api.fs.writeFile(sub, data)    - Write to plugin cache dir (async, scoped)
 *   api.path                       - Node.js path module
 *   api.zlib                       - Node.js zlib module
 *   api.readImageHeader(path, n)   - Read first N bytes of a file (default 512KB)
 *   api.getCachePath(sub?)         - Get/create plugin cache directory
 *   api.storage.get(key, default)  - Read from persistent key-value storage
 *   api.storage.set(key, value)    - Write to persistent key-value storage
 *   api.storage.delete(key)        - Delete from persistent storage
 *   api.storage.getAll()           - Get all stored key-value pairs
 *
 * Capability types you can add to plugin.json:
 *   metadataExtractors   - Extract metadata from files during scanning
 *   infoSections         - Render custom panels in the file inspector
 *   contextMenuItems     - Add items to the right-click context menu
 *   thumbnailGenerators  - Generate custom thumbnails for file types
 *   batchOperations      - Operate on multiple selected files at once
 *   settingsPanel        - Add a settings tab for your plugin
 *   fileTypes            - Register new file extensions as image or video
 */

let _api;

function activate(api) {
    _api = api;
    return {
        extractMetadata,
    };
}

/**
 * Extract metadata from a file.
 * Return an object with your metadata, or null to skip this file.
 *
 * @param {string} filePath - Absolute path to the file
 * @returns {object|null} Metadata object or null
 */
async function extractMetadata(filePath) {
    // TODO: Implement your metadata extraction logic here.
    // Example: read file header, parse custom data, etc.
    //
    // const header = await _api.readImageHeader(filePath, 1024);
    // return { myField: 'value' };
    return null;
}

module.exports = { activate };
`;
        await fs.promises.writeFile(path.join(destDir, 'index.js'), indexJs);

        // Register the new plugin
        pluginRegistry.registerFromDirectory(destDir);

        // Open the folder in file explorer
        shell.openPath(destDir);

        return { ok: true, value: { pluginId: id, name: pluginName, dir: destDir } };
    } catch (err) {
        console.warn('[Plugin scaffold] failed:', err.message);
        return { ok: false, error: err.message };
    }
});

ipcMain.handle('open-plugins-folder', async () => {
    try {
        const dir = path.join(app.getPath('userData'), 'plugins');
        await fs.promises.mkdir(dir, { recursive: true });
        const errStr = await shell.openPath(dir);
        if (errStr) return { ok: false, error: errStr };
        return { ok: true, value: null };
    } catch (err) {
        return { ok: false, error: err.message };
    }
});

wrapIpc('get-plugin-order', () => pluginRegistry.getPluginOrder());

ipcMain.handle('set-plugin-order', (event, newOrder) => {
    try {
        pluginRegistry.setPluginOrder(newOrder);
        return { ok: true, value: null };
    } catch (err) {
        console.warn('[Plugin order] failed:', err.message);
        return { ok: false, error: err.message };
    }
});

// Cleanup watchers on app quit
// Undo file operation
ipcMain.handle('undo-file-operation', async () => {
    if (undoStack.length === 0) {
        return { ok: false, error:'Nothing to undo' };
    }
    const entry = undoStack.pop();
    const completedOps = [];
    try {
        for (let i = entry.operations.length - 1; i >= 0; i--) {
            const op = entry.operations[i];
            switch (op.type) {
                case 'rename':
                    await fs.promises.rename(op.newPath, op.oldPath);
                    break;
                case 'delete':
                    await restoreFromStaging(op.stagingPath, op.originalPath);
                    break;
                case 'move': {
                    const parentDir = path.dirname(op.sourcePath);
                    await fs.promises.mkdir(parentDir, { recursive: true });
                    await safeMove(op.destPath, op.sourcePath);
                    break;
                }
            }
            completedOps.push(op);
        }
        redoStack.push(entry);
        return { ok: true, value: { description: entry.description, canUndo: undoStack.length > 0, canRedo: true } };
    } catch (error) {
        console.error('Undo failed:', error);
        // Roll back already-completed operations to restore consistent state
        for (const op of completedOps) {
            try {
                switch (op.type) {
                    case 'rename':
                        await fs.promises.rename(op.oldPath, op.newPath);
                        break;
                    case 'delete': {
                        const newStagingPath = await moveToStaging(op.originalPath, undoTrashDir);
                        op.stagingPath = newStagingPath;
                        break;
                    }
                    case 'move':
                        await safeMove(op.sourcePath, op.destPath);
                        break;
                }
            } catch (rollbackErr) {
                console.error('Undo rollback failed for op:', op.type, rollbackErr);
            }
        }
        // Push a deep copy so future undo/redo won't share mutated operation refs
        undoStack.push({
            ...entry,
            operations: entry.operations.map(op => ({ ...op }))
        });
        return { ok: false, error: `${entry.description}: ${error.message}` };
    }
});

// Redo file operation
ipcMain.handle('redo-file-operation', async () => {
    if (redoStack.length === 0) {
        return { ok: false, error:'Nothing to redo' };
    }
    const entry = redoStack.pop();
    const completedOps = [];
    try {
        for (const op of entry.operations) {
            switch (op.type) {
                case 'rename':
                    await fs.promises.rename(op.oldPath, op.newPath);
                    break;
                case 'delete':
                    op.stagingPath = await moveToStaging(op.originalPath, undoTrashDir);
                    break;
                case 'move': {
                    const destDir = path.dirname(op.destPath);
                    await fs.promises.mkdir(destDir, { recursive: true });
                    await safeMove(op.sourcePath, op.destPath);
                    break;
                }
            }
            completedOps.push(op);
        }
        undoStack.push(entry);
        return { ok: true, value: { description: entry.description, canUndo: true, canRedo: redoStack.length > 0 } };
    } catch (error) {
        console.error('Redo failed:', error);
        // Roll back already-completed operations to restore consistent state
        for (let i = completedOps.length - 1; i >= 0; i--) {
            const op = completedOps[i];
            try {
                switch (op.type) {
                    case 'rename':
                        await fs.promises.rename(op.newPath, op.oldPath);
                        break;
                    case 'delete':
                        await restoreFromStaging(op.stagingPath, op.originalPath);
                        break;
                    case 'move':
                        await safeMove(op.destPath, op.sourcePath);
                        break;
                }
            } catch (rollbackErr) {
                console.error('Redo rollback failed for op:', op.type, rollbackErr);
            }
        }
        redoStack.push(entry);
        return { ok: false, error: `${entry.description}: ${error.message}` };
    }
});

app.on('before-quit', async () => {
    // Clean up undo staging folder
    try {
        if (fs.existsSync(undoTrashDir)) {
            fs.rmSync(undoTrashDir, { recursive: true, force: true });
        }
    } catch (err) {
        console.error('Error cleaning undo-trash:', err);
    }
    await pluginRegistry.teardown();
    if (thumbnailPool) {
        thumbnailPool.terminate();
        thumbnailPool = null;
    }
    if (dimensionPool) {
        dimensionPool.terminate();
        dimensionPool = null;
    }
    if (hashPool) {
        hashPool.terminate();
        hashPool = null;
    }
    clipModel = null;
    try { await appDb.close(); } catch {}
    for (const [folderPath, watcher] of watchedFolders) {
        try {
            await watcher.close();
        } catch (error) {
            console.error(`Error closing watcher for ${folderPath}:`, error);
        }
    }
    watchedFolders.clear();
});

// ── SQLite Database IPC Handlers ─────────────────────────────────────────────

// Migration
wrapIpc('db-check-migration-status', () => appDb.checkMigrationStatus());
wrapIpc('db-run-migration', (data) => appDb.runMigration(data));
wrapIpc('db-get-meta', (key) => appDb.getMeta(key));
wrapIpc('db-set-meta', (key, value) => appDb.setMeta(key, value));

// IPC result caches for frequently-fetched full-table queries
const _ipcCache = { ratings: null, pinned: null, tags: null, collections: null };

// Ratings
ipcMain.handle('db-get-all-ratings', async () => {
    try {
        if (!_ipcCache.ratings) _ipcCache.ratings = { ok: true, value:await appDb.getAllRatings() };
        return _ipcCache.ratings;
    }
    catch (e) { return { ok: false, error:e.message }; }
});
wrapIpc('db-set-rating', async (filePath, rating) => {
    await appDb.setRating(filePath, rating); _ipcCache.ratings = null;
});

// Pins
ipcMain.handle('db-get-all-pinned', async () => {
    try {
        if (!_ipcCache.pinned) _ipcCache.pinned = { ok: true, value:await appDb.getAllPinned() };
        return _ipcCache.pinned;
    }
    catch (e) { return { ok: false, error:e.message }; }
});
wrapIpc('db-set-pinned', async (filePath, pinned) => {
    await appDb.setPinned(filePath, pinned); _ipcCache.pinned = null;
});

// Favorites
wrapIpc('db-get-favorites', () => appDb.getFavorites());
wrapIpc('db-save-favorites', (favObj) => appDb.saveFavorites(favObj));

// Recent files
wrapIpc('db-get-recent-files', (limit) => appDb.getRecentFiles(limit || 50));
wrapIpc('db-add-recent-file', (entry, limit) => appDb.addRecentFile(entry, limit || 50));
wrapIpc('db-clear-recent-files', () => appDb.clearRecentFiles());

// Batched init data — single IPC round-trip for ratings + pins + favorites + recent files
ipcMain.handle('db-get-init-data', async (event, recentLimit) => {
    try {
        const [ratings, pinned, favorites, recent] = await Promise.all([
            _ipcCache.ratings ? _ipcCache.ratings.value : appDb.getAllRatings(),
            _ipcCache.pinned ? _ipcCache.pinned.value : appDb.getAllPinned(),
            appDb.getFavorites(),
            appDb.getRecentFiles(recentLimit || 50),
        ]);
        // Populate caches so individual calls benefit too
        if (!_ipcCache.ratings) _ipcCache.ratings = { ok: true, value: ratings };
        if (!_ipcCache.pinned) _ipcCache.pinned = { ok: true, value: pinned };
        return { ok: true, value: { ratings, pinned, favorites, recent } };
    } catch (e) {
        return { ok: false, error: e.message };
    }
});

// Collections
ipcMain.handle('db-get-all-collections', async () => {
    try {
        if (!_ipcCache.collections) _ipcCache.collections = { ok: true, value:await appDb.getAllCollections() };
        return _ipcCache.collections;
    }
    catch (e) { return { ok: false, error:e.message }; }
});
wrapIpc('db-get-collection', (id) => appDb.getCollection(id));
wrapIpc('db-save-collection', async (col) => { _ipcCache.collections = null; return appDb.saveCollection(col); });
wrapIpc('db-delete-collection', async (id) => { await appDb.deleteCollection(id); _ipcCache.collections = null; });
wrapIpc('db-get-collection-files', (collectionId) => appDb.getCollectionFiles(collectionId));
wrapIpc('db-add-files-to-collection', (collectionId, filePaths) => appDb.addFilesToCollection(collectionId, filePaths));
wrapIpc('db-remove-file-from-collection', (collectionId, filePath) => appDb.removeFileFromCollection(collectionId, filePath));
wrapIpc('db-remove-files-from-collection', (collectionId, filePaths) => appDb.removeFilesFromCollection(collectionId, filePaths));

// Tags
wrapIpc('db-create-tag', async (name, description, color) => { _ipcCache.tags = null; return appDb.createTag(name, description, color); });
wrapIpc('db-update-tag', async (id, updates) => { _ipcCache.tags = null; return appDb.updateTag(id, updates); });
wrapIpc('db-delete-tag', async (id) => { await appDb.deleteTag(id); _ipcCache.tags = null; });
ipcMain.handle('db-get-all-tags', async () => {
    try {
        if (!_ipcCache.tags) _ipcCache.tags = { ok: true, value:await appDb.getAllTags() };
        return _ipcCache.tags;
    }
    catch (e) { return { ok: false, error:e.message }; }
});
wrapIpc('db-get-tag', (id) => appDb.getTag(id));
wrapIpc('db-search-tags', (query) => appDb.searchTags(query));
wrapIpc('db-get-top-tags', (limit) => appDb.getTopTags(limit));

// File-tag associations
wrapIpc('db-add-tag-to-file', (filePath, tagId) => appDb.addTagToFile(filePath, tagId));
wrapIpc('db-remove-tag-from-file', (filePath, tagId) => appDb.removeTagFromFile(filePath, tagId));
wrapIpc('db-get-tags-for-file', (filePath) => appDb.getTagsForFile(filePath));
wrapIpc('db-get-tags-for-files', (filePaths) => appDb.getTagsForFiles(filePaths));
wrapIpc('db-get-files-for-tag', (tagId) => appDb.getFilesForTag(tagId));
wrapIpc('db-bulk-tag-files', (filePaths, tagId) => appDb.bulkTagFiles(filePaths, tagId));
wrapIpc('db-bulk-remove-tag-from-files', (filePaths, tagId) => appDb.bulkRemoveTagFromFiles(filePaths, tagId));
wrapIpc('db-query-files-by-tags', (expression) => appDb.queryFilesByTags(expression));
ipcMain.handle('db-save-search', async (event, entry) => {
    try { return { ok: true, value:String((await appDb.saveSearch(entry)) || '') }; }
    catch (e) { return { ok: false, error:String(e && e.message || e) }; }
});
ipcMain.handle('db-get-saved-searches', async () => {
    try {
        const raw = await appDb.getAllSavedSearches();
        const arr = Array.isArray(raw) ? raw : [];
        const data = arr.map(r => ({
            id: String(r && r.id || ''),
            name: String(r && r.name || ''),
            query: String(r && r.query || ''),
            filters: r && r.filters ? JSON.parse(JSON.stringify(r.filters)) : null,
            folderPath: r && r.folderPath ? String(r.folderPath) : null,
            createdAt: r && r.createdAt != null ? Number(r.createdAt) : 0,
            usedAt: r && r.usedAt != null ? Number(r.usedAt) : null
        }));
        return { ok: true, value: data };
    } catch (e) {
        console.error('[main] db-get-saved-searches failed:', e);
        return { ok: false, error: String(e && e.message || e) };
    }
});
wrapIpc('db-delete-saved-search', (id) => appDb.deleteSavedSearch(id));
wrapIpc('db-rename-saved-search', (id, name) => appDb.renameSavedSearch(id, name));
wrapIpc('db-touch-saved-search', (id) => appDb.touchSavedSearch(id));
wrapIpc('db-suggest-tags', (filePath) => appDb.suggestTagsForFile(filePath));
wrapIpc('db-export-tags', () => appDb.exportTags());
wrapIpc('db-import-tags', (data) => appDb.importTags(data));
