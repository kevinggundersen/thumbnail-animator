/**
 * Worker thread for computing file hashes (exact + perceptual).
 * Piscina protocol: export a single async function that processes a batch of files.
 * Batch dispatch is used (rather than per-item) to preserve chunk-level progress
 * reporting and internal mini-batching for sharp pipeline overlap.
 */
const crypto = require('crypto');
const fs = require('fs');
const sharp = require('sharp');

sharp.concurrency(2);

async function computeExactHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

function pixelsToDHashHex(pixels) {
    const bytes = new Uint8Array(8);
    let byteIdx = 0, bitIdx = 7;
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            if (pixels[row * 9 + col] > pixels[row * 9 + col + 1]) {
                bytes[byteIdx] |= (1 << bitIdx);
            }
            if (--bitIdx < 0) { bitIdx = 7; byteIdx++; }
        }
    }
    return Buffer.from(bytes).toString('hex');
}

async function processFile(file) {
    const result = { path: file.path, exactHash: null, perceptualHash: null };

    try {
        result.exactHash = await computeExactHash(file.path);
    } catch {
        // File unreadable — skip
    }

    // Skip perceptual hash if pre-supplied or explicitly gated
    if (file.perceptualHash) {
        result.perceptualHash = file.perceptualHash;
        return result;
    }
    if (file.skipPerceptual) return result;

    // Perceptual hash: use thumbPath for videos, skip for SVG
    const ext = file.path.split('.').pop().toLowerCase();
    if (ext === 'svg') return result;

    const perceptualSource = file.thumbPath || (file.isImage ? file.path : null);
    if (perceptualSource) {
        try {
            // For GIFs, use the first frame
            const input = ext === 'gif'
                ? sharp(perceptualSource, { pages: 1 })
                : sharp(perceptualSource);
            const pixels = await input
                .greyscale()
                .resize(9, 8, { fit: 'fill' })
                .raw()
                .toBuffer();
            result.perceptualHash = pixelsToDHashHex(pixels);
        } catch {
            // Could not compute perceptual hash
        }
    }

    return result;
}

module.exports = async function(files) {
    // Process in mini-batches to allow sharp pipeline overlap
    const BATCH = 4;
    const results = [];
    for (let i = 0; i < files.length; i += BATCH) {
        const batch = files.slice(i, i + BATCH);
        const batchResults = await Promise.all(batch.map(f => processFile(f)));
        results.push(...batchResults);
    }
    return results;
};
