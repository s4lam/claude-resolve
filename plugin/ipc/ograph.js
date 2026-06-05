const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('./paths');

const DEFAULT_STORE = path.join(CONFIG_DIR, 'ographs.json');
const NODE_TYPES = new Set(['prompt', 'session', 'asset', 'generation', 'validation', 'render', 'timeline', 'manim', 'action']);
const NODE_STATUSES = new Set(['ready', 'pending', 'warning', 'failed', 'done']);

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix = 'ograph') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ensureStoreDir(storePath = DEFAULT_STORE) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
}

function readStore(storePath = DEFAULT_STORE) {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    return Array.isArray(parsed) ? parsed.map(normalizeOgraph).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeStore(graphs, storePath = DEFAULT_STORE) {
  ensureStoreDir(storePath);
  fs.writeFileSync(storePath, JSON.stringify(Array.isArray(graphs) ? graphs : [], null, 2));
}

function cleanText(value, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

function normalizeNode(node = {}, index = 0) {
  const type = NODE_TYPES.has(node.type) ? node.type : 'generation';
  const id = cleanText(node.id, `${type}-${index + 1}`);
  const label = cleanText(node.label, type);
  return {
    id,
    type,
    label,
    status: NODE_STATUSES.has(node.status) ? node.status : 'ready',
    summary: cleanText(node.summary, ''),
    data: node.data && typeof node.data === 'object' ? node.data : {}
  };
}

function normalizeEdge(edge = {}, index = 0) {
  const from = cleanText(edge.from);
  const to = cleanText(edge.to);
  if (!from || !to || from === to) return null;
  return {
    id: cleanText(edge.id, `edge-${index + 1}`),
    from,
    to,
    label: cleanText(edge.label, '')
  };
}

function normalizeOgraph(input = {}) {
  const now = nowIso();
  const nodes = Array.isArray(input.nodes)
    ? input.nodes.map(normalizeNode).filter(Boolean)
    : [];
  const nodeIds = new Set(nodes.map(node => node.id));
  const edges = Array.isArray(input.edges)
    ? input.edges.map(normalizeEdge).filter(edge => edge && nodeIds.has(edge.from) && nodeIds.has(edge.to))
    : [];

  return {
    id: cleanText(input.id, makeId()),
    title: cleanText(input.title, 'Untitled Ograph'),
    source: cleanText(input.source, 'manual'),
    prompt: cleanText(input.prompt, ''),
    provider: cleanText(input.provider, ''),
    model: cleanText(input.model, ''),
    width: Number(input.width) || 1920,
    height: Number(input.height) || 1080,
    fps: Number(input.fps) || 25,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    nodes,
    edges,
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
  };
}

function listOgraphs(storePath = DEFAULT_STORE) {
  return readStore(storePath).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function getOgraph(id, storePath = DEFAULT_STORE) {
  return readStore(storePath).find(graph => graph.id === id) || null;
}

function saveOgraph(payload, storePath = DEFAULT_STORE) {
  const graphs = readStore(storePath);
  const normalized = normalizeOgraph({
    ...payload,
    id: payload?.id || makeId(),
    updatedAt: nowIso()
  });
  const index = graphs.findIndex(graph => graph.id === normalized.id);
  if (index >= 0) graphs[index] = normalized;
  else graphs.unshift(normalized);
  writeStore(graphs, storePath);
  return normalized;
}

function updateOgraph(id, patch = {}, storePath = DEFAULT_STORE) {
  const current = getOgraph(id, storePath);
  if (!current) return null;
  return saveOgraph({
    ...current,
    ...patch,
    id,
    nodes: patch.nodes || current.nodes,
    edges: patch.edges || current.edges,
    metadata: { ...(current.metadata || {}), ...(patch.metadata || {}) },
    createdAt: current.createdAt
  }, storePath);
}

function deleteOgraph(id, storePath = DEFAULT_STORE) {
  const before = readStore(storePath);
  const after = before.filter(graph => graph.id !== id);
  writeStore(after, storePath);
  return { success: true, deleted: before.length - after.length };
}

function createOgraphFromGeneration(payload = {}, storePath = DEFAULT_STORE) {
  const source = cleanText(payload.source, 'generation');
  const prompt = cleanText(payload.prompt || payload.previousPrompt || '');
  const generation = payload.generation || payload.latestGeneration || {};
  const html = cleanText(generation.html || payload.html || '');
  const name = cleanText(generation.name || generation.previousName || payload.title || 'Generated Overlay');
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  const session = payload.session || payload.activeSession || null;
  const width = Number(payload.width || payload.config?.width) || 1920;
  const height = Number(payload.height || payload.config?.height) || 1080;
  const fps = Number(payload.fps || payload.config?.fps) || 25;
  const nodes = [
    {
      id: 'prompt',
      type: 'prompt',
      label: 'Creative Prompt',
      status: prompt ? 'done' : 'warning',
      summary: prompt || 'No original prompt captured.',
      data: { prompt }
    }
  ];

  if (session?.id || session?.title || session?.name) {
    const sessionTitle = cleanText(session.title || session.name || 'Current Session');
    const messageCount = Number(session.messageCount || session.messages?.length || 0) || 0;
    nodes.push({
      id: 'session',
      type: 'session',
      label: sessionTitle,
      status: 'done',
      summary: messageCount ? `${messageCount} message${messageCount === 1 ? '' : 's'} captured in source session.` : 'Linked to current source session.',
      data: {
        sessionId: cleanText(session.id || ''),
        title: sessionTitle,
        messageCount,
        updatedAt: cleanText(session.updatedAt || session.createdAt || '')
      }
    });
  }

  if (assets.length) {
    nodes.push({
      id: 'assets',
      type: 'asset',
      label: 'Assets',
      status: 'done',
      summary: `${assets.length} selected asset${assets.length === 1 ? '' : 's'}`,
      data: { assets }
    });
  }

  nodes.push(
    {
      id: 'generation',
      type: 'generation',
      label: name,
      status: html ? 'done' : 'warning',
      summary: html ? 'HTML overlay generated.' : 'No HTML captured yet.',
      data: { html }
    },
    {
      id: 'validation',
      type: 'validation',
      label: 'Validation',
      status: Array.isArray(payload.validationWarnings) && payload.validationWarnings.length ? 'warning' : 'ready',
      summary: Array.isArray(payload.validationWarnings) && payload.validationWarnings.length
        ? `${payload.validationWarnings.length} warning${payload.validationWarnings.length === 1 ? '' : 's'}`
        : 'Ready for validation.',
      data: { warnings: payload.validationWarnings || [] }
    },
    {
      id: 'render',
      type: 'render',
      label: 'Render',
      status: payload.rendered ? 'done' : 'pending',
      summary: payload.rendered ? 'Rendered output exists.' : 'Not rendered yet.',
      data: { render: payload.render || {} }
    },
    {
      id: 'timeline',
      type: 'timeline',
      label: 'Timeline',
      status: payload.timelineName ? 'done' : 'pending',
      summary: payload.timelineName ? `Added to ${payload.timelineName}` : 'Not added to timeline yet.',
      data: { timelineName: payload.timelineName || '' }
    }
  );

  const chain = nodes.map(node => node.id);
  const edges = chain.slice(1).map((to, index) => ({
    id: `edge-${index + 1}`,
    from: chain[index],
    to,
    label: index === 0 ? 'feeds' : 'then'
  }));

  return saveOgraph({
    title: name,
    source,
    prompt,
    provider: cleanText(payload.provider || payload.config?.provider || ''),
    model: cleanText(payload.model || payload.config?.model || ''),
    width,
    height,
    fps,
    nodes,
    edges,
    metadata: {
      generationName: name,
      renderPreset: payload.config?.render?.renderPreset || payload.render?.renderPreset || '',
      sourceMessageId: payload.messageId || '',
      sourceSessionId: cleanText(session?.id || ''),
      sourceSessionTitle: cleanText(session?.title || session?.name || ''),
      sourceRenderName: payload.render?.name || '',
      sourceTemplateId: payload.templateId || ''
    }
  }, storePath);
}

function createOgraphFromManim(payload = {}, storePath = DEFAULT_STORE) {
  const config = payload.config || {};
  const render = payload.renderResult || payload.render || {};
  const validation = payload.validation || render.validation || {};
  const title = cleanText(render.outputName || payload.name || 'Manim Scene');
  const idea = cleanText(payload.idea || payload.prompt || 'Manim scene');
  const width = Number(payload.width || config.width) || 1920;
  const height = Number(payload.height || config.height) || 1080;
  const fps = Number(payload.fps || config.fps) || 25;
  const source = typeof payload.source === 'string' ? payload.source : '';
  const hasRenderFailure = Boolean(render.error);
  const renderStatus = render.success ? 'done' : hasRenderFailure ? 'failed' : 'pending';
  const hasValidation = Boolean(payload.validation || render.validation);
  const validationErrors = Array.isArray(validation.errors) ? validation.errors : [];
  const validationWarnings = Array.isArray(validation.warnings) ? validation.warnings : [];

  const nodes = [
    {
      id: 'prompt',
      type: 'prompt',
      label: 'Scene Brief',
      status: idea ? 'done' : 'warning',
      summary: idea || 'No Manim brief captured.',
      data: {
        idea,
        style: cleanText(payload.style || ''),
        duration: Number(payload.duration) || null
      }
    },
    {
      id: 'manim-source',
      type: 'manim',
      label: 'Manim Source',
      status: source ? 'done' : 'warning',
      summary: source ? 'Python scene source captured.' : 'No Python source captured.',
      data: {
        source,
        quality: cleanText(payload.quality || render.quality || ''),
        health: payload.health || {}
      }
    },
    {
      id: 'validation',
      type: 'validation',
      label: 'Source Validation',
      status: !hasValidation ? 'pending' : validationErrors.length ? 'failed' : validationWarnings.length ? 'warning' : 'done',
      summary: !hasValidation
        ? 'Source not validated yet.'
        : validationErrors.length
        ? `${validationErrors.length} validation error${validationErrors.length === 1 ? '' : 's'}`
        : validationWarnings.length
          ? `${validationWarnings.length} validation warning${validationWarnings.length === 1 ? '' : 's'}`
          : 'Source passed validation.',
      data: {
        valid: hasValidation ? validation.valid !== false : null,
        errors: validationErrors,
        warnings: validationWarnings
      }
    },
    {
      id: 'render',
      type: 'render',
      label: 'Manim Render',
      status: renderStatus,
      summary: render.success ? 'Rendered MP4 exists in Render History.' : cleanText(render.error || 'Render not completed yet.'),
      data: {
        outputName: cleanText(render.outputName || ''),
        outputPath: cleanText(render.outputPath || render.path || ''),
        sourcePath: cleanText(render.sourcePath || ''),
        error: cleanText(render.error || '')
      }
    },
    {
      id: 'timeline',
      type: 'timeline',
      label: 'Timeline',
      status: payload.timelineName ? 'done' : 'pending',
      summary: payload.timelineName ? `Added to ${payload.timelineName}` : 'Not added to timeline yet.',
      data: { timelineName: cleanText(payload.timelineName || '') }
    }
  ];

  return saveOgraph({
    title,
    source: 'manim',
    prompt: idea,
    provider: cleanText(config.provider || payload.provider || ''),
    model: cleanText(config.model || payload.model || ''),
    width,
    height,
    fps,
    nodes,
    edges: [
      { id: 'edge-1', from: 'prompt', to: 'manim-source', label: 'drives' },
      { id: 'edge-2', from: 'manim-source', to: 'validation', label: 'checks' },
      { id: 'edge-3', from: 'validation', to: 'render', label: 'renders' },
      { id: 'edge-4', from: 'render', to: 'timeline', label: 'places' }
    ],
    metadata: {
      sourceType: 'manim',
      sourceRenderName: cleanText(render.outputName || ''),
      sourceRenderPath: cleanText(render.outputPath || render.path || ''),
      sourcePath: cleanText(render.sourcePath || ''),
      quality: cleanText(payload.quality || render.quality || ''),
      style: cleanText(payload.style || ''),
      duration: Number(payload.duration) || null
    }
  }, storePath);
}

function buildOgraphPrompt(graph, action = 'regenerate') {
  const normalized = normalizeOgraph(graph || {});
  const generation = normalized.nodes.find(node => node.type === 'generation');
  const manimNode = normalized.nodes.find(node => node.type === 'manim');
  const isManimGraph = normalized.source === 'manim' || Boolean(manimNode);
  if (isManimGraph) {
    const source = manimNode?.data?.source || '';
    const validation = normalized.nodes.find(node => node.type === 'validation');
    const render = normalized.nodes.find(node => node.type === 'render');
    const prompt = [
      `Ograph action: ${cleanText(action, 'regenerate')}.`,
      `Project: ${normalized.title}.`,
      `Output: ${normalized.width}x${normalized.height}, ${normalized.fps}fps.`,
      normalized.prompt ? `Original Manim brief: ${normalized.prompt}` : '',
      'Graph state:',
      ...normalized.nodes.map(node => `- ${node.label} [${node.type}/${node.status}]: ${node.summary}`),
      validation?.data?.errors?.length ? `Validation errors: ${validation.data.errors.join('; ')}` : '',
      validation?.data?.warnings?.length ? `Validation warnings: ${validation.data.warnings.join('; ')}` : '',
      render?.data?.error ? `Render error: ${render.data.error}` : '',
      'Return one complete corrected Manim Python source file.',
      'Requirements:',
      '- Use Manim Community Edition APIs only.',
      '- Include a class named ResolveAIManimScene(Scene).',
      '- Keep the scene deterministic and suitable for local rendering.',
      '- Do not read files, access the network, launch subprocesses, or use unsafe imports.',
      '- Match the requested output dimensions, timing, and visual intent.',
      source ? `Current Manim source:\n\`\`\`python\n${source}\n\`\`\`` : ''
    ].filter(Boolean).join('\n');
    return {
      prompt,
      html: '',
      manimSource: source
    };
  }
  const prompt = [
    `Ograph action: ${cleanText(action, 'regenerate')}.`,
    `Project: ${normalized.title}.`,
    `Output: ${normalized.width}x${normalized.height}, ${normalized.fps}fps.`,
    normalized.prompt ? `Original prompt: ${normalized.prompt}` : '',
    'Graph state:',
    ...normalized.nodes.map(node => `- ${node.label} [${node.type}/${node.status}]: ${node.summary}`),
    generation?.data?.html ? 'Use the current HTML as style/context. Return one complete corrected or improved HTML overlay with getAnimationDuration() and renderFrame(frame, fps).' : 'Return one complete HTML overlay with getAnimationDuration() and renderFrame(frame, fps).'
  ].filter(Boolean).join('\n');
  return {
    prompt,
    html: generation?.data?.html || ''
  };
}

function setupOgraphHandlers(ipcMain) {
  ipcMain.handle('ograph:list', () => listOgraphs());
  ipcMain.handle('ograph:get', (_event, id) => getOgraph(id));
  ipcMain.handle('ograph:save', (_event, payload) => saveOgraph(payload));
  ipcMain.handle('ograph:update', (_event, id, patch) => updateOgraph(id, patch));
  ipcMain.handle('ograph:delete', (_event, id) => deleteOgraph(id));
  ipcMain.handle('ograph:createFromGeneration', (_event, payload) => createOgraphFromGeneration(payload));
  ipcMain.handle('ograph:createFromManim', (_event, payload) => createOgraphFromManim(payload));
  ipcMain.handle('ograph:buildPrompt', (_event, graph, action) => buildOgraphPrompt(graph, action));
}

module.exports = {
  DEFAULT_STORE,
  buildOgraphPrompt,
  createOgraphFromGeneration,
  createOgraphFromManim,
  deleteOgraph,
  getOgraph,
  listOgraphs,
  normalizeOgraph,
  saveOgraph,
  setupOgraphHandlers,
  updateOgraph
};
