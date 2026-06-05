const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');

async function loadPlaywright() {
    try {
        return require('playwright');
    } catch {
        return require(path.join(__dirname, '..', 'plugin', 'renderer', 'node_modules', 'playwright'));
    }
}

function ffmpegPath(root) {
    try {
        const modulePath = require.resolve('ffmpeg-static', {
            paths: [path.join(root, 'plugin', 'renderer')]
        });
        const resolved = require(modulePath);
        if (resolved && fs.existsSync(resolved)) return resolved;
    } catch {
        // Fall through to system ffmpeg for contributors who use their own setup.
    }
    return 'ffmpeg';
}

function cleanDir(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
}

function makeGif(root, framesDir, output) {
    const ffmpeg = ffmpegPath(root);
    const palette = path.join(framesDir, 'palette.png');
    const pattern = path.join(framesDir, 'frame-%03d.png');
    execFileSync(ffmpeg, [
        '-y',
        '-framerate', '1',
        '-i', pattern,
        '-vf', 'fps=8,scale=960:-1:flags=lanczos,palettegen',
        palette
    ], { stdio: 'ignore' });
    execFileSync(ffmpeg, [
        '-y',
        '-framerate', '1',
        '-i', pattern,
        '-i', palette,
        '-lavfi', 'fps=8,scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3',
        '-loop', '0',
        output
    ], { stdio: 'ignore' });
}

async function startServer(distIndex) {
    const distDir = path.dirname(distIndex);
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
            const safePath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
            const filePath = path.resolve(distDir, safePath);
            if (!filePath.startsWith(distDir) || !fs.existsSync(filePath)) {
                res.writeHead(404);
                res.end('not found');
                return;
            }
            const ext = path.extname(filePath).toLowerCase();
            const type = ext === '.js' ? 'text/javascript'
                : ext === '.css' ? 'text/css'
                    : ext === '.svg' ? 'image/svg+xml'
                        : ext === '.woff2' ? 'font/woff2'
                            : 'text/html';
            res.writeHead(200, { 'content-type': type });
            fs.createReadStream(filePath).pipe(res);
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

async function setupPage(page) {
    await page.addInitScript(() => {
        const sampleHtml = '<!doctype html><html><body style="margin:0;background:transparent"><div style="width:1920px;height:1080px;display:grid;place-items:center;color:#f0e7c8;background:#09251d;font:96px serif">Resolve AI</div><script>window.getAnimationDuration=()=>5;window.renderFrame=()=>{};</script></body></html>';
        const latestManimSource = 'from manim import *\n\nclass ResolveAIManimScene(Scene):\n    def construct(self):\n        self.play(Create(Square()))';
        let config = {
            provider: 'codex',
            model: 'sonnet',
            codexModel: 'gpt-5',
            fps: 25,
            width: 1920,
            height: 1080,
            selectedAssetIds: [],
            render: { renderPreset: 'prores_mov', outputFormat: 'prores', proresProfile: '4444' },
            ui: { activeWorkspaceMode: 'create', activeToolTab: 'create' }
        };
        const session = {
            id: 'readme-session',
            title: 'Demo Session',
            projectName: 'Resolve AI Demo',
            timelineName: 'Timeline 1',
            messages: [
                {
                    id: 1,
                    type: 'assistant',
                    prompt: 'Create a premium creator title card.',
                    text: `\`\`\`html\n<!-- FILE: CreatorTitle.html -->\n${sampleHtml}\n\`\`\``,
                    parsed: { type: 'html', name: 'CreatorTitle', html: sampleHtml, mode: 'frame' }
                },
                {
                    id: 2,
                    type: 'assistant',
                    text: `Here is a Manim scene:\n\n\`\`\`python\n${latestManimSource}\n\`\`\``
                }
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        let graphs = [{
            id: 'ograph-demo',
            title: 'Creator Title Ograph',
            source: 'render',
            prompt: 'Create a premium creator title card.',
            provider: 'codex',
            model: 'gpt-5',
            width: 1920,
            height: 1080,
            fps: 25,
            nodes: [
                { id: 'prompt', type: 'prompt', label: 'Creative Prompt', status: 'done', summary: 'Premium creator title card.', data: { prompt: 'Create a premium creator title card.' } },
                { id: 'generation', type: 'generation', label: 'Generated HTML', status: 'done', summary: 'HTML overlay generated.', data: { html: sampleHtml } },
                { id: 'render', type: 'render', label: 'Render', status: 'pending', summary: 'Ready to render.', data: { render: {} } }
            ],
            edges: [
                { id: 'e1', from: 'prompt', to: 'generation', label: 'feeds' },
                { id: 'e2', from: 'generation', to: 'render', label: 'then' }
            ]
        }];
        const noop = () => {};
        const agent = {
            checkAuth: async () => ({ status: 'ready', provider: 'codex', label: 'Codex CLI' }),
            onOutput: () => noop,
            onError: () => noop,
            onStatus: () => noop,
            onDone: () => noop,
            sendPrompt: noop,
            repairRender: noop,
            restart: noop,
            abort: noop,
            openLoginTerminal: noop
        };
        window.agentAPI = agent;
        window.claudeAPI = agent;
        window.configAPI = {
            get: async () => config,
            set: async (partial) => {
                config = {
                    ...config,
                    ...partial,
                    ui: { ...(config.ui || {}), ...(partial.ui || {}) },
                    render: { ...(config.render || {}), ...(partial.render || {}) }
                };
                return config;
            }
        };
        window.windowAPI = {
            getState: async () => ({ maximized: true, fullScreen: false }),
            resize: async () => ({}),
            minimize: async () => ({}),
            close: async () => ({}),
            toggleMaximize: async () => ({}),
            openExternal: async () => ({})
        };
        window.resolveAPI = {
            getTimelineSettings: async () => ({ fps: 25, width: 1920, height: 1080 }),
            getProjectName: async () => 'Resolve AI Demo',
            getCurrentTimeline: async () => 'Timeline 1',
            cleanup: noop
        };
        window.timelineAPI = {
            getContext: async () => ({ projectName: 'Resolve AI Demo', timelineName: 'Timeline 1', fps: 25, width: 1920, height: 1080 })
        };
        window.sessionsAPI = {
            list: async () => [session],
            get: async () => session,
            getActive: async () => session,
            setActive: async () => session.id,
            create: async () => session,
            update: async () => session,
            delete: async () => ({ success: true })
        };
        window.overlayAPI = {
            renderMov: async () => ({ success: true, name: 'CreatorTitle.mov', path: 'C:\\Temp\\CreatorTitle.mov', metadata: { source: 'readme' } }),
            syncToMediaPool: async () => ({ success: true, synced: 1 }),
            listRenders: async () => [],
            revealRender: async () => ({ success: true }),
            addRenderToTimeline: async () => ({ success: true }),
            queue: async () => ({ jobs: [] }),
            onRenderProgress: () => noop,
            validate: async () => ({ warnings: [], compatibility: { status: 'ready', label: 'Ready', score: 100, summary: 'Ready for render.', chips: ['Frame-safe'] } }),
            getRenderHealth: async () => ({ status: 'ready' }),
            repairRenderDeps: async () => ({ status: 'ready' }),
            getLastRenderError: async () => null
        };
        window.assetAPI = { list: async () => [], resolveHtml: async (html) => html };
        window.templateAPI = { list: async () => [], save: async () => ({}), delete: async () => ({}) };
        window.galleryAPI = { list: async () => [], use: async () => null };
        window.captionAPI = { parse: async () => ({ cues: [] }), generate: async () => ({}) };
        window.roughCutAPI = {};
        window.shortsAPI = {};
        window.variationAPI = {};
        window.debugAPI = {};
        window.runtimeQAAPI = { run: async () => ({ status: 'pass', summary: { pass: 4, warn: 0, fail: 0 }, checks: [] }) };
        window.showcaseAPI = {};
        window.updatesAPI = { check: async () => ({ updateAvailable: false }) };
        window.previewAPI = { getBundle: async () => '', getRealtimeBundle: async () => '' };
        window.ographAPI = {
            list: async () => graphs,
            get: async (id) => graphs.find(item => item.id === id) || graphs[0],
            save: async () => graphs[0],
            update: async (id, patch) => {
                graphs = graphs.map(item => item.id === id ? { ...item, ...patch } : item);
                return graphs.find(item => item.id === id);
            },
            delete: async () => ({ success: true }),
            createFromGeneration: async (payload = {}) => {
                const created = {
                    id: 'ograph-chat-demo',
                    title: payload.generation?.name || 'CreatorTitle',
                    source: 'chat',
                    prompt: payload.prompt || 'Create a premium creator title card.',
                    nodes: [
                        { id: 'prompt', type: 'prompt', label: 'Creative Prompt', status: 'done', summary: payload.prompt || 'Prompt captured.', data: { prompt: payload.prompt || '' } },
                        { id: 'generation', type: 'generation', label: payload.generation?.name || 'CreatorTitle', status: 'done', summary: 'HTML overlay captured from chat.', data: { html: payload.generation?.html || sampleHtml } },
                        { id: 'render', type: 'render', label: 'Render', status: 'pending', summary: 'Not rendered yet.', data: { render: {} } }
                    ],
                    edges: [
                        { id: 'c1', from: 'prompt', to: 'generation', label: 'feeds' },
                        { id: 'c2', from: 'generation', to: 'render', label: 'then' }
                    ]
                };
                graphs = [created, ...graphs.filter(item => item.id !== created.id)];
                return created;
            },
            createFromManim: async (payload = {}) => {
                const created = {
                    id: 'ograph-manim-demo',
                    title: 'Manim Demo Graph',
                    source: 'manim',
                    prompt: payload.idea || 'Manim demo',
                    nodes: [
                        { id: 'prompt', type: 'prompt', label: 'Scene Brief', status: 'done', summary: payload.idea || 'Manim demo', data: {} },
                        { id: 'manim-source', type: 'manim', label: 'Manim Source', status: 'done', summary: 'Source captured.', data: { source: payload.source || latestManimSource } },
                        { id: 'render', type: 'render', label: 'Manim Render', status: payload.renderResult?.success ? 'done' : 'pending', summary: 'Rendered MP4 exists.', data: { outputName: 'ManimDemo.mp4' } }
                    ],
                    edges: []
                };
                graphs = [created, ...graphs.filter(item => item.id !== created.id)];
                return created;
            },
            buildPrompt: async () => ({ prompt: 'Make this graph more cinematic.', html: sampleHtml })
        };
        window.manimAPI = {
            detect: async () => ({ status: 'ready', ready: true, mode: 'python-module', manim: { version: 'Manim CE' }, suggestions: [] }),
            getStarterScenes: async () => [{ id: 'concept-map', title: 'Concept Map', description: 'Safe starter scene.', source: latestManimSource }],
            buildPrompt: async () => ({ prompt: 'Create a Manim scene.', safeMode: true }),
            validateSource: async () => ({ valid: true, errors: [], warnings: [] }),
            renderScene: async () => ({ success: true, outputName: 'ManimDemo.mp4', validation: { valid: true, errors: [], warnings: [] } })
        };
    });
}

async function capture(page, framesDir, index) {
    await page.screenshot({ path: path.join(framesDir, `frame-${String(index).padStart(3, '0')}.png`) });
}

async function main() {
    const root = path.resolve(__dirname, '..');
    const distIndex = path.join(root, 'plugin', 'dist', 'index.html');
    if (!fs.existsSync(distIndex)) {
        throw new Error('Missing plugin/dist/index.html. Run npm --prefix plugin run build first.');
    }

    const mediaDir = path.join(root, 'docs', 'media');
    const framesRoot = path.join(root, 'artifacts', 'readme-media-frames');
    fs.mkdirSync(mediaDir, { recursive: true });
    cleanDir(framesRoot);

    const { chromium } = await loadPlaywright();
    const server = await startServer(distIndex);
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 1 });
    await setupPage(page);

    const address = server.address();
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'networkidle' });
    const blankPrompt = page.getByText('Start with a blank prompt');
    if (await blankPrompt.count()) await blankPrompt.click({ timeout: 10000 });
    await page.getByRole('button', { name: 'Save to Ograph' }).waitFor({ timeout: 10000 });

    const workspaceFrames = path.join(framesRoot, 'workspace');
    cleanDir(workspaceFrames);
    await capture(page, workspaceFrames, 1);
    await page.getByRole('button', { name: 'Save to Ograph' }).click();
    await page.locator('.ograph-stage-map').waitFor({ timeout: 10000 });
    await capture(page, workspaceFrames, 2);
    await page.getByRole('tab', { name: 'Manim Lab' }).click();
    await page.getByText('Render Manim MP4').waitFor({ timeout: 10000 });
    await capture(page, workspaceFrames, 3);
    await page.getByRole('button', { name: 'Produce' }).click();
    await page.getByRole('tab', { name: 'Timeline' }).waitFor({ timeout: 10000 });
    await capture(page, workspaceFrames, 4);
    makeGif(root, workspaceFrames, path.join(mediaDir, 'resolve-ai-workspace.gif'));

    const graphFrames = path.join(framesRoot, 'ograph-manim');
    cleanDir(graphFrames);
    await page.getByRole('button', { name: 'Create' }).click();
    await page.getByRole('tab', { name: 'Ograph' }).click();
    await page.locator('.ograph-stage-node.generation').first().click();
    await capture(page, graphFrames, 1);
    await page.locator('.ograph-action-grid .mini-action', { hasText: 'Use as Manim brief' }).click();
    await page.getByText(/Loaded brief from Ograph:/).waitFor({ timeout: 10000 });
    await capture(page, graphFrames, 2);
    await page.getByRole('button', { name: 'Use latest AI source' }).click();
    await capture(page, graphFrames, 3);
    await page.getByRole('button', { name: 'Render Manim MP4' }).click();
    await page.getByRole('button', { name: 'Add at Playhead' }).waitFor({ timeout: 10000 });
    await capture(page, graphFrames, 4);
    makeGif(root, graphFrames, path.join(mediaDir, 'ograph-manim-lab.gif'));

    await browser.close();
    server.close();
    console.log(path.join(mediaDir, 'resolve-ai-workspace.gif'));
    console.log(path.join(mediaDir, 'ograph-manim-lab.gif'));
}

main().catch(err => {
    console.error(err?.stack || err?.message || String(err));
    process.exit(1);
});
