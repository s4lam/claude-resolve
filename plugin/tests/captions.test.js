const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  analyzeCaptionCues,
  buildCaptionPrompt,
  buildNativeTextPayload,
  captionFitRules,
  deleteCaptionProject,
  detectNativeText,
  estimateWordTimings,
  getCaptionProject,
  listCaptionProjects,
  parseCaptionText,
  regroupCues,
  saveCaptionProject,
  validateCaptionFit
} = require('../ipc/captions');

const cues = parseCaptionText(`1
00:00:01,000 --> 00:00:02,500
Welcome to the show

2
00:00:03.000 --> 00:00:04.000
Let's begin`, 'srt');

assert.strictEqual(cues.length, 2);
assert.strictEqual(cues[0].start, 1);
assert.strictEqual(cues[0].end, 2.5);
assert.strictEqual(cues[1].text, "Let's begin");

const vtt = parseCaptionText(`WEBVTT

00:00:00.000 --> 00:00:01.200
Fast intro`, 'vtt');
assert.strictEqual(vtt.length, 1);
assert.strictEqual(vtt[0].end, 1.2);

const timestampedTxt = parseCaptionText(`[00:00:05.500] Timestamped text works
00:00:07.000 --> 00:00:08.000 second cue`, 'txt');
assert.strictEqual(timestampedTxt.length, 2);
assert.strictEqual(timestampedTxt[0].start, 5.5);

const untimestampedTxt = parseCaptionText('No timing here', 'txt');
assert.strictEqual(untimestampedTxt.length, 0);

const prompt = buildCaptionPrompt({ cues, style: 'karaoke', width: 1920, height: 1080, fps: 25 });
assert(prompt.includes('transparent caption overlay'));
assert(prompt.includes('Style: karaoke'));
assert(prompt.includes('<caption_words>'));
assert(prompt.includes('Caption stats'));

const verticalPrompt = buildCaptionPrompt({ cues, style: 'social shorts', width: 1080, height: 1920, fps: 30 });
assert(verticalPrompt.includes('Output orientation: vertical'));
assert(verticalPrompt.includes('x 7%-93%, y 12%-86%'));
assert(verticalPrompt.includes('max-width 86%'));
assert(verticalPrompt.includes('max 2 visible lines'));
assert(verticalPrompt.includes('no clipped words'));

const boldHookPrompt = buildCaptionPrompt({ cues, style: 'bold hook', width: 1080, height: 1920, fps: 30 });
assert(boldHookPrompt.includes('Style: bold hook'));
assert(boldHookPrompt.includes('<caption_words>'));

const documentaryPrompt = buildCaptionPrompt({ cues, style: 'documentary', width: 1080, height: 1920, fps: 30 });
assert(documentaryPrompt.includes('Style: documentary'));

const verticalFit = captionFitRules({ width: 1080, height: 1920, style: 'bold hook' });
assert.strictEqual(verticalFit.orientation, 'vertical');
assert.strictEqual(verticalFit.maxLines, 2);

const timings = estimateWordTimings(cues[0]);
assert.strictEqual(timings.length, 4);
assert.strictEqual(timings[0].word, 'Welcome');
assert.strictEqual(timings[0].start, 1);
assert.strictEqual(timings[timings.length - 1].end, 2.5);

const regrouped = regroupCues(parseCaptionText(`1
00:00:00,000 --> 00:00:06,000
one two three four five six seven eight`, 'srt'), { mode: 'punchy', maxWords: 3, maxChars: 30 });
assert.strictEqual(regrouped.cues.length, 3);
assert.strictEqual(regrouped.cues[0].text, 'one two three');
assert(regrouped.cues[0].end <= regrouped.cues[1].start);

const single = regroupCues(cues, { mode: 'single' });
assert(single.cues.every(cue => cue.text.split(/\s+/).length === 1));

const fitWarnings = validateCaptionFit([{ start: 0, end: 1, text: 'This caption is intentionally too long for vertical shorts and should warn loudly' }], { width: 1080, height: 1920, style: 'bold hook' });
assert(fitWarnings.warnings.length > 0);

const nativePayload = buildNativeTextPayload({
  cues: [{ start: 0, end: 1, text: 'hello"); os.execute("bad") --' }],
  templateName: 'Resolve AI Caption',
  fps: 30
});
assert.strictEqual(nativePayload.cues.length, 1);
assert(nativePayload.cues[0].text.includes('os.execute'));
assert(!JSON.stringify(nativePayload).includes('CAPTION_JOB'));

const missingNative = detectNativeText({ fuscriptPath: path.join(os.tmpdir(), 'missing-fuscript'), templateName: 'Resolve AI Caption' });
assert.strictEqual(missingNative.ready, false);

const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-ai-caption-test-'));
const saved = saveCaptionProject({ title: 'Round trip', cues, style: 'clean' }, projectDir);
assert(saved.id);
assert.strictEqual(listCaptionProjects(projectDir).length, 1);
assert.strictEqual(getCaptionProject(saved.id, projectDir).title, 'Round trip');
deleteCaptionProject(saved.id, projectDir);
assert.strictEqual(listCaptionProjects(projectDir).length, 0);

const analysis = analyzeCaptionCues(cues);
assert.strictEqual(analysis.cueCount, 2);
assert.strictEqual(analysis.wordCount, 6);
assert.strictEqual(analysis.duration, 3);

console.log('captions tests passed');
