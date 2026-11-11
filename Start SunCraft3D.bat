@echo off
rem Starts SunCraft3D and opens it in the browser. Keep this window open while you work.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing, this happens only once...
  call npm install
)
if not exist .next\BUILD_ID (
  echo Preparing the app, this happens only once...
  call npx next build
)
start "" http://localhost:3600
call npx next start -H 127.0.0.1 -p 3600
pause
