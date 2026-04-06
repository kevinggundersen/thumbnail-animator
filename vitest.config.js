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
                'filter-sort-helpers.js',
                'filter-sort-worker.js',
                'gif-duration-parser.js',
                'ipc-result.js',
                'playback-controller.js',
            ],
            reporter: ['text', 'text-summary'],
        },
    },
});
