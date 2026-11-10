// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Yusuf Günay. */
// EVREN Desktop — ana süreç: IPC, çoklu pty (ConPTY), EVREN API ölçümü. Model/ayar/kasa mantığı motor.js'te.
const { app, BrowserWindow, ipcMain, dialog, shell, screen, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { Worker } = require('node:worker_threads');
const pty = require('@homebridge/node-pty-prebuilt-multiarch');
const motor = require('./motor');
const gecmis = require('./gecmis');
const sohbet = require('./sohbet');
const RemoteSunucu = require('./remote-sunucu');
const SURUM = require('./package.json').version;


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
// Ekran görüntüsü bekleme süresi (ms): canlı API yavaşsa ilk boyama için süre tanır.
const EKRAN_BEKLE = argv.includes('--ekran-bekle') ? Math.max(0, Number(argv[argv.indexOf('--ekran-bekle') + 1]) || 0) : 0;
// Ekran görüntüsünü bir DOM öğesine kırp (README görselleri için): EVREN_EKRAN_SEL, EVREN_EKRAN_BOSLUK.
const EKRAN_SEL = process.env.EVREN_EKRAN_SEL || '';
const EKRAN_BOSLUK = Math.max(0, Number(process.env.EVREN_EKRAN_BOSLUK || 0) || 0);
// Yalnız test/doğrulama için: claude yerine verilen komutu açar (ör. cmd.exe); API kredisi harcanmaz.
const TEST_KOMUT = process.env.EVREN_TEST_KOMUT || '';


let pencere = null;

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


// Yerel durum: ağ beklemeden anında döner (ilk boyama hızlı olsun).
async function yerelDurum() {
  const p = await panelModulu();
  const anahtarVar = !!(await anahtar());
  const ham = ayarOku();
  const modeller = modelOnbellek || p.MODELLER;
  return {
    anahtarVar, modeller, surum: SURUM,
    sonModel: typeof ham.sonModel === 'string' ? ham.sonModel : modeller[0] && modeller[0].id,
    sonEfor: motor.eforCoz(ham.sonEfor),
    eforlar: motor.EFORLAR,
    projeler: projeListesi(),
    sonKlasorler: sonKlasorListesi(),
    serbestDizin: SERBEST_DIZIN,
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
    '10. İş bitince çalışan worker süreçlerini kapat (arkada ajan bırakma) ve projeye kısa devir notu düş: <proje>/_claude/DEVIR.md, en çok 6 satır (yapıldı, doğrulama, sıradaki, açık).',
  ].join('\n');
}

// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ — yeni bir Claude Code oturumu (PTY) açar; başlıkta verilen dizinde çalışır, `devam` verilirse eski oturumu sürdürür.
async function oturumBaslat({ modelId, dizin, ekDizinler, projeAd, cols, rows, devam, forkSession, orkestrator, kodYazma, efor }) {
  const eforDeger = motor.eforCoz(efor);
  if (devam != null && !gecmis.OTURUM_KIMLIK.test(String(devam))) throw new Error('Geçersiz oturum kimliği.');
  if (kabuklar.size >= 8) throw new Error('En çok 8 oturum açık olabilir; birini kapatın.');
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


  const olcu = {
    cols: Number.isFinite(Number(cols)) && Number(cols) > 20 ? Number(cols) : 120,
    rows: Number.isFinite(Number(rows)) && Number(rows) > 5 ? Number(rows) : 30,
  };
  const secenek = { name: 'xterm-256color', cols: olcu.cols, rows: olcu.rows, cwd: hedefDizin, env, useConpty: true };
  const ork = !!orkestrator;
  const yazma = ork ? kodYazma === true : true;
  let bu;
  if (TEST_KOMUT) bu = pty.spawn(TEST_KOMUT, [], secenek);
  else {
    const arg = ['--dangerously-skip-permissions', '--effort', eforDeger, ...(devam ? ['--resume', String(devam)] : []), ...(forkSession ? ['--fork-session'] : []), ...ekler.flatMap((d) => ['--add-dir', d])];
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
    dizin: hedefDizin,
    ekler,
    proje: String(projeAd || '').trim() || (serbestMi ? 'EVREN çalışma alanı' : (path.basename(hedefDizin) || hedefDizin)),
    devam: devam ? String(devam) : null,
    orkestrator: ork,
    kodYazma: yazma,
    efor: eforDeger,
    baslangic: Date.now(),
  };
  oturumBilgi.set(id, bilgi);
  // Kayıt kimliği yoksa: PTY açıldıktan sonra dizinde oluşan en yeni jsonl bu oturumun kaydıdır.
  if (!bilgi.devam) {
    let deneme = 0;
    const ara = setInterval(() => {
      if (!kabuklar.has(id) || deneme++ > 120) { clearInterval(ara); return; }
      const dosya = sohbet.oturumDosyasiBul({ dizin: hedefDizin, baslangicMs: bilgi.baslangic });
      if (!dosya) return;
      bilgi.devam = path.basename(dosya, '.jsonl');
      clearInterval(ara);
      if (remoteSunucu) remoteSunucu.oturumListesiGuncelle();
    }, 1500);
    if (ara.unref) ara.unref();
  }
  bu.onData((veri) => { bilgi.sonCikti = Date.now(); ptyTamponla(id, veri); });
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
  if (!pid) return;
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {}
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch {}
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
}

function kabukKapat(id) {
  const k = kabuklar.get(id);
  if (!k) return;
  agacOldur(k.pid);
  try { k.kill(); } catch {}
  ptyBosalt(id);
  ptyTampon.delete(id);
  kabuklar.delete(id);
  baglamIzleyiciler.delete(id);
  if (remoteSunucu) remoteSunucu.oturumKapandi(id, 0);
}
function tumunuKapat() { for (const id of [...kabuklar.keys()]) kabukKapat(id); }

// Bosta kalan oturumlar kendiliginden kapanir: bitmis ajan arkada MCP yigini tutmasin.
// Karari zamanlayici tek basina vermez; ajanin kendi kaydina (jsonl) ve surec agacina bakilir:
//   - son tur asistanin metin cevabiyla kapandi mi (arac cagrisi askida degil),
//   - agacta MCP disinda calisan bir arac/worker var mi,
//   - kullanici son [bostaKapatDk] dakikada hic yazmadi mi.
// Suresi ayarlardan gelir (bostaKapatDk, varsayilan 60 dk; 0 = kapali).
// Gecmis diskte durur, sekme ayni oturumla --resume edilebilir.
const MCP_COCUK = new Set(['node', 'python', 'pythonw', 'cmd', 'conhost',
  'duckduckgo-mcp-server', 'codebase-memory-mcp', 'chrome-devtools-mcp', 'uagents']);

function torunHaritasi(done) {
  const ps = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)/$($_.ParentProcessId)/$($_.Name)" }';
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
    { windowsHide: true, timeout: 10000 }, (hata, cikti) => {
      if (hata) return done(null);
      const ebeveyn = new Map();
      for (const satir of String(cikti).split(/\r?\n/)) {
        const p = satir.trim().split('/');
        if (p.length < 3) continue;
        const [kimlik, par, ad] = p;
        const k = Number(par);
        if (!ebeveyn.has(k)) ebeveyn.set(k, []);
        ebeveyn.get(k).push({ id: Number(kimlik), ad: ad.replace(/\.exe$/i, '').toLowerCase() });
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
      if (!MCP_COCUK.has(c.ad)) return true;   // bash, worker, git…: oturum calisiyor
      yigin.push(c.id);
    }
  }
  return false;
}

const bostaKontrol = setInterval(() => {
  const dk = Number(ayarOku().bostaKapatDk ?? 60);
  if (!Number.isFinite(dk) || dk <= 0) return;
  const sinir = dk * 60000;
  const simdi = Date.now();
  const adaylar = [];
  for (const [id, bilgi] of oturumBilgi) {
    if (!kabuklar.has(id)) continue;
    const son = Math.max(bilgi.sonCikti || 0, bilgi.sonGirdi || 0, bilgi.baslangic || 0);
    if (simdi - son < sinir) continue;
    let dosya = null;
    try {
      dosya = bilgi.devam
        ? sohbet.dosyaYolu(bilgi.dizin, bilgi.devam)
        : sohbet.oturumDosyasiBul({ dizin: bilgi.dizin, baslangicMs: bilgi.baslangic });
    } catch {}
    if (!dosya || sohbet.oturumDurumu(dosya) !== 'bitti') continue;  // calisiyor/bilinmiyor: dokunma
    adaylar.push(id);
  }
  if (!adaylar.length) return;
  torunHaritasi((ebeveyn) => {
    if (!ebeveyn) return;   // agac okunamadiysa temkinli davran
    for (const id of adaylar) {
      const k = kabuklar.get(id);
      if (!k || !kabuklar.has(id)) continue;
      if (agactaCalismaVar(ebeveyn, k.pid)) continue;
      kabukKapat(id);
      if (pencere && !pencere.isDestroyed()) pencere.webContents.send('pty:cikis', id, { kod: 0, bosta: true });
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
  if (argv.includes('--ekran-proje-duzenle')) sorgu.projeDuzenle = '1'; // test: proje düzenleme modalı
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
function remoteSunucuBaslat() {
  remoteSunucu = new RemoteSunucu({
    veriDizini: app.getPath('userData'), // kumanda.json (token, port, IP) burada kalıcı tutulur
    onPtyYaz: (id, veri) => {
      const k = kabuklar.get(id);
      const b = oturumBilgi.get(id);
      if (b) b.sonGirdi = Date.now();
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
          orkestrator: !!b.orkestrator,
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
// Uygulama baska bir yoldan kapanirsa da (menuden cikis, oturum sonu) tum surec agaclari kapansin.
app.on('before-quit', () => { tumunuKapat(); });


// ---- Proje özeti: commit ısı haritası, dil dağılımı, son commit (yalnız yerel git; ağ yok) ----
const { execFile, execFileSync } = require('node:child_process');
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
  // Kayıttaki model kimliği sağlayıcı önekli olabilir (deepseek/deepseek-v4.1-flash);
  // katalogdaki kimlikle eşleştirilir ki pencere (bağlam sınırı) doğru bulunsun.
  const hamModel = (d && d.model) || b.modelId;
  const liste = modelOnbellek || motor.MODELLER;
  const m = liste.find((x) => x.id === hamModel)
    || liste.find((x) => hamModel.endsWith('/' + x.id) || x.id.endsWith('/' + hamModel))
    || liste.find((x) => x.id === b.modelId) || null;
  const modelId = (m && m.id) || hamModel;
  return {
    token: d ? d.token : null,
    cikti: d ? d.cikti : null,
    yanit: d ? d.yanit : null,
    model: modelId,
    ad: (m && m.ad) || b.modelAd || modelId,
    pencere: (m && m.baglamSayisi) || null,
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
async function onizlemeOku(yol, mtime) {
  const k = onizlemeOnbellek.get(yol);
  if (k && k.mtime === mtime) return k.veri;
  try {
    let img = nativeImage.createFromPath(yol);
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    if (!width || !height) return null;
    const olcek = Math.min(96 / width, 96 / height, 1);
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
  if (!iz) { iz = new sohbet.CiktiIzleyici(); ciktiIzleyiciler.set(dosya, iz); }
  const liste = iz.oku(dosya) || [];
  let resimSayisi = 0;
  // Küçük resim yalnız ilk birkaç görsel için ve aşırı büyük dosyalarda atlanır:
  // ana süreci uzun süre kilitlememek için sınırlı tutulur (sonrası dosya simgesiyle görünür).
  for (const c of liste) {
    if (!c.resim || resimSayisi >= 12) continue;
    if (c.boyut > 3 * 1024 * 1024) { c.onizleme = null; continue; }
    resimSayisi++;
    const veri = await onizlemeOku(c.yol, c.degisimMs);
    if (veri) c.onizleme = veri;
  }
  return { ciktilar: liste };
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
  if (b) b.sonGirdi = Date.now();
  if (k) { try { k.write(veri); } catch {} }
});
ipcMain.handle('boyut', (_e, id, { cols, rows }) => {
  const k = kabuklar.get(id);
  if (!k || !(cols > 0) || !(rows > 0)) return;
  try { k.resize(cols, rows); } catch {}
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
      if (!baslik && fs.existsSync(dosya)) baslik = (gecmis.baslikOku(dosya, true) || {}).baslik || '';
      if (baslik) sekmeAdiOnbellek.set(b.devam, baslik);
    } catch {}
  }
  return { devam: b.devam || null, orkestrator: !!b.orkestrator, kodYazma: b.kodYazma !== false, baslik: baslik || null };
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
