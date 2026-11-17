'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const kaynak = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const m = kaynak.match(/function bostaSessizlikMs\([\s\S]*?\r?\n\}\r?\n/);
const bostaSessizlikMs = new Function(m[0] + '; return bostaSessizlikMs;')();
const e = kaynak.match(/function bostaEsikMs\([\s\S]*?\r?\n\}\r?\n/);
const bostaEsikMs = new Function(e[0] + '; return bostaEsikMs;')();


test('bostaSessizlikMs: en yeni gercek etkinlikten olculur', () => {
  assert.strictEqual(bostaSessizlikMs({ sonGirdi: 100, baslangic: 50, jsonlMtime: 300, simdi: 1000 }), 700);
  assert.strictEqual(bostaSessizlikMs({ sonGirdi: 900, baslangic: 50, jsonlMtime: 300, simdi: 1000 }), 100);
  assert.strictEqual(bostaSessizlikMs({ baslangic: 400, simdi: 1000 }), 600);
  assert.strictEqual(bostaSessizlikMs({ simdi: 1000 }), 1000);
});

test('bostaSessizlikMs: pty ciktisi (sonCikti) sessizligi sifirlamaz', () => {
  assert.strictEqual(bostaSessizlikMs({ sonGirdi: 0, baslangic: 0, jsonlMtime: 100, sonCikti: 990, simdi: 1000 }), 900);
});

test('main.js: bostaKontrol sonCikti kullanmaz, jsonl mtime kullanir', () => {
  const blok = kaynak.slice(kaynak.indexOf('const bostaKontrol'), kaynak.indexOf('bostaKontrol.unref'));
  assert.ok(!blok.includes('sonCikti'.concat(' ||')), 'karar sonCikti okumamali');
  assert.ok(!/bilgi\.sonCikti/.test(blok));
  assert.ok(blok.includes('jsonlMtime'));
});

test('bostaEsikMs: normal modda 20 dk, ayardan degisir, 0 kapatir', () => {
  assert.deepStrictEqual(bostaEsikMs({ ayar: {}, bosMb: 8000 }), { sinir: 20 * 60000, baski: false });
  assert.strictEqual(bostaEsikMs({ ayar: { bostaKapatDk: 45 }, bosMb: 8000 }).sinir, 45 * 60000);
  assert.strictEqual(bostaEsikMs({ ayar: { bostaKapatDk: 0 }, bosMb: 100 }), null);
});

test('bostaEsikMs: bellek baskisinda 5 dk (esik ayarlanabilir, kapatma esigini asmaz)', () => {
  assert.deepStrictEqual(bostaEsikMs({ ayar: {}, bosMb: 3000 }), { sinir: 5 * 60000, baski: true });
  assert.strictEqual(bostaEsikMs({ ayar: {}, bosMb: 4096 }).baski, false);
  assert.strictEqual(bostaEsikMs({ ayar: { bostaBaskiMb: 8192 }, bosMb: 6000 }).baski, true);
  assert.strictEqual(bostaEsikMs({ ayar: { bostaKapatDk: 3 }, bosMb: 100 }).sinir, 3 * 60000);
});

test('app.js: bosta bayragi sekmeyi uyutur, yazinca ayni sekmede surer', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(/bilgi\.bosta && o\.devam/.test(app), 'oturumBitti bosta bayragina bakar');
  assert.ok(app.includes('Boşta uyutuldu · yazınca kaldığı yerden sürer'));
  assert.ok(/if \(o\.uyuyor\) \{ uyandir\(o, veri\)/.test(app), 'girdi uyandirir');
  assert.ok(/await basla\(devam, \{ dizin: o\.yol, modelId: o\.model/.test(app), 'ayni oturum --resume');
});
