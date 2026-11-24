// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
// EVREN Desktop motoru: model kataloğu, git dalı, ayarlar ve işletim sistemi kasasıyla şifreli anahtar kasası.
// Ağ isteği yapmaz; yalnız yerel dosya ve kasa arka ucu (Windows DPAPI / macOS Keychain) kullanır.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

// EVREN_VERI_DIZINI: ayar ve kasa klasörünü değiştirir (demo / test için).
const VERI_DIZINI = process.env.EVREN_VERI_DIZINI || path.join(os.homedir(), '.evren-desktop');
const AYAR_DOSYASI = path.join(VERI_DIZINI, 'ayar.json');
const ANAHTAR_DOSYASI = path.join(VERI_DIZINI, 'evren.dpapi');
// win32 dışı platformlarda safeStorage (Keychain/libsecret) ile şifrelenen kasa dosyası.
const KASA_DOSYASI = path.join(VERI_DIZINI, 'evren.kasa');
// Önceki sürümlerin konumları: yalnız okunur (taşıma kolaylığı).
const ESKI_AYAR = path.join(os.homedir(), '.gunay-studio', 'evren-panel.json');
const ESKI_ANAHTAR = path.join(os.homedir(), '.gunay-studio', 'kasa', 'evren.dpapi');

// ---- Model kataloğu ----
// Bilinen modellerin görünen adı ve kısa notu; bağlam ve çıktı sınırı canlı API'den gelir.
const MODEL_BILGISI = {
  'deepseek-v4.1-flash': { ad: 'DeepSeek V4.1 Flash', not: 'rutin kod + uzun iş' },
  'glm-5.3': { ad: 'GLM-5.3', not: 'çetrefilli arayüz / mantık' },
  'qwen3.8-flash-next': { ad: 'Qwen 3.8 Flash Next', not: 'hafif ve hızlı metin' },
  'gemma-4-31b': { ad: 'Gemma 4 31B', not: 'görsel + düşünme' },
  'qwen3-vl-30b': { ad: 'Qwen3 VL 30B', not: 'görsel okuma' },
};
const MODEL_SIRASI = Object.keys(MODEL_BILGISI);

// ---- Efor (düşünme derinliği) ----
// Claude Code'un --effort bayrağıyla birebir aynı beş seviye. Oturum başında seçilir;
// kayıtlı son seçim yeni oturumun varsayılanı olur.
const EFORLAR = [
  { id: 'low', ad: 'Düşük', not: 'Hızlı yanıt, az düşünme' },
  { id: 'medium', ad: 'Orta', not: 'Dengeli varsayılan' },
  { id: 'high', ad: 'Yüksek', not: 'Daha derin düşünme' },
  { id: 'xhigh', ad: 'Çok yüksek', not: 'Zor işler için çok derin' },
  { id: 'max', ad: 'Azami', not: 'En derin düşünme, en yavaş' },
];
const EFOR_VARSAYILAN = 'medium';
const eforCoz = (deger) => (EFORLAR.some((e) => e.id === deger) ? deger : EFOR_VARSAYILAN);

const baglamMetni = (n) => (!n || !Number.isFinite(n) ? '—' : n >= 1048576 ? `${Math.round(n / 1048576)}M bağlam` : `${Math.round(n / 1024)}K bağlam`);

// API'ye ulaşılamazsa gösterilen yedek liste (son doğrulanmış bağlam değerleri).
const MODELLER = [
  ['deepseek-v4.1-flash', 1048576], ['glm-5.3', 524288], ['qwen3.8-flash-next', 262144],
].map(([id, n], i) => ({ no: i + 1, id, ...MODEL_BILGISI[id], baglam: baglamMetni(n), baglamSayisi: n, cikti: null, canli: false }));

// Canlı /v1/models yanıtından sohbet modellerini seçer; bilinenler önce, diğerleri bağlama göre.
function modelleriCoz(veri) {
  const liste = Array.isArray(veri) ? veri : (veri && (veri.data || veri.models)) || [];
  const sohbet = liste.filter((m) => m && typeof m.id === 'string' && (m.task === 'chat' || m.task === 'vision_chat') && m.id !== 'auto');
  const bilinen = MODEL_SIRASI.map((id) => sohbet.find((m) => m.id === id)).filter(Boolean);
  const diger = sohbet.filter((m) => !MODEL_SIRASI.includes(m.id)).sort((a, b) => (b.context_length || 0) - (a.context_length || 0));
  return [...bilinen, ...diger].map((m, i) => ({
    no: i + 1,
    id: m.id,
    ad: (MODEL_BILGISI[m.id] && MODEL_BILGISI[m.id].ad) || m.id,
    not: (MODEL_BILGISI[m.id] && MODEL_BILGISI[m.id].not) || (m.capabilities && m.capabilities.vision ? 'görsel' : 'sohbet'),
    baglam: baglamMetni(m.context_length),
    baglamSayisi: Number.isFinite(m.context_length) ? m.context_length : null,
    cikti: Number.isFinite(m.default_max_output_tokens) ? m.default_max_output_tokens : null,
    canli: true,
  }));
}

// Sohbet kaydındaki model kimliğini katalog kimliğine çevirir. Kayıt, vekilin döndürdüğü
// adı yazar: sağlayıcı öneki ve donanım sürümü eki taşır ("zai/glm-5.3-fp8",
// "deepseek/deepseek-v4.1-flash"). düz ("glm-5.3") veya kısa ("glm-5.3-fp8") hâliyle eşleştirilir.
function modelKatalogId(ham, liste) {
  if (!ham || !Array.isArray(liste) || !liste.length) return null;
  const s = String(ham).toLowerCase().trim();
  const kisa = s.includes('/') ? s.slice(s.lastIndexOf('/') + 1) : s;
  if (!kisa || kisa === '<synthetic>') return null;
  const id = (x) => String((x && x.id) || '').toLowerCase();
  const bul = (es) => { const m = liste.find((x) => id(x) && es(id(x))); return (m && m.id) || null; };
  return bul((i) => i === s || i === kisa)
    || bul((i) => kisa.startsWith(i + '-') || kisa.startsWith(i + '.') || i.startsWith(kisa + '-'))
    || bul((i) => kisa.includes(i));
}

// Güvenli auto-compact penceresi: API "istem + çıktı tavanı ≤ bağlam penceresi" şartını
// arar (aşarsa 400 döner), Claude Code ise pencereyi tam dolduracak kadar büyümeye izin
// verip geç sıkıştırıyor. Çıktı tavanı + pay kadar erken tetiklenen pencere taşmayı
// kökten engeller (glm 512K→442K, qwen 256K→180K, deepseek 1M→966K).
// Claude Code değeri 100K–1M dışına kenetler (99 999 → 100k, ölçüldü): güvenli pencere
// 100K altına düşüyorsa değer yazılmaz; küçük pencereli modelleri vekil kurtarması korur.
const CIKTI_TAVANI_VARSAYILAN = 65536;
const AUTOCOMPACT_PAY = 16384;
const AUTOCOMPACT_ALT_SINIR = 100000;
function autocompactPenceresi(baglamSayisi, cikti) {
  const pencere = Number(baglamSayisi);
  if (!Number.isFinite(pencere) || pencere <= 0) return null;
  const tavan = pencere - (Number(cikti) > 0 ? Number(cikti) : CIKTI_TAVANI_VARSAYILAN) - AUTOCOMPACT_PAY;
  return tavan >= AUTOCOMPACT_ALT_SINIR ? tavan : null;
}

// Kullanıcının Claude Code ayarındaki model başı sıkıştırma eşiği
// (~/.claude/settings.json → modelSettings[model].autoCompactWindow). Bu değer modele göre
// seçilmiş "tatlı eşik"tir (ör. büyük bağlamda yavaşlayan model için daha erken sıkıştırma);
// güvenli pencereyi aşmıyorsa o kazanır. Env yalnız ayarda değer yoksa verilir, çünkü env
// hem ayardaki eşiği ezer hem de /model ile model değişince eski modelin değerinde kalır.
function claudeAyarYolu() {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
}
function kullaniciEsigi(modelId, yol = claudeAyarYolu()) {
  if (!modelId) return null;
  try {
    const ms = JSON.parse(fs.readFileSync(yol, 'utf8')).modelSettings || {};
    const v = ms[modelId] && ms[modelId].autoCompactWindow;
    return Number.isFinite(v) && v >= AUTOCOMPACT_ALT_SINIR ? v : null;
  } catch { return null; }
}
// Oturumun gerçek sıkıştırma eşiği: ayardaki eşik güvenli pencereyi aşmıyorsa o, yoksa güvenli pencere.
function sikistirmaEsigi(modelId, baglamSayisi, cikti, yol) {
  const guvenli = autocompactPenceresi(baglamSayisi, cikti);
  const kullanici = kullaniciEsigi(modelId, yol);
  if (kullanici != null && (guvenli == null || kullanici <= guvenli)) return kullanici;
  return guvenli;
}
// Oturum açılırken env'e yazılacak değer: ayardaki eşik geçerliyse null (Claude Code ayarı okur).
function sikistirmaEnvDegeri(modelId, baglamSayisi, cikti, yol) {
  const esik = sikistirmaEsigi(modelId, baglamSayisi, cikti, yol);
  return esik != null && esik === kullaniciEsigi(modelId, yol) ? null : esik;
}

// ---- Git dalı (git çalıştırmadan, .git/HEAD okunarak; worktree destekli) ----
function gitDal(dizin) {
  try {
    const yol = path.join(dizin, '.git');
    let head = '';
    if (fs.existsSync(yol) && fs.statSync(yol).isDirectory()) head = fs.readFileSync(path.join(yol, 'HEAD'), 'utf8').trim();
    else if (fs.existsSync(yol)) {
      const isaret = fs.readFileSync(yol, 'utf8').match(/gitdir:\s*(.+)/);
      if (isaret) head = fs.readFileSync(path.join(path.resolve(dizin, isaret[1].trim()), 'HEAD'), 'utf8').trim();
    }
    if (!head) return '';
    const dal = head.match(/ref:\s*refs\/heads\/(.+)/);
    return dal ? dal[1].trim() : head.slice(0, 7);
  } catch { return ''; }
}

// ---- Atomik dosya yazma ----
// Windows'ta antivirüs / başka tutamaç rename'i geçici olarak reddedebilir (EPERM/EACCES/EBUSY).
// Kısa bekleyip yeniden dener; rename hiç olmuyorsa yerinde yazar. Geçici dosya hiç bırakılmaz.
const YENIDEN_KOD = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_BEKLE_MS = [50, 100, 150, 200];
let yazmaSira = 0;

function kisaBekleSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const bitis = Date.now() + ms;
    while (Date.now() < bitis) {}
  }
}

function atomikJsonYazSync(dosya, veriMetni) {
  const dir = path.dirname(dosya);
  fs.mkdirSync(dir, { recursive: true });
  const gecici = `${dosya}.${process.pid}.${++yazmaSira}.tmp`;
  fs.writeFileSync(gecici, veriMetni, 'utf8');
  let sonHata = null;
  for (let i = 0; i <= RENAME_BEKLE_MS.length; i++) {
    try {
      fs.renameSync(gecici, dosya);
      return true;
    } catch (e) {
      sonHata = e;
      if (!e || !YENIDEN_KOD.has(e.code) || i === RENAME_BEKLE_MS.length) break;
      kisaBekleSync(RENAME_BEKLE_MS[i]);
    }
  }
  // AV rename'i kilitlediyse yerinde yaz; geçici dosyayı temizle.
  try {
    fs.writeFileSync(dosya, veriMetni, 'utf8');
    try { fs.unlinkSync(gecici); } catch {}
    return true;
  } catch {
    try { fs.unlinkSync(gecici); } catch {}
    throw sonHata;
  }
}

// Bozuk dosyayı silmeden zaman damgalı yedek olarak sakla (kullanıcı verisi kaybolmasın).
// Aynı bozuk sürüm (dosya + mtime + boyut) yalnız bir kez yedeklenir: zamanlayıcıların
// (bostaKontrol, 60 sn) tekrarlayan okumaları çöp .bak dosyası yığmasın.
const bozukYedeklenen = new Set();
function bozukYedekle(dosya) {
  try {
    if (!fs.existsSync(dosya)) return;
    const st = fs.statSync(dosya);
    const anahtar = `${dosya}:${st.mtimeMs}:${st.size}`;
    if (bozukYedeklenen.has(anahtar)) return;
    fs.copyFileSync(dosya, `${dosya}.corrupt-${Date.now()}.bak`);
    bozukYedeklenen.add(anahtar);
  } catch {}
}

// ---- Ayarlar ----
// Dosya değişmediyse (mtime + boyut aynı) diskten yeniden okumadan önbellekten döner.
let ayarOnbellek = null; // { dosya, ms, boyut, veri }
function ayarOku() {
  const adaylar = process.env.EVREN_VERI_DIZINI ? [AYAR_DOSYASI] : [AYAR_DOSYASI, ESKI_AYAR];
  for (const f of adaylar) {
    let st;
    try { st = fs.statSync(f); } catch { continue; }
    if (ayarOnbellek && ayarOnbellek.dosya === f && ayarOnbellek.ms === st.mtimeMs && ayarOnbellek.boyut === st.size) {
      return { ...ayarOnbellek.veri };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        ayarOnbellek = { dosya: f, ms: st.mtimeMs, boyut: st.size, veri: parsed };
        return { ...parsed };
      }
      bozukYedekle(f);
    } catch {
      bozukYedekle(f);
    }
  }
  return {};
}
function ayarYaz(yeni) {
  const birlesik = { ...ayarOku(), ...yeni };
  try {
    atomikJsonYazSync(AYAR_DOSYASI, JSON.stringify(birlesik, null, 2));
    const st = fs.statSync(AYAR_DOSYASI);
    ayarOnbellek = { dosya: AYAR_DOSYASI, ms: st.mtimeMs, boyut: st.size, veri: birlesik };
  } catch {}
  return { ...birlesik };
}

// ---- Anahtar kasası: Windows DPAPI (yalnız bu Windows kullanıcısı çözebilir) ----
// Anahtar komut satırına hiç yazılmaz; PowerShell'e stdin ve ortam değişkeniyle geçer.
function powershell(betik, girdi, ortam) {
  return new Promise((coz, red) => {
    const c = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', betik],
      { encoding: 'utf8', windowsHide: true, timeout: 15000, env: { ...process.env, ...ortam } },
      (h, out) => (h ? red(h) : coz(String(out))));
    if (girdi != null) { c.stdin.write(girdi); }
    c.stdin.end();
  });
}

// win32 dışı kasa arka ucu: motor.js 'electron' require etmez (testler düz node --test ile
// koşar); main.js app hazır olunca Electron safeStorage'ı buraya enjekte eder.
// Arka uç yoksa anahtarOku '' döner, anahtarYaz anlaşılır hata atar.
let kasaArkaUcu = null;
function kasaKur(arkaUc) { kasaArkaUcu = arkaUc || null; }

// Saf: anahtarı arka uçla şifreleyip base64 metin olarak döndürür.
function kasaSifrele(arkaUc, anahtar) {
  const temiz = String(anahtar || '').replace(/[^\x21-\x7e]/g, '');
  if (!temiz) throw new Error('Boş anahtar.');
  if (!arkaUc || typeof arkaUc.encryptString !== 'function' ||
      (typeof arkaUc.isEncryptionAvailable === 'function' && !arkaUc.isEncryptionAvailable())) {
    throw new Error('Bu işletim sisteminde kasa desteklenmiyor.');
  }
  return Buffer.from(arkaUc.encryptString(temiz)).toString('base64');
}

// Saf: base64 kasa dosyası içeriğini arka uçla çözer; olmuyorsa '' döner.
function kasaCoz(arkaUc, icerik) {
  try {
    if (!arkaUc || typeof arkaUc.decryptString !== 'function') return '';
    return arkaUc.decryptString(Buffer.from(String(icerik || '').trim(), 'base64')) || '';
  } catch { return ''; }
}

// secenek (yalnız test için): anahtarDosyalari / kasaDosyasi yollarını geçersiz kılar.
async function anahtarOku(secenek = {}) {
  const anahtarDosyalari = Array.isArray(secenek.anahtarDosyalari) ? secenek.anahtarDosyalari : [ANAHTAR_DOSYASI, ESKI_ANAHTAR];
  const kasaDosyasi = secenek.kasaDosyasi || KASA_DOSYASI;
  if (process.platform !== 'win32') {
    // darwin/linux: evren.kasa dosyasını safeStorage arka ucuyla çöz; dosya yoksa '' döner.
    try { return kasaCoz(kasaArkaUcu, fs.readFileSync(kasaDosyasi, 'utf8')); } catch { return ''; }
  }
  // Hızlı yol: safeStorage (Windows'ta yerel DPAPI, süreç içi, <1 ms) ile şifrelenmiş kasa
  // dosyası varsa ve evren.dpapi'den daha yeni/eşitse PowerShell açmadan çöz. Yalnız bir
  // dpapi kaynağı (evren.dpapi ya da eski konum) varken kullanılır: kullanıcı anahtar
  // dosyasını silerek oturumu kapatmışsa kasa bayat anahtar serve etmez, '' döner.
  if (kasaArkaUcu && anahtarDosyalari.some((f) => fs.existsSync(f))) {
    try {
      if (fs.existsSync(kasaDosyasi)) {
        let taze = true;
        try {
          const kasaMs = fs.statSync(kasaDosyasi).mtimeMs;
          if (fs.existsSync(anahtarDosyalari[0])) taze = kasaMs >= fs.statSync(anahtarDosyalari[0]).mtimeMs;
        } catch { taze = true; }
        if (taze) {
          const hizli = kasaCoz(kasaArkaUcu, fs.readFileSync(kasaDosyasi, 'utf8')).trim();
          if (hizli) return hizli;
        }
      }
    } catch {}
  }
  const oku = '$s = ConvertTo-SecureString (Get-Content -LiteralPath $env:EVREN_KASA -Raw).Trim(); [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringUni([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)))';
  for (const f of anahtarDosyalari) {
    if (!fs.existsSync(f)) continue;
    try {
      const k = (await powershell(oku, null, { EVREN_KASA: f })).trim();
      if (k) {
        // Çözülen anahtarı kasa dosyasına da yansıt: sonraki açılışlar PowerShell açmasın.
        if (kasaArkaUcu) { try { atomikJsonYazSync(kasaDosyasi, kasaSifrele(kasaArkaUcu, k)); } catch {} }
        return k;
      }
    } catch {}
  }
  return '';
}

async function anahtarYaz(anahtar) {
  if (process.platform !== 'win32') {
    // darwin/linux: safeStorage (Keychain / libsecret) ile şifrele, base64 olarak yaz.
    const sifreli = kasaSifrele(kasaArkaUcu, anahtar);
    fs.mkdirSync(VERI_DIZINI, { recursive: true });
    fs.writeFileSync(KASA_DOSYASI, sifreli);
    return KASA_DOSYASI;
  }
  const temiz = String(anahtar || '').replace(/[^\x21-\x7e]/g, '');
  if (!temiz) throw new Error('Boş anahtar.');
  fs.mkdirSync(VERI_DIZINI, { recursive: true });
  const yaz = "$k = [Console]::In.ReadToEnd().Trim(); if (-not $k) { throw 'bos' }; ConvertTo-SecureString $k -AsPlainText -Force | ConvertFrom-SecureString | Set-Content -LiteralPath $env:EVREN_KASA -Encoding ascii";
  await powershell(yaz, temiz, { EVREN_KASA: ANAHTAR_DOSYASI });
  // evren.dpapi dış CLI araçlarıyla uyum için korunur; hızlı açılış için kasa dosyasına da yansıt.
  if (kasaArkaUcu) { try { atomikJsonYazSync(KASA_DOSYASI, kasaSifrele(kasaArkaUcu, temiz)); } catch {} }
  return ANAHTAR_DOSYASI;
}

// Kimlik istemi: her sekmenin sistem istemine eklenir. Oturum, uç model için yazılmış
// genel istem ve kural dosyalarıyla açılır; model bunları okuyup kendini Mimar sanmasın,
// "uç model kotası harcanır" diye işi bırakıp soru sormasın.
function kimlikIstemi(modelId, efor, sef = false) {
  const model = String(modelId || '').trim() || 'bilinmeyen model';
  const e = String(efor || '').trim() || 'bilinmiyor';
  const rol = sef ? 'EVREN Şef (Uygulama Şefi)' : 'EVREN worker (icracı)';
  return [
    `Kimliğin: ${model}, efor ${e}. EVREN API üzerinden çalışıyorsun; rolün ${rol}.`,
    'Sistem istemi ve kural dosyaları bu aracı başka bir model adıyla anıyor olabilir. O metinlerde Mimar/uç model için yazılanlar sana değil: sen Mimar değilsin, uç model değilsin.',
    'Harcadığın kota EVREN kotasıdır; "uç model kotası harcanır" diye işi bırakma, işi kendin yap (Şef isen worker\'a devret).',
    'Durum, rapor ve commit metninde modelini bu adla yaz.',
  ].join('\n');
}

module.exports = { MODELLER, modelleriCoz, modelKatalogId, autocompactPenceresi, kullaniciEsigi, sikistirmaEsigi, sikistirmaEnvDegeri,EFORLAR, EFOR_VARSAYILAN, eforCoz, kimlikIstemi, baglamMetni, gitDal, ayarOku, ayarYaz, atomikJsonYazSync, bozukYedekle, anahtarOku, anahtarYaz, kasaKur, kasaSifrele, kasaCoz, VERI_DIZINI };
