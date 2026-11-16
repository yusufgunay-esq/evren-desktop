@echo off
rem EVREN Desktop baslatici (Windows). Baslatma mantigi tek yerde: basla.js
rem macOS karsiligi EVREN.command de ayni basla.js'i cagirir; mantik burada tekrarlanmaz.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
    echo [!] Node.js bulunamadi. Node.js 20+ kurun: https://nodejs.org
    pause
    exit /b 1
)
rem Bagimlilik kontrolu/kurulumu gorunur konsolda; uygulama gizli pencerede acilir.
node "%~dp0basla.js" --hazirla
if errorlevel 1 (
    echo [!] Kurulum tamamlanamadi. Node.js 20+ ve internet baglantisini kontrol edin.
    pause
    exit /b 1
)
start "" powershell -NoProfile -WindowStyle Hidden -Command "node '%~dp0basla.js'"
