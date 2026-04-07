// ============================================================================
// duplicate-detection.js — Duplicate file detection (hash + CLIP similarity)
// Extracted from renderer-features.js. All functions/variables remain in global scope.
// ============================================================================

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
        const batchVal = (result && result.ok) ? (result.value || {}) : {};
        const failedArr = Array.isArray(batchVal.failed) ? batchVal.failed : [];
        const failCount = failedArr.length;
        const successCount = count - failCount;
        if (failCount > 0 && successCount > 0) {
            const errorSummary = groupBatchErrors(failedArr);
            showToast(`Deleted ${successCount} file(s), ${failCount} failed: ${errorSummary}`, 'warning');
        } else if (failCount > 0) {
            const errorSummary = groupBatchErrors(failedArr);
            showToast(`Failed to delete ${failCount} file(s): ${errorSummary}`, 'error');
        } else if (batchVal.trashed) {
            showToast(`Moved ${count} file(s) to Recycle Bin`, 'success');
        } else {
            showToast(`Deleted ${count} file(s)`, 'success', {
                duration: 8000,
                actionLabel: 'Undo',
                actionCallback: () => {
                    window.electronAPI.undoFileOperation().then(undoResult => {
                        if (undoResult.ok) {
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

        if (!result.ok) throw new Error(result.error || 'scan failed');
        const dupVal = result.value || {};
        cachedHashData = dupVal.hashData || null;

        const allGroups = [];
        if (dupVal.exactGroups) {
            for (const group of dupVal.exactGroups) {
                allGroups.push({ type: 'exact', files: group });
            }
        }
        if (dupVal.similarGroups) {
            for (const group of dupVal.similarGroups) {
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
    const rv = (result && result.ok) ? (result.value || {}) : {};

    const allGroups = [];
    if (rv.exactGroups) {
        for (const group of rv.exactGroups) {
            allGroups.push({ type: 'exact', files: group });
        }
    }
    if (rv.similarGroups) {
        for (const group of rv.similarGroups) {
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
    const dupFileUrl = pathToFileUrl(file.path);
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
            vid.src = pathToFileUrl(file.path);
            vid.muted = true;
            vid.loop = true;
            vid.play().catch(() => {});
            preview.appendChild(vid);
        } else {
            const img = document.createElement('img');
            img.src = pathToFileUrl(file.path);
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

