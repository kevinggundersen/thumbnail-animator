/**
 * Pool of CLIP embedding worker threads.
 * Handles lazy model initialization, image batch distribution, and text embedding.
 */
const { Worker } = require('worker_threads');
const path = require('path');

class ClipWorkerPool {
    constructor() {
        this.workerCount = 2;
        this.workers = [];
        this.workerPath = path.join(__dirname, 'clip-worker.js');
        this._ready = false;
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
            console.error(`CLIP worker ${index} error:`, err);
            try {
                this._createWorker(index);
            } catch {
                console.error(`Failed to recreate CLIP worker ${index}`);
            }
        });
        this.workers[index] = worker;
    }

    /**
     * Load the ONNX model in all workers. Must be called before embedImages/embedText.
     * @param {string} modelDir - Directory containing the .onnx model files
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    /**
     * @param {string} cacheDir - App userData path; models are stored here
     * @param {function} [onDownloadProgress] - Called with raw progress objects from transformers.js
     */
    async init(cacheDir, onDownloadProgress) {
        // Only the first worker does the actual download; the rest load from cache.
        // We initialise them sequentially so progress events are clean.
        for (let i = 0; i < this.workers.length; i++) {
            const worker = this.workers[i];
            if (!worker) continue;

            const result = await new Promise((resolve) => {
                const onMessage = (msg) => {
                    if (msg.type === 'download-progress') {
                        if (onDownloadProgress) onDownloadProgress(msg.progress);
                    } else if (msg.type === 'init-result') {
                        worker.removeListener('message', onMessage);
                        resolve(msg);
                    }
                };
                worker.on('message', onMessage);
                worker.postMessage({ type: 'init', cacheDir });
            });

            if (!result.success) {
                this._ready = false;
                return { success: false, error: result.error };
            }
        }

        this._ready = true;
        return { success: true };
    }

    isReady() {
        return this._ready;
    }

    /**
     * Embed a batch of image files, distributing across workers.
     * @param {Array<{path: string, thumbPath?: string}>} files
     * @param {function} [onProgress] - Called with (completed, total)
     * @returns {Promise<Array<{path: string, embedding: number[]|null}>>}
     */
    async embedImages(files, onProgress) {
        if (files.length === 0) return [];
        if (!this._ready) return files.map(f => ({ path: f.path, embedding: null }));

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

            return new Promise((resolve) => {
                const onMessage = (msg) => {
                    if (msg.type === 'result') {
                        worker.removeListener('message', onMessage);
                        worker.removeListener('error', onError);
                        completed += chunk.length;
                        if (onProgress) onProgress(completed, files.length);
                        resolve(msg.results);
                    }
                };
                const onError = () => {
                    worker.removeListener('message', onMessage);
                    resolve(chunk.map(f => ({ path: f.path, embedding: null })));
                };
                worker.on('message', onMessage);
                worker.once('error', onError);
                worker.postMessage({ type: 'embed-images', files: chunk });
            });
        });

        const allResults = await Promise.all(promises);
        return allResults.flat();
    }

    /**
     * Embed a text query using the first available worker.
     * @param {string} text
     * @returns {Promise<number[]|null>}
     */
    async embedText(text) {
        if (!this._ready || this.workers.length === 0) return null;
        const worker = this.workers[0];
        if (!worker) return null;

        return new Promise((resolve) => {
            const onMessage = (msg) => {
                if (msg.type === 'text-result') {
                    worker.removeListener('message', onMessage);
                    resolve(msg.embedding);
                }
            };
            worker.on('message', onMessage);
            worker.postMessage({ type: 'embed-text', text });
        });
    }

    terminate() {
        this._ready = false;
        for (const worker of this.workers) {
            if (worker) {
                try { worker.terminate(); } catch { /* ignore */ }
            }
        }
        this.workers = [];
    }
}

module.exports = ClipWorkerPool;
