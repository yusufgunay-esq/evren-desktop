// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
// Ortak başlatıcı: Windows (EVREN.bat) ve macOS (EVREN.command) aynı mantığı buradan çağırır.
// Kip: (yok) uygulamayı açar · --hazirla yalnız bağımlılığı hazırlar · --kontrol yolu yazıp çıkar.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const KOK = __dirname;

// electron paketinin index.js'i Electron dışında ikili yolunu döndürür; yedek: bilinen konumlar.
function electronYolu() {
  try {
    const p = require(path.join(KOK, 'node_modules', 'electron'));
    if (typeof p === 'string' && p && fs.existsSync(p)) return p;
  } catch {}
  const adaylar = process.platform === 'win32'
    ? [path.join(KOK, 'node_modules', 'electron', 'dist', 'electron.exe')]
    : [path.join(KOK, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
       path.join(KOK, 'node_modules', 'electron', 'dist', 'electron')];
  return adaylar.find((x) => fs.existsSync(x)) || '';
}

// Bağımlılık yoksa bir kez kurar; Windows'ta npm.cmd shell üzerinden çağrılır.
function hazirla() {
  if (electronYolu()) return true;
  console.error('[EVREN] Bağımlılıklar eksik; kuruluyor (npm install)…');
  const r = spawnSync('npm', ['install'], { cwd: KOK, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0 || !electronYolu()) {
    console.error('[EVREN] Kurulum tamamlanamadı. Node.js 20+ ve internet bağlantısını kontrol edin.');
    return false;
  }
  return true;
}

function main() {
  const arg = new Set(process.argv.slice(2));
  if (arg.has('--kontrol')) {
    const yol = electronYolu();
    console.log(JSON.stringify({ electron: yol, platform: process.platform }));
    return yol ? 0 : 1;
  }
  if (!hazirla()) return 1;
  if (arg.has('--hazirla')) return 0;
  const cocuk = spawn(electronYolu(), ['.'], { cwd: KOK, stdio: 'ignore' });
  cocuk.on('error', (e) => { console.error('[EVREN] Uygulama açılamadı: ' + ((e && e.message) || e)); process.exit(1); });
  cocuk.on('exit', (kod) => process.exit(kod == null ? 0 : kod));
  return null; // uygulama kapanana kadar süreç yaşar
}

const kod = main();
if (typeof kod === 'number') process.exit(kod);
