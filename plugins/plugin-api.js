'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * Creates the API surface exposed to a plugin.
 * Plugins receive this object in their activate(api) call.
 */
function createPluginAPI(pluginId, cacheBaseDir) {
    return {
        // Read-only fs utilities
        fs: {
            readFile: (filePath, options) => fs.promises.readFile(filePath, options),
            stat: (filePath) => fs.promises.stat(filePath),
            readdir: (dirPath) => fs.promises.readdir(dirPath),
        },

        path,
        zlib,

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
    };
}

module.exports = { createPluginAPI };
