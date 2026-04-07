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
                'command-palette.js',
                'filmstrip-scrubber.js',
                'themes.js',
                'main-utils.js',
                'plugins/plugin-registry.js',
                'plugins/plugin-api.js',
            ],
            reporter: ['text', 'text-summary'],
            thresholds: {
                statements: 70,
                branches: 66,
                functions: 73,
                lines: 71,
            },
        },
    },
});
