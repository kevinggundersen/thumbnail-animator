// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS — Centralised persistence & change notification
// Loaded before every other script. Owns localStorage read/write for all
// user-configurable values.  Existing `let` variables in renderer.js stay as
// hot-path cached copies; sync callbacks keep them in lockstep.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

class Settings {
    /**
     * @param {Object} schema  Map of settingName -> descriptor
     *   { type:'int'|'bool'|'string'|'json',
     *     default: any,
     *     storageKey: string,           // single localStorage key
     *     storageKeys?: {field:key},    // multi-key object settings
     *     parse?: (raw)=>value,         // optional custom parser
     *     serialize?: (value)=>string } // optional custom serializer
     */
    constructor(schema) {
        this._schema = schema;
        this._store = new Map();
        this._listeners = new Map();       // settingName -> Set<Function>
        this._pendingWrites = new Map();
        this._flushScheduled = false;
        this.hydrate();
    }

    // ── Read / Write ──────────────────────────────────────────────────

    get(name) {
        return this._store.get(name);
    }

    set(name, value) {
        const prev = this._store.get(name);
        this._store.set(name, value);
        // Persist
        const desc = this._schema[name];
        if (desc) {
            if (desc.storageKeys) {
                // Multi-key object: write each sub-key
                for (const [field, key] of Object.entries(desc.storageKeys)) {
                    this._deferWrite(key, String(value[field]));
                }
            } else {
                const raw = desc.serialize
                    ? desc.serialize(value)
                    : (desc.type === 'json' ? JSON.stringify(value) : String(value));
                this._deferWrite(desc.storageKey, raw);
            }
        }
        // Notify
        this._fire(name, value, prev);
    }

    /**
     * Shallow-merge partial into an object setting, then persist + notify.
     */
    update(name, partial) {
        const current = this._store.get(name);
        const merged = Object.assign({}, current, partial);
        this.set(name, merged);
    }

    // ── Change listeners ──────────────────────────────────────────────

    on(name, fn) {
        if (!this._listeners.has(name)) this._listeners.set(name, new Set());
        this._listeners.get(name).add(fn);
        return () => this.off(name, fn);
    }

    off(name, fn) {
        const set = this._listeners.get(name);
        if (set) set.delete(fn);
    }

    _fire(name, value, prev) {
        const set = this._listeners.get(name);
        if (set) for (const fn of set) { try { fn(value, prev); } catch (e) { console.error(`[Settings] listener error for "${name}":`, e); } }
        // Wildcard
        const star = this._listeners.get('*');
        if (star) for (const fn of star) { try { fn(name, value, prev); } catch (e) { console.error('[Settings] wildcard listener error:', e); } }
    }

    // ── Hydration from localStorage ───────────────────────────────────

    hydrate() {
        const _int = (key, fallback) => { const v = localStorage.getItem(key); return v !== null ? parseInt(v, 10) : fallback; };
        const _str = (key, fallback) => localStorage.getItem(key) || fallback;
        const _bool = (key, fallback) => { const v = localStorage.getItem(key); return v !== null ? v === 'true' : fallback; };
        const _json = (key, fallback) => { try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; } catch { return fallback; } };

        for (const [name, desc] of Object.entries(this._schema)) {
            if (desc.parse) {
                // Custom parser (used for performance profile cascade etc.)
                this._store.set(name, desc.parse({ _int, _str, _bool, _json }));
                continue;
            }
            if (desc.storageKeys) {
                // Multi-key object
                const obj = {};
                for (const [field, key] of Object.entries(desc.storageKeys)) {
                    const fieldDefault = desc.default[field];
                    if (typeof fieldDefault === 'boolean') obj[field] = _bool(key, fieldDefault);
                    else if (typeof fieldDefault === 'number') obj[field] = _int(key, fieldDefault);
                    else obj[field] = _str(key, fieldDefault);
                }
                this._store.set(name, obj);
                continue;
            }
            const key = desc.storageKey;
            switch (desc.type) {
                case 'int':    this._store.set(name, _int(key, desc.default)); break;
                case 'bool':   this._store.set(name, _bool(key, desc.default)); break;
                case 'string': this._store.set(name, _str(key, desc.default)); break;
                case 'json':   this._store.set(name, _json(key, desc.default)); break;
                default:       this._store.set(name, _str(key, desc.default));
            }
        }
    }

    // ── Deferred localStorage writes (batched via requestIdleCallback) ─

    _deferWrite(key, value) {
        this._pendingWrites.set(key, value);
        if (!this._flushScheduled) {
            this._flushScheduled = true;
            if ('requestIdleCallback' in window) {
                requestIdleCallback(() => this._flushWrites(), { timeout: 200 });
            } else {
                setTimeout(() => this._flushWrites(), 50);
            }
        }
    }

    _flushWrites() {
        this._flushScheduled = false;
        for (const [key, value] of this._pendingWrites) {
            localStorage.setItem(key, value);
        }
        this._pendingWrites.clear();
    }

    flush() {
        this._flushWrites();
    }

    // ── Export / Import ───────────────────────────────────────────────

    export() {
        this.flush();
        const out = {};
        for (const [name, desc] of Object.entries(this._schema)) {
            if (desc.storageKeys) {
                for (const [, key] of Object.entries(desc.storageKeys)) {
                    const v = localStorage.getItem(key);
                    if (v !== null) out[key] = v;
                }
            } else {
                const v = localStorage.getItem(desc.storageKey);
                if (v !== null) out[desc.storageKey] = v;
            }
        }
        return out;
    }

    import(data) {
        for (const [name, desc] of Object.entries(this._schema)) {
            if (desc.storageKeys) {
                const obj = {};
                let found = false;
                for (const [field, key] of Object.entries(desc.storageKeys)) {
                    if (key in data) {
                        localStorage.setItem(key, data[key]);
                        const fieldDefault = desc.default[field];
                        if (typeof fieldDefault === 'boolean') obj[field] = data[key] === 'true';
                        else if (typeof fieldDefault === 'number') obj[field] = parseInt(data[key], 10);
                        else obj[field] = data[key];
                        found = true;
                    } else {
                        obj[field] = desc.default[field];
                    }
                }
                if (found) {
                    this._store.set(name, obj);
                    this._fire(name, obj, undefined);
                }
            } else if (desc.storageKey in data) {
                localStorage.setItem(desc.storageKey, data[desc.storageKey]);
                // Re-parse to typed value
                const raw = data[desc.storageKey];
                let val;
                switch (desc.type) {
                    case 'int':    val = parseInt(raw, 10); break;
                    case 'bool':   val = raw === 'true'; break;
                    case 'json':   try { val = JSON.parse(raw); } catch { val = desc.default; } break;
                    default:       val = raw;
                }
                this._store.set(name, val);
                this._fire(name, val, undefined);
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

const SETTINGS_SCHEMA = {
    // ── Performance profile (cascade) ─────────────────────────────────
    perfProfile: { type: 'string', default: 'medium', storageKey: 'perfProfile' },

    // ── Media Loading ─────────────────────────────────────────────────
    maxMedia:            { type: 'int',  default: 120,  storageKey: 'maxMedia' },
    parallelLoad:        { type: 'int',  default: 10,   storageKey: 'parallelLoad' },
    vsBuffer:            { type: 'int',  default: 1200, storageKey: 'vsBuffer' },
    vsPoolSize:          { type: 'int',  default: 150,  storageKey: 'vsPoolSize' },
    scrollDebounce:      { type: 'int',  default: 150,  storageKey: 'scrollDebounce' },
    progressiveThreshold:{ type: 'int',  default: 1000, storageKey: 'progressiveThreshold' },
    imageThumbMaxEdge:   { type: 'int',  default: 768,  storageKey: 'imageThumbMaxEdge' },

    // ── Cache TTLs ────────────────────────────────────────────────────
    folderCacheTTL:      { type: 'int',  default: 30000,   storageKey: 'folderCacheTTL' },
    idbCacheTTL:         { type: 'int',  default: 3600000, storageKey: 'idbCacheTTL' },

    // ── Retry ─────────────────────────────────────────────────────────
    retryAttempts:       { type: 'int',  default: 5,    storageKey: 'retryAttempts' },
    retryInitialDelay:   { type: 'int',  default: 500,  storageKey: 'retryInitialDelay' },
    retryMaxDelay:       { type: 'int',  default: 5000, storageKey: 'retryMaxDelay' },

    // ── Layout ────────────────────────────────────────────────────────
    gridGap:             { type: 'int',    default: 12,     storageKey: 'gridGap' },
    minCardWidth:        { type: 'int',    default: 220,    storageKey: 'minCardWidth' },
    cardAspectRatio:     { type: 'string', default: '16:9', storageKey: 'cardAspectRatio' },
    zoomLevel:           { type: 'int',    default: 100,    storageKey: 'zoomLevel' },
    layoutMode:          { type: 'string', default: 'masonry', storageKey: 'layoutMode' },

    // ── Animation ─────────────────────────────────────────────────────
    animationSpeed:      { type: 'string', default: 'normal', storageKey: 'animationSpeed' },
    reduceMotion:        { type: 'bool',   default: false,    storageKey: 'reduceMotion' },

    // ── Lightbox ──────────────────────────────────────────────────────
    lightboxMaxZoom:     { type: 'int', default: 500, storageKey: 'lightboxMaxZoom' },
    lightboxViewport:    { type: 'int', default: 90,  storageKey: 'lightboxViewport' },
    blowUpDelay:         { type: 'int', default: 250, storageKey: 'blowUpDelay' },

    // ── Slideshow ─────────────────────────────────────────────────────
    defaultSlideshowSpeed: { type: 'int', default: 3000, storageKey: 'defaultSlideshowSpeed' },

    // ── Limits ────────────────────────────────────────────────────────
    recentFilesLimit:      { type: 'int', default: 50, storageKey: 'recentFilesLimit' },
    maxUndoHistory:        { type: 'int', default: 30, storageKey: 'maxUndoHistory' },
    tagSuggestionsLimit:   { type: 'int', default: 10, storageKey: 'tagSuggestionsLimit' },
    searchHistoryLimit:    { type: 'int', default: 10, storageKey: 'searchHistoryLimit' },

    // ── Sidebar ───────────────────────────────────────────────────────
    sidebarMinWidth:       { type: 'int', default: 180, storageKey: 'sidebarMinWidth' },
    sidebarMaxWidth:       { type: 'int', default: 500, storageKey: 'sidebarMaxWidth' },

    // ── Folder preview ────────────────────────────────────────────────
    folderPreviewCount:    { type: 'int', default: 4,   storageKey: 'folderPreviewCount' },
    folderPreviewSize:     { type: 'int', default: 192, storageKey: 'folderPreviewSize' },

    // ── Hover scale (multi-key object) ────────────────────────────────
    hoverScaleState: {
        type: 'object',
        default: { pct: 102, withZoom: false, at50: 120, at100: 102, at200: 100 },
        storageKeys: {
            pct: 'hoverScale',
            withZoom: 'hoverScaleWithZoom',
            at50: 'hoverScaleAt50',
            at100: 'hoverScaleAt100',
            at200: 'hoverScaleAt200'
        }
    },
};

// ── Instantiate ───────────────────────────────────────────────────────
window.appSettings = new Settings(SETTINGS_SCHEMA);
