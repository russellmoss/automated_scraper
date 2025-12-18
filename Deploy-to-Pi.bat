@echo off
:: ============================================================
:: Savvy Pirate - One-Click Deploy to Raspberry Pi
:: Double-click this file to deploy!
:: ============================================================

:: Path to Git Bash
set GIT_BASH="C:\Program Files\Git\bin\bash.exe"

:: Path to your deploy script
set DEPLOY_SCRIPT="/c/Users/russe/automated_scraper/deploy-to-pi.sh"

:: Run the deployment (full deploy by default)
:: Change to --quick for faster deploys during development
%GIT_BASH% -c "%DEPLOY_SCRIPT% --files-only"

:: Keep window open to see results
echo.
echo ========================================
echo Press any key to close this window...
pause > nul
