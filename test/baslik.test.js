// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
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

test('etiket artığı başlık olmaz: </task-notification> sonrası gerçek mesaj gelir', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'evren-baslik-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const dosya = path.join(d, 'x.jsonl');
  fs.writeFileSync(dosya, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: '</task-notification>' } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: '<task-notification>kuyruk çıktısı</task-notification>' } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'kuyruk durum makinesini düzelt' } }),
  ].join('\n') + '\n');
  assert.strictEqual(baslikOku(dosya, true).baslik, 'kuyruk durum makinesini düzelt');
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
