@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
set "MODE=%~1"

if /i "%MODE%"=="auto" (
    call :main >> "%~dp0scan-log.txt" 2>&1
) else (
    call :main
)
goto :eof

:main
echo ============================================
echo  Scan lance le %date% %time%
echo  (nouveaux animes + nouveaux episodes)
echo ============================================
echo.

echo [1/6] Mise a jour episodes/saisons (Crunchyroll + ADN)...
call node scripts\update-episodes.js
if errorlevel 1 echo   ATTENTION : update-episodes.js a echoue.

echo.
echo [2/6] Scan des nouveaux animes doubles en VF (Crunchyroll)...
call node scripts\cr-vf-scan.js
if errorlevel 1 echo   ATTENTION : cr-vf-scan.js a echoue.

echo.
echo [3/6] Verification des liens Crunchyroll/ADN...
call node scripts\check-availability.js
if errorlevel 1 echo   ATTENTION : check-availability.js a echoue (non bloquant).

echo.
echo [4/6] Verification des liens Netflix/Disney+/Prime Video...
call node scripts\check-platform-links.js
if errorlevel 1 echo   ATTENTION : check-platform-links.js a echoue (non bloquant).

echo.
echo [5/6] Scan JustWatch - series (Netflix/Disney+/Prime Video)...
call node scripts\justwatch-merge.js SHOW
if errorlevel 1 echo   ATTENTION : justwatch-merge.js SHOW a echoue (non bloquant).

echo.
echo [6/6] Scan JustWatch - films (Netflix/Disney+/Prime Video)...
call node scripts\justwatch-merge.js MOVIE
if errorlevel 1 echo   ATTENTION : justwatch-merge.js MOVIE a echoue (non bloquant).

echo.
echo ============================================
echo  Verification des changements sur catalog.js
echo ============================================
git diff --quiet -- catalog.js
if not errorlevel 1 (
    echo Aucun changement detecte dans catalog.js.
    goto :end
)

echo Changements detectes :
git diff --stat -- catalog.js
echo.

if /i "%MODE%"=="auto" (
    set "COMMIT_MSG=chore: scan automatique local du catalogue (toutes les 6h)"
) else (
    set "COMMIT_MSG=chore: scan manuel du catalogue (episodes, saisons, nouveaux animes VF)"
)

git add catalog.js
git commit -m "!COMMIT_MSG!"
git push
if errorlevel 1 (
    echo ERREUR : le push a echoue. Verifiez la connexion / l'authentification git.
) else (
    echo Catalogue publie sur le vrai site en ligne.
)

:end
echo.
echo Scan termine le %date% %time%
if /i not "%MODE%"=="auto" pause
