# Resolve AI v0.6.3-beta

Patch release focused on installer behavior for optional local tools.

## What's Changed

- The installer no longer installs `openai-whisper` automatically.
- Built-in transcription and SRT/VTT import remain available without any external Whisper package.
- Optional Manim auto-install now only runs inside Resolve AI's app-managed Python environment.
- If the local Python environment cannot be created, the installer skips Manim auto-install instead of falling back to system Python and risking pip permission errors.
- The in-app Manim install command now installs only `manim`.
- System-Python Manim repair commands now use `--user` to avoid protected global package directories.
- README and release notes now state that external Whisper is manual/optional.

## Included From v0.6.2-beta

- Rebuilt **Caption Studio** around a deterministic SRT/VTT/timestamped TXT workflow.
- Transparent Overlay captions render directly from parsed cues instead of sending an AI prompt.
- Overlay duration matches the caption span and placement uses selected clip start plus first cue offset.
- Native Text+ captions use a Media Pool Text+ template and Resolve `AppendToTimeline` clip info.
- SRT/WebVTT styling tags and entities are cleaned before rendering.
- Updated Codex provider defaults to use `gpt-5.5`.
- Release ZIPs include `START HERE.txt`, installer validation metadata, and stricter package validation.

## Install Assets

Upload these release ZIPs to GitHub Releases:

- `ResolveAI-Windows-v0.6.3-beta.zip`
- `ResolveAI-macOS-v0.6.3-beta.zip`

Use the uploaded `ResolveAI-...zip` files, not GitHub's automatic source-code ZIP.

Inside the ZIP, run:

- Windows: `Install Resolve AI.bat`
- macOS: `Install Resolve AI.command`

## Testing

Validated before release:

- PowerShell installer syntax parse
- `bash -n installer/install.sh`
- `npm --prefix plugin test`
- `npm --prefix plugin run package:release`
- `git diff --check`

## Known Limits

- DaVinci Resolve Studio is required for Workflow Integration plugins.
- macOS release ZIPs are best built on macOS so `.command` executable bits are preserved. If double-click is blocked, run `bash "Install Resolve AI.command"` once from Terminal.
- Manim is optional; normal overlay generation does not require it.
- External Whisper is optional and manually configured.
