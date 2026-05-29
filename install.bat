@echo off
REM Resolve AI installer launcher.
REM Runs install.ps1 as the current user. Node/npm, AI CLIs, and Playwright
REM Chromium must live in the user's profile; install.ps1 elevates only the
REM final plugin copy into ProgramData.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
