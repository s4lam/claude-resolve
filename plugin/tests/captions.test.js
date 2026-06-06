const assert = require('assert');
const {
  analyzeCaptionCues,
  buildCaptionPrompt,
  captionFitRules,
  estimateWordTimings,
  parseCaptionText,
  splitCuePhrases
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

const shortVtt = parseCaptionText(`WEBVTT

00:01.000 --> 00:02.000
Short format`, 'vtt');
assert.strictEqual(shortVtt.length, 1);
assert.strictEqual(shortVtt[0].start, 1);

const prompt = buildCaptionPrompt({ cues, style: 'karaoke', width: 1920, height: 1080, fps: 25 });
assert(prompt.includes('karaoke'));
assert(prompt.includes('Welcome to the show'));
assert(prompt.includes('transparent ProRes 4444 overlay'));
assert(prompt.includes('backgrounds to transparent'));
assert(prompt.includes('<caption_words>'));
assert(prompt.includes('Transcript stats'));

const kineticPrompt = buildCaptionPrompt({ cues, style: 'kinetic', width: 1920, height: 1080, fps: 25 });
assert(kineticPrompt.includes('<caption_phrases>'));

const verticalPrompt = buildCaptionPrompt({ cues, style: 'social shorts', width: 1080, height: 1920, fps: 30 });
assert(verticalPrompt.includes('Orientation: vertical 9:16 safe'));
assert(verticalPrompt.includes('x 7%-93%, y 12%-86%'));
assert(verticalPrompt.includes('max 2 lines'));
assert(verticalPrompt.includes('max-width around 86%'));
assert(verticalPrompt.includes('no horizontal scrolling, clipped words, or text outside the stage'));

const boldHookPrompt = buildCaptionPrompt({ cues, style: 'bold hook', width: 1080, height: 1920, fps: 30 });
assert(boldHookPrompt.includes('Bold hook captions'));
assert(boldHookPrompt.includes('<caption_phrases>'));

const documentaryPrompt = buildCaptionPrompt({ cues, style: 'documentary', width: 1080, height: 1920, fps: 30 });
assert(documentaryPrompt.includes('Minimal documentary captions'));

const verticalFit = captionFitRules({ width: 1080, height: 1920, style: 'bold hook' });
assert.strictEqual(verticalFit.vertical, true);
assert.strictEqual(verticalFit.maxLines, 2);

const timings = estimateWordTimings(cues[0]);
assert.strictEqual(timings.length, 4);
assert.strictEqual(timings[0].word, 'Welcome');
assert.strictEqual(timings[0].start, 1);
assert.strictEqual(timings[timings.length - 1].end, 2.5);

const phrases = splitCuePhrases({ start: 0, end: 4, text: 'one two three four five six' }, 3);
assert.strictEqual(phrases.length, 2);
assert.strictEqual(phrases[0].text, 'one two three');

const analysis = analyzeCaptionCues(cues);
assert.strictEqual(analysis.cueCount, 2);
assert.strictEqual(analysis.wordCount, 6);
assert.strictEqual(analysis.duration, 3);

console.log('captions tests passed');
