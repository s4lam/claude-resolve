const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const {
    isMac,
    CONFIG_DIR,
    TOOLS_DIR,
    APP_NPM_PREFIX,
    APP_NPM_BIN,
    APP_PYTHON_VENV,
    APP_PYTHON_BIN
} = require('./paths');

function quotePs(value) {
    return `'${String(value || '').replace(/'/g, "''")}'`;
}

function quoteSh(value) {
    return `'${String(value || '').replace(/'/g, "'\"'\"'")}'`;
}

function writeWindowsRepairScript() {
    const scriptPath = path.join(os.tmpdir(), `resolve-ai-repair-${Date.now()}.ps1`);
    const venvPython = path.join(APP_PYTHON_BIN, 'python.exe');
    const script = [
        '$ErrorActionPreference = "Continue"',
        `$configDir = ${quotePs(CONFIG_DIR)}`,
        `$toolsDir = ${quotePs(TOOLS_DIR)}`,
        `$npmPrefix = ${quotePs(APP_NPM_PREFIX)}`,
        `$pythonVenv = ${quotePs(APP_PYTHON_VENV)}`,
        `$pythonScripts = ${quotePs(APP_PYTHON_BIN)}`,
        'New-Item -ItemType Directory -Force -Path $configDir, $toolsDir, $npmPrefix | Out-Null',
        '$env:Path = @($npmPrefix, $pythonScripts, $env:Path) -join ";"',
        'Write-Host "Resolve AI setup repair" -ForegroundColor Cyan',
        'Write-Host "Installing Codex and Claude Code CLIs into Resolve AI tools..."',
        'npm install -g --prefix $npmPrefix @openai/codex @anthropic-ai/claude-code --no-audit --no-fund',
        '$pythonCmd = $null',
        'foreach ($candidate in @("py", "python", "python3")) { if (Get-Command $candidate -ErrorAction SilentlyContinue) { $pythonCmd = $candidate; break } }',
        'if (-not $pythonCmd) {',
        '  Write-Host "Python not found. Install Python 3.11+ to enable Manim and Whisper." -ForegroundColor Yellow',
        '} else {',
        `  if (-not (Test-Path ${quotePs(venvPython)})) { & $pythonCmd -m venv $pythonVenv }`,
        `  $venvPython = ${quotePs(venvPython)}`,
        '  if (-not (Test-Path $venvPython)) { $venvPython = $pythonCmd }',
        '  & $venvPython -m pip install --upgrade pip',
        '  & $venvPython -m pip install --upgrade manim openai-whisper',
        '}',
        'Write-Host ""',
        'Write-Host "Done. Run codex login and/or claude login if provider auth is still needed." -ForegroundColor Green',
        'Read-Host "Press Enter to close"'
    ].join('\r\n');
    fs.writeFileSync(scriptPath, script, 'utf8');
    return scriptPath;
}

function writeMacRepairScript() {
    const scriptPath = path.join(os.tmpdir(), `resolve-ai-repair-${Date.now()}.sh`);
    const script = [
        '#!/bin/bash',
        'set -u',
        `CONFIG_DIR=${quoteSh(CONFIG_DIR)}`,
        `TOOLS_DIR=${quoteSh(TOOLS_DIR)}`,
        `APP_NPM_PREFIX=${quoteSh(APP_NPM_PREFIX)}`,
        `APP_NPM_BIN=${quoteSh(APP_NPM_BIN)}`,
        `APP_PYTHON_VENV=${quoteSh(APP_PYTHON_VENV)}`,
        `APP_PYTHON_BIN=${quoteSh(APP_PYTHON_BIN)}`,
        'mkdir -p "$CONFIG_DIR" "$TOOLS_DIR" "$APP_NPM_PREFIX"',
        'export PATH="$APP_NPM_BIN:$APP_PYTHON_BIN:$PATH"',
        'echo "Resolve AI setup repair"',
        'echo "Installing Codex and Claude Code CLIs into Resolve AI tools..."',
        'npm install -g --prefix "$APP_NPM_PREFIX" @openai/codex @anthropic-ai/claude-code --no-audit --no-fund',
        'python_cmd=""',
        'if command -v python3 >/dev/null 2>&1; then python_cmd="$(command -v python3)"; elif command -v python >/dev/null 2>&1; then python_cmd="$(command -v python)"; fi',
        'if [ -z "$python_cmd" ]; then',
        '  echo "Python not found. Install Python 3.11+ to enable Manim and Whisper."',
        'else',
        '  if [ ! -x "$APP_PYTHON_BIN/python" ]; then "$python_cmd" -m venv "$APP_PYTHON_VENV"; fi',
        '  venv_python="$APP_PYTHON_BIN/python"',
        '  [ -x "$venv_python" ] || venv_python="$python_cmd"',
        '  "$venv_python" -m pip install --upgrade pip',
        '  "$venv_python" -m pip install --upgrade manim openai-whisper',
        'fi',
        'echo ""',
        'echo "Done. Run codex login and/or claude login if provider auth is still needed."',
        'read -r -p "Press Enter to close"'
    ].join('\n');
    fs.writeFileSync(scriptPath, script, 'utf8');
    fs.chmodSync(scriptPath, 0o755);
    return scriptPath;
}

function openSetupRepairTerminal() {
    const scriptPath = isMac ? writeMacRepairScript() : writeWindowsRepairScript();
    if (isMac) {
        spawn('osascript', ['-e', `tell application "Terminal" to do script ${JSON.stringify(`bash ${quoteSh(scriptPath)}`)}`], {
            detached: true,
            stdio: 'ignore'
        }).unref();
    } else {
        spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
            detached: true,
            stdio: 'ignore',
            windowsHide: false
        }).unref();
    }
    return { success: true, scriptPath };
}

function setupSetupToolsHandlers(ipcMain) {
    ipcMain.handle('setup:openRepairTerminal', () => openSetupRepairTerminal());
}

module.exports = {
    openSetupRepairTerminal,
    setupSetupToolsHandlers
};
