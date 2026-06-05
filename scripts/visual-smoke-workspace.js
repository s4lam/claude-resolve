const fs = require('fs');
const http = require('http');
const path = require('path');

async function loadPlaywright() {
    try {
        return require('playwright');
    } catch {
        const modulePath = path.join(__dirname, '..', 'plugin', 'renderer', 'node_modules', 'playwright');
        return require(modulePath);
    }
}

async function main() {
    const root = path.resolve(__dirname, '..');
    const distIndex = path.join(root, 'plugin', 'dist', 'index.html');
    if (!fs.existsSync(distIndex)) {
        throw new Error('Missing plugin/dist/index.html. Run npm --prefix plugin run build first.');
    }

    const { chromium } = await loadPlaywright();
    const outDir = path.join(root, 'artifacts', 'ui-smoke');
    fs.mkdirSync(outDir, { recursive: true });
    const tracePath = path.join(outDir, 'workspace-ograph-manim.trace.json');
    const mark = (step) => {
        fs.writeFileSync(tracePath, JSON.stringify({ step, at: new Date().toISOString() }, null, 2));
    };
    mark('start');

    const browser = await chromium.launch({ headless: true });
    mark('browser launched');
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1 });
    const browserMessages = [];
    page.on('console', message => browserMessages.push(`${message.type()}: ${message.text()}`));
    page.on('pageerror', error => browserMessages.push(`pageerror: ${error.message}`));

    await page.addInitScript(() => {
        const sampleHtml = '<!doctype html><html><body style="margin:0;background:transparent"><div style="width:1920px;height:1080px;display:grid;place-items:center;color:#f0e7c8;background:#09251d;font:96px serif">Resolve AI</div><script>window.getAnimationDuration=()=>5;window.renderFrame=()=>{};</script></body></html>';
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
        const latestManimSource = 'from manim import *\n\nclass ResolveAIManimScene(Scene):\n    def construct(self):\n        self.play(Create(Square()))';
        let sessions = [{
            id: 'session-1',
            title: 'Smoke Session',
            projectName: 'Smoke Project',
            timelineName: 'Timeline 1',
            messages: [
                {
                    id: 1,
                    type: 'assistant',
                    prompt: 'Create a premium title card.',
                    text: `\`\`\`html\n<!-- FILE: ChatOverlay.html -->\n${sampleHtml}\n\`\`\``,
                    parsed: { type: 'html', name: 'ChatOverlay', html: sampleHtml, mode: 'frame' }
                },
                { id: 2, type: 'assistant', text: `Here is the Manim scene:\n\n\`\`\`python\n${latestManimSource}\n\`\`\`` }
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }];
        let graph = {
            id: 'ograph-smoke',
            title: 'Smoke Test Ograph',
            source: 'render',
            prompt: 'Create a premium title card.',
            provider: 'codex',
            model: 'gpt-5',
            width: 1920,
            height: 1080,
            fps: 25,
            nodes: [
                { id: 'prompt', type: 'prompt', label: 'Creative Prompt', status: 'done', summary: 'Create a premium title card.', data: { prompt: 'Create a premium title card.' } },
                { id: 'generation', type: 'generation', label: 'Generated HTML', status: 'done', summary: 'HTML overlay generated.', data: { html: sampleHtml } },
                { id: 'render', type: 'render', label: 'Render', status: 'done', summary: 'Rendered output exists.', data: { render: { name: 'Smoke.mov', renderPreset: 'prores_mov' } } }
            ],
            edges: [
                { id: 'e1', from: 'prompt', to: 'generation', label: 'feeds' },
                { id: 'e2', from: 'generation', to: 'render', label: 'then' }
            ],
            metadata: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        let graphs = [graph];
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
                config = { ...config, ...partial, ui: { ...(config.ui || {}), ...(partial.ui || {}) }, render: { ...(config.render || {}), ...(partial.render || {}) } };
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
            getProjectName: async () => 'Smoke Project',
            getCurrentTimeline: async () => 'Timeline 1',
            cleanup: noop
        };
        window.timelineAPI = {
            getContext: async () => ({ projectName: 'Smoke Project', timelineName: 'Timeline 1', fps: 25, width: 1920, height: 1080 })
        };
        window.sessionsAPI = {
            list: async () => sessions,
            get: async (id) => sessions.find(session => session.id === id) || null,
            getActive: async () => sessions[0] || null,
            setActive: async () => ({}),
            create: async (payload) => {
                const session = { id: `session-${sessions.length + 1}`, title: payload?.title || 'Smoke Session', messages: payload?.messages || [] };
                sessions = [session, ...sessions];
                return session;
            },
            update: async (id, patch) => {
                sessions = sessions.map(session => session.id === id ? { ...session, ...patch } : session);
                return sessions.find(session => session.id === id) || null;
            },
            delete: async (id) => {
                sessions = sessions.filter(session => session.id !== id);
                return { success: true };
            }
        };
        window.overlayAPI = {
            renderMov: async () => ({ success: true, name: 'SmokeGraph.mov', path: 'C:\\Temp\\SmokeGraph.mov', metadata: { source: 'ograph' } }),
            syncToMediaPool: async () => ({ success: true, synced: 1 }),
            listRenders: async () => [{ name: 'Smoke.mov', size: 2048, metadata: { prompt: 'Create a premium title card.', provider: 'codex', model: 'gpt-5', html: sampleHtml, width: 1920, height: 1080, fps: 25 } }],
            revealRender: async () => ({ success: true }),
            addRenderToTimeline: async () => ({ success: true }),
            queue: async () => ({ jobs: [] }),
            onRenderProgress: () => noop,
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
        window.runtimeQAAPI = {
            run: async () => ({
                status: 'pass',
                summary: { pass: 12, warn: 0, fail: 0 },
                checks: [{ id: 'workspace', label: 'Workspace shell', status: 'pass', detail: 'Rendered' }],
                manual: ['Open Resolve AI inside DaVinci Resolve and confirm workspace controls.']
            })
        };
        window.showcaseAPI = {};
        window.updatesAPI = { check: async () => ({ updateAvailable: false }) };
        window.previewAPI = { getBundle: async () => '', getRealtimeBundle: async () => '' };
        window.__smokeEvents = [];
        window.ographAPI = {
            list: async () => graphs,
            get: async (id) => graphs.find(item => item.id === id) || graphs[0],
            save: async () => graph,
            update: async (_id, patch) => {
                window.__smokeEvents.push({ type: 'ograph:update', id: _id, nodeCount: patch.nodes?.length || 0 });
                const index = graphs.findIndex(item => item.id === _id);
                const current = index >= 0 ? graphs[index] : graph;
                const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
                if (index >= 0) graphs = graphs.map(item => item.id === _id ? next : item);
                else graphs = [next, ...graphs];
                graph = next;
                return next;
            },
            delete: async () => ({ success: true }),
            createFromGeneration: async (payload = {}) => {
                const created = {
                    id: 'ograph-chat-smoke',
                    title: payload.generation?.name || 'Chat Overlay Graph',
                    source: 'chat',
                    prompt: payload.prompt || 'Create a premium title card.',
                    nodes: [
                        { id: 'prompt', type: 'prompt', label: 'Creative Prompt', status: 'done', summary: payload.prompt || 'Prompt captured.', data: { prompt: payload.prompt || '' } },
                        { id: 'generation', type: 'generation', label: payload.generation?.name || 'ChatOverlay', status: 'done', summary: 'HTML overlay captured from chat.', data: { html: payload.generation?.html || sampleHtml } },
                        { id: 'render', type: 'render', label: 'Render', status: payload.rendered ? 'done' : 'pending', summary: payload.rendered ? 'Rendered output exists.' : 'Not rendered yet.', data: { render: payload.render || {} } }
                    ],
                    edges: [
                        { id: 'c1', from: 'prompt', to: 'generation', label: 'feeds' },
                        { id: 'c2', from: 'generation', to: 'render', label: 'then' }
                    ]
                };
                graphs = [created, ...graphs.filter(item => item.id !== created.id)];
                graph = created;
                return created;
            },
            createFromManim: async (payload = {}) => {
                const rendered = Boolean(payload.renderResult?.success);
                const created = {
                    id: rendered ? 'ograph-manim-smoke-rendered' : 'ograph-manim-smoke-draft',
                    title: rendered ? 'Manim Smoke Graph' : 'Manim Smoke Draft',
                    source: 'manim',
                    prompt: payload.idea || 'Manim smoke graph',
                    nodes: [
                        { id: 'prompt', type: 'prompt', label: 'Scene Brief', status: 'done', summary: payload.idea || 'Manim smoke graph', data: { prompt: payload.idea || '' } },
                        { id: 'manim-source', type: 'manim', label: 'Manim Source', status: 'done', summary: 'Source captured.', data: { source: payload.source || latestManimSource } },
                        { id: 'render', type: 'render', label: 'Manim Render', status: rendered ? 'done' : 'pending', summary: rendered ? 'Rendered MP4 exists.' : 'Render not completed yet.', data: { outputName: rendered ? 'SmokeManim.mp4' : '' } }
                    ],
                    edges: [
                        { id: 'm1', from: 'prompt', to: 'manim-source', label: 'drives' },
                        { id: 'm2', from: 'manim-source', to: 'render', label: 'renders' }
                    ]
                };
                graphs = [created, ...graphs.filter(item => item.id !== created.id)];
                graph = created;
                return created;
            },
            buildPrompt: async () => {
                window.__smokeEvents.push({ type: 'ograph:buildPrompt' });
                return { prompt: 'Ograph action smoke prompt.', html: sampleHtml };
            }
        };
        window.manimAPI = {
            detect: async () => ({ status: 'ready', ready: true, mode: 'cli', manim: { version: 'Manim Community v0.19.0' }, suggestions: [] }),
            getStarterScenes: async () => [
                {
                    id: 'smoke-starter',
                    title: 'Concept Map',
                    description: 'Safe starter scene.',
                    source: 'from manim import *\n\nclass ResolveAIManimScene(Scene):\n    def construct(self):\n        self.play(Create(Circle()))'
                }
            ],
            buildPrompt: async () => ({ prompt: 'Create a Manim scene.', safeMode: true }),
            validateSource: async () => ({ valid: true, errors: [], warnings: [], source: '' }),
            renderScene: async () => ({ success: true, outputName: 'SmokeManim.mp4', validation: { valid: true, errors: [], warnings: [] } })
        };
    });

    const server = await new Promise((resolve) => {
        const distDir = path.dirname(distIndex);
        const instance = http.createServer((req, res) => {
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
        instance.listen(0, '127.0.0.1', () => resolve(instance));
    });

    const address = server.address();
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'networkidle' });
    mark('app loaded');
    const blankPrompt = page.getByText('Start with a blank prompt');
    if (await blankPrompt.count()) {
        await blankPrompt.click({ timeout: 10000 });
    }
    try {
        await page.getByRole('button', { name: 'Use in Manim Lab' }).waitFor({ timeout: 10000 });
    } catch (err) {
        const bodyText = await page.locator('body').innerText().catch(() => '');
        throw new Error(`Saved smoke session did not render Manim button. Body: ${bodyText.slice(0, 900)} Logs: ${browserMessages.slice(-8).join(' | ')}`);
    }
    await page.getByRole('button', { name: 'Save to Ograph' }).click();
    await page.getByRole('tab', { name: 'Ograph' }).waitFor({ timeout: 10000 });
    await page.locator('.ograph-card-head strong', { hasText: 'ChatOverlay' }).waitFor({ timeout: 10000 });
    await page.locator('.ograph-stage-node.generation', { hasText: 'ChatOverlay' }).waitFor({ timeout: 10000 });
    mark('chat result saved to ograph');
    await page.locator('.workspace-inspector .inspector-flow-step', { hasText: 'Ograph' }).click();
    await page.getByRole('tab', { name: 'Ograph' }).waitFor({ timeout: 10000 });
    mark('inspector opened ograph');
    await page.locator('.workspace-inspector .inspector-flow-step', { hasText: 'Manim Lab' }).click();
    await page.getByText('Render Manim MP4').waitFor({ timeout: 10000 });
    mark('inspector opened manim');
    await page.getByRole('button', { name: 'Use in Manim Lab' }).click();
    await page.getByText('Render Manim MP4').waitFor({ timeout: 10000 });
    mark('chat manim source loaded');
    await page.locator('.manim-source').evaluate(node => {
        if (!node.value.includes('ResolveAIManimScene')) throw new Error('Chat Manim source did not populate Manim source.');
        if (!node.value.includes('Square')) throw new Error('Chat Manim source did not populate.');
    });
    await page.getByRole('button', { name: 'Save draft to Ograph' }).click();
    await page.locator('.ograph-readiness', { hasText: 'Manim source ready' }).waitFor({ timeout: 10000 });
    await page.locator('.ograph-stage-map', { hasText: 'Create' }).waitFor({ timeout: 10000 });
    await page.locator('.ograph-stage-node.manim', { hasText: 'Manim Source' }).waitFor({ timeout: 10000 });
    mark('manim draft saved to ograph');
    await page.locator('.ograph-readiness .mini-action', { hasText: 'Open in Manim Lab' }).click();
    try {
        await page.getByText(/Loaded .* from Ograph:/).waitFor({ timeout: 10000 });
    } catch (err) {
        const bodyText = await page.locator('body').innerText().catch(() => '');
        throw new Error(`Manim source did not reopen from Ograph. Body: ${bodyText.slice(0, 1000)}`);
    }
    mark('manim draft reopened from ograph');
    await page.getByRole('tab', { name: 'Ograph' }).click();
    await page.locator('#ograph-select').selectOption({ label: 'Smoke Test Ograph' });
    await page.locator('.ograph-card-head strong', { hasText: 'Smoke Test Ograph' }).waitFor({ timeout: 10000 });
    mark('smoke ograph selected');
    await page.locator('.ograph-readiness', { hasText: 'Ready for timeline' }).waitFor({ timeout: 10000 });
    await page.locator('.ograph-readiness .mini-action', { hasText: 'Add at Playhead' }).waitFor({ timeout: 10000 });
    await page.locator('.ograph-stage-map', { hasText: 'Timeline' }).waitFor({ timeout: 10000 });
    await page.locator('.ograph-stage-node.generation', { hasText: 'Generated HTML' }).click();
    mark('smoke generation node selected');
    await page.locator('.ograph-action-grid .mini-action', { hasText: 'Use as Manim brief' }).click();
    await page.getByText('Loaded brief from Ograph: Smoke Test Ograph').waitFor({ timeout: 10000 });
    await page.locator('#manim-idea').evaluate(node => {
        if (!node.value.includes('Smoke Test Ograph')) throw new Error('Ograph brief did not populate Manim idea.');
        if (!node.value.includes('Generated HTML')) throw new Error('Ograph brief omitted selected graph node context.');
    });
    mark('ograph brief opened in manim');
    await page.getByRole('tab', { name: 'Ograph' }).click();
    await page.locator('#ograph-select').selectOption({ label: 'Smoke Test Ograph' });
    await page.locator('.ograph-stage-node.generation', { hasText: 'Generated HTML' }).click();
    await page.locator('.ograph-action-grid .mini-action', { hasText: 'Cinematic' }).click();
    mark('smoke cinematic clicked');
    await page.waitForTimeout(250);
    const actionCountAfterClick = await page.locator('.ograph-node.action').count();
    const ographErrorAfterClick = await page.locator('.ograph-error').textContent().catch(() => '');
    const smokeEventsAfterClick = await page.evaluate(() => window.__smokeEvents || []);
    mark(`smoke cinematic state action=${actionCountAfterClick} error=${ographErrorAfterClick || 'none'} events=${JSON.stringify(smokeEventsAfterClick)}`);
    await page.locator('.ograph-node.action', { hasText: 'Cinematic' }).waitFor({ timeout: 10000 });
    mark('smoke cinematic action created');
    await page.locator('.ograph-action-grid .mini-action', { hasText: 'Render graph' }).click();
    await page.locator('.ograph-node.render', { hasText: 'SmokeGraph.mov' }).waitFor({ timeout: 10000 });
    await page.locator('.ograph-stage-node.render', { hasText: 'SmokeGraph.mov' }).waitFor({ timeout: 10000 });
    mark('smoke graph rendered');
    await page.locator('.ograph-action-grid .mini-action', { hasText: 'Add at Playhead' }).click();
    const ographCanvasCount = await page.locator('.ograph-canvas').count();
    mark('ograph render workflow complete');
    await page.getByRole('button', { name: 'Produce' }).click();
    await page.getByRole('tab', { name: 'Manim Lab' }).click();
    await page.getByText('Render Manim MP4').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Use latest AI source' }).click();
    await page.locator('.manim-source').evaluate(node => {
        if (!node.value.includes('ResolveAIManimScene')) throw new Error('Latest AI source did not populate Manim source.');
        if (!node.value.includes('Square')) throw new Error('Latest AI Manim source did not populate.');
    });
    await page.getByRole('button', { name: 'Render Manim MP4' }).click();
    await page.getByRole('button', { name: 'Add at Playhead' }).waitFor({ timeout: 10000 });
    const manimPanelCount = await page.locator('.manim-source-panel').count();
    mark('manim rendered');
    await page.getByRole('button', { name: 'Save render to Ograph' }).click();
    await page.locator('.ograph-card-head strong', { hasText: 'Manim Smoke Graph' }).waitFor({ timeout: 10000 });
    await page.locator('.ograph-source', { hasText: 'Manim Lab' }).waitFor({ timeout: 10000 });
    await page.locator('.ograph-stage-node.manim', { hasText: 'Manim Source' }).waitFor({ timeout: 10000 });
    await page.locator('.ograph-stage-node.render', { hasText: 'Manim Render' }).waitFor({ timeout: 10000 });
    mark('manim render saved to ograph');
    if (await page.locator('.ograph-action-grid .mini-action', { hasText: 'Render graph' }).count()) {
        throw new Error('Manim Ograph should not expose HTML Render graph action.');
    }
    await page.locator('.ograph-section').waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: 'Open in Manim Lab' }).click();
    await page.getByText('Loaded source from Ograph: Manim Smoke Graph').waitFor({ timeout: 10000 });
    await page.locator('.manim-source').evaluate(node => {
        if (!node.value.includes('ResolveAIManimScene')) throw new Error('Ograph source did not reopen in Manim Lab.');
        if (!node.value.includes('Square')) throw new Error('Ograph Manim source content was not preserved.');
    });
    mark('manim render reopened from ograph');
    await page.locator('.workspace-rail').getByRole('button', { name: 'Open settings' }).click();
    await page.getByRole('button', { name: /Diagnostics/ }).click();
    await page.getByRole('button', { name: 'Run runtime QA' }).click();
    await page.getByText('Workspace shell').waitFor({ timeout: 10000 });
    mark('runtime qa passed');

    const checks = {
        workspaceShell: await page.locator('.workspace-shell').count(),
        rail: await page.locator('.workspace-rail').count(),
        inspector: await page.locator('.workspace-inspector').count(),
        ographCanvas: ographCanvasCount,
        manimPanel: manimPanelCount
    };
    for (const [name, count] of Object.entries(checks)) {
        if (!count) throw new Error(`Missing visual smoke selector: ${name}`);
    }

    await page.screenshot({ path: path.join(outDir, 'workspace-ograph-manim.png'), fullPage: true });
    await browser.close();
    server.close();
    console.log('visual smoke workspace checks passed');
    console.log(path.join(outDir, 'workspace-ograph-manim.png'));
    mark('done');
}

main().catch(err => {
    console.error(err?.stack || err?.message || String(err));
    process.exit(1);
});
