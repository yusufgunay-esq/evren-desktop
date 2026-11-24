/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { kimlikIstemi } = require('../motor');

test('kimlik istemi modeli ve eforu adıyla verir, Mimar olmadığını söyler', () => {
  const s = kimlikIstemi('deepseek-v4.1-flash', 'high');
  assert.match(s, /deepseek-v4\.1-flash, efor high/);
  assert.match(s, /EVREN worker/);
  assert.match(s, /Mimar değilsin/);
  assert.match(s, /EVREN kotasıdır/);
});

test('Şef sekmesi Şef rolüyle tanıtılır', () => {
  assert.match(kimlikIstemi('glm-5.3', 'xhigh', true), /EVREN Şef/);
});

test('boş model ve efor çökertmez', () => {
  assert.match(kimlikIstemi('', ''), /bilinmeyen model, efor bilinmiyor/);
});
