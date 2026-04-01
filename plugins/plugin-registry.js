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
    constructor(cacheBaseDir) {
        this._cacheBaseDir = cacheBaseDir;
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
        return Array.from(this._manifests.values()).map(({ _dir, _mainPath, ...rest }) => rest);
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
