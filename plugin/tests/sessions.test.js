const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createSession,
  deleteSession,
  getActiveSession,
  getSession,
  listSessions,
  sanitizeMessage,
  titleFromMessages,
  updateSession
} = require('../ipc/sessions');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-ai-sessions-'));
const storePath = path.join(tempDir, 'sessions.json');

const messages = [
  { id: 1, type: 'user', text: 'Make a creator title card for a product launch.' },
  {
    id: 2,
    type: 'assistant',
    text: '```html\n<html></html>\n```',
    parsed: { type: 'html', name: 'LaunchTitle', html: '<html></html>', mode: 'frame' }
  }
];

assert.strictEqual(titleFromMessages(messages), 'Make a creator title card for a product launch.');
assert.strictEqual(sanitizeMessage({ type: 'assistant', text: 'Thinking...', isThinking: true }).text, '(Interrupted)');
assert.strictEqual(
  sanitizeMessage({ type: 'assistant', parsed: { type: 'variations', items: [{ html: '<html></html>', mode: 'frame' }] } }).parsed.type,
  'variations'
);

const created = createSession({
  projectName: 'Launch Reel',
  timelineName: 'Main',
  provider: 'codex',
  model: 'gpt-5.5',
  width: 3840,
  height: 2160,
  fps: 24,
  messages
}, storePath);

assert(created.id);
assert.strictEqual(created.title, 'Make a creator title card for a product launch.');
assert.strictEqual(getActiveSession(storePath).id, created.id);
assert.strictEqual(listSessions({}, storePath).length, 1);
assert.strictEqual(listSessions({}, storePath)[0].renderCount, 1);

const updated = updateSession(created.id, {
  title: 'Product launch titles',
  messages: [...messages, { id: 3, type: 'user', text: 'Make it simpler.' }]
}, storePath);

assert.strictEqual(updated.title, 'Product launch titles');
assert.strictEqual(getSession(created.id, storePath).messages.length, 3);

const deleted = deleteSession(created.id, storePath);
assert.strictEqual(deleted.deleted, 1);
assert.strictEqual(listSessions({}, storePath).length, 0);

fs.rmSync(tempDir, { recursive: true, force: true });
console.log('sessions tests passed');
