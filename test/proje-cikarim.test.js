'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../proje-cikarim.js');

const PL = 'D:\\Projelerim\\';
const projeler = [
  { yol: PL + 'evren-desktop', ad: 'evren-desktop', yollar: [PL + 'evren-desktop'] },
  { yol: PL + 'oyun', ad: 'Oyun', yollar: [PL + 'oyun', PL + 'oyun-ek'] },
];
const kokler = P.calismaKokleri(projeler, 'C:\\Users\\u');

test('çalışma kökü bilinen projelerin üst klasörüdür; sürücü kökü ve ev klasörü sayılmaz', () => {
  assert.deepStrictEqual(kokler, ['D:\\Projelerim']);
  assert.deepStrictEqual(P.calismaKokleri([{ yol: 'D:\\x', ad: 'x' }, { yol: 'C:\\Users\\u\\p', ad: 'p' }], 'C:\\Users\\u'), []);
});

test('gerçek vaka: 7-zip oturumu yazdığı dosyalarla bochazip projesine bağlanır', () => {
  const d = ['src\\main.rs', 'Cargo.toml', 'README.md', 'src\\arsiv.rs'].map((x) => PL + 'bochazip\\' + x);
  d.push('C:\\Users\\u\\EVREN\\not.txt');
  assert.deepStrictEqual(P.cogunlukProje(d, projeler, kokler), { yol: PL + 'bochazip', ad: 'bochazip' }); // 4/5 = %80
});

test('bilinen proje (ek klasör dahil) ada göre döner, büyük/küçük harf fark etmez', () => {
  const d = ['d:\\projelerim\\OYUN\\a.js', PL + 'oyun-ek\\b.js', PL + 'oyun\\sub\\c.js'];
  assert.deepStrictEqual(P.cogunlukProje(d, projeler, kokler), { yol: PL + 'oyun', ad: 'Oyun' });
});

test('eşik altında bağ kurulmaz: %60 altı, 3 dosyadan az, dağınık projeler', () => {
  const b = (x) => PL + 'bochazip\\' + x;
  assert.strictEqual(P.cogunlukProje([b('a'), b('b'), b('c'), 'C:\\x\\1', 'C:\\x\\2', 'C:\\x\\3'], projeler, kokler), null, '3/6 = %50');
  assert.strictEqual(P.cogunlukProje([b('a'), b('b')], projeler, kokler), null, 'oran %100 ama 3 dosya şart');
  assert.strictEqual(P.cogunlukProje([b('a'), b('b'), PL + 'oyun\\1', PL + 'oyun\\2'], projeler, kokler), null, 'iki projeye bölünmüş');
  assert.ok(P.cogunlukProje([b('a'), b('b'), b('c'), 'C:\\x\\1', 'C:\\x\\2'], projeler, kokler), '3/5 = %60 sınırda geçer');
  assert.strictEqual(P.cogunlukProje([], projeler, kokler), null);
  assert.strictEqual(P.cogunlukProje(undefined, projeler, kokler), null);
});

test('kökün doğrudan altındaki dosya proje klasörü sayılmaz; aynı dosya iki kez sayılmaz', () => {
  assert.strictEqual(P.projeKlasoruBul(PL + 'notlar.txt', projeler, kokler), null);
  const b = PL + 'bochazip\\a.rs';
  assert.strictEqual(P.cogunlukProje([b, b, b, b], projeler, kokler), null, 'tekil dosya sayısı 1');
});
