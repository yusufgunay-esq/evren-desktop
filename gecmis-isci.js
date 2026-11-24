// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
// Oturum geçmişi taraması ayrı iş parçacığında yapılır; ana süreç dosya sisteminde beklemez.
'use strict';
const { parentPort } = require('node:worker_threads');
const gecmis = require('./gecmis');
const projeCikarim = require('./proje-cikarim');
const sohbet = require('./sohbet');

// Proje çıkarımı dosya okur; izleyiciler burada yaşar, ana süreçteki panoyla karışmaz (en çok 24 dosya).
const ciktiIzleyiciler = new Map(); // dosya -> sohbet.CiktiIzleyici

// İletiler sırayla işlenir: aynı anda tek tarama koşar, ana süreç hiç bloklanmaz.
parentPort.on('message', async (mesaj) => {
  const kimlik = mesaj && mesaj.id;
  // Ad önbelleği bu iş parçacığında ayrı yaşar: yeniden adlandırma sonrası ana süreçten temizlenir.
  if (mesaj && mesaj.tip === 'onbellek-temizle') {
    try { gecmis.baslikOnbellekTemizle(mesaj.kimlik); } catch {}
    return;
  }
  // İçerik arama: liste ana süreçte; burada yalnız dosyaların kuyrukları taranır.
  if (mesaj && mesaj.tip === 'ara') {
    try { parentPort.postMessage({ id: kimlik, sonuc: gecmis.icerikAraListe(mesaj.turler, mesaj.sorgu) }); }
    catch (e) { parentPort.postMessage({ id: kimlik, hata: String((e && e.message) || e) }); }
    return;
  }
  // Proje çıkarımı (klasörsüz oturumun asıl projesi): ağır disk okuması ana süreçten çıkarılır.
  if (mesaj && mesaj.tip === 'proje-cikar') {
    try {
      const sonuc = await projeCikarim.cikar(mesaj.oturumlar, mesaj.projeler);
      parentPort.postMessage({ id: kimlik, sonuc });
    } catch (e) {
      parentPort.postMessage({ id: kimlik, hata: String((e && e.message) || e) });
    }
    return;
  }
  // Üretilen dosyalar (Çıktılar): izleyici durumu iş parçacığında tutulur, artımlı okunur.
  if (mesaj && mesaj.tip === 'cikti') {
    try {
      const dosya = mesaj.dosya;
      if (!dosya) { parentPort.postMessage({ id: kimlik, sonuc: [] }); return; }
      let iz = ciktiIzleyiciler.get(dosya);
      if (!iz) {
        iz = new sohbet.CiktiIzleyici();
        ciktiIzleyiciler.set(dosya, iz);
        if (ciktiIzleyiciler.size > 24) ciktiIzleyiciler.delete(ciktiIzleyiciler.keys().next().value);
      }
      parentPort.postMessage({ id: kimlik, sonuc: iz.oku(dosya) || [] });
    } catch (e) {
      parentPort.postMessage({ id: kimlik, hata: String((e && e.message) || e) });
    }
    return;
  }
  try {
    const sonuc = mesaj && (mesaj.tum || !mesaj.dizin)
      ? gecmis.tumOturumlariTara(mesaj.secenekler)
      : gecmis.oturumGecmisi(mesaj.dizin, mesaj.secenekler);
    parentPort.postMessage({ id: kimlik, sonuc });
  } catch (e) {
    parentPort.postMessage({ id: kimlik, hata: String((e && e.message) || e) });
  }
});
