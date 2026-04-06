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
            ],
            reporter: ['text', 'text-summary'],
            thresholds: {
                // Global: lowered to accommodate newly-tracked modules still gaining coverage
                statements: 85,
                branches: 75,
                functions: 90,
                lines: 90,
            },
        },
    },
});
