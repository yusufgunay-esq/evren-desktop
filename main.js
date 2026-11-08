/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Yusuf Günay. */
// EVREN Desktop — ana süreç: IPC, çoklu pty (ConPTY), EVREN API ölçümü. Model/ayar/kasa mantığı motor.js'te.
const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { StringDecoder } = require('node:string_decoder');
const pty = require('@homebridge/node-pty-prebuilt-multiarch');
const motor = require('./motor');

// Yerel dosyalar ağdan gelmiyor; önbellek eski CSS/JS servis etmesin.
app.commandLine.appendSwitch('disable-http-cache');

const EVREN_BASE_URL = 'https://evren-llmapi.ssyz.org.tr';
const ZEMIN = '#07090b';

// Doğrulama: `electron . --ekran <yol.png> [--ekran-palet]` pencereyi çizip PNG'ye yazar ve kapanır.
const argv = process.argv;
const EKRAN = argv.includes('--ekran') ? argv[argv.indexOf('--ekran') + 1] : null;
const EKRAN_PALET = argv.includes('--ekran-palet');
const EKRAN_OTURUM = argv.includes('--ekran-oturum'); // test: iki oturum açar
// Yalnız test/doğrulama için: claude yerine verilen komutu açar (ör. cmd.exe); API kredisi harcanmaz.
const TEST_KOMUT = process.env.EVREN_TEST_KOMUT || '';

let pencere = null;
const kabuklar = new Map(); // oturum kimliği -> pty (çoklu oturum)
let sonKimlik = 0;
let anahtarOnbellek = null; // kasa okuması (DPAPI) yavaş; süreç boyunca bir kez okunur
let modelOnbellek = null;   // son canlı /v1/models çözümü
const { ayarOku, ayarYaz } = motor;
const panelModulu = async () => motor;

async function anahtar(yenile = false) {
  if (process.env.EVREN_TEST_ANAHTARSIZ) return ''; // test: anahtar yokmuş gibi
  if (anahtarOnbellek && !yenile) return anahtarOnbellek;
  anahtarOnbellek = (await motor.anahtarOku()) || '';
  return anahtarOnbellek;
}

// Uygulama içi anahtar girişi: önce API ile doğrulanır, geçerliyse DPAPI kasasına yazılır.
async function anahtarKaydet(deger) {
  const k = String(deger || '').trim();
  if (k.length < 8) return { ok: false, hata: 'Anahtar çok kısa.' };
  try {
    const r = await fetch(`${EVREN_BASE_URL}/v1/models`, { headers: { 'X-API-Key': k }, signal: zamanAsimi(8000) });
    if (r.status === 401 || r.status === 403) return { ok: false, hata: 'EVREN bu anahtarı kabul etmedi.' };
    if (!r.ok) return { ok: false, hata: `API yanıtı: HTTP ${r.status}` };
  } catch (e) { return { ok: false, hata: 'EVREN API\'ye ulaşılamadı; bağlantıyı kontrol edin.' }; }
  try { await motor.anahtarYaz(k); } catch (e) { return { ok: false, hata: 'Kasa yazılamadı: ' + String(e.message || e).split('\n')[0] }; }
  anahtarOnbellek = k;
  return { ok: true };
}

const zamanAsimi = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);

// Yerel durum: ağ beklemeden anında döner (ilk boyama hızlı olsun).
async function yerelDurum() {
  const p = await panelModulu();
  const anahtarVar = !!(await anahtar());
  const ham = ayarOku();
  const modeller = modelOnbellek || p.MODELLER;
  const sonlar = Array.isArray(ham.sonKlasorler)
    ? ham.sonKlasorler.filter((d) => { try { return fs.statSync(d).isDirectory(); } catch { return false; } })
    : [];
  return {
    anahtarVar, modeller,
    sonModel: typeof ham.sonModel === 'string' ? ham.sonModel : modeller[0] && modeller[0].id,
    projeler: sonlar.map((d) => ({ yol: d, ad: path.basename(d) || d, dal: p.gitDal(d) })),
  };
}

// Canlı API: gecikme ölçer, kota durumunu çeker, model listesini (bağlam/çıktı) yeniler.
async function apiDurum() {
  const p = await panelModulu();
  let deger = await anahtar();
  if (!deger) deger = await anahtar(true); // kullanıcı anahtarı sonradan girmiş olabilir
  if (!deger) return { anahtarVar: false, ok: false };
  const t0 = Date.now();
  try {
    const [rModels, rQuota] = await Promise.all([
      fetch(`${EVREN_BASE_URL}/v1/models`, { headers: { 'X-API-Key': deger }, signal: zamanAsimi(5000) }),
      fetch(`${EVREN_BASE_URL}/v1/quota`, { headers: { 'X-API-Key': deger }, signal: zamanAsimi(5000) }).catch(() => null)
    ]);
    const ms = Date.now() - t0;
    const veri = await rModels.json().catch(() => null);
    if (veri) { const canli = p.modelleriCoz(veri); if (canli.length) modelOnbellek = canli; }

    let kota = null;
    if (rQuota && rQuota.ok) {
      kota = await rQuota.json().catch(() => null);
    }

    return {
      anahtarVar: true,
      ok: rModels.ok,
      ms,
      hata: rModels.ok ? '' : `HTTP ${rModels.status}`,
      modeller: modelOnbellek || undefined,
      kota
    };
  } catch (e) {
    return { anahtarVar: true, ok: false, ms: 0, hata: e.name === 'TimeoutError' || e.name === 'AbortError' ? 'zaman aşımı' : String(e.message || e).slice(0, 40) };
  }
}

// Claude Code her sohbeti ~/.claude/projects/<klasör yolu, harf/rakam dışı '-'>/<id>.jsonl dosyasına yazar.
const OTURUM_KIMLIK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANLI_ESIK_MS = 90 * 1000; // son yazmadan bu yana bu kadar geçmediyse "çalışıyor"

function metinCikar(icerik) {
  if (typeof icerik === 'string') return icerik;
  if (Array.isArray(icerik)) return icerik.map((x) => (x && x.type === 'text' ? x.text : '')).join(' ');
  return '';
}

// İlk gerçek kullanıcı mesajı = oturum başlığı; ilk yanıtın modeli = kaynak (claude-* ise Claude, değilse EVREN).
// Başlık ve model bulununca sonuç önbelleğe alınır, dosya bir daha okunmaz.
const baslikOnbellek = new Map(); // id -> { baslik, kaynak }
function oturumBilgisi(dosya, id) {
  const c = baslikOnbellek.get(id);
  if (c) return c;
  const b = baslikOku(dosya);
  if (b.baslik && b.kaynak) baslikOnbellek.set(id, b);
  return b;
}
function baslikOku(dosya) {
  let fd, baslik = '', kaynak = '';
  try {
    fd = fs.openSync(dosya, 'r');
    const tampon = Buffer.alloc(512 * 1024);
    const kod = new StringDecoder('utf8');
    let konum = 0, kalan = '';
    // Açılış kayıtları büyük olabilir (ilk yanıt yüzlerce KB sonra gelir): parça parça oku, en çok 6 MB.
    while (konum < 6 * 1024 * 1024 && !(baslik && kaynak)) {
      const n = fs.readSync(fd, tampon, 0, tampon.length, konum);
      if (n <= 0) break;
      konum += n;
      const satirlar = (kalan + kod.write(tampon.subarray(0, n))).split('\n');
      kalan = satirlar.pop(); // yarım satır bir sonraki parçayla tamamlanır
      for (const satir of satirlar) {
        let j; try { j = JSON.parse(satir); } catch { continue; }
        if (!j || !j.message) continue;
        if (!baslik && j.type === 'user' && !j.isMeta) {
          const m = metinCikar(j.message.content).replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (m && !m.startsWith('Caveat:') && !m.startsWith('[Request interrupted')) baslik = m.slice(0, 90);
        } else if (!kaynak && j.type === 'assistant' && typeof j.message.model === 'string' && j.message.model !== '<synthetic>') {
          kaynak = /^(claude|opus|sonnet|haiku)/i.test(j.message.model) ? 'claude' : 'evren';
        }
        if (baslik && kaynak) break;
      }
    }
  } catch {} finally { if (fd != null) try { fs.closeSync(fd); } catch {} }
  return { baslik, kaynak };
}

function oturumGecmisi(dizin) {
  if (!dizin || typeof dizin !== 'string') return [];
  const klasor = path.join(os.homedir(), '.claude', 'projects', dizin.replace(/[^a-zA-Z0-9]/g, '-'));
  let adlar;
  try { adlar = fs.readdirSync(klasor); } catch { return []; }
  const simdi = Date.now();
  return adlar
    .filter((a) => a.endsWith('.jsonl') && OTURUM_KIMLIK.test(a.slice(0, -6)))
    .map((a) => { const d = path.join(klasor, a); try { const s = fs.statSync(d); return { id: a.slice(0, -6), dosya: d, ms: s.mtimeMs, boyut: s.size }; } catch { return null; } })
    .filter((x) => x && x.boyut > 0)
    .sort((a, b) => b.ms - a.ms)
    .map((x) => ({ id: x.id, ...oturumBilgisi(x.dosya, x.id), ms: x.ms, canli: simdi - x.ms < CANLI_ESIK_MS }))
    .filter((x) => x.baslik) // hiç kullanıcı mesajı olmayan (yalnız açılış kaydı) oturumlar listelenmez
    .slice(0, 30);
}

async function oturumBaslat({ modelId, dizin, cols, rows, devam }) {
  if (devam != null && !OTURUM_KIMLIK.test(String(devam))) throw new Error('Geçersiz oturum kimliği.');
  if (kabuklar.size >= 8) throw new Error('En çok 8 oturum açık olabilir; birini kapatın.');
  const p = await panelModulu();
  const anahtarDeger = await anahtar();
  if (!anahtarDeger) throw new Error('EVREN API anahtarı yok. Ana ekrandaki alana anahtarı girin.');
  if (!dizin || !fs.existsSync(dizin)) throw new Error(`Klasör yok: ${dizin}`);

  // Ağ beklenmez: model bilgisi açılışta gelen canlı listeden ya da yedek listeden alınır.
  const liste = modelOnbellek || p.MODELLER;
  const model = liste.find((m) => m.id === modelId) || liste[0] || {};

  const env = {
    ...process.env,
    PATH: `${path.join(os.homedir(), '.local', 'bin')}${path.delimiter}${process.env.PATH || ''}`,
    ANTHROPIC_BASE_URL: EVREN_BASE_URL,
    ANTHROPIC_AUTH_TOKEN: anahtarDeger,
    ANTHROPIC_MODEL: model.id,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model.id,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model.id,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'qwen3.8-flash-next',
    ANTHROPIC_SMALL_FAST_MODEL: 'qwen3.8-flash-next',
    CLAUDE_CODE_SUBAGENT_MODEL: model.id,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  };
  delete env.ANTHROPIC_API_KEY;
  // Uygulama başka bir Claude Code oturumundan açıldıysa oturum işaretleri çocuğa geçmesin.
  delete env.CLAUDE_CODE_CHILD_SESSION;
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CLAUDE_CODE_SSE_PORT;
  if (model.baglamSayisi) env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(model.baglamSayisi);
  if (model.cikti) env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(model.cikti);

  const olcu = {
    cols: Number.isFinite(Number(cols)) && Number(cols) > 20 ? Number(cols) : 120,
    rows: Number.isFinite(Number(rows)) && Number(rows) > 5 ? Number(rows) : 30,
  };
  const secenek = { name: 'xterm-256color', cols: olcu.cols, rows: olcu.rows, cwd: dizin, env, useConpty: true };
  let bu;
  if (TEST_KOMUT) bu = pty.spawn(TEST_KOMUT, [], secenek);
  else {
    const arg = ['--dangerously-skip-permissions', ...(devam ? ['--resume', String(devam)] : [])];
    try {
      bu = pty.spawn('claude.exe', arg, secenek);
    } catch {
      bu = pty.spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'claude', ...arg], secenek);
    }
  }
  const id = ++sonKimlik;
  kabuklar.set(id, bu);
  bu.onData((veri) => pencere && !pencere.isDestroyed() && pencere.webContents.send('pty:veri', id, veri));
  bu.onExit(({ exitCode }) => {
    if (pencere && !pencere.isDestroyed()) pencere.webContents.send('pty:cikis', id, { kod: exitCode });
    kabuklar.delete(id);
  });

  ayarYaz({ sonModel: model.id, sonKlasorler: [dizin, ...(ayarOku().sonKlasorler || []).filter((x) => x !== dizin)].slice(0, 8) });
  return { id, model: model.id, dizin };
}

function kabukKapat(id) {
  const k = kabuklar.get(id);
  if (!k) return;
  try { k.kill(); } catch {}
  kabuklar.delete(id);
}
function tumunuKapat() { for (const id of [...kabuklar.keys()]) kabukKapat(id); }

function pencereOlustur() {
  if (process.platform === 'win32') app.setAppUserModelId('com.gunaystudio.evren');
  const alan = screen.getPrimaryDisplay().workAreaSize;
  const genislik = Math.min(1240, Math.max(820, alan.width - 100));
  const yukseklik = Math.min(800, Math.max(520, alan.height - 100));
  pencere = new BrowserWindow({
    icon: path.join(__dirname, 'ikon.ico'),
    width: genislik, height: yukseklik, minWidth: 760, minHeight: 480,
    backgroundColor: ZEMIN, show: false,
    title: 'EVREN',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: ZEMIN, symbolColor: '#8a929d', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });
  pencere.loadFile(path.join(__dirname, 'index.html'), EKRAN_PALET ? { query: { palet: '1' } } : EKRAN_OTURUM ? { query: { oturum: argv.includes('--ekran-tek') ? '1' : '2', odak: argv.includes('--ekran-odak') ? '1' : '', yaz: TEST_KOMUT ? '1' : '' } } : undefined);
  pencere.once('ready-to-show', () => pencere.show());
  pencere.on('closed', () => { tumunuKapat(); pencere = null; });

  if (EKRAN) {
    pencere.webContents.on('console-message', (e, level, message) => {
      const m = (e && e.message) || message;
      const l = (e && e.level) ?? level;
      console.log(`[renderer:${l}] ${m}`);
    });
    pencere.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const img = await pencere.webContents.capturePage();
          fs.mkdirSync(path.dirname(path.resolve(EKRAN)), { recursive: true });
          fs.writeFileSync(path.resolve(EKRAN), img.toPNG());
          console.log(`[ekran] ${path.resolve(EKRAN)}`);
        } catch (err) { console.error('[ekran] hata', err); }
        app.quit();
      }, EKRAN_OTURUM ? (TEST_KOMUT ? 6500 : 14000) : 2600);
    });
  }
}

app.whenReady().then(() => {
  pencereOlustur();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) pencereOlustur(); });
});
app.on('window-all-closed', () => { tumunuKapat(); app.quit(); });

// ---- Proje özeti: commit ısı haritası, dil dağılımı, son commit (yalnız yerel git; ağ yok) ----
const { execFile } = require('node:child_process');
const projeOnbellek = new Map(); // yol -> { zaman, veri }
const git = (dizin, args) => new Promise((coz) => {
  execFile('git', ['-C', dizin, ...args], { timeout: 4000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (h, out) => coz(h ? null : String(out)));
});
const DILLER = {
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript',
  py: 'Python', cs: 'C#', java: 'Java', kt: 'Kotlin', kts: 'Kotlin', swift: 'Swift', go: 'Go', rs: 'Rust', cpp: 'C++', cc: 'C++', h: 'C/C++', hpp: 'C++', c: 'C',
  html: 'HTML', css: 'CSS', scss: 'CSS', vue: 'Vue', svelte: 'Svelte', dart: 'Dart', php: 'PHP', rb: 'Ruby', lua: 'Lua',
  json: 'JSON', md: 'Markdown', yml: 'YAML', yaml: 'YAML', ps1: 'PowerShell', sh: 'Shell', bat: 'Batch', sql: 'SQL', shader: 'Shader', hlsl: 'Shader', gd: 'GDScript',
};
async function projeOzet(dizin) {
  const o = projeOnbellek.get(dizin);
  if (o && Date.now() - o.zaman < 60000) return o.veri;
  const [log, son, dosyalar, durum] = await Promise.all([
    git(dizin, ['log', '--since=182.days', '--format=%ct']),
    git(dizin, ['log', '-1', '--format=%h%x1f%ct%x1f%s']),
    git(dizin, ['ls-files']),
    git(dizin, ['status', '--porcelain']),
  ]);
  if (log == null && dosyalar == null) return { git: false };
  const gun = 86400000, bugun = new Date(); bugun.setHours(0, 0, 0, 0);
  const gunler = new Array(182).fill(0);
  for (const s of (log || '').split(/\r?\n/)) {
    const t = Number(s) * 1000; if (!t) continue;
    const g = Math.floor((bugun.getTime() + gun - t) / gun); // 0 = bugün
    if (g >= 0 && g < 182) gunler[181 - g]++;
  }
  const say = {};
  const liste = (dosyalar || '').split(/\r?\n/).filter(Boolean);
  for (const f of liste) {
    const u = (f.split('.').pop() || '').toLowerCase();
    const d = DILLER[u]; if (d) say[d] = (say[d] || 0) + 1;
  }
  const top = Object.values(say).reduce((a, b) => a + b, 0) || 1;
  const diller = Object.entries(say).sort((a, b) => b[1] - a[1]).map(([ad, n]) => ({ ad, oran: n / top }));
  const [hash, ne, mesaj] = (son || '').trim().split('\x1f');
  const veri = {
    git: true, gunler, toplamCommit: gunler.reduce((a, b) => a + b, 0), bugunGun: bugun.getDay(),
    diller, dosya: liste.length, degisen: (durum || '').split(/\r?\n/).filter(Boolean).length,
    son: hash ? { hash, ne, mesaj } : null,
  };
  projeOnbellek.set(dizin, { zaman: Date.now(), veri });
  return veri;
}
ipcMain.handle('proje-ozet', async (_e, dizin) => {
  try { return dizin && fs.existsSync(dizin) ? await projeOzet(dizin) : { git: false }; } catch { return { git: false }; }
});

// ---- IPC ----
ipcMain.handle('durum', async () => {
  try { return await yerelDurum(); }
  catch (e) { return { anahtarVar: false, modeller: [], projeler: [], hata: e.message }; }
});
ipcMain.handle('anahtar-kaydet', async (_e, deger) => anahtarKaydet(deger));
ipcMain.handle('api', async () => {
  try { return await apiDurum(); }
  catch (e) { return { anahtarVar: true, ok: false, hata: e.message }; }
});

ipcMain.handle('klasor-sec', async () => {
  const onceki = (ayarOku().sonKlasorler || [])[0] || os.homedir();
  const r = await dialog.showOpenDialog(pencere, { title: 'Proje klasörü seç', defaultPath: onceki, properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths.length) return null;
  const yol = r.filePaths[0];
  const p = await panelModulu();
  ayarYaz({ sonKlasorler: [yol, ...(ayarOku().sonKlasorler || []).filter((x) => x !== yol)].slice(0, 8) });
  return { yol, ad: path.basename(yol) || yol, dal: p.gitDal(yol) };
});

ipcMain.handle('baslat', async (_e, secim) => { try { return await oturumBaslat(secim); } catch (e) { return { hata: e.message }; } });
ipcMain.handle('gecmis', async (_e, dizin) => { try { return oturumGecmisi(dizin); } catch { return []; } });
ipcMain.handle('yaz', (_e, id, veri) => { const k = kabuklar.get(id); if (k) { try { k.write(veri); } catch {} } });
ipcMain.handle('boyut', (_e, id, { cols, rows }) => {
  const k = kabuklar.get(id);
  if (!k || !(cols > 0) || !(rows > 0)) return;
  try { k.resize(cols, rows); } catch {}
});
ipcMain.handle('kapat-oturum', (_e, id) => { kabukKapat(id); });
ipcMain.handle('disari', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
