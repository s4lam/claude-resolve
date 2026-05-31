const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildPackage,
  buildCreatorProfile,
  deleteProject,
  detectLocalTranscribers,
  getProject,
  handleBuildCandidates,
  markerPayloadForCandidates,
  handlePackageSelected,
  listProjects,
  makePackageText,
  makePostText,
  writeProject
} = require('../ipc/shorts-studio');

const clip = {
  id: 'clip-1',
  name: 'Long Interview',
  fps: 23.976,
  durationSeconds: 600,
  sourceStartFrame: 1000
};

const candidate = {
  index: 1,
  title: 'One Useful Lesson',
  start: 12,
  end: 62,
  startLabel: '00:00:12.000',
  endLabel: '00:01:02.000',
  durationSeconds: 50,
  hook: 'The useful lesson starts here.',
  setup: 'Viewer context.',
  payoff: 'Main lesson.',
  ending: 'Clean end.',
  tags: ['education'],
  rubricScores: {
    hookStrength: 0.92,
    standaloneContext: 0.86,
    payoff: 0.88,
    emotionOrSurprise: 0.72,
    cleanEnding: 0.84,
    captionTitlePotential: 0.9,
    confidence: 0.87
  },
  whyThisWorks: {
    scrollStoppingHook: 'The lesson opens with a clear pain point.',
    requiredContext: 'The idea is understandable without the rest of the interview.',
    payoff: 'The clip gives one practical takeaway.',
    cleanEnding: 'The final sentence resolves the idea.',
    titleCaptionAngle: 'One Useful Lesson'
  },
  publish: {
    title: 'One Useful Lesson',
    captionHook: 'This one lesson saves time',
    description: 'The useful lesson starts here.\n\nSource: Long Interview',
    hashtags: ['#education', '#shorts'],
    captionPrompt: 'Create punchy captions.',
    platformChecks: [{ id: 'youtube-standard', label: 'YouTube Shorts', status: 'ready', message: 'Within 60s.' }]
  }
};

const prompt = handleBuildCandidates(null, {
  cues: [{ start: 12, end: 20, text: 'The useful lesson starts here.' }],
  goal: 'find useful standalone shorts',
  targetDurationSeconds: 60,
  clip
});
assert.strictEqual(prompt.success, true);
assert(prompt.displayText.includes('AI Clip Finder'));
assert(prompt.prompt.includes('standalone viral short-form clips'));
assert(prompt.prompt.includes('rubricScores'));

const pkg = buildPackage(candidate, clip);
assert.strictEqual(pkg.title, 'One Useful Lesson');
assert.strictEqual(pkg.renderPresetSuggestion.resolution, '1080x1920');
assert.strictEqual(pkg.renderPlan.kind, 'timeline-export-prep');
assert.strictEqual(pkg.renderPlan.timelineName, pkg.timelineName);
assert(pkg.postText.includes('#shorts'));
assert(pkg.postText.includes('One Useful Lesson'));
assert(pkg.captionPrompt.includes('captions'));
assert(makePostText(candidate).includes('Long Interview'));
assert(makePackageText([pkg]).includes('Caption prompt:'));
assert(makePackageText([pkg]).includes('Render: 1080x1920, H.265'));

const packaged = handlePackageSelected(null, { source: clip, candidates: [candidate], selectedIndexes: [1] });
assert.strictEqual(packaged.success, true);
assert.strictEqual(packaged.packages.length, 1);
assert(packaged.packageText.includes('Post text:'));
assert(packaged.packageText.includes('#education #shorts'));
assert.strictEqual(handlePackageSelected(null, { candidates: [candidate], selectedIndexes: [2] }).success, false);

const markers = markerPayloadForCandidates([candidate], [1]);
assert.strictEqual(markers.length, 1);
assert.strictEqual(markers[0].tags[0], 'education');

const profile = buildCreatorProfile([
  { decision: 'selected', tags: ['education', 'lesson'], durationSeconds: 50, feedbackReason: 'useful' },
  { decision: 'rejected', tags: ['rambling'], durationSeconds: 80, feedbackReason: 'too slow' }
]);
assert.strictEqual(profile.selectedCount, 1);
assert(profile.likedTags.includes('education'));
assert(profile.rejectedTags.includes('rambling'));

const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-transcriber-bin-'));
fs.writeFileSync(path.join(fakeBin, process.platform === 'win32' ? 'whisper.cmd' : 'whisper'), '');
fs.writeFileSync(path.join(fakeBin, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'), '');
const detection = detectLocalTranscribers({ transcription: { provider: 'none' } }, { envPath: fakeBin });
assert.strictEqual(detection.whisper.ready, true);
assert.strictEqual(detection.whisperCpp.modelReady, false);
const fakeModel = path.join(fakeBin, 'ggml-base.bin');
fs.writeFileSync(fakeModel, '');
const cppDetection = detectLocalTranscribers({ transcription: { provider: 'whisperCpp', model: fakeModel } }, { envPath: fakeBin });
assert.strictEqual(cppDetection.whisperCpp.ready, true);
assert.strictEqual(cppDetection.whisperCpp.modelReady, true);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-studio-test-'));
const saved = writeProject({
  source: clip,
  goal: 'find shorts',
  candidates: [candidate],
  selectedIndexes: [1],
  provider: 'codex',
  model: 'gpt-5.5'
}, tmp);
assert(saved.id);
assert.strictEqual(listProjects(tmp).length, 1);
assert.strictEqual(getProject(saved.id, tmp).source.name, 'Long Interview');
assert.strictEqual(deleteProject(saved.id, tmp).success, true);
assert.strictEqual(listProjects(tmp).length, 0);

console.log('shorts studio tests passed');
