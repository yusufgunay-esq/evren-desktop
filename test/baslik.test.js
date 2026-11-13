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
const { baslikDuzelt, baslikAnlamsiz } = require('../oturum-karar');
const { baslikOku } = require('../gecmis');

test('başlık temizliği: sarmalayan tırnak atılır, içteki kesme işareti korunur', () => {
  assert.strictEqual(baslikDuzelt('"Claude\'un paneli"'), "Claude'un paneli");
  assert.strictEqual(baslikDuzelt('  – Oturum adları...  '), 'Oturum adları');
  assert.strictEqual(baslikDuzelt('...'), '');
  assert.ok(baslikDuzelt('a'.repeat(80)).length <= 48);
});

test('anlamsız mesaj ad olmaz', () => {
  assert.ok(baslikAnlamsiz('devam'));
  assert.ok(baslikAnlamsiz('Tamam.'));
  assert.ok(baslikAnlamsiz('123 ...'));
  assert.ok(!baslikAnlamsiz('Sekme adlarını düzelt'));
});

test('ilk mesaj "devam" ise sekme adı ilk anlamlı mesajdan gelir', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'evren-baslik-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const dosya = path.join(d, 'x.jsonl');
  fs.writeFileSync(dosya, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'devam' } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'sekme adlarını düzeltir misin' } }),
  ].join('\n') + '\n');
  assert.strictEqual(baslikOku(dosya, true, true).baslik, 'sekme adlarını düzeltir misin');
  assert.strictEqual(baslikOku(dosya, true).baslik, 'devam');
});
