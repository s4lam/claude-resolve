import React from 'react';
import WorkspaceRail from './WorkspaceRail';
import InspectorPanel from './InspectorPanel';

export default function WorkspaceShell({
    workspaceMode,
    onWorkspaceModeChange,
    sidebarOpen,
    sidebarView,
    onOpenTools,
    onOpenSettings,
    updateAvailable,
    sidePanel,
    main,
    presets,
    composer,
    inspectorProps
}) {
    return (
        <div className={'workspace-shell workspace-' + (workspaceMode || 'create') + (sidebarOpen ? ' sidebar-open' : '')}>
            <WorkspaceRail
                workspaceMode={workspaceMode}
                onWorkspaceModeChange={onWorkspaceModeChange}
                sidebarOpen={sidebarOpen}
                sidebarView={sidebarView}
                onOpenTools={onOpenTools}
                onOpenSettings={onOpenSettings}
                updateAvailable={updateAvailable}
            />
            {sidebarOpen && sidePanel}
            <main className="workspace-main">
                <div className="workspace-canvas">
                    {main}
                </div>
                {presets}
                {composer}
            </main>
            <InspectorPanel
                {...inspectorProps}
                workspaceMode={workspaceMode}
                sidebarOpen={sidebarOpen}
                sidebarView={sidebarView}
            />
        </div>
    );
}
