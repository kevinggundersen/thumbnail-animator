const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
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
        autoHideMenuBar: true // Hide menu bar by default, show with Alt key
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
    return result.filePaths[0];
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

ipcMain.handle('scan-folder', async (event, folderPath, options = {}) => {
    try {
        const { skipStats = false, scanImageDimensions = false } = options; // Skip stats if sorting by name, optionally scan image dimensions
        const items = await fs.promises.readdir(folderPath, { withFileTypes: true });
        
        // Use Sets for O(1) lookup instead of O(n) array.includes()
        const videoExtensions = new Set(['.mp4', '.webm', '.ogg', '.mov']);
        const imageExtensions = new Set(['.gif', '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.svg']);
        const supportedExtensions = new Set([...videoExtensions, ...imageExtensions]);

        const folders = [];
        const mediaFiles = [];
        
        // Pre-compute folder path separator for URL conversion
        const isWindows = process.platform === 'win32';
        const urlSeparator = '/';

        // Separate items into folders and files first (no async operations)
        const folderItems = [];
        const fileItems = [];
        
        for (const item of items) {
            if (item.isDirectory()) {
                folderItems.push(item);
            } else if (item.isFile()) {
                // Fast extension check using Set
                const name = item.name;
                const lastDot = name.lastIndexOf('.');
                if (lastDot === -1) continue; // No extension, skip
                
                const ext = name.substring(lastDot).toLowerCase();
                if (!supportedExtensions.has(ext)) continue; // Not a supported extension, skip
                
                fileItems.push(item);
            }
        }
        
        // Process folders with concurrency limit (skip stats if not needed)
        const folderResultsPromise = asyncPool(IO_CONCURRENCY_LIMIT, folderItems, async (item) => {
            const itemPath = path.join(folderPath, item.name);
            if (skipStats) {
                // Skip stat call for faster loading when sorting by name
                return {
                    name: item.name,
                    path: itemPath,
                    type: 'folder',
                    mtime: 0
                };
            }
            try {
                const stats = await fs.promises.stat(itemPath);
                return {
                    name: item.name,
                    path: itemPath,
                    type: 'folder',
                    mtime: stats.mtime.getTime()
                };
            } catch (error) {
                // If stat fails, still add folder without date
                return {
                    name: item.name,
                    path: itemPath,
                    type: 'folder',
                    mtime: 0
                };
            }
        });
        
        // Process files with optimized batching for dimension scanning
        // Batch size for dimension scanning to avoid overwhelming the system
        const DIMENSION_SCAN_BATCH_SIZE = 20; // Process 20 images at a time for dimensions
        
        const processFile = async (item) => {
            const name = item.name;
            const itemPath = path.join(folderPath, name);
            const url = isWindows 
                ? `file:///${itemPath.replace(/\\/g, '/')}` 
                : `file://${itemPath}`;
            
            const lastDot = name.lastIndexOf('.');
            const ext = name.substring(lastDot).toLowerCase();
            const isImage = imageExtensions.has(ext);
            
            // Base file object
            const fileObj = {
                name: name,
                path: itemPath,
                url: url,
                type: isImage ? 'image' : 'video',
                mtime: 0,
                width: undefined,
                height: undefined
            };
            
            // Get image dimensions if requested and file is an image
            // This is done in batches to avoid overwhelming the system
            if (scanImageDimensions && isImage && sizeOf) {
                try {
                    let dimensions;
                    if (typeof sizeOf === 'function') {
                        dimensions = sizeOf(itemPath);
                    } else if (sizeOf.imageSize && typeof sizeOf.imageSize === 'function') {
                        dimensions = sizeOf.imageSize(itemPath);
                    }
                    if (dimensions && dimensions.width && dimensions.height) {
                        fileObj.width = dimensions.width;
                        fileObj.height = dimensions.height;
                    }
                } catch (error) {
                    // If dimension scan fails, continue without dimensions
                    // This can happen with corrupted images or unsupported formats
                }
            }
            
            if (skipStats) {
                // Skip stat call for faster loading when sorting by name
                return fileObj;
            }
            
            try {
                const stats = await fs.promises.stat(itemPath);
                fileObj.mtime = stats.mtime.getTime();
                return fileObj;
            } catch (error) {
                // If stat fails, still add file without date
                return fileObj;
            }
        };
        
        // Process files with batched dimension scanning for better performance
        let fileResults = [];
        if (scanImageDimensions && fileItems.length > DIMENSION_SCAN_BATCH_SIZE) {
            // For large folders with dimension scanning, process in batches
            const imageItems = [];
            const nonImageItems = [];
            
            // Separate images from other files
            for (const item of fileItems) {
                const name = item.name;
                const lastDot = name.lastIndexOf('.');
                const ext = lastDot !== -1 ? name.substring(lastDot).toLowerCase() : '';
                if (imageExtensions.has(ext)) {
                    imageItems.push(item);
                } else {
                    nonImageItems.push(item);
                }
            }
            
            // Process non-image files immediately (no dimension scanning needed)
            const nonImagePromises = nonImageItems.map(processFile);
            
            // Process images in batches to avoid overwhelming the system
            const imageResults = [];
            for (let i = 0; i < imageItems.length; i += DIMENSION_SCAN_BATCH_SIZE) {
                const batch = imageItems.slice(i, i + DIMENSION_SCAN_BATCH_SIZE);
                const batchPromises = batch.map(processFile);
                const batchResults = await Promise.all(batchPromises);
                imageResults.push(...batchResults);
                
                // Small delay between batches to keep UI responsive
                if (i + DIMENSION_SCAN_BATCH_SIZE < imageItems.length) {
                    await new Promise(resolve => setImmediate(resolve));
                }
            }
            
            // Combine results maintaining original order
            let imageIndex = 0;
            let nonImageIndex = 0;
            const nonImageResults = await Promise.all(nonImagePromises);
            
            for (const item of fileItems) {
                const name = item.name;
                const lastDot = name.lastIndexOf('.');
                const ext = lastDot !== -1 ? name.substring(lastDot).toLowerCase() : '';
                if (imageExtensions.has(ext)) {
                    fileResults.push(imageResults[imageIndex++]);
                } else {
                    fileResults.push(nonImageResults[nonImageIndex++]);
                }
            }
        } else {
            // For smaller folders or when not scanning dimensions, process with concurrency limit
            fileResults = await asyncPool(IO_CONCURRENCY_LIMIT, fileItems, processFile);
        }
        
        // Wait for all folder operations to complete
        const folderResults = await folderResultsPromise;
        
        folders.push(...folderResults);
        mediaFiles.push(...fileResults);

        // Note: Sorting will be done client-side based on user preferences
        // Default alphabetical sorting kept for backward compatibility
        if (folders.length > 1) {
            folders.sort((a, b) => a.name.localeCompare(b.name));
        }
        if (mediaFiles.length > 1) {
            mediaFiles.sort((a, b) => a.name.localeCompare(b.name));
        }

        // Return folders first, then media files
        return folders.length + mediaFiles.length > 0 ? [...folders, ...mediaFiles] : [];
    } catch (error) {
        console.error('Error scanning folder:', error);
        return [];
    }
});

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
        await fs.promises.unlink(filePath);
        return { success: true };
    } catch (error) {
        console.error('Error deleting file:', error);
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
            // On Windows, use exec with cmd /c start to launch rundll32
            const { exec } = require('child_process');
            
            // Ensure we have an absolute path
            const absolutePath = path.resolve(filePath);
            
            // Verify the file exists
            if (!fs.existsSync(absolutePath)) {
                console.error('File does not exist:', absolutePath);
                return { success: false, error: 'File does not exist' };
            }
            
            console.log('Opening "Open With" dialog for:', absolutePath);
            
            // Escape the path properly - double quotes for cmd.exe
            const escapedPath = absolutePath.replace(/"/g, '""');
            
            // Build the rundll32 command
            const command = `rundll32.exe shell32.dll,OpenAs_RunDLL "${escapedPath}"`;
            
            console.log('Executing command:', command);
            console.log('File path:', absolutePath);
            console.log('File exists:', fs.existsSync(absolutePath));
            
            // Execute the command directly
            exec(command, {
                windowsVerbatimArguments: false,
                shell: true,
                cwd: path.dirname(absolutePath) // Set working directory to file's directory
            }, (error, stdout, stderr) => {
                if (error) {
                    console.error('Error executing open-with command:', error);
                    console.error('Error code:', error.code);
                    console.error('Error signal:', error.signal);
                }
                if (stdout) {
                    console.log('stdout:', stdout);
                }
                if (stderr) {
                    console.log('stderr:', stderr);
                }
            });
            
            return { success: true };
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

// File watching
let chokidar = null;
try {
    chokidar = require('chokidar');
} catch (error) {
    console.warn('chokidar not available, file watching disabled');
}
const watchedFolders = new Map(); // Map<folderPath, watcher>

// Extract ComfyUI workflow from PNG file
function extractComfyUIWorkflow(filePath) {
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
    try {
        const stats = await fs.promises.stat(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const isVideo = ['.mp4', '.webm', '.ogg', '.mov'].includes(ext);
        const isImage = ['.gif', '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.svg'].includes(ext);
        
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
        
        // Get dimensions for images
        if (isImage && sizeOf) {
            try {
                // Check if file exists and is readable
                if (!fs.existsSync(filePath)) {
                    console.warn('File does not exist:', filePath);
                } else {
                    let dimensions = null;
                    
                    // For image-size v2.x, try file path first (simpler and more reliable)
                    if (typeof sizeOf === 'function') {
                        try {
                            // Try file path first (most reliable for v2.x)
                            dimensions = sizeOf(filePath);
                        } catch (pathError) {
                            // If path fails, try with buffer
                            try {
                                const fileBuffer = fs.readFileSync(filePath);
                                if (Buffer.isBuffer(fileBuffer)) {
                                    dimensions = sizeOf(fileBuffer);
                                }
                            } catch (bufferError) {
                                console.warn('Both path and buffer methods failed for image-size:', pathError.message);
                            }
                        }
                    } else if (sizeOf && typeof sizeOf.imageSize === 'function') {
                        try {
                            dimensions = sizeOf.imageSize(filePath);
                        } catch (pathError) {
                            try {
                                const fileBuffer = fs.readFileSync(filePath);
                                if (Buffer.isBuffer(fileBuffer)) {
                                    dimensions = sizeOf.imageSize(fileBuffer);
                                }
                            } catch (bufferError) {
                                console.warn('imageSize method failed');
                            }
                        }
                    } else if (sizeOf && typeof sizeOf.default === 'function') {
                        try {
                            dimensions = sizeOf.default(filePath);
                        } catch (pathError) {
                            try {
                                const fileBuffer = fs.readFileSync(filePath);
                                if (Buffer.isBuffer(fileBuffer)) {
                                    dimensions = sizeOf.default(fileBuffer);
                                }
                            } catch (bufferError) {
                                console.warn('default method failed');
                            }
                        }
                    }
                    
                    if (dimensions && dimensions.width && dimensions.height) {
                        info.width = dimensions.width;
                        info.height = dimensions.height;
                    }
                }
            } catch (error) {
                // Silently fail - dimensions are optional, don't break the entire request
                console.warn('Could not get image dimensions:', error.message);
            }
        }
        
        // Extract ComfyUI workflow data for PNG images
        if (ext === '.png') {
            try {
                const workflowData = extractComfyUIWorkflow(filePath);
                if (workflowData) {
                    info.comfyUIWorkflow = workflowData;
                    console.log(`ComfyUI workflow found in ${path.basename(filePath)}: key="${workflowData.key}"`);
                } else {
                    console.log(`No ComfyUI workflow found in ${path.basename(filePath)}`);
                }
            } catch (error) {
                // Log error for debugging
                console.warn('Could not extract ComfyUI workflow:', error.message);
                console.error(error);
            }
        }
        
        return { success: true, info };
    } catch (error) {
        console.error('Error getting file info:', error);
        return { success: false, error: error.message };
    }
});

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Create folder
ipcMain.handle('create-folder', async (event, folderPath, folderName) => {
    try {
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

// Move file
ipcMain.handle('move-file', async (event, sourcePath, destPath) => {
    try {
        // Ensure destination directory exists
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) {
            await fs.promises.mkdir(destDir, { recursive: true });
        }
        
        // Check if destination already exists
        if (fs.existsSync(destPath)) {
            return { success: false, error: 'Destination file already exists' };
        }
        
        await fs.promises.rename(sourcePath, destPath);
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
        
        // Stop existing watcher if any
        if (watchedFolders.has(folderPath)) {
            const watcher = watchedFolders.get(folderPath);
            await watcher.close();
        }
        
        // Normalize path for consistent comparison
        const normalizedPath = path.normalize(folderPath);
        
        const watcher = chokidar.watch(normalizedPath, {
            ignored: /(^|[\/\\])\../, // ignore dotfiles
            persistent: true,
            ignoreInitial: true,
            depth: 99, // Watch recursively up to 99 levels deep
            awaitWriteFinish: {
                stabilityThreshold: 100, // Wait 100ms after file stops changing
                pollInterval: 100 // Check every 100ms
            },
            // Better Windows support
            usePolling: process.platform === 'win32', // Use polling on Windows for better reliability
            interval: process.platform === 'win32' ? 300 : 100 // Poll interval for Windows
        });
        
        // Wait for watcher to be ready before returning success
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
        
        watcher.on('all', (event, filePath) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                // Normalize the file path for consistent comparison
                const normalizedFilePath = path.normalize(filePath);
                mainWindow.webContents.send('folder-changed', { folderPath: normalizedPath, event, filePath: normalizedFilePath });
            }
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
            await watcher.close();
            watchedFolders.delete(normalizedPath);
        }
        return { success: true };
    } catch (error) {
        console.error('Error unwatching folder:', error);
        return { success: false, error: error.message };
    }
});

// Cleanup watchers on app quit
app.on('before-quit', async () => {
    for (const [folderPath, watcher] of watchedFolders) {
        try {
            await watcher.close();
        } catch (error) {
            console.error(`Error closing watcher for ${folderPath}:`, error);
        }
    }
    watchedFolders.clear();
});

