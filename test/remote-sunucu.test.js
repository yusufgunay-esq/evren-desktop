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

test('oturum listesi şef (orkestratör) bayrağını telefona taşır', () => {
  const sunucu = new RemoteSunucu({
    veriDizini: geciciDizin(),
    port: 0,
    oturumListesiAl: () => [
      { id: 1, baslik: 'Şef · oturum #1', orkestrator: true },
      { id: 2, baslik: 'Normal · oturum #2' },
    ],
    oturumBilgisiAl: () => ({}),
    oturumSayilariAl: () => null,
  });

  const liste = sunucu.oturumListesiHazirla();
  assert.strictEqual(liste[0].orkestrator, true);
  assert.strictEqual(liste[1].orkestrator, false);
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

test('telefon soru aracının seçeneklerini sohbet paketinde alır', async () => {
  const kok = geciciDizin();
  const projeDizini = path.join(kok, 'projects', 'D--Projelerim-ornek');
  const kimlik = '11111111-2222-4333-8444-555555555555';
  fs.mkdirSync(projeDizini, { recursive: true });
  fs.writeFileSync(path.join(projeDizini, kimlik + '.jsonl'), [
    {
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: {
        content: [{
          type: 'tool_use',
          id: 'soru-1',
          name: 'AskUserQuestion',
          input: {
            questions: [{
              question: 'Hangi disk temizlensin?',
              header: 'Disk',
              multiSelect: false,
              options: [
                { label: 'C diski', description: '~18 GB açılır' },
                { label: 'D diski', description: '' },
              ],
            }],
          },
        }],
      },
    },
  ].map(JSON.stringify).join('\n') + '\n');

  const sunucu = new RemoteSunucu({
    veriDizini: geciciDizin(),
    port: 0,
    claudeKoku: path.join(kok, 'projects'),
    oturumListesiAl: () => [{ id: 1, baslik: 'örnek' }],
    oturumBilgisiAl: () => ({ dizin: 'D:\\Projelerim\\ornek', devam: kimlik, baslangic: Date.now() - 1000 }),
    oturumSayilariAl: () => null,
  });
  await sunucu.baslat();
  const { port, token } = sunucu.bilgi();

  const { ws, paket } = await ilkMesaj(`ws://127.0.0.1:${port}/?token=${token}`);
  const sohbetPaketi = new Promise((coz, red) => {
    const zaman = setTimeout(() => red(new Error('sohbet paketi gelmedi')), 4000);
    ws.on('message', (ham) => {
      const p = JSON.parse(ham.toString('utf8'));
      if (p.tip === 'sohbet') { clearTimeout(zaman); coz(p); }
    });
  });
  ws.send(JSON.stringify({ tip: 'sohbet_iste', id: 1 }));

  try {
    assert.strictEqual(paket.tip, 'baslangic');
    const sohbet = await sohbetPaketi;
    const giris = sohbet.girisler[0];
    assert.strictEqual(giris.arac.ad, 'AskUserQuestion');
    assert.strictEqual(giris.metin, 'Hangi disk temizlensin?');
    assert.strictEqual(giris.arac.sorular[0].secenekler[0].etiket, 'C diski');
    assert.strictEqual(giris.arac.sorular[0].secenekler[0].aciklama, '~18 GB açılır');
  } finally {
    ws.close();
    sunucu.durdur();
  }
});

// --resume çatallanması: oturum yeni jsonl'e taşınınca sohbet izleyicisi yeni dosyaya geçmeli.
// Eski dosyada kalırsa telefondan gönderilen mesajlar (yeni dosyaya yazılır) hiç görünmez.
test('sohbet izleyicisi çatallanmada yeni kayıt dosyasına geçer', async () => {
  const kok = geciciDizin();
  const dizin = 'D:\Projelerim\ornek';
  const klasor = path.join(kok, 'projects', dizin.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(klasor, { recursive: true });
  const ata = '11111111-1111-4111-8111-111111111111';
  const uc = '22222222-2222-4222-8222-222222222222';
  const satir = (rol, metin) => JSON.stringify(
    rol === 'user'
      ? { type: 'user', message: { role: 'user', content: metin } }
      : { type: 'assistant', message: { model: 'glm-5.3', content: [{ type: 'text', text: metin }], stop_reason: 'end_turn' } },
  );
  fs.writeFileSync(path.join(klasor, ata + '.jsonl'), [satir('user', 'eski sohbet'), satir('assistant', 'eski yanıt')].join('\n') + '\n');

  // Benimseme anını taklit et: sunucunun gördüğü kimlik çalışma sırasında değişir.
  const bilgi = { dizin, devam: ata, baslangic: Date.now() - 1000 };
  const sunucu = new RemoteSunucu({
    veriDizini: geciciDizin(),
    port: 0,
    claudeKoku: path.join(kok, 'projects'),
    oturumListesiAl: () => [{ id: 1, baslik: 'örnek' }],
    oturumBilgisiAl: () => bilgi,
    oturumSayilariAl: () => null,
  });
  await sunucu.baslat();
  const { port, token } = sunucu.bilgi();

  const paketler = [];
  const paketBekle = (kosul) => new Promise((coz, red) => {
    const zaman = setTimeout(() => red(new Error('beklenen sohbet paketi gelmedi')), 6000);
    const dinle = (ham) => {
      const p = JSON.parse(ham.toString('utf8'));
      if (p.tip !== 'sohbet') return;
      paketler.push(p);
      if (kosul(p)) { clearTimeout(zaman); ws.off('message', dinle); coz(p); }
    };
    ws.on('message', dinle);
  });

  const { ws } = await ilkMesaj(`ws://127.0.0.1:${port}/?token=${token}`);
  const ilkSohbet = paketBekle((p) => p.ilk === true);
  ws.send(JSON.stringify({ tip: 'sohbet_iste', id: 1 }));

  try {
    const ilk = await ilkSohbet;
    assert.strictEqual(ilk.girisler.at(-1).metin, 'eski yanıt');

    // Çatal: sohbetin kopyası + telefondan gönderilmiş yeni mesaj. Sunucu kimliği yeni dosyaya geçer.
    fs.writeFileSync(path.join(klasor, uc + '.jsonl'), [
      satir('user', 'eski sohbet'), satir('assistant', 'eski yanıt'),
      satir('user', 'yeni mesaj'), satir('assistant', 'yeni yanıt'),
    ].join('\n') + '\n');
    bilgi.devam = uc;

    const yeniden = await paketBekle((p) => p.ilk === true && p.girisler.some((g) => g.metin === 'yeni mesaj'));
    assert.ok(yeniden.girisler.some((g) => g.rol === 'kullanici' && g.metin === 'yeni mesaj'), 'yeni dosyadaki kullanıcı mesajı telefona ulaşır');
  } finally {
    ws.close();
    sunucu.durdur();
  }
});
