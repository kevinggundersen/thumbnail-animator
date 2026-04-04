/**
 * Image Decoder Worker
 *
 * Off-main-thread image decoding using fetch + createImageBitmap.
 * Returns transferable ImageBitmap objects to the main thread.
 * Zero-copy transfer via structured clone + transferables.
 *
 * Protocol:
 *   main -> worker: { type: 'decode', id, url, maxWidth, maxHeight }
 *   worker -> main: { type: 'decoded', id, bitmap } (with bitmap transferred)
 *                   { type: 'error', id, error }
 */

'use strict';

self.onmessage = async (e) => {
    const msg = e.data;
    if (!msg || msg.type !== 'decode') return;

    const { id, url, maxWidth, maxHeight } = msg;
    try {
        // Fetch the (usually local blob:/file:) URL
        const response = await fetch(url);
        if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
        const blob = await response.blob();

        // Build createImageBitmap options: downscale during decode for efficiency
        const opts = { imageOrientation: 'from-image', premultiplyAlpha: 'default' };
        if (maxWidth && maxWidth > 0)   opts.resizeWidth = Math.round(maxWidth);
        if (maxHeight && maxHeight > 0) opts.resizeHeight = Math.round(maxHeight);
        if (opts.resizeWidth || opts.resizeHeight) opts.resizeQuality = 'medium';

        const bitmap = await createImageBitmap(blob, opts);
        // Transfer: zero-copy handoff of the GPU-backed bitmap to main
        self.postMessage({ type: 'decoded', id, bitmap }, [bitmap]);
    } catch (err) {
        self.postMessage({ type: 'error', id, error: err && err.message ? err.message : String(err) });
    }
};
