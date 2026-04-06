// Redirect require('better-sqlite3') to the Node-ABI-compatible copy.
// The main copy was compiled for Electron's Node ABI and crashes under
// system Node. This hook runs before any test file is loaded.
const Module = require('module');
const originalResolveFilename = Module._resolveFilename;

const path = require('path');
const mockWorkerThreadsPath = path.join(__dirname, 'mock-worker-threads.js');

Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'better-sqlite3') {
        return originalResolveFilename.call(this, 'better-sqlite3-test', parent, ...rest);
    }
    // Redirect worker_threads to our mock for hash-pool.js tests
    if (request === 'worker_threads') {
        return mockWorkerThreadsPath;
    }
    return originalResolveFilename.call(this, request, parent, ...rest);
};
