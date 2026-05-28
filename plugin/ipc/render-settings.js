const RENDER_PRESETS = {
  prores_mov: {
    label: 'ProRes MOV',
    summary: 'Alpha overlay',
    format: 'MOV',
    codec: 'ProRes 4444',
    encoder: 'CPU',
    alpha: true,
    outputFormat: 'prores',
    proresProfile: '4444',
    createProxy: false,
    proxyEncoder: 'auto',
    proxyQuality: 'balanced'
  },
  mp4_cpu_quality: {
    label: 'CPU MP4 Quality',
    summary: 'Portable master',
    format: 'MP4',
    codec: 'H.264',
    encoder: 'CPU',
    alpha: false,
    outputFormat: 'h264',
    proresProfile: '4444',
    createProxy: false,
    proxyEncoder: 'libx264',
    proxyQuality: 'high'
  },
  mp4_gpu_quality: {
    label: 'GPU MP4 Quality',
    summary: 'HEVC NVENC HQ',
    format: 'MP4',
    codec: 'H.265 / HEVC',
    encoder: 'NVIDIA',
    alpha: false,
    outputFormat: 'hevc_nvenc_hq',
    proresProfile: '4444',
    createProxy: false,
    proxyEncoder: 'h264_nvenc',
    proxyQuality: 'high'
  }
};

function isKnownPreset(presetId) {
  return Object.prototype.hasOwnProperty.call(RENDER_PRESETS, presetId);
}

function presetForRenderSettings(input = {}) {
  const outputFormat = String(input.outputFormat || '').toLowerCase();
  if (outputFormat === 'hevc_nvenc_hq') return 'mp4_gpu_quality';
  if (outputFormat === 'h264') return 'mp4_cpu_quality';
  if (outputFormat === 'prores') return 'prores_mov';
  if (isKnownPreset(input.renderPreset)) return input.renderPreset;
  return 'prores_mov';
}

function applyRenderPreset(presetId, overrides = {}) {
  const safePresetId = isKnownPreset(presetId) ? presetId : 'prores_mov';
  const preset = RENDER_PRESETS[safePresetId];
  const { renderPreset: _ignoredRenderPreset, ...safeOverrides } = overrides || {};
  return {
    renderPreset: safePresetId,
    outputFormat: preset.outputFormat,
    proresProfile: preset.proresProfile,
    threads: safeOverrides.threads || 'auto',
    createProxy: preset.createProxy,
    proxyEncoder: preset.proxyEncoder,
    proxyQuality: preset.proxyQuality,
    ...safeOverrides
  };
}

function normalizeRenderSettings(input = {}) {
  const renderPreset = presetForRenderSettings(input);
  const preset = RENDER_PRESETS[renderPreset] || RENDER_PRESETS.prores_mov;
  const merged = { ...preset, ...input };
  const outputFormat = ['prores', 'h264', 'hevc_nvenc_hq'].includes(String(merged.outputFormat || '').toLowerCase())
    ? String(merged.outputFormat).toLowerCase()
    : preset.outputFormat;
  const proresProfile = ['4444', '4444xq'].includes(String(input.proresProfile || '').toLowerCase())
    ? String(input.proresProfile).toLowerCase()
    : preset.proresProfile;
  const threadsValue = String(merged.threads || 'auto').toLowerCase();
  const threads = threadsValue === 'auto' || !Number.isFinite(Number(threadsValue))
    ? 'auto'
    : String(Math.max(1, Math.min(32, Math.floor(Number(threadsValue)))));
  const proxyEncoder = [
    'auto',
    'h264_nvenc',
    'h264_videotoolbox',
    'h264_qsv',
    'libx264'
  ].includes(merged.proxyEncoder) ? merged.proxyEncoder : preset.proxyEncoder;
  const proxyQuality = ['small', 'balanced', 'high'].includes(merged.proxyQuality) ? merged.proxyQuality : preset.proxyQuality;
  return {
    renderPreset,
    outputFormat,
    proresProfile,
    threads,
    createProxy: Boolean(merged.createProxy),
    proxyEncoder,
    proxyQuality
  };
}

function renderPresetDetails(settings = {}) {
  const normalized = normalizeRenderSettings(settings);
  const preset = RENDER_PRESETS[normalized.renderPreset] || RENDER_PRESETS.prores_mov;
  return {
    id: normalized.renderPreset,
    label: preset.label,
    summary: preset.summary,
    format: preset.format,
    codec: normalized.outputFormat === 'prores' && normalized.proresProfile === '4444xq' ? 'ProRes 4444 XQ' : preset.codec,
    encoder: preset.encoder,
    alpha: preset.alpha
  };
}

function proxyPathFor(movPath) {
  return String(movPath || '').replace(/\.mov$/i, '.preview.mp4');
}

function extensionForRenderSettings(settings = {}) {
  return normalizeRenderSettings(settings).outputFormat === 'prores' ? '.mov' : '.mp4';
}

module.exports = {
  RENDER_PRESETS,
  applyRenderPreset,
  extensionForRenderSettings,
  normalizeRenderSettings,
  presetForRenderSettings,
  renderPresetDetails,
  proxyPathFor
};
