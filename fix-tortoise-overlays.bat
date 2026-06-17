@echo off
REM ============================================================
REM  Fix TortoiseGit icon overlays not showing on Windows.
REM
REM  Cause: Windows only honors the first ~15 icon overlay
REM  handlers (sorted alphabetically by key name; more leading
REM  spaces = higher priority). ".WorkspaceExt0-6" (Workspace)
REM  and "AccExtIco1-3" (Acronis) outranked TortoiseGit and
REM  pushed its 9 handlers out of the effective range.
REM
REM  Fix: re-register the 9 Tortoise keys with 7 leading spaces
REM  so they sort ahead of every competitor. Nothing is deleted.
REM
REM  MUST be run as Administrator (right-click > Run as admin).
REM  Reversible: re-run TortoiseGit setup to restore defaults.
REM ============================================================

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo This script must be run as Administrator.
    echo Right-click the file and choose "Run as administrator".
    pause
    exit /b 1
)

set "ROOT=HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\ShellIconOverlayIdentifiers"

echo Removing old (2-space) Tortoise overlay keys...
reg delete "%ROOT%\  Tortoise1Normal"      /f >nul 2>&1
reg delete "%ROOT%\  Tortoise2Modified"    /f >nul 2>&1
reg delete "%ROOT%\  Tortoise3Conflict"    /f >nul 2>&1
reg delete "%ROOT%\  Tortoise4Locked"      /f >nul 2>&1
reg delete "%ROOT%\  Tortoise5ReadOnly"    /f >nul 2>&1
reg delete "%ROOT%\  Tortoise6Deleted"     /f >nul 2>&1
reg delete "%ROOT%\  Tortoise7Added"       /f >nul 2>&1
reg delete "%ROOT%\  Tortoise8Ignored"     /f >nul 2>&1
reg delete "%ROOT%\  Tortoise9Unversioned" /f >nul 2>&1

echo Re-registering Tortoise overlay keys with 7 leading spaces...
reg add "%ROOT%\       Tortoise1Normal"      /ve /t REG_SZ /d "{C5994560-53D9-4125-87C9-F193FC689CB2}" /f
reg add "%ROOT%\       Tortoise2Modified"    /ve /t REG_SZ /d "{C5994561-53D9-4125-87C9-F193FC689CB2}" /f
reg add "%ROOT%\       Tortoise3Conflict"    /ve /t REG_SZ /d "{C5994562-53D9-4125-87C9-F193FC689CB2}" /f
reg add "%ROOT%\       Tortoise4Locked"      /ve /t REG_SZ /d "{C5994563-53D9-4125-87C9-F193FC689CB2}" /f
reg add "%ROOT%\       Tortoise5ReadOnly"    /ve /t REG_SZ /d "{C5994564-53D9-4125-87C9-F193FC689CB2}" /f
reg add "%ROOT%\       Tortoise6Deleted"     /ve /t REG_SZ /d "{C5994565-53D9-4125-87C9-F193FC689CB2}" /f
reg add "%ROOT%\       Tortoise7Added"       /ve /t REG_SZ /d "{C5994566-53D9-4125-87C9-F193FC689CB2}" /f
reg add "%ROOT%\       Tortoise8Ignored"     /ve /t REG_SZ /d "{C5994567-53D9-4125-87C9-F193FC689CB2}" /f
reg add "%ROOT%\       Tortoise9Unversioned" /ve /t REG_SZ /d "{C5994568-53D9-4125-87C9-F193FC689CB2}" /f

echo.
echo Done. Restarting Explorer to apply changes...
taskkill /f /im explorer.exe >nul 2>&1
start explorer.exe

echo.
echo TortoiseGit overlays re-registered with top priority.
echo If icons still don't show, reboot once.
pause
