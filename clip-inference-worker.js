/**
 * CLIP Inference Worker Thread
 *
 * Loads the native-scanner NAPI addon (Rust + ONNX Runtime) and runs CLIP
 * inference off the main thread. Native Rust NAPI addons are safe to load in
 * worker_threads (unlike onnxruntime-node which has ABI conflicts).
 *
 * Message protocol (parent -> worker):
 *   { type: 'init', visionPath, textPath, threads }
 *   { type: 'embed-batch', id, batchData: Float32Array, n: number }
 *   { type: 'embed-text-tokens', id, inputIds: Array<number>, attentionMask: Array<number>, batchSize: number }
 *   { type: 'shutdown' }
 *
 * Worker -> parent:
 *   { type: 'init-result', ok, error }
 *   { type: 'embed-batch-result', id, embeddings: Float32Array }
 *   { type: 'embed-error', id, error }
 */

'use strict';

const { parentPort } = require('worker_threads');
const path = require('path');

let nativeScanner = null;
try {
    nativeScanner = require('./native-scanner');
} catch (err) {
    parentPort.postMessage({ type: 'init-result', ok: false, error: 'native-scanner load failed: ' + err.message });
}

parentPort.on('message', (msg) => {
    if (!msg || !msg.type) return;

    switch (msg.type) {
        case 'init': {
            try {
                if (!nativeScanner || !nativeScanner.clipInit) {
                    parentPort.postMessage({ type: 'init-result', ok: false, error: 'clipInit not available' });
                    return;
                }
                nativeScanner.clipInit(msg.visionPath, msg.textPath, msg.threads || 4, msg.gpuMode === true);
                parentPort.postMessage({ type: 'init-result', ok: true });
            } catch (err) {
                parentPort.postMessage({ type: 'init-result', ok: false, error: err.message });
            }
            break;
        }
        case 'embed-batch': {
            try {
                const flat = nativeScanner.clipEmbedImageBatch(msg.batchData, msg.n);
                // Structured clone copies the typed array — no transfer needed.
                parentPort.postMessage({ type: 'embed-batch-result', id: msg.id, embeddings: flat });
            } catch (err) {
                parentPort.postMessage({ type: 'embed-error', id: msg.id, error: err.message || String(err) });
            }
            break;
        }
        case 'embed-text-tokens': {
            try {
                const flat = nativeScanner.clipEmbedTextTokens(msg.inputIds, msg.attentionMask, msg.batchSize);
                parentPort.postMessage({ type: 'embed-batch-result', id: msg.id, embeddings: flat });
            } catch (err) {
                parentPort.postMessage({ type: 'embed-error', id: msg.id, error: err.message || String(err) });
            }
            break;
        }
        case 'preprocess-and-embed': {
            try {
                const flat = nativeScanner.clipPreprocessAndEmbed(msg.paths);
                parentPort.postMessage({ type: 'embed-batch-result', id: msg.id, embeddings: flat });
            } catch (err) {
                parentPort.postMessage({ type: 'embed-error', id: msg.id, error: err.message || String(err) });
            }
            break;
        }
        case 'shutdown': {
            try { if (nativeScanner && nativeScanner.clipUnload) nativeScanner.clipUnload(); } catch {}
            process.exit(0);
            break;
        }
    }
});
