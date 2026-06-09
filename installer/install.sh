#!/bin/bash
# Resolve AI - macOS installer.
set -u

# Resolve our own location, then drop root if launched via sudo: Node/npm,
# app-managed CLIs, optional Manim, and Playwright live in the user's
# environment; only the final copy into /Library needs root.
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ]; then
    exec sudo -u "$SUDO_USER" bash "$SELF" "$@"
fi

INSTALLER_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$INSTALLER_DIR/.." && pwd)"
PLUGIN_SRC="$REPO_ROOT/plugin"
RENDERER_SRC="$PLUGIN_SRC/renderer"
DEST_PARENT="/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins"
DEST="$DEST_PARENT/com.clauderesolve.plugin"
CONFIG_DIR="$HOME/Library/Application Support/Blackmagic Design/DaVinci Resolve/Claude Resolve"
INSTALLER_LOG="$CONFIG_DIR/installer.log"
DEPENDENCY_STATUS="$CONFIG_DIR/dependency-status.json"
TOOLS_DIR="$CONFIG_DIR/tools"
APP_NPM_PREFIX="$TOOLS_DIR/npm"
APP_NPM_BIN="$APP_NPM_PREFIX/bin"
APP_PYTHON_VENV="$TOOLS_DIR/python"
APP_PYTHON_BIN="$APP_PYTHON_VENV/bin"
PATH="$APP_NPM_BIN:$APP_PYTHON_BIN:$PATH"
# macOS plugins dir intentionally OMITS the "Support/" segment that the
# Windows/ProgramData path includes — this matches Blackmagic's macOS layout.
INSTALLER_VERSION='0.6.1-beta'
if [ -f "$PLUGIN_SRC/package.json" ]; then
    detected_version="$(node -e "try{console.log(require(process.argv[1]).version||'')}catch(e){}" "$PLUGIN_SRC/package.json" 2>/dev/null || true)"
    [ -n "$detected_version" ] && INSTALLER_VERSION="$detected_version"
fi
mkdir -p "$CONFIG_DIR" 2>/dev/null || true
touch "$INSTALLER_LOG" 2>/dev/null || true
exec > >(tee -a "$INSTALLER_LOG") 2>&1

# ---------------------------------------------------------------- colours
ESC=$(printf '\033')
RESET="${ESC}[0m"; BOLD="${ESC}[1m"
WARM="${ESC}[38;2;232;132;58m"      # brand orange
AMBER="${ESC}[38;2;212;164;76m"     # brand amber
LEAF="${ESC}[38;2;128;196;153m"     # brand green
TEAL="${ESC}[38;2;76;201;176m"      # brand teal
WHITE="${ESC}[38;2;243;241;236m"
DIM="${ESC}[38;2;138;137;133m"
RED="${ESC}[38;2;255;138;122m"

# Status glyphs (this file is UTF-8).
I_OK="${LEAF}✓${RESET}"
I_WARN="${AMBER}⚠${RESET}"
I_ERR="${RED}✗${RESET}"

BAR_WIDTH=48

# A point on the brand gradient (warm -> amber -> green -> teal). $1 = 0..100.
grad() {
    awk -v t="$1" 'BEGIN{
        t=t/100; n=4
        split("232,132,58 212,164,76 128,196,153 76,201,176", S, " ")
        seg=t*(n-1); k=int(seg); if(k>n-2)k=n-2; f=seg-k
        split(S[k+1],a,","); split(S[k+2],b,",")
        printf "%d;%d;%d", a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f, a[3]+(b[3]-a[3])*f
    }'
}

gradient_bar() {
    awk -v w="$BAR_WIDTH" 'BEGIN{
        n=4
        split("232,132,58 212,164,76 128,196,153 76,201,176", S, " ")
        printf "  "
        for(i=0;i<w;i++){
            t=i/(w-1); seg=t*(n-1); k=int(seg); if(k>n-2)k=n-2; f=seg-k
            split(S[k+1],a,","); split(S[k+2],b,",")
            printf "\033[48;2;%d;%d;%dm ", a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f, a[3]+(b[3]-a[3])*f
        }
        printf "\033[0m\n"
    }'
}

print_header() {
    echo
    printf '%s      \\  |  /%s\n' "$WARM" "$RESET"
    printf '%s   ---%s %s( * )%s %s---%s    %sResolve AI%s\n' \
        "$WARM" "$RESET" "$AMBER" "$RESET" "$WARM" "$RESET" "$WHITE" "$RESET"
    printf '%s      /  |  \\%s       %sAI motion graphics for DaVinci Resolve%s\n' \
        "$WARM" "$RESET" "$DIM" "$RESET"
    echo
    gradient_bar
    printf '       %sinstaller v%s%s\n' "$DIM" "$INSTALLER_VERSION" "$RESET"
    echo
}

step() {  # $1 = step number, $2 = title
    local col; col="$(grad $(( ($1 - 1) * 100 / 9 )))"
    echo
    printf '%s[%s/10]%s  %s%s%s\n' "${ESC}[38;2;${col}m" "$1" "$RESET" "$WHITE" "$2" "$RESET"
}
ok()   { printf '       %s  %s%s%s\n' "$I_OK"   "$DIM"   "$1" "$RESET"; }
warn() { printf '       %s  %s%s%s\n' "$I_WARN" "$DIM"   "$1" "$RESET"; }
fail() {
    echo
    printf '       %s  %s%s%s\n' "$I_ERR" "$RED" "$1" "$RESET"
    echo
    read -r -p "       Press Enter to exit..." _
    exit 1
}

print_success() {
    local inner=46
    local text="Resolve AI installed successfully"
    local rule; rule="$(printf '─%.0s' $(seq 1 $inner))"
    local vis=$(( 3 + 1 + 2 + ${#text} ))
    local pad=$(( inner - vis ))
    echo
    printf '%s  ╭%s╮%s\n' "$TEAL" "$rule" "$RESET"
    printf '%s  │%s   %s✓%s  %s%s%s%*s%s│%s\n' \
        "$TEAL" "$RESET" "$LEAF" "$RESET" "$WHITE" "$text" "$RESET" "$pad" "" "$TEAL" "$RESET"
    printf '%s  ╰%s╯%s\n' "$TEAL" "$rule" "$RESET"
    echo
    printf '       %sRestart DaVinci Resolve, then open it from:%s\n' "$DIM" "$RESET"
    printf '       %sWorkspace > Workflow Integration > Resolve AI%s\n' "$WHITE" "$RESET"
    echo
}

print_header

# 1 - DaVinci Resolve
step 1 'Checking DaVinci Resolve'
if [ ! -d "/Applications/DaVinci Resolve/DaVinci Resolve.app" ]; then
    fail 'DaVinci Resolve not found. Install DaVinci Resolve Studio 21+ first.'
fi
if pgrep -x 'DaVinci Resolve' >/dev/null 2>&1; then
    warn 'DaVinci Resolve is running. Save your work first.'
    printf '       Close Resolve and continue? (y/n) '
    read -r answer
    case "$answer" in
        y|Y|yes|YES)
            osascript -e 'tell application "DaVinci Resolve" to quit' >/dev/null 2>&1
            for _ in 1 2 3 4 5 6 7 8 9 10; do
                pgrep -x 'DaVinci Resolve' >/dev/null 2>&1 || break
                sleep 1
            done
            pkill -x 'DaVinci Resolve' >/dev/null 2>&1
            ok 'Resolve closed.'
            ;;
        *)
            fail 'Cancelled. Quit DaVinci Resolve, then re-run the installer.'
            ;;
    esac
fi
ok 'Resolve found. (Workflow Integration Plugins require the Studio edition.)'

# 2 - Node.js 18+
step 2 'Checking Node.js'

node_major() {
    command -v node >/dev/null 2>&1 || { echo 0; return; }
    node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0
}

NODE_LTS_FALLBACK='v20.18.0'

# Newest LTS version (e.g. v22.11.0) from nodejs.org, or empty on failure.
# index.tab is sorted newest-first; column 10 is the LTS codename ("-" if not).
latest_node_lts() {
    curl -fsSL 'https://nodejs.org/dist/index.tab' 2>/dev/null \
        | awk -F'\t' 'NR>1 && $10 != "-" { print $1; exit }'
}

install_node() {
    # Official Node.js LTS .pkg from nodejs.org. The .pkg is a universal
    # binary, but detect the arch so the log reflects the host.
    local arch ver pkg url tmp
    case "$(uname -m)" in
        arm64) arch='arm64' ;;
        *)     arch='x64'   ;;
    esac
    ver="$(latest_node_lts)"
    if [ -z "$ver" ]; then
        warn "Could not look up the latest LTS - using $NODE_LTS_FALLBACK."
        ver="$NODE_LTS_FALLBACK"
    fi
    pkg="node-$ver.pkg"
    url="https://nodejs.org/dist/$ver/$pkg"
    tmp="$(mktemp -d)/$pkg"

    warn "Downloading Node.js LTS $ver (universal, host $arch) from nodejs.org..."
    if ! curl -fsSL "$url" -o "$tmp"; then
        rm -f "$tmp"
        warn 'Download failed.'
        return 1
    fi
    warn 'Running the Node.js installer (administrator password may be requested)...'
    if ! sudo installer -pkg "$tmp" -target /; then
        rm -f "$tmp"
        warn 'pkg install failed.'
        return 1
    fi
    rm -f "$tmp"
    # The .pkg installs into /usr/local/bin; make sure this session sees it.
    case ":$PATH:" in *":/usr/local/bin:"*) ;; *) PATH="/usr/local/bin:$PATH" ;; esac
    hash -r 2>/dev/null || true
    [ "$(node_major)" -ge 18 ]
}

if [ "$(node_major)" -lt 18 ]; then
    if command -v node >/dev/null 2>&1; then
        warn "Node.js 18+ required, found $(node --version) - upgrading automatically..."
    else
        warn 'Node.js not found - installing automatically...'
    fi
    if ! install_node; then
        fail 'Could not install Node.js automatically. Install Node.js 18+ from https://nodejs.org and re-run the installer.'
    fi
fi
ok "Node.js $(node --version)"
mkdir -p "$TOOLS_DIR" "$APP_NPM_PREFIX" 2>/dev/null || true
write_dep_status() {
    local group="$1" name="$2" state="$3" detail="${4:-}"
    node - "$DEPENDENCY_STATUS" "$CONFIG_DIR" "$TOOLS_DIR" "$APP_NPM_PREFIX" "$APP_PYTHON_VENV" "$INSTALLER_LOG" "$group" "$name" "$state" "$detail" <<'NODE' 2>/dev/null || true
const fs = require('fs');
const [file, configDir, toolsDir, npmPrefix, pythonVenv, installerLog, group, name, state, detail] = process.argv.slice(2);
let data = {};
try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
data.generatedAt = new Date().toISOString();
data.required ||= {};
data.providers ||= {};
data.optional ||= {};
data.paths = { configDir, toolsDir, npmPrefix, pythonVenv, installerLog };
data[group] ||= {};
data[group][name] = { state, detail, checkedAt: new Date().toISOString() };
fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(file, JSON.stringify(data, null, 2));
NODE
}
write_dep_status required resolve installed "$DEST_PARENT"
write_dep_status required node installed "$(node --version)"

# 3 - AI CLI
step 3 'Installing AI CLIs'
install_app_npm_pkg() {
    local label="$1" pkg="$2" cmd="$3"
    if command -v "$cmd" >/dev/null 2>&1; then
        ok "$label CLI present."
        write_dep_status providers "$cmd" installed 'Found on PATH.'
        return 0
    fi
    warn "Installing $label CLI into Resolve AI tools..."
    if npm install -g --prefix "$APP_NPM_PREFIX" "$pkg" --no-audit --no-fund && command -v "$cmd" >/dev/null 2>&1; then
        ok "$label CLI installed."
        write_dep_status providers "$cmd" installed "$APP_NPM_PREFIX"
        return 0
    fi
    warn "$label CLI install failed. You can repair later from Settings > Setup."
    write_dep_status providers "$cmd" repair-failed "npm install -g --prefix $APP_NPM_PREFIX $pkg"
    return 1
}
have_codex=0
have_claude=0
install_app_npm_pkg 'OpenAI Codex' '@openai/codex' 'codex' && have_codex=1
install_app_npm_pkg 'Claude Code' '@anthropic-ai/claude-code' 'claude' && have_claude=1
if [ "$have_claude" -eq 1 ] && [ -f "$HOME/.claude/.credentials.json" ]; then
    ok 'Claude Code appears logged in.'
    write_dep_status providers claudeLogin installed 'Claude credentials found.'
elif [ "$have_codex" -eq 1 ]; then
    if codex login status >/dev/null 2>&1; then
        ok 'OpenAI Codex CLI appears logged in.'
        write_dep_status providers codexLogin installed 'Codex login status OK.'
    else
        warn 'OpenAI Codex CLI installed but not logged in - run codex login in terminal.'
        write_dep_status providers codexLogin needs-login 'Run codex login.'
    fi
else
    warn 'Install or log in to at least one provider: claude login or codex login.'
    write_dep_status providers aiCli repair-failed 'No AI provider CLI available.'
fi

# 4 - Renderer dependencies
step 4 'Installing renderer dependencies (Playwright)'
if ! ( cd "$RENDERER_SRC" && npm install --no-audit --no-fund ); then
    fail 'npm install failed in plugin/renderer.'
fi
ok 'Renderer dependencies installed.'
write_dep_status required rendererDependencies installed "$RENDERER_SRC"

if [ ! -f "$PLUGIN_SRC/dist/index.html" ]; then
    warn 'Plugin UI bundle missing - building plugin/dist...'
    if ! ( cd "$PLUGIN_SRC" && npm install --no-audit --no-fund && npm run build ); then
        fail 'Could not build plugin UI. Normal users should download ResolveAI-macOS-vX.Y.Z.zip from GitHub Releases, not Source code.zip. Contributors can run: npm --prefix plugin install && npm --prefix plugin run build, then re-run the installer.'
    fi
    ok 'Plugin UI bundle built.'
else
    ok 'Plugin UI bundle present.'
fi

if [ ! -f "$PLUGIN_SRC/data/builtin-template-packs.json" ]; then
    warn 'Built-in template packs missing - creating starter pack...'
    if ! mkdir -p "$PLUGIN_SRC/data"; then
        fail 'Could not create plugin/data for built-in template packs.'
    fi
    cat > "$PLUGIN_SRC/data/builtin-template-packs.json" <<'JSON'
[
  {
    "id": "creator-essentials",
    "name": "Creator Essentials",
    "templates": [
      {
        "id": "creator-title-card",
        "name": "Creator Title Card",
        "title": "Creator Title Card",
        "category": "creator",
        "tags": ["title", "intro"],
        "prompt": "Create a bold 5 second creator title card with clean motion and a polished final hold.",
        "html": "<!DOCTYPE html><html><body><div id=\"stage\"><h1>Creator Title</h1></div><script>window.getAnimationDuration=()=>5;window.renderFrame=()=>{};</script></body></html>",
        "thumbnail": "builtin://creator-title-card",
        "preview": "builtin://creator-title-card",
        "fps": 25,
        "width": 1920,
        "height": 1080,
        "createdBy": "Resolve AI",
        "recommendedProvider": "auto"
      }
    ]
  }
]
JSON
fi
ok 'Built-in template packs present.'

# Move aside a stale file that is blocking a directory install path.
repair_blocking_path() {
    local target="$1"
    local label="$2"
    if [ -e "$target" ] && [ ! -d "$target" ]; then
        local backup="${target}.blocked.$(date +%Y%m%d%H%M%S)"
        warn "$label exists but is not a directory - moving it aside."
        if ! sudo mv "$target" "$backup"; then
            fail "Could not repair $label at $target."
        fi
        ok "Moved blocking path to $backup"
    fi
}

# 5 - Chromium
step 5 'Downloading Playwright Chromium'
if ! ( cd "$RENDERER_SRC" && npx --yes playwright install chromium ); then
    fail 'Playwright Chromium download failed.'
fi
ok 'Chromium installed.'
write_dep_status required playwrightChromium installed "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/Library/Caches/ms-playwright}"

# 6 - ffmpeg
step 6 'Checking render dependencies'
render_deps_check="$PLUGIN_SRC/scripts/check-render-deps.js"
if [ ! -f "$render_deps_check" ]; then
    fail 'Render dependency self-test is missing from plugin/scripts.'
fi
if ! ( cd "$PLUGIN_SRC" && node "$render_deps_check" ); then
    fail 'Render dependency self-test failed. Re-run this installer with internet access so ffmpeg-static and Playwright can install, or install FFmpeg manually with: brew install ffmpeg.'
fi
ok 'Render dependencies ready.'
write_dep_status required renderEngine installed 'ffmpeg-static / Playwright render self-test passed.'

# 7 - Optional local engines
step 7 'Installing optional local engines'
python_cmd=""
if command -v python3 >/dev/null 2>&1; then
    python_cmd="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
    python_cmd="$(command -v python)"
fi
if [ -z "$python_cmd" ]; then
    warn 'Python not found. Manim is optional; install Python 3.11+ later from Settings > Setup.'
    write_dep_status optional python not-installed 'Python 3.11+ not found.'
else
    if [ ! -x "$APP_PYTHON_BIN/python" ]; then
        warn 'Creating Resolve AI local Python environment...'
        "$python_cmd" -m venv "$APP_PYTHON_VENV" || warn 'Could not create local Python environment.'
    fi
    venv_python="$APP_PYTHON_BIN/python"
    if [ ! -x "$venv_python" ]; then
        warn 'Skipping optional Manim auto-install because the local Python environment could not be created. Built-in overlays and transcription still work.'
        write_dep_status optional python installed "$python_cmd"
        write_dep_status optional manim not-installed 'Local Python environment unavailable; install Manim manually from Settings if needed.'
        write_dep_status optional whisper not-installed 'External Whisper is not installed automatically. Built-in audio transcription remains available.'
        venv_python=""
    else
        write_dep_status optional python installed "$venv_python"
        "$venv_python" -m pip install --upgrade pip >/dev/null 2>&1 || true
    fi

    if [ -n "$venv_python" ] && "$venv_python" -m manim --version >/dev/null 2>&1; then
        ok 'Manim Community Edition ready.'
        write_dep_status optional manim installed "$APP_PYTHON_VENV"
    elif [ -n "$venv_python" ]; then
        warn 'Installing Manim Community Edition into Resolve AI tools...'
        if "$venv_python" -m pip install --upgrade manim; then
            ok 'Manim Community Edition ready.'
            write_dep_status optional manim installed "$APP_PYTHON_VENV"
        else
            warn 'Manim install failed. Normal overlay generation still works.'
            write_dep_status optional manim repair-failed 'python -m pip install manim'
        fi
    fi
    write_dep_status optional whisper not-installed 'External Whisper is not installed automatically. Built-in audio transcription remains available.'
fi

# 8 - Copy plugin into DaVinci Resolve (needs root)
step 8 'Installing plugin into DaVinci Resolve'
printf '       %s(your administrator password may be requested)%s\n' "$DIM" "$RESET"

repair_blocking_path "$DEST_PARENT" 'Workflow Integration Plugins path'

if ! sudo mkdir -p "$DEST_PARENT"; then
    fail "Could not create plugin parent folder: $DEST_PARENT"
fi

stamp="$(date +%Y%m%d%H%M%S)"
temp_dest="${DEST}.incoming.${stamp}"
backup_dest="${DEST}.backup.${stamp}"
sudo rm -rf "$temp_dest" 2>/dev/null || true

if ! sudo mkdir -p "$temp_dest"; then
    fail "Could not create temporary plugin folder: $temp_dest"
fi

if ! sudo ditto "$PLUGIN_SRC" "$temp_dest"; then
    sudo rm -rf "$temp_dest" 2>/dev/null || true
    fail 'Install failed: could not stage plugin files before install.'
fi

for rel in manifest.xml main.js preload.js dist/index.html data/builtin-template-packs.json renderer/render.js updater/install-update.ps1 updater/install-update.sh; do
    if [ ! -e "$temp_dest/$rel" ]; then
        sudo rm -rf "$temp_dest" 2>/dev/null || true
        fail "Staged plugin missing: $rel"
    fi
done

if [ -e "$backup_dest" ] || [ -L "$backup_dest" ]; then
    sudo rm -rf "$backup_dest"
fi

if [ -e "$DEST" ] || [ -L "$DEST" ]; then
    warn 'Backing up existing plugin before install.'
    if ! sudo mv "$DEST" "$backup_dest"; then
        sudo rm -rf "$temp_dest" 2>/dev/null || true
        fail "Could not back up existing plugin path: $DEST"
    fi
fi

if ! sudo mv "$temp_dest" "$DEST"; then
    warn 'Install move failed; restoring previous plugin if available.'
    sudo rm -rf "$temp_dest" 2>/dev/null || true
    if [ ! -e "$DEST" ] && [ -e "$backup_dest" ]; then
        sudo mv "$backup_dest" "$DEST" 2>/dev/null || true
    fi
    fail 'Install failed: could not move staged plugin into place.'
fi
ok "Installed to $DEST"
write_dep_status required pluginCopy installed "$DEST"

# 9 - Verify
step 9 'Verifying installation'
for rel in manifest.xml main.js data/builtin-template-packs.json ipc/assets.js ipc/agent.js ipc/agent-logs.js ipc/captions.js ipc/codex.js ipc/codex-parser.js ipc/codex-stderr-filter.js ipc/render-health.js ipc/render-validation.js ipc/repair.js ipc/runtime-qa.js ipc/showcase.js ipc/template-packs.js ipc/templates.js ipc/updates.js dist/index.html renderer/render.js renderer/node_modules/ffmpeg-static renderer/node_modules/playwright scripts/check-render-deps.js updater/install-update.ps1 updater/install-update.sh; do
    if [ ! -e "$DEST/$rel" ]; then
        fail "Verification failed - missing: $rel"
    fi
done
ok 'All required files present.'
write_dep_status required pluginVerification installed "$DEST"

# 10 - Done
step 10 'Done'
print_success
read -r -p "       Press Enter to exit..." _
