import React, { useState } from 'react';
import SidebarAssetLibrary from './SidebarAssetLibrary';
import SidebarAssets from './SidebarAssets';
import SidebarCaptions from './SidebarCaptions';
import SidebarPromptGallery from './SidebarPromptGallery';
import SidebarSettings from './SidebarSettings';
import SidebarTemplates from './SidebarTemplates';

const TOOL_TABS = [
    ['assets', 'Assets'],
    ['renders', 'Renders'],
    ['gallery', 'Gallery'],
    ['captions', 'Captions'],
    ['templates', 'Templates']
];

export default function Sidebar({ view = 'tools', config, onConfigChange, onPrompt, onShowTools, onClose }) {
    const [activeTool, setActiveTool] = useState('assets');

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
        if (activeTool === 'renders') return <SidebarAssets onPrompt={onPrompt} />;
        if (activeTool === 'gallery') return <SidebarPromptGallery onPrompt={onPrompt} />;
        if (activeTool === 'captions') return <SidebarCaptions config={config} onPrompt={onPrompt} />;
        if (activeTool === 'templates') return <SidebarTemplates onPrompt={onPrompt} />;
        return <SidebarAssetLibrary config={config} onConfigChange={onConfigChange} />;
    }

    return (
        <aside className="sb sb-tools-view">
            <div className="tools-header">
                <div className="tools-heading">
                    <span className="tools-eyebrow">Resolve AI</span>
                    <h2>Tools</h2>
                    <p>{TOOL_TABS.find(([id]) => id === activeTool)?.[1] || 'Assets'}</p>
                </div>
                {onClose && (
                    <button className="tools-close" onClick={onClose} aria-label="Close tools">
                        ×
                    </button>
                )}
            </div>
            <div className="tools-tabs" role="tablist" aria-label="Tool sections">
                {TOOL_TABS.map(([id, label]) => (
                    <button
                        type="button"
                        role="tab"
                        id={`tools-tab-${id}`}
                        aria-selected={activeTool === id}
                        aria-controls={`tools-panel-${id}`}
                        className={'tools-tab' + (activeTool === id ? ' active' : '')}
                        onClick={() => setActiveTool(id)}
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
