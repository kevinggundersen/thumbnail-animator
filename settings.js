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
        this._writeListeners = new Map();  // storageKey -> Set<Function> (raw-key writes)
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
                case 'float':  { const v = localStorage.getItem(key); const n = v !== null ? parseFloat(v) : NaN; this._store.set(name, Number.isFinite(n) ? n : desc.default); break; }
                case 'bool':   this._store.set(name, _bool(key, desc.default)); break;
                case 'string': this._store.set(name, _str(key, desc.default)); break;
                case 'json':   this._store.set(name, _json(key, desc.default)); break;
                default:       this._store.set(name, _str(key, desc.default));
            }
        }
    }

    // ── Deferred localStorage writes (batched via requestIdleCallback) ─

    /**
     * Subscribe to writes of a raw storage key (every deferLocalStorageWrite call
     * goes through here), independent of whether the key is in the schema.
     */
    onWrite(key, fn) {
        if (!this._writeListeners.has(key)) this._writeListeners.set(key, new Set());
        this._writeListeners.get(key).add(fn);
        return () => { const s = this._writeListeners.get(key); if (s) s.delete(fn); };
    }

    /** Storage keys to export, grouped by how they are stored (plain string vs JSON). */
    exportKeys() {
        const out = { string: [], json: [] };
        for (const desc of Object.values(this._schema)) {
            if (desc.export === false) continue;
            if (desc.storageKeys) { out.string.push(...Object.values(desc.storageKeys)); continue; }
            (desc.type === 'json' ? out.json : out.string).push(desc.storageKey);
        }
        return out;
    }

    _deferWrite(key, value) {
        this._pendingWrites.set(key, value);
        const ls = this._writeListeners.get(key);
        if (ls) for (const fn of ls) { try { fn(value, key); } catch (e) { console.error(`[Settings] write listener error for "${key}":`, e); } }
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
            if (desc.export === false) continue;
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
                    case 'float':  val = parseFloat(raw); break;
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

    // ── Everything else the renderer keeps in localStorage ────────────
    // One schema is the source of truth for types, defaults and the export/import
    // key list (settings-ui.js derives its lists from exportKeys()). Reads at the
    // call sites still go through localStorage directly for now; each entry's
    // default documents what a missing key means there.
    // Preferences
    rememberLastFolder:      { type: 'bool',   default: true,  storageKey: 'rememberLastFolder' },
    lastFolderPath:          { type: 'string', default: '',    storageKey: 'lastFolderPath' },
    includeMovingImages:     { type: 'bool',   default: true,  storageKey: 'includeMovingImages' },
    autoRepeatVideos:        { type: 'bool',   default: true,  storageKey: 'autoRepeatVideos' },
    pauseOnBlur:             { type: 'bool',   default: true,  storageKey: 'pauseOnBlur' },
    pauseOnLightbox:         { type: 'bool',   default: true,  storageKey: 'pauseOnLightbox' },
    hoverScrub:              { type: 'bool',   default: true,  storageKey: 'hoverScrub' },
    gifHoverScrub:           { type: 'bool',   default: true,  storageKey: 'gifHoverScrub' },
    hoverPreviewStrip:       { type: 'bool',   default: true,  storageKey: 'hoverPreviewStrip' },
    lightboxFilmstripEnabled:{ type: 'bool',   default: true,  storageKey: 'lightboxFilmstripEnabled' },
    playbackControls:        { type: 'bool',   default: true,  storageKey: 'playbackControls' },
    zoomToFit:               { type: 'bool',   default: true,  storageKey: 'zoomToFit' },
    thumbnailQuality:        { type: 'string', default: 'medium', storageKey: 'thumbnailQuality' },
    useSystemTrash:          { type: 'bool',   default: false, storageKey: 'useSystemTrash' },
    linkedDuplicates:        { type: 'bool',   default: false, storageKey: 'linkedDuplicates' },
    recursiveSearch:         { type: 'bool',   default: false, storageKey: 'recursiveSearch' },
    groupByDate:             { type: 'bool',   default: false, storageKey: 'groupByDate' },
    dateGroupGranularity:    { type: 'string', default: 'month', storageKey: 'dateGroupGranularity' },
    sortType:                { type: 'string', default: 'name', storageKey: 'sortType' },
    sortOrder:               { type: 'string', default: 'ascending', storageKey: 'sortOrder' },
    selectedTheme:           { type: 'string', default: 'dark', storageKey: 'selectedTheme' },
    welcomeDismissedVersion: { type: 'string', default: '',    storageKey: 'welcomeDismissedVersion' },
    lbInspectorCollapsed:    { type: 'string', default: '0',   storageKey: 'lbInspectorCollapsed' }, // '1' / '0'
    videoCacheLimitMB:       { type: 'int',    default: 1024,  storageKey: 'videoCacheLimitMB' },
    imageCacheLimitMB:       { type: 'int',    default: 1024,  storageKey: 'imageCacheLimitMB' },
    controlBarHideDelay:     { type: 'int',    default: 3000,  storageKey: 'controlBarHideDelay' },
    videoThumbSeekPct:       { type: 'int',    default: 25,    storageKey: 'videoThumbSeekPct' },
    videoThumbWidth:         { type: 'int',    default: 512,   storageKey: 'videoThumbWidth' },
    // Grid playback proxies (small H.264 renditions played in the grid instead of the originals)
    videoProxies:            { type: 'bool',   default: true,  storageKey: 'videoProxies' },
    videoProxyEdge:          { type: 'int',    default: 480,   storageKey: 'videoProxyEdge' },
    videoProxyMaxSeconds:    { type: 'int',    default: 120,   storageKey: 'videoProxyMaxSeconds' },
    videoProxyFps:           { type: 'int',    default: 30,    storageKey: 'videoProxyFps' },
    // Grid playback engine: 'webcodecs' (worker decode onto canvases) or 'video' (<video> elements)
    playbackEngine:          { type: 'string', default: 'webcodecs', storageKey: 'playbackEngine' },
    webcodecsDecoder:        { type: 'string', default: 'prefer-software', storageKey: 'webcodecsDecoder' },
    decodeFrameBudget:       { type: 'int',    default: 3000,  storageKey: 'decodeFrameBudget' }, // decoded frames/s across the grid, 0 = no cap
    proxyCacheLimitMB:       { type: 'int',    default: 4000,  storageKey: 'proxyCacheLimitMB' },
    ioConcurrency:           { type: 'int',    default: 20,    storageKey: 'ioConcurrency' },
    // Sidebar / tabs
    sidebarWidth:            { type: 'int',    default: 260,   storageKey: 'sidebarWidth' },
    sidebarCollapsed:        { type: 'bool',   default: false, storageKey: 'sidebarCollapsed' },
    sidebarTabFilterActive:  { type: 'bool',   default: false, storageKey: 'sidebarTabFilterActive' },
    sidebarTabFilterFlat:    { type: 'bool',   default: false, storageKey: 'sidebarTabFilterFlat' },
    sidebarExpandedNodes:    { type: 'json',   default: [],    storageKey: 'sidebarExpandedNodes' },
    tabs:                    { type: 'json',   default: [],    storageKey: 'tabs' },
    activeTabId:             { type: 'string', default: '',    storageKey: 'activeTabId' },
    tabGroups:               { type: 'json',   default: [],    storageKey: 'tabGroups' },
    savedTabGroups:          { type: 'json',   default: [],    storageKey: 'savedTabGroups' },
    folderSortPrefs:         { type: 'json',   default: {},    storageKey: 'folderSortPrefs' },
    folderZoomPrefs:         { type: 'json',   default: {},    storageKey: 'folderZoomPrefs' },
    // Cards, tags, shortcuts, themes, dialogs
    cardInfoSettings:        { type: 'json',   default: {},    storageKey: 'cardInfoSettings' },
    extensionColors:         { type: 'json',   default: {},    storageKey: 'extensionColors' },
    tagGroups:               { type: 'json',   default: [],    storageKey: 'tagGroups' },
    keyboardShortcuts:       { type: 'json',   default: {},    storageKey: 'keyboardShortcuts' },
    customThemes:            { type: 'json',   default: [],    storageKey: 'customThemes' },
    playbackSpeeds:          { type: 'json',   default: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2], storageKey: 'playbackSpeeds' },
    pluginStates:            { type: 'json',   default: {},    storageKey: 'pluginStates' },
    commandPaletteRecents:   { type: 'json',   default: [],    storageKey: 'commandPaletteRecents' },
    convertDefaults:         { type: 'json',   default: {},    storageKey: 'convertDefaults' },
    autoTagLastView:         { type: 'string', default: '',    storageKey: 'autoTagLastView' },
    // AI
    aiVisualSearchEnabled:   { type: 'bool',   default: false, storageKey: 'aiVisualSearchEnabled' },
    aiModelDownloadConfirmed:{ type: 'bool',   default: false, storageKey: 'aiModelDownloadConfirmed' },
    aiAutoScan:              { type: 'bool',   default: false, storageKey: 'aiAutoScan' },
    aiSimilarityThreshold:   { type: 'float',  default: 0.15,  storageKey: 'aiSimilarityThreshold' },
    aiClusteringMode:        { type: 'string', default: 'off', storageKey: 'aiClusteringMode' },
    aiIdleDelay:             { type: 'int',    default: 10000, storageKey: 'aiIdleDelay' },
    aiBatchSize:             { type: 'int',    default: 8,     storageKey: 'aiBatchSize' },
    aiVideoFrameCount:       { type: 'int',    default: 4,     storageKey: 'aiVideoFrameCount' },
    clipGpuMode:             { type: 'string', default: 'auto', storageKey: 'clipGpuMode' },
    clipWorkerCount:         { type: 'int',    default: 4,     storageKey: 'clipWorkerCount' },
    // Pre-SQLite storage, read once by the migration in renderer-features.js and never exported
    legacyFileRatings:       { type: 'json',   default: {},    storageKey: 'fileRatings', export: false },
    legacyPinnedFiles:       { type: 'json',   default: [],    storageKey: 'pinnedFiles', export: false },
    legacyFavorites:         { type: 'json',   default: [],    storageKey: 'favorites', export: false },
    legacyRecentFiles:       { type: 'json',   default: [],    storageKey: 'recentFiles', export: false },
    // Machine-local state: never exported
    playbackBudgetHint:      { type: 'int',    default: 0,     storageKey: 'playbackBudgetHint', export: false },
    perfLog:                 { type: 'string', default: '0',   storageKey: 'perfLog', export: false },

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
if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    window.appSettings = new Settings(SETTINGS_SCHEMA);
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Settings, SETTINGS_SCHEMA };
}
