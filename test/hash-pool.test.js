// Mock worker_threads is set up globally via setup-db-alias.js
// which redirects require('worker_threads') to test/mock-worker-threads.js.
const { allMockWorkers } = require('./mock-worker-threads');
const HashWorkerPool = require('../hash-pool');

beforeEach(() => {
    allMockWorkers.length = 0;
});

// ── Constructor ───────────────────────────────────────────────────────

describe('HashWorkerPool constructor', () => {
    it('creates between 2 and 8 workers', () => {
        const pool = new HashWorkerPool();
        expect(pool.workers.length).toBeGreaterThanOrEqual(2);
        expect(pool.workers.length).toBeLessThanOrEqual(8);
        pool.terminate();
    });

    it('workerCount matches the workers array length', () => {
        const pool = new HashWorkerPool();
        expect(pool.workers.length).toBe(pool.workerCount);
        pool.terminate();
    });

    it('passes hash-worker.js path to each Worker', () => {
        const pool = new HashWorkerPool();
        for (const worker of pool.workers) {
            expect(worker.__workerPath).toMatch(/hash-worker\.js$/);
        }
        pool.terminate();
    });
});

// ── scanHashes ────────────────────────────────────────────────────────

describe('scanHashes', () => {
    let pool;

    beforeEach(() => {
        pool = new HashWorkerPool();
    });

    afterEach(() => {
        pool.terminate();
    });

    it('returns empty Map for empty file list', async () => {
        const result = await pool.scanHashes([]);
        expect(result).toBeInstanceOf(Map);
        expect(result.size).toBe(0);
    });

    it('distributes files and collects results into a Map', async () => {
        const files = [
            { path: '/a.jpg', isImage: true, isVideo: false },
            { path: '/b.jpg', isImage: true, isVideo: false },
            { path: '/c.mp4', isImage: false, isVideo: true },
        ];

        const result = await pool.scanHashes(files);
        expect(result).toBeInstanceOf(Map);
        expect(result.size).toBe(3);
        expect(result.get('/a.jpg').exactHash).toBe('exact_/a.jpg');
        expect(result.get('/b.jpg').perceptualHash).toBe('phash_/b.jpg');
        expect(result.get('/c.mp4').exactHash).toBe('exact_/c.mp4');
    });

    it('sends hash messages to workers via postMessage', async () => {
        const files = [
            { path: '/a.jpg', isImage: true, isVideo: false },
            { path: '/b.jpg', isImage: true, isVideo: false },
        ];

        await pool.scanHashes(files);

        const messaged = pool.workers.filter(w => w.__messages.length > 0);
        expect(messaged.length).toBeGreaterThan(0);
        for (const w of messaged) {
            expect(w.__messages[0].type).toBe('hash');
            expect(Array.isArray(w.__messages[0].files)).toBe(true);
        }
    });

    it('calls onProgress callback with (completed, total)', async () => {
        const files = [
            { path: '/a.jpg', isImage: true, isVideo: false },
            { path: '/b.jpg', isImage: true, isVideo: false },
        ];
        const onProgress = vi.fn();

        await pool.scanHashes(files, onProgress);

        expect(onProgress).toHaveBeenCalled();
        const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1];
        expect(lastCall[0]).toBe(files.length);
        expect(lastCall[1]).toBe(files.length);
    });

    it('handles single file', async () => {
        const files = [{ path: '/only.jpg', isImage: true, isVideo: false }];
        const result = await pool.scanHashes(files);
        expect(result.size).toBe(1);
        expect(result.has('/only.jpg')).toBe(true);
    });

    it('handles many files (more than worker count)', async () => {
        const files = Array.from({ length: 50 }, (_, i) => ({
            path: `/file${i}.jpg`,
            isImage: true,
            isVideo: false,
        }));

        const result = await pool.scanHashes(files);
        expect(result.size).toBe(50);
    });
});

// ── Worker error recovery ─────────────────────────────────────────────

describe('worker error recovery', () => {
    let consoleSpy;
    beforeEach(() => { consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
    afterEach(() => { consoleSpy.mockRestore(); });

    it('recreates a worker when one emits error', () => {
        const pool = new HashWorkerPool();
        const originalWorker = pool.workers[0];

        originalWorker.emit('error', new Error('worker crashed'));

        expect(pool.workers[0]).not.toBe(originalWorker);
        pool.terminate();
    });

    it('scanHashes resolves with empty results for crashed worker chunk', async () => {
        const pool = new HashWorkerPool();

        // Make the first worker crash instead of returning results
        pool.workers[0].postMessage = function (msg) {
            process.nextTick(() => {
                this.emit('error', new Error('crash'));
            });
        };

        const files = [{ path: '/a.jpg', isImage: true, isVideo: false }];
        const result = await pool.scanHashes(files);
        expect(result).toBeInstanceOf(Map);
        pool.terminate();
    });
});

// ── terminate ─────────────────────────────────────────────────────────

describe('terminate', () => {
    it('terminates all workers', () => {
        const pool = new HashWorkerPool();
        const workers = [...pool.workers];
        pool.terminate();

        for (const w of workers) {
            expect(w.__terminated).toBe(true);
        }
    });

    it('clears the workers array', () => {
        const pool = new HashWorkerPool();
        pool.terminate();
        expect(pool.workers).toEqual([]);
    });

    it('handles null workers in the array', () => {
        const pool = new HashWorkerPool();
        pool.workers[0] = null;
        expect(() => pool.terminate()).not.toThrow();
    });
});
