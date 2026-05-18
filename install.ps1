#Requires -Version 5.1
<#
  Claude Resolve - Windows installer.
  Launched by install.bat (which elevates) or run directly from an
  elevated PowerShell prompt.
#>

$RepoRoot    = $PSScriptRoot
$PluginSrc   = Join-Path $RepoRoot 'plugin'
$RendererSrc = Join-Path $PluginSrc 'renderer'
$Dest        = Join-Path $env:ProgramData 'Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\com.clauderesolve.plugin'

function Step([int]$n, [string]$msg) { Write-Host "`n[$n/9] $msg" -ForegroundColor Cyan }
function Ok([string]$msg)            { Write-Host "  OK   $msg" -ForegroundColor Green }
function Warn([string]$msg)          { Write-Host "  !    $msg" -ForegroundColor Yellow }
function Fail([string]$msg) {
    Write-Host "  X    $msg" -ForegroundColor Red
    Read-Host "`nInstallation failed. Press Enter to exit"
    exit 1
}

Write-Host "`nClaude Resolve installer" -ForegroundColor White

# 1 - DaVinci Resolve
Step 1 'Checking DaVinci Resolve...'
$resolveExe = Join-Path $env:ProgramFiles 'Blackmagic Design\DaVinci Resolve\Resolve.exe'
if (-not (Test-Path $resolveExe)) {
    Fail 'DaVinci Resolve not found. Install DaVinci Resolve Studio 21+ first.'
}
if (Get-Process -Name 'Resolve' -ErrorAction SilentlyContinue) {
    Fail 'DaVinci Resolve is running. Quit it completely, then re-run this installer.'
}
Ok 'Resolve found. (Workflow Integration Plugins require the Studio edition.)'

# 2 - Node.js 18+
Step 2 'Checking Node.js...'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail 'Node.js not found. Install Node.js 18 or newer from https://nodejs.org'
}
$nodeVer = (& node --version).Trim()
$nodeMajor = [int](($nodeVer.TrimStart('v')).Split('.')[0])
if ($nodeMajor -lt 18) {
    Fail "Node.js 18+ required, found $nodeVer. Upgrade from https://nodejs.org"
}
Ok "Node.js $nodeVer"

# 3 - Claude Code CLI
Step 3 'Checking Claude Code CLI...'
$haveClaude = [bool](Get-Command claude -ErrorAction SilentlyContinue)
if (-not $haveClaude -and (Test-Path (Join-Path $env:APPDATA 'npm\claude.cmd'))) {
    $haveClaude = $true
}
if (-not $haveClaude) {
    Warn 'Claude Code CLI not found - installing via npm...'
    & npm install -g '@anthropic-ai/claude-code'
    if ($LASTEXITCODE -ne 0) {
        Warn 'Automatic install failed. Install it manually: npm install -g @anthropic-ai/claude-code'
    } else {
        Ok 'Claude Code CLI installed.'
        $haveClaude = $true
    }
} else {
    Ok 'Claude Code CLI present.'
}

# Login status - best effort, never aborts.
if (Test-Path (Join-Path $env:USERPROFILE '.claude\.credentials.json')) {
    Ok 'Claude Code is logged in.'
} else {
    Warn 'Claude Code installed but not logged in - run claude in terminal to log in.'
}

# 4 - Renderer dependencies
Step 4 'Installing renderer dependencies (Playwright)...'
Push-Location $RendererSrc
& npm install --no-audit --no-fund
$exit = $LASTEXITCODE
Pop-Location
if ($exit -ne 0) { Fail 'npm install failed in plugin\renderer.' }
Ok 'Renderer dependencies installed.'

# 5 - Chromium
Step 5 'Downloading Playwright Chromium...'
Push-Location $RendererSrc
& npx --yes playwright install chromium
$exit = $LASTEXITCODE
Pop-Location
if ($exit -ne 0) { Fail 'Playwright Chromium download failed.' }
Ok 'Chromium installed.'

# 6 - ffmpeg
Step 6 'Checking ffmpeg...'
if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
    Ok 'ffmpeg found.'
} else {
    Warn 'ffmpeg not found on PATH. Rendering will not work until ffmpeg is installed and on PATH.'
}

# 7 - Copy plugin into DaVinci Resolve
Step 7 'Installing plugin into DaVinci Resolve...'
try {
    if (Test-Path $Dest) { Remove-Item -LiteralPath $Dest -Recurse -Force -ErrorAction Stop }
    New-Item -ItemType Directory -Path $Dest -Force -ErrorAction Stop | Out-Null
    Copy-Item -Path (Join-Path $PluginSrc '*') -Destination $Dest -Recurse -Force -ErrorAction Stop
} catch {
    Fail "Could not copy plugin files: $($_.Exception.Message)"
}
Ok "Installed to $Dest"

# 8 - Verify
Step 8 'Verifying installation...'
$required = @(
    'manifest.xml',
    'main.js',
    'dist\index.html',
    'renderer\render.js',
    'renderer\node_modules\playwright'
)
foreach ($rel in $required) {
    if (-not (Test-Path (Join-Path $Dest $rel))) {
        Fail "Verification failed - missing: $rel"
    }
}
Ok 'All required files present.'

# 9 - Done
Step 9 'Done.'
Write-Host ''
Write-Host 'Claude Resolve is installed.' -ForegroundColor Green
Write-Host 'Restart DaVinci Resolve, then open it from:'
Write-Host '  Workspace > Workflow Integration > Claude Resolve' -ForegroundColor White
Read-Host "`nPress Enter to exit"
