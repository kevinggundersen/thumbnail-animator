// ============================================================================
// convert-dialog.js — Video trimming & file conversion (ffmpeg-backed)
// Extracted from renderer.js. All functions/variables remain in global scope.
// ============================================================================


// FFmpeg availability (checked once at startup)
let _ffmpegAvailable = null;
(async () => {
    try {
        const r = await window.electronAPI.hasFfmpeg();
        _ffmpegAvailable = !!(r && r.ok && r.value && r.value.ffmpeg);
    } catch { _ffmpegAvailable = false; }
})();

function _ffGetPathParts(filePath) {
    const isWin = filePath.includes('\\');
    const sep = isWin ? '\\' : '/';
    const lastSep = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
    const dir = lastSep >= 0 ? filePath.slice(0, lastSep) : '.';
    const fullName = lastSep >= 0 ? filePath.slice(lastSep + 1) : filePath;
    const dot = fullName.lastIndexOf('.');
    const stem = dot > 0 ? fullName.slice(0, dot) : fullName;
    const ext = dot > 0 ? fullName.slice(dot) : '';
    return { dir, stem, ext, sep, fullName };
}

function _ffJoin(dir, name, sep) {
    return `${dir}${sep}${name}`;
}

// Classify file by extension: 'video' | 'animated' | 'image'
function _ffClassifyPath(filePath) {
    const ext = _ffGetPathParts(filePath).ext.toLowerCase();
    if (['.mp4', '.webm', '.mov', '.ogg', '.mkv', '.avi', '.m4v'].includes(ext)) return 'video';
    if (['.gif'].includes(ext)) return 'animated';
    if (['.webp'].includes(ext)) return 'animated'; // treat webp as animated-capable
    if (['.png', '.jpg', '.jpeg', '.bmp', '.svg'].includes(ext)) return 'image';
    return 'image';
}

// Output kinds with extensions
const _FF_OUTPUT_KINDS = {
    mp4:           { ext: '.mp4',  label: 'MP4 (H.264)',        category: 'video' },
    webm:          { ext: '.webm', label: 'WebM (VP9)',         category: 'video' },
    mov:           { ext: '.mov',  label: 'MOV (H.264)',        category: 'video' },
    gif:           { ext: '.gif',  label: 'GIF (animated)',     category: 'animated' },
    'webp-animated': { ext: '.webp', label: 'WebP (animated)', category: 'animated' },
    png:           { ext: '.png',  label: 'PNG (single frame)', category: 'image' },
    jpg:           { ext: '.jpg',  label: 'JPG (single frame)', category: 'image' },
    webp:          { ext: '.webp', label: 'WebP (single frame)', category: 'image' },
};

// Given selected paths, determine which output kinds are supported
function _ffGetAvailableOutputKinds(paths) {
    const kinds = new Set(paths.map(p => _ffClassifyPath(p)));
    const isMoving = kinds.has('video') || kinds.has('animated');
    const isImage = kinds.has('image');
    if (isMoving && !isImage) {
        // Moving-source inputs: offer everything
        return ['mp4', 'webm', 'mov', 'gif', 'webp-animated', 'png', 'jpg', 'webp'];
    } else if (isImage && !isMoving) {
        // Static-image sources: image-output only
        return ['png', 'jpg', 'webp'];
    } else {
        // Mixed: safest common denominator
        return ['png', 'jpg', 'webp'];
    }
}

// Shared job runner: invokes ffmpeg-run IPC and pipes progress to caller
async function runFfmpegJob(job, onProgress) {
    const jobId = job.jobId || (`ff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    const fullJob = { ...job, jobId };
    const listener = (_evt, msg) => {
        if (!msg || msg.jobId !== jobId) return;
        if (typeof onProgress === 'function' && isFinite(msg.percent)) {
            onProgress(msg.percent);
        }
    };
    window.electronAPI.onFfmpegProgress(listener);
    try {
        return await window.electronAPI.runFfmpeg(fullJob);
    } finally {
        window.electronAPI.removeFfmpegProgressListener(listener);
    }
}

// ── Trim: shared modal + save-as flow ──
function _openTrimOptionsModal(startSec, endSec) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('trim-options-overlay');
        const rangeEl = document.getElementById('trim-options-range');
        const closeBtn = document.getElementById('trim-options-close');
        const cancelBtn = document.getElementById('trim-options-cancel');
        const saveBtn = document.getElementById('trim-options-save');
        if (!overlay) { resolve(null); return; }

        const dur = endSec - startSec;
        rangeEl.innerHTML = `${_lbFormatTime(startSec)} &ndash; ${_lbFormatTime(endSec)} &bull; ${dur.toFixed(1)}s`;
        // Default to "copy" each open
        const copyRadio = overlay.querySelector('input[name="trim-mode"][value="copy"]');
        if (copyRadio) copyRadio.checked = true;
        overlay.classList.remove('hidden');

        const cleanup = (val) => {
            overlay.classList.add('hidden');
            closeBtn.removeEventListener('click', onCancel);
            cancelBtn.removeEventListener('click', onCancel);
            saveBtn.removeEventListener('click', onSave);
            overlay.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey);
            resolve(val);
        };
        const onCancel = () => cleanup(null);
        const onSave = () => {
            const checked = overlay.querySelector('input[name="trim-mode"]:checked');
            cleanup({ mode: checked ? checked.value : 'copy' });
        };
        const onBackdrop = (e) => { if (e.target === overlay) onCancel(); };
        const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
        closeBtn.addEventListener('click', onCancel);
        cancelBtn.addEventListener('click', onCancel);
        saveBtn.addEventListener('click', onSave);
        overlay.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
    });
}

async function exportTrim() {
    if (_ffmpegAvailable === false) {
        showToast('FFmpeg not found on system PATH', 'error', {
            actionLabel: 'How to install',
            actionCallback: () => window.electronAPI.openUrl('https://ffmpeg.org/download.html'),
        });
        return;
    }
    if (!activePlaybackController) { showToast('No media loaded', 'info'); return; }
    const mt = activePlaybackController.mediaType;
    if (mt !== 'video' && mt !== 'gif' && mt !== 'webp') {
        showToast('Can only trim video / animated files', 'info');
        return;
    }
    const srcPath = window.currentLightboxFilePath;
    if (!srcPath) { showToast('No source file path', 'error'); return; }
    const { in: a, out: b } = loopPoints;
    if (a == null || b == null || !(b > a)) {
        showToast('Mark in (I) and out (O) first', 'info');
        return;
    }

    // Show pre-save modal for encoding choice
    const opts = await _openTrimOptionsModal(a, b);
    if (!opts) return;

    const { dir, stem, ext, sep } = _ffGetPathParts(srcPath);
    // If input is GIF/WebP and user picks "copy", ffmpeg will still -c copy happily,
    // but preserve the extension so the output stays compatible.
    const defaultName = `${stem}_trim${ext}`;
    const defaultPath = _ffJoin(dir, defaultName, sep);

    const saveRes = await window.electronAPI.showSaveDialog({
        defaultPath,
        filters: [{ name: ext.slice(1).toUpperCase() || 'Media', extensions: [ext.slice(1) || 'mp4'] }],
    });
    if (!saveRes || !saveRes.ok || !saveRes.value || saveRes.value.canceled) return;
    const savedFilePath = saveRes.value.filePath;

    const jobId = `trim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const dur = b - a;

    // Persistent progress toast with cancel action
    const progressToast = showToast('Trimming\u2026 0%', 'info', {
        duration: 0,
        actionLabel: 'Cancel',
        actionCallback: async () => {
            try { await window.electronAPI.cancelFfmpeg(jobId); } catch {}
        },
    });
    const updateProgress = (pct) => {
        if (!progressToast) return;
        const msgEl = progressToast.querySelector('.toast-message');
        if (msgEl) msgEl.textContent = `Trimming\u2026 ${Math.floor(pct)}%`;
    };

    const result = await runFfmpegJob({
        jobId,
        inputPath: srcPath,
        outputPath: savedFilePath,
        operation: 'trim',
        params: { startSec: a, endSec: b, mode: opts.mode },
        totalSec: dur,
    }, updateProgress);

    // Dismiss progress toast
    if (progressToast) {
        const closeBtn = progressToast.querySelector('.toast-close');
        if (closeBtn) closeBtn.click();
    }

    if (result && result.ok && result.value && !result.value.canceled) {
        const outName = savedFilePath.split(/[\\/]/).pop();
        showToast(`Saved ${outName}`, 'success', {
            actionLabel: 'Reveal',
            actionCallback: () => window.electronAPI.revealInExplorer(savedFilePath),
        });
    } else if (result && result.ok && result.value && result.value.canceled) {
        showToast('Trim canceled', 'info');
    } else {
        showToast('Trim failed: ' + (result?.error || 'unknown'), 'error');
    }
}
window.exportTrim = exportTrim;

// ── Convert: modal + batch runner ──
let _convertModalState = null;

function _ffLoadConvertDefaults() {
    try {
        const raw = localStorage.getItem('convertDefaults');
        if (raw) return JSON.parse(raw);
    } catch {}
    return { format: 'gif', fps: 12, width: 480, quality: 'medium' };
}

function _ffSaveConvertDefaults(vals) {
    try { deferLocalStorageWrite('convertDefaults', JSON.stringify(vals)); } catch {}
}

function _ffEstimateTotalSec(path) {
    // Best-effort: check if this is the currently-open video in lightbox
    if (window.currentLightboxFilePath === path && activePlaybackController) {
        const d = activePlaybackController.duration;
        if (isFinite(d) && d > 0) return d;
    }
    return null; // unknown; progress will show indeterminate for this file
}

function openConvertDialog(paths, ctx = {}) {
    if (_ffmpegAvailable === false) {
        showToast('FFmpeg not found on system PATH', 'error', {
            actionLabel: 'How to install',
            actionCallback: () => window.electronAPI.openUrl('https://ffmpeg.org/download.html'),
        });
        return;
    }
    if (!paths || !paths.length) return;

    const overlay = document.getElementById('convert-overlay');
    if (!overlay) return;

    const countEl = document.getElementById('convert-file-count');
    const summaryEl = document.getElementById('convert-summary');
    const formatSelect = document.getElementById('convert-format');
    const fpsRow = document.getElementById('convert-fps-row');
    const fpsInput = document.getElementById('convert-fps');
    const fpsValue = document.getElementById('convert-fps-value');
    const widthRow = document.getElementById('convert-width-row');
    const widthInput = document.getElementById('convert-width');
    const frameRow = document.getElementById('convert-frame-row');
    const frameCheckbox = document.getElementById('convert-use-current-frame');
    const warnEl = document.getElementById('convert-warning');
    const closeBtn = document.getElementById('convert-close');
    const cancelBtn = document.getElementById('convert-cancel');
    const applyBtn = document.getElementById('convert-apply');

    // Build summary
    const classCounts = { video: 0, animated: 0, image: 0 };
    for (const p of paths) classCounts[_ffClassifyPath(p)]++;
    const parts = [];
    if (classCounts.video) parts.push(`${classCounts.video} video${classCounts.video > 1 ? 's' : ''}`);
    if (classCounts.animated) parts.push(`${classCounts.animated} animated`);
    if (classCounts.image) parts.push(`${classCounts.image} image${classCounts.image > 1 ? 's' : ''}`);
    summaryEl.textContent = `${paths.length} file${paths.length > 1 ? 's' : ''} \u2022 ${parts.join(', ')}`;
    if (countEl) countEl.textContent = `(${paths.length})`;

    // Populate format dropdown based on input kinds
    const availKinds = _ffGetAvailableOutputKinds(paths);
    formatSelect.innerHTML = '';
    for (const k of availKinds) {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = _FF_OUTPUT_KINDS[k].label;
        formatSelect.appendChild(opt);
    }

    // Load + apply defaults
    const defaults = _ffLoadConvertDefaults();
    if (availKinds.includes(defaults.format)) formatSelect.value = defaults.format;
    else formatSelect.value = availKinds[0];
    fpsInput.value = String(defaults.fps || 12);
    fpsValue.textContent = fpsInput.value;
    widthInput.value = String(defaults.width != null ? defaults.width : 480);
    const qRadio = overlay.querySelector(`input[name="convert-quality"][value="${defaults.quality || 'medium'}"]`);
    if (qRadio) qRadio.checked = true;
    frameCheckbox.checked = false;

    // Show/hide rows based on output format
    const applyFormatVisibility = () => {
        const kind = formatSelect.value;
        const cat = _FF_OUTPUT_KINDS[kind].category;
        fpsRow.classList.toggle('hidden', cat === 'image');
        widthRow.classList.remove('hidden');
        // "Use current frame" only for single-file, moving-input, image-output, from lightbox context
        const showFrameOpt = cat === 'image'
            && paths.length === 1
            && ctx.fromLightbox
            && ['video', 'animated'].includes(_ffClassifyPath(paths[0]));
        frameRow.classList.toggle('hidden', !showFrameOpt);
        // Warn if image-output is chosen with moving input (loses all but one frame)
        if (cat === 'image' && (classCounts.video > 0 || classCounts.animated > 0) && !showFrameOpt) {
            warnEl.textContent = 'Image outputs keep only the first frame of each moving file.';
            warnEl.classList.remove('hidden');
        } else {
            warnEl.classList.add('hidden');
        }
    };
    applyFormatVisibility();
    formatSelect.onchange = applyFormatVisibility;
    fpsInput.oninput = () => { fpsValue.textContent = fpsInput.value; };

    overlay.classList.remove('hidden');

    const cleanup = () => {
        overlay.classList.add('hidden');
        closeBtn.removeEventListener('click', onCancel);
        cancelBtn.removeEventListener('click', onCancel);
        applyBtn.removeEventListener('click', onApply);
        overlay.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
        _convertModalState = null;
    };
    const onCancel = () => cleanup();
    const onBackdrop = (e) => { if (e.target === overlay) onCancel(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
    const onApply = async () => {
        const selectedQuality = overlay.querySelector('input[name="convert-quality"]:checked');
        const opts = {
            outputKind: formatSelect.value,
            fps: parseInt(fpsInput.value, 10) || 12,
            width: parseInt(widthInput.value, 10) || 0,
            quality: selectedQuality ? selectedQuality.value : 'medium',
            useCurrentFrame: frameCheckbox.checked && !frameRow.classList.contains('hidden'),
        };
        _ffSaveConvertDefaults({ format: opts.outputKind, fps: opts.fps, width: opts.width, quality: opts.quality });
        cleanup();
        await runConvertBatch(paths, opts, ctx);
    };
    closeBtn.addEventListener('click', onCancel);
    cancelBtn.addEventListener('click', onCancel);
    applyBtn.addEventListener('click', onApply);
    overlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);

    _convertModalState = { paths, cleanup };
}
window.openConvertDialog = openConvertDialog;

async function runConvertBatch(paths, opts, ctx = {}) {
    const kindMeta = _FF_OUTPUT_KINDS[opts.outputKind];
    if (!kindMeta) { showToast('Invalid output format', 'error'); return; }
    const outExt = kindMeta.ext;
    const outCat = kindMeta.category;
    const frameOnly = outCat === 'image';

    // Determine output paths:
    // - single file: Save As dialog, user picks file path
    // - multi file: folder picker, auto-named files alongside
    let outputPaths = [];
    if (paths.length === 1) {
        const { dir, stem, sep } = _ffGetPathParts(paths[0]);
        const defaultName = `${stem}_convert${outExt}`;
        const defaultPath = _ffJoin(dir, defaultName, sep);
        const sres = await window.electronAPI.showSaveDialog({
            defaultPath,
            filters: [{ name: outExt.slice(1).toUpperCase(), extensions: [outExt.slice(1)] }],
        });
        if (!sres || !sres.ok || !sres.value || sres.value.canceled) return;
        outputPaths = [sres.value.filePath];
    } else {
        const { dir: firstDir } = _ffGetPathParts(paths[0]);
        const fres = await window.electronAPI.showFolderPicker({
            title: 'Choose output folder',
            defaultPath: firstDir,
        });
        if (!fres || !fres.ok || !fres.value || fres.value.canceled) return;
        const chosenFolder = fres.value.folderPath;
        const usedNames = new Set();
        for (const p of paths) {
            const { stem, sep } = _ffGetPathParts(p);
            let name = `${stem}_convert${outExt}`;
            let counter = 2;
            while (usedNames.has(name.toLowerCase())) {
                name = `${stem}_convert_${counter}${outExt}`;
                counter++;
            }
            usedNames.add(name.toLowerCase());
            outputPaths.push(_ffJoin(chosenFolder, name, sep));
        }
    }

    // Progress toast across the batch
    let canceledAll = false;
    let currentJobId = null;
    const total = paths.length;
    const progressToast = showToast(`Converting 1 of ${total}\u2026 0%`, 'info', {
        duration: 0,
        actionLabel: 'Cancel',
        actionCallback: async () => {
            canceledAll = true;
            if (currentJobId) {
                try { await window.electronAPI.cancelFfmpeg(currentJobId); } catch {}
            }
        },
    });
    const setToastText = (i, pct) => {
        if (!progressToast) return;
        const msgEl = progressToast.querySelector('.toast-message');
        if (msgEl) msgEl.textContent = `Converting ${i + 1} of ${total}\u2026 ${Math.floor(pct)}%`;
    };

    let successes = 0, failures = 0, canceledCount = 0, lastErr = '';
    for (let i = 0; i < paths.length; i++) {
        if (canceledAll) break;
        const inputPath = paths[i];
        const outputPath = outputPaths[i];
        const jobId = `conv-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;
        currentJobId = jobId;

        const seekSec = (opts.useCurrentFrame && activePlaybackController && window.currentLightboxFilePath === inputPath)
            ? (activePlaybackController.currentTime || 0) : 0;

        const totalSec = _ffEstimateTotalSec(inputPath);

        setToastText(i, 0);
        const r = await runFfmpegJob({
            jobId,
            inputPath,
            outputPath,
            operation: 'convert',
            params: {
                outputKind: opts.outputKind,
                fps: opts.fps,
                width: opts.width,
                quality: opts.quality,
                frameOnly,
                seekSec,
            },
            totalSec,
        }, (pct) => setToastText(i, pct));

        if (r && r.ok && r.value && !r.value.canceled) successes++;
        else if (r && r.ok && r.value && r.value.canceled) { canceledCount++; if (canceledAll) break; }
        else { failures++; lastErr = r?.error || 'unknown'; }
    }
    currentJobId = null;

    // Dismiss progress toast
    if (progressToast) {
        const closeBtn = progressToast.querySelector('.toast-close');
        if (closeBtn) closeBtn.click();
    }

    if (canceledAll) {
        showToast(`Canceled. ${successes} of ${total} converted.`, 'info');
    } else if (failures === 0 && successes > 0) {
        if (successes === 1) {
            showToast(`Converted ${outputPaths[0].split(/[\\/]/).pop()}`, 'success', {
                actionLabel: 'Reveal',
                actionCallback: () => window.electronAPI.revealInExplorer(outputPaths[0]),
            });
        } else {
            showToast(`Converted ${successes} files`, 'success');
        }
    } else {
        showToast(`Convert finished: ${successes} ok, ${failures} failed${lastErr ? ' \u2014 ' + lastErr : ''}`, failures > 0 ? 'error' : 'info');
    }
}
window.runConvertBatch = runConvertBatch;
