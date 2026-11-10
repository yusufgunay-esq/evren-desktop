// Çıktı izleyici: oturum kaydından üretilen/değiştirilen dosyaları toplar,
// var olmayanları ve komutta yalnız okunan eski girdileri listeye almaz.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sohbet = require('../sohbet');

function geciciDizin() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'evren-cikti-'));
}

function jsonlYaz(dizin, kayitlar) {
  const dosya = path.join(dizin, 'oturum.jsonl');
  fs.writeFileSync(dosya, kayitlar.map((k) => JSON.stringify(k)).join('\n') + '\n', 'utf8');
  return dosya;
}

function araçKaydi(cwd, ms, araclar) {
  return {
    type: 'assistant', cwd, timestamp: new Date(ms).toISOString(), isSidechain: false, isMeta: false,
    message: { content: araclar.map((a) => ({ type: 'tool_use', name: a.ad, input: a.girdi })) },
  };
}

test('yazılan ve komutla üretilen dosyalar toplanır; girdi ve silinmiş dosya dışarıda kalır', () => {
  const dizin = geciciDizin();
  const yazilan = path.join(dizin, 'rapor.md');
  fs.writeFileSync(yazilan, 'içerik');
  const resim = path.join(dizin, 'ekran.png');
  fs.writeFileSync(resim, 'png');
  const eskiGirdi = path.join(dizin, 'sablon.png');
  fs.writeFileSync(eskiGirdi, 'eski');
  const eskiZaman = new Date(Date.now() - 10 * 60000);
  fs.utimesSync(eskiGirdi, eskiZaman, eskiZaman);
  const silinmis = path.join(dizin, 'yok.txt');
  const simdi = Date.now();

  const dosya = jsonlYaz(dizin, [
    araçKaydi(dizin, simdi, [
      { ad: 'Write', girdi: { file_path: yazilan } },
      { ad: 'Bash', girdi: { command: `electron . --ekran "${resim}" && cat ${eskiGirdi}` } },
      { ad: 'Write', girdi: { file_path: silinmis } },
    ]),
  ]);

  const liste = new sohbet.CiktiIzleyici().oku(dosya);
  const yollar = liste.map((c) => c.yol.toLowerCase());
  assert.ok(yollar.includes(yazilan.toLowerCase()), 'yazılan dosya listede olmalı');
  assert.ok(yollar.includes(resim.toLowerCase()), 'komutun ürettiği görsel listede olmalı');
  assert.ok(!yollar.includes(eskiGirdi.toLowerCase()), 'komutta yalnız okunan eski görsel çıktı sayılmamalı');
  assert.ok(!yollar.includes(silinmis.toLowerCase()), 'var olmayan dosya listelenmemeli');
  const kayit = liste.find((c) => c.yol.toLowerCase() === yazilan.toLowerCase());
  assert.strictEqual(kayit.islem, 'olusturuldu');
  assert.strictEqual(kayit.resim, false);
  assert.ok(liste.find((c) => c.yol.toLowerCase() === resim.toLowerCase()).resim, 'görsel bayrağı doğru');
});

test('artımlı okuma yeni dosyayı ekler, eskiyi mükerrer saymaz', () => {
  const dizin = geciciDizin();
  const ilk = path.join(dizin, 'bir.txt');
  const ikinci = path.join(dizin, 'iki.txt');
  fs.writeFileSync(ilk, '1');
  fs.writeFileSync(ikinci, '2');
  const simdi = Date.now();
  const dosya = jsonlYaz(dizin, [araçKaydi(dizin, simdi, [{ ad: 'Write', girdi: { file_path: ilk } }])]);
  const iz = new sohbet.CiktiIzleyici();
  assert.deepStrictEqual(iz.oku(dosya).map((c) => c.yol), [ilk]);
  fs.appendFileSync(dosya, JSON.stringify(araçKaydi(dizin, simdi + 1000, [{ ad: 'Write', girdi: { file_path: ikinci } }])) + '\n');
  const liste = iz.oku(dosya);
  assert.strictEqual(liste.length, 2, 'iki ayrı dosya bir kez listelenmeli');
  assert.deepStrictEqual(new Set(liste.map((c) => c.yol)), new Set([ilk, ikinci]));
});

test('komut yolları ve mutlak yol çözümü', () => {
  const adaylar = sohbet.komutYollari('node arac.mjs --ekran "C:\\x\\ekran.png" -o çıktı.pdf');
  assert.ok(adaylar.some((a) => a.endsWith('ekran.png')));
  assert.ok(adaylar.some((a) => a.endsWith('çıktı.pdf')));
  assert.strictEqual(sohbet.mutlakYol('https://x/y.png', 'C:\\p'), null);
  assert.ok(path.isAbsolute(sohbet.mutlakYol('alt/a.png', 'C:\\p')));
});
