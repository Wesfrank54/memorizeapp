@echo off
setlocal
title Memorize App Launcher

set "APP_DIR=C:\Users\weslf\Claude\memorize-app"
set "URL=http://localhost:5173"

cd /d "%APP_DIR%" || (
  echo Could not find app folder: %APP_DIR%
  pause
  exit /b 1
)

echo Starting Memorize dev server...
start "Memorize Dev Server" cmd /k "npm run dev"

echo Waiting for %URL% to come up...
powershell -NoProfile -Command "for($i=0;$i -lt 60;$i++){ try{ (Invoke-WebRequest -Uri '%URL%' -UseBasicParsing -TimeoutSec 2) ^| Out-Null; exit 0 }catch{ Start-Sleep -Milliseconds 500 } }; exit 1"

if errorlevel 1 (
  echo Server did not respond in time. Opening browser anyway...
) else (
  echo Server is up.
)

start "" "%URL%"
endlocal
exit
