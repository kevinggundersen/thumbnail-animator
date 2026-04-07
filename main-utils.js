'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Path & URL utilities ─────────────────────────────────────────────────────

/**
 * Validate and resolve a user-supplied file path.
 * @param {*} p - The path to validate
 * @param {{ mustExist?: boolean }} [opts] - Options
 * @returns {string} Resolved absolute path
 * @throws {Error} If validation fails
 */
function validateUserPath(p, opts = {}) {
    if (typeof p !== 'string' || p.trim().length === 0) {
        throw new Error('Invalid path: must be a non-empty string');
    }
    const resolved = path.resolve(p);
    if (opts.mustExist && !fs.existsSync(resolved)) {
        throw new Error(`Path does not exist: ${resolved}`);
    }
    return resolved;
}

function pathToFileUrl(filePath) {
    return process.platform === 'win32'
        ? `file:///${filePath.replace(/\\/g, '/')}`
        : `file://${filePath}`;
}

function fileUrlToPath(fileUrl) {
    if (!fileUrl || typeof fileUrl !== 'string') return null;
    if (!fileUrl.startsWith('file://')) return null;
    try {
        let p = decodeURIComponent(fileUrl.slice(process.platform === 'win32' ? 8 : 7));
        if (process.platform === 'win32') p = p.replace(/\//g, '\\');
        return p;
    } catch { return null; }
}

// ── Thumbnail cache key ──────────────────────────────────────────────────────

function createThumbCacheKey(filePath, mtimeMs, extra = '') {
    return crypto.createHash('md5').update(`${filePath}|${mtimeMs || 0}|${extra}`).digest('hex');
}

// ── File utilities ───────────────────────────────────────────────────────────

function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Move a file or directory, falling back to copy+delete across drive boundaries (EXDEV).
 */
async function safeMove(srcPath, destPath) {
    try {
        await fs.promises.rename(srcPath, destPath);
    } catch (err) {
        if (err.code === 'EXDEV') {
            const stat = await fs.promises.stat(srcPath);
            if (stat.isDirectory()) {
                await fs.promises.cp(srcPath, destPath, { recursive: true });
            } else {
                await fs.promises.copyFile(srcPath, destPath);
            }
            await fs.promises.rm(srcPath, { recursive: true, force: true });
        } else {
            throw err;
        }
    }
}

/**
 * Move a file into a staging (undo-trash) directory with a unique name.
 * @param {string} filePath - File to stage
 * @param {string} stagingDir - The undo-trash directory
 * @returns {Promise<string>} The staging path
 */
async function moveToStaging(filePath, stagingDir) {
    const basename = path.basename(filePath);
    const stagingPath = path.join(stagingDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${basename}`);
    await safeMove(filePath, stagingPath);
    return stagingPath;
}

/**
 * Restore a staged file to its original location.
 */
async function restoreFromStaging(stagingPath, originalPath) {
    const parentDir = path.dirname(originalPath);
    if (!fs.existsSync(parentDir)) {
        await fs.promises.mkdir(parentDir, { recursive: true });
    }
    if (fs.existsSync(originalPath)) {
        throw new Error(`"${path.basename(originalPath)}" already exists at the original location`);
    }
    await safeMove(stagingPath, originalPath);
}

// ── Crash log ────────────────────────────────────────────────────────────────

/**
 * Append a crash entry to a log file, capping at 1 MB.
 * @param {string} label - Category label (e.g. 'UNCAUGHT EXCEPTION')
 * @param {*} err - The error
 * @param {string} logPath - Absolute path to the crash log file
 */
function writeCrashLog(label, err, logPath) {
    try {
        const entry = `[${new Date().toISOString()}] ${label}\n${String(err?.stack || err)}\n\n`;
        fs.appendFileSync(logPath, entry);
        // Cap at 1 MB — keep the newest half
        const stat = fs.statSync(logPath);
        if (stat.size > 1024 * 1024) {
            const data = fs.readFileSync(logPath, 'utf8');
            fs.writeFileSync(logPath, data.slice(data.length / 2));
        }
    } catch { /* best-effort */ }
}

// ── Async concurrency ────────────────────────────────────────────────────────

async function asyncPool(limit, items, fn) {
    const results = [];
    const executing = new Set();
    for (const [index, item] of items.entries()) {
        const p = Promise.resolve().then(() => fn(item, index));
        results.push(p);
        executing.add(p);
        const clean = () => executing.delete(p);
        p.then(clean, clean);
        if (executing.size >= limit) {
            await Promise.race(executing);
        }
    }
    return Promise.all(results);
}

// ── Smart collection filter ──────────────────────────────────────────────────

function matchesCheapRules(file, rules) {
    if (rules.fileType && rules.fileType !== 'all' && file.type !== rules.fileType) return false;
    if (rules.nameContains && !file.name.toLowerCase().includes(rules.nameContains.toLowerCase())) return false;
    if (rules.sizeValue && rules.sizeOperator) {
        const targetBytes = rules.sizeValue * 1024 * 1024;
        if (rules.sizeOperator === '>' && file.size <= targetBytes) return false;
        if (rules.sizeOperator === '<' && file.size >= targetBytes) return false;
    }
    if (rules.dateFrom && file.mtime < rules.dateFrom) return false;
    if (rules.dateTo && file.mtime > rules.dateTo) return false;
    return true;
}

// ── Perceptual hashing ───────────────────────────────────────────────────────

// Popcount lookup table (byte -> number of set bits)
const POPCOUNT_TABLE = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
    POPCOUNT_TABLE[i] = POPCOUNT_TABLE[i >> 1] + (i & 1);
}

function hammingDistance(hex1, hex2) {
    const buf1 = Buffer.from(hex1, 'hex');
    const buf2 = Buffer.from(hex2, 'hex');
    const len = Math.min(buf1.length, buf2.length);
    let dist = 0;
    for (let i = 0; i < len; i++) {
        dist += POPCOUNT_TABLE[buf1[i] ^ buf2[i]];
    }
    return dist;
}

// ── FFmpeg argument building ─────────────────────────────────────────────────

// Quality presets → codec-specific parameters
function _qualityToParams(outputKind, quality) {
    // quality: 'low' | 'medium' | 'high'
    const q = quality || 'medium';
    switch (outputKind) {
        case 'mp4':
        case 'mov':
            return { crf: q === 'low' ? 26 : q === 'high' ? 18 : 22 };
        case 'webm':
            return { crf: q === 'low' ? 36 : q === 'high' ? 24 : 30 };
        case 'gif':
            return { palette: q === 'low' ? 64 : q === 'high' ? 256 : 128 };
        case 'webp-animated':
        case 'webp':
            return { qv: q === 'low' ? 50 : q === 'high' ? 90 : 75 };
        case 'png':
            return {}; // PNG is lossless
        case 'jpg':
            return { qv: q === 'low' ? 8 : q === 'high' ? 2 : 4 };
        default:
            return {};
    }
}

// Build the ffmpeg argv for a given job. Throws if inputs are bad.
function buildFfmpegArgs(job) {
    const { inputPath, outputPath, operation, params } = job;
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats'];

    if (operation === 'trim') {
        const { startSec, endSec } = params;
        if (!isFinite(startSec) || !isFinite(endSec) || endSec <= startSec) {
            throw new Error('Invalid trim range');
        }
        const inExt = path.extname(inputPath).toLowerCase();
        const outExt = path.extname(outputPath).toLowerCase();
        let mode = params.mode || 'copy';
        // Smart: if container differs, re-encode
        if (mode === 'copy' && inExt !== outExt) mode = 'reencode';

        if (mode === 'copy') {
            // Stream-copy: place -ss before -i for fast seek, snap to keyframe
            args.push('-ss', String(startSec), '-to', String(endSec),
                '-i', inputPath,
                '-c', 'copy', '-avoid_negative_ts', 'make_zero',
                outputPath);
        } else {
            // Frame-accurate: seek after -i for precision, re-encode
            args.push('-i', inputPath,
                '-ss', String(startSec), '-to', String(endSec),
                '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
                '-c:a', 'aac', '-b:a', '128k',
                '-pix_fmt', 'yuv420p',
                outputPath);
        }
        return args;
    }

    if (operation === 'convert') {
        const { outputKind, fps, width, quality, frameOnly, seekSec } = params;
        const qp = _qualityToParams(outputKind, quality);
        const w = width && width > 0 ? width : null;

        // Single-frame image extraction
        if (frameOnly) {
            const seek = seekSec != null && isFinite(seekSec) ? seekSec : 0;
            args.push('-ss', String(seek), '-i', inputPath, '-vframes', '1');
            if (w) args.push('-vf', `scale=${w}:-2:flags=lanczos`);
            if (outputKind === 'jpg' && qp.qv != null) args.push('-q:v', String(qp.qv));
            if (outputKind === 'webp' && qp.qv != null) args.push('-quality', String(qp.qv));
            args.push(outputPath);
            return args;
        }

        const vfParts = [];
        if (fps && fps > 0) vfParts.push(`fps=${fps}`);
        if (w) vfParts.push(`scale=${w}:-2:flags=lanczos`);
        const vfBase = vfParts.join(',');

        switch (outputKind) {
            case 'mp4':
            case 'mov': {
                args.push('-i', inputPath);
                // yuv420p scale filter must produce even dims, so use -2 above
                const vf = vfBase || 'format=yuv420p';
                args.push('-vf', vfBase ? `${vfBase},format=yuv420p` : vf);
                args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(qp.crf),
                    '-c:a', 'aac', '-b:a', '128k',
                    outputPath);
                return args;
            }
            case 'webm': {
                args.push('-i', inputPath);
                if (vfBase) args.push('-vf', vfBase);
                args.push('-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(qp.crf),
                    '-c:a', 'libopus',
                    outputPath);
                return args;
            }
            case 'gif': {
                const fpsFilter = fps && fps > 0 ? `fps=${fps}` : 'fps=12';
                const scaleFilter = w ? `scale=${w}:-1:flags=lanczos` : '';
                const pre = [fpsFilter, scaleFilter].filter(Boolean).join(',');
                const filter = `${pre},split[s0][s1];[s0]palettegen=max_colors=${qp.palette}[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3`;
                args.push('-i', inputPath, '-vf', filter, '-loop', '0', outputPath);
                return args;
            }
            case 'webp-animated': {
                args.push('-i', inputPath);
                if (vfBase) args.push('-vf', vfBase);
                args.push('-c:v', 'libwebp', '-lossless', '0',
                    '-quality', String(qp.qv), '-loop', '0',
                    outputPath);
                return args;
            }
            case 'png': {
                args.push('-i', inputPath);
                if (w) args.push('-vf', `scale=${w}:-2:flags=lanczos`);
                args.push('-vframes', '1', outputPath);
                return args;
            }
            case 'jpg': {
                args.push('-i', inputPath);
                if (w) args.push('-vf', `scale=${w}:-2:flags=lanczos`);
                args.push('-vframes', '1', '-q:v', String(qp.qv), outputPath);
                return args;
            }
            case 'webp': {
                args.push('-i', inputPath);
                if (w) args.push('-vf', `scale=${w}:-2:flags=lanczos`);
                args.push('-vframes', '1', '-quality', String(qp.qv), outputPath);
                return args;
            }
            default:
                throw new Error(`Unknown outputKind: ${outputKind}`);
        }
    }

    throw new Error(`Unknown operation: ${operation}`);
}

// Parse `-progress pipe:1` output (stdout) for out_time_ms / out_time_us
// and return a percent 0..100 when totalSec is known.
function _parseFfmpegProgressChunk(chunk, totalSec) {
    // Chunk is text with lines like "out_time_us=1234567" and "progress=continue"
    const lines = chunk.toString().split(/\r?\n/);
    let outTimeSec = null;
    let isEnd = false;
    for (const line of lines) {
        if (line.startsWith('out_time_us=')) {
            const us = parseInt(line.slice('out_time_us='.length), 10);
            if (isFinite(us) && us >= 0) outTimeSec = us / 1_000_000;
        } else if (line.startsWith('out_time_ms=')) {
            const ms = parseInt(line.slice('out_time_ms='.length), 10);
            // ffmpeg's "out_time_ms" is actually microseconds in some versions;
            // if the number is > totalSec*1000 by a big margin, assume μs.
            if (isFinite(ms) && ms >= 0) {
                const asSec = ms / 1_000_000;
                if (outTimeSec == null) outTimeSec = asSec;
            }
        } else if (line.startsWith('progress=')) {
            if (line.slice('progress='.length).trim() === 'end') isEnd = true;
        }
    }
    if (outTimeSec == null) return { percent: null, isEnd };
    if (!totalSec || totalSec <= 0) return { percent: null, isEnd };
    const pct = Math.max(0, Math.min(99, (outTimeSec / totalSec) * 100));
    return { percent: pct, isEnd };
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    validateUserPath,
    pathToFileUrl,
    fileUrlToPath,
    createThumbCacheKey,
    formatFileSize,
    safeMove,
    moveToStaging,
    restoreFromStaging,
    writeCrashLog,
    asyncPool,
    matchesCheapRules,
    POPCOUNT_TABLE,
    hammingDistance,
    _qualityToParams,
    buildFfmpegArgs,
    _parseFfmpegProgressChunk,
};
