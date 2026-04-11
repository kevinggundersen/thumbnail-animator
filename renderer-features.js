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
                if (result.ok) {
                    showToast(`Redo: ${result.value && result.value.description}`, 'success');
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

        // Undo: metadata ops (ratings/pins/tags) first, then file operations
        if (matchesShortcut(e, 'undo')) {
            e.preventDefault();
            (async () => {
                if (metadataUndoStack.length > 0) {
                    const label = await undoLastMetadataOp();
                    if (label) showToast(`Undo: ${label}`, 'success');
                    return;
                }
                try {
                    const result = await window.electronAPI.undoFileOperation();
                    if (result.ok) {
                        showToast(`Undo: ${result.value && result.value.description}`, 'success');
                        if (currentFolderPath) {
                            invalidateFolderCache(currentFolderPath);
                            const previousScrollTop = gridContainer.scrollTop;
                            loadVideos(currentFolderPath, false, previousScrollTop);
                        }
                    } else if (result.error !== 'Nothing to undo') {
                        showToast(`Undo failed: ${result.error}`, 'error');
                    }
                } catch (err) {
                    showToast(`Undo failed: ${friendlyError(err)}`, 'error');
                }
            })();
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
                await closeDuplicatesModal();
            } else if (!toolsMenuDropdown.classList.contains('hidden')) {
                toolsMenuDropdown.classList.add('hidden');
            } else if (selection.marqueeActive || selection.marqueePending) {
                selection.cancelMarquee();
            } else if (selectedCardPaths.size > 0) {
                selection.clear();
            }
            return;
        }

        // Select all visible file items
        if (matchesShortcut(e, 'selectAll')) {
            e.preventDefault();
            selectAllCards();
            return;
        }

        // Convert selected files (Ctrl+Shift+E)
        if (matchesShortcut(e, 'convertFile')) {
            e.preventDefault();
            // In lightbox: convert the open file. In grid: convert selection.
            if (!lightbox.classList.contains('hidden')) {
                const p = window.currentLightboxFilePath;
                if (p) openConvertDialog([p], { fromLightbox: true });
            } else {
                const paths = (window.CG && window.CG.isEnabled())
                    ? Array.from(selectedCardPaths).filter(Boolean)
                    : Array.from(document.querySelectorAll('.video-card.selected'))
                        .map(c => c.dataset.path).filter(Boolean);
                if (paths.length) openConvertDialog(paths, { fromLightbox: false });
                else showToast('Select one or more files to convert', 'info');
            }
            return;
        }

        // More Like This — open visual discovery overlay for focused card
        if (matchesShortcut(e, 'moreLikeThis') && focusedCardIndex >= 0 && aiVisualSearchEnabled) {
            e.preventDefault();
            const card = visibleCards[focusedCardIndex];
            if (card && card.dataset.path) openMoreLikeThis(card.dataset.path);
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
                const deleteLabel = useSystemTrash ? platformString('moveToTrash') : 'Delete';
                const promptLabel = useSystemTrash
                    ? platformString('moveToTrashQ', count)
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
                        const batchVal = (result && result.ok) ? (result.value || {}) : {};
                        const failedFiles = Array.isArray(batchVal.failed) ? batchVal.failed : [];
                        const failCount = failedFiles.length;
                        const successCount = count - failCount;
                        if (successCount > 0) {
                            const msg = useSystemTrash
                                ? platformString('movedToTrash', `${successCount} files`)
                                : `Deleted ${successCount} files`;
                            const failDetails = failCount > 0
                                ? failedFiles.slice(0, 5).map(f => (f && (f.name || f.path)) ? (f.name || f.path.replace(/^.*[\\/]/, '')) : String(f)).join(', ') + (failedFiles.length > 5 ? ` and ${failedFiles.length - 5} more` : '')
                                : undefined;
                            showToast(msg, failCount > 0 ? 'warning' : 'success', {
                                duration: 8000,
                                details: failDetails,
                                actionLabel: useSystemTrash ? undefined : 'Undo',
                                actionCallback: useSystemTrash ? undefined : () => {
                                    window.electronAPI.undoFileOperation().then(undoResult => {
                                        if (undoResult.ok) {
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
                            const allFailDetails = failedFiles.slice(0, 5).map(f => (f && (f.name || f.path)) ? (f.name || f.path.replace(/^.*[\\/]/, '')) : String(f)).join(', ') + (failedFiles.length > 5 ? ` and ${failedFiles.length - 5} more` : '');
                            showToast(`Could not delete ${failCount} files`, 'error', { details: allFailDetails, duration: 8000 });
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
                            if (result.ok) {
                                showToast(`Deleted "${name}"`, 'success', {
                                    duration: 8000,
                                    actionLabel: 'Undo',
                                    actionCallback: () => {
                                        window.electronAPI.undoFileOperation().then(undoResult => {
                                            if (undoResult.ok) {
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

        // Ctrl+Shift+C: Copy file path of hovered > first-selected > focused card
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c') {
            let targetPath = null;
            const hoveredCard = document.querySelector('.video-card:hover, .folder-card:hover')
                || (window.CG && window.CG.isEnabled() && window.CG.getHoveredDescriptor());
            if (hoveredCard && hoveredCard.dataset.path) {
                targetPath = hoveredCard.dataset.path;
            } else if (typeof selectedCardPaths !== 'undefined' && selectedCardPaths.size > 0) {
                targetPath = Array.from(selectedCardPaths).find(Boolean) || null;
            } else if (focusedCardIndex >= 0) {
                const card = visibleCards[focusedCardIndex];
                if (card && card.dataset.path) targetPath = card.dataset.path;
            }
            if (targetPath) {
                e.preventDefault();
                navigator.clipboard.writeText(targetPath).then(() => {
                    showToast('Path copied', 'success', { duration: 1500 });
                }).catch(err => {
                    showToast(`Could not copy path: ${friendlyError(err)}`, 'error');
                });
                return;
            }
        }

        // T: Open tag picker for hovered > selected > focused card(s).
        // Target priority matches rating shortcuts so no click is required.
        if (matchesShortcut(e, 'tagPicker')) {
            let tagPaths = [];
            const hoveredCard = document.querySelector('.video-card:hover')
                || (window.CG && window.CG.isEnabled() && window.CG.getHoveredDescriptor());
            if (hoveredCard && hoveredCard.dataset.path) {
                tagPaths = [hoveredCard.dataset.path];
            } else if (typeof selectedCardPaths !== 'undefined' && selectedCardPaths.size > 0) {
                tagPaths = Array.from(selectedCardPaths).filter(Boolean);
            } else if (focusedCardIndex >= 0) {
                const card = visibleCards[focusedCardIndex];
                if (card && !card.classList.contains('folder-card') && card.dataset.path) {
                    tagPaths = [card.dataset.path];
                }
            }
            if (tagPaths.length > 0 && typeof openTagPicker === 'function') {
                e.preventDefault();
                openTagPicker(tagPaths);
                return;
            }
        }

        // Rename focused file (inline on-card editing)
        if (matchesShortcut(e, 'rename') && focusedCardIndex >= 0) {
            e.preventDefault();
            const card = visibleCards[focusedCardIndex];
            if (card && !card.classList.contains('folder-card')) {
                startInlineRename(card);
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

        // Rating shortcuts: Shift+1..5 set rating, Shift+0 / Shift+` clear.
        // Must run before filter shortcuts because matchesShortcut() is lenient about
        // the shift modifier for plain keys, so Shift+1 would otherwise fire filterAll.
        if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const ratingMap = {
                '!': 1, '1': 1,
                '@': 2, '2': 2,
                '#': 3, '3': 3,
                '$': 4, '4': 4,
                '%': 5, '5': 5,
                ')': 0, '0': 0,
                '~': 0, '`': 0,
            };
            if (Object.prototype.hasOwnProperty.call(ratingMap, e.key)) {
                const rating = ratingMap[e.key];
                // Target priority: hovered card > selection > focused card.
                // Hovered-first means shortcuts work without clicking first.
                let targets = [];
                const hoveredCard = document.querySelector('.video-card:hover')
                    || (window.CG && window.CG.isEnabled() && window.CG.getHoveredDescriptor());
                if (hoveredCard && hoveredCard.dataset.path) {
                    targets = [hoveredCard.dataset.path];
                } else if (typeof selectedCardPaths !== 'undefined' && selectedCardPaths.size > 0) {
                    targets = Array.from(selectedCardPaths).filter(Boolean);
                } else if (focusedCardIndex >= 0) {
                    const card = visibleCards[focusedCardIndex];
                    if (card && !card.classList.contains('folder-card') && card.dataset.path) {
                        targets = [card.dataset.path];
                    }
                }
                if (targets.length === 0) return;
                e.preventDefault();

                // Capture prior ratings so we can push a single grouped undo entry
                const prev = targets.map(p => ({ path: p, rating: getFileRating(p) }));
                _skipMetadataUndo = true;
                try {
                    for (const p of targets) setFileRating(p, rating);
                } finally {
                    _skipMetadataUndo = false;
                }
                const starStr = rating === 0 ? '' : '\u2605'.repeat(rating);
                const baseLabel = rating === 0
                    ? (targets.length > 1 ? `Cleared rating (${targets.length} files)` : 'Cleared rating')
                    : (targets.length > 1 ? `Rated ${starStr} (${targets.length} files)` : `Rated ${starStr}`);
                pushMetadataUndo(
                    baseLabel,
                    () => { for (const item of prev) setFileRating(item.path, item.rating); }
                );
                showToast(baseLabel, 'success', { duration: 1500 });
                return;
            }
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

        // Save workspace
        if (matchesShortcut(e, 'saveWorkspace')) {
            e.preventDefault();
            saveWorkspace();
            return;
        }

        // Filter sidebar to tab folders
        if (matchesShortcut(e, 'sidebarTabFilter')) {
            e.preventDefault();
            toggleSidebarTabFilter();
            return;
        }

        // Flat tab folder list (sub-toggle)
        if (matchesShortcut(e, 'sidebarTabFlat')) {
            e.preventDefault();
            toggleSidebarTabFlat();
            return;
        }

        // New tab group from active tab
        if (matchesShortcut(e, 'newTabGroup')) {
            e.preventDefault();
            createTabGroupFromActiveTab();
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
            if (zoomValue) zoomValue.textContent = `${newZoom}%`;
            applyZoom();
            saveZoomLevel();
            updateStatusBar();
            return;
        }

        // Zoom out
        if (matchesShortcut(e, 'zoomOut')) {
            e.preventDefault();
            const newZoom = Math.max(50, zoomLevel - 10);
            zoomSlider.value = newZoom;
            zoomLevel = newZoom;
            if (zoomValue) zoomValue.textContent = `${newZoom}%`;
            applyZoom();
            saveZoomLevel();
            updateStatusBar();
            return;
        }

        // Reset zoom
        if (matchesShortcut(e, 'zoomReset')) {
            e.preventDefault();
            zoomSlider.value = 100;
            zoomLevel = 100;
            if (zoomValue) zoomValue.textContent = `100%`;
            applyZoom();
            saveZoomLevel();
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
            } else {
                const lightboxOpen = typeof lightbox !== 'undefined' && lightbox && !lightbox.classList.contains('hidden');
                const hoveredSimilarCard = lightboxOpen ? document.querySelector('.lb-insp-similar-card:hover') : null;
                const currentPath = lightboxOpen ? window.currentLightboxFilePath : null;
                const hoveredPath = hoveredSimilarCard?.dataset.path || null;
                if (currentPath && hoveredPath && currentPath !== hoveredPath) {
                    e.preventDefault();
                    if (typeof openCompareMode === 'function') openCompareMode([currentPath, hoveredPath]);
                }
            }
            return;
        }
    });

    // Ctrl+scroll to zoom the grid (mirrors lightbox zoom pattern)
    if (gridContainer) {
        gridContainer.addEventListener('wheel', (e) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            e.preventDefault();
            const step = e.deltaY < 0 ? 10 : -10;
            const newZoom = Math.max(50, Math.min(200, zoomLevel + step));
            if (newZoom === zoomLevel) return;
            zoomLevel = newZoom;
            if (zoomSlider) zoomSlider.value = newZoom;
            if (zoomValue) zoomValue.textContent = `${newZoom}%`;
            applyZoom();
            saveZoomLevel();
            updateStatusBar();
            showZoomPill(newZoom);
        }, { passive: false });
    }
}

// Transient zoom pill shown near the cursor during Ctrl+scroll zoom
let _zoomPillEl = null;
let _zoomPillHideTimer = null;
function showZoomPill(pct) {
    if (!_zoomPillEl) {
        _zoomPillEl = document.createElement('div');
        _zoomPillEl.className = 'zoom-pill';
        document.body.appendChild(_zoomPillEl);
    }
    _zoomPillEl.textContent = `${pct}%`;
    _zoomPillEl.classList.add('visible');
    if (_zoomPillHideTimer) clearTimeout(_zoomPillHideTimer);
    _zoomPillHideTimer = setTimeout(() => {
        if (_zoomPillEl) _zoomPillEl.classList.remove('visible');
    }, 700);
}

function navigateCards(direction) {
    if (window.CG && window.CG.isEnabled()) return; // canvas-grid has its own arrow-key handler
    const cards = Array.from(gridContainer.querySelectorAll('.video-card, .folder-card'))
        .filter(card => card.style.display !== 'none');

    if (cards.length === 0) return;

    visibleCards = cards;

    if (focusedCardIndex < 0) {
        // Perf: use pre-computed VS positions when available, avoid getBoundingClientRect loop
        if (vsState.enabled && vsState.positions) {
            const scrollTop = gridContainer.scrollTop;
            const firstVisibleIdx = cards.findIndex(c => {
                const idx = c._vsItemIndex;
                if (idx == null) return false;
                const top = vsState.positions[idx * 4 + 1];
                return top >= scrollTop;
            });
            focusedCardIndex = firstVisibleIdx >= 0 ? firstVisibleIdx : 0;
        } else {
            // Find first visible card (fallback for non-VS mode)
            const firstVisible = cards.find(card => {
                const rect = card.getBoundingClientRect();
                return rect.top >= 0 && rect.top < window.innerHeight;
            });
            focusedCardIndex = firstVisible ? cards.indexOf(firstVisible) : 0;
        }
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

    // Perf: O(1) outline update instead of O(n) forEach
    if (_lastFocusedCard) {
        _lastFocusedCard.style.outline = '';
        _lastFocusedCard.style.outlineOffset = '';
    }
    const newCard = cards[focusedCardIndex];
    if (newCard) {
        newCard.style.outline = '2px solid var(--accent)';
        newCard.style.outlineOffset = '2px';
        newCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        _lastFocusedCard = newCard;
    }

    // Update status bar with focused card info
    updateStatusBarSelection(newCard || null);
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
    _lastFocusedCard = null;
}

// ==================== FAVORITES ====================
function defaultFavoritesStructure() {
    return { version: 2, groups: [{ id: 'uncategorized', name: 'Uncategorized', collapsed: false, items: [] }] };
}

// Shared hydration helpers (used by both individual loaders and batched init)
function hydrateFavorites(favData) {
    if (favData && favData.groups && favData.groups.length > 0) {
        favorites = favData;
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
    renderFavorites();
}

const _RECENT_VIDEO_EXTS = new Set(['mp4', 'avi', 'mkv', 'mov', 'webm', 'wmv', 'flv', 'm4v']);
const _RECENT_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg', 'ico']);

function hydrateRecentFiles(rawEntries) {
    if (rawEntries) {
        recentFiles = rawEntries.map(r => {
            const p = r.path;
            const name = p.split(/[/\\]/).pop();
            const ext = (name.split('.').pop() || '').toLowerCase();
            let type = 'unknown';
            if (_RECENT_VIDEO_EXTS.has(ext)) type = 'video';
            else if (_RECENT_IMAGE_EXTS.has(ext)) type = 'image';
            return { path: p, name, url: pathToFileUrl(p), type, timestamp: r.addedAt || Date.now() };
        });
    } else {
        recentFiles = [];
    }
    renderRecentFiles();
}

async function loadFavorites() {
    try {
        const result = await window.electronAPI.dbGetFavorites();
        hydrateFavorites(result.ok ? result.value : null);
    } catch (e) {
        favorites = defaultFavoritesStructure();
        renderFavorites();
    }
}

function saveFavorites() {
    window.electronAPI.dbSaveFavorites(favorites);
}

function renderFavorites() {
    favoritesList.replaceChildren();
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

        // Shared drag-drop logic for group header and items container
        function handleFavDragOver(e) {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer.types.includes('application/x-fav-drag')) {
                e.dataTransfer.dropEffect = 'move';
                header.classList.add('fav-drag-over');
            }
        }
        function handleFavDrop(e) {
            e.preventDefault();
            e.stopPropagation();
            header.classList.remove('fav-drag-over');
            try {
                const data = JSON.parse(e.dataTransfer.getData('application/x-fav-drag'));
                if (data.groupId !== group.id) {
                    moveFavoriteToGroup(data.groupId, data.index, group.id);
                }
            } catch (_) {}
        }

        // Drop target on group header
        header.addEventListener('dragover', handleFavDragOver);
        header.addEventListener('dragleave', (e) => {
            e.stopPropagation();
            header.classList.remove('fav-drag-over');
        });
        header.addEventListener('drop', handleFavDrop);

        groupEl.appendChild(header);

        // Group items container
        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'fav-group-items' + (group.collapsed ? ' collapsed' : '');

        // Drop target on items container (for dropping into empty or expanded groups)
        itemsContainer.addEventListener('dragover', handleFavDragOver);
        itemsContainer.addEventListener('dragleave', (e) => {
            e.stopPropagation();
            if (!itemsContainer.contains(e.relatedTarget)) {
                header.classList.remove('fav-drag-over');
            }
        });
        itemsContainer.addEventListener('drop', handleFavDrop);

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
    const removedItem = JSON.parse(JSON.stringify(group.items[itemIndex]));
    group.items.splice(itemIndex, 1);
    saveFavorites();
    renderFavorites();
    pushMetadataUndo('Remove favorite', () => {
        const g = favorites.groups.find(g => g.id === groupId);
        if (g) {
            g.items.splice(itemIndex, 0, removedItem);
            saveFavorites();
            renderFavorites();
        }
    });
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
    // Snapshot for undo
    const deletedGroup = JSON.parse(JSON.stringify(favorites.groups[groupIndex]));
    const deletedIndex = groupIndex;
    const movedItemCount = deletedGroup.items.length;
    // Move items to uncategorized before deleting
    uncategorized.items.push(...favorites.groups[groupIndex].items);
    favorites.groups.splice(groupIndex, 1);
    saveFavorites();
    renderFavorites();
    pushMetadataUndo('Delete favorite group', () => {
        // Remove the items that were moved to uncategorized
        const unc = favorites.groups.find(g => g.id === 'uncategorized');
        if (unc && movedItemCount > 0) {
            unc.items.splice(unc.items.length - movedItemCount, movedItemCount);
        }
        // Re-insert the deleted group at its original position
        favorites.groups.splice(deletedIndex, 0, JSON.parse(JSON.stringify(deletedGroup)));
        saveFavorites();
        renderFavorites();
    });
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
    favContextMenu.replaceChildren();

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
        deleteItem.addEventListener('click', async () => {
            hideFavContextMenu();
            const confirmed = await showConfirm('Delete Group', 'Are you sure you want to delete this group? Items will be moved to Uncategorized.', { confirmLabel: 'Delete', danger: true });
            if (confirmed) deleteFavoriteGroup(groupId);
        });
        favContextMenu.appendChild(deleteItem);
    }

    positionFavContextMenu(e);
}

function showFavItemContextMenu(e, groupId, itemIndex) {
    hideFavContextMenu();
    hideContextMenu();
    favContextMenu.replaceChildren();

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
        setTimeout(() => navigateToFolder(fav.path).catch(e => console.warn('[favorites] navigate failed:', e.message)), 0);
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

    // New Group from Item
    const newGroupItem = document.createElement('div');
    newGroupItem.className = 'context-menu-item';
    newGroupItem.textContent = 'New Group from Item';
    newGroupItem.addEventListener('click', async () => {
        hideFavContextMenu();
        const name = await showPromptDialog('New Group', { placeholder: 'Group name' });
        if (name && name.trim()) {
            const newGroup = { id: 'grp_' + Date.now(), name: name.trim(), collapsed: false, items: [] };
            favorites.groups.push(newGroup);
            moveFavoriteToGroup(groupId, itemIndex, newGroup.id);
        }
    });
    favContextMenu.appendChild(newGroupItem);

    // Divider + Remove
    const divider = document.createElement('div');
    divider.className = 'context-menu-divider';
    favContextMenu.appendChild(divider);

    const removeItem = document.createElement('div');
    removeItem.className = 'context-menu-item context-menu-item-danger';
    removeItem.textContent = 'Remove from Favorites';
    removeItem.addEventListener('click', async () => {
        hideFavContextMenu();
        const confirmed = await showConfirm('Remove Favorite', 'Remove this item from favorites?', { confirmLabel: 'Remove', danger: true });
        if (confirmed) removeFavorite(groupId, itemIndex);
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
        hydrateRecentFiles(result.ok ? result.value : null);
    } catch (e) {
        recentFiles = [];
        renderRecentFiles();
    }
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

        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const menu = document.createElement('div');
            menu.className = 'tab-group-context-menu';

            const openItem = document.createElement('div');
            openItem.className = 'context-menu-item';
            openItem.textContent = 'Open';
            openItem.addEventListener('click', () => {
                _hideTabGroupContextMenu();
                // Remove hover preview before opening
                const pid = item.dataset.previewId;
                if (pid) {
                    const p = document.getElementById(pid);
                    if (p) p.remove();
                    delete item.dataset.previewId;
                }
                openLightbox(file.url, file.path, file.name);
                toolsMenuDropdown.classList.add('hidden');
            });
            menu.appendChild(openItem);

            const removeItem = document.createElement('div');
            removeItem.className = 'context-menu-item context-menu-item-danger';
            removeItem.textContent = 'Remove from Recent';
            removeItem.addEventListener('click', () => {
                _hideTabGroupContextMenu();
                removeRecentFile(file.path);
            });
            menu.appendChild(removeItem);

            _showContextMenuAt(menu, e);
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

function removeRecentFile(filePath) {
    recentFiles = recentFiles.filter(f => f.path !== filePath);
    window.electronAPI.dbRemoveRecentFile(filePath);
    renderRecentFiles();
}

function clearRecentFiles() {
    recentFiles = [];
    window.electronAPI.dbClearRecentFiles();
    renderRecentFiles();
}

// ==================== TABS ====================

const TAB_GROUP_COLORS = [
    { id: 'grey',   label: 'Grey',   value: '#9d9da6' },
    { id: 'blue',   label: 'Blue',   value: '#60a5fa' },
    { id: 'red',    label: 'Red',    value: '#f87171' },
    { id: 'yellow', label: 'Yellow', value: '#fbbf24' },
    { id: 'green',  label: 'Green',  value: '#4ade80' },
    { id: 'pink',   label: 'Pink',   value: '#f472b6' },
    { id: 'purple', label: 'Purple', value: '#a78bfa' },
    { id: 'cyan',   label: 'Cyan',   value: '#22d3ee' },
];
const DEFAULT_GROUP_COLOR = 'blue';

function _getGroupColor(colorId) {
    const entry = TAB_GROUP_COLORS.find(c => c.id === colorId);
    return entry ? entry.value : TAB_GROUP_COLORS[0].value;
}

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
                // Backfill groupId for tabs saved before tab groups
                if (tab.groupId === undefined) tab.groupId = null;
            }
        } catch (e) {
            tabs = [];
        }
    }

    // Load tab groups
    const savedGroups = localStorage.getItem('tabGroups');
    if (savedGroups) {
        try {
            tabGroups = JSON.parse(savedGroups);
            tabGroupIdCounter = Math.max(...tabGroups.map(g => g.id), 0) + 1;
        } catch (e) { tabGroups = []; }
    }

    const rawSavedGroups = localStorage.getItem('savedTabGroups');
    if (rawSavedGroups) {
        try {
            savedTabGroups = JSON.parse(rawSavedGroups);
            savedTabGroupIdCounter = Math.max(...savedTabGroups.map(g => g.id), 0) + 1;
        } catch (e) { savedTabGroups = []; }
    }

    if (tabs.length === 0) {
        // Create initial tab if none exist
        createTab(null, 'Home');
    }
    renderTabs();
    renderSavedTabGroupsSidebar();
    const savedActiveTabId = localStorage.getItem('activeTabId');
    if (savedActiveTabId) activeTabId = parseInt(savedActiveTabId, 10);
    if (activeTabId && tabs.find(t => t.id === activeTabId)) {
        switchToTab(activeTabId);
    } else if (tabs.length > 0) {
        switchToTab(tabs[0].id);
    }
}

let tabDragInProgress = false;

function saveTabs() {
    deferLocalStorageWrite('tabs', JSON.stringify(tabs));
    deferLocalStorageWrite('activeTabId', activeTabId);
    deferLocalStorageWrite('tabGroups', JSON.stringify(tabGroups));
}

function saveSavedTabGroups() {
    deferLocalStorageWrite('savedTabGroups', JSON.stringify(savedTabGroups));
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

function createTab(path, name, collectionId = null, groupId = null) {
    const tab = {
        id: tabIdCounter++,
        path: path || null,
        name: name || (path ? path.split(/[/\\]/).filter(Boolean).pop() : 'Home'),
        sortType: sortType || 'name', // Use current sorting or default
        sortOrder: sortOrder || 'ascending', // Use current order or default
        historyPaths: [],
        historyIndex: -1,
        collectionId: collectionId || null,
        groupId: groupId
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
    onTabsChanged();
    return tab.id;
}

function _cleanupTabCaches(tabId) {
    tabDomCache.delete(tabId);
    tabFolderScrollPositions.delete(tabId);
    tabContentCache.delete(tabId);
}

function closeTab(tabId) {
    if (tabs.length <= 1) return; // Don't close last tab
    _cleanupTabCaches(tabId);
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
    onTabsChanged();
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
        onTabsChanged();
    }
}

function renderTabs() {
    tabsContainer.innerHTML = '';

    // Clean up orphaned groupIds (tab references a group that no longer exists)
    const validGroupIds = new Set(tabGroups.map(g => g.id));
    for (const tab of tabs) {
        if (tab.groupId != null && !validGroupIds.has(tab.groupId)) {
            tab.groupId = null;
        }
    }

    // Build ordered render list: grouped tabs (in tabGroups order), then ungrouped
    const renderedTabIds = new Set();

    for (const group of tabGroups) {
        const groupTabs = tabs.filter(t => t.groupId === group.id);
        if (groupTabs.length === 0) continue; // Skip empty groups

        const colorValue = _getGroupColor(group.color);

        // Wrapper div for Chrome-like group underline
        const wrapperEl = document.createElement('div');
        wrapperEl.className = 'tab-group-wrapper';
        if (group.collapsed) wrapperEl.classList.add('collapsed');
        wrapperEl.dataset.groupId = group.id;
        wrapperEl.style.setProperty('--tab-group-color', colorValue);

        // Render group label
        const labelEl = document.createElement('div');
        labelEl.className = 'tab-group-label';
        labelEl.dataset.groupId = group.id;
        const chevronClass = group.collapsed ? '' : ' expanded';
        labelEl.innerHTML = `
            <span class="tab-group-toggle${chevronClass}">${icon('chevron-right', 12)}</span>
            <span class="tab-group-name">${escapeHtml(group.name)}</span>
            ${group.collapsed ? `<span class="tab-group-count">${groupTabs.length}</span>` : ''}
        `;
        labelEl.addEventListener('click', (e) => {
            if (tabDragInProgress) return;
            e.stopPropagation();
            toggleTabGroupCollapse(group.id);
        });
        labelEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showTabGroupContextMenu(e, group);
        });
        wrapperEl.appendChild(labelEl);

        // Render group's tabs
        for (const tab of groupTabs) {
            renderedTabIds.add(tab.id);
            const tabEl = _createTabElement(tab, colorValue, group.collapsed);
            wrapperEl.appendChild(tabEl);
        }

        tabsContainer.appendChild(wrapperEl);
    }

    // Render ungrouped tabs
    for (const tab of tabs) {
        if (renderedTabIds.has(tab.id)) continue;
        const tabEl = _createTabElement(tab, null, false);
        tabsContainer.appendChild(tabEl);
    }

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

function _createTabElement(tab, groupColorValue, isGroupCollapsed) {
    const tabEl = document.createElement('div');
    let cls = `tab ${tab.id === activeTabId ? 'active' : ''}`;
    if (isGroupCollapsed) cls += ' tab-group-collapsed';
    tabEl.className = cls;
    tabEl.dataset.tabId = tab.id;
    if (tab.groupId != null) {
        tabEl.dataset.groupId = tab.groupId;
        if (groupColorValue) tabEl.style.setProperty('--tab-group-color', groupColorValue);
    }
    let tabIcon = '';
    if (tab.collectionId) {
        const col = collectionsCache.find(c => c.id === tab.collectionId);
        const hasAi = col && col.type === 'smart' && col.rules?.aiQuery;
        const isSmart = col && col.type === 'smart';
        tabIcon = `<span class="tab-icon">${hasAi ? '\u2726' : isSmart ? '\u2606' : '\u25A6'}</span>`;
    } else if (tab.path) {
        tabIcon = `<span class="tab-icon tab-icon-svg">${icon('folder', 12)}</span>`;
    }
    tabEl.innerHTML = `
        ${tabIcon}<span class="tab-name" title="${escapeHtml(tab.path || 'Home')}">${escapeHtml(tab.name)}</span>
        <span class="tab-close" data-tab-id="${tab.id}">${icon('x', 14)}</span>
    `;

    // Click handler (guarded against post-drag clicks)
    tabEl.addEventListener('click', (e) => {
        if (tabDragInProgress) return;
        if (e.target.closest('.tab-close')) {
            e.stopPropagation();
            closeTab(tab.id);
        } else {
            switchToTab(tab.id);
        }
    });

    // Right-click → tab context menu
    tabEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showTabContextMenu(e, tab);
    });

    // Mousedown initiates drag reordering
    tabEl.addEventListener('mousedown', (e) => {
        if (e.target.closest('.tab-close')) return;
        if (e.button !== 0) return;
        if (tabs.length <= 1) return;
        initTabDragReorder(e, tabEl);
    });

    return tabEl;
}

function initTabDragReorder(e, dragEl) {
    const allTabs = Array.from(tabsContainer.querySelectorAll('.tab:not(.tab-group-collapsed)'));
    const originalIndex = allTabs.indexOf(dragEl);
    if (originalIndex === -1) return;

    const startX = e.clientX;
    const dragTabId = parseInt(dragEl.dataset.tabId, 10);

    // Cache bounding rects of all tabs before anything moves
    const tabPositions = allTabs.map(t => {
        const r = t.getBoundingClientRect();
        return { left: r.left, width: r.width, centerX: r.left + r.width / 2 };
    });

    // Cache group label positions for group-aware dropping
    const allGroupLabels = Array.from(tabsContainer.querySelectorAll('.tab-group-label'));
    const groupLabelPositions = allGroupLabels.map(gl => {
        const r = gl.getBoundingClientRect();
        return { el: gl, groupId: parseInt(gl.dataset.groupId, 10), left: r.left, right: r.right, centerX: r.left + r.width / 2 };
    });

    // Shift amount = dragged tab width + container gap
    const gap = parseFloat(getComputedStyle(tabsContainer).gap) || 0;
    const shiftAmount = tabPositions[originalIndex].width + gap;

    let hasDragStarted = false;
    let currentSlot = originalIndex;
    let _tabDragRAF = null;
    let _latestDeltaX = 0;
    let _hoveredGroupLabel = null;

    function onMouseMove(ev) {
        _latestDeltaX = ev.clientX - startX;

        // Require a small threshold before committing to a drag
        if (!hasDragStarted) {
            if (Math.abs(_latestDeltaX) < 5) return;
            hasDragStarted = true;
            tabDragInProgress = true;
            tabsContainer.classList.add('tab-reordering');
            dragEl.classList.add('tab-drag-active');
            // Enable smooth transitions on all other tabs
            allTabs.forEach((t, i) => {
                if (i !== originalIndex) t.classList.add('tab-shift-animate');
            });
        }

        // Perf: coalesce DOM writes into single RAF (avoids >60fps style writes on high-refresh displays)
        if (!_tabDragRAF) {
            _tabDragRAF = requestAnimationFrame(() => {
                _tabDragRAF = null;
                const deltaX = _latestDeltaX;

                // The dragged tab follows the cursor directly (no transition)
                dragEl.style.transform = `translateX(${deltaX}px)`;

                // Visual center of the dragged tab
                const draggedCenter = tabPositions[originalIndex].centerX + deltaX;

                // Highlight group labels when hovered during drag
                let newHovered = null;
                for (const glp of groupLabelPositions) {
                    if (draggedCenter >= glp.left && draggedCenter <= glp.right) {
                        newHovered = glp;
                        break;
                    }
                }
                if (newHovered !== _hoveredGroupLabel) {
                    if (_hoveredGroupLabel) _hoveredGroupLabel.el.classList.remove('drag-over');
                    _hoveredGroupLabel = newHovered;
                    if (_hoveredGroupLabel) _hoveredGroupLabel.el.classList.add('drag-over');
                }

                // Determine which slot the dragged tab belongs in
                let targetSlot = originalIndex;
                if (deltaX < 0) {
                    // Moving left — check tabs to the left
                    for (let i = originalIndex - 1; i >= 0; i--) {
                        if (draggedCenter < tabPositions[i].centerX) {
                            targetSlot = i;
                        } else {
                            break;
                        }
                    }
                } else {
                    // Moving right — check tabs to the right
                    for (let i = originalIndex + 1; i < tabPositions.length; i++) {
                        if (draggedCenter > tabPositions[i].centerX) {
                            targetSlot = i;
                        } else {
                            break;
                        }
                    }
                }

                // Only update transforms when the target slot actually changes
                if (targetSlot !== currentSlot) {
                    currentSlot = targetSlot;
                    allTabs.forEach((t, i) => {
                        if (i === originalIndex) return;
                        if (targetSlot < originalIndex && i >= targetSlot && i < originalIndex) {
                            // These tabs shift right to make room
                            t.style.transform = `translateX(${shiftAmount}px)`;
                        } else if (targetSlot > originalIndex && i > originalIndex && i <= targetSlot) {
                            // These tabs shift left to fill the gap
                            t.style.transform = `translateX(${-shiftAmount}px)`;
                        } else {
                            t.style.transform = '';
                        }
                    });
                }
            });
        }
    }

    function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (_tabDragRAF) { cancelAnimationFrame(_tabDragRAF); _tabDragRAF = null; }

        // Clean up group label hover state
        if (_hoveredGroupLabel) _hoveredGroupLabel.el.classList.remove('drag-over');

        if (!hasDragStarted) return;

        // Clean up all visual state
        tabsContainer.classList.remove('tab-reordering');
        dragEl.classList.remove('tab-drag-active');
        allTabs.forEach(t => {
            t.classList.remove('tab-shift-animate');
            t.style.transform = '';
        });

        // Commit the reorder if position changed
        if (currentSlot !== originalIndex) {
            // Map DOM visual order → tab IDs, apply reorder, then sync backing array.
            // Direct index-based splice was wrong because renderTabs() renders grouped
            // tabs first (by group order) then ungrouped — so DOM indices ≠ tabs-array indices.
            const visualTabIds = allTabs.map(t => parseInt(t.dataset.tabId, 10));
            const [movedId] = visualTabIds.splice(originalIndex, 1);
            visualTabIds.splice(currentSlot, 0, movedId);
            const tabById = new Map(tabs.map(t => [t.id, t]));
            const reordered = visualTabIds.map(id => tabById.get(id)).filter(Boolean);
            // Preserve any non-visible tabs (e.g. inside collapsed groups) in their original order
            for (const t of tabs) {
                if (!reordered.includes(t)) reordered.push(t);
            }
            tabs.length = 0;
            tabs.push(...reordered);
        }

        // Group-aware drop: if dropped on a group label, assign to that group
        if (_hoveredGroupLabel) {
            const tab = tabs.find(t => t.id === dragTabId);
            if (tab) tab.groupId = _hoveredGroupLabel.groupId;
        } else {
            // Determine group from neighboring tabs at the drop position
            const neighborTab = allTabs[currentSlot];
            if (neighborTab && neighborTab !== dragEl) {
                const neighborGroupId = neighborTab.dataset.groupId ? parseInt(neighborTab.dataset.groupId, 10) : null;
                const dragTab = tabs.find(t => t.id === dragTabId);
                if (dragTab) {
                    // If dropped among grouped tabs, join that group; if among ungrouped, leave group
                    dragTab.groupId = neighborGroupId || null;
                }
            }
        }

        saveTabs();
        renderTabs();

        // Reset flag after the click event fires (click fires synchronously after mouseup)
        setTimeout(() => { tabDragInProgress = false; }, 0);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
}

// ==================== TAB GROUPS ====================

function createTabGroup(name, colorId, tabIds) {
    const group = {
        id: tabGroupIdCounter++,
        name: name || 'New Group',
        color: colorId || TAB_GROUP_COLORS[0].id,
        collapsed: false,
    };
    tabGroups.push(group);
    for (const tid of tabIds) {
        const tab = tabs.find(t => t.id === tid);
        if (tab) tab.groupId = group.id;
    }
    saveTabs();
    renderTabs();
    return group.id;
}

async function renameTabGroup(groupId) {
    const group = tabGroups.find(g => g.id === groupId);
    if (!group) return;
    const newName = await showPromptDialog('Rename Tab Group', { defaultValue: group.name, placeholder: 'Group name' });
    if (newName == null || newName.trim() === '') return;
    group.name = newName.trim();
    saveTabs();
    renderTabs();
    renderSavedTabGroupsSidebar();
}

function setTabGroupColor(groupId, colorId) {
    const group = tabGroups.find(g => g.id === groupId);
    if (!group) return;
    group.color = colorId;
    saveTabs();
    renderTabs();
}

function toggleTabGroupCollapse(groupId) {
    const group = tabGroups.find(g => g.id === groupId);
    if (!group) return;
    group.collapsed = !group.collapsed;
    saveTabs();
    renderTabs();
}

function ungroupTabs(groupId) {
    for (const tab of tabs) {
        if (tab.groupId === groupId) tab.groupId = null;
    }
    tabGroups = tabGroups.filter(g => g.id !== groupId);
    saveTabs();
    renderTabs();
}

function addTabToGroup(tabId, groupId) {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    tab.groupId = groupId;
    saveTabs();
    renderTabs();
}

function removeTabFromGroup(tabId) {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    tab.groupId = null;
    saveTabs();
    renderTabs();
}

function closeTabGroup(groupId) {
    const groupTabs = tabs.filter(t => t.groupId === groupId);
    // Keep at least one tab alive
    const idsToClose = new Set();
    for (const t of groupTabs) {
        if (tabs.length - idsToClose.size <= 1) break;
        _cleanupTabCaches(t.id);
        idsToClose.add(t.id);
    }
    tabs = tabs.filter(t => !idsToClose.has(t.id));
    tabGroups = tabGroups.filter(g => g.id !== groupId);
    if (!tabs.find(t => t.id === activeTabId)) {
        activeTabId = tabs[0]?.id ?? null;
    }
    if (activeTabId != null) {
        switchToTab(activeTabId);
    } else {
        saveTabs();
        renderTabs();
    }
    onTabsChanged();
}

function _snapshotTabsForSave(tabList) {
    return tabList.map(t => ({
        path: t.path,
        name: t.name,
        collectionId: t.collectionId || null,
        sortType: t.sortType,
        sortOrder: t.sortOrder,
    }));
}

function saveTabGroupToSaved(groupId) {
    const group = tabGroups.find(g => g.id === groupId);
    if (!group) return;
    const groupTabs = tabs.filter(t => t.groupId === groupId);
    if (groupTabs.length === 0) return;
    savedTabGroups.push({
        id: savedTabGroupIdCounter++,
        name: group.name,
        color: group.color,
        tabs: _snapshotTabsForSave(groupTabs),
        savedAt: Date.now(),
    });
    saveSavedTabGroups();
    renderSavedTabGroupsSidebar();
    showToast(`Saved tab group "${group.name}"`);
}

async function saveAllTabsAsGroup() {
    if (tabs.length === 0) return;
    const name = await showPromptDialog('Save All Tabs as Group', { placeholder: 'Group name', confirmLabel: 'Save' });
    if (name == null || name.trim() === '') return;
    savedTabGroups.push({
        id: savedTabGroupIdCounter++,
        name: name.trim(),
        color: DEFAULT_GROUP_COLOR,
        tabs: _snapshotTabsForSave(tabs),
        savedAt: Date.now(),
    });
    saveSavedTabGroups();
    renderSavedTabGroupsSidebar();
    showToast(`Saved ${tabs.length} tab${tabs.length === 1 ? '' : 's'} as "${name.trim()}"`);
}

async function restoreSavedTabGroup(savedGroupId) {
    const saved = savedTabGroups.find(g => g.id === savedGroupId);
    if (!saved || saved.tabs.length === 0) return;

    const mode = await showRestoreTabGroupDialog(saved.name, saved.tabs.length);
    if (!mode) return; // cancelled

    if (mode === 'replace') {
        for (const t of tabs) _cleanupTabCaches(t.id);
        tabs = [];
        tabGroups = [];
    }

    // Create a new tab group for the restored tabs
    const newGroup = {
        id: tabGroupIdCounter++,
        name: saved.name,
        color: saved.color,
        collapsed: false,
    };
    tabGroups.push(newGroup);

    let firstTabId = null;
    for (const st of saved.tabs) {
        const tab = {
            id: tabIdCounter++,
            path: st.path || null,
            name: st.name || 'Home',
            sortType: st.sortType || 'name',
            sortOrder: st.sortOrder || 'ascending',
            historyPaths: st.path ? [st.path] : [],
            historyIndex: st.path ? 0 : -1,
            collectionId: st.collectionId || null,
            groupId: newGroup.id,
        };
        tabs.push(tab);
        if (firstTabId === null) firstTabId = tab.id;
    }

    saveTabs();
    renderTabs();
    if (firstTabId != null) switchToTab(firstTabId);
    onTabsChanged();
    showToast(`Restored tab group "${saved.name}"`);
}

function deleteSavedTabGroup(savedGroupId) {
    const deletedGroup = savedTabGroups.find(g => g.id === savedGroupId);
    if (!deletedGroup) return;
    const deletedSnapshot = JSON.parse(JSON.stringify(deletedGroup));
    savedTabGroups = savedTabGroups.filter(g => g.id !== savedGroupId);
    saveSavedTabGroups();
    renderSavedTabGroupsSidebar();
    pushMetadataUndo('Delete tab group', () => {
        savedTabGroups.push(deletedSnapshot);
        saveSavedTabGroups();
        renderSavedTabGroupsSidebar();
    });
}

async function renameSavedTabGroup(savedGroupId) {
    const saved = savedTabGroups.find(g => g.id === savedGroupId);
    if (!saved) return;
    const newName = await showPromptDialog('Rename Saved Tab Group', { defaultValue: saved.name, placeholder: 'Group name' });
    if (newName == null || newName.trim() === '') return;
    saved.name = newName.trim();
    saveSavedTabGroups();
    renderSavedTabGroupsSidebar();
}

// ── Sidebar: Saved Tab Groups ──

function renderSavedTabGroupsSidebar() {
    if (!savedTabGroupsList) return;
    if (savedTabGroups.length === 0) {
        savedTabGroupsList.innerHTML = '<div class="collections-list-empty">No saved tab groups</div>';
        return;
    }
    savedTabGroupsList.innerHTML = '';
    for (const sg of savedTabGroups) {
        const item = document.createElement('div');
        item.className = 'collection-item';
        item.dataset.savedTabGroupId = sg.id;
        const dotColor = _getGroupColor(sg.color);
        item.innerHTML = `<span class="saved-tab-group-dot" style="background-color: ${dotColor}"></span>` +
            `<span class="collection-item-name">${escapeHtml(sg.name)}</span>` +
            `<span class="collection-item-count">${sg.tabs.length}</span>`;
        item.title = `${sg.name} (${sg.tabs.length} tab${sg.tabs.length === 1 ? '' : 's'})`;
        item.addEventListener('click', () => restoreSavedTabGroup(sg.id));
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showSavedTabGroupContextMenu(e, sg);
        });
        savedTabGroupsList.appendChild(item);
    }
}

// ── Tab Context Menu ──

let _tabGroupContextMenuEl = null;

function _hideTabGroupContextMenu() {
    if (_tabGroupContextMenuEl) {
        _tabGroupContextMenuEl.remove();
        _tabGroupContextMenuEl = null;
    }
    document.removeEventListener('click', _onTabGroupContextMenuOutsideClick, true);
}

function _onTabGroupContextMenuOutsideClick(e) {
    if (_tabGroupContextMenuEl && !_tabGroupContextMenuEl.contains(e.target)) {
        _hideTabGroupContextMenu();
    }
}

function _showContextMenuAt(menuEl, e) {
    _hideTabGroupContextMenu();
    _tabGroupContextMenuEl = menuEl;
    document.body.appendChild(menuEl);

    const menuWidth = 200;
    const menuHeight = menuEl.offsetHeight || 200;
    let x = e.clientX;
    let y = e.clientY;
    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 5;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 5;
    if (y < 0) y = 5;
    menuEl.style.left = `${x}px`;
    menuEl.style.top = `${y}px`;

    setTimeout(() => {
        document.removeEventListener('click', _onTabGroupContextMenuOutsideClick, true);
        document.addEventListener('click', _onTabGroupContextMenuOutsideClick, true);
    }, 0);
}

function showTabContextMenu(e, tab) {
    hideContextMenu();
    const menu = document.createElement('div');
    menu.className = 'tab-group-context-menu';

    const newGroupItem = document.createElement('div');
    newGroupItem.className = 'context-menu-item';
    newGroupItem.textContent = 'Add to New Group';
    newGroupItem.addEventListener('click', async () => {
        _hideTabGroupContextMenu();
        const name = await showPromptDialog('New Tab Group', { placeholder: 'Group name', confirmLabel: 'Create' });
        if (name == null || name.trim() === '') return;
        createTabGroup(name.trim(), DEFAULT_GROUP_COLOR, [tab.id]);
    });
    menu.appendChild(newGroupItem);

    const availableGroups = tabGroups.filter(g => g.id !== tab.groupId);
    if (availableGroups.length > 0) {
        const moveContainer = document.createElement('div');
        moveContainer.className = 'context-menu-submenu';
        const moveLabel = document.createElement('div');
        moveLabel.className = 'context-menu-item';
        moveLabel.innerHTML = `Add to Group <span style="float:right; opacity:0.5">${icon('chevron-right', 12)}</span>`;
        moveContainer.appendChild(moveLabel);
        const submenu = document.createElement('div');
        submenu.className = 'context-menu-submenu-items';
        for (const g of availableGroups) {
            const subItem = document.createElement('div');
            subItem.className = 'context-menu-item';
            const dotColor = _getGroupColor(g.color);
            subItem.innerHTML = `<span class="saved-tab-group-dot" style="background-color: ${dotColor}"></span> ${escapeHtml(g.name)}`;
            subItem.addEventListener('click', () => {
                _hideTabGroupContextMenu();
                addTabToGroup(tab.id, g.id);
            });
            submenu.appendChild(subItem);
        }
        moveContainer.appendChild(submenu);
        menu.appendChild(moveContainer);
    }

    if (tab.groupId != null) {
        const removeFromGroup = document.createElement('div');
        removeFromGroup.className = 'context-menu-item';
        removeFromGroup.textContent = 'Remove from Group';
        removeFromGroup.addEventListener('click', () => {
            _hideTabGroupContextMenu();
            removeTabFromGroup(tab.id);
        });
        menu.appendChild(removeFromGroup);
    }

    const divider = document.createElement('div');
    divider.className = 'context-menu-divider';
    menu.appendChild(divider);

    const closeItem = document.createElement('div');
    closeItem.className = 'context-menu-item';
    closeItem.textContent = 'Close Tab';
    closeItem.addEventListener('click', () => {
        _hideTabGroupContextMenu();
        closeTab(tab.id);
    });
    menu.appendChild(closeItem);

    if (tabs.length > 1) {
        const closeOthers = document.createElement('div');
        closeOthers.className = 'context-menu-item';
        closeOthers.textContent = 'Close Other Tabs';
        closeOthers.addEventListener('click', () => {
            _hideTabGroupContextMenu();
            const idsToClose = new Set(tabs.filter(t => t.id !== tab.id).map(t => t.id));
            for (const tid of idsToClose) _cleanupTabCaches(tid);
            tabs = tabs.filter(t => !idsToClose.has(t.id));
            tabGroups = tabGroups.filter(g => tabs.some(t => t.groupId === g.id));
            activeTabId = tab.id;
            switchToTab(activeTabId);
            onTabsChanged();
        });
        menu.appendChild(closeOthers);
    }

    const tabIndex = tabs.indexOf(tab);
    if (tabIndex < tabs.length - 1) {
        const closeRight = document.createElement('div');
        closeRight.className = 'context-menu-item';
        closeRight.textContent = 'Close Tabs to the Right';
        closeRight.addEventListener('click', () => {
            _hideTabGroupContextMenu();
            const idsToClose = new Set(tabs.slice(tabIndex + 1).map(t => t.id));
            for (const tid of idsToClose) _cleanupTabCaches(tid);
            tabs = tabs.filter(t => !idsToClose.has(t.id));
            tabGroups = tabGroups.filter(g => tabs.some(t => t.groupId === g.id));
            if (!tabs.find(t => t.id === activeTabId)) activeTabId = tab.id;
            switchToTab(activeTabId);
            onTabsChanged();
        });
        menu.appendChild(closeRight);
    }

    _showContextMenuAt(menu, e);
}

// ── Tab Group Label Context Menu ──

function showTabGroupContextMenu(e, group) {
    hideContextMenu();
    const menu = document.createElement('div');
    menu.className = 'tab-group-context-menu';

    const renameItem = document.createElement('div');
    renameItem.className = 'context-menu-item';
    renameItem.textContent = 'Rename Group';
    renameItem.addEventListener('click', () => {
        _hideTabGroupContextMenu();
        renameTabGroup(group.id);
    });
    menu.appendChild(renameItem);

    const colorContainer = document.createElement('div');
    colorContainer.className = 'context-menu-item tab-group-color-picker-row';
    const colorLabel = document.createElement('span');
    colorLabel.textContent = 'Color';
    colorLabel.style.marginRight = 'auto';
    colorContainer.appendChild(colorLabel);
    const pickerWrap = document.createElement('div');
    pickerWrap.className = 'tab-group-color-picker';
    for (const c of TAB_GROUP_COLORS) {
        const swatch = document.createElement('div');
        swatch.className = `tab-group-color-swatch${c.id === group.color ? ' active' : ''}`;
        swatch.style.backgroundColor = c.value;
        swatch.title = c.label;
        swatch.addEventListener('click', (ev) => {
            ev.stopPropagation();
            _hideTabGroupContextMenu();
            setTabGroupColor(group.id, c.id);
        });
        pickerWrap.appendChild(swatch);
    }
    colorContainer.appendChild(pickerWrap);
    menu.appendChild(colorContainer);

    const div1 = document.createElement('div');
    div1.className = 'context-menu-divider';
    menu.appendChild(div1);

    const ungroupItem = document.createElement('div');
    ungroupItem.className = 'context-menu-item';
    ungroupItem.textContent = 'Ungroup';
    ungroupItem.addEventListener('click', () => {
        _hideTabGroupContextMenu();
        ungroupTabs(group.id);
    });
    menu.appendChild(ungroupItem);

    const closeGroupItem = document.createElement('div');
    closeGroupItem.className = 'context-menu-item context-menu-item-danger';
    closeGroupItem.textContent = 'Close Group';
    closeGroupItem.addEventListener('click', () => {
        _hideTabGroupContextMenu();
        closeTabGroup(group.id);
    });
    menu.appendChild(closeGroupItem);

    const div2 = document.createElement('div');
    div2.className = 'context-menu-divider';
    menu.appendChild(div2);

    const saveItem = document.createElement('div');
    saveItem.className = 'context-menu-item';
    saveItem.textContent = 'Save Group';
    saveItem.addEventListener('click', () => {
        _hideTabGroupContextMenu();
        saveTabGroupToSaved(group.id);
    });
    menu.appendChild(saveItem);

    _showContextMenuAt(menu, e);
}

// ── Saved Tab Group Context Menu (sidebar) ──

function showSavedTabGroupContextMenu(e, savedGroup) {
    hideContextMenu();
    const menu = document.createElement('div');
    menu.className = 'tab-group-context-menu';

    const restoreItem = document.createElement('div');
    restoreItem.className = 'context-menu-item';
    restoreItem.textContent = 'Restore';
    restoreItem.addEventListener('click', () => {
        _hideTabGroupContextMenu();
        restoreSavedTabGroup(savedGroup.id);
    });
    menu.appendChild(restoreItem);

    const renameItem = document.createElement('div');
    renameItem.className = 'context-menu-item';
    renameItem.textContent = 'Rename';
    renameItem.addEventListener('click', () => {
        _hideTabGroupContextMenu();
        renameSavedTabGroup(savedGroup.id);
    });
    menu.appendChild(renameItem);

    const divider = document.createElement('div');
    divider.className = 'context-menu-divider';
    menu.appendChild(divider);

    const deleteItem = document.createElement('div');
    deleteItem.className = 'context-menu-item context-menu-item-danger';
    deleteItem.textContent = 'Delete';
    deleteItem.addEventListener('click', async () => {
        _hideTabGroupContextMenu();
        const confirmed = await showConfirm('Delete Tab Group', `Delete saved tab group "${savedGroup.name}"? This cannot be undone.`, { confirmLabel: 'Delete', danger: true });
        if (confirmed) deleteSavedTabGroup(savedGroup.id);
    });
    menu.appendChild(deleteItem);

    _showContextMenuAt(menu, e);
}

// ── Create Tab Group from Active Tab (keyboard shortcut entry point) ──

async function createTabGroupFromActiveTab() {
    if (!activeTabId) return;
    const name = await showPromptDialog('New Tab Group', { placeholder: 'Group name', confirmLabel: 'Create' });
    if (name == null || name.trim() === '') return;
    createTabGroup(name.trim(), DEFAULT_GROUP_COLOR, [activeTabId]);
}

// ==================== VIDEO SCRUBBER ====================
function initVideoScrubber() {
    // Event listeners are now attached directly to cards in renderItems
    // This function is kept for compatibility but does nothing
}

function showGifScrubber(card, controller) {
    if (!controller || !card) return;
    if (typeof cardInfoSettings !== 'undefined' && !cardInfoSettings.duration) return;

    let timeLabel = card.querySelector('.video-time-label');
    if (!timeLabel) {
        timeLabel = document.createElement('div');
        timeLabel.className = 'video-time-label';
        card.appendChild(timeLabel);
    }

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

    const updateTimeDisplay = () => {
        if (!timeLabel || !card.contains(timeLabel)) return;
        const ctrl = card._gifScrubController;
        if (!ctrl) return;
        const pct = card._lastScrubPct || 0;
        const currentTime = pct * ctrl.duration;
        const duration = ctrl.duration;
        timeLabel.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
        if (progressFill && duration > 0) {
            progressFill.style.width = (pct * 100) + '%';
        }
    };

    updateTimeDisplay();
    card._updateTimeDisplay = updateTimeDisplay;
    timeLabel.classList.add('show');
    progressBar.classList.add('show');
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

// ==================== WORKSPACES ====================
// Save/restore full app state snapshots (tabs, zoom, sort, sidebar, filters, scroll).

const _workspaceMenu = document.getElementById('workspace-menu');
const _workspaceList = document.getElementById('workspace-list');
const _workspaceBtn  = document.getElementById('workspace-btn');
const _workspaceSaveBtn = document.getElementById('workspace-save-btn');
let _workspaceMenuOpen = false;

function _snapshotWorkspace() {
    // Serialize tabFolderScrollPositions (Map<tabId, Map<path, scrollTop>>) to plain object
    const scrollObj = {};
    const activeIdx = tabs.findIndex(t => t.id === activeTabId);
    for (const [tabId, pathMap] of tabFolderScrollPositions) {
        const tabIdx = tabs.findIndex(t => t.id === tabId);
        if (tabIdx < 0) continue;
        const pathObj = {};
        for (const [p, s] of pathMap) pathObj[p] = s;
        scrollObj[tabIdx] = pathObj;
    }

    return {
        schemaVersion: 1,
        tabs: tabs.map(t => ({
            path: t.path, name: t.name, collectionId: t.collectionId || null,
            sortType: t.sortType, sortOrder: t.sortOrder, groupId: t.groupId || null,
        })),
        activeTabIndex: activeIdx >= 0 ? activeIdx : 0,
        tabGroups: tabGroups.map(g => ({ name: g.name, color: g.color, collapsed: g.collapsed, originalId: g.id })),
        sidebarWidth,
        sidebarCollapsed,
        sidebarExpandedNodes: [...(sidebarExpandedNodes || [])],
        sidebarTabFilterActive: typeof sidebarTabFilterActive !== 'undefined' ? sidebarTabFilterActive : false,
        sidebarTabFilterFlat: typeof sidebarTabFilterFlat !== 'undefined' ? sidebarTabFilterFlat : false,
        globalZoomLevel,
        folderZoomPrefs: { ...folderZoomPrefs },
        folderSortPrefs: { ...folderSortPrefs },
        layoutMode,
        sortType,
        sortOrder,
        currentFilter,
        tabScrollPositions: scrollObj,
    };
}

async function saveWorkspace() {
    const name = await showPromptDialog('Save Workspace', { placeholder: 'Workspace name', confirmLabel: 'Save' });
    if (name == null || name.trim() === '') return;
    const snapshot = _snapshotWorkspace();
    try {
        const result = await window.electronAPI.dbSaveWorkspace(name.trim(), JSON.stringify(snapshot));
        if (result && result.ok) {
            showToast(`Workspace "${name.trim()}" saved`, 'success');
            _refreshWorkspaceList();
        } else {
            showToast(`Could not save workspace: ${result ? result.error : 'unknown'}`, 'error');
        }
    } catch (err) {
        showToast(`Could not save workspace: ${err.message}`, 'error');
    }
}

async function loadWorkspace(workspaceId) {
    let row;
    try {
        const result = await window.electronAPI.dbGetWorkspace(workspaceId);
        row = result && result.ok ? result.value : null;
    } catch { row = null; }
    if (!row || !row.data_json) { showToast('Workspace not found', 'error'); return; }

    let data;
    try { data = JSON.parse(row.data_json); } catch { showToast('Workspace data is corrupt', 'error'); return; }

    // Clean up existing tabs
    for (const t of tabs) _cleanupTabCaches(t.id);

    // Restore tab groups with new IDs
    const groupIdMap = {};
    tabGroups = [];
    if (Array.isArray(data.tabGroups)) {
        for (const g of data.tabGroups) {
            const newId = tabGroupIdCounter++;
            groupIdMap[g.originalId] = newId;
            tabGroups.push({ id: newId, name: g.name, color: g.color, collapsed: g.collapsed || false });
        }
    }

    // Restore tabs with new IDs
    tabs = [];
    let firstTabId = null;
    const newActiveIndex = data.activeTabIndex || 0;
    if (Array.isArray(data.tabs)) {
        for (let i = 0; i < data.tabs.length; i++) {
            const st = data.tabs[i];
            const newId = tabIdCounter++;
            const tab = {
                id: newId,
                path: st.path || null,
                name: st.name || 'Home',
                sortType: st.sortType || 'name',
                sortOrder: st.sortOrder || 'ascending',
                historyPaths: st.path ? [st.path] : [],
                historyIndex: st.path ? 0 : -1,
                collectionId: st.collectionId || null,
                groupId: st.groupId != null ? (groupIdMap[st.groupId] || null) : null,
            };
            tabs.push(tab);
            if (i === newActiveIndex) firstTabId = newId;

            // Restore scroll positions for this tab
            if (data.tabScrollPositions && data.tabScrollPositions[i]) {
                const map = new Map();
                for (const [p, s] of Object.entries(data.tabScrollPositions[i])) map.set(p, s);
                tabFolderScrollPositions.set(newId, map);
            }
        }
    }
    if (firstTabId == null && tabs.length > 0) firstTabId = tabs[0].id;

    // Restore sidebar
    if (data.sidebarWidth != null) {
        sidebarWidth = data.sidebarWidth;
        localStorage.setItem('sidebarWidth', String(sidebarWidth));
        const sidebar = document.getElementById('folder-sidebar');
        if (sidebar) sidebar.style.width = sidebarWidth + 'px';
    }
    if (data.sidebarCollapsed != null) setSidebarCollapsed(data.sidebarCollapsed);
    if (Array.isArray(data.sidebarExpandedNodes) && typeof sidebarExpandedNodes !== 'undefined') {
        sidebarExpandedNodes.clear();
        for (const p of data.sidebarExpandedNodes) sidebarExpandedNodes.add(p);
        saveSidebarExpandedNodes();
    }
    if (data.sidebarTabFilterActive != null && typeof sidebarTabFilterActive !== 'undefined') {
        sidebarTabFilterActive = data.sidebarTabFilterActive;
        localStorage.setItem('sidebarTabFilterActive', String(sidebarTabFilterActive));
    }
    if (data.sidebarTabFilterFlat != null && typeof sidebarTabFilterFlat !== 'undefined') {
        sidebarTabFilterFlat = data.sidebarTabFilterFlat;
        localStorage.setItem('sidebarTabFilterFlat', String(sidebarTabFilterFlat));
    }

    // Restore zoom
    if (data.globalZoomLevel != null) {
        globalZoomLevel = data.globalZoomLevel;
        zoomLevel = globalZoomLevel;
        if (zoomSlider) zoomSlider.value = zoomLevel;
        saveZoomLevel();
        applyZoom();
    }
    if (data.folderZoomPrefs) {
        folderZoomPrefs = { ...data.folderZoomPrefs };
        deferLocalStorageWrite('folderZoomPrefs', JSON.stringify(folderZoomPrefs));
    }

    // Restore sort
    if (data.folderSortPrefs) {
        folderSortPrefs = { ...data.folderSortPrefs };
        deferLocalStorageWrite('folderSortPrefs', JSON.stringify(folderSortPrefs));
    }
    if (data.sortType) { sortType = data.sortType; if (sortTypeSelect) sortTypeSelect.value = sortType; }
    if (data.sortOrder) { sortOrder = data.sortOrder; if (sortOrderSelect) sortOrderSelect.value = sortOrder; }

    // Restore layout
    if (data.layoutMode && data.layoutMode !== layoutMode) {
        layoutMode = data.layoutMode;
        if (layoutModeToggle) layoutModeToggle.checked = layoutMode === 'grid';
        deferLocalStorageWrite('layoutMode', layoutMode);
        if (typeof switchLayoutMode === 'function') switchLayoutMode();
    }

    // Restore filter
    if (data.currentFilter && typeof switchFilter === 'function') {
        switchFilter(data.currentFilter);
    }

    // Activate tabs
    saveTabs();
    renderTabs();
    if (firstTabId != null) switchToTab(firstTabId);
    if (typeof onTabsChanged === 'function') onTabsChanged();

    closeWorkspaceMenu();
    showToast(`Loaded workspace "${row.name}"`);
}

async function deleteWorkspace(workspaceId) {
    try {
        // Fetch for undo before deleting
        const getResult = await window.electronAPI.dbGetWorkspace(workspaceId);
        const row = getResult && getResult.ok ? getResult.value : null;

        const result = await window.electronAPI.dbDeleteWorkspace(workspaceId);
        if (result && result.ok) {
            _refreshWorkspaceList();
            showToast('Workspace deleted');
            if (row) {
                pushMetadataUndo('Delete workspace', async () => {
                    await window.electronAPI.dbSaveWorkspace(row.name, row.data_json);
                    _refreshWorkspaceList();
                });
            }
        }
    } catch (err) {
        showToast(`Could not delete: ${err.message}`, 'error');
    }
}

async function renameWorkspace(workspaceId) {
    const newName = await showPromptDialog('Rename Workspace', { placeholder: 'New name', confirmLabel: 'Rename' });
    if (newName == null || newName.trim() === '') return;
    try {
        const result = await window.electronAPI.dbRenameWorkspace(workspaceId, newName.trim());
        if (result && result.ok) {
            _refreshWorkspaceList();
            showToast(`Renamed to "${newName.trim()}"`);
        } else {
            showToast(`Rename failed: ${result ? result.error : 'unknown'}`, 'error');
        }
    } catch (err) {
        showToast(`Rename failed: ${err.message}`, 'error');
    }
}

async function overwriteWorkspace(workspaceId, name) {
    const snapshot = _snapshotWorkspace();
    try {
        const result = await window.electronAPI.dbUpdateWorkspace(workspaceId, name, JSON.stringify(snapshot));
        if (result && result.ok) {
            _refreshWorkspaceList();
            showToast(`Workspace "${name}" updated`);
        }
    } catch (err) {
        showToast(`Could not update: ${err.message}`, 'error');
    }
}

// ── Workspace Menu ──

function openWorkspaceMenu() {
    if (!_workspaceMenu) return;
    _workspaceMenuOpen = true;
    _workspaceMenu.classList.remove('hidden');
    _refreshWorkspaceList();
    // Close on outside click
    setTimeout(() => document.addEventListener('click', _workspaceMenuOutsideClick, true), 0);
}

function closeWorkspaceMenu() {
    if (!_workspaceMenu) return;
    _workspaceMenuOpen = false;
    _workspaceMenu.classList.add('hidden');
    document.removeEventListener('click', _workspaceMenuOutsideClick, true);
}

function toggleWorkspaceMenu() {
    _workspaceMenuOpen ? closeWorkspaceMenu() : openWorkspaceMenu();
}

function _workspaceMenuOutsideClick(e) {
    if (!_workspaceMenu.contains(e.target) && e.target !== _workspaceBtn && !_workspaceBtn.contains(e.target)) {
        closeWorkspaceMenu();
    }
}

async function _refreshWorkspaceList() {
    if (!_workspaceList) return;
    let workspaces = [];
    try {
        const result = await window.electronAPI.dbGetAllWorkspaces();
        if (result && result.ok) workspaces = result.value || [];
    } catch { /* empty list */ }

    if (workspaces.length === 0) {
        _workspaceList.innerHTML = '<div class="workspace-empty">No saved workspaces</div>';
        return;
    }

    let html = '';
    for (const ws of workspaces) {
        const date = new Date(ws.updated_at || ws.saved_at);
        const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        html += `<div class="workspace-item" data-id="${ws.id}">
            <div class="workspace-item-info" data-action="load" data-id="${ws.id}">
                <span class="workspace-item-name">${_escHtml(ws.name)}</span>
                <span class="workspace-item-date">${dateStr}</span>
            </div>
            <div class="workspace-item-actions">
                <button class="workspace-item-btn" data-action="overwrite" data-id="${ws.id}" data-name="${_escAttr(ws.name)}" title="Overwrite with current state">&#8635;</button>
                <button class="workspace-item-btn" data-action="rename" data-id="${ws.id}" title="Rename">&#9998;</button>
                <button class="workspace-item-btn workspace-item-delete" data-action="delete" data-id="${ws.id}" title="Delete">&times;</button>
            </div>
        </div>`;
    }
    _workspaceList.innerHTML = html;
}

function _escHtml(str) { const el = document.createElement('span'); el.textContent = str; return el.innerHTML; }
function _escAttr(str) { return str.replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

// Wire up button + delegation
if (_workspaceBtn) _workspaceBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleWorkspaceMenu(); });
if (_workspaceSaveBtn) _workspaceSaveBtn.addEventListener('click', () => { closeWorkspaceMenu(); saveWorkspace(); });
if (_workspaceList) _workspaceList.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    if (action === 'load') loadWorkspace(id);
    else if (action === 'rename') renameWorkspace(id);
    else if (action === 'delete') deleteWorkspace(id);
    else if (action === 'overwrite') overwriteWorkspace(id, btn.dataset.name);
});

// ==================== HOVER PREVIEW STRIP ====================
// Shows a filmstrip of 5 evenly-spaced keyframes at the bottom of video cards on hover.
// Frames are extracted lazily on first hover and cached both on disk (via main process)
// and in-memory (URL strings only) for instant repeat hovers.

const PREVIEW_STRIP_CACHE_MAX = 500;

function showPreviewStrip(card) {
    if (!hoverPreviewStripEnabled) return;
    if (card.querySelector('.hover-preview-strip')) return; // already showing

    const mediaType = card.dataset.mediaType;
    const isAnimated = mediaType !== 'video' && _isAnimatedCard(card);
    if (mediaType !== 'video' && !isAnimated) return;

    const filePath = card.dataset.path;
    const mtime = card.dataset.mtime || '0';
    const cacheKey = filePath + '|' + mtime;

    // Create the container immediately (invisible until populated)
    const strip = document.createElement('div');
    strip.className = 'hover-preview-strip';
    // Insert before .video-info so it appears above the filename label
    const info = card.querySelector('.video-info');
    if (info) {
        card.insertBefore(strip, info);
    } else {
        card.appendChild(strip);
    }

    // Fast path: in-memory cache hit (works for both video URLs and animated data URLs)
    if (_previewStripCache.has(cacheKey)) {
        _populateStrip(strip, _previewStripCache.get(cacheKey));
        return;
    }

    if (isAnimated) {
        // GIF/WebP: decode frames client-side via AnimatedImagePlaybackController
        _generateAnimatedStrip(card, strip, cacheKey);
    } else {
        // Video: extract frames via FFmpeg in main process
        _generateVideoStrip(card, strip, cacheKey, filePath);
    }
}

function _isAnimatedCard(card) {
    // Has a known GIF duration, or is a GIF/WebP by extension (not static WebP)
    if (card.dataset.gifDuration && Number(card.dataset.gifDuration) > 0) return true;
    if (card.dataset.isStaticWebp === 'true') return false;
    const src = (card.dataset.src || '').toLowerCase();
    return src.endsWith('.gif') || src.endsWith('.webp');
}

async function _generateAnimatedStrip(card, strip, cacheKey) {
    const FRAME_COUNT = 5;
    const mediaUrl = card.dataset.src;
    if (!mediaUrl) { strip.remove(); return; }

    try {
        const response = await fetch(mediaUrl);
        if (!card.isConnected || !card.contains(strip)) return;
        const buffer = await response.arrayBuffer();
        if (!card.isConnected || !card.contains(strip)) return;

        const ctrlCanvas = document.createElement('canvas');
        const controller = new AnimatedImagePlaybackController(ctrlCanvas, buffer);
        await controller.ready;

        if (!card.isConnected || !card.contains(strip)) {
            controller.destroy();
            return;
        }

        if (controller.frameCount < 2) {
            controller.destroy();
            if (strip.isConnected) strip.remove();
            return;
        }

        // Sample 5 evenly-spaced frames and convert to data URLs
        const dataUrls = [];
        for (let i = 0; i < FRAME_COUNT; i++) {
            const frameIdx = Math.floor((i + 0.5) * controller.frameCount / FRAME_COUNT);
            const frameCanvas = controller.getFrameAtIndex(frameIdx);
            if (frameCanvas) {
                // Draw to a small thumbnail canvas
                const thumb = document.createElement('canvas');
                const scale = Math.min(1, 120 / Math.max(frameCanvas.width, frameCanvas.height));
                thumb.width = Math.round(frameCanvas.width * scale);
                thumb.height = Math.round(frameCanvas.height * scale);
                const ctx = thumb.getContext('2d');
                ctx.drawImage(frameCanvas, 0, 0, thumb.width, thumb.height);
                dataUrls.push(thumb.toDataURL('image/jpeg', 0.7));
            }
        }
        controller.destroy();

        if (dataUrls.length > 0) {
            // LRU eviction
            if (_previewStripCache.size > PREVIEW_STRIP_CACHE_MAX) {
                const iter = _previewStripCache.keys();
                for (let i = 0; i < Math.floor(PREVIEW_STRIP_CACHE_MAX / 2); i++) {
                    _previewStripCache.delete(iter.next().value);
                }
            }
            _previewStripCache.set(cacheKey, dataUrls);
            if (card.isConnected && card.contains(strip)) {
                _populateStrip(strip, dataUrls);
            }
        } else {
            if (strip.isConnected) strip.remove();
        }
    } catch {
        if (strip.isConnected) strip.remove();
    }
}

function _generateVideoStrip(card, strip, cacheKey, filePath) {
    // Deduplicate in-flight IPC calls for the same video
    let pending = _previewStripPending.get(cacheKey);
    if (!pending) {
        pending = window.electronAPI.generatePreviewStrip(filePath);
        _previewStripPending.set(cacheKey, pending);
    }

    pending.then(result => {
        _previewStripPending.delete(cacheKey);
        if (result && result.ok && result.value && result.value.urls && result.value.urls.length > 0) {
            // LRU eviction for in-memory cache
            if (_previewStripCache.size > PREVIEW_STRIP_CACHE_MAX) {
                const iter = _previewStripCache.keys();
                for (let i = 0; i < Math.floor(PREVIEW_STRIP_CACHE_MAX / 2); i++) {
                    _previewStripCache.delete(iter.next().value);
                }
            }
            _previewStripCache.set(cacheKey, result.value.urls);
            // Card may have been recycled or mouse left while we waited
            if (card.isConnected && card.contains(strip)) {
                _populateStrip(strip, result.value.urls);
            }
        } else {
            if (strip.isConnected) strip.remove();
        }
    }).catch(() => {
        _previewStripPending.delete(cacheKey);
        if (strip.isConnected) strip.remove();
    });
}

function _populateStrip(strip, urls) {
    for (const url of urls) {
        const img = document.createElement('img');
        img.className = 'hover-preview-frame';
        img.src = url;
        img.draggable = false;
        strip.appendChild(img);
    }
    // Trigger fade-in after a frame so the CSS transition fires
    requestAnimationFrame(() => {
        if (strip.isConnected) strip.classList.add('visible');
    });
}

function hidePreviewStrip(card) {
    if (!card) return;
    const strip = card.querySelector('.hover-preview-strip');
    if (strip) strip.remove();
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
        globalZoomLevel = parseInt(savedZoom, 10);
    }
    zoomLevel = globalZoomLevel;
    zoomSlider.value = zoomLevel;
    zoomValue.textContent = `${zoomLevel}%`;
    applyZoom();

    // Wire decouple button
    const btn = document.getElementById('zoom-decouple-btn');
    if (btn) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFolderZoomDecouple();
        });
    }
    updatePerFolderZoomButton();
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
    if (vsState.enabled) {
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
    if (vsState.enabled && vsState.sortedItems.length > 0) {
        return vsState.sortedItems
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
    // When similar-nav override is active, keep using it — don't fall back to folder
    if ((!lightboxItems || lightboxItems.length === 0) && !lightboxItemsOverride) {
        lightboxItems = getFilteredMediaItems();
    }
    if (!lightboxItems || lightboxItems.length === 0) return;

    const newIdx = (direction === 'next')
        ? (currentLightboxIndex + 1) % lightboxItems.length
        : (currentLightboxIndex - 1 + lightboxItems.length) % lightboxItems.length;

    const item = lightboxItems[newIdx];
    if (!item) return;
    // Pass the pre-computed index as a hint so openLightbox doesn't need to path-lookup
    _lightboxNextIndexHint = newIdx;
    openLightbox(item.url, item.path, item.name);
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
        const _pisRes = await window.electronAPI.getPluginInfoSections();
        _pluginInfoSections = _pisRes && _pisRes.ok ? (_pisRes.value || []) : [];
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
            if (!res || !res.ok) {
                if (res && res.error) {
                    showToastOnce(`plugin-info-err:${section.pluginId}:${section.id}`,
                        `Plugin "${section.pluginId}" failed to render info section`, 'warning',
                        { details: res.error, duration: 5000 });
                }
                continue;
            }
            if (!res.value) continue;
            const { title, html, actions } = res.value;
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
            showToastOnce(`plugin-info-err:${section.pluginId}:${section.id}`,
                `Plugin "${section.pluginId}" encountered an error`, 'warning',
                { details: err.message, duration: 5000 });
        }
    }
}

// ==================== LINKED DUPLICATES ====================
// Non-destructive dual-layer metadata: per-file (existing) + per-hash (shared overlay).
// When _linkedDuplicatesEnabled is true, hash-keyed metadata takes precedence.

let _linkedDuplicatesEnabled = false;
let _hashRatings = {};       // hash → rating (shared layer)
let _hashPins = {};          // hash → true (shared layer)
let _pathToHash = {};        // normalizedPath → exact_hash
let _hashToPaths = {};       // hash → [path, ...] (only groups with 2+ members)

function isLinkedDuplicatesEnabled() { return _linkedDuplicatesEnabled; }

function getPathHash(filePath) {
    if (!filePath) return null;
    return _pathToHash[normalizePath(filePath)] || null;
}

/** Get all sibling paths (same hash, excluding self). Synchronous, uses in-memory index. */
function _getSiblingPathsSync(filePath) {
    const hash = getPathHash(filePath);
    if (!hash || !_hashToPaths[hash]) return [];
    const np = normalizePath(filePath);
    return _hashToPaths[hash].filter(p => normalizePath(p) !== np);
}

/**
 * At init, _rebuildLinkedIndex only covers groups of 2+. Files that were rated/pinned
 * via the hash layer but have no duplicate won't be in _pathToHash yet.
 * Fetch paths for every hash in _hashRatings / _hashPins so they can be resolved.
 */
async function _resolveHashedPathsAtInit() {
    const hashes = new Set([
        ...Object.keys(_hashRatings),
        ...Object.keys(_hashPins)
    ]);
    if (hashes.size === 0) return;
    // Filter to hashes not already fully covered in _pathToHash
    const missing = [];
    for (const h of hashes) {
        if (!_hashToPaths[h]) missing.push(h);
    }
    if (missing.length === 0) return;
    // Single batch IPC call instead of N individual calls
    try {
        const result = await window.electronAPI.dbGetPathsByHashes(missing);
        if (result && result.ok && result.value) {
            for (const [h, paths] of Object.entries(result.value)) {
                for (const p of paths) {
                    _pathToHash[normalizePath(p)] = h;
                }
                if (paths.length >= 2) {
                    _hashToPaths[h] = paths.map(p => normalizePath(p));
                }
            }
        }
    } catch { /* ignore */ }
}

/** Build _pathToHash and _hashToPaths from duplicate groups object. */
function _rebuildLinkedIndex(duplicateGroups) {
    _pathToHash = {};
    _hashToPaths = {};
    if (!duplicateGroups) return;
    for (const [hash, paths] of Object.entries(duplicateGroups)) {
        if (!paths || paths.length < 2) continue;
        _hashToPaths[hash] = paths;
        for (const p of paths) {
            _pathToHash[normalizePath(p)] = hash;
        }
    }
}

/** Merge fresh path-to-hash data (from auto-hash) into the in-memory index.
 *  O(n + k) where n = incoming entries, k = existing group members for affected hashes. */
function _mergePathToHash(pathToHashMap) {
    if (!pathToHashMap) return;

    // Group incoming paths by hash
    const newPathsByHash = {};
    for (const [p, hash] of Object.entries(pathToHashMap)) {
        if (!hash) continue;
        const np = normalizePath(p);
        const oldHash = _pathToHash[np];
        _pathToHash[np] = hash;

        // Collect new paths per hash for the merge below
        (newPathsByHash[hash] ||= new Set()).add(np);

        // If this path moved from one hash to another, clean up the old group
        if (oldHash && oldHash !== hash && _hashToPaths[oldHash]) {
            _hashToPaths[oldHash] = _hashToPaths[oldHash].filter(x => x !== np);
            if (_hashToPaths[oldHash].length < 2) delete _hashToPaths[oldHash];
        }
    }

    // For each affected hash, merge new paths with existing _hashToPaths entries
    for (const [hash, newPaths] of Object.entries(newPathsByHash)) {
        const existing = _hashToPaths[hash] ? new Set(_hashToPaths[hash]) : new Set();
        for (const np of newPaths) existing.add(np);
        if (existing.size >= 2) {
            _hashToPaths[hash] = [...existing];
        } else {
            delete _hashToPaths[hash];
        }
    }
}

/** Effective rating considering linked duplicates overlay. */
function getEffectiveRating(filePath) {
    if (_linkedDuplicatesEnabled) {
        const hash = getPathHash(filePath);
        if (hash && hash in _hashRatings) return _hashRatings[hash];
    }
    return getFileRating(filePath);
}

/** Effective pinned status considering linked duplicates overlay. */
function isEffectivelyPinned(filePath) {
    if (_linkedDuplicatesEnabled) {
        const hash = getPathHash(filePath);
        if (hash && hash in _hashPins) return _hashPins[hash];
    }
    return isFilePinned(filePath);
}

/**
 * Build a resolved ratings map for the filter worker.
 * When linked duplicates is enabled, hash ratings override per-path ratings.
 * Iterates ALL paths in _pathToHash so every hashed file (not just duplicates) is covered.
 */
function buildResolvedRatings() {
    if (!_linkedDuplicatesEnabled || Object.keys(_hashRatings).length === 0) return fileRatings;
    const resolved = Object.assign({}, fileRatings);
    for (const [np, hash] of Object.entries(_pathToHash)) {
        const hr = _hashRatings[hash];
        if (hr !== undefined && hr > 0) resolved[np] = hr;
    }
    return resolved;
}

/**
 * Build a resolved pins set for the filter worker.
 * When linked duplicates is enabled, hash pins override per-path pins.
 */
function buildResolvedPins() {
    if (!_linkedDuplicatesEnabled || Object.keys(_hashPins).length === 0) return pinnedFiles;
    const resolved = Object.assign({}, pinnedFiles);
    for (const [np, hash] of Object.entries(_pathToHash)) {
        if (hash in _hashPins) resolved[np] = true;
    }
    return resolved;
}

/** Trigger auto-hashing for the current folder's files, then update the linked index. */
async function autoHashCurrentFolder(items) {
    if (!_linkedDuplicatesEnabled) return;
    const filePaths = [];
    for (const item of items) {
        if (item.type !== 'folder' && item.path) filePaths.push(item.path);
    }
    if (filePaths.length === 0) return;
    try {
        const result = await window.electronAPI.autoHashFolder(filePaths);
        if (result && result.ok && result.value) {
            _mergePathToHash(result.value);
            // _pathToHash changed — resolved ratings/pins depend on it, so force re-sync
            if (typeof bumpFilterWorkerRatingsVersion === 'function') bumpFilterWorkerRatingsVersion();
            if (typeof bumpFilterWorkerPinsVersion === 'function') bumpFilterWorkerPinsVersion();
            if (typeof bumpFilterWorkerDedupVersion === 'function') bumpFilterWorkerDedupVersion();
            if (typeof applyFilters === 'function') applyFilters();
        }
    } catch (e) {
        console.warn('[linked-duplicates] auto-hash failed:', e);
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

    // Linked duplicates: write to hash layer and update all sibling cards
    if (_linkedDuplicatesEnabled) {
        const hash = getPathHash(filePath);
        if (hash) {
            const prevHash = _hashRatings[hash] || 0;
            if (rating === 0) {
                delete _hashRatings[hash];
            } else {
                _hashRatings[hash] = rating;
            }
            window.electronAPI.dbSetHashRating(hash, rating).then(r => {
                if (r && !r.ok) showToast(`Could not save linked rating: ${friendlyError(r.error)}`, 'error');
            }).catch(err => showToast(`Could not save linked rating: ${friendlyError(err)}`, 'error'));
            // Update cards for all siblings + self
            const siblings = _getSiblingPathsSync(filePath);
            updateCardRating(filePath, rating);
            for (const p of siblings) updateCardRating(p, rating);
            if (typeof bumpFilterWorkerRatingsVersion === 'function') bumpFilterWorkerRatingsVersion();
            if (window.CG && window.CG.isEnabled()) window.CG.scheduleRender();
            if (prevHash !== rating) {
                pushMetadataUndo(
                    `Rating ${rating || 0} (linked)`,
                    () => {
                        if (prevHash === 0) delete _hashRatings[hash];
                        else _hashRatings[hash] = prevHash;
                        window.electronAPI.dbSetHashRating(hash, prevHash);
                        updateCardRating(filePath, prevHash);
                        for (const p of siblings) updateCardRating(p, prevHash);
                        if (typeof bumpFilterWorkerRatingsVersion === 'function') bumpFilterWorkerRatingsVersion();
                        if (window.CG && window.CG.isEnabled()) window.CG.scheduleRender();
                    }
                );
            }
            return;
        }
    }

    // Per-path fallback (original behavior)
    const prev = getFileRating(filePath);
    // Store with both original and normalized path for consistent lookups
    fileRatings[filePath] = rating;
    const normalizedPath = normalizePath(filePath);
    if (normalizedPath !== filePath) {
        fileRatings[normalizedPath] = rating;
    }
    if (typeof bumpFilterWorkerRatingsVersion === 'function') bumpFilterWorkerRatingsVersion();
    // Persist to SQLite — in-memory is already updated; surface errors via toast
    window.electronAPI.dbSetRating(normalizedPath, rating).then(r => {
        if (r && !r.ok) showToast(`Could not save rating: ${friendlyError(r.error)}`, 'error');
    }).catch(err => {
        showToast(`Could not save rating: ${friendlyError(err)}`, 'error');
    });

    // Update all cards with the same path immediately - use updateCardRating which calls updateCardStars
    updateCardRating(filePath, rating);
    // Canvas grid: schedule redraw so the star row updates on canvas-rendered cards
    if (window.CG && window.CG.isEnabled()) window.CG.scheduleRender();

    // Push onto metadata undo stack unless we're *doing* an undo right now
    if (prev !== rating) {
        pushMetadataUndo(
            `Rating ${rating || 0} \u2192 ${prev || 0}`,
            () => setFileRating(filePath, prev)
        );
    }
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
        if (result.ok && result.value) {
            fileRatings = result.value;
            if (typeof bumpFilterWorkerRatingsVersion === 'function') bumpFilterWorkerRatingsVersion();
        }
    } catch (error) {
        console.error('Error loading ratings:', error);
        fileRatings = {};
        if (typeof bumpFilterWorkerRatingsVersion === 'function') bumpFilterWorkerRatingsVersion();
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

    // Linked duplicates: write to hash layer
    if (_linkedDuplicatesEnabled) {
        const hash = getPathHash(filePath);
        if (hash) {
            const prevPinned = !!(hash in _hashPins && _hashPins[hash]);
            if (pinned) {
                _hashPins[hash] = true;
            } else {
                delete _hashPins[hash];
            }
            window.electronAPI.dbSetHashPinned(hash, pinned);
            if (typeof bumpFilterWorkerPinsVersion === 'function') bumpFilterWorkerPinsVersion();
            if (window.CG && window.CG.isEnabled()) window.CG.scheduleRender();
            if (prevPinned !== pinned) {
                const name = filePath.split(/[\\/]/).pop();
                pushMetadataUndo(
                    pinned ? `Pin "${name}" (linked)` : `Unpin "${name}" (linked)`,
                    () => {
                        if (prevPinned) _hashPins[hash] = true; else delete _hashPins[hash];
                        window.electronAPI.dbSetHashPinned(hash, prevPinned);
                        if (typeof bumpFilterWorkerPinsVersion === 'function') bumpFilterWorkerPinsVersion();
                        if (typeof applySorting === 'function') applySorting();
                    }
                );
            }
            return;
        }
    }

    // Per-path fallback (original behavior)
    const prev = isFilePinned(filePath);
    const normalizedPath = normalizePath(filePath);
    if (pinned) {
        pinnedFiles[filePath] = true;
        if (normalizedPath !== filePath) pinnedFiles[normalizedPath] = true;
    } else {
        delete pinnedFiles[filePath];
        if (normalizedPath !== filePath) delete pinnedFiles[normalizedPath];
    }
    if (typeof bumpFilterWorkerPinsVersion === 'function') bumpFilterWorkerPinsVersion();
    // Persist to SQLite (fire-and-forget)
    window.electronAPI.dbSetPinned(normalizedPath, pinned);
    // Canvas grid: pin bar state changed, redraw affected card(s)
    if (window.CG && window.CG.isEnabled()) window.CG.scheduleRender();

    // Push onto metadata undo stack
    if (prev !== pinned) {
        const name = filePath.split(/[\\/]/).pop();
        pushMetadataUndo(
            pinned ? `Pin "${name}"` : `Unpin "${name}"`,
            () => { setFilePinned(filePath, prev); applySorting(); }
        );
    }
}

function savePins() {
    // Legacy: kept as no-op for any stale call sites
}

async function loadPins() {
    try {
        const result = await window.electronAPI.dbGetAllPinned();
        if (result.ok && result.value) {
            pinnedFiles = result.value;
            if (typeof bumpFilterWorkerPinsVersion === 'function') bumpFilterWorkerPinsVersion();
        }
    } catch (error) {
        console.error('Error loading pins:', error);
        pinnedFiles = {};
        if (typeof bumpFilterWorkerPinsVersion === 'function') bumpFilterWorkerPinsVersion();
    }
}

// Batched init data loader — single IPC round-trip for ratings + pins + favorites + recent files.
// Falls back to individual calls if the batched endpoint isn't available.
async function loadInitDataBatched() {
    try {
        if (window.electronAPI.dbGetInitData) {
            const result = await window.electronAPI.dbGetInitData(recentFilesLimitSetting);
            if (result.ok && result.value) {
                const { ratings, pinned, favorites: favData, recent, hashRatings, hashPins, duplicateGroups } = result.value;

                if (ratings) {
                    fileRatings = ratings;
                    if (typeof bumpFilterWorkerRatingsVersion === 'function') bumpFilterWorkerRatingsVersion();
                }
                if (pinned) {
                    pinnedFiles = pinned;
                    if (typeof bumpFilterWorkerPinsVersion === 'function') bumpFilterWorkerPinsVersion();
                }
                hydrateFavorites(favData);
                hydrateRecentFiles(recent);

                // Linked duplicates: hydrate hash metadata + index
                if (hashRatings) _hashRatings = hashRatings;
                if (hashPins) _hashPins = hashPins;
                if (duplicateGroups) _rebuildLinkedIndex(duplicateGroups);
                _linkedDuplicatesEnabled = localStorage.getItem('linkedDuplicates') === 'true';
                if (_linkedDuplicatesEnabled) {
                    if (typeof bumpFilterWorkerDedupVersion === 'function') bumpFilterWorkerDedupVersion();
                    // Ensure _pathToHash covers all files with hash ratings/pins
                    // (duplicateGroups only has groups of 2+; single rated files would be missing)
                    _resolveHashedPathsAtInit();
                }
                return;
            }
        }
    } catch (e) {
        console.warn('Batched init data failed, falling back to individual calls:', e);
    }
    await Promise.all([loadFavorites(), loadRecentFiles(), loadRatings(), loadPins()]);
}

function updateCardRating(filePath, rating) {
    // Canvas grid: no DOM cards to update; CG.scheduleRender() is called by the rating setter
    if (window.CG && window.CG.isEnabled()) return;
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

// Advanced search — saved presets
const SAVED_SEARCHES_KEY = 'savedSearches';

function getSavedSearches() {
    try {
        const raw = localStorage.getItem(SAVED_SEARCHES_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

function writeSavedSearches(list) {
    localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(list));
}

function captureAdvancedSearchForm() {
    return {
        sizeOperator: document.getElementById('search-size-operator')?.value || '',
        sizeValue: document.getElementById('search-size-value')?.value || '',
        dateFrom: document.getElementById('search-date-from')?.value || '',
        dateTo: document.getElementById('search-date-to')?.value || '',
        width: document.getElementById('search-width')?.value || '',
        height: document.getElementById('search-height')?.value || '',
        aspectRatio: document.getElementById('search-aspect-ratio')?.value || '',
        starRating: document.getElementById('search-star-rating')?.value || '',
        recursive: document.getElementById('search-recursive')?.checked || false,
        advancedSort: document.getElementById('advanced-sort-type')?.value || ''
    };
}

function applyAdvancedSearchForm(form) {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    set('search-size-operator', form.sizeOperator);
    set('search-size-value', form.sizeValue);
    set('search-date-from', form.dateFrom);
    set('search-date-to', form.dateTo);
    set('search-width', form.width);
    set('search-height', form.height);
    set('search-aspect-ratio', form.aspectRatio);
    set('search-star-rating', form.starRating);
    const recCb = document.getElementById('search-recursive');
    if (recCb) recCb.checked = !!form.recursive;
    set('advanced-sort-type', form.advancedSort);
}

function renderSavedSearchChips() {
    const container = document.getElementById('saved-search-chips');
    if (!container) return;
    const presets = getSavedSearches();
    container.innerHTML = '';
    for (const preset of presets) {
        const chip = document.createElement('span');
        chip.className = 'saved-search-chip';
        chip.title = 'Click to load this preset';
        chip.dataset.name = preset.name;
        chip.textContent = preset.name;
        const del = document.createElement('button');
        del.className = 'saved-search-chip-delete';
        del.title = 'Delete preset';
        del.textContent = '\u00D7';
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            const list = getSavedSearches().filter(p => p.name !== preset.name);
            writeSavedSearches(list);
            renderSavedSearchChips();
        });
        chip.appendChild(del);
        chip.addEventListener('click', () => {
            applyAdvancedSearchForm(preset.form);
            applyAdvancedSearch();
        });
        container.appendChild(chip);
    }
}

function saveCurrentAdvancedSearch() {
    const inline = document.getElementById('save-preset-inline');
    const input = document.getElementById('save-preset-name');
    if (!inline || !input) return;
    inline.classList.remove('hidden');
    input.value = '';
    input.focus();
}

function confirmSavePreset() {
    const input = document.getElementById('save-preset-name');
    if (!input) return;
    const name = (input.value || '').trim();
    if (!name) { input.focus(); return; }
    const form = captureAdvancedSearchForm();
    const list = getSavedSearches().filter(p => p.name !== name);
    list.push({ name, form });
    writeSavedSearches(list);
    renderSavedSearchChips();
    showToast(`Saved filter "${name}"`, 'success');
    cancelSavePreset();
}

function cancelSavePreset() {
    const inline = document.getElementById('save-preset-inline');
    const input = document.getElementById('save-preset-name');
    if (inline) inline.classList.add('hidden');
    if (input) input.value = '';
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

    for (const id of [
        'search-size-operator', 'search-size-value', 'search-date-from',
        'search-date-to', 'search-width', 'search-height',
        'search-aspect-ratio', 'search-star-rating'
    ]) {
        const el = document.getElementById(id);
        if (el) el.value = '';
    }

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
        if (result.ok) {
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
            if (result.ok && result.value && result.value.status === 'conflict') {
                const resolution = savedResolution
                    || (await showFileConflictDialog(result.value.fileName, filePath, result.value.destPath, i < filePaths.length - 1));
                if (resolution.applyToAll) savedResolution = resolution;
                result = await window.electronAPI.moveFile(filePath, destFolder, fileName, resolution.resolution);
            }
            if (result.ok && result.value && result.value.status !== 'skipped') {
                success++;
            } else if (!result.ok) {
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
            if (result.ok && result.value) {
                const date = new Date(result.value.modified);
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
        if (result.ok) {
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
                    renderSavedSearchChips();
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

    const saveAdvancedSearchBtn = document.getElementById('save-advanced-search');
    if (saveAdvancedSearchBtn) {
        saveAdvancedSearchBtn.addEventListener('click', saveCurrentAdvancedSearch);
    }
    const savePresetConfirm = document.getElementById('save-preset-confirm');
    const savePresetCancel = document.getElementById('save-preset-cancel');
    const savePresetInput = document.getElementById('save-preset-name');
    if (savePresetConfirm) savePresetConfirm.addEventListener('click', confirmSavePreset);
    if (savePresetCancel) savePresetCancel.addEventListener('click', cancelSavePreset);
    if (savePresetInput) {
        savePresetInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); confirmSavePreset(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancelSavePreset(); }
        });
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
        organizeByDateBtn.addEventListener('click', async () => {
            const count = currentItems.filter(i => i.type !== 'folder').length;
            if (!count) return;
            const confirmed = await showConfirm(
                'Organize by Date',
                `Move ${count} file${count === 1 ? '' : 's'} into date-based folders?`,
                { confirmLabel: 'Organize' }
            );
            if (!confirmed) return;
            if (organizeDialog) organizeDialog.classList.add('hidden');
            organizeByDate();
        });
    }

    if (organizeByTypeBtn) {
        organizeByTypeBtn.addEventListener('click', async () => {
            const count = currentItems.filter(i => i.type !== 'folder').length;
            if (!count) return;
            const confirmed = await showConfirm(
                'Organize by Type',
                `Move ${count} file${count === 1 ? '' : 's'} into type-based folders?`,
                { confirmLabel: 'Organize' }
            );
            if (!confirmed) return;
            if (organizeDialog) organizeDialog.classList.add('hidden');
            organizeByType();
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
    let _watcherNavTimer = null; // debounce watcher-triggered re-navigation
    window.electronAPI.onFolderChanged((event, data) => {
        if (!currentFolderPath) return;
        // Ignore the initial burst of events from the watcher being set up after navigation.
        // The scan just completed — there's nothing to refresh yet.
        if (_lastNavCompleteTime && (Date.now() - _lastNavCompleteTime) < 1000) return;

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
                
                // If we're currently viewing that subfolder, refresh it (debounced)
                const normalizedSubfolderPath = normalizePath(subfolderPath).toLowerCase();
                if (normalizedSubfolderPath === normalizedCurrentPath) {
                    clearTimeout(_watcherNavTimer);
                    _watcherNavTimer = setTimeout(() => {
                        _watcherNavTimer = null;
                        navigateToFolder(currentFolderPath, false, true); // forceReload = true
                    }, 300);
                    return; // Don't refresh parent if we're already refreshing the subfolder
                }
            }
            
            // Refresh current folder (parent) to show newly created/modified/deleted files
            // Debounced to coalesce burst events (git checkout, bulk file ops)
            clearTimeout(_watcherNavTimer);
            _watcherNavTimer = setTimeout(() => {
                _watcherNavTimer = null;
                navigateToFolder(currentFolderPath, false, true); // forceReload = true
            }, 300);
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
            } else if (matchesShortcut(e, 'lb_markIn')) {
                e.preventDefault();
                markLoopIn();
            } else if (matchesShortcut(e, 'lb_markOut')) {
                e.preventDefault();
                markLoopOut();
            } else if (matchesShortcut(e, 'lb_clearMarks')) {
                e.preventDefault();
                clearLoopMarks();
            } else if (matchesShortcut(e, 'lb_rotateLeft')) {
                e.preventDefault();
                if (typeof applyLightboxRotation === 'function') applyLightboxRotation(-90);
            } else if (matchesShortcut(e, 'lb_rotateRight')) {
                e.preventDefault();
                if (typeof applyLightboxRotation === 'function') applyLightboxRotation(90);
            } else if (matchesShortcut(e, 'lb_flipH')) {
                e.preventDefault();
                if (typeof toggleLightboxFlip === 'function') {
                    toggleLightboxFlip('horizontal');
                    document.getElementById('lightbox-flip-h-btn')?.classList.toggle('active', currentLightboxFlipH);
                    document.getElementById('lb-tf-flip-h')?.classList.toggle('active', currentLightboxFlipH);
                }
            } else if (matchesShortcut(e, 'lb_flipV')) {
                e.preventDefault();
                if (typeof toggleLightboxFlip === 'function') {
                    toggleLightboxFlip('vertical');
                    document.getElementById('lightbox-flip-v-btn')?.classList.toggle('active', currentLightboxFlipV);
                    document.getElementById('lb-tf-flip-v')?.classList.toggle('active', currentLightboxFlipV);
                }
            } else if (matchesShortcut(e, 'lb_cropImage')) {
                e.preventDefault();
                if (typeof enterLightboxCropMode === 'function') enterLightboxCropMode();
            } else if (matchesShortcut(e, 'lb_saveFrame')) {
                e.preventDefault();
                saveCurrentFrame(e.shiftKey);
            } else if (matchesShortcut(e, 'lb_exportTrim')) {
                e.preventDefault();
                exportTrim();
            } else if (matchesShortcut(e, 'lb_toggleInspector')) {
                e.preventDefault();
                toggleInspectorPanel();
            }
        }
    });
}

// openLightbox already updated above to track current index

// Hook into navigateToFolder to start watching (will be called after navigation completes)
// This is handled in the navigateToFolder function itself

// → duplicate-detection.js
// ==================== COMPARISON LIGHTBOX ====================

let compareGroup = null;
let compareGroupIdx = -1;
let compareLeftIndex = 0;
let compareRightIndex = 1;
let compareShowAll = false;
let compareSliderPosition = 50;
let compareSliderRAF = null;

// Blend & Diff state for duplicate compare
let dcBlendMode = false;
let dcBlendOpacity = 0.5;
let dcBlendMixMode = 'normal';
let dcDiffMode = false;
let dcDiffAmplify = 1;

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
    if (dcBlendMode || dcDiffMode) return;
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

    // Reset blend/diff state
    dcBlendMode = false;
    dcDiffMode = false;
    dcBlendOpacity = 0.5;
    dcBlendMixMode = 'normal';
    dcDiffAmplify = 1;
    const dcOpacitySlider = document.getElementById('dc-blend-opacity');
    if (dcOpacitySlider) dcOpacitySlider.value = 50;
    const dcMixSelect = document.getElementById('dc-blend-mix-mode');
    if (dcMixSelect) dcMixSelect.value = 'normal';
    const dcAmpSlider = document.getElementById('dc-diff-amplify');
    if (dcAmpSlider) dcAmpSlider.value = 1;
    const dcAmpLabel = document.getElementById('dc-diff-amplify-value');
    if (dcAmpLabel) dcAmpLabel.textContent = '1x';

    const lightbox = document.getElementById('duplicate-compare-lightbox');
    if (!lightbox) return;
    const title = document.getElementById('compare-lightbox-title');
    const closeBtn = document.getElementById('compare-lightbox-close');
    const showAllBtn = document.getElementById('compare-show-all-btn');
    if (!title || !closeBtn || !showAllBtn) return;

    title.textContent = `Compare \u2014 Group ${groupIdx + 1} (${group.files.length} files)`;
    lightbox.classList.remove('hidden');
    compareShowAll = true;
    showAllBtn.classList.add('active');
    const showAllSpan = showAllBtn.querySelector('span');
    if (showAllSpan) showAllSpan.textContent = 'Compare';

    // Hide blend/diff buttons in show-all mode
    updateDcBlendDiffVisibility(false);

    // Start in show-all mode
    const body = lightbox.querySelector('.compare-lightbox-body');
    const grid = document.getElementById('compare-show-all-grid');
    if (body) body.classList.add('hidden');
    if (grid) grid.classList.remove('hidden');
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
    exitDcBlendMode();
    exitDcDiffMode();
    updateDcBlendDiffVisibility(false);

    const lightbox = document.getElementById('duplicate-compare-lightbox');
    if (!lightbox) return;
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
        e.preventDefault();
        closeComparisonLightbox();
        e.stopPropagation();
    } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        toggleCompareShowAll();
    } else if ((e.key === 'b' || e.key === 'B') && !compareShowAll) {
        e.preventDefault();
        if (dcBlendMode) exitDcBlendMode();
        else { exitDcDiffMode(); enterDcBlendMode(); }
    } else if ((e.key === 'd' || e.key === 'D') && !compareShowAll) {
        e.preventDefault();
        if (dcDiffMode) exitDcDiffMode();
        else { exitDcBlendMode(); enterDcDiffMode(); }
    } else if (e.shiftKey && e.key === 'ArrowLeft' && !dcBlendMode && !dcDiffMode) {
        compareSliderPosition = Math.max(0, compareSliderPosition - 5);
        applySliderPosition(compareSliderPosition);
        e.preventDefault();
    } else if (e.shiftKey && e.key === 'ArrowRight' && !dcBlendMode && !dcDiffMode) {
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

    // Exit blend/diff when switching views
    exitDcBlendMode();
    exitDcDiffMode();

    compareShowAll = !compareShowAll;
    const showAllBtn = document.getElementById('compare-show-all-btn');
    showAllBtn.classList.toggle('active', compareShowAll);
    showAllBtn.querySelector('span').textContent = compareShowAll ? 'Compare' : 'Show All';
    const body = lightbox.querySelector('.compare-lightbox-body');
    const grid = document.getElementById('compare-show-all-grid');
    if (compareShowAll) {
        body.classList.add('hidden');
        grid.classList.remove('hidden');
        updateDcBlendDiffVisibility(false);
        renderShowAllGrid();
    } else {
        body.classList.remove('hidden');
        grid.classList.add('hidden');
        updateDcBlendDiffVisibility(true);
        renderComparisonView();
    }
}

function navigateComparePane(side, direction) {
    if (!compareGroup) return;
    const wasBlend = dcBlendMode;
    const wasDiff = dcDiffMode;
    exitDcBlendMode();
    exitDcDiffMode();

    const len = compareGroup.length;
    if (side === 'left') {
        compareLeftIndex = (compareLeftIndex + direction + len) % len;
    } else {
        compareRightIndex = (compareRightIndex + direction + len) % len;
    }
    renderComparisonView();

    // Re-enter the mode after new media loads
    if (wasBlend) enterDcBlendMode();
    else if (wasDiff) enterDcDiffMode();
}

function renderComparisonView() {
    if (!compareGroup) return;

    renderSliderMedia('left', compareLeftIndex);
    renderSliderMedia('right', compareRightIndex);
    renderCompareInfo('left', compareLeftIndex);
    renderCompareInfo('right', compareRightIndex);

    const leftInd = document.getElementById('compare-left-indicator');
    const rightInd = document.getElementById('compare-right-indicator');
    if (leftInd) leftInd.textContent = `${compareLeftIndex + 1} / ${compareGroup.length}`;
    if (rightInd) rightInd.textContent = `${compareRightIndex + 1} / ${compareGroup.length}`;

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
    const fileUrl = pathToFileUrl(file.path);
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
        const fileUrl = pathToFileUrl(file.path);
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

// ── Duplicate Compare: Blend & Diff modes ──

function enterDcBlendMode() {
    if (!compareGroup || compareShowAll) return;
    dcBlendMode = true;

    const container = document.getElementById('compare-slider-container');
    if (!container) return;
    container.classList.add('dc-blend-active');

    // Apply opacity and mix-blend-mode to the left layer (which sits on top)
    const leftLayer = document.getElementById('compare-slider-layer-left');
    if (leftLayer) {
        leftLayer.style.opacity = dcBlendOpacity;
        leftLayer.style.mixBlendMode = dcBlendMixMode;
    }

    document.getElementById('dc-blend-controls')?.classList.remove('hidden');
    document.getElementById('dc-blend-btn')?.classList.add('active');
}

function exitDcBlendMode() {
    if (!dcBlendMode) return;
    dcBlendMode = false;

    const container = document.getElementById('compare-slider-container');
    container?.classList.remove('dc-blend-active');

    // Restore left layer styles
    const leftLayer = document.getElementById('compare-slider-layer-left');
    if (leftLayer) {
        leftLayer.style.opacity = '';
        leftLayer.style.mixBlendMode = '';
    }

    document.getElementById('dc-blend-controls')?.classList.add('hidden');
    document.getElementById('dc-blend-btn')?.classList.remove('active');
}

function enterDcDiffMode() {
    if (!compareGroup || compareShowAll) return;
    dcDiffMode = true;

    const container = document.getElementById('compare-slider-container');
    if (!container) return;
    container.classList.add('dc-diff-active');

    const leftLayer = document.getElementById('compare-slider-layer-left');
    const rightLayer = document.getElementById('compare-slider-layer-right');
    const mediaA = leftLayer?.querySelector('img, video');
    const mediaB = rightLayer?.querySelector('img, video');
    if (!mediaA || !mediaB) return;

    Promise.all([waitForMediaReady(mediaA), waitForMediaReady(mediaB)]).then(() => {
        if (!dcDiffMode) return;
        const diff = computePixelDiff(mediaA, mediaB, dcDiffAmplify);

        // Remove any existing diff canvas
        container.querySelector('.dc-diff-canvas')?.remove();

        const canvas = document.createElement('canvas');
        canvas.width = diff.width;
        canvas.height = diff.height;
        canvas.className = 'dc-diff-canvas';
        canvas.id = 'dc-diff-canvas';
        canvas.getContext('2d').putImageData(diff.imageData, 0, 0);
        container.appendChild(canvas);
    });

    document.getElementById('dc-diff-controls')?.classList.remove('hidden');
    document.getElementById('dc-diff-btn')?.classList.add('active');
}

function exitDcDiffMode() {
    if (!dcDiffMode) return;
    dcDiffMode = false;

    const container = document.getElementById('compare-slider-container');
    container?.classList.remove('dc-diff-active');
    container?.querySelector('.dc-diff-canvas')?.remove();

    document.getElementById('dc-diff-controls')?.classList.add('hidden');
    document.getElementById('dc-diff-btn')?.classList.remove('active');
}

function recomputeDcDiff() {
    const leftLayer = document.getElementById('compare-slider-layer-left');
    const rightLayer = document.getElementById('compare-slider-layer-right');
    const mediaA = leftLayer?.querySelector('img, video');
    const mediaB = rightLayer?.querySelector('img, video');
    if (!mediaA || !mediaB) return;

    const diff = computePixelDiff(mediaA, mediaB, dcDiffAmplify);
    const canvas = document.getElementById('dc-diff-canvas');
    if (canvas) {
        canvas.width = diff.width;
        canvas.height = diff.height;
        canvas.getContext('2d').putImageData(diff.imageData, 0, 0);
    }
}

function updateDcBlendDiffVisibility(showSlider) {
    const blendBtn = document.getElementById('dc-blend-btn');
    const diffBtn = document.getElementById('dc-diff-btn');
    if (blendBtn) blendBtn.classList.toggle('hidden', !showSlider);
    if (diffBtn) diffBtn.classList.toggle('hidden', !showSlider);
}

// Initialise blend/diff controls for duplicate compare (runs once)
(function initDcBlendDiff() {
    const blendBtn = document.getElementById('dc-blend-btn');
    if (blendBtn) blendBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dcBlendMode) {
            exitDcBlendMode();
        } else {
            exitDcDiffMode();
            enterDcBlendMode();
        }
    });

    const diffBtn = document.getElementById('dc-diff-btn');
    if (diffBtn) diffBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dcDiffMode) {
            exitDcDiffMode();
        } else {
            exitDcBlendMode();
            enterDcDiffMode();
        }
    });

    document.getElementById('dc-blend-opacity')?.addEventListener('input', (e) => {
        dcBlendOpacity = e.target.value / 100;
        const leftLayer = document.getElementById('compare-slider-layer-left');
        if (leftLayer && dcBlendMode) leftLayer.style.opacity = dcBlendOpacity;
    });

    document.getElementById('dc-blend-mix-mode')?.addEventListener('change', (e) => {
        dcBlendMixMode = e.target.value;
        const leftLayer = document.getElementById('compare-slider-layer-left');
        if (leftLayer && dcBlendMode) leftLayer.style.mixBlendMode = dcBlendMixMode;
    });

    document.getElementById('dc-diff-amplify')?.addEventListener('input', (e) => {
        dcDiffAmplify = parseInt(e.target.value, 10);
        const label = document.getElementById('dc-diff-amplify-value');
        if (label) label.textContent = dcDiffAmplify + 'x';
        if (dcDiffMode) recomputeDcDiff();
    });
})();

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

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════

// ── Restore UI preferences from localStorage ──
function initPreferences() {
    initCompareSlider();

    // Helper: restore a boolean toggle + label from localStorage
    function restoreToggle(key, globalSetter, toggle, label, extra) {
        const saved = localStorage.getItem(key);
        if (saved === null) return;
        const val = saved === 'true';
        globalSetter(val);
        if (toggle) toggle.checked = val;
        if (label) label.textContent = val ? 'On' : 'Off';
        if (extra) extra(val);
    }

    restoreToggle('rememberLastFolder', v => { rememberLastFolder = v; }, rememberFolderToggle, rememberFolderLabel);
    restoreToggle('includeMovingImages', v => { includeMovingImages = v; }, includeMovingImagesToggle, includeMovingImagesLabel);
    restoreToggle('pauseOnLightbox', v => { pauseOnLightbox = v; }, pauseOnLightboxToggle, pauseOnLightboxLabel);
    restoreToggle('autoRepeatVideos', v => { autoRepeatVideos = v; }, autoRepeatToggle, autoRepeatLabel, v => { if (v) videoLoop = true; });
    restoreToggle('pauseOnBlur', v => { pauseOnBlur = v; }, pauseOnBlurToggle, pauseOnBlurLabel);
    restoreToggle('playbackControls', v => { playbackControlsEnabled = v; }, playbackControlsToggle, playbackControlsLabel);
    restoreToggle('hoverScrub', v => { hoverScrubEnabled = v; }, hoverScrubToggle, hoverScrubLabel);
    restoreToggle('gifHoverScrub', v => { gifHoverScrubEnabled = v; }, gifHoverScrubToggle, gifHoverScrubLabel);
    restoreToggle('hoverPreviewStrip', v => { hoverPreviewStripEnabled = v; }, hoverPreviewStripToggle, hoverPreviewStripLabel);
    restoreToggle('zoomToFit', v => { zoomToFit = v; }, zoomToFitToggle, zoomToFitLabel, v => {
        if (lightboxZoomToFitToggle) lightboxZoomToFitToggle.checked = v;
    });

    // Layout mode
    const savedLayoutMode = localStorage.getItem('layoutMode');
    if (savedLayoutMode === 'grid' || savedLayoutMode === 'masonry') {
        layoutMode = savedLayoutMode;
        layoutModeToggle.checked = layoutMode === 'grid';
        layoutModeLabel.textContent = layoutMode === 'grid' ? 'Rigid' : 'Dynamic';
    }

    // Card metadata visibility
    if (typeof hydrateCardInfoSettings === 'function') hydrateCardInfoSettings();

    // Sorting (will be overridden by tab preferences in loadTabs)
    const savedSortType = localStorage.getItem('sortType');
    sortType = (savedSortType === 'name' || savedSortType === 'date') ? savedSortType : 'name';
    const savedSortOrder = localStorage.getItem('sortOrder');
    sortOrder = (savedSortOrder === 'ascending' || savedSortOrder === 'descending') ? savedSortOrder : 'ascending';

    // Group-by-date
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
}

// ── Window lifecycle event handlers ──
function initWindowLifecycleHandlers() {
    window.electronAPI.onWindowMinimized(() => pauseWhenMinimized());
    window.electronAPI.onWindowRestored(() => resumeWhenRestored());

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) pauseWhenMinimized();
        else resumeWhenRestored();
    });

    window.addEventListener('blur', () => {
        if (isWindowBlurred || isWindowMinimized) return;
        isWindowBlurred = true;
        if (!pauseOnBlur) return;
        // Perf: use VS active cards when available instead of querySelectorAll
        if (vsState.enabled) {
            for (const [, card] of vsState.activeCards) {
                const v = card._mediaEl;
                if (v && v.tagName === 'VIDEO') v.pause();
                const overlay = card.querySelector('.gif-static-overlay');
                if (overlay) overlay.classList.add('visible');
            }
        } else {
            gridContainer.querySelectorAll('video').forEach(v => v.pause());
            gridContainer.querySelectorAll('.gif-static-overlay').forEach(o => o.classList.add('visible'));
        }
        // Pause MLT overlay media (videos + animated images)
        const mltOverlay = document.getElementById('mlt-overlay');
        if (mltOverlay && !mltOverlay.classList.contains('hidden')) {
            mltOverlay.querySelectorAll('video').forEach(v => v.pause());
            mltOverlay.querySelectorAll('.gif-static-overlay').forEach(o => o.classList.add('visible'));
        }
    });

    window.addEventListener('focus', () => {
        if (!isWindowBlurred || isWindowMinimized) return;
        isWindowBlurred = false;
        if (!pauseOnBlur) return;
        if (isLightboxOpen && pauseOnLightbox) return;
        // Perf: use VS active cards when available instead of querySelectorAll
        if (vsState.enabled) {
            for (const [, card] of vsState.activeCards) {
                const v = card._mediaEl;
                if (v && v.tagName === 'VIDEO') { const p = v.play(); if (p !== undefined) p.catch(() => {}); }
                const overlay = card.querySelector('.gif-static-overlay');
                if (overlay) overlay.classList.remove('visible');
            }
        } else {
            gridContainer.querySelectorAll('video').forEach(v => {
                const p = v.play(); if (p !== undefined) p.catch(() => {});
            });
            gridContainer.querySelectorAll('.gif-static-overlay').forEach(o => o.classList.remove('visible'));
        }
        // Resume MLT overlay media on focus
        const mltOverlayFocus = document.getElementById('mlt-overlay');
        if (mltOverlayFocus && !mltOverlayFocus.classList.contains('hidden')) {
            mltOverlayFocus.querySelectorAll('video').forEach(v => {
                if (v.style.display !== 'none') v.play().catch(() => {});
            });
            mltOverlayFocus.querySelectorAll('.gif-static-overlay').forEach(o => o.classList.remove('visible'));
        }
    });
}

// ── One-time SQLite migration from localStorage/IndexedDB ──
async function initSQLiteMigration() {
    try {
        const migrationStatus = await window.electronAPI.dbCheckMigrationStatus();
        if (!migrationStatus.ok || migrationStatus.value.migrationComplete) return;

        console.log('[SQLite] Running one-time migration from localStorage/IndexedDB...');
        const migrationData = {};
        try { const s = localStorage.getItem('fileRatings');  if (s) migrationData.fileRatings  = JSON.parse(s); } catch {}
        try { const s = localStorage.getItem('pinnedFiles');   if (s) migrationData.pinnedFiles  = JSON.parse(s); } catch {}
        try {
            const s = localStorage.getItem('favorites');
            if (s) {
                const parsed = JSON.parse(s);
                if (Array.isArray(parsed)) {
                    migrationData.favorites = { version: 2, groups: [{ id: 'default', name: 'Favorites', collapsed: false, items: parsed }] };
                } else if (parsed && parsed.version === 2) {
                    migrationData.favorites = parsed;
                }
            }
        } catch {}
        try { const s = localStorage.getItem('recentFiles');   if (s) migrationData.recentFiles  = JSON.parse(s); } catch {}
        try { if (typeof exportCollectionsData === 'function') migrationData.collections = await exportCollectionsData(); } catch {}

        const migResult = await window.electronAPI.dbRunMigration(migrationData);
        if (migResult.ok) console.log('[SQLite] Migration complete.');
        else console.error('[SQLite] Migration failed:', migResult.error);
    } catch (e) {
        console.error('[SQLite] Migration check failed:', e);
    }
}

// ── Tab restoration & fallback folder navigation ──
async function initTabRestoration() {
    const activeTab = tabs.find(t => t.id === activeTabId);

    // Expand sidebar to match whichever folder is now active after tab restore
    if (currentFolderPath) sidebarExpandToPath(currentFolderPath);

    if ((!activeTab || !activeTab.path) && rememberLastFolder) {
        const lastFolderPath = localStorage.getItem('lastFolderPath');
        if (lastFolderPath) {
            try {
                const skipStats = sortType === 'name';
                const scanRes = await window.electronAPI.scanFolder(lastFolderPath, { skipStats });
                if (!scanRes || !scanRes.ok) throw new Error(scanRes && scanRes.error || 'scan failed');
                if (activeTab) {
                    activeTab.path = lastFolderPath;
                    activeTab.name = lastFolderPath.split(/[/\\]/).pop();
                    saveTabs();
                    renderTabs();
                }
                await navigateToFolder(lastFolderPath);
                sidebarExpandToPath(lastFolderPath);
            } catch (error) {
                console.log('Last folder no longer exists:', lastFolderPath);
                localStorage.removeItem('lastFolderPath');
            }
        }
    }
}

// ── Main application init (called on DOMContentLoaded) ──
// Parallelized startup: independent tasks run concurrently instead of waiting
// for folder navigation to complete before initializing keyboard shortcuts,
// theme, sidebar, ratings, etc.
async function initApplication() {
    // 1. Restore UI preferences (sync, fast — must be first)
    initPreferences();

    // 2. Sync UI init (no IPC, no async — runs immediately)
    initWindowLifecycleHandlers();
    initKeyboardShortcuts();
    initTheme();
    initThumbnailQuality();
    initZoom();

    // 3. Fire-and-forget: ffmpeg check (result used lazily when needed)
    const ffmpegPromise = window.electronAPI.hasFfmpeg().then(r => {
        hasFfmpegAvailable = r && r.ok && r.value && r.value.ffmpeg;
    }).catch(() => { /* ffmpeg not available */ });

    // 4. SQLite migration must complete before data loads, but can overlap with sidebar + folder nav.
    //    Uses batched IPC (single round-trip) instead of four separate calls.
    const dataPromise = (async () => {
        await initSQLiteMigration();
        await loadInitDataBatched();
    })();

    // 5. Sidebar init + folder navigation run concurrently with data loading
    const sidebarPromise = initSidebar();

    // 6. Restore last folder (can start rendering immediately, even before data loads —
    //    ratings/pins sync lazily on next card recycle)
    let folderPromise = Promise.resolve();
    if (rememberLastFolder) {
        const lastFolderPath = localStorage.getItem('lastFolderPath');
        if (lastFolderPath) {
            showLoadingIndicator();
            folderPromise = navigateToFolder(lastFolderPath).catch(error => {
                console.log('Last folder no longer exists:', lastFolderPath, error);
                localStorage.removeItem('lastFolderPath');
            }).finally(() => {
                hideLoadingIndicator();
            });
        }
    }

    // 7. Wait for all concurrent init to complete
    await Promise.all([ffmpegPromise, dataPromise, sidebarPromise, folderPromise]);

    // 8. UI components that depend on data + sidebar being ready
    loadTabs();
    initVideoScrubber();
    initNewFeatures();
    initDuplicateDetection();

    // 9. Tab restoration & fallback navigation
    await initTabRestoration();

    // 10. Finalize
    updateStatusBar();
}

window.addEventListener('DOMContentLoaded', () => initApplication());
