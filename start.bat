@echo off
echo Starting Leavs...
start "Leavs Server" cmd /k "cd /d %~dp0server && node --watch src/index.js"
timeout /t 2 /nobreak >nul
start "Leavs Client" cmd /k "cd /d %~dp0client && npx vite"
timeout /t 3 /nobreak >nul
start http://localhost:5173
