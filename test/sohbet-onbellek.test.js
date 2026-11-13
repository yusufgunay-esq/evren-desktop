// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Yusuf Günay. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sonGirisler, sonGirislerOnbellekli } = require('../sohbet.js');

const KAYITLAR = [
  { type: 'user', message: { role: 'user', content: 'panel neden yavaş?' } },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'her turda yeniden çiziliyor' }] } },
];

function geciciDosya(t, satirlar) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'evren-sohbet-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const dosya = path.join(d, 'oturum.jsonl');
  fs.writeFileSync(dosya, satirlar.map((x) => JSON.stringify(x)).join('\n') + '\n');
  return dosya;
}

// Windows'ta gerçek EBUSY üretmek güvenilir değil; okuma hatası süreç içinde
// openSync kancasıyla taklit edilir (sohbet.js aynı fs modül nesnesini kullanır).
function kilitle(t, dosya) {
  const gercek = fs.openSync;
  let acildi = false;
  const ac = () => { if (!acildi) { acildi = true; fs.openSync = gercek; } };
  fs.openSync = (yol, ...kalan) => {
    if (path.resolve(String(yol)) === path.resolve(dosya)) {
      const e = new Error('EBUSY: resource busy or locked');
      e.code = 'EBUSY';
      throw e;
    }
    return gercek.call(fs, yol, ...kalan);
  };
  t.after(ac);
  return ac;
}

test('dosya ilk kez okununca taze sonuç döner', (t) => {
  const dosya = geciciDosya(t, KAYITLAR);
  const r = sonGirislerOnbellekli(dosya, 50);
  assert.equal(r.degisti, true);
  assert.equal(r.girisler.length, 2);
  assert.equal(r.girisler[0].metin, 'panel neden yavaş?');
  assert.equal(r.girisler[1].metin, 'her turda yeniden çiziliyor');
});

test('dosya değişmediyse ikinci okuma önbellekten gelir', (t) => {
  const dosya = geciciDosya(t, KAYITLAR);
  const ilk = sonGirislerOnbellekli(dosya, 50);
  const ikinci = sonGirislerOnbellekli(dosya, 50);
  assert.equal(ikinci.degisti, false);
  assert.deepEqual(ikinci.girisler, ilk.girisler);
});

test('yeni satır eklenip mtime değişince önbellek tazelenir', (t) => {
  const dosya = geciciDosya(t, KAYITLAR);
  sonGirislerOnbellekli(dosya, 50);
  fs.appendFileSync(dosya, JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'artık çizim atlanıyor' }] },
  }) + '\n');
  const yeni = new Date(Date.now() + 1000);
  fs.utimesSync(dosya, yeni, yeni); // damga kesin değişsin
  const r = sonGirislerOnbellekli(dosya, 50);
  assert.equal(r.degisti, true);
  assert.equal(r.girisler.length, 3);
  assert.equal(r.girisler[2].metin, 'artık çizim atlanıyor');
});

test('olmayan dosya boş ve değişti döner, fırlatmaz', () => {
  const dosya = path.join(os.tmpdir(), `evren-yok-${process.pid}.jsonl`);
  const r = sonGirislerOnbellekli(dosya, 50);
  assert.deepEqual(r, { girisler: [], degisti: true });
});

test('okuma hatası boş dosya sanılıp önbelleğe yazılmaz', (t) => {
  const dosya = geciciDosya(t, KAYITLAR);
  const ac = kilitle(t, dosya);

  const hatali = sonGirisler(dosya, 50);
  assert.equal(hatali.hata, true, 'sonGirisler hatayı boş dosyadan ayırır');
  assert.deepEqual(hatali.girisler, []);

  const kilitli = sonGirislerOnbellekli(dosya, 50);
  assert.deepEqual(kilitli, { girisler: [], degisti: true });

  ac(); // kilit kalkınca ilk tur dosyayı gerçekten okur
  const sonra = sonGirislerOnbellekli(dosya, 50);
  assert.equal(sonra.degisti, true);
  assert.equal(sonra.girisler.length, 2);
});

test('kilit sırasında son iyi okuma korunur, kilit kalkınca tazelenir', (t) => {
  const dosya = geciciDosya(t, KAYITLAR);
  const ilk = sonGirislerOnbellekli(dosya, 50);
  assert.equal(ilk.degisti, true);

  // Dosya kilitliyken değişmiş gibi görünsün: önbellek damgası tutmasın, okuma denenip hata versin.
  fs.appendFileSync(dosya, JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'kilit sırasında yazıldı' }] },
  }) + '\n');
  const yeni = new Date(Date.now() + 1000);
  fs.utimesSync(dosya, yeni, yeni);
  const ac = kilitle(t, dosya);

  const kilitli = sonGirislerOnbellekli(dosya, 50);
  assert.equal(kilitli.degisti, false, 'eski içerik korunur, boş listeyle ezilmez');
  assert.deepEqual(kilitli.girisler, ilk.girisler);

  ac();
  const sonra = sonGirislerOnbellekli(dosya, 50);
  assert.equal(sonra.degisti, true, 'hatalı tur önbellek damgasını ilerletmedi');
  assert.equal(sonra.girisler.length, 3);
  assert.equal(sonra.girisler[2].metin, 'kilit sırasında yazıldı');
});
