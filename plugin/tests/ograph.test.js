const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildOgraphPrompt,
  createOgraphFromGeneration,
  createOgraphFromManim,
  deleteOgraph,
  getOgraph,
  listOgraphs,
  normalizeOgraph,
  saveOgraph,
  updateOgraph
} = require('../ipc/ograph');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-ai-ograph-'));
const storePath = path.join(tempDir, 'ographs.json');

try {
  const normalized = normalizeOgraph({
    title: 'Test Graph',
    nodes: [
      { id: 'prompt', type: 'prompt', label: 'Prompt', status: 'done', summary: 'Make a title' },
      { id: 'bad', type: 'unknown', label: 'Bad', status: 'strange' }
    ],
    edges: [
      { from: 'prompt', to: 'bad' },
      { from: 'prompt', to: 'missing' }
    ]
  });
  assert.strictEqual(normalized.title, 'Test Graph');
  assert.strictEqual(normalized.nodes.length, 2);
  assert.strictEqual(normalized.nodes[1].type, 'generation');
  assert.strictEqual(normalized.nodes[1].status, 'ready');
  assert.strictEqual(normalized.edges.length, 1);

  const saved = saveOgraph(normalized, storePath);
  assert.ok(saved.id);
  assert.strictEqual(listOgraphs(storePath).length, 1);
  assert.strictEqual(getOgraph(saved.id, storePath).title, 'Test Graph');

  const updated = updateOgraph(saved.id, { title: 'Updated Graph', metadata: { source: 'test' } }, storePath);
  assert.strictEqual(updated.title, 'Updated Graph');
  assert.strictEqual(updated.metadata.source, 'test');

  const generated = createOgraphFromGeneration({
    source: 'render',
    prompt: 'Make a 5 second title card',
    generation: {
      name: 'Title Card',
      html: '<html><script>window.getAnimationDuration=()=>5; window.renderFrame=()=>{}</script></html>'
    },
    config: {
      provider: 'codex',
      model: 'gpt-5',
      width: 1920,
      height: 1080,
      fps: 25,
      render: { renderPreset: 'prores_mov' }
    },
    assets: [{ id: 'logo-1', name: 'logo.png' }],
    session: { id: 'session-1', title: 'Client Title Work', messageCount: 7, updatedAt: '2026-06-05T00:00:00.000Z' },
    rendered: true,
    timelineName: 'Current timeline',
    render: { name: 'TitleCard.mov', path: '/tmp/TitleCard.mov' }
  }, storePath);
  assert.strictEqual(generated.source, 'render');
  assert.strictEqual(generated.nodes.some(node => node.type === 'asset'), true);
  assert.strictEqual(generated.nodes.some(node => node.type === 'session'), true);
  assert.strictEqual(generated.nodes.some(node => node.type === 'generation'), true);
  assert.strictEqual(generated.nodes.find(node => node.type === 'render').status, 'done');
  assert.strictEqual(generated.nodes.find(node => node.type === 'timeline').status, 'done');
  assert.strictEqual(generated.metadata.sourceRenderName, 'TitleCard.mov');
  assert.strictEqual(generated.metadata.sourceSessionId, 'session-1');
  assert.strictEqual(generated.edges.length >= 5, true);

  const templateGraph = createOgraphFromGeneration({
    source: 'template',
    templateId: 'template-1',
    prompt: 'Saved template prompt',
    generation: {
      name: 'Saved Template',
      html: '<html><script>window.getAnimationDuration=()=>5; window.renderFrame=()=>{}</script></html>'
    }
  }, storePath);
  assert.strictEqual(templateGraph.source, 'template');
  assert.strictEqual(templateGraph.metadata.sourceTemplateId, 'template-1');

  const manimGraph = createOgraphFromManim({
    idea: 'Explain a flywheel with labeled circular motion',
    style: 'clean technical',
    duration: 8,
    source: 'from manim import *\nclass ResolveAIManimScene(Scene):\n    def construct(self):\n        self.play(Create(Circle()))',
    quality: 'low',
    validation: { valid: true, errors: [], warnings: ['Preview quality'] },
    renderResult: {
      success: true,
      outputName: 'Flywheel.mp4',
      outputPath: '/tmp/Flywheel.mp4',
      sourcePath: '/tmp/Flywheel.py'
    },
    config: { provider: 'codex', model: 'gpt-5', width: 1280, height: 720, fps: 30 }
  }, storePath);
  assert.strictEqual(manimGraph.source, 'manim');
  assert.strictEqual(manimGraph.width, 1280);
  assert.strictEqual(manimGraph.nodes.some(node => node.type === 'manim'), true);
  assert.strictEqual(manimGraph.nodes.find(node => node.id === 'render').status, 'done');
  assert.strictEqual(manimGraph.metadata.sourceRenderName, 'Flywheel.mp4');
  assert.ok(manimGraph.nodes.find(node => node.id === 'manim-source').data.source.includes('ResolveAIManimScene'));

  const manimDraftGraph = createOgraphFromManim({
    idea: 'Draft a clean geometry explainer',
    source: 'from manim import *\nclass ResolveAIManimScene(Scene):\n    def construct(self):\n        self.play(Create(Square()))',
    quality: 'low',
    config: { provider: 'codex', model: 'gpt-5', width: 1920, height: 1080, fps: 25 }
  }, storePath);
  assert.strictEqual(manimDraftGraph.source, 'manim');
  assert.strictEqual(manimDraftGraph.nodes.find(node => node.id === 'manim-source').status, 'done');
  assert.strictEqual(manimDraftGraph.nodes.find(node => node.id === 'validation').status, 'pending');
  assert.strictEqual(manimDraftGraph.nodes.find(node => node.id === 'render').status, 'pending');
  assert.strictEqual(manimDraftGraph.metadata.sourceRenderName, '');

  const manimPrompt = buildOgraphPrompt(manimGraph, 'fix render');
  assert.ok(manimPrompt.prompt.includes('Return one complete corrected Manim Python source file.'));
  assert.ok(manimPrompt.prompt.includes('ResolveAIManimScene'));
  assert.ok(manimPrompt.prompt.includes('Current Manim source:'));
  assert.strictEqual(manimPrompt.html, '');
  assert.ok(!manimPrompt.prompt.includes('Return one complete HTML overlay'));

  const actionPrompt = buildOgraphPrompt(generated, 'make more cinematic');
  assert.ok(actionPrompt.prompt.includes('Ograph action: make more cinematic'));
  assert.ok(actionPrompt.prompt.includes('Graph state:'));
  assert.ok(actionPrompt.html.includes('getAnimationDuration'));

  const actionGraph = updateOgraph(generated.id, {
    nodes: [
      ...generated.nodes,
      {
        id: 'action-1',
        type: 'action',
        label: 'Fix',
        status: 'pending',
        summary: 'Drafted fix prompt from Render.',
        data: { action: 'fix render', targetNodeId: 'render' }
      }
    ],
    edges: [...generated.edges, { id: 'edge-action-1', from: 'render', to: 'action-1', label: 'drafts' }]
  }, storePath);
  assert.strictEqual(actionGraph.nodes.some(node => node.type === 'action'), true);
  assert.strictEqual(actionGraph.edges.some(edge => edge.to === 'action-1'), true);

  const deleted = deleteOgraph(saved.id, storePath);
  assert.strictEqual(deleted.deleted, 1);

  console.log('ograph tests passed');
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
