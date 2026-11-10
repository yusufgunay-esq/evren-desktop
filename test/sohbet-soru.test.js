/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Yusuf Günay. */
// Soru aracı: AskUserQuestion girdisi seçenekleriyle birlikte sohbete taşınır.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const sohbet = require('../sohbet');

const soruGirdisi = {
  questions: [{
    question: 'Hangi disk temizlensin?',
    header: 'Disk',
    multiSelect: false,
    options: [
      { label: 'C diski (Önerilen)', description: '~18 GB açılır' },
      { label: 'D diski' },
    ],
  }],
};

test('soru girdisi seçenekleriyle çözülür', () => {
  const sorular = sohbet.sorulariCoz(soruGirdisi);
  assert.strictEqual(sorular.length, 1);
  assert.strictEqual(sorular[0].soru, 'Hangi disk temizlensin?');
  assert.strictEqual(sorular[0].baslik, 'Disk');
  assert.strictEqual(sorular[0].cokSecim, false);
  assert.deepStrictEqual(sorular[0].secenekler, [
    { etiket: 'C diski (Önerilen)', aciklama: '~18 GB açılır' },
    { etiket: 'D diski', aciklama: '' },
  ]);
});

test('soru olmayan girdi null döner', () => {
  assert.strictEqual(sohbet.sorulariCoz({ command: 'ls' }), null);
  assert.strictEqual(sohbet.sorulariCoz(null), null);
});

test('tool_use girişi soru metnini ve yapılandırılmış seçenekleri taşır', () => {
  const girisler = sohbet.girisleriCoz({
    type: 'assistant',
    timestamp: new Date().toISOString(),
    message: {
      content: [{
        type: 'tool_use',
        id: 'tool-1',
        name: 'AskUserQuestion',
        input: soruGirdisi,
      }],
    },
  }, new Map());

  assert.strictEqual(girisler.length, 1);
  const giris = girisler[0];
  assert.strictEqual(giris.arac.ad, 'AskUserQuestion');
  assert.strictEqual(giris.metin, 'Hangi disk temizlensin?');
  assert.strictEqual(giris.arac.sorular[0].secenekler.length, 2);
  assert.strictEqual(giris.arac.sonuc, undefined);
});

test('araç dönüş kaydı sonuc olarak işaretlenir', () => {
  const adlar = new Map([['tool-1', { ad: 'AskUserQuestion', ozet: 'Hangi disk temizlensin?' }]]);
  const girisler = sohbet.girisleriCoz({
    type: 'user',
    timestamp: new Date().toISOString(),
    message: {
      content: [{
        type: 'tool_result',
        tool_use_id: 'tool-1',
        content: 'Your questions have been answered: "Hangi disk temizlensin?"="C diski".',
      }],
    },
  }, adlar);

  assert.strictEqual(girisler[0].arac.ad, 'AskUserQuestion');
  assert.strictEqual(girisler[0].arac.sonuc, true);
});
