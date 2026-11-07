@echo off
rem EVREN Desktop baslatici. Konsol penceresi acilmaz; Electron uygulamasi acilir.
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
    echo [!] Bagimliliklar kurulu degil. Bir kez: npm install
    echo     Klasor: %~dp0
    pause
    exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" "%~dp0"
