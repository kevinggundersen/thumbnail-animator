// ============================================================================
// context-menu.js — Context menu display, action dispatch, rename dialog
// Extracted from renderer.js. All functions/variables remain in global scope.
// ============================================================================

// --- Context Menu Functionality ---
const folderContextMenu = document.getElementById('folder-context-menu');

function showLightboxContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();

    contextMenuSource = 'lightbox';

    const filePath = window.currentLightboxFilePath;
    if (!filePath) return;
    const fileName = filePath.split(/[\\/]/).pop();

    // Virtual card object so the existing action handler works unchanged
    contextMenuTargetCard = {
        dataset: { path: filePath },
        querySelector: (sel) => sel === '.video-info' ? { textContent: fileName } : null,
        classList: { contains: () => false }
    };

    // Hide folder menu
    folderContextMenu.classList.add('hidden');

    // Update pin/unpin label
    const pinned = isFilePinned(filePath);
    const pinLabel = contextMenu.querySelector('.pin-label');
    if (pinLabel) pinLabel.textContent = pinned ? 'Unpin' : 'Pin to Top';

    // Show/hide items appropriate for lightbox (single file, no multi-select)
    const batchRenameItem = contextMenu.querySelector('[data-action="batch-rename"]');
    if (batchRenameItem) batchRenameItem.style.display = 'none';
    const compareItem = contextMenu.querySelector('[data-action="compare"]');
    if (compareItem) compareItem.style.display = 'none';
    const slideshowItem = contextMenu.querySelector('[data-action="slideshow"]');
    if (slideshowItem) slideshowItem.style.display = 'none';

    // Show single-file actions
    const openItem = contextMenu.querySelector('[data-action="open"]');
    if (openItem) openItem.style.display = '';
    const openWithItem = contextMenu.querySelector('[data-action="open-with"]');
    if (openWithItem) openWithItem.style.display = '';
    const renameItem = contextMenu.querySelector('[data-action="rename"]');
    if (renameItem) renameItem.style.display = '';
    const revealItem = contextMenu.querySelector('[data-action="reveal"]');
    if (revealItem) revealItem.style.display = '';
    const copyFileItem = contextMenu.querySelector('[data-action="copy-file"]');
    if (copyFileItem) copyFileItem.style.display = '';
    const pinItem = contextMenu.querySelector('[data-action="pin"]');
    if (pinItem) pinItem.style.display = '';
    const addToColItem = contextMenu.querySelector('[data-action="add-to-collection"]');
    if (addToColItem) addToColItem.style.display = '';
    const tagItem = contextMenu.querySelector('[data-action="tag-file"]');
    if (tagItem) tagItem.style.display = '';
    const autoTagItem = contextMenu.querySelector('[data-action="auto-tag"]');
    if (autoTagItem) autoTagItem.style.display = '';
    const deleteItem = contextMenu.querySelector('[data-action="delete"]');
    if (deleteItem) deleteItem.style.display = '';

    // Show/hide Remove from Collection
    const removeFromColItem = contextMenu.querySelector('[data-action="remove-from-collection"]');
    if (removeFromColItem) {
        if (currentCollectionId) {
            const col = collectionsCache.find(c => c.id === currentCollectionId);
            removeFromColItem.style.display = (col && col.type === 'static') ? '' : 'none';
        } else {
            removeFromColItem.style.display = 'none';
        }
    }

    // Find Similar — only when AI visual search enabled
    const findSimilarItem = contextMenu.querySelector('[data-action="find-similar"]');
    if (findSimilarItem) findSimilarItem.style.display = aiVisualSearchEnabled ? '' : 'none';

    // Export Trim — show only for video/animated media with both marks set
    const trimItem = contextMenu.querySelector('[data-action="trim"]');
    if (trimItem) {
        const mt = activePlaybackController ? activePlaybackController.mediaType : null;
        const hasMarks = loopPoints.in != null && loopPoints.out != null && loopPoints.out > loopPoints.in;
        const canTrim = _ffmpegAvailable !== false && (mt === 'video' || mt === 'gif' || mt === 'webp') && hasMarks;
        trimItem.style.display = canTrim ? '' : 'none';
    }
    // Convert — show for all media files when ffmpeg is available
    const convertItem = contextMenu.querySelector('[data-action="convert"]');
    if (convertItem) convertItem.style.display = _ffmpegAvailable === false ? 'none' : '';
    const rotateLeftItem = contextMenu.querySelector('[data-action="rotate-left"]');
    if (rotateLeftItem) rotateLeftItem.style.display = lightboxCropState.active ? 'none' : '';
    const rotateRightItem = contextMenu.querySelector('[data-action="rotate-right"]');
    if (rotateRightItem) rotateRightItem.style.display = lightboxCropState.active ? 'none' : '';
    const cropItem = contextMenu.querySelector('[data-action="crop-image"]');
    if (cropItem) cropItem.style.display = lightboxCropMeta.enabled && !lightboxCropState.active ? '' : 'none';

    // Inject plugin items (filtered by appliesTo for the current file)
    contextMenu.querySelectorAll('.context-menu-item[data-plugin], .context-menu-plugin-separator').forEach(el => el.remove());
    getPluginMenuItems().then(items => {
        const filtered = typeof filterPluginMenuItems === 'function'
            ? filterPluginMenuItems(items, filePath) : items;
        if (!filtered.length) return;
        const separator = document.createElement('div');
        separator.className = 'context-menu-separator context-menu-plugin-separator';
        contextMenu.appendChild(separator);
        for (const item of filtered) {
            const el = document.createElement('div');
            el.className = 'context-menu-item';
            el.dataset.action = `plugin:${item.pluginId}:${item.id}`;
            el.dataset.plugin = item.pluginId;
            el.textContent = item.label;
            contextMenu.appendChild(el);
        }
    });

    // Position at mouse
    const x = event.clientX;
    const y = event.clientY;
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.remove('hidden');

    requestAnimationFrame(() => {
        const rect = contextMenu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            contextMenu.style.left = `${window.innerWidth - rect.width - 10}px`;
        }
        if (rect.bottom > window.innerHeight) {
            contextMenu.style.top = `${window.innerHeight - rect.height - 10}px`;
        }
    });
}

function showContextMenu(event, card) {
    event.preventDefault();
    event.stopPropagation();

    contextMenuSource = 'grid';
    contextMenuTargetCard = card;
    const isFolder = card.classList.contains('folder-card');

    // Multi-select context menu behavior:
    // If right-clicking an unselected card while others are selected, select only this card.
    // If right-clicking a selected card, keep the entire selection.
    if (!isFolder && card.dataset.path) {
        if (!selectedCardPaths.has(card.dataset.path)) {
            selection.clear();
            selection.addPath(card.dataset.path, selection._getItemIndex(card));
            card.classList.add('selected');
        }
    }

    const menu = isFolder ? folderContextMenu : contextMenu;
    // Hide the other menu
    const otherMenu = isFolder ? contextMenu : folderContextMenu;
    otherMenu.classList.add('hidden');

    // Update pin/unpin label dynamically
    const itemPath = isFolder ? card.dataset.folderPath : card.dataset.path;
    const pinned = isFilePinned(itemPath);
    const pinLabel = menu.querySelector('.pin-label');
    if (pinLabel) pinLabel.textContent = pinned ? 'Unpin' : 'Pin to Top';

    // Show/hide collection-specific context menu items
    if (!isFolder) {
        const addToColItem = menu.querySelector('[data-action="add-to-collection"]');
        let removeFromColItem = menu.querySelector('[data-action="remove-from-collection"]');

        // Always show "Add to Collection"
        if (addToColItem) addToColItem.style.display = '';

        // Show/create "Remove from Collection" only when viewing a static collection
        if (currentCollectionId) {
            const col = collectionsCache.find(c => c.id === currentCollectionId);
            if (col && col.type === 'static') {
                if (!removeFromColItem) {
                    removeFromColItem = document.createElement('div');
                    removeFromColItem.className = 'context-menu-item';
                    removeFromColItem.dataset.action = 'remove-from-collection';
                    removeFromColItem.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><line x1="8" x2="16" y1="12" y2="12"/></svg> Remove from Collection';
                    addToColItem.insertAdjacentElement('afterend', removeFromColItem);
                }
                removeFromColItem.style.display = '';
            } else if (removeFromColItem) {
                removeFromColItem.style.display = 'none';
            }
        } else if (removeFromColItem) {
            removeFromColItem.style.display = 'none';
        }
    }

    // Show/hide batch rename + compare based on multi-select
    if (!isFolder) {
        const selectedCards = document.querySelectorAll('.video-card.selected');
        const selCount = selectedCards.length;
        const batchRenameItem = menu.querySelector('[data-action="batch-rename"]');
        if (batchRenameItem) batchRenameItem.style.display = selCount > 1 ? '' : 'none';
        const compareItem = menu.querySelector('[data-action="compare"]');
        if (compareItem) compareItem.style.display = (selCount >= 2 && selCount <= 4) ? '' : 'none';
    }

    // Show/hide "Find Similar" — only for images when AI visual search is enabled
    if (!isFolder) {
        const findSimilarItem = menu.querySelector('[data-action="find-similar"]');
        if (findSimilarItem) {
            findSimilarItem.style.display = aiVisualSearchEnabled ? '' : 'none';
        }
    }

    // "Export Trim…" — lightbox-only (needs marker state from the filmstrip)
    // and "Convert…" — always available for media files
    if (!isFolder) {
        const trimItem = menu.querySelector('[data-action="trim"]');
        if (trimItem) trimItem.style.display = 'none'; // grid context: hide (lightbox handles separately)
        const convertItem = menu.querySelector('[data-action="convert"]');
        if (convertItem) convertItem.style.display = _ffmpegAvailable === false ? 'none' : '';
        const rotateLeftItem = menu.querySelector('[data-action="rotate-left"]');
        if (rotateLeftItem) rotateLeftItem.style.display = 'none';
        const rotateRightItem = menu.querySelector('[data-action="rotate-right"]');
        if (rotateRightItem) rotateRightItem.style.display = 'none';
        const cropItem = menu.querySelector('[data-action="crop-image"]');
        if (cropItem) cropItem.style.display = 'none';
    }

    // Inject / refresh plugin menu items (file menus only)
    if (!isFolder) {
        // Remove any previously injected plugin items and their separator
        menu.querySelectorAll('.context-menu-item[data-plugin], .context-menu-plugin-separator').forEach(el => el.remove());
        // Load and inject asynchronously — menu is already visible so items appear shortly after
        const _ctxFilePath = card.dataset.path;
        getPluginMenuItems().then(items => {
            const filtered = typeof filterPluginMenuItems === 'function'
                ? filterPluginMenuItems(items, _ctxFilePath) : items;
            if (!filtered.length) return;
            const separator = document.createElement('div');
            separator.className = 'context-menu-separator context-menu-plugin-separator';
            menu.appendChild(separator);
            for (const item of filtered) {
                const el = document.createElement('div');
                el.className = 'context-menu-item';
                el.dataset.action = `plugin:${item.pluginId}:${item.id}`;
                el.dataset.plugin = item.pluginId;
                el.textContent = item.label;
                menu.appendChild(el);
            }
        });

        // Inject batch operations when multiple files are selected
        menu.querySelectorAll('.context-menu-item[data-batch-op], .context-menu-batch-op-separator').forEach(el => el.remove());
        if (selectedCardPaths.size > 1) {
            getPluginBatchOperations().then(ops => {
                if (!ops.length) return;
                const batchSep = document.createElement('div');
                batchSep.className = 'context-menu-separator context-menu-batch-op-separator';
                menu.appendChild(batchSep);
                for (const op of ops) {
                    const el = document.createElement('div');
                    el.className = 'context-menu-item';
                    el.dataset.action = `batch-op:${op.pluginId}:${op.id}`;
                    el.dataset.batchOp = op.pluginId;
                    el.textContent = op.name;
                    menu.appendChild(el);
                }
            });
        }
    }

    const x = event.clientX;
    const y = event.clientY;

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.classList.remove('hidden');

    requestAnimationFrame(() => {
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = `${window.innerWidth - rect.width - 10}px`;
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = `${window.innerHeight - rect.height - 10}px`;
        }
    });
}

function hideContextMenu() {
    contextMenu.classList.add('hidden');
    folderContextMenu.classList.add('hidden');
    contextMenuTargetCard = null;
}

// Hide context menus on Escape (stopImmediatePropagation prevents lightbox from also closing)
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const wasMenuVisible = !contextMenu.classList.contains('hidden') || !folderContextMenu.classList.contains('hidden');
        hideContextMenu();
        if (favContextMenu) hideFavContextMenu();
        if (findSimilarState.active) { clearFindSimilar(); return; }
        if (wasMenuVisible) {
            e.stopImmediatePropagation();
            return;
        }
    }
});

// Hide context menus when clicking elsewhere
document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target) && !folderContextMenu.contains(e.target)) {
        hideContextMenu();
    }
    if (favContextMenu && !favContextMenu.contains(e.target)) {
        hideFavContextMenu();
    }
});

// Handle context menu item clicks
contextMenu.addEventListener('click', async (e) => {
    const action = e.target.closest('.context-menu-item')?.dataset.action || e.target.dataset.action;
    if (!action || !contextMenuTargetCard) return;

    const filePath = contextMenuTargetCard.dataset.path;
    if (!filePath) return;

    // Store the file name before hiding the menu (since we clear contextMenuTargetCard)
    const fileNameElement = contextMenuTargetCard.querySelector('.video-info');
    const fileName = fileNameElement ? fileNameElement.textContent : '';

    hideContextMenu();

    switch (action) {
        case 'pin': {
            const pinned = isFilePinned(filePath);
            setFilePinned(filePath, !pinned);
            applySorting();
            showToast(pinned ? `Unpinned "${fileName}"` : `Pinned "${fileName}" to top`, 'success');
            break;
        }
        case 'reveal':
            try {
                await window.electronAPI.revealInExplorer(filePath);
            } catch (error) {
                showToast(`Could not reveal file: ${friendlyError(error)}`, 'error');
            }
            break;
            
        case 'rename':
            // Show rename dialog
            renamePendingFile = { filePath, fileName };
            renameInput.value = fileName;
            renameDialog.classList.remove('hidden');
            renameInput.focus();
            renameInput.select();
            break;

        case 'batch-rename': {
            const selectedCards = document.querySelectorAll('.video-card.selected');
            const renamePaths = selectedCards.length > 1
                ? Array.from(selectedCards).map(c => c.dataset.path).filter(Boolean)
                : [filePath];
            if (renamePaths.length < 2) {
                showToast('Select 2 or more files for batch rename', 'info');
            } else {
                openBatchRename(renamePaths);
            }
            break;
        }

        case 'delete':
            try {
                const deleteLabel = useSystemTrash ? 'Move to Recycle Bin' : 'Delete';
                if (await showConfirm(deleteLabel, `${deleteLabel} "${fileName}"?`, { confirmLabel: deleteLabel, danger: true })) {
                    setStatusActivity(`Deleting ${fileName}...`);
                    const result = await window.electronAPI.deleteFile(filePath);
                    setStatusActivity('');
                    if (result.ok) {
                        const trashed = result.value && result.value.trashed;
                        const toastOpts = trashed
                            ? { duration: 4000 }
                            : {
                                duration: 8000,
                                actionLabel: 'Undo',
                                actionCallback: () => {
                                    window.electronAPI.undoFileOperation().then(undoResult => {
                                        if (undoResult.ok) {
                                            showToast(`Restored "${fileName}"`, 'success');
                                            if (currentFolderPath) {
                                                invalidateFolderCache(currentFolderPath);
                                                const st = gridContainer.scrollTop;
                                                loadVideos(currentFolderPath, false, st);
                                            }
                                        } else {
                                            showToast(`Undo failed: ${undoResult.error}`, 'error');
                                        }
                                    });
                                }
                            };
                        const toastMsg = trashed ? `Moved "${fileName}" to Recycle Bin` : `Deleted "${fileName}"`;
                        showToast(toastMsg, 'success', toastOpts);
                        if (currentFolderPath) {
                            invalidateFolderCache(currentFolderPath);
                            const previousScrollTop = gridContainer.scrollTop;
                            await loadVideos(currentFolderPath, false, previousScrollTop);
                        }
                        // Navigate lightbox after delete
                        if (isLightboxOpen && contextMenuSource === 'lightbox') {
                            const delIdx = lightboxItems.findIndex(it => it.path === filePath);
                            if (delIdx !== -1) lightboxItems.splice(delIdx, 1);
                            if (lightboxItems.length === 0) {
                                closeLightbox();
                            } else {
                                currentLightboxIndex = Math.min(delIdx, lightboxItems.length - 1);
                                const next = lightboxItems[currentLightboxIndex];
                                openLightbox(next.url, next.path, next.name);
                            }
                        }
                    } else {
                        showToast(`Could not delete file: ${friendlyError(result.error)}`, 'error');
                    }
                }
            } catch (error) {
                showToast(`Could not delete file: ${friendlyError(error)}`, 'error');
            }
            break;

        case 'open':
            try {
                await window.electronAPI.openWithDefault(filePath);
            } catch (error) {
                showToast(`Could not open file: ${friendlyError(error)}`, 'error');
            }
            break;

        case 'open-with':
            try {
                await window.electronAPI.openWith(filePath);
            } catch (error) {
                showToast(`Could not open file: ${friendlyError(error)}`, 'error');
            }
            break;

        case 'copy-file': {
            try {
                const result = await window.electronAPI.copyImageToClipboard(filePath);
                if (result.ok) {
                    showToast('Copied to clipboard', 'success');
                } else {
                    showToast(`Could not copy: ${friendlyError(result.error)}`, 'error');
                }
            } catch (error) {
                showToast(`Could not copy: ${friendlyError(error)}`, 'error');
            }
            break;
        }

        case 'copy-path': {
            try {
                await navigator.clipboard.writeText(filePath);
                showToast('Path copied', 'success', { duration: 1500 });
            } catch (error) {
                showToast(`Could not copy path: ${friendlyError(error)}`, 'error');
            }
            break;
        }

        case 'copy-name': {
            try {
                await navigator.clipboard.writeText(fileName);
                showToast('Name copied', 'success', { duration: 1500 });
            } catch (error) {
                showToast(`Could not copy name: ${friendlyError(error)}`, 'error');
            }
            break;
        }

        case 'add-to-collection': {
            // Gather selected files (multi-select support)
            const selectedCards = document.querySelectorAll('.video-card.selected');
            const paths = selectedCards.length > 1
                ? Array.from(selectedCards).map(c => c.dataset.path).filter(Boolean)
                : [filePath];
            showAddToCollectionSubmenu(paths, e.clientX || e.pageX || 200, e.clientY || e.pageY || 200);
            break;
        }

        case 'tag-file': {
            const selectedCards = document.querySelectorAll('.video-card.selected');
            const tagPaths = selectedCards.length > 1
                ? Array.from(selectedCards).map(c => c.dataset.path).filter(Boolean)
                : [filePath];
            openTagPicker(tagPaths);
            break;
        }

        case 'auto-tag': {
            const selectedCards = document.querySelectorAll('.video-card.selected');
            const autoTagPaths = selectedCards.length > 1
                ? Array.from(selectedCards).map(c => c.dataset.path).filter(Boolean)
                : [filePath];
            const supportedPaths = autoTagPaths.filter(p => {
                const ext = p.split('.').pop().toLowerCase();
                return ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v', 'ogg'].includes(ext);
            });
            if (supportedPaths.length === 0) {
                showToast('Auto-tag only works with image or video files', 'info');
            } else {
                openAutoTag(supportedPaths);
            }
            break;
        }

        case 'remove-from-collection': {
            if (currentCollectionId) {
                await removeFileFromCollection(currentCollectionId, filePath);
                showToast(`Removed "${fileName}" from collection`, 'success');
                loadCollectionIntoGrid(currentCollectionId);
                renderCollectionsSidebar();
            }
            break;
        }

        case 'find-similar': {
            const ext = filePath.split('.').pop().toLowerCase();
            const supportedExts = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'mp4', 'webm', 'ogg', 'mov'];
            if (!supportedExts.includes(ext)) {
                showToast('Find Similar works with image and video files', 'info');
                break;
            }
            if (!aiVisualSearchEnabled) {
                showToast('Enable AI Visual Search in Settings first', 'info');
                break;
            }
            activateFindSimilar(filePath, fileName);
            break;
        }

        case 'compare': {
            const selCards = document.querySelectorAll('.video-card.selected');
            const paths = selCards.length >= 2
                ? Array.from(selCards).map(c => c.dataset.path).filter(Boolean)
                : [filePath];
            openCompareMode(paths);
            break;
        }

        case 'slideshow': {
            startSlideshow();
            break;
        }

        case 'trim': {
            // Lightbox-only (needs marker state). If not open, tell user.
            if (contextMenuSource !== 'lightbox') {
                showToast('Open the file in lightbox and mark a range with I / O first', 'info');
                break;
            }
            exportTrim();
            break;
        }

        case 'convert': {
            // Grid: batch over selection. Lightbox: just the current file.
            let paths;
            if (contextMenuSource === 'lightbox') {
                paths = [filePath];
            } else {
                paths = Array.from(document.querySelectorAll('.video-card.selected'))
                    .map(c => c.dataset.path)
                    .filter(Boolean);
                if (!paths.length) paths = [filePath];
            }
            openConvertDialog(paths, { fromLightbox: contextMenuSource === 'lightbox' });
            break;
        }

        case 'crop-image': {
            if (contextMenuSource !== 'lightbox' || !lightboxCropMeta.enabled) {
                showToast('Open a still image in the lightbox first', 'info');
                break;
            }
            enterLightboxCropMode();
            break;
        }

        case 'rotate-left':
            if (contextMenuSource === 'lightbox') applyLightboxRotation(-90);
            break;

        case 'rotate-right':
            if (contextMenuSource === 'lightbox') applyLightboxRotation(90);
            break;

        default:
            if (action.startsWith('batch-op:')) {
                const [, pluginId, operationId] = action.split(':');
                const filePaths = Array.from(selectedCardPaths);
                if (filePaths.length === 0) break;
                showToast(`Running batch operation on ${filePaths.length} files\u2026`, 'info', { duration: 2000 });
                try {
                    const result = await window.electronAPI.executePluginBatchOperation(
                        pluginId, operationId, filePaths, {}
                    );
                    if (result.ok) {
                        showToast('Batch operation completed', 'success');
                    } else {
                        showToast(`Batch operation failed: ${friendlyError(result.error)}`, 'error');
                    }
                } catch (error) {
                    showToast(`Batch operation error: ${friendlyError(error)}`, 'error');
                }
            } else if (action.startsWith('plugin:')) {
                const [, pluginId, actionId] = action.split(':');
                try {
                    const result = await window.electronAPI.executePluginAction(pluginId, actionId, filePath, null);
                    if (!result.ok) {
                        showToast(`Plugin action failed: ${friendlyError(result.error)}`, 'error');
                    } else if (result.value?.json) {
                        // If the plugin returned JSON text, copy it to clipboard
                        navigator.clipboard.writeText(result.value.json).then(() => {
                            showToast('Copied to clipboard', 'success');
                        });
                    }
                } catch (error) {
                    showToast(`Plugin error: ${friendlyError(error)}`, 'error');
                }
            }
            break;
    }
});

// Prevent default context menu on cards and show custom menu
document.addEventListener('contextmenu', (e) => {
    // Suppress context menu when blow-up hold is active
    if (blowUpSuppressContextMenu) {
        e.preventDefault();
        e.stopPropagation();
        // Reset the flag now that the contextmenu event has been consumed
        blowUpSuppressContextMenu = false;
        return;
    }

    const card = e.target.closest('.video-card') || e.target.closest('.folder-card');
    if (card) {
        showContextMenu(e, card);
    }
});

// Folder context menu actions
folderContextMenu.addEventListener('click', async (e) => {
    const action = e.target.closest('.context-menu-item')?.dataset.action;
    if (!action || !contextMenuTargetCard) return;

    const folderPath = contextMenuTargetCard.dataset.folderPath;
    if (!folderPath) return;

    const folderName = folderPath.split(/[/\\]/).pop();
    hideContextMenu();

    switch (action) {
        case 'pin-folder': {
            const pinned = isFilePinned(folderPath);
            setFilePinned(folderPath, !pinned);
            applySorting();
            showToast(pinned ? `Unpinned "${folderName}"` : `Pinned "${folderName}" to top`, 'success');
            break;
        }
        case 'open-folder':
            await navigateToFolder(folderPath);
            break;

        case 'open-folder-new-tab':
            createTab(folderPath, folderName);
            break;

        case 'rename-folder':
            renamePendingFile = { filePath: folderPath, fileName: folderName };
            renameInput.value = folderName;
            renameDialog.classList.remove('hidden');
            renameInput.focus();
            renameInput.select();
            break;

        case 'reveal-folder':
            try {
                await window.electronAPI.revealInExplorer(folderPath);
            } catch (error) {
                showToast(`Could not reveal folder: ${friendlyError(error)}`, 'error');
            }
            break;

        case 'delete-folder':
            try {
                if (await showConfirm('Delete Folder', `Delete "${folderName}"?`, { confirmLabel: 'Delete', danger: true })) {
                    setStatusActivity(`Deleting ${folderName}...`);
                    const result = await window.electronAPI.deleteFile(folderPath);
                    setStatusActivity('');
                    if (result.ok) {
                        showToast(`Deleted "${folderName}"`, 'success', {
                            duration: 8000,
                            actionLabel: 'Undo',
                            actionCallback: () => {
                                window.electronAPI.undoFileOperation().then(undoResult => {
                                    if (undoResult.ok) {
                                        showToast(`Restored "${folderName}"`, 'success');
                                        if (currentFolderPath) {
                                            invalidateFolderCache(currentFolderPath);
                                            const st = gridContainer.scrollTop;
                                            loadVideos(currentFolderPath, false, st);
                                        }
                                    } else {
                                        showToast(`Undo failed: ${undoResult.error}`, 'error');
                                    }
                                });
                            }
                        });
                        if (currentFolderPath) {
                            invalidateFolderCache(currentFolderPath);
                            const previousScrollTop = gridContainer.scrollTop;
                            await loadVideos(currentFolderPath, false, previousScrollTop);
                        }
                    } else {
                        showToast(`Could not delete folder: ${friendlyError(result.error)}`, 'error');
                    }
                }
            } catch (error) {
                showToast(`Could not delete folder: ${friendlyError(error)}`, 'error');
            }
            break;
    }
});

// Rename Dialog Handlers
async function handleRenameConfirm() {
    if (!renamePendingFile) return;
    
    const newName = renameInput.value.trim();
    if (!newName || newName === renamePendingFile.fileName) {
        renameDialog.classList.add('hidden');
        renamePendingFile = null;
        return;
    }
    
    try {
        setStatusActivity(`Renaming to ${newName}...`);
        const result = await window.electronAPI.renameFile(renamePendingFile.filePath, newName);
        setStatusActivity('');
        if (result.ok) {
            renameDialog.classList.add('hidden');
            const oldPath = renamePendingFile.filePath;
            renamePendingFile = null;
            showToast(`Renamed to "${newName}"`, 'success');
            // Refresh in-memory ratings/pins so the new path inherits metadata
            await Promise.all([loadRatings(), loadPins()]);
            if (currentFolderPath) {
                invalidateFolderCache(currentFolderPath);
                const previousScrollTop = gridContainer.scrollTop;
                await loadVideos(currentFolderPath, false, previousScrollTop);
            }
            // Update lightbox state after rename
            if (isLightboxOpen && contextMenuSource === 'lightbox') {
                const dir = oldPath.substring(0, oldPath.lastIndexOf(oldPath.includes('/') ? '/' : '\\') + 1);
                const newPath = dir + newName;
                const newUrl = 'file:///' + newPath.replace(/\\/g, '/');
                window.currentLightboxFilePath = newPath;
                window.currentLightboxFileUrl = newUrl;
                setLightboxCropAvailability(newPath, lightboxImage.style.display !== 'none' && !activePlaybackController);
                const copyPathBtn = document.getElementById('copy-path-btn');
                const copyNameBtn = document.getElementById('copy-name-btn');
                if (copyPathBtn) copyPathBtn.dataset.filePath = newPath;
                if (copyNameBtn) copyNameBtn.dataset.fileName = newName;
                // Update lightboxItems entry
                const idx = lightboxItems.findIndex(it => it.path === oldPath);
                if (idx !== -1) {
                    lightboxItems[idx].path = newPath;
                    lightboxItems[idx].name = newName;
                    lightboxItems[idx].url = newUrl;
                }
                if (inspectorPanelInstance && inspectorPanelInstance._currentPath === oldPath) {
                    inspectorPanelInstance.bind(newPath, activePlaybackController);
                }
            }
        } else {
            showToast(`Could not rename: ${friendlyError(result.error)}`, 'error');
        }
    } catch (error) {
        showToast(`Could not rename: ${friendlyError(error)}`, 'error');
    }
}

function handleRenameCancel() {
    renameDialog.classList.add('hidden');
    renamePendingFile = null;
}

renameConfirmBtn.addEventListener('click', handleRenameConfirm);
renameCancelBtn.addEventListener('click', handleRenameCancel);

// Handle Enter key in rename input
renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        handleRenameConfirm();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        handleRenameCancel();
    }
});

// Close rename dialog when clicking outside
renameDialog.addEventListener('click', (e) => {
    if (e.target === renameDialog) {
        handleRenameCancel();
    }
});

