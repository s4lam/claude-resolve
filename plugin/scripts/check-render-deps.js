#!/usr/bin/env node

const path = require('path');
const {
    getRenderHealth,
    summarizeRenderHealth
} = require('../ipc/render-health');

function print(line = '') {
    process.stdout.write(line + '\n');
}

function status(ok, label, detail) {
    print(`${ok ? 'OK' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`);
}

function main() {
    const json = process.argv.includes('--json');
    const health = getRenderHealth({});
    const summary = summarizeRenderHealth(health);

    const result = {
        ok: summary.ok,
        failures: summary.failures,
        warnings: summary.warnings,
        health
    };

    if (json) {
        print(JSON.stringify(result, null, 2));
    } else {
        print('Resolve AI render dependency self-test');
        status(Boolean(health.ffmpeg?.path), 'FFmpeg binary', health.ffmpeg?.path || health.ffmpeg?.error);
        status(Boolean(health.encoders?.prores_ks), 'ProRes encoder', 'prores_ks');
        status(Boolean(health.encoders?.libx264), 'CPU MP4 encoder', 'libx264');
        status(Boolean(health.renderFolder?.writable), 'Render folder', health.renderFolder?.path || '');
        status(Boolean(health.playwright?.ready ?? health.playwright?.installed), 'Playwright Chromium', health.playwright?.chromiumPath || health.playwright?.error || '');
        print(health.encoders?.[summary.gpuEncoder]
            ? `OK GPU MP4 encoder - ${summary.gpuEncoder}`
            : `WARN GPU MP4 encoder - ${summary.gpuEncoder} unavailable; CPU MP4 fallback will be used.`);
        if (summary.failures.length) {
            print('');
            print(`Fix: ${summary.fix}`);
            for (const failure of summary.failures) print(`- ${failure}`);
        }
    }

    process.exit(summary.ok ? 0 : 1);
}

main();
