// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّحْمَٰنِ الرَّحِيمِ
/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSrc = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('main.js: yerelDurum exposes Windows build number for xterm windowsPty ConPTY alignment', () => {
  assert.match(mainSrc, /windowsBuild:\s*process\.platform === 'win32'/);
});

test('app.js: xterm Terminal configures windowsPty conpty backend on win32', () => {
  assert.match(appSrc, /termSecenek\.windowsPty\s*=\s*\{\s*backend:\s*'conpty',\s*buildNumber:/);
});

test('app.js: terminal ResizeObserver respects gecisSuruyor transition guard and debounces resize bursts', () => {
  assert.match(appSrc, /new ResizeObserver\(\(\)\s*=>\s*\{\s*if\s*\(!gecisSuruyor\)\s*sigdir\(\);\s*\}\)\.observe\(\$\('terminaller'\)\)/);
  assert.match(appSrc, /o\.el\.clientWidth < 80 \|\| o\.el\.clientHeight < 40/);
  assert.match(appSrc, /clearTimeout\(sigdirDebounce\)/);
});

test('app.js: gorunumUygula attaches WebGL before running sigdir so cell geometry matches PTY', () => {
  const m = appSrc.match(/function gorunumUygula\([\s\S]*?\n\}/);
  assert.ok(m, 'gorunumUygula must exist');
  const body = m[0];
  const idxWebgl = body.indexOf('webglSenkronla()');
  const idxSigdir = body.indexOf('sigdir(true)');
  assert.ok(idxWebgl > 0 && idxSigdir > idxWebgl, 'webglSenkronla() must run before sigdir(true) in gorunumUygula');
});
