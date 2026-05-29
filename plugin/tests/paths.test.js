const assert = require('assert');
const { NODE_PATH, ENV } = require('../ipc/paths');

assert.strictEqual(typeof NODE_PATH, 'string');
assert(NODE_PATH.length > 0);
assert(ENV && typeof ENV.PATH === 'string');

console.log('paths tests passed');
