@echo off
rem 구매관리 플랫폼 로컬 서버 — 더블클릭하면 http://localhost:5600 에서 열립니다
cd /d "%~dp0"
start "" http://localhost:5600
npx --yes serve -l 5600 .
pause
