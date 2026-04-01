/**
 * Pool of dimension-scanning worker threads.
 * Distributes file batches across workers for parallel dimension scanning.
 */
const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');

class DimensionWorkerPool {
    constructor(ffprobePath) {
        this.workerCount = Math.min(Math.max(os.cpus().length, 2), 8);
        this.ffprobePath = ffprobePath;
        this.workers = [];
        this.workerPath = path.join(__dirname, 'dimension-worker.js');
        this._requestId = 0;
        this._initWorkers();
    }

    _initWorkers() {
        for (let i = 0; i < this.workerCount; i++) {
            this._createWorker(i);
        }
    }

    _createWorker(index) {
        const worker = new Worker(this.workerPath, {
            workerData: { ffprobePath: this.ffprobePath }
        });
        worker.on('error', (err) => {
            console.error(`Dimension worker ${index} error:`, err);
            // Recreate crashed worker
            try {
                this._createWorker(index);
            } catch {
                console.error(`Failed to recreate worker ${index}`);
            }
        });
        this.workers[index] = worker;
    }

    /**
     * Scan dimensions for a list of files using the worker pool.
     * @param {Array<{path: string, isImage: boolean}>} files
     * @returns {Promise<Map<string, {width: number, height: number}>>} Map from path to dimensions
     */
    async scanDimensions(files) {
        if (files.length === 0) return new Map();

        // Split files across workers
        const chunkSize = Math.ceil(files.length / this.workerCount);
        const chunks = [];
        for (let i = 0; i < files.length; i += chunkSize) {
            chunks.push(files.slice(i, i + chunkSize));
        }

        // Send each chunk to a worker and collect results
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
                        resolve(msg.results);
                    }
                };
                const onError = () => {
                    worker.removeListener('message', onMessage);
                    resolve([]); // Return empty results for crashed worker's chunk
                };
                worker.on('message', onMessage);
                worker.once('error', onError);
                worker.postMessage({ type: 'scan', files: chunk, requestId });
            });
        });

        const allResults = await Promise.all(promises);
        const resultMap = new Map();
        for (const results of allResults) {
            for (const r of results) {
                if (r.width && r.height) {
                    resultMap.set(r.path, { width: r.width, height: r.height });
                }
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

module.exports = DimensionWorkerPool;
