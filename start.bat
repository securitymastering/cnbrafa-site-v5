@echo off
cd /d "%~dp0"
start "" /B node --no-warnings server.js
timeout /t 2 /nobreak >nul
start "" http://localhost:4173
echo.
echo CNBRAFA V5 esta rodando em http://localhost:4173
echo Modo OBS: http://localhost:4173/obs
echo Mantenha esta janela aberta. Pressione qualquer tecla para encerrar.
pause >nul
taskkill /F /IM node.exe >nul 2>&1
