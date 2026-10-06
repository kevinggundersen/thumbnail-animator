'use strict';
// The renderer's classic scripts, in execution order. index.html loads the two
// bundles that scripts/build-renderer.js produces from these lists; the vendor
// libraries stay as separate deferred tags between them (deferred first-party
// code must run after them, exactly as the original tag order did).
module.exports = {
    sync: [
        'settings.js', 'ipc-result.js', 'icons.js', 'perf-dashboard.js', 'gif-duration-parser.js',
        'playback-budget.js', 'playback-controller.js', 'themes.js', 'command-palette.js',
        'filmstrip-scrubber.js', 'filter-worker-bridge.js', 'selection-manager.js', 'renderer.js',
    ],
    vendorDeferred: ['webgpu-hamming.js', 'gifuct-js-bundle.js', 'webpxmux.min.js', 'fuse.vendor.js'],
    deferred: [
        'settings-ui.js', 'convert-dialog.js', 'lightbox.js', 'collections.js', 'duplicate-detection.js',
        'context-menu.js', 'sidebar-tree.js', 'renderer-features.js',
    ],
};
