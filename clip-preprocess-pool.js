/**
 * Pool of worker threads for CLIP image preprocessing.
 * Offloads sharp resize/crop/normalise from the main thread so it can overlap
 * with ONNX Runtime inference (true pipelining).
 */
const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');

class ClipPreprocessPool {
    constructor() {
        this.workerCount = Math.min(Math.max(os.cpus().length, 2), 4);
        this.workers = [];
        this.workerPath = path.join(__dirname, 'clip-preprocess-worker.js');
        this._nextId = 0;
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
            console.error(`CLIP preprocess worker ${index} error:`, err);
            try { this._createWorker(index); } catch { /* ignore */ }
        });
        this.workers[index] = worker;
    }

    /**
     * Preprocess a batch of image files into CLIP-ready float32 CHW tensors.
     * @param {string[]} filePaths - Array of image file paths
     * @returns {Promise<(Float32Array|null)[]>} Tensors in the same order as filePaths
     */
    async preprocessBatch(filePaths) {
        if (filePaths.length === 0) return [];
        if (this.workers.length === 0) return filePaths.map(() => null);

        // Distribute files across workers round-robin
        const workerJobs = new Map(); // workerIndex -> files[]
        for (let i = 0; i < filePaths.length; i++) {
            const wi = i % this.workers.length;
            if (!workerJobs.has(wi)) workerJobs.set(wi, []);
            workerJobs.get(wi).push({ path: filePaths[i], index: i });
        }

        const id = this._nextId++;
        const results = new Array(filePaths.length).fill(null);

        const promises = [];
        for (const [wi, files] of workerJobs) {
            const worker = this.workers[wi];
            if (!worker) continue;

            promises.push(new Promise((resolve) => {
                const onMessage = (msg) => {
                    if (msg.id === id && msg.type === 'result') {
                        worker.removeListener('message', onMessage);
                        worker.removeListener('error', onError);
                        for (const r of msg.results) {
                            results[r.index] = r.pixels;
                        }
                        resolve();
                    }
                };
                const onError = () => {
                    worker.removeListener('message', onMessage);
                    resolve();
                };
                worker.on('message', onMessage);
                worker.once('error', onError);
                worker.postMessage({ id, type: 'preprocess', files });
            }));
        }

        await Promise.all(promises);
        return results;
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

module.exports = ClipPreprocessPool;
