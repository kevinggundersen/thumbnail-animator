const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
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
    moveFile: (sourcePath, destPath) => ipcRenderer.invoke('move-file', sourcePath, destPath),
    watchFolder: (folderPath) => ipcRenderer.invoke('watch-folder', folderPath),
    unwatchFolder: (folderPath) => ipcRenderer.invoke('unwatch-folder', folderPath),
    onFolderChanged: (callback) => ipcRenderer.on('folder-changed', callback),
    removeFolderChangedListener: () => ipcRenderer.removeAllListeners('folder-changed')
});
