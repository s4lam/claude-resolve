@echo off
REM Friendly double-click launcher for Resolve AI releases.
REM Starts the real installer from the internal installer folder.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\install.ps1"
