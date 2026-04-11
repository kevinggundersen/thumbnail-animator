/**
 * Filter/Sort Web Worker
 *
 * Runs the entire filter/sort/search pipeline off the main thread.
 * Maintains its own copies of items, ratings, pins, and embeddings.
 * Main thread sends state updates incrementally and filter commands.
 *
 * Wire format (main -> worker):
 *   { type: 'setItems', items: [...] }             — replace item list (rebuilds trigram index)
 *   { type: 'setRatings', ratings: {path: n} }     — replace ratings map
 *   { type: 'setPins', paths: [...] }              — replace pinned set
 *   { type: 'setTagFilter', paths: [...] }         — replace tag-filtered paths
 *   { type: 'setEmbeddings', embeddings: {...} }   — replace embeddings map
 *   { type: 'setOneEmbedding', path, vec }         — add/update one embedding
 *   { type: 'setTextEmbedding', vec }              — set current search embedding
 *   { type: 'setFindSimilarEmbedding', vec }       — set find-similar source
 *   { type: 'applyFilters', token, state }         — run pipeline, echo token
 *
 * Wire format (worker -> main):
 *   { type: 'result', token, items: [...], counts: {folders, images, videos} }
 */

'use strict';

// Shared collator for name comparisons — 10-50x faster than per-call localeCompare
const _nameCollator = new Intl.Collator(undefined, { numeric: true });

// ── Worker state ──────────────────────────────────────────────────────

let items = [];
let itemNamesLower = [];        // pre-lowercased names for fast includes()
let ratings = {};               // path -> 1..5
let normalizedRatings = {};     // normalizedPath -> 1..5 (mirror for path variations)
let pins = new Set();           // normalized paths
let pluginSortKeys = null;      // { normalizedPath: sortKey } or null
let tagFilteredPaths = null;    // Set<normalizedPath> or null
let embeddings = new Map();     // path -> Float32Array (L2-normalized)
let textEmbedding = null;       // Float32Array
let findSimilarEmbedding = null;// Float32Array

// Trigram index: trigram (3-char) -> Uint32Array of item indices (sorted)
// Built once when items are set. Used as a pre-filter for text search.
// Incremental updates are used when items change slightly (same-folder refresh).
// Linked duplicates dedup state
let dedupEnabled = false;
let dedupPathToHash = new Map(); // path -> exact_hash

let trigramIndex = null;
let indexBuiltForItemCount = 0;
let _prevItemPaths = null; // Map<path, index> for detecting incremental changes

// ── Shared helpers (loaded from filter-sort-helpers.js) ──────────────
// Provides: normalizePath, cosineSim, parseAspectRatio, pad2,
//           getDateGroupKey, getDateGroupLabel
importScripts('./filter-sort-helpers.js');

// ── Helpers (worker-specific, depend on worker state) ────────────────

function getRating(p) {
    if (!p) return 0;
    const r = ratings[p];
    if (r) return r;
    const np = normalizePath(p);
    return normalizedRatings[np] || 0;
}

function isPinned(p) {
    if (!p) return false;
    return pins.has(normalizePath(p));
}

// ── Trigram index ─────────────────────────────────────────────────────

function buildTrigramIndex() {
    // First pass: count occurrences per trigram
    const counts = new Map();
    for (let i = 0; i < items.length; i++) {
        const name = itemNamesLower[i];
        const seen = new Set();
        for (let j = 0; j + 3 <= name.length; j++) {
            const gram = name.slice(j, j + 3);
            if (seen.has(gram)) continue;
            seen.add(gram);
            counts.set(gram, (counts.get(gram) || 0) + 1);
        }
    }
    // Allocate arrays
    const index = new Map();
    const offsets = new Map();
    for (const [gram, c] of counts) {
        index.set(gram, new Uint32Array(c));
        offsets.set(gram, 0);
    }
    // Second pass: fill
    for (let i = 0; i < items.length; i++) {
        const name = itemNamesLower[i];
        const seen = new Set();
        for (let j = 0; j + 3 <= name.length; j++) {
            const gram = name.slice(j, j + 3);
            if (seen.has(gram)) continue;
            seen.add(gram);
            const arr = index.get(gram);
            arr[offsets.get(gram)] = i;
            offsets.set(gram, offsets.get(gram) + 1);
        }
    }
    trigramIndex = index;
    indexBuiltForItemCount = items.length;
    // Snapshot current paths for future incremental detection
    _prevItemPaths = new Map();
    for (let i = 0; i < items.length; i++) _prevItemPaths.set(items[i].path, i);
}

/**
 * Try to incrementally update the trigram index when items change slightly.
 * Returns true if incremental update was performed, false if full rebuild is needed.
 *
 * Strategy: if the old items are a subset of the new items at the same indices
 * (i.e., items were only appended, which is common for file-watcher additions),
 * just extend the index. For more complex diffs, check overlap ratio and rebuild
 * only the changed portions of posting lists.
 */
function tryIncrementalTrigramUpdate(newItems, newNamesLower) {
    if (!trigramIndex || !_prevItemPaths || _prevItemPaths.size === 0) return false;

    const oldCount = _prevItemPaths.size;
    const newCount = newItems.length;

    // Quick check: if items were only appended (common for watcher events adding files)
    // Verify old items at same indices haven't changed
    if (newCount >= oldCount) {
        let allSamePrefix = true;
        // Spot-check: first, last of old range, and a few samples
        const checkIndices = [0, oldCount - 1];
        if (oldCount > 10) checkIndices.push(Math.floor(oldCount / 2), Math.floor(oldCount / 4), Math.floor(oldCount * 3 / 4));
        for (const idx of checkIndices) {
            if (idx >= 0 && idx < oldCount && idx < newCount) {
                if (newNamesLower[idx] !== undefined) {
                    // Check if item at this index is the same by path
                    const oldIdx = _prevItemPaths.get(newItems[idx].path);
                    if (oldIdx !== idx) { allSamePrefix = false; break; }
                }
            }
        }

        if (allSamePrefix && newCount > oldCount) {
            // Append-only: just add trigrams for new items
            for (let i = oldCount; i < newCount; i++) {
                const name = newNamesLower[i];
                const seen = new Set();
                for (let j = 0; j + 3 <= name.length; j++) {
                    const gram = name.slice(j, j + 3);
                    if (seen.has(gram)) continue;
                    seen.add(gram);
                    const existing = trigramIndex.get(gram);
                    if (existing) {
                        // Grow the Uint32Array by 1
                        const grown = new Uint32Array(existing.length + 1);
                        grown.set(existing);
                        grown[existing.length] = i;
                        trigramIndex.set(gram, grown);
                    } else {
                        trigramIndex.set(gram, new Uint32Array([i]));
                    }
                }
            }
            indexBuiltForItemCount = newCount;
            _prevItemPaths = new Map();
            for (let i = 0; i < newItems.length; i++) _prevItemPaths.set(newItems[i].path, i);
            return true;
        }
    }

    // General case: check overlap ratio
    let overlap = 0;
    for (let i = 0; i < newCount; i++) {
        if (_prevItemPaths.has(newItems[i].path)) overlap++;
    }
    // If <70% overlap, full rebuild is cheaper
    if (overlap < oldCount * 0.7 || overlap < newCount * 0.7) return false;

    // Moderate change: full rebuild (but we tried)
    return false;
}

/**
 * Returns a Set<number> of candidate item indices matching the query via trigram intersection,
 * or null if we should fall back to linear scan (query too short or no index).
 */
function trigramCandidates(query) {
    if (!trigramIndex || query.length < 3) return null;
    // Extract unique trigrams from query
    const grams = new Set();
    for (let j = 0; j + 3 <= query.length; j++) {
        grams.add(query.slice(j, j + 3));
    }
    if (grams.size === 0) return null;
    // Intersect posting lists
    let result = null;
    for (const gram of grams) {
        const list = trigramIndex.get(gram);
        if (!list) return new Set(); // guaranteed zero matches
        if (result === null) {
            result = new Set(list);
        } else {
            // Intersect in-place
            const smaller = result.size < list.length ? result : new Set(list);
            const larger = smaller === result ? list : result;
            const next = new Set();
            if (smaller === result) {
                const largerSet = larger instanceof Set ? larger : new Set(larger);
                for (const x of smaller) if (largerSet.has(x)) next.add(x);
            } else {
                for (const x of smaller) if (result.has(x)) next.add(x);
            }
            result = next;
            if (result.size === 0) return result;
        }
    }
    return result;
}

// ── Filter pipeline (index-based) ─────────────────────────────────────

/**
 * Runs the filter/sort/clustering/grouping pipeline entirely in index space.
 * Returns indices into the items[] array plus synthetic group-header objects.
 * The main thread reconstructs the final items by looking up currentItems[idx].
 */
function runFilterPipeline(state) {
    const {
        query = '',
        currentFilter = 'all',
        includeMovingImages = true,
        starFilterActive = false,
        starSortOrder = 'none',
        tagFilterActive = false,
        findSimilarActive = false,
        findSimilarAllFolders = false,
        findSimilarThreshold = 0.6,
        aiVisualSearchEnabled = false,
        aiSearchActive = false,
        aiSimilarityThreshold = 0.15,
        aiClusteringMode = 'off',
        advancedSearchFilters = {},
        sortType = 'name',
        sortOrder = 'ascending',
        groupByDate = false,
        dateGroupGranularity = 'month',
        collapsedGroups = []
    } = state;

    const collapsedSet = new Set(collapsedGroups);
    const q = query.toLowerCase().trim();
    const useAiSearch = aiVisualSearchEnabled && aiSearchActive && textEmbedding;
    const useFindSimilar = findSimilarActive && findSimilarEmbedding && !findSimilarAllFolders;
    const needRating = starFilterActive || (advancedSearchFilters.starRating !== null && advancedSearchFilters.starRating !== undefined && advancedSearchFilters.starRating !== '');

    // Scores/ratings aligned to items[] (not filtered results)
    const aiScores = useAiSearch ? new Float32Array(items.length) : null;
    const simScores = useFindSimilar ? new Float32Array(items.length) : null;
    const cachedRatings = needRating ? new Int8Array(items.length) : null;

    let textCandidates = null;
    if (q && !useAiSearch) {
        textCandidates = trigramCandidates(q);
    }

    const filtered = []; // array of indices into items[]
    const itemCount = items.length;

    for (let i = 0; i < itemCount; i++) {
        const item = items[i];
        const fileName = itemNamesLower[i];

        // Text search match
        let matches = true;
        if (q !== '') {
            if (useAiSearch && item.type !== 'folder') {
                const emb = embeddings.get(item.path);
                if (emb) {
                    const sim = cosineSim(textEmbedding, emb);
                    aiScores[i] = sim;
                    matches = sim >= aiSimilarityThreshold;
                } else {
                    aiScores[i] = 0;
                    matches = fileName.indexOf(q) !== -1;
                }
            } else {
                if (textCandidates !== null) {
                    matches = textCandidates.has(i) && fileName.indexOf(q) !== -1;
                } else {
                    matches = fileName.indexOf(q) !== -1;
                }
            }
        }
        if (!matches) continue;

        if (useAiSearch && q !== '' && item.type !== 'folder' && isPinned(item.path)) continue;

        // Type filter
        if (currentFilter === 'video') {
            const isMoving = item.animated || fileName.endsWith('.gif');
            if (item.type === 'video') {
                // keep
            } else if (includeMovingImages && item.type === 'image' && isMoving) {
                // keep: animated images treated as videos
            } else {
                continue;
            }
        } else if (currentFilter === 'image') {
            if (item.type !== 'image') continue;
            const isMoving = item.animated || fileName.endsWith('.gif');
            if (includeMovingImages && isMoving) continue;
        }

        if (needRating && item.type !== 'folder' && item.path) {
            cachedRatings[i] = getRating(item.path);
        }

        if (starFilterActive) {
            if (item.type === 'folder') continue;
            if (!cachedRatings || cachedRatings[i] <= 0) continue;
        }

        if (tagFilterActive && tagFilteredPaths) {
            if (item.type === 'folder') continue;
            if (!tagFilteredPaths.has(normalizePath(item.path))) continue;
        }

        if (useFindSimilar) {
            if (item.type === 'folder') continue;
            const emb = embeddings.get(item.path);
            if (!emb) continue;
            const sim = cosineSim(findSimilarEmbedding, emb);
            simScores[i] = sim;
            if (sim < findSimilarThreshold) continue;
        }

        const adv = advancedSearchFilters;
        if (adv.width || adv.height) {
            if (adv.width && item.width !== adv.width) continue;
            if (adv.height && item.height !== adv.height) continue;
        }
        if (adv.aspectRatio) {
            if (!item.width || !item.height) continue;
            const ratio = item.width / item.height;
            const target = parseAspectRatio(adv.aspectRatio);
            if (!isFinite(target) || Math.abs(ratio - target) > 0.1) continue;
        }
        if (adv.starRating !== null && adv.starRating !== undefined && adv.starRating !== '' && item.path) {
            const r = cachedRatings ? cachedRatings[i] : getRating(item.path);
            if (r < adv.starRating) continue;
        }

        filtered.push(i);
    }

    // Scoring sorts operate on index arrays. Folders go last in scoring sorts.
    const isFolderIdx = (idx) => items[idx].type === 'folder';

    if (starFilterActive && starSortOrder !== 'none') {
        filtered.sort((a, b) => {
            const af = isFolderIdx(a), bf = isFolderIdx(b);
            if (af && bf) return 0;
            if (af) return 1;
            if (bf) return -1;
            const aR = cachedRatings ? cachedRatings[a] : 0;
            const bR = cachedRatings ? cachedRatings[b] : 0;
            return starSortOrder === 'asc' ? aR - bR : bR - aR;
        });
    }

    if (useAiSearch && q !== '') {
        filtered.sort((a, b) => {
            const af = isFolderIdx(a), bf = isFolderIdx(b);
            if (af) return 1;
            if (bf) return -1;
            return (aiScores[b] || 0) - (aiScores[a] || 0);
        });
    }

    if (useFindSimilar) {
        filtered.sort((a, b) => {
            const af = isFolderIdx(a), bf = isFolderIdx(b);
            if (af) return 1;
            if (bf) return -1;
            return (simScores[b] || 0) - (simScores[a] || 0);
        });
    }

    // Visual clustering (PCA-projection reordering) on indices
    let orderedIndices = filtered;
    if (aiVisualSearchEnabled && aiClusteringMode === 'similarity' && embeddings.size > 0 && q === '') {
        const _t0 = performance.now();
        orderedIndices = applyVisualClusteringByIdx(filtered);
        console.log(`[worker] clustering ${filtered.length} items (${embeddings.size} embeddings) took ${(performance.now() - _t0).toFixed(0)}ms`);
    }

    // Separate folders/files by index
    const folderIdxs = [], fileIdxs = [];
    for (const idx of orderedIndices) {
        if (isFolderIdx(idx)) folderIdxs.push(idx);
        else fileIdxs.push(idx);
    }

    // Primary sort (name/date/size/dimensions/rating) if no scoring/clustering sort applied
    const clusteringActive = aiVisualSearchEnabled && aiClusteringMode === 'similarity' && embeddings.size > 0 && q === '';
    const skipPrimarySort = clusteringActive || (useAiSearch && q !== '') || useFindSimilar || (starFilterActive && starSortOrder !== 'none');
    if (!skipPrimarySort) {
        const nameCmp = (a, b) => _nameCollator.compare(items[a].name, items[b].name);
        const cmp = (a, b) => {
            const ia = items[a], ib = items[b];
            let c = 0;
            if (sortType === 'name') {
                c = nameCmp(a, b);
            } else if (sortType === 'date') {
                c = (ia.mtime || 0) - (ib.mtime || 0);
                if (c === 0) c = nameCmp(a, b);
            } else if (sortType === 'size') {
                c = (ia.size || 0) - (ib.size || 0);
                if (c === 0) c = nameCmp(a, b);
            } else if (sortType === 'dimensions') {
                c = ((ia.width || 0) * (ia.height || 0)) - ((ib.width || 0) * (ib.height || 0));
                if (c === 0) c = nameCmp(a, b);
            } else if (sortType === 'rating') {
                const aR = getRating(ia.path);
                const bR = getRating(ib.path);
                c = bR - aR; // rating sort is desc by default
                if (c === 0) c = nameCmp(a, b);
            } else if (sortType.startsWith('plugin:') && pluginSortKeys) {
                const aKey = pluginSortKeys[normalizePath(ia.path)];
                const bKey = pluginSortKeys[normalizePath(ib.path)];
                if (aKey !== undefined && bKey !== undefined) {
                    c = typeof aKey === 'number'
                        ? aKey - bKey
                        : _nameCollator.compare(String(aKey), String(bKey));
                }
                if (c === 0) c = nameCmp(a, b);
            }
            return sortOrder === 'ascending' ? c : -c;
        };
        folderIdxs.sort(cmp);
        fileIdxs.sort(cmp);
    }

    // Partition pinned to top (operating on indices)
    // pFiles/uFiles are let because the linked-duplicates dedup pass may reassign them
    const pFolders = [], uFolders = [];
    let pFiles = [], uFiles = [];
    for (const idx of folderIdxs) (isPinned(items[idx].path) ? pFolders : uFolders).push(idx);
    for (const idx of fileIdxs) (isPinned(items[idx].path) ? pFiles : uFiles).push(idx);

    // Build final index array + synthetics (group headers)
    const synthetics = [];
    let finalIndices;
    let groupHeadersPresent = false;

    // Linked duplicates: dedup pass — show only one instance per hash group
    if (dedupEnabled && dedupPathToHash.size > 0) {
        const dedupFilter = (arr) => {
            const seen = new Set();
            const result = [];
            for (const idx of arr) {
                // _pathToHash keys are normalized; item paths may use backslashes
                const hash = dedupPathToHash.get(normalizePath(items[idx].path));
                if (!hash) { result.push(idx); continue; }
                if (seen.has(hash)) continue;
                seen.add(hash);
                result.push(idx);
            }
            return result;
        };
        // Dedup files only (not folders). Pinned files are deduped separately
        // to ensure the pinned copy is preferred over the unpinned copy.
        const dpFiles = dedupFilter(pFiles);
        const duFiles = dedupFilter(uFiles);
        pFiles = dpFiles;
        uFiles = duFiles;
    }

    if (groupByDate && (pFiles.length + uFiles.length) > 0) {
        groupHeadersPresent = true;
        const allFileIdxs = pFiles.concat(uFiles);
        const injected = injectDateGroupHeadersByIdx(allFileIdxs, dateGroupGranularity, collapsedSet, synthetics);
        finalIndices = pFolders.concat(uFolders, injected);
    } else {
        finalIndices = pFolders.concat(uFolders, pFiles, uFiles);
    }

    // Count stats
    let folderCount = 0, videoCount = 0, imageCount = 0;
    for (const idx of finalIndices) {
        if (idx < 0) continue; // synthetic group header
        const t = items[idx].type;
        if (t === 'folder') folderCount++;
        else if (t === 'video') videoCount++;
        else if (t === 'image') imageCount++;
    }

    return {
        indices: new Int32Array(finalIndices),
        synthetics,
        scores: { ai: aiScores, sim: simScores, ratings: cachedRatings },
        counts: { folders: folderCount, videos: videoCount, images: imageCount },
        groupHeadersPresent
    };
}

// ── Visual clustering (by index) ──────────────────────────────────────
// PCA-projection sorting: finds the principal axis of variation in embedding
// space via power iteration, projects every item onto that axis, sorts by
// the scalar projection. O(n · dim · iters + n log n). See renderer.js.
//
// Runs synchronously — the computation takes ~200-500ms for 5,000 items,
// which is too fast to warrant async progress but long enough to show
// a brief "Clustering…" indicator on the main thread.

function applyVisualClusteringByIdx(indices) {
    const folderIdxs = [];
    const withEmbIdxs = [];
    const noEmbIdxs = [];
    for (const idx of indices) {
        const item = items[idx];
        if (item.type === 'folder') { folderIdxs.push(idx); continue; }
        if (embeddings.has(item.path)) withEmbIdxs.push(idx);
        else noEmbIdxs.push(idx);
    }
    if (withEmbIdxs.length < 2) return indices;

    const firstEmb = embeddings.get(items[withEmbIdxs[0]].path);
    const dim = firstEmb.length;
    const n = withEmbIdxs.length;

    // 1. Compute mean embedding
    const mean = new Float64Array(dim);
    for (let i = 0; i < n; i++) {
        const emb = embeddings.get(items[withEmbIdxs[i]].path);
        for (let d = 0; d < dim; d++) mean[d] += emb[d];
    }
    for (let d = 0; d < dim; d++) mean[d] /= n;

    // 2. Power iteration for first principal component (5 iterations)
    let v = new Float64Array(dim);
    const initEmb = embeddings.get(items[withEmbIdxs[0]].path);
    for (let d = 0; d < dim; d++) v[d] = initEmb[d] - mean[d];
    let vNorm = 0;
    for (let d = 0; d < dim; d++) vNorm += v[d] * v[d];
    vNorm = Math.sqrt(vNorm) || 1;
    for (let d = 0; d < dim; d++) v[d] /= vNorm;

    for (let iter = 0; iter < 5; iter++) {
        const w = new Float64Array(dim);
        for (let i = 0; i < n; i++) {
            const emb = embeddings.get(items[withEmbIdxs[i]].path);
            let dot = 0;
            for (let d = 0; d < dim; d++) dot += (emb[d] - mean[d]) * v[d];
            for (let d = 0; d < dim; d++) w[d] += dot * (emb[d] - mean[d]);
        }
        let wNorm = 0;
        for (let d = 0; d < dim; d++) wNorm += w[d] * w[d];
        wNorm = Math.sqrt(wNorm) || 1;
        for (let d = 0; d < dim; d++) v[d] = w[d] / wNorm;
    }

    // 3. Project each item and sort
    const projections = new Array(n);
    for (let i = 0; i < n; i++) {
        const emb = embeddings.get(items[withEmbIdxs[i]].path);
        let dot = 0;
        for (let d = 0; d < dim; d++) dot += (emb[d] - mean[d]) * v[d];
        projections[i] = { idx: withEmbIdxs[i], val: dot };
    }
    projections.sort((a, b) => a.val - b.val);

    const ordered = new Array(n);
    for (let i = 0; i < n; i++) ordered[i] = projections[i].idx;

    return folderIdxs.concat(ordered, noEmbIdxs);
}

// ── Date grouping ─────────────────────────────────────────────────────
// pad2, getDateGroupKey, getDateGroupLabel are in filter-sort-helpers.js

/**
 * Inject group headers by index. Pushes synthetic group-header objects into `synthetics[]`
 * and returns an array of indices where negative values are `-(synthetics.length)` pointers
 * (decoded as `synthetics[-idx - 1]` on the main thread).
 */
function injectDateGroupHeadersByIdx(fileIdxs, granularity, collapsedSet, synthetics) {
    const groups = new Map();
    const order = [];
    for (const idx of fileIdxs) {
        const k = getDateGroupKey(items[idx], granularity);
        if (!groups.has(k)) { groups.set(k, []); order.push(k); }
        groups.get(k).push(idx);
    }
    const result = [];
    for (const k of order) {
        const arr = groups.get(k);
        synthetics.push({ type: 'group-header', groupKey: k, label: getDateGroupLabel(k), count: arr.length });
        result.push(-synthetics.length); // synthetic pointer
        if (!collapsedSet.has(k)) {
            for (const idx of arr) result.push(idx);
        }
    }
    return result;
}

// ── Message handler ───────────────────────────────────────────────────

self.onmessage = (e) => {
    const msg = e.data;
    if (!msg || !msg.type) return;

    switch (msg.type) {
        case 'setItems': {
            const newItems = msg.items || [];
            const newNamesLower = new Array(newItems.length);
            for (let i = 0; i < newItems.length; i++) {
                newNamesLower[i] = (newItems[i].name || '').toLowerCase();
            }
            // Try incremental trigram update (avoids full O(n*m) rebuild for minor changes)
            const wasIncremental = tryIncrementalTrigramUpdate(newItems, newNamesLower);
            items = newItems;
            itemNamesLower = newNamesLower;
            if (!wasIncremental) {
                buildTrigramIndex();
            }
            break;
        }
        case 'setRatings': {
            ratings = msg.ratings || {};
            normalizedRatings = {};
            for (const p of Object.keys(ratings)) {
                normalizedRatings[normalizePath(p)] = ratings[p];
            }
            break;
        }
        case 'setPins': {
            pins = new Set((msg.paths || []).map(normalizePath));
            break;
        }
        case 'setTagFilter': {
            tagFilteredPaths = msg.paths ? new Set(msg.paths.map(normalizePath)) : null;
            break;
        }
        case 'setEmbeddings': {
            const map = new Map();
            const obj = msg.embeddings || {};
            for (const k of Object.keys(obj)) {
                const v = obj[k];
                if (v) map.set(k, v instanceof Float32Array ? v : new Float32Array(v));
            }
            embeddings = map;
            break;
        }
        case 'setOneEmbedding': {
            if (msg.path && msg.vec) {
                embeddings.set(msg.path, msg.vec instanceof Float32Array ? msg.vec : new Float32Array(msg.vec));
            } else if (msg.path) {
                embeddings.delete(msg.path);
            }
            break;
        }
        case 'setEmbeddingsBatch': {
            // Delta batch: add/update multiple embeddings without replacing the entire map
            const entries = msg.entries; // array of { path, vec }
            if (entries) {
                for (let i = 0; i < entries.length; i++) {
                    const e = entries[i];
                    if (e.path && e.vec) {
                        embeddings.set(e.path, e.vec instanceof Float32Array ? e.vec : new Float32Array(e.vec));
                    }
                }
            }
            // Also handle removals if provided
            const removed = msg.removed;
            if (removed) {
                for (let i = 0; i < removed.length; i++) {
                    embeddings.delete(removed[i]);
                }
            }
            break;
        }
        case 'setPluginSortKeys': {
            if (msg.keys) {
                pluginSortKeys = {};
                for (const p of Object.keys(msg.keys)) {
                    pluginSortKeys[normalizePath(p)] = msg.keys[p];
                }
            } else {
                pluginSortKeys = null;
            }
            break;
        }
        case 'setDuplicateGroups': {
            dedupEnabled = !!msg.dedupEnabled;
            dedupPathToHash = new Map();
            if (msg.pathToHash) {
                for (const [p, h] of Object.entries(msg.pathToHash)) {
                    if (h) dedupPathToHash.set(p, h);
                }
            }
            break;
        }
        case 'setTextEmbedding': {
            textEmbedding = msg.vec ? (msg.vec instanceof Float32Array ? msg.vec : new Float32Array(msg.vec)) : null;
            break;
        }
        case 'setFindSimilarEmbedding': {
            findSimilarEmbedding = msg.vec ? (msg.vec instanceof Float32Array ? msg.vec : new Float32Array(msg.vec)) : null;
            break;
        }
        case 'applyFilters': {
            try {
                const _pipeT0 = performance.now();
                const result = runFilterPipeline(msg.state || {});
                console.log(`[worker] full pipeline took ${(performance.now() - _pipeT0).toFixed(0)}ms, ${result.indices.length} results`);
                // Collect transferable buffers so we don't copy score arrays
                const transferables = [result.indices.buffer];
                if (result.scores.ai)      transferables.push(result.scores.ai.buffer);
                if (result.scores.sim)     transferables.push(result.scores.sim.buffer);
                if (result.scores.ratings) transferables.push(result.scores.ratings.buffer);
                self.postMessage({
                    type: 'result',
                    token: msg.token,
                    indices: result.indices,
                    synthetics: result.synthetics,
                    scores: result.scores,
                    counts: result.counts,
                    groupHeadersPresent: result.groupHeadersPresent
                }, transferables);
            } catch (err) {
                self.postMessage({
                    type: 'error',
                    token: msg.token,
                    error: err && err.message ? err.message : String(err)
                });
            }
            break;
        }
    }
};
