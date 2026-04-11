/**
 * Pool of thumbnail-generation worker threads.
 * Distributes thumbnail requests across workers, keeping the main process free.
 * Supports individual and batch requests with in-flight deduplication.
 */
const Piscina = require('piscina');
const path = require('path');
const os = require('os');

class ThumbnailWorkerPool {
    constructor({ ffmpegPath, ffprobePath } = {}) {
        // Use fewer workers than dimension pool since thumbnail generation is I/O + CPU heavy
        this.pool = new Piscina({
            filename: path.join(__dirname, 'thumbnail-worker.js'),
            minThreads: 1,
            maxThreads: Math.min(Math.max(Math.floor(os.cpus().length / 2), 1), 4),
            workerData: { ffmpegPath, ffprobePath },
            concurrentTasksPerWorker: 2
        });
        this._pendingJobs = new Map(); // thumbPath -> Promise (dedup)
    }

    /**
     * Generate a thumbnail (image or video).
     * Returns { success, thumbPath, dHash? } with in-flight deduplication.
     * Pass computeDHash: true to compute perceptual hash from the thumbnail.
     */
    async generate(item) {
        const { thumbPath } = item;
        // In-flight deduplication by thumbPath
        if (this._pendingJobs.has(thumbPath)) {
            return this._pendingJobs.get(thumbPath);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        const promise = this.pool.run(
            item,
            { signal: controller.signal }
        ).catch(() => ({ success: false, thumbPath: null, dHash: null }))
         .finally(() => clearTimeout(timeout));

        this._pendingJobs.set(thumbPath, promise);
        try {
            return await promise;
        } finally {
            this._pendingJobs.delete(thumbPath);
        }
    }

    /**
     * Generate thumbnails in batch. Distributes across workers.
     * items: Array<{ type, filePath, thumbPath, maxSize?, computeDHash? }>
     * Returns: Array<{ success, thumbPath, dHash? }>
     */
    async generateBatch(items) {
        if (!items.length) return [];
        return Promise.all(items.map(item => this.generate(item)));
    }

    terminate() {
        this.pool.destroy();
        this._pendingJobs.clear();
    }
}

module.exports = ThumbnailWorkerPool;
