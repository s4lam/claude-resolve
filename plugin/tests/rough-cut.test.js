const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildClipInfos,
  buildCutPlanPrompt,
  buildDryRunSummary,
  buildIntelliScriptText,
  buildShortsPrompt,
  buildShortsPublishPackage,
  buildTranscriptHash,
  chunkTranscript,
  deleteCutPlan,
  detectTranscriptOffsetSeconds,
  fitRangesToTarget,
  getCutPlan,
  listCutPlans,
  makeShortTimelineName,
  makeTimelineName,
  normalizeRanges,
  parseCutPlanJson,
  publicSelectedMediaResult,
  parseTimestamp,
  parseTimestampedTxt,
  parseTranscriptText,
  removeToKeep,
  saveCutPlan,
  secondsToSourceFrameRange,
  summarizeAppendResult,
  validateCutPlan,
  validateShortsPlan
} = require('../ipc/rough-cut');

const srt = `1
00:00:01,000 --> 00:00:03,500
First useful moment.

2
00:00:04,000 --> 00:00:07,000
Funny reaction here.`;

const vtt = `WEBVTT

00:00:02.000 --> 00:00:04.000
Second useful moment.`;

const txt = `[00:00:01.000 - 00:00:02.000] A timestamped line
00:00:03.000 --> 00:00:04.500 Another timestamped line`;

assert.strictEqual(parseTimestamp('00:01:12.400'), 72.4);
assert.strictEqual(parseTimestamp('01:12.400'), 72.4);
assert.strictEqual(parseTimestamp('00:00:10:12', 24), 10.5);

const srtParsed = parseTranscriptText(srt, 'srt');
assert.strictEqual(srtParsed.hasTiming, true);
assert.strictEqual(srtParsed.cues.length, 2);
assert.strictEqual(srtParsed.analysis.wordCount, 6);

const vttParsed = parseTranscriptText(vtt, 'vtt');
assert.strictEqual(vttParsed.cues[0].text, 'Second useful moment.');

const txtParsed = parseTranscriptText(txt, 'txt');
assert.strictEqual(txtParsed.hasTiming, true);
assert.strictEqual(parseTimestampedTxt(txt).length, 2);

const hourBased = parseTranscriptText(`[01:00:09.250 - 01:00:17.291] Opening beat
01:01:16.541 --> 01:01:42.041 Second beat`, 'txt');
assert.strictEqual(detectTranscriptOffsetSeconds(hourBased.analysis, { durationSeconds: 120 }), 3600);
const hourChunks = chunkTranscript(hourBased.cues, 5000, { offsetSeconds: 3600 });
assert(hourChunks[0].text.includes('[00:00:09.250-00:00:17.291]'));

const storyOnly = parseTranscriptText('This is clean story text with no timestamps.', 'txt');
assert.strictEqual(storyOnly.hasTiming, false);
assert(storyOnly.warnings[0].includes('Untimestamped TXT'));
assert.strictEqual(buildIntelliScriptText({ storyText: storyOnly.storyText }), 'This is clean story text with no timestamps.');

const chunks = chunkTranscript(srtParsed.cues, 64);
assert(chunks.length >= 1);
assert(chunks[0].text.includes('First useful moment'));
assert.strictEqual(buildTranscriptHash('abc'), buildTranscriptHash('abc'));

const clip = {
  id: 'clip-1',
  name: 'Interview/A',
  fps: 23.976,
  durationSeconds: 20,
  sourceStartFrame: 1000,
  sourceStartTimecode: '00:00:41:17'
};

assert.strictEqual(publicSelectedMediaResult({ success: true, state: 'none', clips: [] }).message, 'Select one Media Pool clip to use AI Rough Cut.');
assert(publicSelectedMediaResult({ success: true, state: 'multiple', clips: [clip, { name: 'B' }] }).message.includes('supports one selected clip'));
assert.strictEqual(publicSelectedMediaResult({ success: true, state: 'ready', clips: [{ ...clip, timingReady: true }] }).state, 'ready');
assert.strictEqual(publicSelectedMediaResult({ success: true, state: 'ready', clips: [{ ...clip, timingReady: false, missingTiming: ['source FPS'] }] }).state, 'needs-metadata');

const prompt = buildCutPlanPrompt({
  cues: srtParsed.cues,
  goal: 'keep funny parts',
  targetDurationSeconds: 30,
  handleSeconds: 0.5,
  clip,
  provider: 'codex',
  model: 'gpt-5.5'
});
assert(prompt.includes('Return ONLY valid JSON'));
assert(prompt.includes('targetDurationSeconds'));
assert(prompt.includes('keep funny parts'));
assert(prompt.includes('30 seconds'));

const offsetPrompt = buildCutPlanPrompt({
  cues: hourBased.cues,
  goal: 'keep story beats',
  clip,
  transcriptOffsetSeconds: 3600
});
assert(offsetPrompt.includes('subtracting 01:00:00.000'));
assert(offsetPrompt.includes('[00:00:09.250-00:00:17.291]'));

const shortsPrompt = buildShortsPrompt({
  cues: hourBased.cues,
  goal: 'find viral clips',
  targetDurationSeconds: 60,
  maxClips: 4,
  clip,
  transcriptOffsetSeconds: 3600
});
assert(shortsPrompt.includes('standalone viral short-form clips'));
assert(shortsPrompt.includes('"clips"'));
assert(shortsPrompt.includes('"setup"'));
assert(shortsPrompt.includes('"payoff"'));
assert(shortsPrompt.includes('"ending"'));
assert(shortsPrompt.includes('"captionHook"'));
assert(shortsPrompt.includes('Do not stitch unrelated moments together'));
assert(shortsPrompt.includes('target is PER SHORT'));
assert(shortsPrompt.includes('Every clips[] entry becomes its own separate timeline'));
assert(shortsPrompt.includes('[00:00:09.250-00:00:17.291]'));

const validPlan = {
  goal: 'keep funny parts',
  targetDurationSeconds: 60,
  ranges: [
    { type: 'keep', start: '00:00:01.000', end: '00:00:03.500', reason: 'funny reaction', tags: ['funny'], confidence: 0.82 },
    { type: 'keep', start: '00:00:03.000', end: '00:00:04.000', reason: 'overlap', tags: ['important'], confidence: 0.72 }
  ]
};
const validation = validateCutPlan(validPlan, { clip, handleSeconds: 0.5 });
assert.strictEqual(validation.success, true);
assert.strictEqual(validation.normalizedRanges.length, 1);
assert.strictEqual(validation.normalizedRanges[0].start, 0.5);
assert.strictEqual(validation.normalizedRanges[0].end, 4.5);
assert(validation.normalizedRanges[0].tags.includes('funny'));
assert(validation.normalizedRanges[0].tags.includes('important'));

const badJson = parseCutPlanJson('not json');
assert.strictEqual(badJson.success, false);
const invalid = validateCutPlan({ goal: '', ranges: [] }, { clip });
assert.strictEqual(invalid.success, false);

const removePlan = {
  goal: 'remove dead air',
  ranges: [
    { type: 'remove', start: '00:00:05.000', end: '00:00:10.000', reason: 'dead air', tags: ['dead-air'], confidence: 0.9 }
  ]
};
const removeValidation = validateCutPlan(removePlan, { clip, handleSeconds: 0 });
assert.strictEqual(removeValidation.success, true);
assert.strictEqual(removeValidation.normalizedRanges.length, 2);
assert(removeValidation.warnings.join(' ').includes('converted'));
assert.strictEqual(removeToKeep([{ start: 2, end: 5 }], 8).length, 2);

const absoluteTimecodeValidation = validateCutPlan({
  goal: 'absolute timeline timecode',
  ranges: [{ type: 'keep', start: '01:00:09.250', end: '01:00:17.291', confidence: 0.9 }]
}, { clip: { ...clip, durationSeconds: 90 }, clipDurationSeconds: 90, transcriptOffsetSeconds: 3600, handleSeconds: 0 });
assert.strictEqual(absoluteTimecodeValidation.success, true);
assert.strictEqual(absoluteTimecodeValidation.normalizedRanges[0].start, 9.25);

const shortsRubric = {
  hookStrength: 0.9,
  standaloneContext: 0.86,
  payoff: 0.88,
  emotionOrSurprise: 0.8,
  cleanEnding: 0.84,
  captionTitlePotential: 0.87,
  confidence: 0.91
};

const whyThisWorks = {
  scrollStoppingHook: 'The opening line is clear enough to stop the scroll.',
  requiredContext: 'The clip explains the context without requiring the full video.',
  payoff: 'It lands a useful reveal.',
  cleanEnding: 'The thought resolves without cutting mid-sentence.',
  titleCaptionAngle: 'This changed everything'
};

const shortsPlan = {
  goal: 'find viral clips',
  targetDurationSeconds: 60,
  clips: [
    {
      title: 'Why This Moment Changed Everything',
      start: '01:00:09.250',
      end: '01:01:05.000',
      hook: 'clear standalone hook',
      setup: 'context before the reveal',
      payoff: 'the useful reveal',
      ending: 'clean stopping point',
      captionHook: 'This changed everything',
      reason: 'self-contained story beat',
      score: 0.91,
      tags: ['story', 'shorts'],
      rubricScores: shortsRubric,
      whyThisWorks
    },
    {
      title: 'Too Short',
      start: '01:02:00.000',
      end: '01:02:02.000',
      score: 0.8,
      rubricScores: shortsRubric,
      whyThisWorks
    }
  ]
};
const shortsValidation = validateShortsPlan(shortsPlan, {
  clip: { ...clip, durationSeconds: 400 },
  clipDurationSeconds: 400,
  transcriptOffsetSeconds: 3600,
  targetDurationSeconds: 60,
  handleSeconds: 0.5
});
assert.strictEqual(shortsValidation.success, true);
assert.strictEqual(shortsValidation.clips.length, 1);
assert.strictEqual(shortsValidation.clips[0].start, 8.75);
assert.strictEqual(shortsValidation.clips[0].title, 'Why This Moment Changed Everything');
assert.strictEqual(shortsValidation.clips[0].durationFit, 'target');
assert.strictEqual(shortsValidation.clips[0].structureScore, 1);
assert.strictEqual(shortsValidation.clips[0].rubricScores.hookStrength, 0.9);
assert.strictEqual(shortsValidation.clips[0].whyThisWorks.cleanEnding, whyThisWorks.cleanEnding);
assert.strictEqual(shortsValidation.clips[0].publish.captionHook, 'This changed everything');
assert(shortsValidation.clips[0].publish.hashtags.includes('#shorts'));
assert(shortsValidation.clips[0].publish.platformChecks.some(check => check.id === 'youtube-standard'));
assert(shortsValidation.warnings.join(' ').includes('too short'));

const publishPackage = buildShortsPublishPackage({
  title: 'One Useful Lesson',
  hook: 'The useful lesson starts here.',
  setup: 'viewer context',
  payoff: 'main lesson',
  durationSeconds: 45,
  tags: ['education', 'creator tips']
}, { clipName: 'Long Video' });
assert.strictEqual(publishPackage.platformChecks[0].status, 'ready');
assert(publishPackage.description.includes('Long Video'));
assert(publishPackage.captionPrompt.includes('First-frame hook'));

const shortForNinety = validateShortsPlan({
  goal: 'find full shorts',
  targetDurationSeconds: 90,
  clips: [
    { title: 'Too brief for target', start: '00:00:10.000', end: '00:00:42.000', hook: 'hook', setup: 'setup', payoff: 'payoff', ending: 'end', score: 0.99, rubricScores: shortsRubric, whyThisWorks }
  ]
}, { clip: { ...clip, durationSeconds: 120 }, clipDurationSeconds: 120, targetDurationSeconds: 90, handleSeconds: 0 });
assert.strictEqual(shortForNinety.success, false);
assert(shortForNinety.warnings.join(' ').includes('too short for the 90 target'));

const incompleteShort = validateShortsPlan({
  goal: 'strict standalone clips',
  targetDurationSeconds: 30,
  clips: [
    { title: 'Missing payoff', start: '00:00:10.000', end: '00:00:40.000', hook: 'hook', setup: 'setup', ending: 'end', score: 0.8, rubricScores: shortsRubric, whyThisWorks }
  ]
}, { clip: { ...clip, durationSeconds: 120 }, clipDurationSeconds: 120, targetDurationSeconds: 30, handleSeconds: 0 });
assert.strictEqual(incompleteShort.success, false);
assert(incompleteShort.warnings.join(' ').includes('must all be filled'));

const reviewShort = validateShortsPlan({
  goal: 'allow review clips',
  targetDurationSeconds: 30,
  clips: [
    { title: 'Missing payoff', start: '00:00:10.000', end: '00:00:40.000', hook: 'hook', setup: 'setup', ending: 'end', score: 0.8, rubricScores: shortsRubric, whyThisWorks }
  ]
}, { clip: { ...clip, durationSeconds: 120 }, clipDurationSeconds: 120, targetDurationSeconds: 30, handleSeconds: 0, allowReviewCandidates: true });
assert.strictEqual(reviewShort.success, true);
assert.strictEqual(reviewShort.clips[0].structureScore, 0.75);

const missingRubricShort = validateShortsPlan({
  goal: 'requires rubric',
  targetDurationSeconds: 30,
  clips: [
    { title: 'No rubric', start: '00:00:10.000', end: '00:00:40.000', hook: 'hook', setup: 'setup', payoff: 'payoff', ending: 'end', score: 0.8 }
  ]
}, { clip: { ...clip, durationSeconds: 120 }, clipDurationSeconds: 120, targetDurationSeconds: 30, handleSeconds: 0 });
assert.strictEqual(missingRubricShort.success, false);
assert(missingRubricShort.warnings.join(' ').includes('rubricScores'));

const longPlan = {
  goal: 'fit target',
  targetDurationSeconds: 90,
  ranges: [
    { type: 'keep', start: '00:00:00.000', end: '00:00:45.000', confidence: 0.7 },
    { type: 'keep', start: '00:01:00.000', end: '00:01:40.000', confidence: 0.95 },
    { type: 'keep', start: '00:02:00.000', end: '00:02:35.000', confidence: 0.9 },
    { type: 'keep', start: '00:03:00.000', end: '00:03:40.000', confidence: 0.8 }
  ]
};
const targetValidation = validateCutPlan(longPlan, { clip: { ...clip, durationSeconds: 260 }, targetDurationSeconds: 90, handleSeconds: 0 });
const targetDuration = targetValidation.normalizedRanges.reduce((sum, range) => sum + range.durationSeconds, 0);
assert.strictEqual(targetValidation.success, true);
assert(targetDuration <= 98);
assert(targetValidation.warnings.join(' ').includes('Target 90.0s applied'));
assert.strictEqual(fitRangesToTarget(targetValidation.normalizedRanges, null).ranges.length, targetValidation.normalizedRanges.length);

const oversizeFit = fitRangesToTarget([
  { start: 0, end: 140, confidence: 0.9 },
  { start: 200, end: 360, confidence: 0.7 }
], 90);
assert.strictEqual(oversizeFit.ranges.length, 1);
assert(oversizeFit.warning.includes('closest valid range'));

const tooShort = validateCutPlan({
  goal: 'too short',
  ranges: [{ type: 'keep', start: '00:00:01.000', end: '00:00:01.100', confidence: 2 }]
}, { clip, handleSeconds: 0, minDurationSeconds: 0.5 });
assert.strictEqual(tooShort.success, false);

const clamped = normalizeRanges({
  ranges: [{ type: 'keep', start: '00:00:00.100', end: '00:00:00.600' }]
}, { clip, handleSeconds: 1, minDurationSeconds: 0.5 });
assert.strictEqual(clamped.normalizedRanges[0].start, 0);

const frames23976 = secondsToSourceFrameRange({ start: 1, end: 2 }, clip);
assert.strictEqual(frames23976.success, true);
assert.strictEqual(frames23976.startFrame, 1023);
assert.strictEqual(frames23976.endFrameMode, 'inclusive');
assert.strictEqual(frames23976.durationFrames, 25);

const frames2997 = secondsToSourceFrameRange({ start: 10.5, end: 12 }, { fps: 29.97, sourceStartFrame: 107892 });
assert.strictEqual(frames2997.startFrame, 108206);
assert(frames2997.endFrame > frames2997.startFrame);

assert.strictEqual(secondsToSourceFrameRange({ start: 0, end: 1 }, { fps: null, sourceStartFrame: 0 }).success, false);
assert.throws(() => buildClipInfos([{ start: 0, end: 1 }], { fps: null, sourceStartFrame: 0 }, {}), /Missing source FPS/);

const mapped = buildClipInfos(validation.normalizedRanges, clip, { fake: true });
assert.strictEqual(mapped[0].clipInfo.startFrame, 1011);
assert(mapped[0].clipInfo.endFrame > mapped[0].clipInfo.startFrame);
assert.strictEqual(mapped[0].videoClipInfo.mediaType, 1);
assert.strictEqual(mapped[0].audioClipInfo.mediaType, 2);
assert.strictEqual(mapped[0].appendClipInfos.length, 1);
assert.strictEqual(mapped[0].appendClipInfos[0].mediaType, undefined);
assert.strictEqual(buildClipInfos(validation.normalizedRanges, clip, { fake: true }, { includeAudio: false })[0].appendClipInfos.length, 1);
assert.strictEqual(summarizeAppendResult({ requestedItems: 2, appendedItems: 1, sectionCount: 2, includeAudio: true }).length, 1);
assert.strictEqual(summarizeAppendResult({ requestedItems: 2, appendedItems: 2, sectionCount: 2, includeAudio: true }).length, 0);
assert(summarizeAppendResult({ requestedItems: 2, appendedItems: 0, sectionCount: 2, includeAudio: true })[0].includes('did not report'));

const dryRun = buildDryRunSummary({ clip, normalizedRanges: validation.normalizedRanges, handleSeconds: 0.5, timelineName: 'AI Rough Cut - Interview - 2026-05-30 14-22' });
assert.strictEqual(dryRun.keptSections, 1);
assert.strictEqual(dryRun.estimatedDurationSeconds, 4);

const timelineName = makeTimelineName('Interview/A', new Date('2026-05-30T14:22:00'));
assert.strictEqual(timelineName, 'AI Rough Cut - Interview_A - 2026-05-30 14-22');
assert.strictEqual(
  makeShortTimelineName({ index: 2, title: 'A viral/title?' }, 'Interview/A', new Date('2026-05-30T14:22:00')),
  'Short 02 - A viral_title - 2026-05-30 14-22'
);

const script = buildIntelliScriptText({ cues: srtParsed.cues, ranges: [{ start: 3.9, end: 8 }] });
assert.strictEqual(script, 'Funny reaction here.');
assert(!script.includes('confidence'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rough-cut-test-'));
const saved = saveCutPlan({
  transcriptHash: buildTranscriptHash(srt),
  clip,
  provider: 'codex',
  model: 'gpt-5.5',
  goal: validPlan.goal,
  targetDurationSeconds: 60,
  handleSeconds: 0.5,
  generatedPlan: validPlan,
  normalizedRanges: validation.normalizedRanges,
  validationWarnings: validation.warnings
}, tmp);
assert(saved.id);
assert.strictEqual(listCutPlans(tmp).length, 1);
assert.strictEqual(getCutPlan(saved.id, tmp).clipName, 'Interview/A');
assert.strictEqual(deleteCutPlan(saved.id, tmp).success, true);
assert.strictEqual(listCutPlans(tmp).length, 0);

console.log('rough cut tests passed');
