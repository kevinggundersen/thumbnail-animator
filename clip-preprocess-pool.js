/**
 * Pool of worker threads for CLIP image preprocessing.
 * Offloads sharp resize/crop/normalise from the main thread so it can overlap
 * with ONNX Runtime inference (true pipelining).
 */
const Piscina = require('piscina');
const path = require('path');
const os = require('os');

class ClipPreprocessPool {
    constructor() {
        this.pool = new Piscina({
            filename: path.join(__dirname, 'clip-preprocess-worker.js'),
            minThreads: 2,
            maxThreads: Math.min(Math.max(os.cpus().length, 2), 4),
            concurrentTasksPerWorker: 2
        });
    }

    /**
     * Preprocess a batch of image files into CLIP-ready float32 CHW tensors.
     * @param {string[]} filePaths - Array of image file paths
     * @returns {Promise<(Float32Array|null)[]>} Tensors in the same order as filePaths
     */
    async preprocessBatch(filePaths) {
        if (filePaths.length === 0) return [];
        return Promise.all(
            filePaths.map(fp => this.pool.run(fp).catch(() => null))
        );
    }

    terminate() {
        this.pool.destroy();
    }
}

module.exports = ClipPreprocessPool;
