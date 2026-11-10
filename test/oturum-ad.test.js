/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Yusuf Günay. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ozelBaslikYaz, ozelBaslikOku } = require('../gecmis');

function geciciDizin(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'evren-ad-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

test('ozelBaslikYaz yazdığı adı aynı dosyadan geri okur', (t) => {
  const dizin = path.join(geciciDizin(t), 'oturum');
  assert.strictEqual(ozelBaslikYaz(dizin, 'Telefon kumandası'), 'Telefon kumandası');
  assert.strictEqual(ozelBaslikOku(dizin), 'Telefon kumandası');
  const j = JSON.parse(fs.readFileSync(path.join(dizin, 'custom-title.json'), 'utf8'));
  assert.deepStrictEqual(j, { customTitle: 'Telefon kumandası' });
});

test('ozelBaslikYaz boşlukları toplar ve 80 karakterde keser', (t) => {
  const dizin = path.join(geciciDizin(t), 'oturum');
  assert.strictEqual(ozelBaslikYaz(dizin, '  çok   boşluklu \n ad  '), 'çok boşluklu ad');
  const uzun = ozelBaslikYaz(dizin, 'a'.repeat(120));
  assert.strictEqual(uzun.length, 80);
  assert.strictEqual(ozelBaslikOku(dizin).length, 80);
});

test('boş ad dosyayı siler ve oturum otomatik ada döner', (t) => {
  const dizin = path.join(geciciDizin(t), 'oturum');
  ozelBaslikYaz(dizin, 'elle verilen ad');
  const dosya = path.join(dizin, 'custom-title.json');
  assert.ok(fs.existsSync(dosya));
  assert.strictEqual(ozelBaslikYaz(dizin, '   '), '');
  assert.strictEqual(fs.existsSync(dosya), false);
  assert.strictEqual(ozelBaslikOku(dizin), '');
});

test('olmayan dizinde boş ad sessizce geçer (hata fırlatmaz)', (t) => {
  const dizin = path.join(geciciDizin(t), 'yok');
  assert.strictEqual(ozelBaslikYaz(dizin, ''), '');
  assert.strictEqual(ozelBaslikOku(dizin), '');
});
