'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const PluginRegistry = require('../plugins/plugin-registry');

// ── Helpers ──────────────────────────────────────────────────────────

let tmpDirs = [];

function makeTmpDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-test-'));
    tmpDirs.push(dir);
    return dir;
}

/**
 * Write a minimal valid plugin to a temporary directory.
 * Returns the plugin directory path.
 */
function writePlugin(parentDir, id, manifest = {}, entryCode = '') {
    const pluginDir = path.join(parentDir, id);
    fs.mkdirSync(pluginDir, { recursive: true });

    const fullManifest = { id, main: 'index.js', name: id, ...manifest };
    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify(fullManifest));

    const defaultCode = `
        module.exports.activate = (api) => module.exports;
        module.exports.deactivate = () => {};
    `;
    fs.writeFileSync(path.join(pluginDir, 'index.js'), entryCode || defaultCode);
    return pluginDir;
}

afterEach(() => {
    for (const dir of tmpDirs) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    tmpDirs = [];
});

// ── Constructor ──────────────────────────────────────────────────────

describe('PluginRegistry constructor', () => {
    it('creates an empty registry with no state file', () => {
        const reg = new PluginRegistry(makeTmpDir());
        expect(reg.getPluginStates()).toEqual({});
        expect(reg.getPluginOrder()).toEqual([]);
    });

    it('loads new-format state file (states + order)', () => {
        const tmp = makeTmpDir();
        const sf = path.join(tmp, 'states.json');
        fs.writeFileSync(sf, JSON.stringify({
            states: { 'plugin-a': true, 'plugin-b': false },
            order: ['plugin-b', 'plugin-a'],
        }));

        const reg = new PluginRegistry(tmp, sf);
        expect(reg._disabledPlugins.has('plugin-b')).toBe(true);
        expect(reg._disabledPlugins.has('plugin-a')).toBe(false);
        expect(reg.getPluginOrder()).toEqual(['plugin-b', 'plugin-a']);
    });

    it('loads old-format state file (flat { id: bool })', () => {
        const tmp = makeTmpDir();
        const sf = path.join(tmp, 'states.json');
        fs.writeFileSync(sf, JSON.stringify({ 'old-plugin': false, 'enabled-one': true }));

        const reg = new PluginRegistry(tmp, sf);
        expect(reg._disabledPlugins.has('old-plugin')).toBe(true);
        expect(reg._disabledPlugins.has('enabled-one')).toBe(false);
        // Old format has no order
        expect(reg.getPluginOrder()).toEqual([]);
    });

    it('handles missing state file gracefully', () => {
        const tmp = makeTmpDir();
        const sf = path.join(tmp, 'nonexistent.json');
        const reg = new PluginRegistry(tmp, sf);
        expect(reg.getPluginStates()).toEqual({});
    });

    it('handles corrupt state file gracefully', () => {
        const tmp = makeTmpDir();
        const sf = path.join(tmp, 'states.json');
        fs.writeFileSync(sf, '{{NOT JSON!!');

        const reg = new PluginRegistry(tmp, sf);
        expect(reg._disabledPlugins.size).toBe(0);
    });

    it('ignores non-object values in old format (array)', () => {
        const tmp = makeTmpDir();
        const sf = path.join(tmp, 'states.json');
        fs.writeFileSync(sf, JSON.stringify(['not', 'an', 'object']));

        const reg = new PluginRegistry(tmp, sf);
        expect(reg._disabledPlugins.size).toBe(0);
    });

    it('uses empty order when new-format has no order array', () => {
        const tmp = makeTmpDir();
        const sf = path.join(tmp, 'states.json');
        fs.writeFileSync(sf, JSON.stringify({ states: { 'p': true } }));

        const reg = new PluginRegistry(tmp, sf);
        expect(reg.getPluginOrder()).toEqual([]);
    });

    it('defaults statesFilePath to null', () => {
        const reg = new PluginRegistry(makeTmpDir());
        expect(reg._statesFilePath).toBeNull();
    });
});

// ── discover() ───────────────────────────────────────────────────────

describe('discover()', () => {
    it('discovers plugins from a directory', () => {
        const tmp = makeTmpDir();
        writePlugin(tmp, 'alpha');
        writePlugin(tmp, 'beta');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(tmp);

        const states = reg.getPluginStates();
        expect(Object.keys(states)).toHaveLength(2);
        expect(states.alpha).toBe(true);
        expect(states.beta).toBe(true);
    });

    it('skips non-directory entries', () => {
        const tmp = makeTmpDir();
        writePlugin(tmp, 'real-plugin');
        fs.writeFileSync(path.join(tmp, 'not-a-dir.txt'), 'hello');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(tmp);
        expect(Object.keys(reg.getPluginStates())).toEqual(['real-plugin']);
    });

    it('skips directories without plugin.json', () => {
        const tmp = makeTmpDir();
        writePlugin(tmp, 'valid');
        fs.mkdirSync(path.join(tmp, 'empty-dir'));

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(tmp);
        expect(Object.keys(reg.getPluginStates())).toEqual(['valid']);
    });

    it('skips plugins with missing id', () => {
        const tmp = makeTmpDir();
        const dir = path.join(tmp, 'bad-plugin');
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ main: 'index.js' }));
        fs.writeFileSync(path.join(dir, 'index.js'), '');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(tmp);
        expect(Object.keys(reg.getPluginStates())).toHaveLength(0);
    });

    it('skips plugins with missing main', () => {
        const tmp = makeTmpDir();
        const dir = path.join(tmp, 'bad-plugin');
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ id: 'bad' }));

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(tmp);
        expect(Object.keys(reg.getPluginStates())).toHaveLength(0);
    });

    it('rejects path traversal in main field', () => {
        const tmp = makeTmpDir();
        const dir = path.join(tmp, 'evil');
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({
            id: 'evil',
            main: '../../etc/passwd',
        }));

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(tmp);
        expect(Object.keys(reg.getPluginStates())).toHaveLength(0);
    });

    it('marks plugins as builtin when option is set', () => {
        const tmp = makeTmpDir();
        writePlugin(tmp, 'core-plugin');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(tmp, { builtin: true });
        expect(reg.isBuiltin('core-plugin')).toBe(true);
    });

    it('does not mark plugins as builtin by default', () => {
        const tmp = makeTmpDir();
        writePlugin(tmp, 'user-plugin');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(tmp);
        expect(reg.isBuiltin('user-plugin')).toBe(false);
    });

    it('handles nonexistent plugins directory', () => {
        const reg = new PluginRegistry(makeTmpDir());
        reg.discover('/path/that/does/not/exist');
        expect(Object.keys(reg.getPluginStates())).toHaveLength(0);
    });

    it('can be called multiple times with different directories', () => {
        const dir1 = makeTmpDir();
        const dir2 = makeTmpDir();
        writePlugin(dir1, 'plug-a');
        writePlugin(dir2, 'plug-b');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(dir1);
        reg.discover(dir2);
        expect(Object.keys(reg.getPluginStates())).toHaveLength(2);
    });

    it('handles corrupt plugin.json gracefully', () => {
        const tmp = makeTmpDir();
        const dir = path.join(tmp, 'broken');
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, 'plugin.json'), '{{{{invalid');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(tmp);
        expect(Object.keys(reg.getPluginStates())).toHaveLength(0);
    });
});

// ── Enable / Disable ─────────────────────────────────────────────────

describe('Enable / Disable', () => {
    it('setPluginEnabled(id, false) disables a plugin', () => {
        const tmp = makeTmpDir();
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'my-plugin');

        const sf = path.join(tmp, 'states.json');
        const reg = new PluginRegistry(tmp, sf);
        reg.discover(pluginsDir);

        reg.setPluginEnabled('my-plugin', false);
        expect(reg.getPluginStates()['my-plugin']).toBe(false);
    });

    it('setPluginEnabled(id, true) re-enables a plugin', () => {
        const tmp = makeTmpDir();
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'my-plugin');

        const sf = path.join(tmp, 'states.json');
        const reg = new PluginRegistry(tmp, sf);
        reg.discover(pluginsDir);

        reg.setPluginEnabled('my-plugin', false);
        reg.setPluginEnabled('my-plugin', true);
        expect(reg.getPluginStates()['my-plugin']).toBe(true);
    });

    it('getPluginStates returns all registered plugins with enabled status', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'a');
        writePlugin(pluginsDir, 'b');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        reg.setPluginEnabled('b', false);

        const states = reg.getPluginStates();
        expect(states).toEqual({ a: true, b: false });
    });

    it('_saveStates persists states and order to disk', () => {
        const tmp = makeTmpDir();
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'x');
        writePlugin(pluginsDir, 'y');

        const sf = path.join(tmp, 'states.json');
        const reg = new PluginRegistry(tmp, sf);
        reg.discover(pluginsDir);
        reg.setPluginEnabled('y', false);

        const saved = JSON.parse(fs.readFileSync(sf, 'utf8'));
        expect(saved.states.x).toBe(true);
        expect(saved.states.y).toBe(false);
        expect(Array.isArray(saved.order)).toBe(true);
    });

    it('_saveStates creates parent directories if needed', () => {
        const tmp = makeTmpDir();
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'p');

        const sf = path.join(tmp, 'nested', 'deep', 'states.json');
        const reg = new PluginRegistry(tmp, sf);
        reg.discover(pluginsDir);
        reg.setPluginEnabled('p', false);

        expect(fs.existsSync(sf)).toBe(true);
    });

    it('_saveStates is a no-op when statesFilePath is null', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'p');

        const reg = new PluginRegistry(makeTmpDir(), null);
        reg.discover(pluginsDir);
        // Should not throw
        reg.setPluginEnabled('p', false);
    });

    it('_saveStates writes order array matching current plugin order', () => {
        const tmp = makeTmpDir();
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'first');
        writePlugin(pluginsDir, 'second');

        const sf = path.join(tmp, 'states.json');
        const reg = new PluginRegistry(tmp, sf);
        reg.discover(pluginsDir);
        reg.setPluginOrder(['second', 'first']);

        const saved = JSON.parse(fs.readFileSync(sf, 'utf8'));
        expect(saved.order).toEqual(['second', 'first']);
    });
});

// ── Extension sets ───────────────────────────────────────────────────

describe('Extension sets', () => {
    it('getVideoExtensions returns base set without plugins', () => {
        const reg = new PluginRegistry(makeTmpDir());
        const exts = reg.getVideoExtensions();
        expect(exts.has('.mp4')).toBe(true);
        expect(exts.has('.webm')).toBe(true);
        expect(exts.has('.ogg')).toBe(true);
        expect(exts.has('.mov')).toBe(true);
    });

    it('getImageExtensions returns base set without plugins', () => {
        const reg = new PluginRegistry(makeTmpDir());
        const exts = reg.getImageExtensions();
        expect(exts.has('.jpg')).toBe(true);
        expect(exts.has('.jpeg')).toBe(true);
        expect(exts.has('.png')).toBe(true);
        expect(exts.has('.gif')).toBe(true);
        expect(exts.has('.webp')).toBe(true);
        expect(exts.has('.bmp')).toBe(true);
        expect(exts.has('.svg')).toBe(true);
    });

    it('getVideoExtensions includes plugin-contributed extensions', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'mkv-support', {
            capabilities: { fileTypes: { extensions: ['.mkv', '.avi'], category: 'video' } },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        const exts = reg.getVideoExtensions();
        expect(exts.has('.mkv')).toBe(true);
        expect(exts.has('.avi')).toBe(true);
        expect(exts.has('.mp4')).toBe(true); // base still present
    });

    it('getImageExtensions includes plugin-contributed extensions', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'psd-support', {
            capabilities: { fileTypes: { extensions: ['.psd'], category: 'image' } },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        const exts = reg.getImageExtensions();
        expect(exts.has('.psd')).toBe(true);
        expect(exts.has('.jpg')).toBe(true);
    });

    it('getSupportedExtensions includes all video and image extensions', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'both', {
            capabilities: {
                fileTypes: [
                    { extensions: ['.mkv'], category: 'video' },
                    { extensions: ['.psd'], category: 'image' },
                ],
            },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        const exts = reg.getSupportedExtensions();
        expect(exts.has('.mkv')).toBe(true);
        expect(exts.has('.psd')).toBe(true);
        expect(exts.has('.mp4')).toBe(true);
        expect(exts.has('.png')).toBe(true);
    });

    it('file type extensions are lowercased', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'upper', {
            capabilities: { fileTypes: { extensions: ['.MKV', '.AVI'], category: 'video' } },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        expect(reg.getVideoExtensions().has('.mkv')).toBe(true);
        expect(reg.getVideoExtensions().has('.avi')).toBe(true);
    });
});

// ── getManifests ─────────────────────────────────────────────────────

describe('getManifests()', () => {
    it('returns manifests sorted by plugin order', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'charlie');
        writePlugin(pluginsDir, 'alpha');
        writePlugin(pluginsDir, 'bravo');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        reg.setPluginOrder(['bravo', 'alpha', 'charlie']);

        const manifests = reg.getManifests();
        expect(manifests.map(m => m.id)).toEqual(['bravo', 'alpha', 'charlie']);
    });

    it('includes enabled and builtin flags', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'core-p');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir, { builtin: true });
        reg.setPluginEnabled('core-p', false);

        const manifests = reg.getManifests();
        expect(manifests[0].enabled).toBe(false);
        expect(manifests[0].builtin).toBe(true);
    });

    it('strips _dir and _mainPath from manifests', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'strip-test');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const manifests = reg.getManifests();
        expect(manifests[0]._dir).toBeUndefined();
        expect(manifests[0]._mainPath).toBeUndefined();
    });

    it('returns empty array when no plugins registered', () => {
        const reg = new PluginRegistry(makeTmpDir());
        expect(reg.getManifests()).toEqual([]);
    });

    it('preserves manifest properties like name and capabilities', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'rich', {
            name: 'Rich Plugin',
            version: '2.0.0',
            capabilities: { fileTypes: { extensions: ['.xyz'], category: 'image' } },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const m = reg.getManifests()[0];
        expect(m.name).toBe('Rich Plugin');
        expect(m.version).toBe('2.0.0');
        expect(m.capabilities).toBeDefined();
    });
});

// ── validateManifest (static) ────────────────────────────────────────

describe('validateManifest (static)', () => {
    it('returns invalid when no plugin.json exists', () => {
        const dir = makeTmpDir();
        const result = PluginRegistry.validateManifest(dir);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/No plugin\.json/);
    });

    it('returns invalid when id is missing', () => {
        const dir = makeTmpDir();
        fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ main: 'index.js' }));
        fs.writeFileSync(path.join(dir, 'index.js'), '');

        const result = PluginRegistry.validateManifest(dir);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/missing.*"id"/i);
    });

    it('returns invalid when main is missing', () => {
        const dir = makeTmpDir();
        fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ id: 'test' }));

        const result = PluginRegistry.validateManifest(dir);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/missing.*"main"/i);
    });

    it('returns invalid when main path escapes directory', () => {
        const dir = makeTmpDir();
        fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({
            id: 'evil',
            main: '../../outside.js',
        }));

        const result = PluginRegistry.validateManifest(dir);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/escapes/i);
    });

    it('returns invalid when main file does not exist', () => {
        const dir = makeTmpDir();
        fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({
            id: 'test',
            main: 'missing.js',
        }));

        const result = PluginRegistry.validateManifest(dir);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/not found/i);
    });

    it('returns invalid for corrupt JSON', () => {
        const dir = makeTmpDir();
        fs.writeFileSync(path.join(dir, 'plugin.json'), '{not valid json!!');

        const result = PluginRegistry.validateManifest(dir);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/Invalid plugin\.json/i);
    });

    it('returns valid for correct plugin', () => {
        const dir = makeTmpDir();
        fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({
            id: 'valid-plugin',
            main: 'index.js',
            name: 'Valid Plugin',
        }));
        fs.writeFileSync(path.join(dir, 'index.js'), '');

        const result = PluginRegistry.validateManifest(dir);
        expect(result.valid).toBe(true);
        expect(result.manifest.id).toBe('valid-plugin');
    });

    it('returns invalid when id is not a string', () => {
        const dir = makeTmpDir();
        fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({
            id: 42,
            main: 'index.js',
        }));
        fs.writeFileSync(path.join(dir, 'index.js'), '');

        const result = PluginRegistry.validateManifest(dir);
        expect(result.valid).toBe(false);
    });

    it('returns invalid when main is not a string', () => {
        const dir = makeTmpDir();
        fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({
            id: 'test',
            main: 123,
        }));

        const result = PluginRegistry.validateManifest(dir);
        expect(result.valid).toBe(false);
    });
});

// ── registerFromDirectory / unregisterPlugin ─────────────────────────

describe('registerFromDirectory / unregisterPlugin', () => {
    it('registerFromDirectory registers a plugin and saves state', () => {
        const tmp = makeTmpDir();
        const pluginsDir = makeTmpDir();
        const pluginDir = writePlugin(pluginsDir, 'installed');

        const sf = path.join(tmp, 'states.json');
        const reg = new PluginRegistry(tmp, sf);
        const manifest = reg.registerFromDirectory(pluginDir);

        expect(manifest.id).toBe('installed');
        expect(reg.getPluginStates().installed).toBe(true);
        expect(fs.existsSync(sf)).toBe(true);
    });

    it('registerFromDirectory throws for duplicate plugin', () => {
        const pluginsDir = makeTmpDir();
        const pluginDir = writePlugin(pluginsDir, 'dup');

        const reg = new PluginRegistry(makeTmpDir());
        reg.registerFromDirectory(pluginDir);

        expect(() => reg.registerFromDirectory(pluginDir)).toThrow('already installed');
    });

    it('registerFromDirectory throws for missing plugin.json', () => {
        const dir = makeTmpDir();
        const reg = new PluginRegistry(makeTmpDir());
        expect(() => reg.registerFromDirectory(dir)).toThrow('No plugin.json');
    });

    it('registerFromDirectory throws for invalid manifest', () => {
        const dir = makeTmpDir();
        fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify({ id: 'x' }));

        const reg = new PluginRegistry(makeTmpDir());
        expect(() => reg.registerFromDirectory(dir)).toThrow(/missing.*"id".*or.*"main"/i);
    });

    it('registerFromDirectory adds plugin to order', () => {
        const pluginsDir = makeTmpDir();
        const pluginDir = writePlugin(pluginsDir, 'ordered');

        const reg = new PluginRegistry(makeTmpDir());
        reg.registerFromDirectory(pluginDir);

        expect(reg.getPluginOrder()).toContain('ordered');
    });

    it('unregisterPlugin removes from all indexes', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'removeme', {
            capabilities: {
                metadataExtractors: [{ id: 'ext1', method: 'm', extensions: ['.rm'] }],
                contextMenuItems: [{ id: 'ctx1', label: 'X', method: 'm' }],
                tooltipSections: [{ id: 'tip1', label: 'T', method: 'm' }],
                infoSections: [{ id: 'inf1', label: 'I', method: 'm' }],
                batchOperations: [{ id: 'bat1', label: 'B', method: 'm' }],
                settingsPanel: { title: 'S', loadMethod: 'l', saveMethod: 's' },
                thumbnailGenerators: [{ id: 'tg1', method: 'm', extensions: ['.rm'] }],
            },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        await reg.unregisterPlugin('removeme');

        expect(reg._manifests.has('removeme')).toBe(false);
        expect(reg._contextMenuItemsByPlugin.has('removeme')).toBe(false);
        expect(reg._tooltipSectionsByPlugin.has('removeme')).toBe(false);
        expect(reg._infoSectionsByPlugin.has('removeme')).toBe(false);
        expect(reg._batchOpsByPlugin.has('removeme')).toBe(false);
        expect(reg._settingsPanelsByPlugin.has('removeme')).toBe(false);
        expect(reg._extractorsByExt.has('.rm')).toBe(false);
        expect(reg._thumbGeneratorsByExt.has('.rm')).toBe(false);
        expect(reg.getPluginOrder()).not.toContain('removeme');
    });

    it('unregisterPlugin throws for builtin plugin', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'core');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir, { builtin: true });

        await expect(reg.unregisterPlugin('core')).rejects.toThrow('builtin');
    });

    it('unregisterPlugin throws for unknown plugin', async () => {
        const reg = new PluginRegistry(makeTmpDir());
        await expect(reg.unregisterPlugin('nope')).rejects.toThrow('Unknown plugin');
    });

    it('unregisterPlugin calls deactivate on loaded plugin', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'deact-test', {
            capabilities: {
                metadataExtractors: [{ id: 'x', method: 'extract', extensions: ['.x'] }],
            },
        }, `
            module.exports.activate = () => module.exports;
            module.exports.extract = () => ({});
            module.exports.deactivate = () => { global.__deactTestCalled = true; };
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        // Force the plugin to load
        await reg.extractMetadata('/f.x', '.x');

        await reg.unregisterPlugin('deact-test');
        expect(global.__deactTestCalled).toBe(true);
        delete global.__deactTestCalled;
    });

    it('unregisterPlugin rebuilds extra extension sets from remaining plugins', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'keep', {
            capabilities: { fileTypes: { extensions: ['.keep'], category: 'image' } },
        });
        writePlugin(pluginsDir, 'remove', {
            capabilities: { fileTypes: { extensions: ['.gone'], category: 'video' } },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        expect(reg._extraVideoExtensions.has('.gone')).toBe(true);
        await reg.unregisterPlugin('remove');
        expect(reg._extraVideoExtensions.has('.gone')).toBe(false);
        expect(reg._extraImageExtensions.has('.keep')).toBe(true);
    });

    it('unregisterPlugin clears disabled state', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'dis-unreg');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        reg.setPluginEnabled('dis-unreg', false);
        expect(reg._disabledPlugins.has('dis-unreg')).toBe(true);

        await reg.unregisterPlugin('dis-unreg');
        expect(reg._disabledPlugins.has('dis-unreg')).toBe(false);
    });
});

// ── Extension indexing ───────────────────────────────────────────────

describe('Extension indexing', () => {
    it('indexes metadata extractors by extension', () => {
        const tmp = makeTmpDir();
        writePlugin(tmp, 'meta-ext', {
            capabilities: {
                metadataExtractors: [
                    { id: 'psd-meta', method: 'extractPsd', extensions: ['.psd'] },
                ],
            },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(tmp);
        expect(reg._extractorsByExt.has('.psd')).toBe(true);
        expect(reg._extractorsByExt.get('.psd')[0].pluginId).toBe('meta-ext');
    });

    it('indexes context menu items by plugin', () => {
        const tmp = makeTmpDir();
        writePlugin(tmp, 'ctx-plugin', {
            capabilities: {
                contextMenuItems: [
                    { id: 'convert', label: 'Convert', method: 'convert' },
                ],
            },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(tmp);
        expect(reg._contextMenuItemsByPlugin.has('ctx-plugin')).toBe(true);
    });

    it('indexes thumbnail generators', () => {
        const tmp = makeTmpDir();
        writePlugin(tmp, 'thumb-gen', {
            capabilities: {
                thumbnailGenerators: [
                    { id: 'psd-thumb', method: 'genThumb', extensions: ['.psd'] },
                ],
            },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(tmp);
        expect(reg._thumbGeneratorsByExt.has('.psd')).toBe(true);
        expect(reg.hasCustomThumbnailGenerator('.psd')).toBe(true);
        expect(reg.hasCustomThumbnailGenerator('.xyz')).toBe(false);
    });

    it('indexes lightbox renderers with default mode and null mimeType', () => {
        const tmp = makeTmpDir();
        writePlugin(tmp, 'lb-defaults', {
            capabilities: {
                lightboxRenderers: [
                    { id: 'r', extensions: ['.abc'] },
                ],
            },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(tmp);
        const entry = reg._lightboxRenderersByExt.get('.abc');
        expect(entry.mode).toBe('image');
        expect(entry.mimeType).toBeNull();
    });

    it('indexes settings panels', () => {
        const tmp = makeTmpDir();
        writePlugin(tmp, 'sp-plugin', {
            capabilities: {
                settingsPanel: { title: 'Settings', loadMethod: 'loadSettings', saveMethod: 'saveSettings' },
            },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(tmp);
        expect(reg._settingsPanelsByPlugin.has('sp-plugin')).toBe(true);
    });

    it('indexes info sections', () => {
        const tmp = makeTmpDir();
        writePlugin(tmp, 'info-plugin', {
            capabilities: {
                infoSections: [
                    { id: 'psd-info', label: 'PSD Info', method: 'renderInfo' },
                ],
            },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(tmp);
        expect(reg._infoSectionsByPlugin.has('info-plugin')).toBe(true);
    });

    it('indexes tooltip sections', () => {
        const tmp = makeTmpDir();
        writePlugin(tmp, 'tooltip-plugin', {
            capabilities: {
                tooltipSections: [
                    { id: 'psd-tip', label: 'PSD Tooltip', method: 'renderTooltip' },
                ],
            },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(tmp);
        expect(reg._tooltipSectionsByPlugin.has('tooltip-plugin')).toBe(true);
    });
});

// ── Metadata extraction ──────────────────────────────────────────────

describe('Metadata extraction', () => {
    it('extractMetadata calls the correct plugin method', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'meta-p', {
            capabilities: {
                metadataExtractors: [
                    { id: 'psd-meta', method: 'extractPsd', extensions: ['.psd'] },
                ],
            },
        }, `
            module.exports.activate = () => module.exports;
            module.exports.extractPsd = (filePath) => ({ layers: 5, path: filePath });
            module.exports.deactivate = () => {};
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const result = await reg.extractMetadata('/fake/file.psd', '.psd');
        expect(result['psd-meta']).toEqual({ layers: 5, path: '/fake/file.psd' });
    });

    it('extractMetadata skips disabled plugins', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'meta-d', {
            capabilities: {
                metadataExtractors: [
                    { id: 'ext-meta', method: 'doExtract', extensions: ['.psd'] },
                ],
            },
        }, `
            module.exports.activate = () => module.exports;
            module.exports.doExtract = () => ({ data: 'should not appear' });
            module.exports.deactivate = () => {};
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        reg.setPluginEnabled('meta-d', false);

        const result = await reg.extractMetadata('/fake/file.psd', '.psd');
        expect(result).toEqual({});
    });

    it('extractMetadata returns empty object for unregistered extension', async () => {
        const reg = new PluginRegistry(makeTmpDir());
        const result = await reg.extractMetadata('/fake/file.xyz', '.xyz');
        expect(result).toEqual({});
    });

    it('extractMetadata handles plugin method that returns null', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'null-meta', {
            capabilities: {
                metadataExtractors: [
                    { id: 'null-ext', method: 'extract', extensions: ['.abc'] },
                ],
            },
        }, `
            module.exports.activate = () => module.exports;
            module.exports.extract = () => null;
            module.exports.deactivate = () => {};
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const result = await reg.extractMetadata('/fake/file.abc', '.abc');
        expect(result).toEqual({});
    });

    it('extractMetadata handles plugin method that throws', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'err-meta', {
            capabilities: {
                metadataExtractors: [
                    { id: 'err-ext', method: 'extract', extensions: ['.err'] },
                ],
            },
        }, `
            module.exports.activate = () => module.exports;
            module.exports.extract = () => { throw new Error('boom'); };
            module.exports.deactivate = () => {};
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const result = await reg.extractMetadata('/fake/file.err', '.err');
        expect(result).toEqual({});
    });

    it('extractMetadata is case-insensitive for extensions', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'case-meta', {
            capabilities: {
                metadataExtractors: [
                    { id: 'cm', method: 'extract', extensions: ['.PSD'] },
                ],
            },
        }, `
            module.exports.activate = () => module.exports;
            module.exports.extract = () => ({ found: true });
            module.exports.deactivate = () => {};
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const result = await reg.extractMetadata('/f.psd', '.psd');
        expect(result.cm).toEqual({ found: true });
    });
});

// ── executeAction ────────────────────────────────────────────────────

describe('executeAction', () => {
    it('throws for unknown plugin', async () => {
        const reg = new PluginRegistry(makeTmpDir());
        await expect(reg.executeAction('nope', 'act', '/f', {})).rejects.toThrow('Unknown plugin');
    });

    it('throws for unknown action ID', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'act-plugin', {
            capabilities: {
                contextMenuItems: [{ id: 'known', label: 'Known', method: 'doKnown' }],
            },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        await expect(reg.executeAction('act-plugin', 'unknown-action', '/f', {}))
            .rejects.toThrow('Unknown action');
    });

    it('executes a valid action', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'act-ok', {
            capabilities: {
                contextMenuItems: [{ id: 'my-act', label: 'My Action', method: 'runAction' }],
            },
        }, `
            module.exports.activate = () => module.exports;
            module.exports.runAction = (fp, meta) => ({ ran: true, file: fp });
            module.exports.deactivate = () => {};
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        const result = await reg.executeAction('act-ok', 'my-act', '/test/file.png', {});
        expect(result).toEqual({ ran: true, file: '/test/file.png' });
    });

    it('throws when plugin does not export the method', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'no-method', {
            capabilities: {
                contextMenuItems: [{ id: 'act', label: 'Act', method: 'missingMethod' }],
            },
        }, `
            module.exports.activate = () => module.exports;
            module.exports.deactivate = () => {};
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        await expect(reg.executeAction('no-method', 'act', '/f', {}))
            .rejects.toThrow(/does not export method/);
    });
});

// ── Ordering ─────────────────────────────────────────────────────────

describe('Ordering', () => {
    it('setPluginOrder sets the order', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'a');
        writePlugin(pluginsDir, 'b');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        reg.setPluginOrder(['b', 'a']);

        expect(reg.getPluginOrder()).toEqual(['b', 'a']);
    });

    it('setPluginOrder persists to disk', () => {
        const tmp = makeTmpDir();
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'a');
        writePlugin(pluginsDir, 'b');

        const sf = path.join(tmp, 'states.json');
        const reg = new PluginRegistry(tmp, sf);
        reg.discover(pluginsDir);
        reg.setPluginOrder(['b', 'a']);

        const saved = JSON.parse(fs.readFileSync(sf, 'utf8'));
        expect(saved.order).toEqual(['b', 'a']);
    });

    it('getPluginOrder returns a copy (not the internal array)', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'p');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const order = reg.getPluginOrder();
        order.push('injected');
        expect(reg.getPluginOrder()).not.toContain('injected');
    });

    it('setPluginOrder throws for non-array input', () => {
        const reg = new PluginRegistry(makeTmpDir());
        expect(() => reg.setPluginOrder('not an array')).toThrow('array');
    });

    it('setPluginOrder filters out non-string entries', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'x');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        reg.setPluginOrder(['x', 42, null, 'y']);

        expect(reg.getPluginOrder()).toEqual(['x', 'y']);
    });

    it('new plugins are appended to order on discover', () => {
        const dir1 = makeTmpDir();
        const dir2 = makeTmpDir();
        writePlugin(dir1, 'first');
        writePlugin(dir2, 'second');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(dir1);
        reg.discover(dir2);

        const order = reg.getPluginOrder();
        expect(order.indexOf('first')).toBeLessThan(order.indexOf('second'));
    });

    it('setPluginOrder re-sorts handler arrays', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'pa', {
            capabilities: {
                metadataExtractors: [{ id: 'ea', method: 'm', extensions: ['.x'] }],
            },
        });
        writePlugin(pluginsDir, 'pb', {
            capabilities: {
                metadataExtractors: [{ id: 'eb', method: 'm', extensions: ['.x'] }],
            },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        reg.setPluginOrder(['pb', 'pa']);
        const extractors = reg._extractorsByExt.get('.x');
        expect(extractors[0].pluginId).toBe('pb');
        expect(extractors[1].pluginId).toBe('pa');
    });
});

// ── Context menu / info / tooltip / batch / settings / lightbox ──────

describe('getAllContextMenuItems', () => {
    it('returns items from enabled plugins with pluginId', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'cm', {
            capabilities: {
                contextMenuItems: [
                    { id: 'act1', label: 'Action 1', method: 'do1' },
                    { id: 'act2', label: 'Action 2', method: 'do2' },
                ],
            },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const items = reg.getAllContextMenuItems();
        expect(items).toHaveLength(2);
        expect(items[0].pluginId).toBe('cm');
    });

    it('excludes items from disabled plugins', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'disabled-cm', {
            capabilities: { contextMenuItems: [{ id: 'a', label: 'A', method: 'm' }] },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        reg.setPluginEnabled('disabled-cm', false);

        expect(reg.getAllContextMenuItems()).toHaveLength(0);
    });
});

describe('getAllInfoSections', () => {
    it('returns info sections from enabled plugins', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'info-p', {
            capabilities: { infoSections: [{ id: 's1', label: 'S1', method: 'm' }] },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const sections = reg.getAllInfoSections();
        expect(sections).toHaveLength(1);
        expect(sections[0].pluginId).toBe('info-p');
    });

    it('excludes info sections from disabled plugins', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'dis-info', {
            capabilities: { infoSections: [{ id: 's1', label: 'S1', method: 'm' }] },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        reg.setPluginEnabled('dis-info', false);

        expect(reg.getAllInfoSections()).toHaveLength(0);
    });
});

describe('getAllTooltipSections', () => {
    it('returns tooltip sections from enabled plugins', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'tip-p', {
            capabilities: { tooltipSections: [{ id: 't1', label: 'T1', method: 'm' }] },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const sections = reg.getAllTooltipSections();
        expect(sections).toHaveLength(1);
        expect(sections[0].pluginId).toBe('tip-p');
    });

    it('excludes tooltip sections from disabled plugins', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'dis-tip', {
            capabilities: { tooltipSections: [{ id: 't1', label: 'T1', method: 'm' }] },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        reg.setPluginEnabled('dis-tip', false);

        expect(reg.getAllTooltipSections()).toHaveLength(0);
    });
});

describe('getAllBatchOperations', () => {
    it('returns batch ops from enabled plugins', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'bat-p', {
            capabilities: { batchOperations: [{ id: 'b1', label: 'B1', method: 'm' }] },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const ops = reg.getAllBatchOperations();
        expect(ops).toHaveLength(1);
        expect(ops[0].pluginId).toBe('bat-p');
    });

    it('excludes batch ops from disabled plugins', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'dis-bat', {
            capabilities: { batchOperations: [{ id: 'b1', label: 'B1', method: 'm' }] },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        reg.setPluginEnabled('dis-bat', false);

        expect(reg.getAllBatchOperations()).toHaveLength(0);
    });
});

describe('getAllSettingsPanels', () => {
    it('returns settings panels from enabled plugins', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'set-p', {
            capabilities: { settingsPanel: { title: 'Settings', loadMethod: 'l', saveMethod: 's' } },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const panels = reg.getAllSettingsPanels();
        expect(panels).toHaveLength(1);
        expect(panels[0].pluginId).toBe('set-p');
    });

    it('excludes settings panels from disabled plugins', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'dis-set', {
            capabilities: { settingsPanel: { title: 'S', loadMethod: 'l', saveMethod: 's' } },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        reg.setPluginEnabled('dis-set', false);

        expect(reg.getAllSettingsPanels()).toHaveLength(0);
    });
});

describe('getAllLightboxRenderers', () => {
    it('returns renderers from enabled plugins', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'lb-p', {
            capabilities: {
                lightboxRenderers: [{ id: 'r1', extensions: ['.psd'], mode: 'image', mimeType: 'image/psd' }],
            },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const renderers = reg.getAllLightboxRenderers();
        expect(renderers['.psd']).toBeDefined();
        expect(renderers['.psd'].pluginId).toBe('lb-p');
    });

    it('excludes renderers from disabled plugins', () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'dis-lb', {
            capabilities: {
                lightboxRenderers: [{ id: 'r1', extensions: ['.abc'], mode: 'image' }],
            },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        reg.setPluginEnabled('dis-lb', false);

        expect(reg.getAllLightboxRenderers()).toEqual({});
    });
});

// ── renderInfoSection / renderTooltipSection ─────────────────────────

describe('renderInfoSection', () => {
    it('throws for unknown plugin', async () => {
        const reg = new PluginRegistry(makeTmpDir());
        await expect(reg.renderInfoSection('nope', 's', '/f', {})).rejects.toThrow('Unknown plugin');
    });

    it('throws for unknown section ID', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'info-err', {
            capabilities: { infoSections: [{ id: 'known', label: 'K', method: 'm' }] },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        await expect(reg.renderInfoSection('info-err', 'bad-id', '/f', {}))
            .rejects.toThrow('Unknown info section');
    });

    it('throws when plugin does not export the renderer method', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'info-nomethod', {
            capabilities: { infoSections: [{ id: 's1', label: 'S', method: 'renderIt' }] },
        }, `
            module.exports.activate = () => module.exports;
            module.exports.deactivate = () => {};
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        await expect(reg.renderInfoSection('info-nomethod', 's1', '/f', {}))
            .rejects.toThrow(/does not export method/);
    });
});

describe('renderTooltipSection', () => {
    it('throws for unknown plugin', async () => {
        const reg = new PluginRegistry(makeTmpDir());
        await expect(reg.renderTooltipSection('nope', 's', '/f', {})).rejects.toThrow('Unknown plugin');
    });

    it('throws for unknown section ID', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'tip-err', {
            capabilities: { tooltipSections: [{ id: 'known', label: 'K', method: 'm' }] },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        await expect(reg.renderTooltipSection('tip-err', 'bad-id', '/f', {}))
            .rejects.toThrow('Unknown tooltip section');
    });
});

// ── executeBatchOperation ────────────────────────────────────────────

describe('executeBatchOperation', () => {
    it('throws for unknown plugin', async () => {
        const reg = new PluginRegistry(makeTmpDir());
        await expect(reg.executeBatchOperation('nope', 'op', [], {})).rejects.toThrow('Unknown plugin');
    });

    it('throws for unknown operation ID', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'bat-err', {
            capabilities: { batchOperations: [{ id: 'known', label: 'K', method: 'm' }] },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        await expect(reg.executeBatchOperation('bat-err', 'bad-op', [], {}))
            .rejects.toThrow('Unknown batch operation');
    });

    it('executes a valid batch operation', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'bat-ok', {
            capabilities: {
                batchOperations: [{ id: 'convert', label: 'Convert', method: 'batchConvert' }],
            },
        }, `
            module.exports.activate = () => module.exports;
            module.exports.batchConvert = (files, opts) => ({ converted: files.length });
            module.exports.deactivate = () => {};
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const result = await reg.executeBatchOperation('bat-ok', 'convert', ['/a', '/b'], {});
        expect(result).toEqual({ converted: 2 });
    });

    it('throws when plugin does not export the batch method', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'bat-nomethod', {
            capabilities: {
                batchOperations: [{ id: 'op', label: 'Op', method: 'missing' }],
            },
        }, `
            module.exports.activate = () => module.exports;
            module.exports.deactivate = () => {};
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        await expect(reg.executeBatchOperation('bat-nomethod', 'op', [], {}))
            .rejects.toThrow(/does not export method/);
    });
});

// ── executeSettingsAction ────────────────────────────────────────────

describe('executeSettingsAction', () => {
    it('throws for unknown plugin', async () => {
        const reg = new PluginRegistry(makeTmpDir());
        await expect(reg.executeSettingsAction('nope', 'load', {})).rejects.toThrow('Unknown plugin');
    });

    it('throws when plugin has no settingsPanel', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'no-settings');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        await expect(reg.executeSettingsAction('no-settings', 'load', {}))
            .rejects.toThrow('no settingsPanel');
    });

    it('calls loadMethod for load action', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'set-load', {
            capabilities: {
                settingsPanel: { title: 'S', loadMethod: 'loadSettings', saveMethod: 'saveSettings' },
            },
        }, `
            module.exports.activate = () => module.exports;
            module.exports.loadSettings = () => ({ theme: 'dark' });
            module.exports.saveSettings = () => {};
            module.exports.deactivate = () => {};
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const result = await reg.executeSettingsAction('set-load', 'load', {});
        expect(result).toEqual({ theme: 'dark' });
    });

    it('calls saveMethod for save action', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'set-save', {
            capabilities: {
                settingsPanel: { title: 'S', loadMethod: 'loadSettings', saveMethod: 'saveSettings' },
            },
        }, `
            module.exports.activate = () => module.exports;
            module.exports.loadSettings = () => ({});
            module.exports.saveSettings = (data) => ({ saved: data.key });
            module.exports.deactivate = () => {};
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const result = await reg.executeSettingsAction('set-save', 'save', { key: 'val' });
        expect(result).toEqual({ saved: 'val' });
    });
});

// ── generateThumbnail ────────────────────────────────────────────────

describe('generateThumbnail', () => {
    it('returns result from first matching generator', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'thumb-p', {
            capabilities: {
                thumbnailGenerators: [{ id: 'tg', method: 'genThumb', extensions: ['.psd'] }],
            },
        }, `
            module.exports.activate = () => module.exports;
            module.exports.genThumb = (fp, opts) => 'data:image/png;base64,AAAA';
            module.exports.deactivate = () => {};
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const result = await reg.generateThumbnail('/f.psd', '.psd');
        expect(result).toBe('data:image/png;base64,AAAA');
    });

    it('returns null for unregistered extension', async () => {
        const reg = new PluginRegistry(makeTmpDir());
        const result = await reg.generateThumbnail('/f.xyz', '.xyz');
        expect(result).toBeNull();
    });

    it('skips disabled plugins', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'dis-thumb', {
            capabilities: {
                thumbnailGenerators: [{ id: 'tg', method: 'gen', extensions: ['.dt'] }],
            },
        }, `
            module.exports.activate = () => module.exports;
            module.exports.gen = () => 'data:...';
            module.exports.deactivate = () => {};
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        reg.setPluginEnabled('dis-thumb', false);

        const result = await reg.generateThumbnail('/f.dt', '.dt');
        expect(result).toBeNull();
    });

    it('handles generator that throws gracefully', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'err-thumb', {
            capabilities: {
                thumbnailGenerators: [{ id: 'tg', method: 'gen', extensions: ['.et'] }],
            },
        }, `
            module.exports.activate = () => module.exports;
            module.exports.gen = () => { throw new Error('gen failed'); };
            module.exports.deactivate = () => {};
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const result = await reg.generateThumbnail('/f.et', '.et');
        expect(result).toBeNull();
    });

    it('returns null when generator returns null', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'null-thumb', {
            capabilities: {
                thumbnailGenerators: [{ id: 'tg', method: 'gen', extensions: ['.nt'] }],
            },
        }, `
            module.exports.activate = () => module.exports;
            module.exports.gen = () => null;
            module.exports.deactivate = () => {};
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const result = await reg.generateThumbnail('/f.nt', '.nt');
        expect(result).toBeNull();
    });
});

// ── reload / teardown ────────────────────────────────────────────────

describe('reload / teardown', () => {
    it('teardown calls deactivate on loaded plugins', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'td-plugin', {
            capabilities: {
                metadataExtractors: [{ id: 'e', method: 'extract', extensions: ['.td'] }],
            },
        }, `
            module.exports.activate = () => module.exports;
            module.exports.extract = () => ({});
            module.exports.deactivate = () => { global.__teardownCalled = true; };
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        // Force load
        await reg.extractMetadata('/f.td', '.td');
        await reg.teardown();

        expect(global.__teardownCalled).toBe(true);
        expect(reg._loaded.size).toBe(0);
        delete global.__teardownCalled;
    });

    it('teardown handles plugins without deactivate', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'no-deact', {
            capabilities: {
                metadataExtractors: [{ id: 'e', method: 'extract', extensions: ['.nd'] }],
            },
        }, `
            module.exports.activate = () => ({ extract: () => ({}) });
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        await reg.extractMetadata('/f.nd', '.nd');

        // Should not throw
        await reg.teardown();
    });

    it('reload clears and re-discovers plugins', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'reload-p');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        expect(reg._manifests.size).toBe(1);

        const count = await reg.reload([{ dir: pluginsDir }]);
        expect(count).toBe(1);
        expect(reg._manifests.has('reload-p')).toBe(true);
    });

    it('reload preserves disabled preferences', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'pref-p');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        reg.setPluginEnabled('pref-p', false);

        await reg.reload([{ dir: pluginsDir }]);
        expect(reg._disabledPlugins.has('pref-p')).toBe(true);
    });

    it('reload prunes order entries for removed plugins', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'stays');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);
        // Manually add a stale entry
        reg._pluginOrder.push('gone-plugin');

        await reg.reload([{ dir: pluginsDir }]);
        expect(reg.getPluginOrder()).not.toContain('gone-plugin');
        expect(reg.getPluginOrder()).toContain('stays');
    });

    it('reload marks builtin plugins correctly', async () => {
        const builtinDir = makeTmpDir();
        const userDir = makeTmpDir();
        writePlugin(builtinDir, 'core');
        writePlugin(userDir, 'user');

        const reg = new PluginRegistry(makeTmpDir());
        await reg.reload([
            { dir: builtinDir, builtin: true },
            { dir: userDir },
        ]);

        expect(reg.isBuiltin('core')).toBe(true);
        expect(reg.isBuiltin('user')).toBe(false);
    });

    it('reload clears all index maps', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'full', {
            capabilities: {
                metadataExtractors: [{ id: 'e', method: 'm', extensions: ['.x'] }],
                contextMenuItems: [{ id: 'c', label: 'C', method: 'm' }],
                infoSections: [{ id: 'i', label: 'I', method: 'm' }],
                tooltipSections: [{ id: 't', label: 'T', method: 'm' }],
                batchOperations: [{ id: 'b', label: 'B', method: 'm' }],
                settingsPanel: { title: 'S', loadMethod: 'l', saveMethod: 's' },
            },
        });

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        // Reload with empty dirs to confirm everything clears
        await reg.reload([]);
        expect(reg._manifests.size).toBe(0);
        expect(reg._extractorsByExt.size).toBe(0);
        expect(reg._contextMenuItemsByPlugin.size).toBe(0);
    });
});

// ── callWithTimeout (via extractMetadata / executeAction) ────────────

describe('callWithTimeout (via extractMetadata / executeAction)', () => {
    it('resolves when function completes before timeout', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'fast-p', {
            capabilities: {
                metadataExtractors: [{ id: 'fast', method: 'extract', extensions: ['.fast'] }],
            },
        }, `
            module.exports.activate = () => module.exports;
            module.exports.extract = () => ({ speed: 'fast' });
            module.exports.deactivate = () => {};
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const result = await reg.extractMetadata('/f.fast', '.fast');
        expect(result.fast).toEqual({ speed: 'fast' });
    });

    it('rejects when function exceeds timeout', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'slow-p', {
            capabilities: {
                contextMenuItems: [{ id: 'slow-act', label: 'Slow', method: 'doSlow' }],
            },
        }, `
            module.exports.activate = () => module.exports;
            module.exports.doSlow = () => new Promise(() => {}); // never resolves
            module.exports.deactivate = () => {};
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        await expect(reg.executeAction('slow-p', 'slow-act', '/f', {}))
            .rejects.toThrow('timed out');
    }, 15000);

    it('extractMetadata catches timeout errors gracefully', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'timeout-meta', {
            capabilities: {
                metadataExtractors: [{ id: 'hang', method: 'extract', extensions: ['.hang'] }],
            },
        }, `
            module.exports.activate = () => module.exports;
            module.exports.extract = () => new Promise(() => {}); // never resolves
            module.exports.deactivate = () => {};
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const result = await reg.extractMetadata('/f.hang', '.hang');
        expect(result).toEqual({});
    }, 15000);
});

// ── getPluginDir / isBuiltin ─────────────────────────────────────────

describe('getPluginDir / isBuiltin', () => {
    it('getPluginDir returns the plugin directory', () => {
        const pluginsDir = makeTmpDir();
        const pluginDir = writePlugin(pluginsDir, 'dir-test');

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        expect(reg.getPluginDir('dir-test')).toBe(pluginDir);
    });

    it('getPluginDir returns null for unknown plugin', () => {
        const reg = new PluginRegistry(makeTmpDir());
        expect(reg.getPluginDir('unknown')).toBeNull();
    });

    it('isBuiltin returns false for unknown plugin', () => {
        const reg = new PluginRegistry(makeTmpDir());
        expect(reg.isBuiltin('unknown')).toBe(false);
    });
});

// ── _loadPlugin ──────────────────────────────────────────────────────

describe('_loadPlugin', () => {
    it('returns the same instance on repeated calls', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'cached', {
            capabilities: {
                metadataExtractors: [{ id: 'e', method: 'extract', extensions: ['.c'] }],
            },
        }, `
            let count = 0;
            module.exports.activate = () => ({ id: ++count, extract: () => ({}) });
            module.exports.deactivate = () => {};
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const inst1 = await reg._loadPlugin('cached');
        const inst2 = await reg._loadPlugin('cached');
        expect(inst1).toBe(inst2);
    });

    it('throws for unknown plugin', async () => {
        const reg = new PluginRegistry(makeTmpDir());
        await expect(reg._loadPlugin('nope')).rejects.toThrow('Unknown plugin');
    });

    it('uses module directly when activate is not a function', async () => {
        const pluginsDir = makeTmpDir();
        writePlugin(pluginsDir, 'no-activate', {
            capabilities: {
                metadataExtractors: [{ id: 'e', method: 'extract', extensions: ['.na'] }],
            },
        }, `
            module.exports = { extract: () => ({ noActivate: true }) };
        `);

        const reg = new PluginRegistry(makeTmpDir());
        reg.discover(pluginsDir);

        const result = await reg.extractMetadata('/f.na', '.na');
        expect(result.e).toEqual({ noActivate: true });
    });
});
