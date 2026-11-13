// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Yusuf Günay. */
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
const KALICI_SURUM = 1;
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

function baslikOku(dosya, yalnizBaslik, anlamli) {
  let fd, baslik = '', kaynak = '';
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
        if (!baslik && j.type === 'user' && !j.isMeta) {
          const m = metinCikar(j.message.content).replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (m && !m.startsWith('Caveat:') && !m.startsWith('[Request interrupted') && !(anlamli && oturumKarar.baslikAnlamsiz(m))) baslik = m.slice(0, 90);
        } else if (!kaynak && j.type === 'assistant' && typeof j.message.model === 'string' && j.message.model !== '<synthetic>') {
          kaynak = /^(claude|opus|sonnet|haiku)/i.test(j.message.model) ? 'claude' : 'evren';
        }
        if (baslik && (yalnizBaslik || kaynak)) break;
      }
    }
  } catch {} finally { if (fd != null) try { fs.closeSync(fd); } catch {} }
  return { baslik, kaynak };
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
    const b = { baslik: disk.baslik, kaynak: disk.kaynak };
    baslikOnbellek.set(id, { bilgi: b, damga, ms, boyut });
    return b;
  }
  const ozel = seansDizin ? ozelBaslikOku(seansDizin) : '';
  const b = baslikOku(dosya);
  if (ozel) b.baslik = ozel;
  if (b.baslik && b.kaynak) {
    baslikOnbellek.set(id, { bilgi: b, damga, ms, boyut });
    kaliciOnbellekYaz(id, { ms, boyut, damga, baslik: b.baslik, kaynak: b.kaynak });
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
  const baslik = baslikKayit || (jsonl ? baslikOku(jsonl.yol).baslik : '') || 'EVREN işi';
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
    .map((a) => { const d = path.join(klasor, a); try { const s = fs.statSync(d); return { id: a.slice(0, -6), dosya: d, ms: s.mtimeMs, boyut: s.size }; } catch { return null; } })
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

  const ustHarita = new Map(oturumlar.map((o) => [o.id, o]));
  const kayitsizlar = []; // üstü bulunamayan EVREN işleri üst düzeyde "EVREN işi" olarak kalır
  for (const k of evrenKayitlari) {
    const is = evrenIsiOku(k, klasor, simdi);
    if (denemeOturumu(is.baslik || '', 0, 0, is.canli)) continue; // ajan yoklama işi
    const ust = is.ust ? ustHarita.get(is.ust) : null;
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

  const tumu = [...oturumlar, ...kayitsizlar].sort((a, b) => b.ms - a.ms);
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
function oturumSayilari(dizin, kimlik, secenekler) {
  const bos = { altAjanlar: { calisan: 0, toplam: 0 }, evrenIsleri: { calisan: 0, toplam: 0 } };
  if (!dizin || !kimlik || !OTURUM_KIMLIK.test(String(kimlik))) return bos;
  const klasorAdi = dizin.replace(/[^a-zA-Z0-9]/g, '-');
  const klasor = path.join(claudeKokDizini(), klasorAdi);
  const ajanlar = altAjanlariOku(path.join(klasor, String(kimlik)));
  const simdi = Date.now();
  const isler = evrenKayitlariOku(evrenKayitDizini(secenekler))
    .filter((k) => k.ust === String(kimlik) && evrenKaydiBuProjede(k, klasor, klasorAdi))
    .map((k) => evrenIsiOku(k, klasor, simdi));
  return {
    altAjanlar: { calisan: ajanlar.filter((a) => a.canli).length, toplam: ajanlar.length },
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

  const ustHarita = new Map(oturumlar.map((o) => [o.id, o]));
  const kayitsizlar = [];
  for (const k of evrenKayitlari) {
    const is = evrenIsiOku(k, '', simdi);
    if (denemeOturumu(is.baslik || '', 0, 0, is.canli)) continue; // ajan yoklama işi
    const ust = is.ust ? ustHarita.get(is.ust) : null;
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

  const tumu = [...oturumlar, ...kayitsizlar].sort((a, b) => b.ms - a.ms);
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
const ARAMA_HARF = { A: 'a', B: 'b', C: 'c', D: 'd', E: 'e', F: 'f', G: 'g', H: 'h', I: 'ı', J: 'j', K: 'k', L: 'l', M: 'm', N: 'n', O: 'o', P: 'p', Q: 'q', R: 'r', S: 's', T: 't', U: 'u', V: 'v', W: 'w', X: 'x', Y: 'y', Z: 'z', Ç: 'ç', Ğ: 'ğ', İ: 'i', Ö: 'ö', Ş: 'ş', Ü: 'ü' };
const aramaMetni = (s) => String(s).replace(/[A-ZÇĞİÖŞÜ]/g, (c) => ARAMA_HARF[c] || c).toLowerCase();

// Dosyanın kuyruğunda sorguyu arar; ilk eşleşmenin çevresinden tek satırlık örnek çıkarır.
function icerikAra(dosya, sorgu, enCok = ARAMA_BAYT) {
  const q = aramaMetni(String(sorgu || '').trim());
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
    const ham = t.toString('utf8', 0, okunan);
    const metin = aramaMetni(ham);
    const ilk = metin.indexOf(q);
    if (ilk < 0) return null;
    let sayi = 0;
    for (let i = ilk; i >= 0 && sayi < 999; i = metin.indexOf(q, i + q.length)) sayi++;
    // Örnek, JSON kabuğundan arındırılsın: eşleşmeden geriye doğru en yakın "content" alanı.
    let basIx = Math.max(0, ilk - 55);
    // JSON metin değerinin başı: eşleşmeden geriye doğru en yakın tırnak-iki nokta-tırnak.
    const deger = ham.lastIndexOf('":"', ilk);
    if (deger >= 0 && ilk - deger < 400) basIx = deger + 3;
    else {
      const anahtar = ham.lastIndexOf('"content"', ilk);
      if (anahtar >= 0 && ilk - anahtar < 3000) basIx = anahtar + 9;
    }
    let kes = Math.min(ham.length, ilk + q.length + 90);
    const satirSonu = ham.indexOf('\n', ilk);
    if (satirSonu >= 0 && satirSonu < kes) kes = satirSonu; // örnek tek JSON satırında kalsın
    let ornek = ham.slice(basIx, kes)
      .replace(/\\u([0-9a-fA-F]{4})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\[nrt]/g, ' ')
      .replace(/\\"/g, '"')
      .replace(/\\/g, ' ')
      .replace(/^\s*:\s*"?/, '')
      .replace(/\s+/g, ' ')
      .replace(/[\s"}\]]+$/, '')
      .trim();
    if (ornek.length > 150) ornek = ornek.slice(0, 150).trim() + '…';
    return { sayi, ornek };
  } catch { return null; }
  finally { try { fs.closeSync(fd); } catch {} }
}

// [{ id, projeYol }] listesini arar; yalnız eşleşen oturumları döndürür.
function icerikAraListe(turler, sorgu) {
  const q = String(sorgu || '').trim();
  if (q.length < 2 || !Array.isArray(turler)) return {};
  const kok = claudeKokDizini();
  const sonuc = {};
  let butce = ARAMA_BUTCE;
  for (const t of turler) {
    if (butce <= 0) break;
    if (!t || !OTURUM_KIMLIK.test(String(t.id || ''))) continue;
    if (!t.projeYol || typeof t.projeYol !== 'string') continue;
    const pay = Math.min(ARAMA_BAYT, butce);
    butce -= pay;
    const dosya = path.join(kok, t.projeYol.replace(/[^a-zA-Z0-9]/g, '-'), t.id + '.jsonl');
    const e = icerikAra(dosya, q, pay);
    if (e) sonuc[t.id] = e;
  }
  return sonuc;
}

module.exports = { oturumGecmisi, tumOturumlariTara, cwdOku, tempMi, oturumSayilari, altAjanlariOku, turDevamEdiyor, sonDurumOku, baslikOku, ozelBaslikOku, ozelBaslikYaz, baslikOnbellekTemizle, evrenKayitlariOku, icerikAra, icerikAraListe, aramaMetni, OTURUM_KIMLIK, CANLI_ESIK_MS };
