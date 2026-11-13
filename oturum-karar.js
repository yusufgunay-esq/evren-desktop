// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Yusuf Günay. */
// Hedef (goal) duraklamasını tanır: CLI "Goal paused … send a message to continue"
// yazdığında oturum, kullanıcı bir şey yazmadan kaldığı yerden sürsün diye "devam" gönderilir.
'use strict';
const ESC = String.fromCharCode(27);

// ANSI CSI dizilerini (renk, imleç) atar; eşleşme düz metinde yapılır.
function ansiTemizle(metin) {
  const s = String(metin);
  let cikti = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ESC) {
      let j = i + 1;
      if (s[j] === '[') {
        j++;
        while (j < s.length && !/[A-Za-z]/.test(s[j])) j++;
      }
      i = j; // kaçış dizisinin son harfi de atlanır
      continue;
    }
    cikti += s[i];
  }
  return cikti;
}

// Satır sarma boşluk ekleyebilir: eşleşmeden önce boşluk dizileri tek boşluğa iner.
const BOSLUK = new RegExp('[' + String.fromCharCode(9, 10, 13, 160) + ' ]+', 'g');

// Kuyrukta duraklama satırı var mı: "Goal paused" ve ardından "send a message to continue".
function hedefDurakladi(kuyruk) {
  const s = String(kuyruk || '').replace(BOSLUK, ' ');
  if (s.indexOf('Goal paused') < 0) return false;
  return s.indexOf('send a message to continue') >= 0;
}

// Otomatik devam bütçesi: en çok 3 kez, aralarında en az 90 sn (değerler çağrıda gelir).
function hedefDevamIzni(durum, simdi, sinir) {
  const enCok = Number(sinir && sinir.enCok) || 3;
  const aralik = Number(sinir && sinir.aralik) || 90 * 1000;
  const d = durum || {};
  const sayi = Number(d.sayi) || 0;
  const son = Number(d.son) || 0;
  return sayi < enCok && simdi - son >= aralik;
}

// İptal edilebilir zamanlayıcı: yeni kurulum öncekini düşürür, iptal edilen geri çağrı koşmaz.
function hedefDevamKur(secenek) {
  const ham = Number(secenek && secenek.gecikme);
  const ms = Number.isFinite(ham) && ham >= 0 ? ham : 2500;
  const zamanla = (secenek && secenek.zamanla) || setTimeout;
  const iptal = (secenek && secenek.iptal) || clearTimeout;
  let zaman = null;
  let nesil = 0;
  return {
    kur(fn) {
      nesil++;
      if (zaman != null) iptal(zaman);
      const benim = nesil;
      zaman = zamanla(() => {
        zaman = null;
        if (benim !== nesil) return;
        try { fn(); } catch {}
      }, ms);
    },
    iptalEt() {
      nesil++;
      if (zaman != null) { iptal(zaman); zaman = null; }
    },
    get bekliyor() { return zaman != null; },
  };
}

// ---- Oturum adı kuralları ----
const boslukTopla = (s) => String(s || '').replace(BOSLUK, ' ').trim();
const BASLIK_ANLAMSIZ = new Set(['devam', 'tamam', 'ok', 'okay', 'evet', 'hayır', 'peki', 'anladım', 'merhaba', 'selam', 'test', 'bak', 'hmm']);
function baslikAnlamsiz(metin) {
  const s = kenarKirp(boslukTopla(metin)).toLocaleLowerCase('tr');
  if (s.length < 3) return true;
  if (BASLIK_ANLAMSIZ.has(s)) return true;
  return !/[a-zA-Zçğıöşü]/.test(s); // yalnız sayı/noktalama: ad değil
}
const KIRP = new Set(['"', "'", '“', '”', '‘', '’', String.fromCharCode(96), '«', '»', '-', '–', '—', ':', '•', ' ', '.', '…', ',', ';']);
function kenarKirp(s) {
  let a = 0, b = s.length;
  while (a < b && KIRP.has(s[a])) a++;
  while (b > a && KIRP.has(s[b - 1])) b--;
  return s.slice(a, b);
}
// Yalnız sarmalayan tırnak/noktalama atılır; içteki kesme işareti (Claude'un) korunur.
function baslikDuzelt(ham) {
  let s = kenarKirp(boslukTopla(ham));
  if (s.length > 48) {
    s = s.slice(0, 48);
    const b = s.lastIndexOf(' ');
    if (b > 24) s = s.slice(0, b);
    s = kenarKirp(s);
  }
  return s;
}

module.exports = { ansiTemizle, hedefDurakladi, hedefDevamIzni, hedefDevamKur, boslukTopla, baslikAnlamsiz, baslikDuzelt };
