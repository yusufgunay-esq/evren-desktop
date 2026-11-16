/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
// Çapraz platform saf yardımcıları: PTY komut planı, süreç haritası, ConPTY kararı.
// Electron require etmez; her işlev platform parametresiyle koşar (test edilebilir).
'use strict';
const path = require('node:path');

// POSIX tek tırnak kuralı: her argüman '…' içine, arg içindeki ' → '\'' biçimine döner.
function posixTekTirnak(a) {
  return `'${String(a).replace(/'/g, `'\\''`)}'`;
}

// PTY komut planı (saf). win32: claude.exe; darwin/linux: claude.
// macOS'ta Finder/Dock'tan açılan GUI uygulaması shell PATH'ini almaz; birincil komut
// bulunamazsa spawnYedek login shell ile PATH'i yükleyip yeniden dener.
function spawnPlanla(platform, arglar) {
  const arg = (Array.isArray(arglar) ? arglar : []).map(String);
  return platform === 'win32' ? { dosya: 'claude.exe', arglar: arg } : { dosya: 'claude', arglar: arg };
}

// Birincil komut açılamayınca kullanılan sarmalayıcı (saf).
// win32: ComSpec (cmd.exe) /d /s /c claude; darwin/linux: login shell -lc 'exec claude …'
// (-l bayrağı /etc/paths'i yükler, exec claude'ı bu shell'in yerine koyar).
function spawnYedek(platform, env, arglar) {
  const arg = (Array.isArray(arglar) ? arglar : []).map(String);
  if (platform === 'win32') return { dosya: (env && env.ComSpec) || 'cmd.exe', arglar: ['/d', '/s', '/c', 'claude', ...arg] };
  const kabuk = (env && env.SHELL) || '/bin/zsh';
  return { dosya: kabuk, arglar: ['-lc', 'exec claude ' + arg.map(posixTekTirnak).join(' ')] };
}

// ConPTY yalnız Windows'a özgüdür; darwin/Linux'ta node-pty kendi pseudo-terminalini açar.
const conptyKullan = (platform) => platform === 'win32';

// `ps -axo pid=,ppid=,comm=` çıktısını ebeveyn → çocuk haritasına çevirir (saf).
// comm alanı macOS'ta tam yol olabilir: path.basename ile adı alınır, '.exe' kırpılır.
function psCiktiAyristir(cikti) {
  const ebeveyn = new Map();
  for (const satir of String(cikti || '').split(/\r?\n/)) {
    const p = satir.trim().split(/\s+/);
    if (p.length < 3 || !/^\d+$/.test(p[0]) || !/^\d+$/.test(p[1])) continue;
    const par = Number(p[1]);
    const ad = path.basename(p.slice(2).join(' ')).replace(/\.exe$/i, '').toLowerCase();
    if (!ebeveyn.has(par)) ebeveyn.set(par, []);
    ebeveyn.get(par).push({ id: Number(p[0]), ad });
  }
  return ebeveyn;
}

module.exports = { posixTekTirnak, spawnPlanla, spawnYedek, conptyKullan, psCiktiAyristir };
