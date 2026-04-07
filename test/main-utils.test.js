const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const {
    validateUserPath,
    pathToFileUrl,
    fileUrlToPath,
    createThumbCacheKey,
    formatFileSize,
    safeMove,
    moveToStaging,
    restoreFromStaging,
    writeCrashLog,
    asyncPool,
    matchesCheapRules,
    POPCOUNT_TABLE,
    hammingDistance,
    _qualityToParams,
    buildFfmpegArgs,
    _parseFfmpegProgressChunk,
} = require('../main-utils');

// ── Helpers ──────────────────────────────────────────────────────────────

let tmpDirs = [];

function makeTmpDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    tmpDirs.push(dir);
    return dir;
}

afterEach(() => {
    for (const d of tmpDirs) {
        try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
    }
    tmpDirs = [];
});

// ── validateUserPath ─────────────────────────────────────────────────────

describe('validateUserPath', () => {
    it('resolves a relative path to absolute', () => {
        const result = validateUserPath('foo/bar.txt');
        expect(path.isAbsolute(result)).toBe(true);
    });

    it('returns an already-absolute path resolved', () => {
        const abs = path.resolve('/tmp/test.txt');
        expect(validateUserPath(abs)).toBe(abs);
    });

    it('throws for null', () => {
        expect(() => validateUserPath(null)).toThrow('Invalid path');
    });

    it('throws for undefined', () => {
        expect(() => validateUserPath(undefined)).toThrow('Invalid path');
    });

    it('throws for empty string', () => {
        expect(() => validateUserPath('')).toThrow('Invalid path');
    });

    it('throws for whitespace-only string', () => {
        expect(() => validateUserPath('   ')).toThrow('Invalid path');
    });

    it('throws for a number', () => {
        expect(() => validateUserPath(42)).toThrow('Invalid path');
    });

    it('throws for an object', () => {
        expect(() => validateUserPath({})).toThrow('Invalid path');
    });

    it('throws for an array', () => {
        expect(() => validateUserPath([])).toThrow('Invalid path');
    });

    it('does not throw when mustExist is false for missing path', () => {
        expect(() => validateUserPath('/nonexistent/abc/xyz.txt', { mustExist: false })).not.toThrow();
    });

    it('throws when mustExist is true and path does not exist', () => {
        expect(() => validateUserPath('/nonexistent/abc/xyz.txt', { mustExist: true })).toThrow('Path does not exist');
    });

    it('succeeds when mustExist is true and path does exist', () => {
        const dir = makeTmpDir();
        const result = validateUserPath(dir, { mustExist: true });
        expect(result).toBe(dir);
    });

    it('defaults opts to empty object', () => {
        // No opts argument at all
        const result = validateUserPath('test.txt');
        expect(typeof result).toBe('string');
    });
});

// ── pathToFileUrl ────────────────────────────────────────────────────────

describe('pathToFileUrl', () => {
    if (process.platform === 'win32') {
        it('converts a Windows path to file:/// URL', () => {
            expect(pathToFileUrl('C:\\Users\\test\\file.txt')).toBe('file:///C:/Users/test/file.txt');
        });

        it('converts forward-slash Windows path', () => {
            expect(pathToFileUrl('C:/Users/test/file.txt')).toBe('file:///C:/Users/test/file.txt');
        });

        it('handles paths with spaces', () => {
            expect(pathToFileUrl('C:\\My Folder\\file.txt')).toBe('file:///C:/My Folder/file.txt');
        });
    } else {
        it('converts a Unix path to file:// URL', () => {
            expect(pathToFileUrl('/home/user/file.txt')).toBe('file:///home/user/file.txt');
        });
    }
});

// ── fileUrlToPath ────────────────────────────────────────────────────────

describe('fileUrlToPath', () => {
    it('returns null for null input', () => {
        expect(fileUrlToPath(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
        expect(fileUrlToPath(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(fileUrlToPath('')).toBeNull();
    });

    it('returns null for a number', () => {
        expect(fileUrlToPath(42)).toBeNull();
    });

    it('returns null for non-file URL', () => {
        expect(fileUrlToPath('https://example.com')).toBeNull();
    });

    it('returns null for string not starting with file://', () => {
        expect(fileUrlToPath('ftp://something')).toBeNull();
    });

    if (process.platform === 'win32') {
        it('converts a file:/// URL back to a Windows path', () => {
            const result = fileUrlToPath('file:///C:/Users/test/file.txt');
            expect(result).toBe('C:\\Users\\test\\file.txt');
        });

        it('decodes percent-encoded characters', () => {
            const result = fileUrlToPath('file:///C:/My%20Folder/file.txt');
            expect(result).toBe('C:\\My Folder\\file.txt');
        });
    } else {
        it('converts a file:// URL back to a Unix path', () => {
            const result = fileUrlToPath('file:///home/user/file.txt');
            expect(result).toBe('/home/user/file.txt');
        });
    }

    it('round-trips with pathToFileUrl', () => {
        const original = process.platform === 'win32'
            ? 'C:\\Users\\test\\file.txt'
            : '/home/user/file.txt';
        expect(fileUrlToPath(pathToFileUrl(original))).toBe(original);
    });
});

// ── createThumbCacheKey ──────────────────────────────────────────────────

describe('createThumbCacheKey', () => {
    it('returns a 32-char hex string (MD5)', () => {
        const key = createThumbCacheKey('/some/path.jpg', 1234567890);
        expect(key).toMatch(/^[0-9a-f]{32}$/);
    });

    it('produces different keys for different paths', () => {
        const a = createThumbCacheKey('/a.jpg', 100);
        const b = createThumbCacheKey('/b.jpg', 100);
        expect(a).not.toBe(b);
    });

    it('produces different keys for different mtimes', () => {
        const a = createThumbCacheKey('/a.jpg', 100);
        const b = createThumbCacheKey('/a.jpg', 200);
        expect(a).not.toBe(b);
    });

    it('produces different keys with different extra values', () => {
        const a = createThumbCacheKey('/a.jpg', 100, 'small');
        const b = createThumbCacheKey('/a.jpg', 100, 'large');
        expect(a).not.toBe(b);
    });

    it('defaults extra to empty string', () => {
        const a = createThumbCacheKey('/a.jpg', 100);
        const b = createThumbCacheKey('/a.jpg', 100, '');
        expect(a).toBe(b);
    });

    it('uses 0 when mtimeMs is falsy', () => {
        const a = createThumbCacheKey('/a.jpg', null);
        const b = createThumbCacheKey('/a.jpg', undefined);
        const c = createThumbCacheKey('/a.jpg', 0);
        expect(a).toBe(b);
        expect(a).toBe(c);
    });

    it('matches a known MD5', () => {
        const expected = crypto.createHash('md5').update('/test.jpg|999|').digest('hex');
        expect(createThumbCacheKey('/test.jpg', 999)).toBe(expected);
    });
});

// ── formatFileSize ───────────────────────────────────────────────────────

describe('formatFileSize', () => {
    it('returns "0 Bytes" for 0', () => {
        expect(formatFileSize(0)).toBe('0 Bytes');
    });

    it('returns "0 Bytes" for negative values', () => {
        expect(formatFileSize(-100)).toBe('0 Bytes');
    });

    it('returns "0 Bytes" for null', () => {
        expect(formatFileSize(null)).toBe('0 Bytes');
    });

    it('returns "0 Bytes" for undefined', () => {
        expect(formatFileSize(undefined)).toBe('0 Bytes');
    });

    it('returns "0 Bytes" for NaN', () => {
        expect(formatFileSize(NaN)).toBe('0 Bytes');
    });

    it('formats bytes', () => {
        expect(formatFileSize(500)).toBe('500 Bytes');
    });

    it('formats 1 byte', () => {
        expect(formatFileSize(1)).toBe('1 Bytes');
    });

    it('formats kilobytes', () => {
        expect(formatFileSize(1024)).toBe('1 KB');
    });

    it('formats fractional kilobytes', () => {
        expect(formatFileSize(1536)).toBe('1.5 KB');
    });

    it('formats megabytes', () => {
        expect(formatFileSize(1048576)).toBe('1 MB');
    });

    it('formats gigabytes', () => {
        expect(formatFileSize(1073741824)).toBe('1 GB');
    });

    it('formats terabytes', () => {
        expect(formatFileSize(1099511627776)).toBe('1 TB');
    });

    it('caps at TB for very large values', () => {
        // 2048 TB — should still say TB, not exceed the sizes array
        const result = formatFileSize(2048 * 1099511627776);
        expect(result).toContain('TB');
    });

    it('rounds to two decimal places', () => {
        // 1.33 MB
        expect(formatFileSize(1395864)).toBe('1.33 MB');
    });
});

// ── safeMove ─────────────────────────────────────────────────────────────

describe('safeMove', () => {
    it('moves a file via rename (same directory)', async () => {
        const dir = makeTmpDir();
        const src = path.join(dir, 'a.txt');
        const dest = path.join(dir, 'b.txt');
        fs.writeFileSync(src, 'hello');
        await safeMove(src, dest);
        expect(fs.existsSync(src)).toBe(false);
        expect(fs.readFileSync(dest, 'utf8')).toBe('hello');
    });

    it('moves a file between sibling directories', async () => {
        const dir = makeTmpDir();
        const sub1 = path.join(dir, 'sub1');
        const sub2 = path.join(dir, 'sub2');
        fs.mkdirSync(sub1);
        fs.mkdirSync(sub2);
        const src = path.join(sub1, 'file.txt');
        const dest = path.join(sub2, 'file.txt');
        fs.writeFileSync(src, 'data');
        await safeMove(src, dest);
        expect(fs.existsSync(src)).toBe(false);
        expect(fs.readFileSync(dest, 'utf8')).toBe('data');
    });

    it('falls back to copy+delete on EXDEV for files', async () => {
        const dir = makeTmpDir();
        const src = path.join(dir, 'src.txt');
        const dest = path.join(dir, 'dest.txt');
        fs.writeFileSync(src, 'cross-drive');

        // Simulate EXDEV by temporarily replacing fs.promises.rename
        const originalRename = fs.promises.rename;
        fs.promises.rename = async () => {
            const err = new Error('cross-device link not permitted');
            err.code = 'EXDEV';
            throw err;
        };
        try {
            await safeMove(src, dest);
            expect(fs.existsSync(src)).toBe(false);
            expect(fs.readFileSync(dest, 'utf8')).toBe('cross-drive');
        } finally {
            fs.promises.rename = originalRename;
        }
    });

    it('falls back to copy+delete on EXDEV for directories', async () => {
        const dir = makeTmpDir();
        const srcDir = path.join(dir, 'srcdir');
        const destDir = path.join(dir, 'destdir');
        fs.mkdirSync(srcDir);
        fs.writeFileSync(path.join(srcDir, 'inner.txt'), 'nested');

        const originalRename = fs.promises.rename;
        fs.promises.rename = async () => {
            const err = new Error('cross-device link not permitted');
            err.code = 'EXDEV';
            throw err;
        };
        try {
            await safeMove(srcDir, destDir);
            expect(fs.existsSync(srcDir)).toBe(false);
            expect(fs.readFileSync(path.join(destDir, 'inner.txt'), 'utf8')).toBe('nested');
        } finally {
            fs.promises.rename = originalRename;
        }
    });

    it('propagates non-EXDEV errors', async () => {
        const dir = makeTmpDir();
        const src = path.join(dir, 'nonexistent.txt');
        const dest = path.join(dir, 'dest.txt');
        await expect(safeMove(src, dest)).rejects.toThrow();
    });

    it('propagates EACCES-style errors', async () => {
        const dir = makeTmpDir();
        const src = path.join(dir, 'src.txt');
        const dest = path.join(dir, 'dest.txt');
        fs.writeFileSync(src, 'data');

        const originalRename = fs.promises.rename;
        fs.promises.rename = async () => {
            const err = new Error('permission denied');
            err.code = 'EACCES';
            throw err;
        };
        try {
            await expect(safeMove(src, dest)).rejects.toThrow('permission denied');
        } finally {
            fs.promises.rename = originalRename;
        }
    });
});

// ── moveToStaging ────────────────────────────────────────────────────────

describe('moveToStaging', () => {
    it('moves the file into the staging directory', async () => {
        const dir = makeTmpDir();
        const staging = path.join(dir, 'staging');
        fs.mkdirSync(staging);
        const src = path.join(dir, 'photo.jpg');
        fs.writeFileSync(src, 'image-data');

        const stagingPath = await moveToStaging(src, staging);
        expect(fs.existsSync(src)).toBe(false);
        expect(fs.readFileSync(stagingPath, 'utf8')).toBe('image-data');
        expect(path.dirname(stagingPath)).toBe(staging);
    });

    it('preserves original filename in the staging name', async () => {
        const dir = makeTmpDir();
        const staging = path.join(dir, 'staging');
        fs.mkdirSync(staging);
        const src = path.join(dir, 'photo.jpg');
        fs.writeFileSync(src, 'data');

        const stagingPath = await moveToStaging(src, staging);
        expect(path.basename(stagingPath)).toContain('photo.jpg');
    });

    it('creates unique staging names for same-name files', async () => {
        const dir = makeTmpDir();
        const staging = path.join(dir, 'staging');
        fs.mkdirSync(staging);

        const src1 = path.join(dir, 'file.txt');
        fs.writeFileSync(src1, 'v1');
        const sp1 = await moveToStaging(src1, staging);

        // recreate file with same name
        fs.writeFileSync(src1, 'v2');
        const sp2 = await moveToStaging(src1, staging);

        expect(sp1).not.toBe(sp2);
    });
});

// ── restoreFromStaging ───────────────────────────────────────────────────

describe('restoreFromStaging', () => {
    it('restores a file to its original location', async () => {
        const dir = makeTmpDir();
        const staging = path.join(dir, 'staging');
        fs.mkdirSync(staging);
        const original = path.join(dir, 'photo.jpg');
        const staged = path.join(staging, '12345-abc-photo.jpg');
        fs.writeFileSync(staged, 'image-data');

        await restoreFromStaging(staged, original);
        expect(fs.existsSync(staged)).toBe(false);
        expect(fs.readFileSync(original, 'utf8')).toBe('image-data');
    });

    it('creates parent directories if they do not exist', async () => {
        const dir = makeTmpDir();
        const staging = path.join(dir, 'staging');
        fs.mkdirSync(staging);
        const staged = path.join(staging, 'file.txt');
        fs.writeFileSync(staged, 'content');

        const original = path.join(dir, 'deep', 'nested', 'file.txt');
        await restoreFromStaging(staged, original);
        expect(fs.readFileSync(original, 'utf8')).toBe('content');
    });

    it('throws if the original location already has a file', async () => {
        const dir = makeTmpDir();
        const staging = path.join(dir, 'staging');
        fs.mkdirSync(staging);
        const staged = path.join(staging, 'file.txt');
        fs.writeFileSync(staged, 'staged');
        const original = path.join(dir, 'file.txt');
        fs.writeFileSync(original, 'existing');

        await expect(restoreFromStaging(staged, original)).rejects.toThrow('already exists');
    });
});

// ── writeCrashLog ────────────────────────────────────────────────────────

describe('writeCrashLog', () => {
    it('creates the log file if it does not exist', () => {
        const dir = makeTmpDir();
        const logPath = path.join(dir, 'crash.log');
        writeCrashLog('UNCAUGHT', new Error('boom'), logPath);
        expect(fs.existsSync(logPath)).toBe(true);
    });

    it('writes an entry with timestamp, label, and stack', () => {
        const dir = makeTmpDir();
        const logPath = path.join(dir, 'crash.log');
        const err = new Error('test error');
        writeCrashLog('UNCAUGHT', err, logPath);
        const content = fs.readFileSync(logPath, 'utf8');
        expect(content).toContain('UNCAUGHT');
        expect(content).toContain('test error');
        expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}/); // ISO date
    });

    it('appends multiple entries', () => {
        const dir = makeTmpDir();
        const logPath = path.join(dir, 'crash.log');
        writeCrashLog('A', 'err1', logPath);
        writeCrashLog('B', 'err2', logPath);
        const content = fs.readFileSync(logPath, 'utf8');
        expect(content).toContain('A');
        expect(content).toContain('B');
    });

    it('handles non-Error values (string)', () => {
        const dir = makeTmpDir();
        const logPath = path.join(dir, 'crash.log');
        writeCrashLog('LABEL', 'just a string', logPath);
        expect(fs.readFileSync(logPath, 'utf8')).toContain('just a string');
    });

    it('handles null error', () => {
        const dir = makeTmpDir();
        const logPath = path.join(dir, 'crash.log');
        writeCrashLog('LABEL', null, logPath);
        expect(fs.existsSync(logPath)).toBe(true);
    });

    it('caps the file at ~1 MB, keeping the newest half', () => {
        const dir = makeTmpDir();
        const logPath = path.join(dir, 'crash.log');
        // Write > 1 MB
        const bigChunk = 'X'.repeat(600 * 1024);
        fs.writeFileSync(logPath, bigChunk);
        // Trigger the cap check by appending another entry that pushes over
        writeCrashLog('FINAL', bigChunk, logPath);
        const stat = fs.statSync(logPath);
        expect(stat.size).toBeLessThan(1024 * 1024);
    });

    it('does not throw on write errors (best-effort)', () => {
        // Invalid path — should silently fail
        expect(() => writeCrashLog('X', 'err', '/nonexistent/dir/crash.log')).not.toThrow();
    });
});

// ── asyncPool ────────────────────────────────────────────────────────────

describe('asyncPool', () => {
    it('processes all items', async () => {
        const result = await asyncPool(2, [1, 2, 3, 4], async (x) => x * 2);
        expect(result).toEqual([2, 4, 6, 8]);
    });

    it('respects concurrency limit', async () => {
        let concurrent = 0;
        let maxConcurrent = 0;
        const results = await asyncPool(2, [1, 2, 3, 4, 5], async (x) => {
            concurrent++;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            await new Promise(r => setTimeout(r, 20));
            concurrent--;
            return x;
        });
        expect(maxConcurrent).toBeLessThanOrEqual(2);
        expect(results).toEqual([1, 2, 3, 4, 5]);
    });

    it('handles empty array', async () => {
        const result = await asyncPool(3, [], async (x) => x);
        expect(result).toEqual([]);
    });

    it('handles limit of 1 (serial execution)', async () => {
        let concurrent = 0;
        let maxConcurrent = 0;
        await asyncPool(1, [1, 2, 3], async (x) => {
            concurrent++;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            await new Promise(r => setTimeout(r, 10));
            concurrent--;
            return x;
        });
        expect(maxConcurrent).toBe(1);
    });

    it('handles limit larger than items', async () => {
        const result = await asyncPool(100, [1, 2], async (x) => x + 1);
        expect(result).toEqual([2, 3]);
    });

    it('propagates errors', async () => {
        await expect(
            asyncPool(2, [1, 2, 3], async (x) => {
                if (x === 2) throw new Error('fail');
                return x;
            })
        ).rejects.toThrow('fail');
    });

    it('passes index as second argument to fn', async () => {
        const indices = [];
        await asyncPool(2, ['a', 'b', 'c'], async (item, idx) => {
            indices.push(idx);
        });
        expect(indices.sort()).toEqual([0, 1, 2]);
    });

    it('handles synchronous functions', async () => {
        const result = await asyncPool(2, [10, 20], (x) => x + 5);
        expect(result).toEqual([15, 25]);
    });
});

// ── matchesCheapRules ────────────────────────────────────────────────────

describe('matchesCheapRules', () => {
    const baseFile = { name: 'photo.jpg', type: 'image', size: 2 * 1024 * 1024, mtime: 1700000000000 };

    it('returns true when no rules are set', () => {
        expect(matchesCheapRules(baseFile, {})).toBe(true);
    });

    // fileType rules
    it('matches when fileType is "all"', () => {
        expect(matchesCheapRules(baseFile, { fileType: 'all' })).toBe(true);
    });

    it('matches when fileType matches', () => {
        expect(matchesCheapRules(baseFile, { fileType: 'image' })).toBe(true);
    });

    it('rejects when fileType does not match', () => {
        expect(matchesCheapRules(baseFile, { fileType: 'video' })).toBe(false);
    });

    // nameContains rules
    it('matches case-insensitive name substring', () => {
        expect(matchesCheapRules(baseFile, { nameContains: 'PHOTO' })).toBe(true);
    });

    it('matches partial name', () => {
        expect(matchesCheapRules(baseFile, { nameContains: 'oto' })).toBe(true);
    });

    it('rejects when name does not contain substring', () => {
        expect(matchesCheapRules(baseFile, { nameContains: 'video' })).toBe(false);
    });

    // size rules
    it('matches size > threshold', () => {
        expect(matchesCheapRules(baseFile, { sizeValue: 1, sizeOperator: '>' })).toBe(true);
    });

    it('rejects size > threshold when file is smaller', () => {
        expect(matchesCheapRules(baseFile, { sizeValue: 3, sizeOperator: '>' })).toBe(false);
    });

    it('matches size < threshold', () => {
        expect(matchesCheapRules(baseFile, { sizeValue: 3, sizeOperator: '<' })).toBe(true);
    });

    it('rejects size < threshold when file is larger', () => {
        expect(matchesCheapRules(baseFile, { sizeValue: 1, sizeOperator: '<' })).toBe(false);
    });

    it('ignores size rule when sizeValue is falsy', () => {
        expect(matchesCheapRules(baseFile, { sizeValue: 0, sizeOperator: '>' })).toBe(true);
    });

    it('ignores size rule when sizeOperator is falsy', () => {
        expect(matchesCheapRules(baseFile, { sizeValue: 1, sizeOperator: '' })).toBe(true);
    });

    it('rejects when size is exactly equal to threshold with >', () => {
        // file size is 2MB, threshold is 2MB → should reject (<=)
        expect(matchesCheapRules(baseFile, { sizeValue: 2, sizeOperator: '>' })).toBe(false);
    });

    it('rejects when size is exactly equal to threshold with <', () => {
        expect(matchesCheapRules(baseFile, { sizeValue: 2, sizeOperator: '<' })).toBe(false);
    });

    // date rules
    it('matches when mtime is after dateFrom', () => {
        expect(matchesCheapRules(baseFile, { dateFrom: 1600000000000 })).toBe(true);
    });

    it('rejects when mtime is before dateFrom', () => {
        expect(matchesCheapRules(baseFile, { dateFrom: 1800000000000 })).toBe(false);
    });

    it('matches when mtime is before dateTo', () => {
        expect(matchesCheapRules(baseFile, { dateTo: 1800000000000 })).toBe(true);
    });

    it('rejects when mtime is after dateTo', () => {
        expect(matchesCheapRules(baseFile, { dateTo: 1600000000000 })).toBe(false);
    });

    it('matches combined rules', () => {
        expect(matchesCheapRules(baseFile, {
            fileType: 'image',
            nameContains: 'photo',
            sizeValue: 1,
            sizeOperator: '>',
            dateFrom: 1600000000000,
            dateTo: 1800000000000,
        })).toBe(true);
    });

    it('rejects when one combined rule fails', () => {
        expect(matchesCheapRules(baseFile, {
            fileType: 'image',
            nameContains: 'missing',
        })).toBe(false);
    });
});

// ── POPCOUNT_TABLE ───────────────────────────────────────────────────────

describe('POPCOUNT_TABLE', () => {
    it('is a Uint8Array of length 256', () => {
        expect(POPCOUNT_TABLE).toBeInstanceOf(Uint8Array);
        expect(POPCOUNT_TABLE.length).toBe(256);
    });

    it('has popcount(0) = 0', () => {
        expect(POPCOUNT_TABLE[0]).toBe(0);
    });

    it('has popcount(1) = 1', () => {
        expect(POPCOUNT_TABLE[1]).toBe(1);
    });

    it('has popcount(255) = 8', () => {
        expect(POPCOUNT_TABLE[255]).toBe(8);
    });

    it('has popcount(128) = 1', () => {
        expect(POPCOUNT_TABLE[128]).toBe(1);
    });

    it('has popcount(170) = 4 (10101010)', () => {
        expect(POPCOUNT_TABLE[0b10101010]).toBe(4);
    });

    it('has correct values for every byte', () => {
        for (let i = 0; i < 256; i++) {
            const expected = i.toString(2).split('').filter(b => b === '1').length;
            expect(POPCOUNT_TABLE[i]).toBe(expected);
        }
    });
});

// ── hammingDistance ───────────────────────────────────────────────────────

describe('hammingDistance', () => {
    it('returns 0 for identical hashes', () => {
        expect(hammingDistance('aabbccdd', 'aabbccdd')).toBe(0);
    });

    it('returns correct distance for single-bit difference', () => {
        // 00 vs 01 = 1 bit different
        expect(hammingDistance('00', '01')).toBe(1);
    });

    it('returns correct distance for all-bits-different single byte', () => {
        // 00 vs ff = 8 bits different
        expect(hammingDistance('00', 'ff')).toBe(8);
    });

    it('handles multi-byte hashes', () => {
        // 0000 vs ffff = 16 bits different
        expect(hammingDistance('0000', 'ffff')).toBe(16);
    });

    it('is symmetric', () => {
        const d1 = hammingDistance('abcd', '1234');
        const d2 = hammingDistance('1234', 'abcd');
        expect(d1).toBe(d2);
    });

    it('compares up to the shorter hash length', () => {
        // 'aa' (1 byte) vs 'aabb' (2 bytes) — only 1 byte compared
        expect(hammingDistance('aa', 'aabb')).toBe(0);
    });

    it('works with a realistic 16-byte hash', () => {
        const h1 = '00000000000000000000000000000000';
        const h2 = 'ffffffffffffffffffffffffffffffff';
        expect(hammingDistance(h1, h2)).toBe(128);
    });

    it('returns 0 for empty hex strings', () => {
        expect(hammingDistance('', '')).toBe(0);
    });
});

// ── _qualityToParams ─────────────────────────────────────────────────────

describe('_qualityToParams', () => {
    // mp4/mov
    it('returns crf 22 for mp4 medium', () => {
        expect(_qualityToParams('mp4', 'medium')).toEqual({ crf: 22 });
    });

    it('returns crf 26 for mp4 low', () => {
        expect(_qualityToParams('mp4', 'low')).toEqual({ crf: 26 });
    });

    it('returns crf 18 for mp4 high', () => {
        expect(_qualityToParams('mp4', 'high')).toEqual({ crf: 18 });
    });

    it('returns same params for mov as mp4', () => {
        expect(_qualityToParams('mov', 'medium')).toEqual(_qualityToParams('mp4', 'medium'));
        expect(_qualityToParams('mov', 'low')).toEqual(_qualityToParams('mp4', 'low'));
        expect(_qualityToParams('mov', 'high')).toEqual(_qualityToParams('mp4', 'high'));
    });

    // webm
    it('returns crf 30 for webm medium', () => {
        expect(_qualityToParams('webm', 'medium')).toEqual({ crf: 30 });
    });

    it('returns crf 36 for webm low', () => {
        expect(_qualityToParams('webm', 'low')).toEqual({ crf: 36 });
    });

    it('returns crf 24 for webm high', () => {
        expect(_qualityToParams('webm', 'high')).toEqual({ crf: 24 });
    });

    // gif
    it('returns palette 128 for gif medium', () => {
        expect(_qualityToParams('gif', 'medium')).toEqual({ palette: 128 });
    });

    it('returns palette 64 for gif low', () => {
        expect(_qualityToParams('gif', 'low')).toEqual({ palette: 64 });
    });

    it('returns palette 256 for gif high', () => {
        expect(_qualityToParams('gif', 'high')).toEqual({ palette: 256 });
    });

    // webp-animated
    it('returns qv 75 for webp-animated medium', () => {
        expect(_qualityToParams('webp-animated', 'medium')).toEqual({ qv: 75 });
    });

    it('returns qv 50 for webp-animated low', () => {
        expect(_qualityToParams('webp-animated', 'low')).toEqual({ qv: 50 });
    });

    it('returns qv 90 for webp-animated high', () => {
        expect(_qualityToParams('webp-animated', 'high')).toEqual({ qv: 90 });
    });

    // webp (still image)
    it('returns qv 75 for webp medium', () => {
        expect(_qualityToParams('webp', 'medium')).toEqual({ qv: 75 });
    });

    // png (lossless)
    it('returns empty object for png', () => {
        expect(_qualityToParams('png', 'high')).toEqual({});
    });

    // jpg
    it('returns qv 4 for jpg medium', () => {
        expect(_qualityToParams('jpg', 'medium')).toEqual({ qv: 4 });
    });

    it('returns qv 8 for jpg low', () => {
        expect(_qualityToParams('jpg', 'low')).toEqual({ qv: 8 });
    });

    it('returns qv 2 for jpg high', () => {
        expect(_qualityToParams('jpg', 'high')).toEqual({ qv: 2 });
    });

    // default quality
    it('defaults to medium when quality is null', () => {
        expect(_qualityToParams('mp4', null)).toEqual({ crf: 22 });
    });

    it('defaults to medium when quality is undefined', () => {
        expect(_qualityToParams('mp4', undefined)).toEqual({ crf: 22 });
    });

    // unknown outputKind
    it('returns empty object for unknown output kind', () => {
        expect(_qualityToParams('flac', 'high')).toEqual({});
    });
});

// ── buildFfmpegArgs ──────────────────────────────────────────────────────

describe('buildFfmpegArgs', () => {
    const commonPrefix = ['-y', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats'];

    // ── trim operation ───────────────────────────────────────────────

    describe('trim operation', () => {
        it('builds stream-copy args for same-container trim', () => {
            const args = buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.mp4',
                operation: 'trim',
                params: { startSec: 10, endSec: 20 },
            });
            expect(args.slice(0, 7)).toEqual(commonPrefix);
            expect(args).toContain('-c');
            expect(args).toContain('copy');
            expect(args).toContain('-ss');
            expect(args).toContain('-to');
            expect(args).toContain('/in.mp4');
            expect(args[args.length - 1]).toBe('/out.mp4');
        });

        it('re-encodes when input/output containers differ', () => {
            const args = buildFfmpegArgs({
                inputPath: '/in.avi',
                outputPath: '/out.mp4',
                operation: 'trim',
                params: { startSec: 0, endSec: 5, mode: 'copy' },
            });
            // mode is forced to 'reencode' because extensions differ
            expect(args).toContain('libx264');
            expect(args).not.toContain('copy');
        });

        it('uses reencode mode when explicitly requested', () => {
            const args = buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.mp4',
                operation: 'trim',
                params: { startSec: 1, endSec: 3, mode: 'reencode' },
            });
            expect(args).toContain('libx264');
            expect(args).toContain('-pix_fmt');
            expect(args).toContain('yuv420p');
        });

        it('throws for invalid trim range (endSec <= startSec)', () => {
            expect(() => buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.mp4',
                operation: 'trim',
                params: { startSec: 10, endSec: 5 },
            })).toThrow('Invalid trim range');
        });

        it('throws for non-finite startSec', () => {
            expect(() => buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.mp4',
                operation: 'trim',
                params: { startSec: NaN, endSec: 5 },
            })).toThrow('Invalid trim range');
        });

        it('throws for non-finite endSec', () => {
            expect(() => buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.mp4',
                operation: 'trim',
                params: { startSec: 0, endSec: Infinity },
            })).toThrow('Invalid trim range');
        });

        it('throws when startSec equals endSec', () => {
            expect(() => buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.mp4',
                operation: 'trim',
                params: { startSec: 5, endSec: 5 },
            })).toThrow('Invalid trim range');
        });
    });

    // ── convert operation ────────────────────────────────────────────

    describe('convert to mp4', () => {
        it('builds basic mp4 args', () => {
            const args = buildFfmpegArgs({
                inputPath: '/in.avi',
                outputPath: '/out.mp4',
                operation: 'convert',
                params: { outputKind: 'mp4', quality: 'medium' },
            });
            expect(args).toContain('libx264');
            expect(args).toContain('-crf');
            expect(args).toContain('22');
            expect(args).toContain('format=yuv420p');
            expect(args[args.length - 1]).toBe('/out.mp4');
        });

        it('includes fps and width filters', () => {
            const args = buildFfmpegArgs({
                inputPath: '/in.avi',
                outputPath: '/out.mp4',
                operation: 'convert',
                params: { outputKind: 'mp4', quality: 'high', fps: 30, width: 1280 },
            });
            const vfIdx = args.indexOf('-vf');
            expect(vfIdx).toBeGreaterThan(-1);
            const vfVal = args[vfIdx + 1];
            expect(vfVal).toContain('fps=30');
            expect(vfVal).toContain('scale=1280:-2');
            expect(vfVal).toContain('format=yuv420p');
        });
    });

    describe('convert to mov', () => {
        it('uses libx264 like mp4', () => {
            const args = buildFfmpegArgs({
                inputPath: '/in.avi',
                outputPath: '/out.mov',
                operation: 'convert',
                params: { outputKind: 'mov', quality: 'low' },
            });
            expect(args).toContain('libx264');
            expect(args).toContain('26'); // low quality crf
        });
    });

    describe('convert to webm', () => {
        it('builds webm args with vp9', () => {
            const args = buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.webm',
                operation: 'convert',
                params: { outputKind: 'webm', quality: 'medium' },
            });
            expect(args).toContain('libvpx-vp9');
            expect(args).toContain('libopus');
            expect(args).toContain('30'); // crf
        });

        it('includes vf when width is set', () => {
            const args = buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.webm',
                operation: 'convert',
                params: { outputKind: 'webm', quality: 'medium', width: 720 },
            });
            const vfIdx = args.indexOf('-vf');
            expect(vfIdx).toBeGreaterThan(-1);
            expect(args[vfIdx + 1]).toContain('scale=720');
        });
    });

    describe('convert to gif', () => {
        it('builds gif args with palettegen', () => {
            const args = buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.gif',
                operation: 'convert',
                params: { outputKind: 'gif', quality: 'medium' },
            });
            const vfIdx = args.indexOf('-vf');
            expect(args[vfIdx + 1]).toContain('palettegen');
            expect(args[vfIdx + 1]).toContain('max_colors=128');
            expect(args).toContain('-loop');
            expect(args).toContain('0');
        });

        it('uses default fps=12 when fps is not set', () => {
            const args = buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.gif',
                operation: 'convert',
                params: { outputKind: 'gif', quality: 'medium' },
            });
            const vfIdx = args.indexOf('-vf');
            expect(args[vfIdx + 1]).toContain('fps=12');
        });

        it('uses custom fps when set', () => {
            const args = buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.gif',
                operation: 'convert',
                params: { outputKind: 'gif', quality: 'medium', fps: 24 },
            });
            const vfIdx = args.indexOf('-vf');
            expect(args[vfIdx + 1]).toContain('fps=24');
        });

        it('includes scale filter for width', () => {
            const args = buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.gif',
                operation: 'convert',
                params: { outputKind: 'gif', quality: 'high', width: 480 },
            });
            const vfIdx = args.indexOf('-vf');
            expect(args[vfIdx + 1]).toContain('scale=480');
        });
    });

    describe('convert to webp-animated', () => {
        it('builds webp-animated args', () => {
            const args = buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.webp',
                operation: 'convert',
                params: { outputKind: 'webp-animated', quality: 'high' },
            });
            expect(args).toContain('libwebp');
            expect(args).toContain('-quality');
            expect(args).toContain('90');
            expect(args).toContain('-loop');
        });
    });

    describe('convert to png (single frame)', () => {
        it('builds png args with -vframes 1', () => {
            const args = buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.png',
                operation: 'convert',
                params: { outputKind: 'png' },
            });
            expect(args).toContain('-vframes');
            expect(args).toContain('1');
        });

        it('includes scale filter for width', () => {
            const args = buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.png',
                operation: 'convert',
                params: { outputKind: 'png', width: 800 },
            });
            const vfIdx = args.indexOf('-vf');
            expect(vfIdx).toBeGreaterThan(-1);
            expect(args[vfIdx + 1]).toContain('scale=800');
        });
    });

    describe('convert to jpg (single frame)', () => {
        it('builds jpg args with quality', () => {
            const args = buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.jpg',
                operation: 'convert',
                params: { outputKind: 'jpg', quality: 'medium' },
            });
            expect(args).toContain('-vframes');
            expect(args).toContain('-q:v');
            expect(args).toContain('4');
        });
    });

    describe('convert to webp (single frame)', () => {
        it('builds webp still-image args', () => {
            const args = buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.webp',
                operation: 'convert',
                params: { outputKind: 'webp', quality: 'low' },
            });
            expect(args).toContain('-vframes');
            expect(args).toContain('-quality');
            expect(args).toContain('50');
        });
    });

    describe('frameOnly extraction', () => {
        it('extracts a single frame at seekSec', () => {
            const args = buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.jpg',
                operation: 'convert',
                params: { outputKind: 'jpg', frameOnly: true, seekSec: 5.5, quality: 'high' },
            });
            expect(args).toContain('-ss');
            expect(args).toContain('5.5');
            expect(args).toContain('-vframes');
            expect(args).toContain('1');
            expect(args).toContain('-q:v');
            expect(args).toContain('2');
        });

        it('defaults seekSec to 0 when not specified', () => {
            const args = buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.png',
                operation: 'convert',
                params: { outputKind: 'png', frameOnly: true },
            });
            const ssIdx = args.indexOf('-ss');
            expect(args[ssIdx + 1]).toBe('0');
        });

        it('applies width filter on frameOnly', () => {
            const args = buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.jpg',
                operation: 'convert',
                params: { outputKind: 'jpg', frameOnly: true, width: 640 },
            });
            const vfIdx = args.indexOf('-vf');
            expect(vfIdx).toBeGreaterThan(-1);
            expect(args[vfIdx + 1]).toContain('scale=640');
        });

        it('handles webp frameOnly with quality', () => {
            const args = buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.webp',
                operation: 'convert',
                params: { outputKind: 'webp', frameOnly: true, quality: 'medium' },
            });
            expect(args).toContain('-quality');
            expect(args).toContain('75');
        });
    });

    describe('unknown outputKind', () => {
        it('throws for unknown outputKind', () => {
            expect(() => buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.flac',
                operation: 'convert',
                params: { outputKind: 'flac' },
            })).toThrow('Unknown outputKind: flac');
        });
    });

    describe('unknown operation', () => {
        it('throws for unknown operation', () => {
            expect(() => buildFfmpegArgs({
                inputPath: '/in.mp4',
                outputPath: '/out.mp4',
                operation: 'rotate',
                params: {},
            })).toThrow('Unknown operation: rotate');
        });
    });
});

// ── _parseFfmpegProgressChunk ────────────────────────────────────────────

describe('_parseFfmpegProgressChunk', () => {
    it('parses out_time_us and returns percent', () => {
        const chunk = 'out_time_us=5000000\nprogress=continue\n';
        const result = _parseFfmpegProgressChunk(chunk, 10);
        expect(result.percent).toBeCloseTo(50, 0);
        expect(result.isEnd).toBe(false);
    });

    it('parses out_time_ms (treated as microseconds)', () => {
        const chunk = 'out_time_ms=5000000\nprogress=continue\n';
        const result = _parseFfmpegProgressChunk(chunk, 10);
        expect(result.percent).toBeCloseTo(50, 0);
        expect(result.isEnd).toBe(false);
    });

    it('prefers out_time_us over out_time_ms', () => {
        const chunk = 'out_time_us=8000000\nout_time_ms=2000000\nprogress=continue\n';
        const result = _parseFfmpegProgressChunk(chunk, 10);
        // out_time_us=8s → 80%
        expect(result.percent).toBeCloseTo(80, 0);
    });

    it('detects progress=end', () => {
        const chunk = 'out_time_us=10000000\nprogress=end\n';
        const result = _parseFfmpegProgressChunk(chunk, 10);
        expect(result.isEnd).toBe(true);
    });

    it('returns null percent when no time info present', () => {
        const chunk = 'speed=1.5x\nprogress=continue\n';
        const result = _parseFfmpegProgressChunk(chunk, 10);
        expect(result.percent).toBeNull();
    });

    it('returns null percent when totalSec is 0', () => {
        const chunk = 'out_time_us=5000000\n';
        const result = _parseFfmpegProgressChunk(chunk, 0);
        expect(result.percent).toBeNull();
    });

    it('returns null percent when totalSec is negative', () => {
        const chunk = 'out_time_us=5000000\n';
        const result = _parseFfmpegProgressChunk(chunk, -5);
        expect(result.percent).toBeNull();
    });

    it('returns null percent when totalSec is null', () => {
        const chunk = 'out_time_us=5000000\n';
        const result = _parseFfmpegProgressChunk(chunk, null);
        expect(result.percent).toBeNull();
    });

    it('caps percent at 99', () => {
        // 15 sec out of 10 sec total → would be 150%, should cap
        const chunk = 'out_time_us=15000000\nprogress=continue\n';
        const result = _parseFfmpegProgressChunk(chunk, 10);
        expect(result.percent).toBe(99);
    });

    it('floors percent at 0', () => {
        const chunk = 'out_time_us=0\nprogress=continue\n';
        const result = _parseFfmpegProgressChunk(chunk, 10);
        expect(result.percent).toBe(0);
    });

    it('handles Buffer input', () => {
        const chunk = Buffer.from('out_time_us=3000000\nprogress=continue\n');
        const result = _parseFfmpegProgressChunk(chunk, 10);
        expect(result.percent).toBeCloseTo(30, 0);
    });

    it('handles \\r\\n line endings', () => {
        const chunk = 'out_time_us=7000000\r\nprogress=continue\r\n';
        const result = _parseFfmpegProgressChunk(chunk, 10);
        expect(result.percent).toBeCloseTo(70, 0);
    });

    it('handles empty chunk', () => {
        const result = _parseFfmpegProgressChunk('', 10);
        expect(result.percent).toBeNull();
        expect(result.isEnd).toBe(false);
    });

    it('ignores lines with non-numeric out_time_us', () => {
        const chunk = 'out_time_us=N/A\nprogress=continue\n';
        const result = _parseFfmpegProgressChunk(chunk, 10);
        expect(result.percent).toBeNull();
    });
});
