'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('main.js: agacOldur is async (zero execFileSync taskkill blocking)', () => {
  assert.doesNotMatch(mainSrc, /execFileSync\s*\(\s*['"]taskkill['"]/);
  assert.match(mainSrc, /execFile\s*\(\s*['"]taskkill['"]/);
});

test('main.js: yama.cjs MCP_COCUK anchor line is preserved verbatim', () => {
  assert.ok(mainSrc.includes("const MCP_COCUK = new Set(['node', 'python', 'pythonw', 'cmd', 'conhost']);"));
});

test('main.js: idle sleep emits single pty:cikis with bosta:true and suppresses duplicate onExit', () => {
  assert.match(mainSrc, /kabukKapat\s*\(\s*id\s*,\s*\{\s*bosta:\s*true\s*\}\s*\)/);
  assert.match(mainSrc, /uyutulanlar\.add\(id\)/);
  assert.match(mainSrc, /if\s*\(\s*zatenKapandi\s*\|\|\s*uyutuldu\s*\)\s*return/);
});

test('main.js: onExit cleans child tree, PTY handle, and oturumBilgi map', () => {
  assert.match(mainSrc, /bu\.onExit\([\s\S]{0,800}agacOldur\(/);
  assert.match(mainSrc, /oturumBilgi\.delete\(id\)/);
});

test('main.js: before-quit stops remoteSunucu cleanly via idempotent temizKapat', () => {
  assert.match(mainSrc, /function temizKapat\(\)/);
  assert.match(mainSrc, /remoteSunucu\.durdur\(\)/);
});

test('agactaCalismaVar: leaf powershell is idle, active node (sef.mjs/evren-ajan.mjs) is busy, MCP node is idle', () => {
  const mLeaf = mainSrc.match(/const BOSTA_YAPRAK_KABUK[\s\S]*?function agactaCalismaVar[\s\S]*?\n\}/);
  assert.ok(mLeaf, 'BOSTA_YAPRAK_KABUK, AKTIF_NODE_DESEN and agactaCalismaVar must exist');
  const fn = new Function('MCP_COCUK', `${mLeaf[0]}; return agactaCalismaVar;`)(
    new Set(['node', 'python', 'pythonw', 'cmd', 'conhost'])
  );
  // Idle leaf powershell + idle MCP node under claude
  const ebeveynIdle = new Map([[100, [
    { id: 200, ad: 'powershell', komut: 'powershell.exe -NoProfile -NoExit' },
    { id: 201, ad: 'node', komut: 'node context-mode/cli.bundle.mjs' },
  ]]]);
  assert.equal(fn(ebeveynIdle, 100), false);
  // Şef waiting on sef.mjs / evren-ajan.mjs (node.exe!) MUST be busy!
  const ebeveynSef = new Map([[100, [
    { id: 202, ad: 'node', komut: 'node "D:\\Projelerim\\gunay-studio\\araclar\\sef.mjs" is --emir x.md' },
  ]]]);
  assert.equal(fn(ebeveynSef, 100), true);
  // Active powershell running git
  const ebeveynBusy = new Map([
    [100, [{ id: 200, ad: 'powershell', komut: 'powershell.exe' }]],
    [200, [{ id: 300, ad: 'git', komut: 'git status' }]],
  ]);
  assert.equal(fn(ebeveynBusy, 100), true);
  // Active bash directly under claude
  const ebeveynBash = new Map([[100, [{ id: 205, ad: 'bash', komut: 'bash -c npm test' }]]]);
  assert.equal(fn(ebeveynBash, 100), true);
  // evren-ajan.mjs worker
  const ebeveynWorker = new Map([[100, [{ id: 206, ad: 'node', komut: 'node evren-ajan.mjs --gorev x' }]]]);
  assert.equal(fn(ebeveynWorker, 100), true);
});

test('main.js: bostaKontrol protects Şef sessions and sessions with running evrenIsleri/altAjanlar', () => {
  assert.match(mainSrc, /gecmis\.oturumSayilari\s*\(/);
  assert.match(mainSrc, /bostaSefDk/);
  assert.match(mainSrc, /bilgi\.orkestrator/);
});
