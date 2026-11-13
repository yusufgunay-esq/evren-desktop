// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Yusuf Günay. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ansiTemizle, hedefDurakladi } = require('../oturum-karar');

test('ANSI renk ve imleç dizileri temizlenir, metin korunur', () => {
  const ESC = String.fromCharCode(27);
  const ham = ESC + '[31mGoal paused' + ESC + '[0m · Türkçe metin';
  assert.strictEqual(ansiTemizle(ham), 'Goal paused · Türkçe metin');
});

test('hedef duraklaması tanınır (ANSI ve satır sarma dahil)', () => {
  const ESC = String.fromCharCode(27);
  assert.ok(hedefDurakladi('● Goal paused · the goal check timed out · send a message to continue'));
  assert.ok(hedefDurakladi('Goal paused · the goal check timed out · send a message\nto continue'));
  assert.ok(hedefDurakladi(ESC + '[2mGoal paused' + ESC + '[0m · send a message to continue'));
});

test('yarım ya da ilgisiz metin tetiklemez', () => {
  assert.ok(!hedefDurakladi('Goal paused · the goal check timed out'));
  assert.ok(!hedefDurakladi('devam etmek için mesaj gönder'));
  assert.ok(!hedefDurakladi(''));
});

const { hedefDevamIzni, hedefDevamKur } = require('../oturum-karar');

test('otomatik devam bütçesi: en çok 3 kez, aralarında 90 sn', () => {
  const sinir = { enCok: 3, aralik: 90000 };
  assert.ok(hedefDevamIzni({ sayi: 0, son: 0 }, 1000000, sinir));
  assert.ok(!hedefDevamIzni({ sayi: 3, son: 0 }, 1000000, sinir), 'bütçe doldu');
  assert.ok(!hedefDevamIzni({ sayi: 1, son: 1000000 - 50000 }, 1000000, sinir), 'aralık dolmadı');
  assert.ok(hedefDevamIzni({ sayi: 1, son: 1000000 - 90000 }, 1000000, sinir), 'aralık doldu');
});

test('zamanlayıcı iptal edilir, yeni kurulum öncekini düşürür', () => {
  let sonGeriCagri = null;
  let iptalSayisi = 0;
  const z = hedefDevamKur({
    gecikme: 10,
    zamanla: (fn) => { sonGeriCagri = fn; return { fn }; },
    iptal: () => { iptalSayisi++; },
  });
  let sayi = 0;
  z.kur(() => { sayi++; });
  assert.ok(z.bekliyor);
  z.iptalEt();
  sonGeriCagri();
  assert.strictEqual(sayi, 0, 'iptal edilen geri çağrı koşmaz');
  assert.ok(!z.bekliyor);

  z.kur(() => { sayi++; });
  const eskiNesil = sonGeriCagri;
  z.kur(() => { sayi += 10; });
  eskiNesil();
  assert.strictEqual(sayi, 0, 'eski nesil düşer');
  sonGeriCagri();
  assert.strictEqual(sayi, 10);
  assert.ok(iptalSayisi >= 2, 'önceki zamanlayıcılar iptal edildi');
});
