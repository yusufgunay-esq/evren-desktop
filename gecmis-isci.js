// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* Copyright (c) 2026 Yusuf Günay.
 * This program is free software under the GNU GPL v3 or later; see LICENSE and LICENSE-EK.md. */
// Oturum geçmişi taraması ayrı iş parçacığında yapılır; ana süreç dosya sisteminde beklemez.
'use strict';
const { parentPort } = require('node:worker_threads');
const gecmis = require('./gecmis');

// İletiler sırayla işlenir: aynı anda tek tarama koşar, ana süreç hiç bloklanmaz.
parentPort.on('message', (mesaj) => {
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
  try {
    const sonuc = mesaj && (mesaj.tum || !mesaj.dizin)
      ? gecmis.tumOturumlariTara(mesaj.secenekler)
      : gecmis.oturumGecmisi(mesaj.dizin, mesaj.secenekler);
    parentPort.postMessage({ id: kimlik, sonuc });
  } catch (e) {
    parentPort.postMessage({ id: kimlik, hata: String((e && e.message) || e) });
  }
});
