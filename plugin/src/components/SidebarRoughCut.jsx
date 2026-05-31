import React, { useEffect, useMemo, useRef, useState } from 'react';

const GOAL_CHIPS = [
    ['highlights', 'Keep the most important and watchable highlights.'],
    ['funny', 'Keep funny reactions, jokes, and surprising moments.'],
    ['tight edit', 'Remove dead air, repeats, and unclear sections.'],
    ['story', 'Keep the strongest story beats with clear progression.']
];

const SHORTS_GOAL_CHIPS = [
    ['viral hook', 'Find standalone Shorts with a strong hook, context, payoff, and clean ending.'],
    ['funny', 'Find funny or surprising standalone moments that could work as short clips.'],
    ['story beat', 'Find emotional or important story sections that make sense without the full video.'],
    ['useful lesson', 'Find clear educational takeaways that can stand alone as Shorts.']
];

const HANDLE_OPTIONS = [0.25, 0.5, 1, 2];
const TARGET_OPTIONS = [
    ['none', 'No target'],
    ['30', '30s'],
    ['60', '60s'],
    ['90', '90s'],
    ['custom', 'Custom']
];

const FALLBACK_MESSAGE = 'Direct IntelliScript API was not found in this Resolve version. You can still use AI Rough Cut, or export a script and run native IntelliScript manually inside Resolve.';

function formatSeconds(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'unavailable';
    if (number >= 60) return `${Math.floor(number / 60)}m ${Math.round(number % 60)}s`;
    return `${number.toFixed(number < 10 ? 1 : 0)}s`;
}

function clipTitle(clip) {
    if (!clip) return 'No clip selected';
    return clip.name || clip.fileName || 'Selected clip';
}

function planSummaryFromSaved(savedPlan, clip, handleSeconds) {
    const ranges = savedPlan?.normalizedRanges || [];
    const estimated = ranges.reduce((sum, range) => sum + Math.max(0, Number(range.end) - Number(range.start)), 0);
    return {
        originalDurationSeconds: Number(clip?.durationSeconds || 0),
        estimatedDurationSeconds: Number(estimated.toFixed(3)),
        keptSections: ranges.length,
        handleSeconds: Number(savedPlan?.handleSeconds ?? handleSeconds) || 0,
        targetDurationSeconds: Number(savedPlan?.targetDurationSeconds || 0) || null,
        timelineName: `AI Rough Cut - ${clipTitle(clip)}`
    };
}

function latestJsonAvailable(text) {
    const value = String(text || '');
    return value.includes('{') && (value.includes('ranges') || value.includes('clips'));
}

function detectTranscriptOffset(analysis, clip) {
    const firstStart = Number(analysis?.firstStart || 0);
    const lastEnd = Number(analysis?.lastEnd || 0);
    const span = Math.max(0, lastEnd - firstStart);
    const clipDuration = Number(clip?.durationSeconds || 0);
    if (firstStart >= 3600) return Math.floor(firstStart / 3600) * 3600;
    if (clipDuration > 0 && lastEnd > clipDuration * 1.5 && span <= clipDuration * 1.25) return firstStart;
    return 0;
}

function transcriptDurationFallback(analysis, offsetSeconds) {
    const lastEnd = Number(analysis?.lastEnd || 0);
    const offset = Number(offsetSeconds || 0);
    return Math.max(0, lastEnd - offset);
}

function formatPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'n/a';
    return `${Math.round(number * 100)}%`;
}

function shortReviewState(candidate) {
    if (candidate?.durationFit === 'target' && Number(candidate?.structureScore || 0) >= 0.75) return 'Ready';
    if (candidate?.durationFit === 'short') return 'Short';
    if (Number(candidate?.structureScore || 0) < 0.75) return 'Needs review';
    return 'Review';
}

function publishText(candidate) {
    const publish = candidate?.publish || {};
    return [
        publish.title || candidate?.title,
        '',
        publish.description || candidate?.hook || candidate?.reason,
        '',
        (publish.hashtags || []).join(' ')
    ].filter(line => line !== undefined && line !== null).join('\n');
}

export default function SidebarRoughCut({ config, latestAssistantText, onPrompt }) {
    const [clipState, setClipState] = useState({ state: 'checking', message: 'Checking Media Pool selection', clip: null });
    const [features, setFeatures] = useState(null);
    const [plans, setPlans] = useState([]);
    const [mode, setMode] = useState('shorts');
    const [transcript, setTranscript] = useState(null);
    const [pastedTranscript, setPastedTranscript] = useState('');
    const [goal, setGoal] = useState('Keep the most important, funny, and watchable parts while removing dead air and repeats.');
    const [targetMode, setTargetMode] = useState('60');
    const [customTarget, setCustomTarget] = useState('');
    const [handleSeconds, setHandleSeconds] = useState(0.5);
    const [jsonDraft, setJsonDraft] = useState('');
    const [planData, setPlanData] = useState(null);
    const [shortsData, setShortsData] = useState(null);
    const [selectedShorts, setSelectedShorts] = useState({});
    const [status, setStatus] = useState('');
    const [prepareResult, setPrepareResult] = useState(null);
    const [addMarkers, setAddMarkers] = useState(true);
    const [transcribeBeforeNative, setTranscribeBeforeNative] = useState(false);
    const [awaitingPlan, setAwaitingPlan] = useState(false);
    const [applyResult, setApplyResult] = useState(null);
    const lastAutoValidated = useRef('');

    const clip = clipState.clip;
    const transcriptOffsetSeconds = useMemo(() => detectTranscriptOffset(transcript?.analysis, clip), [transcript, clip]);
    const validationClipDuration = useMemo(() => {
        const clipDuration = Number(clip?.durationSeconds || 0);
        const transcriptDuration = transcriptDurationFallback(transcript?.analysis, transcriptOffsetSeconds);
        return clipDuration > 0 ? Math.max(clipDuration, transcriptDuration) : transcriptDuration;
    }, [clip, transcript, transcriptOffsetSeconds]);
    const targetDurationSeconds = useMemo(() => {
        if (targetMode === 'none') return null;
        if (targetMode === 'custom') {
            const value = Number(customTarget);
            return Number.isFinite(value) && value > 0 ? value : null;
        }
        return Number(targetMode);
    }, [targetMode, customTarget]);
    const activeTargetLabel = targetDurationSeconds ? formatSeconds(targetDurationSeconds) : 'none';
    const canRoughCut = Boolean(clip && clip.fps && clip.sourceStartFrame !== null && clip.sourceStartFrame !== undefined && transcript?.hasTiming);
    const canPrepareNative = Boolean(transcript?.storyText || transcript?.cues?.length);
    const latestHasJson = latestJsonAvailable(latestAssistantText);

    useEffect(() => {
        refreshAll();
    }, []);

    useEffect(() => {
        if (!awaitingPlan || !canRoughCut || !latestHasJson) return;
        if (latestAssistantText === lastAutoValidated.current) return;
        lastAutoValidated.current = latestAssistantText;
        if (mode === 'shorts') validateShortsJson(latestAssistantText, { auto: true });
        else validateJson(latestAssistantText, { auto: true });
    }, [awaitingPlan, canRoughCut, latestHasJson, latestAssistantText, mode]);

    async function refreshAll() {
        await Promise.all([refreshClip(), refreshFeatures(), refreshPlans()]);
    }

    async function refreshClip() {
        setClipState(prev => ({ ...prev, state: 'checking', message: 'Checking Media Pool selection' }));
        try {
            const result = await window.roughCutAPI.getSelectedMedia();
            setClipState(result || { state: 'unavailable', message: 'Resolve selection unavailable' });
        } catch {
            setClipState({ state: 'unavailable', message: 'Resolve selection unavailable', clip: null });
        }
    }

    async function refreshFeatures() {
        try {
            setFeatures(await window.roughCutAPI.detectFeatures());
        } catch {
            setFeatures({ directIntelliScriptAvailable: false, fallbackMessage: FALLBACK_MESSAGE });
        }
    }

    async function refreshPlans() {
        try {
            setPlans(await window.roughCutAPI.listPlans());
        } catch {
            setPlans([]);
        }
    }

    function setTransientStatus(value, timeout = 2200) {
        setStatus(value);
        if (timeout) setTimeout(() => setStatus(''), timeout);
    }

    async function importTranscript() {
        setTransientStatus('Importing', 0);
        const result = await window.roughCutAPI.importTranscript();
        if (result?.canceled) {
            setTransientStatus('');
            return;
        }
        setTranscript(result);
        setPlanData(null);
        setShortsData(null);
        setTransientStatus(result?.hasTiming ? `${result.cues.length} timestamped cues` : 'No rough-cut timings');
    }

    async function parsePastedTranscript() {
        if (!pastedTranscript.trim()) return;
        setTransientStatus('Parsing transcript', 0);
        const result = await window.roughCutAPI.importTranscript({
            text: pastedTranscript,
            format: pastedTranscript.trim().toUpperCase().startsWith('WEBVTT') ? 'vtt' : 'txt'
        });
        setTranscript(result);
        setPlanData(null);
        setShortsData(null);
        setTransientStatus(result?.hasTiming ? `${result.cues.length} timestamped cues` : 'Story text only');
    }

    async function requestPlan(regenerate = false) {
        if (!canRoughCut) {
            setTransientStatus(transcript?.hasTiming ? 'Select one ready Media Pool clip' : 'Import timestamped transcript');
            return;
        }
        setTransientStatus(regenerate ? 'Regenerating plan' : 'Building prompt', 0);
        try {
            const payload = {
                cues: transcript.cues,
                transcriptHash: transcript.transcriptHash,
                goal,
                targetDurationSeconds,
                handleSeconds,
                transcriptOffsetSeconds,
                clip
            };
            const result = mode === 'shorts'
                ? await window.roughCutAPI.buildShortsPlan({ ...payload, maxClips: 6 })
                : await window.roughCutAPI.buildCutPlan(payload);
            if (result?.prompt) {
                const accepted = onPrompt(result.prompt, {
                    displayText: regenerate
                        ? `${mode === 'shorts' ? 'Regenerate Shorts' : 'Regenerate rough cut'}: ${goal}`
                        : result.displayText,
                    skipSessionContext: true
                });
                setAwaitingPlan(accepted !== false);
                setTransientStatus(accepted === false ? 'Finish current run first' : 'Waiting for AI JSON');
            }
        } catch {
            setTransientStatus('Plan request failed');
        }
    }

    async function validateJson(text, options = {}) {
        if (!String(text || '').trim()) return;
        if (!clip) {
            setTransientStatus('Refresh selected clip first');
            return;
        }
        setTransientStatus('Validating JSON', 0);
        try {
            const result = await window.roughCutAPI.validateCutPlan({
                text,
                clip,
                transcriptHash: transcript?.transcriptHash,
                handleSeconds,
                transcriptOffsetSeconds,
                clipDurationSeconds: validationClipDuration,
                targetDurationSeconds,
                save: true
            });
            if (!result?.success) {
                setPlanData(result);
                setAwaitingPlan(false);
                setTransientStatus(result?.errors?.[0] || 'Invalid cut plan');
                return;
            }
            setPlanData(result);
            setShortsData(null);
            setApplyResult(null);
            setAwaitingPlan(false);
            await refreshPlans();
            setTransientStatus(options.auto ? `${result.normalizedRanges.length} keep ranges ready. Review, then apply.` : `${result.normalizedRanges.length} keep ranges ready`);
        } catch {
            setAwaitingPlan(false);
            setTransientStatus('Validation failed');
        }
    }

    async function validateShortsJson(text, options = {}) {
        if (!String(text || '').trim()) return;
        if (!clip) {
            setTransientStatus('Refresh selected clip first');
            return;
        }
        setTransientStatus('Validating Shorts', 0);
        try {
            const result = await window.roughCutAPI.validateShortsPlan({
                text,
                clip,
                transcriptHash: transcript?.transcriptHash,
                handleSeconds,
                transcriptOffsetSeconds,
                clipDurationSeconds: validationClipDuration,
                targetDurationSeconds,
                maxClips: 6
            });
            if (!result?.success) {
                setShortsData(result);
                setAwaitingPlan(false);
                setTransientStatus(result?.errors?.[0] || 'Invalid Shorts plan');
                return;
            }
            const selected = {};
            result.clips.forEach(candidate => { selected[candidate.index] = true; });
            setShortsData(result);
            setSelectedShorts(selected);
            setPlanData(null);
            setApplyResult(null);
            setAwaitingPlan(false);
            setTransientStatus(options.auto ? `${result.clips.length} Shorts ready. Pick candidates, then create timelines.` : `${result.clips.length} Shorts candidates ready`);
        } catch {
            setAwaitingPlan(false);
            setTransientStatus('Shorts validation failed');
        }
    }

    async function applyPlan() {
        if (!planData?.success) return;
        setTransientStatus('Creating timeline', 0);
        try {
            const result = await window.roughCutAPI.applyCutPlan({
                planId: planData.savedPlan?.id,
                normalizedRanges: planData.normalizedRanges,
                timelineName: planData.timelineName,
                addMarkers,
                includeAudio: true
            });
            setApplyResult(result);
            if (result?.success) {
                const itemText = result.appendedItems ? ` / ${result.appendedItems} timeline items` : '';
                setTransientStatus(`Created ${result.timelineName}${itemText}`, 5200);
            } else {
                setTransientStatus(result?.error || 'Timeline creation failed', 4200);
            }
        } catch (err) {
            setApplyResult({ success: false, error: err?.message || 'Timeline creation failed' });
            setTransientStatus(err?.message || 'Timeline creation failed', 4200);
        }
    }

    async function applyShorts() {
        if (!shortsData?.success) return;
        const selectedIndexes = Object.entries(selectedShorts)
            .filter(([, value]) => value)
            .map(([key]) => Number(key));
        if (!selectedIndexes.length) {
            setTransientStatus('Select at least one Short');
            return;
        }
        setTransientStatus('Creating Shorts timelines', 0);
        try {
            const result = await window.roughCutAPI.applyShortsPlan({
                clips: shortsData.clips,
                selectedIndexes,
                addMarkers,
                includeAudio: true
            });
            setApplyResult(result);
            if (result?.success) {
                setTransientStatus(`Created ${result.created} Shorts timeline${result.created === 1 ? '' : 's'}`, 5200);
            } else {
                setTransientStatus(result?.error || 'Shorts creation failed', 4200);
            }
        } catch (err) {
            setApplyResult({ success: false, error: err?.message || 'Shorts creation failed' });
            setTransientStatus(err?.message || 'Shorts creation failed', 4200);
        }
    }

    function toggleShort(index) {
        setSelectedShorts(prev => ({ ...prev, [index]: !prev[index] }));
    }

    function selectAllShorts() {
        if (!shortsData?.clips?.length) return;
        const selected = {};
        shortsData.clips.forEach(candidate => { selected[candidate.index] = true; });
        setSelectedShorts(selected);
    }

    function clearShorts() {
        setSelectedShorts({});
    }

    async function copyPublishPackage(candidate) {
        const text = publishText(candidate);
        try {
            await navigator.clipboard.writeText(text);
            setTransientStatus('Publish text copied');
        } catch {
            setTransientStatus('Could not copy publish text');
        }
    }

    function sendCaptionPrompt(candidate) {
        const prompt = [
            candidate?.publish?.captionPrompt || `Create short-form captions for: ${candidate?.title || 'selected Short'}`,
            '',
            `Clip range: ${candidate.startLabel} - ${candidate.endLabel}.`,
            'Use transparent ProRes 4444 overlay, vertical-safe typography, and emphasize hook words in the first 2 seconds.'
        ].join('\n');
        const accepted = onPrompt(prompt, {
            displayText: `Caption Short: ${candidate.title}`,
            skipSessionContext: false
        });
        setTransientStatus(accepted === false ? 'Finish current run first' : 'Caption prompt sent');
    }

    async function exportScript() {
        setTransientStatus('Exporting script', 0);
        const result = await window.roughCutAPI.exportIntelliScript({
            cues: transcript?.cues || [],
            storyText: transcript?.storyText || pastedTranscript,
            normalizedRanges: planData?.normalizedRanges || [],
            clip
        });
        setPrepareResult(result);
        setTransientStatus(result?.success ? 'Script exported' : (result?.error || 'Export failed'));
    }

    async function prepareNative() {
        setTransientStatus('Preparing Native IntelliScript', 0);
        const result = await window.roughCutAPI.prepareNativeIntelliScript({
            cues: transcript?.cues || [],
            storyText: transcript?.storyText || pastedTranscript,
            normalizedRanges: planData?.normalizedRanges || [],
            clip,
            transcribe: transcribeBeforeNative
        });
        setPrepareResult(result);
        setTransientStatus(result?.success ? 'Native prep ready' : (result?.error || 'Native prep failed'), 3600);
    }

    async function loadPlan(id) {
        const saved = await window.roughCutAPI.getPlan(id);
        if (!saved) return;
        setPlanData({
            success: true,
            plan: saved.generatedPlan,
            normalizedRanges: saved.normalizedRanges || [],
            warnings: saved.validationWarnings || [],
            savedPlan: saved,
            dryRun: planSummaryFromSaved(saved, clip, handleSeconds),
            timelineName: `AI Rough Cut - ${saved.clipName || clipTitle(clip)}`
        });
        setTransientStatus('Plan loaded');
    }

    async function deletePlan(id) {
        await window.roughCutAPI.deletePlan(id);
        if (planData?.savedPlan?.id === id) setPlanData(null);
        await refreshPlans();
        setTransientStatus('Plan deleted');
    }

    const dryRun = planData?.dryRun;
    const shortsDryRun = shortsData?.dryRun;
    const targetSummaryLabel = targetDurationSeconds
        ? formatSeconds(targetDurationSeconds)
        : dryRun?.targetDurationSeconds
            ? formatSeconds(dryRun.targetDurationSeconds)
            : 'none';
    const activeGoalChips = mode === 'shorts' ? SHORTS_GOAL_CHIPS : GOAL_CHIPS;
    const selectedShortCount = Object.values(selectedShorts).filter(Boolean).length;

    return (
        <div className="sb-section rough-cut-section">
            <div className="sb-title">
                <span>AI Rough Cut</span>
                <span className="sb-actions">
                    {status && <span className="sync-status">{status}</span>}
                    <button className="sync" onClick={refreshAll}>Refresh</button>
                </span>
            </div>

            <div className="timeline-context-card rough-cut-clip-card">
                <span className={'status-dot ' + (clipState.state === 'ready' ? 'ready' : 'warn')} />
                <div>
                    <strong>{clipTitle(clip)}</strong>
                    <p>
                        {clipState.message || 'Select one Media Pool clip'}
                        {clip ? ` / ${formatSeconds(clip.durationSeconds)} / ${clip.fps || 'fps unavailable'} fps` : ''}
                        {clip?.sourceStartTimecode ? ` / source ${clip.sourceStartTimecode}` : ''}
                    </p>
                </div>
            </div>

            <div className="rough-mode-toggle" role="tablist" aria-label="Rough Cut mode">
                <button
                    type="button"
                    className={mode === 'shorts' ? 'active' : ''}
                    aria-pressed={mode === 'shorts'}
                    onClick={() => setMode('shorts')}
                >
                    Viral Clip Finder
                </button>
                <button
                    type="button"
                    className={mode === 'rough' ? 'active' : ''}
                    aria-pressed={mode === 'rough'}
                    onClick={() => setMode('rough')}
                >
                    Tight Rough Cut
                </button>
            </div>
            <div className="rough-feature-note">
                {mode === 'shorts'
                    ? 'Find standalone Shorts/Reels/TikToks. Select the long source clip in the Media Pool; if you already edited it, make or export one source clip first. Apply creates one timeline per selected candidate.'
                    : 'Trim a long video into one shorter stitched timeline.'}
            </div>

            <section className="rough-panel">
                <div className="timeline-subhead-row">
                    <span className="timeline-subhead">Transcript</span>
                    <button className="mini-action" onClick={importTranscript}>Import SRT/VTT/TXT</button>
                </div>
                <textarea
                    className="tool-textarea rough-transcript-paste"
                    value={pastedTranscript}
                    onChange={event => setPastedTranscript(event.target.value)}
                    placeholder="Paste timestamped TXT here, or paste untimestamped story text for Native IntelliScript prep..."
                    rows={3}
                />
                <button className="mini-action" disabled={!pastedTranscript.trim()} onClick={parsePastedTranscript}>Parse pasted text</button>
                <div className={'rough-transcript-state ' + (transcript?.hasTiming ? 'ready' : 'warn')}>
                    {transcript
                        ? transcript.hasTiming
                            ? `${transcript.cues.length} cues / ${formatSeconds(transcript.analysis?.duration)} span / usable for AI Rough Cut${transcriptOffsetSeconds ? ` / normalized from ${formatSeconds(transcriptOffsetSeconds)} timecode base` : ''}`
                            : 'Untimestamped text loaded. Usable for Native IntelliScript prep, not frame-accurate rough cuts.'
                        : 'Import timestamped SRT, VTT, or TXT before generating a cut plan.'}
                </div>
            </section>

            <section className="rough-panel">
                <span className="timeline-subhead">{mode === 'shorts' ? 'Shorts goal' : 'Cut goal'}</span>
                <div className="rough-goal-chips">
                    {activeGoalChips.map(([label, value]) => (
                        <button className="lock-chip" type="button" key={label} onClick={() => setGoal(value)}>
                            {label}
                        </button>
                    ))}
                </div>
                <textarea
                    className="tool-textarea rough-goal"
                    value={goal}
                    onChange={event => setGoal(event.target.value)}
                    rows={3}
                />
                <div className="rough-settings-grid">
                    <label className="create-field">
                        <span>{mode === 'shorts' ? 'Target per Short' : 'Target total'}</span>
                        <select value={targetMode} onChange={event => setTargetMode(event.target.value)}>
                            {TARGET_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                        </select>
                    </label>
                    {targetMode === 'custom' && (
                        <label className="create-field">
                            <span>Seconds</span>
                            <input
                                className="rough-input"
                                type="number"
                                min="1"
                                value={customTarget}
                                onChange={event => setCustomTarget(event.target.value)}
                                placeholder="45"
                            />
                        </label>
                    )}
                    <label className="create-field">
                        <span>Handles</span>
                        <select value={handleSeconds} onChange={event => setHandleSeconds(Number(event.target.value))}>
                            {HANDLE_OPTIONS.map(value => <option value={value} key={value}>{value}s</option>)}
                        </select>
                    </label>
                </div>
                <div className="rough-button-row">
                    <button className="create-generate" disabled={!canRoughCut} onClick={() => requestPlan(false)}>
                        {mode === 'shorts' ? 'Find Shorts' : 'Generate plan'}
                    </button>
                    <button className="mini-action" disabled={!canRoughCut} onClick={() => requestPlan(true)}>Regenerate plan</button>
                </div>
                {awaitingPlan && <div className="rough-feature-note">Waiting for the AI JSON response. {mode === 'shorts' ? 'Shorts candidates' : 'Rough Cut'} will validate automatically when it arrives.</div>}
            </section>

            <section className="rough-panel">
                <div className="timeline-subhead-row">
                    <span className="timeline-subhead">Review AI JSON</span>
                    <button className="mini-action" disabled={!latestHasJson} onClick={() => mode === 'shorts' ? validateShortsJson(latestAssistantText) : validateJson(latestAssistantText)}>
                        Use latest chat JSON
                    </button>
                </div>
                <textarea
                    className="tool-textarea rough-json"
                    value={jsonDraft}
                    onChange={event => setJsonDraft(event.target.value)}
                    placeholder={mode === 'shorts' ? 'Paste Shorts JSON with clips[] here...' : 'Paste cut-plan JSON here if the latest chat response is not the plan...'}
                    rows={4}
                />
                <button className="mini-action" disabled={!jsonDraft.trim()} onClick={() => mode === 'shorts' ? validateShortsJson(jsonDraft) : validateJson(jsonDraft)}>Validate pasted JSON</button>
                {planData?.errors?.length > 0 && (
                    <div className="rough-error">{planData.errors.join(' ')}</div>
                )}
                {shortsData?.errors?.length > 0 && (
                    <div className="rough-error">{shortsData.errors.join(' ')}</div>
                )}
                {planData?.warnings?.length > 0 && (
                    <div className="rough-warning">{planData.warnings.join(' ')}</div>
                )}
                {shortsData?.warnings?.length > 0 && (
                    <div className="rough-warning">{shortsData.warnings.join(' ')}</div>
                )}
            </section>

            {shortsData?.success && (
                <section className="rough-panel">
                    <div className="timeline-subhead-row">
                        <span className="timeline-subhead">Shorts candidates</span>
                        <label className="rough-checkbox">
                            <input type="checkbox" checked={addMarkers} onChange={event => setAddMarkers(event.target.checked)} />
                            <span>Add markers</span>
                        </label>
                    </div>
                    <div className="rough-summary-grid">
                        <div><span>Target each</span><strong>{formatSeconds(shortsDryRun?.targetDurationSeconds || targetDurationSeconds)}</strong></div>
                        <div><span>Candidates</span><strong>{shortsDryRun?.candidateCount || shortsData.clips.length}</strong></div>
                        <div><span>Selected</span><strong>{selectedShortCount}</strong></div>
                        <div><span>Handles</span><strong>{handleSeconds}s</strong></div>
                    </div>
                    <div className="rough-feature-note">
                        Each selected candidate becomes its own timeline with linked source video/audio. This does not stitch unrelated clips into one montage.
                    </div>
                    {applyResult?.success && (
                        <div className="rough-transcript-state ready">
                            Created {applyResult.created} Shorts timeline{applyResult.created === 1 ? '' : 's'}
                        </div>
                    )}
                    {applyResult?.results?.length > 0 && (
                        <div className="rough-result-list">
                            {applyResult.results.map((result, index) => (
                                <div className={result.success ? 'ready' : 'error'} key={`${result.timelineName || index}-${index}`}>
                                    {result.success ? result.timelineName : (result.error || 'Timeline failed')}
                                </div>
                            ))}
                        </div>
                    )}
                    {applyResult?.warnings?.length > 0 && (
                        <div className="rough-warning">{applyResult.warnings.join(' ')}</div>
                    )}
                    {applyResult?.error && <div className="rough-error">{applyResult.error}</div>}
                    <div className="rough-button-row">
                        <button className="mini-action" type="button" onClick={selectAllShorts}>Select all</button>
                        <button className="mini-action" type="button" onClick={clearShorts}>Clear</button>
                    </div>
                    <div className="rough-range-list">
                        {shortsData.clips.map(candidate => (
                            <article className="rough-range short-candidate" key={candidate.index}>
                                <div className="short-candidate-head">
                                    <label className="rough-checkbox">
                                        <input type="checkbox" checked={!!selectedShorts[candidate.index]} onChange={() => toggleShort(candidate.index)} />
                                        <span>{candidate.title}</span>
                                    </label>
                                    <span className={'short-quality ' + (candidate.durationFit === 'target' ? 'ready' : 'warn')}>
                                        {shortReviewState(candidate)}
                                    </span>
                                </div>
                                <div className="short-candidate-meta">
                                    <span>{candidate.startLabel} - {candidate.endLabel}</span>
                                    <span>{formatSeconds(candidate.durationSeconds)}</span>
                                    <span>score {formatPercent(candidate.score)}</span>
                                    <span>structure {formatPercent(candidate.structureScore)}</span>
                                </div>
                                <p><strong>Hook</strong> {candidate.hook || candidate.reason || 'No hook provided'}</p>
                                {(candidate.setup || candidate.payoff || candidate.ending) && (
                                    <div className="short-structure">
                                        {candidate.setup && <span><strong>Setup</strong> {candidate.setup}</span>}
                                        {candidate.payoff && <span><strong>Payoff</strong> {candidate.payoff}</span>}
                                        {candidate.ending && <span><strong>End</strong> {candidate.ending}</span>}
                                    </div>
                                )}
                                {candidate.publish?.platformChecks?.length > 0 && (
                                    <div className="short-platform-checks">
                                        {candidate.publish.platformChecks.map(check => (
                                            <span className={check.status} title={check.message} key={`${candidate.index}-${check.id}`}>
                                                {check.label}: {check.status}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {candidate.publish && (
                                    <div className="short-publish-kit">
                                        <strong>{candidate.publish.captionHook}</strong>
                                        <span>{candidate.publish.hashtags?.join(' ')}</span>
                                    </div>
                                )}
                                <div className="rough-button-row">
                                    <button className="mini-action" type="button" onClick={() => copyPublishPackage(candidate)}>Copy post text</button>
                                    <button className="mini-action" type="button" onClick={() => sendCaptionPrompt(candidate)}>Caption this</button>
                                </div>
                                <small>{candidate.tags?.join(', ') || 'no tags'}</small>
                            </article>
                        ))}
                    </div>
                    <button className="create-generate" disabled={!selectedShortCount} onClick={applyShorts}>Create selected Shorts timelines</button>
                </section>
            )}

            {planData?.success && (
                <section className="rough-panel">
                    <div className="timeline-subhead-row">
                        <span className="timeline-subhead">Dry run</span>
                        <label className="rough-checkbox">
                            <input type="checkbox" checked={addMarkers} onChange={event => setAddMarkers(event.target.checked)} />
                            <span>Add markers</span>
                        </label>
                    </div>
                    <div className="rough-summary-grid">
                        <div><span>Original</span><strong>{formatSeconds(dryRun?.originalDurationSeconds)}</strong></div>
                        <div><span>Target</span><strong>{targetSummaryLabel}</strong></div>
                        <div><span>Rough cut</span><strong>{formatSeconds(dryRun?.estimatedDurationSeconds)}</strong></div>
                        <div><span>Sections</span><strong>{dryRun?.keptSections || planData.normalizedRanges.length}</strong></div>
                        <div><span>Handles</span><strong>{dryRun?.handleSeconds ?? handleSeconds}s</strong></div>
                    </div>
                    <div className="rough-feature-note">
                        Target: {activeTargetLabel}. Apply creates a new timeline from reviewed ranges and requests both video and audio from the selected source clip.
                    </div>
                    {applyResult?.success && (
                        <div className="rough-transcript-state ready">
                            Created {applyResult.timelineName}
                            {applyResult.appendedItems ? ` / ${applyResult.appendedItems} of ${applyResult.requestedItems} requested timeline items reported by Resolve` : ''}
                        </div>
                    )}
                    <div className="rough-timeline-name">{planData.timelineName || dryRun?.timelineName}</div>
                    {applyResult?.warnings?.length > 0 && (
                        <div className="rough-warning">{applyResult.warnings.join(' ')}</div>
                    )}
                    {applyResult?.error && (
                        <div className="rough-error">{applyResult.error}</div>
                    )}
                    <div className="rough-range-list">
                        {planData.normalizedRanges.map(range => (
                            <article className="rough-range" key={range.index}>
                                <strong>{range.startLabel} - {range.endLabel}</strong>
                                <p>{range.reason || 'Keep range'}</p>
                                <small>{range.tags?.join(', ') || 'no tags'}{range.confidence !== null ? ` / ${Math.round(range.confidence * 100)}%` : ''}</small>
                            </article>
                        ))}
                    </div>
                    <button className="create-generate" onClick={applyPlan}>Apply AI Rough Cut</button>
                </section>
            )}

            <section className="rough-panel native-panel">
                <span className="timeline-subhead">Native IntelliScript</span>
                <p className="rough-help">
                    AI Rough Cut creates a new timeline directly from keep ranges. Native IntelliScript prep exports clean story/dialogue TXT for Resolve's own IntelliScript workflow.
                </p>
                <div className="rough-feature-note">
                    {features?.directIntelliScriptAvailable
                        ? `Callable IntelliScript candidate detected: ${features.directIntelliScript.map(item => `${item.object}.${item.method}`).join(', ')}`
                        : (features?.fallbackMessage || FALLBACK_MESSAGE)}
                </div>
                <label className="rough-checkbox">
                    <input
                        type="checkbox"
                        checked={transcribeBeforeNative}
                        onChange={event => setTranscribeBeforeNative(event.target.checked)}
                        disabled={!features?.mediaPoolItemTranscribeAudio}
                    />
                    <span>Call detected TranscribeAudio before export</span>
                </label>
                <div className="rough-button-row">
                    <button className="mini-action" disabled={!canPrepareNative} onClick={exportScript}>Export TXT</button>
                    <button className="mini-action" disabled={!canPrepareNative} onClick={prepareNative}>Prepare for Native IntelliScript</button>
                </div>
                {prepareResult?.filePath && <div className="rough-file-path">{prepareResult.filePath}</div>}
                {prepareResult?.manualSteps?.length > 0 && (
                    <ol className="rough-steps">
                        {prepareResult.manualSteps.map(step => <li key={step}>{step}</li>)}
                    </ol>
                )}
            </section>

            <section className="rough-panel">
                <span className="timeline-subhead">Saved plans</span>
                {plans.length === 0 ? (
                    <div className="sb-empty">No saved rough-cut plans yet</div>
                ) : (
                    <div className="rough-plan-list">
                        {plans.slice(0, 8).map(plan => (
                            <article className="rough-plan-row" key={plan.id}>
                                <div>
                                    <strong>{plan.clipName || 'Selected clip'}</strong>
                                    <small>{plan.keptSections} keeps / {plan.goal}</small>
                                </div>
                                <button className="mini-action" onClick={() => loadPlan(plan.id)}>Open</button>
                                <button className="mini-action danger" onClick={() => deletePlan(plan.id)}>Delete</button>
                            </article>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
