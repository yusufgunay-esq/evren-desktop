/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Yusuf Günay. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sonDurumOku } = require('../gecmis');

function geciciDizin(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'evren-durum-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

// JSONL kaydı: her nesne tek satır, sonunda satır sonu (Claude Code oturum dosyası gibi).
function satirlarYaz(dizin, ad, satirlar) {
  const dosya = path.join(dizin, ad);
  fs.writeFileSync(dosya, satirlar.map((o) => JSON.stringify(o) + String.fromCharCode(10)).join(''));
  const s = fs.statSync(dosya);
  return { dosya, boyut: s.size, ms: s.mtimeMs };
}

const soruTuru = {
  type: 'assistant',
  message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion' }] },
};

test('cevap bekleyen soru "soru" durumunu verir', (t) => {
  const x = satirlarYaz(geciciDizin(t), 'soru.jsonl', [soruTuru]);
  assert.equal(sonDurumOku(x.dosya, x.boyut, 'a1', x.ms), 'soru');
});

test('soru araç sonucuyla kapanınca durum boşalır', (t) => {
  const x = satirlarYaz(geciciDizin(t), 'cevap.jsonl', [
    soruTuru,
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'q1' }] } },
  ]);
  assert.equal(sonDurumOku(x.dosya, x.boyut, 'a2', x.ms), '');
});

test('end_turn ile biten tur "bitti" durumunu verir', (t) => {
  const x = satirlarYaz(geciciDizin(t), 'bitti.jsonl', [
    { type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'tamam' }] } },
  ]);
  assert.equal(sonDurumOku(x.dosya, x.boyut, 'a3', x.ms), 'bitti');
});

test('soru olmayan araç çağrısı durum üretmez', (t) => {
  const x = satirlarYaz(geciciDizin(t), 'bash.jsonl', [
    { type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'b1', name: 'Bash' }] } },
  ]);
  assert.equal(sonDurumOku(x.dosya, x.boyut, 'a4', x.ms), '');
});

test('son satır kullanıcı metniyse durum boştur', (t) => {
  const x = satirlarYaz(geciciDizin(t), 'devam.jsonl', [
    soruTuru,
    { type: 'user', message: { content: 'devam' } },
  ]);
  assert.equal(sonDurumOku(x.dosya, x.boyut, 'a5', x.ms), '');
});
