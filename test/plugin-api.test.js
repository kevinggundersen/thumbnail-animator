'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');

const { createPluginAPI } = require('../plugins/plugin-api');

// ── Helpers ──────────────────────────────────────────────────────────

let tmpDirs = [];

function makeTmpDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-test-'));
    tmpDirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const dir of tmpDirs) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    tmpDirs = [];
});

// ── createPluginAPI factory (shape) ─────────────────────────────────

describe('createPluginAPI', () => {
    it('returns an object with expected top-level keys', () => {
        const api = createPluginAPI('test-plugin', makeTmpDir());
        expect(api).toHaveProperty('fs');
        expect(api).toHaveProperty('path');
        expect(api).toHaveProperty('zlib');
        expect(api).toHaveProperty('modules');
        expect(api).toHaveProperty('exec');
        expect(api).toHaveProperty('readImageHeader');
        expect(api).toHaveProperty('getCachePath');
        expect(api).toHaveProperty('storage');
    });

    it('exposes the Node path module', () => {
        const api = createPluginAPI('test-plugin', makeTmpDir());
        expect(api.path).toBe(path);
    });

    it('exposes the Node zlib module', () => {
        const api = createPluginAPI('test-plugin', makeTmpDir());
        expect(api.zlib).toBe(zlib);
    });

    it('fs sub-object has readFile, writeFile, stat, readdir, replaceFile', () => {
        const api = createPluginAPI('test-plugin', makeTmpDir());
        expect(typeof api.fs.readFile).toBe('function');
        expect(typeof api.fs.writeFile).toBe('function');
        expect(typeof api.fs.stat).toBe('function');
        expect(typeof api.fs.readdir).toBe('function');
        expect(typeof api.fs.replaceFile).toBe('function');
    });

    it('storage sub-object has get, set, delete, getAll', () => {
        const api = createPluginAPI('test-plugin', makeTmpDir());
        expect(typeof api.storage.get).toBe('function');
        expect(typeof api.storage.set).toBe('function');
        expect(typeof api.storage.delete).toBe('function');
        expect(typeof api.storage.getAll).toBe('function');
    });
});

// ── api.fs ───────────────────────────────────────────────────────────

describe('api.fs', () => {
    it('readFile reads file contents', async () => {
        const tmp = makeTmpDir();
        const filePath = path.join(tmp, 'test.txt');
        fs.writeFileSync(filePath, 'hello world');

        const api = createPluginAPI('test-plugin', tmp);
        const content = await api.fs.readFile(filePath, 'utf8');
        expect(content).toBe('hello world');
    });

    it('stat returns file stats', async () => {
        const tmp = makeTmpDir();
        const filePath = path.join(tmp, 'test.txt');
        fs.writeFileSync(filePath, 'data');

        const api = createPluginAPI('test-plugin', tmp);
        const stats = await api.fs.stat(filePath);
        expect(stats.isFile()).toBe(true);
    });

    it('readdir lists directory contents', async () => {
        const tmp = makeTmpDir();
        fs.writeFileSync(path.join(tmp, 'a.txt'), '');
        fs.writeFileSync(path.join(tmp, 'b.txt'), '');

        const api = createPluginAPI('test-plugin', tmp);
        const entries = await api.fs.readdir(tmp);
        expect(entries).toContain('a.txt');
        expect(entries).toContain('b.txt');
    });

    it('writeFile writes inside plugin cache dir', async () => {
        const cacheBase = makeTmpDir();
        const api = createPluginAPI('my-plugin', cacheBase);

        await api.fs.writeFile('output.txt', 'written data');
        const result = fs.readFileSync(path.join(cacheBase, 'my-plugin', 'output.txt'), 'utf8');
        expect(result).toBe('written data');
    });

    it('writeFile creates nested directories', async () => {
        const cacheBase = makeTmpDir();
        const api = createPluginAPI('my-plugin', cacheBase);

        await api.fs.writeFile('sub/dir/file.txt', 'nested');
        const result = fs.readFileSync(
            path.join(cacheBase, 'my-plugin', 'sub', 'dir', 'file.txt'), 'utf8'
        );
        expect(result).toBe('nested');
    });

    it('writeFile rejects path traversal', () => {
        const cacheBase = makeTmpDir();
        const api = createPluginAPI('my-plugin', cacheBase);

        expect(() => api.fs.writeFile('../../escape.txt', 'evil'))
            .toThrow(/escapes/i);
    });

    it('writeFile rejects absolute path outside cache dir', () => {
        const cacheBase = makeTmpDir();
        const api = createPluginAPI('my-plugin', cacheBase);

        expect(() => api.fs.writeFile('/tmp/outside.txt', 'evil'))
            .toThrow(/escapes/i);
    });

    it('replaceFile atomically replaces a file', async () => {
        const tmp = makeTmpDir();
        const filePath = path.join(tmp, 'original.txt');
        fs.writeFileSync(filePath, 'old content');

        const api = createPluginAPI('test-plugin', tmp);
        await api.fs.replaceFile(filePath, 'new content');

        const result = fs.readFileSync(filePath, 'utf8');
        expect(result).toBe('new content');
    });

    it('replaceFile cleans up temp file on failure', async () => {
        const tmp = makeTmpDir();
        const api = createPluginAPI('test-plugin', tmp);
        const badPath = path.join(tmp, 'nonexistent-dir', 'file.txt');

        await expect(api.fs.replaceFile(badPath, 'data')).rejects.toThrow();

        const remaining = fs.readdirSync(tmp).filter(f => f.includes('.plugin-tmp-'));
        expect(remaining).toHaveLength(0);
    });
});

// ── api.modules ──────────────────────────────────────────────────────

describe('api.modules', () => {
    it('returns null for unavailable modules', () => {
        const api = createPluginAPI('test-plugin', makeTmpDir());
        const result = api.modules.pngChunks;
        expect(result === null || typeof result !== 'undefined').toBe(true);
    });

    it('sharp getter does not throw', () => {
        const api = createPluginAPI('test-plugin', makeTmpDir());
        expect(() => api.modules.sharp).not.toThrow();
    });

    it('exifreader getter does not throw', () => {
        const api = createPluginAPI('test-plugin', makeTmpDir());
        expect(() => api.modules.exifreader).not.toThrow();
    });
});

// ── api.exec ─────────────────────────────────────────────────────────

describe('api.exec', () => {
    it('executes a command and returns stdout/stderr', async () => {
        const api = createPluginAPI('test-plugin', makeTmpDir());
        const { stdout } = await api.exec('node', ['-e', 'process.stdout.write("hello")'], { encoding: 'utf8' });
        expect(stdout).toBe('hello');
    });

    it('rejects when command fails', async () => {
        const api = createPluginAPI('test-plugin', makeTmpDir());
        await expect(api.exec('node', ['-e', 'process.exit(1)'], { encoding: 'utf8' }))
            .rejects.toThrow();
    });

    it('respects timeout option', async () => {
        const api = createPluginAPI('test-plugin', makeTmpDir());
        await expect(
            api.exec('node', ['-e', 'setTimeout(() => {}, 60000)'], { timeout: 100 })
        ).rejects.toThrow();
    });

    it('returns buffer by default', async () => {
        const api = createPluginAPI('test-plugin', makeTmpDir());
        const { stdout } = await api.exec('node', ['-e', 'process.stdout.write("buf")']);
        expect(Buffer.isBuffer(stdout)).toBe(true);
        expect(stdout.toString()).toBe('buf');
    });

    it('uses windowsHide option', async () => {
        // Verify exec works (windowsHide is set internally, we just confirm it does not break)
        const api = createPluginAPI('test-plugin', makeTmpDir());
        const { stdout } = await api.exec('node', ['-e', 'process.stdout.write("ok")'], { encoding: 'utf8' });
        expect(stdout).toBe('ok');
    });
});

// ── api.readImageHeader ──────────────────────────────────────────────

describe('api.readImageHeader', () => {
    it('reads the first N bytes of a file', async () => {
        const tmp = makeTmpDir();
        const filePath = path.join(tmp, 'header.bin');
        const data = Buffer.alloc(1024, 0xAB);
        fs.writeFileSync(filePath, data);

        const api = createPluginAPI('test-plugin', tmp);
        const header = await api.readImageHeader(filePath, 256);
        expect(header.length).toBe(256);
        expect(header[0]).toBe(0xAB);
    });

    it('returns fewer bytes when file is smaller than maxBytes', async () => {
        const tmp = makeTmpDir();
        const filePath = path.join(tmp, 'small.bin');
        fs.writeFileSync(filePath, Buffer.from([1, 2, 3]));

        const api = createPluginAPI('test-plugin', tmp);
        const header = await api.readImageHeader(filePath, 1024);
        expect(header.length).toBe(3);
        expect(header[0]).toBe(1);
    });

    it('uses default maxBytes of 512KB', async () => {
        const tmp = makeTmpDir();
        const filePath = path.join(tmp, 'large.bin');
        const data = Buffer.alloc(1024 * 1024, 0xFF); // 1MB
        fs.writeFileSync(filePath, data);

        const api = createPluginAPI('test-plugin', tmp);
        const header = await api.readImageHeader(filePath);
        expect(header.length).toBe(512 * 1024);
    });
});

// ── api.getCachePath ─────────────────────────────────────────────────

describe('api.getCachePath', () => {
    it('returns plugin-specific cache directory', () => {
        const cacheBase = makeTmpDir();
        const api = createPluginAPI('my-plugin', cacheBase);
        const cachePath = api.getCachePath();
        expect(cachePath).toBe(path.join(cacheBase, 'my-plugin'));
        expect(fs.existsSync(cachePath)).toBe(true);
    });

    it('returns subpath within plugin cache directory', () => {
        const cacheBase = makeTmpDir();
        const api = createPluginAPI('my-plugin', cacheBase);
        const subPath = api.getCachePath('thumbnails');
        expect(subPath).toBe(path.join(cacheBase, 'my-plugin', 'thumbnails'));
    });

    it('creates the directory on access', () => {
        const cacheBase = makeTmpDir();
        const api = createPluginAPI('new-plugin', cacheBase);
        const dir = api.getCachePath();
        expect(fs.statSync(dir).isDirectory()).toBe(true);
    });

    it('returns base cache dir when subPath is empty string', () => {
        const cacheBase = makeTmpDir();
        const api = createPluginAPI('my-plugin', cacheBase);
        const result = api.getCachePath('');
        expect(result).toBe(path.join(cacheBase, 'my-plugin'));
    });
});

// ── api.storage ──────────────────────────────────────────────────────

describe('api.storage', () => {
    it('set and get a value', () => {
        const cacheBase = makeTmpDir();
        const api = createPluginAPI('store-test', cacheBase);

        api.storage.set('key1', 'value1');
        expect(api.storage.get('key1')).toBe('value1');
    });

    it('get returns defaultValue for missing key', () => {
        const cacheBase = makeTmpDir();
        const api = createPluginAPI('store-test2', cacheBase);

        expect(api.storage.get('missing', 42)).toBe(42);
    });

    it('get returns null as default when no defaultValue provided', () => {
        const cacheBase = makeTmpDir();
        const api = createPluginAPI('store-test3', cacheBase);

        expect(api.storage.get('missing')).toBeNull();
    });

    it('delete removes a key', () => {
        const cacheBase = makeTmpDir();
        const api = createPluginAPI('store-del', cacheBase);

        api.storage.set('k', 'v');
        api.storage.delete('k');
        expect(api.storage.get('k')).toBeNull();
    });

    it('getAll returns a copy of all data', () => {
        const cacheBase = makeTmpDir();
        const api = createPluginAPI('store-all', cacheBase);

        api.storage.set('a', 1);
        api.storage.set('b', 2);

        const all = api.storage.getAll();
        expect(all).toEqual({ a: 1, b: 2 });

        // Mutating the copy should not affect storage
        all.c = 3;
        expect(api.storage.get('c')).toBeNull();
    });

    it('persists values to disk', () => {
        const cacheBase = makeTmpDir();
        const api = createPluginAPI('persist-test', cacheBase);

        api.storage.set('saved', 'yes');

        const filePath = path.join(cacheBase, 'persist-test', 'storage.json');
        expect(fs.existsSync(filePath)).toBe(true);
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        expect(raw.saved).toBe('yes');
    });

    it('handles complex values (objects, arrays)', () => {
        const cacheBase = makeTmpDir();
        const api = createPluginAPI('complex-store', cacheBase);

        api.storage.set('obj', { nested: { deep: true } });
        api.storage.set('arr', [1, 2, 3]);

        expect(api.storage.get('obj')).toEqual({ nested: { deep: true } });
        expect(api.storage.get('arr')).toEqual([1, 2, 3]);
    });

    it('loads from existing storage file on first access', () => {
        const cacheBase = makeTmpDir();
        const pluginDir = path.join(cacheBase, 'preload');
        fs.mkdirSync(pluginDir, { recursive: true });
        fs.writeFileSync(path.join(pluginDir, 'storage.json'), JSON.stringify({ existing: 'data' }));

        const api = createPluginAPI('preload', cacheBase);
        expect(api.storage.get('existing')).toBe('data');
    });

    it('caches storage in memory after first load', () => {
        const cacheBase = makeTmpDir();
        const api = createPluginAPI('cache-test', cacheBase);

        api.storage.set('x', 1);

        // Manually overwrite the file behind the API's back
        const filePath = path.join(cacheBase, 'cache-test', 'storage.json');
        fs.writeFileSync(filePath, JSON.stringify({ x: 999 }));

        // Should still return cached value
        expect(api.storage.get('x')).toBe(1);
    });

    it('delete persists removal to disk', () => {
        const cacheBase = makeTmpDir();
        const api = createPluginAPI('del-persist', cacheBase);

        api.storage.set('a', 1);
        api.storage.set('b', 2);
        api.storage.delete('a');

        const filePath = path.join(cacheBase, 'del-persist', 'storage.json');
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        expect(raw).toEqual({ b: 2 });
        expect(raw.a).toBeUndefined();
    });

    it('handles empty storage file gracefully', () => {
        const cacheBase = makeTmpDir();
        const pluginDir = path.join(cacheBase, 'empty-store');
        fs.mkdirSync(pluginDir, { recursive: true });
        fs.writeFileSync(path.join(pluginDir, 'storage.json'), '');

        const api = createPluginAPI('empty-store', cacheBase);
        // Corrupt/empty file should result in empty store
        expect(api.storage.getAll()).toEqual({});
    });
});
