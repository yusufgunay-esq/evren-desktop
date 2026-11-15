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

test('içerik araması yalnız okunur metinde: thinking, signature, tool_use, base64 ve uzun dizgiler dışarıda', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'evren-ara-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const dosya = path.join(d, 'y.jsonl');
  const b64 = 'AAAA5C7SzH70zipsrnl27DPQAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  fs.writeFileSync(dosya, [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'zip düşünce', signature: b64 }, { type: 'tool_use', input: { cmd: 'zip -r a.zip' } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'zip çıktı' }, { type: 'image', source: { data: b64 } }] } }),
    JSON.stringify({ type: 'user', message: { content: 'ŞİFRE ' + b64 + ' hazır' } }),
  ].join('\n') + '\n');
  assert.strictEqual(icerikAra(dosya, 'zip'), null, 'thinking/tool/base64 eşleşmesi gelmemeli');
  const a = icerikAra(dosya, 'sifre');
  assert.ok(a && a.sayi === 1 && !a.ornek.includes('AAAA'), 'Türkçe katlama çalışır, uzun dizgi örnekte yok');
});

test('ad/proje eşleşmesi ve yazım hatası toleransı', () => {
  const { adEslesir, birFark } = require('../gecmis.js');
  assert.ok(adEslesir(['Bochazip ana ekran'], 'bochazip'));
  assert.ok(adEslesir(['x', 'bochazip'], 'bohcazip'), 'bitişik harf yer değişimi');
  assert.ok(adEslesir(['D:/Projelerim/BOCHAZİP'], 'bohcazip'), 'yol + büyük İ');
  assert.ok(!adEslesir(['bochazip'], 'boh'), 'kısa sorguda tolerans yok');
  assert.ok(!adEslesir(['battlefield'], 'bohcazip'));
  assert.ok(birFark('abcde', 'abde') && birFark('abcde', 'abxde') && !birFark('abcde', 'axxde'));
});

test('icerikAraListe: ana ad eşleşmezse eşleşen alt iş adı alt olarak döner, ana ad eşleşirse alt yok', () => {
  const { icerikAraListe } = require('../gecmis.js');
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  const turler = [
    { id: A, baslik: 'Genel oturum', projeAd: 'EVREN', projeYol: '', ekler: ['İŞ 12 · kapı düzeltmesi', 'diğer iş'] },
    { id: B, baslik: 'Kapı çalışması', projeAd: 'EVREN', projeYol: '', ekler: ['kapı alt işi'] },
  ];
  const s = icerikAraListe(turler, 'kapı');
  assert.strictEqual(s[A].alt, 'İŞ 12 · kapı düzeltmesi');
  assert.strictEqual(s[A].ad, true);
  assert.strictEqual(s[B].ad, true);
  assert.strictEqual(s[B].alt, undefined, 'ana ad eşleşirse alt iş gösterilmez');
});
