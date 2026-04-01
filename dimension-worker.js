/**
 * Worker thread for scanning image/video dimensions.
 * Receives batches of file paths, returns { path, width, height } results.
 */
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const { execFile } = require('child_process');

const ffprobePath = workerData.ffprobePath;

// Load image-size the same way as main.js
let sizeOf = null;
try {
    const imageSizeModule = require('image-size');
    if (typeof imageSizeModule === 'function') {
        sizeOf = imageSizeModule;
    } else if (imageSizeModule && typeof imageSizeModule.imageSize === 'function') {
        sizeOf = imageSizeModule.imageSize;
    } else if (imageSizeModule && typeof imageSizeModule.default === 'function') {
        sizeOf = imageSizeModule.default;
    } else {
        sizeOf = imageSizeModule;
    }
} catch {
    sizeOf = null;
}

async function getImageDimensions(filePath) {
    if (!sizeOf) return null;
    try {
        const fd = await fs.promises.open(filePath, 'r');
        try {
            const headerBuf = Buffer.alloc(512 * 1024);
            const { bytesRead } = await fd.read(headerBuf, 0, headerBuf.length, 0);
            const dimensions = sizeOf(headerBuf.subarray(0, bytesRead));
            if (dimensions && dimensions.width && dimensions.height) {
                return { width: dimensions.width, height: dimensions.height };
            }
        } finally {
            await fd.close();
        }
    } catch {
        // Corrupted or unsupported format
    }
    return null;
}

function getVideoDimensions(filePath) {
    if (!ffprobePath) return Promise.resolve(null);
    return new Promise((resolve) => {
        execFile(ffprobePath, [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height',
            '-of', 'csv=p=0:s=x',
            filePath
        ], { timeout: 5000 }, (err, stdout) => {
            if (err || !stdout) return resolve(null);
            const parts = stdout.trim().split('x');
            if (parts.length >= 2) {
                const width = parseInt(parts[0], 10);
                const height = parseInt(parts[1], 10);
                if (width > 0 && height > 0) return resolve({ width, height });
            }
            resolve(null);
        });
    });
}

const WORKER_CONCURRENCY = 4;

parentPort.on('message', async (msg) => {
    if (msg.type !== 'scan') return;

    const results = new Array(msg.files.length);
    const executing = new Set();

    for (let i = 0; i < msg.files.length; i++) {
        const index = i;
        const file = msg.files[i];
        const p = (async () => {
            const dims = file.isImage
                ? await getImageDimensions(file.path)
                : await getVideoDimensions(file.path);
            results[index] = {
                path: file.path,
                width: dims ? dims.width : undefined,
                height: dims ? dims.height : undefined
            };
        })();
        executing.add(p);
        p.then(() => executing.delete(p), () => executing.delete(p));
        if (executing.size >= WORKER_CONCURRENCY) {
            await Promise.race(executing);
        }
    }
    await Promise.all(executing);

    parentPort.postMessage({ type: 'result', results });
});
