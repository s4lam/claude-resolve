import React, { useMemo, useState } from 'react';

function formatDate(value) {
    if (!value) return 'No date';
    try {
        return new Intl.DateTimeFormat(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(new Date(value));
    } catch {
        return value;
    }
}

function sessionScope(session) {
    return [session.projectName, session.timelineName].filter(Boolean).join(' / ') || 'No Resolve project';
}

export default function SidebarSessions({
    sessions = [],
    activeSession,
    onNewSession,
    onOpenSession,
    onRenameSession,
    onDeleteSession
}) {
    const [query, setQuery] = useState('');
    const filtered = useMemo(() => {
        const q = query.toLowerCase();
        return sessions.filter(session => [
            session.title,
            session.projectName,
            session.timelineName,
            session.lastPrompt,
            session.provider,
            session.model
        ].filter(Boolean).join(' ').toLowerCase().includes(q));
    }, [sessions, query]);

    function handleRename(session) {
        const next = window.prompt('Session name', session.title || 'Untitled session');
        if (!next || next === session.title) return;
        onRenameSession?.(session.id, next);
    }

    function handleDelete(session) {
        const ok = window.confirm(`Delete "${session.title}"? This only removes local chat history.`);
        if (!ok) return;
        onDeleteSession?.(session.id);
    }

    return (
        <div className="sb-section sessions-section">
            <div className="sb-title">
                <span>Sessions</span>
                <button className="sync" onClick={onNewSession}>New</button>
            </div>

            <div className="session-current">
                <span className="session-current-label">Current</span>
                <strong>{activeSession?.title || 'Untitled session'}</strong>
                <span>{sessionScope(activeSession || {})}</span>
            </div>

            <input
                className="sb-search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Search sessions"
                aria-label="Search sessions"
            />

            <div className="session-list">
                {filtered.map(session => {
                    const active = session.id === activeSession?.id;
                    return (
                        <article className={'session-row' + (active ? ' active' : '')} key={session.id}>
                            <button
                                type="button"
                                className="session-open"
                                onClick={() => onOpenSession?.(session.id)}
                                aria-current={active ? 'true' : undefined}
                            >
                                <span className="session-title-line">
                                    <strong>{session.title || 'Untitled session'}</strong>
                                    {active && <em>Open</em>}
                                </span>
                                <span>{sessionScope(session)}</span>
                                <span className="session-meta">
                                    {formatDate(session.updatedAt)} · {session.messageCount || 0} msgs · {session.renderCount || 0} renders
                                </span>
                            </button>
                            <div className="session-actions">
                                <button className="mini-action" onClick={() => handleRename(session)}>Rename</button>
                                <button className="mini-action danger" onClick={() => handleDelete(session)}>Delete</button>
                            </div>
                        </article>
                    );
                })}
                {filtered.length === 0 && <div className="sb-empty">No sessions match this search</div>}
            </div>
        </div>
    );
}
