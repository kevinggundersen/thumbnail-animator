'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const SCHEMA_VERSION = 4;

class AppDatabase {
    constructor(dbPath) {
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('synchronous = NORMAL');
        this.db.pragma('cache_size = -64000');
        this.db.pragma('mmap_size = 268435456');
        this.db.pragma('journal_size_limit = 67108864');
        this._ensureSchema();
        this._prepareStatements();
    }

    // ── Schema ───────────────────────────────────────────────────────────

    _ensureSchema() {
        const currentVersion = this._getSchemaVersion();

        if (currentVersion < 1) {
            this.db.exec(`
                -- Schema versioning
                CREATE TABLE IF NOT EXISTS meta (
                    key   TEXT PRIMARY KEY,
                    value TEXT
                );

                -- File ratings (migrated from localStorage)
                CREATE TABLE IF NOT EXISTS file_ratings (
                    file_path TEXT PRIMARY KEY,
                    rating    INTEGER NOT NULL CHECK(rating BETWEEN 0 AND 5)
                );

                -- Pinned files (migrated from localStorage)
                CREATE TABLE IF NOT EXISTS pinned_files (
                    file_path TEXT PRIMARY KEY
                );

                -- Favorite groups (migrated from localStorage favorites v2)
                CREATE TABLE IF NOT EXISTS favorite_groups (
                    id         TEXT PRIMARY KEY,
                    name       TEXT NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    collapsed  INTEGER NOT NULL DEFAULT 0
                );

                -- Favorite items within groups
                CREATE TABLE IF NOT EXISTS favorite_items (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    group_id   TEXT NOT NULL REFERENCES favorite_groups(id) ON DELETE CASCADE,
                    path       TEXT NOT NULL,
                    added_at   INTEGER,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(group_id, path)
                );
                CREATE INDEX IF NOT EXISTS idx_favorite_items_gid ON favorite_items(group_id);

                -- Recent files (migrated from localStorage)
                CREATE TABLE IF NOT EXISTS recent_files (
                    id        INTEGER PRIMARY KEY AUTOINCREMENT,
                    path      TEXT NOT NULL UNIQUE,
                    timestamp INTEGER NOT NULL
                );

                -- Collections (migrated from IndexedDB)
                CREATE TABLE IF NOT EXISTS collections (
                    id         TEXT PRIMARY KEY,
                    name       TEXT NOT NULL,
                    type       TEXT NOT NULL DEFAULT 'manual',
                    rules      TEXT,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    color      TEXT,
                    icon       TEXT,
                    created_at INTEGER,
                    updated_at INTEGER
                );

                -- Collection files (migrated from IndexedDB)
                CREATE TABLE IF NOT EXISTS collection_files (
                    id            TEXT PRIMARY KEY,
                    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
                    file_path     TEXT NOT NULL,
                    added_at      INTEGER,
                    sort_order    INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(collection_id, file_path)
                );
                CREATE INDEX IF NOT EXISTS idx_collection_files_cid ON collection_files(collection_id);

                -- Tags
                CREATE TABLE IF NOT EXISTS tags (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    description TEXT,
                    color       TEXT,
                    created_at  INTEGER NOT NULL
                );

                -- File-tag associations
                CREATE TABLE IF NOT EXISTS file_tags (
                    file_path TEXT NOT NULL,
                    tag_id    INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                    added_at  INTEGER NOT NULL,
                    PRIMARY KEY (file_path, tag_id)
                );
                CREATE INDEX IF NOT EXISTS idx_file_tags_tag  ON file_tags(tag_id);
                CREATE INDEX IF NOT EXISTS idx_file_tags_path ON file_tags(file_path);

                -- FTS5 for tag search
                CREATE VIRTUAL TABLE IF NOT EXISTS tags_fts USING fts5(
                    name, description, content=tags, content_rowid=id
                );

                -- Triggers to keep FTS in sync
                CREATE TRIGGER IF NOT EXISTS tags_ai AFTER INSERT ON tags BEGIN
                    INSERT INTO tags_fts(rowid, name, description) VALUES (new.id, new.name, new.description);
                END;
                CREATE TRIGGER IF NOT EXISTS tags_ad AFTER DELETE ON tags BEGIN
                    INSERT INTO tags_fts(tags_fts, rowid, name, description) VALUES ('delete', old.id, old.name, old.description);
                END;
                CREATE TRIGGER IF NOT EXISTS tags_au AFTER UPDATE ON tags BEGIN
                    INSERT INTO tags_fts(tags_fts, rowid, name, description) VALUES ('delete', old.id, old.name, old.description);
                    INSERT INTO tags_fts(rowid, name, description) VALUES (new.id, new.name, new.description);
                END;
            `);
            this._setSchemaVersion(1);
        }

        if (currentVersion < 2) {
            this.db.exec(`
                -- Saved searches (query + filters, optionally scoped to a folder)
                CREATE TABLE IF NOT EXISTS saved_searches (
                    id           TEXT PRIMARY KEY,
                    name         TEXT NOT NULL,
                    query        TEXT NOT NULL DEFAULT '',
                    filters_json TEXT,
                    folder_path  TEXT,
                    created_at   INTEGER NOT NULL,
                    used_at      INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_saved_searches_used_at ON saved_searches(used_at);
            `);
            this._setSchemaVersion(2);
        }

        if (currentVersion < 3) {
            this.db.exec(`
                -- Cached file hashes for duplicate detection
                CREATE TABLE IF NOT EXISTS file_hashes (
                    file_path       TEXT PRIMARY KEY,
                    file_size       INTEGER NOT NULL,
                    file_mtime      REAL    NOT NULL,
                    exact_hash      TEXT,
                    perceptual_hash TEXT,
                    computed_at     INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_file_hashes_mtime ON file_hashes(file_mtime);
            `);
            this._setSchemaVersion(3);
        }

        if (currentVersion < 4) {
            this.db.exec(`
                -- Hash-keyed shared ratings (linked duplicates overlay)
                CREATE TABLE IF NOT EXISTS hash_ratings (
                    exact_hash TEXT PRIMARY KEY,
                    rating     INTEGER NOT NULL CHECK(rating BETWEEN 0 AND 5)
                );
                -- Hash-keyed shared pins (linked duplicates overlay)
                CREATE TABLE IF NOT EXISTS hash_pins (
                    exact_hash TEXT PRIMARY KEY
                );
                -- Hash-keyed shared tags (linked duplicates overlay)
                CREATE TABLE IF NOT EXISTS hash_tags (
                    exact_hash TEXT NOT NULL,
                    tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                    added_at   INTEGER NOT NULL,
                    PRIMARY KEY (exact_hash, tag_id)
                );
                -- Index for reverse lookup: hash → file paths
                CREATE INDEX IF NOT EXISTS idx_file_hashes_exact ON file_hashes(exact_hash);
            `);
            this._setSchemaVersion(4);
        }
    }

    _getSchemaVersion() {
        try {
            const row = this.db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
            return row ? parseInt(row.value, 10) : 0;
        } catch {
            return 0; // meta table doesn't exist yet
        }
    }

    _setSchemaVersion(v) {
        this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(String(v));
    }

    // ── Prepared statements ──────────────────────────────────────────────

    _prepareStatements() {
        // Meta
        this._stmts = {};
        this._stmts.getMeta = this.db.prepare('SELECT value FROM meta WHERE key = ?');
        this._stmts.setMeta = this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');

        // Ratings
        this._stmts.getRating = this.db.prepare('SELECT rating FROM file_ratings WHERE file_path = ?');
        this._stmts.setRating = this.db.prepare('INSERT OR REPLACE INTO file_ratings (file_path, rating) VALUES (?, ?)');
        this._stmts.deleteRating = this.db.prepare('DELETE FROM file_ratings WHERE file_path = ?');
        this._stmts.getAllRatings = this.db.prepare('SELECT file_path, rating FROM file_ratings');

        // Pins
        this._stmts.isPinned = this.db.prepare('SELECT 1 FROM pinned_files WHERE file_path = ?');
        this._stmts.addPin = this.db.prepare('INSERT OR IGNORE INTO pinned_files (file_path) VALUES (?)');
        this._stmts.removePin = this.db.prepare('DELETE FROM pinned_files WHERE file_path = ?');
        this._stmts.getAllPinned = this.db.prepare('SELECT file_path FROM pinned_files');

        // Favorite groups
        this._stmts.getAllFavoriteGroups = this.db.prepare('SELECT * FROM favorite_groups ORDER BY sort_order');
        this._stmts.insertFavoriteGroup = this.db.prepare('INSERT INTO favorite_groups (id, name, sort_order, collapsed) VALUES (?, ?, ?, ?)');
        this._stmts.deleteFavoriteGroups = this.db.prepare('DELETE FROM favorite_groups');

        // Favorite items
        this._stmts.getFavoriteItems = this.db.prepare('SELECT * FROM favorite_items WHERE group_id = ? ORDER BY sort_order');
        this._stmts.insertFavoriteItem = this.db.prepare('INSERT INTO favorite_items (group_id, path, added_at, sort_order) VALUES (?, ?, ?, ?)');
        this._stmts.deleteFavoriteItems = this.db.prepare('DELETE FROM favorite_items');

        // Favorites: single JOIN query (replaces N+1 pattern)
        this._stmts.getAllFavoritesJoined = this.db.prepare(
            `SELECT g.id AS group_id, g.name, g.collapsed, g.sort_order,
                    fi.path, fi.added_at, fi.sort_order AS item_order
             FROM favorite_groups g
             LEFT JOIN favorite_items fi ON fi.group_id = g.id
             ORDER BY g.sort_order, fi.sort_order`
        );

        // Recent files
        this._stmts.getRecentFiles = this.db.prepare('SELECT path, timestamp FROM recent_files ORDER BY timestamp DESC LIMIT ?');
        this._stmts.upsertRecentFile = this.db.prepare('INSERT OR REPLACE INTO recent_files (path, timestamp) VALUES (?, ?)');
        this._stmts.trimRecentFiles = this.db.prepare('DELETE FROM recent_files WHERE id NOT IN (SELECT id FROM recent_files ORDER BY timestamp DESC LIMIT ?)');
        this._stmts.clearRecentFiles = this.db.prepare('DELETE FROM recent_files');
        this._stmts.removeRecentFile = this.db.prepare('DELETE FROM recent_files WHERE path = ?');

        // Collections
        this._stmts.getAllCollections = this.db.prepare('SELECT * FROM collections ORDER BY sort_order');
        this._stmts.getCollection = this.db.prepare('SELECT * FROM collections WHERE id = ?');
        this._stmts.upsertCollection = this.db.prepare(`
            INSERT INTO collections (id, name, type, rules, sort_order, color, icon, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                type = excluded.type,
                rules = excluded.rules,
                sort_order = excluded.sort_order,
                color = excluded.color,
                icon = excluded.icon,
                updated_at = excluded.updated_at
        `);
        this._stmts.deleteCollection = this.db.prepare('DELETE FROM collections WHERE id = ?');

        // Collection files
        this._stmts.getCollectionFiles = this.db.prepare('SELECT * FROM collection_files WHERE collection_id = ? ORDER BY sort_order');
        this._stmts.insertCollectionFile = this.db.prepare(`
            INSERT OR IGNORE INTO collection_files (id, collection_id, file_path, added_at, sort_order)
            VALUES (?, ?, ?, ?, ?)
        `);
        this._stmts.removeCollectionFile = this.db.prepare('DELETE FROM collection_files WHERE collection_id = ? AND file_path = ?');
        this._stmts.removeCollectionFiles = this.db.prepare('DELETE FROM collection_files WHERE collection_id = ? AND file_path IN (SELECT value FROM json_each(?))');

        // Tags
        this._stmts.createTag = this.db.prepare('INSERT INTO tags (name, description, color, created_at) VALUES (?, ?, ?, ?)');
        this._stmts.updateTagName = this.db.prepare('UPDATE tags SET name = ? WHERE id = ?');
        this._stmts.updateTagDesc = this.db.prepare('UPDATE tags SET description = ? WHERE id = ?');
        this._stmts.updateTagColor = this.db.prepare('UPDATE tags SET color = ? WHERE id = ?');
        this._stmts.deleteTag = this.db.prepare('DELETE FROM tags WHERE id = ?');
        this._stmts.getTag = this.db.prepare('SELECT * FROM tags WHERE id = ?');
        this._stmts.getTagByName = this.db.prepare('SELECT * FROM tags WHERE name = ? COLLATE NOCASE');
        this._stmts.getAllTags = this.db.prepare('SELECT * FROM tags ORDER BY name COLLATE NOCASE');
        this._stmts.getTopTags = this.db.prepare(`
            SELECT t.*, COUNT(ft.file_path) AS file_count
            FROM tags t LEFT JOIN file_tags ft ON ft.tag_id = t.id
            GROUP BY t.id ORDER BY file_count DESC LIMIT ?
        `);

        // File tags
        this._stmts.addTagToFile = this.db.prepare('INSERT OR IGNORE INTO file_tags (file_path, tag_id, added_at) VALUES (?, ?, ?)');
        this._stmts.removeTagFromFile = this.db.prepare('DELETE FROM file_tags WHERE file_path = ? AND tag_id = ?');
        this._stmts.getTagsForFile = this.db.prepare(`
            SELECT t.* FROM tags t
            JOIN file_tags ft ON ft.tag_id = t.id
            WHERE ft.file_path = ?
            ORDER BY t.name COLLATE NOCASE
        `);
        this._stmts.getFilesForTag = this.db.prepare('SELECT file_path FROM file_tags WHERE tag_id = ?');
        this._stmts.removeAllTagsForFile = this.db.prepare('DELETE FROM file_tags WHERE file_path = ?');

        // Bulk path migration (used by updateFilePaths for batch rename)
        this._stmts.updateRatingPath = this.db.prepare('UPDATE file_ratings SET file_path = ? WHERE file_path = ?');
        this._stmts.updatePinPath = this.db.prepare('UPDATE pinned_files SET file_path = ? WHERE file_path = ?');
        this._stmts.updateFileTagsPath = this.db.prepare('UPDATE file_tags SET file_path = ? WHERE file_path = ?');
        this._stmts.updateCollectionFilesPath = this.db.prepare('UPDATE collection_files SET file_path = ? WHERE file_path = ?');
        this._stmts.updateFileHashesPath = this.db.prepare('UPDATE file_hashes SET file_path = ? WHERE file_path = ?');
        this._stmts.getFileCountForTag = this.db.prepare('SELECT COUNT(*) AS count FROM file_tags WHERE tag_id = ?');

        // Auto-suggest: sibling co-occurrence
        this._stmts.siblingTags = this.db.prepare(`
            SELECT t.id, t.name, t.color, COUNT(*) AS occurrences
            FROM file_tags ft
            JOIN tags t ON t.id = ft.tag_id
            WHERE ft.file_path LIKE ? AND ft.file_path != ?
            GROUP BY t.id
            ORDER BY occurrences DESC
            LIMIT 10
        `);

        // File hashes
        this._stmts.getHashesByPaths = this.db.prepare(
            'SELECT file_path, file_size, file_mtime, exact_hash, perceptual_hash FROM file_hashes WHERE file_path IN (SELECT value FROM json_each(?))'
        );
        this._stmts.upsertHash = this.db.prepare(
            'INSERT OR REPLACE INTO file_hashes (file_path, file_size, file_mtime, exact_hash, perceptual_hash, computed_at) VALUES (?, ?, ?, ?, ?, ?)'
        );
        this._stmts.deleteHashByPath = this.db.prepare('DELETE FROM file_hashes WHERE file_path = ?');

        // Hash-keyed shared metadata (linked duplicates)
        this._stmts.getHashRating = this.db.prepare('SELECT rating FROM hash_ratings WHERE exact_hash = ?');
        this._stmts.setHashRating = this.db.prepare('INSERT OR REPLACE INTO hash_ratings (exact_hash, rating) VALUES (?, ?)');
        this._stmts.deleteHashRating = this.db.prepare('DELETE FROM hash_ratings WHERE exact_hash = ?');
        this._stmts.getAllHashRatings = this.db.prepare('SELECT exact_hash, rating FROM hash_ratings');

        this._stmts.isHashPinned = this.db.prepare('SELECT 1 FROM hash_pins WHERE exact_hash = ?');
        this._stmts.addHashPin = this.db.prepare('INSERT OR IGNORE INTO hash_pins (exact_hash) VALUES (?)');
        this._stmts.removeHashPin = this.db.prepare('DELETE FROM hash_pins WHERE exact_hash = ?');
        this._stmts.getAllHashPins = this.db.prepare('SELECT exact_hash FROM hash_pins');

        this._stmts.addHashTag = this.db.prepare('INSERT OR IGNORE INTO hash_tags (exact_hash, tag_id, added_at) VALUES (?, ?, ?)');
        this._stmts.removeHashTag = this.db.prepare('DELETE FROM hash_tags WHERE exact_hash = ? AND tag_id = ?');
        this._stmts.getHashTags = this.db.prepare(`
            SELECT t.* FROM tags t
            JOIN hash_tags ht ON ht.tag_id = t.id
            WHERE ht.exact_hash = ?
            ORDER BY t.name COLLATE NOCASE
        `);
        this._stmts.getTagsForHashes = this.db.prepare(`
            SELECT ht.exact_hash, t.id, t.name, t.color
            FROM hash_tags ht JOIN tags t ON t.id = ht.tag_id
            ORDER BY t.name COLLATE NOCASE
        `);

        // Reverse lookup: hash → file paths
        this._stmts.getPathsByHash = this.db.prepare('SELECT file_path FROM file_hashes WHERE exact_hash = ?');
        // Duplicate hash groups (2+ files sharing exact_hash)
        this._stmts.getDuplicateHashGroups = this.db.prepare(`
            SELECT exact_hash, file_path FROM file_hashes
            WHERE exact_hash IS NOT NULL AND exact_hash IN (
                SELECT exact_hash FROM file_hashes WHERE exact_hash IS NOT NULL
                GROUP BY exact_hash HAVING COUNT(*) >= 2
            )
            ORDER BY exact_hash
        `);
        // Bulk hash lookup for a set of paths
        this._stmts.getHashesForPathsBulk = this.db.prepare(
            'SELECT file_path, exact_hash FROM file_hashes WHERE exact_hash IS NOT NULL AND file_path IN (SELECT value FROM json_each(?))'
        );
    }

    // ── Meta ─────────────────────────────────────────────────────────────

    getMeta(key) {
        const row = this._stmts.getMeta.get(key);
        return row ? row.value : null;
    }

    setMeta(key, value) {
        this._stmts.setMeta.run(key, String(value));
    }

    // ── Ratings ──────────────────────────────────────────────────────────

    getAllRatings() {
        const rows = this._stmts.getAllRatings.all();
        const result = {};
        for (const row of rows) {
            result[row.file_path] = row.rating;
        }
        return result;
    }

    setRating(filePath, rating) {
        if (rating === 0) {
            this._stmts.deleteRating.run(filePath);
        } else {
            this._stmts.setRating.run(filePath, rating);
        }
    }

    bulkSetRatings(ratingsObj) {
        const tx = this.db.transaction((obj) => {
            for (const [filePath, rating] of Object.entries(obj)) {
                if (rating > 0) {
                    this._stmts.setRating.run(filePath, rating);
                }
            }
        });
        tx(ratingsObj);
    }

    // ── Pins ─────────────────────────────────────────────────────────────

    getAllPinned() {
        const rows = this._stmts.getAllPinned.all();
        const result = {};
        for (const row of rows) {
            result[row.file_path] = true;
        }
        return result;
    }

    setPinned(filePath, pinned) {
        if (pinned) {
            this._stmts.addPin.run(filePath);
        } else {
            this._stmts.removePin.run(filePath);
        }
    }

    bulkSetPinned(pinnedObj) {
        const tx = this.db.transaction((obj) => {
            for (const filePath of Object.keys(obj)) {
                this._stmts.addPin.run(filePath);
            }
        });
        tx(pinnedObj);
    }

    // ── Favorites ────────────────────────────────────────────────────────

    getFavorites() {
        // Single JOIN query instead of N+1 (one query per group)
        const rows = this._stmts.getAllFavoritesJoined.all();
        const groupMap = new Map(); // preserve insertion order
        const groupList = [];
        for (const row of rows) {
            let group = groupMap.get(row.group_id);
            if (!group) {
                group = {
                    id: row.group_id,
                    name: row.name,
                    collapsed: !!row.collapsed,
                    items: []
                };
                groupMap.set(row.group_id, group);
                groupList.push(group);
            }
            if (row.path) { // LEFT JOIN may produce null path for empty groups
                group.items.push({ path: row.path, addedAt: row.added_at });
            }
        }
        return { version: 2, groups: groupList };
    }

    saveFavorites(favObj) {
        const tx = this.db.transaction((fav) => {
            this._stmts.deleteFavoriteItems.run();
            this._stmts.deleteFavoriteGroups.run();
            if (fav && fav.groups) {
                for (let gi = 0; gi < fav.groups.length; gi++) {
                    const g = fav.groups[gi];
                    this._stmts.insertFavoriteGroup.run(g.id, g.name, gi, g.collapsed ? 1 : 0);
                    if (g.items) {
                        for (let ii = 0; ii < g.items.length; ii++) {
                            const item = g.items[ii];
                            this._stmts.insertFavoriteItem.run(g.id, item.path, item.addedAt || null, ii);
                        }
                    }
                }
            }
        });
        tx(favObj);
    }

    // ── Recent files ─────────────────────────────────────────────────────

    getRecentFiles(limit = 50) {
        return this._stmts.getRecentFiles.all(limit).map(r => ({
            path: r.path,
            addedAt: r.timestamp
        }));
    }

    addRecentFile(entry, limit = 50) {
        this._stmts.upsertRecentFile.run(entry.path, entry.addedAt || Date.now());
        this._stmts.trimRecentFiles.run(limit);
    }

    clearRecentFiles() {
        this._stmts.clearRecentFiles.run();
    }

    removeRecentFile(path) {
        this._stmts.removeRecentFile.run(path);
    }

    // ── Collections ──────────────────────────────────────────────────────

    getAllCollections() {
        return this._stmts.getAllCollections.all().map(c => ({
            ...c,
            rules: c.rules ? JSON.parse(c.rules) : undefined
        }));
    }

    getCollection(id) {
        const c = this._stmts.getCollection.get(id);
        if (!c) return null;
        return { ...c, rules: c.rules ? JSON.parse(c.rules) : undefined };
    }

    saveCollection(col) {
        this._stmts.upsertCollection.run(
            col.id,
            col.name,
            col.type || 'manual',
            col.rules ? JSON.stringify(col.rules) : null,
            col.sortOrder ?? col.sort_order ?? 0,
            col.color || null,
            col.icon || null,
            col.createdAt ?? col.created_at ?? Date.now(),
            col.updatedAt ?? col.updated_at ?? Date.now()
        );
        return col.id;
    }

    deleteCollection(id) {
        this._stmts.deleteCollection.run(id);
    }

    getCollectionFiles(collectionId) {
        return this._stmts.getCollectionFiles.all(collectionId).map(f => ({
            id: f.id,
            collectionId: f.collection_id,
            filePath: f.file_path,
            addedAt: f.added_at,
            sortOrder: f.sort_order
        }));
    }

    addFilesToCollection(collectionId, filePaths) {
        let added = 0;
        const existing = this._stmts.getCollectionFiles.all(collectionId);
        let maxSort = existing.reduce((max, f) => Math.max(max, f.sort_order), -1);
        const existingPaths = new Set(existing.map(f => f.file_path));

        const tx = this.db.transaction((paths) => {
            for (const fp of paths) {
                if (existingPaths.has(fp)) continue;
                maxSort++;
                const id = `cf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                this._stmts.insertCollectionFile.run(id, collectionId, fp, Date.now(), maxSort);
                added++;
            }
        });
        tx(filePaths);
        return added;
    }

    removeFileFromCollection(collectionId, filePath) {
        this._stmts.removeCollectionFile.run(collectionId, filePath);
    }

    removeFilesFromCollection(collectionId, filePaths) {
        this._stmts.removeCollectionFiles.run(collectionId, JSON.stringify(filePaths));
    }

    // ── Tags ─────────────────────────────────────────────────────────────

    createTag(name, description, color) {
        const info = this._stmts.createTag.run(name, description || null, color || null, Date.now());
        return this._stmts.getTag.get(info.lastInsertRowid);
    }

    updateTag(id, updates) {
        if (updates.name !== undefined) this._stmts.updateTagName.run(updates.name, id);
        if (updates.description !== undefined) this._stmts.updateTagDesc.run(updates.description, id);
        if (updates.color !== undefined) this._stmts.updateTagColor.run(updates.color, id);
        return this._stmts.getTag.get(id);
    }

    deleteTag(id) {
        this._stmts.deleteTag.run(id);
    }

    getAllTags() {
        return this._stmts.getAllTags.all();
    }

    getTag(id) {
        return this._stmts.getTag.get(id) || null;
    }

    searchTags(query) {
        if (!query || !query.trim()) return this.getAllTags();
        // FTS5 match with prefix search
        const sanitized = query.trim().replace(/['"]/g, '');
        const ftsQuery = sanitized + '*';
        try {
            const rows = this.db.prepare(`
                SELECT t.* FROM tags t
                JOIN tags_fts fts ON fts.rowid = t.id
                WHERE tags_fts MATCH ?
                ORDER BY rank
            `).all(ftsQuery);
            return rows;
        } catch {
            // Fallback to LIKE if FTS query is malformed
            return this.db.prepare('SELECT * FROM tags WHERE name LIKE ? COLLATE NOCASE ORDER BY name').all(`%${query.trim()}%`);
        }
    }

    getTopTags(limit = 10) {
        return this._stmts.getTopTags.all(limit);
    }

    // ── File-Tag associations ────────────────────────────────────────────

    addTagToFile(filePath, tagId) {
        this._stmts.addTagToFile.run(filePath, tagId, Date.now());
    }

    removeTagFromFile(filePath, tagId) {
        this._stmts.removeTagFromFile.run(filePath, tagId);
    }

    getTagsForFile(filePath) {
        return this._stmts.getTagsForFile.all(filePath);
    }

    getTagsForFiles(filePaths) {
        if (!filePaths.length) return {};
        const placeholders = filePaths.map(() => '?').join(',');
        const rows = this.db.prepare(`
            SELECT ft.file_path, t.id, t.name, t.color
            FROM file_tags ft JOIN tags t ON t.id = ft.tag_id
            WHERE ft.file_path IN (${placeholders})
            ORDER BY t.name COLLATE NOCASE
        `).all(...filePaths);
        const result = {};
        for (const row of rows) {
            (result[row.file_path] ||= []).push({ id: row.id, name: row.name, color: row.color });
        }
        return result;
    }

    getFilesForTag(tagId) {
        return this._stmts.getFilesForTag.all(tagId).map(r => r.file_path);
    }

    bulkTagFiles(filePaths, tagId) {
        const now = Date.now();
        const tx = this.db.transaction((paths) => {
            for (const fp of paths) {
                this._stmts.addTagToFile.run(fp, tagId, now);
            }
        });
        tx(filePaths);
    }

    bulkRemoveTagFromFiles(filePaths, tagId) {
        const tx = this.db.transaction((paths) => {
            for (const fp of paths) {
                this._stmts.removeTagFromFile.run(fp, tagId);
            }
        });
        tx(filePaths);
    }

    // ── Boolean tag query engine ─────────────────────────────────────────

    queryFilesByTags(expression) {
        if (!expression || !expression.op) return [];
        const sql = this._buildTagQuery(expression);
        if (!sql) return [];
        return this.db.prepare(sql.text).all(...sql.params).map(r => r.file_path);
    }

    _buildTagQuery(expr) {
        const op = expr.op.toUpperCase();

        // Leaf nodes with tagIds
        if (expr.tagIds && expr.tagIds.length > 0) {
            const placeholders = expr.tagIds.map(() => '?').join(',');

            if (op === 'AND') {
                return {
                    text: `SELECT file_path FROM file_tags WHERE tag_id IN (${placeholders}) GROUP BY file_path HAVING COUNT(DISTINCT tag_id) = ?`,
                    params: [...expr.tagIds, expr.tagIds.length]
                };
            }
            if (op === 'OR') {
                return {
                    text: `SELECT DISTINCT file_path FROM file_tags WHERE tag_id IN (${placeholders})`,
                    params: [...expr.tagIds]
                };
            }
            if (op === 'NOT') {
                return {
                    text: `SELECT DISTINCT file_path FROM file_tags WHERE file_path NOT IN (SELECT file_path FROM file_tags WHERE tag_id IN (${placeholders}))`,
                    params: [...expr.tagIds]
                };
            }
        }

        // Compound nodes with children
        if (expr.children && expr.children.length > 0) {
            const childQueries = expr.children.map(c => this._buildTagQuery(c)).filter(Boolean);
            if (childQueries.length === 0) return null;
            if (childQueries.length === 1) return childQueries[0];

            let combiner;
            if (op === 'AND') combiner = 'INTERSECT';
            else if (op === 'OR') combiner = 'UNION';
            else if (op === 'NOT') combiner = 'EXCEPT';
            else return null;

            const text = childQueries.map(q => q.text).join(` ${combiner} `);
            const params = childQueries.flatMap(q => q.params);
            return { text, params };
        }

        return null;
    }

    // ── Auto-tag suggestions ─────────────────────────────────────────────

    suggestTagsForFile(filePath) {
        const suggestions = [];
        const seenTagIds = new Set();

        const dirPath = filePath.replace(/\\/g, '/');
        const parts = dirPath.split('/');
        const fileName = parts.pop();
        const folderName = parts.pop() || '';
        const dirPrefix = parts.join('/') + '/' + folderName + '/';

        // 1. Folder name token matching — use SQL LIKE instead of loading all tags + nested loops
        const folderTokens = folderName.toLowerCase().split(/[\s_\-\.]+/).filter(t => t.length > 1);
        if (folderTokens.length > 0) {
            // Build a single query: SELECT ... WHERE lower(name) LIKE '%token1%' OR lower(name) LIKE '%token2%' ...
            // Also check if any token IS the tag name (exact match → higher confidence)
            const likeClauses = folderTokens.map(() => 'lower(name) LIKE ?');
            const likeParams = folderTokens.map(t => `%${t}%`);
            const sql = `SELECT id, name, color FROM tags WHERE ${likeClauses.join(' OR ')}`;
            try {
                const matches = this.db.prepare(sql).all(...likeParams);
                for (const tag of matches) {
                    if (seenTagIds.has(tag.id)) continue;
                    seenTagIds.add(tag.id);
                    const tagLower = tag.name.toLowerCase();
                    const isExact = folderTokens.some(t => t === tagLower);
                    suggestions.push({ tag, source: 'folder', confidence: isExact ? 0.9 : 0.6 });
                }
            } catch {}
        }

        // 2. Sibling co-occurrence (already SQL-based — no change needed)
        const siblingResults = this._stmts.siblingTags.all(dirPrefix + '%', filePath);
        for (const row of siblingResults) {
            if (seenTagIds.has(row.id)) continue;
            seenTagIds.add(row.id);
            suggestions.push({
                tag: { id: row.id, name: row.name, color: row.color },
                source: 'sibling',
                confidence: Math.min(0.8, row.occurrences / 10)
            });
        }

        // 3. File extension/type matching — use SQL instead of loading all tags
        const ext = (fileName || '').split('.').pop().toLowerCase();
        const typeMap = {
            mp4: 'video', avi: 'video', mkv: 'video', mov: 'video', webm: 'video', wmv: 'video',
            jpg: 'image', jpeg: 'image', png: 'image', gif: 'gif', webp: 'image', bmp: 'image', tiff: 'image', svg: 'svg'
        };
        const typeTag = typeMap[ext];
        if (typeTag) {
            try {
                const match = this.db.prepare(
                    'SELECT id, name, color FROM tags WHERE lower(name) = ? OR lower(name) = ? LIMIT 1'
                ).get(typeTag, ext);
                if (match && !seenTagIds.has(match.id)) {
                    seenTagIds.add(match.id);
                    suggestions.push({ tag: match, source: 'extension', confidence: 0.5 });
                }
            } catch {}
        }

        // Sort by confidence descending
        suggestions.sort((a, b) => b.confidence - a.confidence);
        return suggestions.slice(0, 15);
    }

    // ── File hashes (duplicate detection cache) ───────────────────────

    getHashesForPaths(filePaths) {
        const rows = this._stmts.getHashesByPaths.all(JSON.stringify(filePaths));
        const map = {};
        for (const r of rows) {
            map[r.file_path] = {
                exact_hash: r.exact_hash,
                perceptual_hash: r.perceptual_hash,
                file_mtime: r.file_mtime,
                file_size: r.file_size
            };
        }
        return map;
    }

    saveHashes(entries) {
        const tx = this.db.transaction((items) => {
            const now = Date.now();
            for (const e of items) {
                this._stmts.upsertHash.run(
                    e.file_path, e.file_size, e.file_mtime,
                    e.exact_hash || null, e.perceptual_hash || null, now
                );
            }
        });
        tx(entries);
    }

    deleteHash(filePath) {
        this._stmts.deleteHashByPath.run(filePath);
    }

    // ── Hash-keyed shared metadata (linked duplicates) ────────────────

    getAllHashRatings() {
        const rows = this._stmts.getAllHashRatings.all();
        const result = {};
        for (const row of rows) result[row.exact_hash] = row.rating;
        return result;
    }

    setHashRating(hash, rating) {
        if (rating === 0) {
            this._stmts.deleteHashRating.run(hash);
        } else {
            this._stmts.setHashRating.run(hash, rating);
        }
    }

    getAllHashPins() {
        const rows = this._stmts.getAllHashPins.all();
        const result = {};
        for (const row of rows) result[row.exact_hash] = true;
        return result;
    }

    setHashPinned(hash, pinned) {
        if (pinned) {
            this._stmts.addHashPin.run(hash);
        } else {
            this._stmts.removeHashPin.run(hash);
        }
    }

    addHashTag(hash, tagId) {
        this._stmts.addHashTag.run(hash, tagId, Date.now());
    }

    removeHashTag(hash, tagId) {
        this._stmts.removeHashTag.run(hash, tagId);
    }

    getHashTags(hash) {
        return this._stmts.getHashTags.all(hash);
    }

    getAllHashTags() {
        const rows = this._stmts.getTagsForHashes.all();
        const result = {};
        for (const row of rows) {
            (result[row.exact_hash] ||= []).push({ id: row.id, name: row.name, color: row.color });
        }
        return result;
    }

    bulkAddHashTag(hashes, tagId) {
        const now = Date.now();
        const tx = this.db.transaction((hs) => {
            for (const h of hs) this._stmts.addHashTag.run(h, tagId, now);
        });
        tx(hashes);
    }

    bulkRemoveHashTag(hashes, tagId) {
        const tx = this.db.transaction((hs) => {
            for (const h of hs) this._stmts.removeHashTag.run(h, tagId);
        });
        tx(hashes);
    }

    getPathsByHash(hash) {
        return this._stmts.getPathsByHash.all(hash).map(r => r.file_path);
    }

    getDuplicateHashGroups() {
        const rows = this._stmts.getDuplicateHashGroups.all();
        const groups = {};
        for (const row of rows) {
            (groups[row.exact_hash] ||= []).push(row.file_path);
        }
        return groups;
    }

    getPathToHashMap(filePaths) {
        const rows = this._stmts.getHashesForPathsBulk.all(JSON.stringify(filePaths));
        const result = {};
        for (const row of rows) result[row.file_path] = row.exact_hash;
        return result;
    }

    /**
     * Resolve conflicts when enabling linked duplicates.
     * For each hash group: take highest rating, union of tags, union of pins.
     */
    resolveLinkedConflicts() {
        const groups = this.getDuplicateHashGroups();
        const tx = this.db.transaction(() => {
            for (const [hash, paths] of Object.entries(groups)) {
                // Ratings: take highest
                let maxRating = 0;
                for (const p of paths) {
                    const row = this._stmts.getRating.get(p);
                    if (row && row.rating > maxRating) maxRating = row.rating;
                }
                if (maxRating > 0) this._stmts.setHashRating.run(hash, maxRating);

                // Pins: union
                let anyPinned = false;
                for (const p of paths) {
                    if (this._stmts.isPinned.get(p)) { anyPinned = true; break; }
                }
                if (anyPinned) this._stmts.addHashPin.run(hash);

                // Tags: union of all per-path tags
                const seenTags = new Set();
                for (const p of paths) {
                    const tags = this._stmts.getTagsForFile.all(p);
                    for (const t of tags) {
                        if (!seenTags.has(t.id)) {
                            seenTags.add(t.id);
                            this._stmts.addHashTag.run(hash, t.id, Date.now());
                        }
                    }
                }
            }
        });
        tx();
        return Object.keys(groups).length;
    }

    // ── File path migration (for batch rename) ────────────────────────

    updateFilePaths(pathPairs) {
        // Bulk path migration using direct UPDATE statements per table.
        // Uses pre-prepared statements (5 UPDATEs per pair) instead of the old
        // read-delete-insert pattern (4-7+ queries per pair including dynamic prepares).
        const tx = this.db.transaction((pairs) => {
            for (let { oldPath, newPath } of pairs) {
                // Normalize to forward slashes to match how the renderer stores paths
                oldPath = oldPath.replace(/\\/g, '/');
                newPath = newPath.replace(/\\/g, '/');
                // Update path in-place across all tables (no-op if row doesn't exist)
                this._stmts.updateRatingPath.run(newPath, oldPath);
                this._stmts.updatePinPath.run(newPath, oldPath);
                this._stmts.updateFileTagsPath.run(newPath, oldPath);
                this._stmts.updateCollectionFilesPath.run(newPath, oldPath);
                this._stmts.updateFileHashesPath.run(newPath, oldPath);
            }
        });
        tx(pathPairs);
    }

    // ── Migration ────────────────────────────────────────────────────────

    runMigration(data) {
        const tx = this.db.transaction((d) => {
            // Ratings
            if (d.fileRatings) {
                for (const [filePath, rating] of Object.entries(d.fileRatings)) {
                    if (rating > 0) {
                        this._stmts.setRating.run(filePath, rating);
                    }
                }
            }

            // Pins
            if (d.pinnedFiles) {
                for (const filePath of Object.keys(d.pinnedFiles)) {
                    this._stmts.addPin.run(filePath);
                }
            }

            // Favorites
            if (d.favorites && d.favorites.groups) {
                for (let gi = 0; gi < d.favorites.groups.length; gi++) {
                    const g = d.favorites.groups[gi];
                    this._stmts.insertFavoriteGroup.run(g.id, g.name, gi, g.collapsed ? 1 : 0);
                    if (g.items) {
                        for (let ii = 0; ii < g.items.length; ii++) {
                            const item = g.items[ii];
                            this._stmts.insertFavoriteItem.run(g.id, item.path, item.addedAt || null, ii);
                        }
                    }
                }
            }

            // Recent files
            if (d.recentFiles) {
                for (const entry of d.recentFiles) {
                    this._stmts.upsertRecentFile.run(entry.path, entry.addedAt || Date.now());
                }
            }

            // Collections
            if (d.collections) {
                for (const col of d.collections) {
                    this._stmts.upsertCollection.run(
                        col.id,
                        col.name,
                        col.type || 'manual',
                        col.rules ? JSON.stringify(col.rules) : null,
                        col.sortOrder ?? col.sort_order ?? 0,
                        col.color || null,
                        col.icon || null,
                        col.createdAt ?? col.created_at ?? Date.now(),
                        col.updatedAt ?? col.updated_at ?? Date.now()
                    );
                    // Collection files
                    if (col.files) {
                        for (const f of col.files) {
                            this._stmts.insertCollectionFile.run(
                                f.id,
                                col.id,
                                f.filePath || f.file_path,
                                f.addedAt || f.added_at || Date.now(),
                                f.sortOrder ?? f.sort_order ?? 0
                            );
                        }
                    }
                }
            }

            this._stmts.setMeta.run('migration_complete', '1');
        });
        tx(data);
    }

    exportTags() {
        const tags = this.getAllTags();
        const fileTags = this.db.prepare('SELECT file_path, tag_id FROM file_tags').all();
        return { tags, fileTags };
    }

    importTags(data) {
        if (!data) return;
        const tx = this.db.transaction((d) => {
            // Clear existing
            this.db.prepare('DELETE FROM file_tags').run();
            this.db.prepare('DELETE FROM tags').run();
            // Rebuild FTS
            this.db.prepare("INSERT INTO tags_fts(tags_fts) VALUES('rebuild')").run();
            // Insert tags with their original IDs
            const insertTag = this.db.prepare('INSERT INTO tags (id, name, description, color, created_at) VALUES (?, ?, ?, ?, ?)');
            if (d.tags) {
                for (const t of d.tags) {
                    insertTag.run(t.id, t.name, t.description || null, t.color || null, t.created_at || Date.now());
                }
            }
            // Insert file-tag associations
            if (d.fileTags) {
                for (const ft of d.fileTags) {
                    this._stmts.addTagToFile.run(ft.file_path, ft.tag_id, Date.now());
                }
            }
        });
        tx(data);
    }

    checkMigrationStatus() {
        return {
            migrationComplete: this.getMeta('migration_complete') === '1',
            migrationVerified: this.getMeta('migration_verified') === '1'
        };
    }

    // ── Saved searches ───────────────────────────────────────────────────

    saveSearch(entry) {
        const id = entry.id || ('ss_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
        const now = Date.now();
        const name = String(entry.name || '').trim().slice(0, 200) || 'Untitled';
        const q = String(entry.query || '');
        const filtersJson = entry.filters ? JSON.stringify(entry.filters) : null;
        const folderPath = entry.folderPath || null;
        this.db.prepare(`
            INSERT INTO saved_searches (id, name, "query", filters_json, folder_path, created_at, used_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                "query" = excluded."query",
                filters_json = excluded.filters_json,
                folder_path = excluded.folder_path
        `).run(id, name, q, filtersJson, folderPath, entry.createdAt || now, entry.usedAt || null);
        return id;
    }

    getAllSavedSearches() {
        const rows = this.db.prepare(`
            SELECT id, name, "query" AS query, filters_json, folder_path, created_at, used_at
            FROM saved_searches
            ORDER BY COALESCE(used_at, created_at) DESC, created_at DESC
        `).all();
        // JSON round-trip to strip any better-sqlite3 prototype or hidden props
        // that would make the result non-cloneable across IPC.
        const mapped = rows.map(r => ({
            id: String(r.id || ''),
            name: String(r.name || ''),
            query: String(r.query || ''),
            filters: r.filters_json ? (() => { try { return JSON.parse(r.filters_json); } catch { return null; } })() : null,
            folderPath: r.folder_path ? String(r.folder_path) : null,
            createdAt: Number(r.created_at) || 0,
            usedAt: r.used_at == null ? null : Number(r.used_at)
        }));
        return JSON.parse(JSON.stringify(mapped));
    }

    deleteSavedSearch(id) {
        this.db.prepare('DELETE FROM saved_searches WHERE id = ?').run(id);
    }

    touchSavedSearch(id) {
        this.db.prepare('UPDATE saved_searches SET used_at = ? WHERE id = ?').run(Date.now(), id);
    }

    renameSavedSearch(id, newName) {
        const name = String(newName || '').trim().slice(0, 200);
        if (!name) return;
        this.db.prepare('UPDATE saved_searches SET name = ? WHERE id = ?').run(name, id);
    }

    // ── Lifecycle ────────────────────────────────────────────────────────

    close() {
        try { this.db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
        this.db.close();
    }
}

module.exports = AppDatabase;
