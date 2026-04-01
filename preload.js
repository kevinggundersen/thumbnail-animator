const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
    generateThumbnailBatch: (items) => ipcRenderer.invoke('generate-thumbnails-batch', items),
    // Duplicate detection
    scanDuplicates: (folderPath, options) => ipcRenderer.invoke('scan-duplicates', folderPath, options),
    deleteFilesBatch: (filePaths) => ipcRenderer.invoke('delete-files-batch', filePaths),
    onDuplicateScanProgress: (callback) => ipcRenderer.on('duplicate-scan-progress', callback),
    removeDuplicateScanProgressListener: () => ipcRenderer.removeAllListeners('duplicate-scan-progress'),
    toggleMenuBar: () => ipcRenderer.send('toggle-menu-bar'),
    updateTitleBarOverlay: (overlay) => ipcRenderer.send('update-titlebar-overlay', overlay),
    // AI Visual Search (CLIP)
    clipCheckCache: () => ipcRenderer.invoke('clip-check-cache'),
    clipInit: () => ipcRenderer.invoke('clip-init'),
    clipEmbedImages: (files) => ipcRenderer.invoke('clip-embed-images', files),
    clipEmbedText: (text) => ipcRenderer.invoke('clip-embed-text', text),
    clipStatus: () => ipcRenderer.invoke('clip-status'),
    clipTerminate: () => ipcRenderer.invoke('clip-terminate'),
    onClipProgress: (callback) => ipcRenderer.on('clip-progress', callback),
    removeClipProgressListener: () => ipcRenderer.removeAllListeners('clip-progress'),
    onClipDownloadProgress: (callback) => ipcRenderer.on('clip-download-progress', callback),
    removeClipDownloadProgressListener: () => ipcRenderer.removeAllListeners('clip-download-progress'),
    // Collections
    resolveFilePaths: (filePaths, options) => ipcRenderer.invoke('resolve-file-paths', filePaths, options),
    scanFoldersForSmartCollection: (folderPaths, options, rules) => ipcRenderer.invoke('scan-folders-for-smart-collection', folderPaths, options, rules),
    onSmartCollectionProgress: (callback) => ipcRenderer.on('smart-collection-scan-progress', callback),
    removeSmartCollectionProgressListener: () => ipcRenderer.removeAllListeners('smart-collection-scan-progress'),
    // Plugin system
    getPluginManifests: () => ipcRenderer.invoke('get-plugin-manifests'),
    executePluginAction: (pluginId, actionId, filePath, metadata) =>
        ipcRenderer.invoke('execute-plugin-action', pluginId, actionId, filePath, metadata),
    getPluginInfoSections: () => ipcRenderer.invoke('get-plugin-info-sections'),
    renderPluginInfoSection: (pluginId, sectionId, filePath, pluginMetadata) =>
        ipcRenderer.invoke('render-plugin-info-section', pluginId, sectionId, filePath, pluginMetadata),
    getPluginBatchOperations: () => ipcRenderer.invoke('get-plugin-batch-operations'),
    executePluginBatchOperation: (pluginId, operationId, filePaths, options) =>
        ipcRenderer.invoke('execute-plugin-batch-operation', pluginId, operationId, filePaths, options),
    getPluginSettingsPanels: () => ipcRenderer.invoke('get-plugin-settings-panels'),
    executePluginSettingsAction: (pluginId, action, data) =>
        ipcRenderer.invoke('execute-plugin-settings-action', pluginId, action, data),
    pluginGenerateThumbnail: (filePath, ext) =>
        ipcRenderer.invoke('plugin-generate-thumbnail', filePath, ext),
    getPluginStates: () => ipcRenderer.invoke('get-plugin-states'),
    setPluginEnabled: (pluginId, enabled) => ipcRenderer.invoke('set-plugin-enabled', pluginId, enabled),
    // Settings export/import
    exportSettingsDialog: (jsonString) => ipcRenderer.invoke('export-settings-dialog', jsonString),
    importSettingsDialog: () => ipcRenderer.invoke('import-settings-dialog'),
    syncPluginStatesFromImport: (states) => ipcRenderer.invoke('sync-plugin-states-from-import', states),
    // Auto-updater
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (_e, info) => callback(info)),
    onUpdateDownloadProgress: (callback) => ipcRenderer.on('update-download-progress', (_e, progress) => callback(progress)),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', callback),
    onUpdateError: (callback) => ipcRenderer.on('update-error', (_e, message) => callback(message)),
    removeUpdateListeners: () => {
        ipcRenderer.removeAllListeners('update-available');
        ipcRenderer.removeAllListeners('update-download-progress');
        ipcRenderer.removeAllListeners('update-downloaded');
        ipcRenderer.removeAllListeners('update-error');
    },
    downloadUpdate: () => ipcRenderer.invoke('download-update'),
    installUpdate: () => ipcRenderer.invoke('install-update')
});
