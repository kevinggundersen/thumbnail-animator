'use strict';

const fs = require('fs');
const path = require('path');

let sharp = null;
try {
    sharp = require('sharp');
} catch (err) {
    console.warn('[exif-stripper] sharp not available:', err.message);
}

const SUPPORTED_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tiff', '.tif', '.avif']);

// ─── Plugin entry point ────────────────────────────────────────────────────────

function activate(api) {
    return {
        stripSingleFile,
        stripBatch,
    };
}

// ─── Single-file context menu action ───────────────────────────────────────────

/**
 * Strip metadata from a single file (context menu action).
 * Returns { success, json? } for the clipboard toast.
 */
async function stripSingleFile(filePath, metadata) {
    if (!sharp) return { success: false, error: 'sharp is not available' };

    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTS.has(ext)) {
        return { success: false, error: `Unsupported format: ${ext}` };
    }

    try {
        const result = await _stripFileMetadata(filePath);
        const saved = _formatBytes(result.savedBytes);
        return { success: true, json: `Metadata stripped successfully (saved ${saved})` };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ─── Batch operation ───────────────────────────────────────────────────────────

/**
 * Strip metadata from multiple files (batch operation).
 * Returns { processed, skipped, errors, details[] }.
 */
async function stripBatch(filePaths, options) {
    if (!sharp) return { processed: 0, skipped: 0, errors: 1, details: [{ status: 'error', error: 'sharp is not available' }] };

    const results = { processed: 0, skipped: 0, errors: 0, details: [] };

    for (const filePath of filePaths) {
        const ext = path.extname(filePath).toLowerCase();

        if (!SUPPORTED_EXTS.has(ext)) {
            results.skipped++;
            results.details.push({
                file: path.basename(filePath),
                status: 'skipped',
                reason: `Unsupported format: ${ext}`,
            });
            continue;
        }

        try {
            const detail = await _stripFileMetadata(filePath);
            detail.status = 'stripped';
            results.processed++;
            results.details.push(detail);
        } catch (err) {
            results.errors++;
            results.details.push({
                file: path.basename(filePath),
                status: 'error',
                error: err.message,
            });
        }
    }

    return results;
}

// ─── Core stripping logic ──────────────────────────────────────────────────────

/**
 * Strip all metadata from a file, preserving ICC profile and image quality.
 * Uses a safe temp-file-then-rename write pattern.
 */
async function _stripFileMetadata(filePath) {
    const originalStat = await fs.promises.stat(filePath);
    const originalSize = originalStat.size;
    const ext = path.extname(filePath).toLowerCase();

    // Read metadata first to extract ICC profile
    const meta = await sharp(filePath).metadata();

    // Check for animated images — skip to avoid frame loss
    if (meta.pages && meta.pages > 1) {
        throw new Error('Animated image — skipping to avoid frame loss');
    }

    // Build the sharp pipeline: read → strip metadata → re-encode
    let pipeline = sharp(filePath);

    // Preserve ICC profile if present, strip everything else
    if (meta.icc) {
        pipeline = pipeline.withMetadata({ icc: meta.icc });
    }
    // If no ICC, withMetadata is not called, so sharp strips all metadata by default

    // Format-specific re-encoding to minimize quality loss
    let outputBuffer;
    switch (ext) {
        case '.jpg':
        case '.jpeg':
            outputBuffer = await pipeline.jpeg({ quality: 100, mozjpeg: false }).toBuffer();
            break;

        case '.png':
            outputBuffer = await pipeline.png({ compressionLevel: 6 }).toBuffer();
            break;

        case '.webp':
            outputBuffer = await pipeline.webp({ quality: 100 }).toBuffer();
            break;

        case '.tiff':
        case '.tif':
            outputBuffer = await pipeline.tiff({ quality: 100 }).toBuffer();
            break;

        case '.avif':
            outputBuffer = await pipeline.avif({ quality: 100, lossless: true }).toBuffer();
            break;

        default:
            throw new Error(`Unsupported format: ${ext}`);
    }

    // Safe write: temp file then rename
    const tempPath = filePath + '.stripped.tmp';
    try {
        await fs.promises.writeFile(tempPath, outputBuffer);
        await fs.promises.rename(tempPath, filePath);
    } catch (writeErr) {
        // Clean up temp file on failure
        try { await fs.promises.unlink(tempPath); } catch { /* ignore */ }
        throw writeErr;
    }

    return {
        file: path.basename(filePath),
        originalSize,
        strippedSize: outputBuffer.length,
        savedBytes: originalSize - outputBuffer.length,
        format: ext.replace('.', ''),
    };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function _formatBytes(bytes) {
    if (bytes < 0) return `+${_formatBytes(-bytes)}`;
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const k = 1024;
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
    return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

module.exports = { activate };
