// ==================== KEYBOARD SHORTCUTS ====================
function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Don't trigger shortcuts when typing in inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
            // Allow Escape to close dialogs even when in inputs
            if (e.key === 'Escape') {
                if (!renameDialog.classList.contains('hidden')) {
                    handleRenameCancel();
                } else if (!lightbox.classList.contains('hidden')) {
                    closeLightbox();
                } else if (!settingsDropdown.classList.contains('hidden')) {
                    closeSettingsDropdown();
                } else if (!favoritesDropdown.classList.contains('hidden')) {
                    favoritesDropdown.classList.add('hidden');
                } else if (!recentFilesDropdown.classList.contains('hidden')) {
                    recentFilesDropdown.classList.add('hidden');
                }
            }
            return;
        }

        // Ctrl/Cmd + F: Focus search
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            searchBox.focus();
            searchBox.select();
            return;
        }

        // Ctrl/Cmd + O: Open folder
        if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
            e.preventDefault();
            selectFolderBtn.click();
            return;
        }

        // Escape: Close dialogs/lightbox/shortcuts
        if (e.key === 'Escape') {
            if (!shortcutsOverlay.classList.contains('hidden')) {
                shortcutsOverlay.classList.add('hidden');
            } else if (!lightbox.classList.contains('hidden')) {
                closeLightbox();
            } else if (!renameDialog.classList.contains('hidden')) {
                handleRenameCancel();
            } else if (!settingsDropdown.classList.contains('hidden')) {
                closeSettingsDropdown();
            } else if (!favoritesDropdown.classList.contains('hidden')) {
                favoritesDropdown.classList.add('hidden');
            } else if (!recentFilesDropdown.classList.contains('hidden')) {
                recentFilesDropdown.classList.add('hidden');
            }
            return;
        }

        // Arrow keys: Navigate thumbnails
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            navigateCards(e.key);
            return;
        }

        // Enter: Open focused card
        if (e.key === 'Enter' && focusedCardIndex >= 0) {
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
                    const path = card.dataset.filePath;
                    const name = card.querySelector('.video-info')?.textContent || '';
                    if (url) openLightbox(url, path, name);
                }
            }
            return;
        }

        // Delete: Delete focused file
        if (e.key === 'Delete' && focusedCardIndex >= 0) {
            e.preventDefault();
            const card = visibleCards[focusedCardIndex];
            if (card && !card.classList.contains('folder-card')) {
                const path = card.dataset.filePath;
                const name = card.querySelector('.video-info')?.textContent || '';
                if (path && confirm(`Are you sure you want to delete "${name}"?`)) {
                    setStatusActivity(`Deleting ${name}...`);
                    window.electronAPI.deleteFile(path).then(result => {
                        setStatusActivity('');
                        if (result.success && currentFolderPath) {
                            loadVideos(currentFolderPath);
                        }
                    }).catch(err => {
                        setStatusActivity('');
                        console.error('Error deleting file:', err);
                    });
                }
            }
            return;
        }

        // F2: Rename focused file
        if (e.key === 'F2' && focusedCardIndex >= 0) {
            e.preventDefault();
            const card = visibleCards[focusedCardIndex];
            if (card && !card.classList.contains('folder-card')) {
                const path = card.dataset.filePath;
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

        // Backspace: Go back (when not in input)
        if (e.key === 'Backspace' && !e.target.tagName === 'INPUT') {
            if (navigationHistory.canGoBack()) {
                e.preventDefault();
                goBack();
            }
            return;
        }

        // Ctrl/Cmd + B: Go back
        if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
            e.preventDefault();
            if (navigationHistory.canGoBack()) {
                goBack();
            }
            return;
        }

        // Ctrl/Cmd + Shift + B: Go forward
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'B') {
            e.preventDefault();
            if (navigationHistory.canGoForward()) {
                goForward();
            }
            return;
        }

        // Number keys: Switch filters
        if (e.key >= '1' && e.key <= '4') {
            const filterMap = { '1': 'all', '2': 'video', '3': 'image', '4': 'audio' };
            const filter = filterMap[e.key];
            if (filter) {
                e.preventDefault();
                switchFilter(filter);
            }
            return;
        }

        // ?: Toggle keyboard shortcuts cheat sheet
        if (e.key === '?' || (e.shiftKey && e.key === '/')) {
            e.preventDefault();
            toggleShortcutsOverlay();
            return;
        }

        // G: Toggle grid/masonry layout
        if (e.key === 'g' || e.key === 'G') {
            e.preventDefault();
            layoutModeToggle.checked = !layoutModeToggle.checked;
            switchLayoutMode();
            return;
        }

        // S: Toggle sidebar
        if (e.key === 's' || e.key === 'S') {
            e.preventDefault();
            setSidebarCollapsed(!sidebarCollapsed);
            return;
        }

        // Space: Open lightbox for focused card
        if (e.key === ' ' && focusedCardIndex >= 0) {
            e.preventDefault();
            const card = visibleCards[focusedCardIndex];
            if (card && !card.classList.contains('folder-card')) {
                const url = card.dataset.src;
                const filePath = card.dataset.filePath;
                const name = card.querySelector('.video-info')?.textContent || '';
                if (url) openLightbox(url, filePath, name);
            }
            return;
        }

        // + / =: Zoom in
        if (e.key === '+' || e.key === '=') {
            e.preventDefault();
            const newZoom = Math.min(200, zoomLevel + 10);
            zoomSlider.value = newZoom;
            zoomLevel = newZoom;
            applyZoom();
            deferLocalStorageWrite('zoomLevel', zoomLevel.toString());
            updateStatusBar();
            return;
        }

        // -: Zoom out
        if (e.key === '-') {
            e.preventDefault();
            const newZoom = Math.max(50, zoomLevel - 10);
            zoomSlider.value = newZoom;
            zoomLevel = newZoom;
            applyZoom();
            deferLocalStorageWrite('zoomLevel', zoomLevel.toString());
            updateStatusBar();
            return;
        }

        // 0: Reset zoom
        if (e.key === '0' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            zoomSlider.value = 100;
            zoomLevel = 100;
            applyZoom();
            deferLocalStorageWrite('zoomLevel', '100');
            updateStatusBar();
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
    filterAudioBtn.classList.remove('active');
    
    if (filter === 'all') filterAllBtn.classList.add('active');
    else if (filter === 'video') filterVideosBtn.classList.add('active');
    else if (filter === 'image') filterImagesBtn.classList.add('active');
    else if (filter === 'audio') filterAudioBtn.classList.add('active');
    
    applyFilters();
    focusedCardIndex = -1; // Reset focus
}

// ==================== FAVORITES ====================
function loadFavorites() {
    const saved = localStorage.getItem('favorites');
    if (saved) {
        try {
            favorites = JSON.parse(saved);
        } catch (e) {
            favorites = [];
        }
    }
    renderFavorites();
}

function saveFavorites() {
    deferLocalStorageWrite('favorites', JSON.stringify(favorites));
}

function renderFavorites() {
    favoritesList.innerHTML = '';
    if (favorites.length === 0) {
        favoritesList.innerHTML = '<div style="padding: 16px; text-align: center; color: rgba(224, 224, 224, 0.5); font-size: 12px;">No favorites yet</div>';
        return;
    }
    favorites.forEach((fav, index) => {
        const item = document.createElement('div');
        item.className = 'quick-access-item';
        item.innerHTML = `
            <span class="quick-access-item-name" title="${fav.path}">${fav.name}</span>
            <span class="quick-access-item-remove" data-index="${index}">${icon('x', 14)}</span>
        `;
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('quick-access-item-remove')) {
                e.stopPropagation();
                removeFavorite(index);
            } else {
                favoritesDropdown.classList.add('hidden');
                // Use setTimeout to yield control back to event loop, making button responsive
                setTimeout(() => {
                    navigateToFolder(fav.path).catch(err => {
                        console.error('Error navigating to favorite:', err);
                        hideLoadingIndicator();
                    });
                }, 0);
            }
        });
        favoritesList.appendChild(item);
    });
}

function addFavorite(path, name) {
    if (!path || favorites.some(f => f.path === path)) return;
    favorites.push({ path, name: name || path.split(/[/\\]/).pop() });
    saveFavorites();
    renderFavorites();
}

function removeFavorite(index) {
    favorites.splice(index, 1);
    saveFavorites();
    renderFavorites();
}

// ==================== RECENT FILES ====================
function loadRecentFiles() {
    const saved = localStorage.getItem('recentFiles');
    if (saved) {
        try {
            recentFiles = JSON.parse(saved);
            // Keep only last 50
            recentFiles = recentFiles.slice(0, 50);
        } catch (e) {
            recentFiles = [];
        }
    }
    renderRecentFiles();
}

function saveRecentFiles() {
    deferLocalStorageWrite('recentFiles', JSON.stringify(recentFiles));
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
    recentFiles = recentFiles.slice(0, 50);
    saveRecentFiles();
    renderRecentFiles();
}

function renderRecentFiles() {
    recentFilesList.innerHTML = '';
    if (recentFiles.length === 0) {
        recentFilesList.innerHTML = '<div style="padding: 16px; text-align: center; color: rgba(224, 224, 224, 0.5); font-size: 12px;">No recent files</div>';
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
                
                // Position preview
                const itemRect = item.getBoundingClientRect();
                let left = itemRect.right + 10;
                let top = itemRect.top;
                
                preview.style.top = `${top}px`;
                preview.style.left = `${left}px`;
                preview.style.display = 'block';
                
                // Adjust if preview goes off screen (after it renders)
                setTimeout(() => {
                    const previewRect = preview.getBoundingClientRect();
                    if (left + previewRect.width > window.innerWidth) {
                        left = itemRect.left - previewRect.width - 10;
                        preview.style.left = `${left}px`;
                    }
                    if (top + previewRect.height > window.innerHeight) {
                        top = window.innerHeight - previewRect.height - 10;
                        preview.style.top = `${top}px`;
                    }
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
            recentFilesDropdown.classList.add('hidden');
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
    saveRecentFiles();
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
    if (!activeTabId || gridContainer.children.length === 0) return;
    const fragment = document.createDocumentFragment();
    // Move children to fragment (detaches from DOM without destroying)
    while (gridContainer.firstChild) {
        fragment.appendChild(gridContainer.firstChild);
    }
    tabDomCache.set(activeTabId, {
        fragment,
        scrollTop: gridContainer.scrollTop || window.scrollY || 0,
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

function createTab(path, name) {
    const tab = {
        id: tabIdCounter++,
        path: path || null,
        name: name || (path ? path.split(/[/\\]/).pop() : 'Home'),
        sortType: sortType || 'name', // Use current sorting or default
        sortOrder: sortOrder || 'ascending', // Use current order or default
        historyPaths: [],
        historyIndex: -1
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
    tabContentCache.delete(tabId);
    tabs = tabs.filter(t => t.id !== tabId);
    if (activeTabId === tabId) {
        activeTabId = tabs[0]?.id || null;
    }
    // switchToTab already calls saveTabs() + renderTabs(), so skip them here
    if (activeTabId) {
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

        if (tab.path) {
            // Try to restore DOM snapshot first (near-instant tab switch)
            if (restoreTabDomSnapshot(tabId)) {
                currentFolderPath = tab.path;
                const tabCache = tabContentCache.get(tabId);
                if (tabCache) currentItems = tabCache.items;
                updateBreadcrumb(tab.path);
                searchBox.value = '';
                currentFilter = 'all';
                filterAllBtn.classList.add('active');
                filterVideosBtn.classList.remove('active');
                filterImagesBtn.classList.remove('active');
                filterAudioBtn.classList.remove('active');
                sidebarExpandToPath(tab.path);
            } else {
                // No DOM snapshot - fall back to content cache or full navigation
                const tabCache = tabContentCache.get(tabId);
                const now = Date.now();
                const normalizedTabPath = normalizePath(tab.path);

                if (tabCache) {
                    const cachePathNormalized = normalizePath(tabCache.path);
                    if ((cachePathNormalized === normalizedTabPath || tabCache.path === tab.path) &&
                        (now - tabCache.timestamp) < FOLDER_CACHE_TTL) {
                        // Use cached content
                        currentFolderPath = tab.path;
                        currentItems = tabCache.items;
                        updateBreadcrumb(tab.path);
                        searchBox.value = '';
                        currentFilter = 'all';
                        filterAllBtn.classList.add('active');
                        filterVideosBtn.classList.remove('active');
                        filterImagesBtn.classList.remove('active');
                        filterAudioBtn.classList.remove('active');

                        const filteredItems = filterItems(tabCache.items);
                        const sortedItems = sortItems(filteredItems);
                        renderItems(sortedItems);
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
            }
        } else {
            // If tab has no path, clear the grid
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
    if (!activeTabId) return;
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) {
        tab.path = path;
        tab.name = name || (path ? path.split(/[/\\]/).pop() : 'Home');
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
    
    // Get or create the time label element
    let timeLabel = card.querySelector('.video-time-label');
    if (!timeLabel) {
        timeLabel = document.createElement('div');
        timeLabel.className = 'video-time-label';
        card.appendChild(timeLabel);
    }
    
    // Update the label with current time vs total duration
    const updateTimeDisplay = () => {
        if (!timeLabel || !card.contains(timeLabel)) return;
        
        const currentTime = video.currentTime || 0;
        const duration = (video.duration && !isNaN(video.duration) && video.duration > 0) ? video.duration : 0;
        const currentTimeFormatted = formatTime(currentTime);
        const durationFormatted = duration > 0 ? formatTime(duration) : '--:--';
        timeLabel.textContent = `${currentTimeFormatted} / ${durationFormatted}`;
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
    
    // Show the label
    timeLabel.classList.add('show');
}

function hideScrubber(card) {
    if (!card) return;
    
    const timeLabel = card.querySelector('.video-time-label');
    if (timeLabel) {
        timeLabel.classList.remove('show');
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
}

function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
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
    const scale = zoomLevel / 100;
    // Update CSS variable for zoom
    document.documentElement.style.setProperty('--zoom-level', zoomLevel);
    
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
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light' || savedTheme === 'dark') {
        currentTheme = savedTheme;
        themeSelect.value = currentTheme;
    }
    applyTheme();
}

function applyTheme() {
    invalidateMasonryStyleCache();
    if (currentTheme === 'light') {
        document.documentElement.classList.add('light-theme');
    } else {
        document.documentElement.classList.remove('light-theme');
    }
    deferLocalStorageWrite('theme', currentTheme);
}

// ==================== THUMBNAIL QUALITY ====================
function initThumbnailQuality() {
    const savedQuality = localStorage.getItem('thumbnailQuality');
    if (savedQuality && ['low', 'medium', 'high'].includes(savedQuality)) {
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
            clipTextNodes.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
            
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
                ${info.comfyUIWorkflow ? (() => {
                    let workflow = info.comfyUIWorkflow.workflow;
                    if (!workflow && info.comfyUIWorkflow.raw) {
                        try {
                            workflow = typeof info.comfyUIWorkflow.raw === 'string' 
                                ? JSON.parse(info.comfyUIWorkflow.raw) 
                                : info.comfyUIWorkflow.raw;
                        } catch (e) {
                            console.warn('Failed to parse workflow raw data:', e);
                            workflow = null;
                        }
                    }
                    const params = workflow ? extractComfyUIParameters(workflow) : null;
                    return `
                <div class="file-info-detail-row file-info-comfyui-section">
                    <div class="file-info-comfyui-header">
                        <span class="file-info-detail-label">ComfyUI Workflow:</span>
                        <button class="file-info-toggle-btn" data-toggle-workflow>▼</button>
                    </div>
                    <div class="file-info-comfyui-content">
                        ${params && (params.prompt || params.cfgScale !== null || params.steps !== null || params.seed !== null) ? `
                        <div class="file-info-comfyui-params">
                            <div class="file-info-comfyui-params-header">Generation Parameters</div>
                            ${params.prompt ? `
                            <div class="file-info-detail-row file-info-prompt-row">
                                <span class="file-info-detail-label">Prompt:</span>
                                <div class="file-info-prompt-value">${escapeHtml(params.prompt)}</div>
                            </div>
                            ` : ''}
                            ${params.negativePrompt ? `
                            <div class="file-info-detail-row file-info-prompt-row">
                                <span class="file-info-detail-label">Negative Prompt:</span>
                                <div class="file-info-prompt-value">${escapeHtml(params.negativePrompt)}</div>
                            </div>
                            ` : ''}
                            <div class="file-info-comfyui-params-grid">
                                ${params.cfgScale !== null ? `
                                <div class="file-info-detail-row">
                                    <span class="file-info-detail-label">CFG Scale:</span>
                                    <span class="file-info-detail-value">${params.cfgScale}</span>
                                </div>
                                ` : ''}
                                ${params.steps !== null ? `
                                <div class="file-info-detail-row">
                                    <span class="file-info-detail-label">Steps:</span>
                                    <span class="file-info-detail-value">${params.steps}</span>
                                </div>
                                ` : ''}
                                ${params.sampler ? `
                                <div class="file-info-detail-row">
                                    <span class="file-info-detail-label">Sampler:</span>
                                    <span class="file-info-detail-value">${escapeHtml(params.sampler)}</span>
                                </div>
                                ` : ''}
                                ${params.seed !== null ? `
                                <div class="file-info-detail-row">
                                    <span class="file-info-detail-label">Seed:</span>
                                    <span class="file-info-detail-value">${params.seed}</span>
                                </div>
                                ` : ''}
                                ${params.model ? `
                                <div class="file-info-detail-row">
                                    <span class="file-info-detail-label">Model:</span>
                                    <span class="file-info-detail-value">${escapeHtml(params.model)}</span>
                                </div>
                                ` : ''}
                                ${params.width && params.height ? `
                                <div class="file-info-detail-row">
                                    <span class="file-info-detail-label">Resolution:</span>
                                    <span class="file-info-detail-value">${params.width} x ${params.height}</span>
                                </div>
                                ` : ''}
                            </div>
                        </div>
                        ` : ''}
                        <div class="file-info-detail-row">
                            <span class="file-info-detail-label">Metadata Key:</span>
                            <span class="file-info-detail-value">${escapeHtml(info.comfyUIWorkflow.key)}</span>
                        </div>
                        ${info.comfyUIWorkflow.workflow ? `
                        <div class="file-info-detail-row">
                            <span class="file-info-detail-label">Workflow Data:</span>
                            <div class="file-info-workflow-json">
                                <pre class="file-info-json-pre">${escapeHtml(JSON.stringify(info.comfyUIWorkflow.workflow, null, 2))}</pre>
                                <button class="file-info-copy-json-btn" data-copy-workflow-json>Copy JSON</button>
                            </div>
                        </div>
                        ` : `
                        <div class="file-info-detail-row">
                            <span class="file-info-detail-label">Raw Data:</span>
                            <div class="file-info-workflow-json">
                                <pre class="file-info-json-pre">${escapeHtml(info.comfyUIWorkflow.raw.substring(0, 500))}${info.comfyUIWorkflow.raw.length > 500 ? '...' : ''}</pre>
                                <button class="file-info-copy-json-btn" data-copy-workflow-raw>Copy Raw</button>
                            </div>
                        </div>
                        `}
                    </div>
                </div>
                `;
                })() : ''}
            `;
            
            // Set up event listeners for ComfyUI workflow buttons (inside the success block where info is in scope)
            const toggleBtn = details.querySelector('[data-toggle-workflow]');
            if (toggleBtn) {
                toggleBtn.addEventListener('click', function() {
                    const content = this.parentElement.nextElementSibling;
                    content.classList.toggle('hidden');
                    this.textContent = this.textContent === '▼' ? '▶' : '▼';
                });
            }

            const copyJsonBtn = details.querySelector('[data-copy-workflow-json]');
            if (copyJsonBtn && info.comfyUIWorkflow && info.comfyUIWorkflow.workflow) {
                const workflowJson = JSON.stringify(info.comfyUIWorkflow.workflow, null, 2);
                copyJsonBtn.addEventListener('click', function() {
                    navigator.clipboard.writeText(workflowJson).then(() => {
                        const originalText = this.textContent;
                        this.textContent = 'Copied!';
                        setTimeout(() => {
                            this.textContent = originalText;
                        }, 2000);
                    });
                });
            }

            const copyRawBtn = details.querySelector('[data-copy-workflow-raw]');
            if (copyRawBtn && info.comfyUIWorkflow && info.comfyUIWorkflow.raw) {
                const rawData = info.comfyUIWorkflow.raw;
                copyRawBtn.addEventListener('click', function() {
                    navigator.clipboard.writeText(rawData).then(() => {
                        const originalText = this.textContent;
                        this.textContent = 'Copied!';
                        setTimeout(() => {
                            this.textContent = originalText;
                        }, 2000);
                    });
                });
            }
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
    saveRatings();
    
    // Update all cards with the same path immediately - use updateCardRating which calls updateCardStars
    updateCardRating(filePath, rating);
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

    // Clear and rebuild stars
    starContainer.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
        const star = document.createElement('span');
        star.className = `star ${i <= rating ? 'active' : ''}`;
        star.innerHTML = i <= rating ? iconFilled('star', 16, 'var(--warning)') : icon('star', 16);
        star.style.pointerEvents = 'auto';
        star.style.cursor = 'pointer';
        star.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            setFileRating(filePath, i);
        });
        starContainer.appendChild(star);
    }
}

function saveRatings() {
    deferLocalStorageWrite('fileRatings', JSON.stringify(fileRatings));
}

function loadRatings() {
    try {
        const saved = localStorage.getItem('fileRatings');
        if (saved) {
            fileRatings = JSON.parse(saved);
        }
    } catch (error) {
        console.error('Error loading ratings:', error);
        fileRatings = {};
    }
}

function updateCardRating(filePath, rating) {
    // Normalize path for matching
    const normalizedPath = filePath.replace(/\\/g, '/');
    
    // Find all cards - try multiple selectors and path formats
    const allCards = gridContainer.querySelectorAll('.video-card:not(.folder-card)');
    allCards.forEach(card => {
        const cardPath = card.dataset.path || card.dataset.filePath;
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
    
    applyFilters();
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
    
    applyFilters();
}

// File organization
async function createFolder(folderName) {
    if (!currentFolderPath || !folderName) return;
    try {
        const result = await window.electronAPI.createFolder(currentFolderPath, folderName);
        if (result.success) {
            await navigateToFolder(currentFolderPath); // Refresh
        } else {
            alert('Error creating folder: ' + result.error);
        }
    } catch (error) {
        alert('Error creating folder: ' + error.message);
    }
}

async function moveFilesToFolder(filePaths, destFolder) {
    if (!filePaths || filePaths.length === 0) return;
    
    showProgress(0, filePaths.length, 'Moving files...');
    let success = 0;
    let failed = 0;
    
    for (let i = 0; i < filePaths.length; i++) {
        if (currentProgress && currentProgress.cancelled) break;
        
        const filePath = filePaths[i];
        const fileName = filePath.replace(/^.*[\\/]/, '');

        try {
            const result = await window.electronAPI.moveFile(filePath, destFolder, fileName);
            if (result.success) {
                success++;
            } else {
                failed++;
            }
        } catch (error) {
            failed++;
        }
        
        updateProgress(i + 1, filePaths.length);
    }
    
    hideProgress();
    if (success > 0) {
        await navigateToFolder(currentFolderPath); // Refresh
    }
    if (failed > 0) {
        alert(`Failed to move ${failed} file(s)`);
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
            // Get file stats via IPC
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
    
    // Create folders and move files
    for (const [folderName, filePaths] of Object.entries(dateFolders)) {
        const separator = currentFolderPath.includes('\\') ? '\\' : '/';
        const folderPath = currentFolderPath + (currentFolderPath.endsWith('\\') || currentFolderPath.endsWith('/') ? '' : separator) + folderName;
        await window.electronAPI.createFolder(currentFolderPath, folderName);
        await moveFilesToFolder(filePaths, folderPath);
    }
    
    hideProgress();
    await navigateToFolder(currentFolderPath);
}

async function organizeByType() {
    if (!currentFolderPath) return;
    
    const items = currentItems.filter(item => item.type !== 'folder');
    if (items.length === 0) return;
    
    showProgress(0, items.length, 'Organizing by type...');
    
    const typeFolders = {};
    
    for (let i = 0; i < items.length; i++) {
        if (currentProgress && currentProgress.cancelled) break;
        
        const item = items[i];
        const ext = item.name.substring(item.name.lastIndexOf('.') + 1).toLowerCase();
        const folderName = ext.toUpperCase() || 'Other';
        
        if (!typeFolders[folderName]) {
            typeFolders[folderName] = [];
        }
        typeFolders[folderName].push(item.path);
        
        updateProgress(i + 1, items.length);
    }
    
    // Create folders and move files
    for (const [folderName, filePaths] of Object.entries(typeFolders)) {
        const folderPath = currentFolderPath + (currentFolderPath.endsWith('\\') || currentFolderPath.endsWith('/') ? '' : '\\') + folderName;
        await window.electronAPI.createFolder(currentFolderPath, folderName);
        await moveFilesToFolder(filePaths, folderPath);
    }
    
    hideProgress();
    await navigateToFolder(currentFolderPath);
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
    
    // Video menu
    const videoMenuBtn = document.getElementById('lightbox-video-menu-btn');
    const videoMenu = document.getElementById('lightbox-video-menu');
    if (videoMenuBtn && videoMenu) {
        videoMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            videoMenu.classList.toggle('hidden');
        });
        
        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!videoMenuBtn.contains(e.target) && !videoMenu.contains(e.target)) {
                videoMenu.classList.add('hidden');
            }
        });
    }
    
    const speedBtn = document.getElementById('lightbox-speed-btn');
    if (speedBtn) {
        speedBtn.addEventListener('click', () => {
            const speeds = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
            const currentIndex = speeds.indexOf(videoPlaybackSpeed);
            const nextIndex = (currentIndex + 1) % speeds.length;
            setVideoPlaybackSpeed(speeds[nextIndex]);
        });
    }
    
    const loopBtn = document.getElementById('lightbox-loop-btn');
    const repeatBtn = document.getElementById('lightbox-repeat-btn');
    if (loopBtn) loopBtn.addEventListener('click', toggleVideoLoop);
    if (repeatBtn) repeatBtn.addEventListener('click', toggleVideoRepeat);
    
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
                        details.innerHTML = `<div class="file-info-detail-row">Error: ${error.message}</div>`;
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
    
    // Prevent clicks inside panel from closing it
    if (fileInfoPanel) {
        fileInfoPanel.addEventListener('click', (e) => {
            e.stopPropagation();
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
    const closeAdvancedSearchBtn = document.getElementById('close-advanced-search');
    
    if (advancedSearchBtn) {
        advancedSearchBtn.addEventListener('click', () => {
            if (advancedSearchPanel) advancedSearchPanel.classList.toggle('hidden');
        });
    }
    
    if (applyAdvancedSearchBtn) {
        applyAdvancedSearchBtn.addEventListener('click', applyAdvancedSearch);
    }
    
    if (clearAdvancedSearchBtn) {
        clearAdvancedSearchBtn.addEventListener('click', clearAdvancedSearch);
    }
    
    if (closeAdvancedSearchBtn) {
        closeAdvancedSearchBtn.addEventListener('click', () => {
            if (advancedSearchPanel) advancedSearchPanel.classList.add('hidden');
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
    
    // Star rating filter - filter to show only rated files
    const filterStarsBtn = document.getElementById('filter-stars');
    if (filterStarsBtn) {
        filterStarsBtn.addEventListener('click', () => {
            if (currentFilter === 'stars') {
                // Toggle off - go back to 'all'
                currentFilter = 'all';
                filterStarsBtn.classList.remove('active');
                filterAllBtn.classList.add('active');
            } else {
                // Toggle on - filter to stars
                currentFilter = 'stars';
                filterStarsBtn.classList.add('active');
                filterAllBtn.classList.remove('active');
                filterVideosBtn.classList.remove('active');
                filterImagesBtn.classList.remove('active');
                filterAudioBtn.classList.remove('active');
            }
            // Re-render with filtered items (like video/image filters)
            if (currentFolderPath && currentItems.length > 0) {
                const filteredItems = filterItems(currentItems);
                const sortedItems = sortItems(filteredItems);
                renderItems(sortedItems);
            } else {
                scheduleApplyFilters();
            }
        });
    }
    
    // File watching
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
    
    // Update keyboard shortcuts to include arrow keys and frame controls for lightbox
    document.addEventListener('keydown', (e) => {
        if (!lightbox.classList.contains('hidden')) {
            // Don't trigger if typing in an input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
                return;
            }
            
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                navigateLightbox('prev');
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                navigateLightbox('next');
            } else if (e.key === ',' || e.key === '<') {
                // Previous frame (comma key)
                e.preventDefault();
                if (lightboxVideo && lightboxVideo.style.display !== 'none') {
                    stepVideoFrame('prev');
                }
            } else if (e.key === '.' || e.key === '>') {
                // Next frame (period key)
                e.preventDefault();
                if (lightboxVideo && lightboxVideo.style.display !== 'none') {
                    stepVideoFrame('next');
                }
            }
        }
    });
}

// openLightbox already updated above to track current index

// Hook into navigateToFolder to start watching (will be called after navigation completes)
// This is handled in the navigateToFolder function itself

// Restore last folder and layout mode on app startup
window.addEventListener('DOMContentLoaded', async () => {
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

    // Restore layout mode preference
    const savedLayoutMode = localStorage.getItem('layoutMode');
    if (savedLayoutMode === 'grid' || savedLayoutMode === 'masonry') {
        layoutMode = savedLayoutMode;
        // Update toggle checkbox state
        layoutModeToggle.checked = layoutMode === 'grid';
        layoutModeLabel.textContent = layoutMode === 'grid' ? 'Rigid' : 'Dynamic';
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
    loadFavorites();
    loadRecentFiles();
    loadRatings();
    await initSidebar(); // Must be before loadTabs so sidebar is ready for highlight/expand
    loadTabs(); // This will handle tab restoration and navigation
    initVideoScrubber();
    initNewFeatures();
    
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
