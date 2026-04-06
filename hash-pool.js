/**
 * Pool of hash-computing worker threads.
 * Distributes file batches across workers for parallel hashing.
 */
const Piscina = require('piscina');
const path = require('path');
const os = require('os');

class HashWorkerPool {
    constructor() {
        this.workerCount = Math.min(Math.max(os.cpus().length, 2), 8);
        this.pool = new Piscina({
            filename: path.join(__dirname, 'hash-worker.js'),
            minThreads: this.workerCount,
            maxThreads: this.workerCount,
            concurrentTasksPerWorker: 1
        });
    }

    /**
     * Compute hashes for a list of files using the worker pool.
     * @param {Array<{path: string, thumbPath?: string, isImage: boolean, isVideo: boolean}>} files
     * @param {function} [onProgress] - Called with (completed, total)
     * @returns {Promise<Map<string, {exactHash: string|null, perceptualHash: string|null}>>}
     */
    async scanHashes(files, onProgress) {
        if (files.length === 0) return new Map();

        const chunkSize = Math.ceil(files.length / this.workerCount);
        const chunks = [];
        for (let i = 0; i < files.length; i += chunkSize) {
            chunks.push(files.slice(i, i + chunkSize));
        }

        let completed = 0;
        const allResults = await Promise.all(
            chunks.map(async (chunk) => {
                const results = await this.pool.run(chunk).catch(() => []);
                completed += chunk.length;
                if (onProgress) onProgress(completed, files.length);
                return results;
            })
        );

        const resultMap = new Map();
        for (const results of allResults) {
            for (const r of results) {
                resultMap.set(r.path, {
                    exactHash: r.exactHash,
                    perceptualHash: r.perceptualHash
                });
            }
        }
        return resultMap;
    }

    terminate() {
        this.pool.destroy();
    }
}

module.exports = HashWorkerPool;
