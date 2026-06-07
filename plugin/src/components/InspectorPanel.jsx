import React from 'react';

function shortPreset(render = {}) {
    const preset = render.renderPreset || render.outputFormat || 'prores_mov';
    if (preset === 'cpu_mp4') return 'CPU MP4';
    if (preset === 'gpu_mp4') return 'GPU MP4';
    if (preset === 'prores_mov' || preset === 'prores') return 'ProRes MOV';
    return String(preset).replace(/_/g, ' ');
}

function modeLabel(mode) {
    if (mode === 'produce') return 'Produce';
    if (mode === 'discover') return 'Discover';
    return 'Create';
}

export default function InspectorPanel({
    workspaceMode = 'create',
    config = {},
    activeSession,
    messages = [],
    latestGeneration,
    sidebarOpen,
    sidebarView,
    onOpenTool
}) {
    const provider = config.provider === 'auto'
        ? 'Auto'
        : String(config.provider || 'Auto').replace(/^./, c => c.toUpperCase());
    const model = config.provider === 'codex' ? config.codexModel : config.model;
    const selectedAssetCount = Array.isArray(config.selectedAssetIds) ? config.selectedAssetIds.length : 0;
    const latestName = latestGeneration?.name || latestGeneration?.previousName || 'No generated overlay';
    const hasLatestGeneration = Boolean(latestGeneration?.html);
    const messageCount = Array.isArray(messages) ? messages.filter(message => !message.isThinking).length : 0;
    const dimensions = `${config.width || 1920}x${config.height || 1080}`;
    const openTool = (mode, tool) => onOpenTool?.(mode, tool);

    return (
        <aside className="workspace-inspector" aria-label="Workspace inspector">
            <section className="inspector-block">
                <span className="inspector-kicker">Workspace</span>
                <h2>{modeLabel(workspaceMode)}</h2>
                <p>{sidebarOpen ? `${sidebarView === 'settings' ? 'Settings' : 'Tools'} open` : 'Canvas focused'}</p>
            </section>

            <section className="inspector-block">
                <span className="inspector-kicker">Session</span>
                <div className="inspector-stat">
                    <strong>{activeSession?.title || 'Current chat'}</strong>
                    <span>{messageCount} messages</span>
                </div>
            </section>

            <section className="inspector-block">
                <span className="inspector-kicker">Generation</span>
                <div className="inspector-stat">
                    <strong>{latestName}</strong>
                    <span>{dimensions} / {config.fps || 25} fps</span>
                </div>
            </section>

            <section className="inspector-block">
                <span className="inspector-kicker">Output</span>
                <div className="inspector-stat">
                    <strong>{shortPreset(config.render)}</strong>
                    <span>{provider} / {model || 'default'}</span>
                </div>
            </section>

            <section className="inspector-block">
                <span className="inspector-kicker">Assets</span>
                <div className="inspector-stat">
                    <strong>{selectedAssetCount} attached</strong>
                    <span>Brand kit and prompt assets stay local.</span>
                </div>
            </section>

            <section className="inspector-block inspector-workflow">
                <span className="inspector-kicker">Workflow</span>
                <button type="button" className="inspector-flow-step" onClick={() => openTool('create', 'create')}>
                    <strong>Create</strong>
                    <span>Guide a new overlay prompt.</span>
                </button>
                <button
                    type="button"
                    className="inspector-flow-step"
                    onClick={() => openTool('create', 'ograph')}
                >
                    <strong>Workflow Graph</strong>
                    <span>{hasLatestGeneration ? 'Capture the latest result as workflow history.' : 'Open saved provenance and render history.'}</span>
                </button>
                <button type="button" className="inspector-flow-step" onClick={() => openTool('create', 'manim')}>
                    <strong>Motion Diagram</strong>
                    <span>Generate, render, and add local diagram clips.</span>
                </button>
                <button type="button" className="inspector-flow-step" onClick={() => openTool('produce', 'timeline')}>
                    <strong>Timeline</strong>
                    <span>Render, add to Resolve, and review history.</span>
                </button>
            </section>
        </aside>
    );
}
