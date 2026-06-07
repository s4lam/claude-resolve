import React, { useEffect, useMemo, useState } from 'react';
import SidebarAssetLibrary from './SidebarAssetLibrary';
import SidebarAssets from './SidebarAssets';
import SidebarCaptions from './SidebarCaptions';
import SidebarPromptGallery from './SidebarPromptGallery';
import SidebarSettings from './SidebarSettings';
import SidebarSessions from './SidebarSessions';
import SidebarTemplates from './SidebarTemplates';
import SidebarCreate from './SidebarCreate';
import SidebarTimeline from './SidebarTimeline';
import SidebarVariations from './SidebarVariations';
import SidebarRoughCut from './SidebarRoughCut';
import SidebarShortsStudio from './SidebarShortsStudio';
import SidebarOgraph from './SidebarOgraph';
import SidebarManimLab from './SidebarManimLab';

const TOOL_TABS = [
    { id: 'sessions', label: 'Sessions', modes: ['create', 'produce', 'discover'] },
    { id: 'create', label: 'Create', modes: ['create'] },
    { id: 'assets', label: 'Assets', modes: ['create'] },
    { id: 'ograph', label: 'Workflow Graph', modes: ['create', 'produce'] },
    { id: 'manim', label: 'Motion Diagram', modes: ['create', 'produce'] },
    { id: 'variations', label: 'Variations', modes: ['create'] },
    { id: 'gallery', label: 'Gallery', modes: ['create'] },
    { id: 'templates', label: 'Templates', modes: ['create'] },
    { id: 'timeline', label: 'Timeline', modes: ['produce'] },
    { id: 'captions', label: 'Captions', modes: ['produce'] },
    { id: 'renders', label: 'Renders', modes: ['produce'] },
    { id: 'shorts-studio', label: 'Clip Finder', modes: ['discover'] },
    { id: 'rough-cut', label: 'Rough Cut', modes: ['discover'] },
];

function workspaceTitle(mode) {
    if (mode === 'produce') return 'Produce';
    if (mode === 'discover') return 'Discover';
    return 'Create';
}

const DEFAULT_TOOL_BY_WORKSPACE = {
    create: 'create',
    produce: 'timeline',
    discover: 'shorts-studio'
};

export default function Sidebar({
    view = 'tools',
    config,
    onConfigChange,
    onPrompt,
    onUsePrompt,
    onShowTools,
    onClose,
    sessions,
    activeSession,
    onNewSession,
    onOpenSession,
    onRenameSession,
    onDeleteSession,
    latestGeneration,
    latestAssistantText,
    sourceDraft,
    workspaceMode = 'create'
}) {
    const [activeTool, setActiveTool] = useState(config?.ui?.activeToolTab || 'create');
    const [focusedOgraphId, setFocusedOgraphId] = useState('');
    const [manimDraft, setManimDraft] = useState(null);
    const visibleTabs = useMemo(
        () => TOOL_TABS.filter(tab => tab.modes.includes(workspaceMode || 'create')),
        [workspaceMode]
    );

    useEffect(() => {
        if (view !== 'tools') return;
        if (visibleTabs.some(tab => tab.id === activeTool)) return;
        const preferredTool = DEFAULT_TOOL_BY_WORKSPACE[workspaceMode] || 'create';
        const nextTool = visibleTabs.find(tab => tab.id === preferredTool)?.id || visibleTabs[0]?.id || 'create';
        openTool(nextTool);
    }, [activeTool, onConfigChange, view, visibleTabs]);

    useEffect(() => {
        if (view !== 'tools') return;
        const requestedTool = config?.ui?.activeToolTab;
        if (!requestedTool || requestedTool === activeTool) return;
        if (!visibleTabs.some(tab => tab.id === requestedTool)) return;
        setActiveTool(requestedTool);
    }, [activeTool, config?.ui?.activeToolTab, view, visibleTabs]);

    useEffect(() => {
        if (view !== 'tools') return;
        if (config?.ui?.focusOgraphId) {
            setFocusedOgraphId(config.ui.focusOgraphId);
        }
    }, [config?.ui?.focusOgraphId, view]);

    useEffect(() => {
        if (view !== 'tools') return;
        if (!sourceDraft?.source && !sourceDraft?.idea && !sourceDraft?.jobId && !sourceDraft?.error) return;
        openTool('manim', sourceDraft);
    }, [sourceDraft?.revision, view]);

    if (view === 'settings') {
        return (
            <aside className="sb sb-settings-view">
                <SidebarSettings
                    config={config}
                    onConfigChange={onConfigChange}
                    onShowTools={onShowTools}
                    onClose={onClose}
                />
            </aside>
        );
    }

    function renderActiveTool() {
        if (activeTool === 'sessions') {
            return (
                <SidebarSessions
                    sessions={sessions}
                    activeSession={activeSession}
                    onNewSession={onNewSession}
                    onOpenSession={onOpenSession}
                    onRenameSession={onRenameSession}
                    onDeleteSession={onDeleteSession}
                />
            );
        }
        if (activeTool === 'create') return <SidebarCreate config={config} onConfigChange={onConfigChange} latestGeneration={latestGeneration} onPrompt={onPrompt} />;
        if (activeTool === 'timeline') return <SidebarTimeline config={config} onPrompt={onUsePrompt || onPrompt} />;
        if (activeTool === 'ograph') return <SidebarOgraph config={config} activeSession={activeSession} latestGeneration={latestGeneration} focusGraphId={focusedOgraphId} onPrompt={onPrompt} onUsePrompt={onUsePrompt || onPrompt} onOpenManim={(payload) => openTool('manim', payload)} />;
        if (activeTool === 'manim') return <SidebarManimLab config={config} latestGeneration={latestGeneration} latestAssistantText={latestAssistantText} sourceDraft={manimDraft} onPrompt={onPrompt} onUsePrompt={onUsePrompt || onPrompt} onOpenOgraph={(graphId) => openTool('ograph', { graphId })} onOpenRenders={() => openTool('renders')} />;
        if (activeTool === 'shorts-studio') return <SidebarShortsStudio config={config} onConfigChange={onConfigChange} latestAssistantText={latestAssistantText} onPrompt={onPrompt} />;
        if (activeTool === 'rough-cut') return <SidebarRoughCut config={config} latestAssistantText={latestAssistantText} onPrompt={onPrompt} />;
        if (activeTool === 'variations') return <SidebarVariations config={config} onConfigChange={onConfigChange} latestGeneration={latestGeneration} onPrompt={onPrompt} onUsePrompt={onUsePrompt || onPrompt} />;
        if (activeTool === 'renders') return <SidebarAssets onPrompt={onUsePrompt || onPrompt} />;
        if (activeTool === 'gallery') return <SidebarPromptGallery config={config} onConfigChange={onConfigChange} onPrompt={onUsePrompt || onPrompt} />;
        if (activeTool === 'captions') return <SidebarCaptions config={config} onConfigChange={onConfigChange} onPrompt={onPrompt} />;
        if (activeTool === 'templates') return <SidebarTemplates onPrompt={onUsePrompt || onPrompt} />;
        return <SidebarAssetLibrary config={config} onConfigChange={onConfigChange} onPrompt={onUsePrompt || onPrompt} />;
    }

    function openTool(id, options = {}) {
        if (id === 'ograph' && options.graphId) setFocusedOgraphId(options.graphId);
        if (id === 'manim' && (options.source || options.idea || options.graphId || options.jobId || options.error)) {
            setManimDraft({
                source: options.source || '',
                idea: options.idea || '',
                title: options.title || '',
                origin: options.origin || (options.graphId ? 'ograph' : ''),
                graphId: options.graphId || '',
                autoRender: Boolean(options.autoRender),
                autoAddToTimeline: Boolean(options.autoAddToTimeline),
                quality: options.quality || '',
                error: options.error || '',
                jobId: options.jobId || '',
                revision: options.revision || Date.now()
            });
        }
        setActiveTool(id);
        onConfigChange?.({ ui: { activeToolTab: id } });
    }

    function handleToolSelect(id) {
        openTool(id);
    }

    const activeTab = TOOL_TABS.find(tab => tab.id === activeTool);

    return (
        <aside className="sb sb-tools-view">
            <div className="tools-header">
                <div className="tools-heading">
                    <span className="tools-eyebrow">Resolve AI</span>
                    <h2>{workspaceTitle(workspaceMode)} Tools</h2>
                    <p>{activeTab?.label || 'Assets'}</p>
                </div>
                {onClose && (
                    <button className="tools-close" onClick={onClose} aria-label="Close tools">
                        ×
                    </button>
                )}
            </div>
            <div className="tools-tabs" role="tablist" aria-label="Tool sections">
                {visibleTabs.map(({ id, label }) => (
                    <button
                        type="button"
                        role="tab"
                        id={`tools-tab-${id}`}
                        aria-selected={activeTool === id}
                        aria-controls={`tools-panel-${id}`}
                        className={'tools-tab' + (activeTool === id ? ' active' : '')}
                        onClick={() => handleToolSelect(id)}
                        key={id}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <div
                className="tools-panel"
                role="tabpanel"
                id={`tools-panel-${activeTool}`}
                aria-labelledby={`tools-tab-${activeTool}`}
            >
                {renderActiveTool()}
            </div>
        </aside>
    );
}
