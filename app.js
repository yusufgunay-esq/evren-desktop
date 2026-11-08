// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Yusuf Günay. */
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
let webglAktifSayi = 0; // doğrulama: kaç terminal WebGL ile çiziliyor

const S = {
  modeller: [], projeler: [], model: '', proje: '',
  anahtarVar: true, api: null, pingler: [], yuklendi: false,
  calisiyor: false, basliyor: false, oturumlar: [], aktif: null,
  fs: Math.min(18, Math.max(11, Number(new URLSearchParams(location.search).get('fs') || sakla.oku('fs', 13)) || 13)),
  sohbetAcik: sakla.oku('sohbetAcik', false), sohbetFiltre: 'hepsi',
  grupKapali: sakla.oku('grupKapali', {}), // { calisiyor: true, bosta: true } — gruplar ayrı ayrı katlanır
};


// ---------- yardımcılar ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kisaYol = (p, n = 34) => (!p ? '' : p.length <= n ? p : p.slice(0, 3) + '…' + p.slice(-(n - 4)));
const kisaBaglam = (n) => (!n ? '—' : n >= 1e6 ? `${Math.round(n / 1048576)}M` : `${Math.round(n / 1024)}K`);
const seciliModel = () => S.modeller.find((m) => m.id === S.model) || S.modeller[0];
const seciliProje = () => S.projeler.find((p) => p.yol === S.proje);
const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
const ikon = (ad) => `<svg class="ic"><use href="#i-${ad}"/></svg>`;
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
let gecmisSonHtml = null; // son yazılan liste HTML'i; aynıysa DOM'a dokunulmaz
const gecmisAcikMi = (g) => S.oturumlar.some((o) => o.canli && o.devam === g.id); // sekme açık; çalıştığı anlamına gelmez
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

function gecmisCiz() {
  const el = $('gecmisList');
  if (!el) return;
  if (!S.projeler || !S.projeler.length) {
    if ($('gecmisSay')) $('gecmisSay').textContent = '—';
    el.innerHTML = '<div class="bos-satir">Henüz kayıtlı proje yok.</div>';
    return;
  }

  const q = kucult(gecmisAra.trim());
  const eslesir = (g) => kucult(g.baslik).includes(q) ||
    kucult(g.projeAd || '').includes(q) ||
    (g.altAjanlar || []).some((a) => kucult(a.tanim).includes(q) || kucult(a.tur).includes(q)) ||
    (g.evrenIsleri || []).some((e) => kucult(e.baslik).includes(q) || kucult(e.model).includes(q));

  const liste = q ? S.gecmis.filter(eslesir) : S.gecmis;
  if ($('gecmisSay')) $('gecmisSay').textContent = q ? `${liste.length}/${S.gecmis.length}` : (S.gecmis.length || '0');

  if (!liste.length) {
    el.innerHTML = `<div class="bos-satir">${q ? 'Aramayla eşleşen oturum yok.' : 'Kayıtlı oturum bulunamadı.'}</div>`;
    return;
  }

  const aktifDevam = aktifOturum() ? aktifOturum().devam : null;
  const inProgress = [];
  const idle = [];

  for (const g of liste) {
    const calisiyor = g.canli || g.turCanli || (g.calisanAjan > 0) || (g.calisanEvren > 0) || gecmisAcikMi(g);
    if (calisiyor) inProgress.push(g);
    else idle.push(g);
  }

  const kartHtml = (g, calisiyor) => {
    const secili = aktifDevam === g.id;
    const rozet = (g.calisanAjan || 0) + (g.calisanEvren || 0);
    return `
      <div class="seans-kart${secili ? ' sec-li' : ''}" role="option" aria-selected="${secili}" data-id="${esc(g.id)}" data-yol="${esc(g.projeYol)}" title="${esc(g.baslik)}\n${esc(g.projeAd)} · ${esc(goreli(g.ms / 1000))}">
        <div class="seans-satir-ust">
          <span class="seans-baslik">${esc(g.baslik)}</span>
          ${calisiyor ? `
            <span class="seans-durum-canli">
              <span class="led canli"></span>
              ${rozet > 0 ? `<span class="seans-rozet mono">${rozet}</span>` : ''}
            </span>
          ` : `
            <span class="seans-zaman">${kisaZaman(g.ms)}</span>
          `}
        </div>
        <div class="seans-satir-alt">
          <svg class="ic seans-klasor"><use href="#i-folder" /></svg>
          <span class="seans-proje">${esc(g.projeAd)}</span>
          ${g.evren ? '<span class="tag-evren">EVREN</span>' : ''}
        </div>
      </div>`;
  };

  // Grup başlığı gerçek bir düğme: Enter/Space ile katlanır, ok solda, sayı sağda hep görünür.
  // Arama varken eşleşen gruplar geçici olarak açık gösterilir; kayıtlı katlanma durumu değişmez.
  const grupHtml = (anahtar, etiket, kayitlar, calisiyor) => {
    if (!kayitlar.length) return '';
    const kapali = !!S.grupKapali[anahtar] && !q;
    return `
      <div class="seans-grup${kapali ? ' kapali' : ''}" data-grup="${anahtar}">
        <button type="button" class="seans-grup-baslik" aria-expanded="${!kapali}" aria-controls="grup-${anahtar}" data-grup-dugme="${anahtar}">
          <svg class="ic grup-ok" aria-hidden="true"><use href="#i-chevron" /></svg>
          <span>${etiket}</span>
          <span class="grup-sayi mono">${kayitlar.length}</span>
        </button>
        <div class="seans-grup-govde" id="grup-${anahtar}">
          <div class="seans-grup-ic">${kayitlar.map((g) => kartHtml(g, calisiyor)).join('')}</div>
        </div>
      </div>`;
  };

  const html = grupHtml('calisiyor', 'Çalışıyor', inProgress, true) + grupHtml('bosta', 'Boşta', idle, false);

  // Aynı HTML'i yeniden yazmayız: kaydırma yeri ve fare altındaki satır bozulmasın.
  if (html === gecmisSonHtml) return;
  gecmisSonHtml = html;
  const kaydirma = el.scrollTop;
  el.innerHTML = html;
  el.scrollTop = kaydirma;
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

async function gecmisYukle() {
  const no = ++gecmisIstek;
  if (!S.projeler || !S.projeler.length) { S.gecmis = []; gecmisCiz(); return; }

  const sonuclar = await Promise.all(
    S.projeler.map(async (p) => {
      const list = await window.evren.gecmis(p.yol).catch(() => []);
      const ad = p.ad || (p.yol ? p.yol.split(/[\\/]/).filter(Boolean).pop() : 'Proje');
      return (Array.isArray(list) ? list : []).map((x) => ({
        ...x,
        projeAd: ad,
        projeYol: p.yol,
      }));
    })
  );
  if (no !== gecmisIstek) return;
  const hepsi = sonuclar.flat().sort((a, b) => b.ms - a.ms);
  S.gecmis = hepsi;
  gecmisCiz();
}
function gecmisAc(id) {
  const var_ = S.oturumlar.find((o) => o.canli && o.devam === id);
  if (var_) { sekmeSec(var_.id); return; }
  basla(id);
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
  $('crProje').textContent = p ? p.ad : '—';
  $('crDal').textContent = p && p.dal ? p.dal : '—';

  hucre('bModel', m.ad || m.id || '—');
  $('bModelId').textContent = m.ad && m.id ? m.id : '';
  hucre('bBaglam', kisaBaglam(m.baglamSayisi));
  $('bBaglamS').textContent = m.baglamSayisi ? `${m.baglamSayisi.toLocaleString('tr-TR')} token` : 'bilinmiyor';
  hucre('bCikti', m.cikti ? kisaBaglam(m.cikti) : 'Oto');
  $('bCiktiS').textContent = m.cikti ? `${m.cikti.toLocaleString('tr-TR')} token` : 'model varsayılanı';
  hucre('bProje', p ? p.ad : 'Seçilmedi');
  $('bYol').textContent = p ? kisaYol(p.yol, 46) : '';
  hucre('bDal', p && p.dal ? p.dal : '—');
  $('bDalS').textContent = p ? (p.dal ? 'git deposu' : 'git deposu değil') : '—';

  $('sModel').textContent = m.id || '—';
  $('sBaglam').textContent = kisaBaglam(m.baglamSayisi);
  $('sDal').textContent = p && p.dal ? p.dal : '—';

  const hazir = S.yuklendi && S.anahtarVar && !!m.id;
  $('baslaBtn').disabled = !hazir;
  $('baslaBtn2').disabled = !hazir;
  $('uyari').hidden = S.anahtarVar;
  $('anahtarForm').hidden = S.anahtarVar || !S.yuklendi;
  if (!S.anahtarVar && !S.anahtarHata) $('uyariMetin').innerHTML = 'EVREN API anahtarı yok. Anahtarı <a href="#" data-dis="https://evren.ssyz.org.tr">evren.ssyz.org.tr</a> üzerinden (e-Devlet ile giriş) alıp aşağıya yapıştırın. Anahtar bu Windows hesabına bağlı olarak DPAPI ile şifrelenir.';
  else if (S.yuklendi && !p) { $('uyari').hidden = false; $('uyariMetin').textContent = 'Proje seçilmedi. Başlatınca klasör sorulur.'; }
  cipYaz();
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
  $('kasa').textContent = S.anahtarVar ? 'DPAPI · hazır' : 'kasa boş';

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
        sifirlanmaFarkMetni = ` · ${sa} sa ${dk} dk sonra`;
      }
    }

    if (kotaKalanSayi) kotaKalanSayi.textContent = gunlukKalan.toLocaleString('tr-TR');
    if (kotaKullanilanMetin) {
      kotaKullanilanMetin.textContent = `${gunlukKullanilan.toLocaleString('tr-TR')} / ${gunlukLimit.toLocaleString('tr-TR')} kullanıldı`;
    }
    if (kotaSifirlanmaMetin) {
      kotaSifirlanmaMetin.textContent = `Sıfırlanma: 03:00 TSİ${sifirlanmaFarkMetni}`;
    }
    if (kotaYuzdeMetin) {
      kotaYuzdeMetin.textContent = `%${yuzde.toFixed(1)}`;
    }
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
    S.modeller = d.modeller || [];
    S.projeler = d.projeler || [];
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
  modelleriCiz(); projeleriCiz(); ozetYaz(); baglantiYaz();
  olay('SİSTEM', 'EVREN Desktop 0.4 hazır');
  olay('KASA', S.anahtarVar ? 'DPAPI anahtarı yüklendi' : 'anahtar bulunamadı', S.anahtarVar ? '' : 'uyari');
  olay('PROJE', `${S.projeler.length} proje · ${S.projeler.filter((p) => p.dal).length} git deposu`);
  Grafik.basla();
  projeOzetYukle();
  gecmisYukle();
  apiYenile();
  // Boşta 15 sn'de bir ölçüm (gecikme grafiği canlı kalsın); oturumda 60 sn; pencere gizliyken hiç.
  let tik = 0;
  setInterval(() => { tik++; if (!document.hidden && (!S.calisiyor || tik % 4 === 0)) apiYenile(); }, 15000);
  // Geçmiş: pencere görünürken 15 sn'de bir (çalışıyor/bitti durumu güncel kalsın).
  setInterval(() => { if (!document.hidden) gecmisYukle(); }, 15000);
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

async function klasorEkle() {
  const sec = await window.evren.klasorSec();
  if (!sec) return false;
  S.projeler = [sec, ...S.projeler.filter((x) => x.yol !== sec.yol)].slice(0, 8);
  S.proje = sec.yol;
  projeleriCiz(); ozetYaz(); projeOzetYukle();
  return true;
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
const GENEL_TUS = new Set(['KeyP', 'KeyB', 'KeyT', 'KeyW', 'KeyF', 'KeyH']); // Ctrl+Shift+<tuş>: uygulamaya ait

async function terminalOlustur(o) {
  try { await document.fonts.ready; await document.fonts.load(`${S.fs}px "IBM Plex Mono"`); } catch {}
  const el = document.createElement('div');
  el.className = 'terminal';
  el.hidden = true;
  $('terminaller').appendChild(el);
  const t = new TerminalSinif({
    fontFamily: '"IBM Plex Mono", "Cascadia Mono", Consolas, monospace',
    fontSize: S.fs, lineHeight: 1.22, letterSpacing: 0,
    cursorBlink: true, cursorStyle: 'bar', cursorWidth: 2,
    allowProposedApi: true, scrollback: 20000, smoothScrollDuration: 0, theme: TEMA,
  });
  t.open(el);
  const f = FitSinif ? new FitSinif() : null;
  if (f) t.loadAddon(f);
  // WebGL karolama: desteklenmezse sessizce canvas çizimine düşer (uygulama çalışmaya devam eder).
  let webgl = null;
  if (WebglSinif) {
    try {
      webgl = new WebglSinif();
      webgl.onContextLoss(() => { try { webgl.dispose(); } catch {} webgl = null; });
      t.loadAddon(webgl);
      webglAktifSayi++;
      el.dataset.webgl = '1';
    } catch {
      webgl = null;
      el.dataset.webgl = '0';
    }
  }
  t.onData((veri) => { if (o.pid) window.evren.yaz(o.pid, veri); });
  t.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    if (e.ctrlKey && e.code === 'KeyC') {
      if (t.hasSelection()) {
        navigator.clipboard.writeText(t.getSelection());
        return false;
      }
      return !e.shiftKey;
    }
    if (e.ctrlKey && e.code === 'KeyV') {
      e.preventDefault();
      navigator.clipboard.readText().then((x) => {
        if (x) t.paste(x);
      }).catch(() => {});
      return false;
    }
    if (e.ctrlKey && e.shiftKey && GENEL_TUS.has(e.code)) return false;
    if (e.ctrlKey && e.code === 'Tab') return false;
    return true;
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (t.hasSelection()) {
      navigator.clipboard.writeText(t.getSelection());
      t.clearSelection();
    } else {
      navigator.clipboard.readText().then((x) => {
        if (x) t.paste(x);
      }).catch(() => {});
    }
  });
  Object.assign(o, { el, term: t, fit: f, webgl });
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
    if (o.pid && o.term.cols && o.term.rows) window.evren.boyut(o.pid, { cols: o.term.cols, rows: o.term.rows });
  });
}

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

// Model adı / etiketinden EVREN model kimliğini çözer
function modelKimligiCoz(metin) {
  if (!metin) return null;
  const s = String(metin).toLowerCase().trim();
  for (const m of S.modeller || []) {
    if (m.id && s === m.id.toLowerCase()) return m.id;
    if (m.ad && (s === m.ad.toLowerCase() || s.includes(m.ad.toLowerCase()))) return m.id;
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
      const cozulen = modelKimligiCoz(mSet[1]);
      if (cozulen) {
        if (cozulen !== o.model) {
          o.model = cozulen;
          if (o.pid && window.evren && window.evren.modelGuncelle) window.evren.modelGuncelle(o.pid, cozulen);
          sekmeleriCiz();
          durumYaz();
        }
        return;
      }
    }

    // 2. "Model Adı (hizli...) • API/Subscription Usage Billing"
    const mHeader = str.match(/(?:^|\r|\n)\s*([^\r\n•·]+?)\s*[•·]\s*(?:API|Subscription)\s*Usage/i);
    if (mHeader) {
      const cozulen = modelKimligiCoz(mHeader[1]);
      if (cozulen) {
        if (cozulen !== o.model) {
          o.model = cozulen;
          if (o.pid && window.evren && window.evren.modelGuncelle) window.evren.modelGuncelle(o.pid, cozulen);
          sekmeleriCiz();
          durumYaz();
        }
        return;
      }
    }
  }
}

function oturumModeliTaraGecikmeli(o) {
  if (!o) return;
  clearTimeout(o._modelTaraTimer);
  o._modelTaraTimer = setTimeout(() => oturumModeliTara(o), 120);
}

// ---------- sekmeler ----------
function sekmeleriCiz() {
  const kisaModel = (id) => {
    if (!id) return '';
    if (id.startsWith('claude-')) return id.replace(/^claude-/, '').replace(/-5-5$/, '-5.5');
    return id.replace(/-flash-next$/, '').replace(/-(flash|next)$/, '').slice(0, 18);
  };
  $('sekmeler').innerHTML =
    `<button class="tab ana${S.aktif == null ? ' aktif' : ''}" data-id="ana" role="tab" title="Yeni oturum ekranı (Ctrl+Shift+T)">${ikon('term')}<span>ana</span></button>` +
    S.oturumlar.map((o, i) => `
      <button class="tab${o.id === S.aktif ? ' aktif' : ''}${o.canli ? '' : ' bitti'}${o.yeni ? ' yeni' : ''}" data-id="${o.id}" role="tab" title="${esc(o.proje)} · ${esc(o.model)}${o.dal ? ' · ' + esc(o.dal) : ''}">
        <span class="led${o.canli ? ' canli' : o.kod ? ' kotu' : ''}"></span>
        <span class="tab-ad">${esc(o.proje)}</span>
        <span class="tab-m">${esc(kisaModel(o.model))}</span>
        <span class="tab-no">${i + 1}</span>
        <span class="tab-x" data-kapat="${o.id}" title="Sekmeyi kapat (Ctrl+Shift+W)">×</span>
      </button>`).join('');
  const a = $('sekmeler').querySelector('.tab.aktif');
  if (a) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  durumYaz();
}
const cipYaz = sekmeleriCiz; // eski adla çağıranlar için

function durumYaz() {
  const o = aktifOturum();
  S.calisiyor = !!(o && o.canli);
  $('baslaBtn').hidden = false;
  $('durdurBtn').hidden = !S.calisiyor;
  $('stage').classList.toggle('calisiyor', !!o);
  const m = seciliModel() || {}, p = seciliProje();
  $('sModel').textContent = o ? o.model : (m.id || '—');
  $('sDal').textContent = o ? (o.dal || '—') : (p && p.dal ? p.dal : '—');
  if (o) { $('crProje').textContent = o.proje; $('crDal').textContent = o.dal || '—'; }
  else { $('crProje').textContent = p ? p.ad : '—'; $('crDal').textContent = p && p.dal ? p.dal : '—'; }
  $('sOturum').textContent = `${S.oturumlar.filter((x) => x.canli).length}/${S.oturumlar.length} oturum`;
  sureYaz();
}

function sekmeSec(id) {
  S.aktif = id;
  const o = aktifOturum();
  if (o) o.yeni = false;
  for (const x of S.oturumlar) if (x.el) x.el.hidden = x.id !== S.aktif;
  if (!o) brifGoster(); else brifGizle();
  if (o) oturumModeliTara(o);
  sekmeleriCiz();
  gecmisCiz();
  if (o && o.term) { sigdir(); setTimeout(() => o.term.focus(), 0); }
  if (S.sohbetAcik) sohbetYukle();
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
  if (o.canli && o.pid) await window.evren.kapatOturum(o.pid);
  clearInterval(o.sayac);
  try { o.term && o.term.dispose(); } catch {}
  if (o.el) o.el.remove();
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

// ---------- oturum ----------
let sonYerel = 0;
const bekleyenVeri = new Map(); // pid -> [veri] (sekme kaydından önce gelen çıktı)

async function basla(devamId, secenekler) {
  const devam = typeof devamId === 'string' ? devamId : null; // düğme olayı dize değildir
  // EVREN işini sürdürürken işin kendi dizini/modeli kullanılır; normal başlatmada seçili olanlar.
  const sec = secenekler && typeof secenekler === 'object' && typeof secenekler.dizin === 'string' ? secenekler : {};
  const yol = sec.dizin || S.proje;
  const m = (sec.modelId ? { id: sec.modelId } : null) || seciliModel() || {};
  const p = sec.dizin ? S.projeler.find((x) => x.yol === sec.dizin) : seciliProje();
  if (S.basliyor || !S.yuklendi || !S.anahtarVar) return;
  if (S.oturumlar.filter((o) => o.canli).length >= 8) { olay('OTURUM', 'en çok 8 canlı oturum', 'uyari'); return; }
  if (!yol && !(await klasorEkle())) return;
  S.basliyor = true;
  const o = { id: ++sonYerel, pid: 0, model: m.id, proje: p ? p.ad : yol, dal: p ? p.dal : '', yol, canli: true, kod: null, basladi: 0, yeni: false, devam };
  S.oturumlar.push(o);
  await terminalOlustur(o);
  sekmeSec(o.id);
  await bekle(30);
  if (o.fit) { try { o.fit.fit(); } catch {} }
  o.term.writeln(`\x1b[38;2;74;83;93m  evren \x1b[38;2;108;119;131m› ${m.id} › ${o.proje}\x1b[0m`);
  const sonuc = await window.evren.baslat({ modelId: m.id, dizin: yol, cols: o.term.cols, rows: o.term.rows, devam });
  S.basliyor = false;
  if (!sonuc || sonuc.hata) {
    o.canli = false; o.kod = 'hata';
    o.term.writeln(`\x1b[38;2;236;106;110m  ✗ ${(sonuc && sonuc.hata) || 'başlatılamadı'}\x1b[0m`);
    olay('OTURUM', `başlatılamadı · ${(sonuc && sonuc.hata) || ''}`, 'kotu');
    sekmeleriCiz();
    return;
  }
  o.pid = sonuc.id;
  for (const v of bekleyenVeri.get(o.pid) || []) o.term.write(v);
  bekleyenVeri.delete(o.pid);
  o.basladi = Date.now();
  olay('OTURUM', `#${S.oturumlar.indexOf(o) + 1} başladı · ${m.id} · ${o.proje}`, 'iyi');
  o.sayac = setInterval(() => { if (o.id === S.aktif) { sureYaz(); oturumModeliTara(o); } }, 1000);
  sekmeleriCiz();
  sigdir();
  o.term.focus();
  setTimeout(gecmisYukle, 4000); // yeni oturumun kaydı birkaç sn sonra oluşur
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

function oturumBitti(pid, bilgi) {
  const o = S.oturumlar.find((x) => x.pid === pid);
  if (!o || !o.canli) return;
  o.canli = false;
  o.bitti = Date.now();
  o.kod = bilgi && bilgi.kod != null ? bilgi.kod : null;
  clearInterval(o.sayac);
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

function sohbetToggle(zorla) {
  const panel = $('sohbetPanel');
  if (!panel) return;
  const acik = typeof zorla === 'boolean' ? zorla : panel.hidden;
  panel.hidden = !acik;
  S.sohbetAcik = acik;
  sakla.yaz('sohbetAcik', acik);
  if ($('sohbetBtn')) $('sohbetBtn').classList.toggle('aktif', acik);
  if (acik) sohbetYukle(true);
  setTimeout(() => sigdir(), 80);
}

async function sohbetYukle(zorla = false) {
  const panel = $('sohbetPanel');
  if (!panel || panel.hidden) return;
  const o = aktifOturum();
  if (!o || !o.pid) {
    $('sohbetListe').innerHTML = '<div class="sohbet-bos">Aktif bir oturum yok</div>';
    $('sohbetSayac').textContent = '0';
    return;
  }
  if (sohbetYukleniyor && !zorla) return;
  sohbetYukleniyor = true;
  try {
    const res = await window.evren.sohbetGecmisi(o.pid);
    const girisler = (res && res.girisler) || [];
    o.sohbetGirisler = girisler;
    sohbetCiz(girisler);
  } catch (e) {
    console.error('Sohbet geçmişi okunamadı:', e);
  } finally {
    sohbetYukleniyor = false;
  }
}

function sohbetCiz(girisler) {
  const filtre = S.sohbetFiltre || 'hepsi';
  const filtrelenmis = (girisler || []).filter((g) => {
    if (filtre === 'mesajlar') return g.rol === 'kullanici' || g.rol === 'asistan';
    if (filtre === 'arac') return g.rol === 'arac';
    return true;
  });

  if ($('sohbetSayac')) $('sohbetSayac').textContent = filtrelenmis.length;

  const liste = $('sohbetListe');
  if (!liste) return;
  if (!filtrelenmis.length) {
    liste.innerHTML = '<div class="sohbet-bos">Bu filtrede kayıt bulunamadı</div>';
    return;
  }

  const zamanMetni = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const rolEtiketleri = {
    kullanici: 'Kullanıcı',
    asistan: 'Asistan',
    arac: 'Araç',
  };

  const enAlttaMi = (liste.scrollHeight - liste.scrollTop - liste.clientHeight) < 60;

  liste.innerHTML = filtrelenmis.map((g, idx) => {
    const rol = g.rol || 'asistan';
    const zaman = zamanMetni(g.ms);
    const aracAd = (g.arac && g.arac.ad) ? esc(g.arac.ad) : '';
    const icerik = esc(g.metin || '');
    return `
      <div class="sohbet-kart ${rol}" data-idx="${idx}">
        <div class="sohbet-kart-ust">
          <div class="sohbet-rol-grup">
            <span class="sohbet-rol">${rolEtiketleri[rol] || rol}</span>
            ${aracAd ? `<span class="mono" style="opacity:0.75">· ${aracAd}</span>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            ${zaman ? `<span class="sohbet-zaman">${zaman}</span>` : ''}
            <button class="sohbet-kopyala" type="button" title="Metni kopyala">kopyala</button>
          </div>
        </div>
        <div class="sohbet-icerik">${icerik}</div>
      </div>
    `;
  }).join('');

  if (enAlttaMi || !liste.dataset.kaydirildi) {
    liste.scrollTop = liste.scrollHeight;
    liste.dataset.kaydirildi = '1';
  }
}

// ---------- komut paleti ----------
const P = { ogeler: [], gorunen: [], aktif: 0 };

function paletOgeleri() {
  const kilit = false; // çoklu oturum: seçimler her zaman yeni oturum içindir
  const ao = aktifOturum();
  const ey = [
    { ad: 'Yeni oturum başlat', ic: 'play', alt: S.aktif == null ? 'Enter' : '', yap: basla, pasif: !S.anahtarVar || !S.yuklendi },
    ...(ao && ao.canli ? [{ ad: 'Bu oturumu sonlandır', ic: 'stop', yap: durdur }] : []),
    ...(ao ? [{ ad: 'Sekmeyi kapat', ic: 'clear', alt: 'Ctrl ⇧ W', yap: () => sekmeKapat(ao.id) }] : []),
    { ad: 'Ana ekran', ic: 'term', alt: 'Ctrl ⇧ T', yap: () => sekmeSec(null) },
    { ad: 'Odak modu', ic: 'odak', alt: 'Ctrl ⇧ F', yap: () => odakToggle() },
    { ad: 'Konuşma geçmişi', ic: 'chat', alt: 'Ctrl ⇧ H', yap: () => sohbetToggle() },
    { ad: 'Klasör ekle', ic: 'folder', yap: klasorEkle },
    { ad: 'Kenar panelini aç / kapat', ic: 'side', alt: 'Ctrl ⇧ B', yap: sideToggle },
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
  for (const o of P.ogeler) {
    let m = q ? eslesme(q, o.ad) : { skor: 0, idx: [] };
    if (!m && q && o.alt) { const m2 = eslesme(q, o.alt); if (m2) m = { skor: m2.skor - 2, idx: [] }; }
    if (!m) continue;
    if (!o.pasif && m.skor > enSkor) { enSkor = m.skor; enIyi = P.gorunen.length; }
    P.gorunen.push({ ...o, idx: m.idx });
  }
  P.aktif = q ? Math.max(0, enIyi) : Math.max(0, P.gorunen.findIndex((o) => !o.pasif));
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

function paletAc() {
  P.ogeler = paletOgeleri();
  $('palet').hidden = false;
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
  if (!o || o.pasif) return;
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
const Kare = (() => {
  const aboneler = new Set();
  let raf = 0;
  function dongu(now) {
    raf = 0;
    for (const f of [...aboneler]) { try { f(now); } catch (e) { console.error(e); } }
    if (aboneler.size) raf = requestAnimationFrame(dongu);
  }
  function uyandir() { if (!raf && !document.hidden && aboneler.size) raf = requestAnimationFrame(dongu); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else uyandir(); });
  return {
    abone(f) { aboneler.add(f); uyandir(); return () => { aboneler.delete(f); }; },
    durdur() { cancelAnimationFrame(raf); raf = 0; },
    get calisiyor() { return !!raf; },
    aboneSayisi: () => aboneler.size,
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

// ---------- canlı grafik: Model → EVREN → Proje akışı + takımyıldız ----------
const Grafik = (() => {
  const kutu = $('brif');
  const cv = document.createElement('canvas');
  kutu.prepend(cv);
  const c = cv.getContext('2d', { alpha: false });
  let w = 0, h = 0, dpr = 1, bag = null, son = 0, kart = null, fare = null, isabet = [];
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
    c.font = `500 10px ${MONO}`;
    const etiketW = etiketli ? Math.min(150, Math.max(...liste.map((o) => c.measureText(o.ust.length > 22 ? o.ust.slice(0, 21) + '…' : o.ust).width))) : 0;
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
    cv.style.cursor = fare && isabet.some((d) => Math.hypot(fare[0] - d.x, fare[1] - d.y) < 16) && S.aktif == null ? 'pointer' : '';
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
    if (AZ_HAREKET) { ciz(performance.now(), true); return; }
    son = 0;
    bag = Kare.abone((now) => ciz(now));
  }
  function dur() {
    if (!bag) return;
    bag();
    bag = null;
  }
  return { basla, dur, olc };
})();


// ---------- Yeni Oturum Başlat Modalı: Proje ve Model Seçimi ----------
let modalSecilenProje = '';
let modalSecilenModel = '';

function yeniOturumModalGuncelle() {
  const pIzgara = $('modalProjeIzgara');
  const mIzgara = $('modalModelIzgara');
  if (!pIzgara || !mIzgara) return;

  if (!modalSecilenProje && S.projeler.length) modalSecilenProje = S.proje || S.projeler[0].yol;
  if (!modalSecilenModel && S.modeller.length) modalSecilenModel = S.model || S.modeller[0].id;

  // Proje kartları
  pIzgara.innerHTML = S.projeler.map((p) => `
    <button class="oturum-secim-kart${p.yol === modalSecilenProje ? ' aktif' : ''}" type="button" data-proje="${esc(p.yol)}">
      <div class="oturum-secim-kart-ust">
        <span class="oturum-secim-kart-ad">${esc(p.ad)}</span>
        ${p.dal ? `<span class="tag mono">${esc(p.dal)}</span>` : ''}
      </div>
      <span class="oturum-secim-kart-alt mono">${esc(kisaYol(p.yol, 28))}</span>
    </button>
  `).join('');

  // Model kartları
  mIzgara.innerHTML = S.modeller.map((m) => `
    <button class="oturum-secim-kart${m.id === modalSecilenModel ? ' aktif' : ''}" type="button" data-model="${esc(m.id)}">
      <div class="oturum-secim-kart-ust">
        <span class="oturum-secim-kart-ad">${esc(m.ad || m.id)}</span>
        <span class="tag mono">${kisaBaglam(m.baglamSayisi)}</span>
      </div>
      ${m.not ? `<span class="oturum-secim-kart-alt">${esc(m.not)}</span>` : ''}
    </button>
  `).join('');

  const pObj = S.projeler.find((p) => p.yol === modalSecilenProje);
  const mObj = S.modeller.find((m) => m.id === modalSecilenModel);
  const pAd = pObj ? pObj.ad : 'Proje seçilmedi';
  const mAd = mObj ? (mObj.ad || mObj.id) : 'Model seçilmedi';

  if ($('modalSeciliBilgi')) {
    $('modalSeciliBilgi').innerHTML = `Seçili: <b>${esc(pAd)}</b> · ${esc(mAd)}`;
  }
}

// Açık modal varken tuval döngüsü durur; modal kapanınca kaldığı yerden sürer.
function modalDurumGuncelle() {
  const acik = [...document.querySelectorAll('.modal-ortu')].some((m) => !m.hidden);
  if (acik) Grafik.dur(); else Grafik.basla();
}

function yeniOturumModalAc() {
  modalSecilenProje = S.proje || (S.projeler[0] ? S.projeler[0].yol : '');
  modalSecilenModel = S.model || (S.modeller[0] ? S.modeller[0].id : '');
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

function yeniOturumBaslat() {
  const yol = modalSecilenProje || S.proje;
  const modelId = modalSecilenModel || S.model;
  yeniOturumModalKapat();
  if (yol && yol !== S.proje) projeSec(yol);
  if (modelId && modelId !== S.model) modelSec(modelId);
  basla(null, { dizin: yol, modelId });
}

// ---------- olaylar ----------
listeKlavye('modelList', () => ({ liste: S.modeller.map((m) => m.id), deger: S.model }), modelSec);
listeKlavye('projeList', () => ({ liste: S.projeler.map((p) => p.yol), deger: S.proje }), projeSec);
$('baslaBtn').addEventListener('click', () => yeniOturumModalAc());
$('baslaBtn2').addEventListener('click', () => yeniOturumModalAc());
$('durdurBtn').addEventListener('click', durdur);
$('ekleBtn').addEventListener('click', klasorEkle);
$('yenileBtn').addEventListener('click', apiYenile);
$('cmdkBtn').addEventListener('click', paletAc);
$('paletBtn2').addEventListener('click', paletAc);
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
  olay('KASA', 'anahtar doğrulandı ve DPAPI ile kaydedildi', 'iyi');
  ozetYaz(); apiYenile();
});
$('odakIpucu').addEventListener('click', () => odakToggle(false));
$('yeniSekme').addEventListener('click', () => sekmeSec(null));
if ($('gecmisYenile')) $('gecmisYenile').addEventListener('click', gecmisYukle);
if ($('gecmisAra')) {
  $('gecmisAra').addEventListener('input', (e) => { gecmisAra = e.target.value; gecmisCiz(); });
  $('gecmisAra').addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    e.target.value = ''; gecmisAra = ''; gecmisCiz(); e.target.blur();
  });
}
$('gecmisList').addEventListener('click', (e) => {
  const baslik = e.target.closest('.seans-grup-baslik');
  if (baslik) { grupKatla(baslik); return; }
  const kart = e.target.closest('.seans-kart');
  if (!kart) return;
  const id = kart.dataset.id;
  const yol = kart.dataset.yol;
  if (yol && yol !== S.proje) {
    projeSec(yol);
  }
  gecmisAc(id);
});
$('sekmeler').addEventListener('click', (e) => {
  const x = e.target.closest('[data-kapat]');
  if (x) { e.stopPropagation(); sekmeKapat(Number(x.dataset.kapat)); return; }
  const t = e.target.closest('.tab');
  if (t) sekmeSec(t.dataset.id === 'ana' ? null : Number(t.dataset.id));
});
$('sekmeler').addEventListener('auxclick', (e) => { const t = e.target.closest('.tab'); if (e.button === 1 && t && t.dataset.id !== 'ana') sekmeKapat(Number(t.dataset.id)); });
$('stage').addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); fsDegis(e.deltaY < 0 ? 1 : -1); } }, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyP') { e.preventDefault(); $('palet').hidden ? paletAc() : paletKapat(); return; }
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyB') { e.preventDefault(); sideToggle(); return; }
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyF') { e.preventDefault(); odakToggle(); return; }
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyH') { e.preventDefault(); sohbetToggle(); return; }
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyT') { e.preventDefault(); sekmeSec(null); return; }
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyW') { e.preventDefault(); if (S.aktif != null) sekmeKapat(S.aktif); return; }
  if (e.ctrlKey && e.code === 'Tab') { e.preventDefault(); sekmeGez(e.shiftKey ? -1 : 1); return; }
  if (!$('palet').hidden) return;
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
if ($('sohbetBtn')) $('sohbetBtn').addEventListener('click', () => sohbetToggle());
if ($('sohbetKapatBtn')) $('sohbetKapatBtn').addEventListener('click', () => sohbetToggle(false));
if ($('sohbetYenileBtn')) $('sohbetYenileBtn').addEventListener('click', () => sohbetYukle(true));

if ($('sohbetPanel')) {
  $('sohbetPanel').addEventListener('click', (e) => {
    const f = e.target.closest('.sohbet-filtre');
    if (f) {
      for (const b of $('sohbetPanel').querySelectorAll('.sohbet-filtre')) b.classList.remove('aktif');
      f.classList.add('aktif');
      S.sohbetFiltre = f.dataset.filtre;
      const o = aktifOturum();
      if (o && o.sohbetGirisler) sohbetCiz(o.sohbetGirisler);
      return;
    }
    const k = e.target.closest('.sohbet-kopyala');
    if (k) {
      const kart = k.closest('.sohbet-kart');
      const icerik = kart ? kart.querySelector('.sohbet-icerik').textContent : '';
      if (icerik) {
        navigator.clipboard.writeText(icerik);
        const eski = k.textContent;
        k.textContent = 'kopyalandı';
        setTimeout(() => { k.textContent = eski; }, 1200);
      }
    }
  });
}

// Canlı güncelleme: Sohbet paneli açıksa ve oturum seçiliyse 3 saniyede bir güncelle
setInterval(() => {
  if (S.sohbetAcik && S.aktif != null) {
    sohbetYukle();
  }
}, 3000);

if (S.sohbetAcik) {
  setTimeout(() => sohbetToggle(true), 200);
}

$('fsMetin').textContent = S.fs;
yukle().then(() => {
  if (new URLSearchParams(location.search).get('palet')) paletAc();
  if (new URLSearchParams(location.search).get('kumanda')) setTimeout(kumandaModalAc, 250);
  if (new URLSearchParams(location.search).get('modal')) setTimeout(yeniOturumModalAc, 350); // test: modalı açık yakala
  const n = Number(new URLSearchParams(location.search).get('oturum') || 0);
  if (n) (async () => { for (let i = 0; i < n; i++) { if (i) projeSec((S.projeler[i] || S.projeler[0]).yol); await basla(); await bekle(700); } const t = aktifTerm(); if (t && new URLSearchParams(location.search).get('yaz')) window.evren.yaz(aktifOturum().pid, 'echo EVREN coklu oturum testi' + String.fromCharCode(13)); if (new URLSearchParams(location.search).get('odak')) odakToggle(true); })();
});


// Yeni Oturum Modalı Olayları
if ($('yeniOturumKapatBtn')) $('yeniOturumKapatBtn').addEventListener('click', yeniOturumModalKapat);
if ($('yeniOturumVazgecBtn')) $('yeniOturumVazgecBtn').addEventListener('click', yeniOturumModalKapat);
if ($('yeniOturumBaslatBtn')) $('yeniOturumBaslatBtn').addEventListener('click', yeniOturumBaslat);
if ($('modalKlasorEkleBtn')) $('modalKlasorEkleBtn').addEventListener('click', async () => {
  const sec = await klasorEkle();
  if (sec) {
    modalSecilenProje = sec.yol;
    yeniOturumModalGuncelle();
  }
});

if ($('modalProjeIzgara')) {
  $('modalProjeIzgara').addEventListener('click', (e) => {
    const k = e.target.closest('.oturum-secim-kart');
    if (!k) return;
    modalSecilenProje = k.dataset.proje;
    yeniOturumModalGuncelle();
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

if ($('yeniOturumModal')) {
  $('yeniOturumModal').addEventListener('click', (e) => {
    if (e.target === $('yeniOturumModal')) yeniOturumModalKapat();
  });
}
