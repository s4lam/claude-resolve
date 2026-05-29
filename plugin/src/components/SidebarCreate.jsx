import React, { useEffect, useMemo, useState } from 'react';
import {
    ASPECT_RATIOS,
    BACKGROUND_MODES,
    CREATE_TYPES,
    STYLE_LEVELS,
    STYLE_LOCKS,
    buildCreatePrompt
} from '../data/createWorkflow';

export default function SidebarCreate({ config, onConfigChange, latestGeneration, onPrompt }) {
    const [type, setType] = useState('title-card');
    const [idea, setIdea] = useState('');
    const [duration, setDuration] = useState(5);
    const [backgroundMode, setBackgroundMode] = useState('transparent');
    const [aspectRatio, setAspectRatio] = useState('timeline');
    const [styleLevel, setStyleLevel] = useState('balanced');
    const [useLatestStyle, setUseLatestStyle] = useState(false);
    const [timelineContext, setTimelineContext] = useState(null);

    useEffect(() => {
        let alive = true;
        window.timelineAPI?.getContext?.()
            .then(context => { if (alive) setTimelineContext(context); })
            .catch(() => {});
        return () => { alive = false; };
    }, []);

    const selectedAssets = (config.selectedAssetIds || []).length;
    const generation = config.generation || {};
    const locks = generation.locks || {};
    const chosen = CREATE_TYPES.find(item => item.id === type) || CREATE_TYPES[0];
    const prompt = useMemo(() => buildCreatePrompt({
        type,
        idea: idea.trim(),
        duration,
        backgroundMode,
        aspectRatio,
        styleLevel,
        selectedAssets,
        config,
        timelineContext,
        locks,
        useLatestStyle,
        latestGeneration
    }), [type, idea, duration, backgroundMode, aspectRatio, styleLevel, selectedAssets, config, timelineContext, locks, useLatestStyle, latestGeneration]);

    async function patchLocks(patch) {
        await onConfigChange?.({
            generation: {
                ...generation,
                locks: { ...locks, ...patch }
            }
        });
    }

    function handleGenerate() {
        onPrompt(prompt, { displayText: `${chosen.label}: ${idea.trim() || chosen.help}` });
    }

    return (
        <div className="sb-section create-section">
            <div className="sb-title">
                <span>Create</span>
                <span className="sync-status">{config.width}×{config.height} / {config.fps}fps</span>
            </div>

            <section className="wizard-panel">
                <div className="wizard-step-heading">
                    <span>1</span>
                    <div>
                        <strong>Create</strong>
                        <small>Pick the motion graphic and describe the idea.</small>
                    </div>
                </div>

                <div className="create-type-grid" role="list" aria-label="Create workflow type">
                    {CREATE_TYPES.map(item => (
                        <button
                            type="button"
                            role="listitem"
                            key={item.id}
                            className={'create-type' + (type === item.id ? ' active' : '')}
                            aria-pressed={type === item.id}
                            onClick={() => setType(item.id)}
                        >
                            <strong>{item.label}</strong>
                            <span>{item.help}</span>
                        </button>
                    ))}
                </div>

                <label className="create-field wide">
                    <span>Idea</span>
                    <textarea
                        className="tool-textarea"
                        value={idea}
                        onChange={e => setIdea(e.target.value)}
                        placeholder="Example: tech review opener with a glassy product grid and fast text reveal..."
                        rows={4}
                    />
                </label>
            </section>

            <section className="wizard-panel">
                <div className="wizard-step-heading">
                    <span>2</span>
                    <div>
                        <strong>Output</strong>
                        <small>Match the timeline and render intent.</small>
                    </div>
                </div>

                <div className="create-controls">
                    <label className="create-field">
                        <span>Duration</span>
                        <select value={duration} onChange={e => setDuration(Number(e.target.value))}>
                            {[2, 3, 4, 5, 6, 8, 10].map(value => <option key={value} value={value}>{value}s</option>)}
                        </select>
                    </label>
                    <label className="create-field">
                        <span>Background</span>
                        <select value={backgroundMode} onChange={e => setBackgroundMode(e.target.value)}>
                            {BACKGROUND_MODES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                        </select>
                    </label>
                    <label className="create-field">
                        <span>Aspect</span>
                        <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)}>
                            {ASPECT_RATIOS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                        </select>
                    </label>
                </div>

                <div className="wizard-meta-strip">
                    <span>Timeline</span>
                    <strong>{config.width}×{config.height} / {config.fps}fps</strong>
                </div>
            </section>

            <section className="wizard-panel">
                <div className="wizard-step-heading">
                    <span>3</span>
                    <div>
                        <strong>Style locks</strong>
                        <small>Keep the parts that already work.</small>
                    </div>
                </div>

                <label className="create-field wide">
                    <span>Style intensity</span>
                    <select value={styleLevel} onChange={e => setStyleLevel(e.target.value)}>
                        {STYLE_LEVELS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                    </select>
                </label>

                <div className="wizard-meta-strip">
                    <span>Assets</span>
                    <strong>{selectedAssets ? `${selectedAssets} attached asset${selectedAssets === 1 ? '' : 's'}` : 'No attached assets'}</strong>
                </div>

                <div className="style-lock-grid" aria-label="Style locks">
                    {STYLE_LOCKS.map(lock => (
                        <button
                            type="button"
                            key={lock.id}
                            className={'lock-chip' + (locks[lock.id] ? ' active' : '')}
                            aria-pressed={!!locks[lock.id]}
                            onClick={() => patchLocks({ [lock.id]: !locks[lock.id] })}
                        >
                            {lock.label}
                        </button>
                    ))}
                </div>

                <label className={'latest-style-toggle' + (!latestGeneration?.html ? ' disabled' : '')}>
                    <input
                        type="checkbox"
                        checked={useLatestStyle && !!latestGeneration?.html}
                        disabled={!latestGeneration?.html}
                        onChange={e => setUseLatestStyle(e.target.checked)}
                    />
                    <span>
                        Use latest result as style reference
                        <small>{latestGeneration?.name || latestGeneration?.previousName || 'No generated HTML yet'}</small>
                    </span>
                </label>
            </section>

            <div className="generation-brief">
                <div>
                    <span>Generation brief</span>
                    <strong>{chosen.label} / {duration}s / {backgroundMode} / {styleLevel}</strong>
                </div>
                <p>{idea.trim() || chosen.help}</p>
                <small>
                    {selectedAssets ? `${selectedAssets} attached asset${selectedAssets === 1 ? '' : 's'}` : 'No attached assets'}
                    {timelineContext?.selectedClips?.length ? ` / ${timelineContext.selectedClips.length} selected clip${timelineContext.selectedClips.length === 1 ? '' : 's'}` : ''}
                    {useLatestStyle && latestGeneration?.html ? ` / style reference: ${latestGeneration.name || latestGeneration.previousName}` : ''}
                </small>
            </div>

            <button className="create-generate" onClick={handleGenerate}>
                Generate {chosen.label}
            </button>
        </div>
    );
}
