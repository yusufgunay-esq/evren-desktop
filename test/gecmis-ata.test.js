// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
// --resume çatallanması: aynı sohbet yeni kimliğe taşındığında eski kopya listede ikinci kart olmaz.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gecmis = require('../gecmis.js');

const uuid = (n) => n.repeat(8) + '-' + n.repeat(4) + '-4' + n.repeat(3) + '-a' + n.repeat(3) + '-' + n.repeat(12);
const ATA = uuid('1'), COPUC = uuid('2'), YABANCI = uuid('3'), IS = uuid('4');
const KOK = 'aaaa1111-2222-4333-8444-555566667777'; // ilk kullanıcı mesajının uuid'si (çatallamada taşınır)

function satir(o) { return JSON.stringify(o); }

// Ana kopya ve çatallı kopya: ilk kullanıcı mesajı uuid'si birebir aynı, kimlikler ayrı.
function sohbetSatirlari(ekMesajlar) {
  return [
    satir({ type: 'user', uuid: KOK, message: { role: 'user', content: 'panel kodunu düzelt' } }),
    satir({ type: 'assistant', message: { model: 'glm-5.3', content: [{ type: 'text', text: 'tamam' }], stop_reason: 'end_turn' } }),
    ...(ekMesajlar || []),
  ].join('\n') + '\n';
}

function geciciKok(t, ad) {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), ad));
  t.after(() => { fs.rmSync(kok, { recursive: true, force: true }); delete process.env.EVREN_PROJE_DIZINI; });
  process.env.EVREN_PROJE_DIZINI = kok;
  return kok;
}

test('baslikOku ilk kullanıcı mesajının uuid’sini (kokUuid) döner', (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'evren-kok-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const dosya = path.join(d, 'x.jsonl');
  fs.writeFileSync(dosya, sohbetSatirlari());
  const b = gecmis.baslikOku(dosya);
  assert.strictEqual(b.baslik, 'panel kodunu düzelt');
  assert.strictEqual(b.kokUuid, KOK);
});

test('resume çatallanması: ölü ana kopya gizlenir, işler ve alt ajanlar çatala devrolur', (t) => {
  const kok = geciciKok(t, 'evren-ata-');
  const dizin = 'D:\\Projelerim\\deneme-proje';
  const klasor = path.join(kok, dizin.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(path.join(klasor, ATA), { recursive: true });
  // Ana kopya: 30 dk önce susmuş; çatal ondan sonra doğdu ve hâlâ yazılıyor.
  fs.writeFileSync(path.join(klasor, ATA + '.jsonl'), sohbetSatirlari());
  // Ana kopyanın alt ajanı (oturum kimliği klasöründe yaşar): çatala devredilmeli.
  const ajan = { description: 'denetim ajanı', agentType: 'denetci', finished: true };
  const sub = path.join(klasor, ATA, 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-' + COPUC + '.meta.json'), JSON.stringify(ajan));
  fs.writeFileSync(path.join(sub, 'agent-' + COPUC + '.jsonl'), satir({ type: 'assistant', message: { model: 'glm-5.3', content: [{ type: 'text', text: 'bitti' }], stop_reason: 'end_turn' } }) + '\n');

  const eski = new Date(Date.now() - 30 * 60 * 1000);
  fs.utimesSync(path.join(klasor, ATA + '.jsonl'), eski, eski);

  const kayitDizini = fs.mkdtempSync(path.join(os.tmpdir(), 'evren-kayit-'));
  t.after(() => fs.rmSync(kayitDizini, { recursive: true, force: true }));
  fs.writeFileSync(path.join(kayitDizini, IS + '.json'), JSON.stringify({ id: IS, ust: ATA, dizin, baslik: 'İŞ 001 · test işi', baslangic: Date.now() - 60000 }));

  // Çatal: ana kopyanın doğumundan SONRA oluşur, ilk mesaj uuid’si aynı, son kayıt yanıt bekliyor (canlı).
  const carp = Date.now() + 50; while (Date.now() < carp) { /* doğum sırası ayrışsın */ }
  fs.writeFileSync(path.join(klasor, COPUC + '.jsonl'), sohbetSatirlari([
    satir({ type: 'user', uuid: 'bbbb1111-2222-4333-8444-555566667777', message: { role: 'user', content: 'devam et' } }),
  ]));
  // Yabancı oturum: başka ilk mesaj, karışmamalı.
  fs.writeFileSync(path.join(klasor, YABANCI + '.jsonl'), satir({ type: 'user', uuid: 'cccc1111-2222-4333-8444-555566667777', message: { role: 'user', content: 'bambaşka bir iş' } }) + '\n' +
    satir({ type: 'assistant', message: { model: 'glm-5.3', content: [{ type: 'text', text: 'evet' }], stop_reason: 'end_turn' } }) + '\n');

  const liste = gecmis.oturumGecmisi(dizin, { kayitDizini });
  const idler = liste.map((x) => x.id);
  assert.ok(!idler.includes(ATA), 'ölü ana kopya ikinci kart olmaz');
  const copuk = liste.find((x) => x.id === COPUC);
  assert.ok(copuk, 'çatal listelenir');
  assert.strictEqual(copuk.baslik, 'panel kodunu düzelt');
  assert.ok(copuk.canli, 'çatal canlı: tur yanıt bekliyor');
  assert.deepStrictEqual((copuk.evrenIsleri || []).map((i) => i.id), [IS], 'atanın EVREN işi çatala bağlanır');
  assert.deepStrictEqual((copuk.altAjanlar || []).map((a) => a.id), ['agent-' + COPUC], 'atanın alt ajanı çatala devrolur');
  assert.ok(idler.includes(YABANCI), 'ilgisiz oturum etkilenmez');

  // Uçtan kumanda sayıları: uç klasör boş kalır; atalar zinciri verilince ajan ve işler Again sayılır.
  const bosSayim = gecmis.oturumSayilari(dizin, COPUC, { kayitDizini });
  assert.strictEqual(bosSayim.altAjanlar.toplam, 0, 'uç klasöründe ajan yok');
  assert.strictEqual(bosSayim.evrenIsleri.toplam, 0, 'iş atanın üst kimliğine bağlı');
  const zincir = gecmis.oturumSayilari(dizin, COPUC, { kayitDizini, atalar: [ATA] });
  assert.strictEqual(zincir.altAjanlar.toplam, 1, 'ata klasöründeki ajan zincirle sayılır');
  assert.strictEqual(zincir.evrenIsleri.toplam, 1, 'atanın EVREN işi zincirle sayılır');
});

test('ataKopyalariniAyikla: canlı ana gizlenmez; uç, atadan küçükse ana da kalır', () => {
  const { ataKopyalariniAyikla } = gecmis;
  const yasli = (n) => ({ id: n, kokUuid: KOK, dogumMs: 1000, ms: 1000, boyut: 500, canli: false, altAjanlar: [] });
  const canliAna = { ...yasli('a'), canli: true };
  const copuk = { id: 'b', kokUuid: KOK, dogumMs: 2000, ms: 3000, boyut: 700, canli: true, altAjanlar: [] };
  let r = ataKopyalariniAyikla([canliAna, copuk]);
  assert.deepStrictEqual(r.kalan.map((x) => x.id).sort(), ['a', 'b'], 'yaşayan dal asla gizlenmez');
  assert.strictEqual(r.devir.size, 0);

  r = ataKopyalariniAyikla([yasli('a'), { ...copuk, boyut: 300 }]);
  assert.deepStrictEqual(r.kalan.map((x) => x.id).sort(), ['a', 'b'], 'uç atadan küçükse (eksik içerik) ana gizlenmez');

  r = ataKopyalariniAyikla([yasli('a'), { ...copuk, canli: false }]);
  assert.deepStrictEqual(r.kalan.map((x) => x.id), ['b'], 'ölü uç en az ata kadar büyükse ana gizlenir');
  assert.strictEqual(r.devir.get('a').id, 'b');
});
