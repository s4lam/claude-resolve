# Resolve AI v0.6.1-beta

Patch release focused on making Manim renders easier to understand and test from the plugin.

## What's Changed

- Clarified **Manim Lab** render destination before the user renders.
- Manim Lab now explains that rendered MP4 files are saved to **Resolve AI Render History**.
- Successful Manim renders now show:
  - rendered filename;
  - full output path;
  - **Reveal file**;
  - **View Renders**;
  - **Add at Playhead**;
  - **Sync to Media Pool**.
- Added path wrapping for long Manim output paths so the UI does not clip.
- Fixed the Manim-to-Renders navigation path in the sidebar.
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

- `ResolveAI-Windows-v0.6.1-beta.zip`
- `ResolveAI-macOS-v0.6.1-beta.zip`

Use the uploaded `ResolveAI-...zip` files, not GitHub's automatic source-code ZIP.

## Testing

Validated before release:

- `npm --prefix plugin test`
- `npm --prefix plugin run build`
- `npm --prefix plugin run smoke`
- `npm --prefix plugin run smoke:visual`
- `git diff --check`

## Known Limits

- DaVinci Resolve Studio is required for Workflow Integration plugins.
- Native Resolve IntelliScript is only used if a public callable API is detected at runtime.
- AI Clip Finder requires timestamped SRT/VTT/TXT input for frame-accurate timeline creation.
- Native Text+ captions require `fuscript` and the expected caption template.
- GPU MP4 depends on platform encoder availability and falls back to CPU MP4 when unsupported.
