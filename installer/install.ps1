#Requires -Version 5.1
<#
  Resolve AI - Windows installer.
  Launched by "Install Resolve AI.bat" as the CURRENT user (no up-front
  elevation). Node, app-managed AI CLIs, Playwright, Manim, and Whisper run in
  the user's profile; only the final plugin copy into ProgramData is elevated.
#>

# ---------------------------------------------------------------- console
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# Enable ANSI/VT processing so 24-bit colour works on Windows PowerShell 5.1.
$Ansi = $false
try {
    $vt = Add-Type -Name CRVT -Namespace CRInstaller -PassThru -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern System.IntPtr GetStdHandle(int h);
[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern bool GetConsoleMode(System.IntPtr h, out int m);
[System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern bool SetConsoleMode(System.IntPtr h, int m);
'@
    $hOut = $vt::GetStdHandle(-11)
    $mode = 0
    if ($vt::GetConsoleMode($hOut, [ref]$mode)) {
        if ($vt::SetConsoleMode($hOut, ($mode -bor 0x0004))) { $Ansi = $true }
    }
} catch { $Ansi = $false }

$ESC       = [char]27
$ICON_OK   = [char]0x2713   # check
$ICON_WARN = [char]0x26A0   # warning sign
$ICON_ERR  = [char]0x2717   # ballot x
$BTL = [char]0x256D; $BTR = [char]0x256E      # rounded box corners
$BBL = [char]0x2570; $BBR = [char]0x256F
$BH  = [char]0x2500; $BV  = [char]0x2502

# Brand gradient: warm orange -> amber -> green -> teal (from design-tokens).
$Stops = @( @(232,132,58), @(212,164,76), @(128,196,153), @(76,201,176) )

function GradientAt([double]$t) {
    if ($t -lt 0) { $t = 0 } elseif ($t -gt 1) { $t = 1 }
    $seg = $t * ($Stops.Count - 1)
    $i = [int][Math]::Floor($seg)
    if ($i -gt $Stops.Count - 2) { $i = $Stops.Count - 2 }
    $f = $seg - $i
    $a = $Stops[$i]; $b = $Stops[$i + 1]
    return @(
        [int]($a[0] + ($b[0] - $a[0]) * $f),
        [int]($a[1] + ($b[1] - $a[1]) * $f),
        [int]($a[2] + ($b[2] - $a[2]) * $f)
    )
}
function Tint([int[]]$c, [string]$s) {
    if ($Ansi) { return "$ESC[38;2;$($c[0]);$($c[1]);$($c[2])m$s$ESC[0m" }
    return $s
}

# ---------------------------------------------------------------- UI parts
$BAR_WIDTH = 48

function Show-Bar {
    if ($Ansi) {
        $s = '  '
        for ($i = 0; $i -lt $BAR_WIDTH; $i++) {
            $c = GradientAt ($i / [double]($BAR_WIDTH - 1))
            $s += "$ESC[48;2;$($c[0]);$($c[1]);$($c[2])m "
        }
        Write-Host ($s + "$ESC[0m")
    } else {
        Write-Host '  ' -NoNewline
        foreach ($col in @('DarkYellow','Yellow','DarkGreen','Green','Cyan','DarkCyan')) {
            Write-Host '        ' -BackgroundColor $col -NoNewline
        }
        Write-Host ''
    }
}

function Show-Header {
    Write-Host ''
    Write-Host '      \  |  /' -ForegroundColor DarkYellow
    Write-Host '   ---' -ForegroundColor DarkYellow -NoNewline
    Write-Host ' ( * ) ' -ForegroundColor Yellow -NoNewline
    Write-Host '---' -ForegroundColor DarkYellow -NoNewline
    Write-Host '    Resolve AI' -ForegroundColor White
    Write-Host '      /  |  \' -ForegroundColor DarkYellow -NoNewline
    Write-Host '       AI motion graphics for DaVinci Resolve' -ForegroundColor DarkGray
    Write-Host ''
    Show-Bar
    Write-Host "       installer v$InstallerVersion" -ForegroundColor DarkGray
    Write-Host ''
}

function Step([int]$n, [string]$msg) {
    Write-Host ''
    $tag = "[$n/10]"
    if ($Ansi) {
        Write-Host (Tint (GradientAt ([double]($n - 1) / 9)) $tag) -NoNewline
    } else {
        Write-Host $tag -ForegroundColor Cyan -NoNewline
    }
    Write-Host "  $msg" -ForegroundColor White
}
function Ok([string]$msg) {
    Write-Host '       ' -NoNewline
    Write-Host $ICON_OK -ForegroundColor Green -NoNewline
    Write-Host "  $msg" -ForegroundColor Gray
}
function Warn([string]$msg) {
    Write-Host '       ' -NoNewline
    Write-Host $ICON_WARN -ForegroundColor Yellow -NoNewline
    Write-Host "  $msg" -ForegroundColor Gray
}
function Fail([string]$msg) {
    Write-Host ''
    Write-Host '       ' -NoNewline
    Write-Host $ICON_ERR -ForegroundColor Red -NoNewline
    Write-Host "  $msg" -ForegroundColor Red
    Write-Host ''
    try { Stop-InstallLog } catch {}
    Read-Host '       Press Enter to exit'
    exit 1
}

function Show-Success {
    $inner = 46
    $top = "  $BTL" + ($BH.ToString() * $inner) + $BTR
    $bot = "  $BBL" + ($BH.ToString() * $inner) + $BBR
    $text = "Resolve AI installed successfully"
    $pad = $inner - ($text.Length + 6)        # 6 = "  OK  " spacing
    $teal = GradientAt 1.0

    Write-Host ''
    Write-Host (Tint $teal $top)
    Write-Host (Tint $teal "  $BV") -NoNewline
    Write-Host '   ' -NoNewline
    Write-Host $ICON_OK -ForegroundColor Green -NoNewline
    Write-Host "  $text" -ForegroundColor White -NoNewline
    Write-Host (' ' * $pad) -NoNewline
    Write-Host (Tint $teal "$BV")
    Write-Host (Tint $teal $bot)
    Write-Host ''
    Write-Host '       Restart DaVinci Resolve, then open it from:' -ForegroundColor Gray
    Write-Host '       Workspace > Workflow Integration > Resolve AI' -ForegroundColor White
    Write-Host ''
}

# ---------------------------------------------------------------- paths
$InstallerDir     = $PSScriptRoot
$RepoRoot         = Split-Path -Parent $InstallerDir
$PluginSrc        = Join-Path $RepoRoot 'plugin'
$RendererSrc      = Join-Path $PluginSrc 'renderer'
$ConfigDir        = Join-Path $env:APPDATA 'Blackmagic Design\DaVinci Resolve\Claude Resolve'
$InstallerLog     = Join-Path $ConfigDir 'installer.log'
$DependencyStatus = Join-Path $ConfigDir 'dependency-status.json'
$ToolsDir         = Join-Path $ConfigDir 'tools'
$AppNpmPrefix     = Join-Path $ToolsDir 'npm'
$AppPythonVenv    = Join-Path $ToolsDir 'python'
$AppPythonScripts = Join-Path $AppPythonVenv 'Scripts'
# Windows/ProgramData path includes the "Support" segment (the macOS path omits
# it) — this matches Blackmagic's per-platform layout. Do not "sync" the two.
$Dest             = Join-Path $env:ProgramData 'Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\com.clauderesolve.plugin'
$InstallerVersion = '0.6.1-beta'
try {
    $InstallerVersion = (Get-Content -Raw -LiteralPath (Join-Path $PluginSrc 'package.json') | ConvertFrom-Json).version
} catch { }

# Elevate ONLY the plugin copy: everything else runs as the invoking user so
# Node/npm-global, the Claude CLI + login, and the Playwright Chromium cache
# land in the USER profile (mirrors the macOS drop-root model). ProgramData
# needs admin to write, so the copy runs in a minimal elevated child.
function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Copy-Plugin {
    $destLit = "'" + ($Dest -replace "'", "''") + "'"
    $srcLit  = "'" + ($PluginSrc -replace "'", "''") + "'"
    $payload = @"
`$ErrorActionPreference = 'Stop'
`$dest = $destLit
`$src = $srcLit
`$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
`$parent = Split-Path -Parent `$dest
if ((Test-Path -LiteralPath `$parent) -and -not (Test-Path -LiteralPath `$parent -PathType Container)) {
    Move-Item -LiteralPath `$parent -Destination "`$parent.blocked.`$stamp" -Force
}
New-Item -ItemType Directory -Path `$parent -Force | Out-Null
`$tempDest = "`$dest.incoming.`$stamp"
`$backupDest = "`$dest.backup.`$stamp"
Remove-Item -LiteralPath `$tempDest -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path `$tempDest -Force | Out-Null
Copy-Item -Path (Join-Path `$src '*') -Destination `$tempDest -Recurse -Force
foreach (`$rel in @('manifest.xml','main.js','preload.js','dist\index.html','data\builtin-template-packs.json','renderer\render.js','updater\install-update.ps1','updater\install-update.sh')) {
    if (-not (Test-Path -LiteralPath (Join-Path `$tempDest `$rel))) { throw "Staged plugin missing `$rel" }
}
try {
    if (Test-Path -LiteralPath `$backupDest) { Remove-Item -LiteralPath `$backupDest -Recurse -Force }
    if (Test-Path -LiteralPath `$dest) { Move-Item -LiteralPath `$dest -Destination `$backupDest -Force }
    Move-Item -LiteralPath `$tempDest -Destination `$dest -Force
} catch {
    Remove-Item -LiteralPath `$tempDest -Recurse -Force -ErrorAction SilentlyContinue
    if ((-not (Test-Path -LiteralPath `$dest)) -and (Test-Path -LiteralPath `$backupDest)) {
        Move-Item -LiteralPath `$backupDest -Destination `$dest -Force
    }
    throw
}
"@
    if (Test-Admin) {
        try { & ([scriptblock]::Create($payload)); return $true } catch { return $false }
    }
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($payload))
    try {
        $p = Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $enc)
        return ($p.ExitCode -eq 0)
    } catch {
        return $false   # user declined the UAC prompt
    }
}

function Start-InstallLog {
    try {
        New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
        Start-Transcript -Path $InstallerLog -Append | Out-Null
        Write-Host "       log: $InstallerLog" -ForegroundColor DarkGray
    } catch { }
}

function Stop-InstallLog {
    try { Stop-Transcript | Out-Null } catch { }
}

Start-InstallLog
Show-Header

New-Item -ItemType Directory -Path $ToolsDir -Force | Out-Null
New-Item -ItemType Directory -Path $AppNpmPrefix -Force | Out-Null
$env:Path = (@($AppNpmPrefix, $AppPythonScripts, $env:Path) | Where-Object { $_ }) -join ';'

$script:DependencyState = [ordered]@{
    generatedAt = (Get-Date).ToString('o')
    required = [ordered]@{}
    providers = [ordered]@{}
    optional = [ordered]@{}
    paths = [ordered]@{
        configDir = $ConfigDir
        toolsDir = $ToolsDir
        npmPrefix = $AppNpmPrefix
        pythonVenv = $AppPythonVenv
        installerLog = $InstallerLog
    }
}

function Set-DependencyStatus($group, $name, $state, $detail = '') {
    if (-not $script:DependencyState.Contains($group)) {
        $script:DependencyState[$group] = [ordered]@{}
    }
    $script:DependencyState[$group][$name] = [ordered]@{
        state = $state
        detail = $detail
        checkedAt = (Get-Date).ToString('o')
    }
    try {
        New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
        $script:DependencyState | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $DependencyStatus -Encoding UTF8
    } catch {}
}

# 1 - DaVinci Resolve
Step 1 'Checking DaVinci Resolve'
$resolveExe = Join-Path $env:ProgramFiles 'Blackmagic Design\DaVinci Resolve\Resolve.exe'
if (-not (Test-Path $resolveExe)) {
    Fail 'DaVinci Resolve not found. Install DaVinci Resolve Studio 21+ first.'
}
if (Get-Process -Name 'Resolve', 'DaVinci Resolve Welcome' -ErrorAction SilentlyContinue) {
    Warn 'DaVinci Resolve is running. Save your work first.'
    $answer = Read-Host '       Close Resolve and continue? (y/n)'
    if ($answer -match '^(y|yes)$') {
        $proc = Get-Process -Name 'Resolve', 'DaVinci Resolve Welcome' -ErrorAction SilentlyContinue
        if ($proc) {
            $proc.CloseMainWindow() | Out-Null
            for ($i = 0; $i -lt 10; $i++) {
                Start-Sleep -Milliseconds 800
                if (-not (Get-Process -Name 'Resolve', 'DaVinci Resolve Welcome' -ErrorAction SilentlyContinue)) { break }
            }
            Get-Process -Name 'Resolve', 'DaVinci Resolve Welcome' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        }
        Ok 'Resolve closed.'
    } else {
        Fail 'Cancelled. Quit DaVinci Resolve, then re-run the installer.'
    }
}
Ok 'Resolve found. (Workflow Integration Plugins require the Studio edition.)'
Set-DependencyStatus 'required' 'resolve' 'installed' $resolveExe

# 2 - Node.js 18+
Step 2 'Checking Node.js'

# Pull PATH (and the nodejs dir) back into this session after an installer
# writes them to the registry but not to our already-running environment.
function Sync-Path {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user    = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = (@($AppNpmPrefix, $AppPythonScripts, $machine, $user) | Where-Object { $_ }) -join ';'
    $nodeDir = Join-Path $env:ProgramFiles 'nodejs'
    if ((Test-Path $nodeDir) -and ($env:Path -notlike "*$nodeDir*")) {
        $env:Path = "$nodeDir;$env:Path"
    }
}

function Get-NodeMajor {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $cmd) { return 0 }
    try {
        $v = (& node --version).Trim()
        return [int](($v.TrimStart('v')).Split('.')[0])
    } catch { return 0 }
}

# Newest LTS version string (e.g. 'v22.11.0') from nodejs.org, or $null.
# index.json is sorted newest-first, so the first LTS entry is the latest.
$NodeLtsFallback = 'v20.18.0'
function Get-LatestNodeLts {
    try {
        $oldPref = $ProgressPreference
        $ProgressPreference = 'SilentlyContinue'
        $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
        $ProgressPreference = $oldPref
        $lts = $index | Where-Object { $_.lts } | Select-Object -First 1
        if ($lts -and $lts.version) { return $lts.version }
    } catch { $ProgressPreference = 'Continue' }
    return $null
}

function Install-Node {
    # Strategy 1 - winget (present on Windows 10 21H2+ / Windows 11).
    # The OpenJS.NodeJS.LTS package already tracks the current LTS.
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Warn 'Installing Node.js via winget (administrator approval may be requested)...'
        try {
            Start-Process winget -Verb RunAs -Wait -ArgumentList @(
                'install', '--id', 'OpenJS.NodeJS.LTS', '--silent',
                '--accept-source-agreements', '--accept-package-agreements')
        } catch {}
        Sync-Path
        if ((Get-NodeMajor) -ge 18) { return $true }
        Warn 'winget install did not produce a usable Node.js - trying the official MSI.'
    } else {
        Warn 'winget not available - downloading the official Node.js MSI.'
    }

    # Strategy 2 - official Node.js MSI from nodejs.org.
    $arch = if ([Environment]::Is64BitOperatingSystem) {
        if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    } else { 'x86' }
    $nodeVersion = Get-LatestNodeLts
    if (-not $nodeVersion) {
        Warn "Could not look up the latest LTS - using $NodeLtsFallback."
        $nodeVersion = $NodeLtsFallback
    }
    $msiUrl = "https://nodejs.org/dist/$nodeVersion/node-$nodeVersion-$arch.msi"
    $msiPath = Join-Path $env:TEMP 'node-lts-installer.msi'
    try {
        Warn "Downloading Node.js LTS $nodeVersion ($arch) from nodejs.org..."
        $oldPref = $ProgressPreference
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath -UseBasicParsing
        $ProgressPreference = $oldPref
        Warn 'Running the Node.js installer (administrator approval may be requested)...'
        $p = Start-Process msiexec.exe -Verb RunAs -ArgumentList @(
            '/i', "`"$msiPath`"", '/qn', '/norestart'
        ) -Wait -PassThru
        Remove-Item $msiPath -Force -ErrorAction SilentlyContinue
        Sync-Path
        return ((Get-NodeMajor) -ge 18) -and ($p.ExitCode -eq 0)
    } catch {
        $ProgressPreference = 'Continue'
        Remove-Item $msiPath -Force -ErrorAction SilentlyContinue
        Warn "MSI install failed: $($_.Exception.Message)"
        return $false
    }
}

$nodeMajor = Get-NodeMajor
if ($nodeMajor -lt 18) {
    if ($nodeMajor -eq 0) {
        Warn 'Node.js not found - installing automatically...'
    } else {
        Warn "Node.js 18+ required, found v$nodeMajor - upgrading automatically..."
    }
    if (-not (Install-Node)) {
        Fail 'Could not install Node.js automatically. Install Node.js 18+ from https://nodejs.org and re-run the installer.'
    }
    $nodeMajor = Get-NodeMajor
}
$nodeVer = (& node --version).Trim()
Ok "Node.js $nodeVer"
Set-DependencyStatus 'required' 'node' 'installed' $nodeVer

# 3 - AI CLI
Step 3 'Installing AI CLIs'
function Test-AppCommand($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}
function Install-AppNpmPackage($label, $packageName, $commandName) {
    if (Test-AppCommand $commandName) {
        Ok "$label CLI present."
        Set-DependencyStatus 'providers' $commandName 'installed' 'Found on PATH.'
        return $true
    }
    Warn "Installing $label CLI into Resolve AI tools..."
    & npm install -g --prefix $AppNpmPrefix $packageName --no-audit --no-fund
    if ($LASTEXITCODE -eq 0 -and (Test-AppCommand $commandName)) {
        Ok "$label CLI installed."
        Set-DependencyStatus 'providers' $commandName 'installed' $AppNpmPrefix
        return $true
    }
    Warn "$label CLI install failed. You can repair later from Settings > Setup."
    Set-DependencyStatus 'providers' $commandName 'repair-failed' "npm install -g --prefix $AppNpmPrefix $packageName"
    return $false
}
$haveCodex = Install-AppNpmPackage 'OpenAI Codex' '@openai/codex' 'codex'
$haveClaude = Install-AppNpmPackage 'Claude Code' '@anthropic-ai/claude-code' 'claude'
if ($haveClaude -and (Test-Path (Join-Path $env:USERPROFILE '.claude\.credentials.json'))) {
    Ok 'Claude Code appears logged in.'
    Set-DependencyStatus 'providers' 'claudeLogin' 'installed' 'Claude credentials found.'
} elseif ($haveCodex) {
    try {
        & codex login status *> $null
        if ($LASTEXITCODE -eq 0) {
            Ok 'OpenAI Codex CLI appears logged in.'
            Set-DependencyStatus 'providers' 'codexLogin' 'installed' 'Codex login status OK.'
        } else {
            Warn 'OpenAI Codex CLI installed but not logged in - run codex login in terminal.'
            Set-DependencyStatus 'providers' 'codexLogin' 'needs-login' 'Run codex login.'
        }
    } catch {
        Warn 'OpenAI Codex CLI installed but login status could not be checked - run codex login in terminal.'
        Set-DependencyStatus 'providers' 'codexLogin' 'needs-login' 'Run codex login.'
    }
} else {
    Warn 'Install or log in to at least one provider: claude login or codex login.'
    Set-DependencyStatus 'providers' 'aiCli' 'repair-failed' 'No AI provider CLI available.'
}

# 4 - Renderer dependencies
Step 4 'Installing renderer dependencies (Playwright)'
Push-Location $RendererSrc
& npm install --no-audit --no-fund
$exit = $LASTEXITCODE
Pop-Location
if ($exit -ne 0) { Fail 'npm install failed in plugin\renderer.' }
Ok 'Renderer dependencies installed.'
Set-DependencyStatus 'required' 'rendererDependencies' 'installed' $RendererSrc

$distIndex = Join-Path $PluginSrc 'dist\index.html'
if (-not (Test-Path $distIndex)) {
    Warn 'Plugin UI bundle missing - building plugin\dist...'
    Push-Location $PluginSrc
    & npm install --no-audit --no-fund
    $installExit = $LASTEXITCODE
    if ($installExit -eq 0) {
        & npm run build
        $buildExit = $LASTEXITCODE
    } else {
        $buildExit = $installExit
    }
    Pop-Location
    if ($buildExit -ne 0 -or -not (Test-Path $distIndex)) {
        Fail 'Could not build plugin UI. Normal users should download ResolveAI-Windows-vX.Y.Z.zip from GitHub Releases, not Source code.zip. Contributors can run: npm --prefix plugin install; npm --prefix plugin run build; then re-run the installer.'
    }
    Ok 'Plugin UI bundle built.'
} else {
    Ok 'Plugin UI bundle present.'
}

$templatePackPath = Join-Path $PluginSrc 'data\builtin-template-packs.json'
if (-not (Test-Path $templatePackPath)) {
    Warn 'Built-in template packs missing - creating starter pack...'
    $templateDir = Split-Path -Parent $templatePackPath
    New-Item -ItemType Directory -Path $templateDir -Force | Out-Null
@'
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
'@ | Set-Content -Path $templatePackPath -Encoding UTF8
}
Ok 'Built-in template packs present.'

# 5 - Chromium
Step 5 'Downloading Playwright Chromium'
# Pin the browser cache to this user's profile so install-time and run-time
# (the plugin runs as the logged-in user inside Resolve) always agree.
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:LOCALAPPDATA 'ms-playwright'
Push-Location $RendererSrc
& npx --yes playwright install chromium
$exit = $LASTEXITCODE
Pop-Location
if ($exit -ne 0) { Fail 'Playwright Chromium download failed.' }
Ok 'Chromium installed.'
Set-DependencyStatus 'required' 'playwrightChromium' 'installed' $env:PLAYWRIGHT_BROWSERS_PATH

# 6 - ffmpeg
Step 6 'Checking render dependencies'
$renderDepsCheck = Join-Path $PluginSrc 'scripts\check-render-deps.js'
if (-not (Test-Path $renderDepsCheck)) {
    Fail 'Render dependency self-test is missing from plugin\scripts.'
}
Push-Location $PluginSrc
& node $renderDepsCheck
$renderDepsExit = $LASTEXITCODE
Pop-Location
if ($renderDepsExit -ne 0) {
    Fail 'Render dependency self-test failed. Re-run this installer with internet access so ffmpeg-static and Playwright can install, or install FFmpeg manually with: winget install Gyan.FFmpeg.'
}
Ok 'Render dependencies ready.'
Set-DependencyStatus 'required' 'renderEngine' 'installed' 'ffmpeg-static / Playwright render self-test passed.'

# 7 - Optional local engines
Step 7 'Installing optional local engines'
$pythonCmd = $null
foreach ($candidate in @('py', 'python', 'python3')) {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) {
        $pythonCmd = $candidate
        break
    }
}
if (-not $pythonCmd) {
    Warn 'Python not found. Manim and Whisper are optional; install Python 3.11+ later from Settings > Setup.'
    Set-DependencyStatus 'optional' 'python' 'not-installed' 'Python 3.11+ not found.'
} else {
    try {
        if (-not (Test-Path (Join-Path $AppPythonScripts 'python.exe'))) {
            Warn 'Creating Resolve AI local Python environment...'
            & $pythonCmd -m venv $AppPythonVenv
        }
    } catch {
        Warn "Could not create local Python environment: $($_.Exception.Message)"
    }
    $venvPython = Join-Path $AppPythonScripts 'python.exe'
    if (-not (Test-Path $venvPython)) { $venvPython = $pythonCmd }
    Set-DependencyStatus 'optional' 'python' 'installed' $venvPython
    try {
        & $venvPython -m pip install --upgrade pip *> $null
    } catch {}

    $manimReady = $false
    try {
        & $venvPython -m manim --version *> $null
        $manimReady = ($LASTEXITCODE -eq 0)
    } catch {
        $manimReady = $false
    }
    if (-not $manimReady) {
        Warn 'Installing Manim Community Edition into Resolve AI tools...'
        & $venvPython -m pip install --upgrade manim
        $manimReady = ($LASTEXITCODE -eq 0)
    }
    if ($manimReady) {
        Ok 'Manim Community Edition ready.'
        Set-DependencyStatus 'optional' 'manim' 'installed' $AppPythonVenv
    } else {
        Warn 'Manim install failed. Normal overlay generation still works.'
        Set-DependencyStatus 'optional' 'manim' 'repair-failed' 'python -m pip install manim'
    }

    $whisperReady = $false
    try {
        & $venvPython -m whisper --help *> $null
        $whisperReady = ($LASTEXITCODE -eq 0)
    } catch {
        $whisperReady = $false
    }
    if (-not $whisperReady) {
        Warn 'Installing OpenAI Whisper into Resolve AI tools...'
        & $venvPython -m pip install --upgrade openai-whisper
        $whisperReady = ($LASTEXITCODE -eq 0)
    }
    if ($whisperReady) {
        Ok 'Whisper ready.'
        Set-DependencyStatus 'optional' 'whisper' 'installed' $AppPythonVenv
    } else {
        Warn 'Whisper install failed. SRT/VTT transcript import still works.'
        Set-DependencyStatus 'optional' 'whisper' 'repair-failed' 'python -m pip install openai-whisper'
    }

    if ($manimReady -or $whisperReady) {
        $venvActivate = Join-Path $AppPythonScripts 'Activate.ps1'
        if (Test-Path $venvActivate) {
            Write-Host "       local tools venv: $AppPythonVenv" -ForegroundColor DarkGray
        }
    }
}

# 8 - Copy plugin into DaVinci Resolve (elevated — the only step that needs admin)
Step 8 'Installing plugin into DaVinci Resolve'
if (-not (Test-Admin)) {
    Write-Host '       (Windows will ask for administrator approval to copy the plugin)' -ForegroundColor DarkGray
}
if (-not (Copy-Plugin)) {
    Fail 'Could not copy the plugin into DaVinci Resolve (the administrator prompt may have been declined, or the copy failed).'
}
Ok "Installed to $Dest"
Set-DependencyStatus 'required' 'pluginCopy' 'installed' $Dest

# 9 - Verify
Step 9 'Verifying installation'
$required = @(
    'manifest.xml',
    'main.js',
    'data\builtin-template-packs.json',
    'ipc\assets.js',
    'ipc\agent.js',
    'ipc\agent-logs.js',
    'ipc\captions.js',
    'ipc\codex.js',
    'ipc\codex-parser.js',
    'ipc\codex-stderr-filter.js',
    'ipc\render-health.js',
    'ipc\render-validation.js',
    'ipc\repair.js',
    'ipc\runtime-qa.js',
    'ipc\showcase.js',
    'ipc\template-packs.js',
    'ipc\templates.js',
    'ipc\updates.js',
    'dist\index.html',
    'renderer\render.js',
    'renderer\node_modules\ffmpeg-static',
    'renderer\node_modules\playwright',
    'scripts\check-render-deps.js',
    'updater\install-update.ps1',
    'updater\install-update.sh'
)
foreach ($rel in $required) {
    if (-not (Test-Path (Join-Path $Dest $rel))) {
        Fail "Verification failed - missing: $rel"
    }
}
Ok 'All required files present.'
Set-DependencyStatus 'required' 'pluginVerification' 'installed' $Dest

# 10 - Done
Step 10 'Done'
Stop-InstallLog
Show-Success
Read-Host '       Press Enter to exit'
