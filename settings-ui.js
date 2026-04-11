// ============================================================================
// settings-ui.js — Settings modal, keyboard shortcuts, and settings wiring
// Extracted from renderer.js. All functions/variables remain in global scope.
// ============================================================================

// ── Settings Modal Toggle ──
function toggleSettingsModal() {
    settingsModal.classList.toggle('hidden');
}

function closeSettingsModal() {
    settingsModal.classList.add('hidden');
}

// Keyboard Shortcuts Cheat Sheet
const shortcutsOverlay = document.getElementById('shortcuts-overlay');
const shortcutsCloseBtn = document.getElementById('shortcuts-close-btn');

function toggleShortcutsOverlay() {
    shortcutsOverlay.classList.toggle('hidden');
}

shortcutsCloseBtn.addEventListener('click', () => {
    shortcutsOverlay.classList.add('hidden');
});

shortcutsOverlay.addEventListener('click', (e) => {
    if (e.target === shortcutsOverlay) {
        shortcutsOverlay.classList.add('hidden');
    }
});

// ── Settings Modal Listeners ──
// Close settings modal when clicking backdrop
settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
        closeSettingsModal();
    }
});

// Settings modal close button
document.getElementById('settings-modal-close').addEventListener('click', () => {
    closeSettingsModal();
});

// Settings tab switching
function bindSettingsTabListeners() {
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const content = document.querySelector(`.settings-tab-content[data-tab="${tab.dataset.tab}"]`);
            if (content) content.classList.add('active');
            if (tab.dataset.tab === 'ai-search' && typeof window.__refreshClipGpuStatus === 'function') {
                window.__refreshClipGpuStatus();
            }
        });
    });
}
bindSettingsTabListeners();

// ── Settings Export / Import ──
// --- Settings Export / Import ---
const SETTINGS_EXPORT_KEYS_STRING = [
    'selectedTheme', 'sidebarWidth', 'sidebarCollapsed', 'layoutMode',
    'zoomLevel', 'zoomToFit', 'thumbnailQuality', 'sortType', 'sortOrder',
    'rememberLastFolder', 'lastFolderPath', 'includeMovingImages',
    'autoRepeatVideos', 'pauseOnBlur', 'pauseOnLightbox', 'hoverScrub', 'gifHoverScrub', 'lightboxFilmstripEnabled',
    'playbackControls', 'activeTabId',
    'aiVisualSearchEnabled', 'aiModelDownloadConfirmed', 'aiAutoScan',
    'aiSimilarityThreshold', 'aiClusteringMode',
    'videoCacheLimitMB', 'imageCacheLimitMB',
    'useSystemTrash', 'hoverScale', 'hoverScaleWithZoom',
    'hoverScaleAt50', 'hoverScaleAt100', 'hoverScaleAt200',
    'groupByDate', 'dateGroupGranularity', 'recursiveSearch',
    // Phase 2: Grid layout
    'gridGap', 'minCardWidth', 'cardAspectRatio',
    // Phase 3: Animation
    'animationSpeed', 'reduceMotion',
    // Phase 5: Playback
    'controlBarHideDelay', 'defaultSlideshowSpeed', 'videoThumbSeekPct',
    // Phase 6: AI
    'aiIdleDelay', 'aiBatchSize', 'aiVideoFrameCount',
    // Phase 7: Performance
    'perfProfile', 'maxMedia', 'parallelLoad', 'vsBuffer', 'vsPoolSize',
    'scrollDebounce', 'progressiveThreshold',
    'folderCacheTTL', 'idbCacheTTL',
    'imageThumbMaxEdge', 'videoThumbWidth',
    'lightboxMaxZoom', 'lightboxViewport', 'blowUpDelay',
    'recentFilesLimit', 'maxUndoHistory', 'tagSuggestionsLimit', 'searchHistoryLimit',
    // Phase 8: Niche
    'ioConcurrency', 'clipWorkerCount',
    'retryAttempts', 'retryInitialDelay', 'retryMaxDelay',
    'sidebarMinWidth', 'sidebarMaxWidth',
    'folderPreviewCount', 'folderPreviewSize',
];
const SETTINGS_EXPORT_KEYS_JSON = [
    'cardInfoSettings', 'customThemes',
    'tabs', 'sidebarExpandedNodes', 'pluginStates',
    'folderSortPrefs',
    'extensionColors', 'keyboardShortcuts', 'playbackSpeeds',
    'tabGroups', 'savedTabGroups',
];

function showSettingsDataStatus(message, type) {
    const el = document.getElementById('settings-data-status');
    if (!el) return;
    el.textContent = message;
    el.className = 'settings-data-status ' + type;
}

async function exportCollectionsData() {
    try {
        const collections = await getAllCollections();
        const collectionsWithFiles = [];
        for (const col of collections) {
            const files = await getCollectionFiles(col.id);
            collectionsWithFiles.push({ ...col, files });
        }
        return collectionsWithFiles;
    } catch {
        return [];
    }
}

async function importCollectionsData(collectionsData) {
    if (!collectionsData || !Array.isArray(collectionsData) || collectionsData.length === 0) return;
    // Delete existing collections first
    const existing = await getAllCollections();
    for (const col of existing) {
        await deleteCollection(col.id);
    }
    // Write imported collections and their files
    for (const col of collectionsData) {
        const files = col.files || [];
        const colCopy = { ...col };
        delete colCopy.files;
        await saveCollection(colCopy);
        if (files.length > 0) {
            const filePaths = files.map(f => f.filePath || f.file_path);
            await addFilesToCollection(col.id, filePaths);
        }
    }
}

async function exportSettings() {
    _flushStorageWrites();
    const data = {
        meta: {
            app: 'thumbnail-animator',
            version: '1.4.5',
            exportedAt: new Date().toISOString(),
            schemaVersion: 1
        },
        settings: {},
        json: {},
        collections: []
    };
    for (const key of SETTINGS_EXPORT_KEYS_STRING) {
        const val = localStorage.getItem(key);
        if (val !== null) data.settings[key] = val;
    }
    for (const key of SETTINGS_EXPORT_KEYS_JSON) {
        const raw = localStorage.getItem(key);
        if (raw !== null) {
            try { data.json[key] = JSON.parse(raw); }
            catch { data.json[key] = raw; }
        }
    }
    data.collections = await exportCollectionsData();
    // Export SQLite-stored metadata
    try {
        const [ratingsResult, pinnedResult, favoritesResult, recentResult, tagsResult] = await Promise.all([
            window.electronAPI.dbGetAllRatings(),
            window.electronAPI.dbGetAllPinned(),
            window.electronAPI.dbGetFavorites(),
            window.electronAPI.dbGetRecentFiles(recentFilesLimitSetting),
            window.electronAPI.dbExportTags()
        ]);
        if (ratingsResult.ok) data.json.fileRatings = ratingsResult.value;
        if (pinnedResult.ok) data.json.pinnedFiles = pinnedResult.value;
        if (favoritesResult.ok) data.json.favorites = favoritesResult.value;
        if (recentResult.ok) data.json.recentFiles = recentResult.value;
        if (tagsResult.ok) data.json.tags = tagsResult.value;
    } catch {}
    try {
        const savedSearchesResult = await window.electronAPI.dbGetSavedSearches();
        if (savedSearchesResult && savedSearchesResult.ok) data.json.savedSearches = savedSearchesResult.value;
    } catch {}
    try {
        const result = await window.electronAPI.exportSettingsDialog(JSON.stringify(data, null, 2));
        if (result.ok && result.value && result.value.canceled) return;
        if (result.ok) {
            showSettingsDataStatus('Settings exported successfully.', 'success');
        } else {
            showSettingsDataStatus('Export failed: ' + friendlyError(result.error), 'error');
        }
    } catch (err) {
        showSettingsDataStatus('Export failed: ' + err.message, 'error');
    }
}

async function importSettings() {
    let result;
    try {
        result = await window.electronAPI.importSettingsDialog();
    } catch (err) {
        showSettingsDataStatus('Import failed: ' + err.message, 'error');
        return;
    }
    if (!result.ok) {
        showSettingsDataStatus('Import failed: ' + friendlyError(result.error || 'Unknown error'), 'error');
        return;
    }
    if (result.value && result.value.canceled) return;
    const data = result.value;
    if (!data || !data.meta || data.meta.app !== 'thumbnail-animator') {
        showSettingsDataStatus('This file was not exported from Thumbnail Animator.', 'error');
        return;
    }
    if (data.meta.schemaVersion !== 1) {
        showSettingsDataStatus('Unsupported settings format. Please update the app.', 'error');
        return;
    }
    if (!confirm('This will replace ALL current settings and reload the app. Continue?')) return;

    localStorage.clear();
    if (data.settings) {
        for (const [key, val] of Object.entries(data.settings)) {
            localStorage.setItem(key, val);
        }
    }
    if (data.json) {
        for (const [key, val] of Object.entries(data.json)) {
            localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val));
        }
    }
    const importErrors = [];
    if (data.json && data.json.pluginStates) {
        try { await window.electronAPI.syncPluginStatesFromImport(data.json.pluginStates); }
        catch (e) { importErrors.push('plugin states'); console.error('Import plugin states failed:', e); }
    }
    if (data.collections) {
        try { await importCollectionsData(data.collections); }
        catch (e) { importErrors.push('collections'); console.error('Import collections failed:', e); }
    }
    // Import SQLite-stored metadata from exported settings
    try {
        if (data.json && data.json.fileRatings) {
            await window.electronAPI.dbRunMigration({ fileRatings: data.json.fileRatings });
        }
        if (data.json && data.json.pinnedFiles) {
            await window.electronAPI.dbRunMigration({ pinnedFiles: data.json.pinnedFiles });
        }
        if (data.json && data.json.favorites) {
            await window.electronAPI.dbSaveFavorites(data.json.favorites);
        }
        if (data.json && data.json.recentFiles) {
            await window.electronAPI.dbClearRecentFiles();
            for (const entry of data.json.recentFiles) {
                await window.electronAPI.dbAddRecentFile(entry, recentFilesLimitSetting);
            }
        }
        if (data.json && data.json.tags) {
            await window.electronAPI.dbImportTags(data.json.tags);
        }
        if (data.json && Array.isArray(data.json.savedSearches)) {
            for (const ss of data.json.savedSearches) {
                try { await window.electronAPI.dbSaveSearch(ss); } catch {}
            }
        }
    } catch (e) {
        importErrors.push('database metadata');
        console.error('Import database metadata failed:', e);
    }
    if (importErrors.length > 0) {
        showToast('Some data could not be imported', 'warning', {
            details: `Failed: ${importErrors.join(', ')}`,
            duration: 8000
        });
    }
    location.reload();
}

document.getElementById('export-settings-btn').addEventListener('click', exportSettings);
document.getElementById('import-settings-btn').addEventListener('click', importSettings);

// ── Cache Limit Settings ──
// ── Cache limit settings ──
{
    const videoCacheSelect = document.getElementById('video-cache-limit');
    const imageCacheSelect = document.getElementById('image-cache-limit');
    const clearCacheBtn = document.getElementById('clear-cache-btn');

    // Restore saved values
    const savedVideoLimit = localStorage.getItem('videoCacheLimitMB');
    if (savedVideoLimit && videoCacheSelect) {
        const opt = videoCacheSelect.querySelector(`option[value="${savedVideoLimit}"]`);
        if (opt) videoCacheSelect.value = savedVideoLimit;
    }
    const savedImageLimit = localStorage.getItem('imageCacheLimitMB');
    if (savedImageLimit && imageCacheSelect) {
        const opt = imageCacheSelect.querySelector(`option[value="${savedImageLimit}"]`);
        if (opt) imageCacheSelect.value = savedImageLimit;
    }

    // Save on change and sync to main process
    function syncCacheLimits() {
        const videoMB = parseInt(videoCacheSelect?.value || '500', 10);
        const imageMB = parseInt(imageCacheSelect?.value || '1000', 10);
        if (window.electronAPI?.setCacheLimits) {
            window.electronAPI.setCacheLimits(videoMB, imageMB);
        }
    }
    if (videoCacheSelect) {
        videoCacheSelect.addEventListener('change', () => {
            deferLocalStorageWrite('videoCacheLimitMB', videoCacheSelect.value);
            syncCacheLimits();
        });
    }
    if (imageCacheSelect) {
        imageCacheSelect.addEventListener('change', () => {
            deferLocalStorageWrite('imageCacheLimitMB', imageCacheSelect.value);
            syncCacheLimits();
        });
    }

    // Show cache usage when Data tab is opened
    async function updateCacheUsage() {
        if (!window.electronAPI?.getCacheInfo) return;
        try {
            const _ciRes = await window.electronAPI.getCacheInfo();
            const info = _ciRes && _ciRes.ok ? _ciRes.value : null;
            if (!info) return;
            const fmt = (b) => b < 1024 * 1024 ? (b / 1024).toFixed(0) + ' KB' : (b / 1024 / 1024).toFixed(1) + ' MB';
            const videoEl = document.getElementById('video-cache-usage');
            const imageEl = document.getElementById('image-cache-usage');
            if (videoEl) videoEl.textContent = `Currently using ${fmt(info.video.size)} (${info.video.files} files)`;
            if (imageEl) imageEl.textContent = `Currently using ${fmt(info.image.size)} (${info.image.files} files)`;
        } catch {}
    }

    // Update usage when settings modal opens to Data tab
    const observer = new MutationObserver(() => {
        const dataTab = document.querySelector('.settings-tab-content[data-tab="data"]');
        if (dataTab && !dataTab.classList.contains('hidden') && dataTab.offsetParent !== null) {
            updateCacheUsage();
        }
    });
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) observer.observe(settingsModal, { attributes: true, subtree: true, attributeFilter: ['class'] });

    // Clear cache button
    if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', async () => {
            clearCacheBtn.disabled = true;
            clearCacheBtn.textContent = 'Clearing...';
            try {
                const videoResult = await window.electronAPI.evictCache('video');
                const imageResult = await window.electronAPI.evictCache('image');
                const vv = videoResult?.ok ? videoResult.value : null;
                const iv = imageResult?.ok ? imageResult.value : null;
                const totalDeleted = (vv?.deleted || 0) + (iv?.deleted || 0);
                const totalFreed = ((vv?.freed || 0) + (iv?.freed || 0)) / 1024 / 1024;
                showSettingsDataStatus(
                    totalDeleted > 0
                        ? `Cleared ${totalDeleted} thumbnails (freed ${totalFreed.toFixed(1)} MB)`
                        : 'Cache is already within limits',
                    'success'
                );
                updateCacheUsage();
            } catch (err) {
                showSettingsDataStatus('Clear failed: ' + err.message, 'error');
            } finally {
                clearCacheBtn.disabled = false;
                clearCacheBtn.textContent = 'Clear';
            }
        });
    }
}

// ── Plugin Settings ──
// Inject plugin settings panels into the settings modal
async function injectPluginSettingsPanels() {
    let panels;
    try {
        const _resp = await window.electronAPI.getPluginSettingsPanels();
        panels = _resp && _resp.ok ? (_resp.value || []) : [];
    } catch {
        return;
    }
    if (!panels || panels.length === 0) return;

    const tabsEl = document.querySelector('.settings-tabs');
    const panelEl = document.querySelector('.settings-panel');
    if (!tabsEl || !panelEl) return;

    for (const panel of panels) {
        const tabId = `plugin-${panel.pluginId}`;
        if (document.querySelector(`.settings-tab[data-tab="${tabId}"]`)) continue; // already injected

        // Add tab button
        const tabBtn = document.createElement('button');
        tabBtn.className = 'settings-tab';
        tabBtn.dataset.tab = tabId;
        tabBtn.textContent = panel.label || panel.pluginId;
        tabsEl.appendChild(tabBtn);

        // Add tab content
        const contentEl = document.createElement('div');
        contentEl.className = 'settings-tab-content';
        contentEl.dataset.tab = tabId;
        contentEl.innerHTML = panel.html || `<p class="settings-label">No settings available for ${panel.pluginId}.</p>`;
        panelEl.appendChild(contentEl);

        // Collect form data and save helper
        const savePluginSettings = async () => {
            const formData = {};
            contentEl.querySelectorAll('[data-plugin-setting-key]').forEach(input => {
                formData[input.dataset.pluginSettingKey] = input.type === 'checkbox' ? input.checked : input.value;
            });
            try {
                await window.electronAPI.executePluginSettingsAction(panel.pluginId, 'save', formData);
                showToast('Settings saved', 'success');
            } catch (err) {
                showToast(`Settings error: ${err.message}`, 'error');
            }
        };

        // Wire save button if present
        contentEl.querySelectorAll('[data-plugin-settings-save]').forEach(btn => {
            btn.addEventListener('click', savePluginSettings);
        });

        // Auto-save when toggle/checkbox inputs change (no need to click Save for simple toggles)
        contentEl.querySelectorAll('[data-plugin-setting-key]').forEach(input => {
            if (input.type === 'checkbox') {
                input.addEventListener('change', savePluginSettings);
            }
        });

        // Load existing settings into inputs
        try {
            const loaded = await window.electronAPI.executePluginSettingsAction(panel.pluginId, 'load', null);
            if (loaded && loaded.ok && loaded.value) {
                Object.entries(loaded.value).forEach(([key, val]) => {
                    const input = contentEl.querySelector(`[data-plugin-setting-key="${key}"]`);
                    if (!input) return;
                    if (input.type === 'checkbox') input.checked = Boolean(val);
                    else input.value = String(val);
                });
            }
        } catch { /* settings load is optional */ }
    }

    // Re-bind tab listeners to include new plugin tabs
    bindSettingsTabListeners();
}

// --- Plugin enable/disable helpers live in renderer.js (needed at init time) ---

// --- Plugins settings tab ---

function _pluginsHeadingHtml() {
    return `<div class="plugins-heading-row">
        <div class="settings-content-heading">Plugins</div>
        <div class="plugins-heading-actions">
            <button id="open-plugins-folder-btn" class="settings-action-btn" title="Open plugins folder in file explorer">Open Folder</button>
            <button id="reload-plugins-btn" class="settings-action-btn">Reload</button>
            <button id="install-plugin-btn" class="settings-action-btn">Install Plugin\u2026</button>
            <button id="create-plugin-btn" class="settings-action-btn" title="Scaffold a new plugin project">Create Plugin\u2026</button>
        </div>
    </div>`;
}

function _invalidatePluginCaches() {
    _pluginMenuItems = null;
    if (typeof _pluginBatchOps !== 'undefined') _pluginBatchOps = null;
    if (typeof _pluginInfoSections !== 'undefined') _pluginInfoSections = null;
    if (typeof InspectorPanel !== 'undefined') InspectorPanel._pluginInfoSectionsCache = null;
}

function _wireInstallButton(container) {
    const installBtn = container.querySelector('#install-plugin-btn');
    if (!installBtn) return;
    installBtn.addEventListener('click', async () => {
        installBtn.disabled = true;
        installBtn.textContent = 'Installing\u2026';
        try {
            const res = await window.electronAPI.installPluginFromFolder();
            if (!res || !res.ok) {
                if (res && res.error) showToast(`Install failed: ${res.error}`, 'error');
                return;
            }
            if (res.value && res.value.canceled) return;

            // Handle duplicate — offer to update
            if (res.value && res.value.duplicate) {
                const { pluginId, existingVersion, newVersion, existingName, sourceDir } = res.value;
                const confirmed = await showConfirm(
                    'Update Plugin',
                    `"${existingName}" is already installed (v${existingVersion}). Replace with v${newVersion}?`,
                    { confirmLabel: 'Update', danger: false }
                );
                if (!confirmed) return;
                installBtn.textContent = 'Updating\u2026';
                const updateRes = await window.electronAPI.updatePluginFromFolder({ pluginId, sourceDir });
                if (!updateRes || !updateRes.ok) {
                    showToast(`Update failed: ${updateRes ? updateRes.error : 'Unknown error'}`, 'error');
                    return;
                }
                showToast(`Plugin "${updateRes.value.name}" updated to v${newVersion}`, 'success');
                _invalidatePluginCaches();
                await initPluginsTab();
                return;
            }

            showToast(`Plugin "${res.value.name}" installed successfully`, 'success');
            _invalidatePluginCaches();
            await initPluginsTab();
        } catch (err) {
            showToast(`Install failed: ${err.message}`, 'error');
        } finally {
            installBtn.disabled = false;
            installBtn.textContent = 'Install Plugin\u2026';
        }
    });
}

function _wireOpenFolderButton(container) {
    const btn = container.querySelector('#open-plugins-folder-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        try {
            const res = await window.electronAPI.openPluginsFolder();
            if (res && !res.ok) showToast(`Could not open plugins folder: ${res.error}`, 'error');
        } catch (err) {
            showToast('Could not open plugins folder', 'error');
        }
    });
}

function _wireCreatePluginButton(container) {
    const btn = container.querySelector('#create-plugin-btn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        const id = await showPromptDialog('Plugin ID', {
            placeholder: 'my-plugin',
            confirmLabel: 'Next',
        });
        if (!id) return;
        const trimmedId = id.trim();
        if (!/^[a-z][a-z0-9-]*$/.test(trimmedId)) {
            showToast('Plugin ID must start with a lowercase letter and contain only lowercase letters, numbers, and hyphens', 'error', { duration: 6000 });
            return;
        }
        if (trimmedId.length > 64) {
            showToast('Plugin ID must be 64 characters or fewer', 'error');
            return;
        }
        const defaultName = trimmedId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        const name = await showPromptDialog('Plugin Name', {
            defaultValue: defaultName,
            placeholder: 'My Plugin',
            confirmLabel: 'Create',
        });
        if (!name) return;

        btn.disabled = true;
        btn.textContent = 'Creating\u2026';
        try {
            const res = await window.electronAPI.scaffoldPlugin({ id: trimmedId, name: name.trim() || defaultName });
            if (!res || !res.ok) {
                showToast(`Create failed: ${res ? res.error : 'Unknown error'}`, 'error');
                return;
            }
            showToast(`Plugin "${res.value.name}" created and opened in file explorer`, 'success');
            _invalidatePluginCaches();
            await initPluginsTab();
        } catch (err) {
            showToast(`Create failed: ${err.message}`, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Create Plugin\u2026';
        }
    });
}

function _wireReloadButton(container) {
    const reloadBtn = container.querySelector('#reload-plugins-btn');
    if (!reloadBtn) return;
    reloadBtn.addEventListener('click', async () => {
        reloadBtn.disabled = true;
        reloadBtn.textContent = 'Reloading\u2026';
        try {
            const result = await window.electronAPI.reloadPlugins();
            if (result && result.ok) {
                showToast(`Reloaded ${result.value.count} plugin(s)`, 'success');
                _invalidatePluginCaches();
                // Remove old injected plugin settings tabs and re-inject
                document.querySelectorAll('.settings-tab[data-tab^="plugin-"]').forEach(el => el.remove());
                document.querySelectorAll('.settings-tab-content[data-tab^="plugin-"]').forEach(el => el.remove());
                await injectPluginSettingsPanels();
                bindSettingsTabListeners();
                await initPluginsTab();
            } else {
                showToast(`Reload failed: ${result ? result.error : 'Unknown error'}`, 'error');
            }
        } catch (err) {
            showToast(`Reload failed: ${err.message}`, 'error');
        } finally {
            reloadBtn.disabled = false;
            reloadBtn.textContent = 'Reload';
        }
    });
}

async function initPluginsTab() {
    const container = document.getElementById('plugins-tab-content');
    if (!container) return;

    let manifests, states;
    try {
        const [_mRes, _sRes] = await Promise.all([
            window.electronAPI.getPluginManifests(),
            window.electronAPI.getPluginStates(),
        ]);
        manifests = _mRes && _mRes.ok ? (_mRes.value || []) : [];
        states = _sRes && _sRes.ok ? (_sRes.value || {}) : {};
    } catch (err) {
        container.innerHTML = _pluginsHeadingHtml() +
            `<div class="settings-item"><span class="settings-label" style="color:var(--color-danger)">Failed to load plugins: ${err.message}</span></div>`;
        _wireOpenFolderButton(container);
        _wireInstallButton(container);
        _wireCreatePluginButton(container);
        _wireReloadButton(container);
        return;
    }

    if (!manifests || manifests.length === 0) {
        container.innerHTML = _pluginsHeadingHtml() +
            `<div class="settings-item"><span class="settings-label" style="opacity:0.6">No plugins installed.</span></div>`;
        _wireOpenFolderButton(container);
        _wireInstallButton(container);
        _wireCreatePluginButton(container);
        _wireReloadButton(container);
        return;
    }

    // Sync localStorage with authoritative state from main process
    manifests.forEach(m => _setLocalPluginState(m.id, states[m.id] !== false));

    container.innerHTML = _pluginsHeadingHtml() + manifests.map((m, idx) => {
        const enabled = states[m.id] !== false;
        const caps = m.capabilities || {};
        const capLabels = [
            caps.metadataExtractors?.length ? `${caps.metadataExtractors.length} extractor${caps.metadataExtractors.length > 1 ? 's' : ''}` : null,
            caps.infoSections?.length ? `${caps.infoSections.length} info section${caps.infoSections.length > 1 ? 's' : ''}` : null,
            caps.contextMenuItems?.length ? `${caps.contextMenuItems.length} menu item${caps.contextMenuItems.length > 1 ? 's' : ''}` : null,
            caps.batchOperations?.length ? `${caps.batchOperations.length} batch op${caps.batchOperations.length > 1 ? 's' : ''}` : null,
            caps.thumbnailGenerators?.length ? `${caps.thumbnailGenerators.length} thumbnail generator${caps.thumbnailGenerators.length > 1 ? 's' : ''}` : null,
        ].filter(Boolean);
        const hasSettingsPanel = !!caps.settingsPanel;
        const isFirst = idx === 0;
        const isLast = idx === manifests.length - 1;

        return `
        <div class="settings-item plugin-settings-row" data-plugin-id="${m.id}">
            <div class="plugin-settings-info">
                <div class="plugin-settings-name">${m.name || m.id}${m.builtin ? ' <span class="plugin-builtin-badge">built-in</span>' : ''}</div>
                ${m.description ? `<div class="plugin-settings-desc">${m.description}</div>` : ''}
                <div class="plugin-settings-meta">
                    <span class="plugin-settings-version">v${m.version || '?'}</span>
                    ${capLabels.length ? `<span class="plugin-settings-caps">${capLabels.join(' \u00b7 ')}</span>` : ''}
                </div>
            </div>
            <div class="plugin-settings-actions">
                ${manifests.length > 1 ? `<button class="plugin-order-btn plugin-order-up" data-plugin-id="${m.id}" title="Higher priority" ${isFirst ? 'disabled' : ''}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>
                </button>
                <button class="plugin-order-btn plugin-order-down" data-plugin-id="${m.id}" title="Lower priority" ${isLast ? 'disabled' : ''}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                </button>` : ''}
                ${hasSettingsPanel ? `<button class="plugin-configure-btn" data-plugin-id="${m.id}" title="Configure ${m.name || m.id}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                        <circle cx="12" cy="12" r="3"/>
                    </svg>
                </button>` : ''}
                ${!m.builtin ? `<button class="plugin-remove-btn settings-action-btn" data-plugin-id="${m.id}" data-plugin-name="${m.name || m.id}">Remove</button>` : ''}
                <label class="settings-label plugin-settings-toggle-label">
                    <div class="toggle-switch">
                        <input type="checkbox" class="plugin-enable-toggle" data-plugin-id="${m.id}" ${enabled ? 'checked' : ''}>
                        <span class="toggle-slider"></span>
                    </div>
                    <span class="toggle-label plugin-toggle-state-label">${enabled ? 'On' : 'Off'}</span>
                </label>
            </div>
        </div>`;
    }).join('');

    // Wire heading buttons
    _wireOpenFolderButton(container);
    _wireInstallButton(container);
    _wireCreatePluginButton(container);
    _wireReloadButton(container);

    // Wire toggle handlers
    container.querySelectorAll('.plugin-enable-toggle').forEach(checkbox => {
        checkbox.addEventListener('change', async function() {
            const pluginId = this.dataset.pluginId;
            const enabled = this.checked;
            const label = this.closest('.settings-label').querySelector('.plugin-toggle-state-label');
            if (label) label.textContent = enabled ? 'On' : 'Off';

            _setLocalPluginState(pluginId, enabled);
            try {
                await window.electronAPI.setPluginEnabled(pluginId, enabled);
                _invalidatePluginCaches();
                showToast(`Plugin "${pluginId}" ${enabled ? 'enabled' : 'disabled'}`, 'info');
            } catch (err) {
                showToast(`Failed to toggle plugin: ${err.message}`, 'error');
            }
        });
    });

    // Wire remove buttons
    container.querySelectorAll('.plugin-remove-btn').forEach(btn => {
        btn.addEventListener('click', async function() {
            const pluginId = this.dataset.pluginId;
            const pluginName = this.dataset.pluginName;
            const confirmed = await showConfirm(
                'Remove Plugin',
                `Are you sure you want to remove "${pluginName}"? This will delete the plugin files and its cached data.`,
                { confirmLabel: 'Remove', danger: true }
            );
            if (!confirmed) return;

            this.disabled = true;
            this.textContent = 'Removing\u2026';
            try {
                const res = await window.electronAPI.removePlugin(pluginId);
                if (!res || !res.ok) {
                    showToast(`Remove failed: ${res ? res.error : 'Unknown error'}`, 'error');
                    this.disabled = false;
                    this.textContent = 'Remove';
                    return;
                }
                showToast(`Plugin "${pluginName}" removed`, 'success');
                _invalidatePluginCaches();
                // Clean localStorage state
                try {
                    const lsStates = JSON.parse(localStorage.getItem('pluginStates') || '{}');
                    delete lsStates[pluginId];
                    localStorage.setItem('pluginStates', JSON.stringify(lsStates));
                } catch { /* ignore */ }
                // Remove any injected settings tab for this plugin
                const tabId = `plugin-${pluginId}`;
                document.querySelectorAll(`.settings-tab[data-tab="${tabId}"]`).forEach(el => el.remove());
                document.querySelectorAll(`.settings-tab-content[data-tab="${tabId}"]`).forEach(el => el.remove());
                await initPluginsTab();
            } catch (err) {
                showToast(`Remove failed: ${err.message}`, 'error');
                this.disabled = false;
                this.textContent = 'Remove';
            }
        });
    });

    // Wire configure buttons
    container.querySelectorAll('.plugin-configure-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const pluginId = btn.dataset.pluginId;
            const tabId = `plugin-${pluginId}`;
            const tab = document.querySelector(`.settings-tab[data-tab="${tabId}"]`);
            const content = document.querySelector(`.settings-tab-content[data-tab="${tabId}"]`);
            if (tab && content) {
                openSettingsToTab(tabId);
            } else {
                showToast(`Settings panel for "${pluginId}" not available yet — try reopening Settings`, 'info');
            }
        });
    });

    // Wire order buttons (up/down priority)
    container.querySelectorAll('.plugin-order-up, .plugin-order-down').forEach(btn => {
        btn.addEventListener('click', async function() {
            const pluginId = this.dataset.pluginId;
            const isUp = this.classList.contains('plugin-order-up');
            // Read current order from DOM
            const rows = Array.from(container.querySelectorAll('.plugin-settings-row[data-plugin-id]'));
            const order = rows.map(r => r.dataset.pluginId);
            const idx = order.indexOf(pluginId);
            if (idx < 0) return;
            const swapIdx = isUp ? idx - 1 : idx + 1;
            if (swapIdx < 0 || swapIdx >= order.length) return;
            // Swap
            [order[idx], order[swapIdx]] = [order[swapIdx], order[idx]];
            try {
                await window.electronAPI.setPluginOrder(order);
                _invalidatePluginCaches();
                await initPluginsTab();
            } catch (err) {
                showToast(`Failed to reorder plugins: ${err.message}`, 'error');
            }
        });
    });
}

// Inject plugin panels + plugins tab when the settings modal is first opened
settingsModal.addEventListener('click', () => {}, { once: false }); // ensure settingsModal is referenced
(function() {
    let settingsOnceInit = false;
    const _onFirstOpen = () => {
        if (settingsOnceInit) return;
        settingsOnceInit = true;
        injectPluginSettingsPanels();
        initPluginsTab();
    };
    // Listen for the modal becoming visible
    const observer = new MutationObserver(() => {
        if (!settingsModal.classList.contains('hidden')) {
            _onFirstOpen();
            observer.disconnect();
        }
    });
    observer.observe(settingsModal, { attributes: true, attributeFilter: ['class'] });
})();

// ── Playback & Layout Toggle Listeners ──
// Layout mode toggle event listener
layoutModeToggle.addEventListener('change', () => {
    switchLayoutMode();
});

// Remember folder toggle event listener
rememberFolderToggle.addEventListener('change', () => {
    toggleRememberFolder();
});

// Include moving images toggle event listener
includeMovingImagesToggle.addEventListener('change', () => {
    toggleIncludeMovingImages();
});

// Use system trash toggle event listener
useSystemTrashToggle.addEventListener('change', () => {
    toggleUseSystemTrash();
});
// Restore system trash setting on startup
useSystemTrashToggle.checked = useSystemTrash;
useSystemTrashLabel.textContent = useSystemTrash ? 'On' : 'Off';
if (useSystemTrash) window.electronAPI.setUseSystemTrash(true);

// Linked duplicates toggle event listener
if (linkedDuplicatesToggle) {
    linkedDuplicatesToggle.addEventListener('change', () => {
        toggleLinkedDuplicates();
    });
    // Restore linked duplicates setting on startup
    const ldEnabled = localStorage.getItem('linkedDuplicates') === 'true';
    linkedDuplicatesToggle.checked = ldEnabled;
    if (linkedDuplicatesLabel) linkedDuplicatesLabel.textContent = ldEnabled ? 'On' : 'Off';
}

// Card info toggles
[cardInfoExtensionToggle, cardInfoResolutionToggle, cardInfoSizeToggle, cardInfoDateToggle, cardInfoDurationToggle, cardInfoStarsToggle, cardInfoAudioToggle, cardInfoFilenameToggle, cardInfoTagsToggle, cardInfoExtensionHoverToggle, cardInfoResolutionHoverToggle, cardInfoSizeHoverToggle, cardInfoDateHoverToggle, cardInfoStarsHoverToggle, cardInfoAudioHoverToggle, cardInfoFilenameHoverToggle, cardInfoTagsHoverToggle, cardInfoHoverTooltipToggle, tooltipShowNameToggle, tooltipShowPathToggle, tooltipShowDimensionsToggle, tooltipShowFileSizeToggle, tooltipShowDurationToggle, tooltipShowDateToggle, tooltipShowRatingToggle, tooltipShowTagsToggle]
    .filter(Boolean)
    .forEach(el => el.addEventListener('change', () => onCardInfoSettingsChanged()));
// Tooltip display option inputs (number + select)
[tooltipDelayInput, tooltipMaxWidthInput].filter(Boolean)
    .forEach(el => el.addEventListener('input', () => onCardInfoSettingsChanged()));
if (tooltipPositionSelect) tooltipPositionSelect.addEventListener('change', () => onCardInfoSettingsChanged());

// Pause on lightbox toggle
pauseOnLightboxToggle.addEventListener('change', () => {
    pauseOnLightbox = pauseOnLightboxToggle.checked;
    pauseOnLightboxLabel.textContent = pauseOnLightbox ? 'On' : 'Off';
    deferLocalStorageWrite('pauseOnLightbox', pauseOnLightbox.toString());
});

// Pause on blur toggle
pauseOnBlurToggle.addEventListener('change', () => {
    pauseOnBlur = pauseOnBlurToggle.checked;
    pauseOnBlurLabel.textContent = pauseOnBlur ? 'On' : 'Off';
    deferLocalStorageWrite('pauseOnBlur', pauseOnBlur.toString());
});

// Auto-repeat videos toggle
autoRepeatToggle.addEventListener('change', () => {
    autoRepeatVideos = autoRepeatToggle.checked;
    autoRepeatLabel.textContent = autoRepeatVideos ? 'On' : 'Off';
    deferLocalStorageWrite('autoRepeatVideos', autoRepeatVideos.toString());
    // Sync to current controller
    videoLoop = autoRepeatVideos;
    if (activePlaybackController) {
        activePlaybackController.setLoop(videoLoop);
    }
    if (mediaControlBarInstance) {
        mediaControlBarInstance.syncState({ loop: videoLoop });
    }
});

playbackControlsToggle.addEventListener('change', () => {
    playbackControlsEnabled = playbackControlsToggle.checked;
    playbackControlsLabel.textContent = playbackControlsEnabled ? 'On' : 'Off';
    deferLocalStorageWrite('playbackControls', playbackControlsEnabled.toString());
});

function applyZoomToFitNow() {
    if (lightbox.classList.contains('hidden')) return;
    const isImageVisible = lightboxImage.style.display === 'block';
    const isVideoVisible = lightboxVideo.style.display === 'block';
    const isCanvasVisible = lightboxGifCanvas.style.display === 'block';
    if (zoomToFit) {
        let fitLevel = 100;
        if (isCanvasVisible && activePlaybackController && activePlaybackController.gifWidth > 0) {
            const dims = getRotatedMediaDimensions(activePlaybackController.gifWidth, activePlaybackController.gifHeight);
            fitLevel = calculateFitZoomLevel(dims.width, dims.height);
        } else if (isImageVisible && lightboxImage.naturalWidth > 0) {
            const dims = getRotatedMediaDimensions(lightboxImage.naturalWidth, lightboxImage.naturalHeight);
            fitLevel = calculateFitZoomLevel(dims.width, dims.height);
        } else if (isVideoVisible && lightboxVideo.videoWidth > 0) {
            const dims = getRotatedMediaDimensions(lightboxVideo.videoWidth, lightboxVideo.videoHeight);
            fitLevel = calculateFitZoomLevel(dims.width, dims.height);
        }
        applyLightboxZoom(Math.max(100, fitLevel));
    } else {
        resetZoom();
    }
}

zoomToFitToggle.addEventListener('change', () => {
    zoomToFit = zoomToFitToggle.checked;
    zoomToFitLabel.textContent = zoomToFit ? 'On' : 'Off';
    if (lightboxZoomToFitToggle) lightboxZoomToFitToggle.checked = zoomToFit;
    deferLocalStorageWrite('zoomToFit', zoomToFit.toString());
    applyZoomToFitNow();
});

hoverScrubToggle.addEventListener('change', () => {
    hoverScrubEnabled = hoverScrubToggle.checked;
    hoverScrubLabel.textContent = hoverScrubEnabled ? 'On' : 'Off';
    deferLocalStorageWrite('hoverScrub', hoverScrubEnabled.toString());
});

gifHoverScrubToggle.addEventListener('change', () => {
    gifHoverScrubEnabled = gifHoverScrubToggle.checked;
    gifHoverScrubLabel.textContent = gifHoverScrubEnabled ? 'On' : 'Off';
    deferLocalStorageWrite('gifHoverScrub', gifHoverScrubEnabled.toString());
});

hoverPreviewStripToggle.addEventListener('change', () => {
    hoverPreviewStripEnabled = hoverPreviewStripToggle.checked;
    hoverPreviewStripLabel.textContent = hoverPreviewStripEnabled ? 'On' : 'Off';
    deferLocalStorageWrite('hoverPreviewStrip', hoverPreviewStripEnabled.toString());
});

// Lightbox filmstrip toggle
const lightboxFilmstripToggleEl = document.getElementById('lightbox-filmstrip-toggle');
const lightboxFilmstripLabelEl = document.getElementById('lightbox-filmstrip-label');
if (lightboxFilmstripToggleEl) {
    // Hydrate from saved state
    lightboxFilmstripToggleEl.checked = lightboxFilmstripEnabled;
    if (lightboxFilmstripLabelEl) lightboxFilmstripLabelEl.textContent = lightboxFilmstripEnabled ? 'On' : 'Off';
    lightboxFilmstripToggleEl.addEventListener('change', () => {
        lightboxFilmstripEnabled = lightboxFilmstripToggleEl.checked;
        if (lightboxFilmstripLabelEl) lightboxFilmstripLabelEl.textContent = lightboxFilmstripEnabled ? 'On' : 'Off';
        deferLocalStorageWrite('lightboxFilmstripEnabled', lightboxFilmstripEnabled.toString());
        // Live-apply: if disabled while lightbox is open, hide immediately.
        // Re-enabling takes effect on next lightbox open.
        if (!lightboxFilmstripEnabled && filmstripInstance) {
            filmstripInstance.hide();
        }
    });
}

lightboxZoomToFitToggle.addEventListener('change', () => {
    zoomToFit = lightboxZoomToFitToggle.checked;
    if (zoomToFitToggle) zoomToFitToggle.checked = zoomToFit;
    if (zoomToFitLabel) zoomToFitLabel.textContent = zoomToFit ? 'On' : 'Off';
    deferLocalStorageWrite('zoomToFit', zoomToFit.toString());
    applyZoomToFitNow();
});

// ── Sort / Quality Listeners ──
// Sorting dropdown event listeners
sortTypeSelect.addEventListener('change', () => {
    updateSorting();
});

sortOrderSelect.addEventListener('change', () => {
    updateSorting();
});

// Thumbnail quality select event listener
thumbnailQualitySelect.addEventListener('change', () => {
    thumbnailQuality = thumbnailQualitySelect.value;
    deferLocalStorageWrite('thumbnailQuality', thumbnailQuality);
    // Reload current folder to apply new quality
    if (currentFolderPath) {
        loadVideos(currentFolderPath, true, gridContainer.scrollTop);
    }
});


// ── Hover Scale Settings ──
// Hover expand setting (slider: 100 = no scale, 150 = 1.5x)
const hoverScaleState = {
    pct: 102,
    withZoom: false,
    at50: 120,
    at100: 102,
    at200: 100,
};

function applyHoverScale() {
    let pct;
    if (hoverScaleState.withZoom) {
        // Lerp between the 3 user-defined breakpoints based on current zoom
        const z = Math.max(50, Math.min(200, zoomLevel));
        if (z <= 100) {
            const t = (z - 50) / 50;
            pct = hoverScaleState.at50 + (hoverScaleState.at100 - hoverScaleState.at50) * t;
        } else {
            const t = (z - 100) / 100;
            pct = hoverScaleState.at100 + (hoverScaleState.at200 - hoverScaleState.at100) * t;
        }
    } else {
        pct = hoverScaleState.pct;
    }
    const scale = pct / 100;
    const lift = pct <= 100 ? 0 : Math.round((pct - 100) * 0.16);
    document.documentElement.style.setProperty('--hover-scale', String(scale));
    document.documentElement.style.setProperty('--hover-lift', `-${lift}px`);
    if (!hoverScaleState.withZoom && hoverScaleValue) {
        hoverScaleValue.textContent = (hoverScaleState.pct / 100).toFixed(2) + 'x';
    }
}

function updateHoverScaleUI() {
    if (hoverScaleFixedWrap) hoverScaleFixedWrap.style.display = hoverScaleState.withZoom ? 'none' : '';
    if (hoverScaleZoomRow) hoverScaleZoomRow.classList.toggle('hidden', !hoverScaleState.withZoom);
    if (hoverScaleZoomLabel) hoverScaleZoomLabel.textContent = hoverScaleState.withZoom ? 'Per-Zoom' : 'Fixed';
}

function formatZoomSliderValue(el, pct) {
    if (el) el.textContent = (pct / 100).toFixed(2) + 'x';
}

(function initHoverScale() {
    hoverScaleState.pct = parseInt(localStorage.getItem('hoverScale')) || 102;
    hoverScaleState.withZoom = localStorage.getItem('hoverScaleWithZoom') === 'true';
    hoverScaleState.at50 = parseInt(localStorage.getItem('hoverScaleAt50')) || 120;
    hoverScaleState.at100 = parseInt(localStorage.getItem('hoverScaleAt100')) || 102;
    hoverScaleState.at200 = parseInt(localStorage.getItem('hoverScaleAt200')) || 100;
    if (hoverScaleSlider) hoverScaleSlider.value = hoverScaleState.pct;
    if (hoverScaleZoomToggle) hoverScaleZoomToggle.checked = hoverScaleState.withZoom;
    if (hoverScaleZ50) hoverScaleZ50.value = hoverScaleState.at50;
    if (hoverScaleZ100) hoverScaleZ100.value = hoverScaleState.at100;
    if (hoverScaleZ200) hoverScaleZ200.value = hoverScaleState.at200;
    formatZoomSliderValue(hoverScaleValue, hoverScaleState.pct);
    formatZoomSliderValue(hoverScaleZ50Value, hoverScaleState.at50);
    formatZoomSliderValue(hoverScaleZ100Value, hoverScaleState.at100);
    formatZoomSliderValue(hoverScaleZ200Value, hoverScaleState.at200);
    updateHoverScaleUI();
    applyHoverScale();
})();

hoverScaleSlider.addEventListener('input', () => {
    hoverScaleState.pct = parseInt(hoverScaleSlider.value);
    applyHoverScale();
    deferLocalStorageWrite('hoverScale', String(hoverScaleState.pct));
});

hoverScaleZoomToggle.addEventListener('change', () => {
    hoverScaleState.withZoom = hoverScaleZoomToggle.checked;
    updateHoverScaleUI();
    applyHoverScale();
    deferLocalStorageWrite('hoverScaleWithZoom', String(hoverScaleState.withZoom));
});

hoverScaleZ50.addEventListener('input', () => {
    hoverScaleState.at50 = parseInt(hoverScaleZ50.value);
    formatZoomSliderValue(hoverScaleZ50Value, hoverScaleState.at50);
    applyHoverScale();
    deferLocalStorageWrite('hoverScaleAt50', String(hoverScaleState.at50));
});

hoverScaleZ100.addEventListener('input', () => {
    hoverScaleState.at100 = parseInt(hoverScaleZ100.value);
    formatZoomSliderValue(hoverScaleZ100Value, hoverScaleState.at100);
    applyHoverScale();
    deferLocalStorageWrite('hoverScaleAt100', String(hoverScaleState.at100));
});

hoverScaleZ200.addEventListener('input', () => {
    hoverScaleState.at200 = parseInt(hoverScaleZ200.value);
    formatZoomSliderValue(hoverScaleZ200Value, hoverScaleState.at200);
    applyHoverScale();
    deferLocalStorageWrite('hoverScaleAt200', String(hoverScaleState.at200));
});

// ── AI Visual Search Settings ──
// --- AI Visual Search settings event handlers ---

(function initAiSearchSettings() {
    const enabledToggle = document.getElementById('ai-search-enabled-toggle');
    const enabledLabel  = document.getElementById('ai-search-enabled-label');
    const autoScanToggle = document.getElementById('ai-auto-scan-toggle');
    const autoScanLabel  = document.getElementById('ai-auto-scan-label');
    const thresholdSlider = document.getElementById('ai-threshold-slider');
    const thresholdValue  = document.getElementById('ai-threshold-value');
    const clusteringSelect = document.getElementById('ai-clustering-select');
    const scanNowBtn   = document.getElementById('ai-scan-now-btn');
    const clearCacheBtn = document.getElementById('ai-clear-cache-btn');
    const aiToggleBtn  = document.getElementById('ai-search-toggle-btn');
    const searchBoxContainer = document.querySelector('.search-box-container');
    const searchBoxInput = document.getElementById('search-box');
    const statusDot  = document.getElementById('ai-status-dot');
    const statusText = document.getElementById('ai-status-text');

    // Apply persisted state to controls
    if (enabledToggle) enabledToggle.checked = aiVisualSearchEnabled;
    if (enabledLabel)  enabledLabel.textContent = aiVisualSearchEnabled ? 'On' : 'Off';
    if (autoScanToggle) autoScanToggle.checked = aiAutoScan;
    if (autoScanLabel)  autoScanLabel.textContent = aiAutoScan ? 'On' : 'Off';
    if (thresholdSlider) thresholdSlider.value = Math.round(aiSimilarityThreshold * 100);
    if (thresholdValue)  thresholdValue.textContent = `${clipScoreToDisplayPct(aiSimilarityThreshold)}%`;
    if (clusteringSelect) clusteringSelect.value = aiClusteringMode;

    // --- GPU acceleration controls ---
    const gpuModeSelect = document.getElementById('clip-gpu-mode-select');
    const gpuResetBtn   = document.getElementById('clip-gpu-reset-btn');
    const gpuStatusText = document.getElementById('clip-gpu-status-text');

    function refreshGpuStatus() {
        if (!gpuStatusText || !window.electronAPI.clipGpuStatus) return;
        window.electronAPI.clipGpuStatus().then((resp) => {
            const s = resp && resp.ok ? resp.value : null;
            if (!s) { gpuStatusText.textContent = ''; return; }
            const parts = [];
            if (s.lastProvider) parts.push(`using: ${s.lastProvider}`);
            if (s.envOverride) parts.push(`env: CLIP_GPU=${s.envOverride}`);
            if (s.knownBad) parts.push('known-bad flag set');
            if (s.sentinelPresent) parts.push('sentinel present');
            gpuStatusText.textContent = parts.length ? parts.join(' · ') : 'not initialised';
        }).catch(() => {});
    }

    if (gpuModeSelect) {
        gpuModeSelect.value = getClipGpuMode();
        gpuModeSelect.addEventListener('change', () => {
            const val = gpuModeSelect.value;
            localStorage.setItem('clipGpuMode', val);
            showToast('GPU setting saved. Restart the app or reload AI to apply.', 'info', { duration: 5000 });
        });
    }
    if (gpuResetBtn) {
        gpuResetBtn.addEventListener('click', async () => {
            if (!window.electronAPI.clipGpuReset) return;
            gpuResetBtn.disabled = true;
            try {
                const res = await window.electronAPI.clipGpuReset();
                showToast(res && res.ok ? 'GPU detection reset. Will re-probe next time AI loads.' : 'Reset failed', res && res.ok ? 'success' : 'error', { duration: 4000 });
            } catch (e) {
                showToast('Reset failed: ' + e.message, 'error');
            } finally {
                gpuResetBtn.disabled = false;
                refreshGpuStatus();
            }
        });
    }
    refreshGpuStatus();
    // Allow external code (settings tab switch) to refresh this view
    window.__refreshClipGpuStatus = refreshGpuStatus;

    function setAiStatusDot(state) {
        if (!statusDot) return;
        statusDot.classList.remove('loaded', 'loading', 'error');
        if (state) statusDot.classList.add(state);
    }

    function setAiStatus(state, text) {
        setAiStatusDot(state);
        if (statusText) statusText.textContent = text;
    }

    function showAiToggleBtn(visible) {
        if (!aiToggleBtn) return;
        aiToggleBtn.style.display = visible ? '' : 'none';
        if (searchBoxContainer) {
            searchBoxContainer.classList.toggle('has-ai-toggle', visible);
        }
    }

    function updateAiToggleBtnState() {
        if (!aiToggleBtn) return;
        aiToggleBtn.classList.toggle('active', aiSearchActive);
        aiToggleBtn.title = aiSearchActive ? 'AI Search: On (click to disable)' : 'AI Search: Off (click to enable)';
        if (searchBoxInput) {
            searchBoxInput.placeholder = aiSearchActive ? 'Search by content (e.g. "dog", "ocean")...' : 'Search files...';
        }
    }

    // --- Confirmation dialog elements ---
    const confirmOverlay   = document.getElementById('ai-model-confirm-overlay');
    const confirmCancelBtn = document.getElementById('ai-confirm-cancel-btn');
    const confirmDlBtn     = document.getElementById('ai-confirm-download-btn');
    const confirmDlProgress = document.getElementById('ai-confirm-download-progress');
    const confirmProgressFill = document.getElementById('ai-confirm-progress-fill');
    const confirmProgressFile = document.getElementById('ai-confirm-progress-file');
    const confirmProgressPct  = document.getElementById('ai-confirm-progress-pct');
    const confirmLink = document.getElementById('ai-confirm-link');

    // Open HuggingFace link in the system browser when clicked
    if (confirmLink) {
        confirmLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.electronAPI.openUrl('https://huggingface.co/Xenova/clip-vit-base-patch32').catch(() => {});
        });
    }

    function showConfirmDialog() {
        if (!confirmOverlay) return;
        if (confirmDlProgress) confirmDlProgress.style.display = 'none';
        if (confirmDlBtn) { confirmDlBtn.disabled = false; confirmDlBtn.textContent = 'Download & Enable'; }
        if (confirmCancelBtn) confirmCancelBtn.disabled = false;
        confirmOverlay.style.display = 'flex';
    }

    function hideConfirmDialog() {
        if (confirmOverlay) confirmOverlay.style.display = 'none';
    }

    function revertToggleOff() {
        aiVisualSearchEnabled = false;
        if (enabledToggle) enabledToggle.checked = false;
        if (enabledLabel) enabledLabel.textContent = 'Off';
        showAiToggleBtn(false);
        if (scanNowBtn) scanNowBtn.disabled = true;
    }

    async function doLoadModel() {
        setAiStatus('loading', 'Loading model...');
        try {
            const result = await window.electronAPI.clipInit(getClipGpuMode());
            if (result.ok) {
                setAiStatus('loaded', 'Model loaded');
                if (aiAutoScan && currentFolderPath) {
                    scheduleBackgroundEmbedding(currentItems);
                }
            } else {
                setAiStatus('error', 'Failed: ' + friendlyError(result.error || 'unknown error'));
                revertToggleOff();
            }
        } catch (err) {
            setAiStatus('error', 'Error: ' + err.message);
            revertToggleOff();
        }
    }

    // Download progress from main process → update dialog bar
    window.electronAPI.onClipDownloadProgress((event, progress) => {
        if (!confirmDlProgress || confirmDlProgress.style.display === 'none') return;
        if (progress.status === 'downloading' && progress.total > 0) {
            const pct = Math.round((progress.loaded / progress.total) * 100);
            if (confirmProgressFill) confirmProgressFill.style.width = pct + '%';
            if (confirmProgressFile) confirmProgressFile.textContent = progress.file || '';
            if (confirmProgressPct)  confirmProgressPct.textContent  = pct + '%';
        } else if (progress.status === 'done') {
            if (confirmProgressFill) confirmProgressFill.style.width = '100%';
            if (confirmProgressPct)  confirmProgressPct.textContent  = '100%';
        }
    });

    // Confirm: Download & Enable
    if (confirmDlBtn) {
        confirmDlBtn.addEventListener('click', async () => {
            confirmDlBtn.disabled = true;
            confirmDlBtn.textContent = 'Downloading...';
            if (confirmCancelBtn) confirmCancelBtn.disabled = true;
            if (confirmDlProgress) confirmDlProgress.style.display = 'block';
            if (confirmProgressFill) confirmProgressFill.style.width = '0%';
            if (confirmProgressFile) confirmProgressFile.textContent = 'Preparing...';
            if (confirmProgressPct)  confirmProgressPct.textContent  = '';

            await doLoadModel();
            if (aiVisualSearchEnabled) {
                // Only mark confirmed if the load actually succeeded
                aiModelDownloadConfirmed = true;
                localStorage.setItem('aiModelDownloadConfirmed', 'true');
            }
            hideConfirmDialog();
        });
    }

    // Confirm: Cancel
    if (confirmCancelBtn) {
        confirmCancelBtn.addEventListener('click', () => {
            hideConfirmDialog();
            revertToggleOff();
        });
    }

    // Restore state from previous session
    if (aiVisualSearchEnabled) {
        if (!aiModelDownloadConfirmed) {
            // Toggle was saved as enabled but user never confirmed the download dialog
            // (e.g. a previous bug prevented the dialog from showing). Reset to off.
            aiVisualSearchEnabled = false;
            localStorage.removeItem('aiVisualSearchEnabled');
            if (enabledToggle) enabledToggle.checked = false;
            if (enabledLabel) enabledLabel.textContent = 'Off';
        } else {
            // User previously confirmed — restore the enabled state and reload model silently
            showAiToggleBtn(true);
            updateAiToggleBtnState();
            if (scanNowBtn) scanNowBtn.disabled = false;
            window.electronAPI.clipStatus().then(s => {
                if (s.ok && s.value.loaded) {
                    setAiStatus('loaded', 'Model loaded');
                } else {
                    doLoadModel(); // Safe: user already confirmed the download
                }
            }).catch(() => {});
        }
    }

    // Enable/disable toggle
    if (enabledToggle) {
        enabledToggle.addEventListener('change', async () => {
            aiVisualSearchEnabled = enabledToggle.checked;
            enabledLabel.textContent = aiVisualSearchEnabled ? 'On' : 'Off';
            deferLocalStorageWrite('aiVisualSearchEnabled', aiVisualSearchEnabled.toString());

            if (aiVisualSearchEnabled) {
                showAiToggleBtn(true);
                updateAiToggleBtnState();
                if (scanNowBtn) scanNowBtn.disabled = false;

                // Always show confirmation dialog if user hasn't accepted it before
                if (!aiModelDownloadConfirmed) {
                    showConfirmDialog();
                } else {
                    await doLoadModel();
                }
            } else {
                // Turn off
                aiSearchActive = false;
                currentTextEmbedding = null;
                currentEmbeddings.clear(); bumpEmbeddingsVersion();
                cancelEmbeddingScan();
                showAiToggleBtn(false);
                updateAiToggleBtnState();
                if (scanNowBtn) scanNowBtn.disabled = true;
                setAiStatus(null, 'Model not loaded');
                applyFilters();
                window.electronAPI.clipTerminate().catch(() => {});
            }
        });
    }

    // Auto-scan toggle
    if (autoScanToggle) {
        autoScanToggle.addEventListener('change', () => {
            aiAutoScan = autoScanToggle.checked;
            autoScanLabel.textContent = aiAutoScan ? 'On' : 'Off';
            deferLocalStorageWrite('aiAutoScan', aiAutoScan.toString());
            if (aiAutoScan) _resetIdleTimer(); else _cancelIdlePreEmbedding();
        });
    }

    // Threshold slider
    if (thresholdSlider) {
        thresholdSlider.addEventListener('input', () => {
            aiSimilarityThreshold = parseInt(thresholdSlider.value, 10) / 100;
            thresholdValue.textContent = `${clipScoreToDisplayPct(aiSimilarityThreshold)}%`;
            deferLocalStorageWrite('aiSimilarityThreshold', aiSimilarityThreshold.toString());
            if (aiSearchActive && currentTextEmbedding) applyFilters();
        });
    }

    // Clustering select
    const clusteringStatus = document.getElementById('ai-clustering-status');
    const clusteringStatusText = document.getElementById('ai-clustering-status-text');

    if (clusteringSelect) {
        clusteringSelect.addEventListener('change', () => {
            aiClusteringMode = clusteringSelect.value;
            deferLocalStorageWrite('aiClusteringMode', aiClusteringMode);
            if (currentItems.length > 0) {
                // Show inline progress indicator while the worker computes clusters
                if (aiClusteringMode === 'similarity' && aiVisualSearchEnabled && currentEmbeddings.size > 0) {
                    if (clusteringStatus) clusteringStatus.classList.remove('hidden');
                    if (clusteringStatusText) clusteringStatusText.textContent = 'Clustering\u2026';
                    // Safety timeout: force-hide after 30s in case of silent failure
                    clearTimeout(clusteringSelect._safetyTimer);
                    clusteringSelect._safetyTimer = setTimeout(() => {
                        console.warn('[clustering] safety timeout — hiding stuck indicator');
                        if (clusteringStatus) clusteringStatus.classList.add('hidden');
                    }, 30000);
                }
                console.time('[clustering] applyFilters');
                applyFilters();
                console.timeEnd('[clustering] applyFilters');
            }
        });
    }

    // Scan now button
    if (scanNowBtn) {
        scanNowBtn.addEventListener('click', () => {
            if (!aiVisualSearchEnabled || !currentFolderPath) return;
            scheduleBackgroundEmbedding(currentItems);
        });
    }

    // Clear cache button
    if (clearCacheBtn) {
        clearCacheBtn.addEventListener('click', async () => {
            cancelEmbeddingScan();
            currentEmbeddings.clear(); bumpEmbeddingsVersion();
            await clearEmbeddingCache();
            setAiStatus(aiVisualSearchEnabled ? 'loaded' : null, aiVisualSearchEnabled ? 'Cache cleared — rescan to rebuild' : 'Model not loaded');
        });
    }

    // AI search toggle button in toolbar
    if (aiToggleBtn) {
        aiToggleBtn.addEventListener('click', () => {
            if (!aiVisualSearchEnabled) return;
            aiSearchActive = !aiSearchActive;
            if (!aiSearchActive) {
                currentTextEmbedding = null;
            }
            updateAiToggleBtnState();
            applyFilters();
        });
    }

    // Progress listener from main process
    window.electronAPI.onClipProgress((event, { current, total, phase }) => {
        updateEmbedProgressUI(current, total);
    });

    // GPU fallback notifications from main process
    if (window.electronAPI.onClipGpuFallback) {
        window.electronAPI.onClipGpuFallback((_event, info) => {
            const reason = (info && info.reason) || 'GPU disabled — using CPU.';
            showToast(reason, 'warning', { duration: 8000 });
        });
    }
})();

// ── Keyboard Shortcut Remapping System ──
// ============================================================================
// KEYBOARD SHORTCUT REMAPPING SYSTEM
// ============================================================================
const DEFAULT_SHORTCUTS = {
    undo:           { key: 'z', ctrl: true, label: 'Undo', category: 'File Actions' },
    redo:           { key: 'z', ctrl: true, shift: true, label: 'Redo', category: 'File Actions' },
    search:         { key: 'f', ctrl: true, label: 'Search', category: 'Navigation' },
    openFolder:     { key: 'o', ctrl: true, label: 'Open folder', category: 'Navigation' },
    openCard:       { key: 'Enter', label: 'Open selected card', category: 'Navigation' },
    deleteCard:     { key: 'Delete', label: 'Delete file', category: 'File Actions' },
    selectAll:      { key: 'a', ctrl: true, label: 'Select all', category: 'File Actions' },
    rename:         { key: 'F2', label: 'Rename file', category: 'File Actions' },
    tagPicker:      { key: 't', label: 'Open tag picker', category: 'File Actions' },
    goBack:         { key: 'Backspace', label: 'Go back', category: 'Navigation' },
    goBackAlt:      { key: 'b', ctrl: true, label: 'Go back (alt)', category: 'Navigation' },
    goForward:      { key: 'b', ctrl: true, shift: true, label: 'Go forward', category: 'Navigation' },
    filterAll:      { key: '1', label: 'Show all', category: 'Filters' },
    filterVideo:    { key: '2', label: 'Videos only', category: 'Filters' },
    filterImage:    { key: '3', label: 'Images only', category: 'Filters' },
    showShortcuts:  { key: '?', label: 'Show shortcuts', category: 'View' },
    toggleLayout:   { key: 'g', label: 'Toggle grid/masonry', category: 'View' },
    collapseSidebar:{ key: 's', label: 'Toggle sidebar', category: 'View' },
    lightboxOpen:   { key: ' ', label: 'Open lightbox', category: 'File Actions' },
    zoomIn:         { key: '+', label: 'Zoom in', category: 'View' },
    zoomOut:        { key: '-', label: 'Zoom out', category: 'View' },
    zoomReset:      { key: '0', label: 'Reset zoom', category: 'View' },
    slideshow:      { key: 'F5', label: 'Start slideshow', category: 'View' },
    compare:        { key: 'c', label: 'Compare selected', category: 'View' },
    commandPalette: { key: 'p', ctrl: true, label: 'Command palette', category: 'Navigation' },
    lb_prev:        { key: 'ArrowLeft', label: 'Previous', category: 'Lightbox' },
    lb_next:        { key: 'ArrowRight', label: 'Next', category: 'Lightbox' },
    lb_prevFrame:   { key: ',', label: 'Previous frame', category: 'Lightbox' },
    lb_nextFrame:   { key: '.', label: 'Next frame', category: 'Lightbox' },
    lb_playPause:   { key: ' ', label: 'Play / Pause', category: 'Lightbox' },
    lb_speedDown:   { key: '[', label: 'Speed down', category: 'Lightbox' },
    lb_speedUp:     { key: ']', label: 'Speed up', category: 'Lightbox' },
    lb_markIn:          { key: 'i', label: 'Mark loop in',       category: 'Lightbox' },
    lb_markOut:         { key: 'o', label: 'Mark loop out',      category: 'Lightbox' },
    lb_clearMarks:      { key: 'x', label: 'Clear loop marks',   category: 'Lightbox' },
    lb_rotateLeft:      { key: 'q', label: 'Rotate left',        category: 'Lightbox' },
    lb_rotateRight:     { key: 'w', label: 'Rotate right',       category: 'Lightbox' },
    lb_flipH:           { key: 'h', label: 'Flip horizontal',    category: 'Lightbox' },
    lb_flipV:           { key: 'v', label: 'Flip vertical',      category: 'Lightbox' },
    lb_cropImage:       { key: 'r', label: 'Crop image',         category: 'Lightbox' },
    lb_saveFrame:       { key: 'e', label: 'Save current frame', category: 'Lightbox' },
    lb_exportTrim:      { key: 'e', ctrl: true, label: 'Export trimmed range', category: 'Lightbox' },
    lb_toggleInspector: { key: 'p', label: 'Toggle inspector',   category: 'Lightbox' },
    convertFile:        { key: 'e', ctrl: true, shift: true, label: 'Convert file', category: 'File Actions' },
    dialogConfirm:  { key: 'Enter', label: 'Confirm dialog', category: 'Dialogs' },
    dialogCancel:   { key: 'Escape', label: 'Cancel dialog', category: 'Dialogs' },
    newTabGroup:    { key: 'g', ctrl: true, shift: true, label: 'New tab group', category: 'Tabs' },
    sidebarTabFilter: { key: 'e', alt: true, label: 'Filter sidebar to tabs', category: 'View' },
    sidebarTabFlat:   { key: 'e', alt: true, shift: true, label: 'Flat tab folder list', category: 'View' },
    toggleCanvasGrid: { key: 'g', ctrl: true, shift: true, alt: true, label: 'Toggle canvas grid', category: 'View' },
    toggleLinkedDuplicates: { key: '', label: 'Toggle linked duplicates', category: 'View' },
    moreLikeThis: { key: 'm', label: 'More Like This', category: 'View' },
};

// Merge user overrides over defaults
let userShortcutOverrides = {};
try {
    const saved = localStorage.getItem('keyboardShortcuts');
    if (saved) userShortcutOverrides = JSON.parse(saved);
} catch { /* use defaults */ }

function getShortcut(actionId) {
    const def = DEFAULT_SHORTCUTS[actionId];
    if (!def) return null;
    const override = userShortcutOverrides[actionId];
    if (override) return { ...def, ...override };
    return def;
}

function matchesShortcut(e, actionId) {
    const sc = getShortcut(actionId);
    if (!sc) return false;
    const wantCtrl = !!sc.ctrl;
    const wantAlt = !!sc.alt;
    const hasCtrl = e.ctrlKey || e.metaKey;
    if (wantCtrl !== hasCtrl) return false;
    if (wantAlt !== e.altKey) return false;

    const eKey = e.key;
    const scKey = sc.key;
    const wantShift = !!sc.shift;

    // Characters that inherently require Shift to produce — skip strict shift check for these
    const shiftProducedChars = new Set(['?', '+', '!', '@', '#', '$', '%', '^', '&', '*', '(', ')', '_', '{', '}', '|', ':', '"', '<', '>', '~']);

    // For shortcuts that use modifier keys (ctrl/alt), enforce shift strictly
    // For plain key shortcuts, be lenient about shift — allow e.g. Shift+C when shortcut is 'c'
    if (wantCtrl || wantAlt) {
        // With modifiers: shift must match exactly
        if (wantShift !== e.shiftKey) return false;
    } else if (wantShift) {
        // Shortcut explicitly wants shift but user didn't press it
        if (!e.shiftKey) return false;
    }
    // If shortcut doesn't want shift: allow shift for shift-produced chars and case-insensitive letters

    // Special key aliases
    if (scKey === ' ' && eKey === ' ') return true;
    if (scKey === '?' && (eKey === '?' || eKey === '/')) return true;
    if (scKey === '+' && (eKey === '+' || eKey === '=')) return true;
    if (scKey === '-' && eKey === '-') return true;

    // Case-insensitive match for letters, exact match for everything else
    if (eKey.toLowerCase() === scKey.toLowerCase()) return true;
    return false;
}

function shortcutToString(actionId) {
    const sc = getShortcut(actionId);
    if (!sc) return '';
    const parts = [];
    if (sc.ctrl) parts.push('Ctrl');
    if (sc.shift) parts.push('Shift');
    if (sc.alt) parts.push('Alt');
    const keyDisplay = {
        ' ': 'Space', 'ArrowLeft': 'Left', 'ArrowRight': 'Right',
        'ArrowUp': 'Up', 'ArrowDown': 'Down', 'Enter': 'Enter',
        'Backspace': 'Backspace', 'Delete': 'Delete', 'Escape': 'Esc',
        '?': '?', '+': '+', '-': '-', '0': '0',
        ',': ',', '.': '.', '[': '[', ']': ']',
    };
    const display = keyDisplay[sc.key] || sc.key.toUpperCase();
    parts.push(display);
    return parts.join('+');
}

function saveShortcuts() {
    deferLocalStorageWrite('keyboardShortcuts', JSON.stringify(userShortcutOverrides));
    rebuildShortcutsOverlay();
    renderShortcutSettings();
}

// ── Shortcut Settings UI ──
let recordingActionId = null;
let recordingHandler = null;

function renderShortcutSettings() {
    const container = document.getElementById('shortcut-categories');
    if (!container) return;
    container.innerHTML = '';

    // Group by category
    const categories = {};
    for (const [id, def] of Object.entries(DEFAULT_SHORTCUTS)) {
        const cat = def.category || 'Other';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(id);
    }

    for (const [catName, actionIds] of Object.entries(categories)) {
        const catDiv = document.createElement('div');
        catDiv.className = 'shortcut-category';
        const h4 = document.createElement('h4');
        h4.textContent = catName;
        catDiv.appendChild(h4);

        for (const actionId of actionIds) {
            const sc = getShortcut(actionId);
            const row = document.createElement('div');
            row.className = 'shortcut-row-editable';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'shortcut-action-name';
            nameSpan.textContent = sc.label;

            const keyDisplay = document.createElement('div');
            keyDisplay.className = 'shortcut-key-display';
            keyDisplay.dataset.action = actionId;
            const kbd = document.createElement('kbd');
            kbd.textContent = shortcutToString(actionId);
            keyDisplay.appendChild(kbd);
            keyDisplay.addEventListener('click', () => startShortcutRecording(actionId, keyDisplay));

            const resetBtn = document.createElement('button');
            resetBtn.className = 'shortcut-reset-btn';
            resetBtn.textContent = 'Reset';
            resetBtn.addEventListener('click', () => {
                delete userShortcutOverrides[actionId];
                saveShortcuts();
            });

            row.appendChild(nameSpan);
            row.appendChild(keyDisplay);
            // Only show reset if overridden
            if (userShortcutOverrides[actionId]) row.appendChild(resetBtn);

            catDiv.appendChild(row);
        }
        container.appendChild(catDiv);
    }
}

function startShortcutRecording(actionId, displayEl) {
    // Cancel previous recording
    stopShortcutRecording();

    recordingActionId = actionId;
    displayEl.classList.add('recording');
    displayEl.querySelector('kbd').textContent = 'Press a key...';

    recordingHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') { stopShortcutRecording(); renderShortcutSettings(); return; }
        // Ignore bare modifier keys
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

        const newBinding = { key: e.key };
        if (e.ctrlKey || e.metaKey) newBinding.ctrl = true;
        if (e.shiftKey) newBinding.shift = true;
        if (e.altKey) newBinding.alt = true;

        // Conflict detection
        const conflictId = findShortcutConflict(actionId, newBinding);
        if (conflictId) {
            // Swap: give the conflicting action our old binding
            const oldBinding = getShortcut(actionId);
            const conflictName = DEFAULT_SHORTCUTS[conflictId]?.label || conflictId;
            userShortcutOverrides[conflictId] = { key: oldBinding.key };
            if (oldBinding.ctrl) userShortcutOverrides[conflictId].ctrl = true;
            if (oldBinding.shift) userShortcutOverrides[conflictId].shift = true;
            if (oldBinding.alt) userShortcutOverrides[conflictId].alt = true;
            // Notify user about the swap
            showToast(`Swapped: "${conflictName}" moved to ${shortcutToString(conflictId)}`, 'info', { duration: 5000 });
        }

        userShortcutOverrides[actionId] = newBinding;
        stopShortcutRecording();
        saveShortcuts();
    };

    document.addEventListener('keydown', recordingHandler, true);
}

function stopShortcutRecording() {
    if (recordingHandler) {
        document.removeEventListener('keydown', recordingHandler, true);
        recordingHandler = null;
    }
    recordingActionId = null;
    document.querySelectorAll('.shortcut-key-display.recording').forEach(el => el.classList.remove('recording'));
}

function findShortcutConflict(excludeId, binding) {
    for (const [id, def] of Object.entries(DEFAULT_SHORTCUTS)) {
        if (id === excludeId) continue;
        // Same category context check: lightbox shortcuts don't conflict with grid shortcuts
        if (def.category !== DEFAULT_SHORTCUTS[excludeId]?.category) continue;
        const sc = getShortcut(id);
        if (sc.key.toLowerCase() === binding.key.toLowerCase() &&
            !!sc.ctrl === !!binding.ctrl &&
            !!sc.shift === !!binding.shift &&
            !!sc.alt === !!binding.alt) {
            return id;
        }
    }
    return null;
}

// Reset all shortcuts
document.getElementById('reset-all-shortcuts-btn')?.addEventListener('click', () => {
    userShortcutOverrides = {};
    saveShortcuts();
});

// ── Dynamic Shortcuts Help Overlay ──
// ── Dynamic Shortcuts Help Overlay ──
function rebuildShortcutsOverlay() {
    const body = document.getElementById('shortcuts-body-dynamic');
    if (!body) return;
    body.innerHTML = '';

    const categories = {};
    for (const [id, def] of Object.entries(DEFAULT_SHORTCUTS)) {
        const cat = def.category || 'Other';
        if (!categories[cat]) categories[cat] = [];
        categories[cat].push(id);
    }

    // Split into two columns
    const catEntries = Object.entries(categories);
    const mid = Math.ceil(catEntries.length / 2);
    for (let col = 0; col < 2; col++) {
        const colDiv = document.createElement('div');
        colDiv.className = 'shortcuts-column';
        const start = col === 0 ? 0 : mid;
        const end = col === 0 ? mid : catEntries.length;
        for (let i = start; i < end; i++) {
            const [catName, actionIds] = catEntries[i];
            const h3 = document.createElement('h3');
            h3.textContent = catName;
            colDiv.appendChild(h3);
            for (const actionId of actionIds) {
                const sc = getShortcut(actionId);
                const row = document.createElement('div');
                row.className = 'shortcut-row';
                const kbd = document.createElement('kbd');
                kbd.textContent = shortcutToString(actionId);
                const span = document.createElement('span');
                span.textContent = sc.label;
                row.appendChild(kbd);
                row.appendChild(span);
                colDiv.appendChild(row);
            }
        }
        body.appendChild(colDiv);
    }
}
rebuildShortcutsOverlay();

// ── New Settings Handlers ──
// ============================================================================
// NEW SETTINGS HANDLERS
// ============================================================================

// ── Utility: simple range-value wiring ──
function wireRangeDisplay(inputId, displayId, suffix, storageKey, onChangeCb) {
    const input = document.getElementById(inputId);
    const display = document.getElementById(displayId);
    if (!input || !display) return;
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) input.value = saved;
    display.textContent = input.value + suffix;
    input.addEventListener('input', () => {
        display.textContent = input.value + suffix;
        deferLocalStorageWrite(storageKey, input.value);
        if (onChangeCb) onChangeCb(parseInt(input.value, 10));
    });
}

function wireSelectStorage(selectId, storageKey, onChangeCb) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const saved = localStorage.getItem(storageKey);
    if (saved !== null) sel.value = saved;
    sel.addEventListener('change', () => {
        deferLocalStorageWrite(storageKey, sel.value);
        if (onChangeCb) onChangeCb(sel.value);
    });
}

// ── Phase 2: Grid Layout ──
wireRangeDisplay('grid-gap-slider', 'grid-gap-value', 'px', 'gridGap', (val) => {
    gridGapSetting = val;
    document.documentElement.style.setProperty('--gap', val + 'px');
    invalidateVsStyleCache();
    if (typeof applySorting === 'function') applySorting();
});

wireRangeDisplay('min-card-width-slider', 'min-card-width-value', 'px', 'minCardWidth', (val) => {
    minCardWidthSetting = val;
    if (typeof applySorting === 'function') applySorting();
});

wireSelectStorage('card-aspect-select', 'cardAspectRatio', (val) => {
    cardAspectRatioSetting = val;
    if (typeof applySorting === 'function') applySorting();
});

// ── Phase 3: Animation & Reduce Motion ──
function applyAnimationSpeed(speed) {
    const root = document.documentElement.style;
    const multipliers = { off: 0, fast: 0.5, normal: 1, relaxed: 1.67, slow: 2.67 };
    const m = multipliers[speed] ?? 1;
    root.setProperty('--duration-fast', (0.1 * m) + 's');
    root.setProperty('--duration-normal', (0.15 * m) + 's');
    root.setProperty('--duration-slow', (0.25 * m) + 's');
}
wireSelectStorage('animation-speed-select', 'animationSpeed', (val) => {
    animationSpeedSetting = val;
    applyAnimationSpeed(val);
});
applyAnimationSpeed(animationSpeedSetting);

(function initReduceMotion() {
    const toggle = document.getElementById('reduce-motion-toggle');
    const label = document.getElementById('reduce-motion-label');
    if (!toggle) return;
    toggle.checked = reduceMotionSetting;
    if (label) label.textContent = reduceMotionSetting ? 'On' : 'Off';
    if (reduceMotionSetting) document.body.classList.add('reduce-motion');
    toggle.addEventListener('change', () => {
        reduceMotionSetting = toggle.checked;
        if (label) label.textContent = toggle.checked ? 'On' : 'Off';
        document.body.classList.toggle('reduce-motion', toggle.checked);
        deferLocalStorageWrite('reduceMotion', String(toggle.checked));
    });
})();

// ── Phase 4: Extension Colors Editor ──
(function initExtensionColorEditor() {
    const container = document.getElementById('extension-colors-editor');
    if (!container) return;
    const exts = Object.keys(DEFAULT_EXTENSION_COLORS);
    for (const ext of exts) {
        const item = document.createElement('div');
        item.className = 'ext-color-item';
        const lbl = document.createElement('label');
        lbl.textContent = ext;
        const input = document.createElement('input');
        input.type = 'color';
        input.value = extensionColors[ext] || DEFAULT_EXTENSION_COLORS[ext];
        input.dataset.ext = ext;
        input.addEventListener('input', () => {
            extensionColors[ext] = input.value;
            deferLocalStorageWrite('extensionColors', JSON.stringify(extensionColors));
            // Re-render visible extension labels
            document.querySelectorAll('.card-extension').forEach(el => {
                if (el.textContent.trim().toUpperCase() === ext) {
                    el.style.backgroundColor = hexToRgba(input.value, 0.87);
                }
            });
        });
        item.appendChild(lbl);
        item.appendChild(input);
        container.appendChild(item);
    }
    document.getElementById('reset-extension-colors-btn')?.addEventListener('click', () => {
        extensionColors = { ...DEFAULT_EXTENSION_COLORS };
        localStorage.removeItem('extensionColors');
        container.querySelectorAll('input[type="color"]').forEach(inp => {
            inp.value = DEFAULT_EXTENSION_COLORS[inp.dataset.ext] || '#888888';
        });
        // Refresh all visible extension labels
        if (typeof applySorting === 'function') applySorting();
    });
})();

// ── Phase 5: Playback ──
(function initControlBarDelay() {
    const input = document.getElementById('control-bar-hide-delay');
    const display = document.getElementById('control-bar-hide-delay-value');
    if (!input || !display) return;
    const saved = localStorage.getItem('controlBarHideDelay');
    if (saved !== null) input.value = saved;
    const update = () => { display.textContent = (parseInt(input.value) / 1000) + 's'; };
    input.addEventListener('input', () => {
        update();
        deferLocalStorageWrite('controlBarHideDelay', input.value);
    });
    update();
})();

wireSelectStorage('default-slideshow-speed', 'defaultSlideshowSpeed', (val) => {
    defaultSlideshowSpeed = parseInt(val, 10);
});

wireRangeDisplay('video-thumb-seek', 'video-thumb-seek-value', '%', 'videoThumbSeekPct', (val) => {
    if (window.electronAPI?.updateMainSetting) window.electronAPI.updateMainSetting('videoThumbSeekPct', val);
});

// Playback speed options
(function initPlaybackSpeeds() {
    const input = document.getElementById('playback-speeds-input');
    if (!input) return;
    const saved = localStorage.getItem('playbackSpeeds');
    if (saved) {
        try { input.value = JSON.parse(saved).join(','); } catch {}
    }
    input.addEventListener('change', () => {
        const speeds = input.value.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n > 0);
        if (speeds.length > 0) {
            deferLocalStorageWrite('playbackSpeeds', JSON.stringify(speeds));
        }
    });
})();

// ── Phase 6: AI Settings ──
(function initAiIdleDelay() {
    const input = document.getElementById('ai-idle-delay');
    const display = document.getElementById('ai-idle-delay-value');
    if (!input || !display) return;
    const saved = localStorage.getItem('aiIdleDelay');
    if (saved !== null) input.value = saved;
    const update = () => { display.textContent = (parseInt(input.value) / 1000) + 's'; };
    input.addEventListener('input', () => {
        update();
        IDLE_DELAY_MS = parseInt(input.value, 10);
        deferLocalStorageWrite('aiIdleDelay', input.value);
    });
    update();
})();

wireSelectStorage('ai-batch-size', 'aiBatchSize', (val) => { IDLE_BATCH_SIZE = parseInt(val, 10); });
wireSelectStorage('ai-video-frames', 'aiVideoFrameCount');

// ── Phase 7: Performance ──
(function initPerfProfile() {
    const profileSel = document.getElementById('perf-profile');
    const customPanel = document.getElementById('perf-custom-sliders');
    if (!profileSel) return;

    const saved = localStorage.getItem('perfProfile');
    if (saved) profileSel.value = saved;
    if (customPanel) customPanel.classList.toggle('hidden', profileSel.value !== 'custom');

    profileSel.addEventListener('change', () => {
        deferLocalStorageWrite('perfProfile', profileSel.value);
        if (customPanel) customPanel.classList.toggle('hidden', profileSel.value !== 'custom');
    });
})();

wireRangeDisplay('perf-max-media', 'perf-max-media-value', '', 'maxMedia', (val) => { MAX_VIDEOS = val; MAX_IMAGES = val; MAX_TOTAL_MEDIA = val * 2; });
wireRangeDisplay('perf-parallel-load', 'perf-parallel-load-value', '', 'parallelLoad', (val) => { PARALLEL_LOAD_LIMIT = val; });
wireRangeDisplay('perf-vs-buffer', 'perf-vs-buffer-value', 'px', 'vsBuffer', (val) => { VS_BUFFER_PX = val; });
wireRangeDisplay('perf-pool-size', 'perf-pool-size-value', '', 'vsPoolSize', (val) => { VS_MAX_POOL_SIZE = val; });
wireRangeDisplay('perf-scroll-debounce', 'perf-scroll-debounce-value', 'ms', 'scrollDebounce', (val) => { SCROLL_DEBOUNCE_MS = val; });
wireRangeDisplay('perf-progressive-threshold', 'perf-progressive-threshold-value', '', 'progressiveThreshold', (val) => { PROGRESSIVE_RENDER_THRESHOLD = val; });

wireSelectStorage('folder-cache-ttl', 'folderCacheTTL', (val) => { FOLDER_CACHE_TTL = parseInt(val, 10); });
wireSelectStorage('idb-cache-ttl', 'idbCacheTTL', (val) => { INDEXEDDB_CACHE_TTL = parseInt(val, 10); });
wireSelectStorage('image-thumb-max-edge', 'imageThumbMaxEdge', (val) => { IMAGE_THUMBNAIL_MAX_EDGE = parseInt(val, 10); });
wireSelectStorage('video-thumb-width', 'videoThumbWidth', (val) => {
    if (window.electronAPI?.updateMainSetting) window.electronAPI.updateMainSetting('videoThumbWidth', val);
});

// Lightbox
wireRangeDisplay('lightbox-max-zoom', 'lightbox-max-zoom-value', '%', 'lightboxMaxZoom', (val) => {
    lightboxMaxZoomSetting = val;
    const lbSlider = document.getElementById('lightbox-zoom-slider');
    if (lbSlider) lbSlider.max = val;
});
wireRangeDisplay('lightbox-viewport', 'lightbox-viewport-value', '%', 'lightboxViewport', (val) => {
    lightboxViewportSetting = val;
    // Apply viewport usage via CSS variables
    document.documentElement.style.setProperty('--lightbox-max-w', val + 'vw');
    document.documentElement.style.setProperty('--lightbox-max-h', val + 'vh');
});
wireRangeDisplay('blow-up-delay', 'blow-up-delay-value', 'ms', 'blowUpDelay', (val) => { blowUpDelaySetting = val; });

// Limits
wireRangeDisplay('recent-files-limit', 'recent-files-limit-value', '', 'recentFilesLimit', (val) => { recentFilesLimitSetting = val; });
wireRangeDisplay('max-undo-history', 'max-undo-history-value', '', 'maxUndoHistory', (val) => { maxUndoHistorySetting = val; });
wireRangeDisplay('tag-suggestions-limit', 'tag-suggestions-limit-value', '', 'tagSuggestionsLimit', (val) => { tagSuggestionsLimitSetting = val; });
wireRangeDisplay('search-history-limit', 'search-history-limit-value', '', 'searchHistoryLimit', (val) => { searchHistoryLimitSetting = val; });

// ── Phase 8: Niche settings ──
wireRangeDisplay('io-concurrency', 'io-concurrency-value', '', 'ioConcurrency', (val) => {
    if (window.electronAPI?.updateMainSetting) window.electronAPI.updateMainSetting('ioConcurrency', val);
});
wireSelectStorage('clip-worker-count', 'clipWorkerCount');
wireRangeDisplay('retry-attempts', 'retry-attempts-value', '', 'retryAttempts', (val) => { MAX_RETRY_ATTEMPTS = val; });
wireRangeDisplay('retry-initial-delay', 'retry-initial-delay-value', 'ms', 'retryInitialDelay', (val) => { RETRY_INITIAL_DELAY_MS = val; });
wireRangeDisplay('retry-max-delay', 'retry-max-delay-value', 'ms', 'retryMaxDelay', (val) => { RETRY_MAX_DELAY_MS = val; });
wireRangeDisplay('sidebar-min-width', 'sidebar-min-width-value', 'px', 'sidebarMinWidth', (val) => {
    sidebarMinWidthSetting = val;
    document.documentElement.style.setProperty('--sidebar-min-width', val + 'px');
    // Clamp current sidebar width to new limits
    const cur = parseInt(folderSidebar.style.width) || sidebarWidth;
    if (cur < val) {
        folderSidebar.style.width = val + 'px';
        sidebarWidth = val;
        deferLocalStorageWrite('sidebarWidth', String(val));
    }
});
wireRangeDisplay('sidebar-max-width', 'sidebar-max-width-value', 'px', 'sidebarMaxWidth', (val) => {
    sidebarMaxWidthSetting = val;
    document.documentElement.style.setProperty('--sidebar-max-width', val + 'px');
    // Clamp current sidebar width to new limits
    const cur = parseInt(folderSidebar.style.width) || sidebarWidth;
    if (cur > val) {
        folderSidebar.style.width = val + 'px';
        sidebarWidth = val;
        deferLocalStorageWrite('sidebarWidth', String(val));
    }
});
wireSelectStorage('folder-preview-count', 'folderPreviewCount', (val) => {
    folderPreviewCountSetting = parseInt(val, 10);
    // Clear cached previews so folders re-fetch with new count
    folderPreviewCache.clear();
    // Remove existing preview grids so they re-render on next scroll
    document.querySelectorAll('.folder-card[data-preview-loaded="1"]').forEach(card => {
        const grid = card.querySelector('.folder-preview-grid');
        if (grid) grid.remove();
        delete card.dataset.previewLoaded;
    });
});
wireSelectStorage('folder-preview-size', 'folderPreviewSize', (val) => { folderPreviewSizeSetting = parseInt(val, 10); });

// ── Reset All Settings ──
document.getElementById('reset-all-settings-btn')?.addEventListener('click', async () => {
    const confirmed = await showConfirm('Reset All Settings', 'This will restore every setting to its default value and reload the app.', { confirmLabel: 'Reset', danger: true });
    if (confirmed) {
        localStorage.clear();
        location.reload();
    }
});

// ── CSS Variable Hydration on startup ──
(function hydrateCSSVariables() {
    const root = document.documentElement.style;
    root.setProperty('--gap', gridGapSetting + 'px');
    root.setProperty('--sidebar-min-width', sidebarMinWidthSetting + 'px');
    root.setProperty('--sidebar-max-width', sidebarMaxWidthSetting + 'px');
    root.setProperty('--lightbox-max-w', lightboxViewportSetting + 'vw');
    root.setProperty('--lightbox-max-h', lightboxViewportSetting + 'vh');
    // Sync lightbox zoom slider max
    const lbSlider = document.getElementById('lightbox-zoom-slider');
    if (lbSlider) lbSlider.max = lightboxMaxZoomSetting;
})();

// Initialize shortcut settings tab
renderShortcutSettings();

// ── Settings Search ──
(function initSettingsSearch() {
    const searchInput = document.getElementById('settings-search-input');
    if (!searchInput) return;

    searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase().trim();
        const tabContents = document.querySelectorAll('.settings-tab-content');

        if (!query) {
            // Clear search: show all items, remove no-matches indicators
            document.querySelectorAll('.settings-item.settings-search-hidden').forEach(el => {
                el.classList.remove('settings-search-hidden');
            });
            tabContents.forEach(tc => {
                tc.classList.remove('settings-search-no-matches');
                tc.style.display = '';
            });
            return;
        }

        tabContents.forEach(tabContent => {
            const items = tabContent.querySelectorAll('.settings-item');
            let hasMatch = false;

            items.forEach(item => {
                const title = (item.querySelector('.settings-item-title')?.textContent || '').toLowerCase();
                const desc = (item.querySelector('.settings-item-description')?.textContent || '').toLowerCase();
                const matches = title.includes(query) || desc.includes(query);
                item.classList.toggle('settings-search-hidden', !matches);
                if (matches) hasMatch = true;
            });

            tabContent.classList.toggle('settings-search-no-matches', !hasMatch);
        });

        // Show all tabs during search (don't hide non-active tabs)
        tabContents.forEach(tc => {
            if (!tc.classList.contains('settings-search-hidden')) {
                tc.style.display = '';
            }
        });
    });

    // Clear search when switching tabs
    const tabs = document.querySelectorAll('.settings-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            if (searchInput.value) {
                searchInput.value = '';
                searchInput.dispatchEvent(new Event('input'));
            }
        });
    });
})();
