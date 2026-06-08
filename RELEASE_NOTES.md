# Resolve AI v0.6.2-beta

Patch release focused on making Caption Studio usable for real SRT/VTT caption work.

## What's Changed

- Rebuilt **Caption Studio** around a deterministic SRT/VTT/timestamped TXT workflow:
  - import or paste timestamped captions;
  - regroup and edit cue text;
  - output as transparent overlay or native Resolve Text+.
- Transparent Overlay captions now render directly from parsed cues instead of sending an AI prompt.
- Overlay duration now matches the actual caption span (`last cue end - first cue start`) and no longer plays captions too fast.
- Overlay timeline placement now uses the selected clip start plus the first cue offset. If no clip is selected, Resolve AI falls back to the playhead and shows a warning.
- Caption HTML now uses `renderFrame(frame, fps)` with absolute cue time mapping, so cue timing is not stretched to fit the rendered asset.
- Native Text+ captions now use a Media Pool Text+ template and Resolve `AppendToTimeline` clip info for per-cue timing, preserving the template's styling.
- Removed the old Text+ path that inserted Fusion titles and tried to mutate duration afterward.
- SRT/WebVTT styling tags and entities are cleaned before rendering, so captions no longer show literal tags such as `<b>` or `<i>`.
- Added regression coverage for overlay span timing, timeline placement, Text+ append bridge generation, and caption markup cleanup.
- Updated Codex provider defaults to use `gpt-5.5` instead of the broken default-model path.
- Added app-managed setup support for local tools including Codex CLI, Claude Code, Manim, and Whisper.
- Moved internal installer scripts into `installer/` and kept friendly root launchers for Windows and macOS.
- Release ZIPs now include `START HERE.txt`, installer validation metadata, and stricter package validation.
- Manim Lab now has clearer setup/install handling and cleaner render error messages.
- Renderer frame planning now uses a rounded-up frame plan with encoded duration metadata, preventing short renders from losing their last frame.
- Rebuilt production `plugin/dist` assets for this release.

## Included From v0.6.0-beta

- Resolve AI branding with legacy plugin ID/config path compatibility.
- Claude Code and OpenAI Codex CLI provider support.
- Full-height Settings sidebar with provider health, raw logs, render diagnostics, Brand Kit, update checks, and Resolve capability reporting.
- Prompt Gallery, Template Packs, saved templates, render history, prompt presets, and Asset Library improvements.
- AI Clip Finder / Shorts Studio for transcript-first long-form-to-Shorts candidate discovery.
- Caption Studio 2.0 with smart regrouping, vertical-safe checks, overlay output, and optional native Text+ detection.
- Render presets for ProRes MOV, CPU MP4 quality, and GPU MP4 quality with safer encoder fallback.
- FFmpeg reliability improvements with renderer-local `ffmpeg-static`, encoder probing, and clearer render errors.
- Source-safe Resolve diagnostics: capability reports, media analysis sidecars, review markers, and timeline safety snapshots.
- Session/chat history.

## Install Assets

Upload these release ZIPs to GitHub Releases:

- `ResolveAI-Windows-v0.6.2-beta.zip`
- `ResolveAI-macOS-v0.6.2-beta.zip`

Use the uploaded `ResolveAI-...zip` files, not GitHub's automatic source-code ZIP.

Inside the ZIP, run:

- Windows: `Install Resolve AI.bat`
- macOS: `Install Resolve AI.command`

## Testing

Validated before release:

- `node plugin/tests/captions.test.js`
- `npm --prefix plugin run build`
- `npm --prefix plugin run package:release`
- `git diff --check`

## Known Limits

- DaVinci Resolve Studio is required for Workflow Integration plugins.
- macOS release ZIPs are best built on macOS so `.command` executable bits are preserved. If double-click is blocked, run `bash "Install Resolve AI.command"` once from Terminal.
- Native Resolve IntelliScript is only used if a public callable API is detected at runtime.
- AI Clip Finder requires timestamped SRT/VTT/TXT input for frame-accurate timeline creation.
- Native Text+ captions require `fuscript` and the expected caption template.
- GPU MP4 depends on platform encoder availability and falls back to CPU MP4 when unsupported.
