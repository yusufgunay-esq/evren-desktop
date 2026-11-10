/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Yusuf Günay. */
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
