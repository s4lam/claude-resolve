import React, { useEffect, useMemo, useState } from 'react';

const ACTIONS = [
    {
        id: 'improve',
        label: 'Improve',
        types: ['prompt', 'session', 'asset', 'generation', 'action', 'manim'],
        instruction: 'Improve the selected workflow node while preserving the graph intent.'
    },
    {
        id: 'more cinematic',
        label: 'Cinematic',
        types: ['prompt', 'session', 'asset', 'generation', 'action', 'manim'],
        instruction: 'Make the result feel more cinematic without changing the core message.'
    },
    {
        id: 'make transparent background',
        label: 'Transparent',
        types: ['generation', 'validation', 'render', 'action'],
        instruction: 'Convert the overlay to a true transparent-background render-safe version.'
    },
    {
        id: 'simplify layout',
        label: 'Simplify',
        types: ['prompt', 'generation', 'validation', 'action', 'manim'],
        instruction: 'Simplify the composition and reduce visual clutter.'
    },
    {
        id: 'fix render',
        label: 'Fix',
        types: ['validation', 'render', 'manim'],
        instruction: 'Diagnose the selected failure or warning and return a corrected generation.'
    },
    {
        id: 'prepare for render',
        label: 'Render prep',
        types: ['generation', 'validation', 'render', 'manim'],
        instruction: 'Prepare the selected output for a reliable render with correct dimensions, duration, and codec constraints.'
    },
    {
        id: 'rerender',
        label: 'Re-render',
        types: ['render'],
        instruction: 'Prepare a re-render plan for the same visual output and include preset/output details.'
    },
    {
        id: 'readd timeline',
        label: 'Timeline add',
        types: ['timeline', 'render'],
        instruction: 'Prepare steps to add or re-add this output to the current Resolve timeline safely.'
    },
    {
        id: 'diagnostics',
        label: 'Diagnostics',
        types: ['validation', 'render', 'timeline', 'manim'],
        instruction: 'Summarize likely issues and the concrete checks needed before retrying.'
    }
];

const STAGES = [
    { id: 'brief', label: 'Brief', types: ['prompt', 'session'] },
    { id: 'inputs', label: 'Inputs', types: ['asset'] },
    { id: 'create', label: 'Create', types: ['generation', 'manim'] },
    { id: 'check', label: 'Check', types: ['validation'] },
    { id: 'render', label: 'Render', types: ['render'] },
    { id: 'timeline', label: 'Timeline', types: ['timeline'] },
    { id: 'actions', label: 'Actions', types: ['action'] }
];

function actionsForNode(node) {
    if (!node) return ACTIONS.slice(0, 4);
    return ACTIONS.filter(action => action.types.includes(node.type || 'generation'));
}

function nodeClass(node, selected) {
    return `ograph-node ${node.type || 'generation'} ${node.status || 'ready'}${selected ? ' selected' : ''}`;
}

function graphStats(graph) {
    const nodes = graph?.nodes || [];
    return {
        total: nodes.length,
        done: nodes.filter(node => node.status === 'done').length,
        warn: nodes.filter(node => node.status === 'warning' || node.status === 'failed').length,
        pending: nodes.filter(node => node.status === 'pending' || node.status === 'ready').length
    };
}

function graphStageMap(graph) {
    const nodes = graph?.nodes || [];
    return STAGES.map(stage => ({
        ...stage,
        nodes: nodes.filter(node => stage.types.includes(node.type || 'generation'))
    }));
}

function graphReadiness(graph) {
    const nodes = graph?.nodes || [];
    const first = (type, predicate = () => true) => nodes.find(node => node.type === type && predicate(node));
    const prompt = first('prompt');
    const generation = first('generation');
    const html = first('generation', node => Boolean(node.data?.html));
    const manim = first('manim', node => Boolean(node.data?.source));
    const render = first('render', node => Boolean(node.data?.render?.name || node.data?.outputName));
    const timeline = first('timeline');
    const reviewNode = nodes.find(node => node.status === 'failed' || node.status === 'warning');
    const missing = [];

    if (!prompt && !graph?.prompt) missing.push('prompt');
    if (generation && !html && !manim) missing.push('generated output');
    if ((html || manim) && !render) missing.push('render');
    if (render && !timeline) missing.push('timeline add');

    let score = 0;
    if (prompt || graph?.prompt) score += 20;
    if (html || manim) score += 25;
    if (!reviewNode) score += 15;
    if (render) score += 25;
    if (timeline) score += 15;
    score = Math.max(0, Math.min(100, score));

    if (reviewNode) {
        return {
            score,
            state: 'needs-review',
            label: 'Needs review',
            detail: `${reviewNode.label} needs attention before this graph is reliable.`,
            missing,
            next: { label: 'Fix selected issue', action: 'fix', nodeId: reviewNode.id }
        };
    }
    if (manim && !render) {
        return {
            score,
            state: 'ready-manim',
            label: 'Manim source ready',
            detail: 'Open the source in Motion Diagram to validate and render it.',
            missing,
            next: { label: 'Open in Motion Diagram', action: 'manim', nodeId: manim.id }
        };
    }
    if (html && !render) {
        return {
            score,
            state: 'ready-render',
            label: 'Ready to render',
            detail: 'Generated HTML is captured and can render from this graph.',
            missing,
            next: { label: 'Render graph', action: 'render', nodeId: html.id }
        };
    }
    if (render && !timeline) {
        return {
            score,
            state: 'ready-timeline',
            label: 'Ready for timeline',
            detail: 'A render is linked. Add it at the current playhead when ready.',
            missing,
            next: { label: 'Add at Playhead', action: 'timeline', nodeId: render.id }
        };
    }
    if (timeline) {
        return {
            score,
            state: 'complete',
            label: 'Timeline ready',
            detail: 'This graph has prompt, output, render, and timeline state.',
            missing,
            next: { label: 'Reveal render', action: 'reveal', nodeId: render?.id || '' }
        };
    }
    return {
        score,
        state: 'draft',
        label: 'Draft graph',
        detail: 'Use an action or save a generation to move this graph forward.',
        missing,
        next: { label: 'Improve prompt', action: 'improve', nodeId: prompt?.id || generation?.id || '' }
    };
}

function sourceLabel(source) {
    if (source === 'render') return 'Render history';
    if (source === 'template') return 'Template';
    if (source === 'manual') return 'Manual';
    if (source === 'manim') return 'Motion Diagram';
    return 'Generation';
}

function dataLines(node) {
    const data = node?.data || {};
    if (node?.type === 'render' && data.render) {
        return [data.render.name, data.render.renderPreset, data.render.path].filter(Boolean);
    }
    if (node?.type === 'render') {
        return [data.outputName, data.outputPath, data.sourcePath, data.error].filter(Boolean);
    }
    if (node?.type === 'timeline') return [data.timelineName].filter(Boolean);
    if (node?.type === 'validation') return (data.warnings || []).map(warning => warning.message || String(warning)).slice(0, 3);
    if (node?.type === 'asset') return (data.assets || []).map(asset => asset.name || asset.id).slice(0, 4);
    if (node?.type === 'session') return [data.title, data.messageCount ? `${data.messageCount} messages` : '', data.updatedAt].filter(Boolean);
    if (node?.type === 'action') return [data.action, data.targetLabel, data.prompt ? `${data.prompt.length.toLocaleString()} prompt chars` : ''].filter(Boolean);
    if (node?.type === 'prompt') return [data.prompt].filter(Boolean);
    if (node?.type === 'generation') return [data.html ? `${data.html.length.toLocaleString()} HTML chars` : 'No HTML captured'];
    if (node?.type === 'manim') return [data.quality, data.source ? `${data.source.length.toLocaleString()} Python chars` : '', data.health?.mode].filter(Boolean);
    return Object.values(data).filter(Boolean).map(String).slice(0, 3);
}

function manimBriefForGraph(graph, node) {
    if (!graph) return '';
    const focus = node || graph.nodes?.find(item => item.type === 'generation') || graph.nodes?.[0] || null;
    return [
        `Create a Manim scene from this Resolve AI Ograph: ${graph.title || 'Untitled graph'}.`,
        graph.prompt ? `Original creative brief: ${graph.prompt}` : '',
        focus ? `Focus node: ${focus.label} (${focus.type}/${focus.status}). ${focus.summary || ''}` : '',
        'Graph structure:',
        ...(graph.nodes || []).map(item => `- ${item.label} [${item.type}/${item.status}]: ${item.summary || 'No summary'}`),
        '',
        'Turn the workflow into a clean deterministic Manim explainer scene.',
        'Prefer geometry, labels, arrows, equations, callouts, and simple camera-safe motion.',
        'Keep it universal, creator-friendly, and suitable for local rendering.'
    ].filter(Boolean).join('\n');
}

export default function SidebarOgraph({
    config,
    activeSession,
    latestGeneration,
    focusGraphId,
    onPrompt,
    onUsePrompt,
    onOpenManim
}) {
    const [graphs, setGraphs] = useState([]);
    const [selectedId, setSelectedId] = useState('');
    const [selectedNodeId, setSelectedNodeId] = useState('');
    const [query, setQuery] = useState('');
    const [manualPrompt, setManualPrompt] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const filteredGraphs = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return graphs;
        return graphs.filter(graph => [
            graph.title,
            graph.prompt,
            graph.source,
            graph.provider,
            graph.model,
            ...(graph.nodes || []).map(node => `${node.label} ${node.type} ${node.status} ${node.summary}`)
        ].filter(Boolean).join(' ').toLowerCase().includes(needle));
    }, [graphs, query]);

    const selectedGraph = useMemo(
        () => graphs.find(graph => graph.id === selectedId) || filteredGraphs[0] || graphs[0] || null,
        [filteredGraphs, graphs, selectedId]
    );
    const selectedNode = useMemo(
        () => selectedGraph?.nodes?.find(node => node.id === selectedNodeId) || selectedGraph?.nodes?.[0] || null,
        [selectedGraph, selectedNodeId]
    );
    const stats = graphStats(selectedGraph);
    const readiness = useMemo(() => graphReadiness(selectedGraph), [selectedGraph]);
    const stageMap = useMemo(() => graphStageMap(selectedGraph), [selectedGraph]);

    async function loadGraphs(preferredId) {
        if (!window.ographAPI?.list) return;
        const next = await window.ographAPI.list();
        const nextId = preferredId || selectedId;
        setGraphs(next);
        setSelectedId(nextId && next.some(graph => graph.id === nextId) ? nextId : next[0]?.id || '');
    }

    useEffect(() => {
        loadGraphs().catch(err => setError(err.message || 'Could not load Ographs.'));
    }, []);

    useEffect(() => {
        if (!focusGraphId) return;
        loadGraphs(focusGraphId).catch(err => setError(err.message || 'Could not focus Ograph.'));
    }, [focusGraphId]);

    useEffect(() => {
        if (!selectedGraph?.nodes?.length) {
            setSelectedNodeId('');
            return;
        }
        if (!selectedGraph.nodes.some(node => node.id === selectedNodeId)) {
            setSelectedNodeId(selectedGraph.nodes[0].id);
        }
    }, [selectedGraph, selectedNodeId]);

    useEffect(() => {
        function handleChanged() {
            loadGraphs().catch(err => setError(err.message || 'Could not refresh Ographs.'));
        }
        window.addEventListener('resolve-ai:ographs-changed', handleChanged);
        return () => window.removeEventListener('resolve-ai:ographs-changed', handleChanged);
    }, []);

    async function captureLatest() {
        if (!latestGeneration || !window.ographAPI?.createFromGeneration) return;
        setBusy(true);
        setError('');
        try {
            const created = await window.ographAPI.createFromGeneration({
                prompt: latestGeneration.previousPrompt || '',
                generation: latestGeneration,
                config,
                provider: config?.provider,
                model: config?.provider === 'codex' ? config?.codexModel : config?.model,
                assets: (config?.selectedAssetIds || []).map(id => ({ id })),
                session: activeSession ? {
                    id: activeSession.id,
                    title: activeSession.title || activeSession.name,
                    messageCount: activeSession.messages?.length || 0,
                    updatedAt: activeSession.updatedAt || activeSession.createdAt
                } : null
            });
            await loadGraphs(created.id);
        } catch (err) {
            setError(err.message || 'Could not capture latest result.');
        } finally {
            setBusy(false);
        }
    }

    async function saveManualGraph() {
        if (!manualPrompt.trim() || !window.ographAPI?.save) return;
        setBusy(true);
        setError('');
        try {
            const created = await window.ographAPI.save({
                title: 'Manual Ograph',
                source: 'manual',
                prompt: manualPrompt.trim(),
                provider: config?.provider,
                model: config?.provider === 'codex' ? config?.codexModel : config?.model,
                width: config?.width || 1920,
                height: config?.height || 1080,
                fps: config?.fps || 25,
                nodes: [
                    {
                        id: 'prompt',
                        type: 'prompt',
                        label: 'Creative Prompt',
                        status: 'ready',
                        summary: manualPrompt.trim(),
                        data: { prompt: manualPrompt.trim() }
                    },
                    {
                        id: 'generation',
                        type: 'generation',
                        label: 'Next Generation',
                        status: 'pending',
                        summary: 'Ready to generate from this graph.',
                        data: {}
                    }
                ],
                edges: [{ id: 'edge-1', from: 'prompt', to: 'generation', label: 'feeds' }]
            });
            setManualPrompt('');
            await loadGraphs(created.id);
        } catch (err) {
            setError(err.message || 'Could not save Ograph.');
        } finally {
            setBusy(false);
        }
    }

    async function deleteSelected() {
        if (!selectedGraph || !window.ographAPI?.delete) return;
        setBusy(true);
        setError('');
        try {
            await window.ographAPI.delete(selectedGraph.id);
            await loadGraphs();
        } catch (err) {
            setError(err.message || 'Could not delete Ograph.');
        } finally {
            setBusy(false);
        }
    }

    async function appendActionNode(action, node, prompt) {
        if (!selectedGraph || !window.ographAPI?.update) return;
        const targetNode = node || selectedGraph.nodes?.[selectedGraph.nodes.length - 1] || null;
        const actionNodeId = `action-${Date.now()}`;
        const nextNodes = [
            ...(selectedGraph.nodes || []),
            {
                id: actionNodeId,
                type: 'action',
                label: action.label,
                status: 'pending',
                summary: `Drafted ${action.label.toLowerCase()} prompt from ${targetNode?.label || selectedGraph.title}.`,
                data: {
                    action: action.id,
                    instruction: action.instruction,
                    targetNodeId: targetNode?.id || '',
                    targetLabel: targetNode?.label || '',
                    prompt,
                    createdAt: new Date().toISOString()
                }
            }
        ];
        const nextEdges = [
            ...(selectedGraph.edges || []),
            ...(targetNode ? [{
                id: `edge-${actionNodeId}`,
                from: targetNode.id,
                to: actionNodeId,
                label: 'drafts'
            }] : [])
        ];
        await window.ographAPI.update(selectedGraph.id, { nodes: nextNodes, edges: nextEdges });
        await loadGraphs(selectedGraph.id);
        setSelectedNodeId(actionNodeId);
    }

    async function sendAction(action, node = selectedNode) {
        if (!selectedGraph || !window.ographAPI?.buildPrompt) return;
        setBusy(true);
        setError('');
        try {
            const actionDef = typeof action === 'string'
                ? ACTIONS.find(item => item.id === action) || { id: action, label: action, instruction: action }
                : action;
            const focusedAction = node
                ? `${actionDef.instruction || actionDef.id}. Focus node: ${node.label} (${node.type}/${node.status}) - ${node.summary || 'No summary'}`
                : actionDef.instruction || actionDef.id;
            const result = await window.ographAPI.buildPrompt(selectedGraph, focusedAction);
            const prompt = result?.html
                ? `${result.prompt}\n\nCurrent HTML context:\n\`\`\`html\n${result.html}\n\`\`\``
                : result?.prompt;
            await appendActionNode(actionDef, node, prompt);
            (onUsePrompt || onPrompt)?.(prompt);
        } catch (err) {
            setError(err.message || 'Could not build Ograph prompt.');
        } finally {
            setBusy(false);
        }
    }

    function openGraphAsManimBrief() {
        if (!selectedGraph || !onOpenManim) return;
        onOpenManim({
            idea: manimBriefForGraph(selectedGraph, selectedNode),
            title: selectedGraph.title || 'Ograph Manim Brief',
            origin: 'ograph',
            graphId: selectedGraph.id
        });
    }

    function generationNodeForGraph() {
        if (selectedNode?.type === 'generation' && selectedNode.data?.html) return selectedNode;
        return selectedGraph?.nodes?.find(node => node.type === 'generation' && node.data?.html) || null;
    }

    function manimSourceForGraph() {
        const node = selectedNode?.type === 'manim' && selectedNode.data?.source
            ? selectedNode
            : selectedGraph?.nodes?.find(item => item.type === 'manim' && item.data?.source);
        return node?.data?.source || '';
    }

    function renderNameForGraph() {
        const renderNode = selectedNode?.type === 'render'
            ? selectedNode
            : selectedGraph?.nodes?.find(node => node.type === 'render');
        return renderNode?.data?.render?.name || renderNode?.data?.outputName || selectedGraph?.metadata?.sourceRenderName || '';
    }

    async function updateGraphAfterRender(result) {
        if (!selectedGraph || !window.ographAPI?.update) return;
        const now = new Date().toISOString();
        const renderId = selectedGraph.nodes?.some(node => node.id === 'render') ? 'render' : `render-${Date.now()}`;
        const timelineId = selectedGraph.nodes?.some(node => node.id === 'timeline') ? 'timeline' : `timeline-${Date.now()}`;
        const renderNode = {
            id: renderId,
            type: 'render',
            label: result.name || 'Rendered Output',
            status: 'done',
            summary: result.warning ? `Rendered with warning: ${result.warning}` : 'Rendered from Ograph.',
            data: {
                render: {
                    name: result.name || renderNameForGraph() || '',
                    path: result.path || selectedGraph.nodes?.find(node => node.id === renderId)?.data?.render?.path || '',
                    renderPreset: config?.render?.renderPreset || selectedGraph.metadata?.renderPreset || ''
                },
                updatedAt: now
            }
        };
        const timelineNode = {
            id: timelineId,
            type: 'timeline',
            label: 'Timeline',
            status: result.warning ? 'warning' : 'done',
            summary: result.warning || 'Added at playhead through render workflow.',
            data: { renderName: result.name || '', updatedAt: now }
        };
        const nextNodes = [...(selectedGraph.nodes || [])];
        const upsertNode = (node) => {
            const index = nextNodes.findIndex(item => item.id === node.id);
            if (index >= 0) nextNodes[index] = { ...nextNodes[index], ...node };
            else nextNodes.push(node);
        };
        upsertNode(renderNode);
        upsertNode(timelineNode);
        const nextEdges = [...(selectedGraph.edges || [])];
        const hasEdge = (from, to) => nextEdges.some(edge => edge.from === from && edge.to === to);
        const generation = generationNodeForGraph();
        if (generation && !hasEdge(generation.id, renderId)) {
            nextEdges.push({ id: `edge-${generation.id}-${renderId}`, from: generation.id, to: renderId, label: 'renders' });
        }
        if (!hasEdge(renderId, timelineId)) {
            nextEdges.push({ id: `edge-${renderId}-${timelineId}`, from: renderId, to: timelineId, label: 'adds' });
        }
        await window.ographAPI.update(selectedGraph.id, {
            nodes: nextNodes,
            edges: nextEdges,
            metadata: {
                ...(selectedGraph.metadata || {}),
                sourceRenderName: result.name || selectedGraph.metadata?.sourceRenderName || '',
                lastRenderedAt: now
            }
        });
        await loadGraphs(selectedGraph.id);
        setSelectedNodeId(renderId);
    }

    async function renderGraphOutput() {
        if (!selectedGraph || !window.overlayAPI?.renderMov) return;
        const generation = generationNodeForGraph();
        const html = generation?.data?.html || '';
        if (!html) {
            setError('No generated HTML is available in this Ograph.');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const result = await window.overlayAPI.renderMov({
                html,
                name: selectedGraph.title || generation.label || 'Ograph Output',
                fps: selectedGraph.fps || config?.fps || 25,
                width: selectedGraph.width || config?.width || 1920,
                height: selectedGraph.height || config?.height || 1080,
                renderSettings: config?.render || {},
                metadata: {
                    prompt: selectedGraph.prompt || generation.summary || '',
                    provider: selectedGraph.provider || config?.provider || '',
                    model: selectedGraph.model || (config?.provider === 'codex' ? config?.codexModel : config?.model) || '',
                    html,
                    width: selectedGraph.width || config?.width || 1920,
                    height: selectedGraph.height || config?.height || 1080,
                    fps: selectedGraph.fps || config?.fps || 25,
                    source: 'ograph',
                    ographId: selectedGraph.id,
                    ographTitle: selectedGraph.title
                }
            });
            if (!result?.success) {
                setError(result?.error || 'Ograph render failed.');
                return;
            }
            await updateGraphAfterRender(result);
        } catch (err) {
            setError(err.message || 'Could not render this Ograph.');
        } finally {
            setBusy(false);
        }
    }

    async function revealGraphRender() {
        const name = renderNameForGraph();
        if (!name || !window.overlayAPI?.revealRender) {
            setError('No rendered file is linked to this Ograph yet.');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const result = await window.overlayAPI.revealRender(name);
            if (result === false || result?.success === false) setError(result?.error || 'Could not reveal render file.');
        } catch (err) {
            setError(err.message || 'Could not reveal render file.');
        } finally {
            setBusy(false);
        }
    }

    async function addGraphRenderToTimeline() {
        const name = renderNameForGraph();
        if (!name || !window.overlayAPI?.addRenderToTimeline) {
            setError('No rendered file is linked to this Ograph yet.');
            return;
        }
        setBusy(true);
        setError('');
        try {
            const result = await window.overlayAPI.addRenderToTimeline(name);
            if (!result?.success) {
                setError(result?.error || 'Could not add render at the playhead.');
                return;
            }
            await updateGraphAfterRender({ name, path: '', warning: '' });
        } catch (err) {
            setError(err.message || 'Could not add render at the playhead.');
        } finally {
            setBusy(false);
        }
    }

    function openGraphInManim() {
        const source = manimSourceForGraph();
        if (!source || !onOpenManim) return;
        onOpenManim({
            source,
            idea: selectedGraph?.prompt || selectedGraph?.title || '',
            title: selectedGraph?.title || 'Manim Ograph',
            graphId: selectedGraph?.id || ''
        });
    }

    function runRecommendedAction() {
        const node = selectedGraph?.nodes?.find(item => item.id === readiness.next?.nodeId) || selectedNode;
        if (readiness.next?.action === 'render') return renderGraphOutput();
        if (readiness.next?.action === 'timeline') return addGraphRenderToTimeline();
        if (readiness.next?.action === 'reveal') return revealGraphRender();
        if (readiness.next?.action === 'manim') return openGraphInManim();
        if (readiness.next?.action === 'fix') return sendAction(ACTIONS.find(item => item.id === 'fix render') || 'fix render', node);
        return sendAction(ACTIONS.find(item => item.id === 'improve') || 'improve', node);
    }

    return (
        <section className="sb-section ograph-section">
            <div className="sb-title">
                <span>Ograph</span>
                <div className="sb-actions">
                    <button type="button" className="mini-action" onClick={() => loadGraphs()} disabled={busy}>
                        Refresh
                    </button>
                </div>
            </div>

            <div className="ograph-intro">
                <strong>Motion workflow graph</strong>
                <p>Track prompt, assets, generated HTML, validation, render, and timeline state as one reusable workflow.</p>
            </div>

            {error && <div className="ograph-error">{error}</div>}

            <div className="ograph-actions">
                <button
                    type="button"
                    className="create-generate"
                    onClick={captureLatest}
                    disabled={busy || !latestGeneration}
                >
                    Capture latest result
                </button>
                {!latestGeneration && <p>No generated overlay in this session yet.</p>}
            </div>

            <div className="ograph-library">
                <label htmlFor="ograph-search">Graph library</label>
                <input
                    id="ograph-search"
                    className="ograph-search"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    placeholder="Search graphs, nodes, providers..."
                />
                <select
                    id="ograph-select"
                    value={selectedGraph?.id || ''}
                    onChange={event => setSelectedId(event.target.value)}
                    disabled={!filteredGraphs.length}
                >
                    {filteredGraphs.length ? filteredGraphs.map(graph => (
                        <option key={graph.id} value={graph.id}>{graph.title}</option>
                    )) : <option value="">No matching Ographs</option>}
                </select>
            </div>

            {selectedGraph && (
                <div className="ograph-card">
                    <div className="ograph-card-head">
                        <div>
                            <span className="ograph-source">{sourceLabel(selectedGraph.source)}</span>
                            <strong>{selectedGraph.title}</strong>
                            <span>{selectedGraph.width}x{selectedGraph.height} / {selectedGraph.fps} fps</span>
                        </div>
                        <button type="button" className="mini-action danger" onClick={deleteSelected} disabled={busy}>
                            Delete
                        </button>
                    </div>

                    <div className="ograph-stats" aria-label="Ograph status summary">
                        <span>{stats.total} nodes</span>
                        <span>{stats.done} done</span>
                        <span>{stats.pending} open</span>
                        <span>{stats.warn} needs review</span>
                    </div>

                    <div className={`ograph-readiness ${readiness.state}`} aria-label="Ograph readiness">
                        <div className="ograph-readiness-score">
                            <strong>{readiness.score}</strong>
                            <span>ready</span>
                        </div>
                        <div className="ograph-readiness-main">
                            <span>{readiness.label}</span>
                            <p>{readiness.detail}</p>
                            {readiness.missing.length > 0 && (
                                <div className="ograph-missing" aria-label="Missing workflow pieces">
                                    {readiness.missing.map(item => <em key={item}>{item}</em>)}
                                </div>
                            )}
                        </div>
                        <button type="button" className="mini-action primary" onClick={runRecommendedAction} disabled={busy || !selectedGraph}>
                            {readiness.next.label}
                        </button>
                    </div>

                    <div className="ograph-stage-map" aria-label="Ograph stage map">
                        {stageMap.map(stage => (
                            <div className={'ograph-stage ' + (stage.nodes.length ? 'has-nodes' : 'empty')} key={stage.id}>
                                <div className="ograph-stage-head">
                                    <span>{stage.label}</span>
                                    <em>{stage.nodes.length}</em>
                                </div>
                                <div className="ograph-stage-nodes">
                                    {stage.nodes.length ? stage.nodes.map(node => (
                                        <button
                                            type="button"
                                            className={`ograph-stage-node ${node.type || 'generation'} ${node.status || 'ready'}${selectedNode?.id === node.id ? ' selected' : ''}`}
                                            onClick={() => setSelectedNodeId(node.id)}
                                            key={node.id}
                                        >
                                            <strong>{node.label}</strong>
                                            <span>{node.status || 'ready'}</span>
                                        </button>
                                    )) : <span className="ograph-stage-empty">Not captured</span>}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="ograph-canvas" aria-label="Ograph nodes">
                        {selectedGraph.nodes.map((node, index) => (
                            <React.Fragment key={node.id}>
                                <button
                                    type="button"
                                    className={nodeClass(node, selectedNode?.id === node.id)}
                                    onClick={() => setSelectedNodeId(node.id)}
                                >
                                    <span>{node.type}</span>
                                    <strong>{node.label}</strong>
                                    <p>{node.summary || 'No detail yet.'}</p>
                                </button>
                                {index < selectedGraph.nodes.length - 1 && <div className="ograph-edge" aria-hidden="true">then</div>}
                            </React.Fragment>
                        ))}
                    </div>

                    {selectedNode && (
                        <div className="ograph-node-detail">
                            <div>
                                <span>{selectedNode.type} / {selectedNode.status}</span>
                                <strong>{selectedNode.label}</strong>
                                <p>{selectedNode.summary || 'No summary captured.'}</p>
                            </div>
                            {dataLines(selectedNode).length > 0 && (
                                <ul>
                                    {dataLines(selectedNode).map((line, index) => <li key={index}>{line}</li>)}
                                </ul>
                            )}
                        </div>
                    )}

                    <div className="ograph-action-grid">
                        {actionsForNode(selectedNode).map(action => (
                            <button type="button" className="mini-action" key={action.id} onClick={() => sendAction(action)} disabled={busy}>
                                {action.label}
                            </button>
                        ))}
                        {generationNodeForGraph() && (
                            <button type="button" className="mini-action" onClick={renderGraphOutput} disabled={busy}>
                                Render graph
                            </button>
                        )}
                        <button type="button" className="mini-action" onClick={revealGraphRender} disabled={busy || !renderNameForGraph()}>
                            Reveal render
                        </button>
                        <button type="button" className="mini-action" onClick={addGraphRenderToTimeline} disabled={busy || !renderNameForGraph()}>
                            Add at Playhead
                        </button>
                        <button type="button" className="mini-action" onClick={openGraphInManim} disabled={busy || !manimSourceForGraph()}>
                            Open in Motion Diagram
                        </button>
                        <button type="button" className="mini-action" onClick={openGraphAsManimBrief} disabled={busy || !selectedGraph}>
                            Use as Motion Diagram brief
                        </button>
                    </div>
                </div>
            )}

            <div className="ograph-manual">
                <label htmlFor="ograph-manual-prompt">Start from prompt</label>
                <textarea
                    id="ograph-manual-prompt"
                    value={manualPrompt}
                    onChange={event => setManualPrompt(event.target.value)}
                    placeholder="Describe the overlay workflow you want to build..."
                />
                <button type="button" className="mini-action" onClick={saveManualGraph} disabled={busy || !manualPrompt.trim()}>
                    Save Ograph
                </button>
            </div>
        </section>
    );
}
