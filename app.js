// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
/* EVREN Desktop — arayüz. Terminal xterm.js; kabuk ana süreçte (node-pty/ConPTY). */
'use strict';
// Chromium ctx.font ParseShorthand leading-space düzeltmesi (xterm addon-webgl #6297)
// Chromium'da ctx.font başında boşluk olunca shorthand ayrıştırılamaz ve 10px fallback'e düşer.
(function() {
  try {
    const proto = window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype;
    if (proto) {
      const desc = Object.getOwnPropertyDescriptor(proto, 'font');
      if (desc && desc.set) {
        Object.defineProperty(proto, 'font', {
          get: desc.get,
          set(v) {
            const temiz = typeof v === 'string' ? v.trimStart() : v;
            desc.set.call(this, temiz);
          },
          configurable: true,
          enumerable: true,
        });
      }
    }
  } catch (e) {
    console.warn('[webgl-font-yama]', e);
  }
})();
const $ = (id) => document.getElementById(id);
const sakla = {
  oku(k, v) { try { const x = localStorage.getItem('evren.' + k); return x == null ? v : JSON.parse(x); } catch { return v; } },
  yaz(k, v) { try { localStorage.setItem('evren.' + k, JSON.stringify(v)); } catch {} },
};
const AZ_HAREKET = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TerminalSinif = window.Terminal || (window.xterm && window.xterm.Terminal);
const FitSinif = window.FitAddon ? (window.FitAddon.FitAddon || window.FitAddon) : null;
const WebglSinif = window.WebglAddon ? (window.WebglAddon.WebglAddon || window.WebglAddon) : null;
const AraSinif = window.SearchAddon ? (window.SearchAddon.SearchAddon || window.SearchAddon) : null;
let webglAktifSayi = 0; // doğrulama: kaç terminal WebGL ile çiziliyor (en çok 1: yalnız etkin görünür sekme)
const VARSAYILAN_SCROLLBACK = 5000; // GPU bellek bütçesi: 20000 satır × N sekme commit'i şişiriyordu
const S = {
  modeller: [], projeler: [], model: '', proje: '',
  sonKlasorler: [], serbestDizin: '', sonEfor: 'medium', eforlar: [],
  anahtarVar: true, api: null, pingler: [], yuklendi: false,
  calisiyor: false, basliyor: false, oturumlar: [], aktif: null,
  fs: Math.min(18, Math.max(11, Number(new URLSearchParams(location.search).get('fs') || sakla.oku('fs', 13)) || 13)),
  sohbetAcik: sakla.oku('sohbetPanelAcik', false), sohbetFiltre: 'hepsi',
  ciktilar: null, ciktiAnahtar: null, ciktiKok: '', ciktiImza: '', // oturumun yazdığı dosyalar (Dosyalar görünümü)
  panelMod: 'sohbet', dosyaSuz: 'hepsi', dosyaGorseller: [], tusSerit: sakla.oku('tusSerit', true),
  gorunumler: sakla.oku('gorunumler', {}), // oturum başına Sohbet · Terminal · Dosyalar seçimi
  grupKapali: sakla.oku('grupKapali', {}), // { calisiyor: true, bosta: true } — gruplar ayrı ayrı katlanır
  sefOturumlar: new Set(sakla.oku('sefOturumlar', [])), // Şef olarak açılmış oturum kimlikleri (kalıcı)
  ayar: { claudeOturumlari: false }, // ana süreçteki ayardan gelir (durum)
  platform: 'win32', // ana süreçten gelir (durum); kasa metinleri buna göre yazılır
};
// Claude Code oturumları görünsün mü: tek okuma noktası (kişisel katman yalnız bu satırı değiştirebilir).
const claudeGoster = () => S.ayar.claudeOturumlari === true;
// Kasa adı: platforma göre arayüz metni (Windows kasası, macOS Anahtar Zinciri).
const kasaAdi = (p) => (p === 'win32' ? 'DPAPI' : p === 'darwin' ? 'macOS Anahtar Zinciri' : 'işletim sistemi kasası');
// macOS bayrağı: durum IPC'sinden gelir; yüklenmeden önce false kalır (darwin olmayan güvenli varsayılan).
const darwinMi = () => S.platform === 'darwin';
// Komut tuşu: Windows/Linux'ta Ctrl, macOS'te Cmd. Terminalin kendi tuşları (Ctrl+C = SIGINT) bundan bağımsız korunur.
const komutTusu = (e) => (darwinMi() ? !!(e && e.metaKey) : !!(e && e.ctrlKey));

// ---------- yardımcılar ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kisaYol = (p, n = 34) => (!p ? '' : p.length <= n ? p : p.slice(0, 3) + '…' + p.slice(-(n - 4)));
const kisaBaglam = (n) => (!n ? '—' : n >= 1e6 ? `${Math.round(n / 1048576)}M` : `${Math.round(n / 1024)}K`);
// Proje monogramı: "ornek-proje" → OP, "Ahali" → A, "evren-desktop" → ED.
const monogram = (ad) => {
  const p = String(ad || '').split(/[\s._-]+/).filter(Boolean);
  if (!p.length) return '?';
  const harf = p.length > 1 ? p[0][0] + p[1][0] : p[0][0];
  return harf.toLocaleUpperCase('tr');
};
const seciliModel = () => S.modeller.find((m) => m.id === S.model) || S.modeller[0];
const seciliProje = () => S.projeler.find((p) => p.yol === S.proje);
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const ikon = (ad) => `<svg class="ic"><use href="#i-${ad}"/></svg>`;
// Pano: önce ana süreçteki Electron clipboard (izin gerektirmez), olmazsa tarayıcı API'si.
// Win+V pano geçmişinden seçilen metin de bu yoldan gelir.
async function panoOku() {
  try { const x = await window.evren.panoOku?.(); if (typeof x === 'string') return x; } catch {}
  try { return await navigator.clipboard.readText(); } catch { return ''; }
}
async function panoYaz(metin) {
  try { if (await window.evren.panoYaz?.(metin)) return true; } catch {}
  try { await navigator.clipboard.writeText(metin); return true; } catch { return false; }
}
const kisaZaman = (ms) => {
  const f = Math.max(0, (Date.now() - ms) / 1000);
  if (f < 60) return 'şimdi';
  if (f < 3600) return `${Math.floor(f / 60)} dk`;
  if (f < 86400) return `${Math.floor(f / 3600)} sa`;
  if (f < 86400 * 30) return `${Math.floor(f / 86400)} g`;
  return `${Math.floor(f / (86400 * 30))} ay`;
};
const sureMetni = (ms) => {
  const s = Math.floor(ms / 1000);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((x) => String(x).padStart(2, '0')).join(':');
};
// ---------- listeler ----------
const iskelet = (n) => Array.from({ length: n }, () => '<div class="iskelet"><b></b><b></b></div>').join('');
function modelleriCiz() {
  const el = $('modelList');
  if (!S.yuklendi) { el.innerHTML = iskelet(3); return; }
  const enBuyuk = Math.max(1, ...S.modeller.map((m) => m.baglamSayisi || 0));
  el.innerHTML = S.modeller.map((m, i) => `
    <div class="row kompakt${m.id === S.model ? ' sec-li' : ''}" role="option" aria-selected="${m.id === S.model}" data-id="${esc(m.id)}" title="${esc(m.id)}${m.not ? " · " + esc(m.not) : ""}" style="animation-delay:${(0.14 + i * 0.04).toFixed(2)}s">
      <div class="row-l"><span class="row-t">${esc(m.ad || m.id)}</span><span class="tag">${kisaBaglam(m.baglamSayisi)}</span></div>
      <div class="meter"><i style="width:${Math.max(4, ((m.baglamSayisi || 0) / enBuyuk) * 100).toFixed(1)}%;animation-delay:${(0.3 + i * 0.05).toFixed(2)}s"></i></div>
    </div>`).join('');
  $('modelSay').textContent = S.modeller.length || '—';
}
function projeleriCiz() {
  const el = $('projeList');
  if (!S.yuklendi) { el.innerHTML = iskelet(2); return; }
  $('projeSay').textContent = S.projeler.length || '0';
  if (!S.projeler.length) {
    el.innerHTML = '<div class="bos-satir">Henüz proje yok. <button type="button" data-eylem="ekle">Klasör ekle</button></div>';
    return;
  }
  el.innerHTML = S.projeler.map((p, i) => `
    <div class="row${p.yol === S.proje ? ' sec-li' : ''}" role="option" aria-selected="${p.yol === S.proje}" data-id="${esc(p.yol)}" title="${esc(p.yol)}" style="animation-delay:${(0.2 + i * 0.04).toFixed(2)}s">
      <div class="row-l"><span class="row-t">${esc(p.ad)}</span>${p.dal ? `<span class="tag">${ikon('branch')}${esc(p.dal)}</span>` : ''}</div>
      <div class="row-s mono">${esc(kisaYol(p.yol))}</div>
    </div>`).join('');
}
// Seçim değişince listeyi yeniden çizmeyiz (giriş animasyonu tekrarlanmasın); yalnız sınıfları değiştiririz.
function secimIsaretle(listeId, deger) {
  for (const r of $(listeId).querySelectorAll('.row')) {
    const on = r.dataset.id === deger;
    r.classList.toggle('sec-li', on);
    r.setAttribute('aria-selected', on);
    if (on) r.scrollIntoView({ block: 'nearest' });
  }
}
function modelSec(id) {
  if (id === S.model) return;
  S.model = id; secimIsaretle('modelList', id); ozetYaz();
  olay('MODEL', `${id} seçildi · ${kisaBaglam((seciliModel() || {}).baglamSayisi)} bağlam`);
}
function projeSec(yol) {
  if (yol === S.proje) return;
  S.proje = yol; secimIsaretle('projeList', yol); ozetYaz();
  const p = seciliProje();
  olay('PROJE', `${p ? p.ad : yol}${p && p.dal ? ' · ' + p.dal : ''}`);
  projeOzetYukle();
  gecmisYukle();
}
// ---------- oturum geçmişi: Claude Code'un ~/.claude/projects kayıtlarından ----------
let gecmisIstek = 0;
let gecmisAra = ''; // oturum listesi süzgeci (başlıkta ve ajan tanımında arar)
S.gecmis = [];
const acikAjanlar = new Set();
// Sabit / arşiv / elle proje / kümeleme biçimi: ana süreçte tek küçük JSON (localStorage değil), userData altında.
const ignelenenler = new Set(); // sabitlenen oturum kimlikleri ("Sabitlenenler" bölümü)
const arsivlenenler = new Set(); // arşive alınan oturum kimlikleri (silinmez, yalnız gizlenir)
let elleProje = {}; // { oturumKimligi: projeKlasoru } — elle seçim, otomatik çıkarımı ezer
let kumeBicimi = 'tarih'; // Geçmiş kümeleme: 'tarih' | 'proje'
let cikarilanProje = {}; // { oturumKimligi: { yol, ad } } — yol çoğunluğundan çıkarım
const cikarimIstendi = new Map(); // oturum kimliği -> ms (damga değişmedikçe yeniden sorulmaz)
function tercihKaydet() {
  try { window.evren.tercihYaz({ sabit: [...ignelenenler], arsiv: [...arsivlenenler], proje: elleProje, kume: kumeBicimi, gorulen, gorulenTaban, acilan }); } catch {}
}
// Okunmamış işareti ve hızlı geçiş: oturum kimliği -> son görülme ms; taban = özelliğin ilk açıldığı an; acilan = en yeni önde.
let gorulen = {};
let gorulenTaban = 0;
let acilan = [];
let gorulenZaman = null;
// Orta alanda görünen oturum kimliği (canlı sekme ya da okuma görünümü).
function gorunenOturumId() {
  if (seciliOturumGecmisi) return seciliOturumGecmisi.id;
  const o = aktifOturum();
  return (o && o.devam) || null;
}
// Görünen oturum görülmüş sayılır; yeni içerik gelmişse ya da sıra değiştiyse yazılır (kısa gecikmeyle birleştirilir).
function gorulduIsaretle(id) {
  if (!id || !gorulenTaban) return;
  const g = S.gecmis.find((x) => x.id === id);
  const yeniIcerik = (gorulen[id] || 0) < ((g && g.ms) || 0) || !gorulen[id];
  if (!yeniIcerik && acilan[0] === id) return;
  if (yeniIcerik) gorulen = { ...gorulen, [id]: Math.max(Date.now(), (g && g.ms) || 0) };
  acilan = Gorunum.acilanEkle(acilan, id);
  clearTimeout(gorulenZaman);
  gorulenZaman = setTimeout(tercihKaydet, 400);
}
async function tercihYukle() {
  let t = null;
  try { t = await window.evren.tercihOku(); } catch {}
  t = t || { sabit: [], arsiv: [], proje: {}, kume: 'tarih' };
  gorulen = t.gorulen || {};
  acilan = t.acilan || [];
  gorulenTaban = t.gorulenTaban || 0;
  if (!gorulenTaban) { gorulenTaban = Date.now(); setTimeout(tercihKaydet, 0); } // ilk açılış: eski oturumlar okunmuş sayılır
  for (const id of t.sabit) ignelenenler.add(id);
  for (const id of t.arsiv) arsivlenenler.add(id);
  elleProje = t.proje || {};
  kumeBicimi = t.kume === 'proje' ? 'proje' : 'tarih';
  // Eski sürümün localStorage iğneleri bir kez taşınır.
  const eski = sakla.oku('ignelenenler', []);
  if (Array.isArray(eski) && eski.length && !sakla.oku('tercihTasindi', false)) {
    for (const id of eski) if (typeof id === 'string' && id) ignelenenler.add(id);
    sakla.yaz('tercihTasindi', true);
    tercihKaydet();
  }
}
const tercihHazir = tercihYukle();
function oturumIgnele(id) {
  if (!id) return;
  if (ignelenenler.has(id)) ignelenenler.delete(id);
  else { ignelenenler.add(id); arsivlenenler.delete(id); }
  tercihKaydet();
  gecmisCiz();
  sohbetIgneDurumGuncelle();
}
// Etkin (çalışan ya da sekmesi açık) oturum arşivlenemez; arşivlenen sabitten düşer.
function oturumArsivle(id) {
  if (!id) return;
  if (arsivlenenler.has(id)) arsivlenenler.delete(id);
  else {
    const g = S.gecmis.find((x) => x.id === id);
    if (g && (gecmisAcikMi(g) || g.canli || g.turCanli || g.calisanAjan > 0 || g.calisanEvren > 0)) return;
    arsivlenenler.add(id);
    ignelenenler.delete(id);
  }
  tercihKaydet();
  gecmisCiz();
  sohbetIgneDurumGuncelle();
}
function oturumProjeTasi(id, yol) {
  if (!id) return;
  if (yol) elleProje = { ...elleProje, [id]: yol };
  else { elleProje = { ...elleProje }; delete elleProje[id]; } // otomatiğe dön
  tercihKaydet();
  gecmisCiz();
}
function kumeBicimiSec(b) {
  if (b !== 'tarih' && b !== 'proje') return;
  if (kumeBicimi === b) return;
  kumeBicimi = b;
  tercihKaydet();
  gecmisCiz();
}
const projeAdiBul = (yol) => { const p = (S.projeler || []).find((x) => x.yol === yol); return p ? p.ad : ''; };
const projeBilgi = (g) => Gorunum.etkinProje(g, elleProje, cikarilanProje, projeAdiBul);
// Klasörsüz (genel EVREN) oturum: asıl projesi kaydındaki yazılan dosyalardan çıkarılabilir.
function genelOturumMu(g) {
  if (!g || !g.projeYol) return true;
  const n = (y) => String(y || '').replace(/[\\]/g, '/').replace(/[/]+$/, '').toLowerCase();
  return !!S.serbestDizin && n(g.projeYol) === n(S.serbestDizin);
}
async function projeCikarimiIste(liste) {
  const istek = liste.filter((g) => genelOturumMu(g) && !elleProje[g.id] && cikarimIstendi.get(g.id) !== g.ms)
    .map((g) => ({ id: g.id, projeYol: g.projeYol, ms: g.ms }));
  if (!istek.length) return;
  for (const o of istek) cikarimIstendi.set(o.id, o.ms);
  let sonuc = null;
  try { sonuc = await window.evren.projeCikar(istek); } catch {}
  if (!sonuc) return;
  let degisti = false;
  for (const o of istek) {
    const yeni = sonuc[o.id] || null;
    const eski = cikarilanProje[o.id] || null;
    if ((yeni && yeni.yol) !== (eski && eski.yol)) {
      degisti = true;
      if (yeni) cikarilanProje[o.id] = yeni; else delete cikarilanProje[o.id];
    }
  }
  if (degisti) gecmisCiz();
}
let ilkGecmisYukleme = true;
let seciliOturumGecmisi = null;
let akimTimer = null;
function akimCizgiTetikle() {
  const el = $('akimCizgi');
  if (!el) return;
  el.classList.add('aktif');
  clearTimeout(akimTimer);
  akimTimer = setTimeout(() => { el.classList.remove('aktif'); }, 1000);
}
let gecmisSonHtml = null; // son yazılan liste HTML'i; aynıysa DOM'a dokunulmaz
const GECMIS_IDLE_GORUNEN = 8; // boştaki oturumlar önce kısa listelenir; gerisi tek düğmeyle açılır
let gecmisIdleTumu = false;
const gecmisAcikMi = (g) => S.oturumlar.some((o) => o.canli && (o.devam === g.id || (g.atalar || []).includes(o.devam))); // sekme açık; çalıştığı anlamına gelmez
// Kart kimliğinden canlı sekmeyi bulur: --resume çatallanmasında kart uç kimlikte, sekme ata kimlikte kalabilir.
function canliSekmeBul(id) {
  const g = S.gecmis.find((x) => x.id === id);
  const adlar = new Set([id, ...((g && g.atalar) || [])]);
  return S.oturumlar.find((o) => o.canli && (adlar.has(o.devam) || adlar.has(o.id)));
}
const kucult = (s) => String(s || '').toLocaleLowerCase('tr');
// EVREN işi durumuna göre satır/nokta sınıfı: çalışan yeşil, kesilen turuncu, hatalı kırmızı.
const evrenSinif = (durum) => durum === 'calisiyor' ? ' canli' : durum === 'kesildi' ? ' kesik' : durum === 'hata' ? ' hata' : '';
// Model kimliğinden kısa ad: claude-opus-5-5 → opus, deepseek-v4.1-flash → deepseek …
function kisaModel(ad) {
  const s = String(ad || '');
  if (!s) return '';
  const p = s.toLowerCase();
  for (const k of ['opus', 'sonnet', 'haiku', 'fable', 'deepseek', 'glm', 'qwen', 'gemma', 'flash', 'argon']) if (p.includes(k)) return k;
  return s.length > 14 ? s.slice(0, 14) : s;
}
// Oturumun nereden geldiği: kutu etiket yerine satırdaki küçük işaret (ay = EVREN, kıvılcım = Claude).
function kaynakIsaret(evrenMi) {
  return `<svg class="ic seans-kaynak ${evrenMi ? 'evren' : 'claude'}" role="img" aria-label="${evrenMi ? 'EVREN oturumu' : 'Claude oturumu'}"><use href="#${evrenMi ? 'i-evren' : 'i-claude'}" /></svg>`;
}
// Uyku engeli düğmesi: ayar açıksa çalışan oturum varken sistem uyumaz.
function uykuDugmeCiz() {
  const b = $('uykuBtn');
  if (!b) return;
  b.classList.toggle('aktif', !!S.uyku);
  b.classList.toggle('uygulanan', !!S.uykuAktif);
  b.setAttribute('aria-pressed', S.uyku ? 'true' : 'false');
  b.title = S.uyku ? 'Uyku engeli açık: çalışan oturum varken bilgisayar uykuya geçmez' : 'Uyku engeli kapalı: bilgisayar normal uykuya geçebilir';
}
function gecmisCiz() {
  const el = $('gecmisList');
  if (!el) return;
  // Proje listesi boş olsa da oturumlar (projesiz/aktif) görünmeli: boş mesaj yalnız
  // ne proje ne geçmiş varsa gösterilir.
  if ((!S.projeler || !S.projeler.length) && (!S.gecmis || !S.gecmis.length)) {
    if ($('gecmisSay')) $('gecmisSay').textContent = '—';
    el.innerHTML = '<div class="bos-satir">Henüz kayıtlı proje yok.</div>';
    return;
  }
  gorulduIsaretle(gorunenOturumId());
  const q = kucult(gecmisAra.trim());
  const eslesir = (g) => kucult(g.baslik).includes(q) ||
    kucult(g.projeAd || '').includes(q) || kucult(projeBilgi(g).ad).includes(q) ||
    (g.altAjanlar || []).some((a) => kucult(a.tanim).includes(q) || kucult(a.tur).includes(q)) ||
    (g.evrenIsleri || []).some((e) => kucult(e.baslik).includes(q) || kucult(e.model).includes(q)) ||
    !!g.eslesme;
  const adOnce = (g) => (kucult(g.baslik).includes(q) || kucult(g.projeAd || '').includes(q) || (g.eslesme && g.eslesme.ad)) ? 0 : 1;
  // Önce ad / proje eşleşmesi, sonra sohbet içeriği (sıralama kararlı: aynı sınıfta tarih sırası korunur).
  const liste = q ? S.gecmis.filter(eslesir).map((g, i) => [g, i]).sort((x, y) => adOnce(x[0]) - adOnce(y[0]) || x[1] - y[1]).map((x) => x[0]) : S.gecmis;
  if ($('gecmisSay')) $('gecmisSay').textContent = q ? `${liste.length}/${S.gecmis.length}` : (S.gecmis.length || '0');
  if (!liste.length) {
    const bos = `<div class="bos-satir">${q ? 'Aramayla eşleşen oturum yok.' : 'Kayıtlı oturum bulunamadı.'}</div>`;
    if (bos === gecmisSonHtml) return;
    gecmisSonHtml = bos;
    el.innerHTML = bos;
    return;
  }
  const aktifDevam = aktifOturum() ? aktifOturum().devam : null;
  const ignelenenList = [];
  const inProgress = [];
  const idle = [];
  for (const g of liste) {
    g._canli = !!(g.canli || g.turCanli || (g.calisanAjan > 0) || (g.calisanEvren > 0)); // kart kendi durumunu taşır: sabitlenen grupta da canlılık görünür
    g._acik = gecmisAcikMi(g);
  }
  // Arşivdekiler ayrı bölüme gider (etkin oturum arşivde olsa da normal listede kalır).
  const { normal, arsivli } = Gorunum.arsivAyir(liste, arsivlenenler, (g) => g._canli || g._acik);
  for (const g of normal) {
    if (ignelenenler.has(g.id)) {
      ignelenenList.push(g);
    } else if (g._canli || g._acik) {
      inProgress.push(g);
    } else {
      idle.push(g);
    }
  }
  // Kartın tek durum etiketi: soru > çalışıyor > açık > bitti > saat.
  function durumEtiketi(g, calisiyor, acik) {
    if (g.sonDurum === 'soru') return '<span class="seans-durum soru" title="Ajan soru sordu, cevap bekliyor"><svg class="ic" aria-hidden="true"><use href="#i-soru" /></svg><span>soru</span></span>';
    if (calisiyor) return '<span class="seans-durum canli" title="Bu oturum çalışıyor"><span class="led canli"></span><span>çalışıyor</span></span>';
    if (acik) return '<span class="seans-durum acik" title="Sekme açık, tur beklemede">açık</span>';
    // Bitti ayrı etiket almaz: geçmişte zaman yeter, satır sakin kalır (durum ipucu başlık metninde).
    return `<span class="seans-zaman"${g.sonDurum === 'bitti' ? ' title="Bu oturumda iş bitti"' : ''}>${kisaZaman(g.ms)}</span>`;
  }
  const kartHtml = (g, calisiyor, idx = 0) => {
    const secili = aktifDevam === g.id || (!!seciliOturumGecmisi && seciliOturumGecmisi.id === g.id);
    const sef = S.sefOturumlar.has(g.id) || (g.atalar || []).some((a) => S.sefOturumlar.has(a)) || S.oturumlar.some((o) => o.orkestrator && (o.devam === g.id || (g.atalar || []).includes(o.devam)));
    const tumAjanlar = Array.isArray(g.altAjanlar) ? g.altAjanlar : [];
    const tumIsler = Array.isArray(g.evrenIsleri) ? g.evrenIsleri : [];
    const dalVar = tumAjanlar.length + tumIsler.length > 0;
    const calisanToplam = (g.calisanAjan || 0) + (g.calisanEvren || 0);
    const rozetMetin = calisanToplam ? `${calisanToplam}/${tumAjanlar.length + tumIsler.length} iş` : `${tumAjanlar.length + tumIsler.length} iş`;
    const baslikEs = kucult(g.baslik).includes(q);
    const altAd = q && !baslikEs && g.eslesme && g.eslesme.alt ? g.eslesme.alt : '';
    const ajanlar = q && !baslikEs ? tumAjanlar.filter((a) => kucult(a.tanim).includes(q) || kucult(a.tur).includes(q) || a.tanim === altAd) : tumAjanlar;
    const isler = q && !baslikEs ? tumIsler.filter((e) => kucult(e.baslik).includes(q) || kucult(e.model).includes(q) || e.baslik === altAd) : tumIsler;
    // Eşleşme iç içe bir alt işteyse kartta adı görünür; EVREN işiyse tıklayınca o işin kaydı açılır.
    const altIs = altAd ? Gorunum.altIsBul(tumIsler, altAd) : null;
    const altEsHtml = altAd ? `<div class="seans-alt-es${altIs ? ' tikli' : ''}"${altIs ? ` data-alt-is="${esc(altIs.id)}" data-alt-ust="${esc(g.id)}" role="button" tabindex="0"` : ''} title="Eşleşen alt iş${altIs ? ' · kaydı aç' : ''}"><svg class="ic" aria-hidden="true"><use href="#i-branch" /></svg>${(() => { const ib = isBasligi(altAd); return ib ? `<span class="is-no mono">İŞ ${esc(ib.no)}</span><span>${esc(ib.ad)}</span>` : `<span>${esc(altAd)}</span>`; })()}</div>` : '';
    const ajanAcik = acikAjanlar.has(g.id) || (!!q && !altAd && ajanlar.length + isler.length > 0); // eşleşen alt iş kartta tek satır görünür; ağaç yinelenmesin
    const belirmeSinif = ilkGecmisYukleme ? ' belirme' : '';
    const gecikmeStil = ilkGecmisYukleme ? ` style="animation-delay: ${Math.min(idx * 25, 200)}ms;"` : '';
    const igneli = ignelenenler.has(g.id);
    const arsivde = arsivlenenler.has(g.id) && !(g._canli || g._acik);
    const pb = projeBilgi(g);
    const pbIpucu = pb.kaynak === 'elle' ? ' · elle taşındı' : pb.kaynak === 'cikarim' ? ' · yazılan dosyalardan çıkarıldı' : '';
    // Bu uygulamanın açtığı her oturum EVREN arka ucunda koşar. Kaynak, oturum dosyasındaki İLK asistan yanıtının
    // modelinden okunur; model henüz yazılmadıysa (kullanıcı mesajı gidip yanıt beklenirken) bilinmiyor demektir.
    // Bilinmeyeni Claude saymak yanlış rozet gösteriyordu: yalnız 'claude' kesin ise kıvılcım, gerisi EVREN.
    const evrenMi = g.kaynak !== 'claude' || g.evren;
    const kartCanli = g._canli ?? calisiyor;
    // Okunmamış: arka planda bitmiş/soru sormuş ve görülmemiş oturumda kaynak ikonunun yerine 5px vurgu noktası.
    const okunmadi = !kartCanli && Gorunum.okunmamisMi(g, gorulen, secili, gorulenTaban);
    const kaynakHtml = okunmadi
      ? '<span class="seans-okunmadi" role="img" aria-label="Okunmamış" title="Okunmamış: bu oturum arka planda bitti ya da soru sordu"></span>'
      : kaynakIsaret(evrenMi);
    const kartAcik = !!g._acik;
    const durumYazi = kartCanli ? 'çalışıyor' : g.sonDurum === 'soru' ? 'soru bekliyor' : g.sonDurum === 'bitti' ? 'bitti' : esc(goreli(g.ms / 1000));
    return `
      <div class="seans-kart${kartCanli ? ' canli' : ''}${secili ? ' sec-li' : ''}${sef ? ' sef' : ''}${igneli ? ' igneli' : ''}${arsivde ? ' arsivli' : ''}${belirmeSinif}"${gecikmeStil} role="option" aria-selected="${secili}" data-id="${esc(g.id)}" data-yol="${esc(g.projeYol)}" title="${esc(g.baslik)}
${esc(pb.ad)}${pbIpucu} · ${evrenMi ? 'EVREN' : 'Claude'} · ${durumYazi}">
        <div class="seans-satir-ust">
          ${kaynakHtml}
          <span class="seans-baslik">${esc(g.baslik)}</span>
          <button class="seans-ad-btn" type="button" data-adlandir="${esc(g.id)}" title="Oturumu adlandır">
            <svg class="ic"><use href="#i-edit" /></svg>
          </button>
          <button class="seans-arsiv-btn" type="button" data-arsivle="${esc(g.id)}" title="${arsivde ? 'Arşivden çıkar' : 'Arşivle (silmez, gizler)'}">
            <svg class="ic"><use href="#i-arsiv" /></svg>
          </button>
          <button class="seans-igne-btn${igneli ? ' aktif' : ''}" type="button" data-igne="${esc(g.id)}" title="${igneli ? 'İğneyi kaldır' : 'En üste iğnele'}">
            <svg class="ic"><use href="#i-pin" /></svg>
          </button>
          ${durumEtiketi(g, kartCanli, kartAcik)}
        </div>
        <div class="seans-satir-alt">
          ${sef ? '<span class="seans-sef mono">şef</span>' : ''}
          ${arsivde && q ? '<span class="seans-arsiv-etiket mono">arşivde</span>' : ''}
          <span class="seans-proje${pb.kaynak !== 'kendi' ? ' tasindi' : ''}">${esc(pb.ad)}</span>
          ${dalVar && (calisanToplam > 0 || ajanAcik) && !(q && g.eslesme && g.eslesme.sayi > 1) ? `<button class="tag-ajan${calisanToplam ? ' canli' : ''}" data-ajan-toggle="${esc(g.id)}" type="button" title="${tumAjanlar.length + tumIsler.length} alt görev${calisanToplam ? `, ${calisanToplam} çalışıyor` : ''}">${rozetMetin}</button>` : ''}
        </div>
        ${q && g.eslesme && !g.eslesme.ad && !baslikEs && g.eslesme.ornek ? `<div class="seans-eslesme" title="Sohbet içinde ${g.eslesme.sayi} eşleşme"><svg class="ic" aria-hidden="true"><use href="#i-search" /></svg><span>${esc(g.eslesme.ornek)}</span>${g.eslesme.sayi > 1 ? `<b class="mono">${g.eslesme.sayi}</b>` : ''}</div>` : ''}
        ${altEsHtml}
        ${dalVar && ajanAcik ? `
        <div class="ajan-agac${calisanToplam ? ' canli' : ''}">
          ${ajanlar.map((a) => `
            <div class="ajan" title="${esc(a.tanim)}${a.faz ? ' · ' + esc(a.faz) : ''}">
              <div class="ajan-satir">
                <span class="ajan-nokta${a.canli ? ' canli' : ''}"></span>
                <span class="ajan-tanim">${esc(a.tanim)}</span>
              </div>
              <div class="ajan-meta">
                ${a.tur ? `<span class="ajan-tur">${esc(a.tur)}</span>` : ''}
                ${a.isAkisi ? `<span class="ajan-wf">${esc(a.isAkisiAdi || 'wf')}${a.faz ? ' · ' + esc(a.faz) : ''}</span>` : ''}
                ${kisaModel(a.model) ? `<span class="ajan-model mono">${esc(kisaModel(a.model))}</span>` : ''}
                <span class="ajan-zaman mono">${esc(kisaZaman(a.ms))}</span>
              </div>
            </div>
          `).join('')}
          ${isler.map((e) => {
            const ib = isBasligi(e.baslik);
            return `
            <div class="ajan evren-is${evrenSinif(e.durum)}" data-evren-id="${esc(e.id)}" data-evren-dizin="${esc(e.dizin || '')}" data-evren-model="${esc(e.model || '')}" role="button" tabindex="0" title="${esc(e.baslik)} · ${esc(e.durum)}${e.dizin ? ' · ' + esc(e.dizin) : ''}">
              <div class="ajan-satir">
                <span class="ajan-nokta${evrenSinif(e.durum)}"></span>
                <span class="ajan-tanim">${ib ? `<span class="is-no mono">İŞ ${esc(ib.no)}</span> ${esc(ib.ad)}` : esc(e.baslik)}</span>
              </div>
              <div class="ajan-meta">
                ${kaynakIsaret(true)}
                ${kisaModel(e.model) ? `<span class="ajan-model mono">${esc(kisaModel(e.model))}</span>` : ''}
                <span class="ajan-zaman mono">${esc(kisaZaman(e.ms))}</span>
              </div>
            </div>
          `; }).join('')}
        </div>` : ''}
      </div>`;
  };
  // Grup başlığı gerçek bir düğme: Enter/Space ile katlanır, ok solda, sayı sağda hep görünür.
  // Arama varken eşleşen gruplar geçici olarak açık gösterilir; kayıtlı katlanma durumu değişmez.
  const grupHtml = (anahtar, etiket, kayitlar, calisiyor, ek = '', toplam, secenek = {}) => {
    if (!kayitlar.length) return '';
    const kapali = !q && (S.grupKapali[anahtar] ?? !!secenek.varsayilanKapali);
    const sayiHtml = secenek.sayiYok ? '' : `<span class="grup-sayi mono">${toplam || kayitlar.length}</span>`;
    const icerik = secenek.icHtml != null ? secenek.icHtml : kayitlar.map((g, i) => kartHtml(g, calisiyor, i)).join('');
    return `
      <div class="seans-grup${kapali ? ' kapali' : ''}" data-grup="${anahtar}">
        <button type="button" class="seans-grup-baslik" aria-expanded="${!kapali}" aria-controls="grup-${anahtar}" data-grup-dugme="${anahtar}">
          <svg class="ic grup-ok" aria-hidden="true"><use href="#i-chevron" /></svg>
          <span>${etiket}</span>
          ${sayiHtml}
        </button>
        ${secenek.baslikEk || ''}
        <div class="seans-grup-govde" id="grup-${anahtar}">
          <div class="seans-grup-ic">${icerik}${ek}</div>
        </div>
      </div>`;
  };
  // Tarih kümesinde boştaki oturumlar kısa listelenir (son 8, gerisi tek düğme); Proje kümesinde hepsi gruplanır.
  const projeKumesi = kumeBicimi === 'proje';
  const idleGorunen = q || gecmisIdleTumu || projeKumesi ? idle : idle.slice(0, GECMIS_IDLE_GORUNEN);
  const idleEk = !q && !projeKumesi && idle.length > GECMIS_IDLE_GORUNEN
    ? `<div class="seans-daha"><button type="button" class="seans-daha-btn" data-gecmis-daha="1">${gecmisIdleTumu ? 'Daha az göster' : `Daha eski oturumlar (${idle.length - GECMIS_IDLE_GORUNEN})`}</button></div>`
    : '';
  let sira = 0;
  const araBaslik = (ad, sayi) => `<div class="seans-ara-baslik"><span>${esc(ad)}</span>${sayi ? `<b class="mono">${sayi}</b>` : ''}</div>`;
  const kumeler = projeKumesi
    ? Gorunum.projeGrupla(idleGorunen, projeBilgi).map((k) => araBaslik(k.ad, k.ogeler.length) + k.ogeler.map((g) => kartHtml(g, false, sira++)).join(''))
    : Gorunum.tarihGrupla(idleGorunen).map((k) => araBaslik(k.ad) + k.ogeler.map((g) => kartHtml(g, false, sira++)).join(''));
  const kumeAnahtar = `<div class="kume-anahtar" role="group" aria-label="Geçmişi kümele">
      <button type="button" data-kume="tarih" aria-pressed="${!projeKumesi}" title="Tarihe göre kümele">Tarih</button>
      <button type="button" data-kume="proje" aria-pressed="${projeKumesi}" title="Projeye göre kümele">Proje</button>
    </div>`;
  // Grup "çalışan + açık" ikisini birden taşır: kart kendi etiketini yazar (çalışıyor/açık/soru),
  // başlık ikisini kapsayan tek kelimedir — yalnız "Çalışıyor" demek boştaki açık kartları yanlış adlandırıyordu.
  const html = grupHtml('ignelenenler', 'Sabitlenenler', ignelenenList, null) + grupHtml('calisiyor', 'Etkin', inProgress, true) +
    grupHtml('bosta', 'Geçmiş', idleGorunen, false, idleEk, idle.length, { icHtml: kumeler.join(''), baslikEk: idle.length ? kumeAnahtar : '' }) +
    grupHtml('arsiv', `Arşiv (${arsivli.length})`, arsivli, false, '', null, { varsayilanKapali: true, sayiYok: true });
  // Aynı HTML'i yeniden yazmayız: kaydırma yeri ve fare altındaki satır bozulmasın.
  if (html === gecmisSonHtml) return;
  gecmisSonHtml = html;
  const kaydirma = el.scrollTop;
  el.innerHTML = html;
  el.scrollTop = kaydirma;
  ilkGecmisYukleme = false;
}
// Grup başlığına tıklama: yalnız sınıf ve kayıt değişir, liste yeniden çizilmez (animasyon akıcı kalır).
function grupKatla(dugme) {
  const anahtar = dugme.dataset.grupDugme;
  if (!anahtar) return;
  const acik = dugme.getAttribute('aria-expanded') !== 'true';
  dugme.setAttribute('aria-expanded', String(acik));
  const grup = dugme.closest('.seans-grup');
  if (grup) grup.classList.toggle('kapali', !acik);
  S.grupKapali = { ...S.grupKapali, [anahtar]: !acik };
  sakla.yaz('grupKapali', S.grupKapali);
}
// Zaten açık sohbete yönlendirildiğinde paneli kısa bir ışıkla belli eder.
function sohbetVurgula() {
  const panel = $('sohbetPanel');
  if (!panel) return;
  panel.classList.remove('vurgu');
  void panel.offsetWidth; // animasyonu yeniden başlat
  panel.classList.add('vurgu');
  setTimeout(() => panel.classList.remove('vurgu'), 700);
  setTimeout(() => sigdir(), 40);
}
async function oturumIzle(g) {
  if (!g || !g.id) return;
  // Aynı sohbet zaten izleniyorsa baştan yükleme: ikinci kopya açılmış gibi görünmesin.
  if (seciliOturumGecmisi && seciliOturumGecmisi.id === g.id) {
    const p = $('sohbetPanel');
    if (p) p.hidden = false;
    S.sohbetAcik = true;
    sohbetVurgula();
    return;
  }
  seciliOturumGecmisi = g;
  gorunumUygula();
  sekmeleriCiz();
  gecmisCiz();
  await sohbetYukle(true);
  sohbetIgneDurumGuncelle();
  setTimeout(() => sigdir(), 80);
}
// Alt iş (EVREN işi) kaydını okuma görünümünde açar; kayıt üst oturumun proje klasöründedir.
function altIsAc(ustId, isId) {
  const ust = S.gecmis.find((x) => x.id === ustId);
  const is = ust && (ust.evrenIsleri || []).find((e) => e.id === isId);
  if (!ust || !is) return;
  const var_ = S.oturumlar.find((o) => o.canli && o.devam === is.id);
  if (var_) { sekmeSec(var_.id); return; }
  oturumIzle({ id: is.id, projeYol: is.dizin || ust.projeYol, yedekYol: ust.projeYol, baslik: is.baslik, projeAd: ust.projeAd, model: is.model, altIs: true, ms: is.ms });
}
// ---- Sohbet · Terminal · Dosyalar görünümü ----
// Üç görünüm tek anahtardan seçilir ve oturum başına localStorage'da hatırlanır. Canlı oturumda Sohbet ve Dosyalar
// terminalin üstüne binen panelde, Terminal panelsiz görünür. Geçmiş (salt okunur) oturumda Terminal "Devam et"tir.
function oturumGorunumu(o) {
  // Kayıtlı seçim varsa o; yoksa varsayılan (terminal — sohbet salt okunur, yazı terminalden gider).
  return Gorunum.oku(S.gorunumler, Gorunum.anahtar(o), Gorunum.VARSAYILAN);
}
function gorunumKur(o, deger) {
  if (!o) return;
  S.gorunumler = Gorunum.yaz(S.gorunumler, Gorunum.anahtar(o), deger);
  sakla.yaz('gorunumler', S.gorunumler);
  gorunumUygula();
}
// Görünen görünüm: canlı oturumda kayıtlı seçim, okunan geçmişte Sohbet ya da Dosyalar; oturum yoksa null.
function aktifGorunum() {
  if (seciliOturumGecmisi) return Gorunum.oku(S.gorunumler, 'd:' + seciliOturumGecmisi.id, 'sohbet') === 'dosyalar' ? 'dosyalar' : 'sohbet';
  const o = aktifOturum();
  return o && o.term ? oturumGorunumu(o) : null;
}
function gorunumSec(deger) {
  if (!Gorunum.GORUNUMLER.includes(deger)) return false;
  const g = seciliOturumGecmisi;
  if (g) {
    if (deger === 'terminal') { okumaDevamEt(); return true; }
    S.gorunumler = Gorunum.yaz(S.gorunumler, 'd:' + g.id, deger);
    sakla.yaz('gorunumler', S.gorunumler);
    gorunumUygula();
    return true;
  }
  const o = aktifOturum();
  if (!o || !o.term) return false;
  gorunumKur(o, deger);
  return true;
}
// Ctrl+Shift+H: Sohbet → Terminal → Dosyalar → Sohbet
function gorunumDon() {
  const g = aktifGorunum();
  return g ? gorunumSec(Gorunum.sonraki(g)) : false;
}
function gorunumSayiGuncelle() {
  const b = $('gorunumDosyaSay');
  if (!b) return;
  const h = ciktiParametresi();
  const n = h && S.ciktilar && S.ciktiAnahtar === h.anahtar ? S.ciktilar.length : 0;
  b.textContent = n;
  b.hidden = !n;
}
// Panelin, anahtarın, tuş şeridinin ve karşılama kartının görünürlüğü tek yerden belirlenir.
function gorunumUygula() {
  const panel = $('sohbetPanel');
  if (!panel) return;
  const izleme = !!seciliOturumGecmisi;
  const o = izleme ? null : aktifOturum();
  const canli = !!(o && o.term);
  const gorunum = aktifGorunum();
  const mod = gorunum === 'sohbet' || gorunum === 'dosyalar' ? gorunum : null;
  const goster = !!mod;
  if (mod && mod !== S.panelMod) { sohbetSonAnahtar = ''; S.ciktiImza = ''; } // içerik türü değişti: önbellek geçersiz
  if (mod) S.panelMod = mod;
  panel.hidden = !goster;
  S.sohbetAcik = goster;
  panel.classList.toggle('izleme', izleme);
  panel.classList.toggle('canli', canli);
  panel.classList.toggle('mod-dosyalar', mod === 'dosyalar');
  if ($('sohbetForkBtn')) $('sohbetForkBtn').hidden = !izleme || !!seciliOturumGecmisi.altIs;
  if ($('sohbetDevamBtn')) $('sohbetDevamBtn').hidden = !izleme;
  // Yazı çubuğu yalnız canlı oturumun sohbetinde: mesaj oturumun kendi terminaline yazılır.
  // Okuma görünümünde (bitmiş kayıt) yazılacak PTY yoktur — "Devam et" kapısı zaten başlıkta.
  if ($('sohbetGonder')) $('sohbetGonder').hidden = !(canli && mod === 'sohbet');
  const bar = $('gorunumBar');
  if (bar) {
    bar.hidden = !gorunum;
    for (const b of bar.querySelectorAll('[data-g]')) {
      const on = b.dataset.g === gorunum;
      b.classList.toggle('aktif', on);
      b.setAttribute('aria-selected', String(on));
    }
  }
  const serit = $('tusSerit');
  const terminalGorunur = canli && gorunum === 'terminal';
  if (serit) serit.hidden = !terminalGorunur;
  if (!terminalGorunur) { if ($('termIpucu')) $('termIpucu').hidden = true; }
  if (!terminalGorunur || (o && S.araOturum !== o.id)) termAraKapat(false);
  if (mod !== 'dosyalar') gorselKatmanKapat();
  // Oturum seçiliyken (canlı ya da okunan) karşılama kartı orta alanı kaplamaz.
  const brif = $('brif');
  if ((izleme || canli) && brif && !brif.hidden) brifGizle();
  sohbetBasligiGuncelle();
  gorunumSayiGuncelle();
  if (goster) sohbetYukle(true);
  else if (canli) { sigdir(); setTimeout(() => o.term.focus(), 0); }
  setTimeout(() => sigdir(), 80);
  webglSenkronla(); // terminal ↔ sohbet/dosyalar geçişinde bağlam yalnız terminal görünümünde kalır
  sohbetAboneSenkronla(); // sohbet görünümü açıldıysa push aboneliği kur, terminale geçildiyse bırak
}
// Okuma görünümünden çık: karşılama ya da etkin sekme geri gelir.
function okumaKapat() {
  if (!seciliOturumGecmisi) return;
  seciliOturumGecmisi = null;
  S.sohbetAcik = false;
  sohbetSonAnahtar = '';
  if (S.aktif == null || !aktifOturum()) brifGoster();
  gorunumUygula();
  sekmeleriCiz();
  gecmisCiz();
  sohbetIgneDurumGuncelle();
  sohbetAboneSenkronla(); // okuma modu kapandı: push aboneliği etkin sekmeye döner
}
// "Devam et": oturumu bugünkü gibi terminalde sürdürür (hedef terminal görünümünde açılır).
function okumaDevamEt() {
  const g = seciliOturumGecmisi;
  if (!g || !g.id) return;
  const var_ = canliSekmeBul(g.id);
  if (var_) { gorunumKur(var_, 'terminal'); sekmeSec(var_.id); return; }
  S.gorunumler = Gorunum.yaz(S.gorunumler, 'd:' + g.id, 'terminal');
  sakla.yaz('gorunumler', S.gorunumler);
  const dizin = (g.projeYol || '').trim() || S.proje;
  basla(g.id, { dizin, modelId: (g.model || '').trim() });
}
let gecmisAraZaman = null;
let gecmisAraIstek = 0;
// Başlık anında süzülür; sohbet içeriği 260 ms sonra iş parçacığında aranır (oturum başına son ~350 KB).
function gecmisIcerikAra() {
  const q = gecmisAra.trim();
  const no = ++gecmisAraIstek;
  if (q.length < 2) {
    for (const g of S.gecmis) delete g.eslesme;
    gecmisCiz();
    return;
  }
  const turler = S.gecmis.filter((g) => g.projeYol && g.id).map((g) => ({ id: g.id, projeYol: g.projeYol, baslik: g.baslik, projeAd: g.projeAd, ekler: [...(g.altAjanlar || []).map((a) => a.tanim), ...(g.evrenIsleri || []).map((e) => e.baslik)] }));
  window.evren.gecmisAra(turler, q).then((sonuc) => {
    if (no !== gecmisAraIstek) return;
    for (const g of S.gecmis) g.eslesme = (sonuc && sonuc[g.id]) || null;
    gecmisCiz();
  }).catch(() => {});
}

async function gecmisYukle() {
  const no = ++gecmisIstek;
  try {
    await tercihHazir;
    const hepsi = await window.evren.gecmis().catch(() => []);
    if (no !== gecmisIstek) return;
    // Claude Code oturumları varsayılan gizli; sekmesi açık olanlar ve EVREN oturumları her zaman görünür.
    S.gecmis = Gorunum.claudeSuz(Array.isArray(hepsi) ? hepsi : [], claudeGoster(), gecmisAcikMi);
    const igneParam = new URLSearchParams(location.search).get('igne');
    if (igneParam && S.gecmis.length > 0) {
      const hedefId = igneParam === '1' ? S.gecmis[0].id : igneParam;
      ignelenenler.add(hedefId);
    }
    gecmisCiz();
    projeCikarimiIste(S.gecmis);
    if (gecmisAra.trim().length >= 2) gecmisIcerikAra();
    if (typeof Takimyildiz !== 'undefined' && Takimyildiz.guncelle) {
      Takimyildiz.guncelle();
    }
  } catch (e) {
    console.error('Geçmiş yüklenemedi:', e);
  }
}
function gecmisAc(id) {
  const var_ = canliSekmeBul(id);
  if (var_) { sekmeSec(var_.id); return; }
  // Oturum kendi klasöründe sürsün; proje seçili olması şart değil.
  const g = S.gecmis.find((x) => x.id === id);
  basla(id, { dizin: (g && g.projeYol) || '', modelId: (g && g.model) || '' });
}
// EVREN işini kendi dizininde ve modeliyle sürdürür (claude --resume <id>); açık sekme varsa ona geçer.
function evrenIsiniSurdur(el) {
  const id = el && el.dataset.evrenId;
  if (!id) return;
  const var_ = S.oturumlar.find((o) => o.canli && o.devam === id);
  if (var_) { sekmeSec(var_.id); return; }
  basla(id, { dizin: (el.dataset.evrenDizin || '').trim() || S.proje, modelId: (el.dataset.evrenModel || '').trim() });
}
// ---------- proje özeti: commit ısı haritası, dil dağılımı, son commit ----------
let prjIstek = 0;
const goreli = (sn) => {
  const f = Math.max(0, Date.now() / 1000 - sn);
  if (f < 60) return 'az önce';
  if (f < 3600) return `${Math.floor(f / 60)} dk önce`;
  if (f < 86400) return `${Math.floor(f / 3600)} sa önce`;
  if (f < 86400 * 30) return `${Math.floor(f / 86400)} gün önce`;
  return `${Math.floor(f / (86400 * 30))} ay önce`;
};
async function projeOzetYukle() {
  const yol = S.proje, no = ++prjIstek;
  const isi = $('isi');
  if (!yol) { isi.innerHTML = ''; $('prjOzet').textContent = '—'; $('sonCommit').textContent = 'proje seçilmedi'; $('dilBar').innerHTML = ''; $('dilAd').innerHTML = ''; return; }
  isi.classList.add('bekliyor');
  const v = await window.evren.projeOzet(yol).catch(() => ({ git: false }));
  if (no !== prjIstek) return; // bu arada başka proje seçildi
  isi.classList.remove('bekliyor');
  if (!v || !v.git) {
    isi.innerHTML = '<div class="prj-bos">git deposu değil · geçmiş yok</div>';
    $('prjOzet').textContent = 'git yok'; $('dilBar').innerHTML = ''; $('dilAd').innerHTML = ''; $('sonCommit').textContent = '—';
    return;
  }
  const mx = Math.max(1, ...v.gunler);
  const seviye = (n) => (n === 0 ? 0 : n >= mx * 0.75 ? 4 : n >= mx * 0.45 ? 3 : n >= mx * 0.2 ? 2 : 1);
  isi.innerHTML = v.gunler.map((n, i) => {
    const gunOnce = 181 - i;
    return `<i class="s${seviye(n)}" style="animation-delay:${(Math.floor(i / 7) * 14)}ms" title="${gunOnce === 0 ? 'bugün' : gunOnce + ' gün önce'} · ${n} commit"></i>`;
  }).join('');
  $('prjOzet').textContent = `${v.toplamCommit} commit · 26 hf`;
  const ton = ['#e6e8eb', '#a2aab5', '#6d7581', '#4b525c', '#2c333c'];
  const ilk = v.diller.slice(0, 4);
  const diger = v.diller.slice(4).reduce((s, d) => s + d.oran, 0);
  const parca = diger > 0.005 ? [...ilk, { ad: 'diğer', oran: diger }] : ilk;
  $('dilBar').innerHTML = parca.map((d, i) => `<i style="width:${(d.oran * 100).toFixed(2)}%;background:${ton[i]};animation-delay:${i * 60}ms" title="${esc(d.ad)} %${Math.round(d.oran * 100)}"></i>`).join('');
  $('dilAd').innerHTML = parca.map((d, i) => `<span><i style="background:${ton[i]}"></i>${esc(d.ad)} <b>${Math.round(d.oran * 100)}%</b></span>`).join('') +
    `<span class="sag">${v.dosya.toLocaleString('tr-TR')} dosya${v.degisen ? ` · <b>${v.degisen}</b> değişiklik` : ''}</span>`;
  $('sonCommit').innerHTML = v.son
    ? `<b>${esc(v.son.hash)}</b> <em>${esc(goreli(Number(v.son.ne)))}</em> ${esc(v.son.mesaj)}`
    : 'henüz commit yok';
  $('sonCommit').title = v.son ? v.son.mesaj : '';
}
// ---------- olay günlüğü (zaman çizelgesi) ----------
let olaySayisi = 0;
const saat = (z) => [z.getHours(), z.getMinutes(), z.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':');
function olay(tur, metin, sinif = '') {
  const ol = $('olaylar');
  const li = document.createElement('li');
  li.className = 'olay' + (sinif ? ' ' + sinif : '');
  li.innerHTML = `<time>${saat(new Date())}</time><b>${esc(tur)}</b><span title="${esc(metin)}">${esc(metin)}</span>`;
  ol.prepend(li);
  while (ol.children.length > 40) ol.lastChild.remove();
  $('olaySay').textContent = ++olaySayisi;
}
function listeKlavye(listeId, getir, sec) {
  $(listeId).addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const { liste, deger } = getir();
    if (!liste.length) return;
    const i = Math.max(0, liste.indexOf(deger));
    sec(liste[(i + (e.key === 'ArrowDown' ? 1 : -1) + liste.length) % liste.length]);
  });
  $(listeId).addEventListener('click', (e) => {
    const r = e.target.closest('.row');
    if (r) sec(r.dataset.id);
    if (e.target.closest('[data-eylem="ekle"]')) klasorEkle();
  });
}
// ---------- özet: başlık, brifing kartı, durum çubuğu ----------
function hucre(id, metin) {
  const el = $(id);
  if (el.textContent === metin) return;
  el.textContent = metin;
  const dd = el.closest('.stat, dd');
  if (dd && S.yuklendi && !AZ_HAREKET) { dd.classList.remove('guncel'); void dd.offsetWidth; dd.classList.add('guncel'); }
}
function ozetYaz() {
  const m = seciliModel() || {};
  const p = seciliProje();
  $('crProje').textContent = p ? p.ad : 'Projesiz';
  $('crDal').textContent = p && p.dal ? p.dal : '—';
  hucre('bModel', m.ad || m.id || '—');
  $('bModelId').textContent = m.ad && m.id ? m.id : '';
  hucre('bBaglam', kisaBaglam(m.baglamSayisi));
  $('bBaglamS').textContent = m.baglamSayisi ? `${m.baglamSayisi.toLocaleString('tr-TR')} token` : 'bilinmiyor';
  hucre('bCikti', m.cikti ? kisaBaglam(m.cikti) : 'Oto');
  $('bCiktiS').textContent = m.cikti ? `${m.cikti.toLocaleString('tr-TR')} token` : 'model varsayılanı';
  hucre('bProje', p ? p.ad : 'Projesiz');
  $('bYol').textContent = p ? kisaYol(p.yol, 46) : kisaYol(S.serbestDizin || '', 46);
  hucre('bDal', p && p.dal ? p.dal : '—');
  $('bDalS').textContent = p ? (p.dal ? 'git deposu' : 'git deposu değil') : 'serbest çalışma alanı';
  const hazir = S.yuklendi && S.anahtarVar && !!m.id;
  $('baslaBtn').disabled = !hazir;
  $('baslaBtn2').disabled = !hazir;
  $('uyari').hidden = S.anahtarVar;
  $('anahtarForm').hidden = S.anahtarVar || !S.yuklendi;
  if (!S.anahtarVar && !S.anahtarHata) $('uyariMetin').innerHTML = `EVREN API anahtarı yok. Anahtarı <a href="#" data-dis="https://evren.ssyz.org.tr">evren.ssyz.org.tr</a> üzerinden (e-Devlet ile giriş) alıp aşağıya yapıştırın. Anahtar ${S.platform === 'win32' ? 'bu Windows hesabına' : 'bu kullanıcı hesabına'} bağlı olarak ${kasaAdi(S.platform)} ile şifrelenir.`;
  else if (S.yuklendi && !p) { $('uyari').hidden = false; $('uyariMetin').textContent = 'Proje seçilmedi. Başlatınca klasör sorulur.'; }
  durumYaz(true); // 15 sn'lik tazeleme: sekme şeridini yeniden kurmaz, fazladan oturum-baglam IPC'si açmaz
}

function tokenFormatla(n) {
  if (n == null || isNaN(n)) return '—';
  const num = Number(n);
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1000) return Math.round(num / 1000) + 'K';
  return String(num);
}
function baglantiYaz() {
  const a = S.api;
  const led = $('led'), sLed = $('sLed');
  let sinif = '', metin = 'Bağlanıyor…';
  if (!S.anahtarVar) { sinif = 'uyari'; metin = 'Anahtar yok'; }
  else if (a && a.ok) { sinif = 'iyi'; metin = 'Çevrimiçi'; }
  else if (a) { sinif = 'kotu'; metin = 'Erişilemiyor' + (a.hata ? ` · ${a.hata}` : ''); }
  led.className = 'led ' + sinif;
  sLed.className = 'led ' + sinif;
  $('apiDurum').textContent = metin;
  $('apiMs').textContent = a && a.ok ? `${a.ms} ms` : '—';
  $('kasa').textContent = !S.anahtarVar ? 'kasa boş' : S.platform === 'win32' ? 'DPAPI · hazır' : S.platform === 'darwin' ? 'Keychain · hazır' : 'kasa · hazır';
  // Kota ve Token hesaplama
  const apiKotaEl = $('apiKota');
  const sKotaMetin = $('sKotaMetin');
  const kotaKalanSayi = $('kotaKalanSayi');
  const kotaKullanilanMetin = $('kotaKullanilanMetin');
  const kotaSifirlanmaMetin = $('kotaSifirlanmaMetin');
  const kotaBarDolgu = $('kotaBarDolgu');
  const kotaYuzdeMetin = $('kotaYuzdeMetin');
  if (a && a.kota) {
    const k = a.kota;
    const gunlukLimit = Number(k.daily_limit_tokens) || 15000000;
    const gunlukKullanilan = Number(k.daily_used_tokens) || 0;
    const gunlukKalan = k.daily_remaining_tokens != null ? Number(k.daily_remaining_tokens) : Math.max(0, gunlukLimit - gunlukKullanilan);
    const yuzde = Math.min(100, Math.max(0, (gunlukKullanilan / gunlukLimit) * 100));
    // Sıfırlanma süresi hesapla (k.daily_reset_at)
    let sifirlanmaFarkMetni = '';
    if (k.daily_reset_at) {
      const resetDate = new Date(k.daily_reset_at);
      const diffMs = resetDate.getTime() - Date.now();
      if (diffMs > 0) {
        const sa = Math.floor(diffMs / (1000 * 60 * 60));
        const dk = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        sifirlanmaFarkMetni = `${sa} sa ${dk} dk sonra sıfırlanır`;
      }
    }
    if (kotaKalanSayi) kotaKalanSayi.textContent = gunlukKalan.toLocaleString('tr-TR');
    if (kotaKullanilanMetin) {
      kotaKullanilanMetin.textContent = `${gunlukKullanilan.toLocaleString('tr-TR')} / ${gunlukLimit.toLocaleString('tr-TR')}`;
    }
    if (kotaSifirlanmaMetin) {
      kotaSifirlanmaMetin.textContent = sifirlanmaFarkMetni || '03:00 TSİ sıfırlanır';
    }
    if (kotaYuzdeMetin) {
      kotaYuzdeMetin.textContent = `%${yuzde.toFixed(1)}`;
    }
    KotaSerit.ekle(gunlukKullanilan);
      if (kotaBarDolgu) {
      kotaBarDolgu.style.width = `${yuzde.toFixed(1)}%`;
      kotaBarDolgu.className = 'kota-bar-dolgu' + (yuzde >= 90 ? ' kritik' : (yuzde >= 70 ? ' uyari' : ''));
    }
    if (apiKotaEl) {
      apiKotaEl.textContent = `${tokenFormatla(gunlukKalan)} / ${tokenFormatla(gunlukLimit)}`;
      apiKotaEl.title = `Kalan: ${gunlukKalan.toLocaleString('tr-TR')} token (%${(100 - yuzde).toFixed(1)})`;
    }
    if (sKotaMetin) {
      sKotaMetin.textContent = `${tokenFormatla(gunlukKalan)} token`;
    }
  } else {
    if (kotaKalanSayi) kotaKalanSayi.textContent = '—';
    if (kotaKullanilanMetin) kotaKullanilanMetin.textContent = S.anahtarVar ? (a && a.ok ? '—' : 'alınamadı') : 'anahtar yok';
    if (kotaYuzdeMetin) kotaYuzdeMetin.textContent = '—';
    if (kotaBarDolgu) kotaBarDolgu.style.width = '0%';
    if (apiKotaEl) apiKotaEl.textContent = S.anahtarVar ? (a && a.ok ? '—' : 'alınamadı') : '—';
    if (sKotaMetin) sKotaMetin.textContent = '—';
  }
    $('sApiMetin').textContent = a && a.ok ? `API ${a.ms} ms` : (S.anahtarVar ? (a ? 'API yok' : 'API …') : 'Anahtar yok');
  $('sApi').classList.toggle('kotu', !!a && !a.ok);
  hucre('bGecikme', a && a.ok ? `${a.ms} ms` : '—');
  const v = S.pingler.filter((x) => x != null);
  $('bGecikmeS').textContent = v.length > 1 ? `ort. ${Math.round(v.reduce((s, x) => s + x, 0) / v.length)} ms · ${v.length} ölçüm` : metin;
  $('hazirLed').className = 'led ' + sinif;
  $('hazirMetin').textContent = !S.anahtarVar ? 'Anahtar yok' : a && a.ok ? 'Hazır' : a ? 'Çevrimdışı' : 'Bağlanıyor';
  $('hazirPill').className = 'pill ' + sinif;
}

// ---------- veri ----------
const modelImza = (l) => l.map((m) => m.id + ':' + (m.baglamSayisi || '') + ':' + (m.cikti || '')).join('|');
async function yukle() {
  modelleriCiz(); projeleriCiz();
  try {
    const d = await window.evren.durum();
    S.anahtarVar = !!d.anahtarVar;
    S.surum = d.surum || '';
    S.platform = d.platform || 'win32';
    S.modeller = d.modeller || [];
    S.projeler = d.projeler || [];
    S.sonKlasorler = d.sonKlasorler || [];
    S.serbestDizin = d.serbestDizin || '';
    S.sonEfor = d.sonEfor || 'medium';
    S.eforlar = d.eforlar || [];
    S.uyku = d.uyku !== false;
    S.ayar.claudeOturumlari = d.claudeOturumlari === true;
    S.model = S.modeller.some((m) => m.id === d.sonModel) ? d.sonModel : (S.modeller[0] && S.modeller[0].id) || '';
    S.proje = (S.projeler[0] && S.projeler[0].yol) || '';
    // Test/otomasyon: ?proje=<yol> açılışta o projeyi seçer (listedeyse onu, değilse listenin başına ekler).
    const istenen = new URLSearchParams(location.search).get('proje');
    if (istenen) {
      if (!S.projeler.some((p) => p.yol === istenen)) S.projeler = [{ yol: istenen, ad: istenen.split(/[\\/]/).filter(Boolean).pop() || istenen, dal: '' }, ...S.projeler];
      S.proje = istenen;
    }
    // Test/otomasyon: ?ara=<metin> arama kutusunu doldurur (ajan ağaçları açık gelir).
    const araParam = new URLSearchParams(location.search).get('ara');
    if (araParam && $('gecmisAra')) { gecmisAra = araParam; $('gecmisAra').value = araParam; }
  } catch (e) { console.error('durum', e); }
  S.yuklendi = true;
  modelleriCiz(); projeleriCiz(); ozetYaz(); baglantiYaz(); uykuDugmeCiz(); claudeBtnCiz();
  olay('SİSTEM', `EVREN Desktop ${S.surum || ''} hazır`.replace('  ', ' '));
  olay('KASA', S.anahtarVar ? kasaAdi(S.platform) + ' anahtarı yüklendi' : 'anahtar bulunamadı', S.anahtarVar ? '' : 'uyari');
  olay('PROJE', `${S.projeler.length} proje · ${S.projeler.filter((p) => p.dal).length} git deposu`);
  Grafik.basla();
  projeOzetYukle();
  gecmisYukle();
  apiYenile();
  setTimeout(() => { if (typeof Kare !== 'undefined') console.log('[kare:p95]', Kare.p95().toFixed(2) + ' ms'); }, 3000);
  // Boşta 15 sn'de bir ölçüm (gecikme grafiği canlı kalsın); oturumda 60 sn; pencere gizliyken hiç.
  let tik = 0;
  setInterval(() => { tik++; if (!document.hidden && (!S.calisiyor || tik % 4 === 0)) apiYenile(); }, 15000);
  // Geçmiş: pencere görünürken 15 sn'de bir (çalışıyor/bitti durumu güncel kalsın).
  setInterval(() => { if (!document.hidden && !gecmisAra.trim()) gecmisYukle(); }, 15000);
}
async function apiYenile() {
  const btn = $('yenileBtn');
  btn.classList.add('donuyor');
  try {
    const r = await window.evren.api();
    if (r.anahtarVar === false) S.anahtarVar = false;
    else if (r.anahtarVar) S.anahtarVar = true;
    S.api = r.anahtarVar === false ? null : r;
    if (r.anahtarVar !== false) {
      S.pingler.push(r.ok ? r.ms : null); if (S.pingler.length > 24) S.pingler.shift();
      const ilk = S.pingler.length === 1;
      olay(ilk ? 'API' : 'PING', r.ok ? `${ilk ? '/v1/models 200 · ' : ''}${r.ms} ms` : `hata · ${r.hata || 'yanıt yok'}`, r.ok ? (ilk ? 'iyi' : '') : 'kotu');
    }
    if (r.modeller && r.modeller.length && !S.calisiyor && modelImza(r.modeller) !== modelImza(S.modeller)) {
      S.modeller = r.modeller;
      if (!S.modeller.some((m) => m.id === S.model)) S.model = S.modeller[0].id;
      modelleriCiz();
      olay('KATALOG', `${S.modeller.length} model · canlı liste`);
    }
  } catch (e) { S.api = { ok: false, hata: e.message }; olay('API', `hata · ${e.message}`, 'kotu'); }
  btn.classList.remove('donuyor');
  baglantiYaz(); ozetYaz();
}
// Tek seferlik klasör: proje kaydı oluşturmaz, yalnız bu oturum o klasörde çalışır.
async function klasorEkle() {
  yeniOturumModalAc();
  const sec = await window.evren.klasorSec();
  if (!sec) return false;
  modalSecim = { tip: 'klasor', yol: sec.yol, ad: sec.ad, dal: sec.dal };
  S.sonKlasorler = [sec, ...S.sonKlasorler.filter((x) => x.yol !== sec.yol)].slice(0, 8);
  yeniOturumModalGuncelle();
  return true;
}
// Son projeler listesinden kaldırır (disk silinmez). Seçili proje kaldırıldıysa sıradakine geçer.
async function projeListedenSil(yol) {
  if (!yol) return;
  try {
    const r = await window.evren.projeSil(yol);
    if (!r || !r.ok) return;
    S.projeler = r.projeler || [];
    if (S.proje === yol) { S.proje = ''; projeSec(S.projeler[0] ? S.projeler[0].yol : ''); }
    if (modalSecim && modalSecim.tip === 'proje' && modalSecim.yol === yol) modalSecim = { tip: 'bos' };
    projeleriCiz(); yeniOturumModalGuncelle(); ozetYaz(); projeOzetYukle();
    olay('PROJE', 'Listeden kaldırıldı · ' + (yol.split(/[\\/]/).filter(Boolean).pop() || yol));
  } catch (e) {
    olay('PROJE', 'Kaldırılamadı · ' + String(e.message || e).slice(0, 60), 'kotu');
  }
}
// ---------- terminal (her oturumun kendi xterm örneği) ----------
const TEMA = {
  background: '#07090b', foreground: '#d8dde3', cursor: '#e6e8eb', cursorAccent: '#07090b',
  selectionBackground: 'rgba(255,255,255,0.18)',
  black: '#1e242c', red: '#ec6a6e', green: '#3fbf86', yellow: '#ecb45c',
  blue: '#6ea8f5', magenta: '#c49af0', cyan: '#5cc4d2', white: '#c9d1d9',
  brightBlack: '#4a535d', brightRed: '#ff8a8d', brightGreen: '#6fdcab', brightYellow: '#ffd27e',
  brightBlue: '#9cc4ff', brightMagenta: '#dcb8ff', brightCyan: '#8be0ea', brightWhite: '#ffffff',
};
// Orkestratör oturumu: aynı okunabilirlik, hafif menekşe zemin ve imleç. Rolü bir bakışta ayırır.
const TEMA_ORK = {
  ...TEMA,
  background: '#0d0a17', foreground: '#e1dcec', cursor: '#e0c2ff', cursorAccent: '#0d0a17',
  selectionBackground: 'rgba(190,150,255,0.22)',
  brightBlack: '#544a63', brightMagenta: '#e0c2ff',
};
const GENEL_TUS = new Set(['KeyP', 'KeyB', 'KeyT', 'KeyW', 'KeyF', 'KeyH']); // Ctrl+Shift+<tuş>: uygulamaya ait
// ---------- tek-aktif WebGL bağlamı (GPU bütçesi) ----------
// Chromium eşzamanlı WebGL bağlam sayısını ~8-16 ile sınırlar; her sekmenin kalıcı bağlam
// tutması 8+ sekmede sınırları tüketip GPU sürecini ~660 MB'a şişiriyordu. Bağlamı yalnız
// GÖRÜNÜR etkin terminal sekmesi taşır; geri kalan her sekme bağlamı anında bırakır.
function webglBagla(o) {
  if (!o || !o.term || !WebglSinif || o.webgl || o._webglYasak) return;
  if (!o.el || o.el.hidden) return;
  try {
    const w = new WebglSinif();
    w.onContextLoss(() => {
      try { w.dispose(); } catch {}
      if (o.webgl === w) {
        o.webgl = null;
        webglAktifSayi = Math.max(0, webglAktifSayi - 1);
        if (o.el) o.el.dataset.webgl = '0';
      }
    });
    o.term.loadAddon(w);
    o.webgl = w;
    webglAktifSayi++;
    o.el.dataset.webgl = '1';
  } catch {
    o.webgl = null;
    o._webglYasak = true; // bu oturumda WebGL bir daha denemez: canvas çizimine düşer
    if (o.el) o.el.dataset.webgl = '0';
  }
}
function webglBirak(o) {
  if (!o || !o.webgl) return;
  const w = o.webgl;
  o.webgl = null;
  webglAktifSayi = Math.max(0, webglAktifSayi - 1);
  if (o.el) o.el.dataset.webgl = '0';
  try { w.dispose(); } catch {}
}
function webglSenkronla() {
  const aktif = aktifOturum();
  const terminalGorunur = !seciliOturumGecmisi && aktif && aktif.term && aktifGorunum() === 'terminal';
  for (const x of S.oturumlar) {
    if (!terminalGorunur || x.id !== aktif.id) webglBirak(x);
  }
  if (terminalGorunur) {
    webglBagla(aktif);
    // Bağlam yeni açıldıysa glifler boş titremesin: tüm satırları hemen yeniden boya.
    if (aktif.webgl) { try { aktif.term.refresh(0, aktif.term.rows - 1); } catch {} }
  }
}
// Sekme kapanırken/ölürken kalan her zamanlayıcı, bekleyen çıktı ve WebGL bağlamı bırakılır.
function oturumKaynakTemizle(o) {
  if (!o) return;
  clearInterval(o.sayac); o.sayac = null;
  clearInterval(o._adIzleTimer); o._adIzleTimer = null;
  clearInterval(o._sefIzleTimer); o._sefIzleTimer = null;
  clearTimeout(o._modelTaraTimer); o._modelTaraTimer = null;
  if (o.pid) bekleyenVeri.delete(o.pid);
  webglBirak(o);
  try { o.term && o.term.dispose(); } catch {}
  o.term = null;
  if (o.el) { o.el.remove(); o.el = null; }
}
async function terminalOlustur(o) {
  o.sonBoyut = null; // terminal yeniden kuruldu: boyut defteri sıfırlanır, ilk sigdir gerçek boyutu bildirir
  try { await document.fonts.ready; await document.fonts.load(`${S.fs}px "IBM Plex Mono"`); } catch {}
  const el = document.createElement('div');
  el.className = 'terminal' + (o.orkestrator ? ' terminal-ork' : '');
  el.hidden = true;
  $('terminaller').appendChild(el);
  const t = new TerminalSinif({
    fontFamily: '"IBM Plex Mono", "Cascadia Mono", Consolas, monospace',
    fontSize: S.fs, lineHeight: 1.22, letterSpacing: 0,
    cursorBlink: true, cursorStyle: 'bar', cursorWidth: 2,
    allowProposedApi: true, scrollback: VARSAYILAN_SCROLLBACK, smoothScrollDuration: 0, theme: o.orkestrator ? TEMA_ORK : TEMA,
  });
  t.open(el);
  const f = FitSinif ? new FitSinif() : null;
  if (f) t.loadAddon(f);
  let ara = null;
  if (AraSinif) {
    try {
      ara = new AraSinif();
      t.loadAddon(ara);
      ara.onDidChangeResults((r) => { if (o.id === S.aktif) termAraSayYaz(r); });
    } catch { ara = null; }
  }
  // WebGL karolama artık burada DEĞİL: bağlam yalnız görünür etkin sekmede webglSenkronla()
  // ile açılır (webglBagla/webglBirak). Gizli sekme GPU bağlamı tutmaz; desteklenmezse
  // sessizce canvas çizimine düşülür (uygulama çalışmaya devam eder).
  t.onData((veri) => {
    if (o.uyuyor) { uyandir(o, veri); return; }   // boşta uyutulmuş sekme: yazınca aynı sekmede sürer
    if (o.pid) window.evren.yaz(o.pid, veri);
    // Uzun süre boş bekleyen oturumda ilk mesaj sonradan yazılabilir: ad aramasını yeniden başlat.
    if (!o.ad && !o.orkestrator) sekmeAdIzle(o);
  });
  t.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    // Ctrl+C terminalin kendisidir: seçim olsa bile macOS'te PTY'ye geçer (SIGINT korunur);
    // Windows'ta seçim varsa kopyalar (mevcut davranış birebir).
    if (e.ctrlKey && !e.shiftKey && e.code === 'KeyC') {
      if (!darwinMi() && t.hasSelection()) {
        panoYaz(t.getSelection());
        return false;
      }
      return true;
    }
    // Cmd+C (yalnız macOS): seçim varsa kopyalar; yoksa da tüketilir — Cmd+C terminalde SIGINT değildir, xterm'e düşmesin.
    if (darwinMi() && e.metaKey && !e.shiftKey && e.code === 'KeyC') {
      if (t.hasSelection()) panoYaz(t.getSelection());
      return false;
    }
    // Kesme: terminalde metin silinemez; seçim panoya alınır ve seçim bırakılır.
    if (komutTusu(e) && !e.shiftKey && e.code === 'KeyX' && t.hasSelection()) {
      panoYaz(t.getSelection());
      t.clearSelection();
      return false;
    }
    if (komutTusu(e) && !e.shiftKey && e.code === 'KeyV') {
      e.preventDefault();
      terminaleYapistir(t);
      return false;
    }
    // Ctrl/Cmd+Shift+C / V: alışılmış terminal kısayolları da aynı yolu kullanır.
    if (komutTusu(e) && e.shiftKey && e.code === 'KeyC' && t.hasSelection()) {
      panoYaz(t.getSelection());
      return false;
    }
    if (komutTusu(e) && e.shiftKey && e.code === 'KeyV') {
      e.preventDefault();
      terminaleYapistir(t);
      return false;
    }
    // GENEL_TUS ve Ctrl+Tab yalnız Ctrl ile: Cmd'li uygulama tuşları aşağıdaki kisayolBul(metaKomut) satırında tüketilir,
    // Cmd+Tab ise işletim sistemi düzeyinde sayfaya hiç gelmez.
    if (e.ctrlKey && e.shiftKey && GENEL_TUS.has(e.code)) return false;
    if (e.ctrlKey && e.code === 'Tab') return false;
    // Uygulama kısayolları terminale gitmez; terminalDisi olanlar (Ctrl+K: satır sonuna kadar sil) terminale gider.
    if (Gorunum.kisayolBul(e, Gorunum.KISAYOLLAR, true, darwinMi())) return false;
    return true;
  });
  // Pano penceresinden (Win+V) tıklanan öğe terminale paste olayı olarak gelir, keydown gelmez.
  // xterm bu olayda yalnız metni yapıştırıp görseli yutar; yakalama aşamasında olayı devralıyoruz.
  el.addEventListener('paste', (e) => {
    e.preventDefault();
    e.stopPropagation();
    terminaleYapistir(t);
  }, true);
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (t.hasSelection()) {
      panoYaz(t.getSelection());
      t.clearSelection();
    } else {
      terminaleYapistir(t);
    }
  });
  // Dosya / görsel sürükle-bırak: tırnaklı yollar terminale yazılır (ajan görseli yoldan okur).
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('birak'); });
  el.addEventListener('dragleave', () => el.classList.remove('birak'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('birak');
    const yollar = [...((e.dataTransfer && e.dataTransfer.files) || [])].map((f) => window.evren.dosyaYolu(f)).filter(Boolean);
    if (yollar.length) terminaleYollarYaz(t, yollar);
  });
    // Tampon olcumu ve alternate buffer tespiti
  const olcTampon = () => {
    const tip = t.buffer && t.buffer.active ? t.buffer.active.type : 'normal';
    const uzunluk = t.buffer && t.buffer.active ? t.buffer.active.length : 0;
    console.log('[terminal:buffer]', JSON.stringify({ oturum: o.id, type: tip, length: uzunluk, scrollback: t.options.scrollback }));
    return tip;
  };
  t.buffer.onBufferChange && t.buffer.onBufferChange(() => olcTampon());
  // Eger alternate buffer ise tekerlekle yukari kaydirmada sohbet kaydini ac
  el.addEventListener('wheel', (e) => {
    if (e.ctrlKey) return;
    const tip = t.buffer && t.buffer.active ? t.buffer.active.type : 'normal';
    // Tekerlekle panel kendiliğinden açılmaz; yalnız konuşma düğmesi / Ctrl+Shift+H açar.
  }, { passive: true });
  setTimeout(olcTampon, 1200);
  Object.assign(o, { el, term: t, fit: f, webgl: null, ara, olcTampon });
}
// ---- terminale görsel / dosya ekleme, ipucu, arama, tuş şeridi ----
let ipucuZaman = 0;
function terminalIpucu(onizleme, metin) {
  const el = $('termIpucu');
  if (!el) return;
  const r = $('termIpucuResim');
  r.hidden = !onizleme;
  if (onizleme) r.src = onizleme;
  $('termIpucuMetin').textContent = metin || 'görsel eklendi';
  el.hidden = false;
  el.classList.remove('goster');
  void el.offsetWidth;
  el.classList.add('goster');
  clearTimeout(ipucuZaman);
  ipucuZaman = setTimeout(() => { el.hidden = true; }, 2000);
}
// Yollar tırnaklı ve sonda boşlukla yapıştırılır (bracketed paste: ajan yapıştırılan görsel yolunu tanır).
function terminaleYollarYaz(t, yollar, onizleme) {
  t.paste(Gorunum.yolMetni(yollar));
  const ilk = yollar[0] || '';
  const goster = (on) => terminalIpucu(on, yollar.length > 1 ? `${yollar.length} dosya eklendi` : (/\.(png|jpe?g|gif|webp|bmp)$/i.test(ilk) ? 'görsel eklendi' : 'dosya eklendi'));
  if (onizleme !== undefined) goster(onizleme);
  else window.evren.dosyaOnizleme(ilk).then(goster, () => goster(null));
}
// Ctrl+V / pano penceresi / sağ tık: panoda görsel ya da kopyalanmış dosya varsa eki (yolları) yaz,
// yoksa metni yapıştır. Dış uygulamalar "Resmi kopyala"da adres metnini de panoya koyduğu için
// ek varken ek kazanır (Gorunum.panoKarar).
async function terminaleYapistir(t) {
  const karar = Gorunum.panoKarar(await window.evren.panoEkAl(), await panoOku());
  if (!karar) return;
  if (karar.yollar) { terminaleYollarYaz(t, karar.yollar, karar.onizleme); return; }
  t.paste(karar.metin);
}
async function terminaleDosyaEkle() {
  const o = aktifOturum();
  if (!o || !o.term) return;
  const r = await window.evren.gorselSec();
  if (r && r.yollar && r.yollar.length) terminaleYollarYaz(o.term, r.yollar, r.onizleme);
  o.term.focus();
}
const ARA_DEKOR = { matchBackground: '#3a3320', matchBorder: '#6b5a2e', matchOverviewRuler: '#e0b36a', activeMatchBackground: '#7a6330', activeMatchBorder: '#e0b36a', activeMatchColorOverviewRuler: '#e0b36a' };
function termAraSayYaz(r) {
  const s = $('termAraSay');
  if (!s) return;
  if (!$('termAraGiris').value) { s.textContent = ''; return; }
  s.textContent = !r || !r.resultCount ? 'yok' : (r.resultIndex >= 0 ? `${r.resultIndex + 1}/${r.resultCount}` : `${r.resultCount}+`);
}
function termAraAc() {
  const o = aktifOturum();
  if (!o || !o.ara) return false;
  S.araOturum = o.id;
  $('termAra').hidden = false;
  const g = $('termAraGiris');
  const sec = o.term.getSelection();
  if (sec && !/[\r\n]/.test(sec)) g.value = sec;
  g.focus();
  g.select();
  if (g.value) termAraYap(1, true);
  return true;
}
function termAraYap(yon, artimli = false) {
  const o = aktifOturum();
  if (!o || !o.ara) return;
  const q = $('termAraGiris').value;
  if (!q) { o.ara.clearDecorations(); termAraSayYaz(null); return; }
  const secenek = { decorations: ARA_DEKOR, incremental: artimli };
  if (yon > 0) o.ara.findNext(q, secenek); else o.ara.findPrevious(q, secenek);
}
function termAraKapat(odakla = true) {
  const k = $('termAra');
  if (!k || k.hidden) return;
  k.hidden = true;
  S.araOturum = null;
  const o = aktifOturum();
  if (o && o.ara) { try { o.ara.clearDecorations(); } catch {} }
  if (odakla && o && o.term) o.term.focus();
}
function tusSeritKur() {
  const kutu = $('tusDugmeler');
  if (!kutu) return;
  kutu.innerHTML = Gorunum.TERMINAL_TUSLARI.map((k) => `<button class="tus" type="button" data-tus="${k.id}" title="${esc(k.ipucu)}"><kbd>${esc(k.etiket)}</kbd></button>`).join('') +
    '<span class="tus-ayrac"></span><button class="tus tus-gorsel" type="button" data-gorsel="1" title="Görsel ya da dosya ekle: yolu terminale yazılır (Ctrl+V ile panodan da eklenir)"><svg class="ic"><use href="#i-plus" /></svg>Görsel ekle</button>';
  const uygula = () => {
    $('tusSerit').classList.toggle('kapali', !S.tusSerit);
    $('tusAc').setAttribute('aria-expanded', String(S.tusSerit));
    setTimeout(() => sigdir(), 60);
  };
  uygula();
  $('tusSerit').addEventListener('mousedown', (e) => e.preventDefault()); // terminal odağı kaybolmasın
  $('tusAc').addEventListener('click', () => { S.tusSerit = !S.tusSerit; sakla.yaz('tusSerit', S.tusSerit); uygula(); const o = aktifOturum(); if (o && o.term) o.term.focus(); });
  kutu.addEventListener('click', (e) => {
    const o = aktifOturum();
    if (!o || !o.term) return;
    if (e.target.closest('[data-gorsel]')) { terminaleDosyaEkle(); return; }
    const d = e.target.closest('[data-tus]');
    const tus = d && Gorunum.TERMINAL_TUSLARI.find((k) => k.id === d.dataset.tus);
    if (!tus || !o.pid) return;
    window.evren.yaz(o.pid, tus.dizi);
    o.term.focus();
  });
}
const aktifOturum = () => S.oturumlar.find((o) => o.id === S.aktif) || null;
const aktifTerm = () => { const o = aktifOturum(); return o ? o.term : null; };
// Kenar paneli/odak geçişi sürerken tuval ölçümü ertelenir: ölçüm geçişin SONUNDA bir kez yapılır
// (geçiş hiç olmazsa 320 ms'lik yedek zamanlayıcı devreye girer). Geçiş boyunca ResizeObserver yok sayılır.
let gecisSuruyor = false, gecisZaman = 0;
function gecisSonrasi(f) {
  gecisSuruyor = true;
  clearTimeout(gecisZaman);
  const side = document.querySelector('.side');
  let bitti = false;
  const bitir = () => {
    if (bitti) return;
    bitti = true;
    if (side) side.removeEventListener('transitionend', dinle);
    clearTimeout(gecisZaman);
    gecisSuruyor = false;
    f();
  };
  const dinle = (e) => { if (e.target === side && e.propertyName === 'width') bitir(); };
  if (side) side.addEventListener('transitionend', dinle);
  gecisZaman = setTimeout(bitir, 320);
}
let sigdirZaman = 0;
function sigdir() {
  const o = aktifOturum();
  if (!o || !o.term) return;
  cancelAnimationFrame(sigdirZaman);
  sigdirZaman = requestAnimationFrame(() => {
    if (o.fit) { try { o.fit.fit(); } catch {} }
    const cols = o.term.cols, rows = o.term.rows;
    // Aynı boyutu yeniden göndermek pty'de SIGWINCH üretir; Claude Code TUI tüm transkripti yeniden basar.
    const boyut = { cols, rows };
    if (o.pid && cols && rows && !Gorunum.boyutAyni(o.sonBoyut, boyut)) {
      window.evren.boyut(o.pid, boyut);
      o.sonBoyut = boyut;
    }
  });
}
// NOT: Otomatik Ctrl+L ile hizalama tamamen KALDIRILDI. Her pty parçasından 450 ms sonra \x0c
// göndermek TUI menülerini dağıtıyor, tüm transkripti yeniden bastırıyor, sonGirdi'yi sıfırlayıp
// sahte "devam" tetikliyordu. Kullanıcı gerektiğinde Ctrl+L'i kendisi basar.
function fsDegis(d) {
  S.fs = Math.min(18, Math.max(11, S.fs + d));
  sakla.yaz('fs', S.fs);
  $('fsMetin').textContent = S.fs;
  for (const o of S.oturumlar) {
    if (o.term) {
      o.term.options.fontSize = S.fs;
      if (o.webgl && typeof o.webgl.clearTextureAtlas === 'function') {
        try { o.webgl.clearTextureAtlas(); } catch {}
      }
      try { o.term.refresh(0, o.term.rows - 1); } catch {}
    }
  }
  sigdir();
}
// Model adı / etiketinden EVREN model kimliğini çözer. Terminal de kayıt da sağlayıcı
// önekli ad yazabilir (zai/glm-5.3-fp8): öneki atılıp katalog kimliğiyle eşleştirilir.
function modelKimligiCoz(metin) {
  if (!metin) return null;
  const s = String(metin).toLowerCase().trim();
  const kisa = s.includes('/') ? s.slice(s.lastIndexOf('/') + 1) : s;
  for (const m of S.modeller || []) {
    const id = (m.id || '').toLowerCase();
    if (!id) continue;
    if (s === id || kisa === id) return m.id;
    if (kisa.startsWith(id + '-') || kisa.startsWith(id + '.')) return m.id;
    if (m.ad && (s === m.ad.toLowerCase() || kisa === m.ad.toLowerCase() || s.includes(m.ad.toLowerCase()))) return m.id;
  }
  if (s.includes('qwen') && (s.includes('3.8') || s.includes('flash') || s.includes('next'))) return 'qwen3.8-flash-next';
  if (s.includes('qwen') && s.includes('vl')) return 'qwen3-vl-30b';
  if (s.includes('deepseek')) return 'deepseek-v4.1-flash';
  if (s.includes('glm')) return 'glm-5.3';
  if (s.includes('gemma')) return 'gemma-4-31b';
  if (s.includes('opus')) return 'claude-opus-5-5';
  if (s.includes('sonnet')) return 'claude-sonnet-5-5';
  if (s.includes('haiku')) return 'claude-haiku-5-5';
  return null;
}
// Terminalden okunan model seçimi: kullanıcı /model ile modeli değiştirdiği anda alt çubuk
// bunu göstermeli. Sohbet kaydı ancak YENİ bir asistan turu yazıldığında gerçek modeli
// kanıtlar; o ana kadar kayıttaki (eski tura ait) model taze seçimin üzerine yazılmaz.
// modelKayitYanit = seçimin doğrulandığı tur sayacı. Çözülen model yoksa false döner.
function modelSecimiYaz(o, cozulen) {
  if (!cozulen) return false;
  if (cozulen !== o.model) {
    o.model = cozulen;
    // Taban henüz bilinmiyorsa damga vurulmaz: açılışta alınacak taban uygulanır.
    if (o.sonYanit != null) o.modelKayitYanit = o.sonYanit;
    if (o.pid && window.evren && window.evren.modelGuncelle) window.evren.modelGuncelle(o.pid, cozulen);
    sekmeleriCiz();
    durumYaz();
  }
  return true;
}
// Oturumun terminal tamponunu geriye doğru tarayarak gerçekte çalışan modeli tespit eder
function oturumModeliTara(o) {
  if (!o || !o.term || !o.term.buffer || !o.term.buffer.active) return;
  const b = o.term.buffer.active;
  const sonIdx = b.length - 1;
  const ilkIdx = Math.max(0, sonIdx - 80);
  for (let i = sonIdx; i >= ilkIdx; i--) {
    const l = b.getLine(i);
    if (!l) continue;
    const str = l.translateToString(true);
    if (!str) continue;
    // 1. "Set model to `?Model Adı`?"
    const mSet = str.match(/Set model to [`'\"]?([^`'\"\r\n()]+)/i);
    if (mSet) {
      if (modelSecimiYaz(o, modelKimligiCoz(mSet[1]))) return;
    }
    // 2. "Model Adı (hizli...) • API/Subscription Usage Billing"
    const mHeader = str.match(/(?:^|\r|\n)\s*([^\r\n•·]+?)\s*[•·]\s*(?:API|Subscription)\s*Usage/i);
    if (mHeader && modelSecimiYaz(o, modelKimligiCoz(mHeader[1]))) return;
  }
}
function oturumModeliTaraGecikmeli(o) {
  if (!o) return;
  clearTimeout(o._modelTaraTimer);
  o._modelTaraTimer = setTimeout(() => oturumModeliTara(o), 120);
}
// Sekme adı: Şef oturumunda proje adı yeterli; normal oturumda ilk kullanıcı mesajından
// (Claude Desktop/Antigravity'deki gibi) üretilen ad kullanılır. Ad henüz yoksa proje adı görünür.
function temizSekmeAdi(b) {
  return String(b || '').replace(/\s+Kural:[\s\S]*$/, '').replace(/\s+/g, ' ').trim();
}
function sekmeAdi(o) {
  // Şef de dâhil her oturum önce kendi adını taşır; ad oluşana kadar proje adı görünür.
  return o.ad || o.proje;
}
// ---------- sekmeler ----------
let sonSekmeHtml = '';
function sekmeleriCiz(baglamAtla = false) {
  const html =
    `<button class="tab ana${S.aktif == null && !seciliOturumGecmisi ? ' aktif' : ''}" data-id="ana" role="tab" title="Yeni oturum ekranı (Ctrl+Shift+T)">${ikon('term')}<span>ana</span></button>` +
    S.oturumlar.map((o, i) => `
      <button class="tab${o.id === S.aktif && !seciliOturumGecmisi ? ' aktif' : ''}${o.canli ? '' : ' bitti'}${o.yeni ? ' yeni' : ''}${o.orkestrator ? ' ork' : ''}" data-id="${o.id}" role="tab" title="${esc(sekmeAdi(o))} · ${esc(o.proje)} · ${esc(o.model)}${o.efor ? ' · efor ' + esc(o.efor) : ''}${o.dal ? ' · ' + esc(o.dal) : ''}${o.orkestrator ? ' · şef · kod yazma ' + (o.kodYazma ? 'açık' : 'kapalı') : ''} · çift tık: adlandır">
        <span class="led${o.canli ? ' canli' : o.kod ? ' kotu' : ''}"></span>
        <span class="tab-ad">${esc(sekmeAdi(o))}</span>
        ${o.orkestrator ? `<span class="tab-ork mono" title="Şef · kod yazma ${o.kodYazma ? 'açık' : 'kapalı'}">ŞEF</span>` : ''}
        <span class="tab-x" data-kapat="${o.id}" title="Sekmeyi kapat (Ctrl+Shift+W)">×</span>
      </button>`).join('') +
    (seciliOturumGecmisi ? `<button class="tab okuma aktif" data-id="okuma" role="tab" title="${esc(seciliOturumGecmisi.baslik || '')} · salt okunur kayıt">${ikon('chat')}<span class="tab-ad">${esc(seciliOturumGecmisi.baslik || 'kayıt')}</span><span class="tab-x" data-okuma-kapat="1" title="Okumayı kapat">×</span></button>` : '');
  if (html !== sonSekmeHtml) { // aynı HTML için sekme şeridini baştan kurma (layout + olay kaybettirici nuke)
    sonSekmeHtml = html;
    $('sekmeler').innerHTML = html;
    const a = $('sekmeler').querySelector('.tab.aktif');
    if (a) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  durumYaz(baglamAtla);
}
const cipYaz = sekmeleriCiz; // eski adla çağıranlar için
function durumYaz(baglamAtla = false) {
  const o = aktifOturum();
  S.calisiyor = !!(o && o.canli);
  $('baslaBtn').hidden = false;
  $('durdurBtn').hidden = !S.calisiyor;
  $('cevapDurdurBtn').hidden = !S.calisiyor;
  $('stage').classList.toggle('calisiyor', !!o);
  const m = seciliModel() || {}, p = seciliProje();
  $('sModel').textContent = o ? o.model : (m.id || '—');
  $('sModelSeg').title = o ? 'Aktif oturumun modeli' : 'Seçili varsayılan model · oturum yok';
  $('sDal').textContent = o ? (o.dal || '—') : (p && p.dal ? p.dal : '—');
  if (o) { $('crProje').textContent = o.proje; $('crDal').textContent = o.dal || '—'; }
  else { $('crProje').textContent = p ? p.ad : '—'; $('crDal').textContent = p && p.dal ? p.dal : '—'; }
  $('sOturum').textContent = `${S.oturumlar.filter((x) => x.canli).length}/${S.oturumlar.length} sekme`;
  sureYaz();
  if (!baglamAtla) baglamYaz(); // baglamYaz → sekmeleriCiz(true) döngüsü burada kapanır
}
// Alt çubukta bağlam: oturum varsa kayıttan gerçek kullanım (token / pencere · %),
// yoksa yalnız seçili modelin penceresi. Yanıt sırası karışırsa eski yanıt yazılmaz.
let baglamIster = 0;
async function baglamYaz() {
  const o = aktifOturum();
  // Model, bağlam ve tur sayacı sohbetten sohbete değişir; oturum yokken alt çubukta
  // sabit "1M" gibi yanıltıcı bir varsayılan göstermek yerine üçü de gizlenir.
  const gorunur = !!o;
  for (const id of ['sModelSeg', 'sBaglamSeg', 'sSohbetSeg']) $(id).hidden = !gorunur;
  if (!o) return;
  const ister = ++baglamIster;
  let d = null;
  try { d = await window.evren.oturumBaglam(o.pid); } catch {}
  if (ister !== baglamIster || aktifOturum() !== o) return;
  // Kayıt modeli yalnız YENİ bir asistan turu yazıldıktan sonra güvenilir; aksi hâlde
  // /model ile taze seçilen modeli, önceki turun modeliyle ezerdi. modelKayitYanit,
  // oturum açılışındaki tur sayacıdır (taban); üzerine yeni tur eklenince kayıt kazanır.
  const yanit = (d && d.yanit) || 0;
  const kayitModel = d && d.model ? modelKimligiCoz(d.model) || d.model : null;
  const kayitTaze = kayitModel && (o.modelKayitYanit == null || yanit > o.modelKayitYanit);
  if (kayitTaze) o.modelKayitYanit = yanit;
  o.sonYanit = yanit;
  if (kayitTaze && kayitModel !== o.model) {
    o.model = kayitModel;
    if (o.pid && window.evren && window.evren.modelGuncelle) window.evren.modelGuncelle(o.pid, kayitModel);
    sekmeleriCiz(true); // sekmeleri güncelle ama durum çubuğu üzerinden baglamYaz'ı yeniden tetikleme
  }
  const modelId = o.model || kayitModel || '—';
  const katalog = S.modeller.find((x) => x.id === modelId) || S.modeller.find((x) => modelId.endsWith('/' + x.id)) || {};
  const pencere = (d && d.pencere) || katalog.baglamSayisi || 0;
  // Payda sıkıştırma eşiğidir (oturum o noktada kendini özetler); model penceresi ipucunda.
  // Pencereyi payda yapmak "1M" gibi, hiç ulaşılmayacak bir sınırı gösteriyordu.
  const pn = (d && d.esik) || pencere;
  $('sModel').textContent = modelId;
  const token = d ? d.token : null;
  if (token != null) {
    const yuzde = pn ? Math.min(999, (token / pn) * 100) : null;
    $('sBaglam').textContent = pn
      ? `${tokenFormatla(token)} / ${kisaBaglam(pn)} · %${yuzde < 10 ? yuzde.toFixed(1) : Math.round(yuzde)}`
      : tokenFormatla(token);
    $('sBaglamSeg').title = pn
      ? `Son yanıt: ${token.toLocaleString('tr-TR')} token · ${d && d.esik ? `${d.esik.toLocaleString('tr-TR')} tokende kendini sıkıştırır · model penceresi ${pencere.toLocaleString('tr-TR')}` : `pencere ${pn.toLocaleString('tr-TR')}`} · %${yuzde.toFixed(1)}`
      : `Son yanıt: ${token.toLocaleString('tr-TR')} token · pencere bilinmiyor`;
    $('sBaglamSeg').classList.toggle('dolu', pn ? token / pn >= 0.85 : false);
  } else {
    $('sBaglam').textContent = pn ? kisaBaglam(pn) : '—';
    $('sBaglamSeg').classList.remove('dolu');
    $('sBaglamSeg').title = 'Kayıt henüz yok · ilk yanıttan sonra gerçek kullanım görünür';
  }
  $('sSohbet').textContent = d && d.yanit ? `${d.yanit}` : '—';
  $('sSohbetSeg').title = d && d.yanit
    ? `Bu oturumda ${d.yanit} asistan turu`
    : 'Tur sayacı kayıt yazılınca başlar';
}
function sekmeSec(id) {
  seciliOturumGecmisi = null;
  S.sohbetAcik = false; // ana ekranda panel yalnız elle (Ctrl+Shift+H) açılır; oturumlarda görünüm kuralı belirler
  sohbetSonAnahtar = '';
  sohbetIgneDurumGuncelle();
  S.aktif = id;
  const o = aktifOturum();
  if (o) o.yeni = false;
  for (const x of S.oturumlar) if (x.el) x.el.hidden = x.id !== S.aktif;
  if (!o) brifGoster(); else brifGizle();
  if (o) oturumModeliTara(o);
  sekmeleriCiz();
  gecmisCiz();
  if (o && o.term) { sigdir(); }
  gorunumUygula();
  webglSenkronla(); // WebGL yalnız kalan görünür etkin sekmede; diğerleri bağlamı bırakır
}
function sekmeGez(yon) {
  const dizi = [null, ...S.oturumlar.map((o) => o.id)];
  const i = dizi.indexOf(S.aktif);
  sekmeSec(dizi[(i + yon + dizi.length) % dizi.length]);
}
async function sekmeKapat(id) {
  const i = S.oturumlar.findIndex((o) => o.id === id);
  if (i < 0) return;
  const o = S.oturumlar[i];
  if (o.devam) kapatilanlar.push({ devam: o.devam, dizin: o.yol, modelId: o.model });
  if (o.canli && o.pid) await window.evren.kapatOturum(o.pid);
  oturumKaynakTemizle(o); // sayac/ad/sef/model tarayıcı zamanlayıcıları + bekleyen veri + WebGL bağlamı
  S.oturumlar.splice(i, 1);
  if (S.aktif === id) {
    const komsu = S.oturumlar[i] || S.oturumlar[i - 1];
    sekmeSec(komsu ? komsu.id : null);
  } else sekmeleriCiz();
}
// ---------- ana ekran (brifing) ----------
function brifGizle() {
  const b = $('brif');
  Grafik.dur();
  if (AZ_HAREKET) { b.hidden = true; return; }
  b.classList.add('gidiyor');
  setTimeout(() => { if (b.classList.contains('gidiyor')) b.hidden = true; }, 300);
}
function brifGoster() {
  const b = $('brif');
  b.hidden = false;
  requestAnimationFrame(() => b.classList.remove('gidiyor'));
  Grafik.basla();
}
// "İŞ 46: RAKIP BOSLUK..." başlığını numara + ad olarak ayırır; tanınmazsa null.
function isBasligi(baslik) {
  const m = String(baslik || '').match(/^\s*(?:İŞ|IS|IŞ|Is)\s*[:·\-–]?\s*(\d+)\s*[:·\-–]?\s*(.*)$/i);
  return m ? { no: m[1], ad: (m[2] || '').trim() || String(baslik) } : null;
}

// ---------- oturum ----------
let sonYerel = 0;
const bekleyenVeri = new Map(); // pid -> [veri] (sekme kaydından önce gelen çıktı)
async function basla(devamId, secenekler) {
  const devam = typeof devamId === 'string' ? devamId : null; // düğme olayı dize değildir
  // EVREN işini sürdürürken işin kendi dizini/modeli kullanılır; normal başlatmada seçili olanlar.
  // Düğme olayı (Event) seçenek sanılmasın; düz nesne ise alanları korunur (orkestratör, kodYazma).
  const sec = secenekler && typeof secenekler === 'object' && typeof secenekler.preventDefault !== 'function' ? secenekler : {};
  // Klasör verilmediyse proje olmadan başlanır: ana süreç serbest çalışma alanını açar.
  const yol = 'dizin' in sec ? (sec.dizin || null) : (S.proje || null);
  const m = (sec.modelId ? { id: sec.modelId } : null) || seciliModel() || {};
  const p = yol ? (S.projeler.find((x) => x.yol === yol) || null) : null;
  const ekDizinler = Array.isArray(sec.ekDizinler) ? sec.ekDizinler : (p && Array.isArray(p.yollar) ? p.yollar.slice(1) : []);
  if (S.basliyor || !S.yuklendi || !S.anahtarVar) return;
  // Aynı sohbetin ikinci kopyasını açma: canlı eş varsa o sekmeye git, kapanmış
  // (ölü) sekme varsa yeni sekme açmak yerine o sekmeyi tazele.
  let oluSekme = -1;
  if (devam) {
    // Aynı sohbetin ikinci kopyasını açma: sekme kimliği --resume ile atada kalmış olabilir (atalar zinciri).
    const canli = canliSekmeBul(devam);
    if (canli) { sekmeSec(canli.id); return; }
    oluSekme = S.oturumlar.findIndex((o) => o.devam === devam && !o.canli);
  }
  if (S.oturumlar.filter((o) => o.canli).length >= 8) { olay('OTURUM', 'en çok 8 canlı oturum', 'uyari'); return; }
  S.basliyor = true;
  try {
    // Geçmişten sürdürülen oturum da Şef ise rolü korunur (yazma güvenli varsayılan: kapalı).
    const orkestrator = sec.orkestrator === true || (!!devam && S.sefOturumlar.has(devam));
    const kodYazma = orkestrator ? sec.kodYazma === true : true;
    const o = { id: ++sonYerel, pid: 0, model: m.id, efor: sec.efor || S.sonEfor, _yeni: !devam, proje: sec.projeAd || (p ? p.ad : (yol ? (yol.split(/[\\/]/).filter(Boolean).pop() || yol) : 'EVREN çalışma alanı')), dal: p ? p.dal : '', yol: yol || S.serbestDizin, ekler: ekDizinler, canli: true, kod: null, basladi: 0, yeni: false, devam, orkestrator, kodYazma };
    if (oluSekme >= 0 && S.oturumlar[oluSekme]) {
      const eski = S.oturumlar[oluSekme];
      oturumKaynakTemizle(eski); // ölü sekmenin zamanlayıcıları ve WebGL bağlamı sızmasın
      S.oturumlar.splice(oluSekme, 1);
      if (S.aktif === eski.id) S.aktif = null;
      S.oturumlar.splice(oluSekme, 0, o);
    } else {
      S.oturumlar.push(o);
    }
    await terminalOlustur(o);
    sekmeSec(o.id);
    await bekle(30);
    if (o.fit) { try { o.fit.fit(); } catch {} }
    o.term.writeln(`\x1b[38;2;74;83;93m  evren \x1b[38;2;108;119;131m› ${m.id} › ${o.proje}\x1b[0m`);
    if (orkestrator) o.term.writeln(`\x1b[38;2;190;150;255m  şef › planlar, İŞ açar, devreder · kod yazma ${kodYazma ? 'açık' : 'kapalı'}\x1b[0m`);
    const sonuc = await window.evren.baslat({ modelId: m.id, dizin: yol, ekDizinler, projeAd: o.proje, cols: o.term.cols, rows: o.term.rows, devam, forkSession: !!sec.fork, orkestrator, kodYazma, efor: sec.efor || S.sonEfor });
    if (!sonuc || sonuc.hata) {
      o.canli = false; o.kod = 'hata';
      o.term.writeln(`\x1b[38;2;236;106;110m  ✗ ${(sonuc && sonuc.hata) || 'başlatılamadı'}\x1b[0m`);
      olay('OTURUM', `başlatılamadı · ${(sonuc && sonuc.hata) || ''}`, 'kotu');
      sekmeleriCiz();
      return;
    }
    o.pid = sonuc.id;
    // Model tabanı: açılıştaki tur sayacı. Kayıttaki model ancak bundan SONRAKİ yeni bir
    // turda geçerli sayılır; böylece --resume'da önceki sohbetin modeli taze seçimi ezmez.
    window.evren.oturumBaglam(o.pid).then((d) => {
      if (o.modelKayitYanit == null) {
        o.modelKayitYanit = (d && d.yanit) || 0;
        o.sonYanit = o.modelKayitYanit;
      }
    }).catch(() => {});
    // pty bu boyutla doğdu; ilk sigdir aynı boyutu tekrar göndermesin.
    o.sonBoyut = { cols: o.term.cols, rows: o.term.rows };
    if (sonuc.dizin) o.yol = sonuc.dizin;
    if (Array.isArray(sonuc.ekler)) o.ekler = sonuc.ekler;
    for (const v of bekleyenVeri.get(o.pid) || []) o.term.write(v);
    bekleyenVeri.delete(o.pid);
    o.basladi = Date.now();
    if (o.orkestrator) sefKimligiIzle(o);
    sekmeAdIzle(o); // Şef de dâhil: sekme adı ilk mesajdan (ve mümkünse ajan başlığından) gelir.
    olay('OTURUM', `#${S.oturumlar.indexOf(o) + 1} başladı · ${m.id} · ${o.proje}`, 'iyi');
    // Saniyelik güvenlik ağı: hizalama yalnız çıktı olayına bağlı kalmasın (çıktı üretmeyen
    // yeniden çizimlerde de kontrol edilsin).
    // Bağlam/tur sayacı 5 sn'de bir tazelenir: kayıt dosyasının yalnız yeni baytları okunur.
    o.sayac = setInterval(() => {
      if (o.id !== S.aktif) return;
      // Model tampon taraması buraya değil çıktı olayına bağlı: veriDinle'de kısaltmalı,
      // sekme seçilirken bir kez koşuluyor (80 satır çeviri + 2 regex/sn boşuna değildi).
      sureYaz();
      o.baglamTik = (o.baglamTik || 0) + 1;
      if (!document.hidden && o.baglamTik % 5 === 0) baglamYaz();
    }, 1000);
    sekmeleriCiz();
    sigdir();
    o.term.focus();
    setTimeout(gecmisYukle, 4000); // yeni oturumun kaydı birkaç sn sonra oluşur
  } catch (err) {
    console.error('[basla hatasi]', err);
    olay('OTURUM', `Hata: ${err && err.message ? err.message : err}`, 'kotu');
  } finally {
    S.basliyor = false;
  }
}
// Normal oturumun sekme adını ilk kullanıcı mesajından alır (Claude Desktop/Antigravity davranışı).
// Ad jsonl'e yazılınca okunur; bulunana ya da oturum kapanana kadar 1.5 sn'de bir sorulur.
function sekmeAdIzle(o) {
  if (!o || o.ad || o._adIzleTimer) return;
  let n = 0;
  const durdur = () => { clearInterval(o._adIzleTimer); o._adIzleTimer = null; };
  const dene = async () => {
    if (!o.canli || o.ad || !o.pid || n++ > 60) { durdur(); return; }
    const b = await window.evren.oturumKimlik(o.pid).catch(() => null);
    if (!b) return;
    if (b.devam && o.devam !== b.devam) { o.devam = b.devam; gecmisCiz(); } // soldaki kart aktif sekme olarak işaretlenir (--resume sonrası yeni kimliğe de bağlanır)
    if (b.baslik) {
      const ad = temizSekmeAdi(b.baslik);
      if (ad) {
        o.ad = ad; durdur(); sekmeleriCiz();
        // Yeni açılan oturumda ajan adı: ilk mesajı 2-6 kelimelik başlığa indir.
        // Sürdürülen eski oturumun adını kendiliğinden değiştirmeyiz.
        if (o._yeni && !o._ozelAd) aiSekmeAdi(o, b.baslik);
      }
    }
  };
  o._adIzleTimer = setInterval(dene, 1500);
  if (o._adIzleTimer.unref) o._adIzleTimer.unref();
  dene();
}
// İlk kullanıcı mesajından kısa oturum adı üretir; başarısızsa ilk mesajdan türetilen ad kalır.
async function aiSekmeAdi(o, metin) {
  if (!o || o._aiAd || o._ozelAd) return;
  o._aiAd = true;
  const r = await window.evren.baslikUret(metin).catch(() => null);
  if (!r || !r.ok || !r.ad || o._ozelAd || !o.canli) return;
  // Aynı ad iki oturumda görünmesin: "ad 2", "ad 3"…
  const adlar = new Set(
    [...S.gecmis.filter((g) => g.id !== o.devam).map((g) => g.baslik), ...S.oturumlar.filter((x) => x !== o).map((x) => x.ad)]
      .filter(Boolean).map((x) => x.toLocaleLowerCase('tr'))
  );
  let ad = r.ad;
  if (adlar.has(ad.toLocaleLowerCase('tr'))) {
    let n = 2;
    while (adlar.has((ad + ' ' + n).toLocaleLowerCase('tr'))) n++;
    ad = ad + ' ' + n;
  }
  if (o.devam && o.yol) await oturumAdlandir(o.devam, o.yol, ad, { sessiz: true });
  else { o.ad = ad; sekmeleriCiz(); }
}
// Şef oturumunun jsonl kimliğini öğrenir; kenar panelde kalıcı olarak işaretler.
// Sürdürülen oturumda kimlik --resume ile değişebilir: bir süre izlenir, değişince yeni kimlik işaretlenir.
function sefKimligiIzle(o) {
  const kaydet = (devam) => {
    if (!devam) return false;
    o.devam = devam;
    if (!S.sefOturumlar.has(devam)) {
      S.sefOturumlar.add(devam);
      sakla.yaz('sefOturumlar', [...S.sefOturumlar].slice(-300));
    }
    gecmisCiz();
    return true;
  };
  kaydet(o.devam);
  let n = 0;
  // Zamanlayıcı oturumda tutulur (o._sefIzleTimer): sekme kapanınca oturumKaynakTemizle temizler.
  o._sefIzleTimer = setInterval(async () => {
    if (!o.canli || o._forkAdopte || n++ > 40) { clearInterval(o._sefIzleTimer); o._sefIzleTimer = null; return; }
    const b = await window.evren.oturumKimlik(o.pid).catch(() => null);
    if (b && b.devam && b.devam !== o.devam) { kaydet(b.devam); clearInterval(o._sefIzleTimer); o._sefIzleTimer = null; }
  }, 1500);
  if (o._sefIzleTimer.unref) o._sefIzleTimer.unref();
}
function sureYaz() {
  const o = aktifOturum();
  $('sSure').textContent = o && o.basladi ? sureMetni((o.bitti || Date.now()) - o.basladi) : '—';
}
async function durdur() {
  const o = aktifOturum();
  if (!o || !o.canli) return;
  await window.evren.kapatOturum(o.pid);
  oturumBitti(o.pid, { kod: null });
}
// Ajanın o anki yanıtını keser (Ctrl+C); oturumu kapatmaz. Sekme, kayıt ve --resume
// kimliği yaşar. Gönderilmiş ama henüz işlenmemiş (kuyrukta bekleyen) mesaj da
// bu kesintiyle geri alınır; yazılan ama gönderilmemiş taslak terminalde kalır.
async function cevapDurdur() {
  const o = aktifOturum();
  if (!o || !o.canli || !o.pid) return;
  await window.evren.yaz(o.pid, '\x03');
  olay('OTURUM', 'yanıt durduruldu · oturum açık', 'uyari');
  if (o.term) o.term.focus();
}
// Yeni açılan pty ilk çıktısını verene kadar bekle (--resume Windows'ta 2.5-6 sn): kör 900 ms
// bekleme tuş vuruşlarını TUI hazır olmadan gönderiyordu. İlk bayttan sonra 400 ms durulma,
// en az 1200 ms, en çok 5000 ms.
function ilkCiktiBekle(o, { enCokMs = 5000, enAzMs = 1200, durulmaMs = 400 } = {}) {
  return new Promise((coz) => {
    const bas = Date.now();
    const t = setInterval(() => {
      const gecen = Date.now() - bas;
      const son = (o && o._ilkCiktiMs) || 0;
      if (gecen >= enCokMs || (son > bas && gecen >= enAzMs && Date.now() - son >= durulmaMs)) { clearInterval(t); coz(); }
    }, 150);
    if (t.unref) t.unref();
  });
}
// Uyuyan sekmede ilk yazı: aynı oturumu --resume ile aynı sekmede açar, girdiyi pty hazır olunca bir kez iletir.
async function uyandir(o, veri) {
  if (o._uyaniyor) { o._bekleyenGirdi = (o._bekleyenGirdi || '') + veri; return; }
  o._uyaniyor = true; o._bekleyenGirdi = veri || '';
  const devam = o.devam;
  try {
    await basla(devam, { dizin: o.yol, modelId: o.model, orkestrator: o.orkestrator, kodYazma: o.kodYazma });
    const yeni = S.oturumlar.find((x) => x.canli && x.devam === devam);
    if (yeni && yeni.pid && o._bekleyenGirdi) {
      const girdi = o._bekleyenGirdi;
      await ilkCiktiBekle(yeni);
      if (o._bekleyenGirdi) window.evren.yaz(yeni.pid, o._bekleyenGirdi || girdi);
    }
  } finally { o._uyaniyor = false; o._bekleyenGirdi = ''; }
}
function oturumBitti(pid, bilgi) {
  const o = S.oturumlar.find((x) => x.pid === pid);
  if (!o || !o.canli) return;
  o.canli = false;
  o.bitti = Date.now();
  o.kod = bilgi && bilgi.kod != null ? bilgi.kod : null;
  clearInterval(o.sayac);
  if (bilgi && bilgi.bosta && o.devam) {
    // Boşta uyutuldu: ekran korunur, bir tuşla aynı oturum aynı sekmede sürer.
    o.uyuyor = true;
    olay('OTURUM', `${o.proje} boşta uyutuldu`, '');
    if (o.term) o.term.writeln('\r\n\x1b[38;2;108;119;131m  Boşta uyutuldu · yazınca kaldığı yerden sürer\x1b[0m');
    sekmeleriCiz();
    gecmisYukle();
    return;
  }
  olay('OTURUM', `${o.proje} kapandı · çıkış ${o.kod ?? '—'} · ${sureMetni(o.bitti - (o.basladi || o.bitti))}`, o.kod ? 'uyari' : '');
  if (o.term) o.term.writeln(`\r\n\x1b[38;2;108;119;131m  [oturum kapandı${o.kod != null ? ' · çıkış ' + o.kod : ''} · Ctrl+Shift+W sekmeyi kapat · Ctrl+Shift+T yeni oturum]\x1b[0m`);
  sekmeleriCiz();
  gecmisYukle();
}
function sideToggle() {
  const kapali = !$('app').classList.contains('side-kapali');
  $('app').classList.toggle('side-kapali', kapali);
  sakla.yaz('sideKapali', kapali);
  gecisSonrasi(() => { sigdir(); Grafik.olc(); });
}
// Odak modu: yalnız terminal (ve başlık çubuğu) kalır; kenar paneli, sekme şeridi, durum çubuğu gizlenir.
function odakToggle(zorla) {
  const acik = typeof zorla === 'boolean' ? zorla : !$('app').classList.contains('odak');
  $('app').classList.toggle('odak', acik);
  const ip = $('odakIpucu');
  ip.hidden = !acik;
  if (acik) { ip.classList.remove('sondu'); void ip.offsetWidth; ip.classList.add('sondu'); }
  gecisSonrasi(() => { sigdir(); Grafik.olc(); });
}
// ---------- konuşma / sohbet geçmişi paneli ----------
let sohbetYukleniyor = false;
let ciktiYukleniyor = false;
let sohbetSonAnahtar = ''; // en son çizilen sohbet: 'g:<gecmis id>' | 'o:<pid>'
let sohbetIstek = 0;       // sıra numarası: yavaş yanıt yenisinin üstüne yazmasın
let sohbetGirisSayisi = 0; // artımlı eklemede data-idx sırası
let sohbetAboneAnahtar = ''; // etkin push aboneliği: 'g:<id>' | 'o:<pid>'
async function sohbetYukle(zorla = false) {
  const panel = $('sohbetPanel');
  if (!panel || panel.hidden) return;
  if (S.panelMod === 'dosyalar') { await ciktiYukle(zorla); return; }
  if (seciliOturumGecmisi) {
    if (sohbetYukleniyor && !zorla) return;
    sohbetYukleniyor = true;
    const istek = ++sohbetIstek; // yavaş oturum A, sonradan seçilen oturum B'nin üstüne yazamaz
    const anahtar = 'g:' + seciliOturumGecmisi.id;
    try {
      let res = await window.evren.sohbetOturumKaydi({
        dizin: seciliOturumGecmisi.projeYol,
        id: seciliOturumGecmisi.id,
      });
      // Alt iş kaydı kendi dizininde yoksa üst oturumun proje klasörüne bakılır.
      if (seciliOturumGecmisi && seciliOturumGecmisi.yedekYol && !(res && res.girisler && res.girisler.length)) {
        res = await window.evren.sohbetOturumKaydi({ dizin: seciliOturumGecmisi.yedekYol, id: seciliOturumGecmisi.id });
      }
      if (istek !== sohbetIstek) return; // daha yeni bir istek var: bu yanıt bayat
      // Dosya değişmedi ve aynı sohbet zaten çiziliyorsa okuma/çizim atlanır.
      if (res && res.degisti === false && anahtar === sohbetSonAnahtar) return;
      if (anahtar !== sohbetSonAnahtar && $('sohbetListe')) delete $('sohbetListe').dataset.kaydirildi; // yeni sohbet dipten açılır
      const girisler = (res && res.girisler) || [];
      if (seciliOturumGecmisi) seciliOturumGecmisi.girisler = girisler;
      sohbetCiz(girisler);
      sohbetSonAnahtar = anahtar;
    } catch (e) {
      sohbetSonAnahtar = '';
      console.error('Sohbet kaydı okunamadı:', e);
    } finally {
      sohbetYukleniyor = false;
    }
    return;
  }
  const o = aktifOturum();
  if (!o || !o.pid) {
    sohbetSonAnahtar = '';
    $('sohbetListe').innerHTML = '<div class="sohbet-bos">Aktif bir oturum yok</div>';
    $('sohbetSayac').textContent = '0';
    return;
  }
  if (sohbetYukleniyor && !zorla) return;
  sohbetYukleniyor = true;
  const istek = ++sohbetIstek;
  const anahtar = 'o:' + o.pid;
  try {
    const res = await window.evren.sohbetGecmisi(o.pid);
    if (istek !== sohbetIstek) return; // daha yeni bir istek var: bu yanıt bayat
    // Dosya değişmedi ve aynı sohbet zaten çiziliyorsa okuma/çizim atlanır.
    if (res && res.degisti === false && anahtar === sohbetSonAnahtar) return;
    if (anahtar !== sohbetSonAnahtar && $('sohbetListe')) delete $('sohbetListe').dataset.kaydirildi;
    const girisler = (res && res.girisler) || [];
    o.sohbetGirisler = girisler;
    sohbetCiz(girisler);
    sohbetSonAnahtar = anahtar;
  } catch (e) {
    sohbetSonAnahtar = '';
    console.error('Sohbet geçmişi okunamadı:', e);
  } finally {
    sohbetYukleniyor = false;
  }
}
// Sohbet girişlerinden HTML üretir. Sıra numarası (baslangicIdx) artımlı eklemede kaymaz.
// Okuma düzeni: tek sütun. Kullanıcı sağda hafif yüzeyde, ajan solda düz metin, araçlar arka arkaya
// tek satırlık mono "iz" olarak toplanır (tıklayınca açılır). Sıkıştırma özetleri katlanır.
function sohbetKartlariOlustur(girisler, baslangicIdx = 0) {
  const zamanMetni = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const rolEtiketleri = { kullanici: 'Kullanıcı', asistan: 'Asistan', arac: 'Araç' };
  const md = (s) => esc(s)
    .replace(/```([\s\S]*?)```/g, (_, k) => `<pre class="so-kod">${k.replace(/^\w*\n/, '')}</pre>`)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/^#{1,4} (.+)$/gm, '<b class="so-bas">$1</b>');
  // Arka arkaya gelen araç adımları tek, sakin bir özet satırına iner ("3 dosya okundu · 2 komut ›");
  // tıklayınca adımlar açılır.
  const FIIL = { Read: ['okundu', 'dosya'], Edit: ['düzenlendi', 'dosya'], MultiEdit: ['düzenlendi', 'dosya'], Write: ['yazıldı', 'dosya'], NotebookEdit: ['düzenlendi', 'dosya'], Bash: ['çalıştı', 'komut'], PowerShell: ['çalıştı', 'komut'], Grep: ['yapıldı', 'arama'], Glob: ['yapıldı', 'arama'], WebFetch: ['okundu', 'sayfa'], WebSearch: ['yapıldı', 'web araması'], Agent: ['çalıştı', 'alt ajan'], Task: ['çalıştı', 'alt ajan'] };
  const izOzet = (adlar) => {
    const say = new Map();
    for (const a of adlar) { const f = FIIL[a] || ['kullanıldı', 'araç']; const k = f[1] + '|' + f[0]; say.set(k, (say.get(k) || 0) + 1); }
    return [...say].map(([k, n]) => { const [nesne, fiil] = k.split('|'); return `${n} ${nesne} ${fiil}`; }).join(' · ');
  };
  const parcalar = [];
  let iz = null; // { adlar: [], satirlar: [] }
  const izKapat = () => {
    if (!iz) return;
    parcalar.push(`<div class="so-iz"><button class="so-iz-ust" type="button"><span>${esc(izOzet(iz.adlar))}</span><i aria-hidden="true">›</i></button><div class="so-iz-govde">${iz.satirlar.join('')}</div></div>`);
    iz = null;
  };
  (girisler || []).forEach((g, idx) => {
    const gidx = baslangicIdx + idx;
    const rol = g.rol || 'asistan';
    const zaman = zamanMetni(g.ms);
    if (rol === 'arac') {
      if (!iz) iz = { adlar: [], satirlar: [] };
      const sonucMu = !!(g.arac && g.arac.sonuc);
      const hamAd = sonucMu ? '↳ sonuç' : ((g.arac && g.arac.ad) || 'Araç');
      if (!sonucMu) iz.adlar.push(hamAd); // sayıma yalnız çağrılar girer; dönüş kaydı aynı adımın parçası
      const metin = String(g.metin || '');
      const ilk = esc(metin.split('\n').find((x) => x.trim()) || '');
      iz.satirlar.push(`
        <div class="sohbet-kart arac" data-idx="${gidx}">
          <div class="so-iz-satir"><span class="so-iz-ad">${esc(hamAd)}</span><span class="so-iz-ozet">${ilk}</span>${zaman ? `<time class="sohbet-zaman">${zaman}</time>` : ''}</div>
          <div class="sohbet-icerik">${esc(metin)}</div>
          <button class="sohbet-kopyala" type="button" title="Metni kopyala">kopyala</button>
        </div>`);
      return;
    }
    izKapat();
    // Sıkıştırma özeti: tek dev kullanıcı balonu yerine katlanır "Bağlam özeti" bloğu.
    if (g.ozet === true) {
      parcalar.push(`
        <div class="so-iz so-baglam-ozeti" data-idx="${gidx}">
          <button class="so-iz-ust" type="button"><span>Bağlam özeti</span><i aria-hidden="true">›</i></button>
          <div class="so-iz-govde"><div class="sohbet-kart ${rol}"><div class="sohbet-icerik">${md(g.metin || '')}</div></div></div>
        </div>`);
      return;
    }
    parcalar.push(`
      <div class="sohbet-kart ${rol}" data-idx="${gidx}" aria-label="${rolEtiketleri[rol] || rol}">
        <div class="sohbet-icerik">${md(g.metin || '')}</div>
        <div class="so-alt">${zaman ? `<time class="sohbet-zaman">${zaman}</time>` : ''}<button class="sohbet-kopyala" type="button" title="Metni kopyala">kopyala</button></div>
      </div>`);
  });
  izKapat();
  return parcalar.join('');
}

function sohbetCiz(girisler) {
  if (S.panelMod === 'dosyalar') { ciktiCiz(); return; }
  sohbetBasligiGuncelle();
  const liste = $('sohbetListe');
  if (!liste) return;
  const tumu = girisler || [];
  sohbetGirisSayisi = tumu.length; // artımlı ekleme buradan devam eder
  if ($('sohbetSayac')) $('sohbetSayac').textContent = tumu.length;
  delete liste.dataset.cizim;
  if (!tumu.length) {
    liste.innerHTML = '<div class="sohbet-bos">Henüz konuşma kaydı yok</div>';
    return;
  }
  const enAlttaMi = Gorunum.dipteMi(liste.scrollTop, liste.scrollHeight, liste.clientHeight);
  liste.innerHTML = sohbetKartlariOlustur(tumu, 0);
  if (enAlttaMi || !liste.dataset.kaydirildi) {
    liste.scrollTop = liste.scrollHeight;
    liste.dataset.kaydirildi = '1';
  }
}

// Push deltası: mevcut DOM'a ekleme yapar; açık akordeonlar ve metin seçimi bozulmaz.
function sohbetArtirimliEkle(yeniGirisler) {
  if (!Array.isArray(yeniGirisler) || !yeniGirisler.length) return;
  const liste = $('sohbetListe');
  if (!liste) return;
  const bos = liste.querySelector('.sohbet-bos');
  if (bos) bos.remove();
  const enAlttaMi = Gorunum.dipteMi(liste.scrollTop, liste.scrollHeight, liste.clientHeight);
  const html = sohbetKartlariOlustur(yeniGirisler, sohbetGirisSayisi);
  sohbetGirisSayisi += yeniGirisler.length;
  liste.insertAdjacentHTML('beforeend', html);
  if ($('sohbetSayac')) $('sohbetSayac').textContent = sohbetGirisSayisi;
  if (enAlttaMi || !liste.dataset.kaydirildi) {
    liste.scrollTop = liste.scrollHeight;
    liste.dataset.kaydirildi = '1';
  }
}

// Push aboneliği: yalnız Sohbet paneli görünürken ve sekme öndeyken tek abonelik.
// Panel kapanınca/gizlenince bırakılır; main.js fs.watch tutamacını anında kapatır.
function sohbetAboneSenkronla() {
  const panel = $('sohbetPanel');
  const acik = !!(panel && !panel.hidden && S.panelMod === 'sohbet' && !document.hidden);
  if (!acik) {
    if (sohbetAboneAnahtar) { sohbetAboneAnahtar = ''; try { window.evren.sohbetBirak && window.evren.sohbetBirak(); } catch {} }
    return;
  }
  let param = null;
  if (seciliOturumGecmisi) {
    param = { anahtar: 'g:' + seciliOturumGecmisi.id, dizin: seciliOturumGecmisi.projeYol, id: seciliOturumGecmisi.id };
  } else {
    const o = aktifOturum();
    if (o && o.pid) param = { anahtar: 'o:' + o.pid, pid: o.pid };
  }
  if (!param) {
    if (sohbetAboneAnahtar) { sohbetAboneAnahtar = ''; try { window.evren.sohbetBirak && window.evren.sohbetBirak(); } catch {} }
    return;
  }
  if (param.anahtar === sohbetAboneAnahtar) return;
  sohbetAboneAnahtar = param.anahtar;
  try { window.evren.sohbetAbone && window.evren.sohbetAbone(param); } catch {}
}
// ---------- Dosyalar: oturumun yazdığı / ürettiği dosyalar ----------
// Write/Edit ile yazılan dosyalar ve Bash'ın ürettiği dosyalar (ekran görüntüsü vb.): görseller ızgarada, gerisi proje köküne
// göre klasör gruplu listede. Her öğede Aç, Klasörde göster, Yolu kopyala.
function ciktiParametresi() {
  if (seciliOturumGecmisi) {
    return {
      param: { dizin: seciliOturumGecmisi.projeYol, id: seciliOturumGecmisi.id },
      anahtar: `g:${seciliOturumGecmisi.projeYol}:${seciliOturumGecmisi.id}`,
    };
  }
  const o = aktifOturum();
  if (!o || o.pid == null) return null;
  return { param: { id: o.pid }, anahtar: `c:${o.id}:${o.devam || ''}:${o.pid}` };
}
async function ciktiYukle(zorla = false) {
  const panel = $('sohbetPanel');
  if (!panel || panel.hidden) return;
  const hedef = ciktiParametresi();
  if (!hedef) { S.ciktilar = []; S.ciktiAnahtar = null; S.ciktiImza = ''; ciktiCiz(); return; }
  if (S.ciktiAnahtar !== hedef.anahtar) { S.ciktilar = null; S.ciktiAnahtar = hedef.anahtar; S.ciktiImza = ''; S.ciktiKok = ''; }
  if (ciktiYukleniyor && !zorla) return;
  ciktiYukleniyor = true;
  try {
    const res = await window.evren.oturumCikti(hedef.param);
    if (S.ciktiAnahtar === hedef.anahtar) {
      const liste = (res && res.ciktilar) || [];
      const imza = liste.map((c) => c.yol + '|' + c.ms + '|' + c.boyut + '|' + (c.onizleme ? 1 : 0)).join('\n') + '#' + ((res && res.kok) || '');
      S.ciktilar = liste;
      // Kök: okunan geçmişte oturumun asıl projesi (yol çıkarımı / elle seçim), yoksa ana süreçten gelen çalışma klasörü.
      S.ciktiKok = (seciliOturumGecmisi && projeBilgi(seciliOturumGecmisi).yol) || (res && res.kok) || '';
      if (imza !== S.ciktiImza) { S.ciktiImza = imza; ciktiCiz(); } else gorunumSayiGuncelle(); // değişmediyse yeniden çizme: kaydırma ve önizleme bozulmasın
    }
  } catch (e) {
    console.error('Çıktılar okunamadı:', e);
    if (S.ciktiAnahtar === hedef.anahtar) { S.ciktilar = S.ciktilar || []; ciktiCiz(); }
  } finally {
    ciktiYukleniyor = false;
  }
}
function ciktiBoyut(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
}
function ciktiSaat(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
// Uzun yolu ortadan kırpmak yerine kök + son iki parçayı göster: "D:\…\evren-desktop\app.js".
function kisaCiktiYolu(p, n = 56) {
  if (!p) return '';
  if (p.length <= n) return p;
  const parcalar = String(p).split(/[\\/]/).filter(Boolean);
  const son = parcalar.slice(-2).join('\\');
  const kok = /^[A-Za-z]:$/.test(parcalar[0] || '') ? parcalar[0] + '\\…\\' : '…\\';
  const aday = kok + son;
  return aday.length <= n ? aday : '…\\' + parcalar.slice(-1).join('');
}
function ciktiIslemEtiketi(islem) {
  if (islem === 'olusturuldu') return 'yeni';
  if (islem === 'degisti') return 'değişti';
  return 'üretildi';
}
// Panel başlığı içeriğe göre konuşur: dosyalar listelenirken "Çıktılar", sohbette "Konuşma".
function sohbetBasligiGuncelle() {
  const panel = $('sohbetPanel');
  if (!panel) return;
  const t = panel.querySelector('.sohbet-t');
  const g = seciliOturumGecmisi;
  // Başlık görünüm değişince değişmez: hangi oturumda olduğun hep okunur (görünüm adı zaten anahtarda yazıyor).
  if (t) t.textContent = g ? (g.baslik || 'Konuşma') : panel.classList.contains('canli') ? 'Canlı sohbet' : 'Konuşma';
  const mod = $('sohbetMod');
  if (mod) { mod.textContent = g ? (g.altIs ? 'alt iş · salt okunur' : 'salt okunur') : panel.classList.contains('canli') ? 'canlı' : ''; mod.hidden = !mod.textContent; mod.classList.toggle('canli', !g && panel.classList.contains('canli')); }
  const liste = $('sohbetListe');
  if (liste) liste.classList.toggle('cikti-liste', S.panelMod === 'dosyalar');
}
function ciktiCiz() {
  sohbetBasligiGuncelle();
  gorunumSayiGuncelle();
  const liste = $('sohbetListe');
  if (!liste) return;
  const veri = S.ciktilar;
  if (veri == null) {
    liste.innerHTML = '<div class="sohbet-bos">Dosyalar yükleniyor…</div>';
    return;
  }
  const say = Gorunum.dosyaSay(veri);
  if ($('sohbetSayac')) $('sohbetSayac').textContent = say.hepsi;
  const ADLAR = { hepsi: 'Tümü', gorseller: 'Görseller', kod: 'Kod', diger: 'Diğer' };
  for (const b of document.querySelectorAll('#dosyaSuz [data-dsuz]')) {
    const k = b.dataset.dsuz;
    b.classList.toggle('aktif', k === S.dosyaSuz);
    b.innerHTML = `${ADLAR[k]}<span class="say mono">${say[k]}</span>`;
  }
  const kokEl = $('dosyaKok');
  if (kokEl) { kokEl.textContent = S.ciktiKok ? kisaCiktiYolu(S.ciktiKok, 46) : ''; kokEl.title = S.ciktiKok || ''; }
  if (!veri.length) {
    S.dosyaGorseller = [];
    liste.innerHTML = '<div class="sohbet-bos">Bu oturum henüz dosya yazmadı.</div>';
    return;
  }
  const suz = Gorunum.dosyaSuz(veri, S.dosyaSuz);
  const gorseller = suz.filter((c) => Gorunum.dosyaTuru(c) === 'gorsel');
  const digerleri = suz.filter((c) => Gorunum.dosyaTuru(c) !== 'gorsel');
  S.dosyaGorseller = gorseller;
  if (!suz.length) { liste.innerHTML = '<div class="sohbet-bos">Bu süzgeçte dosya yok.</div>'; return; }
  const bolum = (ad, n, mono) => `<div class="dosya-bolum"><span${mono ? ' class="mono"' : ''}>${esc(ad)}</span><b class="mono">${n}</b></div>`;
  const uzanti = (c) => (/\.([a-z0-9]{1,5})$/i.exec(c.yol || '') || [null, 'dosya'])[1].toUpperCase();
  const yeniN = suz.filter((c) => c.islem === 'olusturuldu').length;
  const degN = suz.filter((c) => c.islem === 'degisti').length;
  const ozetParca = [`${suz.length} dosya`];
  if (yeniN) ozetParca.push(`<span class="yeni">${yeniN} yeni</span>`);
  if (degN) ozetParca.push(`<span class="degisti">${degN} değişti</span>`);
  let html = `<div class="dosya-ozet">${ozetParca.join(' · ')}</div>`;
  if (gorseller.length) {
    html += bolum('Görseller', gorseller.length) + '<div class="dosya-izgara">' + gorseller.map((c, i) => `
      <button class="dosya-kucuk" type="button" data-i="${i}" title="${esc(c.yol || '')}">
        ${c.onizleme ? `<img src="${esc(c.onizleme)}" alt="">` : `<span class="cikti-simge">${esc(uzanti(c))}</span>`}
        <span class="dosya-kucuk-ad mono">${esc(c.ad || '')}</span>
      </button>`).join('') + '</div>';
  }
  if (digerleri.length && gorseller.length) html += bolum('Dosyalar', digerleri.length);
  for (const grup of Gorunum.dosyaGrupla(digerleri, S.ciktiKok)) {
    html += grup.ogeler.map((c) => {
      const yol = esc(c.yol || '');
      const durumSinif = c.islem === 'olusturuldu' ? 'yeni' : c.islem === 'komut' ? 'uretti' : 'degisti';
      const saat = ciktiSaat(c.ms);
      const klasor = grup.klasor && grup.klasor !== '.' ? grup.klasor : '';
      return `
      <div class="dosya-satir" data-yol="${yol}" tabindex="0" title="${yol}">
        <span class="dosya-simge mono ${durumSinif}" title="${ciktiIslemEtiketi(c.islem)}">${esc(uzanti(c).slice(0, 4))}</span>
        <div class="dosya-bilgi">
          <span class="dosya-ad">${esc(c.ad || c.yol || '')}</span>
          ${klasor ? `<span class="dosya-yol">${esc(klasor)}</span>` : ''}
        </div>
        <span class="dosya-saat mono">${saat}</span>
        <div class="dosya-eylem">
          <button type="button" data-eylem="ac">Aç</button>
          <button type="button" data-eylem="klasor">Klasörde göster</button>
          <button type="button" data-eylem="kopya">Yolu kopyala</button>
        </div>
      </div>`;
    }).join('');
  }
  liste.innerHTML = html;
  if (liste.dataset.cizim !== 'dosya:' + S.ciktiAnahtar) { liste.scrollTop = 0; liste.dataset.cizim = 'dosya:' + S.ciktiAnahtar; } // yeni oturum ya da mod: en üstten başla
}
// ---- Büyük görsel önizleme katmanı (Esc kapatır, ←/→ gezinir) ----
const GK = { liste: [], i: 0, ist: 0 };
function gorselKatmanGoster() {
  const k = $('gorselKatman');
  const c = GK.liste[GK.i];
  if (!k || !c) return;
  const ist = ++GK.ist;
  const resim = $('gkResim');
  resim.src = c.onizleme || '';
  resim.classList.add('yukleniyor');
  $('gkAd').textContent = c.ad || '';
  $('gkAd').title = c.yol || '';
  $('gkSira').textContent = `${GK.i + 1} / ${GK.liste.length}`;
  $('gkOnceki').hidden = $('gkSonraki').hidden = GK.liste.length < 2;
  k.hidden = false;
  window.evren.gorselBuyuk(c.yol).then((v) => {
    if (GK.ist !== ist) return;
    if (v) resim.src = v;
    resim.classList.remove('yukleniyor');
  });
}
function gorselKatmanAc(i) {
  GK.liste = (S.dosyaGorseller || []).slice();
  if (!GK.liste.length) return;
  GK.i = Math.min(Math.max(0, i), GK.liste.length - 1);
  gorselKatmanGoster();
}
function gorselKatmanGez(yon) {
  if (GK.liste.length < 2) return;
  GK.i = (GK.i + yon + GK.liste.length) % GK.liste.length;
  gorselKatmanGoster();
}
function gorselKatmanKapat() {
  const k = $('gorselKatman');
  if (!k || k.hidden) return;
  GK.ist++;
  k.hidden = true;
}
function dosyaEylem(eylem, yol, dugme) {
  if (!yol) return;
  if (eylem === 'klasor') window.evren.dosyaKlasor(yol);
  else if (eylem === 'kopya') {
    panoYaz(yol);
    if (dugme) { const eski = dugme.textContent; dugme.textContent = 'kopyalandı'; setTimeout(() => { dugme.textContent = eski; }, 1200); }
  } else window.evren.dosyaAc(yol);
}
// ---------- komut paleti ----------
// Tek palet, üç kip: 'komut' (eylem/model/proje), 'gecis' (Ctrl+K oturum hızlı geçişi), 'kisayol' (tablo).
const P = { ogeler: [], gorunen: [], aktif: 0, mod: 'komut' };
const PALET_IPUCU = { komut: 'Model, proje ya da komut ara…', gecis: 'Oturum adı ya da proje yaz…', kisayol: 'Kısayol ara…' };
function kisayolOgeleri() {
  return Gorunum.KISAYOLLAR.map((k) => ({ g: 'Kısayollar', ad: k.ad, alt: Gorunum.etiketDarwin(k.etiket, darwinMi()), ic: 'term', yap: null }));
}
function gecisOgeleri(q) {
  const acik = new Set(S.oturumlar.filter((o) => o.canli && o.devam).map((o) => o.devam));
  return Gorunum.hizliGecis(S.gecmis, q, acilan, projeBilgi).map((g) => ({
    g: q ? 'Eşleşen oturumlar' : 'Son açılan', ad: g.baslik || 'Oturum', ic: 'chat', idx: [],
    alt: `${projeBilgi(g).ad || 'EVREN'} · ${acik.has(g.id) ? 'açık' : kisaZaman(g.ms)}`,
    secili: g.id === gorunenOturumId(), yap: () => gecmisKartAc(g.id, g.projeYol),
  }));
}
function paletOgeleri() {
  const kilit = false; // çoklu oturum: seçimler her zaman yeni oturum içindir
  const ao = aktifOturum();
  const ey = [
    { ad: 'Şef oturumu (/sef)', ic: 'branch', alt: 'hedef · plan · İŞ · kod yazmaz', yap: () => yeniOturumModalAc({ orkestrator: true }), pasif: !S.anahtarVar || !S.yuklendi },
    { ad: 'Yeni oturum başlat', ic: 'play', alt: S.aktif == null ? 'Enter' : '', yap: basla, pasif: !S.anahtarVar || !S.yuklendi },
    ...(ao && ao.canli ? [
      { ad: 'Bu oturumu sonlandır', ic: 'stop', yap: durdur },
      { ad: 'Ara durum raporu iste (/rapor)', ic: 'term', yap: () => { if (window.evren.komutYaz) window.evren.komutYaz(ao.pid, '/rapor'); else window.evren.yaz(ao.pid, '/rapor\r'); } },
      { ad: 'Yeni sohbet özeti iste (/summarize)', ic: 'chat', yap: () => { if (window.evren.komutYaz) window.evren.komutYaz(ao.pid, '/summarize'); else window.evren.yaz(ao.pid, '/summarize\r'); } },
    ] : []),
    ...(ao ? [{ ad: 'Sekmeyi kapat', ic: 'clear', alt: 'Ctrl ⇧ W', yap: () => sekmeKapat(ao.id) }] : []),
    { ad: 'Hızlı geçiş (oturum ara)', ic: 'search', alt: 'Ctrl K', yap: () => paletAc('gecis') },
    { ad: 'Kısayollar', ic: 'term', alt: 'tüm kısayolları listele', yap: () => paletAc('kisayol') },
    { ad: 'Ana ekran', ic: 'term', alt: 'Ctrl ⇧ T', yap: () => sekmeSec(null) },
    { ad: 'Odak modu', ic: 'odak', alt: 'Ctrl ⇧ F', yap: () => odakToggle() },
    ...(aktifGorunum() ? [
      { ad: 'Sohbet görünümü', ic: 'chat', alt: 'Ctrl 1', yap: () => gorunumSec('sohbet') },
      { ad: 'Terminal görünümü', ic: 'term', alt: 'Ctrl 2', yap: () => gorunumSec('terminal') },
      { ad: 'Dosyalar görünümü', ic: 'folder', alt: 'Ctrl 3', yap: () => gorunumSec('dosyalar') },
    ] : []),
    { ad: 'Klasörde çalış…', ic: 'folder', yap: klasorEkle },
    { ad: 'Oturumlar panelini aç / kapat', ic: 'side', alt: 'Ctrl ⇧ B', yap: sideToggle },
    { ad: 'Bağlantıyı yenile', ic: 'refresh', yap: apiYenile },
    { ad: 'Terminali temizle', ic: 'clear', yap: () => { const t = aktifTerm(); if (t) t.clear(); }, pasif: !aktifTerm() },
    { ad: 'Yazıyı büyüt', ic: 'plus', alt: 'Ctrl + teker', yap: () => fsDegis(1) },
    { ad: 'Yazıyı küçült', ic: 'minus', alt: 'Ctrl + teker', yap: () => fsDegis(-1) },
  ].map((x) => ({ g: 'Eylemler', ...x }));
  const md = S.modeller.map((m) => ({ g: 'Modeller', ad: m.ad || m.id, alt: `${m.id} · ${kisaBaglam(m.baglamSayisi)}`, ic: 'cpu', pasif: kilit, secili: m.id === S.model, yap: () => modelSec(m.id) }));
  const pr = S.projeler.map((p) => ({ g: 'Projeler', ad: p.ad, alt: (p.dal ? p.dal + ' · ' : '') + kisaYol(p.yol, 40), ic: 'folder', pasif: kilit, secili: p.yol === S.proje, yap: () => projeSec(p.yol) }));
  const ot = S.oturumlar.map((o, i) => ({ g: 'Oturumlar', ad: `${i + 1} · ${o.proje}`, alt: `${o.model}${o.canli ? '' : ' · kapandı'}`, ic: 'term', secili: o.id === S.aktif, yap: () => sekmeSec(o.id) }));
  return [...ey, ...ot, ...md, ...pr];
}
function eslesme(q, s) {
  const a = s.toLocaleLowerCase('tr'), b = q.toLocaleLowerCase('tr').replace(/\s+/g, '');
  let i = 0, onceki = -2, skor = 0;
  const idx = [];
  for (const ch of b) {
    const j = a.indexOf(ch, i);
    if (j < 0) return null;
    skor += (j === onceki + 1 ? 3 : 1) + (j === 0 || ' -_./·'.includes(a[j - 1]) ? 2 : 0);
    idx.push(j); onceki = j; i = j + 1;
  }
  return { skor: skor - a.length * 0.01, idx };
}
function vurgula(s, idx) {
  if (!idx.length) return esc(s);
  const set = new Set(idx);
  return [...s].map((c, i) => (set.has(i) ? `<mark>${esc(c)}</mark>` : esc(c))).join('');
}
function paletCiz() {
  const q = $('paletGiris').value.trim();
  P.gorunen = [];
  let enIyi = -1, enSkor = -Infinity;
  if (P.mod === 'gecis') {
    // Sıralama Gorunum.hizliGecis'te (katlama + yazım toleransı); burada yeniden puanlanmaz.
    P.gorunen = gecisOgeleri(q);
    P.aktif = 0;
  } else {
    for (const o of P.ogeler) {
      let m = q ? eslesme(q, o.ad) : { skor: 0, idx: [] };
      if (!m && q && o.alt) { const m2 = eslesme(q, o.alt); if (m2) m = { skor: m2.skor - 2, idx: [] }; }
      if (!m) continue;
      if (!o.pasif && m.skor > enSkor) { enSkor = m.skor; enIyi = P.gorunen.length; }
      P.gorunen.push({ ...o, idx: m.idx });
    }
    P.aktif = q ? Math.max(0, enIyi) : Math.max(0, P.gorunen.findIndex((o) => !o.pasif));
  }
  const el = $('paletListe');
  if (!P.gorunen.length) { el.innerHTML = '<div class="pal-bos">Eşleşen yok</div>'; return; }
  let grup = '';
  el.innerHTML = P.gorunen.map((o, i) => {
    const bas = o.g !== grup ? `<div class="pal-g">${esc((grup = o.g))}</div>` : '';
    return `${bas}<div class="pal-i${i === P.aktif ? ' aktif' : ''}${o.pasif ? ' pasif' : ''}" data-i="${i}" role="option">${ikon(o.ic)}<span class="ad">${vurgula(o.ad, o.idx)}</span>${o.secili ? '<span class="secili">seçili</span>' : ''}${o.alt ? `<span class="alt">${esc(o.alt)}</span>` : ''}</div>`;
  }).join('');
}
function paletAktif(i) {
  if (!P.gorunen.length) return;
  P.aktif = (i + P.gorunen.length) % P.gorunen.length;
  for (const r of $('paletListe').querySelectorAll('.pal-i')) r.classList.toggle('aktif', Number(r.dataset.i) === P.aktif);
  const a = $('paletListe').querySelector('.pal-i.aktif');
  if (a) a.scrollIntoView({ block: 'nearest' });
}
function paletAc(mod) {
  P.mod = typeof mod === 'string' && PALET_IPUCU[mod] ? mod : 'komut'; // düğme olayı kip sanılmasın
  P.ogeler = P.mod === 'komut' ? paletOgeleri() : P.mod === 'kisayol' ? kisayolOgeleri() : [];
  $('palet').hidden = false;
  $('paletGiris').placeholder = PALET_IPUCU[P.mod];
  $('paletGiris').value = '';
  paletCiz();
  $('paletGiris').focus();
}
function paletKapat() {
  $('palet').hidden = true;
  { const t = aktifTerm(); if (t) t.focus(); }
}
function paletUygula(i) {
  const o = P.gorunen[i];
  if (!o || o.pasif || !o.yap) return; // kısayol satırları yalnız bilgi
  paletKapat();
  o.yap();
}
$('paletGiris').addEventListener('input', paletCiz);
$('paletGiris').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); paletAktif(P.aktif + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); paletAktif(P.aktif - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); paletUygula(P.aktif); }
  else if (e.key === 'Escape') { e.preventDefault(); paletKapat(); }
});
$('paletListe').addEventListener('mousemove', (e) => {
  const r = e.target.closest('.pal-i');
  if (r && Number(r.dataset.i) !== P.aktif) paletAktif(Number(r.dataset.i));
});
$('paletListe').addEventListener('click', (e) => { const r = e.target.closest('.pal-i'); if (r) paletUygula(Number(r.dataset.i)); });
$('palet').addEventListener('mousedown', (e) => { if (e.target === $('palet')) paletKapat(); });
// ---------- paylaşılan kare zamanlayıcı ----------
// Tek requestAnimationFrame döngüsü; tüm paneller (ana grafik, gecikme, ileride eklenecekler)
// aynı kareden beslenir. Böylece panel sayısı artsa da yalnız bir zamanlayıcı çalışır.
// ---------- Token Harcama Şeridi (Item 5b) ----------
const KotaSerit = (() => {
  const cv = $('kotaSerit');
  if (!cv) return { ekle: () => {}, ciz: () => {} };
  const c = cv.getContext('2d');
  let gecmis = sakla.oku('kotaSeritGecmis', []);
  if (!Array.isArray(gecmis)) gecmis = [];
  function ekle(kullanilan) {
    if (typeof kullanilan !== 'number' || isNaN(kullanilan)) return;
    gecmis.push(kullanilan);
    if (gecmis.length > 24) gecmis = gecmis.slice(-24);
    sakla.yaz('kotaSeritGecmis', gecmis);
    ciz();
  }
  function ciz() {
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth || 280;
    const h = cv.clientHeight || 12;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const farklar = gecmis.slice(1).map((v, i) => Math.max(0, v - gecmis[i]));
    if (!farklar.length) return;
    const enCok = Math.max(...farklar, 1), gen = 3, ara = 2;
    farklar.forEach((f, i) => {
      const x = Math.round(w - (farklar.length - i) * (gen + ara) + ara);
      const yuk = f > 0 ? Math.max(2, Math.round((f / enCok) * (h - 1))) : 1;
      c.fillStyle = f === 0 ? 'rgba(255,255,255,0.14)' : (i === farklar.length - 1 ? 'rgba(255,255,255,0.95)' : 'rgba(236,238,241,0.5)');
      c.fillRect(x, h - yuk, gen, yuk);
    });
  }
  return { ekle, ciz };
})();
// ---------- Canlı Takımyıldız Paneli (Item 5a) ----------
const Takimyildiz = (() => {
  const cv = $('takimyildizTuval');
  const sakin = $('takimyildizSakin');
  const sayEl = $('takimyildizSay');
  if (!cv) return { olc: () => {}, guncelle: () => {}, parla: () => {}, ciz: () => {} };
  const c = cv.getContext('2d');
  let w = 0, h = 0, dpr = 1;
  const yildizlar = new Map();
  let sonZaman = performance.now();
  function olc() {
    const b = cv.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = b.width;
    h = b.height;
    if (w <= 0 || h <= 0) return false;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    return true;
  }
  function guncelle() {
    if (!Array.isArray(S.gecmis)) return;
    const canlilar = S.gecmis.filter((g) => g.canli || g.turCanli || (g.calisanAjan > 0) || (g.calisanEvren > 0) || gecmisAcikMi(g)).slice(0, 12);
    if (sayEl) sayEl.textContent = `${canlilar.length} etkin`;
    if (sakin) sakin.hidden = canlilar.length > 0;
    const yeni = canlilar.map((g) => {
      const e = yildizlar.get(g.id);
      return { id: g.id, g, baslik: g.baslik || g.projeAd || 'Oturum', ajanlar: [...(g.altAjanlar || []), ...(g.evrenIsleri || [])], parlama: e ? e.parlama : 0.7, sx: e ? e.sx : 0, sy: e ? e.sy : 0 };
    });
    yildizlar.clear();
    for (const y of yeni) yildizlar.set(y.id, y);
  }
  function parla(id) { const y = yildizlar.get(id); if (y) y.parlama = 1; }
  function sigdirMetin(m, enCok) {
    if (c.measureText(m).width <= enCok) return m;
    let s = m;
    while (s.length > 1 && c.measureText(s + '…').width > enCok) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  }
  function ciz(now) {
    if (!w && !olc()) return;
    const dt = Math.min(0.1, (now - sonZaman) / 1000);
    sonZaman = now;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const liste = [...yildizlar.values()], n = liste.length;
    if (!n) return;
    const t = now / 1000, adim = w / n, sal = n > 1 ? Math.min(12, h * 0.1) : 0;
    liste.forEach((y, i) => {
      y.sx = (i + 0.5) * adim;
      y.sy = h * 0.42 + (i % 2 ? sal : -sal) + (AZ_HAREKET ? 0 : Math.sin(t * 0.5 + i * 1.7) * 2);
    });
    c.strokeStyle = 'rgba(255,255,255,0.11)'; c.lineWidth = 1;
    c.beginPath(); liste.forEach((y, i) => (i ? c.lineTo(y.sx, y.sy) : c.moveTo(y.sx, y.sy))); c.stroke();
    c.font = '500 9.5px "IBM Plex Mono", Consolas, monospace';
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    for (const y of liste) {
      y.parlama = Math.max(0, y.parlama - dt * 1.2);
      y.ajanlar.slice(0, 8).forEach((a, i, d) => {
        const aci = (AZ_HAREKET ? 0 : t * 0.5) + (i * 6.283) / d.length;
        const ux = y.sx + Math.cos(aci) * 13, uy = y.sy + Math.sin(aci) * 13;
        c.strokeStyle = 'rgba(255,255,255,0.12)';
        c.beginPath(); c.moveTo(y.sx, y.sy); c.lineTo(ux, uy); c.stroke();
        c.fillStyle = a.canli ? '#3ec28a' : 'rgba(236,238,241,0.55)';
        c.beginPath(); c.arc(ux, uy, 1.5, 0, 6.283); c.fill();
      });
      if (y.parlama > 0) {
        c.strokeStyle = `rgba(255,255,255,${(y.parlama * 0.45).toFixed(3)})`;
        c.beginPath(); c.arc(y.sx, y.sy, 4 + (1 - y.parlama) * 9, 0, 6.283); c.stroke();
      }
      c.fillStyle = `rgba(255,255,255,${(0.7 + y.parlama * 0.3).toFixed(3)})`;
      c.beginPath(); c.arc(y.sx, y.sy, 3, 0, 6.283); c.fill();
      if (adim >= 52) { c.fillStyle = 'rgba(162,170,181,0.9)'; c.fillText(sigdirMetin(y.baslik, adim - 10), y.sx, y.sy + 26); }
    }
  }
  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top;
    for (const y of yildizlar.values()) {
      if ((cx - y.sx) ** 2 + (cy - y.sy) ** 2 > 484) continue;
      const var_ = S.oturumlar.find((o) => o.canli && o.devam === y.id);
      if (var_) sekmeSec(var_.id); else oturumIzle(y.g);
      break;
    }
  });
  new ResizeObserver(() => olc()).observe(cv.parentElement);
  return { olc, guncelle, parla, ciz };
})();
const Kare = (() => {
  const aboneler = new Set();
  let raf = 0;
  let sonKare = performance.now();
  const kareSureleri = [];
  function isModalAcik() {
    const m1 = $('yeniOturumModal'), m2 = $('kumandaModal'), m3 = $('palet');
    return (m1 && !m1.hidden) || (m2 && !m2.hidden) || (m3 && !m3.hidden);
  }
  function dongu(now) {
    raf = 0;
    const dt = now - sonKare;
    sonKare = now;
    if (dt > 0 && dt < 100) {
      kareSureleri.push(dt);
      if (kareSureleri.length > 120) kareSureleri.shift();
    }
    if (!document.hidden && !isModalAcik()) {
      for (const f of [...aboneler]) { try { f(now); } catch (e) { console.error(e); } }
    }
    if (aboneler.size) raf = requestAnimationFrame(dongu);
  }
  function p95() {
    if (!kareSureleri.length) return 0;
    const sirali = [...kareSureleri].sort((a, b) => a - b);
    const idx = Math.min(sirali.length - 1, Math.floor(sirali.length * 0.95));
    return sirali[idx];
  }
  function uyandir() { if (!raf && !document.hidden && aboneler.size) raf = requestAnimationFrame(dongu); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else uyandir(); });
  return {
    abone(f) {
      aboneler.add(f); uyandir();
      return () => {
        aboneler.delete(f);
        // Son abone da gittiyse döngüyü hemen durdur: abonesiz 60 FPS rAF tiklemez (GPU/CPU bütçesi).
        if (!aboneler.size && raf) { cancelAnimationFrame(raf); raf = 0; }
      };
    },
    durdur() { cancelAnimationFrame(raf); raf = 0; },
    get calisiyor() { return !!raf; },
    aboneSayisi: () => aboneler.size,
    p95,
  };
})();
// ---------- durum sütunu: gecikme grafiği ----------
const kanvas = (id) => {
  const cv = $(id), c = cv.getContext('2d');
  const o = { cv, c, w: 0, h: 0, dpr: 1 };
  o.olc = () => {
    const b = cv.getBoundingClientRect();
    o.dpr = Math.min(2, window.devicePixelRatio || 1); o.w = b.width; o.h = b.height;
    if (!o.w) return false;
    cv.width = Math.round(o.w * o.dpr); cv.height = Math.round(o.h * o.dpr);
    return true;
  };
  o.hazirla = () => { c.setTransform(o.dpr, 0, 0, o.dpr, 0, 0); c.clearRect(0, 0, o.w, o.h); };
  return o;
};
const Gecikme = (() => {
  const k = kanvas('gecGrafik');
  const MONO = '"IBM Plex Mono", Consolas, monospace';
  function ciz(t) {
    if (!k.w) return;
    const c = k.c; k.hazirla();
    const P = { l: 10, r: 44, t: 8, b: 10 }, W = k.w - P.l - P.r, H = k.h - P.t - P.b;
    c.strokeStyle = 'rgba(255,255,255,0.05)'; c.lineWidth = 1;
    for (let i = 0; i <= 2; i++) { const y = Math.round(P.t + (H * i) / 2) + 0.5; c.beginPath(); c.moveTo(P.l, y); c.lineTo(P.l + W, y); c.stroke(); }
    const v = S.pingler;
    const gecerli = v.filter((x) => x != null);
    c.font = `400 9.5px ${MONO}`; c.textBaseline = 'middle';
    if (gecerli.length < 2) {
      c.fillStyle = 'rgba(109,117,129,0.8)'; c.textAlign = 'center';
      c.fillText('ölçüm bekleniyor', P.l + W / 2, P.t + H / 2);
    } else {
      const mn = Math.min(...gecerli), mx = Math.max(...gecerli), ust = mx + (mx - mn) * 0.25 + 5, alt = Math.max(0, mn - (mx - mn) * 0.25 - 5);
      const xy = (i, val) => [P.l + (i / 23) * W, P.t + H - ((val - alt) / (ust - alt)) * H];
      const ofs = 24 - v.length;
      const pts = v.map((val, i) => (val == null ? null : xy(i + ofs, val))).filter(Boolean);
      const gr = c.createLinearGradient(0, P.t, 0, P.t + H);
      gr.addColorStop(0, 'rgba(230,232,235,0.16)'); gr.addColorStop(1, 'rgba(230,232,235,0)');
      c.beginPath(); c.moveTo(pts[0][0], P.t + H);
      for (const p of pts) c.lineTo(p[0], p[1]);
      c.lineTo(pts[pts.length - 1][0], P.t + H); c.closePath(); c.fillStyle = gr; c.fill();
      c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
      c.strokeStyle = 'rgba(236,238,241,0.85)'; c.lineWidth = 1.3; c.lineJoin = 'round'; c.stroke();
      const son = pts[pts.length - 1], nb = (t * 0.9) % 1;
      c.strokeStyle = `rgba(236,238,241,${(0.5 * (1 - nb)).toFixed(3)})`; c.beginPath(); c.arc(son[0], son[1], 2 + nb * 7, 0, 6.283); c.stroke();
      c.fillStyle = '#fff'; c.beginPath(); c.arc(son[0], son[1], 2.2, 0, 6.283); c.fill();
      c.textAlign = 'left'; c.fillStyle = 'rgba(162,170,181,0.85)';
      c.fillText(`${mx}`, P.l + W + 8, P.t + 2); c.fillText(`${mn}`, P.l + W + 8, P.t + H - 2);
      $('gecOzet').textContent = `ort ${Math.round(gecerli.reduce((s, x) => s + x, 0) / gecerli.length)} ms · ${gecerli.length}/24`;
    }
    // tarama çizgisi yalnız veri varken (boş grafikte gereksiz hareket olmasın)
    if (gecerli.length >= 2) {
      const sx = P.l + ((t / 5) % 1) * W;
      const sg = c.createLinearGradient(sx - 30, 0, sx, 0);
      sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(1, 'rgba(255,255,255,0.07)');
      c.fillStyle = sg; c.fillRect(sx - 30, P.t, 30, H);
      c.fillStyle = 'rgba(255,255,255,0.22)'; c.fillRect(sx, P.t, 1, H);
    }
  }
  return { olc: k.olc, ciz };
})();
// Kalıcı abone YOK: takımyıldız artık Grafik.basla()/dur() yaşam döngüsüne bağlı —
// brif gizliyken (oturumda çalışırken) tek kare bile çizilmez.
// ---------- canlı grafik: Model → EVREN → Proje akışı + takımyıldız ----------
const Grafik = (() => {
  const kutu = $('brif');
  const cv = document.createElement('canvas');
  kutu.prepend(cv);
  const c = cv.getContext('2d', { alpha: false });
  let w = 0, h = 0, dpr = 1, bag = null, son = 0, kart = null, fare = null, isabet = [];
  let sonImlec = ''; // imleç stili yazma önbelleği: her karede style.atama = gereksiz stil geçersiz kılma
  // Etiket genişlikleri her karede yeniden ölçülmez: (taraf, liste uzunluğu, tuval genişliği) sabitse önbellek.
  const etiketWBellek = { sag: null, sol: null };
  const t0 = performance.now();
  const yildiz = Array.from({ length: 38 }, () => ({
    x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.008, vy: (Math.random() - 0.5) * 0.008, r: Math.random() * 1.1 + 0.5,
  }));
  const MONO = '"IBM Plex Mono", Consolas, monospace';
  function olc() {
    const b = kutu.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = b.width; h = b.height;
    cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr));
    const k = kutu.querySelector('.ops').getBoundingClientRect();
    Gecikme.olc();
    Takimyildiz.olc();
    kart = { x: k.left - b.left, y: k.top - b.top, w: k.width, h: k.height };
    if (!bag) ciz(performance.now(), true);
  }
  const bez = (p0, c0, p1, t) => {
    const u = 1 - t;
    return [u * u * p0[0] + 2 * u * t * c0[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c0[1] + t * t * p1[1]];
  };
  function kolon(liste, sag, secili, t, etiketli) {
    if (!kart || !liste.length) return [];
    const bosluk = sag ? w - (kart.x + kart.w) : kart.x;
    // Etiketin tamamı sığmalı: en uzun etiket + düğüm + kenar payı; sığmazsa çağıran etiketsiz çizer.
    // measureText pahalıdır: (liste uzunluğu, w) değişmediyse önbellekten kullan, her karede ölçme.
    let etiketW = 0;
    if (etiketli) {
      const taraf = sag ? 'sag' : 'sol';
      const anahtar = `${liste.length}|${Math.round(w)}`;
      const kayit = etiketWBellek[taraf];
      if (kayit && kayit.anahtar === anahtar) {
        etiketW = kayit.deger;
      } else {
        c.font = `500 10px ${MONO}`;
        etiketW = Math.min(150, Math.max(...liste.map((o) => c.measureText(o.ust.length > 22 ? o.ust.slice(0, 21) + '…' : o.ust).width)));
        etiketWBellek[taraf] = { anahtar, deger: etiketW };
      }
    }
    const ara = Math.min(130, bosluk - etiketW - (etiketli ? 36 : 24));
    if (ara < 40) return [];
    const x = sag ? kart.x + kart.w + ara : kart.x - ara;
    const n = liste.length, cy = kart.y + kart.h / 2;
    const yay = Math.min(h * 0.62, Math.max(0, n - 1) * 46);
    return liste.map((o, i) => {
      const y = cy - yay / 2 + (n > 1 ? (i * yay) / (n - 1) : 0) + Math.sin(t * 0.7 + i * 1.7) * 2.2;
      const ank = [sag ? kart.x + kart.w : kart.x, cy + (i - (n - 1) / 2) * 9];
      return { o, x, y, ank, sec: o.id === secili, sag };
    });
  }
  // Yatay sıra: kartın üstünde (modeller) ya da altında (projeler); en az 64 px dikey boşluk gerekir.
  function satir(liste, ust, secili, t) {
    if (!kart || !liste.length) return [];
    const bosluk = ust ? kart.y : h - (kart.y + kart.h);
    if (bosluk < 64) return [];
    const y0 = ust ? kart.y - Math.min(56, bosluk - 30) : kart.y + kart.h + Math.min(56, bosluk - 34);
    const n = liste.length, adim = Math.min(170, kart.w / n);
    const bas = kart.x + kart.w / 2 - (adim * (n - 1)) / 2;
    return liste.map((o, i) => {
      const x = bas + i * adim + Math.sin(t * 0.6 + i * 1.9) * 1.6;
      const ank = [kart.x + kart.w / 2 + (i - (n - 1) / 2) * 16, ust ? kart.y : kart.y + kart.h];
      return { o, x, y: y0, ank, sec: o.id === secili, sag: !ust, yatay: true };
    });
  }
  function ciz(now, zorla) {
    if (!zorla && now - son < 33) return; // ~30 kare/sn yeter, işlemciyi yormaz
    const dt = Math.min(0.1, (now - son) / 1000 || 0);
    son = now;
    const t = (now - t0) / 1000;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#0a0c0f';
    c.fillRect(0, 0, w, h);
    // takımyıldız
    const pts = [];
    for (const s of yildiz) {
      if (!AZ_HAREKET) { s.x = (s.x + s.vx * dt + 1) % 1; s.y = (s.y + s.vy * dt + 1) % 1; }
      pts.push([s.x * w, s.y * h, s.r]);
    }
    c.lineWidth = 1;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1], d2 = dx * dx + dy * dy;
        if (d2 > 16900) continue;
        c.strokeStyle = `rgba(200,206,214,${((1 - Math.sqrt(d2) / 130) * 0.13).toFixed(3)})`;
        c.beginPath(); c.moveTo(pts[i][0], pts[i][1]); c.lineTo(pts[j][0], pts[j][1]); c.stroke();
      }
    }
    c.fillStyle = 'rgba(164,174,185,0.38)';
    for (const p of pts) { c.beginPath(); c.arc(p[0], p[1], p[2], 0, 6.283); c.fill(); }
    // akış
    // İki sütun simetrik: biri etiketiyle sığmıyorsa ikisi de etiketsiz çizilir; tek taraflı görüntü olmaz.
    const mL = S.modeller.map((m) => ({ id: m.id, ust: m.id, alt: kisaBaglam(m.baglamSayisi) }));
    const pL = S.projeler.map((p) => ({ id: p.yol, ust: p.ad, alt: p.dal || '' }));
    let etiketli = true, yatay = false;
    let sol = kolon(mL, false, S.model, t, true), sag = kolon(pL, true, S.proje, t, true);
    if ((!sol.length && mL.length) || (!sag.length && pL.length)) {
      // Yanlarda yer yoksa: modeller üstte bir sıra, projeler altta bir sıra (akış yukarıdan aşağı).
      sol = satir(mL, true, S.model, t); sag = satir(pL, false, S.proje, t);
      yatay = true;
      if ((!sol.length && mL.length) || (!sag.length && pL.length)) {
        yatay = false; etiketli = false;
        sol = kolon(mL, false, S.model, t, false); sag = kolon(pL, true, S.proje, t, false);
        if ((!sol.length && mL.length) || (!sag.length && pL.length)) { sol = []; sag = []; }
      }
    }
    isabet = [...sol, ...sag];
    c.font = `500 10px ${MONO}`;
    c.textBaseline = 'middle';
    for (const d of isabet) {
      const p0 = [d.x, d.y], p1 = d.ank, k0 = d.yatay ? [p0[0], (p0[1] + p1[1]) / 2] : [(p0[0] + p1[0]) / 2, p0[1]];
      const ust = fare && Math.hypot(fare[0] - d.x, fare[1] - d.y) < 16;
      c.strokeStyle = d.sec ? 'rgba(230,232,235,0.5)' : ust ? 'rgba(230,232,235,0.28)' : 'rgba(58,68,80,0.75)';
      c.lineWidth = d.sec ? 1.2 : 1;
      c.beginPath(); c.moveTo(p0[0], p0[1]); c.quadraticCurveTo(k0[0], k0[1], p1[0], p1[1]); c.stroke();
      // paketler: modelden karta, karttan projeye akar
      const adet = d.sec ? 3 : 1, hiz = d.sec ? 0.42 : 0.16;
      for (let k = 0; k < adet; k++) {
        let f = (t * hiz + k / adet + (d.sec ? 0 : d.y * 0.013)) % 1;
        if (d.sag) f = 1 - f;
        const q = bez(p0, k0, p1, f);
        if (d.sec) { c.fillStyle = 'rgba(255,255,255,0.14)'; c.beginPath(); c.arc(q[0], q[1], 4, 0, 6.283); c.fill(); }
        c.fillStyle = d.sec ? '#ffffff' : 'rgba(108,119,131,0.6)';
        c.fillRect(q[0] - 1.25, q[1] - 1.25, 2.5, 2.5);
      }
      // düğüm
      if (d.sec) {
        const nb = (t * 0.8) % 1;
        c.strokeStyle = `rgba(230,232,235,${(0.6 * (1 - nb)).toFixed(3)})`;
        c.beginPath(); c.arc(d.x, d.y, 4 + nb * 9, 0, 6.283); c.stroke();
        c.strokeStyle = '#e6e8eb'; c.beginPath(); c.arc(d.x, d.y, 5, 0, 6.283); c.stroke();
      }
      c.fillStyle = d.sec ? '#ffffff' : ust ? '#a4aeb9' : '#4a535d';
      c.beginPath(); c.arc(d.x, d.y, d.sec ? 2.6 : 2.2, 0, 6.283); c.fill();
      // etiket
      if (!etiketli) continue;
      if (d.yatay) {
        // üst sıra: etiket düğümün üstünde; alt sıra: altında
        c.textAlign = 'center';
        const y1 = d.sag ? d.y + 14 : d.y - 27, y2 = d.sag ? d.y + 26 : d.y - 15;
        c.fillStyle = d.sec ? '#ffffff' : ust ? '#a4aeb9' : '#6c7783';
        c.fillText(d.o.ust.length > 20 ? d.o.ust.slice(0, 19) + '…' : d.o.ust, d.x, y1);
        c.fillStyle = d.sec ? '#e6e8eb' : '#4a535d';
        c.fillText(d.o.alt, d.x, y2);
        continue;
      }
      c.textAlign = d.sag ? 'left' : 'right';
      const lx = d.sag ? d.x + 12 : d.x - 12;
      c.fillStyle = d.sec ? '#ffffff' : ust ? '#a4aeb9' : '#6c7783';
      c.fillText(d.o.ust.length > 22 ? d.o.ust.slice(0, 21) + '…' : d.o.ust, lx, d.y - 6);
      c.fillStyle = d.sec ? '#e6e8eb' : '#4a535d';
      c.fillText(d.o.alt, lx, d.y + 7);
    }
    // sütun başlıkları
    c.font = `600 9.5px ${MONO}`;
    c.fillStyle = '#4a535d';
    if (yatay) {
      c.textAlign = 'left';
      if (sol.length) c.fillText('MODEL', kart.x, sol[0].y - 44);
      if (sag.length) c.fillText('PROJE', kart.x, sag[0].y + 42);
    } else if (!etiketli) { /* başlık yok */ } else if (sol.length) { c.textAlign = 'right'; c.fillText('MODEL', sol[0].x - 12, Math.min(...sol.map((d) => d.y)) - 26); }
    if (!yatay && etiketli && sag.length) { c.textAlign = 'left'; c.fillText('PROJE', sag[0].x + 12, Math.min(...sag.map((d) => d.y)) - 26); }
    Gecikme.ciz(t);
    const yeniImlec = fare && isabet.some((d) => Math.hypot(fare[0] - d.x, fare[1] - d.y) < 16) && S.aktif == null ? 'pointer' : '';
    if (yeniImlec !== sonImlec) { cv.style.cursor = yeniImlec; sonImlec = yeniImlec; }
  }
  cv.addEventListener('mousemove', (e) => { const b = cv.getBoundingClientRect(); fare = [e.clientX - b.left, e.clientY - b.top]; });
  cv.addEventListener('mouseleave', () => { fare = null; });
  cv.addEventListener('click', (e) => {
    const b = cv.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
    const d = isabet.find((n) => Math.hypot(x - n.x, y - n.y) < 16);
    if (!d) return;
    d.sag ? projeSec(d.o.id) : modelSec(d.o.id);
  });
  new ResizeObserver(() => { if (!gecisSuruyor) olc(); }).observe(kutu);
  document.addEventListener('visibilitychange', () => (document.hidden ? dur() : basla()));
  function basla() {
    if (bag || document.hidden || kutu.hidden || S.aktif != null) return;
    olc();
    if (AZ_HAREKET) { ciz(performance.now(), true); Takimyildiz.ciz(performance.now()); return; }
    son = 0;
    // Takımyildiz aynı abonede: brif gizlendiğinde dur() aboneliği kaldırır ve Kare rAF'ı kapatır.
    bag = Kare.abone((now) => { ciz(now); Takimyildiz.ciz(now); });
  }
  function dur() {
    if (!bag) return;
    bag();
    bag = null;
  }
  return { basla, dur, olc };
})();

// ---------- Yeni Oturum Başlat Modalı: Çalışma Alanı ve Model ----------
// Seçim üç türlü olabilir: proje (ad + klasörler), tek seferlik klasör, projesiz (EVREN alanı).
let modalSecim = null; // { tip: 'bos' | 'proje' | 'klasor', ... }
let modalSecilenModel = '';
let modalEfor = 'medium';
let modalOrkestrator = false;
let modalKodYazma = false;
let modalProjeAra = '';
let adlananOturum = null; // { devam, dizin } — yeniden adlandırma modalının hedefi
let modalProjeTumu = false;
const MODAL_PROJE_GORUNEN = 3;

function rolAnahtarlariniCiz() {
  const ork = $('modalOrkSwitch'), kod = $('modalKodSwitch'), ipucu = $('modalRolIpucu');
  if (ork) ork.setAttribute('aria-checked', modalOrkestrator ? 'true' : 'false');
  if (kod) {
    kod.hidden = !modalOrkestrator;
    kod.setAttribute('aria-checked', modalKodYazma ? 'true' : 'false');
  }
  if (ipucu) ipucu.textContent = modalOrkestrator
    ? (modalKodYazma ? 'Şef · yazma açık' : 'Şef · yalnız plan ve İŞ')
    : 'Ajan doğrudan çalışır';
}

function modalSecimProje() {
  return modalSecim && modalSecim.tip === 'proje' ? S.projeler.find((p) => p.yol === modalSecim.yol) : null;
}
function modalSecimEtiket() {
  if (!modalSecim || modalSecim.tip === 'bos') return 'EVREN çalışma alanı';
  if (modalSecim.tip === 'klasor') return modalSecim.ad || 'Klasör';
  const p = modalSecimProje();
  return p ? p.ad : 'Proje';
}

function projeKartHTML(p) {
  const secili = modalSecim && modalSecim.tip === 'proje' && modalSecim.yol === p.yol;
  const ek = Array.isArray(p.yollar) ? p.yollar.length - 1 : 0;
  return `
    <div class="oturum-secim-kart proje-kart${secili ? ' aktif' : ''}" role="button" tabindex="0" data-proje="${esc(p.yol)}" aria-pressed="${secili}">
      <span class="proje-monogram" aria-hidden="true">${esc(monogram(p.ad))}</span>
      <div class="oturum-kart-govde">
        <div class="oturum-secim-kart-ust">
          <span class="oturum-secim-kart-ad" title="${esc(p.ad)}">${esc(p.ad)}</span>
          ${p.dal ? `<span class="tag mono">${esc(p.dal)}</span>` : ''}
        </div>
        <div class="oturum-kart-alt-satir">
          <span class="oturum-secim-kart-alt mono" title="${esc(p.yol)}">${esc(kisaYol(p.yol, 28))}</span>
          ${ek > 0 ? `<span class="tag mono" title="${esc(p.yollar.slice(1).join('\n'))}">+${ek}</span>` : ''}
          <button class="oturum-kart-duzenle" type="button" data-duzenle="${esc(p.yol)}" title="Projeyi düzenle" aria-label="${esc(p.ad)} projesini düzenle">
            <svg class="ic"><use href="#i-edit" /></svg>
          </button>
          <button class="oturum-kart-sil" type="button" data-sil="${esc(p.yol)}" title="Listeden kaldır (disk silinmez)" aria-label="${esc(p.ad)} projesini listeden kaldır">
            <svg class="ic"><use href="#i-close" /></svg>
          </button>
        </div>
      </div>
    </div>`;
}

function yeniOturumModalGuncelle() {
  const pIzgara = $('modalProjeIzgara');
  const mIzgara = $('modalModelIzgara');
  if (!pIzgara || !mIzgara) return;
  if (!modalSecim) modalSecim = { tip: 'bos' };
  if (!modalSecilenModel && S.modeller.length) modalSecilenModel = S.model || S.modeller[0].id;

  const q = modalProjeAra.trim().toLocaleLowerCase('tr');
  const eslesen = S.projeler.filter((p) => !q || `${p.ad} ${p.yol}`.toLocaleLowerCase('tr').includes(q));
  const gorunen = q || modalProjeTumu ? eslesen : eslesen.slice(0, MODAL_PROJE_GORUNEN);
  const kartlar = [];
  const bosSecili = modalSecim.tip === 'bos';
  // Tek seferlik klasör seçildiyse listede kendi kartı görünür; proje kaydı oluşturmaz.
  if (modalSecim.tip === 'klasor') {
    kartlar.push(`
      <div class="oturum-secim-kart proje-kart proje-gecici-kart aktif" role="button" tabindex="0" data-gecici="1" aria-pressed="true">
        <span class="proje-monogram" aria-hidden="true">${esc(monogram(modalSecim.ad))}</span>
        <div class="oturum-kart-govde">
          <div class="oturum-secim-kart-ust">
            <span class="oturum-secim-kart-ad" title="${esc(modalSecim.ad)}">${esc(modalSecim.ad)}</span>
            <span class="tag mono">klasör</span>
          </div>
          <div class="oturum-kart-alt-satir">
            <span class="oturum-secim-kart-alt mono" title="${esc(modalSecim.yol)}">${esc(kisaYol(modalSecim.yol, 28))}</span>
            <button class="oturum-kart-duzenle" type="button" data-gecici-kaydet="1" title="Proje olarak kaydet" aria-label="Bu klasörü proje olarak kaydet">
              <svg class="ic"><use href="#i-edit" /></svg>
            </button>
          </div>
        </div>
      </div>`);
  }
  kartlar.push(...gorunen.map(projeKartHTML));
  if (q && !eslesen.length) kartlar.push('<div class="oturum-bos">Eşleşen proje yok.</div>');
  if (!q && eslesen.length > MODAL_PROJE_GORUNEN) {
    kartlar.push(`<div class="oturum-proje-daha"><button class="btn-baglanti" type="button" data-daha="1">${modalProjeTumu ? 'Daralt' : `Tümünü göster (${eslesen.length})`}</button></div>`);
  }
  // Projesiz: proje değil, kaçış yolu. Ayrı satır diliyle en altta durur.
  kartlar.push(`
    <div class="oturum-projesiz-kart${bosSecili ? ' aktif' : ''}" role="button" tabindex="0" data-bos="1" aria-pressed="${bosSecili}">
      <svg class="ic" aria-hidden="true"><use href="#i-evren" /></svg>
      <span class="oturum-projesiz-metin">
        <b>Projesiz başla</b>
        <span class="mono" title="${esc(S.serbestDizin || 'EVREN')}">EVREN çalışma alanı${S.serbestDizin ? ' · ' + esc(kisaYol(S.serbestDizin, 34)) : ''}</span>
      </span>
      <span class="oturum-kart-secim" aria-hidden="true"></span>
    </div>`);
  pIzgara.classList.toggle('kaydir', gorunen.length > MODAL_PROJE_GORUNEN);
  pIzgara.innerHTML = kartlar.length ? kartlar.join('') : `<div class="oturum-bos">Eşleşen proje yok.</div>`;

  // Arama yalnız proje sayısı arttığında görünür.
  const ust = $('modalProjeUst');
  if (ust) {
    ust.hidden = S.projeler.length <= 4;
    if ($('modalProjeSay')) $('modalProjeSay').textContent = q ? `${eslesen.length}/${S.projeler.length}` : `${S.projeler.length} proje`;
    if ($('modalProjeAra') && $('modalProjeAra').value !== modalProjeAra) $('modalProjeAra').value = modalProjeAra;
  }
  if (!q && eslesen.length <= MODAL_PROJE_GORUNEN) modalProjeTumu = false;

  // Model kartları: ad, tek satır not ve bağlam büyüklüğü. Çubuk yerine sayı: daha sakin,
  // daha az yer kaplar; modeller arasındaki tek nesnel fark zaten bağlam penceresi.
  mIzgara.innerHTML = S.modeller.map((m) => `
    <button class="oturum-secim-kart model-kart${m.id === modalSecilenModel ? ' aktif' : ''}" type="button" data-model="${esc(m.id)}" aria-pressed="${m.id === modalSecilenModel}">
      <div class="oturum-secim-kart-ust">
        <span class="oturum-secim-kart-ad" title="${esc(m.ad || m.id)}">${esc(m.ad || m.id)}</span>
        <span class="oturum-kart-secim" aria-hidden="true"></span>
      </div>
      <span class="oturum-secim-kart-alt">${esc(m.not || '')}${m.baglamSayisi ? ` · ${esc(kisaBaglam(m.baglamSayisi))} bağlam` : ''}</span>
    </button>
  `).join('');

  // Efor: beş seviye, tek satır segment. Liste ana süreçten (motor.EFORLAR) gelir.
  const eforlar = S.eforlar.length ? S.eforlar : [
    { id: 'low', ad: 'Düşük', not: 'Hızlı yanıt, az düşünme' },
    { id: 'medium', ad: 'Orta', not: 'Dengeli varsayılan' },
    { id: 'high', ad: 'Yüksek', not: 'Daha derin düşünme' },
    { id: 'xhigh', ad: 'Çok yüksek', not: 'Zor işler için çok derin' },
    { id: 'max', ad: 'Azami', not: 'En derin düşünme, en yavaş' },
  ];
  if (!eforlar.some((e) => e.id === modalEfor)) modalEfor = 'medium';
  const eObj = eforlar.find((e) => e.id === modalEfor);
  if ($('modalEforSec')) {
    $('modalEforSec').innerHTML = eforlar.map((e) => `
      <button class="efor-sec${e.id === modalEfor ? ' aktif' : ''}" type="button" role="radio" aria-checked="${e.id === modalEfor}" aria-label="${esc(e.ad || e.id)} · ${esc(e.not || '')}" data-efor="${esc(e.id)}" title="${esc(e.not || '')}">
        <span class="efor-ad">${esc(e.ad || e.id)}</span>
      </button>`).join('');
  }
  // Açıklama tek satırda: beş kartın altında değişen ipucu, kartların boyunu eşit tutar.
  if ($('modalEforIpucu')) $('modalEforIpucu').textContent = eObj ? (eObj.not || '') : '';
  const mObj = S.modeller.find((m) => m.id === modalSecilenModel);
  const pAd = modalSecimEtiket();
  const mAd = mObj ? (mObj.ad || mObj.id) : 'Model seçilmedi';
  if ($('modalSeciliBilgi')) {
    const prjCip = modalSecim.tip === 'proje' || modalSecim.tip === 'klasor' ? ikon('folder') : ikon('evren');
    $('modalSeciliBilgi').innerHTML = `<span class="oturum-cip">${prjCip}${esc(pAd)}</span><span class="oturum-cip-ok" aria-hidden="true">›</span><span class="oturum-cip">${ikon('cpu')}${esc(mAd)}</span>` +
      `<span class="oturum-cip">efor · ${esc(eObj ? (eObj.ad || eObj.id) : modalEfor)}</span>` +
      (modalOrkestrator ? `<span class="oturum-cip oturum-cip-ork">${ikon('branch')}şef${modalKodYazma ? ' · yazma açık' : ''}</span>` : '');
  }
  rolAnahtarlariniCiz();
}
// Açık modal varken tuval döngüsü durur; modal kapanınca kaldığı yerden sürer.
function modalDurumGuncelle() {
  const acik = [...document.querySelectorAll('.modal-ortu')].some((m) => !m.hidden);
  if (acik) Grafik.dur(); else Grafik.basla();
}
function yeniOturumModalAc(secenek) {
  const p = S.proje ? S.projeler.find((x) => x.yol === S.proje) : null;
  modalSecim = p ? { tip: 'proje', yol: p.yol } : { tip: 'bos' };
  modalSecilenModel = S.model || (S.modeller[0] ? S.modeller[0].id : '');
  modalEfor = S.sonEfor || 'medium';
  modalOrkestrator = !!(secenek && secenek.orkestrator);
  modalKodYazma = false;
  modalProjeAra = '';
  modalProjeTumu = false;
  yeniOturumModalGuncelle();
  const m = $('yeniOturumModal');
  if (m) m.hidden = false;
  modalDurumGuncelle();
}
function yeniOturumModalKapat() {
  const m = $('yeniOturumModal');
  if (m) m.hidden = true;
  modalDurumGuncelle();
}
// ---------- Oturum adı (yeniden adlandırma) ----------
// Ad, Claude Code'un custom-title.json dosyasına yazılır: sekme, geçmiş ve Claude Desktop
// aynı adı görür. Boş ad dosyayı siler, oturum otomatik ada döner.
async function oturumAdlandir(devam, dizin, ad, secenekler) {
  const sessiz = !!(secenekler && secenekler.sessiz);
  const ozel = !!(secenekler && secenekler.ozel);
  const r = await window.evren.oturumAdlandir({ dizin, devam, ad }).catch((e) => ({ ok: false, hata: e.message }));
  if (!r || !r.ok) {
    olay('OTURUM', 'adlandırılamadı · ' + ((r && r.hata) || 'bilinmeyen hata'), 'kotu');
    return false;
  }
  const o = S.oturumlar.find((x) => x.devam === devam || x.id === devam);
  if (o) {
    o.ad = r.ad || '';
    o._ozelAd = ozel && !!r.ad;
    o._aiAd = false;
    sekmeleriCiz();
    if (!r.ad) sekmeAdIzle(o); // özel ad silindi: ilk mesajdan/ajandan yeniden türet
  }
  if (!sessiz) olay('OTURUM', r.ad ? `adlandırıldı · ${r.ad}` : 'ad otomatiğe döndü', 'iyi');
  gecmisYukle();
  return true;
}
function adlandirModalAc(bilgi) {
  adlananOturum = { devam: bilgi.devam, dizin: bilgi.dizin };
  const g = $('adlandirGiris');
  if (g) g.value = bilgi.ad || '';
  if ($('adlandirOzet')) $('adlandirOzet').textContent = bilgi.ad || 'adsız';
  const m = $('adlandirModal');
  if (m) m.hidden = false;
  modalDurumGuncelle();
  setTimeout(() => { if (g) { g.focus(); g.select(); } }, 30);
}
function adlandirModalKapat() {
  const m = $('adlandirModal');
  if (m) m.hidden = true;
  adlananOturum = null;
  modalDurumGuncelle();
}
async function adlandirKaydet() {
  const hedef = adlananOturum;
  if (!hedef) return;
  const g = $('adlandirGiris');
  const ad = g ? g.value : '';
  adlandirModalKapat();
  await oturumAdlandir(hedef.devam, hedef.dizin, ad, { ozel: true });
}
// Canlı sekme: oturum kimliği henüz oluşmadıysa birkaç saniye bekleyip yeniden dener.
async function sekmeAdlandirAc(o) {
  if (!o) return;
  let devam = o.devam;
  if (!devam && o.pid) {
    const b = await window.evren.oturumKimlik(o.pid).catch(() => null);
    devam = b && b.devam;
    if (devam && !o.devam) o.devam = devam;
  }
  if (!devam) { olay('OTURUM', 'oturum kimliği henüz oluşmadı · birkaç saniye sonra dene', 'uyari'); return; }
  adlandirModalAc({ devam, dizin: o.yol, ad: sekmeAdi(o) });
}
function yeniOturumBaslat() {
  const secim = modalSecim || { tip: 'bos' };
  const modelId = modalSecilenModel || S.model;
  S.sonEfor = modalEfor;
  yeniOturumModalKapat();
  if (modelId && modelId !== S.model) modelSec(modelId);
  const ortak = { modelId, orkestrator: modalOrkestrator, kodYazma: modalKodYazma, efor: modalEfor };
  if (secim.tip === 'proje') {
    const p = S.projeler.find((x) => x.yol === secim.yol);
    if (!p) { olay('OTURUM', 'proje bulunamadı', 'kotu'); return; }
    if (p.yol !== S.proje) projeSec(p.yol);
    basla(null, { ...ortak, dizin: p.yol, ekDizinler: (p.yollar || []).slice(1), projeAd: p.ad });
  } else if (secim.tip === 'klasor') {
    basla(null, { ...ortak, dizin: secim.yol, projeAd: secim.ad });
  } else {
    basla(null, { ...ortak, dizin: null, projesiz: true });
  }
}

// ---------- Proje Düzenle Modalı ----------
let duzenlenenProje = null; // { eskiYol, ad, yollar }

function projeDuzenleGuncelle() {
  const kutu = $('projeKlasorler');
  if (!kutu || !duzenlenenProje) return;
  const yollar = duzenlenenProje.yollar;
  kutu.innerHTML = yollar.length ? yollar.map((y, i) => `
    <div class="proje-klasor-satir">
      <span class="proje-klasor-yol mono" title="${esc(y)}">${esc(kisaYol(y, 44))}</span>
      ${i === 0 ? '<span class="tag mono">ana</span>' : `<button class="oturum-kart-sil" type="button" data-cikar="${i}" title="Klasörü çıkar" aria-label="Klasörü çıkar"><svg class="ic"><use href="#i-close" /></svg></button>`}
    </div>`).join('') : '<div class="proje-klasor-bos">Henüz klasör yok. Bir klasör ekle.</div>';
  if ($('projeDuzenleOzet')) $('projeDuzenleOzet').textContent = yollar.length ? `${yollar.length} klasör · ${kisaYol(yollar[0], 30)}` : 'klasör seçilmedi';
  const kaydet = $('projeDuzenleKaydetBtn');
  if (kaydet) kaydet.disabled = !yollar.length;
}
function projeDuzenleAc(proje, baslangicKlasor) {
  if (!proje && !baslangicKlasor) return;
  duzenlenenProje = proje
    ? { eskiYol: proje.yol, ad: proje.ad, yollar: [...(proje.yollar || [proje.yol])] }
    : { eskiYol: '', ad: baslangicKlasor ? (baslangicKlasor.split(/[\\/]/).filter(Boolean).pop() || '') : '', yollar: baslangicKlasor ? [baslangicKlasor] : [] };
  if ($('projeAdGiris')) $('projeAdGiris').value = duzenlenenProje.ad || '';
  if ($('projeDuzenleBaslik')) $('projeDuzenleBaslik').textContent = proje ? 'Projeyi Düzenle' : 'Yeni Proje';
  projeDuzenleGuncelle();
  const m = $('projeDuzenleModal');
  if (m) m.hidden = false;
  modalDurumGuncelle();
  setTimeout(() => { if ($('projeAdGiris')) { $('projeAdGiris').focus(); $('projeAdGiris').select(); } }, 30);
}
function projeDuzenleKapat() {
  const m = $('projeDuzenleModal');
  if (m) m.hidden = true;
  duzenlenenProje = null;
  modalDurumGuncelle();
}
async function projeDuzenleKaydet() {
  if (!duzenlenenProje || !duzenlenenProje.yollar.length) return;
  const btn = $('projeDuzenleKaydetBtn');
  if (btn) btn.disabled = true;
  const r = await window.evren.projeKaydet({
    eskiYol: duzenlenenProje.eskiYol,
    ad: $('projeAdGiris') ? $('projeAdGiris').value.trim() : duzenlenenProje.ad,
    yollar: duzenlenenProje.yollar,
  }).catch((e) => ({ ok: false, hata: e.message }));
  if (btn) btn.disabled = false;
  if (!r || !r.ok) { olay('PROJE', 'kaydedilemedi · ' + ((r && r.hata) || 'bilinmeyen hata'), 'kotu'); return; }
  S.projeler = r.projeler || S.projeler;
  modalSecim = { tip: 'proje', yol: duzenlenenProje.yollar[0] };
  projeDuzenleKapat();
  projeleriCiz(); ozetYaz(); yeniOturumModalGuncelle();
  olay('PROJE', 'kaydedildi · ' + modalSecimEtiket(), 'iyi');
}
// ---------- olaylar ----------
listeKlavye('modelList', () => ({ liste: S.modeller.map((m) => m.id), deger: S.model }), modelSec);
listeKlavye('projeList', () => ({ liste: S.projeler.map((p) => p.yol), deger: S.proje }), projeSec);
$('baslaBtn').addEventListener('click', () => yeniOturumModalAc());
$('baslaBtn2').addEventListener('click', () => yeniOturumModalAc());
$('durdurBtn').addEventListener('click', durdur);
$('cevapDurdurBtn').addEventListener('click', cevapDurdur);
$('ekleBtn').addEventListener('click', klasorEkle);
$('yenileBtn').addEventListener('click', apiYenile);
$('cmdkBtn').addEventListener('click', () => paletAc());
$('paletBtn2').addEventListener('click', () => paletAc());
// Claude Code oturumlarını da göster: ayar ana süreçte saklanır; liste yeniden yüklenir.
function claudeBtnCiz() {
  const b = $('claudeBtn');
  if (!b) return;
  b.classList.toggle('aktif', claudeGoster());
  b.setAttribute('aria-pressed', claudeGoster() ? 'true' : 'false');
  b.title = claudeGoster() ? 'Claude Code oturumları listede görünüyor (kapatmak için tıkla)' : 'Claude Code oturumlarını da göster';
}
if ($('claudeBtn')) {
  claudeBtnCiz();
  $('claudeBtn').addEventListener('click', async () => {
    const yeni = await window.evren.claudeOturumlari(!claudeGoster()).catch(() => claudeGoster());
    S.ayar.claudeOturumlari = yeni === true;
    claudeBtnCiz();
    gecmisSonHtml = null;
    gecmisYukle();
  });
}
$('sideBtn').addEventListener('click', sideToggle);
$('kucukBtn').addEventListener('click', () => fsDegis(-1));
$('buyukBtn').addEventListener('click', () => fsDegis(1));
$('temizleBtn').addEventListener('click', () => { const t = aktifTerm(); if (t) t.clear(); });
$('odakBtn').addEventListener('click', () => odakToggle());
document.addEventListener('click', (e) => { const a = e.target.closest('[data-dis]'); if (a) { e.preventDefault(); window.evren.disari(a.dataset.dis); } });
$('anahtarForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const giris = $('anahtarGiris'), btn = $('anahtarKaydet');
  if (!giris.value.trim()) { giris.focus(); return; }
  btn.disabled = true; btn.querySelector('span').textContent = 'Doğrulanıyor…';
  const r = await window.evren.anahtarKaydet(giris.value).catch((x) => ({ ok: false, hata: x.message }));
  btn.disabled = false; btn.querySelector('span').textContent = 'Doğrula ve kaydet';
  if (!r.ok) { S.anahtarHata = true; $('uyariMetin').textContent = r.hata || 'Kaydedilemedi.'; olay('KASA', r.hata || 'kayıt hatası', 'kotu'); giris.select(); return; }
  giris.value = ''; S.anahtarHata = false; S.anahtarVar = true;
  olay('KASA', 'anahtar doğrulandı ve ' + kasaAdi(S.platform) + ' ile kaydedildi', 'iyi');
  ozetYaz(); apiYenile();
});
$('odakIpucu').addEventListener('click', () => odakToggle(false));
if (window.evren.uykuDinle) window.evren.uykuDinle((acik) => { S.uykuAktif = !!acik; uykuDugmeCiz(); });
if (window.evren.hedefDinle) window.evren.hedefDinle((id, sayi) => {
  // ana süreç PTY kimliğini gönderir; sekmelerde bu kimlik pid'dir (id yerel sayaçtır, karıştırılmamalı).
  const o = S.oturumlar.find((x) => x.pid === id);
  olay('SİSTEM', `hedef durakladı · otomatik devam gönderildi (${sayi}/3)${o ? ' · ' + (o.ad || o.proje) : ''}`, 'iyi');
});
// Çatallanma: --resume sohbeti yeni kimliğe taşıdıysa sekmeyi ve şef işaretini yeni kimliğe bağla.
// Sekme eski kimlikte kalırsa kart iki kez görünüyordu (çalışan kopya + "açık" ata).
if (window.evren.forkDinle) window.evren.forkDinle((pid, kimlik) => {
  const o = S.oturumlar.find((x) => x.pid === pid && x.canli);
  if (!o || !kimlik || o.devam === kimlik) return;
  const eski = o.devam; // görünüm/pin/sessiz durumu eski kimlikte kayıtlı: yeni kimliğe taşınmalı
  o.devam = kimlik;
  o._forkAdopte = true; // şef kimliği izleyicisi boşuna dönmesin
  if (eski && eski !== kimlik) {
    const eskiAnahtar = 'd:' + eski, yeniAnahtar = 'd:' + kimlik;
    if (S.gorunumler && Object.prototype.hasOwnProperty.call(S.gorunumler, eskiAnahtar)) {
      S.gorunumler[yeniAnahtar] = S.gorunumler[eskiAnahtar];
      delete S.gorunumler[eskiAnahtar];
      sakla.yaz('gorunumler', S.gorunumler);
    }
    if (typeof ignelenenler !== 'undefined' && ignelenenler.has(eski)) {
      ignelenenler.delete(eski);
      ignelenenler.add(kimlik);
      if (typeof tercihKaydet === 'function') tercihKaydet();
    }
    // Sohbet push aboneliği eski kimliğe bağlıysa yenisine geç.
    if (S.panelMod === 'sohbet' && sohbetAboneAnahtar === 'o:' + pid) { sohbetAboneAnahtar = ''; sohbetAboneSenkronla(); }
  }
  if (o.orkestrator && !S.sefOturumlar.has(kimlik)) {
    S.sefOturumlar.add(kimlik);
    sakla.yaz('sefOturumlar', [...S.sefOturumlar].slice(-300));
  }
  gecmisCiz(); sekmeleriCiz();
});
// Telefon (OpCon) uyuyan masaüstü sekmesini uyandırdı: hayalet kopya yerine aynı sekmeyi bağla.
if (window.evren.uyandiDinle) {
  window.evren.uyandiDinle(({ eskiId, yeni }) => {
    if (!yeni || !yeni.id) return;
    const o = S.oturumlar.find((x) => x.pid === eskiId || (x.devam && x.devam === yeni.devam && !x.canli));
    if (!o) return;
    o.pid = yeni.id;
    o.canli = true;
    o.uyuyor = false;
    o.kod = null;
    o.basladi = Date.now();
    o.bitti = 0;
    if (o.term) o.term.writeln('\r\n\x1b[38;2;108;119;131m  [uzaktan uyandırıldı]\x1b[0m');
    sekmeleriCiz();
    gecmisCiz();
  });
}

if ($('uykuBtn')) $('uykuBtn').addEventListener('click', async () => {
  S.uyku = await window.evren.uykuEngelle(!S.uyku).catch(() => !S.uyku);
  uykuDugmeCiz();
});
$('yeniSekme').addEventListener('click', () => sekmeSec(null));
if ($('gecmisYenile')) $('gecmisYenile').addEventListener('click', gecmisYukle);
if ($('gecmisAra')) {
  $('gecmisAra').addEventListener('input', (e) => {
    gecmisAra = e.target.value;
    gecmisAraIstek++; // uçuştaki eski yanıt yeni sorguya karışmasın
    gecmisCiz(); // başlıkta anında süz
    clearTimeout(gecmisAraZaman);
    gecmisAraZaman = setTimeout(gecmisIcerikAra, 260);
  });
  $('gecmisAra').addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    clearTimeout(gecmisAraZaman);
    e.target.value = ''; gecmisAra = ''; gecmisIcerikAra(); e.target.blur();
  });
}
// ---- Kart sağ tık menüsü: Sabitle / Arşivle / Projeye taşı… / Otomatiğe dön ----
let kartMenuEl = null;
function kartMenuKapat() {
  if (kartMenuEl) { kartMenuEl.remove(); kartMenuEl = null; }
  document.removeEventListener('mousedown', kartMenuDisTik, true);
  document.removeEventListener('keydown', kartMenuTus, true);
  window.removeEventListener('blur', kartMenuKapat);
}
function kartMenuDisTik(e) { if (kartMenuEl && !kartMenuEl.contains(e.target)) kartMenuKapat(); }
function kartMenuTus(e) { if (e.key === 'Escape') { e.stopPropagation(); kartMenuKapat(); } }
function kartMenuKonumla(x, y) {
  const r = kartMenuEl.getBoundingClientRect();
  kartMenuEl.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  kartMenuEl.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
}
function kartMenuAc(x, y, id) {
  const g = S.gecmis.find((k) => k.id === id);
  if (!g) return;
  kartMenuKapat();
  const sabit = ignelenenler.has(id);
  const arsivde = arsivlenenler.has(id);
  const etkin = gecmisAcikMi(g) || g.canli || g.turCanli || g.calisanAjan > 0 || g.calisanEvren > 0;
  // Çıkarım ya da elle seçim, kayıtlı projeler arasında olmayan bir klasöre bağladıysa "Projeyi kaydet" sunulur.
  const pb = projeBilgi(g);
  const kayitsizProje = pb.yol && pb.kaynak !== 'kendi' && !projeKayitliMi(pb.yol) ? pb : null;
  const el = document.createElement('div');
  el.className = 'kart-menu';
  el.setAttribute('role', 'menu');
  el.innerHTML = `
    <button type="button" role="menuitem" data-m="sabit"><svg class="ic"><use href="#i-pin" /></svg><span>${sabit ? 'Sabitlemeyi kaldır' : 'Sabitle'}</span></button>
    <button type="button" role="menuitem" data-m="arsiv"${!arsivde && etkin ? ' disabled title="Etkin oturum arşivlenemez"' : ''}><svg class="ic"><use href="#i-arsiv" /></svg><span>${arsivde ? 'Arşivden çıkar' : 'Arşivle'}</span></button>
    <button type="button" role="menuitem" data-m="tasi"><svg class="ic"><use href="#i-folder" /></svg><span>Projeye taşı…</span></button>
    ${kayitsizProje ? `<button type="button" role="menuitem" data-m="kaydet" title="${esc(kayitsizProje.yol)}"><svg class="ic"><use href="#i-folder" /></svg><span>Projeyi kaydet: ${esc(kayitsizProje.ad || kayitsizProje.yol)}</span></button>` : ''}
    ${elleProje[id] ? '<button type="button" role="menuitem" data-m="otomatik"><svg class="ic"><use href="#i-refresh" /></svg><span>Otomatiğe dön</span></button>' : ''}`;
  document.body.appendChild(el);
  kartMenuEl = el;
  kartMenuKonumla(x, y);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b || b.disabled) return;
    const m = b.dataset.m;
    if (m === 'tasi') { projeTasiListesi(id, x, y); return; }
    kartMenuKapat();
    if (m === 'sabit') oturumIgnele(id);
    else if (m === 'arsiv') oturumArsivle(id);
    else if (m === 'otomatik') oturumProjeTasi(id, null);
    else if (m === 'kaydet' && kayitsizProje) projeyiKaydetVeBagla(id, kayitsizProje.yol, kayitsizProje.ad);
  });
  document.addEventListener('mousedown', kartMenuDisTik, true);
  document.addEventListener('keydown', kartMenuTus, true);
  window.addEventListener('blur', kartMenuKapat);
  const ilk = el.querySelector('button:not([disabled])');
  if (ilk) ilk.focus();
}
const yolAnahtar = (y) => String(y || '').split(String.fromCharCode(92)).join('/').replace(/\/+$/, '').toLowerCase();
const projeKayitliMi = (yol) => (S.projeler || []).some((p) => yolAnahtar(p.yol) === yolAnahtar(yol) || (p.yollar || []).some((x) => yolAnahtar(x) === yolAnahtar(yol)));
// Klasörü mevcut proje kayıt yoluyla (proje-kaydet) listeye ekler ve oturumu o projeye bağlar.
async function projeyiKaydetVeBagla(id, yol, ad) {
  const r = await window.evren.projeKaydet({ yol, ad: ad || '' }).catch((e) => ({ ok: false, hata: e.message }));
  if (!r || !r.ok) { olay('PROJE', 'kaydedilemedi · ' + ((r && r.hata) || 'bilinmeyen hata'), 'kotu'); return; }
  S.projeler = r.projeler || S.projeler;
  const kayit = S.projeler.find((p) => yolAnahtar(p.yol) === yolAnahtar(yol));
  oturumProjeTasi(id, kayit ? kayit.yol : yol);
  projeleriCiz(); ozetYaz(); yeniOturumModalGuncelle();
  olay('PROJE', 'kaydedildi · ' + ((kayit && kayit.ad) || ad || yol), 'iyi');
}
// "Projeye taşı…": bilinen projelerden, yazarak süzülebilen küçük liste.
function projeTasiListesi(id, x, y) {
  if (!kartMenuEl) return;
  const mevcut = elleProje[id] || '';
  kartMenuEl.classList.add('liste');
  kartMenuEl.innerHTML = `
    <input type="text" class="kart-menu-ara" placeholder="Proje ara…" spellcheck="false" autocomplete="off" aria-label="Proje ara" />
    <div class="kart-menu-liste" role="listbox"></div>
    <button type="button" class="kart-menu-sec" data-sec="1"><svg class="ic"><use href="#i-folder" /></svg><span>Klasör seç ve kaydet…</span></button>`;
  const girdi = kartMenuEl.querySelector('input');
  const liste = kartMenuEl.querySelector('.kart-menu-liste');
  const ciz = () => {
    const q = kucult(girdi.value.trim());
    const p = (S.projeler || []).filter((x) => !q || kucult(x.ad).includes(q) || kucult(x.yol).includes(q));
    liste.innerHTML = p.length ? p.map((x) => `<button type="button" role="option" class="${x.yol === mevcut ? 'sec-li' : ''}" data-yol="${esc(x.yol)}" title="${esc(x.yol)}"><span>${esc(x.ad)}</span><i class="mono">${esc(kisaYol(x.yol, 30))}</i></button>`).join('') : '<div class="bos-satir">Eşleşen proje yok.</div>';
    kartMenuKonumla(x, y);
  };
  girdi.addEventListener('input', ciz);
  girdi.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const b = liste.querySelector('button'); if (b) b.click(); }
  });
  liste.addEventListener('click', (e) => {
    const b = e.target.closest('[data-yol]');
    if (!b) return;
    kartMenuKapat();
    oturumProjeTasi(id, b.dataset.yol);
  });
  kartMenuEl.querySelector('[data-sec]').addEventListener('click', async () => {
    kartMenuKapat();
    const sec = await window.evren.klasorSec(false).catch(() => null); // false: son klasörler listesine yazma
    if (sec && sec.yol) projeyiKaydetVeBagla(id, sec.yol, sec.ad);
  });
  ciz();
  girdi.focus();
}
$('gecmisList').addEventListener('contextmenu', (e) => {
  const kart = e.target.closest('.seans-kart');
  if (!kart) return;
  e.preventDefault();
  kartMenuAc(e.clientX, e.clientY, kart.dataset.id);
});
$('gecmisList').addEventListener('click', (e) => {
  if (e.target.closest('[data-gecmis-daha]')) {
    e.stopPropagation();
    gecmisIdleTumu = !gecmisIdleTumu;
    gecmisCiz();
    return;
  }
  const adBtn = e.target.closest('[data-adlandir]');
  if (adBtn) {
    e.stopPropagation();
    const g = S.gecmis.find((x) => x.id === adBtn.dataset.adlandir);
    if (g) adlandirModalAc({ devam: g.id, dizin: g.projeYol, ad: g.baslik });
    return;
  }
  const kumeBtn = e.target.closest('[data-kume]');
  if (kumeBtn) { e.stopPropagation(); kumeBicimiSec(kumeBtn.dataset.kume); return; }
  const arsivBtn = e.target.closest('[data-arsivle]');
  if (arsivBtn) { e.stopPropagation(); oturumArsivle(arsivBtn.dataset.arsivle); return; }
  const igneBtn = e.target.closest('[data-igne]');
  if (igneBtn) {
    e.stopPropagation();
    oturumIgnele(igneBtn.dataset.igne);
    return;
  }
  const tog = e.target.closest('[data-ajan-toggle]');
  if (tog) {
    e.stopPropagation();
    const id = tog.dataset.ajanToggle;
    if (acikAjanlar.has(id)) acikAjanlar.delete(id);
    else acikAjanlar.add(id);
    gecmisCiz();
    return;
  }
  const altEs = e.target.closest('[data-alt-is]');
  if (altEs) { e.stopPropagation(); altIsAc(altEs.dataset.altUst, altEs.dataset.altIs); return; }
  const altSatir = e.target.closest('.ajan.evren-is');
  if (altSatir) {
    const ustKart = altSatir.closest('.seans-kart');
    if (ustKart) { e.stopPropagation(); altIsAc(ustKart.dataset.id, altSatir.dataset.evrenId); return; }
  }
  const baslik = e.target.closest('.seans-grup-baslik');
  if (baslik) { grupKatla(baslik); return; }
  const kart = e.target.closest('.seans-kart');
  if (!kart) return;
  gecmisKartAc(kart.dataset.id, kart.dataset.yol);
});
// Kart tıklaması, Ctrl+K ve Ctrl+Alt+↑/↓ aynı yolu kullanır.
function gecmisKartAc(id, yol) {
  if (yol && yol !== S.proje) {
    projeSec(yol);
  }
  // Etkin kart: canlı oturum açılır (varsayılan görünüm canlı sohbet; Sohbet ⇄ Terminal ile geçilir).
  const var_ = canliSekmeBul(id);
  if (var_) {
    sekmeSec(var_.id);
    return;
  }
  // Geçmiş kart: orta alanda okunur, salt okunur sohbet kaydı açılır; "Devam et" terminalde sürdürür.
  const g = S.gecmis.find((x) => x.id === id);
  if (g) { oturumIzle(g); return; }
  basla(id, yol ? { dizin: yol } : undefined);
}
// Listedeki görünür kart sırasıyla önceki/sonraki oturum (katlanmış gruplardaki kartlar sayılmaz).
function oturumKomsu(yon) {
  const kartlar = [...document.querySelectorAll('#gecmisList .seans-kart')].filter((k) => !k.closest('.seans-grup.kapali'));
  const idler = [...new Set(kartlar.map((k) => k.dataset.id))];
  const hedef = Gorunum.komsuSira(idler, gorunenOturumId(), yon);
  if (!hedef) return;
  const kart = kartlar.find((k) => k.dataset.id === hedef);
  gecmisKartAc(hedef, kart && kart.dataset.yol);
  setTimeout(() => {
    const k2 = [...document.querySelectorAll('#gecmisList .seans-kart')].find((k) => k.dataset.id === hedef);
    if (k2) k2.scrollIntoView({ block: 'nearest' });
  }, 0);
}
// Son kapatılan sekmeyi (oturum kimliği varsa) yeniden açar; bellekte tutulur, uygulama kapanınca sıfırlanır.
const kapatilanlar = [];
function sonKapatilaniAc() {
  while (kapatilanlar.length) {
    const k = kapatilanlar.pop();
    if (S.oturumlar.some((o) => o.canli && o.devam === k.devam)) continue;
    basla(k.devam, { dizin: k.dizin, modelId: k.modelId });
    return;
  }
  olay('OTURUM', 'yeniden açılacak kapatılmış oturum yok', 'uyari');
}
$('gecmisList').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const a = e.target.closest('[data-alt-is]');
  if (a) { e.preventDefault(); altIsAc(a.dataset.altUst, a.dataset.altIs); }
});
$('sekmeler').addEventListener('click', (e) => {
  if (e.target.closest('[data-okuma-kapat]')) { e.stopPropagation(); okumaKapat(); return; }
  const x = e.target.closest('[data-kapat]');
  if (x) { e.stopPropagation(); sekmeKapat(Number(x.dataset.kapat)); return; }
  const t = e.target.closest('.tab');
  if (t && t.dataset.id === 'okuma') return;
  if (t) sekmeSec(t.dataset.id === 'ana' ? null : Number(t.dataset.id));
});
$('sekmeler').addEventListener('auxclick', (e) => { const t = e.target.closest('.tab'); if (e.button === 1 && t && t.dataset.id === 'okuma') { okumaKapat(); return; }
  if (e.button === 1 && t && t.dataset.id !== 'ana') sekmeKapat(Number(t.dataset.id)); });
// Sekmeye çift tıklamak adlandırma penceresini açar (Claude/Antigravity'deki gibi).
$('sekmeler').addEventListener('dblclick', (e) => {
  const t = e.target.closest('.tab');
  if (!t || t.dataset.id === 'ana' || t.dataset.id === 'okuma') return;
  e.preventDefault();
  const o = S.oturumlar.find((x) => x.id === Number(t.dataset.id));
  if (o) sekmeAdlandirAc(o);
});
// Sekmeler taştığında fare tekerleği dikey hareketi yatay kaydırmaya çevirir (Shift+tekerlek de çalışır).
$('sekmeler').addEventListener('wheel', (e) => {
  const kutu = $('sekmeler');
  if (kutu.scrollWidth <= kutu.clientWidth) return;
  const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  if (!d) return;
  e.preventDefault();
  kutu.scrollLeft += d;
}, { passive: false });
$('stage').addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); e.stopPropagation(); fsDegis(e.deltaY < 0 ? 1 : -1); } }, { passive: false, capture: true });
function kisayolCalistir(eylem, e) {
  const palet = (mod) => { if ($('palet').hidden || P.mod !== mod) paletAc(mod); else paletKapat(); };
  switch (eylem) {
    case 'gecis': palet('gecis'); break;
    case 'palet': palet('komut'); break;
    case 'onceki': oturumKomsu(-1); break;
    case 'sonraki': oturumKomsu(1); break;
    case 'yenidenAc': sonKapatilaniAc(); break;
    case 'ana': sekmeSec(null); break;
    case 'sekmeKapat': if (S.aktif != null) sekmeKapat(S.aktif); break;
    case 'sekmeGez': sekmeGez(e.shiftKey ? -1 : 1); break;
    case 'kenar': sideToggle(); break;
    case 'odak': odakToggle(); break;
    case 'gorunumDon': return gorunumDon();
    case 'gorunumSohbet': return gorunumSec('sohbet');
    case 'gorunumTerminal': return gorunumSec('terminal');
    case 'gorunumDosyalar': return gorunumSec('dosyalar');
    case 'terminalAra': { const o = aktifOturum(); return !!(o && o.term && aktifGorunum() === 'terminal' && termAraAc()); }
  }
  return true;
}
window.addEventListener('keydown', (e) => {
  // Görsel önizleme katmanı açıkken Esc ve ok tuşları ona aittir.
  if (!$('gorselKatman').hidden && !e.ctrlKey && !e.altKey) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); gorselKatmanKapat(); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); gorselKatmanGez(e.key === 'ArrowLeft' ? -1 : 1); return; }
  }
  // Odak terminaldeyse (ya da terminal arama kutusundaysa) terminalDisi tuşlar (Ctrl+K) terminale bırakılır.
  const terminalda = !!(e.target && e.target.closest && e.target.closest('.terminal, .term-ara'));
  const ks = Gorunum.kisayolBul(e, Gorunum.KISAYOLLAR, terminalda, darwinMi()); // tuşlar tek tablodan (gorunum.js KISAYOLLAR) çözülür; macOS'ta Cmd de komut sayılır
  if (ks) { if (kisayolCalistir(ks.eylem, e) !== false) e.preventDefault(); return; }
  if (!$('palet').hidden) return;
  const adm = $('adlandirModal');
  if (adm && !adm.hidden) {
    if (e.key === 'Escape') { e.preventDefault(); adlandirModalKapat(); return; }
    if (e.key === 'Enter') { e.preventDefault(); adlandirKaydet(); return; }
    return;
  }
  const pm = $('projeDuzenleModal');
  if (pm && !pm.hidden) {
    if (e.key === 'Escape') { e.preventDefault(); projeDuzenleKapat(); }
    return;
  }
  const mo = $('yeniOturumModal');
  if (mo && !mo.hidden) {
    if (e.key === 'Escape') { e.preventDefault(); yeniOturumModalKapat(); return; }
    if (e.key === 'Enter') { e.preventDefault(); yeniOturumBaslat(); return; }
    return;
  }
  const km = $('kumandaModal');
  if (km && !km.hidden) {
    if (e.key === 'Escape') { e.preventDefault(); kumandaModalKapat(); return; }
    return;
  }
  if (S.aktif != null) return; // oturum sekmesinde tuşlar terminale aittir
  const odak = document.activeElement;
  if (e.key === 'Enter' && !(odak && /^(BUTTON|INPUT|TEXTAREA)$/.test(odak.tagName))) { e.preventDefault(); basla(); }
}, true);
window.evren.veriDinle((pid, veri) => {
  const o = S.oturumlar.find((x) => x.pid === pid);
  if (!o) { const l = bekleyenVeri.get(pid) || []; l.push(veri); bekleyenVeri.set(pid, l); return; }
  o.term.write(veri);
  o._ilkCiktiMs = Date.now(); // uyandırma: pty istemini bastı mı (kör 900 ms bekleme yerine)
  if (o.id === S.aktif) akimCizgiTetikle();
  if (typeof Takimyildiz !== 'undefined') Takimyildiz.parla(o.devam || o.id);
  if (o.id !== S.aktif && !o.yeni) { o.yeni = true; sekmeleriCiz(); } // arka planda çıktı: sekmede işaret
  oturumModeliTaraGecikmeli(o);
});
window.evren.cikisDinle((pid, bilgi) => oturumBitti(pid, bilgi));
new ResizeObserver(() => sigdir()).observe($('terminaller'));
if (sakla.oku('sideKapali', false)) $('app').classList.add('side-kapali');
sekmeleriCiz();
// Mobil Kumanda Modalı
// Sunucu bilgisini arayüze yazar: adres, QR, IP seçici (birden çok gerçek ağ varsa) ve bağlantı durumu.
async function kumandaBilgiCiz(bilgi) {
  if (!bilgi) return;
  if (bilgi.url) $('kumandaUrlText').textContent = bilgi.url;
  const sec = $('kumandaIpSec'), satir = $('kumandaIpSatir');
  const ipler = Array.isArray(bilgi.ipler) ? bilgi.ipler : [];
  if (sec && satir) {
    const secili = bilgi.seciliIp || bilgi.ip;
    if (ipler.length > 1) {
      sec.innerHTML = ipler.map((x) => `<option value="${esc(x.ip)}"${x.ip === secili ? ' selected' : ''}>${esc(x.ad)} · ${esc(x.ip)}</option>`).join('');
      satir.hidden = false;
    } else {
      satir.hidden = true;
    }
  }
  try {
    const qrData = await window.evren.remoteQr();
    if (qrData) $('kumandaQrResim').src = qrData;
  } catch (e) {}
  kumandaDurumGuncelle(bilgi);
}
async function kumandaModalAc() {
  const modal = $('kumandaModal');
  if (!modal) return;
  modal.hidden = false;
  modalDurumGuncelle();
  try { await kumandaBilgiCiz(await window.evren.remoteBilgi()); } catch (e) {}
}
function kumandaModalKapat() {
  const modal = $('kumandaModal');
  if (modal) modal.hidden = true;
  modalDurumGuncelle();
}
function kumandaDurumGuncelle(bilgi) {
  const nokta = $('kumandaNokta');
  const txt = $('kumandaDurumText');
  if (!bilgi) return;
  if (bilgi.bagliCihazSayisi > 0) {
    if (nokta) nokta.classList.add('bagli');
    if (txt) txt.textContent = `${bilgi.bagliCihazSayisi} cihaz bağlı`;
  } else {
    if (nokta) nokta.classList.remove('bagli');
    if (txt) txt.textContent = 'Cihaz bekleniyor...';
  }
}
if ($('kumandaBtn')) $('kumandaBtn').addEventListener('click', kumandaModalAc);
if ($('kumandaKapatBtn')) $('kumandaKapatBtn').addEventListener('click', kumandaModalKapat);
// "Bağlantıyı yenile": yeni token üretilir, bağlı istemciler kopar, QR ve adres tazelenir.
if ($('kumandaYenileBtn')) $('kumandaYenileBtn').addEventListener('click', async () => {
  const btn = $('kumandaYenileBtn');
  btn.disabled = true;
  try {
    const bilgi = await window.evren.remoteYenile();
    await kumandaBilgiCiz(bilgi);
    if ($('kumandaDurumText')) $('kumandaDurumText').textContent = 'Bağlantı yenilendi · telefonu yeniden bağla';
  } catch (e) {} finally { btn.disabled = false; }
});
// IP seçici: seçim kumanda.json'a yazılır, QR yeni adresle yenilenir.
if ($('kumandaIpSec')) $('kumandaIpSec').addEventListener('change', async (e) => {
  try { await kumandaBilgiCiz(await window.evren.remoteIpSec(e.target.value)); } catch {}
});
if ($('kumandaModal')) {
  $('kumandaModal').addEventListener('click', (e) => {
    if (e.target === $('kumandaModal')) kumandaModalKapat();
  });
}
if (window.evren && window.evren.remoteDinle) {
  window.evren.remoteDinle((bilgi) => kumandaDurumGuncelle(bilgi));
}
// Sohbet paneli olay dinleyicileri
if ($('gorunumSeg')) $('gorunumSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-g]'); if (b) gorunumSec(b.dataset.g); });
tusSeritKur();
// Terminal arama kutusu
if ($('termAraGiris')) {
  $('termAraGiris').addEventListener('input', () => termAraYap(1, true));
  $('termAraGiris').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); termAraYap(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); termAraKapat(); }
  });
  $('termAraOnce').addEventListener('click', () => termAraYap(-1));
  $('termAraSonra').addEventListener('click', () => termAraYap(1));
  $('termAraKapat').addEventListener('click', () => termAraKapat());
}
// Önizleme katmanı
if ($('gorselKatman')) {
  $('gkKapat').addEventListener('click', gorselKatmanKapat);
  $('gkOnceki').addEventListener('click', () => gorselKatmanGez(-1));
  $('gkSonraki').addEventListener('click', () => gorselKatmanGez(1));
  $('gorselKatman').addEventListener('click', (e) => { if (e.target === $('gorselKatman')) gorselKatmanKapat(); });
  const gkYol = () => (GK.liste[GK.i] || {}).yol;
  $('gkAc').addEventListener('click', () => dosyaEylem('ac', gkYol()));
  $('gkKlasor').addEventListener('click', () => dosyaEylem('klasor', gkYol()));
  $('gkKopya').addEventListener('click', (e) => dosyaEylem('kopya', gkYol(), e.currentTarget));
}
// Dosya bırakılırsa pencere o dosyaya gitmesin (terminal kendi bırakmasını işler).
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());
if ($('sohbetDevamBtn')) $('sohbetDevamBtn').addEventListener('click', okumaDevamEt);
if ($('sohbetYenileBtn')) $('sohbetYenileBtn').addEventListener('click', () => sohbetYukle(true));
// Sohbet yazı çubuğu: birleşik yazım (metin, 250 ms sonra ayrı Enter). Aynı paketteki CR'yi
// Claude Code TUI gönderim saymıyordu; mesaj kutuda kalıyordu.
if ($('sohbetGonder')) $('sohbetGonder').addEventListener('submit', (e) => {
  e.preventDefault();
  const o = aktifOturum();
  const giris = $('sohbetGonderGiris');
  const metin = Gorunum.gonderilecekMetin(giris.value);
  if (!o || !o.canli || !o.pid || !metin) return;
  if (window.evren.komutYaz) window.evren.komutYaz(o.pid, metin);
  else window.evren.yaz(o.pid, metin + '\r');
  giris.value = '';
});
// Yapıştırma: panodaki görsel/dosya tırnaklı yol olur, metin olduğu gibi imlece eklenir.
if ($('sohbetGonderGiris')) $('sohbetGonderGiris').addEventListener('paste', async (e) => {
  e.preventDefault();
  const giris = e.currentTarget;
  const ek = await window.evren.panoEkAl().catch(() => null);
  const metin = ek && ek.yollar && ek.yollar.length ? Gorunum.yolMetni(ek.yollar) : await panoOku();
  if (!metin) return;
  giris.setRangeText(metin, giris.selectionStart, giris.selectionEnd, 'end');
  giris.focus();
});
// Künye: tıklanınca kaynak depo tarayıcıda açılır (sürüm ve lisans aynı satırda).
if ($('kunye')) {
  const depoAc = () => window.evren.disari('https://github.com/yusufgunay-esq/evren-desktop');
  $('kunye').addEventListener('click', depoAc);
  $('kunye').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); depoAc(); } });
}
if ($('sohbetForkBtn')) $('sohbetForkBtn').addEventListener('click', () => {
  const g = seciliOturumGecmisi;
  if (g && g.id) basla(g.id, g.projeYol ? { dizin: g.projeYol, fork: true } : { dizin: S.proje, fork: true });
});
// Sağ kolonun alt paneli: Proje / Gecikme / Olaylar tek yerde, sayfa taşmaz.
function panelSayfa(ad) {
  for (const b of document.querySelectorAll('.panel-sekme')) { const on = b.dataset.panel === ad; b.classList.toggle('aktif', on); b.setAttribute('aria-selected', String(on)); }
  for (const s of document.querySelectorAll('.panel-sayfa')) s.hidden = s.dataset.panel !== ad;
  for (const x of document.querySelectorAll('[data-panel-x]')) x.hidden = x.dataset.panelX !== ad;
  sakla.yaz('panelSayfa', ad);
  if (ad === 'gecikme') Gecikme.olc();
}
document.querySelectorAll('.panel-sekme').forEach((b) => b.addEventListener('click', () => panelSayfa(b.dataset.panel)));
panelSayfa(sakla.oku('panelSayfa', 'proje'));
if ($('sohbetPanel')) {
  $('sohbetPanel').addEventListener('click', (e) => {
    const ds = e.target.closest('[data-dsuz]');
    if (ds) { S.dosyaSuz = ds.dataset.dsuz; ciktiCiz(); return; }
    const kucuk = e.target.closest('.dosya-kucuk');
    if (kucuk) { gorselKatmanAc(Number(kucuk.dataset.i) || 0); return; }
    const satir = e.target.closest('.dosya-satir');
    if (satir) {
      const dugme = e.target.closest('[data-eylem]');
      dosyaEylem(dugme ? dugme.dataset.eylem : 'ac', satir.dataset.yol, dugme);
      return;
    }
    const izUst = e.target.closest('.so-iz-ust');
    if (izUst) { izUst.parentElement.classList.toggle('acik'); return; }
    const aracKart = e.target.closest('.sohbet-kart.arac');
    if (aracKart && !e.target.closest('.sohbet-kopyala')) { aracKart.classList.toggle('acik'); return; }
    const k = e.target.closest('.sohbet-kopyala');
    if (k) {
      const kart = k.closest('.sohbet-kart');
      const icerik = kart ? kart.querySelector('.sohbet-icerik').textContent : '';
      if (icerik) {
        panoYaz(icerik);
        const eski = k.textContent;
        k.textContent = 'kopyalandı';
        setTimeout(() => { k.textContent = eski; }, 1200);
      }
    }
  });
}
// Sohbet artık push ile geliyor (sohbet:yeni + artımlı DOM). Burada yalnız Dosyalar modunun
// yedek yoklaması var: panel kapalıyken ya da sekme arkadayken hiç koşmaz.
setInterval(() => {
  if (document.hidden) return;
  if (S.sohbetAcik && S.panelMod === 'dosyalar' && (S.aktif != null || seciliOturumGecmisi)) {
    ciktiYukle();
  }
}, 5000);
// Push dinleyicisi (bir kez): ilk paket tam çizim, sonrakiler artımlı ekleme (açık akordeon korunur).
if (window.evren.sohbetYeniDinle) {
  window.evren.sohbetYeniDinle(({ anahtar, girisler, ilk }) => {
    if (!anahtar || anahtar !== sohbetAboneAnahtar || S.panelMod !== 'sohbet') return;
    if (ilk) {
      if (anahtar !== sohbetSonAnahtar && $('sohbetListe')) delete $('sohbetListe').dataset.kaydirildi;
      sohbetCiz(girisler || []);
      sohbetSonAnahtar = anahtar;
    } else {
      sohbetArtirimliEkle(girisler || []);
    }
  });
}
document.addEventListener('visibilitychange', () => sohbetAboneSenkronla());
$('fsMetin').textContent = S.fs;
yukle().then(() => {
  if (new URLSearchParams(location.search).get('palet')) paletAc();
  if (new URLSearchParams(location.search).get('kumanda')) setTimeout(kumandaModalAc, 250);
  if (new URLSearchParams(location.search).get('modal')) setTimeout(yeniOturumModalAc, 350); // test: modalı açık yakala
  if (new URLSearchParams(location.search).get('rol')) setTimeout(() => yeniOturumModalAc({ orkestrator: true }), 350); // test: orkestratör rolü seçili modal
  if (new URLSearchParams(location.search).get('projeDuzenle')) setTimeout(() => { if (S.projeler[0]) projeDuzenleAc(S.projeler[0]); }, 400); // test: proje düzenleme modalı
  // test: adlandırma modalını geçmişteki bir oturumla aç (--ekran-adlandir)
  if (new URLSearchParams(location.search).get('adlandir')) setTimeout(async () => {
    const basla = Date.now();
    while ((!S.gecmis || !S.gecmis.length) && Date.now() - basla < 5000) await bekle(100);
    const g = (S.gecmis || [])[0];
    if (g) adlandirModalAc({ devam: g.id, dizin: g.projeYol, ad: g.baslik });
  }, 700);
  // test: kenar panelde bir oturumu Şef gibi işaretle (animasyon/kart görünümünü yakala)
  if (new URLSearchParams(location.search).get('cikti')) {
    // Ekran doğrulaması: en yeni oturumun çıktılarını aç (--ekran-cikti).
    setTimeout(async () => {
      // Geçmiş listesi arka planda yüklenir; hazır olana dek kısa süre bekle.
      const basla = Date.now();
      while ((!S.gecmis || !S.gecmis.length) && Date.now() - basla < 4000) await bekle(100);
      const secim = new URLSearchParams(location.search).get('cikti');
      const hedef = secim && secim !== '1' && Array.isArray(S.gecmis)
        ? (S.gecmis.find((x) => String(x.id).startsWith(secim)) || S.gecmis[0])
        : (Array.isArray(S.gecmis) ? S.gecmis[0] : null);
      if (!seciliOturumGecmisi && hedef) await oturumIzle(hedef);
      gorunumSec('dosyalar');
    }, 500);
  }
  if (new URLSearchParams(location.search).get('sef')) {
    let deneme = 0;
    const t = setInterval(() => {
      const g = (S.gecmis || []).find((x) => (x.evrenIsleri || []).length || (x.altAjanlar || []).length);
      if (g || deneme++ > 20) { clearInterval(t); if (g) { S.sefOturumlar.add(g.id); acikAjanlar.add(g.id); gecmisCiz(); } }
    }, 500);
  }
  // test: modal açıldıktan sonra şu projenin sil düğmesine bas (listeden kaldırma akışını doğrular)
  const silParam = new URLSearchParams(location.search).get('sil');
  if (silParam) setTimeout(() => { const b = document.querySelector(`[data-sil="${CSS.escape(silParam)}"]`); if (b) b.click(); }, 900);
  const n = Number(new URLSearchParams(location.search).get('oturum') || 0);
  const orkTest = new URLSearchParams(location.search).get('ork') === '1';
  if (n) (async () => { for (let i = 0; i < n; i++) { if (i) projeSec((S.projeler[i] || S.projeler[0]).yol); await basla(null, orkTest ? { orkestrator: true, kodYazma: false } : undefined); await bekle(700); } const t = aktifTerm(); if (t && new URLSearchParams(location.search).get('yaz')) window.evren.yaz(aktifOturum().pid, 'echo EVREN coklu oturum testi' + String.fromCharCode(13)); if (new URLSearchParams(location.search).get('odak')) odakToggle(true); })();
});

// Yeni Oturum Modalı Olayları
if ($('adlandirKapatBtn')) $('adlandirKapatBtn').addEventListener('click', adlandirModalKapat);
if ($('adlandirVazgecBtn')) $('adlandirVazgecBtn').addEventListener('click', adlandirModalKapat);
if ($('adlandirKaydetBtn')) $('adlandirKaydetBtn').addEventListener('click', adlandirKaydet);
if ($('adlandirModal')) $('adlandirModal').addEventListener('mousedown', (e) => { if (e.target === $('adlandirModal')) adlandirModalKapat(); });
if ($('yeniOturumKapatBtn')) $('yeniOturumKapatBtn').addEventListener('click', yeniOturumModalKapat);
if ($('yeniOturumVazgecBtn')) $('yeniOturumVazgecBtn').addEventListener('click', yeniOturumModalKapat);
if ($('yeniOturumBaslatBtn')) $('yeniOturumBaslatBtn').addEventListener('click', yeniOturumBaslat);
if ($('modalOrkSwitch')) $('modalOrkSwitch').addEventListener('click', () => {
  modalOrkestrator = !modalOrkestrator;
  if (!modalOrkestrator) modalKodYazma = false;
  yeniOturumModalGuncelle();
});
if ($('modalKodSwitch')) $('modalKodSwitch').addEventListener('click', () => {
  modalKodYazma = !modalKodYazma;
  yeniOturumModalGuncelle();
});
// Tek seferlik klasörde çalış (proje kaydı yok).
if ($('modalKlasorCalisBtn')) $('modalKlasorCalisBtn').addEventListener('click', async () => {
  const sec = await window.evren.klasorSec();
  if (!sec) return;
  modalSecim = { tip: 'klasor', yol: sec.yol, ad: sec.ad, dal: sec.dal };
  S.sonKlasorler = [sec, ...S.sonKlasorler.filter((x) => x.yol !== sec.yol)].slice(0, 8);
  yeniOturumModalGuncelle();
});
// Yeni proje: önce klasör seçilir, sonra ad verilir.
if ($('modalKlasorEkleBtn')) $('modalKlasorEkleBtn').addEventListener('click', async () => {
  const sec = await window.evren.klasorSec();
  if (!sec) return;
  projeDuzenleAc(null, sec.yol);
});
if ($('modalProjeIzgara')) {
  const secKart = (k) => {
    if (!k) return;
    if (k.dataset.bos) modalSecim = { tip: 'bos' };
    else if (k.dataset.gecici) return;
    else if (k.dataset.proje) modalSecim = { tip: 'proje', yol: k.dataset.proje };
    yeniOturumModalGuncelle();
  };
  $('modalProjeIzgara').addEventListener('click', (e) => {
    if (e.target.closest('[data-daha]')) {
      modalProjeTumu = !modalProjeTumu;
      yeniOturumModalGuncelle();
      return;
    }
    const sil = e.target.closest('[data-sil]');
    if (sil) { e.stopPropagation(); projeListedenSil(sil.dataset.sil); return; }
    if (e.target.closest('[data-gecici-kaydet]')) {
      e.stopPropagation();
      if (modalSecim && modalSecim.tip === 'klasor') projeDuzenleAc(null, modalSecim.yol);
      return;
    }
    const duz = e.target.closest('[data-duzenle]');
    if (duz) {
      e.stopPropagation();
      const p = S.projeler.find((x) => x.yol === duz.dataset.duzenle);
      if (p) projeDuzenleAc(p);
      return;
    }
    secKart(e.target.closest('.oturum-secim-kart, .oturum-projesiz-kart'));
  });
  // Çift tık: projeyi düzenle (ad/klasörler).
  $('modalProjeIzgara').addEventListener('dblclick', (e) => {
    const k = e.target.closest('[data-proje]');
    if (!k) return;
    const p = S.projeler.find((x) => x.yol === k.dataset.proje);
    if (p) projeDuzenleAc(p);
  });
  // Klavye: Enter/Space kartı seçer (div role=button olduğu için elle).
  $('modalProjeIzgara').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('button')) return;
    e.preventDefault();
    secKart(e.target.closest('.oturum-secim-kart, .oturum-projesiz-kart'));
  });
}
if ($('modalProjeAra')) {
  $('modalProjeAra').addEventListener('input', () => {
    modalProjeAra = $('modalProjeAra').value || '';
    modalProjeTumu = false;
    yeniOturumModalGuncelle();
  });
}
// Proje düzenleme modalı olayları
if ($('projeDuzenleKapatBtn')) $('projeDuzenleKapatBtn').addEventListener('click', projeDuzenleKapat);
if ($('projeDuzenleVazgecBtn')) $('projeDuzenleVazgecBtn').addEventListener('click', projeDuzenleKapat);
if ($('projeDuzenleKaydetBtn')) $('projeDuzenleKaydetBtn').addEventListener('click', projeDuzenleKaydet);
if ($('projeAdGiris')) $('projeAdGiris').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); projeDuzenleKaydet(); }
});
if ($('projeKlasorEkleBtn')) $('projeKlasorEkleBtn').addEventListener('click', async () => {
  if (!duzenlenenProje) return;
  const sec = await window.evren.klasorSec(false);
  if (!sec || duzenlenenProje.yollar.includes(sec.yol)) return;
  duzenlenenProje.yollar.push(sec.yol);
  projeDuzenleGuncelle();
});
if ($('projeKlasorler')) $('projeKlasorler').addEventListener('click', (e) => {
  const cikar = e.target.closest('[data-cikar]');
  if (!cikar || !duzenlenenProje) return;
  duzenlenenProje.yollar.splice(Number(cikar.dataset.cikar), 1);
  projeDuzenleGuncelle();
});
if ($('projeDuzenleModal')) {
  $('projeDuzenleModal').addEventListener('click', (e) => {
    if (e.target === $('projeDuzenleModal')) projeDuzenleKapat();
  });
}
if ($('modalModelIzgara')) {
  $('modalModelIzgara').addEventListener('click', (e) => {
    const k = e.target.closest('.oturum-secim-kart');
    if (!k) return;
    modalSecilenModel = k.dataset.model;
    yeniOturumModalGuncelle();
  });
}
if ($('modalEforSec')) {
  $('modalEforSec').addEventListener('click', (e) => {
    const k = e.target.closest('[data-efor]');
    if (!k) return;
    modalEfor = k.dataset.efor;
    yeniOturumModalGuncelle();
  });
}
if ($('yeniOturumModal')) {
  $('yeniOturumModal').addEventListener('click', (e) => {
    if (e.target === $('yeniOturumModal')) yeniOturumModalKapat();
  });
}

function sohbetIgneDurumGuncelle() {
  const btn = $('sohbetIgneBtn');
  if (!btn) return;
  const o = aktifOturum();
  const id = seciliOturumGecmisi ? seciliOturumGecmisi.id : (o ? (o.devam || o.id) : null);
  btn.classList.toggle('aktif', !!(id && ignelenenler.has(id)));
}

if ($('sohbetIgneBtn')) {
  $('sohbetIgneBtn').addEventListener('click', () => {
    const o = aktifOturum();
    const id = seciliOturumGecmisi ? seciliOturumGecmisi.id : (o ? (o.devam || o.id) : null);
    if (id) oturumIgnele(id);
  });
}
