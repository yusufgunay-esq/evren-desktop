/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
// Main/remote/goal bağlantısı: sahte "devam" bastırma, /api/durum await, sayaç önbelleği,
// kapanışta harita temizliği ve main.js yapısal sözleşmesi.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const oturumKarar = require('../oturum-karar');
const RemoteSunucu = require('../remote-sunucu');

test('oturum-karar: control characters and CSI sequences do not count as real text takeover', () => {
  assert.equal(oturumKarar.gercekMetinGirdisiMi('\x0c'), false);
  assert.equal(oturumKarar.gercekMetinGirdisiMi('\x03'), false);
  assert.equal(oturumKarar.gercekMetinGirdisiMi('\x1b[A'), false);
  assert.equal(oturumKarar.gercekMetinGirdisiMi('devam'), true);
  assert.equal(oturumKarar.gercekMetinGirdisiMi('a'), true);
});

test('oturum-karar: hedefBastirilmisMi suppresses auto-continue right after boot or resize', () => {
  const simdi = 100000;
  assert.equal(oturumKarar.hedefBastirilmisMi({ baslangic: simdi - 2000, sonBoyutMs: 0 }, simdi), true);
  assert.equal(oturumKarar.hedefBastirilmisMi({ baslangic: simdi - 10000, sonBoyutMs: simdi - 1000 }, simdi), true);
  assert.equal(oturumKarar.hedefBastirilmisMi({ baslangic: simdi - 10000, sonBoyutMs: simdi - 5000 }, simdi), false);
});

test('remote-sunucu: /api/durum awaits async uygulamaDurumuAl()', async () => {
  const srv = new RemoteSunucu({
    port: 0,
    uygulamaDurumuAl: async () => ({ surum: '0.5.0', anahtarVar: true }),
  });
  const info = await srv.baslat();
  try {
    const body = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${info.port}/api/durum?token=${info.token}`, (res) => {
        let s = '';
        res.on('data', (c) => { s += c; });
        res.on('end', () => resolve(JSON.parse(s)));
      }).on('error', reject);
    });
    assert.equal(body.ok, true);
    assert.equal(body.durum.surum, '0.5.0');
    assert.equal(body.durum.anahtarVar, true);
  } finally {
    srv.durdur();
  }
});

test('remote-sunucu: oturumListesiHazirla caches oturumSayilariAl within TTL and oturumKapandi cleans maps', () => {
  let cagrim = 0;
  const srv = new RemoteSunucu({
    oturumListesiAl: () => [{ id: 1, baslik: 'A' }],
    oturumBilgisiAl: () => ({ dizin: 'D:\\p', devam: '11111111-1111-1111-1111-111111111111' }),
    oturumSayilariAl: () => { cagrim++; return { altAjanlar: { calisan: 1, toplam: 2 }, evrenIsleri: { calisan: 0, toplam: 1 } }; },
  });
  srv.oturumListesiHazirla();
  srv.oturumListesiHazirla();
  assert.equal(cagrim, 1, 'second call within 2s TTL must hit cache');
  srv.ptyCiktiEkle(1, 'hello\n');
  assert.ok(srv.sonSatirlar.has(1));
  srv.oturumKapandi(1, 0);
  assert.equal(srv.sonSatirlar.has(1), false);
  assert.equal(srv.sonVeriZamani.has(1), false);
});

test('main.js: sandbox:true, no disable-http-cache, auto-continue opt-in, window-state wired', () => {
  const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.doesNotMatch(mainSrc, /disable-http-cache/);
  assert.match(mainSrc, /sandbox:\s*true/);
  assert.match(mainSrc, /otomatikDevam\s*===\s*true/);
  assert.match(mainSrc, /require\(['"]\.\/window-state['"]\)/);
  assert.match(mainSrc, /ipcMain\.handle\(['"]komut-yaz['"]/);
  assert.match(mainSrc, /ipcMain\.handle\(['"]sohbet-abone['"]/);
});
