// Uzaktan kumanda köprüsünün bağlantı sözleşmesi: kimlik, port, yetki ve ölü soket temizliği.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WebSocket } = require('ws');
const RemoteSunucu = require('../remote-sunucu');

function geciciDizin() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'evren-remote-'));
}

function bekle(ms) {
  return new Promise((coz) => setTimeout(coz, ms));
}

// İlk WebSocket mesajını (baslangic paketi) bekler.
function ilkMesaj(adres) {
  return new Promise((coz, red) => {
    const ws = new WebSocket(adres);
    const zaman = setTimeout(() => { try { ws.terminate(); } catch {} red(new Error('baslangic gelmedi')); }, 4000);
    ws.once('message', (ham) => {
      clearTimeout(zaman);
      coz({ ws, paket: JSON.parse(ham.toString('utf8')) });
    });
    ws.once('error', (e) => { clearTimeout(zaman); red(e); });
  });
}

test('baslangic paketi kalıcı kimlik ve gerçek port taşır', async () => {
  const sunucu = new RemoteSunucu({ veriDizini: geciciDizin(), port: 0 });
  await sunucu.baslat();
  const bilgi = sunucu.bilgi();
  assert.ok(bilgi.kimlik && bilgi.kimlik.length >= 16, 'kimlik üretilmeli');
  assert.ok(bilgi.port > 0, 'gerçek port bilinmeli');

  const { ws, paket } = await ilkMesaj(`ws://127.0.0.1:${bilgi.port}/?token=${bilgi.token}`);
  assert.strictEqual(paket.tip, 'baslangic');
  assert.strictEqual(paket.sunucuKimlik, bilgi.kimlik);
  assert.strictEqual(paket.port, bilgi.port);
  ws.close();
  sunucu.durdur();
});

test('kimlik yeniden başlatmada korunur, port kumanda.json içine yazılır', async () => {
  const dizin = geciciDizin();
  const bir = new RemoteSunucu({ veriDizini: dizin, port: 0 });
  await bir.baslat();
  const ilkKimlik = bir.bilgi().kimlik;
  const ilkPort = bir.bilgi().port;
  bir.durdur();
  await bekle(50);

  const iki = new RemoteSunucu({ veriDizini: dizin, port: 0 });
  await iki.baslat();
  assert.strictEqual(iki.bilgi().kimlik, ilkKimlik, 'kimlik sabit kalmalı');
  const kayit = JSON.parse(fs.readFileSync(path.join(dizin, 'kumanda.json'), 'utf8'));
  assert.strictEqual(kayit.kimlik, ilkKimlik);
  assert.ok(kayit.port === iki.bilgi().port || kayit.port === ilkPort);
  iki.durdur();
});

test('/api/durum belirteçsiz 401, doğru belirteçle 200 döner (telefon port araması bunu kullanır)', async () => {
  const sunucu = new RemoteSunucu({ veriDizini: geciciDizin(), port: 0 });
  await sunucu.baslat();
  const { port, token } = sunucu.bilgi();

  const yok = await fetch(`http://127.0.0.1:${port}/api/durum`);
  assert.strictEqual(yok.status, 401);

  const var_ = await fetch(`http://127.0.0.1:${port}/api/durum?token=${token}`);
  assert.strictEqual(var_.status, 200);
  const govde = await var_.json();
  assert.strictEqual(govde.ok, true);

  sunucu.durdur();
});

test('pong vermeyen ölü istemci kalp atışında düşürülür', async () => {
  const sunucu = new RemoteSunucu({ veriDizini: geciciDizin(), port: 0, kalpMs: 120 });
  await sunucu.baslat();
  const { port, token } = sunucu.bilgi();

  // autoPong kapalı: gerçek "yarı açık soket" davranışını taklit eder.
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`, { autoPong: false });
  await new Promise((coz, red) => {
    ws.once('open', coz);
    ws.once('error', red);
  });
  await bekle(60);
  assert.strictEqual(sunucu.istemciler.size, 1, 'önce bağlı görünmeli');
  await bekle(450);
  assert.strictEqual(sunucu.istemciler.size, 0, 'ölü soket temizlenmeli');

  try { ws.terminate(); } catch {}
  sunucu.durdur();
});
