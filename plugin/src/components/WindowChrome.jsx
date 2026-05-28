import React, { useEffect, useMemo, useState } from 'react';
import { Close, Maximize, Minimize, Restore } from './Icons';

function statusText(authInfo = {}) {
    if (authInfo.status === 'ready') return 'Connected';
    if (authInfo.status === 'not-installed') return 'Install needed';
    if (authInfo.status === 'not-logged-in') return 'Login needed';
    if (authInfo.status === 'checking') return 'Checking';
    return 'Offline';
}

function statusClass(authInfo = {}) {
    return authInfo.status === 'ready' ? 'ready' : authInfo.status || 'unknown';
}

export default function WindowChrome({ authInfo, provider, model }) {
    const [state, setState] = useState({ maximized: false });
    const subtitle = useMemo(() => {
        const providerText = provider && provider !== 'auto' ? provider : 'auto provider';
        return `${providerText} / ${model || 'default'}`;
    }, [provider, model]);

    useEffect(() => {
        window.windowAPI?.getState?.().then(next => {
            if (next) setState(next);
        }).catch(() => {});
    }, []);

    async function run(action) {
        try {
            const next = await action();
            if (next && !next.closed) setState(next);
        } catch { /* window controls are best-effort in Resolve */ }
    }

    return (
        <header className="window-chrome">
            <div
                className="window-drag-region"
                onDoubleClick={() => run(() => window.windowAPI.toggleMaximize())}
            >
                <div className="chrome-brand" aria-label="Resolve AI window">
                    <div className="chrome-logo" aria-hidden="true" />
                    <div className="chrome-title">
                        <strong>Resolve AI</strong>
                        <span>{subtitle}</span>
                    </div>
                </div>
                <div className={'chrome-status ' + statusClass(authInfo)}>
                    <span aria-hidden="true" />
                    <em>{statusText(authInfo)}</em>
                </div>
            </div>

            <div className="window-controls" aria-label="Window controls">
                <button
                    type="button"
                    className="window-control"
                    aria-label="Minimize window"
                    title="Minimize"
                    onClick={() => run(() => window.windowAPI.minimize())}
                >
                    <Minimize />
                </button>
                <button
                    type="button"
                    className="window-control"
                    aria-label={state.maximized ? 'Restore window' : 'Maximize window'}
                    title={state.maximized ? 'Restore' : 'Maximize'}
                    onClick={() => run(() => window.windowAPI.toggleMaximize())}
                >
                    {state.maximized ? <Restore /> : <Maximize />}
                </button>
                <button
                    type="button"
                    className="window-control close"
                    aria-label="Close window"
                    title="Close"
                    onClick={() => run(() => window.windowAPI.close())}
                >
                    <Close />
                </button>
            </div>
        </header>
    );
}
