import React, { useEffect, useMemo, useRef, useState } from 'react';

const GOAL_CHIPS = [
    ['viral moment', 'Find one viral moment with a sharp hook, clear context, payoff, and clean ending.'],
    ['funny', 'Find funny or surprising moments that can stand alone.'],
    ['lesson', 'Find clear useful lessons with strong first-frame hooks.'],
    ['story', 'Find emotional or important story beats that work without the full video.'],
    ['debate/reaction', 'Find a strong debate, reaction, disagreement, or high-tension exchange that stands alone.'],
    ['strong quote', 'Find memorable quotes or punchy statements that can carry a Short by themselves.']
];

const TARGETS = [
    ['30', '30s'],
    ['60', '60s'],
    ['90', '90s'],
    ['180', '3m'],
    ['custom', 'Custom']
];

const HANDLES = [0.25, 0.5, 1, 2];

const SHORT_CAPTION_STYLES = [
    ['social shorts', 'Social'],
    ['bold hook', 'Bold Hook'],
    ['kinetic', 'Kinetic'],
    ['karaoke', 'Karaoke'],
    ['clean', 'Clean'],
    ['podcast clips', 'Podcast'],
    ['documentary', 'Documentary']
];

function formatSeconds(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'n/a';
    if (number >= 60) return `${Math.floor(number / 60)}m ${Math.round(number % 60)}s`;
    return `${number.toFixed(number < 10 ? 1 : 0)}s`;
}

function formatPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'n/a';
    return `${Math.round(number * 100)}%`;
}

function clipTitle(clip) {
    return clip?.name || clip?.fileName || 'No clip selected';
}

function hasJson(text) {
    const value = String(text || '');
    return value.includes('{') && value.includes('clips');
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
    return Math.max(0, Number(analysis?.lastEnd || 0) - Number(offsetSeconds || 0));
}

function candidateState(candidate) {
    if (candidate.durationFit === 'target' && Number(candidate.structureScore || 0) >= 0.75) return 'Ready';
    if (candidate.durationFit === 'short') return 'Short';
    if (Number(candidate.structureScore || 0) < 0.75) return 'Needs review';
    return 'Review';
}

function selectedIndexesFromMap(map) {
    return Object.entries(map)
        .filter(([, selected]) => selected)
        .map(([index]) => Number(index));
}

function cuesForCandidate(cues = [], candidate = {}, transcriptOffsetSeconds = 0) {
    const start = Number(candidate.start);
    const end = Number(candidate.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    return cues
        .map(cue => {
            const cueStart = Number(cue.start) - Number(transcriptOffsetSeconds || 0);
            const cueEnd = Number(cue.end) - Number(transcriptOffsetSeconds || 0);
            if (!Number.isFinite(cueStart) || !Number.isFinite(cueEnd)) return null;
            if (cueEnd <= start || cueStart >= end) return null;
            const localStart = Math.max(0, cueStart - start);
            const localEnd = Math.min(end - start, cueEnd - start);
            if (localEnd <= localStart) return null;
            return {
                ...cue,
                start: Number(localStart.toFixed(3)),
                end: Number(localEnd.toFixed(3))
            };
        })
        .filter(Boolean);
}

function candidatePostText(candidate = {}) {
    const publish = candidate.publish || {};
    return [
        publish.title || candidate.title,
        '',
        publish.description || candidate.hook || candidate.reason,
        '',
        Array.isArray(publish.hashtags) ? publish.hashtags.join(' ') : ''
    ].filter(line => line !== undefined && line !== null).join('\n');
}

function packageBundleText(packages = []) {
    return packages.map(item => [
        item.title,
        item.timelineName ? `Timeline: ${item.timelineName}` : '',
        item.range?.startLabel && item.range?.endLabel ? `Range: ${item.range.startLabel} - ${item.range.endLabel}` : '',
        '',
        'Post text:',
        item.postText || '',
        '',
        'Caption prompt:',
        item.captionPrompt || '',
        '',
        item.renderPlan ? `Render: ${item.renderPlan.resolution}, ${item.renderPlan.codec}, ${item.renderPlan.fps ? `${item.renderPlan.fps} fps` : 'timeline fps'}` : ''
    ].filter(line => line !== undefined && line !== null).join('\n')).join('\n\n---\n\n');
}

function packageRenderLabel(item = {}) {
    const plan = item.renderPlan || item.renderPresetSuggestion || {};
    return `${plan.resolution || '1080x1920'} / ${plan.codec || 'H.265'} / ${plan.fps ? `${plan.fps} fps` : 'timeline fps'}`;
}

export default function SidebarShortsStudio({ latestAssistantText, onPrompt }) {
    const [sourceState, setSourceState] = useState({ state: 'checking', message: 'Checking Media Pool selection', clip: null });
    const [transcript, setTranscript] = useState(null);
    const [pastedTranscript, setPastedTranscript] = useState('');
    const [goal, setGoal] = useState('Find standalone shorts with a strong hook, context, payoff, and clean ending.');
    const [targetMode, setTargetMode] = useState('60');
    const [customTarget, setCustomTarget] = useState('');
    const [handleSeconds, setHandleSeconds] = useState(0.5);
    const [captionStyle, setCaptionStyle] = useState('social shorts');
    const [allowReviewCandidates, setAllowReviewCandidates] = useState(false);
    const [jsonDraft, setJsonDraft] = useState('');
    const [candidateData, setCandidateData] = useState(null);
    const [selected, setSelected] = useState({});
    const [projects, setProjects] = useState([]);
    const [transcriberState, setTranscriberState] = useState({ providers: [], preferredProvider: null });
    const [creatorProfile, setCreatorProfile] = useState(null);
    const [packageResult, setPackageResult] = useState(null);
    const [timelineResult, setTimelineResult] = useState(null);
    const [status, setStatus] = useState('');
    const [awaitingJson, setAwaitingJson] = useState(false);
    const lastValidated = useRef('');

    const clip = sourceState.clip;
    const transcriptOffsetSeconds = useMemo(() => detectTranscriptOffset(transcript?.analysis, clip), [transcript, clip]);
    const validationClipDuration = useMemo(() => {
        const clipDuration = Number(clip?.durationSeconds || 0);
        const transcriptDuration = transcriptDurationFallback(transcript?.analysis, transcriptOffsetSeconds);
        return clipDuration > 0 ? Math.max(clipDuration, transcriptDuration) : transcriptDuration;
    }, [clip, transcript, transcriptOffsetSeconds]);
    const targetDurationSeconds = useMemo(() => {
        if (targetMode === 'custom') {
            const value = Number(customTarget);
            return Number.isFinite(value) && value > 0 ? value : 60;
        }
        return Number(targetMode) || 60;
    }, [targetMode, customTarget]);
    const clipReady = Boolean(
        sourceState.state === 'ready' &&
        clip?.timingReady &&
        clip?.fps &&
        Number(clip?.durationSeconds || 0) > 0 &&
        clip?.sourceStartFrame !== null &&
        clip?.sourceStartFrame !== undefined
    );
    const canGenerate = Boolean(clipReady && transcript?.hasTiming);
    const latestHasJson = hasJson(latestAssistantText);
    const selectedCount = selectedIndexesFromMap(selected).length;

    useEffect(() => {
        refreshAll();
    }, []);

    useEffect(() => {
        if (!awaitingJson || !canGenerate || !latestHasJson || latestAssistantText === lastValidated.current) return;
        lastValidated.current = latestAssistantText;
        validateCandidates(latestAssistantText, { auto: true });
    }, [awaitingJson, canGenerate, latestHasJson, latestAssistantText]);

    function setTransientStatus(value, timeout = 2400) {
        setStatus(value);
        if (timeout) setTimeout(() => setStatus(''), timeout);
    }

    async function refreshAll() {
        await Promise.all([refreshSource(), refreshProjects(), refreshTranscribers(), refreshCreatorProfile()]);
    }

    async function refreshSource() {
        setSourceState(prev => ({ ...prev, state: 'checking', message: 'Checking Media Pool selection' }));
        try {
            const result = await window.shortsAPI.getSource();
            setSourceState(result || { state: 'unavailable', message: 'Resolve selection unavailable', clip: null });
        } catch {
            setSourceState({ state: 'unavailable', message: 'Resolve selection unavailable', clip: null });
        }
    }

    async function refreshProjects() {
        try {
            setProjects(await window.shortsAPI.listProjects());
        } catch {
            setProjects([]);
        }
    }

    async function refreshTranscribers() {
        try {
            setTranscriberState(await window.shortsAPI.detectTranscribers());
        } catch {
            setTranscriberState({ providers: [], preferredProvider: null });
        }
    }

    async function refreshCreatorProfile() {
        try {
            setCreatorProfile(await window.shortsAPI.getCreatorProfile());
        } catch {
            setCreatorProfile(null);
        }
    }

    async function importTranscript() {
        setTransientStatus('Importing transcript', 0);
        const result = await window.shortsAPI.importTranscript();
        if (result?.canceled) {
            setTransientStatus('');
            return;
        }
        setTranscript(result);
        setCandidateData(null);
        setPackageResult(null);
        setTransientStatus(result?.hasTiming ? `${result.cues.length} timestamped cues` : 'No usable timestamps');
    }

    async function generateTranscriptLocally() {
        const provider = transcriberState.preferredProvider;
        if (!provider) {
            setTransientStatus('No local transcriber ready');
            return;
        }
        setTransientStatus(provider === 'resolve' ? 'Running Resolve TranscribeAudio' : 'Generating transcript locally', 0);
        try {
            const result = await window.shortsAPI.transcribeSource({ provider });
            if (result?.hasTiming) {
                setTranscript(result);
                setCandidateData(null);
                setPackageResult(null);
                setTransientStatus(`${result.cues.length} transcript cues generated`);
            } else {
                setTransientStatus(result?.message || result?.error || 'Transcript generation did not return timed cues', 5200);
            }
            await refreshTranscribers();
        } catch (err) {
            setTransientStatus(err?.message || 'Transcript generation failed', 5200);
        }
    }

    async function parsePastedTranscript() {
        if (!pastedTranscript.trim()) return;
        setTransientStatus('Parsing transcript', 0);
        const result = await window.shortsAPI.importTranscript({
            text: pastedTranscript,
            format: pastedTranscript.trim().toUpperCase().startsWith('WEBVTT') ? 'vtt' : 'txt'
        });
        setTranscript(result);
        setCandidateData(null);
        setPackageResult(null);
        setTransientStatus(result?.hasTiming ? `${result.cues.length} timestamped cues` : 'Timestamped text required');
    }

    async function buildCandidates(regenerate = false) {
        if (!canGenerate) {
            setTransientStatus(transcript?.hasTiming ? 'Select one ready Media Pool video clip' : 'Import timestamped transcript');
            return;
        }
        setTransientStatus(regenerate ? 'Regenerating candidates' : 'Building Shorts prompt', 0);
        try {
            const result = await window.shortsAPI.buildCandidates({
                cues: transcript.cues,
                transcriptHash: transcript.transcriptHash,
                goal,
                targetDurationSeconds,
                handleSeconds,
                transcriptOffsetSeconds,
                clip,
                maxClips: 8
            });
            const accepted = onPrompt(result.prompt, {
                displayText: regenerate ? `Regenerate Shorts Studio: ${goal}` : result.displayText,
                skipSessionContext: true
            });
            setAwaitingJson(accepted !== false);
            setTransientStatus(accepted === false ? 'Finish current run first' : 'Waiting for AI candidates');
        } catch {
            setTransientStatus('Candidate request failed');
        }
    }

    async function validateCandidates(text, options = {}) {
        if (!String(text || '').trim() || !clip) return;
        setTransientStatus('Validating candidates', 0);
        try {
            const result = await window.shortsAPI.validateCandidates({
                text,
                clip,
                transcriptHash: transcript?.transcriptHash,
                cues: transcript?.cues || [],
                handleSeconds,
                transcriptOffsetSeconds,
                clipDurationSeconds: validationClipDuration,
                targetDurationSeconds,
                allowReviewCandidates,
                maxClips: 8
            });
            if (!result.success) {
                setCandidateData(result);
                setAwaitingJson(false);
                setTransientStatus(result.errors?.[0] || 'Invalid Shorts candidates');
                return;
            }
            const nextSelected = {};
            result.clips.forEach(candidate => { nextSelected[candidate.index] = true; });
            setCandidateData(result);
            setSelected(nextSelected);
            setPackageResult(null);
            setTimelineResult(null);
            setAwaitingJson(false);
            await refreshProjects();
            setTransientStatus(options.auto ? `${result.clips.length} candidates ready` : 'Candidates ready');
        } catch {
            setAwaitingJson(false);
            setTransientStatus('Candidate validation failed');
        }
    }

    async function createTimelines() {
        if (!candidateData?.success || !selectedCount) return;
        if (!clipReady) {
            setTimelineResult({ success: false, error: 'Select one ready Media Pool video clip before creating timelines.' });
            setTransientStatus('Select one ready Media Pool video clip');
            return;
        }
        setTransientStatus('Creating Shorts timelines', 0);
        try {
            const result = await window.shortsAPI.createTimelines({
                projectId: candidateData.project?.id,
                candidates: candidateData.clips,
                selectedIndexes: selectedIndexesFromMap(selected),
                addMarkers: true,
                includeAudio: true
            });
            setTimelineResult(result);
            setTransientStatus(result.success ? `Created ${result.created} timeline${result.created === 1 ? '' : 's'}` : (result.error || 'Timeline creation failed'), 4800);
            await refreshProjects();
        } catch (err) {
            setTimelineResult({ success: false, error: err?.message || 'Timeline creation failed' });
            setTransientStatus(err?.message || 'Timeline creation failed', 4200);
        }
    }

    async function packageSelected() {
        if (!candidateData?.success || !selectedCount) return;
        setTransientStatus('Packaging selected Shorts', 0);
        try {
            const result = await window.shortsAPI.packageSelected({
                projectId: candidateData.project?.id,
                source: clip,
                candidates: candidateData.clips,
                selectedIndexes: selectedIndexesFromMap(selected)
            });
            setPackageResult(result);
            setTransientStatus(result.success ? `${result.packages.length} package${result.packages.length === 1 ? '' : 's'} ready` : (result.error || 'Package failed'));
            await refreshProjects();
        } catch (err) {
            setPackageResult({ success: false, error: err?.message || 'Package failed', packages: [] });
            setTransientStatus(err?.message || 'Package failed');
        }
    }

    async function exportMarkers() {
        if (!candidateData?.success || !selectedCount) return;
        setTransientStatus('Exporting marker handoff', 0);
        try {
            const result = await window.shortsAPI.exportMarkers({
                projectId: candidateData.project?.id,
                source: clip,
                candidates: candidateData.clips,
                selectedIndexes: selectedIndexesFromMap(selected)
            });
            setTransientStatus(result.success ? `Markers exported: ${result.filePath}` : (result.error || 'Marker export failed'), 5200);
        } catch (err) {
            setTransientStatus(err?.message || 'Marker export failed', 5200);
        }
    }

    async function createTimelinesAndPackage() {
        if (!candidateData?.success || !selectedCount) return;
        await packageSelected();
        await createTimelines();
    }

    async function loadProject(id) {
        const project = await window.shortsAPI.getProject(id);
        if (!project) return;
        const nextSelected = {};
        (project.selectedIndexes || []).forEach(index => { nextSelected[index] = true; });
        setCandidateData({
            success: true,
            clips: project.candidates || [],
            warnings: project.validationWarnings || [],
            project,
            dryRun: {
                candidateCount: project.candidates?.length || 0,
                targetDurationSeconds: project.targetDurationSeconds
            }
        });
        setSelected(nextSelected);
        setPackageResult(project.packages ? { success: true, packages: project.packages } : null);
        setTransientStatus('Shorts project loaded');
    }

    async function deleteProject(id) {
        await window.shortsAPI.deleteProject(id);
        if (candidateData?.project?.id === id) {
            setCandidateData(null);
            setPackageResult(null);
        }
        await refreshProjects();
        setTransientStatus('Project deleted');
    }

    async function saveCandidateDecision(candidate, decision, feedbackReason = '') {
        try {
            const result = await window.shortsAPI.saveCandidateFeedback({
                projectId: candidateData?.project?.id,
                candidate,
                decision,
                feedbackReason
            });
            if (result?.profile) setCreatorProfile(result.profile);
        } catch { /* best-effort learning */ }
    }

    function toggleCandidate(index) {
        setPackageResult(null);
        const candidate = candidateData?.clips?.find(item => Number(item.index) === Number(index));
        setSelected(prev => {
            const nextSelected = !prev[index];
            if (candidate) saveCandidateDecision(candidate, nextSelected ? 'selected' : 'rejected');
            return { ...prev, [index]: nextSelected };
        });
    }

    function selectAll() {
        const next = {};
        (candidateData?.clips || []).forEach(candidate => { next[candidate.index] = true; });
        setPackageResult(null);
        setSelected(next);
        (candidateData?.clips || []).forEach(candidate => saveCandidateDecision(candidate, 'selected'));
    }

    function clearSelection() {
        setPackageResult(null);
        setSelected({});
        (candidateData?.clips || []).forEach(candidate => saveCandidateDecision(candidate, 'rejected', 'Cleared from selected candidates'));
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(String(text || ''));
            setTransientStatus('Copied');
        } catch {
            setTransientStatus('Could not copy');
        }
    }

    async function captionCandidate(candidate) {
        const candidateCues = cuesForCandidate(transcript?.cues || [], candidate, transcriptOffsetSeconds);
        let prompt = '';
        if (candidateCues.length && window.captionAPI?.generate) {
            const result = await window.captionAPI.generate({
                cues: candidateCues,
                style: captionStyle,
                width: 1080,
                height: 1920,
                fps: clip?.fps || 30
            });
            prompt = [
                `Create vertical subtitles for this selected Short: ${candidate.title}.`,
                `Clip range: ${candidate.startLabel} - ${candidate.endLabel}.`,
                candidate.publish?.captionHook ? `Hook text: ${candidate.publish.captionHook}` : '',
                '',
                result?.prompt || ''
            ].filter(Boolean).join('\n');
        } else {
            prompt = [
                candidate.publish?.captionPrompt || `Create short-form captions for ${candidate.title}.`,
                '',
                `Clip range: ${candidate.startLabel} - ${candidate.endLabel}.`,
                `Style: ${captionStyle}. Canvas: 1080x1920 vertical 9:16.`,
                'Use transparent ProRes 4444 overlay.',
                'Keep every caption inside x 7%-93% and y 12%-86%. Max 2 lines, about 18-24 characters per line, max-width 86%, responsive font size, and no clipped or edge-touching words.',
                'Use vertical-safe typography, kinetic emphasis where useful, and a strong first 2 seconds.'
            ].join('\n');
        }
        const accepted = onPrompt(prompt, { displayText: `Caption Short: ${candidate.title}` });
        setTransientStatus(accepted === false ? 'Finish current run first' : candidateCues.length ? `Caption prompt sent (${candidateCues.length} cues)` : 'Caption prompt sent');
    }

    return (
        <div className="sb-section shorts-studio-section">
            <div className="sb-title">
                <span>AI Clip Finder</span>
                <span className="sb-actions">
                    {status && <span className="sync-status">{status}</span>}
                    <button className="sync" type="button" onClick={refreshAll}>Refresh</button>
                </span>
            </div>

            <div className="shorts-hero">
                <strong>AI Clip Finder for publishable Shorts</strong>
                <p>Select one Media Pool video clip, import or generate a timestamped transcript, score standalone clips, then create reviewed timelines.</p>
            </div>

            <section className="shorts-panel">
                <div className="timeline-subhead-row">
                    <span className="timeline-subhead">Source</span>
                    <button className="mini-action" type="button" onClick={refreshSource}>Refresh source</button>
                </div>
                <div className="timeline-context-card rough-cut-clip-card">
                    <span className={'status-dot ' + (sourceState.state === 'ready' ? 'ready' : 'warn')} />
                    <div>
                        <strong>{clipTitle(clip)}</strong>
                        <p>{sourceState.message || 'Select one Media Pool video clip'}{clip ? ` / ${formatSeconds(clip.durationSeconds)} / ${clip.fps || 'fps unavailable'} fps` : ''}</p>
                        <small>Compound clips work if they are selected as Media Pool items with readable timing.</small>
                    </div>
                </div>
            </section>

            <section className="shorts-panel">
                <div className="timeline-subhead-row">
                    <span className="timeline-subhead">Transcript</span>
                    <span className="sb-actions">
                        {['whisper', 'whisperCpp'].includes(transcriberState.preferredProvider) && (
                            <button className="mini-action" type="button" onClick={generateTranscriptLocally}>Generate transcript locally</button>
                        )}
                        <button className="mini-action" type="button" onClick={importTranscript}>Import SRT/VTT/TXT</button>
                    </span>
                </div>
                {transcriberState.providers?.length > 0 && (
                    <div className="short-transcriber-row">
                        {transcriberState.providers.map(provider => (
                            <span className={provider.ready ? 'ready' : 'warn'} key={provider.id}>{provider.label}: {provider.status}</span>
                        ))}
                    </div>
                )}
                <textarea
                    className="tool-textarea rough-transcript-paste"
                    value={pastedTranscript}
                    onChange={event => setPastedTranscript(event.target.value)}
                    placeholder="Paste timestamped transcript text here..."
                    rows={3}
                />
                <button className="mini-action" type="button" disabled={!pastedTranscript.trim()} onClick={parsePastedTranscript}>Parse pasted text</button>
                <div className={'rough-transcript-state ' + (transcript?.hasTiming ? 'ready' : 'warn')}>
                    {transcript?.hasTiming
                        ? `${transcript.cues.length} cues / ${formatSeconds(transcript.analysis?.duration)} span${transcriptOffsetSeconds ? ` / normalized from ${formatSeconds(transcriptOffsetSeconds)} timecode base` : ''}`
                        : 'Timestamped SRT, VTT, or TXT is required for AI Clip Finder v1.'}
                </div>
            </section>

            <section className="shorts-panel">
                <div className="timeline-subhead-row">
                    <span className="timeline-subhead">Find candidates</span>
                    {creatorProfile && (creatorProfile.selectedCount || creatorProfile.rejectedCount) ? (
                        <span className="sync-status">{creatorProfile.selectedCount} selected / {creatorProfile.rejectedCount} rejected learned</span>
                    ) : null}
                </div>
                {creatorProfile && (creatorProfile.likedTags?.length || creatorProfile.rejectedTags?.length) ? (
                    <div className="short-learning-card">
                        {creatorProfile.likedTags?.length ? <span>Lean toward: {creatorProfile.likedTags.join(', ')}</span> : null}
                        {creatorProfile.rejectedTags?.length ? <span>Avoid: {creatorProfile.rejectedTags.join(', ')}</span> : null}
                    </div>
                ) : null}
                <div className="rough-goal-chips">
                    {GOAL_CHIPS.map(([label, value]) => (
                        <button className="lock-chip" type="button" key={label} onClick={() => setGoal(value)}>{label}</button>
                    ))}
                </div>
                <textarea className="tool-textarea rough-goal" value={goal} onChange={event => setGoal(event.target.value)} rows={3} />
                <div className="rough-settings-grid">
                    <label className="create-field">
                        <span>Target per Short</span>
                        <select value={targetMode} onChange={event => setTargetMode(event.target.value)}>
                            {TARGETS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                        </select>
                    </label>
                    {targetMode === 'custom' && (
                        <label className="create-field">
                            <span>Seconds</span>
                            <input className="rough-input" type="number" min="1" value={customTarget} onChange={event => setCustomTarget(event.target.value)} />
                        </label>
                    )}
                    <label className="create-field">
                        <span>Handles</span>
                        <select value={handleSeconds} onChange={event => setHandleSeconds(Number(event.target.value))}>
                            {HANDLES.map(value => <option value={value} key={value}>{value}s</option>)}
                        </select>
                    </label>
                    <label className="create-field">
                        <span>Subtitle style</span>
                        <select value={captionStyle} onChange={event => setCaptionStyle(event.target.value)}>
                            {SHORT_CAPTION_STYLES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                        </select>
                    </label>
                </div>
                <label className="rough-checkbox shorts-review-toggle">
                    <input type="checkbox" checked={allowReviewCandidates} onChange={event => setAllowReviewCandidates(event.target.checked)} />
                    <span>Allow review candidates with incomplete hook/setup/payoff/ending</span>
                </label>
                <div className="rough-button-row">
                    <button className="create-generate" type="button" disabled={!canGenerate} onClick={() => buildCandidates(false)}>Find Shorts</button>
                    <button className="mini-action" type="button" disabled={!canGenerate} onClick={() => buildCandidates(true)}>Regenerate</button>
                </div>
                {awaitingJson && <div className="rough-feature-note">Waiting for the AI JSON. AI Clip Finder will validate candidates automatically when it arrives.</div>}
            </section>

            <section className="shorts-panel">
                <div className="timeline-subhead-row">
                    <span className="timeline-subhead">Review AI JSON</span>
                    <button className="mini-action" type="button" disabled={!latestHasJson} onClick={() => validateCandidates(latestAssistantText)}>Use latest</button>
                </div>
                <textarea
                    className="tool-textarea rough-json"
                    value={jsonDraft}
                    onChange={event => setJsonDraft(event.target.value)}
                    placeholder="Paste AI Clip Finder JSON with clips[] here..."
                    rows={4}
                />
                <button className="mini-action" type="button" disabled={!jsonDraft.trim()} onClick={() => validateCandidates(jsonDraft)}>Validate pasted JSON</button>
                {candidateData?.errors?.length > 0 && <div className="rough-error">{candidateData.errors.join(' ')}</div>}
                {candidateData?.warnings?.length > 0 && <div className="rough-warning">{candidateData.warnings.join(' ')}</div>}
            </section>

            {candidateData?.success && (
                <section className="shorts-panel">
                    <div className="timeline-subhead-row">
                        <span className="timeline-subhead">Candidate board</span>
                        <span className="sync-status">{selectedCount} selected</span>
                    </div>
                    <div className="rough-summary-grid">
                        <div><span>Target</span><strong>{formatSeconds(targetDurationSeconds)}</strong></div>
                        <div><span>Candidates</span><strong>{candidateData.clips.length}</strong></div>
                        <div><span>Selected</span><strong>{selectedCount}</strong></div>
                        <div><span>Project</span><strong>{candidateData.project?.id ? 'saved' : 'draft'}</strong></div>
                    </div>
                    <div className="rough-button-row">
                        <button className="mini-action" type="button" onClick={selectAll}>Select all</button>
                        <button className="mini-action" type="button" onClick={clearSelection}>Clear</button>
                        <button className="mini-action" type="button" disabled={!selectedCount} onClick={packageSelected}>Package selected</button>
                        <button className="mini-action" type="button" disabled={!selectedCount} onClick={exportMarkers}>Export markers</button>
                        <button className="mini-action" type="button" disabled={!selectedCount || !clipReady} onClick={createTimelinesAndPackage}>Create + package</button>
                        <button className="create-generate" type="button" disabled={!selectedCount || !clipReady} onClick={createTimelines}>Create timelines</button>
                    </div>
                    {timelineResult?.success && <div className="rough-transcript-state ready">Created {timelineResult.created} timeline{timelineResult.created === 1 ? '' : 's'}</div>}
                    {timelineResult?.error && <div className="rough-error">{timelineResult.error}</div>}
                    <div className="shorts-candidate-board">
                        {candidateData.clips.map(candidate => (
                            <article className="shorts-candidate-card" key={candidate.index}>
                                <div className="short-candidate-head">
                                    <label className="rough-checkbox">
                                        <input type="checkbox" checked={!!selected[candidate.index]} onChange={() => toggleCandidate(candidate.index)} />
                                        <span>{candidate.title}</span>
                                    </label>
                                    <span className={'short-quality ' + (candidate.durationFit === 'target' ? 'ready' : 'warn')}>{candidateState(candidate)}</span>
                                </div>
                                <div className="short-candidate-meta">
                                    <span>{candidate.startLabel} - {candidate.endLabel}</span>
                                    <span>{formatSeconds(candidate.durationSeconds)}</span>
                                    <span>score {formatPercent(candidate.score)}</span>
                                    <span>structure {formatPercent(candidate.structureScore)}</span>
                                </div>
                                <p><strong>Hook</strong> {candidate.hook || candidate.reason || 'No hook provided'}</p>
                                {candidate.rubricScores && (
                                    <div className="short-rubric-grid">
                                        <span>Hook <strong>{formatPercent(candidate.rubricScores.hookStrength)}</strong></span>
                                        <span>Context <strong>{formatPercent(candidate.rubricScores.standaloneContext)}</strong></span>
                                        <span>Payoff <strong>{formatPercent(candidate.rubricScores.payoff)}</strong></span>
                                        <span>Emotion <strong>{formatPercent(candidate.rubricScores.emotionOrSurprise)}</strong></span>
                                        <span>Ending <strong>{formatPercent(candidate.rubricScores.cleanEnding)}</strong></span>
                                        <span>Title <strong>{formatPercent(candidate.rubricScores.captionTitlePotential)}</strong></span>
                                    </div>
                                )}
                                <div className="short-structure">
                                    {candidate.setup && <span><strong>Setup</strong> {candidate.setup}</span>}
                                    {candidate.payoff && <span><strong>Payoff</strong> {candidate.payoff}</span>}
                                    {candidate.ending && <span><strong>End</strong> {candidate.ending}</span>}
                                </div>
                                {candidate.whyThisWorks && (
                                    <div className="short-why">
                                        <strong>Why this might work</strong>
                                        <span>{candidate.whyThisWorks.scrollStoppingHook}</span>
                                        <span>{candidate.whyThisWorks.requiredContext}</span>
                                        <span>{candidate.whyThisWorks.payoff}</span>
                                        <span>{candidate.whyThisWorks.cleanEnding}</span>
                                        <span>{candidate.whyThisWorks.titleCaptionAngle}</span>
                                    </div>
                                )}
                                {candidate.publish?.platformChecks?.length > 0 && (
                                    <div className="short-platform-checks">
                                        {candidate.publish.platformChecks.map(check => (
                                            <span className={check.status} title={check.message} key={`${candidate.index}-${check.id}`}>{check.label}: {check.status}</span>
                                        ))}
                                    </div>
                                )}
                                <div className="short-publish-kit">
                                    <strong>{candidate.publish?.captionHook || candidate.captionHook || candidate.title}</strong>
                                    <span>{candidate.publish?.hashtags?.join(' ') || candidate.tags?.join(', ')}</span>
                                </div>
                                <div className="rough-button-row">
                                    <button className="mini-action" type="button" onClick={() => copyText(candidatePostText(candidate))}>Copy post text</button>
                                    <button className="mini-action" type="button" onClick={() => captionCandidate(candidate)}>Caption this</button>
                                    <button className="mini-action" type="button" onClick={() => {
                                        setSelected(prev => ({ ...prev, [candidate.index]: false }));
                                        saveCandidateDecision(candidate, 'rejected', 'Rejected from candidate board');
                                    }}>Reject</button>
                                </div>
                            </article>
                        ))}
                    </div>
                </section>
            )}

            {packageResult?.success && (
                <section className="shorts-panel">
                    <div className="timeline-subhead-row">
                        <span className="timeline-subhead">Package selected</span>
                        <button className="mini-action" type="button" onClick={() => copyText(packageResult.packageText || packageBundleText(packageResult.packages))}>Copy all</button>
                    </div>
                    <div className="shorts-package-list">
                        {packageResult.packages.map(item => (
                            <article className="shorts-package-row" key={item.candidateIndex}>
                                <strong>{item.title}</strong>
                                <small>{item.timelineName}</small>
                                <small>{item.range?.startLabel} - {item.range?.endLabel} / {packageRenderLabel(item)}</small>
                                <div className="shorts-package-copy">
                                    <span>Post</span>
                                    <p>{item.postText}</p>
                                </div>
                                <div className="shorts-package-copy">
                                    <span>Caption prompt</span>
                                    <p>{item.captionPrompt}</p>
                                </div>
                                <div className="rough-button-row shorts-package-actions">
                                    <button className="mini-action" type="button" onClick={() => copyText(item.postText)}>Copy post</button>
                                    <button className="mini-action" type="button" onClick={() => copyText(item.captionPrompt)}>Copy captions</button>
                                    <button className="mini-action" type="button" onClick={() => copyText(`${item.timelineName}\n${packageRenderLabel(item)}`)}>Copy render prep</button>
                                </div>
                            </article>
                        ))}
                    </div>
                </section>
            )}

            <section className="shorts-panel">
                <span className="timeline-subhead">Saved Clip Finder projects</span>
                {projects.length === 0 ? (
                    <div className="sb-empty">No AI Clip Finder projects yet</div>
                ) : (
                    <div className="rough-plan-list">
                        {projects.slice(0, 8).map(project => (
                            <article className="rough-plan-row" key={project.id}>
                                <div>
                                    <strong>{project.sourceName}</strong>
                                    <small>{project.candidateCount} candidates / {project.selectedCount} selected</small>
                                </div>
                                <button className="mini-action" type="button" onClick={() => loadProject(project.id)}>Open</button>
                                <button className="mini-action danger" type="button" onClick={() => deleteProject(project.id)}>Delete</button>
                            </article>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
