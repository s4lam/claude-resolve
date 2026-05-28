function normalizeRenderSettings(input = {}) {
  const proresProfile = ['4444', '4444xq'].includes(String(input.proresProfile || '').toLowerCase())
    ? String(input.proresProfile).toLowerCase()
    : '4444';
  const threadsValue = String(input.threads || 'auto').toLowerCase();
  const threads = threadsValue === 'auto' || !Number.isFinite(Number(threadsValue))
    ? 'auto'
    : String(Math.max(1, Math.min(32, Math.floor(Number(threadsValue)))));
  const proxyEncoder = [
    'auto',
    'h264_nvenc',
    'h264_videotoolbox',
    'h264_qsv',
    'libx264'
  ].includes(input.proxyEncoder) ? input.proxyEncoder : 'auto';
  const proxyQuality = ['small', 'balanced', 'high'].includes(input.proxyQuality) ? input.proxyQuality : 'balanced';
  return {
    proresProfile,
    threads,
    createProxy: Boolean(input.createProxy),
    proxyEncoder,
    proxyQuality
  };
}

function proxyPathFor(movPath) {
  return String(movPath || '').replace(/\.mov$/i, '.preview.mp4');
}

module.exports = { normalizeRenderSettings, proxyPathFor };
