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
        // Set of disabled plugin IDs — loaded from statesFilePath on startup
        this._disabledPlugins = new Set();
        if (statesFilePath && fs.existsSync(statesFilePath)) {
            try {
                const states = JSON.parse(fs.readFileSync(statesFilePath, 'utf8'));
                for (const [id, enabled] of Object.entries(states)) {
                    if (enabled === false) this._disabledPlugins.add(id);
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
            const states = {};
            for (const [id] of this._manifests) {
                states[id] = !this._disabledPlugins.has(id);
            }
            fs.mkdirSync(path.dirname(this._statesFilePath), { recursive: true });
            fs.writeFileSync(this._statesFilePath, JSON.stringify(states, null, 2));
        } catch (err) {
            console.warn('[PluginRegistry] Could not save plugin states:', err.message);
        }
    }

    /**
     * Discover and register plugins from a directory (non-recursive, one plugin per subdir).
     * Safe to call multiple times with different directories.
     */
    discover(pluginsDir) {
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

        // Index file type extensions
        if (capabilities.fileTypes) {
            const { extensions = [], category } = capabilities.fileTypes;
            for (const ext of extensions) {
                if (category === 'video') this._extraVideoExtensions.add(ext.toLowerCase());
                else this._extraImageExtensions.add(ext.toLowerCase());
            }
        }

        // Index info sections (plugin-contributed file info panel sections)
        if (Array.isArray(capabilities.infoSections) && capabilities.infoSections.length > 0) {
            this._infoSectionsByPlugin.set(id, capabilities.infoSections);
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

        console.log(`[PluginRegistry] Registered plugin: ${id}`);
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
        return Array.from(this._manifests.values()).map(({ _dir, _mainPath, id, ...rest }) => ({
            ...rest,
            id,
            enabled: !this._disabledPlugins.has(id),
        }));
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
}

module.exports = PluginRegistry;
