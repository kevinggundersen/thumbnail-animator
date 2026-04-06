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
                'gif-duration-parser.js',
                'hash-pool.js',
                'ipc-result.js',
            ],
            reporter: ['text', 'text-summary'],
            thresholds: {
                statements: 95,
                branches: 75,
                functions: 95,
                lines: 95,
            },
        },
    },
});
