'use strict';
const js = require('@eslint/js');
const globals = require('globals');
const { collect, rendererScripts, topLevelNames } = require('./scripts/renderer-globals');
const workerHelperGlobals = Object.fromEntries([...topLevelNames('filter-sort-helpers.js')].map(n => [n, 'readonly']));

const sharedRendererGlobals = collect();
const rendererFiles = rendererScripts().filter(f => !/vendor|bundle|\.min\./.test(f));

const common = {
    'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }],
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-prototype-builtins': 'off',
    'no-control-regex': 'off',
    'no-useless-escape': 'off',
    'no-cond-assign': ['error', 'except-parens'],
    'no-inner-declarations': 'off',
    'no-redeclare': ['error', { builtinGlobals: false }],
    'no-useless-assignment': 'warn',
};

module.exports = [
    {
        ignores: [
            'node_modules/**', 'dist/**', 'electron-cache/**', 'coverage/**',
            'native-scanner/**', '*.vendor.js', '*-bundle.js', '*.min.js',
            '.claude/**', '.cursor/**',
        ],
    },
    js.configs.recommended,
    // Main process, preload, node workers, tooling
    {
        files: [
            'main.js', 'main-utils.js', 'preload.js', 'database.js', 'database-proxy.js',
            'database-worker.js', 'thumbnail-worker.js', 'thumbnail-pool.js', 'hash-pool.js',
            'hash-worker.js', 'worker-pool.js', 'dimension-worker.js', 'clip-preprocess-pool.js',
            'clip-preprocess-worker.js', 'clip-inference-worker.js',
            'plugins/**/*.js', 'build/**/*.js', 'scripts/**/*.js', 'eslint.config.js', 'vitest.config.js',
        ],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: { ...globals.node } },
        rules: common,
    },
    // Renderer: classic scripts sharing one global scope (until Phase 5 modules)
    {
        files: rendererFiles,
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: { ...globals.browser, ...sharedRendererGlobals, module: 'readonly', require: 'readonly', process: 'readonly', setImmediate: 'readonly', WebPXMux: 'readonly', gifuctJs: 'readonly', Fuse: 'readonly' },
        },
        rules: common,
    },
    // Web workers
    {
        files: ['filter-sort-worker.js', 'image-decode-worker.js', 'filter-sort-helpers.js'],
        languageOptions: { ecmaVersion: 'latest', sourceType: 'script', globals: { ...globals.worker, ...workerHelperGlobals, module: 'readonly', require: 'readonly' } },
        rules: common,
    },
    // Tests
    {
        files: ['test/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest', sourceType: 'commonjs',
            globals: { ...globals.node, ...globals.browser, describe: 'readonly', it: 'readonly', test: 'readonly', expect: 'readonly', vi: 'readonly', beforeEach: 'readonly', afterEach: 'readonly', beforeAll: 'readonly', afterAll: 'readonly' },
        },
        rules: { ...common, 'no-unused-vars': 'off' },
    },
];
