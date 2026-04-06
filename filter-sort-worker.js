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

// ── Worker state ──────────────────────────────────────────────────────

let items = [];
let itemNamesLower = [];        // pre-lowercased names for fast includes()
let ratings = {};               // path -> 1..5
let normalizedRatings = {};     // normalizedPath -> 1..5 (mirror for path variations)
let pins = new Set();           // normalized paths
let tagFilteredPaths = null;    // Set<normalizedPath> or null
let embeddings = new Map();     // path -> Float32Array (L2-normalized)
let textEmbedding = null;       // Float32Array
let findSimilarEmbedding = null;// Float32Array

// Trigram index: trigram (3-char) -> Uint32Array of item indices (sorted)
// Built once when items are set. Used as a pre-filter for text search.
let trigramIndex = null;
let indexBuiltForItemCount = 0;

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
            const isGifOrWebp = fileName.endsWith('.gif') || fileName.endsWith('.webp');
            if (item.type === 'video') {
                // keep
            } else if (includeMovingImages && item.type === 'image' && isGifOrWebp) {
                // keep: moving images treated as videos
            } else {
                continue;
            }
        } else if (currentFilter === 'image') {
            if (item.type !== 'image') continue;
            if (includeMovingImages && (fileName.endsWith('.gif') || fileName.endsWith('.webp'))) continue;
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

    // Visual clustering (nearest-neighbor reordering) on indices
    let orderedIndices = filtered;
    if (aiVisualSearchEnabled && aiClusteringMode === 'similarity' && embeddings.size > 0 && q === '') {
        orderedIndices = applyVisualClusteringByIdx(filtered);
    }

    // Separate folders/files by index
    const folderIdxs = [], fileIdxs = [];
    for (const idx of orderedIndices) {
        if (isFolderIdx(idx)) folderIdxs.push(idx);
        else fileIdxs.push(idx);
    }

    // Primary sort (name/date/size/dimensions/rating) if no scoring sort applied
    const skipPrimarySort = (useAiSearch && q !== '') || useFindSimilar || (starFilterActive && starSortOrder !== 'none');
    if (!skipPrimarySort) {
        const nameCmp = (a, b) => items[a].name.localeCompare(items[b].name, undefined, { numeric: true });
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
            }
            return sortOrder === 'ascending' ? c : -c;
        };
        folderIdxs.sort(cmp);
        fileIdxs.sort(cmp);
    }

    // Partition pinned to top (operating on indices)
    const pFolders = [], uFolders = [], pFiles = [], uFiles = [];
    for (const idx of folderIdxs) (isPinned(items[idx].path) ? pFolders : uFolders).push(idx);
    for (const idx of fileIdxs) (isPinned(items[idx].path) ? pFiles : uFiles).push(idx);

    // Build final index array + synthetics (group headers)
    const synthetics = [];
    let finalIndices;
    let groupHeadersPresent = false;

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
// Uses random-projection LSH for O(n log n) clustering instead of O(n²)
// greedy nearest-neighbor. See renderer.js applyVisualClustering for details.

const _wClusterProjections = []; // lazily initialised random unit vectors
const _W_CLUSTER_NUM_PROJECTIONS = 24;

function _wEnsureClusterProjections(dim) {
    if (_wClusterProjections.length >= _W_CLUSTER_NUM_PROJECTIONS && _wClusterProjections[0].length === dim) return;
    _wClusterProjections.length = 0;
    for (let p = 0; p < _W_CLUSTER_NUM_PROJECTIONS; p++) {
        const v = new Float32Array(dim);
        let norm = 0;
        for (let i = 0; i < dim; i++) {
            const u1 = Math.random(), u2 = Math.random();
            v[i] = Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
            norm += v[i] * v[i];
        }
        norm = Math.sqrt(norm);
        for (let i = 0; i < dim; i++) v[i] /= norm;
        _wClusterProjections.push(v);
    }
}

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

    // Determine embedding dimension from first item
    const firstEmb = embeddings.get(items[withEmbIdxs[0]].path);
    const dim = firstEmb.length;
    _wEnsureClusterProjections(dim);

    // Compute LSH hash per item and sort
    const hashEntries = new Array(withEmbIdxs.length);
    for (let i = 0; i < withEmbIdxs.length; i++) {
        const emb = embeddings.get(items[withEmbIdxs[i]].path);
        let hash = 0;
        for (let p = 0; p < _W_CLUSTER_NUM_PROJECTIONS; p++) {
            const proj = _wClusterProjections[p];
            let dot = 0;
            for (let d = 0; d < dim; d++) dot += emb[d] * proj[d];
            if (dot >= 0) hash |= (1 << p);
        }
        hashEntries[i] = { idx: withEmbIdxs[i], hash };
    }
    hashEntries.sort((a, b) => a.hash - b.hash);

    const ordered = new Array(hashEntries.length);
    for (let i = 0; i < hashEntries.length; i++) ordered[i] = hashEntries[i].idx;

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
            items = msg.items || [];
            itemNamesLower = new Array(items.length);
            for (let i = 0; i < items.length; i++) {
                itemNamesLower[i] = (items[i].name || '').toLowerCase();
            }
            buildTrigramIndex();
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
                const result = runFilterPipeline(msg.state || {});
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
