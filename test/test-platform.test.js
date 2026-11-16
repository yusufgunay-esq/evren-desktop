/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
// Çapraz platform desteği: PTY komut planı, ps süreç haritası, ConPTY kararı, kasa
// arka ucu (sahte safeStorage) ve arayüz metinlerinin platforma göre yazılması.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { posixTekTirnak, spawnPlanla, spawnYedek, conptyKullan, psCiktiAyristir } = require('../platform');
const { kasaSifrele, kasaCoz } = require('../motor');

const KOK = path.join(__dirname, '..');

// ---- spawnPlanla: üç platform ----
test('spawnPlanla: win32 claude.exe, arglar birebir korunur', () => {
  const arg = ['--dangerously-skip-permissions', '--effort', 'high', '--resume', 'abc-123', '--add-dir', 'D:\\x y'];
  assert.deepStrictEqual(spawnPlanla('win32', arg), { dosya: 'claude.exe', arglar: arg });
});

test('spawnPlanla: darwin ve linux claude çağırır', () => {
  const arg = ['--effort', 'medium'];
  for (const p of ['darwin', 'linux']) {
    assert.deepStrictEqual(spawnPlanla(p, arg), { dosya: 'claude', arglar: arg });
  }
  assert.deepStrictEqual(spawnPlanla('darwin', 'arg-degil'), { dosya: 'claude', arglar: [] }, 'dizi olmayan arg boş');
});

test('spawnYedek: win32 ComSpec (yoksa cmd.exe) ile /d /s /c claude sarmalar', () => {
  const arg = ['--effort', 'high'];
  assert.deepStrictEqual(spawnYedek('win32', { ComSpec: 'C:\\shell.exe' }, arg),
    { dosya: 'C:\\shell.exe', arglar: ['/d', '/s', '/c', 'claude', ...arg] });
  assert.deepStrictEqual(spawnYedek('win32', {}, arg),
    { dosya: 'cmd.exe', arglar: ['/d', '/s', '/c', 'claude', ...arg] });
});

test('spawnYedek: darwin/linux login shell -lc exec claude (SHELL yoksa /bin/zsh)', () => {
  assert.deepStrictEqual(spawnYedek('darwin', { SHELL: '/bin/fish' }, ['--effort', 'high']),
    { dosya: '/bin/fish', arglar: ['-lc', "exec claude '--effort' 'high'"] });
  assert.deepStrictEqual(spawnYedek('linux', {}, []),
    { dosya: '/bin/zsh', arglar: ['-lc', 'exec claude '] });
});

test('posixTekTirnak: arg içindeki tek tırnak POSIX kuralıyla kaçar', () => {
  assert.strictEqual(posixTekTirnak("it's"), "'it'\\''s'");
  assert.strictEqual(posixTekTirnak('sade'), `'sade'`);
  const kacis = spawnYedek('darwin', {}, ["o'k"]).arglar[1];
  assert.strictEqual(kacis, "exec claude 'o'\\''k'");
});

// ---- ConPTY ----
test('conptyKullan: yalnız win32', () => {
  assert.strictEqual(conptyKullan('win32'), true);
  assert.strictEqual(conptyKullan('darwin'), false);
  assert.strictEqual(conptyKullan('linux'), false);
});

// ---- ps ayrıştırıcı ----
test('psCiktiAyristir: pid/ppid/comm çıktısını ebeveyn haritasına çevirir', () => {
  const ornek = [
    '  PID  PPID COMM',              // başlık satırı olsa da atlanmalı (pid= istenir ama savunmacı)
    '   101     1 login',
    '   202   101 -zsh',
    '   203   202 claude',
    '   204   202 /usr/local/bin/node',
    '   205   203 CLAUDE.EXE',
    'bozuk satır',
    '',
  ].join('\n');
  const harita = psCiktiAyristir(ornek);
  assert.deepStrictEqual(harita.get(1), [{ id: 101, ad: 'login' }]);
  assert.deepStrictEqual(harita.get(101), [{ id: 202, ad: '-zsh' }]);
  // comm tam yolsa basename, '.exe' kırpılır, küçük harfe iner (win32 biçimiyle aynı).
  assert.deepStrictEqual(harita.get(202), [{ id: 203, ad: 'claude' }, { id: 204, ad: 'node' }]);
  assert.deepStrictEqual(harita.get(203), [{ id: 205, ad: 'claude' }]);
  assert.strictEqual(harita.has(999), false);
  assert.strictEqual(psCiktiAyristir('').size, 0, 'boş girdi boş harita');
  assert.strictEqual(psCiktiAyristir(null).size, 0);
});

// ---- Kasa: sahte safeStorage arka ucu ----
test('kasaSifrele/kasaCoz: sahte arka uçla şifrele → dosya → çöz döngüsü', () => {
  const sahte = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('SIFRELI:' + String(s)),
    decryptString: (b) => { const t = Buffer.from(b).toString('utf8'); return t.startsWith('SIFRELI:') ? t.slice(8) : ''; },
  };
  const sifreli = kasaSifrele(sahte, 'evren-anahtar-123');
  assert.strictEqual(sifreli, Buffer.from('SIFRELI:evren-anahtar-123').toString('base64'));
  assert.ok(!sifreli.includes('evren-anahtar-123'), 'diskte düz metin olmamalı');
  assert.strictEqual(kasaCoz(sahte, sifreli), 'evren-anahtar-123');
  // Bozuk içerik ve arka ucsuz okuma '' döner.
  assert.strictEqual(kasaCoz(sahte, 'dolu-ama-degil'), '');
  assert.strictEqual(kasaCoz(null, sifreli), '');
  // Arka uç yoksa / şifreleme kullanılamıyorsa yazma anlaşılır hata atar.
  assert.throws(() => kasaSifrele(null, 'x'), /desteklenmiyor/);
  assert.throws(() => kasaSifrele({ isEncryptionAvailable: () => false }, 'x'), /desteklenmiyor/);
  assert.throws(() => kasaSifrele(sahte, '  '), /Boş anahtar/);
});

test('anahtarOku/anahtarYaz: darwin yolu evren.kasa dosyasını safeStorage ile okur/yazar', async (t) => {
  const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'evren-kasa-'));
  t.after(() => { try { fs.rmSync(gecici, { recursive: true, force: true }); } catch {} });
  const sahte = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('SIFRELI:' + String(s)),
    decryptString: (b) => { const x = Buffer.from(b).toString('utf8'); return x.startsWith('SIFRELI:') ? x.slice(8) : ''; },
  };
  const eskiPlatform = process.platform;
  const eskiVeri = process.env.EVREN_VERI_DIZINI;
  const motorYolu = require.resolve('../motor');
  const motorIzgara = require.cache[motorYolu];
  process.env.EVREN_VERI_DIZINI = gecici;
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  delete require.cache[motorYolu];
  try {
    const motor = require('../motor');
    motor.kasaKur(sahte);
    const donen = await motor.anahtarYaz('evren-test-anahtari-123');
    assert.strictEqual(donen, path.join(gecici, 'evren.kasa'));
    const dosya = path.join(gecici, 'evren.kasa');
    assert.ok(fs.existsSync(dosya), 'evren.kasa yazılmalı');
    assert.ok(!fs.readFileSync(dosya, 'utf8').includes('evren-test-anahtari-123'), 'diskte düz metin olmamalı');
    assert.strictEqual(await motor.anahtarOku(), 'evren-test-anahtari-123');
    // Arka uç düşerse: okuma '' döner, yazma anlaşılır hata atar (dosya bozulmaz).
    motor.kasaKur(null);
    assert.strictEqual(await motor.anahtarOku(), '');
    await assert.rejects(() => motor.anahtarYaz('baska-anahtar-xx'), /desteklenmiyor/);
  } finally {
    Object.defineProperty(process, 'platform', { value: eskiPlatform });
    if (eskiVeri === undefined) delete process.env.EVREN_VERI_DIZINI; else process.env.EVREN_VERI_DIZINI = eskiVeri;
    delete require.cache[motorYolu];
    if (motorIzgara) require.cache[motorYolu] = motorIzgara; // izgara öncesi durumu geri yükleme
  }
});

// ---- Arayüz metinleri ve kaynak düzeyi korumalar ----
test('app.js: DPAPI yalnız win32 dalında; kasaAdi darwin/linux metni verir', () => {
  const satirlar = fs.readFileSync(path.join(KOK, 'app.js'), 'utf8').split(/\r?\n/);
  for (const satir of satirlar) {
    if (satir.includes('DPAPI')) assert.match(satir, /'win32'\s*\?\s*'DPAPI/, `win32 dalı olmalı: ${satir.trim()}`);
  }
  const satir = satirlar.find((l) => l.includes('const kasaAdi'));
  assert.ok(satir, 'kasaAdi tanımı olmalı');
  const govde = satir.slice(satir.indexOf('=>') + 2).trim().replace(/;$/, '');
  const kasaAdi = new Function('p', 'return ' + govde);
  assert.strictEqual(kasaAdi('win32'), 'DPAPI');
  assert.strictEqual(kasaAdi('darwin'), 'macOS Anahtar Zinciri');
  assert.strictEqual(kasaAdi('linux'), 'işletim sistemi kasası');
  assert.ok(!kasaAdi('darwin').includes('DPAPI'), 'darwin metninde DPAPI geçmemeli');
  assert.ok(satirlar.some((l) => l.includes('S.platform = d.platform')), 'durum yanıtından platform alınmalı');
});

test('main.js: platform yardımcıları kullanılır, useConpty koşullu', () => {
  const kaynak = fs.readFileSync(path.join(KOK, 'main.js'), 'utf8');
  assert.ok(kaynak.includes('platform.spawnPlanla(process.platform'), 'spawn planı platform.js üzerinden');
  assert.ok(kaynak.includes('platform.spawnYedek(process.platform'), 'yedek sarmalayıcı platform.js üzerinden');
  assert.ok(kaynak.includes('platform.conptyKullan(process.platform)'), 'useConpty koşullu');
  assert.ok(!kaynak.includes('useConpty: true'), 'useConpty koşulsuz kalmamalı');
  assert.ok(kaynak.includes('platform.psCiktiAyristir'), 'ps ayrıştırıcı torunHaritasi\'da');
  assert.ok(kaynak.includes('motor.kasaKur(safeStorage)'), 'safeStorage arka ucu enjekte edilir');
});

test('EVREN.command: zsh başlatıcı LF ile durur, README macOS anlatır', () => {
  const komut = fs.readFileSync(path.join(KOK, 'EVREN.command'), 'utf8');
  assert.ok(komut.startsWith('#!/bin/zsh'), 'shebang zsh olmalı');
  assert.ok(!komut.includes('\r'), 'CRLF olmamalı (sheang bozulur)');
  assert.ok(komut.includes('basla.js'), 'ortak başlatıcıyı çağırmalı');
  const basla = fs.readFileSync(path.join(KOK, 'basla.js'), 'utf8');
  assert.ok(basla.includes("['.'") || basla.includes("['.'],"), "basla.js electron'u '.' ile açmalı");
  const readme = fs.readFileSync(path.join(KOK, 'README.md'), 'utf8');
  assert.ok(readme.includes('macOS'), 'README macOS kurulumunu anlatmalı');
  assert.ok(readme.includes('chmod +x EVREN.command'), 'README chmod notu içermeli');
});

test('app.js: komut tuşu komutTusu soyutlaması ve etiketDarwin ile macOS Cmd desteği', () => {
  const kaynak = fs.readFileSync(path.join(KOK, 'app.js'), 'utf8');
  assert.ok(kaynak.includes('const komutTusu = (e)'), 'komutTusu soyutlaması tanımlı olmalı');
  assert.ok(kaynak.includes('darwinMi() ? !!(e && e.metaKey) : !!(e && e.ctrlKey)'), 'darwin Cmd, değilse Ctrl');
  assert.ok(kaynak.includes('const darwinMi = () => S.platform === \'darwin\''), 'platform bayrağı durum IPC kaynağından');
  // Kopyala/kes/yapıştır dalları soyutlamayı kullanmalı (Ctrl+Shift+C/V dahil).
  const dallar = kaynak.match(/komutTusu\(e\)/g) || [];
  assert.ok(dallar.length >= 4, `kopyala/kes/yapıştır dalları komutTusu ile: ${dallar.length}`);
  // Her iki kisayolBul çağrı yeri darwin bayrağını almalı.
  assert.ok(kaynak.includes('Gorunum.kisayolBul(e, Gorunum.KISAYOLLAR, true, darwinMi())'), 'terminal işleyicisi metaKomut almalı');
  assert.ok(kaynak.includes('Gorunum.kisayolBul(e, Gorunum.KISAYOLLAR, terminalda, darwinMi())'), 'window keydown metaKomut almalı');
  // Palet/liste etiketleri etiketDarwin ile çizilmeli.
  assert.ok(kaynak.includes('Gorunum.etiketDarwin(k.etiket, darwinMi())'), 'kısayol etiketleri etiketDarwin ile');
  // SIGINT korunmalı: Ctrl+C dalı darwin'de koşulsuz PTY'ye düşer, Cmd+C dalı ayrı ve tüketir.
  assert.ok(kaynak.includes('if (!darwinMi() && t.hasSelection())'), 'Ctrl+C darwin\'de seçimliyken de PTY\'ye geçmeli');
  assert.ok(kaynak.includes('darwinMi() && e.metaKey && !e.shiftKey && e.code === \'KeyC\''), 'Cmd+C dalı olmalı');
});

test('main.js: unix MCP çocuk adları python3 ve npx platform koşullu eklenir, shell eklenmez', () => {
  const kaynak = fs.readFileSync(path.join(KOK, 'main.js'), 'utf8');
  const blok = kaynak.match(/if \(process\.platform !== 'win32'\) \{\s*MCP_COCUK\.add\('python3'\);\s*MCP_COCUK\.add\('npx'\);\s*\}/);
  assert.ok(blok, "python3/npx eklemesi 'win32' dışı platform koşuluna bağlı olmalı");
  for (const ad of ['sh', 'bash', 'zsh']) {
    assert.ok(!new RegExp(`MCP_COCUK\\.add\\('${ad}'\\)`).test(kaynak), `${ad} bilinçli olarak eklenmemeli (yanlış boşta kapatma riski)`);
  }
  assert.ok(kaynak.includes('EVREN_MCP_COCUK'), 'ortam değişkeni yolu aynen kalmalı');
});
