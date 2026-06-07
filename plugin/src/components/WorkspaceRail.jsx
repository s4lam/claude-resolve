import React from 'react';

const WORKSPACES = [
    {
        id: 'create',
        label: 'Create',
        detail: 'Prompts, assets, gallery'
    },
    {
        id: 'produce',
        label: 'Produce',
        detail: 'Timeline, captions, renders'
    },
    {
        id: 'discover',
        label: 'Discover',
        detail: 'Clip Finder, rough cuts'
    }
];

export default function WorkspaceRail({
    workspaceMode = 'create',
    onWorkspaceModeChange,
    sidebarOpen,
    sidebarView,
    onOpenTools,
    onOpenSettings,
    updateAvailable
}) {
    const settingsOpen = sidebarOpen && sidebarView === 'settings';

    return (
        <nav className="workspace-rail" aria-label="Resolve AI workspaces">
            <div className="workspace-rail-top">
                {WORKSPACES.map(workspace => (
                    <button
                        key={workspace.id}
                        type="button"
                        className={'rail-mode' + (workspaceMode === workspace.id ? ' active' : '')}
                        onClick={() => onWorkspaceModeChange?.(workspace.id)}
                        aria-pressed={workspaceMode === workspace.id}
                        title={workspace.detail}
                    >
                        <span>{workspace.label}</span>
                        <small>{workspace.detail}</small>
                    </button>
                ))}
            </div>
            <div className="workspace-rail-bottom">
                <button
                    type="button"
                    className={'rail-icon' + (sidebarOpen && sidebarView === 'tools' ? ' active' : '')}
                    onClick={onOpenTools}
                    aria-pressed={sidebarOpen && sidebarView === 'tools'}
                    aria-label="Open tools"
                    title="Tools"
                >
                    <span aria-hidden="true">+</span>
                    <em>Tools</em>
                </button>
                <button
                    type="button"
                    className={'rail-icon' + (settingsOpen ? ' active' : '')}
                    onClick={onOpenSettings}
                    aria-pressed={settingsOpen}
                    aria-label="Open settings"
                    title="Settings"
                >
                    <span aria-hidden="true">#</span>
                    <em>Settings{updateAvailable ? ' update' : ''}</em>
                    {updateAvailable && <i aria-hidden="true" />}
                </button>
            </div>
        </nav>
    );
}
