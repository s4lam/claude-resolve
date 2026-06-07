import React, { useState, useRef, useEffect, useMemo } from 'react';
import Chat from './Chat';
import ChatInput from './ChatInput';
import Sidebar from './Sidebar';
import WelcomeScreen from './WelcomeScreen';
import PromptPresets from './PromptPresets';
import WindowChrome from './WindowChrome';
import WorkspaceShell from './WorkspaceShell';

function tryParseStandardHTML(text) {
    const matches = [...String(text || '').matchAll(/```html\s*\n(?:(?:\/\/|<!--)\s*FILE:\s*(\S+\.html)(?:\s*-->)?\s*\n)?([\s\S]*?)```/g)];
    const parsedBlocks = matches.map((htmlMatch, index) => {
        const html = htmlMatch[2].trim();
        if (!html.includes('getAnimationDuration')) return null;
        const hasFrame = html.includes('renderFrame');
        const hasReact = html.includes('ReactDOM.createRoot');
        if (!hasFrame && !hasReact) return null;
        return {
            type: 'html',
            name: htmlMatch[1]?.replace('.html', '') || `Variation${index + 1}`,
            html,
            mode: hasFrame ? 'frame' : 'realtime'
        };
    }).filter(Boolean);
    if (parsedBlocks.length > 1) {
        return { type: 'variations', name: `${parsedBlocks.length} Variations`, items: parsedBlocks };
    }
    if (parsedBlocks.length === 1) return parsedBlocks[0];

    const htmlMatch = text.match(/```html\s*\n(?:(?:\/\/|<!--)\s*FILE:\s*(\S+\.html)(?:\s*-->)?\s*\n)?([\s\S]*?)```/);
    if (!htmlMatch) return null;
    const html = htmlMatch[2].trim();
    if (!html.includes('getAnimationDuration')) return null;
    const hasFrame = html.includes('renderFrame');
    const hasReact = html.includes('ReactDOM.createRoot');
    if (!hasFrame && !hasReact) return null;
    const mode = hasFrame ? 'frame' : 'realtime';
    const name = htmlMatch[1]?.replace('.html', '') || 'Overlay';
    return { type: 'html', name, html, mode };
}

function compactTitle(text, fallback = 'Untitled session') {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (!value) return fallback;
    return value.length > 72 ? value.slice(0, 71) + '…' : value;
}

function titleFromMessages(messages = [], fallback = 'Untitled session') {
    const firstUser = messages.find(message => message?.type === 'user' && message.text);
    return compactTitle(firstUser?.text, fallback);
}

function latestHtmlContext(messages = []) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        const parsed = messages[i]?.parsed;
        if (!parsed) continue;
        const item = Array.isArray(parsed.items) ? parsed.items[0] : parsed;
        if (item?.html) {
            return {
                name: item.name || 'Overlay',
                previousName: item.name || 'Overlay',
                previousPrompt: message?.prompt || '',
                html: item.html
            };
        }
    }
    return null;
}

function latestAssistantTextContext(messages = []) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message?.type === 'assistant' && !message.isThinking && message.text) {
            return message.text;
        }
    }
    return '';
}

function buildSessionContinuationPrompt(promptText, session, messages = []) {
    const recentTurns = messages
        .filter(message => !message.isThinking && message.text)
        .slice(-8)
        .map(message => `${message.type === 'assistant' ? 'Assistant' : 'User'}: ${String(message.text).slice(0, 900)}`)
        .join('\n\n');
    const latestHtml = latestHtmlContext(messages);
    if (!recentTurns && !latestHtml) return promptText;

    return [
        'Continue this saved Resolve AI session. Use the local session history below as context, but answer only the new user request.',
        `Session: ${session?.title || 'Untitled session'}`,
        session?.projectName ? `Project: ${session.projectName}` : '',
        session?.timelineName ? `Timeline: ${session.timelineName}` : '',
        '',
        recentTurns ? 'Recent visible chat:' : '',
        recentTurns,
        '',
        latestHtml ? `Latest generated HTML (${latestHtml.name}):` : '',
        latestHtml ? '```html' : '',
        latestHtml ? latestHtml.html : '',
        latestHtml ? '```' : '',
        '',
        'New user request:',
        promptText
    ].filter(Boolean).join('\n');
}

export default function App() {
    const [authInfo, setAuthInfo] = useState({ status: 'checking', provider: 'auto', label: 'AI provider' });
    const [welcomed, setWelcomed] = useState(true);
    const [sidebar, setSidebar] = useState({ open: false, view: 'tools' });
    const [config, setConfig] = useState({
        provider: 'auto',
        model: 'sonnet',
        effort: 'auto',
        codexModel: 'default',
        fps: 25,
        width: 1920,
        height: 1080,
        brandKit: {},
        selectedAssetIds: [],
        generation: { variationCount: 3, locks: {} },
        captions: {
            defaultStyle: 'clean',
            defaultOutputMode: 'overlay',
            defaultRegroupMode: 'punchy',
            nativeTemplateName: 'Resolve AI Caption',
            verticalSafe: true
        },
        transcription: { provider: 'none', commandPath: '', model: 'base', language: '' },
        analysis: { enabled: true, includeTranscription: true, includeAudioHints: true, publishMarkers: false },
        resolve: { safetySnapshots: true },
        assets: { maxImportSizeMb: 25 },
        render: {
            renderPreset: 'prores_mov',
            outputFormat: 'prores',
            proresProfile: '4444',
            threads: 'auto',
            createProxy: false,
            proxyEncoder: 'auto',
            proxyQuality: 'balanced',
            ffmpegPath: ''
        },
        ui: { activeToolTab: 'create', activeWorkspaceMode: 'create' },
        gallery: { favorites: [], recentIds: [] }
    });
    const [messages, setMessages] = useState([]);
    const [sessions, setSessions] = useState([]);
    const [activeSession, setActiveSession] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [activeTool, setActiveTool] = useState(null);
    const [activeProvider, setActiveProvider] = useState(null);
    const [tokenCount, setTokenCount] = useState(0);
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [draftPrompt, setDraftPrompt] = useState({ text: '', revision: 0 });
    const [manimSourceDraft, setManimSourceDraft] = useState(null);
    const nextId = useRef(0);
    const nextDraftRevision = useRef(1);
    const messagesRef = useRef([]);
    const activeSessionRef = useRef(null);
    const suppressNextSessionSave = useRef(false);
    const sessionSaveTimer = useRef(null);
    const restoredSessionNeedsContext = useRef(false);

    useEffect(() => {
        function appendToLast(data) {
            setMessages(prev => {
                const last = prev[prev.length - 1];
                if (!last || last.type !== 'assistant') return prev;
                const updated = [...prev];
                const msg = { ...last };
                if (msg.isThinking) {
                    msg.isThinking = false;
                    msg.text = '';
                }
                msg.text += data;
                updated[updated.length - 1] = msg;
                return updated;
            });
        }

        const agentAPI = window.agentAPI || window.claudeAPI;

        agentAPI.onOutput((data) => {
            setActiveTool(null);
            appendToLast(data);
        });
        agentAPI.onError(appendToLast);

        agentAPI.onStatus((data) => {
            if (data.type === 'tool') {
                setActiveTool({ name: data.name, file: data.file });
            } else if (data.type === 'tokens') {
                setTokenCount(data.output);
            } else if (data.type === 'provider') {
                setActiveProvider(data.provider);
            }
        });

        agentAPI.onDone((code) => {
            setMessages(prev => {
                const last = prev[prev.length - 1];
                if (!last || last.type !== 'assistant') return prev;
                const updated = [...prev];
                const msg = { ...last };
                if (msg.isThinking) {
                    msg.isThinking = false;
                    msg.text = code === 2 ? '(Stopped)' : '(No response)';
                } else if (code === 2) {
                    msg.text += '\n(Stopped)';
                }
                if (code === 1) msg.isError = true;
                if (code === 0) msg.parsed = tryParseStandardHTML(msg.text);
                updated[updated.length - 1] = msg;
                return updated;
            });
            setActiveTool(null);
            setIsProcessing(false);
        });

        window.overlayAPI.syncToMediaPool().catch(() => {});
        window.configAPI.get().then(async (nextConfig) => {
            let seededConfig = nextConfig;
            try {
                const timeline = await window.resolveAPI.getTimelineSettings();
                const timelinePatch = {};
                if (timeline?.fps) timelinePatch.fps = timeline.fps;
                if (timeline?.width && timeline?.height) {
                    timelinePatch.width = timeline.width;
                    timelinePatch.height = timeline.height;
                }
                if (Object.keys(timelinePatch).length > 0) {
                    seededConfig = await window.configAPI.set(timelinePatch);
                }
            } catch { /* timeline settings are best-effort */ }
            setConfig(seededConfig);
            initializeSession(seededConfig).catch(() => {});
            return agentAPI.checkAuth();
        }).then(setAuthInfo);

        window.updatesAPI.check()
            .then(r => setUpdateAvailable(!!(r && r.hasUpdate)))
            .catch(() => {});

        function handleUnload() {
            saveCurrentSession().catch(() => {});
            window.resolveAPI.cleanup();
        }
        window.addEventListener('beforeunload', handleUnload);
        return () => window.removeEventListener('beforeunload', handleUnload);
    }, []);

    useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

    useEffect(() => {
        function handleOpenManimSource(event) {
            const detail = event.detail || {};
            const source = String(detail.source || '').trim();
            if (!source) return;
            setManimSourceDraft({
                source,
                idea: detail.idea || 'Assistant Manim source',
                title: detail.title || 'Assistant Manim Source',
                origin: detail.origin || 'chat',
                graphId: detail.graphId || '',
                revision: Date.now()
            });
            setSidebar({ open: true, view: 'tools' });
            resizeForSidebar(true);
            setConfig(prev => ({
                ...prev,
                ui: {
                    ...(prev.ui || {}),
                    activeWorkspaceMode: 'create',
                    activeToolTab: 'manim'
                }
            }));
            window.configAPI?.set?.({ ui: { activeWorkspaceMode: 'create', activeToolTab: 'manim' } })
                .then(updated => { if (updated) setConfig(updated); })
                .catch(() => {});
        }
        window.addEventListener('resolve-ai:open-manim-source', handleOpenManimSource);
        return () => window.removeEventListener('resolve-ai:open-manim-source', handleOpenManimSource);
    }, []);

    useEffect(() => {
        function handleOpenOgraph(event) {
            const detail = event.detail || {};
            const graphId = String(detail.graphId || '').trim();
            setSidebar({ open: true, view: 'tools' });
            resizeForSidebar(true);
            setConfig(prev => ({
                ...prev,
                ui: {
                    ...(prev.ui || {}),
                    activeWorkspaceMode: 'create',
                    activeToolTab: 'ograph',
                    focusOgraphId: graphId
                }
            }));
            window.configAPI?.set?.({ ui: { activeWorkspaceMode: 'create', activeToolTab: 'ograph', focusOgraphId: graphId } })
                .then(updated => { if (updated) setConfig(updated); })
                .catch(() => {});
        }
        window.addEventListener('resolve-ai:open-ograph', handleOpenOgraph);
        return () => window.removeEventListener('resolve-ai:open-ograph', handleOpenOgraph);
    }, []);

    useEffect(() => {
        activeSessionRef.current = activeSession;
    }, [activeSession]);

    useEffect(() => {
        if (!activeSession?.id || !window.sessionsAPI) return undefined;
        if (suppressNextSessionSave.current) {
            suppressNextSessionSave.current = false;
            return undefined;
        }
        clearTimeout(sessionSaveTimer.current);
        sessionSaveTimer.current = setTimeout(() => {
            saveCurrentSession().catch(() => {});
        }, 450);
        return () => clearTimeout(sessionSaveTimer.current);
    }, [
        messages,
        activeSession?.id,
        config.provider,
        config.model,
        config.codexModel,
        config.width,
        config.height,
        config.fps,
        config.selectedAssetIds,
        activeProvider
    ]);

    async function readTimelineContext() {
        try {
            if (window.timelineAPI?.getContext) return await window.timelineAPI.getContext();
        } catch { /* timeline context is best-effort */ }
        try {
            const [projectName, timelineName, settings] = await Promise.all([
                window.resolveAPI.getProjectName(),
                window.resolveAPI.getCurrentTimeline(),
                window.resolveAPI.getTimelineSettings()
            ]);
            return {
                projectName,
                timelineName,
                fps: settings?.fps,
                width: settings?.width,
                height: settings?.height
            };
        } catch {
            return {};
        }
    }

    function makeSessionPayload(context = {}, cfg = config, current = null, sessionMessages = messagesRef.current) {
        const contextTitle = [current?.projectName || context.projectName, current?.timelineName || context.timelineName || context.name]
            .filter(Boolean)
            .join(' / ') || 'Untitled session';
        const shouldDeriveTitle = sessionMessages.length > 0 && (
            !current?.title ||
            current.title === contextTitle ||
            current.title === 'Untitled session'
        );
        const authProvider = ['claude', 'codex'].includes(authInfo.provider) ? authInfo.provider : null;
        const provider = activeProvider || authProvider || cfg.provider;
        return {
            title: shouldDeriveTitle ? titleFromMessages(sessionMessages, contextTitle) : (current?.title || contextTitle),
            projectName: current?.projectName || context.projectName || null,
            timelineName: current?.timelineName || context.timelineName || context.name || null,
            page: current?.page || context.page || null,
            provider,
            model: provider === 'codex' ? cfg.codexModel : cfg.model,
            width: cfg.width || context.width || null,
            height: cfg.height || context.height || null,
            fps: cfg.fps || context.fps || null,
            selectedAssetIds: cfg.selectedAssetIds || [],
            messages: sessionMessages
        };
    }

    async function refreshSessions() {
        if (!window.sessionsAPI) return [];
        const list = await window.sessionsAPI.list();
        setSessions(list);
        return list;
    }

    async function hydrateSession(session, options = {}) {
        const safeMessages = Array.isArray(session?.messages) ? session.messages : [];
        suppressNextSessionSave.current = true;
        activeSessionRef.current = session;
        setActiveSession(session);
        setMessages(safeMessages);
        setWelcomed(safeMessages.length === 0);
        setIsProcessing(false);
        setActiveTool(null);
        setActiveProvider(null);
        nextId.current = safeMessages.reduce((max, message) => Math.max(max, Number(message.id) || 0), 0) + 1;
        restoredSessionNeedsContext.current = Boolean(options.needsContext && safeMessages.length > 0);
        if (options.restartAgent) {
            (window.agentAPI || window.claudeAPI).restart();
        }
        await window.sessionsAPI?.setActive?.(session.id);
        await refreshSessions();
    }

    async function initializeSession(seededConfig) {
        if (!window.sessionsAPI) return;
        const context = await readTimelineContext();
        const list = await refreshSessions();
        const match = list.find(item => (
            context.projectName &&
            item.projectName === context.projectName &&
            (!context.timelineName || item.timelineName === context.timelineName)
        ));
        if (match) {
            const session = await window.sessionsAPI.get(match.id);
            if (session) {
                await hydrateSession(session, { needsContext: true, restartAgent: false });
                return;
            }
        }
        const active = await window.sessionsAPI.getActive?.();
        if (active && (!context.projectName || active.projectName === context.projectName)) {
            await hydrateSession(active, { needsContext: true, restartAgent: false });
            return;
        }
        const created = await window.sessionsAPI.create(makeSessionPayload(context, seededConfig, null, []));
        await hydrateSession(created, { needsContext: false, restartAgent: false });
    }

    async function saveCurrentSession(overrideMessages = messagesRef.current) {
        const current = activeSessionRef.current;
        if (!current?.id || !window.sessionsAPI) return null;
        const patch = makeSessionPayload(current, config, current, overrideMessages);
        const updated = await window.sessionsAPI.update(current.id, patch);
        if (updated) {
            activeSessionRef.current = updated;
            setActiveSession(updated);
            await refreshSessions();
        }
        return updated;
    }

    async function handleNewSession() {
        await saveCurrentSession();
        const context = await readTimelineContext();
        const created = await window.sessionsAPI.create(makeSessionPayload(context, config, null, []));
        await hydrateSession(created, { needsContext: false, restartAgent: true });
    }

    async function handleOpenSession(id) {
        if (!id || id === activeSessionRef.current?.id) return;
        await saveCurrentSession();
        const session = await window.sessionsAPI.get(id);
        if (session) await hydrateSession(session, { needsContext: true, restartAgent: true });
    }

    async function handleRenameSession(id, title) {
        const updated = await window.sessionsAPI.update(id, { title: compactTitle(title) });
        if (updated?.id === activeSessionRef.current?.id) {
            activeSessionRef.current = updated;
            setActiveSession(updated);
        }
        await refreshSessions();
    }

    async function handleDeleteSession(id) {
        const result = await window.sessionsAPI.delete(id);
        if (id === activeSessionRef.current?.id) {
            const list = await refreshSessions();
            const next = list.find(item => item.id === result.activeId) || list[0];
            if (next) {
                const session = await window.sessionsAPI.get(next.id);
                await hydrateSession(session, { needsContext: true, restartAgent: true });
            } else {
                await handleNewSession();
            }
            return;
        }
        await refreshSessions();
    }

    function handleSend(text, options = {}) {
        const promptText = String(text || '').trim();
        if (!promptText || isProcessing) return false;
        const displayText = options.displayText || promptText;
        const agentPrompt = options.skipSessionContext || !restoredSessionNeedsContext.current
            ? promptText
            : buildSessionContinuationPrompt(promptText, activeSessionRef.current, messagesRef.current);
        restoredSessionNeedsContext.current = false;
        setWelcomed(false);
        const userId = nextId.current++;
        const assistantId = nextId.current++;
        setMessages(prev => [
            ...prev,
            { id: userId, type: 'user', text: displayText },
            {
                id: assistantId,
                type: 'assistant',
                text: 'Thinking...',
                prompt: options.originalPrompt || promptText,
                isThinking: true,
                isError: false,
                parsed: null
            }
        ]);
        setIsProcessing(true);
        setActiveTool(null);
        setActiveProvider(null);
        setTokenCount(0);
        (window.agentAPI || window.claudeAPI).sendPrompt(agentPrompt);
        return true;
    }

    function handleDraftPrompt(text) {
        const promptText = String(text || '').trim();
        if (!promptText || isProcessing) return false;
        setWelcomed(false);
        setDraftPrompt({
            text: promptText,
            revision: nextDraftRevision.current++
        });
        return true;
    }

    function handleRegenerate(message, variation) {
        if (!message?.parsed?.html) return;
        const originalPrompt = message.prompt || 'Previous Resolve AI generation';
        const variationInstructions = {
            'More cinematic': 'Make the motion, staging, and visual drama more cinematic. Keep the same overall request and output contract.',
            Simpler: 'Simplify the design and motion while keeping the same core idea, dimensions, duration, and readability.',
            'Transparent BG': 'Make ONLY the background transparent/alpha. Keep the same 1920x1080 canvas, same composition scale, same layout, same timing, and same subject size. Do not shrink, crop, center inside a smaller panel, or add any opaque rectangle behind the design. Set html/body/stage backgrounds to transparent and keep visible text/line/art elements full-size.',
            Longer: 'Extend the animation duration while preserving the same visual style and final composition.',
            'Same style': 'Create a fresh variation in the same style, palette, composition scale, and motion language.',
            '3 variations': 'Create exactly three distinct complete HTML alternatives. Each alternative must be in its own fenced ```html block with a different FILE name. Keep the same request, dimensions, output contract, selected assets, and render safety rules.'
        };
        const prompt = [
            'Regenerate the previous Resolve AI overlay.',
            `Variation: ${variation}`,
            `Instruction: ${variationInstructions[variation] || variation}`,
            '',
            `Original request: ${originalPrompt}`,
            '',
            'Previous generated HTML:',
            '```html',
            message.parsed.html,
            '```',
            '',
            variation === '3 variations'
                ? 'Return exactly three complete replacement HTML files in three separate ```html fenced blocks. Preserve the overlay contract in every file.'
                : 'Return one complete replacement HTML file. Preserve the overlay contract.'
        ].join('\n');
        handleSend(prompt, {
            displayText: `Regenerate: ${variation}`,
            originalPrompt,
            skipSessionContext: true
        });
    }

    function sendAgentPrompt(promptText, displayText, originalPrompt, extra = {}) {
        setWelcomed(false);
        const userId = nextId.current++;
        const assistantId = nextId.current++;
        setMessages(prev => [
            ...prev,
            { id: userId, type: 'user', text: displayText || promptText },
            {
                id: assistantId,
                type: 'assistant',
                text: 'Thinking...',
                prompt: originalPrompt || promptText,
                isThinking: true,
                isError: false,
                parsed: null,
                ...extra
            }
        ]);
        setIsProcessing(true);
        setActiveTool(null);
        setActiveProvider(null);
        setTokenCount(0);
    }

    function handleRepair(message, repairInfo) {
        if (!message?.parsed?.html || isProcessing) return;
        const repairCount = Number(message.repairCount || 0) + 1;
        if (repairCount > 2) return;
        setMessages(prev => prev.map(item => (
            item.id === message.id ? { ...item, repairCount } : item
        )));
        sendAgentPrompt('Fix render error', 'Fix render error', message.prompt, { repairCount });
        (window.agentAPI || window.claudeAPI).repairRender({
            originalPrompt: message.prompt,
            html: message.parsed.html,
            error: repairInfo?.error,
            validationWarnings: repairInfo?.validationWarnings || [],
            repairCount: repairCount - 1
        }).catch(err => {
            setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (!last || last.type !== 'assistant') return prev;
                updated[updated.length - 1] = {
                    ...last,
                    isThinking: false,
                    isError: true,
                    text: err?.message || 'Repair failed'
                };
                return updated;
            });
            setIsProcessing(false);
        });
    }

    function handleStop() {
        (window.agentAPI || window.claudeAPI).abort();
    }

    async function handleConfigChange(partial) {
        const updated = await window.configAPI.set(partial);
        const modelChanged = partial.model && partial.model !== config.model;
        const effortChanged = partial.effort && partial.effort !== config.effort;
        const codexModelChanged = partial.codexModel && partial.codexModel !== config.codexModel;
        const providerChanged = partial.provider && partial.provider !== config.provider;
        setConfig(updated);
        if (providerChanged) {
            setAuthInfo({ status: 'checking', provider: updated.provider || 'auto', label: 'AI provider' });
            (window.agentAPI || window.claudeAPI).checkAuth().then(setAuthInfo);
        }
        if ((modelChanged || effortChanged || codexModelChanged || providerChanged) && !welcomed) {
            setIsProcessing(false);
            setActiveTool(null);
            setActiveProvider(null);
            restoredSessionNeedsContext.current = messagesRef.current.length > 0;
            (window.agentAPI || window.claudeAPI).restart();
        }
    }

    function resizeForSidebar(open) {
        const windowApi = window.windowAPI;
        if (!windowApi?.resize) return;
        const stateRequest = windowApi.getState ? windowApi.getState() : Promise.resolve(null);
        Promise.resolve(stateRequest).then(state => {
            if (state?.maximized || state?.fullScreen) return;
            windowApi.resize({ width: open ? 900 : 500, height: 740 }).catch(() => {});
        }).catch(() => {
            windowApi.resize({ width: open ? 900 : 500, height: 740 }).catch(() => {});
        });
    }

    function showSidebarView(view) {
        setSidebar({ open: true, view });
        resizeForSidebar(true);
    }

    function closeSidebar() {
        setSidebar(prev => ({ ...prev, open: false }));
        resizeForSidebar(false);
    }

    function handleSettingsToggle() {
        if (!sidebar.open) {
            showSidebarView('settings');
        } else if (sidebar.view === 'settings') {
            closeSidebar();
        } else {
            showSidebarView('settings');
        }
    }

    function handleToolsToggle() {
        if (!sidebar.open) {
            showSidebarView('tools');
        } else if (sidebar.view === 'tools') {
            closeSidebar();
        } else {
            showSidebarView('tools');
        }
    }

    function handleWorkspaceModeChange(mode) {
        handleConfigChange({ ui: { activeWorkspaceMode: mode } });
        if (!sidebar.open || sidebar.view !== 'tools') {
            showSidebarView('tools');
        }
    }

    function handleOpenWorkspaceTool(mode, tool) {
        handleConfigChange({ ui: { activeWorkspaceMode: mode, activeToolTab: tool } });
        showSidebarView('tools');
    }

    const showWelcome = authInfo.status !== 'ready' || welcomed;
    const sidebarOpen = sidebar.open;
    const workspaceMode = config.ui?.activeWorkspaceMode || 'create';
    const chromeProvider = activeProvider || authInfo.provider || config.provider;
    const chromeModel = chromeProvider === 'codex' ? config.codexModel : config.model;
    const latestGeneration = useMemo(() => latestHtmlContext(messages), [messages]);
    const latestAssistantText = useMemo(() => latestAssistantTextContext(messages), [messages]);
    const sidePanel = sidebarOpen ? (
        <Sidebar
            view={sidebar.view}
            workspaceMode={workspaceMode}
            config={config}
            onConfigChange={handleConfigChange}
            onPrompt={handleSend}
            onUsePrompt={handleDraftPrompt}
            onShowTools={() => showSidebarView('tools')}
            onClose={closeSidebar}
            sessions={sessions}
            activeSession={activeSession}
            onNewSession={handleNewSession}
            onOpenSession={handleOpenSession}
            onRenameSession={handleRenameSession}
            onDeleteSession={handleDeleteSession}
            latestGeneration={latestGeneration}
            latestAssistantText={latestAssistantText}
            sourceDraft={manimSourceDraft}
        />
    ) : null;
    const mainPanel = showWelcome ? (
        <WelcomeScreen
            authInfo={authInfo}
            config={config}
            onAuthStateChange={setAuthInfo}
            onStart={() => setAuthInfo(prev => ({ ...prev, status: 'ready' }))}
            onPrompt={handleSend}
            onDismiss={() => setWelcomed(false)}
        />
    ) : (
        <Chat
            messages={messages}
            activeTool={activeTool}
            tokenCount={tokenCount}
            model={activeProvider === 'codex' ? config.codexModel : config.model}
            provider={activeProvider || authInfo.provider || config.provider}
            config={config}
            onRegenerate={handleRegenerate}
            onRepair={handleRepair}
        />
    );
    const presetPanel = !showWelcome ? (
        <PromptPresets
            onPrompt={handleDraftPrompt}
            disabled={isProcessing}
            hasSelectedAssets={(config.selectedAssetIds || []).length > 0}
        />
    ) : null;
    const composer = (
        <ChatInput
            onSend={handleSend}
            onStop={handleStop}
            draftPrompt={draftPrompt}
            isProcessing={isProcessing}
            sidebarOpen={sidebarOpen}
            sidebarView={sidebar.view}
            onToggleSidebar={handleSettingsToggle}
            onToggleTools={handleToolsToggle}
            updateAvailable={updateAvailable}
        />
    );

    return (
        <>
            <WindowChrome
                authInfo={authInfo}
                provider={chromeProvider}
                model={chromeModel}
            />
            <WorkspaceShell
                workspaceMode={workspaceMode}
                onWorkspaceModeChange={handleWorkspaceModeChange}
                sidebarOpen={sidebarOpen}
                sidebarView={sidebar.view}
                onOpenTools={handleToolsToggle}
                onOpenSettings={() => showSidebarView('settings')}
                updateAvailable={updateAvailable}
                sidePanel={sidePanel}
                main={mainPanel}
                presets={presetPanel}
                composer={composer}
                inspectorProps={{
                    config,
                    activeSession,
                    messages,
                    latestGeneration,
                    onOpenTool: handleOpenWorkspaceTool
                }}
            />
        </>
    );
}
