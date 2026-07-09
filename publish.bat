@echo off
chcp 65001 >nul
title Agent Group Chain - Publish

echo.
echo  ========================================
echo    Agent Group Chain - Publish to GitHub
echo  ========================================
echo.

set "SOURCE_DIR=D:\zhuo_mian\MoreAgentsTogether_t1"
set "GITHUB_REPO=https://github.com/Xiaodaocs/AgentsGroupChain.git"

:: Generate timestamp
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set "datetime=%%I"
set "TIMESTAMP=%datetime:~0,4%%datetime:~4,2%%datetime:~6,2%_%datetime:~8,2%%datetime:~10,2%%datetime:~12,2%"
set "TARGET_DIR=D:\zhuo_mian\MoreAgentsTogether_github_%TIMESTAMP%"

echo  Source:   %SOURCE_DIR%
echo  Target:   %TARGET_DIR%
echo  Repo:     %GITHUB_REPO%
echo.

:: Step 1: Copy directory
echo  [1/4] Copying project...
xcopy /E /I /Q /Y "%SOURCE_DIR%" "%TARGET_DIR%" >nul
if %errorlevel% neq 0 (
    echo  [ERROR] Copy failed!
    pause
    exit /b 1
)
echo  Done.
echo.

:: Step 2: Clean user data
echo  [2/4] Cleaning user data...
cd /d "%TARGET_DIR%"

:: Remove node_modules (recursive)
if exist "node_modules" (
    echo    Removing node_modules...
    rmdir /S /Q "node_modules" >nul 2>&1
)
if exist "apps\server\node_modules" (
    echo    Removing apps/server/node_modules...
    rmdir /S /Q "apps\server\node_modules" >nul 2>&1
)
if exist "apps\web\node_modules" (
    echo    Removing apps/web/node_modules...
    rmdir /S /Q "apps\web\node_modules" >nul 2>&1
)

:: Remove dist folders
if exist "apps\server\dist" (
    echo    Removing apps/server/dist...
    rmdir /S /Q "apps\server\dist" >nul 2>&1
)
if exist "apps\web\dist" (
    echo    Removing apps/web/dist...
    rmdir /S /Q "apps\web\dist" >nul 2>&1
)

:: Remove database files
if exist "apps\server\data\*.db" (
    echo    Removing database files...
    del /Q "apps\server\data\*.db" >nul 2>&1
)

:: Remove test directories
if exist "test-project" (
    echo    Removing test-project...
    rmdir /S /Q "test-project" >nul 2>&1
)
if exist "test-project2" (
    echo    Removing test-project2...
    rmdir /S /Q "test-project2" >nul 2>&1
)

:: Remove .git if exists
if exist ".git" (
    echo    Removing old .git...
    rmdir /S /Q ".git" >nul 2>&1
)

echo  Done.
echo.

:: Step 3: Git setup and commit
echo  [3/4] Initializing Git repository...
cd /d "%TARGET_DIR%"
git init >nul 2>&1
git add . >nul 2>&1
git commit -m "feat: Agent Group Chain (AGC) - Multi-Agent Collaboration System" >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Git commit failed!
    pause
    exit /b 1
)
echo  Done.
echo.

:: Step 4: Push to GitHub
echo  [4/4] Pushing to GitHub...
git branch -M main >nul 2>&1
git remote add origin %GITHUB_REPO% >nul 2>&1
git push -u origin main --force
if %errorlevel% neq 0 (
    echo  [ERROR] Push failed! You may need to check your GitHub credentials.
    pause
    exit /b 1
)

echo.
echo  ========================================
echo    Publish completed successfully!
echo  ========================================
echo.
echo  Published to: %GITHUB_REPO%
echo  Local copy:   %TARGET_DIR%
echo.
pause
