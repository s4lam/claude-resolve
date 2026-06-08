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

function nativeResultSummary(result, fallback) {
    const info = String(`${result?.stdout || ''}\n${result?.stderr || ''}`)
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => /^INFO:/i.test(line))
        .map(line => line.replace(/^INFO:\s*/i, ''))
        .slice(-2)
        .join(' / ');
    const counts = [
        result?.cueCount !== undefined ? `UI ${result.cueCount}` : '',
        result?.ipcCueCount !== undefined ? `IPC ${result.ipcCueCount}` : '',
        result?.luaReceivedCueCount !== undefined && result.luaReceivedCueCount !== null ? `Lua ${result.luaReceivedCueCount}` : '',
        result?.created !== undefined && result.created !== null ? `Created ${result.created}` : ''
    ].filter(Boolean).join(' / ');
    if (result?.success) {
        return `${fallback}${counts ? ` - ${counts}` : ''}${info ? ` - ${info}` : ''}`;
    }
    return `${result?.error || result?.reason || info || 'Native Text+ unavailable'}${counts ? ` - ${counts}` : ''}`;
}

function nativeDurationUnsupported(result) {
    return Boolean(result?.durationUnsupported)
        || /ignored scripted duration trimming|Native per-cue Text\+ creation is unavailable/i.test(String(result?.error || result || ''));
}

export default function SidebarCaptions({ config, onConfigChange, onPrompt }) {
    const captionConfig = config?.captions || {};
    const [rawText, setRawText] = useState('');
    const [sourceFormat, setSourceFormat] = useState('');
    const [importedRawText, setImportedRawText] = useState('');
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
    const [lastPreparedNativePayload, setLastPreparedNativePayload] = useState(null);
    const [nativeDiagnostics, setNativeDiagnostics] = useState(null);
    const [nativeTextUnsupported, setNativeTextUnsupported] = useState(false);
    const [timelineContext, setTimelineContext] = useState(null);
    const [overlayBusy, setOverlayBusy] = useState(false);
    const [history, setHistory] = useState([]);
    const [redo, setRedo] = useState([]);

    const stats = analysis || summarizeCues(cues);
    const verticalSafe = captionConfig.verticalSafe !== false;
    const dimensions = verticalSafe ? { width: 1080, height: 1920, fps: 30 } : { width: config?.width || 1920, height: config?.height || 1080, fps: config?.fps || 25 };
    const nativeCueCount = cues.length;
    const preparedNativeCueCount = lastPreparedNativePayload?.cues?.length || 0;
    const nativeTextActionDisabled = !nativeState?.ready || (!nativeCueCount && !preparedNativeCueCount);
    const nativeCueStatus = nativeCueCount
        ? `Ready: UI ${nativeCueCount} cues${preparedNativeCueCount ? ` / prepared ${preparedNativeCueCount}` : ''}. Cue times are relative to the selected clip.`
        : 'Not ready: 0 cues. Import SRT/VTT or paste timestamped captions first. Untimestamped transcript text cannot be placed on a timeline.';

    const filteredCues = useMemo(() => {
        const query = search.trim().toLowerCase();
        if (!query) return cues.slice(0, 120);
        return cues.filter(cue => String(cue.text || '').toLowerCase().includes(query)).slice(0, 120);
    }, [cues, search]);

    useEffect(() => {
        refreshProjects();
        refreshNative();
        refreshTimelineContext();
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
        setStatus('Checking Native Text+ setup');
        if (!window.captionAPI?.detectNativeText) {
            setStatus('Native Text+ API is unavailable. Reinstall or reopen Resolve AI after updating.');
            return;
        }
        try {
            const result = await window.captionAPI.detectNativeText({ templateName: captionConfig.nativeTemplateName });
            setNativeState(result);
            setNativeDiagnostics(prev => ({
                ...(prev || {}),
                bridgeVersion: result?.bridgeVersion || '',
                ipcLoaded: Boolean(result?.ipcFile?.exists),
                luaLoaded: Boolean(result?.luaFile?.exists),
                restartRequired: Boolean(result?.restartRequired)
            }));
            setNativeTextUnsupported(false);
            setStatus(result?.ready ? 'Native Text+ bridge ready' : (result?.reason || 'Native Text+ unavailable'));
        } catch (error) {
            setStatus(error?.message || 'Native Text+ check failed');
        }
    }

    async function refreshTimelineContext() {
        if (!window.timelineAPI?.getContext) return null;
        try {
            const context = await window.timelineAPI.getContext();
            setTimelineContext(context);
            return context;
        } catch (_error) {
            return null;
        }
    }

    function timelineBaseFrame(context = timelineContext) {
        const selected = Array.isArray(context?.selectedClips) ? context.selectedClips[0] : null;
        if (Number.isFinite(Number(selected?.startFrame))) return Number(selected.startFrame);
        if (Number.isFinite(Number(context?.playheadFrame))) return Number(context.playheadFrame);
        return 0;
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
        const nextText = result?.rawText || result?.text || '';
        setImportedRawText(nextText);
        setSourceFormat(result?.format || '');
        if (nextText) setRawText(nextText);
        commitCues(nextCues, result?.analysis);
        setLastPreparedNativePayload({ cues: cloneCues(nextCues), rawText: nextText, format: result?.format || '' });
        setNativeDiagnostics(prev => ({ ...(prev || {}), uiCueCount: nextCues.length, preparedCueCount: nextCues.length }));
        setStatus(nextCues.length ? `${nextCues.length} cues imported` : 'No captions found');
    }

    async function handleParseText() {
        const text = rawText.trim();
        if (!text) return;
        setStatus('Parsing');
        const result = await window.captionAPI.parse({ text, format: sourceFormat });
        const nextCues = result?.cues || [];
        setImportedRawText(text);
        setSourceFormat(result?.format || sourceFormat || '');
        commitCues(nextCues, result?.analysis);
        setLastPreparedNativePayload({ cues: cloneCues(nextCues), rawText: text, format: result?.format || sourceFormat || '' });
        setNativeDiagnostics(prev => ({ ...(prev || {}), uiCueCount: nextCues.length, preparedCueCount: nextCues.length }));
        setStatus(nextCues.length ? `${nextCues.length} cues parsed` : 'No timestamped cues found');
    }

    async function prepareCaptionCuesForNative(actionLabel = 'Native Text+') {
        const existing = cloneCues(cues);
        if (existing.length) {
            const prepared = { cues: existing, rawText: importedRawText || rawText, format: sourceFormat };
            setLastPreparedNativePayload(prepared);
            setNativeDiagnostics(prev => ({ ...(prev || {}), uiCueCount: existing.length, preparedCueCount: existing.length }));
            return prepared;
        }
        const text = (rawText || importedRawText || '').trim();
        if (!text) {
            setStatus(`Import an SRT/VTT file or paste timestamped captions before using ${actionLabel}.`);
            return { cues: [], rawText: '', format: sourceFormat };
        }
        if (!window.captionAPI?.parse) {
            setStatus('Caption parser is unavailable. Reinstall or reopen Resolve AI after updating.');
            return { cues: [], rawText: text, format: sourceFormat };
        }
        setStatus('Parsing transcript for Native Text+');
        try {
            const result = await window.captionAPI.parse({ text, format: sourceFormat });
            const nextCues = result?.cues || [];
            if (!nextCues.length) {
                setStatus('No timestamped cues found. Import SRT/VTT or paste timestamped captions first.');
                return { cues: [], rawText: text, format: result?.format || sourceFormat };
            }
            setImportedRawText(text);
            setSourceFormat(result?.format || sourceFormat || '');
            commitCues(nextCues, result?.analysis);
            const prepared = { cues: cloneCues(nextCues), rawText: text, format: result?.format || sourceFormat };
            setLastPreparedNativePayload(prepared);
            setNativeDiagnostics(prev => ({ ...(prev || {}), uiCueCount: nextCues.length, preparedCueCount: nextCues.length }));
            setStatus(`${nextCues.length} cues parsed`);
            return prepared;
        } catch (error) {
            setStatus(error?.message || 'Caption parsing failed');
            return { cues: [], rawText: text, format: sourceFormat };
        }
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
            rawText: importedRawText || rawText,
            format: sourceFormat,
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
        setRawText(project.rawText || '');
        setImportedRawText(project.rawText || '');
        setSourceFormat(project.format || '');
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
        if (!window.captionAPI?.buildOverlayRender || !window.overlayAPI?.renderMov) {
            setStatus('Caption renderer API is unavailable. Reopen Resolve AI after updating.');
            return;
        }
        setOverlayBusy(true);
        setStatus('Rendering caption overlay');
        try {
            const context = await refreshTimelineContext();
            const result = await window.captionAPI.buildOverlayRender({ cues, style, ...dimensions, timelineContext: context || {} });
            setWarnings(result?.warnings || []);
            if (!result?.success) {
                setStatus(result?.error || 'Caption overlay build failed');
                return;
            }
            const renderResult = await window.overlayAPI.renderMov({
                html: result.html,
                name: 'Caption_Overlay',
                fps: result.metadata?.fps || dimensions.fps,
                width: result.metadata?.width || dimensions.width,
                height: result.metadata?.height || dimensions.height,
                metadata: result.metadata
            });
            setStatus(renderResult?.success
                ? `Overlay rendered${renderResult.placed ? ' and added to timeline' : ''}`
                : (renderResult?.error || 'Overlay render failed'));
            if (renderResult?.warning) setWarnings(prev => [...new Set([...(prev || []), renderResult.warning])]);
        } catch (error) {
            setStatus(error?.message || 'Caption overlay render failed');
        } finally {
            setOverlayBusy(false);
        }
    }

    async function handleNativePreview() {
        const prepared = await prepareCaptionCuesForNative('Native Text+ preview');
        if (!prepared.cues.length) {
            return;
        }
        if (!nativeState?.ready) {
            setStatus(nativeState?.reason || 'Run Check first. Native Text+ bridge is not ready.');
            return;
        }
        if (!window.captionAPI?.previewNativeText) {
            setStatus('Native Text+ preview API is unavailable. Reinstall or reopen Resolve AI after updating.');
            return;
        }
        setStatus('Creating native preview');
        try {
            const context = await refreshTimelineContext();
            const timelineFps = Number(context?.fps) || dimensions.fps;
            const result = await window.captionAPI.previewNativeText({ ...prepared, fps: timelineFps, templateName: captionConfig.nativeTemplateName, recordFrame: timelineBaseFrame(context) });
            setNativeDiagnostics(prev => ({ ...(prev || {}), uiCueCount: prepared.cues.length, preparedCueCount: prepared.cues.length, ipcCueCount: result?.ipcCueCount, luaReceivedCueCount: result?.luaReceivedCueCount, created: result?.created, debugPath: result?.debugPath, wrapperPath: result?.wrapperPath, bridgeVersion: result?.bridgeVersion || prev?.bridgeVersion, lastResult: result }));
            if (nativeDurationUnsupported(result)) setWarnings(prev => [...new Set([...(prev || []), 'Resolve reported an old duration-trim failure. Restart Resolve AI and try the template append bridge.'])]);
            setStatus(nativeResultSummary(result, 'Native preview created'));
        } catch (error) {
            setStatus(error?.message || 'Native preview failed');
        }
    }

    async function handleNativeCreate() {
        const prepared = await prepareCaptionCuesForNative('Native Text+ captions');
        if (!prepared.cues.length) {
            return;
        }
        if (!nativeState?.ready) {
            setStatus(nativeState?.reason || 'Run Check first. Native Text+ bridge is not ready.');
            return;
        }
        if (!window.captionAPI?.createNativeText) {
            setStatus('Native Text+ create API is unavailable. Reinstall or reopen Resolve AI after updating.');
            return;
        }
        setStatus('Creating native Text+ captions');
        try {
            const context = await refreshTimelineContext();
            const timelineFps = Number(context?.fps) || dimensions.fps;
            const result = await window.captionAPI.createNativeText({ ...prepared, fps: timelineFps, templateName: captionConfig.nativeTemplateName, recordFrame: timelineBaseFrame(context) });
            setNativeDiagnostics(prev => ({ ...(prev || {}), uiCueCount: prepared.cues.length, preparedCueCount: prepared.cues.length, ipcCueCount: result?.ipcCueCount, luaReceivedCueCount: result?.luaReceivedCueCount, created: result?.created, debugPath: result?.debugPath, wrapperPath: result?.wrapperPath, bridgeVersion: result?.bridgeVersion || prev?.bridgeVersion, lastResult: result }));
            if (nativeDurationUnsupported(result)) setWarnings(prev => [...new Set([...(prev || []), 'Resolve reported an old duration-trim failure. Restart Resolve AI and try the template append bridge.'])]);
            setStatus(nativeResultSummary(result, 'Native Text+ captions created'));
        } catch (error) {
            setStatus(error?.message || 'Native Text+ creation failed');
        }
    }

    async function handleNativeSelfTest() {
        if (!nativeState?.ready) {
            setStatus(nativeState?.reason || 'Run Check first. Native Text+ bridge is not ready.');
            return;
        }
        if (!window.captionAPI?.selfTestNativeText) {
            setStatus('Native Text+ self-test API is unavailable. Reinstall or reopen Resolve AI after updating.');
            return;
        }
        setStatus('Running native caption self-test');
        try {
            const context = await refreshTimelineContext();
            const timelineFps = Number(context?.fps) || dimensions.fps;
            const result = await window.captionAPI.selfTestNativeText({ fps: timelineFps, templateName: captionConfig.nativeTemplateName, recordFrame: timelineBaseFrame(context) });
            setNativeDiagnostics(prev => ({ ...(prev || {}), uiCueCount: 2, preparedCueCount: 2, ipcCueCount: result?.ipcCueCount, luaReceivedCueCount: result?.luaReceivedCueCount, created: result?.created, debugPath: result?.debugPath, wrapperPath: result?.wrapperPath, bridgeVersion: result?.bridgeVersion || prev?.bridgeVersion, lastResult: result }));
            setNativeTextUnsupported(false);
            setStatus(nativeResultSummary(result, 'Native self-test created'));
        } catch (error) {
            setStatus(error?.message || 'Native self-test failed');
        }
    }

    async function handleCopyNativeDebug() {
        const debug = {
            status,
            nativeState,
            nativeDiagnostics,
            lastPreparedCueCount: lastPreparedNativePayload?.cues?.length || 0
        };
        try {
            await navigator.clipboard.writeText(JSON.stringify(debug, null, 2));
            setStatus('Native debug copied');
        } catch (_error) {
            setStatus('Could not copy native debug');
        }
    }

    async function handleNativeTemplateHelp() {
        setStatus('Checking Native Text+ template setup');
        if (!window.captionAPI?.importNativeTemplate) {
            setStatus('Native Text+ template setup is unavailable. Reinstall or reopen Resolve AI after updating.');
            return;
        }
        try {
            const result = await window.captionAPI.importNativeTemplate();
            setStatus(result?.message || result?.error || result?.reason || 'Native caption placeholder source ready.');
            if (result?.templateAssetPath) {
                setNativeDiagnostics(prev => ({ ...(prev || {}), templateAssetPath: result.templateAssetPath }));
            }
        } catch (error) {
            setStatus(error?.message || 'Native Text+ template setup failed');
        }
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
                            <div className="rough-help">Transparent overlay renders the caption span only, then places it at the first cue time relative to the selected clip. Vertical safe zone is {verticalSafe ? 'on' : 'off'}.</div>
                            <button className="btn-primary compact" type="button" onClick={handleGenerateOverlay} disabled={!cues.length || overlayBusy}>{overlayBusy ? 'Rendering...' : 'Render + Add to Timeline'}</button>
                            {timelineContext?.selectedClips?.[0] ? (
                                <div className="rough-meta-line">Placement: selected clip {timelineContext.selectedClips[0].name || 'clip'}.</div>
                            ) : (
                                <div className="rough-warning">No selected clip detected. Placement falls back to the current playhead.</div>
                            )}
                        </>
                    ) : (
                        <>
                            <div className={nativeTextUnsupported ? 'rough-warning' : (nativeState?.ready ? 'rough-transcript-state ready' : 'rough-warning')}>
                                {nativeTextUnsupported
                                    ? 'Native Text+ reported an old duration-trim failure. Restart Resolve AI and run Check.'
                                    : nativeState?.ready
                                        ? 'Native bridge ready. Text+ uses a Media Pool template and AppendToTimeline per cue.'
                                        : (nativeState?.reason || 'Native Text+ detection pending')}
                            </div>
                            {nativeTextUnsupported && (
                                <div className="rough-help">The rebuilt Text+ path does not trim inserted titles. It appends a named template as timed clipInfo.</div>
                            )}
                            {nativeState?.restartRequired && (
                                <div className="rough-warning">Restart DaVinci Resolve to load the updated Native Text+ bridge.</div>
                            )}
                            <div className="rough-meta-line">
                                Native bridge: {nativeState?.bridgeVersion || 'unknown'} / IPC {nativeState?.ipcFile?.exists ? 'loaded' : 'missing'} / Lua {nativeState?.luaFile?.exists ? 'loaded' : 'missing'}
                            </div>
                            <div className="caption-controls">
                                <label>
                                    <span>Template</span>
                                    <input value={captionConfig.nativeTemplateName || 'Resolve AI Caption'} readOnly />
                                </label>
                            </div>
                            <div className={nativeCueCount ? 'rough-transcript-state ready' : 'rough-warning'}>
                                {nativeCueStatus}
                            </div>
                            <div className="rough-button-row">
                                <button className="mini-action" type="button" onClick={refreshNative}>Check</button>
                                <button className="mini-action" type="button" onClick={handleNativeSelfTest}>Run self-test</button>
                                <button className="mini-action" type="button" onClick={handleNativeTemplateHelp}>Template setup</button>
                                <button className="mini-action" type="button" onClick={handleNativePreview} disabled={nativeTextActionDisabled}>Preview</button>
                                <button className="btn-primary compact" type="button" onClick={handleNativeCreate} disabled={nativeTextActionDisabled}>Create Text+ from cues</button>
                            </div>
                            {nativeDiagnostics && (
                                <div className="rough-meta-line">
                                    UI {nativeDiagnostics.uiCueCount ?? nativeCueCount} / IPC {nativeDiagnostics.ipcCueCount ?? '-'} / Lua {nativeDiagnostics.luaReceivedCueCount ?? '-'} / Created {nativeDiagnostics.created ?? '-'}
                                </div>
                            )}
                            {nativeDiagnostics?.debugPath && (
                                <button className="mini-action" type="button" onClick={handleCopyNativeDebug}>Copy Native Debug</button>
                            )}
                            {status && <div className="caption-inline-status">{status}</div>}
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
