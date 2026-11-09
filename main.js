// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Yusuf Günay. */
// EVREN Desktop — ana süreç: IPC, çoklu pty (ConPTY), EVREN API ölçümü. Model/ayar/kasa mantığı motor.js'te.
const { app, BrowserWindow, ipcMain, dialog, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { Worker } = require('node:worker_threads');
const pty = require('@homebridge/node-pty-prebuilt-multiarch');
const motor = require('./motor');
const gecmis = require('./gecmis');
const sohbet = require('./sohbet');
const RemoteSunucu = require('./remote-sunucu');


// Yerel dosyalar ağdan gelmiyor; önbellek eski CSS/JS servis etmesin.
app.commandLine.appendSwitch('disable-http-cache');


const EVREN_BASE_URL = 'https://evren-llmapi.ssyz.org.tr';
const ZEMIN = '#07090b';


// Doğrulama: `electron . --ekran <yol.png> [--ekran-palet]` pencereyi çizip PNG'ye yazar ve kapanır.
const argv = process.argv;
const EKRAN = argv.includes('--ekran') ? argv[argv.indexOf('--ekran') + 1] : null;
const EKRAN_PALET = argv.includes('--ekran-palet');
const EKRAN_OTURUM = argv.includes('--ekran-oturum'); // test: iki oturum açar
const EKRAN_ORK = argv.includes('--ekran-ork-oturum'); // test: orkestratör oturumu aç
const EKRAN_SEF = argv.includes('--ekran-sef'); // test: kenar panelde Şef kartı
const EKRAN_PROJE = argv.includes('--ekran-proje') ? argv[argv.indexOf('--ekran-proje') + 1] : null; // test: açılışta proje seç
// Yalnız test/doğrulama için: claude yerine verilen komutu açar (ör. cmd.exe); API kredisi harcanmaz.
const TEST_KOMUT = process.env.EVREN_TEST_KOMUT || '';


let pencere = null;
const kabuklar = new Map(); // oturum kimliği -> pty (çoklu oturum)
const oturumBilgi = new Map(); // kimlik -> { modelId, modelAd, dizin, proje, devam, baslangic } (kumanda listesi için)
let sonKimlik = 0;
let anahtarOnbellek = null; // kasa okuması (DPAPI) yavaş; süreç boyunca bir kez okunur
let modelOnbellek = null;   // son canlı /v1/models çözümü
let remoteSunucu = null;
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


// Son projeler listesine girecek klasör mü? Var olmalı; geçici (Temp) klasörler ve Claude'un
// oturum arşivi (~/.claude/projects) proje listesini kirletir, listeye girmez.
const GECICI_KLASOR = /[\\/]appdata[\\/]local[\\/]temp([\\/]|$)/i;
const CLAUDE_ARSIV = /[\\/]\.claude[\\/]projects[\\/]/i;
function gecerliKlasor(d) {
  try {
    if (!d || !fs.statSync(d).isDirectory()) return false;
    if (GECICI_KLASOR.test(String(d)) || CLAUDE_ARSIV.test(String(d))) return false;
    const tmp = os.tmpdir();
    if (String(d).toLowerCase() === tmp.toLowerCase() || String(d).toLowerCase().startsWith((tmp + path.sep).toLowerCase())) return false;
    return true;
  } catch { return false; }
}


// Yerel durum: ağ beklemeden anında döner (ilk boyama hızlı olsun).
async function yerelDurum() {
  const p = await panelModulu();
  const anahtarVar = !!(await anahtar());
  const ham = ayarOku();
  const modeller = modelOnbellek || p.MODELLER;
  const sonlar = Array.isArray(ham.sonKlasorler) ? ham.sonKlasorler.filter(gecerliKlasor) : [];
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


// Orkestratörün çağıracağı EVREN köprüsü: en yeni kurulu plugin sürümünden bulunur.
function evrenAjanYolu() {
  const kok = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'gunay-studio', 'gunay-studio');
  try {
    const surumler = fs.readdirSync(kok)
      .filter((d) => fs.existsSync(path.join(kok, d, 'araclar', 'evren-ajan.mjs')))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    if (surumler.length) return path.join(kok, surumler[0], 'araclar', 'evren-ajan.mjs');
  } catch {}
  return 'evren-ajan.mjs';
}

// Orkestratör brifi: oturumun sistem istemine eklenir. Rolü ve bağlam disiplinini tanımlar;
// yazma yasağı ayrıca --disallowedTools ile donanım seviyesinde uygulanır.
function orkestratorBrifi(yazma) {
  const ajan = evrenAjanYolu();
  return [
    "Sen Şef'sin (orkestratör). Görevin: hedefi planlamak, İŞ iş emirleri yazmak ve işi worker oturumlarına devretmek.",
    'Kurallar:',
    '1. Kendi bağlamını küçük tut. Kodu, logu ve test çıktısını doğrudan okuma; worker raporunu oku.',
    '2. Her iş için kısa bir İŞ brifi yaz. Başlık biçimi: "İŞ 001 · Kısa başlık" (normal yazım). Sonra hedef, kısıtlar, kabul ölçütü, doğrulama komutu.',
    '3. İşi şu köprüyle başlat: node "' + ajan + '" "<brif>" --klasor "<proje yolu>". Paralel işlerde ayrı worktree kullan.',
    '4. Worker\'dan yalnız kısa rapor bekle: ne yapıldı, değişen dosyalar, test kanıtı, açık sorular.',
    '5. Durumu dosyada tut (iş emri + rapor). Oturum bağlamı şişerse devir notu yaz; görev diskte kalsın.',
    '6. Bitince hedefin karşılanıp karşılanmadığını kanıtla özetle; eksik varsa yeni İŞ aç.',
    '7. Estetik/arayüz işlerini ayrı bir worker\'a ver ve brifte kararı worker\'a bırak (ne, neden; nasıl değil).',
    '8. Worker modelini İŞ\'e göre seç (--model): deepseek rutin/geniş iş, glm çetrefilli mantık, qwen hafif metin, gemma/qwen-vl görsel. Flags için: node "' + ajan + '" --help.',
    yazma
      ? '9. Yazma yetkin açık: yalnız küçük ve acil düzeltmeyi kendin yap; kapsamlı işi yine worker\'a devret.'
      : '9. Yazma yetkin kapalı; düzenleme aracın yok. Her yazma İŞ olarak worker\'a gider.',
  ].join('\n');
}

// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ — yeni bir Claude Code oturumu (PTY) açar; başlıkta verilen dizinde çalışır, `devam` verilirse eski oturumu sürdürür.
async function oturumBaslat({ modelId, dizin, cols, rows, devam, forkSession, orkestrator, kodYazma }) {
  if (devam != null && !gecmis.OTURUM_KIMLIK.test(String(devam))) throw new Error('Geçersiz oturum kimliği.');
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
    CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1',
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
  const ork = !!orkestrator;
  const yazma = ork ? kodYazma === true : true;
  let bu;
  if (TEST_KOMUT) bu = pty.spawn(TEST_KOMUT, [], secenek);
  else {
    const arg = ['--dangerously-skip-permissions', ...(devam ? ['--resume', String(devam)] : []), ...(forkSession ? ['--fork-session'] : [])];
    if (ork) {
      arg.push('--append-system-prompt', orkestratorBrifi(yazma));
      if (!yazma) arg.push('--disallowedTools', 'Edit', 'Write', 'NotebookEdit');
    }
    try {
      bu = pty.spawn('claude.exe', arg, secenek);
    } catch {
      bu = pty.spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'claude', ...arg], secenek);
    }
  }
  const id = ++sonKimlik;
  kabuklar.set(id, bu);
  const bilgi = {
    id,
    modelId: model.id || '',
    modelAd: model.ad || model.id || '',
    dizin,
    proje: path.basename(dizin) || dizin,
    devam: devam ? String(devam) : null,
    orkestrator: ork,
    kodYazma: yazma,
    baslangic: Date.now(),
  };
  oturumBilgi.set(id, bilgi);
  // Kayıt kimliği yoksa: PTY açıldıktan sonra dizinde oluşan en yeni jsonl bu oturumun kaydıdır.
  if (!bilgi.devam) {
    let deneme = 0;
    const ara = setInterval(() => {
      if (!kabuklar.has(id) || deneme++ > 120) { clearInterval(ara); return; }
      const dosya = sohbet.oturumDosyasiBul({ dizin, baslangicMs: bilgi.baslangic });
      if (!dosya) return;
      bilgi.devam = path.basename(dosya, '.jsonl');
      clearInterval(ara);
      if (remoteSunucu) remoteSunucu.oturumListesiGuncelle();
    }, 1500);
    if (ara.unref) ara.unref();
  }
  bu.onData((veri) => ptyTamponla(id, veri));
  bu.onExit(({ exitCode }) => {
    ptyBosalt(id); // son çıktı, çıkış bildiriminden ÖNCE geçsin (sıra korunur)
    ptyTampon.delete(id);
    if (pencere && !pencere.isDestroyed()) pencere.webContents.send('pty:cikis', id, { kod: exitCode });
    kabuklar.delete(id);
    if (remoteSunucu) remoteSunucu.oturumKapandi(id, exitCode);
  });


  if (remoteSunucu) {
    remoteSunucu.aktifOturumId = id;
    remoteSunucu.oturumListesiGuncelle();
  }
  ayarYaz({ sonModel: model.id, sonKlasorler: [dizin, ...(ayarOku().sonKlasorler || []).filter((x) => x !== dizin)].slice(0, 8) });
  return { id, model: model.id, modelAd: model.ad || model.id, dizin, proje: bilgi.proje, devam: bilgi.devam, orkestrator: ork, kodYazma: yazma };
}


// PTY çıktısı ~8 ms'lik pencerede birleştirilir: yoğun yazımda IPC tur sayısı düşer, sıra korunur.
const ptyTampon = new Map(); // kimlik -> { parcalar: [], z: zamanlayıcı }
function ptyTamponla(id, veri) {
  let t = ptyTampon.get(id);
  if (!t) { t = { parcalar: [], z: 0 }; ptyTampon.set(id, t); }
  t.parcalar.push(veri);
  if (t.z) return;
  t.z = setTimeout(() => ptyBosalt(id), 8);
}
function ptyBosalt(id) {
  const t = ptyTampon.get(id);
  if (!t) return;
  if (t.z) { clearTimeout(t.z); t.z = 0; }
  if (!t.parcalar.length) return;
  const birlesik = t.parcalar.join('');
  t.parcalar.length = 0;
  if (!birlesik) return;
  if (pencere && !pencere.isDestroyed()) pencere.webContents.send('pty:veri', id, birlesik);
  if (remoteSunucu) remoteSunucu.ptyCiktiEkle(id, birlesik);
}


// Kumanda listesi için proje listesi: son kullanılan klasörler (var olanlar), git dalıyla.
function kumandaProjeleri() {
  const p = motor;
  const sonlar = Array.isArray(ayarOku().sonKlasorler) ? ayarOku().sonKlasorler : [];
  return sonlar
    .filter(gecerliKlasor)
    .map((d) => ({ yol: d, ad: path.basename(d) || d, dal: p.gitDal(d) }));
}


function kumandaModelleri() {
  const liste = modelOnbellek || motor.MODELLER;
  return liste.map((m) => ({ id: m.id, ad: m.ad || m.id, baglam: m.baglam || '' }));
}


function kabukKapat(id) {
  const k = kabuklar.get(id);
  if (!k) return;
  try { k.kill(); } catch {}
  ptyBosalt(id);
  ptyTampon.delete(id);
  kabuklar.delete(id);
  if (remoteSunucu) remoteSunucu.oturumKapandi(id, 0);
}
function tumunuKapat() { for (const id of [...kabuklar.keys()]) kabukKapat(id); }


function pencereOlustur() {
  if (process.platform === 'win32') app.setAppUserModelId('com.gunaystudio.evren');
  const alan = screen.getPrimaryDisplay().workAreaSize;
  const boyutIx = argv.indexOf('--ekran-boyut');
  let genislik = Math.min(1240, Math.max(820, alan.width - 100));
  let yukseklik = Math.min(800, Math.max(520, alan.height - 100));
  if (boyutIx >= 0 && argv[boyutIx + 1]) {
    const [wStr, hStr] = argv[boyutIx + 1].split('x');
    const bw = parseInt(wStr, 10);
    const bh = parseInt(hStr, 10);
    if (bw > 0 && bh > 0) { genislik = bw; yukseklik = bh; }
  }
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
  // Test bayrakları sorgu parametresiyle renderer'a geçer (--ekran-proje açılışta o projeyi seçtirir).
  const sorgu = {};
  if (EKRAN_PALET) sorgu.palet = '1';
  if (EKRAN_OTURUM) {
    sorgu.oturum = argv.includes('--ekran-tek') ? '1' : '2';
    sorgu.odak = argv.includes('--ekran-odak') ? '1' : '';
    sorgu.yaz = TEST_KOMUT ? '1' : '';
  }
  if (EKRAN_PROJE) sorgu.proje = EKRAN_PROJE;
  const araIx = argv.indexOf('--ekran-ara');
  if (araIx >= 0 && argv[araIx + 1]) sorgu.ara = argv[araIx + 1];
  if (argv.includes('--ekran-kumanda')) sorgu.kumanda = '1'; // test: Kumanda modalını açık yakala
  if (argv.includes('--ekran-modal')) sorgu.modal = '1';
  if (argv.includes('--ekran-rol')) sorgu.rol = '1'; // test: orkestratör rolü seçili modal
  if (EKRAN_SEF) sorgu.sef = '1'; // test: kenar panelde Şef kartı görünümü
  if (EKRAN_ORK) { sorgu.oturum = '1'; sorgu.ork = '1'; } // test: orkestratör oturumu aç
  const silIx = argv.indexOf('--ekran-sil');
  if (silIx >= 0 && argv[silIx + 1]) sorgu.sil = argv[silIx + 1]; // test: modalda şu projeyi listeden kaldır
  const fsIx = argv.indexOf('--ekran-fs');
  if (fsIx >= 0 && argv[fsIx + 1]) sorgu.fs = argv[fsIx + 1];
  if (argv.includes('--ekran-igne')) {
    const igneIx = argv.indexOf('--ekran-igne');
    sorgu.igne = (igneIx >= 0 && argv[igneIx + 1] && !argv[igneIx + 1].startsWith('--')) ? argv[igneIx + 1] : '1';
  } // test: Yeni oturum modalını açık yakala
  pencere.loadFile(path.join(__dirname, 'index.html'), Object.keys(sorgu).length ? { query: sorgu } : undefined);
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
      }, (EKRAN_OTURUM || EKRAN_ORK) ? (TEST_KOMUT ? 6500 : 14000) : (EKRAN_SEF ? 7500 : 4200));
    });
  }
}


app.whenReady().then(() => {
function remoteSunucuBaslat() {
  remoteSunucu = new RemoteSunucu({
    veriDizini: app.getPath('userData'), // kumanda.json (token, port, IP) burada kalıcı tutulur
    onPtyYaz: (id, veri) => {
      const k = kabuklar.get(id);
      if (k) { try { k.write(veri); } catch {} }
    },
    onYeniOturum: (secim) => oturumBaslat(secim),
    onOturumKapat: (id) => kabukKapat(id),
    oturumListesiAl: () => {
      const list = [];
      for (const [id] of kabuklar.entries()) {
        const b = oturumBilgi.get(id) || {};
        list.push({
          id,
          baslik: b.proje ? `${b.proje} · oturum #${id}` : `Oturum #${id}`,
          model: b.modelId || '',
          modelAd: b.modelAd || '',
          dizin: b.dizin || '',
          proje: b.proje || '',
          devam: b.devam || null,
        });
      }
      return list;
    },
    oturumBilgisiAl: (id) => oturumBilgi.get(id) || {},
    oturumSayilariAl: (dizin, devam) => {
      try { return gecmis.oturumSayilari(dizin, devam); } catch { return null; }
    },
    modellerAl: () => kumandaModelleri(),
    projelerAl: () => kumandaProjeleri(),
    uygulamaDurumuAl: () => yerelDurum(),
    onDurumDegisti: (bilgi) => {
      if (pencere && !pencere.isDestroyed()) {
        pencere.webContents.send('remote:durum', bilgi);
      }
    }
  });
  remoteSunucu.baslat().catch((err) => console.error('[remote] sunucu hatası:', err));
}


  pencereOlustur();
  remoteSunucuBaslat();
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


// Son projeler listesinden kaldırır. Diskten hiçbir şey silmez; yalnız liste kaydı düşer.
ipcMain.handle('proje-sil', async (_e, yol) => {
  const hedef = String(yol || '');
  if (!hedef) return { ok: false, projeler: kumandaProjeleri() };
  const kalan = (ayarOku().sonKlasorler || []).filter((x) => x !== hedef);
  ayarYaz({ sonKlasorler: kalan });
  return { ok: true, projeler: kumandaProjeleri() };
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
// Geçmiş taraması iş parçacığında: ana süreç dosya okurken kilitlenmez. Tarama sürerken gelen istekler kuyruğa girer.
let gecmisIsci = null, gecmisSayac = 0;
const gecmisBekleyen = new Map(); // istek kimliği -> çözücü
// Ölçüm: ana süreçte tarama için harcanan senkron süre (hedef ≤ 5 ms; tarama iş parçacığında).
const gecmisBlok = { maks: 0, toplam: 0, sayi: 0 };
function gecmisIsciAl() {
  if (gecmisIsci) return gecmisIsci;
  gecmisIsci = new Worker(path.join(__dirname, 'gecmis-isci.js'));
  gecmisIsci.on('message', (m) => {
    const coz = gecmisBekleyen.get(m.id);
    if (!coz) return;
    gecmisBekleyen.delete(m.id);
    coz(m.hata ? [] : (Array.isArray(m.sonuc) ? m.sonuc : []));
  });
  gecmisIsci.on('error', (e) => {
    console.error('[gecmis-isci] ', e && e.message);
    gecmisIsci = null;
    for (const [id, coz] of gecmisBekleyen) { gecmisBekleyen.delete(id); coz(null); }
  });
  gecmisIsci.on('exit', () => { gecmisIsci = null; });
  if (gecmisIsci.unref) gecmisIsci.unref();
  return gecmisIsci;
}
function gecmisOku(dizin) {
  return new Promise((coz) => {
    const t0 = performance.now();
    let isci;
    try { isci = gecmisIsciAl(); } catch { coz(null); return; }
    const id = ++gecmisSayac;
    const tum = !dizin || typeof dizin !== 'string';
    // İş parçacığı çökerse son çare senkron okuma (nadir; gecikme kabul edilir).
    gecmisBekleyen.set(id, (sonuc) => {
      if (sonuc) { coz(sonuc); return; }
      try { coz(tum ? gecmis.tumOturumlariTara() : gecmis.oturumGecmisi(dizin)); } catch { coz([]); }
    });
    try { isci.postMessage({ id, dizin, tum }); }
    catch { gecmisBekleyen.delete(id); coz(null); }
    const gecen = performance.now() - t0;
    gecmisBlok.maks = Math.max(gecmisBlok.maks, gecen);
    gecmisBlok.toplam += gecen;
    gecmisBlok.sayi++;
  });
}
ipcMain.handle('gecmis', async (_e, dizin) => (await gecmisOku(dizin)) || []);


// Claude/EVREN oturumunu çatalleyip temizleme (Item 4d, 4e)
ipcMain.handle('oturum-catalla', async (_e, { kaynakId, dizin, modelId }) => {
  if (!kaynakId || !gecmis.OTURUM_KIMLIK.test(String(kaynakId))) {
    return { ok: false, hata: 'Geçersiz kaynak oturum kimliği.' };
  }
  try {
    const yeniId = crypto.randomUUID();
    const dosya = sohbet.oturumDosyasiBul({ dizin, devam: kaynakId });
    if (!dosya || !fs.existsSync(dosya)) {
      return { ok: false, hata: 'Kaynak oturum dosyası bulunamadı.' };
    }
    const hedefDosya = path.join(path.dirname(dosya), `${yeniId}.jsonl`);
    const icerik = fs.readFileSync(dosya, 'utf8');
    const satirlar = icerik.split('\n');
    const temizSatirlar = [];
    for (const sat of satirlar) {
      if (!sat.trim()) continue;
      try {
        const j = JSON.parse(sat);
        if (j.sessionId) j.sessionId = yeniId;
        // Thinking bloklarını temizle (DeepSeek/EVREN API thinking imzası hatasını önler)
        if (j.type === 'assistant' && j.message && Array.isArray(j.message.content)) {
          j.message.content = j.message.content.filter((c) => !(c && typeof c === 'object' && c.type === 'thinking'));
        }
        temizSatirlar.push(JSON.stringify(j));
      } catch {
        temizSatirlar.push(sat);
      }
    }
        temizSatirlar.push(JSON.stringify({
      type: 'user',
      sessionId: yeniId,
      isMeta: true,
      timestamp: new Date().toISOString(),
      message: {
        role: 'user',
        content: `[Claude oturumundan çatallandı. Kaynak: ${kaynakId}]`,
      },
    }));
    fs.writeFileSync(hedefDosya, temizSatirlar.join('\n') + '\n', 'utf8');
    return { ok: true, yeniId, dizin, modelId };
  } catch (err) {
    return { ok: false, hata: String((err && err.message) || err) };
  }
});


ipcMain.handle('sohbet-oturum-kaydi', async (_e, { dizin, id }) => {
  try {
    const dosya = sohbet.oturumDosyasiBul({ dizin, devam: id });
    if (!dosya || !fs.existsSync(dosya)) return { girisler: [] };
    const { girisler } = sohbet.sonGirisler(dosya, 50);
    return { girisler: girisler || [] };
  } catch {
    return { girisler: [] };
  }
});
ipcMain.handle('gecmis-blok', () => ({ maks: gecmisBlok.maks, ort: gecmisBlok.sayi ? gecmisBlok.toplam / gecmisBlok.sayi : 0, sayi: gecmisBlok.sayi }));
ipcMain.handle('sohbet-gecmisi', async (_e, id) => {
  const bilgi = oturumBilgi.get(id);
  if (!bilgi) return { girisler: [] };
  const dosya = sohbet.oturumDosyasiBul({
    dizin: bilgi.dizin,
    devam: bilgi.devam,
    baslangicMs: bilgi.baslangic,
  });
  if (!dosya) return { girisler: [] };
  try {
    const sonuc = sohbet.sonGirisler(dosya, 200);
    return { girisler: sonuc.girisler || [] };
  } catch {
    return { girisler: [] };
  }
});
ipcMain.handle('yaz', (_e, id, veri) => { const k = kabuklar.get(id); if (k) { try { k.write(veri); } catch {} } });
ipcMain.handle('boyut', (_e, id, { cols, rows }) => {
  const k = kabuklar.get(id);
  if (!k || !(cols > 0) || !(rows > 0)) return;
  try { k.resize(cols, rows); } catch {}
});
ipcMain.handle('kapat-oturum', (_e, id) => { kabukKapat(id); });
// Renderer'ın oturum kimliğini (jsonl) öğrenmesi: Şef kartını geçmişte işaretlemek için.
ipcMain.handle('oturum-kimlik', (_e, id) => {
  const b = oturumBilgi.get(id);
  return b ? { devam: b.devam || null, orkestrator: !!b.orkestrator, kodYazma: b.kodYazma !== false } : null;
});
ipcMain.handle('model-guncelle', (_e, { id, modelId }) => {
  const bilgi = oturumBilgi.get(id);
  if (bilgi && modelId) {
    bilgi.modelId = modelId;
    const m = (modelOnbellek || motor.MODELLER).find((x) => x.id === modelId);
    bilgi.modelAd = (m && m.ad) || modelId;
    if (remoteSunucu) remoteSunucu.oturumListesiGuncelle();
  }
});
ipcMain.handle('disari', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('remote:bilgi', async () => (remoteSunucu ? remoteSunucu.bilgi() : { acik: false }));
ipcMain.handle('remote:qr', async () => (remoteSunucu ? await remoteSunucu.qrKodPngDataUrl() : ''));
ipcMain.handle('remote:yenile', async () => (remoteSunucu ? await remoteSunucu.tokenYenile() : { acik: false }));
ipcMain.handle('remote:ip-sec', async (_e, ip) => (remoteSunucu ? remoteSunucu.ipSec(ip) : { acik: false }));
