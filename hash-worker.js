/**
 * Worker thread for computing file hashes (exact + perceptual).
 * Receives batches of files and returns SHA-256 and dHash results.
 */
const { parentPort } = require('worker_threads');
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

async function computeDHash(filePath) {
    // Resize to 9x8 greyscale, compare adjacent pixels horizontally
    const pixels = await sharp(filePath)
        .greyscale()
        .resize(9, 8, { fit: 'fill' })
        .raw()
        .toBuffer();

    let hash = '';
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const left = pixels[row * 9 + col];
            const right = pixels[row * 9 + col + 1];
            hash += left > right ? '1' : '0';
        }
    }
    // Convert 64-bit binary string to 16-char hex
    return BigInt('0b' + hash).toString(16).padStart(16, '0');
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

            let hash = '';
            for (let row = 0; row < 8; row++) {
                for (let col = 0; col < 8; col++) {
                    const left = pixels[row * 9 + col];
                    const right = pixels[row * 9 + col + 1];
                    hash += left > right ? '1' : '0';
                }
            }
            result.perceptualHash = BigInt('0b' + hash).toString(16).padStart(16, '0');
        } catch {
            // Could not compute perceptual hash
        }
    }

    return result;
}

parentPort.on('message', async (msg) => {
    if (msg.type === 'hash') {
        const results = [];
        for (const file of msg.files) {
            results.push(await processFile(file));
        }
        parentPort.postMessage({ type: 'result', results });
    }
});
