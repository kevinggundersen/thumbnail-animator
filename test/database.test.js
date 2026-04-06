const AppDatabase = require('../database');

let db;

beforeEach(() => {
    db = new AppDatabase(':memory:');
});

afterEach(() => {
    db.close();
});

// ── Schema & Meta ─────────────────────────────────────────────────────

describe('schema & meta', () => {
    it('initializes schema to version 3', () => {
        expect(db.getMeta('schema_version')).toBe('3');
    });

    it('round-trips arbitrary meta key/value', () => {
        db.setMeta('foo', 'bar');
        expect(db.getMeta('foo')).toBe('bar');
    });

    it('overwrites existing meta value', () => {
        db.setMeta('k', '1');
        db.setMeta('k', '2');
        expect(db.getMeta('k')).toBe('2');
    });

    it('returns null for missing meta key', () => {
        expect(db.getMeta('nonexistent')).toBeNull();
    });

    it('reports migration not complete initially', () => {
        const status = db.checkMigrationStatus();
        expect(status.migrationComplete).toBe(false);
        expect(status.migrationVerified).toBe(false);
    });
});

// ── Ratings ───────────────────────────────────────────────────────────

describe('ratings', () => {
    it('returns empty map when no ratings exist', () => {
        expect(db.getAllRatings()).toEqual({});
    });

    it('sets and retrieves a rating', () => {
        db.setRating('/img/a.jpg', 4);
        expect(db.getAllRatings()).toEqual({ '/img/a.jpg': 4 });
    });

    it('deletes rating when set to 0', () => {
        db.setRating('/img/a.jpg', 3);
        db.setRating('/img/a.jpg', 0);
        expect(db.getAllRatings()).toEqual({});
    });

    it('overwrites an existing rating', () => {
        db.setRating('/img/a.jpg', 2);
        db.setRating('/img/a.jpg', 5);
        expect(db.getAllRatings()).toEqual({ '/img/a.jpg': 5 });
    });

    it('bulk sets multiple ratings', () => {
        db.bulkSetRatings({ '/a.jpg': 1, '/b.jpg': 3, '/c.jpg': 5 });
        const all = db.getAllRatings();
        expect(all['/a.jpg']).toBe(1);
        expect(all['/b.jpg']).toBe(3);
        expect(all['/c.jpg']).toBe(5);
    });
});

// ── Pins ──────────────────────────────────────────────────────────────

describe('pins', () => {
    it('returns empty map when no pins exist', () => {
        expect(db.getAllPinned()).toEqual({});
    });

    it('pins a file and retrieves it', () => {
        db.setPinned('/img/a.jpg', true);
        expect(db.getAllPinned()).toEqual({ '/img/a.jpg': true });
    });

    it('unpins a file', () => {
        db.setPinned('/img/a.jpg', true);
        db.setPinned('/img/a.jpg', false);
        expect(db.getAllPinned()).toEqual({});
    });

    it('bulk sets multiple pins', () => {
        db.bulkSetPinned({ '/a.jpg': true, '/b.jpg': true });
        const all = db.getAllPinned();
        expect(all['/a.jpg']).toBe(true);
        expect(all['/b.jpg']).toBe(true);
    });
});

// ── Favorites ─────────────────────────────────────────────────────────

describe('favorites', () => {
    it('returns empty favorites initially', () => {
        const fav = db.getFavorites();
        expect(fav).toEqual({ version: 2, groups: [] });
    });

    it('saves and retrieves favorites with groups and items', () => {
        db.saveFavorites({
            groups: [
                {
                    id: 'g1',
                    name: 'Group 1',
                    collapsed: false,
                    items: [
                        { path: '/a.jpg', addedAt: 1000 },
                        { path: '/b.jpg', addedAt: 2000 },
                    ],
                },
                {
                    id: 'g2',
                    name: 'Group 2',
                    collapsed: true,
                    items: [],
                },
            ],
        });

        const fav = db.getFavorites();
        expect(fav.version).toBe(2);
        expect(fav.groups).toHaveLength(2);
        expect(fav.groups[0].id).toBe('g1');
        expect(fav.groups[0].name).toBe('Group 1');
        expect(fav.groups[0].collapsed).toBe(false);
        expect(fav.groups[0].items).toHaveLength(2);
        expect(fav.groups[0].items[0].path).toBe('/a.jpg');
        expect(fav.groups[1].collapsed).toBe(true);
    });

    it('replaces favorites entirely on re-save', () => {
        db.saveFavorites({ groups: [{ id: 'g1', name: 'Old', items: [] }] });
        db.saveFavorites({ groups: [{ id: 'g2', name: 'New', items: [] }] });
        const fav = db.getFavorites();
        expect(fav.groups).toHaveLength(1);
        expect(fav.groups[0].id).toBe('g2');
    });
});

// ── Recent files ──────────────────────────────────────────────────────

describe('recent files', () => {
    it('returns empty list initially', () => {
        expect(db.getRecentFiles()).toEqual([]);
    });

    it('adds and retrieves a recent file', () => {
        db.addRecentFile({ path: '/a.jpg', addedAt: 1000 });
        const recent = db.getRecentFiles();
        expect(recent).toHaveLength(1);
        expect(recent[0].path).toBe('/a.jpg');
        expect(recent[0].addedAt).toBe(1000);
    });

    it('returns files sorted by timestamp descending', () => {
        db.addRecentFile({ path: '/old.jpg', addedAt: 1000 });
        db.addRecentFile({ path: '/new.jpg', addedAt: 3000 });
        db.addRecentFile({ path: '/mid.jpg', addedAt: 2000 });
        const recent = db.getRecentFiles();
        expect(recent.map(r => r.path)).toEqual(['/new.jpg', '/mid.jpg', '/old.jpg']);
    });

    it('trims entries beyond the limit', () => {
        for (let i = 0; i < 5; i++) {
            db.addRecentFile({ path: `/file${i}.jpg`, addedAt: i * 1000 }, 3);
        }
        const recent = db.getRecentFiles();
        expect(recent.length).toBeLessThanOrEqual(3);
    });

    it('clears all recent files', () => {
        db.addRecentFile({ path: '/a.jpg', addedAt: 1000 });
        db.clearRecentFiles();
        expect(db.getRecentFiles()).toEqual([]);
    });
});

// ── Collections ───────────────────────────────────────────────────────

describe('collections', () => {
    it('returns empty list initially', () => {
        expect(db.getAllCollections()).toEqual([]);
    });

    it('saves and retrieves a collection', () => {
        db.saveCollection({
            id: 'c1',
            name: 'My Collection',
            type: 'manual',
            sortOrder: 0,
            createdAt: 1000,
            updatedAt: 2000,
        });
        const all = db.getAllCollections();
        expect(all).toHaveLength(1);
        expect(all[0].id).toBe('c1');
        expect(all[0].name).toBe('My Collection');
    });

    it('retrieves a collection by ID', () => {
        db.saveCollection({ id: 'c1', name: 'Test' });
        expect(db.getCollection('c1').name).toBe('Test');
    });

    it('returns null for missing collection', () => {
        expect(db.getCollection('nope')).toBeNull();
    });

    it('deletes a collection and cascades to files', () => {
        db.saveCollection({ id: 'c1', name: 'Test' });
        db.addFilesToCollection('c1', ['/a.jpg']);
        db.deleteCollection('c1');
        expect(db.getCollection('c1')).toBeNull();
        expect(db.getCollectionFiles('c1')).toEqual([]);
    });

    it('adds files to a collection with deduplication', () => {
        db.saveCollection({ id: 'c1', name: 'Test' });
        const added1 = db.addFilesToCollection('c1', ['/a.jpg', '/b.jpg']);
        const added2 = db.addFilesToCollection('c1', ['/b.jpg', '/c.jpg']);
        expect(added1).toBe(2);
        expect(added2).toBe(1); // /b.jpg already exists
        expect(db.getCollectionFiles('c1')).toHaveLength(3);
    });

    it('removes a single file from a collection', () => {
        db.saveCollection({ id: 'c1', name: 'Test' });
        db.addFilesToCollection('c1', ['/a.jpg', '/b.jpg']);
        db.removeFileFromCollection('c1', '/a.jpg');
        const files = db.getCollectionFiles('c1');
        expect(files).toHaveLength(1);
        expect(files[0].filePath).toBe('/b.jpg');
    });

    it('removes multiple files from a collection', () => {
        db.saveCollection({ id: 'c1', name: 'Test' });
        db.addFilesToCollection('c1', ['/a.jpg', '/b.jpg', '/c.jpg']);
        db.removeFilesFromCollection('c1', ['/a.jpg', '/c.jpg']);
        const files = db.getCollectionFiles('c1');
        expect(files).toHaveLength(1);
        expect(files[0].filePath).toBe('/b.jpg');
    });

    it('saves and retrieves collection rules as JSON', () => {
        const rules = { type: 'auto', conditions: [{ field: 'rating', op: 'gte', value: 3 }] };
        db.saveCollection({ id: 'c1', name: 'Smart', type: 'smart', rules });
        const col = db.getCollection('c1');
        expect(col.rules).toEqual(rules);
    });
});

// ── Tags ──────────────────────────────────────────────────────────────

describe('tags', () => {
    it('returns empty list initially', () => {
        expect(db.getAllTags()).toEqual([]);
    });

    it('creates a tag and returns it with an ID', () => {
        const tag = db.createTag('Nature', 'Outdoor photos', '#00ff00');
        expect(tag.id).toBeGreaterThan(0);
        expect(tag.name).toBe('Nature');
        expect(tag.description).toBe('Outdoor photos');
        expect(tag.color).toBe('#00ff00');
    });

    it('returns all tags sorted by name (case-insensitive)', () => {
        db.createTag('Zebra');
        db.createTag('alpha');
        db.createTag('Beta');
        const tags = db.getAllTags();
        expect(tags.map(t => t.name)).toEqual(['alpha', 'Beta', 'Zebra']);
    });

    it('updates tag name, description, and color', () => {
        const tag = db.createTag('Old', 'desc', '#000');
        const updated = db.updateTag(tag.id, { name: 'New', description: 'new desc', color: '#fff' });
        expect(updated.name).toBe('New');
        expect(updated.description).toBe('new desc');
        expect(updated.color).toBe('#fff');
    });

    it('deletes a tag', () => {
        const tag = db.createTag('ToDelete');
        db.deleteTag(tag.id);
        expect(db.getTag(tag.id)).toBeNull();
    });

    it('searches tags with FTS prefix matching', () => {
        db.createTag('landscape');
        db.createTag('portrait');
        db.createTag('landmark');
        const results = db.searchTags('land');
        const names = results.map(t => t.name);
        expect(names).toContain('landscape');
        expect(names).toContain('landmark');
        expect(names).not.toContain('portrait');
    });

    it('returns all tags when search query is empty', () => {
        db.createTag('A');
        db.createTag('B');
        expect(db.searchTags('')).toHaveLength(2);
    });

    it('searchTags falls back to LIKE for FTS-invalid queries', () => {
        db.createTag('landscape');
        db.createTag('portrait');
        // FTS5 chokes on unbalanced quotes — should fall back to LIKE
        const results = db.searchTags('"land');
        const names = results.map(t => t.name);
        expect(names).toContain('landscape');
    });

    it('getTopTags orders by file count descending', () => {
        const t1 = db.createTag('Popular');
        const t2 = db.createTag('Rare');
        db.addTagToFile('/a.jpg', t1.id);
        db.addTagToFile('/b.jpg', t1.id);
        db.addTagToFile('/c.jpg', t1.id);
        db.addTagToFile('/a.jpg', t2.id);

        const top = db.getTopTags(10);
        expect(top[0].name).toBe('Popular');
        expect(top[0].file_count).toBe(3);
        expect(top[1].name).toBe('Rare');
        expect(top[1].file_count).toBe(1);
    });
});

// ── File-Tag associations ─────────────────────────────────────────────

describe('file-tag associations', () => {
    let tagA, tagB;

    beforeEach(() => {
        tagA = db.createTag('TagA');
        tagB = db.createTag('TagB');
    });

    it('adds a tag to a file and retrieves it', () => {
        db.addTagToFile('/a.jpg', tagA.id);
        const tags = db.getTagsForFile('/a.jpg');
        expect(tags).toHaveLength(1);
        expect(tags[0].name).toBe('TagA');
    });

    it('removes a tag from a file', () => {
        db.addTagToFile('/a.jpg', tagA.id);
        db.removeTagFromFile('/a.jpg', tagA.id);
        expect(db.getTagsForFile('/a.jpg')).toHaveLength(0);
    });

    it('retrieves tags for multiple files in one call', () => {
        db.addTagToFile('/a.jpg', tagA.id);
        db.addTagToFile('/b.jpg', tagB.id);
        db.addTagToFile('/b.jpg', tagA.id);

        const result = db.getTagsForFiles(['/a.jpg', '/b.jpg']);
        expect(result['/a.jpg']).toHaveLength(1);
        expect(result['/b.jpg']).toHaveLength(2);
    });

    it('returns empty object for getTagsForFiles with empty array', () => {
        expect(db.getTagsForFiles([])).toEqual({});
    });

    it('bulk tags multiple files', () => {
        db.bulkTagFiles(['/a.jpg', '/b.jpg', '/c.jpg'], tagA.id);
        expect(db.getFilesForTag(tagA.id)).toHaveLength(3);
    });

    it('gets all file paths for a tag', () => {
        db.addTagToFile('/a.jpg', tagA.id);
        db.addTagToFile('/b.jpg', tagA.id);
        const files = db.getFilesForTag(tagA.id);
        expect(files).toContain('/a.jpg');
        expect(files).toContain('/b.jpg');
    });

    it('bulk removes a tag from multiple files', () => {
        db.bulkTagFiles(['/a.jpg', '/b.jpg', '/c.jpg'], tagA.id);
        db.bulkRemoveTagFromFiles(['/a.jpg', '/c.jpg'], tagA.id);
        expect(db.getFilesForTag(tagA.id)).toEqual(['/b.jpg']);
    });

    it('cascades tag deletion to file associations', () => {
        db.addTagToFile('/a.jpg', tagA.id);
        db.deleteTag(tagA.id);
        expect(db.getTagsForFile('/a.jpg')).toHaveLength(0);
    });
});

// ── Boolean tag queries ───────────────────────────────────────────────

describe('queryFilesByTags', () => {
    let t1, t2, t3;

    beforeEach(() => {
        t1 = db.createTag('Red');
        t2 = db.createTag('Blue');
        t3 = db.createTag('Green');
        db.addTagToFile('/a.jpg', t1.id);
        db.addTagToFile('/a.jpg', t2.id);
        db.addTagToFile('/b.jpg', t1.id);
        db.addTagToFile('/c.jpg', t2.id);
        db.addTagToFile('/c.jpg', t3.id);
    });

    it('AND: returns files matching all tags', () => {
        const files = db.queryFilesByTags({ op: 'AND', tagIds: [t1.id, t2.id] });
        expect(files).toEqual(['/a.jpg']);
    });

    it('OR: returns files matching any tag', () => {
        const files = db.queryFilesByTags({ op: 'OR', tagIds: [t1.id, t3.id] });
        expect(files).toContain('/a.jpg');
        expect(files).toContain('/b.jpg');
        expect(files).toContain('/c.jpg');
    });

    it('NOT: returns files NOT matching the given tags', () => {
        const files = db.queryFilesByTags({ op: 'NOT', tagIds: [t1.id] });
        // /a.jpg and /b.jpg have t1, so only /c.jpg remains
        expect(files).toEqual(['/c.jpg']);
    });

    it('returns empty array for null expression', () => {
        expect(db.queryFilesByTags(null)).toEqual([]);
    });

    it('returns empty array for expression without op', () => {
        expect(db.queryFilesByTags({})).toEqual([]);
    });

    it('handles compound AND with children', () => {
        const files = db.queryFilesByTags({
            op: 'AND',
            children: [
                { op: 'OR', tagIds: [t1.id] },
                { op: 'OR', tagIds: [t2.id] },
            ],
        });
        expect(files).toEqual(['/a.jpg']);
    });

    it('handles compound OR with children', () => {
        const files = db.queryFilesByTags({
            op: 'OR',
            children: [
                { op: 'OR', tagIds: [t1.id] },
                { op: 'OR', tagIds: [t3.id] },
            ],
        });
        expect(files).toContain('/a.jpg');
        expect(files).toContain('/b.jpg');
        expect(files).toContain('/c.jpg');
    });

    it('handles compound NOT (EXCEPT) with children', () => {
        // All files with t1 EXCEPT those with t2
        const files = db.queryFilesByTags({
            op: 'NOT',
            children: [
                { op: 'OR', tagIds: [t1.id] },
                { op: 'OR', tagIds: [t2.id] },
            ],
        });
        // /a.jpg has t1 AND t2, /b.jpg has only t1 → b.jpg survives EXCEPT
        expect(files).toEqual(['/b.jpg']);
    });

    it('returns empty for unknown compound op', () => {
        const files = db.queryFilesByTags({
            op: 'XOR',
            children: [
                { op: 'OR', tagIds: [t1.id] },
                { op: 'OR', tagIds: [t2.id] },
            ],
        });
        expect(files).toEqual([]);
    });

    it('returns single child result when compound has one valid child', () => {
        const files = db.queryFilesByTags({
            op: 'AND',
            children: [
                { op: 'OR', tagIds: [t1.id] },
            ],
        });
        expect(files).toContain('/a.jpg');
        expect(files).toContain('/b.jpg');
    });

    it('filters out null children in compound expression', () => {
        const files = db.queryFilesByTags({
            op: 'AND',
            children: [
                { op: 'OR', tagIds: [t1.id] },
                { op: 'AND' }, // no tagIds or children → returns null
            ],
        });
        // Only one valid child, so returns its result
        expect(files).toContain('/a.jpg');
    });
});

// ── Tag suggestions ───────────────────────────────────────────────────

describe('suggestTagsForFile', () => {
    it('returns empty when no tags exist', () => {
        expect(db.suggestTagsForFile('/photos/nature/sunset.jpg')).toEqual([]);
    });

    it('suggests tags matching folder name tokens', () => {
        db.createTag('nature');
        const suggestions = db.suggestTagsForFile('/photos/nature/sunset.jpg');
        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions[0].tag.name).toBe('nature');
        expect(suggestions[0].source).toBe('folder');
    });

    it('suggests tags based on sibling co-occurrence', () => {
        const tag = db.createTag('landscape');
        // Tag a sibling file in the same folder
        db.addTagToFile('/photos/mountains/peak.jpg', tag.id);

        const suggestions = db.suggestTagsForFile('/photos/mountains/valley.jpg');
        const siblingMatch = suggestions.find(s => s.source === 'sibling');
        expect(siblingMatch).toBeDefined();
        expect(siblingMatch.tag.name).toBe('landscape');
    });

    it('suggests tags based on file extension', () => {
        db.createTag('video');
        const suggestions = db.suggestTagsForFile('/media/clip.mp4');
        const extMatch = suggestions.find(s => s.source === 'extension');
        expect(extMatch).toBeDefined();
        expect(extMatch.tag.name).toBe('video');
    });

    it('sorts suggestions by confidence descending', () => {
        db.createTag('nature'); // will match folder name with high confidence
        db.createTag('image'); // will match extension with lower confidence
        const suggestions = db.suggestTagsForFile('/nature/photo.jpg');
        if (suggestions.length >= 2) {
            expect(suggestions[0].confidence).toBeGreaterThanOrEqual(suggestions[1].confidence);
        }
    });
});

// ── Saved searches ────────────────────────────────────────────────────

describe('saved searches', () => {
    it('returns empty list initially', () => {
        expect(db.getAllSavedSearches()).toEqual([]);
    });

    it('saves and retrieves a search', () => {
        const id = db.saveSearch({ name: 'Test', query: 'cat', createdAt: 1000 });
        expect(typeof id).toBe('string');
        const all = db.getAllSavedSearches();
        expect(all).toHaveLength(1);
        expect(all[0].name).toBe('Test');
        expect(all[0].query).toBe('cat');
    });

    it('saves search with filters and folderPath', () => {
        db.saveSearch({
            name: 'Filtered',
            query: '',
            filters: { rating: 5, type: 'image' },
            folderPath: '/photos',
            createdAt: 1000,
        });
        const all = db.getAllSavedSearches();
        expect(all[0].filters).toEqual({ rating: 5, type: 'image' });
        expect(all[0].folderPath).toBe('/photos');
    });

    it('sorts by most recently used', () => {
        const id1 = db.saveSearch({ name: 'Old', query: 'a', createdAt: 1000 });
        const id2 = db.saveSearch({ name: 'New', query: 'b', createdAt: 2000, usedAt: 5000 });
        const id3 = db.saveSearch({ name: 'Mid', query: 'c', createdAt: 3000, usedAt: 4000 });

        const all = db.getAllSavedSearches();
        expect(all.map(s => s.name)).toEqual(['New', 'Mid', 'Old']);
    });

    it('deletes a saved search', () => {
        const id = db.saveSearch({ name: 'X', query: 'y', createdAt: 1000 });
        db.deleteSavedSearch(id);
        expect(db.getAllSavedSearches()).toEqual([]);
    });

    it('renames a saved search', () => {
        const id = db.saveSearch({ name: 'Old Name', query: 'q', createdAt: 1000 });
        db.renameSavedSearch(id, 'New Name');
        expect(db.getAllSavedSearches()[0].name).toBe('New Name');
    });

    it('touchSavedSearch updates used_at', () => {
        const id = db.saveSearch({ name: 'S', query: 'q', createdAt: 1000 });
        const before = db.getAllSavedSearches()[0].usedAt;
        db.touchSavedSearch(id);
        const after = db.getAllSavedSearches()[0].usedAt;
        expect(after).toBeGreaterThan(before ?? 0);
    });

    it('truncates name to 200 chars and defaults to Untitled', () => {
        const id1 = db.saveSearch({ name: '', query: 'q', createdAt: 1000 });
        const id2 = db.saveSearch({ name: 'A'.repeat(300), query: 'q', createdAt: 2000 });
        const all = db.getAllSavedSearches();
        const byName = Object.fromEntries(all.map(s => [s.id, s.name]));
        expect(byName[id1]).toBe('Untitled');
        expect(byName[id2]).toHaveLength(200);
    });

    it('renameSavedSearch ignores empty name', () => {
        const id = db.saveSearch({ name: 'Original', query: 'q', createdAt: 1000 });
        db.renameSavedSearch(id, '');
        expect(db.getAllSavedSearches()[0].name).toBe('Original');
    });

    it('renameSavedSearch ignores whitespace-only name', () => {
        const id = db.saveSearch({ name: 'Original', query: 'q', createdAt: 1000 });
        db.renameSavedSearch(id, '   ');
        expect(db.getAllSavedSearches()[0].name).toBe('Original');
    });
});

// ── File hashes ───────────────────────────────────────────────────────

describe('file hashes', () => {
    it('saves and retrieves hashes for paths', () => {
        db.saveHashes([
            { file_path: '/a.jpg', file_size: 1024, file_mtime: 1000.5, exact_hash: 'abc', perceptual_hash: 'def' },
            { file_path: '/b.jpg', file_size: 2048, file_mtime: 2000.5, exact_hash: 'ghi', perceptual_hash: null },
        ]);
        const map = db.getHashesForPaths(['/a.jpg', '/b.jpg']);
        expect(map['/a.jpg'].exact_hash).toBe('abc');
        expect(map['/a.jpg'].perceptual_hash).toBe('def');
        expect(map['/b.jpg'].exact_hash).toBe('ghi');
        expect(map['/b.jpg'].perceptual_hash).toBeNull();
    });

    it('deletes a hash by path', () => {
        db.saveHashes([
            { file_path: '/a.jpg', file_size: 1024, file_mtime: 1000, exact_hash: 'abc' },
        ]);
        db.deleteHash('/a.jpg');
        expect(db.getHashesForPaths(['/a.jpg'])).toEqual({});
    });

    it('upserts on conflict (same path)', () => {
        db.saveHashes([
            { file_path: '/a.jpg', file_size: 1024, file_mtime: 1000, exact_hash: 'old' },
        ]);
        db.saveHashes([
            { file_path: '/a.jpg', file_size: 2048, file_mtime: 2000, exact_hash: 'new' },
        ]);
        const map = db.getHashesForPaths(['/a.jpg']);
        expect(map['/a.jpg'].exact_hash).toBe('new');
        expect(map['/a.jpg'].file_size).toBe(2048);
    });
});

// ── File path migration ───────────────────────────────────────────────

describe('updateFilePaths', () => {
    it('migrates ratings, pins, tags, and hashes to new paths', () => {
        // Set up data under old path
        db.setRating('/old/a.jpg', 5);
        db.setPinned('/old/a.jpg', true);
        const tag = db.createTag('Test');
        db.addTagToFile('/old/a.jpg', tag.id);
        db.saveHashes([
            { file_path: '/old/a.jpg', file_size: 100, file_mtime: 1000, exact_hash: 'h1' },
        ]);

        // Migrate
        db.updateFilePaths([{ oldPath: '/old/a.jpg', newPath: '/new/a.jpg' }]);

        // Old path should be empty
        expect(db.getAllRatings()['/old/a.jpg']).toBeUndefined();
        expect(db.getAllPinned()['/old/a.jpg']).toBeUndefined();
        expect(db.getTagsForFile('/old/a.jpg')).toHaveLength(0);
        expect(db.getHashesForPaths(['/old/a.jpg'])).toEqual({});

        // New path should have the data
        expect(db.getAllRatings()['/new/a.jpg']).toBe(5);
        expect(db.getAllPinned()['/new/a.jpg']).toBe(true);
        expect(db.getTagsForFile('/new/a.jpg')).toHaveLength(1);
        expect(db.getHashesForPaths(['/new/a.jpg'])['/new/a.jpg'].exact_hash).toBe('h1');
    });

    it('migrates collection files to new paths', () => {
        db.saveCollection({ id: 'c1', name: 'Test' });
        db.addFilesToCollection('c1', ['/old/a.jpg']);

        db.updateFilePaths([{ oldPath: '/old/a.jpg', newPath: '/new/a.jpg' }]);

        const files = db.getCollectionFiles('c1');
        expect(files).toHaveLength(1);
        expect(files[0].filePath).toBe('/new/a.jpg');
    });

    it('normalizes backslashes to forward slashes during migration', () => {
        db.setRating('/old/a.jpg', 3);

        db.updateFilePaths([{ oldPath: '\\old\\a.jpg', newPath: '\\new\\a.jpg' }]);

        // Both paths should have been normalized to forward slashes
        expect(db.getAllRatings()['/new/a.jpg']).toBe(3);
    });
});

// ── Migration ─────────────────────────────────────────────────────────

describe('runMigration', () => {
    it('migrates ratings, pins, and favorites in one transaction', () => {
        db.runMigration({
            fileRatings: { '/a.jpg': 5, '/b.jpg': 3 },
            pinnedFiles: { '/a.jpg': true },
            favorites: {
                groups: [{ id: 'g1', name: 'Fav', collapsed: false, items: [{ path: '/a.jpg' }] }],
            },
        });

        expect(db.getAllRatings()).toEqual({ '/a.jpg': 5, '/b.jpg': 3 });
        expect(db.getAllPinned()).toEqual({ '/a.jpg': true });
        expect(db.getFavorites().groups).toHaveLength(1);
        expect(db.checkMigrationStatus().migrationComplete).toBe(true);
    });

    it('migrates recent files', () => {
        db.runMigration({
            recentFiles: [
                { path: '/a.jpg', addedAt: 1000 },
                { path: '/b.jpg', addedAt: 2000 },
            ],
        });
        const recent = db.getRecentFiles();
        expect(recent).toHaveLength(2);
        expect(recent[0].path).toBe('/b.jpg'); // most recent first
    });

    it('migrates collections with files', () => {
        db.runMigration({
            collections: [
                {
                    id: 'c1',
                    name: 'My Collection',
                    type: 'manual',
                    sortOrder: 0,
                    createdAt: 1000,
                    updatedAt: 2000,
                    files: [
                        { id: 'cf1', filePath: '/a.jpg', addedAt: 1000, sortOrder: 0 },
                        { id: 'cf2', file_path: '/b.jpg', added_at: 2000, sort_order: 1 },
                    ],
                },
            ],
        });
        const collections = db.getAllCollections();
        expect(collections).toHaveLength(1);
        expect(collections[0].name).toBe('My Collection');
        const files = db.getCollectionFiles('c1');
        expect(files).toHaveLength(2);
    });

    it('handles empty migration data', () => {
        db.runMigration({});
        expect(db.checkMigrationStatus().migrationComplete).toBe(true);
    });
});

// ── Tag import/export ─────────────────────────────────────────────────

describe('exportTags / importTags', () => {
    it('round-trips tag export and import', () => {
        const t1 = db.createTag('Alpha', 'desc', '#f00');
        db.addTagToFile('/a.jpg', t1.id);

        const exported = db.exportTags();
        expect(exported.tags).toHaveLength(1);
        expect(exported.fileTags).toHaveLength(1);

        // Import into same DB (clears and re-inserts)
        db.importTags(exported);
        expect(db.getAllTags()).toHaveLength(1);
        expect(db.getTagsForFile('/a.jpg')).toHaveLength(1);
    });
});
