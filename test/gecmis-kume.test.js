'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('../gorunum.js');

const yerel = (y, a, g, sa = 12, dk = 0) => new Date(y, a - 1, g, sa, dk).getTime();

test('tarih kümeleri yerel gün sınırına göre: bugün / dün / bu hafta / daha eski', () => {
  const simdi = yerel(2026, 11, 13, 15);
  assert.strictEqual(G.tarihKumesi(yerel(2026, 11, 13, 0, 1), simdi), 'bugun');
  assert.strictEqual(G.tarihKumesi(yerel(2026, 11, 12, 23, 59), simdi), 'dun');
  assert.strictEqual(G.tarihKumesi(yerel(2026, 11, 12, 0, 0), simdi), 'dun');
  assert.strictEqual(G.tarihKumesi(yerel(2026, 11, 11, 23, 59), simdi), 'hafta');
  assert.strictEqual(G.tarihKumesi(yerel(2026, 11, 7, 0, 0), simdi), 'hafta');
  assert.strictEqual(G.tarihKumesi(yerel(2026, 11, 6, 23, 59), simdi), 'eski');
  assert.strictEqual(G.tarihKumesi(0, simdi), 'eski');
  assert.strictEqual(G.tarihKumesi(undefined, simdi), 'eski');
  assert.strictEqual(G.tarihKumesi(simdi + 3600000, simdi), 'bugun', 'gelecek damga bugündür');
});

test('tarih kümeleme sırayı korur ve boş kümeleri atar', () => {
  const simdi = yerel(2026, 11, 13, 15);
  const liste = [{ id: 'a', ms: yerel(2026, 11, 13, 9) }, { id: 'b', ms: yerel(2026, 11, 13, 8) }, { id: 'c', ms: yerel(2026, 10, 1) }];
  const k = G.tarihGrupla(liste, simdi);
  assert.deepStrictEqual(k.map((x) => x.ad), ['Bugün', 'Daha eski']);
  assert.deepStrictEqual(k[0].ogeler.map((x) => x.id), ['a', 'b']);
  assert.deepStrictEqual(G.tarihGrupla([], simdi), []);
});

test('proje kümeleme: en yeni oturumu olan proje önde, içi en yeni üstte', () => {
  const liste = [{ id: '1', ms: 10, p: 'A' }, { id: '2', ms: 50, p: 'B' }, { id: '3', ms: 30, p: 'A' }, { id: '4', ms: 5, p: 'B' }];
  const k = G.projeGrupla(liste, (g) => ({ yol: 'D:\\x\\' + g.p, ad: g.p }));
  assert.deepStrictEqual(k.map((x) => x.ad), ['B', 'A']);
  assert.deepStrictEqual(k[0].ogeler.map((x) => x.id), ['2', '4']);
  assert.deepStrictEqual(k[1].ogeler.map((x) => x.id), ['3', '1']);
});

test('arşiv süzgeci: varsayılan liste arşivsiz; etkin oturum arşivde olsa da kalır', () => {
  const liste = [{ id: 'a' }, { id: 'b' }, { id: 'c', canli: true }];
  const r = G.arsivAyir(liste, ['b', 'c'], (g) => g.canli);
  assert.deepStrictEqual(r.normal.map((g) => g.id), ['a', 'c']);
  assert.deepStrictEqual(r.arsivli.map((g) => g.id), ['b']);
  const bos = G.arsivAyir(liste, undefined);
  assert.strictEqual(bos.normal.length, 3);
  assert.strictEqual(bos.arsivli.length, 0);
  assert.strictEqual(G.arsivAyir(liste, new Set(['a'])).arsivli.length, 1);
});

test('etkin proje: elle seçim > çıkarım > kendi klasörü', () => {
  const g = { id: 'x', projeYol: 'C:\\Users\\u\\EVREN', projeAd: 'EVREN' };
  assert.deepStrictEqual(G.etkinProje(g, {}, {}), { yol: 'C:\\Users\\u\\EVREN', ad: 'EVREN', kaynak: 'kendi' });
  const c = { x: { yol: 'D:\\Projelerim\\bochazip', ad: 'bochazip' } };
  assert.strictEqual(G.etkinProje(g, {}, c).kaynak, 'cikarim');
  const baska = 'D:\\Projelerim\\baska';
  assert.deepStrictEqual(G.etkinProje(g, { x: baska }, c, (y) => (y === baska ? 'Başka' : '')), { yol: baska, ad: 'Başka', kaynak: 'elle' });
  assert.strictEqual(G.etkinProje(g, { x: baska }, c).ad, 'baska', 'ad bulunamazsa klasör adı');
});
