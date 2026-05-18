@echo off
set DEST=C:\ProgramData\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\com.clauderesolve.plugin

echo Installing renderer dependencies...
pushd "%~dp0plugin\renderer"
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo Error: npm install failed.
    popd
    pause
    exit /b 1
)
call npx --yes playwright install chromium
if errorlevel 1 (
    echo Error: Playwright Chromium download failed.
    popd
    pause
    exit /b 1
)
popd

echo Installing Claude Resolve...
xcopy /E /I /Y "%~dp0plugin" "%DEST%"
echo.
echo Done. Restart DaVinci Resolve to use the plugin.
echo Open it from Workspace ^> Workflow Integration ^> Claude Resolve
pause
