const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildAudioHints,
  deleteAnalysisReport,
  getAnalysisReport,
  listAnalysisReports,
  parseFfprobeJson,
  saveAnalysisReport
} = require('../ipc/analysis');
const {
  exportMarkerReport,
  markerReportText,
  normalizeMarker
} = require('../ipc/markers');
const {
  cap,
  createSafetySnapshot,
  getLatestSafetySnapshot,
  listSafetySnapshots
} = require('../ipc/resolve-diagnostics');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-ai-reliability-'));

try {
  const ready = cap('timeline', 'Timeline access', true, 'fallback');
  assert.strictEqual(ready.status, 'ready');
  assert.strictEqual(ready.fallback, '');

  const partial = cap('render', 'Resolve render settings', false, 'Use FFmpeg render.', { partial: true });
  assert.strictEqual(partial.status, 'partial');
  assert.strictEqual(partial.fallback, 'Use FFmpeg render.');

  const unavailable = cap('markers', 'Timeline markers', false, 'Export marker report instead.');
  assert.strictEqual(unavailable.status, 'unavailable');

  const snapshotDir = path.join(tmpRoot, 'snapshots');
  const snapshot = createSafetySnapshot({
    action: 'roughCut:applyCutPlan',
    clip: { name: 'Interview.mov', id: 'clip-1' },
    plannedRanges: [{ start: 1, end: 4 }],
    createdTimelineNames: ['AI Rough Cut - Interview - 2026-06-06 23-00']
  }, snapshotDir);
  assert.strictEqual(snapshot.action, 'roughCut:applyCutPlan');
  assert.strictEqual(listSafetySnapshots(snapshotDir).length, 1);
  assert.strictEqual(getLatestSafetySnapshot(snapshotDir).id, snapshot.id);

  const probe = parseFfprobeJson(JSON.stringify({
    format: { duration: '61.5', format_name: 'mov,mp4,m4a,3gp,3g2,mj2', bit_rate: '12000000' },
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '24000/1001', pix_fmt: 'yuv420p' },
      { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, channel_layout: 'stereo' }
    ]
  }));
  assert.strictEqual(probe.durationSeconds, 61.5);
  assert.strictEqual(probe.video.fps, 23.976);
  assert.strictEqual(probe.audio.sampleRate, 48000);

  const hints = buildAudioHints(probe, { cues: [{ start: 10, end: 12, text: 'key line' }] });
  assert(Array.isArray(hints));
  assert(hints.some(hint => hint.includes('less than half')));

  const analysisDir = path.join(tmpRoot, 'analysis');
  const report = {
    id: 'analysis-test',
    success: true,
    clipName: 'Interview.mov',
    createdAt: '2026-06-06T23:00:00.000Z',
    file: { fileName: 'Interview.mov' },
    technical: { durationSeconds: 61.5 },
    sidecarOnly: true
  };
  saveAnalysisReport(report, analysisDir);
  assert.strictEqual(listAnalysisReports(analysisDir)[0].clipName, 'Interview.mov');
  assert.strictEqual(getAnalysisReport('analysis-test', analysisDir).sidecarOnly, true);
  assert.deepStrictEqual(deleteAnalysisReport('analysis-test', analysisDir), { success: true });
  assert.strictEqual(getAnalysisReport('analysis-test', analysisDir), null);

  const marker = normalizeMarker({
    start: 2.5,
    fps: 24,
    tags: ['hook', 'important'],
    reason: 'Strong opening line.',
    confidence: 0.91
  });
  assert.strictEqual(marker.frame, 60);
  assert.strictEqual(marker.color, 'Green');
  assert(marker.customData.includes('0.91'));

  const markerDir = path.join(tmpRoot, 'markers');
  const markerReport = exportMarkerReport({
    markers: [{ start: 1, fps: 30, tags: ['payoff'], reason: 'Clean ending.' }],
    metadata: { projectName: 'Shorts Test', fps: 30 }
  }, markerDir);
  assert.strictEqual(markerReport.success, true);
  assert(fs.existsSync(markerReport.filePath));
  assert(markerReportText([{ start: 1, tags: ['caption'], reason: 'Caption moment.' }]).includes('Resolve AI Review Markers'));

  console.log('resolve-reliability tests passed');
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
