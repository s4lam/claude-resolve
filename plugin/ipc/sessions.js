const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./paths');

const DEFAULT_STORE = path.join(CONFIG_DIR, 'sessions.json');
const MAX_TITLE_LENGTH = 80;

function nowIso() {
  return new Date().toISOString();
}

function makeSessionId() {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ensureStoreDir(storePath = DEFAULT_STORE) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
}

function readStore(storePath = DEFAULT_STORE) {
  if (!fs.existsSync(storePath)) return { version: 1, sessions: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    if (Array.isArray(parsed)) return { version: 1, sessions: parsed.map(normalizeSession) };
    return {
      version: 1,
      activeId: parsed.activeId || null,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions.map(normalizeSession) : []
    };
  } catch {
    return { version: 1, sessions: [] };
  }
}

function writeStore(store, storePath = DEFAULT_STORE) {
  ensureStoreDir(storePath);
  const next = {
    version: 1,
    activeId: store.activeId || null,
    sessions: Array.isArray(store.sessions) ? store.sessions.map(normalizeSession) : []
  };
  fs.writeFileSync(storePath, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function trimTitle(value, fallback = 'Untitled session') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > MAX_TITLE_LENGTH ? `${text.slice(0, MAX_TITLE_LENGTH - 1)}…` : text;
}

function titleFromMessages(messages = [], fallback = 'Untitled session') {
  const firstUser = messages.find(message => message && message.type === 'user' && message.text);
  return trimTitle(firstUser?.text, fallback);
}

function sanitizeParsed(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (Array.isArray(parsed.items)) {
    return {
      type: 'variations',
      name: trimTitle(parsed.name, `${parsed.items.length} Variations`),
      items: parsed.items.map(sanitizeParsed).filter(Boolean)
    };
  }
  return {
    type: parsed.type || 'html',
    name: trimTitle(parsed.name, 'Overlay'),
    html: String(parsed.html || ''),
    mode: parsed.mode === 'realtime' ? 'realtime' : 'frame'
  };
}

function sanitizeMessage(message = {}) {
  const safe = {
    id: Number.isFinite(Number(message.id)) ? Number(message.id) : Date.now(),
    type: message.type === 'assistant' ? 'assistant' : 'user',
    text: String(message.text || ''),
    prompt: message.prompt ? String(message.prompt) : undefined,
    isError: Boolean(message.isError),
    parsed: sanitizeParsed(message.parsed),
    repairCount: Number(message.repairCount || 0) || undefined
  };
  if (message.isThinking) {
    safe.text = safe.text && safe.text !== 'Thinking...' ? safe.text : '(Interrupted)';
    safe.isThinking = false;
  }
  Object.keys(safe).forEach(key => safe[key] === undefined && delete safe[key]);
  return safe;
}

function compactSession(session = {}) {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const renderCount = messages.reduce((count, message) => {
    if (!message?.parsed) return count;
    if (Array.isArray(message.parsed.items)) return count + message.parsed.items.length;
    return count + 1;
  }, 0);
  return {
    id: session.id,
    title: session.title,
    projectName: session.projectName || null,
    timelineName: session.timelineName || null,
    provider: session.provider || null,
    model: session.model || null,
    width: session.width || null,
    height: session.height || null,
    fps: session.fps || null,
    messageCount: messages.length,
    renderCount,
    archived: Boolean(session.archived),
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastPrompt: session.lastPrompt || ''
  };
}

function normalizeSession(payload = {}) {
  const timestamp = nowIso();
  const messages = Array.isArray(payload.messages) ? payload.messages.map(sanitizeMessage) : [];
  const titleFallback = [payload.projectName, payload.timelineName].filter(Boolean).join(' / ') || 'Untitled session';
  const title = trimTitle(payload.title || titleFromMessages(messages, titleFallback), titleFallback);
  const lastPrompt = [...messages].reverse().find(message => message.type === 'user')?.text || payload.lastPrompt || '';
  return {
    id: payload.id || makeSessionId(),
    title,
    projectName: payload.projectName || null,
    timelineName: payload.timelineName || null,
    page: payload.page || null,
    provider: payload.provider || null,
    model: payload.model || null,
    width: Number(payload.width) || null,
    height: Number(payload.height) || null,
    fps: Number(payload.fps) || null,
    selectedAssetIds: Array.isArray(payload.selectedAssetIds) ? payload.selectedAssetIds : [],
    messages,
    lastPrompt: trimTitle(lastPrompt, ''),
    archived: Boolean(payload.archived),
    createdAt: payload.createdAt || timestamp,
    updatedAt: payload.updatedAt || timestamp
  };
}

function sortSessions(sessions) {
  return [...sessions].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function listSessions(options = {}, storePath = DEFAULT_STORE) {
  const store = readStore(storePath);
  const includeArchived = Boolean(options.includeArchived);
  return sortSessions(store.sessions)
    .filter(session => includeArchived || !session.archived)
    .map(compactSession);
}

function getSession(id, storePath = DEFAULT_STORE) {
  const store = readStore(storePath);
  return store.sessions.find(session => session.id === id) || null;
}

function createSession(payload = {}, storePath = DEFAULT_STORE) {
  const store = readStore(storePath);
  const session = normalizeSession({ ...payload, id: payload.id || makeSessionId(), createdAt: nowIso(), updatedAt: nowIso() });
  store.sessions = [session, ...store.sessions.filter(item => item.id !== session.id)];
  store.activeId = session.id;
  writeStore(store, storePath);
  return session;
}

function updateSession(id, patch = {}, storePath = DEFAULT_STORE) {
  const store = readStore(storePath);
  const index = store.sessions.findIndex(session => session.id === id);
  if (index < 0) return null;
  const current = store.sessions[index];
  const next = normalizeSession({
    ...current,
    ...patch,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: nowIso(),
    messages: Array.isArray(patch.messages) ? patch.messages : current.messages
  });
  store.sessions[index] = next;
  store.activeId = next.id;
  writeStore(store, storePath);
  return next;
}

function deleteSession(id, storePath = DEFAULT_STORE) {
  const store = readStore(storePath);
  const before = store.sessions.length;
  store.sessions = store.sessions.filter(session => session.id !== id);
  if (store.activeId === id) store.activeId = store.sessions[0]?.id || null;
  writeStore(store, storePath);
  return { success: true, deleted: before - store.sessions.length, activeId: store.activeId || null };
}

function setActiveSession(id, storePath = DEFAULT_STORE) {
  const store = readStore(storePath);
  if (id && !store.sessions.some(session => session.id === id)) return null;
  store.activeId = id || null;
  writeStore(store, storePath);
  return store.activeId;
}

function getActiveSession(storePath = DEFAULT_STORE) {
  const store = readStore(storePath);
  return store.activeId ? getSession(store.activeId, storePath) : null;
}

function setupSessionHandlers(ipcMain) {
  ipcMain.handle('sessions:list', (_event, options) => listSessions(options));
  ipcMain.handle('sessions:get', (_event, id) => getSession(id));
  ipcMain.handle('sessions:create', (_event, payload) => createSession(payload));
  ipcMain.handle('sessions:update', (_event, id, patch) => updateSession(id, patch));
  ipcMain.handle('sessions:delete', (_event, id) => deleteSession(id));
  ipcMain.handle('sessions:setActive', (_event, id) => setActiveSession(id));
  ipcMain.handle('sessions:getActive', () => getActiveSession());
}

module.exports = {
  compactSession,
  createSession,
  deleteSession,
  getActiveSession,
  getSession,
  listSessions,
  normalizeSession,
  readStore,
  sanitizeMessage,
  setupSessionHandlers,
  setActiveSession,
  titleFromMessages,
  updateSession,
  writeStore
};
