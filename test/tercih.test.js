'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const T = require('../tercih.js');

const gecici = (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'evren-tercih-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const BOCHA = 'D:\\Projelerim\\bochazip';

test('tercih yaz/oku gidiş dönüş; geçici dosya kalmaz', (t) => {
  const d = gecici(t);
  const f = path.join(d, T.DOSYA_ADI);
  T.yaz(f, { sabit: ['a', 'b', 'a'], arsiv: ['c'], proje: { x: BOCHA }, kume: 'proje', gorulen: {}, gorulenTaban: 0, acilan: [] });
  assert.deepStrictEqual(T.oku(f), { sabit: ['a', 'b'], arsiv: ['c'], proje: { x: BOCHA }, kume: 'proje', gorulen: {}, gorulenTaban: 0, acilan: [] });
  assert.deepStrictEqual(fs.readdirSync(d), [T.DOSYA_ADI]);
  T.yaz(f, { sabit: [], arsiv: [], proje: {}, kume: 'tarih', gorulen: {}, gorulenTaban: 0, acilan: [] });
  assert.deepStrictEqual(T.oku(f), T.varsayilan());
});

test('eksik, bozuk ya da yanlış şekilli dosyada güvenli varsayılan', (t) => {
  const d = gecici(t);
  const f = path.join(d, T.DOSYA_ADI);
  assert.deepStrictEqual(T.oku(f), T.varsayilan(), 'dosya yok');
  fs.writeFileSync(f, '{bozuk json');
  assert.deepStrictEqual(T.oku(f), T.varsayilan());
  fs.writeFileSync(f, '[1,2,3]');
  assert.deepStrictEqual(T.oku(f), T.varsayilan());
  fs.writeFileSync(f, JSON.stringify({ sabit: 'x', arsiv: [1, null, 'ok', ''], proje: { a: 5, b: 'D:\\p', c: '  ' }, kume: 'saçma' }));
  assert.deepStrictEqual(T.oku(f), { sabit: [], arsiv: ['ok'], proje: { b: 'D:\\p' }, kume: 'tarih', gorulen: {}, gorulenTaban: 0, acilan: [] });
});

test('yazma hedef klasörü oluşturur; yazılamıyorsa fırlatır ve geçici dosya bırakmaz', (t) => {
  const d = gecici(t);
  const f = path.join(d, 'alt', T.DOSYA_ADI);
  T.yaz(f, { sabit: ['z'] });
  assert.deepStrictEqual(T.oku(f).sabit, ['z']);
  fs.writeFileSync(path.join(d, 'dosya'), 'x');
  assert.throws(() => T.yaz(path.join(d, 'dosya', T.DOSYA_ADI), {}));
});

test('okunmamış işareti alanları: görülme zamanı, taban ve son açılanlar temizlenir, gidiş dönüş korunur', (t) => {
  const d = gecici(t);
  const f = path.join(d, T.DOSYA_ADI);
  T.yaz(f, { gorulen: { a: 1700000000000, b: 'x', c: -5, '': 9 }, gorulenTaban: 1700000000001, acilan: ['p', 'q', 'p', 3, ''] });
  const o = T.oku(f);
  assert.deepStrictEqual(o.gorulen, { a: 1700000000000 });
  assert.strictEqual(o.gorulenTaban, 1700000000001);
  assert.deepStrictEqual(o.acilan, ['p', 'q']);
  assert.strictEqual(T.temizle({ gorulenTaban: 'bozuk', acilan: 'x', gorulen: [1] }).gorulenTaban, 0);
  assert.strictEqual(T.temizle({ acilan: Array.from({ length: 50 }, (_, i) => 'k' + i) }).acilan.length, 20);
});
