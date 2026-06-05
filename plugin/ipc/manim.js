const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const { ENV, isMac, CONFIG_DIR, RENDER_DIR } = require('./paths');

const MANIM_CANDIDATES = isMac
  ? ['/opt/homebrew/bin/manim', '/usr/local/bin/manim', 'manim']
  : [
      path.join(process.env.APPDATA || '', 'Python', 'Scripts', 'manim.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312', 'Scripts', 'manim.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311', 'Scripts', 'manim.exe'),
      'manim'
    ];

const PYTHON_CANDIDATES = isMac
  ? ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', 'python3', 'python']
  : ['py', 'python', 'python3'];

const MANIM_DIR = path.join(CONFIG_DIR, 'manim');
const MANIM_SCENE_DIR = path.join(MANIM_DIR, 'scenes');
const DANGEROUS_PATTERNS = [
  /\b(open|eval|exec|compile|__import__|input|breakpoint)\s*\(/,
  /\b(subprocess|socket|requests|urllib|httpx|ftplib|paramiko|ctypes|pickle|marshal|shutil)\b/,
  /\b(os|sys|pathlib)\s*\./,
  /\b(globals|locals|vars)\s*\(/,
  /from\s+(os|sys|subprocess|socket|requests|urllib|pathlib|shutil|ctypes|pickle|marshal)\s+import\b/,
  /import\s+(os|sys|subprocess|socket|requests|urllib|pathlib|shutil|ctypes|pickle|marshal)\b/
];
const ALLOWED_IMPORT_ROOTS = new Set(['manim', 'math', 'numpy', 'random']);

const STARTER_SCENES = [
  {
    id: 'concept-map',
    title: 'Concept Map',
    description: 'Three labeled ideas connect into one clean conclusion.',
    source: String.raw`from manim import *


class ResolveAIManimScene(Scene):
    def construct(self):
        title = Text("Core Idea", font_size=44).to_edge(UP)
        nodes = VGroup(
            RoundedRectangle(corner_radius=0.18, width=2.8, height=1.0).set_fill(BLUE_E, opacity=0.35),
            RoundedRectangle(corner_radius=0.18, width=2.8, height=1.0).set_fill(GREEN_E, opacity=0.35),
            RoundedRectangle(corner_radius=0.18, width=2.8, height=1.0).set_fill(ORANGE, opacity=0.28)
        ).arrange(RIGHT, buff=0.55).move_to(ORIGIN)
        labels = VGroup(
            Text("Hook", font_size=28),
            Text("Context", font_size=28),
            Text("Payoff", font_size=28)
        )
        for label, box in zip(labels, nodes):
            label.move_to(box)
        arrows = VGroup(
            Arrow(nodes[0].get_right(), nodes[1].get_left(), buff=0.12),
            Arrow(nodes[1].get_right(), nodes[2].get_left(), buff=0.12)
        )
        self.play(Write(title), run_time=0.8)
        self.play(LaggedStart(*[Create(box) for box in nodes], lag_ratio=0.18), run_time=1.2)
        self.play(LaggedStart(*[FadeIn(label, shift=UP * 0.15) for label in labels], lag_ratio=0.12), run_time=0.9)
        self.play(LaggedStart(*[GrowArrow(arrow) for arrow in arrows], lag_ratio=0.18), run_time=0.8)
        self.wait(1.2)`
  },
  {
    id: 'equation-reveal',
    title: 'Equation Reveal',
    description: 'A simple formula resolves into a labeled takeaway.',
    source: String.raw`from manim import *


class ResolveAIManimScene(Scene):
    def construct(self):
        equation = MathTex("a^2", "+", "b^2", "=", "c^2").scale(1.6)
        label = Text("Relationship becomes visible", font_size=34).next_to(equation, DOWN, buff=0.55)
        frame = SurroundingRectangle(equation, buff=0.28, corner_radius=0.16).set_stroke(TEAL, width=3)
        self.play(Write(equation[0]), Write(equation[2]), run_time=0.8)
        self.play(FadeIn(equation[1]), FadeIn(equation[3]), Write(equation[4]), run_time=0.9)
        self.play(Create(frame), FadeIn(label, shift=UP * 0.2), run_time=0.9)
        self.wait(1.4)`
  },
  {
    id: 'process-steps',
    title: 'Process Steps',
    description: 'A compact three-step explainer with motion-safe labels.',
    source: String.raw`from manim import *


class ResolveAIManimScene(Scene):
    def construct(self):
        steps = VGroup(
            Text("1. Find", font_size=34),
            Text("2. Shape", font_size=34),
            Text("3. Render", font_size=34)
        ).arrange(DOWN, aligned_edge=LEFT, buff=0.45)
        panel = RoundedRectangle(corner_radius=0.22, width=5.2, height=3.1).set_fill("#111827", opacity=0.9).set_stroke("#60a5fa", width=2)
        group = VGroup(panel, steps).move_to(ORIGIN)
        for step in steps:
            step.move_to(step.get_center() + RIGHT * 0.35)
        self.play(FadeIn(panel, scale=0.96), run_time=0.6)
        for step in steps:
            self.play(FadeIn(step, shift=RIGHT * 0.25), run_time=0.45)
        self.wait(1.2)`
  }
];

function uniqueCandidates(items) {
  return [...new Set(items.filter(Boolean))];
}

function defaultRunCommand(command, args = []) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: ENV,
    timeout: 8000,
    windowsHide: true
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? result.error.message : ''
  };
}

function firstLine(text = '') {
  return String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)[0] || '';
}

function getManimStarterScenes() {
  return STARTER_SCENES.map(scene => ({ ...scene }));
}

function sanitizeFilename(value = 'manim-scene') {
  return String(value || 'manim-scene')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'manim-scene';
}

function probeFirst(candidates, args, runCommand = defaultRunCommand) {
  for (const command of uniqueCandidates(candidates)) {
    const result = runCommand(command, args);
    if (result.ok) {
      return {
        installed: true,
        command,
        version: firstLine(`${result.stdout}\n${result.stderr}`),
        error: ''
      };
    }
  }
  return {
    installed: false,
    command: '',
    version: '',
    error: 'Command not found or returned an error.'
  };
}

function detectManim(options = {}, runCommand = defaultRunCommand) {
  const python = probeFirst(uniqueCandidates([options.pythonPath, ...PYTHON_CANDIDATES]), ['--version'], runCommand);
  const manimCli = probeFirst(uniqueCandidates([options.manimPath, ...MANIM_CANDIDATES]), ['--version'], runCommand);
  let manim = manimCli;
  let mode = 'cli';

  if (!manim.installed && python.installed) {
    const moduleProbe = runCommand(python.command, ['-m', 'manim', '--version']);
    if (moduleProbe.ok) {
      manim = {
        installed: true,
        command: `${python.command} -m manim`,
        version: firstLine(`${moduleProbe.stdout}\n${moduleProbe.stderr}`),
        error: ''
      };
      mode = 'python-module';
    }
  }

  const status = manim.installed ? 'ready' : python.installed ? 'python-only' : 'missing';
  const suggestions = [];
  if (!python.installed) suggestions.push('Install Python 3.11+.');
  if (!manim.installed) suggestions.push('Install Manim Community Edition: python -m pip install manim.');
  suggestions.push('Keep Manim local. Resolve AI sends only the prompt text you choose to the selected AI provider.');

  return {
    status,
    ready: manim.installed,
    mode: manim.installed ? mode : 'unavailable',
    manim,
    python,
    renderCommand: manim.installed
      ? {
          command: mode === 'python-module' ? python.command : manim.command,
          argsPrefix: mode === 'python-module' ? ['-m', 'manim'] : []
        }
      : null,
    suggestions
  };
}

function buildManimPrompt(payload = {}) {
  const width = Number(payload.width || payload.config?.width) || 1920;
  const height = Number(payload.height || payload.config?.height) || 1080;
  const fps = Number(payload.fps || payload.config?.fps) || 30;
  const duration = Number(payload.duration) || 8;
  const idea = String(payload.idea || '').trim() || 'Create a clear educational motion graphic.';
  const style = String(payload.style || 'clean technical').trim();
  const latestHtml = String(payload.latestGeneration?.html || '').trim();

  const prompt = [
    'Create a Manim Community Edition scene for Resolve AI.',
    `Idea: ${idea}`,
    `Style: ${style}`,
    `Target: ${width}x${height}, ${fps}fps, about ${duration}s.`,
    'Use class name ResolveAIManimScene.',
    'Keep it local and deterministic: no network calls, no external downloads, no secrets, no absolute personal paths.',
    'Prefer vector geometry, text, diagrams, equations, arrows, axes, and clean explanatory motion.',
    'Return one complete Python file in a single ```python code block.',
    'Do not include shell commands unless they are comments at the bottom.',
    latestHtml ? 'Use this latest HTML overlay only as visual style reference, not as executable input:' : '',
    latestHtml ? latestHtml.slice(0, 4000) : ''
  ].filter(Boolean).join('\n');

  return {
    prompt,
    width,
    height,
    fps,
    duration,
    safeMode: true
  };
}

function extractPythonSource(input = '') {
  const text = String(input || '').trim();
  const match = text.match(/```python\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/i);
  return (match ? match[1] : text).trim();
}

function importRoot(line) {
  const trimmed = line.trim();
  const fromMatch = trimmed.match(/^from\s+([A-Za-z_][\w.]*)\s+import\b/);
  if (fromMatch) return fromMatch[1].split('.')[0];
  const importMatch = trimmed.match(/^import\s+([A-Za-z_][\w.]*)/);
  if (importMatch) return importMatch[1].split('.')[0];
  return '';
}

function validateManimSource(input = '') {
  const source = extractPythonSource(input);
  const errors = [];
  const warnings = [];

  if (!source) errors.push('Paste a Manim Python scene first.');
  if (source.length > 120000) errors.push('Scene is too large. Keep generated Manim source under 120 KB.');
  if (!/class\s+ResolveAIManimScene\s*\(/.test(source)) {
    errors.push('Scene must define class ResolveAIManimScene.');
  }
  if (!/(from\s+manim\s+import|import\s+manim)/.test(source)) {
    errors.push('Scene must import Manim.');
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(source)) errors.push(`Blocked unsafe Python pattern: ${pattern.source}`);
  }

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^(from|import)\s+/.test(trimmed)) {
      const root = importRoot(trimmed);
      if (root && !ALLOWED_IMPORT_ROOTS.has(root)) {
        errors.push(`Import not allowed in Manim Lab: ${root}`);
      }
    }
  }

  if (!/def\s+construct\s*\(\s*self\s*\)\s*:/.test(source)) {
    warnings.push('No construct(self) method found. Manim may render an empty scene.');
  }

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    source
  };
}

function buildRenderArgs(scenePath, outputRoot, options = {}, health = {}) {
  const width = Number(options.width) || 1920;
  const height = Number(options.height) || 1080;
  const fps = Number(options.fps) || 30;
  const quality = options.quality || 'low';
  const outputName = sanitizeFilename(options.name || 'ResolveAIManimScene');
  const qualityFlag = quality === 'high' ? '-qh' : quality === 'medium' ? '-qm' : '-ql';
  const renderCommand = health.renderCommand || {
    command: health.mode === 'python-module' && health.python?.command ? health.python.command : health.manim?.command,
    argsPrefix: health.mode === 'python-module' ? ['-m', 'manim'] : []
  };

  return {
    command: renderCommand.command,
    args: [
      ...(renderCommand.argsPrefix || []),
      qualityFlag,
      '--format', 'mp4',
      '--media_dir', outputRoot,
      '--fps', String(fps),
      '-r', `${width},${height}`,
      '-o', outputName,
      scenePath,
      'ResolveAIManimScene'
    ],
    outputName
  };
}

function findNewestMp4(dir) {
  if (!fs.existsSync(dir)) return '';
  const files = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.mp4$/i.test(entry.name)) files.push(full);
    }
  }
  walk(dir);
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || '';
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      env: ENV,
      cwd: options.cwd || undefined,
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      stderr += '\nManim render timed out.';
      proc.kill();
    }, options.timeoutMs || 10 * 60 * 1000);
    proc.stdout.on('data', data => { stdout += data.toString(); });
    proc.stderr.on('data', data => { stderr += data.toString(); });
    proc.on('error', error => {
      clearTimeout(timeout);
      resolve({ ok: false, code: -1, stdout, stderr, error: error.message });
    });
    proc.on('close', code => {
      clearTimeout(timeout);
      resolve({ ok: code === 0, code, stdout, stderr, error: '' });
    });
  });
}

async function renderManimScene(payload = {}, runner = runProcess) {
  const validation = validateManimSource(payload.source || payload.python || '');
  if (!validation.valid) {
    return { success: false, stage: 'validation', validation, error: validation.errors.join(' ') };
  }

  const health = detectManim(payload.options || {});
  if (!health.ready) {
    return { success: false, stage: 'health', validation, health, error: 'Manim is not ready on this machine.' };
  }

  fs.mkdirSync(MANIM_SCENE_DIR, { recursive: true });
  fs.mkdirSync(RENDER_DIR, { recursive: true });
  const sceneBase = sanitizeFilename(payload.name || 'resolve-ai-manim');
  const scenePath = path.join(MANIM_SCENE_DIR, `${sceneBase}-${Date.now()}.py`);
  const outputRoot = path.join(os.tmpdir(), `resolve_ai_manim_${Date.now()}`);
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(scenePath, validation.source, 'utf8');

  const plan = buildRenderArgs(scenePath, outputRoot, payload, health);
  const result = await runner(plan.command, plan.args, { cwd: MANIM_SCENE_DIR });
  if (!result.ok) {
    return {
      success: false,
      stage: 'render',
      validation,
      health,
      scenePath,
      command: plan.command,
      args: plan.args,
      error: firstLine(`${result.stderr}\n${result.error}`) || `Manim exited with code ${result.code}`,
      stdout: result.stdout,
      stderr: result.stderr
    };
  }

  const rendered = findNewestMp4(outputRoot);
  if (!rendered) {
    return { success: false, stage: 'output', validation, health, scenePath, error: 'Manim finished but no MP4 output was found.' };
  }

  const outputName = `${sceneBase}-${Date.now()}.mp4`;
  const outputPath = path.join(RENDER_DIR, outputName);
  fs.copyFileSync(rendered, outputPath);
  const metadataPath = path.join(RENDER_DIR, outputName.replace(/\.mp4$/i, '.json'));
  fs.writeFileSync(metadataPath, JSON.stringify({
    name: outputName,
    path: outputPath,
    type: 'manim',
    source: 'Manim Lab',
    scenePath,
    width: Number(payload.width) || 1920,
    height: Number(payload.height) || 1080,
    fps: Number(payload.fps) || 30,
    createdAt: new Date().toISOString()
  }, null, 2), 'utf8');

  return {
    success: true,
    stage: 'done',
    validation,
    health,
    scenePath,
    outputPath,
    outputName,
    metadataPath
  };
}

function setupManimHandlers(ipcMain) {
  ipcMain.handle('manim:detect', (_event, options) => detectManim(options || {}));
  ipcMain.handle('manim:getStarterScenes', () => getManimStarterScenes());
  ipcMain.handle('manim:buildPrompt', (_event, payload) => buildManimPrompt(payload || {}));
  ipcMain.handle('manim:validateSource', (_event, source) => validateManimSource(source || ''));
  ipcMain.handle('manim:renderScene', (_event, payload) => renderManimScene(payload || {}));
}

module.exports = {
  buildRenderArgs,
  buildManimPrompt,
  detectManim,
  extractPythonSource,
  firstLine,
  getManimStarterScenes,
  probeFirst,
  renderManimScene,
  setupManimHandlers,
  validateManimSource
};
