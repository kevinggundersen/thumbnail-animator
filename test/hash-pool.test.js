const HashWorkerPool = require('../hash-pool');

// Helper: replace pool.run with a mock that simulates hash results
function mockPoolRun(pool) {
    pool.pool.run = vi.fn(async (files) => {
        return files.map(f => ({
            path: f.path,
            exactHash: `exact_${f.path}`,
            perceptualHash: `phash_${f.path}`,
        }));
    });
}

// ── Constructor ───────────────────────────────────────────────────────

describe('HashWorkerPool constructor', () => {
    it('creates a pool with workerCount between 2 and 8', () => {
        const pool = new HashWorkerPool();
        expect(pool.workerCount).toBeGreaterThanOrEqual(2);
        expect(pool.workerCount).toBeLessThanOrEqual(8);
        pool.terminate();
    });

    it('has a piscina pool instance', () => {
        const pool = new HashWorkerPool();
        expect(pool.pool).toBeDefined();
        expect(typeof pool.pool.run).toBe('function');
        expect(typeof pool.pool.destroy).toBe('function');
        pool.terminate();
    });
});

// ── scanHashes ────────────────────────────────────────────────────────

describe('scanHashes', () => {
    let pool;

    beforeEach(() => {
        pool = new HashWorkerPool();
        mockPoolRun(pool);
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

    it('sends chunks to pool.run()', async () => {
        const files = [
            { path: '/a.jpg', isImage: true, isVideo: false },
            { path: '/b.jpg', isImage: true, isVideo: false },
        ];

        await pool.scanHashes(files);

        expect(pool.pool.run).toHaveBeenCalled();
        for (const call of pool.pool.run.mock.calls) {
            expect(Array.isArray(call[0])).toBe(true);
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

    it('handles pool.run() rejection gracefully', async () => {
        pool.pool.run = vi.fn(async () => { throw new Error('worker crash'); });

        const files = [{ path: '/a.jpg', isImage: true, isVideo: false }];
        const result = await pool.scanHashes(files);
        expect(result).toBeInstanceOf(Map);
        expect(result.size).toBe(0);
    });
});

// ── terminate ─────────────────────────────────────────────────────────

describe('terminate', () => {
    it('destroys the piscina pool', () => {
        const pool = new HashWorkerPool();
        const destroySpy = vi.spyOn(pool.pool, 'destroy');
        pool.terminate();
        expect(destroySpy).toHaveBeenCalled();
    });
});
