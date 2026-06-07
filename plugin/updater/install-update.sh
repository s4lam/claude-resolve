#!/usr/bin/env bash
set -euo pipefail

SOURCE=""
DESTINATION=""
BACKUP=""
PARENT_PID="0"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --source) SOURCE="${2:-}"; shift 2 ;;
    --destination) DESTINATION="${2:-}"; shift 2 ;;
    --backup) BACKUP="${2:-}"; shift 2 ;;
    --parent-pid) PARENT_PID="${2:-0}"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

require_file() {
  if [ ! -f "$1" ]; then
    echo "Missing required file: $1" >&2
    exit 1
  fi
}

if [ -z "$SOURCE" ] || [ -z "$DESTINATION" ] || [ -z "$BACKUP" ]; then
  echo "Usage: install-update.sh --source PATH --destination PATH --backup PATH --parent-pid PID" >&2
  exit 2
fi

case "$DESTINATION" in
  *"/Workflow Integration Plugins/com.clauderesolve.plugin") ;;
  *)
    echo "Refusing unexpected plugin destination: $DESTINATION" >&2
    exit 2
    ;;
esac

if [ "$(id -u)" -ne 0 ]; then
  exec sudo "$0" --source "$SOURCE" --destination "$DESTINATION" --backup "$BACKUP" --parent-pid "$PARENT_PID"
fi

if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
  USER_HOME="$(eval echo "~$SUDO_USER")"
else
  USER_HOME="$HOME"
fi
CONFIG_DIR="$USER_HOME/Library/Application Support/Blackmagic Design/DaVinci Resolve/Claude Resolve"
UPDATE_LOG="$CONFIG_DIR/update-installer.log"
mkdir -p "$CONFIG_DIR" 2>/dev/null || true
touch "$UPDATE_LOG" 2>/dev/null || true
exec > >(tee -a "$UPDATE_LOG") 2>&1

echo "Resolve AI updater"
echo "Waiting for plugin window to close..."

waited=0
while [ "$PARENT_PID" != "0" ] && kill -0 "$PARENT_PID" 2>/dev/null && [ "$waited" -lt 60 ]; do
  sleep 1
  waited=$((waited + 1))
done

if [ "$PARENT_PID" != "0" ] && kill -0 "$PARENT_PID" 2>/dev/null; then
  echo "Plugin process still open after 60 seconds; continuing with staged install."
fi

SOURCE="$(cd "$SOURCE" && pwd)"
PARENT_DIR="$(dirname "$DESTINATION")"
TEMP_DEST="${DESTINATION}.incoming.$(date +%Y%m%d-%H%M%S)"

require_file "$SOURCE/manifest.xml"
require_file "$SOURCE/main.js"
require_file "$SOURCE/preload.js"
require_file "$SOURCE/dist/index.html"
require_file "$SOURCE/data/builtin-template-packs.json"
require_file "$SOURCE/renderer/render.js"
require_file "$SOURCE/scripts/check-render-deps.js"
require_file "$SOURCE/updater/install-update.ps1"
require_file "$SOURCE/updater/install-update.sh"

if [ -e "$PARENT_DIR" ] && [ ! -d "$PARENT_DIR" ]; then
  mv "$PARENT_DIR" "${PARENT_DIR}.blocked.$(date +%Y%m%d-%H%M%S)"
fi
mkdir -p "$PARENT_DIR"
rm -rf "$TEMP_DEST"

rollback() {
  rm -rf "$TEMP_DEST"
  if [ ! -e "$DESTINATION" ] && [ -e "$BACKUP" ]; then
    echo "Restoring previous plugin..."
    mv "$BACKUP" "$DESTINATION"
  fi
}

trap rollback ERR

echo "Copying staged update..."
/usr/bin/ditto "$SOURCE" "$TEMP_DEST"

if [ -d "$DESTINATION/renderer/node_modules" ] && [ ! -d "$TEMP_DEST/renderer/node_modules" ]; then
  echo "Preserving renderer dependencies..."
  mkdir -p "$TEMP_DEST/renderer"
  /usr/bin/ditto "$DESTINATION/renderer/node_modules" "$TEMP_DEST/renderer/node_modules"
fi

if [ -e "$BACKUP" ]; then
  rm -rf "$BACKUP"
fi

if [ -e "$DESTINATION" ]; then
  echo "Backing up current plugin..."
  mv "$DESTINATION" "$BACKUP"
fi

echo "Installing new plugin..."
mv "$TEMP_DEST" "$DESTINATION"

trap - ERR
echo ""
echo "Update installed."
echo "Reopen Resolve AI from Workspace > Workflow Integration."
