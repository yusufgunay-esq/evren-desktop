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
