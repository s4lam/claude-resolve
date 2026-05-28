import React, { useEffect, useState } from 'react';
import { hashGradient } from '../utils/hashGradient';

const ACTIONS = [
    ['title', 'Title at playhead', 'Generate a title for the current timeline position.'],
    ['lower-third', 'Lower third', 'Generate a transparent lower third at the playhead.'],
    ['transition', 'Transition', 'Generate a short transition overlay at the playhead.']
];

function contextText(context) {
    if (!context) return 'Checking timeline';
    if (!context.available) return 'Timeline unavailable';
    const size = context.width && context.height ? `${context.width}x${context.height}` : 'size unavailable';
    const fps = context.fps ? `${context.fps}fps` : 'fps unavailable';
    return `${context.timelineName || 'Timeline'} / ${size} / ${fps}`;
}

function selectedClipText(context) {
    const clips = context?.selectedClips || [];
    if (!clips.length) return 'Selected clip unavailable';
    if (clips.length === 1) return clips[0].name || clips[0].fileName || 'Selected clip';
    return `${clips.length} selected clips`;
}

function markerBatchPrompt(context, config) {
    const markers = (context?.markers || []).slice(0, 4);
    const width = context?.width || config.width || 1920;
    const height = context?.height || config.height || 1080;
    const fps = context?.fps || config.fps || 25;
    const lines = markers.map((marker, index) => [
        `${index + 1}. ${marker.name || 'Timeline marker'}`,
        marker.timecode ? `timecode ${marker.timecode}` : null,
        marker.action ? `type ${marker.action}` : null,
        marker.color ? `color ${marker.color}` : null,
        marker.note ? `note: ${marker.note}` : null
    ].filter(Boolean).join(' / '));

    return [
        'Create a marker-based Resolve AI graphics set for the current DaVinci Resolve timeline.',
        `Canvas: ${width}x${height}. FPS: ${fps}.`,
        context?.timelineName ? `Timeline: ${context.timelineName}.` : 'Timeline name unavailable.',
        '',
        `Markers:\n${lines.join('\n')}`,
        '',
        'Return one complete HTML file per marker in separate ```html fenced blocks with clear FILE names.',
        'Each file must use window.renderFrame(frame, fps) and window.getAnimationDuration().',
        'Use transparent ProRes 4444-safe backgrounds for lower thirds, transitions, and overlays.',
        'Keep the visual system consistent across all marker graphics.'
    ].join('\n');
}

export default function SidebarTimeline({ config, onPrompt }) {
    const [context, setContext] = useState(null);
    const [renders, setRenders] = useState([]);
    const [status, setStatus] = useState('');

    useEffect(() => {
        refresh();
        const onChanged = () => refreshRenders();
        window.addEventListener('resolve-ai:renders-changed', onChanged);
        return () => window.removeEventListener('resolve-ai:renders-changed', onChanged);
    }, []);

    async function refresh() {
        await Promise.all([refreshContext(), refreshRenders()]);
    }

    async function refreshContext() {
        try {
            const next = await window.timelineAPI.getContext();
            setContext(next);
        } catch {
            setContext({ available: false, unavailable: ['timeline context'] });
        }
    }

    async function refreshRenders() {
        if (!window.overlayAPI?.listRenders) return;
        setRenders((await window.overlayAPI.listRenders()).slice(0, 4));
    }

    async function generate(type, render = null, marker = null) {
        setStatus('Preparing');
        try {
            const result = await window.timelineAPI.generateAtPlayhead({
                type,
                render,
                marker,
                context: context || {
                    fps: config.fps,
                    width: config.width,
                    height: config.height
                }
            });
            if (result?.prompt) {
                const accepted = onPrompt(result.prompt, { displayText: result.displayText || 'Timeline action' });
                setStatus(accepted === false ? 'Finish current run first' : 'Added to composer');
                setTimeout(() => setStatus(''), 1800);
            }
        } catch {
            setStatus('Timeline action failed');
            setTimeout(() => setStatus(''), 2200);
        }
    }

    function generateMarkerBatch() {
        if (!context?.markers?.length) {
            setStatus('No markers');
            setTimeout(() => setStatus(''), 1800);
            return;
        }
        const accepted = onPrompt(markerBatchPrompt(context, config), { displayText: 'Marker graphics set' });
        setStatus(accepted === false ? 'Finish current run first' : 'Marker set added');
        setTimeout(() => setStatus(''), 1800);
    }

    return (
        <div className="sb-section timeline-section">
            <div className="sb-title">
                <span>Timeline</span>
                <span className="sb-actions">
                    {status && <span className="sync-status">{status}</span>}
                    <button className="sync" onClick={refresh}>Refresh</button>
                </span>
            </div>

            <div className="timeline-context-card">
                <span className={'status-dot ' + (context?.available ? 'ready' : 'warn')} />
                <div>
                    <strong>{contextText(context)}</strong>
                    <p>
                        {context?.currentTimecode ? `Playhead ${context.currentTimecode}` : 'Playhead unavailable'}
                        {' / '}
                        {selectedClipText(context)}
                        {context?.unavailable?.length ? ` / Unavailable: ${context.unavailable.slice(0, 2).join(', ')}` : ''}
                    </p>
                </div>
            </div>

            <div className="timeline-action-list">
                {ACTIONS.map(([type, label, help]) => (
                    <button className="timeline-action" key={type} onClick={() => generate(type)}>
                        <span>{label}</span>
                        <small>{help}</small>
                    </button>
                ))}
            </div>

            <div className="timeline-subhead-row">
                <span className="timeline-subhead">Timeline markers</span>
                <button className="mini-action" disabled={!context?.markers?.length} onClick={generateMarkerBatch}>
                    Draft set
                </button>
            </div>
            {context?.markers?.length ? (
                <div className="timeline-marker-list">
                    {context.markers.map(marker => (
                        <button
                            className="timeline-marker"
                            key={`${marker.frame}-${marker.name}`}
                            onClick={() => generate('marker', null, marker)}
                            title={marker.note || marker.name}
                        >
                            <span>
                                <strong>{marker.name || 'Timeline marker'}</strong>
                                <small>{marker.timecode || 'time unavailable'} / {marker.color || 'marker'} / {marker.action || 'title'}</small>
                            </span>
                            {marker.note && <em>{marker.note}</em>}
                        </button>
                    ))}
                </div>
            ) : (
                <div className="sb-empty">No timeline markers found</div>
            )}

            <div className="timeline-subhead">Recent renders</div>
            {renders.length === 0 ? (
                <div className="sb-empty">No render history yet</div>
            ) : (
                <div className="timeline-render-list">
                    {renders.map(render => (
                        <article className="timeline-render" key={render.name}>
                            {render.thumbnail
                                ? <img src={render.thumbnail} alt="" />
                                : <span style={{ background: hashGradient(render.name) }} />}
                            <div>
                                <strong title={render.name}>{render.name}</strong>
                                <small>{render.metadata?.provider || 'local render'}</small>
                            </div>
                            <button className="mini-action" onClick={() => generate('rerender', render)}>Re-render</button>
                        </article>
                    ))}
                </div>
            )}
        </div>
    );
}
