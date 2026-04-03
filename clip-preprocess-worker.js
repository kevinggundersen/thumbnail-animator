/**
 * Worker thread for CLIP image preprocessing.
 * Uses sharp to resize/crop images to 224x224, then normalises pixel data
 * into a float32 CHW tensor ready for CLIP ViT-B/32 inference.
 *
 * Message protocol:
 *   Request:  { id, type: 'preprocess', files: Array<{ path, index }> }
 *   Response: { id, type: 'result', results: Array<{ index, pixels: Float32Array|null }> }
 */
const { parentPort } = require('worker_threads');

let sharp;
try {
    sharp = require('sharp');
    sharp.concurrency(2);
} catch {
    sharp = null;
}

const CLIP_SIZE = 224;
const CLIP_MEAN = [0.48145466, 0.4578275, 0.40821073];
const CLIP_STD  = [0.26862954, 0.26130258, 0.27577711];
const PIXELS    = CLIP_SIZE * CLIP_SIZE;

async function preprocessOne(filePath) {
    if (!sharp) return null;
    try {
        const buf = await sharp(filePath)
            .resize(CLIP_SIZE, CLIP_SIZE, { fit: 'cover', position: 'centre' })
            .removeAlpha()
            .raw()
            .toBuffer();

        // buf is RGB HWC uint8 (224*224*3 bytes). Convert to normalised float32 CHW.
        const tensor = new Float32Array(3 * PIXELS);
        for (let i = 0; i < PIXELS; i++) {
            const r = buf[i * 3]     / 255;
            const g = buf[i * 3 + 1] / 255;
            const b = buf[i * 3 + 2] / 255;
            tensor[i]               = (r - CLIP_MEAN[0]) / CLIP_STD[0];
            tensor[PIXELS + i]      = (g - CLIP_MEAN[1]) / CLIP_STD[1];
            tensor[2 * PIXELS + i]  = (b - CLIP_MEAN[2]) / CLIP_STD[2];
        }
        return tensor;
    } catch {
        return null;
    }
}

parentPort.on('message', async (msg) => {
    if (msg.type === 'preprocess') {
        const results = [];
        const transfers = [];
        for (const file of msg.files) {
            const pixels = await preprocessOne(file.path);
            results.push({ index: file.index, pixels });
            if (pixels) transfers.push(pixels.buffer);
        }
        parentPort.postMessage({ id: msg.id, type: 'result', results }, transfers);
    }
});
