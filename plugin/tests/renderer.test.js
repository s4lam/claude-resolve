const assert = require('assert');

const { computeFramePlan } = require('../renderer/render');

const fractional = computeFramePlan(5, 23.976);
assert.strictEqual(fractional.totalFrames, 120);
assert(fractional.encodedDuration >= 5);
assert(fractional.encodedDuration < 5 + (1 / 23.976));

const exact = computeFramePlan(5, 24);
assert.strictEqual(exact.totalFrames, 120);
assert.strictEqual(exact.encodedDuration, 5);

const invalid = computeFramePlan(0, 24);
assert.strictEqual(invalid.totalFrames, 0);

console.log('renderer tests passed');
