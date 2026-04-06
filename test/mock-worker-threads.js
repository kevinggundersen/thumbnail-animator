/**
 * Mock replacement for 'worker_threads' used by hash-pool.js in tests.
 * Intercept is set up via Module._resolveFilename in setup-db-alias.js.
 */
const EventEmitter = require('events');

// Shared list of all created mock workers — tests can inspect this.
const allMockWorkers = [];

class MockWorker extends EventEmitter {
    constructor(workerPath) {
        super();
        this.__workerPath = workerPath;
        this.__terminated = false;
        this.__messages = [];
        allMockWorkers.push(this);
    }

    postMessage(msg) {
        this.__messages.push(msg);
        if (msg.type === 'hash' && msg.files) {
            const results = msg.files.map(f => ({
                path: f.path,
                exactHash: `exact_${f.path}`,
                perceptualHash: `phash_${f.path}`,
            }));
            process.nextTick(() => {
                this.emit('message', { type: 'result', results });
            });
        }
    }

    terminate() {
        this.__terminated = true;
    }
}

module.exports = {
    Worker: MockWorker,
    MockWorker,
    allMockWorkers,
};
