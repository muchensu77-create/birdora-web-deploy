@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Push a project folder to GitHub

echo.
echo  ==============================================
echo    Push a project folder to GitHub
echo  ==============================================
echo.

where git >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Git was not found. Install Git for Windows and try again.
    goto :failed
)

set "SOURCE_DIR="
set /p "SOURCE_DIR=Project folder path: "
if not defined SOURCE_DIR (
    echo  [ERROR] The project folder path is required.
    goto :failed
)
set "SOURCE_DIR=!SOURCE_DIR:"=!"

for %%I in ("!SOURCE_DIR!") do set "SOURCE_DIR=%%~fI"
if not exist "!SOURCE_DIR!\" (
    echo  [ERROR] Folder not found: !SOURCE_DIR!
    goto :failed
)

set "REPO_INPUT="
set /p "REPO_INPUT=GitHub repository or branch URL: "
if not defined REPO_INPUT (
    echo  [ERROR] The GitHub URL is required.
    goto :failed
)
set "REPO_INPUT=!REPO_INPUT:"=!"

call :normalize_github_url
if errorlevel 1 goto :failed

echo.
echo  Repository: !REPO_URL!
echo  Branch:     !TARGET_BRANCH!
echo.

pushd "!SOURCE_DIR!" || goto :failed

if not exist ".git\" (
    echo  [1/5] Initializing a Git repository...
    git init
    if errorlevel 1 goto :git_failed
) else (
    echo  [1/5] Using the existing Git repository...
)

echo  [2/5] Staging project files...
git add -A
if errorlevel 1 goto :git_failed

set "SECRET_STAGED="
for /f "usebackq delims=" %%F in (`git diff --cached --name-only`) do (
    set "STAGED_FILE=%%F"
    for %%G in ("%%F") do set "STAGED_NAME=%%~nxG"
    if /i "!STAGED_NAME!"==".env" set "SECRET_STAGED=1"
    if /i "!STAGED_NAME:~0,5!"==".env." if /i not "!STAGED_NAME!"==".env.example" set "SECRET_STAGED=1"
    if /i "!STAGED_NAME:~-4!"==".pem" set "SECRET_STAGED=1"
    if /i "!STAGED_NAME!"=="id_rsa" set "SECRET_STAGED=1"
    if /i "!STAGED_NAME!"=="id_ed25519" set "SECRET_STAGED=1"
)
if defined SECRET_STAGED (
    echo  [ERROR] A staged .env, PEM, or private-key file was detected.
    echo          Add secrets to .gitignore before trying again.
    goto :git_failed
)

for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm-ss"') do set "TIMESTAMP=%%I"
git diff --cached --quiet
if errorlevel 1 (
    echo  [3/5] Creating a commit...
    git commit -m "chore: publish project !TIMESTAMP!"
    if errorlevel 1 (
        echo  [ERROR] Commit failed. Configure your Git identity first:
        echo          git config --global user.name "Your Name"
        echo          git config --global user.email "you@example.com"
        goto :git_failed
    )
) else (
    echo  [3/5] No new file changes. Skipping the commit.
)

git rev-parse --verify HEAD >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] The repository has no commit to push.
    goto :git_failed
)

echo  [4/5] Configuring the GitHub remote...
git remote get-url origin >nul 2>&1
if errorlevel 1 (
    git remote add origin "!REPO_URL!"
) else (
    git remote set-url origin "!REPO_URL!"
)
if errorlevel 1 goto :git_failed

if /i "!BIRDORA_PUSH_DRY_RUN!"=="1" (
    echo  [5/5] Dry run enabled. Skipping the network push.
    popd
    exit /b 0
)

set "REMOTE_BRANCH_HASH="
for /f "tokens=1" %%H in ('git ls-remote --heads origin "refs/heads/!TARGET_BRANCH!" 2^>nul') do set "REMOTE_BRANCH_HASH=%%H"
if defined REMOTE_BRANCH_HASH (
    git cat-file -e "!REMOTE_BRANCH_HASH!^{commit}" >nul 2>&1
    if errorlevel 1 (
        set "REMOTE_HISTORY_DIFFERS=1"
    ) else (
        git merge-base --is-ancestor "!REMOTE_BRANCH_HASH!" HEAD >nul 2>&1
        if errorlevel 1 set "REMOTE_HISTORY_DIFFERS=1"
    )

    if defined REMOTE_HISTORY_DIFFERS (
        echo.
        echo  [WARNING] The target branch contains a different commit history.
        echo            A normal push cannot replace it safely.
        echo            Type OVERWRITE only if this local folder should replace
        echo            the current contents of !TARGET_BRANCH!.
        set "OVERWRITE_CONFIRMATION="
        set /p "OVERWRITE_CONFIRMATION=Confirmation: "
        if not "!OVERWRITE_CONFIRMATION!"=="OVERWRITE" (
            echo  Push cancelled. The remote branch was not changed.
            goto :push_cancelled
        )

        echo  [5/5] Replacing !TARGET_BRANCH! with force-with-lease...
        git push -u origin "HEAD:!TARGET_BRANCH!" "--force-with-lease=refs/heads/!TARGET_BRANCH!:!REMOTE_BRANCH_HASH!"
        if errorlevel 1 goto :git_failed
        goto :push_complete
    )
)

echo  [5/5] Pushing HEAD to !TARGET_BRANCH!...
echo          Complete Git authentication if prompted.
git push -u origin "HEAD:!TARGET_BRANCH!"
if errorlevel 1 goto :git_failed

:push_complete
popd
echo.
echo  Push completed: !REPO_URL!
echo  Target branch:  !TARGET_BRANCH!
echo  Local folder:   !SOURCE_DIR!
echo.
pause
exit /b 0

:normalize_github_url
set "REPO_URL="
set "TARGET_BRANCH=main"

if /i "!REPO_INPUT:~0,19!"=="https://github.com/" (
    set "REPO_PATH=!REPO_INPUT:~19!"
    if "!REPO_PATH:~-1!"=="/" (
        set "REPO_PATH=!REPO_PATH:~0,-1!"
    )

    for /f "tokens=1,2,* delims=/" %%A in ("!REPO_PATH!") do (
        set "REPO_OWNER=%%A"
        set "REPO_NAME=%%B"
        set "REPO_EXTRA=%%C"
    )

    if not defined REPO_OWNER goto :invalid_github_url
    if not defined REPO_NAME goto :invalid_github_url
    set "REPO_NAME=!REPO_NAME:.git=!"

    if defined REPO_EXTRA (
        if /i not "!REPO_EXTRA:~0,5!"=="tree/" goto :invalid_github_url
        set "TARGET_BRANCH=!REPO_EXTRA:~5!"
        if not defined TARGET_BRANCH goto :invalid_github_url
    )

    set "REPO_URL=https://github.com/!REPO_OWNER!/!REPO_NAME!.git"
) else if /i "!REPO_INPUT:~0,15!"=="git@github.com:" (
    set "REPO_URL=!REPO_INPUT!"
) else (
    goto :invalid_github_url
)

git check-ref-format "refs/heads/!TARGET_BRANCH!" >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Invalid target branch: !TARGET_BRANCH!
    exit /b 1
)
exit /b 0

:invalid_github_url
echo  [ERROR] Enter a GitHub repository URL or a branch URL.
echo          Repository: https://github.com/user/repository.git
echo          Branch:     https://github.com/user/repository/tree/feature/name
echo          SSH:        git@github.com:user/repository.git
exit /b 1

:git_failed
popd
echo.
echo  [ERROR] Git failed. The command output above contains the reason.
echo          Remote history is only replaced after typing OVERWRITE.
goto :failed

:push_cancelled
popd

:failed
echo.
pause
exit /b 1
