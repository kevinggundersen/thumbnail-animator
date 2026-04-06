/**
 * Pool of dimension-scanning worker threads.
 * Distributes file batches across workers for parallel dimension scanning.
 */
const Piscina = require('piscina');
const path = require('path');
const os = require('os');

class DimensionWorkerPool {
    constructor(ffprobePath) {
        this.pool = new Piscina({
            filename: path.join(__dirname, 'dimension-worker.js'),
            minThreads: 2,
            maxThreads: Math.min(Math.max(os.cpus().length, 2), 8),
            workerData: { ffprobePath },
            concurrentTasksPerWorker: 4
        });
    }

    /**
     * Scan dimensions for a list of files using the worker pool.
     * @param {Array<{path: string, isImage: boolean}>} files
     * @returns {Promise<Map<string, {width: number, height: number}>>} Map from path to dimensions
     */
    async scanDimensions(files) {
        if (files.length === 0) return new Map();

        const results = await Promise.all(
            files.map(f => this.pool.run(f).catch(() => null))
        );

        const resultMap = new Map();
        for (const r of results) {
            if (r && r.width && r.height) {
                resultMap.set(r.path, { width: r.width, height: r.height });
            }
        }
        return resultMap;
    }

    terminate() {
        this.pool.destroy();
    }
}

module.exports = DimensionWorkerPool;
