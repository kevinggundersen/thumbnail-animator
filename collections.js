// ============================================================================
// collections.js — Collections, smart rules, dimension/embedding cache
// Extracted from renderer.js. All functions/variables remain in global scope.
// ============================================================================

// ============================================================================
// COLLECTIONS / ALBUMS
// Virtual file-level groupings stored in IndexedDB.
// ============================================================================

let currentCollectionId = null;   // When set, grid shows collection contents
let collectionsCache = [];        // In-memory array of all collection metadata

function generateCollectionId() {
    return 'col_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
}

function generateCollectionFileId() {
    return 'cf_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
}

async function getAllCollections() {
    try {
        const result = await window.electronAPI.dbGetAllCollections();
        if (result.ok) {
            collectionsCache = result.value || [];
            return collectionsCache;
        }
    } catch {}
    return [];
}

async function getCollection(id) {
    try {
        const result = await window.electronAPI.dbGetCollection(id);
        if (result.ok) return result.value;
    } catch {}
    return null;
}

async function saveCollection(collection) {
    collection.updatedAt = Date.now();
    try {
        await window.electronAPI.dbSaveCollection(collection);
        // Update in-memory cache
        const idx = collectionsCache.findIndex(c => c.id === collection.id);
        if (idx >= 0) collectionsCache[idx] = collection;
        else collectionsCache.push(collection);
        // Invalidate smart collection result cache (rules may have changed)
        smartCollectionCache.delete(collection.id);
        removeCollectionResultsFromIndexedDB(collection.id);
    } catch (e) {
        console.error('Error saving collection:', e);
        showToast('Failed to save collection', 'error');
    }
}

async function deleteCollection(id) {
    try {
        await window.electronAPI.dbDeleteCollection(id);
        collectionsCache = collectionsCache.filter(c => c.id !== id);
        smartCollectionCache.delete(id);
        removeCollectionResultsFromIndexedDB(id);
    } catch (e) {
        console.error('Error deleting collection:', e);
        showToast('Failed to delete collection', 'error');
    }
}

async function getCollectionFiles(collectionId) {
    try {
        const result = await window.electronAPI.dbGetCollectionFiles(collectionId);
        if (result.ok) return result.value || [];
    } catch (e) {
        console.error('Error loading collection files:', e);
    }
    return [];
}

async function addFilesToCollection(collectionId, filePaths) {
    if (filePaths.length === 0) return 0;
    try {
        const result = await window.electronAPI.dbAddFilesToCollection(collectionId, filePaths);
        if (result.ok) return result.value || 0;
    } catch (e) {
        console.error('Error adding files to collection:', e);
        showToast('Failed to add files to collection', 'error');
    }
    return 0;
}

async function removeFileFromCollection(collectionId, filePath) {
    try {
        // Try both original and normalized path since storage format may vary
        await window.electronAPI.dbRemoveFileFromCollection(collectionId, filePath);
        const normalized = normalizePath(filePath);
        if (normalized !== filePath) {
            await window.electronAPI.dbRemoveFileFromCollection(collectionId, normalized);
        }
    } catch (e) {
        console.error('Error removing file from collection:', e);
        showToast('Failed to remove file from collection', 'error');
    }
}

async function removeAllMissingFromCollection(collectionId, missingPaths) {
    if (missingPaths.length === 0) return;
    try {
        const normalizedMissing = missingPaths.map(p => normalizePath(p));
        await window.electronAPI.dbRemoveFilesFromCollection(collectionId, normalizedMissing);
    } catch (e) {
        console.error('Error cleaning missing files from collection:', e);
    }
}

// Match an item against smart collection filter rules
function matchesSmartRules(item, rules) {
    if (!rules) return true;

    // File type filter
    if (rules.fileType && rules.fileType !== 'all') {
        if (item.type !== rules.fileType) return false;
    }

    // Size filter
    if (rules.sizeValue != null && rules.sizeOperator) {
        const sizeBytes = item.size || 0;
        const targetBytes = rules.sizeValue * 1024 * 1024; // rules.sizeValue is in MB
        switch (rules.sizeOperator) {
            case '>': if (sizeBytes <= targetBytes) return false; break;
            case '<': if (sizeBytes >= targetBytes) return false; break;
            case '=': if (Math.abs(sizeBytes - targetBytes) > targetBytes * 0.1) return false; break;
        }
    }

    // Date range filter
    if (rules.dateFrom != null) {
        if ((item.mtime || 0) < rules.dateFrom) return false;
    }
    if (rules.dateTo != null) {
        if ((item.mtime || 0) > rules.dateTo) return false;
    }

    // Dimension filters
    if (rules.width != null) {
        if (item.width !== rules.width) return false;
    }
    if (rules.height != null) {
        if (item.height !== rules.height) return false;
    }

    // Aspect ratio
    if (rules.aspectRatio) {
        const w = item.width, h = item.height;
        if (w && h) {
            const ratio = w / h;
            const targetRatio = parseAspectRatio(rules.aspectRatio);
            if (Math.abs(ratio - targetRatio) > 0.1) return false;
        } else {
            return false;
        }
    }

    // Star rating
    if (rules.minStarRating != null && rules.minStarRating > 0) {
        const rating = getFileRating(item.path);
        if (rating < rules.minStarRating) return false;
    }

    // Name contains
    if (rules.nameContains) {
        if (!item.name.toLowerCase().includes(rules.nameContains.toLowerCase())) return false;
    }

    return true;
}

// Load a collection's contents into the grid (parallel to loadVideos for folders)
// Track loading state per collection to show sidebar spinners
const _collectionLoadingSet = new Set();

function setCollectionLoading(collectionId, loading) {
    if (loading) _collectionLoadingSet.add(collectionId);
    else _collectionLoadingSet.delete(collectionId);
    // Update the sidebar badge for this collection
    const badge = document.querySelector(`[data-col-count="${collectionId}"]`);
    if (badge) {
        if (loading) {
            badge.textContent = '';
            badge.classList.add('loading');
        } else {
            badge.classList.remove('loading');
        }
    }
}

// Monotonic token so stale loads don't clobber the grid
let _collectionLoadToken = 0;

// When set, the foreground AI embedding pipeline is active for this collection.
// Used to hand off to backgroundScanSmartCollection() on navigate-away so embedding work resumes silently.
let _aiForegroundScanCollectionId = null;

async function loadCollectionIntoGrid(collectionId) {
    clearFindSimilarState();
    // Hand off any in-flight foreground AI scan from the previous collection to the background scanner
    if (_aiForegroundScanCollectionId && _aiForegroundScanCollectionId !== collectionId) {
        const handoffId = _aiForegroundScanCollectionId;
        _aiForegroundScanCollectionId = null;
        backgroundScanSmartCollection(handoffId);
    }

    const loadToken = ++_collectionLoadToken;
    stopPeriodicCleanup();
    activeDimensionHydrationToken++;

    // Cancel any background scan for this collection — foreground takes over
    cancelBackgroundScan(collectionId);

    setCollectionLoading(collectionId, true);
    const fgScanId = 'fgscan_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

    // Immediately update UI state so sidebar highlight and breadcrumb respond
    currentCollectionId = collectionId;
    currentFolderPath = null;
    highlightActiveCollection(collectionId);

    try {
        await yieldToEventLoop();
        window.electronAPI.triggerGC();

        const collection = await getCollection(collectionId);
        if (!collection) {
            showToast('Collection not found', 'error');
            return;
        }

        // Show collection name in breadcrumb right away (before data loads)
        updateBreadcrumbForCollection(collection);
        updateCurrentTab(null, collection.name);

        let items = [];
        let missingPaths = [];

        if (collection.type === 'smart') {
            const sourceFolders = collection.rules?.sourceFolders || [];
            if (sourceFolders.length === 0) {
                showToast('Smart collection has no source folders', 'warning');
                return;
            }

            // --- Cache-first: show cached results instantly, then background-refresh ---
            // Two-tier lookup: in-memory (instant) → IndexedDB (persistent across sessions)
            let cached = smartCollectionCache.get(collectionId);

            if (!cached || !cached.items || cached.items.length === 0) {
                const idbResult = await getCollectionResultsFromIndexedDB(collectionId, collection);
                if (loadToken !== _collectionLoadToken) return; // user navigated away during IDB read
                if (idbResult && idbResult.items && idbResult.items.length > 0) {
                    cached = { items: idbResult.items, timestamp: idbResult.timestamp };
                    // Promote to in-memory cache for subsequent instant access
                    smartCollectionCache.set(collectionId, cached);
                    // LRU eviction for in-memory cache
                    if (smartCollectionCache.size > SMART_COLLECTION_CACHE_MAX) {
                        const oldest = smartCollectionCache.keys().next().value;
                        smartCollectionCache.delete(oldest);
                    }
                }
            }

            if (cached && cached.items && cached.items.length > 0) {
                // Render cached results immediately — near-instant load
                items = cached.items;
                currentItems = items;
                const filteredCached = filterItems(items);
                const sortedCached = sortItems(filteredCached);

                currentEmbeddings.clear(); bumpEmbeddingsVersion();
                currentTextEmbedding = null;
                cancelEmbeddingScan();
                _cancelIdlePreEmbedding();

                renderItems(sortedCached, null);
                updateBreadcrumbForCollection(collection);

                const badge = document.querySelector(`[data-col-count="${collectionId}"]`);
                if (badge) badge.textContent = items.filter(i => !i.missing).length;

                // Clear loading spinner — the grid is usable now
                setCollectionLoading(collectionId, false);

                const mediaItemCount = sortedCached.filter(i => i.type !== 'folder' && !i.missing).length;
                if (mediaItemCount > 0) {
                    setStatusActivity('Loading media...');
                    scheduleMediaLoadSettle();
                }

                // Reconcile new/changed/removed files entirely in the background —
                // no foreground re-scan or two-step re-render needed.
                backgroundScanSmartCollection(collectionId);
                return;
            }

            // No cache — full foreground scan

            // Check if rules need dimensions (aspect ratio, width, height)
            const needsDimensionFilter = !!(collection.rules?.aspectRatio || collection.rules?.width != null || collection.rules?.height != null);

            // Accumulate items progressively and render as they arrive
            const progressiveItems = [];
            let progressRenderTimer = null;

            const scheduleProgressiveRender = () => {
                if (progressRenderTimer) return;
                progressRenderTimer = setTimeout(() => {
                    progressRenderTimer = null;
                    if (loadToken !== _collectionLoadToken) return;
                    currentItems = progressiveItems.slice();
                    const filtered = filterItems(currentItems);
                    const sorted = sortItems(filtered);
                    renderItems(sorted, null);
                }, 200);
            };

            let progressFileCount = 0;
            const progressHandler = (_event, progress) => {
                if (progress.scanId && progress.scanId !== fgScanId) return;
                if (loadToken !== _collectionLoadToken) return;
                if (progress.items) progressFileCount += progress.items.length;
                const itemLabel = collection.rules?.fileType === 'video' ? 'videos' : collection.rules?.fileType === 'image' ? 'images' : 'items';
                setStatusActivity(
                    `Scanning folders... ${progress.foldersScanned}/${progress.totalFolders} | ${progressFileCount} ${itemLabel}`,
                    { done: progress.foldersScanned, total: progress.totalFolders }
                );

                // Progressive rendering when no AI query
                // (AI query requires embeddings which aren't available during streaming)
                if (!collection.rules?.aiQuery && progress.items && progress.items.length > 0) {
                    for (const item of progress.items) {
                        if (matchesSmartRules(item, collection.rules)) {
                            progressiveItems.push(item);
                        }
                    }
                    scheduleProgressiveRender();
                }
            };
            window.electronAPI.onSmartCollectionProgress(progressHandler);

            // Only request dimension scanning if rules actually filter by dimensions
            const result = await window.electronAPI.scanFoldersForSmartCollection(sourceFolders, {
                scanImageDimensions: needsDimensionFilter,
                scanVideoDimensions: needsDimensionFilter
            }, collection.rules, fgScanId);

            window.electronAPI.removeSmartCollectionProgressListener();
            if (progressRenderTimer) {
                clearTimeout(progressRenderTimer);
                progressRenderTimer = null;
            }

            // Bail if user navigated away during the async scan
            if (loadToken !== _collectionLoadToken) return;

            // Final render with full results (including dimension data)
            items = ((result.ok && result.value && result.value.items) || []).filter(item => matchesSmartRules(item, collection.rules));

            // Update in-memory cache for instant re-opens
            smartCollectionCache.set(collectionId, { items, timestamp: Date.now() });
            // Persist to IndexedDB for instant loads across sessions
            storeCollectionResultsInIndexedDB(collectionId, items, collection)
                .catch(err => console.warn('storeCollectionResults (foreground):', err));
        } else {
            const collectionFiles = await getCollectionFiles(collectionId);
            const filePaths = collectionFiles.map(cf => cf.filePath);

            if (filePaths.length === 0) {
                if (loadToken !== _collectionLoadToken) return;
                currentItems = [];
                renderItems([], null);
                updateBreadcrumbForCollection(collection);
                return;
            }

            const result = await window.electronAPI.resolveFilePaths(filePaths, {
                scanImageDimensions: true,
                scanVideoDimensions: true
            });

            if (loadToken !== _collectionLoadToken) return;

            items = (result.ok && result.value && result.value.items) || [];
            missingPaths = (result.ok && result.value && result.value.missing) || [];

            for (const mp of missingPaths) {
                const name = mp.split(/[/\\]/).pop() || mp;
                items.push({
                    name, path: mp, url: '', type: 'image',
                    mtime: 0, size: 0, width: undefined, height: undefined, missing: true
                });
            }
        }

        // --- AI Content Search filtering ---
        const aiQuery = collection.rules?.aiQuery;
        if (aiQuery && collection.type === 'smart') {
            _aiForegroundScanCollectionId = collectionId;
            const aiThreshold = collection.rules.aiThreshold || 0.28;
            const mediaItems = items.filter(i => i.type !== 'folder' && !i.missing);
            // Keep a reference to all metadata-filtered items for background processing
            const allMetadataItems = items;

            if (mediaItems.length > 0) {
                // Ensure CLIP model is loaded
                let modelReady = false;
                try {
                    const status = await window.electronAPI.clipStatus();
                    if (status.value?.loaded) {
                        modelReady = true;
                    } else if (aiVisualSearchEnabled && aiModelDownloadConfirmed) {
                        setStatusActivity('Loading AI model...');
                        const init = await window.electronAPI.clipInit(getClipGpuMode());
                        modelReady = init.ok;
                    }
                } catch { /* model unavailable */ }

                if (loadToken !== _collectionLoadToken) return;

                if (modelReady) {
                    // Generate text embedding for the AI query
                    setStatusActivity('AI search: loading cached results...');
                    let textEmb = null;
                    try {
                        const raw = await window.electronAPI.clipEmbedText(aiQuery);
                        textEmb = raw && raw.ok && raw.value ? new Float32Array(raw.value) : null;
                    } catch { /* skip */ }

                    if (loadToken !== _collectionLoadToken) return;

                    if (textEmb) {
                        // --- Phase 1: Show results from cached embeddings immediately ---
                        const embeddingMap = new Map();
                        try {
                            const cached = await getCachedEmbeddings(mediaItems.map(i => ({ path: i.path, mtime: i.mtime || 0 })));
                            for (const [p, emb] of cached) embeddingMap.set(p, emb);
                        } catch { /* ignore */ }

                        if (loadToken !== _collectionLoadToken) return;

                        // Score cached items and show matches immediately
                        const uncached = mediaItems.filter(i => !embeddingMap.has(i.path));

                        if (embeddingMap.size > 0) {
                            const cachedScored = [];
                            for (const item of mediaItems) {
                                const emb = embeddingMap.get(item.path);
                                if (emb) {
                                    const sim = cosineSimilarity(textEmb, emb);
                                    if (sim >= aiThreshold) {
                                        item._aiScore = sim;
                                        cachedScored.push(item);
                                    }
                                }
                            }
                            cachedScored.sort((a, b) => (b._aiScore || 0) - (a._aiScore || 0));

                            // Render cached results right away
                            items = cachedScored;
                            currentItems = items;
                            renderItems(sortItems(filterItems(items)), null);
                            updateBreadcrumbForCollection(collection);
                            const badge = document.querySelector(`[data-col-count="${collectionId}"]`);
                            if (badge) badge.textContent = items.length;
                            setCollectionLoading(collectionId, false);

                            if (uncached.length > 0) {
                                setStatusActivity(`AI search: ${embeddingMap.size} cached | scanning ${uncached.length} new...`);
                            }
                        }

                        // --- Phase 2: Process uncached images in background ---
                        if (uncached.length > 0) {
                            // 32 = 2 full batches of 16 in main, no trailing small batch
                            const BATCH_SIZE = 32;
                            let done = 0;
                            let newMatchCount = 0;
                            let updateTimer = null;
                            const etaTracker = createEtaTracker(uncached.length);

                            const scheduleResultUpdate = () => {
                                if (updateTimer) return;
                                updateTimer = setTimeout(() => {
                                    updateTimer = null;
                                    if (loadToken !== _collectionLoadToken) return;
                                    // Re-score all items with updated embeddings
                                    const allScored = [];
                                    for (const item of allMetadataItems) {
                                        if (item.type === 'folder' || item.missing) continue;
                                        const emb = embeddingMap.get(item.path);
                                        if (emb) {
                                            const sim = cosineSimilarity(textEmb, emb);
                                            if (sim >= aiThreshold) {
                                                item._aiScore = sim;
                                                allScored.push(item);
                                            }
                                        }
                                    }
                                    allScored.sort((a, b) => (b._aiScore || 0) - (a._aiScore || 0));
                                    items = allScored;
                                    currentItems = items;
                                    renderItems(sortItems(filterItems(items)), null);
                                    const badge2 = document.querySelector(`[data-col-count="${collectionId}"]`);
                                    if (badge2) badge2.textContent = items.length;
                                }, 500);
                            };

                            for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
                                if (loadToken !== _collectionLoadToken) {
                                    if (updateTimer) clearTimeout(updateTimer);
                                    return;
                                }
                                setStatusActivity(
                                    `AI search: scanning ${done}/${uncached.length} new images...`,
                                    { done, total: uncached.length, eta: etaTracker.tick(done) }
                                );
                                const batch = uncached.slice(i, i + BATCH_SIZE);
                                try {
                                    const resp = await window.electronAPI.clipEmbedImages(
                                        batch.map(item => ({ path: item.path, mtime: item.mtime || 0, thumbPath: null }))
                                    );
                                    const results = resp && resp.ok ? (resp.value || []) : [];
                                    const toCache = [];
                                    for (const r of results) {
                                        if (r && r.embedding) {
                                            const emb = new Float32Array(r.embedding);
                                            embeddingMap.set(r.path, emb);
                                            const item = mediaItems.find(m => m.path === r.path);
                                            toCache.push({ path: r.path, mtime: item ? (item.mtime || 0) : 0, embedding: r.embedding });
                                            // Check if this new embedding is a match
                                            const sim = cosineSimilarity(textEmb, emb);
                                            if (sim >= aiThreshold) newMatchCount++;
                                        }
                                    }
                                    if (toCache.length > 0) cacheEmbeddings(toCache).catch(err => console.warn('cacheEmbeddings (foreground):', err));
                                    done += batch.length;
                                } catch { done += batch.length; }

                                // Periodically update the grid with new matches
                                if (newMatchCount > 0) {
                                    scheduleResultUpdate();
                                    newMatchCount = 0;
                                }

                                if (i + BATCH_SIZE < uncached.length) {
                                    await new Promise(r => requestIdleCallback ? requestIdleCallback(r, { timeout: 200 }) : setTimeout(r, 50));
                                }
                            }

                            if (updateTimer) clearTimeout(updateTimer);
                            if (loadToken !== _collectionLoadToken) return;

                            // Final render with all embeddings
                            const finalScored = [];
                            for (const item of allMetadataItems) {
                                if (item.type === 'folder' || item.missing) continue;
                                const emb = embeddingMap.get(item.path);
                                if (emb) {
                                    const sim = cosineSimilarity(textEmb, emb);
                                    if (sim >= aiThreshold) {
                                        item._aiScore = sim;
                                        finalScored.push(item);
                                    }
                                }
                            }
                            finalScored.sort((a, b) => (b._aiScore || 0) - (a._aiScore || 0));
                            items = finalScored;
                        }

                        setStatusActivity('');
                    }
                } else if (aiQuery) {
                    showToast('AI Visual Search is not enabled — showing metadata-filtered results only', 'warning');
                }
            }
        }

        await yieldToEventLoop();
        if (loadToken !== _collectionLoadToken) return;

        currentItems = items;
        const filteredItems = filterItems(items);
        const sortedItems = sortItems(filteredItems);

        await yieldToEventLoop();
        if (loadToken !== _collectionLoadToken) return;

        currentEmbeddings.clear(); bumpEmbeddingsVersion();
        currentTextEmbedding = null;
        cancelEmbeddingScan();
        _cancelIdlePreEmbedding();

        renderItems(sortedItems, null);
        updateBreadcrumbForCollection(collection);

        if (missingPaths.length > 0) {
            showToast(`${missingPaths.length} file(s) no longer exist`, 'warning');
        }

        const mediaItemCount = sortedItems.filter(i => i.type !== 'folder' && !i.missing).length;
        if (mediaItemCount > 0) {
            setStatusActivity('Loading media...');
            scheduleMediaLoadSettle();
        } else {
            setStatusActivity('');
        }

        // Update sidebar count badge now that we know the total
        const badge = document.querySelector(`[data-col-count="${collectionId}"]`);
        if (badge) badge.textContent = items.filter(i => !i.missing).length;

        // Final cache update — ensures AI-scored results are persisted (not just metadata-filtered)
        smartCollectionCache.set(collectionId, { items, timestamp: Date.now() });
        if (collection) {
            storeCollectionResultsInIndexedDB(collectionId, items, collection)
                .catch(err => console.warn('storeCollectionResults (final):', err));
        }

    } finally {
        if (_aiForegroundScanCollectionId === collectionId) _aiForegroundScanCollectionId = null;
        setCollectionLoading(collectionId, false);
    }
}

// --- Background smart collection scanning ---
// Allows scanning/populating a smart collection without navigating to it.
// Results go into smartCollectionCache so the next navigation is instant.
const _bgScans = new Map(); // collectionId -> { scanId, abort: boolean }
let _bgScanRunning = false;
const _bgScanPending = []; // queued collectionId list

function cancelBackgroundScan(collectionId) {
    const entry = _bgScans.get(collectionId);
    if (entry) {
        entry.abort = true;
        _bgScans.delete(collectionId);
    }
}

async function backgroundScanSmartCollection(collectionId) {
    // Cancel any existing background scan for this collection
    cancelBackgroundScan(collectionId);

    // Queue if another background scan is already running
    if (_bgScanRunning) {
        // Remove any prior queue entry for this collection
        const idx = _bgScanPending.indexOf(collectionId);
        if (idx >= 0) _bgScanPending.splice(idx, 1);
        _bgScanPending.push(collectionId);
        return;
    }

    _bgScanRunning = true;
    const scanId = 'bgscan_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const scanState = { scanId, abort: false };
    _bgScans.set(collectionId, scanState);

    setCollectionLoading(collectionId, true);

    try {
        const collection = await getCollection(collectionId);
        if (!collection || collection.type !== 'smart' || scanState.abort) return;

        const sourceFolders = collection.rules?.sourceFolders || [];
        if (sourceFolders.length === 0) return;

        const needsDimensionFilter = !!(collection.rules?.aspectRatio || collection.rules?.width != null || collection.rules?.height != null);

        // Listen for progress events scoped to this scanId
        let progressCount = 0;
        const progressHandler = (_event, progress) => {
            if (progress.scanId !== scanId || scanState.abort) return;
            if (progress.items) progressCount += progress.items.length;
            // Update sidebar badge with running count
            const badge = document.querySelector(`[data-col-count="${collectionId}"]`);
            if (badge && progressCount > 0) {
                badge.textContent = progressCount;
            }
        };
        window.electronAPI.onSmartCollectionProgress(progressHandler);

        const result = await window.electronAPI.scanFoldersForSmartCollection(sourceFolders, {
            scanImageDimensions: needsDimensionFilter,
            scanVideoDimensions: needsDimensionFilter
        }, collection.rules, scanId);

        window.electronAPI.removeSmartCollectionProgressListener();

        if (scanState.abort) return;

        let items = ((result.ok && result.value && result.value.items) || []).filter(item => matchesSmartRules(item, collection.rules));

        // --- Background AI Content Search ---
        const aiQuery = collection.rules?.aiQuery;
        if (aiQuery && items.length > 0) {
            const aiThreshold = collection.rules.aiThreshold || 0.28;
            const mediaItems = items.filter(i => i.type !== 'folder' && !i.missing);

            let modelReady = false;
            try {
                const status = await window.electronAPI.clipStatus();
                if (status.ok && status.value.loaded) {
                    modelReady = true;
                } else if (aiVisualSearchEnabled && aiModelDownloadConfirmed) {
                    const init = await window.electronAPI.clipInit(getClipGpuMode());
                    modelReady = init.ok;
                }
            } catch { /* model unavailable */ }

            if (scanState.abort) return;

            if (modelReady && mediaItems.length > 0) {
                let textEmb = null;
                try {
                    const raw = await window.electronAPI.clipEmbedText(aiQuery);
                    textEmb = raw && raw.ok && raw.value ? new Float32Array(raw.value) : null;
                } catch { /* skip */ }

                if (scanState.abort) return;

                if (textEmb) {
                    const embeddingMap = new Map();
                    try {
                        const cached = await getCachedEmbeddings(mediaItems.map(i => ({ path: i.path, mtime: i.mtime || 0 })));
                        for (const [p, emb] of cached) embeddingMap.set(p, emb);
                    } catch { /* ignore */ }

                    if (scanState.abort) return;

                    // Score cached items immediately
                    const scoredItems = [];
                    for (const item of mediaItems) {
                        const emb = embeddingMap.get(item.path);
                        if (emb) {
                            const sim = cosineSimilarity(textEmb, emb);
                            if (sim >= aiThreshold) {
                                item._aiScore = sim;
                                scoredItems.push(item);
                            }
                        }
                    }
                    scoredItems.sort((a, b) => (b._aiScore || 0) - (a._aiScore || 0));

                    // Cache partial AI results so navigation shows something fast
                    items = scoredItems;
                    smartCollectionCache.set(collectionId, { items, timestamp: Date.now() });

                    const badge = document.querySelector(`[data-col-count="${collectionId}"]`);
                    if (badge) badge.textContent = items.length;

                    if (currentCollectionId === collectionId) {
                        const scrollBefore = gridContainer.scrollTop;
                        currentItems = items;
                        renderItems(sortItems(filterItems(items)), scrollBefore);
                        updateBreadcrumbForCollection(collection);
                    }

                    // Process uncached images with smaller batches + generous yielding
                    const uncached = mediaItems.filter(i => !embeddingMap.has(i.path));
                    if (uncached.length > 0) {
                        // 32 = 2 full batches of 16 in main (GPU-optimal)
                        const BG_BATCH_SIZE = 32;
                        let done = 0;
                        let newMatches = false;

                        for (let i = 0; i < uncached.length; i += BG_BATCH_SIZE) {
                            if (scanState.abort) return;

                            const batch = uncached.slice(i, i + BG_BATCH_SIZE);
                            try {
                                const resp = await window.electronAPI.clipEmbedImages(
                                    batch.map(item => ({ path: item.path, mtime: item.mtime || 0, thumbPath: null }))
                                );
                                const results = resp && resp.ok ? (resp.value || []) : [];
                                const toCache = [];
                                for (const r of results) {
                                    if (r && r.embedding) {
                                        const emb = new Float32Array(r.embedding);
                                        embeddingMap.set(r.path, emb);
                                        const item = mediaItems.find(m => m.path === r.path);
                                        toCache.push({ path: r.path, mtime: item ? (item.mtime || 0) : 0, embedding: r.embedding });
                                        const sim = cosineSimilarity(textEmb, emb);
                                        if (sim >= aiThreshold) newMatches = true;
                                    }
                                }
                                if (toCache.length > 0) cacheEmbeddings(toCache).catch(err => console.warn('cacheEmbeddings (background):', err));
                                done += batch.length;
                            } catch { done += batch.length; }

                            // Update sidebar badge periodically
                            if (newMatches) {
                                const allScored = [];
                                for (const item of mediaItems) {
                                    const emb = embeddingMap.get(item.path);
                                    if (emb) {
                                        const sim = cosineSimilarity(textEmb, emb);
                                        if (sim >= aiThreshold) { item._aiScore = sim; allScored.push(item); }
                                    }
                                }
                                allScored.sort((a, b) => (b._aiScore || 0) - (a._aiScore || 0));
                                items = allScored;
                                smartCollectionCache.set(collectionId, { items, timestamp: Date.now() });

                                const badge2 = document.querySelector(`[data-col-count="${collectionId}"]`);
                                if (badge2) badge2.textContent = items.length;

                                if (currentCollectionId === collectionId) {
                                    const scrollBefore = gridContainer.scrollTop;
                                    currentItems = items;
                                    renderItems(sortItems(filterItems(items)), scrollBefore);
                                }
                                newMatches = false;
                            }

                            // Yield generously to keep the app responsive
                            if (i + BG_BATCH_SIZE < uncached.length) {
                                await new Promise(r => setTimeout(r, 150));
                            }
                        }

                        if (scanState.abort) return;

                        // Final scoring pass
                        const finalScored = [];
                        for (const item of mediaItems) {
                            const emb = embeddingMap.get(item.path);
                            if (emb) {
                                const sim = cosineSimilarity(textEmb, emb);
                                if (sim >= aiThreshold) { item._aiScore = sim; finalScored.push(item); }
                            }
                        }
                        finalScored.sort((a, b) => (b._aiScore || 0) - (a._aiScore || 0));
                        items = finalScored;
                    }
                }
            }
        }

        smartCollectionCache.set(collectionId, { items, timestamp: Date.now() });
        // Persist to IndexedDB for instant loads across sessions
        storeCollectionResultsInIndexedDB(collectionId, items, collection)
            .catch(err => console.warn('storeCollectionResults (background):', err));

        // Update sidebar badge with final count
        const badge = document.querySelector(`[data-col-count="${collectionId}"]`);
        if (badge) badge.textContent = items.filter(i => !i.missing).length;

        // If user navigated to this collection during the scan, render results
        if (currentCollectionId === collectionId) {
            const scrollBefore = gridContainer.scrollTop;
            currentItems = items;
            const filtered = filterItems(items);
            const sorted = sortItems(filtered);
            renderItems(sorted, scrollBefore);
            updateBreadcrumbForCollection(collection);
        }
    } finally {
        _bgScans.delete(collectionId);
        setCollectionLoading(collectionId, false);
        _bgScanRunning = false;

        // Process next queued scan
        if (_bgScanPending.length > 0) {
            const nextId = _bgScanPending.shift();
            backgroundScanSmartCollection(nextId);
        }
    }
}

function updateBreadcrumbForCollection(collection) {
    const hasAi = collection.type === 'smart' && collection.rules?.aiQuery;
    const icon = hasAi ? '\u2726' : collection.type === 'smart' ? '\u2606' : '\u25A6'; // sparkle, star, or square
    const breadcrumbContainer = document.getElementById('breadcrumb-container');
    breadcrumbContainer.innerHTML = '';
    const pathSpan = document.createElement('span');
    pathSpan.id = 'current-path';
    pathSpan.className = 'breadcrumb-editable';
    pathSpan.textContent = icon + ' ' + collection.name;
    breadcrumbContainer.appendChild(pathSpan);
    currentPathSpan = pathSpan;

    // Show rule chips for smart collections
    if (collection.type === 'smart' && collection.rules) {
        const rules = collection.rules;
        const chips = [];
        if (rules.fileType && rules.fileType !== 'all') chips.push(rules.fileType === 'video' ? 'Video' : 'Image');
        if (rules.nameContains) chips.push(`"${rules.nameContains}"`);
        if (rules.aspectRatio) chips.push(rules.aspectRatio);
        if (rules.width != null) chips.push(`W: ${rules.width}px`);
        if (rules.height != null) chips.push(`H: ${rules.height}px`);
        if (rules.sizeValue != null && rules.sizeOperator) chips.push(`${rules.sizeOperator} ${rules.sizeValue} MB`);
        if (rules.minStarRating != null && rules.minStarRating > 0) chips.push('\u2605'.repeat(rules.minStarRating) + '+');
        if (rules.dateFrom != null || rules.dateTo != null) {
            const fmt = ts => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
            if (rules.dateFrom && rules.dateTo) chips.push(fmt(rules.dateFrom) + ' \u2013 ' + fmt(rules.dateTo));
            else if (rules.dateFrom) chips.push('After ' + fmt(rules.dateFrom));
            else chips.push('Before ' + fmt(rules.dateTo));
        }
        if (rules.sourceFolders?.length) {
            const names = rules.sourceFolders.map(f => typeof f === 'string' ? f.split(/[\\/]/).pop() : (f.name || f.path?.split(/[\\/]/).pop() || ''));
            chips.push(names.length === 1 ? names[0] : `${names.length} folders`);
        }
        if (rules.aiQuery) chips.push('\u2726 ' + rules.aiQuery);

        if (chips.length) {
            const rulesWrap = document.createElement('span');
            rulesWrap.className = 'collection-rule-chips';
            for (const text of chips) {
                const chip = document.createElement('span');
                chip.className = 'collection-rule-chip';
                chip.textContent = text;
                rulesWrap.appendChild(chip);
            }
            breadcrumbContainer.appendChild(rulesWrap);
        }
    }

    breadcrumbContainer.appendChild(itemCountEl);
    const validCount = currentItems.filter(i => !i.missing).length;
    const missingCount = currentItems.filter(i => i.missing).length;
    itemCountEl.textContent = `${validCount} items` + (missingCount > 0 ? ` (${missingCount} missing)` : '');
}

function highlightActiveCollection(collectionId) {
    // Remove active class from all collection items and sidebar tree items
    document.querySelectorAll('.collection-item.active').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.sidebar-tree .tree-item.active').forEach(el => el.classList.remove('active'));
    if (collectionId) {
        const el = document.querySelector(`.collection-item[data-collection-id="${collectionId}"]`);
        if (el) el.classList.add('active');
    }
}

// --- Dimension Cache ---
// Persists image/video dimensions across sessions so repeat folder visits
// don't need to re-scan file headers. Key = "filePath|mtimeMs".

/**
 * Look up cached dimensions for a batch of files.
 * @param {Array<{path: string, mtime: number}>} files
 * @returns {Promise<Map<string, {width: number, height: number}>>} map of filePath -> dimensions
 */
async function getCachedDimensions(files) {
    const result = new Map();
    if (!db || files.length === 0) return result;

    try {
        const transaction = db.transaction([DIMENSIONS_STORE], 'readonly');
        const store = transaction.objectStore(DIMENSIONS_STORE);

        const promises = files.map(f => {
            const key = `${f.path}|${f.mtime || 0}`;
            return new Promise(resolve => {
                const req = store.get(key);
                req.onsuccess = () => {
                    if (req.result && req.result.width && req.result.height) {
                        result.set(f.path, { width: req.result.width, height: req.result.height });
                    }
                    resolve();
                };
                req.onerror = () => resolve();
            });
        });

        await Promise.all(promises);
    } catch {
        // Ignore errors — dimensions will just be re-scanned
    }

    return result;
}

/**
 * Store dimensions for a batch of files.
 * @param {Array<{path: string, mtime: number, width: number, height: number}>} entries
 */
async function cacheDimensions(entries) {
    if (!db || entries.length === 0) return;

    try {
        const transaction = db.transaction([DIMENSIONS_STORE], 'readwrite');
        const store = transaction.objectStore(DIMENSIONS_STORE);

        for (const e of entries) {
            if (e.width && e.height) {
                store.put({
                    key: `${e.path}|${e.mtime || 0}`,
                    width: e.width,
                    height: e.height
                });
            }
        }
    } catch {
        // Ignore errors — caching is best-effort
    }
}

/**
 * Look up cached embeddings for a batch of files.
 * @param {Array<{path: string, mtime: number}>} files
 * @returns {Promise<Map<string, Float32Array>>}
 */
async function getCachedEmbeddings(files) {
    const result = new Map();
    if (!db || files.length === 0) return result;
    try {
        // For large sets, use cursor scan (one pass) instead of N individual gets
        if (files.length > 500) {
            const keyToPath = new Map();
            for (const f of files) {
                keyToPath.set(`${f.path}|${f.mtime || 0}|${EMBEDDING_VERSION}`, f.path);
            }
            const transaction = db.transaction([EMBEDDING_STORE], 'readonly');
            const store = transaction.objectStore(EMBEDDING_STORE);
            await new Promise((resolve, reject) => {
                const req = store.openCursor();
                req.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (!cursor) { resolve(); return; }
                    const record = cursor.value;
                    if (record && record.embedding && keyToPath.has(record.key)) {
                        result.set(keyToPath.get(record.key), new Float32Array(record.embedding));
                    }
                    cursor.continue();
                };
                req.onerror = () => resolve();
            });
        } else {
            const transaction = db.transaction([EMBEDDING_STORE], 'readonly');
            const store = transaction.objectStore(EMBEDDING_STORE);
            const promises = files.map(f => {
                const key = `${f.path}|${f.mtime || 0}|${EMBEDDING_VERSION}`;
                return new Promise(resolve => {
                    const req = store.get(key);
                    req.onsuccess = () => {
                        if (req.result && req.result.embedding) {
                            result.set(f.path, new Float32Array(req.result.embedding));
                        }
                        resolve();
                    };
                    req.onerror = () => resolve();
                });
            });
            await Promise.all(promises);
        }
    } catch {
        // Ignore — embeddings will just be re-computed
    }
    return result;
}

/**
 * Store embeddings for a batch of files.
 * @param {Array<{path: string, mtime: number, embedding: number[]}>} entries
 */
async function cacheEmbeddings(entries) {
    if (!db || entries.length === 0) return;
    try {
        const transaction = db.transaction([EMBEDDING_STORE], 'readwrite');
        const store = transaction.objectStore(EMBEDDING_STORE);
        for (const e of entries) {
            if (e.embedding) {
                store.put({
                    key: `${e.path}|${e.mtime || 0}|${EMBEDDING_VERSION}`,
                    embedding: Array.from(e.embedding)
                });
            }
        }
    } catch {
        // Ignore — caching is best-effort
    }
}

/**
 * Retrieve ALL cached embeddings from IndexedDB (across all folders).
 * Used by "Find Similar - All Folders" to search the full embedding index.
 * @returns {Promise<Map<string, {embedding: Float32Array, mtime: number}>>}
 */
async function getAllCachedEmbeddings() {
    const result = new Map();
    if (!db) return result;
    try {
        const transaction = db.transaction([EMBEDDING_STORE], 'readonly');
        const store = transaction.objectStore(EMBEDDING_STORE);
        await new Promise((resolve) => {
            const req = store.openCursor();
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (!cursor) { resolve(); return; }
                const record = cursor.value;
                if (record && record.embedding && record.key) {
                    const lastPipe = record.key.lastIndexOf('|');
                    const version = record.key.substring(lastPipe + 1);
                    if (version === EMBEDDING_VERSION) {
                        const rest = record.key.substring(0, lastPipe);
                        const mtimePipe = rest.lastIndexOf('|');
                        const path = rest.substring(0, mtimePipe);
                        const mtime = parseInt(rest.substring(mtimePipe + 1), 10);
                        result.set(path, {
                            embedding: l2Normalize(new Float32Array(record.embedding)),
                            mtime
                        });
                    }
                }
                cursor.continue();
            };
            req.onerror = () => resolve();
        });
    } catch { /* best-effort */ }
    return result;
}

/**
 * Clear all stored embeddings (e.g. when user changes settings or clears cache).
 */
async function clearEmbeddingCache() {
    if (!db) return;
    try {
        const transaction = db.transaction([EMBEDDING_STORE], 'readwrite');
        transaction.objectStore(EMBEDDING_STORE).clear();
    } catch {
        // Ignore
    }
}

// --- Smart Collection Results Cache (IndexedDB persistent) ---
// Persists AI/smart collection results across sessions so revisits are instant.
// Records are keyed by collectionId and invalidated when rules change.

/**
 * Store smart collection results in IndexedDB for persistent caching.
 * @param {string} collectionId
 * @param {Array} items - the matched items (will be stripped to essential fields)
 * @param {object} collection - the collection object (for rules hash)
 */
async function storeCollectionResultsInIndexedDB(collectionId, items, collection) {
    if (!db) {
        try { await initIndexedDB(); } catch { return; }
    }
    try {
        const transaction = db.transaction([SMART_COLLECTION_RESULTS_STORE], 'readwrite');
        const store = transaction.objectStore(SMART_COLLECTION_RESULTS_STORE);
        store.put({
            collectionId,
            items: items.map(i => ({
                name: i.name,
                path: i.path,
                url: i.url,
                type: i.type,
                mtime: i.mtime,
                size: i.size,
                width: i.width,
                height: i.height,
                missing: i.missing || undefined,
                _aiScore: i._aiScore || undefined
            })),
            rulesHash: JSON.stringify(collection.rules || null),
            embeddingVersion: EMBEDDING_VERSION,
            timestamp: Date.now()
        });
    } catch (e) {
        console.warn('Failed to store collection results in IndexedDB:', e);
    }
}

/**
 * Retrieve cached smart collection results from IndexedDB.
 * Returns null if no cache exists or if the cache is stale (rules changed / embedding version changed).
 * @param {string} collectionId
 * @param {object} collection - the collection object (for rules hash validation)
 * @returns {Promise<{items: Array, timestamp: number}|null>}
 */
async function getCollectionResultsFromIndexedDB(collectionId, collection) {
    if (!db) {
        try { await initIndexedDB(); } catch { return null; }
    }
    try {
        const transaction = db.transaction([SMART_COLLECTION_RESULTS_STORE], 'readonly');
        const store = transaction.objectStore(SMART_COLLECTION_RESULTS_STORE);
        const request = store.get(collectionId);
        return new Promise(resolve => {
            request.onsuccess = () => {
                const result = request.result;
                if (!result || !result.items) { resolve(null); return; }
                // Invalidate if rules changed
                const currentRulesHash = JSON.stringify(collection.rules || null);
                if (result.rulesHash !== currentRulesHash) { resolve(null); return; }
                // Invalidate if embedding model version changed (AI scores would be stale)
                if (result.embeddingVersion && result.embeddingVersion !== EMBEDDING_VERSION) { resolve(null); return; }
                resolve(result);
            };
            request.onerror = () => resolve(null);
        });
    } catch {
        return null;
    }
}

/**
 * Remove cached results for a specific collection from IndexedDB.
 * @param {string} collectionId
 */
async function removeCollectionResultsFromIndexedDB(collectionId) {
    if (!db) return;
    try {
        const transaction = db.transaction([SMART_COLLECTION_RESULTS_STORE], 'readwrite');
        transaction.objectStore(SMART_COLLECTION_RESULTS_STORE).delete(collectionId);
    } catch { /* best-effort */ }
}
