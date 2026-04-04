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
const AppDatabase = require('./database');
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

// Detect ffprobe/ffmpeg availability (cached to disk to avoid execFileSync on every launch)
let ffprobePath = null;
let ffmpegPath = null;
(function detectFfTools() {
    const { execFileSync } = require('child_process');
    const cacheDir = app.isPackaged ? app.getPath('userData') : path.join(__dirname, 'electron-cache');
    const cachePath = path.join(cacheDir, 'fftools-cache.json');

    // Try loading from cache
    try {
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        // Validate cached paths still work (quick check, no exec needed - just verify file exists or is on PATH)
        if (cached.ffprobe) {
            try { execFileSync(cached.ffprobe, ['-version'], { stdio: 'ignore', timeout: 1000 }); ffprobePath = cached.ffprobe; } catch {}
        }
        if (cached.ffmpeg) {
            try { execFileSync(cached.ffmpeg, ['-version'], { stdio: 'ignore', timeout: 1000 }); ffmpegPath = cached.ffmpeg; } catch {}
        }
        if (ffprobePath && ffmpegPath) {
            console.log('ffprobe found (cached):', ffprobePath);
            console.log('ffmpeg found (cached):', ffmpegPath);
            return;
        }
    } catch { /* no cache or invalid */ }

    // Full detection
    const probeCandidates = process.platform === 'win32' ? ['ffprobe', 'ffprobe.exe'] : ['ffprobe'];
    for (const candidate of probeCandidates) {
        try {
            execFileSync(candidate, ['-version'], { stdio: 'ignore', timeout: 3000 });
            ffprobePath = candidate;
            console.log('ffprobe found:', candidate);
            break;
        } catch { /* not found, try next */ }
    }
    if (!ffprobePath) console.log('ffprobe not found — video dimensions will be detected on load');

    const mpegCandidates = process.platform === 'win32' ? ['ffmpeg', 'ffmpeg.exe'] : ['ffmpeg'];
    for (const candidate of mpegCandidates) {
        try {
            execFileSync(candidate, ['-version'], { stdio: 'ignore', timeout: 3000 });
            ffmpegPath = candidate;
            console.log('ffmpeg found:', candidate);
            break;
        } catch { /* not found, try next */ }
    }
    if (!ffmpegPath) console.log('ffmpeg not found — video thumbnails will not be generated');

    // Cache results for next launch
    try {
        if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(cachePath, JSON.stringify({ ffprobe: ffprobePath, ffmpeg: ffmpegPath }));
    } catch { /* cache write failed, not critical */ }
})();
markStartup('fftools-detected');

// Worker pool for parallel dimension scanning
let dimensionPool = new DimensionWorkerPool(ffprobePath);

// Worker pool for thumbnail generation (off main process)
let thumbnailPool = new ThumbnailWorkerPool({ ffmpegPath, ffprobePath });
let hashPool = new HashWorkerPool();
markStartup('worker-pools-created');
// CLIP model state — loaded directly in main process (no worker threads)
let clipModel = null; // { visionModel, textModel, processor, tokenizer, RawImage, ort }
let clipPreprocessPool = null;

// Native-ONNX CLIP inference worker (wraps the native-scanner NAPI addon in a
// Node worker_thread). Rust NAPI addons are ABI-safe across worker threads,
// unlike onnxruntime-node, so inference happens off the main process.
let clipInferenceWorker = null;
let clipNativeReady = false;
let _clipInferenceReqId = 0;
const _clipInferenceReqs = new Map(); // id -> {resolve, reject}

function ensureClipInferenceWorker() {
    if (clipInferenceWorker) return clipInferenceWorker;
    try {
        const { Worker } = require('worker_threads');
        clipInferenceWorker = new Worker(path.join(__dirname, 'clip-inference-worker.js'));
        clipInferenceWorker.on('message', (msg) => {
            if (!msg || !msg.type) return;
            if (msg.type === 'embed-batch-result') {
                const entry = _clipInferenceReqs.get(msg.id);
                if (entry) { _clipInferenceReqs.delete(msg.id); entry.resolve(msg.embeddings); }
            } else if (msg.type === 'embed-error') {
                const entry = _clipInferenceReqs.get(msg.id);
                if (entry) { _clipInferenceReqs.delete(msg.id); entry.reject(new Error(msg.error)); }
            }
        });
        clipInferenceWorker.on('error', (err) => { console.error('[clip-worker] error:', err); });
        clipInferenceWorker.on('exit', (code) => {
            if (code !== 0) console.warn('[clip-worker] exited code=' + code);
            clipInferenceWorker = null;
            clipNativeReady = false;
            for (const [, e] of _clipInferenceReqs) e.reject(new Error('clip worker exited'));
            _clipInferenceReqs.clear();
        });
    } catch (err) {
        console.warn('[clip-worker] failed to spawn:', err.message);
        clipInferenceWorker = null;
    }
    return clipInferenceWorker;
}

function clipWorkerInit(visionPath, textPath, threads) {
    const worker = ensureClipInferenceWorker();
    if (!worker) return Promise.resolve(false);
    return new Promise((resolve) => {
        const onMsg = (msg) => {
            if (msg && msg.type === 'init-result') {
                worker.off('message', onMsg);
                clipNativeReady = !!msg.ok;
                if (!msg.ok) console.warn('[clip-worker] init failed:', msg.error);
                resolve(!!msg.ok);
            }
        };
        worker.on('message', onMsg);
        worker.postMessage({ type: 'init', visionPath, textPath, threads: threads || 4 });
    });
}

function clipWorkerEmbedBatch(batchData, n) {
    if (!clipInferenceWorker || !clipNativeReady) return Promise.reject(new Error('clip worker not ready'));
    const id = ++_clipInferenceReqId;
    return new Promise((resolve, reject) => {
        _clipInferenceReqs.set(id, { resolve, reject });
        clipInferenceWorker.postMessage(
            { type: 'embed-batch', id, batchData, n },
            [batchData.buffer]
        );
    });
}

function clipWorkerEmbedTextTokens(inputIds, attentionMask, batchSize) {
    if (!clipInferenceWorker || !clipNativeReady) return Promise.reject(new Error('clip worker not ready'));
    const id = ++_clipInferenceReqId;
    return new Promise((resolve, reject) => {
        _clipInferenceReqs.set(id, { resolve, reject });
        clipInferenceWorker.postMessage({ type: 'embed-text-tokens', id, inputIds, attentionMask, batchSize });
    });
}

// Thumbnail cache directories (initialized after userDataPath is set)
const crypto = require('crypto');
let videoThumbDir = null;
let imageThumbDir = null;
const pendingVideoThumbnailJobs = new Map();
const pendingImageThumbnailJobs = new Map();

function createThumbCacheKey(filePath, mtimeMs, extra = '') {
    return crypto.createHash('md5').update(`${filePath}|${mtimeMs || 0}|${extra}`).digest('hex');
}

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

function pathToFileUrl(filePath) {
    return process.platform === 'win32'
        ? `file:///${filePath.replace(/\\/g, '/')}`
        : `file://${filePath}`;
}

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
    } catch {
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
    } catch {
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

// Initialize SQLite database
const appDb = new AppDatabase(path.join(userDataPath, 'thumbnail-animator.db'));
markStartup('db-initialized');

// Initialize video thumbnail cache directory now that userDataPath is set
videoThumbDir = path.join(userDataPath, 'video-thumbnails');
imageThumbDir = path.join(userDataPath, 'image-thumbnails');
let folderPreviewDir = path.join(userDataPath, 'folder-previews');

// Cache size limits (bytes). 0 = unlimited. User-configurable via settings.
let VIDEO_CACHE_MAX_BYTES = 500 * 1024 * 1024;  // default 500 MB
let IMAGE_CACHE_MAX_BYTES = 1000 * 1024 * 1024;  // default 1 GB

// Load saved cache limits from config file
const cacheLimitsFile = path.join(userDataPath, 'cache-limits.json');
try {
    const saved = JSON.parse(fs.readFileSync(cacheLimitsFile, 'utf8'));
    if (typeof saved.videoCacheMB === 'number') VIDEO_CACHE_MAX_BYTES = saved.videoCacheMB * 1024 * 1024;
    if (typeof saved.imageCacheMB === 'number') IMAGE_CACHE_MAX_BYTES = saved.imageCacheMB * 1024 * 1024;
} catch { /* no saved limits, use defaults */ }

// Run cache eviction on startup (non-blocking)
if (nativeScanner && nativeScanner.planCacheEviction) {
    setTimeout(() => {
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
// Clean any leftovers from previous session (crash recovery), then recreate
if (fs.existsSync(undoTrashDir)) {
    fs.rmSync(undoTrashDir, { recursive: true, force: true });
}
fs.mkdirSync(undoTrashDir, { recursive: true });

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

async function safeMove(srcPath, destPath) {
    try {
        await fs.promises.rename(srcPath, destPath);
    } catch (err) {
        if (err.code === 'EXDEV') {
            const stat = await fs.promises.stat(srcPath);
            if (stat.isDirectory()) {
                await fs.promises.cp(srcPath, destPath, { recursive: true });
            } else {
                await fs.promises.copyFile(srcPath, destPath);
            }
            await fs.promises.rm(srcPath, { recursive: true, force: true });
        } else {
            throw err;
        }
    }
}

async function moveToStaging(filePath) {
    const basename = path.basename(filePath);
    const stagingPath = path.join(undoTrashDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${basename}`);
    await safeMove(filePath, stagingPath);
    return stagingPath;
}

async function restoreFromStaging(stagingPath, originalPath) {
    const parentDir = path.dirname(originalPath);
    if (!fs.existsSync(parentDir)) {
        await fs.promises.mkdir(parentDir, { recursive: true });
    }
    if (fs.existsSync(originalPath)) {
        throw new Error(`"${path.basename(originalPath)}" already exists at the original location`);
    }
    await safeMove(stagingPath, originalPath);
}

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

function loadWindowState() {
    try {
        if (fs.existsSync(windowStateFile)) {
            const data = fs.readFileSync(windowStateFile, 'utf8');
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
        } else {
            console.log('No saved window state file found');
        }
    } catch (error) {
        console.error('Error loading window state:', error);
    }
    
    // Return default values if loading fails
    console.log('Using default window state');
    return {
        width: 1200,
        height: 800,
        x: undefined,
        y: undefined,
        isMaximized: false
    };
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

function createWindow() {
    const windowState = loadWindowState();
    
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
        titleBarOverlay: {
            color: '#161618',
            symbolColor: '#9d9da6',
            height: 38
        }
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
    
    // Update title bar overlay colors when theme changes
    ipcMain.on('update-titlebar-overlay', (event, overlay) => {
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
pluginRegistry.discover(path.join(__dirname, 'plugins', 'builtin'));
pluginRegistry.discover(path.join(app.getPath('userData'), 'plugins'));
markStartup('plugins-loaded');

app.whenReady().then(() => {
    markStartup('app-ready');
    const win = createWindow();
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

    // --- Auto-updater (lazy-loaded, notify only) ---
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

    // Check for updates after a short delay to not slow down startup
    setTimeout(() => {
        autoUpdater.checkForUpdates().catch((err) => {
            console.error('Update check failed:', err.message);
        });
    }, 5000);

    ipcMain.handle('download-update', () => {
        return autoUpdater.downloadUpdate().catch((err) => {
            console.error('Download update failed:', err.message);
            return { error: err.message };
        });
    });

    ipcMain.handle('install-update', () => {
        autoUpdater.quitAndInstall(true, true);
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

// IPC Handlers
ipcMain.handle('select-folder', async (event, defaultPath) => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        defaultPath: defaultPath || undefined
    });
    return result.filePaths[0] || null;
});

ipcMain.handle('export-settings-dialog', async (event, jsonString) => {
    try {
        const result = await dialog.showSaveDialog({
            title: 'Export Settings',
            defaultPath: 'thumbnail-animator-settings.json',
            filters: [{ name: 'JSON Files', extensions: ['json'] }]
        });
        if (result.canceled || !result.filePath) return { success: false, canceled: true };
        fs.writeFileSync(result.filePath, jsonString, 'utf-8');
        return { success: true, filePath: result.filePath };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('import-settings-dialog', async () => {
    try {
        const result = await dialog.showOpenDialog({
            title: 'Import Settings',
            filters: [{ name: 'JSON Files', extensions: ['json'] }],
            properties: ['openFile']
        });
        if (result.canceled || !result.filePaths[0]) return { success: false, canceled: true };
        const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
        const data = JSON.parse(raw);
        return { success: true, data };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('sync-plugin-states-from-import', async (event, states) => {
    try {
        if (states && typeof states === 'object') {
            for (const [pluginId, enabled] of Object.entries(states)) {
                pluginRegistry.setPluginEnabled(pluginId, !!enabled);
            }
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('trigger-gc', () => {
    if (global.gc) {
        global.gc();
        // console.log('GC Triggered');
    }
});

ipcMain.handle('get-startup-timeline', () => startupTimeline);

ipcMain.handle('get-memory-info', () => {
    const mem = process.memoryUsage();
    return {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
    };
});

ipcMain.handle('get-cache-info', () => {
    if (!nativeScanner || !nativeScanner.getCacheInfo) return null;
    const video = nativeScanner.getCacheInfo(videoThumbDir || '');
    const image = nativeScanner.getCacheInfo(imageThumbDir || '');
    const folder = nativeScanner.getCacheInfo(folderPreviewDir || '');
    return {
        video: { size: video.totalSize, files: video.fileCount, maxSize: VIDEO_CACHE_MAX_BYTES },
        image: { size: image.totalSize, files: image.fileCount, maxSize: IMAGE_CACHE_MAX_BYTES },
        folder: { size: folder.totalSize, files: folder.fileCount },
    };
});

ipcMain.handle('evict-cache', (event, cacheType) => {
    if (!nativeScanner || !nativeScanner.planCacheEviction) return { deleted: 0, freed: 0 };
    const dir = cacheType === 'video' ? videoThumbDir : imageThumbDir;
    const maxBytes = cacheType === 'video' ? VIDEO_CACHE_MAX_BYTES : IMAGE_CACHE_MAX_BYTES;
    if (maxBytes === 0) return { deleted: 0, freed: 0 }; // unlimited
    // Force evict to 80% of max to avoid re-evicting on every call
    const plan = nativeScanner.planCacheEviction(dir, Math.floor(maxBytes * 0.8));
    if (plan.filesToDelete.length === 0) return { deleted: 0, freed: 0 };
    const deleted = nativeScanner.deleteFiles(plan.filesToDelete);
    return { deleted, freed: plan.bytesToFree };
});

ipcMain.handle('set-cache-limits', (event, videoCacheMB, imageCacheMB) => {
    VIDEO_CACHE_MAX_BYTES = videoCacheMB * 1024 * 1024;
    IMAGE_CACHE_MAX_BYTES = imageCacheMB * 1024 * 1024;
    try {
        fs.writeFileSync(cacheLimitsFile, JSON.stringify({ videoCacheMB, imageCacheMB }));
    } catch { /* non-critical */ }
});

ipcMain.handle('set-use-system-trash', (event, enabled) => {
    useSystemTrash = !!enabled;
});

// Concurrency-limited async pool: runs at most `limit` tasks at a time, preserves result order
async function asyncPool(limit, items, fn) {
    const results = [];
    const executing = new Set();
    for (const [index, item] of items.entries()) {
        const p = Promise.resolve().then(() => fn(item, index));
        results.push(p);
        executing.add(p);
        const clean = () => executing.delete(p);
        p.then(clean, clean);
        if (executing.size >= limit) {
            await Promise.race(executing);
        }
    }
    return Promise.all(results);
}

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
        // Check folder mtime for cache invalidation
        let folderMtime;
        try {
            const folderStats = await fs.promises.stat(folderPath);
            folderMtime = folderStats.mtimeMs;
        } catch {
            return [];
        }

        // Check disk cache
        const cachePath = getFolderPreviewCachePath(folderPath);
        const effectiveCount = previewCount || 4;
        try {
            const cacheData = JSON.parse(await fs.promises.readFile(cachePath, 'utf8'));
            if (cacheData.folderMtime === folderMtime && Array.isArray(cacheData.results) && (cacheData.count || 4) >= effectiveCount) {
                logPerf('get-folder-preview', startTime, { cached: 1, count: cacheData.results.length });
                return cacheData.results.slice(0, effectiveCount);
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
            return [];
        }

        // Generate thumbnails at 192px using existing pipeline
        if (!thumbnailPool) return [];

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
        return results;
    } catch (error) {
        logPerf('get-folder-preview', startTime, { error: 1 });
        return [];
    }
});

ipcMain.handle('scan-folder', async (event, folderPath, options = {}) => {
    try {
        const { folders, mediaFiles } = await scanFolderInternal(folderPath, options);
        return folders.length + mediaFiles.length > 0 ? [...folders, ...mediaFiles] : [];
    } catch (error) {
        console.error('Error scanning folder:', error);
        return [];
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
        return { scanId, success: true, totalFolders: folders.length, totalFiles: mediaFiles.length };
    } catch (error) {
        console.error('Error streaming folder scan:', error);
        send({ scanId, phase: 'complete', error: error.message });
        return { scanId, success: false, error: error.message };
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

    return { items, missing };
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
    return { items: allFiles, errors };
});

// Cheap rule matching for pre-filtering (no dimension/aspect/rating checks)
function matchesCheapRules(file, rules) {
    if (rules.fileType && rules.fileType !== 'all' && file.type !== rules.fileType) return false;
    if (rules.nameContains && !file.name.toLowerCase().includes(rules.nameContains.toLowerCase())) return false;
    if (rules.sizeValue && rules.sizeOperator) {
        const targetBytes = rules.sizeValue * 1024 * 1024;
        if (rules.sizeOperator === '>' && file.size <= targetBytes) return false;
        if (rules.sizeOperator === '<' && file.size >= targetBytes) return false;
    }
    if (rules.dateFrom && file.mtime < rules.dateFrom) return false;
    if (rules.dateTo && file.mtime > rules.dateTo) return false;
    return true;
}

// Main-process dimension cache (LRU by insertion order)
const dimensionCacheMain = new Map();
const DIMENSION_CACHE_MAX = 10000;

// Context menu IPC handlers
ipcMain.handle('reveal-in-explorer', async (event, filePath) => {
    try {
        // shell.showItemInFolder opens the file's parent folder and selects the file
        shell.showItemInFolder(filePath);
        return { success: true };
    } catch (error) {
        console.error('Error revealing file in explorer:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('rename-file', async (event, filePath, newName) => {
    try {
        // Validate newName doesn't contain path traversal
        if (newName !== path.basename(newName)) {
            return { success: false, error: 'Invalid file name' };
        }
        const dir = path.dirname(filePath);
        const newPath = path.join(dir, newName);
        
        // Check if new name already exists
        if (fs.existsSync(newPath)) {
            return { success: false, error: 'A file with this name already exists' };
        }
        
        await fs.promises.rename(filePath, newPath);
        try { appDb.updateFilePaths([{ oldPath: filePath, newPath }]); } catch (e) {
            console.error('Failed to update DB paths after rename:', e);
        }
        pushUndoEntry({
            type: 'rename',
            description: `Rename "${path.basename(filePath)}" → "${newName}"`,
            operations: [{ type: 'rename', oldPath: filePath, newPath }]
        });
        return { success: true, newPath };
    } catch (error) {
        console.error('Error renaming file:', error);
        return { success: false, error: error.message };
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
                            return { success: false, error: `Invalid regex: ${e.message}` };
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
                    return { success: false, error: `Unknown pattern type: ${patternType}` };
            }

            // Validate
            if (newName !== path.basename(newName)) {
                return { success: false, error: `Invalid name "${newName}" contains path separators` };
            }
            if (!newName || newName.trim() === '') {
                return { success: false, error: `Pattern produces empty name for "${path.basename(fp)}"` };
            }

            const newPath = path.join(dir, newName);
            planned.push({ oldPath: fp, newPath, newName });
        }

        // Check for duplicates within the batch
        const newPaths = new Set();
        for (const p of planned) {
            if (newPaths.has(p.newPath.toLowerCase())) {
                return { success: false, error: `Duplicate name in batch: "${p.newName}"` };
            }
            newPaths.add(p.newPath.toLowerCase());
        }

        // Check for conflicts with existing files (excluding files being renamed)
        const oldPathSet = new Set(filePaths.map(fp => fp.toLowerCase()));
        for (const p of planned) {
            if (p.oldPath === p.newPath) continue; // Same name, skip
            if (!oldPathSet.has(p.newPath.toLowerCase()) && fs.existsSync(p.newPath)) {
                return { success: false, error: `"${p.newName}" already exists on disk` };
            }
        }

        // Execute renames
        for (const p of planned) {
            if (p.oldPath === p.newPath) {
                results.push({ oldPath: p.oldPath, newPath: p.newPath, skipped: true });
                continue;
            }
            try {
                await fs.promises.rename(p.oldPath, p.newPath);
                operations.push({ type: 'rename', oldPath: p.oldPath, newPath: p.newPath });
                renamedPairs.push({ oldPath: p.oldPath, newPath: p.newPath });
                results.push({ oldPath: p.oldPath, newPath: p.newPath, success: true });
            } catch (err) {
                results.push({ oldPath: p.oldPath, newPath: p.newPath, success: false, error: err.message });
            }
        }

        // Update database references for successfully renamed files
        if (renamedPairs.length > 0) {
            try { appDb.updateFilePaths(renamedPairs); } catch (e) {
                console.error('Failed to update DB paths after batch rename:', e);
            }
            pushUndoEntry({
                type: 'rename',
                description: `Batch rename ${renamedPairs.length} file${renamedPairs.length === 1 ? '' : 's'}`,
                operations
            });
        }

        const successCount = results.filter(r => r.success).length;
        return { success: true, results, successCount, totalCount: filePaths.length };
    } catch (error) {
        console.error('Error in batch rename:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('delete-file', async (event, filePath) => {
    try {
        const basename = path.basename(filePath);
        if (useSystemTrash) {
            await shell.trashItem(filePath);
            return { success: true, trashed: true };
        }
        const stagingPath = await moveToStaging(filePath);
        pushUndoEntry({
            type: 'delete',
            description: `Delete "${basename}"`,
            operations: [{ type: 'delete', originalPath: filePath, stagingPath }]
        });
        return { success: true };
    } catch (error) {
        console.error('Error deleting file:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('open-url', async (event, url) => {
    try {
        await shell.openExternal(url);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('open-with-default', async (event, filePath) => {
    try {
        // shell.openPath opens the file with the system's default application
        await shell.openPath(filePath);
        return { success: true };
    } catch (error) {
        console.error('Error opening file with default app:', error);
        return { success: false, error: error.message };
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
        } else {
            // Fallback for non-Windows: copy as image data
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
                return { success: false, error: 'Could not load image' };
            }
            clipboard.writeImage(image);
        }
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('open-with', async (event, filePath) => {
    try {
        if (process.platform === 'win32') {
            const { execFile } = require('child_process');

            // Ensure we have an absolute path
            const absolutePath = path.resolve(filePath);

            // Verify the file exists
            if (!fs.existsSync(absolutePath)) {
                console.error('File does not exist:', absolutePath);
                return { success: false, error: 'File does not exist' };
            }

            // Use execFile to avoid shell injection - passes args as array, not through shell
            return new Promise((resolve) => {
                execFile('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', absolutePath], {
                    cwd: path.dirname(absolutePath)
                }, (error) => {
                    if (error) {
                        console.error('Error executing open-with command:', error);
                        resolve({ success: false, error: error.message });
                    } else {
                        resolve({ success: true });
                    }
                });
            });
        } else {
            // For non-Windows, fall back to default app
            await shell.openPath(filePath);
            return { success: true };
        }
    } catch (error) {
        console.error('Error opening file with dialog:', error);
        return { success: false, error: error.message };
    }
});

// Get available drives (Windows only)
ipcMain.handle('get-drives', async () => {
    try {
        if (process.platform !== 'win32') {
            // For non-Windows, return empty array or root paths
            return [];
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
        
        return drives;
    } catch (error) {
        console.error('Error getting drives:', error);
        return [];
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
            return results;
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
        return results;
    } catch (error) {
        logPerf('list-subdirectories', listStart, { error: 1 });
        console.error('Error listing subdirectories:', error);
        return [];
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

// ComfyUI workflow extraction has been moved to plugins/builtin/comfyui-workflow/index.js
function extractComfyUIWorkflow_REMOVED(filePath) {
    try {
        // Only process PNG files
        if (path.extname(filePath).toLowerCase() !== '.png') {
            return null;
        }

        let pngChunksExtract;
        try {
            pngChunksExtract = require('png-chunks-extract');
        } catch (error) {
            console.warn('png-chunks-extract not available:', error.message);
            return null;
        }

        const fileBuffer = fs.readFileSync(filePath);
        const chunks = pngChunksExtract(fileBuffer);

        // ComfyUI stores workflow data in text chunks
        // Look for chunks with name "tEXt" or "zTXt" (compressed text) or "iTXt" (international text)
        const workflowKeys = ['workflow', 'Workflow', 'WORKFLOW', 'prompt', 'Prompt', 'PROMPT', 'comfyui_workflow', 'ComfyUI_Workflow'];
        
        // First pass: look for known workflow keys
        for (const chunk of chunks) {
            if (chunk.name === 'tEXt' || chunk.name === 'zTXt' || chunk.name === 'iTXt') {
                try {
                    let textData;
                    if (chunk.name === 'zTXt') {
                        // zTXt chunks are compressed with zlib
                        const zlib = require('zlib');
                        // Ensure proper buffer handling
                        const bufferData = Buffer.isBuffer(chunk.data) ? chunk.data : Buffer.from(chunk.data);
                        textData = zlib.inflateSync(bufferData).toString('utf8');
                    } else if (chunk.name === 'iTXt') {
                        // iTXt chunks have a more complex structure: keyword\0compression\0langtag\0transkey\0text
                        // For simplicity, try to extract text after the last null byte
                        let dataStr;
                        if (Buffer.isBuffer(chunk.data)) {
                            dataStr = chunk.data.toString('utf8');
                        } else if (chunk.data instanceof Uint8Array || Array.isArray(chunk.data)) {
                            dataStr = Buffer.from(chunk.data).toString('utf8');
                        } else {
                            dataStr = String(chunk.data);
                        }
                        const lastNullIndex = dataStr.lastIndexOf('\0');
                        if (lastNullIndex !== -1) {
                            textData = dataStr.substring(lastNullIndex + 1);
                        } else {
                            textData = dataStr;
                        }
                    } else {
                        // tEXt chunks are plain text
                        // Ensure chunk.data is treated as a Buffer and decoded properly
                        // png-chunks-extract returns data as Uint8Array or Buffer
                        if (Buffer.isBuffer(chunk.data)) {
                            textData = chunk.data.toString('utf8');
                        } else if (chunk.data instanceof Uint8Array || Array.isArray(chunk.data)) {
                            textData = Buffer.from(chunk.data).toString('utf8');
                        } else if (typeof chunk.data === 'string') {
                            textData = chunk.data;
                        } else {
                            // Try to convert to buffer
                            textData = Buffer.from(chunk.data).toString('utf8');
                        }
                    }

                    // ComfyUI workflow data format: "key\0value" where \0 is null byte separator
                    const nullIndex = textData.indexOf('\0');
                    if (nullIndex === -1) {
                        // If no null separator, try parsing the entire text as JSON (some formats might not use null separator)
                        try {
                            const parsed = JSON.parse(textData);
                            // Check if it looks like a workflow object
                            if (parsed && typeof parsed === 'object' && (parsed.nodes || parsed.workflow || parsed.prompt)) {
                                return {
                                    key: 'workflow',
                                    workflow: parsed,
                                    raw: textData
                                };
                            }
                        } catch (e) {
                            // Not JSON, continue
                        }
                        continue;
                    }

                    const key = textData.substring(0, nullIndex);
                    const value = textData.substring(nullIndex + 1);

                    // Check if this is ComfyUI workflow data (case-insensitive check)
                    const keyLower = key.toLowerCase();
                    const isWorkflowKey = workflowKeys.some(wk => keyLower === wk.toLowerCase()) || 
                                         keyLower.includes('workflow') || 
                                         keyLower.includes('comfyui');

                    // Also check for "prompt" key (ComfyUI stores prompt data separately)
                    const isPromptKey = keyLower === 'prompt';

                    if (isWorkflowKey || isPromptKey || value.trim().startsWith('{') || value.trim().startsWith('[')) {
                        try {
                            // Try to parse as JSON
                            const workflow = JSON.parse(value);
                            console.log(`[ComfyUI Debug] Successfully parsed workflow from key "${key}"`);
                            // For "prompt" key, we still want to return it as workflow data
                            // For "workflow" key, return as-is
                            return {
                                key: key,
                                workflow: workflow,
                                raw: value
                            };
                        } catch (parseError) {
                            console.warn(`[ComfyUI Debug] Failed to parse JSON for key "${key}":`, parseError.message);
                            // If JSON parsing fails, check if it starts with JSON-like characters
                            const trimmedValue = value.trim();
                            if (trimmedValue.startsWith('{') || trimmedValue.startsWith('[')) {
                                // Looks like JSON but failed to parse - return raw
                                return {
                                    key: key,
                                    workflow: null,
                                    raw: value
                                };
                            }
                            // Not JSON-like, continue to next chunk
                            continue;
                        }
                    }
                } catch (chunkError) {
                    // Continue to next chunk if this one fails
                    console.warn('Error processing PNG chunk:', chunkError.message);
                    continue;
                }
            }
        }
        
        // Second pass: if no workflow found with known keys, check ALL text chunks for JSON that looks like workflow
        for (const chunk of chunks) {
            if (chunk.name === 'tEXt' || chunk.name === 'zTXt' || chunk.name === 'iTXt') {
                try {
                    let textData;
                    if (chunk.name === 'zTXt') {
                        const zlib = require('zlib');
                        textData = zlib.inflateSync(chunk.data).toString('utf8');
                    } else if (chunk.name === 'iTXt') {
                        const dataStr = chunk.data.toString('utf8');
                        const lastNullIndex = dataStr.lastIndexOf('\0');
                        if (lastNullIndex !== -1) {
                            textData = dataStr.substring(lastNullIndex + 1);
                        } else {
                            textData = dataStr;
                        }
                    } else {
                        textData = chunk.data.toString('utf8');
                    }

                    // Try to extract value after null separator
                    const nullIndex = textData.indexOf('\0');
                    let valueToCheck = textData;
                    let key = 'unknown';
                    
                    if (nullIndex !== -1) {
                        key = textData.substring(0, nullIndex);
                        valueToCheck = textData.substring(nullIndex + 1);
                    }

                    // Try to parse as JSON
                    try {
                        const parsed = JSON.parse(valueToCheck);
                        // Check if it looks like a ComfyUI workflow (has nodes, workflow structure, etc.)
                        if (parsed && typeof parsed === 'object') {
                            // ComfyUI workflows typically have nodes array or workflow/prompt structure
                            if (Array.isArray(parsed) || 
                                parsed.nodes || 
                                parsed.workflow || 
                                parsed.prompt ||
                                (typeof parsed === 'object' && Object.keys(parsed).length > 0 && 
                                 (Object.values(parsed).some(v => typeof v === 'object' && v.class_type)))) {
                                return {
                                    key: key,
                                    workflow: parsed,
                                    raw: valueToCheck
                                };
                            }
                        }
                    } catch (parseError) {
                        // Not valid JSON, skip
                        continue;
                    }
                } catch (chunkError) {
                    continue;
                }
            }
        }

        // If we get here, no workflow was found - log available chunks for debugging
        const textChunks = chunks.filter(c => c.name === 'tEXt' || c.name === 'zTXt' || c.name === 'iTXt');
        if (textChunks.length > 0) {
            console.log(`[ComfyUI Debug] Found ${textChunks.length} text chunks in PNG, but no workflow detected`);
            // Log keys and previews of each text chunk for debugging
            textChunks.forEach((chunk, idx) => {
                try {
                    let textData = '';
                    if (chunk.name === 'zTXt') {
                        const zlib = require('zlib');
                        textData = zlib.inflateSync(chunk.data).toString('utf8');
                    } else {
                        // Ensure proper buffer decoding for debug output
                        if (Buffer.isBuffer(chunk.data)) {
                            textData = chunk.data.toString('utf8');
                        } else if (chunk.data instanceof Uint8Array || Array.isArray(chunk.data)) {
                            textData = Buffer.from(chunk.data).toString('utf8');
                        } else if (typeof chunk.data === 'string') {
                            textData = chunk.data;
                        } else {
                            textData = Buffer.from(chunk.data).toString('utf8');
                        }
                    }
                    
                    const nullIndex = textData.indexOf('\0');
                    if (nullIndex !== -1) {
                        const key = textData.substring(0, nullIndex);
                        const valuePreview = textData.substring(nullIndex + 1, nullIndex + 150);
                        console.log(`[ComfyUI Debug] Chunk ${idx} (${chunk.name}): key="${key}", value preview: ${valuePreview}...`);
                    } else {
                        console.log(`[ComfyUI Debug] Chunk ${idx} (${chunk.name}): ${textData.substring(0, 150)}...`);
                    }
                } catch (e) {
                    console.log(`[ComfyUI Debug] Chunk ${idx} (${chunk.name}): [could not decode] - ${e.message}`);
                }
            });
        } else {
            console.log(`[ComfyUI Debug] No text chunks found in PNG file`);
        }

        return null;
    } catch (error) {
        console.warn('Error extracting ComfyUI workflow:', error.message);
        console.error(error);
        return null;
    }
}

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
        return { success: true, info };
    } catch (error) {
        logPerf('get-file-info', infoStart, { error: 1 });
        console.error('Error getting file info:', error);
        return { success: false, error: error.message };
    }
});

function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Create folder
ipcMain.handle('create-folder', async (event, folderPath, folderName) => {
    try {
        // Validate folderName doesn't contain path traversal
        if (folderName !== path.basename(folderName)) {
            return { success: false, error: 'Invalid folder name' };
        }
        const newFolderPath = path.join(folderPath, folderName);
        if (fs.existsSync(newFolderPath)) {
            return { success: false, error: 'Folder already exists' };
        }
        await fs.promises.mkdir(newFolderPath, { recursive: true });
        return { success: true, path: newFolderPath };
    } catch (error) {
        console.error('Error creating folder:', error);
        return { success: false, error: error.message };
    }
});

// Copy file (used when dropping external files into the app)
// Accepts either (sourcePath, destPath) or (sourcePath, destFolder, fileName)
// Optional conflictResolution: 'replace' | 'keep-both' | 'skip' — if omitted and conflict exists, returns { conflict: true }
ipcMain.handle('copy-file', async (event, sourcePath, destFolderOrPath, fileName, conflictResolution) => {
    try {
        const destPath = fileName
            ? path.join(destFolderOrPath, fileName)
            : destFolderOrPath;
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
            await fs.promises.mkdir(destDir, { recursive: true });
        }
        let finalPath = destPath;
        if (fs.existsSync(finalPath)) {
            if (!conflictResolution) {
                return { conflict: true, fileName: path.basename(destPath), destPath };
            }
            if (conflictResolution === 'skip') {
                return { success: true, skipped: true };
            } else if (conflictResolution === 'keep-both') {
                const ext = path.extname(destPath);
                const base = path.basename(destPath, ext);
                const dir = path.dirname(destPath);
                let counter = 2;
                while (fs.existsSync(finalPath)) {
                    finalPath = path.join(dir, `${base} (${counter})${ext}`);
                    counter++;
                }
            }
            // 'replace' — use original finalPath (overwrite)
        }
        await fs.promises.copyFile(sourcePath, finalPath);
        return { success: true };
    } catch (error) {
        console.error('Error copying file:', error);
        return { success: false, error: error.message };
    }
});

// Move file
// Accepts either (sourcePath, destPath) or (sourcePath, destFolder, fileName)
// Optional conflictResolution: 'replace' | 'keep-both' | 'skip' — if omitted and conflict exists, returns { conflict: true }
ipcMain.handle('move-file', async (event, sourcePath, destFolderOrPath, fileName, conflictResolution) => {
    try {
        const destPath = fileName
            ? path.join(destFolderOrPath, fileName)
            : destFolderOrPath;
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
            await fs.promises.mkdir(destDir, { recursive: true });
        }

        let finalPath = destPath;
        if (fs.existsSync(destPath) && path.normalize(sourcePath) !== path.normalize(destPath)) {
            if (!conflictResolution) {
                return { conflict: true, fileName: path.basename(destPath), destPath };
            }
            if (conflictResolution === 'skip') {
                return { success: true, skipped: true };
            } else if (conflictResolution === 'keep-both') {
                const ext = path.extname(destPath);
                const base = path.basename(destPath, ext);
                const dir = path.dirname(destPath);
                let counter = 2;
                while (fs.existsSync(finalPath)) {
                    finalPath = path.join(dir, `${base} (${counter})${ext}`);
                    counter++;
                }
            } else if (conflictResolution === 'replace') {
                await fs.promises.unlink(destPath);
            }
        }

        await safeMove(sourcePath, finalPath);
        if (path.normalize(sourcePath) !== path.normalize(finalPath)) {
            try { appDb.updateFilePaths([{ oldPath: sourcePath, newPath: finalPath }]); } catch (e) {
                console.error('Failed to update DB paths after move:', e);
            }
        }
        pushUndoEntry({
            type: 'move',
            description: `Move "${path.basename(sourcePath)}"`,
            operations: [{ type: 'move', sourcePath, destPath: finalPath }]
        });
        return { success: true };
    } catch (error) {
        console.error('Error moving file:', error);
        return { success: false, error: error.message };
    }
});

// Watch folder for changes
ipcMain.handle('watch-folder', async (event, folderPath) => {
    try {
        if (!chokidar) {
            return { success: false, error: 'File watching not available' };
        }
        
        // Normalize path for consistent comparison
        const normalizedPath = path.normalize(folderPath);

        // Stop existing watcher if any
        if (watchedFolders.has(normalizedPath)) {
            const existingWatcher = watchedFolders.get(normalizedPath);
            if (existingWatcher._debounceMap) {
                for (const timeoutId of existingWatcher._debounceMap.values()) {
                    clearTimeout(timeoutId);
                }
                existingWatcher._debounceMap.clear();
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

        // Debounce/dedup watcher events to coalesce duplicate notifications
        // Windows ReadDirectoryChangesW can fire multiple events for single file changes
        const watcherDebounceMap = new Map();
        watcher._debounceMap = watcherDebounceMap; // Store reference for cleanup on close
        const WATCHER_DEBOUNCE_MS = 500;

        watcher.on('all', (event, filePath) => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            const normalizedFilePath = path.normalize(filePath);
            const dedupeKey = `${event}:${normalizedFilePath}`;

            // Clear previous pending notification for same event+path
            if (watcherDebounceMap.has(dedupeKey)) {
                clearTimeout(watcherDebounceMap.get(dedupeKey));
            }

            watcherDebounceMap.set(dedupeKey, setTimeout(() => {
                watcherDebounceMap.delete(dedupeKey);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('folder-changed', { folderPath: normalizedPath, event, filePath: normalizedFilePath });
                }
            }, WATCHER_DEBOUNCE_MS));
        });
        
        watchedFolders.set(normalizedPath, watcher);
        return { success: true };
    } catch (error) {
        console.error('Error watching folder:', error);
        return { success: false, error: error.message };
    }
});

// Unwatch folder
ipcMain.handle('unwatch-folder', async (event, folderPath) => {
    try {
        // Normalize path for consistent lookup
        const normalizedPath = path.normalize(folderPath);
        if (watchedFolders.has(normalizedPath)) {
            const watcher = watchedFolders.get(normalizedPath);
            // Clear any pending debounce timeouts before closing
            if (watcher._debounceMap) {
                for (const timeoutId of watcher._debounceMap.values()) {
                    clearTimeout(timeoutId);
                }
                watcher._debounceMap.clear();
            }
            await watcher.close();
            watchedFolders.delete(normalizedPath);
        }
        return { success: true };
    } catch (error) {
        console.error('Error unwatching folder:', error);
        return { success: false, error: error.message };
    }
});

// Generate a video thumbnail via worker pool (returns file:// URL to cached JPEG or null)
ipcMain.handle('generate-video-thumbnail', async (event, filePath) => {
    const startTime = performance.now();
    try {
        if (!thumbnailPool) return { success: false };
        const stats = await fs.promises.stat(filePath);
        const thumbPath = getThumbCachePath(filePath, stats.mtimeMs);
        const workerT0 = performance.now();
        const result = await thumbnailPool.generate({ type: 'video', filePath, thumbPath });
        const workerMs = performance.now() - workerT0;
        _bumpThumbStats(0, 0, 0, 0, 1, workerMs);
        if (result.success && result.thumbPath) {
            logPerf('generate-video-thumbnail.ipc', startTime, { success: 1, worker: 1 });
            return { success: true, url: pathToFileUrl(result.thumbPath) };
        }
        logPerf('generate-video-thumbnail.ipc', startTime, { success: 0, worker: 1 });
        return { success: false };
    } catch (error) {
        logPerf('generate-video-thumbnail.ipc', startTime, { error: 1 });
        return { success: false, error: error.message };
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
                return { success: true, url: pathToFileUrl(thumbPath) };
            }
            // If native failed, fall through to sharp (covers formats native can't handle, e.g. SVG)
        }

        if (!thumbnailPool) return { success: false };
        const workerT0 = performance.now();
        const result = await thumbnailPool.generate({ type: 'image', filePath, thumbPath, maxSize });
        const workerMs = performance.now() - workerT0;
        _bumpThumbStats(0, 0, 1, workerMs, 0, 0);
        if (result.success && result.thumbPath) {
            logPerf('generate-image-thumbnail.ipc', startTime, { success: 1, maxSize, worker: 1 });
            return { success: true, url: pathToFileUrl(result.thumbPath) };
        }
        logPerf('generate-image-thumbnail.ipc', startTime, { success: 0, maxSize, worker: 1 });
        return { success: false };
    } catch (error) {
        logPerf('generate-image-thumbnail.ipc', startTime, { error: 1, maxSize });
        return { success: false, error: error.message };
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
        if (!Array.isArray(items) || items.length === 0) return [];

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

        let nativeFailures = [];
        let nativeMs = 0;
        let nativeSuccesses = 0;
        // Native Rust batch for images
        if (imageBatch.length > 0 && nativeScanner && nativeScanner.generateImageThumbnails) {
            const nativeRequests = imageBatch.map(item => ({
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
                        success: true,
                        url: pathToFileUrl(r.thumbPath)
                    });
                } else {
                    // Native couldn't handle this image (e.g. SVG) — fall back to sharp
                    nativeFailures.push(imageBatch[i]);
                }
            }
        } else {
            // No native addon — everything goes through sharp
            nativeFailures = imageBatch;
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
                    success: r && r.success,
                    url: r && r.success && r.thumbPath ? pathToFileUrl(r.thumbPath) : null
                });
            });
        } else if (workerItems.length > 0) {
            for (const item of workerItems) {
                resultMap.set(item.filePath, { filePath: item.filePath, success: false, url: null });
            }
        }
        // Distribute the worker-path time across sharp (images) and ffmpeg (videos)
        // weighted by item count (rough but gives a clear per-path breakdown).
        const totalWorker = workerItems.length || 1;
        const sharpMs = workerMs * (nativeFailures.length / totalWorker);
        const ffmpegMs = workerMs * (videoBatch.length / totalWorker);
        _bumpThumbStats(nativeSuccesses, nativeMs, nativeFailures.length, sharpMs, videoBatch.length, ffmpegMs);

        for (const item of invalidItems) {
            resultMap.set(item.filePath, { filePath: item.filePath, success: false, url: null });
        }

        const output = items.map(item => resultMap.get(item.filePath) || { filePath: item.filePath, success: false, url: null });
        const nativeCount = imageBatch.length - nativeFailures.length;
        logPerf('generate-thumbnails-batch', startTime, {
            count: items.length,
            success: output.filter(r => r.success).length,
            native: nativeCount,
            worker: workerItems.length
        });
        return output;
    } catch (error) {
        logPerf('generate-thumbnails-batch', startTime, { error: 1 });
        return items.map(item => ({ filePath: item.filePath, success: false, url: null }));
    }
});

ipcMain.handle('scan-file-dimensions', async (event, files) => {
    const startTime = performance.now();
    try {
        if (!Array.isArray(files) || files.length === 0) {
            logPerf('scan-file-dimensions', startTime, { files: 0, hits: 0 });
            return [];
        }

        const sanitizedFiles = files.filter(file =>
            file && typeof file.path === 'string' && typeof file.isImage === 'boolean'
        );
        if (sanitizedFiles.length === 0) {
            logPerf('scan-file-dimensions', startTime, { files: 0, hits: 0 });
            return [];
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
        return results;
    } catch (error) {
        logPerf('scan-file-dimensions', startTime, { error: 1 });
        return [];
    }
});

// ==================== DUPLICATE DETECTION ====================

// Popcount lookup table (byte -> number of set bits)
const POPCOUNT_TABLE = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
    POPCOUNT_TABLE[i] = POPCOUNT_TABLE[i >> 1] + (i & 1);
}

function hammingDistance(hex1, hex2) {
    const buf1 = Buffer.from(hex1, 'hex');
    const buf2 = Buffer.from(hex2, 'hex');
    const len = Math.min(buf1.length, buf2.length);
    let dist = 0;
    for (let i = 0; i < len; i++) {
        dist += POPCOUNT_TABLE[buf1[i] ^ buf2[i]];
    }
    return dist;
}

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

        if (files.length === 0) return { exactGroups: [], similarGroups: [] };

        event.sender.send('duplicate-scan-progress', { current: 0, total: files.length, phase: 'hashing' });

        // Exact hashes: use native BLAKE3 if available (parallel, ~3x faster)
        let exactHashMap;
        if (nativeScanner && nativeScanner.hashFiles) {
            const hashStart = performance.now();
            const results = nativeScanner.hashFiles(files.map(f => f.path));
            exactHashMap = new Map();
            for (const r of results) {
                exactHashMap.set(r.path, r.hash || null);
            }
            logPerf('scan-duplicates.exact-hash-native', hashStart, { files: files.length });
            event.sender.send('duplicate-scan-progress', { current: files.length, total: files.length, phase: 'hashing' });
        }

        // Perceptual hashes: still use worker pool (needs sharp for image resizing)
        const hashMap = await hashPool.scanHashes(files, (completed, total) => {
            if (!exactHashMap) {
                event.sender.send('duplicate-scan-progress', { current: completed, total, phase: 'hashing' });
            }
        });

        // Merge: use native BLAKE3 for exact hashes if available, else use SHA-256 from worker pool
        if (exactHashMap) {
            for (const [filePath, hashes] of hashMap) {
                hashes.exactHash = exactHashMap.get(filePath) || hashes.exactHash;
            }
        }

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

        // Pairwise comparison (yield to event loop every 50K comparisons to stay responsive)
        const totalComparisons = (perceptualFiles.length * (perceptualFiles.length - 1)) / 2;
        let compCount = 0;
        for (let i = 0; i < perceptualFiles.length; i++) {
            const buf1 = hashBuffers[i];
            for (let j = i + 1; j < perceptualFiles.length; j++) {
                const buf2 = hashBuffers[j];
                const len = Math.min(buf1.length, buf2.length);
                let dist = 0;
                for (let k = 0; k < len; k++) {
                    dist += POPCOUNT_TABLE[buf1[k] ^ buf2[k]];
                    if (dist > threshold) break; // Early exit
                }
                if (dist <= threshold) {
                    union(perceptualFiles[i].path, perceptualFiles[j].path);
                }
                compCount++;
            }
            // Yield every 50K comparisons so the main process stays responsive
            if (compCount > 50000) {
                compCount = 0;
                await new Promise(resolve => setImmediate(resolve));
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

        return { exactGroups, similarGroups, hashData };
    } catch (error) {
        console.error('Error scanning duplicates:', error);
        return { exactGroups: [], similarGroups: [], error: error.message };
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

        return { exactGroups, similarGroups };
    } catch (error) {
        console.error('Error regrouping duplicates:', error);
        return { exactGroups: [], similarGroups: [], error: error.message };
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
            if (useSystemTrash) {
                await shell.trashItem(filePath);
            } else {
                const stagingPath = await moveToStaging(filePath);
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
    return { deleted, failed, trashed: useSystemTrash };
});

// Check if ffmpeg is available (renderer can adapt UI accordingly)
ipcMain.handle('has-ffmpeg', async () => {
    return { ffmpeg: !!ffmpegPath, ffprobe: !!ffprobePath };
});

// --- AI Visual Search (CLIP) IPC handlers ---
// Inference runs directly in the main process (no worker threads)
// to avoid Electron ABI incompatibility with onnxruntime-node in workers.

const MODEL_NAME = 'Xenova/clip-vit-base-patch32';

function getClipCacheDir() {
    return path.join(app.getPath('userData'), 'clip-models');
}

ipcMain.handle('clip-check-cache', async () => {
    try {
        const cacheDir = getClipCacheDir();
        // Check for an actual model file, not just the directory (which may be empty)
        const onnxFile = path.join(cacheDir, 'Xenova', 'clip-vit-base-patch32', 'onnx', 'model.onnx');
        const onnxQuantized = path.join(cacheDir, 'Xenova', 'clip-vit-base-patch32', 'onnx', 'model_quantized.onnx');
        const cached = fs.existsSync(onnxFile) || fs.existsSync(onnxQuantized);
        return { cached };
    } catch {
        return { cached: false };
    }
});

ipcMain.handle('clip-init', async (event) => {
    try {
        if (clipModel) return { success: true };

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
        const visionOpts = { ...opts, model_file_name: 'vision_model' };
        const textOpts   = { ...opts, model_file_name: 'text_model' };

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
        // Bypasses onnxruntime-node's ABI-incompat-with-workers problem entirely:
        // the Rust NAPI addon loads cleanly in any JS thread, so inference runs
        // fully off the main process.
        if (nativeScanner && nativeScanner.clipInit) {
            try {
                const cacheDir = getClipCacheDir();
                const modelRoot = path.join(cacheDir, 'Xenova', 'clip-vit-base-patch32', 'onnx');
                const pick = (base) => {
                    const q = path.join(modelRoot, `${base}_quantized.onnx`);
                    const f = path.join(modelRoot, `${base}.onnx`);
                    return fs.existsSync(q) ? q : (fs.existsSync(f) ? f : null);
                };
                const visionPath = pick('vision_model');
                const textPath = pick('text_model');
                if (visionPath && textPath) {
                    const t0 = Date.now();
                    const ok = await clipWorkerInit(visionPath, textPath, 4);
                    if (ok) {
                        console.log(`[clip] native ONNX sessions loaded in worker in ${Date.now() - t0}ms`);
                    }
                } else {
                    console.warn('[clip] native load skipped: model files not found on disk');
                }
            } catch (e) {
                console.warn('[clip] native load failed, falling back to onnxruntime-node:', e.message);
            }
        }

        return { success: true };
    } catch (err) {
        clipModel = null;
        console.error('clip-init error:', err);
        return { success: false, error: err.message };
    }
});

// Helper: embed a single image file
// Uses nativeImage as fallback; prefer clipPreprocessPool for batched work.
// CLIP ViT-B/32 normalization constants (ImageNet)
const CLIP_MEAN = [0.48145466, 0.4578275, 0.40821073];
const CLIP_STD  = [0.26862954, 0.26130258, 0.27577711];
const CLIP_SIZE = 224;
const CLIP_VIDEO_EXTS = new Set(['.mp4', '.webm', '.ogg', '.mov']);
const CLIP_ANIM_EXTS  = new Set(['.gif', '.webp']);

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
    if (clipNativeReady && clipInferenceWorker) {
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
    if (!clipModel) return [];

    // Phase 1: Pre-extract frames for all video/animated files in parallel.
    // FFmpeg is I/O-bound so we can safely run multiple files concurrently.
    // We process files in chunks to avoid spawning too many FFmpeg processes at once.
    const FRAME_EXTRACT_CONCURRENCY = 4;
    const frameMap = new Map(); // filePath -> framePaths[]

    const mediaFiles = files.filter(f => {
        const ext = path.extname(f.path).toLowerCase();
        return CLIP_VIDEO_EXTS.has(ext) || CLIP_ANIM_EXTS.has(ext);
    });

    for (let i = 0; i < mediaFiles.length; i += FRAME_EXTRACT_CONCURRENCY) {
        const chunk = mediaFiles.slice(i, i + FRAME_EXTRACT_CONCURRENCY);
        await Promise.all(chunk.map(async (file) => {
            const ext = path.extname(file.path).toLowerCase();
            const n = CLIP_VIDEO_EXTS.has(ext) ? 4 : 3;
            const frames = await extractMediaKeyframes(file.path, n);
            if (frames) frameMap.set(file.path, frames);
        }));
    }

    // Phase 2: Batched CLIP inference with I/O pipelining.
    // Video/animated files use clipEmbedMultiFrame (already batched internally).
    // Static images are batched in groups of CLIP_BATCH_SIZE with look-ahead preprocessing.
    const CLIP_BATCH_SIZE = 4;
    const resultMap = new Map(); // filePath -> embedding
    let completed = 0;
    const sender = event.sender;

    // Helper: resolve the best source path for a static image
    function resolveImageSource(file) {
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
        const ext = path.extname(file.path).toLowerCase();
        if (CLIP_VIDEO_EXTS.has(ext) || CLIP_ANIM_EXTS.has(ext)) {
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
            const ext = path.extname(file.path).toLowerCase();
            const isVideo = CLIP_VIDEO_EXTS.has(ext);
            let embedding = null;

            const framePaths = frameMap.get(file.path);
            if (framePaths) {
                embedding = await clipEmbedMultiFrame(framePaths);
            }

            // Fallback to single-frame
            if (!embedding) {
                let source = file.path;
                if (file.thumbPath && fs.existsSync(file.thumbPath)) {
                    source = file.thumbPath;
                } else if (videoThumbDir && file.mtime != null) {
                    const vidThumb = getThumbCachePath(file.path, file.mtime);
                    if (fs.existsSync(vidThumb)) source = vidThumb;
                }
                if (isVideo && source === file.path) {
                    const vidThumb = await generateVideoThumbnail(file.path);
                    if (vidThumb) source = vidThumb;
                }
                if (source !== file.path || CLIP_ANIM_EXTS.has(ext)) {
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

    // Kick off first batch preprocessing immediately
    let nextBatchIdx = 0;
    let pendingPreprocess = null;
    if (staticFiles.length > 0) {
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
        const preprocessed = await pendingPreprocess;
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
            try {
                embeddings = await clipEmbedBatch(validPixels);
            } catch (err) {
                console.error('clip-embed batch error:', err.message);
                embeddings = new Array(validPixels.length).fill(null);
            }
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

    // Phase 3: Clean up all temp frames now that inference is complete.
    for (const framePaths of frameMap.values()) {
        for (const fp of framePaths) fs.promises.unlink(fp).catch(() => {});
    }

    return results;
});

ipcMain.handle('clip-embed-text', async (event, text) => {
    if (!clipModel) return null;
    try {
        const { tokenizer, textModel } = clipModel;

        // Tokenize (fast, JS-side). Native addon handles inference below.
        const inputs = tokenizer(text, { padding: true, truncation: true });

        // Native path: pass tokenized tensors to the Rust worker for inference
        if (clipNativeReady && clipInferenceWorker) {
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
                return out;
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

        return out;
    } catch (err) {
        console.error('clip-embed-text error:', err);
        return null;
    }
});

ipcMain.handle('clip-status', async () => {
    return { loaded: !!clipModel, native: clipNativeReady };
});

ipcMain.handle('clip-terminate', async () => {
    clipModel = null;
    if (clipPreprocessPool) { clipPreprocessPool.terminate(); clipPreprocessPool = null; }
    if (clipInferenceWorker) {
        try { clipInferenceWorker.postMessage({ type: 'shutdown' }); } catch {}
        try { clipInferenceWorker.terminate(); } catch {}
        clipInferenceWorker = null;
        clipNativeReady = false;
    }
    return { success: true };
});

// Plugin system IPC handlers
ipcMain.handle('get-plugin-manifests', () => {
    return pluginRegistry.getManifests();
});

ipcMain.handle('execute-plugin-action', async (event, pluginId, actionId, filePath, metadata) => {
    try {
        const result = await pluginRegistry.executeAction(pluginId, actionId, filePath, metadata);
        return { success: true, result };
    } catch (err) {
        console.warn(`[Plugin action] ${pluginId}/${actionId} failed:`, err.message);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('get-plugin-info-sections', () => {
    return pluginRegistry.getAllInfoSections();
});

ipcMain.handle('render-plugin-info-section', async (event, pluginId, sectionId, filePath, pluginMetadata) => {
    try {
        const result = await pluginRegistry.renderInfoSection(pluginId, sectionId, filePath, pluginMetadata);
        return { success: true, result };
    } catch (err) {
        console.warn(`[Plugin info section] ${pluginId}/${sectionId} failed:`, err.message);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('get-plugin-batch-operations', () => {
    return pluginRegistry.getAllBatchOperations();
});

ipcMain.handle('execute-plugin-batch-operation', async (event, pluginId, operationId, filePaths, options) => {
    try {
        const result = await pluginRegistry.executeBatchOperation(pluginId, operationId, filePaths, options || {});
        return { success: true, result };
    } catch (err) {
        console.warn(`[Plugin batch op] ${pluginId}/${operationId} failed:`, err.message);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('get-plugin-settings-panels', () => {
    return pluginRegistry.getAllSettingsPanels();
});

ipcMain.handle('execute-plugin-settings-action', async (event, pluginId, action, data) => {
    try {
        const result = await pluginRegistry.executeSettingsAction(pluginId, action, data);
        return { success: true, result };
    } catch (err) {
        console.warn(`[Plugin settings] ${pluginId}/${action} failed:`, err.message);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('plugin-generate-thumbnail', async (event, filePath, ext) => {
    try {
        const result = await pluginRegistry.generateThumbnail(filePath, ext);
        return { success: true, result };
    } catch (err) {
        console.warn(`[Plugin thumbnail] ${filePath} failed:`, err.message);
        return { success: false, error: err.message };
    }
});

ipcMain.handle('get-plugin-states', () => {
    return pluginRegistry.getPluginStates();
});

ipcMain.handle('set-plugin-enabled', (event, pluginId, enabled) => {
    try {
        pluginRegistry.setPluginEnabled(pluginId, enabled);
        return { success: true };
    } catch (err) {
        console.warn(`[Plugin toggle] ${pluginId} failed:`, err.message);
        return { success: false, error: err.message };
    }
});

// Cleanup watchers on app quit
// Undo file operation
ipcMain.handle('undo-file-operation', async () => {
    if (undoStack.length === 0) {
        return { success: false, error: 'Nothing to undo' };
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
        return { success: true, description: entry.description, canUndo: undoStack.length > 0, canRedo: true };
    } catch (error) {
        console.error('Undo failed:', error);
        // Roll back already-completed operations to restore consistent state
        for (const op of completedOps) {
            try {
                switch (op.type) {
                    case 'rename':
                        await fs.promises.rename(op.oldPath, op.newPath);
                        break;
                    case 'delete':
                        op.stagingPath = await moveToStaging(op.originalPath);
                        break;
                    case 'move':
                        await safeMove(op.sourcePath, op.destPath);
                        break;
                }
            } catch (rollbackErr) {
                console.error('Undo rollback failed for op:', op.type, rollbackErr);
            }
        }
        undoStack.push(entry);
        return { success: false, error: error.message, description: entry.description };
    }
});

// Redo file operation
ipcMain.handle('redo-file-operation', async () => {
    if (redoStack.length === 0) {
        return { success: false, error: 'Nothing to redo' };
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
                    op.stagingPath = await moveToStaging(op.originalPath);
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
        return { success: true, description: entry.description, canUndo: true, canRedo: redoStack.length > 0 };
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
        return { success: false, error: error.message, description: entry.description };
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
    try { appDb.close(); } catch {}
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
ipcMain.handle('db-check-migration-status', () => {
    try { return { success: true, data: appDb.checkMigrationStatus() }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-run-migration', (event, data) => {
    try { appDb.runMigration(data); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-get-meta', (event, key) => {
    try { return { success: true, data: appDb.getMeta(key) }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-set-meta', (event, key, value) => {
    try { appDb.setMeta(key, value); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
});

// IPC result caches for frequently-fetched full-table queries
const _ipcCache = { ratings: null, pinned: null, tags: null, collections: null };

// Ratings
ipcMain.handle('db-get-all-ratings', () => {
    try {
        if (!_ipcCache.ratings) _ipcCache.ratings = { success: true, data: appDb.getAllRatings() };
        return _ipcCache.ratings;
    }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-set-rating', (event, filePath, rating) => {
    try { appDb.setRating(filePath, rating); _ipcCache.ratings = null; return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
});

// Pins
ipcMain.handle('db-get-all-pinned', () => {
    try {
        if (!_ipcCache.pinned) _ipcCache.pinned = { success: true, data: appDb.getAllPinned() };
        return _ipcCache.pinned;
    }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-set-pinned', (event, filePath, pinned) => {
    try { appDb.setPinned(filePath, pinned); _ipcCache.pinned = null; return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
});

// Favorites
ipcMain.handle('db-get-favorites', () => {
    try { return { success: true, data: appDb.getFavorites() }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-save-favorites', (event, favObj) => {
    try { appDb.saveFavorites(favObj); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
});

// Recent files
ipcMain.handle('db-get-recent-files', (event, limit) => {
    try { return { success: true, data: appDb.getRecentFiles(limit || 50) }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-add-recent-file', (event, entry, limit) => {
    try { appDb.addRecentFile(entry, limit || 50); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-clear-recent-files', () => {
    try { appDb.clearRecentFiles(); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
});

// Collections
ipcMain.handle('db-get-all-collections', () => {
    try {
        if (!_ipcCache.collections) _ipcCache.collections = { success: true, data: appDb.getAllCollections() };
        return _ipcCache.collections;
    }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-get-collection', (event, id) => {
    try { return { success: true, data: appDb.getCollection(id) }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-save-collection', (event, col) => {
    try { _ipcCache.collections = null; return { success: true, data: appDb.saveCollection(col) }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-delete-collection', (event, id) => {
    try { appDb.deleteCollection(id); _ipcCache.collections = null; return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-get-collection-files', (event, collectionId) => {
    try { return { success: true, data: appDb.getCollectionFiles(collectionId) }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-add-files-to-collection', (event, collectionId, filePaths) => {
    try { return { success: true, data: appDb.addFilesToCollection(collectionId, filePaths) }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-remove-file-from-collection', (event, collectionId, filePath) => {
    try { appDb.removeFileFromCollection(collectionId, filePath); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-remove-files-from-collection', (event, collectionId, filePaths) => {
    try { appDb.removeFilesFromCollection(collectionId, filePaths); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
});

// Tags
ipcMain.handle('db-create-tag', (event, name, description, color) => {
    try { _ipcCache.tags = null; return { success: true, data: appDb.createTag(name, description, color) }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-update-tag', (event, id, updates) => {
    try { _ipcCache.tags = null; return { success: true, data: appDb.updateTag(id, updates) }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-delete-tag', (event, id) => {
    try { appDb.deleteTag(id); _ipcCache.tags = null; return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-get-all-tags', () => {
    try {
        if (!_ipcCache.tags) _ipcCache.tags = { success: true, data: appDb.getAllTags() };
        return _ipcCache.tags;
    }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-get-tag', (event, id) => {
    try { return { success: true, data: appDb.getTag(id) }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-search-tags', (event, query) => {
    try { return { success: true, data: appDb.searchTags(query) }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-get-top-tags', (event, limit) => {
    try { return { success: true, data: appDb.getTopTags(limit) }; }
    catch (e) { return { success: false, error: e.message }; }
});

// File-tag associations
ipcMain.handle('db-add-tag-to-file', (event, filePath, tagId) => {
    try { appDb.addTagToFile(filePath, tagId); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-remove-tag-from-file', (event, filePath, tagId) => {
    try { appDb.removeTagFromFile(filePath, tagId); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-get-tags-for-file', (event, filePath) => {
    try { return { success: true, data: appDb.getTagsForFile(filePath) }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-get-tags-for-files', (event, filePaths) => {
    try { return { success: true, data: appDb.getTagsForFiles(filePaths) }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-get-files-for-tag', (event, tagId) => {
    try { return { success: true, data: appDb.getFilesForTag(tagId) }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-bulk-tag-files', (event, filePaths, tagId) => {
    try { appDb.bulkTagFiles(filePaths, tagId); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-bulk-remove-tag-from-files', (event, filePaths, tagId) => {
    try { appDb.bulkRemoveTagFromFiles(filePaths, tagId); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-query-files-by-tags', (event, expression) => {
    try { return { success: true, data: appDb.queryFilesByTags(expression) }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-suggest-tags', (event, filePath) => {
    try { return { success: true, data: appDb.suggestTagsForFile(filePath) }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-export-tags', () => {
    try { return { success: true, data: appDb.exportTags() }; }
    catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('db-import-tags', (event, data) => {
    try { appDb.importTags(data); return { success: true }; }
    catch (e) { return { success: false, error: e.message }; }
});
