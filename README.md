# Resolve AI

**AI motion graphics inside DaVinci Resolve.**

Resolve AI is a creator-focused DaVinci Resolve Studio Workflow Integration Plugin for AI motion graphics, clip discovery, captions, templates, and render packaging. Describe a title card, lower third, transition, caption overlay, logo reveal, or template idea, then preview, render, and add it to your timeline.

This project is an independent fork of [Claude Resolve](https://github.com/olegkupshukov/claude-resolve). It keeps Claude compatibility and adds Codex support, provider-neutral UI, asset-aware generation, render presets, sessions, prompt galleries, templates, and creator workflow tools.

Official fork repository: [s4lam/resolve-ai](https://github.com/s4lam/resolve-ai)

<img src="screenshots/welcome_screen.png" alt="Resolve AI welcome screen" width="600">

<img src="screenshots/ready-to-render.png" alt="Resolve AI render card" width="600">

## What Makes This Fork Different

- **Claude + Codex**: choose Claude Code, OpenAI Codex CLI, or Auto.
- **Resolve-style render presets**: ProRes MOV, CPU MP4 Quality, and GPU MP4 Quality.
- **Project sessions**: local chat/session history for separate projects and timelines.
- **Prompt Gallery + Templates**: reusable local prompt and template packs.
- **Asset-aware generation**: attach logos, product images, textures, references, and brand notes.
- **Timeline tools**: generate titles, lower thirds, transitions, and marker-based graphics with timeline context where Resolve exposes it.
- **AI Clip Finder**: turn one long Media Pool clip plus a timestamped transcript into scored standalone Shorts candidates, timelines, marker exports, and post packages.
- **One-click updates**: check, download, and stage GitHub Release updates from inside the plugin.
- **AI Rough Cut**: create non-destructive stitched rough-cut timelines from reviewed keep ranges.
- **Caption workflows**: import SRT/VTT or paste transcript text and create transparent caption overlays.
- **Local-first**: assets, transcripts, renders, templates, sessions, and provider auth stay on your machine.

## Requirements

- **DaVinci Resolve Studio 21+**. Workflow Integration Plugins require Studio.
- **Windows** or **macOS**.
- **Node.js 18+**.
- **ffmpeg** available in PATH.
- At least one supported AI CLI:
  - [OpenAI Codex CLI](https://developers.openai.com/codex/cli)
  - [Claude Code CLI](https://claude.ai/claude-code)

Check Node:

```bash
node --version
```

Install and log in to one or both providers:

```bash
npm install -g @openai/codex
codex login
```

```bash
npm install -g @anthropic-ai/claude-code
claude login
```

Resolve AI uses each CLI's own local auth. It does not ask for, store, or sync OpenAI or Anthropic API keys.

## Installation

### Recommended Release Install

1. Download the latest release ZIP from this fork's GitHub Releases:
   - Windows: `ResolveAI-Windows-vX.Y.Z.zip`
   - macOS: `ResolveAI-macOS-vX.Y.Z.zip`
2. Extract the ZIP.
3. Run the installer:
   - Windows: double-click `install.bat`
   - macOS: double-click `install.command`
4. Restart DaVinci Resolve after install.
5. Open **Workspace > Workflow Integration > Resolve AI**.

Use release ZIPs for normal installs. Source installs are for contributors because they require Node dependencies and a local build.

### Install From Source

```bash
npm --prefix plugin install
npm --prefix plugin run build
```

Then run the platform installer:

```bash
# Windows
install.bat
```

```bash
# macOS
bash install.command
```

On macOS, if Gatekeeper blocks the downloaded folder:

```bash
xattr -dr com.apple.quarantine .
chmod +x install.command install.sh
bash install.command
```

## Usage

1. Open **Workspace > Workflow Integration > Resolve AI**.
2. Choose a provider in Settings: Auto, Codex, or Claude.
3. Type a prompt, use Timeline tools, or pick from the Prompt Gallery.
4. Preview the generated motion graphic.
5. Pick a render preset:
   - **ProRes MOV** for transparent overlays.
   - **CPU MP4 Quality** for high-quality H.264 exports without alpha.
   - **GPU MP4 Quality** for NVIDIA HEVC NVENC HQ exports without alpha.
6. Click **Render .mov** or **Render .mp4**.

Rendered files are stored locally in the Resolve AI render history and imported into the current timeline when Resolve allows it.

### AI Clip Finder

1. Select one video clip in the Resolve Media Pool. Compound clips work only if they are Media Pool items with readable timing.
2. Open **Tools > Clip Finder**.
3. Import an SRT, VTT, or timestamped TXT transcript. Untimestamped TXT cannot create frame-accurate Shorts timelines.
4. Choose a goal preset such as viral moment, funny clip, lesson, story, debate/reaction, or strong quote. Optional local transcript generation appears only when Resolve transcription, Whisper, or whisper.cpp is detected/configured.
5. Review hook/setup/payoff/ending, rubric scores, and “why this might work.” Select the Shorts you want, then click **Create timelines**, **Package selected**, **Export markers**, or **Create + package**.

AI Clip Finder creates one new timeline per selected candidate. It saves selected/rejected feedback locally so future prompts can reflect your creator preferences. It does not modify the original clip or your current timeline.

### Local Transcription

Transcript import is the reliable default. AI Clip Finder can also show **Generate transcript locally** when one of these is available:

- Resolve `TranscribeAudio`, when exposed by your Resolve version.
- `whisper` from OpenAI Whisper.
- `whisper-cli` / whisper.cpp with a configured local model path.

Media stays local during local transcription. Transcript text may still be sent to the selected AI provider when you ask it to find clips or generate edits.

## Example Prompts

| Goal | Prompt |
| --- | --- |
| Title card | `Create a bold 5 second title card for a tech review channel, 1920x1080, premium motion, clean final hold.` |
| Lower third | `Create a transparent lower third for a podcast guest named Alex Rivera, subtle motion, readable over talking-head footage.` |
| Logo reveal | `Use the selected logo asset as the central mark in a 5 second transparent logo reveal.` |
| Captions | `Import this SRT and create kinetic social captions with word emphasis and transparent background.` |
| Transition | `Create a 2 second transparent transition overlay at the playhead, clean diagonal wipe, not too flashy.` |

## Features

- **Provider health**: install/login/version status for Claude and Codex.
- **Raw logs drawer**: keeps CLI noise out of chat while preserving diagnostics.
- **Prompt presets**: title card, lower third, caption, transition, logo reveal.
- **Regenerate actions**: more cinematic, simpler, transparent background, longer, same style, three variations.
- **Brand Kit**: colors, fonts, logo path, tone, and repeated phrases.
- **Asset Library**: drag/drop assets, categories, notes, health checks, selected-asset prompt injection.
- **AI Clip Finder**: standalone clip candidates with scoring rubric, hook/setup/payoff/ending, local preference learning, platform checks, marker export, caption prompts, and post text.
- **AI Rough Cut + IntelliScript Bridge**: reviewed keep ranges, non-destructive timelines, markers, and clean TXT export for native IntelliScript.
- **Template Library**: save generated overlays and reuse them later.
- **Prompt Gallery**: built-in creator, podcast, gaming, product, documentary, business, social, event, sports, and music ideas.
- **Community template packs**: local JSON packs with validation.
- **Caption Studio**: SRT/VTT parsing and caption style prompts.
- **Render history**: thumbnails, rename, reveal, delete, sync, and re-render.
- **One-click updater**: download and stage release updates while DaVinci Resolve stays open.
- **Showcase builder**: export a local static page from saved templates and renders.
- **Debug bundle**: collect useful diagnostics for issue reports.

## Security And Privacy

- No API keys are stored by the app.
- Provider login is handled by the provider CLI.
- Template pack URL installs block localhost, private network ranges, link-local metadata addresses, and unsafe redirects.
- Generated files, assets, sessions, captions, templates, and renders stay local.
- Transcript text and prompts may be sent to the selected AI provider when you ask it to generate candidates or edits.

## Compatibility Notes

The visible app name is **Resolve AI**.

Some internal identifiers intentionally remain unchanged for backwards compatibility with existing installs:

- Plugin ID: `com.clauderesolve.plugin`
- Legacy config/render folder: `Claude Resolve`

Do not rename those unless you are ready to migrate existing user data and installed plugin paths.

## Troubleshooting

- **Installer says `missing: dist/index.html`**: use the release ZIP or run `npm --prefix plugin run build`, then rerun the installer.
- **Installer says `missing: data/builtin-template-packs.json`**: update to the latest release ZIP and rerun the installer.
- **macOS says unidentified developer**: right-click `install.command`, choose **Open**, then confirm.
- **Render does nothing on macOS**: update to the latest fork version. The renderer now uses the installed Node runtime and shows visible render failures.
- **Render fails on macOS with no file**: check Settings > Diagnostics raw logs, confirm `ffmpeg` is installed, and use a writable render folder.
- **Codex or Claude says login/auth failed**: run `codex login` or `claude login` in Terminal, then reopen Resolve AI.
- **AI Clip Finder cannot create timelines**: select exactly one Media Pool video clip and use a timestamped transcript. If Resolve does not expose FPS, duration, or source start timecode/frame, timeline creation is blocked.
- **Generate transcript locally is hidden**: install/configure Whisper or whisper.cpp, or use Resolve transcription when available. SRT/VTT/timestamped TXT import is still the reliable default.
- **Update button cannot install**: install manually from the latest release ZIP. Protected plugin folders can still require Windows UAC or macOS admin permission.
- **MP4 is not transparent**: use **ProRes MOV**. MP4 presets flatten alpha.

## Development

```bash
npm --prefix plugin test
npm --prefix plugin run build
npm --prefix plugin run smoke
```

Package a release ZIP:

```bash
npm --prefix plugin run validate:release
npm --prefix plugin run package:release
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [community-templates](community-templates/README.md).

Useful contribution areas:

- New universal template packs.
- Better Resolve timeline actions.
- Render/installer reliability.
- Caption styles.
- Asset-aware generation improvements.
- UI polish for narrow plugin windows.

Suggested GitHub topics:

```text
davinci-resolve
motion-graphics
ai-video
codex
claude
electron
video-generation
resolve-ai
```

## Credits

Resolve AI is built from the excellent original [Claude Resolve](https://github.com/olegkupshukov/claude-resolve) project by Oleg Kupshukov. This fork takes the project in a broader multi-provider direction.

## License

MIT License. See [LICENSE](LICENSE) for details.

## Built With

- [OpenAI Codex CLI](https://developers.openai.com/codex/cli)
- [Claude Code](https://claude.ai/claude-code)
- [DaVinci Resolve Scripting API](https://www.blackmagicdesign.com/products/davinciresolve)
- [React](https://react.dev)
- [Playwright](https://playwright.dev)
- [ffmpeg](https://ffmpeg.org)
