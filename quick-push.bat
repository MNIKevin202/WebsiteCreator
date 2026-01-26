@echo off
echo ========================================
echo   Git Auto Push Script (Quick)
echo ========================================
echo.

REM Get current date and time for commit message
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set "COMMIT_MSG=Auto commit: %date% %time%"

echo Adding all changes...
git add .

echo Committing changes...
git commit -m "%COMMIT_MSG%"

if %ERRORLEVEL% NEQ 0 (
    echo No changes to commit or commit failed
    exit /b
)

echo Pushing to origin main...
git push origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo Successfully pushed to GitHub!
) else (
    echo Push failed!
)
