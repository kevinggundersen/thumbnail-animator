// ═══════════════════════════════════════════════════════════════════════════
// FILTER / SORT WORKER BRIDGE
// Extracted from renderer.js.  Offloads the filter/sort pipeline to a
// Web Worker (filter-sort-worker.js) with a trigram index.  Falls back to
// synchronous main-thread filtering when the worker is unavailable.
//
// Communicates with renderer.js via a host object (window.__filterBridgeHost)
// that provides read-only getters for state and callbacks for side effects.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

class FilterWorkerBridge {
    constructor(host) {
        this._host = host;
        this._worker = null;
        this._token = 0;
        this._lastToken = 0;
        this._itemsRef = null;
        this._lastLen = -1;
        this._ratingsVersion = 0;
        this._ratingsSyncedVersion = -1;
        this._pinsVersion = 0;
        this._pinsSyncedVersion = -1;
        this._tagFilterVersion = 0;
        this._tagFilterSyncedVersion = -1;
        this._embSyncedSize = -1;
        this._embVersion = 0;
        this._embSyncedVersion = -1;
        this._syncedEmbPaths = new Set();
        this._clusteringStatusTimer = null;
        this._dedupVersion = 0;
        this._dedupSyncedVersion = -1;
    }

    // ── Public API ────────────────────────────────────────────────────

    bumpRatingsVersion()   { this._ratingsVersion++; }
    bumpPinsVersion()      { this._pinsVersion++; }
    bumpTagFilterVersion() { this._tagFilterVersion++; }
    bumpEmbeddingsVersion(){ this._embVersion++; }
    bumpDedupVersion()     { this._dedupVersion++; }
    markItemsStale()       { this._itemsRef = null; }

    /**
     * Main entry point — called from 15+ locations.
     * Tries the worker pipeline; falls back to synchronous main-thread filtering.
     */
    applyFilters() {
        const perfStart = perfTest.start();
        const h = this._host;
        if (h.currentItems.length === 0) return;

        if (this._applyFiltersViaWorker()) {
            perfTest.end('applyFilters', perfStart, { cardCount: h.currentItems.length, detail: 'worker' });
            return;
        }

        this._applyFiltersMainThread(perfStart);
    }

    // ── Worker lifecycle ──────────────────────────────────────────────

    _getOrSpawnWorker() {
        if (this._worker) return this._worker;
        try {
            this._worker = new Worker('filter-sort-worker.js');
            this._worker.onmessage = (e) => {
                const msg = e.data;
                if (!msg) return;
                if (msg.type === 'error') {
                    console.error('[filter-worker] pipeline error:', msg.error);
                    this._hideClusteringStatus();
                    return;
                }
                if (msg.type !== 'result') return;
                if (msg.token !== this._lastToken) return;
                this._applyWorkerResult(msg);
            };
            this._worker.onerror = (err) => {
                console.error('filter-sort-worker error:', err);
                this._hideClusteringStatus();
            };
        } catch (e) {
            console.warn('Failed to spawn filter worker; falling back to main-thread filtering:', e);
            this._host.showToastOnce('filter-worker-fail',
                'Filtering is running on the main thread',
                'warning',
                { details: 'A worker failed to spawn; sorting large folders may feel slower.' }
            );
            this._worker = null;
        }
        return this._worker;
    }

    // ── State sync ────────────────────────────────────────────────────

    _syncItems() {
        const w = this._getOrSpawnWorker();
        if (!w) return false;
        const items = this._host.currentItems;
        if (this._itemsRef !== items || this._lastLen !== items.length) {
            const slim = new Array(items.length);
            for (let i = 0; i < items.length; i++) {
                const it = items[i];
                slim[i] = {
                    type: it.type,
                    path: it.path,
                    folderPath: it.folderPath,
                    name: it.name,
                    mtime: it.mtime,
                    size: it.size,
                    width: it.width,
                    height: it.height,
                    missing: it.missing,
                    aspectRatio: it.aspectRatio
                };
            }
            w.postMessage({ type: 'setItems', items: slim });
            this._itemsRef = items;
            this._lastLen = items.length;
        }
        return true;
    }

    _syncRatings() {
        const w = this._getOrSpawnWorker();
        if (!w) return;
        if (this._ratingsSyncedVersion === this._ratingsVersion) return;
        // When linked duplicates is enabled, use resolved ratings (hash overlay on top of per-path)
        const ratings = (typeof buildResolvedRatings === 'function') ? buildResolvedRatings() : this._host.fileRatings;
        w.postMessage({ type: 'setRatings', ratings });
        this._ratingsSyncedVersion = this._ratingsVersion;
    }

    _syncPins() {
        const w = this._getOrSpawnWorker();
        if (!w) return;
        if (this._pinsSyncedVersion === this._pinsVersion) return;
        // When linked duplicates is enabled, use resolved pins (hash overlay on top of per-path)
        const resolvedPins = (typeof buildResolvedPins === 'function') ? buildResolvedPins() : this._host.pinnedFiles;
        const paths = (typeof resolvedPins === 'object' && resolvedPins) ? Object.keys(resolvedPins) : [];
        w.postMessage({ type: 'setPins', paths });
        this._pinsSyncedVersion = this._pinsVersion;
    }

    _syncTagFilter() {
        const w = this._getOrSpawnWorker();
        if (!w) return;
        if (this._tagFilterSyncedVersion === this._tagFilterVersion) return;
        const h = this._host;
        const paths = (h.tagFilterActive && h.tagFilteredPaths) ? Array.from(h.tagFilteredPaths) : null;
        w.postMessage({ type: 'setTagFilter', paths });
        this._tagFilterSyncedVersion = this._tagFilterVersion;
    }

    _syncEmbeddingsIfNeeded() {
        const w = this._getOrSpawnWorker();
        if (!w) return;
        const emb = this._host.currentEmbeddings;

        const versionChanged = this._embSyncedVersion !== this._embVersion;
        const sizeChanged = Math.abs(emb.size - this._embSyncedSize) >= 16;
        if (!versionChanged && !sizeChanged) return;

        if (versionChanged) {
            const obj = {};
            for (const [k, v] of emb) obj[k] = v;
            w.postMessage({ type: 'setEmbeddings', embeddings: obj });
            this._syncedEmbPaths.clear();
            for (const k of emb.keys()) this._syncedEmbPaths.add(k);
            this._embSyncedVersion = this._embVersion;
            this._embSyncedSize = emb.size;
            return;
        }

        // Delta sync
        const entries = [];
        const removed = [];
        for (const [k, v] of emb) {
            if (!this._syncedEmbPaths.has(k)) entries.push({ path: k, vec: v });
        }
        for (const k of this._syncedEmbPaths) {
            if (!emb.has(k)) removed.push(k);
        }

        if (entries.length === 0 && removed.length === 0) {
            this._embSyncedSize = emb.size;
            return;
        }

        w.postMessage({ type: 'setEmbeddingsBatch', entries, removed });
        for (const e of entries) this._syncedEmbPaths.add(e.path);
        for (const r of removed) this._syncedEmbPaths.delete(r);
        this._embSyncedSize = emb.size;
    }

    _syncTextEmbedding() {
        const w = this._getOrSpawnWorker();
        if (!w) return;
        w.postMessage({ type: 'setTextEmbedding', vec: this._host.currentTextEmbedding || null });
    }

    _syncFindSimilarEmbedding() {
        const w = this._getOrSpawnWorker();
        if (!w) return;
        w.postMessage({ type: 'setFindSimilarEmbedding', vec: this._host.findSimilarState.embedding || null });
    }

    _syncDedup() {
        const w = this._getOrSpawnWorker();
        if (!w) return;
        if (this._dedupSyncedVersion === this._dedupVersion) return;
        const enabled = (typeof isLinkedDuplicatesEnabled === 'function') && isLinkedDuplicatesEnabled();
        const pathToHash = (typeof _pathToHash !== 'undefined') ? _pathToHash : {};
        w.postMessage({ type: 'setDuplicateGroups', dedupEnabled: enabled, pathToHash });
        this._dedupSyncedVersion = this._dedupVersion;
    }

    // ── Worker dispatch ───────────────────────────────────────────────

    _applyFiltersViaWorker() {
        const h = this._host;
        if (h.currentItems.length === 0) return false;
        const w = this._getOrSpawnWorker();
        if (!w) return false;

        this._syncItems();
        this._syncRatings();
        this._syncPins();
        this._syncTagFilter();
        this._syncTextEmbedding();
        this._syncFindSimilarEmbedding();
        this._syncDedup();

        if (h.aiSearchActive || h.aiClusteringMode === 'similarity' || h.findSimilarState.active) {
            if (h.aiClusteringMode === 'similarity' && this._embSyncedSize !== h.currentEmbeddings.size) {
                this._embSyncedVersion = -1;
            }
            this._syncEmbeddingsIfNeeded();
        }

        const token = ++this._token;
        this._lastToken = token;

        const ops = h.parsedSearchQuery.operators;
        const effectiveAdvanced = h.operatorsHaveFilters(ops)
            ? h.mergeOperatorFilters(h.advancedSearchFilters, ops)
            : h.advancedSearchFilters;
        let effectiveFilter = h.currentFilter;
        if (ops.typeFilter === 'video' || ops.typeFilter === 'image') effectiveFilter = ops.typeFilter;

        const state = {
            query: h.parsedSearchQuery.freeText,
            currentFilter: effectiveFilter,
            includeMovingImages: h.includeMovingImages,
            starFilterActive: h.starFilterActive,
            starSortOrder: h.starSortOrder,
            tagFilterActive: h.tagFilterActive,
            findSimilarActive: h.findSimilarState.active,
            findSimilarAllFolders: h.findSimilarState.allFolders,
            findSimilarThreshold: h.findSimilarState.threshold,
            aiVisualSearchEnabled: h.aiVisualSearchEnabled,
            aiSearchActive: h.aiSearchActive,
            aiSimilarityThreshold: h.aiSimilarityThreshold,
            aiClusteringMode: h.aiClusteringMode,
            advancedSearchFilters: effectiveAdvanced,
            sortType: h.sortType,
            sortOrder: h.sortOrder,
            groupByDate: h.groupByDate,
            dateGroupGranularity: h.dateGroupGranularity,
            collapsedGroups: Array.from(h.collapsedDateGroups || [])
        };
        w.postMessage({ type: 'applyFilters', token, state });
        return true;
    }

    // ── Worker result handling ─────────────────────────────────────────

    _applyWorkerResult(msg) {
        console.log(`[renderer] received worker result: ${msg.indices?.length} items, groupHeaders=${msg.groupHeadersPresent}`);
        if (this._itemsRef !== this._host.currentItems) {
            console.warn('[renderer] dropping stale worker result (currentItems changed)');
            this._hideClusteringStatus();
            return;
        }
        try { this._applyWorkerResultInner(msg); } finally { this._hideClusteringStatus(); }
    }

    _applyWorkerResultInner(msg) {
        const h = this._host;
        h.setGroupHeadersPresent(!!msg.groupHeadersPresent);

        const indices = msg.indices;
        const synthetics = msg.synthetics || [];
        const scores = msg.scores || {};
        const aiScores = scores.ai || null;
        const simScores = scores.sim || null;
        const ratings = scores.ratings || null;
        const currentItems = h.currentItems;

        const items = new Array(indices.length);
        let nulled = 0;
        for (let k = 0; k < indices.length; k++) {
            const idx = indices[k];
            if (idx < 0) {
                items[k] = synthetics[-idx - 1];
            } else {
                const orig = currentItems[idx];
                if (!orig) { items[k] = null; nulled++; continue; }
                if (aiScores)  orig._aiScore = aiScores[idx];
                if (simScores) orig._similarityScore = simScores[idx];
                if (ratings)   orig._cachedRating = ratings[idx];
                items[k] = orig;
            }
        }
        let finalItems = nulled > 0 ? items.filter(x => x != null) : items;
        finalItems = this._applyOperatorPostFilter(finalItems);
        let visibleCount = 0;
        for (const item of finalItems) {
            if (item && item.type !== 'group-header') visibleCount++;
        }

        if (h.vsStateEnabled) {
            h.vsUpdateItems(finalItems, { preserveScroll: true });
        }
        h.setFilteredVisibleCountCache(finalItems, visibleCount);
        h.updateItemCount();
        h.updateSearchResultCount(visibleCount);
        h.clearSearchDebounceIndicator();
        h.hideLoadingIndicator();
        if (typeof h.refreshVisibleFilenameHighlights === 'function') h.refreshVisibleFilenameHighlights();
    }

    // ── Operator post-filter (main-thread only) ───────────────────────

    _applyOperatorPostFilter(items) {
        const ops = this._host.parsedSearchQuery.operators;
        const needsSize = ops.sizeValue != null && ops.sizeOperator;
        const needsDate = ops.dateFrom != null || ops.dateTo != null;
        const needsTagFilter = (ops._includedPaths && ops.tagNames.length > 0)
            || (ops._excludedPaths && ops.tagExcludeNames.length > 0);
        const needsGifFilter = ops.typeFilter === 'gif';
        const needsFolderFilter = ops.typeFilter === 'folder';
        if (!needsSize && !needsDate && !needsTagFilter && !needsGifFilter && !needsFolderFilter) return items;

        const normalizePath = this._host.normalizePath;
        return items.filter(item => {
            if (!item || item.type === 'group-header') return true;
            if (needsFolderFilter && item.type !== 'folder') return false;
            if (needsGifFilter) {
                if (item.type === 'folder') return false;
                const lower = (item.name || '').toLowerCase();
                if (!lower.endsWith('.gif') && !lower.endsWith('.webp')) return false;
            }
            if (item.type !== 'folder' && needsSize) {
                const s = item.size;
                if (s == null) return false;
                const v = ops.sizeValue;
                switch (ops.sizeOperator) {
                    case '>':  if (!(s > v)) return false; break;
                    case '>=': if (!(s >= v)) return false; break;
                    case '<':  if (!(s < v)) return false; break;
                    case '<=': if (!(s <= v)) return false; break;
                    case '=':  if (s !== v) return false; break;
                }
            }
            if (item.type !== 'folder' && needsDate) {
                const m = item.mtime || 0;
                if (ops.dateFrom != null && m < ops.dateFrom) return false;
                if (ops.dateTo != null && m > ops.dateTo) return false;
            }
            if (needsTagFilter && item.type !== 'folder' && item.path) {
                const np = normalizePath(item.path);
                if (ops.tagNames.length > 0 && ops._includedPaths && !ops._includedPaths.has(np)) return false;
                if (ops.tagExcludeNames.length > 0 && ops._excludedPaths && ops._excludedPaths.has(np)) return false;
            }
            return true;
        });
    }

    // ── Main-thread fallback ──────────────────────────────────────────

    _applyFiltersMainThread(perfStart) {
        const h = this._host;
        const query = (h.parsedSearchQuery.freeText || '').toLowerCase().trim();

        const filteredItems = h.currentItems.filter(item => {
            const fileName = item.name.toLowerCase();

            let matchesSearch;
            if (query === '') {
                matchesSearch = true;
            } else if (h.aiVisualSearchEnabled && h.aiSearchActive && h.currentTextEmbedding && item.type !== 'folder') {
                const embedding = h.currentEmbeddings.get(item.path);
                if (embedding) {
                    const sim = h.cosineSimilarity(h.currentTextEmbedding, embedding);
                    item._aiScore = sim;
                    matchesSearch = sim >= h.aiSimilarityThreshold;
                } else {
                    item._aiScore = 0;
                    matchesSearch = fileName.includes(query);
                }
            } else {
                matchesSearch = fileName.includes(query);
            }
            if (!matchesSearch) return false;

            if (h.aiVisualSearchEnabled && h.aiSearchActive && h.currentTextEmbedding && query !== '' && item.type !== 'folder' && h.isFilePinned(item.path)) {
                return false;
            }

            let matchesFilter = true;
            const isMoving = item.animated || fileName.endsWith('.gif');
            if (h.currentFilter === 'video') {
                matchesFilter = item.type === 'video' ||
                    (h.includeMovingImages && item.type === 'image' && isMoving);
            } else if (h.currentFilter === 'image') {
                const isImage = item.type === 'image';
                matchesFilter = isImage && !(h.includeMovingImages && isMoving);
            }
            if (!matchesFilter) return false;

            const needsRating = h.starFilterActive || h.advancedSearchFilters.starRating !== null;
            if (needsRating && item.type !== 'folder' && item.path) {
                item._cachedRating = h.getFileRating(item.path);
            }

            if (h.starFilterActive) {
                if (item.type === 'folder') return false;
                if ((item._cachedRating || 0) <= 0) return false;
            }

            if (h.tagFilterActive && h.tagFilteredPaths) {
                if (item.type === 'folder') return false;
                if (!h.tagFilteredPaths.has(h.normalizePath(item.path))) return false;
            }

            if (h.findSimilarState.active && h.findSimilarState.embedding && !h.findSimilarState.allFolders) {
                if (item.type === 'folder') return false;
                const emb = h.currentEmbeddings.get(item.path);
                if (!emb) return false;
                const sim = h.cosineSimilarity(h.findSimilarState.embedding, emb);
                item._similarityScore = sim;
                if (sim < h.findSimilarState.threshold) return false;
            }

            if (h.advancedSearchFilters.width || h.advancedSearchFilters.height) {
                if (h.advancedSearchFilters.width && item.width !== h.advancedSearchFilters.width) return false;
                if (h.advancedSearchFilters.height && item.height !== h.advancedSearchFilters.height) return false;
            }

            if (h.advancedSearchFilters.aspectRatio) {
                if (item.width && item.height) {
                    const ratio = item.width / item.height;
                    const targetRatio = h.parseAspectRatio(h.advancedSearchFilters.aspectRatio);
                    if (Math.abs(ratio - targetRatio) > 0.1) return false;
                } else {
                    return false;
                }
            }

            if (h.advancedSearchFilters.starRating !== null && item.path) {
                if ((item._cachedRating || 0) < h.advancedSearchFilters.starRating) return false;
            }

            return true;
        });

        let sortedFiltered = filteredItems;
        if (h.starFilterActive && h.starSortOrder !== 'none') {
            sortedFiltered = [...filteredItems].sort((a, b) => {
                if (a.type === 'folder' && b.type === 'folder') return 0;
                if (a.type === 'folder') return 1;
                if (b.type === 'folder') return -1;
                const aRating = a._cachedRating || 0;
                const bRating = b._cachedRating || 0;
                return h.starSortOrder === 'asc' ? aRating - bRating : bRating - aRating;
            });
        }

        if (h.aiVisualSearchEnabled && h.aiSearchActive && h.currentTextEmbedding && query !== '') {
            sortedFiltered = [...sortedFiltered].sort((a, b) => {
                if (a.type === 'folder') return 1;
                if (b.type === 'folder') return -1;
                return (b._aiScore || 0) - (a._aiScore || 0);
            });
        }

        if (h.findSimilarState.active && h.findSimilarState.embedding && !h.findSimilarState.allFolders) {
            sortedFiltered = [...sortedFiltered].sort((a, b) => {
                if (a.type === 'folder') return 1;
                if (b.type === 'folder') return -1;
                return (b._similarityScore || 0) - (a._similarityScore || 0);
            });
        }

        if (h.aiVisualSearchEnabled && h.aiClusteringMode === 'similarity' && h.currentEmbeddings.size > 0 && query === '') {
            sortedFiltered = h.applyVisualClustering(sortedFiltered);
        }

        // Partition pinned items to top
        {
            const pinnedFolders = [], unpinnedFolders = [], pinnedFiles = [], unpinnedFiles = [];
            for (const item of sortedFiltered) {
                const isFolder = item.type === 'folder';
                const pinned = h.isFilePinned(item.path);
                if (isFolder) (pinned ? pinnedFolders : unpinnedFolders).push(item);
                else (pinned ? pinnedFiles : unpinnedFiles).push(item);
            }
            sortedFiltered = pinnedFolders.concat(unpinnedFolders, pinnedFiles, unpinnedFiles);
        }

        sortedFiltered = this._applyOperatorPostFilter(sortedFiltered);

        // Linked duplicates: dedup pass (main-thread fallback)
        if (typeof isLinkedDuplicatesEnabled === 'function' && isLinkedDuplicatesEnabled()
            && typeof _pathToHash !== 'undefined' && Object.keys(_pathToHash).length > 0) {
            const seen = new Set();
            sortedFiltered = sortedFiltered.filter(item => {
                if (!item || item.type === 'folder' || item.type === 'group-header') return true;
                const hash = _pathToHash[h.normalizePath(item.path)];
                if (!hash) return true;
                if (seen.has(hash)) return false;
                seen.add(hash);
                return true;
            });
        }

        if (h.vsStateEnabled) {
            h.vsUpdateItems(sortedFiltered, { preserveScroll: true });
        }
        const visibleCount = sortedFiltered.length;
        h.setFilteredVisibleCountCache(sortedFiltered, visibleCount);
        h.updateItemCount();
        h.updateSearchResultCount(visibleCount);
        h.clearSearchDebounceIndicator();
        this._hideClusteringStatus();
        h.hideLoadingIndicator();
        if (typeof h.refreshVisibleFilenameHighlights === 'function') h.refreshVisibleFilenameHighlights();

        perfTest.end('applyFilters', perfStart, { cardCount: h.currentItems.length });
    }

    // ── Clustering status UI ──────────────────────────────────────────

    _hideClusteringStatus() {
        this._host.hideClusteringStatus(this._clusteringStatusTimer);
        this._clusteringStatusTimer = null;
    }

    destroy() {
        if (this._worker) {
            this._worker.terminate();
            this._worker = null;
        }
        clearTimeout(this._clusteringStatusTimer);
    }
}

// Export class to global scope (no module system)
window.FilterWorkerBridge = FilterWorkerBridge;
