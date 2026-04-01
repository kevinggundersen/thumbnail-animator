/**
 * Pool of hash-computing worker threads.
 * Distributes file batches across workers for parallel hashing.
 */
const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');

class HashWorkerPool {
    constructor() {
        this.workerCount = Math.min(Math.max(os.cpus().length, 2), 8);
        this.workers = [];
        this.workerPath = path.join(__dirname, 'hash-worker.js');
        this._requestId = 0;
        this._initWorkers();
    }

    _initWorkers() {
        for (let i = 0; i < this.workerCount; i++) {
            this._createWorker(i);
        }
    }

    _createWorker(index) {
        const worker = new Worker(this.workerPath);
        worker.on('error', (err) => {
            console.error(`Hash worker ${index} error:`, err);
            try {
                this._createWorker(index);
            } catch {
                console.error(`Failed to recreate hash worker ${index}`);
            }
        });
        this.workers[index] = worker;
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
        const promises = chunks.map((chunk, i) => {
            const workerIndex = i % this.workers.length;
            const worker = this.workers[workerIndex];
            if (!worker) return Promise.resolve([]);

            const requestId = ++this._requestId;
            return new Promise((resolve) => {
                const onMessage = (msg) => {
                    if (msg.type === 'result' && msg.requestId === requestId) {
                        worker.removeListener('message', onMessage);
                        worker.removeListener('error', onError);
                        completed += chunk.length;
                        if (onProgress) onProgress(completed, files.length);
                        resolve(msg.results);
                    }
                };
                const onError = () => {
                    worker.removeListener('message', onMessage);
                    resolve([]); // Return empty results for crashed worker's chunk
                };
                worker.on('message', onMessage);
                worker.once('error', onError);
                worker.postMessage({ type: 'hash', files: chunk, requestId });
            });
        });

        const allResults = await Promise.all(promises);
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
        for (const worker of this.workers) {
            if (worker) {
                try { worker.terminate(); } catch { /* ignore */ }
            }
        }
        this.workers = [];
    }
}

module.exports = HashWorkerPool;
