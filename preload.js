const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getPathForFile: (file) => webUtils.getPathForFile(file),
    selectFolder: (defaultPath) => ipcRenderer.invoke('select-folder', defaultPath),
    scanFolder: (path, options) => ipcRenderer.invoke('scan-folder', path, options),
    triggerGC: () => ipcRenderer.invoke('trigger-gc'),
    getStartupTimeline: () => ipcRenderer.invoke('get-startup-timeline'),
    getMemoryInfo: () => ipcRenderer.invoke('get-memory-info'),
    getCacheInfo: () => ipcRenderer.invoke('get-cache-info'),
    evictCache: (type) => ipcRenderer.invoke('evict-cache', type),
    setCacheLimits: (videoMB, imageMB) => ipcRenderer.invoke('set-cache-limits', videoMB, imageMB),
    revealInExplorer: (filePath) => ipcRenderer.invoke('reveal-in-explorer', filePath),
    renameFile: (filePath, newName) => ipcRenderer.invoke('rename-file', filePath, newName),
    batchRename: (filePaths, patternType, patternOptions) => ipcRenderer.invoke('batch-rename', filePaths, patternType, patternOptions),
    deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
    openUrl: (url) => ipcRenderer.invoke('open-url', url),
    openWithDefault: (filePath) => ipcRenderer.invoke('open-with-default', filePath),
    openWith: (filePath) => ipcRenderer.invoke('open-with', filePath),
    copyImageToClipboard: (filePath) => ipcRenderer.invoke('copy-image-to-clipboard', filePath),
    getDrives: () => ipcRenderer.invoke('get-drives'),
    listSubdirectories: (folderPath) => ipcRenderer.invoke('list-subdirectories', folderPath),
    onWindowMinimized: (callback) => ipcRenderer.on('window-minimized', callback),
    onWindowRestored: (callback) => ipcRenderer.on('window-restored', callback),
    removeWindowMinimizedListener: () => ipcRenderer.removeAllListeners('window-minimized'),
    removeWindowRestoredListener: () => ipcRenderer.removeAllListeners('window-restored'),
    // New IPC handlers
    getFileInfo: (filePath) => ipcRenderer.invoke('get-file-info', filePath),
    createFolder: (folderPath, folderName) => ipcRenderer.invoke('create-folder', folderPath, folderName),
    moveFile: (sourcePath, destFolder, fileName, conflictResolution) => ipcRenderer.invoke('move-file', sourcePath, destFolder, fileName, conflictResolution),
    copyFile: (sourcePath, destFolder, fileName, conflictResolution) => ipcRenderer.invoke('copy-file', sourcePath, destFolder, fileName, conflictResolution),
    watchFolder: (folderPath) => ipcRenderer.invoke('watch-folder', folderPath),
    unwatchFolder: (folderPath) => ipcRenderer.invoke('unwatch-folder', folderPath),
    onFolderChanged: (callback) => ipcRenderer.on('folder-changed', callback),
    removeFolderChangedListener: () => ipcRenderer.removeAllListeners('folder-changed'),
    generateVideoThumbnail: (filePath) => ipcRenderer.invoke('generate-video-thumbnail', filePath),
    generateImageThumbnail: (filePath, maxSize) => ipcRenderer.invoke('generate-image-thumbnail', filePath, maxSize),
    scanFileDimensions: (files) => ipcRenderer.invoke('scan-file-dimensions', files),
    hasFfmpeg: () => ipcRenderer.invoke('has-ffmpeg'),
    generateThumbnailBatch: (items) => ipcRenderer.invoke('generate-thumbnails-batch', items),
    getFolderPreview: (folderPath) => ipcRenderer.invoke('get-folder-preview', folderPath),
    // Duplicate detection
    scanDuplicates: (folderPath, options) => ipcRenderer.invoke('scan-duplicates', folderPath, options),
    regroupDuplicates: (hashData, threshold) => ipcRenderer.invoke('regroup-duplicates', hashData, threshold),
    deleteFilesBatch: (filePaths) => ipcRenderer.invoke('delete-files-batch', filePaths),
    onBatchDeleteProgress: (callback) => ipcRenderer.on('batch-delete-progress', callback),
    removeBatchDeleteProgressListener: () => ipcRenderer.removeAllListeners('batch-delete-progress'),
    undoFileOperation: () => ipcRenderer.invoke('undo-file-operation'),
    redoFileOperation: () => ipcRenderer.invoke('redo-file-operation'),
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
    scanFoldersForSmartCollection: (folderPaths, options, rules, scanId) => ipcRenderer.invoke('scan-folders-for-smart-collection', folderPaths, options, rules, scanId),
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
    installUpdate: () => ipcRenderer.invoke('install-update'),
    // SQLite Database
    dbCheckMigrationStatus: () => ipcRenderer.invoke('db-check-migration-status'),
    dbRunMigration: (data) => ipcRenderer.invoke('db-run-migration', data),
    dbGetMeta: (key) => ipcRenderer.invoke('db-get-meta', key),
    dbSetMeta: (key, value) => ipcRenderer.invoke('db-set-meta', key, value),
    // Ratings
    dbGetAllRatings: () => ipcRenderer.invoke('db-get-all-ratings'),
    dbSetRating: (filePath, rating) => ipcRenderer.invoke('db-set-rating', filePath, rating),
    // Pins
    dbGetAllPinned: () => ipcRenderer.invoke('db-get-all-pinned'),
    dbSetPinned: (filePath, pinned) => ipcRenderer.invoke('db-set-pinned', filePath, pinned),
    // Favorites
    dbGetFavorites: () => ipcRenderer.invoke('db-get-favorites'),
    dbSaveFavorites: (favObj) => ipcRenderer.invoke('db-save-favorites', favObj),
    // Recent files
    dbGetRecentFiles: () => ipcRenderer.invoke('db-get-recent-files'),
    dbAddRecentFile: (entry) => ipcRenderer.invoke('db-add-recent-file', entry),
    dbClearRecentFiles: () => ipcRenderer.invoke('db-clear-recent-files'),
    // Collections
    dbGetAllCollections: () => ipcRenderer.invoke('db-get-all-collections'),
    dbGetCollection: (id) => ipcRenderer.invoke('db-get-collection', id),
    dbSaveCollection: (col) => ipcRenderer.invoke('db-save-collection', col),
    dbDeleteCollection: (id) => ipcRenderer.invoke('db-delete-collection', id),
    dbGetCollectionFiles: (collectionId) => ipcRenderer.invoke('db-get-collection-files', collectionId),
    dbAddFilesToCollection: (collectionId, filePaths) => ipcRenderer.invoke('db-add-files-to-collection', collectionId, filePaths),
    dbRemoveFileFromCollection: (collectionId, filePath) => ipcRenderer.invoke('db-remove-file-from-collection', collectionId, filePath),
    dbRemoveFilesFromCollection: (collectionId, filePaths) => ipcRenderer.invoke('db-remove-files-from-collection', collectionId, filePaths),
    // Tags
    dbCreateTag: (name, description, color) => ipcRenderer.invoke('db-create-tag', name, description, color),
    dbUpdateTag: (id, updates) => ipcRenderer.invoke('db-update-tag', id, updates),
    dbDeleteTag: (id) => ipcRenderer.invoke('db-delete-tag', id),
    dbGetAllTags: () => ipcRenderer.invoke('db-get-all-tags'),
    dbGetTag: (id) => ipcRenderer.invoke('db-get-tag', id),
    dbSearchTags: (query) => ipcRenderer.invoke('db-search-tags', query),
    dbGetTopTags: (limit) => ipcRenderer.invoke('db-get-top-tags', limit),
    // File-tag associations
    dbAddTagToFile: (filePath, tagId) => ipcRenderer.invoke('db-add-tag-to-file', filePath, tagId),
    dbRemoveTagFromFile: (filePath, tagId) => ipcRenderer.invoke('db-remove-tag-from-file', filePath, tagId),
    dbGetTagsForFile: (filePath) => ipcRenderer.invoke('db-get-tags-for-file', filePath),
    dbGetTagsForFiles: (filePaths) => ipcRenderer.invoke('db-get-tags-for-files', filePaths),
    dbGetFilesForTag: (tagId) => ipcRenderer.invoke('db-get-files-for-tag', tagId),
    dbBulkTagFiles: (filePaths, tagId) => ipcRenderer.invoke('db-bulk-tag-files', filePaths, tagId),
    dbBulkRemoveTagFromFiles: (filePaths, tagId) => ipcRenderer.invoke('db-bulk-remove-tag-from-files', filePaths, tagId),
    dbQueryFilesByTags: (expression) => ipcRenderer.invoke('db-query-files-by-tags', expression),
    dbSuggestTags: (filePath) => ipcRenderer.invoke('db-suggest-tags', filePath),
    dbExportTags: () => ipcRenderer.invoke('db-export-tags'),
    dbImportTags: (data) => ipcRenderer.invoke('db-import-tags', data)
});
