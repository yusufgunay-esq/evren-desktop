// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
// Canlı oturum görünümü (Sohbet · Terminal · Dosyalar) için saf yardımcılar. Hem tarayıcıda (window.Gorunum)
// hem Node testinde (require) çalışır; DOM'a ve depoya dokunmaz.
(function (kok) {
  'use strict';
  // Oturum ilk açıldığında Terminal'e düşer: sohbet paneli salt okunurdur, yazmanın tek yolu terminal.
  const VARSAYILAN = 'terminal';
  const SINIR = 300; // hatırlanan en çok oturum

  const GORUNUMLER = ['sohbet', 'terminal', 'dosyalar'];
  const gecerli = (d) => GORUNUMLER.includes(d);
  // Oturum kimliği: sürdürülen/kayıtlı oturumda Claude oturum kimliği, yoksa bu açılışa özgü yerel sayı.
  function anahtar(o) {
    if (!o) return '';
    return o.devam ? 'd:' + o.devam : 'y:' + o.id;
  }
  function oku(harita, anahtarMetni, varsayilan) {
    const d = harita && anahtarMetni ? harita[anahtarMetni] : null;
    return gecerli(d) ? d : (gecerli(varsayilan) ? varsayilan : VARSAYILAN);
  }
  // Yeni harita döner (girdi değişmez); eski kayıtlar sınırı aşınca baştan atılır.
  function yaz(harita, anahtarMetni, deger) {
    const yeni = Object.assign({}, harita || {});
    if (!anahtarMetni || !gecerli(deger)) return yeni;
    delete yeni[anahtarMetni]; // sona taşınır
    yeni[anahtarMetni] = deger;
    const adlar = Object.keys(yeni);
    for (const ad of adlar.slice(0, Math.max(0, adlar.length - SINIR))) delete yeni[ad];
    return yeni;
  }
  const karsiti = (d) => (d === 'terminal' ? 'sohbet' : 'terminal');
  // Ctrl+Shift+H: Sohbet → Terminal → Dosyalar → Sohbet
  const sonraki = (d) => GORUNUMLER[(Math.max(0, GORUNUMLER.indexOf(d)) + 1) % GORUNUMLER.length];
  // Kullanıcı yukarı kaydırdıysa yeni girdiler onu aşağı çekmez: yalnız dipteyken akar.
  function dipteMi(kaydirma, yukseklik, gorunen, esik = 60) {
    return yukseklik - kaydirma - gorunen < esik;
  }
  // Arama sonucunda eşleşen alt iş adı: ana ad zaten eşleşiyorsa alt iş gösterilmez.
  function altIsBul(isler, ad) {
    if (!ad || !Array.isArray(isler)) return null;
    return isler.find((e) => e && (e.baslik === ad || e.tanim === ad)) || null;
  }

  // ---- Geçmiş listesi: tarih kümeleri, proje kümeleri, arşiv ayrımı ----
  const GUN_MS = 86400000;
  const TARIH_KUMELERI = [['bugun', 'Bugün'], ['dun', 'Dün'], ['hafta', 'Bu hafta'], ['eski', 'Daha eski']];
  // Yerel saat dilimiyle gün başı; setDate ile gün eklenir (yaz saati kaymasında 24 saat varsayılmaz).
  function gunBasi(simdi, geri = 0) {
    const d = new Date(simdi);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - geri);
    return d.getTime();
  }
  // ms → 'bugun' | 'dun' | 'hafta' (son 7 gün, bugün ve dün dışında) | 'eski'
  function tarihKumesi(ms, simdi = Date.now()) {
    const t = Number(ms);
    if (!Number.isFinite(t) || t <= 0) return 'eski';
    if (t >= gunBasi(simdi, 0)) return 'bugun';
    if (t >= gunBasi(simdi, 1)) return 'dun';
    if (t >= gunBasi(simdi, 6)) return 'hafta';
    return 'eski';
  }
  // Girdi sırası korunur (liste zaten en yeni üstte); boş kümeler atılır.
  function tarihGrupla(liste, simdi = Date.now()) {
    const kovalar = new Map(TARIH_KUMELERI.map(([k, ad]) => [k, { anahtar: k, ad, ogeler: [] }]));
    for (const g of liste || []) kovalar.get(tarihKumesi(g && g.ms, simdi)).ogeler.push(g);
    return [...kovalar.values()].filter((k) => k.ogeler.length);
  }
  // projeFn(g) -> { yol, ad }; kümeler en yeni oturumu olan proje önde, içi en yeni üstte.
  function projeGrupla(liste, projeFn) {
    const harita = new Map();
    for (const g of liste || []) {
      const p = projeFn(g) || {};
      const anahtar = String(p.yol || p.ad || '').toLowerCase();
      if (!harita.has(anahtar)) harita.set(anahtar, { anahtar, yol: p.yol || '', ad: p.ad || 'EVREN', ogeler: [] });
      harita.get(anahtar).ogeler.push(g);
    }
    const kumeler = [...harita.values()];
    for (const k of kumeler) k.ogeler.sort((a, b) => (b.ms || 0) - (a.ms || 0));
    kumeler.sort((a, b) => (b.ogeler[0].ms || 0) - (a.ogeler[0].ms || 0));
    return kumeler;
  }
  // Arşiv süzgeci: varsayılan liste arşivsizdir. korunan(g) true ise (etkin/çalışan oturum) arşivde olsa bile
  // normal listede kalır: etkin oturum gizlenemez.
  function arsivAyir(liste, arsiv, korunan) {
    const kume = arsiv instanceof Set ? arsiv : new Set(Array.isArray(arsiv) ? arsiv : []);
    const normal = [];
    const arsivli = [];
    for (const g of liste || []) {
      if (g && kume.has(g.id) && !(korunan && korunan(g))) arsivli.push(g);
      else normal.push(g);
    }
    return { normal, arsivli };
  }
  // Oturumun görünen projesi: elle seçim > yol çoğunluğundan çıkarım > kendi klasörü.
  function etkinProje(g, elle, cikarim, adBul) {
    const e = elle && elle[g.id];
    if (e) return { yol: e, ad: (adBul && adBul(e)) || String(e).split(/[\\/]/).filter(Boolean).pop() || '', kaynak: 'elle' };
    const c = cikarim && cikarim[g.id];
    if (c && c.yol) return { yol: c.yol, ad: c.ad || '', kaynak: 'cikarim' };
    return { yol: g.projeYol || '', ad: g.projeAd || '', kaynak: 'kendi' };
  }

  // ---- Arama katlaması (geçmiş araması ve hızlı geçiş ortak kullanır; gecmis.js buradan alır) ----
  const ARAMA_HARF = { A: 'a', B: 'b', C: 'c', D: 'd', E: 'e', F: 'f', G: 'g', H: 'h', I: 'ı', J: 'j', K: 'k', L: 'l', M: 'm', N: 'n', O: 'o', P: 'p', Q: 'q', R: 'r', S: 's', T: 't', U: 'u', V: 'v', W: 'w', X: 'x', Y: 'y', Z: 'z', Ç: 'ç', Ğ: 'ğ', İ: 'i', Ö: 'ö', Ş: 'ş', Ü: 'ü' };
  const aramaMetni = (s) => String(s).replace(/[A-ZÇĞİÖŞÜ]/g, (c) => ARAMA_HARF[c] || c).toLowerCase();
  // Küçük harf + Türkçe harfler ASCII'ye (tek karakterli eşleme; dizin kaymaz).
  const KATLA = { 'ı': 'i', 'ş': 's', 'ç': 'c', 'ğ': 'g', 'ö': 'o', 'ü': 'u', 'â': 'a', 'î': 'i', 'û': 'u' };
  const katla = (s) => aramaMetni(s).replace(/[ışçğöüâîû]/g, (c) => KATLA[c] || c);
  // Damerau-Levenshtein uzaklığı <= 1 mi (tek harf farkı ya da bitişik iki harfin yer değiştirmesi).
  function birFark(a, b) {
    if (a === b) return true;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    let i = 0;
    while (i < la && i < lb && a[i] === b[i]) i++;
    if (la === lb) {
      if (a.slice(i + 1) === b.slice(i + 1)) return true;
      return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
    }
    return la > lb ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
  }
  // Ad / proje alanı sorguyla eşleşir mi: katlanmış içerme; en az 5 karakterlik sorguda yazım hatası toleransı.
  function adEslesir(alanlar, sorgu) {
    const q = katla(String(sorgu || '').trim());
    if (q.length < 2) return false;
    for (const alan of alanlar) {
      const m = katla(alan || '');
      if (!m) continue;
      if (m.includes(q)) return true;
      if (q.length >= 5) {
        for (const w of m.split(/[^a-z0-9]+/)) {
          if (w.length >= q.length - 1 && w.length <= q.length + 1 && birFark(w, q)) return true;
        }
      }
    }
    return false;
  }

  // ---- Okunmamış işareti ----
  // Arka planda (görünür olmayan) bir oturum bitti ya da soru sordu ve kullanıcı o son hali görmediyse true.
  // gorulen: { oturumKimligi: sonGörülmeMs }; taban: özelliğin ilk açıldığı an (öncesi okunmuş sayılır).
  function okunmamisMi(g, gorulen, gorunuyor, taban = 0) {
    if (!g || !g.id || gorunuyor) return false;
    if (g.sonDurum !== 'bitti' && g.sonDurum !== 'soru') return false;
    const ms = Number(g.ms);
    if (!Number.isFinite(ms) || ms <= Number(taban || 0)) return false;
    return ms > Number((gorulen && gorulen[g.id]) || 0);
  }

  // ---- Claude Code oturumlarını gizleme ----
  // Bu uygulamanın kendi açtığı (EVREN) oturumlar her zaman kalır; kaynağı kesin 'claude' olanlar yalnız goster açıkken.
  // korunan(g) true ise (ör. sekmesi açık oturum) kaynağı ne olursa olsun kalır.
  const evrenMi = (g) => !!g && (g.kaynak !== 'claude' || !!g.evren);
  function claudeSuz(liste, goster, korunan) {
    const l = Array.isArray(liste) ? liste : [];
    if (goster) return l;
    return l.filter((g) => evrenMi(g) || (korunan && korunan(g)));
  }

  // ---- Hızlı geçiş (Ctrl+K) ----
  const HIZLI_SINIR = 8;
  // Boş sorguda son açılan oturumlar (acilan: en yeni önde kimlik listesi; eksik kalırsa en yeni geçmişle tamamlanır).
  // Sorguda ad/proje eşleşmesi: başlıkta içerme > proje içerme > bulanık; eşitlikte son açılan, sonra yeni olan önde.
  function hizliGecis(gecmis, sorgu, acilan, projeFn, sinir = HIZLI_SINIR) {
    const liste = Array.isArray(gecmis) ? gecmis.filter((g) => g && g.id) : [];
    const sira = new Map((Array.isArray(acilan) ? acilan : []).map((id, i) => [id, i]));
    const q = katla(String(sorgu || '').trim());
    const proje = (g) => { const p = (projeFn && projeFn(g)) || {}; return { ad: p.ad || g.projeAd || '', yol: p.yol || g.projeYol || '' }; };
    if (!q) {
      const acik = [...sira.keys()].map((id) => liste.find((g) => g.id === id)).filter(Boolean);
      const kalan = liste.filter((g) => !sira.has(g.id)).sort((a, b) => (b.ms || 0) - (a.ms || 0));
      return [...acik, ...kalan].slice(0, sinir);
    }
    const puanli = [];
    for (const g of liste) {
      const p = proje(g);
      let puan;
      if (katla(g.baslik || '').includes(q)) puan = 0;
      else if (katla(p.ad).includes(q) || katla(p.yol).includes(q)) puan = 1;
      else if (adEslesir([g.baslik, p.ad, p.yol], q)) puan = 2;
      else continue;
      puanli.push({ g, puan });
    }
    puanli.sort((a, b) => a.puan - b.puan ||
      (sira.has(a.g.id) ? sira.get(a.g.id) : 1e9) - (sira.has(b.g.id) ? sira.get(b.g.id) : 1e9) ||
      (b.g.ms || 0) - (a.g.ms || 0));
    return puanli.slice(0, sinir * 2).map((x) => x.g);
  }
  // Son açılanlar listesine kimlik ekler (en yeni önde, tekrarsız, sınırlı).
  function acilanEkle(acilan, id, sinir = 20) {
    const eski = Array.isArray(acilan) ? acilan : [];
    if (!id) return eski;
    return [id, ...eski.filter((x) => x !== id)].slice(0, sinir);
  }
  // Görünür kart sırasında önceki/sonraki oturum (uçlarda başa/sona sarar); mevcut listede yoksa yöne göre uç.
  function komsuSira(idler, mevcut, yon) {
    if (!Array.isArray(idler) || !idler.length) return null;
    const i = idler.indexOf(mevcut);
    if (i < 0) return yon < 0 ? idler[idler.length - 1] : idler[0];
    return idler[(i + (yon < 0 ? -1 : 1) + idler.length) % idler.length];
  }

  // ---- Dosyalar görünümü: tür, süzgeç, proje köküne göre klasör grupları ----
  const GORSEL_UZ = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i;
  const KOD_UZ = /\.(js|mjs|cjs|jsx|ts|tsx|json|css|scss|html?|py|rs|go|java|kt|cs|cpp|cc|c|h|hpp|sh|ps1|bat|cmd|sql|yml|yaml|toml|xml|md|txt|ini|vue|svelte|lua|rb|php)$/i;
  function dosyaTuru(c) {
    const yol = (c && (c.yol || c.ad)) || '';
    if (c && c.resim === true) return 'gorsel';
    if (GORSEL_UZ.test(yol)) return 'gorsel';
    return KOD_UZ.test(yol) ? 'kod' : 'diger';
  }
  function dosyaSuz(liste, suzgec) {
    const l = Array.isArray(liste) ? liste : [];
    if (!suzgec || suzgec === 'hepsi') return l;
    const tur = suzgec === 'gorseller' ? 'gorsel' : suzgec;
    return l.filter((c) => dosyaTuru(c) === tur);
  }
  function dosyaSay(liste) {
    const say = { hepsi: 0, gorseller: 0, kod: 0, diger: 0 };
    for (const c of Array.isArray(liste) ? liste : []) {
      say.hepsi++;
      const t = dosyaTuru(c);
      say[t === 'gorsel' ? 'gorseller' : t]++;
    }
    return say;
  }
  const yolParcala = (y) => String(y || '').split(/[\\/]+/).filter(Boolean);
  // Dosyanın proje köküne göre yolu ('/' ayraçlı); kök dışındaysa tam yol aynen döner.
  function goreliYol(yol, kok) {
    const p = yolParcala(yol), k = yolParcala(kok);
    if (!k.length || k.length >= p.length) return yol ? String(yol) : '';
    for (let i = 0; i < k.length; i++) if (p[i].toLowerCase() !== k[i].toLowerCase()) return String(yol);
    return p.slice(k.length).join('/');
  }
  // Klasör grupları: '(kök)' ya da 'src/ui'; kök dışı dosyalar '(proje dışı)'. Girdi sırası (en yeni önde) korunur,
  // gruplar kendi en yeni öğesine göre dizilir. Her öğeye `goreli` eklenir.
  function dosyaGrupla(liste, kok) {
    const harita = new Map();
    for (const c of Array.isArray(liste) ? liste : []) {
      const goreli = goreliYol(c.yol, kok);
      const disarda = goreli === String(c.yol || '') && yolParcala(kok).length > 0;
      const i = goreli.lastIndexOf('/');
      const ad = disarda ? '(proje dışı)' : (i > 0 ? goreli.slice(0, i) : '(kök)');
      if (!harita.has(ad)) harita.set(ad, { klasor: ad, ogeler: [] });
      harita.get(ad).ogeler.push(Object.assign({}, c, { goreli }));
    }
    return [...harita.values()].sort((a, b) => (b.ogeler[0].ms || 0) - (a.ogeler[0].ms || 0));
  }

  // ---- Terminale görsel yapıştırma ----
  const iki = (n) => String(n).padStart(2, '0');
  // YYYYMMDD-HHMMSS.png (yerel saat); aynı saniyede ikinci kayıt için sira>1 ise -2, -3 eklenir.
  function yapistirAdi(tarih, sira = 1) {
    const d = tarih instanceof Date ? tarih : new Date(tarih);
    const ad = `${d.getFullYear()}${iki(d.getMonth() + 1)}${iki(d.getDate())}-${iki(d.getHours())}${iki(d.getMinutes())}${iki(d.getSeconds())}`;
    return sira > 1 ? `${ad}-${sira}.png` : `${ad}.png`;
  }
  // PTY'ye yazılacak metin: her yol tırnaklı, aralarında ve sonunda boşluk.
  function yolMetni(yollar) {
    const l = (Array.isArray(yollar) ? yollar : [yollar]).filter((y) => typeof y === 'string' && y);
    return l.map((y) => '"' + y.replace(/"/g, '') + '"').join(' ') + (l.length ? ' ' : '');
  }
  // Yapıştırma kararı: panoda görsel ya da kopyalanmış dosya varsa ek (yol listesi) kazanır —
  // dış uygulamaların "Resmi kopyala"sı panoda kaynak adresini de metin olarak bırakır, metin eziyor.
  // Ek yoksa metin, ikisi de yoksa null (yapıştırılmaz).
  function panoKarar(ek, metin) {
    if (ek && Array.isArray(ek.yollar) && ek.yollar.length) return { yollar: ek.yollar, onizleme: ek.onizleme || null };
    return metin ? { metin } : null;
  }
  // Sohbet panelinden gönderilecek mesaj: boşluklar tek satıra iner, sonuna Enter eklenir; boşsa mesaj yok.
  function gonderilecek(metin) {
    const m = String(metin == null ? '' : metin).replace(/\s+/g, ' ').trim();
    return m ? m + '\r' : '';
  }
  // PTY'ye boyut bildirimi yalnız gerçek değişimde gitsin: aynı boyutu bildirmek SIGWINCH üretir,
  // Claude Code TUI banner + transkripti gereksiz yere baştan çizer. Eksik/geçersiz değer "farklı" sayılır.
  function boyutAyni(onceki, yeni) {
    return !!onceki && !!yeni && Number(onceki.cols) === Number(yeni.cols) && Number(onceki.rows) === Number(yeni.rows) &&
      Number(yeni.cols) > 0 && Number(yeni.rows) > 0;
  }
  // Terminal tuş şeridi: düğme -> PTY'ye giden gerçek dizi (etiket kbd'de, ipucu title'da).
  const TERMINAL_TUSLARI = [
    { id: 'esc', etiket: 'Esc', ipucu: 'Esc · durdur', dizi: '\x1b' },
    { id: 'shifttab', etiket: '⇧ Tab', ipucu: 'Shift+Tab · kip değiştir', dizi: '\x1b[Z' },
    { id: 'ctrlc', etiket: 'Ctrl C', ipucu: 'Ctrl+C · kes / iptal', dizi: '\x03' },
    { id: 'yukari', etiket: '↑', ipucu: 'Yukarı ok · önceki girdi', dizi: '\x1b[A' },
    { id: 'asagi', etiket: '↓', ipucu: 'Aşağı ok · sonraki girdi', dizi: '\x1b[B' },
    { id: 'bolu', etiket: '/', ipucu: '/ · komut menüsü', dizi: '/' },
    { id: 'enter', etiket: 'Enter', ipucu: 'Enter · gönder', dizi: '\r' },
  ];

  // ---- Kısayollar: tek kaynak tablo (hem tuş dağıtıcı hem paletteki liste bunu kullanır) ----
  // shift: true/false/null (null = fark etmez). eylem: app.js'deki dağıtıcı anahtarı.
  // terminalDisi: terminal odaktayken bu tuş terminale gider (Ctrl+K "satır sonuna kadar sil" gibi).
  // yalnizTerminal: yalnız terminal odaktayken uygulamaya ait.
  const KISAYOLLAR = [
    { eylem: 'gecis', ad: 'Hızlı geçiş (oturum ara)', ctrl: true, shift: false, alt: false, code: 'KeyK', etiket: 'Ctrl K', terminalDisi: true },
    { eylem: 'gecis', ad: 'Hızlı geçiş (terminal içindeyken)', ctrl: true, shift: true, alt: false, code: 'KeyK', etiket: 'Ctrl ⇧ K' },
    { eylem: 'palet', ad: 'Komut paleti', ctrl: true, shift: true, alt: false, code: 'KeyP', etiket: 'Ctrl ⇧ P' },
    { eylem: 'onceki', ad: 'Önceki oturum (listedeki sırayla)', ctrl: true, shift: false, alt: true, code: 'ArrowUp', etiket: 'Ctrl Alt ↑' },
    { eylem: 'sonraki', ad: 'Sonraki oturum (listedeki sırayla)', ctrl: true, shift: false, alt: true, code: 'ArrowDown', etiket: 'Ctrl Alt ↓' },
    { eylem: 'yenidenAc', ad: 'Son kapatılan oturumu yeniden aç', ctrl: true, shift: false, alt: true, code: 'KeyT', etiket: 'Ctrl Alt T' },
    { eylem: 'ana', ad: 'Ana ekran / yeni oturum', ctrl: true, shift: true, alt: false, code: 'KeyT', etiket: 'Ctrl ⇧ T' },
    { eylem: 'sekmeKapat', ad: 'Sekmeyi kapat', ctrl: true, shift: true, alt: false, code: 'KeyW', etiket: 'Ctrl ⇧ W' },
    { eylem: 'sekmeGez', ad: 'Sekme değiştir', ctrl: true, shift: null, alt: false, code: 'Tab', etiket: 'Ctrl Tab' },
    { eylem: 'kenar', ad: 'Oturumlar panelini aç / kapat', ctrl: true, shift: true, alt: false, code: 'KeyB', etiket: 'Ctrl ⇧ B' },
    { eylem: 'odak', ad: 'Odak modu', ctrl: true, shift: true, alt: false, code: 'KeyF', etiket: 'Ctrl ⇧ F' },
    { eylem: 'gorunumDon', ad: 'Görünümü değiştir (Sohbet · Terminal · Dosyalar)', ctrl: true, shift: true, alt: false, code: 'KeyH', etiket: 'Ctrl ⇧ H' },
    { eylem: 'gorunumSohbet', ad: 'Sohbet görünümü', ctrl: true, shift: false, alt: false, code: 'Digit1', etiket: 'Ctrl 1' },
    { eylem: 'gorunumTerminal', ad: 'Terminal görünümü', ctrl: true, shift: false, alt: false, code: 'Digit2', etiket: 'Ctrl 2' },
    { eylem: 'gorunumDosyalar', ad: 'Dosyalar görünümü', ctrl: true, shift: false, alt: false, code: 'Digit3', etiket: 'Ctrl 3' },
    { eylem: 'terminalAra', ad: 'Terminalde ara', ctrl: true, shift: false, alt: false, code: 'KeyF', etiket: 'Ctrl F', yalnizTerminal: true },
  ];
  // terminalda: odak xterm içindeyse true (terminalDisi tuşlar atlanır, yalnizTerminal tuşlar açılır).
  function kisayolBul(e, tablo = KISAYOLLAR, terminalda = false) {
    if (!e || !e.ctrlKey || e.metaKey) return null;
    return tablo.find((k) => k.code === e.code && !!e.altKey === k.alt && (k.shift === null || !!e.shiftKey === k.shift) &&
      !(terminalda && k.terminalDisi) && !(!terminalda && k.yalnizTerminal)) || null;
  }

  const api = { claudeSuz, evrenMi, aramaMetni, katla, birFark, adEslesir, okunmamisMi, hizliGecis, acilanEkle, komsuSira, KISAYOLLAR, kisayolBul, HIZLI_SINIR, VARSAYILAN, TARIH_KUMELERI, tarihKumesi, tarihGrupla, projeGrupla, arsivAyir, etkinProje, anahtar, oku, yaz, karsiti, sonraki, GORUNUMLER, dipteMi, altIsBul, boyutAyni, dosyaTuru, dosyaSuz, dosyaSay, goreliYol, dosyaGrupla, yapistirAdi, yolMetni, panoKarar, gonderilecek, TERMINAL_TUSLARI };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else kok.Gorunum = api;
})(typeof window !== 'undefined' ? window : globalThis);
