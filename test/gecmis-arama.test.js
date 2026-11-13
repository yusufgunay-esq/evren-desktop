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
const { icerikAra, aramaMetni } = require('../gecmis.js');

test('Türkçe küçültme tek karakterli kalır (dizin kaymaz)', () => {
  assert.strictEqual(aramaMetni('İSTANBUL Iğdır'), 'istanbul ığdır');
  assert.strictEqual(aramaMetni('İ').length, 'İ'.length);
});

test('sohbet içeriği büyük/küçük harf gözetmeden bulunur, örnek JSON kabuğundan arınır', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'evren-ara-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const dosya = path.join(d, 'x.jsonl');
  fs.writeFileSync(dosya, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'İSTANBUL gezisinde panel kodunu inceledik' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'panel tamam' }] } }),
  ].join('\n') + '\n');

  const a = icerikAra(dosya, 'istanbul');
  assert.ok(a, 'eşleşme bulunmalı');
  assert.strictEqual(a.sayi, 1);
  assert.match(a.ornek, /İSTANBUL gezisinde panel/);
  assert.ok(!a.ornek.includes('"content"'), 'JSON kabuğu örnekte kalmaz');

  assert.strictEqual(icerikAra(dosya, 'yokböylebirşey'), null);
  assert.strictEqual(icerikAra(dosya, 'i'), null, 'tek harf aranmaz');
  assert.strictEqual(icerikAra(path.join(d, 'yok.jsonl'), 'panel'), null);
});
