// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
// Claude Code oturum kayıtları (~/.claude/projects) okuyucu: başlık, kaynak, canlılık ve alt ajanlar.
// Electron'a bağlı değildir; `node -e "require('./gecmis').oturumGecmisi(...)"` ile doğrulanabilir.
'use strict';
const fs = require('node:fs');
const oturumKarar = require('./oturum-karar');
const os = require('node:os');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');

const OTURUM_KIMLIK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANLI_ESIK_MS = 90 * 1000; // son yazmadan bu yana bu kadar geçmediyse "çalışıyor"
const IS_AKISI_ADI = new Map(); // çalışma betiği yolu -> ad (küçük dosya; mtime değişince yenilenir)

function metinCikar(icerik) {
  if (typeof icerik === 'string') return icerik;
  if (Array.isArray(icerik)) return icerik.map((x) => (x && x.type === 'text' ? x.text : '')).join(' ');
  return '';
}

// İlk gerçek kullanıcı mesajı = oturum başlığı; ilk yanıtın modeli = kaynak (claude-* ise Claude, değilse EVREN).
// Başlık ve model bulununca sonuç önbelleğe alınır, dosya bir daha okunmaz.
const baslikOnbellek = new Map(); // id -> { bilgi, damga, ms, boyut }

function ozelBaslikOku(seansDizin) {
  try {
    const d = path.join(seansDizin, 'custom-title.json');
    const j = JSON.parse(fs.readFileSync(d, 'utf8'));
    return (j && typeof j.customTitle === 'string' && j.customTitle.trim()) || '';
  } catch { return ''; }
}

// custom-title.json'ın damgası: yeniden adlandırma (bizden ya da Claude Desktop'tan) önbelleği düşürsün.
function ozelBaslikDamgasi(seansDizin) {
  if (!seansDizin) return '';
  try {
    const s = fs.statSync(path.join(seansDizin, 'custom-title.json'));
    return `${s.mtimeMs}:${s.size}`;
  } catch { return ''; }
}

// Oturum adını Claude Code'un kendi dosyasına yazar (Claude Desktop `/rename` ile aynı biçim).
// Boş ad dosyayı siler: başlık yeniden ilk kullanıcı mesajından türetilir.
function ozelBaslikYaz(seansDizin, ad) {
  const temiz = String(ad || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const dosya = path.join(seansDizin, 'custom-title.json');
  if (!temiz) {
    try { fs.unlinkSync(dosya); } catch {}
    return '';
  }
  fs.mkdirSync(seansDizin, { recursive: true });
  fs.writeFileSync(dosya, JSON.stringify({ customTitle: temiz }));
  return temiz;
}

function baslikOnbellekTemizle(id) { baslikOnbellek.delete(id); }

// ---------- Kalıcı başlık önbelleği ----------
// Üst veri değişmediyse başlık yeniden okunmaz; uygulama açılışında 100 oturumun 6 MB'lık
// kafalarını taramak yerine diskten gelir. Kimlik anahtarı: dosya mtime + boyut + ad damgası.
// Test/demo (EVREN_PROJE_DIZINI) altında varsayılan olarak kapalıdır; gerçek ~/.claude taranmaz.
const KALICI_SURUM = 3; // 3: anlamlı başlık + kokUuid (ata kopyası ayrımı); eski önbellek okunmaz, yeniden dolar.
let kaliciOnbellek = null; // { id: { ms, boyut, damga, baslik, kaynak } }
let kaliciZaman = null;

function kaliciOnbellekYolu() {
  const verilen = process.env.EVREN_BASLIK_ONBELLEK;
  if (verilen === 'kapali') return '';
  if (verilen) return verilen;
  if (process.env.EVREN_PROJE_DIZINI) return ''; // test/demo: gerçek eve yazma
  return path.join(os.homedir(), '.evren', 'baslik-onbellek.json');
}

function kaliciOnbellekOku() {
  if (kaliciOnbellek) return kaliciOnbellek;
  kaliciOnbellek = {};
  const dosya = kaliciOnbellekYolu();
  if (!dosya) return kaliciOnbellek;
  try {
    const j = JSON.parse(fs.readFileSync(dosya, 'utf8'));
    if (j && j.v === KALICI_SURUM && j.kayitlar && typeof j.kayitlar === 'object') kaliciOnbellek = j.kayitlar;
  } catch {}
  return kaliciOnbellek;
}

function kaliciOnbellekYaz(id, kayit) {
  const dosya = kaliciOnbellekYolu();
  if (!dosya) return;
  const m = kaliciOnbellekOku();
  delete m[id];
  m[id] = kayit; // son kullanılan sona: sınır aşınca en eski düşer
  const adlar = Object.keys(m);
  if (adlar.length > 500) for (const a of adlar.slice(0, adlar.length - 500)) delete m[a];
  if (kaliciZaman) return;
  kaliciZaman = setTimeout(() => {
    kaliciZaman = null;
    try {
      const gecici = `${dosya}.tmp-${process.pid}`;
      fs.mkdirSync(path.dirname(dosya), { recursive: true });
      fs.writeFileSync(gecici, JSON.stringify({ v: KALICI_SURUM, kayitlar: m }));
      fs.renameSync(gecici, dosya);
    } catch {} // pano/disk hatası taramayı düşürmez
  }, 250);
  if (kaliciZaman.unref) kaliciZaman.unref();
}

// İlk gerçek kullanıcı mesajının uuid'si (kokUuid) `--resume` kopyalarında aynen taşınır:
// aynı sohbetin ana/çocuk kayıt dosyaları bu kimlikle tanınır (bkz. ataKopyalariniAyikla).
function baslikOku(dosya, yalnizBaslik, anlamli) {
  let fd, baslik = '', kaynak = '', kokUuid = '', ilk = '';
  try {
    fd = fs.openSync(dosya, 'r');
    const tampon = Buffer.alloc(512 * 1024);
    const kod = new StringDecoder('utf8');
    let konum = 0, kalan = '';
    // Açılış kayıtları büyük olabilir (ilk yanıt yüzlerce KB sonra gelir): parça parça oku, en çok 6 MB.
    // yalnizBaslik: sekme adı için yalnız ilk kullanıcı mesajı yeter; yanıt modelini beklemeden dön.
    while (konum < 6 * 1024 * 1024 && !(baslik && (yalnizBaslik || kaynak))) {
      const n = fs.readSync(fd, tampon, 0, tampon.length, konum);
      if (n <= 0) break;
      konum += n;
      const satirlar = (kalan + kod.write(tampon.subarray(0, n))).split('\n');
      kalan = satirlar.pop(); // yarım satır bir sonraki parçayla tamamlanır
      for (const satir of satirlar) {
        let j; try { j = JSON.parse(satir); } catch { continue; }
        if (!j || !j.message) continue;
        if (j.type === 'user' && !j.isMeta) {
          // Etiket artıkları başlık olmaz: önce eşli bloklar (task-notification, command-name…), sonra tek başına
          // kalan etiket parçaları (</task-notification>) silinir; geriye harf/dijital bir şey kalmazsa mesaj
          // atlanır, başlık sonraki kullanıcı mesajından gelir.
          const m = metinCikar(j.message.content).replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ').replace(/<\/?[a-z][^>]*>/gi, ' ').replace(/\s+/g, ' ').trim();
          if (m && !ilk && !m.startsWith('Caveat:') && !m.startsWith('[Request interrupted')) ilk = m.slice(0, 90);
          if (!kokUuid && m && typeof j.uuid === 'string') kokUuid = j.uuid;
          if (!baslik && m && !m.startsWith('Caveat:') && !m.startsWith('[Request interrupted') && !(anlamli && oturumKarar.baslikAnlamsiz(m))) baslik = m.slice(0, 90);
        } else if (!kaynak && j.type === 'assistant' && typeof j.message.model === 'string' && j.message.model !== '<synthetic>') {
          kaynak = /^(claude|opus|sonnet|haiku)/i.test(j.message.model) ? 'claude' : 'evren';
        }
        if (baslik && (yalnizBaslik || kaynak)) break;
      }
    }
  } catch {} finally { if (fd != null) try { fs.closeSync(fd); } catch {} }
  // Anlamlı mesaj yoksa ilk gerçek mesaj yedektir: "devam"la başlayan oturum başlıksız kalıp listeden düşmesin.
  return { baslik: baslik || ilk, kaynak, kokUuid };
}

// Ajanların aralarda attığı yoklama/deneme oturumları ("echo test", "node -v", "--yardim"): kısa, komut/bayrak biçimli başlık,
// alt ajanı yok ve çalışmıyor. Gerçek iş sayılmaz, listede görünmez.
const DENEME_BASLIK = /^(echo(\s|$)|node\s+(-v|--version)|npm\s+(-v|--version)|git\s+(--version|status$)|--?[a-z][\w-]*$|test$|ping$|deneme$|hello$|hi$|selam$|merhaba$)/i;
function denemeOturumu(baslik, boyut, altAjanSayisi, canli) {
  // EVREN ajan köprüsü isteğin sonuna ' Kural: ...' eki getirir; karşılaştırma yalnız asıl isteğe bakar.
  const asil = baslik.replace(/\s+Kural:[\s\S]*$/, '').trim();
  return !canli && !altAjanSayisi && asil.length <= 40 && DENEME_BASLIK.test(asil);
}

function oturumBilgisi(dosya, id, seansDizin, olcu) {
  // Damga önbellekten önce okunur: ad dosyası değiştiyse (yerel ya da dış `/rename`) başlık yeniden çözülür.
  const damga = ozelBaslikDamgasi(seansDizin);
  let ms = olcu && olcu.ms, boyut = olcu && olcu.boyut;
  if (ms == null || boyut == null) {
    try { const s = fs.statSync(dosya); ms = s.mtimeMs; boyut = s.size; } catch { ms = 0; boyut = 0; }
  }
  const c = baslikOnbellek.get(id);
  if (c && c.damga === damga && c.ms === ms && c.boyut === boyut) return c.bilgi;
  const disk = kaliciOnbellekOku()[id];
  if (disk && disk.damga === damga && disk.ms === ms && disk.boyut === boyut && disk.baslik && disk.kaynak) {
    const b = { baslik: disk.baslik, kaynak: disk.kaynak, kokUuid: disk.kokUuid || '' };
    baslikOnbellek.set(id, { bilgi: b, damga, ms, boyut });
    return b;
  }
  const ozel = seansDizin ? ozelBaslikOku(seansDizin) : '';
  // Anlamlı başlık: "devam", "tamam" gibi tek sözcükler kart adı olmaz; ilk gerçek istek taranır.
  const b = baslikOku(dosya, false, true);
  if (ozel) b.baslik = ozel;
  if (b.baslik && b.kaynak) {
    baslikOnbellek.set(id, { bilgi: b, damga, ms, boyut });
    kaliciOnbellekYaz(id, { ms, boyut, damga, baslik: b.baslik, kaynak: b.kaynak, kokUuid: b.kokUuid || '' });
  }
  return b;
}

// "Çalışıyor" yalnız kayıt yeni yazılmışsa VE son giriş yanıt beklenen bir giriş ise (kullanıcı mesajı, araç sonucu ya da
// tamamlanmamış asistan yanıtı). Asistan turu bitirdiyse (end_turn) oturum boştadır: sekme açık olsa da çalışmıyordur.
function turDevamEdiyor(dosya, boyut) {
  let fd;
  try {
    fd = fs.openSync(dosya, 'r');
    const uzunluk = Math.min(boyut, 128 * 1024);
    const t = Buffer.alloc(uzunluk);
    fs.readSync(fd, t, 0, uzunluk, boyut - uzunluk);
    const satirlar = t.toString('utf8').split('\n');
    if (boyut > uzunluk) satirlar.shift(); // baştaki yarım satır
    for (let i = satirlar.length - 1; i >= 0; i--) {
      let j; try { j = JSON.parse(satirlar[i]); } catch { continue; }
      if (!j || (j.type !== 'user' && j.type !== 'assistant') || !j.message) continue;
      if (j.type === 'user') return true;
      return !['end_turn', 'stop_sequence', 'max_tokens', 'refusal'].includes(j.message.stop_reason);
    }
  } catch {} finally { if (fd != null) try { fs.closeSync(fd); } catch {} }
  return null; // anlaşılamadı
}

// Sol panelin tek durum etiketi: ajan cevap bekleyen bir soru sordu mu, iş bitti mi?
// Dosyanın son 256 KB'ı tek geçişte taranır; sonuç (ms, boyut) damgasıyla önbelleklenir.
const durumOnbellek = new Map(); // id -> { ms, boyut, durum }
function sonDurumOku(dosya, boyut, id, ms) {
  try {
    if (id) {
      const c = durumOnbellek.get(id);
      if (c && c.ms === ms && c.boyut === boyut) return c.durum;
    }
    let durum = '';
    let fd;
    try {
      fd = fs.openSync(dosya, 'r');
      const uzunluk = Math.min(boyut, 256 * 1024);
      const t = Buffer.alloc(uzunluk);
      fs.readSync(fd, t, 0, uzunluk, boyut - uzunluk);
      const satirlar = t.toString('utf8').split(String.fromCharCode(10));
      if (boyut > uzunluk) satirlar.shift(); // baştaki yarım satır
      let sonTip = '', sonBitti = false, bekleyen = new Set();
      for (const satir of satirlar) {
        let j; try { j = JSON.parse(satir); } catch { continue; }
        if (!j || j.isMeta === true || j.isSidechain === true) continue; // hook/meta ve alt ajan kayıtları tur sayılmaz
        if ((j.type !== 'user' && j.type !== 'assistant') || !j.message) continue;
        const icerik = Array.isArray(j.message.content) ? j.message.content : [];
        if (j.type === 'assistant') {
          sonTip = 'assistant';
          sonBitti = ['end_turn', 'stop_sequence', 'max_tokens', 'refusal'].includes(j.message.stop_reason);
          bekleyen = new Set(icerik.filter((b) => b && b.type === 'tool_use' && ['AskUserQuestion', 'AskUserInput', 'Question'].includes(b.name)).map((b) => b.id));
        } else {
          sonTip = 'user';
          sonBitti = false;
          const sonuclar = icerik.filter((b) => b && b.type === 'tool_result');
          for (const b of sonuclar) bekleyen.delete(b.tool_use_id);
          if (!sonuclar.length) bekleyen.clear(); // kullanıcı yeni tur başlattı
        }
      }
      if (sonTip === 'assistant' && bekleyen.size > 0) durum = 'soru';
      else if (sonTip === 'assistant' && sonBitti) durum = 'bitti';
    } finally { if (fd != null) try { fs.closeSync(fd); } catch {} }
    if (id) durumOnbellek.set(id, { ms, boyut, durum });
    return durum;
  } catch { return ''; } // okunamayan dosya durum etiketi üretmez
}

// Workflow ajan klasörünün görünen adı: <oturum>/workflows/wf_x.json içindeki betiğin meta.name alanı.
function isAkisiAdi(seansDizin, klasor) {
  const betik = path.join(seansDizin, 'workflows', klasor + '.json');
  try {
    const s = fs.statSync(betik);
    const c = IS_AKISI_ADI.get(betik);
    if (c && c.ms === s.mtimeMs) return c.ad;
    const j = JSON.parse(fs.readFileSync(betik, 'utf8'));
    const m = typeof j.script === 'string' ? j.script.match(/name\s*:\s*['"]([^'"]+)['"]/) : null;
    const ad = m ? m[1] : '';
    IS_AKISI_ADI.set(betik, { ms: s.mtimeMs, ad });
    return ad;
  } catch { return ''; }
}

// Tek bir alt ajan kaydı: meta.json + agent-<id>.jsonl. Durum meta mtime'ına DEĞİL jsonl'in son yazmasına bakar
// (meta başta bir kez yazılır; mtime'ı tur bitince tazelenmez).
function ajanOku(dizin, metaAd, simdi, ek) {
  const metaYolu = path.join(dizin, metaAd);
  let ms0, j;
  try { ms0 = fs.statSync(metaYolu).mtimeMs; j = JSON.parse(fs.readFileSync(metaYolu, 'utf8')); } catch { return null; }
  if (!j || !j.description) return null;
  const id = metaAd.replace(/\.meta\.json$/, '');
  const jsonlYolu = path.join(dizin, id + '.jsonl');
  let jsonl = null;
  try { jsonl = fs.statSync(jsonlYolu); } catch {}
  const ms = jsonl ? jsonl.mtimeMs : ms0;
  const taze = simdi - ms < CANLI_ESIK_MS;
  const canli = j.finished !== true && !!jsonl && taze && turDevamEdiyor(jsonlYolu, jsonl.size) !== false;
  return {
    id,
    tanim: j.description,
    tur: (j.agentType || '').replace(/^[a-z0-9-]+:/i, ''), // plugin öneki (ad:) varsa kırp
    model: j.pickedEffortModel || j.model || '',
    faz: j.workflowPhase || '',
    bitti: !canli,
    canli,
    ms,
    ...ek,
  };
}

function metaDosyalariOku(dizin, simdi) {
  let adlar;
  try { adlar = fs.readdirSync(dizin); } catch { return []; }
  const liste = [];
  for (const a of adlar) {
    if (!a.endsWith('.meta.json')) continue;
    const x = ajanOku(dizin, a, simdi, {});
    if (x) liste.push(x);
  }
  return liste;
}

// Alt ajanlar: <oturum>/subagents/agent-*.meta.json (doğrudan ajanlar) ve
// <oturum>/subagents/workflows/wf_*/agent-*.meta.json (iş akışı ajanları; faz bilgisiyle).
function altAjanlariOku(seansDizin) {
  const simdi = Date.now();
  const subDizin = path.join(seansDizin, 'subagents');
  const ajanlar = metaDosyalariOku(subDizin, simdi);

  let klasorler;
  try { klasorler = fs.readdirSync(path.join(subDizin, 'workflows'), { withFileTypes: true }); } catch { klasorler = []; }
  for (const k of klasorler) {
    if (!k.isDirectory() || !k.name.startsWith('wf_')) continue;
    const wfDizin = path.join(subDizin, 'workflows', k.name);
    const ad = isAkisiAdi(seansDizin, k.name);
    for (const a of metaDosyalariOku(wfDizin, simdi)) {
      ajanlar.push({ ...a, isAkisi: k.name, isAkisiAdi: ad });
    }
  }
  return ajanlar.sort((a, b) => a.ms - b.ms);
}

// ---------- EVREN işleri (~/.evren/oturumlar/<uuid>.json) ----------
// evren-ajan.mjs her çalıştırmada bir kayıt yazar: { id, ust, dizin, model, baslik, baslangic, bitis, cikis, devamEden }.
// Kayıt yolu ortam değişkeni ya da parametreyle değiştirilebilir (test ve taşınabilirlik).
// Claude Code kayıt kökü; test/demo için EVREN_PROJE_DIZINI ile değiştirilebilir.
function claudeKokDizini() {
  return process.env.EVREN_PROJE_DIZINI || path.join(os.homedir(), '.claude', 'projects');
}

function evrenKayitDizini(secenekler) {
  const verilen = secenekler && typeof secenekler.kayitDizini === 'string' && secenekler.kayitDizini;
  return verilen || process.env.EVREN_KAYIT_DIZINI || path.join(os.homedir(), '.evren', 'oturumlar');
}

function evrenKayitlariOku(kayitDizini) {
  let adlar;
  try { adlar = fs.readdirSync(kayitDizini); } catch { return []; } // klasör yoksa sessizce boş
  const liste = [];
  for (const a of adlar) {
    if (!a.endsWith('.json')) continue;
    const dosya = path.join(kayitDizini, a);
    try {
      const j = JSON.parse(fs.readFileSync(dosya, 'utf8'));
      if (!j || typeof j !== 'object') continue;
      const id = String(j.id || a.slice(0, -5));
      if (!OTURUM_KIMLIK.test(id)) continue;
      liste.push({ ...j, id, kayitDosyasi: dosya });
    } catch {} // bozuk/yarım yazılmış kayıt listeyi düşürmez
  }
  return liste;
}

// Kayıt bu projeye ait mi: Claude oturum dosyası bu projenin klasöründe varsa ya da kaydın dizini bu projeyle eşleşiyorsa.
function evrenKaydiBuProjede(kayit, klasor, klasorAdi) {
  try { fs.statSync(path.join(klasor, kayit.id + '.jsonl')); return true; } catch {}
  return typeof kayit.dizin === 'string' &&
    kayit.dizin.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() === klasorAdi.toLowerCase();
}

// Durum: bitis varsa bitti/hata; bitis yoksa jsonl'in son yazması taze ve tur sürüyorsa çalışıyor, aksi halde kesildi.
function evrenDurumu(kayit, jsonl, kayitMs, simdi) {
  if (kayit.bitis != null) return Number(kayit.cikis) !== 0 && kayit.cikis != null ? 'hata' : 'bitti';
  const ms = jsonl ? jsonl.mtimeMs : kayitMs;
  const taze = simdi - ms < CANLI_ESIK_MS;
  if (!taze) return 'kesildi';
  if (!jsonl) return 'calisiyor'; // henüz kayıt dosyası yok, iş yeni başlamış
  const jsonlYolu = jsonl.yol;
  return turDevamEdiyor(jsonlYolu, jsonl.size) === false ? 'kesildi' : 'calisiyor';
}

function evrenIsiOku(kayit, klasor, simdi) {
  let jsonl = null, kayitMs = 0;
  try { const s = fs.statSync(path.join(klasor, kayit.id + '.jsonl')); jsonl = { yol: path.join(klasor, kayit.id + '.jsonl'), mtimeMs: s.mtimeMs, size: s.size }; } catch {}
  try { kayitMs = fs.statSync(kayit.kayitDosyasi).mtimeMs; } catch {}
  const durum = evrenDurumu(kayit, jsonl, kayitMs, simdi);
  const baslikKayit = typeof kayit.baslik === 'string' ? kayit.baslik.trim() : '';
  const baslik = baslikKayit || (jsonl ? baslikOku(jsonl.yol, false, true).baslik : '') || 'EVREN işi';
  return {
    id: kayit.id,
    baslik,
    model: typeof kayit.model === 'string' ? kayit.model : '',
    dizin: typeof kayit.dizin === 'string' ? kayit.dizin : '',
    durum,
    ms: (kayit.bitis != null && Number(kayit.bitis)) || (jsonl && jsonl.mtimeMs) || Number(kayit.baslangic) || 0,
    canli: durum === 'calisiyor',
    ...(kayit.ust ? { ust: String(kayit.ust) } : {}),
  };
}

// `claude --resume` aynı sohbeti YENİ kimlikli bir dosyaya kopyalar: ilk kullanıcı mesajının uuid'si
// (kokUuid) kopyaya aynen taşınır. Ölü ata kopya listede bir daha görünmez; zincirin en son DOĞAN
// dosyası sohbetin devamıdır. Ataya bağlı alt ajanlar en yeni kopyaya taşınır, EVREN işleri devir
// haritasıyla bağlanır — böylece her yeniden açılışta "ikinci kart" oluşmaz.
// Bir kopya yalnız ŞU KOŞULLA gizlenir: kendi canlı değil, ondan sonra doğan bir kopya var ve o kopya
// en az ata kadar içerik taşıyor. Yaşayan dallar ve ata içeriğini tam taşımayan uçlar asla gizlenmez;
// hiçbir sohbet kaybolmaz.
function ataKopyalariniAyikla(oturumlar) {
  const yas = (o) => o.dogumMs || o.ms || 0;
  const uc = new Map(); // kokUuid -> en son doğan kopya
  for (const o of oturumlar) {
    if (!o.kokUuid) continue;
    const e = uc.get(o.kokUuid);
    if (!e || yas(o) > yas(e)) uc.set(o.kokUuid, o);
  }
  const devir = new Map(); // gizlenen atanın kimliği -> en yeni kopyanın kaydı
  const kalan = [];
  for (const o of oturumlar) {
    const u = o.kokUuid ? uc.get(o.kokUuid) : null;
    const ucYeterli = u && (u.boyut || 0) >= (o.boyut || 0);
    if (u && u !== o && !o.canli && yas(u) >= yas(o) && ucYeterli) {
      devir.set(o.id, u);
      // Şeflik ve sabitleme ata kimliğine yazılmış olabilir: uç kopyaya devredilir, kart kimliğini kaybetmez.
      u.atalar = u.atalar || [];
      if (!u.atalar.includes(o.id)) u.atalar.push(o.id);
      for (const e of o.atalar || []) if (!u.atalar.includes(e)) u.atalar.push(e);
      // Alt ajan klasörü oturum kimliğine bağlıdır; kopyaya devrederken ata klasöründeki ajanlar kaybolmasın.
      u.altAjanlar = u.altAjanlar || [];
      for (const a of o.altAjanlar || []) if (!u.altAjanlar.some((x) => x.id === a.id)) u.altAjanlar.push(a);
      u.altAjanlar.sort((x, y) => x.ms - y.ms);
      u.calisanAjan = (u.altAjanlar || []).filter((a) => a.canli).length;
      u.ajanCalisiyor = u.calisanAjan > 0;
      u.canli = !!(u.turCanli || u.calisanAjan > 0);
    } else kalan.push(o);
  }
  return { kalan, devir };
}

function oturumGecmisi(dizin, secenekler) {
  if (!dizin || typeof dizin !== 'string') return [];
  const klasorAdi = dizin.replace(/[^a-zA-Z0-9]/g, '-');
  const klasor = path.join(claudeKokDizini(), klasorAdi);
  let adlar;
  try { adlar = fs.readdirSync(klasor); } catch { return []; }
  const simdi = Date.now();

  // EVREN kayıtları: id'si bu projenin Claude kayıtlarında olan oturumlar üst düzeyden çıkarılıp iş sahibine bağlanır.
  const evrenKayitlari = evrenKayitlariOku(evrenKayitDizini(secenekler))
    .filter((k) => evrenKaydiBuProjede(k, klasor, klasorAdi));
  const isKimlikleri = new Set(evrenKayitlari.map((k) => k.id));

  const oturumlar = adlar
    .filter((a) => a.endsWith('.jsonl') && OTURUM_KIMLIK.test(a.slice(0, -6)))
    .map((a) => { const d = path.join(klasor, a); try { const s = fs.statSync(d); return { id: a.slice(0, -6), dosya: d, ms: s.mtimeMs, boyut: s.size, dogumMs: s.birthtimeMs || s.ctimeMs || s.mtimeMs }; } catch { return null; } })
    .filter((x) => x && x.boyut > 0)
    .sort((a, b) => b.ms - a.ms)
    .filter((x) => !isKimlikleri.has(x.id)) // EVREN işinin kendi Claude kaydı ayrı satır olmaz
    .map((x) => {
      const seansDizin = path.join(klasor, x.id);
      const taze = simdi - x.ms < CANLI_ESIK_MS;
      const turCanli = taze && turDevamEdiyor(x.dosya, x.boyut) !== false;
      const altAjanlar = altAjanlariOku(seansDizin);
      const calisanAjan = altAjanlar.filter((a) => a.canli).length;
      return {
        id: x.id,
        ...oturumBilgisi(x.dosya, x.id, seansDizin, { ms: x.ms, boyut: x.boyut }),
        ms: x.ms,
        boyut: x.boyut,
        dogumMs: x.dogumMs,
        turCanli,
        ajanCalisiyor: calisanAjan > 0,
        calisanAjan,
        canli: turCanli || calisanAjan > 0, // tur bitse de arka planda çalışan alt ajan/EVREN işi oturumu "çalışıyor" gösterir
        sonDurum: sonDurumOku(x.dosya, x.boyut, x.id, x.ms),
        altAjanlar,
        evrenIsleri: [],
      };
    })
    .filter((x) => x.baslik && !denemeOturumu(x.baslik, x.boyut, x.altAjanlar.length, x.canli)); // kullanıcı mesajı olmayan (yalnız açılış kaydı) ve ajan yoklama oturumları listelenmez

  const { kalan, devir } = ataKopyalariniAyikla(oturumlar); // yeniden açılan sohbet tek kart kalır
  const ustHarita = new Map(kalan.map((o) => [o.id, o]));
  const kayitsizlar = []; // üstü bulunamayan EVREN işleri üst düzeyde "EVREN işi" olarak kalır
  for (const k of evrenKayitlari) {
    const is = evrenIsiOku(k, klasor, simdi);
    if (denemeOturumu(is.baslik || '', 0, 0, is.canli)) continue; // ajan yoklama işi
    // Ataya bağlı iş, listede kalan en yeni kopyaya (devir) bağlanır; ata artık görünmüyor.
    const ust = is.ust ? (ustHarita.get(is.ust) || devir.get(is.ust) || null) : null;
    if (ust) ust.evrenIsleri.push(is);
    else if (is.canli) {
      // Üst oturum yok: iş yalnız canlıyken kendi satırında görünür (bitmiş iş listeyi kirletmez).
      kayitsizlar.push({
        id: is.id,
        baslik: is.baslik,
        evren: true,
        kaynak: 'evren',
        model: is.model,
        durum: is.durum,
        ms: is.ms,
        turCanli: false,
        ajanCalisiyor: false,
        calisanAjan: 0,
        evrenCalisiyor: is.canli,
        canli: is.canli,
        altAjanlar: [],
        evrenIsleri: [],
        evrenIsi: is,
      });
    }
  }

  const tumu = [...kalan, ...kayitsizlar].sort((a, b) => b.ms - a.ms);
  for (const o of tumu) {
    const calisanEvren = (o.evrenIsleri || []).filter((e) => e.canli).length;
    o.calisanEvren = calisanEvren;
    o.evrenCalisiyor = calisanEvren > 0;
    if (calisanEvren > 0) o.canli = true; // çalışan EVREN işi de üst oturumu "çalışıyor" gösterir
  }
  return tumu.filter((x) => x.baslik).slice(0, 30);
}

// Tek oturumun alt ajan / EVREN işi sayıları (uçtan kumanda listesi için hafif yol).
// Ağır tam liste (oturumGecmisi) okunmaz; yalnız bu oturumun klasörü ve kayıtları taranır.
// secenekler.atalar: --resume çatallanmasında uç kimliğin klasörü boş kalabilir (ajanlar ata klasöründe
// yaşar); sayaçlar zincir boyunca tekilleştirilerek toplanır.
function oturumSayilari(dizin, kimlik, secenekler) {
  const bos = { altAjanlar: { calisan: 0, toplam: 0 }, evrenIsleri: { calisan: 0, toplam: 0 } };
  if (!dizin || !kimlik || !OTURUM_KIMLIK.test(String(kimlik))) return bos;
  const klasorAdi = dizin.replace(/[^a-zA-Z0-9]/g, '-');
  const klasor = path.join(claudeKokDizini(), klasorAdi);
  const zincir = [String(kimlik), ...(Array.isArray(secenekler && secenekler.atalar) ? secenekler.atalar : [])
    .filter((a) => OTURUM_KIMLIK.test(String(a))).map(String)];
  const ustKume = new Set(zincir);
  const ajanlar = new Map();
  for (const id of zincir) for (const a of altAjanlariOku(path.join(klasor, id))) if (!ajanlar.has(a.id)) ajanlar.set(a.id, a);
  const simdi = Date.now();
  const isler = evrenKayitlariOku(evrenKayitDizini(secenekler))
    .filter((k) => ustKume.has(String(k.ust || '')) && evrenKaydiBuProjede(k, klasor, klasorAdi))
    .map((k) => evrenIsiOku(k, klasor, simdi));
  const ajanDizisi = [...ajanlar.values()];
  return {
    altAjanlar: { calisan: ajanDizisi.filter((a) => a.canli).length, toplam: ajanDizisi.length },
    evrenIsleri: { calisan: isler.filter((i) => i.canli).length, toplam: isler.length },
  };
}


const ON_DORT_GUN_MS = 14 * 24 * 60 * 60 * 1000;
const TEMP_PATTERNS = [/[\/\\]temp([\/\\]|$)/i, /scratch-workspaces/i, /evren-slash-test/i, /[\/\\]test[\/\\]/i];

function tempMi(p) {
  if (!p || typeof p !== 'string') return false;
  return TEMP_PATTERNS.some((rx) => rx.test(p));
}

// Claude'un kendi oturum arşivi (.claude/projects/<slug>) gerçek bir proje dizini değildir;
// oradan okunan cwd listeye proje olarak düşmemeli.
const ARSIV_PATTERN = /[\/\\]\.claude[\/\\]projects([\/\\]|$)/i;
function arsivMi(p) {
  return typeof p === 'string' && ARSIV_PATTERN.test(p);
}

function cwdOku(dosya) {
  let fd, cwd = '';
  try {
    fd = fs.openSync(dosya, 'r');
    const tampon = Buffer.alloc(32 * 1024);
    const n = fs.readSync(fd, tampon, 0, tampon.length, 0);
    if (n > 0) {
      const satirlar = tampon.subarray(0, n).toString('utf8').split('\n');
      for (const satir of satirlar) {
        if (!satir.trim()) continue;
        let j; try { j = JSON.parse(satir); } catch { continue; }
        if (!j) continue;
        if (typeof j.cwd === 'string' && j.cwd.trim()) { cwd = j.cwd.trim(); break; }
        if (j.message && typeof j.message.cwd === 'string' && j.message.cwd.trim()) { cwd = j.message.cwd.trim(); break; }
      }
    }
  } catch {} finally { if (fd != null) try { fs.closeSync(fd); } catch {} }
  return cwd;
}

function tumOturumlariTara(secenekler) {
  const kokDizin = claudeKokDizini();
  let klasorler;
  try { klasorler = fs.readdirSync(kokDizin, { withFileTypes: true }); } catch { return []; }
  const simdi = Date.now();
  const oturumlar = [];

  const evrenKayitlari = evrenKayitlariOku(evrenKayitDizini(secenekler));
  const isKimlikleri = new Set(evrenKayitlari.map((k) => k.id));

  for (const k of klasorler) {
    if (!k.isDirectory()) continue;
    const kYol = path.join(kokDizin, k.name);
    let adlar;
    try { adlar = fs.readdirSync(kYol); } catch { continue; }

    for (const a of adlar) {
      if (!a.endsWith('.jsonl')) continue;
      const id = a.slice(0, -6);
      if (!OTURUM_KIMLIK.test(id)) continue;
      if (isKimlikleri.has(id)) continue;

      const dosya = path.join(kYol, a);
      let s;
      try { s = fs.statSync(dosya); } catch { continue; }
      if (!s || s.size <= 0) continue;
      if (simdi - s.mtimeMs > ON_DORT_GUN_MS) continue;

      const cwd = cwdOku(dosya);
      // Klasörü bilinmeyen ya da silinmiş oturum sürdürülemez; listede yanıltıcı satır olmasın.
      if (!cwd || tempMi(cwd) || arsivMi(cwd) || !fs.existsSync(cwd)) continue;

      const projeYol = cwd;
      const projeAd = path.basename(cwd) || 'Proje';
      const seansDizin = path.join(kYol, id);
      const taze = simdi - s.mtimeMs < CANLI_ESIK_MS;
      const turCanli = taze && turDevamEdiyor(dosya, s.size) !== false;
      const altAjanlar = altAjanlariOku(seansDizin);
      const calisanAjan = altAjanlar.filter((x) => x.canli).length;
      const bilgi = oturumBilgisi(dosya, id, seansDizin, { ms: s.mtimeMs, boyut: s.size });

      if (!bilgi.baslik) continue;
      if (denemeOturumu(bilgi.baslik, s.size, altAjanlar.length, turCanli || calisanAjan > 0)) continue;

      oturumlar.push({
        id,
        ...bilgi,
        ms: s.mtimeMs,
        dogumMs: s.birthtimeMs || s.ctimeMs || s.mtimeMs,
        projeAd,
        projeYol,
        turCanli,
        ajanCalisiyor: calisanAjan > 0,
        calisanAjan,
        canli: turCanli || calisanAjan > 0,
        sonDurum: sonDurumOku(dosya, s.size, id, s.mtimeMs),
        altAjanlar,
        evrenIsleri: [],
      });
    }
  }

  const { kalan, devir } = ataKopyalariniAyikla(oturumlar); // yeniden açılan sohbet tek kart kalır
  const ustHarita = new Map(kalan.map((o) => [o.id, o]));
  const kayitsizlar = [];
  for (const k of evrenKayitlari) {
    const is = evrenIsiOku(k, '', simdi);
    if (denemeOturumu(is.baslik || '', 0, 0, is.canli)) continue; // ajan yoklama işi
    // Ataya bağlı iş, listede kalan en yeni kopyaya (devir) bağlanır; ata artık görünmüyor.
    const ust = is.ust ? (ustHarita.get(is.ust) || devir.get(is.ust) || null) : null;
    if (ust) ust.evrenIsleri.push(is);
    else if (is.canli && is.dizin && !tempMi(is.dizin) && !arsivMi(is.dizin) && fs.existsSync(is.dizin)) {
      const projeAd = (is.dizin ? path.basename(is.dizin) : 'EVREN') || 'EVREN';
      kayitsizlar.push({
        id: is.id,
        baslik: is.baslik,
        evren: true,
        kaynak: 'evren',
        model: is.model,
        durum: is.durum,
        ms: is.ms,
        projeAd,
        projeYol: is.dizin || '',
        turCanli: false,
        ajanCalisiyor: false,
        calisanAjan: 0,
        evrenCalisiyor: is.canli,
        canli: is.canli,
        altAjanlar: [],
        evrenIsleri: [],
        evrenIsi: is,
      });
    }
  }

  const tumu = [...kalan, ...kayitsizlar].sort((a, b) => b.ms - a.ms);
  for (const o of tumu) {
    const calisanEvren = (o.evrenIsleri || []).filter((e) => e.canli).length;
    o.calisanEvren = calisanEvren;
    o.evrenCalisiyor = calisanEvren > 0;
    if (calisanEvren > 0) o.canli = true;
  }
  return tumu.filter((x) => x.baslik).slice(0, 100);
}

// ---- Sohbet içeriği arama (arama kutusu yalnız başlığa bakmasın) ----
// Oturum dosyaları büyük (medyan ~1,6 MB); arama her dosyanın son ARAMA_BAYT baytlık
// kuyruğunda yapılır. Küçültme tek karakterli eşlemedir: eşleşme dizini özgün metindeki
// dizinle aynı kalır, örnek satır özgün büyük/küçük harfiyle kesilir.
const ARAMA_BAYT = 350 * 1024;
const ARAMA_BUTCE = 48 * 1024 * 1024; // tek aramada tüm dosyalar için üst sınır
// Arama katlaması ve ad eşleşmesi renderer ile ortak (gorunum.js); burada yeniden dışa verilir.
const { aramaMetni, katla, birFark, adEslesir } = require('./gorunum');

// Bir JSONL satırından yalnız insanın okuyacağı metin: kullanıcı mesajı ve asistan "text" blokları.
// thinking, signature, tool_use girdisi, tool_result, görsel/base64 ve 40+ karakterlik boşluksuz dizgiler atılır.
function okunurMetin(satir) {
  let o;
  try { o = JSON.parse(satir); } catch { return ''; }
  if (!o || (o.type !== 'user' && o.type !== 'assistant') || !o.message) return '';
  const c = o.message.content;
  const parcalar = [];
  if (typeof c === 'string') parcalar.push(c);
  else if (Array.isArray(c)) for (const b of c) if (b && b.type === 'text' && typeof b.text === 'string') parcalar.push(b.text);
  return parcalar.join(' ')
    .replace(/\S{40,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Dosyanın kuyruğunda sorguyu arar; ilk eşleşmenin çevresinden tek satırlık örnek çıkarır.
function icerikAra(dosya, sorgu, enCok = ARAMA_BAYT) {
  const q = katla(String(sorgu || '').trim());
  if (q.length < 2) return null;
  let fd;
  try { fd = fs.openSync(dosya, 'r'); } catch { return null; }
  try {
    const boyut = fs.fstatSync(fd).size;
    const n = Math.min(enCok, boyut);
    if (n <= 0) return null;
    const bas = boyut - n;
    const t = Buffer.alloc(n);
    let okunan = 0;
    while (okunan < n) {
      const r = fs.readSync(fd, t, okunan, n - okunan, bas + okunan);
      if (!r) break;
      okunan += r;
    }
    const satirlar = t.toString('utf8', 0, okunan).split('\n');
    let sayi = 0;
    let ornek = '';
    for (const satir of satirlar) {
      if (!satir || satir.length < q.length) continue;
      const metin = okunurMetin(satir);
      if (!metin) continue;
      const kat = katla(metin);
      let i = kat.indexOf(q);
      if (i < 0) continue;
      if (!ornek) {
        const bas2 = Math.max(0, i - 40);
        ornek = (bas2 > 0 ? '…' : '') + metin.slice(bas2, Math.min(metin.length, i + q.length + 80)).trim();
        if (i + q.length + 80 < metin.length) ornek += '…';
      }
      for (; i >= 0 && sayi < 999; i = kat.indexOf(q, i + q.length)) sayi++;
    }
    return sayi ? { sayi, ornek } : null;
  } catch { return null; }
  finally { try { fs.closeSync(fd); } catch {} }
}

// [{ id, projeYol, baslik, projeAd }] listesini arar. Sıra: önce ad / proje (klasör) eşleşmesi
// ({ ad: true }, içerik bağlamı yok), sonra sohbet içeriği. Yalnız eşleşen oturumlar döner.
function icerikAraListe(turler, sorgu) {
  const q = String(sorgu || '').trim();
  if (q.length < 2 || !Array.isArray(turler)) return {};
  const kok = claudeKokDizini();
  const sonuc = {};
  let butce = ARAMA_BUTCE;
  for (const t of turler) {
    if (!t || !OTURUM_KIMLIK.test(String(t.id || ''))) continue;
    if (adEslesir([t.baslik, t.projeAd, t.projeYol], q)) { sonuc[t.id] = { ad: true, sayi: 0, ornek: '' }; continue; }
    // Eşleşme iç içe bir alt işte ise adı döner: kart hangi alt işin eşleştiğini gösterir.
    const altAd = (Array.isArray(t.ekler) ? t.ekler.slice(0, 40) : []).find((e) => adEslesir([e], q));
    if (altAd) { sonuc[t.id] = { ad: true, sayi: 0, ornek: '', alt: String(altAd) }; continue; }
    if (butce <= 0) continue;
    if (!t.projeYol || typeof t.projeYol !== 'string') continue;
    const pay = Math.min(ARAMA_BAYT, butce);
    butce -= pay;
    const dosya = path.join(kok, t.projeYol.replace(/[^a-zA-Z0-9]/g, '-'), t.id + '.jsonl');
    const e = icerikAra(dosya, q, pay);
    if (e) sonuc[t.id] = e;
  }
  return sonuc;
}

module.exports = { oturumGecmisi, tumOturumlariTara, cwdOku, tempMi, oturumSayilari, altAjanlariOku, turDevamEdiyor, sonDurumOku, baslikOku, ozelBaslikOku, ozelBaslikYaz, baslikOnbellekTemizle, evrenKayitlariOku, ataKopyalariniAyikla, icerikAra, icerikAraListe, aramaMetni, katla, adEslesir, birFark, okunurMetin, OTURUM_KIMLIK, CANLI_ESIK_MS };
