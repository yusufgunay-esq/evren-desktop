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
  try {
    const sonuc = gecmis.oturumGecmisi(mesaj.dizin, mesaj.secenekler);
    parentPort.postMessage({ id: kimlik, sonuc });
  } catch (e) {
    parentPort.postMessage({ id: kimlik, hata: String((e && e.message) || e) });
  }
});
