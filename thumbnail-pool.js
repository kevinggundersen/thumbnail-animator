/**
 * Pool of thumbnail-generation worker threads.
 * Distributes thumbnail requests across workers, keeping the main process free.
 * Supports individual and batch requests with in-flight deduplication.
 */
const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');

class ThumbnailWorkerPool {
    constructor({ ffmpegPath, ffprobePath } = {}) {
        // Use fewer workers than dimension pool since thumbnail generation is I/O + CPU heavy
        this.workerCount = Math.min(Math.max(Math.floor(os.cpus().length / 2), 1), 4);
        this.ffmpegPath = ffmpegPath;
        this.ffprobePath = ffprobePath;
        this.workers = [];
        this.workerPath = path.join(__dirname, 'thumbnail-worker.js');
        this.nextWorker = 0;
        this._requestId = 0;
        this._pendingRequests = new Map(); // id -> { resolve, workerIndex }
        this._pendingJobs = new Map(); // thumbPath -> Promise (dedup)
        this._initWorkers();
    }

    _initWorkers() {
        for (let i = 0; i < this.workerCount; i++) {
            this._createWorker(i);
        }
    }

    _createWorker(index) {
        const worker = new Worker(this.workerPath, {
            workerData: {
                ffmpegPath: this.ffmpegPath,
                ffprobePath: this.ffprobePath
            }
        });

        worker.on('message', (msg) => {
            if (msg.type === 'result' && this._pendingRequests.has(msg.id)) {
                const { resolve, timeoutId } = this._pendingRequests.get(msg.id);
                clearTimeout(timeoutId);
                this._pendingRequests.delete(msg.id);
                resolve(msg);
            }
        });

        worker.on('error', (err) => {
            console.error(`Thumbnail worker ${index} error:`, err);
            // Resolve all pending requests for this worker as failures
            for (const [id, entry] of this._pendingRequests) {
                if (entry.workerIndex === index) {
                    clearTimeout(entry.timeoutId);
                    this._pendingRequests.delete(id);
                    entry.resolve({ id, success: false, thumbPath: null });
                }
            }
            try {
                this._createWorker(index);
            } catch {
                console.error(`Failed to recreate thumbnail worker ${index}`);
            }
        });

        this.workers[index] = worker;
    }

    _getNextWorker() {
        const worker = this.workers[this.nextWorker % this.workers.length];
        this.nextWorker++;
        return worker;
    }

    /**
     * Generate a thumbnail (image or video).
     * Returns { success, thumbPath } with in-flight deduplication.
     */
    async generate({ type, filePath, thumbPath, maxSize }) {
        // In-flight deduplication by thumbPath
        if (this._pendingJobs.has(thumbPath)) {
            return this._pendingJobs.get(thumbPath);
        }

        const id = ++this._requestId;
        const workerIndex = this.nextWorker % this.workers.length;
        const worker = this._getNextWorker();
        if (!worker) return { success: false, thumbPath: null };

        const promise = new Promise((resolve) => {
            const timeoutId = setTimeout(() => {
                if (this._pendingRequests.has(id)) {
                    this._pendingRequests.delete(id);
                    resolve({ id, success: false, thumbPath: null });
                }
            }, 30000);
            this._pendingRequests.set(id, { resolve, workerIndex, timeoutId });
            worker.postMessage({ id, type, filePath, thumbPath, maxSize });
        });

        this._pendingJobs.set(thumbPath, promise);
        try {
            return await promise;
        } finally {
            this._pendingJobs.delete(thumbPath);
        }
    }

    /**
     * Generate thumbnails in batch. Distributes across workers.
     * items: Array<{ type, filePath, thumbPath, maxSize? }>
     * Returns: Array<{ success, thumbPath }>
     */
    async generateBatch(items) {
        if (!items.length) return [];

        // Distribute items across workers round-robin
        const workerBatches = new Map(); // workerIndex -> items[]
        const resultMap = new Map(); // original index -> result

        const dedupPromises = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            // Check dedup - collect promises instead of awaiting inline
            if (this._pendingJobs.has(item.thumbPath)) {
                const idx = i;
                dedupPromises.push(
                    this._pendingJobs.get(item.thumbPath).then(result => {
                        resultMap.set(idx, result);
                    })
                );
                continue;
            }

            const workerIdx = i % this.workers.length;
            if (!workerBatches.has(workerIdx)) {
                workerBatches.set(workerIdx, []);
            }
            const id = ++this._requestId;
            workerBatches.get(workerIdx).push({ ...item, id, originalIndex: i });

            // Set up promise for this item
            const promise = new Promise((resolve) => {
                const timeoutId = setTimeout(() => {
                    if (this._pendingRequests.has(id)) {
                        this._pendingRequests.delete(id);
                        resolve({ id, success: false, thumbPath: null });
                    }
                }, 30000);
                this._pendingRequests.set(id, { resolve, workerIndex: workerIdx, timeoutId });
            });

            this._pendingJobs.set(item.thumbPath, promise);
        }

        // Send batches to workers
        const allPromises = [];
        for (const [workerIdx, batch] of workerBatches) {
            const worker = this.workers[workerIdx];
            if (!worker) continue;

            for (const item of batch) {
                worker.postMessage({
                    id: item.id,
                    type: item.type,
                    filePath: item.filePath,
                    thumbPath: item.thumbPath,
                    maxSize: item.maxSize
                });
                allPromises.push(
                    this._pendingJobs.get(item.thumbPath).then(result => {
                        resultMap.set(item.originalIndex, result);
                        this._pendingJobs.delete(item.thumbPath);
                    })
                );
            }
        }

        await Promise.all([...dedupPromises, ...allPromises]);

        // Return results in original order
        return items.map((_, i) => resultMap.get(i) || { success: false, thumbPath: null });
    }

    terminate() {
        for (const worker of this.workers) {
            if (worker) {
                try { worker.terminate(); } catch { /* ignore */ }
            }
        }
        this.workers = [];
        // Reject all pending requests
        for (const [id, { resolve, timeoutId }] of this._pendingRequests) {
            clearTimeout(timeoutId);
            resolve({ id, success: false, thumbPath: null });
        }
        this._pendingRequests.clear();
        this._pendingJobs.clear();
    }
}

module.exports = ThumbnailWorkerPool;
