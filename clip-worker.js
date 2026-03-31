/**
 * Worker thread for generating CLIP embeddings from images and text.
 * Uses @xenova/transformers which auto-downloads and caches models from HuggingFace Hub.
 */
const { parentPort } = require('worker_threads');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

sharp.concurrency(2);

const MODEL_NAME = 'Xenova/clip-vit-base-patch32';

let env = null;
let CLIPVisionModelWithProjection = null;
let CLIPTextModelWithProjection = null;
let AutoProcessor = null;
let AutoTokenizer = null;
let RawImage = null;

let visionModel = null;
let textModel = null;
let processor = null;
let tokenizer = null;

async function initModel(cacheDir, onProgress) {
    try {
        // Lazy-require so the module only loads when the worker is actually used
        const transformers = require('@xenova/transformers');
        env = transformers.env;
        CLIPVisionModelWithProjection = transformers.CLIPVisionModelWithProjection;
        CLIPTextModelWithProjection   = transformers.CLIPTextModelWithProjection;
        AutoProcessor = transformers.AutoProcessor;
        AutoTokenizer = transformers.AutoTokenizer;
        RawImage      = transformers.RawImage;

        // Point the cache at the app's userData folder so models survive updates
        env.cacheDir = cacheDir;
        // Disable the remote model check on every load (use cached if available)
        env.allowLocalModels = true;
        env.allowRemoteModels = true;

        const opts = { progress_callback: onProgress };

        // Load vision model + processor
        [processor, visionModel] = await Promise.all([
            AutoProcessor.from_pretrained(MODEL_NAME, opts),
            CLIPVisionModelWithProjection.from_pretrained(MODEL_NAME, opts),
        ]);

        // Load text model + tokenizer
        [tokenizer, textModel] = await Promise.all([
            AutoTokenizer.from_pretrained(MODEL_NAME, opts),
            CLIPTextModelWithProjection.from_pretrained(MODEL_NAME, opts),
        ]);

        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

function l2Normalize(tensor) {
    const data = tensor.data;
    let mag = 0;
    for (let i = 0; i < data.length; i++) mag += data[i] * data[i];
    mag = Math.sqrt(mag);
    if (mag === 0) return Array.from(data);
    const out = new Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data[i] / mag;
    return out;
}

async function embedImage(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    // Use sharp to decode to raw RGB (handles GIF/WEBP first-frame, etc.)
    const sharpInst = (ext === '.gif' || ext === '.webp')
        ? sharp(filePath, { pages: 1 })
        : sharp(filePath);

    const { data, info } = await sharpInst
        .resize(224, 224, { fit: 'cover', position: 'centre' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    // Node.js Buffers share an underlying pool ArrayBuffer — byteOffset may not be 0.
    // Slice correctly to get only this image's bytes before wrapping in Uint8ClampedArray.
    const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const image = new RawImage(new Uint8ClampedArray(ab), info.width, info.height, 3);
    const inputs = await processor(image);
    const { image_embeds } = await visionModel(inputs);
    return l2Normalize(image_embeds);
}

async function embedText(text) {
    const inputs = tokenizer(text, { padding: true, truncation: true });
    const { text_embeds } = await textModel(inputs);
    return l2Normalize(text_embeds);
}

async function processImageBatch(files) {
    const results = [];
    for (const file of files) {
        const result = { path: file.path, embedding: null };
        try {
            const source = file.thumbPath && fs.existsSync(file.thumbPath)
                ? file.thumbPath
                : file.path;
            result.embedding = await embedImage(source);
        } catch {
            // File unreadable or unsupported format — skip
        }
        results.push(result);
    }
    return results;
}

// Prevent unhandled rejections from crashing the worker process
process.on('uncaughtException', (err) => {
    console.error('[clip-worker] uncaught exception:', err.message);
});
process.on('unhandledRejection', (err) => {
    console.error('[clip-worker] unhandled rejection:', err);
});

parentPort.on('message', async (msg) => {
    if (msg.type === 'init') {
        const result = await initModel(msg.cacheDir, (progress) => {
            parentPort.postMessage({ type: 'download-progress', progress });
        });
        parentPort.postMessage({ type: 'init-result', ...result });

    } else if (msg.type === 'embed-images') {
        if (!visionModel) {
            parentPort.postMessage({ type: 'result', results: [] });
            return;
        }
        const results = await processImageBatch(msg.files);
        parentPort.postMessage({ type: 'result', results });

    } else if (msg.type === 'embed-text') {
        if (!textModel) {
            parentPort.postMessage({ type: 'text-result', embedding: null });
            return;
        }
        try {
            const embedding = await embedText(msg.text);
            parentPort.postMessage({ type: 'text-result', embedding });
        } catch {
            parentPort.postMessage({ type: 'text-result', embedding: null });
        }
    }
});
