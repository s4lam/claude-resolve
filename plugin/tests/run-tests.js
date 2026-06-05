async function run() {
    require('./assets.test');
    require('./assets-health.test');
    require('./captions.test');
    require('./codex-args.test');
    require('./codex-parser.test');
    require('./codex-stderr-filter.test');
    require('./agent-health.test');
    require('./agent-logs.test');
    require('./config.test');
    await require('./create-workflow.test');
    require('./render-validation.test');
    require('./render-health.test');
    require('./render-settings.test');
    require('./ograph.test');
    require('./manim.test');
    require('./runtime-qa.test');
    require('./paths.test');
    require('./repair.test');
    require('./rough-cut.test');
    require('./shorts-studio.test');
    require('./showcase.test');
    require('./templates.test');
    require('./template-packs.test');
    require('./template-packs-url.test');
    require('./timeline.test');
    require('./updates.test');
    require('./variations.test');
    require('./render-queue.test');
    require('./sessions.test');

    console.log('all tests passed');
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
