// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
// renderer-perf.test.js — GPU/CPU bütçesi sözleşmesi (iş emri renderer-gpu-webgl-budget)
// Kaynak denetimi: app.js kaynağında kalıcı rAF, tek-aktif WebGL, zamanlayıcı temizliği
// ve yama çapaları bu testlerle kilitlenir.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test('app.js: no permanent unconditional Kare.abone for Takimyildiz', () => {
  assert.doesNotMatch(appSrc, /^Kare\.abone\(\(now\)\s*=>\s*Takimyildiz\.ciz\(now\)\);/m);
  assert.match(appSrc, /if\s*\(!aboneler\.size\s*&&\s*raf\)\s*\{\s*cancelAnimationFrame\(raf\)/);
});

test('app.js: single-active WebGL lifecycle and scrollback cap <= 5000', () => {
  assert.match(appSrc, /const VARSAYILAN_SCROLLBACK\s*=\s*5000/);
  assert.match(appSrc, /function webglBagla\(o\)/);
  assert.match(appSrc, /function webglBirak\(o\)/);
  assert.match(appSrc, /function webglSenkronla\(\)/);
});

test('app.js: oturumKaynakTemizle disposes all timers and WebGL on tab close', () => {
  assert.match(appSrc, /function oturumKaynakTemizle\(o\)/);
  assert.match(appSrc, /clearInterval\(o\._adIzleTimer\)/);
  assert.match(appSrc, /clearInterval\(o\._sefIzleTimer\)/);
  assert.match(appSrc, /clearTimeout\(o\._modelTaraTimer\)/);
  assert.match(appSrc, /webglBirak\(o\)/);
});

test('app.js: 1s interval does not call oturumModeliTara every second', () => {
  const m = appSrc.match(/o\.sayac\s*=\s*setInterval\([\s\S]*?\},\s*1000\)/);
  assert.ok(m, 'o.sayac interval must exist');
  assert.doesNotMatch(m[0], /oturumModeliTara/);
});

test('app.js: yama.cjs patch anchors remain intact', () => {
  const anchors = [
    "if (S.oturumlar.filter((o) => o.canli).length >= 8) { olay('OTURUM', 'en çok 8 canlı oturum', 'uyari'); return; }",
    'if (!modalOrkestrator) modalKodYazma = false;',
    'const hazir = S.yuklendi && S.anahtarVar && !!m.id;',
    'if (S.basliyor || !S.yuklendi || !S.anahtarVar) return;',
    "if ($('modalEforIpucu')) $('modalEforIpucu').textContent = eObj ? (eObj.not || '') : '';",
  ];
  for (const a of anchors) assert.ok(appSrc.includes(a), `Missing yama.cjs anchor: ${a}`);
});
