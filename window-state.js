// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
// Pencere durumu: boyut, konum, büyütme/tam ekran. Saf geometri (test edilebilir);
// ekran geometrisi dışarıdan verilir, electron'a bağımlılık yok. Kalıcı yazma atomik.
'use strict';
const fs = require('node:fs');
const { atomikJsonYazSync } = require('./motor');

const VARSAYILAN_GENISLIK = 1240;
const VARSAYILAN_YUKSEKLIK = 800;
const MIN_GENISLIK = 760;
const MIN_YUKSEKLIK = 480;
const MIN_GORUNUR_PX = 64;     // antigravity/kodlar/asar/app/dist/windowState.js:53
const KAYDET_GECIKME_MS = 250; // antigravity/kodlar/asar/app/dist/windowState.js:55

const sayiMi = (v) => typeof v === 'number' && Number.isFinite(v);

function durumAyristir(ham, varsayilan = {}) {
  const defW = sayiMi(varsayilan.width) ? Math.round(varsayilan.width) : VARSAYILAN_GENISLIK;
  const defH = sayiMi(varsayilan.height) ? Math.round(varsayilan.height) : VARSAYILAN_YUKSEKLIK;
  if (!ham || typeof ham !== 'object') {
    return { width: defW, height: defH, isMaximized: false, isFullScreen: false };
  }
  const width = sayiMi(ham.width) && ham.width >= MIN_GENISLIK ? Math.round(ham.width) : defW;
  const height = sayiMi(ham.height) && ham.height >= MIN_YUKSEKLIK ? Math.round(ham.height) : defH;
  const koordinatVar = sayiMi(ham.x) && sayiMi(ham.y);
  return {
    ...(koordinatVar ? { x: Math.round(ham.x), y: Math.round(ham.y) } : {}),
    width,
    height,
    isMaximized: Boolean(ham.isMaximized),
    isFullScreen: Boolean(ham.isFullScreen),
    ...(ham.displayBounds && typeof ham.displayBounds === 'object' ? { displayBounds: ham.displayBounds } : {}),
  };
}

function ekranIcinCoz(durum, ekranlar) {
  const liste = Array.isArray(ekranlar) ? ekranlar : [];
  const temiz = durumAyristir(durum);
  if (!liste.length) return temiz;
  const alanAl = (e) => (e && e.workArea && sayiMi(e.workArea.width) ? e.workArea : e && e.bounds);
  if (!sayiMi(temiz.x) || !sayiMi(temiz.y)) {
    const birincil = alanAl(liste[0]);
    if (!birincil) return temiz;
    return {
      ...temiz,
      width: Math.min(temiz.width, Math.max(MIN_GENISLIK, Math.round(birincil.width))),
      height: Math.min(temiz.height, Math.max(MIN_YUKSEKLIK, Math.round(birincil.height))),
    };
  }
  let enIyi = null, enAlan = 0;
  for (const e of liste) {
    const a = alanAl(e);
    if (!a || !sayiMi(a.x) || !sayiMi(a.y) || !(a.width > 0) || !(a.height > 0)) continue;
    const ow = Math.min(temiz.x + temiz.width, a.x + a.width) - Math.max(temiz.x, a.x);
    const oh = Math.min(temiz.y + temiz.height, a.y + a.height) - Math.max(temiz.y, a.y);
    if (ow >= MIN_GORUNUR_PX && oh >= MIN_GORUNUR_PX) {
      const alan = ow * oh;
      if (alan > enAlan) { enAlan = alan; enIyi = a; }
    }
  }
  if (!enIyi) {
    // Bağlı olmayan ekran: ekran dışı koordinatları at, birincil ekrana sığdır.
    const birincil = alanAl(liste[0]);
    return {
      width: Math.min(temiz.width, Math.max(MIN_GENISLIK, Math.round((birincil && birincil.width) || temiz.width))),
      height: Math.min(temiz.height, Math.max(MIN_YUKSEKLIK, Math.round((birincil && birincil.height) || temiz.height))),
      isMaximized: temiz.isMaximized,
      isFullScreen: temiz.isFullScreen,
    };
  }
  const w = Math.min(temiz.width, Math.max(MIN_GENISLIK, Math.round(enIyi.width)));
  const h = Math.min(temiz.height, Math.max(MIN_YUKSEKLIK, Math.round(enIyi.height)));
  const x = Math.max(Math.round(enIyi.x), Math.min(temiz.x, Math.round(enIyi.x + enIyi.width - MIN_GORUNUR_PX)));
  const y = Math.max(Math.round(enIyi.y), Math.min(temiz.y, Math.round(enIyi.y + enIyi.height - MIN_GORUNUR_PX)));
  return { x, y, width: w, height: h, isMaximized: temiz.isMaximized, isFullScreen: temiz.isFullScreen, displayBounds: { x: enIyi.x, y: enIyi.y, width: enIyi.width, height: enIyi.height } };
}

function oku(dosya, varsayilan) {
  try {
    if (!fs.existsSync(dosya)) return durumAyristir(null, varsayilan);
    const ham = fs.readFileSync(dosya, 'utf8').trim();
    return ham ? durumAyristir(JSON.parse(ham), varsayilan) : durumAyristir(null, varsayilan);
  } catch {
    return durumAyristir(null, varsayilan);
  }
}

function yaz(dosya, durum) {
  try {
    atomikJsonYazSync(dosya, JSON.stringify(durumAyristir(durum), null, 2));
    return true;
  } catch { return false; }
}

function izle(pencere, dosya, screenModulu) {
  let zaman = null;
  let sonNormal = null;
  const anlik = () => {
    if (!pencere || pencere.isDestroyed()) return null;
    const isFullScreen = pencere.isFullScreen();
    const isMaximized = pencere.isMaximized();
    const b = (!isMaximized && !isFullScreen) ? pencere.getBounds() : (sonNormal || pencere.getNormalBounds?.() || pencere.getBounds());
    if (!isMaximized && !isFullScreen && b) sonNormal = { x: b.x, y: b.y, width: b.width, height: b.height };
    let displayBounds;
    try {
      const d = screenModulu && b ? screenModulu.getDisplayMatching(b) : null;
      if (d && d.workArea) displayBounds = { ...d.workArea };
    } catch {}
    return { x: b.x, y: b.y, width: b.width, height: b.height, isMaximized, isFullScreen, ...(displayBounds ? { displayBounds } : {}) };
  };
  const kaydet = () => {
    if (zaman) { clearTimeout(zaman); zaman = null; }
    const d = anlik();
    if (d) yaz(dosya, d);
  };
  const planla = () => {
    if (zaman) clearTimeout(zaman);
    zaman = setTimeout(kaydet, KAYDET_GECIKME_MS);
    if (zaman.unref) zaman.unref();
  };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) {
    pencere.on(ev, planla);
  }
  pencere.on('close', kaydet);
  return { kaydet };
}

module.exports = {
  VARSAYILAN_GENISLIK, VARSAYILAN_YUKSEKLIK, MIN_GENISLIK, MIN_YUKSEKLIK, MIN_GORUNUR_PX, KAYDET_GECIKME_MS,
  durumAyristir, ekranIcinCoz, oku, yaz, izle,
};
