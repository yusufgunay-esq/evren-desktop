/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EFORLAR, EFOR_VARSAYILAN, eforCoz } = require('../motor');

test('efor seviyeleri Claude Code --effort ile aynı beş değerdir', () => {
  assert.deepStrictEqual(EFORLAR.map((e) => e.id), ['low', 'medium', 'high', 'xhigh', 'max']);
  for (const e of EFORLAR) {
    assert.ok(e.ad && e.not, `${e.id} ad ve not taşımalı`);
  }
});

test('eforCoz geçerli seviyeyi olduğu gibi döndürür', () => {
  for (const e of EFORLAR) assert.strictEqual(eforCoz(e.id), e.id);
});

test('eforCoz bilinmeyen, boş ve tanımsız değerde varsayılana düşer', () => {
  assert.strictEqual(EFOR_VARSAYILAN, 'medium');
  for (const x of [undefined, null, '', 'turbo', 'LOW', 5, {}]) assert.strictEqual(eforCoz(x), 'medium');
});
