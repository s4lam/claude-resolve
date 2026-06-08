const assert = require('assert');
const {
  buildCodexArgs,
  isStaleCodexResumeError,
  isUnsupportedCodexDefaultModelError,
  normalizeCodexModelId,
  resolveCodexModelId
} = require('../ipc/codex');

assert.deepStrictEqual(
  buildCodexArgs({ threadId: null, modelId: 'gpt-5.5' }),
  ['exec', '--ignore-user-config', '--json', '--skip-git-repo-check', '--sandbox', 'read-only', '--model', 'gpt-5.5', '-']
);

assert.deepStrictEqual(
  buildCodexArgs({ threadId: 'thread_123', modelId: 'gpt-5.5' }),
  ['exec', 'resume', '--ignore-user-config', '--json', '--skip-git-repo-check', '--model', 'gpt-5.5', 'thread_123', '-']
);

assert(!buildCodexArgs({ threadId: 'thread_123', modelId: null }).includes('--sandbox'));
assert.strictEqual(normalizeCodexModelId('gpt-5.3-codex'), 'default');
assert.strictEqual(normalizeCodexModelId('gpt-5.5'), 'gpt-5.5');
assert.strictEqual(resolveCodexModelId('default'), 'gpt-5.5');
assert.strictEqual(resolveCodexModelId('gpt-5.3-codex'), 'gpt-5.5');
assert.strictEqual(resolveCodexModelId('gpt-5.4-mini'), 'gpt-5.4-mini');

assert.strictEqual(
  isStaleCodexResumeError('Error: thread/resume: thread/resume failed: no rollout found for thread id 019edc9c (code -32600)'),
  true
);
assert.strictEqual(isStaleCodexResumeError('Error: quota exceeded'), false);
assert.strictEqual(
  isUnsupportedCodexDefaultModelError("The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account."),
  true
);
assert.strictEqual(
  isUnsupportedCodexDefaultModelError("The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account."),
  false
);

console.log('codex-args tests passed');
