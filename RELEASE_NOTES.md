# Resolve AI v0.6.0-beta

Resolve AI is an AI motion graphics and creator workflow plugin for DaVinci Resolve. This beta is a major fork release that keeps the original Claude workflow compatible while adding Codex support, local-first creator tools, stronger render reliability, and a redesigned plugin UI.

## Highlights

- Rebranded visible UI to **Resolve AI** while preserving the legacy plugin ID and config paths for compatibility.
- Added provider support for both **Claude Code** and **OpenAI Codex CLI**.
- Added a full-height Settings sidebar with provider health, render diagnostics, app update checks, Brand Kit, raw logs, and Resolve capability reporting.
- Added Prompt Gallery, Template Packs, saved templates, render history improvements, and one-click prompt presets.
- Added Asset Library support for logos, textures, product images, backgrounds, references, notes, and selected-asset prompt context.
- Added AI Clip Finder / Shorts Studio for transcript-first long-form-to-Shorts candidate discovery.
- Added Caption Studio 2.0 with SRT/VTT/timestamped TXT parsing, smart regrouping, vertical-safe caption validation, overlay caption output, and optional native Text+ detection.
- Added Render Presets for ProRes MOV, CPU MP4 quality, and GPU MP4 quality with safer encoder fallback behavior.
- Added FFmpeg reliability improvements using renderer-local `ffmpeg-static` fallback, encoder probing, render health checks, and clearer render failure messages.
- Added source-safe Resolve diagnostics: capability report, media analysis sidecars, review marker normalization, and timeline safety snapshots.
- Added session/chat history so projects can be reopened independently.
- Added release packaging, smoke tests, visual smoke tests, and contribution templates.

## Install Assets

Upload these release ZIPs to GitHub Releases:

- `ResolveAI-Windows-v0.6.0-beta.zip`
- `ResolveAI-macOS-v0.6.0-beta.zip`

Recommended install path is the GitHub Release ZIP, not downloading the repo source ZIP.

## Provider Setup

- Claude users should install and log into Claude Code from Terminal.
- Codex users should install and log into Codex CLI from Terminal with `codex login`.
- Resolve AI does not store Codex API keys in the app.
- In `auto` mode, Resolve AI uses Claude when ready, otherwise Codex when ready.

## Local-First Notes

- Media files stay local unless the user explicitly exports or uploads them.
- Assets, sessions, templates, captions, analysis reports, render history, and safety snapshots are stored locally.
- Transcript text and prompts may be sent to the selected AI provider when AI processing is requested.
- Local Whisper / whisper.cpp transcription is optional and stays on the user's machine when configured.
- Source-safe media analysis writes sidecar reports only. It does not modify, transcode, proxy, relink, or overwrite source media.

## Known Limits

- DaVinci Resolve Studio is still required for Workflow Integration plugins.
- Native Resolve IntelliScript is not directly automated unless a public callable API is detected at runtime.
- AI Clip Finder requires timestamped SRT/VTT/TXT input for frame-accurate timeline creation.
- Native Text+ caption output is advanced and only enables when `fuscript` and the expected caption template are available.
- GPU MP4 depends on platform encoder availability. Unsupported GPU encoders fall back to CPU MP4.

## Testing

Validated before release:

- `npm --prefix plugin test`
- `npm --prefix plugin run build`
- `npm --prefix plugin run smoke`
- `npm --prefix plugin run smoke:visual`
- `git diff --check`

Manual checks still recommended before marking stable:

- Clean Windows install from release ZIP.
- Clean macOS install from release ZIP.
- Claude and Codex login/health checks.
- ProRes MOV render on Windows and macOS.
- Caption Studio import/regroup/render.
- AI Clip Finder transcript import and selected Short timeline creation.
- Settings > Diagnostics render and Resolve capability checks.
