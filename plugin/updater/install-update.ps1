param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$Backup,
    [int]$ParentPid = 0
)

$ErrorActionPreference = "Stop"

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Quote-Arg([string]$Value) {
    return '"' + ($Value -replace '"', '`"') + '"'
}

function Require-File([string]$PathValue) {
    if (-not (Test-Path -LiteralPath $PathValue -PathType Leaf)) {
        throw "Missing required file: $PathValue"
    }
}

if (-not (Test-Admin)) {
    $argsList = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", (Quote-Arg $PSCommandPath),
        "-Source", (Quote-Arg $Source),
        "-Destination", (Quote-Arg $Destination),
        "-Backup", (Quote-Arg $Backup),
        "-ParentPid", $ParentPid
    )
    $p = Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -PassThru -ArgumentList ($argsList -join " ")
    exit $p.ExitCode
}

if ($Destination -notmatch '[\\/]Workflow Integration Plugins[\\/]com\.clauderesolve\.plugin$') {
    throw "Refusing unexpected plugin destination: $Destination"
}

Write-Host "Resolve AI updater"
Write-Host "Waiting for plugin window to close..."

$waited = 0
while ($ParentPid -gt 0 -and (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) -and $waited -lt 60) {
    Start-Sleep -Seconds 1
    $waited += 1
}
if ($ParentPid -gt 0 -and (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) {
    Write-Host "Plugin process still open after 60 seconds; continuing with staged install."
}

$Source = (Resolve-Path -LiteralPath $Source).Path
$parentDir = Split-Path -Parent $Destination
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tempDest = "$Destination.incoming.$timestamp"

Require-File (Join-Path $Source "manifest.xml")
Require-File (Join-Path $Source "main.js")
Require-File (Join-Path $Source "preload.js")
Require-File (Join-Path $Source "dist\index.html")
Require-File (Join-Path $Source "renderer\render.js")

New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
Remove-Item -LiteralPath $tempDest -Recurse -Force -ErrorAction SilentlyContinue

try {
    Write-Host "Copying staged update..."
    Copy-Item -LiteralPath $Source -Destination $tempDest -Recurse -Force

    $oldRendererDeps = Join-Path $Destination "renderer\node_modules"
    $newRendererDeps = Join-Path $tempDest "renderer\node_modules"
    if ((Test-Path -LiteralPath $oldRendererDeps) -and (-not (Test-Path -LiteralPath $newRendererDeps))) {
        Write-Host "Preserving renderer dependencies..."
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $newRendererDeps) | Out-Null
        Copy-Item -LiteralPath $oldRendererDeps -Destination $newRendererDeps -Recurse -Force
    }

    if (Test-Path -LiteralPath $Backup) {
        Remove-Item -LiteralPath $Backup -Recurse -Force
    }

    if (Test-Path -LiteralPath $Destination) {
        Write-Host "Backing up current plugin..."
        Move-Item -LiteralPath $Destination -Destination $Backup -Force
    }

    Write-Host "Installing new plugin..."
    Move-Item -LiteralPath $tempDest -Destination $Destination -Force

    Write-Host ""
    Write-Host "Update installed."
    Write-Host "Reopen Resolve AI from Workspace > Workflow Integration."
    exit 0
} catch {
    Write-Host ""
    Write-Host "Update failed: $($_.Exception.Message)"
    Remove-Item -LiteralPath $tempDest -Recurse -Force -ErrorAction SilentlyContinue

    if ((-not (Test-Path -LiteralPath $Destination)) -and (Test-Path -LiteralPath $Backup)) {
        Write-Host "Restoring previous plugin..."
        Move-Item -LiteralPath $Backup -Destination $Destination -Force
    }
    exit 1
}
