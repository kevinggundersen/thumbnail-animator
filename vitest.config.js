const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
    test: {
        environment: 'node',
        include: ['test/**/*.test.js'],
        testTimeout: 10000,
        globals: true,
        setupFiles: ['./test/setup-db-alias.js'],
        coverage: {
            provider: 'v8',
            include: [
                'database.js',
                'database-proxy.js',
                'filter-sort-helpers.js',
                'filter-sort-worker.js',
                'gif-duration-parser.js',
                'hash-pool.js',
                'ipc-result.js',
                'playback-controller.js',
            ],
            reporter: ['text', 'text-summary'],
            thresholds: {
                // Global: set to accommodate progressive coverage expansion
                // (playback-controller.js MediaControlBar is untested, dragging averages)
                statements: 70,
                branches: 65,
                functions: 70,
                lines: 70,
            },
        },
    },
});
