/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
// Oturum ortamındaki güvenli auto-compact penceresi: API "istem + çıktı tavanı ≤ bağlam
// penceresi" şartını arar; pencere çıktı tavanı + pay kadar erken tetiklenir.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { autocompactPenceresi, MODELLER } = require('../motor');

test('autocompactPenceresi: çıktı tavanı + pay düşülür, küçük/ geçersiz pencerede null', () => {
  assert.strictEqual(autocompactPenceresi(262144, null), 180224);   // qwen 256K
  assert.strictEqual(autocompactPenceresi(524288, 65536), 442368);  // glm 512K
  assert.strictEqual(autocompactPenceresi(1048576, 65536), 966656); // deepseek 1M
  assert.strictEqual(autocompactPenceresi(524288, 0), 442368, 'çıktı tavanı yoksa 65536 sayılır');
  // Claude Code değeri 100K altına kenetler (99 999 → 100k): güvenli pencere 100K altındaysa yazılmaz.
  assert.strictEqual(autocompactPenceresi(165000, 65536), null, 'güvenli pencere 83K: kenetlenmesin diye null');
  assert.strictEqual(autocompactPenceresi(60000), null, 'pencere zaten küçük');
  assert.strictEqual(autocompactPenceresi(0), null);
  assert.strictEqual(autocompactPenceresi('yok'), null);
});

test('yedek model listesindeki her pencere güvenli auto-compact üretir', () => {
  for (const m of MODELLER) {
    const p = autocompactPenceresi(m.baglamSayisi, m.cikti);
    assert.ok(p >= 100000, `${m.id}: pencere üretilmeli (${p})`);
    assert.ok(p < m.baglamSayisi, `${m.id}: pencere bağlamdan küçük olmalı`);
  }
});

test('sikistirmaEsigi: ayardaki model eşiği güvenli pencereyi aşmıyorsa kazanır, env verilmez', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { sikistirmaEsigi, sikistirmaEnvDegeri, kullaniciEsigi } = require('../motor');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esik-'));
  const yol = path.join(dir, 'settings.json');
  try {
    fs.writeFileSync(yol, JSON.stringify({ modelSettings: {
      'deepseek-v4.1-flash': { autoCompactWindow: 600000 },
      'glm-5.3': { autoCompactWindow: 800000 },   // bayat: güvenli pencereden büyük
      'qwen': { autoCompactWindow: 5000 },         // geçersiz: 100K altı
    } }));
    // Ayar geçerli: eşik ayardan, env yok (Claude Code ayarı okur, /model değişince de doğru kalır).
    assert.strictEqual(sikistirmaEsigi('deepseek-v4.1-flash', 1048576, 65536, yol), 600000);
    assert.strictEqual(sikistirmaEnvDegeri('deepseek-v4.1-flash', 1048576, 65536, yol), null);
    // Ayar güvenli pencereden büyük: güvenli pencere hem eşik hem env (taşmayı önler).
    assert.strictEqual(sikistirmaEsigi('glm-5.3', 524288, 65536, yol), 442368);
    assert.strictEqual(sikistirmaEnvDegeri('glm-5.3', 524288, 65536, yol), 442368);
    // Ayar yok ya da geçersiz: eski davranış.
    assert.strictEqual(kullaniciEsigi('qwen', yol), null);
    assert.strictEqual(sikistirmaEnvDegeri('yok', 262144, null, yol), 180224);
    assert.strictEqual(sikistirmaEnvDegeri('yok', 262144, null, path.join(dir, 'olmayan.json')), 180224);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
