import React, { useEffect, useMemo, useState } from 'react';

const STATUS_LABELS = {
    ready: 'Ready',
    'not-logged-in': 'Login needed',
    'not-installed': 'Not installed',
    checking: 'Checking',
    unknown: 'Unknown'
};

const RENDER_PRESETS = {
    prores_mov: {
        label: 'ProRes MOV',
        help: 'Alpha overlay, best for timeline graphics.',
        format: 'MOV',
        codec: 'ProRes 4444',
        encoder: 'CPU',
        alpha: 'Yes',
        patch: {
            renderPreset: 'prores_mov',
            outputFormat: 'prores',
            proresProfile: '4444',
            createProxy: false,
            proxyEncoder: 'auto',
            proxyQuality: 'balanced'
        }
    },
    mp4_cpu_quality: {
        label: 'CPU MP4 Quality',
        help: 'High-quality H.264 export without alpha.',
        format: 'MP4',
        codec: 'H.264',
        encoder: 'CPU',
        alpha: 'No',
        patch: {
            renderPreset: 'mp4_cpu_quality',
            outputFormat: 'h264',
            proresProfile: '4444',
            createProxy: false,
            proxyEncoder: 'libx264',
            proxyQuality: 'high'
        }
    },
    mp4_gpu_quality: {
        label: 'GPU MP4 Quality',
        help: 'NVIDIA HEVC NVENC HQ export without alpha.',
        format: 'MP4',
        codec: 'H.265 / HEVC',
        encoder: 'NVIDIA',
        alpha: 'No',
        patch: {
            renderPreset: 'mp4_gpu_quality',
            outputFormat: 'hevc_nvenc_hq',
            proresProfile: '4444',
            createProxy: false,
            proxyEncoder: 'h264_nvenc',
            proxyQuality: 'high'
        }
    }
};

function statusLabel(state) {
    return STATUS_LABELS[state] || String(state || 'unknown').replace(/-/g, ' ');
}

function presetIdForRenderSettings(settings = {}) {
    if (RENDER_PRESETS[settings.renderPreset]) return settings.renderPreset;
    if (settings.outputFormat === 'hevc_nvenc_hq') return 'mp4_gpu_quality';
    if (settings.outputFormat === 'h264') return 'mp4_cpu_quality';
    return 'prores_mov';
}

function SettingsHeader({ provider, model, onShowTools, onClose }) {
    return (
        <div className="settings-header">
            <div className="settings-heading">
                <span className="settings-eyebrow">Resolve AI</span>
                <h2>Settings</h2>
                <p>{provider} / {model}</p>
            </div>
            <div className="settings-header-actions">
                <button className="settings-toolbar-btn" onClick={onShowTools}>Tools</button>
                <button className="settings-toolbar-btn icon" onClick={onClose} aria-label="Close settings">×</button>
            </div>
        </div>
    );
}

function SettingsSection({ title, meta, children, defaultOpen = true }) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <section className={'settings-section ' + (open ? 'is-open' : '')}>
            <button
                type="button"
                className="settings-section-summary"
                aria-expanded={open}
                onClick={() => setOpen(value => !value)}
            >
                <span className="settings-section-title">{title}</span>
                {meta && <em>{meta}</em>}
            </button>
            {open && (
                <div className="settings-section-body">
                    {children}
                </div>
            )}
        </section>
    );
}

function SettingRow({ label, help, value, children }) {
    return (
        <div className="setting-row">
            <div className="setting-label">
                <span>{label}</span>
                {help && <small>{help}</small>}
            </div>
            {value && <div className="setting-value">{value}</div>}
            <div className="setting-control">{children}</div>
        </div>
    );
}

function StatusPill({ state }) {
    const normalized = state || 'unknown';
    return <span className={'status-pill ' + normalized}>{statusLabel(normalized)}</span>;
}

function ProviderHealthCard({ id, label, status, onLogin }) {
    const state = status?.status || 'unknown';
    const loginable = state !== 'ready' && state !== 'not-installed';
    return (
        <div className="provider-health-card">
            <div>
                <strong>{label}</strong>
                <span>{status?.version || 'Version unavailable'}</span>
            </div>
            <StatusPill state={state} />
            {loginable && (
                <button className="settings-small-btn" onClick={() => onLogin(id)}>Login</button>
            )}
        </div>
    );
}

export default function SidebarSettings({ config, onConfigChange, onShowTools, onClose }) {
    const [update, setUpdate] = useState(null);
    const [checking, setChecking] = useState(false);
    const [health, setHealth] = useState(null);
    const [logs, setLogs] = useState([]);
    const [rawOpen, setRawOpen] = useState(!!config.ui?.rawLogsOpen);
    const [brandKit, setBrandKit] = useState(config.brandKit || {});
    const [brandStatus, setBrandStatus] = useState('');
    const [timelineStatus, setTimelineStatus] = useState('');
    const [debugStatus, setDebugStatus] = useState('');

    useEffect(() => {
        runCheck(false);
        refreshHealth();
        const interval = setInterval(refreshHealth, 10000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        setRawOpen(!!config.ui?.rawLogsOpen);
        setBrandKit(config.brandKit || {});
    }, [config.brandKit, config.ui?.rawLogsOpen]);

    async function runCheck(force) {
        if (!window.updatesAPI) {
            setUpdate({ error: 'unavailable' });
            return;
        }
        setChecking(true);
        const minDelay = new Promise(r => setTimeout(r, 400));
        try {
            const [result] = await Promise.all([
                window.updatesAPI.check(force ? { force: true } : undefined),
                minDelay
            ]);
            setUpdate(result);
        } catch {
            setUpdate({ error: 'offline' });
        }
        setChecking(false);
    }

    function renderUpdateLink() {
        if (checking) return <button className="settings-small-btn" disabled>Checking</button>;
        if (update?.error) return <button className="settings-small-btn danger" onClick={() => runCheck(true)}>Retry</button>;
        if (update?.hasUpdate) {
            return (
                <button
                    className="settings-small-btn"
                    onClick={() => window.windowAPI.openExternal(update.downloadUrl)}
                >
                    Update v{String(update.latest).replace(/^v/, '')}
                </button>
            );
        }
        return <button className="settings-small-btn" onClick={() => runCheck(true)}>{update ? 'Up to date' : 'Check'}</button>;
    }

    async function refreshHealth() {
        if (!window.agentAPI?.health) return;
        try {
            const nextHealth = await window.agentAPI.health();
            const nextLogs = await window.agentAPI.getLogs({ includeHidden: true });
            setHealth(nextHealth);
            setLogs(nextLogs);
        } catch {
            setHealth(null);
        }
    }

    async function handleClearLogs() {
        await window.agentAPI.clearLogs();
        await refreshHealth();
    }

    async function handleDebugBundle() {
        setDebugStatus('Creating');
        try {
            const result = await window.debugAPI?.createBundle?.();
            setDebugStatus(result?.success ? 'Bundle ready' : 'Failed');
        } catch {
            setDebugStatus('Failed');
        }
        setTimeout(() => setDebugStatus(''), 2600);
    }

    async function handleRawToggle() {
        const next = !rawOpen;
        setRawOpen(next);
        await onConfigChange({ ui: { ...(config.ui || {}), rawLogsOpen: next } });
    }

    async function handleSaveBrand() {
        setBrandStatus('Saving');
        await onConfigChange({ brandKit });
        setBrandStatus('Saved');
        setTimeout(() => setBrandStatus(''), 1600);
    }

    async function handleUseTimelineSettings() {
        setTimelineStatus('Checking');
        try {
            const timeline = await window.resolveAPI.getTimelineSettings();
            const patch = {};
            if (timeline?.fps) patch.fps = timeline.fps;
            if (timeline?.width && timeline?.height) {
                patch.width = timeline.width;
                patch.height = timeline.height;
            }
            if (Object.keys(patch).length === 0) {
                setTimelineStatus('Unavailable');
            } else {
                await onConfigChange(patch);
                setTimelineStatus(timeline?.name ? `Using ${timeline.name}` : 'Synced');
            }
        } catch {
            setTimelineStatus('Unavailable');
        }
        setTimeout(() => setTimelineStatus(''), 2400);
    }

    function updateRenderSetting(patch) {
        onConfigChange({
            render: {
                ...(config.render || {}),
                ...patch
            }
        });
    }

    const provider = config.provider || 'auto';
    const modelValue = provider === 'codex' ? (config.codexModel || 'default') : (config.model || 'sonnet');
    const activeProvider = health?.activeProvider || provider;
    const activeModel = health?.activeModel || modelValue;
    const versionText = update?.current ? `v${update.current}` : 'Resolve AI';
    const timelineText = timelineStatus || `${config.width}×${config.height} / ${config.fps}fps`;
    const activeProviderStatus = health?.providers?.[activeProvider]?.status || health?.providers?.[provider]?.status || 'unknown';
    const renderSettings = {
        renderPreset: 'prores_mov',
        outputFormat: 'prores',
        proresProfile: '4444',
        threads: 'auto',
        createProxy: false,
        proxyEncoder: 'auto',
        proxyQuality: 'balanced',
        ...(config.render || {})
    };
    const renderPresetId = presetIdForRenderSettings(renderSettings);
    const renderPreset = RENDER_PRESETS[renderPresetId] || RENDER_PRESETS.prores_mov;
    const renderMeta = renderPreset.label;
    const renderCodec = renderSettings.outputFormat === 'prores' && renderSettings.proresProfile === '4444xq'
        ? 'ProRes 4444 XQ'
        : renderPreset.codec;
    const brandFilledCount = useMemo(() => {
        return ['colors', 'fonts', 'tone', 'logoPath', 'phrases'].filter(key => String(brandKit[key] || '').trim()).length;
    }, [brandKit]);

    return (
        <div className="settings settings-full">
            <SettingsHeader
                provider={activeProvider}
                model={activeModel}
                onShowTools={onShowTools}
                onClose={onClose}
            />

            <div className="settings-scroll">
                <SettingsSection title="Provider" meta={statusLabel(activeProviderStatus)}>
                    <div className="settings-summary-strip">
                        <span>Active</span>
                        <strong>{activeProvider} / {activeModel}</strong>
                        <StatusPill state={activeProviderStatus} />
                    </div>

                    <SettingRow label="Provider" help="Choose which local AI CLI handles prompts.">
                        <select
                            className="select"
                            value={provider}
                            onChange={e => onConfigChange({ provider: e.target.value })}
                        >
                            <option value="auto">Auto · first ready</option>
                            <option value="claude">Claude Code</option>
                            <option value="codex">Codex CLI</option>
                        </select>
                    </SettingRow>

                    <SettingRow label="Model" help={provider === 'codex' ? 'Codex CLI model preference.' : 'Claude Code model preference.'}>
                        <select
                            className="select"
                            value={modelValue}
                            onChange={e => {
                                if (provider === 'codex') onConfigChange({ codexModel: e.target.value });
                                else onConfigChange({ model: e.target.value });
                            }}
                        >
                            {provider === 'codex' ? (
                                <>
                                    <option value="default">Codex default</option>
                                    <option value="gpt-5.3-codex">GPT-5.3 Codex</option>
                                    <option value="gpt-5.4-mini">GPT-5.4 Mini</option>
                                    <option value="gpt-5.5">GPT-5.5</option>
                                </>
                            ) : (
                                <>
                                    <option value="sonnet">Sonnet · fast</option>
                                    <option value="opus">Opus · smart</option>
                                </>
                            )}
                        </select>
                    </SettingRow>

                </SettingsSection>

                <SettingsSection title="Timeline" meta={timelineText}>
                    <SettingRow label="FPS" help="Used for prompt context and ProRes rendering.">
                        <select
                            className="select"
                            value={config.fps}
                            onChange={e => onConfigChange({ fps: Number(e.target.value) })}
                        >
                            <option value={24}>24</option>
                            <option value={25}>25</option>
                            <option value={30}>30</option>
                            <option value={60}>60</option>
                        </select>
                    </SettingRow>

                    <SettingRow label="Size" help="Canvas size for generated overlays.">
                        <select
                            className="select"
                            value={`${config.width}x${config.height}`}
                            onChange={e => {
                                const [w, h] = e.target.value.split('x').map(Number);
                                onConfigChange({ width: w, height: h });
                            }}
                        >
                            <option value="1920x1080">1920 × 1080</option>
                            <option value="3840x2160">3840 × 2160</option>
                            <option value="1080x1920">1080 × 1920 vertical</option>
                            <option value="1080x1350">1080 × 1350</option>
                            <option value="1080x1080">1080 × 1080</option>
                        </select>
                    </SettingRow>

                    <button className="settings-wide-action" onClick={handleUseTimelineSettings}>
                        Use current timeline settings
                    </button>
                </SettingsSection>

                <SettingsSection title="Render" meta={renderMeta} defaultOpen={false}>
                    <div className="render-settings-note">
                        Pick the final deliverable first. ProRes MOV keeps transparency for Resolve overlays. MP4 presets are smaller and faster, but flatten alpha.
                    </div>
                    <SettingRow label="Preset" help={renderPreset.help}>
                        <select
                            className="select"
                            value={renderPresetId}
                            onChange={e => updateRenderSetting(RENDER_PRESETS[e.target.value]?.patch || RENDER_PRESETS.prores_mov.patch)}
                        >
                            <option value="prores_mov">ProRes MOV</option>
                            <option value="mp4_cpu_quality">CPU MP4 Quality</option>
                            <option value="mp4_gpu_quality">GPU MP4 Quality</option>
                        </select>
                    </SettingRow>
                    <div className="render-export-summary" aria-label="Current render export settings">
                        <div>
                            <span>Format</span>
                            <strong>{renderPreset.format}</strong>
                        </div>
                        <div>
                            <span>Codec</span>
                            <strong>{renderCodec}</strong>
                        </div>
                        <div>
                            <span>Encoder</span>
                            <strong>{renderPreset.encoder}</strong>
                        </div>
                        <div>
                            <span>Alpha</span>
                            <strong>{renderPreset.alpha}</strong>
                        </div>
                    </div>
                    <SettingRow label="ProRes profile" help="4444 is smaller. 4444 XQ is heavier and slower.">
                        <select
                            className="select"
                            value={renderSettings.proresProfile}
                            onChange={e => updateRenderSetting({ proresProfile: e.target.value })}
                            disabled={renderSettings.outputFormat !== 'prores'}
                        >
                            <option value="4444">ProRes 4444</option>
                            <option value="4444xq">ProRes 4444 XQ</option>
                        </select>
                    </SettingRow>
                    <SettingRow label="FFmpeg threads" help="Auto is safest. Limit threads if Resolve feels sluggish while rendering.">
                        <select
                            className="select"
                            value={renderSettings.threads}
                            onChange={e => updateRenderSetting({ threads: e.target.value })}
                        >
                            <option value="auto">Auto</option>
                            <option value="2">2 threads</option>
                            <option value="4">4 threads</option>
                            <option value="8">8 threads</option>
                            <option value="12">12 threads</option>
                            <option value="16">16 threads</option>
                        </select>
                    </SettingRow>
                    <SettingRow label="MP4 proxy" help="For ProRes final renders, also create a fast preview copy beside the .mov.">
                        <label className="settings-toggle">
                            <input
                                type="checkbox"
                                checked={renderSettings.outputFormat === 'prores' && !!renderSettings.createProxy}
                                disabled={renderSettings.outputFormat !== 'prores'}
                                onChange={e => updateRenderSetting({ createProxy: e.target.checked })}
                            />
                            <span>{renderSettings.outputFormat !== 'prores' ? 'Not needed for MP4 final' : renderSettings.createProxy ? 'Create proxy' : 'Off'}</span>
                        </label>
                    </SettingRow>
                    <SettingRow label="H.264 encoder" help="Used for MP4 final renders and optional MP4 proxies.">
                        <select
                            className="select"
                            value={renderSettings.proxyEncoder}
                            onChange={e => updateRenderSetting({ proxyEncoder: e.target.value })}
                            disabled={renderSettings.outputFormat === 'hevc_nvenc_hq' || (renderSettings.outputFormat === 'prores' && !renderSettings.createProxy)}
                        >
                            <option value="auto">Auto hardware</option>
                            <option value="h264_nvenc">NVIDIA NVENC H.264</option>
                            <option value="h264_videotoolbox">Apple VideoToolbox H.264</option>
                            <option value="h264_qsv">Intel Quick Sync H.264</option>
                            <option value="libx264">Software H.264</option>
                        </select>
                    </SettingRow>
                    {renderPresetId === 'mp4_gpu_quality' && (
                        <div className="render-settings-preset">
                            <strong>GPU MP4 Quality preset</strong>
                            <code>-c:v hevc_nvenc -preset slow -tune hq -rc constqp -init_qpI 22 -init_qpP 25 -init_qpB 28 -bf 3 -b_ref_mode middle -rc-lookahead 32 -multipass fullres -profile:v main</code>
                        </div>
                    )}
                    <SettingRow label="H.264 quality" help="Small is faster/lighter. High is larger.">
                        <select
                            className="select"
                            value={renderSettings.proxyQuality}
                            onChange={e => updateRenderSetting({ proxyQuality: e.target.value })}
                            disabled={renderSettings.outputFormat === 'hevc_nvenc_hq' || (renderSettings.outputFormat === 'prores' && !renderSettings.createProxy)}
                        >
                            <option value="small">Small / fastest</option>
                            <option value="balanced">Balanced</option>
                            <option value="high">High quality</option>
                        </select>
                    </SettingRow>
                </SettingsSection>

                <SettingsSection title="Brand Kit" meta={`${brandFilledCount}/5 fields`} defaultOpen={false}>
                    <SettingRow label="Colors" help="Comma-separated brand colors.">
                        <input
                            className="text-field"
                            value={brandKit.colors || ''}
                            onChange={e => setBrandKit(prev => ({ ...prev, colors: e.target.value }))}
                            placeholder="#111111, white, amber"
                        />
                    </SettingRow>
                    <SettingRow label="Fonts" help="Preferred typefaces or style notes.">
                        <input
                            className="text-field"
                            value={brandKit.fonts || ''}
                            onChange={e => setBrandKit(prev => ({ ...prev, fonts: e.target.value }))}
                            placeholder="Fraunces, JetBrains Mono"
                        />
                    </SettingRow>
                    <SettingRow label="Tone" help="Visual personality for new generations.">
                        <input
                            className="text-field"
                            value={brandKit.tone || ''}
                            onChange={e => setBrandKit(prev => ({ ...prev, tone: e.target.value }))}
                            placeholder="clean, cinematic, precise"
                        />
                    </SettingRow>
                    <SettingRow label="Logo" help="Optional local logo path.">
                        <input
                            className="text-field"
                            value={brandKit.logoPath || ''}
                            onChange={e => setBrandKit(prev => ({ ...prev, logoPath: e.target.value }))}
                            placeholder="C:\\path\\logo.png"
                        />
                    </SettingRow>
                    <SettingRow label="Phrases" help="Words or phrases the assistant may reuse.">
                        <textarea
                            className="text-field textarea"
                            value={brandKit.phrases || ''}
                            onChange={e => setBrandKit(prev => ({ ...prev, phrases: e.target.value }))}
                            placeholder="Common phrases"
                            rows={3}
                        />
                    </SettingRow>
                    <button className="settings-wide-action primary" onClick={handleSaveBrand}>
                        {brandStatus || 'Save brand kit'}
                    </button>
                </SettingsSection>

                <SettingsSection title="Diagnostics" meta={logs.length ? `${logs.length} logs` : 'Quiet'} defaultOpen={false}>
                    <div className="provider-health-grid">
                        <ProviderHealthCard
                            id="claude"
                            label="Claude"
                            status={health?.providers?.claude}
                            onLogin={id => window.agentAPI.openProviderLoginTerminal(id)}
                        />
                        <ProviderHealthCard
                            id="codex"
                            label="Codex"
                            status={health?.providers?.codex}
                            onLogin={id => window.agentAPI.openProviderLoginTerminal(id)}
                        />
                    </div>
                    {health?.logs?.lastFailure && (
                        <div className="last-failure">{health.logs.lastFailure.message}</div>
                    )}
                    <div className="diagnostic-actions">
                        <button className="settings-small-btn" onClick={refreshHealth}>Refresh health</button>
                        <button className="settings-small-btn" onClick={handleRawToggle}>
                            {rawOpen ? 'Hide raw logs' : 'Show raw logs'}
                        </button>
                        <button className="settings-small-btn" onClick={handleDebugBundle}>
                            {debugStatus || 'Copy debug bundle'}
                        </button>
                        {logs.length > 0 && <button className="settings-small-btn danger" onClick={handleClearLogs}>Clear logs</button>}
                    </div>
                    {rawOpen && (
                        <div className="raw-logs" tabIndex={0}>
                            {logs.length === 0 ? (
                                <div className="raw-empty">No logs captured</div>
                            ) : logs.slice(-80).map(log => (
                                <div className={'raw-line ' + (log.hidden ? 'muted' : log.level)} key={log.id}>
                                    <span>{log.provider}/{log.stream}</span>
                                    <code>{log.message}</code>
                                </div>
                            ))}
                        </div>
                    )}
                </SettingsSection>

                <SettingsSection title="App" meta={versionText} defaultOpen={false}>
                    <div className="settings-app-row">
                        <div>
                            <strong>Resolve AI</strong>
                            <span>{versionText}</span>
                        </div>
                        {renderUpdateLink()}
                    </div>
                </SettingsSection>
            </div>
        </div>
    );
}
