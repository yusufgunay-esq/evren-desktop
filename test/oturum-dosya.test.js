// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Yusuf Günay. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { oturumDosyasiBul } = require('../sohbet.js');

test('başka oturumun sahiplendiği kayıt aday olmaz (ad karışması regresyonu)', (t) => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'evren-dosya-'));
  t.after(() => fs.rmSync(kok, { recursive: true, force: true }));
  const dizin = 'D:\Projelerim\ornek-proje';
  const klasor = path.join(kok, dizin.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(klasor, { recursive: true });
  const a = '11111111-1111-1111-1111-111111111111';
  const b = '22222222-2222-2222-2222-222222222222';
  fs.writeFileSync(path.join(klasor, a + '.jsonl'), '{}\n');
  const bekle = Date.now() + 15;
  while (Date.now() < bekle) { /* doğum sırası ayrışsın */ }
  fs.writeFileSync(path.join(klasor, b + '.jsonl'), '{}\n');

  const ilk = oturumDosyasiBul({ dizin, kokDizin: kok, baslangicMs: 0 });
  assert.ok(ilk && ilk.endsWith(b + '.jsonl'), 'en yeni kayıt seçilir');

  const ikinci = oturumDosyasiBul({ dizin, kokDizin: kok, baslangicMs: 0, haric: new Set([b]) });
  assert.ok(ikinci && ikinci.endsWith(a + '.jsonl'), 'sahiplenilen kayıt atlanır');
});
