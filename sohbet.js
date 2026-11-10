// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Yusuf Günay. */
// Claude Code oturum kayıtlarını (~/.claude/projects/<dizin>/<kimlik>.jsonl) okunabilir sohbete çevirir.
// İlk abonelikte son 50 giriş dosyanın SONUNDAN geriye okunur; sonrası artımlıdır (dosya baştan okunmaz).
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');

const OTURUM_KIMLIK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OZET_SINIRI = 200;
const ILK_ADET = 50;
// Kullanıcıya soru soran araçlar: giriş metni tek satır özet değil, gerçek
// soru ve seçenekler olarak taşınır. Telefon bunları düğme olarak çizer.
const SORU_ARACLARI = new Set(['AskUserQuestion', 'AskUserInput', 'Question']);

// Dizin adı Claude Code'un kodlamasıyla aynı: harf/rakam dışı karakterler tireye döner.
function projeKlasoru(dizin, kokDizin) {
  const kok = kokDizin || process.env.EVREN_PROJE_DIZINI || path.join(os.homedir(), '.claude', 'projects');
  return path.join(kok, String(dizin || '').replace(/[^a-zA-Z0-9]/g, '-'));
}

function dosyaYolu(dizin, kimlik, kokDizin) {
  return path.join(projeKlasoru(dizin, kokDizin), kimlik + '.jsonl');
}

/**
 * Oturumun Claude kayıt dosyasını bulur.
 * `devam` varsa doğrudan o kimliğin dosyası; yoksa oturum başladıktan sonra dizinde
 * oluşan en yeni jsonl dosyası (PTY açıldıktan hemen sonra dosya henüz olmayabilir).
 */
function oturumDosyasiBul({ dizin, devam, baslangicMs, kokDizin }) {
  if (!dizin) return null;
  if (devam && OTURUM_KIMLIK.test(String(devam))) {
    const tam = dosyaYolu(dizin, String(devam), kokDizin);
    try { if (fs.statSync(tam).isFile()) return tam; } catch { return null; }
  }
  const klasor = projeKlasoru(dizin, kokDizin);
  let adlar;
  try { adlar = fs.readdirSync(klasor); } catch { return null; }
  const esik = (Number(baslangicMs) || 0) - 2000; // saat kayması payı
  let enIyi = null;
  for (const ad of adlar) {
    if (!ad.endsWith('.jsonl')) continue;
    const kimlik = ad.slice(0, -6);
    if (!OTURUM_KIMLIK.test(kimlik)) continue;
    const tam = path.join(klasor, ad);
    let s;
    try { s = fs.statSync(tam); } catch { continue; }
    if (!s.isFile() || s.size <= 0) continue;
    const dogum = Math.min(s.birthtimeMs || s.ctimeMs || 0, s.mtimeMs || 0);
    if (esik > 0 && Math.max(s.ctimeMs || 0, s.mtimeMs || 0) < esik) continue;
    if (!enIyi || dogum > enIyi.dogum) enIyi = { yol: tam, kimlik, dogum };
  }
  return enIyi ? enIyi.yol : null;
}

function metinParcasi(icerik) {
  if (typeof icerik === 'string') return icerik;
  if (Array.isArray(icerik)) {
    return icerik.filter((x) => x && x.type === 'text').map((x) => x.text).join(' ');
  }
  return '';
}

// Araç girdisi/çıktısından tek satırlık, en çok 200 karakterlik özet.
function ozetle(deger) {
  let metin = '';
  if (typeof deger === 'string') metin = deger;
  else if (Array.isArray(deger)) metin = metinParcasi(deger) || deger.map((x) => (x && x.type === 'tool_result' ? metinParcasi(x.content) : '')).join(' ');
  else if (deger && typeof deger === 'object') {
    const adaylar = ['command', 'description', 'file_path', 'pattern', 'query', 'prompt', 'path', 'url', 'content'];
    const secili = adaylar.map((k) => deger[k]).find((x) => typeof x === 'string' && x.trim());
    metin = typeof secili === 'string' ? secili : JSON.stringify(deger);
  }
  metin = String(metin || '').replace(/\s+/g, ' ').trim();
  return metin.length > OZET_SINIRI ? metin.slice(0, OZET_SINIRI - 1) + '…' : metin;
}

/**
 * AskUserQuestion girdisini yapılandırılmış sorulara çevirir.
 * Girdi biçimi: { questions: [{ question, header, multiSelect, options: [{ label, description }] }] }.
 * Dönen: [{ soru, baslik, cokSecim, secenekler: [{ etiket, aciklama }] }] ya da null.
 */
function sorulariCoz(girdi) {
  if (!girdi || typeof girdi !== 'object' || !Array.isArray(girdi.questions)) return null;
  const sorular = [];
  for (const q of girdi.questions) {
    if (!q || typeof q !== 'object') continue;
    const secenekler = [];
    for (const o of Array.isArray(q.options) ? q.options : []) {
      if (typeof o === 'string') {
        if (o.trim()) secenekler.push({ etiket: o.trim(), aciklama: '' });
        continue;
      }
      if (!o || typeof o !== 'object') continue;
      const etiket = String(o.label || o.etiket || '').trim();
      if (!etiket) continue;
      secenekler.push({ etiket, aciklama: String(o.description || o.aciklama || '').trim() });
    }
    const soruMetni = String(q.question || q.soru || '').trim();
    if (!soruMetni && !secenekler.length) continue;
    sorular.push({
      soru: soruMetni,
      baslik: String(q.header || q.baslik || '').trim(),
      cokSecim: q.multiSelect === true,
      secenekler,
    });
  }
  return sorular.length ? sorular : null;
}

function zamanMs(j) {
  const t = Date.parse(j && j.timestamp);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Bir jsonl kaydını sohbet girişlerine çevirir.
 * Dönen her giriş: { rol: 'kullanici'|'asistan'|'arac', metin, arac?: { ad, ozet }, ms }.
 */
function girisleriCoz(j, aracAdlari) {
  const girisler = [];
  if (!j || typeof j !== 'object' || j.isMeta === true || j.isSidechain === true) return girisler;
  const ms = zamanMs(j);
  const mesaj = j.message;
  if (!mesaj) return girisler;

  if (j.type === 'user') {
    const icerik = mesaj.content;
    if (typeof icerik === 'string') {
      const metin = icerik.trim();
      if (metin && !metin.startsWith('Caveat:') && !metin.startsWith('[Request interrupted')) {
        girisler.push({ rol: 'kullanici', metin, ms });
      }
      return girisler;
    }
    if (!Array.isArray(icerik)) return girisler;
    for (const blok of icerik) {
      if (!blok) continue;
      if (blok.type === 'text') {
        const metin = String(blok.text || '').trim();
        if (metin) girisler.push({ rol: 'kullanici', metin, ms });
      } else if (blok.type === 'tool_result') {
        // Özet, aracın ADI ve GİRDİSİdir (dosya yolu, komut); sonucun ilk satırı
        // başlık olarak anlamsız kalıyordu (ör. dosya içeriğinin 1. satırı).
        const bilgi = aracAdlari && aracAdlari.get(blok.tool_use_id);
        const ad = (bilgi && bilgi.ad) || 'Araç sonucu';
        const ozet = (bilgi && bilgi.ozet) || ozetle(blok.content);
        // `sonuc: true` araç çağrısı değil, dönüş kaydıdır: soru aracının
        // yanıtı da buradan gelir; istemci bunu bekleyen soru sanmamalı.
        girisler.push({ rol: 'arac', metin: ozetle(blok.content), arac: { ad, ozet, sonuc: true }, ms });
      }
    }
    return girisler;
  }

  if (j.type === 'assistant') {
    if (typeof mesaj.model === 'string' && mesaj.model === '<synthetic>') return girisler;
    const icerik = mesaj.content;
    const bloklar = Array.isArray(icerik) ? icerik : [{ type: 'text', text: String(icerik || '') }];
    for (const blok of bloklar) {
      if (!blok) continue;
      if (blok.type === 'text') {
        const metin = String(blok.text || '').trim();
        if (metin) girisler.push({ rol: 'asistan', metin, ms });
      } else if (blok.type === 'tool_use') {
        const ad = String(blok.name || 'Araç');
        // Soru aracı: tek satırlık JSON dökümü yerine gerçek soru ve seçenekler
        // gider. Telefon seçenekleri düğme olarak çizer, dokunuşla yanıtlar.
        const sorular = SORU_ARACLARI.has(ad) ? sorulariCoz(blok.input) : null;
        const ozet = (sorular && sorular[0].soru) || ozetle(blok.input);
        const arac = { ad, ozet };
        if (sorular) arac.sorular = sorular;
        if (aracAdlari && blok.id) aracAdlari.set(blok.id, { ad, ozet });
        girisler.push({ rol: 'arac', metin: ozet, arac, ms });
      }
    }
  }
  return girisler;
}

// Dosyanın sonundan geriye doğru okuyup son [adet] girişi döndürür (dosya baştan okunmaz).
function sonGirisler(dosya, adet = ILK_ADET) {
  let boyut, fd;
  try { boyut = fs.statSync(dosya).size; fd = fs.openSync(dosya, 'r'); } catch { return { girisler: [], konum: 0 }; }
  try {
    const parcalar = [];
    let konum = boyut, satirSayisi = 0, toplam = 0;
    const SINIR = 16 * 1024 * 1024;
    while (konum > 0 && satirSayisi < adet * 3 && toplam < SINIR) {
      const n = Math.min(256 * 1024, konum);
      konum -= n;
      const t = Buffer.alloc(n);
      fs.readSync(fd, t, 0, n, konum);
      parcalar.unshift(t);
      toplam += n;
      for (let i = 0; i < n; i++) if (t[i] === 0x0a) satirSayisi++;
    }
    const ham = Buffer.concat(parcalar).toString('utf8');
    const satirlar = ham.split('\n');
    if (konum > 0) satirlar.shift(); // baştaki yarım satır atılır
    const aracAdlari = new Map();
    const tumu = [];
    for (const satir of satirlar) {
      if (!satir.trim()) continue;
      let j; try { j = JSON.parse(satir); } catch { continue; }
      tumu.push(...girisleriCoz(j, aracAdlari));
    }
    return { girisler: tumu.slice(-adet), konum: boyut };
  } finally { try { fs.closeSync(fd); } catch {} }
}

/**
 * Artımlı okuyucu: bir dosya konumundan sonuna kadar yalnız yeni tam satırları okur.
 * UTF-8 çok baytlı karakter bölünmesi StringDecoder ile korunur.
 */
class ArtimliOkuyucu {
  constructor() {
    this.konum = 0;
    this.kalan = '';
    this.kod = new StringDecoder('utf8');
    this.aracAdlari = new Map();
  }

  konumAyarla(konum) {
    this.konum = Number(konum) || 0;
    this.kalan = '';
    this.kod = new StringDecoder('utf8');
    this.aracAdlari = new Map();
  }

  // Dosyanın sonuna kadar okur; yeni sohbet girişlerini döndürür.
  oku(dosya) {
    let boyut;
    try { boyut = fs.statSync(dosya).size; } catch { return []; }
    if (boyut < this.konum) this.konumAyarla(0); // dosya kısaldı/yeniden yazıldı
    if (boyut === this.konum) return [];
    const n = boyut - this.konum;
    const t = Buffer.alloc(n);
    let fd;
    try {
      fd = fs.openSync(dosya, 'r');
      fs.readSync(fd, t, 0, n, this.konum);
    } catch { return []; } finally { if (fd != null) try { fs.closeSync(fd); } catch {} }
    this.konum = boyut;
    const metin = this.kalan + this.kod.write(t);
    const satirlar = metin.split('\n');
    this.kalan = satirlar.pop(); // yarım satır sonraki okumada tamamlanır
    const girisler = [];
    for (const satir of satirlar) {
      if (!satir.trim()) continue;
      let j; try { j = JSON.parse(satir); } catch { continue; }
      girisler.push(...girisleriCoz(j, this.aracAdlari));
    }
    return girisler;
  }

  // İlk abonelik: son girişler + o konumdan devam.
  sifirla(dosya, adet = ILK_ADET) {
    const { girisler, konum } = sonGirisler(dosya, adet);
    this.konumAyarla(konum);
    return girisler;
  }
}

// Dosyanın sonundaki ham JSON kayıtlarını (eskiden yeniye) döndürür.
function sonKayitlar(dosya, adet = 160) {
  let boyut, fd;
  try { boyut = fs.statSync(dosya).size; fd = fs.openSync(dosya, 'r'); } catch { return []; }
  try {
    const n = Math.min(boyut, 512 * 1024);
    const t = Buffer.alloc(n);
    fs.readSync(fd, t, 0, n, boyut - n);
    const satirlar = t.toString('utf8').split('\n');
    if (boyut > n) satirlar.shift(); // baştaki yarım satır
    const kayitlar = [];
    for (const s of satirlar) {
      const x = s.trim();
      if (!x) continue;
      try { kayitlar.push(JSON.parse(x)); } catch {}
    }
    return kayitlar.slice(-adet);
  } finally {
    try { fs.closeSync(fd); } catch {}
  }
}

/**
 * Oturumun gerçek durumu — kapatma kararı zamanlayıcıya değil, ajanın kendi kaydına dayanır.
 * 'bitti'      : son tur asistanın metin cevabıyla kapandı, kullanıcıyı bekliyor (kapatılabilir).
 * 'calisiyor'  : araç çağrısı askıda, kullanıcı istemi yanıtsız ya da araç sonucu bekleniyor.
 * 'bilinmiyor' : kayıt yok/okunamadı; temkinli davran, kapatma.
 */
function oturumDurumu(dosya) {
  const kayitlar = sonKayitlar(dosya);
  for (let i = kayitlar.length - 1; i >= 0; i--) {
    const j = kayitlar[i];
    if (!j || typeof j !== 'object' || j.isSidechain === true || j.isMeta === true) continue;
    if (j.type === 'summary') return 'bitti';
    if (j.type !== 'user' && j.type !== 'assistant') continue;
    const mesaj = j.message;
    if (!mesaj) continue;
    const icerik = mesaj.content;
    if (j.type === 'assistant') {
      if (mesaj.model === '<synthetic>') continue;
      const bloklar = Array.isArray(icerik) ? icerik : [{ type: 'text', text: icerik }];
      if (bloklar.some((b) => b && b.type === 'tool_use')) return 'calisiyor'; // araç sonucu bekleniyor
      return 'bitti';
    }
    if (typeof icerik === 'string') {
      if (icerik.startsWith('Caveat:') || icerik.startsWith('[Request interrupted')) continue;
      return 'calisiyor'; // gerçek kullanıcı istemi, ajanın cevabı yok
    }
    if (Array.isArray(icerik)) {
      const sonBlok = icerik[icerik.length - 1];
      if (sonBlok && sonBlok.type === 'tool_result') return 'calisiyor';
      if (icerik.some((b) => b && b.type === 'text')) return 'calisiyor';
    }
  }
  return 'bilinmiyor';
}

// ---- Bağlam kullanımı ve sohbet sayacı ----
// Son asistan yanıtının usage alanı gerçek bağlamı verir: input + cache_creation + cache_read + output.
// Dosyanın yalnız sonu taranır; sayaç artımlıdır, büyük kayıtlar (60 MB+) baştan okunmaz.
const KULLANIM_IMZA = '"cache_read_input_tokens"';

function sonKullanim(dosya) {
  let boyut, fd;
  try { boyut = fs.statSync(dosya).size; fd = fs.openSync(dosya, 'r'); } catch { return null; }
  try {
    const n = Math.min(boyut, 256 * 1024);
    const t = Buffer.alloc(n);
    fs.readSync(fd, t, 0, n, boyut - n);
    const satirlar = t.toString('utf8').split('\n');
    if (boyut > n) satirlar.shift(); // baştaki yarım satır
    for (let i = satirlar.length - 1; i >= 0; i--) {
      const s = satirlar[i].trim();
      if (!s) continue;
      let j; try { j = JSON.parse(s); } catch { continue; }
      const u = j && j.type === 'assistant' && j.message && j.message.usage;
      if (!u || typeof u !== 'object') continue;
      const token = (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) +
        (Number(u.cache_read_input_tokens) || 0) + (Number(u.output_tokens) || 0);
      return {
        token: token || null,
        cikti: Number(u.output_tokens) || 0,
        model: typeof j.message.model === 'string' ? j.message.model : null,
      };
    }
    return null;
  } finally { try { fs.closeSync(fd); } catch {} }
}

class BaglamIzleyici {
  constructor() { this.dosya = null; this.konum = 0; this.yanit = 0; this.kalan = ''; this.son = null; }

  // Yeni baytlarda asistan yanıtı imzasını sayar (JSON ayrıştırmadan, 1:1 latin1 bayt eşlemesi).
  _say(parca) {
    const metin = this.kalan + parca.toString('latin1');
    let i = 0, n = 0;
    while ((i = metin.indexOf(KULLANIM_IMZA, i)) >= 0) { n++; i += KULLANIM_IMZA.length; }
    this.kalan = metin.slice(-(KULLANIM_IMZA.length - 1)); // blok sınırında bölünen imza
    return n;
  }

  oku(dosya) {
    if (!dosya) return this.son;
    let st;
    try { st = fs.statSync(dosya); } catch { return this.son; }
    if (dosya !== this.dosya || st.size < this.konum) {
      this.dosya = dosya; this.konum = 0; this.yanit = 0; this.kalan = '';
    }
    if (st.size > this.konum) {
      let fd;
      try { fd = fs.openSync(dosya, 'r'); } catch { return this.son; }
      try {
        for (let konum = this.konum; konum < st.size;) {
          const n = Math.min(1024 * 1024, st.size - konum);
          const t = Buffer.alloc(n);
          fs.readSync(fd, t, 0, n, konum);
          this.yanit += this._say(t);
          konum += n;
          this.konum = konum;
        }
      } finally { try { fs.closeSync(fd); } catch {} }
    }
    const k = sonKullanim(dosya);
    this.son = {
      token: k ? k.token : null,
      cikti: k ? k.cikti : null,
      model: k ? k.model : null,
      yanit: this.yanit || null,
    };
    return this.son;
  }
}

module.exports = {
  projeKlasoru,
  dosyaYolu,
  oturumDosyasiBul,
  girisleriCoz,
  sonGirisler,
  sonKayitlar,
  oturumDurumu,
  ArtimliOkuyucu,
  BaglamIzleyici,
  sonKullanim,
  ozetle,
  sorulariCoz,
  ILK_ADET,
  OTURUM_KIMLIK,
};
