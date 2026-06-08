import React, { useEffect, useMemo, useRef, useState } from 'react';

const STYLE_OPTIONS = [
    'clean technical',
    'minimal math',
    'premium explainer',
    'diagram-first',
    'classroom whiteboard'
];

const QUALITY_OPTIONS = [
    { value: 'low', label: 'Preview quality' },
    { value: 'medium', label: 'Medium quality' },
    { value: 'high', label: 'High quality' }
];

const PIPELINE_STEPS = [
    { id: 'generate', label: 'Generate source' },
    { id: 'validate', label: 'Validate' },
    { id: 'render', label: 'Render MP4' },
    { id: 'add', label: 'Add to timeline' }
];

function statusLabel(status) {
    if (status === 'ready') return 'Ready';
    if (status === 'python-only') return 'Manim not installed';
    return 'Setup needed';
}

function extractLatestManimSource(text = '') {
    const value = String(text || '').trim();
    if (!value) return '';
    const pythonBlock = value.match(/```python\s*([\s\S]*?)```/i);
    const genericBlock = value.match(/```\s*([\s\S]*?)```/i);
    const candidate = (pythonBlock?.[1] || genericBlock?.[1] || value).trim();
    if (!/class\s+ResolveAIManimScene\s*\(/.test(candidate)) return '';
    if (!/(from\s+manim\s+import|import\s+manim)/.test(candidate)) return '';
    return candidate;
}

function pipelineStepClass(step, pipeline) {
    const currentIndex = PIPELINE_STEPS.findIndex(item => item.id === pipeline.step);
    const itemIndex = PIPELINE_STEPS.findIndex(item => item.id === step.id);
    if (pipeline.status === 'failed' && step.id === pipeline.step) return 'failed';
    if (pipeline.status === 'done' || itemIndex < currentIndex) return 'done';
    if (itemIndex === currentIndex && pipeline.status === 'running') return 'active';
    return 'idle';
}

export default function SidebarManimLab({
    config,
    latestGeneration,
    latestAssistantText,
    sourceDraft,
    onPrompt,
    onUsePrompt,
    onOpenOgraph,
    onOpenRenders
}) {
    const [health, setHealth] = useState(null);
    const [starterScenes, setStarterScenes] = useState([]);
    const [idea, setIdea] = useState('Explain a concept with clean animated geometry and labels.');
    const [style, setStyle] = useState(STYLE_OPTIONS[0]);
    const [duration, setDuration] = useState(8);
    const [quality, setQuality] = useState('low');
    const [useLatestStyle, setUseLatestStyle] = useState(Boolean(latestGeneration));
    const [source, setSource] = useState('');
    const [validation, setValidation] = useState(null);
    const [renderResult, setRenderResult] = useState(null);
    const [timelineResult, setTimelineResult] = useState(null);
    const [ographStatus, setOgraphStatus] = useState('');
    const [sourceStatus, setSourceStatus] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [pendingAutoDraft, setPendingAutoDraft] = useState(null);
    const [pipeline, setPipeline] = useState({
        status: 'idle',
        step: 'generate',
        message: 'Ready to generate a motion diagram and add it at the playhead.',
        graphId: ''
    });
    const autoJobRef = useRef('');

    const status = health?.status || 'missing';
    const renderBlocked = !health?.ready;
    const renderBlockReason = status === 'python-only'
        ? 'Python is installed, but Manim is missing.'
        : 'Install Python 3.11+ and Manim before rendering.';
    const pipelineBusy = pipeline.status === 'running';
    const hasLatest = Boolean(latestGeneration?.html);
    const latestManimSource = useMemo(
        () => extractLatestManimSource(latestAssistantText),
        [latestAssistantText]
    );
    const dimensions = useMemo(
        () => `${config?.width || 1920}x${config?.height || 1080} / ${config?.fps || 25} fps`,
        [config?.fps, config?.height, config?.width]
    );
    const sourceSummary = source.trim()
        ? `${source.trim().length.toLocaleString()} Python chars captured`
        : 'No Manim source loaded yet';

    async function refreshHealth() {
        if (!window.manimAPI?.detect) return;
        setBusy(true);
        setError('');
        try {
            setHealth(await window.manimAPI.detect());
        } catch (err) {
            setError(err.message || 'Could not check Manim.');
        } finally {
            setBusy(false);
        }
    }

    async function openInstallTerminal() {
        setBusy(true);
        setError('');
        try {
            const result = await window.manimAPI?.openInstallTerminal?.();
            if (result?.success) {
                setPipeline(current => ({
                    ...current,
                    status: 'idle',
                    message: 'Manim install terminal opened. After it finishes, click Retry.'
                }));
            } else {
                setError('Python is missing. Install Python 3.11+, then retry Manim setup.');
            }
        } catch (err) {
            setError(err.message || 'Could not open Manim install terminal.');
        } finally {
            setBusy(false);
        }
    }

    useEffect(() => {
        refreshHealth();
        if (window.manimAPI?.getStarterScenes) {
            window.manimAPI.getStarterScenes()
                .then(items => setStarterScenes(Array.isArray(items) ? items : []))
                .catch(() => setStarterScenes([]));
        }
    }, []);

    useEffect(() => {
        if (!sourceDraft?.source && !sourceDraft?.idea && !sourceDraft?.graphId && !sourceDraft?.error) return;
        setSource(sourceDraft.source || '');
        if (sourceDraft.idea) setIdea(sourceDraft.idea);
        if (sourceDraft.quality) setQuality(sourceDraft.quality);
        setValidation(null);
        setRenderResult(null);
        setTimelineResult(null);
        setOgraphStatus('');
        const origin = sourceDraft.origin === 'chat' ? 'AI chat' : sourceDraft.origin === 'ograph' ? 'Workflow Graph' : 'source';
        const kind = sourceDraft.source ? 'source' : 'brief';
        setSourceStatus(sourceDraft.title ? `Loaded ${kind} from ${origin}: ${sourceDraft.title}` : `Loaded ${kind} from ${origin}`);
        setError(sourceDraft.error || '');
        if (sourceDraft.error) {
            setPipeline({
                status: 'failed',
                step: 'generate',
                message: sourceDraft.error,
                graphId: ''
            });
        } else if (sourceDraft.autoRender && sourceDraft.source) {
            setPipeline({
                status: 'running',
                step: 'generate',
                message: 'AI source received. Preparing local render.',
                graphId: ''
            });
            setPendingAutoDraft(sourceDraft);
        } else {
            setPipeline({
                status: 'idle',
                step: sourceDraft.source ? 'validate' : 'generate',
                message: sourceDraft.source ? 'Source loaded. Render only or edit it in Advanced.' : 'Brief loaded. Generate when ready.',
                graphId: ''
            });
        }
    }, [sourceDraft?.revision]);

    useEffect(() => {
        if (!pendingAutoDraft?.source || !health?.ready || busy) return;
        const jobKey = pendingAutoDraft.jobId || String(pendingAutoDraft.revision || pendingAutoDraft.source.length);
        if (autoJobRef.current === jobKey) return;
        autoJobRef.current = jobKey;
        runAutoPipeline(pendingAutoDraft);
    }, [pendingAutoDraft, health?.ready, busy]);

    useEffect(() => {
        if (!pendingAutoDraft?.source || !health || health.ready || busy) return;
        setPendingAutoDraft(null);
        setError(renderBlockReason);
        setPipeline({
            status: 'failed',
            step: 'render',
            message: renderBlockReason,
            graphId: ''
        });
    }, [pendingAutoDraft, health, busy, renderBlockReason]);

    async function buildPromptPayload() {
        if (!window.manimAPI?.buildPrompt) return null;
        return window.manimAPI.buildPrompt({
            idea,
            style,
            duration,
            config,
            latestGeneration: useLatestStyle ? latestGeneration : null
        });
    }

    async function generateRenderAndAdd() {
        if (renderBlocked) {
            setError(renderBlockReason);
            return;
        }
        setBusy(true);
        setError('');
        setRenderResult(null);
        setTimelineResult(null);
        setOgraphStatus('');
        setPipeline({
            status: 'running',
            step: 'generate',
            message: 'Asking the active AI provider for safe Manim source.',
            graphId: ''
        });
        try {
            const result = await buildPromptPayload();
            if (!result?.prompt) throw new Error('Could not build Manim prompt.');
            const sent = onPrompt?.(result.prompt, {
                displayText: `Motion Diagram: ${idea}`,
                originalPrompt: idea,
                skipSessionContext: true,
                manimJob: {
                    idea,
                    title: 'Generated Motion Diagram',
                    style,
                    duration,
                    quality,
                    autoRender: true,
                    autoAddToTimeline: true
                }
            });
            if (!sent) throw new Error('Could not start generation. Wait for the current AI task to finish.');
            setPipeline(prev => ({
                ...prev,
                message: 'Waiting for the AI provider to return ResolveAIManimScene source.'
            }));
        } catch (err) {
            setPipeline({
                status: 'failed',
                step: 'generate',
                message: err.message || 'Could not start Motion Diagram generation.',
                graphId: ''
            });
            setError(err.message || 'Could not start Motion Diagram generation.');
        } finally {
            setBusy(false);
        }
    }

    async function buildPromptOnly() {
        setBusy(true);
        setError('');
        try {
            const result = await buildPromptPayload();
            if (!result?.prompt) throw new Error('Could not build Manim prompt.');
            (onUsePrompt || onPrompt)?.(result.prompt);
        } catch (err) {
            setError(err.message || 'Could not build Manim prompt.');
        } finally {
            setBusy(false);
        }
    }

    async function validateSourceText(nextSource) {
        if (!window.manimAPI?.validateSource) throw new Error('Manim validation is unavailable.');
        const result = await window.manimAPI.validateSource(nextSource);
        setValidation(result);
        if (!result?.valid) {
            const firstError = result?.errors?.[0] || 'Generated Manim source did not pass validation.';
            throw new Error(firstError);
        }
        return result;
    }

    async function renderSourceText(nextSource, nextQuality = quality) {
        if (!window.manimAPI?.renderScene) throw new Error('Manim render API is unavailable.');
        const result = await window.manimAPI.renderScene({
            source: nextSource,
            name: 'Resolve AI Manim',
            width: config?.width || 1920,
            height: config?.height || 1080,
            fps: config?.fps || 30,
            quality: nextQuality
        });
        setValidation(result.validation || null);
        setRenderResult(result);
        if (!result?.success) {
            const commandText = result.command ? ` Command: ${result.command} ${(result.args || []).join(' ')}` : '';
            throw new Error(`${result?.error || 'Manim render failed.'}${commandText}`);
        }
        return result;
    }

    async function addRenderResultToTimeline(nextRenderResult) {
        if (!nextRenderResult?.outputName || !window.overlayAPI?.addRenderToTimeline) {
            throw new Error('Timeline add is unavailable for this render.');
        }
        const result = await window.overlayAPI.addRenderToTimeline(nextRenderResult.outputName);
        setTimelineResult(result);
        if (!result?.success) throw new Error(result?.error || 'Could not add Manim render at the playhead.');
        return result;
    }

    async function createGraphFor({
        nextSource = source,
        nextValidation = validation,
        nextRenderResult = renderResult,
        nextTimelineResult = timelineResult,
        openGraph = false
    } = {}) {
        if (!String(nextSource || '').trim() || !window.ographAPI?.createFromManim) return null;
        const timelineName = nextTimelineResult?.timelineName
            || nextTimelineResult?.name
            || (nextTimelineResult?.success ? 'Active timeline at playhead' : '');
        const graph = await window.ographAPI.createFromManim({
            idea,
            style,
            duration,
            source: nextSource,
            quality,
            config,
            health,
            validation: nextValidation,
            renderResult: nextRenderResult?.success ? nextRenderResult : null,
            timelineName,
            name: nextRenderResult?.outputName || `${idea || 'Motion Diagram'} Draft`
        });
        setOgraphStatus(graph?.title ? `Saved workflow history: ${graph.title}` : 'Saved workflow history');
        window.dispatchEvent(new CustomEvent('resolve-ai:ographs-changed', { detail: { graphId: graph?.id || '' } }));
        if (openGraph && graph?.id) onOpenOgraph?.(graph.id);
        return graph;
    }

    async function runAutoPipeline(draft) {
        const nextSource = draft.source || source;
        const nextQuality = draft.quality || quality;
        setBusy(true);
        setError('');
        setPendingAutoDraft(null);
        setSource(nextSource);
        try {
            setPipeline({ status: 'running', step: 'validate', message: 'Validating generated source.', graphId: '' });
            const nextValidation = await validateSourceText(nextSource);

            setPipeline({ status: 'running', step: 'render', message: 'Rendering local Manim MP4.', graphId: '' });
            const nextRenderResult = await renderSourceText(nextSource, nextQuality);

            let nextTimelineResult = null;
            if (draft.autoAddToTimeline) {
                setPipeline({ status: 'running', step: 'add', message: 'Adding MP4 to the current active timeline at the playhead.', graphId: '' });
                nextTimelineResult = await addRenderResultToTimeline(nextRenderResult);
            }

            const graph = await createGraphFor({
                nextSource,
                nextValidation,
                nextRenderResult,
                nextTimelineResult
            });
            setPipeline({
                status: 'done',
                step: draft.autoAddToTimeline ? 'add' : 'render',
                message: draft.autoAddToTimeline ? 'Rendered and added at the playhead.' : 'Rendered to Resolve AI Render History.',
                graphId: graph?.id || ''
            });
        } catch (err) {
            setPipeline({
                status: 'failed',
                step: pipeline.step || 'validate',
                message: err.message || 'Motion Diagram job failed.',
                graphId: ''
            });
            setError(err.message || 'Motion Diagram job failed.');
        } finally {
            setBusy(false);
        }
    }

    async function renderOnly() {
        const nextSource = source.trim();
        if (!nextSource || renderBlocked) return;
        setBusy(true);
        setError('');
        setRenderResult(null);
        setTimelineResult(null);
        setOgraphStatus('');
        try {
            setPipeline({ status: 'running', step: 'validate', message: 'Validating source before local render.', graphId: '' });
            const nextValidation = await validateSourceText(nextSource);
            setPipeline({ status: 'running', step: 'render', message: 'Rendering MP4 to Resolve AI Render History.', graphId: '' });
            const nextRenderResult = await renderSourceText(nextSource);
            const graph = await createGraphFor({ nextSource, nextValidation, nextRenderResult });
            setPipeline({
                status: 'done',
                step: 'render',
                message: 'Rendered MP4 to Resolve AI Render History.',
                graphId: graph?.id || ''
            });
        } catch (err) {
            setPipeline({
                status: 'failed',
                step: pipeline.step || 'render',
                message: err.message || 'Could not render Manim scene.',
                graphId: ''
            });
            setError(err.message || 'Could not render Manim scene.');
        } finally {
            setBusy(false);
        }
    }

    async function validateCurrentSource() {
        if (!source.trim()) return;
        setBusy(true);
        setError('');
        try {
            setPipeline({ status: 'running', step: 'validate', message: 'Validating source.', graphId: '' });
            await validateSourceText(source);
            setPipeline({ status: 'done', step: 'validate', message: 'Source passed validation.', graphId: pipeline.graphId || '' });
        } catch (err) {
            setPipeline({ status: 'failed', step: 'validate', message: err.message || 'Source validation failed.', graphId: '' });
            setError(err.message || 'Source validation failed.');
        } finally {
            setBusy(false);
        }
    }

    function useStarterScene(scene) {
        setSource(scene.source || '');
        setValidation(null);
        setRenderResult(null);
        setTimelineResult(null);
        setOgraphStatus('');
        setSourceStatus(`Loaded local starter: ${scene.title}`);
        setError('');
        setAdvancedOpen(true);
        setPipeline({
            status: 'idle',
            step: 'validate',
            message: 'Starter source loaded. Render only or edit it first.',
            graphId: ''
        });
    }

    function useLatestAssistantSource() {
        if (!latestManimSource) return;
        setSource(latestManimSource);
        setValidation(null);
        setRenderResult(null);
        setTimelineResult(null);
        setOgraphStatus('');
        setSourceStatus('Loaded latest AI Manim source');
        setError('');
        setAdvancedOpen(true);
        setPipeline({
            status: 'idle',
            step: 'validate',
            message: 'Latest AI source loaded. Render only or edit it first.',
            graphId: ''
        });
    }

    async function saveManimToOgraph() {
        setBusy(true);
        setError('');
        setOgraphStatus('');
        try {
            const graph = await createGraphFor({ openGraph: true });
            if (!graph) throw new Error('Load Manim source before saving workflow history.');
        } catch (err) {
            setError(err.message || 'Could not save Manim source to workflow history.');
        } finally {
            setBusy(false);
        }
    }

    async function revealRendered() {
        if (!renderResult?.outputName || !window.overlayAPI?.revealRender) return;
        setBusy(true);
        setError('');
        try {
            const result = await window.overlayAPI.revealRender(renderResult.outputName);
            if (!result?.success) setError(result?.error || 'Could not reveal rendered Manim file.');
        } catch (err) {
            setError(err.message || 'Could not reveal rendered Manim file.');
        } finally {
            setBusy(false);
        }
    }

    async function syncRendered() {
        if (!window.overlayAPI?.syncToMediaPool) return;
        setBusy(true);
        setError('');
        try {
            const result = await window.overlayAPI.syncToMediaPool();
            if (result?.error) setError(result.error);
        } catch (err) {
            setError(err.message || 'Could not sync render history to the Media Pool.');
        } finally {
            setBusy(false);
        }
    }

    async function addRenderedToTimeline() {
        if (!renderResult?.outputName) return;
        setBusy(true);
        setError('');
        try {
            const result = await addRenderResultToTimeline(renderResult);
            await createGraphFor({ nextTimelineResult: result });
            setPipeline({
                status: 'done',
                step: 'add',
                message: 'Added rendered MP4 to the active timeline at the playhead.',
                graphId: pipeline.graphId || ''
            });
        } catch (err) {
            setError(err.message || 'Could not add Manim render at the playhead.');
        } finally {
            setBusy(false);
        }
    }

    return (
        <section className="sb-section manim-section">
            <div className="sb-title">
                <span>Motion Diagram</span>
                <div className="sb-actions">
                    <button type="button" className="mini-action" onClick={refreshHealth} disabled={busy}>
                        Retry
                    </button>
                </div>
            </div>

            <div className={'manim-health ' + status}>
                <div>
                    <strong>{statusLabel(status)}</strong>
                    <span>{health?.ready ? health?.manim?.version || 'Manim available' : renderBlockReason}</span>
                </div>
                <em>{health?.ready ? health?.mode || 'ready' : 'setup required'}</em>
            </div>

            {renderBlocked && (
                <div className="manim-setup-callout">
                    <strong>Rendering is disabled until Manim is installed.</strong>
                    <p>Open a visible terminal installer, wait for it to finish, then click Retry.</p>
                    <code>python -m pip install manim</code>
                    <button type="button" className="mini-action" onClick={openInstallTerminal} disabled={busy}>
                        Install Manim
                    </button>
                </div>
            )}

            {error && <div className="ograph-error">{error}</div>}

            <div className="manim-copy">
                <strong>Generate diagrams, equations, education clips, and technical explainers.</strong>
                <p>One click asks the active AI provider for Manim source, validates it, renders an MP4 locally, then adds it to the active Resolve timeline at the playhead.</p>
                <p>Workflow history is saved automatically. Open Advanced source editor only when you want to inspect or modify the Python.</p>
            </div>

            <div className="manim-form">
                <label htmlFor="manim-idea">Idea</label>
                <textarea
                    id="manim-idea"
                    value={idea}
                    onChange={event => setIdea(event.target.value)}
                    placeholder="Explain a product workflow, equation, diagram, or technical concept..."
                />

                <div className="manim-form-grid">
                    <div>
                        <label htmlFor="manim-style">Style</label>
                        <select id="manim-style" value={style} onChange={event => setStyle(event.target.value)}>
                            {STYLE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="manim-duration">Duration</label>
                        <input
                            id="manim-duration"
                            type="number"
                            min="3"
                            max="30"
                            value={duration}
                            onChange={event => setDuration(event.target.value)}
                        />
                    </div>
                </div>

                <label htmlFor="manim-quality">Quality</label>
                <select id="manim-quality" value={quality} onChange={event => setQuality(event.target.value)}>
                    {QUALITY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>

                <div className="manim-context">
                    <span>{dimensions}</span>
                    <label>
                        <input
                            type="checkbox"
                            checked={useLatestStyle && hasLatest}
                            onChange={event => setUseLatestStyle(event.target.checked)}
                            disabled={!hasLatest}
                        />
                        Use latest overlay as style reference
                    </label>
                </div>

                <button
                    type="button"
                    className="create-generate"
                    onClick={generateRenderAndAdd}
                    disabled={busy || pipelineBusy || !idea.trim() || renderBlocked}
                >
                    {renderBlocked ? 'Install Manim to render' : 'Generate, Render & Add'}
                </button>

                <div className="manim-primary-actions">
                    <button type="button" className="mini-action" onClick={renderOnly} disabled={busy || pipelineBusy || !source.trim() || renderBlocked}>
                        Render only
                    </button>
                    {latestManimSource && (
                        <button type="button" className="mini-action" onClick={useLatestAssistantSource} disabled={busy || pipelineBusy}>
                            Use latest AI source
                        </button>
                    )}
                    <button type="button" className="mini-action" onClick={buildPromptOnly} disabled={busy || pipelineBusy || !idea.trim()}>
                        Build prompt only
                    </button>
                    <button type="button" className="mini-action" onClick={() => setAdvancedOpen(open => !open)}>
                        {advancedOpen ? 'Hide source editor' : 'Advanced source editor'}
                    </button>
                </div>
            </div>

            <div className={'manim-stepper ' + pipeline.status} aria-label="Motion Diagram job status">
                {PIPELINE_STEPS.map(step => (
                    <div className={'manim-step ' + pipelineStepClass(step, pipeline)} key={step.id}>
                        <span aria-hidden="true" />
                        <strong>{step.label}</strong>
                    </div>
                ))}
                <p>{pipeline.message}</p>
            </div>

            {source.trim() && !advancedOpen && (
                <div className="manim-source-summary">
                    <div>
                        <strong>Source ready</strong>
                        <span>{sourceSummary}</span>
                    </div>
                    <button type="button" className="mini-action" onClick={() => setAdvancedOpen(true)}>
                        Edit source
                    </button>
                </div>
            )}

            {sourceStatus && !advancedOpen && <span className="manim-source-status">{sourceStatus}</span>}

            {advancedOpen && (
                <div className="manim-source-panel">
                    {starterScenes.length > 0 && (
                        <div className="manim-starters">
                            <div className="sb-title">
                                <span>Starter scenes</span>
                                <small>Safe local templates</small>
                            </div>
                            <div className="manim-starter-grid">
                                {starterScenes.map(scene => (
                                    <button
                                        type="button"
                                        className="manim-starter"
                                        key={scene.id}
                                        onClick={() => useStarterScene(scene)}
                                        disabled={busy || pipelineBusy}
                                    >
                                        <strong>{scene.title}</strong>
                                        <span>{scene.description}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="manim-source-head">
                        <div>
                            <strong>Advanced source editor</strong>
                            <span>Explicit action. Validation runs before Python render.</span>
                        </div>
                    </div>
                    <textarea
                        className="manim-source"
                        value={source}
                        onChange={event => {
                            setSource(event.target.value);
                            setValidation(null);
                            setRenderResult(null);
                            setTimelineResult(null);
                            setSourceStatus('');
                        }}
                        placeholder={'Paste generated Manim Python here. Required class: ResolveAIManimScene.'}
                    />
                    {sourceStatus && <span className="manim-source-status">{sourceStatus}</span>}
                    <div className="manim-source-actions">
                        <button type="button" className="mini-action" onClick={validateCurrentSource} disabled={busy || pipelineBusy || !source.trim()}>
                            Validate source
                        </button>
                        <button type="button" className="mini-action" onClick={saveManimToOgraph} disabled={busy || pipelineBusy || !source.trim()}>
                            {renderResult?.success ? 'Save render history' : 'Save draft history'}
                        </button>
                    </div>
                </div>
            )}

            {ographStatus && <span className="manim-ograph-status">{ographStatus}</span>}

            {validation && (
                <div className={'manim-validation ' + (validation.valid ? 'valid' : 'invalid')}>
                    <strong>{validation.valid ? 'Source passed validation' : 'Source blocked'}</strong>
                    {validation.errors?.map((line, index) => <p key={`e-${index}`}>{line}</p>)}
                    {validation.warnings?.map((line, index) => <p key={`w-${index}`}>{line}</p>)}
                </div>
            )}

            {renderResult?.success && (
                <div className="manim-render-result">
                    <strong>{timelineResult?.success ? 'Rendered and added at playhead' : 'Rendered to Resolve AI Render History'}</strong>
                    <p>{renderResult.outputName}</p>
                    {renderResult.outputPath && <small>{renderResult.outputPath}</small>}
                    <div className="manim-source-actions">
                        <button type="button" className="mini-action" onClick={revealRendered} disabled={busy}>
                            Reveal file
                        </button>
                        <button type="button" className="mini-action" onClick={onOpenRenders} disabled={busy || !onOpenRenders}>
                            View Renders
                        </button>
                        <button type="button" className="mini-action" onClick={addRenderedToTimeline} disabled={busy || timelineResult?.success}>
                            {timelineResult?.success ? 'Added at Playhead' : 'Add at Playhead'}
                        </button>
                        <button type="button" className="mini-action" onClick={syncRendered} disabled={busy}>
                            Sync to Media Pool
                        </button>
                        {pipeline.graphId && (
                            <button type="button" className="mini-action" onClick={() => onOpenOgraph?.(pipeline.graphId)} disabled={busy}>
                                Workflow Graph
                            </button>
                        )}
                    </div>
                </div>
            )}

            {health?.suggestions?.length > 0 && (
                <div className="manim-suggestions">
                    <span>Setup notes</span>
                    {health.suggestions.map((line, index) => <p key={index}>{line}</p>)}
                </div>
            )}
        </section>
    );
}
