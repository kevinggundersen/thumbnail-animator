/**
 * Worker thread for CLIP image preprocessing.
 * Uses sharp to resize/crop images to 224x224, then normalises pixel data
 * into a float32 CHW tensor ready for CLIP ViT-B/32 inference.
 *
 * Piscina protocol: export a single async function that processes one file.
 */
const Piscina = require('piscina');

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

module.exports = async function(filePath) {
    const tensor = await preprocessOne(filePath);
    return tensor ? Piscina.move(tensor) : null;
};
