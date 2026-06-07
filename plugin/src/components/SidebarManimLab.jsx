import React, { useEffect, useMemo, useState } from 'react';

const STYLE_OPTIONS = [
    'clean technical',
    'minimal math',
    'premium explainer',
    'diagram-first',
    'classroom whiteboard'
];

function statusLabel(status) {
    if (status === 'ready') return 'Ready';
    if (status === 'python-only') return 'Python found';
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
    const [useLatestStyle, setUseLatestStyle] = useState(Boolean(latestGeneration));
    const [source, setSource] = useState('');
    const [quality, setQuality] = useState('low');
    const [validation, setValidation] = useState(null);
    const [renderResult, setRenderResult] = useState(null);
    const [ographStatus, setOgraphStatus] = useState('');
    const [sourceStatus, setSourceStatus] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const status = health?.status || 'missing';
    const hasLatest = Boolean(latestGeneration?.html);
    const dimensions = useMemo(
        () => `${config?.width || 1920}x${config?.height || 1080} / ${config?.fps || 25} fps`,
        [config?.fps, config?.height, config?.width]
    );
    const latestManimSource = useMemo(
        () => extractLatestManimSource(latestAssistantText),
        [latestAssistantText]
    );

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

    useEffect(() => {
        refreshHealth();
        if (window.manimAPI?.getStarterScenes) {
            window.manimAPI.getStarterScenes()
                .then(items => setStarterScenes(Array.isArray(items) ? items : []))
                .catch(() => setStarterScenes([]));
        }
    }, []);

    useEffect(() => {
        if (!sourceDraft?.source && !sourceDraft?.idea && !sourceDraft?.graphId) return;
        setSource(sourceDraft.source || '');
        if (sourceDraft.idea) setIdea(sourceDraft.idea);
        setValidation(null);
        setRenderResult(null);
        setOgraphStatus('');
        const origin = sourceDraft.origin === 'chat' ? 'chat' : 'Ograph';
        const kind = sourceDraft.source ? 'source' : 'brief';
        setSourceStatus(sourceDraft.title ? `Loaded ${kind} from ${origin}: ${sourceDraft.title}` : `Loaded ${kind} from ${origin}`);
        setError('');
    }, [sourceDraft?.revision]);

    async function buildPrompt() {
        if (!window.manimAPI?.buildPrompt) return;
        setBusy(true);
        setError('');
        try {
            const result = await window.manimAPI.buildPrompt({
                idea,
                style,
                duration,
                config,
                latestGeneration: useLatestStyle ? latestGeneration : null
            });
            (onUsePrompt || onPrompt)?.(result.prompt);
        } catch (err) {
            setError(err.message || 'Could not build Manim prompt.');
        } finally {
            setBusy(false);
        }
    }

    async function validateSource() {
        if (!window.manimAPI?.validateSource) return null;
        setBusy(true);
        setError('');
        setRenderResult(null);
        setOgraphStatus('');
        setSourceStatus('');
        try {
            const result = await window.manimAPI.validateSource(source);
            setValidation(result);
            return result;
        } catch (err) {
            setError(err.message || 'Could not validate Manim source.');
            return null;
        } finally {
            setBusy(false);
        }
    }

    async function renderScene() {
        if (!window.manimAPI?.renderScene) return;
        setBusy(true);
        setError('');
        setRenderResult(null);
        setOgraphStatus('');
        setSourceStatus('');
        try {
            const result = await window.manimAPI.renderScene({
                source,
                name: 'Resolve AI Manim',
                width: config?.width || 1920,
                height: config?.height || 1080,
                fps: config?.fps || 30,
                quality
            });
            setValidation(result.validation || null);
            setRenderResult(result);
            setOgraphStatus('');
            if (!result.success) setError(result.error || 'Manim render failed.');
        } catch (err) {
            setError(err.message || 'Could not render Manim scene.');
        } finally {
            setBusy(false);
        }
    }

    function useStarterScene(scene) {
        setSource(scene.source || '');
        setValidation(null);
        setRenderResult(null);
        setOgraphStatus('');
        setSourceStatus('');
        setError('');
    }

    function useLatestAssistantSource() {
        if (!latestManimSource) return;
        setSource(latestManimSource);
        setValidation(null);
        setRenderResult(null);
        setOgraphStatus('');
        setSourceStatus('Loaded latest AI Manim source');
        setError('');
    }

    async function saveManimToOgraph() {
        if (!source.trim() || !window.ographAPI?.createFromManim) return;
        setBusy(true);
        setError('');
        setOgraphStatus('');
        try {
            const graph = await window.ographAPI.createFromManim({
                idea,
                style,
                duration,
                source,
                quality,
                config,
                health,
                validation,
                renderResult: renderResult?.success ? renderResult : null,
                name: renderResult?.outputName || `${idea || 'Manim Scene'} Draft`
            });
            setOgraphStatus(graph?.title ? `Saved to Ograph: ${graph.title}` : 'Saved to Ograph');
            window.dispatchEvent(new CustomEvent('resolve-ai:ographs-changed', { detail: { graphId: graph?.id || '' } }));
            if (graph?.id) onOpenOgraph?.(graph.id);
        } catch (err) {
            setError(err.message || 'Could not save Manim source to Ograph.');
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
        if (!renderResult?.outputName || !window.overlayAPI?.addRenderToTimeline) return;
        setBusy(true);
        setError('');
        try {
            const result = await window.overlayAPI.addRenderToTimeline(renderResult.outputName);
            if (!result?.success) setError(result?.error || 'Could not add Manim render at the playhead.');
        } catch (err) {
            setError(err.message || 'Could not add Manim render at the playhead.');
        } finally {
            setBusy(false);
        }
    }

    return (
        <section className="sb-section manim-section">
            <div className="sb-title">
                <span>Manim Lab</span>
                <div className="sb-actions">
                    <button type="button" className="mini-action" onClick={refreshHealth} disabled={busy}>
                        Retry
                    </button>
                </div>
            </div>

            <div className={'manim-health ' + status}>
                <div>
                    <strong>{statusLabel(status)}</strong>
                    <span>{health?.ready ? health?.manim?.version || 'Manim available' : 'Optional local engine'}</span>
                </div>
                <em>{health?.mode || 'detecting'}</em>
            </div>

            {error && <div className="ograph-error">{error}</div>}

            <div className="manim-copy">
                <strong>Use Manim for diagrams, equations, education, and technical explainers.</strong>
                <p>Generate a Manim scene prompt, paste the reviewed Python source here, validate it, then render locally when Manim is ready.</p>
                <p>Rendered MP4 files are saved to Resolve AI Render History. After render, use Reveal file, View Renders, Add at Playhead, or Sync to Media Pool.</p>
            </div>

            <div className="manim-form">
                <label htmlFor="manim-idea">Scene idea</label>
                <textarea
                    id="manim-idea"
                    value={idea}
                    onChange={event => setIdea(event.target.value)}
                    placeholder="Explain a product workflow, equation, diagram, or technical concept..."
                />

                <label htmlFor="manim-style">Style</label>
                <select id="manim-style" value={style} onChange={event => setStyle(event.target.value)}>
                    {STYLE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                </select>

                <label htmlFor="manim-duration">Duration</label>
                <input
                    id="manim-duration"
                    type="number"
                    min="3"
                    max="30"
                    value={duration}
                    onChange={event => setDuration(event.target.value)}
                />

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
                    onClick={buildPrompt}
                    disabled={busy || !idea.trim()}
                >
                    Build Manim prompt
                </button>
            </div>

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
                                    disabled={busy}
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
                        <strong>Local Manim render</strong>
                        <span>Explicit action. Validates source before running Python.</span>
                    </div>
                    <select value={quality} onChange={event => setQuality(event.target.value)} aria-label="Manim render quality">
                        <option value="low">Preview quality</option>
                        <option value="medium">Medium quality</option>
                        <option value="high">High quality</option>
                    </select>
                </div>
                <textarea
                    className="manim-source"
                    value={source}
                    onChange={event => {
                        setSource(event.target.value);
                        setValidation(null);
                        setRenderResult(null);
                        setSourceStatus('');
                    }}
                    placeholder={'Paste generated Manim Python here. Required class: ResolveAIManimScene.'}
                />
                {sourceStatus && <span className="manim-source-status">{sourceStatus}</span>}
                <div className="manim-source-actions">
                    {latestManimSource && (
                        <button type="button" className="mini-action" onClick={useLatestAssistantSource} disabled={busy}>
                            Use latest AI source
                        </button>
                    )}
                    <button type="button" className="mini-action" onClick={validateSource} disabled={busy || !source.trim()}>
                        Validate source
                    </button>
                    <button type="button" className="mini-action" onClick={saveManimToOgraph} disabled={busy || !source.trim()}>
                        {renderResult?.success ? 'Save render to Ograph' : 'Save draft to Ograph'}
                    </button>
                    <button type="button" className="create-generate" onClick={renderScene} disabled={busy || !source.trim() || !health?.ready}>
                        Render Manim MP4
                    </button>
                </div>
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
                        <strong>Rendered to Resolve AI Render History</strong>
                        <p>{renderResult.outputName}</p>
                        {renderResult.outputPath && <small>{renderResult.outputPath}</small>}
                        <div className="manim-source-actions">
                            <button type="button" className="mini-action" onClick={revealRendered} disabled={busy}>
                                Reveal file
                            </button>
                            <button type="button" className="mini-action" onClick={onOpenRenders} disabled={busy || !onOpenRenders}>
                                View Renders
                            </button>
                            <button type="button" className="mini-action" onClick={addRenderedToTimeline} disabled={busy}>
                                Add at Playhead
                            </button>
                            <button type="button" className="mini-action" onClick={syncRendered} disabled={busy}>
                                Sync to Media Pool
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {health?.suggestions?.length > 0 && (
                <div className="manim-suggestions">
                    <span>Setup notes</span>
                    {health.suggestions.map((line, index) => <p key={index}>{line}</p>)}
                </div>
            )}
        </section>
    );
}
