// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
// Panel tercihleri: sabitlenen / arşivlenen oturumlar, elle proje seçimi, kümeleme biçimi.
// Tek küçük JSON (userData altında); bozuk ya da eksik dosyada güvenli varsayılan, yazma atomik (geçici dosya + rename).
'use strict';
const fs = require('node:fs');
const motor = require('./motor');

const DOSYA_ADI = 'panel-tercih.json';
const SINIR = 2000;
const ACILAN_SINIR = 20;
const KUMELER = ['tarih', 'proje'];

function varsayilan() {
  return { sabit: [], arsiv: [], proje: {}, kume: 'tarih', gorulen: {}, gorulenTaban: 0, acilan: [] };
}
const kimlikMi = (k) => typeof k === 'string' && k.length > 0 && k.length <= 80;
function liste(ham) {
  if (!Array.isArray(ham)) return [];
  return [...new Set(ham.filter(kimlikMi))].slice(-SINIR);
}
// Her girdiyi güvenli şekle indirir; bilinmeyen alanlar atılır.
function temizle(ham) {
  const v = varsayilan();
  if (!ham || typeof ham !== 'object' || Array.isArray(ham)) return v;
  v.sabit = liste(ham.sabit);
  v.arsiv = liste(ham.arsiv);
  if (ham.proje && typeof ham.proje === 'object' && !Array.isArray(ham.proje)) {
    for (const [k, yol] of Object.entries(ham.proje).slice(-SINIR)) {
      if (kimlikMi(k) && typeof yol === 'string' && yol.trim() && yol.length <= 1024) v.proje[k] = yol.trim();
    }
  }
  // Okunmamış işareti: oturum kimliği -> son görülme ms; taban = özelliğin ilk açıldığı an; acilan = en yeni önde.
  if (ham.gorulen && typeof ham.gorulen === 'object' && !Array.isArray(ham.gorulen)) {
    for (const [k, ms] of Object.entries(ham.gorulen).slice(-SINIR)) {
      if (kimlikMi(k) && Number.isFinite(ms) && ms > 0) v.gorulen[k] = ms;
    }
  }
  v.gorulenTaban = Number.isFinite(ham.gorulenTaban) && ham.gorulenTaban > 0 ? ham.gorulenTaban : 0;
  if (Array.isArray(ham.acilan)) v.acilan = [...new Set(ham.acilan.filter(kimlikMi))].slice(0, ACILAN_SINIR);
  v.kume = KUMELER.includes(ham.kume) ? ham.kume : 'tarih';
  return v;
}
function oku(dosya) {
  try {
    return temizle(JSON.parse(fs.readFileSync(dosya, 'utf8')));
  } catch (e) {
    // Dosya varsa ama bozuksa silmeden yedekle (ENOENT'te yedek yok).
    if (!e || e.code !== 'ENOENT') {
      try { if (fs.existsSync(dosya)) motor.bozukYedekle(dosya); } catch {}
    }
    return varsayilan();
  }
}
// Atomik yazma: geçici dosya + Windows EPERM/EBUSY yeniden denemeli rename; yarım dosya oluşmaz.
function yaz(dosya, ham) {
  const v = temizle(ham);
  motor.atomikJsonYazSync(dosya, JSON.stringify(v));
  return v;
}

module.exports = { DOSYA_ADI, varsayilan, temizle, oku, yaz };
