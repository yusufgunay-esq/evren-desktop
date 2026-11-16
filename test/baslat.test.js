// Ortak başlatıcı sözleşmesi: iki kabuk da aynı basla.js'i çağırır, mantık tek yerde.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const KOK = path.join(__dirname, '..');
const oku = (f) => fs.readFileSync(path.join(KOK, f), 'utf8');

test('EVREN.bat: mantık taşımaz, basla.js çağırır', () => {
  const b = oku('EVREN.bat');
  assert.ok(b.includes('basla.js'), 'Windows kabuğu ortak başlatıcıyı çağırmalı');
  assert.ok(!b.includes('electron.exe'), 'electron yolu kabukta tekrarlanmamalı');
  assert.ok(!b.includes('npm install'), 'kurulum mantığı basla.js içinde olmalı');
  assert.ok(b.includes('where node'), 'Node.js varlığı erken kontrol edilmeli');
});

test('EVREN.command: mantık taşımaz, basla.js çağırır ve LF ile durur', () => {
  const c = oku('EVREN.command');
  assert.ok(c.startsWith('#!/bin/zsh'), 'shebang zsh olmalı');
  assert.ok(c.includes('basla.js'), 'macOS kabuğu ortak başlatıcıyı çağırmalı');
  assert.ok(!c.includes('npm install'), 'kurulum mantığı basla.js içinde olmalı');
  assert.ok(!c.includes(String.fromCharCode(13)), 'CRLF shebang bozar; dosya LF ile durmalı');
});

test('basla.js: iki kip (hazırla/kontrol) ve tek npm install yolu', () => {
  const s = oku('basla.js');
  for (const parca of ['--hazirla', '--kontrol', 'npm install', 'electronYolu']) {
    assert.ok(s.includes(parca), 'basla.js ' + parca + ' içermeli');
  }
  const kontrol = spawnSync(process.execPath, [path.join(KOK, 'basla.js'), '--kontrol'], { encoding: 'utf8' });
  const j = JSON.parse(String(kontrol.stdout).trim());
  assert.strictEqual(j.platform, process.platform, 'platform bildirilmeli');
  assert.strictEqual(kontrol.status, j.electron ? 0 : 1, 'çıkış kodu yolla tutarlı');
  if (j.electron) assert.ok(fs.existsSync(j.electron), 'bildirilen electron yolu diskte olmalı');
});
