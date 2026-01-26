@echo off
echo ========================================
echo   Git Auto Push Script
echo ========================================
echo.

REM Check if commit message was provided as argument
if "%1"=="" (
    set "COMMIT_MSG=Auto commit: %date% %time%"
) else (
    set "COMMIT_MSG=%*"
)

echo Adding all changes...
git add .

echo.
echo Committing changes...
echo Commit message: %COMMIT_MSG%
git commit -m "%COMMIT_MSG%"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Warning: Commit failed or no changes to commit
    echo Continuing with push...
)

echo.
echo Pushing to origin main...
git push origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo   Successfully pushed to GitHub!
    echo ========================================
) else (
    echo.
    echo ========================================
    echo   Push failed! Check the error above.
    echo ========================================
)

echo.
pause
