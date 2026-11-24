'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const windowState = require('../window-state');
const tercih = require('../tercih');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'evren-store-')); }

test('window-state: clamps off-screen coordinates from disconnected monitor to primary display', () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }];
  const off = windowState.ekranIcinCoz({ x: 3200, y: 100, width: 1400, height: 900, isMaximized: true }, displays);
  assert.equal(off.x, undefined);
  assert.equal(off.y, undefined);
  assert.equal(off.width, 1400);
  assert.equal(off.isMaximized, true);
});

test('window-state: preserves valid multi-monitor bounds and clamps oversized width/height', () => {
  const displays = [
    { workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    { workArea: { x: 1920, y: 0, width: 1280, height: 720 } },
  ];
  const onSecond = windowState.ekranIcinCoz({ x: 2000, y: 40, width: 1500, height: 900, isMaximized: false }, displays);
  assert.equal(onSecond.x, 2000);
  assert.equal(onSecond.width, 1280);
  assert.equal(onSecond.height, 720);
});

test('window-state: round-trip read/write leaves no temp files and handles corrupt JSON', () => {
  const dir = tmp();
  const f = path.join(dir, 'window-state.json');
  try {
    assert.equal(windowState.yaz(f, { x: 120, y: 80, width: 1200, height: 760, isMaximized: false }), true);
    const r = windowState.oku(f);
    assert.equal(r.x, 120);
    assert.equal(r.width, 1200);
    assert.equal(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')).length, 0);
    fs.writeFileSync(f, '{broken json', 'utf8');
    const fb = windowState.oku(f);
    assert.equal(fb.width, windowState.VARSAYILAN_GENISLIK);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tercih.yaz + motor.atomikJsonYazSync: atomic write backs up corrupt JSON and cleans temp files', () => {
  const dir = tmp();
  const f = path.join(dir, 'tercih.json');
  const bakSayisi = () => fs.readdirSync(dir).filter((n) => n.includes('.corrupt-') && n.endsWith('.bak')).length;
  try {
    fs.writeFileSync(f, '{corrupt', 'utf8');
    const r = tercih.oku(f);
    assert.deepEqual(r.sabit, []);
    assert.equal(bakSayisi(), 1, 'corrupt read must create exactly one .corrupt-*.bak');
    tercih.oku(f);
    tercih.oku(f);
    assert.equal(bakSayisi(), 1, 'same corrupt version must not be backed up again');
    tercih.yaz(f, { sabit: ['a'], arsiv: [], proje: {}, kume: 'proje' });
    assert.deepEqual(tercih.oku(f).sabit, ['a']);
    assert.equal(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('motor.ayarOku: caches disk read when file is unchanged and invalidates on external change', () => {
  const dir = tmp();
  const prev = process.env.EVREN_VERI_DIZINI;
  process.env.EVREN_VERI_DIZINI = dir;
  delete require.cache[require.resolve('../motor')];
  const motor = require('../motor');
  try {
    motor.ayarYaz({ sonModel: 'glm-5.3' });
    // External change (different mtime/size) must drop the cache.
    fs.writeFileSync(path.join(dir, 'ayar.json'), JSON.stringify({ sonModel: 'qwen3.8-flash-next' }, null, 2), 'utf8');
    assert.equal(motor.ayarOku().sonModel, 'qwen3.8-flash-next');
    const origRead = fs.readFileSync;
    let reads = 0;
    fs.readFileSync = (...a) => { reads++; return origRead(...a); };
    try {
      assert.equal(motor.ayarOku().sonModel, 'qwen3.8-flash-next');
      assert.equal(reads, 0, 'cached ayarOku must not re-read unchanged file');
    } finally {
      fs.readFileSync = origRead;
    }
  } finally {
    if (prev === undefined) delete process.env.EVREN_VERI_DIZINI; else process.env.EVREN_VERI_DIZINI = prev;
    delete require.cache[require.resolve('../motor')];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('motor.ayarOku: corrupt ayar.json is backed up once, not on every call', () => {
  const dir = tmp();
  const prev = process.env.EVREN_VERI_DIZINI;
  process.env.EVREN_VERI_DIZINI = dir;
  delete require.cache[require.resolve('../motor')];
  const motor = require('../motor');
  try {
    motor.ayarYaz({ sonModel: 'glm-5.3' });
    fs.writeFileSync(path.join(dir, 'ayar.json'), '{bozuk', 'utf8');
    motor.ayarOku();
    motor.ayarOku();
    motor.ayarOku();
    const bak = fs.readdirSync(dir).filter((n) => n.includes('.corrupt-') && n.endsWith('.bak'));
    assert.equal(bak.length, 1, 'repeated reads of the same corrupt file must not pile up .bak files');
    assert.deepEqual(motor.ayarOku(), {});
  } finally {
    if (prev === undefined) delete process.env.EVREN_VERI_DIZINI; else process.env.EVREN_VERI_DIZINI = prev;
    delete require.cache[require.resolve('../motor')];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('motor.anahtarOku: evren.kasa alone (dpapi sources removed) serves no stale key', async (t) => {
  if (process.platform !== 'win32') return t.skip('win32-only path');
  const dir = tmp();
  try {
    const kasa = path.join(dir, 'evren.kasa');
    fs.writeFileSync(kasa, Buffer.from('bayat-anahtar', 'utf8').toString('base64'), 'utf8');
    const motor = require('../motor');
    motor.kasaKur({
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(s, 'utf8').toString('base64'),
      decryptString: (b) => Buffer.from(b).toString('utf8'),
    });
    const k = await motor.anahtarOku({ anahtarDosyalari: [path.join(dir, 'yok.dpapi')], kasaDosyasi: kasa });
    assert.equal(k, '', 'kasa without any dpapi source must not decrypt a stale key');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
