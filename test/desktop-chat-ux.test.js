/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
// Masaüstü sohbet/terminal UX sözleşmesi: otomatik Ctrl+L yok, birleşik yazım, push + artımlı DOM,
// boş proje listesinde oturumlar görünür.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Gorunum = require('../gorunum');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test('gorunum.gonderilecekMetin trims and collapses whitespace without trailing CR', () => {
  assert.equal(Gorunum.gonderilecekMetin('  merhaba\n  dunya  '), 'merhaba dunya');
  assert.equal(Gorunum.gonderilecekMetin('   '), '');
  // Existing gonderilecek preserved for backward compatibility
  assert.equal(Gorunum.gonderilecek('test'), 'test\r');
});

test('app.js: hizaKontrol automatic Ctrl+L injection is completely removed', () => {
  assert.doesNotMatch(appSrc, /function hizaKontrol\b/);
  assert.doesNotMatch(appSrc, /window\.evren\.yaz\([^)]*\\x0c/);
});

test('app.js: desktop chat bar and palette commands use komutYaz (separate Enter)', () => {
  assert.match(appSrc, /window\.evren\.komutYaz\s*\(\s*o\.pid\s*,\s*metin\s*\)/);
  assert.match(appSrc, /komutYaz\s*\(\s*ao\.pid\s*,\s*['"]\/rapor['"]\s*\)/);
  assert.match(appSrc, /komutYaz\s*\(\s*ao\.pid\s*,\s*['"]\/summarize['"]\s*\)/);
});

test('app.js: chat uses push subscription + incremental append and no 1500ms unconditional poll', () => {
  assert.match(appSrc, /function sohbetArtirimliEkle\b/);
  assert.match(appSrc, /insertAdjacentHTML\s*\(\s*['"]beforeend['"]/);
  assert.match(appSrc, /sohbetYeniDinle/);
  assert.doesNotMatch(appSrc, /setInterval\([\s\S]{0,140}sohbetYukle\(\)[\s\S]{0,40}1500\)/);
});

test('app.js: sidebar does not hide sessions when S.projeler is empty and S.gecmis is non-empty', () => {
  assert.match(appSrc, /\(!S\.projeler\s*\|\|\s*!S\.projeler\.length\)\s*&&\s*\(!S\.gecmis\s*\|\|\s*!S\.gecmis\.length\)/);
});

test('app.js: yama.cjs patch anchors still intact after UX fixes', () => {
  const anchors = [
    "if (S.oturumlar.filter((o) => o.canli).length >= 8) { olay('OTURUM', 'en çok 8 canlı oturum', 'uyari'); return; }",
    'if (!modalOrkestrator) modalKodYazma = false;',
    'const hazir = S.yuklendi && S.anahtarVar && !!m.id;',
    'if (S.basliyor || !S.yuklendi || !S.anahtarVar) return;',
    "if ($('modalEforIpucu')) $('modalEforIpucu').textContent = eObj ? (eObj.not || '') : '';",
  ];
  for (const a of anchors) assert.ok(appSrc.includes(a), `Missing yama.cjs anchor: ${a}`);
});
