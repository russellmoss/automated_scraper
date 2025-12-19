@echo off
:: ============================================================
:: Savvy Pirate - One-Click Deploy to Raspberry Pi
:: Double-click this file to deploy!
:: ============================================================

:: Path to Git Bash
set GIT_BASH="C:\Program Files\Git\bin\bash.exe"

:: Path to your deploy script
set DEPLOY_SCRIPT="/c/Users/russe/automated_scraper/deploy-to-pi.sh"

:: ============================================================
:: CONFIGURATION - Connection Mode
:: ============================================================
:: Options:
::   -t or --tailscale  : Use Tailscale VPN (default, works from anywhere)
::   -l or --local      : Use local network connection
::
:: Default connection mode (can be overridden via command line)
set DEFAULT_MODE=-t

:: ============================================================
:: Parse command line arguments
:: ============================================================
set CONNECTION_MODE=%DEFAULT_MODE%
set DEPLOY_OPTION=--files-only

:parse_args
if "%~1"=="" goto :deploy
if /i "%~1"=="-t" set CONNECTION_MODE=-t && shift && goto :parse_args
if /i "%~1"=="--tailscale" set CONNECTION_MODE=-t && shift && goto :parse_args
if /i "%~1"=="-l" set CONNECTION_MODE=-l && shift && goto :parse_args
if /i "%~1"=="--local" set CONNECTION_MODE=-l && shift && goto :parse_args
if "%~1"=="--files-only" set DEPLOY_OPTION=--files-only && shift && goto :parse_args
if "%~1"=="--quick" set DEPLOY_OPTION=--quick && shift && goto :parse_args
if "%~1"=="--restart" set DEPLOY_OPTION=--restart && shift && goto :parse_args
if "%~1"=="--status" set DEPLOY_OPTION=--status && shift && goto :parse_args
if "%~1"=="--help" set DEPLOY_OPTION=--help && shift && goto :parse_args
echo Unknown option: %~1
echo.
echo Usage: Deploy-to-Pi.bat [connection-mode] [deploy-option]
echo.
echo Connection Modes:
echo   -t, --tailscale   Use Tailscale VPN (default)
echo   -l, --local       Use local network
echo.
echo Deploy Options:
echo   --files-only      Copy files only (default)
echo   --quick           Quick deploy
echo   --restart         Restart Chromium only
echo   --status          Show Pi status
echo   --help            Show help
pause > nul
exit /b 1

:deploy
:: Display connection mode
if "%CONNECTION_MODE%"=="-t" (
    echo [INFO] Connection Mode: Tailscale VPN
) else (
    echo [INFO] Connection Mode: Local Network
)
echo.

:: Run the deployment
%GIT_BASH% -c "%DEPLOY_SCRIPT% %CONNECTION_MODE% %DEPLOY_OPTION%"

:: Keep window open to see results
echo.
echo ========================================
echo Press any key to close this window...
pause > nul
