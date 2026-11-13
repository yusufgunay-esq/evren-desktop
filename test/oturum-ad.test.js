/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Yusuf Günay. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ozelBaslikYaz, ozelBaslikOku, oturumGecmisi } = require('../gecmis');

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

test('başlık diske önbelleklenir (açılışta yeniden tarama maliyeti düşer)', async (t) => {
  const kok = geciciDizin(t);
  const kayit = geciciDizin(t);
  const onbellek = path.join(kok, 'baslik-onbellek.json');
  const proje = path.join(kok, 'proje');
  const klasor = path.join(kok, proje.replace(/[^a-zA-Z0-9]/g, '-'));
  const id = '99999999-8888-7777-6666-555555555555';
  fs.mkdirSync(klasor, { recursive: true });
  fs.writeFileSync(path.join(klasor, id + '.jsonl'), [
    JSON.stringify({ type: 'user', message: { content: 'diskte kalan başlık' } }),
    JSON.stringify({ type: 'assistant', message: { model: 'deepseek-v4.1-flash', content: [] } }),
  ].join('\n') + '\n');
  const eski = { kok: process.env.EVREN_PROJE_DIZINI, kayit: process.env.EVREN_KAYIT_DIZINI, onbellek: process.env.EVREN_BASLIK_ONBELLEK };
  process.env.EVREN_PROJE_DIZINI = kok;
  process.env.EVREN_KAYIT_DIZINI = kayit;
  process.env.EVREN_BASLIK_ONBELLEK = onbellek;
  t.after(() => {
    for (const [k, v] of [['EVREN_PROJE_DIZINI', eski.kok], ['EVREN_KAYIT_DIZINI', eski.kayit], ['EVREN_BASLIK_ONBELLEK', eski.onbellek]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });

  assert.strictEqual(oturumGecmisi(proje)[0].baslik, 'diskte kalan başlık');
  // Yazma 250 ms gecikmeli; yüklü makinede timer gecikebilir, dosyayı ~2 sn kovala.
  let j = null;
  for (const son = Date.now() + 2000; Date.now() < son && !j;) {
    await new Promise((r) => setTimeout(r, 40));
    try { j = JSON.parse(fs.readFileSync(onbellek, 'utf8')); } catch {}
  }
  assert.ok(j, 'önbellek dosyası 2 sn içinde yazılmadı');
  assert.strictEqual(j.kayitlar[id].baslik, 'diskte kalan başlık');
});

// Regresyon: başlık önbelleği, custom-title.json değişince düşmeli. Düşmezse üstteki sekme
// yeni adı gösterirken soldaki geçmiş listesi eski adda kalır (2026-11-12 bildirimi).
test('yeniden adlandırma geçmiş listesine hemen yansır', (t) => {
  const kok = geciciDizin(t);
  const kayit = geciciDizin(t);
  const proje = path.join(kok, 'proje');
  const klasor = path.join(kok, proje.replace(/[^a-zA-Z0-9]/g, '-'));
  const id = '11111111-2222-3333-4444-555555555555';
  fs.mkdirSync(klasor, { recursive: true });
  fs.writeFileSync(path.join(klasor, id + '.jsonl'), [
    JSON.stringify({ type: 'user', message: { content: 'ilk mesaj başlığı' } }),
    JSON.stringify({ type: 'assistant', message: { model: 'deepseek-v4.1-flash', content: [] } }),
  ].join('\n') + '\n');
  const eskiKok = process.env.EVREN_PROJE_DIZINI;
  const eskiKayit = process.env.EVREN_KAYIT_DIZINI;
  process.env.EVREN_PROJE_DIZINI = kok;
  process.env.EVREN_KAYIT_DIZINI = kayit;
  t.after(() => {
    if (eskiKok === undefined) delete process.env.EVREN_PROJE_DIZINI; else process.env.EVREN_PROJE_DIZINI = eskiKok;
    if (eskiKayit === undefined) delete process.env.EVREN_KAYIT_DIZINI; else process.env.EVREN_KAYIT_DIZINI = eskiKayit;
  });

  assert.strictEqual(oturumGecmisi(proje)[0].baslik, 'ilk mesaj başlığı');
  ozelBaslikYaz(path.join(klasor, id), 'Yeni ad');
  assert.strictEqual(oturumGecmisi(proje)[0].baslik, 'Yeni ad');
  ozelBaslikYaz(path.join(klasor, id), '');
  assert.strictEqual(oturumGecmisi(proje)[0].baslik, 'ilk mesaj başlığı');
});
