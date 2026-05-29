# Resolve AI

**AI motion graphics inside DaVinci Resolve.**

Resolve AI is a creator-focused DaVinci Resolve Studio Workflow Integration Plugin for generating motion graphics with local AI CLIs. Describe a title card, lower third, transition, caption overlay, logo reveal, or template idea, then preview, render, and add it to your timeline.

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

1. Download the latest release ZIP from this fork's GitHub Releases.
2. Extract the ZIP.
3. Run the installer:
   - Windows: double-click `install.bat`
   - macOS: double-click `install.command`
4. Restart DaVinci Resolve.
5. Open **Workspace > Workflow Integration > Resolve AI**.

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
- **Template Library**: save generated overlays and reuse them later.
- **Prompt Gallery**: built-in creator, podcast, gaming, product, documentary, business, social, event, sports, and music ideas.
- **Community template packs**: local JSON packs with validation.
- **Caption Studio**: SRT/VTT parsing and caption style prompts.
- **Render history**: thumbnails, rename, reveal, delete, sync, and re-render.
- **Showcase builder**: export a local static page from saved templates and renders.
- **Debug bundle**: collect useful diagnostics for issue reports.

## Security And Privacy

- No API keys are stored by the app.
- Provider login is handled by the provider CLI.
- Template pack URL installs block localhost, private network ranges, link-local metadata addresses, and unsafe redirects.
- Generated files, assets, sessions, captions, templates, and renders stay local.

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
- **MP4 is not transparent**: use **ProRes MOV**. MP4 presets flatten alpha.

## Development

```bash
npm --prefix plugin test
npm --prefix plugin run build
```

Package a release ZIP:

```bash
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
