// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
// EVREN Desktop — ana süreç: IPC, çoklu pty (ConPTY), EVREN API ölçümü. Model/ayar/kasa mantığı motor.js'te.
const { app, BrowserWindow, ipcMain, dialog, shell, screen, nativeImage, clipboard, powerSaveBlocker, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { Worker } = require('node:worker_threads');
const oturumKarar = require('./oturum-karar');
const pty = require('@homebridge/node-pty-prebuilt-multiarch');
const motor = require('./motor');
const platform = require('./platform');
const gorunumYardim = require('./gorunum');
const gecmis = require('./gecmis');
const tercih = require('./tercih');
const projeCikarim = require('./proje-cikarim');
const sohbet = require('./sohbet');
const windowState = require('./window-state');
const RemoteSunucu = require('./remote-sunucu');
const SURUM = require('./package.json').version;


// HTTP önbelleği AÇIK: yerel dosyalar file:// ile yükleniyor, API çağrıları zaten kendi başlıklarını
// taşıyor; renderer kaynaklarının (font/CSS) her açılışta yeniden indirilmesi gereksizdi.
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
// Ekran görüntüsü bekleme süresi (ms): canlı API yavaşsa ilk boyama için süre tanır.
const EKRAN_BEKLE = argv.includes('--ekran-bekle') ? Math.max(0, Number(argv[argv.indexOf('--ekran-bekle') + 1]) || 0) : 0;
// Ekran görüntüsünü bir DOM öğesine kırp (README görselleri için): EVREN_EKRAN_SEL, EVREN_EKRAN_BOSLUK.
const EKRAN_SEL = process.env.EVREN_EKRAN_SEL || '';
const EKRAN_BOSLUK = Math.max(0, Number(process.env.EVREN_EKRAN_BOSLUK || 0) || 0);
// Yalnız test/doğrulama için: claude yerine verilen komutu açar (ör. cmd.exe); API kredisi harcanmaz.
const TEST_KOMUT = process.env.EVREN_TEST_KOMUT || '';


let pencere = null;
// Pencere geometrisi: userData/window-state.json; ekran görüntüsü modunda (--ekran-boyut) atlanır.
let pencereDurumIzle = null;
const windowStateDosyasi = () => path.join(app.getPath('userData'), 'window-state.json');

// Tek örnek kilidi: EVREN ikinci kez açılırsa yeni sunucu/port üretilmez; var olan pencere öne gelir.
// Bu kilit olmadan ikinci örnek 4141'i dolu bulup portu artırıyor, telefondaki eşleşme bayatlıyordu.
const tekKilit = process.env.EVREN_COKLU === '1' ? true : app.requestSingleInstanceLock();
if (!tekKilit) app.quit();
else {
  app.on('second-instance', () => {
    if (pencere && !pencere.isDestroyed()) {
      if (pencere.isMinimized()) pencere.restore();
      pencere.show();
      pencere.focus();
    }
  });
}
const kabuklar = new Map(); // oturum kimliği -> pty (çoklu oturum)
const oturumBilgi = new Map(); // kimlik -> { modelId, modelAd, dizin, proje, devam, baslangic } (kumanda listesi için)
const baglamIzleyiciler = new Map(); // kimlik -> sohbet.BaglamIzleyici (bağlam kullanımı + tur sayacı)
const ciktiIzleyiciler = new Map(); // oturum dosyası -> sohbet.CiktiIzleyici (üretilen dosyalar)
const onizlemeOnbellek = new Map(); // görsel yolu -> { mtime, veri } (küçük resim)
const uyutulanlar = new Set(); // su an bosta uykuya alinan oturum kimlikleri (cift pty:cikis yarisini onler)
const kapananlar = new Set();  // kabukKapat ile kapatilan oturum kimlikleri (mukerrer cikis olayini onler)
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


// ---- Projeler ----
// Proje = ad + bir ya da daha çok klasör. Oturum ana klasörde açılır, ek klasörler
// `--add-dir` ile verilir. Proje olmadan da çalışılır: tek seferlik bir klasörde ya da
// serbest çalışma alanında (EVREN).
const SERBEST_DIZIN = path.join(os.homedir(), 'EVREN');
const PROJE_SINIRI = 200;
function serbestDizin() {
  try { fs.mkdirSync(SERBEST_DIZIN, { recursive: true }); } catch {}
  return SERBEST_DIZIN;
}
function projeNesnesi(ham) {
  if (!ham || typeof ham !== 'object') return null;
  const yollar = [];
  for (const y of [ham.yol, ...(Array.isArray(ham.yollar) ? ham.yollar : [])]) {
    if (typeof y !== 'string' || !y.trim()) continue;
    const temiz = path.resolve(y.trim());
    if (!yollar.includes(temiz)) yollar.push(temiz);
  }
  if (!yollar.length || !gecerliKlasor(yollar[0])) return null;
  const ad = String(ham.ad || '').trim().slice(0, 60) || path.basename(yollar[0]) || yollar[0];
  return { yol: yollar[0], ad, yollar, son: Number(ham.son) || 0 };
}
function projeleriOku() {
  const ham = ayarOku();
  const kaynak = Array.isArray(ham.projeler)
    ? ham.projeler
    // Eski sürüm yalnız klasör listesi tutuyordu; her klasör adıyla bir proje olur.
    : (Array.isArray(ham.sonKlasorler) ? ham.sonKlasorler : []).map((yol, i) => ({ yol, ad: path.basename(yol) || yol, yollar: [yol], son: -i }));
  const liste = [];
  for (const p of kaynak) {
    const n = projeNesnesi(p);
    if (n && !liste.some((x) => x.yol === n.yol)) liste.push(n);
    if (liste.length >= PROJE_SINIRI) break;
  }
  return liste;
}
function projeleriYaz(liste) {
  const temiz = (Array.isArray(liste) ? liste : []).map(projeNesnesi).filter(Boolean).slice(0, PROJE_SINIRI);
  ayarYaz({ projeler: temiz });
  return temiz;
}
function projeListesi() {
  return projeleriOku()
    .sort((a, b) => (b.son || 0) - (a.son || 0))
    .map((x) => ({ yol: x.yol, ad: x.ad, dal: motor.gitDal(x.yol), yollar: x.yollar, ekler: x.yollar.slice(1) }));
}
function sonKlasorListesi() {
  const sonlar = Array.isArray(ayarOku().sonKlasorler) ? ayarOku().sonKlasorler : [];
  return sonlar.filter(gecerliKlasor).slice(0, 8).map((d) => ({ yol: d, ad: path.basename(d) || d, dal: motor.gitDal(d) }));
}
// Sürmeli oturumun jsonl dosyasını kimlikten bulup çalıştığı klasörü okur.
function devamDizini(kimlik) {
  const kok = path.join(os.homedir(), '.claude', 'projects');
  try {
    for (const d of fs.readdirSync(kok)) {
      const f = path.join(kok, d, String(kimlik) + '.jsonl');
      if (fs.existsSync(f)) {
        const cwd = gecmis.cwdOku(f);
        if (cwd && gecerliKlasor(cwd)) return cwd;
      }
    }
  } catch {}
  return '';
}


// Süreç belleği (MB): Electron'un kendi metriklerinden çalışma kümesi toplamı (ucuz, ağ yok).
function uygulamaBellegiMb() {
  try {
    const metrikler = app.getAppMetrics();
    let toplamKb = 0;
    for (const m of metrikler) toplamKb += (m && m.memory && m.memory.workingSetSize) || 0;
    return Math.round(toplamKb / 1024);
  } catch { return 0; }
}


// Yerel durum: ağ beklemeden anında döner (ilk boyama hızlı olsun).
async function yerelDurum() {
  const p = await panelModulu();
  const anahtarVar = !!(await anahtar());
  const ham = ayarOku();
  const modeller = modelOnbellek || p.MODELLER;
  return {
    anahtarVar, modeller, surum: SURUM, platform: process.platform,
    windowsBuild: process.platform === 'win32' ? (parseInt(os.release().split('.')[2], 10) || 22621) : 0,
    sonModel: typeof ham.sonModel === 'string' ? ham.sonModel : modeller[0] && modeller[0].id,
    sonEfor: motor.eforCoz(ham.sonEfor),
    eforlar: motor.EFORLAR,
    projeler: projeListesi(),
    sonKlasorler: sonKlasorListesi(),
    serbestDizin: SERBEST_DIZIN,
    uyku: ham.uykuEngelle !== false,
    bellekMb: uygulamaBellegiMb(),
    claudeOturumlari: ham.claudeOturumlari === true, // varsayılan kapalı: yalnız EVREN oturumları görünür
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


// Orkestratörün çağıracağı köprü betiği: ortam değişkeni, uygulama klasörü ya da PATH.
// Kişisel katman bu yolu kendi yamasıyla değiştirir; public depo bilmez.
function evrenAjanYolu() {
  if (process.env.EVREN_AJAN) return process.env.EVREN_AJAN;
  const yerel = path.join(__dirname, 'evren-ajan.mjs');
  return fs.existsSync(yerel) ? yerel : 'evren-ajan.mjs';
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
    '10. İş bitince çalışan worker süreçlerini kapat (arkada ajan bırakma) ve projeye kısa devir notu düş: <proje>/_claude/DEVIR.md, en çok 6 satır (yapıldı, doğrulama, sıradaki, açık).',
  ].join('\n');
}

const MB = 1024 * 1024;

// Bellek kapısı: RAM kritikken yeni oturum açmak, Claude Code'un memory guard'ının arka plan
// süreçlerini öldürmesine yol açıyordu. Eşiğin altında kısa süre beklenir; açılmazsa Türkçe hata.
async function bellekKapisi() {
  const ham = ayarOku();
  const esikMb = Number(ham.bellekEsikMb ?? 1600);
  const enCokMs = Number(ham.bellekEnCokMs ?? 20000);
  if (!Number.isFinite(esikMb) || esikMb <= 0) return;
  if (os.freemem() / MB >= esikMb) return;
  const bekle = Number.isFinite(enCokMs) && enCokMs > 0 ? enCokMs : 0;
  const bitis = Date.now() + bekle;
  while (Date.now() < bitis) {
    await new Promise((r) => setTimeout(r, 3000));
    if (os.freemem() / MB >= esikMb) return;
  }
  throw new Error(`Bellek yetersiz: boş RAM ${Math.round(os.freemem() / MB)} MB (eşik ${Math.round(esikMb)} MB). Önce ölü oturumları kapatın: node araclar/oturum-bak.mjs kapat --uygula`);
}

// Sekmenin MCP profilini uygular: ~/.evren/mcp-profilleri/<ad>.json varsa yalnız onu yükler; ad boş ya da 'tam' ise dokunmaz.
function mcpProfiliUygula(arg, ad) {
  const profil = String(ad ?? '').trim();
  if (!profil || profil === 'tam') return;
  const yol = path.join(os.homedir(), '.evren', 'mcp-profilleri', profil + '.json');
  if (fs.existsSync(yol)) arg.push('--strict-mcp-config', '--mcp-config', yol);
  else console.log('[mcp] Profil yok, varsayılan MCP ile devam: ' + yol);
}

// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ — yeni bir Claude Code oturumu (PTY) açar; başlıkta verilen dizinde çalışır, `devam` verilirse eski oturumu sürdürür.
async function oturumBaslat({ modelId, dizin, ekDizinler, projeAd, cols, rows, devam, forkSession, orkestrator, kodYazma, efor }) {
  const eforDeger = motor.eforCoz(efor);
  if (devam != null && !gecmis.OTURUM_KIMLIK.test(String(devam))) throw new Error('Geçersiz oturum kimliği.');
  if (kabuklar.size >= 8) throw new Error('En çok 8 oturum açık olabilir; birini kapatın.');
  await bellekKapisi();
  const p = await panelModulu();
  const anahtarDeger = await anahtar();
  if (!anahtarDeger) throw new Error('EVREN API anahtarı yok. Ana ekrandaki alana anahtarı girin.');
  // Klasör verilmediyse: sürmeli oturumun kendi dizini, yoksa serbest çalışma alanı.
  let hedefDizin = typeof dizin === 'string' ? dizin.trim() : '';
  if (!hedefDizin && devam) hedefDizin = devamDizini(devam);
  const serbestMi = !hedefDizin;
  if (serbestMi) hedefDizin = serbestDizin();
  else if (!fs.existsSync(hedefDizin)) throw new Error(`Klasör yok: ${hedefDizin}`);
  // Projenin ek klasörleri: var olan, ana klasörden farklı ve tekrarsız olanlar.
  const ekler = [];
  for (const d of (Array.isArray(ekDizinler) ? ekDizinler : [])) {
    if (typeof d !== 'string' || !d.trim()) continue;
    const tam = path.resolve(d.trim());
    if (tam === path.resolve(hedefDizin) || ekler.includes(tam) || !fs.existsSync(tam)) continue;
    ekler.push(tam);
  }


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
  // Claude Code kendi eşiğinde (~pencerenin %90'ı) sıkıştırıyor; bu, çıktı tavanı payı
  // bırakmadığı için "istem + tavan > pencere" 400'üne düşüyordu. Pencereyi erkene al.
  // Ayarda (settings.json modelSettings) bu model için eşik varsa env verilmez: o eşik kazanır.
  const otoPencere = motor.sikistirmaEnvDegeri(model.id, model.baglamSayisi, model.cikti);
  if (otoPencere) env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(otoPencere);


  const olcu = {
    cols: Number.isFinite(Number(cols)) && Number(cols) > 20 ? Number(cols) : 120,
    rows: Number.isFinite(Number(rows)) && Number(rows) > 5 ? Number(rows) : 30,
  };
  const secenek = { name: 'xterm-256color', cols: olcu.cols, rows: olcu.rows, cwd: hedefDizin, env };
  if (platform.conptyKullan(process.platform)) secenek.useConpty = true; // ConPTY Windows'a özgü
  const ork = !!orkestrator;
  const yazma = ork ? kodYazma === true : true;
  let bu;
  if (TEST_KOMUT) bu = pty.spawn(TEST_KOMUT, [], secenek);
  else {
    const arg = ['--dangerously-skip-permissions', '--effort', eforDeger, ...(devam ? ['--resume', String(devam)] : []), ...(forkSession ? ['--fork-session'] : []), ...ekler.flatMap((d) => ['--add-dir', d])];
    const kimlik = motor.kimlikIstemi(model.id, eforDeger, ork);
    if (ork) {
      arg.push('--append-system-prompt', kimlik + '\n\n' + orkestratorBrifi(yazma));
      if (!yazma) arg.push('--disallowedTools', 'Edit', 'Write', 'NotebookEdit');
      // Şef yalın MCP ile doğar: sef profili varsa yalnız onu yükle, yoksa ayar profilini (varsayılan yalın) uygula.
      const sefProfil = path.join(os.homedir(), '.evren', 'mcp-profilleri', 'sef.json');
      if (fs.existsSync(sefProfil)) arg.push('--strict-mcp-config', '--mcp-config', sefProfil);
      else mcpProfiliUygula(arg, ayarOku().mcpProfil ?? 'yalin');
    } else {
      arg.push('--append-system-prompt', kimlik);
      // Her sekme varsayılan olarak yalın MCP ile doğar; ayar anahtarı: mcpProfil ('tam' = bugünkü tüm set).
      mcpProfiliUygula(arg, ayarOku().mcpProfil ?? 'yalin');
    }
    try {
      const plan = platform.spawnPlanla(process.platform, arg);
      bu = pty.spawn(plan.dosya, plan.arglar, secenek);
    } catch {
      // Birincil komut açılmadı: win32 cmd sarmalayıcısı, darwin/linux login shell (-l, PATH için).
      const yedek = platform.spawnYedek(process.platform, process.env, arg);
      bu = pty.spawn(yedek.dosya, yedek.arglar, secenek);
    }
  }
  const id = ++sonKimlik;
  kabuklar.set(id, bu);
  uykuGuncelle();
  const bilgi = {
    id,
    modelId: model.id || '',
    modelAd: model.ad || model.id || '',
    dizin: hedefDizin,
    ekler,
    proje: String(projeAd || '').trim() || (serbestMi ? 'EVREN çalışma alanı' : (path.basename(hedefDizin) || hedefDizin)),
    devam: devam ? String(devam) : null,
    orkestrator: ork,
    kodYazma: yazma,
    efor: eforDeger,
    baslangic: Date.now(),
    sonBoyut: { cols: olcu.cols, rows: olcu.rows }, // pty bu boyutla doğdu; ilk bildirim değişim sayılmasın
  };
  oturumBilgi.set(id, bilgi);
  // Kayıt kimliği yoksa: PTY açıldıktan sonra dizinde oluşan en yeni jsonl bu oturumun kaydıdır.
  if (!bilgi.devam) {
    let deneme = 0;
    const ara = setInterval(() => {
      if (!kabuklar.has(id) || deneme++ > 120) { clearInterval(ara); return; }
      // Aynı projede eşzamanlı açılan oturumlar aynı jsonl'i sahiplenmesin: adlar karışmasın.
      const sahipli = new Set();
      for (const [baskaId, baska] of oturumBilgi) if (baskaId !== id && baska.devam) sahipli.add(baska.devam);
      const dosya = sohbet.oturumDosyasiBul({ dizin: hedefDizin, baslangicMs: bilgi.baslangic, haric: sahipli });
      if (!dosya) return;
      bilgi.devam = path.basename(dosya, '.jsonl');
      clearInterval(ara);
      if (remoteSunucu) remoteSunucu.oturumListesiGuncelle();
    }, 1500);
    if (ara.unref) ara.unref();
  } else {
    // Sürdürülen oturum çatallanabilir: Claude Code `--resume` sohbeti YENİ kimlikli bir dosyada sürdürür
    // (kopya; ilk kullanıcı mesajının uuid'si taşınır). Yeni kimliği benimse: kart, sekme adı, şef işareti
    // ve canlı sohbet eski kimlikte kalmasın; eski kopyayı geçmiş kendisi süzer (kokUuid).
    let atKok = '';
    try { atKok = (gecmis.baslikOku(sohbet.dosyaYolu(hedefDizin, bilgi.devam), true) || {}).kokUuid || ''; } catch {}
    if (atKok) {
      let deneme = 0;
      const elek = new Set(); // kokUuid'i uymayan adaylar bir daha denenmez
      const ara = setInterval(() => {
        if (!kabuklar.has(id) || deneme++ > 120) { clearInterval(ara); return; }
        const sahipli = new Set(elek);
        sahipli.add(bilgi.devam);
        for (const [baskaId, baska] of oturumBilgi) if (baskaId !== id && baska.devam) sahipli.add(baska.devam);
        const dosya = sohbet.oturumDosyasiBul({ dizin: hedefDizin, baslangicMs: bilgi.baslangic, haric: sahipli });
        if (!dosya) return;
        const kimlik = path.basename(dosya, '.jsonl');
        let kok = '';
        try { kok = (gecmis.baslikOku(dosya, true) || {}).kokUuid || ''; } catch {}
        if (!kok || kok !== atKok) { elek.add(kimlik); return; } // başka sohbetin kaydı: benimsemeyiz
        bilgi.atalar = [...(bilgi.atalar || []), bilgi.devam]; // alt ajan klasörü atada kalmış olabilir: sayaçlar zinciri sayar
        // Özel ad ata klasöründe kalmış olabilir: uç klasöre devret (Claude Desktop de aynı adı görsün).
        try {
          const kokDizin = path.dirname(sohbet.dosyaYolu(hedefDizin, bilgi.devam));
          gecmis.ozelBaslikTasi(path.join(kokDizin, bilgi.devam), path.join(kokDizin, kimlik));
          gecmisBaslikOnbellekTemizle(kimlik);
        } catch {}
        bilgi.devam = kimlik;
        clearInterval(ara);
        if (pencere && !pencere.isDestroyed()) pencere.webContents.send('oturum:fork', id, kimlik);
        if (remoteSunucu) remoteSunucu.oturumListesiGuncelle();
      }, 1500);
      if (ara.unref) ara.unref();
    }
  }
  bu.onData((veri) => { bilgi.sonCikti = Date.now(); ptyTamponla(id, veri); hedefDuraklamaTara(bilgi, veri); });
  bu.onExit(({ exitCode }) => {
    ptyBosalt(id); // son çıktı, çıkış bildiriminden ÖNCE geçsin (sıra korunur)
    ptyTampon.delete(id);
    const zatenKapandi = kapananlar.has(id);
    const uyutuldu = uyutulanlar.has(id);
    kapananlar.delete(id);
    uyutulanlar.delete(id);
    const pid = bu.pid;
    try { bu.kill(); } catch {} // Windows'ta ConPTY tutamacını bırak
    agacOldur(pid); // hayatta kalan çocuk süreçleri eşzamanlı olarak süpür (ana iş parçacığı donmaz)
    if (zatenKapandi || uyutuldu) return; // kabukKapat renderer'a ve remote'a zaten bildirdi
    if (pencere && !pencere.isDestroyed()) pencere.webContents.send('pty:cikis', id, { kod: exitCode });
    kabuklar.delete(id);
    baglamIzleyiciler.delete(id);
    const b = oturumBilgi.get(id);
    if (b && b.hedefSayac) b.hedefSayac.iptalEt();
    if (b && b.devam) sekmeAdiOnbellek.delete(b.devam);
    oturumBilgi.delete(id);
    uykuGuncelle();
    if (remoteSunucu) remoteSunucu.oturumKapandi(id, exitCode);
  });


  if (remoteSunucu) {
    remoteSunucu.aktifOturumId = id;
    remoteSunucu.oturumListesiGuncelle();
  }
  if (!serbestMi) {
    // Son klasörler: tek seferlik klasör başlangıçları için; serbest alan listeye girmez.
    ayarYaz({ sonModel: model.id, sonEfor: eforDeger, sonKlasorler: [hedefDizin, ...(ayarOku().sonKlasorler || []).filter((x) => x !== hedefDizin)].slice(0, 8) });
    // Bu klasör bir projeye aitse projeyi son kullanılanlara taşı.
    const projeler = projeleriOku();
    const ix = projeler.findIndex((x) => x.yol === path.resolve(hedefDizin));
    if (ix >= 0) { projeler[ix].son = Date.now(); projeleriYaz(projeler); }
  } else {
    ayarYaz({ sonModel: model.id, sonEfor: eforDeger });
  }
  return { id, model: model.id, modelAd: model.ad || model.id, dizin: hedefDizin, ekler, proje: bilgi.proje, devam: bilgi.devam, orkestrator: ork, kodYazma: yazma, efor: eforDeger };
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


// Kumanda listesi için proje listesi (son kullanılanlar önce), git dalıyla.
function kumandaProjeleri() {
  return projeListesi();
}


function kumandaModelleri() {
  const liste = modelOnbellek || motor.MODELLER;
  return liste.map((m) => ({ id: m.id, ad: m.ad || m.id, baglam: m.baglam || '' }));
}


// Bir oturum kapaninca yalniz kabugu degil, tum surec agacini kapat.
// Aksi halde claude.exe'nin actigi MCP sunuculari (node, python) arkada kalir;
// her biri ~20-60 MB tutar ve birkac oturumda RAM dolar.
function agacOldur(pid) {
  if (!pid) return Promise.resolve();
  if (process.platform === 'win32') {
    // taskkill eşzamanlı çağrılırsa ana iş parçacığı 200-1500 ms donar (tüm IPC/PTY/WS durur); async koşar.
    return new Promise((coz) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 8000 }, () => coz());
    });
  }
  try { process.kill(-pid, 'SIGKILL'); } catch {}
  try { process.kill(pid, 'SIGKILL'); } catch {}
  return Promise.resolve();
}

// secenek.bosta: boşta uyutma. Oturum listede kalır (bilgi.uyuyor), tek bir pty:cikis
// { bosta: true } gönderilir ve onExit'in ikinci (çakışan) çıkış olayı bastırılır.
function kabukKapat(id, secenek = {}) {
  const bosta = !!(secenek && secenek.bosta);
  const k = kabuklar.get(id);
  if (!k) return;
  // İşaretler PTY öldürülmeden ÖNCE konur: onExit yarışı çakışan olay üretmesin.
  if (bosta) uyutulanlar.add(id);
  kapananlar.add(id);
  // node-pty sert öldürmeden sonra onExit'i hiç tetiklemezse bayraklar sızmasın (10 sn yedek).
  const temizle = setTimeout(() => { kapananlar.delete(id); uyutulanlar.delete(id); }, 10000);
  if (temizle.unref) temizle.unref();
  const bilgiK = oturumBilgi.get(id);
  if (bilgiK && bilgiK.hedefSayac) bilgiK.hedefSayac.iptalEt();
  if (bosta && bilgiK && bilgiK.devam) {
    bilgiK.uyuyor = true;
    bilgiK.sonGirdi = Date.now();
  }
  kabuklar.delete(id);
  ptyBosalt(id);
  ptyTampon.delete(id);
  baglamIzleyiciler.delete(id);
  const pid = k.pid;
  try { k.kill(); } catch {}
  agacOldur(pid); // eşzamanlı, ana iş parçacığını dondurmaz
  if (!bosta) {
    if (bilgiK && bilgiK.devam) sekmeAdiOnbellek.delete(bilgiK.devam);
    oturumBilgi.delete(id);
    if (ciktiIzleyiciler.size > 24) ciktiIzleyiciler.clear();
  }
  uykuGuncelle();
  if (bosta) {
    if (pencere && !pencere.isDestroyed()) pencere.webContents.send('pty:cikis', id, { kod: 0, bosta: true });
    if (remoteSunucu) remoteSunucu.oturumListesiGuncelle();
  } else if (remoteSunucu) remoteSunucu.oturumKapandi(id, 0);
}
function tumunuKapat() { for (const id of [...kabuklar.keys()]) kabukKapat(id); }

// ---------- Birleşik komut yazımı (masaüstü çubuğu, palet, telefon, otomatik devam) ----------
// Claude Code TUI, aynı pakette gelen \r'yi gönderim saymıyor: metin önce, Enter 250 ms SONRA.
// Tek yol olması, "gitti mi?" hatalarının üç ayrı yerde yeniden doğmasını engeller.
function komutYaz(id, metin) {
  const k = kabuklar.get(id);
  if (!k) return false;
  const temiz = String(metin == null ? '' : metin).replace(/[\r\n]+$/, '');
  if (!temiz) return false;
  const b = oturumBilgi.get(id);
  if (b) { b.sonGirdi = Date.now(); hedefDevral(b); }
  try { k.write(temiz); } catch { return false; }
  const z = setTimeout(() => {
    const k2 = kabuklar.get(id);
    if (k2 === k) { try { k2.write('\r'); } catch {} }
  }, 250);
  if (z.unref) z.unref();
  return true;
}

// Yeni --resume edilmiş PTY'nin istemini basmasını bekler: ilk bayttan sonra 500 ms durulma,
// en az 1200 ms, en çok 6000 ms (Windows'ta Claude --resume 2.5-6 sn sürüyor).
function ptyHazirBekle(id, { minMs = 1200, durulmaMs = 500, enCokMs = 6000 } = {}) {
  return new Promise((coz) => {
    const bas = Date.now();
    if (!kabuklar.has(id)) { coz(false); return; }
    let ciktiGeldi = false;
    let sonCikti = 0;
    const t = setInterval(() => {
      if (!kabuklar.has(id)) { clearInterval(t); coz(false); return; }
      const b = oturumBilgi.get(id);
      const gecen = Date.now() - bas;
      if (b && b.sonCikti && b.sonCikti > bas) { ciktiGeldi = true; sonCikti = b.sonCikti; }
      if (gecen >= enCokMs || (ciktiGeldi && gecen >= minMs && Date.now() - sonCikti >= durulmaMs)) {
        clearInterval(t);
        coz(true);
      }
    }, 150);
    if (t.unref) t.unref();
  });
}

// ---------- Masaüstü sohbet akışı: fs.watch push (tek etkin abonelik) ----------
// OpenCoWork runtime:patch deseni: gönderen tarafı yoksa/yıkılmışsa aboneliği kapat; olay başına
// tek tur. 3 sn'lik güvenlik yoklaması yalnız abone varken koşar (Windows fs.watch kaçırmaları).
let sohbetPush = null; // { anahtar, dosya, pid, okuyucu, watcher, timer, ilkGonderildi }
function sohbetPushDurdur() {
  if (!sohbetPush) return;
  if (sohbetPush.watcher) { try { sohbetPush.watcher.close(); } catch {} }
  if (sohbetPush.timer) clearInterval(sohbetPush.timer);
  sohbetPush = null;
}
function sohbetPushBaslat({ anahtar, pid, dizin, id }) {
  sohbetPushDurdur();
  const dosyaBul = () => {
    if (dizin && id) return sohbet.oturumDosyasiBul({ dizin, devam: id });
    const b = oturumBilgi.get(pid);
    if (!b) return null;
    return sohbet.oturumDosyasiBul({ dizin: b.dizin, devam: b.devam, baslangicMs: b.baslangic });
  };
  const state = { anahtar, pid, dosya: null, okuyucu: new sohbet.ArtimliOkuyucu(), watcher: null, timer: null, ilkGonderildi: false };
  sohbetPush = state;
  const gonder = (girisler, ilk) => {
    if (sohbetPush !== state) return;
    if (!pencere || pencere.isDestroyed() || pencere.webContents.isCrashed()) { sohbetPushDurdur(); return; }
    pencere.webContents.send('sohbet:yeni', { anahtar, girisler, ilk });
  };
  const baglaWatcher = (dosya) => {
    if (state.watcher) { try { state.watcher.close(); } catch {} state.watcher = null; }
    try { state.watcher = fs.watch(dosya, { persistent: false }, () => kontrol()); } catch {}
  };
  const kontrol = () => {
    if (sohbetPush !== state) return;
    const guncel = dosyaBul();
    if (!guncel) {
      if (!state.ilkGonderildi) { state.ilkGonderildi = true; gonder([], true); }
      return;
    }
    if (guncel !== state.dosya) {
      state.dosya = guncel;
      const ilk = state.okuyucu.sifirla(guncel, 200);
      state.ilkGonderildi = true;
      baglaWatcher(guncel);
      gonder(ilk, true);
      return;
    }
    const yeni = state.okuyucu.oku(state.dosya);
    if (yeni.length) gonder(yeni, false);
  };
  kontrol();
  state.timer = setInterval(kontrol, 3000);
  if (state.timer.unref) state.timer.unref();
}

// Uygulama kapanışı tek ve idempotent yoldan geçer: süreç ağaçları + telefondaki sunucu.
let kapaniyor = false;
function temizKapat() {
  if (kapaniyor) return;
  kapaniyor = true;
  // Son pencere geometrisini diske yaz (izle zaten close'da yazar; burada erken kapanışlara karşı).
  try { if (pencereDurumIzle) pencereDurumIzle.kaydet(); } catch {}
  sohbetPushDurdur();
  tumunuKapat();
  if (remoteSunucu) {
    try { remoteSunucu.durdur(); } catch {}
    remoteSunucu = null;
  }
}

// Çalışan oturum varken bilgisayar uykuya geçmesin (ayar: uykuEngelle, varsayılan açık).
// prevent-app-suspension: ekran kapanabilir, sistem uyumaz; iş bitince blok kalkar.
let uykuBlok = null;
function uykuGuncelle() {
  try {
    const acik = ayarOku().uykuEngelle !== false && kabuklar.size > 0;
    if (acik && uykuBlok == null) uykuBlok = powerSaveBlocker.start('prevent-app-suspension');
    else if (!acik && uykuBlok != null) { powerSaveBlocker.stop(uykuBlok); uykuBlok = null; }
    if (pencere && !pencere.isDestroyed()) pencere.webContents.send('uyku:durum', acik);
  } catch {}
}

// Hedef duraklaması: CLI "send a message to continue" dediğinde kullanıcı yazmadan sürsün.
// Oturum başına en çok 3 otomatik devam, aralarında en az 90 sn; kullanıcı yazınca sayaç sıfırlanır.
const HEDEF_SINIR = { enCok: 3, aralik: 90 * 1000 };
const HEDEF_KUYRUK = 8192;
// Kullanıcı (panel ya da telefon) yazınca bekleyen otomatik devam iptal edilir ve bütçe tazelenir.
function hedefDevral(bilgi) {
  if (!bilgi) return;
  if (bilgi.hedefSayac) bilgi.hedefSayac.iptalEt();
  bilgi.hedefDevam = { sayi: 0, son: 0 };
}
function hedefDuraklamaTara(bilgi, veri) {
  // Ham kuyruk ucuz ön eleme için tutulur; pahalı ANSI temizliği yalnız "Goal paused" görülünce koşar.
  const ham = ((bilgi.hedefKuyruk || '') + veri).slice(-HEDEF_KUYRUK);
  bilgi.hedefKuyruk = ham;
  if (ham.indexOf('Goal paused') < 0) return;
  // Otomatik devam varsayılan KAPALI: yalnız ayar.otomatikDevam === true ise çalışır (ayar okuması
  // her pty baytında değil, yalnız metin görülünce yapılır). Açılış (5 sn) ve yeniden boyutlandırma
  // (2 sn) sonrası da bastırılır: TUI o an eski transkripti yeniden basar, "Goal paused" replay'dir.
  if (ayarOku().otomatikDevam !== true) return;
  if (oturumKarar.hedefBastirilmisMi(bilgi, Date.now())) return;
  if (!oturumKarar.hedefDurakladi(oturumKarar.ansiTemizle(ham))) return;
  const h = bilgi.hedefDevam || (bilgi.hedefDevam = { sayi: 0, son: 0 });
  const simdi = Date.now();
  if (!oturumKarar.hedefDevamIzni(h, simdi, HEDEF_SINIR)) return;
  h.sayi++;
  h.son = simdi;
  bilgi.hedefKuyruk = ''; // aynı satır ikinci kez tetiklemesin
  if (!bilgi.hedefSayac) bilgi.hedefSayac = oturumKarar.hedefDevamKur();
  bilgi.hedefSayac.kur(() => {
    if (!kabuklar.has(bilgi.id)) return;
    if (!komutYaz(bilgi.id, 'devam')) return; // metin + ayrı Enter (TUI tek paketteki CR'yi yutuyor)
    if (pencere && !pencere.isDestroyed()) pencere.webContents.send('hedef:devam', bilgi.id, h.sayi);
  });
}

// Bosta kalan oturumlar kendiliginden kapanir: bitmis ajan arkada MCP yigini tutmasin.
// Karari zamanlayici tek basina vermez; ajanin kendi kaydina (jsonl) ve surec agacina bakilir:
//   - son tur asistanin metin cevabiyla kapandi mi (arac cagrisi askida degil),
//   - agacta MCP disinda calisan bir arac/worker var mi,
//   - kullanici son [bostaKapatDk] dakikada hic yazmadi mi.
// Suresi ayarlardan gelir (bostaKapatDk, varsayilan 60 dk; 0 = kapali).
// Uzun sessiz "goal active" oturumlar da kapanabilsin: bostaZorlaDk (varsayilan 240 dk,
// 0 = kapali) esigini gecen ve jsonl'i 15 dk'dir dokunulmamis oturum, durumu 'bitti'
// olmasa da aday olur. ~/.evren/korunan-oturumlar.json'daki uuid'ler asla kapatilmaz.
// Gecmis diskte durur, sekme ayni oturumla --resume edilebilir.
const MCP_COCUK = new Set(['node', 'python', 'pythonw', 'cmd', 'conhost']);
// Unix'te python ikili dosyasının adı python3, MCP sarmalayıcısı npx olarak koşar; tanınsınlar ki
// boşta kapatma turu bitmiş oturumun MCP yığınını 'çalışan araç' sanıp açık tutmasın.
// sh/bash/zsh BİLİNÇLİ eklenmez: ajan araçları shell'den koşar — shell eklemek çalışan oturumu boşta sanıp yanlış kapatır.
if (process.platform !== 'win32') {
  MCP_COCUK.add('python3');
  MCP_COCUK.add('npx');
}
// Virgülle ayrılmış ek adlar: kişisel/özel MCP sunucuları boşta kapatma kararında tanınsın.
for (const ad of String(process.env.EVREN_MCP_COCUK || '').split(',')) {
  const a = ad.trim().toLowerCase().replace(/\.exe$/i, '');
  if (a) MCP_COCUK.add(a);
}

const KORUNAN_DOSYA = path.join(os.homedir(), '.evren', 'korunan-oturumlar.json');
// Korunan oturum listesi: uuid dizisi ya da uuid -> kayit nesnesi (biçim esnek okunur).
// Dosya yoksa bos kume; bozuk/okunamazsa null (tur atlanir) — yanlis oturum kapatmaktansa
// hic kapatmamak yegdir.
function korunanUuidleriOku() {
  let ham;
  try { ham = fs.readFileSync(KORUNAN_DOSYA, 'utf8'); }
  catch (e) { return e && e.code === 'ENOENT' ? new Set() : null; }
  let j;
  try { j = JSON.parse(ham); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const kume = new Set();
  const topla = (d) => {
    if (typeof d === 'string') { if (gecmis.OTURUM_KIMLIK.test(d.trim())) kume.add(d.trim().toLowerCase()); return; }
    if (Array.isArray(d)) { for (const x of d) topla(x); return; }
    if (d && typeof d === 'object') {
      for (const k of Object.keys(d)) {
        if (gecmis.OTURUM_KIMLIK.test(k)) kume.add(k.toLowerCase());
        else topla(d[k]);
      }
    }
  };
  topla(j);
  return kume;
}

// Ek boşta/çalışıyor kuralları (MCP_COCUK yama çapasıdır, değişmez):
// 1) Çocuksuz yaprak powershell/pwsh kalıcı kabuk barındırıcısıdır, aktif iş DEĞİLDİR.
// 2) node ile koşan orkestrasyon/worker/test betiği (sef.mjs, evren-ajan.mjs, npm, --test…)
//    aktif iştir; boşta MCP sunucusu sanılıp Şef oturumu kapatılmaz.
const BOSTA_YAPRAK_KABUK = new Set(['powershell', 'pwsh']);
const AKTIF_NODE_DESEN = /(?:^|[\\/\s"'])(?:sef\.mjs|evren-ajan\.mjs|gece-vardiyasi\.mjs|vitest|jest|tsc|esbuild|vite|webpack|electron-builder)(?:$|[\s"'])|--test\b|\bnpm\b|\bpnpm\b/i;

function torunHaritasi(done) {
  if (process.platform !== 'win32') {
    // darwin/linux: süreç ağacı platform.js'te ayrıştırılır; ikinci sorgu komut satırını ekler
    // (node betiği ayırt edilsin: Şef/worker boşta MCP sunucusu sanılmaz).
    execFile('ps', ['-axo', 'pid=,ppid=,comm='], { timeout: 10000 }, (hata, cikti) => {
      if (hata) return done(null);
      const ebeveyn = platform.psCiktiAyristir(cikti);
      execFile('ps', ['-axo', 'pid=,args='], { timeout: 10000, maxBuffer: 8 * 1024 * 1024 }, (hata2, cikti2) => {
        if (hata2) return done(ebeveyn);
        const komutlar = new Map();
        for (const satir of String(cikti2).split(/\r?\n/)) {
          const m = satir.match(/^\s*(\d+)\s+(\S.*)$/);
          if (m) komutlar.set(Number(m[1]), m[2].slice(0, 240));
        }
        for (const liste of ebeveyn.values()) {
          for (const c of liste) if (komutlar.has(c.id)) c.komut = komutlar.get(c.id);
        }
        done(ebeveyn);
      });
    });
    return;
  }
  // CommandLine ilk 240 karaktere kırpılır: hangi node/python betiği koşuyor, ayırt edilebilsin.
  const ps = 'Get-CimInstance Win32_Process | ForEach-Object { $c = ($_.CommandLine -replace \'[\\r\\n\\t]+\',\' \'); if ($c.Length -gt 240) { $c = $c.Substring(0,240) }; "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.Name)`t$c" }';
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
    { windowsHide: true, timeout: 10000 }, (hata, cikti) => {
      if (hata) return done(null);
      const ebeveyn = new Map();
      for (const satir of String(cikti).split(/\r?\n/)) {
        const p = satir.replace(/\r$/, '').split('\t');
        if (p.length < 3) continue;
        const [kimlik, par, ad] = p;
        if (!/^\d+$/.test(kimlik.trim()) || !/^\d+$/.test(par.trim())) continue;
        const k = Number(par);
        if (!ebeveyn.has(k)) ebeveyn.set(k, []);
        ebeveyn.get(k).push({ id: Number(kimlik), ad: ad.trim().replace(/\.exe$/i, '').toLowerCase(), komut: p.slice(3).join('\t') });
      }
      done(ebeveyn);
    });
}

function agactaCalismaVar(ebeveyn, kok) {
  const yigin = [kok], gorulen = new Set();
  while (yigin.length) {
    const x = yigin.pop();
    for (const c of (ebeveyn.get(x) || [])) {
      if (gorulen.has(c.id)) continue;
      gorulen.add(c.id);
      const cocuklari = ebeveyn.get(c.id) || [];
      if (BOSTA_YAPRAK_KABUK.has(c.ad) && cocuklari.length === 0) continue; // boşta yaprak kabuk
      if (c.ad === 'node' && c.komut && AKTIF_NODE_DESEN.test(c.komut)) return true; // Şef / worker / test koşucu
      if (!MCP_COCUK.has(c.ad)) return true;   // bash, worker, git…: oturum calisiyor
      yigin.push(c.id);
    }
  }
  return false;
}

// Sessizlik suresi: yalniz gercek sohbet etkinligi sayilir (girdi, baslangic, jsonl mtime).
function bostaSessizlikMs({ sonGirdi, baslangic, jsonlMtime, simdi }) {
  return simdi - Math.max(sonGirdi || 0, baslangic || 0, jsonlMtime || 0);
}

// Bosta esigi: normalde bostaKapatDk (varsayilan 20 dk; oturum ayni --resume ile acildigindan
// uyutmak ucuz). Bos RAM bostaBaskiMb'nin (varsayilan 4096) altindaysa esik 5 dk'ya iner.
// Donus: { sinir (ms), baski } ya da kapaliysa null.
function bostaEsikMs({ ayar, bosMb }) {
  const a = ayar || {};
  const dk = Number(a.bostaKapatDk ?? 20);
  if (!Number.isFinite(dk) || dk <= 0) return null;
  const baskiMb = Number(a.bostaBaskiMb ?? 4096);
  const baski = Number.isFinite(baskiMb) && baskiMb > 0 && Number.isFinite(bosMb) && bosMb < baskiMb;
  return { sinir: (baski ? Math.min(5, dk) : dk) * 60000, baski };
}

const bostaKontrol = setInterval(() => {
  const ayar = ayarOku();
  const esik = bostaEsikMs({ ayar, bosMb: os.freemem() / 1048576 });
  if (!esik) return;
  const korunan = korunanUuidleriOku();
  if (!korunan) return;   // dosya bozuk/okunamadi: bu turu atla
  const sinir = esik.sinir;
  const zorlaDk = Number(ayar.bostaZorlaDk ?? 240);
  const zorlaSinir = Number.isFinite(zorlaDk) && zorlaDk > 0 ? zorlaDk * 60000 : 0;
  const simdi = Date.now();
  const adaylar = [];
  const zorlaKume = new Set();
  for (const [id, bilgi] of oturumBilgi) {
    if (!kabuklar.has(id)) continue;
    let dosya = null;
    try {
      dosya = bilgi.devam
        ? sohbet.dosyaYolu(bilgi.dizin, bilgi.devam)
        : sohbet.oturumDosyasiBul({ dizin: bilgi.dizin, baslangicMs: bilgi.baslangic });
    } catch {}
    if (!dosya) continue;
    // Etkinlik = gercek sohbet: kullanici girdisi, oturum baslangici, jsonl yazimi.
    // sonCikti (her pty baytı) kullanilmaz: TUI bosta da periyodik yeniden cizer.
    let jsonlMtime = 0;
    try { jsonlMtime = fs.statSync(dosya).mtimeMs || 0; } catch {}
    const sessiz = bostaSessizlikMs({ sonGirdi: bilgi.sonGirdi, baslangic: bilgi.baslangic, jsonlMtime, simdi });
    // Şef oturumu RAM baskısında 5 dakikaya indirilmez: kendi eşiği (bostaSefDk, varsayılan 60 dk).
    const sefDk = Number(ayar.bostaSefDk ?? 60);
    const etkinSinir = bilgi.orkestrator
      ? (Number.isFinite(sefDk) && sefDk > 0 ? sefDk * 60000 : Infinity)
      : sinir;
    if (sessiz < etkinSinir) continue;
    const kimlik = String(bilgi.devam || path.basename(dosya, '.jsonl')).toLowerCase();
    if (korunan.has(kimlik)) continue;   // korunan oturum asla kapatilmaz
    // Ajan arka plan işini (run_in_background, Monitor, Workflow, ScheduleWakeup) bekliyorsa tur
    // bitmiş görünse de oturum boşta değildir: iş bitmeden uyutulmaz, zorla eşiği de uygulanmaz.
    // Tavan (bostaArkaPlanSaat, varsayılan 12 sa) bildirimi hiç gelmeyen işe karşı emniyettir.
    const arkaSaat = Number(ayar.bostaArkaPlanSaat ?? 12);
    const arkaTavan = Number.isFinite(arkaSaat) && arkaSaat > 0 ? arkaSaat * 3600000 : 12 * 3600000;
    try { if (sohbet.arkaPlanBekleyen(dosya, { simdi, tavanMs: arkaTavan })) continue; } catch {}
    let durum = 'bilinmiyor';
    try { durum = sohbet.oturumDurumu(dosya); } catch {}
    let zorlaAday = false;
    if (zorlaSinir && sessiz > zorlaSinir) {
      try {
        const mtime = fs.statSync(dosya).mtimeMs || 0;
        zorlaAday = mtime > 0 && simdi - mtime > 15 * 60000;
      } catch {}
    }
    if (durum !== 'bitti' && !zorlaAday) continue;  // calisiyor/bilinmiyor: yalniz uzun sessizlikte kapat
    // Şef oturumu yalnız gerçekten bitmişse uyutulur; zorla eşiği Şef'e uygulanmaz.
    if (bilgi.orkestrator) {
      if (durum !== 'bitti') continue;
      zorlaAday = false;
    }
    // Çalışan EVREN işi ya da alt ajan varken asla uyutulmaz (RAM baskısında Şef öldürülmesin).
    if (bilgi.devam) {
      try {
        const say = gecmis.oturumSayilari(bilgi.dizin, bilgi.devam, { atalar: bilgi.atalar });
        if (say && ((say.evrenIsleri && say.evrenIsleri.calisan > 0) || (say.altAjanlar && say.altAjanlar.calisan > 0))) continue;
      } catch {}
    }
    adaylar.push({ id, sessiz });
    if (zorlaAday) zorlaKume.add(id); // zorla eşiğini geçen oturumda süreç ağacı bahane değil
  }
  if (!adaylar.length) return;
  adaylar.sort((x, y) => y.sessiz - x.sessiz);   // en uzun bosta kalan once
  torunHaritasi((ebeveyn) => {
    if (!ebeveyn) return;   // agac okunamadiysa temkinli davran
    for (const { id } of adaylar) {
      const k = kabuklar.get(id);
      if (!k || !kabuklar.has(id)) continue;
      if (!zorlaKume.has(id) && agactaCalismaVar(ebeveyn, k.pid)) continue;
      // Boşta uyutulan oturum listede kalır: telefondan gelen mesaj onu --resume ile uyandırır.
      // tek pty:cikis { bosta: true } kabukKapat içinde gider; onExit'in ikinci olayı bastırılır.
      kabukKapat(id, { bosta: true });
    }
  });
}, 60000);
if (bostaKontrol.unref) bostaKontrol.unref();


function pencereOlustur() {
  if (process.platform === 'win32') app.setAppUserModelId('com.gunaystudio.evren');
  const alan = screen.getPrimaryDisplay().workAreaSize;
  const boyutIx = argv.indexOf('--ekran-boyut');
  let genislik = Math.min(1240, Math.max(820, alan.width - 100));
  let yukseklik = Math.min(800, Math.max(520, alan.height - 100));
  let ekranBoyutVerildi = false;
  if (boyutIx >= 0 && argv[boyutIx + 1]) {
    const [wStr, hStr] = argv[boyutIx + 1].split('x');
    const bw = parseInt(wStr, 10);
    const bh = parseInt(hStr, 10);
    if (bw > 0 && bh > 0) { genislik = bw; yukseklik = bh; ekranBoyutVerildi = true; }
  }
  // Kayıtlı pencere durumu: görünür bir ekrana kenetlenmiş geometri (ekran değişince taşmaz).
  // --ekran-boyut verildiyse test/demo boyutu kazanır.
  const pencereKonum = ekranBoyutVerildi
    ? null
    : windowState.ekranIcinCoz(windowState.oku(windowStateDosyasi()), screen.getAllDisplays());
  pencere = new BrowserWindow({
    icon: path.join(__dirname, 'ikon.ico'),
    ...(pencereKonum && Number.isFinite(pencereKonum.x) && Number.isFinite(pencereKonum.y) ? { x: pencereKonum.x, y: pencereKonum.y } : {}),
    width: pencereKonum ? pencereKonum.width : genislik,
    height: pencereKonum ? pencereKonum.height : yukseklik,
    minWidth: 760, minHeight: 480,
    backgroundColor: ZEMIN, show: false,
    title: 'EVREN',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: ZEMIN, symbolColor: '#8a929d', height: 40 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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
  if (argv.includes('--ekran-proje-duzenle')) sorgu.projeDuzenle = '1'; // test: proje düzenleme modalı
  if (argv.includes('--ekran-adlandir')) sorgu.adlandir = '1'; // test: oturum adlandırma modalı
  const ciktiIx = argv.indexOf('--ekran-cikti');
  if (ciktiIx >= 0) sorgu.cikti = (argv[ciktiIx + 1] && !argv[ciktiIx + 1].startsWith('--')) ? argv[ciktiIx + 1] : '1'; // test: Çıktılar sekmesi (isteğe bağlı oturum kimliği öneki)
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
  pencereDurumIzle = windowState.izle(pencere, windowStateDosyasi(), screen);
  pencere.once('ready-to-show', () => {
    if (pencereKonum && pencereKonum.isMaximized) pencere.maximize();
    else if (pencereKonum && pencereKonum.isFullScreen) pencere.setFullScreen(true);
    pencere.show();
  });
  pencere.on('closed', () => { pencereDurumIzle = null; tumunuKapat(); pencere = null; });


  if (EKRAN) {
    pencere.webContents.on('console-message', (e, level, message) => {
      const m = (e && e.message) || message;
      const l = (e && e.level) ?? level;
      console.log(`[renderer:${l}] ${m}`);
    });
    pencere.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          let kirp = undefined;
          if (EKRAN_SEL) {
            const olcu = await pencere.webContents.executeJavaScript(`(() => {
              // Görsel için arka planı sadeleştir: yarı saydam örtünün arkasındaki metin sızmasın.
              const ort = document.querySelector('.modal-ortu:not([hidden])');
              if (ort) { ort.style.setProperty('background', '#07090b', 'important'); ort.style.setProperty('backdrop-filter', 'none', 'important'); }
              const el = document.querySelector(${JSON.stringify(EKRAN_SEL)});
              if (!el) return null;
              const r = el.getBoundingClientRect();
              return { x: r.x, y: r.y, width: r.width, height: r.height, bg: ort ? getComputedStyle(ort).backgroundColor : 'yok' };
            })()`);
            if (EKRAN_SEL) await new Promise((r) => setTimeout(r, 180)); // boyama tamamlansın
            if (olcu) console.log('[ekran] kirp', JSON.stringify({ x: Math.round(olcu.x), y: Math.round(olcu.y), w: Math.round(olcu.width), h: Math.round(olcu.height), bg: olcu.bg }));
            if (olcu && olcu.width > 0 && olcu.height > 0) {
              const b = EKRAN_BOSLUK;
              kirp = {
                x: Math.max(0, Math.round(olcu.x - b)),
                y: Math.max(0, Math.round(olcu.y - b)),
                width: Math.round(olcu.width + b * 2),
                height: Math.round(olcu.height + b * 2),
              };
            }
          }
          const img = await pencere.webContents.capturePage(kirp);
          fs.mkdirSync(path.dirname(path.resolve(EKRAN)), { recursive: true });
          fs.writeFileSync(path.resolve(EKRAN), img.toPNG());
          console.log(`[ekran] ${path.resolve(EKRAN)}`);
        } catch (err) { console.error('[ekran] hata', err); }
        app.quit();
      }, EKRAN_BEKLE || (sorgu.cikti ? 9000 : (EKRAN_OTURUM || EKRAN_ORK) ? (TEST_KOMUT ? 6500 : 14000) : (EKRAN_SEF ? 7500 : 4200)));
    });
  }
}


app.whenReady().then(() => {
if (!tekKilit) return; // ikinci örnek: pencere/sunucu açma, mevcut örneğe odaklan
motor.kasaKur(safeStorage); // win32 dışı: Electron safeStorage (macOS Keychain / Linux libsecret) arka ucu
function remoteSunucuBaslat() {
  remoteSunucu = new RemoteSunucu({
    veriDizini: app.getPath('userData'), // kumanda.json (token, port, IP) burada kalıcı tutulur
    // Telefon komutu: metin önce, Enter kısa bir beklemeden sonra AYRI yazılır.
    // Claude Code TUI, aynı pakette gelen \r karakterini gönderim olarak saymıyor;
    // kullanıcı metni kutuda görüp "gitmedi" diyordu.
    onKomutYaz: (id, metin) => komutYaz(id, metin),
    onPtyYaz: (id, veri) => {
      const k = kabuklar.get(id);
      const b = oturumBilgi.get(id);
      if (b) { b.sonGirdi = Date.now(); hedefDevral(b); } // telefondan yazan da devralır
      if (k) { try { k.write(veri); } catch {} }
    },
    oturumDurumuAl: (id) => {
      if (kabuklar.has(id)) return 'canli';
      const b = oturumBilgi.get(id);
      return b && b.uyuyor && b.devam ? 'uyuyor' : 'yok';
    },
    // Telefon uyuyan oturuma yazdı: aynı sohbeti --resume ile aç, mesajı hazır olunca ilet.
    onOturumUyandir: async (id, metin) => {
      const b = oturumBilgi.get(id);
      if (!b || !b.devam) return { hata: 'Oturum kaydı bulunamadı; sürdürülemez.' };
      let yeni;
      try {
        yeni = await oturumBaslat({
          modelId: b.modelId,
          dizin: b.dizin,
          ekDizinler: b.ekler,
          orkestrator: b.orkestrator,
          kodYazma: b.kodYazma,
          efor: b.efor,
          devam: b.devam,
        });
      } catch (hata) {
        return { hata: hata.message || 'Oturum uyandırılamadı.' };
      }
      b.uyuyor = false; // eski kimlik listeden düşer; yeni oturum kendi kimliğiyle görünür
      // Masaüstüne haber: telefonun uyandırdığı oturum renderer'da da görünsün (çift sekme açmasın).
      if (pencere && !pencere.isDestroyed()) pencere.webContents.send('oturum:uyandi', { eskiId: id, yeni });
      // Mesaj teslimi bloklamaz: PTY istemini basana kadar bekle (Windows'ta 2.5-6 sn), sonra yaz.
      // Kör 1100 ms bekleme mesajları düşürüyordu.
      if (typeof metin === 'string' && metin) {
        ptyHazirBekle(yeni.id)
          .then((hazir) => { if (hazir) komutYaz(yeni.id, metin); })
          .catch(() => {});
      }
      return { id: yeni.id };
    },
    onYeniOturum: (secim) => oturumBaslat(secim),
    onOturumKapat: (id) => kabukKapat(id),
    oturumListesiAl: () => {
      const list = [];
      for (const [id, b] of oturumBilgi.entries()) {
        const canli = kabuklar.has(id);
        // Uyuyan (boşta kapatılmış, sürdürülebilir) oturumlar da listede: telefondan yazınca uyanır.
        if (!canli && !(b.uyuyor && b.devam)) continue;
        list.push({
          id,
          baslik: b.proje ? `${b.proje} · oturum #${id}` : `Oturum #${id}`,
          model: b.modelId || '',
          modelAd: b.modelAd || '',
          dizin: b.dizin || '',
          proje: b.proje || '',
          devam: b.devam || null,
          durum: canli ? undefined : 'uyuyor',
          orkestrator: !!b.orkestrator,
        });
      }
      return list;
    },
    oturumBilgisiAl: (id) => oturumBilgi.get(id) || {},
    oturumSayilariAl: (dizin, devam) => {
      try {
        const b = [...oturumBilgi.values()].find((x) => x.devam === devam);
        return gecmis.oturumSayilari(dizin, devam, { atalar: b && b.atalar });
      } catch { return null; }
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
app.on('window-all-closed', () => { temizKapat(); app.quit(); });
// Uygulama baska bir yoldan kapanirsa da (menuden cikis, oturum sonu) tum surec agaclari ve
// telefon sunucusu kapansin; temizKapat idempotent'tir, iki olay ust uste gelse is iki kez donmez.
app.on('before-quit', () => { temizKapat(); });


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
// "Claude Code oturumlarını da göster" anahtarı (ayar: claudeOturumlari, varsayılan false).
ipcMain.handle('claude-oturumlari', (_e, deger) => {
  const d = deger === true;
  ayarYaz({ claudeOturumlari: d });
  return d;
});
// Uyku engeli ayarı: açıksa çalışan oturum varken sistem uyumaz.
ipcMain.handle('uyku-engelle', async (_e, deger) => {
  ayarYaz({ uykuEngelle: !!deger });
  uykuGuncelle();
  return ayarOku().uykuEngelle !== false;
});
ipcMain.handle('api', async () => {
  try { return await apiDurum(); }
  catch (e) { return { anahtarVar: true, ok: false, hata: e.message }; }
});


// Projeyi listeden kaldırır. Diskten hiçbir şey silmez; yalnız proje kaydı düşer.
ipcMain.handle('proje-sil', async (_e, yol) => {
  const hedef = String(yol || '').trim();
  if (!hedef) return { ok: false, projeler: projeListesi() };
  const kalan = projeleriOku().filter((x) => path.resolve(x.yol) !== path.resolve(hedef));
  projeleriYaz(kalan);
  return { ok: true, projeler: projeListesi() };
});


// Proje kaydet / düzenle: ad + bir ya da daha çok klasör. İlk klasör ana klasördür.
ipcMain.handle('proje-kaydet', async (_e, ham) => {
  try {
    const istek = ham && typeof ham === 'object' ? ham : {};
    const yollar = [];
    for (const y of (Array.isArray(istek.yollar) ? istek.yollar : [istek.yol])) {
      if (typeof y !== 'string' || !y.trim()) continue;
      const tam = path.resolve(y.trim());
      if (!yollar.includes(tam) && fs.existsSync(tam)) yollar.push(tam);
    }
    if (!yollar.length) return { ok: false, hata: 'Geçerli bir klasör seçilmedi.' };
    const nesne = {
      yol: yollar[0],
      ad: String(istek.ad || '').trim().slice(0, 60) || path.basename(yollar[0]) || yollar[0],
      yollar,
      son: Date.now(),
    };
    const liste = projeleriOku();
    const eski = String(istek.eskiYol || '').trim();
    const ix = liste.findIndex((x) => x.yol === path.resolve(eski || nesne.yol));
    if (ix >= 0) liste[ix] = nesne; else liste.unshift(nesne);
    projeleriYaz(liste);
    return { ok: true, projeler: projeListesi() };
  } catch (e) {
    return { ok: false, hata: String((e && e.message) || e) };
  }
});


// Klasör seç: proje kaydı oluşturmaz. `kaydet` false ise son klasörlere de yazmaz.
ipcMain.handle('klasor-sec', async (_e, kaydet) => {
  const onceki = (ayarOku().sonKlasorler || [])[0] || os.homedir();
  const r = await dialog.showOpenDialog(pencere, { title: 'Çalışılacak klasörü seç', defaultPath: onceki, properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths.length) return null;
  const yol = r.filePaths[0];
  if (kaydet !== false) {
    ayarYaz({ sonKlasorler: [yol, ...(ayarOku().sonKlasorler || []).filter((x) => x !== yol)].slice(0, 8) });
  }
  return { yol, ad: path.basename(yol) || yol, dal: motor.gitDal(yol) };
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
    coz(m.hata ? null : m.sonuc); // dizi (tarama) ya da nesne (içerik araması)
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
// Başlık önbelleği iki yerde yaşar (ana süreç + tarama iş parçacığı). Ad değişince ikisi de temizlenir;
// yoksa soldaki geçmiş listesi eski adı göstermeye devam eder.
function gecmisBaslikOnbellekTemizle(kimlik) {
  gecmis.baslikOnbellekTemizle(kimlik);
  if (gecmisIsci) { try { gecmisIsci.postMessage({ tip: 'onbellek-temizle', kimlik }); } catch {} }
}
// İş parçacığına tek istek: { id, ...mesaj } gönderir, sonucu (ya da null) döndürür.
function gecmisIsciIstek(mesaj) {
  return new Promise((coz) => {
    let isci;
    try { isci = gecmisIsciAl(); } catch { coz(null); return; }
    const id = ++gecmisSayac;
    gecmisBekleyen.set(id, (sonuc) => coz(sonuc == null ? null : sonuc));
    try { isci.postMessage({ id, ...mesaj }); }
    catch { gecmisBekleyen.delete(id); coz(null); }
  });
}

// Tam tarama eşzamanlı istenirse (panel 15 sn'de bir + pencere olayı) tek uçuş paylaşılır:
// yüzlerce MB'lık JSONL taraması aynı anda iki kez koşmaz.
let gecmisTumSozu = null;
function gecmisOku(dizin) {
  const tamTarama = !dizin || typeof dizin !== 'string';
  if (tamTarama && gecmisTumSozu) return gecmisTumSozu;
  const soz = gecmisOkuHam(dizin);
  if (tamTarama) {
    gecmisTumSozu = soz.finally(() => { gecmisTumSozu = null; });
    return gecmisTumSozu;
  }
  return soz;
}
function gecmisOkuHam(dizin) {
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

// İçerik arama: liste renderer'da; dosya kuyrukları iş parçacığında taranır, ana süreç beklemez.
function gecmisAraOku(turler, sorgu) {
  return new Promise((coz) => {
    let isci;
    try { isci = gecmisIsciAl(); } catch { try { coz(gecmis.icerikAraListe(turler, sorgu)); } catch { coz({}); } return; }
    const id = ++gecmisSayac;
    gecmisBekleyen.set(id, (sonuc) => coz(sonuc || {}));
    try { isci.postMessage({ id, tip: 'ara', turler, sorgu }); }
    catch { gecmisBekleyen.delete(id); coz({}); }
  });
}
// Panel tercihleri (sabit / arşiv / elle proje / kümeleme): userData altında tek küçük JSON, atomik yazılır.
const tercihDosyasi = () => path.join(app.getPath('userData'), tercih.DOSYA_ADI);
ipcMain.handle('tercih-oku', () => tercih.oku(tercihDosyasi()));
ipcMain.handle('tercih-yaz', (_e, ham) => {
  try { return tercih.yaz(tercihDosyasi(), ham); } catch (e) { console.error('[tercih] yazılamadı:', e && e.message); return null; }
});
// Klasörsüz oturumların asıl projesi: kayıttaki Write/Edit yollarının çoğunluğundan (dosya damgasıyla önbellekli).
ipcMain.handle('proje-cikar', async (_e, oturumlar) => {
  try {
    const liste = (Array.isArray(oturumlar) ? oturumlar : []).slice(0, 300)
      .filter((o) => o && gecmis.OTURUM_KIMLIK.test(String(o.id || '')) && typeof o.projeYol === 'string');
    // Disk okuması iş parçacığında; işçi yoksa/çöktüyse yerel yola düş.
    const sonuc = await gecmisIsciIstek({ tip: 'proje-cikar', oturumlar: liste, projeler: projeleriOku() });
    return sonuc || await projeCikarim.cikar(liste, projeleriOku());
  } catch { return {}; }
});
ipcMain.handle('gecmis-ara', async (_e, turler, sorgu) => (await gecmisAraOku(turler, sorgu)) || {});


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
    if (!dosya || !fs.existsSync(dosya)) return { girisler: [], degisti: true };
    const { girisler, degisti } = sohbet.sonGirislerOnbellekli(dosya, 50);
    return { girisler: girisler || [], degisti };
  } catch {
    return { girisler: [], degisti: true };
  }
});
ipcMain.handle('gecmis-blok', () => ({ maks: gecmisBlok.maks, ort: gecmisBlok.sayi ? gecmisBlok.toplam / gecmisBlok.sayi : 0, sayi: gecmisBlok.sayi }));
ipcMain.handle('sohbet-gecmisi', async (_e, id) => {
  const bilgi = oturumBilgi.get(id);
  if (!bilgi) return { girisler: [], degisti: true };
  const dosya = sohbet.oturumDosyasiBul({
    dizin: bilgi.dizin,
    devam: bilgi.devam,
    baslangicMs: bilgi.baslangic,
  });
  if (!dosya) return { girisler: [], degisti: true };
  try {
    const sonuc = sohbet.sonGirislerOnbellekli(dosya, 200);
    return { girisler: sonuc.girisler || [], degisti: sonuc.degisti };
  } catch {
    return { girisler: [], degisti: true };
  }
});
// Durum çubuğu: aktif oturumun gerçek bağlam kullanımı (son yanıtın token'ları / model penceresi)
// ve o oturumdaki asistan turu sayısı. Kayıt dosyası yoksa yalnız model penceresi döner.
ipcMain.handle('oturum-baglam', (_e, id) => {
  const b = oturumBilgi.get(id);
  if (!b) return null;
  const dosya = b.devam
    ? sohbet.dosyaYolu(b.dizin, b.devam)
    : sohbet.oturumDosyasiBul({ dizin: b.dizin, baslangicMs: b.baslangic });
  let d = null;
  if (dosya && fs.existsSync(dosya)) {
    let iz = baglamIzleyiciler.get(id);
    if (!iz) { iz = new sohbet.BaglamIzleyici(); baglamIzleyiciler.set(id, iz); }
    try { d = iz.oku(dosya); } catch { d = null; }
  }
  // Kayıttaki model kimliği sağlayıcı önekli ve sürüm eklidir (zai/glm-5.3-fp8);
  // katalog kimliğine çevrilir ki pencere (bağlam sınırı) doğru bulunsun.
  const liste = modelOnbellek || motor.MODELLER;
  const kayitModel = motor.modelKatalogId(d && d.model, liste);
  // Kayıttaki ad katalogda yoksa ham ad gösterilir: başlatma modelini gerçek modelin
  // yerine koymak yanıltıcı olur (kullanıcı /model ile değiştirdiyse kayıt doğrudur).
  const modelId = kayitModel || motor.modelKatalogId(b.modelId, liste) || (d && d.model) || b.modelId;
  const m = (modelId && liste.find((x) => x.id === modelId)) || null;
  return {
    token: d ? d.token : null,
    cikti: d ? d.cikti : null,
    yanit: d ? d.yanit : null,
    model: modelId,
    ad: (m && m.ad) || b.modelAd || modelId,
    pencere: (m && m.baglamSayisi) || null,
    // Sıkıştırmanın tetikleneceği eşik: alt çubuk doluluğu buna göre gösterir.
    esik: m ? motor.sikistirmaEsigi(m.id, m.baglamSayisi, m.cikti) : null,
    kayitVar: !!d,
  };
});

// Çıktılar: oturumun ürettiği/değiştirdiği dosyalar (Write/Edit + Bash'ın ürettiği görseller).
// `dizin` verilirse geçmiş oturum, yoksa canlı oturum kimliğiyle çözülür.
function ciktiDosyasi({ id, dizin } = {}) {
  if (dizin) return sohbet.oturumDosyasiBul({ dizin, devam: id });
  const b = oturumBilgi.get(id);
  if (!b) return null;
  return b.devam
    ? sohbet.dosyaYolu(b.dizin, b.devam)
    : sohbet.oturumDosyasiBul({ dizin: b.dizin, baslangicMs: b.baslangic });
}
// Görsel çıktılar için küçük resim. Yol+mtime anahtarıyla önbelleklenir; çok büyüyünce sıfırlanır.
// Windows'ta createThumbnailFromPath kabuk önbelleğine takılabiliyor; doğrudan okuyup ölçekliyoruz.
// SVG nativeImage ile okunamaz: dosya doğrudan data URL olur (CSP img-src data: izin verir); büyük dosya atlanır.
function svgVeri(yol, sinir) {
  try {
    if (fs.statSync(yol).size > sinir) return null;
    return 'data:image/svg+xml;base64,' + fs.readFileSync(yol).toString('base64');
  } catch { return null; }
}
async function onizlemeOku(yol, mtime) {
  const k = onizlemeOnbellek.get(yol);
  if (k && k.mtime === mtime) return k.veri;
  if (/\.svg$/i.test(yol)) return svgVeri(yol, 200 * 1024);
  try {
    let img = nativeImage.createFromPath(yol);
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    if (!width || !height) return null;
    const olcek = Math.min(160 / width, 160 / height, 1);
    img = img.resize({
      width: Math.max(1, Math.round(width * olcek)),
      height: Math.max(1, Math.round(height * olcek)),
      quality: 'good',
    });
    const veri = img.isEmpty() ? null : img.toDataURL();
    if (onizlemeOnbellek.size > 200) onizlemeOnbellek.clear();
    onizlemeOnbellek.set(yol, { mtime, veri });
    return veri;
  } catch { return null; }
}
ipcMain.handle('oturum-cikti', async (_e, param) => {
  const dosya = ciktiDosyasi(param);
  if (!dosya || !fs.existsSync(dosya)) return { ciktilar: [] };
  let iz = ciktiIzleyiciler.get(dosya);
  if (!iz) iz = new sohbet.CiktiIzleyici();
  // LRU sınırı: çok sayıda geçmiş oturum açmak ana süreç yığınını sınırsız büyütmesin.
  ciktiIzleyiciler.delete(dosya);
  ciktiIzleyiciler.set(dosya, iz);
  while (ciktiIzleyiciler.size > 24 && ciktiIzleyiciler.keys().next().value !== dosya) {
    ciktiIzleyiciler.delete(ciktiIzleyiciler.keys().next().value);
  }
  // JSONL taraması iş parçacığında; işçi cevap vermezse ana süreçteki izleyici yedeği koşar.
  const isciListe = await gecmisIsciIstek({ tip: 'cikti', dosya });
  const liste = isciListe || iz.oku(dosya) || [];
  let resimSayisi = 0;
  // Küçük resim yalnız ilk birkaç görsel için ve aşırı büyük dosyalarda atlanır:
  // ana süreci uzun süre kilitlememek için sınırlı tutulur (sonrası dosya simgesiyle görünür).
  for (const c of liste) {
    if (!c.resim || resimSayisi >= 40) continue;
    if (c.boyut > 3 * 1024 * 1024) { c.onizleme = null; continue; }
    resimSayisi++;
    const veri = await onizlemeOku(c.yol, c.degisimMs);
    if (veri) c.onizleme = veri;
  }
  return { ciktilar: liste, kok: param && param.dizin ? param.dizin : ((oturumBilgi.get(param && param.id) || {}).dizin || '') };
});
// Büyük önizleme katmanı: görsel en çok 1800 px kenara küçültülür, data URL olarak gider (CSP yalnız data: görsele izin verir).
ipcMain.handle('gorsel-buyuk', (_e, yol) => {
  if (typeof yol !== 'string' || !yol) return null;
  try {
    if (!fs.statSync(yol).isFile()) return null;
    if (/\.svg$/i.test(yol)) return svgVeri(yol, 2 * 1024 * 1024);
    let img = nativeImage.createFromPath(yol);
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    const olcek = Math.min(1800 / width, 1800 / height, 1);
    if (olcek < 1) img = img.resize({ width: Math.max(1, Math.round(width * olcek)), height: Math.max(1, Math.round(height * olcek)), quality: 'best' });
    return img.toDataURL();
  } catch { return null; }
});
// Terminale görsel yapıştırma: panodaki görsel <veri dizini>/yapistir/YYYYMMDD-HHMMSS.png olarak saklanır.
function yapistirYoluUret() {
  const dir = path.join(motor.VERI_DIZINI, 'yapistir');
  fs.mkdirSync(dir, { recursive: true });
  const t = new Date();
  for (let sira = 1; sira < 100; sira++) {
    const yol = path.join(dir, gorunumYardim.yapistirAdi(t, sira));
    if (!fs.existsSync(yol)) return yol;
  }
  return path.join(dir, gorunumYardim.yapistirAdi(t, Date.now()));
}
function kucukOnizleme(img) {
  const { width, height } = img.getSize();
  const o = Math.min(120 / width, 120 / height, 1);
  return img.resize({ width: Math.max(1, Math.round(width * o)), height: Math.max(1, Math.round(height * o)) }).toDataURL();
}
// Panodaki görsel: önce senkron readImage(), boş kalırsa async clipboard.read()'in image/* tipleri
// (bazı uygulamalar görseli yalnız oraya koyar). İkisi de boşsa yoktur.
async function panoGorseli() {
  try {
    if (typeof clipboard.readImage === 'function') { const i = clipboard.readImage(); if (i && !i.isEmpty()) return i; }
    for (const oge of await clipboard.read()) {
      const tip = (oge.types || []).find((t) => /^image\//.test(t));
      if (!tip) continue;
      const blob = await oge.getType(tip);
      const img = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
      if (!img.isEmpty()) return img;
    }
  } catch {}
  return null;
}
// Explorer'da kopyalanan dosyalar: Chromium pano köprüsü bunları text/uri-list (file:///…) olarak taşır.
// Yalnız diskte var olan dosya yolları döner; web adresleri (http…) yok sayılır.
function uriYoldan(u) {
  try {
    const h = new URL(String(u).trim());
    if (h.protocol !== 'file:') return '';
    // file:///C:/alt/ust.png -> C:\alt\ust.png (sürükle-bırak da ters eğik çizgi verir; ajan onu bekler)
    return decodeURIComponent(h.pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, '\\'));
  } catch { return ''; }
}
async function panoDosyalari() {
  try {
    for (const oge of await clipboard.read()) {
      if (!(oge.types || []).includes('text/uri-list')) continue;
      const metin = await (await oge.getType('text/uri-list')).text();
      const yollar = metin.split(/\r?\n/).filter((s) => s && !s.startsWith('#')).map(uriYoldan).filter((y) => y && fs.existsSync(y));
      if (yollar.length) return yollar.slice(0, 32);
    }
  } catch {}
  return [];
}
// Panodan terminale eklenecek şey: panodaki görsel (yapistir/ altına PNG yazılır) ya da
// kopyalanan dosyalar (yolları terminale yazılır). İkisi de yoksa null; yapıştırma metne kalır.
ipcMain.handle('pano-ek-al', async () => {
  try {
    const img = await panoGorseli();
    if (img) {
      const yol = yapistirYoluUret();
      fs.writeFileSync(yol, img.toPNG());
      return { yollar: [yol], onizleme: kucukOnizleme(img) };
    }
    const yollar = await panoDosyalari();
    if (yollar.length) {
      let onizleme = null;
      try { const g = nativeImage.createFromPath(yollar[0]); if (!g.isEmpty()) onizleme = kucukOnizleme(g); } catch {}
      return { yollar, onizleme };
    }
  } catch {}
  return null;
});
// "Görsel ekle": dosya seçici; seçilen yollar aynı biçimde terminale yazılır. Küçük önizleme ilk görselden.
ipcMain.handle('gorsel-sec', async () => {
  const r = await dialog.showOpenDialog(pencere, {
    title: 'Terminale eklenecek görsel ya da dosya',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Görseller', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }, { name: 'Tüm dosyalar', extensions: ['*'] }],
  });
  if (r.canceled || !r.filePaths.length) return null;
  let onizleme = null;
  try { const img = nativeImage.createFromPath(r.filePaths[0]); if (!img.isEmpty()) onizleme = kucukOnizleme(img); } catch {}
  return { yollar: r.filePaths, onizleme };
});
ipcMain.handle('dosya-onizleme', (_e, yol) => {
  try { const img = nativeImage.createFromPath(yol); return img.isEmpty() ? null : kucukOnizleme(img); } catch { return null; }
});
ipcMain.handle('dosya-ac', async (_e, yol) => {
  if (typeof yol !== 'string' || !yol) return 'gecersiz';
  try { if (!fs.statSync(yol).isFile()) return 'bulunamadi'; } catch { return 'bulunamadi'; }
  return shell.openPath(yol);
});
ipcMain.handle('dosya-klasor', (_e, yol) => {
  if (typeof yol !== 'string' || !yol) return false;
  try { if (!fs.statSync(yol).isFile()) return false; } catch { return false; }
  shell.showItemInFolder(yol);
  return true;
});
ipcMain.handle('yaz', (_e, id, veri) => {
  const k = kabuklar.get(id);
  const b = oturumBilgi.get(id);
  if (b) {
    // Gerçek metin girdisi devralır; tuş dizileri (Ctrl+L, Esc, ok tuşları) bütçeyi sıfırlamaz.
    if (oturumKarar.gercekMetinGirdisiMi(veri)) { b.sonGirdi = Date.now(); hedefDevral(b); }
    else if (veri === '\x03' && b.hedefSayac) b.hedefSayac.iptalEt(); // Ctrl+C: bekleyen devamı iptal et, bütçeyi koru
  }
  if (k) { try { k.write(veri); } catch {} }
});
// Masaüstü çubuğu/palet: birleşik yazım (metin + ayrı Enter).
ipcMain.handle('komut-yaz', (_e, id, metin) => komutYaz(id, metin));
// Masaüstü sohbet paneli: push aboneliği (tek etkin); eski yoklama tamamen kalkar.
ipcMain.handle('sohbet-abone', (_e, param) => { sohbetPushBaslat(param || {}); return true; });
ipcMain.handle('sohbet-birak', () => { sohbetPushDurdur(); return true; });
ipcMain.handle('boyut', (_e, id, { cols, rows }) => {
  const k = kabuklar.get(id);
  if (!k || !(cols > 0) || !(rows > 0)) return;
  // Aynı boyutu yeniden göndermek pty'de SIGWINCH üretir; Claude Code TUI'nin transkripti baştan basılır.
  const b = oturumBilgi.get(id);
  const yeni = { cols, rows };
  if (b && gorunumYardim.boyutAyni(b.sonBoyut, yeni)) return;
  try { k.resize(cols, rows); } catch {}
  if (b) {
    b.sonBoyut = yeni;
    b.sonBoyutMs = Date.now(); // resize sonrası 2 sn "devam" bastırma penceresi
  }
});
ipcMain.handle('kapat-oturum', (_e, id) => { kabukKapat(id); });
// Renderer'ın oturum kimliğini (jsonl) öğrenmesi: Şef kartını geçmişte işaretlemek ve
// sekme adını (ilk kullanıcı mesajı) yazmak için. Ad bulununca önbelleğe alınır, dosya bir daha okunmaz.
const sekmeAdiOnbellek = new Map(); // devam(kimlik) -> başlık
ipcMain.handle('oturum-kimlik', (_e, id) => {
  const b = oturumBilgi.get(id);
  if (!b) return null;
  let baslik = b.devam ? (sekmeAdiOnbellek.get(b.devam) || null) : null;
  if (!baslik && b.devam) {
    try {
      const dosya = sohbet.dosyaYolu(b.dizin, b.devam);
      // Claude Desktop'ın verdiği özel ad (custom-title.json) varsa o tercih edilir; yoksa ilk kullanıcı mesajı.
      baslik = gecmis.ozelBaslikOku(path.join(path.dirname(dosya), b.devam)) || '';
      if (!baslik && fs.existsSync(dosya)) baslik = (gecmis.baslikOku(dosya, true, true) || {}).baslik || '';
      if (baslik) sekmeAdiOnbellek.set(b.devam, baslik);
    } catch {}
  }
  return { devam: b.devam || null, orkestrator: !!b.orkestrator, kodYazma: b.kodYazma !== false, baslik: baslik || null };
});
// Oturumu yeniden adlandırır: Claude Code'un kendi custom-title.json dosyasına yazar
// (masaüstü `/rename` ile aynı biçim). Böylece ad hem sekmede hem geçmişte hem
// Claude Desktop'ta kalıcı olur. Boş ad dosyayı siler, otomatik ada döner.
ipcMain.handle('oturum-adlandir', (_e, { dizin, devam, ad } = {}) => {
  const id = String(devam || '');
  if (!gecmis.OTURUM_KIMLIK.test(id)) return { ok: false, hata: 'oturum kimliği yok' };
  if (typeof dizin !== 'string' || !dizin.trim()) return { ok: false, hata: 'proje klasörü yok' };
  try {
    const dosya = sohbet.dosyaYolu(dizin.trim(), id);
    const seansDizin = path.join(path.dirname(dosya), id);
    const yeni = gecmis.ozelBaslikYaz(seansDizin, ad);
    sekmeAdiOnbellek.delete(id);
    gecmisBaslikOnbellekTemizle(id);
    if (remoteSunucu) remoteSunucu.oturumListesiGuncelle();
    return { ok: true, ad: yeni };
  } catch (e) { return { ok: false, hata: e.message }; }
});
// Yeni oturumun sekme adı: ilk kullanıcı mesajından 2-6 kelimelik başlık üretir.
// Aynı EVREN ucuna gider; düşünme kapalı ve çıktı ~10 token, maliyeti yok denecek kadar az.
// Başarısız olursa renderer ilk mesajdan türetilen adı kullanmaya devam eder.
ipcMain.handle('baslik-uret', async (_e, metin) => {
  const kaynak = String(metin || '').replace(/\s+/g, ' ').trim().slice(0, 1600);
  if (kaynak.length < 8) return { ok: false };
  if (oturumKarar.baslikAnlamsiz(kaynak)) return { ok: false, anlamsiz: true }; // "devam" gibi mesajlar ad olmaz
  try {
    const k = await anahtar();
    if (!k) return { ok: false };
    const istek = {
      model: 'qwen3.8-flash-next',
      max_tokens: 48,
      thinking: { type: 'disabled' },
      messages: [{
        role: 'user',
        content: ['Bir yazılım oturumu için kısa başlık üret.', 'Kurallar:', '- Mesajın dilinde yaz (Türkçe mesaj → Türkçe başlık).', '- 2-5 kelime, en çok 48 karakter.', '- Mesajın kendi sözcüklerini kullan; çeviri yapma.', '- Tırnak, nokta, emoji, açıklama ve etiket kullanma.', '', 'Mesaj: ' + kaynak].join(String.fromCharCode(10)),
      }],
    };
    const r = await fetch(`${EVREN_BASE_URL}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-API-Key': k },
      body: JSON.stringify(istek),
      signal: zamanAsimi(12000),
    });
    if (!r.ok) return { ok: false };
    const j = await r.json().catch(() => null);
    const parca = j && Array.isArray(j.content) ? j.content.find((c) => c && c.type === 'text' && c.text) : null;
    const ad = oturumKarar.baslikDuzelt((parca && parca.text) || '');
    if (!ad || oturumKarar.baslikAnlamsiz(ad)) return { ok: false };
    return { ok: true, ad };
  } catch { return { ok: false }; }
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
// Pano: renderer'ın navigator.clipboard izni bazı kurulumlarda kapalı; ana süreçteki clipboard
// her zaman çalışır. Win+V pano geçmişinden gelen metin de bu yoldan terminale ulaşır.
ipcMain.handle('pano-oku', () => { try { return clipboard.readText() || ''; } catch { return ''; } });
ipcMain.handle('pano-yaz', (_e, metin) => { try { clipboard.writeText(String(metin ?? '')); return true; } catch { return false; } });
ipcMain.handle('remote:bilgi', async () => (remoteSunucu ? remoteSunucu.bilgi() : { acik: false }));
ipcMain.handle('remote:qr', async () => (remoteSunucu ? await remoteSunucu.qrKodPngDataUrl() : ''));
ipcMain.handle('remote:yenile', async () => (remoteSunucu ? await remoteSunucu.tokenYenile() : { acik: false }));
ipcMain.handle('remote:ip-sec', async (_e, ip) => (remoteSunucu ? remoteSunucu.ipSec(ip) : { acik: false }));
