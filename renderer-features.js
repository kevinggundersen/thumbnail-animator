// ==================== WEBGPU HAMMING DISTANCE OFFLOAD ====================
// Main process requests GPU-accelerated pairwise hamming comparison via IPC;
// we run the compute shader and return the matching pairs. Falls back to CPU
// in main if WebGPU isn't available or the device is lost.
if (window.electronAPI && window.electronAPI.onWebgpuHammingRequest) {
    window.electronAPI.onWebgpuHammingRequest(async (_event, req) => {
        const { id, hashBytes, threshold } = req || {};
        try {
            if (!window.webgpuHamming) throw new Error('webgpu-hamming module not loaded');
            const t0 = performance.now();
            const result = await window.webgpuHamming.computeHammingPairs(hashBytes, threshold);
            const ms = performance.now() - t0;
            window.electronAPI.sendWebgpuHammingResponse({
                id,
                pairs: result.pairs,
                overflowed: result.overflowed,
                count: result.count,
                ms
            });
        } catch (err) {
            window.electronAPI.sendWebgpuHammingResponse({
                id,
                error: err && err.message ? err.message : String(err)
            });
        }
    });
}

// ==================== BATCH ERROR GROUPING ====================
function groupBatchErrors(failedItems) {
    if (!failedItems || failedItems.length === 0) return '';
    const groups = {};
    for (const item of failedItems) {
        const msg = friendlyError(item.error || 'Unknown error');
        groups[msg] = (groups[msg] || 0) + 1;
    }
    return Object.entries(groups)
        .map(([msg, count]) => count > 1 ? `${count} ${msg.toLowerCase()}` : msg.toLowerCase())
        .join(', ');
}

// ==================== KEYBOARD SHORTCUTS ====================
function initKeyboardShortcuts() {
    document.addEventListener('keydown', async (e) => {
        // Don't trigger shortcuts when typing in inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
            // Allow Escape to close dialogs even when in inputs
            if (e.key === 'Escape') {
                if (!renameDialog.classList.contains('hidden')) {
                    handleRenameCancel();
                } else if (!lightbox.classList.contains('hidden')) {
                    closeLightbox();
                } else if (!settingsModal.classList.contains('hidden')) {
                    closeSettingsModal();
                } else if (!toolsMenuDropdown.classList.contains('hidden')) {
                    toolsMenuDropdown.classList.add('hidden');
                }
            }
            return;
        }

        // Redo file operation
        if (matchesShortcut(e, 'redo') || ((e.ctrlKey || e.metaKey) && e.key === 'y')) {
            e.preventDefault();
            window.electronAPI.redoFileOperation().then(result => {
                if (result.success) {
                    showToast(`Redo: ${result.description}`, 'success');
                    if (currentFolderPath) {
                        invalidateFolderCache(currentFolderPath);
                        const previousScrollTop = gridContainer.scrollTop;
                        loadVideos(currentFolderPath, false, previousScrollTop);
                    }
                } else if (result.error !== 'Nothing to redo') {
                    showToast(`Redo failed: ${result.error}`, 'error');
                }
            }).catch(err => {
                showToast(`Redo failed: ${friendlyError(err)}`, 'error');
            });
            return;
        }

        // Undo file operation
        if (matchesShortcut(e, 'undo')) {
            e.preventDefault();
            window.electronAPI.undoFileOperation().then(result => {
                if (result.success) {
                    showToast(`Undo: ${result.description}`, 'success');
                    if (currentFolderPath) {
                        invalidateFolderCache(currentFolderPath);
                        const previousScrollTop = gridContainer.scrollTop;
                        loadVideos(currentFolderPath, false, previousScrollTop);
                    }
                } else if (result.error !== 'Nothing to undo') {
                    showToast(`Undo failed: ${result.error}`, 'error');
                }
            }).catch(err => {
                showToast(`Undo failed: ${friendlyError(err)}`, 'error');
            });
            return;
        }

        // Focus search
        if (matchesShortcut(e, 'search')) {
            e.preventDefault();
            searchBox.focus();
            searchBox.select();
            return;
        }

        // Open folder
        if (matchesShortcut(e, 'openFolder')) {
            e.preventDefault();
            selectFolderBtn.click();
            return;
        }

        // Escape: Close dialogs/lightbox/shortcuts, or clear selection
        if (e.key === 'Escape') {
            if (!shortcutsOverlay.classList.contains('hidden')) {
                shortcutsOverlay.classList.add('hidden');
            } else if (!lightbox.classList.contains('hidden')) {
                closeLightbox();
            } else if (!renameDialog.classList.contains('hidden')) {
                handleRenameCancel();
            } else if (document.getElementById('duplicates-modal') && !document.getElementById('duplicates-modal').classList.contains('hidden')) {
                closeDuplicatesModal();
            } else if (!toolsMenuDropdown.classList.contains('hidden')) {
                toolsMenuDropdown.classList.add('hidden');
            } else if (marqueeActive || marqueePending) {
                cancelMarquee();
            } else if (selectedCardPaths.size > 0) {
                clearCardSelection();
            }
            return;
        }

        // Select all visible file items
        if (matchesShortcut(e, 'selectAll')) {
            e.preventDefault();
            selectAllCards();
            return;
        }

        // Arrow keys: Navigate thumbnails (always use direct key check — not remappable)
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
            e.preventDefault();
            navigateCards(e.key);
            return;
        }

        // Open focused card
        if (matchesShortcut(e, 'openCard') && focusedCardIndex >= 0) {
            e.preventDefault();
            const card = visibleCards[focusedCardIndex];
            if (card) {
                if (card.classList.contains('folder-card')) {
                    const path = card.dataset.folderPath;
                    if (path) {
                        // Use setTimeout to yield control back to event loop, making button responsive
                        setTimeout(() => {
                            navigateToFolder(path).catch(err => {
                                console.error('Error navigating to folder:', err);
                                hideLoadingIndicator();
                            });
                        }, 0);
                    }
                } else {
                    const url = card.dataset.src;
                    const path = card.dataset.path;
                    const name = card.querySelector('.video-info')?.textContent || '';
                    if (url) openLightbox(url, path, name);
                }
            }
            return;
        }

        // Delete: batch-delete selection if 2+ selected, otherwise delete focused file
        if (matchesShortcut(e, 'deleteCard')) {
            if (selectedCardPaths.size >= 2) {
                e.preventDefault();
                const paths = [...selectedCardPaths];
                const count = paths.length;
                const deleteLabel = useSystemTrash ? 'Move to Recycle Bin' : 'Delete';
                const promptLabel = useSystemTrash
                    ? `Move ${count} files to the Recycle Bin?`
                    : `Delete ${count} files?`;
                if (await showConfirm(deleteLabel, promptLabel, { confirmLabel: deleteLabel, danger: true })) {
                    showProgress(0, count, `${deleteLabel.replace(/ing$/, '')}ing ${count} files...`);
                    try {
                        window.electronAPI.onBatchDeleteProgress((_evt, data) => {
                            updateProgress(data.current, data.total);
                        });
                        const result = await window.electronAPI.deleteFilesBatch(paths);
                        window.electronAPI.removeBatchDeleteProgressListener();
                        hideProgress();
                        const failCount = result.failed ? result.failed.length : 0;
                        const successCount = count - failCount;
                        if (successCount > 0) {
                            const msg = useSystemTrash
                                ? `Moved ${successCount} files to Recycle Bin`
                                : `Deleted ${successCount} files`;
                            showToast(msg, failCount > 0 ? 'warning' : 'success', {
                                duration: 8000,
                                details: failCount > 0 ? `${failCount} failed` : undefined,
                                actionLabel: useSystemTrash ? undefined : 'Undo',
                                actionCallback: useSystemTrash ? undefined : () => {
                                    window.electronAPI.undoFileOperation().then(undoResult => {
                                        if (undoResult.success) {
                                            showToast(`Restored ${successCount} files`, 'success');
                                            if (currentFolderPath) {
                                                invalidateFolderCache(currentFolderPath);
                                                const st = gridContainer.scrollTop;
                                                loadVideos(currentFolderPath, false, st);
                                            }
                                        } else {
                                            showToast(`Undo failed: ${undoResult.error}`, 'error');
                                        }
                                    }).catch(err => {
                                        showToast(`Undo failed: ${friendlyError(err)}`, 'error');
                                    });
                                }
                            });
                        } else if (failCount > 0) {
                            showToast(`Could not delete ${failCount} files`, 'error');
                        }
                        clearCardSelection();
                        if (currentFolderPath) {
                            invalidateFolderCache(currentFolderPath);
                            const previousScrollTop = gridContainer.scrollTop;
                            loadVideos(currentFolderPath, false, previousScrollTop);
                        }
                    } catch (err) {
                        window.electronAPI.removeBatchDeleteProgressListener();
                        hideProgress();
                        showToast(`Batch delete failed: ${friendlyError(err)}`, 'error');
                    }
                }
                return;
            }

            if (focusedCardIndex >= 0) {
                e.preventDefault();
                const card = visibleCards[focusedCardIndex];
                if (card && !card.classList.contains('folder-card')) {
                    const path = card.dataset.path;
                    const name = card.querySelector('.video-info')?.textContent || '';
                    if (path && await showConfirm('Delete File', `Delete "${name}"?`, { confirmLabel: 'Delete', danger: true })) {
                        setStatusActivity(`Deleting ${name}...`);
                        window.electronAPI.deleteFile(path).then(result => {
                            setStatusActivity('');
                            if (result.success) {
                                showToast(`Deleted "${name}"`, 'success', {
                                    duration: 8000,
                                    actionLabel: 'Undo',
                                    actionCallback: () => {
                                        window.electronAPI.undoFileOperation().then(undoResult => {
                                            if (undoResult.success) {
                                                showToast(`Restored "${name}"`, 'success');
                                                if (currentFolderPath) {
                                                    invalidateFolderCache(currentFolderPath);
                                                    const st = gridContainer.scrollTop;
                                                    loadVideos(currentFolderPath, false, st);
                                                }
                                            } else {
                                                showToast(`Undo failed: ${undoResult.error}`, 'error');
                                            }
                                        }).catch(err => {
                                            showToast(`Undo failed: ${friendlyError(err)}`, 'error');
                                        });
                                    }
                                });
                                if (currentFolderPath) {
                                    invalidateFolderCache(currentFolderPath);
                                    const previousScrollTop = gridContainer.scrollTop;
                                    loadVideos(currentFolderPath, false, previousScrollTop);
                                }
                            } else {
                                showToast(`Could not delete file: ${friendlyError(result.error)}`, 'error');
                            }
                        }).catch(err => {
                            setStatusActivity('');
                            showToast(`Could not delete file: ${friendlyError(err)}`, 'error');
                        });
                    }
                }
                return;
            }
        }

        // Rename focused file
        if (matchesShortcut(e, 'rename') && focusedCardIndex >= 0) {
            e.preventDefault();
            const card = visibleCards[focusedCardIndex];
            if (card && !card.classList.contains('folder-card')) {
                const path = card.dataset.path;
                const name = card.querySelector('.video-info')?.textContent || '';
                if (path) {
                    renamePendingFile = { filePath: path, fileName: name };
                    renameInput.value = name;
                    renameDialog.classList.remove('hidden');
                    renameInput.focus();
                    renameInput.select();
                }
            }
            return;
        }

        // Go back
        if (matchesShortcut(e, 'goBack') && e.target.tagName !== 'INPUT') {
            if (navigationHistory.canGoBack()) {
                e.preventDefault();
                goBack();
            }
            return;
        }

        // Go back (alt binding)
        if (matchesShortcut(e, 'goBackAlt')) {
            e.preventDefault();
            if (navigationHistory.canGoBack()) goBack();
            return;
        }

        // Go forward
        if (matchesShortcut(e, 'goForward')) {
            e.preventDefault();
            if (navigationHistory.canGoForward()) goForward();
            return;
        }

        // Filters
        if (matchesShortcut(e, 'filterAll')) { e.preventDefault(); switchFilter('all'); return; }
        if (matchesShortcut(e, 'filterVideo')) { e.preventDefault(); switchFilter('video'); return; }
        if (matchesShortcut(e, 'filterImage')) { e.preventDefault(); switchFilter('image'); return; }

        // Toggle keyboard shortcuts cheat sheet
        if (matchesShortcut(e, 'showShortcuts')) {
            e.preventDefault();
            toggleShortcutsOverlay();
            return;
        }

        // Toggle grid/masonry layout
        if (matchesShortcut(e, 'toggleLayout')) {
            e.preventDefault();
            layoutModeToggle.checked = !layoutModeToggle.checked;
            switchLayoutMode();
            return;
        }

        // Toggle sidebar
        if (matchesShortcut(e, 'collapseSidebar')) {
            e.preventDefault();
            setSidebarCollapsed(!sidebarCollapsed);
            return;
        }

        // Open lightbox for focused card
        if (matchesShortcut(e, 'lightboxOpen') && focusedCardIndex >= 0) {
            e.preventDefault();
            const card = visibleCards[focusedCardIndex];
            if (card && !card.classList.contains('folder-card')) {
                const url = card.dataset.src;
                const filePath = card.dataset.path;
                const name = card.querySelector('.video-info')?.textContent || '';
                if (url) openLightbox(url, filePath, name);
            }
            return;
        }

        // Zoom in
        if (matchesShortcut(e, 'zoomIn')) {
            e.preventDefault();
            const newZoom = Math.min(200, zoomLevel + 10);
            zoomSlider.value = newZoom;
            zoomLevel = newZoom;
            applyZoom();
            deferLocalStorageWrite('zoomLevel', zoomLevel.toString());
            updateStatusBar();
            return;
        }

        // Zoom out
        if (matchesShortcut(e, 'zoomOut')) {
            e.preventDefault();
            const newZoom = Math.max(50, zoomLevel - 10);
            zoomSlider.value = newZoom;
            zoomLevel = newZoom;
            applyZoom();
            deferLocalStorageWrite('zoomLevel', zoomLevel.toString());
            updateStatusBar();
            return;
        }

        // Reset zoom
        if (matchesShortcut(e, 'zoomReset')) {
            e.preventDefault();
            zoomSlider.value = 100;
            zoomLevel = 100;
            applyZoom();
            deferLocalStorageWrite('zoomLevel', '100');
            updateStatusBar();
            return;
        }

        // Start Slideshow
        if (matchesShortcut(e, 'slideshow')) {
            e.preventDefault();
            if (typeof startSlideshow === 'function') startSlideshow();
            return;
        }

        // Compare selected files (2-4)
        if (matchesShortcut(e, 'compare')) {
            if (selectedCardPaths.size >= 2 && selectedCardPaths.size <= 4) {
                e.preventDefault();
                if (typeof openCompareMode === 'function') openCompareMode([...selectedCardPaths]);
            }
            return;
        }
    });
}

function navigateCards(direction) {
    const cards = Array.from(gridContainer.querySelectorAll('.video-card, .folder-card'))
        .filter(card => card.style.display !== 'none');
    
    if (cards.length === 0) return;

    visibleCards = cards;

    if (focusedCardIndex < 0) {
        // Find first visible card
        const firstVisible = cards.find(card => {
            const rect = card.getBoundingClientRect();
            return rect.top >= 0 && rect.top < window.innerHeight;
        });
        focusedCardIndex = firstVisible ? cards.indexOf(firstVisible) : 0;
    } else {
        // Navigate based on direction
        const currentCard = cards[focusedCardIndex];
        if (!currentCard) {
            focusedCardIndex = 0;
        } else {
            const rect = currentCard.getBoundingClientRect();
            const cardCenterX = rect.left + rect.width / 2;
            const cardCenterY = rect.top + rect.height / 2;

            let nextIndex = focusedCardIndex;
            if (direction === 'ArrowRight' || direction === 'ArrowDown') {
                // Find next visible card
                for (let i = focusedCardIndex + 1; i < cards.length; i++) {
                    if (cards[i].style.display !== 'none') {
                        nextIndex = i;
                        break;
                    }
                }
            } else if (direction === 'ArrowLeft' || direction === 'ArrowUp') {
                // Find previous visible card
                for (let i = focusedCardIndex - 1; i >= 0; i--) {
                    if (cards[i].style.display !== 'none') {
                        nextIndex = i;
                        break;
                    }
                }
            }

            focusedCardIndex = Math.max(0, Math.min(cards.length - 1, nextIndex));
        }
    }

    // Update focus visual
    cards.forEach((card, index) => {
        if (index === focusedCardIndex) {
            card.style.outline = '2px solid var(--accent-color)';
            card.style.outlineOffset = '2px';
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            card.style.outline = '';
            card.style.outlineOffset = '';
        }
    });

    // Update status bar with focused card info
    updateStatusBarSelection(cards[focusedCardIndex] || null);
}

function switchFilter(filter) {
    currentFilter = filter;
    filterAllBtn.classList.remove('active');
    filterVideosBtn.classList.remove('active');
    filterImagesBtn.classList.remove('active');

    
    if (filter === 'all') filterAllBtn.classList.add('active');
    else if (filter === 'video') filterVideosBtn.classList.add('active');
    else if (filter === 'image') filterImagesBtn.classList.add('active');

    
    applyFilters();
    focusedCardIndex = -1; // Reset focus
}

// ==================== FAVORITES ====================
function defaultFavoritesStructure() {
    return { version: 2, groups: [{ id: 'uncategorized', name: 'Uncategorized', collapsed: false, items: [] }] };
}

async function loadFavorites() {
    try {
        const result = await window.electronAPI.dbGetFavorites();
        if (result.success && result.data && result.data.groups && result.data.groups.length > 0) {
            favorites = result.data;
            // Ensure each item has a 'name' derived from path (SQLite only stores path)
            for (const group of favorites.groups) {
                for (const item of group.items) {
                    if (!item.name && item.path) {
                        item.name = item.path.split(/[/\\]/).pop();
                    }
                }
            }
        } else {
            favorites = defaultFavoritesStructure();
        }
    } catch (e) {
        favorites = defaultFavoritesStructure();
    }
    renderFavorites();
}

function saveFavorites() {
    window.electronAPI.dbSaveFavorites(favorites);
}

function renderFavorites() {
    favoritesList.innerHTML = '';
    const totalItems = favorites.groups.reduce((sum, g) => sum + g.items.length, 0);
    if (totalItems === 0 && favorites.groups.length <= 1) {
        favoritesList.innerHTML = '<div class="tools-menu-empty">No favorites yet</div>';
        return;
    }
    favorites.groups.forEach((group) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'fav-group';
        groupEl.dataset.groupId = group.id;

        // Group header
        const header = document.createElement('div');
        header.className = 'fav-group-header';
        header.innerHTML = `
            <span class="fav-group-toggle ${group.collapsed ? '' : 'expanded'}">${icon('chevron-right', 12)}</span>
            <span class="fav-group-name">${group.name}</span>
            <span class="fav-group-count">${group.items.length}</span>
        `;
        header.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent document handler from closing menu after DOM rebuild
            toggleGroupCollapse(group.id);
        });
        header.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showFavGroupContextMenu(e, group.id);
        });

        // Drop target on group header
        header.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer.types.includes('application/x-fav-drag')) {
                e.dataTransfer.dropEffect = 'move';
                header.classList.add('fav-drag-over');
            }
        });
        header.addEventListener('dragleave', (e) => {
            e.stopPropagation();
            header.classList.remove('fav-drag-over');
        });
        header.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            header.classList.remove('fav-drag-over');
            try {
                const data = JSON.parse(e.dataTransfer.getData('application/x-fav-drag'));
                if (data.groupId !== group.id) {
                    moveFavoriteToGroup(data.groupId, data.index, group.id);
                }
            } catch (_) {}
        });

        groupEl.appendChild(header);

        // Group items container
        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'fav-group-items' + (group.collapsed ? ' collapsed' : '');

        // Drop target on items container (for dropping into empty or expanded groups)
        itemsContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer.types.includes('application/x-fav-drag')) {
                e.dataTransfer.dropEffect = 'move';
                header.classList.add('fav-drag-over');
            }
        });
        itemsContainer.addEventListener('dragleave', (e) => {
            e.stopPropagation();
            if (!itemsContainer.contains(e.relatedTarget)) {
                header.classList.remove('fav-drag-over');
            }
        });
        itemsContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            header.classList.remove('fav-drag-over');
            try {
                const data = JSON.parse(e.dataTransfer.getData('application/x-fav-drag'));
                if (data.groupId !== group.id) {
                    moveFavoriteToGroup(data.groupId, data.index, group.id);
                }
            } catch (_) {}
        });

        group.items.forEach((fav, index) => {
            const item = document.createElement('div');
            item.className = 'quick-access-item';
            item.draggable = true;
            item.innerHTML = `
                <span class="quick-access-item-name" title="${fav.path}">${fav.name}</span>
                <span class="quick-access-item-remove" data-group="${group.id}" data-index="${index}">${icon('x', 14)}</span>
            `;

            // Drag source
            item.addEventListener('dragstart', (e) => {
                e.stopPropagation();
                e.dataTransfer.setData('application/x-fav-drag', JSON.stringify({ groupId: group.id, index }));
                e.dataTransfer.effectAllowed = 'move';
                item.classList.add('fav-dragging');
            });
            item.addEventListener('dragend', () => {
                item.classList.remove('fav-dragging');
            });

            item.addEventListener('click', (e) => {
                if (e.target.closest('.quick-access-item-remove')) {
                    e.stopPropagation();
                    removeFavorite(group.id, index);
                } else {
                    toolsMenuDropdown.classList.add('hidden');
                    setTimeout(() => {
                        navigateToFolder(fav.path).catch(err => {
                            console.error('Error navigating to favorite:', err);
                            hideLoadingIndicator();
                        });
                    }, 0);
                }
            });
            item.addEventListener('mousedown', (e) => {
                if (e.button === 1) {
                    e.preventDefault();
                }
            });
            item.addEventListener('auxclick', (e) => {
                if (e.button === 1) {
                    e.preventDefault();
                    e.stopPropagation();
                    const displayName = fav.path.split(/[/\\]/).pop();
                    createTab(fav.path, displayName);
                }
            });
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showFavItemContextMenu(e, group.id, index);
            });
            itemsContainer.appendChild(item);
        });
        groupEl.appendChild(itemsContainer);
        favoritesList.appendChild(groupEl);
    });
}

function addFavorite(path, name, groupId = 'uncategorized') {
    if (!path) return;
    // Check for duplicates across all groups
    const isDuplicate = favorites.groups.some(g => g.items.some(f => f.path === path));
    if (isDuplicate) return;
    const group = favorites.groups.find(g => g.id === groupId);
    if (!group) return;
    group.items.push({ path, name: name || path.split(/[/\\]/).pop() });
    saveFavorites();
    renderFavorites();
}

function removeFavorite(groupId, itemIndex) {
    const group = favorites.groups.find(g => g.id === groupId);
    if (!group) return;
    group.items.splice(itemIndex, 1);
    saveFavorites();
    renderFavorites();
}

function toggleGroupCollapse(groupId) {
    const group = favorites.groups.find(g => g.id === groupId);
    if (!group) return;
    group.collapsed = !group.collapsed;
    saveFavorites();
    renderFavorites();
}

function createFavoriteGroup(name) {
    if (!name || !name.trim()) return;
    favorites.groups.push({ id: 'grp_' + Date.now(), name: name.trim(), collapsed: false, items: [] });
    saveFavorites();
    renderFavorites();
}

function renameFavoriteGroup(groupId, newName) {
    if (groupId === 'uncategorized' || !newName || !newName.trim()) return;
    const group = favorites.groups.find(g => g.id === groupId);
    if (!group) return;
    group.name = newName.trim();
    saveFavorites();
    renderFavorites();
}

function deleteFavoriteGroup(groupId) {
    if (groupId === 'uncategorized') return;
    const groupIndex = favorites.groups.findIndex(g => g.id === groupId);
    if (groupIndex === -1) return;
    const uncategorized = favorites.groups.find(g => g.id === 'uncategorized');
    // Move items to uncategorized before deleting
    uncategorized.items.push(...favorites.groups[groupIndex].items);
    favorites.groups.splice(groupIndex, 1);
    saveFavorites();
    renderFavorites();
}

function moveFavoriteToGroup(fromGroupId, itemIndex, toGroupId) {
    const fromGroup = favorites.groups.find(g => g.id === fromGroupId);
    const toGroup = favorites.groups.find(g => g.id === toGroupId);
    if (!fromGroup || !toGroup || fromGroupId === toGroupId) return;
    const [item] = fromGroup.items.splice(itemIndex, 1);
    if (!item) return;
    toGroup.items.push(item);
    saveFavorites();
    renderFavorites();
}

function hideFavContextMenu() {
    if (favContextMenu) favContextMenu.classList.add('hidden');
}

function showFavGroupContextMenu(e, groupId) {
    hideFavContextMenu();
    hideContextMenu();
    favContextMenu.innerHTML = '';

    const newGroupItem = document.createElement('div');
    newGroupItem.className = 'context-menu-item';
    newGroupItem.textContent = 'New Group';
    newGroupItem.addEventListener('click', () => {
        hideFavContextMenu();
        promptFavGroupName((name) => createFavoriteGroup(name));
    });
    favContextMenu.appendChild(newGroupItem);

    if (groupId !== 'uncategorized') {
        const renameItem = document.createElement('div');
        renameItem.className = 'context-menu-item';
        renameItem.textContent = 'Rename Group';
        renameItem.addEventListener('click', () => {
            hideFavContextMenu();
            const group = favorites.groups.find(g => g.id === groupId);
            if (group) promptFavGroupName((name) => renameFavoriteGroup(groupId, name), group.name);
        });
        favContextMenu.appendChild(renameItem);

        const divider = document.createElement('div');
        divider.className = 'context-menu-divider';
        favContextMenu.appendChild(divider);

        const deleteItem = document.createElement('div');
        deleteItem.className = 'context-menu-item context-menu-item-danger';
        deleteItem.textContent = 'Delete Group';
        deleteItem.addEventListener('click', () => {
            hideFavContextMenu();
            deleteFavoriteGroup(groupId);
        });
        favContextMenu.appendChild(deleteItem);
    }

    positionFavContextMenu(e);
}

function showFavItemContextMenu(e, groupId, itemIndex) {
    hideFavContextMenu();
    hideContextMenu();
    favContextMenu.innerHTML = '';

    const group = favorites.groups.find(g => g.id === groupId);
    if (!group || !group.items[itemIndex]) return;
    const fav = group.items[itemIndex];

    // Open
    const openItem = document.createElement('div');
    openItem.className = 'context-menu-item';
    openItem.textContent = 'Open';
    openItem.addEventListener('click', () => {
        hideFavContextMenu();
        toolsMenuDropdown.classList.add('hidden');
        setTimeout(() => navigateToFolder(fav.path).catch(() => {}), 0);
    });
    favContextMenu.appendChild(openItem);

    // Move to submenu
    const otherGroups = favorites.groups.filter(g => g.id !== groupId);
    if (otherGroups.length > 0) {
        const moveContainer = document.createElement('div');
        moveContainer.className = 'context-menu-submenu';
        const moveLabel = document.createElement('div');
        moveLabel.className = 'context-menu-item';
        moveLabel.innerHTML = `Move to <span style="float:right; opacity:0.5">${icon('chevron-right', 12)}</span>`;
        moveContainer.appendChild(moveLabel);

        const submenu = document.createElement('div');
        submenu.className = 'context-menu-submenu-items';
        otherGroups.forEach((targetGroup) => {
            const subItem = document.createElement('div');
            subItem.className = 'context-menu-item';
            subItem.textContent = targetGroup.name;
            subItem.addEventListener('click', () => {
                hideFavContextMenu();
                moveFavoriteToGroup(groupId, itemIndex, targetGroup.id);
            });
            submenu.appendChild(subItem);
        });
        moveContainer.appendChild(submenu);
        favContextMenu.appendChild(moveContainer);
    }

    // Divider + Remove
    const divider = document.createElement('div');
    divider.className = 'context-menu-divider';
    favContextMenu.appendChild(divider);

    const removeItem = document.createElement('div');
    removeItem.className = 'context-menu-item context-menu-item-danger';
    removeItem.textContent = 'Remove from Favorites';
    removeItem.addEventListener('click', () => {
        hideFavContextMenu();
        removeFavorite(groupId, itemIndex);
    });
    favContextMenu.appendChild(removeItem);

    positionFavContextMenu(e);
}

function positionFavContextMenu(e) {
    favContextMenu.classList.remove('hidden');
    const menuWidth = 180;
    const menuHeight = favContextMenu.offsetHeight || 150;
    let x = e.clientX;
    let y = e.clientY;
    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 5;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 5;
    favContextMenu.style.left = `${x}px`;
    favContextMenu.style.top = `${y}px`;
}

function promptFavGroupName(callback, defaultValue = '') {
    const dialog = document.getElementById('rename-dialog');
    const input = document.getElementById('rename-input');
    const heading = dialog.querySelector('h3');
    const confirmBtn = document.getElementById('rename-confirm-btn');
    const cancelBtn = document.getElementById('rename-cancel-btn');

    const originalHeading = heading.textContent;
    const originalConfirm = confirmBtn.textContent;
    heading.textContent = defaultValue ? 'Rename Group' : 'New Group';
    confirmBtn.textContent = defaultValue ? 'Rename' : 'Create';
    input.value = defaultValue;
    input.placeholder = 'Group name';
    dialog.classList.remove('hidden');
    input.focus();
    input.select();

    function cleanup() {
        dialog.classList.add('hidden');
        heading.textContent = originalHeading;
        confirmBtn.textContent = originalConfirm;
        input.placeholder = 'Enter new name';
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click', onCancel);
        input.removeEventListener('keydown', onKeydown);
    }
    function onConfirm() {
        const val = input.value.trim();
        cleanup();
        if (val) callback(val);
    }
    function onCancel() {
        cleanup();
    }
    function onKeydown(e) {
        if (e.key === 'Enter') onConfirm();
        else if (e.key === 'Escape') onCancel();
    }
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);
}

// ==================== RECENT FILES ====================
async function loadRecentFiles() {
    try {
        const result = await window.electronAPI.dbGetRecentFiles(recentFilesLimitSetting);
        if (result.success && result.data) {
            // SQLite only stores {path, addedAt}. Derive name/type/url for rendering.
            recentFiles = result.data.map(r => {
                const p = r.path;
                const name = p.split(/[/\\]/).pop();
                const ext = (name.split('.').pop() || '').toLowerCase();
                const videoExts = ['mp4', 'avi', 'mkv', 'mov', 'webm', 'wmv', 'flv', 'm4v'];
                const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg', 'ico'];
                let type = 'unknown';
                if (videoExts.includes(ext)) type = 'video';
                else if (imageExts.includes(ext)) type = 'image';
                return {
                    path: p,
                    name,
                    url: 'file:///' + p.replace(/\\/g, '/'),
                    type,
                    timestamp: r.addedAt || Date.now()
                };
            });
        } else {
            recentFiles = [];
        }
    } catch (e) {
        recentFiles = [];
    }
    renderRecentFiles();
}

function saveRecentFiles() {
    // Legacy: kept as no-op for any stale call sites
}

function addRecentFile(path, name, url, type) {
    // Remove if already exists
    recentFiles = recentFiles.filter(f => f.path !== path);
    // Add to beginning
    recentFiles.unshift({
        path,
        name: name || path.split(/[/\\]/).pop(),
        url,
        type,
        timestamp: Date.now()
    });
    // Keep only last 50
    recentFiles = recentFiles.slice(0, recentFilesLimitSetting);
    // Persist to SQLite
    window.electronAPI.dbAddRecentFile({ path, addedAt: Date.now() }, recentFilesLimitSetting);
    renderRecentFiles();
}

function renderRecentFiles() {
    recentFilesList.innerHTML = '';
    if (recentFiles.length === 0) {
        recentFilesList.innerHTML = '<div class="tools-menu-empty">No recent files</div>';
        return;
    }
    recentFiles.forEach((file) => {
        const item = document.createElement('div');
        item.className = 'recent-file-item quick-access-item';
        const timeAgo = getTimeAgo(file.timestamp);
        item.innerHTML = `
            <span class="quick-access-item-name" title="${file.path}">${file.name}</span>
            <span style="font-size: 11px; opacity: 0.6;">${timeAgo}</span>
        `;
        
        // Add preview on hover
        if (file.type === 'image' || file.type === 'video') {
            item.addEventListener('mouseenter', (e) => {
                const preview = document.createElement('div');
                preview.className = 'recent-file-preview';
                
                if (file.type === 'image') {
                    const img = document.createElement('img');
                    img.src = file.url;
                    preview.appendChild(img);
                } else if (file.type === 'video') {
                    const video = document.createElement('video');
                    video.src = file.url;
                    video.muted = true;
                    video.loop = true;
                    video.play().catch(() => {});
                    preview.appendChild(video);
                }
                
                document.body.appendChild(preview);
                
                // Position preview to the left of the item
                const itemRect = item.getBoundingClientRect();
                let top = itemRect.top;

                preview.style.top = `${top}px`;
                preview.style.visibility = 'hidden';
                preview.style.display = 'block';

                // Default to left, fall back to right if no room
                setTimeout(() => {
                    const previewRect = preview.getBoundingClientRect();
                    let left = itemRect.left - previewRect.width - 10;
                    if (left < 0) {
                        left = itemRect.right + 10;
                    }
                    if (top + previewRect.height > window.innerHeight) {
                        top = window.innerHeight - previewRect.height - 10;
                        preview.style.top = `${top}px`;
                    }
                    preview.style.left = `${left}px`;
                    preview.style.visibility = 'visible';
                }, 10);
                
                item.dataset.previewId = 'preview-' + Date.now();
                preview.id = item.dataset.previewId;
            });
            
            item.addEventListener('mouseleave', () => {
                const previewId = item.dataset.previewId;
                if (previewId) {
                    const preview = document.getElementById(previewId);
                    if (preview) {
                        preview.remove();
                        delete item.dataset.previewId;
                    }
                }
            });
        }
        
        item.addEventListener('click', () => {
            // Remove hover preview before opening lightbox
            const previewId = item.dataset.previewId;
            if (previewId) {
                const preview = document.getElementById(previewId);
                if (preview) preview.remove();
                delete item.dataset.previewId;
            }
            openLightbox(file.url, file.path, file.name);
            toolsMenuDropdown.classList.add('hidden');
        });
        recentFilesList.appendChild(item);
    });
}

function getTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function clearRecentFiles() {
    recentFiles = [];
    window.electronAPI.dbClearRecentFiles();
    renderRecentFiles();
}

// ==================== TABS ====================
function loadTabs() {
    const saved = localStorage.getItem('tabs');
    if (saved) {
        try {
            tabs = JSON.parse(saved);
            tabIdCounter = Math.max(...tabs.map(t => t.id), 0) + 1;
            // Initialize per-tab history fields for tabs saved before this feature
            for (const tab of tabs) {
                if (!tab.historyPaths) {
                    tab.historyPaths = tab.path ? [tab.path] : [];
                    tab.historyIndex = tab.historyPaths.length - 1;
                }
            }
        } catch (e) {
            tabs = [];
        }
    }
    if (tabs.length === 0) {
        // Create initial tab if none exist
        createTab(null, 'Home');
    }
    renderTabs();
    const savedActiveTabId = localStorage.getItem('activeTabId');
    if (savedActiveTabId) activeTabId = parseInt(savedActiveTabId, 10);
    if (activeTabId && tabs.find(t => t.id === activeTabId)) {
        switchToTab(activeTabId);
    } else if (tabs.length > 0) {
        switchToTab(tabs[0].id);
    }
}

function saveTabs() {
    deferLocalStorageWrite('tabs', JSON.stringify(tabs));
    deferLocalStorageWrite('activeTabId', activeTabId);
}

// Snapshot the current tab's DOM into a DocumentFragment for instant restore
function snapshotCurrentTabDom() {
    if (activeTabId == null || gridContainer.children.length === 0) return;
    // Capture scroll BEFORE moving children (moving empties the container and resets scrollTop)
    const scrollTop = gridContainer.scrollTop || window.scrollY || 0;
    // Save per-folder scroll position for the current folder in this tab
    if (currentFolderPath) {
        getTabScrollMap(activeTabId).set(normalizePath(currentFolderPath), scrollTop);
    }
    const fragment = document.createDocumentFragment();
    // Move children to fragment (detaches from DOM without destroying)
    while (gridContainer.firstChild) {
        fragment.appendChild(gridContainer.firstChild);
    }
    tabDomCache.set(activeTabId, {
        fragment,
        scrollTop,
        layoutMode: layoutMode,
        timestamp: Date.now()
    });
}

// Restore a tab's DOM snapshot if available. Returns true if restored.
function restoreTabDomSnapshot(tabId) {
    const snapshot = tabDomCache.get(tabId);
    if (!snapshot) return false;
    // Check if snapshot is still fresh (use same TTL as tab content cache)
    if ((Date.now() - snapshot.timestamp) > FOLDER_CACHE_TTL) {
        tabDomCache.delete(tabId);
        return false;
    }
    // Clear current grid without destroying media (it belongs to old tab snapshot)
    while (gridContainer.firstChild) {
        gridContainer.removeChild(gridContainer.firstChild);
    }
    // Re-attach the cached fragment
    gridContainer.appendChild(snapshot.fragment);
    // Restore layout mode
    if (snapshot.layoutMode === 'masonry') {
        gridContainer.classList.add('masonry');
        gridContainer.classList.remove('grid');
    } else {
        gridContainer.classList.add('grid');
        gridContainer.classList.remove('masonry');
    }
    // Restore scroll position after DOM is attached
    requestAnimationFrame(() => {
        gridContainer.scrollTop = snapshot.scrollTop;
        window.scrollTo(0, snapshot.scrollTop);
        // Re-run cleanup cycle to manage media visibility
        scheduleCleanupCycle();
    });
    tabDomCache.delete(tabId); // Consumed
    return true;
}

function createTab(path, name, collectionId = null) {
    const tab = {
        id: tabIdCounter++,
        path: path || null,
        name: name || (path ? path.split(/[/\\]/).filter(Boolean).pop() : 'Home'),
        sortType: sortType || 'name', // Use current sorting or default
        sortOrder: sortOrder || 'ascending', // Use current order or default
        historyPaths: [],
        historyIndex: -1,
        collectionId: collectionId || null
    };
    tabs.push(tab);
    saveTabs();
    renderTabs();
    switchToTab(tab.id);
    if (path) {
        // Use setTimeout to yield control back to event loop, making button responsive
        setTimeout(() => {
            navigateToFolder(path).catch(err => {
                console.error('Error navigating to tab folder:', err);
                hideLoadingIndicator();
            });
        }, 0);
    }
    return tab.id;
}

function closeTab(tabId) {
    if (tabs.length <= 1) return; // Don't close last tab
    // Clean up DOM cache for the closed tab
    tabDomCache.delete(tabId);
    tabFolderScrollPositions.delete(tabId);
    tabContentCache.delete(tabId);
    tabs = tabs.filter(t => t.id !== tabId);
    if (activeTabId === tabId) {
        activeTabId = tabs[0]?.id ?? null;
    }
    // switchToTab already calls saveTabs() + renderTabs(), so skip them here
    if (activeTabId != null) {
        switchToTab(activeTabId);
    } else {
        saveTabs();
        renderTabs();
    }
}

function switchToTab(tabId) {
    const previousTabId = activeTabId;

    // Snapshot current tab's DOM before switching away (for instant restore later)
    if (previousTabId && previousTabId !== tabId) {
        snapshotCurrentTabDom();
    }

    activeTabId = tabId;
    // Update back/forward buttons for this tab's history
    navigationHistory.updateButtons();
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
        // Restore tab's sorting preferences
        sortType = tab.sortType || 'name';
        sortOrder = tab.sortOrder || 'ascending';

        // Update UI to reflect tab's sorting preferences
        if (sortTypeSelect) sortTypeSelect.value = sortType;
        if (sortOrderSelect) sortOrderSelect.value = sortOrder;

        // Handle collection tabs
        if (tab.collectionId) {
            currentCollectionId = tab.collectionId;
            currentFolderPath = null;
            setTimeout(() => {
                loadCollectionIntoGrid(tab.collectionId).catch(err => {
                    console.error('Error loading collection tab:', err);
                    hideLoadingIndicator();
                });
            }, 0);
            saveTabs();
            renderTabs();
            return;
        }

        if (tab.path) {
            // Look up saved per-folder scroll position for this tab
            const savedScroll = getTabScrollMap(tabId).get(normalizePath(tab.path));

            // Try DOM snapshot first for the item data, then fall back to content cache
            const snapshot = tabDomCache.get(tabId);
            const tabCache = tabContentCache.get(tabId);
            const now = Date.now();
            const normalizedTabPath = normalizePath(tab.path);

            // Consume DOM snapshot (we won't use the fragment, but clear it to free memory)
            if (snapshot) tabDomCache.delete(tabId);

            if (tabCache) {
                const cachePathNormalized = normalizePath(tabCache.path);
                if ((cachePathNormalized === normalizedTabPath || tabCache.path === tab.path) &&
                    (now - tabCache.timestamp) < FOLDER_CACHE_TTL) {
                    // Use cached content with proper virtual scroll initialization
                    // Cancel any in-flight smart collection scan
                    if (currentCollectionId) {
                        currentCollectionId = null;
                        _collectionLoadToken++;
                        highlightActiveCollection(null);
                    }
                    currentFolderPath = tab.path;
                    currentItems = tabCache.items;
                    updateBreadcrumb(tab.path);
                    searchBox.value = '';
                    currentFilter = 'all';
                    filterAllBtn.classList.add('active');
                    filterVideosBtn.classList.remove('active');
                    filterImagesBtn.classList.remove('active');

                    const filteredItems = filterItems(tabCache.items);
                    const sortedItems = sortItems(filteredItems);
                    renderItems(sortedItems, savedScroll !== undefined ? savedScroll : null);
                    sidebarExpandToPath(tab.path);
                } else {
                    setTimeout(() => {
                        navigateToFolder(tab.path, false).catch(err => {
                            console.error('Error navigating to tab folder:', err);
                            hideLoadingIndicator();
                        });
                    }, 0);
                }
            } else {
                setTimeout(() => {
                    navigateToFolder(tab.path, false).catch(err => {
                        console.error('Error navigating to tab folder:', err);
                        hideLoadingIndicator();
                    });
                }, 0);
                }

        } else {
            // If tab has no path, clear the grid
            if (currentCollectionId) {
                currentCollectionId = null;
                _collectionLoadToken++;
                highlightActiveCollection(null);
            }
            gridContainer.innerHTML = '';
            currentHoveredCard = null;
            currentFolderPath = null;
            currentItems = [];
            updateBreadcrumb(null);
        }
    }
    saveTabs();
    renderTabs();
}

function updateCurrentTab(path, name) {
    if (activeTabId == null) return;
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) {
        tab.path = path;
        tab.name = name || (path ? path.split(/[/\\]/).filter(Boolean).pop() : 'Home');
        // Track collection state on tab
        tab.collectionId = currentCollectionId || null;
        // Preserve sorting preferences when updating tab
        tab.sortType = tab.sortType || sortType;
        tab.sortOrder = tab.sortOrder || sortOrder;
        saveTabs();
        renderTabs();
    }
}

function renderTabs() {
    tabsContainer.innerHTML = '';
    tabs.forEach(tab => {
        const tabEl = document.createElement('div');
        tabEl.className = `tab ${tab.id === activeTabId ? 'active' : ''}`;
        tabEl.innerHTML = `
            <span class="tab-name" title="${tab.path || 'Home'}">${tab.name}</span>
            <span class="tab-close" data-tab-id="${tab.id}">${icon('x', 14)}</span>
        `;
        tabEl.addEventListener('click', (e) => {
            if (e.target.closest('.tab-close')) {
                e.stopPropagation();
                closeTab(tab.id);
            } else {
                switchToTab(tab.id);
            }
        });
        tabsContainer.appendChild(tabEl);
    });
    
    // Add "+" button
    const addBtn = document.createElement('div');
    addBtn.className = 'tab-add';
    addBtn.innerHTML = icon('plus', 16);
    addBtn.title = 'New Tab';
    addBtn.addEventListener('click', () => {
        selectFolderBtn.click();
    });
    tabsContainer.appendChild(addBtn);
}

// ==================== VIDEO SCRUBBER ====================
function initVideoScrubber() {
    // Event listeners are now attached directly to cards in renderItems
    // This function is kept for compatibility but does nothing
}

function showScrubber(card, video) {
    if (!video || !card) return;
    if (typeof cardInfoSettings !== 'undefined' && !cardInfoSettings.duration) {
        hideScrubber(card);
        return;
    }

    // Get or create the time label element
    let timeLabel = card.querySelector('.video-time-label');
    if (!timeLabel) {
        timeLabel = document.createElement('div');
        timeLabel.className = 'video-time-label';
        card.appendChild(timeLabel);
    }

    // Get or create the scrub progress bar
    let progressBar = card.querySelector('.scrub-progress-bar');
    if (!progressBar) {
        progressBar = document.createElement('div');
        progressBar.className = 'scrub-progress-bar';
        const fill = document.createElement('div');
        fill.className = 'scrub-progress-fill';
        progressBar.appendChild(fill);
        card.appendChild(progressBar);
    }
    const progressFill = progressBar.querySelector('.scrub-progress-fill');

    // Update the label and progress bar with current time vs total duration
    const updateTimeDisplay = () => {
        if (!timeLabel || !card.contains(timeLabel)) return;

        const currentTime = video.currentTime || 0;
        const duration = (video.duration && !isNaN(video.duration) && video.duration > 0) ? video.duration : 0;
        const currentTimeFormatted = formatTime(currentTime);
        const durationFormatted = duration > 0 ? formatTime(duration) : '--:--';
        timeLabel.textContent = `${currentTimeFormatted} / ${durationFormatted}`;

        // Update progress bar fill
        if (progressFill && duration > 0) {
            progressFill.style.width = ((currentTime / duration) * 100) + '%';
        }
    };

    // Initial update
    updateTimeDisplay();

    // Update when video time changes (if video is playing)
    const timeUpdateHandler = updateTimeDisplay;
    video.addEventListener('timeupdate', timeUpdateHandler);

    // Also update when metadata loads (duration becomes available)
    const metadataHandler = () => {
        updateTimeDisplay();
    };
    video.addEventListener('loadedmetadata', metadataHandler);

    // Store the handlers so we can remove them later
    card._timeUpdateHandler = timeUpdateHandler;
    card._metadataHandler = metadataHandler;
    card._updateTimeDisplay = updateTimeDisplay;

    // Show the label and progress bar
    timeLabel.classList.add('show');
    progressBar.classList.add('show');
}

function hideScrubber(card) {
    if (!card) return;

    const timeLabel = card.querySelector('.video-time-label');
    if (timeLabel) {
        timeLabel.classList.remove('show');
    }

    const progressBar = card.querySelector('.scrub-progress-bar');
    if (progressBar) {
        progressBar.classList.remove('show');
    }

    // Remove listeners if they exist
    const video = card.querySelector('video');
    if (video) {
        if (card._timeUpdateHandler) {
            video.removeEventListener('timeupdate', card._timeUpdateHandler);
            delete card._timeUpdateHandler;
        }
        if (card._metadataHandler) {
            video.removeEventListener('loadedmetadata', card._metadataHandler);
            delete card._metadataHandler;
        }
    }
    delete card._updateTimeDisplay;
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ==================== GIF PROGRESS BAR ====================

function showGifProgress(card) {
    if (!card) return;
    if (typeof cardInfoSettings !== 'undefined' && !cardInfoSettings.duration) {
        hideGifProgress(card);
        return;
    }

    const duration = Number(card.dataset.gifDuration || 0);
    if (duration <= 0) return;

    // Don't show if GIF is frozen/paused
    const frozenOverlay = card.querySelector('.gif-static-overlay.visible');
    if (frozenOverlay) return;

    // Get or create the progress bar
    let progressBar = card.querySelector('.gif-progress-bar');
    if (!progressBar) {
        progressBar = document.createElement('div');
        progressBar.className = 'gif-progress-bar';
        const fill = document.createElement('div');
        fill.className = 'gif-progress-fill';
        progressBar.appendChild(fill);
        card.appendChild(progressBar);
    }

    // Get or create the time label (reuse video-time-label class for consistency)
    let timeLabel = card.querySelector('.gif-time-label');
    if (!timeLabel) {
        timeLabel = document.createElement('div');
        timeLabel.className = 'video-time-label gif-time-label';
        card.appendChild(timeLabel);
    }

    const fill = progressBar.querySelector('.gif-progress-fill');
    const loadTime = Number(card.dataset.gifLoadTime || performance.now());
    const durationSec = duration / 1000;
    const durationFormatted = formatTime(durationSec);

    const animate = () => {
        const elapsed = performance.now() - loadTime;
        const currentMs = elapsed % duration;
        const progress = currentMs / duration;
        fill.style.width = (progress * 100) + '%';

        // Update time label
        const currentSec = currentMs / 1000;
        timeLabel.textContent = `${formatTime(currentSec)} / ${durationFormatted}`;

        card._gifAnimId = requestAnimationFrame(animate);
    };

    progressBar.classList.add('show');
    timeLabel.classList.add('show');
    card._gifAnimId = requestAnimationFrame(animate);
}

function hideGifProgress(card) {
    if (!card) return;

    if (card._gifAnimId) {
        cancelAnimationFrame(card._gifAnimId);
        delete card._gifAnimId;
    }

    const progressBar = card.querySelector('.gif-progress-bar');
    if (progressBar) progressBar.classList.remove('show');

    const timeLabel = card.querySelector('.gif-time-label');
    if (timeLabel) timeLabel.classList.remove('show');
}

// ==================== LIGHTBOX GIF PROGRESS ====================

let _lightboxGifAnimId = null;

async function startLightboxGifProgress(mediaUrl) {
    stopLightboxGifProgress();

    const progressBar = document.getElementById('lightbox-gif-progress');
    const timeDisplay = document.getElementById('lightbox-gif-time');
    if (!progressBar) return;

    const fill = progressBar.querySelector('.lightbox-gif-progress-fill');

    // Try to find duration from an existing card's dataset first
    let totalDuration = 0;
    const cards = document.querySelectorAll('.video-card');
    for (const card of cards) {
        const img = card.querySelector('img.media-thumbnail');
        if (img && img.src === mediaUrl && card.dataset.gifDuration) {
            totalDuration = Number(card.dataset.gifDuration);
            break;
        }
    }

    // If not found, parse the binary
    if (!totalDuration) {
        try {
            const response = await fetch(mediaUrl);
            const buffer = await response.arrayBuffer();
            const urlLower = mediaUrl.toLowerCase();
            let result = null;
            if (urlLower.endsWith('.gif')) {
                result = parseGifDuration(buffer);
            } else if (urlLower.endsWith('.webp')) {
                result = parseWebpDuration(buffer);
            }
            if (result) totalDuration = result.totalDuration;
        } catch {
            // Parsing failed
        }
    }

    if (!totalDuration || totalDuration <= 0) {
        progressBar.style.display = 'none';
        if (timeDisplay) timeDisplay.style.display = 'none';
        return;
    }

    progressBar.style.display = 'block';
    if (timeDisplay) timeDisplay.style.display = 'block';

    const startTime = performance.now();
    const durationSec = totalDuration / 1000;
    const durationFormatted = formatTime(durationSec);

    const animate = () => {
        const elapsed = performance.now() - startTime;
        const currentMs = elapsed % totalDuration;
        const progress = currentMs / totalDuration;
        if (fill) fill.style.width = (progress * 100) + '%';
        if (timeDisplay) {
            timeDisplay.textContent = `${formatTime(currentMs / 1000)} / ${durationFormatted}`;
        }
        _lightboxGifAnimId = requestAnimationFrame(animate);
    };

    _lightboxGifAnimId = requestAnimationFrame(animate);
}

function stopLightboxGifProgress() {
    if (_lightboxGifAnimId) {
        cancelAnimationFrame(_lightboxGifAnimId);
        _lightboxGifAnimId = null;
    }
    const progressBar = document.getElementById('lightbox-gif-progress');
    if (progressBar) progressBar.style.display = 'none';
    const timeDisplay = document.getElementById('lightbox-gif-time');
    if (timeDisplay) timeDisplay.style.display = 'none';
}

// ==================== ZOOM CONTROLS ====================
function initZoom() {
    const savedZoom = localStorage.getItem('zoomLevel');
    if (savedZoom) {
        zoomLevel = parseInt(savedZoom, 10);
        zoomSlider.value = zoomLevel;
        zoomValue.textContent = `${zoomLevel}%`;
    }
    applyZoom();
}

function applyZoom() {
    invalidateMasonryStyleCache();
    if (typeof invalidateVsStyleCache === 'function') invalidateVsStyleCache();
    const scale = zoomLevel / 100;
    // Update CSS variable for zoom
    document.documentElement.style.setProperty('--zoom-level', zoomLevel);

    // Apply zoom-tier classes for progressive card content hiding
    const root = document.documentElement;
    root.classList.toggle('zoom-lg', zoomLevel >= 100);
    root.classList.toggle('zoom-md', zoomLevel >= 75 && zoomLevel < 100);
    root.classList.toggle('zoom-sm', zoomLevel >= 60 && zoomLevel < 75);
    root.classList.toggle('zoom-xs', zoomLevel < 60);

    // Adjust grid container gap and card sizes
    const baseGap = 16;
    const scaledGap = baseGap * scale;
    gridContainer.style.setProperty('--gap', `${scaledGap}px`);
    
    // For grid layout, adjust column width — CSS grid auto-recalculates on variable change
    if (layoutMode === 'grid') {
        const baseMinWidth = 250;
        const scaledMinWidth = baseMinWidth * scale;
        gridContainer.style.setProperty('--grid-min-width', `${scaledMinWidth}px`);
    }
    
    // Recalculate layout for new zoom level
    if (vsEnabled) {
        vsRecalculate();
    } else if (layoutMode === 'masonry') {
        scheduleMasonryLayout();
    }
}

// ==================== THEME ====================
function initTheme() {
    // Theme is now managed by ThemeManager in themes.js
}

function applyTheme() {
    // Theme is now managed by ThemeManager in themes.js
    invalidateMasonryStyleCache();
    if (typeof invalidateVsStyleCache === 'function') invalidateVsStyleCache();
}

// ==================== THUMBNAIL QUALITY ====================
function initThumbnailQuality() {
    const savedQuality = localStorage.getItem('thumbnailQuality');
    if (savedQuality && ['low', 'medium', 'high', 'original'].includes(savedQuality)) {
        thumbnailQuality = savedQuality;
        thumbnailQualitySelect.value = thumbnailQuality;
    }
}

function getThumbnailQualityMultiplier() {
    switch (thumbnailQuality) {
        case 'low': return 0.2;
        case 'high': return 0.5;
        case 'original': return 0; // skip thumbnail, use original file
        default: return 0.3; // medium
    }
}

// ==================== NEW FEATURES IMPLEMENTATION ====================

// Get current filtered items for lightbox navigation
function getFilteredMediaItems() {
    // With virtual scrolling, use the items array directly (includes all items, not just visible DOM cards)
    if (vsEnabled && vsSortedItems.length > 0) {
        return vsSortedItems
            .filter(item => item.type !== 'folder' && item.url && item.path)
            .map(item => ({
                url: item.url,
                path: item.path,
                name: item.name || '',
                type: item.type || 'video'
            }));
    }
    // Fallback: query DOM
    const cards = gridContainer.querySelectorAll('.video-card:not(.folder-card)');
    const items = [];
    cards.forEach(card => {
        if (card.style.display !== 'none') {
            const url = card.dataset.src;
            const path = card.dataset.path;
            const name = card.dataset.name || card.querySelector('.video-info')?.textContent || '';
            const type = card.dataset.mediaType || 'video';
            if (url && path) {
                items.push({ url, path, name, type });
            }
        }
    });
    return items;
}

// Lightbox navigation
function navigateLightbox(direction) {
    if (lightboxItems.length === 0) {
        lightboxItems = getFilteredMediaItems();
    }
    if (lightboxItems.length === 0) return;
    
    if (direction === 'next') {
        currentLightboxIndex = (currentLightboxIndex + 1) % lightboxItems.length;
    } else {
        currentLightboxIndex = (currentLightboxIndex - 1 + lightboxItems.length) % lightboxItems.length;
    }
    
    const item = lightboxItems[currentLightboxIndex];
    if (item) {
        openLightbox(item.url, item.path, item.name);
    }
}

// Video playback controls
function setVideoPlaybackSpeed(speed) {
    videoPlaybackSpeed = speed;
    if (lightboxVideo) {
        lightboxVideo.playbackRate = speed;
    }
    const speedBtn = document.getElementById('lightbox-speed-btn');
    if (speedBtn) {
        speedBtn.textContent = `${speed}x`;
    }
}

function toggleVideoLoop() {
    videoLoop = !videoLoop;
    if (lightboxVideo) {
        lightboxVideo.loop = videoLoop;
    }
    const loopBtn = document.getElementById('lightbox-loop-btn');
    if (loopBtn) {
        loopBtn.textContent = videoLoop ? 'On' : 'Off';
        loopBtn.classList.toggle('active', videoLoop);
    }
}

function toggleVideoRepeat() {
    videoRepeat = !videoRepeat;
    const repeatBtn = document.getElementById('lightbox-repeat-btn');
    if (repeatBtn) {
        repeatBtn.textContent = videoRepeat ? 'On' : 'Off';
        repeatBtn.classList.toggle('active', videoRepeat);
    }
    if (videoRepeat && lightboxVideo) {
        lightboxVideo.addEventListener('ended', handleVideoRepeat);
    } else if (lightboxVideo) {
        lightboxVideo.removeEventListener('ended', handleVideoRepeat);
    }
}

function handleVideoRepeat() {
    if (videoRepeat && lightboxVideo) {
        lightboxVideo.currentTime = 0;
        lightboxVideo.play();
    }
}

function stepVideoFrame(direction) {
    if (!lightboxVideo || lightboxVideo.readyState < 2) return;
    
    const frameTime = 1 / 30; // Assume 30fps, could be improved with actual fps detection
    if (direction === 'next') {
        lightboxVideo.currentTime = Math.min(lightboxVideo.duration, lightboxVideo.currentTime + frameTime);
    } else {
        lightboxVideo.currentTime = Math.max(0, lightboxVideo.currentTime - frameTime);
    }
}

// Helper function to escape HTML
function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Extract common ComfyUI parameters from workflow
function extractComfyUIParameters(workflow) {
    if (!workflow || typeof workflow !== 'object') return null;
    
    const params = {
        prompt: null,
        negativePrompt: null,
        cfgScale: null,
        steps: null,
        sampler: null,
        seed: null,
        model: null,
        width: null,
        height: null
    };
    
    // ComfyUI workflow structure: workflow.prompt contains node data
    // Each node has class_type and inputs
    const promptData = workflow.prompt || workflow;
    
    if (typeof promptData === 'object') {
        const clipTextNodes = [];
        
        // First pass: collect all CLIPTextEncode nodes
        for (const nodeId in promptData) {
            const node = promptData[nodeId];
            if (!node || typeof node !== 'object') continue;
            
            const classType = node.class_type || '';
            const inputs = node.inputs || {};
            
            // Collect CLIPTextEncode nodes
            if (classType.includes('CLIPTextEncode') && inputs.text) {
                const nodeTitle = (node.title || nodeId || '').toLowerCase();
                const isNegative = nodeTitle.includes('negative') || 
                                  nodeTitle.includes('neg') ||
                                  nodeTitle.includes('n_prompt');
                clipTextNodes.push({
                    text: inputs.text,
                    isNegative: isNegative,
                    nodeId: nodeId
                });
            }
            
            // Find KSampler or Sampler nodes - these contain the actual generation parameters
            // Only take the first instance of each parameter
            if (classType === 'KSampler' || classType === 'KSamplerAdvanced' || classType.includes('KSampler')) {
                // Only set CFG scale if not already set (first instance)
                if (params.cfgScale === null && inputs.cfg !== undefined && inputs.cfg !== null) {
                    params.cfgScale = inputs.cfg;
                }
                // Only set steps if not already set (first instance)
                if (params.steps === null && inputs.steps !== undefined && inputs.steps !== null) {
                    params.steps = inputs.steps;
                }
                // Seed in KSampler should be a large integer (typically 10+ digits), not a small float
                // Only set seed if not already set (first instance)
                if (params.seed === null && inputs.seed !== undefined && inputs.seed !== null) {
                    const seedValue = inputs.seed;
                    // Only accept if it's a very large integer (seeds are typically 10+ digits)
                    if (typeof seedValue === 'number') {
                        // Reject small numbers or floats (like 82.9)
                        if (seedValue > 1000000 && Number.isInteger(seedValue)) {
                            params.seed = seedValue;
                        } else if (seedValue > 1000000) {
                            // Large number but not integer - might be seed as float, floor it
                            params.seed = Math.floor(seedValue);
                        }
                    } else if (typeof seedValue === 'string') {
                        const parsed = parseInt(seedValue);
                        // Only accept if it's a very large number
                        if (!isNaN(parsed) && parsed > 1000000) {
                            params.seed = parsed;
                        }
                    }
                }
                // Only set sampler name if not already set (first instance)
                if (!params.sampler && inputs.sampler_name) {
                    params.sampler = inputs.sampler_name;
                }
            }
            
            // Check for seed in CR Module Pipe Loader or other pipe loader nodes
            // Only take the first instance
            if (params.seed === null && (classType.includes('Pipe') || classType.includes('Module')) && inputs.seed !== undefined && inputs.seed !== null) {
                const seedValue = inputs.seed;
                // Only accept very large integers
                if (typeof seedValue === 'number' && seedValue > 1000000) {
                    params.seed = Math.floor(seedValue);
                } else if (typeof seedValue === 'string') {
                    const parsed = parseInt(seedValue);
                    if (!isNaN(parsed) && parsed > 1000000) {
                        params.seed = parsed;
                    }
                }
            }
            
            // Find seed in RandomSeed node (often used for seed control) - prioritize this
            // Only take the first instance
            if (params.seed === null && (classType === 'RandomSeed' || classType === 'Seed')) {
                if (inputs.seed !== undefined && inputs.seed !== null) {
                    const seedValue = inputs.seed;
                    // Only accept very large numbers (seeds are typically 10+ digits)
                    if (typeof seedValue === 'number' && seedValue > 1000000) {
                        params.seed = Math.floor(seedValue);
                    } else if (typeof seedValue === 'string') {
                        const parsed = parseInt(seedValue);
                        if (!isNaN(parsed) && parsed > 1000000) {
                            params.seed = parsed;
                        }
                    }
                }
                // Sometimes seed is in 'value' field
                if (params.seed === null && inputs.value !== undefined && inputs.value !== null) {
                    const seedValue = inputs.value;
                    if (typeof seedValue === 'number' && seedValue > 1000000) {
                        params.seed = Math.floor(seedValue);
                    } else if (typeof seedValue === 'string') {
                        const parsed = parseInt(seedValue);
                        if (!isNaN(parsed) && parsed > 1000000) {
                            params.seed = parsed;
                        }
                    }
                }
            }
            
            // Find model (CheckpointLoaderSimple, CheckpointLoader, etc.)
            if (classType.includes('Checkpoint') || classType.includes('Model')) {
                if (inputs.ckpt_name) params.model = inputs.ckpt_name;
                if (inputs.model_name) params.model = inputs.model_name;
            }
            
            // Find resolution from Resolution node (has longer_side and aspect_ratio)
            if (classType === 'Resolution' || classType.includes('Resolution')) {
                if (inputs.longer_side !== undefined && inputs.longer_side !== null) {
                    const longerSide = typeof inputs.longer_side === 'string' ? parseInt(inputs.longer_side) : inputs.longer_side;
                    if (longerSide && longerSide >= 100) {
                        // Calculate dimensions from aspect ratio
                        if (inputs.aspect_ratio) {
                            const aspectRatio = inputs.aspect_ratio;
                            // Parse aspect ratio like "2:3 (Portrait)" or "16:9"
                            const ratioMatch = aspectRatio.match(/(\d+):(\d+)/);
                            if (ratioMatch) {
                                const ratioW = parseFloat(ratioMatch[1]);
                                const ratioH = parseFloat(ratioMatch[2]);
                                const ratio = ratioW / ratioH;
                                
                                // Check if portrait is mentioned
                                const isPortrait = aspectRatio.toLowerCase().includes('portrait') || ratio < 1;
                                
                                if (isPortrait) {
                                    // Portrait: height is longer, width is shorter
                                    params.height = longerSide;
                                    params.width = Math.round(longerSide * ratio);
                                } else {
                                    // Landscape: width is longer, height is shorter
                                    params.width = longerSide;
                                    params.height = Math.round(longerSide / ratio);
                                }
                            }
                        }
                    }
                }
            }
            
            // Find resolution from ImageScaleToMaxDimension node
            if (classType === 'ImageScaleToMaxDimension' || classType.includes('ImageScale')) {
                if (inputs.largest_size !== undefined && inputs.largest_size !== null) {
                    const largestSize = typeof inputs.largest_size === 'string' ? parseInt(inputs.largest_size) : inputs.largest_size;
                    if (largestSize && largestSize >= 100) {
                        // This gives us the longer side, but we need aspect ratio to calculate both dimensions
                        // Store it for later if we don't have dimensions yet
                        if (!params.width || !params.height) {
                            // We'll need to calculate from aspect ratio if available
                        }
                    }
                }
            }
            
            // Find image dimensions (EmptyLatentImage is most common)
            // Only accept reasonable dimensions (typically 64+ pixels, and usually multiples of 8 or 64)
            // But be careful - these might be latent dimensions, not final image dimensions
            if (classType === 'EmptyLatentImage' || classType.includes('EmptyLatentImage')) {
                // Only use if we don't already have dimensions from Resolution node
                if (!params.width || !params.height) {
                    if (inputs.width !== undefined && inputs.width !== null) {
                        const width = typeof inputs.width === 'string' ? parseInt(inputs.width) : inputs.width;
                        // Only accept if it's a reasonable dimension (not tiny like 80)
                        if (width && width >= 100 && Number.isInteger(width)) {
                            params.width = width;
                        }
                    }
                    if (inputs.height !== undefined && inputs.height !== null) {
                        const height = typeof inputs.height === 'string' ? parseInt(inputs.height) : inputs.height;
                        if (height && height >= 100 && Number.isInteger(height)) {
                            params.height = height;
                        }
                    }
                }
            }
            
            // Check for dimensions in other node types, but be more selective
            if ((!params.width || params.width < 100) || (!params.height || params.height < 100)) {
                // Look for width/height in other nodes, but filter out small values
                if (inputs.width !== undefined && inputs.height !== undefined) {
                    const width = typeof inputs.width === 'string' ? parseInt(inputs.width) : inputs.width;
                    const height = typeof inputs.height === 'string' ? parseInt(inputs.height) : inputs.height;
                    // Only accept reasonable dimensions (reject tiny values like 80)
                    if (width && height && width >= 100 && height >= 100 && Number.isInteger(width) && Number.isInteger(height)) {
                        if (!params.width || params.width < 100) params.width = width;
                        if (!params.height || params.height < 100) params.height = height;
                    }
                }
            }
        }
        
        // Determine positive and negative prompts from collected nodes
        if (clipTextNodes.length > 0) {
            // Sort by nodeId to get consistent order (but note: nodeId order may not match workflow order)
            clipTextNodes.sort((a, b) => a.nodeId.localeCompare(b.nodeId, undefined, { numeric: true }));
            
            // If we have explicit negative markers, use those
            const negativeNode = clipTextNodes.find(n => n.isNegative);
            const positiveNodes = clipTextNodes.filter(n => !n.isNegative);
            
            if (negativeNode) {
                params.negativePrompt = negativeNode.text;
            }
            
            // First non-negative node is positive prompt
            if (positiveNodes.length > 0) {
                params.prompt = positiveNodes[0].text;
            }
            
            // If we have 2 nodes and one is marked negative, the other is positive
            if (clipTextNodes.length === 2) {
                if (negativeNode && positiveNodes.length === 1) {
                    params.prompt = positiveNodes[0].text;
                } else if (!negativeNode) {
                    // If neither is marked, swap the order (user reported they were swapped)
                    // Second node is positive, first is negative
                    params.prompt = clipTextNodes[1].text;
                    params.negativePrompt = clipTextNodes[0].text;
                }
            }
            
            // If no explicit negative but we have 2+ unmarked nodes, swap order
            if (!params.negativePrompt && clipTextNodes.length >= 2 && positiveNodes.length >= 2) {
                // User says they're swapped, so reverse: last is positive, first is negative
                params.prompt = positiveNodes[positiveNodes.length - 1].text;
                params.negativePrompt = positiveNodes[0].text;
            }
            
            // Fallback: if only one node found and no negative marker, assume it's positive
            if (!params.prompt && clipTextNodes.length === 1) {
                params.prompt = clipTextNodes[0].text;
            }
        }
        
        // Try to get dimensions from workflow metadata or extra data
        if ((!params.width || params.width < 100) || (!params.height || params.height < 100)) {
            // Check workflow.extra for dimensions
            if (workflow.extra) {
                if (workflow.extra.dworkflow) {
                    const dworkflow = workflow.extra.dworkflow;
                    if (dworkflow.width && dworkflow.width >= 100) params.width = dworkflow.width;
                    if (dworkflow.height && dworkflow.height >= 100) params.height = dworkflow.height;
                }
                // Sometimes dimensions are directly in extra
                if (workflow.extra.width && workflow.extra.width >= 100) params.width = workflow.extra.width;
                if (workflow.extra.height && workflow.extra.height >= 100) params.height = workflow.extra.height;
            }
            
            // Check workflow output or other metadata
            if (workflow.output) {
                if (workflow.output.width && workflow.output.width >= 100) params.width = workflow.output.width;
                if (workflow.output.height && workflow.output.height >= 100) params.height = workflow.output.height;
            }
        }
        
        // Final check: look for seed in workflow.extra or other metadata (seeds are large integers, 10+ digits)
        if (!params.seed || params.seed < 1000000) {
            if (workflow.extra) {
                if (workflow.extra.seed !== undefined && workflow.extra.seed !== null) {
                    const seedValue = workflow.extra.seed;
                    if (typeof seedValue === 'number' && seedValue > 1000000) {
                        params.seed = Math.floor(seedValue);
                    } else if (typeof seedValue === 'string') {
                        const parsed = parseInt(seedValue);
                        if (!isNaN(parsed) && parsed > 1000000) {
                            params.seed = parsed;
                        }
                    }
                }
            }
            // Also check workflow directly for seed
            if ((!params.seed || params.seed < 1000000) && workflow.seed !== undefined && workflow.seed !== null) {
                const seedValue = workflow.seed;
                if (typeof seedValue === 'number' && seedValue > 1000000) {
                    params.seed = Math.floor(seedValue);
                } else if (typeof seedValue === 'string') {
                    const parsed = parseInt(seedValue);
                    if (!isNaN(parsed) && parsed > 1000000) {
                        params.seed = parsed;
                    }
                }
            }
        }
    }
    
    return params;
}

// Plugin info sections — lazily loaded list of section descriptors
let _pluginInfoSections = null;
async function getPluginInfoSections() {
    if (_pluginInfoSections !== null) return _pluginInfoSections;
    try {
        _pluginInfoSections = await window.electronAPI.getPluginInfoSections();
    } catch {
        _pluginInfoSections = [];
    }
    return _pluginInfoSections;
}

/**
 * Calls each registered plugin info section and appends rendered HTML to the details container.
 * Plugins return { title, html, actions? } where actions is [{label, copyText}].
 */
async function appendPluginInfoSections(detailsEl, filePath, pluginMetadata) {
    const sections = await getPluginInfoSections();
    for (const section of sections) {
        try {
            const res = await window.electronAPI.renderPluginInfoSection(
                section.pluginId, section.id, filePath, pluginMetadata
            );
            if (!res || !res.success || !res.result) continue;
            const { title, html, actions } = res.result;
            if (!html) continue;

            const wrapper = document.createElement('div');
            wrapper.className = 'file-info-detail-row file-info-comfyui-section file-info-plugin-section';
            wrapper.dataset.pluginSection = `${section.pluginId}:${section.id}`;

            const headerEl = document.createElement('div');
            headerEl.className = 'file-info-comfyui-header';
            headerEl.innerHTML = `<span class="file-info-detail-label">${escapeHtml(title || section.title || 'Plugin Info')}:</span>
                <button class="file-info-toggle-btn" data-toggle-plugin-section>▼</button>`;

            const contentEl = document.createElement('div');
            contentEl.className = 'file-info-comfyui-content';
            contentEl.innerHTML = html;

            if (Array.isArray(actions)) {
                for (const action of actions) {
                    if (!action.label || !action.copyText) continue;
                    const btn = document.createElement('button');
                    btn.className = 'file-info-copy-json-btn';
                    btn.textContent = action.label;
                    const textToCopy = action.copyText;
                    btn.addEventListener('click', function() {
                        navigator.clipboard.writeText(textToCopy).then(() => {
                            const orig = this.textContent;
                            this.textContent = 'Copied!';
                            setTimeout(() => { this.textContent = orig; }, 2000);
                        });
                    });
                    contentEl.appendChild(btn);
                }
            }

            headerEl.querySelector('[data-toggle-plugin-section]').addEventListener('click', function() {
                contentEl.classList.toggle('hidden');
                this.textContent = this.textContent === '▼' ? '▶' : '▼';
            });

            wrapper.appendChild(headerEl);
            wrapper.appendChild(contentEl);
            detailsEl.appendChild(wrapper);
        } catch (err) {
            console.warn(`[Plugin info section] ${section.pluginId}/${section.id} failed:`, err.message);
        }
    }
}

// File info panel (popover)
async function showFileInfo(filePath) {
    console.log('showFileInfo called with filePath:', filePath);
    const panel = document.getElementById('file-info-panel');
    const details = document.getElementById('file-info-details');
    if (!panel || !details) {
        console.error('File info panel elements not found', { panel: !!panel, details: !!details });
        return;
    }
    
    // Position panel using CSS bottom and right properties relative to button
    const infoBtn = document.getElementById('lightbox-info-btn');
    if (infoBtn) {
        const btnRect = infoBtn.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        
        // Calculate bottom offset (distance from bottom of viewport to top of button + gap)
        const bottomOffset = viewportHeight - btnRect.top + 10;
        
        // Calculate right offset (distance from right of viewport to right of button)
        const rightOffset = viewportWidth - btnRect.right;
        
        // Use CSS bottom and right properties for positioning
        panel.style.top = 'auto';
        panel.style.left = 'auto';
        panel.style.bottom = `${bottomOffset}px`;
        panel.style.right = `${rightOffset}px`;
        panel.style.transform = 'none';
        
        console.log('Positioned panel using CSS bottom/right:', { 
            bottom: panel.style.bottom,
            right: panel.style.right,
            buttonTop: btnRect.top,
            buttonRight: btnRect.right
        });
    } else {
        // Center the panel if button not found
        panel.style.top = '50%';
        panel.style.left = '50%';
        panel.style.bottom = 'auto';
        panel.style.right = 'auto';
        panel.style.transform = 'translate(-50%, -50%)';
        console.log('Centered panel (button not found)');
    }
    
    // Show panel
    panel.classList.remove('hidden');
    panel.style.display = 'block';
    panel.style.pointerEvents = 'auto';
    panel.style.visibility = 'visible';
    panel.style.opacity = '1';
    
    // Verify panel is actually visible
    const computedStyle = window.getComputedStyle(panel);
    console.log('Panel hidden class removed, panel should be visible now', {
        hasHidden: panel.classList.contains('hidden'),
        display: panel.style.display,
        computedDisplay: computedStyle.display,
        computedVisibility: computedStyle.visibility,
        computedOpacity: computedStyle.opacity,
        computedZIndex: computedStyle.zIndex,
        computedPointerEvents: computedStyle.pointerEvents,
        panelRect: panel.getBoundingClientRect()
    });
    
    try {
        const result = await window.electronAPI.getFileInfo(filePath);
        if (result && result.success && result.info) {
            const info = result.info;
            console.log('File info received:', {
                hasComfyUIWorkflow: !!info.comfyUIWorkflow,
                workflowData: info.comfyUIWorkflow
            });
            details.innerHTML = `
                <div class="file-info-detail-row">
                    <span class="file-info-detail-label">Name:</span>
                    <span class="file-info-detail-value">${info.name}</span>
                </div>
                <div class="file-info-detail-row file-info-path-row">
                    <span class="file-info-detail-label">Path:</span>
                    <span class="file-info-detail-value">${info.path}</span>
                </div>
                <div class="file-info-detail-row">
                    <span class="file-info-detail-label">Size:</span>
                    <span class="file-info-detail-value">${info.sizeFormatted}</span>
                </div>
                <div class="file-info-detail-row">
                    <span class="file-info-detail-label">Created:</span>
                    <span class="file-info-detail-value">${new Date(info.created).toLocaleString()}</span>
                </div>
                <div class="file-info-detail-row">
                    <span class="file-info-detail-label">Modified:</span>
                    <span class="file-info-detail-value">${new Date(info.modified).toLocaleString()}</span>
                </div>
                ${info.width && info.height ? `
                <div class="file-info-detail-row">
                    <span class="file-info-detail-label">Dimensions:</span>
                    <span class="file-info-detail-value">${info.width} x ${info.height}</span>
                </div>
                ` : ''}
                ${info.type === 'video' ? `
                <div class="file-info-detail-row">
                    <span class="file-info-detail-label">Type:</span>
                    <span class="file-info-detail-value">Video</span>
                </div>
                ` : info.type === 'image' ? `
                <div class="file-info-detail-row">
                    <span class="file-info-detail-label">Type:</span>
                    <span class="file-info-detail-value">Image</span>
                </div>
                ` : ''}
            `;

            // Plugin info sections handle all additional metadata rendering (ComfyUI, EXIF, etc.)
            await appendPluginInfoSections(details, filePath, info.pluginMetadata || {});
        } else {
            details.innerHTML = `<div class="file-info-detail-row">Error: ${result.error || 'Unknown error'}</div>`;
        }
        
        // No need to reposition - CSS bottom/right positioning handles it automatically
    } catch (error) {
        console.error('Error in showFileInfo:', error);
        details.innerHTML = `<div class="file-info-detail-row">Error: ${error.message || 'Unknown error occurred'}</div>`;
    }
}

// Star ratings
function getFileRating(filePath) {
    if (!filePath) return 0;
    // Check both original path and normalized path to handle Windows path variations
    const normalizedPath = normalizePath(filePath);
    return fileRatings[filePath] || fileRatings[normalizedPath] || 0;
}

function setFileRating(filePath, rating) {
    if (!filePath) return;
    // Store with both original and normalized path for consistent lookups
    fileRatings[filePath] = rating;
    const normalizedPath = normalizePath(filePath);
    if (normalizedPath !== filePath) {
        fileRatings[normalizedPath] = rating;
    }
    // Persist to SQLite (fire-and-forget, in-memory is already updated)
    window.electronAPI.dbSetRating(normalizedPath, rating);

    // Update all cards with the same path immediately - use updateCardRating which calls updateCardStars
    updateCardRating(filePath, rating);
    // Canvas grid: schedule redraw so the star row updates on canvas-rendered cards
    if (window.CG && window.CG.isEnabled()) window.CG.scheduleRender();
}

function updateCardStars(card, rating, filePath) {
    let starContainer = card.querySelector('.star-rating');
    if (!starContainer) {
        // Create star container if it doesn't exist
        starContainer = document.createElement('div');
        starContainer.className = 'star-rating';
        starContainer.style.pointerEvents = 'auto';
        // Insert before the info element
        const info = card.querySelector('.video-info');
        if (info) {
            card.insertBefore(starContainer, info);
        } else {
            card.appendChild(starContainer);
        }
    }
    
    // Update visibility class based on rating
    starContainer.classList.toggle('has-rating', rating > 0);

    // Clear and rebuild stars (click handling is delegated from gridContainer, no per-star listeners needed)
    starContainer.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
        const star = document.createElement('span');
        star.className = `star ${i <= rating ? 'active' : ''}`;
        star.innerHTML = i <= rating ? iconFilled('star', 16, 'var(--warning)') : icon('star', 16);
        starContainer.appendChild(star);
    }

    if (typeof applyCardInfoStarRatingVisibility === 'function') {
        applyCardInfoStarRatingVisibility(card);
    }
}

function saveRatings() {
    // Legacy: kept as no-op for any stale call sites
}

async function loadRatings() {
    try {
        const result = await window.electronAPI.dbGetAllRatings();
        if (result.success && result.data) {
            fileRatings = result.data;
        }
    } catch (error) {
        console.error('Error loading ratings:', error);
        fileRatings = {};
    }
}

// --- Pin/Unpin functionality ---
let pinnedFiles = {}; // Map<normalizedPath, true>

function isFilePinned(filePath) {
    if (!filePath) return false;
    const normalizedPath = normalizePath(filePath);
    return !!pinnedFiles[filePath] || !!pinnedFiles[normalizedPath];
}

function setFilePinned(filePath, pinned) {
    if (!filePath) return;
    const normalizedPath = normalizePath(filePath);
    if (pinned) {
        pinnedFiles[filePath] = true;
        if (normalizedPath !== filePath) pinnedFiles[normalizedPath] = true;
    } else {
        delete pinnedFiles[filePath];
        if (normalizedPath !== filePath) delete pinnedFiles[normalizedPath];
    }
    // Persist to SQLite (fire-and-forget)
    window.electronAPI.dbSetPinned(normalizedPath, pinned);
    // Canvas grid: pin bar state changed, redraw affected card(s)
    if (window.CG && window.CG.isEnabled()) window.CG.scheduleRender();
}

function savePins() {
    // Legacy: kept as no-op for any stale call sites
}

async function loadPins() {
    try {
        const result = await window.electronAPI.dbGetAllPinned();
        if (result.success && result.data) {
            pinnedFiles = result.data;
        }
    } catch (error) {
        console.error('Error loading pins:', error);
        pinnedFiles = {};
    }
}

function updateCardRating(filePath, rating) {
    // Normalize path for matching
    const normalizedPath = filePath.replace(/\\/g, '/');
    
    // Find all cards - try multiple selectors and path formats
    const allCards = gridContainer.querySelectorAll('.video-card:not(.folder-card)');
    allCards.forEach(card => {
        const cardPath = card.dataset.path;
        if (cardPath) {
            const normalizedCardPath = cardPath.replace(/\\/g, '/');
            // Match exact path or normalized path (case-insensitive)
            if (normalizedCardPath === normalizedPath || cardPath === filePath || 
                normalizedCardPath.toLowerCase() === normalizedPath.toLowerCase() ||
                cardPath.toLowerCase() === filePath.toLowerCase()) {
                updateCardStars(card, rating, filePath);
            }
        }
    });
}

// Advanced search
function applyAdvancedSearch() {
    const sizeOp = document.getElementById('search-size-operator')?.value || '';
    const sizeVal = parseFloat(document.getElementById('search-size-value')?.value);
    const dateFrom = document.getElementById('search-date-from')?.value;
    const dateTo = document.getElementById('search-date-to')?.value;
    const width = parseInt(document.getElementById('search-width')?.value);
    const height = parseInt(document.getElementById('search-height')?.value);
    const aspectRatio = document.getElementById('search-aspect-ratio')?.value || '';
    const starRating = parseInt(document.getElementById('search-star-rating')?.value);

    advancedSearchFilters = {
        sizeOperator: sizeOp,
        sizeValue: isNaN(sizeVal) ? null : sizeVal * 1024 * 1024, // Convert MB to bytes
        dateFrom: dateFrom ? new Date(dateFrom).getTime() : null,
        dateTo: dateTo ? new Date(dateTo).getTime() + 86400000 : null, // Add 1 day to include the full day
        width: isNaN(width) ? null : width,
        height: isNaN(height) ? null : height,
        aspectRatio: aspectRatio,
        starRating: isNaN(starRating) ? null : starRating
    };

    // Handle recursive search toggle — re-scan if changed
    const recursiveCheckbox = document.getElementById('search-recursive');
    const newRecursive = recursiveCheckbox?.checked || false;
    const recursiveChanged = newRecursive !== recursiveSearchEnabled;
    recursiveSearchEnabled = newRecursive;
    localStorage.setItem('recursiveSearch', String(newRecursive));

    // Apply sort selection
    const advancedSortVal = document.getElementById('advanced-sort-type')?.value;
    if (advancedSortVal) {
        sortType = advancedSortVal;
        // Keep the settings panel in sync for name/date (the only values it supports)
        const sortTypeSelect = document.getElementById('sort-type-select');
        if (sortTypeSelect && (advancedSortVal === 'name' || advancedSortVal === 'date')) {
            sortTypeSelect.value = advancedSortVal;
        }
        if (recursiveChanged && currentFolderPath) {
            // Need a full re-scan since recursive mode changed
            invalidateFolderCache(currentFolderPath);
            loadVideos(currentFolderPath, false);
        } else {
            applySorting();
        }
    } else {
        if (recursiveChanged && currentFolderPath) {
            invalidateFolderCache(currentFolderPath);
            loadVideos(currentFolderPath, false);
        } else {
            applyFilters();
        }
    }
    updateAdvancedSearchIndicator();
    const panel = document.getElementById('advanced-search-panel');
    if (panel) panel.classList.add('hidden');
}

function clearAdvancedSearch() {
    advancedSearchFilters = {
        sizeOperator: '',
        sizeValue: null,
        dateFrom: null,
        dateTo: null,
        width: null,
        height: null,
        aspectRatio: '',
        starRating: null
    };

    document.getElementById('search-size-operator').value = '';
    document.getElementById('search-size-value').value = '';
    document.getElementById('search-date-from').value = '';
    document.getElementById('search-date-to').value = '';
    document.getElementById('search-width').value = '';
    document.getElementById('search-height').value = '';
    document.getElementById('search-aspect-ratio').value = '';
    document.getElementById('search-star-rating').value = '';

    // Reset recursive search
    const recursiveCheckbox = document.getElementById('search-recursive');
    const wasRecursive = recursiveSearchEnabled;
    if (recursiveCheckbox) recursiveCheckbox.checked = false;
    recursiveSearchEnabled = false;
    localStorage.setItem('recursiveSearch', 'false');

    // Reset sort — restore per-folder preference if available, otherwise default to 'name'
    const advSortEl = document.getElementById('advanced-sort-type');
    if (advSortEl) advSortEl.value = 'name';
    const folderPref = typeof getFolderSortPref === 'function' ? getFolderSortPref(currentFolderPath) : null;
    if (folderPref) {
        sortType = folderPref.sortType;
        sortOrder = folderPref.sortOrder;
    } else {
        sortType = 'name';
        sortOrder = 'ascending';
    }
    const sortTypeSelect = document.getElementById('sort-type-select');
    const sortOrderSelect = document.getElementById('sort-order-select');
    if (sortTypeSelect) sortTypeSelect.value = sortType;
    if (sortOrderSelect) sortOrderSelect.value = sortOrder;
    if (wasRecursive && currentFolderPath) {
        invalidateFolderCache(currentFolderPath);
        loadVideos(currentFolderPath, false);
    } else {
        applySorting();
    }
    updateAdvancedSearchIndicator();
}

function updateAdvancedSearchIndicator() {
    const btn = document.getElementById('advanced-search-btn');
    if (!btn) return;

    let count = 0;
    if (recursiveSearchEnabled) count++;
    if (advancedSearchFilters.sizeValue !== null) count++;
    if (advancedSearchFilters.dateFrom !== null || advancedSearchFilters.dateTo !== null) count++;
    if (advancedSearchFilters.width !== null || advancedSearchFilters.height !== null) count++;
    if (advancedSearchFilters.aspectRatio !== '') count++;
    if (advancedSearchFilters.starRating !== null && advancedSearchFilters.starRating !== '') count++;

    btn.classList.toggle('active', count > 0);

    let badge = btn.querySelector('.filter-badge');
    if (count > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'filter-badge';
            btn.appendChild(badge);
        }
        badge.textContent = count;
    } else if (badge) {
        badge.remove();
    }
}

// File organization
async function createFolder(folderName) {
    if (!currentFolderPath || !folderName) return;
    try {
        const result = await window.electronAPI.createFolder(currentFolderPath, folderName);
        if (result.success) {
            showToast(`Created folder "${folderName}"`, 'success');
            await navigateToFolder(currentFolderPath);
        } else {
            showToast('Could not create folder: ' + friendlyError(result.error), 'error');
        }
    } catch (error) {
        showToast('Could not create folder: ' + friendlyError(error), 'error');
    }
}

// Low-level move helper — no progress bar or toasts (for use by organize functions)
async function _moveFilesBatch(filePaths, destFolder, progressOffset, progressTotal) {
    let success = 0;
    let failed = 0;
    let savedResolution = null;
    for (let i = 0; i < filePaths.length; i++) {
        if (currentProgress && currentProgress.cancelled) break;
        const filePath = filePaths[i];
        const fileName = filePath.replace(/^.*[\\/]/, '');
        try {
            let result = await window.electronAPI.moveFile(filePath, destFolder, fileName);
            if (result.conflict) {
                const resolution = savedResolution
                    || (await showFileConflictDialog(result.fileName, filePath, result.destPath, i < filePaths.length - 1));
                if (resolution.applyToAll) savedResolution = resolution;
                result = await window.electronAPI.moveFile(filePath, destFolder, fileName, resolution.resolution);
            }
            if (result.success && !result.skipped) {
                success++;
            } else if (!result.success) {
                failed++;
            }
        } catch (error) {
            failed++;
        }
        if (progressTotal > 0) {
            updateProgress(progressOffset + i + 1, progressTotal);
        }
    }
    return { success, failed };
}

async function moveFilesToFolder(filePaths, destFolder) {
    if (!filePaths || filePaths.length === 0) return;

    showProgress(0, filePaths.length, 'Moving files...');
    const { success, failed } = await _moveFilesBatch(filePaths, destFolder, 0, filePaths.length);
    hideProgress();

    if (success > 0) {
        // Refresh in-memory ratings/pins so moved files keep their metadata
        await Promise.all([loadRatings(), loadPins()]);
        await navigateToFolder(currentFolderPath);
    }
    if (failed > 0 && success > 0) {
        showToast(`Moved ${success} file(s), ${failed} failed`, 'warning');
    } else if (failed > 0) {
        showToast(`Failed to move ${failed} file(s)`, 'error');
    } else if (success > 0) {
        showToast(`Moved ${success} file(s)`, 'success');
    }
}

async function organizeByDate() {
    if (!currentFolderPath) return;

    const items = currentItems.filter(item => item.type !== 'folder');
    if (items.length === 0) return;

    showProgress(0, items.length, 'Organizing by date...');

    const dateFolders = {};

    for (let i = 0; i < items.length; i++) {
        if (currentProgress && currentProgress.cancelled) break;

        const item = items[i];
        try {
            const result = await window.electronAPI.getFileInfo(item.path);
            if (result.success && result.info) {
                const date = new Date(result.info.modified);
                const folderName = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

                if (!dateFolders[folderName]) {
                    dateFolders[folderName] = [];
                }
                dateFolders[folderName].push(item.path);
            }
        } catch (error) {
            console.error('Error getting file stats:', error);
        }

        updateProgress(i + 1, items.length);
    }

    // Create folders and move files — use silent batch mover, single progress bar
    let totalFiles = Object.values(dateFolders).reduce((sum, arr) => sum + arr.length, 0);
    let processed = 0;
    let totalSuccess = 0;
    let totalFailed = 0;

    showProgress(0, totalFiles, 'Moving files into date folders...');
    for (const [folderName, filePaths] of Object.entries(dateFolders)) {
        if (currentProgress && currentProgress.cancelled) break;
        const separator = currentFolderPath.includes('\\') ? '\\' : '/';
        const folderPath = currentFolderPath + (currentFolderPath.endsWith('\\') || currentFolderPath.endsWith('/') ? '' : separator) + folderName;
        await window.electronAPI.createFolder(currentFolderPath, folderName);
        const { success, failed } = await _moveFilesBatch(filePaths, folderPath, processed, totalFiles);
        totalSuccess += success;
        totalFailed += failed;
        processed += filePaths.length;
    }

    hideProgress();
    await Promise.all([loadRatings(), loadPins()]);
    await navigateToFolder(currentFolderPath);
    if (totalFailed > 0) {
        showToast(`Organized files: ${totalSuccess} moved, ${totalFailed} failed`, 'warning');
    } else if (totalSuccess > 0) {
        showToast(`Organized ${totalSuccess} file(s) by date`, 'success');
    }
}

async function organizeByType() {
    if (!currentFolderPath) return;

    const items = currentItems.filter(item => item.type !== 'folder');
    if (items.length === 0) return;

    const typeFolders = {};

    for (const item of items) {
        const ext = item.name.substring(item.name.lastIndexOf('.') + 1).toLowerCase();
        const folderName = ext.toUpperCase() || 'Other';
        if (!typeFolders[folderName]) {
            typeFolders[folderName] = [];
        }
        typeFolders[folderName].push(item.path);
    }

    // Single progress bar for all moves
    let totalFiles = Object.values(typeFolders).reduce((sum, arr) => sum + arr.length, 0);
    let processed = 0;
    let totalSuccess = 0;
    let totalFailed = 0;

    showProgress(0, totalFiles, 'Moving files into type folders...');
    for (const [folderName, filePaths] of Object.entries(typeFolders)) {
        if (currentProgress && currentProgress.cancelled) break;
        const folderPath = currentFolderPath + (currentFolderPath.endsWith('\\') || currentFolderPath.endsWith('/') ? '' : '\\') + folderName;
        await window.electronAPI.createFolder(currentFolderPath, folderName);
        const { success, failed } = await _moveFilesBatch(filePaths, folderPath, processed, totalFiles);
        totalSuccess += success;
        totalFailed += failed;
        processed += filePaths.length;
    }

    hideProgress();
    await Promise.all([loadRatings(), loadPins()]);
    await navigateToFolder(currentFolderPath);
    if (totalFailed > 0) {
        showToast(`Organized files: ${totalSuccess} moved, ${totalFailed} failed`, 'warning');
    } else if (totalSuccess > 0) {
        showToast(`Organized ${totalSuccess} file(s) by type`, 'success');
    }
}

// Progress indicators
function showProgress(current, total, text) {
    currentProgress = { current, total, cancelled: false };
    const indicator = document.getElementById('progress-indicator');
    const progressText = document.getElementById('progress-text');
    const progressFill = document.getElementById('progress-bar-fill');

    if (indicator) indicator.classList.remove('hidden');
    if (progressText) progressText.textContent = text || 'Processing...';
    setStatusActivity(text || 'Processing...');
    updateProgress(current, total);
}

function updateProgress(current, total) {
    if (!currentProgress) return;
    currentProgress.current = current;
    currentProgress.total = total;
    
    const progressFill = document.getElementById('progress-bar-fill');
    if (progressFill && total > 0) {
        const percent = (current / total) * 100;
        progressFill.style.width = `${percent}%`;
    }
    
    const progressText = document.getElementById('progress-text');
    if (progressText && total > 0) {
        progressText.textContent = `Processing... ${current} of ${total}`;
    }
}

function hideProgress() {
    currentProgress = null;
    const indicator = document.getElementById('progress-indicator');
    if (indicator) indicator.classList.add('hidden');
    setStatusActivity('');
}

function cancelProgress() {
    if (currentProgress) {
        currentProgress.cancelled = true;
    }
    hideProgress();
}

// File watching
let currentWatchedFolder = null;

async function startWatchingFolder(folderPath) {
    // Normalize path for consistent comparison
    const normalizedPath = normalizePath(folderPath);
    if (currentWatchedFolder && normalizePath(currentWatchedFolder) === normalizedPath) return;
    
    // Stop watching previous folder
    if (currentWatchedFolder) {
        await window.electronAPI.unwatchFolder(currentWatchedFolder);
    }
    
    // Start watching new folder
    try {
        const result = await window.electronAPI.watchFolder(folderPath);
        if (result.success) {
            currentWatchedFolder = folderPath;
        }
    } catch (error) {
        console.error('Error watching folder:', error);
    }
}

// Recent files preview is now handled inline in renderRecentFiles

// Update applyFilters to include advanced search
// Note: With virtual scrolling, all filtering (including advanced) is handled at the
// items-array level in applyFilters itself, so this wrapper is only needed as a no-op
// to maintain the override chain. The originalApplyFilters reference is kept for
// backward compatibility if VS is ever disabled.
const originalApplyFilters = applyFilters;
applyFilters = function() {
    // Virtual scrolling handles all filtering at the items-array level
    originalApplyFilters();
};

function parseAspectRatio(ratioStr) {
    if (!ratioStr || ratioStr.trim() === '') return NaN;
    const [w, h] = ratioStr.split(':').map(Number);
    if (isNaN(w) || isNaN(h) || h === 0) return NaN;
    return w / h;
}

// Initialize new features
let newFeaturesInitialized = false;
function initNewFeatures() {
    if (newFeaturesInitialized) return;
    newFeaturesInitialized = true;
    // Lightbox navigation buttons
    const prevBtn = document.getElementById('lightbox-prev');
    const nextBtn = document.getElementById('lightbox-next');
    if (prevBtn) prevBtn.addEventListener('click', () => navigateLightbox('prev'));
    if (nextBtn) nextBtn.addEventListener('click', () => navigateLightbox('next'));
    
    // Custom media control bar is initialized lazily in openLightbox()
    
    // File info button - attach listener directly to button
    const infoBtn = document.getElementById('lightbox-info-btn');
    console.log('Initializing file info button:', infoBtn);
    if (infoBtn) {
        // Remove any existing listeners by cloning and replacing
        const newInfoBtn = infoBtn.cloneNode(true);
        infoBtn.parentNode.replaceChild(newInfoBtn, infoBtn);
        
        // Use event delegation or direct attachment
        newInfoBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            e.preventDefault();
            console.log('File info button clicked!');
            
            const panel = document.getElementById('file-info-panel');
            
            // Toggle panel: if it's open, close it; if it's closed, open it
            if (panel && !panel.classList.contains('hidden')) {
                // Panel is open, close it
                panel.classList.add('hidden');
                console.log('File info panel closed');
                return;
            }
            
            // Panel is closed, open it with file info
            // Try multiple ways to get the file path
            let filePath = window.currentLightboxFilePath;
            console.log('Trying to get file path:', { 
                currentLightboxFilePath: window.currentLightboxFilePath,
                lightboxItemsLength: lightboxItems.length,
                currentLightboxIndex: currentLightboxIndex
            });
            
            if (!filePath) {
                const copyPathBtn = document.getElementById('copy-path-btn');
                filePath = copyPathBtn?.dataset.filePath;
                console.log('Got filePath from copyPathBtn:', filePath);
            }
            if (!filePath && lightboxItems.length > 0 && currentLightboxIndex >= 0) {
                filePath = lightboxItems[currentLightboxIndex]?.path;
                console.log('Got filePath from lightboxItems:', filePath);
            }
            if (!filePath && lightboxVideo && lightboxVideo.src) {
                // Try to extract path from video src
                const src = lightboxVideo.src;
                if (src.startsWith('file://')) {
                    filePath = src.replace('file:///', '').replace(/\//g, '\\');
                    console.log('Got filePath from video src:', filePath);
                }
            }
            if (!filePath && lightboxImage && lightboxImage.src) {
                // Try to extract path from image src
                const src = lightboxImage.src;
                if (src.startsWith('file://')) {
                    filePath = src.replace('file:///', '').replace(/\//g, '\\');
                    console.log('Got filePath from image src:', filePath);
                }
            }
            
            console.log('Final filePath for info panel:', filePath);
            if (filePath) {
                try {
                    await showFileInfo(filePath);
                } catch (error) {
                    console.error('Error showing file info:', error);
                    const details = document.getElementById('file-info-details');
                    if (panel && details) {
                        panel.classList.remove('hidden');
                        panel.style.display = 'block';
                        details.innerHTML = `<div class="file-info-detail-row">Error: ${escapeHtml(error.message)}</div>`;
                    }
                }
            } else {
                console.warn('Could not determine file path for info panel');
                // Show error in panel instead of alert
                const details = document.getElementById('file-info-details');
                if (panel && details) {
                    panel.classList.remove('hidden');
                    panel.style.display = 'block';
                    details.innerHTML = '<div class="file-info-detail-row">Error: Could not determine file path</div>';
                }
            }
        });
        console.log('File info button listener attached');
    } else {
        console.error('File info button not found!');
    }
    
    const fileInfoCloseBtn = document.getElementById('file-info-close');
    const fileInfoPanel = document.getElementById('file-info-panel');
    if (fileInfoCloseBtn) {
        fileInfoCloseBtn.addEventListener('click', () => {
            if (fileInfoPanel) fileInfoPanel.classList.add('hidden');
        });
    }
    
    // Prevent clicks inside panel from closing it; handle GPS map links
    if (fileInfoPanel) {
        fileInfoPanel.addEventListener('click', (e) => {
            e.stopPropagation();
            // GPS coordinate link → open in browser
            const gpsLink = e.target.closest('.exif-gps-link');
            if (gpsLink) {
                e.preventDefault();
                const url = gpsLink.dataset.url;
                if (url) window.electronAPI.openUrl(url);
            }
        });
        
        // Close when clicking outside the lightbox (but keep open when clicking inside lightbox)
        document.addEventListener('click', (e) => {
            const infoBtn = document.getElementById('lightbox-info-btn');
            const lightbox = document.getElementById('lightbox');
            
            // Don't close if:
            // - Panel is hidden (no need to check)
            // - Clicking on the panel itself
            // - Clicking on the info button (toggles the panel)
            // - Clicking anywhere inside the lightbox (navigation, controls, content, etc.)
            const isClickOnPanel = fileInfoPanel.contains(e.target);
            const isClickOnInfoBtn = infoBtn && infoBtn.contains(e.target);
            const isClickInsideLightbox = lightbox && !lightbox.classList.contains('hidden') && 
                                         (lightbox.contains(e.target) || e.target.closest('#lightbox'));
            
            if (!fileInfoPanel.classList.contains('hidden') && 
                !isClickOnPanel && 
                !isClickOnInfoBtn &&
                !isClickInsideLightbox) {
                // Only close if clicking outside the lightbox entirely
                fileInfoPanel.classList.add('hidden');
            }
        });
    }
    
    // Advanced search
    const advancedSearchBtn = document.getElementById('advanced-search-btn');
    const advancedSearchPanel = document.getElementById('advanced-search-panel');
    const applyAdvancedSearchBtn = document.getElementById('apply-advanced-search');
    const clearAdvancedSearchBtn = document.getElementById('clear-advanced-search');
    const advancedSearchCloseX = document.getElementById('advanced-search-close-x');

    if (advancedSearchBtn) {
        advancedSearchBtn.addEventListener('click', () => {
            if (advancedSearchPanel) {
                advancedSearchPanel.classList.toggle('hidden');
                // Sync sort dropdown and recursive checkbox to current state when opening
                if (!advancedSearchPanel.classList.contains('hidden')) {
                    const advSortEl = document.getElementById('advanced-sort-type');
                    if (advSortEl) advSortEl.value = sortType || 'name';
                    const recursiveCheckbox = document.getElementById('search-recursive');
                    if (recursiveCheckbox) recursiveCheckbox.checked = recursiveSearchEnabled;
                }
            }
        });
    }

    if (applyAdvancedSearchBtn) {
        applyAdvancedSearchBtn.addEventListener('click', applyAdvancedSearch);
    }

    if (clearAdvancedSearchBtn) {
        clearAdvancedSearchBtn.addEventListener('click', clearAdvancedSearch);
    }

    if (advancedSearchCloseX) {
        advancedSearchCloseX.addEventListener('click', () => {
            if (advancedSearchPanel) advancedSearchPanel.classList.add('hidden');
        });
    }

    // Click outside to close advanced search
    if (advancedSearchPanel) {
        advancedSearchPanel.addEventListener('click', (e) => {
            if (e.target === advancedSearchPanel) {
                advancedSearchPanel.classList.add('hidden');
            }
        });
    }
    
    // Organize dialog
    const organizeBtn = document.getElementById('organize-btn');
    const organizeDialog = document.getElementById('organize-dialog');
    const createFolderBtn = document.getElementById('create-folder-btn');
    const moveToFolderBtn = document.getElementById('move-to-folder-btn');
    const organizeByDateBtn = document.getElementById('organize-by-date-btn');
    const organizeByTypeBtn = document.getElementById('organize-by-type-btn');
    const organizeInputContainer = document.getElementById('organize-folder-input-container');
    const organizeFolderName = document.getElementById('organize-folder-name');
    const organizeConfirmBtn = document.getElementById('organize-confirm-btn');
    const organizeCancelBtn = document.getElementById('organize-cancel-btn');
    const closeOrganizeDialogBtn = document.getElementById('close-organize-dialog');
    let organizeMode = null;
    
    if (organizeBtn) {
        organizeBtn.addEventListener('click', () => {
            const toolsDropdown = document.getElementById('tools-menu-dropdown');
            if (toolsDropdown) toolsDropdown.classList.add('hidden');
            if (organizeDialog) organizeDialog.classList.remove('hidden');
        });
    }
    
    if (createFolderBtn) {
        createFolderBtn.addEventListener('click', () => {
            organizeMode = 'create';
            if (organizeInputContainer) organizeInputContainer.classList.remove('hidden');
            if (organizeFolderName) organizeFolderName.value = '';
        });
    }
    
    if (moveToFolderBtn) {
        moveToFolderBtn.addEventListener('click', () => {
            organizeMode = 'move';
            if (organizeInputContainer) organizeInputContainer.classList.remove('hidden');
            if (organizeFolderName) organizeFolderName.value = '';
        });
    }
    
    if (organizeByDateBtn) {
        organizeByDateBtn.addEventListener('click', () => {
            organizeByDate();
            if (organizeDialog) organizeDialog.classList.add('hidden');
        });
    }
    
    if (organizeByTypeBtn) {
        organizeByTypeBtn.addEventListener('click', () => {
            organizeByType();
            if (organizeDialog) organizeDialog.classList.add('hidden');
        });
    }
    
    if (organizeConfirmBtn) {
        organizeConfirmBtn.addEventListener('click', async () => {
            const folderName = organizeFolderName?.value.trim();
            if (!folderName) return;
            
            if (organizeMode === 'create') {
                await createFolder(folderName);
            } else if (organizeMode === 'move') {
                // Get selected files - for now, move all files
                const selectedFiles = currentItems.filter(item => item.type !== 'folder').map(item => item.path);
                if (selectedFiles.length > 0) {
                    const separator = currentFolderPath.includes('\\') ? '\\' : '/';
                    const destFolder = currentFolderPath + (currentFolderPath.endsWith('\\') || currentFolderPath.endsWith('/') ? '' : separator) + folderName;
                    await window.electronAPI.createFolder(currentFolderPath, folderName);
                    await moveFilesToFolder(selectedFiles, destFolder);
                }
            }
            
            if (organizeInputContainer) organizeInputContainer.classList.add('hidden');
            if (organizeDialog) organizeDialog.classList.add('hidden');
        });
    }
    
    if (organizeCancelBtn) {
        organizeCancelBtn.addEventListener('click', () => {
            if (organizeInputContainer) organizeInputContainer.classList.add('hidden');
            organizeMode = null;
        });
    }
    
    if (closeOrganizeDialogBtn) {
        closeOrganizeDialogBtn.addEventListener('click', () => {
            if (organizeDialog) organizeDialog.classList.add('hidden');
            if (organizeInputContainer) organizeInputContainer.classList.add('hidden');
            organizeMode = null;
        });
    }
    
    // Progress cancel button
    const cancelProgressBtn = document.getElementById('cancel-progress');
    if (cancelProgressBtn) {
        cancelProgressBtn.addEventListener('click', cancelProgress);
    }
    
    // Star rating filter - 2-part button
    // Left: toggle star filter on/off
    // Right: cycle sort direction (none → desc → asc → none)
    const filterStarsToggle = document.getElementById('filter-stars-toggle');
    const filterStarsSortBtn = document.getElementById('filter-stars-sort');

    function reapplyStarFilter() {
        if (currentFolderPath && currentItems.length > 0) {
            const filteredItems = filterItems(currentItems);
            const sortedItems = sortItems(filteredItems);
            renderItems(sortedItems);
        } else {
            scheduleApplyFilters();
        }
    }

    function updateStarSortButtonState() {
        if (!filterStarsSortBtn) return;
        filterStarsSortBtn.classList.remove('sort-desc', 'sort-asc');
        if (starSortOrder === 'desc') filterStarsSortBtn.classList.add('sort-desc');
        else if (starSortOrder === 'asc') filterStarsSortBtn.classList.add('sort-asc');
        const titles = { none: 'Sort: using settings', desc: 'Sort: high to low', asc: 'Sort: low to high' };
        filterStarsSortBtn.title = titles[starSortOrder] || titles.none;
    }

    if (filterStarsToggle) {
        filterStarsToggle.addEventListener('click', () => {
            starFilterActive = !starFilterActive;
            filterStarsToggle.classList.toggle('active', starFilterActive);
            reapplyStarFilter();
        });
    }

    // Tag filter button — handler set via addEventListener in renderer.js

    if (filterStarsSortBtn) {
        updateStarSortButtonState();
        filterStarsSortBtn.addEventListener('click', () => {
            // Cycle: none → desc → asc → none
            if (starSortOrder === 'none') starSortOrder = 'desc';
            else if (starSortOrder === 'desc') starSortOrder = 'asc';
            else starSortOrder = 'none';
            updateStarSortButtonState();
            reapplyStarFilter();
        });
    }
    
    // File watching
    const _sidebarRefreshTimers = new Map(); // debounce sidebar tree refreshes per parent path
    window.electronAPI.onFolderChanged((event, data) => {
        if (!currentFolderPath) return;

        // Normalize paths for consistent comparison (case-insensitive on Windows)
        const normalizedWatchedPath = normalizePath(data.folderPath).toLowerCase();
        const normalizedCurrentPath = normalizePath(currentFolderPath).toLowerCase();
        
        // Check if the change is in the currently viewed folder or any of its subfolders
        // The watched folder should match the current folder, OR
        // the changed file should be within the current folder tree
        const isInCurrentFolder = normalizedWatchedPath === normalizedCurrentPath;
        let isInSubfolder = false;
        let subfolderPath = null;
        
        if (data.filePath) {
            const normalizedFilePath = normalizePath(data.filePath).toLowerCase();
            // Check if file is in current folder or any subfolder
            // Add '/' to ensure we match folders, not just prefix matches
            const currentPathWithSlash = normalizedCurrentPath + '/';
            isInSubfolder = normalizedFilePath.startsWith(currentPathWithSlash) || 
                           normalizedFilePath === normalizedCurrentPath;
            
            // Extract the subfolder path from the file path
            // This is the folder containing the changed file
            if (isInSubfolder && normalizedFilePath !== normalizedCurrentPath) {
                // Get the directory containing the file (this is the subfolder)
                // Use the original filePath and normalize it
                const lastSlashIndex = Math.max(
                    data.filePath.lastIndexOf('/'),
                    data.filePath.lastIndexOf('\\')
                );
                if (lastSlashIndex !== -1) {
                    subfolderPath = data.filePath.substring(0, lastSlashIndex);
                }
            }
        }
        
        if (isInCurrentFolder || isInSubfolder) {
            // Keep Explorer sidebar in sync when subfolders are created or removed (expanded branches only)
            // Debounced per parentPath so rapid-fire events (git checkout, npm install) coalesce.
            if (data.filePath && (data.event === 'addDir' || data.event === 'unlinkDir')) {
                const parentPath = window.sidebarParentDirPath?.(data.filePath);
                if (parentPath) {
                    const key = parentPath.replace(/\\/g, '/').toLowerCase();
                    clearTimeout(_sidebarRefreshTimers.get(key));
                    _sidebarRefreshTimers.set(key, setTimeout(() => {
                        _sidebarRefreshTimers.delete(key);
                        window.refreshSidebarTreeBranchForParentPath?.(parentPath);
                    }, 200));
                }
            }

            // If change is in a subfolder, invalidate that subfolder's cache
            // This ensures that when navigating into the subfolder, fresh data is loaded
            if (subfolderPath) {
                invalidateFolderCache(subfolderPath);
                
                // If we're currently viewing that subfolder, refresh it immediately
                const normalizedSubfolderPath = normalizePath(subfolderPath).toLowerCase();
                if (normalizedSubfolderPath === normalizedCurrentPath) {
                    setTimeout(() => {
                        navigateToFolder(currentFolderPath, false, true); // forceReload = true to ensure fresh data
                    }, 100);
                    return; // Don't refresh parent if we're already refreshing the subfolder
                }
            }
            
            // Refresh current folder (parent) to show newly created/modified/deleted files
            // Use a small delay to ensure file system operations are complete
            setTimeout(() => {
                navigateToFolder(currentFolderPath, false, true); // forceReload = true to ensure fresh data
            }, 100);
        }
    });
    
    // Keyboard shortcuts for lightbox (arrow nav, frame step, play/pause, speed)
    document.addEventListener('keydown', (e) => {
        if (!lightbox.classList.contains('hidden')) {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                return;
            }

            if (matchesShortcut(e, 'lb_prev')) {
                e.preventDefault();
                navigateLightbox('prev');
            } else if (matchesShortcut(e, 'lb_next')) {
                e.preventDefault();
                navigateLightbox('next');
            } else if (matchesShortcut(e, 'lb_prevFrame')) {
                e.preventDefault();
                if (activePlaybackController) activePlaybackController.stepFrame('prev');
            } else if (matchesShortcut(e, 'lb_nextFrame')) {
                e.preventDefault();
                if (activePlaybackController) activePlaybackController.stepFrame('next');
            } else if (matchesShortcut(e, 'lb_playPause')) {
                e.preventDefault();
                if (activePlaybackController) activePlaybackController.togglePlay();
            } else if (matchesShortcut(e, 'lb_speedDown')) {
                e.preventDefault();
                if (activePlaybackController && mediaControlBarInstance) {
                    let speeds;
                    try { speeds = JSON.parse(localStorage.getItem('playbackSpeeds')); } catch {}
                    if (!Array.isArray(speeds) || !speeds.length) speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
                    const cur = activePlaybackController.getSpeed();
                    const idx = speeds.indexOf(cur);
                    if (idx > 0) {
                        activePlaybackController.setSpeed(speeds[idx - 1]);
                        mediaControlBarInstance.syncState({ speed: speeds[idx - 1] });
                    }
                }
            } else if (matchesShortcut(e, 'lb_speedUp')) {
                e.preventDefault();
                if (activePlaybackController && mediaControlBarInstance) {
                    let speeds;
                    try { speeds = JSON.parse(localStorage.getItem('playbackSpeeds')); } catch {}
                    if (!Array.isArray(speeds) || !speeds.length) speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
                    const cur = activePlaybackController.getSpeed();
                    const idx = speeds.indexOf(cur);
                    if (idx < speeds.length - 1) {
                        activePlaybackController.setSpeed(speeds[idx + 1]);
                        mediaControlBarInstance.syncState({ speed: speeds[idx + 1] });
                    }
                }
            }
        }
    });
}

// openLightbox already updated above to track current index

// Hook into navigateToFolder to start watching (will be called after navigation completes)
// This is handled in the navigateToFolder function itself

// ==================== DUPLICATE DETECTION ====================

let duplicateGroups = [];
let duplicateMarkedForDeletion = new Set();
let duplicateHighlightPaths = new Map(); // Map<path, groupIndex> for VS-persistent highlights
let duplicateScanActive = false;
let cachedHashData = null;
let regroupTimer = null;
let hoveredDuplicateGroupIdx = -1;

function initDuplicateDetection() {
    const btn = document.getElementById('find-duplicates-btn');
    const modal = document.getElementById('duplicates-modal');
    const closeBtn = document.getElementById('duplicates-modal-close');
    const thresholdInput = document.getElementById('duplicates-threshold');
    const thresholdValue = document.getElementById('duplicates-threshold-value');
    const highlightBtn = document.getElementById('duplicates-highlight-btn');
    const deleteBtn = document.getElementById('duplicates-delete-btn');

    if (!btn || !modal) return;

    btn.addEventListener('click', () => {
        if (!currentFolderPath) return;
        // Close tools menu
        const toolsMenu = document.getElementById('tools-menu');
        if (toolsMenu) toolsMenu.classList.add('hidden');
        openDuplicatesModal();
    });

    closeBtn.addEventListener('click', closeDuplicatesModal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeDuplicatesModal();
    });

    thresholdInput.addEventListener('input', () => {
        const val = parseInt(thresholdInput.value);
        thresholdValue.textContent = Math.round(((64 - val) / 64) * 100) + '%';
        if (cachedHashData) {
            clearTimeout(regroupTimer);
            regroupTimer = setTimeout(regroupFromCache, 200);
        }
    });

    // Keybind: press C to toggle compare (open on hover, close if open)
    document.addEventListener('keydown', (e) => {
        if (modal.classList.contains('hidden')) return;
        if (e.key === 'c' || e.key === 'C') {
            const lightbox = document.getElementById('duplicate-compare-lightbox');
            if (lightbox && !lightbox.classList.contains('hidden')) {
                e.preventDefault();
                closeComparisonLightbox();
                return;
            }
            if (hoveredDuplicateGroupIdx >= 0) {
                e.preventDefault();
                openComparisonLightbox(hoveredDuplicateGroupIdx);
            }
        }
    });

    highlightBtn.addEventListener('click', () => {
        highlightDuplicatesInGrid();
        closeDuplicatesModal();
    });

    deleteBtn.addEventListener('click', async () => {
        if (duplicateMarkedForDeletion.size === 0) return;
        const count = duplicateMarkedForDeletion.size;
        if (!await showConfirm('Delete Files', `Delete ${count} file(s)?`, { confirmLabel: 'Delete', danger: true })) return;

        deleteBtn.disabled = true;
        deleteBtn.textContent = 'Deleting...';

        if (count > 10) {
            showProgress(0, count, `Deleting ${count} files...`);
            window.electronAPI.onBatchDeleteProgress((_e, data) => {
                updateProgress(data.current, data.total);
            });
        }
        const result = await window.electronAPI.deleteFilesBatch([...duplicateMarkedForDeletion]);
        window.electronAPI.removeBatchDeleteProgressListener();
        hideProgress();
        const failCount = result.failed ? result.failed.length : 0;
        const successCount = count - failCount;
        if (failCount > 0 && successCount > 0) {
            const errorSummary = groupBatchErrors(result.failed);
            showToast(`Deleted ${successCount} file(s), ${failCount} failed: ${errorSummary}`, 'warning');
        } else if (failCount > 0) {
            const errorSummary = groupBatchErrors(result.failed);
            showToast(`Failed to delete ${failCount} file(s): ${errorSummary}`, 'error');
        } else if (result.trashed) {
            showToast(`Moved ${count} file(s) to Recycle Bin`, 'success');
        } else {
            showToast(`Deleted ${count} file(s)`, 'success', {
                duration: 8000,
                actionLabel: 'Undo',
                actionCallback: () => {
                    window.electronAPI.undoFileOperation().then(undoResult => {
                        if (undoResult.success) {
                            showToast(`Restored ${count} file(s)`, 'success');
                            if (currentFolderPath) {
                                invalidateFolderCache(currentFolderPath);
                                loadVideos(currentFolderPath);
                            }
                        } else {
                            showToast(`Undo failed: ${undoResult.error}`, 'error');
                        }
                    }).catch(err => {
                        showToast(`Undo failed: ${friendlyError(err)}`, 'error');
                    });
                }
            });
        }

        duplicateMarkedForDeletion.clear();
        closeDuplicatesModal();
        clearDuplicateHighlights();

        if (currentFolderPath) {
            loadVideos(currentFolderPath);
        }
    });
}

function openDuplicatesModal() {
    const modal = document.getElementById('duplicates-modal');
    const scanning = document.getElementById('duplicates-scanning');
    const results = document.getElementById('duplicates-results');
    const empty = document.getElementById('duplicates-empty');
    const highlightBtn = document.getElementById('duplicates-highlight-btn');
    const deleteBtn = document.getElementById('duplicates-delete-btn');
    const summary = document.getElementById('duplicates-summary');

    modal.classList.remove('hidden');
    scanning.classList.remove('hidden');
    results.innerHTML = '';
    empty.classList.add('hidden');
    highlightBtn.disabled = true;
    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Delete Selected (0)';
    summary.textContent = '';
    duplicateGroups = [];
    duplicateMarkedForDeletion.clear();
    duplicateScanActive = true;

    startDuplicateScan();
}

function closeDuplicatesModal() {
    const modal = document.getElementById('duplicates-modal');
    modal.classList.add('hidden');
    duplicateScanActive = false;
    cachedHashData = null;
    clearTimeout(regroupTimer);
    cleanupDuplicateHoverPreviews();
    window.electronAPI.removeDuplicateScanProgressListener();
}

async function startDuplicateScan() {
    const progressFill = document.getElementById('duplicates-progress-fill');
    const progressText = document.getElementById('duplicates-progress-text');
    const scanning = document.getElementById('duplicates-scanning');
    const thresholdInput = document.getElementById('duplicates-threshold');
    const threshold = parseInt(thresholdInput.value);

    progressFill.style.width = '0%';
    progressText.textContent = 'Scanning files...';

    window.electronAPI.removeDuplicateScanProgressListener();
    window.electronAPI.onDuplicateScanProgress((event, data) => {
        if (!duplicateScanActive) return;
        if (data.phase === 'hashing' && data.total > 0) {
            const pct = Math.round((data.current / data.total) * 100);
            progressFill.style.width = pct + '%';
            progressText.textContent = `Hashing files... ${data.current}/${data.total}`;
        } else if (data.phase === 'comparing') {
            progressFill.style.width = '100%';
            progressText.textContent = 'Comparing hashes...';
        }
    });

    try {
        const result = await window.electronAPI.scanDuplicates(currentFolderPath, { threshold });
        if (!duplicateScanActive) return;

        scanning.classList.add('hidden');
        window.electronAPI.removeDuplicateScanProgressListener();

        cachedHashData = result.hashData || null;

        const allGroups = [];
        if (result.exactGroups) {
            for (const group of result.exactGroups) {
                allGroups.push({ type: 'exact', files: group });
            }
        }
        if (result.similarGroups) {
            for (const group of result.similarGroups) {
                allGroups.push({ type: 'similar', files: group });
            }
        }

        duplicateGroups = allGroups;
        renderDuplicateGroups(allGroups);
    } catch (error) {
        scanning.classList.add('hidden');
        console.error('Duplicate scan failed:', error);
        const empty = document.getElementById('duplicates-empty');
        empty.querySelector('p').textContent = 'Scan failed: ' + error.message;
        empty.classList.remove('hidden');
    }
}

async function regroupFromCache() {
    if (!cachedHashData) return;
    const thresholdInput = document.getElementById('duplicates-threshold');
    const threshold = parseInt(thresholdInput.value);

    const result = await window.electronAPI.regroupDuplicates(cachedHashData, threshold);

    const allGroups = [];
    if (result.exactGroups) {
        for (const group of result.exactGroups) {
            allGroups.push({ type: 'exact', files: group });
        }
    }
    if (result.similarGroups) {
        for (const group of result.similarGroups) {
            allGroups.push({ type: 'similar', files: group });
        }
    }

    duplicateGroups = allGroups;
    duplicateMarkedForDeletion.clear();
    renderDuplicateGroups(allGroups);
}

function cleanupDuplicateHoverPreviews() {
    document.querySelectorAll('.duplicate-hover-preview').forEach(p => p.remove());
}

function renderDuplicateGroups(groups) {
    const container = document.getElementById('duplicates-results');
    const empty = document.getElementById('duplicates-empty');
    const highlightBtn = document.getElementById('duplicates-highlight-btn');
    const summary = document.getElementById('duplicates-summary');

    cleanupDuplicateHoverPreviews();
    container.innerHTML = '';

    if (groups.length === 0) {
        empty.classList.remove('hidden');
        summary.textContent = 'No duplicates found';
        return;
    }

    empty.classList.add('hidden');
    highlightBtn.disabled = false;

    let totalFiles = 0;
    let totalGroups = groups.length;

    groups.forEach((group, groupIdx) => {
        totalFiles += group.files.length;
        const groupEl = document.createElement('div');
        groupEl.className = 'duplicate-group';
        groupEl.dataset.groupId = groupIdx;
        groupEl.addEventListener('mouseenter', () => { hoveredDuplicateGroupIdx = groupIdx; });
        groupEl.addEventListener('mouseleave', () => { hoveredDuplicateGroupIdx = -1; });

        const typeLabel = group.type === 'exact' ? 'Exact Match' : 'Similar';
        const header = document.createElement('div');
        header.className = 'duplicate-group-header';
        header.innerHTML = `
            <span class="duplicate-group-label">Group ${groupIdx + 1} (${typeLabel}) &mdash; ${group.files.length} files</span>
        `;

        if (group.files.length >= 2) {
            const compareBtn = document.createElement('button');
            compareBtn.className = 'duplicate-group-compare-btn';
            compareBtn.textContent = 'Compare';
            compareBtn.addEventListener('click', () => openComparisonLightbox(groupIdx));
            header.appendChild(compareBtn);
        }

        const keepBestBtn = document.createElement('button');
        keepBestBtn.className = 'duplicate-group-keep-best';
        keepBestBtn.textContent = 'Keep Largest';
        keepBestBtn.addEventListener('click', () => keepBestInGroup(groupIdx));
        header.appendChild(keepBestBtn);

        groupEl.appendChild(header);

        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'duplicate-group-items';

        for (const file of group.files) {
            const itemEl = createDuplicateItemEl(file, groupIdx);
            itemsContainer.appendChild(itemEl);
        }

        groupEl.appendChild(itemsContainer);
        container.appendChild(groupEl);

        // Auto-keep priority: 1) star rating, 2) no copy marker in name
        const ratedFiles = group.files.filter(f => getFileRating(f.path) > 0);
        if (ratedFiles.length >= 1) {
            let best = ratedFiles[0];
            for (const f of ratedFiles) {
                if (getFileRating(f.path) > getFileRating(best.path)) best = f;
            }
            keepFileInGroup(best.path, groupIdx);
        } else {
            // No rated files — prefer the original (no copy marker)
            const copyPattern = /[\s\-_]*\((\d+)\)\s*(?=\.[^.]+$)/;
            const originals = group.files.filter(f => !copyPattern.test(f.name));
            const copies = group.files.filter(f => copyPattern.test(f.name));
            if (originals.length >= 1 && copies.length >= 1) {
                // Keep the largest original
                let best = originals[0];
                for (const f of originals) {
                    if (f.size > best.size) best = f;
                }
                keepFileInGroup(best.path, groupIdx);
            }
        }
    });

    summary.textContent = `${totalGroups} group(s), ${totalFiles} files`;
}

function createDuplicateItemEl(file, groupIdx) {
    const el = document.createElement('div');
    el.className = 'duplicate-item';
    el.dataset.path = file.path;
    el.dataset.groupId = groupIdx;

    // Data attributes for blow-up preview (right-click hold)
    const dupExt = file.name.split('.').pop().toLowerCase();
    const dupVideoExts = ['mp4', 'webm', 'ogg', 'mov'];
    const dupFileUrl = `file:///${file.path.replace(/\\/g, '/')}`;
    el.dataset.src = dupFileUrl;
    el.dataset.name = file.name;
    if (dupVideoExts.includes(dupExt)) el.dataset.mediaType = 'video';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'duplicate-select';
    checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
            duplicateMarkedForDeletion.add(file.path);
            el.classList.add('marked-for-deletion');
            el.classList.remove('kept');
        } else {
            duplicateMarkedForDeletion.delete(file.path);
            el.classList.remove('marked-for-deletion');
        }
        updateDeleteButton();
    });

    const thumb = document.createElement('img');
    thumb.className = 'duplicate-thumb';
    // Use file URL for thumbnail
    const fileUrl = file.path.replace(/\\/g, '/');
    thumb.src = `file:///${fileUrl}`;
    thumb.alt = file.name;
    thumb.loading = 'lazy';
    thumb.onerror = () => {
        thumb.style.display = 'none';
    };

    const info = document.createElement('div');
    info.className = 'duplicate-info';

    const nameRow = document.createElement('span');
    nameRow.className = 'duplicate-name';
    nameRow.title = file.name;
    nameRow.textContent = file.name;
    const copyPattern = /[\s\-_]*\((\d+)\)\s*(?=\.[^.]+$)/;
    if (copyPattern.test(file.name)) {
        const copyTag = document.createElement('span');
        copyTag.className = 'duplicate-copy-tag';
        copyTag.textContent = 'Copy';
        nameRow.appendChild(copyTag);
    }

    const details = document.createElement('span');
    details.className = 'duplicate-details';
    details.textContent = formatFileSize(file.size) + ' \u2014 ' + new Date(file.mtime).toLocaleDateString();

    const pathEl = document.createElement('span');
    pathEl.className = 'duplicate-path';
    pathEl.textContent = file.path;
    pathEl.title = file.path;

    info.appendChild(nameRow);
    info.appendChild(details);
    info.appendChild(pathEl);

    // Star rating indicator
    const rating = getFileRating(file.path);
    if (rating > 0) {
        const ratingEl = document.createElement('div');
        ratingEl.className = 'duplicate-rating';
        for (let i = 0; i < rating; i++) {
            const star = document.createElement('span');
            star.innerHTML = iconFilled('star', 12, 'var(--warning)');
            ratingEl.appendChild(star);
        }
        info.appendChild(ratingEl);
    }

    const keepBtn = document.createElement('button');
    keepBtn.className = 'duplicate-keep-btn';
    keepBtn.textContent = 'Keep';
    keepBtn.addEventListener('click', () => keepFileInGroup(file.path, groupIdx));

    el.appendChild(checkbox);
    el.appendChild(thumb);
    el.appendChild(info);
    el.appendChild(keepBtn);

    // Hover preview — reuses the recent-file-preview pattern
    const ext = file.name.split('.').pop().toLowerCase();
    const videoExts = ['mp4', 'webm', 'ogg', 'mov'];
    const isVideo = videoExts.includes(ext);

    el.addEventListener('mouseenter', () => {
        const preview = document.createElement('div');
        preview.className = 'duplicate-hover-preview';

        if (isVideo) {
            const vid = document.createElement('video');
            vid.src = `file:///${file.path.replace(/\\/g, '/')}`;
            vid.muted = true;
            vid.loop = true;
            vid.play().catch(() => {});
            preview.appendChild(vid);
        } else {
            const img = document.createElement('img');
            img.src = `file:///${file.path.replace(/\\/g, '/')}`;
            preview.appendChild(img);
        }

        document.body.appendChild(preview);

        const itemRect = el.getBoundingClientRect();
        let top = itemRect.top;
        preview.style.top = `${top}px`;
        preview.style.visibility = 'hidden';
        preview.style.display = 'block';

        setTimeout(() => {
            const previewRect = preview.getBoundingClientRect();
            // Position to the right of the modal by default
            let left = itemRect.right + 10;
            if (left + previewRect.width > window.innerWidth) {
                left = itemRect.left - previewRect.width - 10;
            }
            if (left < 0) left = 10;
            if (top + previewRect.height > window.innerHeight) {
                top = window.innerHeight - previewRect.height - 10;
                preview.style.top = `${top}px`;
            }
            preview.style.left = `${left}px`;
            preview.style.visibility = 'visible';
        }, 10);

        el._previewId = 'dup-preview-' + Date.now();
        preview.id = el._previewId;
    });

    el.addEventListener('mouseleave', () => {
        if (el._previewId) {
            const p = document.getElementById(el._previewId);
            if (p) p.remove();
            el._previewId = null;
        }
    });

    return el;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function keepBestInGroup(groupIdx) {
    const group = duplicateGroups[groupIdx];
    if (!group) return;

    // Find the largest file
    let largest = group.files[0];
    for (const f of group.files) {
        if (f.size > largest.size) largest = f;
    }

    // Mark all others for deletion
    for (const f of group.files) {
        if (f.path === largest.path) {
            duplicateMarkedForDeletion.delete(f.path);
        } else {
            duplicateMarkedForDeletion.add(f.path);
        }
    }

    // Update UI
    const groupEl = document.querySelector(`.duplicate-group[data-group-id="${groupIdx}"]`);
    if (groupEl) {
        const items = groupEl.querySelectorAll('.duplicate-item');
        items.forEach(item => {
            const path = item.dataset.path;
            const cb = item.querySelector('.duplicate-select');
            if (duplicateMarkedForDeletion.has(path)) {
                cb.checked = true;
                item.classList.add('marked-for-deletion');
                item.classList.remove('kept');
            } else {
                cb.checked = false;
                item.classList.remove('marked-for-deletion');
                item.classList.add('kept');
            }
        });
    }
    updateDeleteButton();
}

function keepFileInGroup(filePath, groupIdx) {
    const group = duplicateGroups[groupIdx];
    if (!group) return;

    // Mark all others for deletion, keep this one
    for (const f of group.files) {
        if (f.path === filePath) {
            duplicateMarkedForDeletion.delete(f.path);
        } else {
            duplicateMarkedForDeletion.add(f.path);
        }
    }

    // Update UI
    const groupEl = document.querySelector(`.duplicate-group[data-group-id="${groupIdx}"]`);
    if (groupEl) {
        const items = groupEl.querySelectorAll('.duplicate-item');
        items.forEach(item => {
            const path = item.dataset.path;
            const cb = item.querySelector('.duplicate-select');
            if (duplicateMarkedForDeletion.has(path)) {
                cb.checked = true;
                item.classList.add('marked-for-deletion');
                item.classList.remove('kept');
            } else {
                cb.checked = false;
                item.classList.remove('marked-for-deletion');
                item.classList.add('kept');
            }
        });
    }
    updateDeleteButton();
}

function updateDeleteButton() {
    const deleteBtn = document.getElementById('duplicates-delete-btn');
    const count = duplicateMarkedForDeletion.size;
    deleteBtn.textContent = `Delete Selected (${count})`;
    deleteBtn.disabled = count === 0;
}

function highlightDuplicatesInGrid() {
    clearDuplicateHighlights();

    // Populate persistent map so virtual-scrolling card creation can apply highlights
    duplicateHighlightPaths.clear();
    duplicateGroups.forEach((group, idx) => {
        group.files.forEach(f => duplicateHighlightPaths.set(f.path, idx));
    });

    // Apply to currently rendered cards
    const cards = document.querySelectorAll('.video-card, .folder-card');
    cards.forEach(card => {
        applyDuplicateHighlight(card);
    });
}

function applyDuplicateHighlight(card) {
    const filePath = card.dataset.path;
    if (duplicateHighlightPaths.has(filePath)) {
        card.classList.add('duplicate-highlight');
        const badge = document.createElement('div');
        badge.className = 'duplicate-badge';
        badge.textContent = 'D' + (duplicateHighlightPaths.get(filePath) + 1);
        card.appendChild(badge);
    }
}

// ==================== COMPARISON LIGHTBOX ====================

let compareGroup = null;
let compareGroupIdx = -1;
let compareLeftIndex = 0;
let compareRightIndex = 1;
let compareShowAll = false;
let compareSliderPosition = 50;
let compareSliderRAF = null;

function initCompareSlider() {
    const container = document.getElementById('compare-slider-container');
    if (!container) return;

    container.addEventListener('mousemove', (e) => {
        if (!compareSliderRAF) {
            compareSliderRAF = requestAnimationFrame(() => {
                updateSliderFromEvent(e);
                compareSliderRAF = null;
            });
        }
    });
}

function updateSliderFromEvent(e) {
    const container = document.getElementById('compare-slider-container');
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    compareSliderPosition = pct;
    applySliderPosition(pct);
}

function applySliderPosition(pct) {
    const leftLayer = document.getElementById('compare-slider-layer-left');
    const handle = document.getElementById('compare-slider-handle');
    if (leftLayer) {
        leftLayer.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    }
    if (handle) {
        handle.style.left = pct + '%';
    }
}

function openComparisonLightbox(groupIdx) {
    const group = duplicateGroups[groupIdx];
    if (!group || group.files.length < 2) return;

    compareGroup = group.files;
    compareGroupIdx = groupIdx;
    compareLeftIndex = 0;
    compareRightIndex = Math.min(1, group.files.length - 1);
    compareShowAll = false;

    const lightbox = document.getElementById('duplicate-compare-lightbox');
    const title = document.getElementById('compare-lightbox-title');
    const closeBtn = document.getElementById('compare-lightbox-close');
    const showAllBtn = document.getElementById('compare-show-all-btn');

    title.textContent = `Compare \u2014 Group ${groupIdx + 1} (${group.files.length} files)`;
    lightbox.classList.remove('hidden');
    compareShowAll = true;
    showAllBtn.classList.add('active');
    showAllBtn.querySelector('span').textContent = 'Compare';

    // Start in show-all mode
    const body = lightbox.querySelector('.compare-lightbox-body');
    const grid = document.getElementById('compare-show-all-grid');
    body.classList.add('hidden');
    grid.classList.remove('hidden');
    renderShowAllGrid();

    // Event listeners
    closeBtn.onclick = closeComparisonLightbox;
    lightbox.addEventListener('keydown', handleCompareKeydown);
    lightbox.setAttribute('tabindex', '0');
    lightbox.focus();

    // Backdrop click to close
    lightbox.onclick = (e) => {
        if (e.target === lightbox) closeComparisonLightbox();
    };

    // Show-all toggle
    showAllBtn.onclick = (e) => {
        e.stopPropagation();
        toggleCompareShowAll();
    };

    // Nav buttons
    lightbox.querySelectorAll('.compare-nav-prev').forEach(btn => {
        btn.onclick = () => navigateComparePane(btn.dataset.side, -1);
    });
    lightbox.querySelectorAll('.compare-nav-next').forEach(btn => {
        btn.onclick = () => navigateComparePane(btn.dataset.side, 1);
    });
}

function closeComparisonLightbox() {
    const lightbox = document.getElementById('duplicate-compare-lightbox');
    lightbox.classList.add('hidden');
    lightbox.removeEventListener('keydown', handleCompareKeydown);
    lightbox.onclick = null;

    // Clean up slider media
    ['compare-slider-layer-left', 'compare-slider-layer-right'].forEach(id => {
        const layer = document.getElementById(id);
        if (layer) {
            layer.querySelectorAll('video').forEach(v => { v.pause(); v.src = ''; });
            layer.innerHTML = '';
        }
    });

    // Reset slider state
    compareSliderPosition = 50;
    if (compareSliderRAF) {
        cancelAnimationFrame(compareSliderRAF);
        compareSliderRAF = null;
    }
    applySliderPosition(50);

    // Clean up show-all grid
    const grid = document.getElementById('compare-show-all-grid');
    if (grid) {
        grid.querySelectorAll('video').forEach(v => { v.pause(); v.src = ''; });
        grid.innerHTML = '';
        grid.classList.add('hidden');
    }

    // Restore side-by-side body visibility
    const body = lightbox.querySelector('.compare-lightbox-body');
    if (body) body.classList.remove('hidden');

    compareGroup = null;
    compareGroupIdx = -1;
    compareShowAll = false;

    // Sync deletion state back to main modal UI
    syncDuplicateModalUI();
}

function handleCompareKeydown(e) {
    if (e.key === 'Escape') {
        closeComparisonLightbox();
        e.stopPropagation();
    } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        toggleCompareShowAll();
    } else if (e.shiftKey && e.key === 'ArrowLeft') {
        compareSliderPosition = Math.max(0, compareSliderPosition - 5);
        applySliderPosition(compareSliderPosition);
        e.preventDefault();
    } else if (e.shiftKey && e.key === 'ArrowRight') {
        compareSliderPosition = Math.min(100, compareSliderPosition + 5);
        applySliderPosition(compareSliderPosition);
        e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
        navigateComparePane('left', -1);
        e.preventDefault();
    } else if (e.key === 'ArrowRight') {
        navigateComparePane('right', 1);
        e.preventDefault();
    }
}

function toggleCompareShowAll() {
    const lightbox = document.getElementById('duplicate-compare-lightbox');
    if (!lightbox || lightbox.classList.contains('hidden')) return;

    compareShowAll = !compareShowAll;
    const showAllBtn = document.getElementById('compare-show-all-btn');
    showAllBtn.classList.toggle('active', compareShowAll);
    showAllBtn.querySelector('span').textContent = compareShowAll ? 'Compare' : 'Show All';
    const body = lightbox.querySelector('.compare-lightbox-body');
    const grid = document.getElementById('compare-show-all-grid');
    if (compareShowAll) {
        body.classList.add('hidden');
        grid.classList.remove('hidden');
        renderShowAllGrid();
    } else {
        body.classList.remove('hidden');
        grid.classList.add('hidden');
        renderComparisonView();
    }
}

function navigateComparePane(side, direction) {
    if (!compareGroup) return;
    const len = compareGroup.length;
    if (side === 'left') {
        compareLeftIndex = (compareLeftIndex + direction + len) % len;
    } else {
        compareRightIndex = (compareRightIndex + direction + len) % len;
    }
    renderComparisonView();
}

function renderComparisonView() {
    if (!compareGroup) return;

    renderSliderMedia('left', compareLeftIndex);
    renderSliderMedia('right', compareRightIndex);
    renderCompareInfo('left', compareLeftIndex);
    renderCompareInfo('right', compareRightIndex);

    document.getElementById('compare-left-indicator').textContent = `${compareLeftIndex + 1} / ${compareGroup.length}`;
    document.getElementById('compare-right-indicator').textContent = `${compareRightIndex + 1} / ${compareGroup.length}`;

    compareSliderPosition = 50;
    applySliderPosition(50);
}

function renderSliderMedia(side, fileIndex) {
    const file = compareGroup[fileIndex];
    if (!file) return;

    const layerId = side === 'left' ? 'compare-slider-layer-left' : 'compare-slider-layer-right';
    const layer = document.getElementById(layerId);
    if (!layer) return;

    // Clean up old media
    layer.querySelectorAll('video').forEach(v => { v.pause(); v.src = ''; });
    layer.innerHTML = '';

    // Render media
    const fileUrl = `file:///${file.path.replace(/\\/g, '/')}`;
    const ext = file.name.split('.').pop().toLowerCase();
    const videoExts = ['mp4', 'webm', 'ogg', 'mov'];

    if (videoExts.includes(ext)) {
        const vid = document.createElement('video');
        vid.src = fileUrl;
        vid.muted = true;
        vid.loop = true;
        vid.autoplay = true;
        vid.play().catch(() => {});
        layer.appendChild(vid);
    } else {
        const img = document.createElement('img');
        img.src = fileUrl;
        img.alt = file.name;
        layer.appendChild(img);
    }
}

function renderCompareInfo(side, fileIndex) {
    const file = compareGroup[fileIndex];
    if (!file) return;

    const infoContainer = document.getElementById(`compare-${side}-info`);
    const actionsContainer = document.getElementById(`compare-${side}-actions`);

    // Render file info
    const isMarked = duplicateMarkedForDeletion.has(file.path);
    const copyPattern = /[\s\-_]*\((\d+)\)\s*(?=\.[^.]+$)/;
    const isCopy = copyPattern.test(file.name);

    let infoHtml = `<div class="compare-file-name" title="${file.name}">${file.name}`;
    if (isCopy) {
        infoHtml += ` <span class="duplicate-copy-tag">Copy</span>`;
    }
    infoHtml += `</div>`;
    infoHtml += `<div class="compare-file-details">${formatFileSize(file.size)} &mdash; ${new Date(file.mtime).toLocaleDateString()}</div>`;

    // Rating
    const rating = typeof getFileRating === 'function' ? getFileRating(file.path) : 0;
    if (rating > 0) {
        infoHtml += `<div class="compare-file-rating">`;
        for (let i = 0; i < rating; i++) {
            infoHtml += `<span>${typeof iconFilled === 'function' ? iconFilled('star', 12, 'var(--warning)') : '\u2605'}</span>`;
        }
        infoHtml += `</div>`;
    }

    infoContainer.innerHTML = infoHtml;

    // Render actions
    actionsContainer.innerHTML = '';

    const keepBtn = document.createElement('button');
    keepBtn.className = 'compare-keep-btn' + (!isMarked ? ' active' : '');
    keepBtn.textContent = 'Keep';
    keepBtn.addEventListener('click', () => {
        keepFileInGroup(file.path, compareGroupIdx);
        renderComparisonView();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'compare-delete-btn' + (isMarked ? ' active' : '');
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
        if (isMarked) {
            duplicateMarkedForDeletion.delete(file.path);
        } else {
            duplicateMarkedForDeletion.add(file.path);
        }
        updateDeleteButton();
        renderComparisonView();
    });

    actionsContainer.appendChild(keepBtn);
    actionsContainer.appendChild(deleteBtn);
}

function updateShowAllGrid() {
    const grid = document.getElementById('compare-show-all-grid');
    if (!grid || !compareShowAll) return;
    renderShowAllGrid();
}

function renderShowAllGrid() {
    const grid = document.getElementById('compare-show-all-grid');
    if (!grid || !compareGroup) return;

    // Clean up old media
    grid.querySelectorAll('video').forEach(v => { v.pause(); v.src = ''; });
    grid.innerHTML = '';

    // Compute optimal grid dimensions to maximize preview size
    const n = compareGroup.length;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    grid.style.setProperty('--grid-cols', cols);
    grid.style.setProperty('--grid-rows', rows);

    const videoExts = ['mp4', 'webm', 'ogg', 'mov'];

    compareGroup.forEach((file, idx) => {
        const isMarked = duplicateMarkedForDeletion.has(file.path);
        const isKept = !isMarked && duplicateGroups[compareGroupIdx] &&
            duplicateGroups[compareGroupIdx].files.some(f => f.path !== file.path && duplicateMarkedForDeletion.has(f.path));

        const item = document.createElement('div');
        item.className = 'compare-grid-item' + (isMarked ? ' marked-for-deletion' : '') + (isKept ? ' kept' : '');

        // Media
        const mediaDiv = document.createElement('div');
        mediaDiv.className = 'compare-grid-item-media';
        const fileUrl = `file:///${file.path.replace(/\\/g, '/')}`;
        const ext = file.name.split('.').pop().toLowerCase();

        if (videoExts.includes(ext)) {
            const vid = document.createElement('video');
            vid.src = fileUrl;
            vid.muted = true;
            vid.loop = true;
            vid.autoplay = true;
            vid.play().catch(() => {});
            mediaDiv.appendChild(vid);
        } else {
            const img = document.createElement('img');
            img.src = fileUrl;
            img.alt = file.name;
            mediaDiv.appendChild(img);
        }
        item.appendChild(mediaDiv);

        // Hover overlay with info + actions
        const overlay = document.createElement('div');
        overlay.className = 'compare-grid-item-overlay';

        const footer = document.createElement('div');
        footer.className = 'compare-grid-item-footer';

        const copyPattern = /[\s\-_]*\((\d+)\)\s*(?=\.[^.]+$)/;
        let nameHtml = `<div class="compare-grid-item-name" title="${file.name}">${file.name}`;
        if (copyPattern.test(file.name)) {
            nameHtml += ` <span class="duplicate-copy-tag">Copy</span>`;
        }
        nameHtml += `</div>`;
        nameHtml += `<div class="compare-grid-item-details">${formatFileSize(file.size)} &mdash; ${new Date(file.mtime).toLocaleDateString()}</div>`;
        footer.innerHTML = nameHtml;
        overlay.appendChild(footer);

        const actions = document.createElement('div');
        actions.className = 'compare-grid-item-actions';

        const keepBtn = document.createElement('button');
        keepBtn.className = 'compare-keep-btn' + (isKept ? ' active' : '');
        keepBtn.textContent = 'Keep';
        keepBtn.addEventListener('click', () => {
            keepFileInGroup(file.path, compareGroupIdx);
            renderShowAllGrid();
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'compare-delete-btn' + (isMarked ? ' active' : '');
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => {
            if (isMarked) {
                duplicateMarkedForDeletion.delete(file.path);
            } else {
                duplicateMarkedForDeletion.add(file.path);
            }
            updateDeleteButton();
            renderShowAllGrid();
        });

        actions.appendChild(keepBtn);
        actions.appendChild(deleteBtn);
        overlay.appendChild(actions);
        item.appendChild(overlay);

        grid.appendChild(item);
    });
}

function syncDuplicateModalUI() {
    // Update all duplicate items in the main modal to reflect current deletion state
    const items = document.querySelectorAll('.duplicate-item');
    items.forEach(item => {
        const path = item.dataset.path;
        const cb = item.querySelector('.duplicate-select');
        if (duplicateMarkedForDeletion.has(path)) {
            if (cb) cb.checked = true;
            item.classList.add('marked-for-deletion');
            item.classList.remove('kept');
        } else {
            if (cb) cb.checked = false;
            item.classList.remove('marked-for-deletion');
        }
    });
    updateDeleteButton();
}

function clearDuplicateHighlights() {
    duplicateHighlightPaths.clear();
    document.querySelectorAll('.duplicate-highlight').forEach(card => {
        card.classList.remove('duplicate-highlight');
    });
    document.querySelectorAll('.duplicate-badge').forEach(badge => {
        badge.remove();
    });
}

// Restore last folder and layout mode on app startup
window.addEventListener('DOMContentLoaded', async () => {
    initCompareSlider();

    // Check ffmpeg availability for video thumbnail generation
    try {
        const ffStatus = await window.electronAPI.hasFfmpeg();
        hasFfmpegAvailable = ffStatus && ffStatus.ffmpeg;
    } catch { /* ffmpeg not available */ }

    // Restore remember folder preference
    const savedRememberFolder = localStorage.getItem('rememberLastFolder');
    if (savedRememberFolder !== null) {
        rememberLastFolder = savedRememberFolder === 'true';
        rememberFolderToggle.checked = rememberLastFolder;
        rememberFolderLabel.textContent = rememberLastFolder ? 'On' : 'Off';
    }
    
    // Restore include moving images preference
    const savedIncludeMovingImages = localStorage.getItem('includeMovingImages');
    if (savedIncludeMovingImages !== null) {
        includeMovingImages = savedIncludeMovingImages === 'true';
        includeMovingImagesToggle.checked = includeMovingImages;
        includeMovingImagesLabel.textContent = includeMovingImages ? 'On' : 'Off';
    }
    
    // Restore pause on lightbox preference
    const savedPauseOnLightbox = localStorage.getItem('pauseOnLightbox');
    if (savedPauseOnLightbox !== null) {
        pauseOnLightbox = savedPauseOnLightbox === 'true';
        pauseOnLightboxToggle.checked = pauseOnLightbox;
        pauseOnLightboxLabel.textContent = pauseOnLightbox ? 'On' : 'Off';
    }

    // Restore auto-repeat videos preference
    const savedAutoRepeat = localStorage.getItem('autoRepeatVideos');
    if (savedAutoRepeat !== null) {
        autoRepeatVideos = savedAutoRepeat === 'true';
        autoRepeatToggle.checked = autoRepeatVideos;
        autoRepeatLabel.textContent = autoRepeatVideos ? 'On' : 'Off';
        if (autoRepeatVideos) {
            videoLoop = true;
        }
    }

    // Restore pause on blur preference
    const savedPauseOnBlur = localStorage.getItem('pauseOnBlur');
    if (savedPauseOnBlur !== null) {
        pauseOnBlur = savedPauseOnBlur === 'true';
        pauseOnBlurToggle.checked = pauseOnBlur;
        pauseOnBlurLabel.textContent = pauseOnBlur ? 'On' : 'Off';
    }

    // Restore playback controls preference
    const savedPlaybackControls = localStorage.getItem('playbackControls');
    if (savedPlaybackControls !== null) {
        playbackControlsEnabled = savedPlaybackControls === 'true';
        playbackControlsToggle.checked = playbackControlsEnabled;
        playbackControlsLabel.textContent = playbackControlsEnabled ? 'On' : 'Off';
    }

    // Restore hover scrub preference
    const savedHoverScrub = localStorage.getItem('hoverScrub');
    if (savedHoverScrub !== null) {
        hoverScrubEnabled = savedHoverScrub === 'true';
        if (hoverScrubToggle) hoverScrubToggle.checked = hoverScrubEnabled;
        if (hoverScrubLabel) hoverScrubLabel.textContent = hoverScrubEnabled ? 'On' : 'Off';
    }

    // Restore zoom to fit preference
    const savedZoomToFit = localStorage.getItem('zoomToFit');
    if (savedZoomToFit !== null) {
        zoomToFit = savedZoomToFit === 'true';
        if (zoomToFitToggle) zoomToFitToggle.checked = zoomToFit;
        if (zoomToFitLabel) zoomToFitLabel.textContent = zoomToFit ? 'On' : 'Off';
        if (lightboxZoomToFitToggle) lightboxZoomToFitToggle.checked = zoomToFit;
    }

    // Restore layout mode preference
    const savedLayoutMode = localStorage.getItem('layoutMode');
    if (savedLayoutMode === 'grid' || savedLayoutMode === 'masonry') {
        layoutMode = savedLayoutMode;
        // Update toggle checkbox state
        layoutModeToggle.checked = layoutMode === 'grid';
        layoutModeLabel.textContent = layoutMode === 'grid' ? 'Rigid' : 'Dynamic';
    }

    // Restore card metadata visibility preferences
    if (typeof hydrateCardInfoSettings === 'function') {
        hydrateCardInfoSettings();
    }
    
    // Restore sorting preferences (will be overridden by tab's preferences in loadTabs)
    const savedSortType = localStorage.getItem('sortType');
    if (savedSortType === 'name' || savedSortType === 'date') {
        sortType = savedSortType;
    } else {
        sortType = 'name'; // Default
    }
    
    const savedSortOrder = localStorage.getItem('sortOrder');
    if (savedSortOrder === 'ascending' || savedSortOrder === 'descending') {
        sortOrder = savedSortOrder;
    } else {
        sortOrder = 'ascending'; // Default
    }
    
    // Restore group-by-date preference
    const savedGroupByDate = localStorage.getItem('groupByDate');
    if (savedGroupByDate === 'true') {
        groupByDate = true;
        const gbdBtn = document.getElementById('group-by-date-btn');
        const gbdGran = document.getElementById('date-group-granularity-select');
        const viewMenuBtn = document.getElementById('view-menu-btn');
        if (gbdBtn) gbdBtn.classList.add('active');
        if (viewMenuBtn) viewMenuBtn.classList.add('active');
        if (gbdGran) {
            gbdGran.classList.remove('date-group-granularity-hidden');
            gbdGran.classList.add('date-group-granularity-visible');
        }
        const savedGranularity = localStorage.getItem('dateGroupGranularity');
        if (savedGranularity && ['year', 'month', 'day'].includes(savedGranularity)) {
            dateGroupGranularity = savedGranularity;
            if (gbdGran) gbdGran.value = savedGranularity;
        }
    }

    // Note: UI will be updated by switchToTab when tabs are loaded
    
    // Only restore last folder if remembering is enabled
    if (rememberLastFolder) {
        const lastFolderPath = localStorage.getItem('lastFolderPath');
        if (lastFolderPath) {
            showLoadingIndicator();
            try {
                await navigateToFolder(lastFolderPath);
            } catch (error) {
                // Silently fail if the folder no longer exists (don't show alert on startup)
                console.log('Last folder no longer exists:', lastFolderPath);
                localStorage.removeItem('lastFolderPath');
            } finally {
                hideLoadingIndicator();
            }
        }
    }
    
    // Listen for window minimize/restore events to reduce resource usage
    window.electronAPI.onWindowMinimized(() => {
        pauseWhenMinimized();
    });
    
    window.electronAPI.onWindowRestored(() => {
        resumeWhenRestored();
    });
    
    // Also use Page Visibility API as a backup (handles tab switching, etc.)
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            pauseWhenMinimized();
        } else {
            resumeWhenRestored();
        }
    });
    
    // Pause thumbnails and freeze GIFs when window loses focus
    window.addEventListener('blur', () => {
        if (isWindowBlurred || isWindowMinimized) return;
        isWindowBlurred = true;
        if (!pauseOnBlur) return;
        // Pause all grid videos
        const allVideos = gridContainer.querySelectorAll('video');
        allVideos.forEach(video => {
            video.pause();
        });
        // Freeze animated GIFs by showing static overlay
        const allOverlays = gridContainer.querySelectorAll('.gif-static-overlay');
        allOverlays.forEach(overlay => overlay.classList.add('visible'));
    });

    // Resume thumbnails and unfreeze GIFs when window regains focus
    window.addEventListener('focus', () => {
        if (!isWindowBlurred || isWindowMinimized) return;
        isWindowBlurred = false;
        if (!pauseOnBlur) return;
        // Don't resume grid media if lightbox is open and that pause is active
        if (isLightboxOpen && pauseOnLightbox) return;
        // Resume all grid videos
        const allVideos = gridContainer.querySelectorAll('video');
        allVideos.forEach(video => {
            const playPromise = video.play();
            if (playPromise !== undefined) {
                playPromise.catch(() => {});
            }
        });
        // Restore animated GIFs by hiding static overlay
        const allOverlays = gridContainer.querySelectorAll('.gif-static-overlay');
        allOverlays.forEach(overlay => overlay.classList.remove('visible'));
    });

    // Initialize new features
    initKeyboardShortcuts();
    initTheme();
    initThumbnailQuality();
    initZoom();
    // SQLite migration: check if we need to migrate from localStorage/IndexedDB
    try {
        const migrationStatus = await window.electronAPI.dbCheckMigrationStatus();
        if (migrationStatus.success && !migrationStatus.data.migrationComplete) {
            console.log('[SQLite] Running one-time migration from localStorage/IndexedDB...');
            const migrationData = {};
            // Gather ratings from localStorage
            try {
                const savedRatings = localStorage.getItem('fileRatings');
                if (savedRatings) migrationData.fileRatings = JSON.parse(savedRatings);
            } catch {}
            // Gather pins from localStorage
            try {
                const savedPins = localStorage.getItem('pinnedFiles');
                if (savedPins) migrationData.pinnedFiles = JSON.parse(savedPins);
            } catch {}
            // Gather favorites from localStorage
            try {
                const savedFavs = localStorage.getItem('favorites');
                if (savedFavs) {
                    const parsed = JSON.parse(savedFavs);
                    if (Array.isArray(parsed)) {
                        migrationData.favorites = { version: 2, groups: [{ id: 'default', name: 'Favorites', collapsed: false, items: parsed }] };
                    } else if (parsed && parsed.version === 2) {
                        migrationData.favorites = parsed;
                    }
                }
            } catch {}
            // Gather recent files from localStorage
            try {
                const savedRecent = localStorage.getItem('recentFiles');
                if (savedRecent) migrationData.recentFiles = JSON.parse(savedRecent);
            } catch {}
            // Gather collections from IndexedDB
            try {
                if (typeof exportCollectionsData === 'function') {
                    migrationData.collections = await exportCollectionsData();
                }
            } catch {}
            // Run migration
            const migResult = await window.electronAPI.dbRunMigration(migrationData);
            if (migResult.success) {
                console.log('[SQLite] Migration complete.');
            } else {
                console.error('[SQLite] Migration failed:', migResult.error);
            }
        }
    } catch (e) {
        console.error('[SQLite] Migration check failed:', e);
    }

    await Promise.all([loadFavorites(), loadRecentFiles(), loadRatings(), loadPins()]);
    await initSidebar(); // Must be before loadTabs so sidebar is ready for highlight/expand
    loadTabs(); // This will handle tab restoration and navigation
    initVideoScrubber();
    initNewFeatures();
    initDuplicateDetection();
    
    // If no tab has a path and we have a last folder, navigate to it
    const activeTab = tabs.find(t => t.id === activeTabId);

    // Expand sidebar to match whichever folder is now active after tab restore
    if (currentFolderPath) {
        sidebarExpandToPath(currentFolderPath);
    }

    if ((!activeTab || !activeTab.path) && rememberLastFolder) {
        const lastFolderPath = localStorage.getItem('lastFolderPath');
        if (lastFolderPath) {
            try {
                const skipStats = sortType === 'name';
                const items = await window.electronAPI.scanFolder(lastFolderPath, { skipStats });
                if (activeTab) {
                    activeTab.path = lastFolderPath;
                    activeTab.name = lastFolderPath.split(/[/\\]/).pop();
                    saveTabs();
                    renderTabs();
                }
                await navigateToFolder(lastFolderPath);
                // Expand sidebar tree to match restored folder
                sidebarExpandToPath(lastFolderPath);
            } catch (error) {
                console.log('Last folder no longer exists:', lastFolderPath);
                localStorage.removeItem('lastFolderPath');
            }
        }
    }

    // Initialize status bar with current state
    updateStatusBar();
});
