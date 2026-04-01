const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Track the current listener per IPC channel to allow precise removal
let _windowMinimizedCb = null;
let _windowRestoredCb = null;
let _folderChangedCb = null;
let _duplicateScanProgressCb = null;
let _clipProgressCb = null;
let _clipDownloadProgressCb = null;

contextBridge.exposeInMainWorld('electronAPI', {
    getPathForFile: (file) => webUtils.getPathForFile(file),
    selectFolder: (defaultPath) => ipcRenderer.invoke('select-folder', defaultPath),
    scanFolder: (path, options) => ipcRenderer.invoke('scan-folder', path, options),
    triggerGC: () => ipcRenderer.invoke('trigger-gc'),
    revealInExplorer: (filePath) => ipcRenderer.invoke('reveal-in-explorer', filePath),
    renameFile: (filePath, newName) => ipcRenderer.invoke('rename-file', filePath, newName),
    deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
    openUrl: (url) => ipcRenderer.invoke('open-url', url),
    openWithDefault: (filePath) => ipcRenderer.invoke('open-with-default', filePath),
    openWith: (filePath) => ipcRenderer.invoke('open-with', filePath),
    getDrives: () => ipcRenderer.invoke('get-drives'),
    listSubdirectories: (folderPath) => ipcRenderer.invoke('list-subdirectories', folderPath),
    onWindowMinimized: (callback) => {
        _windowMinimizedCb = callback;
        ipcRenderer.on('window-minimized', callback);
    },
    onWindowRestored: (callback) => {
        _windowRestoredCb = callback;
        ipcRenderer.on('window-restored', callback);
    },
    removeWindowMinimizedListener: () => {
        if (_windowMinimizedCb) {
            ipcRenderer.removeListener('window-minimized', _windowMinimizedCb);
            _windowMinimizedCb = null;
        }
    },
    removeWindowRestoredListener: () => {
        if (_windowRestoredCb) {
            ipcRenderer.removeListener('window-restored', _windowRestoredCb);
            _windowRestoredCb = null;
        }
    },
    // New IPC handlers
    getFileInfo: (filePath) => ipcRenderer.invoke('get-file-info', filePath),
    createFolder: (folderPath, folderName) => ipcRenderer.invoke('create-folder', folderPath, folderName),
    moveFile: (sourcePath, destFolder, fileName) => ipcRenderer.invoke('move-file', sourcePath, destFolder, fileName),
    copyFile: (sourcePath, destFolder, fileName) => ipcRenderer.invoke('copy-file', sourcePath, destFolder, fileName),
    watchFolder: (folderPath) => ipcRenderer.invoke('watch-folder', folderPath),
    unwatchFolder: (folderPath) => ipcRenderer.invoke('unwatch-folder', folderPath),
    onFolderChanged: (callback) => {
        _folderChangedCb = callback;
        ipcRenderer.on('folder-changed', callback);
    },
    removeFolderChangedListener: () => {
        if (_folderChangedCb) {
            ipcRenderer.removeListener('folder-changed', _folderChangedCb);
            _folderChangedCb = null;
        }
    },
    generateVideoThumbnail: (filePath) => ipcRenderer.invoke('generate-video-thumbnail', filePath),
    generateImageThumbnail: (filePath, maxSize) => ipcRenderer.invoke('generate-image-thumbnail', filePath, maxSize),
    scanFileDimensions: (files) => ipcRenderer.invoke('scan-file-dimensions', files),
    hasFfmpeg: () => ipcRenderer.invoke('has-ffmpeg'),
    generateThumbnailBatch: (items) => ipcRenderer.invoke('generate-thumbnails-batch', items),
    // Duplicate detection
    scanDuplicates: (folderPath, options) => ipcRenderer.invoke('scan-duplicates', folderPath, options),
    deleteFilesBatch: (filePaths) => ipcRenderer.invoke('delete-files-batch', filePaths),
    onDuplicateScanProgress: (callback) => {
        _duplicateScanProgressCb = callback;
        ipcRenderer.on('duplicate-scan-progress', callback);
    },
    removeDuplicateScanProgressListener: () => {
        if (_duplicateScanProgressCb) {
            ipcRenderer.removeListener('duplicate-scan-progress', _duplicateScanProgressCb);
            _duplicateScanProgressCb = null;
        }
    },
    toggleMenuBar: () => ipcRenderer.send('toggle-menu-bar'),
    updateTitleBarOverlay: (overlay) => ipcRenderer.send('update-titlebar-overlay', overlay),
    // AI Visual Search (CLIP)
    clipCheckCache: () => ipcRenderer.invoke('clip-check-cache'),
    clipInit: () => ipcRenderer.invoke('clip-init'),
    clipEmbedImages: (files) => ipcRenderer.invoke('clip-embed-images', files),
    clipEmbedText: (text) => ipcRenderer.invoke('clip-embed-text', text),
    clipStatus: () => ipcRenderer.invoke('clip-status'),
    clipTerminate: () => ipcRenderer.invoke('clip-terminate'),
    onClipProgress: (callback) => {
        _clipProgressCb = callback;
        ipcRenderer.on('clip-progress', callback);
    },
    removeClipProgressListener: () => {
        if (_clipProgressCb) {
            ipcRenderer.removeListener('clip-progress', _clipProgressCb);
            _clipProgressCb = null;
        }
    },
    onClipDownloadProgress: (callback) => {
        _clipDownloadProgressCb = callback;
        ipcRenderer.on('clip-download-progress', callback);
    },
    removeClipDownloadProgressListener: () => {
        if (_clipDownloadProgressCb) {
            ipcRenderer.removeListener('clip-download-progress', _clipDownloadProgressCb);
            _clipDownloadProgressCb = null;
        }
    }
});
