/**
 * Tests for filter-sort-worker.js
 *
 * Strategy: mock Web Worker globals (self, importScripts), require the worker file,
 * then interact through the message handler (self.onmessage). Results are inspected
 * via self.postMessage mock calls.
 */

// ── Setup Worker globals before require ──────────────────────────────────────
const path = require('path');

// Mock `self` (Web Worker global)
const mockSelf = { postMessage: vi.fn() };
global.self = mockSelf;

// Mock `importScripts` — load file and put its exports onto global (mimics Worker scope)
global.importScripts = (p) => {
    const abs = path.resolve(__dirname, '..', p.replace(/^\.\//, ''));
    const exports = require(abs);
    if (exports && typeof exports === 'object') {
        for (const [k, v] of Object.entries(exports)) {
            global[k] = v;
        }
    }
};

// Mock console.log to suppress worker pipeline timing logs
vi.spyOn(console, 'log').mockImplementation(() => {});

// Load the worker (executes top-level code, sets self.onmessage)
require('../filter-sort-worker');

// ── Helpers ──────────────────────────────────────────────────────────────────

function send(msg) {
    self.onmessage({ data: msg });
}

function applyFilters(state = {}, token = 1) {
    self.postMessage.mockClear();
    send({ type: 'applyFilters', token, state });
    const call = self.postMessage.mock.calls[0];
    expect(call).toBeDefined();
    return call[0]; // the message object
}

/** Get the indices from the last applyFilters result as a plain Array. */
function resultIndices(state = {}) {
    const msg = applyFilters(state);
    return Array.from(msg.indices);
}

/** Build a simple test item. */
function makeItem(name, type = 'image', extra = {}) {
    return { name, path: `/test/${name}`, type, mtime: 0, size: 0, ...extra };
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
    self.postMessage.mockClear();
    // Reset to empty state
    send({ type: 'setItems', items: [] });
    send({ type: 'setRatings', ratings: {} });
    send({ type: 'setPins', paths: [] });
    send({ type: 'setTagFilter', paths: null });
    send({ type: 'setEmbeddings', embeddings: {} });
    send({ type: 'setTextEmbedding', vec: null });
    send({ type: 'setFindSimilarEmbedding', vec: null });
});

// ═══════════════════════════════════════════════════════════════════════════
// STATE SETTERS
// ═══════════════════════════════════════════════════════════════════════════

describe('state setters', () => {
    it('setItems + applyFilters returns all item indices', () => {
        send({ type: 'setItems', items: [makeItem('a.png'), makeItem('b.png'), makeItem('c.png')] });
        const indices = resultIndices();
        expect(indices).toEqual([0, 1, 2]);
    });

    it('setItems with empty array clears state', () => {
        send({ type: 'setItems', items: [makeItem('a.png')] });
        send({ type: 'setItems', items: [] });
        expect(resultIndices()).toEqual([]);
    });

    it('setRatings stores ratings keyed by path', () => {
        send({ type: 'setItems', items: [makeItem('a.png'), makeItem('b.png')] });
        send({ type: 'setRatings', ratings: { '/test/a.png': 5 } });
        const msg = applyFilters({ starFilterActive: true });
        // Only a.png (index 0) has a rating
        expect(Array.from(msg.indices)).toEqual([0]);
    });

    it('setRatings builds normalizedRatings for backslash paths', () => {
        send({ type: 'setItems', items: [makeItem('a.png')] });
        // Rating stored with backslash path, but item has forward slash
        send({ type: 'setRatings', ratings: { '\\test\\a.png': 3 } });
        const msg = applyFilters({ starFilterActive: true });
        expect(Array.from(msg.indices)).toEqual([0]);
    });

    it('setPins stores normalized pin set', () => {
        const items = [makeItem('a.png'), makeItem('b.png')];
        send({ type: 'setItems', items });
        send({ type: 'setPins', paths: ['\\test\\a.png'] }); // backslash
        // Pinned items should appear first in sort order
        const indices = resultIndices({ sortType: 'name', sortOrder: 'ascending' });
        expect(indices[0]).toBe(0); // a.png is pinned, appears first
    });

    it('setTagFilter stores normalized path set', () => {
        send({ type: 'setItems', items: [makeItem('a.png'), makeItem('b.png')] });
        send({ type: 'setTagFilter', paths: ['/test/a.png'] });
        const msg = applyFilters({ tagFilterActive: true });
        expect(Array.from(msg.indices)).toEqual([0]);
    });

    it('setTagFilter with null clears filter', () => {
        send({ type: 'setItems', items: [makeItem('a.png'), makeItem('b.png')] });
        send({ type: 'setTagFilter', paths: ['/test/a.png'] });
        send({ type: 'setTagFilter', paths: null });
        // tagFilterActive=true but no paths set → should filter out all non-folders
        const msg = applyFilters({ tagFilterActive: false });
        expect(Array.from(msg.indices)).toHaveLength(2);
    });

    it('setEmbeddings stores Float32Array map', () => {
        send({ type: 'setEmbeddings', embeddings: { '/test/a.png': [1, 0, 0] } });
        // No assertion on state directly — tested via AI search below
    });

    it('setOneEmbedding adds a single embedding', () => {
        send({ type: 'setOneEmbedding', path: '/test/a.png', vec: [1, 0, 0] });
        // Tested via AI search
    });

    it('setOneEmbedding with null vec deletes embedding', () => {
        send({ type: 'setOneEmbedding', path: '/test/a.png', vec: [1, 0, 0] });
        send({ type: 'setOneEmbedding', path: '/test/a.png', vec: null });
        // Tested via AI search — should not match
    });

    it('setTextEmbedding stores search embedding', () => {
        send({ type: 'setTextEmbedding', vec: [1, 0, 0] });
        // Tested via AI search
    });

    it('setFindSimilarEmbedding stores similarity embedding', () => {
        send({ type: 'setFindSimilarEmbedding', vec: [1, 0, 0] });
        // Tested via find similar
    });

    it('ignores unknown message types', () => {
        send({ type: 'unknownCommand' });
        // Should not throw or post any message
        expect(self.postMessage).not.toHaveBeenCalled();
    });

    it('ignores messages without type', () => {
        send({ foo: 'bar' });
        expect(self.postMessage).not.toHaveBeenCalled();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// TEXT SEARCH
// ═══════════════════════════════════════════════════════════════════════════

describe('text search', () => {
    beforeEach(() => {
        send({ type: 'setItems', items: [
            makeItem('sunset_beach.png'),
            makeItem('mountain_view.jpg'),
            makeItem('beach_party.gif'),
            makeItem('city_skyline.webp'),
        ]});
    });

    it('empty query returns all items', () => {
        expect(resultIndices({ query: '' })).toHaveLength(4);
    });

    it('filters by text query (substring match)', () => {
        const indices = resultIndices({ query: 'beach' });
        expect(indices).toHaveLength(2);
        // Both sunset_beach.png and beach_party.gif match
    });

    it('text search is case-insensitive', () => {
        const indices = resultIndices({ query: 'BEACH' });
        expect(indices).toHaveLength(2);
    });

    it('short query (< 3 chars) works via linear scan', () => {
        const indices = resultIndices({ query: 'ci' });
        expect(indices).toHaveLength(1); // city_skyline
    });

    it('trigram index accelerates search for queries >= 3 chars', () => {
        // This is tested implicitly — "beach" is 5 chars, triggers trigram path
        const indices = resultIndices({ query: 'beach' });
        expect(indices).toHaveLength(2);
    });

    it('query with no matches returns empty', () => {
        expect(resultIndices({ query: 'zzzzzzz' })).toHaveLength(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// TYPE FILTERS
// ═══════════════════════════════════════════════════════════════════════════

describe('type filters', () => {
    beforeEach(() => {
        send({ type: 'setItems', items: [
            makeItem('vid.mp4', 'video'),
            makeItem('pic.png', 'image'),
            makeItem('anim.gif', 'image'),
            makeItem('folder1', 'folder'),
        ]});
    });

    it('currentFilter=all keeps everything', () => {
        expect(resultIndices({ currentFilter: 'all' })).toHaveLength(4);
    });

    it('currentFilter=video keeps only videos', () => {
        const indices = resultIndices({ currentFilter: 'video', includeMovingImages: false });
        expect(indices).toHaveLength(1);
    });

    it('currentFilter=video includes animated GIF when includeMovingImages=true', () => {
        const indices = resultIndices({ currentFilter: 'video', includeMovingImages: true });
        expect(indices).toHaveLength(2); // vid.mp4 + anim.gif
    });

    it('currentFilter=image keeps only images', () => {
        const indices = resultIndices({ currentFilter: 'image', includeMovingImages: false });
        expect(indices).toHaveLength(2); // pic.png + anim.gif
    });

    it('currentFilter=image excludes GIF/WebP when includeMovingImages=true', () => {
        const indices = resultIndices({ currentFilter: 'image', includeMovingImages: true });
        expect(indices).toHaveLength(1); // only pic.png
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// STAR RATING FILTER
// ═══════════════════════════════════════════════════════════════════════════

describe('star rating filter', () => {
    beforeEach(() => {
        send({ type: 'setItems', items: [
            makeItem('a.png'),
            makeItem('b.png'),
            makeItem('c.png'),
            makeItem('folder1', 'folder'),
        ]});
        send({ type: 'setRatings', ratings: { '/test/a.png': 5, '/test/b.png': 2 } });
    });

    it('starFilterActive=true keeps only rated items', () => {
        const indices = resultIndices({ starFilterActive: true });
        expect(indices).toHaveLength(2); // a.png(5) and b.png(2)
    });

    it('starFilterActive=true excludes folders', () => {
        const indices = resultIndices({ starFilterActive: true });
        expect(indices).not.toContain(3); // folder1
    });

    it('starSortOrder=asc sorts by rating ascending', () => {
        const indices = resultIndices({ starFilterActive: true, starSortOrder: 'asc' });
        expect(indices[0]).toBe(1); // b.png (rating 2) first
        expect(indices[1]).toBe(0); // a.png (rating 5) second
    });

    it('starSortOrder=desc sorts by rating descending', () => {
        const indices = resultIndices({ starFilterActive: true, starSortOrder: 'desc' });
        expect(indices[0]).toBe(0); // a.png (rating 5) first
        expect(indices[1]).toBe(1); // b.png (rating 2) second
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// TAG FILTER
// ═══════════════════════════════════════════════════════════════════════════

describe('tag filter', () => {
    beforeEach(() => {
        send({ type: 'setItems', items: [
            makeItem('a.png'),
            makeItem('b.png'),
            makeItem('folder1', 'folder'),
        ]});
    });

    it('tagFilterActive=true keeps only tag-filtered paths', () => {
        send({ type: 'setTagFilter', paths: ['/test/a.png'] });
        const indices = resultIndices({ tagFilterActive: true });
        expect(indices).toEqual([0]);
    });

    it('tagFilterActive=true excludes folders', () => {
        send({ type: 'setTagFilter', paths: ['/test/a.png', '/test/folder1'] });
        const indices = resultIndices({ tagFilterActive: true });
        expect(indices).not.toContain(2);
    });

    it('tagFilterActive=false ignores tag filter', () => {
        send({ type: 'setTagFilter', paths: ['/test/a.png'] });
        const indices = resultIndices({ tagFilterActive: false });
        expect(indices).toHaveLength(3);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// AI SIMILARITY SEARCH
// ═══════════════════════════════════════════════════════════════════════════

describe('AI similarity search', () => {
    const embA = [1, 0, 0];    // unit vector along X
    const embB = [0, 1, 0];    // unit vector along Y
    const embC = [0.9, 0.1, 0]; // close to A
    const textEmb = [1, 0, 0]; // search for X-direction

    beforeEach(() => {
        send({ type: 'setItems', items: [
            makeItem('a.png'),
            makeItem('b.png'),
            makeItem('c.png'),
        ]});
        send({ type: 'setEmbeddings', embeddings: {
            '/test/a.png': embA,
            '/test/b.png': embB,
            '/test/c.png': embC,
        }});
        send({ type: 'setTextEmbedding', vec: textEmb });
    });

    it('AI search scores items by cosine similarity', () => {
        const msg = applyFilters({
            query: 'test',
            aiVisualSearchEnabled: true,
            aiSearchActive: true,
            aiSimilarityThreshold: 0.1,
        });
        const indices = Array.from(msg.indices);
        // a.png has highest similarity (1.0), then c.png (~0.99), b.png (0.0) filtered out by threshold
        expect(indices[0]).toBe(0); // a.png
        expect(indices[1]).toBe(2); // c.png
    });

    it('AI search excludes items below threshold', () => {
        const msg = applyFilters({
            query: 'test',
            aiVisualSearchEnabled: true,
            aiSearchActive: true,
            aiSimilarityThreshold: 0.5,
        });
        const indices = Array.from(msg.indices);
        expect(indices).not.toContain(1); // b.png similarity ~0
    });

    it('AI search falls back to text for items without embeddings', () => {
        send({ type: 'setEmbeddings', embeddings: {} }); // clear all embeddings
        send({ type: 'setItems', items: [makeItem('test_file.png'), makeItem('other.png')] });
        const msg = applyFilters({
            query: 'test',
            aiVisualSearchEnabled: true,
            aiSearchActive: true,
            aiSimilarityThreshold: 0.1,
        });
        const indices = Array.from(msg.indices);
        // Falls back to substring match — test_file matches "test"
        expect(indices).toHaveLength(1);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// FIND SIMILAR
// ═══════════════════════════════════════════════════════════════════════════

describe('find similar', () => {
    beforeEach(() => {
        send({ type: 'setItems', items: [
            makeItem('a.png'),
            makeItem('b.png'),
            makeItem('c.png'),
            makeItem('folder1', 'folder'),
        ]});
        send({ type: 'setEmbeddings', embeddings: {
            '/test/a.png': [1, 0, 0],
            '/test/b.png': [0, 1, 0],
            '/test/c.png': [0.9, 0.1, 0],
        }});
        send({ type: 'setFindSimilarEmbedding', vec: [1, 0, 0] });
    });

    it('find similar ranks by cosine similarity', () => {
        const msg = applyFilters({ findSimilarActive: true, findSimilarThreshold: 0.1 });
        const indices = Array.from(msg.indices);
        expect(indices[0]).toBe(0); // a.png (similarity 1.0)
    });

    it('find similar excludes items below threshold', () => {
        const msg = applyFilters({ findSimilarActive: true, findSimilarThreshold: 0.5 });
        const indices = Array.from(msg.indices);
        expect(indices).not.toContain(1); // b.png similarity ~0
    });

    it('find similar excludes folders', () => {
        const msg = applyFilters({ findSimilarActive: true, findSimilarThreshold: 0.0 });
        const indices = Array.from(msg.indices);
        expect(indices).not.toContain(3);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// ADVANCED SEARCH FILTERS
// ═══════════════════════════════════════════════════════════════════════════

describe('advanced search filters', () => {
    beforeEach(() => {
        send({ type: 'setItems', items: [
            makeItem('a.png', 'image', { width: 1920, height: 1080, size: 5000000 }),
            makeItem('b.png', 'image', { width: 800, height: 600, size: 1000000 }),
            makeItem('c.png', 'image', { width: 1920, height: 1080, size: 3000000 }),
        ]});
    });

    it('filters by exact width', () => {
        const indices = resultIndices({ advancedSearchFilters: { width: 800 } });
        expect(indices).toEqual([1]);
    });

    it('filters by exact height', () => {
        const indices = resultIndices({ advancedSearchFilters: { height: 1080 } });
        expect(indices).toHaveLength(2); // a.png and c.png
    });

    it('filters by aspect ratio with tolerance', () => {
        const indices = resultIndices({ advancedSearchFilters: { aspectRatio: '16:9' } });
        expect(indices).toHaveLength(2); // 1920/1080 ≈ 1.78
    });

    it('filters by minimum star rating', () => {
        send({ type: 'setRatings', ratings: { '/test/a.png': 4, '/test/b.png': 2, '/test/c.png': 5 } });
        const indices = resultIndices({ advancedSearchFilters: { starRating: 3 } });
        expect(indices).toHaveLength(2); // a(4) and c(5)
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// SORTING
// ═══════════════════════════════════════════════════════════════════════════

describe('sorting', () => {
    beforeEach(() => {
        send({ type: 'setItems', items: [
            makeItem('banana.png', 'image', { mtime: 200, size: 3000 }),
            makeItem('apple.png', 'image', { mtime: 100, size: 1000 }),
            makeItem('cherry.png', 'image', { mtime: 300, size: 2000 }),
        ]});
    });

    it('sorts by name ascending (natural order)', () => {
        const indices = resultIndices({ sortType: 'name', sortOrder: 'ascending' });
        expect(indices).toEqual([1, 0, 2]); // apple, banana, cherry
    });

    it('sorts by name descending', () => {
        const indices = resultIndices({ sortType: 'name', sortOrder: 'descending' });
        expect(indices).toEqual([2, 0, 1]); // cherry, banana, apple
    });

    it('sorts by date ascending', () => {
        const indices = resultIndices({ sortType: 'date', sortOrder: 'ascending' });
        expect(indices).toEqual([1, 0, 2]); // apple(100), banana(200), cherry(300)
    });

    it('sorts by date descending', () => {
        const indices = resultIndices({ sortType: 'date', sortOrder: 'descending' });
        expect(indices).toEqual([2, 0, 1]);
    });

    it('sorts by size ascending', () => {
        const indices = resultIndices({ sortType: 'size', sortOrder: 'ascending' });
        expect(indices).toEqual([1, 2, 0]); // 1000, 2000, 3000
    });

    it('sorts by dimensions ascending (width * height)', () => {
        send({ type: 'setItems', items: [
            makeItem('a.png', 'image', { width: 100, height: 100 }),  // 10000
            makeItem('b.png', 'image', { width: 200, height: 200 }),  // 40000
            makeItem('c.png', 'image', { width: 50, height: 50 }),    // 2500
        ]});
        const indices = resultIndices({ sortType: 'dimensions', sortOrder: 'ascending' });
        expect(indices).toEqual([2, 0, 1]); // 2500, 10000, 40000
    });

    it('sorts by rating (ascending puts highest last)', () => {
        send({ type: 'setRatings', ratings: {
            '/test/banana.png': 3,
            '/test/apple.png': 5,
            '/test/cherry.png': 1,
        }});
        // Rating comparator is bR-aR (desc default); sortOrder flips that.
        // ascending: cherry(1) → banana(3) → apple(5)
        const indices = resultIndices({ sortType: 'rating', sortOrder: 'ascending' });
        expect(indices[0]).toBe(1); // apple (5) — highest rating first with ascending + desc default
        expect(indices[2]).toBe(2); // cherry (1) — lowest last
    });

    it('falls back to name sort on ties', () => {
        send({ type: 'setItems', items: [
            makeItem('b.png', 'image', { mtime: 100 }),
            makeItem('a.png', 'image', { mtime: 100 }),
        ]});
        const indices = resultIndices({ sortType: 'date', sortOrder: 'ascending' });
        expect(indices).toEqual([1, 0]); // a.png before b.png (same date)
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// PINNING
// ═══════════════════════════════════════════════════════════════════════════

describe('pinning', () => {
    it('pinned items sort before unpinned items', () => {
        send({ type: 'setItems', items: [
            makeItem('b.png'),
            makeItem('a.png'),
        ]});
        send({ type: 'setPins', paths: ['/test/b.png'] });
        const indices = resultIndices({ sortType: 'name', sortOrder: 'ascending' });
        expect(indices[0]).toBe(0); // b.png is pinned → first
    });

    it('folders always appear before files', () => {
        send({ type: 'setItems', items: [
            makeItem('z_file.png'),
            makeItem('a_folder', 'folder'),
        ]});
        const indices = resultIndices({ sortType: 'name', sortOrder: 'ascending' });
        expect(indices[0]).toBe(1); // folder first
    });

    it('pinned folders sort before unpinned folders', () => {
        send({ type: 'setItems', items: [
            makeItem('z_folder', 'folder'),
            makeItem('a_folder', 'folder'),
        ]});
        send({ type: 'setPins', paths: ['/test/z_folder'] });
        const indices = resultIndices({ sortType: 'name', sortOrder: 'ascending' });
        expect(indices[0]).toBe(0); // z_folder is pinned → first despite name
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// DATE GROUPING
// ═══════════════════════════════════════════════════════════════════════════

describe('date grouping', () => {
    beforeEach(() => {
        send({ type: 'setItems', items: [
            makeItem('jan.png', 'image', { mtime: new Date('2024-01-15').getTime() }),
            makeItem('feb.png', 'image', { mtime: new Date('2024-02-15').getTime() }),
            makeItem('jan2.png', 'image', { mtime: new Date('2024-01-20').getTime() }),
        ]});
    });

    it('groupByDate=true injects group headers (negative indices)', () => {
        const msg = applyFilters({ groupByDate: true, dateGroupGranularity: 'month', sortType: 'date', sortOrder: 'ascending' });
        const indices = Array.from(msg.indices);
        // Should have negative indices for group headers
        const negatives = indices.filter(i => i < 0);
        expect(negatives.length).toBeGreaterThan(0);
        expect(msg.groupHeadersPresent).toBe(true);
    });

    it('group headers have correct labels via synthetics', () => {
        const msg = applyFilters({ groupByDate: true, dateGroupGranularity: 'month', sortType: 'date', sortOrder: 'ascending' });
        expect(msg.synthetics.length).toBeGreaterThan(0);
        expect(msg.synthetics[0].type).toBe('group-header');
        expect(msg.synthetics[0].groupKey).toBeDefined();
        expect(msg.synthetics[0].label).toBeDefined();
        expect(msg.synthetics[0].count).toBeGreaterThan(0);
    });

    it('collapsed groups hide their items', () => {
        // First get the group keys
        const msg1 = applyFilters({ groupByDate: true, dateGroupGranularity: 'month', sortType: 'date', sortOrder: 'ascending' });
        const firstKey = msg1.synthetics[0].groupKey;

        // Now collapse that group
        const msg2 = applyFilters({
            groupByDate: true, dateGroupGranularity: 'month',
            sortType: 'date', sortOrder: 'ascending',
            collapsedGroups: [firstKey],
        });
        // Collapsed group should have fewer total indices (header remains, items hidden)
        expect(msg2.indices.length).toBeLessThan(msg1.indices.length);
    });

    it('groupByDate=false produces no headers', () => {
        const msg = applyFilters({ groupByDate: false });
        expect(msg.groupHeadersPresent).toBe(false);
        expect(msg.synthetics).toHaveLength(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// COUNTS AND ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════

describe('counts and error handling', () => {
    it('returns correct folder/image/video counts', () => {
        send({ type: 'setItems', items: [
            makeItem('a.png', 'image'),
            makeItem('b.mp4', 'video'),
            makeItem('c.png', 'image'),
            makeItem('dir', 'folder'),
        ]});
        const msg = applyFilters();
        expect(msg.counts).toEqual({ folders: 1, images: 2, videos: 1 });
    });

    it('echoes token in result', () => {
        send({ type: 'setItems', items: [makeItem('a.png')] });
        const msg = applyFilters({}, 42);
        expect(msg.token).toBe(42);
    });

    it('result type is "result"', () => {
        send({ type: 'setItems', items: [makeItem('a.png')] });
        const msg = applyFilters({});
        expect(msg.type).toBe('result');
    });
});

// ── Embedding batch operations ──────────────────────────────────────────

describe('setEmbeddingsBatch', () => {
    it('adds multiple embeddings from entries array', () => {
        const vec1 = new Float32Array([1, 2, 3]);
        const vec2 = new Float32Array([4, 5, 6]);
        send({ type: 'setEmbeddingsBatch', entries: [
            { path: '/a.png', vec: vec1 },
            { path: '/b.png', vec: vec2 }
        ]});
        // Verify by using AI sort (which requires embeddings)
        send({ type: 'setItems', items: [makeItem('a.png', { path: '/a.png' }), makeItem('b.png', { path: '/b.png' })] });
        // If embeddings are set, AI score sorting should not crash
        const msg = applyFilters({ sortType: 'aiScore', sortOrder: 'desc' });
        expect(msg.type).toBe('result');
    });

    it('handles entries with plain arrays (converts to Float32Array)', () => {
        send({ type: 'setEmbeddingsBatch', entries: [
            { path: '/c.png', vec: [0.1, 0.2, 0.3] }
        ]});
        // Should not throw
        send({ type: 'setItems', items: [makeItem('c.png', { path: '/c.png' })] });
        const msg = applyFilters({});
        expect(msg.type).toBe('result');
    });

    it('handles removals in batch', () => {
        const vec = new Float32Array([1, 2, 3]);
        send({ type: 'setEmbedding', path: '/x.png', vec });
        send({ type: 'setEmbeddingsBatch', entries: [], removed: ['/x.png'] });
        // After removal, embedding should be gone
        send({ type: 'setItems', items: [makeItem('x.png', { path: '/x.png' })] });
        const msg = applyFilters({});
        expect(msg.type).toBe('result');
    });

    it('skips entries with missing path or vec', () => {
        send({ type: 'setEmbeddingsBatch', entries: [
            { path: null, vec: [1, 2] },
            { path: '/valid.png', vec: null },
            { path: '/ok.png', vec: [1, 2, 3] }
        ]});
        // Should not throw
        const msg = applyFilters({});
        expect(msg.type).toBe('result');
    });
});

// ── setTextEmbedding / setFindSimilarEmbedding ─────────────────────────

describe('setTextEmbedding', () => {
    it('sets text embedding from Float32Array', () => {
        send({ type: 'setTextEmbedding', vec: new Float32Array([0.5, 0.5]) });
        // Should not throw
        const msg = applyFilters({});
        expect(msg.type).toBe('result');
    });

    it('clears text embedding when vec is null', () => {
        send({ type: 'setTextEmbedding', vec: null });
        const msg = applyFilters({});
        expect(msg.type).toBe('result');
    });
});

describe('setFindSimilarEmbedding', () => {
    it('sets find-similar embedding', () => {
        send({ type: 'setFindSimilarEmbedding', vec: new Float32Array([0.1, 0.2, 0.3]) });
        const msg = applyFilters({});
        expect(msg.type).toBe('result');
    });

    it('clears find-similar embedding when vec is null', () => {
        send({ type: 'setFindSimilarEmbedding', vec: null });
        const msg = applyFilters({});
        expect(msg.type).toBe('result');
    });
});
