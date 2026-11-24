/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
// Disk motoru: (mtimeMs, boyut) önbellekleri, çatal tekilleştirmesinde boyut ve değişmeyen dosyada sıfır okuma.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const gecmis = require('../gecmis');
const sohbet = require('../sohbet');

function geciciDizin() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'evren-cache-'));
}

// Sahte proje cwd'si temp dışında olmalı: tempMi() "\Temp\" segmentini eler, oturumlar listeden düşerdi.
function geciciProje() {
  return fs.mkdtempSync(path.join(os.homedir(), '.evren-cache-proje-'));
}

function ortam(kok, onbellek) {
  const eski = { kok: process.env.EVREN_PROJE_DIZINI, onbellek: process.env.EVREN_BASLIK_ONBELLEK };
  process.env.EVREN_PROJE_DIZINI = kok;
  process.env.EVREN_BASLIK_ONBELLEK = onbellek;
  return () => {
    if (eski.kok === undefined) delete process.env.EVREN_PROJE_DIZINI; else process.env.EVREN_PROJE_DIZINI = eski.kok;
    if (eski.onbellek === undefined) delete process.env.EVREN_BASLIK_ONBELLEK; else process.env.EVREN_BASLIK_ONBELLEK = eski.onbellek;
  };
}

test('tumOturumlariTara boyut taşır: küçük çatal büyük atayı gizleyemez', () => {
  const kok = geciciDizin();
  const proje = geciciProje();
  const slug = proje.replace(/[^a-zA-Z0-9]/g, '-');
  const pDir = path.join(kok, slug);
  fs.mkdirSync(pDir, { recursive: true });
  const ataId = '11111111-1111-1111-1111-111111111111';
  const ucId = '22222222-2222-2222-2222-222222222222';
  const kokUuid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const ataSatirlar = [
    JSON.stringify({ type: 'user', uuid: kokUuid, cwd: proje, message: { role: 'user', content: 'Fix performance bottleneck in history scanner' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'glm-5.3', content: [{ type: 'text', text: 'A'.repeat(2000) }], stop_reason: 'end_turn' } }),
  ].join('\n') + '\n';
  const ucSatirlar = [
    JSON.stringify({ type: 'user', uuid: kokUuid, cwd: proje, message: { role: 'user', content: 'Fix performance bottleneck in history scanner' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'glm-5.3', content: [{ type: 'text', text: 'short' }], stop_reason: 'end_turn' } }),
  ].join('\n') + '\n';
  const ataF = path.join(pDir, `${ataId}.jsonl`);
  const ucF = path.join(pDir, `${ucId}.jsonl`);
  fs.writeFileSync(ataF, ataSatirlar);
  const t1 = new Date(Date.now() - 10 * 60000);
  fs.utimesSync(ataF, t1, t1);
  fs.writeFileSync(ucF, ucSatirlar); // daha yeni ama ataF'ten KÜÇÜK
  const geriAl = ortam(kok, 'kapali');
  try {
    const liste = gecmis.tumOturumlariTara({ kayitDizini: path.join(kok, 'bos-evren') });
    const idler = liste.map((x) => x.id);
    assert.ok(idler.includes(ataId), 'büyük ata küçük çatal arkasında gizlenmemeli');
    assert.ok(idler.includes(ucId), 'küçük çatal da görünür kalır');
    const ata = liste.find((x) => x.id === ataId);
    assert.ok(ata.boyut > 2000, 'tumOturumlariTara boyut alanını doldurmalı');
  } finally {
    geriAl();
    fs.rmSync(kok, { recursive: true, force: true });
    fs.rmSync(proje, { recursive: true, force: true });
  }
});

test('BaglamIzleyici.oku dosya boyutu ve mtime değişmediyse diski okumaz', () => {
  const dir = geciciDizin();
  const f = path.join(dir, 'test.jsonl');
  fs.writeFileSync(f, JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', model: 'glm-5.3', usage: { input_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 0, output_tokens: 20 } },
  }) + '\n');
  const iz = new sohbet.BaglamIzleyici();
  const r1 = iz.oku(f);
  assert.equal(r1.token, 170);
  assert.equal(r1.yanit, 1);
  const origOpen = fs.openSync;
  let opens = 0;
  fs.openSync = (...args) => { opens++; return origOpen(...args); };
  try {
    const r2 = iz.oku(f);
    assert.equal(opens, 0, 'değişmeyen dosyada fs.openSync çağrılmamalı');
    assert.equal(r2.token, 170);
  } finally {
    fs.openSync = origOpen;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sohbet.girisleriCoz isVisibleInTranscriptOnly atlar, isCompactSummary/is_compact_summary işaretler', () => {
  const skip = sohbet.girisleriCoz({ type: 'user', isVisibleInTranscriptOnly: true, message: { role: 'user', content: 'hidden' } });
  assert.equal(skip.length, 0);
  const sum1 = sohbet.girisleriCoz({ type: 'user', isCompactSummary: true, message: { role: 'user', content: 'Summary text' } });
  assert.equal(sum1.length, 1);
  assert.equal(sum1[0].ozet, true);
  const sum2 = sohbet.girisleriCoz({ type: 'user', is_compact_summary: true, message: { role: 'user', content: 'Summary snake' } });
  assert.equal(sum2.length, 1);
  assert.equal(sum2[0].ozet, true);
});

test('değişmeyen dizinde ikinci tumOturumlariTara taraması sıfır fs.openSync yapar', () => {
  const kok = geciciDizin();
  const proje = geciciProje();
  const slug = proje.replace(/[^a-zA-Z0-9]/g, '-');
  const pDir = path.join(kok, slug);
  fs.mkdirSync(pDir, { recursive: true });
  const id = '33333333-3333-3333-3333-333333333333';
  const dosya = path.join(pDir, `${id}.jsonl`);
  fs.writeFileSync(dosya, [
    JSON.stringify({ type: 'user', uuid: 'dddd1111-2222-4333-8444-555566667777', cwd: proje, message: { role: 'user', content: 'Cache scan test oturumu' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', model: 'glm-5.3', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' } }),
  ].join('\n') + '\n');
  // Canlı tur denetimi (turDevamEdiyor) bilerek okur; "değişmeyen dosya" ölçümü için oturum susmuş olmalı.
  const eskiZaman = new Date(Date.now() - 10 * 60000);
  fs.utimesSync(dosya, eskiZaman, eskiZaman);
  const eskiOnbellek = process.env.EVREN_BASLIK_ONBELLEK;
  const eskiKok = process.env.EVREN_PROJE_DIZINI;
  process.env.EVREN_PROJE_DIZINI = kok;
  if (eskiOnbellek === undefined) delete process.env.EVREN_BASLIK_ONBELLEK; else process.env.EVREN_BASLIK_ONBELLEK = eskiOnbellek;
  const geriAl = () => {
    if (eskiKok === undefined) delete process.env.EVREN_PROJE_DIZINI; else process.env.EVREN_PROJE_DIZINI = eskiKok;
    if (eskiOnbellek === undefined) delete process.env.EVREN_BASLIK_ONBELLEK; else process.env.EVREN_BASLIK_ONBELLEK = eskiOnbellek;
  };
  try {
    assert.equal(gecmis.tumOturumlariTara({ kayitDizini: path.join(kok, 'bos-evren') }).length, 1);
    const origOpen = fs.openSync;
    let opens = 0;
    fs.openSync = (...args) => { opens++; return origOpen(...args); };
    try {
      const ikinci = gecmis.tumOturumlariTara({ kayitDizini: path.join(kok, 'bos-evren') });
      assert.equal(ikinci.length, 1);
      assert.equal(opens, 0, 'ikinci tarama değişmeyen .jsonl için disk açmamalı');
    } finally {
      fs.openSync = origOpen;
    }
  } finally {
    geriAl();
    fs.rmSync(kok, { recursive: true, force: true });
    fs.rmSync(proje, { recursive: true, force: true });
  }
});
