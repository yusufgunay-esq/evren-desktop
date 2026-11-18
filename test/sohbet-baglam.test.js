/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
// Bağlam izleyici: son yanıtın token kullanımı, model kimliği ve artımlı tur sayacı.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sohbet = require('../sohbet');

const kullanici = (metin) => ({ type: 'user', message: { role: 'user', content: metin } });
const asistan = (token, model = 'deepseek/deepseek-v4.1-flash') => ({
  type: 'assistant',
  message: {
    model,
    usage: {
      input_tokens: token.input || 0,
      cache_creation_input_tokens: token.creation || 0,
      cache_read_input_tokens: token.okuma || 0,
      output_tokens: token.cikti || 0,
    },
  },
});

test('son yanıtın token toplamını, modelini ve tur sayacını verir', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'evren-baglam-'));
  const f = path.join(d, 'x.jsonl');
  fs.writeFileSync(f, [
    kullanici('merhaba'),
    asistan({ input: 10, creation: 100, okuma: 1000, cikti: 50 }),
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } },
    asistan({ input: 20, creation: 200, okuma: 2000, cikti: 70 }),
  ].map(JSON.stringify).join('\n') + '\n');

  const iz = new sohbet.BaglamIzleyici();
  const sonuc = iz.oku(f);
  assert.strictEqual(sonuc.token, 2290);
  assert.strictEqual(sonuc.cikti, 70);
  assert.strictEqual(sonuc.model, 'deepseek/deepseek-v4.1-flash');
  assert.strictEqual(sonuc.yanit, 2, 'yalnızca usage taşıyan asistan kayıtları sayılır');
});

test('sentetik tur gerçek modeli ve kullanımı gölgelemez, sayaca eklenmez', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'evren-baglam-'));
  const f = path.join(d, 'x.jsonl');
  // CLI kesilen tur için modeli "<synthetic>" olan sıfır kullanımlı kayıt yazar.
  const sentetik = {
    type: 'assistant',
    message: { model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  };
  fs.writeFileSync(f, [
    asistan({ input: 20, okuma: 2000, cikti: 70 }, 'zai/glm-5.3-fp8'),
    sentetik,
  ].map(JSON.stringify).join('\n') + '\n');

  const iz = new sohbet.BaglamIzleyici();
  const sonuc = iz.oku(f);
  assert.strictEqual(sonuc.model, 'zai/glm-5.3-fp8', 'gerçek turun modeli görünür');
  assert.strictEqual(sonuc.token, 2090, 'sentetik sıfır kullanım bağlamı sıfırlamaz');
  assert.strictEqual(sonuc.yanit, 1, 'sentetik tur sohbet sayacına eklenmez');
});

test('artımlı okur: eklenen kayıt yeniden taranmadan sayaca eklenir', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'evren-baglam-'));
  const f = path.join(d, 'x.jsonl');
  fs.writeFileSync(f, JSON.stringify(asistan({ input: 1, okuma: 100, cikti: 5 })) + '\n');
  const iz = new sohbet.BaglamIzleyici();
  assert.strictEqual(iz.oku(f).yanit, 1);

  fs.appendFileSync(f, JSON.stringify(asistan({ input: 2, okuma: 300, cikti: 7 })) + '\n');
  const sonuc = iz.oku(f);
  assert.strictEqual(sonuc.yanit, 2);
  assert.strictEqual(sonuc.token, 309);

  // Dosya kısalır/baştan yazılırsa sayaç sıfırlanır.
  fs.writeFileSync(f, JSON.stringify(asistan({ input: 1, okuma: 10, cikti: 1 })) + '\n');
  const sifir = iz.oku(f);
  assert.strictEqual(sifir.yanit, 1);
  assert.strictEqual(sifir.token, 12);
});

test('kayıt yoksa boş sonuç döner', () => {
  const iz = new sohbet.BaglamIzleyici();
  assert.strictEqual(iz.oku(path.join(os.tmpdir(), 'evren-baglam-yok-' + Date.now() + '.jsonl')), null);
});
