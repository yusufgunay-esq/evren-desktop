// أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ
// بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * Copyright (c) 2026 Yusuf Günay. */
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
