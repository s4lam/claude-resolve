import React, { useRef, useEffect, useState } from 'react';
import Preview from './Preview';
import StatusIndicator from './StatusIndicator';
import { Download } from './Icons';

const REGENERATE_ACTIONS = ['More cinematic', 'Simpler', 'Transparent BG', 'Longer', 'Same style', '3 variations'];

function splitFencedCode(text = '') {
    const source = String(text || '');
    const parts = [];
    const fence = /```([a-zA-Z0-9_-]+)?[ \t]*\r?\n?([\s\S]*?)```/g;
    let cursor = 0;
    let match;
    while ((match = fence.exec(source))) {
        if (match.index > cursor) {
            parts.push({ type: 'text', content: source.slice(cursor, match.index) });
        }
        parts.push({
            type: 'code',
            language: (match[1] || '').toLowerCase(),
            content: String(match[2] || '').trim()
        });
        cursor = match.index + match[0].length;
    }
    if (cursor < source.length) {
        parts.push({ type: 'text', content: source.slice(cursor) });
    }
    return parts.length ? parts : [{ type: 'text', content: source }];
}

function isManimSource(code = '', language = '') {
    const text = String(code || '');
    const lang = String(language || '').toLowerCase();
    const pythonish = !lang || ['py', 'python'].includes(lang);
    return pythonish
        && /class\s+ResolveAIManimScene\s*\(/.test(text)
        && /(from\s+manim\s+import|import\s+manim|Scene\s*\))/.test(text);
}

function openManimSource(code) {
    window.dispatchEvent(new CustomEvent('resolve-ai:open-manim-source', {
        detail: {
            source: String(code || '').trim(),
            title: 'Assistant Manim Source',
            idea: 'Use assistant-generated Manim source',
            origin: 'chat'
        }
    }));
}

function openOgraphGraph(graphId) {
    window.dispatchEvent(new CustomEvent('resolve-ai:open-ograph', {
        detail: { graphId: graphId || '' }
    }));
}

function renderFormat(config = {}) {
    const settings = config.render || {};
    if (settings.renderPreset === 'mp4_gpu_quality') {
        return { extension: 'mp4', label: 'GPU MP4 Quality · HEVC NVENC HQ', short: 'GPU MP4' };
    }
    if (settings.renderPreset === 'mp4_cpu_quality') {
        return { extension: 'mp4', label: 'CPU MP4 Quality · H.264', short: 'CPU MP4' };
    }
    if (settings.outputFormat === 'hevc_nvenc_hq') {
        return { extension: 'mp4', label: 'HEVC NVENC HQ', short: 'HEVC NVENC HQ' };
    }
    if (settings.outputFormat === 'h264') {
        return { extension: 'mp4', label: 'H.264 MP4', short: 'MP4' };
    }
    const profile = settings.proresProfile === '4444xq' ? 'ProRes 4444 XQ' : 'ProRes 4444';
    return { extension: 'mov', label: profile, short: profile };
}

function RenderMovAction({ parsed, message, config, provider, model, validation, onRendered, onRepair }) {
    const [status, setStatus] = useState(null);
    const [progress, setProgress] = useState(0);
    const [errorMsg, setErrorMsg] = useState('');
    const [reason, setReason] = useState('');
    const [ographStatus, setOgraphStatus] = useState('');
    const format = renderFormat(config);

    useEffect(() => {
        if (status !== 'rendering') return;
        const cleanup = window.overlayAPI.onRenderProgress((data) => {
            if (data.type === 'progress') setProgress(data.percent);
            else if (data.type === 'encoding') setProgress(100);
        });
        return cleanup;
    }, [status]);

    async function handleRender() {
        setStatus('rendering');
        setProgress(0);
        setErrorMsg('');
        setReason('');
        let queueJob = null;
        try {
            try {
                const queued = await window.overlayAPI.queue?.({
                    action: 'enqueue',
                    job: {
                        name: parsed.name,
                        prompt: message.prompt,
                        provider,
                        model
                    }
                });
                queueJob = queued?.result;
                if (queueJob?.id) await window.overlayAPI.queue({ action: 'start', id: queueJob.id });
            } catch { /* render queue is best-effort */ }
            const result = await window.overlayAPI.renderMov({
                html: parsed.html,
                name: parsed.name,
                fps: config.fps,
                width: config.width,
                height: config.height,
                renderSettings: config.render || {},
                metadata: {
                    prompt: message.prompt,
                    provider,
                    model,
                    html: parsed.html,
                    width: config.width,
                    height: config.height,
                    fps: config.fps,
                    renderQueueId: queueJob?.id || null,
                    selectedAssetIds: config.selectedAssetIds || [],
                    renderSettings: config.render || {},
                    validationWarnings: validation?.warnings || []
                }
            });
            if (result.success) {
                try {
                    if (queueJob?.id) await window.overlayAPI.queue?.({ action: 'complete', id: queueJob.id, result: { name: result.name, path: result.path } });
                } catch { /* render queue is best-effort */ }
                if (result.placed) {
                    setStatus('done');
                } else if (result.imported) {
                    setReason(result.placementReason || result.warning || 'timeline placement failed');
                    setStatus('mediapool');
                } else {
                    setReason(result.placementReason || result.warning || 'Media Pool import failed');
                    setStatus('rendered');
                }
                onRendered?.(result);
                try {
                    if (window.ographAPI?.createFromGeneration) {
                        const graph = await window.ographAPI.createFromGeneration({
                            prompt: message.prompt,
                            generation: parsed,
                            config,
                            provider,
                            model,
                            assets: (config.selectedAssetIds || []).map(id => ({ id })),
                            validationWarnings: validation?.warnings || [],
                            rendered: true,
                            render: result.metadata || { name: result.name, path: result.path },
                            timelineName: result.placed ? 'Current timeline' : '',
                            messageId: message.id
                        });
                        setOgraphStatus(graph?.id ? 'Workflow history saved' : '');
                        window.dispatchEvent(new CustomEvent('resolve-ai:ographs-changed'));
                    }
                } catch {
                    setOgraphStatus('Workflow history skipped');
                }
                window.dispatchEvent(new CustomEvent('resolve-ai:renders-changed'));
                window.dispatchEvent(new CustomEvent('resolve-ai:render-queue-changed'));
            } else {
                setErrorMsg(result.error || 'Unknown error');
                try {
                    if (queueJob?.id) await window.overlayAPI.queue?.({ action: 'fail', id: queueJob.id, error: result.error || 'Unknown error' });
                } catch { /* render queue is best-effort */ }
                setStatus('error');
                window.dispatchEvent(new CustomEvent('resolve-ai:render-queue-changed'));
            }
        } catch (err) {
            setErrorMsg(err.message || 'Unknown error');
            try {
                if (queueJob?.id) await window.overlayAPI.queue?.({ action: 'fail', id: queueJob.id, error: err.message || 'Unknown error' });
            } catch { /* render queue is best-effort */ }
            setStatus('error');
            window.dispatchEvent(new CustomEvent('resolve-ai:render-queue-changed'));
        }
    }

    if (status === null) {
        return <button className="btn-render" onClick={handleRender}><Download /> Render .{format.extension}</button>;
    }
    if (status === 'rendering') {
        return (
            <button className="btn-render" disabled>
                <Download /> Rendering… {progress}%
                <span className="render-progress" style={{ width: progress + '%' }} />
            </button>
        );
    }
    if (status === 'done') {
        return (
            <div className="render-action-stack">
                <button className="btn-render" disabled>Added to Timeline &#10003;</button>
                {ographStatus && <span>{ographStatus}</span>}
            </div>
        );
    }
    if (status === 'mediapool') {
        return (
            <div className="render-action-stack">
                <button className="btn-render warn" disabled title={reason}>
                    Added to Media Pool - could not place on timeline: {reason}. Drag it in manually.
                </button>
                {ographStatus && <span>{ographStatus}</span>}
            </div>
        );
    }
    if (status === 'rendered') {
        return (
            <div className="render-action-stack">
                <button className="btn-render warn" disabled title={reason}>
                    Rendered - Media Pool import needs attention: {reason}
                </button>
                {ographStatus && <span>{ographStatus}</span>}
            </div>
        );
    }
    return (
        <div className="render-error-actions">
            <button className="btn-render error" disabled title={errorMsg}>
                Render Failed: {errorMsg}
            </button>
            <button
                className="mini-action"
                disabled={Number(message.repairCount || 0) >= 2}
                onClick={() => onRepair?.(message, {
                    error: errorMsg,
                    validationWarnings: validation?.warnings || []
                })}
            >
                {Number(message.repairCount || 0) >= 2 ? 'Repair limit reached' : 'Fix with AI'}
            </button>
        </div>
    );
}

function RenderCard({ message, parsed, config, provider, model, onRegenerate, onRepair }) {
    const realtime = parsed.mode === 'realtime';
    const [validation, setValidation] = useState(null);
    const [saveStatus, setSaveStatus] = useState('');
    const [ographStatus, setOgraphStatus] = useState('');
    const [renderResult, setRenderResult] = useState(null);
    const format = renderFormat(config);

    useEffect(() => {
        let alive = true;
        if (!window.overlayAPI?.validate) return undefined;
        window.overlayAPI.validate({ html: parsed.html, prompt: message.prompt, config })
            .then(result => { if (alive) setValidation(result); })
            .catch(() => { if (alive) setValidation(null); });
        return () => { alive = false; };
    }, [parsed.html, message.prompt, config.width, config.height, config.fps]);

    async function handleSaveTemplate() {
        if (!window.templateAPI) return;
        setSaveStatus('Saving');
        await window.templateAPI.save({
            name: parsed.name,
            prompt: message.prompt,
            html: parsed.html,
            thumbnail: renderResult?.metadata?.thumbnail || null,
            provider,
            model,
            width: config.width,
            height: config.height,
            fps: config.fps
        });
        setSaveStatus('Saved');
        window.dispatchEvent(new CustomEvent('resolve-ai:templates-changed'));
        setTimeout(() => setSaveStatus(''), 1800);
    }

    async function handleSaveOgraph() {
        if (!window.ographAPI?.createFromGeneration) return;
        setOgraphStatus('Saving');
        try {
            const graph = await window.ographAPI.createFromGeneration({
                prompt: message.prompt,
                generation: parsed,
                config,
                provider,
                model,
                assets: (config.selectedAssetIds || []).map(id => ({ id })),
                validationWarnings: validation?.warnings || [],
                rendered: Boolean(renderResult?.success),
                render: renderResult?.metadata || renderResult || {},
                timelineName: renderResult?.warning ? '' : renderResult?.success ? 'Current timeline' : '',
                messageId: message.id
            });
            setOgraphStatus('Saved to Workflow Graph');
            window.dispatchEvent(new CustomEvent('resolve-ai:ographs-changed'));
            openOgraphGraph(graph?.id);
            setTimeout(() => setOgraphStatus(''), 1800);
        } catch {
            setOgraphStatus('Workflow Graph save failed');
        }
    }

    const compatibility = validation?.compatibility;

    return (
        <div className="card">
            <div className="card-head">
                <span className="card-name">{parsed.name}</span>
                <span className="card-head-badges">
                    {compatibility && (
                        <span className={'compat-pill ' + compatibility.status}>
                            {compatibility.label}
                        </span>
                    )}
                    <span className={'badge ' + (realtime ? 'realtime' : 'frame')}>
                        <span className="pulse" />{realtime ? 'Realtime' : 'Frame'}
                    </span>
                </span>
            </div>
            <Preview
                parsed={parsed}
                selectedAssetIds={config.selectedAssetIds || []}
                width={config.width}
                height={config.height}
            />
            {compatibility && (
                <div className={'compat-summary ' + compatibility.status}>
                    <div>
                        <strong>{compatibility.label} · {compatibility.score}</strong>
                        <span>{compatibility.summary}</span>
                    </div>
                    {compatibility.chips?.length > 0 && (
                        <div className="compat-chips">
                            {compatibility.chips.map(chip => <span key={chip}>{chip}</span>)}
                        </div>
                    )}
                </div>
            )}
            {validation?.warnings?.length > 0 && (
                <div className="validation-list">
                    {validation.warnings.map(warning => (
                        <div className={'validation ' + warning.severity} key={warning.code}>
                            {warning.message}
                        </div>
                    ))}
                </div>
            )}
            <div className="card-foot">
                <div className="specs">
                    <span className="spec"><b>{config.width}×{config.height}</b></span>
                    <span className="spec">{config.fps} fps</span>
                    <span className="spec alpha">{format.short}</span>
                </div>
                <RenderMovAction
                    parsed={parsed}
                    message={message}
                    config={config}
                    provider={provider}
                    model={model}
                    validation={validation}
                    onRendered={setRenderResult}
                    onRepair={onRepair}
                />
            </div>
            <div className="card-actions">
                <button className="mini-action" onClick={handleSaveTemplate}>
                    {saveStatus || 'Save as Template'}
                </button>
                <button className="mini-action primary" onClick={handleSaveOgraph}>
                    {ographStatus || 'Save to Workflow Graph'}
                </button>
                {REGENERATE_ACTIONS.map(action => (
                    <button
                        key={action}
                        className="mini-action"
                        onClick={() => onRegenerate?.(message, action)}
                    >
                        {action}
                    </button>
                ))}
            </div>
        </div>
    );
}

function VariationSetCard({ message, parsed, config, provider, model, onRegenerate, onRepair }) {
    return (
        <div className="variation-result-set">
            <div className="variation-result-head">
                <strong>{parsed.items.length} variations</strong>
                <span>Choose one to render, save, or refine.</span>
            </div>
            <div className="variation-result-grid">
                {parsed.items.map((item, index) => (
                    <RenderCard
                        key={`${item.name}-${index}`}
                        message={{ ...message, parsed: item }}
                        parsed={item}
                        config={config}
                        provider={provider}
                        model={model}
                        onRegenerate={onRegenerate}
                        onRepair={onRepair}
                    />
                ))}
            </div>
        </div>
    );
}

function AssistantText({ text }) {
    const parts = splitFencedCode(text);
    return (
        <div className="assistant-rich bubble">
            {parts.map((part, index) => {
                if (part.type === 'code') {
                    const manim = isManimSource(part.content, part.language);
                    return (
                        <div className="assistant-code-card" key={`${part.type}-${index}`}>
                            <div className="assistant-code-head">
                                <span>{part.language || 'code'}</span>
                                {manim && (
                                    <button
                                        type="button"
                                        className="mini-action primary"
                                        onClick={() => openManimSource(part.content)}
                                    >
                                        Use in Motion Diagram
                                    </button>
                                )}
                            </div>
                            <pre className="assistant-code-block">{part.content}</pre>
                        </div>
                    );
                }
                return part.content.trim() ? (
                    <div className="assistant-text-block" key={`${part.type}-${index}`}>
                        {part.content.trim()}
                    </div>
                ) : null;
            })}
        </div>
    );
}

function MessageBubble({ message, activeTool, tokenCount, model, provider, config, onRegenerate, onRepair }) {
    if (message.type === 'user') {
        return (
            <div className="msg user">
                <div className="msg-content">
                    <div className="bubble">{message.text}</div>
                </div>
            </div>
        );
    }

    const parsed = message.parsed;

    return (
        <div className={'msg assistant' + (message.isError ? ' error' : '')}>
            <div className="av" />
            <div className="msg-content">
                {message.isThinking
                    ? <StatusIndicator tool={activeTool} tokens={tokenCount} model={model} provider={provider} />
                    : parsed
                        ? parsed.type === 'variations'
                            ? <VariationSetCard
                                message={message}
                                parsed={parsed}
                                config={config}
                                provider={provider}
                                model={model}
                                onRegenerate={onRegenerate}
                                onRepair={onRepair}
                            />
                            : <RenderCard
                                message={message}
                                parsed={parsed}
                                config={config}
                                provider={provider}
                                model={model}
                                onRegenerate={onRegenerate}
                                onRepair={onRepair}
                            />
                        : <AssistantText text={message.text} />}
                {parsed && (
                    <details className="code-toggle">
                        <summary>Show code</summary>
                        <pre className="code-block">{message.text}</pre>
                    </details>
                )}
            </div>
        </div>
    );
}

export default function Chat({ messages, activeTool, tokenCount, model, provider, config, onRegenerate, onRepair }) {
    const outputRef = useRef(null);

    useEffect(() => {
        if (outputRef.current) {
            requestAnimationFrame(() => {
                if (!outputRef.current) return;
                outputRef.current.scrollTop = outputRef.current.scrollHeight;
            });
        }
    }, [messages]);

    return (
        <div className="chat" ref={outputRef}>
            {messages.map(msg => (
                <MessageBubble
                    key={msg.id}
                    message={msg}
                    activeTool={msg.isThinking ? activeTool : null}
                    tokenCount={msg.isThinking ? tokenCount : 0}
                    model={model}
                    provider={provider}
                    config={config}
                    onRegenerate={onRegenerate}
                    onRepair={onRepair}
                />
            ))}
        </div>
    );
}
