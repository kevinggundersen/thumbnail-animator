const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getPathForFile: (file) => webUtils.getPathForFile(file),
    selectFolder: (defaultPath) => ipcRenderer.invoke('select-folder', defaultPath),
    scanFolder: (path, options) => ipcRenderer.invoke('scan-folder', path, options),
    triggerGC: () => ipcRenderer.invoke('trigger-gc'),
    revealInExplorer: (filePath) => ipcRenderer.invoke('reveal-in-explorer', filePath),
    renameFile: (filePath, newName) => ipcRenderer.invoke('rename-file', filePath, newName),
    deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
    openWithDefault: (filePath) => ipcRenderer.invoke('open-with-default', filePath),
    openWith: (filePath) => ipcRenderer.invoke('open-with', filePath),
    getDrives: () => ipcRenderer.invoke('get-drives'),
    listSubdirectories: (folderPath) => ipcRenderer.invoke('list-subdirectories', folderPath),
    onWindowMinimized: (callback) => ipcRenderer.on('window-minimized', callback),
    onWindowRestored: (callback) => ipcRenderer.on('window-restored', callback),
    removeWindowMinimizedListener: () => ipcRenderer.removeAllListeners('window-minimized'),
    removeWindowRestoredListener: () => ipcRenderer.removeAllListeners('window-restored'),
    // New IPC handlers
    getFileInfo: (filePath) => ipcRenderer.invoke('get-file-info', filePath),
    createFolder: (folderPath, folderName) => ipcRenderer.invoke('create-folder', folderPath, folderName),
    moveFile: (sourcePath, destFolder, fileName) => ipcRenderer.invoke('move-file', sourcePath, destFolder, fileName),
    copyFile: (sourcePath, destFolder, fileName) => ipcRenderer.invoke('copy-file', sourcePath, destFolder, fileName),
    watchFolder: (folderPath) => ipcRenderer.invoke('watch-folder', folderPath),
    unwatchFolder: (folderPath) => ipcRenderer.invoke('unwatch-folder', folderPath),
    onFolderChanged: (callback) => ipcRenderer.on('folder-changed', callback),
    removeFolderChangedListener: () => ipcRenderer.removeAllListeners('folder-changed'),
    generateVideoThumbnail: (filePath) => ipcRenderer.invoke('generate-video-thumbnail', filePath),
    generateImageThumbnail: (filePath, maxSize) => ipcRenderer.invoke('generate-image-thumbnail', filePath, maxSize),
    scanFileDimensions: (files) => ipcRenderer.invoke('scan-file-dimensions', files),
    hasFfmpeg: () => ipcRenderer.invoke('has-ffmpeg'),
    generateThumbnailBatch: (items) => ipcRenderer.invoke('generate-thumbnails-batch', items)
});
