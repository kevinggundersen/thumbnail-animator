'use strict';

const fs = require('fs');
const path = require('path');
const { createPluginAPI } = require('./plugin-api');

const BASE_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.ogg', '.mov']);
const BASE_IMAGE_EXTENSIONS = new Set(['.gif', '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.svg']);
const PLUGIN_TIMEOUT_MS = 10000;

/**
 * Wraps a plugin method call with a timeout and error isolation.
 */
async function callWithTimeout(fn, timeoutMs = PLUGIN_TIMEOUT_MS) {
    return Promise.race([
        Promise.resolve().then(fn),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Plugin call timed out')), timeoutMs)
        ),
    ]);
}

class PluginRegistry {
    constructor(cacheBaseDir, statesFilePath = null) {
        this._cacheBaseDir = cacheBaseDir;
        this._statesFilePath = statesFilePath;
        // Map<pluginId, manifest>
        this._manifests = new Map();
        // Map<pluginId, pluginInstance> — lazy loaded
        this._loaded = new Map();
        // Map<ext, Array<{pluginId, extractorId, method}>>
        this._extractorsByExt = new Map();
        // Map<pluginId, Array<contextMenuItem>>
        this._contextMenuItemsByPlugin = new Map();
        // Extra extensions contributed by plugins
        this._extraVideoExtensions = new Set();
        this._extraImageExtensions = new Set();
        // Map<pluginId, Array<infoSection>>
        this._infoSectionsByPlugin = new Map();
        // Map<ext, Array<{pluginId, generatorId, method}>>
        this._thumbGeneratorsByExt = new Map();
        // Map<pluginId, Array<batchOperation>>
        this._batchOpsByPlugin = new Map();
        // Map<pluginId, settingsPanel>
        this._settingsPanelsByPlugin = new Map();
        // Map<ext, {pluginId, rendererId, mode, mimeType}> — lightbox renderers
        this._lightboxRenderersByExt = new Map();
        // Map<pluginId, Array<tooltipSection>> — tooltip sections
        this._tooltipSectionsByPlugin = new Map();
        // Set of plugin IDs that came from builtin directories
        this._builtinPluginIds = new Set();
        // Global plugin ordering — controls execution priority
        this._pluginOrder = [];
        // Set of disabled plugin IDs — loaded from statesFilePath on startup
        this._disabledPlugins = new Set();
        if (statesFilePath && fs.existsSync(statesFilePath)) {
            try {
                const raw = JSON.parse(fs.readFileSync(statesFilePath, 'utf8'));
                if (raw && typeof raw.states === 'object' && !Array.isArray(raw.states)) {
                    // New format: { states: { id: bool }, order: [...] }
                    for (const [id, enabled] of Object.entries(raw.states)) {
                        if (enabled === false) this._disabledPlugins.add(id);
                    }
                    this._pluginOrder = Array.isArray(raw.order) ? raw.order : [];
                } else if (raw && typeof raw === 'object') {
                    // Old format: { id: bool } — migrate
                    for (const [id, enabled] of Object.entries(raw)) {
                        if (enabled === false) this._disabledPlugins.add(id);
                    }
                }
            } catch (err) {
                console.warn('[PluginRegistry] Could not load plugin states:', err.message);
            }
        }
    }

    // --- Plugin Enable/Disable ---

    /**
     * Enable or disable a plugin at runtime. Persists to statesFilePath.
     */
    setPluginEnabled(pluginId, enabled) {
        if (enabled) {
            this._disabledPlugins.delete(pluginId);
        } else {
            this._disabledPlugins.add(pluginId);
        }
        this._saveStates();
    }

    /**
     * Returns { pluginId: boolean } for all registered plugins.
     */
    getPluginStates() {
        const result = {};
        for (const [id] of this._manifests) {
            result[id] = !this._disabledPlugins.has(id);
        }
        return result;
    }

    _saveStates() {
        if (!this._statesFilePath) return;
        try {
            const data = { states: {}, order: [...this._pluginOrder] };
            for (const [id] of this._manifests) {
                data.states[id] = !this._disabledPlugins.has(id);
            }
            fs.mkdirSync(path.dirname(this._statesFilePath), { recursive: true });
            fs.writeFileSync(this._statesFilePath, JSON.stringify(data, null, 2));
        } catch (err) {
            console.warn('[PluginRegistry] Could not save plugin states:', err.message);
        }
    }

    /**
     * Discover and register plugins from a directory (non-recursive, one plugin per subdir).
     * Safe to call multiple times with different directories.
     */
    discover(pluginsDir, { builtin = false } = {}) {
        if (!fs.existsSync(pluginsDir)) return;

        let entries;
        try {
            entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
        } catch (err) {
            console.warn(`[PluginRegistry] Could not read plugins dir: ${pluginsDir}`, err.message);
            return;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const manifestPath = path.join(pluginsDir, entry.name, 'plugin.json');
            if (!fs.existsSync(manifestPath)) continue;

            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                this._registerManifest(manifest, path.join(pluginsDir, entry.name));
                if (builtin && manifest.id) this._builtinPluginIds.add(manifest.id);
            } catch (err) {
                console.warn(`[PluginRegistry] Failed to load manifest at ${manifestPath}:`, err.message);
            }
        }
    }

    _registerManifest(manifest, pluginDir) {
        const { id, main, capabilities = {} } = manifest;
        if (!id || !main) {
            console.warn('[PluginRegistry] Skipping plugin with missing id or main:', manifest);
            return;
        }

        // Validate main path doesn't escape plugin directory
        const resolvedMain = path.resolve(pluginDir, main);
        if (!resolvedMain.startsWith(pluginDir)) {
            console.warn(`[PluginRegistry] Plugin "${id}" main path escapes plugin directory — skipped`);
            return;
        }

        this._manifests.set(id, { ...manifest, _dir: pluginDir, _mainPath: resolvedMain });

        // Add to global order if not already present
        if (!this._pluginOrder.includes(id)) this._pluginOrder.push(id);

        // Index metadata extractors
        if (Array.isArray(capabilities.metadataExtractors)) {
            for (const extractor of capabilities.metadataExtractors) {
                for (const ext of (extractor.extensions || [])) {
                    const key = ext.toLowerCase();
                    if (!this._extractorsByExt.has(key)) this._extractorsByExt.set(key, []);
                    this._extractorsByExt.get(key).push({ pluginId: id, extractorId: extractor.id, method: extractor.method });
                }
            }
        }

        // Index context menu items
        if (Array.isArray(capabilities.contextMenuItems) && capabilities.contextMenuItems.length > 0) {
            this._contextMenuItemsByPlugin.set(id, capabilities.contextMenuItems);
        }

        // Index file type extensions (supports single object or array of {extensions, category})
        if (capabilities.fileTypes) {
            const entries = Array.isArray(capabilities.fileTypes) ? capabilities.fileTypes : [capabilities.fileTypes];
            for (const entry of entries) {
                const { extensions = [], category } = entry;
                for (const ext of extensions) {
                    if (category === 'video') this._extraVideoExtensions.add(ext.toLowerCase());
                    else this._extraImageExtensions.add(ext.toLowerCase());
                }
            }
        }

        // Index info sections (plugin-contributed file info panel sections)
        if (Array.isArray(capabilities.infoSections) && capabilities.infoSections.length > 0) {
            this._infoSectionsByPlugin.set(id, capabilities.infoSections);
        }

        // Index tooltip sections (plugin-contributed hover tooltip rows)
        if (Array.isArray(capabilities.tooltipSections) && capabilities.tooltipSections.length > 0) {
            this._tooltipSectionsByPlugin.set(id, capabilities.tooltipSections);
        }

        // Index thumbnail generators
        if (Array.isArray(capabilities.thumbnailGenerators)) {
            for (const gen of capabilities.thumbnailGenerators) {
                for (const ext of (gen.extensions || [])) {
                    const key = ext.toLowerCase();
                    if (!this._thumbGeneratorsByExt.has(key)) this._thumbGeneratorsByExt.set(key, []);
                    this._thumbGeneratorsByExt.get(key).push({ pluginId: id, generatorId: gen.id, method: gen.method });
                }
            }
        }

        // Index batch operations
        if (Array.isArray(capabilities.batchOperations) && capabilities.batchOperations.length > 0) {
            this._batchOpsByPlugin.set(id, capabilities.batchOperations);
        }

        // Index settings panels
        if (capabilities.settingsPanel) {
            this._settingsPanelsByPlugin.set(id, capabilities.settingsPanel);
        }

        // Index lightbox renderers
        if (Array.isArray(capabilities.lightboxRenderers)) {
            for (const renderer of capabilities.lightboxRenderers) {
                for (const ext of (renderer.extensions || [])) {
                    this._lightboxRenderersByExt.set(ext.toLowerCase(), {
                        pluginId: id,
                        rendererId: renderer.id,
                        mode: renderer.mode || 'image',
                        mimeType: renderer.mimeType || null,
                    });
                }
            }
        }

        // Sort handler arrays by global plugin order
        this._sortHandlersByOrder();

        console.log(`[PluginRegistry] Registered plugin: ${id}`);
    }

    /** Sort extractor and generator arrays by global plugin order. */
    _sortHandlersByOrder() {
        const orderIndex = (pluginId) => {
            const idx = this._pluginOrder.indexOf(pluginId);
            return idx >= 0 ? idx : Infinity;
        };
        for (const [, arr] of this._extractorsByExt) {
            arr.sort((a, b) => orderIndex(a.pluginId) - orderIndex(b.pluginId));
        }
        for (const [, arr] of this._thumbGeneratorsByExt) {
            arr.sort((a, b) => orderIndex(a.pluginId) - orderIndex(b.pluginId));
        }
    }

    /** Lazily load a plugin's module and call activate(). */
    async _loadPlugin(pluginId) {
        if (this._loaded.has(pluginId)) return this._loaded.get(pluginId);

        const manifest = this._manifests.get(pluginId);
        if (!manifest) throw new Error(`Unknown plugin: ${pluginId}`);

        const api = createPluginAPI(pluginId, this._cacheBaseDir);
        const mod = require(manifest._mainPath);
        const instance = typeof mod.activate === 'function' ? await mod.activate(api) : mod;
        this._loaded.set(pluginId, instance);
        return instance;
    }

    // --- Extension Sets ---

    getVideoExtensions() {
        return new Set([...BASE_VIDEO_EXTENSIONS, ...this._extraVideoExtensions]);
    }

    getImageExtensions() {
        return new Set([...BASE_IMAGE_EXTENSIONS, ...this._extraImageExtensions]);
    }

    getSupportedExtensions() {
        return new Set([...this.getVideoExtensions(), ...this.getImageExtensions()]);
    }

    // --- Metadata Extraction ---

    /**
     * Run all registered metadata extractors for the given file.
     * Returns an object keyed by extractorId.
     */
    async extractMetadata(filePath, ext) {
        const result = {};
        const extractors = this._extractorsByExt.get(ext.toLowerCase()) || [];

        for (const { pluginId, extractorId, method } of extractors) {
            if (this._disabledPlugins.has(pluginId)) continue;
            try {
                const instance = await this._loadPlugin(pluginId);
                if (typeof instance[method] !== 'function') continue;
                const data = await callWithTimeout(() => instance[method](filePath));
                if (data != null) result[extractorId] = data;
            } catch (err) {
                console.warn(`[PluginRegistry] Extractor "${extractorId}" (plugin "${pluginId}") failed:`, err.message);
            }
        }

        return result;
    }

    // --- Context Menu ---

    /**
     * Returns all plugin-contributed context menu items as a flat array,
     * with pluginId attached to each item.
     */
    getAllContextMenuItems() {
        const items = [];
        for (const [pluginId, menuItems] of this._contextMenuItemsByPlugin) {
            if (this._disabledPlugins.has(pluginId)) continue;
            for (const item of menuItems) {
                items.push({ ...item, pluginId });
            }
        }
        return items;
    }

    /**
     * Execute a plugin context menu action.
     */
    async executeAction(pluginId, actionId, filePath, metadata) {
        const manifest = this._manifests.get(pluginId);
        if (!manifest) throw new Error(`Unknown plugin: ${pluginId}`);

        const caps = manifest.capabilities || {};
        const itemDef = (caps.contextMenuItems || []).find(i => i.id === actionId);
        if (!itemDef) throw new Error(`Unknown action "${actionId}" in plugin "${pluginId}"`);

        const instance = await this._loadPlugin(pluginId);
        if (typeof instance[itemDef.method] !== 'function') {
            throw new Error(`Plugin "${pluginId}" does not export method "${itemDef.method}"`);
        }

        return callWithTimeout(() => instance[itemDef.method](filePath, metadata));
    }

    /**
     * Get all manifests (renderer uses these to know about plugin contributions).
     */
    getManifests() {
        const orderIndex = (pluginId) => {
            const idx = this._pluginOrder.indexOf(pluginId);
            return idx >= 0 ? idx : Infinity;
        };
        return Array.from(this._manifests.values())
            .map(({ _dir, _mainPath, id, ...rest }) => ({
                ...rest,
                id,
                enabled: !this._disabledPlugins.has(id),
                builtin: this._builtinPluginIds.has(id),
            }))
            .sort((a, b) => orderIndex(a.id) - orderIndex(b.id));
    }

    // --- Info Sections ---

    /**
     * Returns all plugin-contributed info sections as a flat array.
     * Renderer uses these to render extra sections in the file info panel.
     */
    getAllInfoSections() {
        const sections = [];
        for (const [pluginId, infoSections] of this._infoSectionsByPlugin) {
            if (this._disabledPlugins.has(pluginId)) continue;
            for (const section of infoSections) {
                sections.push({ ...section, pluginId });
            }
        }
        return sections;
    }

    /**
     * Execute a plugin info section renderer method.
     * Returns { html, actions } or null.
     */
    async renderInfoSection(pluginId, sectionId, filePath, pluginMetadata) {
        const manifest = this._manifests.get(pluginId);
        if (!manifest) throw new Error(`Unknown plugin: ${pluginId}`);

        const caps = manifest.capabilities || {};
        const sectionDef = (caps.infoSections || []).find(s => s.id === sectionId);
        if (!sectionDef) throw new Error(`Unknown info section "${sectionId}" in plugin "${pluginId}"`);

        const instance = await this._loadPlugin(pluginId);
        if (typeof instance[sectionDef.method] !== 'function') {
            throw new Error(`Plugin "${pluginId}" does not export method "${sectionDef.method}"`);
        }

        return callWithTimeout(() => instance[sectionDef.method](filePath, pluginMetadata));
    }

    // --- Tooltip Sections ---

    /**
     * Returns all plugin-contributed tooltip sections as a flat array.
     * Renderer uses these to append extra rows in the card hover tooltip.
     */
    getAllTooltipSections() {
        const sections = [];
        for (const [pluginId, tooltipSections] of this._tooltipSectionsByPlugin) {
            if (this._disabledPlugins.has(pluginId)) continue;
            for (const section of tooltipSections) {
                sections.push({ ...section, pluginId });
            }
        }
        return sections;
    }

    /**
     * Execute a plugin tooltip section renderer method.
     * Returns { html } or null. Uses a shorter 3s timeout since tooltips are latency-sensitive.
     */
    async renderTooltipSection(pluginId, sectionId, filePath, pluginMetadata) {
        const manifest = this._manifests.get(pluginId);
        if (!manifest) throw new Error(`Unknown plugin: ${pluginId}`);

        const caps = manifest.capabilities || {};
        const sectionDef = (caps.tooltipSections || []).find(s => s.id === sectionId);
        if (!sectionDef) throw new Error(`Unknown tooltip section "${sectionId}" in plugin "${pluginId}"`);

        const instance = await this._loadPlugin(pluginId);
        if (typeof instance[sectionDef.method] !== 'function') {
            throw new Error(`Plugin "${pluginId}" does not export method "${sectionDef.method}"`);
        }

        return callWithTimeout(() => instance[sectionDef.method](filePath, pluginMetadata), 3000);
    }

    // --- Thumbnail Generators ---

    /**
     * Run the first registered thumbnail generator for the given file extension.
     * Returns a base64 data URL string or null if no generator handles this ext.
     */
    async generateThumbnail(filePath, ext, options = {}) {
        const generators = this._thumbGeneratorsByExt.get(ext.toLowerCase()) || [];
        for (const { pluginId, generatorId, method } of generators) {
            if (this._disabledPlugins.has(pluginId)) continue;
            try {
                const instance = await this._loadPlugin(pluginId);
                if (typeof instance[method] !== 'function') continue;
                const result = await callWithTimeout(() => instance[method](filePath, options));
                if (result != null) return result;
            } catch (err) {
                console.warn(`[PluginRegistry] Thumbnail generator "${generatorId}" (plugin "${pluginId}") failed:`, err.message);
            }
        }
        return null;
    }

    /**
     * Returns true if any plugin has registered a thumbnail generator for this extension.
     */
    hasCustomThumbnailGenerator(ext) {
        return this._thumbGeneratorsByExt.has(ext.toLowerCase());
    }

    // --- Batch Operations ---

    /**
     * Returns all plugin-contributed batch operations as a flat array.
     */
    getAllBatchOperations() {
        const ops = [];
        for (const [pluginId, batchOps] of this._batchOpsByPlugin) {
            if (this._disabledPlugins.has(pluginId)) continue;
            for (const op of batchOps) {
                ops.push({ ...op, pluginId });
            }
        }
        return ops;
    }

    /**
     * Execute a plugin batch operation on an array of file paths.
     */
    async executeBatchOperation(pluginId, operationId, filePaths, options = {}) {
        const manifest = this._manifests.get(pluginId);
        if (!manifest) throw new Error(`Unknown plugin: ${pluginId}`);

        const caps = manifest.capabilities || {};
        const opDef = (caps.batchOperations || []).find(op => op.id === operationId);
        if (!opDef) throw new Error(`Unknown batch operation "${operationId}" in plugin "${pluginId}"`);

        const instance = await this._loadPlugin(pluginId);
        if (typeof instance[opDef.method] !== 'function') {
            throw new Error(`Plugin "${pluginId}" does not export method "${opDef.method}"`);
        }

        // Batch ops can take longer — use 5 minutes timeout
        return callWithTimeout(() => instance[opDef.method](filePaths, options), 300000);
    }

    // --- Settings Panels ---

    /**
     * Returns all plugin-contributed settings panels as a flat array.
     */
    getAllSettingsPanels() {
        const panels = [];
        for (const [pluginId, panel] of this._settingsPanelsByPlugin) {
            if (this._disabledPlugins.has(pluginId)) continue;
            panels.push({ ...panel, pluginId });
        }
        return panels;
    }

    /**
     * Returns all plugin-contributed lightbox renderers as an object keyed by extension.
     */
    getAllLightboxRenderers() {
        const renderers = {};
        for (const [ext, info] of this._lightboxRenderersByExt) {
            if (this._disabledPlugins.has(info.pluginId)) continue;
            renderers[ext] = info;
        }
        return renderers;
    }

    /**
     * Execute a plugin settings action (load or save).
     */
    async executeSettingsAction(pluginId, action, data) {
        const manifest = this._manifests.get(pluginId);
        if (!manifest) throw new Error(`Unknown plugin: ${pluginId}`);

        const caps = manifest.capabilities || {};
        const panel = caps.settingsPanel;
        if (!panel) throw new Error(`Plugin "${pluginId}" has no settingsPanel capability`);

        const instance = await this._loadPlugin(pluginId);
        const method = action === 'save' ? panel.saveMethod : panel.loadMethod;
        if (!method || typeof instance[method] !== 'function') {
            throw new Error(`Plugin "${pluginId}" does not export settings method "${method}"`);
        }

        return callWithTimeout(() => instance[method](data));
    }

    // --- Install / Remove ---

    /**
     * Validate a plugin manifest in the given directory without registering it.
     * Returns { valid: true, manifest } or { valid: false, error }.
     */
    static validateManifest(dirPath) {
        const manifestPath = path.join(dirPath, 'plugin.json');
        if (!fs.existsSync(manifestPath)) {
            return { valid: false, error: 'No plugin.json found in this folder' };
        }
        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (!manifest.id || typeof manifest.id !== 'string') {
                return { valid: false, error: 'plugin.json missing required "id" field' };
            }
            if (!manifest.main || typeof manifest.main !== 'string') {
                return { valid: false, error: 'plugin.json missing required "main" field' };
            }
            const mainPath = path.resolve(dirPath, manifest.main);
            if (!mainPath.startsWith(dirPath)) {
                return { valid: false, error: 'Plugin "main" path escapes plugin directory' };
            }
            if (!fs.existsSync(mainPath)) {
                return { valid: false, error: `Plugin main file "${manifest.main}" not found` };
            }
            return { valid: true, manifest };
        } catch (err) {
            return { valid: false, error: `Invalid plugin.json: ${err.message}` };
        }
    }

    /**
     * Register a plugin from an already-copied directory. Throws on failure.
     */
    registerFromDirectory(pluginDir) {
        const manifestPath = path.join(pluginDir, 'plugin.json');
        if (!fs.existsSync(manifestPath)) {
            throw new Error('No plugin.json found in directory');
        }
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (!manifest.id || !manifest.main) {
            throw new Error('Invalid plugin.json: missing "id" or "main" field');
        }
        if (this._manifests.has(manifest.id)) {
            throw new Error(`Plugin "${manifest.id}" is already installed`);
        }
        this._registerManifest(manifest, pluginDir);
        this._saveStates();
        return manifest;
    }

    /**
     * Fully unregister a plugin: deactivate, clear caches, remove from all indexes.
     */
    async unregisterPlugin(pluginId) {
        const manifest = this._manifests.get(pluginId);
        if (!manifest) throw new Error(`Unknown plugin: ${pluginId}`);
        if (this._builtinPluginIds.has(pluginId)) {
            throw new Error(`Cannot remove builtin plugin "${pluginId}"`);
        }

        // Deactivate if loaded
        const instance = this._loaded.get(pluginId);
        if (instance && typeof instance.deactivate === 'function') {
            try {
                await Promise.race([
                    instance.deactivate(),
                    new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 3000)),
                ]);
            } catch (err) {
                console.warn(`[PluginRegistry] Plugin "${pluginId}" deactivate error:`, err.message);
            }
        }
        this._loaded.delete(pluginId);

        // Clear require cache
        const mainPath = manifest._mainPath;
        if (mainPath) {
            try { delete require.cache[require.resolve(mainPath)]; } catch { /* not cached */ }
        }

        // Remove from all index maps
        this._manifests.delete(pluginId);
        this._disabledPlugins.delete(pluginId);
        this._pluginOrder = this._pluginOrder.filter(id => id !== pluginId);
        this._contextMenuItemsByPlugin.delete(pluginId);
        this._infoSectionsByPlugin.delete(pluginId);
        this._tooltipSectionsByPlugin.delete(pluginId);
        this._batchOpsByPlugin.delete(pluginId);
        this._settingsPanelsByPlugin.delete(pluginId);

        // Clean extractor index
        for (const [ext, extractors] of this._extractorsByExt) {
            const filtered = extractors.filter(e => e.pluginId !== pluginId);
            if (filtered.length === 0) this._extractorsByExt.delete(ext);
            else this._extractorsByExt.set(ext, filtered);
        }

        // Clean thumbnail generator index
        for (const [ext, generators] of this._thumbGeneratorsByExt) {
            const filtered = generators.filter(g => g.pluginId !== pluginId);
            if (filtered.length === 0) this._thumbGeneratorsByExt.delete(ext);
            else this._thumbGeneratorsByExt.set(ext, filtered);
        }

        // Rebuild extra extension sets from remaining manifests
        this._extraVideoExtensions.clear();
        this._extraImageExtensions.clear();
        for (const [, m] of this._manifests) {
            const ft = (m.capabilities || {}).fileTypes;
            if (ft) {
                for (const ext of (ft.extensions || [])) {
                    if (ft.category === 'video') this._extraVideoExtensions.add(ext.toLowerCase());
                    else this._extraImageExtensions.add(ext.toLowerCase());
                }
            }
        }

        this._saveStates();
        console.log(`[PluginRegistry] Unregistered plugin: ${pluginId}`);
    }

    /** Returns the filesystem directory for a plugin, or null. */
    getPluginDir(pluginId) {
        const manifest = this._manifests.get(pluginId);
        return manifest ? manifest._dir : null;
    }

    /** Returns true if the plugin was discovered from a builtin directory. */
    isBuiltin(pluginId) {
        return this._builtinPluginIds.has(pluginId);
    }

    // --- Plugin Ordering ---

    /** Returns a copy of the global plugin order array. */
    getPluginOrder() {
        return [...this._pluginOrder];
    }

    /** Set the global plugin order. Re-sorts handler arrays and persists. */
    setPluginOrder(newOrder) {
        if (!Array.isArray(newOrder)) throw new Error('Plugin order must be an array');
        this._pluginOrder = newOrder.filter(id => typeof id === 'string');
        this._sortHandlersByOrder();
        this._saveStates();
    }

    // --- Teardown ---

    async teardown() {
        const timeout = (ms) => new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms));
        for (const [pluginId, instance] of this._loaded) {
            if (typeof instance.deactivate === 'function') {
                try {
                    await Promise.race([instance.deactivate(), timeout(3000)]);
                } catch (err) {
                    console.warn(`[PluginRegistry] Plugin "${pluginId}" deactivate error:`, err.message);
                }
            }
        }
        this._loaded.clear();
    }

    /**
     * Reload all plugins: teardown loaded instances, clear indexes, re-discover.
     * User enable/disable preferences are preserved.
     * @param {Array<{dir: string, builtin?: boolean}>} pluginDirs
     * @returns {number} count of discovered plugins
     */
    async reload(pluginDirs) {
        // Teardown loaded plugins
        await this.teardown();

        // Clear require cache for all previously loaded modules
        for (const [, manifest] of this._manifests) {
            try { delete require.cache[require.resolve(manifest._mainPath)]; } catch { /* ignore */ }
        }

        // Save order before clearing (preserve user prefs across reload)
        const savedOrder = [...this._pluginOrder];

        // Clear all indexes (preserve _disabledPlugins for user prefs)
        this._manifests.clear();
        this._extractorsByExt.clear();
        this._contextMenuItemsByPlugin.clear();
        this._extraVideoExtensions.clear();
        this._extraImageExtensions.clear();
        this._infoSectionsByPlugin.clear();
        this._tooltipSectionsByPlugin.clear();
        this._thumbGeneratorsByExt.clear();
        this._batchOpsByPlugin.clear();
        this._settingsPanelsByPlugin.clear();
        this._builtinPluginIds.clear();
        this._pluginOrder = savedOrder;

        // Re-discover (will append new plugins to _pluginOrder)
        for (const entry of pluginDirs) {
            this.discover(entry.dir, { builtin: !!entry.builtin });
        }

        // Prune order entries for plugins that no longer exist
        this._pluginOrder = this._pluginOrder.filter(id => this._manifests.has(id));
        this._sortHandlersByOrder();

        return this._manifests.size;
    }
}

module.exports = PluginRegistry;
