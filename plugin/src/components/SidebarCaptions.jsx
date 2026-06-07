import React, { useEffect, useMemo, useState } from 'react';

const CAPTION_STYLES = [
    ['clean', 'Clean', 'Readable subtitles for general edits.'],
    ['kinetic', 'Kinetic', 'Phrase motion with strong emphasis.'],
    ['karaoke', 'Karaoke', 'Timed word or phrase highlighting.'],
    ['social shorts', 'Social', 'Large captions for short-form clips.'],
    ['podcast clips', 'Podcast', 'Lower captions with space for faces.'],
    ['bold hook', 'Bold Hook', 'Large first-line hook for vertical shorts.'],
    ['documentary', 'Documentary', 'Minimal readable captions for story edits.']
];

const REGROUP_MODES = [
    ['original', 'Original'],
    ['sentence', 'Whole sentence'],
    ['punchy', 'Punchy Shorts'],
    ['karaoke', 'Karaoke'],
    ['single', 'Single word'],
    ['custom', 'Custom']
];

function summarizeCues(cues) {
    if (!cues.length) return { cueCount: 0, wordCount: 0, duration: 0, averageWordsPerCue: 0, warnings: [] };
    const first = cues[0]?.start || 0;
    const last = cues[cues.length - 1]?.end || 0;
    const wordCount = cues.reduce((sum, cue) => sum + String(cue.text || '').split(/\s+/).filter(Boolean).length, 0);
    return {
        cueCount: cues.length,
        wordCount,
        duration: Math.max(0, last - first).toFixed(1),
        averageWordsPerCue: (wordCount / cues.length).toFixed(1),
        warnings: []
    };
}

function fmt(seconds) {
    const value = Math.max(0, Number(seconds || 0));
    const minutes = Math.floor(value / 60);
    const secs = Math.floor(value % 60);
    const ms = Math.round((value - Math.floor(value)) * 1000);
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function cloneCues(cues) {
    return (cues || []).map(cue => ({ ...cue, words: Array.isArray(cue.words) ? cue.words.map(word => ({ ...word })) : [] }));
}

export default function SidebarCaptions({ config, onConfigChange, onPrompt }) {
    const captionConfig = config?.captions || {};
    const [rawText, setRawText] = useState('');
    const [cues, setCues] = useState([]);
    const [analysis, setAnalysis] = useState(null);
    const [style, setStyle] = useState(captionConfig.defaultStyle || 'clean');
    const [outputMode, setOutputMode] = useState(captionConfig.defaultOutputMode || 'overlay');
    const [regroupMode, setRegroupMode] = useState(captionConfig.defaultRegroupMode || 'punchy');
    const [maxWords, setMaxWords] = useState(6);
    const [maxChars, setMaxChars] = useState(34);
    const [search, setSearch] = useState('');
    const [status, setStatus] = useState('');
    const [warnings, setWarnings] = useState([]);
    const [projects, setProjects] = useState([]);
    const [activeProjectId, setActiveProjectId] = useState(captionConfig.activeProjectId || '');
    const [nativeState, setNativeState] = useState(null);
    const [history, setHistory] = useState([]);
    const [redo, setRedo] = useState([]);

    const stats = analysis || summarizeCues(cues);
    const verticalSafe = captionConfig.verticalSafe !== false;
    const dimensions = verticalSafe ? { width: 1080, height: 1920, fps: 30 } : { width: config?.width || 1920, height: config?.height || 1080, fps: config?.fps || 25 };

    const filteredCues = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return cues.slice(0, 120);
        return cues.filter(cue => String(cue.text || '').toLowerCase().includes(query)).slice(0, 120);
    }, [cues, search]);

    useEffect(() => {
        refreshProjects();
        refreshNative();
    }, []);

    useEffect(() => {
        const requested = config?.captions?.activeProjectId;
        if (requested && requested !== activeProjectId) loadProject(requested);
    }, [config?.captions?.activeProjectId]);

    async function refreshProjects() {
        if (!window.captionAPI?.listProjects) return;
        setProjects(await window.captionAPI.listProjects());
    }

    async function refreshNative() {
        if (!window.captionAPI?.detectNativeText) return;
        setNativeState(await window.captionAPI.detectNativeText({ templateName: captionConfig.nativeTemplateName }));
    }

    function commitCues(nextCues, nextAnalysis = null, nextWarnings = []) {
        setHistory(prev => [...prev.slice(-20), cloneCues(cues)]);
        setRedo([]);
        setCues(cloneCues(nextCues));
        setAnalysis(nextAnalysis || summarizeCues(nextCues));
        setWarnings(nextWarnings || []);
    }

    async function handleImport() {
        setStatus('Importing');
        const result = await window.captionAPI.import();
        const nextCues = result?.cues || [];
        commitCues(nextCues, result?.analysis);
        setStatus(nextCues.length ? `${nextCues.length} cues imported` : 'No captions found');
    }

    async function handleParseText() {
        const text = rawText.trim();
        if (!text) return;
        setStatus('Parsing');
        const result = await window.captionAPI.parse({ text });
        const nextCues = result?.cues || [];
        commitCues(nextCues, result?.analysis);
        setStatus(nextCues.length ? `${nextCues.length} cues parsed` : 'No timestamped cues found');
    }

    async function handleRegroup() {
        if (!cues.length) return;
        setStatus('Regrouping');
        const result = await window.captionAPI.regroup({
            cues,
            options: { mode: regroupMode, maxWords, maxChars, maxGapSeconds: 0.8 }
        });
        commitCues(result?.cues || [], result?.analysis, result?.warnings || []);
        setStatus(result?.cues?.length ? `${result.cues.length} grouped captions` : 'No grouped captions');
        await onConfigChange?.({ captions: { defaultRegroupMode: regroupMode } });
    }

    function updateCue(index, patch) {
        const next = cloneCues(cues);
        next[index] = { ...next[index], ...patch };
        commitCues(next);
    }

    function deleteCue(index) {
        commitCues(cues.filter((_, i) => i !== index));
    }

    function mergeCue(index) {
        if (index <= 0) return;
        const next = cloneCues(cues);
        const previous = next[index - 1];
        const current = next[index];
        next[index - 1] = {
            ...previous,
            end: current.end,
            text: `${previous.text} ${current.text}`.trim(),
            words: [...(previous.words || []), ...(current.words || [])]
        };
        next.splice(index, 1);
        commitCues(next);
    }

    function splitCue(index) {
        const cue = cues[index];
        const words = String(cue?.text || '').split(/\s+/).filter(Boolean);
        if (words.length < 2) return;
        const midpoint = Math.ceil(words.length / 2);
        const splitTime = cue.start + (cue.end - cue.start) * (midpoint / words.length);
        const next = cloneCues(cues);
        next.splice(index, 1,
            { ...cue, end: Number(splitTime.toFixed(3)), text: words.slice(0, midpoint).join(' ') },
            { ...cue, id: `${cue.id || 'cue'}-b`, start: Number(splitTime.toFixed(3)), text: words.slice(midpoint).join(' ') }
        );
        commitCues(next);
    }

    function undoEdit() {
        if (!history.length) return;
        setRedo(prev => [...prev, cloneCues(cues)]);
        const previous = history[history.length - 1];
        setHistory(prev => prev.slice(0, -1));
        setCues(previous);
        setAnalysis(summarizeCues(previous));
    }

    function redoEdit() {
        if (!redo.length) return;
        setHistory(prev => [...prev, cloneCues(cues)]);
        const next = redo[redo.length - 1];
        setRedo(prev => prev.slice(0, -1));
        setCues(next);
        setAnalysis(summarizeCues(next));
    }

    async function saveProject() {
        if (!cues.length) return;
        const project = await window.captionAPI.saveProject({
            id: activeProjectId || undefined,
            title: rawText.split('\n').find(Boolean)?.slice(0, 60) || 'Caption Project',
            cues,
            style,
            outputMode,
            regroupMode,
            fitOptions: dimensions
        });
        setActiveProjectId(project.id);
        await onConfigChange?.({ captions: { activeProjectId: project.id, defaultStyle: style, defaultOutputMode: outputMode } });
        await refreshProjects();
        setStatus('Caption project saved');
    }

    async function loadProject(id) {
        if (!id) return;
        const project = await window.captionAPI.getProject(id);
        if (!project) return;
        setActiveProjectId(project.id);
        setCues(project.cues || []);
        setAnalysis(project.analysis || summarizeCues(project.cues || []));
        setStyle(project.style || style);
        setOutputMode(project.outputMode || outputMode);
        setRegroupMode(project.regroupMode || regroupMode);
        setWarnings(project.warnings || []);
        setStatus('Caption project loaded');
    }

    async function deleteProject(id) {
        if (!id) return;
        await window.captionAPI.deleteProject(id);
        if (id === activeProjectId) setActiveProjectId('');
        await refreshProjects();
    }

    async function handleStyleChange(nextStyle) {
        setStyle(nextStyle);
        await onConfigChange?.({ captions: { defaultStyle: nextStyle } });
    }

    async function handleGenerateOverlay() {
        if (!cues.length) return;
        setStatus('Building overlay prompt');
        const result = await window.captionAPI.generate({ cues, style, ...dimensions });
        setWarnings(result?.warnings || []);
        if (result?.prompt) {
            onPrompt?.(result.prompt);
            setStatus('Overlay prompt sent');
        }
    }

    async function handleNativePreview() {
        if (!cues.length) return;
        setStatus('Creating native preview');
        const result = await window.captionAPI.previewNativeText({ cues, fps: dimensions.fps, templateName: captionConfig.nativeTemplateName });
        setStatus(result?.success ? 'Native preview created' : (result?.error || result?.reason || 'Native preview unavailable'));
    }

    async function handleNativeCreate() {
        if (!cues.length) return;
        setStatus('Creating native Text+ captions');
        const result = await window.captionAPI.createNativeText({ cues, fps: dimensions.fps, templateName: captionConfig.nativeTemplateName });
        setStatus(result?.success ? 'Native Text+ captions created' : (result?.error || result?.reason || 'Native Text+ unavailable'));
    }

    function syncPlayhead(cue) {
        setStatus(`Playhead sync unavailable here. Cue starts at ${fmt(cue.start)}.`);
    }

    return (
        <div className="captions-section">
            <div className="sb-section-title">
                <span>Caption Studio</span>
                <div className="sb-actions">
                    <button className="mini-action" type="button" onClick={refreshProjects}>Refresh</button>
                    <button className="mini-action" type="button" onClick={saveProject} disabled={!cues.length}>Save</button>
                </div>
            </div>

            <section className="caption-workflow-card">
                <div className="caption-workflow-head">
                    <strong>Transcript</strong>
                    <button className="mini-action" type="button" onClick={handleImport}>Import SRT/VTT/TXT</button>
                </div>
                <textarea
                    className="tool-textarea caption-transcript-input"
                    value={rawText}
                    onChange={(event) => setRawText(event.target.value)}
                    placeholder="Paste SRT, VTT, or timestamped TXT..."
                />
                <button className="mini-action caption-parse" type="button" onClick={handleParseText} disabled={!rawText.trim()}>Parse pasted text</button>
                <div className="caption-stats-grid">
                    <div><span>Cues</span><strong>{stats.cueCount}</strong></div>
                    <div><span>Words</span><strong>{stats.wordCount}</strong></div>
                    <div><span>Span</span><strong>{stats.duration}s</strong></div>
                    <div><span>Avg</span><strong>{stats.averageWordsPerCue}</strong></div>
                </div>
            </section>

            <section className="caption-workflow-card">
                <div className="caption-workflow-head">
                    <strong>Regroup + Edit</strong>
                    <div className="caption-editor-actions">
                        <button className="mini-action" type="button" onClick={undoEdit} disabled={!history.length}>Undo</button>
                        <button className="mini-action" type="button" onClick={redoEdit} disabled={!redo.length}>Redo</button>
                    </div>
                </div>
                <div className="caption-controls caption-regroup-controls">
                    <label>
                        <span>Mode</span>
                        <select value={regroupMode} onChange={(event) => setRegroupMode(event.target.value)}>
                            {REGROUP_MODES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                        </select>
                    </label>
                    <label>
                        <span>Words</span>
                        <input type="number" min="1" max="16" value={maxWords} onChange={(event) => setMaxWords(Number(event.target.value) || 1)} />
                    </label>
                    <label>
                        <span>Chars</span>
                        <input type="number" min="8" max="80" value={maxChars} onChange={(event) => setMaxChars(Number(event.target.value) || 34)} />
                    </label>
                    <button className="mini-action" type="button" onClick={handleRegroup} disabled={!cues.length}>Regroup</button>
                </div>
                <input className="sb-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search captions" />
                {warnings.length > 0 && (
                    <div className="caption-warning-list">
                        {warnings.slice(0, 4).map((warning, index) => <div key={index}>{warning}</div>)}
                    </div>
                )}
                <div className="caption-cue-list caption-editor-list">
                    {filteredCues.map((cue) => {
                        const index = cues.findIndex(item => item.id === cue.id);
                        return (
                            <div className="caption-cue editor" key={cue.id || `${cue.start}-${cue.end}`}>
                                <div className="caption-cue-meta">
                                    <span>{fmt(cue.start)} - {fmt(cue.end)}</span>
                                    <div>
                                        <button type="button" onClick={() => syncPlayhead(cue)}>Sync</button>
                                        <button type="button" onClick={() => splitCue(index)}>Split</button>
                                        <button type="button" onClick={() => mergeCue(index)} disabled={index <= 0}>Merge</button>
                                        <button type="button" onClick={() => deleteCue(index)}>Delete</button>
                                    </div>
                                </div>
                                <textarea value={cue.text} onChange={(event) => updateCue(index, { text: event.target.value })} />
                            </div>
                        );
                    })}
                    {!cues.length && (
                        <div className="caption-empty-workflow">
                            <strong>No caption cues</strong>
                            <p>Import or paste timestamped captions to start editing.</p>
                        </div>
                    )}
                </div>
            </section>

            <section className="caption-workflow-card">
                <div className="caption-workflow-head">
                    <strong>Output</strong>
                    <span className="caption-status">{status}</span>
                </div>
                <div className="caption-output-toggle" role="tablist" aria-label="Caption output mode">
                    <button type="button" className={outputMode === 'overlay' ? 'active' : ''} onClick={() => setOutputMode('overlay')}>Transparent Overlay</button>
                    <button type="button" className={outputMode === 'nativeText' ? 'active' : ''} onClick={() => setOutputMode('nativeText')}>Native Text+</button>
                </div>
                <div className="caption-style-grid">
                    {CAPTION_STYLES.map(([id, label, desc]) => (
                        <button key={id} type="button" className={'caption-style-card' + (style === id ? ' active' : '')} onClick={() => handleStyleChange(id)}>
                            <strong>{label}</strong>
                            <span>{desc}</span>
                        </button>
                    ))}
                </div>
                <div className="caption-output-panel">
                    {outputMode === 'overlay' ? (
                        <>
                            <div className="rough-help">Transparent overlay output uses the AI HTML renderer. Vertical safe zone is {verticalSafe ? 'on' : 'off'}.</div>
                            <button className="btn-primary compact" type="button" onClick={handleGenerateOverlay} disabled={!cues.length}>Send overlay prompt</button>
                        </>
                    ) : (
                        <>
                            <div className={nativeState?.ready ? 'rough-transcript-state ready' : 'rough-warning'}>
                                {nativeState?.ready ? 'Native Text+ ready' : (nativeState?.reason || 'Native Text+ detection pending')}
                            </div>
                            <div className="caption-controls">
                                <label>
                                    <span>Template</span>
                                    <input value={captionConfig.nativeTemplateName || 'Resolve AI Caption'} readOnly />
                                </label>
                            </div>
                            <div className="rough-button-row">
                                <button className="mini-action" type="button" onClick={refreshNative}>Check</button>
                                <button className="mini-action" type="button" onClick={handleNativePreview} disabled={!nativeState?.ready || !cues.length}>Preview</button>
                                <button className="btn-primary compact" type="button" onClick={handleNativeCreate} disabled={!nativeState?.ready || !cues.length}>Create Text+</button>
                            </div>
                        </>
                    )}
                </div>
            </section>

            <section className="caption-workflow-card">
                <div className="caption-workflow-head">
                    <strong>Projects</strong>
                    <span>{projects.length} saved</span>
                </div>
                <div className="caption-project-list">
                    {projects.slice(0, 8).map(project => (
                        <button key={project.id} type="button" className={'caption-project-row' + (project.id === activeProjectId ? ' active' : '')} onClick={() => loadProject(project.id)}>
                            <span>{project.title || 'Caption Project'}</span>
                            <small>{project.cueCount} cues / {project.outputMode || 'overlay'}</small>
                            <em onClick={(event) => { event.stopPropagation(); deleteProject(project.id); }}>Delete</em>
                        </button>
                    ))}
                    {!projects.length && <div className="sb-empty">No saved caption projects yet.</div>}
                </div>
            </section>
        </div>
    );
}
