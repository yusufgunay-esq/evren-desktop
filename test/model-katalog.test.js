/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
// Sohbet kaydındaki model adını katalog kimliğine çevirme: kayıt vekilin döndürdüğü
// adı taşır (sağlayıcı öneki + donanım sürümü eki) ve alt çubuktaki model göstergesi
// bu kimlikle eşleşmezse eski modelde takılı kalıyordu.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { modelKatalogId, MODELLER } = require('../motor');

test('modelKatalogId: düz kimlik ve sağlayıcı önekli ad aynı modele çözülür', () => {
  assert.strictEqual(modelKatalogId('glm-5.3', MODELLER), 'glm-5.3');
  assert.strictEqual(modelKatalogId('zai/glm-5.3-fp8', MODELLER), 'glm-5.3', 'donanım sürümü eki atılır');
  assert.strictEqual(modelKatalogId('deepseek/deepseek-v4.1-flash', MODELLER), 'deepseek-v4.1-flash');
  assert.strictEqual(modelKatalogId('qwen/qwen3.8-flash-next', MODELLER), 'qwen3.8-flash-next');
  assert.strictEqual(modelKatalogId('GLM-5.3', MODELLER), 'glm-5.3', 'büyük/küçük harf duyarsız');
});

test('modelKatalogId: sentetik ve bilinmeyen ad çözülmez', () => {
  assert.strictEqual(modelKatalogId('<synthetic>', MODELLER), null);
  assert.strictEqual(modelKatalogId('', MODELLER), null);
  assert.strictEqual(modelKatalogId(null, MODELLER), null);
  assert.strictEqual(modelKatalogId('bilinmeyen-model', MODELLER), null);
  assert.strictEqual(modelKatalogId('glm-5.3', []), null, 'katalog yoksa null');
});
