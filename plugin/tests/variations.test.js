const assert = require('assert');
const { buildMultiVariationPrompt, buildVariationPrompt, buildVariationSet, lockLines } = require('../ipc/variations');

const locks = { logo: true, colors: true, typography: true, layout: false, animationOnly: true };
const lines = lockLines(locks);
assert(lines.some(line => line.includes('logo')));
assert(lines.some(line => line.includes('typography')));
assert(lines.some(line => line.includes('Only change animation')));

const prompt = buildVariationPrompt({
  basePrompt: 'Create a product launch title.',
  variation: { title: 'Minimal', instruction: 'Simplify it.' },
  locks,
  context: { width: 1920, height: 1080, fps: 25 },
  previousName: 'ProductLaunchHero',
  previousPrompt: 'Original product launch prompt',
  html: '<html></html>'
});

assert(prompt.includes('Create a product launch title.'));
assert(prompt.includes('1920x1080'));
assert(prompt.includes('Previous generated HTML'));
assert(prompt.includes('Keep the same color palette'));
assert(prompt.includes('Keep the same typography direction'));
assert(prompt.includes('Style reference name: ProductLaunchHero'));
assert(prompt.includes('Previous prompt: Original product launch prompt'));

const set = buildVariationSet({ basePrompt: 'Title card', count: 3, locks, html: '<html></html>', previousName: 'TitleLock' });
assert.strictEqual(set.success, true);
assert.strictEqual(set.variations.length, 3);
assert(set.variations[0].prompt.includes('Title card'));
assert(set.variations[0].prompt.includes('Style reference name: TitleLock'));

const multi = buildMultiVariationPrompt({
  basePrompt: 'Creator intro',
  count: 3,
  locks,
  previousName: 'CreatorIntro',
  previousPrompt: 'Original creator intro prompt',
  html: '<html></html>',
  context: { width: 1920, height: 1080, fps: 25 }
});
assert(multi.includes('Create exactly 3 complete'));
assert(multi.includes('Return exactly 3 fenced'));
assert(multi.includes('unique FILE'));
assert(multi.includes('Keep the selected logo'));
assert(multi.includes('Keep the same typography direction'));
assert(multi.includes('Style reference name: CreatorIntro'));
assert(multi.includes('Previous prompt: Original creator intro prompt'));
assert(multi.includes('Previous generated HTML context:'));

console.log('variations tests passed');
