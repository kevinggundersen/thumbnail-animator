// Increase libuv threadpool for parallel stat() calls (must be before any async I/O)
process.env.UV_THREADPOOL_SIZE = '16';

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION:', err);
});

const { app, BrowserWindow, Menu, ipcMain, dialog, shell, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const DimensionWorkerPool = require('./worker-pool');
const ThumbnailWorkerPool = require('./thumbnail-pool');
const HashWorkerPool = require('./hash-pool');
const PluginRegistry = require('./plugins/plugin-registry');
// ClipWorkerPool removed — inference runs directly in the main process
// to avoid native module ABI issues in Electron worker threads.
let sizeOf;
try {
    const imageSizeModule = require('image-size');
    // image-size can export either a function directly or an object with imageSize method
    if (typeof imageSizeModule === 'function') {
        sizeOf = imageSizeModule;
    } else if (imageSizeModule && typeof imageSizeModule.imageSize === 'function') {
        sizeOf = imageSizeModule.imageSize;
    } else if (imageSizeModule && typeof imageSizeModule.default === 'function') {
        sizeOf = imageSizeModule.default;
    } else {
        sizeOf = imageSizeModule; // Try as-is
    }
} catch (error) {
    console.warn('image-size module not available:', error);
    sizeOf = null;
}
// const mime = require('mime-types'); // Removed unused dependency
const { execFile } = require('child_process');
const { performance } = require('perf_hooks');

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

async function readImageHeader(filePath, maxBytes = 512 * 1024) {
    const fd = await fs.promises.open(filePath, 'r');
    try {
        const buffer = Buffer.alloc(maxBytes);
        const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytesRead);
    } finally {
        await fd.close();
    }
}

// Detect ffprobe availability for reading video dimensions from file headers
let ffprobePath = null;
// Detect ffmpeg availability for video thumbnail generation
let ffmpegPath = null;
(function detectFfTools() {
    const { execFileSync } = require('child_process');
    // Check common locations on Windows, then fall back to PATH
    const probeCandidates = process.platform === 'win32'
        ? ['ffprobe', 'ffprobe.exe']
        : ['ffprobe'];
    for (const candidate of probeCandidates) {
        try {
            execFileSync(candidate, ['-version'], { stdio: 'ignore', timeout: 3000 });
            ffprobePath = candidate;
            console.log('ffprobe found:', candidate);
            break;
        } catch { /* not found, try next */ }
    }
    if (!ffprobePath) console.log('ffprobe not found — video dimensions will be detected on load');

    const mpegCandidates = process.platform === 'win32'
        ? ['ffmpeg', 'ffmpeg.exe']
        : ['ffmpeg'];
    for (const candidate of mpegCandidates) {
        try {
            execFileSync(candidate, ['-version'], { stdio: 'ignore', timeout: 3000 });
            ffmpegPath = candidate;
            console.log('ffmpeg found:', candidate);
            break;
        } catch { /* not found, try next */ }
    }
    if (!ffmpegPath) console.log('ffmpeg not found — video thumbnails will not be generated');
})();

// Worker pool for parallel dimension scanning
let dimensionPool = new DimensionWorkerPool(ffprobePath);

// Worker pool for thumbnail generation (off main process)
let thumbnailPool = new ThumbnailWorkerPool({ ffmpegPath, ffprobePath });
let hashPool = new HashWorkerPool();
// CLIP model state — loaded directly in main process (no worker threads)
let clipModel = null; // { visionModel, textModel, processor, tokenizer, RawImage, sharp }

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
            const seekTime = duration ? Math.min(duration * 0.25, 10) : 1;

            const result = await new Promise((resolve) => {
                execFile(ffmpegPath, [
                    '-ss', String(seekTime),
                    '-i', filePath,
                    '-vframes', '1',
                    '-q:v', '6',
                    '-vf', 'scale=320:-2',
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

// Initialize video thumbnail cache directory now that userDataPath is set
videoThumbDir = path.join(userDataPath, 'video-thumbnails');
imageThumbDir = path.join(userDataPath, 'image-thumbnails');

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
                
                // Check if window would be visible on any display (more lenient check)
                const displays = screen.getAllDisplays();
                let isValidPosition = false;
                
                for (const display of displays) {
                    const { x, y, width: dWidth, height: dHeight } = display.bounds;
                    // Allow window to be partially off-screen, just check if any part is visible
                    if (state.x < x + dWidth && state.x + state.width > x &&
                        state.y < y + dHeight && state.y + state.height > y) {
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

function saveWindowState(win) {
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
        
        fs.writeFileSync(windowStateFile, JSON.stringify(state, null, 2), 'utf8');
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
    
    // Save state when window is closed (clear timeout and save immediately)
    win.on('close', () => {
        clearTimeout(saveTimeout);
        saveWindowState(win);
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

app.whenReady().then(() => {
    const win = createWindow();

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

ipcMain.handle('trigger-gc', () => {
    if (global.gc) {
        global.gc();
        // console.log('GC Triggered');
    }
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

const IO_CONCURRENCY_LIMIT = 20;

// Core folder scan logic extracted for reuse by collections
async function scanFolderInternal(folderPath, options = {}) {
    const scanStart = performance.now();
    const { skipStats = false, scanImageDimensions = false, scanVideoDimensions = false,
            smartCollectionMode = false, skipDimensions = false } = options;
    const readdirStart = performance.now();
    const items = await fs.promises.readdir(folderPath, { withFileTypes: true });
    logPerf('scan-folder.readdir', readdirStart, { entries: items.length });

    // Use Sets for O(1) lookup — merged with any plugin-registered extensions
    const videoExtensions = pluginRegistry.getVideoExtensions();
    const imageExtensions = pluginRegistry.getImageExtensions();
    const supportedExtensions = pluginRegistry.getSupportedExtensions();

    const isWindows = process.platform === 'win32';

    // === Phase A: Build base objects (sync, fast) ===
    const folderItems = [];
    const fileObjs = [];

    for (const item of items) {
        if (item.isDirectory()) {
            // Smart collection mode: skip folders entirely (only files needed)
            if (!smartCollectionMode) {
                folderItems.push(item);
            }
        } else if (item.isFile()) {
            const name = item.name;
            const lastDot = name.lastIndexOf('.');
            if (lastDot === -1) continue;

            const ext = name.substring(lastDot).toLowerCase();
            if (!supportedExtensions.has(ext)) continue;

            const itemPath = path.join(folderPath, name);
            const isImage = imageExtensions.has(ext);
            fileObjs.push({
                name: name,
                path: itemPath,
                url: isWindows ? `file:///${itemPath.replace(/\\/g, '/')}` : `file://${itemPath}`,
                type: isImage ? 'image' : 'video',
                isImage: isImage,
                mtime: 0,
                size: 0,
                width: undefined,
                height: undefined
            });
        }
    }

    // === Phase B: Dimension scanning via worker pool (parallel across workers) ===
    // Skip when smartCollectionMode + skipDimensions (dimensions handled separately after pre-filtering)
    if (!skipDimensions) {
        const needsDimensionScan = (scanImageDimensions && sizeOf) || (scanVideoDimensions && ffprobePath);
        if (needsDimensionScan && dimensionPool) {
            const filesToScan = fileObjs.filter(f =>
                (f.isImage && scanImageDimensions) || (!f.isImage && scanVideoDimensions && ffprobePath)
            ).map(f => ({ path: f.path, isImage: f.isImage }));

            if (filesToScan.length > 0) {
                const dimensionStart = performance.now();
                const dimensionMap = await dimensionPool.scanDimensions(filesToScan);
                logPerf('scan-folder.dimensions', dimensionStart, { files: filesToScan.length, hits: dimensionMap.size });
                for (const fileObj of fileObjs) {
                    const dims = dimensionMap.get(fileObj.path);
                    if (dims) {
                        fileObj.width = dims.width;
                        fileObj.height = dims.height;
                    }
                }
            }
        }
    }

    // === Phase C: Batch stat() calls using Promise.all (libuv handles parallelism) ===
    const folders = [];

    if (skipStats) {
        // Fast path: no stat calls needed
        for (const item of folderItems) {
            folders.push({ name: item.name, path: path.join(folderPath, item.name), type: 'folder', mtime: 0 });
        }
    } else {
        // Smart collection mode: skip folder stats entirely
        if (!smartCollectionMode) {
            const folderStatStart = performance.now();
            const folderResults = await asyncPool(IO_CONCURRENCY_LIMIT, folderItems, async (item) => {
                const itemPath = path.join(folderPath, item.name);
                try {
                    const stats = await fs.promises.stat(itemPath);
                    return { name: item.name, path: itemPath, type: 'folder', mtime: stats.mtime.getTime() };
                } catch {
                    return { name: item.name, path: itemPath, type: 'folder', mtime: 0 };
                }
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
            } catch {
                // mtime stays 0
            }
        });
        logPerf('scan-folder.file-stats', fileStatStart, { count: fileObjs.length, limit: IO_CONCURRENCY_LIMIT });
    }

    // Clean up internal field before sending to renderer
    const mediaFiles = fileObjs.map(({ isImage, ...rest }) => rest);

    // Smart collection mode: skip sorting (renderer re-sorts after filtering)
    if (!smartCollectionMode) {
        if (folders.length > 1) {
            folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        }
        if (mediaFiles.length > 1) {
            mediaFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        }
    }

    logPerf('scan-folder.total', scanStart, { folders: folders.length, files: mediaFiles.length, skipStats: skipStats ? 1 : 0 });
    return { folders, mediaFiles };
}

ipcMain.handle('scan-folder', async (event, folderPath, options = {}) => {
    try {
        const { folders, mediaFiles } = await scanFolderInternal(folderPath, options);
        return folders.length + mediaFiles.length > 0 ? [...folders, ...mediaFiles] : [];
    } catch (error) {
        console.error('Error scanning folder:', error);
        return [];
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
    const needsDimensionScan = (scanImageDimensions && sizeOf) || (scanVideoDimensions && ffprobePath);
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

ipcMain.handle('scan-folders-for-smart-collection', async (event, folderEntries, options = {}, rules = null) => {
    const scanStart = performance.now();
    const errors = [];

    // Collect all folders to scan first, deduplicating overlapping paths
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

    // Phase 1: Scan all folders in parallel (readdir + stats, no dimensions yet)
    const smartOptions = { ...options, smartCollectionMode: true, skipDimensions: true };
    const sender = event.sender;
    let foldersScanned = 0;
    const totalFolders = allFoldersToScan.length;

    const folderResults = await asyncPool(FOLDER_SCAN_CONCURRENCY, allFoldersToScan, async (fp) => {
        try {
            const { mediaFiles } = await scanFolderInternal(fp, smartOptions);
            foldersScanned++;
            // Pre-filter this batch with cheap rules
            const filtered = rules ? mediaFiles.filter(f => matchesCheapRules(f, rules)) : mediaFiles;
            // Stream progress + file items to renderer for progressive rendering
            if (!sender.isDestroyed() && filtered.length > 0) {
                sender.send('smart-collection-scan-progress', {
                    foldersScanned, totalFolders,
                    items: filtered
                });
            } else if (!sender.isDestroyed()) {
                sender.send('smart-collection-scan-progress', {
                    foldersScanned, totalFolders
                });
            }
            return filtered; // return pre-filtered results (cheap rules already applied)
        } catch (error) {
            foldersScanned++;
            errors.push({ folder: fp, error: error.message });
            return [];
        }
    });

    let allFiles = [];
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

    // Phase 3: Dimension scan only the surviving files
    const needsDimensionScan = (options.scanImageDimensions || options.scanVideoDimensions) && dimensionPool;
    if (needsDimensionScan && allFiles.length > 0) {
        const filesToScan = allFiles.filter(f => {
            // Check main-process dimension cache first
            const cacheKey = `${f.path}|${f.mtime}`;
            const cached = dimensionCacheMain.get(cacheKey);
            if (cached) {
                f.width = cached.width;
                f.height = cached.height;
                return false;
            }
            return (f.type === 'image' && options.scanImageDimensions) ||
                   (f.type === 'video' && options.scanVideoDimensions && ffprobePath);
        }).map(f => ({ path: f.path, isImage: f.type === 'image' }));

        if (filesToScan.length > 0) {
            const dimensionStart = performance.now();
            const dimensionMap = await dimensionPool.scanDimensions(filesToScan);
            logPerf('smart-collection.dimensions', dimensionStart, { scanned: filesToScan.length, hits: dimensionMap.size });

            for (const fileObj of allFiles) {
                const dims = dimensionMap.get(fileObj.path);
                if (dims) {
                    fileObj.width = dims.width;
                    fileObj.height = dims.height;
                    // Populate dimension cache
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

    logPerf('smart-collection.total', scanStart, { folders: allFoldersToScan.length, files: allFiles.length });
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
        return { success: true, newPath };
    } catch (error) {
        console.error('Error renaming file:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('delete-file', async (event, filePath) => {
    try {
        await shell.trashItem(filePath);
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
        if (isImage && sizeOf) {
            try {
                const fileBuffer = await readImageHeader(filePath);
                if (fileBuffer.length > 0) {
                    const dimensions = sizeOf(fileBuffer);
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
ipcMain.handle('copy-file', async (event, sourcePath, destFolderOrPath, fileName) => {
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
            const baseName = path.basename(destPath);
            const win = BrowserWindow.fromWebContents(event.sender);
            const { response } = await dialog.showMessageBox(win, {
                type: 'question',
                buttons: ['Replace', 'Keep Both', 'Skip'],
                defaultId: 2,
                cancelId: 2,
                title: 'File Already Exists',
                message: `"${baseName}" already exists in this location.`,
                detail: 'Would you like to replace the existing file, keep both files, or skip this file?'
            });
            if (response === 2) {
                // Skip
                return { success: true, skipped: true };
            } else if (response === 1) {
                // Keep Both — auto-rename
                const ext = path.extname(destPath);
                const base = path.basename(destPath, ext);
                const dir = path.dirname(destPath);
                let counter = 2;
                while (fs.existsSync(finalPath)) {
                    finalPath = path.join(dir, `${base} (${counter})${ext}`);
                    counter++;
                }
            }
            // response === 0: Replace — use original finalPath
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
ipcMain.handle('move-file', async (event, sourcePath, destFolderOrPath, fileName) => {
    try {
        const destPath = fileName
            ? path.join(destFolderOrPath, fileName)
            : destFolderOrPath;
        // Ensure destination directory exists
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
            await fs.promises.mkdir(destDir, { recursive: true });
        }

        let finalPath = destPath;
        // Check if destination already exists — show conflict dialog (same as copy)
        if (fs.existsSync(destPath) && path.normalize(sourcePath) !== path.normalize(destPath)) {
            const baseName = path.basename(destPath);
            const win = BrowserWindow.fromWebContents(event.sender);
            const { response } = await dialog.showMessageBox(win, {
                type: 'question',
                buttons: ['Replace', 'Keep Both', 'Skip'],
                defaultId: 2,
                cancelId: 2,
                title: 'File Already Exists',
                message: `"${baseName}" already exists in this location.`,
                detail: 'Would you like to replace the existing file, keep both files, or skip this file?'
            });
            if (response === 2) {
                return { success: true, skipped: true };
            } else if (response === 1) {
                const ext = path.extname(destPath);
                const base = path.basename(destPath, ext);
                const dir = path.dirname(destPath);
                let counter = 2;
                while (fs.existsSync(finalPath)) {
                    finalPath = path.join(dir, `${base} (${counter})${ext}`);
                    counter++;
                }
            }
            // response === 0: Replace — delete existing then move
            if (response === 0) {
                await fs.promises.unlink(destPath);
            }
        }

        await fs.promises.rename(sourcePath, finalPath);
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
            depth: 99, // Watch recursively up to 99 levels deep
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

        // Wait for watcher to be ready before returning success
        try {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Watcher initialization timeout'));
                }, 10000); // 10 second timeout

                watcher.on('ready', () => {
                    clearTimeout(timeout);
                    resolve();
                });

                watcher.on('error', (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });
        } catch (initError) {
            // Clean up the watcher if initialization failed to prevent zombie watchers
            await watcher.close().catch(() => {});
            throw initError;
        }

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
        const result = await thumbnailPool.generate({ type: 'video', filePath, thumbPath });
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

// Generate an image thumbnail via worker pool (returns file:// URL to cached PNG or null)
ipcMain.handle('generate-image-thumbnail', async (event, filePath, maxSize = 512) => {
    const startTime = performance.now();
    try {
        if (!thumbnailPool) return { success: false };
        const stats = await fs.promises.stat(filePath);
        const thumbPath = getImageThumbCachePath(filePath, stats.mtimeMs, maxSize);
        const result = await thumbnailPool.generate({ type: 'image', filePath, thumbPath, maxSize });
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

// Batch thumbnail generation -- reduces IPC round-trips for large folders
// items: Array<{ filePath, type: 'image'|'video', maxSize? }>
// Returns: Array<{ filePath, success, url? }>
ipcMain.handle('generate-thumbnails-batch', async (event, items) => {
    const startTime = performance.now();
    try {
        if (!thumbnailPool || !Array.isArray(items) || items.length === 0) {
            return [];
        }

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

        const results = await thumbnailPool.generateBatch(validItems);

        // Merge results back, preserving original order
        const resultMap = new Map();
        validItems.forEach((item, i) => {
            const r = results[i];
            resultMap.set(item.filePath, {
                filePath: item.filePath,
                success: r && r.success,
                url: r && r.success && r.thumbPath ? pathToFileUrl(r.thumbPath) : null
            });
        });
        for (const item of invalidItems) {
            resultMap.set(item.filePath, { filePath: item.filePath, success: false, url: null });
        }

        const output = items.map(item => resultMap.get(item.filePath) || { filePath: item.filePath, success: false, url: null });
        logPerf('generate-thumbnails-batch', startTime, { count: items.length, success: output.filter(r => r.success).length });
        return output;
    } catch (error) {
        logPerf('generate-thumbnails-batch', startTime, { error: 1 });
        return items.map(item => ({ filePath: item.filePath, success: false, url: null }));
    }
});

ipcMain.handle('scan-file-dimensions', async (event, files) => {
    const startTime = performance.now();
    try {
        if (!dimensionPool || !Array.isArray(files) || files.length === 0) {
            logPerf('scan-file-dimensions', startTime, { files: 0, hits: 0 });
            return [];
        }

        const sanitizedFiles = files.filter(file =>
            file &&
            typeof file.path === 'string' &&
            typeof file.isImage === 'boolean'
        );
        if (sanitizedFiles.length === 0) {
            logPerf('scan-file-dimensions', startTime, { files: 0, hits: 0 });
            return [];
        }

        const dimensionMap = await dimensionPool.scanDimensions(sanitizedFiles);
        const results = sanitizedFiles.map(file => {
            const dims = dimensionMap.get(file.path);
            return {
                path: file.path,
                width: dims ? dims.width : undefined,
                height: dims ? dims.height : undefined
            };
        });

        logPerf('scan-file-dimensions', startTime, { files: sanitizedFiles.length, hits: dimensionMap.size });
        return results;
    } catch (error) {
        logPerf('scan-file-dimensions', startTime, { error: 1 });
        return [];
    }
});

// ==================== DUPLICATE DETECTION ====================

function hammingDistance(hex1, hex2) {
    const b1 = BigInt('0x' + hex1);
    const b2 = BigInt('0x' + hex2);
    let xor = b1 ^ b2;
    let dist = 0;
    while (xor > 0n) {
        dist += Number(xor & 1n);
        xor >>= 1n;
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

        const hashMap = await hashPool.scanHashes(files, (completed, total) => {
            event.sender.send('duplicate-scan-progress', { current: completed, total, phase: 'hashing' });
        });

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

        // Union-find grouping for perceptual similarity
        const parent = new Map();
        const find = (x) => {
            if (!parent.has(x)) parent.set(x, x);
            if (parent.get(x) !== x) parent.set(x, find(parent.get(x)));
            return parent.get(x);
        };
        const union = (a, b) => {
            const ra = find(a);
            const rb = find(b);
            if (ra !== rb) parent.set(ra, rb);
        };

        for (let i = 0; i < perceptualFiles.length; i++) {
            for (let j = i + 1; j < perceptualFiles.length; j++) {
                const dist = hammingDistance(perceptualFiles[i].perceptualHash, perceptualFiles[j].perceptualHash);
                if (dist <= threshold) {
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

        event.sender.send('duplicate-scan-progress', { current: 0, total: 0, phase: 'done' });

        return { exactGroups, similarGroups };
    } catch (error) {
        console.error('Error scanning duplicates:', error);
        return { exactGroups: [], similarGroups: [], error: error.message };
    }
});

ipcMain.handle('delete-files-batch', async (event, filePaths) => {
    const deleted = [];
    const failed = [];
    for (const filePath of filePaths) {
        try {
            await shell.trashItem(filePath);
            deleted.push(filePath);
        } catch (error) {
            failed.push({ path: filePath, error: error.message });
        }
    }
    return { deleted, failed };
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

        const savedReleaseName = process.release.name;
        process.release = { ...process.release, name: 'electron' };

        const transformers = require('@xenova/transformers');

        process.release = { ...process.release, name: savedReleaseName };

        const { env, CLIPVisionModelWithProjection, CLIPTextModelWithProjection,
                AutoProcessor, AutoTokenizer, RawImage } = transformers;

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

        clipModel = { visionModel, textModel, processor, tokenizer, RawImage };
        return { success: true };
    } catch (err) {
        clipModel = null;
        console.error('clip-init error:', err);
        return { success: false, error: err.message };
    }
});

// Helper: embed a single image file
// Uses Electron's nativeImage for preprocessing (sharp can't load in the main process).
// CLIP ViT-B/32 normalization constants (ImageNet)
const CLIP_MEAN = [0.48145466, 0.4578275, 0.40821073];
const CLIP_STD  = [0.26862954, 0.26130258, 0.27577711];
const CLIP_SIZE = 224;

async function clipEmbedOneImage(filePath) {
    const { visionModel } = clipModel;

    // 1. Load with Electron's nativeImage (supports JPG, PNG, BMP, GIF, WebP)
    let img = nativeImage.createFromPath(filePath);
    if (img.isEmpty()) return null;

    const { width, height } = img.getSize();

    // 2. Resize (cover) + centre-crop to 224x224
    const scale = Math.max(CLIP_SIZE / width, CLIP_SIZE / height);
    const scaledW = Math.ceil(width * scale);
    const scaledH = Math.ceil(height * scale);
    img = img.resize({ width: scaledW, height: scaledH, quality: 'good' });

    const cropX = Math.max(0, Math.floor((scaledW - CLIP_SIZE) / 2));
    const cropY = Math.max(0, Math.floor((scaledH - CLIP_SIZE) / 2));
    img = img.crop({ x: cropX, y: cropY, width: CLIP_SIZE, height: CLIP_SIZE });

    // 3. Get BGRA bitmap → build normalised float32 CHW tensor (no processor needed)
    const bitmap = img.toBitmap(); // BGRA, 4 bytes/pixel
    const pixels = CLIP_SIZE * CLIP_SIZE;
    const tensor = new Float32Array(3 * pixels);

    for (let i = 0; i < pixels; i++) {
        const r = bitmap[i * 4 + 2] / 255; // BGRA → R
        const g = bitmap[i * 4 + 1] / 255; // BGRA → G
        const b = bitmap[i * 4]     / 255; // BGRA → B
        tensor[i]               = (r - CLIP_MEAN[0]) / CLIP_STD[0]; // R plane
        tensor[pixels + i]      = (g - CLIP_MEAN[1]) / CLIP_STD[1]; // G plane
        tensor[2 * pixels + i]  = (b - CLIP_MEAN[2]) / CLIP_STD[2]; // B plane
    }

    // 4. Run vision model directly — bypass processor (which uses OffscreenCanvas and crashes)
    const ort = require('onnxruntime-web');
    const inputTensor = new ort.Tensor('float32', tensor, [1, 3, CLIP_SIZE, CLIP_SIZE]);
    const inputName = visionModel.session.inputNames[0];
    const output = await visionModel.session.run({ [inputName]: inputTensor });
    const outputName = visionModel.session.outputNames[0];
    const raw = output[outputName].data;

    // 5. L2-normalise
    let mag = 0;
    for (let i = 0; i < raw.length; i++) mag += raw[i] * raw[i];
    mag = Math.sqrt(mag) || 1;
    const out = new Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw[i] / mag;

    return out;
}

ipcMain.handle('clip-embed-images', async (event, files) => {
    if (!clipModel) return [];
    const results = [];
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const result = { path: file.path, embedding: null };
        try {
            const source = (file.thumbPath && fs.existsSync(file.thumbPath))
                ? file.thumbPath : file.path;
            result.embedding = await clipEmbedOneImage(source);
        } catch (err) {
            console.error('clip-embed image error:', file.path, err.message);
        }
        results.push(result);
        try {
            event.sender.send('clip-progress', { current: i + 1, total: files.length, phase: 'embedding' });
        } catch { /* window closed */ }
    }
    return results;
});

ipcMain.handle('clip-embed-text', async (event, text) => {
    if (!clipModel) return null;
    try {
        const { tokenizer, textModel } = clipModel;

        // Tokenize
        const inputs = tokenizer(text, { padding: true, truncation: true });

        // Bypass textModel._call() — use session.run() directly (same fix as images)
        const ort = require('onnxruntime-web');
        const feeds = {};
        for (const name of textModel.session.inputNames) {
            const t = inputs[name];
            if (t) feeds[name] = new ort.Tensor('int64', t.data, t.dims);
        }

        const output = await textModel.session.run(feeds);
        const raw = output.text_embeds.data;

        // L2-normalise
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
    return { loaded: !!clipModel };
});

ipcMain.handle('clip-terminate', async () => {
    clipModel = null;
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
app.on('before-quit', async () => {
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
    for (const [folderPath, watcher] of watchedFolders) {
        try {
            await watcher.close();
        } catch (error) {
            console.error(`Error closing watcher for ${folderPath}:`, error);
        }
    }
    watchedFolders.clear();
});

