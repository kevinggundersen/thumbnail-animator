'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * Creates the API surface exposed to a plugin.
 * Plugins receive this object in their activate(api) call.
 */
function createPluginAPI(pluginId, cacheBaseDir) {
    // Per-plugin storage file path
    const storageFile = () => {
        const dir = path.join(cacheBaseDir, pluginId);
        fs.mkdirSync(dir, { recursive: true });
        return path.join(dir, 'storage.json');
    };

    let _storageCache = null;
    function _loadStorage() {
        if (_storageCache !== null) return _storageCache;
        try {
            _storageCache = JSON.parse(fs.readFileSync(storageFile(), 'utf8'));
        } catch {
            _storageCache = {};
        }
        return _storageCache;
    }

    return {
        // Read-only fs utilities
        fs: {
            readFile: (filePath, options) => fs.promises.readFile(filePath, options),
            stat: (filePath) => fs.promises.stat(filePath),
            readdir: (dirPath) => fs.promises.readdir(dirPath),
            /**
             * Write a file to a path scoped under the plugin's cache directory.
             * Prevents plugins from writing outside their cache dir.
             */
            writeFile(subPath, data, options) {
                const pluginCacheDir = path.join(cacheBaseDir, pluginId);
                const resolved = path.resolve(pluginCacheDir, subPath);
                if (!resolved.startsWith(pluginCacheDir)) {
                    throw new Error(`[Plugin ${pluginId}] writeFile path escapes plugin cache directory`);
                }
                fs.mkdirSync(path.dirname(resolved), { recursive: true });
                return fs.promises.writeFile(resolved, data, options);
            },

            /**
             * Atomically replace a file's contents at its original location.
             * Writes to a temp file first, then renames over the original.
             * NOT sandboxed — intended for plugins that modify user files in-place.
             * @param {string} filePath - Absolute path to the file to replace
             * @param {Buffer|string} data - New file contents
             */
            async replaceFile(filePath, data) {
                const resolved = path.resolve(filePath);
                const tempPath = resolved + '.plugin-tmp-' + Date.now();
                try {
                    await fs.promises.writeFile(tempPath, data);
                    await fs.promises.rename(tempPath, resolved);
                } catch (err) {
                    try { await fs.promises.unlink(tempPath); } catch { /* ignore */ }
                    throw err;
                }
            },
        },

        path,
        zlib,

        /**
         * Commonly-needed npm modules, exposed as lazy getters.
         * Returns null if the module is not available. Plugins should check
         * for null before use (matches the existing try/catch require pattern).
         */
        modules: {
            get sharp()      { try { return require('sharp'); } catch { return null; } },
            get exifreader() { try { return require('exifreader'); } catch { return null; } },
            get pngChunks()  { try { return require('png-chunks-extract'); } catch { return null; } },
        },

        /**
         * Execute an external command safely (no shell injection — uses execFile).
         * @param {string} cmd - Executable path or name
         * @param {string[]} [args] - Arguments array
         * @param {Object} [options] - { timeout, cwd, env, maxBuffer, encoding }
         * @returns {Promise<{stdout: Buffer|string, stderr: Buffer|string}>}
         */
        exec(cmd, args = [], options = {}) {
            const { execFile } = require('child_process');
            const { timeout = 30000, cwd, env, maxBuffer = 10 * 1024 * 1024, encoding = 'buffer' } = options;
            return new Promise((resolve, reject) => {
                execFile(cmd, args, { timeout, cwd, env, maxBuffer, encoding, windowsHide: true }, (err, stdout, stderr) => {
                    if (err) return reject(err);
                    resolve({ stdout, stderr });
                });
            });
        },

        /**
         * Read up to maxBytes from the start of a file into a Buffer.
         * Useful for parsing file headers without loading the whole file.
         */
        async readImageHeader(filePath, maxBytes = 512 * 1024) {
            const fd = await fs.promises.open(filePath, 'r');
            try {
                const buffer = Buffer.alloc(maxBytes);
                const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
                return buffer.subarray(0, bytesRead);
            } finally {
                await fd.close();
            }
        },

        /**
         * Returns a directory path dedicated to this plugin for caching.
         * The directory is created on first access.
         */
        getCachePath(subPath = '') {
            const pluginCacheDir = path.join(cacheBaseDir, pluginId);
            fs.mkdirSync(pluginCacheDir, { recursive: true });
            return subPath ? path.join(pluginCacheDir, subPath) : pluginCacheDir;
        },

        /**
         * Persistent key-value storage for the plugin.
         * Values are JSON-serialisable. Stored in plugin cache dir.
         */
        storage: {
            get(key, defaultValue = null) {
                const store = _loadStorage();
                return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : defaultValue;
            },
            set(key, value) {
                const store = _loadStorage();
                store[key] = value;
                fs.writeFileSync(storageFile(), JSON.stringify(store, null, 2));
            },
            delete(key) {
                const store = _loadStorage();
                delete store[key];
                fs.writeFileSync(storageFile(), JSON.stringify(store, null, 2));
            },
            getAll() {
                return { ..._loadStorage() };
            },
        },
    };
}

module.exports = { createPluginAPI };
